// Tri-state honesty for ledger-derived pixels in the tokenomics views.
//
// The rollup views only publish rows where usage was recorded, while the Rust
// summary separately publishes the daemon's exact sampled/not-sampled slot
// markers. What the UI must never do is dress an unsampled gap up as an
// authoritative measured zero, or dress a pre-ledger archive row up as
// harness ledger truth. These helpers make each decision pure and pinnable.

export const TOKENOMICS_ARCHIVE_HISTORY_SOURCE = "pre_ledger_archive";

export function tokenomicsLedgerAuthority(summary) {
  const authority = summary?.ledger_authority;
  const state = String(authority?.state || "unknown").trim().toLowerCase();
  return {
    state,
    reason: String(authority?.reason || "").trim(),
  };
}

const TOKENOMICS_COVERAGE_STATES = new Set([
  "sampled",
  "partially_sampled",
  "not_sampled",
]);
const TOKENOMICS_SLOT_COVERAGE_STATES = new Set([
  "sampled",
  "not_sampled",
]);

function tokenomicsCoverageState(value) {
  return TOKENOMICS_COVERAGE_STATES.has(value) ? value : "unknown";
}

function mergeTokenomicsCoverageState(left, right) {
  if (!left) return right;
  if (left === right) return left;
  if (left === "unknown" || right === "unknown") return "unknown";
  return "partially_sampled";
}

function tokenomicsUsageHistoryDateIsValid(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function tokenomicsCoverageArrayIsExact(value, length, states) {
  return Array.isArray(value)
    && value.length === length
    && Array.from(
      { length },
      (_, index) => Object.prototype.hasOwnProperty.call(value, index) && states.has(value[index]),
    ).every(Boolean);
}

function tokenomicsPublishedStateMatchesSlots(publishedState, slots) {
  const sampledCount = slots.filter((state) => state === "sampled").length;
  if (publishedState === "sampled") return sampledCount === slots.length;
  if (publishedState === "not_sampled") return sampledCount === 0;
  return publishedState === "partially_sampled"
    && sampledCount > 0
    && sampledCount < slots.length;
}

function tokenomicsUsageHistoryCoverageDayIsValid(day) {
  if (!day || typeof day !== "object" || Array.isArray(day)) return false;
  if (typeof day.device_id !== "string" || day.device_id.trim().length === 0) return false;
  if (!tokenomicsUsageHistoryDateIsValid(day.date)) return false;
  if (!Array.isArray(day.slots) || !Array.isArray(day.hours)) return false;

  if (day.coverage_state === "no_day") {
    return !Object.prototype.hasOwnProperty.call(day, "sample_state")
      && day.slots.length === 0
      && day.hours.length === 0;
  }
  if (day.coverage_state !== "day") return false;
  if (!TOKENOMICS_COVERAGE_STATES.has(day.sample_state)
      || !tokenomicsCoverageArrayIsExact(day.slots, 96, TOKENOMICS_SLOT_COVERAGE_STATES)
      || !tokenomicsCoverageArrayIsExact(day.hours, 24, TOKENOMICS_COVERAGE_STATES)
      || !tokenomicsPublishedStateMatchesSlots(day.sample_state, day.slots)) {
    return false;
  }
  return day.hours.every((publishedState, hour) => (
    tokenomicsPublishedStateMatchesSlots(publishedState, day.slots.slice(hour * 4, hour * 4 + 4))
  ));
}

/* Indexes only the exact typed coverage contract published by Rust. One
   malformed day invalidates the publication: no subset of a malformed
   authority payload may authorize a measured zero. */
export function tokenomicsUsageHistoryCoverageIndex(summary, selectedDeviceId = "all") {
  const coverage = summary?.usage_history_coverage;
  const validContract = coverage?.source === "usage_history_v1"
    && coverage?.slot_minutes === 15
    && coverage?.slots_per_hour === 4
    && coverage?.slots_per_day === 96
    && Array.isArray(coverage?.days)
    && coverage.days.every(tokenomicsUsageHistoryCoverageDayIsValid);
  const days = new Map();
  const hours = new Map();
  if (!validContract) return { published: false, days, hours };
  const requestedDevice = typeof selectedDeviceId === "string" && selectedDeviceId
    ? selectedDeviceId
    : "all";
  for (const day of coverage.days) {
    const { date, device_id: deviceId } = day;
    if (requestedDevice !== "all" && deviceId !== requestedDevice) continue;
    const dayState = day.coverage_state === "day" ? day.sample_state : "not_sampled";
    days.set(date, mergeTokenomicsCoverageState(days.get(date), dayState));
    if (day.coverage_state !== "day") continue;
    day.hours.forEach((publishedState, hour) => {
      const bucketStart = `${date}T${String(hour).padStart(2, "0")}:00:00Z`;
      hours.set(
        bucketStart,
        mergeTokenomicsCoverageState(hours.get(bucketStart), publishedState),
      );
    });
  }
  return { published: true, days, hours };
}

/* Full summaries replace the coverage publication, including with absence.
   Partial live-limit payloads are the one lane allowed to retain it. */
export function tokenomicsUsageHistoryCoverageForSummaryMerge(
  previous,
  next,
  { retainOnAbsence = false } = {},
) {
  const nextCoverage = next?.usage_history_coverage;
  if (retainOnAbsence && nextCoverage == null) {
    return previous?.usage_history_coverage;
  }
  return nextCoverage;
}

export function tokenomicsHourCoverageState(index, bucketStart) {
  if (!index?.published) return "unknown";
  const value = String(bucketStart || "");
  const key = value.length >= 13 ? `${value.slice(0, 13)}:00:00Z` : value;
  return tokenomicsCoverageState(index.hours?.get(key));
}

export function tokenomicsDayCoverageState(index, dayKey) {
  if (!index?.published) return "unknown";
  return tokenomicsCoverageState(index.days?.get(String(dayKey || "")));
}

export function tokenomicsPeriodCoverageState(index, startDayKey, endDayKey) {
  if (!index?.published) return "unknown";
  const start = new Date(`${startDayKey}T00:00:00Z`);
  const end = new Date(`${endDayKey}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return "unknown";
  let state = "";
  for (const date = start; date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    const dayKey = date.toISOString().slice(0, 10);
    const dayState = tokenomicsDayCoverageState(index, dayKey);
    if (dayState === "unknown") return "unknown";
    state = mergeTokenomicsCoverageState(state, dayState);
  }
  return state || "unknown";
}

export function tokenomicsCoverageAllowsKnownZero(coverageState) {
  return tokenomicsCoverageState(coverageState) === "sampled";
}

/* An observed aggregate is a fact regardless of coverage. An absent aggregate
   is a measured zero only when the daemon published exact sampled coverage. */
export function tokenomicsUsageRatePoint(aggregate, coverageState) {
  if (aggregate) return { ...aggregate, known: true, coverageState };
  if (tokenomicsCoverageAllowsKnownZero(coverageState)) {
    return { total: 0, input: 0, output: 0, cache: 0, cost: 0, known: true, coverageState };
  }
  return {
    total: null,
    input: null,
    output: null,
    cache: null,
    cost: null,
    known: false,
    coverageState,
  };
}

/* One period cell (Today / Last 30 Days). A summed value over recorded rows
   is a fact. Zero rows becomes a measured zero ONLY while the ledger authority
   is available AND every slot in the period is explicitly sampled. */
export function tokenomicsPeriodCellValue(value, rowCount, ledgerAuthority, coverageState) {
  if (rowCount > 0) return { known: true, value };
  if (String(ledgerAuthority?.state || "") === "available"
      && tokenomicsCoverageAllowsKnownZero(coverageState)) {
    return { known: true, value };
  }
  return {
    known: false,
    value: null,
    reason: ledgerAuthority?.reason
      || (String(ledgerAuthority?.state || "") === "available"
        ? "usage history period was not fully sampled"
        : "usage history authority is not available"),
  };
}

export function tokenomicsDailyBucketRowsAreArchive(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return list.length > 0 && list.every(
    (row) => String(row?.history_source || "") === TOKENOMICS_ARCHIVE_HISTORY_SOURCE,
  );
}

/* One daily chart column.
   - kind "no_data": no rows exist and coverage is not fully sampled.
   - kind "usage": recorded rows exist, or all 96 slots were sampled (a
     genuine zero total stays "usage" — sampled zero is a reading).
   archive marks a day whose rows all come from the pre-ledger archive. */
export function tokenomicsDailyBucketPresentation(bucket) {
  const rows = Array.isArray(bucket?.rows) ? bucket.rows : [];
  if (!rows.length && !tokenomicsCoverageAllowsKnownZero(bucket?.coverageState)) {
    return { kind: "no_data", archive: false };
  }
  return { kind: "usage", archive: tokenomicsDailyBucketRowsAreArchive(rows) };
}

export function tokenomicsDailyBucketTitle(bucket, presentation, usageTitle) {
  if (presentation.kind === "no_data") {
    return `${bucket?.titleLabel || bucket?.label || bucket?.key || "Day"}: no data`;
  }
  return presentation.archive ? `${usageTitle} · pre-ledger archive` : usageTitle;
}

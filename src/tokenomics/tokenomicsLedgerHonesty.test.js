import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  tokenomicsCoverageAllowsKnownZero,
  tokenomicsDayCoverageState,
  tokenomicsDailyBucketPresentation,
  tokenomicsDailyBucketRowsAreArchive,
  tokenomicsDailyBucketTitle,
  tokenomicsHourCoverageState,
  tokenomicsLedgerAuthority,
  tokenomicsPeriodCoverageState,
  tokenomicsPeriodCellValue,
  tokenomicsUsageHistoryCoverageForSummaryMerge,
  tokenomicsUsageHistoryCoverageIndex,
  tokenomicsUsageRatePoint,
} from "./tokenomicsLedgerHonesty.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const read = (name) => fs.readFileSync(path.join(directory, name), "utf8");

function coverageSummary(days) {
  return {
    usage_history_coverage: {
      source: "usage_history_v1",
      slot_minutes: 15,
      slots_per_hour: 4,
      slots_per_day: 96,
      days,
    },
  };
}

function coverageDay({ date = "2026-08-24", sampled = "partial" } = {}) {
  if (sampled === "full") {
    return {
      device_id: "local-device",
      date,
      coverage_state: "day",
      sample_state: "sampled",
      slots: Array.from({ length: 96 }, () => "sampled"),
      hours: Array.from({ length: 24 }, () => "sampled"),
    };
  }
  const slots = Array.from({ length: 96 }, () => "not_sampled");
  slots[0] = "sampled";
  slots.splice(4, 4, "sampled", "sampled", "sampled", "sampled");
  const hours = Array.from({ length: 24 }, () => "not_sampled");
  hours[0] = "partially_sampled";
  hours[1] = "sampled";
  return {
    device_id: "local-device",
    date,
    coverage_state: "day",
    sample_state: "partially_sampled",
    slots,
    hours,
  };
}

test("an empty period is 0 only when authority and full sampled coverage agree", () => {
  const available = { state: "available", reason: "" };
  assert.deepEqual(
    tokenomicsPeriodCellValue(0, 0, available, "sampled"),
    { known: true, value: 0 },
  );
  assert.deepEqual(
    tokenomicsPeriodCellValue(1234, 3, { state: "unknown" }, "not_sampled"),
    { known: true, value: 1234 },
  );

  for (const coverageState of ["partially_sampled", "not_sampled", "unknown", undefined]) {
    const cell = tokenomicsPeriodCellValue(0, 0, available, coverageState);
    assert.equal(cell.known, false, `${coverageState} must not become a measured zero`);
    assert.equal(cell.value, null);
  }

  for (const authority of [
    { state: "unknown", reason: "history_not_requested" },
    { state: "unavailable", reason: "daemon offline" },
    { state: "unsupported", reason: "" },
  ]) {
    const cell = tokenomicsPeriodCellValue(0, 0, authority, "sampled");
    assert.equal(cell.known, false, `${authority.state} with no rows must be unknown`);
    assert.equal(cell.value, null, "an unknown cell carries no number");
  }
  assert.equal(
    tokenomicsPeriodCellValue(0, 0, { state: "unavailable", reason: "daemon offline" }, "sampled").reason,
    "daemon offline",
  );
});

test("the exact Rust coverage contract keeps sampled zero distinct from unsampled absence", () => {
  const summary = coverageSummary([
    {
      device_id: "local-device",
      date: "2026-08-23",
      coverage_state: "no_day",
      slots: [],
      hours: [],
    },
    coverageDay(),
    coverageDay({ date: "2026-08-25", sampled: "full" }),
  ]);
  const coverage = tokenomicsUsageHistoryCoverageIndex(summary, "local-device");
  assert.equal(coverage.published, true);
  assert.equal(tokenomicsDayCoverageState(coverage, "2026-08-23"), "not_sampled");
  assert.equal(tokenomicsDayCoverageState(coverage, "2026-08-24"), "partially_sampled");
  assert.equal(tokenomicsDayCoverageState(coverage, "2026-08-25"), "sampled");
  assert.equal(tokenomicsHourCoverageState(coverage, "2026-08-24T01"), "sampled");
  assert.equal(tokenomicsHourCoverageState(coverage, "2026-08-24T02"), "not_sampled");
  assert.equal(tokenomicsHourCoverageState(coverage, "2026-08-24T03"), "not_sampled");
  assert.equal(tokenomicsHourCoverageState(coverage, "2026-08-24T24"), "unknown");
  assert.equal(
    tokenomicsPeriodCoverageState(coverage, "2026-08-25", "2026-08-25"),
    "sampled",
  );
  assert.equal(
    tokenomicsPeriodCoverageState(coverage, "2026-08-24", "2026-08-25"),
    "partially_sampled",
  );
  assert.equal(tokenomicsCoverageAllowsKnownZero("sampled"), true);
  assert.equal(tokenomicsCoverageAllowsKnownZero("not_sampled"), false);
  assert.equal(
    tokenomicsUsageHistoryCoverageIndex({}, "local-device").published,
    false,
    "missing coverage must remain unknown rather than default sampled",
  );
});

test("[pin] malformed, undersized, relabeled, or inconsistent coverage fails closed", () => {
  const validDay = coverageDay({ sampled: "full" });
  const missingSlots = { ...validDay };
  delete missingSlots.slots;
  const sparseSlots = [...validDay.slots];
  delete sparseSlots[12];
  const malformedDays = [
    ["undersized slots", { ...validDay, slots: validDay.slots.slice(0, 95) }],
    ["undersized hours", { ...validDay, hours: validDay.hours.slice(0, 23) }],
    ["oversized slots", { ...validDay, slots: [...validDay.slots, "sampled"] }],
    ["oversized hours", { ...validDay, hours: [...validDay.hours, "sampled"] }],
    ["missing slots", missingSlots],
    ["sparse slots", { ...validDay, slots: sparseSlots }],
    ["relabeled coverage_state", { ...validDay, coverage_state: " DAY " }],
    ["relabeled sample_state", { ...validDay, sample_state: " SAMPLED " }],
    ["relabeled slot", { ...validDay, slots: ["SAMPLED", ...validDay.slots.slice(1)] }],
    ["relabeled hour", { ...validDay, hours: ["SAMPLED", ...validDay.hours.slice(1)] }],
    ["inconsistent sample_state", { ...validDay, sample_state: "partially_sampled" }],
    ["inconsistent hour", { ...validDay, hours: ["not_sampled", ...validDay.hours.slice(1)] }],
    ["no_day with sample_state", {
      device_id: "local-device",
      date: "2026-08-24",
      coverage_state: "no_day",
      sample_state: "not_sampled",
      slots: [],
      hours: [],
    }],
  ];

  for (const [label, day] of malformedDays) {
    const index = tokenomicsUsageHistoryCoverageIndex(coverageSummary([day]), "local-device");
    assert.equal(index.published, false, `${label} must invalidate the coverage publication`);
    const coverageState = tokenomicsDayCoverageState(index, day.date);
    assert.equal(coverageState, "unknown", `${label} must remain no-data`);
    assert.deepEqual(
      tokenomicsDailyBucketPresentation({ rows: [], coverageState }),
      { kind: "no_data", archive: false },
      `${label} must never authorize a measured-zero bucket`,
    );
    assert.equal(
      tokenomicsPeriodCellValue(0, 0, { state: "available" }, coverageState).known,
      false,
      `${label} must never authorize a measured-zero period`,
    );
  }

  const wrongTopLevelDimension = coverageSummary([validDay]);
  wrongTopLevelDimension.usage_history_coverage.slots_per_day = 95;
  assert.equal(
    tokenomicsUsageHistoryCoverageIndex(wrongTopLevelDimension, "local-device").published,
    false,
    "a relabeled top-level dimension must invalidate the coverage publication",
  );
  assert.equal(
    tokenomicsCoverageAllowsKnownZero(" SAMPLED "),
    false,
    "padded coverage must not be relabeled into sampled authority",
  );
  assert.equal(
    tokenomicsCoverageAllowsKnownZero("SAMPLED"),
    false,
    "case-shifted coverage must not be relabeled into sampled authority",
  );
});

test("[pin] full summaries unpublish absent coverage while partial deltas may retain it", () => {
  const previousCoverage = coverageSummary([coverageDay({ sampled: "full" })])
    .usage_history_coverage;
  const previous = { usage_history_coverage: previousCoverage };
  const replacement = coverageSummary([coverageDay()]).usage_history_coverage;

  assert.equal(
    tokenomicsUsageHistoryCoverageForSummaryMerge(previous, {}),
    undefined,
    "an omitted full-summary field must unpublish stale coverage",
  );
  assert.equal(
    tokenomicsUsageHistoryCoverageForSummaryMerge(previous, { usage_history_coverage: null }),
    null,
    "an explicit full-summary null must stay null",
  );
  assert.equal(
    tokenomicsUsageHistoryCoverageForSummaryMerge(previous, {}, { retainOnAbsence: true }),
    previousCoverage,
    "an omitted partial delta may retain the last full-summary publication",
  );
  assert.equal(
    tokenomicsUsageHistoryCoverageForSummaryMerge(
      previous,
      { usage_history_coverage: null },
      { retainOnAbsence: true },
    ),
    previousCoverage,
    "a null partial delta may retain the last full-summary publication",
  );
  assert.equal(
    tokenomicsUsageHistoryCoverageForSummaryMerge(
      previous,
      { usage_history_coverage: replacement },
      { retainOnAbsence: true },
    ),
    replacement,
    "published replacement coverage must be carried by identity, never rebuilt locally",
  );
});

test("[pin] usage-rate absence is no-data for uncovered and partial hours", () => {
  for (const coverageState of ["partially_sampled", "not_sampled", "unknown", undefined]) {
    assert.deepEqual(
      tokenomicsUsageRatePoint(undefined, coverageState),
      {
        total: null,
        input: null,
        output: null,
        cache: null,
        cost: null,
        known: false,
        coverageState,
      },
      `${coverageState} absence must not become a zero-valued usage-rate point`,
    );
  }
  assert.deepEqual(
    tokenomicsUsageRatePoint(undefined, "sampled"),
    {
      total: 0,
      input: 0,
      output: 0,
      cache: 0,
      cost: 0,
      known: true,
      coverageState: "sampled",
    },
  );
  assert.deepEqual(
    tokenomicsUsageRatePoint({ total: 7, input: 4, output: 3, cache: 0, cost: 0.01 }, "not_sampled"),
    {
      total: 7,
      input: 4,
      output: 3,
      cache: 0,
      cost: 0.01,
      known: true,
      coverageState: "not_sampled",
    },
    "an observed aggregate remains a fact even when coverage is partial",
  );
});

test("ledger authority reads verbatim and defaults to unknown, never to available", () => {
  assert.deepEqual(
    tokenomicsLedgerAuthority({ ledger_authority: { state: "available" } }),
    { state: "available", reason: "" },
  );
  assert.deepEqual(tokenomicsLedgerAuthority({}), { state: "unknown", reason: "" });
  assert.deepEqual(tokenomicsLedgerAuthority(null), { state: "unknown", reason: "" });
});

test("a day without rows is measured zero only under fully sampled coverage", () => {
  assert.deepEqual(
    tokenomicsDailyBucketPresentation({ rows: [], coverageState: "not_sampled" }),
    { kind: "no_data", archive: false },
  );
  assert.deepEqual(
    tokenomicsDailyBucketPresentation({ rows: [], coverageState: "sampled" }),
    { kind: "usage", archive: false },
  );
  assert.deepEqual(
    tokenomicsDailyBucketPresentation({
      rows: [{ history_source: "usage_history_v1", total_tokens: 0 }],
      coverageState: "partially_sampled",
    }),
    { kind: "usage", archive: false },
  );
});

test("archive labelling: only a bucket whose rows are all pre-ledger archive is archive", () => {
  const archiveRow = { history_source: "pre_ledger_archive" };
  const ledgerRow = { history_source: "usage_history_v1" };
  assert.equal(tokenomicsDailyBucketRowsAreArchive([archiveRow, archiveRow]), true);
  assert.equal(tokenomicsDailyBucketRowsAreArchive([archiveRow, ledgerRow]), false);
  assert.equal(tokenomicsDailyBucketRowsAreArchive([]), false, "no rows is absence, not archive");
  assert.deepEqual(
    tokenomicsDailyBucketPresentation({ rows: [archiveRow] }),
    { kind: "usage", archive: true },
  );
});

test("daily titles: unsampled says no data, archive appends its label", () => {
  const bucket = { key: "2026-08-20", label: "W", titleLabel: "Wednesday, Aug 20" };
  assert.equal(
    tokenomicsDailyBucketTitle(bucket, { kind: "no_data", archive: false }, "unused"),
    "Wednesday, Aug 20: no data",
  );
  assert.equal(
    tokenomicsDailyBucketTitle(bucket, { kind: "usage", archive: true }, "Wednesday: total 5K"),
    "Wednesday: total 5K · pre-ledger archive",
  );
  assert.equal(
    tokenomicsDailyBucketTitle(bucket, { kind: "usage", archive: false }, "Wednesday: total 5K"),
    "Wednesday: total 5K",
  );
});

/* ---- source pins: the view actually routes pixels through these decisions
   (JSX wiring in the repo's established source-regex style) ---- */

test("the usage table renders through the pinned period tri-state, not raw sums", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.match(view, /periodRowCells\(today, ledgerAuthority\)/);
  assert.match(view, /periodRowCells\(last30Days, ledgerAuthority\)/);
  assert.match(view, /tokenomicsPeriodCellValue\(/);
  assert.match(view, /aggregate\?\.coverageState/);
  /* Anchored per cell: TokenCell and CostCell are near-identical, so a
     shared regex would let one keep the pin green while the other regresses
     into formatting null as 0. */
  assert.match(
    view,
    /function TokenCell\(\{ value, unknown_reason: unknownReason = "" \}\) \{\s*\n\s*if \(value == null\) \{\s*\n\s*return <td title=\{unknownReason/,
    "TokenCell must render unknown as an em dash cell, never format null into 0",
  );
  assert.match(
    view,
    /function CostCell\(\{ value, unknown_reason: unknownReason = "" \}\) \{\s*\n\s*if \(value == null\) \{\s*\n\s*return <td title=\{unknownReason/,
    "CostCell must render unknown as an em dash cell, never format null into $0.00",
  );
  assert.doesNotMatch(
    view,
    /<TokenCell value=\{today\.input\} \/>/,
    "the Today row must not bypass the tri-state seam",
  );
});

test("daily columns render through the pinned bucket tri-state with the archive label", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.match(view, /tokenomicsDailyBucketPresentation\(row\)/);
  assert.match(view, /tokenomicsDailyBucketTitle\(/);
  assert.match(view, /\$noData=\{noData \? true : undefined\}/);
  assert.match(
    view,
    /rows: match\?\.rows \|\| \[\]/,
    "daily buckets must retain their source rows for the tri-state decision",
  );
  assert.match(view, /coverageState: tokenomicsDayCoverageState\(coverageIndex, key\)/);
});

test("usage-rate gaps route through hour coverage and render no-data markers", () => {
  const view = read("AccountTokenomicsView.jsx");
  assert.doesNotMatch(
    view,
    /usage_history_coverage: next\.usage_history_coverage \|\| previous\.usage_history_coverage/,
    "the full-summary merge must not retain stale coverage through a truthy fallback",
  );
  assert.match(
    view,
    /usage_history_coverage: tokenomicsUsageHistoryCoverageForSummaryMerge\(previous, next, \{/,
  );
  assert.match(
    view,
    /const merged = mergeTokenomicsSummary\(previous\.summary, next \|\| \{\}, \{\s*retainUsageHistoryCoverageOnAbsence: true,/,
    "the live-limit lane must opt into partial-delta retention",
  );
  assert.match(
    view,
    /summary: mergeTokenomicsSummary\(previous\.summary, next \|\| \{\}\),/,
    "the full tokenomics_get_summary lane must use fail-closed replacement semantics",
  );
  assert.match(view, /tokenomicsUsageHistoryCoverageIndex\(visibleSummary, selectedDeviceId\)/);
  assert.match(view, /tokenomicsHourCoverageState\(coverageIndex, key\)/);
  assert.match(view, /tokenomicsHourCoverageState\(coverageIndex, bucketStart\)/);
  assert.match(view, /tokenomicsUsageRatePoint\(byHour\.get\(key\), coverageState\)/);
  assert.match(view, /tokenomicsUsageRatePoint\(byIndex\.get\(index\), coverageState\)/);
  assert.match(view, /className=\{row\.known \? \(isHot \? "hot" : "cool"\) : "no-data"\}/);
  assert.match(view, /`\$\{row\.label\}: no data`/);
  assert.match(view, /if \(!point\.known\) \{\s*activeSegment = false;/);
  assert.doesNotMatch(
    view,
    /const aggregate = byHour\.get\(key\) \|\| \{ total: 0/,
    "an absent hourly row must never be zero-filled without sampled coverage",
  );
});

test("[pin] an explicit null speed renders Unknown, never normal", async () => {
  const [{ default: React }, { renderToStaticMarkup }, { createServer }] = await Promise.all([
    import("react"),
    import("react-dom/server"),
    import("vite"),
  ]);
  const server = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
    ssr: { noExternal: ["styled-components"] },
  });
  try {
    const { default: SessionComposer } = await server.ssrLoadModule(
      "/src/sessions/SessionComposer.jsx",
    );
    const html = renderToStaticMarkup(React.createElement(SessionComposer, {
      chipCapabilities: {},
      chipOptions: { speed: [], speedApplicable: true },
      chipValues: { speed: null },
    }));
    assert.match(
      html,
      /<em>Speed<\/em><span>Unknown<\/span>/,
      "fast=null must render the speed chip as Unknown",
    );
    assert.doesNotMatch(
      html,
      /<em>Speed<\/em><span>normal<\/span>/i,
      "fast=null must never be presented as normal speed",
    );
  } finally {
    await server.close();
  }
});

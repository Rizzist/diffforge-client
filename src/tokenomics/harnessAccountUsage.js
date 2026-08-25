// Per-account usage + meter presentation for the LIVE harness accounts row.
//
// The ledger (tokenomics_ledger_* via the effective-rollup views behind
// tokenomics_get_summary) keys usage lanes by the harness account: ledger
// rows surface with history_source "usage_history_v1" and their
// provider_account_key carrying the lane key's `account` VERBATIM (the
// daemon account alias). Anonymous lanes surface as synthetic
// "usage-history-key:<id>" keys and never match an alias.
//
// Meter facts come from the same summary: `meter_states` rows publish one
// typed state per daemon account, `ledger_meter_samples` publishes the latest
// immutable reading per exact account/window, and per-account limit rows are
// the legacy fallback projection. Everything here is tri-state honest:
// absent is unknown, never zero, never healthy.

import { rowProviderAccountKey, rowTotal } from "./tokenomicsFormat.js";
import {
  harnessAccountAlias,
  harnessAccountMatchesWireIdentity,
} from "./harnessAccountRoster.js";

export const HARNESS_LEDGER_HISTORY_SOURCE = "usage_history_v1";

const HARNESS_PROVIDER_ACCENTS = {
  openai: "#60a5fa",
  anthropic: "#fb923c",
  opencode: "#34d399",
  "haider-code": "#a78bfa",
};

/* Cosmetic only: exact daemon provider strings select an accent; unknown
   providers share the neutral color and never acquire a guessed identity. */
export function harnessProviderAccent(provider) {
  return HARNESS_PROVIDER_ACCENTS[String(provider || "").trim()] || "#94a3b8";
}

export function harnessAccountLedgerLanes(rows, alias) {
  const clean = harnessAccountAlias(alias);
  if (!clean) return [];
  return (Array.isArray(rows) ? rows : []).filter((row) => (
    String(row?.history_source || "") === HARNESS_LEDGER_HISTORY_SOURCE
      && rowProviderAccountKey(row) === clean
  ));
}

/* Tri-state per-account usage figure:
   - no ledger lanes for the alias → {state:"unknown"} — the ledger simply
     has nothing keyed to this account, which is NOT the same fact as zero.
   - lanes present → {state:"known", totalTokens} — a lane summing to zero is
     a sampled zero and renders as 0. */
export function harnessAccountUsagePresentation(rows, alias) {
  const lanes = harnessAccountLedgerLanes(rows, alias);
  if (!lanes.length) return { state: "unknown", reason: "no_ledger_lanes" };
  return {
    state: "known",
    laneCount: lanes.length,
    totalTokens: lanes.reduce((sum, row) => sum + rowTotal(row), 0),
  };
}

export function harnessAccountMeterEntry(summary, descriptor) {
  if (!harnessAccountAlias(descriptor)) return null;
  const meters = Array.isArray(summary?.meter_states) ? summary.meter_states : [];
  return meters.find((row) => harnessAccountMatchesWireIdentity(row, descriptor)) || null;
}

/* Integer meter percent. basis_points is the harness's integer authority
   (percent = basis_points / 100 in INTEGER math); an integer used_percent is
   the projection the summary publishes today. Absent → null — unknown is
   never rendered as 0. */
export function harnessMeterPercent(row) {
  const basisPoints = row?.basis_points;
  if (Number.isInteger(basisPoints) && basisPoints >= 0) {
    return Math.floor(basisPoints / 100);
  }
  const used = Number(row?.used_percent);
  if (Number.isFinite(used)) return Math.trunc(used);
  return null;
}

export function harnessMeterRowIsStale(row) {
  return row?.stale === true
    || String(row?.confidence || "") === "sampled_stale"
    || String(row?.pace_confidence || "") === "stale";
}

/* One line of meter pixels per tri-state. Unknown never becomes a number or
   a healthy default; the view only renders this projection. */
export function harnessMeterLine(meter) {
  if (meter.state === "metered") {
    if (meter.percent == null) {
      return { text: "meter % unknown", tone: "unknown", title: "The daemon published a meter but no window reading" };
    }
    const window = meter.windowKind === "weekly" ? "weekly" : "5h";
    return {
      text: `${meter.percent}% ${window}${meter.stale ? " · stale" : ""}`,
      tone: meter.stale ? "stale" : "known",
      title: [
        `${meter.percent}% of the ${window === "5h" ? "5-hour" : "weekly"} window used`,
        meter.plan ? `plan ${meter.plan}` : "",
        meter.stale ? "reading is stale" : "",
        meter.resetAt ? `resets ${meter.resetAt}` : "",
        meter.credits != null ? `credits ${meter.credits}` : "",
        meter.hold != null ? `hold ${meter.hold}` : "",
      ].filter(Boolean).join(" · "),
    };
  }
  if (meter.state === "unavailable") {
    return { text: "meter unavailable", tone: "bad", title: meter.reason || "The provider meter could not be read" };
  }
  if (meter.state === "local_only") {
    return { text: "local only", tone: "unknown", title: "This provider has no server meter; only local counters exist" };
  }
  return { text: "", tone: "unknown", title: meter.reason || "No meter state was published for this account" };
}

function finiteOrNull(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function accountLimitRows(summary, accountKey) {
  if (!accountKey) return [];
  const rows = [
    ...(Array.isArray(summary?.limits) ? summary.limits : []),
    ...(Array.isArray(summary?.latest_windows) ? summary.latest_windows : []),
  ];
  return rows.filter((row) => rowProviderAccountKey(row) === accountKey);
}

export function harnessAccountLedgerMeterSamples(summary, alias) {
  const account = harnessAccountAlias(alias);
  if (!account) return [];
  const rows = Array.isArray(summary?.ledger_meter_samples)
    ? summary.ledger_meter_samples
    : [];
  return rows.filter((row) => String(row?.account || "") === account);
}

function normalizedWindowKind(row) {
  const value = String(row?.window || row?.window_kind || row?.limit_kind || "").trim().toLowerCase();
  if (["primary", "five_hour", "five-hour", "5_hour", "5h", "session_5h"].includes(value)) {
    return "5_hour";
  }
  if (["secondary", "weekly", "seven_day", "seven-day", "7_day", "7d"].includes(value)) {
    return "weekly";
  }
  return value;
}

function preferredWindowRow(rows) {
  return rows.find((row) => normalizedWindowKind(row) === "5_hour")
    || rows.find((row) => normalizedWindowKind(row) === "weekly")
    || rows[0]
    || null;
}

function meterTimestamp(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function resetLabelFromMillis(value) {
  const timestamp = meterTimestamp(value);
  if (timestamp == null) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/* Tri-state meter presentation for one harness account:
   - {state:"unknown"} — no meter state was published for the account.
   - {state:"unavailable", reason} — the meter read failed; reason verbatim.
   - {state:"local_only"} — no server meter exists for this provider.
   - {state:"metered", percent, stale, plan, windowKind, resetAt, credits,
      hold} — percent/plan/credits/hold are null when the authority did not
      publish them; null is unknown and must not render as a number. */
export function harnessAccountMeterPresentation(summary, descriptor) {
  const entry = harnessAccountMeterEntry(summary, descriptor);
  if (!entry) return { state: "unknown", reason: "no_meter_state" };
  const meterState = String(entry?.state || "unknown").trim().toLowerCase();
  if (meterState === "unavailable") {
    return { state: "unavailable", reason: String(entry?.reason || "") };
  }
  if (meterState === "local_only") return { state: "local_only" };
  if (meterState !== "metered") {
    return { state: "unknown", reason: String(entry?.reason || "unrecognized_meter_state") };
  }
  /* Ledger samples match the daemon's verbatim account alias. Their integer
     and optional fields outrank the lossy limit projection; the projection is
     retained only as a fallback for summaries predating ledger publication. */
  const ledgerRow = preferredWindowRow(
    harnessAccountLedgerMeterSamples(summary, harnessAccountAlias(descriptor)),
  );
  const accountKey = String(entry?.provider_account_key || "").trim();
  const limitRow = preferredWindowRow(accountLimitRows(summary, accountKey));
  if (!ledgerRow && !limitRow) {
    /* Metered account with no published window reading: the percent is
       unknown, not 0 and not "fine". */
    return {
      state: "metered",
      percent: null,
      stale: false,
      plan: null,
      windowKind: "",
      resetAt: null,
      resetsAtMs: null,
      sampledAtMs: null,
      basisPoints: null,
      credits: null,
      hold: null,
    };
  }
  const plan = String(ledgerRow?.plan || limitRow?.plan_name || "").trim();
  const resetsAtMs = meterTimestamp(ledgerRow?.resets_at_ms);
  const sampledAtMs = meterTimestamp(ledgerRow?.sampled_at_ms);
  const basisPoints = Number.isInteger(ledgerRow?.basis_points) && ledgerRow.basis_points >= 0
    ? ledgerRow.basis_points
    : null;
  const ledgerHasStale = ledgerRow && Object.hasOwn(ledgerRow, "stale");
  return {
    state: "metered",
    percent: harnessMeterPercent(ledgerRow || limitRow),
    stale: ledgerHasStale
      ? ledgerRow.stale === true
      : harnessMeterRowIsStale(limitRow),
    plan: plan || null,
    windowKind: normalizedWindowKind(ledgerRow || limitRow),
    resetAt: resetLabelFromMillis(resetsAtMs)
      || String(limitRow?.reset_at || "").trim()
      || null,
    resetsAtMs,
    sampledAtMs,
    basisPoints,
    /* A ledger row with an absent optional balance stays null. It must not
       fall through to a projected number, much less a fabricated zero. */
    credits: ledgerRow ? finiteOrNull(ledgerRow.credits) : finiteOrNull(limitRow?.credits),
    hold: ledgerRow ? finiteOrNull(ledgerRow.hold) : finiteOrNull(limitRow?.hold),
  };
}

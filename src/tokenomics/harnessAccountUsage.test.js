import test from "node:test";
import assert from "node:assert/strict";
import {
  harnessAccountLedgerLanes,
  harnessAccountLedgerMeterSamples,
  harnessAccountMeterEntry,
  harnessAccountMeterPresentation,
  harnessAccountUsagePresentation,
  harnessMeterPercent,
  harnessMeterRowIsStale,
} from "./harnessAccountUsage.js";

const ledgerRow = (accountKey, totalTokens, extra = {}) => ({
  history_source: "usage_history_v1",
  provider_account_key: accountKey,
  total_tokens: totalTokens,
  ...extra,
});

test("no ledger lanes for an alias is unknown — never zero", () => {
  const rows = [ledgerRow("other-account", 500)];
  const presentation = harnessAccountUsagePresentation(rows, "work");
  assert.equal(presentation.state, "unknown");
  assert.equal(presentation.reason, "no_ledger_lanes");
  assert.equal(
    Object.hasOwn(presentation, "totalTokens"),
    false,
    "an unknown usage figure must not carry a number at all",
  );
});

test("a lane summing to zero is a sampled zero, distinct from absence", () => {
  const presentation = harnessAccountUsagePresentation([ledgerRow("work", 0)], "work");
  assert.deepEqual(presentation, { state: "known", laneCount: 1, totalTokens: 0 });
});

test("only usage_history_v1 rows with the verbatim lane key count as harness lanes", () => {
  const rows = [
    ledgerRow("work", 100),
    ledgerRow("work", 40),
    /* pre-ledger archive rows are archive, not harness lanes, even when a
       key happens to collide with a live alias */
    { history_source: "pre_ledger_archive", provider_account_key: "work", total_tokens: 9999 },
    /* cross-device rollups are not this account's ledger lanes either */
    { history_source: "device_rollup", provider_account_key: "work", total_tokens: 7777 },
    ledgerRow("another", 5),
  ];
  assert.equal(harnessAccountLedgerLanes(rows, "work").length, 2);
  assert.deepEqual(
    harnessAccountUsagePresentation(rows, "work"),
    { state: "known", laneCount: 2, totalTokens: 140 },
  );
  assert.equal(harnessAccountUsagePresentation(rows, "").state, "unknown");
});

test("meter percent is integer math over basis_points, integer used_percent as fallback, absent stays null", () => {
  assert.equal(harnessMeterPercent({ basis_points: 4299 }), 42, "basis_points/100 floors, never rounds up");
  assert.equal(harnessMeterPercent({ basis_points: 0 }), 0);
  assert.equal(harnessMeterPercent({ used_percent: 63 }), 63);
  assert.equal(harnessMeterPercent({ basis_points: 4299, used_percent: 99 }), 42, "basis_points outranks the projection");
  assert.equal(harnessMeterPercent({}), null, "absent percent is unknown, never 0");
  assert.equal(harnessMeterPercent({ used_percent: "not-a-number" }), null);
});

test("stale marker fires only on the authority's own stale facts", () => {
  assert.equal(harnessMeterRowIsStale({ stale: true }), true);
  assert.equal(harnessMeterRowIsStale({ confidence: "sampled_stale" }), true);
  assert.equal(harnessMeterRowIsStale({ pace_confidence: "stale" }), true);
  assert.equal(harnessMeterRowIsStale({ confidence: "live" }), false);
  assert.equal(harnessMeterRowIsStale({}), false);
});

const meterSummary = (overrides = {}) => ({
  meter_states: [
    {
      provider: "anthropic",
      account_alias: "work",
      provider_account_key: "anthropic:claude:haider:work",
      state: "metered",
    },
    {
      provider: "openai",
      account_alias: "spare",
      provider_account_key: "openai:codex:haider:spare",
      state: "unavailable",
      reason: "oauth refresh failed",
    },
    {
      provider: "custom",
      account_alias: "keyed",
      provider_account_key: "custom:custom:haider:keyed",
      state: "local_only",
    },
  ],
  limits: [
    {
      provider_account_key: "anthropic:claude:haider:work",
      window_kind: "5_hour",
      used_percent: 42,
      plan_name: "max",
      reset_at: "2026-08-25 18:00",
      confidence: "live",
    },
    {
      provider_account_key: "anthropic:claude:haider:work",
      window_kind: "weekly",
      used_percent: 12,
    },
  ],
  ...overrides,
});

test("meter presentation carries the tri-state through: metered, unavailable-with-reason, local_only, unknown", () => {
  const summary = meterSummary();
  const metered = harnessAccountMeterPresentation(summary, { alias: "work", provider: "anthropic" });
  assert.equal(metered.state, "metered");
  assert.equal(metered.percent, 42);
  assert.equal(metered.windowKind, "5_hour");
  assert.equal(metered.plan, "max");
  assert.equal(metered.stale, false);
  assert.equal(metered.credits, null, "absent credits stay null — NEVER zero");
  assert.equal(metered.hold, null, "absent hold stays null — NEVER zero");

  const unavailable = harnessAccountMeterPresentation(summary, { alias: "spare", provider: "openai" });
  assert.deepEqual(unavailable, { state: "unavailable", reason: "oauth refresh failed" });

  assert.deepEqual(
    harnessAccountMeterPresentation(summary, { alias: "keyed", provider: "custom" }),
    { state: "local_only" },
  );

  const unknown = harnessAccountMeterPresentation(summary, { alias: "brand-new", provider: "anthropic" });
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.reason, "no_meter_state");
});

test("a metered account with no published window reading has an unknown percent, not 0", () => {
  const summary = meterSummary({ limits: [] });
  const metered = harnessAccountMeterPresentation(summary, { alias: "work", provider: "anthropic" });
  assert.equal(metered.state, "metered");
  assert.equal(metered.percent, null);
  assert.equal(metered.plan, null);
});

test("meter entry matching binds alias AND provider — the daemon's own keys, no local re-derivation", () => {
  const summary = meterSummary();
  assert.equal(harnessAccountMeterEntry(summary, { alias: "work", provider: "openai" }), null);
  assert.equal(
    harnessAccountMeterEntry(summary, { alias: "work", provider: "anthropic" })?.provider_account_key,
    "anthropic:claude:haider:work",
  );
  assert.equal(harnessAccountMeterEntry(summary, { alias: "" }), null);
});

test("stale window readings surface the stale marker with the percent", () => {
  const summary = meterSummary({
    limits: [{
      provider_account_key: "anthropic:claude:haider:work",
      window_kind: "5_hour",
      used_percent: 87,
      confidence: "sampled_stale",
    }],
  });
  const metered = harnessAccountMeterPresentation(summary, { alias: "work", provider: "anthropic" });
  assert.equal(metered.percent, 87);
  assert.equal(metered.stale, true);
});

test("published credits and hold pass through when present", () => {
  const summary = meterSummary({
    limits: [{
      provider_account_key: "anthropic:claude:haider:work",
      window_kind: "5_hour",
      used_percent: 10,
      credits: 0,
      hold: 25,
    }],
  });
  const metered = harnessAccountMeterPresentation(summary, { alias: "work", provider: "anthropic" });
  assert.equal(metered.credits, 0, "a published zero balance is a fact and renders as 0");
  assert.equal(metered.hold, 25);
});

test("ingested ledger meter fields outrank the lossy limit projection without inventing absent balances", () => {
  const summary = meterSummary({
    ledger_meter_samples: [{
      account: "work",
      window: "primary",
      basis_points: 16_777_217,
      resets_at_ms: 1_800_000_000_000,
      sampled_at_ms: 1_777_000_000_000,
      plan: "go",
      /* credits is deliberately absent: absence must survive Rust JSON and
         this presentation boundary instead of becoming zero. */
      hold: 0,
      stale: false,
    }],
    limits: [{
      provider_account_key: "anthropic:claude:haider:work",
      window_kind: "5_hour",
      used_percent: 99,
      credits: 400,
      hold: 500,
      confidence: "sampled_stale",
      plan_name: "projected-plan",
    }],
  });
  assert.deepEqual(
    harnessAccountLedgerMeterSamples(summary, "work"),
    summary.ledger_meter_samples,
    "the helper receives the summary's exact-account ledger publication",
  );
  const metered = harnessAccountMeterPresentation(summary, { alias: "work", provider: "anthropic" });
  assert.equal(metered.basisPoints, 16_777_217, "integer basis points reach the JS presentation verbatim");
  assert.equal(metered.percent, 167_772, "percent uses integer division over the ledger authority");
  assert.equal(metered.credits, null, "absent ledger credits stay absent/unknown, never projected or zero");
  assert.equal(metered.hold, 0, "a published zero remains a real zero");
  assert.equal(metered.stale, false, "an explicit ledger false outranks projected stale sniffing");
  assert.equal(metered.plan, "go");
  assert.equal(metered.windowKind, "5_hour");
  assert.equal(metered.resetsAtMs, 1_800_000_000_000);
  assert.equal(metered.sampledAtMs, 1_777_000_000_000);
});

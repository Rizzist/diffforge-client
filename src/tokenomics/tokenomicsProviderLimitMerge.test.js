import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeProviderLimitRowsForDisplay,
  mergeProviderLimits,
  projectProviderLimitForDisplay,
} from "./tokenomicsProviderLimitMerge.js";

const knownClaudeSession = {
  provider: "anthropic",
  agent_kind: "claude",
  device_id: "device-a",
  provider_account_key: "anthropic:claude:personal",
  window_kind: "5_hour",
  limit_source: "claude_statusline",
  confidence: "live",
  used_percent: 84,
  remaining_percent: 16,
  pace_status: "over_pace",
  pace_delta_percent: 497,
  updated_at: "unix:1000",
};

const liveNoDataClaudeSession = {
  provider: "anthropic",
  agent_kind: "claude",
  device_id: "device-a",
  provider_account_key: "anthropic:claude:personal",
  window_kind: "5_hour",
  limit_source: "claude_statusline",
  confidence: "live",
  used_percent: null,
  remaining_percent: null,
  pace_status: "unknown",
  pace_delta_percent: null,
  updated_at: "unix:1010",
};

const knownCodexWeekly = {
  provider: "openai",
  agent_kind: "codex",
  device_id: "device-a",
  provider_account_key: "openai:codex:pro",
  window_kind: "weekly",
  limit_source: "codex_usage_api",
  confidence: "live",
  used_percent: 84,
  remaining_percent: 16,
  pace_status: "over_pace",
  pace_delta_percent: 109,
  updated_at: "unix:1000",
};

test("provider limit store merge keeps known percent over later live no-data", () => {
  const merged = mergeProviderLimits([knownClaudeSession], [liveNoDataClaudeSession]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].used_percent, 84);
  assert.equal(merged[0].remaining_percent, 16);
  assert.equal(merged[0].pace_status, "over_pace");
  assert.equal(merged[0].pace_delta_percent, 497);
});

test("provider limit display merge keeps latest-window percent over live no-data alias", () => {
  const latestWindow = {
    ...knownClaudeSession,
    row_kind: "latest_window",
    window_kind: "session_5h",
    source: "local",
  };

  const merged = mergeProviderLimitRowsForDisplay([
    liveNoDataClaudeSession,
    latestWindow,
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].row_kind, "latest_window");
  assert.equal(merged[0].used_percent, 84);
  assert.equal(merged[0].remaining_percent, 16);
});

test("provider limit store merge accepts fresher Codex usage percentages", () => {
  const refreshedCodexWeekly = {
    ...knownCodexWeekly,
    used_percent: 88,
    remaining_percent: 12,
    pace_delta_percent: 126,
    updated_at: "unix:1010",
  };

  const merged = mergeProviderLimits([knownCodexWeekly], [refreshedCodexWeekly]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].used_percent, 88);
  assert.equal(merged[0].remaining_percent, 12);
  assert.equal(merged[0].pace_delta_percent, 126);
});

test("provider limit store merge rejects newer Codex no-data over known percent", () => {
  const codexNoData = {
    ...knownCodexWeekly,
    used_percent: null,
    remaining_percent: null,
    pace_status: "unknown",
    pace_delta_percent: null,
    updated_at: "unix:1020",
  };

  const merged = mergeProviderLimits([knownCodexWeekly], [codexNoData]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].used_percent, 84);
  assert.equal(merged[0].remaining_percent, 16);
  assert.equal(merged[0].pace_status, "over_pace");
  assert.equal(merged[0].pace_delta_percent, 109);
});

test("Claude display drops expired unknown-scope aliases once a canonical row exists", () => {
  const currentPersonal = {
    ...knownClaudeSession,
    billing_scope_type: "personal",
    used_percent: 89,
    remaining_percent: 11,
    reset_at: "unix:2000",
    updated_at: "unix:1100",
  };
  const expiredUnknownAlias = {
    ...knownClaudeSession,
    billing_scope_type: "unknown",
    used_percent: 33,
    remaining_percent: 67,
    reset_at: "unix:1000",
    updated_at: "unix:900",
  };

  const merged = mergeProviderLimitRowsForDisplay([
    expiredUnknownAlias,
    currentPersonal,
  ]);
  const projected = merged.map((row) => projectProviderLimitForDisplay(row, 1_500_000));

  assert.equal(projected.length, 1);
  assert.equal(projected[0].billing_scope_type, "personal");
  assert.equal(projected[0].used_percent, 89);
  assert.equal(projected[0].remaining_percent, 11);
  assert.equal(projected[0].reset_label, "Resets in 8m");
});

test("an expired Claude window assumes a fresh window until refresh", () => {
  const projected = projectProviderLimitForDisplay({
    ...knownClaudeSession,
    display_percent: 16,
    display_percent_kind: "remaining",
    reset_at: "unix:1000",
  }, 1_100_000);

  /* Visual-only assumption: an ended window is shown as fully reset until
     the next live sample lands (client_reset_pending marks the guess). */
  assert.equal(projected.used_percent, 0);
  assert.equal(projected.remaining_percent, 100);
  assert.equal(projected.display_percent, 100);
  assert.equal(projected.reset_after_seconds, 0);
  assert.equal(projected.client_reset_pending, true);
  assert.equal(projected.reset_label, "Provider window ended; assuming 100% until live refresh");
});

test("an expired used-kind window assumes zero used until refresh", () => {
  const projected = projectProviderLimitForDisplay({
    ...knownClaudeSession,
    display_percent: 84,
    display_percent_kind: "used",
    reset_at: "unix:1000",
  }, 1_100_000);

  assert.equal(projected.used_percent, 0);
  assert.equal(projected.remaining_percent, 100);
  assert.equal(projected.display_percent, 0);
  assert.equal(projected.client_reset_pending, true);
});

test("an expired window drops the dead window's pace verdict with the percents", () => {
  const projected = projectProviderLimitForDisplay({
    ...knownClaudeSession,
    display_percent: 16,
    display_percent_kind: "remaining",
    reset_at: "unix:1000",
    pace_status: "over_pace",
    pace_delta_percent: 549,
    pace_exhausts_before_reset: true,
    status_label: "Pace will exhaust before reset",
  }, 1_100_000);

  /* Pace belongs to the window it was measured in: an assumed-fresh 100%
     window has no observed usage, so its pace is unknown — never red. */
  assert.equal(projected.remaining_percent, 100);
  assert.equal(projected.pace_status, "unknown");
  assert.equal(projected.pace_delta_percent, null);
  assert.equal(projected.pace_exhausts_before_reset, false);
  assert.equal(projected.status_label, "");
});

test("a live mid-window sample keeps its pace verdict", () => {
  const projected = projectProviderLimitForDisplay({
    ...knownClaudeSession,
    display_percent: 16,
    display_percent_kind: "remaining",
    reset_at: "unix:2000",
    pace_status: "over_pace",
    pace_delta_percent: 43,
  }, 1_100_000);

  assert.equal(projected.pace_status, "over_pace");
  assert.equal(projected.pace_delta_percent, 43);
});

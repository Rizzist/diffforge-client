import assert from "node:assert/strict";
import test from "node:test";
import {
  mergeProviderLimitRowsForDisplay,
  mergeProviderLimits,
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

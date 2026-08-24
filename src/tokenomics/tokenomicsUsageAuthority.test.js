import test from "node:test";
import assert from "node:assert/strict";

import { tokenomicsUsageAuthorityPresentation } from "./tokenomicsUsageAuthority.js";

function assertNotHealthyZero(presentation) {
  assert.equal(presentation.healthy, false);
  assert.equal(presentation.remaining_percent, null);
  assert.equal(presentation.used_percent, null);
  assert.equal(presentation.display_percent, null);
}

test("daemon meter Unavailable preserves its reason and is not a healthy zero", () => {
  const presentation = tokenomicsUsageAuthorityPresentation({
    usage_authority: { state: "available" },
    meter_states: [{ agent_kind: "codex", state: "unavailable", reason: "oauth refresh failed" }],
  }, "codex", "5_hour");

  assert.equal(presentation.state, "unavailable");
  assert.equal(presentation.detail, "oauth refresh failed");
  assertNotHealthyZero(presentation);
});

test("daemon LocalOnly is distinct from Unavailable and has no server reading", () => {
  const presentation = tokenomicsUsageAuthorityPresentation({
    usage_authority: { state: "available" },
    meter_states: [{ provider: "opencode", state: "local_only" }],
  }, "opencode", "weekly");

  assert.equal(presentation.state, "local_only");
  assert.match(presentation.detail, /no server meter/i);
  assertNotHealthyZero(presentation);
});

test("an absent daemon report renders unknown, distinct from Unavailable and LocalOnly", () => {
  const presentation = tokenomicsUsageAuthorityPresentation({
    usage_authority: { state: "unknown", reason: "report_missing" },
    meter_states: [],
  }, "codex", "weekly");

  assert.equal(presentation.state, "unknown");
  assert.equal(presentation.detail, "report_missing");
  assertNotHealthyZero(presentation);
});

test("missing Haider Code percent_remaining is unknown even when other allowance fields exist", () => {
  const presentation = tokenomicsUsageAuthorityPresentation({
    usage_authority: { state: "available" },
    haider_code_plan_status: {
      supported: true,
      known: true,
      outcome: {
        state: "available",
        snapshot: {
          weekly_allowance: {
            state: "ok",
            resets_at_ms: 1_800_000,
            grace_until_ms: 1_900_000,
          },
        },
      },
    },
  }, "haider-code", "weekly");

  assert.equal(presentation.state, "unknown");
  assert.match(presentation.detail, /did not publish/i);
  assertNotHealthyZero(presentation);
});

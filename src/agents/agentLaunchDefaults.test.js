import test from "node:test";
import assert from "node:assert/strict";

import {
  agentLaunchModelSupportsFast,
  getAgentLaunchDefault,
  normalizeAgentLaunchDefaults,
} from "./agentLaunchDefaults.js";

test("normalizes built-in provider launch defaults", () => {
  const defaults = normalizeAgentLaunchDefaults({});

  assert.equal(getAgentLaunchDefault("codex", defaults).model, "gpt-5.5");
  assert.equal(getAgentLaunchDefault("codex", defaults).effort, "medium");
  assert.equal(getAgentLaunchDefault("claude", defaults).model, "sonnet");
  assert.equal(getAgentLaunchDefault("opencode", defaults).model, "anthropic/claude-sonnet-4-5");
});

test("keeps fast speed only on supported Codex and Claude models", () => {
  assert.equal(agentLaunchModelSupportsFast("codex", "gpt-5.5"), true);
  assert.equal(agentLaunchModelSupportsFast("codex", "gpt-5.4"), true);
  assert.equal(agentLaunchModelSupportsFast("codex", "gpt-5.4-mini"), false);
  assert.equal(agentLaunchModelSupportsFast("claude", "opus"), true);
  assert.equal(agentLaunchModelSupportsFast("claude", "sonnet"), false);
});

test("falls back to standard speed when saved fast mode no longer applies", () => {
  const defaults = normalizeAgentLaunchDefaults({
    providers: {
      codex: {
        effort: "high",
        model: "gpt-5.4-mini",
        speed: "fast",
      },
    },
  });

  assert.deepEqual(getAgentLaunchDefault("codex", defaults), {
    effort: "high",
    model: "gpt-5.4-mini",
    speed: "standard",
  });
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  agentLaunchModelSupportsFast,
  getAgentLaunchDefault,
  getAgentLaunchEffortOptions,
  getAgentLaunchModelOptions,
  normalizeAgentLaunchEffort,
  normalizeAgentLaunchDefaults,
} from "./agentLaunchDefaults.js";
import { buildAgentChatChangeEffortCommand } from "./agentRemoteConfig.js";

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

test("merges live agent model catalog ahead of launch baseline", () => {
  const options = getAgentLaunchModelOptions("codex", {
    complete: true,
    models: [
      {
        agent_kind: "codex",
        display_name: "GPT-5.6 Sol",
        id: "gpt-5.6-sol",
        source: "harness_api",
        speed_modes: ["standard", "fast"],
        supports_images: true,
      },
      {
        agent_kind: "codex",
        display_name: "Hidden",
        hidden: true,
        id: "hidden-model",
      },
      {
        agent_kind: "claude",
        display_name: "Wrong Agent",
        id: "sonnet",
      },
    ],
  });

  assert.equal(options[0].value, "gpt-5.6-sol");
  assert.equal(options[0].label, "GPT-5.6 Sol");
  assert.equal(options.some((option) => option.value === "hidden-model"), false);
  assert.equal(options.some((option) => option.value === "gpt-5.5"), true);
  assert.equal(agentLaunchModelSupportsFast("codex", "gpt-5.6-sol", {
    models: [{ agent_kind: "codex", id: "gpt-5.6-sol", speed_modes: ["fast"] }],
  }), true);
});

test("uses catalog reasoning efforts before built-in effort fallback", () => {
  const catalog = {
    complete: true,
    models: [
      {
        agent_kind: "codex",
        display_name: "GPT-5.6 Sol",
        id: "gpt-5.6-sol",
        reasoning_efforts: ["low", "medium", "ultra"],
      },
    ],
  };
  const options = getAgentLaunchEffortOptions("codex", "gpt-5.6-sol", catalog);

  assert.deepEqual(options.map((option) => option.value), ["low", "medium", "ultra"]);
  assert.equal(normalizeAgentLaunchEffort("codex", "gpt-5.6-sol", "ultra", catalog), "ultra");
  assert.deepEqual(
    getAgentLaunchEffortOptions("codex", "gpt-unknown").map((option) => option.value),
    ["low", "medium", "high", "xhigh"],
  );
});

test("builds change-effort command for catalog-only ultra effort", () => {
  const built = buildAgentChatChangeEffortCommand({
    currentModel: "gpt-5.6-sol",
    effortValues: ["low", "medium", "ultra"],
    provider: "codex",
    requestedEffort: "ultra",
  });

  assert.equal(built.error, undefined);
  assert.equal(built.command, "/model gpt-5.6-sol ultra");
  assert.equal(built.recordReasoningEffort, "ultra");
  assert.equal(built.reasoning_effort, "ultra");
});

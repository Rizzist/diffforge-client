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

test("uses an honest empty Haider default until the daemon publishes a model", () => {
  const defaults = normalizeAgentLaunchDefaults({});

  assert.deepEqual(getAgentLaunchDefault("haider", defaults), {
    effort: "default",
    model: "",
    speed: "standard",
  });
  assert.equal(getAgentLaunchDefault("codex", defaults).model, "");
});

test("fast speed exists only when the Haider catalog publishes it", () => {
  assert.equal(agentLaunchModelSupportsFast("haider", "published-model"), false);
  assert.equal(agentLaunchModelSupportsFast("haider", "published-model", {
    models: [{ agent_kind: "haider", id: "published-model", speed_modes: ["fast"] }],
  }), true);
});

test("falls back to standard speed when saved fast mode no longer applies", () => {
  const defaults = normalizeAgentLaunchDefaults({
    providers: {
      haider: {
        effort: "high",
        model: "published-model",
        speed: "fast",
      },
    },
  });

  assert.deepEqual(getAgentLaunchDefault("haider", defaults), {
    effort: "default",
    model: "published-model",
    speed: "standard",
  });
});

test("renders only models published by the Haider catalog", () => {
  const options = getAgentLaunchModelOptions("haider", {
    complete: true,
    models: [
      {
        agent_kind: "haider",
        display_name: "Published Model",
        id: "published-model",
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
        agent_kind: "other",
        display_name: "Wrong Agent",
        id: "wrong-model",
      },
    ],
  });

  assert.equal(options[0].value, "published-model");
  assert.equal(options[0].label, "Published Model");
  assert.equal(options.some((option) => option.value === "hidden-model"), false);
  assert.equal(options.some((option) => option.value === "wrong-model"), false);
  assert.equal(agentLaunchModelSupportsFast("haider", "published-model", {
    models: [{ agent_kind: "haider", id: "published-model", speed_modes: ["fast"] }],
  }), true);
});

test("uses catalog reasoning efforts before built-in effort fallback", () => {
  const catalog = {
    complete: true,
    models: [
      {
        agent_kind: "haider",
        display_name: "Published Model",
        id: "published-model",
        reasoning_efforts: ["low", "medium", "ultra"],
      },
    ],
  };
  const options = getAgentLaunchEffortOptions("haider", "published-model", catalog);

  assert.deepEqual(options.map((option) => option.value), ["low", "medium", "ultra"]);
  assert.equal(normalizeAgentLaunchEffort("haider", "published-model", "ultra", catalog), "ultra");
  assert.deepEqual(
    getAgentLaunchEffortOptions("haider", "unknown-model").map((option) => option.value),
    ["default"],
  );
});

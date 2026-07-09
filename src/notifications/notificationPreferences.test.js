import assert from "node:assert/strict";
import test from "node:test";

import {
  loopspaceOverrideSelectValue,
  loopspaceOverrideValueFromSelect,
  normalizeNotificationPreferences,
  setLoopspaceNotificationOverride,
  setNotificationPreferencePushValue,
} from "./notificationPreferences.js";

test("notification prefs normalize defaults and canonical snake case", () => {
  const prefs = normalizeNotificationPreferences({
    notificationPreferences: {
      version: 7,
      push: {
        uirPrompts: false,
        loopRunStarted: true,
        loop_run_completed: false,
        customChannel: "kept",
      },
      loopspaceOverrides: {
        "loop-1": {
          started: "on",
          completed: "inherit",
          failed: "off",
          blocked: true,
          webOnly: "kept",
        },
      },
      updatedAtMs: "42",
      futureTopLevel: { kept: true },
    },
  });

  assert.equal(prefs.version, 1);
  assert.equal(prefs.updated_at_ms, 42);
  assert.deepEqual(prefs.push, {
    customChannel: "kept",
    uir_prompts: false,
    loop_run_started: true,
    loop_run_completed: false,
    loop_run_failed: true,
    loop_run_blocked: true,
    awaiting_device: true,
    account_events: true,
  });
  assert.deepEqual(prefs.loopspace_overrides["loop-1"], {
    webOnly: "kept",
    started: true,
    completed: null,
    failed: false,
    blocked: true,
  });
  assert.deepEqual(prefs.futureTopLevel, { kept: true });
  assert.equal(Object.hasOwn(prefs, "updatedAtMs"), false);
  assert.equal(Object.hasOwn(prefs, "loopspaceOverrides"), false);
});

test("notification prefs update account push values without losing unknown keys", () => {
  const prefs = setNotificationPreferencePushValue({
    push: { unknown: "preserve", loopRunFailed: false },
    extra: 1,
  }, "loop_run_failed", true, 1000);

  assert.equal(prefs.updated_at_ms, 1000);
  assert.equal(prefs.extra, 1);
  assert.equal(prefs.push.unknown, "preserve");
  assert.equal(prefs.push.loop_run_failed, true);
});

test("notification prefs update loopspace overrides as tri-state values", () => {
  const prefs = setLoopspaceNotificationOverride({
    loopspace_overrides: {
      "loop-1": { started: true, custom: "preserve" },
    },
  }, "loop-1", "completed", "off", 2000);

  assert.equal(prefs.updated_at_ms, 2000);
  assert.deepEqual(prefs.loopspace_overrides["loop-1"], {
    custom: "preserve",
    started: true,
    completed: false,
    failed: null,
    blocked: null,
  });
  assert.equal(loopspaceOverrideSelectValue(prefs.loopspace_overrides["loop-1"].completed), "off");
  assert.equal(loopspaceOverrideSelectValue(null), "inherit");
  assert.equal(loopspaceOverrideValueFromSelect("on"), true);
  assert.equal(loopspaceOverrideValueFromSelect("inherit"), null);
});

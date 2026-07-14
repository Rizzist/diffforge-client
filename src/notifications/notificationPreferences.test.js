import assert from "node:assert/strict";
import test from "node:test";

import {
  loopspaceOverrideSelectValue,
  loopspaceOverrideValueFromSelect,
  normalizeNotificationPreferences,
  notificationPreferencesLoadRetryDelayMs,
  notificationPreferencesSnapshotCanReplaceLocalEdit,
  pruneNotificationPreferenceLoopspaceOverrides,
  setLoopspaceNotificationOverride,
  setNotificationPreferencePushValue,
} from "./notificationPreferences.js";

test("notification prefs normalize defaults and canonical snake case", () => {
  const prefs = normalizeNotificationPreferences({
    notification_preferences: {
      version: 7,
      push: {
        uir_prompts: false,
        loop_run_started: true,
        loop_run_completed: false,
        custom_channel: "kept",
      },
      loopspace_overrides: {
        "loop-1": {
          started: "on",
          completed: "inherit",
          failed: "off",
          blocked: true,
          web_only: "kept",
        },
      },
      updated_at_ms: "42",
      futureTopLevel: { kept: true },
    },
  });

  assert.equal(prefs.version, 1);
  assert.equal(prefs.updated_at_ms, 42);
  assert.deepEqual(prefs.push, {
    custom_channel: "kept",
    uir_prompts: false,
    todo_started: true,
    todo_completed: true,
    loop_run_started: true,
    loop_run_completed: false,
    loop_run_failed: true,
    loop_run_blocked: true,
    awaiting_device: true,
    account_events: true,
  });
  assert.deepEqual(prefs.loopspace_overrides["loop-1"], {
    web_only: "kept",
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
    push: { unknown: "preserve", loop_run_failed: false },
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

test("notification prefs reject load and event snapshots not newer than an in-flight edit", () => {
  assert.equal(notificationPreferencesSnapshotCanReplaceLocalEdit({ updated_at_ms: 99 }, 100), false);
  assert.equal(notificationPreferencesSnapshotCanReplaceLocalEdit({ updated_at_ms: 100 }, 100), false);
  assert.equal(notificationPreferencesSnapshotCanReplaceLocalEdit({ updated_at_ms: 101 }, 100), true);
  assert.equal(notificationPreferencesSnapshotCanReplaceLocalEdit({ updated_at_ms: 0 }, 0), true);
});

test("notification prefs load retry uses bounded backoff", () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map(notificationPreferencesLoadRetryDelayMs),
    [500, 1_500, 5_000, null, null],
  );
});

test("notification prefs prune overrides for deleted loopspaces", () => {
  const preferences = pruneNotificationPreferenceLoopspaceOverrides({
    updated_at_ms: 500,
    loopspace_overrides: {
      "loop-live": { started: true },
      "loop-deleted": { completed: false },
    },
  }, [{ id: "loop-live" }, { loopspace_id: "loop-other" }]);

  assert.equal(preferences.updated_at_ms, 500);
  assert.deepEqual(Object.keys(preferences.loopspace_overrides), ["loop-live"]);
  assert.equal(preferences.loopspace_overrides["loop-live"].started, true);
});

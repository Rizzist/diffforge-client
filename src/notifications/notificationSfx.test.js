import assert from "node:assert/strict";
import test from "node:test";

import { resolveNotificationSfxTone } from "./notificationSfx.js";

test("distinct event kinds resolve to distinct tones", () => {
  assert.equal(resolveNotificationSfxTone("voice.on"), "voiceOn");
  assert.equal(resolveNotificationSfxTone("voice.off"), "voiceOff");
  assert.equal(resolveNotificationSfxTone("todo.arrived"), "arrive");
  assert.equal(resolveNotificationSfxTone("todo.queue.drained"), "drained");
  assert.equal(resolveNotificationSfxTone("snip.captured"), "shutter");
  assert.equal(resolveNotificationSfxTone("approval.required"), "attention");
  assert.equal(resolveNotificationSfxTone("user.input.required"), "attention");
  assert.equal(resolveNotificationSfxTone("all.done"), "fanfare");
  assert.equal(resolveNotificationSfxTone("agent.failed"), "alert");
  assert.equal(resolveNotificationSfxTone("tool.failed"), "alert");
  assert.equal(resolveNotificationSfxTone("task.parked"), "soft");
});

test("underscore and case variants normalize to the same tone", () => {
  assert.equal(resolveNotificationSfxTone("approval_required"), "attention");
  assert.equal(resolveNotificationSfxTone("ALL.DONE"), "fanfare");
  assert.equal(resolveNotificationSfxTone("task.resume_ready"), "ready");
});

test("unknown kinds fall back to the generic ready tone", () => {
  assert.equal(resolveNotificationSfxTone(""), "ready");
  assert.equal(resolveNotificationSfxTone(null), "ready");
  assert.equal(resolveNotificationSfxTone("coordination.event"), "ready");
  assert.equal(resolveNotificationSfxTone("terminal.ready"), "ready");
});

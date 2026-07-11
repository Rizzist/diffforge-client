import assert from "node:assert/strict";
import test from "node:test";

import {
  TODO_QUEUE_COMPOSER_IDLE_BEFORE_SEND_MS,
  getTodoQueueComposerTargetAvailability,
} from "./todoQueueComposerGate.js";

const NOW_MS = Date.parse("2026-06-06T12:00:00.000Z");

test("composer gate blocks non-empty terminal input", () => {
  const result = getTodoQueueComposerTargetAvailability({
    source: "terminal_input_observed",
    updated_at: "2026-06-06T11:59:30.000Z",
    value: "do not overwrite this",
  }, { now_ms: NOW_MS });

  assert.equal(result.available, false);
  assert.equal(result.reason, "composer_draft_present");
});

test("composer gate waits after recently cleared human input", () => {
  const result = getTodoQueueComposerTargetAvailability({
    source: "terminal_input_observed",
    updated_at: new Date(NOW_MS - 10_000).toISOString(),
    value: "",
  }, { now_ms: NOW_MS });

  assert.equal(result.available, false);
  assert.equal(result.reason, "composer_recently_active");
});

test("composer gate allows empty human input after the idle window", () => {
  const result = getTodoQueueComposerTargetAvailability({
    source: "bigview_sync_after_delta",
    updated_at: new Date(NOW_MS - TODO_QUEUE_COMPOSER_IDLE_BEFORE_SEND_MS - 1).toISOString(),
    value: "",
  }, { now_ms: NOW_MS });

  assert.equal(result.available, true);
});

test("composer gate allows recent queue-owned clears", () => {
  const result = getTodoQueueComposerTargetAvailability({
    source: "todo_queue_submit_accepted_clear",
    updated_at: new Date(NOW_MS - 5_000).toISOString(),
    value: "",
  }, { now_ms: NOW_MS });

  assert.equal(result.available, true);
});

test("composer gate allows empty input with no edit timestamp", () => {
  const result = getTodoQueueComposerTargetAvailability({
    source: "",
    updated_at: "",
    value: "",
  }, { now_ms: NOW_MS });

  assert.equal(result.available, true);
});

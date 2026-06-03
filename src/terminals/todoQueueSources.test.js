import assert from "node:assert/strict";
import test from "node:test";

import {
  TODO_QUEUE_SOURCE_REMOTE_CONTROL,
  TODO_QUEUE_SOURCE_TODO_AUTO,
  TODO_QUEUE_SOURCE_VOICE_AGENT,
  TODO_QUEUE_SOURCE_VOICE_PLAN,
  getTodoQueueAutoQueueSourceForSource,
  getTodoQueueLifecycleSourceForSource,
  getTodoQueuePromptEventSourceForSource,
} from "./todoQueueSources.js";

test("remote control source is preserved through queued auto dispatch", () => {
  assert.equal(
    getTodoQueueAutoQueueSourceForSource({ source: TODO_QUEUE_SOURCE_REMOTE_CONTROL }),
    TODO_QUEUE_SOURCE_REMOTE_CONTROL,
  );
});

test("remote control source gets a distinct prompt event source", () => {
  assert.equal(
    getTodoQueuePromptEventSourceForSource({ source: TODO_QUEUE_SOURCE_REMOTE_CONTROL }),
    "remote-control",
  );
});

test("remote control source is preserved for lifecycle events", () => {
  assert.equal(
    getTodoQueueLifecycleSourceForSource({ source: TODO_QUEUE_SOURCE_REMOTE_CONTROL }),
    TODO_QUEUE_SOURCE_REMOTE_CONTROL,
  );
});

test("known todo queue sources keep their existing mappings", () => {
  assert.equal(
    getTodoQueueAutoQueueSourceForSource({ source: TODO_QUEUE_SOURCE_VOICE_AGENT }),
    TODO_QUEUE_SOURCE_VOICE_AGENT,
  );
  assert.equal(
    getTodoQueueAutoQueueSourceForSource({ source: TODO_QUEUE_SOURCE_VOICE_PLAN }),
    TODO_QUEUE_SOURCE_VOICE_PLAN,
  );
  assert.equal(
    getTodoQueueAutoQueueSourceForSource({ source: "manual-drop" }),
    TODO_QUEUE_SOURCE_TODO_AUTO,
  );
  assert.equal(
    getTodoQueueLifecycleSourceForSource({ source: "manual-drop" }),
    "tui-todo-drop",
  );
});

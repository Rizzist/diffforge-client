import assert from "node:assert/strict";
import test from "node:test";

import {
  TODO_QUEUE_SOURCE_REMOTE_CONTROL,
  TODO_QUEUE_SOURCE_TERMINAL_DIRECT,
  TODO_QUEUE_SOURCE_TODO_AUTO,
  TODO_QUEUE_SOURCE_VOICE_AGENT,
  TODO_QUEUE_SOURCE_VOICE_PLAN,
  getTodoQueueAutoQueueSourceForSource,
  getTodoQueueDirectTargetTerminalIndexCandidate,
  getTodoQueueTerminalTargetIdCandidate,
  getTodoQueueLifecycleSourceForSource,
  getTodoQueuePromptEventSourceForSource,
  todoQueueRemoteCommandIsListOnly,
} from "./todoQueueSources.js";

test("generic web todo bookkeeping index is not treated as an explicit terminal target", () => {
  assert.equal(
    getTodoQueueDirectTargetTerminalIndexCandidate({
      terminal_index: 0,
      target_explicit: false,
    }),
    undefined,
  );
  assert.equal(
    getTodoQueueDirectTargetTerminalIndexCandidate({ target_terminal_index: 2 }),
    undefined,
  );
  assert.equal(
    getTodoQueueDirectTargetTerminalIndexCandidate({
      target_terminal_id: "pane-1",
      terminal_index: 1,
    }),
    1,
  );
  assert.equal(
    getTodoQueueTerminalTargetIdCandidate({
      remoteCommand: { paneId: "pane-2" },
    }),
    "pane-2",
  );
});

test("Next todo_create defaults to list-only instead of auto-queueing", () => {
  assert.equal(todoQueueRemoteCommandIsListOnly({ command_kind: "todo_create" }), true);
  assert.equal(todoQueueRemoteCommandIsListOnly({ command_kind: "todo_create", status: "listed" }), true);
  assert.equal(todoQueueRemoteCommandIsListOnly({ command_kind: "todo_create", status: "queued" }), false);
});

test("explicit listed status stays list-only for compatible remote commands", () => {
  assert.equal(todoQueueRemoteCommandIsListOnly({ command_kind: "create_task", status: "listed" }), true);
  assert.equal(todoQueueRemoteCommandIsListOnly({ command_kind: "create_task", status: "running" }), false);
});

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
    getTodoQueueAutoQueueSourceForSource({ source: TODO_QUEUE_SOURCE_TERMINAL_DIRECT }),
    TODO_QUEUE_SOURCE_TERMINAL_DIRECT,
  );
  assert.equal(
    getTodoQueuePromptEventSourceForSource({ source: TODO_QUEUE_SOURCE_TERMINAL_DIRECT }),
    "terminal-direct-input",
  );
  assert.equal(
    getTodoQueueLifecycleSourceForSource({ source: TODO_QUEUE_SOURCE_TERMINAL_DIRECT }),
    TODO_QUEUE_SOURCE_TERMINAL_DIRECT,
  );
  assert.equal(
    getTodoQueueAutoQueueSourceForSource({ source: TODO_QUEUE_SOURCE_VOICE_PLAN }),
    TODO_QUEUE_SOURCE_VOICE_PLAN,
  );
  assert.equal(
    getTodoQueuePromptEventSourceForSource({ source: TODO_QUEUE_SOURCE_TODO_AUTO }),
    "todo-auto-queue",
  );
  assert.equal(
    getTodoQueuePromptEventSourceForSource({ source: "tui-todo-drop" }),
    "terminal-view-drop",
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

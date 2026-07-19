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
  normalizeTodoQueueTerminalReceipts,
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

test("sessionless restarted terminal does not claim stale running todo receipt", () => {
  const items = normalizeTodoQueueTerminalReceipts({
    "cmd-1": {
      command_id: "cmd-1",
      item_id: "todo-1",
      pane_id: "workspace-terminal-ws-0-claude",
      provider_session_id: "old-provider-session",
      received_at_ms: 1000,
      status: "running",
      text: "Still displayed as history",
    },
  }, "workspace-terminal-ws-0-claude", {
    instance_id: "new-instance",
    session_id: "",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].is_current, false);
  assert.equal(items[0].status, "interrupted");
  assert.equal(items[0].original_status, "running");
  assert.equal(items[0].stale_active, true);
});

test("running todo receipt is current only for matching live provider session", () => {
  const items = normalizeTodoQueueTerminalReceipts({
    "cmd-1": {
      command_id: "cmd-1",
      item_id: "todo-1",
      pane_id: "workspace-terminal-ws-0-claude",
      provider_session_id: "live-provider-session",
      received_at_ms: 1000,
      status: "running",
      terminal_instance_id: "instance-1",
      text: "Live todo",
    },
  }, "workspace-terminal-ws-0-claude", {
    instance_id: "instance-1",
    session_id: "live-provider-session",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].is_current, true);
  assert.equal(items[0].status, "running");
  assert.equal(items[0].stale_active, false);
});

test("identity-less direct-prompt receipt stays bound to the pane as current", () => {
  // Direct typed prompts record neither session nor instance identity: the
  // backend capture receipt only carries command/item/pane/status/text. It
  // must NOT be rewritten to interrupted while the turn runs.
  const items = normalizeTodoQueueTerminalReceipts({
    "cmd-direct": {
      command_id: "cmd-direct",
      item_id: "todo-direct",
      pane_id: "workspace-terminal-ws-0-claude",
      received_at_ms: 1000,
      status: "running",
      text: "Typed straight into the terminal",
    },
  }, "workspace-terminal-ws-0-claude", {
    instance_id: "instance-1",
    session_id: "live-provider-session",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].is_current, true);
  assert.equal(items[0].status, "running");
  assert.equal(items[0].original_status, "");
  assert.equal(items[0].stale_active, false);
});

test("receipt carrying a mismatching session is interrupted even without instance identity", () => {
  const items = normalizeTodoQueueTerminalReceipts({
    "cmd-stale": {
      command_id: "cmd-stale",
      item_id: "todo-stale",
      pane_id: "workspace-terminal-ws-0-claude",
      provider_session_id: "other-provider-session",
      received_at_ms: 1000,
      status: "running",
      text: "Belongs to another session",
    },
  }, "workspace-terminal-ws-0-claude", {
    instance_id: "instance-1",
    session_id: "live-provider-session",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].is_current, false);
  assert.equal(items[0].status, "interrupted");
  assert.equal(items[0].stale_active, true);
});

test("identity-less receipt on a restarted sessionless terminal stays current", () => {
  // The receipt itself names no session or instance, so a restarted live
  // terminal (no session yet, fresh instance) is not evidence of staleness.
  const items = normalizeTodoQueueTerminalReceipts({
    "cmd-direct": {
      command_id: "cmd-direct",
      item_id: "todo-direct",
      pane_id: "workspace-terminal-ws-0-claude",
      received_at_ms: 1000,
      status: "running",
      text: "Typed straight into the terminal",
    },
  }, "workspace-terminal-ws-0-claude", {
    instance_id: "new-instance",
    session_id: "",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].is_current, true);
  assert.equal(items[0].status, "running");
  assert.equal(items[0].stale_active, false);
});

test("superseded requeue receipt keeps rendering as history, never as current", () => {
  // A requeue keeps the previous attempt's settled receipt in the ledger
  // (Plans history) stamped superseded: it renders with its settled outcome
  // plus the superseded flag, and must never read as the current attempt.
  const items = normalizeTodoQueueTerminalReceipts({
    "cmd-requeued": {
      command_id: "cmd-requeued",
      item_id: "todo-requeued",
      pane_id: "workspace-terminal-ws-0-claude",
      received_at_ms: 1000,
      status: "completed",
      status_superseded_at: "2026-07-19T00:00:00Z",
      superseded_by_attempt_seq: 1,
      text: "First attempt, since re-queued",
    },
    "cmd-live": {
      command_id: "cmd-live",
      item_id: "todo-live",
      pane_id: "workspace-terminal-ws-0-claude",
      received_at_ms: 2000,
      status: "running",
      text: "Second attempt running",
    },
  }, "workspace-terminal-ws-0-claude", {
    instance_id: "instance-1",
    session_id: "",
  });

  assert.equal(items.length, 2);
  const superseded = items.find((item) => item.command_id === "cmd-requeued");
  const live = items.find((item) => item.command_id === "cmd-live");
  assert.equal(superseded.superseded, true);
  assert.equal(superseded.status, "completed");
  assert.equal(superseded.is_current, false);
  assert.equal(superseded.stale_active, false);
  assert.equal(live.superseded, false);
  assert.equal(live.is_current, true);
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

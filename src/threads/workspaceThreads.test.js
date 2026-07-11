import assert from "node:assert/strict";
import test from "node:test";

import {
  appendWorkspaceThreadProjectionEvents,
  applyWorkspaceThreadProviderSessionBinding,
  bindWorkspaceThreadTerminal,
  buildWorkspaceThreadsPersistDelta,
  clearWorkspaceThreadsPersistDirtySnapshot,
  clearWorkspaceThreadPendingPrompt,
  createWorkspaceThreadLiveTextProjectionEvents,
  createWorkspaceThreadToolProjectionEvents,
  deleteWorkspaceThread,
  ensureWorkspaceThreadsForTerminalIndexes,
  getWorkspaceThreadsPersistDirtySnapshot,
  getWorkspaceThreadForTerminalIndex,
  getWorkspaceThreadSelectionForLiveTerminal,
  getWorkspaceThreadTerminalNickname,
  hydrateWorkspaceThreadSessionTranscript,
  markWorkspaceThreadAgentActivity,
  markWorkspaceThreadTerminalDetached,
  materializeWorkspaceThreadForTerminal,
  mergeHydratedWorkspaceThreads,
  normalizeWorkspaceThreads,
  persistWorkspaceThreads,
  resetWorkspaceThreadsPersistDirty,
  updateWorkspaceActiveTerminal,
  updateWorkspaceThreadProviderSession,
  updateWorkspaceThreadProviderModel,
} from "./workspaceThreads.js";

function createPersistDirtyTestState() {
  const workspaceId = "workspace-dirty-persist";
  return {
    [workspaceId]: {
      active_thread_id: "thread-a",
      archived_thread_order: ["thread-archived"],
      archived_threads: {
        "thread-archived": {
          archivedAt: "2026-07-01T00:00:00.000Z",
          current_agent: "codex",
          id: "thread-archived",
          materialized: true,
          message_count: 1,
          messages: [{
            created_at: "2026-07-01T00:00:00.000Z",
            id: "archived-message",
            role: "user",
            text: "archived prompt",
          }],
          provider_bindings: {
            codex: {
              native_session_id: "session-archived",
            },
          },
          workspace_id: workspaceId,
        },
      },
      terminal_thread_ids: {},
      terminals: {},
      thread_order: ["thread-a", "thread-b"],
      threads: {
        "thread-a": {
          current_agent: "codex",
          id: "thread-a",
          materialized: true,
          message_count: 1,
          messages: [{
            created_at: "2026-07-01T00:00:00.000Z",
            id: "message-a",
            role: "user",
            text: "first prompt",
          }],
          provider_bindings: {
            codex: {
              native_session_id: "session-a",
            },
          },
          status: "idle",
          workspace_id: workspaceId,
        },
        "thread-b": {
          current_agent: "codex",
          id: "thread-b",
          materialized: true,
          message_count: 1,
          messages: [{
            created_at: "2026-07-01T00:01:00.000Z",
            id: "message-b",
            role: "user",
            text: "second prompt",
          }],
          provider_bindings: {
            codex: {
              native_session_id: "session-b",
            },
          },
          status: "idle",
          workspace_id: workspaceId,
        },
      },
      threads_view: {
        selectedThreadId: "thread-a",
        selected_workspace_id: workspaceId,
      },
    },
  };
}

function legacyHydratedWorkspaceThreadsMerge(currentThreads, loadedThreads, targets, ensureTargets = []) {
  const targetIds = new Set(targets.map((target) => target.workspace_id));
  const normalizedCurrent = normalizeWorkspaceThreads(currentThreads);
  let mergedThreads = Object.fromEntries(
    Object.entries(normalizedCurrent).filter(([workspaceId]) => targetIds.has(workspaceId)),
  );
  targets.forEach((target) => {
    if (loadedThreads[target.workspace_id]) {
      mergedThreads[target.workspace_id] = loadedThreads[target.workspace_id];
    }
  });
  ensureTargets.forEach((ensureTarget) => {
    mergedThreads = ensureWorkspaceThreadsForTerminalIndexes(mergedThreads, ensureTarget);
  });
  return mergedThreads;
}

function deletePersistedMessageProjectionHashes(threads) {
  const clone = JSON.parse(JSON.stringify(threads));
  Object.values(clone).forEach((entry) => {
    [entry?.threads, entry?.archived_threads].forEach((rows) => {
      Object.values(rows || {}).forEach((thread) => {
        (Array.isArray(thread.messages) ? thread.messages : []).forEach((message) => {
          delete message.projection_hash;
          delete message.stable_projection_hash;
        });
      });
    });
  });
  return clone;
}

test("hydrated workspace thread merge matches legacy output without normalizing non-target state", () => {
  const targets = [
    { workspace_id: "workspace-loaded" },
    { workspace_id: "workspace-current" },
  ];
  const ensureTargets = [{
    fallbackAgent: "codex",
    rolesByIndex: { 0: "codex" },
    terminal_indexes: [0],
    workspace_id: "workspace-current",
  }];
  const currentThreads = {
    "workspace-loaded": {
      active_thread_id: "thread-old",
      thread_order: ["thread-old"],
      threads: {
        "thread-old": {
          current_agent: "codex",
          id: "thread-old",
          materialized: true,
          messages: [{
            id: "message-old",
            role: "user",
            text: "this current entry is replaced by SQLite",
          }],
          workspace_id: "workspace-loaded",
        },
      },
    },
    "workspace-current": {
      active_thread_id: "thread-current",
      terminal_order: ["0"],
      terminal_thread_ids: { 0: "thread-current" },
      terminals: {
        0: {
          agent_id: "codex",
          display_name: "Ada",
          last_active_at: "2026-07-01T00:00:00.000Z",
          status: "idle",
          terminal_name: "Ada",
          terminal_nickname: "Ada",
          terminal_index: 0,
          thread_id: "thread-current",
          updated_at: "2026-07-01T00:00:00.000Z",
        },
      },
      thread_order: ["thread-current"],
      threads: {
        "thread-current": {
          created_at: "2026-07-01T00:00:00.000Z",
          current_agent: "codex",
          display_name: "Ada",
          id: "thread-current",
          last_active_at: "2026-07-01T00:00:00.000Z",
          materialized: true,
          messages: [{
            created_at: "2026-07-01T00:00:00.000Z",
            id: "message-current",
            role: "user",
            text: "retained current fallback",
          }],
          provider_bindings: {
            codex: {
              last_active_at: "2026-07-01T00:00:00.000Z",
              status: "idle",
              terminal_name: "Ada",
              terminal_nickname: "Ada",
              updated_at: "2026-07-01T00:00:00.000Z",
            },
          },
          status: "idle",
          terminal_name: "Ada",
          terminal_nickname: "Ada",
          terminal_index: 0,
          updated_at: "2026-07-01T00:00:00.000Z",
          workspace_id: "workspace-current",
        },
      },
    },
    "workspace-dropped": {
      active_thread_id: "thread-dropped",
      thread_order: ["thread-dropped"],
      threads: {
        "thread-dropped": {
          current_agent: "codex",
          id: "thread-dropped",
          materialized: true,
          messages: [{
            id: "message-dropped",
            role: "user",
            text: "non-target state must not survive hydration merge",
          }],
          workspace_id: "workspace-dropped",
        },
      },
    },
  };
  const loadedThreads = normalizeWorkspaceThreads({
    "workspace-loaded": {
      active_thread_id: "thread-loaded",
      thread_order: ["thread-loaded"],
      threads: {
        "thread-loaded": {
          current_agent: "codex",
          id: "thread-loaded",
          materialized: true,
          messages: [{
            created_at: "2026-07-01T00:01:00.000Z",
            id: "message-loaded",
            role: "user",
            text: "loaded from SQLite",
          }],
          status: "idle",
          workspace_id: "workspace-loaded",
        },
      },
    },
  }, { stripLiveBindings: true });

  const legacy = legacyHydratedWorkspaceThreadsMerge(
    currentThreads,
    loadedThreads,
    targets,
    ensureTargets,
  );
  const optimized = mergeHydratedWorkspaceThreads(currentThreads, loadedThreads, {
    ensureTargets,
    targets,
  });

  assert.deepEqual(optimized, legacy);
  assert.equal(optimized["workspace-loaded"].active_thread_id, "thread-loaded");
  assert.equal(optimized["workspace-current"].active_thread_id, "thread-current");
  assert.equal(optimized["workspace-dropped"], undefined);
});

test("persisted workspace thread messages carry projection hashes without changing normalized state", () => {
  const workspaceId = "workspace-projection-hash";
  const threadId = "thread-projection-hash";
  const state = {
    [workspaceId]: {
      active_thread_id: threadId,
      thread_order: [threadId],
      threads: {
        [threadId]: {
          current_agent: "codex",
          id: threadId,
          materialized: true,
          messages: [{
            created_at: "2026-07-01T00:00:00.000Z",
            id: "message-user-hash",
            role: "user",
            text: "summarize the repository",
          }, {
            created_at: "2026-07-01T00:00:01.000Z",
            id: "message-activity-hash",
            kind: "tool_call",
            role: "activity",
            text: "rg workspace_threads_read",
            tool_input: { pattern: "workspace_threads_read" },
            tool_name: "rg",
          }],
          status: "idle",
          workspace_id: workspaceId,
        },
      },
    },
  };

  const persisted = persistWorkspaceThreads(state);
  const persistedMessages = persisted[workspaceId].threads[threadId].messages;
  persistedMessages.forEach((message) => {
    assert.match(message.projection_hash, /^[a-z0-9]+$/);
  });

  const legacyPersisted = deletePersistedMessageProjectionHashes(persisted);
  assert.deepEqual(
    normalizeWorkspaceThreads(persisted),
    normalizeWorkspaceThreads(legacyPersisted),
  );

  const repersistedLegacy = persistWorkspaceThreads(normalizeWorkspaceThreads(legacyPersisted));
  repersistedLegacy[workspaceId].threads[threadId].messages.forEach((message) => {
    assert.match(message.projection_hash, /^[a-z0-9]+$/);
  });
});

test("stored projection hashes preserve message-bootstrap projection output", () => {
  const workspaceId = "workspace-projection-hash-bootstrap";
  const threadId = "thread-projection-hash-bootstrap";
  const persisted = persistWorkspaceThreads({
    [workspaceId]: {
      active_thread_id: threadId,
      thread_order: [threadId],
      threads: {
        [threadId]: {
          created_at: "2026-07-01T00:00:00.000Z",
          current_agent: "codex",
          id: threadId,
          last_active_at: "2026-07-01T00:00:00.000Z",
          materialized: true,
          messages: [{
            created_at: "2026-07-01T00:00:00.000Z",
            id: "message-user-bootstrap",
            role: "user",
            text: "run the frontend tests",
            turn_id: "turn-bootstrap",
          }, {
            created_at: "2026-07-01T00:00:01.000Z",
            id: "message-assistant-bootstrap",
            role: "assistant",
            status: "complete",
            text: "Tests passed.",
            turn_id: "turn-bootstrap",
          }],
          provider_bindings: {
            codex: {
              last_active_at: "2026-07-01T00:00:00.000Z",
              last_message_at: "2026-07-01T00:00:01.000Z",
              message_count: 2,
              status: "idle",
              updated_at: "2026-07-01T00:00:01.000Z",
            },
          },
          status: "idle",
          updated_at: "2026-07-01T00:00:01.000Z",
          workspace_id: workspaceId,
        },
      },
    },
  });
  const legacyPersisted = deletePersistedMessageProjectionHashes(persisted);
  const event = {
    agent_id: "codex",
    created_at: "2026-07-01T00:00:02.000Z",
    message_id: "turn-bootstrap",
    projection_events: [{
      created_at: "2026-07-01T00:00:02.000Z",
      message_id: "turn-bootstrap",
      status: "completed",
      turn_id: "turn-bootstrap",
      type: "thread.turn.completed",
    }],
    thread_id: threadId,
    workspace_id: workspaceId,
  };

  const withStoredHashes = appendWorkspaceThreadProjectionEvents(
    normalizeWorkspaceThreads(persisted),
    event,
  )[workspaceId].threads[threadId];
  const withoutStoredHashes = appendWorkspaceThreadProjectionEvents(
    normalizeWorkspaceThreads(legacyPersisted),
    event,
  )[workspaceId].threads[threadId];

  assert.deepEqual(withStoredHashes.messages, withoutStoredHashes.messages);
  assert.deepEqual(withStoredHashes.projection_events, withoutStoredHashes.projection_events);
});

test("workspace thread dirty tracking ignores semantic no-op mutations", () => {
  resetWorkspaceThreadsPersistDirty();
  const state = createPersistDirtyTestState();
  const previous = persistWorkspaceThreads(state);
  const next = updateWorkspaceThreadProviderModel(state, {
    agent_id: "codex",
    model_id: "",
    thread_id: "thread-a",
    workspace_id: "workspace-dirty-persist",
  });

  assert.equal(next, state);
  const dirtySnapshot = getWorkspaceThreadsPersistDirtySnapshot([{ workspace_id: "workspace-dirty-persist" }]);
  assert.deepEqual(dirtySnapshot.workspaces, {});

  const { request } = buildWorkspaceThreadsPersistDelta(
    next,
    previous,
    [{ workspace_id: "workspace-dirty-persist" }],
    { dirtySnapshot },
  );
  assert.deepEqual(request.workspaces, []);
});

test("workspace thread dirty tracking persists only marked thread rows", () => {
  resetWorkspaceThreadsPersistDirty();
  const state = createPersistDirtyTestState();
  const previous = persistWorkspaceThreads(state);
  const next = updateWorkspaceThreadProviderModel(state, {
    agent_id: "codex",
    model_id: "gpt-5",
    thread_id: "thread-a",
    workspace_id: "workspace-dirty-persist",
  });

  const dirtySnapshot = getWorkspaceThreadsPersistDirtySnapshot([{ workspace_id: "workspace-dirty-persist" }]);
  const { request } = buildWorkspaceThreadsPersistDelta(
    next,
    previous,
    [{ workspace_id: "workspace-dirty-persist" }],
    { dirtySnapshot },
  );

  assert.equal(request.workspaces.length, 1);
  assert.deepEqual(
    request.workspaces[0].threads.map((row) => row.thread_id),
    ["thread-a"],
  );
  assert.equal(request.workspaces[0].archived_threads, undefined);
});

test("workspace thread dirty tracking retains marks until successful clear", () => {
  resetWorkspaceThreadsPersistDirty();
  const state = createPersistDirtyTestState();
  updateWorkspaceThreadProviderModel(state, {
    agent_id: "codex",
    model_id: "gpt-5",
    thread_id: "thread-a",
    workspace_id: "workspace-dirty-persist",
  });

  const dirtySnapshot = getWorkspaceThreadsPersistDirtySnapshot([{ workspace_id: "workspace-dirty-persist" }]);
  assert.equal(
    dirtySnapshot.workspaces["workspace-dirty-persist"].threadVersions["thread-a"] > 0,
    true,
  );

  const retainedSnapshot = getWorkspaceThreadsPersistDirtySnapshot([{ workspace_id: "workspace-dirty-persist" }]);
  assert.equal(
    retainedSnapshot.workspaces["workspace-dirty-persist"].threadVersions["thread-a"],
    dirtySnapshot.workspaces["workspace-dirty-persist"].threadVersions["thread-a"],
  );
});

test("workspace thread dirty tracking preserves marks added during in-flight persist", () => {
  resetWorkspaceThreadsPersistDirty();
  const state = createPersistDirtyTestState();
  const first = updateWorkspaceThreadProviderModel(state, {
    agent_id: "codex",
    model_id: "gpt-5",
    thread_id: "thread-a",
    workspace_id: "workspace-dirty-persist",
  });
  const inFlightSnapshot = getWorkspaceThreadsPersistDirtySnapshot([{ workspace_id: "workspace-dirty-persist" }]);

  updateWorkspaceThreadProviderModel(first, {
    agent_id: "codex",
    model_id: "gpt-5.1",
    thread_id: "thread-b",
    workspace_id: "workspace-dirty-persist",
  });
  clearWorkspaceThreadsPersistDirtySnapshot(inFlightSnapshot);

  const remainingSnapshot = getWorkspaceThreadsPersistDirtySnapshot([{ workspace_id: "workspace-dirty-persist" }]);
  assert.equal(
    remainingSnapshot.workspaces["workspace-dirty-persist"].threadVersions["thread-a"],
    undefined,
  );
  assert.equal(
    remainingSnapshot.workspaces["workspace-dirty-persist"].threadVersions["thread-b"] > 0,
    true,
  );
});

test("workspace thread dirty tracking still detects removed active and archived rows", () => {
  resetWorkspaceThreadsPersistDirty();
  const state = createPersistDirtyTestState();
  const previous = persistWorkspaceThreads(state);
  const withoutActive = deleteWorkspaceThread(state, "workspace-dirty-persist", "thread-a");
  const withoutBoth = deleteWorkspaceThread(withoutActive, "workspace-dirty-persist", "thread-archived");
  const dirtySnapshot = getWorkspaceThreadsPersistDirtySnapshot([{ workspace_id: "workspace-dirty-persist" }]);
  const { request } = buildWorkspaceThreadsPersistDelta(
    withoutBoth,
    previous,
    [{ workspace_id: "workspace-dirty-persist" }],
    { dirtySnapshot },
  );

  assert.equal(request.workspaces.length, 1);
  assert.deepEqual(request.workspaces[0].removed_thread_ids, ["thread-a"]);
  assert.deepEqual(request.workspaces[0].removed_archived_thread_ids, ["thread-archived"]);
});

test("deleteWorkspaceThread hard-removes active and archived thread state", () => {
  const workspaceId = "workspace-delete-thread";
  const threadId = "thread-delete";
  const state = {
    [workspaceId]: {
      active_thread_id: threadId,
      archived_thread_order: [threadId],
      archived_threads: {
        [threadId]: {
          id: threadId,
          archivedAt: "2026-06-30T00:00:00.000Z",
          current_agent: "codex",
          provider_bindings: {
            codex: {
              native_session_id: "session-delete",
            },
          },
        },
      },
      terminal_thread_ids: {
        0: threadId,
      },
      terminals: {
        0: {
          terminal_index: 0,
          thread_id: threadId,
        },
      },
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          current_agent: "codex",
          provider_bindings: {
            codex: {
              native_session_id: "session-delete",
            },
          },
          terminal_index: 0,
        },
      },
      threads_view: {
        selectedThreadId: threadId,
        selected_workspace_id: workspaceId,
      },
    },
  };

  const next = deleteWorkspaceThread(state, workspaceId, threadId);
  const entry = next[workspaceId];
  assert.deepEqual(Object.keys(entry.threads), []);
  assert.deepEqual(Object.keys(entry.archived_threads), []);
  assert.deepEqual(entry.thread_order, []);
  assert.deepEqual(entry.archived_thread_order, []);
  assert.deepEqual(entry.terminal_thread_ids, {});
  assert.equal(entry.terminals[0].thread_id, "");
  assert.equal(entry.active_thread_id, "");
  assert.equal(entry.threads_view.selectedThreadId, "");
});

test("provider session binding attaches to the live terminal thread without a thread id", () => {
  const workspaceId = "workspace-session-binding";
  const threadId = "thread-session-binding";
  const sessionId = "codex-session-12345678";
  const state = {
    [workspaceId]: {
      id: workspaceId,
      terminal_thread_ids: {
        1: threadId,
      },
      terminals: {
        1: {
          activity_status: "thinking",
          agent_id: "codex",
          input_ready: false,
          instance_id: 42,
          pane_id: "pane-session-binding",
          status: "active",
          terminal_index: 1,
          thread_id: threadId,
        },
      },
      thread_order: [threadId],
      threads: {
        [threadId]: {
          activity_status: "thinking",
          current_agent: "codex",
          id: threadId,
          latest_turn: {
            message_id: "prompt-session-binding",
            prompt_epoch: 3,
            started_at: "2026-06-18T12:00:00.000Z",
            state: "running",
            turn_id: "turn-session-binding",
          },
          message_count: 1,
          messages: [{
            created_at: "2026-06-18T12:00:00.000Z",
            id: "prompt-session-binding",
            role: "user",
            text: "bind this session",
            turn_id: "turn-session-binding",
          }],
          projection_events: [{
            agent_id: "codex",
            created_at: "2026-06-18T12:00:00.000Z",
            id: "turn-session-binding-started",
            message_id: "prompt-session-binding",
            prompt_epoch: 3,
            status: "running",
            turn_id: "turn-session-binding",
            type: "thread.turn.started",
          }, {
            agent_id: "codex",
            created_at: "2026-06-18T12:00:00.000Z",
            id: "prompt-session-binding",
            message_id: "prompt-session-binding",
            role: "user",
            status: "submitted",
            text: "bind this session",
            turn_id: "turn-session-binding",
            type: "thread.message.user",
          }],
          provider_bindings: {},
          status: "active",
          terminal_binding: {
            instance_id: 42,
            pane_id: "pane-session-binding",
            terminal_index: 1,
          },
          terminal_index: 1,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const nextState = applyWorkspaceThreadProviderSessionBinding(state, {
    agent_id: "codex",
    instance_id: 42,
    native_session_id: sessionId,
    pane_id: "pane-session-binding",
    provider_session_id: sessionId,
    source: "rust-session-binding",
    terminal_index: 1,
    type: "provider-session",
    workspace_id: workspaceId,
  });

  const nextEntry = nextState[workspaceId];
  const nextThread = nextEntry.threads[threadId];
  assert.equal(nextThread.transcript_session_id, sessionId);
  assert.equal(nextThread.activity_status, "thinking");
  assert.equal(nextThread.provider_bindings.codex.native_session_id, sessionId);
  assert.equal(nextThread.provider_bindings.codex.native_session_source, "rust-session-binding");
  assert.equal(nextThread.provider_bindings.codex.terminal_binding.pane_id, "pane-session-binding");
  assert.equal(nextEntry.terminals[1].native_session_id, sessionId);
  assert.equal(nextEntry.terminals[1].activity_status, "thinking");
});

test("fresh terminal open without provider session clears stale live terminal session ids", () => {
  const workspaceId = "workspace-terminal-restart";
  const threadId = "thread-terminal-restart";
  const oldSessionId = "ses_old_provider";
  const state = {
    [workspaceId]: {
      id: workspaceId,
      terminal_thread_ids: {
        0: threadId,
      },
      terminals: {
        0: {
          activity_status: "idle",
          agent_id: "opencode",
          input_ready: true,
          instance_id: 1,
          native_session_id: oldSessionId,
          pane_id: "pane-terminal-restart",
          provider_session_id: oldSessionId,
          session_id: oldSessionId,
          status: "active",
          terminal_index: 0,
          thread_id: threadId,
        },
      },
      thread_order: [threadId],
      threads: {
        [threadId]: {
          current_agent: "opencode",
          id: threadId,
          provider_bindings: {},
          status: "active",
          terminal_binding: {
            instance_id: 1,
            pane_id: "pane-terminal-restart",
            terminal_index: 0,
          },
          terminal_index: 0,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const nextState = updateWorkspaceActiveTerminal(state, {
    agent_id: "opencode",
    instance_id: 2,
    pane_id: "pane-terminal-restart",
    status: "active",
    terminal_index: 0,
    type: "opened",
    workspace_id: workspaceId,
  });

  const terminal = nextState[workspaceId].terminals[0];
  assert.equal(terminal.instance_id, 2);
  assert.equal(terminal.provider_session_id, "");
  assert.equal(terminal.native_session_id, "");
  assert.equal(terminal.session_id, "");
});

test("session transcript completion settles the exact active running turn", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "prompt-test";
  const turnId = `turn-${promptId}`;
  const submittedAt = "2026-05-31T04:15:07.094Z";
  const completedAt = "2026-05-31T04:15:33.000Z";
  const sessionId = "session-test";

  const state = {
    [workspaceId]: {
      id: workspaceId,
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activity_status: "thinking",
          current_agent: "codex",
          latest_turn: {
            message_id: promptId,
            prompt_epoch: 7,
            started_at: submittedAt,
            state: "running",
            turn_id: turnId,
          },
          messages: [{
            created_at: submittedAt,
            id: promptId,
            role: "user",
            text: "Explain this codebase",
            turn_id: turnId,
          }],
          projection_events: [{
            agent_id: "codex",
            created_at: submittedAt,
            id: "turn-start",
            message_id: promptId,
            prompt_epoch: 7,
            status: "running",
            turn_id: turnId,
            type: "thread.turn.started",
          }, {
            agent_id: "codex",
            created_at: submittedAt,
            id: "user-message",
            message_id: promptId,
            role: "user",
            status: "submitted",
            text: "Explain this codebase",
            turn_id: turnId,
            type: "thread.message.user",
          }],
          provider_bindings: {
            codex: {
              activity_status: "thinking",
              input_ready: false,
              native_session_id: sessionId,
              native_session_kind: "session",
              status: "active",
            },
          },
          status: "active",
          terminal_binding: {
            instance_id: 1,
            pane_id: "pane-test",
            terminal_index: 0,
          },
          terminal_index: 0,
          transcript_session_id: sessionId,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const nextState = hydrateWorkspaceThreadSessionTranscript(state, {
    agent_id: "codex",
    allow_transcript_turn_completion: true,
    completed_at: completedAt,
    expected_message_created_at: submittedAt,
    expected_user_message: "Explain this codebase",
    latest_timestamp: completedAt,
    matched_by: "session_id",
    messages: [{
      created_at: submittedAt,
      id: promptId,
      role: "user",
      text: "Explain this codebase",
    }, {
      created_at: completedAt,
      id: "assistant-final",
      kind: "message",
      role: "assistant",
      text: "The project is basically an empty workspace.",
    }, {
      created_at: completedAt,
      id: "task-complete",
      kind: "task_complete",
      role: "assistant",
      text: "The project is basically an empty workspace.",
    }],
    prompt_accepted: true,
    prompt_epoch: 7,
    prompt_event_id: promptId,
    provider_session_id: sessionId,
    session_id: sessionId,
    source: "codex-session",
    submitted_at: submittedAt,
    transcript_explicit_completion_can_settle_turn: true,
    turn_complete_seen: true,
    workspace_id: workspaceId,
    thread_id: threadId,
  });

  const nextThread = nextState[workspaceId].threads[threadId];
  assert.equal(nextThread.latest_turn.state, "completed");
  assert.equal(nextThread.activity_status, "idle");
  assert.equal(nextThread.provider_bindings.codex.input_ready, false);
  assert.equal(
    nextThread.projection_events.some((event) => (
      event.type === "thread.turn.completed" && event.turn_id === turnId
    )),
    true,
  );
  assert.equal(nextThread.messages.some((message) => message.id === "assistant-final"), true);
});

test("session transcript completion cannot settle a running turn without terminal lifecycle permission", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "prompt-test";
  const turnId = `turn-${promptId}`;
  const submittedAt = "2026-05-31T04:15:07.094Z";
  const completedAt = "2026-05-31T04:15:33.000Z";
  const sessionId = "session-test";

  const state = {
    [workspaceId]: {
      id: workspaceId,
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activity_status: "thinking",
          current_agent: "codex",
          latest_turn: {
            message_id: promptId,
            prompt_epoch: 7,
            started_at: submittedAt,
            state: "running",
            turn_id: turnId,
          },
          messages: [{
            created_at: submittedAt,
            id: promptId,
            role: "user",
            text: "Explain this codebase",
            turn_id: turnId,
          }],
          projection_events: [{
            agent_id: "codex",
            created_at: submittedAt,
            id: "turn-start",
            message_id: promptId,
            prompt_epoch: 7,
            status: "running",
            turn_id: turnId,
            type: "thread.turn.started",
          }, {
            agent_id: "codex",
            created_at: submittedAt,
            id: "user-message",
            message_id: promptId,
            role: "user",
            status: "submitted",
            text: "Explain this codebase",
            turn_id: turnId,
            type: "thread.message.user",
          }],
          provider_bindings: {
            codex: {
              activity_status: "thinking",
              input_ready: false,
              native_session_id: sessionId,
              native_session_kind: "session",
              status: "active",
            },
          },
          status: "active",
          terminal_binding: {
            instance_id: 1,
            pane_id: "pane-test",
            terminal_index: 0,
          },
          terminal_index: 0,
          transcript_session_id: sessionId,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const nextState = hydrateWorkspaceThreadSessionTranscript(state, {
    agent_id: "codex",
    allow_transcript_turn_completion: false,
    completed_at: completedAt,
    expected_message_created_at: submittedAt,
    expected_user_message: "Explain this codebase",
    latest_timestamp: completedAt,
    matched_by: "session_id",
    messages: [{
      created_at: submittedAt,
      id: promptId,
      role: "user",
      text: "Explain this codebase",
    }, {
      created_at: completedAt,
      id: "assistant-final",
      kind: "message",
      role: "assistant",
      text: "The project is basically an empty workspace.",
    }, {
      created_at: completedAt,
      id: "task-complete",
      kind: "task_complete",
      role: "assistant",
      text: "The project is basically an empty workspace.",
    }],
    prompt_accepted: true,
    prompt_epoch: 7,
    prompt_event_id: promptId,
    provider_session_id: sessionId,
    session_id: sessionId,
    source: "codex-session",
    submitted_at: submittedAt,
    transcript_completion_can_settle_turn: false,
    transcript_explicit_completion_can_settle_turn: false,
    turn_complete_seen: true,
    workspace_id: workspaceId,
    thread_id: threadId,
  });

  const nextThread = nextState[workspaceId].threads[threadId];
  assert.equal(nextThread.latest_turn.state, "running");
  assert.equal(nextThread.latest_turn.prompt_epoch, 7);
  assert.equal(nextThread.activity_status, "idle");
  assert.equal(nextThread.provider_bindings.codex.input_ready, false);
  assert.equal(
    nextThread.projection_events.some((event) => (
      event.type === "thread.turn.completed" && event.turn_id === turnId
    )),
    false,
  );
  assert.equal(
    nextThread.messages.some((message) => message.id === "assistant-final"),
    true,
  );
});

test("transcript hydration preserves a live running turn over stale completed projection history", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "prompt-test";
  const turnId = `turn-${promptId}`;
  const submittedAt = "2026-05-31T04:15:07.094Z";
  const completedAt = "2026-05-31T04:15:33.000Z";
  const sessionId = "session-test";

  const state = {
    [workspaceId]: {
      id: workspaceId,
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activity_status: "thinking",
          current_agent: "codex",
          latest_turn: {
            message_id: promptId,
            prompt_epoch: 9,
            started_at: submittedAt,
            state: "running",
            turn_id: turnId,
          },
          messages: [{
            created_at: submittedAt,
            id: promptId,
            role: "user",
            text: "Explain this codebase",
            turn_id: turnId,
          }],
          projection_events: [{
            agent_id: "codex",
            created_at: submittedAt,
            id: "turn-start",
            message_id: promptId,
            prompt_epoch: 9,
            status: "running",
            turn_id: turnId,
            type: "thread.turn.started",
          }, {
            agent_id: "codex",
            created_at: submittedAt,
            id: "user-message",
            message_id: promptId,
            role: "user",
            status: "submitted",
            text: "Explain this codebase",
            turn_id: turnId,
            type: "thread.message.user",
          }, {
            agent_id: "codex",
            completed_at: completedAt,
            created_at: completedAt,
            id: "stale-turn-completed",
            message_id: promptId,
            status: "completed",
            turn_id: turnId,
            type: "thread.turn.completed",
          }],
          provider_bindings: {
            codex: {
              activity_status: "thinking",
              input_ready: false,
              native_session_id: sessionId,
              native_session_kind: "session",
              status: "active",
            },
          },
          status: "active",
          terminal_binding: {
            instance_id: 1,
            pane_id: "pane-test",
            terminal_index: 0,
          },
          terminal_index: 0,
          transcript_session_id: sessionId,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const nextState = hydrateWorkspaceThreadSessionTranscript(state, {
    agent_id: "codex",
    allow_transcript_turn_completion: false,
    expected_message_created_at: submittedAt,
    expected_user_message: "Explain this codebase",
    latest_timestamp: completedAt,
    matched_by: "session_id",
    messages: [{
      created_at: submittedAt,
      id: promptId,
      role: "user",
      text: "Explain this codebase",
    }, {
      created_at: completedAt,
      id: "assistant-final",
      kind: "message",
      role: "assistant",
      text: "The project is basically an empty workspace.",
    }],
    prompt_accepted: true,
    prompt_epoch: 9,
    prompt_event_id: promptId,
    provider_session_id: sessionId,
    session_id: sessionId,
    source: "codex-session",
    submitted_at: submittedAt,
    transcript_completion_can_settle_turn: false,
    workspace_id: workspaceId,
    thread_id: threadId,
  });

  const nextThread = nextState[workspaceId].threads[threadId];
  assert.equal(nextThread.latest_turn.state, "running");
  assert.equal(nextThread.latest_turn.prompt_epoch, 9);
  assert.equal(nextThread.activity_status, "idle");
  assert.equal(nextThread.provider_bindings.codex.activity_status, "idle");
});

test("normalization clears orphan running turn with stale message count only", () => {
  const workspaceId = "workspace-orphan";
  const threadId = "thread-orphan";

  const normalized = normalizeWorkspaceThreads({
    [workspaceId]: {
      id: workspaceId,
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activity_status: "idle",
          current_agent: "codex",
          latest_turn: {
            message_id: "terminal-prompt-stale",
            started_at: "2026-06-01T17:00:14.984Z",
            state: "running",
            turn_id: "turn-terminal-prompt-stale",
          },
          message_count: 1,
          messages: [],
          projection_events: [],
          provider_bindings: {
            codex: {
              activity_status: "idle",
              input_ready: false,
              native_session_id: "",
              status: "active",
            },
          },
          status: "idle",
          terminal_index: 1,
          transcript_session_id: "",
          workspace_id: workspaceId,
        },
      },
    },
  });

  const thread = normalized[workspaceId].threads[threadId];
  assert.equal(thread.latest_turn, null);
  assert.equal(thread.activity_status, "idle");
  assert.equal(thread.provider_bindings.codex.activity_status, "idle");
});

test("opening a restored terminal clears stale thinking without closing historical running turn", () => {
  const workspaceId = "workspace-open";
  const threadId = "thread-open";
  const paneId = "pane-open";
  const startedAt = "2026-06-04T11:39:25.514Z";
  const turnId = "turn-stale-open";

  const state = {
    [workspaceId]: {
      id: workspaceId,
      terminal_thread_ids: {
        0: threadId,
      },
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activity_status: "thinking",
          current_agent: "codex",
          latest_turn: {
            message_id: "prompt-open",
            started_at: startedAt,
            state: "running",
            turn_id: turnId,
          },
          materialized: true,
          message_count: 1,
          messages: [{
            created_at: startedAt,
            id: "prompt-open",
            role: "user",
            text: "stale prompt",
            turn_id: turnId,
          }],
          projection_events: [{
            agent_id: "codex",
            created_at: startedAt,
            id: "turn-start",
            message_id: "prompt-open",
            status: "running",
            turn_id: turnId,
            type: "thread.turn.started",
          }],
          provider_bindings: {
            codex: {
              activity_status: "thinking",
              input_ready: false,
              status: "active",
            },
          },
          status: "active",
          terminal_index: 0,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const opened = bindWorkspaceThreadTerminal(state, {
    agent_id: "codex",
    instance_id: 1,
    pane_id: paneId,
    status: "active",
    terminal_index: 0,
    thread_id: threadId,
    type: "opened",
    workspace_id: workspaceId,
  });

  const thread = opened[workspaceId].threads[threadId];
  assert.equal(thread.latest_turn.state, "running");
  assert.equal(thread.activity_status, "idle");
  assert.equal(thread.provider_bindings.codex.activity_status, "idle");
  assert.equal(opened[workspaceId].terminals[0].status, "active");
});

test("session transcript acceptance preserves a locally pending submitted prompt", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "prompt-test";
  const submittedAt = "2026-05-31T04:15:07.094Z";
  const sessionId = "session-test";

  const materialized = materializeWorkspaceThreadForTerminal({}, {
    agent_id: "codex",
    instance_id: 1,
    message_created_at: submittedAt,
    message_id: promptId,
    pane_id: "pane-test",
    pending_prompt_delivery_mode: "session-acceptance",
    pending_prompt_id: promptId,
    pending_prompt_text: "Explain this codebase",
    prompt_event_id: promptId,
    prompt_event_submitted_at: submittedAt,
    session_acceptance_pending: true,
    terminal_index: 0,
    thread_id: threadId,
    type: "message-submitted",
    user_message: "Explain this codebase",
    workspace_id: workspaceId,
  });

  const pendingThread = materialized[workspaceId].threads[threadId];
  assert.equal(pendingThread.pending_prompt.id, promptId);
  assert.equal(pendingThread.latest_turn.state, "running");
  assert.equal(pendingThread.activity_status, "thinking");

  const accepted = hydrateWorkspaceThreadSessionTranscript(materialized, {
    agent_id: "codex",
    expected_message_created_at: submittedAt,
    expected_user_message: "Explain this codebase",
    matched_by: "session_id",
    messages: [{
      created_at: submittedAt,
      id: promptId,
      role: "user",
      text: "Explain this codebase",
    }],
    prompt_accepted: true,
    prompt_event_id: promptId,
    provider_session_id: sessionId,
    session_id: sessionId,
    source: "codex-session",
    submitted_at: submittedAt,
    thread_id: threadId,
    workspace_id: workspaceId,
  });

  const acceptedThread = accepted[workspaceId].threads[threadId];
  assert.equal(acceptedThread.pending_prompt.id, promptId);
  assert.equal(acceptedThread.latest_turn.state, "running");
  assert.equal(acceptedThread.activity_status, "idle");
});

test("accepted provider session attaches to a previously submitted prompt for resume", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-session-accepted";
  const promptId = "prompt-session-accepted";
  const submittedAt = "2026-05-31T04:15:07.094Z";
  const sessionId = "session-accepted";

  const submitted = materializeWorkspaceThreadForTerminal({}, {
    agent_id: "claude",
    instance_id: 1,
    message_created_at: submittedAt,
    message_id: promptId,
    pane_id: "pane-test",
    pending_prompt_delivery_mode: "session-acceptance",
    pending_prompt_id: promptId,
    pending_prompt_text: "Fix the bug",
    prompt_event_id: promptId,
    prompt_event_submitted_at: submittedAt,
    session_acceptance_pending: true,
    terminal_index: 0,
    thread_id: threadId,
    type: "message-submitted",
    user_message: "Fix the bug",
    workspace_id: workspaceId,
  });

  const submittedThread = submitted[workspaceId].threads[threadId];
  assert.equal(submittedThread.provider_bindings.claude.native_session_id, "");
  assert.equal(submittedThread.latest_turn.state, "running");
  assert.equal(submittedThread.pending_prompt.id, promptId);

  const accepted = updateWorkspaceThreadProviderSession(submitted, {
    agent_id: "claude",
    instance_id: 1,
    native_session_id: sessionId,
    native_session_kind: "session",
    native_session_source: "todo-drop:session-accepted",
    pane_id: "pane-test",
    prompt_event_id: promptId,
    provider_session_id: sessionId,
    terminal_index: 0,
    thread_id: threadId,
    type: "provider-session",
    workspace_id: workspaceId,
  });

  const acceptedThread = accepted[workspaceId].threads[threadId];
  assert.equal(acceptedThread.provider_bindings.claude.native_session_id, sessionId);
  assert.equal(acceptedThread.transcript_session_id, sessionId);
  assert.equal(acceptedThread.latest_turn.state, "running");
  assert.equal(acceptedThread.pending_prompt.id, promptId);
  assert.equal(acceptedThread.activity_status, "thinking");
  assert.equal(accepted[workspaceId].terminals["0"].provider_session_id, sessionId);
  assert.equal(accepted[workspaceId].terminals["0"].native_session_id, sessionId);
  assert.equal(accepted[workspaceId].terminals["0"].session_id, sessionId);
  assert.equal(accepted[workspaceId].terminals["0"].thread_id, threadId);

  const persisted = persistWorkspaceThreads(accepted);
  assert.equal(
    persisted[workspaceId].threads[threadId].provider_bindings.claude.native_session_id,
    sessionId,
  );
  assert.equal(persisted[workspaceId].threads[threadId].transcript_session_id, sessionId);
});

test("provider session change updates the active terminal ground truth", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-session-switch";
  const oldSessionId = "session-old";
  const newSessionId = "session-new";

  const opened = materializeWorkspaceThreadForTerminal({}, {
    agent_id: "codex",
    instance_id: 4,
    native_session_id: oldSessionId,
    native_session_kind: "session",
    native_session_source: "terminal-open",
    pane_id: "pane-switch",
    provider_session_id: oldSessionId,
    terminal_index: 1,
    thread_id: threadId,
    type: "opened",
    workspace_id: workspaceId,
  });

  const switched = updateWorkspaceThreadProviderSession(opened, {
    agent_id: "codex",
    instance_id: 4,
    native_session_id: newSessionId,
    native_session_kind: "session",
    native_session_source: "terminal-output",
    pane_id: "pane-switch",
    provider_session_id: newSessionId,
    terminal_index: 1,
    thread_id: threadId,
    type: "provider-session",
    workspace_id: workspaceId,
  });

  const entry = switched[workspaceId];
  const thread = entry.threads[threadId];
  const terminal = entry.terminals["1"];

  assert.equal(thread.provider_bindings.codex.native_session_id, newSessionId);
  assert.equal(thread.transcript_session_id, newSessionId);
  assert.equal(thread.provider_bindings.codex.terminal_binding.terminal_index, 1);
  assert.equal(thread.terminal_binding.terminal_index, 1);
  assert.equal(terminal.provider_session_id, newSessionId);
  assert.equal(terminal.native_session_id, newSessionId);
  assert.equal(terminal.session_id, newSessionId);
  assert.equal(terminal.thread_id, threadId);
});

test("session transcript acceptance preserves pending prompts when transcript ids include the thread prefix", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-d8811d42-91b5-448a-99df-47c238ef5dc4-2-43b4a654-e98c-482e-959e-061087816685";
  const promptId = "todo-drop-prompt-mpwi1po9-7c820d2f1dfda";
  const prefixedPromptId = `${threadId}-${promptId}`;
  const submittedAt = "2026-06-02T14:02:12.000Z";
  const sessionId = "session-test";

  const materialized = materializeWorkspaceThreadForTerminal({}, {
    agent_id: "codex",
    instance_id: 1,
    message_created_at: submittedAt,
    message_id: promptId,
    pane_id: "pane-test",
    pending_prompt_delivery_mode: "session-acceptance",
    pending_prompt_id: promptId,
    pending_prompt_text: "Queued command",
    prompt_event_id: promptId,
    prompt_event_submitted_at: submittedAt,
    session_acceptance_pending: true,
    terminal_index: 0,
    thread_id: threadId,
    type: "message-submitted",
    user_message: "Queued command",
    workspace_id: workspaceId,
  });

  const accepted = hydrateWorkspaceThreadSessionTranscript(materialized, {
    agent_id: "codex",
    expected_message_created_at: submittedAt,
    expected_user_message: "Queued command",
    matched_by: "session_id",
    messages: [{
      created_at: submittedAt,
      id: prefixedPromptId,
      role: "user",
      text: "Queued command",
    }],
    prompt_accepted: true,
    prompt_event_id: prefixedPromptId,
    provider_session_id: sessionId,
    session_id: sessionId,
    source: "codex-session",
    submitted_at: submittedAt,
    thread_id: threadId,
    workspace_id: workspaceId,
  });

  assert.equal(accepted[workspaceId].threads[threadId].pending_prompt.id, promptId);
});

test("prompt clear accepts canonical pending ids without keeping a stale prompt", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "todo-drop-prompt-mpwi1po9-7c820d2f1dfda";
  const prefixedPromptId = `${threadId}-${promptId}`;
  const state = materializeWorkspaceThreadForTerminal({}, {
    agent_id: "codex",
    message_id: promptId,
    pending_prompt_id: promptId,
    pending_prompt_text: "Queued command",
    session_acceptance_pending: true,
    terminal_index: 0,
    thread_id: threadId,
    type: "message-submitted",
    user_message: "Queued command",
    workspace_id: workspaceId,
  });

  const cleared = clearWorkspaceThreadPendingPrompt(state, {
    prompt_event_id: prefixedPromptId,
    thread_id: threadId,
    workspace_id: workspaceId,
  });

  assert.equal(cleared[workspaceId].threads[threadId].pending_prompt, null);
});

test("accepted materialization does not reinstall a pending prompt", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "todo-drop-prompt-accepted";
  const submittedAt = "2026-06-02T14:02:12.000Z";

  const materialized = materializeWorkspaceThreadForTerminal({}, {
    agent_id: "codex",
    instance_id: 1,
    message_created_at: submittedAt,
    message_id: promptId,
    pane_id: "pane-test",
    pending_prompt_delivery_mode: "session-acceptance",
    pending_prompt_id: promptId,
    pending_prompt_text: "Already sent",
    prompt_event_id: promptId,
    prompt_event_submitted_at: submittedAt,
    session_acceptance_pending: false,
    terminal_index: 0,
    thread_id: threadId,
    type: "message-submitted",
    user_message: "Already sent",
    workspace_id: workspaceId,
  });

  const thread = materialized[workspaceId].threads[threadId];
  assert.equal(thread.pending_prompt, null);
  assert.equal(thread.latest_turn.state, "running");
});

test("message submission persists the actual submitted user prompt", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "todo-drop-prompt-test";
  const submittedAt = "2026-06-01T17:26:05.508Z";

  const materialized = materializeWorkspaceThreadForTerminal({}, {
    agent_id: "codex",
    expected_user_message: "Full terminal prompt sent to Codex",
    instance_id: 1,
    message_created_at: submittedAt,
    message_id: promptId,
    pane_id: "pane-test",
    pending_prompt_delivery_mode: "session-acceptance",
    pending_prompt_id: promptId,
    pending_prompt_text: "Short queue label",
    prompt_event_id: promptId,
    prompt_event_submitted_at: submittedAt,
    session_acceptance_pending: true,
    terminal_index: 0,
    thread_id: threadId,
    type: "message-submitted",
    user_message: "Short queue label",
    workspace_id: workspaceId,
  });

  const thread = materialized[workspaceId].threads[threadId];
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0].role, "user");
  assert.equal(thread.messages[0].text, "Full terminal prompt sent to Codex");
  assert.equal(thread.latest_turn.state, "running");
  assert.equal(
    thread.projection_events.filter((event) => event.type === "thread.message.user").length,
    1,
  );
});

test("prompt-ready does not mark input ready for pending session acceptance", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "prompt-test";
  const submittedAt = "2026-05-31T04:15:07.094Z";
  const promptReadyAt = "2026-05-31T04:15:11.000Z";

  const materialized = materializeWorkspaceThreadForTerminal({}, {
    agent_id: "codex",
    instance_id: 1,
    message_created_at: submittedAt,
    message_id: promptId,
    pane_id: "pane-test",
    pending_prompt_delivery_mode: "session-acceptance",
    pending_prompt_id: promptId,
    pending_prompt_text: "Explain this codebase",
    prompt_event_id: promptId,
    prompt_event_submitted_at: submittedAt,
    session_acceptance_pending: true,
    terminal_index: 0,
    thread_id: threadId,
    type: "message-submitted",
    user_message: "Explain this codebase",
    workspace_id: workspaceId,
  });

  const nextState = markWorkspaceThreadAgentActivity(materialized, {
    activity_status: "idle",
    agent_id: "codex",
    input_ready: true,
    input_ready_at: promptReadyAt,
    instance_id: 1,
    pane_id: "pane-test",
    prompt_event_id: promptId,
    prompt_ready_at: promptReadyAt,
    status: "active",
    terminal_index: 0,
    thread_id: threadId,
    type: "terminal-prompt-ready",
    workspace_id: workspaceId,
  });

  const nextThread = nextState[workspaceId].threads[threadId];
  assert.equal(nextThread.activity_status, "idle");
  assert.equal(nextThread.latest_turn.state, "running");
  assert.equal(nextThread.pending_prompt.id, promptId);
  assert.equal(nextThread.provider_bindings.codex.activity_status, "idle");
  assert.equal(nextThread.provider_bindings.codex.input_ready, false);
  assert.equal(nextThread.provider_bindings.codex.input_ready_at, "");

  const terminal = nextState[workspaceId].terminals["0"];
  assert.equal(terminal.input_ready, false);
  assert.equal(terminal.input_ready_at, "");
  assert.equal(terminal.status, "active");

  const normalizedState = normalizeWorkspaceThreads(nextState);
  const normalizedThread = normalizedState[workspaceId].threads[threadId];
  assert.equal(normalizedThread.activity_status, "idle");
  assert.equal(normalizedThread.latest_turn.state, "running");
  assert.equal(normalizedThread.pending_prompt.id, promptId);
  assert.equal(normalizedThread.provider_bindings.codex.input_ready, false);
});

test("prompt-ready does not mark stale prompting fields as input ready", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const paneId = "pane-test";
  const promptReadyAt = "2026-05-31T04:16:11.000Z";

  const state = {
    [workspaceId]: {
      active_thread_id: threadId,
      id: workspaceId,
      terminal_order: ["0"],
      terminals: {
        0: {
          agent_id: "codex",
          input_ready: false,
          instance_id: 1,
          pane_id: paneId,
          prompting_user_kind: "permission",
          prompting_user_source: "terminal-output",
          prompting_user_text: "Allow command to run?",
          status: "active",
          terminal_index: 0,
          terminal_is_prompting_user: true,
          thread_id: threadId,
        },
      },
      thread_order: [threadId],
      threads: {
        [threadId]: {
          activity_status: "idle",
          current_agent: "codex",
          id: threadId,
          latest_turn: {
            state: "completed",
          },
          materialized: true,
          message_count: 0,
          messages: [],
          projection_events: [],
          provider_bindings: {
            codex: {
              activity_status: "idle",
              input_ready: false,
              prompting_user_kind: "permission",
              prompting_user_source: "terminal-output",
              prompting_user_text: "Allow command to run?",
              status: "active",
              terminal_binding: {
                instance_id: 1,
                pane_id: paneId,
                terminal_index: 0,
              },
              terminal_is_prompting_user: true,
            },
          },
          status: "active",
          terminal_binding: {
            instance_id: 1,
            pane_id: paneId,
            terminal_index: 0,
          },
          terminal_index: 0,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const next = markWorkspaceThreadAgentActivity(state, {
    activity_status: "idle",
    agent_id: "codex",
    input_ready: true,
    input_ready_at: promptReadyAt,
    instance_id: 1,
    pane_id: paneId,
    status: "active",
    terminal_index: 0,
    thread_id: threadId,
    type: "terminal-prompt-ready",
    workspace_id: workspaceId,
  });

  const thread = next[workspaceId].threads[threadId];
  assert.equal(thread.provider_bindings.codex.input_ready, false);
  assert.equal(thread.provider_bindings.codex.terminal_is_prompting_user, false);
  assert.equal(thread.provider_bindings.codex.prompting_user_kind, "");
  assert.equal(thread.provider_bindings.codex.prompting_user_source, "");
  assert.equal(next[workspaceId].terminals[0].input_ready, false);
  assert.equal(next[workspaceId].terminals[0].terminal_is_prompting_user, false);
  assert.equal(next[workspaceId].terminals[0].prompting_user_kind, "");
  assert.equal(next[workspaceId].terminals[0].prompting_user_source, "");
});

test("normalization only preserves explicit permission prompting fields", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const baseTerminal = {
    agent_id: "codex",
    instance_id: 1,
    pane_id: "pane-test",
    status: "active",
    terminal_index: 0,
    thread_id: threadId,
  };
  const state = {
    [workspaceId]: {
      active_thread_id: threadId,
      id: workspaceId,
      terminal_order: ["0", "1"],
      terminals: {
        0: {
          ...baseTerminal,
          prompting_user_kind: "permission",
          prompting_user_source: "provider-permission",
          terminal_is_prompting_user: true,
          tool_use_id: "tool-1",
        },
        1: {
          ...baseTerminal,
          pane_id: "pane-stale",
          prompting_user_kind: "permission",
          prompting_user_source: "terminal-output",
          terminal_index: 1,
          terminal_is_prompting_user: true,
        },
      },
      thread_order: [threadId],
      threads: {
        [threadId]: {
          current_agent: "codex",
          id: threadId,
          materialized: true,
          provider_bindings: {
            codex: {
              prompting_user_kind: "permission",
              prompting_user_source: "terminal-output",
              status: "active",
              terminal_is_prompting_user: true,
            },
          },
          terminal_index: 0,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const normalized = normalizeWorkspaceThreads(state);

  assert.equal(normalized[workspaceId].terminals[0].terminal_is_prompting_user, true);
  assert.equal(normalized[workspaceId].terminals[0].prompting_user_source, "provider-permission");
  assert.equal(normalized[workspaceId].terminals[1].terminal_is_prompting_user, false);
  assert.equal(normalized[workspaceId].terminals[1].prompting_user_source, "");
  assert.equal(normalized[workspaceId].threads[threadId].provider_bindings.codex.terminal_is_prompting_user, false);
});

test("detached session transcript completion settles matching idle running turn", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "prompt-test";
  const turnId = `turn-${promptId}`;
  const submittedAt = "2026-05-31T04:15:07.094Z";
  const completedAt = "2026-05-31T04:15:33.000Z";
  const sessionId = "session-test";
  const assistantText = "Yes. This directory is inside a Git repository.";

  const state = {
    [workspaceId]: {
      id: workspaceId,
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activity_status: "idle",
          current_agent: "codex",
          latest_turn: {
            message_id: promptId,
            started_at: submittedAt,
            state: "running",
            turn_id: turnId,
          },
          messages: [{
            created_at: submittedAt,
            id: promptId,
            role: "user",
            text: "is this a git repo?",
            turn_id: turnId,
          }, {
            created_at: completedAt,
            id: "assistant-final",
            role: "assistant",
            status: "complete",
            text: assistantText,
            turn_id: turnId,
          }],
          projection_events: [{
            agent_id: "codex",
            created_at: submittedAt,
            id: "turn-start",
            message_id: promptId,
            source: "codex-session",
            status: "running",
            turn_id: turnId,
            type: "thread.turn.started",
          }, {
            agent_id: "codex",
            created_at: submittedAt,
            id: "user-message",
            message_id: promptId,
            role: "user",
            source: "codex-session",
            status: "submitted",
            text: "is this a git repo?",
            turn_id: turnId,
            type: "thread.message.user",
          }, {
            agent_id: "codex",
            created_at: completedAt,
            id: "assistant-complete",
            message_id: "assistant-final",
            source: "codex-session",
            text: assistantText,
            turn_id: turnId,
            type: "thread.message.assistant.complete",
          }],
          provider_bindings: {
            codex: {
              activity_status: "idle",
              input_ready: false,
              native_session_id: sessionId,
              native_session_kind: "session",
              status: "exited",
              terminal_binding: null,
            },
          },
          status: "exited",
          terminal_binding: null,
          terminal_index: 0,
          transcript_session_id: sessionId,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const hydrated = hydrateWorkspaceThreadSessionTranscript(state, {
    agent_id: "codex",
    allow_transcript_turn_completion: true,
    expected_message_created_at: submittedAt,
    expected_user_message: "is this a git repo?",
    matched_by: "session_id",
    messages: [{
      created_at: submittedAt,
      id: promptId,
      role: "user",
      text: "is this a git repo?",
    }, {
      created_at: completedAt,
      id: "assistant-final",
      kind: "message",
      role: "assistant",
      text: assistantText,
    }, {
      created_at: completedAt,
      id: "task-complete",
      kind: "task_complete",
      role: "assistant",
      text: assistantText,
    }],
    prompt_accepted: true,
    prompt_event_id: promptId,
    provider_session_id: sessionId,
    session_id: sessionId,
    source: "codex-session",
    submitted_at: submittedAt,
    transcript_explicit_completion_can_settle_turn: true,
    thread_id: threadId,
    workspace_id: workspaceId,
  });

  const hydratedThread = hydrated[workspaceId].threads[threadId];
  assert.equal(hydratedThread.status, "exited");
  assert.equal(hydratedThread.latest_turn.state, "completed");
  assert.equal(hydratedThread.activity_status, "idle");
  assert.equal(hydratedThread.provider_bindings.codex.activity_status, "idle");
  assert.equal(hydratedThread.provider_bindings.codex.input_ready, false);
});

test("timestamp recovered transcript settles queued running turn after prompt acceptance", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "todo-drop-prompt-test";
  const turnId = `turn-${promptId}`;
  const submittedAt = "2026-06-01T17:26:05.508Z";
  const acceptedAt = "2026-06-01T17:26:07.276Z";
  const completedAt = "2026-06-01T17:26:10.521Z";
  const sessionId = "session-test";

  const state = {
    [workspaceId]: {
      id: workspaceId,
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activity_status: "idle",
          coordination: {
            worktree_path: "/repo/.agents/worktrees/2",
          },
          current_agent: "codex",
          latest_turn: {
            message_id: promptId,
            started_at: submittedAt,
            state: "running",
            turn_id: turnId,
          },
          materialized: true,
          message_count: 1,
          messages: [],
          pending_prompt: null,
          projection_events: [{
            agent_id: "codex",
            created_at: submittedAt,
            id: "turn-start",
            message_id: promptId,
            source: "tui-todo-auto-queue",
            status: "running",
            turn_id: turnId,
            type: "thread.turn.started",
          }],
          provider_bindings: {
            codex: {
              activity_status: "idle",
              input_ready: false,
              native_session_id: "",
              status: "exited",
              terminal_binding: null,
            },
          },
          status: "exited",
          terminal_binding: null,
          terminal_index: 1,
          transcript_session_id: "",
          workspace_id: workspaceId,
        },
      },
    },
  };

  const hydrated = hydrateWorkspaceThreadSessionTranscript(state, {
    agent_id: "codex",
    allow_transcript_turn_completion: true,
    expected_message_created_at: submittedAt,
    expected_user_message: "",
    latest_timestamp: completedAt,
    matched_by: "cwd+timestamp-recovery",
    messages: [{
      created_at: acceptedAt,
      id: "codex-user",
      role: "user",
      text: "i need your help",
    }, {
      created_at: completedAt,
      id: "assistant-final",
      kind: "message",
      role: "assistant",
      text: "What do you need help with?",
    }, {
      created_at: completedAt,
      id: "task-complete",
      kind: "task_complete",
      role: "assistant",
      text: "What do you need help with?",
    }],
    prompt_accepted: true,
    prompt_event_id: promptId,
    provider_session_id: sessionId,
    session_id: sessionId,
    source: "codex-session",
    submitted_at: submittedAt,
    transcript_explicit_completion_can_settle_turn: true,
    thread_id: threadId,
    workspace_id: workspaceId,
  });

  const thread = hydrated[workspaceId].threads[threadId];
  assert.equal(thread.latest_turn.state, "completed");
  assert.equal(thread.latest_turn.turn_id, turnId);
  assert.equal(thread.activity_status, "idle");
  assert.equal(thread.messages[0].text, "i need your help");
  assert.equal(thread.transcript_session_id, sessionId);
  assert.equal(thread.provider_bindings.codex.input_ready, false);
});

test("session transcript completion does not settle running turn for a later prompt", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "prompt-test";
  const turnId = `turn-${promptId}`;
  const submittedAt = "2026-05-31T04:15:07.094Z";
  const laterSubmittedAt = "2026-05-31T04:15:20.000Z";
  const completedAt = "2026-05-31T04:15:33.000Z";
  const sessionId = "session-test";

  const state = {
    [workspaceId]: {
      id: workspaceId,
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activity_status: "thinking",
          current_agent: "codex",
          latest_turn: {
            message_id: promptId,
            started_at: submittedAt,
            state: "running",
            turn_id: turnId,
          },
          messages: [{
            created_at: submittedAt,
            id: promptId,
            role: "user",
            text: "interesting",
            turn_id: turnId,
          }],
          projection_events: [{
            agent_id: "codex",
            created_at: submittedAt,
            id: "turn-start",
            message_id: promptId,
            status: "running",
            turn_id: turnId,
            type: "thread.turn.started",
          }, {
            agent_id: "codex",
            created_at: submittedAt,
            id: "user-message",
            message_id: promptId,
            role: "user",
            source: "codex-session",
            status: "submitted",
            text: "interesting",
            turn_id: turnId,
            type: "thread.message.user",
          }],
          provider_bindings: {
            codex: {
              activity_status: "thinking",
              input_ready: false,
              native_session_id: sessionId,
              native_session_kind: "session",
              status: "active",
            },
          },
          status: "active",
          terminal_index: 0,
          transcript_session_id: sessionId,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const hydrated = hydrateWorkspaceThreadSessionTranscript(state, {
    agent_id: "codex",
    expected_message_created_at: submittedAt,
    expected_user_message: "interesting",
    matched_by: "session_id",
    messages: [{
      created_at: submittedAt,
      id: promptId,
      role: "user",
      text: "interesting",
    }, {
      created_at: laterSubmittedAt,
      id: "later-user",
      role: "user",
      text: "new task",
    }, {
      created_at: completedAt,
      id: "task-complete",
      kind: "task_complete",
      role: "assistant",
      text: "Done.",
    }],
    prompt_accepted: true,
    prompt_event_id: promptId,
    provider_session_id: sessionId,
    session_id: sessionId,
    source: "codex-session",
    submitted_at: submittedAt,
    thread_id: threadId,
    workspace_id: workspaceId,
  });

  const hydratedThread = hydrated[workspaceId].threads[threadId];
  assert.equal(hydratedThread.latest_turn.state, "running");
  assert.equal(hydratedThread.activity_status, "idle");
});

test("terminal hook activity preserves agent display identity", () => {
  const workspaceId = "workspace-agent-label";
  const threadId = "thread-agent-label";
  const paneId = "pane-agent-label";
  const state = {
    [workspaceId]: {
      id: workspaceId,
      terminal_order: ["0"],
      terminals: {
        0: {
          agent_id: "codex",
          instance_id: 1,
          pane_id: paneId,
          status: "active",
          terminal_index: 0,
          thread_id: threadId,
        },
      },
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activity_status: "idle",
          current_agent: "codex",
          messages: [],
          provider_bindings: {
            codex: {
              activity_status: "idle",
              input_ready: true,
              status: "active",
              terminal_binding: {
                instance_id: 1,
                pane_id: paneId,
                terminal_index: 0,
              },
            },
          },
          status: "active",
          terminal_binding: {
            instance_id: 1,
            pane_id: paneId,
            terminal_index: 0,
          },
          terminal_index: 0,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const next = markWorkspaceThreadAgentActivity(state, {
    activity_status: "thinking",
    agent_display_name: "code-reviewer",
    agent_id: "codex",
    agent_type: "reviewer",
    instance_id: 1,
    pane_id: paneId,
    provider: "codex",
    terminal_index: 0,
    thread_id: threadId,
    type: "provider-turn-started",
    workspace_id: workspaceId,
  });

  const binding = next[workspaceId].threads[threadId].provider_bindings.codex;
  const terminal = next[workspaceId].terminals[0];
  assert.equal(binding.agent_display_name, "code-reviewer");
  assert.equal(binding.agent_type, "reviewer");
  assert.equal(binding.provider, "codex");
  assert.equal(terminal.agent_display_name, "code-reviewer");
  assert.equal(terminal.agent_type, "reviewer");
  assert.equal(terminal.provider, "codex");
});

test("workspace terminals get unique stable short nicknames", () => {
  const workspaceId = "workspace-terminal-names";
  const next = [0, 1, 2].reduce((state, terminalIndex) => (
    materializeWorkspaceThreadForTerminal(state, {
      agent_id: "codex",
      instance_id: terminalIndex + 1,
      pane_id: `pane-${terminalIndex}`,
      terminal_index: terminalIndex,
      thread_id: `thread-${terminalIndex}`,
      type: "message-submitted",
      user_message: `hello ${terminalIndex}`,
      workspace_id: workspaceId,
    })
  ), {});

  const entry = next[workspaceId];
  const nicknames = entry.thread_order.map((threadId) => {
    const thread = entry.threads[threadId];
    const terminal = entry.terminals[String(thread.terminal_index)];
    const binding = thread.provider_bindings.codex;
    const nickname = getWorkspaceThreadTerminalNickname(thread, binding, terminal);
    assert.match(nickname, /^[A-Z][a-z]{1,3}$/);
    assert.equal(thread.terminal_nickname, nickname);
    assert.equal(thread.terminal_name, nickname);
    assert.equal(binding.terminal_nickname, nickname);
    assert.equal(terminal.terminal_nickname, nickname);
    return nickname;
  });
  assert.equal(new Set(nicknames).size, nicknames.length);

  const persisted = persistWorkspaceThreads(next);
  const persistedNicknames = entry.thread_order.map((threadId) => (
    persisted[workspaceId].threads[threadId].terminal_nickname
  ));
  assert.deepEqual(persistedNicknames, nicknames);
  assert.equal(Object.keys(persisted[workspaceId].terminals).length, 0);
});

test("workspace terminal nickname reconciliation keeps one duplicate per workspace", () => {
  const workspaceId = "workspace-terminal-name-dupes";
  const normalized = normalizeWorkspaceThreads({
    [workspaceId]: {
      terminal_thread_ids: {
        0: "thread-a",
        1: "thread-b",
      },
      thread_order: ["thread-a", "thread-b"],
      threads: {
        "thread-a": {
          current_agent: "codex",
          id: "thread-a",
          materialized: true,
          provider_bindings: {
            codex: {
              terminal_nickname: "Bob",
            },
          },
          terminal_index: 0,
          terminal_nickname: "Bob",
          workspace_id: workspaceId,
        },
        "thread-b": {
          current_agent: "codex",
          id: "thread-b",
          materialized: true,
          provider_bindings: {
            codex: {
              terminal_nickname: "Bob",
            },
          },
          terminal_index: 1,
          terminal_nickname: "Bob",
          workspace_id: workspaceId,
        },
      },
    },
  });
  const entry = normalized[workspaceId];
  const first = entry.threads["thread-a"].terminal_nickname;
  const second = entry.threads["thread-b"].terminal_nickname;

  assert.equal(first, "Bob");
  assert.match(second, /^[A-Z][a-z]{1,3}$/);
  assert.notEqual(second, first);
});

test("existing terminal nickname wins over hook agent display name", () => {
  const workspaceId = "workspace-terminal-name-hook";
  const state = materializeWorkspaceThreadForTerminal({}, {
    agent_display_name: "reviewer",
    agent_id: "codex",
    agent_type: "reviewer",
    instance_id: 1,
    pane_id: "pane-hook",
    status: "active",
    terminal_index: 0,
    terminal_nickname: "Ali",
    thread_id: "thread-hook",
    type: "message-submitted",
    user_message: "start",
    workspace_id: workspaceId,
  });
  const next = markWorkspaceThreadAgentActivity(state, {
    activity_status: "thinking",
    agent_display_name: "code-reviewer",
    agent_id: "codex",
    agent_type: "reviewer",
    instance_id: 1,
    pane_id: "pane-hook",
    terminal_index: 0,
    thread_id: "thread-hook",
    type: "provider-turn-started",
    workspace_id: workspaceId,
  });
  const thread = next[workspaceId].threads["thread-hook"];
  const terminal = next[workspaceId].terminals[0];
  const binding = thread.provider_bindings.codex;

  assert.equal(binding.agent_display_name, "code-reviewer");
  assert.equal(getWorkspaceThreadTerminalNickname(thread, binding, terminal), "Ali");
});

test("workspace terminal nickname survives close and reopen", () => {
  const workspaceId = "workspace-terminal-name-reopen";
  const threadId = "thread-reopen";
  const state = materializeWorkspaceThreadForTerminal({}, {
    agent_id: "codex",
    instance_id: 1,
    pane_id: "pane-reopen-1",
    status: "active",
    terminal_index: 0,
    thread_id: threadId,
    type: "message-submitted",
    user_message: "start",
    workspace_id: workspaceId,
  });
  const firstThread = state[workspaceId].threads[threadId];
  const firstTerminal = state[workspaceId].terminals[0];
  const firstNickname = getWorkspaceThreadTerminalNickname(
    firstThread,
    firstThread.provider_bindings.codex,
    firstTerminal,
  );

  assert.ok(firstNickname);

  const closed = markWorkspaceThreadTerminalDetached(state, {
    agent_id: "codex",
    instance_id: 1,
    pane_id: "pane-reopen-1",
    status: "closed",
    terminal_index: 0,
    thread_id: threadId,
    workspace_id: workspaceId,
  });
  assert.equal(closed[workspaceId].terminals[0], undefined);

  const restored = normalizeWorkspaceThreads(persistWorkspaceThreads(closed));
  assert.equal(restored[workspaceId].terminal_thread_ids[0], threadId);
  assert.equal(restored[workspaceId].threads[threadId].terminal_nickname, firstNickname);

  const reopened = updateWorkspaceActiveTerminal(restored, {
    agent_id: "codex",
    instance_id: 2,
    pane_id: "pane-reopen-2",
    status: "active",
    terminal_index: 0,
    type: "opened",
    workspace_id: workspaceId,
  });
  const reopenedThread = reopened[workspaceId].threads[threadId];
  const reopenedTerminal = reopened[workspaceId].terminals[0];

  assert.equal(reopenedTerminal.thread_id, threadId);
  assert.equal(
    getWorkspaceThreadTerminalNickname(
      reopenedThread,
      reopenedThread.provider_bindings.codex,
      reopenedTerminal,
    ),
    firstNickname,
  );
});

test("closed session-backed thread restores by terminal index after persistence", () => {
  const workspaceId = "workspace-session-reopen";
  const threadId = "thread-session-reopen";
  const sessionId = "codex-session-reopen";
  const active = materializeWorkspaceThreadForTerminal({}, {
    agent_id: "codex",
    instance_id: 1,
    native_session_id: sessionId,
    pane_id: "pane-session-reopen-1",
    provider_session_id: sessionId,
    status: "active",
    terminal_index: 0,
    thread_id: threadId,
    type: "message-submitted",
    user_message: "resume me later",
    workspace_id: workspaceId,
  });
  const bound = updateWorkspaceThreadProviderSession(active, {
    agent_id: "codex",
    instance_id: 1,
    native_session_id: sessionId,
    pane_id: "pane-session-reopen-1",
    provider_session_id: sessionId,
    terminal_index: 0,
    thread_id: threadId,
    workspace_id: workspaceId,
  });
  const closed = markWorkspaceThreadTerminalDetached(bound, {
    agent_id: "codex",
    instance_id: 1,
    pane_id: "pane-session-reopen-1",
    status: "closed",
    terminal_index: 0,
    thread_id: threadId,
    workspace_id: workspaceId,
  });

  const restored = normalizeWorkspaceThreads(persistWorkspaceThreads(closed));
  const restoredThread = getWorkspaceThreadForTerminalIndex(restored, workspaceId, "0");

  assert.equal(restored[workspaceId].terminals[0], undefined);
  assert.equal(restored[workspaceId].terminal_thread_ids[0], threadId);
  assert.equal(restoredThread?.id, threadId);
  assert.equal(restoredThread?.terminal_binding, null);
  assert.equal(restoredThread?.transcript_session_id, sessionId);
  assert.equal(restoredThread?.provider_bindings.codex.native_session_id, sessionId);
});

test("live terminal thread selection prefers the current provider session over a cached terminal thread", () => {
  const workspaceId = "workspace-live-selection-session";
  const staleThreadId = "thread-stale-terminal-session";
  const currentThreadId = "thread-current-terminal-session";
  const state = normalizeWorkspaceThreads({
    [workspaceId]: {
      active_thread_id: staleThreadId,
      terminal_thread_ids: {
        0: staleThreadId,
      },
      terminals: {
        0: {
          agent_id: "codex",
          instance_id: 11,
          pane_id: "pane-live-selection",
          provider_session_id: "old-session",
          status: "active",
          terminal_index: 0,
          thread_id: staleThreadId,
        },
      },
      thread_order: [staleThreadId, currentThreadId],
      threads: {
        [staleThreadId]: {
          current_agent: "codex",
          id: staleThreadId,
          materialized: true,
          provider_bindings: {
            codex: {
              native_session_id: "old-session",
            },
          },
          status: "active",
          terminal_index: 0,
          transcript_session_id: "old-session",
          workspace_id: workspaceId,
        },
        [currentThreadId]: {
          current_agent: "codex",
          id: currentThreadId,
          materialized: true,
          provider_bindings: {
            codex: {
              native_session_id: "current-session",
              terminal_binding: {
                instance_id: 12,
                pane_id: "pane-live-selection",
                terminal_index: 0,
              },
            },
          },
          status: "active",
          terminal_index: 0,
          transcript_session_id: "current-session",
          workspace_id: workspaceId,
        },
      },
    },
  });

  const selectedThreadId = getWorkspaceThreadSelectionForLiveTerminal(state[workspaceId], {
    agent_id: "codex",
    instance_id: 12,
    pane_id: "pane-live-selection",
    provider_session_id: "current-session",
    terminal_index: 0,
    thread_id: staleThreadId,
  });

  assert.equal(selectedThreadId, currentThreadId);
});

test("live terminal thread selection uses a sessionless thread for no-session coding terminals", () => {
  const workspaceId = "workspace-live-selection-yellow";
  const staleThreadId = "thread-stale-session";
  const sessionlessThreadId = "thread-yellow-sessionless";
  const state = normalizeWorkspaceThreads({
    [workspaceId]: {
      active_thread_id: staleThreadId,
      terminal_thread_ids: {
        0: staleThreadId,
      },
      terminals: {
        0: {
          agent_id: "codex",
          instance_id: 21,
          pane_id: "pane-yellow-selection",
          provider_session_id: "old-session",
          status: "active",
          terminal_index: 0,
          thread_id: staleThreadId,
        },
      },
      thread_order: [staleThreadId, sessionlessThreadId],
      threads: {
        [staleThreadId]: {
          current_agent: "codex",
          id: staleThreadId,
          materialized: true,
          provider_bindings: {
            codex: {
              native_session_id: "old-session",
            },
          },
          status: "active",
          terminal_index: 0,
          transcript_session_id: "old-session",
          workspace_id: workspaceId,
        },
        [sessionlessThreadId]: {
          current_agent: "codex",
          id: sessionlessThreadId,
          materialized: true,
          provider_bindings: {
            codex: {
              terminal_binding: {
                instance_id: 22,
                pane_id: "pane-yellow-selection",
                terminal_index: 0,
              },
            },
          },
          status: "active",
          terminal_binding: {
            instance_id: 22,
            pane_id: "pane-yellow-selection",
            terminal_index: 0,
          },
          terminal_index: 0,
          workspace_id: workspaceId,
        },
      },
    },
  });

  const selectedThreadId = getWorkspaceThreadSelectionForLiveTerminal(state[workspaceId], {
    agent_id: "codex",
    instance_id: 22,
    pane_id: "pane-yellow-selection",
    terminal_index: 0,
    thread_id: staleThreadId,
  });

  assert.equal(selectedThreadId, sessionlessThreadId);
});

test("provider turn interruption settles running thread and keeps terminal input ready", () => {
  const workspaceId = "workspace-interrupt";
  const threadId = "thread-interrupt";
  const promptId = "prompt-interrupt";
  const turnId = `turn-${promptId}`;
  const startedAt = "2026-05-31T10:00:00.000Z";
  const interruptedAt = "2026-05-31T10:00:05.000Z";
  const paneId = "pane-interrupt";

  const state = {
    [workspaceId]: {
      id: workspaceId,
      terminals: {
        0: {
          agent_id: "codex",
          input_ready: false,
          instance_id: 1,
          pane_id: paneId,
          status: "active",
          terminal_index: 0,
          thread_id: threadId,
        },
      },
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activity_status: "thinking",
          current_agent: "codex",
          latest_turn: {
            message_id: promptId,
            started_at: startedAt,
            state: "running",
            turn_id: turnId,
          },
          messages: [{
            created_at: startedAt,
            id: promptId,
            role: "user",
            text: "cancel me",
            turn_id: turnId,
          }],
          materialized: true,
          pending_prompt: {
            id: promptId,
          },
          projection_events: [{
            agent_id: "codex",
            created_at: startedAt,
            id: "turn-start",
            message_id: promptId,
            status: "running",
            turn_id: turnId,
            type: "thread.turn.started",
          }],
          provider_bindings: {
            codex: {
              activity_status: "thinking",
              input_ready: false,
              status: "active",
              terminal_binding: {
                instance_id: 1,
                pane_id: paneId,
                terminal_index: 0,
              },
            },
          },
          status: "active",
          terminal_binding: {
            instance_id: 1,
            pane_id: paneId,
            terminal_index: 0,
          },
          terminal_index: 0,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const next = appendWorkspaceThreadProjectionEvents(state, {
    activity_status: "idle",
    agent_id: "codex",
    clear_pending_prompt: true,
    input_ready: true,
    input_ready_at: interruptedAt,
    input_ready_confidence: "escape_key_task_interrupted",
    instance_id: 1,
    pane_id: paneId,
    projection_events: [{
      agent_id: "codex",
      completed_at: interruptedAt,
      created_at: interruptedAt,
      id: "turn-interrupted",
      message_id: promptId,
      status: "interrupted",
      turn_id: turnId,
      type: "thread.turn.interrupted",
    }],
    status: "active",
    terminal_index: 0,
    thread_id: threadId,
    type: "provider-turn-interrupted",
    workspace_id: workspaceId,
  });

  const thread = next[workspaceId].threads[threadId];
  assert.equal(thread.latest_turn.state, "interrupted");
  assert.equal(thread.activity_status, "idle");
  assert.equal(thread.pending_prompt, null);
  assert.equal(thread.provider_bindings.codex.input_ready, true);
  assert.equal(thread.provider_bindings.codex.activity_status, "idle");
  assert.equal(next[workspaceId].terminals[0].input_ready, true);
});

test("live hook snapshots replace streamed assistant text and survive transcript hydration", () => {
  const workspaceId = "workspace-opencode-live";
  const threadId = "thread-opencode-live";
  const promptId = "prompt-opencode-live";
  const turnId = `turn-${promptId}`;
  const submittedAt = "2026-07-02T16:00:00.000Z";
  const completedAt = "2026-07-02T16:00:04.000Z";
  const promptText = "make table of what we have so far";
  const finalTable = [
    "| Board | Size | Components | Layout & Connections |",
    "| --- | --- | --- | --- |",
    "| blinky | 12mm x 10mm | R1: 1k, 0402<br>D1: LED, 0402 | Battery -> R1 -> D1 -> Ground |",
    "| switch-led-buzzer | 40mm x 30mm | BT1, SW1, R1, D1, BZ1, C1 | Switch drives LED, buzzer, and capacitor branches in parallel |",
  ].join("\n");
  const scrambledTranscriptText = "Connections::Layout&twoboards-10on|I'vesummaryhere's,tableaofreviewed|-----";
  const baseThread = {
    activity_status: "thinking",
    current_agent: "opencode",
    id: threadId,
    latest_turn: {
      agent_id: "opencode",
      message_id: promptId,
      requested_at: submittedAt,
      started_at: submittedAt,
      state: "running",
      turn_id: turnId,
    },
    materialized: true,
    messages: [{
      agent_id: "opencode",
      created_at: submittedAt,
      id: promptId,
      role: "user",
      source: "cli-hook:provider-turn-started",
      status: "submitted",
      text: promptText,
      turn_id: turnId,
    }],
    projection_events: [{
      agent_id: "opencode",
      created_at: submittedAt,
      id: "turn-start",
      message_id: promptId,
      prompt_epoch: 1,
      source: "cli-hook:provider-turn-started",
      status: "running",
      turn_id: turnId,
      type: "thread.turn.started",
    }, {
      agent_id: "opencode",
      created_at: submittedAt,
      id: "user-message",
      message_id: promptId,
      prompt_epoch: 1,
      role: "user",
      source: "cli-hook:provider-turn-started",
      status: "submitted",
      text: promptText,
      turn_id: turnId,
      type: "thread.message.user",
    }],
    provider_bindings: {
      opencode: {
        activity_status: "thinking",
        input_ready: false,
        native_session_id: "opencode-session-live",
        native_session_kind: "session",
        status: "active",
        terminal_binding: {
          terminal_index: 0,
        },
      },
    },
    status: "active",
    terminal_binding: {
      terminal_index: 0,
    },
    terminal_index: 0,
    transcript_session_id: "opencode-session-live",
    workspace_id: workspaceId,
  };
  const state = {
    [workspaceId]: {
      active_thread_id: threadId,
      id: workspaceId,
      terminal_thread_ids: {
        0: threadId,
      },
      terminals: {
        0: {
          activity_status: "thinking",
          input_ready: false,
          terminal_index: 0,
          thread_id: threadId,
        },
      },
      thread_order: [threadId],
      threads: {
        [threadId]: baseThread,
      },
    },
  };

  const deltaProjectionEvents = createWorkspaceThreadLiveTextProjectionEvents(baseThread, {
    agent_id: "opencode",
    live_text_delta: "Based on the two boards",
    live_text_kind: "assistant",
    source: "cli-hook:assistant-message-delta",
    type: "provider-output",
  });
  const streamed = appendWorkspaceThreadProjectionEvents(state, {
    agent_id: "opencode",
    projection_events: deltaProjectionEvents,
    thread_id: threadId,
    type: "provider-output",
    workspace_id: workspaceId,
  });
  assert.equal(
    streamed[workspaceId].threads[threadId].messages.at(-1).text,
    "Based on the two boards",
  );

  const finalProjectionEvents = createWorkspaceThreadLiveTextProjectionEvents(
    streamed[workspaceId].threads[threadId],
    {
      agent_id: "opencode",
      completed_at: completedAt,
      live_text_kind: "assistant",
      live_text_snapshot: finalTable,
      source: "cli-hook:provider-turn-completed",
      type: "provider-turn-completed",
    },
  );
  const completed = appendWorkspaceThreadProjectionEvents(streamed, {
    agent_id: "opencode",
    completed_at: completedAt,
    input_ready: true,
    projection_events: finalProjectionEvents,
    thread_id: threadId,
    type: "provider-turn-completed",
    workspace_id: workspaceId,
  });
  const completedThread = completed[workspaceId].threads[threadId];
  assert.equal(completedThread.latest_turn.state, "completed");
  assert.equal(completedThread.messages.at(-1).text, finalTable);
  assert.equal(completedThread.messages.at(-1).status, "complete");

  const hydrated = hydrateWorkspaceThreadSessionTranscript(completed, {
    agent_id: "opencode",
    assistant_response_completes_turn: true,
    expected_message_created_at: submittedAt,
    expected_user_message: promptText,
    messages: [{
      created_at: submittedAt,
      id: promptId,
      role: "user",
      text: promptText,
    }, {
      created_at: completedAt,
      id: "assistant-scrambled",
      role: "assistant",
      text: scrambledTranscriptText,
    }],
    prefer_live_hook_assistant_messages: true,
    prompt_accepted: true,
    prompt_event_id: promptId,
    provider_session_id: "opencode-session-live",
    session_id: "opencode-session-live",
    source: "opencode-session-watch",
    submitted_at: submittedAt,
    thread_id: threadId,
    workspace_id: workspaceId,
  });
  const assistantMessages = hydrated[workspaceId].threads[threadId].messages
    .filter((message) => message.role === "assistant");
  assert.equal(assistantMessages.length, 1);
  assert.equal(assistantMessages[0].text, finalTable);
  assert.equal(assistantMessages[0].text.includes("Connections::Layout"), false);
});

test("transcript hydration replaces corrupted live stream for the same turn", () => {
  const workspaceId = "workspace-opencode-live-replace";
  const threadId = "thread-opencode-live-replace";
  const promptId = "prompt-opencode-live-replace";
  const turnId = `turn-${promptId}`;
  const submittedAt = "2026-07-02T18:00:00.000Z";
  const completedAt = "2026-07-02T18:00:04.000Z";
  const promptText = "ok nice make a table of the items in the blinky board";
  const finalTable = [
    "Here's a table of the items in the blinky board:",
    "",
    "| Component | Name | Value | Footprint | Position (X, Y) | Connections |",
    "| --- | --- | --- | --- | --- | --- |",
    "| Resistor | R1 | 1kΩ | 0402 | (-3, 0) | pin2 -> D1 anode |",
    "| LED | D1 | - | 0402 | (3, 0) | anode <- R1 pin2 |",
    "Board size: 12mm x 10mm",
  ].join("\n");
  const corruptedLiveText = "'s atablethe blinkof they boardHereitems in2 |: |Component| Name| |(Xpin040";
  const baseThread = {
    activity_status: "thinking",
    current_agent: "opencode",
    id: threadId,
    latest_turn: {
      agent_id: "opencode",
      message_id: promptId,
      requested_at: submittedAt,
      started_at: submittedAt,
      state: "running",
      turn_id: turnId,
    },
    materialized: true,
    messages: [{
      agent_id: "opencode",
      created_at: submittedAt,
      id: promptId,
      role: "user",
      source: "cli-hook:provider-turn-started",
      status: "submitted",
      text: promptText,
      turn_id: turnId,
    }],
    projection_events: [{
      agent_id: "opencode",
      created_at: submittedAt,
      id: "turn-start-replace",
      message_id: promptId,
      source: "cli-hook:provider-turn-started",
      status: "running",
      turn_id: turnId,
      type: "thread.turn.started",
    }, {
      agent_id: "opencode",
      created_at: submittedAt,
      id: "user-message-replace",
      message_id: promptId,
      role: "user",
      source: "cli-hook:provider-turn-started",
      status: "submitted",
      text: promptText,
      turn_id: turnId,
      type: "thread.message.user",
    }],
    provider_bindings: {
      opencode: {
        activity_status: "thinking",
        input_ready: false,
        native_session_id: "opencode-session-live-replace",
        status: "active",
      },
    },
    status: "active",
    terminal_index: 0,
    transcript_session_id: "opencode-session-live-replace",
    workspace_id: workspaceId,
  };
  const state = {
    [workspaceId]: {
      active_thread_id: threadId,
      id: workspaceId,
      terminals: {},
      thread_order: [threadId],
      threads: {
        [threadId]: baseThread,
      },
    },
  };

  const liveProjectionEvents = createWorkspaceThreadLiveTextProjectionEvents(baseThread, {
    agent_id: "opencode",
    live_text_delta: corruptedLiveText,
    live_text_kind: "assistant",
    source: "cli-hook:assistant-message-delta",
    type: "provider-message-displayed",
  });
  const streamed = appendWorkspaceThreadProjectionEvents(state, {
    agent_id: "opencode",
    projection_events: liveProjectionEvents,
    thread_id: threadId,
    type: "provider-message-displayed",
    workspace_id: workspaceId,
  });
  assert.equal(
    streamed[workspaceId].threads[threadId].messages
      .filter((message) => message.role === "assistant").length,
    1,
  );

  const hydrated = hydrateWorkspaceThreadSessionTranscript(streamed, {
    agent_id: "opencode",
    assistant_response_completes_turn: true,
    expected_message_created_at: submittedAt,
    expected_user_message: promptText,
    messages: [{
      created_at: submittedAt,
      id: promptId,
      role: "user",
      text: promptText,
    }, {
      created_at: completedAt,
      id: "assistant-final-table",
      role: "assistant",
      text: finalTable,
    }],
    prompt_accepted: true,
    prompt_event_id: promptId,
    provider_session_id: "opencode-session-live-replace",
    session_id: "opencode-session-live-replace",
    source: "opencode-session-watch",
    submitted_at: submittedAt,
    thread_id: threadId,
    workspace_id: workspaceId,
  });
  const assistantMessages = hydrated[workspaceId].threads[threadId].messages
    .filter((message) => message.role === "assistant");
  assert.equal(assistantMessages.length, 1);
  assert.equal(assistantMessages[0].text, finalTable);
  assert.equal(assistantMessages[0].text.includes(corruptedLiveText), false);
});

test("live assistant projection preserves whitespace-only deltas", () => {
  const workspaceId = "workspace-live-space-delta";
  const threadId = "thread-live-space-delta";
  const promptId = "prompt-live-space-delta";
  const turnId = `turn-${promptId}`;
  const submittedAt = "2026-07-02T18:20:00.000Z";
  const baseThread = {
    activity_status: "thinking",
    current_agent: "opencode",
    id: threadId,
    latest_turn: {
      agent_id: "opencode",
      message_id: promptId,
      requested_at: submittedAt,
      started_at: submittedAt,
      state: "running",
      turn_id: turnId,
    },
    materialized: true,
    messages: [{
      agent_id: "opencode",
      created_at: submittedAt,
      id: promptId,
      role: "user",
      source: "cli-hook:provider-turn-started",
      status: "submitted",
      text: "make a short table",
      turn_id: turnId,
    }],
    projection_events: [{
      agent_id: "opencode",
      created_at: submittedAt,
      id: "turn-start-space-delta",
      message_id: promptId,
      source: "cli-hook:provider-turn-started",
      status: "running",
      turn_id: turnId,
      type: "thread.turn.started",
    }],
    status: "active",
    transcript_session_id: "opencode-session-space-delta",
    workspace_id: workspaceId,
  };
  let state = {
    [workspaceId]: {
      active_thread_id: threadId,
      id: workspaceId,
      terminals: {},
      thread_order: [threadId],
      threads: {
        [threadId]: baseThread,
      },
    },
  };

  for (const chunk of ["Here's", " ", "a", " ", "table"]) {
    const projectionEvents = createWorkspaceThreadLiveTextProjectionEvents(
      state[workspaceId].threads[threadId],
      {
        agent_id: "opencode",
        live_text_delta: chunk,
        live_text_kind: "assistant",
        source: "cli-hook:assistant-message-delta",
        type: "provider-message-displayed",
      },
    );
    state = appendWorkspaceThreadProjectionEvents(state, {
      agent_id: "opencode",
      projection_events: projectionEvents,
      thread_id: threadId,
      type: "provider-message-displayed",
      workspace_id: workspaceId,
    });
  }

  const assistant = state[workspaceId].threads[threadId].messages
    .find((message) => message.role === "assistant");
  assert.equal(assistant?.text, "Here's a table");
});

test("live assistant projection preserves repeated identical chunks from one snapshot", () => {
  const workspaceId = "workspace-live-repeated-space";
  const threadId = "thread-live-repeated-space";
  const promptId = "prompt-live-repeated-space";
  const turnId = `turn-${promptId}`;
  const baseThread = {
    current_agent: "opencode",
    id: threadId,
    latest_turn: {
      agent_id: "opencode",
      message_id: promptId,
      state: "running",
      turn_id: turnId,
    },
    materialized: true,
    messages: [{
      id: promptId,
      role: "user",
      status: "submitted",
      text: "space twice",
      turn_id: turnId,
    }],
    projection_events: [{
      id: "turn-start-repeated-space",
      message_id: promptId,
      status: "running",
      turn_id: turnId,
      type: "thread.turn.started",
    }],
    status: "active",
    transcript_session_id: "opencode-session-repeated-space",
    workspace_id: workspaceId,
  };
  const projectionEvents = ["a", " ", " "].flatMap((chunk) => (
    createWorkspaceThreadLiveTextProjectionEvents(baseThread, {
      agent_id: "opencode",
      live_text_delta: chunk,
      live_text_kind: "assistant",
      source: "cli-hook:assistant-message-delta",
      type: "provider-message-displayed",
    })
  ));
  const state = appendWorkspaceThreadProjectionEvents({
    [workspaceId]: {
      active_thread_id: threadId,
      id: workspaceId,
      terminals: {},
      thread_order: [threadId],
      threads: {
        [threadId]: baseThread,
      },
    },
  }, {
    agent_id: "opencode",
    projection_events: projectionEvents,
    thread_id: threadId,
    type: "provider-message-displayed",
    workspace_id: workspaceId,
  });

  const assistant = state[workspaceId].threads[threadId].messages
    .find((message) => message.role === "assistant");
  assert.equal(assistant?.text, "a  ");
});

test("live assistant snapshots preserve edge whitespace", () => {
  const workspaceId = "workspace-live-snapshot-space";
  const threadId = "thread-live-snapshot-space";
  const promptId = "prompt-live-snapshot-space";
  const turnId = `turn-${promptId}`;
  const snapshot = "\n  indented snapshot  \n";
  const baseThread = {
    current_agent: "opencode",
    id: threadId,
    latest_turn: {
      agent_id: "opencode",
      message_id: promptId,
      state: "running",
      turn_id: turnId,
    },
    materialized: true,
    messages: [{ id: promptId, role: "user", status: "submitted", text: "snapshot", turn_id: turnId }],
    projection_events: [{
      id: "turn-start-snapshot-space",
      message_id: promptId,
      status: "running",
      turn_id: turnId,
      type: "thread.turn.started",
    }],
    status: "active",
    transcript_session_id: "opencode-session-snapshot-space",
    workspace_id: workspaceId,
  };
  const projectionEvents = createWorkspaceThreadLiveTextProjectionEvents(baseThread, {
    agent_id: "opencode",
    live_text_kind: "assistant",
    live_text_snapshot: snapshot,
    source: "cli-hook:assistant-message-delta",
    type: "provider-message-displayed",
  });
  const state = appendWorkspaceThreadProjectionEvents({
    [workspaceId]: {
      active_thread_id: threadId,
      id: workspaceId,
      terminals: {},
      thread_order: [threadId],
      threads: { [threadId]: baseThread },
    },
  }, {
    agent_id: "opencode",
    projection_events: projectionEvents,
    thread_id: threadId,
    type: "provider-message-displayed",
    workspace_id: workspaceId,
  });
  const assistant = state[workspaceId].threads[threadId].messages
    .find((message) => message.role === "assistant");
  assert.equal(assistant?.text, snapshot);
});

test("assistant transcript replaces live text exactly without user transcript echo", () => {
  const workspaceId = "workspace-assistant-only-replace";
  const threadId = "thread-assistant-only-replace";
  const promptId = "prompt-assistant-only-replace";
  const turnId = `turn-${promptId}`;
  const baseThread = {
    current_agent: "opencode",
    id: threadId,
    latest_turn: {
      agent_id: "opencode",
      message_id: promptId,
      state: "running",
      turn_id: turnId,
    },
    materialized: true,
    messages: [{ id: promptId, role: "user", status: "submitted", text: "finish this", turn_id: turnId }],
    projection_events: [{
      id: "turn-start-assistant-only",
      message_id: promptId,
      status: "running",
      turn_id: turnId,
      type: "thread.turn.started",
    }, {
      delta: "bad stream",
      id: "live-assistant-bad-stream",
      message_id: `assistant-${promptId}`,
      source: "cli-hook:assistant-message-delta",
      turn_id: turnId,
      type: "thread.message.assistant.delta",
    }],
    status: "active",
    transcript_session_id: "opencode-session-assistant-only",
    workspace_id: workspaceId,
  };
  const state = {
    [workspaceId]: {
      active_thread_id: threadId,
      id: workspaceId,
      terminals: {},
      thread_order: [threadId],
      threads: { [threadId]: baseThread },
    },
  };
  const finalText = "Here  are\n  exact spaces  ";
  const hydrated = hydrateWorkspaceThreadSessionTranscript(state, {
    agent_id: "opencode",
    assistant_response_completes_turn: true,
    messages: [{
      created_at: "2026-07-02T18:30:00.000Z",
      id: "assistant-only-final",
      role: "assistant",
      text: finalText,
    }],
    prompt_accepted: true,
    prompt_event_id: promptId,
    provider_session_id: "opencode-session-assistant-only",
    session_id: "opencode-session-assistant-only",
    source: "opencode-session-watch",
    thread_id: threadId,
    workspace_id: workspaceId,
  });
  const assistantMessages = hydrated[workspaceId].threads[threadId].messages
    .filter((message) => message.role === "assistant");
  assert.equal(assistantMessages.length, 1);
  assert.equal(assistantMessages[0].text, finalText);
});

test("assistant live formatting survives persistence", () => {
  const workspaceId = "workspace-persist-live-space";
  const threadId = "thread-persist-live-space";
  const assistantText = "a  b\n    code";
  const state = {
    [workspaceId]: {
      active_thread_id: threadId,
      id: workspaceId,
      terminals: {},
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          materialized: true,
          messages: [{
            id: "assistant-persist-space",
            role: "assistant",
            source: "cli-hook:assistant-message-delta",
            status: "streaming",
            text: assistantText,
          }],
          projection_events: [{
            delta: assistantText,
            id: "projection-assistant-persist-space",
            message_id: "assistant-persist-space",
            source: "cli-hook:assistant-message-delta",
            type: "thread.message.assistant.delta",
          }],
          status: "active",
          workspace_id: workspaceId,
        },
      },
    },
  };
  const restored = normalizeWorkspaceThreads(persistWorkspaceThreads(state));
  assert.equal(
    restored[workspaceId].threads[threadId].messages[0].text,
    assistantText,
  );
  assert.equal(
    restored[workspaceId].threads[threadId].projection_events[0].delta,
    assistantText,
  );
});

test("live provider tool hooks render as structured activity messages", () => {
  const workspaceId = "workspace-live-tools";
  const threadId = "thread-live-tools";
  const promptId = "prompt-live-tools";
  const turnId = `turn-${promptId}`;
  const startedAt = "2026-07-02T17:00:00.000Z";
  const baseThread = {
    activity_status: "thinking",
    current_agent: "opencode",
    id: threadId,
    latest_turn: {
      agent_id: "opencode",
      message_id: promptId,
      started_at: startedAt,
      state: "running",
      turn_id: turnId,
    },
    materialized: true,
    messages: [{
      agent_id: "opencode",
      created_at: startedAt,
      id: promptId,
      role: "user",
      status: "submitted",
      text: "run drc",
      turn_id: turnId,
    }],
    projection_events: [{
      agent_id: "opencode",
      created_at: startedAt,
      id: "turn-start",
      message_id: promptId,
      source: "cli-hook:provider-turn-started",
      status: "running",
      turn_id: turnId,
      type: "thread.turn.started",
    }],
    provider_bindings: {
      opencode: {
        activity_status: "thinking",
        input_ready: false,
        status: "active",
      },
    },
    status: "active",
    terminal_index: 0,
    workspace_id: workspaceId,
  };
  const state = {
    [workspaceId]: {
      active_thread_id: threadId,
      id: workspaceId,
      terminals: {
        0: {
          activity_status: "thinking",
          terminal_index: 0,
          thread_id: threadId,
        },
      },
      thread_order: [threadId],
      threads: {
        [threadId]: baseThread,
      },
    },
  };

  const startedProjectionEvents = createWorkspaceThreadToolProjectionEvents(baseThread, {
    agent_id: "opencode",
    message_id: "shared-tool-message",
    source: "cli-hook:provider-tool-started",
    tool_input: {
      board_path: "hardware/switch-led-buzzer/switch-led-buzzer.board.tsx",
    },
    tool_name: "coordination-kernel.pcb_drc",
    tool_use_id: "call-drc-1",
    type: "provider-tool-started",
  });
  const withToolStart = appendWorkspaceThreadProjectionEvents(state, {
    activity_status: "tool_running",
    agent_id: "opencode",
    clear_pending_prompt: false,
    projection_events: startedProjectionEvents,
    thread_id: threadId,
    type: "provider-tool-started",
    workspace_id: workspaceId,
  });

  const startMessage = withToolStart[workspaceId].threads[threadId].messages
    .find((message) => message.kind === "tool_call");
  assert.equal(startMessage.title, "Called coordination-kernel.pcb_drc");
  assert.equal(startMessage.tool_name, "coordination-kernel.pcb_drc");
  assert.deepEqual(startMessage.tool_input, {
    board_path: "hardware/switch-led-buzzer/switch-led-buzzer.board.tsx",
  });
  assert.equal(startMessage.status, "running");

  const outputProjectionEvents = createWorkspaceThreadToolProjectionEvents(
    withToolStart[workspaceId].threads[threadId],
    {
      agent_id: "opencode",
      message_id: "shared-tool-message",
      source: "cli-hook:provider-tool-completed",
      tool_name: "coordination-kernel.pcb_drc",
      tool_output: {
        componentCount: 6,
        errorCount: 0,
        traceCount: 8,
        warningCount: 0,
      },
      tool_use_id: "call-drc-1",
      type: "provider-tool-completed",
    },
  );
  const withToolOutput = appendWorkspaceThreadProjectionEvents(withToolStart, {
    activity_status: "thinking",
    agent_id: "opencode",
    clear_pending_prompt: false,
    projection_events: outputProjectionEvents,
    thread_id: threadId,
    type: "provider-tool-completed",
    workspace_id: workspaceId,
  });
  const outputMessage = withToolOutput[workspaceId].threads[threadId].messages
    .find((message) => message.kind === "tool_output");
  const toolMessages = withToolOutput[workspaceId].threads[threadId].messages
    .filter((message) => message.kind === "tool_call" || message.kind === "tool_output");
  assert.deepEqual(
    toolMessages.map((message) => message.kind),
    ["tool_call", "tool_output"],
  );
  assert.equal(outputMessage.title, "coordination-kernel.pcb_drc finished");
  assert.deepEqual(outputMessage.tool_output, {
    componentCount: 6,
    errorCount: 0,
    traceCount: 8,
    warningCount: 0,
  });
  assert.match(outputMessage.text, /componentCount/);
});

test("failed live provider tool hooks carry structured errors", () => {
  const thread = {
    current_agent: "opencode",
    id: "thread-tool-failed",
    latest_turn: {
      message_id: "prompt-tool-failed",
      turn_id: "turn-tool-failed",
    },
    workspace_id: "workspace-tool-failed",
  };
  const projectionEvents = createWorkspaceThreadToolProjectionEvents(thread, {
    agent_id: "opencode",
    source: "cli-hook:provider-tool-failed",
    tool_error: {
      error: "DRC failed",
      warningCount: 2,
    },
    tool_name: "coordination-kernel.pcb_drc",
    tool_use_id: "call-drc-failed",
    type: "provider-tool-failed",
  });

  assert.equal(projectionEvents.length, 1);
  assert.equal(projectionEvents[0].kind, "tool_output");
  assert.equal(projectionEvents[0].status, "error");
  assert.equal(projectionEvents[0].title, "coordination-kernel.pcb_drc failed");
  assert.deepEqual(projectionEvents[0].tool_error, {
    error: "DRC failed",
    warningCount: 2,
  });
  assert.match(projectionEvents[0].text, /DRC failed/);
});

test("live provider tool hooks preserve an explicit turn id", () => {
  const projectionEvents = createWorkspaceThreadToolProjectionEvents({
    current_agent: "codex",
    id: "thread-explicit-turn",
    latest_turn: {
      message_id: "prompt-latest",
      turn_id: "turn-latest",
    },
  }, {
    agent_id: "codex",
    message_id: "tool-message",
    tool_name: "exec_command",
    turn_id: "turn-provider-explicit",
    type: "provider-tool-started",
  });

  assert.equal(projectionEvents.length, 1);
  assert.equal(projectionEvents[0].turn_id, "turn-provider-explicit");
});

test("title-only tool projection events remain visible", () => {
  const workspaceId = "workspace-title-only-tool";
  const threadId = "thread-title-only-tool";
  const state = {
    [workspaceId]: {
      active_thread_id: threadId,
      id: workspaceId,
      terminals: {},
      thread_order: [threadId],
      threads: {
        [threadId]: {
          current_agent: "codex",
          id: threadId,
          messages: [],
          projection_events: [],
          provider_bindings: {
            codex: {
              activity_status: "thinking",
              status: "active",
            },
          },
          status: "active",
          workspace_id: workspaceId,
        },
      },
    },
  };
  const next = appendWorkspaceThreadProjectionEvents(state, {
    agent_id: "codex",
    projection_events: [{
      agent_id: "codex",
      created_at: "2026-07-02T17:04:00.000Z",
      id: "title-only-start-task",
      kind: "tool_call",
      message_id: "tool-start-task-call",
      source: "cli-hook:provider-tool-started",
      status: "running",
      title: "Called start_task",
      type: "thread.tool_call",
    }],
    thread_id: threadId,
    type: "provider-tool-started",
    workspace_id: workspaceId,
  });

  const message = next[workspaceId].threads[threadId].messages.at(-1);
  assert.equal(message.role, "activity");
  assert.equal(message.kind, "tool_call");
  assert.equal(message.title, "Called start_task");
  assert.equal(message.text, "");
});

test("session transcript preserves generated image artifacts through hydration", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-image-test";
  const promptId = "prompt-image-test";
  const turnId = `turn-${promptId}`;
  const submittedAt = "2026-06-08T17:00:00.000Z";
  const completedAt = "2026-06-08T17:00:05.000Z";
  const sessionId = "session-image-test";
  const artifact = {
    kind: "image",
    mime_type: "image/svg+xml",
    path: "/tmp/diffforge/chocolate.svg",
    prompt: "dark chocolate squares on a slate plate",
    title: "Chocolate preview",
    url: "file:///tmp/diffforge/chocolate.svg",
  };

  const state = {
    [workspaceId]: {
      id: workspaceId,
      thread_order: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activity_status: "thinking",
          current_agent: "codex",
          latest_turn: {
            message_id: promptId,
            prompt_epoch: 2,
            started_at: submittedAt,
            state: "running",
            turn_id: turnId,
          },
          messages: [{
            created_at: submittedAt,
            id: promptId,
            role: "user",
            text: "make an image of chocolate",
            turn_id: turnId,
          }],
          projection_events: [{
            agent_id: "codex",
            created_at: submittedAt,
            id: "turn-start",
            message_id: promptId,
            prompt_epoch: 2,
            status: "running",
            turn_id: turnId,
            type: "thread.turn.started",
          }, {
            agent_id: "codex",
            created_at: submittedAt,
            id: "user-message",
            message_id: promptId,
            role: "user",
            status: "submitted",
            text: "make an image of chocolate",
            turn_id: turnId,
            type: "thread.message.user",
          }],
          provider_bindings: {
            codex: {
              activity_status: "thinking",
              input_ready: false,
              native_session_id: sessionId,
              native_session_kind: "session",
              status: "active",
            },
          },
          status: "active",
          terminal_binding: {
            instance_id: 1,
            pane_id: "pane-image-test",
            terminal_index: 0,
          },
          terminal_index: 0,
          transcript_session_id: sessionId,
          workspace_id: workspaceId,
        },
      },
    },
  };

  const nextState = hydrateWorkspaceThreadSessionTranscript(state, {
    agent_id: "codex",
    allow_transcript_turn_completion: true,
    completed_at: completedAt,
    expected_message_created_at: submittedAt,
    expected_user_message: "make an image of chocolate",
    latest_timestamp: completedAt,
    matched_by: "session_id",
    messages: [{
      created_at: submittedAt,
      id: promptId,
      role: "user",
      text: "make an image of chocolate",
    }, {
      artifacts: [artifact],
      created_at: completedAt,
      id: "generated-image",
      kind: "image_generation",
      role: "activity",
      text: "",
      title: "Generated image",
    }, {
      created_at: completedAt,
      id: "task-complete",
      kind: "task_complete",
      role: "assistant",
      text: "Generated a fresh chocolate image preview.",
    }],
    prompt_accepted: true,
    prompt_epoch: 2,
    prompt_event_id: promptId,
    provider_session_id: sessionId,
    session_id: sessionId,
    source: "codex-session",
    submitted_at: submittedAt,
    transcript_explicit_completion_can_settle_turn: true,
    turn_complete_seen: true,
    workspace_id: workspaceId,
    thread_id: threadId,
  });

  const nextThread = nextState[workspaceId].threads[threadId];
  const imageMessage = nextThread.messages.find((message) => message.id === "generated-image");
  assert.equal(imageMessage?.role, "activity");
  assert.equal(imageMessage?.kind, "image_generation");
  assert.equal(imageMessage?.artifacts?.length, 1);
  assert.equal(imageMessage.artifacts[0].mime_type, "image/svg+xml");
  assert.equal(imageMessage.artifacts[0].url, "file:///tmp/diffforge/chocolate.svg");

  const imageProjectionEvent = nextThread.projection_events.find((event) => event.message_id === "generated-image");
  assert.equal(imageProjectionEvent?.type, "thread.activity");
  assert.equal(imageProjectionEvent?.artifacts?.length, 1);
  assert.equal(imageProjectionEvent.artifacts[0].path, "/tmp/diffforge/chocolate.svg");
});

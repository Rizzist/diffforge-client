import assert from "node:assert/strict";
import test from "node:test";

import {
  appendWorkspaceThreadProjectionEvents,
  applyWorkspaceThreadProviderSessionBinding,
  bindWorkspaceThreadTerminal,
  clearWorkspaceThreadPendingPrompt,
  getWorkspaceThreadForTerminalIndex,
  getWorkspaceThreadSelectionForLiveTerminal,
  getWorkspaceThreadTerminalNickname,
  hydrateWorkspaceThreadSessionTranscript,
  markWorkspaceThreadAgentActivity,
  markWorkspaceThreadTerminalDetached,
  materializeWorkspaceThreadForTerminal,
  normalizeWorkspaceThreads,
  persistWorkspaceThreads,
  updateWorkspaceActiveTerminal,
  updateWorkspaceThreadProviderSession,
} from "./workspaceThreads.js";

test("provider session binding attaches to the live terminal thread without a thread id", () => {
  const workspaceId = "workspace-session-binding";
  const threadId = "thread-session-binding";
  const sessionId = "codex-session-12345678";
  const state = {
    [workspaceId]: {
      id: workspaceId,
      terminalThreadIds: {
        1: threadId,
      },
      terminals: {
        1: {
          activityStatus: "thinking",
          agentId: "codex",
          inputReady: false,
          instanceId: 42,
          paneId: "pane-session-binding",
          status: "active",
          terminalIndex: 1,
          threadId,
        },
      },
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          activityStatus: "thinking",
          currentAgent: "codex",
          id: threadId,
          latestTurn: {
            messageId: "prompt-session-binding",
            promptEpoch: 3,
            startedAt: "2026-06-18T12:00:00.000Z",
            state: "running",
            turnId: "turn-session-binding",
          },
          messageCount: 1,
          messages: [{
            createdAt: "2026-06-18T12:00:00.000Z",
            id: "prompt-session-binding",
            role: "user",
            text: "bind this session",
            turnId: "turn-session-binding",
          }],
          projectionEvents: [{
            agentId: "codex",
            createdAt: "2026-06-18T12:00:00.000Z",
            id: "turn-session-binding-started",
            messageId: "prompt-session-binding",
            promptEpoch: 3,
            status: "running",
            turnId: "turn-session-binding",
            type: "thread.turn.started",
          }, {
            agentId: "codex",
            createdAt: "2026-06-18T12:00:00.000Z",
            id: "prompt-session-binding",
            messageId: "prompt-session-binding",
            role: "user",
            status: "submitted",
            text: "bind this session",
            turnId: "turn-session-binding",
            type: "thread.message.user",
          }],
          providerBindings: {},
          status: "active",
          terminalBinding: {
            instanceId: 42,
            paneId: "pane-session-binding",
            terminalIndex: 1,
          },
          terminalIndex: 1,
          workspaceId,
        },
      },
    },
  };

  const nextState = applyWorkspaceThreadProviderSessionBinding(state, {
    agentId: "codex",
    instanceId: 42,
    nativeSessionId: sessionId,
    paneId: "pane-session-binding",
    providerSessionId: sessionId,
    source: "rust-session-binding",
    terminalIndex: 1,
    type: "provider-session",
    workspaceId,
  });

  const nextEntry = nextState[workspaceId];
  const nextThread = nextEntry.threads[threadId];
  assert.equal(nextThread.transcriptSessionId, sessionId);
  assert.equal(nextThread.activityStatus, "thinking");
  assert.equal(nextThread.providerBindings.codex.nativeSessionId, sessionId);
  assert.equal(nextThread.providerBindings.codex.nativeSessionSource, "rust-session-binding");
  assert.equal(nextThread.providerBindings.codex.terminalBinding.paneId, "pane-session-binding");
  assert.equal(nextEntry.terminals[1].nativeSessionId, sessionId);
  assert.equal(nextEntry.terminals[1].activityStatus, "thinking");
});

test("fresh terminal open without provider session clears stale live terminal session ids", () => {
  const workspaceId = "workspace-terminal-restart";
  const threadId = "thread-terminal-restart";
  const oldSessionId = "ses_old_provider";
  const state = {
    [workspaceId]: {
      id: workspaceId,
      terminalThreadIds: {
        0: threadId,
      },
      terminals: {
        0: {
          activityStatus: "idle",
          agentId: "opencode",
          inputReady: true,
          instanceId: 1,
          nativeSessionId: oldSessionId,
          paneId: "pane-terminal-restart",
          providerSessionId: oldSessionId,
          sessionId: oldSessionId,
          status: "active",
          terminalIndex: 0,
          threadId,
        },
      },
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          currentAgent: "opencode",
          id: threadId,
          providerBindings: {},
          status: "active",
          terminalBinding: {
            instanceId: 1,
            paneId: "pane-terminal-restart",
            terminalIndex: 0,
          },
          terminalIndex: 0,
          workspaceId,
        },
      },
    },
  };

  const nextState = updateWorkspaceActiveTerminal(state, {
    agentId: "opencode",
    instanceId: 2,
    paneId: "pane-terminal-restart",
    status: "active",
    terminalIndex: 0,
    type: "opened",
    workspaceId,
  });

  const terminal = nextState[workspaceId].terminals[0];
  assert.equal(terminal.instanceId, 2);
  assert.equal(terminal.providerSessionId, "");
  assert.equal(terminal.nativeSessionId, "");
  assert.equal(terminal.sessionId, "");
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
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activityStatus: "thinking",
          currentAgent: "codex",
          latestTurn: {
            messageId: promptId,
            promptEpoch: 7,
            startedAt: submittedAt,
            state: "running",
            turnId,
          },
          messages: [{
            createdAt: submittedAt,
            id: promptId,
            role: "user",
            text: "Explain this codebase",
            turnId,
          }],
          projectionEvents: [{
            agentId: "codex",
            createdAt: submittedAt,
            id: "turn-start",
            messageId: promptId,
            promptEpoch: 7,
            status: "running",
            turnId,
            type: "thread.turn.started",
          }, {
            agentId: "codex",
            createdAt: submittedAt,
            id: "user-message",
            messageId: promptId,
            role: "user",
            status: "submitted",
            text: "Explain this codebase",
            turnId,
            type: "thread.message.user",
          }],
          providerBindings: {
            codex: {
              activityStatus: "thinking",
              inputReady: false,
              nativeSessionId: sessionId,
              nativeSessionKind: "session",
              status: "active",
            },
          },
          status: "active",
          terminalBinding: {
            instanceId: 1,
            paneId: "pane-test",
            terminalIndex: 0,
          },
          terminalIndex: 0,
          transcriptSessionId: sessionId,
          workspaceId,
        },
      },
    },
  };

  const nextState = hydrateWorkspaceThreadSessionTranscript(state, {
    agentId: "codex",
    allowTranscriptTurnCompletion: true,
    completedAt,
    expectedMessageCreatedAt: submittedAt,
    expectedUserMessage: "Explain this codebase",
    latestTimestamp: completedAt,
    matchedBy: "sessionId",
    messages: [{
      createdAt: submittedAt,
      id: promptId,
      role: "user",
      text: "Explain this codebase",
    }, {
      createdAt: completedAt,
      id: "assistant-final",
      kind: "message",
      role: "assistant",
      text: "The project is basically an empty workspace.",
    }, {
      createdAt: completedAt,
      id: "task-complete",
      kind: "task_complete",
      role: "assistant",
      text: "The project is basically an empty workspace.",
    }],
    promptAccepted: true,
    promptEpoch: 7,
    promptEventId: promptId,
    providerSessionId: sessionId,
    sessionId,
    source: "codex-session",
    submittedAt,
    transcriptExplicitCompletionCanSettleTurn: true,
    turnCompleteSeen: true,
    workspaceId,
    threadId,
  });

  const nextThread = nextState[workspaceId].threads[threadId];
  assert.equal(nextThread.latestTurn.state, "completed");
  assert.equal(nextThread.activityStatus, "idle");
  assert.equal(nextThread.providerBindings.codex.inputReady, false);
  assert.equal(
    nextThread.projectionEvents.some((event) => (
      event.type === "thread.turn.completed" && event.turnId === turnId
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
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activityStatus: "thinking",
          currentAgent: "codex",
          latestTurn: {
            messageId: promptId,
            promptEpoch: 7,
            startedAt: submittedAt,
            state: "running",
            turnId,
          },
          messages: [{
            createdAt: submittedAt,
            id: promptId,
            role: "user",
            text: "Explain this codebase",
            turnId,
          }],
          projectionEvents: [{
            agentId: "codex",
            createdAt: submittedAt,
            id: "turn-start",
            messageId: promptId,
            promptEpoch: 7,
            status: "running",
            turnId,
            type: "thread.turn.started",
          }, {
            agentId: "codex",
            createdAt: submittedAt,
            id: "user-message",
            messageId: promptId,
            role: "user",
            status: "submitted",
            text: "Explain this codebase",
            turnId,
            type: "thread.message.user",
          }],
          providerBindings: {
            codex: {
              activityStatus: "thinking",
              inputReady: false,
              nativeSessionId: sessionId,
              nativeSessionKind: "session",
              status: "active",
            },
          },
          status: "active",
          terminalBinding: {
            instanceId: 1,
            paneId: "pane-test",
            terminalIndex: 0,
          },
          terminalIndex: 0,
          transcriptSessionId: sessionId,
          workspaceId,
        },
      },
    },
  };

  const nextState = hydrateWorkspaceThreadSessionTranscript(state, {
    agentId: "codex",
    allowTranscriptTurnCompletion: false,
    completedAt,
    expectedMessageCreatedAt: submittedAt,
    expectedUserMessage: "Explain this codebase",
    latestTimestamp: completedAt,
    matchedBy: "sessionId",
    messages: [{
      createdAt: submittedAt,
      id: promptId,
      role: "user",
      text: "Explain this codebase",
    }, {
      createdAt: completedAt,
      id: "assistant-final",
      kind: "message",
      role: "assistant",
      text: "The project is basically an empty workspace.",
    }, {
      createdAt: completedAt,
      id: "task-complete",
      kind: "task_complete",
      role: "assistant",
      text: "The project is basically an empty workspace.",
    }],
    promptAccepted: true,
    promptEpoch: 7,
    promptEventId: promptId,
    providerSessionId: sessionId,
    sessionId,
    source: "codex-session",
    submittedAt,
    transcriptCompletionCanSettleTurn: false,
    transcriptExplicitCompletionCanSettleTurn: false,
    turnCompleteSeen: true,
    workspaceId,
    threadId,
  });

  const nextThread = nextState[workspaceId].threads[threadId];
  assert.equal(nextThread.latestTurn.state, "running");
  assert.equal(nextThread.latestTurn.promptEpoch, 7);
  assert.equal(nextThread.activityStatus, "idle");
  assert.equal(nextThread.providerBindings.codex.inputReady, false);
  assert.equal(
    nextThread.projectionEvents.some((event) => (
      event.type === "thread.turn.completed" && event.turnId === turnId
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
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activityStatus: "thinking",
          currentAgent: "codex",
          latestTurn: {
            messageId: promptId,
            promptEpoch: 9,
            startedAt: submittedAt,
            state: "running",
            turnId,
          },
          messages: [{
            createdAt: submittedAt,
            id: promptId,
            role: "user",
            text: "Explain this codebase",
            turnId,
          }],
          projectionEvents: [{
            agentId: "codex",
            createdAt: submittedAt,
            id: "turn-start",
            messageId: promptId,
            promptEpoch: 9,
            status: "running",
            turnId,
            type: "thread.turn.started",
          }, {
            agentId: "codex",
            createdAt: submittedAt,
            id: "user-message",
            messageId: promptId,
            role: "user",
            status: "submitted",
            text: "Explain this codebase",
            turnId,
            type: "thread.message.user",
          }, {
            agentId: "codex",
            completedAt,
            createdAt: completedAt,
            id: "stale-turn-completed",
            messageId: promptId,
            status: "completed",
            turnId,
            type: "thread.turn.completed",
          }],
          providerBindings: {
            codex: {
              activityStatus: "thinking",
              inputReady: false,
              nativeSessionId: sessionId,
              nativeSessionKind: "session",
              status: "active",
            },
          },
          status: "active",
          terminalBinding: {
            instanceId: 1,
            paneId: "pane-test",
            terminalIndex: 0,
          },
          terminalIndex: 0,
          transcriptSessionId: sessionId,
          workspaceId,
        },
      },
    },
  };

  const nextState = hydrateWorkspaceThreadSessionTranscript(state, {
    agentId: "codex",
    allowTranscriptTurnCompletion: false,
    expectedMessageCreatedAt: submittedAt,
    expectedUserMessage: "Explain this codebase",
    latestTimestamp: completedAt,
    matchedBy: "sessionId",
    messages: [{
      createdAt: submittedAt,
      id: promptId,
      role: "user",
      text: "Explain this codebase",
    }, {
      createdAt: completedAt,
      id: "assistant-final",
      kind: "message",
      role: "assistant",
      text: "The project is basically an empty workspace.",
    }],
    promptAccepted: true,
    promptEpoch: 9,
    promptEventId: promptId,
    providerSessionId: sessionId,
    sessionId,
    source: "codex-session",
    submittedAt,
    transcriptCompletionCanSettleTurn: false,
    workspaceId,
    threadId,
  });

  const nextThread = nextState[workspaceId].threads[threadId];
  assert.equal(nextThread.latestTurn.state, "running");
  assert.equal(nextThread.latestTurn.promptEpoch, 9);
  assert.equal(nextThread.activityStatus, "idle");
  assert.equal(nextThread.providerBindings.codex.activityStatus, "idle");
});

test("normalization clears orphan running turn with stale message count only", () => {
  const workspaceId = "workspace-orphan";
  const threadId = "thread-orphan";

  const normalized = normalizeWorkspaceThreads({
    [workspaceId]: {
      id: workspaceId,
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activityStatus: "idle",
          currentAgent: "codex",
          latestTurn: {
            messageId: "terminal-prompt-stale",
            startedAt: "2026-06-01T17:00:14.984Z",
            state: "running",
            turnId: "turn-terminal-prompt-stale",
          },
          messageCount: 1,
          messages: [],
          projectionEvents: [],
          providerBindings: {
            codex: {
              activityStatus: "idle",
              inputReady: false,
              nativeSessionId: "",
              status: "active",
            },
          },
          status: "idle",
          terminalIndex: 1,
          transcriptSessionId: "",
          workspaceId,
        },
      },
    },
  });

  const thread = normalized[workspaceId].threads[threadId];
  assert.equal(thread.latestTurn, null);
  assert.equal(thread.activityStatus, "idle");
  assert.equal(thread.providerBindings.codex.activityStatus, "idle");
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
      terminalThreadIds: {
        0: threadId,
      },
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activityStatus: "thinking",
          currentAgent: "codex",
          latestTurn: {
            messageId: "prompt-open",
            startedAt,
            state: "running",
            turnId,
          },
          materialized: true,
          messageCount: 1,
          messages: [{
            createdAt: startedAt,
            id: "prompt-open",
            role: "user",
            text: "stale prompt",
            turnId,
          }],
          projectionEvents: [{
            agentId: "codex",
            createdAt: startedAt,
            id: "turn-start",
            messageId: "prompt-open",
            status: "running",
            turnId,
            type: "thread.turn.started",
          }],
          providerBindings: {
            codex: {
              activityStatus: "thinking",
              inputReady: false,
              status: "active",
            },
          },
          status: "active",
          terminalIndex: 0,
          workspaceId,
        },
      },
    },
  };

  const opened = bindWorkspaceThreadTerminal(state, {
    agentId: "codex",
    instanceId: 1,
    paneId,
    status: "active",
    terminalIndex: 0,
    threadId,
    type: "opened",
    workspaceId,
  });

  const thread = opened[workspaceId].threads[threadId];
  assert.equal(thread.latestTurn.state, "running");
  assert.equal(thread.activityStatus, "idle");
  assert.equal(thread.providerBindings.codex.activityStatus, "idle");
  assert.equal(opened[workspaceId].terminals[0].status, "active");
});

test("session transcript acceptance preserves a locally pending submitted prompt", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "prompt-test";
  const submittedAt = "2026-05-31T04:15:07.094Z";
  const sessionId = "session-test";

  const materialized = materializeWorkspaceThreadForTerminal({}, {
    agentId: "codex",
    instanceId: 1,
    messageCreatedAt: submittedAt,
    messageId: promptId,
    paneId: "pane-test",
    pendingPromptDeliveryMode: "session-acceptance",
    pendingPromptId: promptId,
    pendingPromptText: "Explain this codebase",
    promptEventId: promptId,
    promptEventSubmittedAt: submittedAt,
    sessionAcceptancePending: true,
    terminalIndex: 0,
    threadId,
    type: "message-submitted",
    userMessage: "Explain this codebase",
    workspaceId,
  });

  const pendingThread = materialized[workspaceId].threads[threadId];
  assert.equal(pendingThread.pendingPrompt.id, promptId);
  assert.equal(pendingThread.latestTurn.state, "running");
  assert.equal(pendingThread.activityStatus, "thinking");

  const accepted = hydrateWorkspaceThreadSessionTranscript(materialized, {
    agentId: "codex",
    expectedMessageCreatedAt: submittedAt,
    expectedUserMessage: "Explain this codebase",
    matchedBy: "sessionId",
    messages: [{
      createdAt: submittedAt,
      id: promptId,
      role: "user",
      text: "Explain this codebase",
    }],
    promptAccepted: true,
    promptEventId: promptId,
    providerSessionId: sessionId,
    sessionId,
    source: "codex-session",
    submittedAt,
    threadId,
    workspaceId,
  });

  const acceptedThread = accepted[workspaceId].threads[threadId];
  assert.equal(acceptedThread.pendingPrompt.id, promptId);
  assert.equal(acceptedThread.latestTurn.state, "running");
  assert.equal(acceptedThread.activityStatus, "idle");
});

test("accepted provider session attaches to a previously submitted prompt for resume", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-session-accepted";
  const promptId = "prompt-session-accepted";
  const submittedAt = "2026-05-31T04:15:07.094Z";
  const sessionId = "session-accepted";

  const submitted = materializeWorkspaceThreadForTerminal({}, {
    agentId: "claude",
    instanceId: 1,
    messageCreatedAt: submittedAt,
    messageId: promptId,
    paneId: "pane-test",
    pendingPromptDeliveryMode: "session-acceptance",
    pendingPromptId: promptId,
    pendingPromptText: "Fix the bug",
    promptEventId: promptId,
    promptEventSubmittedAt: submittedAt,
    sessionAcceptancePending: true,
    terminalIndex: 0,
    threadId,
    type: "message-submitted",
    userMessage: "Fix the bug",
    workspaceId,
  });

  const submittedThread = submitted[workspaceId].threads[threadId];
  assert.equal(submittedThread.providerBindings.claude.nativeSessionId, "");
  assert.equal(submittedThread.latestTurn.state, "running");
  assert.equal(submittedThread.pendingPrompt.id, promptId);

  const accepted = updateWorkspaceThreadProviderSession(submitted, {
    agentId: "claude",
    instanceId: 1,
    nativeSessionId: sessionId,
    nativeSessionKind: "session",
    nativeSessionSource: "todo-drop:session-accepted",
    paneId: "pane-test",
    promptEventId: promptId,
    providerSessionId: sessionId,
    terminalIndex: 0,
    threadId,
    type: "provider-session",
    workspaceId,
  });

  const acceptedThread = accepted[workspaceId].threads[threadId];
  assert.equal(acceptedThread.providerBindings.claude.nativeSessionId, sessionId);
  assert.equal(acceptedThread.transcriptSessionId, sessionId);
  assert.equal(acceptedThread.latestTurn.state, "running");
  assert.equal(acceptedThread.pendingPrompt.id, promptId);
  assert.equal(acceptedThread.activityStatus, "thinking");
  assert.equal(accepted[workspaceId].terminals["0"].providerSessionId, sessionId);
  assert.equal(accepted[workspaceId].terminals["0"].nativeSessionId, sessionId);
  assert.equal(accepted[workspaceId].terminals["0"].sessionId, sessionId);
  assert.equal(accepted[workspaceId].terminals["0"].threadId, threadId);

  const persisted = persistWorkspaceThreads(accepted);
  assert.equal(
    persisted[workspaceId].threads[threadId].providerBindings.claude.nativeSessionId,
    sessionId,
  );
  assert.equal(persisted[workspaceId].threads[threadId].transcriptSessionId, sessionId);
});

test("provider session change updates the active terminal ground truth", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-session-switch";
  const oldSessionId = "session-old";
  const newSessionId = "session-new";

  const opened = materializeWorkspaceThreadForTerminal({}, {
    agentId: "codex",
    instanceId: 4,
    nativeSessionId: oldSessionId,
    nativeSessionKind: "session",
    nativeSessionSource: "terminal-open",
    paneId: "pane-switch",
    providerSessionId: oldSessionId,
    terminalIndex: 1,
    threadId,
    type: "opened",
    workspaceId,
  });

  const switched = updateWorkspaceThreadProviderSession(opened, {
    agentId: "codex",
    instanceId: 4,
    nativeSessionId: newSessionId,
    nativeSessionKind: "session",
    nativeSessionSource: "terminal-output",
    paneId: "pane-switch",
    providerSessionId: newSessionId,
    terminalIndex: 1,
    threadId,
    type: "provider-session",
    workspaceId,
  });

  const entry = switched[workspaceId];
  const thread = entry.threads[threadId];
  const terminal = entry.terminals["1"];

  assert.equal(thread.providerBindings.codex.nativeSessionId, newSessionId);
  assert.equal(thread.transcriptSessionId, newSessionId);
  assert.equal(thread.providerBindings.codex.terminalBinding.terminalIndex, 1);
  assert.equal(thread.terminalBinding.terminalIndex, 1);
  assert.equal(terminal.providerSessionId, newSessionId);
  assert.equal(terminal.nativeSessionId, newSessionId);
  assert.equal(terminal.sessionId, newSessionId);
  assert.equal(terminal.threadId, threadId);
});

test("session transcript acceptance preserves pending prompts when transcript ids include the thread prefix", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-d8811d42-91b5-448a-99df-47c238ef5dc4-2-43b4a654-e98c-482e-959e-061087816685";
  const promptId = "todo-drop-prompt-mpwi1po9-7c820d2f1dfda";
  const prefixedPromptId = `${threadId}-${promptId}`;
  const submittedAt = "2026-06-02T14:02:12.000Z";
  const sessionId = "session-test";

  const materialized = materializeWorkspaceThreadForTerminal({}, {
    agentId: "codex",
    instanceId: 1,
    messageCreatedAt: submittedAt,
    messageId: promptId,
    paneId: "pane-test",
    pendingPromptDeliveryMode: "session-acceptance",
    pendingPromptId: promptId,
    pendingPromptText: "Queued command",
    promptEventId: promptId,
    promptEventSubmittedAt: submittedAt,
    sessionAcceptancePending: true,
    terminalIndex: 0,
    threadId,
    type: "message-submitted",
    userMessage: "Queued command",
    workspaceId,
  });

  const accepted = hydrateWorkspaceThreadSessionTranscript(materialized, {
    agentId: "codex",
    expectedMessageCreatedAt: submittedAt,
    expectedUserMessage: "Queued command",
    matchedBy: "sessionId",
    messages: [{
      createdAt: submittedAt,
      id: prefixedPromptId,
      role: "user",
      text: "Queued command",
    }],
    promptAccepted: true,
    promptEventId: prefixedPromptId,
    providerSessionId: sessionId,
    sessionId,
    source: "codex-session",
    submittedAt,
    threadId,
    workspaceId,
  });

  assert.equal(accepted[workspaceId].threads[threadId].pendingPrompt.id, promptId);
});

test("prompt clear accepts canonical pending ids without keeping a stale prompt", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "todo-drop-prompt-mpwi1po9-7c820d2f1dfda";
  const prefixedPromptId = `${threadId}-${promptId}`;
  const state = materializeWorkspaceThreadForTerminal({}, {
    agentId: "codex",
    messageId: promptId,
    pendingPromptId: promptId,
    pendingPromptText: "Queued command",
    sessionAcceptancePending: true,
    terminalIndex: 0,
    threadId,
    type: "message-submitted",
    userMessage: "Queued command",
    workspaceId,
  });

  const cleared = clearWorkspaceThreadPendingPrompt(state, {
    promptEventId: prefixedPromptId,
    threadId,
    workspaceId,
  });

  assert.equal(cleared[workspaceId].threads[threadId].pendingPrompt, null);
});

test("accepted materialization does not reinstall a pending prompt", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "todo-drop-prompt-accepted";
  const submittedAt = "2026-06-02T14:02:12.000Z";

  const materialized = materializeWorkspaceThreadForTerminal({}, {
    agentId: "codex",
    instanceId: 1,
    messageCreatedAt: submittedAt,
    messageId: promptId,
    paneId: "pane-test",
    pendingPromptDeliveryMode: "session-acceptance",
    pendingPromptId: promptId,
    pendingPromptText: "Already sent",
    promptEventId: promptId,
    promptEventSubmittedAt: submittedAt,
    sessionAcceptancePending: false,
    terminalIndex: 0,
    threadId,
    type: "message-submitted",
    userMessage: "Already sent",
    workspaceId,
  });

  const thread = materialized[workspaceId].threads[threadId];
  assert.equal(thread.pendingPrompt, null);
  assert.equal(thread.latestTurn.state, "running");
});

test("message submission persists the actual submitted user prompt", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const promptId = "todo-drop-prompt-test";
  const submittedAt = "2026-06-01T17:26:05.508Z";

  const materialized = materializeWorkspaceThreadForTerminal({}, {
    agentId: "codex",
    expectedUserMessage: "Full terminal prompt sent to Codex",
    instanceId: 1,
    messageCreatedAt: submittedAt,
    messageId: promptId,
    paneId: "pane-test",
    pendingPromptDeliveryMode: "session-acceptance",
    pendingPromptId: promptId,
    pendingPromptText: "Short queue label",
    promptEventId: promptId,
    promptEventSubmittedAt: submittedAt,
    sessionAcceptancePending: true,
    terminalIndex: 0,
    threadId,
    type: "message-submitted",
    userMessage: "Short queue label",
    workspaceId,
  });

  const thread = materialized[workspaceId].threads[threadId];
  assert.equal(thread.messages.length, 1);
  assert.equal(thread.messages[0].role, "user");
  assert.equal(thread.messages[0].text, "Full terminal prompt sent to Codex");
  assert.equal(thread.latestTurn.state, "running");
  assert.equal(
    thread.projectionEvents.filter((event) => event.type === "thread.message.user").length,
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
    agentId: "codex",
    instanceId: 1,
    messageCreatedAt: submittedAt,
    messageId: promptId,
    paneId: "pane-test",
    pendingPromptDeliveryMode: "session-acceptance",
    pendingPromptId: promptId,
    pendingPromptText: "Explain this codebase",
    promptEventId: promptId,
    promptEventSubmittedAt: submittedAt,
    sessionAcceptancePending: true,
    terminalIndex: 0,
    threadId,
    type: "message-submitted",
    userMessage: "Explain this codebase",
    workspaceId,
  });

  const nextState = markWorkspaceThreadAgentActivity(materialized, {
    activityStatus: "idle",
    agentId: "codex",
    inputReady: true,
    inputReadyAt: promptReadyAt,
    instanceId: 1,
    paneId: "pane-test",
    promptEventId: promptId,
    promptReadyAt,
    status: "active",
    terminalIndex: 0,
    threadId,
    type: "terminal-prompt-ready",
    workspaceId,
  });

  const nextThread = nextState[workspaceId].threads[threadId];
  assert.equal(nextThread.activityStatus, "idle");
  assert.equal(nextThread.latestTurn.state, "running");
  assert.equal(nextThread.pendingPrompt.id, promptId);
  assert.equal(nextThread.providerBindings.codex.activityStatus, "idle");
  assert.equal(nextThread.providerBindings.codex.inputReady, false);
  assert.equal(nextThread.providerBindings.codex.inputReadyAt, "");

  const terminal = nextState[workspaceId].terminals["0"];
  assert.equal(terminal.inputReady, false);
  assert.equal(terminal.inputReadyAt, "");
  assert.equal(terminal.status, "active");

  const normalizedState = normalizeWorkspaceThreads(nextState);
  const normalizedThread = normalizedState[workspaceId].threads[threadId];
  assert.equal(normalizedThread.activityStatus, "idle");
  assert.equal(normalizedThread.latestTurn.state, "running");
  assert.equal(normalizedThread.pendingPrompt.id, promptId);
  assert.equal(normalizedThread.providerBindings.codex.inputReady, false);
});

test("prompt-ready does not mark stale prompting fields as input ready", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const paneId = "pane-test";
  const promptReadyAt = "2026-05-31T04:16:11.000Z";

  const state = {
    [workspaceId]: {
      activeThreadId: threadId,
      id: workspaceId,
      terminalOrder: ["0"],
      terminals: {
        0: {
          agentId: "codex",
          inputReady: false,
          instanceId: 1,
          paneId,
          promptingUserKind: "permission",
          promptingUserSource: "terminal-output",
          promptingUserText: "Allow command to run?",
          status: "active",
          terminalIndex: 0,
          terminalIsPromptingUser: true,
          threadId,
        },
      },
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          activityStatus: "idle",
          currentAgent: "codex",
          id: threadId,
          latestTurn: {
            state: "completed",
          },
          materialized: true,
          messageCount: 0,
          messages: [],
          projectionEvents: [],
          providerBindings: {
            codex: {
              activityStatus: "idle",
              inputReady: false,
              promptingUserKind: "permission",
              promptingUserSource: "terminal-output",
              promptingUserText: "Allow command to run?",
              status: "active",
              terminalBinding: {
                instanceId: 1,
                paneId,
                terminalIndex: 0,
              },
              terminalIsPromptingUser: true,
            },
          },
          status: "active",
          terminalBinding: {
            instanceId: 1,
            paneId,
            terminalIndex: 0,
          },
          terminalIndex: 0,
          workspaceId,
        },
      },
    },
  };

  const next = markWorkspaceThreadAgentActivity(state, {
    activityStatus: "idle",
    agentId: "codex",
    inputReady: true,
    inputReadyAt: promptReadyAt,
    instanceId: 1,
    paneId,
    status: "active",
    terminalIndex: 0,
    threadId,
    type: "terminal-prompt-ready",
    workspaceId,
  });

  const thread = next[workspaceId].threads[threadId];
  assert.equal(thread.providerBindings.codex.inputReady, false);
  assert.equal(thread.providerBindings.codex.terminalIsPromptingUser, false);
  assert.equal(thread.providerBindings.codex.promptingUserKind, "");
  assert.equal(thread.providerBindings.codex.promptingUserSource, "");
  assert.equal(next[workspaceId].terminals[0].inputReady, false);
  assert.equal(next[workspaceId].terminals[0].terminalIsPromptingUser, false);
  assert.equal(next[workspaceId].terminals[0].promptingUserKind, "");
  assert.equal(next[workspaceId].terminals[0].promptingUserSource, "");
});

test("normalization only preserves explicit permission prompting fields", () => {
  const workspaceId = "workspace-test";
  const threadId = "thread-test";
  const baseTerminal = {
    agentId: "codex",
    instanceId: 1,
    paneId: "pane-test",
    status: "active",
    terminalIndex: 0,
    threadId,
  };
  const state = {
    [workspaceId]: {
      activeThreadId: threadId,
      id: workspaceId,
      terminalOrder: ["0", "1"],
      terminals: {
        0: {
          ...baseTerminal,
          promptingUserKind: "permission",
          promptingUserSource: "provider-permission",
          terminalIsPromptingUser: true,
          toolUseId: "tool-1",
        },
        1: {
          ...baseTerminal,
          paneId: "pane-stale",
          promptingUserKind: "permission",
          promptingUserSource: "terminal-output",
          terminalIndex: 1,
          terminalIsPromptingUser: true,
        },
      },
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          currentAgent: "codex",
          id: threadId,
          materialized: true,
          providerBindings: {
            codex: {
              promptingUserKind: "permission",
              promptingUserSource: "terminal-output",
              status: "active",
              terminalIsPromptingUser: true,
            },
          },
          terminalIndex: 0,
          workspaceId,
        },
      },
    },
  };

  const normalized = normalizeWorkspaceThreads(state);

  assert.equal(normalized[workspaceId].terminals[0].terminalIsPromptingUser, true);
  assert.equal(normalized[workspaceId].terminals[0].promptingUserSource, "provider-permission");
  assert.equal(normalized[workspaceId].terminals[1].terminalIsPromptingUser, false);
  assert.equal(normalized[workspaceId].terminals[1].promptingUserSource, "");
  assert.equal(normalized[workspaceId].threads[threadId].providerBindings.codex.terminalIsPromptingUser, false);
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
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activityStatus: "idle",
          currentAgent: "codex",
          latestTurn: {
            messageId: promptId,
            startedAt: submittedAt,
            state: "running",
            turnId,
          },
          messages: [{
            createdAt: submittedAt,
            id: promptId,
            role: "user",
            text: "is this a git repo?",
            turnId,
          }, {
            createdAt: completedAt,
            id: "assistant-final",
            role: "assistant",
            status: "complete",
            text: assistantText,
            turnId,
          }],
          projectionEvents: [{
            agentId: "codex",
            createdAt: submittedAt,
            id: "turn-start",
            messageId: promptId,
            source: "codex-session",
            status: "running",
            turnId,
            type: "thread.turn.started",
          }, {
            agentId: "codex",
            createdAt: submittedAt,
            id: "user-message",
            messageId: promptId,
            role: "user",
            source: "codex-session",
            status: "submitted",
            text: "is this a git repo?",
            turnId,
            type: "thread.message.user",
          }, {
            agentId: "codex",
            createdAt: completedAt,
            id: "assistant-complete",
            messageId: "assistant-final",
            source: "codex-session",
            text: assistantText,
            turnId,
            type: "thread.message.assistant.complete",
          }],
          providerBindings: {
            codex: {
              activityStatus: "idle",
              inputReady: false,
              nativeSessionId: sessionId,
              nativeSessionKind: "session",
              status: "exited",
              terminalBinding: null,
            },
          },
          status: "exited",
          terminalBinding: null,
          terminalIndex: 0,
          transcriptSessionId: sessionId,
          workspaceId,
        },
      },
    },
  };

  const hydrated = hydrateWorkspaceThreadSessionTranscript(state, {
    agentId: "codex",
    allowTranscriptTurnCompletion: true,
    expectedMessageCreatedAt: submittedAt,
    expectedUserMessage: "is this a git repo?",
    matchedBy: "sessionId",
    messages: [{
      createdAt: submittedAt,
      id: promptId,
      role: "user",
      text: "is this a git repo?",
    }, {
      createdAt: completedAt,
      id: "assistant-final",
      kind: "message",
      role: "assistant",
      text: assistantText,
    }, {
      createdAt: completedAt,
      id: "task-complete",
      kind: "task_complete",
      role: "assistant",
      text: assistantText,
    }],
    promptAccepted: true,
    promptEventId: promptId,
    providerSessionId: sessionId,
    sessionId,
    source: "codex-session",
    submittedAt,
    transcriptExplicitCompletionCanSettleTurn: true,
    threadId,
    workspaceId,
  });

  const hydratedThread = hydrated[workspaceId].threads[threadId];
  assert.equal(hydratedThread.status, "exited");
  assert.equal(hydratedThread.latestTurn.state, "completed");
  assert.equal(hydratedThread.activityStatus, "idle");
  assert.equal(hydratedThread.providerBindings.codex.activityStatus, "idle");
  assert.equal(hydratedThread.providerBindings.codex.inputReady, false);
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
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activityStatus: "idle",
          coordination: {
            worktreePath: "/repo/.agents/worktrees/2",
          },
          currentAgent: "codex",
          latestTurn: {
            messageId: promptId,
            startedAt: submittedAt,
            state: "running",
            turnId,
          },
          materialized: true,
          messageCount: 1,
          messages: [],
          pendingPrompt: null,
          projectionEvents: [{
            agentId: "codex",
            createdAt: submittedAt,
            id: "turn-start",
            messageId: promptId,
            source: "tui-todo-auto-queue",
            status: "running",
            turnId,
            type: "thread.turn.started",
          }],
          providerBindings: {
            codex: {
              activityStatus: "idle",
              inputReady: false,
              nativeSessionId: "",
              status: "exited",
              terminalBinding: null,
            },
          },
          status: "exited",
          terminalBinding: null,
          terminalIndex: 1,
          transcriptSessionId: "",
          workspaceId,
        },
      },
    },
  };

  const hydrated = hydrateWorkspaceThreadSessionTranscript(state, {
    agentId: "codex",
    allowTranscriptTurnCompletion: true,
    expectedMessageCreatedAt: submittedAt,
    expectedUserMessage: "",
    latestTimestamp: completedAt,
    matchedBy: "cwd+timestamp-recovery",
    messages: [{
      createdAt: acceptedAt,
      id: "codex-user",
      role: "user",
      text: "i need your help",
    }, {
      createdAt: completedAt,
      id: "assistant-final",
      kind: "message",
      role: "assistant",
      text: "What do you need help with?",
    }, {
      createdAt: completedAt,
      id: "task-complete",
      kind: "task_complete",
      role: "assistant",
      text: "What do you need help with?",
    }],
    promptAccepted: true,
    promptEventId: promptId,
    providerSessionId: sessionId,
    sessionId,
    source: "codex-session",
    submittedAt,
    transcriptExplicitCompletionCanSettleTurn: true,
    threadId,
    workspaceId,
  });

  const thread = hydrated[workspaceId].threads[threadId];
  assert.equal(thread.latestTurn.state, "completed");
  assert.equal(thread.latestTurn.turnId, turnId);
  assert.equal(thread.activityStatus, "idle");
  assert.equal(thread.messages[0].text, "i need your help");
  assert.equal(thread.transcriptSessionId, sessionId);
  assert.equal(thread.providerBindings.codex.inputReady, false);
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
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activityStatus: "thinking",
          currentAgent: "codex",
          latestTurn: {
            messageId: promptId,
            startedAt: submittedAt,
            state: "running",
            turnId,
          },
          messages: [{
            createdAt: submittedAt,
            id: promptId,
            role: "user",
            text: "interesting",
            turnId,
          }],
          projectionEvents: [{
            agentId: "codex",
            createdAt: submittedAt,
            id: "turn-start",
            messageId: promptId,
            status: "running",
            turnId,
            type: "thread.turn.started",
          }, {
            agentId: "codex",
            createdAt: submittedAt,
            id: "user-message",
            messageId: promptId,
            role: "user",
            source: "codex-session",
            status: "submitted",
            text: "interesting",
            turnId,
            type: "thread.message.user",
          }],
          providerBindings: {
            codex: {
              activityStatus: "thinking",
              inputReady: false,
              nativeSessionId: sessionId,
              nativeSessionKind: "session",
              status: "active",
            },
          },
          status: "active",
          terminalIndex: 0,
          transcriptSessionId: sessionId,
          workspaceId,
        },
      },
    },
  };

  const hydrated = hydrateWorkspaceThreadSessionTranscript(state, {
    agentId: "codex",
    expectedMessageCreatedAt: submittedAt,
    expectedUserMessage: "interesting",
    matchedBy: "sessionId",
    messages: [{
      createdAt: submittedAt,
      id: promptId,
      role: "user",
      text: "interesting",
    }, {
      createdAt: laterSubmittedAt,
      id: "later-user",
      role: "user",
      text: "new task",
    }, {
      createdAt: completedAt,
      id: "task-complete",
      kind: "task_complete",
      role: "assistant",
      text: "Done.",
    }],
    promptAccepted: true,
    promptEventId: promptId,
    providerSessionId: sessionId,
    sessionId,
    source: "codex-session",
    submittedAt,
    threadId,
    workspaceId,
  });

  const hydratedThread = hydrated[workspaceId].threads[threadId];
  assert.equal(hydratedThread.latestTurn.state, "running");
  assert.equal(hydratedThread.activityStatus, "idle");
});

test("terminal hook activity preserves agent display identity", () => {
  const workspaceId = "workspace-agent-label";
  const threadId = "thread-agent-label";
  const paneId = "pane-agent-label";
  const state = {
    [workspaceId]: {
      id: workspaceId,
      terminalOrder: ["0"],
      terminals: {
        0: {
          agentId: "codex",
          instanceId: 1,
          paneId,
          status: "active",
          terminalIndex: 0,
          threadId,
        },
      },
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activityStatus: "idle",
          currentAgent: "codex",
          messages: [],
          providerBindings: {
            codex: {
              activityStatus: "idle",
              inputReady: true,
              status: "active",
              terminalBinding: {
                instanceId: 1,
                paneId,
                terminalIndex: 0,
              },
            },
          },
          status: "active",
          terminalBinding: {
            instanceId: 1,
            paneId,
            terminalIndex: 0,
          },
          terminalIndex: 0,
          workspaceId,
        },
      },
    },
  };

  const next = markWorkspaceThreadAgentActivity(state, {
    activityStatus: "thinking",
    agentDisplayName: "code-reviewer",
    agentId: "codex",
    agentType: "reviewer",
    instanceId: 1,
    paneId,
    provider: "codex",
    terminalIndex: 0,
    threadId,
    type: "provider-turn-started",
    workspaceId,
  });

  const binding = next[workspaceId].threads[threadId].providerBindings.codex;
  const terminal = next[workspaceId].terminals[0];
  assert.equal(binding.agentDisplayName, "code-reviewer");
  assert.equal(binding.agentType, "reviewer");
  assert.equal(binding.provider, "codex");
  assert.equal(terminal.agentDisplayName, "code-reviewer");
  assert.equal(terminal.agentType, "reviewer");
  assert.equal(terminal.provider, "codex");
});

test("workspace terminals get unique stable short nicknames", () => {
  const workspaceId = "workspace-terminal-names";
  const next = [0, 1, 2].reduce((state, terminalIndex) => (
    materializeWorkspaceThreadForTerminal(state, {
      agentId: "codex",
      instanceId: terminalIndex + 1,
      paneId: `pane-${terminalIndex}`,
      terminalIndex,
      threadId: `thread-${terminalIndex}`,
      type: "message-submitted",
      userMessage: `hello ${terminalIndex}`,
      workspaceId,
    })
  ), {});

  const entry = next[workspaceId];
  const nicknames = entry.threadOrder.map((threadId) => {
    const thread = entry.threads[threadId];
    const terminal = entry.terminals[String(thread.terminalIndex)];
    const binding = thread.providerBindings.codex;
    const nickname = getWorkspaceThreadTerminalNickname(thread, binding, terminal);
    assert.match(nickname, /^[A-Z][a-z]{1,3}$/);
    assert.equal(thread.terminalNickname, nickname);
    assert.equal(thread.terminalName, nickname);
    assert.equal(binding.terminalNickname, nickname);
    assert.equal(terminal.terminalNickname, nickname);
    return nickname;
  });
  assert.equal(new Set(nicknames).size, nicknames.length);

  const persisted = persistWorkspaceThreads(next);
  const persistedNicknames = entry.threadOrder.map((threadId) => (
    persisted[workspaceId].threads[threadId].terminalNickname
  ));
  assert.deepEqual(persistedNicknames, nicknames);
  assert.equal(Object.keys(persisted[workspaceId].terminals).length, 0);
});

test("workspace terminal nickname reconciliation keeps one duplicate per workspace", () => {
  const workspaceId = "workspace-terminal-name-dupes";
  const normalized = normalizeWorkspaceThreads({
    [workspaceId]: {
      terminalThreadIds: {
        0: "thread-a",
        1: "thread-b",
      },
      threadOrder: ["thread-a", "thread-b"],
      threads: {
        "thread-a": {
          currentAgent: "codex",
          id: "thread-a",
          materialized: true,
          providerBindings: {
            codex: {
              terminalNickname: "Bob",
            },
          },
          terminalIndex: 0,
          terminalNickname: "Bob",
          workspaceId,
        },
        "thread-b": {
          currentAgent: "codex",
          id: "thread-b",
          materialized: true,
          providerBindings: {
            codex: {
              terminalNickname: "Bob",
            },
          },
          terminalIndex: 1,
          terminalNickname: "Bob",
          workspaceId,
        },
      },
    },
  });
  const entry = normalized[workspaceId];
  const first = entry.threads["thread-a"].terminalNickname;
  const second = entry.threads["thread-b"].terminalNickname;

  assert.equal(first, "Bob");
  assert.match(second, /^[A-Z][a-z]{1,3}$/);
  assert.notEqual(second, first);
});

test("existing terminal nickname wins over hook agent display name", () => {
  const workspaceId = "workspace-terminal-name-hook";
  const state = materializeWorkspaceThreadForTerminal({}, {
    agentDisplayName: "reviewer",
    agentId: "codex",
    agentType: "reviewer",
    instanceId: 1,
    paneId: "pane-hook",
    status: "active",
    terminalIndex: 0,
    terminalNickname: "Ali",
    threadId: "thread-hook",
    type: "message-submitted",
    userMessage: "start",
    workspaceId,
  });
  const next = markWorkspaceThreadAgentActivity(state, {
    activityStatus: "thinking",
    agentDisplayName: "code-reviewer",
    agentId: "codex",
    agentType: "reviewer",
    instanceId: 1,
    paneId: "pane-hook",
    terminalIndex: 0,
    threadId: "thread-hook",
    type: "provider-turn-started",
    workspaceId,
  });
  const thread = next[workspaceId].threads["thread-hook"];
  const terminal = next[workspaceId].terminals[0];
  const binding = thread.providerBindings.codex;

  assert.equal(binding.agentDisplayName, "code-reviewer");
  assert.equal(getWorkspaceThreadTerminalNickname(thread, binding, terminal), "Ali");
});

test("workspace terminal nickname survives close and reopen", () => {
  const workspaceId = "workspace-terminal-name-reopen";
  const threadId = "thread-reopen";
  const state = materializeWorkspaceThreadForTerminal({}, {
    agentId: "codex",
    instanceId: 1,
    paneId: "pane-reopen-1",
    status: "active",
    terminalIndex: 0,
    threadId,
    type: "message-submitted",
    userMessage: "start",
    workspaceId,
  });
  const firstThread = state[workspaceId].threads[threadId];
  const firstTerminal = state[workspaceId].terminals[0];
  const firstNickname = getWorkspaceThreadTerminalNickname(
    firstThread,
    firstThread.providerBindings.codex,
    firstTerminal,
  );

  assert.ok(firstNickname);

  const closed = markWorkspaceThreadTerminalDetached(state, {
    agentId: "codex",
    instanceId: 1,
    paneId: "pane-reopen-1",
    status: "closed",
    terminalIndex: 0,
    threadId,
    workspaceId,
  });
  assert.equal(closed[workspaceId].terminals[0], undefined);

  const restored = normalizeWorkspaceThreads(persistWorkspaceThreads(closed));
  assert.equal(restored[workspaceId].terminalThreadIds[0], threadId);
  assert.equal(restored[workspaceId].threads[threadId].terminalNickname, firstNickname);

  const reopened = updateWorkspaceActiveTerminal(restored, {
    agentId: "codex",
    instanceId: 2,
    paneId: "pane-reopen-2",
    status: "active",
    terminalIndex: 0,
    type: "opened",
    workspaceId,
  });
  const reopenedThread = reopened[workspaceId].threads[threadId];
  const reopenedTerminal = reopened[workspaceId].terminals[0];

  assert.equal(reopenedTerminal.threadId, threadId);
  assert.equal(
    getWorkspaceThreadTerminalNickname(
      reopenedThread,
      reopenedThread.providerBindings.codex,
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
    agentId: "codex",
    instanceId: 1,
    nativeSessionId: sessionId,
    paneId: "pane-session-reopen-1",
    providerSessionId: sessionId,
    status: "active",
    terminalIndex: 0,
    threadId,
    type: "message-submitted",
    userMessage: "resume me later",
    workspaceId,
  });
  const bound = updateWorkspaceThreadProviderSession(active, {
    agentId: "codex",
    instanceId: 1,
    nativeSessionId: sessionId,
    paneId: "pane-session-reopen-1",
    providerSessionId: sessionId,
    terminalIndex: 0,
    threadId,
    workspaceId,
  });
  const closed = markWorkspaceThreadTerminalDetached(bound, {
    agentId: "codex",
    instanceId: 1,
    paneId: "pane-session-reopen-1",
    status: "closed",
    terminalIndex: 0,
    threadId,
    workspaceId,
  });

  const restored = normalizeWorkspaceThreads(persistWorkspaceThreads(closed));
  const restoredThread = getWorkspaceThreadForTerminalIndex(restored, workspaceId, "0");

  assert.equal(restored[workspaceId].terminals[0], undefined);
  assert.equal(restored[workspaceId].terminalThreadIds[0], threadId);
  assert.equal(restoredThread?.id, threadId);
  assert.equal(restoredThread?.terminalBinding, null);
  assert.equal(restoredThread?.transcriptSessionId, sessionId);
  assert.equal(restoredThread?.providerBindings.codex.nativeSessionId, sessionId);
});

test("live terminal thread selection prefers the current provider session over a cached terminal thread", () => {
  const workspaceId = "workspace-live-selection-session";
  const staleThreadId = "thread-stale-terminal-session";
  const currentThreadId = "thread-current-terminal-session";
  const state = normalizeWorkspaceThreads({
    [workspaceId]: {
      activeThreadId: staleThreadId,
      terminalThreadIds: {
        0: staleThreadId,
      },
      terminals: {
        0: {
          agentId: "codex",
          instanceId: 11,
          paneId: "pane-live-selection",
          providerSessionId: "old-session",
          status: "active",
          terminalIndex: 0,
          threadId: staleThreadId,
        },
      },
      threadOrder: [staleThreadId, currentThreadId],
      threads: {
        [staleThreadId]: {
          currentAgent: "codex",
          id: staleThreadId,
          materialized: true,
          providerBindings: {
            codex: {
              nativeSessionId: "old-session",
            },
          },
          status: "active",
          terminalIndex: 0,
          transcriptSessionId: "old-session",
          workspaceId,
        },
        [currentThreadId]: {
          currentAgent: "codex",
          id: currentThreadId,
          materialized: true,
          providerBindings: {
            codex: {
              nativeSessionId: "current-session",
              terminalBinding: {
                instanceId: 12,
                paneId: "pane-live-selection",
                terminalIndex: 0,
              },
            },
          },
          status: "active",
          terminalIndex: 0,
          transcriptSessionId: "current-session",
          workspaceId,
        },
      },
    },
  });

  const selectedThreadId = getWorkspaceThreadSelectionForLiveTerminal(state[workspaceId], {
    agentId: "codex",
    instanceId: 12,
    paneId: "pane-live-selection",
    providerSessionId: "current-session",
    terminalIndex: 0,
    threadId: staleThreadId,
  });

  assert.equal(selectedThreadId, currentThreadId);
});

test("live terminal thread selection uses a sessionless thread for no-session coding terminals", () => {
  const workspaceId = "workspace-live-selection-yellow";
  const staleThreadId = "thread-stale-session";
  const sessionlessThreadId = "thread-yellow-sessionless";
  const state = normalizeWorkspaceThreads({
    [workspaceId]: {
      activeThreadId: staleThreadId,
      terminalThreadIds: {
        0: staleThreadId,
      },
      terminals: {
        0: {
          agentId: "codex",
          instanceId: 21,
          paneId: "pane-yellow-selection",
          providerSessionId: "old-session",
          status: "active",
          terminalIndex: 0,
          threadId: staleThreadId,
        },
      },
      threadOrder: [staleThreadId, sessionlessThreadId],
      threads: {
        [staleThreadId]: {
          currentAgent: "codex",
          id: staleThreadId,
          materialized: true,
          providerBindings: {
            codex: {
              nativeSessionId: "old-session",
            },
          },
          status: "active",
          terminalIndex: 0,
          transcriptSessionId: "old-session",
          workspaceId,
        },
        [sessionlessThreadId]: {
          currentAgent: "codex",
          id: sessionlessThreadId,
          materialized: true,
          providerBindings: {
            codex: {
              terminalBinding: {
                instanceId: 22,
                paneId: "pane-yellow-selection",
                terminalIndex: 0,
              },
            },
          },
          status: "active",
          terminalBinding: {
            instanceId: 22,
            paneId: "pane-yellow-selection",
            terminalIndex: 0,
          },
          terminalIndex: 0,
          workspaceId,
        },
      },
    },
  });

  const selectedThreadId = getWorkspaceThreadSelectionForLiveTerminal(state[workspaceId], {
    agentId: "codex",
    instanceId: 22,
    paneId: "pane-yellow-selection",
    terminalIndex: 0,
    threadId: staleThreadId,
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
          agentId: "codex",
          inputReady: false,
          instanceId: 1,
          paneId,
          status: "active",
          terminalIndex: 0,
          threadId,
        },
      },
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activityStatus: "thinking",
          currentAgent: "codex",
          latestTurn: {
            messageId: promptId,
            startedAt,
            state: "running",
            turnId,
          },
          messages: [{
            createdAt: startedAt,
            id: promptId,
            role: "user",
            text: "cancel me",
            turnId,
          }],
          materialized: true,
          pendingPrompt: {
            id: promptId,
          },
          projectionEvents: [{
            agentId: "codex",
            createdAt: startedAt,
            id: "turn-start",
            messageId: promptId,
            status: "running",
            turnId,
            type: "thread.turn.started",
          }],
          providerBindings: {
            codex: {
              activityStatus: "thinking",
              inputReady: false,
              status: "active",
              terminalBinding: {
                instanceId: 1,
                paneId,
                terminalIndex: 0,
              },
            },
          },
          status: "active",
          terminalBinding: {
            instanceId: 1,
            paneId,
            terminalIndex: 0,
          },
          terminalIndex: 0,
          workspaceId,
        },
      },
    },
  };

  const next = appendWorkspaceThreadProjectionEvents(state, {
    activityStatus: "idle",
    agentId: "codex",
    clearPendingPrompt: true,
    inputReady: true,
    inputReadyAt: interruptedAt,
    inputReadyConfidence: "escape_key_task_interrupted",
    instanceId: 1,
    paneId,
    projectionEvents: [{
      agentId: "codex",
      completedAt: interruptedAt,
      createdAt: interruptedAt,
      id: "turn-interrupted",
      messageId: promptId,
      status: "interrupted",
      turnId,
      type: "thread.turn.interrupted",
    }],
    status: "active",
    terminalIndex: 0,
    threadId,
    type: "provider-turn-interrupted",
    workspaceId,
  });

  const thread = next[workspaceId].threads[threadId];
  assert.equal(thread.latestTurn.state, "interrupted");
  assert.equal(thread.activityStatus, "idle");
  assert.equal(thread.pendingPrompt, null);
  assert.equal(thread.providerBindings.codex.inputReady, true);
  assert.equal(thread.providerBindings.codex.activityStatus, "idle");
  assert.equal(next[workspaceId].terminals[0].inputReady, true);
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
    mimeType: "image/svg+xml",
    path: "/tmp/diffforge/chocolate.svg",
    prompt: "dark chocolate squares on a slate plate",
    title: "Chocolate preview",
    url: "file:///tmp/diffforge/chocolate.svg",
  };

  const state = {
    [workspaceId]: {
      id: workspaceId,
      threadOrder: [threadId],
      threads: {
        [threadId]: {
          id: threadId,
          activityStatus: "thinking",
          currentAgent: "codex",
          latestTurn: {
            messageId: promptId,
            promptEpoch: 2,
            startedAt: submittedAt,
            state: "running",
            turnId,
          },
          messages: [{
            createdAt: submittedAt,
            id: promptId,
            role: "user",
            text: "make an image of chocolate",
            turnId,
          }],
          projectionEvents: [{
            agentId: "codex",
            createdAt: submittedAt,
            id: "turn-start",
            messageId: promptId,
            promptEpoch: 2,
            status: "running",
            turnId,
            type: "thread.turn.started",
          }, {
            agentId: "codex",
            createdAt: submittedAt,
            id: "user-message",
            messageId: promptId,
            role: "user",
            status: "submitted",
            text: "make an image of chocolate",
            turnId,
            type: "thread.message.user",
          }],
          providerBindings: {
            codex: {
              activityStatus: "thinking",
              inputReady: false,
              nativeSessionId: sessionId,
              nativeSessionKind: "session",
              status: "active",
            },
          },
          status: "active",
          terminalBinding: {
            instanceId: 1,
            paneId: "pane-image-test",
            terminalIndex: 0,
          },
          terminalIndex: 0,
          transcriptSessionId: sessionId,
          workspaceId,
        },
      },
    },
  };

  const nextState = hydrateWorkspaceThreadSessionTranscript(state, {
    agentId: "codex",
    allowTranscriptTurnCompletion: true,
    completedAt,
    expectedMessageCreatedAt: submittedAt,
    expectedUserMessage: "make an image of chocolate",
    latestTimestamp: completedAt,
    matchedBy: "sessionId",
    messages: [{
      createdAt: submittedAt,
      id: promptId,
      role: "user",
      text: "make an image of chocolate",
    }, {
      artifacts: [artifact],
      createdAt: completedAt,
      id: "generated-image",
      kind: "image_generation",
      role: "activity",
      text: "",
      title: "Generated image",
    }, {
      createdAt: completedAt,
      id: "task-complete",
      kind: "task_complete",
      role: "assistant",
      text: "Generated a fresh chocolate image preview.",
    }],
    promptAccepted: true,
    promptEpoch: 2,
    promptEventId: promptId,
    providerSessionId: sessionId,
    sessionId,
    source: "codex-session",
    submittedAt,
    transcriptExplicitCompletionCanSettleTurn: true,
    turnCompleteSeen: true,
    workspaceId,
    threadId,
  });

  const nextThread = nextState[workspaceId].threads[threadId];
  const imageMessage = nextThread.messages.find((message) => message.id === "generated-image");
  assert.equal(imageMessage?.role, "activity");
  assert.equal(imageMessage?.kind, "image_generation");
  assert.equal(imageMessage?.artifacts?.length, 1);
  assert.equal(imageMessage.artifacts[0].mimeType, "image/svg+xml");
  assert.equal(imageMessage.artifacts[0].url, "file:///tmp/diffforge/chocolate.svg");

  const imageProjectionEvent = nextThread.projectionEvents.find((event) => event.messageId === "generated-image");
  assert.equal(imageProjectionEvent?.type, "thread.activity");
  assert.equal(imageProjectionEvent?.artifacts?.length, 1);
  assert.equal(imageProjectionEvent.artifacts[0].path, "/tmp/diffforge/chocolate.svg");
});

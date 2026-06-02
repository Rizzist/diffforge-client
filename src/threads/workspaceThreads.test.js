import assert from "node:assert/strict";
import test from "node:test";

import {
  appendWorkspaceThreadProjectionEvents,
  clearWorkspaceThreadPendingPrompt,
  hydrateWorkspaceThreadSessionTranscript,
  markWorkspaceThreadAgentActivity,
  materializeWorkspaceThreadForTerminal,
  normalizeWorkspaceThreads,
} from "./workspaceThreads.js";

test("session transcript completion settles the active running turn", () => {
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
  assert.equal(nextThread.providerBindings.codex.inputReady, true);
  assert.equal(
    nextThread.providerBindings.codex.inputReadyConfidence,
    "transcript-explicit-completion",
  );
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

test("session acceptance clears a locally pending submitted prompt", () => {
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
  assert.equal(acceptedThread.pendingPrompt, null);
  assert.equal(acceptedThread.latestTurn.state, "running");
  assert.equal(acceptedThread.activityStatus, "thinking");
});

test("session acceptance clears pending prompts when transcript ids include the thread prefix", () => {
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

  assert.equal(accepted[workspaceId].threads[threadId].pendingPrompt, null);
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

test("prompt-ready can make a terminal visually idle without releasing pending session acceptance", () => {
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
  assert.equal(nextThread.providerBindings.codex.inputReady, true);
  assert.equal(nextThread.providerBindings.codex.inputReadyAt, promptReadyAt);

  const terminal = nextState[workspaceId].terminals["0"];
  assert.equal(terminal.inputReady, true);
  assert.equal(terminal.inputReadyAt, promptReadyAt);
  assert.equal(terminal.status, "active");

  const normalizedState = normalizeWorkspaceThreads(nextState);
  const normalizedThread = normalizedState[workspaceId].threads[threadId];
  assert.equal(normalizedThread.activityStatus, "idle");
  assert.equal(normalizedThread.latestTurn.state, "running");
  assert.equal(normalizedThread.pendingPrompt.id, promptId);
  assert.equal(normalizedThread.providerBindings.codex.inputReady, true);
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
    threadId,
    workspaceId,
  });

  const hydratedThread = hydrated[workspaceId].threads[threadId];
  assert.equal(hydratedThread.status, "exited");
  assert.equal(hydratedThread.latestTurn.state, "completed");
  assert.equal(hydratedThread.activityStatus, "idle");
  assert.equal(hydratedThread.providerBindings.codex.activityStatus, "idle");
  assert.equal(hydratedThread.providerBindings.codex.inputReady, true);
  assert.equal(
    hydratedThread.providerBindings.codex.inputReadyConfidence,
    "transcript-explicit-completion",
  );
});

test("timestamp recovered transcript settles queued running turn without prior user projection", () => {
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
    threadId,
    workspaceId,
  });

  const thread = hydrated[workspaceId].threads[threadId];
  assert.equal(thread.latestTurn.state, "completed");
  assert.equal(thread.latestTurn.turnId, turnId);
  assert.equal(thread.activityStatus, "idle");
  assert.equal(thread.messages[0].text, "i need your help");
  assert.equal(thread.transcriptSessionId, sessionId);
  assert.equal(thread.providerBindings.codex.inputReady, true);
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
  assert.equal(hydratedThread.activityStatus, "thinking");
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

import assert from "node:assert/strict";
import test from "node:test";

import {
  appendWorkspaceThreadProjectionEvents,
  hydrateWorkspaceThreadSessionTranscript,
  materializeWorkspaceThreadForTerminal,
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

test("detached session transcript hydration does not revive idle thread as thinking", () => {
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
  assert.equal(hydratedThread.latestTurn.state, "running");
  assert.equal(hydratedThread.activityStatus, "idle");
  assert.equal(hydratedThread.providerBindings.codex.activityStatus, "idle");
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

import assert from "node:assert/strict";
import test from "node:test";

import { hydrateWorkspaceThreadSessionTranscript } from "./workspaceThreads.js";

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

import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateTodoQueueInFlightPrompt,
  getTodoQueuePromptCompletionEvidence,
} from "./todoQueueLaneState.js";

const submittedAt = "2026-06-01T01:34:53.669Z";
const submittedAtMs = Date.parse(submittedAt);

function baseEvaluation(overrides = {}) {
  return evaluateTodoQueueInFlightPrompt({
    effectiveActivityStatus: "idle",
    effectiveLatestTurnState: "completed",
    inFlightPrompt: {
      accepted: true,
      itemId: "todo-1",
      promptId: "todo-drop-prompt-1",
      promptText: "i want to make some pages",
      startedAtMs: submittedAtMs,
      submittedAt,
      submittedAtMs,
      terminalInstanceId: 4,
      threadId: "thread-1",
    },
    liveTerminal: {
      inputReady: true,
      inputReadyAt: "2026-06-01T01:34:53.775Z",
      instanceId: 4,
      status: "active",
      threadId: "thread-1",
    },
    providerBinding: {
      inputReady: true,
      inputReadyAt: "2026-06-01T01:34:53.775Z",
      nativeSessionId: "session-1",
      status: "active",
    },
    nowMs: submittedAtMs + 5000,
    terminalGroundTruth: {
      agentInputReady: true,
      completedTurnLooksSendable: true,
      effectiveActivityStatus: "idle",
      effectiveLatestTurnState: "completed",
      hasPendingPrompt: false,
      runningTurnLooksIdle: false,
    },
    terminalStatus: "active",
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "codex-82-user",
        startedAt: submittedAt,
        state: "completed",
        turnId: "turn-thread-1-codex-82-user",
      },
      messages: [{
        createdAt: submittedAt,
        id: "codex-82-user",
        role: "user",
        text: "i want to make some pages",
      }],
      transcriptSessionId: "session-1",
    },
    ...overrides,
  });
}

test("accepted queued prompt is not complete just because input is fresh again", () => {
  const evaluation = baseEvaluation();

  assert.equal(evaluation.latestUserPromptMatches, true);
  assert.equal(evaluation.freshInputReady, true);
  assert.equal(evaluation.promptTurnMatches, false);
  assert.equal(evaluation.promptUserMessageSeen, true);
  assert.equal(evaluation.assistantTextAfterPrompt, false);
  assert.equal(evaluation.terminalConfirmedFinished, false);
  assert.equal(evaluation.releaseReason, "");
});

test("queued prompt completes after exact prompt has a later assistant completion", () => {
  const evaluation = baseEvaluation({
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "codex-82-user",
        startedAt: submittedAt,
        state: "completed",
        turnId: "turn-thread-1-codex-82-user",
      },
      messages: [{
        createdAt: submittedAt,
        id: "codex-82-user",
        role: "user",
        text: "i want to make some pages",
      }, {
        createdAt: "2026-06-01T01:35:12.000Z",
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        status: "complete",
        text: "Sure, I can build those pages.",
      }],
      transcriptSessionId: "session-1",
    },
  });

  assert.equal(evaluation.promptTurnMatches, false);
  assert.equal(evaluation.assistantCompletionAfterPrompt, true);
  assert.equal(evaluation.exactPromptTranscriptFinished, true);
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "terminal_confirmed_finished");
});

test("exact matching turn id can release the terminal lane when closed", () => {
  const evaluation = baseEvaluation({
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "todo-drop-prompt-1",
        startedAt: submittedAt,
        state: "completed",
        turnId: "turn-todo-drop-prompt-1",
      },
      messages: [{
        createdAt: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }],
      transcriptSessionId: "session-1",
    },
  });

  assert.equal(evaluation.promptTurnMatches, true);
  assert.equal(evaluation.completedMatchingTurn, true);
  assert.equal(evaluation.terminalConfirmedFinished, true);
});

test("terminal restart releases the stale lane without claiming task completion", () => {
  const evaluation = baseEvaluation({
    liveTerminal: {
      inputReady: true,
      inputReadyAt: "2026-06-01T01:35:20.000Z",
      instanceId: 5,
      status: "active",
      threadId: "thread-1",
    },
  });

  assert.equal(evaluation.terminalConfirmedFinished, false);
  assert.equal(evaluation.terminalInstanceChanged, true);
  assert.equal(evaluation.releaseReason, "terminal_instance_changed");
});

test("completion evidence ignores assistant output before the queued prompt", () => {
  const evidence = getTodoQueuePromptCompletionEvidence({
    messages: [{
      id: "assistant-before",
      role: "assistant",
      status: "complete",
      text: "Previous answer.",
    }, {
      createdAt: submittedAt,
      id: "codex-82-user",
      role: "user",
      text: "i want to make some pages",
    }],
    promptText: "i want to make some pages",
    submittedAtMs,
  });

  assert.equal(evidence.promptUserMessageSeen, true);
  assert.equal(evidence.assistantTextAfterPrompt, false);
  assert.equal(evidence.assistantCompletionAfterPrompt, false);
});

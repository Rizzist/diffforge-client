import assert from "node:assert/strict";
import test from "node:test";

import { evaluateTodoQueueInFlightPrompt } from "./todoQueueLaneState.js";

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

  assert.equal(evaluation.latestUserPromptMatches, false);
  assert.equal(evaluation.freshInputReady, true);
  assert.equal(evaluation.promptTurnMatches, false);
  assert.equal(evaluation.promptUserMessageSeen, false);
  assert.equal(evaluation.assistantTextAfterPrompt, false);
  assert.equal(evaluation.terminalConfirmedFinished, false);
  assert.equal(evaluation.releaseReason, "");
});

test("queued prompt is released when its terminal closes before acceptance", () => {
  const evaluation = baseEvaluation({
    effectiveActivityStatus: "idle",
    effectiveLatestTurnState: "",
    inFlightPrompt: {
      accepted: false,
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
      inputReady: false,
      instanceId: 4,
      status: "exited",
      threadId: "thread-1",
      terminalLifecycle: "closed",
    },
    providerBinding: null,
    terminalStatus: "exited",
    targetThread: {
      id: "thread-1",
      messages: [],
      status: "exited",
    },
  });

  assert.equal(evaluation.terminalClosed, true);
  assert.equal(evaluation.releaseReason, "terminal_closed");
});

test("queued prompt is released when its terminal disappears before acceptance", () => {
  const evaluation = baseEvaluation({
    effectiveActivityStatus: "",
    effectiveLatestTurnState: "",
    inFlightPrompt: {
      accepted: false,
      itemId: "todo-1",
      promptId: "todo-drop-prompt-1",
      promptText: "i want to make some pages",
      startedAtMs: submittedAtMs,
      submittedAt,
      submittedAtMs,
      terminalInstanceId: 4,
      threadId: "thread-1",
    },
    liveTerminal: null,
    providerBinding: null,
    terminalStatus: "",
    targetThread: {
      id: "thread-1",
      messages: [],
    },
  });

  assert.equal(evaluation.terminalUnavailable, true);
  assert.equal(evaluation.releaseReason, "terminal_unavailable");
});

test("queued prompt completes after its provider turn closes", () => {
  const evaluation = baseEvaluation({
    targetThread: {
      id: "thread-1",
      latestTurn: {
        completedSource: "cli-hook:provider-turn-completed",
        messageId: "todo-drop-prompt-1",
        source: "cli-hook:user-prompt-submit",
        startedAt: submittedAt,
        state: "completed",
        turnId: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        createdAt: submittedAt,
        id: "todo-drop-prompt-1",
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

  assert.equal(evaluation.promptTurnMatches, true);
  assert.equal(evaluation.assistantCompletionAfterPrompt, false);
  assert.equal(evaluation.exactPromptTranscriptFinished, false);
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "provider_turn_closed");
});

test("hook-managed queued prompt releases from provider turn closure", () => {
  const evaluation = baseEvaluation({
    hookManaged: true,
    targetThread: {
      id: "thread-1",
      latestTurn: {
        completedSource: "cli-hook:provider-turn-completed",
        messageId: "todo-drop-prompt-1",
        source: "cli-hook:user-prompt-submit",
        startedAt: submittedAt,
        state: "completed",
        turnId: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        createdAt: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        createdAt: "2026-06-01T01:35:12.000Z",
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        status: "complete",
        text: "Done.",
      }],
      transcriptSessionId: "session-1",
    },
  });

  assert.equal(evaluation.hookManaged, true);
  assert.equal(evaluation.promptTurnMatches, true);
  assert.equal(evaluation.exactPromptTranscriptFinished, false);
  assert.equal(evaluation.latestTurnClosedByLifecycle, true);
  assert.equal(evaluation.terminalReadyForNextPrompt, true);
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "provider_turn_closed");
});

test("hook-managed queued prompt does not release from transcript-shaped closure", () => {
  const evaluation = baseEvaluation({
    hookManaged: true,
    targetThread: {
      id: "thread-1",
      latestTurn: {
        completedSource: "codex-session-watch",
        messageId: "todo-drop-prompt-1",
        source: "codex-session",
        startedAt: submittedAt,
        state: "completed",
        turnId: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        createdAt: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        createdAt: "2026-06-01T01:35:12.000Z",
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        status: "complete",
        text: "Done.",
      }],
      transcriptSessionId: "session-1",
    },
  });

  assert.equal(evaluation.hookManaged, true);
  assert.equal(evaluation.promptTurnMatches, true);
  assert.equal(evaluation.latestTurnClosedByLifecycle, false);
  assert.equal(evaluation.terminalReadyForNextPrompt, true);
  assert.equal(evaluation.terminalConfirmedFinished, false);
  assert.equal(evaluation.releaseReason, "");
});

test("hook-managed lifecycle completion waits for terminal readiness", () => {
  const evaluation = baseEvaluation({
    effectiveActivityStatus: "thinking",
    effectiveLatestTurnState: "running",
    hookManaged: true,
    inFlightPrompt: {
      accepted: true,
      itemId: "todo-1",
      lifecycleCompleted: true,
      lifecycleCompletionReason: "provider_turn_closed",
      promptId: "todo-drop-prompt-1",
      promptText: "i want to make some pages",
      startedAtMs: submittedAtMs,
      submittedAt,
      submittedAtMs,
      terminalInstanceId: 4,
      threadId: "thread-1",
    },
    liveTerminal: {
      inputReady: false,
      instanceId: 4,
      status: "active",
      threadId: "thread-1",
    },
    providerBinding: {
      inputReady: false,
      nativeSessionId: "session-1",
      status: "active",
    },
    terminalGroundTruth: {
      agentInputReady: false,
      completedTurnLooksSendable: false,
      effectiveActivityStatus: "thinking",
      effectiveLatestTurnState: "running",
      hasPendingPrompt: false,
      runningTurnLooksIdle: false,
    },
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "todo-drop-prompt-1",
        source: "cli-hook:user-prompt-submit",
        startedAt: submittedAt,
        state: "running",
        turnId: "turn-thread-1-todo-drop-prompt-1",
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

  assert.equal(evaluation.providerLifecycleCompleted, true);
  assert.equal(evaluation.terminalReadyCompletionSignal, false);
  assert.equal(evaluation.terminalConfirmedFinished, false);
  assert.equal(evaluation.releaseReason, "");
});

test("hook-managed queued prompt does not accept from matching transcript state", () => {
  const evaluation = baseEvaluation({
    hookManaged: true,
    inFlightPrompt: {
      accepted: false,
      itemId: "todo-1",
      promptId: "todo-drop-prompt-1",
      promptText: "i want to make some pages",
      startedAtMs: submittedAtMs,
      submittedAt,
      submittedAtMs,
      terminalInstanceId: 4,
      threadId: "thread-1",
    },
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "todo-drop-prompt-1",
        startedAt: submittedAt,
        state: "running",
        turnId: "turn-thread-1-todo-drop-prompt-1",
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

  assert.equal(evaluation.sessionAcceptedByThread, false);
  assert.equal(evaluation.effectivePromptAccepted, false);
  assert.equal(evaluation.releaseReason, "");
});

test("queued prompt does not release when transcript completion belongs to a different prompt", () => {
  const evaluation = baseEvaluation({
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "todo-drop-prompt-newer",
        startedAt: submittedAt,
        state: "completed",
        turnId: "turn-thread-1-todo-drop-prompt-newer",
      },
      messages: [{
        createdAt: submittedAt,
        id: "todo-drop-prompt-1",
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
  assert.equal(evaluation.assistantCompletionAfterPrompt, false);
  assert.equal(evaluation.exactPromptTranscriptFinished, false);
  assert.equal(evaluation.terminalReadyForNextPrompt, true);
  assert.equal(evaluation.terminalConfirmedFinished, false);
  assert.equal(evaluation.releaseReason, "");
});

test("exact transcript completion does not release with stale terminal readiness", () => {
  const evaluation = baseEvaluation({
    liveTerminal: {
      inputReady: true,
      inputReadyAt: "2026-06-01T01:34:40.000Z",
      instanceId: 4,
      status: "idle",
      threadId: "thread-1",
    },
    providerBinding: {
      inputReady: true,
      inputReadyAt: "2026-06-01T01:34:40.000Z",
      nativeSessionId: "session-1",
      status: "idle",
    },
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "todo-drop-prompt-1",
        startedAt: submittedAt,
        state: "completed",
        turnId: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        createdAt: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        createdAt: "2026-06-01T01:35:12.000Z",
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        status: "complete",
        text: "Done.",
      }],
      transcriptSessionId: "session-1",
    },
  });

  assert.equal(evaluation.promptTurnMatches, true);
  assert.equal(evaluation.exactPromptTranscriptFinished, false);
  assert.equal(evaluation.freshInputReady, false);
  assert.equal(evaluation.terminalReadinessMatchesPrompt, false);
  assert.equal(evaluation.terminalConfirmedFinished, false);
  assert.equal(evaluation.releaseReason, "");
});

test("exact transcript completion does not release with mismatched readiness prompt id", () => {
  const evaluation = baseEvaluation({
    liveTerminal: {
      inputReady: true,
      inputReadyAt: "2026-06-01T01:35:12.000Z",
      instanceId: 4,
      promptEventId: "todo-drop-prompt-other",
      status: "idle",
      threadId: "thread-1",
    },
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "todo-drop-prompt-1",
        startedAt: submittedAt,
        state: "completed",
        turnId: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        createdAt: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        createdAt: "2026-06-01T01:35:12.000Z",
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        status: "complete",
        text: "Done.",
      }],
      transcriptSessionId: "session-1",
    },
  });

  assert.equal(evaluation.freshInputReady, true);
  assert.equal(evaluation.terminalReadinessPromptMatches, false);
  assert.equal(evaluation.terminalReadinessMatchesPrompt, false);
  assert.equal(evaluation.terminalReadyForNextPrompt, false);
  assert.equal(evaluation.terminalConfirmedFinished, false);
  assert.equal(evaluation.releaseReason, "");
});

test("exact transcript completion does not release while the terminal is not ready", () => {
  const evaluation = baseEvaluation({
    effectiveActivityStatus: "thinking",
    effectiveLatestTurnState: "running",
    liveTerminal: {
      inputReady: false,
      instanceId: 4,
      status: "active",
      threadId: "thread-1",
    },
    providerBinding: {
      inputReady: false,
      nativeSessionId: "session-1",
      status: "active",
    },
    terminalGroundTruth: {
      agentInputReady: false,
      completedTurnLooksSendable: false,
      effectiveActivityStatus: "thinking",
      effectiveLatestTurnState: "running",
      hasPendingPrompt: false,
      runningTurnLooksIdle: false,
    },
    terminalStatus: "active",
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "todo-drop-prompt-1",
        startedAt: submittedAt,
        state: "running",
        turnId: "turn-todo-drop-prompt-1",
      },
      messages: [{
        createdAt: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        createdAt: "2026-06-01T01:35:10.000Z",
        id: "assistant-task-complete",
        kind: "task_complete",
        role: "assistant",
        status: "complete",
        text: "Done.",
      }],
      transcriptSessionId: "session-1",
    },
  });

  assert.equal(evaluation.transcriptCompletionAfterPrompt, false);
  assert.equal(evaluation.exactPromptTranscriptFinished, false);
  assert.equal(evaluation.terminalReadyForNextPrompt, false);
  assert.equal(evaluation.latestTurnClosed, false);
  assert.equal(evaluation.terminalConfirmedFinished, false);
  assert.equal(evaluation.releaseReason, "");
});

test("idle terminal status can release an accepted completed queued prompt", () => {
  const evaluation = baseEvaluation({
    liveTerminal: {
      inputReady: true,
      inputReadyAt: "2026-06-01T01:35:12.000Z",
      instanceId: 4,
      status: "idle",
      threadId: "thread-1",
    },
    providerBinding: {
      inputReady: true,
      inputReadyAt: "2026-06-01T01:35:12.000Z",
      nativeSessionId: "session-1",
      status: "idle",
    },
    terminalStatus: "idle",
    targetThread: {
      id: "thread-1",
      latestTurn: {
        completedSource: "cli-hook:provider-turn-completed",
        messageId: "todo-drop-prompt-1",
        source: "cli-hook:user-prompt-submit",
        startedAt: submittedAt,
        state: "completed",
        turnId: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        createdAt: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        createdAt: "2026-06-01T01:35:10.000Z",
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        status: "complete",
        text: "Done.",
      }],
      transcriptSessionId: "session-1",
    },
  });

  assert.equal(evaluation.terminalReadyForNextPrompt, true);
  assert.equal(evaluation.promptTurnMatches, true);
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "provider_turn_closed");
});

test("exact matching turn id alone does not release a queued prompt", () => {
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
  assert.equal(evaluation.completedMatchingTurn, false);
  assert.equal(evaluation.exactPromptTranscriptFinished, false);
  assert.equal(evaluation.terminalConfirmedFinished, false);
  assert.equal(evaluation.releaseReason, "");
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

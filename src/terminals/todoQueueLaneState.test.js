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

test("terminal-direct Codex prompt completes from matching input-ready without closed turn", () => {
  const evaluation = baseEvaluation({
    effectiveActivityStatus: "idle",
    effectiveLatestTurnState: "completed",
    hookManaged: true,
    inFlightPrompt: {
      accepted: false,
      itemId: "terminal-direct-todo-drop-prompt-1",
      lifecycleSource: "tui-terminal-direct-input",
      promptId: "todo-drop-prompt-1",
      promptText: "i want to make some pages",
      source: "tui-terminal-direct-input",
      startedAtMs: submittedAtMs,
      submittedAt,
      submittedAtMs,
      terminalInstanceId: 4,
      threadId: "thread-1",
    },
    liveTerminal: {
      activityStatus: "idle",
      inputReady: true,
      inputReadyAt: "2026-06-01T01:35:12.000Z",
      instanceId: 4,
      promptEventId: "todo-drop-prompt-1",
      status: "idle",
      threadId: "thread-1",
    },
    terminalGroundTruth: {
      agentInputReady: true,
      completedTurnLooksSendable: true,
      effectiveActivityStatus: "idle",
      effectiveLatestTurnState: "completed",
      hasPendingPrompt: false,
      runningTurnLooksIdle: true,
    },
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "transcript-stale-message",
        startedAt: submittedAt,
        state: "running",
        turnId: "turn-thread-1-stale",
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

  assert.equal(evaluation.completedMatchingTurn, false);
  assert.equal(evaluation.promptTurnMatches, false);
  assert.equal(evaluation.terminalReadyForNextPrompt, true);
  assert.equal(evaluation.terminalReadinessMatchesPrompt, true);
  assert.equal(evaluation.terminalDirectReadyFinished, true);
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "provider_turn_closed");
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

test("queued prompt pauses when its terminal is parked", () => {
  const evaluation = baseEvaluation({
    effectiveActivityStatus: "resume_ready",
    terminalGroundTruth: {
      agentInputReady: false,
      completedTurnLooksSendable: false,
      effectiveActivityStatus: "resume_ready",
      effectiveLatestTurnState: "running",
      hasPendingPrompt: false,
      runningTurnLooksIdle: false,
    },
  });

  assert.equal(evaluation.releaseReason, "parked_task_resume_ready");
});

test("queued prompt completes after its provider turn closes", () => {
  const evaluation = baseEvaluation({
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
        text: "Sure, I can build those pages.",
      }],
      transcriptSessionId: "session-1",
    },
  });

  assert.equal(evaluation.promptTurnMatches, true);
  assert.equal(evaluation.assistantCompletionAfterPrompt, true);
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

  assert.equal(evaluation.hookManaged, true);
  assert.equal(evaluation.promptTurnMatches, true);
  assert.equal(evaluation.exactPromptTranscriptFinished, false);
  assert.equal(evaluation.terminalReadyForNextPrompt, true);
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "provider_turn_closed");
});

test("claude queued prompt interruption releases as interrupted", () => {
  const evaluation = baseEvaluation({
    hookManaged: true,
    effectiveLatestTurnState: "interrupted",
    terminalGroundTruth: {
      agentInputReady: true,
      completedTurnLooksSendable: true,
      effectiveActivityStatus: "interrupted",
      effectiveLatestTurnState: "interrupted",
      hasPendingPrompt: false,
      runningTurnLooksIdle: false,
    },
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "todo-drop-prompt-1",
        startedAt: submittedAt,
        state: "interrupted",
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

  assert.equal(evaluation.promptTurnMatches, true);
  assert.equal(evaluation.latestTurnClosed, true);
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "provider_turn_interrupted");
});

test("codex queued prompt cancellation releases as interrupted", () => {
  const evaluation = baseEvaluation({
    effectiveLatestTurnState: "canceled",
    terminalGroundTruth: {
      agentInputReady: true,
      completedTurnLooksSendable: true,
      effectiveActivityStatus: "interrupted",
      effectiveLatestTurnState: "canceled",
      hasPendingPrompt: false,
      runningTurnLooksIdle: false,
    },
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "todo-drop-prompt-1",
        startedAt: submittedAt,
        state: "canceled",
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

  assert.equal(evaluation.promptTurnMatches, true);
  assert.equal(evaluation.latestTurnClosed, true);
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "provider_turn_interrupted");
});

test("effective interruption beats a stale running transcript turn", () => {
  const evaluation = baseEvaluation({
    effectiveLatestTurnState: "interrupted",
    terminalGroundTruth: {
      agentInputReady: true,
      completedTurnLooksSendable: true,
      effectiveActivityStatus: "interrupted",
      effectiveLatestTurnState: "interrupted",
      hasPendingPrompt: false,
      runningTurnLooksIdle: false,
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

  assert.equal(evaluation.promptTurnMatches, true);
  assert.equal(evaluation.latestTurnState, "interrupted");
  assert.equal(evaluation.latestTurnClosed, true);
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "provider_turn_interrupted");
});

test("queued prompt error releases as failed provider turn", () => {
  const evaluation = baseEvaluation({
    effectiveLatestTurnState: "error",
    terminalGroundTruth: {
      agentInputReady: true,
      completedTurnLooksSendable: true,
      effectiveActivityStatus: "idle",
      effectiveLatestTurnState: "error",
      hasPendingPrompt: false,
      runningTurnLooksIdle: false,
    },
    targetThread: {
      id: "thread-1",
      latestTurn: {
        messageId: "todo-drop-prompt-1",
        startedAt: submittedAt,
        state: "error",
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

  assert.equal(evaluation.promptTurnMatches, true);
  assert.equal(evaluation.latestTurnClosed, true);
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "provider_turn_error");
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
  assert.equal(evaluation.assistantCompletionAfterPrompt, true);
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
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "provider_turn_closed");
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
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "provider_turn_closed");
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

test("stale provider state cannot hide an unavailable Rust terminal", () => {
  const evaluation = baseEvaluation({
    effectiveActivityStatus: "",
    effectiveLatestTurnState: "running",
    liveTerminal: null,
    providerBinding: {
      activityStatus: "thinking",
      inputReady: false,
      nativeSessionId: "session-1",
      status: "active",
    },
    terminalGroundTruth: {
      agentInputReady: false,
      completedTurnLooksSendable: false,
      effectiveActivityStatus: "",
      effectiveLatestTurnState: "running",
      hasPendingPrompt: false,
      runningTurnLooksIdle: false,
    },
    terminalStatus: "",
    targetThread: {
      activityStatus: "thinking",
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
      status: "active",
      transcriptSessionId: "session-1",
    },
  });

  assert.equal(evaluation.terminalUnavailable, true);
  assert.equal(evaluation.terminalPaused, false);
  assert.equal(evaluation.releaseReason, "terminal_unavailable");
});

test("stale thread and provider activity cannot pause an idle Rust lane", () => {
  const evaluation = baseEvaluation({
    effectiveActivityStatus: "idle",
    effectiveLatestTurnState: "completed",
    liveTerminal: {
      activityStatus: "idle",
      inputReady: true,
      inputReadyAt: "2026-06-01T01:34:53.775Z",
      instanceId: 4,
      status: "active",
      threadId: "thread-1",
    },
    providerBinding: {
      activityStatus: "prompting_user",
      inputReady: false,
      nativeSessionId: "session-1",
      status: "active",
    },
    terminalGroundTruth: {
      agentInputReady: true,
      completedTurnLooksSendable: true,
      effectiveActivityStatus: "idle",
      effectiveLatestTurnState: "completed",
      hasPendingPrompt: false,
      runningTurnLooksIdle: true,
    },
    targetThread: {
      activityStatus: "prompting_user",
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

  assert.equal(evaluation.terminalPaused, false);
  assert.equal(evaluation.terminalReadyForNextPrompt, true);
  assert.equal(evaluation.releaseReason, "provider_turn_closed");
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
  assert.equal(evaluation.completedMatchingTurn, true);
  assert.equal(evaluation.exactPromptTranscriptFinished, false);
  assert.equal(evaluation.terminalConfirmedFinished, true);
  assert.equal(evaluation.releaseReason, "provider_turn_closed");
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

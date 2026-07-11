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
      item_id: "todo-1",
      prompt_id: "todo-drop-prompt-1",
      prompt_text: "i want to make some pages",
      started_at_ms: submittedAtMs,
      submitted_at: submittedAt,
      submitted_at_ms: submittedAtMs,
      terminal_instance_id: 4,
      thread_id: "thread-1",
    },
    liveTerminal: {
      input_ready: true,
      input_ready_at: "2026-06-01T01:34:53.775Z",
      instance_id: 4,
      status: "active",
      thread_id: "thread-1",
    },
    providerBinding: {
      input_ready: true,
      input_ready_at: "2026-06-01T01:34:53.775Z",
      native_session_id: "session-1",
      status: "active",
    },
    now_ms: submittedAtMs + 5000,
    terminalGroundTruth: {
      agentInputReady: true,
      completedTurnLooksSendable: true,
      effectiveActivityStatus: "idle",
      effectiveLatestTurnState: "completed",
      hasPendingPrompt: false,
      runningTurnLooksIdle: false,
    },
    terminal_status: "active",
    targetThread: {
      id: "thread-1",
      latest_turn: {
        message_id: "codex-82-user",
        started_at: submittedAt,
        state: "completed",
        turn_id: "turn-thread-1-codex-82-user",
      },
      messages: [{
        created_at: submittedAt,
        id: "codex-82-user",
        role: "user",
        text: "i want to make some pages",
      }],
      transcript_session_id: "session-1",
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
      item_id: "terminal-direct-todo-drop-prompt-1",
      lifecycle_source: "tui-terminal-direct-input",
      prompt_id: "todo-drop-prompt-1",
      prompt_text: "i want to make some pages",
      source: "tui-terminal-direct-input",
      started_at_ms: submittedAtMs,
      submitted_at: submittedAt,
      submitted_at_ms: submittedAtMs,
      terminal_instance_id: 4,
      thread_id: "thread-1",
    },
    liveTerminal: {
      activity_status: "idle",
      input_ready: true,
      input_ready_at: "2026-06-01T01:35:12.000Z",
      instance_id: 4,
      prompt_event_id: "todo-drop-prompt-1",
      status: "idle",
      thread_id: "thread-1",
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
      latest_turn: {
        message_id: "transcript-stale-message",
        started_at: submittedAt,
        state: "running",
        turn_id: "turn-thread-1-stale",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }],
      transcript_session_id: "session-1",
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
      item_id: "todo-1",
      prompt_id: "todo-drop-prompt-1",
      prompt_text: "i want to make some pages",
      started_at_ms: submittedAtMs,
      submitted_at: submittedAt,
      submitted_at_ms: submittedAtMs,
      terminal_instance_id: 4,
      thread_id: "thread-1",
    },
    liveTerminal: {
      input_ready: false,
      instance_id: 4,
      status: "exited",
      thread_id: "thread-1",
      terminal_lifecycle: "closed",
    },
    providerBinding: null,
    terminal_status: "exited",
    targetThread: {
      id: "thread-1",
      messages: [],
      status: "exited",
    },
  });

  assert.equal(evaluation.terminal_closed, true);
  assert.equal(evaluation.releaseReason, "terminal_closed");
});

test("queued prompt is released when its terminal disappears before acceptance", () => {
  const evaluation = baseEvaluation({
    effectiveActivityStatus: "",
    effectiveLatestTurnState: "",
    inFlightPrompt: {
      accepted: false,
      item_id: "todo-1",
      prompt_id: "todo-drop-prompt-1",
      prompt_text: "i want to make some pages",
      started_at_ms: submittedAtMs,
      submitted_at: submittedAt,
      submitted_at_ms: submittedAtMs,
      terminal_instance_id: 4,
      thread_id: "thread-1",
    },
    liveTerminal: null,
    providerBinding: null,
    terminal_status: "",
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
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "completed",
        turn_id: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        created_at: "2026-06-01T01:35:12.000Z",
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        status: "complete",
        text: "Sure, I can build those pages.",
      }],
      transcript_session_id: "session-1",
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
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "completed",
        turn_id: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        created_at: "2026-06-01T01:35:12.000Z",
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        status: "complete",
        text: "Done.",
      }],
      transcript_session_id: "session-1",
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
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "interrupted",
        turn_id: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }],
      transcript_session_id: "session-1",
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
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "canceled",
        turn_id: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }],
      transcript_session_id: "session-1",
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
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "running",
        turn_id: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }],
      transcript_session_id: "session-1",
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
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "error",
        turn_id: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }],
      transcript_session_id: "session-1",
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
      item_id: "todo-1",
      prompt_id: "todo-drop-prompt-1",
      prompt_text: "i want to make some pages",
      started_at_ms: submittedAtMs,
      submitted_at: submittedAt,
      submitted_at_ms: submittedAtMs,
      terminal_instance_id: 4,
      thread_id: "thread-1",
    },
    targetThread: {
      id: "thread-1",
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "running",
        turn_id: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }],
      transcript_session_id: "session-1",
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
      latest_turn: {
        message_id: "todo-drop-prompt-newer",
        started_at: submittedAt,
        state: "completed",
        turn_id: "turn-thread-1-todo-drop-prompt-newer",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        created_at: "2026-06-01T01:35:12.000Z",
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        status: "complete",
        text: "Sure, I can build those pages.",
      }],
      transcript_session_id: "session-1",
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
      input_ready: true,
      input_ready_at: "2026-06-01T01:34:40.000Z",
      instance_id: 4,
      status: "idle",
      thread_id: "thread-1",
    },
    providerBinding: {
      input_ready: true,
      input_ready_at: "2026-06-01T01:34:40.000Z",
      native_session_id: "session-1",
      status: "idle",
    },
    targetThread: {
      id: "thread-1",
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "completed",
        turn_id: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        created_at: "2026-06-01T01:35:12.000Z",
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        status: "complete",
        text: "Done.",
      }],
      transcript_session_id: "session-1",
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
      input_ready: true,
      input_ready_at: "2026-06-01T01:35:12.000Z",
      instance_id: 4,
      prompt_event_id: "todo-drop-prompt-other",
      status: "idle",
      thread_id: "thread-1",
    },
    targetThread: {
      id: "thread-1",
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "completed",
        turn_id: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        created_at: "2026-06-01T01:35:12.000Z",
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        status: "complete",
        text: "Done.",
      }],
      transcript_session_id: "session-1",
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
      input_ready: false,
      instance_id: 4,
      status: "active",
      thread_id: "thread-1",
    },
    providerBinding: {
      input_ready: false,
      native_session_id: "session-1",
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
    terminal_status: "active",
    targetThread: {
      id: "thread-1",
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "running",
        turn_id: "turn-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        created_at: "2026-06-01T01:35:10.000Z",
        id: "assistant-task-complete",
        kind: "task_complete",
        role: "assistant",
        status: "complete",
        text: "Done.",
      }],
      transcript_session_id: "session-1",
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
      activity_status: "thinking",
      input_ready: false,
      native_session_id: "session-1",
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
    terminal_status: "",
    targetThread: {
      activity_status: "thinking",
      id: "thread-1",
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "running",
        turn_id: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }],
      status: "active",
      transcript_session_id: "session-1",
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
      activity_status: "idle",
      input_ready: true,
      input_ready_at: "2026-06-01T01:34:53.775Z",
      instance_id: 4,
      status: "active",
      thread_id: "thread-1",
    },
    providerBinding: {
      activity_status: "prompting_user",
      input_ready: false,
      native_session_id: "session-1",
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
      activity_status: "prompting_user",
      id: "thread-1",
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "running",
        turn_id: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }],
      transcript_session_id: "session-1",
    },
  });

  assert.equal(evaluation.terminalPaused, false);
  assert.equal(evaluation.terminalReadyForNextPrompt, true);
  assert.equal(evaluation.releaseReason, "provider_turn_closed");
});

test("idle terminal status can release an accepted completed queued prompt", () => {
  const evaluation = baseEvaluation({
    liveTerminal: {
      input_ready: true,
      input_ready_at: "2026-06-01T01:35:12.000Z",
      instance_id: 4,
      status: "idle",
      thread_id: "thread-1",
    },
    providerBinding: {
      input_ready: true,
      input_ready_at: "2026-06-01T01:35:12.000Z",
      native_session_id: "session-1",
      status: "idle",
    },
    terminal_status: "idle",
    targetThread: {
      id: "thread-1",
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "completed",
        turn_id: "turn-thread-1-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }, {
        created_at: "2026-06-01T01:35:10.000Z",
        id: "assistant-final",
        kind: "message",
        role: "assistant",
        status: "complete",
        text: "Done.",
      }],
      transcript_session_id: "session-1",
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
      latest_turn: {
        message_id: "todo-drop-prompt-1",
        started_at: submittedAt,
        state: "completed",
        turn_id: "turn-todo-drop-prompt-1",
      },
      messages: [{
        created_at: submittedAt,
        id: "todo-drop-prompt-1",
        role: "user",
        text: "i want to make some pages",
      }],
      transcript_session_id: "session-1",
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
      input_ready: true,
      input_ready_at: "2026-06-01T01:35:20.000Z",
      instance_id: 5,
      status: "active",
      thread_id: "thread-1",
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
      created_at: submittedAt,
      id: "codex-82-user",
      role: "user",
      text: "i want to make some pages",
    }],
    prompt_text: "i want to make some pages",
    submitted_at_ms: submittedAtMs,
  });

  assert.equal(evidence.promptUserMessageSeen, true);
  assert.equal(evidence.assistantTextAfterPrompt, false);
  assert.equal(evidence.assistantCompletionAfterPrompt, false);
});

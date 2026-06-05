import {
  terminalActivityStatusIsBusy,
  terminalActivityStatusIsSendable,
} from "./terminalActivityState.js";

const DEFAULT_CLOSED_TURN_STATES = new Set(["completed", "error", "interrupted"]);

function cleanText(value) {
  return String(value || "").trim();
}

function parseTimestampMs(value) {
  const parsed = Date.parse(cleanText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeTurnState(value) {
  return cleanText(value).toLowerCase();
}

function todoQueueSourceLooksTranscriptOwned(value) {
  const source = cleanText(value).toLowerCase();
  if (!source) {
    return false;
  }
  return source.endsWith("-session")
    || source === "agent_thread_transcript"
    || source === "codex-rollout"
    || source.includes("transcript")
    || source.includes("session-history");
}

function todoQueueSourceLooksLifecycleOwned(value) {
  const source = cleanText(value).toLowerCase();
  if (!source || todoQueueSourceLooksTranscriptOwned(source)) {
    return false;
  }
  return source.startsWith("cli-hook:")
    || source.startsWith("activity-hook:")
    || source.includes("hook")
    || source.startsWith("provider-turn-")
    || source.includes("provider-turn")
    || source === "provider-api"
    || source === "terminal-status";
}

export function evaluateTodoQueueInFlightPrompt({
  closedTurnStates = DEFAULT_CLOSED_TURN_STATES,
  effectiveActivityStatus = "",
  effectiveLatestTurnState = "",
  hookManaged = false,
  inFlightPrompt = null,
  liveTerminal = null,
  nowMs = Date.now(),
  providerBinding = null,
  readyGraceMs = 1000,
  recordedAgentInputReady = false,
  terminalGroundTruth = null,
  terminalStatus = "",
  targetThread = null,
  timeoutMs = 10 * 60 * 1000,
} = {}) {
  const promptId = cleanText(inFlightPrompt?.promptId);
  const promptText = cleanText(inFlightPrompt?.promptText);
  const submittedAtMs = Number(
    inFlightPrompt?.submittedAtMs
      || parseTimestampMs(inFlightPrompt?.submittedAt)
      || 0,
  );
  const latestTurn = targetThread?.latestTurn || null;
  const latestTurnState = normalizeTurnState(latestTurn?.state || effectiveLatestTurnState);
  const latestTurnId = cleanText(latestTurn?.turnId || latestTurn?.id);
  const latestMessageId = cleanText(latestTurn?.messageId);
  const latestTurnClosed = closedTurnStates.has(latestTurnState);
  const latestTurnSource = cleanText(latestTurn?.source);
  const latestTurnCompletedSource = cleanText(
    latestTurn?.completedSource
      || latestTurn?.completed_source
      || latestTurnSource,
  );
  const latestTurnClosedByLifecycle = Boolean(
    latestTurnClosed
      && (
        todoQueueSourceLooksLifecycleOwned(latestTurnCompletedSource)
        || todoQueueSourceLooksLifecycleOwned(latestTurnSource)
      ),
  );
  const promptComparisonText = cleanText(promptText);
  const latestUserPromptMatches = false;
  const latestTurnStartedAtMs = parseTimestampMs(
    latestTurn?.startedAt
      || latestTurn?.requestedAt
      || latestTurn?.updatedAt
      || "",
  );
  const latestTurnAfterSubmit = Boolean(
    submittedAtMs
      && latestTurnStartedAtMs
      && latestTurnStartedAtMs >= submittedAtMs - readyGraceMs,
  );
  const promptTurnMatches = Boolean(
    promptId
      && (
        latestTurnId.includes(promptId)
        || latestMessageId === promptId
      ),
  );
  const terminalInputReadyAtMs = parseTimestampMs(
    liveTerminal?.inputReadyAt
      || providerBinding?.inputReadyAt
      || "",
  );
  const terminalInputReady = Boolean(liveTerminal?.inputReady || providerBinding?.inputReady);
  const normalizedTerminalStatus = normalizeTurnState(
    terminalStatus
      || liveTerminal?.status
      || providerBinding?.status
      || targetThread?.status
      || "",
  );
  const terminalClosed = Boolean(
    ["closed", "exited", "terminated"].includes(normalizedTerminalStatus)
      || normalizeTurnState(liveTerminal?.terminalLifecycle || liveTerminal?.terminal_lifecycle) === "closed"
  );
  const terminalUnavailable = Boolean(
    submittedAtMs
      && !liveTerminal
      && !providerBinding
  );
  const freshInputReady = Boolean(
    terminalInputReady
      && submittedAtMs
      && terminalInputReadyAtMs
      && terminalInputReadyAtMs >= submittedAtMs - readyGraceMs,
  );
  const terminalReadinessPromptId = cleanText(
    liveTerminal?.promptEventId
      || liveTerminal?.prompt_event_id
      || liveTerminal?.pendingPromptId
      || liveTerminal?.pending_prompt_id
      || providerBinding?.promptEventId
      || providerBinding?.prompt_event_id
      || providerBinding?.pendingPromptId
      || providerBinding?.pending_prompt_id
      || terminalGroundTruth?.promptEventId
      || terminalGroundTruth?.pendingPromptId
      || "",
  );
  const terminalReadinessPromptMatches = Boolean(
    promptId
      && terminalReadinessPromptId
      && terminalReadinessPromptId === promptId,
  );
  const terminalReadinessMatchesPrompt = Boolean(
    freshInputReady
      && (
        !promptId
        || !terminalReadinessPromptId
        || terminalReadinessPromptMatches
      )
  );
  const normalizedActivityStatus = normalizeTurnState(
    effectiveActivityStatus
      || terminalGroundTruth?.effectiveActivityStatus
      || targetThread?.activityStatus
      || providerBinding?.activityStatus
      || liveTerminal?.activityStatus
      || liveTerminal?.activity_status
      || "",
  );
  const terminalReadyForNextPrompt = Boolean(
    liveTerminal
      && terminalActivityStatusIsSendable(normalizedActivityStatus)
      && !terminalGroundTruth?.hasPendingPrompt
      && normalizeTurnState(effectiveLatestTurnState || terminalGroundTruth?.effectiveLatestTurnState) !== "running"
      && !terminalActivityStatusIsBusy(normalizedActivityStatus)
      && (
        !promptId
        || !terminalReadinessPromptId
        || terminalReadinessPromptMatches
      )
      && (
        terminalGroundTruth?.agentInputReady
          || terminalGroundTruth?.completedTurnLooksSendable
          || terminalGroundTruth?.runningTurnLooksIdle
          || freshInputReady
      )
  );
  const terminalReadyCompletionSignal = Boolean(
    terminalReadyForNextPrompt || terminalReadinessMatchesPrompt
  );
  const promptAccepted = Boolean(
    inFlightPrompt?.accepted === true
      || inFlightPrompt?.acceptedAtMs
      || inFlightPrompt?.acceptedAt,
  );
  const sessionAcceptedByThread = false;
  const completionEvidence = {
    assistantCompletionAfterPrompt: false,
    assistantTextAfterPrompt: false,
    promptUserMessageSeen: false,
  };
  const transcriptCompletionAfterPrompt = false;
  const exactPromptTranscriptFinished = false;
  const promptAcceptedByCompletedThread = false;
  const effectivePromptAccepted = Boolean(
    promptAccepted
      || sessionAcceptedByThread
      || promptAcceptedByCompletedThread
  );
  const providerLifecycleCompleted = Boolean(
    hookManaged
      && (
        inFlightPrompt?.lifecycleCompleted === true
        || inFlightPrompt?.providerTurnCompleted === true
        || inFlightPrompt?.completedAtMs
        || inFlightPrompt?.completedAt
      )
  );
  const providerLifecycleCompletionReason = cleanText(
    inFlightPrompt?.lifecycleCompletionReason
      || inFlightPrompt?.completionReason
      || (providerLifecycleCompleted ? "provider_turn_closed" : ""),
  );
  const completedMatchingTurn = Boolean(
    effectivePromptAccepted
      && promptTurnMatches
      && latestTurnClosed
      && latestTurnClosedByLifecycle
      && terminalReadyCompletionSignal
  );
  const lifecycleCompletionReady = Boolean(
    hookManaged
      && effectivePromptAccepted
      && providerLifecycleCompleted
      && terminalReadyCompletionSignal
      && (!promptId || promptTurnMatches || !latestTurnId)
  );
  const terminalConfirmedFinished = completedMatchingTurn || lifecycleCompletionReady;
  const promptInstanceId = Number.parseInt(inFlightPrompt?.terminalInstanceId, 10);
  const liveInstanceId = Number.parseInt(liveTerminal?.instanceId, 10);
  const terminalInstanceChanged = Boolean(
    Number.isInteger(promptInstanceId)
      && promptInstanceId > 0
      && Number.isInteger(liveInstanceId)
      && liveInstanceId > 0
      && promptInstanceId !== liveInstanceId
  );
  const promptThreadId = cleanText(inFlightPrompt?.threadId);
  const liveThreadId = cleanText(liveTerminal?.threadId || targetThread?.id);
  const threadChanged = Boolean(
    promptThreadId
      && liveThreadId
      && promptThreadId !== liveThreadId
  );
  const expired = Boolean(
    Number(inFlightPrompt?.startedAtMs || 0) > 0
      && nowMs - Number(inFlightPrompt.startedAtMs || 0) > timeoutMs
  );
  const releaseReason = terminalConfirmedFinished
    ? providerLifecycleCompletionReason || "provider_turn_closed"
    : terminalClosed
      ? "terminal_closed"
      : terminalUnavailable
        ? "terminal_unavailable"
        : terminalInstanceChanged
          ? "terminal_instance_changed"
          : threadChanged
            ? "terminal_thread_changed"
            : expired
              ? "timeout"
              : "";

  return {
    assistantCompletionAfterPrompt: completionEvidence.assistantCompletionAfterPrompt,
    assistantTextAfterPrompt: completionEvidence.assistantTextAfterPrompt,
    completedMatchingTurn,
    effectivePromptAccepted,
    exactPromptTranscriptFinished,
    expired,
    freshInputReady,
    latestMessageId,
    latestTurnAfterSubmit,
    latestTurnClosed,
    latestTurnClosedByLifecycle,
    latestTurnCompletedSource,
    latestTurnId,
    latestTurnSource,
    latestTurnState,
    latestUserPromptMatches,
    hookManaged: Boolean(hookManaged),
    promptAccepted,
    promptAcceptedByCompletedThread,
    promptComparisonText,
    promptId,
    promptThreadId,
    promptTurnMatches,
    promptUserMessageSeen: completionEvidence.promptUserMessageSeen,
    providerLifecycleCompleted,
    providerLifecycleCompletionReason,
    recordedAgentInputReady: Boolean(recordedAgentInputReady),
    releaseReason,
    sessionAcceptedByThread,
    submittedAtMs,
    terminalConfirmedFinished,
    terminalClosed,
    terminalInputReady,
    terminalInputReadyAtMs,
    terminalInstanceChanged,
    terminalReadinessMatchesPrompt,
    terminalReadinessPromptId,
    terminalReadinessPromptMatches,
    terminalReadyCompletionSignal,
    terminalReadyForNextPrompt,
    terminalReadyActivityStatus: normalizedActivityStatus,
    terminalUnavailable,
    transcriptCompletionAfterPrompt,
    threadChanged,
  };
}

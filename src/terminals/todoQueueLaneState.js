import {
  terminalActivityStatusIsBusy,
  terminalActivityStatusIsPaused,
  terminalActivityStatusIsSendable,
} from "./terminalActivityState.js";

const DEFAULT_CLOSED_TURN_STATES = new Set([
  "cancelled",
  "canceled",
  "completed",
  "error",
  "failed",
  "interrupted",
]);

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

function getProviderTurnReleaseReason(turnState) {
  const state = normalizeTurnState(turnState);
  if (["cancelled", "canceled", "interrupted"].includes(state)) {
    return "provider_turn_interrupted";
  }
  if (["error", "failed", "failure"].includes(state)) {
    return "provider_turn_error";
  }
  return "provider_turn_closed";
}

function messageText(message) {
  if (!message || typeof message !== "object") {
    return "";
  }
  if (typeof message.text === "string") return message.text;
  if (typeof message.message === "string") return message.message;
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function messageCreatedAtMs(message) {
  return parseTimestampMs(
    message?.createdAt
      || message?.created_at
      || message?.timestamp
      || message?.time
      || "",
  );
}

function isAssistantMessage(message) {
  return cleanText(message?.role).toLowerCase() === "assistant";
}

function isAssistantCompletionMessage(message) {
  if (!isAssistantMessage(message)) {
    return false;
  }
  const kind = cleanText(message?.kind).toLowerCase();
  const status = cleanText(message?.status).toLowerCase();
  const title = cleanText(message?.title).toLowerCase();
  const id = cleanText(message?.id).toLowerCase();
  return kind === "task_complete"
    || kind === "final_answer"
    || status === "task_complete"
    || status === "complete"
    || title === "task complete"
    || id.includes("task-complete");
}

export function normalizeTodoQueuePromptComparisonText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function getTodoQueueLatestUserMessage(thread) {
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (cleanText(message?.role).toLowerCase() === "user") {
      return message;
    }
  }
  return null;
}

export function getTodoQueuePromptCompletionEvidence({
  messages = [],
  promptText = "",
  readyGraceMs = 1000,
  submittedAtMs = 0,
} = {}) {
  const normalizedPromptText = normalizeTodoQueuePromptComparisonText(promptText);
  if (!normalizedPromptText) {
    return {
      assistantCompletionAfterPrompt: false,
      assistantTextAfterPrompt: false,
      promptUserMessageSeen: false,
    };
  }

  const safeMessages = Array.isArray(messages) ? messages : [];
  let matchedUserIndex = -1;
  for (let index = safeMessages.length - 1; index >= 0; index -= 1) {
    const message = safeMessages[index];
    if (cleanText(message?.role).toLowerCase() !== "user") {
      continue;
    }
    if (normalizeTodoQueuePromptComparisonText(messageText(message)) !== normalizedPromptText) {
      continue;
    }
    const createdAtMs = messageCreatedAtMs(message);
    if (
      submittedAtMs
      && createdAtMs
      && createdAtMs < submittedAtMs - readyGraceMs
    ) {
      continue;
    }
    matchedUserIndex = index;
    break;
  }

  if (matchedUserIndex < 0) {
    return {
      assistantCompletionAfterPrompt: false,
      assistantTextAfterPrompt: false,
      promptUserMessageSeen: false,
    };
  }

  let assistantCompletionAfterPrompt = false;
  let assistantTextAfterPrompt = false;
  for (let index = matchedUserIndex + 1; index < safeMessages.length; index += 1) {
    const message = safeMessages[index];
    if (!isAssistantMessage(message)) {
      continue;
    }
    assistantCompletionAfterPrompt = assistantCompletionAfterPrompt || isAssistantCompletionMessage(message);
    assistantTextAfterPrompt = assistantTextAfterPrompt || Boolean(messageText(message).trim());
    if (assistantCompletionAfterPrompt && assistantTextAfterPrompt) {
      break;
    }
  }

  return {
    assistantCompletionAfterPrompt,
    assistantTextAfterPrompt,
    promptUserMessageSeen: true,
  };
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
  const rawLatestTurnState = normalizeTurnState(latestTurn?.state);
  const effectiveTurnState = normalizeTurnState(effectiveLatestTurnState);
  const latestTurnState = closedTurnStates.has(effectiveTurnState)
    ? effectiveTurnState
    : rawLatestTurnState || effectiveTurnState;
  const latestTurnId = cleanText(latestTurn?.turnId || latestTurn?.id);
  const latestMessageId = cleanText(latestTurn?.messageId);
  const latestTurnClosed = closedTurnStates.has(latestTurnState);
  const latestUserMessage = getTodoQueueLatestUserMessage(targetThread);
  const promptComparisonText = normalizeTodoQueuePromptComparisonText(promptText);
  const latestUserPromptText = normalizeTodoQueuePromptComparisonText(messageText(latestUserMessage));
  const latestUserPromptMatches = Boolean(
    promptComparisonText
      && latestUserPromptText
      && promptComparisonText === latestUserPromptText,
  );
  const latestUserCreatedAtMs = messageCreatedAtMs(latestUserMessage);
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
  const terminalPaused = Boolean(terminalActivityStatusIsPaused(normalizedActivityStatus));
  const terminalReadyForNextPrompt = Boolean(
    liveTerminal
      && terminalActivityStatusIsSendable(normalizedActivityStatus)
      && !terminalGroundTruth?.hasPendingPrompt
      && normalizeTurnState(effectiveLatestTurnState || terminalGroundTruth?.effectiveLatestTurnState) !== "running"
      && !terminalActivityStatusIsBusy(normalizedActivityStatus)
      && (
        terminalGroundTruth?.agentInputReady
          || terminalGroundTruth?.completedTurnLooksSendable
          || terminalGroundTruth?.runningTurnLooksIdle
          || freshInputReady
      )
  );
  const promptAccepted = Boolean(
    inFlightPrompt?.accepted === true
      || inFlightPrompt?.acceptedAtMs
      || inFlightPrompt?.acceptedAt,
  );
  const providerSessionId = cleanText(
    targetThread?.transcriptSessionId
      || providerBinding?.nativeSessionId
      || inFlightPrompt?.sessionId
      || "",
  );
  const sessionAcceptedByThread = Boolean(
    !hookManaged
      && !promptAccepted
      && providerSessionId
      && latestUserPromptMatches
      && (
        !submittedAtMs
        || (
          latestUserCreatedAtMs
          && latestUserCreatedAtMs >= submittedAtMs - readyGraceMs
        )
      )
  );
  const completionEvidence = getTodoQueuePromptCompletionEvidence({
    messages: targetThread?.messages,
    promptText,
    readyGraceMs,
    submittedAtMs,
  });
  const transcriptCompletionAfterPrompt = false;
  const exactPromptTranscriptFinished = false;
  const promptAcceptedByCompletedThread = Boolean(
    !hookManaged
      && !promptAccepted
      && false
  );
  const effectivePromptAccepted = Boolean(
    promptAccepted
      || sessionAcceptedByThread
      || promptAcceptedByCompletedThread
  );
  const completedMatchingTurn = Boolean(
    effectivePromptAccepted
      && promptTurnMatches
      && latestTurnClosed
  );
  const terminalConfirmedFinished = completedMatchingTurn;
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
    ? getProviderTurnReleaseReason(latestTurnState)
    : terminalPaused
      ? (
        normalizedActivityStatus === "resume_ready"
          ? "parked_task_resume_ready"
          : normalizedActivityStatus === "resume_requested"
            ? "resume_in_progress"
            : "parked_task_waiting"
      )
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
    latestTurnId,
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
    terminalReadyForNextPrompt,
    terminalReadyActivityStatus: normalizedActivityStatus,
    terminalUnavailable,
    transcriptCompletionAfterPrompt,
    threadChanged,
  };
}

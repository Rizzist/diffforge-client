import {
  terminalAgentUsesActivityHooks,
  terminalActivityStatusIsBusy,
  terminalActivityStatusIsClosed,
  terminalActivityStatusIsError,
  terminalActivityStatusIsSendable,
} from "../terminals/terminalActivityState.js";

const DEFAULT_AGENT_READY_ROLES = new Set(["codex", "claude", "opencode"]);
const COMPLETED_TURN_STATES = new Set(["completed", "error", "interrupted"]);
const PROMPTING_CLEARING_LIFECYCLE_TYPES = new Set([
  "message-submitted",
  "pending-prompt-sent",
  "provider-turn-completed",
  "provider-turn-error",
  "provider-turn-interrupted",
  "provider-turn-started",
  "thread-starting",
]);
const EXPLICIT_PERMISSION_PROMPT_KINDS = new Set(["approval", "permission"]);
const EXPLICIT_PERMISSION_PROMPT_SOURCE_PARTS = [
  "approval",
  "claude-hook",
  "claude-permission",
  "codex-hook",
  "codex-permission",
  "coordination",
  "permission",
  "pre-tool-use",
  "pretooluse",
  "provider-permission",
  "tool-permission",
];
export const PARKED_TERMINAL_STATUSES = new Set(["parked", "resume_ready", "resume_requested"]);
function cleanText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function cleanPromptingText(value, maxLength = 1200) {
  return String(value || "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, " ")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizePromptingUserKind(value, fallback = "unknown") {
  const kind = cleanText(value, fallback)
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  return [
    "approval",
    "clarification",
    "confirmation",
    "model-picker",
    "permission",
    "terminal-control",
    "unknown",
  ].includes(kind) ? kind : fallback;
}

function normalizePromptingUserSource(value, fallback = "") {
  return cleanText(value, fallback)
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function promptingPermissionToken(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return cleanText(
    source.approvalId
      || source.approval_id
      || source.permissionPromptId
      || source.permission_prompt_id
      || source.permissionRequestId
      || source.permission_request_id
      || source.sourceEventId
      || source.source_event_id
      || source.toolUseId
      || source.tool_use_id,
  );
}

function promptingSourceLooksExplicitPermission(source) {
  const normalized = normalizePromptingUserSource(source);
  return Boolean(
    normalized
      && EXPLICIT_PERMISSION_PROMPT_SOURCE_PARTS.some((part) => normalized.includes(part))
      && !normalized.includes("terminal-output")
  );
}

function valueHasPromptingUserFlag(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return source.terminalIsPromptingUser === true
    || source.terminal_is_prompting_user === true
    || source.promptingUser === true
    || source.prompting_user === true
    || source.requiresUserInput === true
    || source.requires_user_input === true;
}

function valueLooksExplicitPermissionPrompt(value = {}) {
  const sourceValue = value && typeof value === "object" ? value : {};
  if (!valueHasPromptingUserFlag(sourceValue)) {
    return false;
  }

  const kind = normalizePromptingUserKind(
    sourceValue.promptingUserKind
      || sourceValue.prompting_user_kind
      || sourceValue.promptingKind
      || sourceValue.prompting_kind,
    "",
  );
  const source = sourceValue.promptingUserSource
    || sourceValue.prompting_user_source
    || sourceValue.promptingSource
    || sourceValue.prompting_source
    || sourceValue.source
    || sourceValue.type;
  const hasPermissionKind = EXPLICIT_PERMISSION_PROMPT_KINDS.has(kind)
    || sourceValue.requiresUserInput === true
    || sourceValue.requires_user_input === true;

  return Boolean(
    hasPermissionKind
      && (promptingPermissionToken(sourceValue) || promptingSourceLooksExplicitPermission(source))
  );
}

function emptyPromptingUserSignal() {
  return {
    confidence: "",
    isPromptingUser: false,
    kind: "",
    source: "",
    text: "",
  };
}

function promptingUserSignal(kind, source, text, confidence = "pattern") {
  return {
    confidence,
    isPromptingUser: true,
    kind: normalizePromptingUserKind(kind),
    source: cleanText(source, "unknown"),
    text: cleanPromptingText(text, 420),
  };
}

function explicitPermissionPromptingUserSignal(source) {
  const value = source && typeof source === "object" ? source : {};
  if (!valueLooksExplicitPermissionPrompt(value)) {
    return emptyPromptingUserSignal();
  }
  const sourceText = value.promptingUserSource
    || value.prompting_user_source
    || value.promptingSource
    || value.prompting_source
    || value.source
    || value.type
    || "";
  return promptingUserSignal(
    value.promptingUserKind
      || value.prompting_user_kind
      || value.promptingKind
      || value.prompting_kind
      || (value.requiresUserInput || value.requires_user_input ? "permission" : "approval"),
    promptingSourceLooksExplicitPermission(sourceText)
      ? sourceText
      : promptingPermissionToken(value)
        ? "permission-token"
        : sourceText || "permission",
    value.promptingUserText
      || value.prompting_user_text
      || value.promptingText
      || value.prompting_text
      || value.terminalPrompt
      || value.outputText
      || value.text
      || "",
    value.promptingUserConfidence
      || value.prompting_user_confidence
      || value.promptingConfidence
      || value.prompting_confidence
      || "explicit-permission",
  );
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
      .map((part) => (
        typeof part === "string"
          ? part
          : typeof part?.text === "string"
            ? part.text
            : ""
      ))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function latestAssistantMessageText(thread) {
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (cleanText(message?.role).toLowerCase() === "assistant") {
      return messageText(message);
    }
  }
  return "";
}

function storedPromptingUserSignal(liveTerminal, providerBinding) {
  const source = [liveTerminal, providerBinding].find((candidate) => (
    valueLooksExplicitPermissionPrompt(candidate)
  ));
  if (!source) {
    return emptyPromptingUserSignal();
  }
  return explicitPermissionPromptingUserSignal(source);
}

function parseTimestampMs(value) {
  const timestamp = Date.parse(cleanText(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function providerBindingsHaveNativeSession(providerBindings) {
  return Object.values(providerBindings || {}).some((binding) => (
    Boolean(cleanText(binding?.nativeSessionId))
  ));
}

function explicitLiveTerminalActivityStatus(liveTerminal) {
  return cleanText(
    liveTerminal?.activityStatus
      || liveTerminal?.activity_status
      || liveTerminal?.nativeRailState
      || liveTerminal?.native_rail_state
      || liveTerminal?.terminalWorkState
      || liveTerminal?.terminal_work_state,
  ).toLowerCase();
}

function normalizeLiveTerminalActivityStatus(liveTerminal) {
  const explicit = explicitLiveTerminalActivityStatus(liveTerminal);
  if (explicit) {
    return explicit;
  }

  const status = cleanText(
    liveTerminal?.terminalStatus
      || liveTerminal?.terminal_status
      || liveTerminal?.status,
  ).toLowerCase();
  if (
    terminalActivityStatusIsBusy(status)
    || terminalActivityStatusIsSendable(status)
    || terminalActivityStatusIsClosed(status)
    || terminalActivityStatusIsError(status)
    || PARKED_TERMINAL_STATUSES.has(status)
  ) {
    return status;
  }

  return liveTerminal ? "idle" : "";
}

function normalizeMessageCount(value) {
  const count = Number.parseInt(value ?? 0, 10);
  return Number.isFinite(count) ? count : 0;
}

export function getLiveTerminalForThread(thread, providerBinding, workspaceThreadEntry) {
  if (!thread || !workspaceThreadEntry?.terminals) {
    return null;
  }

  const storedBinding = providerBinding?.terminalBinding || thread?.terminalBinding;
  const terminalIndex = storedBinding?.terminalIndex ?? thread?.terminalIndex;
  const terminalKey = terminalIndex == null ? "" : String(terminalIndex);
  const terminal = terminalKey ? workspaceThreadEntry.terminals?.[terminalKey] : null;
  if (!terminal) {
    return null;
  }

  const activityStatus = normalizeLiveTerminalActivityStatus(terminal);
  if (
    terminal.threadId !== thread?.id
    || terminalActivityStatusIsClosed(activityStatus)
  ) {
    return null;
  }

  if (storedBinding?.paneId && terminal.paneId && storedBinding.paneId !== terminal.paneId) {
    return null;
  }

  if (
    storedBinding?.instanceId
    && terminal.instanceId
    && Number(storedBinding.instanceId) !== Number(terminal.instanceId)
  ) {
    return null;
  }

  return terminal;
}

export function getThreadTerminalGroundTruth({
  agentReadyRoles = DEFAULT_AGENT_READY_ROLES,
  lifecycleEvent = null,
  liveTerminal = null,
  providerBinding = null,
  targetRole = "",
  terminalOutputText = "",
  thread = null,
} = {}) {
  const lifecycleType = cleanText(lifecycleEvent?.type).toLowerCase();
  const lifecycleTerminalWorkState = cleanText(
    lifecycleEvent?.terminalWorkState || lifecycleEvent?.statusTruth || lifecycleEvent?.status_truth,
  ).toLowerCase();
  const latestTurn = thread?.latestTurn || null;
  const latestTurnState = cleanText(latestTurn?.state).toLowerCase();
  const terminalStatus = cleanText(liveTerminal?.status).toLowerCase();
  const providerActivityStatus = "";
  const rawLiveActivityStatus = normalizeLiveTerminalActivityStatus(liveTerminal);
  const liveActivityStatusExplicit = Boolean(explicitLiveTerminalActivityStatus(liveTerminal));
  const providerBindings = thread?.providerBindings
    && typeof thread.providerBindings === "object"
    && !Array.isArray(thread.providerBindings)
    ? thread.providerBindings
    : {};
  const recordedAgentInputReady = Boolean(liveTerminal?.inputReady || providerBinding?.inputReady);
  const hookManagedAgent = terminalAgentUsesActivityHooks(targetRole)
    || terminalAgentUsesActivityHooks(liveTerminal?.agentId || liveTerminal?.agent_id)
    || terminalAgentUsesActivityHooks(providerBinding?.agentId || providerBinding?.agent_id);
  const hookManagedImplicitStartup = Boolean(
    hookManagedAgent
      && liveTerminal
      && !liveActivityStatusExplicit
      && !recordedAgentInputReady
      && terminalActivityStatusIsSendable(rawLiveActivityStatus)
  );
  const liveActivityStatus = hookManagedImplicitStartup ? "starting" : rawLiveActivityStatus;
  const activityStatus = liveActivityStatus;
  const parkedStatus = [activityStatus].find((status) => (
    PARKED_TERMINAL_STATUSES.has(status)
  )) || "";
  const terminalIsParked = Boolean(parkedStatus);
  const messageCount = normalizeMessageCount(thread?.messageCount);
  const hasMessages = Array.isArray(thread?.messages) && thread.messages.length > 0;
  const hasProjectionEvents = Array.isArray(thread?.projectionEvents) && thread.projectionEvents.length > 0;
  const hasNativeSession = providerBindingsHaveNativeSession(providerBindings);
  const hasPendingPrompt = Boolean(thread?.pendingPrompt);
  const promptSubmissionPending = Boolean(hasPendingPrompt && latestTurnState === "running");
  const hasTranscriptSession = Boolean(cleanText(thread?.transcriptSessionId));
  const orphanRunningLooksIdle = Boolean(
    latestTurnState === "running"
      && !hasMessages
      && !hasProjectionEvents
      && !hasPendingPrompt
      && !hasTranscriptSession
      && !hasNativeSession
  );

  const inputReadyAt = cleanText(
    liveTerminal?.inputReadyAt
      || providerBinding?.inputReadyAt
  );
  const inputReadyAtMs = parseTimestampMs(inputReadyAt);
  const turnStartedAt = cleanText(
    latestTurn?.startedAt
      || latestTurn?.requestedAt
      || latestTurn?.updatedAt,
  );
  const turnStartedAtMs = parseTimestampMs(turnStartedAt);
  const terminalLooksActive = terminalActivityStatusIsBusy(activityStatus);
  const terminalLooksSendable = terminalActivityStatusIsSendable(activityStatus);
  const liveTerminalLooksSendable = terminalActivityStatusIsSendable(liveActivityStatus);
  const hasLoadedTerminalRuntime = Boolean(
    liveTerminal
      && (
        terminalStatus === "active"
        || terminalStatus === "idle"
        || terminalStatus === "ready"
        || liveTerminalLooksSendable
      )
  );
  const hasHookRuntimeSession = Boolean(
    hasNativeSession
      || hasTranscriptSession
      || cleanText(providerBinding?.nativeSessionId || providerBinding?.native_session_id)
  );
  const inputReadyIsFreshForTurn = Boolean(
    recordedAgentInputReady
      && inputReadyAtMs > 0
      && (!turnStartedAtMs || inputReadyAtMs >= turnStartedAtMs - 1000)
  );
  const restoredRunningTurnLooksIdle = Boolean(
    latestTurnState === "running"
      && hookManagedAgent
      && hasHookRuntimeSession
      && hasLoadedTerminalRuntime
      && terminalLooksSendable
      && liveTerminalLooksSendable
      && !terminalIsParked
      && !hasPendingPrompt
      && !terminalLooksActive
  );
  const staleRunningWithoutLiveRuntimeLooksIdle = Boolean(
    latestTurnState === "running"
      && hookManagedAgent
      && !liveTerminal
      && !hasPendingPrompt
  );
  const runningTurnLooksIdle = Boolean(
    latestTurnState === "running"
      && (
        orphanRunningLooksIdle
        || restoredRunningTurnLooksIdle
        || staleRunningWithoutLiveRuntimeLooksIdle
        || (
          terminalLooksSendable
          && inputReadyIsFreshForTurn
          && !hasPendingPrompt
        )
      )
  );
  const activityStatusLooksInputReady = Boolean(
    terminalActivityStatusIsSendable(liveActivityStatus)
      && !terminalIsParked
      && !hasPendingPrompt
      && (
        !latestTurnState
        || COMPLETED_TURN_STATES.has(latestTurnState)
        || runningTurnLooksIdle
        || orphanRunningLooksIdle
      )
  );
  const completedTurnLooksStaleActive = Boolean(
    latestTurnState === "completed"
      && terminalActivityStatusIsBusy(activityStatus)
      && terminalLooksActive
      && !recordedAgentInputReady
      && !hasPendingPrompt
  );
  const effectiveLatestTurnState = runningTurnLooksIdle
    ? "completed"
    : completedTurnLooksStaleActive
      ? "running"
    : latestTurnState;
  const latestTurnFinished = COMPLETED_TURN_STATES.has(latestTurnState);
  const effectiveActivityStatus = (runningTurnLooksIdle || (latestTurnFinished && !completedTurnLooksStaleActive)) && terminalActivityStatusIsBusy(activityStatus)
    ? "idle"
    : orphanRunningLooksIdle && terminalActivityStatusIsBusy(activityStatus)
      ? "idle"
      : activityStatus;
  const safeAgentReadyRoles = agentReadyRoles instanceof Set
    ? agentReadyRoles
    : new Set(Array.isArray(agentReadyRoles) ? agentReadyRoles : DEFAULT_AGENT_READY_ROLES);
  const requiresAgentInputReady = safeAgentReadyRoles.has(cleanText(targetRole).toLowerCase());
  const completedTurnLooksSendable = Boolean(
    requiresAgentInputReady
      && (activityStatusLooksInputReady || (recordedAgentInputReady && inputReadyIsFreshForTurn))
      && (COMPLETED_TURN_STATES.has(latestTurnState) || runningTurnLooksIdle || orphanRunningLooksIdle)
      && !completedTurnLooksStaleActive
      && !terminalActivityStatusIsBusy(effectiveActivityStatus)
      && !hasPendingPrompt
      && terminalLooksSendable
  );
  const agentInputReady = !hasPendingPrompt && (
    !requiresAgentInputReady
      || activityStatusLooksInputReady
      || (recordedAgentInputReady && inputReadyIsFreshForTurn)
  );
  const terminalGroundTruthStatus = promptSubmissionPending
    ? "processing_or_active"
    : runningTurnLooksIdle || (
      recordedAgentInputReady
      && inputReadyIsFreshForTurn
      && terminalLooksSendable
    )
      ? "idle_or_input_ready"
      : latestTurnState === "running" || terminalActivityStatusIsBusy(activityStatus)
        ? "processing_or_active"
        : "idle_or_unknown";
  const promptClearedByLifecycle = Boolean(
    PROMPTING_CLEARING_LIFECYCLE_TYPES.has(lifecycleType)
      || lifecycleEvent?.terminalIsPromptingUser === false
      || lifecycleEvent?.promptingUser === false
      || lifecycleEvent?.requiresUserInput === false
      || ["complete", "completed", "running", "processing", "error", "parked"].includes(lifecycleTerminalWorkState),
  );
  const explicitPrompting = valueLooksExplicitPermissionPrompt(lifecycleEvent || {});
  let promptingUser = emptyPromptingUserSignal();
  if (explicitPrompting) {
    promptingUser = explicitPermissionPromptingUserSignal(lifecycleEvent);
  } else if (!promptClearedByLifecycle) {
    promptingUser = storedPromptingUserSignal(liveTerminal, providerBinding);
  }
  const terminalIsPromptingUser = Boolean(
    promptingUser.isPromptingUser
      && !terminalIsParked
      && !["error", "interrupted"].includes(latestTurnState),
  );
  const terminalWorkState = terminalIsParked
    ? "parked"
    : terminalIsPromptingUser
      ? "prompting_user"
      : latestTurnState === "error" || terminalActivityStatusIsError(effectiveActivityStatus || activityStatus)
        ? "error"
        : effectiveLatestTurnState === "running" || terminalActivityStatusIsBusy(effectiveActivityStatus)
          ? "running"
          : (
              terminalGroundTruthStatus === "idle_or_input_ready"
              || COMPLETED_TURN_STATES.has(effectiveLatestTurnState)
              || agentInputReady
            )
            ? "complete"
            : "idle_unknown";
  const terminalIsComplete = terminalWorkState === "complete";

  return {
    activityStatus,
    agentInputReady,
    completedTurnLooksSendable,
    completedTurnLooksStaleActive,
    activityStatusLooksInputReady,
    effectiveActivityStatus,
    effectiveLatestTurnState,
    hasNativeSession,
    hasPendingPrompt,
    hookManagedAgent,
    hookManagedImplicitStartup,
    inputReadyAt,
    inputReadyAtMs,
    inputReadyIsFreshForTurn,
    latestTurnState,
    liveActivityStatus,
    liveActivityStatusExplicit,
    messageCount,
    orphanRunningLooksIdle,
    promptSubmissionPending,
    rawLiveActivityStatus,
    recordedAgentInputReady,
    requiresAgentInputReady,
    restoredRunningTurnLooksIdle,
    runningTurnLooksIdle,
    staleRunningWithoutLiveRuntimeLooksIdle,
    promptingUserConfidence: terminalIsPromptingUser ? promptingUser.confidence : "",
    promptingUserKind: terminalIsPromptingUser ? promptingUser.kind : "",
    promptingUserSource: terminalIsPromptingUser ? promptingUser.source : "",
    promptingUserText: terminalIsPromptingUser ? promptingUser.text : "",
    terminalGroundTruthStatus,
    terminalIsComplete,
    terminalIsPromptingUser,
    terminalIsParked,
    terminalWorkState,
    parkedStatus,
    terminalLooksActive,
    terminalLooksSendable,
    terminalStatus,
    turnStartedAt,
    turnStartedAtMs,
  };
}

export function terminalPromptingUserBlocksShutdown(groundTruth = {}) {
  const promptingUser = Boolean(
    groundTruth?.terminalIsPromptingUser === true
      || cleanText(groundTruth?.terminalWorkState).toLowerCase() === "prompting_user",
  );
  if (!promptingUser) {
    return false;
  }

  const source = cleanText(groundTruth?.promptingUserSource)
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  const kind = normalizePromptingUserKind(groundTruth?.promptingUserKind, "");
  return Boolean(
    EXPLICIT_PERMISSION_PROMPT_KINDS.has(kind)
      && source !== "latest-assistant-message"
      && !source.includes("terminal-output")
  );
}

export function threadLooksEffectivelyThinking(groundTruth = {}) {
  if (groundTruth.terminalIsPromptingUser || groundTruth.terminalWorkState === "prompting_user") {
    return false;
  }
  const latestTurnState = cleanText(
    groundTruth.effectiveLatestTurnState || groundTruth.latestTurnState,
  ).toLowerCase();
  const activityStatus = cleanText(
    groundTruth.effectiveActivityStatus || groundTruth.activityStatus,
  ).toLowerCase();
  return Boolean(
    latestTurnState === "running"
      || terminalActivityStatusIsBusy(activityStatus)
  );
}

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
    source.approval_id || source.permission_prompt_id || source.permission_request_id || source.source_event_id || source.tool_use_id,
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
  return source.terminal_is_prompting_user === true || source.prompting_user === true || source.requires_user_input === true;
}

function valueLooksExplicitPermissionPrompt(value = {}) {
  const sourceValue = value && typeof value === "object" ? value : {};
  if (!valueHasPromptingUserFlag(sourceValue)) {
    return false;
  }

  const kind = normalizePromptingUserKind(
    sourceValue.prompting_user_kind || sourceValue.prompting_kind,
    "",
  );
  const source = sourceValue.prompting_user_source || sourceValue.prompting_source || sourceValue.source || sourceValue.type;
  const hasPermissionKind = EXPLICIT_PERMISSION_PROMPT_KINDS.has(kind) || sourceValue.requires_user_input === true;

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
  const sourceText = value.prompting_user_source || value.prompting_source || value.source || value.type || "";
  return promptingUserSignal(
    value.prompting_user_kind || value.prompting_kind || value.requires_user_input ? "permission" : "approval",
    promptingSourceLooksExplicitPermission(sourceText)
      ? sourceText
      : promptingPermissionToken(value)
        ? "permission-token"
        : sourceText || "permission",
    value.prompting_user_text || value.prompting_text || value.terminal_prompt || value.output_text || value.text || "",
    value.prompting_user_confidence || value.prompting_confidence || "explicit-permission",
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
    Boolean(cleanText(binding?.native_session_id))
  ));
}

function explicitLiveTerminalActivityStatus(liveTerminal) {
  return cleanText(
    liveTerminal?.activity_status || liveTerminal?.native_rail_state || liveTerminal?.terminal_work_state,
  ).toLowerCase();
}

function normalizeLiveTerminalActivityStatus(liveTerminal) {
  const explicit = explicitLiveTerminalActivityStatus(liveTerminal);
  if (explicit) {
    return explicit;
  }

  const status = cleanText(
    liveTerminal?.terminal_status || liveTerminal?.status,
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

  const storedBinding = providerBinding?.terminal_binding || thread?.terminal_binding;
  const terminalIndex = storedBinding?.terminal_index ?? thread?.terminal_index;
  const terminalKey = terminalIndex == null ? "" : String(terminalIndex);
  const terminal = terminalKey ? workspaceThreadEntry.terminals?.[terminalKey] : null;
  if (!terminal) {
    return null;
  }

  const activityStatus = normalizeLiveTerminalActivityStatus(terminal);
  if (
    terminal.thread_id !== thread?.id
    || terminalActivityStatusIsClosed(activityStatus)
  ) {
    return null;
  }

  if (storedBinding?.pane_id && terminal.pane_id && storedBinding.pane_id !== terminal.pane_id) {
    return null;
  }

  if (
    storedBinding?.instance_id
    && terminal.instance_id
    && Number(storedBinding.instance_id) !== Number(terminal.instance_id)
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
  target_role: targetRole = "",
  terminalOutputText = "",
  thread = null,
} = {}) {
  const lifecycleType = cleanText(lifecycleEvent?.type).toLowerCase();
  const lifecycleTerminalWorkState = cleanText(
    lifecycleEvent?.terminal_work_state || lifecycleEvent?.status_truth,
  ).toLowerCase();
  const latestTurn = thread?.latest_turn || null;
  const latestTurnState = cleanText(latestTurn?.state).toLowerCase();
  const terminalStatus = cleanText(liveTerminal?.status).toLowerCase();
  const providerActivityStatus = "";
  const rawLiveActivityStatus = normalizeLiveTerminalActivityStatus(liveTerminal);
  const liveActivityStatusExplicit = Boolean(explicitLiveTerminalActivityStatus(liveTerminal));
  const providerBindings = thread?.provider_bindings
    && typeof thread.provider_bindings === "object"
    && !Array.isArray(thread.provider_bindings)
    ? thread.provider_bindings
    : {};
  const recordedAgentInputReady = Boolean(liveTerminal?.input_ready || providerBinding?.input_ready);
  const hookManagedAgent = terminalAgentUsesActivityHooks(targetRole)
    || terminalAgentUsesActivityHooks(liveTerminal?.agent_id)
    || terminalAgentUsesActivityHooks(providerBinding?.agent_id);
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
  const messageCount = normalizeMessageCount(thread?.message_count);
  const hasMessages = Array.isArray(thread?.messages) && thread.messages.length > 0;
  const hasProjectionEvents = Array.isArray(thread?.projection_events) && thread.projection_events.length > 0;
  const hasNativeSession = providerBindingsHaveNativeSession(providerBindings);
  const hasPendingPrompt = Boolean(thread?.pending_prompt);
  const promptSubmissionPending = Boolean(hasPendingPrompt && latestTurnState === "running");
  const hasTranscriptSession = Boolean(cleanText(thread?.transcript_session_id));
  const orphanRunningLooksIdle = Boolean(
    latestTurnState === "running"
      && !hasMessages
      && !hasProjectionEvents
      && !hasPendingPrompt
      && !hasTranscriptSession
      && !hasNativeSession
  );

  const inputReadyAt = cleanText(
    liveTerminal?.input_ready_at
      || providerBinding?.input_ready_at
  );
  const inputReadyAtMs = parseTimestampMs(inputReadyAt);
  const turnStartedAt = cleanText(
    latestTurn?.started_at
      || latestTurn?.requested_at
      || latestTurn?.updated_at,
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
      || cleanText(providerBinding?.native_session_id)
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
      || lifecycleEvent?.terminal_is_prompting_user === false
      || lifecycleEvent?.prompting_user === false
      || lifecycleEvent?.requires_user_input === false
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
    activity_status: activityStatus,
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
    input_ready_at: inputReadyAt,
    inputReadyAtMs,
    inputReadyIsFreshForTurn,
    latestTurnState,
    liveActivityStatus,
    liveActivityStatusExplicit,
    message_count: messageCount,
    orphanRunningLooksIdle,
    promptSubmissionPending,
    rawLiveActivityStatus,
    recordedAgentInputReady,
    requiresAgentInputReady,
    restoredRunningTurnLooksIdle,
    runningTurnLooksIdle,
    staleRunningWithoutLiveRuntimeLooksIdle,
    prompting_user_confidence: terminalIsPromptingUser ? promptingUser.confidence : "",
    prompting_user_kind: terminalIsPromptingUser ? promptingUser.kind : "",
    prompting_user_source: terminalIsPromptingUser ? promptingUser.source : "",
    prompting_user_text: terminalIsPromptingUser ? promptingUser.text : "",
    terminalGroundTruthStatus,
    terminal_is_complete: terminalIsComplete,
    terminal_is_prompting_user: terminalIsPromptingUser,
    terminal_is_parked: terminalIsParked,
    terminal_work_state: terminalWorkState,
    parkedStatus,
    terminalLooksActive,
    terminalLooksSendable,
    terminal_status: terminalStatus,
    turnStartedAt,
    turnStartedAtMs,
  };
}

export function terminalPromptingUserBlocksShutdown(groundTruth = {}) {
  const promptingUser = Boolean(
    groundTruth?.terminal_is_prompting_user === true
      || cleanText(groundTruth?.terminal_work_state).toLowerCase() === "prompting_user",
  );
  if (!promptingUser) {
    return false;
  }

  const source = cleanText(groundTruth?.prompting_user_source)
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  const kind = normalizePromptingUserKind(groundTruth?.prompting_user_kind, "");
  return Boolean(
    EXPLICIT_PERMISSION_PROMPT_KINDS.has(kind)
      && source !== "latest-assistant-message"
      && !source.includes("terminal-output")
  );
}

export function threadLooksEffectivelyThinking(groundTruth = {}) {
  if (groundTruth.terminal_is_prompting_user || groundTruth.terminal_work_state === "prompting_user") {
    return false;
  }
  const latestTurnState = cleanText(
    groundTruth.effectiveLatestTurnState || groundTruth.latestTurnState,
  ).toLowerCase();
  const activityStatus = cleanText(
    groundTruth.effectiveActivityStatus || groundTruth.activity_status,
  ).toLowerCase();
  return Boolean(
    latestTurnState === "running"
      || terminalActivityStatusIsBusy(activityStatus)
  );
}

const DEFAULT_AGENT_READY_ROLES = new Set(["codex", "claude", "opencode"]);
const COMPLETED_TURN_STATES = new Set(["completed", "error", "interrupted"]);
const PROMPTING_CLEARING_LIFECYCLE_TYPES = new Set([
  "message-submitted",
  "pending-prompt-sent",
  "provider-turn-started",
  "thread-starting",
]);
export const PARKED_TERMINAL_STATUSES = new Set(["parked", "resume_ready", "resume_requested"]);
const READINESS_MAX_AGE_MS = 10 * 60 * 1000;
let readinessVersion = 0;
const readinessListeners = new Set();
const readinessByThread = new Map();
const readinessByTerminal = new Map();

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

export function classifyTerminalUserPrompt(value, source = "text") {
  const text = cleanPromptingText(value);
  if (!text) {
    return emptyPromptingUserSignal();
  }

  const lower = text.toLowerCase();
  if (
    /\bselect\s+(?:model|reasoning|effort)\b/.test(lower)
    || /\bpress\s+enter\s+to\s+confirm\b/.test(lower) && /\besc(?:ape)?\b/.test(lower)
  ) {
    return promptingUserSignal("terminal-control", source, text, "terminal-control");
  }

  if (
    /\bapproval\s+(?:required|requested|needed)\b/.test(lower)
    || /\bawaiting\s+approval\b/.test(lower)
    || /\bapprove\s+or\s+(?:deny|reject)\b/.test(lower)
  ) {
    return promptingUserSignal("approval", source, text, "approval");
  }

  if (
    /\b(permission|authorization)\b.{0,80}\?/.test(lower)
    || /\b(?:allow|deny|grant)\b.{0,80}\?/.test(lower)
    || /\b(?:allow|deny)\s+(?:this|the)\b/.test(lower)
  ) {
    return promptingUserSignal("permission", source, text, "permission");
  }

  if (
    /\b(?:continue|proceed|confirm)\s*\?/.test(lower)
    || /\b(?:yes|no)\b\s*[\/|]\s*\b(?:yes|no)\b/.test(lower)
    || /(?:\[[yn]\/[yn]\]|\([yn]\/[yn]\))/.test(lower)
    || /\bpress\s+enter\s+to\s+(?:continue|confirm|proceed)\b/.test(lower)
  ) {
    return promptingUserSignal("confirmation", source, text, "confirmation");
  }

  if (
    /\b(?:choose|select|pick)\s+(?:one|an option|which|a)\b/.test(lower)
    || /\b(?:which|what)\s+(?:option|approach|file|workspace|branch|model)\b/.test(lower)
    || /\b(?:please\s+provide|need\s+(?:your\s+)?input|needs\s+(?:your\s+)?input|waiting\s+for\s+(?:your\s+)?input)\b/.test(lower)
    || /\b(?:can you clarify|could you clarify|please clarify)\b/.test(lower)
    || /\b(?:do you want|would you like|should i)\b.{0,160}\?/.test(lower)
  ) {
    return promptingUserSignal("clarification", source, text, "clarification");
  }

  return emptyPromptingUserSignal();
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
    candidate?.terminalIsPromptingUser === true
      || candidate?.promptingUser === true
      || candidate?.requiresUserInput === true
  ));
  if (!source) {
    return emptyPromptingUserSignal();
  }
  return promptingUserSignal(
    source.promptingUserKind || source.promptingKind || "unknown",
    source.promptingUserSource || source.promptingSource || "stored",
    source.promptingUserText || source.promptingText || "",
    source.promptingUserConfidence || source.promptingConfidence || "stored",
  );
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

function normalizeMessageCount(value) {
  const count = Number.parseInt(value ?? 0, 10);
  return Number.isFinite(count) ? count : 0;
}

function readinessKey(workspaceId, threadId) {
  const safeWorkspaceId = cleanText(workspaceId);
  const safeThreadId = cleanText(threadId);
  return safeWorkspaceId && safeThreadId ? `${safeWorkspaceId}:${safeThreadId}` : "";
}

function terminalReadinessKeys(workspaceId, terminal = {}) {
  const safeWorkspaceId = cleanText(workspaceId || terminal.workspaceId);
  if (!safeWorkspaceId) {
    return [];
  }

  const keys = [];
  const terminalIndex = terminal.terminalIndex;
  if (terminalIndex !== undefined && terminalIndex !== null && cleanText(terminalIndex) !== "") {
    keys.push(`${safeWorkspaceId}:terminal:${terminalIndex}`);
  }
  const paneId = cleanText(terminal.paneId);
  if (paneId) {
    keys.push(`${safeWorkspaceId}:pane:${paneId}`);
  }
  const instanceId = cleanText(terminal.instanceId);
  if (instanceId) {
    keys.push(`${safeWorkspaceId}:instance:${instanceId}`);
  }

  return Array.from(new Set(keys));
}

function notifyReadinessListeners() {
  readinessVersion += 1;
  readinessListeners.forEach((listener) => {
    try {
      listener();
    } catch (_) {
      // Listener failures should not block terminal readiness propagation.
    }
  });
}

function pruneReadinessRecords(nowMs = Date.now()) {
  const pruneMap = (map) => map.forEach((record, key) => {
    const readyAtMs = parseTimestampMs(record?.inputReadyAt || record?.promptReadyAt);
    if (readyAtMs > 0 && nowMs - readyAtMs > READINESS_MAX_AGE_MS) {
      map.delete(key);
    }
  });
  pruneMap(readinessByThread);
  pruneMap(readinessByTerminal);
}

export function recordThreadTerminalReadiness(event = {}) {
  const key = readinessKey(event.workspaceId, event.threadId);
  const terminalKeys = terminalReadinessKeys(event.workspaceId, event);
  if (!key && !terminalKeys.length) {
    return;
  }

  const readyAt = cleanText(
    event.inputReadyAt
      || event.promptReadyAt
      || event.completedAt
      || new Date().toISOString(),
  );
  const record = {
    agentId: cleanText(event.agentId || event.currentAgent),
    inputReady: true,
    inputReadyAt: readyAt,
    inputReadyConfidence: cleanText(event.inputReadyConfidence || event.promptReadyConfidence || event.source),
    instanceId: event.instanceId ?? "",
    paneId: cleanText(event.paneId),
    promptReadyAt: cleanText(event.promptReadyAt, readyAt),
    promptingUserConfidence: cleanText(event.promptingUserConfidence || event.promptingConfidence),
    promptingUserKind: cleanText(event.promptingUserKind || event.promptingKind),
    promptingUserSource: cleanText(event.promptingUserSource || event.promptingSource),
    promptingUserText: cleanPromptingText(event.promptingUserText || event.promptingText, 420),
    providerSessionId: cleanText(event.providerSessionId || event.nativeSessionId),
    source: cleanText(event.source || event.type),
    status: cleanText(event.status, "active"),
    terminalIsPromptingUser: event.terminalIsPromptingUser === true
      || event.promptingUser === true
      || event.requiresUserInput === true,
    terminalIndex: event.terminalIndex,
    threadId: cleanText(event.threadId),
    type: cleanText(event.type),
    workspaceId: cleanText(event.workspaceId),
  };
  pruneReadinessRecords();
  if (key) {
    readinessByThread.set(key, record);
  }
  terminalKeys.forEach((terminalKey) => {
    readinessByTerminal.set(terminalKey, record);
  });
  notifyReadinessListeners();
}

export function subscribeThreadTerminalReadiness(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  readinessListeners.add(listener);
  return () => {
    readinessListeners.delete(listener);
  };
}

export function getThreadTerminalReadinessVersion() {
  return readinessVersion;
}

function newestReadinessRecord(records) {
  let newest = null;
  let newestAt = 0;
  records.filter(Boolean).forEach((record) => {
    const readyAt = parseTimestampMs(record.inputReadyAt || record.promptReadyAt);
    if (!newest || readyAt >= newestAt) {
      newest = record;
      newestAt = readyAt;
    }
  });
  return newest;
}

export function getThreadTerminalReadinessSnapshot(workspaceId, threadId, terminalHint = null) {
  pruneReadinessRecords();
  const records = [
    readinessByThread.get(readinessKey(workspaceId, threadId)),
    ...terminalReadinessKeys(workspaceId, terminalHint || {}).map((key) => readinessByTerminal.get(key)),
  ];
  return newestReadinessRecord(records);
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

  if (
    terminal.threadId !== thread?.id
    || ![
      "active",
      "running",
      "starting",
      ...PARKED_TERMINAL_STATUSES,
    ].includes(cleanText(terminal.status).toLowerCase())
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
  const terminalStatus = cleanText(liveTerminal?.status).toLowerCase();
  const providerStatus = cleanText(providerBinding?.status).toLowerCase();
  const parkedStatus = [providerStatus, terminalStatus].find((status) => (
    PARKED_TERMINAL_STATUSES.has(status)
  )) || "";
  const terminalIsParked = Boolean(parkedStatus);
  const latestTurn = thread?.latestTurn || null;
  const latestTurnState = cleanText(latestTurn?.state).toLowerCase();
  const activityStatus = cleanText(
    thread?.activityStatus
      || providerBinding?.activityStatus
      || "",
  ).toLowerCase();
  const providerBindings = thread?.providerBindings
    && typeof thread.providerBindings === "object"
    && !Array.isArray(thread.providerBindings)
    ? thread.providerBindings
    : {};
  const messageCount = normalizeMessageCount(thread?.messageCount);
  const hasMessages = Array.isArray(thread?.messages) && thread.messages.length > 0;
  const hasProjectionEvents = Array.isArray(thread?.projectionEvents) && thread.projectionEvents.length > 0;
  const hasNativeSession = providerBindingsHaveNativeSession(providerBindings);
  const hasPendingPrompt = Boolean(thread?.pendingPrompt);
  const hasTranscriptSession = Boolean(cleanText(thread?.transcriptSessionId));
  const orphanRunningLooksIdle = Boolean(
    latestTurnState === "running"
      && messageCount <= 0
      && !hasMessages
      && !hasProjectionEvents
      && !hasPendingPrompt
      && !hasTranscriptSession
      && !hasNativeSession
  );

  const recordedAgentInputReady = Boolean(liveTerminal?.inputReady || providerBinding?.inputReady);
  const inputReadyAt = cleanText(
    liveTerminal?.inputReadyAt
      || liveTerminal?.promptReadyAt
      || providerBinding?.inputReadyAt
      || providerBinding?.promptReadyAt,
  );
  const inputReadyAtMs = parseTimestampMs(inputReadyAt);
  const turnStartedAt = cleanText(
    latestTurn?.startedAt
      || latestTurn?.requestedAt
      || latestTurn?.updatedAt,
  );
  const turnStartedAtMs = parseTimestampMs(turnStartedAt);
  const terminalLooksActive = ["active", "running"].includes(terminalStatus);
  const inputReadyIsFreshForTurn = Boolean(
    recordedAgentInputReady
      && inputReadyAtMs > 0
      && (!turnStartedAtMs || inputReadyAtMs >= turnStartedAtMs - 1000)
  );
  const runningTurnLooksIdle = Boolean(
    latestTurnState === "running"
      && (
        orphanRunningLooksIdle
        || (
          terminalLooksActive
          && inputReadyIsFreshForTurn
          && !hasPendingPrompt
        )
      )
  );
  const effectiveLatestTurnState = runningTurnLooksIdle
    ? "completed"
    : latestTurnState;
  const latestTurnFinished = COMPLETED_TURN_STATES.has(latestTurnState);
  const effectiveActivityStatus = (runningTurnLooksIdle || latestTurnFinished) && activityStatus === "thinking"
    ? "idle"
    : orphanRunningLooksIdle && activityStatus === "thinking"
      ? "idle"
      : activityStatus;
  const safeAgentReadyRoles = agentReadyRoles instanceof Set
    ? agentReadyRoles
    : new Set(Array.isArray(agentReadyRoles) ? agentReadyRoles : DEFAULT_AGENT_READY_ROLES);
  const requiresAgentInputReady = safeAgentReadyRoles.has(cleanText(targetRole).toLowerCase());
  const completedTurnLooksSendable = Boolean(
    requiresAgentInputReady
      && !recordedAgentInputReady
      && (COMPLETED_TURN_STATES.has(latestTurnState) || runningTurnLooksIdle || orphanRunningLooksIdle)
      && effectiveActivityStatus !== "thinking"
      && !hasPendingPrompt
      && terminalLooksActive
  );
  const agentInputReady = !requiresAgentInputReady
    || recordedAgentInputReady
    || completedTurnLooksSendable;
  const terminalGroundTruthStatus = runningTurnLooksIdle || (
    recordedAgentInputReady
    && inputReadyIsFreshForTurn
    && terminalLooksActive
  )
    ? "idle_or_prompt_ready"
    : latestTurnState === "running" || activityStatus === "thinking"
      ? "processing_or_active"
      : "idle_or_unknown";
  const promptClearedByLifecycle = Boolean(
    PROMPTING_CLEARING_LIFECYCLE_TYPES.has(lifecycleType)
      || lifecycleEvent?.terminalIsPromptingUser === false
      || lifecycleEvent?.promptingUser === false
      || lifecycleEvent?.requiresUserInput === false
      || ["complete", "completed", "running", "processing", "error", "parked"].includes(lifecycleTerminalWorkState),
  );
  const explicitPrompting = Boolean(
    lifecycleEvent?.terminalIsPromptingUser === true
      || lifecycleEvent?.promptingUser === true
      || lifecycleEvent?.requiresUserInput === true
      || lifecycleTerminalWorkState === "prompting_user"
      || lifecycleTerminalWorkState === "prompting-user",
  );
  const lifecyclePromptingText = cleanPromptingText(
    lifecycleEvent?.promptingUserText
      || lifecycleEvent?.promptingText
      || lifecycleEvent?.promptText
      || lifecycleEvent?.terminalPrompt
      || lifecycleEvent?.terminalText
      || lifecycleEvent?.outputText
      || lifecycleEvent?.text
      || terminalOutputText,
  );
  let promptingUser = emptyPromptingUserSignal();
  if (explicitPrompting) {
    promptingUser = promptingUserSignal(
      lifecycleEvent?.promptingUserKind || lifecycleEvent?.promptingKind || "unknown",
      lifecycleEvent?.promptingUserSource || lifecycleEvent?.source || lifecycleType || "lifecycle",
      lifecyclePromptingText,
      lifecycleEvent?.promptingUserConfidence || "explicit",
    );
  } else if (!promptClearedByLifecycle) {
    promptingUser = classifyTerminalUserPrompt(lifecyclePromptingText, lifecycleEvent?.source || lifecycleType || "terminal-output");
    if (!promptingUser.isPromptingUser) {
      promptingUser = storedPromptingUserSignal(liveTerminal, providerBinding);
    }
    if (!promptingUser.isPromptingUser && agentInputReady) {
      promptingUser = classifyTerminalUserPrompt(latestAssistantMessageText(thread), "latest-assistant-message");
    }
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
      : latestTurnState === "error" || terminalStatus === "error" || providerStatus === "error"
        ? "error"
        : latestTurnState === "running" || effectiveActivityStatus === "thinking"
          ? "running"
          : (
              terminalGroundTruthStatus === "idle_or_prompt_ready"
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
    effectiveActivityStatus,
    effectiveLatestTurnState,
    hasNativeSession,
    hasPendingPrompt,
    inputReadyAt,
    inputReadyAtMs,
    inputReadyIsFreshForTurn,
    latestTurnState,
    messageCount,
    orphanRunningLooksIdle,
    recordedAgentInputReady,
    requiresAgentInputReady,
    runningTurnLooksIdle,
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
    terminalStatus,
    turnStartedAt,
    turnStartedAtMs,
  };
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
      || activityStatus === "thinking"
  );
}

export function terminalOutputLooksPromptReady(value) {
  const text = typeof value === "string"
    ? value
    : value == null
      ? ""
      : String(value);
  return Boolean(
    text.includes("\n›")
      || text.includes("\r›")
      || text.includes("› ")
      || text.includes("\n> ")
      || text.includes("\r> ")
  );
}

const DEFAULT_AGENT_READY_ROLES = new Set(["codex", "claude", "opencode"]);
const COMPLETED_TURN_STATES = new Set(["completed", "error", "interrupted"]);
const READINESS_MAX_AGE_MS = 10 * 60 * 1000;
let readinessVersion = 0;
const readinessListeners = new Set();
const readinessByThread = new Map();
const readinessByTerminal = new Map();

function cleanText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
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
    providerSessionId: cleanText(event.providerSessionId || event.nativeSessionId),
    source: cleanText(event.source || event.type),
    status: cleanText(event.status, "active"),
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
    || !["active", "running", "starting"].includes(cleanText(terminal.status).toLowerCase())
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
  liveTerminal = null,
  providerBinding = null,
  targetRole = "",
  thread = null,
} = {}) {
  const terminalStatus = cleanText(liveTerminal?.status).toLowerCase();
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
    terminalGroundTruthStatus,
    terminalLooksActive,
    terminalStatus,
    turnStartedAt,
    turnStartedAtMs,
  };
}

export function threadLooksEffectivelyThinking(groundTruth = {}) {
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

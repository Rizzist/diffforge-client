export function parseTerminalStateTimestampMs(value) {
  if (typeof value !== "string" || !value.trim()) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const TERMINAL_ACTIVITY_THINKING_STATES = new Set([
  "busy",
  "dispatched",
  "implementing",
  "pending",
  "queued",
  "reasoning",
  "resume_requested",
  "resumed",
  "running",
  "submitted",
  "thinking",
  "working",
]);

const TERMINAL_ACTIVITY_IDLE_STATES = new Set([
  "complete",
  "completed",
  "done",
  "idle",
  "input_ready",
  "interrupted",
  "prompt_ready",
  "ready",
]);

const TERMINAL_ACTIVITY_PAUSED_STATES = new Set([
  "needs_input",
  "parked",
  "paused",
  "prompting_user",
  "resume_ready",
  "waiting",
]);

const TERMINAL_ACTIVITY_ERROR_STATES = new Set([
  "error",
  "failed",
  "failure",
]);

const TERMINAL_ACTIVITY_CLOSED_STATES = new Set([
  "closed",
  "closing",
  "exited",
  "no_session",
  "offline",
  "stopped",
  "terminated",
]);

function normalizeActivityText(value, fallback = "") {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return text || fallback;
}

export function normalizeTerminalActivityStatus(value, fallback = "") {
  return normalizeActivityText(value, fallback);
}

export function terminalRailStateFromActivityStatus(activityStatus, fallback = "idle") {
  const activity = normalizeActivityText(activityStatus, "");
  if (activity) return activity;
  return normalizeActivityText(fallback, "idle");
}

export function terminalActivityStatusIsBusy(activityStatus) {
  return TERMINAL_ACTIVITY_THINKING_STATES.has(normalizeActivityText(activityStatus, ""));
}

export function terminalActivityStatusIsClosed(activityStatus) {
  return TERMINAL_ACTIVITY_CLOSED_STATES.has(normalizeActivityText(activityStatus, ""));
}

export function terminalActivityStatusIsError(activityStatus) {
  return TERMINAL_ACTIVITY_ERROR_STATES.has(normalizeActivityText(activityStatus, ""));
}

export function terminalActivityStatusIsPaused(activityStatus) {
  return TERMINAL_ACTIVITY_PAUSED_STATES.has(normalizeActivityText(activityStatus, ""));
}

export function terminalActivityStatusIsSendable(activityStatus) {
  return TERMINAL_ACTIVITY_IDLE_STATES.has(normalizeActivityText(activityStatus, ""));
}

export function terminalPresenceStatusFromActivityStatus(activityStatus, options = {}) {
  const terminalLifecycle = normalizeActivityText(options.terminalLifecycle, "");
  const liveStatus = normalizeActivityText(options.liveStatus, "");
  if (terminalLifecycle === "closed" || liveStatus === "closed") return "closed";
  if (terminalLifecycle === "closing" || liveStatus === "closing") return "closing";
  if (terminalLifecycle === "exited" || liveStatus === "exited") return "closed";
  if (terminalLifecycle === "offline" || liveStatus === "offline") return "offline";
  if (options.terminalIsParked || options.terminalIsPromptingUser) return "paused";
  return terminalRailStateFromActivityStatus(activityStatus, options.fallbackStatus || "idle");
}

export function terminalReadinessFromPresenceStatus(status) {
  const normalizedStatus = normalizeActivityText(status, "idle");
  if (TERMINAL_ACTIVITY_THINKING_STATES.has(normalizedStatus)) {
    return "busy";
  }
  if (TERMINAL_ACTIVITY_PAUSED_STATES.has(normalizedStatus)) return "needs_input";
  if (TERMINAL_ACTIVITY_ERROR_STATES.has(normalizedStatus)) return "error";
  if (normalizedStatus === "closing") return "closing";
  if (TERMINAL_ACTIVITY_CLOSED_STATES.has(normalizedStatus)) return "closed";
  return "ready";
}

export function terminalTurnStatusFromActivityStatus(activityStatus, status = "") {
  const activity = normalizeActivityText(activityStatus, normalizeActivityText(status, "idle"));
  if (TERMINAL_ACTIVITY_THINKING_STATES.has(activity)) return "running";
  if (TERMINAL_ACTIVITY_ERROR_STATES.has(activity)) return "failed";
  if (TERMINAL_ACTIVITY_PAUSED_STATES.has(activity)) return "pending";
  if (TERMINAL_ACTIVITY_CLOSED_STATES.has(activity)) return "interrupted";
  return "completed";
}

export function shouldSuppressThreadPropThinking({
  latestTurn = null,
  lastReadyAtMs = 0,
  nextStatus = "",
  previousStatus = "",
  source = "",
  submittedPrompt = null,
  threadId = "",
  readyLifecycleEmitted = false,
} = {}) {
  const normalizedSource = String(source || "").trim().toLowerCase();
  const normalizedNext = String(nextStatus || "").trim().toLowerCase();
  const normalizedPrevious = String(previousStatus || "").trim().toLowerCase();
  if (normalizedSource !== "thread_prop_status_sync" || normalizedNext !== "thinking") {
    return false;
  }
  if (normalizedPrevious === "thinking") {
    return false;
  }

  const safeThreadId = String(threadId || "").trim();
  const submittedPromptThread = String(submittedPrompt?.threadId || "").trim();
  if (submittedPrompt && (!safeThreadId || submittedPromptThread === safeThreadId)) {
    return false;
  }
  const latestTurnState = String(latestTurn?.state || latestTurn?.status || "").trim().toLowerCase();
  const turnStartedAtMs = parseTerminalStateTimestampMs(
    latestTurn?.startedAt
      || latestTurn?.requestedAt
      || latestTurn?.createdAt
      || latestTurn?.updatedAt
      || "",
  );
  const safeLastReadyAtMs = Number(lastReadyAtMs || 0);
  const readyIsNewerThanTurn = Boolean(
    safeLastReadyAtMs > 0
      && (!turnStartedAtMs || turnStartedAtMs <= safeLastReadyAtMs + 1000)
  );

  return Boolean(
    readyLifecycleEmitted
      && (
        latestTurnState === "thinking"
        || latestTurnState === "running"
        || latestTurnState === "working"
        || !latestTurnState
      )
      && readyIsNewerThanTurn
  );
}

export function buildTerminalReadinessEpochKey({
  instanceId = 0,
  paneId = "",
  threadId = "",
} = {}) {
  const safePaneId = String(paneId || "").trim();
  const safeThreadId = String(threadId || "").trim();
  const safeInstanceId = Number(instanceId || 0);
  if (!safePaneId || !safeThreadId || !Number.isFinite(safeInstanceId) || safeInstanceId <= 0) {
    return "";
  }

  return `${safePaneId}::${safeInstanceId}::${safeThreadId}`;
}

export function isReadyLifecycleEmittedForEpoch({
  currentEpoch = "",
  readyLifecycleEmitted = false,
  readyLifecycleEpoch = "",
} = {}) {
  const safeCurrentEpoch = String(currentEpoch || "").trim();
  return Boolean(
    readyLifecycleEmitted
      && safeCurrentEpoch
      && String(readyLifecycleEpoch || "").trim() === safeCurrentEpoch
  );
}

export function shouldEmitPromptReadyLifecycle({
  currentReadyEpoch = "",
  isGenericTerminal = false,
  looksActive = false,
  looksReady = false,
  readyLifecycleEmitted = false,
  readyLifecycleEpoch = "",
  threadId = "",
} = {}) {
  const alreadyEmitted = currentReadyEpoch
    ? isReadyLifecycleEmittedForEpoch({
      currentEpoch: currentReadyEpoch,
      readyLifecycleEmitted,
      readyLifecycleEpoch,
    })
    : readyLifecycleEmitted;

  return Boolean(
    looksReady === true
      && looksActive !== true
      && !isGenericTerminal
      && String(threadId || "").trim()
      && !alreadyEmitted
  );
}

export function parseTerminalStateTimestampMs(value) {
  if (typeof value !== "string" || !value.trim()) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

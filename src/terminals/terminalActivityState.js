export function parseTerminalStateTimestampMs(value) {
  if (typeof value !== "string" || !value.trim()) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const TERMINAL_ACTIVITY_THINKING_STATES = new Set([
  "busy",
  "delegating",
  "dispatched",
  "editing",
  "implementing",
  "mcp",
  "pending",
  "queued",
  "reasoning",
  "resume_requested",
  "resumed",
  "running",
  "shell",
  "starting",
  "subagent",
  "subagent_completed",
  "subagent_running",
  "submitted",
  "thinking",
  "tool",
  "tool_completed",
  "tool_running",
  "working",
]);

const TERMINAL_ACTIVITY_IDLE_STATES = new Set([
  "cancelled",
  "canceled",
  "complete",
  "completed",
  "done",
  "idle",
  "input_ready",
  "interrupted",
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

const TERMINAL_TURN_FINISHED_STATES = new Set([
  "cancelled",
  "canceled",
  "complete",
  "completed",
  "done",
  "interrupted",
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

const TERMINAL_ACTIVITY_HOOK_AGENT_KINDS = new Set(["claude", "codex"]);

function normalizeActivityText(value, fallback = "") {
  const text = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return text || fallback;
}

export function terminalAgentUsesActivityHooks(agentKind) {
  return TERMINAL_ACTIVITY_HOOK_AGENT_KINDS.has(normalizeActivityText(agentKind, ""));
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

export function workspaceTerminalStatusFromActivityStatus(activityStatus, options = {}) {
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
  if (["cancelled", "canceled", "interrupted"].includes(activity)) return "interrupted";
  if (TERMINAL_ACTIVITY_THINKING_STATES.has(activity)) return "running";
  if (TERMINAL_ACTIVITY_ERROR_STATES.has(activity)) return "failed";
  if (TERMINAL_ACTIVITY_PAUSED_STATES.has(activity)) return "pending";
  if (TERMINAL_ACTIVITY_CLOSED_STATES.has(activity)) return "interrupted";
  return "completed";
}

export function terminalCommandPhaseFromLifecycleEvent(eventType, fields = {}) {
  const explicit = normalizeActivityText(fields.commandPhase || fields.command_phase, "");
  if (explicit) return explicit;

  const type = normalizeActivityText(eventType || fields.eventType || fields.type, "");
  if (type === "remote_command_queued" || type === "remote-command-queued") return "queued";
  if (type === "pending_prompt_sent" || type === "pending-prompt-sent") return "submitted";
  if (type === "message_submitted" || type === "message-submitted") return "input_written";
  if (type === "provider_turn_started" || type === "provider-turn-started") return "running";
  if (type === "agent_output" || type === "agent-output") return "running";
  if (type === "provider_turn_completed" || type === "provider-turn-completed") return "completed";
  if (type === "provider_turn_interrupted" || type === "provider-turn-interrupted") return "interrupted";
  if (type === "pending_prompt_error" || type === "pending-prompt-error") return "failed";
  if (type === "provider_turn_error" || type === "provider-turn-error") return "failed";
  if (type === "closed" || type === "closing" || type === "exited") return type;

  return "";
}

export function terminalExecutionPhaseFromState(fields = {}) {
  const eventType = normalizeActivityText(fields.eventType || fields.type, "");
  const commandPhase = normalizeActivityText(fields.commandPhase || fields.command_phase, "");
  const activity = normalizeActivityText(
    fields.activityStatus
      || fields.activity_status
      || fields.nativeRailState
      || fields.native_rail_state
      || fields.status,
    "",
  );
  const status = normalizeActivityText(fields.status || fields.statusAfter || fields.status_after, "");
  const readiness = normalizeActivityText(fields.readiness || fields.readinessAfter || fields.readiness_after, "");
  const turn = normalizeActivityText(fields.turnStatus || fields.turn_status, "");
  const lifecycle = normalizeActivityText(fields.terminalLifecycle || fields.terminal_lifecycle, "");

  if (lifecycle === "offline" || activity === "offline" || status === "offline") return "offline";
  if (lifecycle === "exited" || activity === "exited" || status === "exited") return "exited";
  if (["closed", "closing", "terminated"].includes(lifecycle) || ["closed", "closing", "terminated"].includes(status)) {
    return lifecycle === "closing" || status === "closing" ? "closing" : "closed";
  }
  if (eventType === "provider_turn_interrupted" || turn === "interrupted") return "interrupted";
  if (turn === "cancelled" || turn === "canceled" || commandPhase === "cancelled" || commandPhase === "canceled") return "cancelled";
  if (eventType === "provider_turn_error" || eventType === "pending_prompt_error" || turn === "failed" || turn === "error") return "failed";
  if (TERMINAL_ACTIVITY_ERROR_STATES.has(activity) || readiness === "error" || status === "error") return "failed";
  if (TERMINAL_ACTIVITY_PAUSED_STATES.has(activity) || readiness === "needs_input" || readiness === "paused") return "needs_input";
  if (commandPhase === "queued") return "queued";
  if (
    ["submitted", "input_written", "accepted", "running"].includes(commandPhase)
      || ["message_submitted", "provider_turn_started", "agent_output", "pending_prompt_sent"].includes(eventType)
      || TERMINAL_ACTIVITY_THINKING_STATES.has(activity)
      || ["queued", "submitted", "pending", "running", "thinking", "reasoning", "working"].includes(turn)
      || (readiness === "busy" && !TERMINAL_TURN_FINISHED_STATES.has(turn))
  ) {
    return "running";
  }
  if (
    eventType === "provider_turn_completed"
      || ["completed", "complete", "done"].includes(commandPhase)
      || TERMINAL_TURN_FINISHED_STATES.has(turn)
      || TERMINAL_ACTIVITY_IDLE_STATES.has(activity)
      || readiness === "ready"
      || readiness === "input_ready"
  ) {
    return "idle";
  }

  return "idle";
}

export function terminalRailStateFromExecutionPhase(executionPhase, fallback = "idle") {
  const phase = normalizeActivityText(executionPhase, "");
  if (["offline", "closed", "closing", "exited"].includes(phase)) return phase;
  if (phase === "failed") return "error";
  if (phase === "needs_input" || phase === "paused" || phase === "parked" || phase === "resume_ready") return "paused";
  if (["queued", "submitted", "input_written", "accepted", "running", "cancelling"].includes(phase)) return "thinking";
  if (["cancelled", "canceled", "interrupted"].includes(phase)) return "interrupted";
  if (["completed", "complete", "done", "idle"].includes(phase)) return "idle";
  return terminalRailStateFromActivityStatus("", fallback);
}

export function shouldSuppressThreadPropThinking({
  latestTurn = null,
  lastReadyAtMs = 0,
  nextStatus = "",
  previousStatus = "",
  source = "",
  submittedPrompt = null,
  threadId = "",
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
    (
      latestTurnState === "thinking"
      || latestTurnState === "running"
      || latestTurnState === "working"
      || !latestTurnState
    )
      && readyIsNewerThanTurn
  );
}

export function parseTerminalStateTimestampMs(value) {
  if (typeof value !== "string" || !value.trim()) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const TERMINAL_ACTIVITY_THINKING_STATES = new Set([
  "busy",
  "compacting",
  "compaction",
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

const TERMINAL_ACTIVITY_ATTENTION_STATES = new Set([
  "awaiting_input",
  "awaiting_user",
  "needs_input",
  "prompting_user",
  "requires_input",
  "requires_user_input",
  "uir",
  "user_input_required",
]);

const TERMINAL_ACTIVITY_PAUSED_STATES = new Set([
  ...TERMINAL_ACTIVITY_ATTENTION_STATES,
  "parked",
  "paused",
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

const TERMINAL_ACTIVITY_HOOK_AGENT_KINDS = new Set(["claude", "codex", "opencode"]);
const TERMINAL_CANONICAL_STATES = new Set([
  "starting",
  "idle",
  "thinking",
  "paused",
  "uir",
  "interrupted",
  "error",
  "closing",
  "closed",
  "offline",
]);

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

export function terminalCanonicalStateFromFields(fields = {}) {
  const contractVersion = Number(
    fields?.terminal_state_contract_version ?? fields?.terminalStateContractVersion ?? 0,
  );
  if (contractVersion !== 1) return "";
  const state = normalizeActivityText(
    fields?.canonical_state ?? fields?.canonicalState,
    "",
  );
  return TERMINAL_CANONICAL_STATES.has(state) ? state : "";
}

const TERMINAL_CANONICAL_COHORT_KEYS = [
  ["terminal_state_contract_version", "terminalStateContractVersion"],
  ["canonical_state", "canonicalState"],
  ["canonical_badge_label", "canonicalBadgeLabel"],
  ["canonical_state_seq", "canonicalStateSeq"],
  ["turn_active", "turnActive"],
  ["turn_generation", "turnGeneration"],
  ["completed_turn_generation", "completedTurnGeneration"],
  ["active_interaction_id", "activeInteractionId"],
  ["active_interaction_revision", "activeInteractionRevision"],
  ["interaction_actionable", "interactionActionable"],
];

function terminalCanonicalOwnField(fields, snakeKey, camelKey) {
  if (Object.prototype.hasOwnProperty.call(fields || {}, snakeKey)) {
    return fields[snakeKey];
  }
  if (Object.prototype.hasOwnProperty.call(fields || {}, camelKey)) {
    return fields[camelKey];
  }
  return undefined;
}

function terminalCanonicalHasOwnField(fields, snakeKey, camelKey) {
  return Object.prototype.hasOwnProperty.call(fields || {}, snakeKey)
    || Object.prototype.hasOwnProperty.call(fields || {}, camelKey);
}

function terminalCanonicalInstanceId(fields = {}) {
  return String(
    fields?.instance_id
      ?? fields?.terminal_instance_id
      ?? fields?.instanceId
      ?? fields?.terminalInstanceId
      ?? "",
  ).trim();
}

function terminalCanonicalProcessEpoch(fields = {}) {
  return String(
    fields?.terminal_process_epoch
      ?? fields?.terminalProcessEpoch
      ?? "",
  ).trim();
}

function terminalCanonicalProcessEpochSequence(epoch = "") {
  const match = String(epoch || "").trim().match(/^(\d+)(?:-|$)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function terminalCanonicalProcessEpochOrder(previous = {}, incoming = {}) {
  const previousEpoch = terminalCanonicalProcessEpoch(previous);
  const incomingEpoch = terminalCanonicalProcessEpoch(incoming);
  if (!incomingEpoch || incomingEpoch === previousEpoch) return 0;
  if (!previousEpoch) return 1;
  const previousSequence = terminalCanonicalProcessEpochSequence(previousEpoch);
  const incomingSequence = terminalCanonicalProcessEpochSequence(incomingEpoch);
  if (previousSequence != null && incomingSequence != null) {
    return incomingSequence < previousSequence ? -1 : 1;
  }
  return 1;
}

function terminalCanonicalNumericInstanceId(fields = {}) {
  const text = terminalCanonicalInstanceId(fields);
  if (!/^\d+$/.test(text)) return 0;
  const value = Number(text);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function terminalCanonicalSequence(fields = {}, snakeKey, camelKey) {
  const value = Number(terminalCanonicalOwnField(fields, snakeKey, camelKey));
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function terminalCanonicalLifecycleIsAuthoritative(fields = {}) {
  const type = normalizeActivityText(fields?.type || fields?.event_type, "");
  return ["closing", "closed", "error"].includes(type);
}

function terminalCanonicalCohortComplete(fields = {}) {
  const requiredValueKeys = [
    ["canonical_badge_label", "canonicalBadgeLabel"],
    ["turn_active", "turnActive"],
    ["turn_generation", "turnGeneration"],
    ["completed_turn_generation", "completedTurnGeneration"],
    ["interaction_actionable", "interactionActionable"],
  ];
  return Boolean(terminalCanonicalStateFromFields(fields))
    && terminalCanonicalSequence(fields, "canonical_state_seq", "canonicalStateSeq") != null
    && TERMINAL_CANONICAL_COHORT_KEYS.every(([snakeKey, camelKey]) => (
      terminalCanonicalHasOwnField(fields, snakeKey, camelKey)
    ))
    && requiredValueKeys.every(([snakeKey, camelKey]) => (
      terminalCanonicalOwnField(fields, snakeKey, camelKey) != null
    ));
}

function terminalCanonicalCohortFields(fields = {}) {
  return {
    terminal_state_contract_version: terminalCanonicalOwnField(
      fields,
      "terminal_state_contract_version",
      "terminalStateContractVersion",
    ),
    canonical_state: terminalCanonicalOwnField(fields, "canonical_state", "canonicalState"),
    canonical_badge_label: terminalCanonicalOwnField(
      fields,
      "canonical_badge_label",
      "canonicalBadgeLabel",
    ),
    canonical_state_seq: terminalCanonicalOwnField(
      fields,
      "canonical_state_seq",
      "canonicalStateSeq",
    ),
    turn_active: terminalCanonicalOwnField(fields, "turn_active", "turnActive"),
    turn_generation: terminalCanonicalOwnField(
      fields,
      "turn_generation",
      "turnGeneration",
    ),
    completed_turn_generation: terminalCanonicalOwnField(
      fields,
      "completed_turn_generation",
      "completedTurnGeneration",
    ),
    active_interaction_id: terminalCanonicalOwnField(
      fields,
      "active_interaction_id",
      "activeInteractionId",
    ),
    active_interaction_revision: terminalCanonicalOwnField(
      fields,
      "active_interaction_revision",
      "activeInteractionRevision",
    ),
    interaction_actionable: terminalCanonicalOwnField(
      fields,
      "interaction_actionable",
      "interactionActionable",
    ),
  };
}

export function terminalCanonicalEventIsStale(previous = {}, incoming = {}) {
  const processEpochOrder = terminalCanonicalProcessEpochOrder(previous, incoming);
  if (processEpochOrder < 0) {
    return true;
  }
  if (processEpochOrder > 0) {
    return false;
  }
  const previousInstanceId = terminalCanonicalNumericInstanceId(previous);
  const incomingInstanceId = terminalCanonicalNumericInstanceId(incoming);
  if (previousInstanceId && incomingInstanceId && incomingInstanceId < previousInstanceId) {
    return true;
  }
  if (previousInstanceId && incomingInstanceId && incomingInstanceId > previousInstanceId) {
    return false;
  }

  const previousCanonicalSeq = terminalCanonicalSequence(
    previous,
    "canonical_state_seq",
    "canonicalStateSeq",
  );
  const incomingCanonicalSeq = terminalCanonicalSequence(
    incoming,
    "canonical_state_seq",
    "canonicalStateSeq",
  );
  if (
    previousCanonicalSeq != null
    && incomingCanonicalSeq != null
    && incomingCanonicalSeq < previousCanonicalSeq
  ) {
    return true;
  }
  const previousPromptSeq = terminalCanonicalSequence(
    previous,
    "prompt_state_seq",
    "promptStateSeq",
  );
  const incomingPromptSeq = terminalCanonicalSequence(
    incoming,
    "prompt_state_seq",
    "promptStateSeq",
  );
  return previousPromptSeq != null
    && incomingPromptSeq != null
    && incomingPromptSeq < previousPromptSeq;
}

export function terminalCanonicalCohortForInstance(previous = {}, incoming = {}) {
  if (terminalCanonicalEventIsStale(previous, incoming)) {
    return {
      ...terminalCanonicalCohortFields(previous),
      prompt_state_seq: terminalCanonicalOwnField(previous, "prompt_state_seq", "promptStateSeq"),
    };
  }
  const processEpochChanged = terminalCanonicalProcessEpochOrder(previous, incoming) > 0;
  const previousNumericInstanceId = terminalCanonicalNumericInstanceId(previous);
  const incomingNumericInstanceId = terminalCanonicalNumericInstanceId(incoming);
  const instanceChanged = Boolean(
    processEpochChanged
      || (
        previousNumericInstanceId
        && incomingNumericInstanceId
        && previousNumericInstanceId !== incomingNumericInstanceId
      ),
  );
  if (terminalCanonicalLifecycleIsAuthoritative(incoming)) {
    return {
      ...terminalCanonicalCohortFields({}),
      canonical_state_seq: terminalCanonicalOwnField(
        previous,
        "canonical_state_seq",
        "canonicalStateSeq",
      ),
      prompt_state_seq: terminalCanonicalOwnField(
        previous,
        "prompt_state_seq",
        "promptStateSeq",
      ),
    };
  }
  const fallback = instanceChanged ? {} : previous;
  const previousCanonicalSeq = terminalCanonicalSequence(
    fallback,
    "canonical_state_seq",
    "canonicalStateSeq",
  );
  const incomingCanonicalSeq = terminalCanonicalSequence(
    incoming,
    "canonical_state_seq",
    "canonicalStateSeq",
  );
  const incomingCanonicalWins = terminalCanonicalCohortComplete(incoming)
    && (
      previousCanonicalSeq == null
      || incomingCanonicalSeq >= previousCanonicalSeq
    );
  const canonicalCohort = incomingCanonicalWins
    ? terminalCanonicalCohortFields(incoming)
    : terminalCanonicalCohortFields(fallback);
  const previousPromptSeq = terminalCanonicalSequence(
    fallback,
    "prompt_state_seq",
    "promptStateSeq",
  );
  const incomingPromptSeq = terminalCanonicalSequence(
    incoming,
    "prompt_state_seq",
    "promptStateSeq",
  );
  const promptStateSeq = incomingPromptSeq != null
    && (previousPromptSeq == null || incomingPromptSeq >= previousPromptSeq)
    ? terminalCanonicalOwnField(incoming, "prompt_state_seq", "promptStateSeq")
    : terminalCanonicalOwnField(fallback, "prompt_state_seq", "promptStateSeq");
  return {
    ...canonicalCohort,
    prompt_state_seq: promptStateSeq,
  };
}

export function terminalLifecycleSettlementAccepted(fields = {}) {
  const type = normalizeActivityText(fields?.type || fields?.event_type, "");
  if (type !== "provider_turn_completed" && type !== "provider_turn_interrupted") {
    return true;
  }
  const explicit = fields?.turn_settlement_accepted ?? fields?.turnSettlementAccepted;
  if (typeof explicit === "boolean") {
    return explicit;
  }
  const canonicalState = terminalCanonicalStateFromFields(fields);
  if (!canonicalState) {
    return true;
  }
  if (fields?.turn_active === true || fields?.turnActive === true) {
    return false;
  }
  return type === "provider_turn_completed"
    ? canonicalState === "idle"
    : canonicalState === "interrupted";
}

export function terminalLifecycleSettlementSideEffectsAllowed(fields = {}) {
  const type = normalizeActivityText(fields?.type || fields?.event_type, "");
  if (type !== "provider_turn_completed" && type !== "provider_turn_interrupted") {
    return true;
  }
  return terminalLifecycleSettlementAccepted(fields);
}

export function terminalCanonicalBadgePresentation(fields = {}, fallback = "idle") {
  const state = terminalCanonicalStateFromFields(fields);
  if (!state) return null;
  const fallbackPresentation = terminalRailBadgePresentation(state, fallback);
  const authoredLabel = fields?.canonical_badge_label ?? fields?.canonicalBadgeLabel;
  return {
    ...fallbackPresentation,
    label: authoredLabel == null ? fallbackPresentation.label : String(authoredLabel),
    state,
  };
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

export function terminalActivityStatusNeedsAttention(activityStatus) {
  return TERMINAL_ACTIVITY_ATTENTION_STATES.has(normalizeActivityText(activityStatus, ""));
}

export function terminalActivityStatusIsSendable(activityStatus) {
  return TERMINAL_ACTIVITY_IDLE_STATES.has(normalizeActivityText(activityStatus, ""));
}

export function workspaceTerminalStatusFromActivityStatus(activityStatus, options = {}) {
  const terminalLifecycle = normalizeActivityText(options.terminal_lifecycle, "");
  const liveStatus = normalizeActivityText(options.liveStatus, "");
  const normalizedActivity = normalizeActivityText(activityStatus, "");
  if (terminalLifecycle === "closed" || liveStatus === "closed") return "closed";
  if (terminalLifecycle === "closing" || liveStatus === "closing") return "closing";
  if (terminalLifecycle === "exited" || liveStatus === "exited") return "closed";
  if (terminalLifecycle === "offline" || liveStatus === "offline") return "offline";
  if (options.terminal_is_prompting_user || TERMINAL_ACTIVITY_ATTENTION_STATES.has(normalizedActivity)) {
    return "awaiting_input";
  }
  if (options.terminal_is_parked) return "paused";
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
  if (activity === "compacting" || activity === "compaction") return "running";
  if (TERMINAL_ACTIVITY_THINKING_STATES.has(activity)) return "running";
  if (TERMINAL_ACTIVITY_ERROR_STATES.has(activity)) return "failed";
  if (TERMINAL_ACTIVITY_PAUSED_STATES.has(activity)) return "pending";
  if (TERMINAL_ACTIVITY_CLOSED_STATES.has(activity)) return "interrupted";
  return "completed";
}

export function terminalCommandPhaseFromLifecycleEvent(eventType, fields = {}) {
  const explicit = normalizeActivityText(fields.command_phase, "");
  if (explicit) return explicit;

  const type = normalizeActivityText(eventType || fields.event_type || fields.type, "");
  if (type === "remote_command_queued" || type === "remote-command-queued") return "queued";
  if (type === "pending_prompt_sent" || type === "pending-prompt-sent") return "submitted";
  if (type === "message_submitted" || type === "message-submitted") return "input_written";
  if (type === "provider_turn_started" || type === "provider-turn-started") return "running";
  if (type === "provider_turn_compacting" || type === "provider-turn-compacting") return "compacting";
  if (type === "context_compaction_started" || type === "context-compaction-started") return "compacting";
  if (type === "agent_output" || type === "agent-output") return "running";
  if (type === "provider_turn_completed" || type === "provider-turn-completed") return "completed";
  if (type === "provider_turn_interrupted" || type === "provider-turn-interrupted") return "interrupted";
  if (type === "pending_prompt_error" || type === "pending-prompt-error") return "failed";
  if (type === "provider_turn_error" || type === "provider-turn-error") return "failed";
  if (type === "closed" || type === "closing" || type === "exited") return type;

  return "";
}

export function terminalExecutionPhaseFromState(fields = {}) {
  const eventType = normalizeActivityText(fields.event_type || fields.type, "");
  const commandPhase = normalizeActivityText(fields.command_phase, "");
  const activity = normalizeActivityText(
    fields.activity_status || fields.native_rail_state || fields.status,
    "",
  );
  const status = normalizeActivityText(fields.status || fields.status_after, "");
  const readiness = normalizeActivityText(fields.readiness || fields.readiness_after, "");
  const turn = normalizeActivityText(fields.turn_status, "");
  const lifecycle = normalizeActivityText(fields.terminal_lifecycle, "");

  if (lifecycle === "offline" || activity === "offline" || status === "offline") return "offline";
  if (lifecycle === "exited" || activity === "exited" || status === "exited") return "exited";
  if (["closed", "closing", "terminated"].includes(lifecycle) || ["closed", "closing", "terminated"].includes(status)) {
    return lifecycle === "closing" || status === "closing" ? "closing" : "closed";
  }
  if (
    eventType === "provider_turn_compacting"
      || eventType === "context_compaction_started"
      || commandPhase === "compacting"
      || commandPhase === "compaction"
      || activity === "compacting"
      || activity === "compaction"
      || turn === "compacting"
      || turn === "compaction"
  ) {
    return "compacting";
  }
  if (eventType === "provider_turn_interrupted" || turn === "interrupted") return "interrupted";
  if (turn === "cancelled" || turn === "canceled" || commandPhase === "cancelled" || commandPhase === "canceled") return "cancelled";
  if (eventType === "provider_turn_error" || eventType === "pending_prompt_error" || turn === "failed" || turn === "error") return "failed";
  if (TERMINAL_ACTIVITY_ERROR_STATES.has(activity) || readiness === "error" || status === "error") return "failed";
  if (
    TERMINAL_ACTIVITY_ATTENTION_STATES.has(activity)
      || TERMINAL_ACTIVITY_ATTENTION_STATES.has(commandPhase)
      || TERMINAL_ACTIVITY_ATTENTION_STATES.has(status)
  ) return "awaiting_input";
  if (
    TERMINAL_ACTIVITY_PAUSED_STATES.has(activity)
      || TERMINAL_ACTIVITY_PAUSED_STATES.has(commandPhase)
      || TERMINAL_ACTIVITY_PAUSED_STATES.has(status)
  ) return "paused";
  if (TERMINAL_ACTIVITY_ATTENTION_STATES.has(readiness)) return "awaiting_input";
  if (TERMINAL_ACTIVITY_PAUSED_STATES.has(readiness)) return "paused";
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
  if (TERMINAL_ACTIVITY_ATTENTION_STATES.has(phase)) return "awaiting_input";
  if (
    phase === "paused"
      || phase === "parked"
      || phase === "resume_ready"
  ) return "paused";
  if (phase === "compacting" || phase === "compaction") return "compacting";
  if (["queued", "submitted", "input_written", "accepted", "running", "cancelling"].includes(phase)) return "thinking";
  if (["cancelled", "canceled", "interrupted"].includes(phase)) return "interrupted";
  if (["completed", "complete", "done", "idle"].includes(phase)) return "idle";
  return terminalRailStateFromActivityStatus("", fallback);
}

export function terminalRailBadgePresentation(railState, fallback = "idle") {
  const rawState = normalizeActivityText(railState, normalizeActivityText(fallback, "idle"));
  const state = TERMINAL_ACTIVITY_ATTENTION_STATES.has(rawState)
    ? "awaiting_input"
    : rawState;
  if (state === "awaiting_input") {
    return {
      label: "Input required",
      state,
      tone: "attention",
    };
  }
  return {
    label: state.replace(/[_-]+/g, " "),
    state,
    tone: "neutral",
  };
}

export function shouldSuppressThreadPropThinking({
  latest_turn: latestTurn = null,
  lastReadyAtMs = 0,
  nextStatus = "",
  previousStatus = "",
  source = "",
  submittedPrompt = null,
  thread_id: threadId = "",
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
  const submittedPromptThread = String(submittedPrompt?.thread_id || "").trim();
  if (submittedPrompt && (!safeThreadId || submittedPromptThread === safeThreadId)) {
    return false;
  }
  const latestTurnState = String(latestTurn?.state || latestTurn?.status || "").trim().toLowerCase();
  const turnStartedAtMs = parseTerminalStateTimestampMs(
    latestTurn?.started_at
      || latestTurn?.requested_at
      || latestTurn?.created_at
      || latestTurn?.updated_at
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

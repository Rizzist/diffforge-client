export const WORKSPACE_NOTIFICATION_EVENT = "diffforge:workspace-notification-event";
export const TERMINAL_PARKED_PROMPT_EVENT = "forge-terminal-parked-prompt";
export const TODO_COMPLETED_NOTIFICATION_EVENT = "diffforge:todo-completed-notification";

const WORKSPACE_NOTIFICATION_STORAGE_KEY = "diffforge.workspaceNotifications.v1";
const WORKSPACE_NOTIFICATION_VERSION = 1;
const MAX_NOTIFICATIONS_PER_WORKSPACE = 80;
const MAX_CUES = 24;
const APPROVAL_CUE_COOLDOWN_MS = 5000;
const ALL_DONE_CUE_COOLDOWN_MS = 1200;
const NOTIFICATION_CUE_COOLDOWN_MS = 800;
const TERMINAL_READY_NOTIFICATION_KIND = "terminal.ready";
let lastPersistedWorkspaceNotificationsPayload = "";
// One physical completion arrives twice: the lifecycle reducer's generic
// terminal.ready and TerminalView's richer todo.completed both describe the
// same finishing terminal, in racy order. Within this window the pair is
// collapsed so the workspace badge counts one, not two.
const TERMINAL_READY_TODO_SUPPRESSION_WINDOW_MS = 15_000;

const ACTIVE_LIFECYCLE_TYPES = new Set([
  "agent-output",
  "message-submitted",
  "provider-turn-started",
  "thread-starting",
]);

const COMPLETION_LIFECYCLE_TYPES = new Set([
  "closed",
  "error",
  "exited",
  "pending-prompt-error",
  "provider-turn-completed",
  "provider-turn-error",
]);

// Only real provider turn ends may mint "terminal ready" attention. A closed/
// exited/errored terminal still clears its active-turn accounting (the set
// above), but a dead terminal is not "ready" — treating lifecycle death as
// completion rang ready cues for crashes and plain window closes.
const TURN_END_COMPLETION_TYPES = new Set([
  "pending-prompt-error",
  "provider-turn-completed",
  "provider-turn-error",
]);

const ALL_DONE_COMPLETION_TYPES = new Set([
  "provider-turn-completed",
]);

const PENDING_APPROVAL_STATUSES = new Set([
  "pending",
  "requested",
  "review_requested",
  "approval_required",
]);

const RESOLVED_APPROVAL_STATUSES = new Set([
  "approved",
  "denied",
  "rejected",
  "resolved",
]);

const MANUAL_ACCEPTANCE_NOTIFICATION_KINDS = new Set([
  "approval.required",
]);

const MANUAL_ACCEPTANCE_ACTIONABILITIES = new Set([
  "approve_deny",
]);

const MANUAL_ACCEPTANCE_PROMPT_KINDS = new Set([
  "approval",
  "permission",
]);
const HOOK_MANUAL_PROMPT_TYPES = new Set([
  "provider-manual-approval-required",
  "provider-user-input-required",
  "provider-user-prompt-started",
]);
const HOOK_MANUAL_PROMPT_SOURCE_PARTS = [
  "cli-hook:manual-prompt",
  "cli-hook:provider-user-input-required",
  "cli-hook:provider-user-prompt-started",
  "hook-manual-prompt",
  "manual-prompt-hook",
  "provider-hook:manual-prompt",
];
const RESOLVED_MANUAL_PROMPT_DECISIONS = new Set([
  "allow",
  "allowed",
  "approve",
  "approved",
  "auto",
  "auto-allow",
  "auto-allowed",
  "auto-approve",
  "auto-approved",
  "auto-denied",
  "auto-deny",
  "autoallow",
  "autoallowed",
  "autoapprove",
  "autoapproved",
  "autodenied",
  "autodeny",
  "deny",
  "denied",
  "reject",
  "rejected",
  "resolved",
]);

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function parseTimestampMs(value) {
  const text = cleanText(value);
  if (!text) return 0;
  const numeric = Number.parseFloat(text);
  if (Number.isFinite(numeric) && numeric > 1_000_000_000) {
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeCount(value) {
  const numeric = Number.parseInt(value, 10);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function workspaceNotificationSeenOnArrival(workspaceId, options = {}) {
  if (
    Object.prototype.hasOwnProperty.call(options, "workspaceVisibleAndFocused")
    || Object.prototype.hasOwnProperty.call(options, "workspaceObserved")
    || Object.prototype.hasOwnProperty.call(options, "terminalSurfaceVisible")
  ) {
    return Boolean(
      options.workspaceVisibleAndFocused
        || options.workspaceObserved
        || options.terminalSurfaceVisible,
    );
  }
  return cleanText(options.selected_workspace_id) === cleanText(workspaceId);
}

function normalizeNotificationStatus(value, fallback = "unread") {
  const status = cleanText(value, fallback).toLowerCase();
  return ["dismissed", "read", "resolved", "unread"].includes(status) ? status : fallback;
}

function normalizeNotificationKind(value) {
  const kind = cleanText(value, "coordination.event").toLowerCase();
  return kind.replace(/_/g, ".");
}

function normalizePromptingUserKind(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function normalizePromptingUserSource(value) {
  return cleanText(value)
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
      && HOOK_MANUAL_PROMPT_SOURCE_PARTS.some((part) => normalized.includes(part))
      && !normalized.includes("terminal-output")
  );
}

function lifecycleEventType(event = {}) {
  return cleanText(event?.type || event?.event_type)
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function hookManualPromptSourceLooksOwned(source) {
  const normalized = normalizePromptingUserSource(source);
  return Boolean(
    normalized === "hook"
      || normalized === "cli-hook"
      || HOOK_MANUAL_PROMPT_SOURCE_PARTS.some((part) => normalized.includes(part))
  );
}

function lifecycleEventHasHookManualPromptSource(event = {}) {
  return [
    event?.manual_prompt_source,
    event?.prompting_user_source,
    event?.prompting_source,
    event?.source,
  ].some(hookManualPromptSourceLooksOwned);
}

function lifecycleEventHasResolvedManualPromptDecision(event = {}) {
  return [
    event?.permission_decision,
    event?.decision,
    event?.approval_decision,
    event?.permission_status,
    event?.approval_status,
  ].some((value) => RESOLVED_MANUAL_PROMPT_DECISIONS.has(normalizePromptingUserSource(value)));
}

function lifecycleEventIsHookManualPrompt(event = {}) {
  const type = lifecycleEventType(event);
  const hasHookSource = lifecycleEventHasHookManualPromptSource(event);
  if (!hasHookSource) {
    return false;
  }
  if (lifecycleEventHasResolvedManualPromptDecision(event)) {
    return false;
  }

  const hookManualPromptType = HOOK_MANUAL_PROMPT_TYPES.has(type);
  const active = hookManualPromptType || event?.manual_approval_required === true || event?.provider_blocked_for_user === true || event?.terminal_is_prompting_user === true || event?.prompting_user === true || event?.requires_user_input === true;
  if (!active) {
    return false;
  }

  const kind = normalizePromptingUserKind(
    event?.prompting_user_kind || event?.prompting_kind,
  );
  return Boolean(
    hookManualPromptType || MANUAL_ACCEPTANCE_PROMPT_KINDS.has(kind) || event?.manual_approval_required === true || event?.requires_user_input === true || event?.provider_blocked_for_user === true
  );
}

function notificationLooksExplicitPermissionPrompt(notification = {}) {
  const sourceNotification = notification && typeof notification === "object" ? notification : {};
  const kind = normalizePromptingUserKind(
    sourceNotification.prompting_user_kind,
  );
  const source = sourceNotification.prompting_user_source || sourceNotification.manual_prompt_source || sourceNotification.source;
  return Boolean(
    hookManualPromptSourceLooksOwned(source)
      && MANUAL_ACCEPTANCE_PROMPT_KINDS.has(kind)
      && (promptingPermissionToken(sourceNotification) || promptingSourceLooksExplicitPermission(source))
  );
}

function normalizeNotification(notification, workspaceId) {
  if (!notification || typeof notification !== "object" || Array.isArray(notification)) {
    return null;
  }

  const id = cleanText(notification.id);
  if (!id) return null;

  const kind = normalizeNotificationKind(notification.kind);
  const status = normalizeNotificationStatus(notification.status);
  const createdAt = cleanText(notification.created_at, nowIso());
  const updatedAt = cleanText(notification.updated_at, createdAt);

  return {
    actionability: cleanText(notification.actionability, "open_thread"),
    agent_id: cleanText(notification.agent_id),
    approval_id: cleanText(notification.approval_id),
    body: cleanText(notification.body),
    created_at: createdAt,
    db_change_request_id: cleanText(notification.db_change_request_id),
    dedupe_key: cleanText(notification.dedupe_key, id),
    id,
    kind,
    pane_id: cleanText(notification.pane_id),
    pending_action: Boolean(notification.pending_action),
    prompting_user_confidence: cleanText(notification.prompting_user_confidence),
    prompting_user_kind: normalizePromptingUserKind(notification.prompting_user_kind),
    prompting_user_source: cleanText(notification.prompting_user_source),
    seen_at: cleanText(notification.seen_at),
    session_id: cleanText(notification.session_id),
    severity: cleanText(notification.severity, "info"),
    source_event_id: cleanText(notification.source_event_id),
    source_seq: notification.source_seq ?? notification.seq ?? null,
    status,
    task_id: cleanText(notification.task_id),
    terminal_index: notification.terminal_index ?? null,
    thread_id: cleanText(notification.thread_id),
    title: cleanText(notification.title, notificationTitleForKind(kind)),
    updated_at: updatedAt,
    workspace_id: cleanText(notification.workspace_id, workspaceId),
  };
}

function normalizeActiveTurn(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = cleanText(value.id);
  if (!id) return null;
  return {
    agent_id: cleanText(value.agent_id),
    id,
    last_active_at: cleanText(value.last_active_at, nowIso()),
    native_session_id: cleanText(value.native_session_id),
    pane_id: cleanText(value.pane_id),
    prompt_id: cleanText(value.prompt_id),
    provider_session_id: cleanText(value.provider_session_id),
    terminal_index: value.terminal_index ?? null,
    thread_id: cleanText(value.thread_id),
    turn_id: cleanText(value.turn_id),
    workspace_id: cleanText(value.workspace_id),
  };
}

function normalizeWorkspaceBucket(bucket, workspaceId) {
  const source = bucket && typeof bucket === "object" && !Array.isArray(bucket) ? bucket : {};
  const notifications = Object.fromEntries(
    Object.entries(source.notifications || {})
      .map(([, notification]) => normalizeNotification(notification, workspaceId))
      .filter(Boolean)
      .sort((left, right) => parseTimestampMs(right.created_at) - parseTimestampMs(left.created_at))
      .slice(0, MAX_NOTIFICATIONS_PER_WORKSPACE)
      .map((notification) => [notification.id, notification]),
  );
  const activeTurns = Object.fromEntries(
    Object.entries(source.activeTurns || {})
      .map(([, turn]) => normalizeActiveTurn(turn))
      .filter(Boolean)
      .map((turn) => [turn.id, turn]),
  );

  return {
    activeTurns,
    lastCueAt: {
      allDone: safeCount(source.lastCueAt?.allDone),
      approval: safeCount(source.lastCueAt?.approval),
      notification: safeCount(source.lastCueAt?.notification),
    },
    last_seen_at: cleanText(source.last_seen_at),
    notifications,
  };
}

export function normalizeWorkspaceNotificationState(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const workspaces = Object.fromEntries(
    Object.entries(source.workspaces || {})
      .map(([workspaceId, bucket]) => {
        const safeWorkspaceId = cleanText(workspaceId);
        return safeWorkspaceId
          ? [safeWorkspaceId, normalizeWorkspaceBucket(bucket, safeWorkspaceId)]
          : null;
      })
      .filter(Boolean),
  );

  return {
    cues: Array.isArray(source.cues) ? source.cues.slice(-MAX_CUES) : [],
    version: WORKSPACE_NOTIFICATION_VERSION,
    workspaces,
  };
}

const WORKSPACE_NOTIFICATION_PERSISTED_TO_RUNTIME_KEYS = Object.freeze({
  agentId: "agent_id",
  approvalId: "approval_id",
  createdAt: "created_at",
  dbChangeRequestId: "db_change_request_id",
  dedupeKey: "dedupe_key",
  lastActiveAt: "last_active_at",
  lastSeenAt: "last_seen_at",
  nativeSessionId: "native_session_id",
  paneId: "pane_id",
  pendingAction: "pending_action",
  promptingUserConfidence: "prompting_user_confidence",
  promptingUserKind: "prompting_user_kind",
  promptingUserSource: "prompting_user_source",
  promptId: "prompt_id",
  providerSessionId: "provider_session_id",
  seenAt: "seen_at",
  sessionId: "session_id",
  sourceEventId: "source_event_id",
  sourceSeq: "source_seq",
  taskId: "task_id",
  terminalIndex: "terminal_index",
  threadId: "thread_id",
  turnId: "turn_id",
  updatedAt: "updated_at",
  workspaceId: "workspace_id",
});

const WORKSPACE_NOTIFICATION_RUNTIME_TO_PERSISTED_KEYS = Object.freeze(
  Object.fromEntries(
    Object.entries(WORKSPACE_NOTIFICATION_PERSISTED_TO_RUNTIME_KEYS)
      .map(([persisted, runtime]) => [runtime, persisted]),
  ),
);

function mapWorkspaceNotificationPersistedKeys(value, keyMap) {
  if (Array.isArray(value)) {
    return value.map((item) => mapWorkspaceNotificationPersistedKeys(item, keyMap));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      keyMap[key] || key,
      mapWorkspaceNotificationPersistedKeys(item, keyMap),
    ]),
  );
}

export function readWorkspaceNotifications() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return normalizeWorkspaceNotificationState(null);
    }
    return normalizeWorkspaceNotificationState(
      mapWorkspaceNotificationPersistedKeys(
        JSON.parse(window.localStorage.getItem(WORKSPACE_NOTIFICATION_STORAGE_KEY) || "{}"),
        WORKSPACE_NOTIFICATION_PERSISTED_TO_RUNTIME_KEYS,
      ),
    );
  } catch {
    return normalizeWorkspaceNotificationState(null);
  }
}

export function persistWorkspaceNotifications(state) {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    const normalized = normalizeWorkspaceNotificationState(state);
    const workspaces = Object.fromEntries(
      Object.entries(normalized.workspaces).map(([workspaceId, bucket]) => [
        workspaceId,
        {
          lastCueAt: bucket.lastCueAt,
          last_seen_at: bucket.last_seen_at,
          notifications: bucket.notifications,
        },
      ]),
    );
    const serialized = JSON.stringify(mapWorkspaceNotificationPersistedKeys({
      version: WORKSPACE_NOTIFICATION_VERSION,
      workspaces,
    }, WORKSPACE_NOTIFICATION_RUNTIME_TO_PERSISTED_KEYS));
    if (serialized === lastPersistedWorkspaceNotificationsPayload) {
      return;
    }
    window.localStorage.setItem(WORKSPACE_NOTIFICATION_STORAGE_KEY, serialized);
    lastPersistedWorkspaceNotificationsPayload = serialized;
  } catch {
    // Notifications are convenience state; live coordination events and snapshots rebuild essentials.
  }
}

function notificationTitleForKind(kind) {
  switch (kind) {
    case "agent.failed":
      return "Agent needs attention";
    case "all.done":
      return "Agents finished";
    case "terminal.ready":
      return "Terminal ready";
    case "approval.required":
      return "Approval required";
    case "approval.resolved":
      return "Approval resolved";
    case "task.parked":
      return "Task parked";
    case "todo.completed":
      return "Todo completed";
    case "turn.completed":
      return "Turn finished";
    case "task.resume.ready":
    case "task.resume_ready":
      return "Task ready to resume";
    case "user.input.required":
      return "User input needed";
    case "tool.failed":
      return "Tool failed";
    default:
      return "Workspace update";
  }
}

export function normalizeWorkspaceNotificationPath(value) {
  return cleanText(value)
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

export function resolveWorkspaceIdForNotificationEvent(event, workspaceRoots = []) {
  const explicitWorkspaceId = cleanText(event?.workspace_id);
  if (explicitWorkspaceId) return explicitWorkspaceId;

  const eventPath = normalizeWorkspaceNotificationPath(
    event?.repo_path || event?.payload?.repo_path,
  );
  if (!eventPath) return "";

  return workspaceRoots.find((entry) => (
    normalizeWorkspaceNotificationPath(entry?.root_directory) === eventPath
  ))?.workspace_id || "";
}

function getWorkspaceBucket(state, workspaceId) {
  const normalized = normalizeWorkspaceNotificationState(state);
  const bucket = normalized.workspaces[workspaceId] || normalizeWorkspaceBucket(null, workspaceId);
  return { bucket, state: normalized };
}

function setWorkspaceBucket(state, workspaceId, bucket) {
  return {
    ...state,
    workspaces: {
      ...state.workspaces,
      [workspaceId]: normalizeWorkspaceBucket(bucket, workspaceId),
    },
  };
}

function appendCue(state, bucket, workspaceId, kind, options = {}, source = {}) {
  if (options.suppressCue) {
    return { bucket, state };
  }

  const nowMs = Date.now();
  const cueKey = kind === "all.done"
    ? "allDone"
    : kind === "approval.required"
      ? "approval"
      : "notification";
  const cooldownMs = kind === "all.done"
    ? ALL_DONE_CUE_COOLDOWN_MS
    : kind === "approval.required"
      ? APPROVAL_CUE_COOLDOWN_MS
      : NOTIFICATION_CUE_COOLDOWN_MS;
  const lastCueAt = safeCount(bucket.lastCueAt?.[cueKey]);
  if (lastCueAt && nowMs - lastCueAt < cooldownMs) {
    return { bucket, state };
  }

  const sourceTerminalIndex = Number(source.terminal_index);
  return {
    bucket: {
      ...bucket,
      lastCueAt: {
        ...bucket.lastCueAt,
        [cueKey]: nowMs,
      },
    },
    state: {
      ...state,
      cues: [
        ...(Array.isArray(state.cues) ? state.cues : []),
        {
          created_at: new Date(nowMs).toISOString(),
          id: `${kind}:${workspaceId}:${nowMs}:${Math.random().toString(16).slice(2)}`,
          kind,
          // Causer attribution: which terminal produced this cue, so cue
          // consumers can reason about the source, not just the workspace.
          pane_id: cleanText(source.pane_id),
          terminal_index: Number.isInteger(sourceTerminalIndex) ? sourceTerminalIndex : null,
          workspace_id: workspaceId,
        },
      ].slice(-MAX_CUES),
    },
  };
}

function shouldCueNotification(notification, existing, options = {}) {
  if (options.suppressCue || !notification) {
    return false;
  }
  if (!notificationRequiresManualAcceptance(notification)) {
    return false;
  }
  if (["dismissed", "resolved"].includes(notification.status)) {
    return false;
  }
  if (notification.status === "read") {
    return false;
  }
  if (existing && !["dismissed", "resolved"].includes(existing.status)) {
    return false;
  }
  return true;
}

function notificationRequiresManualAcceptance(notification) {
  if (!notification?.pending_action) {
    return false;
  }
  const kind = normalizeNotificationKind(notification.kind);
  const actionability = cleanText(notification.actionability).toLowerCase();
  if (
    MANUAL_ACCEPTANCE_NOTIFICATION_KINDS.has(kind)
    || MANUAL_ACCEPTANCE_ACTIONABILITIES.has(actionability)
  ) {
    return true;
  }
  if (kind !== "user.input.required") {
    return false;
  }
  const promptingKind = normalizePromptingUserKind(
    notification.prompting_user_kind,
  );
  return MANUAL_ACCEPTANCE_PROMPT_KINDS.has(promptingKind)
    && notificationLooksExplicitPermissionPrompt(notification);
}

function appendNotificationCue(state, bucket, workspaceId, notification, existing, options = {}) {
  if (!shouldCueNotification(notification, existing, options)) {
    return { bucket, state };
  }
  return appendCue(state, bucket, workspaceId, notification.kind || "workspace.notification", options, {
    pane_id: notification.pane_id,
    terminal_index: notification.terminal_index,
  });
}

function eventRefs(event) {
  const refs = event?.refs && typeof event.refs === "object" ? event.refs : {};
  return {
    agent_id: cleanText(refs.agent_id || event?.agent_id),
    artifact_id: cleanText(refs.artifact_id),
    context_run_id: cleanText(refs.context_run_id),
    resource_id: cleanText(refs.resource_id),
    session_id: cleanText(refs.session_id || event?.session_id),
    task_id: cleanText(refs.task_id || event?.task_id),
  };
}

function eventPayload(event) {
  return event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload
    : {};
}

function eventType(event) {
  return cleanText(event?.event_type).toLowerCase();
}

function eventKind(event) {
  const explicitKind = normalizeNotificationKind(event?.kind);
  if (explicitKind && explicitKind !== "coordination.event") {
    return explicitKind;
  }
  switch (eventType(event)) {
    case "approval_requested":
    case "approval_request_reused":
    case "db_change_approval_required":
      return "approval.required";
    case "approval_granted":
    case "approval_denied":
    case "db_change_approved":
    case "db_change_rejected":
      return "approval.resolved";
    case "active_file_lease_queue_waiter_released":
      return "task.resume_ready";
    case "task_parked_for_resource_queue":
      return "task.parked";
    case "mcp_agent_tool_failed":
      return "tool.failed";
    case "merge_succeeded":
      return "task.completed";
    default:
      return explicitKind;
  }
}

function approvalIdFromEvent(event) {
  const payload = eventPayload(event);
  return cleanText(payload.approval_id || event?.approval_id);
}

function dbChangeRequestIdFromEvent(event) {
  const payload = eventPayload(event);
  return cleanText(
    payload.db_change_request_id || event?.db_change_request_id,
  );
}

function notificationIdForCoordinationEvent(kind, event) {
  const refs = eventRefs(event);
  const approvalId = approvalIdFromEvent(event);
  const dbChangeRequestId = dbChangeRequestIdFromEvent(event);
  const type = eventType(event);
  const sourceEventId = cleanText(event?.source_event_id || event?.event_id || event?.id);
  if (type.startsWith("db_change_") && dbChangeRequestId) {
    return `db-change:${dbChangeRequestId}`;
  }
  if (kind === "approval.required" || kind === "approval.resolved") {
    if (approvalId) return `approval:${approvalId}`;
    if (dbChangeRequestId) return `db-change:${dbChangeRequestId}`;
  }
  if (kind === "task.parked" || kind === "task.resume_ready" || kind === "task.resume.ready") {
    if (refs.task_id) return `task-wait:${refs.task_id}`;
  }
  if (kind === "tool.failed" && refs.task_id) {
    return `tool-failed:${refs.task_id}:${sourceEventId || Date.now()}`;
  }
  return `${kind}:${sourceEventId || refs.task_id || Date.now()}`;
}

function pendingActionForKind(kind) {
  return kind === "approval.required" || kind === "task.resume_ready" || kind === "task.resume.ready";
}

function buildCoordinationNotification(event, workspaceId, existing, options = {}) {
  const refs = eventRefs(event);
  const payload = eventPayload(event);
  const kind = eventKind(event);
  const sourceEventId = cleanText(event?.source_event_id || event?.event_id || event?.id);
  const createdAt = cleanText(event?.created_at, nowIso());
  const seenOnArrival = workspaceNotificationSeenOnArrival(workspaceId, options);
  const passiveStatus = seenOnArrival ? "read" : "unread";
  const pendingAction = pendingActionForKind(kind);
  const status = kind === "approval.resolved"
    ? "resolved"
    : pendingAction
      ? (existing?.status === "read" || seenOnArrival ? "read" : "unread")
      : passiveStatus;

  return {
    actionability: cleanText(event?.actionability, pendingAction ? "approve_deny" : "open_thread"),
    agent_id: refs.agent_id,
    approval_id: approvalIdFromEvent(event) || existing?.approval_id || "",
    body: cleanText(
      payload.reason
        || payload.risk_summary
        || payload.status
        || existing?.body,
    ),
    created_at: existing?.created_at || createdAt,
    db_change_request_id: dbChangeRequestIdFromEvent(event) || existing?.db_change_request_id || "",
    dedupe_key: notificationIdForCoordinationEvent(kind, event),
    id: notificationIdForCoordinationEvent(kind, event),
    kind: kind === "approval.resolved" ? existing?.kind || "approval.required" : kind,
    pending_action: kind === "approval.resolved" ? false : pendingAction,
    seen_at: kind === "approval.resolved" ? cleanText(event?.created_at, nowIso()) : existing?.seen_at || "",
    session_id: refs.session_id,
    severity: cleanText(event?.severity, pendingAction ? "action_required" : "info"),
    source_event_id: sourceEventId,
    source_seq: event?.source_seq ?? event?.seq ?? existing?.source_seq ?? null,
    status,
    task_id: refs.task_id,
    terminal_index: event?.terminal_index ?? existing?.terminal_index ?? null,
    title: notificationTitleForKind(kind),
    updated_at: cleanText(event?.created_at, nowIso()),
    workspace_id: workspaceId,
  };
}

export function reduceWorkspaceNotificationEvent(state, rawEvent, options = {}) {
  const workspaceId = cleanText(rawEvent?.workspace_id || options.workspace_id);
  if (!workspaceId) {
    return normalizeWorkspaceNotificationState(state);
  }

  const { bucket, state: currentState } = getWorkspaceBucket(state, workspaceId);
  const kind = eventKind(rawEvent);
  const id = notificationIdForCoordinationEvent(kind, rawEvent);
  const existing = bucket.notifications[id] || null;
  const notification = buildCoordinationNotification(rawEvent, workspaceId, existing, options);
  let nextBucket = {
    ...bucket,
    notifications: {
      ...bucket.notifications,
      [notification.id]: notification,
    },
  };
  let nextState = setWorkspaceBucket(currentState, workspaceId, nextBucket);
  const cueResult = appendNotificationCue(nextState, nextBucket, workspaceId, notification, existing, options);
  nextBucket = cueResult.bucket;
  nextState = setWorkspaceBucket(cueResult.state, workspaceId, nextBucket);

  return trimWorkspaceNotifications(nextState, workspaceId);
}

function trimWorkspaceNotifications(state, workspaceId) {
  const bucket = state.workspaces[workspaceId];
  if (!bucket) return state;

  const notifications = Object.fromEntries(
    Object.values(bucket.notifications)
      .sort((left, right) => parseTimestampMs(right.created_at) - parseTimestampMs(left.created_at))
      .slice(0, MAX_NOTIFICATIONS_PER_WORKSPACE)
      .map((notification) => [notification.id, notification]),
  );

  return setWorkspaceBucket(state, workspaceId, {
    ...bucket,
    notifications,
  });
}

function lifecycleActiveKey(event, workspaceId) {
  const threadId = cleanText(event?.thread_id);
  const terminalIndex = event?.terminal_index ?? "";
  const paneId = cleanText(event?.pane_id);
  const agentId = cleanText(event?.agent_id || event?.current_agent, "agent");
  const turnId = cleanText(
    event?.turn_id || event?.prompt_event_id || event?.pending_prompt_id || event?.prompt_id || event?.native_session_id || event?.provider_session_id,
  );
  const targetId = threadId || paneId || (terminalIndex !== "" ? `terminal-${terminalIndex}` : "");
  if (!targetId) return "";
  return `turn:${workspaceId}:${targetId}:${agentId}:${turnId || "active"}`;
}

function activeTurnFromLifecycle(event, workspaceId) {
  const id = lifecycleActiveKey(event, workspaceId);
  if (!id) return null;
  return {
    agent_id: cleanText(event?.agent_id || event?.current_agent),
    id,
    last_active_at: cleanText(event?.updated_at || event?.created_at, nowIso()),
    native_session_id: cleanText(event?.native_session_id),
    pane_id: cleanText(event?.pane_id),
    prompt_id: cleanText(event?.prompt_event_id || event?.pending_prompt_id || event?.prompt_id),
    provider_session_id: cleanText(event?.provider_session_id),
    terminal_index: event?.terminal_index ?? null,
    thread_id: cleanText(event?.thread_id),
    turn_id: cleanText(event?.turn_id),
    workspace_id: workspaceId,
  };
}

function activeTurnMatchesLifecycle(turn, event) {
  const threadId = cleanText(event?.thread_id);
  const paneId = cleanText(event?.pane_id);
  const terminalIndex = event?.terminal_index ?? null;
  const agentId = cleanText(event?.agent_id || event?.current_agent);

  if (agentId && turn.agent_id && agentId !== turn.agent_id) {
    return false;
  }
  if (threadId && turn.thread_id) {
    return threadId === turn.thread_id;
  }
  if (paneId && turn.pane_id) {
    return paneId === turn.pane_id;
  }
  if (terminalIndex != null && turn.terminal_index != null) {
    return String(terminalIndex) === String(turn.terminal_index);
  }
  return Boolean(threadId || paneId || terminalIndex != null);
}

function lifecycleTerminalWorkState(event) {
  return cleanText(event?.terminal_work_state).toLowerCase();
}

function lifecycleTerminalIsComplete(event) {
  const state = lifecycleTerminalWorkState(event);
  return event?.terminal_is_complete === true || state === "complete" || state === "completed";
}

function lifecycleTerminalIsPromptingUser(event) {
  return lifecycleEventIsHookManualPrompt(event);
}

function lifecycleResolvesPromptingNotification(event) {
  const type = cleanText(event?.type).toLowerCase();
  const state = lifecycleTerminalWorkState(event);
  return [
    "closed",
    "error",
    "exited",
    "message-submitted",
    "pending-prompt-sent",
    "provider-turn-completed",
    "provider-turn-error",
    "provider-turn-interrupted",
    "provider-turn-started",
    "thread-starting",
  ].includes(type) || event?.terminal_is_prompting_user === false || event?.prompting_user === false || event?.requires_user_input === false || ["complete", "completed", "error", "parked", "running"].includes(state);
}

function promptingNotificationId(event, workspaceId) {
  const threadId = cleanText(event?.thread_id);
  const paneId = cleanText(event?.pane_id);
  const terminalIndex = event?.terminal_index ?? "";
  const agentId = cleanText(event?.agent_id || event?.current_agent, "agent");
  const turnId = cleanText(
    event?.turn_id || event?.prompt_event_id || event?.pending_prompt_id || event?.prompt_id,
  );
  const targetId = threadId || paneId || (terminalIndex !== "" ? `terminal-${terminalIndex}` : "workspace");
  return `user-input:${workspaceId}:${targetId}:${agentId}:${turnId || "active"}`;
}

function promptingNotificationBody(event) {
  return cleanText(
    event?.prompting_user_text
      || event?.prompting_text
      || event?.terminal_prompt
      || event?.terminal_text
      || event?.output_text
      || event?.text,
  ).slice(0, 280);
}

function buildPromptingNotification(event, workspaceId, existing, options = {}) {
  const createdAt = nowIso();
  const seenOnArrival = workspaceNotificationSeenOnArrival(workspaceId, options);
  const id = promptingNotificationId(event, workspaceId);
  const sourceText = event?.prompting_user_source || event?.prompting_source || event?.source || event?.type;
  const sourceEventId = promptingPermissionToken(event) || event?.source_event_id || existing?.source_event_id;
  return {
    actionability: "open_thread",
    agent_id: cleanText(event?.agent_id || event?.current_agent),
    approval_id: cleanText(event?.approval_id || existing?.approval_id),
    body: promptingNotificationBody(event) || existing?.body || "",
    created_at: existing?.created_at || createdAt,
    db_change_request_id: "",
    dedupe_key: id,
    id,
    kind: "user.input.required",
    pane_id: cleanText(event?.pane_id),
    pending_action: true,
    prompting_user_confidence: cleanText(event?.prompting_user_confidence),
    prompting_user_kind: normalizePromptingUserKind(event?.prompting_user_kind),
    prompting_user_source: cleanText(
      promptingSourceLooksExplicitPermission(sourceText)
        ? sourceText
        : sourceEventId
          ? "permission-token"
          : sourceText,
      "permission",
    ),
    seen_at: seenOnArrival ? createdAt : existing?.seen_at || "",
    session_id: cleanText(event?.native_session_id || event?.provider_session_id),
    severity: "action_required",
    source_event_id: cleanText(sourceEventId),
    source_seq: event?.source_seq ?? event?.seq ?? existing?.source_seq ?? null,
    status: (existing?.status === "read" || seenOnArrival) ? "read" : "unread",
    task_id: "",
    terminal_index: event?.terminal_index ?? existing?.terminal_index ?? null,
    thread_id: cleanText(event?.thread_id),
    title: notificationTitleForKind("user.input.required"),
    updated_at: createdAt,
    workspace_id: workspaceId,
  };
}

function resolvePromptingNotificationsForLifecycle(bucket, event) {
  if (!lifecycleResolvesPromptingNotification(event)) {
    return bucket;
  }

  let changed = false;
  const updatedAt = nowIso();
  const notifications = Object.fromEntries(
    Object.entries(bucket.notifications || {}).map(([id, notification]) => {
      if (
        notification.kind === "user.input.required"
        && !["dismissed", "resolved"].includes(notification.status)
        && activeTurnMatchesLifecycle(notification, event)
      ) {
        changed = true;
        return [id, {
          ...notification,
          pending_action: false,
          seen_at: notification.seen_at || updatedAt,
          status: "resolved",
          updated_at: updatedAt,
        }];
      }
      return [id, notification];
    }),
  );

  return changed ? { ...bucket, notifications } : bucket;
}

/// Whether two notifications point at the same terminal: pane identity wins,
/// then thread, then terminal index. Used to collapse the terminal.ready /
/// todo.completed pair a single completion produces.
function notificationTargetsSameTerminal(left, right) {
  const leftPane = cleanText(left?.pane_id);
  const rightPane = cleanText(right?.pane_id);
  if (leftPane && rightPane) return leftPane === rightPane;
  const leftThread = cleanText(left?.thread_id);
  const rightThread = cleanText(right?.thread_id);
  if (leftThread && rightThread) return leftThread === rightThread;
  if (left?.terminal_index != null && right?.terminal_index != null) {
    return String(left.terminal_index) === String(right.terminal_index);
  }
  return false;
}

function bucketHasFreshTodoCompletionForTarget(bucket, candidate) {
  const nowMs = Date.now();
  return Object.values(bucket.notifications || {}).some((notification) => (
    notification.kind === "todo.completed"
    && notification.status !== "dismissed"
    && notificationTargetsSameTerminal(notification, candidate)
    && nowMs - parseTimestampMs(notification.updated_at || notification.created_at)
      < TERMINAL_READY_TODO_SUPPRESSION_WINDOW_MS
  ));
}

function workspacePendingActionCount(bucket) {
  return Object.values(bucket.notifications || {}).filter((notification) => (
    notification.pending_action
    && !["dismissed", "resolved"].includes(notification.status)
  )).length;
}

function workspaceParkedCount(bucket) {
  return Object.values(bucket.notifications || {}).filter((notification) => (
    notification.kind === "task.parked"
    && !["dismissed", "resolved"].includes(notification.status)
  )).length;
}

function addAllDoneNotification(state, bucket, workspaceId, options = {}) {
  const createdAt = nowIso();
  const seenOnArrival = workspaceNotificationSeenOnArrival(workspaceId, options);
  const id = `all-done:${workspaceId}:${Date.now()}`;
  const notification = {
    actionability: "open_thread",
    agent_id: "",
    approval_id: "",
    body: "",
    created_at: createdAt,
    db_change_request_id: "",
    dedupe_key: id,
    id,
    kind: "all.done",
    pending_action: false,
    seen_at: seenOnArrival ? createdAt : "",
    session_id: "",
    severity: "success",
    source_event_id: "",
    source_seq: null,
    status: seenOnArrival ? "read" : "unread",
    task_id: "",
    terminal_index: null,
    title: notificationTitleForKind("all.done"),
    updated_at: createdAt,
    workspace_id: workspaceId,
  };
  let nextBucket = {
    ...bucket,
    notifications: {
      ...bucket.notifications,
      [id]: notification,
    },
  };
  const nextState = setWorkspaceBucket(state, workspaceId, nextBucket);
  const cueResult = appendNotificationCue(nextState, nextBucket, workspaceId, notification, null, options);
  nextBucket = cueResult.bucket;
  return trimWorkspaceNotifications(setWorkspaceBucket(cueResult.state, workspaceId, nextBucket), workspaceId);
}

function terminalReadyNotificationId(event, workspaceId) {
  const activeKey = lifecycleActiveKey(event, workspaceId);
  if (activeKey) {
    return `terminal-ready:${activeKey}`;
  }
  const paneId = cleanText(event?.pane_id);
  const terminalIndex = event?.terminal_index ?? "";
  const targetId = paneId || (terminalIndex !== "" ? `terminal-${terminalIndex}` : "workspace");
  const sourceEventId = cleanText(
    event?.source_event_id || event?.prompt_event_id || event?.pending_prompt_id || event?.prompt_id || event?.id,
  );
  return `terminal-ready:${workspaceId}:${targetId}:${sourceEventId || Date.now()}`;
}

function buildTerminalReadyNotification(event, workspaceId, existing, options = {}) {
  const createdAt = nowIso();
  const seenOnArrival = workspaceNotificationSeenOnArrival(workspaceId, options);
  const id = terminalReadyNotificationId(event, workspaceId);
  return {
    actionability: "open_thread",
    agent_id: cleanText(event?.agent_id || event?.current_agent),
    approval_id: "",
    body: "",
    created_at: existing?.created_at || createdAt,
    db_change_request_id: "",
    dedupe_key: id,
    id,
    kind: TERMINAL_READY_NOTIFICATION_KIND,
    pane_id: cleanText(event?.pane_id),
    pending_action: false,
    seen_at: seenOnArrival ? createdAt : existing?.seen_at || "",
    session_id: cleanText(event?.native_session_id || event?.provider_session_id),
    severity: "success",
    source_event_id: cleanText(event?.source_event_id),
    source_seq: event?.source_seq ?? event?.seq ?? existing?.source_seq ?? null,
    status: existing?.status === "read" || seenOnArrival ? "read" : "unread",
    task_id: "",
    terminal_index: event?.terminal_index ?? existing?.terminal_index ?? null,
    thread_id: cleanText(event?.thread_id),
    title: notificationTitleForKind(TERMINAL_READY_NOTIFICATION_KIND),
    updated_at: createdAt,
    workspace_id: workspaceId,
  };
}

function addTerminalReadyNotification(state, bucket, workspaceId, lifecycleEvent, options = {}) {
  const id = terminalReadyNotificationId(lifecycleEvent, workspaceId);
  const existing = bucket.notifications?.[id] || null;
  const notification = buildTerminalReadyNotification(lifecycleEvent, workspaceId, existing, options);
  // TerminalView already turned this completion into a todo.completed for the
  // same terminal: skip the generic ready ping so the badge counts one.
  if (bucketHasFreshTodoCompletionForTarget(bucket, notification)) {
    return state;
  }
  let nextBucket = {
    ...bucket,
    notifications: {
      ...bucket.notifications,
      [id]: notification,
    },
  };
  const nextState = setWorkspaceBucket(state, workspaceId, nextBucket);
  const cueResult = appendNotificationCue(
    nextState,
    nextBucket,
    workspaceId,
    notification,
    existing,
    options,
  );
  nextBucket = cueResult.bucket;
  return trimWorkspaceNotifications(setWorkspaceBucket(cueResult.state, workspaceId, nextBucket), workspaceId);
}

export function reduceThreadLifecycleNotificationEvent(state, lifecycleEvent, options = {}) {
  const workspaceId = cleanText(lifecycleEvent?.workspace_id || options.workspace_id);
  if (!workspaceId) {
    return normalizeWorkspaceNotificationState(state);
  }

  const type = cleanText(lifecycleEvent?.type).toLowerCase();
  if (!type) {
    return normalizeWorkspaceNotificationState(state);
  }

  const { bucket, state: currentState } = getWorkspaceBucket(state, workspaceId);
  const beforeActiveCount = Object.keys(bucket.activeTurns || {}).length;
  const terminalIsPromptingUser = lifecycleTerminalIsPromptingUser(lifecycleEvent);
  const terminalIsComplete = lifecycleTerminalIsComplete(lifecycleEvent);
  const shouldUseGroundTruthCompletion = terminalIsComplete && [
    "closed",
    "error",
    "exited",
    "provider-turn-completed",
    "provider-turn-error",
  ].includes(type);
  let nextBucket = resolvePromptingNotificationsForLifecycle(bucket, lifecycleEvent);
  let cueNotification = null;
  let cueExistingNotification = null;

  if (terminalIsPromptingUser) {
    const id = promptingNotificationId(lifecycleEvent, workspaceId);
    cueExistingNotification = nextBucket.notifications?.[id] || null;
    cueNotification = buildPromptingNotification(
      lifecycleEvent,
      workspaceId,
      cueExistingNotification,
      options,
    );
    nextBucket = {
      ...nextBucket,
      activeTurns: Object.fromEntries(
        Object.entries(nextBucket.activeTurns).filter(([, turn]) => (
          !activeTurnMatchesLifecycle(turn, lifecycleEvent)
        )),
      ),
      notifications: {
        ...nextBucket.notifications,
        [id]: cueNotification,
      },
    };
  } else if (type === "agent-output") {
    const activityStatus = cleanText(lifecycleEvent?.activity_status || lifecycleEvent?.status).toLowerCase();
    if (activityStatus && activityStatus !== "thinking" && activityStatus !== "running") {
      nextBucket = {
        ...nextBucket,
        activeTurns: Object.fromEntries(
          Object.entries(nextBucket.activeTurns).filter(([, turn]) => (
            !activeTurnMatchesLifecycle(turn, lifecycleEvent)
          )),
        ),
      };
    } else if (activityStatus === "thinking" || activityStatus === "running") {
      const activeTurn = activeTurnFromLifecycle(lifecycleEvent, workspaceId);
      if (activeTurn) {
        nextBucket = {
          ...nextBucket,
          activeTurns: {
            ...nextBucket.activeTurns,
            [activeTurn.id]: activeTurn,
          },
        };
      }
    }
  } else if (ACTIVE_LIFECYCLE_TYPES.has(type)) {
    const activeTurn = activeTurnFromLifecycle(lifecycleEvent, workspaceId);
    if (activeTurn) {
      nextBucket = {
        ...nextBucket,
        activeTurns: {
          ...nextBucket.activeTurns,
          [activeTurn.id]: activeTurn,
        },
      };
    }
  } else if (COMPLETION_LIFECYCLE_TYPES.has(type) || shouldUseGroundTruthCompletion) {
    nextBucket = {
      ...nextBucket,
      activeTurns: Object.fromEntries(
        Object.entries(nextBucket.activeTurns).filter(([, turn]) => (
          !activeTurnMatchesLifecycle(turn, lifecycleEvent)
        )),
      ),
    };
  }

  let nextState = setWorkspaceBucket(currentState, workspaceId, nextBucket);
  if (cueNotification) {
    const cueResult = appendNotificationCue(
      nextState,
      nextBucket,
      workspaceId,
      cueNotification,
      cueExistingNotification,
      options,
    );
    nextBucket = cueResult.bucket;
    nextState = setWorkspaceBucket(cueResult.state, workspaceId, nextBucket);
  }
  const afterActiveCount = Object.keys(nextBucket.activeTurns || {}).length;
  const terminalBecameReady = Boolean(
    beforeActiveCount > afterActiveCount
      && terminalIsComplete
      && (
        TURN_END_COMPLETION_TYPES.has(type)
        || shouldUseGroundTruthCompletion
      ),
  );
  if (terminalBecameReady) {
    nextState = addTerminalReadyNotification(nextState, nextBucket, workspaceId, lifecycleEvent, options);
    nextBucket = nextState.workspaces[workspaceId] || nextBucket;
  }
  if (
    !terminalBecameReady
    && beforeActiveCount > 0
    && afterActiveCount === 0
    && ALL_DONE_COMPLETION_TYPES.has(type)
    && workspacePendingActionCount(nextBucket) === 0
    && workspaceParkedCount(nextBucket) === 0
  ) {
    nextState = addAllDoneNotification(nextState, nextBucket, workspaceId, options);
  }

  if (type === "provider-turn-error" || type === "pending-prompt-error") {
    const createdAt = nowIso();
    const id = `agent-failed:${workspaceId}:${cleanText(lifecycleEvent.thread_id || lifecycleEvent.pane_id, Date.now())}`;
    const seenOnArrival = workspaceNotificationSeenOnArrival(workspaceId, options);
    const failedBucket = nextState.workspaces[workspaceId] || nextBucket;
    const existing = failedBucket.notifications?.[id] || null;
    const notification = {
      actionability: "open_thread",
      agent_id: cleanText(lifecycleEvent.agent_id || lifecycleEvent.current_agent),
      approval_id: "",
      body: cleanText(lifecycleEvent.error),
      created_at: createdAt,
      db_change_request_id: "",
      dedupe_key: id,
      id,
      kind: "agent.failed",
      pending_action: false,
      seen_at: seenOnArrival ? createdAt : "",
      session_id: cleanText(lifecycleEvent.native_session_id || lifecycleEvent.provider_session_id),
      severity: "warning",
      source_event_id: "",
      source_seq: null,
      status: seenOnArrival ? "read" : "unread",
      task_id: "",
      terminal_index: lifecycleEvent.terminal_index ?? null,
      title: notificationTitleForKind("agent.failed"),
      updated_at: createdAt,
      workspace_id: workspaceId,
    };
    nextState = trimWorkspaceNotifications(setWorkspaceBucket(nextState, workspaceId, {
      ...failedBucket,
      notifications: {
        ...failedBucket.notifications,
        [id]: notification,
      },
    }), workspaceId);
    const nextFailedBucket = nextState.workspaces[workspaceId] || failedBucket;
    const cueResult = appendNotificationCue(
      nextState,
      nextFailedBucket,
      workspaceId,
      notification,
      existing,
      options,
    );
    nextState = trimWorkspaceNotifications(
      setWorkspaceBucket(cueResult.state, workspaceId, cueResult.bucket),
      workspaceId,
    );
  }

  return nextState;
}

export function reduceTerminalParkedNotificationEvent(state, parkedEvent, options = {}) {
  const workspaceId = cleanText(parkedEvent?.workspace_id || options.workspace_id);
  const taskId = cleanText(parkedEvent?.task_id);
  if (!workspaceId || !taskId) {
    return normalizeWorkspaceNotificationState(state);
  }
  const { bucket, state: currentState } = getWorkspaceBucket(state, workspaceId);
  const status = cleanText(parkedEvent?.status).toLowerCase();
  const createdAt = nowIso();
  const id = `task-wait:${taskId}`;
  const existing = bucket.notifications[id] || null;
  const resolved = ["cancelled", "resumed", "terminal", "resolved"].includes(status);
  const seenOnArrival = workspaceNotificationSeenOnArrival(workspaceId, options);
  const notification = {
    actionability: resolved ? "open_thread" : "resume_task",
    agent_id: "",
    approval_id: "",
    body: cleanText(parkedEvent?.reason || parkedEvent?.waiting_on),
    created_at: existing?.created_at || createdAt,
    db_change_request_id: "",
    dedupe_key: id,
    id,
    kind: "task.parked",
    pending_action: false,
    seen_at: resolved ? createdAt : existing?.seen_at || "",
    session_id: "",
    severity: "warning",
    source_event_id: "",
    source_seq: null,
    status: resolved ? "resolved" : (existing?.status === "read" || seenOnArrival ? "read" : "unread"),
    task_id: taskId,
    terminal_index: null,
    title: cleanText(parkedEvent?.title, notificationTitleForKind("task.parked")),
    updated_at: createdAt,
    workspace_id: workspaceId,
  };
  const nextBucket = {
    ...bucket,
    notifications: {
      ...bucket.notifications,
      [id]: notification,
    },
  };
  const nextState = setWorkspaceBucket(currentState, workspaceId, nextBucket);
  const cueResult = appendNotificationCue(
    nextState,
    nextBucket,
    workspaceId,
    notification,
    existing,
    options,
  );
  return trimWorkspaceNotifications(setWorkspaceBucket(cueResult.state, workspaceId, cueResult.bucket), workspaceId);
}

export function reduceTodoCompletedNotificationEvent(state, completionEvent, options = {}) {
  const workspaceId = cleanText(
    completionEvent?.workspace_id || options.workspace_id,
  );
  if (!workspaceId) {
    return normalizeWorkspaceNotificationState(state);
  }
  const { bucket, state: currentState } = getWorkspaceBucket(state, workspaceId);
  const createdAt = nowIso();
  // A completed turn with no todo identity is a lighter "turn.completed"
  // signal, never the todo celebration: direct CLI prompts used to ring the
  // todo-completed SFX/badge on every turn.
  const isBareTurnCompletion = !cleanText(completionEvent?.item_id)
    && cleanText(completionEvent?.completion_kind) === "turn";
  const notificationKind = isBareTurnCompletion ? "turn.completed" : "todo.completed";
  // Pane-level attention: the dispatcher stamps whether the finishing pane
  // was actually visible. A completion in a hidden pane of the current
  // workspace must still badge (seen-on-arrival used to swallow it).
  const paneVisibleHint = completionEvent?.pane_visible;
  const seenOnArrival = workspaceNotificationSeenOnArrival(workspaceId, options)
    && paneVisibleHint !== false;
  const rawTerminalIndex = Number(completionEvent?.terminal_index);
  // Stable per-completion id: the todo item id, else the turn id (so a hook
  // delivered twice updates one notification instead of minting a second),
  // else the arrival time.
  const completionKey = cleanText(completionEvent?.item_id)
    || cleanText(completionEvent?.turn_id)
    || String(Date.now());
  const id = `${isBareTurnCompletion ? "turn-completed" : "todo-completed"}:${workspaceId}:${completionKey}`;
  const notification = {
    actionability: "open_thread",
    agent_id: cleanText(completionEvent?.agent_id),
    approval_id: "",
    body: cleanText(completionEvent?.todo_title || completionEvent?.todo_text).slice(0, 200),
    created_at: createdAt,
    db_change_request_id: "",
    dedupe_key: id,
    id,
    kind: notificationKind,
    pane_id: cleanText(completionEvent?.pane_id),
    pending_action: false,
    seen_at: seenOnArrival ? createdAt : "",
    session_id: "",
    severity: "success",
    source_event_id: "",
    source_seq: null,
    status: seenOnArrival ? "read" : "unread",
    task_id: "",
    terminal_index: Number.isInteger(rawTerminalIndex) ? rawTerminalIndex : null,
    thread_id: cleanText(completionEvent?.thread_id),
    title: notificationTitleForKind(notificationKind),
    updated_at: createdAt,
    workspace_id: workspaceId,
  };
  // The lifecycle reducer may have already (or may yet — see the suppression
  // in addTerminalReadyNotification) logged a generic terminal.ready for this
  // same completion: resolve it so the pair counts as one badge increment.
  const notifications = Object.fromEntries(
    Object.entries(bucket.notifications).map(([existingId, existingNotification]) => {
      if (
        existingNotification.kind === TERMINAL_READY_NOTIFICATION_KIND
        && !["dismissed", "resolved"].includes(existingNotification.status)
        && notificationTargetsSameTerminal(existingNotification, notification)
      ) {
        return [existingId, {
          ...existingNotification,
          seen_at: existingNotification.seen_at || createdAt,
          status: "resolved",
          updated_at: createdAt,
        }];
      }
      return [existingId, existingNotification];
    }),
  );
  let nextBucket = {
    ...bucket,
    notifications: {
      ...notifications,
      [id]: notification,
    },
  };
  const nextState = setWorkspaceBucket(currentState, workspaceId, nextBucket);
  // Completion cues bypass the manual-acceptance gate but respect what the
  // user is looking at: when the causing workspace's Terminals tab is visible
  // and the window is focused (`seenOnArrival`), the watched terminal's
  // border flash is the only feedback — no SFX, and the notification arrives
  // already read so the workspace tab badge stays dark. Unfocused window,
  // background mode, a non-terminal tab, or another selected workspace all
  // ring and leave the unread badge on the causing workspace's tab. When the
  // completion also drained the queue, ring the drained tone instead.
  const cueResult = seenOnArrival
    ? { bucket: nextBucket, state: nextState }
    : appendCue(
      nextState,
      nextBucket,
      workspaceId,
      completionEvent?.queue_drained
        ? "todo.queue.drained"
        : isBareTurnCompletion
          ? "turn.completed"
          : "todo.completed",
      options,
      {
        pane_id: completionEvent?.pane_id,
        terminal_index: completionEvent?.terminal_index,
      },
    );
  nextBucket = cueResult.bucket;
  return trimWorkspaceNotifications(setWorkspaceBucket(cueResult.state, workspaceId, nextBucket), workspaceId);
}

export function reconcileWorkspaceNotificationSnapshot(state, workspaceId, snapshot, options = {}) {
  const safeWorkspaceId = cleanText(workspaceId);
  if (!safeWorkspaceId) {
    return normalizeWorkspaceNotificationState(state);
  }
  const data = snapshot?.data && typeof snapshot.data === "object" ? snapshot.data : snapshot;
  const approvals = Array.isArray(data?.approvals) ? data.approvals : [];
  const { bucket, state: currentState } = getWorkspaceBucket(state, safeWorkspaceId);
  const seenOnArrival = workspaceNotificationSeenOnArrival(safeWorkspaceId, options);
  let notifications = { ...bucket.notifications };
  const pendingApprovalIds = new Set();

  approvals.forEach((approval) => {
    const approvalId = cleanText(approval?.id);
    if (!approvalId) return;
    const status = cleanText(approval?.status).toLowerCase();
    const id = `approval:${approvalId}`;
    const existing = notifications[id] || null;
    const isPending = PENDING_APPROVAL_STATUSES.has(status);
    const isResolved = RESOLVED_APPROVAL_STATUSES.has(status) || !isPending;
    if (isPending) {
      pendingApprovalIds.add(approvalId);
    }
    notifications[id] = {
      actionability: "approve_deny",
      agent_id: cleanText(approval?.requested_by_agent_id),
      approval_id: approvalId,
      body: cleanText(approval?.reason || approval?.risk_summary),
      created_at: cleanText(approval?.created_at, existing?.created_at || nowIso()),
      db_change_request_id: existing?.db_change_request_id || "",
      dedupe_key: id,
      id,
      kind: "approval.required",
      pending_action: isPending,
      seen_at: isResolved ? cleanText(approval?.resolved_at, existing?.seen_at || nowIso()) : existing?.seen_at || "",
      session_id: existing?.session_id || "",
      severity: isPending ? "action_required" : "info",
      source_event_id: existing?.source_event_id || "",
      source_seq: existing?.source_seq ?? null,
      status: isPending
        ? (existing?.status === "read" || seenOnArrival ? "read" : "unread")
        : "resolved",
      task_id: cleanText(approval?.task_id),
      terminal_index: null,
      title: notificationTitleForKind(isPending ? "approval.required" : "approval.resolved"),
      updated_at: cleanText(approval?.resolved_at || approval?.created_at, nowIso()),
      workspace_id: safeWorkspaceId,
    };
  });

  notifications = Object.fromEntries(
    Object.entries(notifications).map(([id, notification]) => {
      if (
        notification.kind === "approval.required"
        && notification.approval_id
        && !pendingApprovalIds.has(notification.approval_id)
        && approvals.some((approval) => cleanText(approval?.id) === notification.approval_id)
      ) {
        return [id, {
          ...notification,
          pending_action: false,
          seen_at: notification.seen_at || nowIso(),
          status: "resolved",
          updated_at: nowIso(),
        }];
      }
      return [id, notification];
    }),
  );

  return trimWorkspaceNotifications(setWorkspaceBucket(currentState, safeWorkspaceId, {
    ...bucket,
    notifications,
  }), safeWorkspaceId);
}

export function markWorkspaceNotificationsSeen(state, workspaceId) {
  const safeWorkspaceId = cleanText(workspaceId);
  if (!safeWorkspaceId) {
    return normalizeWorkspaceNotificationState(state);
  }
  const source = state && typeof state === "object" && !Array.isArray(state) ? state : null;
  const sourceWorkspaces = source?.workspaces
    && typeof source.workspaces === "object"
    && !Array.isArray(source.workspaces)
    ? source.workspaces
    : null;
  if (source?.version === WORKSPACE_NOTIFICATION_VERSION && sourceWorkspaces) {
    const sourceNotifications = sourceWorkspaces[safeWorkspaceId]?.notifications || {};
    const hasUnread = Object.values(sourceNotifications).some((notification) => (
      notification?.status === "unread"
    ));
    if (!hasUnread) {
      return state;
    }
  }
  const { bucket, state: currentState } = getWorkspaceBucket(state, safeWorkspaceId);
  const seenAt = nowIso();
  let markedSeen = false;
  const notifications = Object.fromEntries(
    Object.entries(bucket.notifications).map(([id, notification]) => {
      if (notification.status !== "unread") {
        return [id, notification];
      }
      markedSeen = true;
      return [id, {
        ...notification,
        seen_at: seenAt,
        status: "read",
        updated_at: seenAt,
      }];
    }),
  );

  if (!markedSeen) {
    return currentState;
  }

  return setWorkspaceBucket(currentState, safeWorkspaceId, {
    ...bucket,
    last_seen_at: seenAt,
    notifications,
  });
}

/* Pane attribution for the "switch back" moment: which terminals produced the
   still-unread notifications behind the workspace badge/SFX. Must be captured
   BEFORE markWorkspaceNotificationsSeen wipes the unread flags; the terminal
   grid then flashes exactly those panes. */
export function collectWorkspaceNotificationAttentionPanes(state, workspaceId) {
  const safeWorkspaceId = cleanText(workspaceId);
  if (!safeWorkspaceId) return [];
  const { bucket } = getWorkspaceBucket(state, safeWorkspaceId);
  const panes = new Map();
  // Bucket notifications are normalized newest-first, so the first notification
  // kept per pane carries the latest title.
  Object.values(bucket.notifications || {}).forEach((notification) => {
    if (notification.status !== "unread") return;
    const paneId = cleanText(notification.pane_id);
    const terminalIndex = notification.terminal_index == null
      ? null
      : (Number.isInteger(Number(notification.terminal_index)) ? Number(notification.terminal_index) : null);
    if (!paneId && terminalIndex === null) return;
    const key = paneId || `terminal-index:${terminalIndex}`;
    const existing = panes.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    panes.set(key, {
      count: 1,
      kind: notification.kind,
      pane_id: paneId,
      terminal_index: terminalIndex,
      title: notification.title,
    });
  });
  return Array.from(panes.values());
}

function threadIsActive(thread) {
  if (!thread || typeof thread !== "object") return false;
  if (thread.latest_turn?.state === "running") return true;
  if (thread.activity_status === "thinking" || thread.activity_status === "running") return true;
  return Object.values(thread.provider_bindings || {}).some((binding) => (
    binding?.activity_status === "thinking" || binding?.activity_status === "running"
  ));
}

function countActiveWorkspaceThreads(workspaceThreadEntry) {
  return Object.values(workspaceThreadEntry?.threads || {}).filter(threadIsActive).length;
}

export function getWorkspaceNotificationSummary(state, workspaceId, workspaceThreadEntry = null) {
  const normalized = normalizeWorkspaceNotificationState(state);
  const bucket = normalized.workspaces[workspaceId] || normalizeWorkspaceBucket(null, workspaceId);
  const notifications = Object.values(bucket.notifications || {});
  const pendingActionCount = notifications.filter((notification) => (
    notification.pending_action
    && !["dismissed", "resolved"].includes(notification.status)
  )).length;
  const unacknowledgedPendingActionCount = notifications.filter((notification) => (
    notification.pending_action
    && notification.status === "unread"
  )).length;
  const unreadCount = notifications.filter((notification) => (
    !notification.pending_action
    && notification.status === "unread"
  )).length;
  const parkedCount = workspaceParkedCount(bucket);
  const activeTurnCount = Object.keys(bucket.activeTurns || {}).length;
  const activeThreadCount = countActiveWorkspaceThreads(workspaceThreadEntry);
  const activeAgentCount = Math.max(activeTurnCount, activeThreadCount);

  return {
    activeAgentCount,
    badgeCount: unacknowledgedPendingActionCount || unreadCount,
    badgeLabel: unacknowledgedPendingActionCount ? "Action required" : unreadCount ? "Unread notification" : "",
    badgeVariant: unacknowledgedPendingActionCount ? "action" : unreadCount ? "unread" : "none",
    parkedCount,
    pendingActionCount,
    unacknowledgedPendingActionCount,
    unreadCount,
  };
}

export function getWorkspaceNotificationSummaries(state, workspaceThreads = {}) {
  const normalized = normalizeWorkspaceNotificationState(state);
  const workspaceIds = new Set([
    ...Object.keys(normalized.workspaces || {}),
    ...Object.keys(workspaceThreads || {}),
  ]);
  return Object.fromEntries(
    Array.from(workspaceIds).map((workspaceId) => [
      workspaceId,
      getWorkspaceNotificationSummary(normalized, workspaceId, workspaceThreads?.[workspaceId]),
    ]),
  );
}

export function formatWorkspaceNotificationBadgeCount(count) {
  const safe = safeCount(count);
  if (safe > 99) return "99+";
  return safe > 0 ? String(safe) : "";
}

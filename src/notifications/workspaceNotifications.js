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
  return cleanText(options.selectedWorkspaceId) === cleanText(workspaceId);
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
      && HOOK_MANUAL_PROMPT_SOURCE_PARTS.some((part) => normalized.includes(part))
      && !normalized.includes("terminal-output")
  );
}

function lifecycleEventType(event = {}) {
  return cleanText(event?.type || event?.eventType || event?.event_type)
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
    event?.manualPromptSource,
    event?.manual_prompt_source,
    event?.promptingUserSource,
    event?.prompting_user_source,
    event?.promptingSource,
    event?.prompting_source,
    event?.source,
  ].some(hookManualPromptSourceLooksOwned);
}

function lifecycleEventHasResolvedManualPromptDecision(event = {}) {
  return [
    event?.permissionDecision,
    event?.permission_decision,
    event?.decision,
    event?.approvalDecision,
    event?.approval_decision,
    event?.permissionStatus,
    event?.permission_status,
    event?.approvalStatus,
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
  const active = hookManualPromptType
    || event?.manualApprovalRequired === true
    || event?.manual_approval_required === true
    || event?.providerBlockedForUser === true
    || event?.provider_blocked_for_user === true
    || event?.terminalIsPromptingUser === true
    || event?.terminal_is_prompting_user === true
    || event?.promptingUser === true
    || event?.prompting_user === true
    || event?.requiresUserInput === true
    || event?.requires_user_input === true;
  if (!active) {
    return false;
  }

  const kind = normalizePromptingUserKind(
    event?.promptingUserKind
      || event?.prompting_user_kind
      || event?.promptingKind
      || event?.prompting_kind,
  );
  return Boolean(
    hookManualPromptType
      || MANUAL_ACCEPTANCE_PROMPT_KINDS.has(kind)
      || event?.manualApprovalRequired === true
      || event?.manual_approval_required === true
      || event?.requiresUserInput === true
      || event?.requires_user_input === true
      || event?.providerBlockedForUser === true
      || event?.provider_blocked_for_user === true
  );
}

function notificationLooksExplicitPermissionPrompt(notification = {}) {
  const sourceNotification = notification && typeof notification === "object" ? notification : {};
  const kind = normalizePromptingUserKind(
    sourceNotification.promptingUserKind || sourceNotification.prompting_user_kind,
  );
  const source = sourceNotification.promptingUserSource
    || sourceNotification.prompting_user_source
    || sourceNotification.manualPromptSource
    || sourceNotification.manual_prompt_source
    || sourceNotification.source;
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
  const createdAt = cleanText(notification.createdAt || notification.created_at, nowIso());
  const updatedAt = cleanText(notification.updatedAt || notification.updated_at, createdAt);

  return {
    actionability: cleanText(notification.actionability, "open_thread"),
    agentId: cleanText(notification.agentId || notification.agent_id),
    approvalId: cleanText(notification.approvalId || notification.approval_id),
    body: cleanText(notification.body),
    createdAt,
    dbChangeRequestId: cleanText(notification.dbChangeRequestId || notification.db_change_request_id),
    dedupeKey: cleanText(notification.dedupeKey || notification.dedupe_key, id),
    id,
    kind,
    paneId: cleanText(notification.paneId || notification.pane_id),
    pendingAction: Boolean(notification.pendingAction || notification.pending_action),
    promptingUserConfidence: cleanText(notification.promptingUserConfidence || notification.prompting_user_confidence),
    promptingUserKind: normalizePromptingUserKind(notification.promptingUserKind || notification.prompting_user_kind),
    promptingUserSource: cleanText(notification.promptingUserSource || notification.prompting_user_source),
    seenAt: cleanText(notification.seenAt || notification.seen_at),
    sessionId: cleanText(notification.sessionId || notification.session_id),
    severity: cleanText(notification.severity, "info"),
    sourceEventId: cleanText(notification.sourceEventId || notification.source_event_id),
    sourceSeq: notification.sourceSeq ?? notification.seq ?? null,
    status,
    taskId: cleanText(notification.taskId || notification.task_id),
    terminalIndex: notification.terminalIndex ?? notification.terminal_index ?? null,
    threadId: cleanText(notification.threadId || notification.thread_id),
    title: cleanText(notification.title, notificationTitleForKind(kind)),
    updatedAt,
    workspaceId: cleanText(notification.workspaceId || notification.workspace_id, workspaceId),
  };
}

function normalizeActiveTurn(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const id = cleanText(value.id);
  if (!id) return null;
  return {
    agentId: cleanText(value.agentId),
    id,
    lastActiveAt: cleanText(value.lastActiveAt, nowIso()),
    nativeSessionId: cleanText(value.nativeSessionId),
    paneId: cleanText(value.paneId),
    promptId: cleanText(value.promptId),
    providerSessionId: cleanText(value.providerSessionId),
    terminalIndex: value.terminalIndex ?? null,
    threadId: cleanText(value.threadId),
    turnId: cleanText(value.turnId),
    workspaceId: cleanText(value.workspaceId),
  };
}

function normalizeWorkspaceBucket(bucket, workspaceId) {
  const source = bucket && typeof bucket === "object" && !Array.isArray(bucket) ? bucket : {};
  const notifications = Object.fromEntries(
    Object.entries(source.notifications || {})
      .map(([, notification]) => normalizeNotification(notification, workspaceId))
      .filter(Boolean)
      .sort((left, right) => parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt))
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
    lastSeenAt: cleanText(source.lastSeenAt),
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

export function readWorkspaceNotifications() {
  try {
    if (typeof window === "undefined" || !window.localStorage) {
      return normalizeWorkspaceNotificationState(null);
    }
    return normalizeWorkspaceNotificationState(
      JSON.parse(window.localStorage.getItem(WORKSPACE_NOTIFICATION_STORAGE_KEY) || "{}"),
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
          lastSeenAt: bucket.lastSeenAt,
          notifications: bucket.notifications,
        },
      ]),
    );
    const serialized = JSON.stringify({
      version: WORKSPACE_NOTIFICATION_VERSION,
      workspaces,
    });
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
  const explicitWorkspaceId = cleanText(event?.workspaceId || event?.workspace_id);
  if (explicitWorkspaceId) return explicitWorkspaceId;

  const eventPath = normalizeWorkspaceNotificationPath(
    event?.repoPath
      || event?.repo_path
      || event?.payload?.repoPath
      || event?.payload?.repo_path,
  );
  if (!eventPath) return "";

  return workspaceRoots.find((entry) => (
    normalizeWorkspaceNotificationPath(entry?.rootDirectory) === eventPath
  ))?.workspaceId || "";
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

  const sourceTerminalIndex = Number(source.terminalIndex);
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
          createdAt: new Date(nowMs).toISOString(),
          id: `${kind}:${workspaceId}:${nowMs}:${Math.random().toString(16).slice(2)}`,
          kind,
          // Causer attribution: which terminal produced this cue, so cue
          // consumers can reason about the source, not just the workspace.
          paneId: cleanText(source.paneId),
          terminalIndex: Number.isInteger(sourceTerminalIndex) ? sourceTerminalIndex : null,
          workspaceId,
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
  if (!notification?.pendingAction) {
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
    notification.promptingUserKind || notification.prompting_user_kind,
  );
  return MANUAL_ACCEPTANCE_PROMPT_KINDS.has(promptingKind)
    && notificationLooksExplicitPermissionPrompt(notification);
}

function appendNotificationCue(state, bucket, workspaceId, notification, existing, options = {}) {
  if (!shouldCueNotification(notification, existing, options)) {
    return { bucket, state };
  }
  return appendCue(state, bucket, workspaceId, notification.kind || "workspace.notification", options, {
    paneId: notification.paneId,
    terminalIndex: notification.terminalIndex,
  });
}

function eventRefs(event) {
  const refs = event?.refs && typeof event.refs === "object" ? event.refs : {};
  return {
    agentId: cleanText(refs.agentId || refs.agent_id || event?.agentId || event?.agent_id),
    artifactId: cleanText(refs.artifactId || refs.artifact_id),
    contextRunId: cleanText(refs.contextRunId || refs.context_run_id),
    resourceId: cleanText(refs.resourceId || refs.resource_id),
    sessionId: cleanText(refs.sessionId || refs.session_id || event?.sessionId || event?.session_id),
    taskId: cleanText(refs.taskId || refs.task_id || event?.taskId || event?.task_id),
  };
}

function eventPayload(event) {
  return event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
    ? event.payload
    : {};
}

function eventType(event) {
  return cleanText(event?.eventType || event?.event_type).toLowerCase();
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
  return cleanText(payload.approval_id || payload.approvalId || event?.approvalId || event?.approval_id);
}

function dbChangeRequestIdFromEvent(event) {
  const payload = eventPayload(event);
  return cleanText(
    payload.db_change_request_id
      || payload.dbChangeRequestId
      || event?.dbChangeRequestId
      || event?.db_change_request_id,
  );
}

function notificationIdForCoordinationEvent(kind, event) {
  const refs = eventRefs(event);
  const approvalId = approvalIdFromEvent(event);
  const dbChangeRequestId = dbChangeRequestIdFromEvent(event);
  const type = eventType(event);
  const sourceEventId = cleanText(event?.sourceEventId || event?.source_event_id || event?.eventId || event?.id);
  if (type.startsWith("db_change_") && dbChangeRequestId) {
    return `db-change:${dbChangeRequestId}`;
  }
  if (kind === "approval.required" || kind === "approval.resolved") {
    if (approvalId) return `approval:${approvalId}`;
    if (dbChangeRequestId) return `db-change:${dbChangeRequestId}`;
  }
  if (kind === "task.parked" || kind === "task.resume_ready" || kind === "task.resume.ready") {
    if (refs.taskId) return `task-wait:${refs.taskId}`;
  }
  if (kind === "tool.failed" && refs.taskId) {
    return `tool-failed:${refs.taskId}:${sourceEventId || Date.now()}`;
  }
  return `${kind}:${sourceEventId || refs.taskId || Date.now()}`;
}

function pendingActionForKind(kind) {
  return kind === "approval.required" || kind === "task.resume_ready" || kind === "task.resume.ready";
}

function buildCoordinationNotification(event, workspaceId, existing, options = {}) {
  const refs = eventRefs(event);
  const payload = eventPayload(event);
  const kind = eventKind(event);
  const sourceEventId = cleanText(event?.sourceEventId || event?.source_event_id || event?.eventId || event?.id);
  const createdAt = cleanText(event?.createdAt || event?.created_at, nowIso());
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
    agentId: refs.agentId,
    approvalId: approvalIdFromEvent(event) || existing?.approvalId || "",
    body: cleanText(
      payload.reason
        || payload.risk_summary
        || payload.status
        || existing?.body,
    ),
    createdAt: existing?.createdAt || createdAt,
    dbChangeRequestId: dbChangeRequestIdFromEvent(event) || existing?.dbChangeRequestId || "",
    dedupeKey: notificationIdForCoordinationEvent(kind, event),
    id: notificationIdForCoordinationEvent(kind, event),
    kind: kind === "approval.resolved" ? existing?.kind || "approval.required" : kind,
    pendingAction: kind === "approval.resolved" ? false : pendingAction,
    seenAt: kind === "approval.resolved" ? cleanText(event?.createdAt || event?.created_at, nowIso()) : existing?.seenAt || "",
    sessionId: refs.sessionId,
    severity: cleanText(event?.severity, pendingAction ? "action_required" : "info"),
    sourceEventId,
    sourceSeq: event?.sourceSeq ?? event?.seq ?? existing?.sourceSeq ?? null,
    status,
    taskId: refs.taskId,
    terminalIndex: event?.terminalIndex ?? event?.terminal_index ?? existing?.terminalIndex ?? null,
    title: notificationTitleForKind(kind),
    updatedAt: cleanText(event?.createdAt || event?.created_at, nowIso()),
    workspaceId,
  };
}

export function reduceWorkspaceNotificationEvent(state, rawEvent, options = {}) {
  const workspaceId = cleanText(rawEvent?.workspaceId || rawEvent?.workspace_id || options.workspaceId);
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
      .sort((left, right) => parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt))
      .slice(0, MAX_NOTIFICATIONS_PER_WORKSPACE)
      .map((notification) => [notification.id, notification]),
  );

  return setWorkspaceBucket(state, workspaceId, {
    ...bucket,
    notifications,
  });
}

function lifecycleActiveKey(event, workspaceId) {
  const threadId = cleanText(event?.threadId || event?.thread_id);
  const terminalIndex = event?.terminalIndex ?? event?.terminal_index ?? "";
  const paneId = cleanText(event?.paneId || event?.pane_id);
  const agentId = cleanText(event?.agentId || event?.currentAgent || event?.agent_id, "agent");
  const turnId = cleanText(
    event?.turnId
      || event?.turn_id
      || event?.promptEventId
      || event?.pendingPromptId
      || event?.promptId
      || event?.nativeSessionId
      || event?.providerSessionId,
  );
  const targetId = threadId || paneId || (terminalIndex !== "" ? `terminal-${terminalIndex}` : "");
  if (!targetId) return "";
  return `turn:${workspaceId}:${targetId}:${agentId}:${turnId || "active"}`;
}

function activeTurnFromLifecycle(event, workspaceId) {
  const id = lifecycleActiveKey(event, workspaceId);
  if (!id) return null;
  return {
    agentId: cleanText(event?.agentId || event?.currentAgent || event?.agent_id),
    id,
    lastActiveAt: cleanText(event?.updatedAt || event?.createdAt, nowIso()),
    nativeSessionId: cleanText(event?.nativeSessionId),
    paneId: cleanText(event?.paneId),
    promptId: cleanText(event?.promptEventId || event?.pendingPromptId || event?.promptId),
    providerSessionId: cleanText(event?.providerSessionId),
    terminalIndex: event?.terminalIndex ?? event?.terminal_index ?? null,
    threadId: cleanText(event?.threadId || event?.thread_id),
    turnId: cleanText(event?.turnId || event?.turn_id),
    workspaceId,
  };
}

function activeTurnMatchesLifecycle(turn, event) {
  const threadId = cleanText(event?.threadId || event?.thread_id);
  const paneId = cleanText(event?.paneId || event?.pane_id);
  const terminalIndex = event?.terminalIndex ?? event?.terminal_index ?? null;
  const agentId = cleanText(event?.agentId || event?.currentAgent || event?.agent_id);

  if (agentId && turn.agentId && agentId !== turn.agentId) {
    return false;
  }
  if (threadId && turn.threadId) {
    return threadId === turn.threadId;
  }
  if (paneId && turn.paneId) {
    return paneId === turn.paneId;
  }
  if (terminalIndex != null && turn.terminalIndex != null) {
    return String(terminalIndex) === String(turn.terminalIndex);
  }
  return Boolean(threadId || paneId || terminalIndex != null);
}

function lifecycleTerminalWorkState(event) {
  return cleanText(event?.terminalWorkState || event?.terminal_work_state).toLowerCase();
}

function lifecycleTerminalIsComplete(event) {
  const state = lifecycleTerminalWorkState(event);
  return event?.terminalIsComplete === true
    || event?.terminal_is_complete === true
    || state === "complete"
    || state === "completed";
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
  ].includes(type)
    || event?.terminalIsPromptingUser === false
    || event?.terminal_is_prompting_user === false
    || event?.promptingUser === false
    || event?.requiresUserInput === false
    || ["complete", "completed", "error", "parked", "running"].includes(state);
}

function promptingNotificationId(event, workspaceId) {
  const threadId = cleanText(event?.threadId || event?.thread_id);
  const paneId = cleanText(event?.paneId || event?.pane_id);
  const terminalIndex = event?.terminalIndex ?? event?.terminal_index ?? "";
  const agentId = cleanText(event?.agentId || event?.currentAgent || event?.agent_id, "agent");
  const turnId = cleanText(
    event?.turnId
      || event?.turn_id
      || event?.promptEventId
      || event?.pendingPromptId
      || event?.promptId,
  );
  const targetId = threadId || paneId || (terminalIndex !== "" ? `terminal-${terminalIndex}` : "workspace");
  return `user-input:${workspaceId}:${targetId}:${agentId}:${turnId || "active"}`;
}

function promptingNotificationBody(event) {
  return cleanText(
    event?.promptingUserText
      || event?.promptingText
      || event?.terminalPrompt
      || event?.terminalText
      || event?.outputText
      || event?.text,
  ).slice(0, 280);
}

function buildPromptingNotification(event, workspaceId, existing, options = {}) {
  const createdAt = nowIso();
  const seenOnArrival = workspaceNotificationSeenOnArrival(workspaceId, options);
  const id = promptingNotificationId(event, workspaceId);
  const sourceText = event?.promptingUserSource
    || event?.prompting_user_source
    || event?.promptingSource
    || event?.prompting_source
    || event?.source
    || event?.type;
  const sourceEventId = promptingPermissionToken(event)
    || event?.sourceEventId
    || event?.source_event_id
    || existing?.sourceEventId
    || existing?.source_event_id;
  return {
    actionability: "open_thread",
    agentId: cleanText(event?.agentId || event?.currentAgent || event?.agent_id),
    approvalId: cleanText(event?.approvalId || event?.approval_id || existing?.approvalId || existing?.approval_id),
    body: promptingNotificationBody(event) || existing?.body || "",
    createdAt: existing?.createdAt || createdAt,
    dbChangeRequestId: "",
    dedupeKey: id,
    id,
    kind: "user.input.required",
    paneId: cleanText(event?.paneId || event?.pane_id),
    pendingAction: true,
    promptingUserConfidence: cleanText(event?.promptingUserConfidence || event?.prompting_user_confidence),
    promptingUserKind: normalizePromptingUserKind(event?.promptingUserKind || event?.prompting_user_kind),
    promptingUserSource: cleanText(
      promptingSourceLooksExplicitPermission(sourceText)
        ? sourceText
        : sourceEventId
          ? "permission-token"
          : sourceText,
      "permission",
    ),
    seenAt: seenOnArrival ? createdAt : existing?.seenAt || "",
    sessionId: cleanText(event?.nativeSessionId || event?.providerSessionId),
    severity: "action_required",
    sourceEventId: cleanText(sourceEventId),
    sourceSeq: event?.sourceSeq ?? event?.seq ?? existing?.sourceSeq ?? null,
    status: (existing?.status === "read" || seenOnArrival) ? "read" : "unread",
    taskId: "",
    terminalIndex: event?.terminalIndex ?? event?.terminal_index ?? existing?.terminalIndex ?? null,
    threadId: cleanText(event?.threadId || event?.thread_id),
    title: notificationTitleForKind("user.input.required"),
    updatedAt: createdAt,
    workspaceId,
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
          pendingAction: false,
          seenAt: notification.seenAt || updatedAt,
          status: "resolved",
          updatedAt,
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
  const leftPane = cleanText(left?.paneId);
  const rightPane = cleanText(right?.paneId);
  if (leftPane && rightPane) return leftPane === rightPane;
  const leftThread = cleanText(left?.threadId);
  const rightThread = cleanText(right?.threadId);
  if (leftThread && rightThread) return leftThread === rightThread;
  if (left?.terminalIndex != null && right?.terminalIndex != null) {
    return String(left.terminalIndex) === String(right.terminalIndex);
  }
  return false;
}

function bucketHasFreshTodoCompletionForTarget(bucket, candidate) {
  const nowMs = Date.now();
  return Object.values(bucket.notifications || {}).some((notification) => (
    notification.kind === "todo.completed"
    && notification.status !== "dismissed"
    && notificationTargetsSameTerminal(notification, candidate)
    && nowMs - parseTimestampMs(notification.updatedAt || notification.createdAt)
      < TERMINAL_READY_TODO_SUPPRESSION_WINDOW_MS
  ));
}

function workspacePendingActionCount(bucket) {
  return Object.values(bucket.notifications || {}).filter((notification) => (
    notification.pendingAction
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
    agentId: "",
    approvalId: "",
    body: "",
    createdAt,
    dbChangeRequestId: "",
    dedupeKey: id,
    id,
    kind: "all.done",
    pendingAction: false,
    seenAt: seenOnArrival ? createdAt : "",
    sessionId: "",
    severity: "success",
    sourceEventId: "",
    sourceSeq: null,
    status: seenOnArrival ? "read" : "unread",
    taskId: "",
    terminalIndex: null,
    title: notificationTitleForKind("all.done"),
    updatedAt: createdAt,
    workspaceId,
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
  const paneId = cleanText(event?.paneId || event?.pane_id);
  const terminalIndex = event?.terminalIndex ?? event?.terminal_index ?? "";
  const targetId = paneId || (terminalIndex !== "" ? `terminal-${terminalIndex}` : "workspace");
  const sourceEventId = cleanText(
    event?.sourceEventId
      || event?.source_event_id
      || event?.promptEventId
      || event?.pendingPromptId
      || event?.promptId
      || event?.id,
  );
  return `terminal-ready:${workspaceId}:${targetId}:${sourceEventId || Date.now()}`;
}

function buildTerminalReadyNotification(event, workspaceId, existing, options = {}) {
  const createdAt = nowIso();
  const seenOnArrival = workspaceNotificationSeenOnArrival(workspaceId, options);
  const id = terminalReadyNotificationId(event, workspaceId);
  return {
    actionability: "open_thread",
    agentId: cleanText(event?.agentId || event?.currentAgent || event?.agent_id),
    approvalId: "",
    body: "",
    createdAt: existing?.createdAt || createdAt,
    dbChangeRequestId: "",
    dedupeKey: id,
    id,
    kind: TERMINAL_READY_NOTIFICATION_KIND,
    paneId: cleanText(event?.paneId || event?.pane_id),
    pendingAction: false,
    seenAt: seenOnArrival ? createdAt : existing?.seenAt || "",
    sessionId: cleanText(event?.nativeSessionId || event?.providerSessionId),
    severity: "success",
    sourceEventId: cleanText(event?.sourceEventId || event?.source_event_id),
    sourceSeq: event?.sourceSeq ?? event?.seq ?? existing?.sourceSeq ?? null,
    status: existing?.status === "read" || seenOnArrival ? "read" : "unread",
    taskId: "",
    terminalIndex: event?.terminalIndex ?? event?.terminal_index ?? existing?.terminalIndex ?? null,
    threadId: cleanText(event?.threadId || event?.thread_id),
    title: notificationTitleForKind(TERMINAL_READY_NOTIFICATION_KIND),
    updatedAt: createdAt,
    workspaceId,
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
  const workspaceId = cleanText(lifecycleEvent?.workspaceId || lifecycleEvent?.workspace_id || options.workspaceId);
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
    const activityStatus = cleanText(lifecycleEvent?.activityStatus || lifecycleEvent?.status).toLowerCase();
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
        COMPLETION_LIFECYCLE_TYPES.has(type)
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
    const id = `agent-failed:${workspaceId}:${cleanText(lifecycleEvent.threadId || lifecycleEvent.paneId, Date.now())}`;
    const seenOnArrival = workspaceNotificationSeenOnArrival(workspaceId, options);
    const failedBucket = nextState.workspaces[workspaceId] || nextBucket;
    const existing = failedBucket.notifications?.[id] || null;
    const notification = {
      actionability: "open_thread",
      agentId: cleanText(lifecycleEvent.agentId || lifecycleEvent.currentAgent),
      approvalId: "",
      body: cleanText(lifecycleEvent.error),
      createdAt,
      dbChangeRequestId: "",
      dedupeKey: id,
      id,
      kind: "agent.failed",
      pendingAction: false,
      seenAt: seenOnArrival ? createdAt : "",
      sessionId: cleanText(lifecycleEvent.nativeSessionId || lifecycleEvent.providerSessionId),
      severity: "warning",
      sourceEventId: "",
      sourceSeq: null,
      status: seenOnArrival ? "read" : "unread",
      taskId: "",
      terminalIndex: lifecycleEvent.terminalIndex ?? null,
      title: notificationTitleForKind("agent.failed"),
      updatedAt: createdAt,
      workspaceId,
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
  const workspaceId = cleanText(parkedEvent?.workspaceId || options.workspaceId);
  const taskId = cleanText(parkedEvent?.taskId || parkedEvent?.task_id);
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
    agentId: "",
    approvalId: "",
    body: cleanText(parkedEvent?.reason || parkedEvent?.waitingOn || parkedEvent?.waiting_on),
    createdAt: existing?.createdAt || createdAt,
    dbChangeRequestId: "",
    dedupeKey: id,
    id,
    kind: "task.parked",
    pendingAction: false,
    seenAt: resolved ? createdAt : existing?.seenAt || "",
    sessionId: "",
    severity: "warning",
    sourceEventId: "",
    sourceSeq: null,
    status: resolved ? "resolved" : (existing?.status === "read" || seenOnArrival ? "read" : "unread"),
    taskId,
    terminalIndex: null,
    title: cleanText(parkedEvent?.title, notificationTitleForKind("task.parked")),
    updatedAt: createdAt,
    workspaceId,
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
    completionEvent?.workspaceId || completionEvent?.workspace_id || options.workspaceId,
  );
  if (!workspaceId) {
    return normalizeWorkspaceNotificationState(state);
  }
  const { bucket, state: currentState } = getWorkspaceBucket(state, workspaceId);
  const createdAt = nowIso();
  const seenOnArrival = workspaceNotificationSeenOnArrival(workspaceId, options);
  const rawTerminalIndex = Number(completionEvent?.terminalIndex ?? completionEvent?.terminal_index);
  // Stable per-completion id: the todo item id, else the turn id (so a hook
  // delivered twice updates one notification instead of minting a second),
  // else the arrival time.
  const completionKey = cleanText(completionEvent?.itemId)
    || cleanText(completionEvent?.turnId || completionEvent?.turn_id)
    || String(Date.now());
  const id = `todo-completed:${workspaceId}:${completionKey}`;
  const notification = {
    actionability: "open_thread",
    agentId: cleanText(completionEvent?.agentId || completionEvent?.agent_id),
    approvalId: "",
    body: cleanText(completionEvent?.todoTitle || completionEvent?.todoText).slice(0, 200),
    createdAt,
    dbChangeRequestId: "",
    dedupeKey: id,
    id,
    kind: "todo.completed",
    paneId: cleanText(completionEvent?.paneId || completionEvent?.pane_id),
    pendingAction: false,
    seenAt: seenOnArrival ? createdAt : "",
    sessionId: "",
    severity: "success",
    sourceEventId: "",
    sourceSeq: null,
    status: seenOnArrival ? "read" : "unread",
    taskId: "",
    terminalIndex: Number.isInteger(rawTerminalIndex) ? rawTerminalIndex : null,
    threadId: cleanText(completionEvent?.threadId || completionEvent?.thread_id),
    title: notificationTitleForKind("todo.completed"),
    updatedAt: createdAt,
    workspaceId,
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
          seenAt: existingNotification.seenAt || createdAt,
          status: "resolved",
          updatedAt: createdAt,
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
      completionEvent?.queueDrained ? "todo.queue.drained" : "todo.completed",
      options,
      {
        paneId: completionEvent?.paneId || completionEvent?.pane_id,
        terminalIndex: completionEvent?.terminalIndex ?? completionEvent?.terminal_index,
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
      agentId: cleanText(approval?.requested_by_agent_id || approval?.requestedByAgentId),
      approvalId,
      body: cleanText(approval?.reason || approval?.risk_summary || approval?.riskSummary),
      createdAt: cleanText(approval?.created_at || approval?.createdAt, existing?.createdAt || nowIso()),
      dbChangeRequestId: existing?.dbChangeRequestId || "",
      dedupeKey: id,
      id,
      kind: "approval.required",
      pendingAction: isPending,
      seenAt: isResolved ? cleanText(approval?.resolved_at || approval?.resolvedAt, existing?.seenAt || nowIso()) : existing?.seenAt || "",
      sessionId: existing?.sessionId || "",
      severity: isPending ? "action_required" : "info",
      sourceEventId: existing?.sourceEventId || "",
      sourceSeq: existing?.sourceSeq ?? null,
      status: isPending
        ? (existing?.status === "read" || seenOnArrival ? "read" : "unread")
        : "resolved",
      taskId: cleanText(approval?.task_id || approval?.taskId),
      terminalIndex: null,
      title: notificationTitleForKind(isPending ? "approval.required" : "approval.resolved"),
      updatedAt: cleanText(approval?.resolved_at || approval?.resolvedAt || approval?.created_at || approval?.createdAt, nowIso()),
      workspaceId: safeWorkspaceId,
    };
  });

  notifications = Object.fromEntries(
    Object.entries(notifications).map(([id, notification]) => {
      if (
        notification.kind === "approval.required"
        && notification.approvalId
        && !pendingApprovalIds.has(notification.approvalId)
        && approvals.some((approval) => cleanText(approval?.id) === notification.approvalId)
      ) {
        return [id, {
          ...notification,
          pendingAction: false,
          seenAt: notification.seenAt || nowIso(),
          status: "resolved",
          updatedAt: nowIso(),
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
        seenAt,
        status: "read",
        updatedAt: seenAt,
      }];
    }),
  );

  if (!markedSeen) {
    return currentState;
  }

  return setWorkspaceBucket(currentState, safeWorkspaceId, {
    ...bucket,
    lastSeenAt: seenAt,
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
    const paneId = cleanText(notification.paneId);
    const terminalIndex = notification.terminalIndex == null
      ? null
      : (Number.isInteger(Number(notification.terminalIndex)) ? Number(notification.terminalIndex) : null);
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
      paneId,
      terminalIndex,
      title: notification.title,
    });
  });
  return Array.from(panes.values());
}

function threadIsActive(thread) {
  if (!thread || typeof thread !== "object") return false;
  if (thread.latestTurn?.state === "running") return true;
  if (thread.activityStatus === "thinking" || thread.activityStatus === "running") return true;
  return Object.values(thread.providerBindings || {}).some((binding) => (
    binding?.activityStatus === "thinking" || binding?.activityStatus === "running"
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
    notification.pendingAction
    && !["dismissed", "resolved"].includes(notification.status)
  )).length;
  const unacknowledgedPendingActionCount = notifications.filter((notification) => (
    notification.pendingAction
    && notification.status === "unread"
  )).length;
  const unreadCount = notifications.filter((notification) => (
    !notification.pendingAction
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

export const WORKSPACE_NOTIFICATION_EVENT = "diffforge:workspace-notification-event";
export const TERMINAL_PARKED_PROMPT_EVENT = "forge-terminal-parked-prompt";

const WORKSPACE_NOTIFICATION_STORAGE_KEY = "diffforge.workspaceNotifications.v1";
const WORKSPACE_NOTIFICATION_VERSION = 1;
const MAX_NOTIFICATIONS_PER_WORKSPACE = 80;
const MAX_CUES = 24;
const APPROVAL_CUE_COOLDOWN_MS = 5000;
const ALL_DONE_CUE_COOLDOWN_MS = 1200;

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
  "terminal-prompt-ready",
]);

const ALL_DONE_COMPLETION_TYPES = new Set([
  "provider-turn-completed",
  "terminal-prompt-ready",
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

function normalizeNotificationStatus(value, fallback = "unread") {
  const status = cleanText(value, fallback).toLowerCase();
  return ["dismissed", "read", "resolved", "unread"].includes(status) ? status : fallback;
}

function normalizeNotificationKind(value) {
  const kind = cleanText(value, "coordination.event").toLowerCase();
  return kind.replace(/_/g, ".");
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
    pendingAction: Boolean(notification.pendingAction || notification.pending_action),
    seenAt: cleanText(notification.seenAt || notification.seen_at),
    sessionId: cleanText(notification.sessionId || notification.session_id),
    severity: cleanText(notification.severity, "info"),
    sourceEventId: cleanText(notification.sourceEventId || notification.source_event_id),
    sourceSeq: notification.sourceSeq ?? notification.seq ?? null,
    status,
    taskId: cleanText(notification.taskId || notification.task_id),
    terminalIndex: notification.terminalIndex ?? notification.terminal_index ?? null,
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
    window.localStorage.setItem(
      WORKSPACE_NOTIFICATION_STORAGE_KEY,
      JSON.stringify({ version: WORKSPACE_NOTIFICATION_VERSION, workspaces }),
    );
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
    case "approval.required":
      return "Approval required";
    case "approval.resolved":
      return "Approval resolved";
    case "task.parked":
      return "Task parked";
    case "task.resume.ready":
    case "task.resume_ready":
      return "Task ready to resume";
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

function appendCue(state, bucket, workspaceId, kind, options = {}) {
  if (options.suppressCue) {
    return { bucket, state };
  }

  const nowMs = Date.now();
  const cueKey = kind === "all.done" ? "allDone" : "approval";
  const cooldownMs = kind === "all.done" ? ALL_DONE_CUE_COOLDOWN_MS : APPROVAL_CUE_COOLDOWN_MS;
  const lastCueAt = safeCount(bucket.lastCueAt?.[cueKey]);
  if (lastCueAt && nowMs - lastCueAt < cooldownMs) {
    return { bucket, state };
  }

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
          workspaceId,
        },
      ].slice(-MAX_CUES),
    },
  };
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
  const selectedWorkspace = options.selectedWorkspaceId === workspaceId;
  const passiveStatus = selectedWorkspace ? "read" : "unread";
  const pendingAction = pendingActionForKind(kind);
  const status = kind === "approval.resolved"
    ? "resolved"
    : pendingAction
      ? "unread"
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

  if (kind === "approval.required" && !existing?.pendingAction) {
    const cueResult = appendCue(nextState, nextBucket, workspaceId, "approval.required", options);
    nextBucket = cueResult.bucket;
    nextState = setWorkspaceBucket(cueResult.state, workspaceId, nextBucket);
  }

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
  const selectedWorkspace = options.selectedWorkspaceId === workspaceId;
  const id = `all-done:${workspaceId}:${Date.now()}`;
  let nextBucket = {
    ...bucket,
    notifications: {
      ...bucket.notifications,
      [id]: {
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
        seenAt: selectedWorkspace ? createdAt : "",
        sessionId: "",
        severity: "success",
        sourceEventId: "",
        sourceSeq: null,
        status: selectedWorkspace ? "read" : "unread",
        taskId: "",
        terminalIndex: null,
        title: notificationTitleForKind("all.done"),
        updatedAt: createdAt,
        workspaceId,
      },
    },
  };
  const nextState = setWorkspaceBucket(state, workspaceId, nextBucket);
  const cueResult = appendCue(nextState, nextBucket, workspaceId, "all.done", options);
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
  let nextBucket = bucket;

  if (type === "agent-output") {
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
  } else if (COMPLETION_LIFECYCLE_TYPES.has(type)) {
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
  const afterActiveCount = Object.keys(nextBucket.activeTurns || {}).length;
  if (
    beforeActiveCount > 0
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
    const selectedWorkspace = options.selectedWorkspaceId === workspaceId;
    const failedBucket = nextState.workspaces[workspaceId] || nextBucket;
    nextState = trimWorkspaceNotifications(setWorkspaceBucket(nextState, workspaceId, {
      ...failedBucket,
      notifications: {
        ...failedBucket.notifications,
        [id]: {
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
          seenAt: selectedWorkspace ? createdAt : "",
          sessionId: cleanText(lifecycleEvent.nativeSessionId || lifecycleEvent.providerSessionId),
          severity: "warning",
          sourceEventId: "",
          sourceSeq: null,
          status: selectedWorkspace ? "read" : "unread",
          taskId: "",
          terminalIndex: lifecycleEvent.terminalIndex ?? null,
          title: notificationTitleForKind("agent.failed"),
          updatedAt: createdAt,
          workspaceId,
        },
      },
    }), workspaceId);
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
  return trimWorkspaceNotifications(setWorkspaceBucket(currentState, workspaceId, {
    ...bucket,
    notifications: {
      ...bucket.notifications,
      [id]: {
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
        status: resolved ? "resolved" : "unread",
        taskId,
        terminalIndex: null,
        title: cleanText(parkedEvent?.title, notificationTitleForKind("task.parked")),
        updatedAt: createdAt,
        workspaceId,
      },
    },
  }), workspaceId);
}

export function reconcileWorkspaceNotificationSnapshot(state, workspaceId, snapshot, options = {}) {
  const safeWorkspaceId = cleanText(workspaceId);
  if (!safeWorkspaceId) {
    return normalizeWorkspaceNotificationState(state);
  }
  const data = snapshot?.data && typeof snapshot.data === "object" ? snapshot.data : snapshot;
  const approvals = Array.isArray(data?.approvals) ? data.approvals : [];
  const { bucket, state: currentState } = getWorkspaceBucket(state, safeWorkspaceId);
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
      status: isPending ? "unread" : "resolved",
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
  const { bucket, state: currentState } = getWorkspaceBucket(state, safeWorkspaceId);
  const seenAt = nowIso();
  const notifications = Object.fromEntries(
    Object.entries(bucket.notifications).map(([id, notification]) => {
      if (notification.pendingAction || notification.status !== "unread") {
        return [id, notification];
      }
      return [id, {
        ...notification,
        seenAt,
        status: "read",
        updatedAt: seenAt,
      }];
    }),
  );

  return setWorkspaceBucket(currentState, safeWorkspaceId, {
    ...bucket,
    lastSeenAt: seenAt,
    notifications,
  });
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
    badgeCount: pendingActionCount || unreadCount,
    badgeLabel: pendingActionCount ? "Action required" : unreadCount ? "Unread notification" : "",
    badgeVariant: pendingActionCount ? "action" : unreadCount ? "unread" : "none",
    parkedCount,
    pendingActionCount,
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

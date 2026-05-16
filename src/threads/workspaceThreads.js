const WORKSPACE_THREADS_STORAGE_KEY = "diffforge.workspaceThreads.v1";
const MAX_THREAD_MESSAGES = 360;
const MAX_THREADS_PER_WORKSPACE = 80;
const DEFAULT_AGENT_ID = "codex";
const THREAD_AGENT_IDS = ["codex", "claude", "opencode"];

function nowIso() {
  return new Date().toISOString();
}

function hasStorage() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function cleanText(value, fallback = "") {
  const text = String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text || fallback;
}

function cleanMessageText(value, fallback = "") {
  const text = String(value || "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  return text || fallback;
}

function cleanModelId(value, fallback = "") {
  const modelId = cleanText(value);
  if (
    !modelId
    || modelId.length > 120
    || !/^[A-Za-z0-9._:/-]+$/.test(modelId)
  ) {
    return fallback;
  }

  return modelId;
}

function cleanAgentId(value, fallback = DEFAULT_AGENT_ID) {
  const agentId = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");

  return agentId || fallback;
}

function isThreadAgentId(value) {
  return THREAD_AGENT_IDS.includes(cleanAgentId(value, ""));
}

function safeKey(value, fallback = "workspace") {
  const key = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 52);

  return key || fallback;
}

function createRandomId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Math.random().toString(16).slice(2)}-${Date.now().toString(36)}`;
}

function normalizeTerminalIndex(value) {
  const index = Number.parseInt(value, 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function defaultThreadId(workspaceId, terminalIndex) {
  return `thread-${safeKey(workspaceId)}-${Math.max(0, Number.parseInt(terminalIndex, 10) || 0) + 1}`;
}

function defaultSlotKey(terminalIndex) {
  return String(Math.max(0, Number.parseInt(terminalIndex, 10) || 0) + 1);
}

function terminalSessionKey(terminalIndex) {
  const safeIndex = normalizeTerminalIndex(terminalIndex);
  return safeIndex == null ? "" : String(safeIndex);
}

function getThreadTerminalIndex(thread) {
  const terminalIndex = normalizeTerminalIndex(thread?.terminalIndex);
  if (terminalIndex != null) {
    return terminalIndex;
  }

  return normalizeTerminalIndex(thread?.terminalBinding?.terminalIndex);
}

function getThreadRestoreTimestamp(thread) {
  return [
    thread?.lastActiveAt,
    thread?.lastMessageAt,
    thread?.updatedAt,
    thread?.createdAt,
  ].reduce((latest, value) => {
    const timestamp = Date.parse(value || "");
    return Number.isFinite(timestamp) ? Math.max(latest, timestamp) : latest;
  }, 0);
}

function normalizeTerminalThreadIds(value, threads = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const normalized = {};

  Object.entries(source).forEach(([terminalIndex, threadId]) => {
    const key = terminalSessionKey(terminalIndex);
    const safeThreadId = cleanText(threadId);
    if (key && safeThreadId && threads[safeThreadId]) {
      normalized[key] = safeThreadId;
    }
  });

  return normalized;
}

function rememberTerminalThread(entry, terminalIndex, threadId) {
  const key = terminalSessionKey(terminalIndex);
  const safeThreadId = cleanText(threadId);
  if (!key || !safeThreadId || !entry?.threads?.[safeThreadId]) {
    return false;
  }

  if (!entry.terminalThreadIds || typeof entry.terminalThreadIds !== "object") {
    entry.terminalThreadIds = {};
  }

  if (entry.terminalThreadIds[key] === safeThreadId) {
    return false;
  }

  entry.terminalThreadIds[key] = safeThreadId;
  return true;
}

function forgetTerminalThread(entry, terminalIndex, threadId = "") {
  const key = terminalSessionKey(terminalIndex);
  if (!key || !entry?.terminalThreadIds?.[key]) {
    return false;
  }

  const safeThreadId = cleanText(threadId);
  if (safeThreadId && entry.terminalThreadIds[key] !== safeThreadId) {
    return false;
  }

  delete entry.terminalThreadIds[key];
  return true;
}

function forgetThreadEverywhere(entry, threadId) {
  const safeThreadId = cleanText(threadId);
  if (!safeThreadId || !entry?.terminalThreadIds) {
    return false;
  }

  let changed = false;
  Object.entries(entry.terminalThreadIds).forEach(([terminalKey, mappedThreadId]) => {
    if (mappedThreadId === safeThreadId) {
      delete entry.terminalThreadIds[terminalKey];
      changed = true;
    }
  });

  return changed;
}

function createThreadIdForTerminal(workspaceId, terminalIndex) {
  return createRandomId(`thread-${safeKey(workspaceId)}-${defaultSlotKey(terminalIndex)}`);
}

export function createWorkspaceThreadId(workspaceId, terminalIndex) {
  return createThreadIdForTerminal(workspaceId, terminalIndex);
}

function normalizeMessageCount(value) {
  const count = Number.parseInt(value, 10);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

function normalizeThreadActivityStatus(value, fallback = "idle") {
  const status = cleanText(value, fallback).toLowerCase();
  return ["idle", "thinking"].includes(status) ? status : "idle";
}

function normalizeThreadMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return null;
  }

  const id = cleanText(message.id, createRandomId("message"));
  const role = cleanText(message.role, "user").toLowerCase();
  const safeRole = ["activity", "assistant", "system", "user"].includes(role) ? role : "user";
  const kind = cleanText(message.kind, safeRole === "activity" ? "activity" : "message")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 48);
  const text = cleanMessageText(message.text || message.message);
  if (!id || !text) {
    return null;
  }

  return {
    agentId: cleanAgentId(message.agentId || message.agent_id, ""),
    callId: cleanText(message.callId || message.call_id),
    createdAt: cleanText(message.createdAt || message.created_at, nowIso()),
    id,
    kind: kind || (safeRole === "activity" ? "activity" : "message"),
    role: safeRole,
    source: cleanText(message.source),
    status: cleanText(message.status, "submitted"),
    text,
    title: cleanText(message.title),
  };
}

function normalizeThreadMessages(messages) {
  const normalized = [];
  const seen = new Set();

  (Array.isArray(messages) ? messages : []).forEach((message) => {
    const normalizedMessage = normalizeThreadMessage(message);
    if (!normalizedMessage || seen.has(normalizedMessage.id)) {
      return;
    }

    seen.add(normalizedMessage.id);
    normalized.push(normalizedMessage);
  });

  return normalized.slice(-MAX_THREAD_MESSAGES);
}

function appendThreadUserMessage(thread, event = {}) {
  const text = cleanMessageText(event.userMessage || event.message);
  if (!text) {
    return thread?.messages || [];
  }

  const messages = normalizeThreadMessages(thread?.messages);
  const id = cleanText(event.messageId, createRandomId(`message-${safeKey(thread?.id, "thread")}`));
  if (messages.some((message) => message.id === id)) {
    return messages;
  }
  const createdAt = cleanText(event.messageCreatedAt, nowIso());
  const createdMs = Date.parse(createdAt);
  const lastUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const lastUserMs = Date.parse(lastUserMessage?.createdAt || "");
  if (
    lastUserMessage?.text === text
    && Number.isFinite(createdMs)
    && Number.isFinite(lastUserMs)
    && Math.abs(createdMs - lastUserMs) < 2500
  ) {
    return messages;
  }

  return [
    ...messages,
    {
      createdAt,
      id,
      role: "user",
      status: "submitted",
      text,
    },
  ].slice(-MAX_THREAD_MESSAGES);
}

function defaultThreadTitle(terminalIndex, agentId) {
  const slot = Math.max(0, Number.parseInt(terminalIndex, 10) || 0) + 1;
  const agent = cleanAgentId(agentId, DEFAULT_AGENT_ID);
  const agentLabel = agent === "opencode"
    ? "OpenCode"
    : agent === "claude"
      ? "Claude"
      : agent === "generic"
        ? "Shell"
        : "Codex";

  return `${agentLabel} ${slot}`;
}

export function getWorkspaceThreadTitlePlaceholder(message, fallback = "New thread") {
  const text = cleanText(message, fallback);
  if (text.length <= 160) {
    return text;
  }

  return `${text.slice(0, 157).trim()}...`;
}

function normalizeCoordination(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      agentBranch: "",
      agentId: "",
      agentSlotId: "",
      coordinationMode: "",
      sessionId: "",
      worktreePath: "",
    };
  }

  return {
    agentBranch: cleanText(value.agentBranch),
    agentId: cleanText(value.agentId),
    agentSlotId: cleanText(value.agentSlotId),
    coordinationMode: cleanText(value.coordinationMode),
    sessionId: cleanText(value.sessionId),
    worktreePath: cleanText(value.worktreePath),
  };
}

function normalizeTerminalBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const paneId = cleanText(value.paneId);
  const instanceId = Number.parseInt(value.instanceId, 10);
  const terminalIndex = normalizeTerminalIndex(value.terminalIndex);

  if (!paneId || !Number.isInteger(instanceId) || instanceId <= 0) {
    return null;
  }

  return {
    instanceId,
    paneId,
    terminalIndex,
  };
}

function normalizeActiveTerminal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const terminalIndex = normalizeTerminalIndex(value.terminalIndex);
  const key = terminalSessionKey(terminalIndex);
  const paneId = cleanText(value.paneId);
  const instanceId = Number.parseInt(value.instanceId, 10);
  const status = cleanText(value.status, "idle").toLowerCase();
  const safeStatus = ["active", "closed", "error", "exited", "idle", "starting"].includes(status)
    ? status
    : "idle";

  if (!key) {
    return null;
  }

  return {
    agentId: cleanAgentId(value.agentId || value.currentAgent),
    instanceId: Number.isInteger(instanceId) && instanceId > 0 ? instanceId : 0,
    lastActiveAt: cleanText(value.lastActiveAt, value.updatedAt || nowIso()),
    paneId,
    slotKey: cleanText(value.slotKey, defaultSlotKey(terminalIndex)),
    status: safeStatus,
    terminalIndex,
    threadId: cleanText(value.threadId),
    updatedAt: cleanText(value.updatedAt, nowIso()),
    worktreePath: cleanText(value.worktreePath || value.coordination?.worktreePath),
  };
}

function normalizeProviderBinding(value, agentId, fallback = {}, options = {}) {
  const safeAgentId = cleanAgentId(agentId, "");
  if (!isThreadAgentId(safeAgentId)) {
    return null;
  }

  const binding = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const status = cleanText(binding.status, fallback.status || "idle").toLowerCase();
  const safeStatus = ["active", "closed", "error", "exited", "idle", "starting"].includes(status)
    ? status
    : "idle";
  const terminalBinding = options.stripLiveBindings
    ? null
    : normalizeTerminalBinding(binding.terminalBinding || fallback.terminalBinding);

  return {
    agentId: safeAgentId,
    coordination: normalizeCoordination(binding.coordination || fallback.coordination),
    activityStatus: options.stripLiveBindings
      ? "idle"
      : normalizeThreadActivityStatus(binding.activityStatus, fallback.activityStatus),
    lastActiveAt: cleanText(binding.lastActiveAt, fallback.lastActiveAt),
    lastMessageAt: cleanText(binding.lastMessageAt, fallback.lastMessageAt),
    messageCount: normalizeMessageCount(binding.messageCount ?? fallback.messageCount),
    modelId: cleanModelId(
      binding.modelId || binding.model || binding.activeModel,
      cleanModelId(fallback.modelId || fallback.model || fallback.activeModel),
    ),
    modelSource: cleanText(binding.modelSource, fallback.modelSource),
    modelUpdatedAt: cleanText(binding.modelUpdatedAt, fallback.modelUpdatedAt),
    nativeSessionId: cleanText(binding.nativeSessionId, fallback.nativeSessionId),
    nativeSessionKind: cleanText(binding.nativeSessionKind, fallback.nativeSessionKind || "session"),
    nativeSessionSource: cleanText(binding.nativeSessionSource, fallback.nativeSessionSource),
    nativeSessionUpdatedAt: cleanText(binding.nativeSessionUpdatedAt, fallback.nativeSessionUpdatedAt),
    status: options.stripLiveBindings && ["active", "starting"].includes(safeStatus) ? "idle" : safeStatus,
    terminalBinding,
    updatedAt: cleanText(binding.updatedAt, fallback.updatedAt || nowIso()),
  };
}

function normalizeProviderBindings(source, fallbackAgentId, fallback = {}, options = {}) {
  const normalized = {};
  const bindingsSource = source && typeof source === "object" && !Array.isArray(source) ? source : {};

  Object.entries(bindingsSource).forEach(([agentId, binding]) => {
    const safeAgentId = cleanAgentId(agentId || binding?.agentId, "");
    const normalizedBinding = normalizeProviderBinding(binding, safeAgentId, {}, options);
    if (!normalizedBinding) {
      return;
    }

    normalized[safeAgentId] = normalizedBinding;
  });

  const safeFallbackAgentId = cleanAgentId(fallbackAgentId, "");
  if (isThreadAgentId(safeFallbackAgentId)) {
    const existing = normalized[safeFallbackAgentId];
    const normalizedBinding = normalizeProviderBinding(
      existing,
      safeFallbackAgentId,
      fallback,
      options,
    );
    if (normalizedBinding) {
      normalized[safeFallbackAgentId] = normalizedBinding;
    }
  }

  return normalized;
}

function normalizeThread(thread, workspaceId, options = {}) {
  if (!thread || typeof thread !== "object" || Array.isArray(thread)) {
    return null;
  }

  const terminalIndex = normalizeTerminalIndex(thread.terminalIndex);
  const fallbackThreadId = terminalIndex == null
    ? createRandomId(`thread-${safeKey(workspaceId)}`)
    : defaultThreadId(workspaceId, terminalIndex);
  const id = cleanText(thread.id, fallbackThreadId);
  const preferredAgent = cleanAgentId(thread.preferredAgent || thread.currentAgent);
  const currentAgent = cleanAgentId(thread.currentAgent || preferredAgent);
  const createdAt = cleanText(thread.createdAt, nowIso());
  const updatedAt = cleanText(thread.updatedAt, createdAt);
  const messages = options.stripMessages ? [] : normalizeThreadMessages(thread.messages);
  const messageCount = Math.max(normalizeMessageCount(thread.messageCount), messages.length);
  const materialized = thread.materialized === true || messageCount > 0;
  const status = cleanText(thread.status, "idle").toLowerCase();
  const safeStatus = ["active", "closed", "error", "exited", "idle", "starting"].includes(status)
    ? status
    : "idle";
  const titleStatus = cleanText(thread.titleStatus, "ready").toLowerCase();
  const safeTitleStatus = ["error", "pending", "ready"].includes(titleStatus)
    ? titleStatus
    : "ready";
  const coordination = normalizeCoordination(thread.coordination);
  const terminalBinding = options.stripLiveBindings ? null : normalizeTerminalBinding(thread.terminalBinding);
  const providerBindings = normalizeProviderBindings(
    thread.providerBindings,
    currentAgent,
    {
      coordination,
      lastActiveAt: cleanText(thread.lastActiveAt, updatedAt),
      lastMessageAt: cleanText(thread.lastMessageAt),
      messageCount,
      status: safeStatus,
      terminalBinding,
      updatedAt,
    },
    options,
  );

  return {
    coordination,
    activityStatus: options.stripLiveBindings
      ? "idle"
      : normalizeThreadActivityStatus(thread.activityStatus, providerBindings[currentAgent]?.activityStatus),
    createdAt,
    currentAgent,
    id,
    lastActiveAt: cleanText(thread.lastActiveAt, updatedAt),
    lastMessageAt: cleanText(thread.lastMessageAt),
    materialized,
    messageCount,
    messages,
    preferredAgent,
    sessionName: cleanText(thread.sessionName, thread.title || defaultThreadTitle(terminalIndex || 0, currentAgent)),
    slotKey: cleanText(
      thread.slotKey,
      terminalIndex == null ? `thread-${safeKey(id, "detached")}` : defaultSlotKey(terminalIndex),
    ),
    status: options.stripLiveBindings && ["active", "starting"].includes(safeStatus) ? "idle" : safeStatus,
    providerBindings,
    terminalBinding,
    terminalIndex,
    title: cleanText(thread.title, defaultThreadTitle(terminalIndex || 0, currentAgent)),
    titleRequestId: cleanText(thread.titleRequestId),
    titleStatus: safeTitleStatus,
    transcriptHydratedAt: options.stripMessages ? "" : cleanText(thread.transcriptHydratedAt),
    transcriptLatestTimestamp: options.stripMessages ? "" : cleanText(thread.transcriptLatestTimestamp),
    transcriptSessionId: cleanText(thread.transcriptSessionId),
    transcriptSourcePath: options.stripMessages ? "" : cleanText(thread.transcriptSourcePath),
    transcriptStatus: options.stripMessages ? "idle" : cleanText(thread.transcriptStatus, "idle"),
    updatedAt,
    workspaceId,
  };
}

function normalizeWorkspaceEntry(entry, workspaceId, options = {}) {
  const threadsSource = entry?.threads && typeof entry.threads === "object" && !Array.isArray(entry.threads)
    ? entry.threads
    : {};
  const hasTerminalThreadIdsSource = entry?.terminalThreadIds
    && typeof entry.terminalThreadIds === "object"
    && !Array.isArray(entry.terminalThreadIds);
  const normalizedThreads = {};
  const normalizedOrder = [];
  const terminalSource = !options.stripLiveBindings
    && entry?.terminals
    && typeof entry.terminals === "object"
    && !Array.isArray(entry.terminals)
    ? entry.terminals
    : {};
  const normalizedTerminals = {};
  const normalizedTerminalOrder = [];

  Object.values(threadsSource).forEach((thread) => {
    const normalizedThread = normalizeThread(thread, workspaceId, options);
    if (!normalizedThread || !normalizedThread.materialized || normalizedThreads[normalizedThread.id]) {
      return;
    }

    normalizedThreads[normalizedThread.id] = normalizedThread;
  });

  const sourceOrder = Array.isArray(entry?.threadOrder) ? entry.threadOrder : [];
  sourceOrder.forEach((threadId) => {
    const safeThreadId = cleanText(threadId);
    if (safeThreadId && normalizedThreads[safeThreadId] && !normalizedOrder.includes(safeThreadId)) {
      normalizedOrder.push(safeThreadId);
    }
  });

  Object.keys(normalizedThreads).forEach((threadId) => {
    if (!normalizedOrder.includes(threadId)) {
      normalizedOrder.push(threadId);
    }
  });

  Object.values(terminalSource).forEach((terminal) => {
    const normalizedTerminal = normalizeActiveTerminal(terminal);
    const key = terminalSessionKey(normalizedTerminal?.terminalIndex);
    if (!normalizedTerminal || !key || normalizedTerminals[key]) {
      return;
    }

    normalizedTerminals[key] = normalizedTerminal;
  });

  const sourceTerminalOrder = Array.isArray(entry?.terminalOrder) ? entry.terminalOrder : [];
  sourceTerminalOrder.forEach((terminalIndex) => {
    const key = terminalSessionKey(terminalIndex);
    if (key && normalizedTerminals[key] && !normalizedTerminalOrder.includes(key)) {
      normalizedTerminalOrder.push(key);
    }
  });

  Object.keys(normalizedTerminals)
    .sort((left, right) => Number(left) - Number(right))
    .forEach((key) => {
      if (!normalizedTerminalOrder.includes(key)) {
        normalizedTerminalOrder.push(key);
      }
    });

  const normalizedTerminalThreadIds = normalizeTerminalThreadIds(entry?.terminalThreadIds, normalizedThreads);

  Object.values(normalizedTerminals).forEach((terminal) => {
    const key = terminalSessionKey(terminal?.terminalIndex);
    if (key && terminal?.threadId && normalizedThreads[terminal.threadId]) {
      normalizedTerminalThreadIds[key] = terminal.threadId;
    }
  });

  if (!hasTerminalThreadIdsSource) {
    Object.values(normalizedThreads)
      .sort((left, right) => getThreadRestoreTimestamp(right) - getThreadRestoreTimestamp(left))
      .forEach((thread) => {
        const key = terminalSessionKey(getThreadTerminalIndex(thread));
        if (key && !normalizedTerminalThreadIds[key]) {
          normalizedTerminalThreadIds[key] = thread.id;
        }
      });
  }

  const activeThreadId = cleanText(entry?.activeThreadId);

  return {
    activeThreadId: normalizedThreads[activeThreadId]
      ? activeThreadId
      : normalizedOrder[0] || "",
    terminalOrder: normalizedTerminalOrder,
    terminalThreadIds: normalizedTerminalThreadIds,
    terminals: normalizedTerminals,
    threadOrder: normalizedOrder.slice(0, MAX_THREADS_PER_WORKSPACE),
    threads: normalizedThreads,
  };
}

export function normalizeWorkspaceThreads(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([workspaceId, entry]) => {
        const safeWorkspaceId = cleanText(workspaceId);
        if (!safeWorkspaceId) {
          return null;
        }

        return [safeWorkspaceId, normalizeWorkspaceEntry(entry, safeWorkspaceId, options)];
      })
      .filter(Boolean),
  );
}

export function readWorkspaceThreads() {
  if (!hasStorage()) {
    return {};
  }

  try {
    return normalizeWorkspaceThreads(
      JSON.parse(window.localStorage.getItem(WORKSPACE_THREADS_STORAGE_KEY) || "{}"),
      { stripLiveBindings: true, stripMessages: true },
    );
  } catch {
    return {};
  }
}

export function persistWorkspaceThreads(threads) {
  if (!hasStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      WORKSPACE_THREADS_STORAGE_KEY,
      JSON.stringify(normalizeWorkspaceThreads(threads, { stripLiveBindings: true, stripMessages: true })),
    );
  } catch {
    // Thread metadata is recoverable convenience state.
  }
}

function ensureWorkspaceEntry(state, workspaceId) {
  const existing = normalizeWorkspaceEntry(state?.[workspaceId], workspaceId);
  return {
    activeThreadId: existing.activeThreadId,
    terminalOrder: existing.terminalOrder.slice(),
    terminalThreadIds: { ...existing.terminalThreadIds },
    terminals: { ...existing.terminals },
    threadOrder: existing.threadOrder.slice(),
    threads: { ...existing.threads },
  };
}

export function ensureWorkspaceThreadsForTerminalIndexes(state, options = {}) {
  const workspaceId = cleanText(options.workspaceId);
  if (!workspaceId) {
    return state || {};
  }

  const terminalIndexes = Array.isArray(options.terminalIndexes)
    ? options.terminalIndexes.map(normalizeTerminalIndex).filter((index) => index != null)
    : [];
  const rolesByIndex = options.rolesByIndex || {};
  const fallbackAgent = cleanAgentId(options.fallbackAgent, DEFAULT_AGENT_ID);
  const currentState = normalizeWorkspaceThreads(state);
  const entry = ensureWorkspaceEntry(currentState, workspaceId);
  let changed = !currentState[workspaceId];

  terminalIndexes.forEach((terminalIndex) => {
    const terminalKey = terminalSessionKey(terminalIndex);
    const existingTerminal = terminalKey ? entry.terminals[terminalKey] : null;
    const role = cleanAgentId(rolesByIndex[terminalIndex], fallbackAgent);
    const now = nowIso();

    if (existingTerminal && existingTerminal.agentId !== role && existingTerminal.status !== "active") {
      entry.terminals[terminalKey] = {
        ...existingTerminal,
        agentId: role,
        updatedAt: now,
      };
      changed = true;
      return;
    }
  });

  entry.threadOrder = entry.threadOrder.filter((threadId, index, order) => (
    entry.threads[threadId] && order.indexOf(threadId) === index
  ));
  entry.terminalOrder = entry.terminalOrder.filter((terminalKey, index, order) => (
    entry.terminals[terminalKey] && order.indexOf(terminalKey) === index
  ));

  if (!entry.activeThreadId || !entry.threads[entry.activeThreadId]) {
    const nextActiveThreadId = entry.threadOrder[0] || "";
    if (entry.activeThreadId !== nextActiveThreadId) {
      entry.activeThreadId = nextActiveThreadId;
      changed = true;
    }
  }

  if (!currentState[workspaceId]) {
    changed = true;
  }

  if (!changed) {
    return state || {};
  }

  return {
    ...currentState,
    [workspaceId]: entry,
  };
}

export function selectWorkspaceThread(state, workspaceId, threadId) {
  const safeWorkspaceId = cleanText(workspaceId);
  const safeThreadId = cleanText(threadId);
  const currentState = normalizeWorkspaceThreads(state);
  const entry = currentState[safeWorkspaceId]
    ? ensureWorkspaceEntry(currentState, safeWorkspaceId)
    : null;

  if (!entry || !entry.threads[safeThreadId]) {
    return state || {};
  }

  const thread = entry.threads[safeThreadId];
  const restoreChanged = rememberTerminalThread(entry, getThreadTerminalIndex(thread), safeThreadId);
  if (entry.activeThreadId === safeThreadId && !restoreChanged) {
    return state || {};
  }

  entry.activeThreadId = safeThreadId;

  return {
    ...currentState,
    [safeWorkspaceId]: entry,
  };
}

function getTerminalKeyForEvent(entry, event = {}) {
  const directKey = terminalSessionKey(event.terminalIndex);
  if (directKey) {
    return directKey;
  }

  const paneId = cleanText(event.paneId);
  const instanceId = Number.parseInt(event.instanceId, 10);
  const threadId = cleanText(event.threadId);

  return Object.entries(entry.terminals).find(([, terminal]) => (
    (paneId && terminal.paneId === paneId)
    || (Number.isInteger(instanceId) && instanceId > 0 && terminal.instanceId === instanceId)
    || (threadId && terminal.threadId === threadId)
  ))?.[0] || "";
}

function upsertActiveTerminal(entry, event = {}, options = {}) {
  const terminalIndex = normalizeTerminalIndex(event.terminalIndex);
  const key = terminalSessionKey(terminalIndex);
  if (!key) {
    return null;
  }

  const existing = entry.terminals[key] || {};
  const now = nowIso();
  const terminal = normalizeActiveTerminal({
    agentId: event.agentId || event.currentAgent || existing.agentId,
    instanceId: event.instanceId ?? existing.instanceId,
    lastActiveAt: now,
    paneId: event.paneId || existing.paneId,
    slotKey: event.slotKey || existing.slotKey || defaultSlotKey(terminalIndex),
    status: options.status || event.status || existing.status || "active",
    terminalIndex,
    threadId: options.threadId ?? event.threadId ?? existing.threadId,
    updatedAt: now,
    worktreePath: event.worktreePath || existing.worktreePath,
  });

  if (!terminal) {
    return null;
  }

  entry.terminals[key] = terminal;
  if (!entry.terminalOrder.includes(key)) {
    entry.terminalOrder.push(key);
  }
  if (terminal.threadId && entry.threads[terminal.threadId]) {
    rememberTerminalThread(entry, terminalIndex, terminal.threadId);
  }

  return terminal;
}

function bindExistingThreadToTerminal(entry, threadId, event = {}, options = {}) {
  const existing = entry.threads[threadId];
  if (!existing) {
    return false;
  }

  const terminalKey = getTerminalKeyForEvent(entry, {
    ...event,
    terminalIndex: event.terminalIndex ?? existing.terminalIndex,
    threadId,
  });
  const activeTerminal = terminalKey ? entry.terminals[terminalKey] : null;
  const terminalIndex = normalizeTerminalIndex(event.terminalIndex ?? activeTerminal?.terminalIndex ?? existing.terminalIndex);
  const now = nowIso();
  const agentId = cleanAgentId(
    event.agentId
      || event.currentAgent
      || activeTerminal?.agentId
      || existing.currentAgent,
  );
  const status = cleanText(options.status || event.status || "active").toLowerCase();
  const safeStatus = ["active", "closed", "error", "exited", "idle", "starting"].includes(status)
    ? status
    : "active";
  const terminalBinding = normalizeTerminalBinding({
    instanceId: event.instanceId ?? activeTerminal?.instanceId,
    paneId: event.paneId || activeTerminal?.paneId,
    terminalIndex,
  });
  const nextMessageCount = options.incrementMessageCount
    ? normalizeMessageCount(existing.messageCount) + 1
    : normalizeMessageCount(existing.messageCount);
  const coordination = {
    agentBranch: cleanText(event.agentBranch, existing.coordination?.agentBranch),
    agentId: cleanText(event.coordinationAgentId || event.agentCoordinationId, existing.coordination?.agentId),
    agentSlotId: cleanText(event.agentSlotId, existing.coordination?.agentSlotId),
    coordinationMode: cleanText(event.coordinationMode, existing.coordination?.coordinationMode),
    sessionId: cleanText(event.sessionId, existing.coordination?.sessionId),
    worktreePath: cleanText(event.worktreePath, activeTerminal?.worktreePath || existing.coordination?.worktreePath),
  };
  const existingProviderBindings = normalizeProviderBindings(
    existing.providerBindings,
    existing.currentAgent,
    {
      coordination: existing.coordination,
      lastActiveAt: existing.lastActiveAt,
      lastMessageAt: existing.lastMessageAt,
      messageCount: existing.messageCount,
      status: existing.status,
      terminalBinding: existing.terminalBinding,
      updatedAt: existing.updatedAt,
    },
  );
  const providerBinding = normalizeProviderBinding(existingProviderBindings[agentId], agentId, {
    coordination,
    lastActiveAt: now,
    lastMessageAt: options.incrementMessageCount ? now : existing.lastMessageAt,
    messageCount: nextMessageCount,
    status: safeStatus,
    terminalBinding,
    updatedAt: now,
  });
  const activityStatus = options.incrementMessageCount
    ? "thinking"
    : normalizeThreadActivityStatus(existing.activityStatus, providerBinding?.activityStatus);
  const providerBindings = {
    ...existingProviderBindings,
    [agentId]: {
      ...providerBinding,
      activityStatus,
      coordination,
      lastActiveAt: now,
      lastMessageAt: options.incrementMessageCount ? now : providerBinding?.lastMessageAt || existing.lastMessageAt,
      messageCount: nextMessageCount,
      modelId: cleanModelId(event.modelId || event.model, providerBinding?.modelId),
      modelSource: cleanModelId(event.modelId || event.model) ? cleanText(event.modelSource, "user") : providerBinding?.modelSource,
      modelUpdatedAt: cleanModelId(event.modelId || event.model) ? now : providerBinding?.modelUpdatedAt || "",
      nativeSessionId: cleanText(event.nativeSessionId, providerBinding?.nativeSessionId),
      nativeSessionKind: cleanText(event.nativeSessionKind, providerBinding?.nativeSessionKind || "session"),
      nativeSessionSource: cleanText(event.nativeSessionSource, providerBinding?.nativeSessionSource),
      nativeSessionUpdatedAt: event.nativeSessionId ? now : providerBinding?.nativeSessionUpdatedAt || "",
      status: safeStatus,
      terminalBinding,
      updatedAt: now,
    },
  };

  entry.threads[threadId] = {
    ...existing,
    activityStatus,
    coordination,
    currentAgent: agentId,
    lastActiveAt: now,
    lastMessageAt: options.incrementMessageCount ? now : existing.lastMessageAt,
    materialized: true,
    messageCount: nextMessageCount,
    messages: existing.messages,
    preferredAgent: cleanAgentId(event.preferredAgent || existing.preferredAgent || agentId),
    providerBindings,
    sessionName: cleanText(event.sessionName || event.title, existing.sessionName || existing.title),
    slotKey: cleanText(event.slotKey || activeTerminal?.slotKey, existing.slotKey),
    status: safeStatus,
    terminalBinding,
    terminalIndex,
    title: cleanText(event.title, existing.title),
    titleRequestId: cleanText(event.titleRequestId, existing.titleRequestId),
    titleStatus: event.titleRequestId ? "pending" : existing.titleStatus,
    updatedAt: now,
  };

  if (terminalKey && entry.terminals[terminalKey]) {
    entry.terminals[terminalKey] = {
      ...entry.terminals[terminalKey],
      agentId,
      lastActiveAt: now,
      status: safeStatus,
      threadId,
      updatedAt: now,
    };
  }

  rememberTerminalThread(entry, terminalIndex, threadId);
  entry.activeThreadId = threadId;
  return true;
}

export function updateWorkspaceActiveTerminal(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  if (!workspaceId) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = ensureWorkspaceEntry(currentState, workspaceId);
  const threadId = cleanText(event.threadId);
  const terminal = upsertActiveTerminal(entry, event, {
    status: event.status || "active",
    threadId: entry.threads[threadId] ? threadId : "",
  });

  if (terminal && threadId && entry.threads[threadId]) {
    bindExistingThreadToTerminal(entry, threadId, event, { status: event.status || "active" });
  }

  return {
    ...currentState,
    [workspaceId]: entry,
  };
}

export function materializeWorkspaceThreadForTerminal(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const terminalIndex = normalizeTerminalIndex(event.terminalIndex);
  if (!workspaceId || terminalIndex == null) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = ensureWorkspaceEntry(currentState, workspaceId);
  const terminalKey = terminalSessionKey(terminalIndex);
  const existingTerminal = terminalKey ? entry.terminals[terminalKey] : null;
  const existingThreadId = cleanText(event.threadId || existingTerminal?.threadId);
  const now = nowIso();
  const agentId = cleanAgentId(event.agentId || existingTerminal?.agentId || DEFAULT_AGENT_ID);
  const threadId = existingThreadId || createThreadIdForTerminal(workspaceId, terminalIndex);
  const titlePlaceholder = getWorkspaceThreadTitlePlaceholder(
    event.title || event.userMessage,
    defaultThreadTitle(terminalIndex, agentId),
  );
  const previousThread = entry.threads[threadId] || null;
  const previousMessages = normalizeThreadMessages(previousThread?.messages);
  const previousActivityStatus = normalizeThreadActivityStatus(previousThread?.activityStatus);

  upsertActiveTerminal(entry, event, {
    status: event.status || "active",
    threadId,
  });

  if (!entry.threads[threadId]) {
    entry.threads[threadId] = {
      coordination: normalizeCoordination(null),
      createdAt: now,
      currentAgent: agentId,
      id: threadId,
      lastActiveAt: now,
      lastMessageAt: now,
      materialized: true,
      messageCount: 0,
      messages: [],
      preferredAgent: agentId,
      providerBindings: isThreadAgentId(agentId)
        ? {
          [agentId]: normalizeProviderBinding(null, agentId, {
            lastActiveAt: now,
            lastMessageAt: now,
            messageCount: 0,
            status: "active",
            updatedAt: now,
          }),
        }
        : {},
      sessionName: titlePlaceholder,
      slotKey: cleanText(event.slotKey || existingTerminal?.slotKey, defaultSlotKey(terminalIndex)),
      status: "active",
      terminalBinding: null,
      terminalIndex,
      title: titlePlaceholder,
      titleRequestId: cleanText(event.titleRequestId),
      titleStatus: event.titleRequestId ? "pending" : "ready",
      updatedAt: now,
      workspaceId,
    };
    entry.threadOrder.push(threadId);
  }

  bindExistingThreadToTerminal(entry, threadId, event, {
    incrementMessageCount: true,
    status: event.status || "active",
  });
  if (entry.threads[threadId]) {
    const messages = appendThreadUserMessage(entry.threads[threadId], event);
    const messageAdded = messages.length > previousMessages.length;
    const activityStatus = messageAdded
      ? entry.threads[threadId].activityStatus
      : previousActivityStatus;
    const providerBindings = normalizeProviderBindings(
      entry.threads[threadId].providerBindings,
      entry.threads[threadId].currentAgent,
      {
        activityStatus,
        coordination: entry.threads[threadId].coordination,
        lastActiveAt: entry.threads[threadId].lastActiveAt,
        lastMessageAt: entry.threads[threadId].lastMessageAt,
        messageCount: messages.length,
        status: entry.threads[threadId].status,
        terminalBinding: entry.threads[threadId].terminalBinding,
        updatedAt: entry.threads[threadId].updatedAt,
      },
    );
    if (isThreadAgentId(agentId) && providerBindings[agentId]) {
      providerBindings[agentId] = {
        ...providerBindings[agentId],
        activityStatus,
      };
    }
    entry.threads[threadId] = {
      ...entry.threads[threadId],
      activityStatus,
      lastMessageAt: messages.length ? messages[messages.length - 1].createdAt : entry.threads[threadId].lastMessageAt,
      messageCount: messages.length,
      messages,
      providerBindings,
    };
  }
  entry.threadOrder = entry.threadOrder.filter((candidateId, index, order) => (
    entry.threads[candidateId] && order.indexOf(candidateId) === index
  )).slice(0, MAX_THREADS_PER_WORKSPACE);

  return {
    ...currentState,
    [workspaceId]: entry,
  };
}

export function bindWorkspaceThreadTerminal(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const threadId = cleanText(event.threadId);
  if (!workspaceId || !threadId) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = ensureWorkspaceEntry(currentState, workspaceId);
  if (!entry.threads[threadId]) {
    return state || {};
  }

  upsertActiveTerminal(entry, event, {
    status: event.status || "active",
    threadId,
  });
  bindExistingThreadToTerminal(entry, threadId, event, { status: event.status || "active" });

  return {
    ...currentState,
    [workspaceId]: entry,
  };
}

export function markWorkspaceThreadTerminalDetached(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  if (!workspaceId) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = ensureWorkspaceEntry(currentState, workspaceId);
  const terminalKey = getTerminalKeyForEvent(entry, event);
  const terminal = terminalKey ? entry.terminals[terminalKey] : null;
  const threadId = cleanText(event.threadId || terminal?.threadId);
  const existing = threadId ? entry.threads[threadId] : null;
  const terminalIndex = normalizeTerminalIndex(
    event.terminalIndex ?? terminal?.terminalIndex ?? existing?.terminalIndex,
  );

  if (!existing && !terminal) {
    return state || {};
  }

  const now = nowIso();
  const status = cleanText(event.status, "closed").toLowerCase();
  const safeStatus = ["closed", "error", "exited", "idle", "starting"].includes(status)
    ? status
    : "closed";

  if (terminalKey) {
    delete entry.terminals[terminalKey];
    entry.terminalOrder = entry.terminalOrder.filter((key) => key !== terminalKey);
  }

  if (event.rememberTerminalThread === false || event.forgetTerminalThread) {
    forgetTerminalThread(entry, terminalIndex, threadId);
  } else if (existing) {
    rememberTerminalThread(entry, terminalIndex, threadId);
  }

  if (existing) {
    const agentId = cleanAgentId(event.agentId || terminal?.agentId || existing.currentAgent, "");
    const providerBindings = normalizeProviderBindings(
      existing.providerBindings,
      existing.currentAgent,
      {
        coordination: existing.coordination,
        lastActiveAt: existing.lastActiveAt,
        lastMessageAt: existing.lastMessageAt,
        messageCount: existing.messageCount,
        status: existing.status,
        terminalBinding: existing.terminalBinding,
        updatedAt: existing.updatedAt,
      },
    );
    if (isThreadAgentId(agentId)) {
      providerBindings[agentId] = {
        ...normalizeProviderBinding(providerBindings[agentId], agentId, {
          activityStatus: "idle",
          coordination: existing.coordination,
          lastActiveAt: existing.lastActiveAt,
          lastMessageAt: existing.lastMessageAt,
          messageCount: existing.messageCount,
          status: safeStatus,
          terminalBinding: null,
          updatedAt: now,
        }),
        activityStatus: "idle",
        status: safeStatus,
        terminalBinding: null,
        updatedAt: now,
      };
    }

    entry.threads[threadId] = {
      ...existing,
      activityStatus: "idle",
      providerBindings,
      status: safeStatus,
      terminalBinding: null,
      updatedAt: now,
    };
  }

  return {
    ...currentState,
    [workspaceId]: entry,
  };
}

export function updateWorkspaceThreadAgent(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const threadId = cleanText(event.threadId);
  const agentId = cleanAgentId(event.agentId);
  if (!workspaceId || !threadId) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = currentState[workspaceId]
    ? ensureWorkspaceEntry(currentState, workspaceId)
    : null;
  const existing = entry?.threads?.[threadId];
  if (!existing) {
    return state || {};
  }
  const now = nowIso();
  const providerBindings = normalizeProviderBindings(
    existing.providerBindings,
    existing.currentAgent,
    {
      coordination: existing.coordination,
      lastActiveAt: existing.lastActiveAt,
      lastMessageAt: existing.lastMessageAt,
      messageCount: existing.messageCount,
      status: existing.status,
      terminalBinding: existing.terminalBinding,
      updatedAt: existing.updatedAt,
    },
  );
  const currentAgent = cleanAgentId(existing.currentAgent, "");
  if (isThreadAgentId(currentAgent) && currentAgent !== agentId) {
    providerBindings[currentAgent] = {
      ...normalizeProviderBinding(providerBindings[currentAgent], currentAgent, {
        activityStatus: "idle",
        coordination: existing.coordination,
        lastActiveAt: existing.lastActiveAt,
        lastMessageAt: existing.lastMessageAt,
        messageCount: existing.messageCount,
        status: "closed",
        terminalBinding: null,
        updatedAt: now,
      }),
      activityStatus: "idle",
      status: "closed",
      terminalBinding: null,
      updatedAt: now,
    };
  }
  if (isThreadAgentId(agentId)) {
    providerBindings[agentId] = {
      ...normalizeProviderBinding(providerBindings[agentId], agentId, {
        activityStatus: "idle",
        coordination: existing.coordination,
        lastActiveAt: now,
        lastMessageAt: existing.lastMessageAt,
        messageCount: existing.messageCount,
        status: event.status || "starting",
        terminalBinding: null,
        updatedAt: now,
      }),
      activityStatus: "idle",
      lastActiveAt: now,
      status: event.status || "starting",
      terminalBinding: null,
      updatedAt: now,
    };
  }
  const terminalIndex = normalizeTerminalIndex(event.terminalIndex ?? existing.terminalIndex);
  rememberTerminalThread(entry, terminalIndex, threadId);
  entry.activeThreadId = threadId;
  entry.threads[threadId] = {
    ...existing,
    activityStatus: "idle",
    currentAgent: agentId,
    preferredAgent: agentId,
    providerBindings,
    status: event.status || existing.status,
    terminalBinding: event.status === "starting" ? null : existing.terminalBinding,
    terminalIndex,
    updatedAt: now,
  };

  return {
    ...currentState,
    [workspaceId]: entry,
  };
}

export function updateWorkspaceThreadTitle(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const threadId = cleanText(event.threadId);
  const title = cleanText(event.title);
  if (!workspaceId || !threadId || !title) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = currentState[workspaceId];
  const existing = entry?.threads?.[threadId];
  if (!existing) {
    return state || {};
  }

  const titleRequestId = cleanText(event.titleRequestId);
  if (
    titleRequestId
    && existing.titleRequestId
    && existing.titleRequestId !== titleRequestId
  ) {
    return state || {};
  }

  return {
    ...currentState,
    [workspaceId]: {
      ...entry,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          sessionName: title,
          title,
          titleRequestId: titleRequestId || existing.titleRequestId,
          titleStatus: event.status === "error" ? "error" : "ready",
          updatedAt: nowIso(),
        },
      },
    },
  };
}

export function updateWorkspaceThreadProviderSession(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const threadId = cleanText(event.threadId);
  const agentId = cleanAgentId(event.agentId || event.currentAgent, "");
  const nativeSessionId = cleanText(event.nativeSessionId || event.providerSessionId);
  if (!workspaceId || !threadId || !isThreadAgentId(agentId) || !nativeSessionId) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = currentState[workspaceId];
  const existing = entry?.threads?.[threadId];
  if (!existing) {
    return state || {};
  }

  const now = nowIso();
  const providerBindings = normalizeProviderBindings(
    existing.providerBindings,
    existing.currentAgent,
    {
      coordination: existing.coordination,
      lastActiveAt: existing.lastActiveAt,
      lastMessageAt: existing.lastMessageAt,
      messageCount: existing.messageCount,
      status: existing.status,
      terminalBinding: existing.terminalBinding,
      updatedAt: existing.updatedAt,
    },
  );
  const modelId = cleanModelId(event.modelId || event.model);
  providerBindings[agentId] = {
    ...normalizeProviderBinding(providerBindings[agentId], agentId, {
      coordination: existing.coordination,
      lastActiveAt: existing.lastActiveAt,
      lastMessageAt: existing.lastMessageAt,
      messageCount: existing.messageCount,
      status: existing.status,
      terminalBinding: existing.terminalBinding,
      updatedAt: existing.updatedAt,
    }),
    modelId: modelId || providerBindings[agentId]?.modelId || "",
    modelSource: modelId ? cleanText(event.modelSource, "session") : providerBindings[agentId]?.modelSource || "",
    modelUpdatedAt: modelId ? now : providerBindings[agentId]?.modelUpdatedAt || "",
    nativeSessionId,
    nativeSessionKind: cleanText(event.nativeSessionKind, "session"),
    nativeSessionSource: cleanText(event.nativeSessionSource, "terminal-output"),
    nativeSessionUpdatedAt: now,
    updatedAt: now,
  };

  return {
    ...currentState,
    [workspaceId]: {
      ...entry,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          providerBindings,
          transcriptSessionId: nativeSessionId || existing.transcriptSessionId,
          updatedAt: now,
        },
      },
    },
  };
}

export function updateWorkspaceThreadProviderModel(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const threadId = cleanText(event.threadId);
  const agentId = cleanAgentId(event.agentId || event.currentAgent, "");
  const modelId = cleanModelId(event.modelId || event.model);
  if (!workspaceId || !threadId || !isThreadAgentId(agentId) || !modelId) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = currentState[workspaceId];
  const existing = entry?.threads?.[threadId];
  if (!existing) {
    return state || {};
  }

  const now = nowIso();
  const providerBindings = normalizeProviderBindings(
    existing.providerBindings,
    existing.currentAgent,
    {
      coordination: existing.coordination,
      lastActiveAt: existing.lastActiveAt,
      lastMessageAt: existing.lastMessageAt,
      messageCount: existing.messageCount,
      status: existing.status,
      terminalBinding: existing.terminalBinding,
      updatedAt: existing.updatedAt,
    },
  );
  providerBindings[agentId] = {
    ...normalizeProviderBinding(providerBindings[agentId], agentId, {
      coordination: existing.coordination,
      lastActiveAt: existing.lastActiveAt,
      lastMessageAt: existing.lastMessageAt,
      messageCount: existing.messageCount,
      status: existing.status,
      terminalBinding: existing.currentAgent === agentId ? existing.terminalBinding : null,
      updatedAt: existing.updatedAt,
    }),
    modelId,
    modelSource: cleanText(event.modelSource, "user"),
    modelUpdatedAt: now,
    updatedAt: now,
  };

  return {
    ...currentState,
    [workspaceId]: {
      ...entry,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          providerBindings,
          updatedAt: now,
        },
      },
    },
  };
}

function threadMessageSortTime(message, fallbackIndex) {
  const createdAt = String(message?.createdAt || "").trim();
  const numericTimestamp = Number.parseFloat(createdAt);
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 1_000_000_000) {
    return numericTimestamp;
  }
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER - fallbackIndex;
}

function threadMessageMergeKey(message) {
  const role = cleanText(message?.role);
  const kind = cleanText(message?.kind, "message");
  const callId = cleanText(message?.callId);
  const text = cleanMessageText(message?.text);
  if (callId) {
    return `${role}:${kind}:${callId}:${text}`;
  }
  return `${role}:${kind}:${text}`;
}

function mergeThreadSessionMessages(existingMessages, incomingMessages) {
  const incoming = normalizeThreadMessages(incomingMessages);
  const existing = normalizeThreadMessages(existingMessages);
  const byKey = new Map();

  incoming.forEach((message, index) => {
    const key = threadMessageMergeKey(message);
    if (!key || byKey.has(key)) {
      return;
    }
    byKey.set(key, { ...message, __mergeIndex: index });
  });

  existing.forEach((message, index) => {
    const key = threadMessageMergeKey(message);
    if (!key || byKey.has(key)) {
      return;
    }
    byKey.set(key, { ...message, __mergeIndex: incoming.length + index });
  });

  return Array.from(byKey.values())
    .sort((left, right) => (
      threadMessageSortTime(left, left.__mergeIndex) - threadMessageSortTime(right, right.__mergeIndex)
      || left.__mergeIndex - right.__mergeIndex
    ))
    .map(({ __mergeIndex, ...message }) => message)
    .slice(-MAX_THREAD_MESSAGES);
}

export function hydrateWorkspaceThreadSessionTranscript(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const threadId = cleanText(event.threadId);
  const agentId = cleanAgentId(event.agentId || event.currentAgent || "codex", "");
  if (!workspaceId || !threadId || !isThreadAgentId(agentId)) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = currentState[workspaceId];
  const existing = entry?.threads?.[threadId];
  if (!existing) {
    return state || {};
  }

  const now = nowIso();
  const sessionId = cleanText(event.sessionId || event.providerSessionId || event.nativeSessionId);
  const sessionTitle = cleanText(event.sessionTitle);
  const messages = mergeThreadSessionMessages(existing.messages, event.messages);
  const lastMessageAt = messages.length
    ? messages[messages.length - 1].createdAt
    : existing.lastMessageAt;
  const providerBindings = normalizeProviderBindings(
    existing.providerBindings,
    existing.currentAgent,
    {
      activityStatus: "idle",
      coordination: existing.coordination,
      lastActiveAt: existing.lastActiveAt,
      lastMessageAt,
      messageCount: messages.length,
      status: existing.status,
      terminalBinding: existing.terminalBinding,
      updatedAt: now,
    },
  );

  if (sessionId && providerBindings[agentId]) {
    providerBindings[agentId] = {
      ...providerBindings[agentId],
      nativeSessionId: sessionId,
      nativeSessionKind: "session",
      nativeSessionSource: cleanText(event.source, "codex-rollout"),
      nativeSessionUpdatedAt: now,
      updatedAt: now,
    };
  }

  return {
    ...currentState,
    [workspaceId]: {
      ...entry,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          activityStatus: "idle",
          lastMessageAt,
          materialized: true,
          messageCount: messages.length,
          messages,
          providerBindings,
          sessionName: sessionTitle || existing.sessionName || existing.title,
          transcriptHydratedAt: now,
          transcriptLatestTimestamp: cleanText(event.latestTimestamp),
          transcriptSessionId: sessionId || existing.transcriptSessionId,
          transcriptSourcePath: cleanText(event.sourcePath || event.rolloutPath),
          transcriptStatus: "ready",
          updatedAt: now,
        },
      },
    },
  };
}

export function markWorkspaceThreadAgentActivity(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const threadId = cleanText(event.threadId);
  const agentId = cleanAgentId(event.agentId || event.currentAgent, "");
  if (!workspaceId || !threadId || !isThreadAgentId(agentId)) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = currentState[workspaceId];
  const existing = entry?.threads?.[threadId];
  if (!existing) {
    return state || {};
  }

  const now = nowIso();
  const activityStatus = normalizeThreadActivityStatus(event.activityStatus);
  const providerBindings = normalizeProviderBindings(
    existing.providerBindings,
    existing.currentAgent,
    {
      activityStatus: existing.activityStatus,
      coordination: existing.coordination,
      lastActiveAt: existing.lastActiveAt,
      lastMessageAt: existing.lastMessageAt,
      messageCount: existing.messageCount,
      status: existing.status,
      terminalBinding: existing.terminalBinding,
      updatedAt: existing.updatedAt,
    },
  );
  providerBindings[agentId] = {
    ...normalizeProviderBinding(providerBindings[agentId], agentId, {
      activityStatus: existing.activityStatus,
      coordination: existing.coordination,
      lastActiveAt: existing.lastActiveAt,
      lastMessageAt: existing.lastMessageAt,
      messageCount: existing.messageCount,
      status: existing.status,
      terminalBinding: existing.currentAgent === agentId ? existing.terminalBinding : null,
      updatedAt: existing.updatedAt,
    }),
    activityStatus,
    updatedAt: now,
  };

  return {
    ...currentState,
    [workspaceId]: {
      ...entry,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          activityStatus: existing.currentAgent === agentId ? activityStatus : existing.activityStatus,
          providerBindings,
          updatedAt: now,
        },
      },
    },
  };
}

export function getWorkspaceThreadForTerminalIndex(state, workspaceId, terminalIndex) {
  const entry = normalizeWorkspaceThreads(state)[workspaceId];
  if (!entry) {
    return null;
  }

  const terminalKey = terminalSessionKey(terminalIndex);
  const terminal = terminalKey ? entry.terminals[terminalKey] : null;
  if (terminal?.threadId && entry.threads[terminal.threadId]) {
    return entry.threads[terminal.threadId];
  }

  const restoredThreadId = terminalKey ? entry.terminalThreadIds?.[terminalKey] : "";
  if (restoredThreadId && entry.threads[restoredThreadId]) {
    return entry.threads[restoredThreadId];
  }

  const activeThread = entry.threads[entry.activeThreadId];
  if (
    activeThread?.terminalBinding?.terminalIndex === terminalIndex
    || (activeThread?.terminalIndex === terminalIndex && activeThread.status === "starting")
  ) {
    return activeThread;
  }

  return Object.values(entry.threads)
    .filter((thread) => (
      thread.terminalBinding?.terminalIndex === terminalIndex
      || (thread.terminalIndex === terminalIndex && thread.status === "starting")
    ))
    .sort((left, right) => getThreadRestoreTimestamp(right) - getThreadRestoreTimestamp(left))[0] || null;
}

export function getWorkspaceThreadsByTerminalIndex(state, workspaceId, terminalIndexes = []) {
  const entry = normalizeWorkspaceThreads(state)[workspaceId];
  const byIndex = {};

  if (!entry) {
    return byIndex;
  }

  terminalIndexes.forEach((terminalIndex) => {
    const thread = getWorkspaceThreadForTerminalIndex(state, workspaceId, terminalIndex);
    if (thread) {
      byIndex[terminalIndex] = thread;
    }
  });

  return byIndex;
}

export function deleteWorkspaceThread(state, workspaceId, threadId) {
  const safeWorkspaceId = cleanText(workspaceId);
  const safeThreadId = cleanText(threadId);
  if (!safeWorkspaceId || !safeThreadId) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = ensureWorkspaceEntry(currentState, safeWorkspaceId);
  if (!entry.threads[safeThreadId]) {
    return state || {};
  }

  delete entry.threads[safeThreadId];
  forgetThreadEverywhere(entry, safeThreadId);
  entry.threadOrder = entry.threadOrder.filter((candidateId) => candidateId !== safeThreadId);
  Object.entries(entry.terminals).forEach(([terminalKey, terminal]) => {
    if (terminal.threadId === safeThreadId) {
      entry.terminals[terminalKey] = {
        ...terminal,
        threadId: "",
        updatedAt: nowIso(),
      };
    }
  });
  if (entry.activeThreadId === safeThreadId) {
    entry.activeThreadId = entry.threadOrder[0] || "";
  }

  return {
    ...currentState,
    [safeWorkspaceId]: entry,
  };
}

export function getWorkspaceThreadLabel(thread) {
  return cleanText(thread?.title, "Thread");
}

export function getWorkspaceThreadProviderBinding(thread, agentId) {
  const safeAgentId = cleanAgentId(agentId || thread?.currentAgent, "");
  if (!thread || !isThreadAgentId(safeAgentId)) {
    return null;
  }

  return normalizeProviderBinding(thread.providerBindings?.[safeAgentId], safeAgentId, {
    coordination: thread.coordination,
    lastActiveAt: thread.lastActiveAt,
    lastMessageAt: thread.lastMessageAt,
    messageCount: thread.messageCount,
    status: thread.status,
    terminalBinding: thread.currentAgent === safeAgentId ? thread.terminalBinding : null,
    updatedAt: thread.updatedAt,
  });
}

export { THREAD_AGENT_IDS, WORKSPACE_THREADS_STORAGE_KEY };

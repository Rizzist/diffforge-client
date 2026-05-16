import {
  cleanLiveViewText,
  stripLiveViewControlSequences,
} from "../terminals/liveViewSanitizer.js";

const WORKSPACE_THREADS_STORAGE_KEY = "diffforge.workspaceThreads.v1";
const MAX_THREAD_PROJECTION_EVENTS = 900;
const MAX_THREAD_MESSAGES = 360;
const MAX_THREADS_PER_WORKSPACE = 80;
const THREAD_PROMPT_LABEL_MAX_WORDS = 6;
const THREAD_PROMPT_LABEL_MAX_CHARS = 48;
const THREAD_PROMPT_LABEL_ELLIPSIS = "...";
const DEFAULT_AGENT_ID = "codex";
const THREAD_AGENT_IDS = ["codex", "claude", "opencode"];
const THREAD_PROJECTION_EVENT_TYPES = new Set([
  "thread.activity",
  "thread.file",
  "thread.message.assistant.complete",
  "thread.message.assistant.delta",
  "thread.message.system",
  "thread.message.user",
  "thread.patch",
  "thread.reasoning",
  "thread.tool_call",
  "thread.tool_output",
  "thread.turn.completed",
  "thread.turn.error",
  "thread.turn.interrupted",
  "thread.turn.started",
]);
const THREAD_TURN_STATES = new Set(["completed", "error", "interrupted", "running"]);

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

function cleanTerminalUiText(value, fallback = "") {
  const stripped = stripLiveViewControlSequences(value);
  const text = cleanLiveViewText(stripped)
    .replace(/\\?\]?(?:10|11);rgb:[0-9a-fA-F/]+/g, " ")
    .replace(/\brgb:[0-9a-fA-F/]+\b/g, " ");

  return cleanText(text, fallback);
}

function isTerminalArtifactLabel(value) {
  const text = cleanText(value).toLowerCase();
  return !text
    || /\\?\]?(?:10|11);rgb:[0-9a-f/]+/.test(text)
    || /\brgb:[0-9a-f/]+\b/.test(text)
    || text === "openai codex";
}

function isTerminalArtifactMessage(value) {
  const text = cleanMessageText(value);
  return !text
    || isTerminalArtifactLabel(text);
}

function cleanSubmittedUserMessage(value) {
  const text = cleanMessageText(value);
  if (!text) {
    return "";
  }

  const stripped = cleanMessageText(stripLiveViewControlSequences(value));
  const promptText = stripped
    .replace(/^(?:[›>❯]\s*)+/, "")
    .replace(/^•\s+.*?[›❯]\s*/, "")
    .trim();
  if (promptText && promptText !== stripped && !isTerminalArtifactMessage(promptText)) {
    return promptText;
  }

  if (!isTerminalArtifactMessage(value)) {
    return text;
  }

  return promptText && !isTerminalArtifactMessage(promptText) ? promptText : "";
}

function cleanThreadLabelCandidate(value) {
  const text = cleanTerminalUiText(value);
  return isTerminalArtifactLabel(text) ? "" : limitThreadPromptLabel(text, "");
}

function isLikelyNativeSessionIdLabel(value) {
  const text = cleanText(value);
  if (!text) {
    return false;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)
    || /^ses_[A-Za-z0-9_-]{12,}$/.test(text)
    || /^[0-9a-f]{24,}$/i.test(text)
    || (/^[A-Za-z0-9_-]{24,}$/.test(text) && !/\s/.test(text));
}

function limitThreadPromptLabel(value, fallback = "New thread") {
  const text = cleanText(value, fallback);
  const chars = Array.from(text);
  if (chars.length <= THREAD_PROMPT_LABEL_MAX_CHARS) {
    return text;
  }

  const sliceLength = Math.max(0, THREAD_PROMPT_LABEL_MAX_CHARS - THREAD_PROMPT_LABEL_ELLIPSIS.length);
  const truncated = chars
    .slice(0, sliceLength)
    .join("")
    .trim()
    .replace(/[.,!?;:]+$/g, "")
    .trim();

  return `${truncated || chars.slice(0, sliceLength).join("")}${THREAD_PROMPT_LABEL_ELLIPSIS}`;
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

function normalizePendingPrompt(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const text = cleanMessageText(value.text || value.message);
  if (!text) {
    return null;
  }

  return {
    createdAt: cleanText(value.createdAt, nowIso()),
    id: cleanText(value.id, createRandomId("pending-prompt")),
    model: cleanModelId(value.model),
    text,
  };
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

function normalizeThreadsViewState(value, fallback = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    newChatActive: source.newChatActive === true,
    railCollapsed: source.railCollapsed === true,
    selectedThreadId: cleanText(
      source.selectedThreadId
        || source.threadId
        || fallback.selectedThreadId
        || fallback.threadId,
    ),
    selectedWorkspaceId: cleanText(
      source.selectedWorkspaceId
        || source.workspaceId
        || fallback.selectedWorkspaceId
        || fallback.workspaceId,
    ),
  };
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

function normalizeThreadTurnState(value, fallback = "") {
  const state = cleanText(value, fallback).toLowerCase();
  return THREAD_TURN_STATES.has(state) ? state : "";
}

function normalizeThreadLatestTurn(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const turnId = cleanText(value.turnId || value.turn_id || value.id);
  const state = normalizeThreadTurnState(value.state || value.status || value.turnState || value.turn_state);
  if (!turnId || !state) {
    return null;
  }

  const requestedAt = cleanText(value.requestedAt || value.requested_at || value.createdAt || value.created_at);
  const startedAt = cleanText(value.startedAt || value.started_at || requestedAt);
  const completedAt = cleanText(value.completedAt || value.completed_at);
  const updatedAt = cleanText(value.updatedAt || value.updated_at || completedAt || startedAt || requestedAt, nowIso());

  return {
    agentId: cleanAgentId(value.agentId || value.agent_id, ""),
    assistantMessageId: cleanText(value.assistantMessageId || value.assistant_message_id),
    completedAt,
    error: cleanText(value.error || value.message),
    messageId: cleanText(value.messageId || value.message_id),
    requestedAt,
    startedAt,
    state,
    turnId,
    updatedAt,
  };
}

function createTurnIdForMessage(thread, messageId) {
  return [
    "turn",
    safeKey(thread?.id || thread?.threadId || "thread"),
    safeKey(messageId, "message"),
  ].join("-");
}

function activityStatusForLatestTurn(latestTurn, fallback = "idle") {
  const normalizedTurn = normalizeThreadLatestTurn(latestTurn);
  if (normalizedTurn?.state === "running") {
    return "thinking";
  }

  return normalizeThreadActivityStatus(fallback);
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
  const source = cleanText(message.source);
  const text = cleanMessageText(message.text || message.message);
  const status = cleanText(message.status, "submitted");
  const isTurnCompleteMessage = safeRole === "assistant"
    && (
      kind === "task_complete"
      || kind === "final_answer"
      || status.toLowerCase() === "task_complete"
    );
  if (
    !id
    || (!text && !isTurnCompleteMessage)
    || kind === "live_output"
    || source === "terminal-live"
    || (safeRole === "user" && isTerminalArtifactMessage(message.text || message.message))
  ) {
    return null;
  }

  return {
    agentId: cleanAgentId(message.agentId || message.agent_id, ""),
    callId: cleanText(message.callId || message.call_id),
    createdAt: cleanText(message.createdAt || message.created_at, nowIso()),
    id,
    kind: kind || (safeRole === "activity" ? "activity" : "message"),
    role: safeRole,
    source,
    status,
    text,
    title: cleanText(message.title),
    turnId: cleanText(message.turnId || message.turn_id),
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

function stableProjectionHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function normalizeProjectionEventType(value) {
  const type = cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-");
  return THREAD_PROJECTION_EVENT_TYPES.has(type) ? type : "";
}

function isActivityProjectionEventType(type) {
  return [
    "thread.activity",
    "thread.file",
    "thread.patch",
    "thread.reasoning",
    "thread.tool_call",
    "thread.tool_output",
  ].includes(type);
}

function isTurnProjectionEventType(type) {
  return [
    "thread.turn.completed",
    "thread.turn.error",
    "thread.turn.interrupted",
    "thread.turn.started",
  ].includes(type);
}

function projectionEventTypeForActivityKind(kind) {
  const safeKind = cleanText(kind, "activity")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_");
  if (safeKind === "tool_call") {
    return "thread.tool_call";
  }
  if (safeKind === "tool_output") {
    return "thread.tool_output";
  }
  if (safeKind === "reasoning") {
    return "thread.reasoning";
  }
  if (safeKind === "patch") {
    return "thread.patch";
  }
  if (safeKind === "file") {
    return "thread.file";
  }

  return "thread.activity";
}

function normalizeThreadProjectionEvent(event, fallbackSequence = 0) {
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    return null;
  }

  const type = normalizeProjectionEventType(event.type);
  if (!type) {
    return null;
  }

  const turnId = cleanText(event.turnId || event.turn_id);
  const messageId = cleanText(
    event.messageId
      || event.message_id
      || (isTurnProjectionEventType(type) ? turnId : "")
      || event.id,
  );
  const delta = cleanMessageText(event.delta);
  const text = cleanMessageText(event.text || event.message);
  const title = cleanText(event.title);
  if (
    (!messageId || (isTurnProjectionEventType(type) && !(turnId || messageId)))
    || (
      !text
      && !delta
      && type !== "thread.message.assistant.complete"
      && !isTurnProjectionEventType(type)
    )
  ) {
    return null;
  }

  const sequence = Number.parseInt(event.sequence, 10);
  const role = cleanText(event.role, isActivityProjectionEventType(type) ? "activity" : "assistant").toLowerCase();
  const kind = cleanText(
    event.kind,
    isActivityProjectionEventType(type) ? type.replace(/^thread\./, "") : "message",
  )
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 48);
  const id = cleanText(
    event.id || event.eventId || event.event_id,
    `projection-${messageId}-${type}-${Number.isInteger(sequence) ? sequence : fallbackSequence}`,
  );

  return {
    agentId: cleanAgentId(event.agentId || event.agent_id, ""),
    callId: cleanText(event.callId || event.call_id),
    createdAt: cleanText(event.createdAt || event.created_at, nowIso()),
    completedAt: cleanText(event.completedAt || event.completed_at),
    delta,
    id,
    kind,
    messageId,
    assistantMessageId: cleanText(event.assistantMessageId || event.assistant_message_id),
    replaceText: event.replaceText === true,
    role: ["activity", "assistant", "system", "user"].includes(role) ? role : "assistant",
    sequence: Number.isInteger(sequence) && sequence >= 0 ? sequence : fallbackSequence,
    source: cleanText(event.source),
    status: cleanText(
      event.status,
      type === "thread.turn.started"
        ? "running"
        : type === "thread.turn.completed"
          ? "completed"
          : type === "thread.turn.error"
            ? "error"
            : type === "thread.turn.interrupted"
              ? "interrupted"
              : type === "thread.message.assistant.complete"
                ? "complete"
                : "streaming",
    ),
    text,
    title,
    turnId: turnId || (isTurnProjectionEventType(type) ? messageId : ""),
    type,
  };
}

function normalizeThreadProjectionEvents(events) {
  const normalized = [];
  const seen = new Set();

  (Array.isArray(events) ? events : []).forEach((event, index) => {
    const normalizedEvent = normalizeThreadProjectionEvent(event, index);
    if (!normalizedEvent || seen.has(normalizedEvent.id)) {
      return;
    }

    seen.add(normalizedEvent.id);
    normalized.push(normalizedEvent);
  });

  return normalized
    .sort((left, right) => left.sequence - right.sequence)
    .map((event, index) => ({ ...event, sequence: index }))
    .slice(-MAX_THREAD_PROJECTION_EVENTS)
    .map((event, index) => ({ ...event, sequence: index }));
}

function upsertProjectedMessage(messagesById, messageOrder, message) {
  const normalizedMessage = normalizeThreadMessage(message);
  if (!normalizedMessage) {
    return;
  }

  if (!messagesById.has(normalizedMessage.id)) {
    messageOrder.push(normalizedMessage.id);
    messagesById.set(normalizedMessage.id, normalizedMessage);
    return;
  }

  messagesById.set(normalizedMessage.id, {
    ...messagesById.get(normalizedMessage.id),
    ...normalizedMessage,
  });
}

function projectThreadProjectionMessages(events, fallbackMessages = []) {
  const projectionEvents = normalizeThreadProjectionEvents(events);
  if (!projectionEvents.length) {
    return normalizeThreadMessages(fallbackMessages);
  }

  const messagesById = new Map();
  const messageOrder = [];
  projectionEvents.forEach((event) => {
    if (event.type === "thread.message.user" || event.type === "thread.message.system") {
      upsertProjectedMessage(messagesById, messageOrder, {
        agentId: event.agentId,
        createdAt: event.createdAt,
        id: event.messageId,
        kind: "message",
        role: event.type === "thread.message.system" ? "system" : "user",
        source: event.source || "projection",
        status: event.status || "submitted",
        text: event.text || event.delta,
        turnId: event.turnId,
      });
      return;
    }

    if (event.type === "thread.message.assistant.delta") {
      const existing = messagesById.get(event.messageId);
      const eventText = event.replaceText
        ? event.text || event.delta
        : `${existing?.text || ""}${event.delta || event.text}`;
      upsertProjectedMessage(messagesById, messageOrder, {
        agentId: event.agentId,
        createdAt: event.createdAt,
        id: event.messageId,
        kind: event.kind || "message",
        role: "assistant",
        source: event.source || "projection",
        status: "streaming",
        text: eventText,
        turnId: event.turnId,
      });
      return;
    }

    if (event.type === "thread.message.assistant.complete") {
      const existing = messagesById.get(event.messageId);
      if (!existing && !(event.text || event.delta)) {
        return;
      }

      upsertProjectedMessage(messagesById, messageOrder, {
        ...(existing || {}),
        agentId: event.agentId || existing?.agentId || "",
        createdAt: event.createdAt || existing?.createdAt,
        id: event.messageId,
        kind: event.kind || existing?.kind || "message",
        role: "assistant",
        source: event.source || existing?.source || "projection",
        status: "complete",
        text: event.replaceText || !existing?.text
          ? event.text || event.delta || existing?.text || ""
          : existing.text,
        turnId: event.turnId || existing?.turnId || "",
      });
      return;
    }

    if (isActivityProjectionEventType(event.type)) {
      upsertProjectedMessage(messagesById, messageOrder, {
        agentId: event.agentId,
        callId: event.callId,
        createdAt: event.createdAt,
        id: event.messageId,
        kind: event.kind || "activity",
        role: "activity",
        source: event.source || "projection",
        status: event.status || "complete",
        text: event.text || event.delta,
        title: event.title,
        turnId: event.turnId,
      });
    }
  });

  return messageOrder
    .map((messageId) => messagesById.get(messageId))
    .filter(Boolean)
    .slice(-MAX_THREAD_MESSAGES);
}

function threadMessageProjectionEventId(prefix, message, suffix = "") {
  const id = cleanText(message?.id, createRandomId("message"));
  const text = cleanMessageText(message?.text);
  const hash = stableProjectionHash(`${id}:${message?.role || ""}:${message?.kind || ""}:${text}`);
  return [
    prefix,
    safeKey(id, "message"),
    hash,
    suffix,
  ].filter(Boolean).join("-");
}

function projectionEventsFromMessages(messages, options = {}) {
  const agentId = cleanAgentId(options.agentId, "");
  const source = cleanText(options.source, "projection-bootstrap");
  const events = [];
  normalizeThreadMessages(messages).forEach((message) => {
    const messageId = cleanText(message.id, createRandomId("message"));
    const base = {
      agentId: message.agentId || agentId,
      callId: message.callId,
      createdAt: message.createdAt,
      kind: message.kind,
      messageId,
      source: message.source || source,
      text: message.text,
      title: message.title,
      turnId: message.turnId,
    };
    if (message.role === "assistant") {
      events.push({
        ...base,
        delta: message.text,
        id: threadMessageProjectionEventId("projection-assistant-delta", message),
        type: "thread.message.assistant.delta",
      });
      events.push({
        ...base,
        id: threadMessageProjectionEventId("projection-assistant-complete", message),
        type: "thread.message.assistant.complete",
      });
      return;
    }
    if (message.role === "activity") {
      events.push({
        ...base,
        id: threadMessageProjectionEventId("projection-activity", message),
        type: projectionEventTypeForActivityKind(message.kind),
      });
      return;
    }

    events.push({
      ...base,
      id: threadMessageProjectionEventId("projection-user", message),
      role: message.role,
      type: message.role === "system" ? "thread.message.system" : "thread.message.user",
    });
  });

  return events;
}

function ensureThreadProjectionEvents(thread) {
  const existingProjectionEvents = normalizeThreadProjectionEvents(thread?.projectionEvents);
  if (existingProjectionEvents.length) {
    return existingProjectionEvents;
  }

  return normalizeThreadProjectionEvents(
    projectionEventsFromMessages(thread?.messages, {
      agentId: thread?.currentAgent,
    }),
  );
}

function appendThreadProjectionEvents(existingEvents, nextEvents) {
  const normalizedExisting = normalizeThreadProjectionEvents(existingEvents);
  const events = normalizedExisting.slice();
  const seen = new Set(events.map((event) => event.id));
  let nextSequence = events.length;

  (Array.isArray(nextEvents) ? nextEvents : [nextEvents]).forEach((event) => {
    const normalizedEvent = normalizeThreadProjectionEvent(
      { ...event, sequence: nextSequence },
      nextSequence,
    );
    if (!normalizedEvent || seen.has(normalizedEvent.id)) {
      return;
    }

    seen.add(normalizedEvent.id);
    events.push(normalizedEvent);
    nextSequence += 1;
  });

  return normalizeThreadProjectionEvents(events);
}

function projectionHasTurnEvent(events, type, turnId) {
  const safeTurnId = cleanText(turnId);
  if (!safeTurnId) {
    return false;
  }

  return normalizeThreadProjectionEvents(events).some((event) => (
    event.type === type && event.turnId === safeTurnId
  ));
}

function isTranscriptTurnCompleteMessage(message) {
  const id = cleanText(message?.id).toLowerCase();
  const kind = cleanText(message?.kind).toLowerCase();
  const title = cleanText(message?.title).toLowerCase();
  const status = cleanText(message?.status).toLowerCase();
  return kind === "task_complete"
    || kind === "final_answer"
    || status === "task_complete"
    || id.includes("task-complete")
    || title === "task complete";
}

function isTranscriptTurnErrorMessage(message) {
  const kind = cleanText(message?.kind).toLowerCase();
  const status = cleanText(message?.status).toLowerCase();
  return kind === "error" || status === "error";
}

function projectLatestTurnFromEvents(events, fallbackLatestTurn = null) {
  let latestTurn = normalizeThreadLatestTurn(fallbackLatestTurn);

  normalizeThreadProjectionEvents(events).forEach((event) => {
    const turnId = cleanText(event.turnId);
    if (!turnId) {
      return;
    }

    if (event.type === "thread.turn.started") {
      latestTurn = normalizeThreadLatestTurn({
        agentId: event.agentId,
        messageId: event.messageId,
        requestedAt: event.createdAt,
        startedAt: event.createdAt,
        state: "running",
        turnId,
        updatedAt: event.createdAt,
      });
      return;
    }

    if (!latestTurn || latestTurn.turnId !== turnId) {
      return;
    }

    if (event.type === "thread.message.assistant.delta" || event.type === "thread.message.assistant.complete") {
      latestTurn = normalizeThreadLatestTurn({
        ...latestTurn,
        assistantMessageId: event.messageId || latestTurn.assistantMessageId,
        updatedAt: event.createdAt,
      });
      return;
    }

    if (isActivityProjectionEventType(event.type)) {
      latestTurn = normalizeThreadLatestTurn({
        ...latestTurn,
        updatedAt: event.createdAt,
      });
      return;
    }

    if (event.type === "thread.turn.completed") {
      latestTurn = normalizeThreadLatestTurn({
        ...latestTurn,
        assistantMessageId: event.assistantMessageId || latestTurn.assistantMessageId,
        completedAt: event.completedAt || event.createdAt,
        state: "completed",
        updatedAt: event.completedAt || event.createdAt,
      });
      return;
    }

    if (event.type === "thread.turn.error") {
      latestTurn = normalizeThreadLatestTurn({
        ...latestTurn,
        completedAt: event.completedAt || event.createdAt,
        error: event.text || latestTurn.error,
        state: "error",
        updatedAt: event.completedAt || event.createdAt,
      });
      return;
    }

    if (event.type === "thread.turn.interrupted") {
      latestTurn = normalizeThreadLatestTurn({
        ...latestTurn,
        completedAt: event.completedAt || event.createdAt,
        state: "interrupted",
        updatedAt: event.completedAt || event.createdAt,
      });
    }
  });

  return latestTurn;
}

function findMatchingProjectedMessage(projectedMessages, message) {
  const messageId = cleanText(message?.id);
  const role = cleanText(message?.role);
  const kind = cleanText(message?.kind, "message");
  const text = cleanMessageText(message?.text);
  const callId = cleanText(message?.callId);

  if (messageId) {
    const exactMatch = projectedMessages.find((candidate) => cleanText(candidate.id) === messageId);
    if (exactMatch) {
      return exactMatch;
    }
  }

  if (callId) {
    const callMatch = projectedMessages.find((candidate) => (
      cleanText(candidate.callId) === callId
      && cleanText(candidate.kind, "message") === kind
    ));
    if (callMatch) {
      return callMatch;
    }
  }

  return projectedMessages.find((candidate) => (
    candidate.role === role
    && cleanText(candidate.kind, "message") === kind
    && cleanMessageText(candidate.text) === text
    && areThreadMessagesSameTurn(candidate, message, role === "user" ? 12000 : 5000)
  )) || null;
}

function createSubmittedUserProjectionEvents(thread, event = {}) {
  const text = cleanSubmittedUserMessage(event.userMessage || event.message);
  if (!text) {
    return [];
  }

  const projectionEvents = ensureThreadProjectionEvents(thread);
  const messages = projectThreadProjectionMessages(projectionEvents, thread?.messages);
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
    return [];
  }

  const messageId = cleanText(event.messageId, createRandomId(`message-${safeKey(thread?.id, "thread")}`));
  const turnId = cleanText(event.turnId || event.turn_id, createTurnIdForMessage(thread, messageId));
  const agentId = cleanAgentId(event.agentId || event.currentAgent, "");
  const source = cleanText(event.source || event.messageSource, "local-submit");
  return [{
    agentId,
    createdAt,
    id: `projection-user-${safeKey(messageId, "message")}`,
    messageId,
    source,
    status: "submitted",
    text,
    turnId,
    type: "thread.message.user",
  }, {
    agentId: cleanAgentId(event.agentId || event.currentAgent, ""),
    createdAt,
    id: `projection-turn-started-${safeKey(turnId, "turn")}`,
    messageId,
    source,
    status: "running",
    turnId,
    type: "thread.turn.started",
  }];
}

function createProjectionEventsFromTranscript(thread, incomingMessages, event = {}) {
  const agentId = cleanAgentId(event.agentId || event.currentAgent || thread?.currentAgent, "");
  const source = cleanText(event.source, `${agentId || "agent"}-session`);
  let projectionEvents = ensureThreadProjectionEvents(thread);
  let projectedMessages = projectThreadProjectionMessages(projectionEvents, thread?.messages);
  const events = [];
  let currentTurnId = cleanText(normalizeThreadLatestTurn(thread?.latestTurn)?.turnId);

  normalizeThreadMessages(incomingMessages).forEach((message) => {
    const eventStartCount = events.length;
    const projectedMessage = findMatchingProjectedMessage(projectedMessages, message);
    const messageId = cleanText(message.id, createRandomId("message"));
    const createdAt = cleanText(message.createdAt, nowIso());
    const messageTurnId = cleanText(
      message.turnId
        || message.turn_id
        || projectedMessage?.turnId
        || currentTurnId
        || createTurnIdForMessage(thread, messageId),
    );
    const eventBase = {
      agentId: message.agentId || agentId,
      callId: message.callId,
      createdAt,
      kind: message.kind,
      messageId,
      source: message.source || source,
      title: message.title,
      turnId: messageTurnId,
    };

    if (message.role === "user") {
      currentTurnId = cleanText(
        message.turnId
          || message.turn_id
          || projectedMessage?.turnId
          || createTurnIdForMessage(thread, messageId),
      );
      eventBase.turnId = currentTurnId;
      if (!projectionHasTurnEvent(projectionEvents, "thread.turn.started", currentTurnId)) {
        events.push({
          ...eventBase,
          id: `projection-provider-turn-started-${safeKey(currentTurnId, "turn")}`,
          status: "running",
          type: "thread.turn.started",
        });
      }
      if (projectedMessage) {
        // Keep the provider turn lifecycle even when the local submit already projected the user.
      } else {
        events.push({
          ...eventBase,
          id: `projection-provider-user-${safeKey(messageId, "message")}`,
          role: "user",
          status: message.status || "submitted",
          text: message.text,
          type: "thread.message.user",
        });
      }
    } else if (message.role === "assistant") {
      const nextText = cleanMessageText(message.text);
      const turnComplete = isTranscriptTurnCompleteMessage(message);
      if (!nextText) {
        if (turnComplete && messageTurnId && !projectionHasTurnEvent(projectionEvents, "thread.turn.completed", messageTurnId)) {
          events.push({
            ...eventBase,
            completedAt: createdAt,
            id: `projection-provider-turn-completed-${safeKey(messageTurnId, "turn")}-${safeKey(messageId, "message")}`,
            status: "completed",
            type: "thread.turn.completed",
          });
        }
        return;
      }

      const duplicateFinalAssistant = turnComplete
        ? projectedMessages.find((candidate) => (
          candidate.role === "assistant"
          && (!messageTurnId || candidate.turnId === messageTurnId)
          && cleanMessageText(candidate.text) === nextText
        ))
        : null;
      const messageProjectionTarget = duplicateFinalAssistant || projectedMessage;
      const shouldProjectAssistant = !duplicateFinalAssistant;
      const effectivePreviousText = cleanMessageText(messageProjectionTarget?.text);
      let delta = nextText;
      let replaceText = false;
      if (effectivePreviousText && nextText.startsWith(effectivePreviousText)) {
        delta = nextText.slice(effectivePreviousText.length);
      } else if (effectivePreviousText && effectivePreviousText !== nextText) {
        replaceText = true;
      } else if (effectivePreviousText === nextText) {
        delta = "";
      }

      if (shouldProjectAssistant && (delta || replaceText || !messageProjectionTarget)) {
        events.push({
          ...eventBase,
          delta: replaceText ? "" : delta || nextText,
          id: [
            "projection-assistant-delta",
            safeKey(messageId, "message"),
            nextText.length,
            stableProjectionHash(nextText),
          ].join("-"),
          replaceText,
          text: replaceText ? nextText : "",
          type: "thread.message.assistant.delta",
        });
      }
      if (
        shouldProjectAssistant
        && (!messageProjectionTarget || messageProjectionTarget.status !== "complete" || messageProjectionTarget.text !== nextText)
      ) {
        events.push({
          ...eventBase,
          id: [
            "projection-assistant-complete",
            safeKey(messageId, "message"),
            nextText.length,
            stableProjectionHash(nextText),
          ].join("-"),
          text: nextText,
          type: "thread.message.assistant.complete",
        });
      }
      if (turnComplete && messageTurnId && !projectionHasTurnEvent(projectionEvents, "thread.turn.completed", messageTurnId)) {
        events.push({
          ...eventBase,
          assistantMessageId: duplicateFinalAssistant?.id || messageId,
          completedAt: createdAt,
          id: `projection-provider-turn-completed-${safeKey(messageTurnId, "turn")}-${safeKey(messageId, "message")}`,
          status: "completed",
          type: "thread.turn.completed",
        });
      }
    } else if (message.role === "activity") {
      if (projectedMessage && projectedMessage.text === message.text && projectedMessage.title === message.title) {
        return;
      }
      events.push({
        ...eventBase,
        id: [
          "projection-activity",
          safeKey(messageId, "message"),
          stableProjectionHash(`${message.kind}:${message.title}:${message.text}`),
        ].join("-"),
        status: message.status || "complete",
        text: message.text,
        type: projectionEventTypeForActivityKind(message.kind),
      });
      if (
        isTranscriptTurnErrorMessage(message)
        && messageTurnId
        && !projectionHasTurnEvent(projectionEvents, "thread.turn.error", messageTurnId)
      ) {
        events.push({
          ...eventBase,
          completedAt: createdAt,
          id: `projection-provider-turn-error-${safeKey(messageTurnId, "turn")}-${safeKey(messageId, "message")}`,
          status: "error",
          text: message.text,
          type: "thread.turn.error",
        });
      }
    }

    if (events.length > eventStartCount) {
      projectionEvents = appendThreadProjectionEvents(projectionEvents, events.slice(eventStartCount));
      projectedMessages = projectThreadProjectionMessages(projectionEvents, projectedMessages);
    }
  });

  if (event.turnCompleteSeen === true && currentTurnId && !projectionHasTurnEvent(projectionEvents, "thread.turn.completed", currentTurnId)) {
    const completedAt = cleanText(event.latestTimestamp || event.completedAt, nowIso());
    const assistantMessage = [...projectedMessages].reverse().find((message) => (
      message?.role === "assistant"
      && (!message.turnId || message.turnId === currentTurnId)
    ));
    events.push({
      agentId,
      assistantMessageId: assistantMessage?.id || "",
      completedAt,
      createdAt: completedAt,
      id: [
        "projection-provider-turn-completed",
        safeKey(currentTurnId, "turn"),
        "fallback",
        stableProjectionHash(completedAt),
      ].join("-"),
      messageId: assistantMessage?.id || currentTurnId,
      source,
      status: "completed",
      turnId: currentTurnId,
      type: "thread.turn.completed",
    });
  }

  return events;
}

function defaultThreadTitle(terminalIndex, agentId) {
  const slot = Math.max(0, Number.parseInt(terminalIndex, 10) || 0) + 1;
  const agent = cleanAgentId(agentId, DEFAULT_AGENT_ID);
  const agentLabel = getWorkspaceThreadAgentLabel(agent);

  return `${agentLabel} ${slot}`;
}

export function getWorkspaceThreadAgentLabel(threadOrAgentId) {
  const agent = typeof threadOrAgentId === "string"
    ? cleanAgentId(threadOrAgentId, DEFAULT_AGENT_ID)
    : cleanAgentId(threadOrAgentId?.currentAgent || threadOrAgentId?.preferredAgent, DEFAULT_AGENT_ID);
  if (agent === "opencode") {
    return "OpenCode";
  }
  if (agent === "claude") {
    return "Claude Code";
  }
  if (agent === "generic") {
    return "Terminal";
  }

  return "Codex";
}

function isDefaultThreadTitleCandidate(value, thread) {
  const title = cleanText(value).toLowerCase();
  if (!title) {
    return false;
  }

  return THREAD_AGENT_IDS.some((agentId) => (
    title === defaultThreadTitle(getThreadTerminalIndex(thread) || 0, agentId).toLowerCase()
    || title === `Claude ${Math.max(0, Number.parseInt(getThreadTerminalIndex(thread), 10) || 0) + 1}`.toLowerCase()
  ));
}

function cleanRealThreadTitleCandidate(value, thread) {
  const title = cleanThreadLabelCandidate(value);
  if (!title || isLikelyNativeSessionIdLabel(title) || isDefaultThreadTitleCandidate(title, thread)) {
    return "";
  }

  return title;
}

function getWorkspaceThreadPromptLabel(message, fallback = "New thread") {
  const cleaned = cleanTerminalUiText(message, fallback)
    .replace(/^["'`]+|["'`.,!?;:]+$/g, "")
    .trim();
  if (isTerminalArtifactLabel(cleaned)) {
    return limitThreadPromptLabel(fallback, fallback);
  }
  const words = cleaned.split(/\s+/).filter(Boolean).slice(0, THREAD_PROMPT_LABEL_MAX_WORDS);
  const title = words.join(" ");

  return limitThreadPromptLabel(title || fallback, fallback);
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
    nativeSessionTitle: cleanThreadLabelCandidate(
      binding.nativeSessionTitle
        || binding.sessionTitle
        || binding.title
        || fallback.nativeSessionTitle
        || fallback.sessionTitle
        || fallback.title,
    ),
    nativeSessionTitleSource: cleanText(binding.nativeSessionTitleSource, fallback.nativeSessionTitleSource),
    nativeSessionTitleUpdatedAt: cleanText(binding.nativeSessionTitleUpdatedAt, fallback.nativeSessionTitleUpdatedAt),
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
  const projectionEvents = options.stripMessages
    ? []
    : normalizeThreadProjectionEvents(thread.projectionEvents || thread.threadProjectionEvents);
  const messages = options.stripMessages
    ? []
    : (
      projectionEvents.length
        ? projectThreadProjectionMessages(projectionEvents, thread.messages)
        : normalizeThreadMessages(thread.messages)
    );
  const projectedLatestTurn = options.stripMessages
    ? normalizeThreadLatestTurn(thread.latestTurn)
    : projectLatestTurnFromEvents(projectionEvents, thread.latestTurn);
  const messageCount = Math.max(normalizeMessageCount(thread.messageCount), messages.length);
  const materialized = thread.materialized === true || messageCount > 0;
  const status = cleanText(thread.status, "idle").toLowerCase();
  const safeStatus = ["active", "closed", "error", "exited", "idle", "starting"].includes(status)
    ? status
    : "idle";
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
  const pendingPrompt = options.stripLiveBindings ? null : normalizePendingPrompt(thread.pendingPrompt);
  const fallbackTitle = defaultThreadTitle(terminalIndex || 0, currentAgent);
  const storedSessionName = cleanThreadLabelCandidate(thread.sessionName);
  const storedTitle = cleanThreadLabelCandidate(thread.title);

  const latestTurn = projectedLatestTurn;
  const activityStatus = options.stripLiveBindings
    ? "idle"
    : activityStatusForLatestTurn(
      latestTurn,
      normalizeThreadActivityStatus(thread.activityStatus, providerBindings[currentAgent]?.activityStatus),
    );

  return {
    coordination,
    activityStatus,
    archivedAt: cleanText(thread.archivedAt),
    createdAt,
    currentAgent,
    id,
    lastActiveAt: cleanText(thread.lastActiveAt, updatedAt),
    lastMessageAt: cleanText(thread.lastMessageAt),
    materialized,
    messageCount,
    messages,
    latestTurn,
    pendingPrompt,
    projectionEvents,
    preferredAgent,
    freshSessionStartedAt: options.stripLiveBindings ? "" : cleanText(thread.freshSessionStartedAt),
    sessionName: storedSessionName || storedTitle || fallbackTitle,
    slotKey: cleanText(
      thread.slotKey,
      terminalIndex == null ? `thread-${safeKey(id, "detached")}` : defaultSlotKey(terminalIndex),
    ),
    status: options.stripLiveBindings && ["active", "starting"].includes(safeStatus) ? "idle" : safeStatus,
    providerBindings,
    terminalBinding,
    terminalIndex,
    title: storedTitle || storedSessionName || fallbackTitle,
    transcriptHydratedAt: options.stripMessages ? "" : cleanText(thread.transcriptHydratedAt),
    transcriptHydrationMode: options.stripMessages ? "" : cleanText(thread.transcriptHydrationMode),
    transcriptLatestTimestamp: options.stripMessages ? "" : cleanText(thread.transcriptLatestTimestamp),
    transcriptSessionId: cleanText(thread.transcriptSessionId),
    transcriptSourcePath: options.stripMessages ? "" : cleanText(thread.transcriptSourcePath),
    transcriptStatus: options.stripMessages ? "idle" : cleanText(thread.transcriptStatus, "idle"),
    updatedAt,
    workspaceId,
  };
}

function archiveThreadRecord(thread, archivedAt = nowIso()) {
  if (!thread) {
    return null;
  }

  const latestTurn = normalizeThreadLatestTurn(thread.latestTurn);
  const archivedLatestTurn = latestTurn?.state === "running"
    ? normalizeThreadLatestTurn({
      ...latestTurn,
      completedAt: archivedAt,
      state: "interrupted",
      updatedAt: archivedAt,
    })
    : latestTurn;
  const providerBindings = normalizeProviderBindings(
    thread.providerBindings,
    thread.currentAgent,
    {
      activityStatus: "idle",
      coordination: thread.coordination,
      lastActiveAt: thread.lastActiveAt,
      lastMessageAt: thread.lastMessageAt,
      messageCount: thread.messageCount,
      status: "closed",
      terminalBinding: null,
      updatedAt: archivedAt,
    },
    { stripLiveBindings: true },
  );

  Object.keys(providerBindings).forEach((agentId) => {
    providerBindings[agentId] = {
      ...providerBindings[agentId],
      activityStatus: "idle",
      status: "closed",
      terminalBinding: null,
      updatedAt: archivedAt,
    };
  });

  return {
    ...thread,
    activityStatus: "idle",
    archivedAt: cleanText(thread.archivedAt, archivedAt),
    latestTurn: archivedLatestTurn,
    providerBindings,
    status: "closed",
    terminalBinding: null,
    updatedAt: archivedAt,
  };
}

function normalizeWorkspaceEntry(entry, workspaceId, options = {}) {
  const threadsSource = entry?.threads && typeof entry.threads === "object" && !Array.isArray(entry.threads)
    ? entry.threads
    : {};
  const archivedThreadsSource = entry?.archivedThreads
    && typeof entry.archivedThreads === "object"
    && !Array.isArray(entry.archivedThreads)
    ? entry.archivedThreads
    : {};
  const hasTerminalThreadIdsSource = entry?.terminalThreadIds
    && typeof entry.terminalThreadIds === "object"
    && !Array.isArray(entry.terminalThreadIds);
  const normalizedThreads = {};
  const normalizedOrder = [];
  const normalizedArchivedThreads = {};
  const normalizedArchivedOrder = [];
  const terminalSource = !options.stripLiveBindings
    && entry?.terminals
    && typeof entry.terminals === "object"
    && !Array.isArray(entry.terminals)
    ? entry.terminals
    : {};
  const normalizedTerminals = {};
  const normalizedTerminalOrder = [];

  Object.values(archivedThreadsSource).forEach((thread) => {
    const archivedAt = cleanText(thread?.archivedAt, nowIso());
    const normalizedThread = normalizeThread(
      {
        ...thread,
        archivedAt,
      },
      workspaceId,
      {
        ...options,
        stripLiveBindings: true,
      },
    );
    const archivedThread = archiveThreadRecord(normalizedThread, archivedAt);
    if (!archivedThread || !archivedThread.materialized || normalizedArchivedThreads[archivedThread.id]) {
      return;
    }

    normalizedArchivedThreads[archivedThread.id] = archivedThread;
  });

  Object.values(threadsSource).forEach((thread) => {
    const normalizedThread = normalizeThread(thread, workspaceId, options);
    if (!normalizedThread || !normalizedThread.materialized) {
      return;
    }

    if (normalizedThread.archivedAt) {
      const archivedThread = archiveThreadRecord(normalizedThread, normalizedThread.archivedAt);
      if (archivedThread && !normalizedArchivedThreads[archivedThread.id]) {
        normalizedArchivedThreads[archivedThread.id] = archivedThread;
      }
      return;
    }

    if (normalizedThreads[normalizedThread.id]) {
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

  const sourceArchivedOrder = Array.isArray(entry?.archivedThreadOrder) ? entry.archivedThreadOrder : [];
  sourceArchivedOrder.forEach((threadId) => {
    const safeThreadId = cleanText(threadId);
    if (safeThreadId && normalizedArchivedThreads[safeThreadId] && !normalizedArchivedOrder.includes(safeThreadId)) {
      normalizedArchivedOrder.push(safeThreadId);
    }
  });

  Object.keys(normalizedArchivedThreads).forEach((threadId) => {
    if (!normalizedArchivedOrder.includes(threadId)) {
      normalizedArchivedOrder.push(threadId);
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
  const safeActiveThreadId = normalizedThreads[activeThreadId]
    ? activeThreadId
    : normalizedOrder[0] || "";
  const threadsView = normalizeThreadsViewState(entry?.threadsView, {
    selectedThreadId: safeActiveThreadId,
    selectedWorkspaceId: workspaceId,
  });
  if (threadsView.selectedThreadId && !normalizedThreads[threadsView.selectedThreadId]) {
    threadsView.selectedThreadId = safeActiveThreadId;
  }
  if (!threadsView.selectedWorkspaceId) {
    threadsView.selectedWorkspaceId = workspaceId;
  }

  return {
    activeThreadId: safeActiveThreadId,
    archivedThreadOrder: normalizedArchivedOrder,
    archivedThreads: normalizedArchivedThreads,
    terminalOrder: normalizedTerminalOrder,
    terminalThreadIds: normalizedTerminalThreadIds,
    terminals: normalizedTerminals,
    threadOrder: normalizedOrder.slice(0, MAX_THREADS_PER_WORKSPACE),
    threads: normalizedThreads,
    threadsView,
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
    archivedThreadOrder: existing.archivedThreadOrder.slice(),
    archivedThreads: { ...existing.archivedThreads },
    terminalOrder: existing.terminalOrder.slice(),
    terminalThreadIds: { ...existing.terminalThreadIds },
    terminals: { ...existing.terminals },
    threadOrder: existing.threadOrder.slice(),
    threads: { ...existing.threads },
    threadsView: { ...existing.threadsView },
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

    if (existingTerminal && !existingTerminal.threadId && isThreadAgentId(existingTerminal.agentId || role)) {
      const agentId = cleanAgentId(existingTerminal.agentId || role);
      const threadId = createThreadIdForTerminal(workspaceId, terminalIndex);
      entry.threads[threadId] = {
        coordination: normalizeCoordination({
          worktreePath: existingTerminal.worktreePath,
        }),
        createdAt: now,
        currentAgent: agentId,
        id: threadId,
        lastActiveAt: now,
        lastMessageAt: "",
        latestTurn: null,
        materialized: true,
        messageCount: 0,
        messages: [],
        pendingPrompt: null,
        projectionEvents: [],
        preferredAgent: agentId,
        providerBindings: {
          [agentId]: normalizeProviderBinding(null, agentId, {
            activityStatus: "idle",
            lastActiveAt: now,
            messageCount: 0,
            status: existingTerminal.status || "active",
            terminalBinding: normalizeTerminalBinding({
              instanceId: existingTerminal.instanceId,
              paneId: existingTerminal.paneId,
              terminalIndex,
            }),
            updatedAt: now,
          }),
        },
        sessionName: defaultThreadTitle(terminalIndex, agentId),
        slotKey: existingTerminal.slotKey || defaultSlotKey(terminalIndex),
        status: existingTerminal.status || "active",
        terminalBinding: normalizeTerminalBinding({
          instanceId: existingTerminal.instanceId,
          paneId: existingTerminal.paneId,
          terminalIndex,
        }),
        terminalIndex,
        title: defaultThreadTitle(terminalIndex, agentId),
        updatedAt: now,
        workspaceId,
      };
      entry.threadOrder.push(threadId);
      bindExistingThreadToTerminal(entry, threadId, {
        agentId,
        instanceId: existingTerminal.instanceId,
        paneId: existingTerminal.paneId,
        slotKey: existingTerminal.slotKey,
        status: existingTerminal.status || "active",
        terminalIndex,
        workspaceId,
        worktreePath: existingTerminal.worktreePath,
      }, { status: existingTerminal.status || "active" });
      changed = true;
      return;
    }

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
  const nextThreadsView = {
    ...normalizeThreadsViewState(entry.threadsView, {
      selectedThreadId: entry.activeThreadId,
      selectedWorkspaceId: safeWorkspaceId,
    }),
    newChatActive: false,
    selectedThreadId: safeThreadId,
    selectedWorkspaceId: safeWorkspaceId,
  };
  const viewChanged = JSON.stringify(entry.threadsView || {}) !== JSON.stringify(nextThreadsView);

  if (entry.activeThreadId === safeThreadId && !restoreChanged && !viewChanged) {
    return state || {};
  }

  entry.activeThreadId = safeThreadId;
  entry.threadsView = nextThreadsView;

  return {
    ...currentState,
    [safeWorkspaceId]: entry,
  };
}

export function updateWorkspaceThreadsViewState(state, workspaceId, patch = {}) {
  const safeWorkspaceId = cleanText(workspaceId || patch.workspaceId || patch.selectedWorkspaceId);
  if (!safeWorkspaceId) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = currentState[safeWorkspaceId]
    ? ensureWorkspaceEntry(currentState, safeWorkspaceId)
    : null;
  if (!entry) {
    return state || {};
  }

  const existingView = normalizeThreadsViewState(entry.threadsView, {
    selectedThreadId: entry.activeThreadId,
    selectedWorkspaceId: safeWorkspaceId,
  });
  const requestedThreadId = cleanText(patch.selectedThreadId || patch.threadId);
  const selectedThreadId = requestedThreadId && entry.threads[requestedThreadId]
    ? requestedThreadId
    : requestedThreadId
      ? existingView.selectedThreadId
      : existingView.selectedThreadId;
  const nextView = {
    ...existingView,
    newChatActive: typeof patch.newChatActive === "boolean"
      ? patch.newChatActive
      : existingView.newChatActive,
    railCollapsed: typeof patch.railCollapsed === "boolean"
      ? patch.railCollapsed
      : existingView.railCollapsed,
    selectedThreadId: selectedThreadId || entry.activeThreadId || "",
    selectedWorkspaceId: cleanText(patch.selectedWorkspaceId || safeWorkspaceId, existingView.selectedWorkspaceId || safeWorkspaceId),
  };

  if (JSON.stringify(existingView) === JSON.stringify(nextView)) {
    return state || {};
  }

  entry.threadsView = nextView;
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
  const eventSessionName = cleanThreadLabelCandidate(event.sessionName);
  const eventTitle = eventSessionName
    || getWorkspaceThreadPromptLabel(event.title || event.userMessage, "");
  const existingSessionName = cleanThreadLabelCandidate(existing.sessionName);
  const existingTitle = cleanThreadLabelCandidate(existing.title);
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
    sessionName: eventSessionName || existingSessionName || eventTitle || existingTitle,
    slotKey: cleanText(event.slotKey || activeTerminal?.slotKey, existing.slotKey),
    status: safeStatus,
    terminalBinding,
    terminalIndex,
    title: eventTitle || existingTitle || existingSessionName || defaultThreadTitle(terminalIndex, agentId),
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
  const eventAgentId = cleanAgentId(event.agentId || event.currentAgent, "");
  const eventNativeSessionId = cleanText(event.nativeSessionId || event.providerSessionId);
  if (eventNativeSessionId && workspaceEntryHasArchivedSession(entry, eventAgentId, eventNativeSessionId)) {
    return state || {};
  }
  const terminalIndex = normalizeTerminalIndex(event.terminalIndex);
  const terminalKey = terminalSessionKey(terminalIndex);
  const eventThreadId = cleanText(event.threadId);
  const restoredThreadId = terminalKey ? cleanText(entry.terminalThreadIds?.[terminalKey]) : "";
  const threadId = entry.threads[eventThreadId]
    ? eventThreadId
    : entry.threads[restoredThreadId]
      ? restoredThreadId
      : "";
  const terminal = upsertActiveTerminal(entry, event, {
    status: event.status || "active",
    threadId,
  });

  if (terminal && threadId && entry.threads[threadId]) {
    bindExistingThreadToTerminal(entry, threadId, event, { status: event.status || "active" });
  } else if (terminal && !threadId && isThreadAgentId(terminal.agentId)) {
    const now = nowIso();
    const nextThreadId = createThreadIdForTerminal(workspaceId, terminal.terminalIndex);
    const freshSessionStartedAt = event.freshSession
      ? cleanText(event.freshSessionStartedAt, now)
      : "";
    entry.threads[nextThreadId] = {
      coordination: normalizeCoordination({
        worktreePath: terminal.worktreePath,
      }),
      createdAt: now,
      currentAgent: terminal.agentId,
      id: nextThreadId,
      lastActiveAt: now,
      lastMessageAt: "",
      latestTurn: null,
      freshSessionStartedAt,
      materialized: true,
      messageCount: 0,
      messages: [],
      pendingPrompt: null,
      projectionEvents: [],
      preferredAgent: terminal.agentId,
      providerBindings: {
        [terminal.agentId]: normalizeProviderBinding(null, terminal.agentId, {
          activityStatus: "idle",
          lastActiveAt: now,
          messageCount: 0,
          status: terminal.status || event.status || "active",
          terminalBinding: normalizeTerminalBinding({
            instanceId: terminal.instanceId,
            paneId: terminal.paneId,
            terminalIndex: terminal.terminalIndex,
          }),
          updatedAt: now,
        }),
      },
      sessionName: defaultThreadTitle(terminal.terminalIndex, terminal.agentId),
      slotKey: terminal.slotKey || defaultSlotKey(terminal.terminalIndex),
      status: terminal.status || event.status || "active",
      terminalBinding: normalizeTerminalBinding({
        instanceId: terminal.instanceId,
        paneId: terminal.paneId,
        terminalIndex: terminal.terminalIndex,
      }),
      terminalIndex: terminal.terminalIndex,
      title: defaultThreadTitle(terminal.terminalIndex, terminal.agentId),
      transcriptHydrationMode: event.freshSession ? "session-only" : "",
      updatedAt: now,
      workspaceId,
    };
    entry.threadOrder.push(nextThreadId);
    bindExistingThreadToTerminal(entry, nextThreadId, event, { status: event.status || "active" });
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
  if (workspaceEntryHasArchivedThreadId(entry, existingThreadId)) {
    return state || {};
  }
  const now = nowIso();
  const agentId = cleanAgentId(event.agentId || existingTerminal?.agentId || DEFAULT_AGENT_ID);
  const eventNativeSessionId = cleanText(event.nativeSessionId || event.providerSessionId);
  if (eventNativeSessionId && workspaceEntryHasArchivedSession(entry, agentId, eventNativeSessionId)) {
    return state || {};
  }
  const threadId = existingThreadId || createThreadIdForTerminal(workspaceId, terminalIndex);
  const submittedUserMessage = cleanSubmittedUserMessage(event.userMessage || event.message);
  const promptLabel = getWorkspaceThreadPromptLabel(
    event.title || submittedUserMessage,
    defaultThreadTitle(terminalIndex, agentId),
  );
  const pendingPrompt = normalizePendingPrompt(event.pendingPrompt || {
    createdAt: event.messageCreatedAt,
    id: event.pendingPromptId,
    message: event.pendingPromptText,
    model: event.model,
  });
  const hasSubmittedPrompt = Boolean(submittedUserMessage || pendingPrompt);
  const previousThread = entry.threads[threadId] || null;
  const previousMessages = normalizeThreadMessages(previousThread?.messages);
  const previousActivityStatus = normalizeThreadActivityStatus(previousThread?.activityStatus);
  const freshSessionStartedAt = event.freshSession
    ? cleanText(event.freshSessionStartedAt, previousThread?.freshSessionStartedAt || now)
    : previousThread?.freshSessionStartedAt || "";
  const transcriptHydrationMode = cleanText(
    event.transcriptHydrationMode,
    event.freshSession ? "session-only" : previousThread?.transcriptHydrationMode || "",
  );

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
      latestTurn: null,
      materialized: true,
      messageCount: 0,
      messages: [],
      pendingPrompt: null,
      projectionEvents: [],
      preferredAgent: agentId,
      freshSessionStartedAt,
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
      sessionName: promptLabel,
      slotKey: cleanText(event.slotKey || existingTerminal?.slotKey, defaultSlotKey(terminalIndex)),
      status: "active",
      terminalBinding: null,
      terminalIndex,
      title: promptLabel,
      transcriptHydrationMode,
      updatedAt: now,
      workspaceId,
    };
    entry.threadOrder.push(threadId);
  }

  bindExistingThreadToTerminal(entry, threadId, event, {
    incrementMessageCount: hasSubmittedPrompt,
    status: event.status || "active",
  });
  if (entry.threads[threadId]) {
    const submittedEvents = createSubmittedUserProjectionEvents(entry.threads[threadId], event);
    const projectionEvents = appendThreadProjectionEvents(
      ensureThreadProjectionEvents(entry.threads[threadId]),
      submittedEvents,
    );
    const messages = projectThreadProjectionMessages(projectionEvents, entry.threads[threadId].messages);
    const messageAdded = submittedEvents.length > 0 && messages.length > previousMessages.length;
    const latestTurn = projectLatestTurnFromEvents(
      projectionEvents,
      entry.threads[threadId].latestTurn,
    );
    const activityStatus = activityStatusForLatestTurn(
      latestTurn,
      messageAdded || pendingPrompt
        ? entry.threads[threadId].activityStatus
        : previousActivityStatus,
    );
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
      latestTurn,
      messageCount: messages.length,
      messages,
      pendingPrompt: pendingPrompt || entry.threads[threadId].pendingPrompt,
      projectionEvents,
      freshSessionStartedAt,
      providerBindings,
      transcriptHydrationMode,
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
    const existingLatestTurn = normalizeThreadLatestTurn(existing.latestTurn);
    const latestTurn = existingLatestTurn?.state === "running"
      ? normalizeThreadLatestTurn({
        ...existingLatestTurn,
        completedAt: now,
        error: safeStatus === "error" ? "Terminal error" : existingLatestTurn.error,
        state: safeStatus === "error" ? "error" : "interrupted",
        updatedAt: now,
      })
      : existingLatestTurn;
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
      latestTurn,
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

function workspaceThreadHasProviderSession(thread, agentId, sessionId) {
  const safeSessionId = cleanText(sessionId);
  if (!thread || !safeSessionId) {
    return false;
  }

  const providerBinding = getWorkspaceThreadProviderBinding(thread, agentId);
  return cleanText(thread.transcriptSessionId) === safeSessionId
    || cleanText(providerBinding?.nativeSessionId) === safeSessionId;
}

function collectWorkspaceThreadSessionIds(thread, agentId = "") {
  if (!thread) {
    return [];
  }

  const sessionIds = new Set();
  [
    thread.transcriptSessionId,
    thread.coordination?.sessionId,
  ].forEach((sessionId) => {
    const safeSessionId = cleanText(sessionId);
    if (safeSessionId) {
      sessionIds.add(safeSessionId);
    }
  });

  const safeAgentId = cleanAgentId(agentId, "");
  const bindings = safeAgentId
    ? [getWorkspaceThreadProviderBinding(thread, safeAgentId)]
    : Object.values(thread.providerBindings || {});
  bindings.forEach((binding) => {
    const safeSessionId = cleanText(binding?.nativeSessionId);
    if (safeSessionId) {
      sessionIds.add(safeSessionId);
    }
  });

  return [...sessionIds];
}

function workspaceEntryHasArchivedThreadId(entry, threadId) {
  const safeThreadId = cleanText(threadId);
  return Boolean(safeThreadId && entry?.archivedThreads?.[safeThreadId]);
}

function workspaceEntryHasArchivedSession(entry, agentId, sessionId) {
  const safeSessionId = cleanText(sessionId);
  if (!entry?.archivedThreads || !safeSessionId) {
    return false;
  }

  return Object.values(entry.archivedThreads).some((thread) => (
    collectWorkspaceThreadSessionIds(thread, agentId).includes(safeSessionId)
  ));
}

export function workspaceThreadSessionIsArchived(state, workspaceId, agentId, sessionId) {
  const safeWorkspaceId = cleanText(workspaceId);
  const safeSessionId = cleanText(sessionId);
  if (!safeWorkspaceId || !safeSessionId) {
    return false;
  }

  const entry = normalizeWorkspaceThreads(state)[safeWorkspaceId];
  return workspaceEntryHasArchivedSession(entry, agentId, safeSessionId);
}

export function workspaceThreadIdIsArchived(state, workspaceId, threadId) {
  const safeWorkspaceId = cleanText(workspaceId);
  const safeThreadId = cleanText(threadId);
  if (!safeWorkspaceId || !safeThreadId) {
    return false;
  }

  const entry = normalizeWorkspaceThreads(state)[safeWorkspaceId];
  return workspaceEntryHasArchivedThreadId(entry, safeThreadId);
}

function findWorkspaceThreadIdForProviderSession(entry, agentId, sessionId, ignoreThreadId = "") {
  const safeSessionId = cleanText(sessionId);
  if (!entry?.threads || !safeSessionId) {
    return "";
  }

  const ignored = cleanText(ignoreThreadId);
  return Object.values(entry.threads).find((thread) => (
    thread?.id
    && thread.id !== ignored
    && workspaceThreadHasProviderSession(thread, agentId, safeSessionId)
  ))?.id || "";
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
  if (!existing || workspaceEntryHasArchivedThreadId(entry, threadId)) {
    return state || {};
  }
  if (workspaceEntryHasArchivedSession(entry, agentId, nativeSessionId)) {
    return state || {};
  }
  const duplicateThreadId = findWorkspaceThreadIdForProviderSession(
    entry,
    agentId,
    nativeSessionId,
    threadId,
  );
  if (duplicateThreadId) {
    return state || {};
  }

  const now = nowIso();
  const nativeSessionTitle = cleanRealThreadTitleCandidate(event.nativeSessionTitle || event.sessionTitle, existing);
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
    nativeSessionTitle: nativeSessionTitle || providerBindings[agentId]?.nativeSessionTitle || "",
    nativeSessionTitleSource: nativeSessionTitle
      ? cleanText(event.nativeSessionTitleSource || event.source, "provider")
      : providerBindings[agentId]?.nativeSessionTitleSource || "",
    nativeSessionTitleUpdatedAt: nativeSessionTitle
      ? now
      : providerBindings[agentId]?.nativeSessionTitleUpdatedAt || "",
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
          sessionName: nativeSessionTitle || existing.sessionName,
          title: nativeSessionTitle || existing.title,
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

export function clearWorkspaceThreadPendingPrompt(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const threadId = cleanText(event.threadId);
  if (!workspaceId || !threadId) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = currentState[workspaceId];
  const existing = entry?.threads?.[threadId];
  if (!existing?.pendingPrompt) {
    return state || {};
  }

  const promptId = cleanText(event.pendingPromptId || event.promptId);
  if (promptId && existing.pendingPrompt.id !== promptId) {
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
          pendingPrompt: null,
          updatedAt: nowIso(),
        },
      },
    },
  };
}

function threadMessageTimestampMs(message) {
  const createdAt = String(message?.createdAt || "").trim();
  const numericTimestamp = Number.parseFloat(createdAt);
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 1_000_000_000) {
    return numericTimestamp < 10_000_000_000 ? numericTimestamp * 1000 : numericTimestamp;
  }

  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function areThreadMessagesSameTurn(left, right, maxDeltaMs = 5000) {
  const leftTimestamp = threadMessageTimestampMs(left);
  const rightTimestamp = threadMessageTimestampMs(right);
  if (!leftTimestamp || !rightTimestamp) {
    return false;
  }

  return Math.abs(leftTimestamp - rightTimestamp) <= maxDeltaMs;
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
  if (!existing || workspaceEntryHasArchivedThreadId(entry, threadId) || existing.archivedAt) {
    return state || {};
  }

  const now = nowIso();
  const sessionId = cleanText(event.sessionId || event.providerSessionId || event.nativeSessionId);
  const requestedProviderSessionId = cleanText(event.requestedProviderSessionId || event.requestedNativeSessionId);
  const matchedBy = cleanText(event.matchedBy).toLowerCase();
  if (
    existing.transcriptHydrationMode === "session-only"
    && !requestedProviderSessionId
    && matchedBy !== "sessionid"
  ) {
    return state || {};
  }
  if (sessionId) {
    if (workspaceEntryHasArchivedSession(entry, agentId, sessionId)) {
      return state || {};
    }
    const duplicateThreadId = findWorkspaceThreadIdForProviderSession(entry, agentId, sessionId, threadId);
    if (duplicateThreadId) {
      return state || {};
    }
  }
  const sessionTitle = cleanRealThreadTitleCandidate(event.sessionTitle, existing);
  const existingTitle = cleanRealThreadTitleCandidate(existing.title, existing);
  const existingSessionName = cleanRealThreadTitleCandidate(existing.sessionName, existing);
  const title = sessionTitle || existingTitle || existingSessionName || defaultThreadTitle(existing.terminalIndex, agentId);
  const projectionEvents = appendThreadProjectionEvents(
    ensureThreadProjectionEvents(existing),
    createProjectionEventsFromTranscript(existing, event.messages, {
      agentId,
      completedAt: event.completedAt,
      latestTimestamp: event.latestTimestamp,
      source: cleanText(event.source, `${agentId}-session`),
      turnCompleteSeen: event.turnCompleteSeen,
    }),
  );
  const messages = projectThreadProjectionMessages(projectionEvents, existing.messages);
  const latestTurn = projectLatestTurnFromEvents(projectionEvents, existing.latestTurn);
  const activityStatus = activityStatusForLatestTurn(latestTurn, "idle");
  const lastMessageAt = messages.length
    ? messages[messages.length - 1].createdAt
    : existing.lastMessageAt;
  const providerBindings = normalizeProviderBindings(
    existing.providerBindings,
    existing.currentAgent,
    {
      activityStatus,
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
      activityStatus,
      nativeSessionId: sessionId,
      nativeSessionKind: "session",
      nativeSessionSource: cleanText(event.source, "codex-rollout"),
      nativeSessionTitle: sessionTitle || providerBindings[agentId].nativeSessionTitle || "",
      nativeSessionTitleSource: sessionTitle
        ? cleanText(event.source, `${agentId}-session`)
        : providerBindings[agentId].nativeSessionTitleSource || "",
      nativeSessionTitleUpdatedAt: sessionTitle
        ? now
        : providerBindings[agentId].nativeSessionTitleUpdatedAt || now,
      nativeSessionUpdatedAt: now,
      updatedAt: now,
    };
  } else if (providerBindings[agentId]) {
    providerBindings[agentId] = {
      ...providerBindings[agentId],
      activityStatus,
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
          activityStatus,
          lastMessageAt,
          latestTurn,
          materialized: true,
          messageCount: messages.length,
          messages,
          projectionEvents,
          providerBindings,
          sessionName: sessionTitle || existingSessionName || existingTitle || title,
          title,
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
  const hasExplicitActivityStatus = cleanText(event.activityStatus) !== "";
  const activityStatus = hasExplicitActivityStatus
    ? normalizeThreadActivityStatus(event.activityStatus)
    : activityStatusForLatestTurn(existing.latestTurn, existing.activityStatus);
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

export function archiveWorkspaceThread(state, workspaceId, threadId) {
  const safeWorkspaceId = cleanText(workspaceId);
  const safeThreadId = cleanText(threadId);
  if (!safeWorkspaceId || !safeThreadId) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = ensureWorkspaceEntry(currentState, safeWorkspaceId);
  const existing = entry.threads[safeThreadId];
  if (!existing) {
    return state || {};
  }
  if (!getWorkspaceThreadCanArchive(existing)) {
    return state || {};
  }

  const archivedAt = nowIso();
  entry.archivedThreads[safeThreadId] = archiveThreadRecord(existing, archivedAt);
  entry.archivedThreadOrder = [
    safeThreadId,
    ...entry.archivedThreadOrder.filter((candidateId) => candidateId !== safeThreadId),
  ];
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
  if (entry.threadsView?.selectedThreadId === safeThreadId) {
    entry.threadsView = {
      ...normalizeThreadsViewState(entry.threadsView, {
        selectedThreadId: entry.activeThreadId,
        selectedWorkspaceId: safeWorkspaceId,
      }),
      newChatActive: false,
      selectedThreadId: entry.activeThreadId || "",
      selectedWorkspaceId: safeWorkspaceId,
    };
  }

  return {
    ...currentState,
    [safeWorkspaceId]: entry,
  };
}

export function deleteWorkspaceThread(state, workspaceId, threadId) {
  return archiveWorkspaceThread(state, workspaceId, threadId);
}

function getThreadSessionLabel(thread) {
  if (!thread) {
    return "";
  }

  const agentId = cleanAgentId(thread.currentAgent, "");
  const providerBinding = agentId
    ? getWorkspaceThreadProviderBinding(thread, agentId)
    : null;
  return [
    providerBinding?.nativeSessionId,
    thread.transcriptSessionId,
    thread.coordination?.sessionId,
  ]
    .map(cleanThreadLabelCandidate)
    .find(Boolean) || "";
}

export function getWorkspaceThreadHasSession(thread) {
  if (!thread) {
    return false;
  }

  if (cleanText(thread.transcriptSessionId)) {
    return true;
  }

  return Object.values(thread.providerBindings || {}).some((binding) => (
    Boolean(cleanText(binding?.nativeSessionId))
  ));
}

export function getWorkspaceThreadCanArchive(thread) {
  return getWorkspaceThreadHasSession(thread);
}

function getThreadNativeTitleLabel(thread) {
  if (!thread) {
    return "";
  }

  const currentAgent = cleanAgentId(thread.currentAgent, "");
  const agents = [
    currentAgent,
    ...THREAD_AGENT_IDS.filter((agentId) => agentId !== currentAgent),
  ].filter(Boolean);

  for (const agentId of agents) {
    const providerBinding = getWorkspaceThreadProviderBinding(thread, agentId);
    const title = cleanRealThreadTitleCandidate(providerBinding?.nativeSessionTitle, thread);
    if (title) {
      return title;
    }
  }

  return "";
}

function getThreadStoredTitleLabel(thread) {
  return [
    thread?.title,
    thread?.sessionName,
  ]
    .map((candidate) => cleanRealThreadTitleCandidate(candidate, thread))
    .find(Boolean) || "";
}

function getThreadPromptFallbackLabel(thread) {
  const pendingLabel = getWorkspaceThreadPromptLabel(thread?.pendingPrompt?.text, "");
  if (pendingLabel) {
    return pendingLabel;
  }

  const firstUserMessage = (Array.isArray(thread?.messages) ? thread.messages : [])
    .find((message) => message?.role === "user" && cleanMessageText(message.text));
  return getWorkspaceThreadPromptLabel(firstUserMessage?.text, "");
}

export function getWorkspaceThreadLabel(thread) {
  if (!getWorkspaceThreadHasSession(thread)) {
    return getWorkspaceThreadAgentLabel(thread);
  }

  const nativeTitleLabel = getThreadNativeTitleLabel(thread);
  if (nativeTitleLabel) {
    return nativeTitleLabel;
  }

  const storedTitleLabel = getThreadStoredTitleLabel(thread);
  if (storedTitleLabel) {
    return storedTitleLabel;
  }

  const promptLabel = getThreadPromptFallbackLabel(thread);
  if (promptLabel) {
    return promptLabel;
  }

  const sessionLabel = getThreadSessionLabel(thread);
  if (sessionLabel) {
    return sessionLabel;
  }

  return cleanRealThreadTitleCandidate(thread?.sessionName || thread?.title, thread)
    || defaultThreadTitle(getThreadTerminalIndex(thread) || 0, thread?.currentAgent || DEFAULT_AGENT_ID);
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

export function getWorkspaceThreadLatestTurn(thread) {
  return normalizeThreadLatestTurn(thread?.latestTurn);
}

export function getWorkspaceThreadTurnState(thread) {
  return normalizeThreadLatestTurn(thread?.latestTurn)?.state || "";
}

export { THREAD_AGENT_IDS, WORKSPACE_THREADS_STORAGE_KEY };

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { getWorkspaceThreadProviderBinding } from "../../threads/workspaceThreads";
import { logBigViewSyncDiagnosticEvent } from "../../threads/bigViewSyncDiagnostics";
import {
  MAX_WORKSPACE_TERMINAL_COUNT,
  MIN_WORKSPACE_TERMINAL_COUNT,
  TERMINAL_AGENT_COLOR_SLOT_COUNT,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
  TERMINAL_PROMPT_SUBMITTED_EVENT,
  TODO_DRAG_MIME,
  WORKSPACE_TERMINAL_PANE_PREFIX,
  WORKSPACE_TERMINAL_PRIMARY_COLUMNS,
  WORKSPACE_TERMINAL_WIDE_COLUMNS,
  WORKSPACE_TERMINAL_WIDE_START_INDEX,
  WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT,
  getTerminalAgentKind,
  logThreadBridgeDiagnostic,
} from "./terminalCore.js";

export function normalizeWorkspaceTerminalCount(value) {
  const count = Number.parseInt(value, 10);

  if (!Number.isFinite(count)) {
    return MIN_WORKSPACE_TERMINAL_COUNT;
  }

  return Math.min(MAX_WORKSPACE_TERMINAL_COUNT, Math.max(MIN_WORKSPACE_TERMINAL_COUNT, count));
}

function getSafePaneToken(value) {
  const token = String(value || "workspace")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 48);

  return token || "workspace";
}

export function getWorkspaceTerminalPaneId(workspaceId, terminalIndex, agentId = "agent") {
  return `${WORKSPACE_TERMINAL_PANE_PREFIX}-${getSafePaneToken(workspaceId)}-${terminalIndex}-${agentId || "agent"}`;
}

export function getDefaultTerminalIndexes(count) {
  const terminalCount = normalizeWorkspaceTerminalCount(count);

  return Array.from({ length: terminalCount }, (_, index) => index);
}

export function normalizeWorkspaceTerminalIndexes(indexes, count) {
  const terminalCount = normalizeWorkspaceTerminalCount(count);
  const usedIndexes = new Set();
  const normalizedIndexes = [];

  if (Array.isArray(indexes)) {
    indexes.forEach((index) => {
      const terminalIndex = Number.parseInt(index, 10);

      if (
        Number.isInteger(terminalIndex)
        && terminalIndex >= 0
        && terminalIndex < MAX_WORKSPACE_TERMINAL_COUNT
        && !usedIndexes.has(terminalIndex)
      ) {
        usedIndexes.add(terminalIndex);
        normalizedIndexes.push(terminalIndex);
      }
    });
  }

  let nextIndex = 0;

  while (normalizedIndexes.length < terminalCount) {
    if (!usedIndexes.has(nextIndex)) {
      usedIndexes.add(nextIndex);
      normalizedIndexes.push(nextIndex);
    }

    nextIndex += 1;
  }

  return normalizedIndexes.slice(0, terminalCount);
}

export function getTerminalPanelRows(terminalIndexes) {
  const indexes = Array.isArray(terminalIndexes)
    ? terminalIndexes
    : getDefaultTerminalIndexes(terminalIndexes);
  const visibleIndexes = indexes.length ? indexes : getDefaultTerminalIndexes(MIN_WORKSPACE_TERMINAL_COUNT);
  const rows = new Map();

  visibleIndexes.forEach((terminalIndex) => {
    const safeIndex = Math.max(0, Number.parseInt(terminalIndex, 10) || 0);
    const isPrimarySlot = safeIndex < WORKSPACE_TERMINAL_WIDE_START_INDEX;
    const rowIndex = isPrimarySlot
      ? Math.floor(safeIndex / WORKSPACE_TERMINAL_PRIMARY_COLUMNS)
      : Math.floor(WORKSPACE_TERMINAL_WIDE_START_INDEX / WORKSPACE_TERMINAL_PRIMARY_COLUMNS)
        + Math.floor((safeIndex - WORKSPACE_TERMINAL_WIDE_START_INDEX) / WORKSPACE_TERMINAL_WIDE_COLUMNS);
    const columnIndex = isPrimarySlot
      ? safeIndex % WORKSPACE_TERMINAL_PRIMARY_COLUMNS
      : (safeIndex - WORKSPACE_TERMINAL_WIDE_START_INDEX) % WORKSPACE_TERMINAL_WIDE_COLUMNS;

    if (!rows.has(rowIndex)) {
      rows.set(rowIndex, []);
    }

    rows.get(rowIndex).push({ columnIndex, terminalIndex: safeIndex });
  });

  return Array.from(rows.entries())
    .sort(([leftRow], [rightRow]) => leftRow - rightRow)
    .map(([rowIndex, rowTerminals]) => ({
      rowIndex,
      terminalIndexes: rowTerminals
        .sort((left, right) => left.columnIndex - right.columnIndex)
        .map(({ terminalIndex }) => terminalIndex),
    }));
}

export function normalizeTerminalDimension(value, fallback, minimum, maximum) {
  const dimension = Number.isFinite(value) ? Math.floor(value) : fallback;

  return Math.min(maximum, Math.max(minimum, dimension));
}

export function getTerminalPaneMinSizePercent(panelCount) {
  const count = Math.max(1, Number.parseInt(panelCount, 10) || 1);
  const fairShare = 100 / count;
  const minimum = Math.max(5, Math.min(18, fairShare * 0.55));

  return `${minimum.toFixed(2)}%`;
}

export {
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
};

export function isTerminalGeneratedReplyInput(data) {
  const text = String(data || "");

  return /^\x1b\[\d+;\d+R$/.test(text)
    || /^\x1b\[\??[0-9;]*c$/.test(text)
    || /^(?:(?:\x1b\]|\u009d)[\s\S]*?(?:\x07|\x1b\\|\u009c))+$/.test(text);
}

export function stripTerminalGeneratedReplyText(value) {
  return String(value || "")
    .replace(/(?:\x1b\]|\u009d)[\s\S]*?(?:\x07|\x1b\\|\u009c)/g, "")
    .replace(/\\?\]?(?:10|11|12);rgb:[0-9a-fA-F/]+\\?/g, " ")
    .replace(/\brgb:[0-9a-fA-F/]+\b/g, " ");
}

export function isTerminalGeneratedReplyVisibleText(value) {
  const text = String(value || "").trim();
  return Boolean(text)
    && (/\\?\]?(?:10|11|12);rgb:[0-9a-fA-F/]+/i.test(text)
      || /\brgb:[0-9a-fA-F/]+\b/i.test(text));
}

export function terminalInputChunkVisibleText(data) {
  const rawText = String(data || "");
  const rawLooksTerminalGenerated = /\\?\]?(?:10|11|12);rgb:[0-9a-fA-F/]+/i.test(rawText)
    || /\brgb:[0-9a-fA-F/]+\b/i.test(rawText);
  const strippedText = stripTerminalGeneratedReplyText(rawText);
  const visibleText = strippedText
    .replace(/(?:\x1b\]|\u009d)[\s\S]*?(?:\x07|\x1b\\|\u009c)/g, "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[\u0000-\u0008\u000b-\u001F\u007F]/g, "");

  if (rawLooksTerminalGenerated && !visibleText.trim()) {
    return "";
  }

  return isTerminalGeneratedReplyVisibleText(visibleText) ? "" : visibleText;
}

export function terminalInputChunkHasVisibleText(data) {
  return terminalInputChunkVisibleText(data).length > 0;
}

export function applyTerminalInputChunkToDraft(draft, data) {
  const text = String(data || "");
  if (text.includes("\x15")) {
    return "";
  }
  if (text === "\x7f" || text === "\b") {
    return draft.slice(0, -1);
  }

  const visibleText = terminalInputChunkVisibleText(text);
  if (!visibleText) {
    return draft;
  }

  return `${draft}${visibleText}`;
}

export function getTerminalKeyDebugFields(event, extraFields = {}) {
  return {
    altKey: Boolean(event.altKey),
    code: event.code || "",
    ctrlKey: Boolean(event.ctrlKey),
    defaultPrevented: Boolean(event.defaultPrevented),
    isComposing: Boolean(event.isComposing),
    key: event.key || "",
    metaKey: Boolean(event.metaKey),
    repeat: Boolean(event.repeat),
    shiftKey: Boolean(event.shiftKey),
    targetTag: event.target?.tagName || "",
    ...extraFields,
  };
}

export function isPlainShiftEnterEvent(event) {
  return event.key === "Enter"
    && event.shiftKey
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.isComposing;
}

const workspaceThreadComposerDraftStore = new Map();
const workspaceThreadComposerDraftSubscribers = new Set();
const workspaceThreadComposerAttachmentStore = new Map();
const workspaceThreadComposerAttachmentSubscribers = new Set();

export function getWorkspaceThreadComposerDraftStore() {
  return workspaceThreadComposerDraftStore;
}

export function getWorkspaceThreadComposerDraftSnapshot() {
  return Object.fromEntries(workspaceThreadComposerDraftStore.entries());
}

function getComposerAttachmentLogSummary(attachments) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => ({
      dataUrlLength: String(attachment?.dataUrl || "").length,
      id: String(attachment?.id || ""),
      mimeType: String(attachment?.mimeType || ""),
      name: String(attachment?.name || ""),
      savedPathPresent: Boolean(attachment?.savedPath),
      size: Number(attachment?.size || 0),
      source: String(attachment?.source || ""),
      status: String(attachment?.status || ""),
    }))
    .slice(0, 12);
}

function createComposerAttachmentId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `attachment-${crypto.randomUUID()}`;
  }

  return `attachment-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

function normalizeWorkspaceThreadComposerAttachment(attachment, index = 0) {
  if (!attachment || typeof attachment !== "object") {
    return null;
  }

  const dataUrl = String(attachment.dataUrl || attachment.src || attachment.imageDataUrl || "").trim();
  const savedPath = String(attachment.savedPath || attachment.path || "").trim();
  const mimeType = String(attachment.mimeType || attachment.type || "").trim()
    || dataUrl.match(/^data:([^;]+);/i)?.[1]
    || "";
  const name = String(attachment.name || `image-${index + 1}`).trim() || `image-${index + 1}`;

  if (!dataUrl && !savedPath) {
    return null;
  }

  return {
    dataUrl,
    id: String(attachment.id || createComposerAttachmentId()),
    mimeType,
    name,
    savedPath,
    size: Number(attachment.size || 0),
    source: String(attachment.source || "unknown"),
    status: String(attachment.status || "queued"),
  };
}

function normalizeWorkspaceThreadComposerAttachments(attachments) {
  const seenIds = new Set();

  return (Array.isArray(attachments) ? attachments : [])
    .map(normalizeWorkspaceThreadComposerAttachment)
    .filter((attachment) => {
      if (!attachment || seenIds.has(attachment.id)) {
        return false;
      }

      seenIds.add(attachment.id);
      return true;
    });
}

export function getWorkspaceThreadComposerAttachmentStore() {
  return workspaceThreadComposerAttachmentStore;
}

export function getWorkspaceThreadComposerAttachmentSnapshot() {
  return Object.fromEntries(
    Array.from(workspaceThreadComposerAttachmentStore.entries()).map(([key, attachments]) => [
      key,
      attachments.slice(),
    ]),
  );
}

export function getWorkspaceThreadComposerAttachments(syncKey) {
  const key = String(syncKey || "");
  return key ? (workspaceThreadComposerAttachmentStore.get(key) || []).slice() : [];
}

function notifyWorkspaceThreadComposerDraftSubscribers() {
  workspaceThreadComposerDraftSubscribers.forEach((listener) => {
    try {
      listener();
    } catch (_) {
      // Keep one broken subscriber from muting the shared composer bridge.
    }
  });
}

function notifyWorkspaceThreadComposerAttachmentSubscribers() {
  workspaceThreadComposerAttachmentSubscribers.forEach((listener) => {
    try {
      listener();
    } catch (_) {
      // Keep one broken subscriber from muting the shared attachment bridge.
    }
  });
}

export function subscribeWorkspaceThreadComposerDrafts(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  workspaceThreadComposerDraftSubscribers.add(listener);
  return () => {
    workspaceThreadComposerDraftSubscribers.delete(listener);
  };
}

export function subscribeWorkspaceThreadComposerAttachments(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  workspaceThreadComposerAttachmentSubscribers.add(listener);
  return () => {
    workspaceThreadComposerAttachmentSubscribers.delete(listener);
  };
}

export function setWorkspaceThreadComposerDraft(syncKey, value) {
  const key = String(syncKey || "");
  if (!key) {
    return;
  }

  const nextValue = String(value || "");
  const currentValue = workspaceThreadComposerDraftStore.get(key) || "";
  if (currentValue === nextValue) {
    return;
  }

  if (nextValue) {
    workspaceThreadComposerDraftStore.set(key, nextValue);
  } else {
    workspaceThreadComposerDraftStore.delete(key);
  }
  notifyWorkspaceThreadComposerDraftSubscribers();
}

export function setWorkspaceThreadComposerAttachments(syncKey, attachments, options = {}) {
  const key = String(syncKey || "");
  if (!key) {
    logBigViewSyncDiagnosticEvent("bigview.image.shared_attachment_set_skip", {
      reason: "missing_sync_key",
      source: options.source || "unspecified",
    });
    return [];
  }

  const nextAttachments = normalizeWorkspaceThreadComposerAttachments(attachments);
  const currentAttachments = workspaceThreadComposerAttachmentStore.get(key) || [];
  const currentSignature = JSON.stringify(getComposerAttachmentLogSummary(currentAttachments));
  const nextSignature = JSON.stringify(getComposerAttachmentLogSummary(nextAttachments));
  const changed = currentSignature !== nextSignature;

  logBigViewSyncDiagnosticEvent("bigview.image.shared_attachment_set", {
    attachmentCountAfter: nextAttachments.length,
    attachmentCountBefore: currentAttachments.length,
    attachments: getComposerAttachmentLogSummary(nextAttachments),
    changed,
    reason: options.reason || "",
    source: options.source || "unspecified",
    syncKey: key,
    ...(options.fields || {}),
  });

  if (!changed) {
    return nextAttachments;
  }

  if (nextAttachments.length) {
    workspaceThreadComposerAttachmentStore.set(key, nextAttachments);
  } else {
    workspaceThreadComposerAttachmentStore.delete(key);
  }
  notifyWorkspaceThreadComposerAttachmentSubscribers();
  return nextAttachments;
}

export function appendWorkspaceThreadComposerAttachments(syncKey, attachments, options = {}) {
  const key = String(syncKey || "");
  const currentAttachments = key ? workspaceThreadComposerAttachmentStore.get(key) || [] : [];
  const incomingAttachments = normalizeWorkspaceThreadComposerAttachments(attachments);
  const maxCount = Number.isFinite(Number(options.maxCount)) ? Math.max(0, Number(options.maxCount)) : 8;
  const nextAttachments = currentAttachments.concat(incomingAttachments).slice(0, maxCount);

  logBigViewSyncDiagnosticEvent("bigview.image.shared_attachment_append", {
    attachmentCountBefore: currentAttachments.length,
    incomingAttachmentCount: incomingAttachments.length,
    incomingAttachments: getComposerAttachmentLogSummary(incomingAttachments),
    maxCount,
    source: options.source || "unspecified",
    syncKey: key,
    ...(options.fields || {}),
  });

  return setWorkspaceThreadComposerAttachments(key, nextAttachments, {
    ...options,
    reason: options.reason || "append",
  });
}

export function removeWorkspaceThreadComposerAttachment(syncKey, attachmentId, options = {}) {
  const key = String(syncKey || "");
  const safeAttachmentId = String(attachmentId || "");
  const currentAttachments = key ? workspaceThreadComposerAttachmentStore.get(key) || [] : [];
  const removedAttachment = currentAttachments.find((attachment) => attachment.id === safeAttachmentId) || null;
  const nextAttachments = currentAttachments.filter((attachment) => attachment.id !== safeAttachmentId);

  logBigViewSyncDiagnosticEvent("bigview.image.shared_attachment_remove", {
    attachmentCountAfter: nextAttachments.length,
    attachmentCountBefore: currentAttachments.length,
    removedAttachment: getComposerAttachmentLogSummary([removedAttachment])[0] || null,
    source: options.source || "unspecified",
    syncKey: key,
    ...(options.fields || {}),
  });

  return setWorkspaceThreadComposerAttachments(key, nextAttachments, {
    ...options,
    reason: options.reason || "remove",
  });
}

export function createThreadProjectionToken(prefix = "projection") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

export function buildProviderTurnStartProjectionEvents({
  agentId,
  includeUserMessage = true,
  source = "provider-api",
  startedAt,
  text,
  turnId,
  userMessageId,
}) {
  const safeText = String(text || "").trim();
  const safeStartedAt = startedAt || new Date().toISOString();
  const safeTurnId = turnId || createThreadProjectionToken("turn");
  const safeUserMessageId = userMessageId || createThreadProjectionToken("message-user");

  const events = [
    {
      agentId,
      createdAt: safeStartedAt,
      id: `projection-provider-turn-started-${safeTurnId}`,
      messageId: safeUserMessageId,
      source,
      status: "running",
      turnId: safeTurnId,
      type: "thread.turn.started",
    },
  ];

  if (includeUserMessage) {
    events.push({
      agentId,
      createdAt: safeStartedAt,
      id: `projection-provider-user-${safeUserMessageId}`,
      messageId: safeUserMessageId,
      role: "user",
      source,
      status: "submitted",
      text: safeText,
      turnId: safeTurnId,
      type: "thread.message.user",
    });
  }

  return events;
}

export function buildProviderTurnProjectionEvents({
  agentId,
  assistantMessageId,
  completedAt,
  output,
  source = "provider-api",
  startedAt,
  text,
  turnId,
  userMessageId,
}) {
  const safeText = String(text || "").trim();
  const safeOutput = String(output || "").trim() || "(No output returned.)";
  const safeStartedAt = startedAt || new Date().toISOString();
  const safeCompletedAt = completedAt || safeStartedAt;
  const safeTurnId = turnId || createThreadProjectionToken("turn");
  const safeUserMessageId = userMessageId || createThreadProjectionToken("message-user");
  const safeAssistantMessageId = assistantMessageId || createThreadProjectionToken("message-assistant");

  return [
    ...buildProviderTurnStartProjectionEvents({
      agentId,
      source,
      startedAt: safeStartedAt,
      text: safeText,
      turnId: safeTurnId,
      userMessageId: safeUserMessageId,
    }),
    {
      agentId,
      createdAt: safeCompletedAt,
      delta: safeOutput,
      id: `projection-provider-assistant-delta-${safeAssistantMessageId}`,
      messageId: safeAssistantMessageId,
      source,
      status: "streaming",
      text: safeOutput,
      turnId: safeTurnId,
      type: "thread.message.assistant.delta",
    },
    {
      agentId,
      createdAt: safeCompletedAt,
      id: `projection-provider-assistant-complete-${safeAssistantMessageId}`,
      messageId: safeAssistantMessageId,
      source,
      status: "complete",
      text: safeOutput,
      turnId: safeTurnId,
      type: "thread.message.assistant.complete",
    },
    {
      agentId,
      assistantMessageId: safeAssistantMessageId,
      completedAt: safeCompletedAt,
      createdAt: safeCompletedAt,
      id: `projection-provider-turn-completed-${safeTurnId}`,
      messageId: safeUserMessageId,
      source,
      status: "completed",
      turnId: safeTurnId,
      type: "thread.turn.completed",
    },
  ];
}

export function buildProviderTurnErrorProjectionEvents({
  agentId,
  completedAt,
  error,
  source = "provider-api",
  turnId,
  userMessageId,
}) {
  const safeCompletedAt = completedAt || new Date().toISOString();
  const safeTurnId = turnId || createThreadProjectionToken("turn");
  const safeUserMessageId = userMessageId || createThreadProjectionToken("message-user");
  const safeError = String(error || "Unable to send message through the provider session.").trim();

  return [
    {
      agentId,
      completedAt: safeCompletedAt,
      createdAt: safeCompletedAt,
      id: `projection-provider-turn-error-${safeTurnId}`,
      messageId: safeUserMessageId,
      source,
      status: "error",
      text: safeError,
      turnId: safeTurnId,
      type: "thread.turn.error",
    },
  ];
}

export const TERMINAL_PROMPT_ACCEPT_RETRY_DELAYS_MS = [2800, 6500];

function delayThreadBridgeMs(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(delayMs) || 0));
  });
}

export async function createTerminalPromptSubmittedWaiter({
  agentId = "",
  expectedPrompt = "",
  instanceId,
  paneId,
  promptId,
  threadId,
  timeoutMs = 6000,
  workspaceId = "",
}) {
  const safePromptId = String(promptId || "").trim();
  const safePaneId = String(paneId || "").trim();
  const safeThreadId = String(threadId || "").trim();
  const safeExpectedPrompt = String(expectedPrompt || "").trim();
  let settled = false;
  let timeoutId = 0;
  let unlistenPromptSubmitted = null;
  let resolvePromptSubmitted = null;
  let rejectPromptSubmitted = null;

  const promise = new Promise((resolve, reject) => {
    resolvePromptSubmitted = resolve;
    rejectPromptSubmitted = reject;
    timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      unlistenPromptSubmitted?.();
      logThreadBridgeDiagnostic("frontend.bridge.submit.confirm_timeout", {
        agentId,
        expectedPromptLength: safeExpectedPrompt.length,
        instanceId: instanceId || "",
        paneId: safePaneId,
        promptId: safePromptId,
        threadId: safeThreadId,
        timeoutMs,
        workspaceId,
      });
      reject(new Error("Timed out waiting for the prompt to be observed in the terminal."));
    }, Math.max(1000, timeoutMs));
  });

  try {
    const unlisten = await listen(TERMINAL_PROMPT_SUBMITTED_EVENT, (event) => {
      const payload = event?.payload || {};
      const eventPromptId = String(payload.promptEventId || "").trim();
      const eventPaneId = String(payload.paneId || "").trim();
      const eventThreadId = String(payload.threadId || "").trim();
      const eventInstanceId = Number(payload.instanceId);
      const promptMatches = !safePromptId || eventPromptId === safePromptId;
      const paneMatches = !safePaneId || eventPaneId === safePaneId;
      const threadMatches = !safeThreadId || eventThreadId === safeThreadId;
      const instanceMatches = !Number.isFinite(Number(instanceId))
        || eventInstanceId === Number(instanceId);

      if (!promptMatches || !paneMatches || !threadMatches || !instanceMatches || settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      unlistenPromptSubmitted?.();
      logThreadBridgeDiagnostic("frontend.bridge.submit.confirmed", {
        agentId,
        instanceId: eventInstanceId,
        observedPromptLength: String(payload.prompt || "").trim().length,
        paneId: eventPaneId,
        promptId: eventPromptId,
        threadId: eventThreadId,
        workspaceId: payload.workspaceId || workspaceId || "",
      });
      resolvePromptSubmitted?.(payload);
    });
    if (settled) {
      unlisten();
    } else {
      unlistenPromptSubmitted = unlisten;
    }
  } catch (error) {
    if (!settled) {
      settled = true;
      window.clearTimeout(timeoutId);
      rejectPromptSubmitted?.(error);
    }
  }

  return {
    cancel() {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      unlistenPromptSubmitted?.();
    },
    promise,
  };
}

export function createWorkspaceThreadPromptAcceptedWaiter({
  agentId = "",
  expectedPrompt = "",
  promptId,
  threadId,
  timeoutMs = 20000,
  workspaceId = "",
}) {
  const safeAgentId = getTerminalAgentKind(agentId);
  const safePromptId = String(promptId || "").trim();
  const safeThreadId = String(threadId || "").trim();
  const safeWorkspaceId = String(workspaceId || "").trim();
  const safeExpectedPrompt = String(expectedPrompt || "").trim();
  let settled = false;
  let timeoutId = 0;

  let resolveAccepted = null;
  let rejectAccepted = null;

  const cleanup = () => {
    window.clearTimeout(timeoutId);
    window.removeEventListener(WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT, handlePromptAccepted);
  };

  const handlePromptAccepted = (event) => {
    const detail = event?.detail || {};
    const eventPromptId = String(detail.promptEventId || "").trim();
    const eventThreadId = String(detail.threadId || "").trim();
    const eventWorkspaceId = String(detail.workspaceId || "").trim();
    const eventAgentId = getTerminalAgentKind(detail.agentId || "");
    const promptMatches = !safePromptId || eventPromptId === safePromptId;
    const threadMatches = !safeThreadId || eventThreadId === safeThreadId;
    const workspaceMatches = !safeWorkspaceId || eventWorkspaceId === safeWorkspaceId;
    const agentMatches = !safeAgentId || eventAgentId === safeAgentId;

    if (!promptMatches || !threadMatches || !workspaceMatches || !agentMatches || settled) {
      return;
    }

    settled = true;
    cleanup();
    logThreadBridgeDiagnostic("frontend.bridge.accept.confirmed", {
      agentId: eventAgentId,
      expectedPromptLength: safeExpectedPrompt.length,
      matchedBy: detail.matchedBy || "",
      promptId: eventPromptId,
      sessionIdPresent: Boolean(detail.sessionId),
      threadId: eventThreadId,
      workspaceId: eventWorkspaceId,
    });
    resolveAccepted?.(detail);
  };

  const promise = new Promise((resolve, reject) => {
    resolveAccepted = resolve;
    rejectAccepted = reject;
    window.addEventListener(WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT, handlePromptAccepted);
    timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      logThreadBridgeDiagnostic("frontend.bridge.accept.confirm_timeout", {
        agentId: safeAgentId,
        expectedPromptLength: safeExpectedPrompt.length,
        promptId: safePromptId,
        threadId: safeThreadId,
        timeoutMs,
        workspaceId: safeWorkspaceId,
      });
      reject(new Error("Timed out waiting for the prompt to appear in the agent session."));
    }, Math.max(3000, timeoutMs));
  });

  return {
    cancel() {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
    },
    promise,
  };
}

export async function waitForWorkspaceThreadPromptAcceptedWithEnterRetries({
  acceptedWaiter,
  agentId = "",
  binding,
  expectedPrompt = "",
  getDraftValue,
  isGenericTerminal = false,
  logPrefix = "frontend.thread_submit",
  promptId,
  retryDelaysMs = TERMINAL_PROMPT_ACCEPT_RETRY_DELAYS_MS,
  submitSequence,
  threadId,
  workspaceId = "",
}) {
  const safePrompt = String(expectedPrompt || "").trim();
  const safeSubmitSequence = String(submitSequence || "");
  const safePromptId = String(promptId || "").trim();
  const safeThreadId = String(threadId || "").trim();
  const safeAgentId = getTerminalAgentKind(agentId);
  const retryDelays = Array.isArray(retryDelaysMs) ? retryDelaysMs : [];
  const acceptedPromise = acceptedWaiter.promise.then((detail) => ({
    detail,
    kind: "accepted",
  }));

  for (let retryIndex = 0; retryIndex < retryDelays.length; retryIndex += 1) {
    const retryDelayMs = Math.max(0, Number(retryDelays[retryIndex]) || 0);
    const outcome = await Promise.race([
      acceptedPromise,
      delayThreadBridgeMs(retryDelayMs).then(() => ({
        kind: "retry",
        retryDelayMs,
        retryIndex,
      })),
    ]);

    if (outcome.kind === "accepted") {
      return outcome.detail;
    }

    const currentDraft = String(
      typeof getDraftValue === "function" ? getDraftValue() : "",
    ).trim();
    if (currentDraft !== safePrompt) {
      logThreadBridgeDiagnostic(`${logPrefix}.enter_retry_blocked`, {
        agentId: safeAgentId,
        bindingInstanceId: binding?.instanceId || "",
        bindingPaneId: binding?.paneId || "",
        currentDraftLength: currentDraft.length,
        expectedPromptLength: safePrompt.length,
        promptId: safePromptId,
        reason: "composer_not_synced_to_prompt",
        retryDelayMs,
        retryIndex: retryIndex + 1,
        sendPolicy: "terminal-confirmed-and-session-accepted",
        threadId: safeThreadId,
        workspaceId,
      });
      continue;
    }

    if (!safeSubmitSequence || isGenericTerminal || !binding?.paneId || !binding?.instanceId) {
      logThreadBridgeDiagnostic(`${logPrefix}.enter_retry_blocked`, {
        agentId: safeAgentId,
        bindingInstanceId: binding?.instanceId || "",
        bindingPaneId: binding?.paneId || "",
        expectedPromptLength: safePrompt.length,
        hasSubmitSequence: Boolean(safeSubmitSequence),
        isGenericTerminal,
        promptId: safePromptId,
        reason: "missing_live_tui_submit_target",
        retryDelayMs,
        retryIndex: retryIndex + 1,
        sendPolicy: "terminal-confirmed-and-session-accepted",
        threadId: safeThreadId,
        workspaceId,
      });
      continue;
    }

    logThreadBridgeDiagnostic(`${logPrefix}.enter_retry`, {
      agentId: safeAgentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      expectedPromptLength: safePrompt.length,
      promptId: safePromptId,
      retryDelayMs,
      retryIndex: retryIndex + 1,
      sendPolicy: "terminal-confirmed-and-session-accepted",
      threadId: safeThreadId,
      workspaceId,
    });
    await invoke("terminal_write", {
      data: safeSubmitSequence,
      instanceId: binding.instanceId,
      paneId: binding.paneId,
      promptEventId: safePromptId,
      promptEventText: safePrompt,
      threadId: safeThreadId,
    });
  }

  const finalOutcome = await acceptedPromise;
  return finalOutcome.detail;
}

export const TODO_DROP_OVERLAY_STYLE = {
  position: "absolute",
  inset: "10px",
  zIndex: 9,
  display: "grid",
  placeItems: "center",
  border: "1px dotted rgba(138, 216, 255, 0.46)",
  borderRadius: "14px",
  background: "rgba(2, 8, 14, 0.18)",
  boxShadow: "inset 0 0 0 1px rgba(138, 216, 255, 0.08)",
  pointerEvents: "none",
};
export const TODO_DROP_OVERLAY_TARGET_STYLE = {
  border: "2px dotted rgba(138, 216, 255, 0.94)",
  background: "rgba(2, 8, 14, 0.54)",
  boxShadow: "inset 0 0 0 1px rgba(255, 173, 124, 0.24), 0 0 32px rgba(138, 216, 255, 0.12)",
};
export const TODO_DROP_OVERLAY_LABEL_STYLE = {
  border: "1px solid rgba(138, 216, 255, 0.3)",
  borderRadius: "999px",
  padding: "8px 12px",
  color: "#e9f8ff",
  background: "linear-gradient(135deg, rgba(6, 16, 26, 0.96), rgba(28, 16, 10, 0.92))",
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};
export const TERMINAL_SCROLLBAR_PLATFORM = "native";
export const TERMINAL_ROLE_SWITCH_OPTIONS = [
  { id: "codex", label: "Codex"},
  { id: "claude", label: "Claude Code" },
  { id: "generic", label: "Terminal" },
  { id: "opencode", label: "OpenCode" },
];
export const TERMINAL_CONTROL_SELECTOR = "[data-terminal-control='true']";
export const TERMINAL_FULLSCREEN_RESIZE_DELAYS_MS = [0, 80, 190, 280];

export function getErrorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

export function getDraggedTodoPrompt(dataTransfer) {
  const customPayload = dataTransfer?.getData(TODO_DRAG_MIME);
  if (customPayload) {
    try {
      const parsed = JSON.parse(customPayload);
      const text = String(parsed?.text || "").trim();
      if (text) {
        return text;
      }
    } catch (_error) {
      const text = String(customPayload || "").trim();
      if (text) {
        return text;
      }
    }
  }

  return String(dataTransfer?.getData("text/plain") || "").trim();
}

export function isTodoDragTransfer(dataTransfer) {
  const transferTypes = Array.from(dataTransfer?.types || []);
  return transferTypes.includes(TODO_DRAG_MIME) || transferTypes.includes("text/plain");
}

export function isTerminalSessionMissingError(error) {
  const message = getErrorMessage(error, "").toLowerCase();

  return message.includes("terminal session is not running")
    || message.includes("terminal session not running");
}

let nextWorkspaceTerminalInstanceId = 1;

export function getTerminalSubmitSequence(_agentKind, isGenericTerminal = false) {
  if (isGenericTerminal) {
    return "";
  }

  return "\r";
}

export function buildTerminalSubmittedInput(text, agentKind, isGenericTerminal = false) {
  return `${text}${getTerminalSubmitSequence(agentKind, isGenericTerminal)}`;
}

export function getWorkspaceThreadTerminalTarget({
  fallbackWorkspace,
  terminalAgentKind,
  targetThread,
  targetWorkspace,
  workspaceThreads,
}) {
  const targetWorkspaceId = targetThread?.workspaceId || targetWorkspace?.id || fallbackWorkspace?.id || "";
  const workspaceThreadEntry = workspaceThreads?.[targetWorkspaceId];
  const latestThread = workspaceThreadEntry?.threads?.[targetThread?.id] || targetThread;
  const agentId = getTerminalAgentKind(latestThread?.currentAgent || targetThread?.currentAgent || terminalAgentKind);
  const providerBinding = getWorkspaceThreadProviderBinding(latestThread, agentId);
  const targetTerminalIndex = Number.parseInt(
    latestThread?.terminalIndex
      ?? latestThread?.terminalBinding?.terminalIndex
      ?? providerBinding?.terminalBinding?.terminalIndex
      ?? targetThread?.terminalIndex
      ?? targetThread?.terminalBinding?.terminalIndex,
    10,
  );
  const liveTerminal = Number.isInteger(targetTerminalIndex)
    ? workspaceThreadEntry?.terminals?.[String(targetTerminalIndex)]
    : null;
  const liveTerminalBinding = liveTerminal?.paneId
    && liveTerminal?.instanceId
    && liveTerminal.threadId === latestThread?.id
    && ["active", "starting"].includes(String(liveTerminal.status || "").toLowerCase())
    ? {
      instanceId: liveTerminal.instanceId,
      paneId: liveTerminal.paneId,
      terminalIndex: liveTerminal.terminalIndex,
    }
    : null;

  return {
    agentId,
    binding: liveTerminalBinding,
    latestThread,
    providerBinding,
    targetTerminalIndex,
    targetWorkspaceId,
    workspaceThreadEntry,
  };
}

export function getThreadComposerSyncKey(thread, binding) {
  return [
    thread?.workspaceId || "",
    thread?.id || "",
    binding?.paneId || "",
  ].join(":");
}

export function getAgentTone(agent) {
  if (!agent?.installed) {
    return "offline";
  }

  return agent.authenticated ? "ready" : "needsAuth";
}

export function getAgentStatusSummary(agentStatuses) {
  if (!Array.isArray(agentStatuses)) {
    return [];
  }

  const codex = agentStatuses.find((agent) => agent.id === "codex");
  const claude = agentStatuses.find((agent) => agent.id === "claude");
  const opencode = agentStatuses.find((agent) => agent.id === "opencode");

  return [codex, claude, opencode].filter(Boolean);
}

export function getTerminalRoleSwitchOptions(agentStatuses) {
  const installedAgentIds = new Set(
    (Array.isArray(agentStatuses) ? agentStatuses : [])
      .filter((agent) => agent.installed)
      .map((agent) => agent.id),
  );

  return TERMINAL_ROLE_SWITCH_OPTIONS.filter((option) => (
    option.id === "generic" || installedAgentIds.has(option.id)
  ));
}

export function getTerminalAgentColorSlot(terminalIndex) {
  const safeIndex = Math.max(0, Number.parseInt(terminalIndex, 10) || 0);

  return String(safeIndex % TERMINAL_AGENT_COLOR_SLOT_COUNT);
}

export function getEventTargetElement(target) {
  if (typeof Element !== "undefined" && target instanceof Element) {
    return target;
  }

  if (typeof Node !== "undefined" && target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

export function isTerminalControlEventTarget(target) {
  return Boolean(getEventTargetElement(target)?.closest?.(TERMINAL_CONTROL_SELECTOR));
}

export function getPlainDomRect(rect) {
  if (!rect) {
    return null;
  }

  return {
    height: Number(rect.height) || 0,
    left: Number(rect.left) || 0,
    top: Number(rect.top) || 0,
    width: Number(rect.width) || 0,
  };
}

export function closeWorkspaceTerminalPane({
  agentId,
  nextTerminalCount,
  previousTerminalCount,
  reason,
  terminalIndex,
  waitForCleanup = false,
  workspaceId,
}) {
  const paneId = getWorkspaceTerminalPaneId(workspaceId, terminalIndex, agentId);


  return invoke("terminal_close", {
    paneId,
    waitForCleanup: waitForCleanup || undefined,
  })
    .then(() => {
      return { closed: true, paneId };
    })
    .catch((error) => {
      const message = getErrorMessage(error, "Unable to close removed terminal.");
      return { closed: false, error: message, paneId };
    });
}

export function getNextWorkspaceTerminalInstanceId() {
  const instanceId = nextWorkspaceTerminalInstanceId;
  nextWorkspaceTerminalInstanceId = nextWorkspaceTerminalInstanceId >= Number.MAX_SAFE_INTEGER
    ? 1
    : nextWorkspaceTerminalInstanceId + 1;

  return instanceId;
}

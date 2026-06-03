import {
  cleanLiveViewText,
  stripLiveViewControlSequences,
} from "../terminals/liveViewSanitizer.js";
import {
  isTerminalControlHistoryPrompt,
  isTerminalModelPickerUiPrompt,
} from "./terminalControlPrompts.js";

const WORKSPACE_THREADS_STORAGE_KEY = "diffforge.workspaceThreads.v1";
const MAX_THREAD_PROJECTION_EVENTS = 900;
const MAX_THREAD_MESSAGES = 360;
const MAX_THREADS_PER_WORKSPACE = 80;
const PASTED_LINES_MESSAGE_EQUIVALENCE_MAX_DELTA_MS = 90_000;
const THREAD_PROMPT_LABEL_MAX_WORDS = 6;
const THREAD_PROMPT_LABEL_MAX_CHARS = 48;
const THREAD_PROMPT_LABEL_ELLIPSIS = "...";
const DEFAULT_AGENT_ID = "codex";
const THREAD_AGENT_IDS = ["codex", "claude", "opencode"];
const LIVE_TERMINAL_STATUSES = new Set([
  "active",
  "closed",
  "closing",
  "error",
  "exited",
  "idle",
  "parked",
  "resume_ready",
  "resume_requested",
  "running",
  "starting",
]);
const PROMPTING_CLEARING_TERMINAL_EVENT_TYPES = new Set([
  "message-submitted",
  "pending-prompt-sent",
  "provider-turn-completed",
  "provider-turn-error",
  "provider-turn-interrupted",
  "provider-turn-started",
  "terminal-input-ready",
  "terminal-prompt-ready",
  "thread-starting",
]);
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
const CLOSED_THREAD_TURN_STATES = new Set(["completed", "error", "interrupted"]);

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value, fallback = "") {
  const text = String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return text || fallback;
}

function promptIdSuffixCanMatch(value) {
  return /^(todo-drop-prompt|spec-edit|voice-plan-task|voice-plan|prompt|pending-prompt)-/.test(
    cleanText(value),
  );
}

function workspaceThreadPromptIdsMatch(left, right) {
  const leftId = cleanText(left);
  const rightId = cleanText(right);
  if (!leftId || !rightId) {
    return false;
  }
  if (leftId === rightId) {
    return true;
  }
  if (leftId.endsWith(`-${rightId}`) && promptIdSuffixCanMatch(rightId)) {
    return true;
  }
  if (rightId.endsWith(`-${leftId}`) && promptIdSuffixCanMatch(leftId)) {
    return true;
  }
  const [shortId, longId] = leftId.length <= rightId.length
    ? [leftId, rightId]
    : [rightId, leftId];
  if (promptIdSuffixCanMatch(shortId) && longId.includes(shortId)) {
    return true;
  }
  return false;
}

function promptingUserActive(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return Boolean(fallback);
}

function normalizePromptingUserKind(value, fallback = "") {
  const kind = cleanText(value, fallback)
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
  return [
    "approval",
    "clarification",
    "confirmation",
    "model-picker",
    "permission",
    "terminal-control",
    "unknown",
  ].includes(kind) ? kind : "";
}

function promptingUserFields(value = {}, fallback = {}) {
  const active = promptingUserActive(
    value.terminalIsPromptingUser ?? value.promptingUser ?? value.requiresUserInput,
    fallback.terminalIsPromptingUser || fallback.promptingUser || fallback.requiresUserInput,
  );
  return {
    promptingUserConfidence: active
      ? cleanText(value.promptingUserConfidence || value.promptingConfidence, fallback.promptingUserConfidence || fallback.promptingConfidence)
      : "",
    promptingUserKind: active
      ? normalizePromptingUserKind(value.promptingUserKind || value.promptingKind, fallback.promptingUserKind || fallback.promptingKind || "unknown")
      : "",
    promptingUserSource: active
      ? cleanText(value.promptingUserSource || value.promptingSource || value.source, fallback.promptingUserSource || fallback.promptingSource)
      : "",
    promptingUserText: active
      ? cleanText(value.promptingUserText || value.promptingText, fallback.promptingUserText || fallback.promptingText).slice(0, 420)
      : "",
    terminalIsPromptingUser: active,
  };
}

function eventExplicitlyPromptsUser(event = {}) {
  return event?.terminalIsPromptingUser === true
    || event?.promptingUser === true
    || event?.requiresUserInput === true;
}

function promptingUserFieldsForTerminalEvent(event = {}, fallback = {}, options = {}) {
  const eventType = cleanText(options.eventType || event?.type).toLowerCase();
  const shouldClear = Boolean(
    options.clear === true
      || PROMPTING_CLEARING_TERMINAL_EVENT_TYPES.has(eventType)
      || event?.terminalIsPromptingUser === false
      || event?.promptingUser === false
      || event?.requiresUserInput === false,
  );
  const value = shouldClear && !eventExplicitlyPromptsUser(event)
    ? {
        ...event,
        promptingUser: false,
        requiresUserInput: false,
        terminalIsPromptingUser: false,
      }
    : event;
  return promptingUserFields(value, fallback);
}

function cleanMessageText(value, fallback = "") {
  const text = String(value || "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  return text || fallback;
}

const ATTACHMENT_MARKER_PATTERN = /\[(?:image|file)-attached(?:\s+\d+)?\]/i;
const PASTED_LINES_MARKER_PATTERN = /\[pasted-lines(?:\s+(\d+))?\]/i;

function createAttachmentReferencePattern() {
  return /\[((?:image|file)-attached)(?:\s+(\d+))?\]\s*(.*?)\s*->\s*([\s\S]*?)(?=\n\s*\[(?:image|file)-attached(?:\s+\d+)?\]|\s*$)/gi;
}

function normalizeAttachmentPathText(value) {
  return String(value || "")
    .trim()
    .replace(/[ \t]*\r?\n[ \t]*/g, "")
    .replace(/[ \t]+/g, " ");
}

function normalizeAttachmentEchoText(value, fallback = "") {
  const text = cleanMessageText(value);
  if (!text || !ATTACHMENT_MARKER_PATTERN.test(text)) {
    return text || fallback;
  }

  const prepared = text
    .replace(/([^\n])(?=\[(?:image|file)-attached(?:\s+\d+)?\])/gi, "$1\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const pattern = createAttachmentReferencePattern();
  const attachments = [];
  let firstAttachmentIndex = -1;
  let lastAttachmentEnd = 0;
  let match = pattern.exec(prepared);
  while (match) {
    if (firstAttachmentIndex === -1) {
      firstAttachmentIndex = match.index;
    }
    lastAttachmentEnd = pattern.lastIndex;

    const label = String(match[1] || "image-attached").trim().toLowerCase();
    const index = cleanText(match[2]);
    const name = cleanText(match[3], index ? `${label}-${index}` : label);
    const path = normalizeAttachmentPathText(match[4]);
    const marker = index ? `[${label} ${index}]` : `[${label}]`;
    attachments.push(`${marker} ${name} -> ${path}`.trim());
    match = pattern.exec(prepared);
  }

  if (!attachments.length) {
    return prepared || fallback;
  }

  const prefix = cleanMessageText(prepared.slice(0, firstAttachmentIndex));
  const suffix = cleanMessageText(prepared.slice(lastAttachmentEnd));
  return [
    prefix,
    attachments.join("\n"),
    suffix,
  ].filter(Boolean).join("\n\n") || fallback;
}

function attachmentMessageSignature(value) {
  const text = normalizeAttachmentEchoText(value);
  if (!text || !ATTACHMENT_MARKER_PATTERN.test(text)) {
    return null;
  }

  const pattern = createAttachmentReferencePattern();
  const references = [];
  let attachmentlessText = text;
  let match = pattern.exec(text);
  while (match) {
    const label = String(match[1] || "image-attached").trim().toLowerCase();
    const path = normalizeAttachmentPathText(match[4]).toLowerCase();
    const name = cleanText(match[3]).toLowerCase();
    references.push(`${label}:${path || name}`);
    attachmentlessText = attachmentlessText.replace(match[0], " ");
    match = pattern.exec(text);
  }

  if (!references.length) {
    return null;
  }

  return {
    attachments: references.sort().join("|"),
    prompt: cleanText(attachmentlessText).toLowerCase(),
  };
}

function isPromptTextNearMatch(left, right) {
  if (left === right || !left || !right) {
    return true;
  }

  if (Math.abs(left.length - right.length) > 2) {
    return false;
  }

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    edits += 1;
    if (edits > 2) {
      return false;
    }

    if (left.length > right.length) {
      leftIndex += 1;
    } else if (right.length > left.length) {
      rightIndex += 1;
    } else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  return edits + (left.length - leftIndex) + (right.length - rightIndex) <= 2;
}

function areAttachmentMessagesEquivalent(left, right) {
  const leftSignature = attachmentMessageSignature(left);
  const rightSignature = attachmentMessageSignature(right);
  return Boolean(
    leftSignature
    && rightSignature
    && leftSignature.attachments === rightSignature.attachments
    && isPromptTextNearMatch(leftSignature.prompt, rightSignature.prompt),
  );
}

function pastedLinesPlaceholderSignature(value) {
  const text = cleanMessageText(value);
  const match = PASTED_LINES_MARKER_PATTERN.exec(text);
  if (!match) {
    return null;
  }

  const suffix = text.slice(match.index + match[0].length).trim();
  if (suffix && !suffix.startsWith("->")) {
    return null;
  }

  return {
    lineCount: cleanText(match[1]),
    path: suffix.startsWith("->")
      ? normalizeAttachmentPathText(suffix.slice(2)).toLowerCase()
      : "",
    prompt: cleanText(text.slice(0, match.index)).toLowerCase(),
  };
}

function isPastedLinesPlaceholderText(value) {
  return Boolean(pastedLinesPlaceholderSignature(value));
}

function isPromptPrefixMatch(prompt, value) {
  const promptText = cleanText(prompt).toLowerCase();
  const text = cleanText(value).toLowerCase();
  if (!promptText || !text) {
    return false;
  }

  if (text === promptText || text.startsWith(`${promptText} `)) {
    return true;
  }

  return isPromptTextNearMatch(promptText, text.slice(0, promptText.length));
}

function arePastedLinesMessagesEquivalent(left, right, options = {}) {
  const leftSignature = pastedLinesPlaceholderSignature(left);
  const rightSignature = pastedLinesPlaceholderSignature(right);
  if (!leftSignature && !rightSignature) {
    return false;
  }

  if (leftSignature && rightSignature) {
    return Boolean(
      leftSignature.path
      && rightSignature.path
      && leftSignature.path === rightSignature.path,
    );
  }

  const placeholder = leftSignature || rightSignature;
  const bodyText = cleanText(leftSignature ? right : left).toLowerCase();
  if (!bodyText) {
    return false;
  }

  if (placeholder.prompt) {
    return isPromptPrefixMatch(placeholder.prompt, bodyText);
  }

  return options.allowEmptyPrompt === true;
}

function areThreadMessageTextsEquivalent(left, right) {
  const leftText = cleanMessageText(left);
  const rightText = cleanMessageText(right);
  return (
    leftText === rightText
    || areAttachmentMessagesEquivalent(leftText, rightText)
    || arePastedLinesMessagesEquivalent(leftText, rightText)
  );
}

function areThreadMessagesEquivalent(left, right, maxDeltaMs = 5000) {
  const leftRole = cleanText(left?.role).toLowerCase();
  const rightRole = cleanText(right?.role).toLowerCase();
  if (!areThreadMessagesSameTurn(left, right, maxDeltaMs)) {
    return arePastedLinesThreadMessagesEquivalent(left, right, maxDeltaMs);
  }

  return (
    areThreadMessageTextsEquivalent(left?.text, right?.text)
    || (
      leftRole === "user"
      && rightRole === "user"
      && arePastedLinesMessagesEquivalent(left?.text, right?.text, { allowEmptyPrompt: true })
    )
  );
}

function arePastedLinesThreadMessagesEquivalent(left, right, maxDeltaMs = 5000) {
  const leftRole = cleanText(left?.role).toLowerCase();
  const rightRole = cleanText(right?.role).toLowerCase();
  if (
    leftRole !== "user"
    || rightRole !== "user"
    || !arePastedLinesMessagesEquivalent(left?.text, right?.text, { allowEmptyPrompt: true })
  ) {
    return false;
  }

  const leftTimestamp = threadMessageTimestampMs(left);
  const rightTimestamp = threadMessageTimestampMs(right);
  if (!leftTimestamp || !rightTimestamp) {
    return false;
  }

  const effectiveMaxDeltaMs = Math.max(
    Math.max(0, Number(maxDeltaMs) || 0),
    PASTED_LINES_MESSAGE_EQUIVALENCE_MAX_DELTA_MS,
  );
  return Math.abs(leftTimestamp - rightTimestamp) <= effectiveMaxDeltaMs;
}

function shouldPreferIncomingPastedBody(existingText, incomingText) {
  return Boolean(
    isPastedLinesPlaceholderText(existingText)
    && !isPastedLinesPlaceholderText(incomingText)
    && arePastedLinesMessagesEquivalent(existingText, incomingText, { allowEmptyPrompt: true }),
  );
}

function chooseProjectedMessageText(existingText, incomingText) {
  if (shouldPreferIncomingPastedBody(existingText, incomingText)) {
    return cleanMessageText(incomingText);
  }

  if (shouldPreferIncomingPastedBody(incomingText, existingText)) {
    return cleanMessageText(existingText);
  }

  return cleanMessageText(incomingText);
}

function isTranscriptHistoryProjectionSource(source) {
  const safeSource = cleanText(source).toLowerCase();
  return Boolean(
    safeSource.endsWith("-session")
      || safeSource === "codex-rollout"
      || safeSource === "agent_thread_transcript"
      || THREAD_AGENT_IDS.includes(safeSource)
      || safeSource.includes("transcript")
      || safeSource.includes("session-history"),
  );
}

function isTranscriptHistoryProjectionEvent(event) {
  return Boolean(isTranscriptHistoryProjectionSource(event?.source));
}

function transcriptHistoryProjectionSource(agentId, source = "") {
  const safeSource = cleanText(source);
  if (isTranscriptHistoryProjectionSource(safeSource)) {
    return safeSource;
  }

  return `${cleanAgentId(agentId, DEFAULT_AGENT_ID)}-session`;
}

function isConversationProjectionEventType(type) {
  return type === "thread.message.user"
    || type === "thread.message.system"
    || type === "thread.message.assistant.delta"
    || type === "thread.message.assistant.complete";
}

function isTurnCompleteProjectionEvent(event) {
  const kind = cleanText(event?.kind).toLowerCase();
  const status = cleanText(event?.status).toLowerCase();
  const title = cleanText(event?.title).toLowerCase();
  const messageId = cleanText(event?.messageId || event?.message_id || event?.id).toLowerCase();
  return kind === "task_complete"
    || kind === "final_answer"
    || status === "task_complete"
    || title === "task complete"
    || messageId.includes("task-complete");
}

function projectedMessagesHaveAssistantText(messagesById, messageOrder, text) {
  const safeText = cleanMessageText(text);
  if (!safeText) {
    return false;
  }

  return messageOrder.some((messageId) => {
    const candidate = messagesById.get(messageId);
    return candidate?.role === "assistant"
      && cleanText(candidate.kind, "message") !== "task_complete"
      && cleanMessageText(candidate.text) === safeText;
  });
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
    || isTerminalModelPickerUiPrompt(text)
    || isTerminalArtifactLabel(text);
}

function cleanSubmittedUserMessage(value) {
  const text = cleanMessageText(value);
  if (!text) {
    return "";
  }
  if (isTerminalControlHistoryPrompt(text)) {
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
    return normalizeAttachmentEchoText(text);
  }

  return promptText && !isTerminalArtifactMessage(promptText)
    ? normalizeAttachmentEchoText(promptText)
    : "";
}

function isSlashCommandPrompt(value) {
  return isTerminalControlHistoryPrompt(value);
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

  const rawDeliveryMode = cleanText(value.deliveryMode || value.mode).toLowerCase();
  const deliveryMode = rawDeliveryMode === "provider-api"
    || rawDeliveryMode === "terminal-confirmed"
    || rawDeliveryMode === "session-acceptance"
    ? rawDeliveryMode
    : "terminal";

  return {
    createdAt: cleanText(value.createdAt, nowIso()),
    deliveryMode,
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
  if (CLOSED_THREAD_TURN_STATES.has(normalizedTurn?.state)) {
    return "idle";
  }

  return normalizeThreadActivityStatus(fallback);
}

function providerBindingsHaveNativeSession(providerBindings) {
  return Object.values(providerBindings || {}).some((binding) => (
    Boolean(cleanText(binding?.nativeSessionId))
  ));
}

function pendingPromptTurnHasInputReady({
  activityStatus = "",
  latestTurn = null,
  pendingPrompt = null,
  providerBinding = null,
} = {}) {
  const latestTurnState = cleanText(latestTurn?.state).toLowerCase();
  return Boolean(
    latestTurnState === "running"
      && pendingPrompt
      && normalizeThreadActivityStatus(activityStatus) === "idle"
      && providerBinding?.inputReady === true
  );
}

function isOrphanRunningThreadState({
  latestTurn,
  messageCount = 0,
  messages = [],
  pendingPrompt = null,
  projectionEvents = [],
  providerBindings = {},
  transcriptSessionId = "",
} = {}) {
  const normalizedLatestTurn = normalizeThreadLatestTurn(latestTurn);
  return Boolean(
    normalizedLatestTurn?.state === "running"
    && !messages.length
    && !projectionEvents.length
    && !normalizePendingPrompt(pendingPrompt)
    && !cleanText(transcriptSessionId)
    && !providerBindingsHaveNativeSession(providerBindings)
  );
}

function clearOrphanRunningProviderBindings(providerBindings) {
  return Object.fromEntries(
    Object.entries(providerBindings || {}).map(([agentId, binding]) => [
      agentId,
      {
        ...binding,
        activityStatus: "idle",
      },
    ]),
  );
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
  const rawText = message.text || message.message;
  const text = safeRole === "user"
    ? normalizeAttachmentEchoText(rawText)
    : cleanMessageText(rawText);
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

function stableProjectionKey(value, fallback = "event") {
  const text = String(value || fallback);
  return `${safeKey(text, fallback)}-${stableProjectionHash(text)}`;
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
  const rawText = event.text || event.message;
  const text = type === "thread.message.user"
    ? normalizeAttachmentEchoText(rawText)
    : cleanMessageText(rawText);
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

  const matchingMessageId = messagesById.has(normalizedMessage.id)
    ? normalizedMessage.id
    : messageOrder.find((messageId) => {
      const candidate = messagesById.get(messageId);
      return candidate
        && normalizedMessage.role === "user"
        && candidate.role === normalizedMessage.role
        && cleanText(candidate.kind, "message") === cleanText(normalizedMessage.kind, "message")
        && !isTranscriptHistoryProjectionSource(candidate.source)
        && !isTranscriptHistoryProjectionSource(normalizedMessage.source)
        && areThreadMessagesEquivalent(
          candidate,
          normalizedMessage,
          normalizedMessage.role === "user" ? 12000 : 5000,
        );
    });

  if (!matchingMessageId) {
    messageOrder.push(normalizedMessage.id);
    messagesById.set(normalizedMessage.id, normalizedMessage);
    return;
  }

  const existingMessage = messagesById.get(matchingMessageId);
  messagesById.set(matchingMessageId, {
    ...existingMessage,
    ...normalizedMessage,
    id: matchingMessageId,
    text: chooseProjectedMessageText(existingMessage?.text, normalizedMessage.text),
  });
}

function projectThreadProjectionMessages(events, fallbackMessages = []) {
  const projectionEvents = normalizeThreadProjectionEvents(events);
  if (!projectionEvents.length) {
    return normalizeThreadMessages(fallbackMessages);
  }

  const hasTranscriptHistoryMessages = projectionEvents.some((event) => (
    isConversationProjectionEventType(event.type)
      && isTranscriptHistoryProjectionEvent(event)
  ));
  const messagesById = new Map();
  const messageOrder = [];
  projectionEvents.forEach((event) => {
    if (
      hasTranscriptHistoryMessages
      && isConversationProjectionEventType(event.type)
      && !isTranscriptHistoryProjectionEvent(event)
    ) {
      return;
    }

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
      if (
        isTurnCompleteProjectionEvent(event)
        && projectedMessagesHaveAssistantText(messagesById, messageOrder, eventText)
      ) {
        return;
      }
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

      const eventText = event.replaceText || !existing?.text
        ? event.text || event.delta || existing?.text || ""
        : existing.text;
      if (
        isTurnCompleteProjectionEvent(event)
        && projectedMessagesHaveAssistantText(messagesById, messageOrder, eventText)
      ) {
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
        text: eventText,
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

function transcriptHasTurnCompleteForExpectedPrompt(messages, expectedPromptMessageId) {
  const safeExpectedPromptMessageId = cleanText(expectedPromptMessageId);
  if (!safeExpectedPromptMessageId) {
    return false;
  }

  let sawExpectedPrompt = false;
  const normalizedMessages = normalizeThreadMessages(messages);
  for (const message of normalizedMessages) {
    if (!sawExpectedPrompt) {
      sawExpectedPrompt = message.role === "user" && cleanText(message.id) === safeExpectedPromptMessageId;
      continue;
    }

    if (message.role === "user" && !isSlashCommandPrompt(message.text)) {
      return false;
    }

    if (isTranscriptTurnCompleteMessage(message)) {
      return true;
    }
  }

  return false;
}

function transcriptExpectedPromptMessageId(messages, event = {}, expectedUserMessage = "") {
  const normalizedIncomingMessages = normalizeThreadMessages(messages);
  const expectedText = cleanSubmittedUserMessage(expectedUserMessage);
  if (expectedText) {
    return cleanText([...normalizedIncomingMessages].reverse().find((message) => (
      message?.role === "user"
        && !isSlashCommandPrompt(message.text)
        && cleanSubmittedUserMessage(message.text) === expectedText
    ))?.id);
  }

  if (event.promptAccepted !== true) {
    return "";
  }

  const matchedBy = cleanText(event.matchedBy).toLowerCase();
  const canUseTimestampRecovery = Boolean(
    event.allowTimestampFallback === true
      || matchedBy.includes("timestamp")
      || matchedBy.includes("recovery")
  );
  if (!canUseTimestampRecovery) {
    return "";
  }

  const submittedAtMs = threadMessageTimestampMs({
    createdAt: event.expectedMessageCreatedAt
      || event.promptEventSubmittedAt
      || event.submittedAt
      || event.createdAt,
  });
  if (!submittedAtMs) {
    return "";
  }

  const candidate = normalizedIncomingMessages.find((message) => (
    message?.role === "user"
      && !isSlashCommandPrompt(message.text)
      && threadMessageTimestampMs(message) >= submittedAtMs - 5000
  ));
  return cleanText(candidate?.id);
}

function isTranscriptTurnErrorMessage(message) {
  const kind = cleanText(message?.kind).toLowerCase();
  const status = cleanText(message?.status).toLowerCase();
  return kind === "error" || status === "error";
}

function projectLatestTurnFromEvents(events, fallbackLatestTurn = null) {
  let latestTurn = normalizeThreadLatestTurn(fallbackLatestTurn);
  const closedTurnIds = new Set();

  normalizeThreadProjectionEvents(events).forEach((event) => {
    const turnId = cleanText(event.turnId);
    if (!turnId) {
      return;
    }

    if (
      event.type === "thread.turn.started"
      && (
        closedTurnIds.has(turnId)
        || (
          latestTurn?.turnId === turnId
          && CLOSED_THREAD_TURN_STATES.has(latestTurn?.state)
        )
      )
    ) {
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
      if (
        event.type === "thread.turn.completed"
        || event.type === "thread.turn.error"
        || event.type === "thread.turn.interrupted"
      ) {
        closedTurnIds.add(turnId);
      }
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
      closedTurnIds.add(turnId);
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
      closedTurnIds.add(turnId);
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
      closedTurnIds.add(turnId);
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

  if (messageId && isTranscriptHistoryProjectionSource(message?.source)) {
    return null;
  }

  return projectedMessages.find((candidate) => (
    candidate.role === role
    && cleanText(candidate.kind, "message") === kind
    && areThreadMessagesEquivalent(candidate, message, role === "user" ? 12000 : 5000)
  )) || null;
}

function createSubmittedUserProjectionEvents(thread, event = {}) {
  const text = cleanSubmittedUserMessage(
    event.expectedUserMessage
      || event.terminalText
      || event.terminalMessage
      || event.userMessage
      || event.message,
  );
  if (!text || isSlashCommandPrompt(text)) {
    return [];
  }

  const promptEventId = cleanText(event.promptEventId || event.pendingPromptId || event.promptId);
  const createdAt = cleanText(
    event.messageCreatedAt
      || event.promptEventSubmittedAt
      || event.submittedAt,
    nowIso(),
  );
  const messageId = cleanText(
    event.messageId || promptEventId,
    createRandomId(`message-${safeKey(thread?.id, "thread")}`),
  );
  const turnId = cleanText(event.turnId || event.turn_id, createTurnIdForMessage(thread, messageId));
  const agentId = cleanAgentId(event.agentId || event.currentAgent, "");
  const source = cleanText(event.source || event.messageSource, "local-submit");
  return [{
    agentId,
    createdAt,
    id: `projection-turn-started-${stableProjectionKey(turnId, "turn")}`,
    messageId,
    source,
    status: "running",
    turnId,
    type: "thread.turn.started",
  }, {
    agentId,
    createdAt,
    id: `projection-user-submitted-${stableProjectionKey(messageId, "message")}`,
    messageId,
    role: "user",
    source,
    status: "submitted",
    text,
    turnId,
    type: "thread.message.user",
  }];
}

function createProjectionEventsFromTranscript(thread, incomingMessages, event = {}) {
  const agentId = cleanAgentId(event.agentId || event.currentAgent || thread?.currentAgent, "");
  const source = transcriptHistoryProjectionSource(agentId, event.source);
  const promptEventId = cleanText(event.promptEventId || event.pendingPromptId || event.promptId);
  const expectedUserMessage = cleanSubmittedUserMessage(
    event.expectedUserMessage
      || event.userMessage
      || event.message,
  );
  const normalizedIncomingMessages = normalizeThreadMessages(incomingMessages);
  const expectedPromptTranscriptMessageId = transcriptExpectedPromptMessageId(
    normalizedIncomingMessages,
    event,
    expectedUserMessage,
  );
  let projectionEvents = ensureThreadProjectionEvents(thread);
  let projectedMessages = projectThreadProjectionMessages(
    projectionEvents.filter(isTranscriptHistoryProjectionEvent),
    [],
  );
  const events = [];
  const latestTurn = normalizeThreadLatestTurn(thread?.latestTurn);
  const runningLatestTurnId = latestTurn?.state === "running" ? cleanText(latestTurn.turnId) : "";
  const expectedPromptTurnId = promptEventId ? createTurnIdForMessage(thread, promptEventId) : "";
  const promptAccepted = event.promptAccepted === true;
  const latestUserMessage = [...normalizeThreadMessages(thread?.messages)]
    .reverse()
    .find((message) => message.role === "user") || null;
  const latestUserMessageMatchesExpectedPrompt = Boolean(
    expectedUserMessage
      && cleanSubmittedUserMessage(latestUserMessage?.text) === expectedUserMessage,
  );
  const latestRunningTurnMatchesExpectedPrompt = Boolean(
    runningLatestTurnId
      && (
        (expectedPromptTurnId && expectedPromptTurnId === runningLatestTurnId)
        || (
          promptEventId
          && (
            cleanText(latestTurn?.messageId) === promptEventId
            || runningLatestTurnId.includes(promptEventId)
            || cleanText(latestUserMessage?.id) === promptEventId
          )
        )
        || latestUserMessageMatchesExpectedPrompt
      )
  );
  const transcriptExplicitCompletionCanSettleRunningTurn = Boolean(
    runningLatestTurnId
      && latestRunningTurnMatchesExpectedPrompt
      && (promptAccepted || Boolean(expectedPromptTranscriptMessageId))
      && transcriptHasTurnCompleteForExpectedPrompt(
        normalizedIncomingMessages,
        expectedPromptTranscriptMessageId,
      )
  );
  const allowTranscriptTurnCompletion = event.allowTranscriptTurnCompletion === true
    || transcriptExplicitCompletionCanSettleRunningTurn;
  const assistantResponseCompletesTurn = allowTranscriptTurnCompletion
    && event.assistantResponseCompletesTurn === true;
  const transcriptTurnCompleteSeen = event.turnCompleteSeen === true
    || transcriptExplicitCompletionCanSettleRunningTurn;
  let currentTurnId = "";
  let transcriptAdvancedTurn = false;

  normalizedIncomingMessages.forEach((message) => {
    const eventStartCount = events.length;
    const matchCandidate = {
      ...message,
      source,
    };
    const projectedMessage = findMatchingProjectedMessage(projectedMessages, matchCandidate);
    const messageId = cleanText(message.id, createRandomId("message"));
    const createdAt = cleanText(message.createdAt, nowIso());
    const isExpectedPromptUserMessage = Boolean(
      expectedPromptTranscriptMessageId
        && message.role === "user"
        && messageId === expectedPromptTranscriptMessageId,
    );
    const expectedPromptTurnForMessage = isExpectedPromptUserMessage
      ? runningLatestTurnId || expectedPromptTurnId
      : "";
    const incomingMessageTurnId = cleanText(message.turnId || message.turn_id);
    const shouldContinueCurrentTranscriptTurn = Boolean(message.role !== "user" && currentTurnId);
    const messageTurnId = cleanText(
      (shouldContinueCurrentTranscriptTurn ? currentTurnId : "")
        || expectedPromptTurnForMessage
        || projectedMessage?.turnId
        || incomingMessageTurnId
        || currentTurnId
        || createTurnIdForMessage(thread, messageId),
    );
    const eventBase = {
      agentId: message.agentId || agentId,
      callId: message.callId,
      createdAt,
      kind: message.kind,
      messageId,
      source,
      title: message.title,
      turnId: messageTurnId,
    };

    if (message.role === "user") {
      if (isSlashCommandPrompt(message.text)) {
        return;
      }
      currentTurnId = cleanText(
        expectedPromptTurnForMessage
          || projectedMessage?.turnId
          || incomingMessageTurnId
          || createTurnIdForMessage(thread, messageId),
      );
      transcriptAdvancedTurn = true;
      eventBase.turnId = currentTurnId;
      if (!projectionHasTurnEvent(projectionEvents, "thread.turn.started", currentTurnId)) {
        events.push({
          ...eventBase,
          id: `projection-provider-turn-started-${stableProjectionKey(currentTurnId, "turn")}`,
          status: "running",
          type: "thread.turn.started",
        });
      }
      if (projectedMessage) {
        // Keep the provider turn lifecycle even when the local submit already projected the user.
      } else {
        events.push({
          ...eventBase,
          id: `projection-provider-user-${stableProjectionKey(messageId, "message")}`,
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
        if (
          allowTranscriptTurnCompletion
          && turnComplete
          && messageTurnId
          && !projectionHasTurnEvent(projectionEvents, "thread.turn.completed", messageTurnId)
        ) {
          events.push({
            ...eventBase,
            completedAt: createdAt,
            id: `projection-provider-turn-completed-${stableProjectionKey(messageTurnId, "turn")}-${stableProjectionKey(messageId, "message")}`,
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
      if (
        allowTranscriptTurnCompletion
        && turnComplete
        && messageTurnId
        && !projectionHasTurnEvent(projectionEvents, "thread.turn.completed", messageTurnId)
      ) {
        events.push({
          ...eventBase,
          assistantMessageId: duplicateFinalAssistant?.id || messageId,
          completedAt: createdAt,
          id: `projection-provider-turn-completed-${stableProjectionKey(messageTurnId, "turn")}-${stableProjectionKey(messageId, "message")}`,
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
          id: `projection-provider-turn-error-${stableProjectionKey(messageTurnId, "turn")}-${stableProjectionKey(messageId, "message")}`,
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

  const shouldCompleteRunningTurnFromTranscript = Boolean(
    allowTranscriptTurnCompletion
      && runningLatestTurnId
      && (
        transcriptTurnCompleteSeen
        || assistantResponseCompletesTurn
      )
      && (
        promptAccepted
        || (expectedPromptTurnId && expectedPromptTurnId === runningLatestTurnId)
      ),
  );
  const completedTurnId = shouldCompleteRunningTurnFromTranscript
    ? runningLatestTurnId
    : transcriptAdvancedTurn
      ? currentTurnId
      : "";
  if (
    allowTranscriptTurnCompletion
    && (transcriptTurnCompleteSeen || assistantResponseCompletesTurn)
    && completedTurnId
    && !projectionHasTurnEvent(projectionEvents, "thread.turn.completed", completedTurnId)
  ) {
    const completedAt = cleanText(event.latestTimestamp || event.completedAt, nowIso());
    const assistantMessage = [...projectedMessages].reverse().find((message) => (
      message?.role === "assistant"
      && (!message.turnId || message.turnId === completedTurnId)
    ));
    events.push({
      agentId,
      assistantMessageId: assistantMessage?.id || "",
      completedAt,
      createdAt: completedAt,
      id: [
        "projection-provider-turn-completed",
        stableProjectionKey(completedTurnId, "turn"),
        "fallback",
        stableProjectionHash(completedAt),
      ].join("-"),
      messageId: assistantMessage?.id || completedTurnId,
      source,
      status: "completed",
      turnId: completedTurnId,
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
      fileAuthority: "",
      sessionId: "",
      sessionMode: "",
      worktreePath: "",
    };
  }

  return {
    agentBranch: cleanText(value.agentBranch),
    agentId: cleanText(value.agentId),
    agentSlotId: cleanText(value.agentSlotId),
    coordinationMode: cleanText(value.coordinationMode),
    fileAuthority: cleanText(value.fileAuthority),
    sessionId: cleanText(value.sessionId),
    sessionMode: cleanText(value.sessionMode),
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
  const safeStatus = LIVE_TERMINAL_STATUSES.has(status)
    ? status
    : "idle";

  if (!key) {
    return null;
  }

  return {
    agentId: cleanAgentId(value.agentId || value.currentAgent),
    instanceId: Number.isInteger(instanceId) && instanceId > 0 ? instanceId : 0,
    inputReady: value.inputReady === true,
    inputReadyAt: cleanText(value.inputReadyAt || value.promptReadyAt),
    inputReadyConfidence: cleanText(value.inputReadyConfidence || value.promptReadyConfidence),
    lastActiveAt: cleanText(value.lastActiveAt, value.updatedAt || nowIso()),
    paneId,
    ...promptingUserFields(value),
    fileAuthority: cleanText(value.fileAuthority || value.coordination?.fileAuthority),
    slotKey: cleanText(value.slotKey, defaultSlotKey(terminalIndex)),
    status: safeStatus,
    sessionMode: cleanText(value.sessionMode || value.coordination?.sessionMode),
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
  const safeStatus = LIVE_TERMINAL_STATUSES.has(status)
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
    inputReady: options.stripLiveBindings
      ? false
      : Boolean(binding.inputReady ?? fallback.inputReady),
    inputReadyAt: options.stripLiveBindings
      ? ""
      : cleanText(binding.inputReadyAt || binding.promptReadyAt, fallback.inputReadyAt || fallback.promptReadyAt),
    inputReadyConfidence: options.stripLiveBindings
      ? ""
      : cleanText(
        binding.inputReadyConfidence || binding.promptReadyConfidence,
        fallback.inputReadyConfidence || fallback.promptReadyConfidence,
      ),
    ...(
      options.stripLiveBindings
        ? promptingUserFields({ terminalIsPromptingUser: false })
        : promptingUserFields(binding, fallback)
    ),
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
  const safeStatus = LIVE_TERMINAL_STATUSES.has(status)
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

  const transcriptSessionId = cleanText(thread.transcriptSessionId);
  const orphanRunningThreadState = isOrphanRunningThreadState({
    latestTurn: projectedLatestTurn,
    messageCount,
    messages,
    pendingPrompt,
    projectionEvents,
    providerBindings,
    transcriptSessionId,
  });
  const latestTurn = orphanRunningThreadState ? null : projectedLatestTurn;
  const detachedNonLiveRunningThread = Boolean(
    latestTurn?.state === "running"
      && !terminalBinding
      && ["closed", "exited", "idle"].includes(safeStatus)
  );
  const storedActivityStatus = normalizeThreadActivityStatus(
    thread.activityStatus,
    providerBindings[currentAgent]?.activityStatus,
  );
  const activityStatus = options.stripLiveBindings
    ? "idle"
    : orphanRunningThreadState
      ? "idle"
      : detachedNonLiveRunningThread
        ? "idle"
        : pendingPromptTurnHasInputReady({
          activityStatus: storedActivityStatus,
          latestTurn,
          pendingPrompt,
          providerBinding: providerBindings[currentAgent],
        })
          ? "idle"
        : activityStatusForLatestTurn(
          latestTurn,
          storedActivityStatus,
        );
  const normalizedProviderBindings = orphanRunningThreadState
    ? clearOrphanRunningProviderBindings(providerBindings)
    : providerBindings;

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
    pinnedAt: cleanText(thread.pinnedAt),
    projectionEvents,
    preferredAgent,
    freshSessionStartedAt: options.stripLiveBindings ? "" : cleanText(thread.freshSessionStartedAt),
    sessionName: storedSessionName || storedTitle || fallbackTitle,
    slotKey: cleanText(
      thread.slotKey,
      terminalIndex == null ? `thread-${safeKey(id, "detached")}` : defaultSlotKey(terminalIndex),
    ),
    status: options.stripLiveBindings && ["active", "starting"].includes(safeStatus) ? "idle" : safeStatus,
    providerBindings: normalizedProviderBindings,
    terminalBinding,
    terminalIndex,
    title: storedTitle || storedSessionName || fallbackTitle,
    transcriptHydratedAt: options.stripMessages ? "" : cleanText(thread.transcriptHydratedAt),
    transcriptHydrationMode: options.stripMessages ? "" : cleanText(thread.transcriptHydrationMode),
    transcriptLatestTimestamp: options.stripMessages ? "" : cleanText(thread.transcriptLatestTimestamp),
    transcriptSessionId,
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
    pinnedAt: "",
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
  return {};
}

export function persistWorkspaceThreads(threads) {
  return normalizeWorkspaceThreads(threads, { stripLiveBindings: true });
}

export function clearWorkspaceThreadsBrowserPersistence() {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(WORKSPACE_THREADS_STORAGE_KEY);
    }
  } catch {
    // Browser thread metadata was only a legacy cache; failing to clear it must not block startup.
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
  const nextThreadId = cleanText(options.threadId ?? event.threadId ?? existing.threadId);
  const displacedThreadId = cleanText(existing.threadId);
  if (nextThreadId && displacedThreadId && displacedThreadId !== nextThreadId) {
    detachThreadFromTerminalBinding(entry, displacedThreadId, {
      agentId: existing.agentId || event.agentId || event.currentAgent,
      currentAgent: existing.agentId || event.currentAgent || event.agentId,
      instanceId: existing.instanceId,
      paneId: existing.paneId,
      status: "closed",
      terminalIndex,
      threadId: displacedThreadId,
      workspaceId: event.workspaceId,
    });
  }
  const now = nowIso();
  const eventType = cleanText(event.type).toLowerCase();
  const eventActivityStatus = normalizeThreadActivityStatus(event.activityStatus, "");
  const explicitInputReady = typeof event.inputReady === "boolean" ? event.inputReady : null;
  const eventInstanceId = Number.parseInt(event.instanceId, 10);
  const openedExistingReadyInstance = eventType === "opened"
    && Boolean(existing.inputReady)
    && Number.isInteger(eventInstanceId)
    && eventInstanceId > 0
    && Number(existing.instanceId) === eventInstanceId;
  const marksInputReady = explicitInputReady === true
    || eventType === "terminal-input-ready"
    || eventType === "terminal-prompt-ready"
    || eventType === "provider-turn-completed"
    || eventType === "provider-turn-interrupted"
    || eventType === "provider-turn-error";
  const marksInputBusy = explicitInputReady === false
    || (eventType === "opened" && !openedExistingReadyInstance)
    || eventType === "message-submitted"
    || eventType === "provider-turn-started"
    || eventActivityStatus === "thinking";
  const inputReady = marksInputReady
    ? true
    : marksInputBusy
      ? false
      : Boolean(existing.inputReady);
  const inputReadyAt = inputReady
    ? cleanText(event.inputReadyAt || event.promptReadyAt, existing.inputReadyAt || now)
    : "";
  const inputReadyConfidence = inputReady
    ? cleanText(event.inputReadyConfidence || event.promptReadyConfidence, existing.inputReadyConfidence)
    : "";
  const terminalPromptingFields = promptingUserFieldsForTerminalEvent(event, existing, {
    clear: marksInputBusy || marksInputReady,
    eventType,
  });
  const terminal = normalizeActiveTerminal({
    agentId: event.agentId || event.currentAgent || existing.agentId,
    inputReady,
    inputReadyAt,
    inputReadyConfidence,
    instanceId: event.instanceId ?? existing.instanceId,
    lastActiveAt: now,
    paneId: event.paneId || existing.paneId,
    ...terminalPromptingFields,
    slotKey: event.slotKey || existing.slotKey || defaultSlotKey(terminalIndex),
    status: options.status || event.status || existing.status || "active",
    terminalIndex,
    threadId: nextThreadId,
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

function detachThreadFromTerminalBinding(entry, threadId, event = {}) {
  const safeThreadId = cleanText(threadId);
  if (!safeThreadId) {
    return false;
  }

  const existing = entry?.threads?.[safeThreadId];
  if (!existing) {
    return false;
  }

  const now = nowIso();
  const status = cleanText(event.status, "closed").toLowerCase();
  const detachedStatus = status === "error" ? "error" : "closed";
  const agentId = cleanAgentId(
    event.agentId
      || event.currentAgent
      || existing.currentAgent,
  );
  const terminalBinding = normalizeTerminalBinding({
    instanceId: cleanText(existing.terminalBinding?.instanceId),
    paneId: cleanText(existing.terminalBinding?.paneId),
    terminalIndex: existing.terminalIndex,
  });
  const existingLatestTurn = normalizeThreadLatestTurn(existing.latestTurn);
  const existingProviderBinding = getWorkspaceThreadProviderBinding(existing, agentId);
  const shouldDeferRunningTurnInterruption = Boolean(
    event.deferSessionBackedRunningTurnInterruption === true
      && detachedStatus !== "error"
      && existingLatestTurn?.state === "running"
      && (existing.transcriptSessionId || existingProviderBinding?.nativeSessionId),
  );
  const latestTurn = existingLatestTurn?.state === "running" && !shouldDeferRunningTurnInterruption
    ? normalizeThreadLatestTurn({
      ...existingLatestTurn,
      completedAt: now,
      error: detachedStatus === "error" ? "Terminal detached" : existingLatestTurn.error,
      state: detachedStatus === "error" ? "error" : "interrupted",
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
      terminalBinding,
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
        status: detachedStatus,
        terminalBinding: null,
        updatedAt: now,
      }),
      activityStatus: "idle",
      status: detachedStatus,
      terminalBinding: null,
      updatedAt: now,
    };
  }

  entry.threads[safeThreadId] = {
    ...existing,
    activityStatus: "idle",
    latestTurn,
    providerBindings,
    status: detachedStatus,
    terminalBinding: null,
    updatedAt: now,
  };
  return true;
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
  const displacedThreadId = cleanText(activeTerminal?.threadId);
  if (displacedThreadId && displacedThreadId !== threadId) {
    detachThreadFromTerminalBinding(entry, displacedThreadId, {
      ...event,
      status: "closed",
      threadId: displacedThreadId,
    });
  }
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
    fileAuthority: cleanText(event.fileAuthority, existing.coordination?.fileAuthority),
    sessionId: cleanText(event.sessionId, existing.coordination?.sessionId),
    sessionMode: cleanText(event.sessionMode, existing.coordination?.sessionMode),
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
  const shouldClearOrphanRunning = !options.incrementMessageCount && isOrphanRunningThreadState({
    latestTurn: existing.latestTurn,
    messageCount: existing.messageCount,
    messages: normalizeThreadMessages(existing.messages),
    pendingPrompt: existing.pendingPrompt,
    projectionEvents: normalizeThreadProjectionEvents(existing.projectionEvents),
    providerBindings: existingProviderBindings,
    transcriptSessionId: existing.transcriptSessionId,
  });
  const baseProviderBindings = shouldClearOrphanRunning
    ? clearOrphanRunningProviderBindings(existingProviderBindings)
    : existingProviderBindings;
  const latestTurn = shouldClearOrphanRunning ? null : normalizeThreadLatestTurn(existing.latestTurn);
  const providerBinding = normalizeProviderBinding(baseProviderBindings[agentId], agentId, {
    coordination,
    inputReady: Boolean(activeTerminal?.inputReady),
    inputReadyAt: activeTerminal?.inputReadyAt || "",
    inputReadyConfidence: activeTerminal?.inputReadyConfidence || "",
    lastActiveAt: now,
    lastMessageAt: options.incrementMessageCount ? now : existing.lastMessageAt,
    messageCount: nextMessageCount,
    status: safeStatus,
    terminalBinding,
    updatedAt: now,
  });
  const activityStatus = options.incrementMessageCount
    ? "thinking"
    : shouldClearOrphanRunning
      ? "idle"
      : normalizeThreadActivityStatus(existing.activityStatus, providerBinding?.activityStatus);
  const eventSessionName = cleanThreadLabelCandidate(event.sessionName);
  const eventTitle = eventSessionName
    || getWorkspaceThreadPromptLabel(event.title || event.userMessage, "");
  const existingSessionName = cleanThreadLabelCandidate(existing.sessionName);
  const existingTitle = cleanThreadLabelCandidate(existing.title);
  const providerBindings = {
    ...baseProviderBindings,
    [agentId]: {
      ...providerBinding,
      activityStatus,
      coordination,
      inputReady: Boolean(activeTerminal?.inputReady),
      inputReadyAt: activeTerminal?.inputReadyAt || "",
      inputReadyConfidence: activeTerminal?.inputReadyConfidence || "",
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
    latestTurn,
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
          inputReady: Boolean(terminal.inputReady),
          inputReadyAt: terminal.inputReadyAt || "",
          inputReadyConfidence: terminal.inputReadyConfidence || "",
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
  const rawPendingPrompt = normalizePendingPrompt(event.pendingPrompt || {
    createdAt: event.messageCreatedAt,
    deliveryMode: event.pendingPromptDeliveryMode || event.deliveryMode,
    id: event.pendingPromptId,
    message: event.pendingPromptText || (event.sessionAcceptancePending === true ? submittedUserMessage : ""),
    model: event.model,
  });
  const pendingPromptWasAccepted = Boolean(
    event.promptAccepted === true
      || event.sessionAcceptancePending === false
      || event.sessionAccepted === true
  );
  const pendingPrompt = pendingPromptWasAccepted ? null : rawPendingPrompt;
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
  const shouldBindTerminal = event.bindTerminal !== false;

  if (shouldBindTerminal) {
    upsertActiveTerminal(entry, event, {
      status: event.status || "active",
      threadId,
    });
  }

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

  if (shouldBindTerminal) {
    bindExistingThreadToTerminal(entry, threadId, event, {
      incrementMessageCount: hasSubmittedPrompt,
      status: event.status || "active",
    });
  } else {
    entry.activeThreadId = threadId;
  }
  if (entry.threads[threadId]) {
    const submittedEvents = createSubmittedUserProjectionEvents(entry.threads[threadId], event);
    const projectionEvents = appendThreadProjectionEvents(
      ensureThreadProjectionEvents(entry.threads[threadId]),
      submittedEvents,
    );
    const messages = projectThreadProjectionMessages(projectionEvents, entry.threads[threadId].messages);
    const messageAdded = submittedEvents.length > 0 && messages.length > previousMessages.length;
    const projectedLatestTurn = projectLatestTurnFromEvents(
      projectionEvents,
      entry.threads[threadId].latestTurn,
    );
    const nextPendingPrompt = pendingPromptWasAccepted
      ? null
      : pendingPrompt || entry.threads[threadId].pendingPrompt;
    const shouldClearOrphanRunning = isOrphanRunningThreadState({
      latestTurn: projectedLatestTurn,
      messageCount: messages.length,
      messages,
      pendingPrompt: nextPendingPrompt,
      projectionEvents,
      providerBindings: entry.threads[threadId].providerBindings,
      transcriptSessionId: entry.threads[threadId].transcriptSessionId,
    });
    const latestTurn = shouldClearOrphanRunning ? null : projectedLatestTurn;
    const submittedPromptActive = cleanText(event.type).toLowerCase() === "message-submitted"
      && hasSubmittedPrompt;
    const activityStatus = activityStatusForLatestTurn(
      latestTurn,
      shouldClearOrphanRunning
        ? "idle"
        : submittedPromptActive
          ? "thinking"
          : messageAdded || pendingPrompt
            ? entry.threads[threadId].activityStatus
            : previousActivityStatus,
    );
    let providerBindings = normalizeProviderBindings(
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
    if (shouldClearOrphanRunning) {
      providerBindings = clearOrphanRunningProviderBindings(providerBindings);
    }
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
      pendingPrompt: nextPendingPrompt,
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
    const existingProviderBinding = getWorkspaceThreadProviderBinding(existing, agentId);
    const shouldDeferRunningTurnInterruption = Boolean(
      event.deferSessionBackedRunningTurnInterruption === true
        && safeStatus !== "error"
        && existingLatestTurn?.state === "running"
        && (existing.transcriptSessionId || existingProviderBinding?.nativeSessionId),
    );
    const latestTurn = existingLatestTurn?.state === "running" && !shouldDeferRunningTurnInterruption
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
  const terminalKey = terminalSessionKey(terminalIndex);
  const existingTerminal = terminalKey ? entry.terminals[terminalKey] : null;
  if (
    terminalKey
    && existingTerminal
    && cleanAgentId(existingTerminal.agentId, "") !== agentId
  ) {
    delete entry.terminals[terminalKey];
    entry.terminalOrder = entry.terminalOrder.filter((key) => key !== terminalKey);
  }
  const existingLatestTurn = normalizeThreadLatestTurn(existing.latestTurn);
  const nextLatestTurn = existingLatestTurn?.state === "running"
    ? normalizeThreadLatestTurn({
      ...existingLatestTurn,
      completedAt: now,
      error: cleanText(event.reason || "Terminal agent changed."),
      state: "interrupted",
      updatedAt: now,
    })
    : existing.latestTurn;
  rememberTerminalThread(entry, terminalIndex, threadId);
  entry.activeThreadId = threadId;
  entry.threads[threadId] = {
    ...existing,
    activityStatus: "idle",
    currentAgent: agentId,
    latestTurn: nextLatestTurn,
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

function workspaceThreadHasConversationContent(thread) {
  const messages = normalizeThreadMessages(thread?.messages);
  if (messages.some((message) => (
    (message.role === "user" || message.role === "assistant")
      && cleanMessageText(message.text)
  ))) {
    return true;
  }

  if (normalizeMessageCount(thread?.messageCount) > 0) {
    return true;
  }

  return normalizeThreadProjectionEvents(thread?.projectionEvents).some((event) => (
    event.type === "thread.message.user"
      || event.type === "thread.message.assistant.delta"
      || event.type === "thread.message.assistant.complete"
  ));
}

function workspaceThreadHasAssistantConversationContent(thread) {
  const messages = normalizeThreadMessages(thread?.messages);
  if (messages.some((message) => message.role === "assistant" && cleanMessageText(message.text))) {
    return true;
  }

  return normalizeThreadProjectionEvents(thread?.projectionEvents).some((event) => (
    (event.type === "thread.message.assistant.delta" || event.type === "thread.message.assistant.complete")
      && cleanMessageText(event.text || event.delta)
  ));
}

function workspaceThreadIsDetachedSessionClaim(thread) {
  const duplicateHasTerminalBinding = Boolean(normalizeTerminalBinding(thread?.terminalBinding));
  const duplicateStatus = cleanText(thread?.status).toLowerCase();
  return !duplicateHasTerminalBinding
    && (!duplicateStatus || ["idle", "closed", "exited"].includes(duplicateStatus));
}

function workspaceThreadHasLiveSessionClaim(thread) {
  const status = cleanText(thread?.status).toLowerCase();
  return Boolean(
    normalizeTerminalBinding(thread?.terminalBinding)
      || status === "active"
      || status === "starting"
      || cleanText(thread?.activityStatus).toLowerCase() === "thinking",
  );
}

function workspaceThreadCanClaimProviderSession(thread) {
  return Boolean(
    thread?.freshSessionStartedAt
      || thread?.pendingPrompt
      || workspaceThreadHasConversationContent(thread)
      || normalizeThreadProjectionEvents(thread?.projectionEvents).length > 0
      || workspaceThreadHasLiveSessionClaim(thread),
  );
}

function workspaceThreadDuplicateProviderSessionCanYield(targetThread, duplicateThread) {
  if (!workspaceThreadCanClaimProviderSession(targetThread)) {
    return false;
  }
  const duplicateIsDetached = workspaceThreadIsDetachedSessionClaim(duplicateThread);
  if (workspaceThreadHasAssistantConversationContent(duplicateThread)) {
    return false;
  }

  return duplicateIsDetached || !workspaceThreadHasLiveSessionClaim(duplicateThread);
}

function releaseWorkspaceThreadProviderSession(thread, agentId, sessionId, releasedAt = nowIso()) {
  const safeSessionId = cleanText(sessionId);
  if (!thread || !safeSessionId) {
    return thread;
  }

  const providerBindings = normalizeProviderBindings(
    thread.providerBindings,
    thread.currentAgent,
    {
      activityStatus: "idle",
      coordination: thread.coordination,
      lastActiveAt: thread.lastActiveAt,
      lastMessageAt: thread.lastMessageAt,
      messageCount: thread.messageCount,
      status: thread.status,
      terminalBinding: null,
      updatedAt: releasedAt,
    },
  );
  const providerBinding = normalizeProviderBinding(providerBindings[agentId], agentId, {
    activityStatus: "idle",
    coordination: thread.coordination,
    lastActiveAt: thread.lastActiveAt,
    lastMessageAt: thread.lastMessageAt,
    messageCount: thread.messageCount,
    status: thread.status,
    terminalBinding: null,
    updatedAt: releasedAt,
  });
  if (providerBinding && cleanText(providerBinding.nativeSessionId) === safeSessionId) {
    providerBindings[agentId] = {
      ...providerBinding,
      activityStatus: "idle",
      inputReady: false,
      inputReadyAt: "",
      inputReadyConfidence: "",
      nativeSessionId: "",
      nativeSessionKind: "",
      nativeSessionSource: "",
      nativeSessionUpdatedAt: releasedAt,
      status: cleanText(thread.status).toLowerCase() === "active" ? "idle" : providerBinding.status,
      terminalBinding: null,
      updatedAt: releasedAt,
    };
  }

  const latestTurn = normalizeThreadLatestTurn(thread.latestTurn);
  const isDetachedClaim = workspaceThreadIsDetachedSessionClaim(thread);
  const shouldClearRunningTurn = latestTurn?.state === "running"
    && isDetachedClaim
    && !workspaceThreadHasAssistantConversationContent(thread);
  const shouldClearTranscriptSession = cleanText(thread.transcriptSessionId) === safeSessionId;

  return {
    ...thread,
    activityStatus: "idle",
    latestTurn: shouldClearRunningTurn ? null : thread.latestTurn,
    providerBindings,
    status: cleanText(thread.status).toLowerCase() === "active" ? "idle" : thread.status,
    terminalBinding: null,
    transcriptHydrationMode: shouldClearTranscriptSession ? "" : thread.transcriptHydrationMode,
    transcriptSessionId: shouldClearTranscriptSession ? "" : thread.transcriptSessionId,
    transcriptStatus: shouldClearTranscriptSession ? "idle" : thread.transcriptStatus,
    updatedAt: releasedAt,
  };
}

function releaseYieldingProviderSessionDuplicates(entry, agentId, sessionId, targetThreadId, releasedAt = nowIso()) {
  const safeSessionId = cleanText(sessionId);
  const safeTargetThreadId = cleanText(targetThreadId);
  if (!entry?.threads || !safeSessionId || !safeTargetThreadId) {
    return { blockingThreadId: "", entry, releasedCount: 0 };
  }

  const targetThread = entry.threads[safeTargetThreadId];
  const nextThreads = { ...entry.threads };
  let releasedCount = 0;
  let blockingThreadId = "";

  Object.values(entry.threads).forEach((thread) => {
    if (
      !thread?.id
      || thread.id === safeTargetThreadId
      || !workspaceThreadHasProviderSession(thread, agentId, safeSessionId)
    ) {
      return;
    }

    if (!workspaceThreadDuplicateProviderSessionCanYield(targetThread, thread)) {
      blockingThreadId = blockingThreadId || thread.id;
      return;
    }

    nextThreads[thread.id] = releaseWorkspaceThreadProviderSession(thread, agentId, safeSessionId, releasedAt);
    releasedCount += 1;
  });

  if (blockingThreadId || releasedCount === 0) {
    return { blockingThreadId, entry, releasedCount };
  }

  return {
    blockingThreadId: "",
    entry: {
      ...entry,
      threads: nextThreads,
    },
    releasedCount,
  };
}

function summarizeTranscriptMessagesForDiagnostics(messages) {
  const normalizedMessages = normalizeThreadMessages(messages);
  const roleCounts = normalizedMessages.reduce((counts, message) => ({
    ...counts,
    [message.role]: (counts[message.role] || 0) + 1,
  }), {});
  return {
    count: normalizedMessages.length,
    roleCounts,
    lastMessages: normalizedMessages.slice(-4).map((message) => ({
      agentId: cleanText(message.agentId),
      createdAtPresent: Boolean(cleanText(message.createdAt)),
      idPresent: Boolean(cleanText(message.id)),
      kind: cleanText(message.kind),
      role: cleanText(message.role),
      source: cleanText(message.source),
      status: cleanText(message.status),
      textLength: cleanMessageText(message.text).length,
      turnIdPresent: Boolean(cleanText(message.turnId)),
    })),
  };
}

function summarizeWorkspaceThreadSessionClaimForDiagnostics(thread, agentId, sessionId, targetThread = null) {
  if (!thread) {
    return null;
  }

  const messages = normalizeThreadMessages(thread.messages);
  const projectionEvents = normalizeThreadProjectionEvents(thread.projectionEvents);
  const latestTurn = normalizeThreadLatestTurn(thread.latestTurn);
  const binding = getWorkspaceThreadProviderBinding(thread, agentId);
  const lastMessage = messages[messages.length - 1] || null;
  return {
    activityStatus: cleanText(thread.activityStatus),
    assistantMessageCount: messages.filter((message) => message.role === "assistant").length,
    canYieldToTarget: targetThread
      ? workspaceThreadDuplicateProviderSessionCanYield(targetThread, thread)
      : false,
    hasAssistantConversationContent: workspaceThreadHasAssistantConversationContent(thread),
    hasConversationContent: workspaceThreadHasConversationContent(thread),
    hasLiveSessionClaim: workspaceThreadHasLiveSessionClaim(thread),
    hasProviderSession: workspaceThreadHasProviderSession(thread, agentId, sessionId),
    hasTerminalBinding: Boolean(normalizeTerminalBinding(thread.terminalBinding)),
    isDetachedSessionClaim: workspaceThreadIsDetachedSessionClaim(thread),
    lastRole: cleanText(lastMessage?.role),
    lastTextLength: cleanMessageText(lastMessage?.text).length,
    latestTurnState: cleanText(latestTurn?.state),
    messageCount: messages.length,
    providerSessionIdPresent: Boolean(cleanText(binding?.nativeSessionId)),
    projectionEventCount: projectionEvents.length,
    status: cleanText(thread.status),
    threadId: cleanText(thread.id),
    transcriptHydrationMode: cleanText(thread.transcriptHydrationMode),
    transcriptSessionIdPresent: Boolean(cleanText(thread.transcriptSessionId)),
    userMessageCount: messages.filter((message) => message.role === "user").length,
  };
}

function diagnoseWorkspaceThreadSessionDuplicateClaims(entry, agentId, sessionId, targetThreadId) {
  const safeSessionId = cleanText(sessionId);
  const safeTargetThreadId = cleanText(targetThreadId);
  const targetThread = entry?.threads?.[safeTargetThreadId] || null;
  if (!entry?.threads || !safeSessionId || !safeTargetThreadId) {
    return [];
  }

  return Object.values(entry.threads)
    .filter((thread) => (
      thread?.id
      && thread.id !== safeTargetThreadId
      && workspaceThreadHasProviderSession(thread, agentId, safeSessionId)
    ))
    .map((thread) => summarizeWorkspaceThreadSessionClaimForDiagnostics(
      thread,
      agentId,
      safeSessionId,
      targetThread,
    ))
    .filter(Boolean);
}

function createTranscriptHydrationProjectionPreview(existing, event, agentId) {
  const transcriptExplicitCompletionCanSettleTurn = event.transcriptExplicitCompletionCanSettleTurn === true;
  const projectionEventsBefore = ensureThreadProjectionEvents(existing);
  const projectionEventsToAdd = createProjectionEventsFromTranscript(existing, event.messages, {
    agentId,
    completedAt: event.completedAt,
    expectedMessageCreatedAt: event.expectedMessageCreatedAt,
    expectedUserMessage: event.expectedUserMessage,
    latestTimestamp: event.latestTimestamp,
    matchedBy: event.matchedBy,
    promptEventId: event.promptEventId || event.pendingPromptId || event.promptId,
    promptAccepted: event.promptAccepted,
    promptEventSubmittedAt: event.promptEventSubmittedAt,
    source: cleanText(event.source, `${agentId}-session`),
    submittedAt: event.submittedAt,
    allowTranscriptTurnCompletion: event.allowTranscriptTurnCompletion,
    assistantResponseCompletesTurn: event.assistantResponseCompletesTurn,
    transcriptExplicitCompletionCanSettleTurn,
    turnCompleteSeen: event.turnCompleteSeen,
  });
  const projectionEventsAfter = appendThreadProjectionEvents(
    projectionEventsBefore,
    projectionEventsToAdd,
  );
  const messagesBefore = normalizeThreadMessages(existing?.messages);
  const messagesAfter = projectThreadProjectionMessages(projectionEventsAfter, existing?.messages);
  const latestTurnBefore = normalizeThreadLatestTurn(existing?.latestTurn);
  const latestTurnAfter = projectLatestTurnFromEvents(projectionEventsAfter, existing?.latestTurn);
  const lastBefore = messagesBefore[messagesBefore.length - 1] || null;
  const lastAfter = messagesAfter[messagesAfter.length - 1] || null;
  return {
    addedProjectionEventCount: projectionEventsToAdd.length,
    afterLatestTurnState: cleanText(latestTurnAfter?.state),
    afterMessageCount: messagesAfter.length,
    afterProjectionEventCount: projectionEventsAfter.length,
    beforeLatestTurnState: cleanText(latestTurnBefore?.state),
    beforeMessageCount: messagesBefore.length,
    beforeProjectionEventCount: projectionEventsBefore.length,
    lastRoleBefore: cleanText(lastBefore?.role),
    lastRoleAfter: cleanText(lastAfter?.role),
    lastTextLengthBefore: cleanMessageText(lastBefore?.text).length,
    lastTextLengthAfter: cleanMessageText(lastAfter?.text).length,
    wouldChange: projectionEventsToAdd.length > 0
      || messagesAfter.length !== messagesBefore.length
      || cleanText(latestTurnAfter?.state) !== cleanText(latestTurnBefore?.state),
  };
}

export function diagnoseWorkspaceThreadSessionTranscriptHydration(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const threadId = cleanText(event.threadId);
  const agentId = cleanAgentId(event.agentId || event.currentAgent || "codex", "");
  const sessionId = cleanText(event.sessionId || event.providerSessionId || event.nativeSessionId);
  const requestedProviderSessionId = cleanText(event.requestedProviderSessionId || event.requestedNativeSessionId);
  const matchedBy = cleanText(event.matchedBy).toLowerCase();
  const currentState = normalizeWorkspaceThreads(state);
  const entry = workspaceId ? currentState[workspaceId] : null;
  const existing = entry?.threads?.[threadId] || null;
  const transcriptMessages = summarizeTranscriptMessagesForDiagnostics(event.messages);
  const base = {
    agentId,
    hasEntry: Boolean(entry),
    hasExistingThread: Boolean(existing),
    incomingTranscript: transcriptMessages,
    matchedBy,
    requestedProviderSessionIdPresent: Boolean(requestedProviderSessionId),
    sessionIdPresent: Boolean(sessionId),
    threadId,
    validAgentId: isThreadAgentId(agentId),
    workspaceId,
  };

  if (!workspaceId || !threadId || !isThreadAgentId(agentId)) {
    return {
      ...base,
      blockedReason: "invalid_request",
      wouldApply: false,
    };
  }
  if (!entry) {
    return {
      ...base,
      blockedReason: "missing_workspace_entry",
      wouldApply: false,
    };
  }
  if (!existing) {
    return {
      ...base,
      blockedReason: "missing_thread",
      wouldApply: false,
    };
  }

  const targetSummary = summarizeWorkspaceThreadSessionClaimForDiagnostics(
    existing,
    agentId,
    sessionId,
    null,
  );
  const archivedThread = workspaceEntryHasArchivedThreadId(entry, threadId);
  const duplicateClaims = diagnoseWorkspaceThreadSessionDuplicateClaims(
    entry,
    agentId,
    sessionId,
    threadId,
  );
  const blockingDuplicate = duplicateClaims.find((claim) => !claim.canYieldToTarget);
  const archivedSession = sessionId
    ? workspaceEntryHasArchivedSession(entry, agentId, sessionId)
    : false;
  const blockedReason = archivedThread
    ? "archived_thread_id"
    : existing.archivedAt
      ? "thread_archived_at"
      : existing.transcriptHydrationMode === "session-only"
        && !requestedProviderSessionId
        && matchedBy !== "sessionid"
        ? "session_only_without_requested_session"
        : archivedSession
          ? "archived_session"
          : blockingDuplicate
            ? "blocking_duplicate_provider_session"
            : "";
  const projectionPreview = blockedReason
    ? null
    : createTranscriptHydrationProjectionPreview(existing, event, agentId);

  return {
    ...base,
    archivedSession,
    archivedThread,
    blockedReason,
    blockingDuplicateThreadId: cleanText(blockingDuplicate?.threadId),
    duplicateClaimCount: duplicateClaims.length,
    duplicateClaims,
    existingArchivedAtPresent: Boolean(cleanText(existing.archivedAt)),
    projectionPreview,
    releasableDuplicateCount: duplicateClaims.filter((claim) => claim.canYieldToTarget).length,
    targetThread: targetSummary,
    wouldApply: !blockedReason && Boolean(projectionPreview?.wouldChange || sessionId),
  };
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
  let entry = currentState[workspaceId];
  let existing = entry?.threads?.[threadId];
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
    const released = releaseYieldingProviderSessionDuplicates(
      entry,
      agentId,
      nativeSessionId,
      threadId,
      nowIso(),
    );
    if (released.blockingThreadId) {
      return state || {};
    }
    entry = released.entry;
    existing = entry?.threads?.[threadId];
    if (!existing) {
      return state || {};
    }
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

export function invalidateWorkspaceThreadProviderSession(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const threadId = cleanText(event.threadId);
  const agentId = cleanAgentId(event.agentId || event.currentAgent, "");
  if (!workspaceId || !threadId || !isThreadAgentId(agentId)) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = currentState[workspaceId];
  const existing = entry?.threads?.[threadId];
  if (!existing || workspaceEntryHasArchivedThreadId(entry, threadId)) {
    return state || {};
  }

  const invalidSessionId = cleanText(
    event.nativeSessionId
      || event.providerSessionId
      || event.sessionId
      || existing.transcriptSessionId,
  );
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
  const providerBinding = normalizeProviderBinding(providerBindings[agentId], agentId, {
    coordination: existing.coordination,
    lastActiveAt: existing.lastActiveAt,
    lastMessageAt: existing.lastMessageAt,
    messageCount: existing.messageCount,
    status: existing.status,
    terminalBinding: existing.terminalBinding,
    updatedAt: existing.updatedAt,
  });
  const bindingSessionId = cleanText(providerBinding?.nativeSessionId);
  const transcriptSessionId = cleanText(existing.transcriptSessionId);
  const invalidSessionMatchesThread = Boolean(
    !invalidSessionId
      || bindingSessionId === invalidSessionId
      || transcriptSessionId === invalidSessionId,
  );
  if (!invalidSessionMatchesThread) {
    return state || {};
  }
  const now = nowIso();
  const shouldClearBindingSession = Boolean(
    bindingSessionId
      && (!invalidSessionId || bindingSessionId === invalidSessionId),
  );
  const nextProviderBinding = {
    ...providerBinding,
    activityStatus: "idle",
    inputReady: false,
    inputReadyAt: "",
    inputReadyConfidence: "",
    status: "idle",
    terminalBinding: null,
    updatedAt: now,
  };
  if (shouldClearBindingSession) {
    nextProviderBinding.nativeSessionId = "";
    nextProviderBinding.nativeSessionKind = "";
    nextProviderBinding.nativeSessionSource = "";
    nextProviderBinding.nativeSessionUpdatedAt = now;
  }
  providerBindings[agentId] = nextProviderBinding;

  const shouldClearTranscriptSession = Boolean(
    existing.transcriptSessionId
      && (!invalidSessionId || existing.transcriptSessionId === invalidSessionId),
  );
  const latestTurn = normalizeThreadLatestTurn(existing.latestTurn);
  const nextLatestTurn = latestTurn?.state === "running"
    ? normalizeThreadLatestTurn({
      ...latestTurn,
      completedAt: now,
      error: cleanText(event.error || "Provider session was not available locally."),
      state: "interrupted",
      updatedAt: now,
    })
    : existing.latestTurn;

  return {
    ...currentState,
    [workspaceId]: {
      ...entry,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          activityStatus: "idle",
          latestTurn: nextLatestTurn,
          providerBindings,
          status: existing.status === "active" ? "idle" : existing.status,
          terminalBinding: null,
          transcriptSessionId: shouldClearTranscriptSession ? "" : existing.transcriptSessionId,
          transcriptStatus: shouldClearTranscriptSession ? "idle" : existing.transcriptStatus,
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

  const promptId = cleanText(event.promptEventId || event.pendingPromptId || event.promptId);
  if (promptId && !workspaceThreadPromptIdsMatch(existing.pendingPrompt.id, promptId)) {
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
  let entry = currentState[workspaceId];
  let existing = entry?.threads?.[threadId];
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
      const released = releaseYieldingProviderSessionDuplicates(
        entry,
        agentId,
        sessionId,
        threadId,
        now,
      );
      if (released.blockingThreadId) {
        return state || {};
      }
      entry = released.entry;
      existing = entry?.threads?.[threadId];
      if (!existing) {
        return state || {};
      }
    }
  }
  const sessionTitle = cleanRealThreadTitleCandidate(event.sessionTitle, existing);
  const existingTitle = cleanRealThreadTitleCandidate(existing.title, existing);
  const existingSessionName = cleanRealThreadTitleCandidate(existing.sessionName, existing);
  const title = sessionTitle || existingTitle || existingSessionName || defaultThreadTitle(existing.terminalIndex, agentId);
  const eventTranscriptExplicitCompletionCanSettleTurn = event.transcriptExplicitCompletionCanSettleTurn === true;
  const projectionEventsToAdd = createProjectionEventsFromTranscript(existing, event.messages, {
    agentId,
    completedAt: event.completedAt,
    expectedMessageCreatedAt: event.expectedMessageCreatedAt,
    expectedUserMessage: event.expectedUserMessage,
    latestTimestamp: event.latestTimestamp,
    matchedBy: event.matchedBy,
    promptEventId: event.promptEventId || event.pendingPromptId || event.promptId,
    promptAccepted: event.promptAccepted,
    promptEventSubmittedAt: event.promptEventSubmittedAt,
    source: cleanText(event.source, `${agentId}-session`),
    submittedAt: event.submittedAt,
    allowTranscriptTurnCompletion: event.allowTranscriptTurnCompletion,
    assistantResponseCompletesTurn: event.assistantResponseCompletesTurn,
    transcriptExplicitCompletionCanSettleTurn: eventTranscriptExplicitCompletionCanSettleTurn,
    turnCompleteSeen: event.turnCompleteSeen,
  });
  const projectionEvents = appendThreadProjectionEvents(
    ensureThreadProjectionEvents(existing),
    projectionEventsToAdd,
  );
  const messages = projectThreadProjectionMessages(projectionEvents, existing.messages);
  const projectedLatestTurn = projectLatestTurnFromEvents(projectionEvents, existing.latestTurn);
  const existingLatestTurn = normalizeThreadLatestTurn(existing.latestTurn);
  const transcriptCompletionSettledTurn = Boolean(
    eventTranscriptExplicitCompletionCanSettleTurn
      || (
        existingLatestTurn?.state === "running"
        && projectedLatestTurn?.state === "completed"
        && projectionEventsToAdd.some((projectionEvent) => (
          projectionEvent?.type === "thread.turn.completed"
          && cleanText(projectionEvent.turnId) === cleanText(existingLatestTurn.turnId)
        ))
      )
  );
  const transcriptExplicitInputReadyAt = transcriptCompletionSettledTurn
    ? cleanText(event.completedAt || projectedLatestTurn?.completedAt || event.latestTimestamp, now)
    : "";
  const pendingPromptId = cleanText(event.promptEventId || event.pendingPromptId || event.promptId);
  const shouldClearAcceptedPendingPrompt = Boolean(
    event.promptAccepted === true
      && existing.pendingPrompt
      && (
        !pendingPromptId
        || workspaceThreadPromptIdsMatch(existing.pendingPrompt.id, pendingPromptId)
      )
  );
  const shouldClearOrphanRunning = isOrphanRunningThreadState({
    latestTurn: projectedLatestTurn,
    messageCount: messages.length,
    messages,
    pendingPrompt: shouldClearAcceptedPendingPrompt ? null : existing.pendingPrompt,
    projectionEvents,
    providerBindings: existing.providerBindings,
    transcriptSessionId: sessionId || existing.transcriptSessionId,
  });
  const existingStatus = cleanText(existing.status).toLowerCase();
  const projectedLatestTurnState = normalizeThreadLatestTurn(projectedLatestTurn)?.state || "";
  const detachedIdleHydrateKeepsIdle = Boolean(
    projectedLatestTurnState === "running"
      && projectionEventsToAdd.length === 0
      && !normalizeTerminalBinding(existing.terminalBinding)
      && ["closed", "exited", "idle"].includes(existingStatus)
      && event.allowTranscriptTurnCompletion !== true
      && event.assistantResponseCompletesTurn !== true
      && event.transcriptExplicitCompletionCanSettleTurn !== true
      && event.turnCompleteSeen !== true
  );
  const latestTurn = shouldClearOrphanRunning ? null : projectedLatestTurn;
  const activityStatus = detachedIdleHydrateKeepsIdle
    ? "idle"
    : activityStatusForLatestTurn(latestTurn, "idle");
  const lastMessageAt = messages.length
    ? messages[messages.length - 1].createdAt
    : existing.lastMessageAt;
  let providerBindings = normalizeProviderBindings(
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
  if (shouldClearOrphanRunning) {
    providerBindings = clearOrphanRunningProviderBindings(providerBindings);
  }

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
      inputReady: transcriptCompletionSettledTurn ? true : providerBindings[agentId].inputReady,
      inputReadyAt: transcriptCompletionSettledTurn
        ? transcriptExplicitInputReadyAt
        : providerBindings[agentId].inputReadyAt,
      inputReadyConfidence: transcriptCompletionSettledTurn
        ? "transcript-explicit-completion"
        : providerBindings[agentId].inputReadyConfidence,
      updatedAt: now,
    };
  } else if (providerBindings[agentId]) {
    providerBindings[agentId] = {
      ...providerBindings[agentId],
      activityStatus,
      inputReady: transcriptCompletionSettledTurn ? true : providerBindings[agentId].inputReady,
      inputReadyAt: transcriptCompletionSettledTurn
        ? transcriptExplicitInputReadyAt
        : providerBindings[agentId].inputReadyAt,
      inputReadyConfidence: transcriptCompletionSettledTurn
        ? "transcript-explicit-completion"
        : providerBindings[agentId].inputReadyConfidence,
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
          pendingPrompt: shouldClearAcceptedPendingPrompt ? null : existing.pendingPrompt,
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

export function appendWorkspaceThreadProjectionEvents(state, event = {}) {
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
  const projectionEvents = appendThreadProjectionEvents(
    ensureThreadProjectionEvents(existing),
    event.projectionEvents || event.events || [],
  );
  const messages = projectThreadProjectionMessages(projectionEvents, existing.messages);
  const projectedLatestTurn = projectLatestTurnFromEvents(projectionEvents, existing.latestTurn);
  const shouldClearOrphanRunning = isOrphanRunningThreadState({
    latestTurn: projectedLatestTurn,
    messageCount: messages.length,
    messages,
    pendingPrompt: event.clearPendingPrompt === false ? existing.pendingPrompt : null,
    projectionEvents,
    providerBindings: existing.providerBindings,
    transcriptSessionId: cleanText(event.providerSessionId || event.nativeSessionId, existing.transcriptSessionId),
  });
  const latestTurn = shouldClearOrphanRunning ? null : projectedLatestTurn;
  const latestTurnState = cleanText(latestTurn?.state).toLowerCase();
  const eventType = cleanText(event.type).toLowerCase();
  const activityStatus = latestTurnState === "running"
    ? "thinking"
    : ["completed", "error", "interrupted"].includes(latestTurnState)
      ? "idle"
      : activityStatusForLatestTurn(latestTurn, existing.activityStatus);
  const existingProviderBindingForAgent = normalizeProviderBinding(existing.providerBindings?.[agentId], agentId, {
    activityStatus: existing.activityStatus,
    coordination: existing.coordination,
    lastActiveAt: existing.lastActiveAt,
    lastMessageAt: existing.lastMessageAt,
    messageCount: existing.messageCount,
    status: existing.status,
    terminalBinding: existing.terminalBinding,
    updatedAt: existing.updatedAt,
  });
  const marksInputReady = event.inputReady === true
    || eventType === "terminal-input-ready"
    || eventType === "terminal-prompt-ready"
    || eventType === "provider-turn-completed"
    || eventType === "provider-turn-interrupted"
    || eventType === "provider-turn-error";
  const inputReady = marksInputReady
    ? true
    : latestTurnState === "running"
      ? false
      : Boolean(event.inputReady ?? existingProviderBindingForAgent?.inputReady);
  const inputReadyAt = inputReady
    ? cleanText(event.inputReadyAt || event.promptReadyAt, existingProviderBindingForAgent?.inputReadyAt)
    : "";
  const inputReadyConfidence = inputReady
    ? cleanText(
      event.inputReadyConfidence || event.promptReadyConfidence,
      existingProviderBindingForAgent?.inputReadyConfidence,
    )
    : "";
  const providerPromptingFields = promptingUserFieldsForTerminalEvent(event, existingProviderBindingForAgent, {
    clear: !inputReady || marksInputReady,
    eventType,
  });
  const shouldClearPendingPrompt = event.clearPendingPrompt !== false;
  let providerBindings = normalizeProviderBindings(
    existing.providerBindings,
    existing.currentAgent,
    {
      activityStatus,
      coordination: existing.coordination,
      lastActiveAt: now,
      lastMessageAt: messages.length ? messages[messages.length - 1].createdAt : existing.lastMessageAt,
      messageCount: messages.length,
      status: existing.status,
      terminalBinding: existing.terminalBinding,
      updatedAt: now,
    },
  );
  if (shouldClearOrphanRunning) {
    providerBindings = clearOrphanRunningProviderBindings(providerBindings);
  }
  if (providerBindings[agentId]) {
    providerBindings[agentId] = {
      ...providerBindings[agentId],
      activityStatus,
      lastActiveAt: now,
      lastMessageAt: messages.length ? messages[messages.length - 1].createdAt : providerBindings[agentId].lastMessageAt,
      messageCount: messages.length,
      inputReady,
      inputReadyAt,
      inputReadyConfidence,
      ...providerPromptingFields,
      modelId: cleanModelId(event.modelId || event.model, providerBindings[agentId].modelId),
      modelSource: cleanModelId(event.modelId || event.model) ? cleanText(event.modelSource, "provider-turn") : providerBindings[agentId].modelSource,
      modelUpdatedAt: cleanModelId(event.modelId || event.model) ? now : providerBindings[agentId].modelUpdatedAt,
      nativeSessionId: cleanText(event.nativeSessionId || event.providerSessionId, providerBindings[agentId].nativeSessionId),
      nativeSessionKind: cleanText(event.nativeSessionKind, providerBindings[agentId].nativeSessionKind || "session"),
      nativeSessionSource: cleanText(event.nativeSessionSource, providerBindings[agentId].nativeSessionSource || "provider-turn"),
      nativeSessionUpdatedAt: cleanText(event.nativeSessionId || event.providerSessionId) ? now : providerBindings[agentId].nativeSessionUpdatedAt,
      status: cleanText(event.status, existing.status || providerBindings[agentId].status || "active"),
      updatedAt: now,
    };
  }

  const terminalKey = getTerminalKeyForEvent(entry, event);
  const terminals = { ...entry.terminals };
  if (terminalKey && terminals[terminalKey]) {
    const terminalPromptingFields = promptingUserFieldsForTerminalEvent(event, terminals[terminalKey], {
      clear: !inputReady || marksInputReady,
      eventType,
    });
    terminals[terminalKey] = {
      ...terminals[terminalKey],
      inputReady,
      inputReadyAt,
      inputReadyConfidence,
      ...terminalPromptingFields,
      updatedAt: now,
    };
  }

  return {
    ...currentState,
    [workspaceId]: {
      ...entry,
      activeThreadId: threadId,
      terminals,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          activityStatus,
          lastActiveAt: now,
          lastMessageAt: messages.length ? messages[messages.length - 1].createdAt : existing.lastMessageAt,
          latestTurn,
          materialized: true,
          messageCount: messages.length,
          messages,
          pendingPrompt: shouldClearPendingPrompt ? null : existing.pendingPrompt,
          projectionEvents,
          providerBindings,
          status: cleanText(event.status, existing.status || "active"),
          transcriptSessionId: cleanText(event.providerSessionId || event.nativeSessionId, existing.transcriptSessionId),
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
  const eventType = cleanText(event.type).toLowerCase();
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
  const previousProviderBinding = normalizeProviderBinding(providerBindings[agentId], agentId, {
    activityStatus: existing.activityStatus,
    coordination: existing.coordination,
    lastActiveAt: existing.lastActiveAt,
    lastMessageAt: existing.lastMessageAt,
    messageCount: existing.messageCount,
    status: existing.status,
    terminalBinding: existing.currentAgent === agentId ? existing.terminalBinding : null,
    updatedAt: existing.updatedAt,
  });
  const explicitInputReady = typeof event.inputReady === "boolean" ? event.inputReady : null;
  const rawEventStatus = cleanText(event.status).toLowerCase();
  const eventStatus = LIVE_TERMINAL_STATUSES.has(rawEventStatus) ? rawEventStatus : "";
  const providerStatus = eventStatus
    || previousProviderBinding?.status
    || existing.status
    || "idle";
  const marksInputReady = explicitInputReady === true
    || eventType === "terminal-input-ready"
    || eventType === "terminal-prompt-ready"
    || eventType === "provider-turn-completed"
    || eventType === "provider-turn-interrupted"
    || eventType === "provider-turn-error";
  const marksInputBusy = explicitInputReady === false || activityStatus === "thinking";
  const inputReady = marksInputReady
    ? true
    : marksInputBusy
      ? false
      : Boolean(previousProviderBinding?.inputReady);
  const inputReadyAt = inputReady
    ? cleanText(event.inputReadyAt || event.promptReadyAt, previousProviderBinding?.inputReadyAt || now)
    : "";
  const inputReadyConfidence = inputReady
    ? cleanText(
      event.inputReadyConfidence || event.promptReadyConfidence,
      previousProviderBinding?.inputReadyConfidence,
    )
    : "";
  const providerPromptingFields = promptingUserFieldsForTerminalEvent(event, previousProviderBinding, {
    clear: !inputReady || marksInputReady,
    eventType,
  });
  providerBindings[agentId] = {
    ...previousProviderBinding,
    activityStatus,
    inputReady,
    inputReadyAt,
    inputReadyConfidence,
    ...providerPromptingFields,
    status: providerStatus,
    updatedAt: now,
  };
  const terminalKey = getTerminalKeyForEvent(entry, event);
  const terminals = { ...entry.terminals };
  if (terminalKey && terminals[terminalKey]) {
    const terminalPromptingFields = promptingUserFieldsForTerminalEvent(event, terminals[terminalKey], {
      clear: !inputReady || marksInputReady,
      eventType,
    });
    terminals[terminalKey] = {
      ...terminals[terminalKey],
      inputReady,
      inputReadyAt,
      inputReadyConfidence,
      ...terminalPromptingFields,
      status: eventStatus || terminals[terminalKey].status,
      updatedAt: now,
    };
  }

  return {
    ...currentState,
    [workspaceId]: {
      ...entry,
      terminals,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          activityStatus: existing.currentAgent === agentId ? activityStatus : existing.activityStatus,
          providerBindings,
          status: existing.currentAgent === agentId && eventStatus ? eventStatus : existing.status,
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

export function toggleWorkspaceThreadPinned(state, workspaceId, threadId) {
  const safeWorkspaceId = cleanText(workspaceId);
  const safeThreadId = cleanText(threadId);
  if (!safeWorkspaceId || !safeThreadId) {
    return state || {};
  }

  const currentState = normalizeWorkspaceThreads(state);
  const entry = currentState[safeWorkspaceId]
    ? ensureWorkspaceEntry(currentState, safeWorkspaceId)
    : null;
  const existing = entry?.threads?.[safeThreadId];
  if (!entry || !existing || !getWorkspaceThreadCanPin(existing)) {
    return state || {};
  }

  entry.threads[safeThreadId] = {
    ...existing,
    pinnedAt: cleanText(existing.pinnedAt) ? "" : nowIso(),
    updatedAt: nowIso(),
  };

  return {
    ...currentState,
    [safeWorkspaceId]: entry,
  };
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

export function getWorkspaceThreadCanPin(thread) {
  return getWorkspaceThreadCanArchive(thread);
}

export function getWorkspaceThreadIsPinned(thread) {
  return Boolean(getWorkspaceThreadCanPin(thread) && cleanText(thread?.pinnedAt));
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

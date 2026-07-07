import {
  transcriptArray,
  transcriptText,
  transcriptTimestampMs,
  transcriptToken,
} from "./builders.mjs";

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function cloneValue(value) {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  try {
    return typeof structuredClone === "function"
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  } catch {
    return value;
  }
}

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function hasStructuredContent(value) {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function messageKind(message = {}) {
  return transcriptToken(
    message.kind
      || message.canonicalKind
      || message.canonical_kind
      || message.messageKind
      || message.message_kind
      || message.type,
  );
}

function canonicalKind(message = {}) {
  return transcriptToken(
    message.canonicalKind
      || message.canonical_kind
      || message.kind
      || message.messageKind
      || message.message_kind
      || message.type,
  );
}

function isTurnSummary(message = {}) {
  return messageKind(message) === "turn-summary" || canonicalKind(message) === "turn-summary";
}

function desktopToolFromMessage(message = {}) {
  const existing = plainObject(message.tool || message.tool_call || message.toolCall);
  if (existing) return cloneValue(existing);

  const kind = canonicalKind(message);
  const role = transcriptToken(message.role);
  const hasToolMarker = role === "activity"
    || kind.startsWith("tool")
    || kind === "activity"
    || kind === "system-note"
    || hasStructuredContent(message.toolInput)
    || hasStructuredContent(message.tool_input)
    || hasStructuredContent(message.toolOutput)
    || hasStructuredContent(message.tool_output)
    || hasStructuredContent(message.toolError)
    || hasStructuredContent(message.tool_error)
    || transcriptText(message.toolName || message.tool_name || message.command || message.filePath || message.file_path);

  if (!hasToolMarker || kind === "file-change" || kind === "patch" || kind === "reasoning") {
    return null;
  }

  const command = transcriptText(message.command);
  const filePath = transcriptText(message.filePath || message.file_path || message.path);
  const explicitInput = firstPresent(
    message.toolInput,
    message.tool_input,
    message.input,
    message.arguments,
    message.args,
  );
  const explicitOutput = firstPresent(
    message.toolOutput,
    message.tool_output,
    message.output,
    message.result,
  );
  const explicitError = firstPresent(message.toolError, message.tool_error, message.error, message.stderr);
  const input = explicitInput !== undefined
    ? explicitInput
    : command
      ? { command }
      : filePath
        ? { path: filePath }
        : undefined;
  const output = explicitOutput !== undefined
    ? explicitOutput
    : explicitError !== undefined
      ? { error: explicitError }
      : undefined;

  return {
    durationMs: firstPresent(message.durationMs, message.duration_ms),
    exitCode: firstPresent(message.exitCode, message.exit_code),
    input,
    name: transcriptText(
      message.toolDisplayName
        || message.tool_display_name
        || message.toolName
        || message.tool_name
        || message.name
        || command
        || filePath,
    ),
    output,
    status: transcriptText(message.status),
    title: transcriptText(message.title),
  };
}

function desktopFileChangeFromMessage(message = {}) {
  const existing = plainObject(message.file_change || message.fileChange);
  if (existing) return cloneValue(existing);
  const files = transcriptArray(
    message.files || message.changed_files || message.changedFiles,
  );
  if (!files.length) return null;
  return {
    files: cloneValue(files),
    summary: transcriptText(message.summary || message.title),
  };
}

function desktopUsageFromMessage(message = {}) {
  const existing = plainObject(message.usage || message.usage_report || message.usageReport);
  if (existing) return cloneValue(existing);
  const tokenUsage = plainObject(message.token_usage || message.tokenUsage);
  return tokenUsage ? cloneValue(tokenUsage) : null;
}

export function normalizeDesktopTranscriptMessage(message = {}) {
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  const next = { ...message };
  const createdAt = firstPresent(message.createdAt, message.created_at, message.timestamp);
  const turnId = firstPresent(message.turnId, message.turn_id);
  const canonical = firstPresent(message.canonicalKind, message.canonical_kind);
  const legacy = firstPresent(message.legacyKind, message.legacy_kind);
  const tool = desktopToolFromMessage(message);
  const fileChange = desktopFileChangeFromMessage(message);
  const usage = desktopUsageFromMessage(message);

  if (createdAt !== undefined) {
    next.createdAt = next.createdAt || createdAt;
    next.created_at = next.created_at || createdAt;
    next.timestamp = next.timestamp || createdAt;
  }
  if (turnId !== undefined) {
    next.turnId = next.turnId || turnId;
    next.turn_id = next.turn_id || turnId;
  }
  if (canonical !== undefined) {
    next.canonicalKind = next.canonicalKind || canonical;
    next.canonical_kind = next.canonical_kind || canonical;
  }
  if (legacy !== undefined) {
    next.legacyKind = next.legacyKind || legacy;
    next.legacy_kind = next.legacy_kind || legacy;
  }
  if (tool && !plainObject(next.tool)) {
    next.tool = tool;
  }
  if (fileChange) {
    next.file_change = next.file_change || fileChange;
    next.fileChange = next.fileChange || fileChange;
  }
  if (usage) {
    next.usage = next.usage || usage;
  }
  if (message.recordId || message.record_id) {
    next.recordId = next.recordId || message.recordId || message.record_id;
    next.record_id = next.record_id || message.record_id || message.recordId;
  }
  if (message.recordSeq || message.record_seq) {
    next.recordSeq = next.recordSeq || message.recordSeq || message.record_seq;
    next.record_seq = next.record_seq || message.record_seq || message.recordSeq;
  }

  return next;
}

export function normalizeDesktopTranscriptMessages(messages = []) {
  return transcriptArray(messages)
    .map(normalizeDesktopTranscriptMessage)
    .filter(Boolean);
}

export function buildDesktopTranscriptItems(messages = [], {
  itemIdPrefix = "desktop-thread-message",
} = {}) {
  const items = [];
  let assistantBlock = null;
  let activityGroup = [];

  const messageId = (message, index) => transcriptText(message?.id, `message-${index}`);
  const messageTurnId = (message) => transcriptText(message?.turnId || message?.turn_id);

  const flushActivityGroup = () => {
    if (!activityGroup.length || !assistantBlock) return;
    const first = activityGroup[0];
    const last = activityGroup[activityGroup.length - 1];
    assistantBlock.items.push({
      id: `activity-group-${messageId(first, items.length)}-${messageId(last, activityGroup.length)}`,
      messages: activityGroup,
      turnId: messageTurnId(first) || messageTurnId(last),
      turn_id: messageTurnId(first) || messageTurnId(last),
      type: "activity-group",
    });
    activityGroup = [];
  };

  const flushAssistantBlock = () => {
    if (!assistantBlock) return;
    flushActivityGroup();
    if (assistantBlock.items.length) items.push(assistantBlock);
    assistantBlock = null;
  };

  const ensureAssistantBlock = (message, index) => {
    const turnId = messageTurnId(message);
    if (assistantBlock?.turnId && turnId && assistantBlock.turnId !== turnId) {
      flushAssistantBlock();
    }
    if (!assistantBlock) {
      assistantBlock = {
        id: `assistant-block-${messageId(message, index)}`,
        items: [],
        turnId,
        turn_id: turnId,
        type: "assistant-block",
      };
    } else if (!assistantBlock.turnId && turnId) {
      assistantBlock.turnId = turnId;
      assistantBlock.turn_id = turnId;
    }
    return assistantBlock;
  };

  normalizeDesktopTranscriptMessages(messages).forEach((message, index) => {
    if (isTurnSummary(message)) return;
    const role = transcriptToken(message.role);
    if (role === "activity") {
      ensureAssistantBlock(message, index);
      activityGroup.push(message);
      return;
    }
    if (role === "assistant") {
      const block = ensureAssistantBlock(message, index);
      flushActivityGroup();
      block.items.push({
        id: messageId(message, index),
        message,
        turnId: messageTurnId(message),
        turn_id: messageTurnId(message),
        type: "message",
      });
      return;
    }
    flushAssistantBlock();
    items.push({
      id: `${itemIdPrefix}-${messageId(message, index)}`,
      message,
      turnId: messageTurnId(message),
      turn_id: messageTurnId(message),
      type: "message",
    });
  });

  flushAssistantBlock();
  return items;
}

export function normalizeDesktopDiffSummary(summary = null, fallbackTurnId = "") {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
  const files = transcriptArray(summary.files).filter(Boolean);
  if (!files.length && !Number(summary.fileCount || summary.file_count || 0)) return null;
  return {
    ...summary,
    files,
    fileCount: Number(summary.fileCount || summary.file_count || files.length || 0) || files.length,
    turnId: transcriptText(summary.turnId || summary.turn_id || fallbackTurnId),
    turn_id: transcriptText(summary.turn_id || summary.turnId || fallbackTurnId),
  };
}

export function desktopTimestampMs(...values) {
  for (const value of values) {
    const timestamp = transcriptTimestampMs(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

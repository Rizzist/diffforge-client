import {
  cleanLiveViewText,
  stripLiveViewControlSequences,
} from "../terminals/liveViewSanitizer.js";
import {
  isTerminalControlHistoryPrompt,
  isTerminalModelPickerUiPrompt,
} from "./terminalControlPrompts.js";

const WORKSPACE_THREADS_STORAGE_KEY = "diffforge.workspaceThreads.v1";
const WORKSPACE_THREAD_DETAIL_VISIBILITY_REGISTRY_KEY = "__diffforgeWorkspaceThreadDetailVisibility";
export const WORKSPACE_THREAD_DETAIL_VISIBILITY_EVENT = "diffforge:workspace-thread-detail-visibility";
const MAX_THREAD_PROJECTION_EVENTS = 900;
const MAX_THREAD_MESSAGES = 360;
const MAX_THREAD_ARTIFACTS = 16;
const MAX_PERSISTED_THREAD_PROJECTION_EVENTS = 64;
const MAX_PERSISTED_THREAD_MESSAGES = 64;
const MAX_PERSISTED_THREAD_TEXT_CHARS = 1800;
const MAX_PERSISTED_THREAD_TOOL_VALUE_CHARS = 6000;
const MAX_THREADS_PER_WORKSPACE = 80;
const PASTED_LINES_MESSAGE_EQUIVALENCE_MAX_DELTA_MS = 90_000;
const THREAD_PROMPT_LABEL_MAX_WORDS = 6;
const THREAD_PROMPT_LABEL_MAX_CHARS = 48;
const THREAD_PROMPT_LABEL_ELLIPSIS = "...";
const DEFAULT_AGENT_ID = "codex";
const THREAD_AGENT_IDS = ["codex", "claude", "opencode"];
const WORKSPACE_TERMINAL_NICKNAMES = [
  "Al", "Bo", "Cy", "Ed", "Ev", "Jo", "Li", "Mo", "Oz", "Ty",
  "Ada", "Ali", "Amy", "Ari", "Ava", "Bea", "Ben", "Bob", "Cal", "Dan",
  "Eli", "Eva", "Gia", "Gus", "Hal", "Ian", "Ira", "Jay", "Kai", "Kim",
  "Leo", "Lia", "Lou", "Mac", "Max", "Mia", "Ned", "Ona", "Pam", "Ray",
  "Rex", "Sam", "Sue", "Taj", "Alex", "Matt", "Mike", "Noah", "Omar", "Ezra",
];
const WORKSPACE_TERMINAL_NICKNAME_BY_KEY = new Map(
  WORKSPACE_TERMINAL_NICKNAMES.map((name) => [name.toLowerCase(), name]),
);
const LIVE_TERMINAL_STATUSES = new Set([
  "active",
  "closed",
  "closing",
  "compacting",
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
  "provider-user-prompt-answered",
  "provider-turn-completed",
  "provider-turn-error",
  "provider-turn-interrupted",
  "provider-turn-started",
  "thread-starting",
]);
const EXPLICIT_PERMISSION_PROMPT_KINDS = new Set(["approval", "permission"]);
const EXPLICIT_PERMISSION_PROMPT_SOURCE_PARTS = [
  "approval",
  "claude-hook",
  "claude-permission",
  "codex-hook",
  "codex-permission",
  "coordination",
  "permission",
  "pre-tool-use",
  "pretooluse",
  "provider-permission",
  "tool-permission",
];
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

function isThreadTurnLifecycleProjectionEvent(event) {
  return cleanText(event?.type).startsWith("thread.turn.");
}

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

function cleanTextArray(...values) {
  const result = [];
  const append = (value) => {
    if (Array.isArray(value)) {
      value.forEach(append);
      return;
    }
    if (value == null) {
      return;
    }
    const text = cleanText(value);
    if (!text) {
      return;
    }
    text
      .split(",")
      .map((entry) => cleanText(entry))
      .filter(Boolean)
      .forEach((entry) => result.push(entry));
  };
  values.forEach(append);
  return Array.from(new Set(result));
}

export function getWorkspaceThreadDetailVisibilityKey({ workspaceId = "", threadId = "" } = {}) {
  const safeWorkspaceId = cleanText(workspaceId);
  const safeThreadId = cleanText(threadId);
  return safeWorkspaceId && safeThreadId ? `${safeWorkspaceId}::${safeThreadId}` : "";
}

function getWorkspaceThreadDetailVisibilityRegistry() {
  if (typeof window === "undefined") {
    return null;
  }

  const existing = window[WORKSPACE_THREAD_DETAIL_VISIBILITY_REGISTRY_KEY];
  if (existing instanceof Map) {
    return existing;
  }

  const registry = new Map();
  window[WORKSPACE_THREAD_DETAIL_VISIBILITY_REGISTRY_KEY] = registry;
  return registry;
}

export function setWorkspaceThreadDetailVisibility(detail = {}) {
  const workspaceId = cleanText(detail.workspaceId || detail.workspace_id);
  const threadId = cleanText(detail.threadId || detail.thread_id);
  const key = getWorkspaceThreadDetailVisibilityKey({ workspaceId, threadId });
  if (!key) {
    return "";
  }

  const registry = getWorkspaceThreadDetailVisibilityRegistry();
  const token = cleanText(detail.token, "default");
  const visible = detail.visible !== false;
  if (registry) {
    let entry = registry.get(key);
    if (visible) {
      if (!(entry instanceof Map)) {
        entry = new Map();
        registry.set(key, entry);
      }
      entry.set(token, {
        ...detail,
        threadId,
        visible: true,
        workspaceId,
      });
    } else if (entry instanceof Map) {
      if (token) {
        entry.delete(token);
      } else {
        entry.clear();
      }
      if (entry.size === 0) {
        registry.delete(key);
      }
    }
  }

  if (
    typeof window !== "undefined"
    && typeof window.dispatchEvent === "function"
    && typeof CustomEvent === "function"
  ) {
    window.dispatchEvent(new CustomEvent(WORKSPACE_THREAD_DETAIL_VISIBILITY_EVENT, {
      detail: {
        ...detail,
        threadId,
        visible,
        workspaceId,
      },
    }));
  }

  return key;
}

export function workspaceThreadDetailIsVisible({ workspaceId = "", threadId = "" } = {}) {
  const registry = getWorkspaceThreadDetailVisibilityRegistry();
  const key = getWorkspaceThreadDetailVisibilityKey({ workspaceId, threadId });
  if (!registry || !key) {
    return false;
  }

  const entry = registry.get(key);
  return entry instanceof Map && entry.size > 0;
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

function normalizePromptingUserSource(value, fallback = "") {
  return cleanText(value, fallback)
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

function promptingPermissionToken(value = {}, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const fallbackSource = fallback && typeof fallback === "object" ? fallback : {};
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
    fallbackSource.approvalId
      || fallbackSource.approval_id
      || fallbackSource.permissionPromptId
      || fallbackSource.permission_prompt_id
      || fallbackSource.permissionRequestId
      || fallbackSource.permission_request_id
      || fallbackSource.sourceEventId
      || fallbackSource.source_event_id
      || fallbackSource.toolUseId
      || fallbackSource.tool_use_id,
  );
}

function promptingSourceLooksExplicitPermission(source) {
  const normalized = normalizePromptingUserSource(source);
  return Boolean(
    normalized
      && EXPLICIT_PERMISSION_PROMPT_SOURCE_PARTS.some((part) => normalized.includes(part))
      && !normalized.includes("terminal-output")
  );
}

function valueLooksExplicitPermissionPrompt(value = {}, fallback = {}) {
  const sourceValue = value && typeof value === "object" ? value : {};
  const fallbackValue = fallback && typeof fallback === "object" ? fallback : {};
  const active = promptingUserActive(
    sourceValue.terminalIsPromptingUser
      ?? sourceValue.terminal_is_prompting_user
      ?? sourceValue.promptingUser
      ?? sourceValue.prompting_user
      ?? sourceValue.requiresUserInput
      ?? sourceValue.requires_user_input,
    fallbackValue.terminalIsPromptingUser
      || fallbackValue.terminal_is_prompting_user
      || fallbackValue.promptingUser
      || fallbackValue.prompting_user
      || fallbackValue.requiresUserInput
      || fallbackValue.requires_user_input,
  );
  if (!active) {
    return false;
  }

  const kind = normalizePromptingUserKind(
    sourceValue.promptingUserKind
      || sourceValue.prompting_user_kind
      || sourceValue.promptingKind
      || sourceValue.prompting_kind,
    fallbackValue.promptingUserKind
      || fallbackValue.prompting_user_kind
      || fallbackValue.promptingKind
      || fallbackValue.prompting_kind
      || "",
  );
  const source = sourceValue.promptingUserSource
    || sourceValue.prompting_user_source
    || sourceValue.promptingSource
    || sourceValue.prompting_source
    || sourceValue.source
    || sourceValue.type
    || fallbackValue.promptingUserSource
    || fallbackValue.prompting_user_source
    || fallbackValue.promptingSource
    || fallbackValue.prompting_source;
  const hasPermissionKind = EXPLICIT_PERMISSION_PROMPT_KINDS.has(kind)
    || sourceValue.requiresUserInput === true
    || sourceValue.requires_user_input === true
    || fallbackValue.requiresUserInput === true
    || fallbackValue.requires_user_input === true;

  return Boolean(
    hasPermissionKind
      && (promptingPermissionToken(sourceValue, fallbackValue) || promptingSourceLooksExplicitPermission(source))
  );
}

function promptingUserFields(value = {}, fallback = {}) {
  const sourceValue = value && typeof value === "object" ? value : {};
  const fallbackValue = fallback && typeof fallback === "object" ? fallback : {};
  const active = valueLooksExplicitPermissionPrompt(sourceValue, fallbackValue);
  const sourceText = sourceValue.promptingUserSource
    || sourceValue.prompting_user_source
    || sourceValue.promptingSource
    || sourceValue.prompting_source
    || sourceValue.source
    || fallbackValue.promptingUserSource
    || fallbackValue.prompting_user_source
    || fallbackValue.promptingSource
    || fallbackValue.prompting_source;
  return {
    promptingUserConfidence: active
      ? cleanText(sourceValue.promptingUserConfidence || sourceValue.promptingConfidence, fallbackValue.promptingUserConfidence || fallbackValue.promptingConfidence)
      : "",
    promptingUserKind: active
      ? normalizePromptingUserKind(sourceValue.promptingUserKind || sourceValue.promptingKind, fallbackValue.promptingUserKind || fallbackValue.promptingKind || "unknown")
      : "",
    promptingUserSource: active
      ? cleanText(
        promptingSourceLooksExplicitPermission(sourceText)
          ? sourceText
          : promptingPermissionToken(sourceValue, fallbackValue)
            ? "permission-token"
            : sourceText,
        "permission",
      )
      : "",
    promptingUserText: active
      ? cleanText(sourceValue.promptingUserText || sourceValue.promptingText, fallbackValue.promptingUserText || fallbackValue.promptingText).slice(0, 420)
      : "",
    terminalIsPromptingUser: active,
  };
}

function eventExplicitlyPromptsUser(event = {}) {
  return valueLooksExplicitPermissionPrompt(event);
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

function hookHealthFields(value = {}, fallback = {}) {
  const sourceValue = value && typeof value === "object" ? value : {};
  const fallbackValue = fallback && typeof fallback === "object" ? fallback : {};
  const observedAtMs = Number(
    sourceValue.hookHealthObservedAtMs
      || sourceValue.hook_health_observed_at_ms
      || fallbackValue.hookHealthObservedAtMs
      || fallbackValue.hook_health_observed_at_ms
      || 0,
  );
  return {
    hookHealthEvent: cleanText(
      sourceValue.hookHealthEvent || sourceValue.hook_health_event,
      fallbackValue.hookHealthEvent || fallbackValue.hook_health_event,
    ),
    hookHealthObservedAtMs: Number.isFinite(observedAtMs) && observedAtMs > 0 ? observedAtMs : 0,
    hookHealthStatus: cleanText(
      sourceValue.hookHealthStatus || sourceValue.hook_health_status,
      fallbackValue.hookHealthStatus || fallbackValue.hook_health_status,
    ),
  };
}

function cleanMessageText(value, fallback = "") {
  const text = String(value || "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();

  return text || fallback;
}

function tryParseJsonLikeText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const candidate = text.startsWith("```")
    ? text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()
    : text;
  if (!/^[{[]/.test(candidate) || !/[}\]]$/.test(candidate)) {
    return null;
  }
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function normalizeThreadToolValue(value) {
  if (value == null) {
    return undefined;
  }
  if (typeof value === "string") {
    const text = cleanMessageText(value);
    if (!text) {
      return undefined;
    }
    const parsed = tryParseJsonLikeText(text);
    return parsed == null ? text : parsed;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) || typeof value === "object") {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      const text = cleanMessageText(String(value));
      return text || undefined;
    }
  }
  return undefined;
}

function threadToolValueHasContent(value) {
  if (value == null) {
    return false;
  }
  if (typeof value === "string") {
    return cleanMessageText(value).length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function pickThreadToolValue(source, keys) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return undefined;
  }
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      const value = normalizeThreadToolValue(source[key]);
      if (threadToolValueHasContent(value)) {
        return value;
      }
    }
  }
  return undefined;
}

function normalizeThreadToolMetadata(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const toolInput = pickThreadToolValue(source, [
    "toolInput",
    "tool_input",
    "input",
    "arguments",
    "args",
  ]);
  const toolOutput = pickThreadToolValue(source, [
    "toolOutput",
    "tool_output",
    "output",
    "result",
  ]);
  const toolError = pickThreadToolValue(source, [
    "toolError",
    "tool_error",
    "error",
    "stderr",
  ]);
  const rawToolPayload = pickThreadToolValue(source, [
    "rawToolPayload",
    "raw_tool_payload",
    "rawPayload",
    "raw_payload",
    "raw",
  ]);
  const durationMs = Number(
    source.durationMs
      || source.duration_ms
      || source.elapsedMs
      || source.elapsed_ms
      || 0,
  );
  const exitCode = Number(
    source.exitCode
      ?? source.exit_code
      ?? source.code
      ?? Number.NaN,
  );
  const metadata = {
    command: cleanMessageText(source.command),
    filePath: cleanText(source.filePath || source.file_path || source.path),
    toolDisplayName: cleanText(source.toolDisplayName || source.tool_display_name),
    toolName: cleanText(source.toolName || source.tool_name || source.name),
    toolServer: cleanText(source.toolServer || source.tool_server || source.server),
  };
  if (threadToolValueHasContent(toolInput)) metadata.toolInput = toolInput;
  if (threadToolValueHasContent(toolOutput)) metadata.toolOutput = toolOutput;
  if (threadToolValueHasContent(toolError)) metadata.toolError = toolError;
  if (threadToolValueHasContent(rawToolPayload)) metadata.rawToolPayload = rawToolPayload;
  if (Number.isFinite(durationMs) && durationMs > 0) metadata.durationMs = Math.round(durationMs);
  if (Number.isFinite(exitCode)) metadata.exitCode = Math.trunc(exitCode);

  return Object.fromEntries(
    Object.entries(metadata).filter(([, entry]) => (
      threadToolValueHasContent(entry)
    )),
  );
}

function threadToolMetadataHasContent(metadata) {
  return Object.keys(normalizeThreadToolMetadata(metadata)).length > 0;
}

function normalizeThreadArtifact(artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return null;
  }

  const mimeType = cleanText(artifact.mimeType || artifact.mime_type || artifact.contentType || artifact.content_type);
  const path = cleanText(artifact.path || artifact.filePath || artifact.file_path || artifact.localPath || artifact.local_path);
  const url = cleanText(artifact.url || artifact.uri || artifact.fileUrl || artifact.file_url || artifact.imageUrl || artifact.image_url);
  const reference = url || path;
  if (!reference) {
    return null;
  }

  const kind = cleanText(
    artifact.kind || artifact.type,
    mimeType.toLowerCase().startsWith("image/") ? "image" : "file",
  )
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .slice(0, 48);

  return {
    kind: kind || "file",
    mimeType,
    name: cleanText(artifact.name || artifact.filename || artifact.fileName || artifact.file_name),
    path,
    prompt: cleanMessageText(artifact.prompt),
    title: cleanText(artifact.title || artifact.label),
    url,
  };
}

function normalizeThreadArtifacts(value) {
  const artifacts = Array.isArray(value) ? value : [];
  const normalized = [];
  const seen = new Set();

  artifacts.forEach((artifact) => {
    const normalizedArtifact = normalizeThreadArtifact(artifact);
    if (!normalizedArtifact) {
      return;
    }
    const key = normalizedArtifact.url || normalizedArtifact.path;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    normalized.push(normalizedArtifact);
  });

  return normalized.slice(0, MAX_THREAD_ARTIFACTS);
}

function threadArtifactsSignature(artifacts) {
  return normalizeThreadArtifacts(artifacts)
    .map((artifact) => [
      artifact.kind,
      artifact.mimeType,
      artifact.url,
      artifact.path,
      artifact.title,
      artifact.prompt,
    ].join(":"))
    .join("|");
}

function mergeThreadArtifacts(...artifactGroups) {
  return normalizeThreadArtifacts(
    artifactGroups
      .flatMap((artifacts) => (Array.isArray(artifacts) ? artifacts : [])),
  );
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

function isLiveHookProjectionSource(source) {
  return cleanText(source).toLowerCase().startsWith("cli-hook:");
}

function isLiveHookProjectionEvent(event) {
  return Boolean(isLiveHookProjectionSource(event?.source));
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

function projectionTurnIdsMatchPrompt(leftTurnId, rightTurnId, promptMessageId = "") {
  const left = cleanText(leftTurnId);
  const right = cleanText(rightTurnId);
  const promptId = cleanText(promptMessageId);
  return Boolean(
    !left
      || !right
      || left === right
      || (promptId && left.includes(promptId) && right.includes(promptId)),
  );
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

function cleanAgentDisplayName(value, fallback = "") {
  return cleanThreadLabelCandidate(value || fallback);
}

function normalizeWorkspaceTerminalNickname(value, fallback = "") {
  const text = String(value || fallback)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }

  const key = text.toLowerCase().replace(/[^a-z]/g, "");
  return WORKSPACE_TERMINAL_NICKNAME_BY_KEY.get(key) || "";
}

function terminalNicknameKey(value) {
  return normalizeWorkspaceTerminalNickname(value).toLowerCase();
}

function terminalNicknameFromSources(...sources) {
  for (const source of sources) {
    const nickname = normalizeWorkspaceTerminalNickname(source);
    if (nickname) {
      return nickname;
    }
  }

  return "";
}

function workspaceTerminalNicknameFromRecord(record) {
  return terminalNicknameFromSources(
    record?.terminalNickname,
    record?.terminal_nickname,
    record?.terminalName,
    record?.terminal_name,
    record?.displayName,
    record?.display_name,
  );
}

function randomWorkspaceTerminalNicknameOffset() {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const values = new Uint32Array(1);
    crypto.getRandomValues(values);
    return values[0] % WORKSPACE_TERMINAL_NICKNAMES.length;
  }

  return Math.floor(Math.random() * WORKSPACE_TERMINAL_NICKNAMES.length);
}

function workspaceTerminalNicknameInUse(entry, nickname, options = {}) {
  const key = terminalNicknameKey(nickname);
  if (!key) {
    return false;
  }

  const excludeThreadId = cleanText(options.excludeThreadId || options.threadId);
  const excludeTerminalKey = terminalSessionKey(options.excludeTerminalIndex ?? options.terminalIndex);

  return Object.entries(entry?.terminals || {}).some(([terminalKey, terminal]) => {
    if (excludeTerminalKey && terminalKey === excludeTerminalKey) {
      return false;
    }
    if (excludeThreadId && cleanText(terminal?.threadId) === excludeThreadId) {
      return false;
    }
    return terminalNicknameKey(workspaceTerminalNicknameFromRecord(terminal)) === key;
  }) || Object.values(entry?.threads || {}).some((thread) => {
    if (!thread || (excludeThreadId && cleanText(thread.id) === excludeThreadId)) {
      return false;
    }
    const threadTerminalKey = terminalSessionKey(getThreadTerminalIndex(thread));
    const mappedThreadId = threadTerminalKey ? cleanText(entry?.terminalThreadIds?.[threadTerminalKey]) : "";
    const activeThreadId = threadTerminalKey ? cleanText(entry?.terminals?.[threadTerminalKey]?.threadId) : "";
    if (mappedThreadId !== thread.id && activeThreadId !== thread.id) {
      return false;
    }
    return terminalNicknameKey(workspaceTerminalNicknameFromRecord(thread)) === key;
  });
}

function pickWorkspaceTerminalNickname(entry, options = {}) {
  const offset = randomWorkspaceTerminalNicknameOffset();
  for (let index = 0; index < WORKSPACE_TERMINAL_NICKNAMES.length; index += 1) {
    const nickname = WORKSPACE_TERMINAL_NICKNAMES[(offset + index) % WORKSPACE_TERMINAL_NICKNAMES.length];
    if (!workspaceTerminalNicknameInUse(entry, nickname, options)) {
      return nickname;
    }
  }

  return "";
}

function resolveWorkspaceTerminalNickname(entry, candidates = [], options = {}) {
  for (const candidate of candidates) {
    const nickname = normalizeWorkspaceTerminalNickname(candidate);
    if (nickname && !workspaceTerminalNicknameInUse(entry, nickname, options)) {
      return nickname;
    }
  }

  return pickWorkspaceTerminalNickname(entry, options);
}

export function getWorkspaceThreadTerminalNickname(thread, providerBinding = null, terminal = null) {
  return terminalNicknameFromSources(
    terminal?.terminalNickname,
    terminal?.terminal_nickname,
    terminal?.terminalName,
    terminal?.terminal_name,
    terminal?.displayName,
    terminal?.display_name,
    thread?.terminalNickname,
    thread?.terminal_nickname,
    thread?.terminalName,
    thread?.terminal_name,
    thread?.displayName,
    thread?.display_name,
    providerBinding?.terminalNickname,
    providerBinding?.terminal_nickname,
    providerBinding?.terminalName,
    providerBinding?.terminal_name,
    providerBinding?.displayName,
    providerBinding?.display_name,
  );
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
  return [
    "delegating",
    "compacting",
    "compaction",
    "editing",
    "error",
    "failed",
    "idle",
    "mcp",
    "needs_input",
    "paused",
    "prompting_user",
    "running",
    "shell",
    "subagent",
    "subagent_completed",
    "subagent_running",
    "thinking",
    "tool",
    "tool_completed",
    "tool_running",
    "working",
  ].includes(status) ? status : "idle";
}

function normalizeThreadTurnState(value, fallback = "") {
  const state = cleanText(value, fallback).toLowerCase();
  if (state === "compacting" || state === "compaction") return "running";
  return THREAD_TURN_STATES.has(state) ? state : "";
}

function normalizeThreadPromptEpoch(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }
  return Math.floor(numericValue);
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
    promptEpoch: normalizeThreadPromptEpoch(value.promptEpoch || value.prompt_epoch),
    prompt_epoch: normalizeThreadPromptEpoch(value.promptEpoch || value.prompt_epoch),
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
  if (CLOSED_THREAD_TURN_STATES.has(normalizedTurn?.state)) {
    return "idle";
  }

  return normalizeThreadActivityStatus(fallback);
}

function explicitRuntimeActivityStatus(event = {}, fallback = "") {
  const rawStatus = cleanText(
    event.activityStatus
      || event.activity_status
      || event.nativeRailState
      || event.native_rail_state
      || event.terminalWorkState
      || event.terminal_work_state,
  );
  if (!rawStatus) {
    return fallback;
  }
  return normalizeThreadActivityStatus(rawStatus, fallback);
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
  const artifacts = normalizeThreadArtifacts(message.artifacts || message.attachments);
  const toolMetadata = normalizeThreadToolMetadata(message);
  const title = cleanText(message.title);
  const status = cleanText(message.status, "submitted");
  const isTurnCompleteMessage = safeRole === "assistant"
    && (
      kind === "task_complete"
      || kind === "final_answer"
      || status.toLowerCase() === "task_complete"
    );
  const hasToolMetadata = safeRole === "activity" && threadToolMetadataHasContent(toolMetadata);
  const hasActivityTitle = safeRole === "activity" && Boolean(title);
  if (
    !id
    || (!text && !isTurnCompleteMessage && !artifacts.length && !hasToolMetadata && !hasActivityTitle)
    || kind === "live_output"
    || source === "terminal-live"
    || (safeRole === "user" && isTerminalArtifactMessage(message.text || message.message))
  ) {
    return null;
  }

  return {
    agentId: cleanAgentId(message.agentId || message.agent_id, ""),
    artifacts,
    callId: cleanText(message.callId || message.call_id),
    createdAt: cleanText(message.createdAt || message.created_at, nowIso()),
    id,
    kind: kind || (safeRole === "activity" ? "activity" : "message"),
    role: safeRole,
    source,
    status,
    text,
    title,
    turnId: cleanText(message.turnId || message.turn_id),
    ...toolMetadata,
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

function compactPersistedThreadText(value) {
  const text = cleanMessageText(value);
  if (text.length <= MAX_PERSISTED_THREAD_TEXT_CHARS) {
    return text;
  }
  return `${text.slice(0, MAX_PERSISTED_THREAD_TEXT_CHARS)}${THREAD_PROMPT_LABEL_ELLIPSIS}`;
}

function compactPersistedThreadToolValue(value) {
  if (!threadToolValueHasContent(value)) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.length <= MAX_PERSISTED_THREAD_TOOL_VALUE_CHARS
      ? value
      : `${value.slice(0, MAX_PERSISTED_THREAD_TOOL_VALUE_CHARS)}${THREAD_PROMPT_LABEL_ELLIPSIS}`;
  }
  try {
    const text = JSON.stringify(value);
    if (text.length <= MAX_PERSISTED_THREAD_TOOL_VALUE_CHARS) {
      return value;
    }
    return `${text.slice(0, MAX_PERSISTED_THREAD_TOOL_VALUE_CHARS)}${THREAD_PROMPT_LABEL_ELLIPSIS}`;
  } catch {
    return undefined;
  }
}

function compactPersistedThreadToolMetadata(value = {}) {
  const metadata = normalizeThreadToolMetadata(value);
  return Object.fromEntries(
    Object.entries(metadata)
      .map(([key, entry]) => {
        if (["toolName", "toolServer", "toolDisplayName", "command", "filePath"].includes(key)) {
          return [key, key === "command" ? compactPersistedThreadText(entry) : cleanText(entry)];
        }
        if (key === "durationMs" || key === "exitCode") {
          return [key, entry];
        }
        return [key, compactPersistedThreadToolValue(entry)];
      })
      .filter(([, entry]) => threadToolValueHasContent(entry)),
  );
}

function compactPersistedThreadMessage(message) {
  const normalizedMessage = normalizeThreadMessage(message);
  if (!normalizedMessage) {
    return null;
  }

  return {
    ...normalizedMessage,
    text: compactPersistedThreadText(normalizedMessage.text),
    ...compactPersistedThreadToolMetadata(normalizedMessage),
  };
}

function compactPersistedThreadMessages(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map(compactPersistedThreadMessage)
    .filter(Boolean)
    .slice(-MAX_PERSISTED_THREAD_MESSAGES);
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
  const artifacts = normalizeThreadArtifacts(event.artifacts || event.attachments);
  const toolMetadata = normalizeThreadToolMetadata(event);
  const hasToolMetadata = isActivityProjectionEventType(type)
    && threadToolMetadataHasContent(toolMetadata);
  if (
    (!messageId || (isTurnProjectionEventType(type) && !(turnId || messageId)))
    || (
      !text
      && !delta
      && !artifacts.length
      && !title
      && !hasToolMetadata
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
    artifacts,
    callId: cleanText(event.callId || event.call_id),
    createdAt: cleanText(event.createdAt || event.created_at, nowIso()),
    completedAt: cleanText(event.completedAt || event.completed_at),
    delta,
    id,
    kind,
    messageId,
    assistantMessageId: cleanText(event.assistantMessageId || event.assistant_message_id),
    promptEpoch: normalizeThreadPromptEpoch(event.promptEpoch || event.prompt_epoch),
    prompt_epoch: normalizeThreadPromptEpoch(event.promptEpoch || event.prompt_epoch),
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
    ...toolMetadata,
  };
}

function normalizeThreadProjectionEvents(events, options = {}) {
  const sourceEvents = Array.isArray(events) ? events : [];
  if (options.alreadyNormalized === true) {
    return sourceEvents
      .slice(-MAX_THREAD_PROJECTION_EVENTS)
      .map((event, index) => (event.sequence === index ? event : { ...event, sequence: index }));
  }

  const normalized = [];
  const seen = new Set();

  sourceEvents.forEach((event, index) => {
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

function compactPersistedThreadProjectionEvent(event) {
  const normalizedEvent = normalizeThreadProjectionEvent(event);
  if (!normalizedEvent) {
    return null;
  }

  return {
    ...normalizedEvent,
    delta: compactPersistedThreadText(normalizedEvent.delta),
    text: compactPersistedThreadText(normalizedEvent.text),
    ...compactPersistedThreadToolMetadata(normalizedEvent),
  };
}

function compactPersistedThreadProjectionEvents(events) {
  return (Array.isArray(events) ? events : [])
    .map(compactPersistedThreadProjectionEvent)
    .filter(Boolean)
    .slice(-MAX_PERSISTED_THREAD_PROJECTION_EVENTS)
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
    artifacts: mergeThreadArtifacts(existingMessage?.artifacts, normalizedMessage.artifacts),
    id: matchingMessageId,
    text: chooseProjectedMessageText(existingMessage?.text, normalizedMessage.text),
  });
}

function projectThreadProjectionMessagesFromNormalizedEvents(projectionEvents, fallbackMessages = []) {
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
      && !isLiveHookProjectionEvent(event)
    ) {
      return;
    }

    if (event.type === "thread.message.user" || event.type === "thread.message.system") {
      upsertProjectedMessage(messagesById, messageOrder, {
        agentId: event.agentId,
        artifacts: event.artifacts,
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
        artifacts: event.artifacts,
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
      if (!existing && !(event.text || event.delta || event.artifacts?.length)) {
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
        artifacts: mergeThreadArtifacts(existing?.artifacts, event.artifacts),
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
        artifacts: event.artifacts,
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
        ...normalizeThreadToolMetadata(event),
      });
    }
  });

  return messageOrder
    .map((messageId) => messagesById.get(messageId))
    .filter(Boolean)
    .slice(-MAX_THREAD_MESSAGES);
}

function projectThreadProjectionMessages(events, fallbackMessages = []) {
  return projectThreadProjectionMessagesFromNormalizedEvents(
    normalizeThreadProjectionEvents(events),
    fallbackMessages,
  );
}

function threadMessageProjectionEventId(prefix, message, suffix = "") {
  const id = cleanText(message?.id, createRandomId("message"));
  const text = cleanMessageText(message?.text);
  const artifacts = threadArtifactsSignature(message?.artifacts);
  const toolMetadata = JSON.stringify(normalizeThreadToolMetadata(message));
  const hash = stableProjectionHash(`${id}:${message?.role || ""}:${message?.kind || ""}:${text}:${artifacts}:${toolMetadata}`);
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
      artifacts: message.artifacts,
      callId: message.callId,
      createdAt: message.createdAt,
      kind: message.kind,
      messageId,
      source: message.source || source,
      text: message.text,
      title: message.title,
      turnId: message.turnId,
      ...normalizeThreadToolMetadata(message),
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

  return events.filter((eventToAdd) => !isThreadTurnLifecycleProjectionEvent(eventToAdd));
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

  return normalizeThreadProjectionEvents(events, { alreadyNormalized: true });
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
  const submittedAtMs = threadMessageTimestampMs({
    createdAt: event.expectedMessageCreatedAt
      || event.promptEventSubmittedAt
      || event.submittedAt
      || event.createdAt,
  });
  if (expectedText) {
    return cleanText([...normalizedIncomingMessages].reverse().find((message) => (
      message?.role === "user"
        && !isSlashCommandPrompt(message.text)
        && cleanSubmittedUserMessage(message.text) === expectedText
        && (
          !submittedAtMs
          || !threadMessageTimestampMs(message)
          || threadMessageTimestampMs(message) >= submittedAtMs - 30000
        )
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

function projectLatestTurnFromNormalizedEvents(projectionEvents, fallbackLatestTurn = null) {
  const fallbackTurn = normalizeThreadLatestTurn(fallbackLatestTurn);
  const fallbackTurnUpdatedAtMs = threadMessageTimestampMs({
    createdAt: fallbackTurn?.updatedAt || fallbackTurn?.completedAt || fallbackTurn?.startedAt || fallbackTurn?.requestedAt,
  });
  let latestTurn = fallbackTurn;
  const closedTurnIds = new Set();

  projectionEvents.forEach((event) => {
    const turnId = cleanText(event.turnId);
    if (!turnId) {
      return;
    }
    const eventTimestampMs = threadMessageTimestampMs({
      createdAt: event.completedAt || event.createdAt,
    });
    const isOlderDifferentTurnThanFallback = Boolean(
      fallbackTurn
        && fallbackTurnUpdatedAtMs
        && eventTimestampMs
        && eventTimestampMs < fallbackTurnUpdatedAtMs
        && cleanText(fallbackTurn.turnId) !== turnId
    );

    if (
      event.type === "thread.turn.started"
      && (
        isOlderDifferentTurnThanFallback
        || (
        closedTurnIds.has(turnId)
        || (
          latestTurn?.turnId === turnId
          && CLOSED_THREAD_TURN_STATES.has(latestTurn?.state)
        )
        )
      )
    ) {
      return;
    }

    if (event.type === "thread.turn.started") {
      latestTurn = normalizeThreadLatestTurn({
        agentId: event.agentId,
        messageId: event.messageId,
        promptEpoch: event.promptEpoch || event.prompt_epoch,
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

function projectLatestTurnFromEvents(events, fallbackLatestTurn = null) {
  return projectLatestTurnFromNormalizedEvents(
    normalizeThreadProjectionEvents(events),
    fallbackLatestTurn,
  );
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
  const promptEpoch = normalizeThreadPromptEpoch(event.promptEpoch || event.prompt_epoch);
  return [{
    agentId,
    createdAt,
    id: `projection-turn-started-${stableProjectionKey(turnId, "turn")}`,
    messageId,
    promptEpoch,
    prompt_epoch: promptEpoch,
    source,
    status: "running",
    turnId,
    type: "thread.turn.started",
  }, {
    agentId,
    createdAt,
    id: `projection-user-submitted-${stableProjectionKey(messageId, "message")}`,
    messageId,
    promptEpoch,
    prompt_epoch: promptEpoch,
    role: "user",
    source,
    status: "submitted",
    text,
    turnId,
    type: "thread.message.user",
  }];
}

function liveTextFinalTurnType(eventType) {
  const type = cleanText(eventType).toLowerCase();
  if (type === "provider-turn-completed") {
    return "thread.turn.completed";
  }
  if (type === "provider-turn-error") {
    return "thread.turn.error";
  }
  if (type === "provider-turn-interrupted") {
    return "thread.turn.interrupted";
  }
  return "";
}

export function createWorkspaceThreadLiveTextProjectionEvents(thread, event = {}) {
  const liveTextKind = cleanText(event.liveTextKind || event.live_text_kind, "assistant")
    .toLowerCase();
  if (liveTextKind !== "assistant") {
    return [];
  }

  const delta = cleanMessageText(
    event.liveTextDelta
      || event.live_text_delta
      || event.assistantDelta
      || event.assistant_delta,
  );
  const snapshot = cleanMessageText(
    event.liveTextSnapshot
      || event.live_text_snapshot
      || event.assistantMessageSnapshot
      || event.assistant_message_snapshot
      || event.assistantMessage
      || event.assistant_message,
  );
  if (!delta && !snapshot) {
    return [];
  }

  const latestTurn = normalizeThreadLatestTurn(thread?.latestTurn);
  const promptMessageId = cleanText(
    event.promptEventId
      || event.pendingPromptId
      || event.promptId
      || event.messageId
      || event.message_id
      || latestTurn?.messageId,
  );
  const turnId = cleanText(
    event.turnId
      || event.turn_id
      || event.providerTurnId
      || event.provider_turn_id
      || latestTurn?.turnId
      || (promptMessageId ? createTurnIdForMessage(thread, promptMessageId) : ""),
  );
  const messageId = cleanText(
    event.assistantMessageId
      || event.assistant_message_id
      || latestTurn?.assistantMessageId,
    turnId
      ? `assistant-${stableProjectionKey(turnId, "turn")}`
      : createRandomId("assistant-live"),
  );
  const createdAt = cleanText(
    event.completedAt
      || event.inputReadyAt
      || event.hookObservedAt
      || event.createdAt
      || event.startedAt,
    nowIso(),
  );
  const agentId = cleanAgentId(event.agentId || event.currentAgent || thread?.currentAgent, "");
  const source = cleanText(event.source || event.type, "cli-hook:assistant-message");
  const promptEpoch = normalizeThreadPromptEpoch(
    event.promptEpoch
      || event.prompt_epoch
      || latestTurn?.promptEpoch
      || latestTurn?.prompt_epoch,
  );
  const finalTurnType = liveTextFinalTurnType(event.type || event.eventType);
  const finalText = snapshot || delta;
  const events = [];

  if (delta) {
    events.push({
      agentId,
      createdAt,
      delta,
      id: [
        "projection-live-assistant-delta",
        safeKey(messageId, "message"),
        delta.length,
        stableProjectionHash(`${turnId}:${delta}`),
      ].join("-"),
      messageId,
      promptEpoch,
      prompt_epoch: promptEpoch,
      source,
      status: "streaming",
      turnId,
      type: "thread.message.assistant.delta",
    });
  }

  if (snapshot) {
    events.push({
      agentId,
      createdAt,
      id: [
        "projection-live-assistant-snapshot",
        safeKey(messageId, "message"),
        snapshot.length,
        stableProjectionHash(`${turnId}:${snapshot}`),
      ].join("-"),
      messageId,
      promptEpoch,
      prompt_epoch: promptEpoch,
      replaceText: true,
      source,
      status: "streaming",
      text: snapshot,
      turnId,
      type: "thread.message.assistant.delta",
    });
  }

  if (finalTurnType && finalText) {
    events.push({
      agentId,
      createdAt,
      id: [
        "projection-live-assistant-complete",
        safeKey(messageId, "message"),
        finalText.length,
        stableProjectionHash(`${turnId}:${finalText}`),
      ].join("-"),
      messageId,
      promptEpoch,
      prompt_epoch: promptEpoch,
      replaceText: true,
      source,
      status: "complete",
      text: finalText,
      turnId,
      type: "thread.message.assistant.complete",
    });
  }

  if (finalTurnType && turnId) {
    events.push({
      agentId,
      assistantMessageId: messageId,
      completedAt: createdAt,
      createdAt,
      id: [
        "projection-live-turn-finished",
        stableProjectionKey(turnId, "turn"),
        finalTurnType.replace(/^thread\.turn\./, ""),
      ].join("-"),
      messageId,
      promptEpoch,
      prompt_epoch: promptEpoch,
      source,
      status: finalTurnType.replace(/^thread\.turn\./, ""),
      text: finalTurnType === "thread.turn.error"
        ? cleanMessageText(event.error || event.message || finalText)
        : "",
      turnId,
      type: finalTurnType,
    });
  }

  return events;
}

function normalizeProviderToolEventType(value) {
  return cleanText(value).toLowerCase();
}

function providerToolEventKind(eventType) {
  if (eventType === "provider-tool-started") {
    return "tool_call";
  }
  return "tool_output";
}

function providerToolProjectionType(eventType) {
  return providerToolEventKind(eventType) === "tool_call"
    ? "thread.tool_call"
    : "thread.tool_output";
}

function providerToolProjectionStatus(eventType, fallback = "") {
  if (eventType === "provider-tool-started") {
    return "running";
  }
  if (eventType === "provider-tool-failed") {
    return "error";
  }
  return cleanText(fallback, "complete");
}

function displayNameFromToolMetadata(metadata = {}) {
  const explicit = cleanText(metadata.toolDisplayName);
  if (explicit) {
    return explicit;
  }
  const rawName = cleanText(metadata.toolName);
  const server = cleanText(metadata.toolServer);
  const mcpMatch = /^mcp_{2,}(.+?)_{2,}(.+)$/.exec(rawName);
  if (mcpMatch) {
    return `${mcpMatch[1].replace(/_/g, "-")} / ${mcpMatch[2]}`;
  }
  if (server && rawName && !rawName.toLowerCase().startsWith(`${server.toLowerCase()}.`)) {
    return `${server} / ${rawName}`;
  }
  return rawName || cleanText(metadata.command) || cleanText(metadata.filePath);
}

function providerToolProjectionTitle(eventType, metadata = {}, event = {}) {
  const title = cleanText(event.title);
  const genericTitles = new Set(["activity", "bash", "tool call", "tool output", "tool"]);
  if (title && !genericTitles.has(title.toLowerCase())) {
    return title;
  }
  const displayName = displayNameFromToolMetadata(metadata);
  if (eventType === "provider-tool-started") {
    return displayName ? `Called ${displayName}` : "Called tool";
  }
  if (eventType === "provider-tool-failed") {
    return displayName ? `${displayName} failed` : "Tool failed";
  }
  return displayName ? `${displayName} finished` : "Tool output";
}

function providerToolProjectionText(eventType, metadata = {}, event = {}) {
  const directText = cleanMessageText(event.text || event.message);
  if (directText) {
    return directText;
  }
  if (eventType === "provider-tool-started") {
    if (metadata.command) {
      return `$ ${metadata.command}`;
    }
    return "";
  }
  if (threadToolValueHasContent(metadata.toolError)) {
    return typeof metadata.toolError === "string" ? metadata.toolError : JSON.stringify(metadata.toolError, null, 2);
  }
  if (threadToolValueHasContent(metadata.toolOutput)) {
    return typeof metadata.toolOutput === "string" ? metadata.toolOutput : JSON.stringify(metadata.toolOutput, null, 2);
  }
  return "";
}

export function createWorkspaceThreadToolProjectionEvents(thread, event = {}) {
  const eventType = normalizeProviderToolEventType(event.type || event.eventType || event.event_type);
  if (![
    "provider-tool-started",
    "provider-tool-completed",
    "provider-tool-failed",
    "provider-tool-batch-completed",
  ].includes(eventType)) {
    return [];
  }

  const latestTurn = normalizeThreadLatestTurn(thread?.latestTurn);
  const promptMessageId = cleanText(
    event.promptEventId
      || event.pendingPromptId
      || event.promptId
      || event.messageId
      || event.message_id
      || latestTurn?.messageId,
  );
  const turnId = cleanText(
    event.turnId
      || event.turn_id
      || event.providerTurnId
      || event.provider_turn_id
      || latestTurn?.turnId
      || (promptMessageId ? createTurnIdForMessage(thread, promptMessageId) : ""),
  );
  const agentId = cleanAgentId(event.agentId || event.currentAgent || thread?.currentAgent, "");
  const createdAt = cleanText(
    event.completedAt
      || event.inputReadyAt
      || event.hookObservedAt
      || event.createdAt
      || event.startedAt,
    nowIso(),
  );
  const metadata = normalizeThreadToolMetadata(event);
  const callId = cleanText(
    event.callId
      || event.call_id
      || event.toolUseId
      || event.tool_use_id,
  );
  const messagePhase = providerToolEventKind(eventType) === "tool_call" ? "call" : "output";
  const explicitMessageId = cleanText(event.messageId || event.message_id);
  const fallbackMessageId = [
    "tool",
    safeKey(turnId || thread?.id || "turn", "turn"),
    safeKey(callId || displayNameFromToolMetadata(metadata) || eventType, "call"),
  ].join("-");
  const messageId = [
    explicitMessageId || fallbackMessageId,
    messagePhase,
  ].join("-");
  const promptEpoch = normalizeThreadPromptEpoch(
    event.promptEpoch
      || event.prompt_epoch
      || latestTurn?.promptEpoch
      || latestTurn?.prompt_epoch,
  );
  const title = providerToolProjectionTitle(eventType, metadata, event);
  const text = providerToolProjectionText(eventType, metadata, event);
  const status = providerToolProjectionStatus(eventType, event.status);

  if (!turnId && !callId && !threadToolMetadataHasContent(metadata) && !title && !text) {
    return [];
  }

  return [{
    agentId,
    callId,
    createdAt,
    id: [
      "projection-live-tool",
      safeKey(messageId, "message"),
      stableProjectionHash(`${eventType}:${turnId}:${callId}:${title}:${text}:${JSON.stringify(metadata)}:${status}`),
    ].join("-"),
    kind: providerToolEventKind(eventType),
    messageId,
    promptEpoch,
    prompt_epoch: promptEpoch,
    source: cleanText(event.source || eventType, `cli-hook:${eventType}`),
    status,
    text,
    title,
    turnId,
    type: providerToolProjectionType(eventType),
    ...metadata,
  }];
}

function createProjectionEventsFromTranscript(thread, incomingMessages, event = {}) {
  const agentId = cleanAgentId(event.agentId || event.currentAgent || thread?.currentAgent, "");
  const source = transcriptHistoryProjectionSource(agentId, event.source);
  const preferLiveHookAssistantMessages = event.preferLiveHookAssistantMessages === true
    || event.prefer_live_hook_assistant_messages === true;
  const promptEventId = cleanText(event.promptEventId || event.pendingPromptId || event.promptId);
  const promptEpoch = normalizeThreadPromptEpoch(event.promptEpoch || event.prompt_epoch);
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
  let projectedMessages = projectThreadProjectionMessagesFromNormalizedEvents(
    projectionEvents.filter((projectionEvent) => (
      isTranscriptHistoryProjectionEvent(projectionEvent)
        || (preferLiveHookAssistantMessages && isLiveHookProjectionEvent(projectionEvent))
    )),
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
  const allowTranscriptTurnCompletion = event.allowTranscriptTurnCompletion === true
    || event.transcriptCompletionCanSettleTurn === true;
  const assistantResponseCompletesTurn = event.assistantResponseCompletesTurn === true;
  const transcriptTurnCompleteSeen = Boolean(
    event.turnCompleteSeen === true
      || (
        event.transcriptExplicitCompletionCanSettleTurn === true
        && transcriptHasTurnCompleteForExpectedPrompt(
          normalizedIncomingMessages,
          expectedPromptTranscriptMessageId,
        )
      ),
  );
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
    const messageArtifacts = normalizeThreadArtifacts(message.artifacts);
    const messageArtifactsSignature = threadArtifactsSignature(messageArtifacts);
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
      artifacts: messageArtifacts,
      callId: message.callId,
      createdAt,
      kind: message.kind,
      messageId,
      promptEpoch,
      prompt_epoch: promptEpoch,
      source,
      title: message.title,
      turnId: messageTurnId,
      ...normalizeThreadToolMetadata(message),
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
      const liveHookAssistantMessage = preferLiveHookAssistantMessages
        ? projectedMessages.find((candidate) => (
          candidate?.role === "assistant"
          && candidate.status === "complete"
          && isLiveHookProjectionSource(candidate.source)
          && cleanMessageText(candidate.text)
          && projectionTurnIdsMatchPrompt(
            candidate.turnId,
            messageTurnId,
            promptEventId || expectedPromptTranscriptMessageId,
          )
        ))
        : null;
      if (!nextText && !messageArtifacts.length) {
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

      if (liveHookAssistantMessage && !messageArtifacts.length) {
        if (
          allowTranscriptTurnCompletion
          && turnComplete
          && messageTurnId
          && !projectionHasTurnEvent(projectionEvents, "thread.turn.completed", messageTurnId)
        ) {
          events.push({
            ...eventBase,
            assistantMessageId: liveHookAssistantMessage.id,
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
      const projectionArtifactsChanged = messageArtifactsSignature
        && threadArtifactsSignature(messageProjectionTarget?.artifacts) !== messageArtifactsSignature;
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
            stableProjectionHash(`${nextText}:${messageArtifactsSignature}`),
          ].join("-"),
          replaceText,
          text: replaceText ? nextText : "",
          type: "thread.message.assistant.delta",
        });
      }
      if (
        shouldProjectAssistant
        && (
          !messageProjectionTarget
          || messageProjectionTarget.status !== "complete"
          || messageProjectionTarget.text !== nextText
          || projectionArtifactsChanged
        )
      ) {
        events.push({
          ...eventBase,
          id: [
            "projection-assistant-complete",
            safeKey(messageId, "message"),
            nextText.length,
            stableProjectionHash(`${nextText}:${messageArtifactsSignature}`),
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
      if (
        projectedMessage
        && projectedMessage.text === message.text
        && projectedMessage.title === message.title
        && threadArtifactsSignature(projectedMessage.artifacts) === messageArtifactsSignature
        && JSON.stringify(normalizeThreadToolMetadata(projectedMessage)) === JSON.stringify(normalizeThreadToolMetadata(message))
      ) {
        return;
      }
      events.push({
        ...eventBase,
        id: [
          "projection-activity",
          safeKey(messageId, "message"),
          stableProjectionHash(`${message.kind}:${message.title}:${message.text}:${messageArtifactsSignature}:${JSON.stringify(normalizeThreadToolMetadata(message))}`),
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
      projectedMessages = projectThreadProjectionMessagesFromNormalizedEvents(projectionEvents, projectedMessages);
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
      promptEpoch,
      prompt_epoch: promptEpoch,
      source,
      status: "completed",
      turnId: completedTurnId,
      type: "thread.turn.completed",
    });
  }

  return events;
}

function preserveRunningLatestTurnWhenTranscriptCompletionBlocked(existingLatestTurn, projectedLatestTurn, event = {}) {
  const normalizedExistingLatestTurn = normalizeThreadLatestTurn(existingLatestTurn);
  const normalizedProjectedLatestTurn = normalizeThreadLatestTurn(projectedLatestTurn);
  const blocked = Boolean(
    event.allowTranscriptTurnCompletion !== true
      && normalizedExistingLatestTurn?.state === "running"
      && normalizedProjectedLatestTurn
      && cleanText(normalizedProjectedLatestTurn.turnId) === cleanText(normalizedExistingLatestTurn.turnId)
      && CLOSED_THREAD_TURN_STATES.has(normalizedProjectedLatestTurn.state)
  );

  return {
    blocked,
    latestTurn: blocked ? normalizedExistingLatestTurn : normalizedProjectedLatestTurn,
  };
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

  const providerSessionId = cleanText(value.providerSessionId || value.provider_session_id || value.nativeSessionId || value.native_session_id || value.sessionId);
  const nativeSessionId = cleanText(value.nativeSessionId || value.native_session_id || value.providerSessionId || value.provider_session_id || value.sessionId);
  const sessionId = cleanText(value.sessionId || value.session_id || providerSessionId || nativeSessionId);

  return {
    activityStatus: normalizeThreadActivityStatus(value.activityStatus || value.activity_status),
    agentId: cleanAgentId(value.agentId || value.currentAgent),
    agentDisplayName: cleanAgentDisplayName(value.agentDisplayName || value.agent_display_name),
    agentType: cleanAgentDisplayName(value.agentType || value.agent_type),
    commandPhase: cleanText(value.commandPhase || value.command_phase),
    executionPhase: cleanText(value.executionPhase || value.execution_phase),
    instanceId: Number.isInteger(instanceId) && instanceId > 0 ? instanceId : 0,
    inputReady: value.inputReady === true,
    inputReadyAt: cleanText(value.inputReadyAt),
    inputReadyConfidence: cleanText(value.inputReadyConfidence),
    ...hookHealthFields(value),
    lastActiveAt: cleanText(value.lastActiveAt, value.updatedAt || nowIso()),
    paneId,
    ...promptingUserFields(value),
    displayName: workspaceTerminalNicknameFromRecord(value),
    fileAuthority: cleanText(value.fileAuthority || value.coordination?.fileAuthority),
    forkFromProviderSessionId: cleanText(
      value.forkFromProviderSessionId
        || value.fork_from_provider_session_id
        || value.forkedFromProviderSessionId
        || value.forked_from_provider_session_id
        || value.parentProviderSessionId
        || value.parent_provider_session_id,
    ),
    nativeRailState: cleanText(value.nativeRailState || value.native_rail_state),
    provider: cleanAgentDisplayName(value.provider),
    providerSessionId,
    nativeSessionId,
    relatedProviderSessionIds: cleanTextArray(
      value.relatedProviderSessionIds,
      value.related_provider_session_ids,
      value.relatedSessionIds,
      value.related_session_ids,
    ),
    sharedHistoryId: cleanText(value.sharedHistoryId || value.shared_history_id || value.historyGroupId || value.history_group_id),
    slotKey: cleanText(value.slotKey, defaultSlotKey(terminalIndex)),
    status: safeStatus,
    turnStatus: cleanText(value.turnStatus || value.turn_status),
    sessionMode: cleanText(value.sessionMode || value.coordination?.sessionMode),
    sessionId,
    terminalName: workspaceTerminalNicknameFromRecord(value),
    terminalNickname: workspaceTerminalNicknameFromRecord(value),
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
    agentDisplayName: cleanAgentDisplayName(
      binding.agentDisplayName || binding.agent_display_name,
      fallback.agentDisplayName || fallback.agent_display_name,
    ),
    agentType: cleanAgentDisplayName(
      binding.agentType || binding.agent_type,
      fallback.agentType || fallback.agent_type,
    ),
    coordination: normalizeCoordination(binding.coordination || fallback.coordination),
    activityStatus: options.stripLiveBindings
      ? "idle"
      : normalizeThreadActivityStatus(binding.activityStatus, fallback.activityStatus),
    inputReady: options.stripLiveBindings
      ? false
      : Boolean(binding.inputReady ?? fallback.inputReady),
    inputReadyAt: options.stripLiveBindings
      ? ""
      : cleanText(binding.inputReadyAt, fallback.inputReadyAt),
    inputReadyConfidence: options.stripLiveBindings
      ? ""
      : cleanText(
        binding.inputReadyConfidence,
        fallback.inputReadyConfidence,
      ),
    ...(
      options.stripLiveBindings
        ? hookHealthFields({ hookHealthEvent: "", hookHealthObservedAtMs: 0, hookHealthStatus: "" })
        : hookHealthFields(binding, fallback)
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
    forkFromProviderSessionId: cleanText(
      binding.forkFromProviderSessionId
        || binding.fork_from_provider_session_id
        || binding.forkedFromProviderSessionId
        || binding.forked_from_provider_session_id
        || binding.parentProviderSessionId
        || binding.parent_provider_session_id,
      fallback.forkFromProviderSessionId || fallback.fork_from_provider_session_id,
    ),
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
    provider: cleanAgentDisplayName(binding.provider, fallback.provider),
    relatedProviderSessionIds: cleanTextArray(
      binding.relatedProviderSessionIds,
      binding.related_provider_session_ids,
      fallback.relatedProviderSessionIds,
      fallback.related_provider_session_ids,
    ),
    sharedHistoryId: cleanText(
      binding.sharedHistoryId
        || binding.shared_history_id
        || binding.historyGroupId
        || binding.history_group_id,
      fallback.sharedHistoryId || fallback.shared_history_id || fallback.historyGroupId || fallback.history_group_id,
    ),
    status: options.stripLiveBindings && ["active", "starting"].includes(safeStatus) ? "idle" : safeStatus,
    displayName: terminalNicknameFromSources(
      binding.displayName,
      binding.display_name,
      binding.terminalNickname,
      binding.terminal_nickname,
      binding.terminalName,
      binding.terminal_name,
      fallback.displayName,
      fallback.display_name,
      fallback.terminalNickname,
      fallback.terminal_nickname,
      fallback.terminalName,
      fallback.terminal_name,
    ),
    terminalName: terminalNicknameFromSources(
      binding.terminalName,
      binding.terminal_name,
      binding.terminalNickname,
      binding.terminal_nickname,
      binding.displayName,
      binding.display_name,
      fallback.terminalName,
      fallback.terminal_name,
      fallback.terminalNickname,
      fallback.terminal_nickname,
      fallback.displayName,
      fallback.display_name,
    ),
    terminalNickname: terminalNicknameFromSources(
      binding.terminalNickname,
      binding.terminal_nickname,
      binding.terminalName,
      binding.terminal_name,
      binding.displayName,
      binding.display_name,
      fallback.terminalNickname,
      fallback.terminal_nickname,
      fallback.terminalName,
      fallback.terminal_name,
      fallback.displayName,
      fallback.display_name,
    ),
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
    : options.compactPersistence
      ? compactPersistedThreadProjectionEvents(thread.projectionEvents || thread.threadProjectionEvents)
      : normalizeThreadProjectionEvents(thread.projectionEvents || thread.threadProjectionEvents);
  const messages = options.stripMessages
    ? []
    : options.compactPersistence
      ? compactPersistedThreadMessages(thread.messages)
      : (
        projectionEvents.length
          ? projectThreadProjectionMessagesFromNormalizedEvents(projectionEvents, thread.messages)
          : normalizeThreadMessages(thread.messages)
      );
  const projectedLatestTurn = options.stripMessages
    ? normalizeThreadLatestTurn(thread.latestTurn)
    : options.compactPersistence
      ? normalizeThreadLatestTurn(thread.latestTurn)
      : projectLatestTurnFromNormalizedEvents(projectionEvents, thread.latestTurn);
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
  const storedActivityStatus = normalizeThreadActivityStatus("", "idle");
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
  const terminalNickname = terminalNicknameFromSources(
    thread.terminalNickname,
    thread.terminal_nickname,
    thread.terminalName,
    thread.terminal_name,
    thread.displayName,
    thread.display_name,
    normalizedProviderBindings[currentAgent]?.terminalNickname,
    normalizedProviderBindings[currentAgent]?.terminal_nickname,
    normalizedProviderBindings[currentAgent]?.terminalName,
    normalizedProviderBindings[currentAgent]?.terminal_name,
    normalizedProviderBindings[currentAgent]?.displayName,
    normalizedProviderBindings[currentAgent]?.display_name,
  );

  return {
    coordination,
    activityStatus,
    archivedAt: cleanText(thread.archivedAt),
    createdAt,
    currentAgent,
    forkFromProviderSessionId: cleanText(
      thread.forkFromProviderSessionId
        || thread.fork_from_provider_session_id
        || thread.forkedFromProviderSessionId
        || thread.forked_from_provider_session_id
        || thread.parentProviderSessionId
        || thread.parent_provider_session_id,
      normalizedProviderBindings[currentAgent]?.forkFromProviderSessionId
        || normalizedProviderBindings[currentAgent]?.fork_from_provider_session_id,
    ),
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
    relatedProviderSessionIds: cleanTextArray(
      thread.relatedProviderSessionIds,
      thread.related_provider_session_ids,
      normalizedProviderBindings[currentAgent]?.relatedProviderSessionIds,
      normalizedProviderBindings[currentAgent]?.related_provider_session_ids,
    ),
    freshSessionStartedAt: options.stripLiveBindings ? "" : cleanText(thread.freshSessionStartedAt),
    sessionName: storedSessionName || storedTitle || fallbackTitle,
    sharedHistoryId: cleanText(
      thread.sharedHistoryId
        || thread.shared_history_id
        || thread.historyGroupId
        || thread.history_group_id,
      normalizedProviderBindings[currentAgent]?.sharedHistoryId
        || normalizedProviderBindings[currentAgent]?.shared_history_id,
    ),
    slotKey: cleanText(
      thread.slotKey,
      terminalIndex == null ? `thread-${safeKey(id, "detached")}` : defaultSlotKey(terminalIndex),
    ),
    status: options.stripLiveBindings && ["active", "starting"].includes(safeStatus) ? "idle" : safeStatus,
    providerBindings: normalizedProviderBindings,
    terminalBinding,
    displayName: terminalNickname,
    terminalName: terminalNickname,
    terminalNickname,
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

function setProviderBindingTerminalNickname(providerBinding, nickname) {
  if (!providerBinding || !nickname) {
    return providerBinding;
  }

  return {
    ...providerBinding,
    displayName: nickname,
    terminalName: nickname,
    terminalNickname: nickname,
  };
}

function applyWorkspaceTerminalNickname(entry, terminalKey, threadId, nickname) {
  const safeNickname = normalizeWorkspaceTerminalNickname(nickname);
  if (!safeNickname) {
    return false;
  }

  let changed = false;
  if (terminalKey && entry.terminals[terminalKey]) {
    const terminal = entry.terminals[terminalKey];
    if (workspaceTerminalNicknameFromRecord(terminal) !== safeNickname) {
      entry.terminals[terminalKey] = {
        ...terminal,
        displayName: safeNickname,
        terminalName: safeNickname,
        terminalNickname: safeNickname,
      };
      changed = true;
    }
  }

  const thread = threadId ? entry.threads?.[threadId] : null;
  if (thread && workspaceTerminalNicknameFromRecord(thread) !== safeNickname) {
    const agentId = cleanAgentId(thread.currentAgent, "");
    const providerBindings = { ...(thread.providerBindings || {}) };
    if (isThreadAgentId(agentId) && providerBindings[agentId]) {
      providerBindings[agentId] = setProviderBindingTerminalNickname(providerBindings[agentId], safeNickname);
    }
    entry.threads[threadId] = {
      ...thread,
      displayName: safeNickname,
      providerBindings,
      terminalName: safeNickname,
      terminalNickname: safeNickname,
    };
    changed = true;
  }

  return changed;
}

function reconcileWorkspaceTerminalNicknames(entry) {
  const orderedKeys = [
    ...entry.terminalOrder,
    ...Object.keys(entry.terminalThreadIds || {}).sort((left, right) => Number(left) - Number(right)),
    ...Object.keys(entry.terminals || {}).sort((left, right) => Number(left) - Number(right)),
  ].filter((key, index, keys) => key && keys.indexOf(key) === index);
  const used = new Set();

  const pickUnused = () => {
    const offset = randomWorkspaceTerminalNicknameOffset();
    for (let index = 0; index < WORKSPACE_TERMINAL_NICKNAMES.length; index += 1) {
      const nickname = WORKSPACE_TERMINAL_NICKNAMES[(offset + index) % WORKSPACE_TERMINAL_NICKNAMES.length];
      if (!used.has(terminalNicknameKey(nickname))) {
        return nickname;
      }
    }
    return "";
  };

  orderedKeys.forEach((terminalKey) => {
    const terminal = entry.terminals?.[terminalKey] || null;
    const threadId = cleanText(terminal?.threadId || entry.terminalThreadIds?.[terminalKey]);
    const thread = threadId ? entry.threads?.[threadId] : null;
    let nickname = terminalNicknameFromSources(
      workspaceTerminalNicknameFromRecord(terminal),
      workspaceTerminalNicknameFromRecord(thread),
      workspaceTerminalNicknameFromRecord(getWorkspaceThreadProviderBinding(thread, thread?.currentAgent)),
    );
    if (!nickname || used.has(terminalNicknameKey(nickname))) {
      nickname = pickUnused();
    }
    if (nickname) {
      used.add(terminalNicknameKey(nickname));
    }
    applyWorkspaceTerminalNickname(entry, terminalKey, threadId, nickname);
  });

  return entry;
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

  return reconcileWorkspaceTerminalNicknames({
    activeThreadId: safeActiveThreadId,
    archivedThreadOrder: normalizedArchivedOrder,
    archivedThreads: normalizedArchivedThreads,
    terminalOrder: normalizedTerminalOrder,
    terminalThreadIds: normalizedTerminalThreadIds,
    terminals: normalizedTerminals,
    threadOrder: normalizedOrder.slice(0, MAX_THREADS_PER_WORKSPACE),
    threads: normalizedThreads,
    threadsView,
  });
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

function getWorkspaceThreadsStateObject(state) {
  return state && typeof state === "object" && !Array.isArray(state) ? state : {};
}

function getWorkspaceThreadUpdateTarget(state, workspaceId, threadId) {
  const currentState = getWorkspaceThreadsStateObject(state);
  const entry = currentState?.[workspaceId];
  const threads = entry?.threads && typeof entry.threads === "object" && !Array.isArray(entry.threads)
    ? entry.threads
    : null;
  const existing = threads?.[threadId];
  if (!entry || !threads || !existing || typeof existing !== "object" || Array.isArray(existing)) {
    return null;
  }

  return {
    currentState,
    entry,
    existing,
  };
}

function cloneRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
}

function cloneWorkspaceEntryForMutation(entry, workspaceId) {
  const source = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  const activeThreadId = cleanText(source.activeThreadId);
  return {
    activeThreadId,
    archivedThreadOrder: Array.isArray(source.archivedThreadOrder) ? source.archivedThreadOrder.slice() : [],
    archivedThreads: cloneRecord(source.archivedThreads),
    terminalOrder: Array.isArray(source.terminalOrder) ? source.terminalOrder.slice() : [],
    terminalThreadIds: cloneRecord(source.terminalThreadIds),
    terminals: cloneRecord(source.terminals),
    threadOrder: Array.isArray(source.threadOrder) ? source.threadOrder.slice() : [],
    threads: cloneRecord(source.threads),
    threadsView: {
      ...normalizeThreadsViewState(source.threadsView, {
        selectedThreadId: activeThreadId,
        selectedWorkspaceId: workspaceId,
      }),
    },
  };
}

export function readWorkspaceThreads() {
  return {};
}

export function persistWorkspaceThreads(threads) {
  return normalizeWorkspaceThreads(threads, {
    compactPersistence: true,
    stripLiveBindings: true,
  });
}

function workspaceThreadsPersistShell(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {};
  }

  const {
    archivedThreads: _archivedThreads,
    threads: _threads,
    ...shell
  } = entry;
  return shell;
}

function workspaceThreadsJsonEqual(left, right) {
  if (left === right) {
    return true;
  }
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
}

function workspaceThreadPersistRows(currentRows, previousRows) {
  const rows = [];
  Object.entries(currentRows || {}).forEach(([threadId, thread]) => {
    const safeThreadId = cleanText(threadId);
    if (!safeThreadId) {
      return;
    }
    if (workspaceThreadsJsonEqual(thread, previousRows?.[safeThreadId])) {
      return;
    }
    rows.push({
      state: thread,
      threadId: safeThreadId,
    });
  });
  return rows;
}

function workspaceThreadRemovedIds(currentRows, previousRows) {
  if (!previousRows || typeof previousRows !== "object" || Array.isArray(previousRows)) {
    return [];
  }
  const current = currentRows && typeof currentRows === "object" && !Array.isArray(currentRows)
    ? currentRows
    : {};
  return Object.keys(previousRows)
    .map(cleanText)
    .filter((threadId) => threadId && !current[threadId]);
}

export function buildWorkspaceThreadsPersistDelta(threads, previousPersistedThreads, targets = []) {
  const normalizedThreads = persistWorkspaceThreads(threads);
  const previousThreads = previousPersistedThreads && typeof previousPersistedThreads === "object"
    ? previousPersistedThreads
    : {};
  const targetEntries = Array.isArray(targets) && targets.length
    ? targets
    : Object.keys(normalizedThreads).map((workspaceId) => ({ workspaceId }));

  const workspaces = targetEntries
    .map((target) => {
      const workspaceId = cleanText(target?.workspaceId || target?.id || target);
      if (!workspaceId || !normalizedThreads[workspaceId]) {
        return null;
      }

      const currentEntry = normalizedThreads[workspaceId];
      const previousEntry = previousThreads[workspaceId] || null;
      const shell = workspaceThreadsPersistShell(currentEntry);
      const previousShell = workspaceThreadsPersistShell(previousEntry);
      const delta = {
        rootDirectory: cleanText(target?.rootDirectory),
        workspaceId,
      };
      let changed = false;

      if (!previousEntry || !workspaceThreadsJsonEqual(shell, previousShell)) {
        delta.shell = shell;
        changed = true;
      }

      const changedThreads = workspaceThreadPersistRows(currentEntry.threads, previousEntry?.threads);
      if (changedThreads.length) {
        delta.threads = changedThreads;
        changed = true;
      }

      const changedArchivedThreads = workspaceThreadPersistRows(
        currentEntry.archivedThreads,
        previousEntry?.archivedThreads,
      );
      if (changedArchivedThreads.length) {
        delta.archivedThreads = changedArchivedThreads;
        changed = true;
      }

      const removedThreadIds = workspaceThreadRemovedIds(currentEntry.threads, previousEntry?.threads);
      if (removedThreadIds.length) {
        delta.removedThreadIds = removedThreadIds;
        changed = true;
      }

      const removedArchivedThreadIds = workspaceThreadRemovedIds(
        currentEntry.archivedThreads,
        previousEntry?.archivedThreads,
      );
      if (removedArchivedThreadIds.length) {
        delta.removedArchivedThreadIds = removedArchivedThreadIds;
        changed = true;
      }

      return changed ? delta : null;
    })
    .filter(Boolean);

  return {
    normalizedThreads,
    request: { workspaces },
  };
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
  const currentState = getWorkspaceThreadsStateObject(state);
  const entry = cloneWorkspaceEntryForMutation(currentState[workspaceId], workspaceId);
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
  const currentState = getWorkspaceThreadsStateObject(state);
  const sourceEntry = currentState[safeWorkspaceId];
  const entry = sourceEntry ? cloneWorkspaceEntryForMutation(sourceEntry, safeWorkspaceId) : null;

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

  const currentState = getWorkspaceThreadsStateObject(state);
  const sourceEntry = currentState[safeWorkspaceId];
  const entry = sourceEntry ? cloneWorkspaceEntryForMutation(sourceEntry, safeWorkspaceId) : null;
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
  const terminalReadinessIgnoredEvent = eventType === "terminal-input-ready"
    || eventType === "terminal-prompt-ready";
  const marksInputReady = !terminalReadinessIgnoredEvent && (explicitInputReady === true
    || eventType === "provider-turn-completed"
    || eventType === "provider-turn-interrupted"
    || eventType === "provider-turn-error");
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
    ? cleanText(event.inputReadyAt, existing.inputReadyAt || now)
    : "";
  const inputReadyConfidence = inputReady
    ? cleanText(event.inputReadyConfidence, existing.inputReadyConfidence)
    : "";
  const terminalPromptingFields = promptingUserFieldsForTerminalEvent(event, existing, {
    clear: terminalReadinessIgnoredEvent ? false : marksInputBusy || marksInputReady,
    eventType,
  });
  const agentType = cleanAgentDisplayName(
    event.agentType || event.agent_type,
    existing.agentType || existing.agent_type,
  );
  const agentDisplayName = cleanAgentDisplayName(
    event.agentDisplayName || event.agent_display_name || agentType,
    existing.agentDisplayName || existing.agent_display_name,
  );
  const eventProviderSessionId = cleanText(
    event.providerSessionId
      || event.provider_session_id
      || event.nativeSessionId
      || event.native_session_id,
  );
  const eventSessionId = cleanText(event.sessionId || event.session_id);
  const eventForkFromProviderSessionId = cleanText(
    event.forkFromProviderSessionId
      || event.fork_from_provider_session_id
      || event.forkedFromProviderSessionId
      || event.forked_from_provider_session_id
      || event.parentProviderSessionId
      || event.parent_provider_session_id,
  );
  const eventSharedHistoryId = cleanText(event.sharedHistoryId || event.shared_history_id || event.historyGroupId || event.history_group_id);
  const eventRelatedProviderSessionIds = cleanTextArray(
    event.relatedProviderSessionIds,
    event.related_provider_session_ids,
    event.relatedSessionIds,
    event.related_session_ids,
  );
  const sessionIdentityCleared = event.providerSessionIdCleared === true
    || event.provider_session_id_cleared === true
    || event.nativeSessionIdCleared === true
    || event.native_session_id_cleared === true
    || event.sessionIdCleared === true
    || event.session_id_cleared === true;
  const openedNewTerminalGeneration = eventType === "opened"
    && !openedExistingReadyInstance
    && (
      (
        Number.isInteger(eventInstanceId)
        && eventInstanceId > 0
        && Number(existing.instanceId || 0) !== eventInstanceId
      )
      || (
        nextThreadId
        && displacedThreadId
        && displacedThreadId !== nextThreadId
      )
    );
  const clearSessionIdentity = sessionIdentityCleared
    || (openedNewTerminalGeneration && !eventProviderSessionId && !eventSessionId);
  const terminalNickname = resolveWorkspaceTerminalNickname(
    entry,
    [
      event.terminalNickname,
      event.terminal_nickname,
      event.terminalName,
      event.terminal_name,
      event.displayName,
      event.display_name,
      workspaceTerminalNicknameFromRecord(entry.threads?.[nextThreadId]),
      workspaceTerminalNicknameFromRecord(getWorkspaceThreadProviderBinding(
        entry.threads?.[nextThreadId],
        entry.threads?.[nextThreadId]?.currentAgent || event.agentId || event.currentAgent,
      )),
      workspaceTerminalNicknameFromRecord(existing),
    ],
    {
      excludeTerminalIndex: terminalIndex,
      excludeThreadId: nextThreadId,
    },
  );
  const terminal = normalizeActiveTerminal({
    activityStatus: eventActivityStatus || existing.activityStatus || "",
    agentId: event.agentId || event.currentAgent || existing.agentId,
    agentDisplayName,
    agentType,
    commandPhase: event.commandPhase || event.command_phase || existing.commandPhase || existing.command_phase,
    displayName: terminalNickname,
    executionPhase: event.executionPhase || event.execution_phase || existing.executionPhase || existing.execution_phase,
    forkFromProviderSessionId: clearSessionIdentity && !eventForkFromProviderSessionId
      ? ""
      : eventForkFromProviderSessionId
        || existing.forkFromProviderSessionId
        || existing.fork_from_provider_session_id,
    inputReady,
    inputReadyAt,
    inputReadyConfidence,
    ...hookHealthFields(event, existing),
    instanceId: event.instanceId ?? existing.instanceId,
    lastActiveAt: now,
    paneId: event.paneId || existing.paneId,
    ...terminalPromptingFields,
    nativeRailState: event.nativeRailState || event.native_rail_state || existing.nativeRailState || existing.native_rail_state,
    provider: event.provider || existing.provider,
    providerSessionId: clearSessionIdentity
      ? ""
      : event.providerSessionId
        || event.provider_session_id
        || event.nativeSessionId
        || event.native_session_id
        || existing.providerSessionId
        || existing.provider_session_id,
    nativeSessionId: clearSessionIdentity
      ? ""
      : event.nativeSessionId
        || event.native_session_id
        || event.providerSessionId
        || event.provider_session_id
        || existing.nativeSessionId
        || existing.native_session_id,
    relatedProviderSessionIds: eventRelatedProviderSessionIds.length
      ? eventRelatedProviderSessionIds
      : cleanTextArray(existing.relatedProviderSessionIds, existing.related_provider_session_ids),
    sharedHistoryId: clearSessionIdentity && !eventSharedHistoryId
      ? ""
      : eventSharedHistoryId
        || existing.sharedHistoryId
        || existing.shared_history_id,
    slotKey: event.slotKey || existing.slotKey || defaultSlotKey(terminalIndex),
    status: options.status || event.status || existing.status || "active",
    turnStatus: event.turnStatus || event.turn_status || existing.turnStatus || existing.turn_status,
    sessionId: clearSessionIdentity
      ? ""
      : event.sessionId
        || event.session_id
        || event.providerSessionId
        || event.provider_session_id
        || event.nativeSessionId
        || event.native_session_id
        || existing.sessionId
        || existing.session_id,
    terminalName: terminalNickname,
    terminalNickname,
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
  const eventType = cleanText(event.type).toLowerCase();
  const sessionIdentityCleared = event.providerSessionIdCleared === true
    || event.provider_session_id_cleared === true
    || event.nativeSessionIdCleared === true
    || event.native_session_id_cleared === true
    || event.sessionIdCleared === true
    || event.session_id_cleared === true;
  const eventForkFromProviderSessionId = cleanText(
    event.forkFromProviderSessionId
      || event.fork_from_provider_session_id
      || event.forkedFromProviderSessionId
      || event.forked_from_provider_session_id
      || event.parentProviderSessionId
      || event.parent_provider_session_id,
  );
  const eventSharedHistoryId = cleanText(event.sharedHistoryId || event.shared_history_id || event.historyGroupId || event.history_group_id);
  const eventRelatedProviderSessionIds = cleanTextArray(
    event.relatedProviderSessionIds,
    event.related_provider_session_ids,
    event.relatedSessionIds,
    event.related_session_ids,
  );
  const terminalBinding = normalizeTerminalBinding({
    instanceId: event.instanceId ?? activeTerminal?.instanceId,
    paneId: event.paneId || activeTerminal?.paneId,
    terminalIndex,
  });
  const terminalNickname = resolveWorkspaceTerminalNickname(
    entry,
    [
      event.terminalNickname,
      event.terminal_nickname,
      event.terminalName,
      event.terminal_name,
      event.displayName,
      event.display_name,
      workspaceTerminalNicknameFromRecord(existing),
      workspaceTerminalNicknameFromRecord(getWorkspaceThreadProviderBinding(existing, agentId)),
      workspaceTerminalNicknameFromRecord(activeTerminal),
    ],
    {
      excludeTerminalIndex: terminalIndex,
      excludeThreadId: threadId,
    },
  );
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
    agentDisplayName: event.agentDisplayName
      || event.agent_display_name
      || activeTerminal?.agentDisplayName
      || activeTerminal?.agent_display_name,
    agentType: event.agentType
      || event.agent_type
      || activeTerminal?.agentType
      || activeTerminal?.agent_type,
    coordination,
    inputReady: Boolean(activeTerminal?.inputReady),
    inputReadyAt: activeTerminal?.inputReadyAt || "",
    inputReadyConfidence: activeTerminal?.inputReadyConfidence || "",
    lastActiveAt: now,
    lastMessageAt: options.incrementMessageCount ? now : existing.lastMessageAt,
    messageCount: nextMessageCount,
    forkFromProviderSessionId: sessionIdentityCleared && !eventForkFromProviderSessionId
      ? ""
      : eventForkFromProviderSessionId
        || activeTerminal?.forkFromProviderSessionId
        || activeTerminal?.fork_from_provider_session_id
        || existing.forkFromProviderSessionId
        || existing.fork_from_provider_session_id,
    provider: event.provider || activeTerminal?.provider,
    relatedProviderSessionIds: eventRelatedProviderSessionIds.length
      ? eventRelatedProviderSessionIds
      : cleanTextArray(
        activeTerminal?.relatedProviderSessionIds,
        activeTerminal?.related_provider_session_ids,
        existing.relatedProviderSessionIds,
        existing.related_provider_session_ids,
      ),
    sharedHistoryId: sessionIdentityCleared && !eventSharedHistoryId
      ? ""
      : eventSharedHistoryId
        || activeTerminal?.sharedHistoryId
        || activeTerminal?.shared_history_id
        || existing.sharedHistoryId
        || existing.shared_history_id,
    status: safeStatus,
    displayName: terminalNickname,
    terminalName: terminalNickname,
    terminalNickname,
    terminalBinding,
    updatedAt: now,
  });
  const runtimeActivityStatus = explicitRuntimeActivityStatus(event, "")
    || normalizeThreadActivityStatus(
      activeTerminal?.activityStatus || activeTerminal?.activity_status,
      "",
    );
  const activityStatus = eventType === "opened" || shouldClearOrphanRunning
    ? "idle"
    : runtimeActivityStatus || "idle";
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
      agentDisplayName: cleanAgentDisplayName(
        event.agentDisplayName
          || event.agent_display_name
          || activeTerminal?.agentDisplayName
          || activeTerminal?.agent_display_name,
        providerBinding?.agentDisplayName,
      ),
      agentType: cleanAgentDisplayName(
        event.agentType
          || event.agent_type
          || activeTerminal?.agentType
          || activeTerminal?.agent_type,
        providerBinding?.agentType,
      ),
      coordination,
      inputReady: Boolean(activeTerminal?.inputReady),
      provider: cleanAgentDisplayName(event.provider || activeTerminal?.provider, providerBinding?.provider),
      inputReadyAt: activeTerminal?.inputReadyAt || "",
      inputReadyConfidence: activeTerminal?.inputReadyConfidence || "",
      lastActiveAt: now,
      lastMessageAt: options.incrementMessageCount ? now : providerBinding?.lastMessageAt || existing.lastMessageAt,
      messageCount: nextMessageCount,
      forkFromProviderSessionId: sessionIdentityCleared && !eventForkFromProviderSessionId
        ? ""
        : eventForkFromProviderSessionId
          || providerBinding?.forkFromProviderSessionId
          || providerBinding?.fork_from_provider_session_id,
      ...hookHealthFields(activeTerminal, providerBinding),
      modelId: cleanModelId(event.modelId || event.model, providerBinding?.modelId),
      modelSource: cleanModelId(event.modelId || event.model) ? cleanText(event.modelSource, "user") : providerBinding?.modelSource,
      modelUpdatedAt: cleanModelId(event.modelId || event.model) ? now : providerBinding?.modelUpdatedAt || "",
      nativeSessionId: sessionIdentityCleared
        ? ""
        : cleanText(event.nativeSessionId, providerBinding?.nativeSessionId),
      nativeSessionKind: sessionIdentityCleared
        ? ""
        : cleanText(event.nativeSessionKind, providerBinding?.nativeSessionKind || "session"),
      nativeSessionSource: sessionIdentityCleared
        ? ""
        : cleanText(event.nativeSessionSource, providerBinding?.nativeSessionSource),
      nativeSessionUpdatedAt: sessionIdentityCleared
        ? ""
        : event.nativeSessionId ? now : providerBinding?.nativeSessionUpdatedAt || "",
      relatedProviderSessionIds: eventRelatedProviderSessionIds.length
        ? eventRelatedProviderSessionIds
        : cleanTextArray(providerBinding?.relatedProviderSessionIds, providerBinding?.related_provider_session_ids),
      sharedHistoryId: sessionIdentityCleared && !eventSharedHistoryId
        ? ""
        : eventSharedHistoryId
          || providerBinding?.sharedHistoryId
          || providerBinding?.shared_history_id,
      displayName: terminalNickname,
      status: safeStatus,
      terminalName: terminalNickname,
      terminalNickname,
      terminalBinding,
      updatedAt: now,
    },
  };

  entry.threads[threadId] = {
    ...existing,
    activityStatus,
    coordination,
    currentAgent: agentId,
    forkFromProviderSessionId: sessionIdentityCleared && !eventForkFromProviderSessionId
      ? ""
      : eventForkFromProviderSessionId
        || existing.forkFromProviderSessionId
        || existing.fork_from_provider_session_id,
    lastActiveAt: now,
    lastMessageAt: options.incrementMessageCount ? now : existing.lastMessageAt,
    materialized: true,
    messageCount: nextMessageCount,
    messages: existing.messages,
    latestTurn,
    preferredAgent: cleanAgentId(event.preferredAgent || existing.preferredAgent || agentId),
    providerBindings,
    relatedProviderSessionIds: eventRelatedProviderSessionIds.length
      ? eventRelatedProviderSessionIds
      : cleanTextArray(existing.relatedProviderSessionIds, existing.related_provider_session_ids),
    displayName: terminalNickname,
    sessionName: eventSessionName || existingSessionName || eventTitle || existingTitle,
    sharedHistoryId: sessionIdentityCleared && !eventSharedHistoryId
      ? ""
      : eventSharedHistoryId
        || existing.sharedHistoryId
        || existing.shared_history_id,
    slotKey: cleanText(event.slotKey || activeTerminal?.slotKey, existing.slotKey),
    status: safeStatus,
    terminalBinding,
    terminalName: terminalNickname,
    terminalNickname,
    terminalIndex,
    title: eventTitle || existingTitle || existingSessionName || defaultThreadTitle(terminalIndex, agentId),
    transcriptSessionId: sessionIdentityCleared ? "" : existing.transcriptSessionId,
    updatedAt: now,
  };

  if (terminalKey && entry.terminals[terminalKey]) {
    entry.terminals[terminalKey] = {
      ...entry.terminals[terminalKey],
      agentId,
      displayName: terminalNickname,
      forkFromProviderSessionId: sessionIdentityCleared && !eventForkFromProviderSessionId
        ? ""
        : eventForkFromProviderSessionId
          || entry.terminals[terminalKey].forkFromProviderSessionId
          || entry.terminals[terminalKey].fork_from_provider_session_id,
      lastActiveAt: now,
      relatedProviderSessionIds: eventRelatedProviderSessionIds.length
        ? eventRelatedProviderSessionIds
        : cleanTextArray(entry.terminals[terminalKey].relatedProviderSessionIds, entry.terminals[terminalKey].related_provider_session_ids),
      sharedHistoryId: sessionIdentityCleared && !eventSharedHistoryId
        ? ""
        : eventSharedHistoryId
          || entry.terminals[terminalKey].sharedHistoryId
          || entry.terminals[terminalKey].shared_history_id,
      status: safeStatus,
      terminalName: terminalNickname,
      terminalNickname,
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

  const currentState = getWorkspaceThreadsStateObject(state);
  const entry = cloneWorkspaceEntryForMutation(currentState[workspaceId], workspaceId);
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
          displayName: terminal.terminalNickname,
          terminalName: terminal.terminalNickname,
          terminalNickname: terminal.terminalNickname,
          terminalBinding: normalizeTerminalBinding({
            instanceId: terminal.instanceId,
            paneId: terminal.paneId,
            terminalIndex: terminal.terminalIndex,
          }),
          updatedAt: now,
        }),
      },
      displayName: terminal.terminalNickname,
      sessionName: defaultThreadTitle(terminal.terminalIndex, terminal.agentId),
      slotKey: terminal.slotKey || defaultSlotKey(terminal.terminalIndex),
      status: terminal.status || event.status || "active",
      terminalBinding: normalizeTerminalBinding({
        instanceId: terminal.instanceId,
        paneId: terminal.paneId,
        terminalIndex: terminal.terminalIndex,
      }),
      terminalName: terminal.terminalNickname,
      terminalNickname: terminal.terminalNickname,
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

  const currentState = getWorkspaceThreadsStateObject(state);
  const entry = cloneWorkspaceEntryForMutation(currentState[workspaceId], workspaceId);
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
  const boundTerminal = terminalKey ? entry.terminals[terminalKey] || existingTerminal : existingTerminal;
  const terminalNickname = resolveWorkspaceTerminalNickname(
    entry,
    [
      event.terminalNickname,
      event.terminal_nickname,
      event.terminalName,
      event.terminal_name,
      event.displayName,
      event.display_name,
      workspaceTerminalNicknameFromRecord(boundTerminal),
      workspaceTerminalNicknameFromRecord(previousThread),
    ],
    {
      excludeTerminalIndex: terminalIndex,
      excludeThreadId: threadId,
    },
  );

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
            displayName: terminalNickname,
            lastActiveAt: now,
            lastMessageAt: now,
            messageCount: 0,
            status: "active",
            terminalName: terminalNickname,
            terminalNickname,
            updatedAt: now,
          }),
        }
        : {},
      displayName: terminalNickname,
      sessionName: promptLabel,
      slotKey: cleanText(event.slotKey || existingTerminal?.slotKey, defaultSlotKey(terminalIndex)),
      status: "active",
      terminalBinding: null,
      terminalName: terminalNickname,
      terminalNickname,
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
    const messages = projectThreadProjectionMessagesFromNormalizedEvents(projectionEvents, entry.threads[threadId].messages);
    const messageAdded = submittedEvents.length > 0 && messages.length > previousMessages.length;
    const projectedLatestTurn = projectLatestTurnFromNormalizedEvents(
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

  const currentState = getWorkspaceThreadsStateObject(state);
  const entry = cloneWorkspaceEntryForMutation(currentState[workspaceId], workspaceId);
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

  const currentState = getWorkspaceThreadsStateObject(state);
  const entry = cloneWorkspaceEntryForMutation(currentState[workspaceId], workspaceId);
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

  const currentState = getWorkspaceThreadsStateObject(state);
  const sourceEntry = currentState[workspaceId];
  const entry = sourceEntry ? cloneWorkspaceEntryForMutation(sourceEntry, workspaceId) : null;
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
    preferLiveHookAssistantMessages: event.preferLiveHookAssistantMessages,
    promptEpoch: event.promptEpoch || event.prompt_epoch,
    promptEventId: event.promptEventId || event.pendingPromptId || event.promptId,
    promptAccepted: event.promptAccepted,
    promptEventSubmittedAt: event.promptEventSubmittedAt,
    source: cleanText(event.source, `${agentId}-session`),
    submittedAt: event.submittedAt,
    allowTranscriptTurnCompletion: event.allowTranscriptTurnCompletion,
    assistantResponseCompletesTurn: event.assistantResponseCompletesTurn,
    transcriptCompletionCanSettleTurn: event.transcriptCompletionCanSettleTurn,
    transcriptExplicitCompletionCanSettleTurn: event.transcriptExplicitCompletionCanSettleTurn,
    turnCompleteSeen: event.turnCompleteSeen,
  });
  const projectionEventsAfter = appendThreadProjectionEvents(
    projectionEventsBefore,
    projectionEventsToAdd,
  );
  const messagesBefore = normalizeThreadMessages(existing?.messages);
  const messagesAfter = projectThreadProjectionMessagesFromNormalizedEvents(projectionEventsAfter, existing?.messages);
  const latestTurnBefore = normalizeThreadLatestTurn(existing?.latestTurn);
  const latestTurnAfter = latestTurnBefore;
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
    transcriptTurnCompletionBlocked: false,
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

  const entry = getWorkspaceThreadsStateObject(state)[safeWorkspaceId];
  return workspaceEntryHasArchivedSession(entry, agentId, safeSessionId);
}

export function workspaceThreadIdIsArchived(state, workspaceId, threadId) {
  const safeWorkspaceId = cleanText(workspaceId);
  const safeThreadId = cleanText(threadId);
  if (!safeWorkspaceId || !safeThreadId) {
    return false;
  }

  const entry = getWorkspaceThreadsStateObject(state)[safeWorkspaceId];
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

function findWorkspaceThreadIdForTerminalSessionBinding(entry, event = {}, agentId = "", sessionId = "") {
  const directThreadId = cleanText(event.threadId);
  if (directThreadId && entry?.threads?.[directThreadId]) {
    return directThreadId;
  }

  const sessionThreadId = findWorkspaceThreadIdForProviderSession(entry, agentId, sessionId);
  if (sessionThreadId) {
    return sessionThreadId;
  }

  const paneId = cleanText(event.paneId);
  const instanceId = Number.parseInt(event.instanceId, 10);
  const terminalIndex = normalizeTerminalIndex(event.terminalIndex);
  const terminalKey = terminalSessionKey(terminalIndex);
  const terminalThreadId = terminalKey ? cleanText(entry?.terminals?.[terminalKey]?.threadId) : "";
  if (terminalThreadId && entry?.threads?.[terminalThreadId]) {
    return terminalThreadId;
  }

  const exactTerminalThread = Object.values(entry?.threads || {}).find((thread) => {
    const binding = normalizeTerminalBinding(thread?.terminalBinding);
    const providerBinding = getWorkspaceThreadProviderBinding(thread, agentId);
    const providerTerminalBinding = normalizeTerminalBinding(providerBinding?.terminalBinding);
    return [binding, providerTerminalBinding].some((candidate) => (
      candidate
        && (!paneId || candidate.paneId === paneId)
        && (!Number.isInteger(instanceId) || Number(candidate.instanceId) === instanceId)
    ));
  });
  if (exactTerminalThread?.id) {
    return exactTerminalThread.id;
  }

  const terminalByPane = Object.values(entry?.terminals || {}).find((terminal) => (
    (paneId && terminal?.paneId === paneId)
      || (Number.isInteger(instanceId) && Number(terminal?.instanceId) === instanceId)
  ));
  if (terminalByPane?.threadId && entry?.threads?.[terminalByPane.threadId]) {
    return terminalByPane.threadId;
  }

  const restoredThreadId = terminalKey ? cleanText(entry?.terminalThreadIds?.[terminalKey]) : "";
  if (restoredThreadId && entry?.threads?.[restoredThreadId]) {
    return restoredThreadId;
  }

  const indexedThread = getWorkspaceThreadForTerminalIndexFromEntry(entry, terminalIndex);
  return cleanText(indexedThread?.id);
}

export function applyWorkspaceThreadProviderSessionBinding(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const agentId = cleanAgentId(event.agentId || event.currentAgent, "");
  const nativeSessionId = cleanText(
    event.nativeSessionId
      || event.native_session_id
      || event.providerSessionId
      || event.provider_session_id
      || event.sessionId
      || event.session_id,
  );
  const forkFromProviderSessionId = cleanText(
    event.forkFromProviderSessionId
      || event.fork_from_provider_session_id
      || event.forkedFromProviderSessionId
      || event.forked_from_provider_session_id
      || event.parentProviderSessionId
      || event.parent_provider_session_id,
  );
  const sharedHistoryId = cleanText(event.sharedHistoryId || event.shared_history_id || event.historyGroupId || event.history_group_id);
  const relatedProviderSessionIds = cleanTextArray(
    event.relatedProviderSessionIds,
    event.related_provider_session_ids,
    event.relatedSessionIds,
    event.related_session_ids,
    forkFromProviderSessionId,
  );
  if (!workspaceId || !isThreadAgentId(agentId) || !nativeSessionId) {
    return state || {};
  }

  const currentState = getWorkspaceThreadsStateObject(state);
  const entry = cloneWorkspaceEntryForMutation(currentState[workspaceId], workspaceId);
  if (workspaceEntryHasArchivedSession(entry, agentId, nativeSessionId)) {
    return state || {};
  }

  const terminalIndex = normalizeTerminalIndex(event.terminalIndex);
  let threadId = findWorkspaceThreadIdForTerminalSessionBinding(entry, event, agentId, nativeSessionId);
  if (!threadId && terminalIndex != null) {
    threadId = createThreadIdForTerminal(workspaceId, terminalIndex);
  }
  if (!threadId) {
    return state || {};
  }

  const now = nowIso();
  const terminalNickname = resolveWorkspaceTerminalNickname(
    entry,
    [
      event.terminalNickname,
      event.terminal_nickname,
      event.terminalName,
      event.terminal_name,
      event.displayName,
      event.display_name,
      workspaceTerminalNicknameFromRecord(entry.threads?.[threadId]),
      workspaceTerminalNicknameFromRecord(getWorkspaceThreadProviderBinding(entry.threads?.[threadId], agentId)),
    ],
    {
      excludeTerminalIndex: terminalIndex,
      excludeThreadId: threadId,
    },
  );
  if (!entry.threads[threadId]) {
    const title = cleanRealThreadTitleCandidate(event.nativeSessionTitle || event.sessionTitle)
      || defaultThreadTitle(terminalIndex ?? 0, agentId);
    entry.threads[threadId] = {
      coordination: normalizeCoordination({
        worktreePath: event.worktreePath || event.cwd,
      }),
      createdAt: now,
      currentAgent: agentId,
      displayName: terminalNickname,
      forkFromProviderSessionId,
      id: threadId,
      lastActiveAt: now,
      lastMessageAt: "",
      latestTurn: null,
      materialized: true,
      messageCount: 0,
      messages: [],
      pendingPrompt: null,
      preferredAgent: agentId,
      projectionEvents: [],
      providerBindings: {},
      relatedProviderSessionIds,
      sessionName: title,
      sharedHistoryId,
      slotKey: cleanText(event.slotKey, defaultSlotKey(terminalIndex)),
      status: cleanText(event.status, "active"),
      terminalBinding: null,
      terminalIndex,
      terminalName: terminalNickname,
      terminalNickname,
      title,
      transcriptSessionId: nativeSessionId,
      updatedAt: now,
      workspaceId,
    };
    entry.threadOrder.push(threadId);
  }

  const existingThread = entry.threads[threadId] || null;
  const terminalKey = terminalSessionKey(terminalIndex);
  const existingTerminal = terminalKey ? entry.terminals?.[terminalKey] || null : null;
  const inheritedActivityStatus = explicitRuntimeActivityStatus(event, "")
    || normalizeThreadActivityStatus(
      existingTerminal?.activityStatus
        || existingTerminal?.activity_status,
      "",
    );
  const bindingEvent = {
    ...event,
    activityStatus: inheritedActivityStatus || event.activityStatus,
    activity_status: inheritedActivityStatus || event.activity_status,
    agentId,
    forkFromProviderSessionId,
    nativeSessionId,
    nativeSessionKind: cleanText(event.nativeSessionKind || event.native_session_kind, "session"),
    nativeSessionSource: cleanText(event.nativeSessionSource || event.native_session_source || event.source, "rust-session-binding"),
    providerSessionId: nativeSessionId,
    relatedProviderSessionIds,
    sessionId: event.sessionId || event.session_id || nativeSessionId,
    sharedHistoryId,
    status: event.status || "active",
    terminalIndex,
    threadId,
    workspaceId,
  };
  upsertActiveTerminal(entry, bindingEvent, {
    status: bindingEvent.status,
    threadId,
  });
  bindExistingThreadToTerminal(entry, threadId, bindingEvent, {
    status: bindingEvent.status,
  });

  return updateWorkspaceThreadProviderSession({
    ...currentState,
    [workspaceId]: entry,
  }, bindingEvent);
}

export function updateWorkspaceThreadProviderSession(state, event = {}) {
  const workspaceId = cleanText(event.workspaceId);
  const threadId = cleanText(event.threadId);
  const agentId = cleanAgentId(event.agentId || event.currentAgent, "");
  const nativeSessionId = cleanText(
    event.nativeSessionId
      || event.native_session_id
      || event.providerSessionId
      || event.provider_session_id,
  );
  const forkFromProviderSessionId = cleanText(
    event.forkFromProviderSessionId
      || event.fork_from_provider_session_id
      || event.forkedFromProviderSessionId
      || event.forked_from_provider_session_id
      || event.parentProviderSessionId
      || event.parent_provider_session_id,
  );
  const sharedHistoryId = cleanText(event.sharedHistoryId || event.shared_history_id || event.historyGroupId || event.history_group_id);
  const relatedProviderSessionIds = cleanTextArray(
    event.relatedProviderSessionIds,
    event.related_provider_session_ids,
    event.relatedSessionIds,
    event.related_session_ids,
    forkFromProviderSessionId,
  );
  if (!workspaceId || !threadId || !isThreadAgentId(agentId) || !nativeSessionId) {
    return state || {};
  }

  const target = getWorkspaceThreadUpdateTarget(state, workspaceId, threadId);
  if (!target) {
    return state || {};
  }
  const { currentState } = target;
  let { entry, existing } = target;
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
  const sessionTerminalBinding = normalizeTerminalBinding({
    instanceId: event.instanceId ?? existing.terminalBinding?.instanceId,
    paneId: event.paneId || existing.terminalBinding?.paneId,
    terminalIndex: event.terminalIndex ?? existing.terminalIndex,
  });
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
    forkFromProviderSessionId: forkFromProviderSessionId || providerBindings[agentId]?.forkFromProviderSessionId || "",
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
    relatedProviderSessionIds: relatedProviderSessionIds.length
      ? relatedProviderSessionIds
      : cleanTextArray(providerBindings[agentId]?.relatedProviderSessionIds),
    sharedHistoryId: sharedHistoryId || providerBindings[agentId]?.sharedHistoryId || "",
    terminalBinding: sessionTerminalBinding || providerBindings[agentId]?.terminalBinding || existing.terminalBinding || null,
    updatedAt: now,
  };
  const effectiveTerminalBinding = providerBindings[agentId]?.terminalBinding
    || sessionTerminalBinding
    || existing.terminalBinding
    || null;
  const terminalKey = getTerminalKeyForEvent(entry, {
    ...event,
    terminalIndex: event.terminalIndex
      ?? sessionTerminalBinding?.terminalIndex
      ?? effectiveTerminalBinding?.terminalIndex
      ?? existing.terminalIndex,
    threadId,
  });
  const terminals = { ...entry.terminals };
  if (terminalKey && terminals[terminalKey]) {
    const terminal = terminals[terminalKey];
    terminals[terminalKey] = normalizeActiveTerminal({
      ...terminal,
      activityStatus: explicitRuntimeActivityStatus(event, "")
        || normalizeThreadActivityStatus(terminal.activityStatus || terminal.activity_status, "")
        || "idle",
      agentId,
      agentDisplayName: event.agentDisplayName || event.agent_display_name || terminal.agentDisplayName,
      agentType: event.agentType || event.agent_type || terminal.agentType,
      instanceId: event.instanceId ?? terminal.instanceId,
      nativeSessionId,
      paneId: event.paneId || terminal.paneId,
      provider: event.provider || terminal.provider,
      providerSessionId: nativeSessionId,
      forkFromProviderSessionId: forkFromProviderSessionId || terminal.forkFromProviderSessionId,
      relatedProviderSessionIds: relatedProviderSessionIds.length
        ? relatedProviderSessionIds
        : cleanTextArray(terminal.relatedProviderSessionIds),
      sessionId: event.sessionId || event.session_id || nativeSessionId,
      sharedHistoryId: sharedHistoryId || terminal.sharedHistoryId,
      terminalIndex: normalizeTerminalIndex(
        event.terminalIndex
          ?? terminal.terminalIndex
          ?? sessionTerminalBinding?.terminalIndex
          ?? existing.terminalIndex,
      ),
      threadId,
      updatedAt: now,
    }) || {
      ...terminal,
      nativeSessionId,
      providerSessionId: nativeSessionId,
      sessionId: event.sessionId || event.session_id || nativeSessionId,
      threadId,
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
          providerBindings,
          forkFromProviderSessionId: forkFromProviderSessionId || existing.forkFromProviderSessionId || "",
          relatedProviderSessionIds: relatedProviderSessionIds.length
            ? relatedProviderSessionIds
            : cleanTextArray(existing.relatedProviderSessionIds),
          sharedHistoryId: sharedHistoryId || existing.sharedHistoryId || "",
          sessionName: nativeSessionTitle || existing.sessionName,
          terminalBinding: effectiveTerminalBinding,
          terminalIndex: effectiveTerminalBinding?.terminalIndex ?? existing.terminalIndex,
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

  const target = getWorkspaceThreadUpdateTarget(state, workspaceId, threadId);
  if (!target) {
    return state || {};
  }
  const { currentState, entry, existing } = target;
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

  const target = getWorkspaceThreadUpdateTarget(state, workspaceId, threadId);
  if (!target) {
    return state || {};
  }
  const { currentState, entry, existing } = target;

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

  const target = getWorkspaceThreadUpdateTarget(state, workspaceId, threadId);
  if (!target) {
    return state || {};
  }
  const { currentState, entry, existing } = target;
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

  const target = getWorkspaceThreadUpdateTarget(state, workspaceId, threadId);
  if (!target) {
    return state || {};
  }
  const { currentState } = target;
  const rawExisting = target.existing;
  let { entry, existing } = target;
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
  const projectionEventsToAdd = createProjectionEventsFromTranscript(existing, event.messages, {
    agentId,
    completedAt: event.completedAt,
    expectedMessageCreatedAt: event.expectedMessageCreatedAt,
    expectedUserMessage: event.expectedUserMessage,
    latestTimestamp: event.latestTimestamp,
    matchedBy: event.matchedBy,
    preferLiveHookAssistantMessages: event.preferLiveHookAssistantMessages,
    promptEpoch: event.promptEpoch || event.prompt_epoch,
    promptEventId: event.promptEventId || event.pendingPromptId || event.promptId,
    promptAccepted: event.promptAccepted,
    promptEventSubmittedAt: event.promptEventSubmittedAt,
    source: cleanText(event.source, `${agentId}-session`),
    submittedAt: event.submittedAt,
    allowTranscriptTurnCompletion: event.allowTranscriptTurnCompletion,
    assistantResponseCompletesTurn: event.assistantResponseCompletesTurn,
    transcriptCompletionCanSettleTurn: event.transcriptCompletionCanSettleTurn,
    transcriptExplicitCompletionCanSettleTurn: event.transcriptExplicitCompletionCanSettleTurn,
    turnCompleteSeen: event.turnCompleteSeen,
  });
  const projectionEvents = appendThreadProjectionEvents(
    ensureThreadProjectionEvents(existing),
    projectionEventsToAdd,
  );
  const messages = projectThreadProjectionMessagesFromNormalizedEvents(projectionEvents, existing.messages);
  const lifecycleExisting = rawExisting || existing;
  const existingLatestTurn = normalizeThreadLatestTurn(lifecycleExisting.latestTurn);
  const projectedLatestTurn = projectLatestTurnFromNormalizedEvents(projectionEvents, existingLatestTurn);
  const preservedLatestTurn = preserveRunningLatestTurnWhenTranscriptCompletionBlocked(
    existingLatestTurn,
    projectedLatestTurn,
    event,
  );
  const latestTurn = preservedLatestTurn.latestTurn;
  const pendingPrompt = CLOSED_THREAD_TURN_STATES.has(latestTurn?.state)
    ? null
    : lifecycleExisting.pendingPrompt || existing.pendingPrompt;
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
          pendingPrompt,
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

  const target = getWorkspaceThreadUpdateTarget(state, workspaceId, threadId);
  if (!target) {
    return state || {};
  }
  const { currentState, entry, existing } = target;

  const now = nowIso();
  const projectionEvents = appendThreadProjectionEvents(
    ensureThreadProjectionEvents(existing),
    event.projectionEvents || event.events || [],
  );
  const messages = projectThreadProjectionMessagesFromNormalizedEvents(projectionEvents, existing.messages);
  const projectedLatestTurn = projectLatestTurnFromNormalizedEvents(projectionEvents, existing.latestTurn);
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
  const explicitActivityStatus = explicitRuntimeActivityStatus(event, "");
  const activityStatus = explicitActivityStatus || (eventType === "provider-turn-started"
    ? "thinking"
    : eventType === "provider-turn-error"
      ? "error"
      : eventType === "provider-turn-completed" || eventType === "provider-turn-interrupted"
        ? "idle"
        : activityStatusForLatestTurn(latestTurn, "idle"));
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
  const terminalReadinessIgnoredEvent = eventType === "terminal-input-ready"
    || eventType === "terminal-prompt-ready";
  const marksInputReady = !terminalReadinessIgnoredEvent && (event.inputReady === true
    || eventType === "provider-turn-completed"
    || eventType === "provider-turn-interrupted"
    || eventType === "provider-turn-error");
  const inputReady = marksInputReady
    ? true
    : eventType === "provider-turn-started"
      ? false
      : Boolean(event.inputReady ?? existingProviderBindingForAgent?.inputReady);
  const inputReadyAt = inputReady
    ? cleanText(event.inputReadyAt, existingProviderBindingForAgent?.inputReadyAt)
    : "";
  const inputReadyConfidence = inputReady
    ? cleanText(
      event.inputReadyConfidence,
      existingProviderBindingForAgent?.inputReadyConfidence,
    )
    : "";
  const providerPromptingFields = promptingUserFieldsForTerminalEvent(event, existingProviderBindingForAgent, {
    clear: terminalReadinessIgnoredEvent ? false : !inputReady || marksInputReady,
    eventType,
  });
  const eventAgentType = cleanAgentDisplayName(
    event.agentType || event.agent_type,
    existingProviderBindingForAgent?.agentType,
  );
  const eventAgentDisplayName = cleanAgentDisplayName(
    event.agentDisplayName || event.agent_display_name || eventAgentType,
    existingProviderBindingForAgent?.agentDisplayName,
  );
  const eventProvider = cleanAgentDisplayName(
    event.provider,
    existingProviderBindingForAgent?.provider,
  );
  const eventForkFromProviderSessionId = cleanText(
    event.forkFromProviderSessionId
      || event.fork_from_provider_session_id
      || event.forkedFromProviderSessionId
      || event.forked_from_provider_session_id
      || event.parentProviderSessionId
      || event.parent_provider_session_id,
  );
  const eventSharedHistoryId = cleanText(event.sharedHistoryId || event.shared_history_id || event.historyGroupId || event.history_group_id);
  const eventRelatedProviderSessionIds = cleanTextArray(
    event.relatedProviderSessionIds,
    event.related_provider_session_ids,
    event.relatedSessionIds,
    event.related_session_ids,
    eventForkFromProviderSessionId,
  );
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
      agentDisplayName: eventAgentDisplayName,
      agentType: eventAgentType,
      lastActiveAt: now,
      lastMessageAt: messages.length ? messages[messages.length - 1].createdAt : providerBindings[agentId].lastMessageAt,
      messageCount: messages.length,
      inputReady,
      inputReadyAt,
      inputReadyConfidence,
      forkFromProviderSessionId: eventForkFromProviderSessionId || providerBindings[agentId].forkFromProviderSessionId || "",
      ...hookHealthFields(event, providerBindings[agentId]),
      ...providerPromptingFields,
      modelId: cleanModelId(event.modelId || event.model, providerBindings[agentId].modelId),
      modelSource: cleanModelId(event.modelId || event.model) ? cleanText(event.modelSource, "provider-turn") : providerBindings[agentId].modelSource,
      modelUpdatedAt: cleanModelId(event.modelId || event.model) ? now : providerBindings[agentId].modelUpdatedAt,
      nativeSessionId: cleanText(event.nativeSessionId || event.providerSessionId, providerBindings[agentId].nativeSessionId),
      nativeSessionKind: cleanText(event.nativeSessionKind, providerBindings[agentId].nativeSessionKind || "session"),
      nativeSessionSource: cleanText(event.nativeSessionSource, providerBindings[agentId].nativeSessionSource || "provider-turn"),
      nativeSessionUpdatedAt: cleanText(event.nativeSessionId || event.providerSessionId) ? now : providerBindings[agentId].nativeSessionUpdatedAt,
      provider: eventProvider,
      relatedProviderSessionIds: eventRelatedProviderSessionIds.length
        ? eventRelatedProviderSessionIds
        : cleanTextArray(providerBindings[agentId].relatedProviderSessionIds),
      sharedHistoryId: eventSharedHistoryId || providerBindings[agentId].sharedHistoryId || "",
      status: cleanText(event.status, existing.status || providerBindings[agentId].status || "active"),
      updatedAt: now,
    };
  }

  const terminalKey = getTerminalKeyForEvent(entry, event);
  const terminals = { ...entry.terminals };
  if (terminalKey && terminals[terminalKey]) {
    const terminalPromptingFields = promptingUserFieldsForTerminalEvent(event, terminals[terminalKey], {
      clear: terminalReadinessIgnoredEvent ? false : !inputReady || marksInputReady,
      eventType,
    });
    terminals[terminalKey] = {
      ...terminals[terminalKey],
      activityStatus,
      commandPhase: cleanText(event.commandPhase || event.command_phase, terminals[terminalKey].commandPhase),
      executionPhase: cleanText(event.executionPhase || event.execution_phase, terminals[terminalKey].executionPhase),
      inputReady,
      inputReadyAt,
      inputReadyConfidence,
      ...hookHealthFields(event, terminals[terminalKey]),
      agentDisplayName: cleanAgentDisplayName(
        event.agentDisplayName || event.agent_display_name || eventAgentType,
        terminals[terminalKey].agentDisplayName,
      ),
      agentType: cleanAgentDisplayName(event.agentType || event.agent_type, terminals[terminalKey].agentType),
      ...terminalPromptingFields,
      nativeRailState: cleanText(event.nativeRailState || event.native_rail_state, terminals[terminalKey].nativeRailState),
      provider: cleanAgentDisplayName(event.provider, terminals[terminalKey].provider),
      forkFromProviderSessionId: eventForkFromProviderSessionId || terminals[terminalKey].forkFromProviderSessionId || "",
      providerSessionId: cleanText(
        event.providerSessionId || event.provider_session_id || event.nativeSessionId,
        terminals[terminalKey].providerSessionId,
      ),
      nativeSessionId: cleanText(
        event.nativeSessionId || event.native_session_id || event.providerSessionId || event.provider_session_id,
        terminals[terminalKey].nativeSessionId,
      ),
      relatedProviderSessionIds: eventRelatedProviderSessionIds.length
        ? eventRelatedProviderSessionIds
        : cleanTextArray(terminals[terminalKey].relatedProviderSessionIds),
      sessionId: cleanText(
        event.sessionId || event.session_id || event.providerSessionId || event.provider_session_id || event.nativeSessionId || event.native_session_id,
        terminals[terminalKey].sessionId,
      ),
      sharedHistoryId: eventSharedHistoryId || terminals[terminalKey].sharedHistoryId || "",
      turnStatus: cleanText(event.turnStatus || event.turn_status, terminals[terminalKey].turnStatus),
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
          forkFromProviderSessionId: eventForkFromProviderSessionId || existing.forkFromProviderSessionId || "",
          relatedProviderSessionIds: eventRelatedProviderSessionIds.length
            ? eventRelatedProviderSessionIds
            : cleanTextArray(existing.relatedProviderSessionIds),
          sharedHistoryId: eventSharedHistoryId || existing.sharedHistoryId || "",
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

  const target = getWorkspaceThreadUpdateTarget(state, workspaceId, threadId);
  if (!target) {
    return state || {};
  }
  const { currentState, entry, existing } = target;

  const now = nowIso();
  const eventType = cleanText(event.type).toLowerCase();
  const explicitActivityStatus = explicitRuntimeActivityStatus(event, "");
  const activityStatus = explicitActivityStatus || (
    eventType === "agent-output"
      || eventType === "provider-user-prompt-started"
      || eventType === "provider-tool-started"
      || eventType === "provider-subagent-started"
      ? "thinking"
      : eventType === "provider-turn-error"
        ? "error"
        : eventType === "provider-turn-completed" || eventType === "provider-turn-interrupted"
          ? "idle"
          : "idle"
  );
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
  const terminalReadinessIgnoredEvent = eventType === "terminal-input-ready"
    || eventType === "terminal-prompt-ready";
  const marksInputReady = !terminalReadinessIgnoredEvent && (explicitInputReady === true
    || eventType === "provider-turn-completed"
    || eventType === "provider-turn-interrupted"
    || eventType === "provider-turn-error");
  const marksInputBusy = explicitInputReady === false || activityStatus === "thinking";
  const inputReady = marksInputReady
    ? true
    : marksInputBusy
      ? false
      : Boolean(previousProviderBinding?.inputReady);
  const inputReadyAt = inputReady
    ? cleanText(event.inputReadyAt, previousProviderBinding?.inputReadyAt || now)
    : "";
  const inputReadyConfidence = inputReady
    ? cleanText(
      event.inputReadyConfidence,
      previousProviderBinding?.inputReadyConfidence,
    )
    : "";
  const providerPromptingFields = promptingUserFieldsForTerminalEvent(event, previousProviderBinding, {
    clear: terminalReadinessIgnoredEvent ? false : !inputReady || marksInputReady,
    eventType,
  });
  const eventAgentType = cleanAgentDisplayName(
    event.agentType || event.agent_type,
    previousProviderBinding?.agentType,
  );
  const eventAgentDisplayName = cleanAgentDisplayName(
    event.agentDisplayName || event.agent_display_name || eventAgentType,
    previousProviderBinding?.agentDisplayName,
  );
  const eventProvider = cleanAgentDisplayName(event.provider, previousProviderBinding?.provider);
  providerBindings[agentId] = {
    ...previousProviderBinding,
    activityStatus,
    agentDisplayName: eventAgentDisplayName,
    agentType: eventAgentType,
    ...hookHealthFields(event, previousProviderBinding),
    inputReady,
    inputReadyAt,
    inputReadyConfidence,
    ...providerPromptingFields,
    provider: eventProvider,
    status: providerStatus,
    updatedAt: now,
  };
  const terminalKey = getTerminalKeyForEvent(entry, event);
  const terminals = { ...entry.terminals };
  if (terminalKey && terminals[terminalKey]) {
    const terminalPromptingFields = promptingUserFieldsForTerminalEvent(event, terminals[terminalKey], {
      clear: terminalReadinessIgnoredEvent ? false : !inputReady || marksInputReady,
      eventType,
    });
    terminals[terminalKey] = {
      ...terminals[terminalKey],
      inputReady,
      inputReadyAt,
      inputReadyConfidence,
      ...hookHealthFields(event, terminals[terminalKey]),
      agentDisplayName: cleanAgentDisplayName(
        event.agentDisplayName || event.agent_display_name || eventAgentType,
        terminals[terminalKey].agentDisplayName,
      ),
      agentType: cleanAgentDisplayName(event.agentType || event.agent_type, terminals[terminalKey].agentType),
      ...terminalPromptingFields,
      provider: cleanAgentDisplayName(event.provider, terminals[terminalKey].provider),
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

function getWorkspaceThreadForTerminalIndexFromEntry(entry, terminalIndex) {
  if (!entry) {
    return null;
  }

  const safeTerminalIndex = normalizeTerminalIndex(terminalIndex);
  if (safeTerminalIndex == null) {
    return null;
  }

  const terminalKey = terminalSessionKey(safeTerminalIndex);
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
    activeThread?.terminalBinding?.terminalIndex === safeTerminalIndex
    || (activeThread?.terminalIndex === safeTerminalIndex && activeThread.status === "starting")
  ) {
    return activeThread;
  }

  const liveThread = Object.values(entry.threads)
    .filter((thread) => (
      thread.terminalBinding?.terminalIndex === safeTerminalIndex
      || (thread.terminalIndex === safeTerminalIndex && thread.status === "starting")
    ))
    .sort((left, right) => getThreadRestoreTimestamp(right) - getThreadRestoreTimestamp(left))[0] || null;
  if (liveThread) {
    return liveThread;
  }

  return Object.values(entry.threads)
    .filter((thread) => (
      getThreadTerminalIndex(thread) === safeTerminalIndex
      && getWorkspaceThreadHasSession(thread)
    ))
    .sort((left, right) => getThreadRestoreTimestamp(right) - getThreadRestoreTimestamp(left))[0] || null;
}

export function getWorkspaceThreadForTerminalIndex(state, workspaceId, terminalIndex) {
  const entry = getWorkspaceThreadsStateObject(state)[workspaceId];
  return getWorkspaceThreadForTerminalIndexFromEntry(entry, terminalIndex);
}

function workspaceThreadMatchesLiveTerminalIdentity(thread, providerBinding, target = {}) {
  const terminalIndex = normalizeTerminalIndex(target.terminalIndex);
  const paneId = cleanText(target.paneId);
  const instanceId = Number.parseInt(target.instanceId, 10);
  const bindings = [
    providerBinding?.terminalBinding,
    thread?.terminalBinding,
  ]
    .map((binding) => normalizeTerminalBinding(binding))
    .filter(Boolean);

  return bindings.some((binding) => {
    const indexMatches = terminalIndex == null
      || normalizeTerminalIndex(binding.terminalIndex) === terminalIndex;
    const paneMatches = !paneId || binding.paneId === paneId;
    const instanceMatches = !Number.isInteger(instanceId)
      || Number(binding.instanceId) === instanceId;
    return indexMatches && paneMatches && instanceMatches;
  });
}

function workspaceThreadLiveSelectionScore(thread, providerBinding, target = {}) {
  const liveThreadId = cleanText(target.threadId);
  const terminalIndex = normalizeTerminalIndex(target.terminalIndex);
  let score = 0;
  if (liveThreadId && thread?.id === liveThreadId) {
    score += 1000;
  }
  if (workspaceThreadMatchesLiveTerminalIdentity(thread, providerBinding, target)) {
    score += 500;
  }
  if (terminalIndex != null && getThreadTerminalIndex(thread) === terminalIndex) {
    score += 100;
  }
  if (["active", "starting"].includes(cleanText(thread?.status).toLowerCase())) {
    score += 50;
  }
  score += Math.min(49, Math.floor(getThreadRestoreTimestamp(thread) / 1000) % 50);
  return score;
}

export function getWorkspaceThreadSelectionForLiveTerminal(entry, target = {}) {
  if (!entry?.threads || typeof entry.threads !== "object") {
    return "";
  }

  const terminalIndex = normalizeTerminalIndex(target.terminalIndex);
  const terminalKey = terminalSessionKey(terminalIndex);
  const terminal = terminalKey ? entry.terminals?.[terminalKey] || null : null;
  const agentId = cleanAgentId(target.agentId || target.currentAgent || terminal?.agentId, "");
  const providerSessionId = cleanText(
    target.providerSessionId
      || target.provider_session_id
      || target.nativeSessionId
      || target.native_session_id
      || target.sessionId
      || target.session_id,
  );
  const liveThreadId = cleanText(target.threadId || terminal?.threadId);
  const threads = Object.values(entry.threads).filter((thread) => {
    if (!thread?.id || workspaceEntryHasArchivedThreadId(entry, thread.id)) {
      return false;
    }
    if (!agentId) {
      return true;
    }
    return cleanAgentId(thread.currentAgent) === agentId
      || Boolean(thread.providerBindings?.[agentId]);
  });

  if (providerSessionId) {
    const sessionThread = threads
      .filter((thread) => workspaceThreadHasProviderSession(thread, agentId, providerSessionId))
      .sort((left, right) => {
        const leftBinding = getWorkspaceThreadProviderBinding(left, agentId);
        const rightBinding = getWorkspaceThreadProviderBinding(right, agentId);
        return workspaceThreadLiveSelectionScore(right, rightBinding, {
          ...target,
          threadId: liveThreadId,
        }) - workspaceThreadLiveSelectionScore(left, leftBinding, {
          ...target,
          threadId: liveThreadId,
        });
      })[0] || null;
    return cleanText(sessionThread?.id);
  }

  const directThread = liveThreadId ? entry.threads[liveThreadId] : null;
  if (
    directThread
    && !getWorkspaceThreadHasSession(directThread)
    && (!agentId || cleanAgentId(directThread.currentAgent) === agentId || directThread.providerBindings?.[agentId])
  ) {
    return directThread.id;
  }

  const sessionlessThread = threads
    .filter((thread) => !getWorkspaceThreadHasSession(thread))
    .sort((left, right) => {
      const leftBinding = getWorkspaceThreadProviderBinding(left, agentId);
      const rightBinding = getWorkspaceThreadProviderBinding(right, agentId);
      return workspaceThreadLiveSelectionScore(right, rightBinding, {
        ...target,
        threadId: liveThreadId,
      }) - workspaceThreadLiveSelectionScore(left, leftBinding, {
        ...target,
        threadId: liveThreadId,
      });
    })[0] || null;

  return cleanText(sessionlessThread?.id);
}

export function getWorkspaceThreadsByTerminalIndex(state, workspaceId, terminalIndexes = []) {
  const entry = getWorkspaceThreadsStateObject(state)[workspaceId];
  const byIndex = {};

  if (!entry) {
    return byIndex;
  }

  terminalIndexes.forEach((terminalIndex) => {
    const thread = getWorkspaceThreadForTerminalIndexFromEntry(entry, terminalIndex);
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

  const currentState = getWorkspaceThreadsStateObject(state);
  const sourceEntry = currentState[safeWorkspaceId];
  const entry = sourceEntry ? cloneWorkspaceEntryForMutation(sourceEntry, safeWorkspaceId) : null;
  if (!entry) {
    return state || {};
  }
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
  const safeWorkspaceId = cleanText(workspaceId);
  const safeThreadId = cleanText(threadId);
  if (!safeWorkspaceId || !safeThreadId) {
    return state || {};
  }

  const currentState = getWorkspaceThreadsStateObject(state);
  const sourceEntry = currentState[safeWorkspaceId];
  const entry = sourceEntry ? cloneWorkspaceEntryForMutation(sourceEntry, safeWorkspaceId) : null;
  if (!entry) {
    return state || {};
  }

  const activeThread = entry.threads[safeThreadId];
  const archivedThread = entry.archivedThreads[safeThreadId];
  if (!activeThread && !archivedThread) {
    return state || {};
  }

  delete entry.threads[safeThreadId];
  delete entry.archivedThreads[safeThreadId];
  forgetThreadEverywhere(entry, safeThreadId);
  entry.threadOrder = entry.threadOrder.filter((candidateId) => candidateId !== safeThreadId);
  entry.archivedThreadOrder = entry.archivedThreadOrder
    .filter((candidateId) => candidateId !== safeThreadId);
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

export function toggleWorkspaceThreadPinned(state, workspaceId, threadId) {
  const safeWorkspaceId = cleanText(workspaceId);
  const safeThreadId = cleanText(threadId);
  if (!safeWorkspaceId || !safeThreadId) {
    return state || {};
  }

  const currentState = getWorkspaceThreadsStateObject(state);
  const sourceEntry = currentState[safeWorkspaceId];
  const entry = sourceEntry ? cloneWorkspaceEntryForMutation(sourceEntry, safeWorkspaceId) : null;
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

export function getWorkspaceThreadTurnState(thread) {
  return normalizeThreadLatestTurn(thread?.latestTurn)?.state || "";
}

export { THREAD_AGENT_IDS, WORKSPACE_THREADS_STORAGE_KEY };

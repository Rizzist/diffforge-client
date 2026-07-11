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
let liveTextProjectionEventSequence = 0;
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

export function getWorkspaceThreadDetailVisibilityKey({ workspace_id: workspaceId = "", thread_id: threadId = "" } = {}) {
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
  const workspaceId = cleanText(detail.workspace_id);
  const threadId = cleanText(detail.thread_id);
  const key = getWorkspaceThreadDetailVisibilityKey({ workspace_id: workspaceId, thread_id: threadId });
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
        thread_id: threadId,
        visible: true,
        workspace_id: workspaceId,
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
        thread_id: threadId,
        visible,
        workspace_id: workspaceId,
      },
    }));
  }

  return key;
}

export function workspaceThreadDetailIsVisible({ workspace_id: workspaceId = "", thread_id: threadId = "" } = {}) {
  const registry = getWorkspaceThreadDetailVisibilityRegistry();
  const key = getWorkspaceThreadDetailVisibilityKey({ workspace_id: workspaceId, thread_id: threadId });
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
    source.approval_id || source.permission_prompt_id || source.permission_request_id || source.source_event_id || source.tool_use_id,
    fallbackSource.approval_id || fallbackSource.permission_prompt_id || fallbackSource.permission_request_id || fallbackSource.source_event_id || fallbackSource.tool_use_id,
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
    sourceValue.terminal_is_prompting_user ?? sourceValue.prompting_user ?? sourceValue.requires_user_input,
    fallbackValue.terminal_is_prompting_user || fallbackValue.prompting_user || fallbackValue.requires_user_input,
  );
  if (!active) {
    return false;
  }

  const kind = normalizePromptingUserKind(
    sourceValue.prompting_user_kind || sourceValue.prompting_kind,
    fallbackValue.prompting_user_kind || fallbackValue.prompting_kind || "",
  );
  const source = sourceValue.prompting_user_source || sourceValue.prompting_source || sourceValue.source || sourceValue.type || fallbackValue.prompting_user_source || fallbackValue.prompting_source;
  const hasPermissionKind = EXPLICIT_PERMISSION_PROMPT_KINDS.has(kind) || sourceValue.requires_user_input === true || fallbackValue.requires_user_input === true;

  return Boolean(
    hasPermissionKind
      && (promptingPermissionToken(sourceValue, fallbackValue) || promptingSourceLooksExplicitPermission(source))
  );
}

function promptingUserFields(value = {}, fallback = {}) {
  const sourceValue = value && typeof value === "object" ? value : {};
  const fallbackValue = fallback && typeof fallback === "object" ? fallback : {};
  const active = valueLooksExplicitPermissionPrompt(sourceValue, fallbackValue);
  const sourceText = sourceValue.prompting_user_source || sourceValue.prompting_source || sourceValue.source || fallbackValue.prompting_user_source || fallbackValue.prompting_source;
  return {
    prompting_user_confidence: active
      ? cleanText(sourceValue.prompting_user_confidence || sourceValue.prompting_confidence, fallbackValue.prompting_user_confidence || fallbackValue.prompting_confidence)
      : "",
    prompting_user_kind: active
      ? normalizePromptingUserKind(sourceValue.prompting_user_kind || sourceValue.prompting_kind, fallbackValue.prompting_user_kind || fallbackValue.prompting_kind || "unknown")
      : "",
    prompting_user_source: active
      ? cleanText(
        promptingSourceLooksExplicitPermission(sourceText)
          ? sourceText
          : promptingPermissionToken(sourceValue, fallbackValue)
            ? "permission-token"
            : sourceText,
        "permission",
      )
      : "",
    prompting_user_text: active
      ? cleanText(sourceValue.prompting_user_text || sourceValue.prompting_text, fallbackValue.prompting_user_text || fallbackValue.prompting_text).slice(0, 420)
      : "",
    terminal_is_prompting_user: active,
  };
}

function eventExplicitlyPromptsUser(event = {}) {
  return valueLooksExplicitPermissionPrompt(event);
}

function promptingUserFieldsForTerminalEvent(event = {}, fallback = {}, options = {}) {
  const eventType = cleanText(options.event_type || event?.type).toLowerCase();
  const shouldClear = Boolean(
    options.clear === true
      || PROMPTING_CLEARING_TERMINAL_EVENT_TYPES.has(eventType)
      || event?.terminal_is_prompting_user === false
      || event?.prompting_user === false
      || event?.requires_user_input === false,
  );
  const value = shouldClear && !eventExplicitlyPromptsUser(event)
    ? {
        ...event,
        prompting_user: false,
        requires_user_input: false,
        terminal_is_prompting_user: false,
      }
    : event;
  return promptingUserFields(value, fallback);
}

function hookHealthFields(value = {}, fallback = {}) {
  const sourceValue = value && typeof value === "object" ? value : {};
  const fallbackValue = fallback && typeof fallback === "object" ? fallback : {};
  const observedAtMs = Number(
    sourceValue.hook_health_observed_at_ms || fallbackValue.hook_health_observed_at_ms || 0,
  );
  return {
    hook_health_event: cleanText(
      sourceValue.hook_health_event,
      fallbackValue.hook_health_event,
    ),
    hook_health_observed_at_ms: Number.isFinite(observedAtMs) && observedAtMs > 0 ? observedAtMs : 0,
    hook_health_status: cleanText(
      sourceValue.hook_health_status,
      fallbackValue.hook_health_status,
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

function cleanLiveMessageText(value, { trim = false } = {}) {
  if (value === undefined || value === null) {
    return "";
  }
  const text = String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/\n{4,}/g, "\n\n\n");
  return trim ? text.trim() : text;
}

function firstPresentTextValue(values) {
  return values.find((value) => value !== undefined && value !== null);
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
      // structuredClone beats stringify+parse severalfold, and this runs per
      // tool message on every hydration normalize.
      return typeof structuredClone === "function"
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
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
    "tool_input",
    "input",
    "arguments",
    "args",
  ]);
  const toolOutput = pickThreadToolValue(source, [
    "tool_output",
    "output",
    "result",
  ]);
  const toolError = pickThreadToolValue(source, [
    "tool_error",
    "error",
    "stderr",
  ]);
  const rawToolPayload = pickThreadToolValue(source, [
    "raw_tool_payload",
    "raw_payload",
    "raw",
  ]);
  const durationMs = Number(
    source.duration_ms || source.elapsed_ms || 0,
  );
  const exitCode = Number(
    source.exit_code ?? source.code ?? Number.NaN,
  );
  const metadata = {
    command: cleanMessageText(source.command),
    file_path: cleanText(source.file_path || source.path),
    tool_display_name: cleanText(source.tool_display_name),
    tool_name: cleanText(source.tool_name || source.name),
    tool_server: cleanText(source.tool_server || source.server),
  };
  if (threadToolValueHasContent(toolInput)) metadata.tool_input = toolInput;
  if (threadToolValueHasContent(toolOutput)) metadata.tool_output = toolOutput;
  if (threadToolValueHasContent(toolError)) metadata.tool_error = toolError;
  if (threadToolValueHasContent(rawToolPayload)) metadata.raw_tool_payload = rawToolPayload;
  if (Number.isFinite(durationMs) && durationMs > 0) metadata.duration_ms = Math.round(durationMs);
  if (Number.isFinite(exitCode)) metadata.exit_code = Math.trunc(exitCode);

  return Object.fromEntries(
    Object.entries(metadata).filter(([, entry]) => (
      threadToolValueHasContent(entry)
    )),
  );
}

function threadToolMetadataHasContent(metadata) {
  return Object.keys(normalizeThreadToolMetadata(metadata)).length > 0;
}

function normalizeThreadStructuredTranscriptMetadata(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const metadata = {};
  const copyValue = (targetKey, keys) => {
    const entry = pickThreadToolValue(source, keys);
    if (threadToolValueHasContent(entry)) {
      metadata[targetKey] = entry;
    }
  };
  const copyText = (targetKey, keys) => {
    const entry = cleanText(keys.map((key) => source[key]).find((candidate) => cleanText(candidate)));
    if (entry) {
      metadata[targetKey] = entry;
    }
  };
  const copyNumber = (targetKey, keys) => {
    const entry = keys.map((key) => Number(source[key])).find(Number.isFinite);
    if (Number.isFinite(entry)) {
      metadata[targetKey] = entry;
    }
  };
  const copyBool = (targetKey, keys) => {
    const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(source, candidate));
    if (!key) return;
    metadata[targetKey] = source[key] === true
      || source[key] === 1
      || cleanText(source[key]).toLowerCase() === "true";
  };

  copyText("canonical_kind", ["canonical_kind"]);
  copyText("legacy_kind", ["legacy_kind"]);
  copyText("record_id", ["record_id"]);
  copyText("started_at", ["started_at"]);
  copyText("completed_at", ["completed_at"]);
  copyNumber("record_seq", ["record_seq"]);
  copyNumber("duration_ms", ["duration_ms"]);
  copyBool("truncated", ["truncated", "is_truncated", "partial"]);
  copyBool("is_truncated", ["is_truncated", "truncated", "partial"]);
  copyBool("partial", ["partial", "truncated", "is_truncated"]);
  copyValue("tool", ["tool", "tool_call"]);
  copyValue("tool_call", ["tool_call", "tool"]);
  copyValue("file_change", ["file_change"]);
  copyValue("subagent", ["subagent"]);
  copyValue("usage", ["usage", "usage_report", "token_usage"]);
  copyValue("usage_report", ["usage_report", "usage", "token_usage"]);
  copyValue("files", ["files", "changed_files"]);
  copyValue("changed_files", ["changed_files", "files"]);

  return metadata;
}

function normalizeThreadArtifact(artifact) {
  if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
    return null;
  }

  const mimeType = cleanText(artifact.mime_type || artifact.content_type);
  const path = cleanText(artifact.path || artifact.file_path || artifact.local_path);
  const url = cleanText(artifact.url || artifact.uri || artifact.file_url || artifact.image_url);
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
    mime_type: mimeType,
    name: cleanText(artifact.name || artifact.filename || artifact.file_name),
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
      artifact.mime_type,
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
    line_count: cleanText(match[1]),
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

function chooseProjectedMessageText(existingText, incomingText, { preserveWhitespace = false } = {}) {
  if (shouldPreferIncomingPastedBody(existingText, incomingText)) {
    return cleanMessageText(incomingText);
  }

  if (shouldPreferIncomingPastedBody(incomingText, existingText)) {
    return cleanMessageText(existingText);
  }

  return preserveWhitespace ? cleanLiveMessageText(incomingText) : cleanMessageText(incomingText);
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
  const messageId = cleanText(event?.message_id || event?.id).toLowerCase();
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

  const rawDeliveryMode = cleanText(value.delivery_mode || value.mode).toLowerCase();
  const deliveryMode = rawDeliveryMode === "provider-api"
    || rawDeliveryMode === "terminal-confirmed"
    || rawDeliveryMode === "session-acceptance"
    ? rawDeliveryMode
    : "terminal";

  return {
    created_at: cleanText(value.created_at, nowIso()),
    delivery_mode: deliveryMode,
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
    record?.terminal_nickname,
    record?.terminal_name,
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

  const excludeThreadId = cleanText(options.excludeThreadId || options.thread_id);
  const excludeTerminalKey = terminalSessionKey(options.excludeTerminalIndex ?? options.terminal_index);

  return Object.entries(entry?.terminals || {}).some(([terminalKey, terminal]) => {
    if (excludeTerminalKey && terminalKey === excludeTerminalKey) {
      return false;
    }
    if (excludeThreadId && cleanText(terminal?.thread_id) === excludeThreadId) {
      return false;
    }
    return terminalNicknameKey(workspaceTerminalNicknameFromRecord(terminal)) === key;
  }) || Object.values(entry?.threads || {}).some((thread) => {
    if (!thread || (excludeThreadId && cleanText(thread.id) === excludeThreadId)) {
      return false;
    }
    const threadTerminalKey = terminalSessionKey(getThreadTerminalIndex(thread));
    const mappedThreadId = threadTerminalKey ? cleanText(entry?.terminal_thread_ids?.[threadTerminalKey]) : "";
    const activeThreadId = threadTerminalKey ? cleanText(entry?.terminals?.[threadTerminalKey]?.thread_id) : "";
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
    terminal?.terminal_nickname,
    terminal?.terminal_name,
    terminal?.display_name,
    thread?.terminal_nickname,
    thread?.terminal_name,
    thread?.display_name,
    providerBinding?.terminal_nickname,
    providerBinding?.terminal_name,
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
  const terminalIndex = normalizeTerminalIndex(thread?.terminal_index);
  if (terminalIndex != null) {
    return terminalIndex;
  }

  return normalizeTerminalIndex(thread?.terminal_binding?.terminal_index);
}

function getThreadRestoreTimestamp(thread) {
  return [
    thread?.last_active_at,
    thread?.last_message_at,
    thread?.updated_at,
    thread?.created_at,
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
        || source.thread_id
        || fallback.selectedThreadId
        || fallback.thread_id,
    ),
    selected_workspace_id: cleanText(
      source.selected_workspace_id
        || source.workspace_id
        || fallback.selected_workspace_id
        || fallback.workspace_id,
    ),
  };
}

function rememberTerminalThread(entry, terminalIndex, threadId) {
  const key = terminalSessionKey(terminalIndex);
  const safeThreadId = cleanText(threadId);
  if (!key || !safeThreadId || !entry?.threads?.[safeThreadId]) {
    return false;
  }

  if (!entry.terminal_thread_ids || typeof entry.terminal_thread_ids !== "object") {
    entry.terminal_thread_ids = {};
  }

  if (entry.terminal_thread_ids[key] === safeThreadId) {
    return false;
  }

  entry.terminal_thread_ids[key] = safeThreadId;
  return true;
}

function forgetTerminalThread(entry, terminalIndex, threadId = "") {
  const key = terminalSessionKey(terminalIndex);
  if (!key || !entry?.terminal_thread_ids?.[key]) {
    return false;
  }

  const safeThreadId = cleanText(threadId);
  if (safeThreadId && entry.terminal_thread_ids[key] !== safeThreadId) {
    return false;
  }

  delete entry.terminal_thread_ids[key];
  return true;
}

function forgetThreadEverywhere(entry, threadId) {
  const safeThreadId = cleanText(threadId);
  if (!safeThreadId || !entry?.terminal_thread_ids) {
    return false;
  }

  let changed = false;
  Object.entries(entry.terminal_thread_ids).forEach(([terminalKey, mappedThreadId]) => {
    if (mappedThreadId === safeThreadId) {
      delete entry.terminal_thread_ids[terminalKey];
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

  const turnId = cleanText(value.turn_id || value.id);
  const state = normalizeThreadTurnState(value.state || value.status || value.turn_state);
  if (!turnId || !state) {
    return null;
  }

  const requestedAt = cleanText(value.requested_at || value.created_at);
  const startedAt = cleanText(value.started_at || requestedAt);
  const completedAt = cleanText(value.completed_at);
  const updatedAt = cleanText(value.updated_at || completedAt || startedAt || requestedAt, nowIso());

  return {
    agent_id: cleanAgentId(value.agent_id, ""),
    assistant_message_id: cleanText(value.assistant_message_id),
    completed_at: completedAt,
    error: cleanText(value.error || value.message),
    message_id: cleanText(value.message_id),
    prompt_epoch: normalizeThreadPromptEpoch(value.prompt_epoch),
    requested_at: requestedAt,
    started_at: startedAt,
    state,
    turn_id: turnId,
    updated_at: updatedAt,
  };
}

function createTurnIdForMessage(thread, messageId) {
  return [
    "turn",
    safeKey(thread?.id || thread?.thread_id || "thread"),
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
    event.activity_status || event.native_rail_state || event.terminal_work_state,
  );
  if (!rawStatus) {
    return fallback;
  }
  return normalizeThreadActivityStatus(rawStatus, fallback);
}

function providerBindingsHaveNativeSession(providerBindings) {
  return Object.values(providerBindings || {}).some((binding) => (
    Boolean(cleanText(binding?.native_session_id))
  ));
}

function pendingPromptTurnHasInputReady({
  activity_status: activityStatus = "",
  latest_turn: latestTurn = null,
  pending_prompt: pendingPrompt = null,
  providerBinding = null,
} = {}) {
  const latestTurnState = cleanText(latestTurn?.state).toLowerCase();
  return Boolean(
    latestTurnState === "running"
      && pendingPrompt
      && normalizeThreadActivityStatus(activityStatus) === "idle"
      && providerBinding?.input_ready === true
  );
}

function isOrphanRunningThreadState({
  latest_turn: latestTurn,
  message_count: messageCount = 0,
  messages = [],
  pending_prompt: pendingPrompt = null,
  projection_events: projectionEvents = [],
  provider_bindings: providerBindings = {},
  transcript_session_id: transcriptSessionId = "",
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
        activity_status: "idle",
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
  const rawText = message.text ?? message.message;
  const text = safeRole === "user"
    ? normalizeAttachmentEchoText(rawText)
    : safeRole === "assistant"
      ? cleanLiveMessageText(rawText)
      : cleanMessageText(rawText);
  const artifacts = normalizeThreadArtifacts(message.artifacts || message.attachments);
  const toolMetadata = normalizeThreadToolMetadata(message);
  const structuredMetadata = normalizeThreadStructuredTranscriptMetadata(message);
  const title = cleanText(message.title);
  const status = cleanText(message.status, "submitted");
  const projectionHash = getThreadMessageProjectionHash(message);
  const isTurnCompleteMessage = safeRole === "assistant"
    && (
      kind === "task_complete"
      || kind === "final_answer"
      || status.toLowerCase() === "task_complete"
    );
  const hasToolMetadata = safeRole === "activity" && threadToolMetadataHasContent(toolMetadata);
  const hasStructuredMetadata = Object.keys(structuredMetadata).length > 0;
  const hasActivityTitle = safeRole === "activity" && Boolean(title);
  if (
    !id
    || (!text && !isTurnCompleteMessage && !artifacts.length && !hasToolMetadata && !hasStructuredMetadata && !hasActivityTitle)
    || kind === "live_output"
    || source === "terminal-live"
    || (safeRole === "user" && isTerminalArtifactMessage(message.text || message.message))
  ) {
    return null;
  }

  const normalizedMessage = {
    agent_id: cleanAgentId(message.agent_id, ""),
    artifacts,
    call_id: cleanText(message.call_id),
    created_at: cleanText(message.created_at, nowIso()),
    id,
    kind: kind || (safeRole === "activity" ? "activity" : "message"),
    role: safeRole,
    source,
    status,
    text,
    title,
    turn_id: cleanText(message.turn_id),
    ...structuredMetadata,
    ...toolMetadata,
  };

  return attachThreadMessageProjectionHash(normalizedMessage, projectionHash);
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

function compactPersistedThreadText(value, { preserveWhitespace = false } = {}) {
  const text = preserveWhitespace ? cleanLiveMessageText(value) : cleanMessageText(value);
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
        if (["tool_name", "tool_server", "tool_display_name", "command", "file_path"].includes(key)) {
          return [key, key === "command" ? compactPersistedThreadText(entry) : cleanText(entry)];
        }
        if (key === "duration_ms" || key === "exit_code") {
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

  const persistedMessage = {
    ...normalizedMessage,
    text: compactPersistedThreadText(normalizedMessage.text, {
      preserveWhitespace: normalizedMessage.role === "assistant",
    }),
    ...compactPersistedThreadToolMetadata(normalizedMessage),
  };
  const projectionHash = getThreadMessageProjectionHash(normalizedMessage)
    || threadMessageProjectionHash(persistedMessage);

  return attachThreadMessageProjectionHash(persistedMessage, projectionHash, {
    enumerable: true,
  });
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

const THREAD_MESSAGE_PROJECTION_HASH_PATTERN = /^[a-z0-9]{1,16}$/;

function normalizeThreadProjectionHash(value) {
  const hash = cleanText(value).toLowerCase();
  return THREAD_MESSAGE_PROJECTION_HASH_PATTERN.test(hash) ? hash : "";
}

function getThreadMessageProjectionHash(message) {
  if (!message || typeof message !== "object") {
    return "";
  }

  return normalizeThreadProjectionHash(
    message.projection_hash || message.stable_projection_hash,
  );
}

function attachThreadMessageProjectionHash(message, hash, options = {}) {
  if (!message || typeof message !== "object") {
    return message;
  }
  const safeHash = normalizeThreadProjectionHash(hash);
  if (!safeHash) {
    return message;
  }

  try {
    Object.defineProperty(message, "projection_hash", {
      configurable: true,
      enumerable: options.enumerable === true,
      value: safeHash,
      writable: true,
    });
  } catch {
    message.projection_hash = safeHash;
  }
  return message;
}

function threadMessageProjectionHash(message) {
  const id = cleanText(message?.id, createRandomId("message"));
  const text = cleanMessageText(message?.text);
  const artifacts = threadArtifactsSignature(message?.artifacts);
  const toolMetadata = JSON.stringify(normalizeThreadToolMetadata(message));
  const structuredMetadata = JSON.stringify(normalizeThreadStructuredTranscriptMetadata(message));
  return stableProjectionHash(`${id}:${message?.role || ""}:${message?.kind || ""}:${text}:${artifacts}:${toolMetadata}:${structuredMetadata}`);
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

  const turnId = cleanText(event.turn_id);
  const messageId = cleanText(
    event.message_id
      || (isTurnProjectionEventType(type) ? turnId : "")
      || event.id,
  );
  const isAssistantTextEvent = type === "thread.message.assistant.delta"
    || type === "thread.message.assistant.complete";
  const delta = isAssistantTextEvent
    ? cleanLiveMessageText(event.delta)
    : cleanMessageText(event.delta);
  const rawText = event.text ?? event.message;
  const text = type === "thread.message.user"
    ? normalizeAttachmentEchoText(rawText)
    : isAssistantTextEvent
      ? cleanLiveMessageText(rawText)
      : cleanMessageText(rawText);
  const title = cleanText(event.title);
  const artifacts = normalizeThreadArtifacts(event.artifacts || event.attachments);
  const toolMetadata = normalizeThreadToolMetadata(event);
  const structuredMetadata = normalizeThreadStructuredTranscriptMetadata(event);
  const hasToolMetadata = isActivityProjectionEventType(type)
    && threadToolMetadataHasContent(toolMetadata);
  const hasStructuredMetadata = Object.keys(structuredMetadata).length > 0;
  if (
    (!messageId || (isTurnProjectionEventType(type) && !(turnId || messageId)))
    || (
      !text
      && !delta
      && !artifacts.length
      && !title
      && !hasToolMetadata
      && !hasStructuredMetadata
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
    event.id || event.event_id,
    `projection-${messageId}-${type}-${Number.isInteger(sequence) ? sequence : fallbackSequence}`,
  );

  return {
    agent_id: cleanAgentId(event.agent_id, ""),
    artifacts,
    call_id: cleanText(event.call_id),
    created_at: cleanText(event.created_at, nowIso()),
    completed_at: cleanText(event.completed_at),
    delta,
    id,
    kind,
    message_id: messageId,
    assistant_message_id: cleanText(event.assistant_message_id),
    prompt_epoch: normalizeThreadPromptEpoch(event.prompt_epoch),
    replace_text: event.replace_text === true,
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
    turn_id: turnId || (isTurnProjectionEventType(type) ? messageId : ""),
    type,
    ...structuredMetadata,
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
  const preserveAssistantWhitespace = normalizedEvent.type === "thread.message.assistant.delta"
    || normalizedEvent.type === "thread.message.assistant.complete";

  return {
    ...normalizedEvent,
    delta: compactPersistedThreadText(normalizedEvent.delta, {
      preserveWhitespace: preserveAssistantWhitespace,
    }),
    text: compactPersistedThreadText(normalizedEvent.text, {
      preserveWhitespace: preserveAssistantWhitespace,
    }),
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
    text: chooseProjectedMessageText(existingMessage?.text, normalizedMessage.text, {
      preserveWhitespace: normalizedMessage.role === "assistant",
    }),
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
        agent_id: event.agent_id,
        artifacts: event.artifacts,
        created_at: event.created_at,
        id: event.message_id,
        kind: event.type === "thread.message.system" ? event.kind || "message" : "message",
        role: event.type === "thread.message.system" ? "system" : "user",
        source: event.source || "projection",
        status: event.status || "submitted",
        text: event.text || event.delta,
        turn_id: event.turn_id,
        ...normalizeThreadStructuredTranscriptMetadata(event),
      });
      return;
    }

    if (event.type === "thread.message.assistant.delta") {
      const existing = messagesById.get(event.message_id);
      const eventText = event.replace_text
        ? event.text || event.delta
        : `${existing?.text || ""}${event.delta || event.text}`;
      if (
        isTurnCompleteProjectionEvent(event)
        && projectedMessagesHaveAssistantText(messagesById, messageOrder, eventText)
      ) {
        return;
      }
      upsertProjectedMessage(messagesById, messageOrder, {
        agent_id: event.agent_id,
        artifacts: event.artifacts,
        created_at: event.created_at,
        id: event.message_id,
        kind: event.kind || "message",
        role: "assistant",
        source: event.source || "projection",
        status: "streaming",
        text: eventText,
        turn_id: event.turn_id,
        ...normalizeThreadStructuredTranscriptMetadata(event),
      });
      return;
    }

    if (event.type === "thread.message.assistant.complete") {
      const existing = messagesById.get(event.message_id);
      if (!existing && !(event.text || event.delta || event.artifacts?.length)) {
        return;
      }

      const eventText = event.replace_text || !existing?.text
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
        agent_id: event.agent_id || existing?.agent_id || "",
        artifacts: mergeThreadArtifacts(existing?.artifacts, event.artifacts),
        created_at: event.created_at || existing?.created_at,
        id: event.message_id,
        kind: event.kind || existing?.kind || "message",
        role: "assistant",
        source: event.source || existing?.source || "projection",
        status: "complete",
        text: eventText,
        turn_id: event.turn_id || existing?.turn_id || "",
        ...normalizeThreadStructuredTranscriptMetadata(event),
      });
      return;
    }

    if (isActivityProjectionEventType(event.type)) {
      upsertProjectedMessage(messagesById, messageOrder, {
        agent_id: event.agent_id,
        artifacts: event.artifacts,
        call_id: event.call_id,
        created_at: event.created_at,
        id: event.message_id,
        kind: event.kind || "activity",
        role: "activity",
        source: event.source || "projection",
        status: event.status || "complete",
        text: event.text || event.delta,
        title: event.title,
        turn_id: event.turn_id,
        ...normalizeThreadStructuredTranscriptMetadata(event),
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
  const hash = getThreadMessageProjectionHash(message) || threadMessageProjectionHash(message);
  return [
    prefix,
    safeKey(id, "message"),
    hash,
    suffix,
  ].filter(Boolean).join("-");
}

function projectionEventsFromMessages(messages, options = {}) {
  const agentId = cleanAgentId(options.agent_id, "");
  const source = cleanText(options.source, "projection-bootstrap");
  const events = [];
  normalizeThreadMessages(messages).forEach((message) => {
    const messageId = cleanText(message.id, createRandomId("message"));
    const base = {
      agent_id: message.agent_id || agentId,
      artifacts: message.artifacts,
      call_id: message.call_id,
      created_at: message.created_at,
      kind: message.kind,
      message_id: messageId,
      source: message.source || source,
      text: message.text,
      title: message.title,
      turn_id: message.turn_id,
      ...normalizeThreadStructuredTranscriptMetadata(message),
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
  const existingProjectionEvents = normalizeThreadProjectionEvents(thread?.projection_events);
  if (existingProjectionEvents.length) {
    return existingProjectionEvents;
  }

  return normalizeThreadProjectionEvents(
    projectionEventsFromMessages(thread?.messages, {
      agent_id: thread?.current_agent,
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
    event.type === type && event.turn_id === safeTurnId
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
    created_at: event.expected_message_created_at
      || event.prompt_event_submitted_at
      || event.submitted_at
      || event.created_at,
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

  if (event.prompt_accepted !== true) {
    return "";
  }

  const matchedBy = cleanText(event.matched_by).toLowerCase();
  const canUseTimestampRecovery = Boolean(
    event.allow_timestamp_fallback === true
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
    created_at: fallbackTurn?.updated_at || fallbackTurn?.completed_at || fallbackTurn?.started_at || fallbackTurn?.requested_at,
  });
  let latestTurn = fallbackTurn;
  const closedTurnIds = new Set();

  projectionEvents.forEach((event) => {
    const turnId = cleanText(event.turn_id);
    if (!turnId) {
      return;
    }
    const eventTimestampMs = threadMessageTimestampMs({
      created_at: event.completed_at || event.created_at,
    });
    const isOlderDifferentTurnThanFallback = Boolean(
      fallbackTurn
        && fallbackTurnUpdatedAtMs
        && eventTimestampMs
        && eventTimestampMs < fallbackTurnUpdatedAtMs
        && cleanText(fallbackTurn.turn_id) !== turnId
    );

    if (
      event.type === "thread.turn.started"
      && (
        isOlderDifferentTurnThanFallback
        || (
        closedTurnIds.has(turnId)
        || (
          latestTurn?.turn_id === turnId
          && CLOSED_THREAD_TURN_STATES.has(latestTurn?.state)
        )
        )
      )
    ) {
      return;
    }

    if (event.type === "thread.turn.started") {
      latestTurn = normalizeThreadLatestTurn({
        agent_id: event.agent_id,
        message_id: event.message_id,
        prompt_epoch: event.prompt_epoch,
        requested_at: event.created_at,
        started_at: event.created_at,
        state: "running",
        turn_id: turnId,
        updated_at: event.created_at,
      });
      return;
    }

    if (!latestTurn || latestTurn.turn_id !== turnId) {
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
        assistant_message_id: event.message_id || latestTurn.assistant_message_id,
        updated_at: event.created_at,
      });
      return;
    }

    if (isActivityProjectionEventType(event.type)) {
      latestTurn = normalizeThreadLatestTurn({
        ...latestTurn,
        updated_at: event.created_at,
      });
      return;
    }

    if (event.type === "thread.turn.completed") {
      closedTurnIds.add(turnId);
      latestTurn = normalizeThreadLatestTurn({
        ...latestTurn,
        assistant_message_id: event.assistant_message_id || latestTurn.assistant_message_id,
        completed_at: event.completed_at || event.created_at,
        state: "completed",
        updated_at: event.completed_at || event.created_at,
      });
      return;
    }

    if (event.type === "thread.turn.error") {
      closedTurnIds.add(turnId);
      latestTurn = normalizeThreadLatestTurn({
        ...latestTurn,
        completed_at: event.completed_at || event.created_at,
        error: event.text || latestTurn.error,
        state: "error",
        updated_at: event.completed_at || event.created_at,
      });
      return;
    }

    if (event.type === "thread.turn.interrupted") {
      closedTurnIds.add(turnId);
      latestTurn = normalizeThreadLatestTurn({
        ...latestTurn,
        completed_at: event.completed_at || event.created_at,
        state: "interrupted",
        updated_at: event.completed_at || event.created_at,
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
  const callId = cleanText(message?.call_id);

  if (messageId) {
    const exactMatch = projectedMessages.find((candidate) => cleanText(candidate.id) === messageId);
    if (exactMatch) {
      return exactMatch;
    }
  }

  if (callId) {
    const callMatch = projectedMessages.find((candidate) => (
      cleanText(candidate.call_id) === callId
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

function findMatchingLiveHookAssistantMessage(projectedMessages, {
  messageTurnId = "",
  promptMessageId = "",
} = {}) {
  const safeTurnId = cleanText(messageTurnId);
  const safePromptMessageId = cleanText(promptMessageId);
  return [...(Array.isArray(projectedMessages) ? projectedMessages : [])]
    .reverse()
    .find((candidate) => {
      if (
        candidate?.role !== "assistant"
        || !isLiveHookProjectionSource(candidate.source)
        || !cleanMessageText(candidate.text)
      ) {
        return false;
      }
      const candidateTurnId = cleanText(candidate.turn_id);
      if (!safeTurnId || !candidateTurnId) {
        return true;
      }
      return projectionTurnIdsMatchPrompt(
        candidateTurnId,
        safeTurnId,
        safePromptMessageId,
      );
    }) || null;
}

function createSubmittedUserProjectionEvents(thread, event = {}) {
  const text = cleanSubmittedUserMessage(
    event.expected_user_message
      || event.terminal_text
      || event.terminal_message
      || event.user_message
      || event.message,
  );
  if (!text || isSlashCommandPrompt(text)) {
    return [];
  }

  const promptEventId = cleanText(event.prompt_event_id || event.pending_prompt_id || event.prompt_id);
  const createdAt = cleanText(
    event.message_created_at
      || event.prompt_event_submitted_at
      || event.submitted_at,
    nowIso(),
  );
  const messageId = cleanText(
    event.message_id || promptEventId,
    createRandomId(`message-${safeKey(thread?.id, "thread")}`),
  );
  const turnId = cleanText(event.turn_id, createTurnIdForMessage(thread, messageId));
  const agentId = cleanAgentId(event.agent_id || event.current_agent, "");
  const source = cleanText(event.source || event.message_source, "local-submit");
  const promptEpoch = normalizeThreadPromptEpoch(event.prompt_epoch);
  return [{
    agent_id: agentId,
    created_at: createdAt,
    id: `projection-turn-started-${stableProjectionKey(turnId, "turn")}`,
    message_id: messageId,
    prompt_epoch: promptEpoch,
    source,
    status: "running",
    turn_id: turnId,
    type: "thread.turn.started",
  }, {
    agent_id: agentId,
    created_at: createdAt,
    id: `projection-user-submitted-${stableProjectionKey(messageId, "message")}`,
    message_id: messageId,
    prompt_epoch: promptEpoch,
    role: "user",
    source,
    status: "submitted",
    text,
    turn_id: turnId,
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
  const liveTextKind = cleanText(event.live_text_kind, "assistant")
    .toLowerCase();
  if (liveTextKind !== "assistant") {
    return [];
  }

  const deltaValue = firstPresentTextValue([
    event.live_text_delta,
    event.assistant_delta,
  ]);
  const snapshotValue = firstPresentTextValue([
    event.live_text_snapshot,
    event.assistant_message_snapshot,
    event.assistant_message,
  ]);
  const delta = cleanLiveMessageText(deltaValue);
  const snapshot = cleanLiveMessageText(snapshotValue);
  if (!delta && !snapshot) {
    return [];
  }

  const latestTurn = normalizeThreadLatestTurn(thread?.latest_turn);
  const promptMessageId = cleanText(
    event.prompt_event_id || event.pending_prompt_id || event.prompt_id || event.message_id || latestTurn?.message_id,
  );
  const liveSessionId = cleanText(
    event.provider_session_id || event.native_session_id || event.session_id || thread?.transcript_session_id,
  );
  const turnId = cleanText(
    event.turn_id
      || event.provider_turn_id
      || latestTurn?.turn_id
      || (promptMessageId ? createTurnIdForMessage(thread, promptMessageId) : "")
      || (liveSessionId ? `turn-live-${stableProjectionKey(liveSessionId, "session")}` : ""),
  );
  const messageId = cleanText(
    event.assistant_message_id || latestTurn?.assistant_message_id,
    turnId
      ? `assistant-${stableProjectionKey(turnId, "turn")}`
      : createRandomId("assistant-live"),
  );
  const existingAssistantTextLength = cleanLiveMessageText(
    normalizeThreadMessages(thread?.messages)
      .find((message) => message.role === "assistant" && message.id === messageId)
      ?.text,
  ).length;
  const liveTextEventKey = cleanText(
    event.live_text_event_id || event.event_id || event.id || event.sequence || event.seq || event.status_seq,
    `live-${++liveTextProjectionEventSequence}`,
  );
  const createdAt = cleanText(
    event.completed_at
      || event.input_ready_at
      || event.hook_observed_at
      || event.created_at
      || event.started_at,
    nowIso(),
  );
  const agentId = cleanAgentId(event.agent_id || event.current_agent || thread?.current_agent, "");
  const source = cleanText(event.source || event.type, "cli-hook:assistant-message");
  const promptEpoch = normalizeThreadPromptEpoch(
    event.prompt_epoch || latestTurn?.prompt_epoch,
  );
  const finalTurnType = liveTextFinalTurnType(event.type || event.event_type);
  const finalText = snapshot || delta;
  const events = [];

  if (delta) {
    events.push({
      agent_id: agentId,
      created_at: createdAt,
      delta,
      id: [
        "projection-live-assistant-delta",
        safeKey(messageId, "message"),
        existingAssistantTextLength,
        safeKey(liveTextEventKey, "event"),
        delta.length,
        stableProjectionHash(`${turnId}:${existingAssistantTextLength}:${liveTextEventKey}:${delta}`),
      ].join("-"),
      message_id: messageId,
      prompt_epoch: promptEpoch,
      source,
      status: "streaming",
      turn_id: turnId,
      type: "thread.message.assistant.delta",
    });
  }

  if (snapshot) {
    events.push({
      agent_id: agentId,
      created_at: createdAt,
      id: [
        "projection-live-assistant-snapshot",
        safeKey(messageId, "message"),
        snapshot.length,
        stableProjectionHash(`${turnId}:${snapshot}`),
      ].join("-"),
      message_id: messageId,
      prompt_epoch: promptEpoch,
      replace_text: true,
      source,
      status: "streaming",
      text: snapshot,
      turn_id: turnId,
      type: "thread.message.assistant.delta",
    });
  }

  if (finalTurnType && finalText) {
    events.push({
      agent_id: agentId,
      created_at: createdAt,
      id: [
        "projection-live-assistant-complete",
        safeKey(messageId, "message"),
        finalText.length,
        stableProjectionHash(`${turnId}:${finalText}`),
      ].join("-"),
      message_id: messageId,
      prompt_epoch: promptEpoch,
      replace_text: true,
      source,
      status: "complete",
      text: finalText,
      turn_id: turnId,
      type: "thread.message.assistant.complete",
    });
  }

  if (finalTurnType && turnId) {
    events.push({
      agent_id: agentId,
      assistant_message_id: messageId,
      completed_at: createdAt,
      created_at: createdAt,
      id: [
        "projection-live-turn-finished",
        stableProjectionKey(turnId, "turn"),
        finalTurnType.replace(/^thread\.turn\./, ""),
      ].join("-"),
      message_id: messageId,
      prompt_epoch: promptEpoch,
      source,
      status: finalTurnType.replace(/^thread\.turn\./, ""),
      text: finalTurnType === "thread.turn.error"
        ? cleanMessageText(event.error || event.message || finalText)
        : "",
      turn_id: turnId,
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
  const explicit = cleanText(metadata.tool_display_name);
  if (explicit) {
    return explicit;
  }
  const rawName = cleanText(metadata.tool_name);
  const server = cleanText(metadata.tool_server);
  const mcpMatch = /^mcp_{2,}(.+?)_{2,}(.+)$/.exec(rawName);
  if (mcpMatch) {
    return `${mcpMatch[1].replace(/_/g, "-")} / ${mcpMatch[2]}`;
  }
  if (server && rawName && !rawName.toLowerCase().startsWith(`${server.toLowerCase()}.`)) {
    return `${server} / ${rawName}`;
  }
  return rawName || cleanText(metadata.command) || cleanText(metadata.file_path);
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
  if (threadToolValueHasContent(metadata.tool_error)) {
    return typeof metadata.tool_error === "string" ? metadata.tool_error : JSON.stringify(metadata.tool_error, null, 2);
  }
  if (threadToolValueHasContent(metadata.tool_output)) {
    return typeof metadata.tool_output === "string" ? metadata.tool_output : JSON.stringify(metadata.tool_output, null, 2);
  }
  return "";
}

export function createWorkspaceThreadToolProjectionEvents(thread, event = {}) {
  const eventType = normalizeProviderToolEventType(event.type || event.event_type);
  if (![
    "provider-tool-started",
    "provider-tool-completed",
    "provider-tool-failed",
    "provider-tool-batch-completed",
  ].includes(eventType)) {
    return [];
  }

  const latestTurn = normalizeThreadLatestTurn(thread?.latest_turn);
  const promptMessageId = cleanText(
    event.prompt_event_id || event.pending_prompt_id || event.prompt_id || event.message_id || latestTurn?.message_id,
  );
  const turnId = cleanText(
    event.turn_id || event.provider_turn_id || latestTurn?.turn_id || promptMessageId ? createTurnIdForMessage(thread, promptMessageId) : "",
  );
  const agentId = cleanAgentId(event.agent_id || event.current_agent || thread?.current_agent, "");
  const createdAt = cleanText(
    event.completed_at
      || event.input_ready_at
      || event.hook_observed_at
      || event.created_at
      || event.started_at,
    nowIso(),
  );
  const metadata = normalizeThreadToolMetadata(event);
  const callId = cleanText(
    event.call_id || event.tool_use_id,
  );
  const messagePhase = providerToolEventKind(eventType) === "tool_call" ? "call" : "output";
  const explicitMessageId = cleanText(event.message_id);
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
    event.prompt_epoch || latestTurn?.prompt_epoch,
  );
  const title = providerToolProjectionTitle(eventType, metadata, event);
  const text = providerToolProjectionText(eventType, metadata, event);
  const status = providerToolProjectionStatus(eventType, event.status);

  if (!turnId && !callId && !threadToolMetadataHasContent(metadata) && !title && !text) {
    return [];
  }

  return [{
    agent_id: agentId,
    call_id: callId,
    created_at: createdAt,
    id: [
      "projection-live-tool",
      safeKey(messageId, "message"),
      stableProjectionHash(`${eventType}:${turnId}:${callId}:${title}:${text}:${JSON.stringify(metadata)}:${status}`),
    ].join("-"),
    kind: providerToolEventKind(eventType),
    message_id: messageId,
    prompt_epoch: promptEpoch,
    source: cleanText(event.source || eventType, `cli-hook:${eventType}`),
    status,
    text,
    title,
    turn_id: turnId,
    type: providerToolProjectionType(eventType),
    ...metadata,
  }];
}

function createProjectionEventsFromTranscript(thread, incomingMessages, event = {}) {
  const agentId = cleanAgentId(event.agent_id || event.current_agent || thread?.current_agent, "");
  const source = transcriptHistoryProjectionSource(agentId, event.source);
  const preferLiveHookAssistantMessages = event.prefer_live_hook_assistant_messages === true;
  const promptEventId = cleanText(event.prompt_event_id || event.pending_prompt_id || event.prompt_id);
  const promptEpoch = normalizeThreadPromptEpoch(event.prompt_epoch);
  const expectedUserMessage = cleanSubmittedUserMessage(
    event.expected_user_message
      || event.user_message
      || event.message,
  );
  const normalizedIncomingMessages = normalizeThreadMessages(incomingMessages);
  const expectedPromptTranscriptMessageId = transcriptExpectedPromptMessageId(
    normalizedIncomingMessages,
    event,
    expectedUserMessage,
  );
  let projectionEvents = ensureThreadProjectionEvents(thread);
  const liveHookProjectedMessages = projectThreadProjectionMessagesFromNormalizedEvents(
    projectionEvents.filter(isLiveHookProjectionEvent),
    [],
  );
  let projectedMessages = projectThreadProjectionMessagesFromNormalizedEvents(
    projectionEvents.filter((projectionEvent) => (
      isTranscriptHistoryProjectionEvent(projectionEvent)
        || (preferLiveHookAssistantMessages && isLiveHookProjectionEvent(projectionEvent))
    )),
    [],
  );
  const events = [];
  const latestTurn = normalizeThreadLatestTurn(thread?.latest_turn);
  const runningLatestTurnId = latestTurn?.state === "running" ? cleanText(latestTurn.turn_id) : "";
  const expectedPromptTurnId = promptEventId ? createTurnIdForMessage(thread, promptEventId) : "";
  const promptAccepted = event.prompt_accepted === true;
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
            cleanText(latestTurn?.message_id) === promptEventId
            || runningLatestTurnId.includes(promptEventId)
            || cleanText(latestUserMessage?.id) === promptEventId
          )
        )
        || latestUserMessageMatchesExpectedPrompt
      )
  );
  const allowTranscriptTurnCompletion = event.allow_transcript_turn_completion === true
    || event.transcript_completion_can_settle_turn === true;
  const assistantResponseCompletesTurn = event.assistant_response_completes_turn === true;
  const transcriptTurnCompleteSeen = Boolean(
    event.turn_complete_seen === true
      || (
        event.transcript_explicit_completion_can_settle_turn === true
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
    const createdAt = cleanText(message.created_at, nowIso());
    const isExpectedPromptUserMessage = Boolean(
      expectedPromptTranscriptMessageId
        && message.role === "user"
        && messageId === expectedPromptTranscriptMessageId,
    );
    const expectedPromptTurnForMessage = isExpectedPromptUserMessage
      ? runningLatestTurnId || expectedPromptTurnId
      : "";
    const expectedAssistantTurnForMessage = message.role === "assistant" && !currentTurnId
      ? runningLatestTurnId || expectedPromptTurnId
      : "";
    const incomingMessageTurnId = cleanText(message.turn_id);
    const shouldContinueCurrentTranscriptTurn = Boolean(message.role !== "user" && currentTurnId);
    const messageArtifacts = normalizeThreadArtifacts(message.artifacts);
    const messageArtifactsSignature = threadArtifactsSignature(messageArtifacts);
    const messageTurnId = cleanText(
      (shouldContinueCurrentTranscriptTurn ? currentTurnId : "")
        || expectedPromptTurnForMessage
        || expectedAssistantTurnForMessage
        || projectedMessage?.turn_id
        || incomingMessageTurnId
        || currentTurnId
        || createTurnIdForMessage(thread, messageId),
    );
    const eventBase = {
      agent_id: message.agent_id || agentId,
      artifacts: messageArtifacts,
      call_id: message.call_id,
      created_at: createdAt,
      kind: message.kind,
      message_id: messageId,
      prompt_epoch: promptEpoch,
      source,
      title: message.title,
      turn_id: messageTurnId,
      ...normalizeThreadStructuredTranscriptMetadata(message),
      ...normalizeThreadToolMetadata(message),
    };

    if (message.role === "user") {
      if (isSlashCommandPrompt(message.text)) {
        return;
      }
      currentTurnId = cleanText(
        expectedPromptTurnForMessage
          || projectedMessage?.turn_id
          || incomingMessageTurnId
          || createTurnIdForMessage(thread, messageId),
      );
      transcriptAdvancedTurn = true;
      eventBase.turn_id = currentTurnId;
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
      const nextText = cleanLiveMessageText(message.text);
      const turnComplete = isTranscriptTurnCompleteMessage(message);
      const liveHookAssistantMessage = preferLiveHookAssistantMessages
        ? liveHookProjectedMessages.find((candidate) => (
          candidate?.role === "assistant"
          && candidate.status === "complete"
          && isLiveHookProjectionSource(candidate.source)
          && cleanMessageText(candidate.text)
          && projectionTurnIdsMatchPrompt(
            candidate.turn_id,
            messageTurnId,
            promptEventId || expectedPromptTranscriptMessageId,
          )
        ))
        : null;
      const liveHookAssistantTarget = liveHookAssistantMessage
        || findMatchingLiveHookAssistantMessage(projectedMessages, {
          messageTurnId,
          promptMessageId: promptEventId || expectedPromptTranscriptMessageId,
        })
        || findMatchingLiveHookAssistantMessage(liveHookProjectedMessages, {
          messageTurnId,
          promptMessageId: promptEventId || expectedPromptTranscriptMessageId,
        });
      if (!nextText && !messageArtifacts.length) {
        if (
          allowTranscriptTurnCompletion
          && turnComplete
          && messageTurnId
          && !projectionHasTurnEvent(projectionEvents, "thread.turn.completed", messageTurnId)
        ) {
          events.push({
            ...eventBase,
            completed_at: createdAt,
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
            assistant_message_id: liveHookAssistantMessage.id,
            completed_at: createdAt,
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
          && (!messageTurnId || candidate.turn_id === messageTurnId)
          && cleanLiveMessageText(candidate.text) === nextText
        ))
        : null;
      const messageProjectionTarget = duplicateFinalAssistant || projectedMessage || liveHookAssistantTarget;
      const shouldProjectAssistant = !duplicateFinalAssistant;
      const effectivePreviousText = cleanLiveMessageText(messageProjectionTarget?.text);
      const projectionArtifactsChanged = messageArtifactsSignature
        && threadArtifactsSignature(messageProjectionTarget?.artifacts) !== messageArtifactsSignature;
      const assistantEventBase = liveHookAssistantTarget && !duplicateFinalAssistant
        ? {
          ...eventBase,
          message_id: liveHookAssistantTarget.id,
          turn_id: messageTurnId || liveHookAssistantTarget.turn_id,
        }
        : eventBase;
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
          ...assistantEventBase,
          delta: replaceText ? "" : delta || nextText,
          id: [
            "projection-assistant-delta",
            safeKey(assistantEventBase.message_id, "message"),
            nextText.length,
          stableProjectionHash(`${nextText}:${messageArtifactsSignature}`),
        ].join("-"),
        replace_text: replaceText,
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
          ...assistantEventBase,
          id: [
            "projection-assistant-complete",
            safeKey(assistantEventBase.message_id, "message"),
            nextText.length,
            stableProjectionHash(`${nextText}:${messageArtifactsSignature}`),
          ].join("-"),
          replace_text: true,
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
          assistant_message_id: duplicateFinalAssistant?.id || liveHookAssistantTarget?.id || messageId,
          completed_at: createdAt,
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
          completed_at: createdAt,
          id: `projection-provider-turn-error-${stableProjectionKey(messageTurnId, "turn")}-${stableProjectionKey(messageId, "message")}`,
          status: "error",
          text: message.text,
          type: "thread.turn.error",
        });
      }
    } else if (message.role === "system") {
      if (projectedMessage) {
        return;
      }
      events.push({
        ...eventBase,
        id: [
          "projection-system",
          safeKey(messageId, "message"),
          stableProjectionHash(`${message.kind}:${message.title}:${message.text}:${JSON.stringify(normalizeThreadStructuredTranscriptMetadata(message))}`),
        ].join("-"),
        role: "system",
        status: message.status || "complete",
        text: message.text,
        type: "thread.message.system",
      });
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
    const completedAt = cleanText(event.latest_timestamp || event.completed_at, nowIso());
    const assistantMessage = [...projectedMessages].reverse().find((message) => (
      message?.role === "assistant"
      && (!message.turn_id || message.turn_id === completedTurnId)
    ));
    events.push({
      agent_id: agentId,
      assistant_message_id: assistantMessage?.id || "",
      completed_at: completedAt,
      created_at: completedAt,
      id: [
        "projection-provider-turn-completed",
        stableProjectionKey(completedTurnId, "turn"),
        "fallback",
        stableProjectionHash(completedAt),
      ].join("-"),
      message_id: assistantMessage?.id || completedTurnId,
      prompt_epoch: promptEpoch,
      source,
      status: "completed",
      turn_id: completedTurnId,
      type: "thread.turn.completed",
    });
  }

  return events;
}

function preserveRunningLatestTurnWhenTranscriptCompletionBlocked(existingLatestTurn, projectedLatestTurn, event = {}) {
  const normalizedExistingLatestTurn = normalizeThreadLatestTurn(existingLatestTurn);
  const normalizedProjectedLatestTurn = normalizeThreadLatestTurn(projectedLatestTurn);
  const blocked = Boolean(
    event.allow_transcript_turn_completion !== true
      && normalizedExistingLatestTurn?.state === "running"
      && normalizedProjectedLatestTurn
      && cleanText(normalizedProjectedLatestTurn.turn_id) === cleanText(normalizedExistingLatestTurn.turn_id)
      && CLOSED_THREAD_TURN_STATES.has(normalizedProjectedLatestTurn.state)
  );

  return {
    blocked,
    latest_turn: blocked ? normalizedExistingLatestTurn : normalizedProjectedLatestTurn,
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
    : cleanAgentId(threadOrAgentId?.current_agent || threadOrAgentId?.preferred_agent, DEFAULT_AGENT_ID);
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
      agent_branch: "",
      agent_id: "",
      agent_slot_id: "",
      coordination_mode: "",
      file_authority: "",
      session_id: "",
      session_mode: "",
      worktree_path: "",
    };
  }

  return {
    agent_branch: cleanText(value.agent_branch),
    agent_id: cleanText(value.agent_id),
    agent_slot_id: cleanText(value.agent_slot_id),
    coordination_mode: cleanText(value.coordination_mode),
    file_authority: cleanText(value.file_authority),
    session_id: cleanText(value.session_id),
    session_mode: cleanText(value.session_mode),
    worktree_path: cleanText(value.worktree_path),
  };
}

function normalizeTerminalBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const paneId = cleanText(value.pane_id);
  const instanceId = Number.parseInt(value.instance_id, 10);
  const terminalIndex = normalizeTerminalIndex(value.terminal_index);

  if (!paneId || !Number.isInteger(instanceId) || instanceId <= 0) {
    return null;
  }

  return {
    instance_id: instanceId,
    pane_id: paneId,
    terminal_index: terminalIndex,
  };
}

function normalizeActiveTerminal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const terminalIndex = normalizeTerminalIndex(value.terminal_index);
  const key = terminalSessionKey(terminalIndex);
  const paneId = cleanText(value.pane_id);
  const instanceId = Number.parseInt(value.instance_id, 10);
  const status = cleanText(value.status, "idle").toLowerCase();
  const safeStatus = LIVE_TERMINAL_STATUSES.has(status)
    ? status
    : "idle";

  if (!key) {
    return null;
  }

  const providerSessionId = cleanText(value.provider_session_id || value.native_session_id || value.session_id);
  const nativeSessionId = cleanText(value.native_session_id || value.provider_session_id || value.session_id);
  const sessionId = cleanText(value.session_id || providerSessionId || nativeSessionId);

  return {
    activity_status: normalizeThreadActivityStatus(value.activity_status),
    agent_id: cleanAgentId(value.agent_id || value.current_agent),
    agent_display_name: cleanAgentDisplayName(value.agent_display_name),
    agent_type: cleanAgentDisplayName(value.agent_type),
    command_phase: cleanText(value.command_phase),
    execution_phase: cleanText(value.execution_phase),
    instance_id: Number.isInteger(instanceId) && instanceId > 0 ? instanceId : 0,
    input_ready: value.input_ready === true,
    input_ready_at: cleanText(value.input_ready_at),
    input_ready_confidence: cleanText(value.input_ready_confidence),
    ...hookHealthFields(value),
    last_active_at: cleanText(value.last_active_at, value.updated_at || nowIso()),
    pane_id: paneId,
    ...promptingUserFields(value),
    display_name: workspaceTerminalNicknameFromRecord(value),
    file_authority: cleanText(value.file_authority || value.coordination?.file_authority),
    fork_from_provider_session_id: cleanText(
      value.fork_from_provider_session_id || value.forked_from_provider_session_id || value.parent_provider_session_id,
    ),
    native_rail_state: cleanText(value.native_rail_state),
    provider: cleanAgentDisplayName(value.provider),
    provider_session_id: providerSessionId,
    native_session_id: nativeSessionId,
    related_provider_session_ids: cleanTextArray(
      value.related_provider_session_ids,
      value.related_session_ids,
    ),
    shared_history_id: cleanText(value.shared_history_id || value.history_group_id),
    slot_key: cleanText(value.slot_key, defaultSlotKey(terminalIndex)),
    status: safeStatus,
    turn_status: cleanText(value.turn_status),
    session_mode: cleanText(value.session_mode || value.coordination?.session_mode),
    session_id: sessionId,
    terminal_name: workspaceTerminalNicknameFromRecord(value),
    terminal_nickname: workspaceTerminalNicknameFromRecord(value),
    terminal_index: terminalIndex,
    thread_id: cleanText(value.thread_id),
    updated_at: cleanText(value.updated_at, nowIso()),
    worktree_path: cleanText(value.worktree_path || value.coordination?.worktree_path),
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
    : normalizeTerminalBinding(binding.terminal_binding || fallback.terminal_binding);

  return {
    agent_id: safeAgentId,
    agent_display_name: cleanAgentDisplayName(
      binding.agent_display_name,
      fallback.agent_display_name,
    ),
    agent_type: cleanAgentDisplayName(
      binding.agent_type,
      fallback.agent_type,
    ),
    coordination: normalizeCoordination(binding.coordination || fallback.coordination),
    activity_status: options.stripLiveBindings
      ? "idle"
      : normalizeThreadActivityStatus(binding.activity_status, fallback.activity_status),
    input_ready: options.stripLiveBindings
      ? false
      : Boolean(binding.input_ready ?? fallback.input_ready),
    input_ready_at: options.stripLiveBindings
      ? ""
      : cleanText(binding.input_ready_at, fallback.input_ready_at),
    input_ready_confidence: options.stripLiveBindings
      ? ""
      : cleanText(
        binding.input_ready_confidence,
        fallback.input_ready_confidence,
      ),
    ...(
      options.stripLiveBindings
        ? hookHealthFields({ hook_health_event: "", hook_health_observed_at_ms: 0, hook_health_status: "" })
        : hookHealthFields(binding, fallback)
    ),
    ...(
      options.stripLiveBindings
        ? promptingUserFields({ terminal_is_prompting_user: false })
        : promptingUserFields(binding, fallback)
    ),
    last_active_at: cleanText(binding.last_active_at, fallback.last_active_at),
    last_message_at: cleanText(binding.last_message_at, fallback.last_message_at),
    message_count: normalizeMessageCount(binding.message_count ?? fallback.message_count),
    model_id: cleanModelId(
      binding.model_id || binding.model || binding.active_model,
      cleanModelId(fallback.model_id || fallback.model || fallback.active_model),
    ),
    model_source: cleanText(binding.model_source, fallback.model_source),
    modelUpdatedAt: cleanText(binding.modelUpdatedAt, fallback.modelUpdatedAt),
    fork_from_provider_session_id: cleanText(
      binding.fork_from_provider_session_id || binding.forked_from_provider_session_id || binding.parent_provider_session_id,
      fallback.fork_from_provider_session_id,
    ),
    native_session_id: cleanText(binding.native_session_id, fallback.native_session_id),
    native_session_kind: cleanText(binding.native_session_kind, fallback.native_session_kind || "session"),
    native_session_source: cleanText(binding.native_session_source, fallback.native_session_source),
    native_session_title: cleanThreadLabelCandidate(
      binding.native_session_title
        || binding.session_title
        || binding.title
        || fallback.native_session_title
        || fallback.session_title
        || fallback.title,
    ),
    native_session_title_source: cleanText(binding.native_session_title_source, fallback.native_session_title_source),
    nativeSessionTitleUpdatedAt: cleanText(binding.nativeSessionTitleUpdatedAt, fallback.nativeSessionTitleUpdatedAt),
    native_session_updated_at: cleanText(binding.native_session_updated_at, fallback.native_session_updated_at),
    provider: cleanAgentDisplayName(binding.provider, fallback.provider),
    related_provider_session_ids: cleanTextArray(
      binding.related_provider_session_ids,
      fallback.related_provider_session_ids,
    ),
    shared_history_id: cleanText(
      binding.shared_history_id || binding.history_group_id,
      fallback.shared_history_id || fallback.history_group_id,
    ),
    status: options.stripLiveBindings && ["active", "starting"].includes(safeStatus) ? "idle" : safeStatus,
    display_name: terminalNicknameFromSources(
      binding.display_name,
      binding.terminal_nickname,
      binding.terminal_name,
      fallback.display_name,
      fallback.terminal_nickname,
      fallback.terminal_name,
    ),
    terminal_name: terminalNicknameFromSources(
      binding.terminal_name,
      binding.terminal_nickname,
      binding.display_name,
      fallback.terminal_name,
      fallback.terminal_nickname,
      fallback.display_name,
    ),
    terminal_nickname: terminalNicknameFromSources(
      binding.terminal_nickname,
      binding.terminal_name,
      binding.display_name,
      fallback.terminal_nickname,
      fallback.terminal_name,
      fallback.display_name,
    ),
    terminal_binding: terminalBinding,
    updated_at: cleanText(binding.updated_at, fallback.updated_at || nowIso()),
  };
}

function normalizeProviderBindings(source, fallbackAgentId, fallback = {}, options = {}) {
  const normalized = {};
  const bindingsSource = source && typeof source === "object" && !Array.isArray(source) ? source : {};

  Object.entries(bindingsSource).forEach(([agentId, binding]) => {
    const safeAgentId = cleanAgentId(agentId || binding?.agent_id, "");
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

  const terminalIndex = normalizeTerminalIndex(thread.terminal_index);
  const fallbackThreadId = terminalIndex == null
    ? createRandomId(`thread-${safeKey(workspaceId)}`)
    : defaultThreadId(workspaceId, terminalIndex);
  const id = cleanText(thread.id, fallbackThreadId);
  const preferredAgent = cleanAgentId(thread.preferred_agent || thread.current_agent);
  const currentAgent = cleanAgentId(thread.current_agent || preferredAgent);
  const createdAt = cleanText(thread.created_at, nowIso());
  const updatedAt = cleanText(thread.updated_at, createdAt);
  const projectionEvents = options.stripMessages
    ? []
    : options.compactPersistence
      ? compactPersistedThreadProjectionEvents(thread.projection_events || thread.threadProjectionEvents)
      : normalizeThreadProjectionEvents(thread.projection_events || thread.threadProjectionEvents);
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
    ? normalizeThreadLatestTurn(thread.latest_turn)
    : options.compactPersistence
      ? normalizeThreadLatestTurn(thread.latest_turn)
      : projectLatestTurnFromNormalizedEvents(projectionEvents, thread.latest_turn);
  const messageCount = Math.max(normalizeMessageCount(thread.message_count), messages.length);
  const materialized = thread.materialized === true || messageCount > 0;
  const status = cleanText(thread.status, "idle").toLowerCase();
  const safeStatus = LIVE_TERMINAL_STATUSES.has(status)
    ? status
    : "idle";
  const coordination = normalizeCoordination(thread.coordination);
  const terminalBinding = options.stripLiveBindings ? null : normalizeTerminalBinding(thread.terminal_binding);
  const providerBindings = normalizeProviderBindings(
    thread.provider_bindings,
    currentAgent,
    {
      coordination,
      last_active_at: cleanText(thread.last_active_at, updatedAt),
      last_message_at: cleanText(thread.last_message_at),
      message_count: messageCount,
      status: safeStatus,
      terminal_binding: terminalBinding,
      updated_at: updatedAt,
    },
    options,
  );
  const pendingPrompt = options.stripLiveBindings ? null : normalizePendingPrompt(thread.pending_prompt);
  const fallbackTitle = defaultThreadTitle(terminalIndex || 0, currentAgent);
  const storedSessionName = cleanThreadLabelCandidate(thread.session_name);
  const storedTitle = cleanThreadLabelCandidate(thread.title);

  const transcriptSessionId = cleanText(thread.transcript_session_id);
  const orphanRunningThreadState = isOrphanRunningThreadState({
    latest_turn: projectedLatestTurn,
    message_count: messageCount,
    messages,
    pending_prompt: pendingPrompt,
    projection_events: projectionEvents,
    provider_bindings: providerBindings,
    transcript_session_id: transcriptSessionId,
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
          activity_status: storedActivityStatus,
          latest_turn: latestTurn,
          pending_prompt: pendingPrompt,
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
    thread.terminal_nickname,
    thread.terminal_name,
    thread.display_name,
    normalizedProviderBindings[currentAgent]?.terminal_nickname,
    normalizedProviderBindings[currentAgent]?.terminal_name,
    normalizedProviderBindings[currentAgent]?.display_name,
  );

  return {
    coordination,
    activity_status: activityStatus,
    archivedAt: cleanText(thread.archivedAt),
    created_at: createdAt,
    current_agent: currentAgent,
    fork_from_provider_session_id: cleanText(
      thread.fork_from_provider_session_id || thread.forked_from_provider_session_id || thread.parent_provider_session_id,
      normalizedProviderBindings[currentAgent]?.fork_from_provider_session_id,
    ),
    id,
    last_active_at: cleanText(thread.last_active_at, updatedAt),
    last_message_at: cleanText(thread.last_message_at),
    materialized,
    message_count: messageCount,
    messages,
    latest_turn: latestTurn,
    pending_prompt: pendingPrompt,
    pinnedAt: cleanText(thread.pinnedAt),
    projection_events: projectionEvents,
    preferred_agent: preferredAgent,
    related_provider_session_ids: cleanTextArray(
      thread.related_provider_session_ids,
      normalizedProviderBindings[currentAgent]?.related_provider_session_ids,
    ),
    fresh_session_started_at: options.stripLiveBindings ? "" : cleanText(thread.fresh_session_started_at),
    session_name: storedSessionName || storedTitle || fallbackTitle,
    shared_history_id: cleanText(
      thread.shared_history_id || thread.history_group_id,
      normalizedProviderBindings[currentAgent]?.shared_history_id,
    ),
    slot_key: cleanText(
      thread.slot_key,
      terminalIndex == null ? `thread-${safeKey(id, "detached")}` : defaultSlotKey(terminalIndex),
    ),
    status: options.stripLiveBindings && ["active", "starting"].includes(safeStatus) ? "idle" : safeStatus,
    provider_bindings: normalizedProviderBindings,
    terminal_binding: terminalBinding,
    display_name: terminalNickname,
    terminal_name: terminalNickname,
    terminal_nickname: terminalNickname,
    terminal_index: terminalIndex,
    title: storedTitle || storedSessionName || fallbackTitle,
    transcriptHydratedAt: options.stripMessages ? "" : cleanText(thread.transcriptHydratedAt),
    transcript_hydration_mode: options.stripMessages ? "" : cleanText(thread.transcript_hydration_mode),
    transcriptLatestTimestamp: options.stripMessages ? "" : cleanText(thread.transcriptLatestTimestamp),
    transcript_session_id: transcriptSessionId,
    transcriptSourcePath: options.stripMessages ? "" : cleanText(thread.transcriptSourcePath),
    transcript_status: options.stripMessages ? "idle" : cleanText(thread.transcript_status, "idle"),
    updated_at: updatedAt,
    workspace_id: workspaceId,
  };
}

function archiveThreadRecord(thread, archivedAt = nowIso()) {
  if (!thread) {
    return null;
  }

  const latestTurn = normalizeThreadLatestTurn(thread.latest_turn);
  const archivedLatestTurn = latestTurn?.state === "running"
    ? normalizeThreadLatestTurn({
      ...latestTurn,
      completed_at: archivedAt,
      state: "interrupted",
      updated_at: archivedAt,
    })
    : latestTurn;
  const providerBindings = normalizeProviderBindings(
    thread.provider_bindings,
    thread.current_agent,
    {
      activity_status: "idle",
      coordination: thread.coordination,
      last_active_at: thread.last_active_at,
      last_message_at: thread.last_message_at,
      message_count: thread.message_count,
      status: "closed",
      terminal_binding: null,
      updated_at: archivedAt,
    },
    { stripLiveBindings: true },
  );

  Object.keys(providerBindings).forEach((agentId) => {
    providerBindings[agentId] = {
      ...providerBindings[agentId],
      activity_status: "idle",
      status: "closed",
      terminal_binding: null,
      updated_at: archivedAt,
    };
  });

  return {
    ...thread,
    activity_status: "idle",
    archivedAt: cleanText(thread.archivedAt, archivedAt),
    latest_turn: archivedLatestTurn,
    pinnedAt: "",
    provider_bindings: providerBindings,
    status: "closed",
    terminal_binding: null,
    updated_at: archivedAt,
  };
}

function setProviderBindingTerminalNickname(providerBinding, nickname) {
  if (!providerBinding || !nickname) {
    return providerBinding;
  }

  return {
    ...providerBinding,
    display_name: nickname,
    terminal_name: nickname,
    terminal_nickname: nickname,
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
        display_name: safeNickname,
        terminal_name: safeNickname,
        terminal_nickname: safeNickname,
      };
      changed = true;
    }
  }

  const thread = threadId ? entry.threads?.[threadId] : null;
  if (thread && workspaceTerminalNicknameFromRecord(thread) !== safeNickname) {
    const agentId = cleanAgentId(thread.current_agent, "");
    const providerBindings = { ...(thread.provider_bindings || {}) };
    if (isThreadAgentId(agentId) && providerBindings[agentId]) {
      providerBindings[agentId] = setProviderBindingTerminalNickname(providerBindings[agentId], safeNickname);
    }
    entry.threads[threadId] = {
      ...thread,
      display_name: safeNickname,
      provider_bindings: providerBindings,
      terminal_name: safeNickname,
      terminal_nickname: safeNickname,
    };
    changed = true;
  }

  return changed;
}

function reconcileWorkspaceTerminalNicknames(entry) {
  const orderedKeys = [
    ...entry.terminal_order,
    ...Object.keys(entry.terminal_thread_ids || {}).sort((left, right) => Number(left) - Number(right)),
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
    const threadId = cleanText(terminal?.thread_id || entry.terminal_thread_ids?.[terminalKey]);
    const thread = threadId ? entry.threads?.[threadId] : null;
    let nickname = terminalNicknameFromSources(
      workspaceTerminalNicknameFromRecord(terminal),
      workspaceTerminalNicknameFromRecord(thread),
      workspaceTerminalNicknameFromRecord(getWorkspaceThreadProviderBinding(thread, thread?.current_agent)),
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

// Persist-path normalization caches. The threads store is immutable by
// discipline (no-op updates return the original objects), so an unchanged
// source entry/thread always normalizes to the same result for the persist
// option set. Reusing the SAME output object keeps identity stable across
// persist flushes, which lets the delta builder's `left === right` fast path
// skip JSON.stringify of full transcripts — stringifying the entire thread
// state on every 1s flush blocked the webview main thread for 2.5-9s at a
// time (the "workspace switching is extremely laggy" freezes; confirmed by
// native sampling: JSC::FastStringifier dominated the stacks).
const persistEntryNormalizeCache = new WeakMap();
const persistThreadNormalizeCache = new WeakMap();
const workspaceThreadsPersistDirtyMarks = new Map();
let workspaceThreadsPersistDirtyVersion = 0;

function getWorkspaceThreadsPersistDirtyRecord(workspaceId) {
  const safeWorkspaceId = cleanText(workspaceId);
  if (!safeWorkspaceId) {
    return null;
  }
  let record = workspaceThreadsPersistDirtyMarks.get(safeWorkspaceId);
  if (!record) {
    record = {
      shellVersion: 0,
      threadVersions: new Map(),
    };
    workspaceThreadsPersistDirtyMarks.set(safeWorkspaceId, record);
  }
  return record;
}

function markWorkspaceThreadsPersistDirty(workspaceId, threadIds = [], options = {}) {
  const safeWorkspaceId = cleanText(workspaceId);
  if (!safeWorkspaceId) {
    return;
  }
  const ids = [...new Set((Array.isArray(threadIds) ? threadIds : [threadIds])
    .map(cleanText)
    .filter(Boolean))];
  if (!ids.length && options.shell !== true) {
    return;
  }
  const record = getWorkspaceThreadsPersistDirtyRecord(safeWorkspaceId);
  if (!record) {
    return;
  }
  const version = ++workspaceThreadsPersistDirtyVersion;
  if (options.shell === true) {
    record.shellVersion = version;
  }
  ids.forEach((threadId) => {
    record.threadVersions.set(threadId, version);
  });
}

function getWorkspaceThreadRowsObject(rows) {
  return rows && typeof rows === "object" && !Array.isArray(rows) ? rows : {};
}

function collectChangedWorkspaceThreadIds(previousRows, nextRows, changedIds) {
  const previous = getWorkspaceThreadRowsObject(previousRows);
  const next = getWorkspaceThreadRowsObject(nextRows);
  const ids = new Set([
    ...Object.keys(previous),
    ...Object.keys(next),
  ]);
  ids.forEach((threadId) => {
    const safeThreadId = cleanText(threadId);
    if (safeThreadId && previous[safeThreadId] !== next[safeThreadId]) {
      changedIds.add(safeThreadId);
    }
  });
}

function markWorkspaceThreadsMutationResult(previousState, nextState, workspaceId) {
  const safeWorkspaceId = cleanText(workspaceId);
  if (!safeWorkspaceId || nextState === previousState) {
    return nextState;
  }
  const previousEntry = getWorkspaceThreadsStateObject(previousState)[safeWorkspaceId] || null;
  const nextEntry = getWorkspaceThreadsStateObject(nextState)[safeWorkspaceId] || null;
  const changedIds = new Set();
  collectChangedWorkspaceThreadIds(previousEntry?.threads, nextEntry?.threads, changedIds);
  collectChangedWorkspaceThreadIds(previousEntry?.archived_threads, nextEntry?.archived_threads, changedIds);
  markWorkspaceThreadsPersistDirty(safeWorkspaceId, [...changedIds], { shell: true });
  return nextState;
}

function normalizeWorkspaceThreadsDirtySnapshot(snapshot) {
  const source = snapshot?.workspaces && typeof snapshot.workspaces === "object"
    ? snapshot.workspaces
    : {};
  const workspaces = {};
  Object.entries(source).forEach(([workspaceId, record]) => {
    const safeWorkspaceId = cleanText(workspaceId);
    if (!safeWorkspaceId || !record || typeof record !== "object") {
      return;
    }
    const threadVersionEntries = record.threadVersions instanceof Map
      ? [...record.threadVersions.entries()]
      : Object.entries(record.threadVersions || {});
    const threadVersions = {};
    threadVersionEntries.forEach(([threadId, version]) => {
      const safeThreadId = cleanText(threadId);
      const safeVersion = Number(version || 0);
      if (safeThreadId && Number.isFinite(safeVersion) && safeVersion > 0) {
        threadVersions[safeThreadId] = safeVersion;
      }
    });
    const shellVersion = Number(record.shellVersion || 0);
    if (!Object.keys(threadVersions).length && (!Number.isFinite(shellVersion) || shellVersion <= 0)) {
      return;
    }
    workspaces[safeWorkspaceId] = {
      shellVersion: Number.isFinite(shellVersion) && shellVersion > 0 ? shellVersion : 0,
      threadVersions,
    };
  });
  return {
    version: Number(snapshot?.version || 0),
    workspaces,
  };
}

function workspaceThreadsDirtySnapshotHasMarks(snapshot) {
  return Object.values(snapshot?.workspaces || {}).some((record) => (
    Number(record?.shellVersion || 0) > 0
      || Object.keys(record?.threadVersions || {}).length > 0
  ));
}

export function getWorkspaceThreadsPersistDirtySnapshot(targets = []) {
  const targetIds = new Set((Array.isArray(targets) ? targets : [])
    .map((target) => cleanText(target?.workspace_id || target?.id || target))
    .filter(Boolean));
  const workspaces = {};
  workspaceThreadsPersistDirtyMarks.forEach((record, workspaceId) => {
    if (targetIds.size && !targetIds.has(workspaceId)) {
      return;
    }
    const threadVersions = Object.fromEntries(record.threadVersions.entries());
    if (record.shellVersion > 0 || Object.keys(threadVersions).length) {
      workspaces[workspaceId] = {
        shellVersion: record.shellVersion,
        threadVersions,
      };
    }
  });
  return {
    version: workspaceThreadsPersistDirtyVersion,
    workspaces,
  };
}

export function clearWorkspaceThreadsPersistDirtySnapshot(snapshot) {
  const normalizedSnapshot = normalizeWorkspaceThreadsDirtySnapshot(snapshot);
  Object.entries(normalizedSnapshot.workspaces).forEach(([workspaceId, snapshotRecord]) => {
    const currentRecord = workspaceThreadsPersistDirtyMarks.get(workspaceId);
    if (!currentRecord) {
      return;
    }
    if (
      snapshotRecord.shellVersion > 0
      && currentRecord.shellVersion > 0
      && currentRecord.shellVersion <= snapshotRecord.shellVersion
    ) {
      currentRecord.shellVersion = 0;
    }
    Object.entries(snapshotRecord.threadVersions || {}).forEach(([threadId, version]) => {
      const currentVersion = Number(currentRecord.threadVersions.get(threadId) || 0);
      if (currentVersion > 0 && currentVersion <= version) {
        currentRecord.threadVersions.delete(threadId);
      }
    });
    if (currentRecord.shellVersion <= 0 && currentRecord.threadVersions.size === 0) {
      workspaceThreadsPersistDirtyMarks.delete(workspaceId);
    }
  });
}

export function resetWorkspaceThreadsPersistDirty() {
  workspaceThreadsPersistDirtyMarks.clear();
}

function isPersistNormalizeOptionSet(options) {
  return Boolean(options && options.compactPersistence && options.stripLiveBindings);
}

function normalizeThreadForPersist(thread, workspaceId, options) {
  if (!isPersistNormalizeOptionSet(options) || !thread || typeof thread !== "object") {
    return normalizeThread(thread, workspaceId, options);
  }
  const cached = persistThreadNormalizeCache.get(thread);
  if (cached && cached.workspace_id === workspaceId) {
    return cached.normalized;
  }
  const normalized = normalizeThread(thread, workspaceId, options);
  persistThreadNormalizeCache.set(thread, { normalized, workspace_id: workspaceId });
  return normalized;
}

function normalizeWorkspaceEntry(entry, workspaceId, options = {}) {
  const threadsSource = entry?.threads && typeof entry.threads === "object" && !Array.isArray(entry.threads)
    ? entry.threads
    : {};
  const archivedThreadsSource = entry?.archived_threads
    && typeof entry.archived_threads === "object"
    && !Array.isArray(entry.archived_threads)
    ? entry.archived_threads
    : {};
  const hasTerminalThreadIdsSource = entry?.terminal_thread_ids
    && typeof entry.terminal_thread_ids === "object"
    && !Array.isArray(entry.terminal_thread_ids);
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
    let archivedThread = null;
    const cacheable = isPersistNormalizeOptionSet(options) && thread && typeof thread === "object";
    if (cacheable) {
      const cached = persistThreadNormalizeCache.get(thread);
      if (cached && cached.workspace_id === workspaceId && cached.archived) {
        archivedThread = cached.normalized;
      }
    }
    if (!archivedThread) {
      // Caching also stabilizes the nowIso() fallback stamp, so an archived
      // thread without archivedAt stops re-diffing as "changed" every flush.
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
      archivedThread = archiveThreadRecord(normalizedThread, archivedAt);
      if (cacheable && archivedThread) {
        persistThreadNormalizeCache.set(thread, {
          archived: true,
          normalized: archivedThread,
          workspace_id: workspaceId,
        });
      }
    }
    if (!archivedThread || !archivedThread.materialized || normalizedArchivedThreads[archivedThread.id]) {
      return;
    }

    normalizedArchivedThreads[archivedThread.id] = archivedThread;
  });

  Object.values(threadsSource).forEach((thread) => {
    const normalizedThread = normalizeThreadForPersist(thread, workspaceId, options);
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

  const sourceOrder = Array.isArray(entry?.thread_order) ? entry.thread_order : [];
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

  const sourceArchivedOrder = Array.isArray(entry?.archived_thread_order) ? entry.archived_thread_order : [];
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
    const key = terminalSessionKey(normalizedTerminal?.terminal_index);
    if (!normalizedTerminal || !key || normalizedTerminals[key]) {
      return;
    }

    normalizedTerminals[key] = normalizedTerminal;
  });

  const sourceTerminalOrder = Array.isArray(entry?.terminal_order) ? entry.terminal_order : [];
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

  const normalizedTerminalThreadIds = normalizeTerminalThreadIds(entry?.terminal_thread_ids, normalizedThreads);

  Object.values(normalizedTerminals).forEach((terminal) => {
    const key = terminalSessionKey(terminal?.terminal_index);
    if (key && terminal?.thread_id && normalizedThreads[terminal.thread_id]) {
      normalizedTerminalThreadIds[key] = terminal.thread_id;
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

  const activeThreadId = cleanText(entry?.active_thread_id);
  const safeActiveThreadId = normalizedThreads[activeThreadId]
    ? activeThreadId
    : normalizedOrder[0] || "";
  const threadsView = normalizeThreadsViewState(entry?.threads_view, {
    selectedThreadId: safeActiveThreadId,
    selected_workspace_id: workspaceId,
  });
  if (threadsView.selectedThreadId && !normalizedThreads[threadsView.selectedThreadId]) {
    threadsView.selectedThreadId = safeActiveThreadId;
  }
  if (!threadsView.selected_workspace_id) {
    threadsView.selected_workspace_id = workspaceId;
  }

  return reconcileWorkspaceTerminalNicknames({
    active_thread_id: safeActiveThreadId,
    archived_thread_order: normalizedArchivedOrder,
    archived_threads: normalizedArchivedThreads,
    terminal_order: normalizedTerminalOrder,
    terminal_thread_ids: normalizedTerminalThreadIds,
    terminals: normalizedTerminals,
    thread_order: normalizedOrder.slice(0, MAX_THREADS_PER_WORKSPACE),
    threads: normalizedThreads,
    threads_view: threadsView,
  });
}

export function normalizeWorkspaceThreads(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const persistCacheable = isPersistNormalizeOptionSet(options);
  return Object.fromEntries(
    Object.entries(value)
      .map(([workspaceId, entry]) => {
        const safeWorkspaceId = cleanText(workspaceId);
        if (!safeWorkspaceId) {
          return null;
        }

        // Entry-level persist cache: a workspace whose entry object is
        // unchanged since the last flush returns the same normalized object,
        // so the delta builder skips it by reference without touching any of
        // its threads.
        if (persistCacheable && entry && typeof entry === "object") {
          const cached = persistEntryNormalizeCache.get(entry);
          if (cached && cached.workspace_id === safeWorkspaceId) {
            return [safeWorkspaceId, cached.normalized];
          }
          const normalized = normalizeWorkspaceEntry(entry, safeWorkspaceId, options);
          persistEntryNormalizeCache.set(entry, { normalized, workspace_id: safeWorkspaceId });
          return [safeWorkspaceId, normalized];
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
  const activeThreadId = cleanText(source.active_thread_id);
  return {
    active_thread_id: activeThreadId,
    archived_thread_order: Array.isArray(source.archived_thread_order) ? source.archived_thread_order.slice() : [],
    archived_threads: cloneRecord(source.archived_threads),
    terminal_order: Array.isArray(source.terminal_order) ? source.terminal_order.slice() : [],
    terminal_thread_ids: cloneRecord(source.terminal_thread_ids),
    terminals: cloneRecord(source.terminals),
    thread_order: Array.isArray(source.thread_order) ? source.thread_order.slice() : [],
    threads: cloneRecord(source.threads),
    threads_view: {
      ...normalizeThreadsViewState(source.threads_view, {
        selectedThreadId: activeThreadId,
        selected_workspace_id: workspaceId,
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

// One-time hydration hash backfill: threads persisted before projection
// hashes existed re-pay full hash recomputation on EVERY workspace open (the
// dirty-set correctly never re-persists unchanged threads, so they never gain
// hashes on their own). Marking a workspace's hydrated threads dirty once
// re-persists them WITH hashes; every later open takes the fast path.
export function markWorkspaceThreadsPersistDirtyForHashBackfill(workspaceId, threadIds = []) {
  markWorkspaceThreadsPersistDirty(workspaceId, threadIds, { shell: false });
}

export function mergeHydratedWorkspaceThreads(currentThreads, loadedThreads, options = {}) {
  const targetEntries = Array.isArray(options.targets) ? options.targets : [];
  const targetIds = new Set(
    targetEntries
      .map((target) => cleanText(target?.workspace_id || target?.id || target))
      .filter(Boolean),
  );
  if (!targetIds.size) {
    return {};
  }

  const currentState = getWorkspaceThreadsStateObject(currentThreads);
  const loadedState = getWorkspaceThreadsStateObject(loadedThreads);
  let mergedThreads = {};

  Object.entries(currentState).forEach(([workspaceId, entry]) => {
    const safeWorkspaceId = cleanText(workspaceId);
    if (!safeWorkspaceId || !targetIds.has(safeWorkspaceId)) {
      return;
    }
    mergedThreads[safeWorkspaceId] = loadedState[safeWorkspaceId]
      || normalizeWorkspaceEntry(entry, safeWorkspaceId);
  });

  targetEntries.forEach((target) => {
    const workspaceId = cleanText(target?.workspace_id || target?.id || target);
    if (!workspaceId || !loadedState[workspaceId]) {
      return;
    }
    mergedThreads[workspaceId] = loadedState[workspaceId];
  });

  const ensureTargets = Array.isArray(options.ensureTargets) ? options.ensureTargets : [];
  ensureTargets.forEach((ensureTarget) => {
    mergedThreads = ensureWorkspaceThreadsForTerminalIndexes(mergedThreads, ensureTarget);
  });

  return mergedThreads;
}

function workspaceThreadsPersistShell(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {};
  }

  const {
    archived_threads: _archivedThreads,
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

const WORKSPACE_THREAD_ACTIVITY_STAMP_THROTTLE_MS = 1000;
const WORKSPACE_THREAD_ACTIVITY_STAMP_KEYS = new Set([
  "hook_health_observed_at_ms",
  "updated_at",
]);

function workspaceThreadActivityStamplessValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => workspaceThreadActivityStamplessValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !WORKSPACE_THREAD_ACTIVITY_STAMP_KEYS.has(key))
      .map(([key, item]) => [key, workspaceThreadActivityStamplessValue(item)]),
  );
}

function workspaceThreadActivitySemanticallyEqual(left, right) {
  return workspaceThreadsJsonEqual(
    workspaceThreadActivityStamplessValue(left),
    workspaceThreadActivityStamplessValue(right),
  );
}

function workspaceThreadActivityStampMs(value) {
  if (!value || typeof value !== "object") {
    return 0;
  }
  const updatedAtMs = Date.parse(value.updated_at || "");
  const hookObservedAtMs = Number(value.hook_health_observed_at_ms || 0);
  return Math.max(
    Number.isFinite(updatedAtMs) ? updatedAtMs : 0,
    Number.isFinite(hookObservedAtMs) ? hookObservedAtMs : 0,
  );
}

function workspaceThreadIdenticalActivityStampIsThrottled(now, ...records) {
  const nowMs = Date.parse(now || "");
  if (!Number.isFinite(nowMs) || nowMs <= 0) {
    return false;
  }
  const previousMs = records.reduce((latest, record) => (
    Math.max(latest, workspaceThreadActivityStampMs(record))
  ), 0);
  return previousMs > 0 && nowMs - previousMs < WORKSPACE_THREAD_ACTIVITY_STAMP_THROTTLE_MS;
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
      thread_id: safeThreadId,
    });
  });
  return rows;
}

function workspaceThreadPersistRowsForIds(currentRows, previousRows, threadIds) {
  const rows = [];
  const ids = [...new Set(Array.from(threadIds || []).map(cleanText).filter(Boolean))];
  ids.forEach((threadId) => {
    const thread = currentRows?.[threadId];
    if (!thread) {
      return;
    }
    if (workspaceThreadsJsonEqual(thread, previousRows?.[threadId])) {
      return;
    }
    rows.push({
      state: thread,
      thread_id: threadId,
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

function buildWorkspaceThreadsPersistDeltaByIdentityDiff(threads, previousPersistedThreads, targets = []) {
  const normalizedThreads = persistWorkspaceThreads(threads);
  const previousThreads = previousPersistedThreads && typeof previousPersistedThreads === "object"
    ? previousPersistedThreads
    : {};
  const targetEntries = Array.isArray(targets) && targets.length
    ? targets
    : Object.keys(normalizedThreads).map((workspaceId) => ({ workspace_id: workspaceId }));

  const workspaces = targetEntries
    .map((target) => {
      const workspaceId = cleanText(target?.workspace_id || target?.id || target);
      if (!workspaceId || !normalizedThreads[workspaceId]) {
        return null;
      }

      const currentEntry = normalizedThreads[workspaceId];
      const previousEntry = previousThreads[workspaceId] || null;
      if (currentEntry === previousEntry) {
        // Identity-stable normalization: same object means nothing in this
        // workspace changed since the last flush.
        return null;
      }
      const shell = workspaceThreadsPersistShell(currentEntry);
      const previousShell = workspaceThreadsPersistShell(previousEntry);
      const delta = {
        root_directory: cleanText(target?.root_directory),
        workspace_id: workspaceId,
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
        currentEntry.archived_threads,
        previousEntry?.archived_threads,
      );
      if (changedArchivedThreads.length) {
        delta.archived_threads = changedArchivedThreads;
        changed = true;
      }

      const removedThreadIds = workspaceThreadRemovedIds(currentEntry.threads, previousEntry?.threads);
      if (removedThreadIds.length) {
        delta.removed_thread_ids = removedThreadIds;
        changed = true;
      }

      const removedArchivedThreadIds = workspaceThreadRemovedIds(
        currentEntry.archived_threads,
        previousEntry?.archived_threads,
      );
      if (removedArchivedThreadIds.length) {
        delta.removed_archived_thread_ids = removedArchivedThreadIds;
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

function buildWorkspaceThreadsPersistDeltaFromDirtySet(
  threads,
  previousPersistedThreads,
  targets = [],
  dirtySnapshot,
) {
  const currentThreads = getWorkspaceThreadsStateObject(threads);
  const previousThreads = previousPersistedThreads && typeof previousPersistedThreads === "object"
    ? previousPersistedThreads
    : {};
  const normalizedDirtySnapshot = normalizeWorkspaceThreadsDirtySnapshot(dirtySnapshot);
  if (!workspaceThreadsDirtySnapshotHasMarks(normalizedDirtySnapshot)) {
    return buildWorkspaceThreadsPersistDeltaByIdentityDiff(threads, previousPersistedThreads, targets);
  }
  const normalizedThreads = { ...previousThreads };
  const targetEntries = Array.isArray(targets) && targets.length
    ? targets
    : Object.keys(currentThreads).map((workspaceId) => ({ workspace_id: workspaceId }));

  const workspaces = targetEntries
    .map((target) => {
      const workspaceId = cleanText(target?.workspace_id || target?.id || target);
      const sourceEntry = workspaceId ? currentThreads[workspaceId] : null;
      if (!workspaceId || !sourceEntry || typeof sourceEntry !== "object" || Array.isArray(sourceEntry)) {
        return null;
      }

      const previousEntry = previousThreads[workspaceId] || null;
      const dirtyRecord = normalizedDirtySnapshot.workspaces[workspaceId] || null;
      const dirtyThreadIds = new Set(Object.keys(dirtyRecord?.threadVersions || {}));
      const rawRemovedThreadIds = workspaceThreadRemovedIds(sourceEntry.threads, previousEntry?.threads);
      const rawRemovedArchivedThreadIds = workspaceThreadRemovedIds(
        sourceEntry.archived_threads,
        previousEntry?.archived_threads,
      );
      const isFullWorkspaceWrite = !previousEntry;
      if (
        !isFullWorkspaceWrite
        && !dirtyRecord
        && !rawRemovedThreadIds.length
        && !rawRemovedArchivedThreadIds.length
      ) {
        return null;
      }

      const currentEntry = normalizeWorkspaceEntry(sourceEntry, workspaceId, {
        compactPersistence: true,
        stripLiveBindings: true,
      });
      normalizedThreads[workspaceId] = currentEntry;

      const removedThreadIds = workspaceThreadRemovedIds(currentEntry.threads, previousEntry?.threads);
      const removedArchivedThreadIds = workspaceThreadRemovedIds(
        currentEntry.archived_threads,
        previousEntry?.archived_threads,
      );

      const shell = workspaceThreadsPersistShell(currentEntry);
      const previousShell = workspaceThreadsPersistShell(previousEntry);
      const delta = {
        root_directory: cleanText(target?.root_directory),
        workspace_id: workspaceId,
      };
      let changed = false;

      if (!previousEntry || !workspaceThreadsJsonEqual(shell, previousShell)) {
        delta.shell = shell;
        changed = true;
      }

      const changedThreads = isFullWorkspaceWrite
        ? workspaceThreadPersistRows(currentEntry.threads, previousEntry?.threads)
        : workspaceThreadPersistRowsForIds(currentEntry.threads, previousEntry?.threads, dirtyThreadIds);
      if (changedThreads.length) {
        delta.threads = changedThreads;
        changed = true;
      }

      const changedArchivedThreads = isFullWorkspaceWrite
        ? workspaceThreadPersistRows(currentEntry.archived_threads, previousEntry?.archived_threads)
        : workspaceThreadPersistRowsForIds(
          currentEntry.archived_threads,
          previousEntry?.archived_threads,
          dirtyThreadIds,
        );
      if (changedArchivedThreads.length) {
        delta.archived_threads = changedArchivedThreads;
        changed = true;
      }

      if (removedThreadIds.length) {
        delta.removed_thread_ids = removedThreadIds;
        changed = true;
      }

      if (removedArchivedThreadIds.length) {
        delta.removed_archived_thread_ids = removedArchivedThreadIds;
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

export function buildWorkspaceThreadsPersistDelta(
  threads,
  previousPersistedThreads,
  targets = [],
  options = {},
) {
  const previousThreads = previousPersistedThreads && typeof previousPersistedThreads === "object"
    ? previousPersistedThreads
    : {};
  const hasDirtySnapshot = options && Object.prototype.hasOwnProperty.call(options, "dirtySnapshot");
  if (!hasDirtySnapshot || Object.keys(previousThreads).length === 0) {
    return buildWorkspaceThreadsPersistDeltaByIdentityDiff(threads, previousPersistedThreads, targets);
  }
  return buildWorkspaceThreadsPersistDeltaFromDirtySet(
    threads,
    previousPersistedThreads,
    targets,
    options.dirtySnapshot,
  );
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
    active_thread_id: existing.active_thread_id,
    archived_thread_order: existing.archived_thread_order.slice(),
    archived_threads: { ...existing.archived_threads },
    terminal_order: existing.terminal_order.slice(),
    terminal_thread_ids: { ...existing.terminal_thread_ids },
    terminals: { ...existing.terminals },
    thread_order: existing.thread_order.slice(),
    threads: { ...existing.threads },
    threads_view: { ...existing.threads_view },
  };
}

export function ensureWorkspaceThreadsForTerminalIndexes(state, options = {}) {
  const workspaceId = cleanText(options.workspace_id);
  if (!workspaceId) {
    return state || {};
  }

  const terminalIndexes = Array.isArray(options.terminal_indexes)
    ? options.terminal_indexes.map(normalizeTerminalIndex).filter((index) => index != null)
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

    if (existingTerminal && !existingTerminal.thread_id && isThreadAgentId(existingTerminal.agent_id || role)) {
      const agentId = cleanAgentId(existingTerminal.agent_id || role);
      const threadId = createThreadIdForTerminal(workspaceId, terminalIndex);
      entry.threads[threadId] = {
        coordination: normalizeCoordination({
          worktree_path: existingTerminal.worktree_path,
        }),
        created_at: now,
        current_agent: agentId,
        id: threadId,
        last_active_at: now,
        last_message_at: "",
        latest_turn: null,
        materialized: true,
        message_count: 0,
        messages: [],
        pending_prompt: null,
        projection_events: [],
        preferred_agent: agentId,
        provider_bindings: {
          [agentId]: normalizeProviderBinding(null, agentId, {
            activity_status: "idle",
            last_active_at: now,
            message_count: 0,
            status: existingTerminal.status || "active",
            terminal_binding: normalizeTerminalBinding({
              instance_id: existingTerminal.instance_id,
              pane_id: existingTerminal.pane_id,
              terminal_index: terminalIndex,
            }),
            updated_at: now,
          }),
        },
        session_name: defaultThreadTitle(terminalIndex, agentId),
        slot_key: existingTerminal.slot_key || defaultSlotKey(terminalIndex),
        status: existingTerminal.status || "active",
        terminal_binding: normalizeTerminalBinding({
          instance_id: existingTerminal.instance_id,
          pane_id: existingTerminal.pane_id,
          terminal_index: terminalIndex,
        }),
        terminal_index: terminalIndex,
        title: defaultThreadTitle(terminalIndex, agentId),
        updated_at: now,
        workspace_id: workspaceId,
      };
      entry.thread_order.push(threadId);
      bindExistingThreadToTerminal(entry, threadId, {
        agent_id: agentId,
        instance_id: existingTerminal.instance_id,
        pane_id: existingTerminal.pane_id,
        slot_key: existingTerminal.slot_key,
        status: existingTerminal.status || "active",
        terminal_index: terminalIndex,
        workspace_id: workspaceId,
        worktree_path: existingTerminal.worktree_path,
      }, { status: existingTerminal.status || "active" });
      changed = true;
      return;
    }

    if (existingTerminal && existingTerminal.agent_id !== role && existingTerminal.status !== "active") {
      entry.terminals[terminalKey] = {
        ...existingTerminal,
        agent_id: role,
        updated_at: now,
      };
      changed = true;
      return;
    }
  });

  entry.thread_order = entry.thread_order.filter((threadId, index, order) => (
    entry.threads[threadId] && order.indexOf(threadId) === index
  ));
  entry.terminal_order = entry.terminal_order.filter((terminalKey, index, order) => (
    entry.terminals[terminalKey] && order.indexOf(terminalKey) === index
  ));

  if (!entry.active_thread_id || !entry.threads[entry.active_thread_id]) {
    const nextActiveThreadId = entry.thread_order[0] || "";
    if (entry.active_thread_id !== nextActiveThreadId) {
      entry.active_thread_id = nextActiveThreadId;
      changed = true;
    }
  }

  if (!currentState[workspaceId]) {
    changed = true;
  }

  if (!changed) {
    return state || {};
  }

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [workspaceId]: entry,
  }, workspaceId);
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
    ...normalizeThreadsViewState(entry.threads_view, {
      selectedThreadId: entry.active_thread_id,
      selected_workspace_id: safeWorkspaceId,
    }),
    newChatActive: false,
    selectedThreadId: safeThreadId,
    selected_workspace_id: safeWorkspaceId,
  };
  const viewChanged = JSON.stringify(entry.threads_view || {}) !== JSON.stringify(nextThreadsView);

  if (entry.active_thread_id === safeThreadId && !restoreChanged && !viewChanged) {
    return state || {};
  }

  entry.active_thread_id = safeThreadId;
  entry.threads_view = nextThreadsView;

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [safeWorkspaceId]: entry,
  }, safeWorkspaceId);
}

export function updateWorkspaceThreadsViewState(state, workspaceId, patch = {}) {
  const safeWorkspaceId = cleanText(workspaceId || patch.workspace_id || patch.selected_workspace_id);
  if (!safeWorkspaceId) {
    return state || {};
  }

  const currentState = getWorkspaceThreadsStateObject(state);
  const sourceEntry = currentState[safeWorkspaceId];
  const entry = sourceEntry ? cloneWorkspaceEntryForMutation(sourceEntry, safeWorkspaceId) : null;
  if (!entry) {
    return state || {};
  }

  const existingView = normalizeThreadsViewState(entry.threads_view, {
    selectedThreadId: entry.active_thread_id,
    selected_workspace_id: safeWorkspaceId,
  });
  const requestedThreadId = cleanText(patch.selectedThreadId || patch.thread_id);
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
    selectedThreadId: selectedThreadId || entry.active_thread_id || "",
    selected_workspace_id: cleanText(patch.selected_workspace_id || safeWorkspaceId, existingView.selected_workspace_id || safeWorkspaceId),
  };

  if (JSON.stringify(existingView) === JSON.stringify(nextView)) {
    return state || {};
  }

  entry.threads_view = nextView;
  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [safeWorkspaceId]: entry,
  }, safeWorkspaceId);
}

function getTerminalKeyForEvent(entry, event = {}) {
  const directKey = terminalSessionKey(event.terminal_index);
  if (directKey) {
    return directKey;
  }

  const paneId = cleanText(event.pane_id);
  const instanceId = Number.parseInt(event.instance_id, 10);
  const threadId = cleanText(event.thread_id);

  return Object.entries(entry.terminals).find(([, terminal]) => (
    (paneId && terminal.pane_id === paneId)
    || (Number.isInteger(instanceId) && instanceId > 0 && terminal.instance_id === instanceId)
    || (threadId && terminal.thread_id === threadId)
  ))?.[0] || "";
}

function upsertActiveTerminal(entry, event = {}, options = {}) {
  const terminalIndex = normalizeTerminalIndex(event.terminal_index);
  const key = terminalSessionKey(terminalIndex);
  if (!key) {
    return null;
  }

  const existing = entry.terminals[key] || {};
  const nextThreadId = cleanText(options.thread_id ?? event.thread_id ?? existing.thread_id);
  const displacedThreadId = cleanText(existing.thread_id);
  if (nextThreadId && displacedThreadId && displacedThreadId !== nextThreadId) {
    detachThreadFromTerminalBinding(entry, displacedThreadId, {
      agent_id: existing.agent_id || event.agent_id || event.current_agent,
      current_agent: existing.agent_id || event.current_agent || event.agent_id,
      instance_id: existing.instance_id,
      pane_id: existing.pane_id,
      status: "closed",
      terminal_index: terminalIndex,
      thread_id: displacedThreadId,
      workspace_id: event.workspace_id,
    });
  }
  const now = nowIso();
  const eventType = cleanText(event.type).toLowerCase();
  const eventActivityStatus = normalizeThreadActivityStatus(event.activity_status, "");
  const explicitInputReady = typeof event.input_ready === "boolean" ? event.input_ready : null;
  const eventInstanceId = Number.parseInt(event.instance_id, 10);
  const openedExistingReadyInstance = eventType === "opened"
    && Boolean(existing.input_ready)
    && Number.isInteger(eventInstanceId)
    && eventInstanceId > 0
    && Number(existing.instance_id) === eventInstanceId;
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
      : Boolean(existing.input_ready);
  const inputReadyAt = inputReady
    ? cleanText(event.input_ready_at, existing.input_ready_at || now)
    : "";
  const inputReadyConfidence = inputReady
    ? cleanText(event.input_ready_confidence, existing.input_ready_confidence)
    : "";
  const terminalPromptingFields = promptingUserFieldsForTerminalEvent(event, existing, {
    clear: terminalReadinessIgnoredEvent ? false : marksInputBusy || marksInputReady,
    event_type: eventType,
  });
  const agentType = cleanAgentDisplayName(
    event.agent_type,
    existing.agent_type,
  );
  const agentDisplayName = cleanAgentDisplayName(
    event.agent_display_name || agentType,
    existing.agent_display_name,
  );
  const eventProviderSessionId = cleanText(
    event.provider_session_id || event.native_session_id,
  );
  const eventSessionId = cleanText(event.session_id);
  const eventForkFromProviderSessionId = cleanText(
    event.fork_from_provider_session_id || event.forked_from_provider_session_id || event.parent_provider_session_id,
  );
  const eventSharedHistoryId = cleanText(event.shared_history_id || event.history_group_id);
  const eventRelatedProviderSessionIds = cleanTextArray(
    event.related_provider_session_ids,
    event.related_session_ids,
  );
  const sessionIdentityCleared = event.provider_session_id_cleared === true || event.native_session_id_cleared === true || event.session_id_cleared === true;
  const openedNewTerminalGeneration = eventType === "opened"
    && !openedExistingReadyInstance
    && (
      (
        Number.isInteger(eventInstanceId)
        && eventInstanceId > 0
        && Number(existing.instance_id || 0) !== eventInstanceId
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
      event.terminal_nickname,
      event.terminal_name,
      event.display_name,
      workspaceTerminalNicknameFromRecord(entry.threads?.[nextThreadId]),
      workspaceTerminalNicknameFromRecord(getWorkspaceThreadProviderBinding(
        entry.threads?.[nextThreadId],
        entry.threads?.[nextThreadId]?.current_agent || event.agent_id || event.current_agent,
      )),
      workspaceTerminalNicknameFromRecord(existing),
    ],
    {
      excludeTerminalIndex: terminalIndex,
      excludeThreadId: nextThreadId,
    },
  );
  const terminal = normalizeActiveTerminal({
    activity_status: eventActivityStatus || existing.activity_status || "",
    agent_id: event.agent_id || event.current_agent || existing.agent_id,
    agent_display_name: agentDisplayName,
    agent_type: agentType,
    command_phase: event.command_phase || existing.command_phase,
    display_name: terminalNickname,
    execution_phase: event.execution_phase || existing.execution_phase,
    fork_from_provider_session_id: clearSessionIdentity && !eventForkFromProviderSessionId
      ? ""
      : eventForkFromProviderSessionId || existing.fork_from_provider_session_id,
    input_ready: inputReady,
    input_ready_at: inputReadyAt,
    input_ready_confidence: inputReadyConfidence,
    ...hookHealthFields(event, existing),
    instance_id: event.instance_id ?? existing.instance_id,
    last_active_at: now,
    pane_id: event.pane_id || existing.pane_id,
    ...terminalPromptingFields,
    native_rail_state: event.native_rail_state || existing.native_rail_state,
    provider: event.provider || existing.provider,
    provider_session_id: clearSessionIdentity
      ? ""
      : event.provider_session_id || event.native_session_id || existing.provider_session_id,
    native_session_id: clearSessionIdentity
      ? ""
      : event.native_session_id || event.provider_session_id || existing.native_session_id,
    related_provider_session_ids: eventRelatedProviderSessionIds.length
      ? eventRelatedProviderSessionIds
      : cleanTextArray(existing.related_provider_session_ids),
    shared_history_id: clearSessionIdentity && !eventSharedHistoryId
      ? ""
      : eventSharedHistoryId || existing.shared_history_id,
    slot_key: event.slot_key || existing.slot_key || defaultSlotKey(terminalIndex),
    status: options.status || event.status || existing.status || "active",
    turn_status: event.turn_status || existing.turn_status,
    session_id: clearSessionIdentity
      ? ""
      : event.session_id || event.provider_session_id || event.native_session_id || existing.session_id,
    terminal_name: terminalNickname,
    terminal_nickname: terminalNickname,
    terminal_index: terminalIndex,
    thread_id: nextThreadId,
    updated_at: now,
    worktree_path: event.worktree_path || existing.worktree_path,
  });

  if (!terminal) {
    return null;
  }

  entry.terminals[key] = terminal;
  if (!entry.terminal_order.includes(key)) {
    entry.terminal_order.push(key);
  }
  if (terminal.thread_id && entry.threads[terminal.thread_id]) {
    rememberTerminalThread(entry, terminalIndex, terminal.thread_id);
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
    event.agent_id
      || event.current_agent
      || existing.current_agent,
  );
  const terminalBinding = normalizeTerminalBinding({
    instance_id: cleanText(existing.terminal_binding?.instance_id),
    pane_id: cleanText(existing.terminal_binding?.pane_id),
    terminal_index: existing.terminal_index,
  });
  const existingLatestTurn = normalizeThreadLatestTurn(existing.latest_turn);
  const existingProviderBinding = getWorkspaceThreadProviderBinding(existing, agentId);
  const shouldDeferRunningTurnInterruption = Boolean(
    event.defer_session_backed_running_turn_interruption === true
      && detachedStatus !== "error"
      && existingLatestTurn?.state === "running"
      && (existing.transcript_session_id || existingProviderBinding?.native_session_id),
  );
  const latestTurn = existingLatestTurn?.state === "running" && !shouldDeferRunningTurnInterruption
    ? normalizeThreadLatestTurn({
      ...existingLatestTurn,
      completed_at: now,
      error: detachedStatus === "error" ? "Terminal detached" : existingLatestTurn.error,
      state: detachedStatus === "error" ? "error" : "interrupted",
      updated_at: now,
    })
    : existingLatestTurn;
  const providerBindings = normalizeProviderBindings(
    existing.provider_bindings,
    existing.current_agent,
    {
      coordination: existing.coordination,
      last_active_at: existing.last_active_at,
      last_message_at: existing.last_message_at,
      message_count: existing.message_count,
      status: existing.status,
      terminal_binding: terminalBinding,
      updated_at: existing.updated_at,
    },
  );
  if (isThreadAgentId(agentId)) {
    providerBindings[agentId] = {
      ...normalizeProviderBinding(providerBindings[agentId], agentId, {
        activity_status: "idle",
        coordination: existing.coordination,
        last_active_at: existing.last_active_at,
        last_message_at: existing.last_message_at,
        message_count: existing.message_count,
        status: detachedStatus,
        terminal_binding: null,
        updated_at: now,
      }),
      activity_status: "idle",
      status: detachedStatus,
      terminal_binding: null,
      updated_at: now,
    };
  }

  entry.threads[safeThreadId] = {
    ...existing,
    activity_status: "idle",
    latest_turn: latestTurn,
    provider_bindings: providerBindings,
    status: detachedStatus,
    terminal_binding: null,
    updated_at: now,
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
    terminal_index: event.terminal_index ?? existing.terminal_index,
    thread_id: threadId,
  });
  const activeTerminal = terminalKey ? entry.terminals[terminalKey] : null;
  const displacedThreadId = cleanText(activeTerminal?.thread_id);
  if (displacedThreadId && displacedThreadId !== threadId) {
    detachThreadFromTerminalBinding(entry, displacedThreadId, {
      ...event,
      status: "closed",
      thread_id: displacedThreadId,
    });
  }
  const terminalIndex = normalizeTerminalIndex(event.terminal_index ?? activeTerminal?.terminal_index ?? existing.terminal_index);
  const now = nowIso();
  const agentId = cleanAgentId(
    event.agent_id
      || event.current_agent
      || activeTerminal?.agent_id
      || existing.current_agent,
  );
  const status = cleanText(options.status || event.status || "active").toLowerCase();
  const safeStatus = ["active", "closed", "error", "exited", "idle", "starting"].includes(status)
    ? status
    : "active";
  const eventType = cleanText(event.type).toLowerCase();
  const sessionIdentityCleared = event.provider_session_id_cleared === true || event.native_session_id_cleared === true || event.session_id_cleared === true;
  const eventForkFromProviderSessionId = cleanText(
    event.fork_from_provider_session_id || event.forked_from_provider_session_id || event.parent_provider_session_id,
  );
  const eventSharedHistoryId = cleanText(event.shared_history_id || event.history_group_id);
  const eventRelatedProviderSessionIds = cleanTextArray(
    event.related_provider_session_ids,
    event.related_session_ids,
  );
  const terminalBinding = normalizeTerminalBinding({
    instance_id: event.instance_id ?? activeTerminal?.instance_id,
    pane_id: event.pane_id || activeTerminal?.pane_id,
    terminal_index: terminalIndex,
  });
  const terminalNickname = resolveWorkspaceTerminalNickname(
    entry,
    [
      event.terminal_nickname,
      event.terminal_name,
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
    ? normalizeMessageCount(existing.message_count) + 1
    : normalizeMessageCount(existing.message_count);
  const coordination = {
    agent_branch: cleanText(event.agent_branch, existing.coordination?.agent_branch),
    agent_id: cleanText(event.coordination_agent_id || event.agent_coordination_id, existing.coordination?.agent_id),
    agent_slot_id: cleanText(event.agent_slot_id, existing.coordination?.agent_slot_id),
    coordination_mode: cleanText(event.coordination_mode, existing.coordination?.coordination_mode),
    file_authority: cleanText(event.file_authority, existing.coordination?.file_authority),
    session_id: cleanText(event.session_id, existing.coordination?.session_id),
    session_mode: cleanText(event.session_mode, existing.coordination?.session_mode),
    worktree_path: cleanText(event.worktree_path, activeTerminal?.worktree_path || existing.coordination?.worktree_path),
  };
  const existingProviderBindings = normalizeProviderBindings(
    existing.provider_bindings,
    existing.current_agent,
    {
      coordination: existing.coordination,
      last_active_at: existing.last_active_at,
      last_message_at: existing.last_message_at,
      message_count: existing.message_count,
      status: existing.status,
      terminal_binding: existing.terminal_binding,
      updated_at: existing.updated_at,
    },
  );
  const shouldClearOrphanRunning = !options.incrementMessageCount && isOrphanRunningThreadState({
    latest_turn: existing.latest_turn,
    message_count: existing.message_count,
    messages: normalizeThreadMessages(existing.messages),
    pending_prompt: existing.pending_prompt,
    projection_events: normalizeThreadProjectionEvents(existing.projection_events),
    provider_bindings: existingProviderBindings,
    transcript_session_id: existing.transcript_session_id,
  });
  const baseProviderBindings = shouldClearOrphanRunning
    ? clearOrphanRunningProviderBindings(existingProviderBindings)
    : existingProviderBindings;
  const latestTurn = shouldClearOrphanRunning ? null : normalizeThreadLatestTurn(existing.latest_turn);
  const providerBinding = normalizeProviderBinding(baseProviderBindings[agentId], agentId, {
    agent_display_name: event.agent_display_name || activeTerminal?.agent_display_name,
    agent_type: event.agent_type || activeTerminal?.agent_type,
    coordination,
    input_ready: Boolean(activeTerminal?.input_ready),
    input_ready_at: activeTerminal?.input_ready_at || "",
    input_ready_confidence: activeTerminal?.input_ready_confidence || "",
    last_active_at: now,
    last_message_at: options.incrementMessageCount ? now : existing.last_message_at,
    message_count: nextMessageCount,
    fork_from_provider_session_id: sessionIdentityCleared && !eventForkFromProviderSessionId
      ? ""
      : eventForkFromProviderSessionId || activeTerminal?.fork_from_provider_session_id || existing.fork_from_provider_session_id,
    provider: event.provider || activeTerminal?.provider,
    related_provider_session_ids: eventRelatedProviderSessionIds.length
      ? eventRelatedProviderSessionIds
      : cleanTextArray(
        activeTerminal?.related_provider_session_ids,
        existing.related_provider_session_ids,
      ),
    shared_history_id: sessionIdentityCleared && !eventSharedHistoryId
      ? ""
      : eventSharedHistoryId || activeTerminal?.shared_history_id || existing.shared_history_id,
    status: safeStatus,
    display_name: terminalNickname,
    terminal_name: terminalNickname,
    terminal_nickname: terminalNickname,
    terminal_binding: terminalBinding,
    updated_at: now,
  });
  const runtimeActivityStatus = explicitRuntimeActivityStatus(event, "")
    || normalizeThreadActivityStatus(
      activeTerminal?.activity_status,
      "",
    );
  const activityStatus = eventType === "opened" || shouldClearOrphanRunning
    ? "idle"
    : runtimeActivityStatus || "idle";
  const eventSessionName = cleanThreadLabelCandidate(event.session_name);
  const eventTitle = eventSessionName
    || getWorkspaceThreadPromptLabel(event.title || event.user_message, "");
  const existingSessionName = cleanThreadLabelCandidate(existing.session_name);
  const existingTitle = cleanThreadLabelCandidate(existing.title);
  const providerBindings = {
    ...baseProviderBindings,
    [agentId]: {
      ...providerBinding,
      activity_status: activityStatus,
      agent_display_name: cleanAgentDisplayName(
        event.agent_display_name || activeTerminal?.agent_display_name,
        providerBinding?.agent_display_name,
      ),
      agent_type: cleanAgentDisplayName(
        event.agent_type || activeTerminal?.agent_type,
        providerBinding?.agent_type,
      ),
      coordination,
      input_ready: Boolean(activeTerminal?.input_ready),
      provider: cleanAgentDisplayName(event.provider || activeTerminal?.provider, providerBinding?.provider),
      input_ready_at: activeTerminal?.input_ready_at || "",
      input_ready_confidence: activeTerminal?.input_ready_confidence || "",
      last_active_at: now,
      last_message_at: options.incrementMessageCount ? now : providerBinding?.last_message_at || existing.last_message_at,
      message_count: nextMessageCount,
      fork_from_provider_session_id: sessionIdentityCleared && !eventForkFromProviderSessionId
        ? ""
        : eventForkFromProviderSessionId || providerBinding?.fork_from_provider_session_id,
      ...hookHealthFields(activeTerminal, providerBinding),
      model_id: cleanModelId(event.model_id || event.model, providerBinding?.model_id),
      model_source: cleanModelId(event.model_id || event.model) ? cleanText(event.model_source, "user") : providerBinding?.model_source,
      modelUpdatedAt: cleanModelId(event.model_id || event.model) ? now : providerBinding?.modelUpdatedAt || "",
      native_session_id: sessionIdentityCleared
        ? ""
        : cleanText(event.native_session_id, providerBinding?.native_session_id),
      native_session_kind: sessionIdentityCleared
        ? ""
        : cleanText(event.native_session_kind, providerBinding?.native_session_kind || "session"),
      native_session_source: sessionIdentityCleared
        ? ""
        : cleanText(event.native_session_source, providerBinding?.native_session_source),
      native_session_updated_at: sessionIdentityCleared
        ? ""
        : event.native_session_id ? now : providerBinding?.native_session_updated_at || "",
      related_provider_session_ids: eventRelatedProviderSessionIds.length
        ? eventRelatedProviderSessionIds
        : cleanTextArray(providerBinding?.related_provider_session_ids),
      shared_history_id: sessionIdentityCleared && !eventSharedHistoryId
        ? ""
        : eventSharedHistoryId || providerBinding?.shared_history_id,
      display_name: terminalNickname,
      status: safeStatus,
      terminal_name: terminalNickname,
      terminal_nickname: terminalNickname,
      terminal_binding: terminalBinding,
      updated_at: now,
    },
  };

  entry.threads[threadId] = {
    ...existing,
    activity_status: activityStatus,
    coordination,
    current_agent: agentId,
    fork_from_provider_session_id: sessionIdentityCleared && !eventForkFromProviderSessionId
      ? ""
      : eventForkFromProviderSessionId || existing.fork_from_provider_session_id,
    last_active_at: now,
    last_message_at: options.incrementMessageCount ? now : existing.last_message_at,
    materialized: true,
    message_count: nextMessageCount,
    messages: existing.messages,
    latest_turn: latestTurn,
    preferred_agent: cleanAgentId(event.preferred_agent || existing.preferred_agent || agentId),
    provider_bindings: providerBindings,
    related_provider_session_ids: eventRelatedProviderSessionIds.length
      ? eventRelatedProviderSessionIds
      : cleanTextArray(existing.related_provider_session_ids),
    display_name: terminalNickname,
    session_name: eventSessionName || existingSessionName || eventTitle || existingTitle,
    shared_history_id: sessionIdentityCleared && !eventSharedHistoryId
      ? ""
      : eventSharedHistoryId || existing.shared_history_id,
    slot_key: cleanText(event.slot_key || activeTerminal?.slot_key, existing.slot_key),
    status: safeStatus,
    terminal_binding: terminalBinding,
    terminal_name: terminalNickname,
    terminal_nickname: terminalNickname,
    terminal_index: terminalIndex,
    title: eventTitle || existingTitle || existingSessionName || defaultThreadTitle(terminalIndex, agentId),
    transcript_session_id: sessionIdentityCleared ? "" : existing.transcript_session_id,
    updated_at: now,
  };

  if (terminalKey && entry.terminals[terminalKey]) {
    entry.terminals[terminalKey] = {
      ...entry.terminals[terminalKey],
      agent_id: agentId,
      display_name: terminalNickname,
      fork_from_provider_session_id: sessionIdentityCleared && !eventForkFromProviderSessionId
        ? ""
        : eventForkFromProviderSessionId || entry.terminals[terminalKey].fork_from_provider_session_id,
      last_active_at: now,
      related_provider_session_ids: eventRelatedProviderSessionIds.length
        ? eventRelatedProviderSessionIds
        : cleanTextArray(entry.terminals[terminalKey].related_provider_session_ids, entry.terminals[terminalKey].related_provider_session_ids),
      shared_history_id: sessionIdentityCleared && !eventSharedHistoryId
        ? ""
        : eventSharedHistoryId || entry.terminals[terminalKey].shared_history_id,
      status: safeStatus,
      terminal_name: terminalNickname,
      terminal_nickname: terminalNickname,
      thread_id: threadId,
      updated_at: now,
    };
  }

  rememberTerminalThread(entry, terminalIndex, threadId);
  entry.active_thread_id = threadId;
  return true;
}

export function updateWorkspaceActiveTerminal(state, event = {}) {
  const workspaceId = cleanText(event.workspace_id);
  if (!workspaceId) {
    return state || {};
  }

  const currentState = getWorkspaceThreadsStateObject(state);
  const entry = cloneWorkspaceEntryForMutation(currentState[workspaceId], workspaceId);
  const eventAgentId = cleanAgentId(event.agent_id || event.current_agent, "");
  const eventNativeSessionId = cleanText(event.native_session_id || event.provider_session_id);
  if (eventNativeSessionId && workspaceEntryHasArchivedSession(entry, eventAgentId, eventNativeSessionId)) {
    return state || {};
  }
  const terminalIndex = normalizeTerminalIndex(event.terminal_index);
  const terminalKey = terminalSessionKey(terminalIndex);
  const eventThreadId = cleanText(event.thread_id);
  const restoredThreadId = terminalKey ? cleanText(entry.terminal_thread_ids?.[terminalKey]) : "";
  const threadId = entry.threads[eventThreadId]
    ? eventThreadId
    : entry.threads[restoredThreadId]
      ? restoredThreadId
      : "";
  const terminal = upsertActiveTerminal(entry, event, {
    status: event.status || "active",
    thread_id: threadId,
  });

  if (terminal && threadId && entry.threads[threadId]) {
    bindExistingThreadToTerminal(entry, threadId, event, { status: event.status || "active" });
  } else if (terminal && !threadId && isThreadAgentId(terminal.agent_id)) {
    const now = nowIso();
    const nextThreadId = createThreadIdForTerminal(workspaceId, terminal.terminal_index);
    const freshSessionStartedAt = event.fresh_session
      ? cleanText(event.fresh_session_started_at, now)
      : "";
    entry.threads[nextThreadId] = {
      coordination: normalizeCoordination({
        worktree_path: terminal.worktree_path,
      }),
      created_at: now,
      current_agent: terminal.agent_id,
      id: nextThreadId,
      last_active_at: now,
      last_message_at: "",
      latest_turn: null,
      fresh_session_started_at: freshSessionStartedAt,
      materialized: true,
      message_count: 0,
      messages: [],
      pending_prompt: null,
      projection_events: [],
      preferred_agent: terminal.agent_id,
      provider_bindings: {
        [terminal.agent_id]: normalizeProviderBinding(null, terminal.agent_id, {
          activity_status: "idle",
          input_ready: Boolean(terminal.input_ready),
          input_ready_at: terminal.input_ready_at || "",
          input_ready_confidence: terminal.input_ready_confidence || "",
          last_active_at: now,
          message_count: 0,
          status: terminal.status || event.status || "active",
          display_name: terminal.terminal_nickname,
          terminal_name: terminal.terminal_nickname,
          terminal_nickname: terminal.terminal_nickname,
          terminal_binding: normalizeTerminalBinding({
            instance_id: terminal.instance_id,
            pane_id: terminal.pane_id,
            terminal_index: terminal.terminal_index,
          }),
          updated_at: now,
        }),
      },
      display_name: terminal.terminal_nickname,
      session_name: defaultThreadTitle(terminal.terminal_index, terminal.agent_id),
      slot_key: terminal.slot_key || defaultSlotKey(terminal.terminal_index),
      status: terminal.status || event.status || "active",
      terminal_binding: normalizeTerminalBinding({
        instance_id: terminal.instance_id,
        pane_id: terminal.pane_id,
        terminal_index: terminal.terminal_index,
      }),
      terminal_name: terminal.terminal_nickname,
      terminal_nickname: terminal.terminal_nickname,
      terminal_index: terminal.terminal_index,
      title: defaultThreadTitle(terminal.terminal_index, terminal.agent_id),
      transcript_hydration_mode: event.fresh_session ? "session-only" : "",
      updated_at: now,
      workspace_id: workspaceId,
    };
    entry.thread_order.push(nextThreadId);
    bindExistingThreadToTerminal(entry, nextThreadId, event, { status: event.status || "active" });
  }

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [workspaceId]: entry,
  }, workspaceId);
}

export function materializeWorkspaceThreadForTerminal(state, event = {}) {
  const workspaceId = cleanText(event.workspace_id);
  const terminalIndex = normalizeTerminalIndex(event.terminal_index);
  if (!workspaceId || terminalIndex == null) {
    return state || {};
  }

  const currentState = getWorkspaceThreadsStateObject(state);
  const entry = cloneWorkspaceEntryForMutation(currentState[workspaceId], workspaceId);
  const terminalKey = terminalSessionKey(terminalIndex);
  const existingTerminal = terminalKey ? entry.terminals[terminalKey] : null;
  const existingThreadId = cleanText(event.thread_id || existingTerminal?.thread_id);
  if (workspaceEntryHasArchivedThreadId(entry, existingThreadId)) {
    return state || {};
  }
  const now = nowIso();
  const agentId = cleanAgentId(event.agent_id || existingTerminal?.agent_id || DEFAULT_AGENT_ID);
  const eventNativeSessionId = cleanText(event.native_session_id || event.provider_session_id);
  if (eventNativeSessionId && workspaceEntryHasArchivedSession(entry, agentId, eventNativeSessionId)) {
    return state || {};
  }
  const threadId = existingThreadId || createThreadIdForTerminal(workspaceId, terminalIndex);
  const submittedUserMessage = cleanSubmittedUserMessage(event.user_message || event.message);
  const promptLabel = getWorkspaceThreadPromptLabel(
    event.title || submittedUserMessage,
    defaultThreadTitle(terminalIndex, agentId),
  );
  const rawPendingPrompt = normalizePendingPrompt(event.pending_prompt || {
    created_at: event.message_created_at,
    delivery_mode: event.pending_prompt_delivery_mode || event.delivery_mode,
    id: event.pending_prompt_id,
    message: event.pending_prompt_text || (event.session_acceptance_pending === true ? submittedUserMessage : ""),
    model: event.model,
  });
  const pendingPromptWasAccepted = Boolean(
    event.prompt_accepted === true
      || event.session_acceptance_pending === false
      || event.session_accepted === true
  );
  const pendingPrompt = pendingPromptWasAccepted ? null : rawPendingPrompt;
  const hasSubmittedPrompt = Boolean(submittedUserMessage || pendingPrompt);
  const previousThread = entry.threads[threadId] || null;
  const previousMessages = normalizeThreadMessages(previousThread?.messages);
  const previousActivityStatus = normalizeThreadActivityStatus(previousThread?.activity_status);
  const freshSessionStartedAt = event.fresh_session
    ? cleanText(event.fresh_session_started_at, previousThread?.fresh_session_started_at || now)
    : previousThread?.fresh_session_started_at || "";
  const transcriptHydrationMode = cleanText(
    event.transcript_hydration_mode,
    event.fresh_session ? "session-only" : previousThread?.transcript_hydration_mode || "",
  );
  const shouldBindTerminal = event.bind_terminal !== false;

  if (shouldBindTerminal) {
    upsertActiveTerminal(entry, event, {
      status: event.status || "active",
      thread_id: threadId,
    });
  }
  const boundTerminal = terminalKey ? entry.terminals[terminalKey] || existingTerminal : existingTerminal;
  const terminalNickname = resolveWorkspaceTerminalNickname(
    entry,
    [
      event.terminal_nickname,
      event.terminal_name,
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
      created_at: now,
      current_agent: agentId,
      id: threadId,
      last_active_at: now,
      last_message_at: now,
      latest_turn: null,
      materialized: true,
      message_count: 0,
      messages: [],
      pending_prompt: null,
      projection_events: [],
      preferred_agent: agentId,
      fresh_session_started_at: freshSessionStartedAt,
      provider_bindings: isThreadAgentId(agentId)
        ? {
          [agentId]: normalizeProviderBinding(null, agentId, {
            display_name: terminalNickname,
            last_active_at: now,
            last_message_at: now,
            message_count: 0,
            status: "active",
            terminal_name: terminalNickname,
            terminal_nickname: terminalNickname,
            updated_at: now,
          }),
        }
        : {},
      display_name: terminalNickname,
      session_name: promptLabel,
      slot_key: cleanText(event.slot_key || existingTerminal?.slot_key, defaultSlotKey(terminalIndex)),
      status: "active",
      terminal_binding: null,
      terminal_name: terminalNickname,
      terminal_nickname: terminalNickname,
      terminal_index: terminalIndex,
      title: promptLabel,
      transcript_hydration_mode: transcriptHydrationMode,
      updated_at: now,
      workspace_id: workspaceId,
    };
    entry.thread_order.push(threadId);
  }

  if (shouldBindTerminal) {
    bindExistingThreadToTerminal(entry, threadId, event, {
      incrementMessageCount: hasSubmittedPrompt,
      status: event.status || "active",
    });
  } else {
    entry.active_thread_id = threadId;
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
      entry.threads[threadId].latest_turn,
    );
    const nextPendingPrompt = pendingPromptWasAccepted
      ? null
      : pendingPrompt || entry.threads[threadId].pending_prompt;
    const shouldClearOrphanRunning = isOrphanRunningThreadState({
      latest_turn: projectedLatestTurn,
      message_count: messages.length,
      messages,
      pending_prompt: nextPendingPrompt,
      projection_events: projectionEvents,
      provider_bindings: entry.threads[threadId].provider_bindings,
      transcript_session_id: entry.threads[threadId].transcript_session_id,
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
            ? entry.threads[threadId].activity_status
            : previousActivityStatus,
    );
    let providerBindings = normalizeProviderBindings(
      entry.threads[threadId].provider_bindings,
      entry.threads[threadId].current_agent,
      {
        activity_status: activityStatus,
        coordination: entry.threads[threadId].coordination,
        last_active_at: entry.threads[threadId].last_active_at,
        last_message_at: entry.threads[threadId].last_message_at,
        message_count: messages.length,
        status: entry.threads[threadId].status,
        terminal_binding: entry.threads[threadId].terminal_binding,
        updated_at: entry.threads[threadId].updated_at,
      },
    );
    if (shouldClearOrphanRunning) {
      providerBindings = clearOrphanRunningProviderBindings(providerBindings);
    }
    if (isThreadAgentId(agentId) && providerBindings[agentId]) {
      providerBindings[agentId] = {
        ...providerBindings[agentId],
        activity_status: activityStatus,
      };
    }
    entry.threads[threadId] = {
      ...entry.threads[threadId],
      activity_status: activityStatus,
      last_message_at: messages.length ? messages[messages.length - 1].created_at : entry.threads[threadId].last_message_at,
      latest_turn: latestTurn,
      message_count: messages.length,
      messages,
      pending_prompt: nextPendingPrompt,
      projection_events: projectionEvents,
      fresh_session_started_at: freshSessionStartedAt,
      provider_bindings: providerBindings,
      transcript_hydration_mode: transcriptHydrationMode,
    };
  }
  entry.thread_order = entry.thread_order.filter((candidateId, index, order) => (
    entry.threads[candidateId] && order.indexOf(candidateId) === index
  )).slice(0, MAX_THREADS_PER_WORKSPACE);

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [workspaceId]: entry,
  }, workspaceId);
}

export function bindWorkspaceThreadTerminal(state, event = {}) {
  const workspaceId = cleanText(event.workspace_id);
  const threadId = cleanText(event.thread_id);
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
    thread_id: threadId,
  });
  bindExistingThreadToTerminal(entry, threadId, event, { status: event.status || "active" });

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [workspaceId]: entry,
  }, workspaceId);
}

export function markWorkspaceThreadTerminalDetached(state, event = {}) {
  const workspaceId = cleanText(event.workspace_id);
  if (!workspaceId) {
    return state || {};
  }

  const currentState = getWorkspaceThreadsStateObject(state);
  const entry = cloneWorkspaceEntryForMutation(currentState[workspaceId], workspaceId);
  const terminalKey = getTerminalKeyForEvent(entry, event);
  const terminal = terminalKey ? entry.terminals[terminalKey] : null;
  const threadId = cleanText(event.thread_id || terminal?.thread_id);
  const existing = threadId ? entry.threads[threadId] : null;
  const terminalIndex = normalizeTerminalIndex(
    event.terminal_index ?? terminal?.terminal_index ?? existing?.terminal_index,
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
    entry.terminal_order = entry.terminal_order.filter((key) => key !== terminalKey);
  }

  if (event.remember_terminal_thread === false || event.forget_terminal_thread) {
    forgetTerminalThread(entry, terminalIndex, threadId);
  } else if (existing) {
    rememberTerminalThread(entry, terminalIndex, threadId);
  }

  if (existing) {
    const agentId = cleanAgentId(event.agent_id || terminal?.agent_id || existing.current_agent, "");
    const existingLatestTurn = normalizeThreadLatestTurn(existing.latest_turn);
    const existingProviderBinding = getWorkspaceThreadProviderBinding(existing, agentId);
    const shouldDeferRunningTurnInterruption = Boolean(
      event.defer_session_backed_running_turn_interruption === true
        && safeStatus !== "error"
        && existingLatestTurn?.state === "running"
        && (existing.transcript_session_id || existingProviderBinding?.native_session_id),
    );
    const latestTurn = existingLatestTurn?.state === "running" && !shouldDeferRunningTurnInterruption
      ? normalizeThreadLatestTurn({
        ...existingLatestTurn,
        completed_at: now,
        error: safeStatus === "error" ? "Terminal error" : existingLatestTurn.error,
        state: safeStatus === "error" ? "error" : "interrupted",
        updated_at: now,
      })
      : existingLatestTurn;
    const providerBindings = normalizeProviderBindings(
      existing.provider_bindings,
      existing.current_agent,
      {
        coordination: existing.coordination,
        last_active_at: existing.last_active_at,
        last_message_at: existing.last_message_at,
        message_count: existing.message_count,
        status: existing.status,
        terminal_binding: existing.terminal_binding,
        updated_at: existing.updated_at,
      },
    );
    if (isThreadAgentId(agentId)) {
      providerBindings[agentId] = {
        ...normalizeProviderBinding(providerBindings[agentId], agentId, {
          activity_status: "idle",
          coordination: existing.coordination,
          last_active_at: existing.last_active_at,
          last_message_at: existing.last_message_at,
          message_count: existing.message_count,
          status: safeStatus,
          terminal_binding: null,
          updated_at: now,
        }),
        activity_status: "idle",
        status: safeStatus,
        terminal_binding: null,
        updated_at: now,
      };
    }

    entry.threads[threadId] = {
      ...existing,
      activity_status: "idle",
      latest_turn: latestTurn,
      provider_bindings: providerBindings,
      status: safeStatus,
      terminal_binding: null,
      updated_at: now,
    };
  }

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [workspaceId]: entry,
  }, workspaceId);
}

export function updateWorkspaceThreadAgent(state, event = {}) {
  const workspaceId = cleanText(event.workspace_id);
  const threadId = cleanText(event.thread_id);
  const agentId = cleanAgentId(event.agent_id);
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
    existing.provider_bindings,
    existing.current_agent,
    {
      coordination: existing.coordination,
      last_active_at: existing.last_active_at,
      last_message_at: existing.last_message_at,
      message_count: existing.message_count,
      status: existing.status,
      terminal_binding: existing.terminal_binding,
      updated_at: existing.updated_at,
    },
  );
  const currentAgent = cleanAgentId(existing.current_agent, "");
  if (isThreadAgentId(currentAgent) && currentAgent !== agentId) {
    providerBindings[currentAgent] = {
      ...normalizeProviderBinding(providerBindings[currentAgent], currentAgent, {
        activity_status: "idle",
        coordination: existing.coordination,
        last_active_at: existing.last_active_at,
        last_message_at: existing.last_message_at,
        message_count: existing.message_count,
        status: "closed",
        terminal_binding: null,
        updated_at: now,
      }),
      activity_status: "idle",
      status: "closed",
      terminal_binding: null,
      updated_at: now,
    };
  }
  if (isThreadAgentId(agentId)) {
    providerBindings[agentId] = {
      ...normalizeProviderBinding(providerBindings[agentId], agentId, {
        activity_status: "idle",
        coordination: existing.coordination,
        last_active_at: now,
        last_message_at: existing.last_message_at,
        message_count: existing.message_count,
        status: event.status || "starting",
        terminal_binding: null,
        updated_at: now,
      }),
      activity_status: "idle",
      last_active_at: now,
      status: event.status || "starting",
      terminal_binding: null,
      updated_at: now,
    };
  }
  const terminalIndex = normalizeTerminalIndex(event.terminal_index ?? existing.terminal_index);
  const terminalKey = terminalSessionKey(terminalIndex);
  const existingTerminal = terminalKey ? entry.terminals[terminalKey] : null;
  if (
    terminalKey
    && existingTerminal
    && cleanAgentId(existingTerminal.agent_id, "") !== agentId
  ) {
    delete entry.terminals[terminalKey];
    entry.terminal_order = entry.terminal_order.filter((key) => key !== terminalKey);
  }
  const existingLatestTurn = normalizeThreadLatestTurn(existing.latest_turn);
  const nextLatestTurn = existingLatestTurn?.state === "running"
    ? normalizeThreadLatestTurn({
      ...existingLatestTurn,
      completed_at: now,
      error: cleanText(event.reason || "Terminal agent changed."),
      state: "interrupted",
      updated_at: now,
    })
    : existing.latest_turn;
  rememberTerminalThread(entry, terminalIndex, threadId);
  entry.active_thread_id = threadId;
  entry.threads[threadId] = {
    ...existing,
    activity_status: "idle",
    current_agent: agentId,
    latest_turn: nextLatestTurn,
    preferred_agent: agentId,
    provider_bindings: providerBindings,
    status: event.status || existing.status,
    terminal_binding: event.status === "starting" ? null : existing.terminal_binding,
    terminal_index: terminalIndex,
    updated_at: now,
  };

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [workspaceId]: entry,
  }, workspaceId);
}

function workspaceThreadHasProviderSession(thread, agentId, sessionId) {
  const safeSessionId = cleanText(sessionId);
  if (!thread || !safeSessionId) {
    return false;
  }

  const providerBinding = getWorkspaceThreadProviderBinding(thread, agentId);
  return cleanText(thread.transcript_session_id) === safeSessionId
    || cleanText(providerBinding?.native_session_id) === safeSessionId;
}

function workspaceThreadHasConversationContent(thread) {
  const messages = normalizeThreadMessages(thread?.messages);
  if (messages.some((message) => (
    (message.role === "user" || message.role === "assistant")
      && cleanMessageText(message.text)
  ))) {
    return true;
  }

  if (normalizeMessageCount(thread?.message_count) > 0) {
    return true;
  }

  return normalizeThreadProjectionEvents(thread?.projection_events).some((event) => (
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

  return normalizeThreadProjectionEvents(thread?.projection_events).some((event) => (
    (event.type === "thread.message.assistant.delta" || event.type === "thread.message.assistant.complete")
      && cleanMessageText(event.text || event.delta)
  ));
}

function workspaceThreadIsDetachedSessionClaim(thread) {
  const duplicateHasTerminalBinding = Boolean(normalizeTerminalBinding(thread?.terminal_binding));
  const duplicateStatus = cleanText(thread?.status).toLowerCase();
  return !duplicateHasTerminalBinding
    && (!duplicateStatus || ["idle", "closed", "exited"].includes(duplicateStatus));
}

function workspaceThreadHasLiveSessionClaim(thread) {
  const status = cleanText(thread?.status).toLowerCase();
  return Boolean(
    normalizeTerminalBinding(thread?.terminal_binding)
      || status === "active"
      || status === "starting"
  );
}

function workspaceThreadCanClaimProviderSession(thread) {
  return Boolean(
    thread?.fresh_session_started_at
      || thread?.pending_prompt
      || workspaceThreadHasConversationContent(thread)
      || normalizeThreadProjectionEvents(thread?.projection_events).length > 0
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
    thread.provider_bindings,
    thread.current_agent,
    {
      activity_status: "idle",
      coordination: thread.coordination,
      last_active_at: thread.last_active_at,
      last_message_at: thread.last_message_at,
      message_count: thread.message_count,
      status: thread.status,
      terminal_binding: null,
      updated_at: releasedAt,
    },
  );
  const providerBinding = normalizeProviderBinding(providerBindings[agentId], agentId, {
    activity_status: "idle",
    coordination: thread.coordination,
    last_active_at: thread.last_active_at,
    last_message_at: thread.last_message_at,
    message_count: thread.message_count,
    status: thread.status,
    terminal_binding: null,
    updated_at: releasedAt,
  });
  if (providerBinding && cleanText(providerBinding.native_session_id) === safeSessionId) {
    providerBindings[agentId] = {
      ...providerBinding,
      activity_status: "idle",
      input_ready: false,
      input_ready_at: "",
      input_ready_confidence: "",
      native_session_id: "",
      native_session_kind: "",
      native_session_source: "",
      native_session_updated_at: releasedAt,
      status: cleanText(thread.status).toLowerCase() === "active" ? "idle" : providerBinding.status,
      terminal_binding: null,
      updated_at: releasedAt,
    };
  }

  const latestTurn = normalizeThreadLatestTurn(thread.latest_turn);
  const isDetachedClaim = workspaceThreadIsDetachedSessionClaim(thread);
  const shouldClearRunningTurn = latestTurn?.state === "running"
    && isDetachedClaim
    && !workspaceThreadHasAssistantConversationContent(thread);
  const shouldClearTranscriptSession = cleanText(thread.transcript_session_id) === safeSessionId;

  return {
    ...thread,
    activity_status: "idle",
    latest_turn: shouldClearRunningTurn ? null : thread.latest_turn,
    provider_bindings: providerBindings,
    status: cleanText(thread.status).toLowerCase() === "active" ? "idle" : thread.status,
    terminal_binding: null,
    transcript_hydration_mode: shouldClearTranscriptSession ? "" : thread.transcript_hydration_mode,
    transcript_session_id: shouldClearTranscriptSession ? "" : thread.transcript_session_id,
    transcript_status: shouldClearTranscriptSession ? "idle" : thread.transcript_status,
    updated_at: releasedAt,
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
      agent_id: cleanText(message.agent_id),
      createdAtPresent: Boolean(cleanText(message.created_at)),
      idPresent: Boolean(cleanText(message.id)),
      kind: cleanText(message.kind),
      role: cleanText(message.role),
      source: cleanText(message.source),
      status: cleanText(message.status),
      textLength: cleanMessageText(message.text).length,
      turnIdPresent: Boolean(cleanText(message.turn_id)),
    })),
  };
}

function summarizeWorkspaceThreadSessionClaimForDiagnostics(thread, agentId, sessionId, targetThread = null) {
  if (!thread) {
    return null;
  }

  const messages = normalizeThreadMessages(thread.messages);
  const projectionEvents = normalizeThreadProjectionEvents(thread.projection_events);
  const latestTurn = normalizeThreadLatestTurn(thread.latest_turn);
  const binding = getWorkspaceThreadProviderBinding(thread, agentId);
  const lastMessage = messages[messages.length - 1] || null;
  return {
    activity_status: cleanText(thread.activity_status),
    assistantMessageCount: messages.filter((message) => message.role === "assistant").length,
    canYieldToTarget: targetThread
      ? workspaceThreadDuplicateProviderSessionCanYield(targetThread, thread)
      : false,
    hasAssistantConversationContent: workspaceThreadHasAssistantConversationContent(thread),
    hasConversationContent: workspaceThreadHasConversationContent(thread),
    hasLiveSessionClaim: workspaceThreadHasLiveSessionClaim(thread),
    hasProviderSession: workspaceThreadHasProviderSession(thread, agentId, sessionId),
    hasTerminalBinding: Boolean(normalizeTerminalBinding(thread.terminal_binding)),
    isDetachedSessionClaim: workspaceThreadIsDetachedSessionClaim(thread),
    lastRole: cleanText(lastMessage?.role),
    lastTextLength: cleanMessageText(lastMessage?.text).length,
    latestTurnState: cleanText(latestTurn?.state),
    message_count: messages.length,
    providerSessionIdPresent: Boolean(cleanText(binding?.native_session_id)),
    projectionEventCount: projectionEvents.length,
    status: cleanText(thread.status),
    thread_id: cleanText(thread.id),
    transcript_hydration_mode: cleanText(thread.transcript_hydration_mode),
    transcriptSessionIdPresent: Boolean(cleanText(thread.transcript_session_id)),
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
  const transcriptExplicitCompletionCanSettleTurn = event.transcript_explicit_completion_can_settle_turn === true;
  const projectionEventsBefore = ensureThreadProjectionEvents(existing);
  const projectionEventsToAdd = createProjectionEventsFromTranscript(existing, event.messages, {
    agent_id: agentId,
    completed_at: event.completed_at,
    expected_message_created_at: event.expected_message_created_at,
    expected_user_message: event.expected_user_message,
    latest_timestamp: event.latest_timestamp,
    matched_by: event.matched_by,
    prefer_live_hook_assistant_messages: event.prefer_live_hook_assistant_messages,
    prompt_epoch: event.prompt_epoch,
    prompt_event_id: event.prompt_event_id || event.pending_prompt_id || event.prompt_id,
    prompt_accepted: event.prompt_accepted,
    prompt_event_submitted_at: event.prompt_event_submitted_at,
    source: cleanText(event.source, `${agentId}-session`),
    submitted_at: event.submitted_at,
    allow_transcript_turn_completion: event.allow_transcript_turn_completion,
    assistant_response_completes_turn: event.assistant_response_completes_turn,
    transcript_completion_can_settle_turn: event.transcript_completion_can_settle_turn,
    transcript_explicit_completion_can_settle_turn: event.transcript_explicit_completion_can_settle_turn,
    turn_complete_seen: event.turn_complete_seen,
  });
  const projectionEventsAfter = appendThreadProjectionEvents(
    projectionEventsBefore,
    projectionEventsToAdd,
  );
  const messagesBefore = normalizeThreadMessages(existing?.messages);
  const messagesAfter = projectThreadProjectionMessagesFromNormalizedEvents(projectionEventsAfter, existing?.messages);
  const latestTurnBefore = normalizeThreadLatestTurn(existing?.latest_turn);
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
  const workspaceId = cleanText(event.workspace_id);
  const threadId = cleanText(event.thread_id);
  const agentId = cleanAgentId(event.agent_id || event.current_agent || "codex", "");
  const sessionId = cleanText(event.session_id || event.provider_session_id || event.native_session_id);
  const requestedProviderSessionId = cleanText(event.requested_provider_session_id || event.requested_native_session_id);
  const matchedBy = cleanText(event.matched_by).toLowerCase();
  const currentState = normalizeWorkspaceThreads(state);
  const entry = workspaceId ? currentState[workspaceId] : null;
  const existing = entry?.threads?.[threadId] || null;
  const transcriptMessages = summarizeTranscriptMessagesForDiagnostics(event.messages);
  const base = {
    agent_id: agentId,
    hasEntry: Boolean(entry),
    hasExistingThread: Boolean(existing),
    incomingTranscript: transcriptMessages,
    matched_by: matchedBy,
    requestedProviderSessionIdPresent: Boolean(requestedProviderSessionId),
    sessionIdPresent: Boolean(sessionId),
    thread_id: threadId,
    validAgentId: isThreadAgentId(agentId),
    workspace_id: workspaceId,
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
      : existing.transcript_hydration_mode === "session-only"
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
    blockingDuplicateThreadId: cleanText(blockingDuplicate?.thread_id),
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
    thread.transcript_session_id,
    thread.coordination?.session_id,
  ].forEach((sessionId) => {
    const safeSessionId = cleanText(sessionId);
    if (safeSessionId) {
      sessionIds.add(safeSessionId);
    }
  });

  const safeAgentId = cleanAgentId(agentId, "");
  const bindings = safeAgentId
    ? [getWorkspaceThreadProviderBinding(thread, safeAgentId)]
    : Object.values(thread.provider_bindings || {});
  bindings.forEach((binding) => {
    const safeSessionId = cleanText(binding?.native_session_id);
    if (safeSessionId) {
      sessionIds.add(safeSessionId);
    }
  });

  return [...sessionIds];
}

function workspaceEntryHasArchivedThreadId(entry, threadId) {
  const safeThreadId = cleanText(threadId);
  return Boolean(safeThreadId && entry?.archived_threads?.[safeThreadId]);
}

function workspaceEntryHasArchivedSession(entry, agentId, sessionId) {
  const safeSessionId = cleanText(sessionId);
  if (!entry?.archived_threads || !safeSessionId) {
    return false;
  }

  return Object.values(entry.archived_threads).some((thread) => (
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
  const directThreadId = cleanText(event.thread_id);
  if (directThreadId && entry?.threads?.[directThreadId]) {
    return directThreadId;
  }

  const sessionThreadId = findWorkspaceThreadIdForProviderSession(entry, agentId, sessionId);
  if (sessionThreadId) {
    return sessionThreadId;
  }

  const paneId = cleanText(event.pane_id);
  const instanceId = Number.parseInt(event.instance_id, 10);
  const terminalIndex = normalizeTerminalIndex(event.terminal_index);
  const terminalKey = terminalSessionKey(terminalIndex);
  const terminalThreadId = terminalKey ? cleanText(entry?.terminals?.[terminalKey]?.thread_id) : "";
  if (terminalThreadId && entry?.threads?.[terminalThreadId]) {
    return terminalThreadId;
  }

  const exactTerminalThread = Object.values(entry?.threads || {}).find((thread) => {
    const binding = normalizeTerminalBinding(thread?.terminal_binding);
    const providerBinding = getWorkspaceThreadProviderBinding(thread, agentId);
    const providerTerminalBinding = normalizeTerminalBinding(providerBinding?.terminal_binding);
    return [binding, providerTerminalBinding].some((candidate) => (
      candidate
        && (!paneId || candidate.pane_id === paneId)
        && (!Number.isInteger(instanceId) || Number(candidate.instance_id) === instanceId)
    ));
  });
  if (exactTerminalThread?.id) {
    return exactTerminalThread.id;
  }

  const terminalByPane = Object.values(entry?.terminals || {}).find((terminal) => (
    (paneId && terminal?.pane_id === paneId)
      || (Number.isInteger(instanceId) && Number(terminal?.instance_id) === instanceId)
  ));
  if (terminalByPane?.thread_id && entry?.threads?.[terminalByPane.thread_id]) {
    return terminalByPane.thread_id;
  }

  const restoredThreadId = terminalKey ? cleanText(entry?.terminal_thread_ids?.[terminalKey]) : "";
  if (restoredThreadId && entry?.threads?.[restoredThreadId]) {
    return restoredThreadId;
  }

  const indexedThread = getWorkspaceThreadForTerminalIndexFromEntry(entry, terminalIndex);
  return cleanText(indexedThread?.id);
}

export function applyWorkspaceThreadProviderSessionBinding(state, event = {}) {
  const workspaceId = cleanText(event.workspace_id);
  const agentId = cleanAgentId(event.agent_id || event.current_agent, "");
  const nativeSessionId = cleanText(
    event.native_session_id || event.provider_session_id || event.session_id,
  );
  const forkFromProviderSessionId = cleanText(
    event.fork_from_provider_session_id || event.forked_from_provider_session_id || event.parent_provider_session_id,
  );
  const sharedHistoryId = cleanText(event.shared_history_id || event.history_group_id);
  const relatedProviderSessionIds = cleanTextArray(
    event.related_provider_session_ids,
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

  const terminalIndex = normalizeTerminalIndex(event.terminal_index);
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
      event.terminal_nickname,
      event.terminal_name,
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
    const title = cleanRealThreadTitleCandidate(event.native_session_title || event.session_title)
      || defaultThreadTitle(terminalIndex ?? 0, agentId);
    entry.threads[threadId] = {
      coordination: normalizeCoordination({
        worktree_path: event.worktree_path || event.cwd,
      }),
      created_at: now,
      current_agent: agentId,
      display_name: terminalNickname,
      fork_from_provider_session_id: forkFromProviderSessionId,
      id: threadId,
      last_active_at: now,
      last_message_at: "",
      latest_turn: null,
      materialized: true,
      message_count: 0,
      messages: [],
      pending_prompt: null,
      preferred_agent: agentId,
      projection_events: [],
      provider_bindings: {},
      related_provider_session_ids: relatedProviderSessionIds,
      session_name: title,
      shared_history_id: sharedHistoryId,
      slot_key: cleanText(event.slot_key, defaultSlotKey(terminalIndex)),
      status: cleanText(event.status, "active"),
      terminal_binding: null,
      terminal_index: terminalIndex,
      terminal_name: terminalNickname,
      terminal_nickname: terminalNickname,
      title,
      transcript_session_id: nativeSessionId,
      updated_at: now,
      workspace_id: workspaceId,
    };
    entry.thread_order.push(threadId);
  }

  const existingThread = entry.threads[threadId] || null;
  const terminalKey = terminalSessionKey(terminalIndex);
  const existingTerminal = terminalKey ? entry.terminals?.[terminalKey] || null : null;
  const inheritedActivityStatus = explicitRuntimeActivityStatus(event, "")
    || normalizeThreadActivityStatus(
      existingTerminal?.activity_status,
      "",
    );
  const bindingEvent = {
    ...event,
    activity_status: inheritedActivityStatus || event.activity_status,
    agent_id: agentId,
    fork_from_provider_session_id: forkFromProviderSessionId,
    native_session_id: nativeSessionId,
    native_session_kind: cleanText(event.native_session_kind, "session"),
    native_session_source: cleanText(event.native_session_source || event.source, "rust-session-binding"),
    provider_session_id: nativeSessionId,
    related_provider_session_ids: relatedProviderSessionIds,
    session_id: event.session_id || nativeSessionId,
    shared_history_id: sharedHistoryId,
    status: event.status || "active",
    terminal_index: terminalIndex,
    thread_id: threadId,
    workspace_id: workspaceId,
  };
  upsertActiveTerminal(entry, bindingEvent, {
    status: bindingEvent.status,
    thread_id: threadId,
  });
  bindExistingThreadToTerminal(entry, threadId, bindingEvent, {
    status: bindingEvent.status,
  });

  const nextState = updateWorkspaceThreadProviderSession({
    ...currentState,
    [workspaceId]: entry,
  }, bindingEvent);
  return markWorkspaceThreadsMutationResult(state, nextState, workspaceId);
}

export function updateWorkspaceThreadProviderSession(state, event = {}) {
  const workspaceId = cleanText(event.workspace_id);
  const threadId = cleanText(event.thread_id);
  const agentId = cleanAgentId(event.agent_id || event.current_agent, "");
  const nativeSessionId = cleanText(
    event.native_session_id || event.provider_session_id,
  );
  const forkFromProviderSessionId = cleanText(
    event.fork_from_provider_session_id || event.forked_from_provider_session_id || event.parent_provider_session_id,
  );
  const sharedHistoryId = cleanText(event.shared_history_id || event.history_group_id);
  const relatedProviderSessionIds = cleanTextArray(
    event.related_provider_session_ids,
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
  const nativeSessionTitle = cleanRealThreadTitleCandidate(event.native_session_title || event.session_title, existing);
  const sessionTerminalBinding = normalizeTerminalBinding({
    instance_id: event.instance_id ?? existing.terminal_binding?.instance_id,
    pane_id: event.pane_id || existing.terminal_binding?.pane_id,
    terminal_index: event.terminal_index ?? existing.terminal_index,
  });
  const providerBindings = normalizeProviderBindings(
    existing.provider_bindings,
    existing.current_agent,
    {
      coordination: existing.coordination,
      last_active_at: existing.last_active_at,
      last_message_at: existing.last_message_at,
      message_count: existing.message_count,
      status: existing.status,
      terminal_binding: existing.terminal_binding,
      updated_at: existing.updated_at,
    },
  );
  const modelId = cleanModelId(event.model_id || event.model);
  providerBindings[agentId] = {
    ...normalizeProviderBinding(providerBindings[agentId], agentId, {
      coordination: existing.coordination,
      last_active_at: existing.last_active_at,
      last_message_at: existing.last_message_at,
      message_count: existing.message_count,
      status: existing.status,
      terminal_binding: existing.terminal_binding,
      updated_at: existing.updated_at,
    }),
    model_id: modelId || providerBindings[agentId]?.model_id || "",
    model_source: modelId ? cleanText(event.model_source, "session") : providerBindings[agentId]?.model_source || "",
    modelUpdatedAt: modelId ? now : providerBindings[agentId]?.modelUpdatedAt || "",
    fork_from_provider_session_id: forkFromProviderSessionId || providerBindings[agentId]?.fork_from_provider_session_id || "",
    native_session_id: nativeSessionId,
    native_session_kind: cleanText(event.native_session_kind, "session"),
    native_session_source: cleanText(event.native_session_source, "terminal-output"),
    native_session_title: nativeSessionTitle || providerBindings[agentId]?.native_session_title || "",
    native_session_title_source: nativeSessionTitle
      ? cleanText(event.native_session_title_source || event.source, "provider")
      : providerBindings[agentId]?.native_session_title_source || "",
    nativeSessionTitleUpdatedAt: nativeSessionTitle
      ? now
      : providerBindings[agentId]?.nativeSessionTitleUpdatedAt || "",
    native_session_updated_at: now,
    related_provider_session_ids: relatedProviderSessionIds.length
      ? relatedProviderSessionIds
      : cleanTextArray(providerBindings[agentId]?.related_provider_session_ids),
    shared_history_id: sharedHistoryId || providerBindings[agentId]?.shared_history_id || "",
    terminal_binding: sessionTerminalBinding || providerBindings[agentId]?.terminal_binding || existing.terminal_binding || null,
    updated_at: now,
  };
  const effectiveTerminalBinding = providerBindings[agentId]?.terminal_binding
    || sessionTerminalBinding
    || existing.terminal_binding
    || null;
  const terminalKey = getTerminalKeyForEvent(entry, {
    ...event,
    terminal_index: event.terminal_index
      ?? sessionTerminalBinding?.terminal_index
      ?? effectiveTerminalBinding?.terminal_index
      ?? existing.terminal_index,
    thread_id: threadId,
  });
  const terminals = { ...entry.terminals };
  if (terminalKey && terminals[terminalKey]) {
    const terminal = terminals[terminalKey];
    terminals[terminalKey] = normalizeActiveTerminal({
      ...terminal,
      activity_status: explicitRuntimeActivityStatus(event, "")
        || normalizeThreadActivityStatus(terminal.activity_status, "")
        || "idle",
      agent_id: agentId,
      agent_display_name: event.agent_display_name || terminal.agent_display_name,
      agent_type: event.agent_type || terminal.agent_type,
      instance_id: event.instance_id ?? terminal.instance_id,
      native_session_id: nativeSessionId,
      pane_id: event.pane_id || terminal.pane_id,
      provider: event.provider || terminal.provider,
      provider_session_id: nativeSessionId,
      fork_from_provider_session_id: forkFromProviderSessionId || terminal.fork_from_provider_session_id,
      related_provider_session_ids: relatedProviderSessionIds.length
        ? relatedProviderSessionIds
        : cleanTextArray(terminal.related_provider_session_ids),
      session_id: event.session_id || nativeSessionId,
      shared_history_id: sharedHistoryId || terminal.shared_history_id,
      terminal_index: normalizeTerminalIndex(
        event.terminal_index
          ?? terminal.terminal_index
          ?? sessionTerminalBinding?.terminal_index
          ?? existing.terminal_index,
      ),
      thread_id: threadId,
      updated_at: now,
    }) || {
      ...terminal,
      native_session_id: nativeSessionId,
      provider_session_id: nativeSessionId,
      session_id: event.session_id || nativeSessionId,
      thread_id: threadId,
      updated_at: now,
    };
  }

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [workspaceId]: {
      ...entry,
      terminals,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          provider_bindings: providerBindings,
          fork_from_provider_session_id: forkFromProviderSessionId || existing.fork_from_provider_session_id || "",
          related_provider_session_ids: relatedProviderSessionIds.length
            ? relatedProviderSessionIds
            : cleanTextArray(existing.related_provider_session_ids),
          shared_history_id: sharedHistoryId || existing.shared_history_id || "",
          session_name: nativeSessionTitle || existing.session_name,
          terminal_binding: effectiveTerminalBinding,
          terminal_index: effectiveTerminalBinding?.terminal_index ?? existing.terminal_index,
          title: nativeSessionTitle || existing.title,
          transcript_session_id: nativeSessionId || existing.transcript_session_id,
          updated_at: now,
        },
      },
    },
  }, workspaceId);
}

export function invalidateWorkspaceThreadProviderSession(state, event = {}) {
  const workspaceId = cleanText(event.workspace_id);
  const threadId = cleanText(event.thread_id);
  const agentId = cleanAgentId(event.agent_id || event.current_agent, "");
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
    event.native_session_id
      || event.provider_session_id
      || event.session_id
      || existing.transcript_session_id,
  );
  const providerBindings = normalizeProviderBindings(
    existing.provider_bindings,
    existing.current_agent,
    {
      coordination: existing.coordination,
      last_active_at: existing.last_active_at,
      last_message_at: existing.last_message_at,
      message_count: existing.message_count,
      status: existing.status,
      terminal_binding: existing.terminal_binding,
      updated_at: existing.updated_at,
    },
  );
  const providerBinding = normalizeProviderBinding(providerBindings[agentId], agentId, {
    coordination: existing.coordination,
    last_active_at: existing.last_active_at,
    last_message_at: existing.last_message_at,
    message_count: existing.message_count,
    status: existing.status,
    terminal_binding: existing.terminal_binding,
    updated_at: existing.updated_at,
  });
  const bindingSessionId = cleanText(providerBinding?.native_session_id);
  const transcriptSessionId = cleanText(existing.transcript_session_id);
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
    activity_status: "idle",
    input_ready: false,
    input_ready_at: "",
    input_ready_confidence: "",
    status: "idle",
    terminal_binding: null,
    updated_at: now,
  };
  if (shouldClearBindingSession) {
    nextProviderBinding.native_session_id = "";
    nextProviderBinding.native_session_kind = "";
    nextProviderBinding.native_session_source = "";
    nextProviderBinding.native_session_updated_at = now;
  }
  providerBindings[agentId] = nextProviderBinding;

  const shouldClearTranscriptSession = Boolean(
    existing.transcript_session_id
      && (!invalidSessionId || existing.transcript_session_id === invalidSessionId),
  );
  const latestTurn = normalizeThreadLatestTurn(existing.latest_turn);
  const nextLatestTurn = latestTurn?.state === "running"
    ? normalizeThreadLatestTurn({
      ...latestTurn,
      completed_at: now,
      error: cleanText(event.error || "Provider session was not available locally."),
      state: "interrupted",
      updated_at: now,
    })
    : existing.latest_turn;

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [workspaceId]: {
      ...entry,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          activity_status: "idle",
          latest_turn: nextLatestTurn,
          provider_bindings: providerBindings,
          status: existing.status === "active" ? "idle" : existing.status,
          terminal_binding: null,
          transcript_session_id: shouldClearTranscriptSession ? "" : existing.transcript_session_id,
          transcript_status: shouldClearTranscriptSession ? "idle" : existing.transcript_status,
          updated_at: now,
        },
      },
    },
  }, workspaceId);
}

export function updateWorkspaceThreadProviderModel(state, event = {}) {
  const workspaceId = cleanText(event.workspace_id);
  const threadId = cleanText(event.thread_id);
  const agentId = cleanAgentId(event.agent_id || event.current_agent, "");
  const modelId = cleanModelId(event.model_id || event.model);
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
    existing.provider_bindings,
    existing.current_agent,
    {
      coordination: existing.coordination,
      last_active_at: existing.last_active_at,
      last_message_at: existing.last_message_at,
      message_count: existing.message_count,
      status: existing.status,
      terminal_binding: existing.terminal_binding,
      updated_at: existing.updated_at,
    },
  );
  providerBindings[agentId] = {
    ...normalizeProviderBinding(providerBindings[agentId], agentId, {
      coordination: existing.coordination,
      last_active_at: existing.last_active_at,
      last_message_at: existing.last_message_at,
      message_count: existing.message_count,
      status: existing.status,
      terminal_binding: existing.current_agent === agentId ? existing.terminal_binding : null,
      updated_at: existing.updated_at,
    }),
    model_id: modelId,
    model_source: cleanText(event.model_source, "user"),
    modelUpdatedAt: now,
    updated_at: now,
  };

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [workspaceId]: {
      ...entry,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          provider_bindings: providerBindings,
          updated_at: now,
        },
      },
    },
  }, workspaceId);
}

export function clearWorkspaceThreadPendingPrompt(state, event = {}) {
  const workspaceId = cleanText(event.workspace_id);
  const threadId = cleanText(event.thread_id);
  if (!workspaceId || !threadId) {
    return state || {};
  }

  const target = getWorkspaceThreadUpdateTarget(state, workspaceId, threadId);
  if (!target) {
    return state || {};
  }
  const { currentState, entry, existing } = target;
  if (!existing?.pending_prompt) {
    return state || {};
  }

  const promptId = cleanText(event.prompt_event_id || event.pending_prompt_id || event.prompt_id);
  if (promptId && !workspaceThreadPromptIdsMatch(existing.pending_prompt.id, promptId)) {
    return state || {};
  }

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [workspaceId]: {
      ...entry,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          pending_prompt: null,
          updated_at: nowIso(),
        },
      },
    },
  }, workspaceId);
}

function threadMessageTimestampMs(message) {
  const createdAt = String(message?.created_at || "").trim();
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
  const workspaceId = cleanText(event.workspace_id);
  const threadId = cleanText(event.thread_id);
  const agentId = cleanAgentId(event.agent_id || event.current_agent || "codex", "");
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
  const sessionId = cleanText(event.session_id || event.provider_session_id || event.native_session_id);
  const requestedProviderSessionId = cleanText(event.requested_provider_session_id || event.requested_native_session_id);
  const matchedBy = cleanText(event.matched_by).toLowerCase();
  if (
    existing.transcript_hydration_mode === "session-only"
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
  const sessionTitle = cleanRealThreadTitleCandidate(event.session_title, existing);
  const existingTitle = cleanRealThreadTitleCandidate(existing.title, existing);
  const existingSessionName = cleanRealThreadTitleCandidate(existing.session_name, existing);
  const title = sessionTitle || existingTitle || existingSessionName || defaultThreadTitle(existing.terminal_index, agentId);
  const projectionEventsToAdd = createProjectionEventsFromTranscript(existing, event.messages, {
    agent_id: agentId,
    completed_at: event.completed_at,
    expected_message_created_at: event.expected_message_created_at,
    expected_user_message: event.expected_user_message,
    latest_timestamp: event.latest_timestamp,
    matched_by: event.matched_by,
    prefer_live_hook_assistant_messages: event.prefer_live_hook_assistant_messages,
    prompt_epoch: event.prompt_epoch,
    prompt_event_id: event.prompt_event_id || event.pending_prompt_id || event.prompt_id,
    prompt_accepted: event.prompt_accepted,
    prompt_event_submitted_at: event.prompt_event_submitted_at,
    source: cleanText(event.source, `${agentId}-session`),
    submitted_at: event.submitted_at,
    allow_transcript_turn_completion: event.allow_transcript_turn_completion,
    assistant_response_completes_turn: event.assistant_response_completes_turn,
    transcript_completion_can_settle_turn: event.transcript_completion_can_settle_turn,
    transcript_explicit_completion_can_settle_turn: event.transcript_explicit_completion_can_settle_turn,
    turn_complete_seen: event.turn_complete_seen,
  });
  const projectionEvents = appendThreadProjectionEvents(
    ensureThreadProjectionEvents(existing),
    projectionEventsToAdd,
  );
  const messages = projectThreadProjectionMessagesFromNormalizedEvents(projectionEvents, existing.messages);
  const lifecycleExisting = rawExisting || existing;
  const existingLatestTurn = normalizeThreadLatestTurn(lifecycleExisting.latest_turn);
  const projectedLatestTurn = projectLatestTurnFromNormalizedEvents(projectionEvents, existingLatestTurn);
  const preservedLatestTurn = preserveRunningLatestTurnWhenTranscriptCompletionBlocked(
    existingLatestTurn,
    projectedLatestTurn,
    event,
  );
  const latestTurn = preservedLatestTurn.latest_turn;
  const pendingPrompt = CLOSED_THREAD_TURN_STATES.has(latestTurn?.state)
    ? null
    : lifecycleExisting.pending_prompt || existing.pending_prompt;
  const activityStatus = activityStatusForLatestTurn(latestTurn, "idle");
  const lastMessageAt = messages.length
    ? messages[messages.length - 1].created_at
    : existing.last_message_at;
  const providerBindings = normalizeProviderBindings(
    existing.provider_bindings,
    existing.current_agent,
    {
      activity_status: activityStatus,
      coordination: existing.coordination,
      last_active_at: existing.last_active_at,
      last_message_at: lastMessageAt,
      message_count: messages.length,
      status: existing.status,
      terminal_binding: existing.terminal_binding,
      updated_at: now,
    },
  );

  if (sessionId && providerBindings[agentId]) {
    providerBindings[agentId] = {
      ...providerBindings[agentId],
      activity_status: activityStatus,
      native_session_id: sessionId,
      native_session_kind: "session",
      native_session_source: cleanText(event.source, "codex-rollout"),
      native_session_title: sessionTitle || providerBindings[agentId].native_session_title || "",
      native_session_title_source: sessionTitle
        ? cleanText(event.source, `${agentId}-session`)
        : providerBindings[agentId].native_session_title_source || "",
      nativeSessionTitleUpdatedAt: sessionTitle
        ? now
        : providerBindings[agentId].nativeSessionTitleUpdatedAt || now,
      native_session_updated_at: now,
      updated_at: now,
    };
  } else if (providerBindings[agentId]) {
    providerBindings[agentId] = {
      ...providerBindings[agentId],
      activity_status: activityStatus,
      updated_at: now,
    };
  }

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [workspaceId]: {
      ...entry,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          activity_status: activityStatus,
          last_message_at: lastMessageAt,
          latest_turn: latestTurn,
          materialized: true,
          message_count: messages.length,
          messages,
          pending_prompt: pendingPrompt,
          projection_events: projectionEvents,
          provider_bindings: providerBindings,
          session_name: sessionTitle || existingSessionName || existingTitle || title,
          title,
          transcriptHydratedAt: now,
          transcriptLatestTimestamp: cleanText(event.latest_timestamp),
          transcript_session_id: sessionId || existing.transcript_session_id,
          transcriptSourcePath: cleanText(event.source_path || event.rollout_path),
          transcript_status: "ready",
          updated_at: now,
        },
      },
    },
  }, workspaceId);
}

export function appendWorkspaceThreadProjectionEvents(state, event = {}) {
  const workspaceId = cleanText(event.workspace_id);
  const threadId = cleanText(event.thread_id);
  const agentId = cleanAgentId(event.agent_id || event.current_agent, "");
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
    event.projection_events || event.events || [],
  );
  const messages = projectThreadProjectionMessagesFromNormalizedEvents(projectionEvents, existing.messages);
  const projectedLatestTurn = projectLatestTurnFromNormalizedEvents(projectionEvents, existing.latest_turn);
  const shouldClearOrphanRunning = isOrphanRunningThreadState({
    latest_turn: projectedLatestTurn,
    message_count: messages.length,
    messages,
    pending_prompt: event.clear_pending_prompt === false ? existing.pending_prompt : null,
    projection_events: projectionEvents,
    provider_bindings: existing.provider_bindings,
    transcript_session_id: cleanText(event.provider_session_id || event.native_session_id, existing.transcript_session_id),
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
  const existingProviderBindingForAgent = normalizeProviderBinding(existing.provider_bindings?.[agentId], agentId, {
    activity_status: existing.activity_status,
    coordination: existing.coordination,
    last_active_at: existing.last_active_at,
    last_message_at: existing.last_message_at,
    message_count: existing.message_count,
    status: existing.status,
    terminal_binding: existing.terminal_binding,
    updated_at: existing.updated_at,
  });
  const terminalReadinessIgnoredEvent = eventType === "terminal-input-ready"
    || eventType === "terminal-prompt-ready";
  const marksInputReady = !terminalReadinessIgnoredEvent && (event.input_ready === true
    || eventType === "provider-turn-completed"
    || eventType === "provider-turn-interrupted"
    || eventType === "provider-turn-error");
  const inputReady = marksInputReady
    ? true
    : eventType === "provider-turn-started"
      ? false
      : Boolean(event.input_ready ?? existingProviderBindingForAgent?.input_ready);
  const inputReadyAt = inputReady
    ? cleanText(event.input_ready_at, existingProviderBindingForAgent?.input_ready_at)
    : "";
  const inputReadyConfidence = inputReady
    ? cleanText(
      event.input_ready_confidence,
      existingProviderBindingForAgent?.input_ready_confidence,
    )
    : "";
  const providerPromptingFields = promptingUserFieldsForTerminalEvent(event, existingProviderBindingForAgent, {
    clear: terminalReadinessIgnoredEvent ? false : !inputReady || marksInputReady,
    event_type: eventType,
  });
  const eventAgentType = cleanAgentDisplayName(
    event.agent_type,
    existingProviderBindingForAgent?.agent_type,
  );
  const eventAgentDisplayName = cleanAgentDisplayName(
    event.agent_display_name || eventAgentType,
    existingProviderBindingForAgent?.agent_display_name,
  );
  const eventProvider = cleanAgentDisplayName(
    event.provider,
    existingProviderBindingForAgent?.provider,
  );
  const eventForkFromProviderSessionId = cleanText(
    event.fork_from_provider_session_id || event.forked_from_provider_session_id || event.parent_provider_session_id,
  );
  const eventSharedHistoryId = cleanText(event.shared_history_id || event.history_group_id);
  const eventRelatedProviderSessionIds = cleanTextArray(
    event.related_provider_session_ids,
    event.related_session_ids,
    eventForkFromProviderSessionId,
  );
  const shouldClearPendingPrompt = event.clear_pending_prompt !== false;
  let providerBindings = normalizeProviderBindings(
    existing.provider_bindings,
    existing.current_agent,
    {
      activity_status: activityStatus,
      coordination: existing.coordination,
      last_active_at: now,
      last_message_at: messages.length ? messages[messages.length - 1].created_at : existing.last_message_at,
      message_count: messages.length,
      status: existing.status,
      terminal_binding: existing.terminal_binding,
      updated_at: now,
    },
  );
  if (shouldClearOrphanRunning) {
    providerBindings = clearOrphanRunningProviderBindings(providerBindings);
  }
  if (providerBindings[agentId]) {
    providerBindings[agentId] = {
      ...providerBindings[agentId],
      activity_status: activityStatus,
      agent_display_name: eventAgentDisplayName,
      agent_type: eventAgentType,
      last_active_at: now,
      last_message_at: messages.length ? messages[messages.length - 1].created_at : providerBindings[agentId].last_message_at,
      message_count: messages.length,
      input_ready: inputReady,
      input_ready_at: inputReadyAt,
      input_ready_confidence: inputReadyConfidence,
      fork_from_provider_session_id: eventForkFromProviderSessionId || providerBindings[agentId].fork_from_provider_session_id || "",
      ...hookHealthFields(event, providerBindings[agentId]),
      ...providerPromptingFields,
      model_id: cleanModelId(event.model_id || event.model, providerBindings[agentId].model_id),
      model_source: cleanModelId(event.model_id || event.model) ? cleanText(event.model_source, "provider-turn") : providerBindings[agentId].model_source,
      modelUpdatedAt: cleanModelId(event.model_id || event.model) ? now : providerBindings[agentId].modelUpdatedAt,
      native_session_id: cleanText(event.native_session_id || event.provider_session_id, providerBindings[agentId].native_session_id),
      native_session_kind: cleanText(event.native_session_kind, providerBindings[agentId].native_session_kind || "session"),
      native_session_source: cleanText(event.native_session_source, providerBindings[agentId].native_session_source || "provider-turn"),
      native_session_updated_at: cleanText(event.native_session_id || event.provider_session_id) ? now : providerBindings[agentId].native_session_updated_at,
      provider: eventProvider,
      related_provider_session_ids: eventRelatedProviderSessionIds.length
        ? eventRelatedProviderSessionIds
        : cleanTextArray(providerBindings[agentId].related_provider_session_ids),
      shared_history_id: eventSharedHistoryId || providerBindings[agentId].shared_history_id || "",
      status: cleanText(event.status, existing.status || providerBindings[agentId].status || "active"),
      updated_at: now,
    };
  }

  const terminalKey = getTerminalKeyForEvent(entry, event);
  const terminals = { ...entry.terminals };
  if (terminalKey && terminals[terminalKey]) {
    const terminalPromptingFields = promptingUserFieldsForTerminalEvent(event, terminals[terminalKey], {
      clear: terminalReadinessIgnoredEvent ? false : !inputReady || marksInputReady,
      event_type: eventType,
    });
    terminals[terminalKey] = {
      ...terminals[terminalKey],
      activity_status: activityStatus,
      command_phase: cleanText(event.command_phase, terminals[terminalKey].command_phase),
      execution_phase: cleanText(event.execution_phase, terminals[terminalKey].execution_phase),
      input_ready: inputReady,
      input_ready_at: inputReadyAt,
      input_ready_confidence: inputReadyConfidence,
      ...hookHealthFields(event, terminals[terminalKey]),
      agent_display_name: cleanAgentDisplayName(
        event.agent_display_name || eventAgentType,
        terminals[terminalKey].agent_display_name,
      ),
      agent_type: cleanAgentDisplayName(event.agent_type, terminals[terminalKey].agent_type),
      ...terminalPromptingFields,
      native_rail_state: cleanText(event.native_rail_state, terminals[terminalKey].native_rail_state),
      provider: cleanAgentDisplayName(event.provider, terminals[terminalKey].provider),
      fork_from_provider_session_id: eventForkFromProviderSessionId || terminals[terminalKey].fork_from_provider_session_id || "",
      provider_session_id: cleanText(
        event.provider_session_id || event.native_session_id,
        terminals[terminalKey].provider_session_id,
      ),
      native_session_id: cleanText(
        event.native_session_id || event.provider_session_id,
        terminals[terminalKey].native_session_id,
      ),
      related_provider_session_ids: eventRelatedProviderSessionIds.length
        ? eventRelatedProviderSessionIds
        : cleanTextArray(terminals[terminalKey].related_provider_session_ids),
      session_id: cleanText(
        event.session_id || event.provider_session_id || event.native_session_id,
        terminals[terminalKey].session_id,
      ),
      shared_history_id: eventSharedHistoryId || terminals[terminalKey].shared_history_id || "",
      turn_status: cleanText(event.turn_status, terminals[terminalKey].turn_status),
      updated_at: now,
    };
  }

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [workspaceId]: {
      ...entry,
      active_thread_id: threadId,
      terminals,
      threads: {
        ...entry.threads,
        [threadId]: {
          ...existing,
          activity_status: activityStatus,
          last_active_at: now,
          last_message_at: messages.length ? messages[messages.length - 1].created_at : existing.last_message_at,
          latest_turn: latestTurn,
          materialized: true,
          message_count: messages.length,
          messages,
          pending_prompt: shouldClearPendingPrompt ? null : existing.pending_prompt,
          projection_events: projectionEvents,
          provider_bindings: providerBindings,
          fork_from_provider_session_id: eventForkFromProviderSessionId || existing.fork_from_provider_session_id || "",
          related_provider_session_ids: eventRelatedProviderSessionIds.length
            ? eventRelatedProviderSessionIds
            : cleanTextArray(existing.related_provider_session_ids),
          shared_history_id: eventSharedHistoryId || existing.shared_history_id || "",
          status: cleanText(event.status, existing.status || "active"),
          transcript_session_id: cleanText(event.provider_session_id || event.native_session_id, existing.transcript_session_id),
          updated_at: now,
        },
      },
    },
  }, workspaceId);
}

export function markWorkspaceThreadAgentActivity(state, event = {}) {
  const workspaceId = cleanText(event.workspace_id);
  const threadId = cleanText(event.thread_id);
  const agentId = cleanAgentId(event.agent_id || event.current_agent, "");
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
    existing.provider_bindings,
    existing.current_agent,
    {
      activity_status: existing.activity_status,
      coordination: existing.coordination,
      last_active_at: existing.last_active_at,
      last_message_at: existing.last_message_at,
      message_count: existing.message_count,
      status: existing.status,
      terminal_binding: existing.terminal_binding,
      updated_at: existing.updated_at,
    },
  );
  const previousProviderBinding = normalizeProviderBinding(providerBindings[agentId], agentId, {
    activity_status: existing.activity_status,
    coordination: existing.coordination,
    last_active_at: existing.last_active_at,
    last_message_at: existing.last_message_at,
    message_count: existing.message_count,
    status: existing.status,
    terminal_binding: existing.current_agent === agentId ? existing.terminal_binding : null,
    updated_at: existing.updated_at,
  });
  const explicitInputReady = typeof event.input_ready === "boolean" ? event.input_ready : null;
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
      : Boolean(previousProviderBinding?.input_ready);
  const inputReadyAt = inputReady
    ? cleanText(event.input_ready_at, previousProviderBinding?.input_ready_at || now)
    : "";
  const inputReadyConfidence = inputReady
    ? cleanText(
      event.input_ready_confidence,
      previousProviderBinding?.input_ready_confidence,
    )
    : "";
  const providerPromptingFields = promptingUserFieldsForTerminalEvent(event, previousProviderBinding, {
    clear: terminalReadinessIgnoredEvent ? false : !inputReady || marksInputReady,
    event_type: eventType,
  });
  const eventAgentType = cleanAgentDisplayName(
    event.agent_type,
    previousProviderBinding?.agent_type,
  );
  const eventAgentDisplayName = cleanAgentDisplayName(
    event.agent_display_name || eventAgentType,
    previousProviderBinding?.agent_display_name,
  );
  const eventProvider = cleanAgentDisplayName(event.provider, previousProviderBinding?.provider);
  providerBindings[agentId] = {
    ...previousProviderBinding,
    activity_status: activityStatus,
    agent_display_name: eventAgentDisplayName,
    agent_type: eventAgentType,
    ...hookHealthFields(event, previousProviderBinding),
    input_ready: inputReady,
    input_ready_at: inputReadyAt,
    input_ready_confidence: inputReadyConfidence,
    ...providerPromptingFields,
    provider: eventProvider,
    status: providerStatus,
    updated_at: now,
  };
  const terminalKey = getTerminalKeyForEvent(entry, event);
  const terminals = { ...entry.terminals };
  let previousTerminal = null;
  if (terminalKey && terminals[terminalKey]) {
    previousTerminal = terminals[terminalKey];
    const terminalPromptingFields = promptingUserFieldsForTerminalEvent(event, terminals[terminalKey], {
      clear: terminalReadinessIgnoredEvent ? false : !inputReady || marksInputReady,
      event_type: eventType,
    });
    terminals[terminalKey] = {
      ...terminals[terminalKey],
      input_ready: inputReady,
      input_ready_at: inputReadyAt,
      input_ready_confidence: inputReadyConfidence,
      ...hookHealthFields(event, terminals[terminalKey]),
      agent_display_name: cleanAgentDisplayName(
        event.agent_display_name || eventAgentType,
        terminals[terminalKey].agent_display_name,
      ),
      agent_type: cleanAgentDisplayName(event.agent_type, terminals[terminalKey].agent_type),
      ...terminalPromptingFields,
      provider: cleanAgentDisplayName(event.provider, terminals[terminalKey].provider),
      status: eventStatus || terminals[terminalKey].status,
      updated_at: now,
    };
  }
  const nextThreadActivityStatus = existing.current_agent === agentId ? activityStatus : existing.activity_status;
  const nextThreadStatus = existing.current_agent === agentId && eventStatus ? eventStatus : existing.status;
  const threadSemanticallyUnchanged = workspaceThreadActivitySemanticallyEqual(
    {
      activity_status: existing.activity_status,
      provider_bindings: existing.provider_bindings,
      status: existing.status,
    },
    {
      activity_status: nextThreadActivityStatus,
      provider_bindings: providerBindings,
      status: nextThreadStatus,
    },
  );
  const terminalSemanticallyUnchanged = !previousTerminal || workspaceThreadActivitySemanticallyEqual(
    previousTerminal,
    terminals[terminalKey],
  );
  if (
    threadSemanticallyUnchanged
    && terminalSemanticallyUnchanged
    && workspaceThreadIdenticalActivityStampIsThrottled(
      now,
      existing,
      previousProviderBinding,
      previousTerminal,
    )
  ) {
    return state || {};
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
          activity_status: nextThreadActivityStatus,
          provider_bindings: providerBindings,
          status: nextThreadStatus,
          updated_at: now,
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
  if (terminal?.thread_id && entry.threads[terminal.thread_id]) {
    return entry.threads[terminal.thread_id];
  }

  const restoredThreadId = terminalKey ? entry.terminal_thread_ids?.[terminalKey] : "";
  if (restoredThreadId && entry.threads[restoredThreadId]) {
    return entry.threads[restoredThreadId];
  }

  const activeThread = entry.threads[entry.active_thread_id];
  if (
    activeThread?.terminal_binding?.terminal_index === safeTerminalIndex
    || (activeThread?.terminal_index === safeTerminalIndex && activeThread.status === "starting")
  ) {
    return activeThread;
  }

  const liveThread = Object.values(entry.threads)
    .filter((thread) => (
      thread.terminal_binding?.terminal_index === safeTerminalIndex
      || (thread.terminal_index === safeTerminalIndex && thread.status === "starting")
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
  const terminalIndex = normalizeTerminalIndex(target.terminal_index);
  const paneId = cleanText(target.pane_id);
  const instanceId = Number.parseInt(target.instance_id, 10);
  const bindings = [
    providerBinding?.terminal_binding,
    thread?.terminal_binding,
  ]
    .map((binding) => normalizeTerminalBinding(binding))
    .filter(Boolean);

  return bindings.some((binding) => {
    const indexMatches = terminalIndex == null
      || normalizeTerminalIndex(binding.terminal_index) === terminalIndex;
    const paneMatches = !paneId || binding.pane_id === paneId;
    const instanceMatches = !Number.isInteger(instanceId)
      || Number(binding.instance_id) === instanceId;
    return indexMatches && paneMatches && instanceMatches;
  });
}

function workspaceThreadLiveSelectionScore(thread, providerBinding, target = {}) {
  const liveThreadId = cleanText(target.thread_id);
  const terminalIndex = normalizeTerminalIndex(target.terminal_index);
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

  const terminalIndex = normalizeTerminalIndex(target.terminal_index);
  const terminalKey = terminalSessionKey(terminalIndex);
  const terminal = terminalKey ? entry.terminals?.[terminalKey] || null : null;
  const agentId = cleanAgentId(target.agent_id || target.current_agent || terminal?.agent_id, "");
  const providerSessionId = cleanText(
    target.provider_session_id || target.native_session_id || target.session_id,
  );
  const liveThreadId = cleanText(target.thread_id || terminal?.thread_id);
  const threads = Object.values(entry.threads).filter((thread) => {
    if (!thread?.id || workspaceEntryHasArchivedThreadId(entry, thread.id)) {
      return false;
    }
    if (!agentId) {
      return true;
    }
    return cleanAgentId(thread.current_agent) === agentId
      || Boolean(thread.provider_bindings?.[agentId]);
  });

  if (providerSessionId) {
    const sessionThread = threads
      .filter((thread) => workspaceThreadHasProviderSession(thread, agentId, providerSessionId))
      .sort((left, right) => {
        const leftBinding = getWorkspaceThreadProviderBinding(left, agentId);
        const rightBinding = getWorkspaceThreadProviderBinding(right, agentId);
        return workspaceThreadLiveSelectionScore(right, rightBinding, {
          ...target,
          thread_id: liveThreadId,
        }) - workspaceThreadLiveSelectionScore(left, leftBinding, {
          ...target,
          thread_id: liveThreadId,
        });
      })[0] || null;
    return cleanText(sessionThread?.id);
  }

  const directThread = liveThreadId ? entry.threads[liveThreadId] : null;
  if (
    directThread
    && !getWorkspaceThreadHasSession(directThread)
    && (!agentId || cleanAgentId(directThread.current_agent) === agentId || directThread.provider_bindings?.[agentId])
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
        thread_id: liveThreadId,
      }) - workspaceThreadLiveSelectionScore(left, leftBinding, {
        ...target,
        thread_id: liveThreadId,
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
  entry.archived_threads[safeThreadId] = archiveThreadRecord(existing, archivedAt);
  entry.archived_thread_order = [
    safeThreadId,
    ...entry.archived_thread_order.filter((candidateId) => candidateId !== safeThreadId),
  ];
  delete entry.threads[safeThreadId];
  forgetThreadEverywhere(entry, safeThreadId);
  entry.thread_order = entry.thread_order.filter((candidateId) => candidateId !== safeThreadId);
  Object.entries(entry.terminals).forEach(([terminalKey, terminal]) => {
    if (terminal.thread_id === safeThreadId) {
      entry.terminals[terminalKey] = {
        ...terminal,
        thread_id: "",
        updated_at: nowIso(),
      };
    }
  });
  if (entry.active_thread_id === safeThreadId) {
    entry.active_thread_id = entry.thread_order[0] || "";
  }
  if (entry.threads_view?.selectedThreadId === safeThreadId) {
    entry.threads_view = {
      ...normalizeThreadsViewState(entry.threads_view, {
        selectedThreadId: entry.active_thread_id,
        selected_workspace_id: safeWorkspaceId,
      }),
      newChatActive: false,
      selectedThreadId: entry.active_thread_id || "",
      selected_workspace_id: safeWorkspaceId,
    };
  }

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [safeWorkspaceId]: entry,
  }, safeWorkspaceId);
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
  const archivedThread = entry.archived_threads[safeThreadId];
  if (!activeThread && !archivedThread) {
    return state || {};
  }

  delete entry.threads[safeThreadId];
  delete entry.archived_threads[safeThreadId];
  forgetThreadEverywhere(entry, safeThreadId);
  entry.thread_order = entry.thread_order.filter((candidateId) => candidateId !== safeThreadId);
  entry.archived_thread_order = entry.archived_thread_order
    .filter((candidateId) => candidateId !== safeThreadId);
  Object.entries(entry.terminals).forEach(([terminalKey, terminal]) => {
    if (terminal.thread_id === safeThreadId) {
      entry.terminals[terminalKey] = {
        ...terminal,
        thread_id: "",
        updated_at: nowIso(),
      };
    }
  });
  if (entry.active_thread_id === safeThreadId) {
    entry.active_thread_id = entry.thread_order[0] || "";
  }
  if (entry.threads_view?.selectedThreadId === safeThreadId) {
    entry.threads_view = {
      ...normalizeThreadsViewState(entry.threads_view, {
        selectedThreadId: entry.active_thread_id,
        selected_workspace_id: safeWorkspaceId,
      }),
      newChatActive: false,
      selectedThreadId: entry.active_thread_id || "",
      selected_workspace_id: safeWorkspaceId,
    };
  }

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [safeWorkspaceId]: entry,
  }, safeWorkspaceId);
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
    updated_at: nowIso(),
  };

  return markWorkspaceThreadsMutationResult(state, {
    ...currentState,
    [safeWorkspaceId]: entry,
  }, safeWorkspaceId);
}

function getThreadSessionLabel(thread) {
  if (!thread) {
    return "";
  }

  const agentId = cleanAgentId(thread.current_agent, "");
  const providerBinding = agentId
    ? getWorkspaceThreadProviderBinding(thread, agentId)
    : null;
  return [
    providerBinding?.native_session_id,
    thread.transcript_session_id,
    thread.coordination?.session_id,
  ]
    .map(cleanThreadLabelCandidate)
    .find(Boolean) || "";
}

export function getWorkspaceThreadHasSession(thread) {
  if (!thread) {
    return false;
  }

  if (cleanText(thread.transcript_session_id)) {
    return true;
  }

  return Object.values(thread.provider_bindings || {}).some((binding) => (
    Boolean(cleanText(binding?.native_session_id))
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

  const currentAgent = cleanAgentId(thread.current_agent, "");
  const agents = [
    currentAgent,
    ...THREAD_AGENT_IDS.filter((agentId) => agentId !== currentAgent),
  ].filter(Boolean);

  for (const agentId of agents) {
    const providerBinding = getWorkspaceThreadProviderBinding(thread, agentId);
    const title = cleanRealThreadTitleCandidate(providerBinding?.native_session_title, thread);
    if (title) {
      return title;
    }
  }

  return "";
}

function getThreadStoredTitleLabel(thread) {
  return [
    thread?.title,
    thread?.session_name,
  ]
    .map((candidate) => cleanRealThreadTitleCandidate(candidate, thread))
    .find(Boolean) || "";
}

function getThreadPromptFallbackLabel(thread) {
  const pendingLabel = getWorkspaceThreadPromptLabel(thread?.pending_prompt?.text, "");
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

  return cleanRealThreadTitleCandidate(thread?.session_name || thread?.title, thread)
    || defaultThreadTitle(getThreadTerminalIndex(thread) || 0, thread?.current_agent || DEFAULT_AGENT_ID);
}

export function getWorkspaceThreadProviderBinding(thread, agentId) {
  const safeAgentId = cleanAgentId(agentId || thread?.current_agent, "");
  if (!thread || !isThreadAgentId(safeAgentId)) {
    return null;
  }

  return normalizeProviderBinding(thread.provider_bindings?.[safeAgentId], safeAgentId, {
    coordination: thread.coordination,
    last_active_at: thread.last_active_at,
    last_message_at: thread.last_message_at,
    message_count: thread.message_count,
    status: thread.status,
    terminal_binding: thread.current_agent === safeAgentId ? thread.terminal_binding : null,
    updated_at: thread.updated_at,
  });
}

export function getWorkspaceThreadTurnState(thread) {
  return normalizeThreadLatestTurn(thread?.latest_turn)?.state || "";
}

export { THREAD_AGENT_IDS, WORKSPACE_THREADS_STORAGE_KEY };

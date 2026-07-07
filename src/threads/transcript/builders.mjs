// Pure transcript row builders for the Diff Forge dashboard transcript.
//
// Everything in this module is dependency-free and side-effect free so it can
// run under `node --test` directly. It consumes the transcript items produced
// by the dashboard's durable-record pipeline (type: message | assistantBlock |
// activityGroup | reasoning | divider | command) plus the raw normalized
// message list, and produces a flat, virtualizable row list with turn
// grouping, turn folding, and fold-header summaries.
//
// v1 records (plain role/content messages) and v2 canonical messages
// (structured tool / file_change / subagent / usage / truncated) are both
// supported by feature-detecting field presence, mirroring the dashboard's
// agentChatMessageTool / agentChatMessageFileChange / agentChatMessageSubagent
// detectors.

/* ------------------------------------------------------------------ */
/* Value helpers (mirrors of the dashboard's tolerant readers)         */
/* ------------------------------------------------------------------ */

export function transcriptText(value, fallback = "") {
  if (typeof value !== "string" && typeof value !== "number") {
    return fallback;
  }
  const cleaned = String(value).replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  return cleaned || fallback;
}

export function transcriptToken(value) {
  return transcriptText(value).toLowerCase().replace(/[\s_]+/g, "-");
}

export function transcriptArray(value) {
  if (typeof value === "string") {
    try {
      return transcriptArray(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.values(value);
  return [];
}

export function transcriptBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = transcriptToken(value);
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

export function transcriptTimestampMs(value) {
  if (value == null || value === "") {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? (value < 1_000_000_000_000 ? value * 1000 : value) : null;
  }
  const text = String(value).trim();
  if (!text) {
    return null;
  }
  const numeric = Number(text.replace(/Z$/i, ""));
  if (Number.isFinite(numeric)) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function hasOwn(source = {}, key = "") {
  return Object.prototype.hasOwnProperty.call(source || {}, key);
}

function finiteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Message feature detection (v1 + v2)                                 */
/* ------------------------------------------------------------------ */

export function messageTool(message = {}) {
  return plainObject(message.tool || message.tool_call || message.toolCall);
}

export function messageFileChange(message = {}) {
  const source = plainObject(message.file_change || message.fileChange);
  const files = transcriptArray(
    source?.files
      || source?.changed_files
      || source?.changedFiles
      || message.files
      || message.changed_files
      || message.changedFiles,
  );
  if (!files.length) return null;
  return { ...(source || {}), files };
}

export function messageSubagent(message = {}) {
  const source = plainObject(message.subagent || message.subAgent);
  const hasFields = ["subagent_id", "subagentId", "sub_agent_id", "subAgentId"]
    .some((key) => hasOwn(message, key));
  if (!source && !hasFields) return null;
  const owner = source || message;
  const id = transcriptText(
    owner.subagent_id || owner.subagentId || owner.sub_agent_id || owner.subAgentId
      || (source ? owner.id : ""),
  );
  return {
    ...(source || {}),
    id,
    title: transcriptText(owner.title || owner.name || message.title),
    status: transcriptToken(owner.status || owner.state || message.status),
  };
}

export function messageUsage(message = {}) {
  return plainObject(message.usage || message.usage_report || message.usageReport);
}

export function messageTruncated(message = {}) {
  const hasFlag = ["truncated", "is_truncated", "isTruncated", "partial"]
    .some((key) => hasOwn(message, key));
  if (!hasFlag) return false;
  return transcriptBool(
    message.truncated ?? message.is_truncated ?? message.isTruncated ?? message.partial,
    false,
  );
}

export function messageKindToken(message = {}) {
  return transcriptToken(
    message.kind
      || message.message_kind
      || message.messageKind
      || message.content_kind
      || message.contentKind
      || message.type,
  );
}

export function messageContentText(message = {}, limit = 50000) {
  const value = message.content
    ?? message.text
    ?? message.message
    ?? message.response
    ?? message.markdown
    ?? "";
  if (typeof value === "string") return value.slice(0, limit);
  if (Array.isArray(value)) {
    return value
      .map((part) => (typeof part === "string" ? part : transcriptText(part?.text || part?.content)))
      .filter(Boolean)
      .join("\n")
      .slice(0, limit);
  }
  if (value && typeof value === "object") {
    return transcriptText(value.text || value.content || value.markdown, "").slice(0, limit);
  }
  return "";
}

export function messageIsError(message = {}) {
  const kind = messageKindToken(message);
  if (kind === "error") return true;
  const role = transcriptToken(message.role);
  return role === "error";
}

// Codex-internal context payloads that were synced as ordinary user messages
// before the desktop-side filter landed. New records are filtered at source;
// this defensively hides the historical ones at the normalizer level.
const INTERNAL_CONTEXT_USER_PREFIXES = Object.freeze([
  "# AGENTS.md instructions",
  "<INSTRUCTIONS>",
  "<!-- DIFFFORGE_AGENT_CONTRACT_BEGIN -->",
  "<environment_context>",
]);

export function isInternalContextUserMessage(message = {}) {
  if (transcriptToken(message.role) !== "user") return false;
  const text = messageContentText(message, 400).trimStart();
  if (!text) return false;
  return INTERNAL_CONTEXT_USER_PREFIXES.some((prefix) => text.startsWith(prefix));
}

/* ------------------------------------------------------------------ */
/* turn_summary contract (degrade gracefully when absent)              */
/* ------------------------------------------------------------------ */

export function isTurnSummaryMessage(message = {}) {
  return messageKindToken(message) === "turn-summary";
}

export function normalizeTurnSummary(message = {}) {
  if (!isTurnSummaryMessage(message)) return null;
  const turnId = transcriptText(message.turn_id || message.turnId);
  if (!turnId) return null;
  const usage = plainObject(message.usage || message.usage_report || message.usageReport) || null;
  const fileChangeSource = plainObject(message.file_change || message.fileChange);
  const files = transcriptArray(fileChangeSource?.files)
    .map(normalizeFileChangeFile)
    .filter(Boolean);
  const startedAtMs = transcriptTimestampMs(message.started_at || message.startedAt);
  const completedAtMs = transcriptTimestampMs(message.completed_at || message.completedAt);
  let durationMs = finiteNumber(message.duration_ms, message.durationMs);
  if (durationMs == null && Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)) {
    durationMs = Math.max(0, completedAtMs - startedAtMs);
  }
  return {
    turnId,
    startedAtMs,
    completedAtMs,
    durationMs,
    usage,
    fileChange: files.length
      ? { files, summary: transcriptText(fileChangeSource?.summary) }
      : null,
  };
}

export function extractTurnSummaries(messages = []) {
  const summaries = new Map();
  transcriptArray(messages).forEach((message) => {
    const summary = normalizeTurnSummary(message);
    if (summary) {
      summaries.set(summary.turnId, summary);
    }
  });
  return summaries;
}

/* ------------------------------------------------------------------ */
/* Usage aggregation                                                   */
/* ------------------------------------------------------------------ */

const USAGE_FIELDS = [
  ["inputTokens", ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"]],
  ["outputTokens", ["output_tokens", "outputTokens", "completion_tokens", "completionTokens"]],
  ["cacheReadTokens", ["cache_read_tokens", "cacheReadTokens", "cache_read_input_tokens"]],
  ["cacheWriteTokens", ["cache_write_tokens", "cacheWriteTokens", "cache_creation_input_tokens"]],
  ["costUsd", ["cost_usd", "costUsd"]],
];

export function normalizeUsage(usage = null) {
  const source = plainObject(usage);
  if (!source) return null;
  const normalized = {};
  let any = false;
  USAGE_FIELDS.forEach(([key, aliases]) => {
    const value = finiteNumber(...aliases.map((alias) => source[alias]));
    if (value != null) {
      normalized[key] = value;
      any = true;
    }
  });
  return any ? normalized : null;
}

export function addUsage(target = null, usage = null) {
  const normalized = normalizeUsage(usage);
  if (!normalized) return target;
  const next = { ...(target || {}) };
  Object.entries(normalized).forEach(([key, value]) => {
    next[key] = (Number.isFinite(next[key]) ? next[key] : 0) + value;
  });
  return next;
}

export function usageTotalsByTurn(messages = []) {
  const totals = new Map();
  transcriptArray(messages).forEach((message) => {
    if (isTurnSummaryMessage(message)) return;
    const usage = messageUsage(message);
    if (!usage) return;
    const turnId = transcriptText(message.turnId || message.turn_id);
    if (!turnId) return;
    totals.set(turnId, addUsage(totals.get(turnId) || null, usage));
  });
  return totals;
}

export function sessionUsageTotals({ stats = null, messages = [] } = {}) {
  const fromStats = normalizeUsage(stats)
    || normalizeUsage(plainObject(stats)?.usage)
    || normalizeUsage(plainObject(stats)?.totals);
  if (fromStats) return fromStats;
  let totals = null;
  extractTurnSummaries(messages).forEach((summary) => {
    if (summary.usage) {
      totals = addUsage(totals, summary.usage);
    }
  });
  return totals;
}

export function usageTotalTokens(usage = null) {
  const normalized = normalizeUsage(usage);
  if (!normalized) return null;
  const total = (normalized.inputTokens || 0) + (normalized.outputTokens || 0);
  return total > 0 ? total : null;
}

/* ------------------------------------------------------------------ */
/* File-change normalization                                           */
/* ------------------------------------------------------------------ */

export function normalizeFileChangeFile(file = {}) {
  if (typeof file === "string") {
    const path = transcriptText(file);
    return path ? { path, kind: "edit", additions: null, deletions: null } : null;
  }
  const source = plainObject(file);
  if (!source) return null;
  const path = transcriptText(source.path || source.file || source.name || source.to || source.from);
  if (!path) return null;
  return {
    path,
    kind: transcriptToken(source.kind || source.change_kind || source.changeKind || source.status) || "edit",
    additions: finiteNumber(source.additions, source.lines_added, source.linesAdded),
    deletions: finiteNumber(source.deletions, source.lines_removed, source.linesRemoved),
  };
}

export function fileChangeTotals(files = []) {
  let additions = 0;
  let deletions = 0;
  transcriptArray(files).forEach((file) => {
    additions += Math.max(0, Number(file?.additions) || 0);
    deletions += Math.max(0, Number(file?.deletions) || 0);
  });
  return { additions, deletions };
}

/* ------------------------------------------------------------------ */
/* Row flattening                                                      */
/* ------------------------------------------------------------------ */

export function transcriptItemDomId(item = {}, index = 0, prefix = "agent-thread-item") {
  const raw = transcriptText(item.id || item.message?.id || item.turnId || item.turn_id || index, `${index}`);
  const slug = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return `${prefix}-${index}-${slug || "item"}`;
}

function messageRowKind(message = {}) {
  if (messageTool(message)) return "tool";
  if (messageFileChange(message)) return "file-change";
  if (messageIsError(message)) return "error";
  const kind = messageKindToken(message);
  if (kind === "reasoning") return "reasoning";
  if (messageSubagent(message)) return "subagent-note";
  const role = transcriptToken(message.role);
  if (role === "user") return "user";
  const format = transcriptToken(message.format || message.content_format || message.contentFormat);
  if (format === "terminal") return "terminal-output";
  if (role === "activity") return "tool";
  return "assistant";
}

function rowTurnId(item = {}, message = {}) {
  return transcriptText(
    item.turnId
      || item.turn_id
      || message.turnId
      || message.turn_id
      || "",
  );
}

function rowTimestampMs(row = {}) {
  const message = row.message || {};
  return transcriptTimestampMs(
    message.timestamp || message.created_at || message.createdAt
      || row.item?.timestamp,
  );
}

// Flattens transcript items (including nested assistantBlock / activityGroup
// structures) into a single ordered list of typed rows. The first row of each
// top-level item carries the item's DOM id so external navigation (message
// rail) keeps working.
export function flattenTranscriptItems(items = [], { itemIdPrefix = "agent-thread-item" } = {}) {
  const rows = [];
  const pushRow = (row) => {
    rows.push(row);
    return row;
  };
  const walk = (item, keyPath, inheritedTurnId, domId) => {
    if (!item || typeof item !== "object") return;
    const type = transcriptToken(item.type || item.itemType || item.item_type) || "message";
    const baseKey = transcriptText(item.id, keyPath) || keyPath;
    if (type === "divider") {
      pushRow({
        kind: "divider",
        key: `divider:${baseKey}`,
        domId,
        turnId: "",
        item,
        message: null,
      });
      return;
    }
    if (type === "command") {
      pushRow({
        kind: "command",
        key: `command:${baseKey}`,
        domId,
        turnId: transcriptText(item.turnId || item.turn_id) || inheritedTurnId,
        item,
        message: item.message || null,
      });
      return;
    }
    if (type === "assistantblock" || type === "assistant-block") {
      const blockTurnId = transcriptText(item.turnId || item.turn_id) || inheritedTurnId;
      transcriptArray(item.items).forEach((child, childIndex) => {
        walk(child, `${baseKey}:${childIndex}`, blockTurnId, childIndex === 0 ? domId : undefined);
      });
      return;
    }
    if (type === "activitygroup" || type === "activity-group") {
      const groupTurnId = transcriptText(item.turnId || item.turn_id) || inheritedTurnId;
      transcriptArray(item.messages).forEach((message, messageIndex) => {
        if (isTurnSummaryMessage(message || {})) return;
        const kind = messageRowKind(message || {});
        if (kind === "user" && isInternalContextUserMessage(message || {})) return;
        pushRow({
          kind,
          key: `activity:${baseKey}:${transcriptText(message?.id, `${messageIndex}`)}`,
          domId: messageIndex === 0 ? domId : undefined,
          turnId: rowTurnId({ turnId: groupTurnId }, message || {}),
          item,
          message: message || {},
        });
      });
      return;
    }
    if (type === "reasoning") {
      pushRow({
        kind: "reasoning",
        key: `reasoning:${baseKey}`,
        domId,
        turnId: rowTurnId(item, item.message || {}) || inheritedTurnId,
        item,
        message: item.message || item,
      });
      return;
    }
    const message = item.message || item;
    if (isTurnSummaryMessage(message)) return;
    const messageKind = messageRowKind(message);
    if (messageKind === "user" && isInternalContextUserMessage(message)) return;
    pushRow({
      kind: messageKind,
      key: `message:${baseKey}`,
      domId,
      turnId: rowTurnId(item, message) || inheritedTurnId,
      item,
      message,
    });
  };
  transcriptArray(items).forEach((item, index) => {
    walk(item, `item-${index}`, "", transcriptItemDomId(item, index, itemIdPrefix));
  });
  return rows;
}

/* ------------------------------------------------------------------ */
/* Turn grouping                                                       */
/* ------------------------------------------------------------------ */

// Groups flat rows into turns. A new turn starts at every user/command row,
// and whenever an explicit turn id changes. Divider rows stand alone between
// turns (model changes / compaction markers are timeline-level). Recurring
// turn ids get per-occurrence keys so interleaved turns never collide.
export function groupRowsIntoTurns(rows = []) {
  const groups = [];
  const turnIdOccurrences = new Map();
  let current = null;
  let currentOpenedByAnchor = false;
  const close = () => {
    if (current) {
      groups.push(current);
      current = null;
    }
  };
  const occurrenceKey = (turnId) => {
    const occurrence = turnIdOccurrences.get(turnId) || 0;
    turnIdOccurrences.set(turnId, occurrence + 1);
    return `turn:${turnId}#${occurrence}`;
  };
  const open = (seedKey, openedByAnchor = false) => {
    currentOpenedByAnchor = openedByAnchor;
    current = {
      key: seedKey,
      turnId: "",
      rows: [],
    };
    return current;
  };
  transcriptArray(rows).forEach((row) => {
    if (row.kind === "divider") {
      close();
      groups.push({ key: `divider:${row.key}`, turnId: "", rows: [row], divider: true });
      return;
    }
    const isAnchor = row.kind === "user" || row.kind === "command";
    if (isAnchor) {
      close();
      open(`turn:${row.key}`, true);
    } else if (
      current
      && row.turnId
      && current.turnId
      && row.turnId !== current.turnId
    ) {
      close();
      open(occurrenceKey(row.turnId));
    } else if (!current) {
      open(`turn:${row.key}`);
    }
    current.rows.push(row);
    if (row.turnId && !current.turnId) {
      current.turnId = row.turnId;
      if (currentOpenedByAnchor) {
        current.key = occurrenceKey(row.turnId);
      }
    }
  });
  close();
  return groups.map((group) => (group.divider ? group : splitTurnGroup(group)));
}

function splitTurnGroup(group) {
  const anchorRows = [];
  const rest = [];
  let anchorDone = false;
  group.rows.forEach((row) => {
    if (!anchorDone && (row.kind === "user" || row.kind === "command")) {
      anchorRows.push(row);
    } else {
      anchorDone = true;
      rest.push(row);
    }
  });
  // Tail: the trailing run of assistant content rows (the visible answer).
  let tailStart = rest.length;
  while (
    tailStart > 0
    && ["assistant", "terminal-output"].includes(rest[tailStart - 1].kind)
  ) {
    tailStart -= 1;
  }
  const workRows = wrapSubagentRuns(rest.slice(0, tailStart));
  const tailRows = rest.slice(tailStart);
  return {
    ...group,
    anchorRows,
    workRows,
    tailRows,
  };
}

// Consecutive work rows carrying the same subagent linkage nest inside a
// single subagent-group row.
function wrapSubagentRuns(rows = []) {
  const wrapped = [];
  let run = null;
  const closeRun = () => {
    if (!run) return;
    if (run.childRows.length) {
      wrapped.push(run);
    }
    run = null;
  };
  rows.forEach((row) => {
    const subagent = row.message ? messageSubagent(row.message) : null;
    const runId = subagent ? (subagent.id || subagent.title || "subagent") : "";
    if (!runId) {
      closeRun();
      wrapped.push(row);
      return;
    }
    if (!run || run.subagentId !== runId) {
      closeRun();
      run = {
        kind: "subagent-group",
        key: `subagent:${runId}:${row.key}`,
        domId: row.domId,
        turnId: row.turnId,
        subagentId: runId,
        title: subagent.title || "Subagent",
        status: subagent.status || "",
        childRows: [],
      };
    }
    if (!run.title && subagent.title) run.title = subagent.title;
    if (subagent.status) run.status = subagent.status;
    run.childRows.push(row);
  });
  closeRun();
  return wrapped;
}

/* ------------------------------------------------------------------ */
/* Fold summaries                                                      */
/* ------------------------------------------------------------------ */

export function countToolCalls(workRows = []) {
  let count = 0;
  transcriptArray(workRows).forEach((row) => {
    if (row.kind === "tool") count += 1;
    if (row.kind === "subagent-group") {
      count += transcriptArray(row.childRows).filter((child) => child.kind === "tool").length;
    }
  });
  return count;
}

function groupFileTotals(group, turnSummary, diffSummary) {
  if (turnSummary?.fileChange?.files?.length) {
    return fileChangeTotals(turnSummary.fileChange.files);
  }
  if (diffSummary) {
    const additions = Math.max(0, Number(diffSummary.additions) || 0);
    const deletions = Math.max(0, Number(diffSummary.deletions) || 0);
    if (additions || deletions || transcriptArray(diffSummary.files).length) {
      return { additions, deletions };
    }
  }
  let totals = { additions: 0, deletions: 0 };
  let sawFiles = false;
  transcriptArray(group.workRows).forEach((row) => {
    if (row.kind !== "file-change" || !row.message) return;
    const fileChange = messageFileChange(row.message);
    if (!fileChange) return;
    sawFiles = true;
    const rowTotals = fileChangeTotals(fileChange.files.map(normalizeFileChangeFile));
    totals = {
      additions: totals.additions + rowTotals.additions,
      deletions: totals.deletions + rowTotals.deletions,
    };
  });
  return sawFiles ? totals : { additions: 0, deletions: 0 };
}

function groupTimestampRange(group) {
  const stamps = [];
  const collect = (row) => {
    if (row.kind === "subagent-group") {
      transcriptArray(row.childRows).forEach(collect);
      return;
    }
    const ts = rowTimestampMs(row);
    if (Number.isFinite(ts)) stamps.push(ts);
  };
  transcriptArray(group.anchorRows).forEach(collect);
  transcriptArray(group.workRows).forEach(collect);
  transcriptArray(group.tailRows).forEach(collect);
  if (!stamps.length) return null;
  return { min: Math.min(...stamps), max: Math.max(...stamps) };
}

function groupTimestampSpreadMs(group) {
  const range = groupTimestampRange(group);
  if (!range) return null;
  const spread = range.max - range.min;
  return spread > 0 ? spread : null;
}

// Turn summaries attach by turn id when the rows carry one; native transcript
// messages often do not, so summaries fall back to the turn group whose row
// timestamps overlap the summary's [started_at, completed_at] window
// (±2s tolerance, best overlap wins). Unmatched summaries stay unattached.
const TURN_SUMMARY_WINDOW_TOLERANCE_MS = 2000;

export function attachTurnSummariesToGroups(groups = [], summaries = new Map()) {
  const byGroupKey = new Map();
  if (!(summaries instanceof Map) || !summaries.size) return byGroupKey;
  const matchedTurnIds = new Set();
  transcriptArray(groups).forEach((group) => {
    if (group.divider || !group.turnId) return;
    const summary = summaries.get(group.turnId);
    if (summary) {
      byGroupKey.set(group.key, summary);
      matchedTurnIds.add(group.turnId);
    }
  });
  const candidates = transcriptArray(groups)
    .filter((group) => !group.divider && !byGroupKey.has(group.key))
    .map((group) => ({ group, range: groupTimestampRange(group) }))
    .filter((candidate) => candidate.range);
  summaries.forEach((summary) => {
    if (matchedTurnIds.has(summary.turnId)) return;
    if (!Number.isFinite(summary.startedAtMs) || !Number.isFinite(summary.completedAtMs)) return;
    const windowStart = summary.startedAtMs - TURN_SUMMARY_WINDOW_TOLERANCE_MS;
    const windowEnd = summary.completedAtMs + TURN_SUMMARY_WINDOW_TOLERANCE_MS;
    let best = null;
    let bestOverlap = -1;
    candidates.forEach((candidate) => {
      if (byGroupKey.has(candidate.group.key)) return;
      const overlap = Math.min(windowEnd, candidate.range.max)
        - Math.max(windowStart, candidate.range.min);
      if (overlap >= 0 && overlap > bestOverlap) {
        best = candidate;
        bestOverlap = overlap;
      }
    });
    if (best) {
      byGroupKey.set(best.group.key, summary);
    }
  });
  return byGroupKey;
}

function groupUsage(group, turnSummary, usageByTurn) {
  if (turnSummary?.usage) {
    return normalizeUsage(turnSummary.usage);
  }
  if (group.turnId && usageByTurn?.get?.(group.turnId)) {
    return usageByTurn.get(group.turnId);
  }
  let totals = null;
  const collect = (row) => {
    if (row.kind === "subagent-group") {
      transcriptArray(row.childRows).forEach(collect);
      return;
    }
    if (!row.message || isTurnSummaryMessage(row.message)) return;
    const usage = messageUsage(row.message);
    if (usage) totals = addUsage(totals, usage);
  };
  transcriptArray(group.workRows).forEach(collect);
  transcriptArray(group.tailRows).forEach(collect);
  return totals;
}

function groupHasError(group) {
  const rowHasError = (row) => {
    if (row.kind === "error") return true;
    if (row.kind === "subagent-group") {
      return transcriptArray(row.childRows).some(rowHasError);
    }
    const status = transcriptToken(row.message?.status);
    return ["error", "failed"].includes(status);
  };
  return transcriptArray(group.workRows).some(rowHasError);
}

// Fold-header summary: sourced from the turn_summary record when present,
// otherwise computed from the turn's own rows.
export function computeFoldSummary(group, {
  turnSummary = null,
  diffSummary = null,
  usageByTurn = null,
} = {}) {
  const { additions, deletions } = groupFileTotals(group, turnSummary, diffSummary);
  const usage = groupUsage(group, turnSummary, usageByTurn);
  return {
    durationMs: turnSummary?.durationMs ?? groupTimestampSpreadMs(group),
    toolCalls: countToolCalls(group.workRows),
    additions,
    deletions,
    usage,
    totalTokens: usageTotalTokens(usage),
    hasError: groupHasError(group),
    fromTurnSummary: Boolean(turnSummary),
  };
}

/* ------------------------------------------------------------------ */
/* Final row list                                                      */
/* ------------------------------------------------------------------ */

function diffSummariesByTurn(diffSummaries = []) {
  const byTurn = new Map();
  const unattached = [];
  transcriptArray(diffSummaries).forEach((summary, index) => {
    if (!summary || typeof summary !== "object") return;
    const turnId = transcriptText(summary.turnId || summary.turn_id);
    if (turnId) {
      byTurn.set(turnId, summary);
    } else {
      unattached.push({ summary, index });
    }
  });
  return { byTurn, unattached };
}

export function syntheticFileChangeRow(source, key, turnId = "") {
  const files = transcriptArray(source?.files).map(normalizeFileChangeFile).filter(Boolean);
  if (!files.length) return null;
  const totals = fileChangeTotals(files);
  return {
    kind: "file-change",
    key,
    turnId,
    synthetic: true,
    files,
    additions: totals.additions,
    deletions: totals.deletions,
    summary: transcriptText(source?.summary),
    item: null,
    message: null,
  };
}

// Builds the final render row list. Settled prior turns fold their work rows
// behind a fold-header row; anchor (user/command) rows and the trailing
// assistant answer stay visible. The latest turn is always expanded.
export function buildTranscriptRows(items = [], {
  itemIdPrefix = "agent-thread-item",
  diffSummaries = [],
  turnSummaries = null,
  usageByTurn = null,
  expandedTurnKeys = null,
  busy = false,
} = {}) {
  const flat = flattenTranscriptItems(items, { itemIdPrefix });
  const groups = groupRowsIntoTurns(flat);
  const { byTurn: diffByTurn, unattached: unattachedDiffs } = diffSummariesByTurn(diffSummaries);
  const summaries = turnSummaries instanceof Map ? turnSummaries : new Map();
  const summariesByGroupKey = attachTurnSummariesToGroups(groups, summaries);
  const expanded = expandedTurnKeys instanceof Set ? expandedTurnKeys : new Set();
  const turnGroups = groups.filter((group) => !group.divider);
  const latestGroupKey = turnGroups.length ? turnGroups[turnGroups.length - 1].key : "";
  const consumedDiffTurnIds = new Set();
  const rows = [];

  groups.forEach((group) => {
    if (group.divider) {
      rows.push(...group.rows);
      return;
    }
    const tagRow = (row) => ({ ...row, groupKey: group.key });
    const turnSummary = summariesByGroupKey.get(group.key) || null;
    const diffSummary = group.turnId ? diffByTurn.get(group.turnId) || null : null;
    if (group.turnId && diffSummary) consumedDiffTurnIds.add(group.turnId);

    const workRows = [...group.workRows];
    const hasFileChangeRow = workRows.some((row) => row.kind === "file-change");
    if (!hasFileChangeRow) {
      const source = turnSummary?.fileChange
        || (diffSummary ? { files: diffSummary.files, summary: diffSummary.summary } : null);
      if (source) {
        const synthetic = syntheticFileChangeRow(source, `file-change:${group.key}`, group.turnId);
        if (synthetic) workRows.push(synthetic);
      }
    }

    const isLatest = group.key === latestGroupKey;
    const foldable = workRows.length > 0 && !isLatest;
    const isExpanded = !foldable || expanded.has(group.key);
    const summary = workRows.length
      ? computeFoldSummary({ ...group, workRows }, { turnSummary, diffSummary, usageByTurn })
      : null;

    rows.push(...group.anchorRows.map(tagRow));
    if (workRows.length) {
      const showHeader = foldable || !busy || !isLatest;
      if (showHeader) {
        rows.push({
          kind: "fold",
          key: `fold:${group.key}`,
          turnId: group.turnId,
          groupKey: group.key,
          foldable,
          folded: foldable && !isExpanded,
          summary,
          item: null,
          message: null,
        });
      }
      if (!foldable || isExpanded) {
        rows.push(...workRows.map(tagRow));
      }
    }
    rows.push(...group.tailRows.map(tagRow));
  });

  unattachedDiffs.forEach(({ summary, index }) => {
    const synthetic = syntheticFileChangeRow(
      { files: summary.files, summary: summary.summary },
      `file-change:unattached:${transcriptText(summary.summaryKey || summary.summary_key, `${index}`)}`,
    );
    if (synthetic) rows.push(synthetic);
  });
  // Attached-by-turn diff summaries whose turn rows are absent (e.g. windowed
  // away) still surface at the end, matching the previous transcript.
  diffByTurn.forEach((summary, turnId) => {
    if (consumedDiffTurnIds.has(turnId)) return;
    const synthetic = syntheticFileChangeRow(
      { files: summary.files, summary: summary.summary },
      `file-change:turn:${turnId}`,
      turnId,
    );
    if (synthetic) rows.push(synthetic);
  });

  return { rows, groups, latestGroupKey };
}

/* ------------------------------------------------------------------ */
/* Formatting helpers for the row components                           */
/* ------------------------------------------------------------------ */

export function formatDurationMs(durationMs) {
  if (durationMs == null || durationMs === "") return "";
  const value = Number(durationMs);
  if (!Number.isFinite(value) || value < 0) return "";
  if (value < 1000) return `${Math.round(value)}ms`;
  const totalSeconds = Math.round(value / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours}h ${restMinutes}m` : `${hours}h`;
}

export function formatTokensCompact(count) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1000) return `${Math.round(value)}`;
  if (value < 1_000_000) {
    const thousands = value / 1000;
    return `${thousands >= 100 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, "")}k`;
  }
  const millions = value / 1_000_000;
  return `${millions >= 100 ? Math.round(millions) : millions.toFixed(1).replace(/\.0$/, "")}M`;
}

export function foldHeaderLabel(summary = null) {
  if (!summary) return "Worked";
  const parts = [];
  const duration = formatDurationMs(summary.durationMs);
  parts.push(duration ? `Worked for ${duration}` : "Worked");
  if (summary.toolCalls > 0) {
    parts.push(`${summary.toolCalls} tool call${summary.toolCalls === 1 ? "" : "s"}`);
  }
  if ((summary.additions || 0) > 0 || (summary.deletions || 0) > 0) {
    parts.push(`+${summary.additions || 0}/−${summary.deletions || 0}`);
  }
  const tokens = formatTokensCompact(summary.totalTokens);
  if (tokens) {
    parts.push(`${tokens} tokens`);
  }
  return parts.join(" · ");
}

export function usageTooltip(usage = null) {
  const normalized = normalizeUsage(usage);
  if (!normalized) return "";
  const parts = [];
  if (Number.isFinite(normalized.inputTokens)) parts.push(`input ${normalized.inputTokens}`);
  if (Number.isFinite(normalized.outputTokens)) parts.push(`output ${normalized.outputTokens}`);
  if (Number.isFinite(normalized.cacheReadTokens)) parts.push(`cache read ${normalized.cacheReadTokens}`);
  if (Number.isFinite(normalized.cacheWriteTokens)) parts.push(`cache write ${normalized.cacheWriteTokens}`);
  if (Number.isFinite(normalized.costUsd)) parts.push(`$${normalized.costUsd.toFixed(4)}`);
  return parts.join(" · ");
}

export function middleEllipsis(value = "", max = 48) {
  const text = transcriptText(value);
  if (text.length <= max || max < 8) return text;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`;
}

export function toolStatusToken(status = "") {
  const token = transcriptToken(status);
  if (["running", "pending", "in-progress", "started", "sending", "queued", "working"].includes(token)) {
    return "running";
  }
  if (["failed", "error", "errored", "cancelled", "canceled", "timeout"].includes(token)) {
    return "failed";
  }
  if (["completed", "complete", "success", "succeeded", "ok", "done", "synced"].includes(token)) {
    return "completed";
  }
  return token ? "neutral" : "neutral";
}

export function toolDurationMs(message = {}) {
  const tool = messageTool(message) || {};
  return finiteNumber(
    message.duration_ms,
    message.durationMs,
    tool.duration_ms,
    tool.durationMs,
  );
}

export function toolExitCode(message = {}) {
  const tool = messageTool(message) || {};
  const nestedSources = [
    tool.output, tool.result, tool.response,
    message.output, message.result, message.response,
  ].map(plainObject).filter(Boolean);
  return finiteNumber(
    tool.exit_code,
    tool.exitCode,
    message.exit_code,
    message.exitCode,
    ...nestedSources.flatMap((source) => [source.exit_code, source.exitCode]),
  );
}

export function toolName(message = {}) {
  const tool = messageTool(message) || {};
  return transcriptText(
    tool.title || tool.name || tool.tool_name || tool.toolName
      || message.title || message.name,
    "Tool call",
  );
}

const TOOL_INPUT_SUMMARY_KEYS = [
  "command", "cmd", "script",
  "path", "file_path", "filePath", "file", "notebook_path",
  "pattern", "query", "prompt", "description",
  "url", "name", "target",
];

export function toolInputSummary(message = {}, max = 96) {
  const tool = messageTool(message) || {};
  const input = tool.input ?? tool.arguments ?? tool.args ?? tool.parameters ?? tool.params;
  if (input == null) {
    const content = messageContentText(message, 400);
    return content ? firstLine(content, max) : "";
  }
  if (typeof input === "string") return firstLine(input, max);
  if (typeof input === "number" || typeof input === "boolean") return String(input);
  const source = plainObject(input);
  if (source) {
    for (const key of TOOL_INPUT_SUMMARY_KEYS) {
      const value = source[key];
      if (typeof value === "string" && value.trim()) {
        return firstLine(value, max);
      }
    }
    try {
      return firstLine(JSON.stringify(source), max);
    } catch {
      return "";
    }
  }
  try {
    return firstLine(JSON.stringify(input), max);
  } catch {
    return "";
  }
}

function firstLine(value = "", max = 96) {
  const line = String(value).split("\n").map((part) => part.trim()).find(Boolean) || "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export function prettyPrintValue(value, limit = 60000) {
  if (value == null) return "";
  if (typeof value === "string") return value.slice(0, limit);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2).slice(0, limit);
  } catch {
    return String(value).slice(0, limit);
  }
}

const SHIKI_PRELOAD_LANGS = new Set([
  "ts", "typescript", "js", "javascript", "tsx", "jsx",
  "json", "rust", "rs", "python", "py", "bash", "sh", "shell", "zsh",
  "html", "css", "md", "markdown",
]);

export function codeLanguageToken(language = "") {
  const token = transcriptToken(language).replace(/[^a-z0-9+#-]/g, "");
  if (!token) return "";
  const aliases = {
    javascript: "js", typescript: "ts", markdown: "md",
    shell: "bash", sh: "bash", zsh: "bash", rs: "rust", py: "python",
  };
  return aliases[token] || token;
}

export function isPreloadedLanguage(language = "") {
  return SHIKI_PRELOAD_LANGS.has(transcriptToken(language));
}

export function artifactImageUrl(artifact = {}) {
  const source = plainObject(artifact);
  if (!source) return "";
  const url = transcriptText(
    source.url || source.href || source.asset_url || source.assetUrl
      || source.public_url || source.publicUrl,
  );
  if (!/^https?:\/\//i.test(url)) return "";
  const kind = transcriptToken(source.kind || source.type || source.content_type || source.contentType);
  if (kind.includes("image") || kind.includes("screenshot") || kind.includes("png") || kind.includes("jpeg")) {
    return url;
  }
  if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(url)) {
    return url;
  }
  return "";
}

export function reasoningDurationMs(message = {}) {
  return finiteNumber(message.duration_ms, message.durationMs);
}

export function rowHeightEstimate(row = {}) {
  switch (row.kind) {
    case "user": return 84;
    case "assistant": return 150;
    case "terminal-output": return 220;
    case "tool": return 44;
    case "reasoning": return 40;
    case "file-change": return 104;
    case "subagent-group": return 132;
    case "error": return 84;
    case "fold": return 46;
    case "divider": return 30;
    case "command": return 40;
    case "working": return 52;
    default: return 96;
  }
}

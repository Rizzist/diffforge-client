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
  return plainObject(message.tool || message.tool_call);
}

export function messageFileChange(message = {}) {
  const source = plainObject(message.file_change);
  const files = transcriptArray(
    source?.files || source?.changed_files || message.files || message.changed_files,
  );
  if (!files.length) return null;
  return { ...(source || {}), files };
}

export function messageSubagent(message = {}) {
  const source = plainObject(message.subagent);
  const hasFields = ["subagent_id", "subagentId", "sub_agent_id", "subAgentId"]
    .some((key) => hasOwn(message, key));
  if (!source && !hasFields) return null;
  const owner = source || message;
  const id = transcriptText(
    owner.subagent_id || owner.subagentId || owner.sub_agent_id || owner.subAgentId
      || (source ? owner.id : ""),
  );
  const agentChatSessionId = transcriptText(
    owner.agent_chat_session_id || owner.agentChatSessionId,
  );
  const providerSessionId = transcriptText(
    owner.provider_session_id || owner.providerSessionId,
  );
  return {
    ...(source || {}),
    id,
    parent_id: transcriptText(owner.parent_id || owner.parentId),
    title: transcriptText(owner.title || owner.name || message.title),
    status: transcriptToken(owner.status || owner.state || message.status),
    session_ref: agentChatSessionId || providerSessionId
      ? { agent_chat_session_id: agentChatSessionId, provider_session_id: providerSessionId }
      : null,
  };
}

export function messageUsage(message = {}) {
  return plainObject(message.usage || message.usage_report);
}

export function messageTruncated(message = {}) {
  const hasFlag = ["truncated", "is_truncated", "partial"]
    .some((key) => hasOwn(message, key));
  if (!hasFlag) return false;
  return transcriptBool(
    message.truncated ?? message.is_truncated ?? message.partial,
    false,
  );
}

export function messageKindToken(message = {}) {
  return transcriptToken(
    message.kind || message.message_kind || message.messageKind || message.content_kind || message.type,
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
  "<turn_aborted",
  "<turn_interrupted",
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
  const turnId = transcriptText(message.turn_id);
  if (!turnId) return null;
  const usage = plainObject(message.usage || message.usage_report) || null;
  const fileChangeSource = plainObject(message.file_change);
  const files = transcriptArray(fileChangeSource?.files)
    .map(normalizeFileChangeFile)
    .filter(Boolean);
  const startedAtMs = transcriptTimestampMs(message.started_at);
  const completedAtMs = transcriptTimestampMs(message.completed_at);
  let durationMs = finiteNumber(message.duration_ms);
  if (durationMs == null && Number.isFinite(startedAtMs) && Number.isFinite(completedAtMs)) {
    durationMs = Math.max(0, completedAtMs - startedAtMs);
  }
  return {
    turn_id: turnId,
    started_at_ms: startedAtMs,
    completed_at_ms: completedAtMs,
    duration_ms: durationMs,
    usage,
    file_change: files.length
      ? { files, summary: transcriptText(fileChangeSource?.summary) }
      : null,
  };
}

export function extractTurnSummaries(messages = []) {
  const summaries = new Map();
  transcriptArray(messages).forEach((message) => {
    const summary = normalizeTurnSummary(message);
    if (summary) {
      summaries.set(summary.turn_id, summary);
    }
  });
  return summaries;
}

/* ------------------------------------------------------------------ */
/* turn_diff contract (per-file unified patches; degrade when absent)   */
/* ------------------------------------------------------------------ */

export function isTurnDiffMessage(message = {}) {
  return messageKindToken(message) === "turn-diff";
}

const TURN_DIFF_FILE_KINDS = new Set(["edit", "create", "delete", "rename"]);

export function normalizeTurnDiffFile(file = {}) {
  const source = plainObject(file);
  if (!source) return null;
  const path = transcriptText(source.path || source.file || source.new_path);
  if (!path) return null;
  const kind = transcriptToken(source.kind || source.change_kind);
  const patch = typeof source.patch === "string" && source.patch ? source.patch : null;
  return {
    path,
    old_path: transcriptText(source.old_path || source.oldPath || source.from) || null,
    kind: TURN_DIFF_FILE_KINDS.has(kind) ? kind : "edit",
    additions: finiteNumber(source.additions, source.lines_added),
    deletions: finiteNumber(source.deletions, source.lines_removed),
    binary: transcriptBool(source.binary, false),
    patch,
    patch_truncated: transcriptBool(source.patch_truncated ?? source.patchTruncated, false),
  };
}

// Normalizes one §1 turn_diff message. The record has no explicit time
// window, so the message timestamp doubles as a point window for the same
// time-overlap fallback the turn_summary attachment uses. The source
// message's durable record refs (the fields agentChatMessageWithRecordRef
// attaches) are carried through so a fanout-truncated record stays
// fetchable from the synthetic file-change row.
export function normalizeTurnDiff(message = {}) {
  if (!isTurnDiffMessage(message)) return null;
  const turnId = transcriptText(message.turn_id || message.turnId);
  const files = transcriptArray(message.files)
    .map(normalizeTurnDiffFile)
    .filter(Boolean);
  if (!turnId && !files.length) return null;
  const totals = fileChangeTotals(files);
  const timestampMs = transcriptTimestampMs(
    message.timestamp || message.created_at,
  );
  const startedAtMs = transcriptTimestampMs(message.started_at) ?? timestampMs;
  const completedAtMs = transcriptTimestampMs(message.completed_at)
    ?? timestampMs;
  const recordSeqRaw = finiteNumber(
    message.record_seq, message.recordSeq, message.server_seq,
  );
  const filesOmittedRaw = finiteNumber(message.files_omitted, message.filesOmitted);
  return {
    turn_id: turnId,
    files,
    total_additions: finiteNumber(message.total_additions, message.totalAdditions)
      ?? totals.additions,
    total_deletions: finiteNumber(message.total_deletions, message.totalDeletions)
      ?? totals.deletions,
    truncated: transcriptBool(message.truncated ?? message.is_truncated, false),
    files_omitted: filesOmittedRaw != null && filesOmittedRaw > 0 ? Math.floor(filesOmittedRaw) : 0,
    record_id: transcriptText(message.record_id || message.recordId),
    record_seq: recordSeqRaw != null && recordSeqRaw > 0 ? recordSeqRaw : null,
    started_at_ms: startedAtMs,
    completed_at_ms: completedAtMs,
  };
}

function turnDiffOrderTimestampMs(diff = {}) {
  return diff.completed_at_ms ?? diff.started_at_ms ?? null;
}

// Order-independent same-turn replacement: a higher positive recordSeq wins;
// a seq-bearing record beats a seqless one; with equal/absent seqs the later
// timestamp wins; otherwise the existing entry stays.
function turnDiffReplaces(existing, incoming) {
  const existingSeq = existing.record_seq;
  const incomingSeq = incoming.record_seq;
  if (existingSeq != null && incomingSeq != null && existingSeq !== incomingSeq) {
    return incomingSeq > existingSeq;
  }
  if (existingSeq == null && incomingSeq != null) return true;
  if (existingSeq != null && incomingSeq == null) return false;
  const existingTs = turnDiffOrderTimestampMs(existing);
  const incomingTs = turnDiffOrderTimestampMs(incoming);
  return incomingTs != null && (existingTs == null || incomingTs > existingTs);
}

export function extractTurnDiffs(messages = []) {
  const diffs = new Map();
  transcriptArray(messages).forEach((message) => {
    const diff = normalizeTurnDiff(message);
    if (!diff || !diff.turn_id) return;
    const existing = diffs.get(diff.turn_id);
    if (!existing || turnDiffReplaces(existing, diff)) {
      diffs.set(diff.turn_id, diff);
    }
  });
  return diffs;
}

/* ------------------------------------------------------------------ */
/* Usage aggregation                                                   */
/* ------------------------------------------------------------------ */

const USAGE_FIELDS = [
  ["input_tokens", ["input_tokens", "prompt_tokens"]],
  ["output_tokens", ["output_tokens", "completion_tokens"]],
  ["cache_read_tokens", ["cache_read_tokens", "cache_read_input_tokens"]],
  ["cache_write_tokens", ["cache_write_tokens", "cache_creation_input_tokens"]],
  ["cost_usd", ["cost_usd"]],
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
    const turnId = transcriptText(message.turn_id);
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
  const total = (normalized.input_tokens || 0) + (normalized.output_tokens || 0);
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
    kind: transcriptToken(source.kind || source.change_kind || source.status) || "edit",
    additions: finiteNumber(source.additions, source.lines_added),
    deletions: finiteNumber(source.deletions, source.lines_removed),
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
  const raw = transcriptText(item.id || item.message?.id || item.turn_id || index, `${index}`);
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
  const format = transcriptToken(message.format || message.content_format);
  if (format === "terminal") return "terminal-output";
  if (role === "activity") return "tool";
  return "assistant";
}

function rowTurnId(item = {}, message = {}) {
  return transcriptText(
    item.turn_id || message.turn_id || "",
  );
}

function rowTimestampMs(row = {}) {
  const message = row.message || {};
  return transcriptTimestampMs(
    message.timestamp || message.created_at || row.item?.timestamp,
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
    const type = transcriptToken(item.type || item.item_type) || "message";
    const baseKey = transcriptText(item.id, keyPath) || keyPath;
    if (type === "divider") {
      pushRow({
        kind: "divider",
        key: `divider:${baseKey}`,
        dom_id: domId,
        turn_id: "",
        item,
        message: null,
      });
      return;
    }
    if (type === "command") {
      pushRow({
        kind: "command",
        key: `command:${baseKey}`,
        dom_id: domId,
        turn_id: transcriptText(item.turn_id) || inheritedTurnId,
        item,
        message: item.message || null,
      });
      return;
    }
    if (type === "assistantblock" || type === "assistant-block") {
      const blockTurnId = transcriptText(item.turn_id) || inheritedTurnId;
      transcriptArray(item.items).forEach((child, childIndex) => {
        walk(child, `${baseKey}:${childIndex}`, blockTurnId, childIndex === 0 ? domId : undefined);
      });
      return;
    }
    if (type === "activitygroup" || type === "activity-group") {
      const groupTurnId = transcriptText(item.turn_id) || inheritedTurnId;
      transcriptArray(item.messages).forEach((message, messageIndex) => {
        if (isTurnSummaryMessage(message || {}) || isTurnDiffMessage(message || {})) return;
        const kind = messageRowKind(message || {});
        if (kind === "user" && isInternalContextUserMessage(message || {})) return;
        pushRow({
          kind,
          key: `activity:${baseKey}:${transcriptText(message?.id, `${messageIndex}`)}`,
          dom_id: messageIndex === 0 ? domId : undefined,
          turn_id: rowTurnId({ turn_id: groupTurnId }, message || {}),
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
        dom_id: domId,
        turn_id: rowTurnId(item, item.message || {}) || inheritedTurnId,
        item,
        message: item.message || item,
      });
      return;
    }
    const message = item.message || item;
    if (isTurnSummaryMessage(message) || isTurnDiffMessage(message)) return;
    const messageKind = messageRowKind(message);
    if (messageKind === "user" && isInternalContextUserMessage(message)) return;
    pushRow({
      kind: messageKind,
      key: `message:${baseKey}`,
      dom_id: domId,
      turn_id: rowTurnId(item, message) || inheritedTurnId,
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
export function groupRowsIntoTurns(rows = [], options = {}) {
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
      turn_id: "",
      rows: [],
    };
    return current;
  };
  transcriptArray(rows).forEach((row) => {
    if (row.kind === "divider") {
      close();
      groups.push({ key: `divider:${row.key}`, turn_id: "", rows: [row], divider: true });
      return;
    }
    const isAnchor = row.kind === "user" || row.kind === "command";
    if (isAnchor) {
      close();
      open(`turn:${row.key}`, true);
    } else if (
      current
      && row.turn_id
      && current.turn_id
      && row.turn_id !== current.turn_id
    ) {
      close();
      open(occurrenceKey(row.turn_id));
    } else if (!current) {
      open(`turn:${row.key}`);
    }
    current.rows.push(row);
    if (row.turn_id && !current.turn_id) {
      current.turn_id = row.turn_id;
      if (currentOpenedByAnchor) {
        current.key = occurrenceKey(row.turn_id);
      }
    }
  });
  close();
  return groups.map((group) => (group.divider ? group : splitTurnGroup(group, options)));
}

function splitTurnGroup(group, options = {}) {
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
  const workRows = wrapSubagentRuns(rest.slice(0, tailStart), options);
  const tailRows = rest.slice(tailStart);
  return {
    ...group,
    anchorRows,
    workRows,
    tailRows,
  };
}

// Subagent groups nest via parent_id chains up to this depth; deeper
// linkage flattens into the depth-cap group.
export const SUBAGENT_NESTING_DEPTH_CAP = 3;

function subagentRefMatchesSession(sessionRef = null, sessionId = "") {
  if (!sessionRef || !sessionId) return false;
  return sessionRef.agent_chat_session_id === sessionId
    || sessionRef.provider_session_id === sessionId;
}

// Consecutive work rows carrying the same subagent linkage nest inside a
// single subagent-group row. Rows whose subagent carries a parent_id that
// points at an open group nest recursively (depth cap 3, deeper rows
// flatten into the depth-cap group). Any non-subagent row closes the run.
function wrapSubagentRuns(rows = [], { session_id: sessionId = "" } = {}) {
  const wrapped = [];
  let stack = [];
  // runIds flattened into a depth-cap group get no group of their own, so
  // their descendants' parent_id would never resolve against the stack.
  // Map each flattened runId to its owning cap group so those descendants
  // route into the same group instead of spawning bogus top-level groups.
  const capGroupByFlattenedRunId = new Map();
  const makeGroup = (subagent, runId, row, depth) => ({
    kind: "subagent-group",
    key: `subagent:${runId}:${row.key}`,
    dom_id: row.dom_id,
    turn_id: row.turn_id,
    subagent_id: runId,
    title: subagent.title || "Subagent",
    status: subagent.status || "",
    depth,
    session_ref: subagent.session_ref && !subagentRefMatchesSession(subagent.session_ref, sessionId)
      ? subagent.session_ref
      : null,
    childRows: [],
  });
  rows.forEach((row) => {
    const subagent = row.message ? messageSubagent(row.message) : null;
    const runId = subagent ? (subagent.id || subagent.title || "subagent") : "";
    if (!runId) {
      stack = [];
      wrapped.push(row);
      return;
    }
    const openIndex = stack.findIndex((group) => group.subagent_id === runId);
    if (openIndex >= 0) {
      stack = stack.slice(0, openIndex + 1);
    } else {
      const parentId = subagent.parent_id || "";
      const parentIndex = parentId
        ? stack.findIndex((group) => group.subagent_id === parentId)
        : -1;
      if (parentIndex >= 0) {
        stack = stack.slice(0, parentIndex + 1);
        const parent = stack[parentIndex];
        if (parent.depth < SUBAGENT_NESTING_DEPTH_CAP) {
          const child = makeGroup(subagent, runId, row, parent.depth + 1);
          parent.childRows.push(child);
          stack.push(child);
        } else {
          // parent.depth >= cap: flatten this row into the depth-cap group.
          capGroupByFlattenedRunId.set(runId, parent);
        }
      } else {
        const capGroup = parentId ? capGroupByFlattenedRunId.get(parentId) : undefined;
        const capIndex = capGroup ? stack.indexOf(capGroup) : -1;
        if (capIndex >= 0) {
          // The parent was itself flattened into a still-open cap group:
          // this deeper run flattens into that same group.
          stack = stack.slice(0, capIndex + 1);
          capGroupByFlattenedRunId.set(runId, capGroup);
        } else {
          stack = [];
          const root = makeGroup(subagent, runId, row, 1);
          wrapped.push(root);
          stack.push(root);
        }
      }
    }
    const target = stack[stack.length - 1];
    if (target.subagent_id === runId) {
      if ((!target.title || target.title === "Subagent") && subagent.title) {
        target.title = subagent.title;
      }
      if (subagent.status) target.status = subagent.status;
      if (
        !target.session_ref
        && subagent.session_ref
        && !subagentRefMatchesSession(subagent.session_ref, sessionId)
      ) {
        target.session_ref = subagent.session_ref;
      }
    }
    target.childRows.push(row);
  });
  return wrapped;
}

// Header stats for a subagent group: descendant message rows, tool calls,
// and the timestamp spread when derivable.
export function subagentGroupStats(group = {}) {
  let messages = 0;
  let toolCalls = 0;
  const stamps = [];
  const walk = (row) => {
    if (row.kind === "subagent-group") {
      transcriptArray(row.childRows).forEach(walk);
      return;
    }
    messages += 1;
    if (row.kind === "tool") toolCalls += 1;
    const ts = rowTimestampMs(row);
    if (Number.isFinite(ts)) stamps.push(ts);
  };
  transcriptArray(group.childRows).forEach(walk);
  const spread = stamps.length >= 2 ? Math.max(...stamps) - Math.min(...stamps) : null;
  return {
    messages,
    toolCalls,
    duration_ms: Number.isFinite(spread) && spread > 0 ? spread : null,
  };
}

/* ------------------------------------------------------------------ */
/* Fold summaries                                                      */
/* ------------------------------------------------------------------ */

export function countToolCalls(workRows = []) {
  let count = 0;
  const walk = (row) => {
    if (row.kind === "tool") count += 1;
    if (row.kind === "subagent-group") {
      transcriptArray(row.childRows).forEach(walk);
    }
  };
  transcriptArray(workRows).forEach(walk);
  return count;
}

function groupFileTotals(group, turnSummary, diffSummary, turnDiff = null) {
  if (turnSummary?.file_change?.files?.length) {
    return fileChangeTotals(turnSummary.file_change.files);
  }
  if (turnDiff?.files?.length) {
    return {
      additions: Math.max(0, Number(turnDiff.total_additions) || 0),
      deletions: Math.max(0, Number(turnDiff.total_deletions) || 0),
    };
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

// Turn records (turn_summary / turn_diff) attach by turn id when the rows
// carry one; native transcript messages often do not, so records fall back to
// the turn group whose row timestamps overlap the record's
// [startedAtMs, completedAtMs] window (±2s tolerance, best overlap wins).
// Unmatched records stay unattached.
const TURN_SUMMARY_WINDOW_TOLERANCE_MS = 2000;

export function attachTurnRecordsToGroups(groups = [], records = new Map()) {
  const byGroupKey = new Map();
  if (!(records instanceof Map) || !records.size) return byGroupKey;
  const matchedTurnIds = new Set();
  transcriptArray(groups).forEach((group) => {
    if (group.divider || !group.turn_id) return;
    const record = records.get(group.turn_id);
    if (record) {
      byGroupKey.set(group.key, record);
      matchedTurnIds.add(group.turn_id);
    }
  });
  const candidates = transcriptArray(groups)
    .filter((group) => !group.divider && !byGroupKey.has(group.key))
    .map((group) => ({ group, range: groupTimestampRange(group) }))
    .filter((candidate) => candidate.range);
  records.forEach((record) => {
    if (matchedTurnIds.has(record.turn_id)) return;
    if (!Number.isFinite(record.started_at_ms) || !Number.isFinite(record.completed_at_ms)) return;
    const windowStart = record.started_at_ms - TURN_SUMMARY_WINDOW_TOLERANCE_MS;
    const windowEnd = record.completed_at_ms + TURN_SUMMARY_WINDOW_TOLERANCE_MS;
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
      byGroupKey.set(best.group.key, record);
    }
  });
  return byGroupKey;
}

export function attachTurnSummariesToGroups(groups = [], summaries = new Map()) {
  return attachTurnRecordsToGroups(groups, summaries);
}

function groupUsage(group, turnSummary, usageByTurn) {
  if (turnSummary?.usage) {
    return normalizeUsage(turnSummary.usage);
  }
  if (group.turn_id && usageByTurn?.get?.(group.turn_id)) {
    return usageByTurn.get(group.turn_id);
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
  turnDiff = null,
  usageByTurn = null,
} = {}) {
  const { additions, deletions } = groupFileTotals(group, turnSummary, diffSummary, turnDiff);
  const usage = groupUsage(group, turnSummary, usageByTurn);
  return {
    duration_ms: turnSummary?.duration_ms ?? groupTimestampSpreadMs(group),
    toolCalls: countToolCalls(group.workRows),
    additions,
    deletions,
    usage,
    total_tokens: usageTotalTokens(usage),
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
    const turnId = transcriptText(summary.turn_id);
    if (turnId) {
      byTurn.set(turnId, summary);
    } else {
      unattached.push({ summary, index });
    }
  });
  return { byTurn, unattached };
}

// Minimal message for the synthetic turn_diff card: it bears the durable
// record refs + truncated flag so the standard TruncatedChip can fetch the
// full record when the fanout copy was truncated. Null when there is
// nothing to carry (no refs, not truncated).
export function turnDiffSyntheticMessage(turnDiff = null) {
  if (!turnDiff) return null;
  const recordId = transcriptText(turnDiff.record_id);
  const recordSeq = Number.isFinite(turnDiff.record_seq) && turnDiff.record_seq > 0
    ? turnDiff.record_seq
    : null;
  const truncated = Boolean(turnDiff.truncated);
  if (!recordId && recordSeq == null && !truncated) return null;
  return {
    ...(recordId ? { record_id: recordId } : {}),
    ...(recordSeq != null ? { record_seq: recordSeq } : {}),
    truncated,
  };
}

export function syntheticFileChangeRow(source, key, turnId = "") {
  const files = transcriptArray(source?.files).map(normalizeFileChangeFile).filter(Boolean);
  if (!files.length) return null;
  const totals = fileChangeTotals(files);
  return {
    kind: "file-change",
    key,
    turn_id: turnId,
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
// (tool cards, reasoning, file changes, subagent groups) behind a fold-header
// row; anchor (user/command) rows and the turn's assistant answer rows stay
// visible even while folded (t3-style: folding hides the WORK, never the
// reply). Expanding re-emits every row in original order — the answer rows
// are the same rows, so nothing duplicates. The latest turn is always
// expanded.
export function buildTranscriptRows(items = [], {
  itemIdPrefix = "agent-thread-item",
  diff_summaries: diffSummaries = [],
  turnSummaries = null,
  turnDiffs = null,
  usageByTurn = null,
  expandedTurnKeys = null,
  busy = false,
  session_id: sessionId = "",
} = {}) {
  const flat = flattenTranscriptItems(items, { itemIdPrefix });
  const groups = groupRowsIntoTurns(flat, { session_id: sessionId });
  const { byTurn: diffByTurn, unattached: unattachedDiffs } = diffSummariesByTurn(diffSummaries);
  const summaries = turnSummaries instanceof Map ? turnSummaries : new Map();
  const summariesByGroupKey = attachTurnSummariesToGroups(groups, summaries);
  const turnDiffsByGroupKey = attachTurnRecordsToGroups(
    groups,
    turnDiffs instanceof Map ? turnDiffs : new Map(),
  );
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
    const turnDiff = turnDiffsByGroupKey.get(group.key) || null;
    const diffSummary = group.turn_id ? diffByTurn.get(group.turn_id) || null : null;
    if (group.turn_id && diffSummary) consumedDiffTurnIds.add(group.turn_id);

    let workRows = [...group.workRows];
    const hasFileChangeRow = workRows.some((row) => row.kind === "file-change");
    if (hasFileChangeRow && turnDiff) {
      // The turn's reviewable diff rides on the last file-change row.
      const lastIndex = workRows.map((row) => row.kind).lastIndexOf("file-change");
      workRows = workRows.map((row, index) => (
        index === lastIndex ? { ...row, turnDiff } : row
      ));
    }
    if (!hasFileChangeRow) {
      if (turnDiff?.files?.length) {
        workRows.push({
          kind: "file-change",
          key: `file-change:${group.key}`,
          turn_id: group.turn_id,
          synthetic: true,
          files: turnDiff.files,
          additions: Math.max(0, Number(turnDiff.total_additions) || 0),
          deletions: Math.max(0, Number(turnDiff.total_deletions) || 0),
          summary: transcriptText(turnSummary?.file_change?.summary),
          turnDiff,
          item: null,
          message: turnDiffSyntheticMessage(turnDiff),
        });
      } else {
        const source = turnSummary?.file_change
          || (diffSummary ? { files: diffSummary.files, summary: diffSummary.summary } : null);
        if (source) {
          const synthetic = syntheticFileChangeRow(source, `file-change:${group.key}`, group.turn_id);
          if (synthetic) workRows.push(synthetic);
        }
      }
    }

    const isLatest = group.key === latestGroupKey;
    const foldable = workRows.length > 0 && !isLatest;
    const isExpanded = !foldable || expanded.has(group.key);
    const summary = workRows.length
      ? computeFoldSummary({ ...group, workRows }, { turnSummary, diffSummary, turnDiff, usageByTurn })
      : null;

    rows.push(...group.anchorRows.map(tagRow));
    if (workRows.length) {
      const showHeader = foldable || !busy || !isLatest;
      if (showHeader) {
        rows.push({
          kind: "fold",
          key: `fold:${group.key}`,
          turn_id: group.turn_id,
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
      } else {
        // Folded: only the work rows hide. Assistant text rows that sit
        // between work rows (the turn's answer when tool calls settle after
        // the final message) stay visible beneath the fold header. Turns
        // without assistant text fold fully.
        rows.push(
          ...workRows.filter((row) => row.kind === "assistant").map(tagRow),
        );
      }
    }
    rows.push(...group.tailRows.map(tagRow));
  });

  unattachedDiffs.forEach(({ summary, index }) => {
    const synthetic = syntheticFileChangeRow(
      { files: summary.files, summary: summary.summary },
      `file-change:unattached:${transcriptText(summary.summary_key, `${index}`)}`,
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
  const duration = formatDurationMs(summary.duration_ms);
  parts.push(duration ? `Worked for ${duration}` : "Worked");
  if (summary.toolCalls > 0) {
    parts.push(`${summary.toolCalls} tool call${summary.toolCalls === 1 ? "" : "s"}`);
  }
  if ((summary.additions || 0) > 0 || (summary.deletions || 0) > 0) {
    parts.push(`+${summary.additions || 0}/−${summary.deletions || 0}`);
  }
  const tokens = formatTokensCompact(summary.total_tokens);
  if (tokens) {
    parts.push(`${tokens} tokens`);
  }
  return parts.join(" · ");
}

export function usageTooltip(usage = null) {
  const normalized = normalizeUsage(usage);
  if (!normalized) return "";
  const parts = [];
  if (Number.isFinite(normalized.input_tokens)) parts.push(`input ${normalized.input_tokens}`);
  if (Number.isFinite(normalized.output_tokens)) parts.push(`output ${normalized.output_tokens}`);
  if (Number.isFinite(normalized.cache_read_tokens)) parts.push(`cache read ${normalized.cache_read_tokens}`);
  if (Number.isFinite(normalized.cache_write_tokens)) parts.push(`cache write ${normalized.cache_write_tokens}`);
  if (Number.isFinite(normalized.cost_usd)) parts.push(`$${normalized.cost_usd.toFixed(4)}`);
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
    tool.duration_ms,
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
    message.exit_code,
    ...nestedSources.flatMap((source) => [source.exit_code]),
  );
}

export function toolName(message = {}) {
  const tool = messageTool(message) || {};
  return transcriptText(
    tool.title || tool.name || tool.tool_name || message.title || message.name,
    "Tool call",
  );
}

const TOOL_INPUT_SUMMARY_KEYS = [
  "command", "cmd", "script",
  "path", "file_path", "file", "notebook_path",
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

export function codeLanguageToken(language = "") {
  const token = transcriptToken(language).replace(/[^a-z0-9+#-]/g, "");
  if (!token) return "";
  const aliases = {
    javascript: "js", typescript: "ts", markdown: "md",
    shell: "bash", sh: "bash", zsh: "bash", rs: "rust", py: "python",
  };
  return aliases[token] || token;
}

export function artifactImageUrl(artifact = {}) {
  const source = plainObject(artifact);
  if (!source) return "";
  const url = transcriptText(
    source.url || source.href || source.asset_url || source.public_url,
  );
  // Local previews (the composer's optimistic sent-bubble attachment
  // thumbnails) ride blob:/data:image URLs; everything else must be http(s).
  if (!/^https?:\/\//i.test(url) && !/^blob:/i.test(url) && !/^data:image\//i.test(url)) return "";
  const kind = transcriptToken(source.kind || source.type || source.content_type);
  if (kind.includes("image") || kind.includes("screenshot") || kind.includes("png") || kind.includes("jpeg")) {
    return url;
  }
  if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(url)) {
    return url;
  }
  return "";
}

export function reasoningDurationMs(message = {}) {
  return finiteNumber(message.duration_ms);
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

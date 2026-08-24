/* Pure transcript row assembly. Kept outside the JSX component so ordering
   and grouping remain directly testable without a browser transform. */

const INTERNAL_ITEM_NAMES = new Set([
  "node_committed",
  "extension",
  "session_seen",
  "session_renamed",
]);

function isInternalToolRow(row) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  const name = String(meta.item || meta.type || meta.name || "").trim();
  if (INTERNAL_ITEM_NAMES.has(name)) return true;
  const lead = String(row?.text || "").split("·")[0].trim();
  return INTERNAL_ITEM_NAMES.has(lead);
}

function orderNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

/* Outcomes that are not a success. A collapsed cluster must not hide one, so
   these open it — an unnameable outcome included, because "we could not read
   this" is exactly the case worth a human's eyes. */
export const TOOL_STATUS_UNRESOLVED = new Set(["failed", "rejected", "conflict", "unknown"]);


export function toolStatusOf(row) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  let raw = "";
  for (const key of ["status", "phase", "outcome"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) {
      raw = value;
      break;
    }
  }
  if (!raw) {
    const settled = /settled as ([a-z]+)/i.exec(String(row?.text || ""));
    if (settled) raw = settled[1];
  }
  const status = raw.toLowerCase();
  if (/^(completed?|success|succeeded|ok|done)$/.test(status)) return "ok";
  if (/^(failed?|failure|error|errored)$/.test(status)) return "failed";
  if (/^(rejected|denied|refused)$/.test(status)) return "rejected";
  if (/^(conflict|conflicted)$/.test(status)) return "conflict";
  if (/^(cancell?ed|aborted)$/.test(status)) return "cancelled";
  if (/^(running|in_progress|pending|started|active)$/.test(status)) return "running";
  // An outcome this build cannot name is NOT a success. Cold rows carry only
  // the daemon's prose today, so a status added upstream arrives here as a
  // word we've never seen — reporting that as "Completed" is how a rejected
  // call reads as a finished one.
  return "unknown";
}

export const TOOL_STATUS_LABEL = {
  ok: "Completed",
  failed: "Failed",
  rejected: "Rejected",
  conflict: "Conflict",
  cancelled: "Cancelled",
  running: "Running",
  unknown: "Unknown",
};

export function projectionRowKey(row) {
  return `${orderNumber(row?.seq)}:${orderNumber(row?.ordinal)}:${orderNumber(row?.projection_order)}`;
}

/* Projection windows and append events are expected to be ordered already,
   but split v4 siblings share their wire seq/ordinal. The client phase is an
   explicit final comparator rather than an insertion-order bet. */
function orderedProjectionRows(rows) {
  return rows
    .map((row, inputIndex) => ({ row, inputIndex }))
    .sort((left, right) => (
      orderNumber(left.row?.seq) - orderNumber(right.row?.seq)
      || orderNumber(left.row?.ordinal) - orderNumber(right.row?.ordinal)
      || orderNumber(left.row?.projection_order) - orderNumber(right.row?.projection_order)
      || left.inputIndex - right.inputIndex
    ))
    .map(({ row }) => row);
}

export function buildTranscriptBlocks(rows) {
  const blocks = [];
  let pendingThinking = [];
  const flushThinking = () => {
    for (const thinking of pendingThinking) {
      blocks.push({ type: "row", key: projectionRowKey(thinking), row: thinking });
    }
    pendingThinking = [];
  };
  let lastDay = "";
  let lastAssistantText = null;
  for (let row of orderedProjectionRows(Array.isArray(rows) ? rows : [])) {
    if (row.kind === "usage") continue;
    if (row.kind === "message" && /^(tool arguments|command output) · /.test(row.text || "")) {
      row = { ...row, kind: "tool", role: "tool" };
    }
    if (row.kind === "thinking" && !String(row.text || "").trim()) continue;
    if (row.kind === "tool" && isInternalToolRow(row)) continue;
    if (row.kind === "message") {
      const text = String(row.text || "").trim();
      if (!text) continue;
      if (row.role === "assistant") {
        if (text === lastAssistantText) continue;
        lastAssistantText = text;
      } else {
        lastAssistantText = null;
      }
    } else {
      lastAssistantText = null;
    }
    if (Number.isFinite(row.at_ms) && row.at_ms > 0) {
      const day = new Date(row.at_ms).toDateString();
      if (day !== lastDay) {
        if (lastDay) {
          blocks.push({ type: "day", key: `day:${projectionRowKey(row)}`, at_ms: row.at_ms });
        }
        lastDay = day;
      }
    }
    if (row.kind === "thinking") {
      pendingThinking.push(row);
      continue;
    }
    if (row.kind === "message" && row.role === "assistant") {
      flushThinking();
    }
    if (row.kind === "tool") {
      const last = blocks[blocks.length - 1];
      if (last && last.type === "tools") {
        last.rows.push(row);
      } else {
        blocks.push({ type: "tools", key: `tools:${projectionRowKey(row)}`, rows: [row] });
      }
    } else {
      blocks.push({ type: "row", key: projectionRowKey(row), row });
    }
  }
  flushThinking();
  return blocks;
}

/* Pure transcript row assembly. Kept outside the JSX component so ordering
   and grouping remain directly testable without a browser transform. */

const INTERNAL_ITEM_NAMES = new Set([
  "node_committed",
  "extension",
  "session_seen",
  "session_renamed",
]);

function isPresentationalAgentExtension(row, meta) {
  const rowKind = String(row?.kind || "").trim();
  if ([
    "child_spawn",
    "child_result",
    "agent_spawned",
    "agent_report",
    "agent_chip_state",
    "agent_graph_rollup_v1",
  ].includes(rowKind)) return true;

  const itemKind = String(meta.item || meta.type || "").trim();
  const extensionKind = String(meta.kind || "").trim();
  return itemKind === "extension" && extensionKind === "agent_graph_rollup_v1";
}

function isInternalToolRow(row) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  // `extension` is normally an internal escape hatch, but the daemon's
  // stable agent rollup is explicitly parent-stream presentation data. Keep
  // both freshly typed rows and pre-v9 cached generic rows observable.
  if (isPresentationalAgentExtension(row, meta)) return false;
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

function publishedToolStatus(meta) {
  const raw = typeof meta.status === "string" ? meta.status.trim().toLowerCase() : "";
  if (raw === "completed") return "ok";
  if (raw === "failed") return "failed";
  if (raw === "rejected") return "rejected";
  if (raw === "conflict") return "conflict";
  if (raw === "cancelled") return "cancelled";
  // The daemon's status enum is unknown-tolerant. Missing status and future
  // wire names carry the same client meaning: this build cannot name them.
  return "unknown";
}

function hasPublishedToolStatusAuthority(meta) {
  const authority = meta?._diffforge_pipe;
  return authority && typeof authority === "object"
    && Number(authority.version) >= 6
    && authority.pipe_tool_status_v1 === true;
}

export function toolStatusOf(row) {
  const meta = row?.meta && typeof row.meta === "object" ? row.meta : {};
  if (hasPublishedToolStatusAuthority(meta)) {
    return publishedToolStatus(meta);
  }

  // Legacy-only inference for pre-v6 rows. Prose is not consulted once the
  // projection marker says the daemon publishes typed tool status.
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
  // An outcome this build cannot name is NOT a success. A legacy cold row may
  // carry only daemon prose, so an unfamiliar word still remains unknown.
  return "unknown";
}

/* One transition serves both ToolCluster entry points: undefined means React
   is initializing the cluster; a boolean means an existing cluster is being
   reconsidered after its rows changed. Unresolved outcomes always surface,
   while a settled cluster otherwise preserves the user's open/closed choice. */
export function toolClusterOpenState(currentOpen, rows) {
  const clusterRows = Array.isArray(rows) ? rows : [];
  if (clusterRows.some((row) => TOOL_STATUS_UNRESOLVED.has(toolStatusOf(row)))) {
    return true;
  }
  return currentOpen === undefined ? clusterRows.length === 1 : currentOpen;
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
  /* Identity, not wording. Two assistant turns are allowed to say the same
     thing — "Done." twice is two answers, not one delivered twice — so only a
     repeated (seq, ordinal, projection_order) is a repeat. The compat records
     this once guarded against are already dropped in the Rust fold once the
     item stream is live. */
  const emitted = new Set();
  for (let row of orderedProjectionRows(Array.isArray(rows) ? rows : [])) {
    if (row.kind === "usage") continue;
    if (row.kind === "message" && /^(tool arguments|command output) · /.test(row.text || "")) {
      row = { ...row, kind: "tool", role: "tool" };
    }
    if (row.kind === "thinking" && !String(row.text || "").trim()) continue;
    if (row.kind === "tool" && isInternalToolRow(row)) continue;
    if (row.kind === "message" && !String(row.text || "").trim()) continue;
    const identity = projectionRowKey(row);
    if (emitted.has(identity)) continue;
    emitted.add(identity);
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

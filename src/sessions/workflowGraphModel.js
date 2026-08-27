/* Workflow live-runtime graph view model (P6): pure, side-effect-free
   transforms between the `workflow_graph_v1` wire shapes and what the UI
   renders. House law, same as the P1′ workflow surface's:
   - `ast_digest` is THE topology fence: carried VERBATIM for display (the
     rendered topology is "as of" that digest) — never recomputed from the
     ast, never fabricated when absent;
   - `state: null` is the daemon honestly saying there is NO live workflow
     graph for this session — a distinct "none" view, never a fabricated
     empty graph;
   - the daemon's `nodes` + `phase` are the AUTHORITY: nothing here reduces
     watch events into node states — the watch page is a CHANGE SIGNAL
     whose only meaning is "re-fetch workflow.graph.state";
   - unknown journal event types are PRESERVED verbatim as kind "unknown"
     (an unrecognized activity) — never dropped, never coerced onto a
     known type;
   - cursors are honest: they are u64-scale DECIMAL STRINGS on the wire,
     and `through_cursor` and the watch cursors ride the views VERBATIM as
     those strings ("0" is a real cursor; absence is null, never "0").
     Nothing here numeric-parses a cursor — 9007199254740993 must never
     silently become 9007199254740992 — comparisons are BigInt, and a
     cursor gap demands a state re-fetch rather than a guess;
   - per-node state comes ONLY from the projection's node records — never
     inferred from a node's id or name. */

export { loomUnavailableFromError as workflowGraphUnavailableFromError } from "./loomModel.js";

function textOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/* Cursors are u64-scale DECIMAL STRINGS across the Tauri boundary and
   ride VERBATIM: a string of decimal digits is the published position
   ("0" included); anything else — absence, a non-decimal string, or a
   NUMBER (which may already have lost precision crossing the boundary) —
   is null. Nothing here numeric-parses a cursor: the u64 value
   9007199254740993 would silently become 9007199254740992. */
const DECIMAL_CURSOR = /^\d+$/;

function cursorOrNull(value) {
  return typeof value === "string" && DECIMAL_CURSOR.test(value) ? value : null;
}

/* The three edge kinds the l3 render reference projects out of the frozen
   activation AST (graph-input edges legitimately have no source node). */
export const WORKFLOW_GRAPH_EDGE_KINDS = Object.freeze([
  "graph_input",
  "forward",
  "back",
]);

const KNOWN_EDGE_KIND_SET = new Set(WORKFLOW_GRAPH_EDGE_KINDS);

/* One topology edge, LIFTED from the ast per the l3 reference
   (kind/from/to) — carried, never invented. An unrecognized kind is
   preserved verbatim as kind "unknown" (kindRaw keeps the daemon's
   spelling); a graph_input edge's absent source stays null. */
export function graphEdgeView(edge) {
  const kindRaw = edge?.kind == null ? null : String(edge.kind);
  return {
    kind: kindRaw != null && KNOWN_EDGE_KIND_SET.has(kindRaw) ? kindRaw : "unknown",
    kindRaw,
    from: textOrNull(edge?.from),
    to: textOrNull(edge?.to),
    raw: edge ?? null,
  };
}

/* One runtime node from the projection's `nodes`. The daemon-published
   state string (the l3 reducer's `phase`: waiting/activated/completed/
   rejected, or any future value) rides VERBATIM; a node whose record
   published no state stays null — rendered "not published", NEVER a
   fabricated "waiting", and NEVER inferred from the node's id or name. */
export function graphNodeView(node) {
  const stateRaw = node?.phase ?? node?.state ?? node?.status;
  return {
    nodeId: String(node?.node ?? node?.node_id ?? node?.id ?? ""),
    state: typeof stateRaw === "string" && stateRaw.length > 0 ? stateRaw : null,
    rejection: node?.rejection ?? null,
    raw: node ?? null,
  };
}

/* A workflow_graph_state read. HOUSE LAW: `state: null` is the honest "no
   live workflow graph for this session" — kind "none", carrying NOTHING
   (no nodes, no edges, no digest a caller could mistake for an empty
   graph). A real state types graph_id/ast_digest/phase/through_cursor and
   carries the ast OPAQUE; edges are lifted from the edge list the ast
   itself publishes — when the ast publishes none, edgesPublished is false
   ("topology edges not published"), never an invented empty edge set. */
export function graphStateView(state) {
  if (state == null) return { kind: "none" };
  const ast = state?.ast ?? null;
  const rawEdges = ast && typeof ast === "object" ? ast.edges : undefined;
  const edgesPublished = Array.isArray(rawEdges);
  return {
    kind: "graph",
    graphId: String(state?.graph_id ?? ""),
    /* THE topology fence: ast_digest VERBATIM — the rendered topology is
       "as of" this digest. It is never recomputed from the ast and never
       fabricated: an absent digest stays null. */
    astDigest: textOrNull(state?.ast_digest),
    /* The frozen activation AST stays OPAQUE — carried, not interpreted
       beyond lifting the edge list it publishes. */
    ast,
    seed: state?.seed ?? null,
    phase: String(state?.phase ?? ""),
    /* Cursor honesty: through_cursor VERBATIM as its decimal string
       ("0" is real; absence is null, never a fabricated "0"). */
    throughCursor: cursorOrNull(state?.through_cursor),
    nextActivationOrder: state?.next_activation_order ?? null,
    backEdgeActivations: state?.back_edge_activations ?? null,
    nodes: Array.isArray(state?.nodes) ? state.nodes.map(graphNodeView) : [],
    activationOrder: Array.isArray(state?.activation_order)
      ? state.activation_order
      : [],
    edgesPublished,
    edges: edgesPublished ? rawEdges.map(graphEdgeView) : [],
  };
}

/* The four journal fact types the v1 watch contract names. Anything else
   is an UNKNOWN event — preserved, never dropped. */
export const WORKFLOW_GRAPH_WATCH_EVENT_TYPES = Object.freeze([
  "workflow_graph_started",
  "workflow_node_activated",
  "workflow_node_completed",
  "workflow_node_rejected",
]);

const KNOWN_WATCH_EVENT_TYPE_SET = new Set(WORKFLOW_GRAPH_WATCH_EVENT_TYPES);

/* One { cursor, event } journal entry from a watch page. HOUSE LAW: an
   event whose `type` we do not recognize is PRESERVED verbatim as kind
   "unknown" (typeRaw keeps the daemon's spelling, raw keeps the record) —
   never dropped, never coerced onto a known type. The event body stays
   OPAQUE either way: nothing here turns an event into a node state. */
export function watchEventView(entry) {
  const event = entry?.event ?? null;
  const typeRaw = typeof event?.type === "string" ? event.type : null;
  const cursor = cursorOrNull(entry?.cursor);
  if (typeRaw != null && KNOWN_WATCH_EVENT_TYPE_SET.has(typeRaw)) {
    return { kind: typeRaw, typeRaw, cursor, raw: event };
  }
  return { kind: "unknown", typeRaw, cursor, raw: event };
}

/* One workflow_graph_watch page. The three cursors ride VERBATIM as their
   decimal strings (absence is null, never "0") and EVERY journal fact
   survives into `events` — unknown types included. */
export function watchPageView(page) {
  return {
    requestedAfterCursor: cursorOrNull(page?.requested_after_cursor),
    replayThroughCursor: cursorOrNull(page?.replay_through_cursor),
    nextCursor: cursorOrNull(page?.next_cursor),
    events: Array.isArray(page?.events) ? page.events.map(watchEventView) : [],
  };
}

/* HOUSE LAW: the watch page is a CHANGE SIGNAL, never a reduction input.
   `changed` means exactly "re-fetch workflow.graph.state now" — events
   arrived, the cursor advanced, or a GAP appeared (the replay scan moved
   past everything the page's events explain, so what was elided must be
   re-read from state authority rather than guessed). `nextAfterCursor` is
   the verbatim next_cursor the follow-up watch resumes from; with no
   published next_cursor the position honestly returns null so the caller
   re-baselines from a fresh state read instead of inventing a cursor. */
export function watchSignal(pageView) {
  const events = Array.isArray(pageView?.events) ? pageView.events : [];
  const requested = pageView?.requestedAfterCursor;
  const replay = pageView?.replayThroughCursor;
  const next = pageView?.nextCursor;
  /* Every comparison is BigInt over the decimal strings — JS number math
     would silently collapse u64-scale cursors (…993 → …992) and misjudge
     both the gap and the advance. */
  let explained = requested == null ? null : BigInt(requested);
  for (const event of events) {
    if (typeof event?.cursor !== "string") continue;
    const at = BigInt(event.cursor);
    if (explained == null || at > explained) explained = at;
  }
  const gap = replay != null && explained != null && BigInt(replay) > explained;
  const advanced = next != null
    && (requested == null || BigInt(next) !== BigInt(requested));
  return {
    changed: events.length > 0 || gap || advanced,
    gap,
    /* The verbatim decimal STRING — never a numeric round-trip. */
    nextAfterCursor: next != null ? next : null,
  };
}

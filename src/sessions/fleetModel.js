import { loomUnavailableFromError } from "./loomModel.js";

/* Subagent fleet view model (P2): pure, side-effect-free transforms between
   the P0.5 fleet SDK wire shapes and what the UI renders. House law:
   - `folded_children` is honest: a node with children:[] and
     folded_children:N>0 is BOUNDED ("N more not shown"), never a real leaf;
     only folded_children:0 with no children is a leaf.
   - `truncated` / `complete` / `metrics_complete` render honestly: a bounded
     snapshot is labeled bounded and never presented as the complete tree,
     and absent completeness facts are UNKNOWN, never claimed complete.
   - Metrics/usage absence is "no data", never a fabricated zero.
   - A missing `callsign` may fall back to the agent id, but the view marks
     the fallback so it can never masquerade as a daemon-assigned identity.
   - Lineage comes only from the real parent_session_id / parent_agent_id /
     agent_id fields: an absent parent is null (unknown), never inferred. */

export const FLEET_KNOWN_AGENT_STATES = Object.freeze([
  "queued",
  "live",
  "waiting",
  "done",
  "failed",
  "cancelled",
]);

const KNOWN_AGENT_STATE_SET = new Set(FLEET_KNOWN_AGENT_STATES);

const KNOWN_DELIVERY_SET = new Set([
  "delivered_steer",
  "delivered_queued",
  "delivered_subturn",
]);

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function nonEmptyStringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/* Completeness flags are TRI-state: only an explicit boolean is a daemon
   claim — an absent (or non-boolean) flag is null, UNKNOWN. Collapsing
   absence to false would fabricate an "incomplete" report the daemon never
   made. */
function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

/* Agent state as the daemon said it. An unrecognized string is kind
   "unknown" with the raw daemon string preserved verbatim as the label —
   never coerced onto a known state, never dropped. */
export function agentStateView(state) {
  const raw = typeof state === "string" ? state : String(state ?? "");
  if (KNOWN_AGENT_STATE_SET.has(raw)) {
    return { kind: raw, label: raw, raw };
  }
  return { kind: "unknown", label: raw, raw };
}

/* Display label for one node. `callsign` is the daemon-assigned identity;
   when it is ABSENT the only honest label is a client fallback over the
   agent id — flagged `fallback: true` so the view must mark it visibly.
   Never a fabricated title, never the word "subagent" invented from an id. */
export function nodeLabel(node) {
  const callsign = typeof node?.callsign === "string" ? node.callsign.trim() : "";
  if (callsign) {
    return { text: callsign, fallback: false };
  }
  const agentId = String(node?.agentId ?? node?.agent_id ?? "");
  const short = agentId.length > 12 ? agentId.slice(0, 12) : agentId;
  return { text: short, fallback: true };
}

/* One descendant, recursively. THE folded_children pin: `bounded` is true
   iff folded_children > 0, and `leaf` is true iff folded_children === 0 AND
   there are no children — an empty children array alone proves nothing.
   `metrics` stays the verbatim opaque daemon record (or null for "no
   data"). parent ids are verbatim-or-null: an absent parent is UNKNOWN. */
export function fleetNodeView(node) {
  const children = Array.isArray(node?.children)
    ? node.children.map(fleetNodeView)
    : [];
  const folded = Number.isFinite(node?.folded_children) && node.folded_children > 0
    ? node.folded_children
    : 0;
  return {
    agentId: String(node?.agent_id ?? ""),
    sessionId: String(node?.session_id ?? ""),
    callsign: nonEmptyStringOrNull(node?.callsign),
    task: String(node?.task ?? ""),
    depth: finiteOrNull(node?.depth),
    parentSessionId: nonEmptyStringOrNull(node?.parent_session_id),
    parentAgentId: nonEmptyStringOrNull(node?.parent_agent_id),
    state: agentStateView(node?.state),
    metrics: node?.metrics ?? null,
    foldedChildren: folded,
    bounded: folded > 0,
    leaf: folded === 0 && children.length === 0,
    children,
  };
}

/* The bounded point-in-time tree. roots default to [] (an available empty
   snapshot is genuine emptiness — the daemon said so); `truncated` is true
   only when the daemon said true. */
export function fleetTreeView(snapshot) {
  return {
    sessionId: String(snapshot?.session_id ?? ""),
    generatedAtMs: finiteOrNull(snapshot?.generated_at_ms),
    nodeLimit: finiteOrNull(snapshot?.node_limit),
    depthLimit: finiteOrNull(snapshot?.depth_limit),
    roots: Array.isArray(snapshot?.roots) ? snapshot.roots.map(fleetNodeView) : [],
    truncated: snapshot?.truncated === true,
  };
}

/* Rollup totals for the chips. THE no-data pin: an absent metrics record
   (or absent usage) is null — rendered "no data" — NEVER a fabricated
   0 ms / 0 attempts / 0 tokens. Completeness flags are TRI-state claims:
   true/false only when the daemon explicitly said so, null (unknown) when
   the field is absent — absence is never collapsed into "incomplete". */
export function rollupView(rollup) {
  if (!rollup || typeof rollup !== "object") return null;
  const states = rollup.states && typeof rollup.states === "object" ? rollup.states : {};
  const metrics = rollup.metrics && typeof rollup.metrics === "object" ? rollup.metrics : null;
  return {
    nodeCount: finiteOrNull(rollup.node_count),
    states: {
      queued: finiteOrNull(states.queued),
      live: finiteOrNull(states.live),
      waiting: finiteOrNull(states.waiting),
      done: finiteOrNull(states.done),
      failed: finiteOrNull(states.failed),
      cancelled: finiteOrNull(states.cancelled),
    },
    maxDepth: finiteOrNull(rollup.max_depth),
    elapsedMs: metrics ? finiteOrNull(metrics.elapsed_ms) : null,
    toolAttempts: metrics ? finiteOrNull(metrics.tool_attempts) : null,
    usage: metrics && metrics.usage != null ? metrics.usage : null,
    metricsComplete: booleanOrNull(rollup.metrics_complete),
    complete: booleanOrNull(rollup.complete),
  };
}

/* Snapshot boundedness as a typed tri-state. "bounded" when the daemon said
   truncated (or said the rollup is incomplete); "complete" ONLY when it
   explicitly said truncated:false AND complete:true; anything else —
   missing fields included — is "unknown", which the UI must not present as
   the complete tree. */
export function truncationView(snapshot) {
  const truncated = snapshot?.truncated;
  const complete = snapshot?.rollup?.complete;
  const metricsComplete = snapshot?.rollup?.metrics_complete;
  let kind = "unknown";
  if (truncated === true || complete === false) {
    kind = "bounded";
  } else if (truncated === false && complete === true) {
    kind = "complete";
  }
  return {
    kind,
    truncated: booleanOrNull(truncated),
    complete: booleanOrNull(complete),
    metricsComplete: booleanOrNull(metricsComplete),
    nodeLimit: finiteOrNull(snapshot?.node_limit),
    depthLimit: finiteOrNull(snapshot?.depth_limit),
  };
}

/* agent.message receipt. Delivery is the daemon's string verbatim; an
   unknown future delivery keeps its raw string as the label (kind
   "unknown"), never coerced. child_run_state is opaque daemon authority,
   carried verbatim (null only when genuinely absent). */
export function messageReceiptView(receipt) {
  const raw = typeof receipt?.delivery === "string"
    ? receipt.delivery
    : String(receipt?.delivery ?? "");
  return {
    agent: String(receipt?.agent ?? ""),
    delivery: {
      kind: KNOWN_DELIVERY_SET.has(raw) ? raw : "unknown",
      label: raw,
      raw,
    },
    childRunId: String(receipt?.child_run_id ?? ""),
    childRunState: receipt?.child_run_state ?? null,
  };
}

/* Find one node view by its REAL agent id — the only selection coordinate.
   Returns null when the id is not in the tree (never a substitute node). */
export function findFleetNode(tree, agentId) {
  if (!agentId) return null;
  const stack = Array.isArray(tree?.roots) ? [...tree.roots] : [];
  while (stack.length > 0) {
    const node = stack.shift();
    if (node.agentId === agentId) return node;
    stack.push(...node.children);
  }
  return null;
}

/* All descendant session ids present in the snapshot, tree order, deduped —
   the observe-batch feed. Only ids the daemon actually published. */
export function fleetSessionIds(tree) {
  const ids = [];
  const seen = new Set();
  const stack = Array.isArray(tree?.roots) ? [...tree.roots] : [];
  while (stack.length > 0) {
    const node = stack.shift();
    if (node.sessionId && !seen.has(node.sessionId)) {
      seen.add(node.sessionId);
      ids.push(node.sessionId);
    }
    stack.push(...node.children);
  }
  return ids;
}

/* Same feature-gate phrasings as loom/workflow: settle-once unavailable. */
export const fleetUnavailableFromError = loomUnavailableFromError;

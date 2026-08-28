import { agentStateView, fleetUnavailableFromError } from "./fleetModel.js";

/* Pure model for the live descendant stream (962). Sequence positions are
   opaque u64-scale DECIMAL STRINGS. They are validated as strings, compared
   with BigInt, and copied verbatim; a JS number is never accepted as a
   cursor because it may already have lost precision. */

const DECIMAL_SEQUENCE = /^\d+$/;

const ADDED_KINDS = new Set([
  "child_added",
  "child_spawned",
  "descendant_added",
  "descendant_spawned",
  "node_added",
]);

const UPDATED_KINDS = new Set([
  "child_updated",
  "descendant_updated",
  "node_updated",
]);

const STATE_KINDS = new Set([
  "child_state_changed",
  "descendant_state_changed",
  "state_changed",
]);

const REMOVED_KINDS = new Set([
  "child_removed",
  "descendant_removed",
  "node_removed",
]);

function own(source, names) {
  if (!source || typeof source !== "object") return { present: false, value: undefined };
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(source, name)) {
      return { present: true, value: source[name] };
    }
  }
  return { present: false, value: undefined };
}

function textOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function countOrNull(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function decimalOrNull(value) {
  return typeof value === "string" && DECIMAL_SEQUENCE.test(value) ? value : null;
}

function pairKey(sessionId, agentId) {
  return JSON.stringify([sessionId, agentId]);
}

function stateFrom(source) {
  const state = own(source, ["state"]);
  return state.present ? agentStateView(state.value) : null;
}

/* One baseline/live node in the same presentation shape FleetPanel already
   consumes. A missing state stays null ("not published"); it is not filled
   with queued/live or any other plausible-looking client guess. */
function descendantNodeView(node) {
  const requestedAfterSeq = decimalOrNull(node?.requested_after_seq ?? node?.requestedAfterSeq);
  const children = Array.isArray(node?.children)
    ? node.children.map(descendantNodeView)
    : [];
  return {
    sessionId: String(node?.session_id ?? node?.sessionId ?? ""),
    agentId: String(node?.agent_id ?? node?.agentId ?? ""),
    childRunId: String(node?.child_run_id ?? node?.childRunId ?? ""),
    parentSessionId: textOrNull(node?.parent_session_id ?? node?.parentSessionId),
    parentRunId: textOrNull(node?.parent_run_id ?? node?.parentRunId),
    parentAgentId: textOrNull(node?.parent_agent_id ?? node?.parentAgentId),
    depth: countOrNull(node?.depth),
    callsign: textOrNull(node?.callsign),
    task: String(node?.task ?? ""),
    state: stateFrom(node),
    requestedAfterSeq,
    afterSeq: requestedAfterSeq,
    spawnSeq: decimalOrNull(node?.spawn_seq ?? node?.spawnSeq),
    metrics: node?.metrics ?? null,
    foldedChildren: 0,
    bounded: false,
    leaf: children.length === 0,
    children,
    raw: node ?? null,
  };
}

function flattenCursorFacts(roots) {
  const facts = [];
  const stack = Array.isArray(roots) ? [...roots] : [];
  while (stack.length > 0) {
    const node = stack.shift();
    if (node.sessionId && node.agentId && decimalOrNull(node.afterSeq) != null) {
      facts.push({
        session_id: node.sessionId,
        agent_id: node.agentId,
        after_seq: node.afterSeq,
      });
    }
    stack.push(...(Array.isArray(node.children) ? node.children : []));
  }
  return facts;
}

/* Baseline honesty stays structured so the UI cannot blur accepted fan-out
   into requested fan-out or treat an incomplete omitted count as a total. */
export function baselineView(baseline) {
  const requestedChildren = countOrNull(baseline?.fanout?.requested_children);
  const acceptedChildren = countOrNull(baseline?.fanout?.accepted_children);
  const hardLimit = countOrNull(baseline?.fanout?.hard_limit);
  const countComplete = typeof baseline?.truncation?.count_complete === "boolean"
    ? baseline.truncation.count_complete
    : null;
  const roots = Array.isArray(baseline?.roots)
    ? baseline.roots.map(descendantNodeView)
    : [];
  return {
    sessionId: String(baseline?.session_id ?? ""),
    generatedAtMs: countOrNull(baseline?.generated_at_ms),
    fanout: {
      requestedChildren,
      acceptedChildren,
      hardLimit,
      limited: requestedChildren != null
        && acceptedChildren != null
        && acceptedChildren < requestedChildren,
    },
    truncation: {
      truncated: typeof baseline?.truncation?.truncated === "boolean"
        ? baseline.truncation.truncated
        : null,
      streamedChildren: countOrNull(baseline?.truncation?.streamed_children),
      omittedChildren: countOrNull(baseline?.truncation?.omitted_children),
      countComplete,
      omittedCountTrusted: countComplete === true,
    },
    tree: {
      sessionId: String(baseline?.session_id ?? ""),
      generatedAtMs: countOrNull(baseline?.generated_at_ms),
      roots,
      appliedCursors: flattenCursorFacts(roots),
      unrecognizedEvents: [],
    },
  };
}

function eventParts(event) {
  const change = event?.change && typeof event.change === "object"
    ? event.change
    : event;
  const node = change?.node ?? change?.descendant ?? change?.child ?? null;
  const kindValue = change?.kind ?? change?.type ?? event?.kind ?? event?.type;
  return {
    change,
    node,
    kindRaw: typeof kindValue === "string" ? kindValue : null,
    sessionId: String(
      event?.session_id
      ?? event?.sessionId
      ?? change?.session_id
      ?? change?.sessionId
      ?? node?.session_id
      ?? node?.sessionId
      ?? "",
    ),
    agentId: String(
      event?.agent_id
      ?? event?.agentId
      ?? change?.agent_id
      ?? change?.agentId
      ?? node?.agent_id
      ?? node?.agentId
      ?? "",
    ),
    seq: decimalOrNull(
      event?.seq
      ?? event?.after_seq
      ?? event?.cursor
      ?? change?.seq
      ?? change?.after_seq,
    ),
  };
}

function newestCursor(facts, sessionId, agentId) {
  let held = null;
  for (const fact of facts) {
    if (fact?.session_id !== sessionId || fact?.agent_id !== agentId) continue;
    const candidate = decimalOrNull(fact?.after_seq);
    if (candidate == null) continue;
    if (held == null || BigInt(candidate) > BigInt(held)) held = candidate;
  }
  return held;
}

function advanceCursor(facts, sessionId, agentId, seq) {
  if (!sessionId || !agentId || seq == null) return facts;
  const next = [];
  let replaced = false;
  for (const fact of facts) {
    if (fact?.session_id === sessionId && fact?.agent_id === agentId) {
      if (!replaced) {
        next.push({ session_id: sessionId, agent_id: agentId, after_seq: seq });
        replaced = true;
      }
    } else {
      next.push(fact);
    }
  }
  if (!replaced) next.push({ session_id: sessionId, agent_id: agentId, after_seq: seq });
  return next;
}

function unrecognizedFact(parts, event, stale = false) {
  return {
    kind: "unknown",
    kindRaw: parts.kindRaw,
    sessionId: parts.sessionId,
    agentId: parts.agentId,
    seq: parts.seq,
    stale,
    raw: event,
  };
}

function patchNode(node, patch) {
  if (!patch || typeof patch !== "object") return node;
  const next = { ...node, raw: { ...(node.raw || {}), ...patch } };
  const fields = [
    [["child_run_id", "childRunId"], "childRunId", (value) => String(value ?? "")],
    [["parent_session_id", "parentSessionId"], "parentSessionId", textOrNull],
    [["parent_run_id", "parentRunId"], "parentRunId", textOrNull],
    [["parent_agent_id", "parentAgentId"], "parentAgentId", textOrNull],
    [["depth"], "depth", countOrNull],
    [["callsign"], "callsign", textOrNull],
    [["task"], "task", (value) => String(value ?? "")],
    [["spawn_seq", "spawnSeq"], "spawnSeq", decimalOrNull],
  ];
  for (const [names, target, transform] of fields) {
    const value = own(patch, names);
    if (value.present) next[target] = transform(value.value);
  }
  const state = own(patch, ["state"]);
  if (state.present) next.state = agentStateView(state.value);
  const children = own(patch, ["children"]);
  if (children.present && Array.isArray(children.value)) {
    next.children = children.value.map(descendantNodeView);
    next.leaf = next.children.length === 0;
  }
  return next;
}

function updatePair(roots, sessionId, agentId, updater) {
  let found = false;
  const visit = (node) => {
    let next = node;
    if (node.sessionId === sessionId && node.agentId === agentId) {
      found = true;
      next = updater(node);
    }
    const children = next.children.map(visit);
    return children === next.children ? next : { ...next, children, leaf: children.length === 0 };
  };
  return { roots: roots.map(visit), found };
}

function insertNode(roots, added) {
  const parentSessionId = added.parentSessionId;
  const parentAgentId = added.parentAgentId;
  if (!parentSessionId || !parentAgentId) return [...roots, added];
  const parent = updatePair(roots, parentSessionId, parentAgentId, (node) => ({
    ...node,
    leaf: false,
    children: [...node.children, added],
  }));
  return parent.found ? parent.roots : [...roots, added];
}

function removePair(roots, sessionId, agentId) {
  const prune = (nodes) => nodes
    .filter((node) => node.sessionId !== sessionId || node.agentId !== agentId)
    .map((node) => {
      const children = prune(node.children);
      return { ...node, children, leaf: children.length === 0 };
    });
  return prune(roots);
}

/* Reduce one typed change fact. Identity matching always uses BOTH
   (session_id, agent_id). Unknown kinds survive in unrecognizedEvents and
   still advance only that child's cursor. A known update changes only
   fields actually carried by the event; notably, a state-less event never
   fabricates a state. */
export function applyStreamEvent(tree, event) {
  const current = tree && typeof tree === "object"
    ? tree
    : { roots: [], appliedCursors: [], unrecognizedEvents: [] };
  const roots = Array.isArray(current.roots) ? current.roots : [];
  const held = Array.isArray(current.appliedCursors)
    ? current.appliedCursors
    : flattenCursorFacts(roots);
  const parts = eventParts(event);
  const previous = newestCursor(held, parts.sessionId, parts.agentId);
  if (parts.seq != null && previous != null && BigInt(parts.seq) <= BigInt(previous)) {
    const recognized = ADDED_KINDS.has(parts.kindRaw)
      || UPDATED_KINDS.has(parts.kindRaw)
      || STATE_KINDS.has(parts.kindRaw)
      || REMOVED_KINDS.has(parts.kindRaw);
    if (recognized) return current;
    const unrecognizedEvents = Array.isArray(current.unrecognizedEvents)
      ? current.unrecognizedEvents
      : [];
    return {
      ...current,
      unrecognizedEvents: [...unrecognizedEvents, unrecognizedFact(parts, event, true)],
    };
  }

  let nextRoots = roots;
  let recognized = true;
  const patch = parts.node ?? parts.change;

  if (ADDED_KINDS.has(parts.kindRaw)) {
    const added = descendantNodeView(parts.node ?? parts.change);
    const existing = updatePair(
      roots,
      added.sessionId || parts.sessionId,
      added.agentId || parts.agentId,
      (node) => patchNode(node, parts.node ?? parts.change),
    );
    nextRoots = existing.found ? existing.roots : insertNode(roots, added);
  } else if (UPDATED_KINDS.has(parts.kindRaw)) {
    nextRoots = updatePair(
      roots,
      parts.sessionId,
      parts.agentId,
      (node) => patchNode(node, patch),
    ).roots;
  } else if (STATE_KINDS.has(parts.kindRaw)) {
    /* patchNode's presence check is the no-invented-state pin. */
    nextRoots = updatePair(
      roots,
      parts.sessionId,
      parts.agentId,
      (node) => patchNode(node, parts.change),
    ).roots;
  } else if (REMOVED_KINDS.has(parts.kindRaw)) {
    nextRoots = removePair(roots, parts.sessionId, parts.agentId);
  } else {
    recognized = false;
  }

  if (parts.seq != null && parts.sessionId && parts.agentId) {
    nextRoots = updatePair(nextRoots, parts.sessionId, parts.agentId, (node) => ({
      ...node,
      afterSeq: parts.seq,
    })).roots;
  }

  const unrecognizedEvents = Array.isArray(current.unrecognizedEvents)
    ? current.unrecognizedEvents
    : [];
  return {
    ...current,
    roots: nextRoots,
    appliedCursors: parts.seq != null
      ? advanceCursor(held, parts.sessionId, parts.agentId, parts.seq)
      : held,
    unrecognizedEvents: recognized
      ? unrecognizedEvents
      : [...unrecognizedEvents, unrecognizedFact(parts, event)],
  };
}

/* Return one cursor per exact child identity. When duplicate facts exist,
   the BigInt-newest fact wins and its decimal spelling rides verbatim. */
export function cursorsFor(tree) {
  const roots = Array.isArray(tree?.roots) ? tree.roots : [];
  const facts = [
    ...flattenCursorFacts(roots),
    ...(Array.isArray(tree?.appliedCursors) ? tree.appliedCursors : []),
  ];
  const byPair = new Map();
  for (const fact of facts) {
    const sessionId = String(fact?.session_id ?? "");
    const agentId = String(fact?.agent_id ?? "");
    const afterSeq = decimalOrNull(fact?.after_seq);
    if (!sessionId || !agentId || afterSeq == null) continue;
    const key = pairKey(sessionId, agentId);
    const previous = byPair.get(key);
    if (!previous || BigInt(afterSeq) > BigInt(previous.after_seq)) {
      byPair.set(key, { session_id: sessionId, agent_id: agentId, after_seq: afterSeq });
    }
  }
  return [...byPair.values()];
}

/* A repair frame names children but makes NO sequence claim. Its plan is
   therefore only the intersection with the client's own held positions;
   absent positions stay absent — never synthesized as "0" (or anything
   else), and identity matching uses both coordinates. */
export function repairPlan(children, heldCursors) {
  const held = Array.isArray(heldCursors) ? heldCursors : [];
  const plan = [];
  const seen = new Set();
  for (const child of Array.isArray(children) ? children : []) {
    const sessionId = String(child?.session_id ?? "");
    const agentId = String(child?.agent_id ?? "");
    if (!sessionId || !agentId) continue;
    const key = pairKey(sessionId, agentId);
    if (seen.has(key)) continue;
    const afterSeq = newestCursor(held, sessionId, agentId);
    if (afterSeq == null) continue;
    seen.add(key);
    plan.push({ session_id: sessionId, agent_id: agentId, after_seq: afterSeq });
  }
  return plan;
}

/* Reuse the existing Fleet feature-gate phrasing detector, with the pinned
   structured missing_feature code accepted before its message is unwrapped. */
export function descendantUnavailableFromError(error) {
  return error?.code === "missing_feature" || fleetUnavailableFromError(error);
}

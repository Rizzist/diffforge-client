import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  agentStateView,
  findFleetNode,
  fleetNodeView,
  fleetSessionIds,
  fleetTreeView,
  fleetUnavailableFromError,
  messageReceiptView,
  nodeLabel,
  rollupView,
  truncationView,
} from "./fleetModel.js";

function wireNode(overrides = {}) {
  return {
    agent_id: "agent-abcdef123456",
    session_id: "child-sess-1",
    callsign: "scout",
    task: "survey the fixtures",
    depth: 1,
    parent_session_id: "root-sess",
    parent_agent_id: null,
    state: "live",
    folded_children: 0,
    children: [],
    ...overrides,
  };
}

function wireSnapshot(overrides = {}) {
  return {
    session_id: "root-sess",
    generated_at_ms: 1000,
    node_limit: 200,
    depth_limit: 5,
    roots: [wireNode()],
    rollup: {
      node_count: 1,
      states: { queued: 0, live: 1, waiting: 0, done: 0, failed: 0, cancelled: 0 },
      max_depth: 1,
      metrics: { elapsed_ms: 1234, tool_attempts: 7, usage: { input_tokens: 42 } },
      metrics_complete: true,
      complete: true,
    },
    truncated: false,
    ...overrides,
  };
}

/* ---- house law 1: folded_children is honest ---------------------------- */

test("[pin] folded_children N>0 with children:[] is BOUNDED, never a real leaf", () => {
  const bounded = fleetNodeView(wireNode({ children: [], folded_children: 3 }));
  assert.equal(bounded.foldedChildren, 3, "the folded count must survive verbatim");
  assert.equal(bounded.bounded, true, "folded children make the node bounded");
  assert.equal(bounded.leaf, false,
    "children:[] with folded_children:3 is NOT a leaf — 3 descendants exist unshown");

  /* Only folded_children === 0 with no children is a real leaf. */
  const leaf = fleetNodeView(wireNode({ children: [], folded_children: 0 }));
  assert.equal(leaf.foldedChildren, 0);
  assert.equal(leaf.bounded, false);
  assert.equal(leaf.leaf, true, "folded_children:0 with no children IS a real leaf");

  /* Wire omission of folded_children (skip_serializing_if is_zero) = 0. */
  const omitted = wireNode({ children: [] });
  delete omitted.folded_children;
  assert.equal(fleetNodeView(omitted).leaf, true,
    "an omitted folded_children is the wire's zero — a real leaf");

  /* A node with visible children and a folded remainder is neither leaf
     nor fully shown. */
  const partial = fleetNodeView(wireNode({
    children: [wireNode({ agent_id: "agent-child", session_id: "child-sess-2" })],
    folded_children: 2,
  }));
  assert.equal(partial.leaf, false);
  assert.equal(partial.bounded, true);
  assert.equal(partial.children.length, 1);
  assert.equal(partial.foldedChildren, 2);
});

/* ---- house law 2: truncated / complete shown honestly ------------------ */

test("[pin] a bounded snapshot is typed bounded and absent completeness is UNKNOWN, never complete", () => {
  /* Daemon said truncated -> bounded. */
  assert.equal(truncationView(wireSnapshot({ truncated: true })).kind, "bounded");

  /* Daemon said the rollup is incomplete -> bounded even without truncated. */
  const incompleteRollup = wireSnapshot();
  incompleteRollup.rollup = { ...incompleteRollup.rollup, complete: false };
  assert.equal(truncationView(incompleteRollup).kind, "bounded");

  /* Only an explicit truncated:false AND complete:true is "complete". */
  assert.equal(truncationView(wireSnapshot()).kind, "complete");

  /* Missing fields are UNKNOWN — never presented as the complete tree. */
  const bare = wireSnapshot();
  delete bare.truncated;
  delete bare.rollup;
  const unknown = truncationView(bare);
  assert.equal(unknown.kind, "unknown",
    "absent truncated/complete must NOT be claimed complete");
  assert.equal(unknown.truncated, null);
  assert.equal(unknown.complete, null);
  assert.equal(unknown.metricsComplete, null);

  /* metrics_complete:false survives verbatim on the rollup view. */
  const partialMetrics = wireSnapshot();
  partialMetrics.rollup = { ...partialMetrics.rollup, metrics_complete: false };
  assert.equal(rollupView(partialMetrics.rollup).metricsComplete, false);
  assert.equal(fleetTreeView(wireSnapshot({ truncated: true })).truncated, true);
});

test("[pin] completeness flags are TRI-state: absence is null (unknown), DISTINCT from an explicit false", () => {
  /* Absent metrics_complete AND complete -> null, never a fabricated
     "incomplete"/"partial" claim the daemon did not make. */
  const bare = wireSnapshot().rollup;
  delete bare.metrics_complete;
  delete bare.complete;
  const unknown = rollupView(bare);
  assert.equal(unknown.metricsComplete, null,
    "an absent metrics_complete must resolve to null (unknown), never false");
  assert.notEqual(unknown.metricsComplete, false,
    "absence must stay DISTINCT from an explicit metrics_complete:false");
  assert.equal(unknown.complete, null,
    "an absent complete must resolve to null (unknown), never false");
  assert.notEqual(unknown.complete, false,
    "absence must stay DISTINCT from an explicit complete:false");

  /* Non-boolean junk is absence too — never coerced into a claim. */
  const junk = wireSnapshot().rollup;
  junk.metrics_complete = "yes";
  junk.complete = 1;
  assert.equal(rollupView(junk).metricsComplete, null);
  assert.equal(rollupView(junk).complete, null);

  /* Explicit booleans survive verbatim on the same fields. */
  const explicit = wireSnapshot().rollup;
  explicit.metrics_complete = false;
  explicit.complete = false;
  assert.equal(rollupView(explicit).metricsComplete, false);
  assert.equal(rollupView(explicit).complete, false);
  assert.equal(rollupView(wireSnapshot().rollup).metricsComplete, true);
  assert.equal(rollupView(wireSnapshot().rollup).complete, true);

  /* And the null case must never be RENDERED as "partial": the panel's
     partial marker requires the explicit false, and the unknown case has
     its own honest wording. */
  const panel = readFileSync(new URL("./FleetPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /rollup\.metricsComplete === false && \(/,
    "the 'metrics partial' marker must require an EXPLICIT false");
  assert.doesNotMatch(panel, /!rollup\.metricsComplete/,
    "absence must never be collapsed into the partial marker");
  assert.ok(panel.includes("metrics completeness unknown"),
    "an unreported completeness flag renders as unknown, not partial");
});

/* ---- house law 3: metrics/usage absence is "no data", never zero ------- */

test("[pin] absent metrics/usage become null (no data), NEVER a fabricated zero", () => {
  const noMetrics = rollupView({
    node_count: 4,
    states: { queued: 0, live: 2, waiting: 0, done: 2, failed: 0, cancelled: 0 },
    max_depth: 2,
    metrics_complete: false,
    complete: true,
  });
  assert.equal(noMetrics.elapsedMs, null, "absent metrics.elapsed_ms is null, not 0");
  assert.notEqual(noMetrics.elapsedMs, 0, "no data must never read as 0 ms");
  assert.equal(noMetrics.toolAttempts, null, "absent tool_attempts is null, not 0");
  assert.equal(noMetrics.usage, null, "absent usage is null, not a zeroed record");

  /* usage absent while the metrics record exists: usage alone is null. */
  const noUsage = rollupView(wireSnapshot().rollup);
  assert.deepEqual(noUsage.usage, { input_tokens: 42 }, "present usage rides verbatim");
  const rollup = wireSnapshot().rollup;
  delete rollup.metrics.usage;
  const view = rollupView(rollup);
  assert.equal(view.usage, null, "absent usage is null even with elapsed/tools present");
  assert.equal(view.elapsedMs, 1234);
  assert.equal(view.toolAttempts, 7);

  /* A node without a metrics record is "no data" too. */
  const node = wireNode();
  delete node.metrics;
  assert.equal(fleetNodeView(node).metrics, null, "absent node metrics is null");

  /* No rollup at all is null — not a zeroed rollup. */
  assert.equal(rollupView(undefined), null);
});

/* ---- house law 4: callsign fallback is client-labeled ------------------ */

test("[pin] an absent callsign yields a FLAGGED fallback label, never a daemon-looking identity", () => {
  /* Daemon callsign: not a fallback. */
  assert.deepEqual(nodeLabel(fleetNodeView(wireNode())), { text: "scout", fallback: false });

  /* Absent callsign: agent-id fallback, and the flag MUST say so. */
  const bare = wireNode();
  delete bare.callsign;
  const fallback = nodeLabel(fleetNodeView(bare));
  assert.equal(fallback.fallback, true,
    "a client-derived label must be flagged as a fallback");
  assert.equal(fallback.text, "agent-abcdef", "the fallback derives from the real agent id");

  /* Empty/whitespace callsign is absence, not an identity. */
  assert.equal(nodeLabel(fleetNodeView(wireNode({ callsign: "  " }))).fallback, true);
  assert.equal(fleetNodeView(wireNode({ callsign: "" })).callsign, null);

  /* The fallback never fabricates a title: no invented "subagent" naming. */
  assert.doesNotMatch(fallback.text, /subagent|agent \d|untitled/i,
    "the fallback text is the id itself, never an invented title");
});

/* ---- house law 6: lineage from real ids only --------------------------- */

test("[pin] parent lineage is verbatim-or-null: an absent parent is UNKNOWN, never inferred", () => {
  const node = fleetNodeView(wireNode());
  assert.equal(node.parentSessionId, "root-sess", "parent_session_id rides verbatim");
  assert.equal(node.parentAgentId, null, "a null parent_agent_id stays null");

  /* Missing parent_session_id -> null (unknown) — NEVER the snapshot's
     session id or any other guess substituted in. */
  const orphan = wireNode();
  delete orphan.parent_session_id;
  const orphanView = fleetNodeView(orphan);
  assert.equal(orphanView.parentSessionId, null,
    "an absent parent_session_id must be null (unknown), not a substituted id");
  assert.notEqual(orphanView.parentSessionId, "root-sess",
    "the snapshot root session must never be guessed in as the parent");

  const withParentAgent = fleetNodeView(wireNode({ parent_agent_id: "agent-parent" }));
  assert.equal(withParentAgent.parentAgentId, "agent-parent");

  /* Selection resolves by the REAL agent id only — no substitute node. */
  const tree = fleetTreeView(wireSnapshot({
    roots: [wireNode({
      children: [wireNode({ agent_id: "agent-deep", session_id: "child-sess-9" })],
    })],
  }));
  assert.equal(findFleetNode(tree, "agent-deep").sessionId, "child-sess-9");
  assert.equal(findFleetNode(tree, "agent-not-here"), null,
    "an unknown agent id resolves to null, never a substitute node");
  assert.equal(findFleetNode(tree, ""), null);
});

/* ---- supporting shapes ------------------------------------------------- */

test("agentStateView keeps the six known states and preserves unknown raw strings", () => {
  for (const known of ["queued", "live", "waiting", "done", "failed", "cancelled"]) {
    assert.deepEqual(agentStateView(known), { kind: known, label: known, raw: known });
  }
  const future = agentStateView("hibernating");
  assert.equal(future.kind, "unknown");
  assert.equal(future.label, "hibernating", "an unknown state keeps its raw string verbatim");
});

test("messageReceiptView types known deliveries and preserves unknown ones raw", () => {
  const receipt = messageReceiptView({
    agent: "agent-1",
    delivery: "delivered_steer",
    child_run_id: "run-9",
    child_run_state: { state: "thinking" },
  });
  assert.equal(receipt.delivery.kind, "delivered_steer");
  assert.deepEqual(receipt.childRunState, { state: "thinking" },
    "child_run_state is opaque daemon authority carried verbatim");

  const future = messageReceiptView({
    agent: "agent-1",
    delivery: "delivered_by_pigeon",
    child_run_id: "run-10",
  });
  assert.equal(future.delivery.kind, "unknown");
  assert.equal(future.delivery.raw, "delivered_by_pigeon");
  assert.equal(future.childRunState, null, "an absent run state is null, not invented");
});

test("fleetTreeView carries snapshot bounds and fleetSessionIds walks only published ids", () => {
  const tree = fleetTreeView(wireSnapshot({
    roots: [
      wireNode({
        children: [wireNode({ agent_id: "a2", session_id: "child-sess-2" })],
      }),
      wireNode({ agent_id: "a3", session_id: "child-sess-1" }),
    ],
  }));
  assert.equal(tree.nodeLimit, 200);
  assert.equal(tree.depthLimit, 5);
  assert.deepEqual(fleetSessionIds(tree), ["child-sess-1", "child-sess-2"],
    "session ids are tree-ordered and deduped, only from the snapshot");
  assert.deepEqual(fleetSessionIds(fleetTreeView({})), []);
});

test("fleetUnavailableFromError matches the daemon feature-gate phrasings", () => {
  assert.equal(fleetUnavailableFromError("missing_feature: daemon does not advertise session_fleet_v1"), true);
  assert.equal(fleetUnavailableFromError(new Error("does not advertise agent_message_v1")), true);
  assert.equal(fleetUnavailableFromError("session.fleet unavailable on this platform"), true);
  assert.equal(fleetUnavailableFromError("connection reset by peer"), false);
});

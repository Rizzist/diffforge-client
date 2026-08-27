import assert from "node:assert/strict";
import test from "node:test";

import {
  graphEdgeView,
  graphNodeView,
  graphStateView,
  watchEventView,
  watchPageView,
  watchSignal,
  workflowGraphUnavailableFromError,
} from "./workflowGraphModel.js";

function liveState(overrides = {}) {
  return {
    graph_id: "wfg-1",
    ast: {
      workflow_id: "review_loop",
      nodes: [{ node: "draft" }, { node: "review" }],
      edges: [
        { kind: "graph_input", to: "draft" },
        { kind: "forward", from: "draft", to: "review" },
        { kind: "back", from: "review", to: "draft" },
      ],
    },
    ast_digest: "ast-digest-fff",
    seed: { prompt: "x" },
    phase: "running",
    through_cursor: "41",
    next_activation_order: 3,
    back_edge_activations: { "review->draft": 1 },
    nodes: [
      { node: "draft", phase: "completed" },
      { node: "review", phase: "activated" },
    ],
    activation_order: [{ node: "draft", order: 1 }],
    ...overrides,
  };
}

/* HOUSE LAW 1 — ast_digest is THE topology fence, verbatim only. */
test("[pin] graphStateView carries ast_digest VERBATIM and never recomputes or fabricates it", () => {
  const view = graphStateView(liveState());
  assert.equal(view.kind, "graph");
  assert.equal(view.astDigest, "ast-digest-fff");

  /* An absent digest stays NULL even though the full ast is right there —
     a recompute over the ast would produce a value here, and that value
     would be a fence nobody published. */
  const undigested = graphStateView(liveState({ ast_digest: undefined }));
  assert.equal(undigested.astDigest, null);
  assert.notEqual(undigested.astDigest, "");
  assert.ok(undigested.ast != null, "the ast is present, yet no digest was invented from it");

  /* An empty-string digest is not a fence either. */
  assert.equal(graphStateView(liveState({ ast_digest: "" })).astDigest, null);

  /* The fence is its OWN fact: never backfilled from graph_id, seed, or a
     cursor. */
  assert.notEqual(view.astDigest, view.graphId);
  assert.notEqual(view.astDigest, String(view.throughCursor));
});

/* HOUSE LAW 2 — state:null is an honest "no live workflow graph". */
test("[pin] graphStateView(null) is a distinct 'none' view — never a fabricated empty graph", () => {
  const none = graphStateView(null);
  assert.deepEqual(none, { kind: "none" });
  /* NOTHING an empty graph would carry: no node list to mistake for zero
     nodes, no edges, no digest, no phase. */
  assert.equal(none.nodes, undefined);
  assert.equal(none.edges, undefined);
  assert.equal(none.astDigest, undefined);
  assert.equal(none.phase, undefined);
  assert.deepEqual(graphStateView(undefined), { kind: "none" });

  /* Only a real state is kind "graph" — the two claims never collapse. */
  assert.equal(graphStateView(liveState()).kind, "graph");
  assert.notEqual(graphStateView(liveState()).kind, graphStateView(null).kind);
});

/* HOUSE LAW 3 (per-node honesty) — daemon nodes are the authority. */
test("[pin] per-node state is the published string verbatim — absent stays null, unknown stays raw, never inferred from id", () => {
  const view = graphStateView(liveState());
  assert.deepEqual(
    view.nodes.map((node) => [node.nodeId, node.state]),
    [["draft", "completed"], ["review", "activated"]],
  );

  /* A node record that published NO state stays null — never a fabricated
     "waiting", no matter what the node id looks like. */
  const bare = graphNodeView({ node: "final_review_done" });
  assert.equal(bare.nodeId, "final_review_done");
  assert.equal(bare.state, null);

  /* An unrecognized published state rides VERBATIM — never coerced onto a
     known phase, never dropped. */
  const novel = graphNodeView({ node: "draft", phase: "quarantined" });
  assert.equal(novel.state, "quarantined");
});

/* HOUSE LAW 3 (unknown events) — unknown journal facts are preserved. */
test("[pin] an unknown watch event type is preserved verbatim as kind 'unknown' — never dropped or coerced", () => {
  const unknown = watchEventView({
    cursor: "7",
    event: { type: "workflow_graph_paused", detail: "operator hold" },
  });
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.typeRaw, "workflow_graph_paused");
  assert.equal(unknown.cursor, "7");
  assert.deepEqual(unknown.raw, { type: "workflow_graph_paused", detail: "operator hold" });

  /* An event with no type at all is still an unknown activity, kept. */
  const untyped = watchEventView({ cursor: "8", event: { note: "??" } });
  assert.equal(untyped.kind, "unknown");
  assert.equal(untyped.typeRaw, null);
  assert.deepEqual(untyped.raw, { note: "??" });

  /* Known v1 types keep their own kind, raw carried. */
  const known = watchEventView({ cursor: "9", event: { type: "workflow_node_activated", node: "review" } });
  assert.equal(known.kind, "workflow_node_activated");
  assert.equal(known.raw.node, "review");

  /* The page view keeps EVERY event — the unknown one survives, in order. */
  const page = watchPageView({
    requested_after_cursor: "6",
    replay_through_cursor: "9",
    next_cursor: "9",
    events: [
      { cursor: "7", event: { type: "workflow_graph_paused" } },
      { cursor: "8", event: { type: "workflow_node_completed", node: "draft" } },
      { cursor: "9", event: { type: "workflow_node_activated", node: "review" } },
    ],
  });
  assert.equal(page.events.length, 3);
  assert.deepEqual(
    page.events.map((event) => event.kind),
    ["unknown", "workflow_node_completed", "workflow_node_activated"],
  );
});

/* HOUSE LAW 4 — cursors are decimal STRINGS, verbatim; absence is null. */
test("[pin] watchPageView carries the three cursors as decimal strings verbatim — \"0\" is real, absence is null, numbers are refused", () => {
  const page = watchPageView({
    requested_after_cursor: "41",
    replay_through_cursor: "55",
    next_cursor: "55",
    events: [],
  });
  assert.equal(page.requestedAfterCursor, "41");
  assert.equal(page.replayThroughCursor, "55");
  assert.equal(page.nextCursor, "55");
  assert.equal(typeof page.nextCursor, "string");

  /* Cursor "0" is a REAL published position. */
  assert.equal(watchPageView({ next_cursor: "0", events: [] }).nextCursor, "0");

  /* An absent cursor is null — collapsing it to "0" would fabricate a
     journal position nobody published. */
  const bare = watchPageView({ events: [] });
  assert.equal(bare.nextCursor, null);
  assert.notEqual(bare.nextCursor, "0");
  assert.equal(bare.requestedAfterCursor, null);
  assert.equal(bare.replayThroughCursor, null);

  /* A NUMBER cursor is refused (null): it may already have lost precision
     crossing the boundary, so treating it as a position would replay from
     a value nobody published. Non-decimal strings are refused too. */
  assert.equal(watchPageView({ next_cursor: 55, events: [] }).nextCursor, null);
  assert.equal(watchPageView({ next_cursor: "55x", events: [] }).nextCursor, null);

  /* through_cursor on the state view follows the same law. */
  assert.equal(graphStateView(liveState({ through_cursor: "0" })).throughCursor, "0");
  assert.equal(graphStateView(liveState({ through_cursor: undefined })).throughCursor, null);
  assert.equal(graphStateView(liveState({ through_cursor: 41 })).throughCursor, null);
});

/* HOUSE LAW 3+4 — the watch is a CHANGE SIGNAL; a gap means re-fetch. */
test("[pin] watchSignal: events or an advanced cursor demand a state re-fetch; a cursor gap re-fetches rather than guessing", () => {
  /* Quiet page: nothing arrived, nothing advanced — no re-fetch. */
  const quiet = watchSignal(watchPageView({
    requested_after_cursor: "41",
    replay_through_cursor: "41",
    next_cursor: "41",
    events: [],
  }));
  assert.deepEqual(quiet, { changed: false, gap: false, nextAfterCursor: "41" });

  /* Events arrived: change signal — and after_cursor advances to
     next_cursor VERBATIM. */
  const active = watchSignal(watchPageView({
    requested_after_cursor: "41",
    replay_through_cursor: "44",
    next_cursor: "44",
    events: [{ cursor: "44", event: { type: "workflow_node_completed" } }],
  }));
  assert.equal(active.changed, true);
  assert.equal(active.nextAfterCursor, "44");

  /* The cursor advanced with no events: still a change signal (unrelated
     session facts may hide graph facts behind a bounded page). */
  const advanced = watchSignal(watchPageView({
    requested_after_cursor: "41",
    replay_through_cursor: "47",
    next_cursor: "47",
    events: [],
  }));
  assert.equal(advanced.changed, true);

  /* GAP: the replay scan moved past everything the events explain — the
     elided span is re-read from workflow.graph.state, never guessed. */
  const gapped = watchSignal(watchPageView({
    requested_after_cursor: "40",
    replay_through_cursor: "50",
    next_cursor: "44",
    events: [{ cursor: "44", event: { type: "workflow_node_activated" } }],
  }));
  assert.equal(gapped.gap, true);
  assert.equal(gapped.changed, true);
  assert.equal(gapped.nextAfterCursor, "44");

  /* A page with no next_cursor yields NULL — the caller re-baselines from
     a fresh state read instead of inventing a resume position. */
  assert.equal(watchSignal(watchPageView(null)).nextAfterCursor, null);
});

/* HOUSE LAW 4 (u64 scale) — no precision loss across the Tauri boundary. */
test("[pin] a u64-scale next_cursor advances after_cursor character-for-character and the gap compare is BigInt-exact", () => {
  /* 9007199254740993 = 2^53 + 1: one past Number.MAX_SAFE_INTEGER. A
     Number() round-trip silently collapses it to 9007199254740992 — the
     WRONG replay position. */
  const page = watchPageView({
    requested_after_cursor: "9007199254740992",
    replay_through_cursor: "9007199254740993",
    next_cursor: "9007199254740993",
    events: [],
  });
  assert.equal(page.nextCursor, "9007199254740993");
  assert.equal(typeof page.nextCursor, "string");

  const signal = watchSignal(page);
  /* after_cursor = next_cursor, character-for-character. */
  assert.equal(signal.nextAfterCursor, "9007199254740993");
  assert.equal(signal.nextAfterCursor.length, "9007199254740993".length);
  assert.equal(signal.nextAfterCursor.at(-1), "3");

  /* replay (…993) > requested (…992) is INVISIBLE to JS number math —
     Number() collapses both to …992 — so only a BigInt compare sees the
     gap and the advance. */
  assert.equal(signal.gap, true);
  assert.equal(signal.changed, true);
  assert.equal(BigInt(signal.nextAfterCursor), 9007199254740993n);
  assert.ok(BigInt(signal.nextAfterCursor) > 9007199254740992n,
    "the advanced position must still exceed 2^53 after the round trip");

  /* through_cursor at the same scale survives the state view verbatim. */
  const view = graphStateView(liveState({ through_cursor: "18446744073709551615" }));
  assert.equal(view.throughCursor, "18446744073709551615");
});

test("[pin] edges are LIFTED from the ast, never invented — absence of an edge list is 'not published', not an empty set", () => {
  const view = graphStateView(liveState());
  assert.equal(view.edgesPublished, true);
  assert.deepEqual(
    view.edges.map((edge) => [edge.kind, edge.from, edge.to]),
    [
      ["graph_input", null, "draft"],
      ["forward", "draft", "review"],
      ["back", "review", "draft"],
    ],
  );

  /* An unrecognized edge kind is preserved verbatim as kind "unknown". */
  const novel = graphEdgeView({ kind: "teleport", from: "a", to: "b" });
  assert.equal(novel.kind, "unknown");
  assert.equal(novel.kindRaw, "teleport");

  /* An ast that publishes NO edge list yields edgesPublished:false — the
     view must say "not published", never render a zero-edge topology as
     fact. */
  const unpublished = graphStateView(liveState({ ast: { workflow_id: "review_loop" } }));
  assert.equal(unpublished.edgesPublished, false);
  assert.deepEqual(unpublished.edges, []);
});

test("[pin] workflowGraphUnavailableFromError recognizes the daemon's feature gate", () => {
  assert.equal(
    workflowGraphUnavailableFromError(new Error("missing_feature: daemon does not advertise workflow_graph_v1")),
    true,
  );
  assert.equal(workflowGraphUnavailableFromError(new Error("does not advertise workflow.graph.watch")), true);
  assert.equal(workflowGraphUnavailableFromError(new Error("connection reset")), false);
});

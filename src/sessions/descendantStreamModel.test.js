import assert from "node:assert/strict";
import test from "node:test";

import {
  applyStreamEvent,
  baselineView,
  cursorsFor,
  descendantUnavailableFromError,
  repairPlan,
} from "./descendantStreamModel.js";

function node(overrides = {}) {
  return {
    session_id: "child-session",
    agent_id: "shared-agent",
    child_run_id: "run-1",
    parent_session_id: "root-session",
    parent_run_id: "root-run",
    depth: 1,
    callsign: "scout",
    task: "inspect",
    state: "live",
    requested_after_seq: "9007199254740993",
    children: [],
    ...overrides,
  };
}

function baseline(overrides = {}) {
  return {
    session_id: "root-session",
    generated_at_ms: 1000,
    fanout: {
      requested_children: 9,
      accepted_children: 4,
      hard_limit: 6,
    },
    truncation: {
      truncated: true,
      streamed_children: 4,
      omitted_children: 5,
      count_complete: false,
    },
    roots: [
      node(),
      node({
        session_id: "other-session",
        requested_after_seq: "7",
        callsign: "other",
      }),
    ],
    ...overrides,
  };
}

test("[pin] fan-out keeps requested, accepted, and hard limit distinct", () => {
  const view = baselineView(baseline());
  assert.deepEqual(view.fanout, {
    requestedChildren: 9,
    acceptedChildren: 4,
    hardLimit: 6,
    limited: true,
  });
  assert.notEqual(view.fanout.acceptedChildren, view.fanout.requestedChildren,
    "accepted children must never masquerade as the requested/full set");
});

test("[pin] incomplete truncation carries the omitted fact but marks it untrustworthy", () => {
  const incomplete = baselineView(baseline()).truncation;
  assert.equal(incomplete.truncated, true);
  assert.equal(incomplete.streamedChildren, 4);
  assert.equal(incomplete.omittedChildren, 5,
    "the raw daemon count remains available for audit");
  assert.equal(incomplete.countComplete, false);
  assert.equal(incomplete.omittedCountTrusted, false,
    "count_complete:false must block presenting omitted_children as a total");

  const completeWire = baseline();
  completeWire.truncation = { ...completeWire.truncation, count_complete: true };
  assert.equal(baselineView(completeWire).truncation.omittedCountTrusted, true);
});

test("[pin] cursors are per-(session,agent), decimal strings, BigInt-compared and verbatim", () => {
  let tree = baselineView(baseline()).tree;
  tree = applyStreamEvent(tree, {
    session_id: "child-session",
    agent_id: "shared-agent",
    seq: "9007199254740995",
    change: { kind: "state_changed", state: "done" },
  });

  const positions = cursorsFor(tree);
  assert.deepEqual(positions, [
    {
      session_id: "child-session",
      agent_id: "shared-agent",
      after_seq: "9007199254740995",
    },
    {
      session_id: "other-session",
      agent_id: "shared-agent",
      after_seq: "7",
    },
  ]);
  assert.equal(typeof positions[0].after_seq, "string");

  /* Same agent id, different session: the second child's cursor and state
     are untouched. This fails if identity is keyed by agent alone. */
  assert.equal(tree.roots[1].afterSeq, "7");
  assert.equal(tree.roots[1].state.raw, "live");

  /* A stale event cannot regress state or the u64-scale cursor. */
  const stale = applyStreamEvent(tree, {
    session_id: "child-session",
    agent_id: "shared-agent",
    seq: "9007199254740994",
    change: { kind: "state_changed", state: "failed" },
  });
  assert.equal(stale, tree);
  assert.equal(stale.roots[0].state.raw, "done");
});

test("[pin] known changes mutate only facts they carry; unknown kinds and states survive", () => {
  const initial = baselineView(baseline()).tree;
  const noStateFact = applyStreamEvent(initial, {
    session_id: "child-session",
    agent_id: "shared-agent",
    seq: "9007199254740994",
    change: { kind: "state_changed", detail: "no state was published" },
  });
  assert.equal(noStateFact.roots[0].state.raw, "live",
    "a state_changed fact without state must not invent or clear state");

  const futureState = applyStreamEvent(noStateFact, {
    session_id: "child-session",
    agent_id: "shared-agent",
    seq: "9007199254740995",
    change: { kind: "state_changed", state: "hibernating" },
  });
  assert.equal(futureState.roots[0].state.kind, "unknown");
  assert.equal(futureState.roots[0].state.raw, "hibernating",
    "an unknown node state must remain verbatim");

  const event = {
    session_id: "child-session",
    agent_id: "shared-agent",
    seq: "9007199254740996",
    change: { kind: "quantum_shift", payload: { phase: 3 } },
  };
  const futureKind = applyStreamEvent(futureState, event);
  assert.equal(futureKind.unrecognizedEvents.length, 1);
  assert.equal(futureKind.unrecognizedEvents[0].kindRaw, "quantum_shift");
  assert.equal(futureKind.unrecognizedEvents[0].raw, event,
    "an unknown change fact must be preserved, not dropped or coerced");
  assert.equal(cursorsFor(futureKind)[0].after_seq, "9007199254740996",
    "preserving an unknown applied fact still advances that exact child's cursor");

  const staleUnknown = applyStreamEvent(futureKind, {
    ...event,
    seq: "9007199254740995",
    change: { kind: "future_stale_fact" },
  });
  assert.equal(staleUnknown.unrecognizedEvents.length, 2,
    "an unknown stale/duplicate kind is still preserved for inspection, never dropped");
  assert.equal(staleUnknown.unrecognizedEvents[1].stale, true);
  assert.equal(cursorsFor(staleUnknown)[0].after_seq, "9007199254740996",
    "preserving a stale unknown fact must not regress its child's cursor");
});

test("[pin] repair uses only held cursors for both named identities and makes no sequence", () => {
  const held = [
    { session_id: "child-session", agent_id: "shared-agent", after_seq: "42" },
    { session_id: "other-session", agent_id: "shared-agent", after_seq: "84" },
  ];
  const plan = repairPlan([
    { session_id: "other-session", agent_id: "shared-agent", seq: "999999" },
    { session_id: "missing-session", agent_id: "shared-agent", after_seq: "11" },
  ], held);
  assert.deepEqual(plan, [
    { session_id: "other-session", agent_id: "shared-agent", after_seq: "84" },
  ], "repair-frame sequences and unheld children must never enter the plan");
});

test("descendant unavailable detection reuses Fleet's feature-gate detector", () => {
  assert.equal(descendantUnavailableFromError({ code: "missing_feature" }), true);
  assert.equal(descendantUnavailableFromError(new Error("daemon does not advertise descendant stream")), true);
  assert.equal(descendantUnavailableFromError(new Error("transport closed")), false);
});

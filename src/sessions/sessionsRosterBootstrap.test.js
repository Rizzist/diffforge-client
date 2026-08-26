import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyRosterBootstrapEvent,
  createSessionsRosterGate,
  normalizeRosterBootstrapState,
  reduceSessionsRosterGate,
} from "./sessionsRosterBootstrap.js";

const reachableBarrier = (daemonGeneration = 7) => ({
  state: "reachable",
  profile_id: "profile-test",
  daemon_generation: daemonGeneration,
  applied_at_ms: 1_756_200_000_123,
});

const publishBarrier = (state, value) => reduceSessionsRosterGate(state, {
  type: "barrier",
  value,
});

const publishRead = (
  state,
  read,
  barrierRevision = state.barrierRevision,
  confirmationRevision = state.confirmationRevision,
) => (
  reduceSessionsRosterGate(state, {
    type: "sessions-read",
    barrierRevision,
    confirmationRevision,
    read,
  })
);

test("[pin] local sqlite success alone stays pending and cannot publish live refs", () => {
  const initial = createSessionsRosterGate();
  const read = publishRead(initial, { ok: true, rows: [{ id: "cached-session" }] });

  assert.equal(
    initial.barrier.reason,
    "A fresh daemon session roster has not been applied yet.",
  );
  assert.equal(read.barrier.state, "pending");
  assert.equal(read.roster.state, "unreachable");
  assert.equal(
    read.roster.reason,
    "A fresh daemon session roster has not been applied yet.",
  );
  assert.equal("sessionRefs" in read.roster, false);
});

test("[pin] refs become reachable only after complete bootstrap and projected rows both land", () => {
  let state = createSessionsRosterGate();
  state = publishBarrier(state, reachableBarrier());

  assert.equal(state.roster.state, "unreachable");
  assert.equal(
    state.roster.reason,
    "The fresh daemon session roster is applied, but its projected rows have not been read yet.",
  );

  state = publishRead(state, {
    ok: true,
    rows: [{ id: "session-a" }, { id: "" }, { id: "session-b" }],
  });
  assert.deepEqual(state.roster, {
    state: "reachable",
    sessionRefs: ["session-a", "session-b"],
  });

  const empty = publishRead(state, { ok: true, rows: [] });
  assert.deepEqual(empty.roster, { state: "reachable", sessionRefs: [] },
    "an applied, successfully read empty complete roster remains authoritative");
});

test("[pin] pending and unreachable barrier reasons remain honest unknown reasons", () => {
  let state = publishBarrier(createSessionsRosterGate(), {
    state: "pending",
    reason: "Connected; awaiting the first complete session.list.",
  });
  state = publishRead(state, { ok: true, rows: [{ id: "cached-session" }] });
  assert.deepEqual(state.roster, {
    state: "unreachable",
    reason: "Connected; awaiting the first complete session.list.",
  });

  state = publishBarrier(state, {
    state: "unreachable",
    reason: "The Haider daemon socket is unavailable.",
  });
  assert.deepEqual(state.roster, {
    state: "unreachable",
    reason: "The Haider daemon socket is unavailable.",
  });
});

test("[pin] reconnect and a new daemon generation reset reachable to pending until a new read", () => {
  let state = publishBarrier(createSessionsRosterGate(), reachableBarrier(7));
  state = publishRead(state, { ok: true, rows: [{ id: "generation-seven" }] });
  assert.equal(state.roster.state, "reachable");
  const oldRevision = state.barrierRevision;

  state = publishBarrier(state, {
    state: "pending",
    reason: "Daemon reconnected; awaiting its complete roster.",
  });
  assert.equal(state.roster.state, "unreachable");
  assert.equal(state.roster.reason, "Daemon reconnected; awaiting its complete roster.");

  state = publishBarrier(state, reachableBarrier(8));
  assert.equal(state.barrier.profile_id, "profile-test");
  assert.equal(state.barrier.daemon_generation, 8);
  assert.equal(state.barrier.applied_at_ms, 1_756_200_000_123);
  assert.equal(state.roster.state, "unreachable");
  assert.equal(
    state.roster.reason,
    "The fresh daemon session roster is applied, but its projected rows have not been read yet.",
  );

  const staleRead = publishRead(
    state,
    { ok: true, rows: [{ id: "generation-seven" }] },
    oldRevision,
  );
  assert.strictEqual(staleRead, state, "a read begun before reconnect must be ignored");

  state = publishRead(state, { ok: true, rows: [{ id: "generation-eight" }] });
  assert.deepEqual(state.roster, {
    state: "reachable",
    sessionRefs: ["generation-eight"],
  });
});

test("[pin] malformed reachable metadata fails closed and never authorizes cached rows", () => {
  const malformed = normalizeRosterBootstrapState({
    state: "reachable",
    profile_id: "profile-test",
    daemon_generation: undefined,
    applied_at_ms: 1,
  });
  assert.deepEqual(malformed, {
    state: "unreachable",
    reason: "The daemon session roster bootstrap state is invalid.",
  });

  let state = publishBarrier(createSessionsRosterGate(), malformed);
  state = publishRead(state, { ok: true, rows: [{ id: "cached-session" }] });
  assert.equal(state.roster.state, "unreachable");
  assert.equal("sessionRefs" in state.roster, false);
});

test("[pin] S1 daemon-confirmed materialization survives only non-authoritative reads", () => {
  let state = reduceSessionsRosterGate(createSessionsRosterGate(), {
    type: "confirmed-session",
    sessionRef: "session-new",
  });
  assert.deepEqual(state.roster.confirmedSessionRefs, ["session-new"]);

  state = publishRead(state, { ok: true, rows: [{ id: "cached-session" }] });
  assert.deepEqual(state.roster.confirmedSessionRefs, ["session-new"],
    "a pending local mirror read cannot erase direct daemon confirmation");

  state = publishBarrier(state, reachableBarrier());
  assert.equal("confirmedSessionRefs" in state.roster, false,
    "a new connection/generation barrier invalidates the prior narrow fact");
  state = publishRead(state, { ok: true, rows: [{ id: "session-fresh" }] });
  assert.deepEqual(state.roster, {
    state: "reachable",
    sessionRefs: ["session-fresh"],
  }, "a successful post-barrier projection read is the complete authority");
});

test("[pin] a confirmation fences an older same-barrier read until a fresh complete roster lands", () => {
  let state = publishBarrier(createSessionsRosterGate(), reachableBarrier());
  const olderBarrierRevision = state.barrierRevision;
  const olderConfirmationRevision = state.confirmationRevision;

  state = reduceSessionsRosterGate(state, {
    type: "confirmed-session",
    sessionRef: "session-new",
  });
  assert.equal(state.confirmationRevision, olderConfirmationRevision + 1);

  state = publishRead(
    state,
    { ok: true, rows: [{ id: "session-old" }] },
    olderBarrierRevision,
    olderConfirmationRevision,
  );
  assert.deepEqual(state.roster, {
    state: "reachable",
    sessionRefs: ["session-old", "session-new"],
  }, "a read started before confirmation must not erase the newer daemon-confirmed ref");
  assert.deepEqual(state.confirmedSessionRefs, ["session-new"]);

  state = publishRead(state, { ok: true, rows: [{ id: "session-old" }] });
  assert.deepEqual(state.roster, {
    state: "reachable",
    sessionRefs: ["session-old"],
  }, "a fresh complete roster may authoritatively tombstone the confirmed ref");
  assert.deepEqual(state.confirmedSessionRefs, []);
});

test("[pin] AppShell local reads route through both roster fences at the production seam", () => {
  const source = readFileSync(new URL("../app/AppShell.jsx", import.meta.url), "utf8");
  const refreshStart = source.indexOf("const refreshSessions = useCallback(async () => {");
  const refreshEnd = source.indexOf("/* Media sessions", refreshStart);
  assert.notEqual(refreshStart, -1, "the production refreshSessions seam must exist");
  assert.notEqual(refreshEnd, -1, "the production refreshSessions seam must have a stable boundary");
  const refresh = source.slice(refreshStart, refreshEnd);

  assert.match(
    refresh,
    /const\s*\{\s*barrierRevision,\s*confirmationRevision,?\s*\}\s*=\s*sessionsRosterGateRef\.current;/s,
    "production reads must capture the complete roster fence before listSessions",
  );
  assert.equal(
    (refresh.match(/publishSessionsRosterGate\(\{[\s\S]*?type: "sessions-read",[\s\S]*?barrierRevision,[\s\S]*?confirmationRevision,/g) || []).length,
    2,
    "both successful and failed production reads must pass through the roster gate",
  );
  assert.doesNotMatch(
    refresh,
    /setSessionsRoster\s*\(|rosterFromSessionsRead\s*\(/,
    "production local reads must never bypass the barrier gate into a reachable roster",
  );
});

test("[pin] complete-apply reachable event drives the production handoff through projected rows", async () => {
  let state = createSessionsRosterGate();
  const actions = [];
  const publishGate = (action) => {
    actions.push(action.type);
    state = reduceSessionsRosterGate(state, action);
    return state;
  };
  const refreshProjectedRows = async () => {
    const { barrierRevision, confirmationRevision } = state;
    await Promise.resolve();
    publishGate({
      type: "sessions-read",
      barrierRevision,
      confirmationRevision,
      read: {
        ok: true,
        rows: [{ id: "page-one" }, { id: "page-two" }],
      },
    });
  };

  await applyRosterBootstrapEvent(
    reachableBarrier(),
    publishGate,
    refreshProjectedRows,
  );

  assert.deepEqual(actions, ["barrier", "sessions-read"],
    "reachable must publish only after the complete-apply event triggers its projection read");
  assert.deepEqual(state.roster, {
    state: "reachable",
    sessionRefs: ["page-one", "page-two"],
  }, "the event-to-read handoff must expose the atomically projected complete roster");

  const source = readFileSync(new URL("../app/AppShell.jsx", import.meta.url), "utf8");
  const listenerStart = source.indexOf(
    `listenShared(HAIDER_ROSTER_BOOTSTRAP_CHANGED_EVENT, (event) => {`,
  );
  const listenerEnd = source.indexOf("});", listenerStart);
  assert.notEqual(listenerStart, -1, "the production complete-apply listener must exist");
  assert.match(
    source.slice(listenerStart, listenerEnd),
    /applyRosterBootstrapEvent\(\s*event\?\.payload,\s*publishSessionsRosterGate,\s*refreshSessions,\s*\)/s,
    "the native complete-apply event must drive the tested production handoff",
  );
});

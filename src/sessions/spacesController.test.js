import assert from "node:assert/strict";
import test from "node:test";

import {
  createSpaceLeaf,
  createSpaceStack,
  createSpaceState,
  focusSpaceLeaf,
  serializeSpaceLayout,
  spaceLeafCount,
  spaceLeafIds,
} from "./spacesModel.js";
import {
  createSpaceLayoutSaver,
  rosterFromSessionsRead,
  dragOutLeafInSpace,
  enterSpaceState,
  reachableSpacesRoster,
  reconcileSpaceLeaves,
  reconcileSpaceState,
  revealSessionInSpace,
  rosterWithConfirmedSession,
  sessionsByIdMap,
  spaceLeafPresentation,
  spaceNodeId,
  spaceRailRowAuthority,
  spaceRailScope,
  SPACE_LAYOUT_CANONICAL_DIVERGENCE,
  SPACE_LAYOUT_INVALID,
  SPACE_LEAF_MISSING_ROW_REASON,
  SPACE_LEAF_UNRECONCILED_REASON,
  unreachableSpacesRoster,
} from "./spacesController.js";

function twoLeafState() {
  return createSpaceState({
    members: ["session-a", "session-b"],
    root: createSpaceStack("stack-main", [
      createSpaceLeaf({ id: "leaf-a", sessionRef: "session-a" }),
      createSpaceLeaf({ id: "leaf-b", sessionRef: "session-b" }),
    ], "leaf-a"),
    focusedLeaf: "leaf-a",
  });
}

function recordFor(state, patch = {}) {
  return {
    id: "space-test",
    name: "Test",
    layout_json: serializeSpaceLayout(state),
    focused_leaf: state.focusedLeaf,
    ...patch,
  };
}

/* A manual timer fake: schedule() queues, runTimers() fires everything. */
function fakeTimers() {
  const queue = new Map();
  let nextId = 1;
  return {
    setTimeoutFn: (fn) => {
      const id = nextId;
      nextId += 1;
      queue.set(id, fn);
      return id;
    },
    clearTimeoutFn: (id) => queue.delete(id),
    runTimers: () => {
      const fns = [...queue.values()];
      queue.clear();
      for (const fn of fns) fn();
    },
    size: () => queue.size,
  };
}

test("[pin] a vanished member reconciles to tombstone with every leaf given a verdict", () => {
  const state = twoLeafState();
  const items = reconcileSpaceLeaves(state, reachableSpacesRoster(["session-a"]));
  assert.equal(items.length, spaceLeafCount(state));
  assert.deepEqual(items, [
    { leaf_id: "leaf-a", session_ref: "session-a", state: "live" },
    { leaf_id: "leaf-b", session_ref: "session-b", state: "tombstone" },
  ]);
  const reconciled = reconcileSpaceState(state, reachableSpacesRoster(["session-a"]));
  assert.deepEqual(spaceLeafIds(reconciled), ["leaf-a", "leaf-b"]);
  assert.deepEqual(reconciled.root.tabs[1].renderState, { state: "tombstone" });
});

test("[pin] an unreachable roster reconciles to unknown-with-reason, never tombstone or live", () => {
  const state = twoLeafState();
  const items = reconcileSpaceLeaves(
    state,
    unreachableSpacesRoster("The daemon did not answer."),
  );
  assert.equal(items.length, 2);
  for (const item of items) {
    assert.equal(item.state, "unknown");
    assert.equal(item.reason, "The daemon did not answer.");
  }
  const reconciled = reconcileSpaceState(
    state,
    unreachableSpacesRoster("The daemon did not answer."),
  );
  assert.deepEqual(reconciled.root.tabs[0].renderState, {
    state: "unknown",
    reason: "The daemon did not answer.",
  });
});

test("[pin] a failed sessions read maps to unreachable, never to an empty reachable roster", () => {
  const ok = rosterFromSessionsRead({ ok: true, rows: [{ id: "session-a" }, { id: "" }] });
  assert.deepEqual(ok, { state: "reachable", sessionRefs: ["session-a"] });
  const okEmpty = rosterFromSessionsRead({ ok: true, rows: [] });
  assert.deepEqual(okEmpty, { state: "reachable", sessionRefs: [] });

  const failed = rosterFromSessionsRead({ ok: false, error: new Error("store locked") });
  assert.equal(failed.state, "unreachable");
  assert.equal(failed.reason, "store locked");
  const failedBare = rosterFromSessionsRead({ ok: false, error: "   " });
  assert.equal(failedBare.state, "unreachable");
  assert.equal(failedBare.reason, "The daemon session roster is unavailable.");
});

test("[pin] a daemon-confirmed materialization is live without fabricating the rest of the roster", () => {
  const reachable = rosterWithConfirmedSession(
    reachableSpacesRoster(["session-a"]),
    "session-b",
  );
  assert.deepEqual(reachable, {
    state: "reachable",
    sessionRefs: ["session-a", "session-b"],
  });

  const unavailable = rosterWithConfirmedSession(
    unreachableSpacesRoster("The full roster read failed."),
    "session-b",
  );
  assert.equal(unavailable.state, "unreachable", "one confirmation is not a full roster read");
  assert.deepEqual(unavailable.confirmedSessionRefs, ["session-b"]);
  assert.deepEqual(reconcileSpaceLeaves(twoLeafState(), unavailable), [
    {
      leaf_id: "leaf-a",
      session_ref: "session-a",
      state: "unknown",
      reason: "The full roster read failed.",
    },
    { leaf_id: "leaf-b", session_ref: "session-b", state: "live" },
  ]);
});

test("roster snapshots refuse fabricated shapes", () => {
  assert.throws(() => unreachableSpacesRoster(""), /Unreachable roster reason/);
  assert.throws(() => unreachableSpacesRoster("  padded  "), /Unreachable roster reason/);
  assert.throws(() => reachableSpacesRoster("session-a"), /must list its session references/);
  assert.throws(
    () => reconcileSpaceLeaves(twoLeafState(), { state: "reachable" }),
    /reachable-with-refs or unreachable-with-reason/,
  );
});

test("[pin] a canonically divergent stored layout enters a typed error, never a silent reset", () => {
  const state = twoLeafState();
  const roster = reachableSpacesRoster(["session-a", "session-b"]);
  const good = enterSpaceState(recordFor(state), roster);
  assert.equal(good.ok, true);
  assert.deepEqual(spaceLeafIds(good.state), ["leaf-a", "leaf-b"]);

  /* Same JSON value, different bytes: pretty-printing is a divergence. */
  const diverged = enterSpaceState(
    recordFor(state, {
      layout_json: JSON.stringify(JSON.parse(serializeSpaceLayout(state)), null, 2),
    }),
    roster,
  );
  assert.equal(diverged.ok, false);
  assert.equal(diverged.error.code, SPACE_LAYOUT_CANONICAL_DIVERGENCE);
  assert.match(diverged.error.message, /canonical-byte divergence/);
  assert.equal("state" in diverged, false);

  const invalid = enterSpaceState(recordFor(state, { layout_json: "not json" }), roster);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, SPACE_LAYOUT_INVALID);
});

test("[pin] leaf presentation never renders a non-live leaf as live", () => {
  const sessions = sessionsByIdMap([{ id: "session-a", title: "A" }]);
  const leafFor = (renderState) => ({
    kind: "leaf",
    id: "leaf-x",
    sessionRef: "session-a",
    viewKind: "chat",
    viewState: { activeSubTab: null },
    ...(renderState === undefined ? {} : { renderState }),
  });

  assert.deepEqual(
    spaceLeafPresentation(leafFor(undefined), sessions),
    { mode: "unknown", reason: SPACE_LEAF_UNRECONCILED_REASON },
  );
  assert.deepEqual(
    spaceLeafPresentation(leafFor({ state: "tombstone" }), sessions),
    { mode: "tombstone" },
  );
  assert.deepEqual(
    spaceLeafPresentation(leafFor({ state: "unknown", reason: "Daemon offline." }), sessions),
    { mode: "unknown", reason: "Daemon offline." },
  );
  /* A "live" verdict without a roster row must not mount a live view. */
  assert.deepEqual(
    spaceLeafPresentation(leafFor({ state: "live" }), sessionsByIdMap([])),
    { mode: "unknown", reason: SPACE_LEAF_MISSING_ROW_REASON },
  );
  const live = spaceLeafPresentation(leafFor({ state: "live" }), sessions);
  assert.equal(live.mode, "live");
  assert.equal(live.session.title, "A");
});

test("[pin] rail scope highlight derives only from the model's focused leaf", () => {
  const sessions = [
    { id: "session-b", title: "B" },
    { id: "session-a", title: "A" },
    { id: "session-z", title: "Not a member" },
  ];
  const state = twoLeafState();
  const scoped = spaceRailScope(state, sessions);
  assert.deepEqual(scoped.memberSessions.map((row) => row.id), ["session-b", "session-a"]);
  assert.deepEqual(scoped.missingMemberRefs, []);
  assert.equal(scoped.highlightedSessionRef, "session-a");

  /* Focus is the ONLY input that can move the highlight. */
  const refocused = spaceRailScope(focusSpaceLeaf(state, "leaf-b"), sessions);
  assert.equal(refocused.highlightedSessionRef, "session-b");

  const missing = spaceRailScope(state, [{ id: "session-a", title: "A" }]);
  assert.deepEqual(missing.missingMemberRefs, ["session-b"]);
});

test("reveal and drag-out wrappers mint node ids through the injected generator", () => {
  let counter = 0;
  const idGen = (prefix) => {
    counter += 1;
    return `${prefix}-${counter}`;
  };
  const opened = revealSessionInSpace(createSpaceState(), "session-a", {}, idGen);
  assert.equal(opened.root.kind, "stack");
  assert.equal(opened.root.tabs[0].sessionRef, "session-a");
  assert.equal(opened.focusedLeaf, opened.root.tabs[0].id);

  const both = revealSessionInSpace(opened, "session-b", {}, idGen);
  /* Reveal of an existing member focuses instead of duplicating. */
  const revealed = revealSessionInSpace(both, "session-a", {}, idGen);
  assert.equal(spaceLeafCount(revealed), 2);
  assert.equal(revealed.focusedLeaf, opened.root.tabs[0].id);

  const split = dragOutLeafInSpace(
    both,
    both.root.tabs[1].id,
    both.root.tabs[0].id,
    { direction: "vertical", position: "after" },
    idGen,
  );
  assert.equal(split.root.kind, "split");
  assert.equal(split.root.direction, "vertical");
  assert.equal(spaceLeafCount(split), 2);

  const generated = spaceNodeId("leaf");
  assert.match(generated, /^leaf-/);
  assert.notEqual(generated, spaceNodeId("leaf"));
});

test("[pin] the last scheduled layout state always lands", async () => {
  const timers = fakeTimers();
  const saves = [];
  let gate = null;
  const saver = createSpaceLayoutSaver({
    save: async (payload) => {
      if (gate) await gate;
      saves.push(payload);
    },
    ...timers,
  });

  /* Debounce collapse: only the newest of a burst is saved. */
  saver.schedule({ spaceId: "space-1", layoutJson: "A", focusedLeaf: null });
  saver.schedule({ spaceId: "space-1", layoutJson: "B", focusedLeaf: null });
  timers.runTimers();
  await saver.flush();
  assert.deepEqual(saves.map((row) => row.layoutJson), ["B"]);

  /* A state scheduled while a save is in flight lands after it. */
  let release;
  gate = new Promise((resolve) => {
    release = resolve;
  });
  saver.schedule({ spaceId: "space-1", layoutJson: "C", focusedLeaf: null });
  timers.runTimers();
  saver.schedule({ spaceId: "space-1", layoutJson: "D", focusedLeaf: null });
  gate = null;
  release();
  await saver.flush();
  assert.deepEqual(saves.map((row) => row.layoutJson), ["B", "C", "D"]);
  assert.equal(saver.hasPending(), false);
});

test("a failed save is reported, kept pending, and retried by flush", async () => {
  const timers = fakeTimers();
  const saves = [];
  const errors = [];
  let failNext = true;
  const saver = createSpaceLayoutSaver({
    save: async (payload) => {
      if (failNext) {
        failNext = false;
        throw new Error("sqlite is busy");
      }
      saves.push(payload);
    },
    onError: (error, payload) => errors.push({ message: error.message, payload }),
    ...timers,
  });
  saver.schedule({ spaceId: "space-1", layoutJson: "A", focusedLeaf: null });
  timers.runTimers();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(errors.length, 1);
  assert.equal(errors[0].payload.layoutJson, "A");
  assert.equal(saver.hasPending(), true);
  await saver.flush();
  assert.deepEqual(saves.map((row) => row.layoutJson), ["A"]);
  assert.equal(saver.hasPending(), false);
});

test("[pin] a failed save for one space is not overwritten or cleared by another space", async () => {
  /* Finding 2: switching from space A (whose save failed) to space B must not
     let B's write supersede A's pending bytes, and B's success must not clear
     A's error. Per-space slots are the fix. */
  const timers = fakeTimers();
  const saves = [];
  const errors = [];
  const saver = createSpaceLayoutSaver({
    save: async (payload) => {
      if (payload.spaceId === "space-A") throw new Error("A store is busy");
      saves.push(payload);
    },
    onError: (error, payload) => errors.push(payload.spaceId),
    ...timers,
  });

  saver.schedule({ spaceId: "space-A", layoutJson: "A-last", focusedLeaf: null });
  saver.schedule({ spaceId: "space-B", layoutJson: "B-first", focusedLeaf: null });
  timers.runTimers();
  /* Let both in-flight saves settle WITHOUT flush (flush would deliberately
     retry A's kept-pending bytes — the persistence, not the retry count, is
     the invariant here). */
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();

  /* B saved; A failed and is STILL pending with its own error, untouched by B. */
  assert.deepEqual(saves.map((row) => row.layoutJson), ["B-first"]);
  assert.deepEqual(errors, ["space-A"]);
  assert.equal(saver.hasPending("space-A"), true, "A's failed bytes stay pending");
  assert.equal(saver.hasPending("space-B"), false, "B's success clears only B");
});

test("[pin] discard drops only the named space's pending bytes", async () => {
  const timers = fakeTimers();
  const saves = [];
  const saver = createSpaceLayoutSaver({
    save: async (payload) => { saves.push(payload); },
    ...timers,
  });
  saver.schedule({ spaceId: "space-A", layoutJson: "A", focusedLeaf: null });
  saver.schedule({ spaceId: "space-B", layoutJson: "B", focusedLeaf: null });
  saver.discard("space-A");
  assert.equal(saver.hasPending("space-A"), false);
  assert.equal(saver.hasPending("space-B"), true);
  timers.runTimers();
  await saver.flush();
  assert.deepEqual(saves.map((row) => row.spaceId), ["space-B"]);
});

test("[pin] discard survives a late failure from an in-flight save", async () => {
  const timers = fakeTimers();
  const attempts = [];
  const errors = [];
  let rejectSave;
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const saveGate = new Promise((resolve, reject) => {
    rejectSave = reject;
  });
  const saver = createSpaceLayoutSaver({
    save: async (payload) => {
      attempts.push(payload);
      markStarted();
      if (attempts.length === 1) await saveGate;
    },
    onError: (error, payload) => errors.push({ error, payload }),
    ...timers,
  });

  saver.schedule({ spaceId: "space-A", layoutJson: "A", focusedLeaf: null });
  timers.runTimers();
  await started;

  /* Deletion wins over the save that began in the prior generation. */
  saver.discard("space-A");
  assert.equal(saver.hasPending("space-A"), false, "discard hides the obsolete in-flight save");

  rejectSave(new Error("late sqlite failure"));
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();

  assert.equal(saver.hasPending("space-A"), false, "the late failure cannot restore discarded bytes");
  assert.deepEqual(errors, [], "a discarded generation cannot report a stale save error");
  await saver.flush("space-A");
  assert.equal(attempts.length, 1, "flush has no discarded payload to retry");
});

test("[pin] the rail never treats activeSessionId as active in space mode", () => {
  /* Finding 1: while a space is active — even before its scope resolves — the
     ordinary activeSessionId must not be the highlight and clicks must route to
     the space, never onSelectSession. */
  const opening = spaceRailRowAuthority({
    activeSpaceId: "space-1",
    spaceScope: null,
    activeSessionId: "session-stale",
    sessionId: "session-stale",
  });
  assert.equal(opening.spaceMode, true);
  assert.equal(opening.routeToSpace, true);
  assert.equal(opening.isActive, false, "a stale ordinary session is never active in space mode");
  assert.equal(opening.effectiveActiveId, "", "no highlight until the scope resolves");

  const scoped = spaceRailRowAuthority({
    activeSpaceId: "space-1",
    spaceScope: { highlightedSessionRef: "session-focused" },
    activeSessionId: "session-stale",
    sessionId: "session-focused",
  });
  assert.equal(scoped.isActive, true, "the focused leaf's session is the only highlight");
  const scopedStale = spaceRailRowAuthority({
    activeSpaceId: "space-1",
    spaceScope: { highlightedSessionRef: "session-focused" },
    activeSessionId: "session-stale",
    sessionId: "session-stale",
  });
  assert.equal(scopedStale.isActive, false);

  /* Outside space mode the ordinary authority is unchanged. */
  const ordinary = spaceRailRowAuthority({
    activeSpaceId: "",
    spaceScope: null,
    activeSessionId: "session-open",
    sessionId: "session-open",
  });
  assert.equal(ordinary.spaceMode, false);
  assert.equal(ordinary.routeToSpace, false);
  assert.equal(ordinary.isActive, true);
});

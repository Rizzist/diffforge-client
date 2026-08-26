import assert from "node:assert/strict";
import test from "node:test";

import {
  breakoutWindowPersistenceId,
  createBreakoutWindowPersistence,
  createSessionWindowIncarnationGuard,
  reconcileSessionWindowDestroyed,
  SESSION_WINDOW_CONTROL_FOCUS_MAIN,
  SESSION_WINDOW_CONTROL_RETURN,
  sessionWindowControlEndsBreakout,
  startBreakoutOpenBeforeNativeCheck,
} from "./sessionWindowBridge.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function deterministicId(identity) {
  const coordinates = identity.kind === "session"
    ? identity.sessionRef
    : `${identity.spaceId}:${identity.leafId}`;
  return Promise.resolve(`intent:${identity.profileId}:${identity.kind}:${coordinates}`);
}

function persistenceHarness(overrides = {}) {
  const records = new Map();
  const registrations = new Map();
  const removes = [];
  const upserts = [];
  const persistence = createBreakoutWindowPersistence({
    deriveId: deterministicId,
    upsert: async (payload) => {
      upserts.push(payload);
      records.set(payload.id, payload);
    },
    register: async (payload) => {
      registrations.set(payload.window_id, payload);
    },
    remove: async (payload) => {
      removes.push(payload);
      records.delete(payload.id);
    },
    ...overrides,
  });
  return { persistence, records, registrations, removes, upserts };
}

test("[pin] durable breakout ids are stable logical identities, never native labels", async () => {
  const first = await breakoutWindowPersistenceId({
    incarnation: 1,
    kind: "session",
    nativeWindowLabel: "session-window-first",
    profileId: "profile-a",
    sessionRef: "session-a",
  });
  const recreated = await breakoutWindowPersistenceId({
    incarnation: 99,
    kind: "session",
    nativeWindowLabel: "session-window-second",
    profileId: "profile-a",
    sessionRef: "session-a",
  });
  const otherProfile = await breakoutWindowPersistenceId({
    kind: "session",
    profileId: "profile-b",
    sessionRef: "session-a",
  });
  const leaf = await breakoutWindowPersistenceId({
    kind: "space_leaf",
    leafId: "leaf-a",
    profileId: "profile-a",
    spaceId: "space-a",
  });

  assert.equal(
    recreated,
    first,
    "durable id must be stable across native recreations and must not equal a window label",
  );
  assert.match(first, /^breakout-intent-session-[a-f0-9]{24}$/);
  assert.notEqual(first, "session-window-first");
  assert.notEqual(otherProfile, first, "durable ids must be qualified by owning profile");
  assert.match(leaf, /^breakout-intent-space-leaf-[a-f0-9]{24}$/);
});

test("[pin] restore gate drops pre-arm and wrong-profile opens without replay", async () => {
  const { persistence, removes, upserts } = persistenceHarness();
  assert.equal(await persistence.persistSessionOpen({
    profileId: "profile-a",
    sessionRef: "session-before-restore",
    windowId: "session-window-before-restore",
  }), false);
  assert.equal(
    upserts.length,
    0,
    "pre-restore breakout open must not call breakout_upsert",
  );
  assert.equal(await persistence.persistExplicitClose({
    payload: {
      session_id: "session-before-restore",
      window_id: "session-window-before-restore",
    },
    profileId: "profile-a",
  }), false);
  assert.equal(removes.length, 0, "pre-restore breakout close must not call breakout_remove");

  persistence.arm({ profileId: "profile-a" });
  await persistence.flush();
  assert.equal(upserts.length, 0, "arming must not replay a pre-restore open");
  assert.equal(removes.length, 0, "arming must not replay a pre-restore close");
  assert.equal(await persistence.persistSessionOpen({
    profileId: "profile-b",
    sessionRef: "wrong-profile",
    windowId: "session-window-wrong-profile",
  }), false);
  assert.equal(upserts.length, 0, "an armed profile must not write another profile's intent");
});

test("[pin] session open upserts only durable identity and allowlisted presentation", async () => {
  const { persistence, records, upserts } = persistenceHarness();
  persistence.arm({ profileId: "profile-a" });
  const common = {
    geometry: { height: 999, width: 999 },
    incarnation: 27,
    profileId: "profile-a",
    roster: [{ id: "must-not-persist" }],
    runStatus: "running",
    sessionRef: "session-a",
    title: "Must not persist",
    transcript: ["must-not-persist"],
    viewState: {
      activeSubTab: "trajectory",
      rosterSummary: "must-not-persist",
      viewMode: null,
    },
  };
  await persistence.persistSessionOpen({ ...common, windowId: "session-window-one" });
  await persistence.persistSessionOpen({ ...common, windowId: "session-window-two" });

  assert.equal(upserts.length, 2);
  assert.equal(
    upserts[0].id,
    upserts[1].id,
    "reopening the same logical breakout must reuse one durable id",
  );
  assert.equal(records.size, 1, "idempotent upsert must leave one durable record");
  assert.deepEqual(upserts[0], {
    geometry_json: null,
    id: "intent:profile-a:session:session-a",
    kind: "session",
    leaf_id: null,
    profile_id: "profile-a",
    session_ref: "session-a",
    space_id: null,
    view_state_json: '{"activeSubTab":"trajectory","viewMode":null}',
  }, "upsert payload must contain identity/presentation only, never S3 runtime facts");
});

test("[pin] space-leaf open persists exact leaf coordinates without session authority", async () => {
  const { persistence, upserts } = persistenceHarness();
  persistence.arm({ profileId: "profile-space" });
  await persistence.persistSpaceLeafOpen({
    leafId: "leaf-exact",
    profileId: "profile-space",
    sessionId: "session-is-not-leaf-identity",
    spaceId: "space-origin",
    windowId: "session-window-leaf-native",
  });

  assert.deepEqual(upserts, [{
    geometry_json: null,
    id: "intent:profile-space:space_leaf:space-origin:leaf-exact",
    kind: "space_leaf",
    leaf_id: "leaf-exact",
    profile_id: "profile-space",
    session_ref: null,
    space_id: "space-origin",
    view_state_json: null,
  }], "space-leaf breakout upsert must contain only space_id + leaf_id identity");
  assert.equal(
    upserts[0].geometry_json,
    null,
    "unknown geometry must remain absent, never become a default rectangle",
  );
});

test("[pin] invalid allowlisted view state fails closed before IPC", async () => {
  const errors = [];
  const { persistence, upserts } = persistenceHarness({
    onError: (error) => { errors.push(String(error?.message || error)); },
  });
  persistence.arm({ profileId: "profile-a" });
  assert.equal(await persistence.persistSessionOpen({
    profileId: "profile-a",
    sessionRef: "session-a",
    viewState: { activeSubTab: { roster: ["must-not-persist"] } },
    windowId: "session-window-invalid-view-state",
  }), false);
  assert.deepEqual(upserts, [], "invalid presentation state must never reach breakout_upsert");
  assert.deepEqual(errors, ["Breakout view state activeSubTab must be a string or null."]);
});

test("[pin] explicit close is ordered after its open and cannot resurrect intent", async () => {
  const started = deferred();
  const writeGate = deferred();
  const order = [];
  const records = new Map();
  const persistence = createBreakoutWindowPersistence({
    deriveId: deterministicId,
    upsert: async (payload) => {
      order.push("upsert:start");
      started.resolve();
      await writeGate.promise;
      records.set(payload.id, payload);
      order.push("upsert:end");
    },
    register: async () => { order.push("register"); },
    remove: async (payload) => {
      records.delete(payload.id);
      order.push("remove");
    },
  });
  persistence.arm({ profileId: "profile-a" });
  const opened = persistence.persistSessionOpen({
    profileId: "profile-a",
    sessionRef: "session-a",
    windowId: "session-window-a",
  });
  const closed = persistence.persistExplicitClose({
    payload: { session_id: "session-a", window_id: "session-window-a" },
    profileId: "profile-a",
  });
  await started.promise;
  assert.deepEqual(order, ["upsert:start"]);
  writeGate.resolve();
  assert.equal(await opened, true);
  assert.equal(await closed, true);
  assert.deepEqual(order, ["upsert:start", "upsert:end", "register", "remove"]);
  assert.equal(records.size, 0, "explicit close must be the final durable mutation");
});

test("[critical pin] fast Return waits behind upsert and backend registration", async () => {
  const started = deferred();
  const writeGate = deferred();
  const order = [];
  const records = new Map();
  const registrations = new Map();
  const persistence = createBreakoutWindowPersistence({
    deriveId: deterministicId,
    upsert: async (payload) => {
      order.push("upsert:start");
      started.resolve();
      await writeGate.promise;
      records.set(payload.id, payload);
      order.push("upsert:end");
    },
    register: async (payload) => {
      registrations.set(payload.window_id, payload);
      order.push("register");
    },
    remove: async (payload) => {
      records.delete(payload.id);
      order.push("remove");
    },
  });
  persistence.arm({ profileId: "profile-a" });

  /* Production starts this immediately after session_window_open returns,
     before its awaited native-focus check. Return can therefore arrive while
     the write is pending, but it joins the same ordered command stream. */
  let opened;
  let returned;
  const tracked = startBreakoutOpenBeforeNativeCheck({
    persistOpen: () => {
      opened = persistence.persistSessionOpen({
        profileId: "profile-a",
        sessionRef: "session-fast-return",
        windowId: "session-window-fast-return",
      });
      return opened;
    },
    trackAfterNativeCheck: () => {
      returned = persistence.persistExplicitClose({
        payload: {
          control: SESSION_WINDOW_CONTROL_RETURN,
          session_id: "session-fast-return",
          window_id: "session-window-fast-return",
        },
        profileId: "profile-a",
      });
      return true;
    },
  });
  await started.promise;
  assert.deepEqual(order, ["upsert:start"]);
  writeGate.resolve();

  assert.equal(await opened, true);
  assert.equal(await returned, true);
  assert.equal(await tracked, true);
  assert.deepEqual(order, ["upsert:start", "upsert:end", "register", "remove"]);
  assert.equal(records.size, 0, "a late open must never resurrect a fast Return");
  assert.deepEqual(registrations.get("session-window-fast-return"), {
    id: "intent:profile-a:session:session-fast-return",
    profile_id: "profile-a",
    window_id: "session-window-fast-return",
  });
});

test("[critical pin] shutdown flush drains a close enqueued after flush starts", async () => {
  const upsertStarted = deferred();
  const upsertGate = deferred();
  const removeStarted = deferred();
  const removeGate = deferred();
  const records = new Map();
  const persistence = createBreakoutWindowPersistence({
    deriveId: deterministicId,
    upsert: async (payload) => {
      upsertStarted.resolve();
      await upsertGate.promise;
      records.set(payload.id, payload);
    },
    register: async () => {},
    remove: async (payload) => {
      removeStarted.resolve();
      await removeGate.promise;
      records.delete(payload.id);
    },
  });
  persistence.arm({ profileId: "profile-a" });
  const opened = persistence.persistSessionOpen({
    profileId: "profile-a",
    sessionRef: "session-close-during-flush",
    windowId: "session-window-close-during-flush",
  });
  await upsertStarted.promise;

  let flushResolved = false;
  const flushing = persistence.flush().then(() => { flushResolved = true; });
  const closed = persistence.persistExplicitClose({
    payload: {
      session_id: "session-close-during-flush",
      window_id: "session-window-close-during-flush",
    },
    profileId: "profile-a",
  });
  upsertGate.resolve();
  await removeStarted.promise;
  assert.equal(
    flushResolved,
    false,
    "flush must not resolve while a close that joined its tail is still pending",
  );

  removeGate.resolve();
  assert.equal(await opened, true);
  assert.equal(await closed, true);
  await flushing;
  assert.equal(records.size, 0, "flush must observe the close as the final durable mutation");
});

test("[pin] close removes from the profile that owned the native child", async () => {
  const { persistence, removes } = persistenceHarness();
  persistence.arm({ profileId: "profile-a" });
  await persistence.persistSessionOpen({
    profileId: "profile-a",
    sessionRef: "session-a",
    windowId: "session-window-shared-label",
  });
  persistence.disarm();
  persistence.arm({ profileId: "profile-b" });
  await persistence.persistExplicitClose({
    payload: { session_id: "session-a", window_id: "session-window-shared-label" },
    profileId: "profile-b",
  });
  await persistence.persistExplicitClose({
    forgetWindow: true,
    payload: { session_id: "session-a", window_id: "session-window-shared-label" },
    profileId: "profile-b",
  });
  assert.deepEqual(removes, [
    {
      id: "intent:profile-a:session:session-a",
      profile_id: "profile-a",
    },
    {
      id: "intent:profile-a:session:session-a",
      profile_id: "profile-a",
    },
  ], "durable close must remove from the profile that owned the open");
});

test("[pin] user Destroyed removes durable intent after confirmed native absence", async () => {
  const guard = createSessionWindowIncarnationGuard();
  const { persistence, records } = persistenceHarness();
  const label = "session-window-user-close";
  persistence.arm({ profileId: "profile-a" });
  await persistence.persistSessionOpen({
    profileId: "profile-a",
    sessionRef: "session-user-close",
    windowId: label,
  });
  guard.begin(label);
  const calls = [];
  const removed = await reconcileSessionWindowDestroyed({
    guard,
    label,
    nativeExists: async () => false,
    removeDurable: () => persistence.persistExplicitClose({
      forgetWindow: true,
      payload: { session_id: "session-user-close", window_id: label },
      profileId: "profile-a",
    }),
    removeTracked: () => { calls.push("tracked"); },
  });
  assert.equal(removed, true);
  assert.deepEqual(calls, ["tracked"]);
  assert.equal(records.size, 0, "non-exiting child Destroyed must remove durable intent");
});

test("[critical pin] backend exit refusal retains durable intent through Destroyed fallback", async () => {
  let backendExiting = false;
  const records = new Map();
  const persistence = createBreakoutWindowPersistence({
    deriveId: deterministicId,
    upsert: async (payload) => { records.set(payload.id, payload); },
    register: async () => {},
    remove: async (payload) => {
      /* This is the command's observable contract; the mutation-checked Rust
         pin exercises the real authoritative flag and database path. */
      if (!backendExiting) records.delete(payload.id);
    },
  });
  const guard = createSessionWindowIncarnationGuard();
  const label = "session-window-shutdown";
  persistence.arm({ profileId: "profile-a" });
  await persistence.persistSessionOpen({
    profileId: "profile-a",
    sessionRef: "session-shutdown",
    windowId: label,
  });
  guard.begin(label);
  backendExiting = true;
  let tracked = true;
  const removed = await reconcileSessionWindowDestroyed({
    guard,
    label,
    nativeExists: async () => false,
    removeDurable: () => persistence.persistExplicitClose({
      payload: { session_id: "session-shutdown", window_id: label },
      profileId: "profile-a",
    }),
    removeTracked: () => { tracked = false; },
  });
  assert.equal(removed, true);
  assert.equal(tracked, false, "Destroyed must still clear S3 native-existence tracking");
  assert.equal(records.size, 1, "backend exit authority must refuse durable erasure");
});

test("[critical pin] explicit close just before exit commit is removed", async () => {
  let backendExiting = false;
  const records = new Map();
  const persistence = createBreakoutWindowPersistence({
    deriveId: deterministicId,
    upsert: async (payload) => { records.set(payload.id, payload); },
    register: async () => {},
    remove: async (payload) => {
      if (!backendExiting) records.delete(payload.id);
    },
  });
  const guard = createSessionWindowIncarnationGuard();
  const nativeGate = deferred();
  const label = "session-window-close-before-shutdown";
  persistence.arm({ profileId: "profile-a" });
  await persistence.persistSessionOpen({
    profileId: "profile-a",
    sessionRef: "session-before-exit",
    windowId: label,
  });
  guard.begin(label);
  const reconciliation = reconcileSessionWindowDestroyed({
    guard,
    label,
    nativeExists: async () => nativeGate.promise,
    removeDurable: () => persistence.persistExplicitClose({
      payload: { session_id: "session-before-exit", window_id: label },
      profileId: "profile-a",
    }),
    removeTracked: () => {},
  });
  nativeGate.resolve(false);
  assert.equal(await reconciliation, true);
  backendExiting = true;
  assert.equal(records.size, 0, "a close before exit commit must not be retained");
});

test("[pin] stale Destroyed cannot remove tracking or durable intent after reopen", async () => {
  const guard = createSessionWindowIncarnationGuard();
  const nativeGate = deferred();
  const label = "session-window-reopened";
  guard.begin(label);
  const calls = [];
  const stale = reconcileSessionWindowDestroyed({
    guard,
    label,
    nativeExists: async () => nativeGate.promise,
    removeDurable: async () => { calls.push("durable"); },
    removeTracked: () => { calls.push("tracked"); },
  });
  guard.begin(label);
  nativeGate.resolve(false);
  assert.equal(await stale, false);
  assert.deepEqual(calls, [], "stale Destroyed must not erase a reopened breakout");
});

test("[pin] only Return is explicit durable close control", () => {
  assert.equal(sessionWindowControlEndsBreakout(SESSION_WINDOW_CONTROL_RETURN), true);
  assert.equal(
    sessionWindowControlEndsBreakout(SESSION_WINDOW_CONTROL_FOCUS_MAIN),
    false,
    "focus-main is not Return and must retain durable breakout intent",
  );
});

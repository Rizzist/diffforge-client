import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

import {
  clampBreakoutRestoreGeometry,
  createBreakoutHydrationRestoreGate,
  createBreakoutRestoreCoordinator,
  createBreakoutWindowPersistence,
  createSessionWindowNativeBoundary,
  createSessionWindowIncarnationGuard,
  decideBreakoutRestoreReopens,
  openTrackedSessionWindowNative,
  restoreBreakoutWindowsAtProductionBoundary,
} from "./sessionWindowBridge.js";
import {
  readSpaceLeafBreakoutRestoreTarget,
  resolveSpaceLeafBreakoutRecord,
} from "./useSpaces.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function breakoutRecord({
  geometryJson = null,
  kind = "session",
  leafId = null,
  profileId = "profile-restore",
  sessionRef = null,
  spaceId = null,
} = {}) {
  return {
    geometry_json: geometryJson,
    kind,
    leaf_id: leafId,
    profile_id: profileId,
    session_ref: sessionRef,
    space_id: spaceId,
    view_state_json: null,
  };
}

function leafSpaceRecord(sessionRef = "session-leaf") {
  return {
    focused_leaf: "leaf-current",
    layout_json: JSON.stringify({
      members: [sessionRef],
      root: {
        kind: "stack",
        id: "stack-root",
        tabs: [{
          kind: "leaf",
          id: "leaf-current",
          sessionRef,
          viewKind: "chat",
          viewState: { activeSubTab: null },
        }],
        active: "leaf-current",
      },
    }),
  };
}

let hostModulePromise;
async function sessionWindowHostModule() {
  if (!hostModulePromise) {
    hostModulePromise = (async () => {
      const server = await createServer({
        appType: "custom",
        logLevel: "silent",
        optimizeDeps: { noDiscovery: true },
        server: { middlewareMode: true },
        ssr: { noExternal: ["styled-components"] },
      });
      try {
        return await server.ssrLoadModule("/src/sessions/SessionWindowHost.jsx");
      } finally {
        await server.close();
      }
    })();
  }
  return hostModulePromise;
}

test("[pin] persisted session and leaf records become exact deduplicated reopen decisions", () => {
  const session = breakoutRecord({ sessionRef: "session-a" });
  const leaf = breakoutRecord({
    kind: "space_leaf",
    leafId: "leaf-b",
    spaceId: "space-b",
  });
  assert.deepEqual(
    decideBreakoutRestoreReopens([
      session,
      leaf,
      { ...session },
      breakoutRecord({ profileId: "profile-other", sessionRef: "must-not-open" }),
      breakoutRecord({ kind: "space_leaf", leafId: null, spaceId: "partial" }),
    ], "profile-restore"),
    [
      {
        geometryJson: null,
        kind: "session",
        sessionRef: "session-a",
        viewStateJson: null,
      },
      {
        geometryJson: null,
        kind: "space_leaf",
        leafId: "leaf-b",
        spaceId: "space-b",
        viewStateJson: null,
      },
    ],
  );
});

test("[pin] same-profile re-auth rejects a stale Step-4 completion until fresh hydration", async () => {
  const commands = [];
  let arms = 0;
  const gate = createBreakoutHydrationRestoreGate();
  const staleCompletion = gate.complete({ profileId: "profile-restore", revision: 4 });

  /* Same profile, new auth/roster generation: React may still expose the old
     completion during this effect flush, but the synchronous gate is newer. */
  gate.invalidate();
  const runStep6 = (hydrationToken) => restoreBreakoutWindowsAtProductionBoundary({
    armPersistence: () => { arms += 1; },
    coordinator: createBreakoutRestoreCoordinator(),
    hydrationGate: gate,
    hydrationToken,
    invokeCommand: async (command) => {
      commands.push(command);
      if (command === "breakout_list") return [];
      throw new Error(`Unexpected command ${command}`);
    },
    openBreakout: async () => "must-not-open",
    profileId: "profile-restore",
  });

  assert.deepEqual(await runStep6(staleCompletion), {
    armed: false,
    opened: 0,
    status: "gated",
  });
  assert.deepEqual(commands, [], "a stale same-profile completion must not start breakout_list");
  assert.equal(arms, 0);

  const freshCompletion = gate.complete({ profileId: "profile-restore", revision: 4 });
  assert.deepEqual(await runStep6(freshCompletion), {
    armed: true,
    opened: 0,
    status: "restored",
  });
  assert.deepEqual(commands, ["breakout_list"]);
  assert.equal(arms, 1);

  assert.equal(
    gate.complete({ profileId: "profile-restore", revision: 4 }),
    freshCompletion,
    "re-publishing one Step-4 completion must retain its already-claimed token",
  );
  assert.equal((await runStep6(freshCompletion)).status, "gated");
  assert.deepEqual(commands, ["breakout_list"], "Step 6 runs once per fresh Step-4 completion");
  assert.equal(arms, 1);
});

test("[pin] restore reopens both native kinds before arming and never double-writes their intents", async () => {
  const order = [];
  const upserts = [];
  const persistence = createBreakoutWindowPersistence({
    deriveId: async (identity) => `durable-${identity.kind}-${identity.sessionRef || identity.leafId}`,
    register: async () => {},
    remove: async () => {},
    upsert: async (payload) => { upserts.push(payload); },
  });
  const coordinator = createBreakoutRestoreCoordinator();
  const guard = createSessionWindowIncarnationGuard();
  const nativeWindows = new Set();
  const openedCoordinates = [];
  const result = await coordinator.restore({
    armPersistence: ({ profileId }) => {
      order.push("arm");
      persistence.arm({ profileId });
    },
    listBreakouts: async () => [
      breakoutRecord({ sessionRef: "session-a" }),
      breakoutRecord({ kind: "space_leaf", leafId: "leaf-b", spaceId: "space-b" }),
    ],
    openBreakout: (reopen, { isCurrent }) => openTrackedSessionWindowNative({
      closeNative: async (label) => { nativeWindows.delete(label); },
      guard,
      isCurrent,
      nativeExists: async (label) => nativeWindows.has(label),
      openNative: async () => {
        const label = reopen.kind === "session" ? "session-window-a" : "session-window-leaf-b";
        nativeWindows.add(label);
        openedCoordinates.push(reopen.kind === "session"
          ? [reopen.kind, reopen.sessionRef]
          : [reopen.kind, reopen.spaceId, reopen.leafId]);
        order.push(`open:${reopen.kind}`);
        return { label };
      },
      persistOpen: ({ label }) => {
        order.push(`persist:${reopen.kind}`);
        return reopen.kind === "session"
          ? persistence.persistSessionOpen({
            profileId: "profile-restore",
            sessionRef: reopen.sessionRef,
            windowId: label,
          })
          : persistence.persistSpaceLeafOpen({
            leafId: reopen.leafId,
            profileId: "profile-restore",
            spaceId: reopen.spaceId,
            windowId: label,
          });
      },
      track: () => {},
    }),
    profileId: "profile-restore",
  });

  assert.deepEqual(openedCoordinates, [
    ["session", "session-a"],
    ["space_leaf", "space-b", "leaf-b"],
  ]);
  assert.deepEqual(order, [
    "open:session",
    "persist:session",
    "open:space_leaf",
    "persist:space_leaf",
    "arm",
  ], "the gate must arm only after every native reopen has completed");
  assert.deepEqual(upserts, [], "restore opens must be dropped by the still-unarmed durable gate");
  assert.deepEqual(result, { armed: true, opened: 2, status: "restored" });

  await persistence.persistSessionOpen({
    profileId: "profile-restore",
    sessionRef: "session-after-restore",
    windowId: "session-window-after-restore",
  });
  assert.equal(upserts.length, 1, "ordinary post-restore opens must persist after arming");
});

test("[pin] production reopen focuses a duplicate logical window without recreating it", async () => {
  const commands = [];
  const guard = createSessionWindowIncarnationGuard();
  const nativeWindows = new Set();
  let created = 0;
  const invokeCommand = async (command, payload) => {
    commands.push({ command, payload });
    if (command === "session_window_open") {
      /* Raw native mutation double: always-create. The production boundary,
         not this mock, owns the focus-existing decision under test. */
      created += 1;
      const label = `session-window-created-${created}`;
      nativeWindows.add(label);
      return { label };
    }
    if (command === "session_window_focus") return nativeWindows.has(payload.label);
    if (command === "session_window_close") {
      nativeWindows.delete(payload.label);
      return undefined;
    }
    if (command === "breakout_list") {
      return [breakoutRecord({ sessionRef: "session-duplicate" })];
    }
    throw new Error(`Unexpected command ${command}`);
  };
  const nativeBoundary = createSessionWindowNativeBoundary({ invokeCommand });
  const open = (isCurrent = () => true) => openTrackedSessionWindowNative({
    closeNative: nativeBoundary.close,
    guard,
    isCurrent,
    nativeExists: nativeBoundary.focus,
    openNative: () => nativeBoundary.open({ session_id: "session-duplicate" }),
    track: () => {},
  });

  assert.equal(await open(), "session-window-created-1", "seed the already-open logical window");
  const hydrationGate = createBreakoutHydrationRestoreGate();
  const hydrationToken = hydrationGate.complete({ profileId: "profile-restore", revision: 1 });
  const result = await restoreBreakoutWindowsAtProductionBoundary({
    armPersistence: () => {},
    coordinator: createBreakoutRestoreCoordinator(),
    hydrationGate,
    hydrationToken,
    invokeCommand,
    openBreakout: (_reopen, { isCurrent }) => open(isCurrent),
    profileId: "profile-restore",
  });

  const openCalls = commands.filter(({ command }) => command === "session_window_open");
  const focusCalls = commands.filter(({ command }) => command === "session_window_focus");
  assert.deepEqual(result, { armed: true, opened: 1, status: "restored" });
  assert.equal(openCalls.length, 1, "production reopen must focus the known label, not re-create");
  assert.ok(
    focusCalls.some(({ payload }) => payload.label === "session-window-created-1"),
    "the duplicate production reopen must issue focus-existing for the stable label",
  );
  assert.equal(nativeWindows.size, 1);
  assert.equal(guard.current("session-window-created-1"), 2);
});

test("[pin] clamped persisted geometry reaches the actual native open and placement paths", async () => {
  const geometry = clampBreakoutRestoreGeometry(
    '{"width":2000,"height":300,"x":5000,"y":5000,"display":"current"}',
    [{
      name: "current",
      workArea: { position: { x: 0, y: 0 }, size: { width: 1200, height: 800 } },
    }],
  );
  assert.deepEqual(geometry, { width: 1200, height: 420, x: 0, y: 380 });
  const nativeOpenArgs = [];
  const placements = [];
  const guard = createSessionWindowIncarnationGuard();
  await openTrackedSessionWindowNative({
    applyNativeGeometry: async (label, applied) => { placements.push({ applied, label }); },
    closeNative: async () => {},
    geometry,
    guard,
    nativeExists: async () => true,
    openNative: async (applied) => {
      nativeOpenArgs.push({ height: applied?.height || 760, width: applied?.width || 960 });
      return { label: "session-window-geometry" };
    },
    track: () => {},
  });
  assert.deepEqual(nativeOpenArgs, [{ height: 420, width: 1200 }]);
  assert.deepEqual(placements, [{ applied: geometry, label: "session-window-geometry" }]);
  assert.equal(clampBreakoutRestoreGeometry("not-json", []), null);
  assert.equal(clampBreakoutRestoreGeometry(null, []), null);
});

test("[pin] a generation invalidated during native open actively closes the created orphan", async () => {
  const openGate = deferred();
  const nativeWindows = new Set();
  const closed = [];
  const persistedOwnership = [];
  const tracked = [];
  let current = true;
  const pending = openTrackedSessionWindowNative({
    closeNative: async (label) => {
      closed.push(label);
      nativeWindows.delete(label);
    },
    guard: createSessionWindowIncarnationGuard(),
    isCurrent: () => current,
    nativeExists: async (label) => nativeWindows.has(label),
    openNative: async () => {
      const result = await openGate.promise;
      nativeWindows.add(result.label);
      return result;
    },
    persistOpen: ({ label }) => { persistedOwnership.push(label); },
    track: (value) => { tracked.push(value); },
  });
  current = false;
  openGate.resolve({ label: "session-window-stale-created" });

  assert.equal(await pending, "");
  assert.deepEqual(persistedOwnership, ["session-window-stale-created"]);
  assert.deepEqual(closed, ["session-window-stale-created"]);
  assert.equal(nativeWindows.has("session-window-stale-created"), false);
  assert.deepEqual(tracked, [], "a stale in-flight creation must never become tracked live state");
});

test("[pin] production restore never removes durable rows when breakout_list is unreadable", async () => {
  const commands = [];
  const errors = [];
  const persistence = createBreakoutWindowPersistence({
    deriveId: async () => "durable-unreadable",
    remove: async () => {},
    upsert: async () => {},
  });
  const hydrationGate = createBreakoutHydrationRestoreGate();
  const hydrationToken = hydrationGate.complete({ profileId: "profile-restore", revision: 1 });
  const result = await restoreBreakoutWindowsAtProductionBoundary({
    armPersistence: ({ profileId }) => persistence.arm({ profileId }),
    coordinator: createBreakoutRestoreCoordinator(),
    hydrationGate,
    hydrationToken,
    invokeCommand: async (command) => {
      commands.push(command);
      if (command === "breakout_list") throw new Error("breakout database unreadable");
      return undefined;
    },
    onError: (error) => { errors.push(error.message); },
    openBreakout: async () => { throw new Error("must-not-open"); },
    profileId: "profile-restore",
  });
  assert.deepEqual(result, { armed: true, opened: 0, status: "unreadable" });
  assert.deepEqual(errors, ["breakout database unreadable"]);
  assert.deepEqual(
    commands,
    ["breakout_list"],
    "the real restore command boundary must never call breakout_remove after an unreadable list",
  );
  assert.equal(persistence.isArmed(), true, "ongoing user opens remain persistable after the skipped restore");
});

test("[pin] deleted sessions, leaves, and spaces reopen only as non-attaching host placeholders", async () => {
  const {
    attachLiveSessionWindowTarget,
    createSessionWindowTargetAuthority,
    resolveSessionWindowLeafTarget,
  } = await sessionWindowHostModule();
  const attachCalls = [];
  const deletedSessionAuthority = createSessionWindowTargetAuthority({
    params: { sessionId: "session-deleted" },
    publishTarget: () => {},
    readSessions: async () => [],
  });
  const deletedSession = await deletedSessionAuthority.publishBootstrap({
    applied_at_ms: 1,
    daemon_generation: 1,
    profile_id: "profile-restore",
    state: "reachable",
  });
  assert.equal(deletedSession.mode, "tombstone");
  assert.equal(attachLiveSessionWindowTarget(
    { ...deletedSession, session: { provider_session_id: "fabricated-provider" } },
    (providerId) => attachCalls.push(providerId),
  ), false);

  const deletedLeaf = resolveSessionWindowLeafTarget({
    leafId: "leaf-deleted",
    record: leafSpaceRecord(),
    roster: { state: "reachable", sessionRefs: ["session-leaf"] },
    sessions: [{ id: "session-leaf", provider_session_id: "provider-leaf" }],
  });
  assert.equal(deletedLeaf.mode, "tombstone");
  assert.equal(attachLiveSessionWindowTarget(
    { ...deletedLeaf, session: { provider_session_id: "fabricated-leaf-provider" } },
    (providerId) => attachCalls.push(providerId),
  ), false);

  const deletedSpaceAuthority = createSessionWindowTargetAuthority({
    params: { leafId: "leaf-current", spaceId: "space-deleted" },
    publishTarget: () => {},
    readSessions: async () => [],
    readSpace: async () => { throw new Error("space was deleted"); },
  });
  const deletedSpace = await deletedSpaceAuthority.publishBootstrap({
    applied_at_ms: 2,
    daemon_generation: 2,
    profile_id: "profile-restore",
    state: "reachable",
  });
  assert.equal(deletedSpace.mode, "unknown");
  assert.match(deletedSpace.reason, /space was deleted/);
  assert.equal(attachLiveSessionWindowTarget(
    { ...deletedSpace, session: { provider_session_id: "fabricated-space-provider" } },
    (providerId) => attachCalls.push(providerId),
  ), false);
  assert.deepEqual(attachCalls, [], "no placeholder target may reach surface_attach");
});

test("[pin] non-active leaf resolution reads current canonical bytes and fails typed without mutation", async () => {
  let reads = 0;
  const resolved = await readSpaceLeafBreakoutRestoreTarget({
    leafId: "leaf-current",
    readSpace: async (spaceId) => {
      reads += 1;
      assert.equal(spaceId, "space-non-active");
      return leafSpaceRecord("session-current");
    },
    roster: { state: "reachable", sessionRefs: ["session-current"] },
    spaceId: "space-non-active",
  });
  assert.deepEqual(resolved, { ok: true, sessionId: "session-current", viewKind: "chat" });
  assert.equal(reads, 1);

  const missing = resolveSpaceLeafBreakoutRecord(
    leafSpaceRecord("session-current"),
    "leaf-since-deleted",
    { state: "reachable", sessionRefs: ["session-current"] },
  );
  assert.equal(missing.ok, false);
  assert.match(missing.error, /no longer contains leaf/);
});

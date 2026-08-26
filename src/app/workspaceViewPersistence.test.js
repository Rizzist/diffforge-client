import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  bindWorkspaceViewPagehide,
  createWorkspaceViewSaver,
  serializeWorkspaceView,
} from "./workspaceViewPersistence.js";

function fakeTimers() {
  const queue = new Map();
  let nextId = 1;
  return {
    setTimeoutFn(fn, delay) {
      const id = nextId;
      nextId += 1;
      queue.set(id, { fn, delay });
      return id;
    },
    clearTimeoutFn(id) {
      queue.delete(id);
    },
    runTimers() {
      const entries = [...queue.values()];
      queue.clear();
      for (const entry of entries) entry.fn();
    },
    delays() {
      return [...queue.values()].map((entry) => entry.delay);
    },
    size() {
      return queue.size;
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function homePayload(profileId = "profile-a", openSessionRefs = []) {
  return {
    profileId,
    openSessionRefs,
    activeTarget: { kind: "home" },
    activeSpaceId: null,
  };
}

test("[pin] AppShell schedules only reachable-profile view intent and wires latency flushes", () => {
  const source = readFileSync(new URL("./AppShell.jsx", import.meta.url), "utf8");
  const scheduleStart = source.indexOf("const workspaceViewBarrier = sessionsRosterGateRef.current.barrier;");
  const scheduleEnd = source.indexOf("const enterSpaceFromRail", scheduleStart);
  assert.notEqual(scheduleStart, -1, "the reachable-profile scheduling seam must exist");
  assert.notEqual(scheduleEnd, -1, "the scheduling seam must have a stable boundary");
  const wiring = source.slice(scheduleStart, scheduleEnd);

  assert.match(
    wiring,
    /workspaceViewBarrier\.state === "reachable"[\s\S]*?workspaceViewBarrier\.profile_id/,
    "only the step-2 reachable barrier may scope a view save",
  );
  assert.match(
    wiring,
    /let activeTarget = \{ kind: "home" \};[\s\S]*?if \(!sessionDraftOpen && activeSpaceId\)[\s\S]*?\{ kind: "space", spaceId: activeSpaceId \}[\s\S]*?else if \(!sessionDraftOpen && activeSessionId\)[\s\S]*?\{ kind: "session", sessionRef: activeSessionId \}/,
    "draft/home, space, and ordinary session intent must use the serializer input API",
  );
  assert.match(
    wiring,
    /schedule\(\{[\s\S]*?profileId: workspaceViewProfileId,[\s\S]*?openSessionRefs: \[\.\.\.openSessionIds\],[\s\S]*?activeTarget,[\s\S]*?activeSpaceId,/,
    "the ordered open refs and presentation target must reach the gated saver",
  );
  assert.match(wiring, /window\.addEventListener\("pagehide", flushOnPageHide\)/);
  assert.match(wiring, /document\.visibilityState === "hidden"/);

  const saverSetup = source.slice(
    source.indexOf("const workspaceViewSaverRef = useRef(null);"),
    scheduleStart,
  );
  assert.match(saverSetup, /invoke\("workspace_view_save", payload\)/);
  assert.doesNotMatch(
    saverSetup,
    /\.arm\s*\(/,
    "Step 3 must stay unarmed until Step 4 restores the profile",
  );
});

test("[pin] canonical session, space, and home bytes exactly match Rust field order", () => {
  assert.equal(
    serializeWorkspaceView({
      openSessionRefs: ["session-b", "session-a"],
      activeTarget: { kind: "session", sessionRef: "session-b" },
      activeSpaceId: null,
    }),
    "{\"open_sessions\":[\"session-b\",\"session-a\"],\"active_target\":{\"kind\":\"session\",\"session_ref\":\"session-b\"},\"active_space_id\":null}",
  );
  assert.equal(
    serializeWorkspaceView({
      openSessionRefs: ["session-b", "session-a"],
      activeTarget: { kind: "space", spaceId: "space-a" },
      activeSpaceId: "space-a",
    }),
    "{\"open_sessions\":[\"session-b\",\"session-a\"],\"active_target\":{\"kind\":\"space\",\"space_id\":\"space-a\"},\"active_space_id\":\"space-a\"}",
  );
  assert.equal(
    serializeWorkspaceView({
      openSessionRefs: ["session-b", "session-a"],
      activeTarget: { kind: "home" },
      activeSpaceId: null,
    }),
    "{\"open_sessions\":[\"session-b\",\"session-a\"],\"active_target\":{\"kind\":\"home\"},\"active_space_id\":null}",
  );
});

test("[pin] open-session ordering is preserved and only reference presentation data is emitted", () => {
  const bytes = serializeWorkspaceView({
    openSessionRefs: ["third", "first", "second"],
    activeTarget: {
      kind: "session",
      sessionRef: "first",
      transcript: [{ role: "user", text: "must not persist" }],
      processIncarnation: "pid-42",
    },
    activeSpaceId: null,
    nativeWindowLabels: ["runtime-only"],
  });
  assert.deepEqual(JSON.parse(bytes), {
    open_sessions: ["third", "first", "second"],
    active_target: { kind: "session", session_ref: "first" },
    active_space_id: null,
  });
  assert.throws(
    () => serializeWorkspaceView({
      openSessionRefs: ["same", "same"],
      activeTarget: { kind: "home" },
      activeSpaceId: null,
    }),
    /duplicated/,
  );
  assert.throws(
    () => serializeWorkspaceView({
      openSessionRefs: [" padded "],
      activeTarget: { kind: "home" },
      activeSpaceId: null,
    }),
    /already-trimmed/,
  );
  assert.throws(
    () => serializeWorkspaceView({
      openSessionRefs: ["bad\ud800ref"],
      activeTarget: { kind: "home" },
      activeSpaceId: null,
    }),
    /unpaired UTF-16 surrogate/,
    "admitted strings must always be decodable by Rust serde_json",
  );
  assert.throws(
    () => serializeWorkspaceView({
      openSessionRefs: ["\u0085rust-whitespace"],
      activeTarget: { kind: "home" },
      activeSpaceId: null,
    }),
    /already-trimmed/,
    "Rust str::trim treats U+0085 as edge whitespace",
  );
  assert.doesNotThrow(
    () => serializeWorkspaceView({
      openSessionRefs: ["\ufeffrust-non-whitespace"],
      activeTarget: { kind: "home" },
      activeSpaceId: null,
    }),
    "Rust str::trim does not strip U+FEFF",
  );
});

test("[pin] hydration is fail-closed: pre-arm and wrong-profile schedules retain nothing", async () => {
  const timers = fakeTimers();
  const calls = [];
  const saver = createWorkspaceViewSaver({
    save: async (args) => {
      calls.push(args);
      return { revision: 1 };
    },
    ...timers,
  });

  assert.equal(saver.isArmed(), false);
  assert.equal(
    saver.schedule({ profileId: "profile-a", openSessionRefs: "hydration default" }),
    false,
    "pre-arm payload is dropped before even validating its default shape",
  );
  assert.equal(timers.size(), 0);
  assert.equal(saver.hasPending(), false);
  await saver.flush();
  assert.deepEqual(calls, []);

  saver.arm({ profileId: "profile-a", revision: null });
  assert.equal(saver.isArmed(), true);
  assert.equal(saver.getRevision(), null);
  assert.equal(
    saver.schedule({ profileId: "profile-b", openSessionRefs: "other profile default" }),
    false,
  );
  assert.equal(timers.size(), 0);
  await saver.flush();
  assert.deepEqual(calls, []);

  assert.equal(saver.schedule(homePayload("profile-a")), true);
  assert.deepEqual(timers.delays(), [200], "the default debounce is hydration-safe and short");
  await saver.flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    profile_id: "profile-a",
    view_json: "{\"open_sessions\":[],\"active_target\":{\"kind\":\"home\"},\"active_space_id\":null}",
    expected_revision: null,
  });
  assert.equal(saver.getRevision(), 1);
});

test("[pin] a debounced burst writes only the latest state", async () => {
  const timers = fakeTimers();
  const calls = [];
  let nextRevision = 8;
  const saver = createWorkspaceViewSaver({
    save: async (args) => {
      calls.push(args);
      nextRevision += 1;
      return { revision: nextRevision };
    },
    debounceMs: 175,
    ...timers,
  });
  saver.arm({ profileId: "profile-a", revision: 8 });
  saver.schedule(homePayload("profile-a", ["A"]));
  saver.schedule(homePayload("profile-a", ["B"]));
  saver.schedule(homePayload("profile-a", ["C"]));
  assert.deepEqual(timers.delays(), [175]);
  timers.runTimers();
  await saver.flush();
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].view_json).open_sessions, ["C"]);
  assert.equal(calls[0].expected_revision, 8);
  assert.equal(saver.getRevision(), 9);
  assert.equal(saver.hasPending(), false);
});

test("[pin] the newest state scheduled during an in-flight save always lands", async () => {
  const timers = fakeTimers();
  const firstGate = deferred();
  const firstStarted = deferred();
  const calls = [];
  const saver = createWorkspaceViewSaver({
    save: async (args) => {
      calls.push(args);
      if (calls.length === 1) {
        firstStarted.resolve();
        await firstGate.promise;
      }
      return { revision: 10 + calls.length };
    },
    ...timers,
  });
  saver.arm({ profileId: "profile-a", revision: 10 });
  saver.schedule(homePayload("profile-a", ["A"]));
  timers.runTimers();
  await firstStarted.promise;

  saver.schedule(homePayload("profile-a", ["B"]));
  saver.schedule(homePayload("profile-a", ["C"]));
  firstGate.resolve();
  await saver.flush();

  assert.deepEqual(
    calls.map((args) => JSON.parse(args.view_json).open_sessions),
    [["A"], ["C"]],
  );
  assert.deepEqual(calls.map((args) => args.expected_revision), [10, 11]);
  assert.equal(saver.getRevision(), 12);
  assert.equal(saver.hasPending(), false);
});

test("[pin] re-arming a restored profile fences an older profile's late completion", async () => {
  const timers = fakeTimers();
  const oldGate = deferred();
  const oldStarted = deferred();
  const calls = [];
  const saver = createWorkspaceViewSaver({
    save: async (args) => {
      calls.push(args);
      if (args.profile_id === "profile-old") {
        oldStarted.resolve();
        await oldGate.promise;
        return { revision: 2 };
      }
      return { revision: 21 };
    },
    ...timers,
  });
  saver.arm({ profileId: "profile-old", revision: 1 });
  saver.schedule(homePayload("profile-old", ["old"]));
  timers.runTimers();
  await oldStarted.promise;

  saver.arm({ profileId: "profile-new", revision: 20 });
  saver.schedule(homePayload("profile-new", ["new-restored"]));
  oldGate.resolve();
  await saver.flush();

  assert.deepEqual(calls.map((args) => args.profile_id), ["profile-old", "profile-new"]);
  assert.deepEqual(calls.map((args) => args.expected_revision), [1, 20]);
  assert.equal(saver.getRevision(), 21, "the late old-profile revision is ignored");
  assert.equal(saver.hasPending(), false);
});

test("[pin] a stale revision is fenced, re-synced from Rust's conflict, and retried", async () => {
  const timers = fakeTimers();
  const calls = [];
  const errors = [];
  const saver = createWorkspaceViewSaver({
    save: async (args) => {
      calls.push(args);
      if (calls.length === 1) {
        throw new Error("Workspace view revision conflict: expected 2, current 7.");
      }
      return { revision: 8 };
    },
    onError: (error) => errors.push(error),
    ...timers,
  });
  saver.arm({ profileId: "profile-a", revision: 2 });
  saver.schedule(homePayload("profile-a", ["latest"]));
  timers.runTimers();
  await saver.flush();

  assert.deepEqual(calls.map((args) => args.expected_revision), [2, 7]);
  assert.deepEqual(
    calls.map((args) => JSON.parse(args.view_json).open_sessions),
    [["latest"], ["latest"]],
  );
  assert.deepEqual(errors, [], "a resolved fencing conflict is not surfaced as a save failure");
  assert.equal(saver.getRevision(), 8);
  assert.equal(saver.hasPending(), false);
});

test("a conflict for a different expected revision is an ordinary retained failure", async () => {
  const timers = fakeTimers();
  const calls = [];
  const errors = [];
  const saver = createWorkspaceViewSaver({
    save: async (args) => {
      calls.push(args);
      throw new Error("Workspace view revision conflict: expected 99, current 7.");
    },
    onError: (error) => errors.push(error),
    ...timers,
  });
  saver.arm({ profileId: "profile-a", revision: 2 });
  saver.schedule(homePayload("profile-a"));
  timers.runTimers();
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();

  assert.equal(calls.length, 1, "the unrelated conflict is not automatically retried");
  assert.equal(errors.length, 1);
  assert.equal(saver.getRevision(), 2, "an unrelated error cannot advance the local fence");
  assert.equal(saver.hasPending(), true);
  saver.disarm();
});

test("a failed save is reported, kept pending, and retried by flush", async () => {
  const timers = fakeTimers();
  const calls = [];
  const errors = [];
  let failNext = true;
  const saver = createWorkspaceViewSaver({
    save: async (args) => {
      calls.push(args);
      if (failNext) {
        failNext = false;
        throw new Error("sqlite is busy");
      }
      return { revision: 4 };
    },
    onError: (error, args) => errors.push({ error, args }),
    ...timers,
  });
  saver.arm({ profileId: "profile-a", revision: 3 });
  saver.schedule(homePayload("profile-a", ["unsaved-latest"]));
  timers.runTimers();
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();

  assert.equal(errors.length, 1);
  assert.equal(errors[0].error.message, "sqlite is busy");
  assert.equal(errors[0].args.expected_revision, 3);
  assert.equal(saver.hasPending(), true);
  await saver.flush();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].view_json, calls[0].view_json);
  assert.equal(calls[1].expected_revision, 3);
  assert.equal(saver.getRevision(), 4);
  assert.equal(saver.hasPending(), false);
});

test("[pin] flush drains immediately and pagehide starts that same flush path", async () => {
  const timers = fakeTimers();
  const calls = [];
  const listeners = new Map();
  const target = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
    dispatch(type) {
      listeners.get(type)?.();
    },
  };
  const saver = createWorkspaceViewSaver({
    save: async (args) => {
      calls.push(args);
      return { revision: 1 };
    },
    ...timers,
  });
  saver.arm({ profileId: "profile-a", revision: null });
  saver.schedule(homePayload("profile-a", ["pagehide-latest"]));
  assert.equal(timers.size(), 1);

  const unbind = bindWorkspaceViewPagehide(saver, target);
  target.dispatch("pagehide");
  assert.equal(calls.length, 1, "pagehide synchronously starts the save before returning");
  await saver.flush();
  assert.equal(timers.size(), 0);
  assert.deepEqual(JSON.parse(calls[0].view_json).open_sessions, ["pagehide-latest"]);

  unbind();
  assert.equal(listeners.has("pagehide"), false);
});

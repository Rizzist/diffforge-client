import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { act, createElement, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";

import { useWorkspaceViewRestoreEffects } from "./workspaceViewRestore.js";
import {
  createWorkspaceViewSaver,
  serializeWorkspaceView,
} from "./workspaceViewPersistence.js";

const NOOP = () => {};

function snapshotRecord({
  openSessionRefs = ["restored-session"],
  activeTarget = { kind: "session", sessionRef: "restored-session" },
  revision = 17,
} = {}) {
  return {
    profile_id: "profile-a",
    revision,
    schema_version: 1,
    updated_at_ms: 1_700_000_000_000,
    view_json: serializeWorkspaceView({
      activeSpaceId: null,
      activeTarget,
      openSessionRefs,
    }),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}

function fakeTimers() {
  let nextId = 1;
  const jobs = new Map();
  return {
    clearTimeoutFn(id) {
      jobs.delete(id);
    },
    count() {
      return jobs.size;
    },
    runNext() {
      const next = jobs.entries().next().value;
      if (!next) return false;
      const [id, job] = next;
      jobs.delete(id);
      job.callback();
      return true;
    },
    setTimeoutFn(callback, delay) {
      const id = nextId;
      nextId += 1;
      jobs.set(id, { callback, delay });
      return id;
    },
  };
}

function installNullRenderDom() {
  const previous = new Map();
  for (const name of ["document", "window", "IS_REACT_ACT_ENVIRONMENT"]) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  const window = {
    HTMLIFrameElement: class HTMLIFrameElement {},
    addEventListener() {},
    document: null,
    removeEventListener() {},
  };
  const document = {
    addEventListener() {},
    createElement() {
      return {};
    },
    defaultView: window,
    documentElement: {},
    nodeType: 9,
    removeEventListener() {},
  };
  window.document = document;
  const container = {
    addEventListener() {},
    appendChild() {},
    insertBefore() {},
    namespaceURI: "http://www.w3.org/1999/xhtml",
    nodeName: "DIV",
    nodeType: 1,
    ownerDocument: document,
    removeChild() {},
    removeEventListener() {},
    tagName: "DIV",
    textContent: "",
  };
  globalThis.window = window;
  globalThis.document = document;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    container,
    restore() {
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function mountHarness(element) {
  const dom = installNullRenderDom();
  const root = createRoot(dom.container);
  await act(async () => {
    root.render(element);
    await flushMicrotasks();
  });
  return {
    async render(nextElement) {
      await act(async () => {
        root.render(nextElement);
        await flushMicrotasks();
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
        await flushMicrotasks();
      });
      dom.restore();
    },
  };
}

function RestoreHarness({
  applyPendingTarget,
  barrierRef,
  clearRetryTimeout,
  openSessionEntries,
  pendingTargetRef,
  readSnapshot,
  retryTimeout,
  rosterRef,
  rosterState,
  saver,
  onHydration = NOOP,
}) {
  const [view, setView] = useState({
    activeSessionId: "",
    activeSpaceId: null,
    openSessionRefs: [],
    sessionDraftOpen: false,
  });
  const applyHydration = useCallback(async (hydration) => {
    onHydration(hydration);
    setView({
      activeSessionId: hydration.target.kind === "session"
        ? hydration.target.sessionRef
        : "",
      activeSpaceId: hydration.activeSpaceId,
      openSessionRefs: [...hydration.openSessionRefs],
      sessionDraftOpen: hydration.target.kind === "home" && Boolean(hydration.activeSpaceId),
    });
  }, [onHydration]);
  const scheduleIntent = useCallback(() => {
    let activeTarget = { kind: "home" };
    if (!view.sessionDraftOpen && view.activeSpaceId) {
      activeTarget = { kind: "space", spaceId: view.activeSpaceId };
    } else if (!view.sessionDraftOpen && view.activeSessionId) {
      activeTarget = { kind: "session", sessionRef: view.activeSessionId };
    }
    saver.schedule({
      profileId: "profile-a",
      openSessionRefs: [...view.openSessionRefs],
      activeTarget,
      activeSpaceId: view.activeSpaceId,
    });
  }, [saver, view]);

  useWorkspaceViewRestoreEffects({
    applyHydration,
    applyPendingTarget,
    authState: "authenticated",
    barrierRef,
    barrierRevision: 1,
    clearTimeoutFn: clearRetryTimeout,
    onInvalidSnapshot: NOOP,
    onTransientReadError: NOOP,
    openSessionEntries,
    pendingTargetRef,
    profileId: "profile-a",
    readSnapshot,
    restoreRetryDelayMs: 10,
    rosterRef,
    rosterState,
    saver,
    scheduleIntent,
    setTimeoutFn: retryTimeout,
  });
  return null;
}

test("[pin] mounted restore drops pre-hydration defaults and arms only in the hydrated commit", async () => {
  const read = deferred();
  const saveTimers = fakeTimers();
  const retryTimers = fakeTimers();
  const writes = [];
  const saver = createWorkspaceViewSaver({
    clearTimeoutFn: saveTimers.clearTimeoutFn,
    debounceMs: 5,
    save: async (args) => {
      writes.push(args);
      return { revision: 18 };
    },
    setTimeoutFn: saveTimers.setTimeoutFn,
  });
  const barrierRef = {
    current: { barrier: { profile_id: "profile-a", state: "reachable" } },
  };
  const props = {
    applyPendingTarget: () => {},
    barrierRef,
    clearRetryTimeout: retryTimers.clearTimeoutFn,
    openSessionEntries: [],
    pendingTargetRef: { current: null },
    readSnapshot: () => read.promise,
    retryTimeout: retryTimers.setTimeoutFn,
    rosterRef: {
      current: { state: "reachable", sessionRefs: ["restored-session"] },
    },
    rosterState: "reachable",
    saver,
  };
  const mounted = await mountHarness(createElement(RestoreHarness, props));
  try {
    assert.equal(saver.isArmed(), false, "the saver must remain unarmed while workspace_view_get is pending");
    assert.equal(
      saveTimers.count(),
      0,
      "pre-hydration empty defaults must not even schedule a clobbering write",
    );
    assert.deepEqual(writes, []);

    await act(async () => {
      read.resolve(snapshotRecord());
      await flushMicrotasks();
    });

    assert.equal(saver.isArmed(), true, "arming must occur only after hydrated state commits");
    assert.equal(saver.hasPending(), true, "the hydrated commit must schedule its restored presentation");
    assert.equal(saveTimers.count(), 1);
    await act(async () => {
      saveTimers.runNext();
      await flushMicrotasks();
    });
    assert.equal(writes.length, 1);
    assert.deepEqual(JSON.parse(writes[0].view_json), {
      active_space_id: null,
      active_target: { kind: "session", session_ref: "restored-session" },
      open_sessions: ["restored-session"],
    }, "the first writable payload must be hydrated state, never empty defaults");
  } finally {
    await mounted.unmount();
  }
});

test("[pin] transient workspace-view read retries while unarmed, then arms restored state", async () => {
  const retryTimers = fakeTimers();
  const saveTimers = fakeTimers();
  let reads = 0;
  const hydrations = [];
  const saver = createWorkspaceViewSaver({
    clearTimeoutFn: saveTimers.clearTimeoutFn,
    debounceMs: 5,
    save: async () => ({ revision: 19 }),
    setTimeoutFn: saveTimers.setTimeoutFn,
  });
  const props = {
    applyPendingTarget: () => {},
    barrierRef: {
      current: { barrier: { profile_id: "profile-a", state: "reachable" } },
    },
    clearRetryTimeout: retryTimers.clearTimeoutFn,
    onHydration: (hydration) => hydrations.push(hydration),
    openSessionEntries: [],
    pendingTargetRef: { current: null },
    readSnapshot: async () => {
      reads += 1;
      if (reads === 1) throw new Error("Unable to read workspace view: database is locked");
      return snapshotRecord();
    },
    retryTimeout: retryTimers.setTimeoutFn,
    rosterRef: {
      current: { state: "reachable", sessionRefs: ["restored-session"] },
    },
    rosterState: "reachable",
    saver,
  };
  const mounted = await mountHarness(createElement(RestoreHarness, props));
  try {
    assert.equal(reads, 1);
    assert.equal(saver.isArmed(), false, "a transient read failure must leave persistence unarmed");
    assert.equal(retryTimers.count(), 1, "a transient read failure must guarantee a retry");
    assert.deepEqual(hydrations, [], "transient failure must not import fresh Home");

    await act(async () => {
      retryTimers.runNext();
      await flushMicrotasks();
    });
    assert.equal(reads, 2);
    assert.equal(saver.isArmed(), true);
    assert.equal(hydrations.length, 1);
    assert.equal(hydrations[0].source, "restored");
    assert.equal(retryTimers.count(), 0);
  } finally {
    await mounted.unmount();
  }
});

test("[pin] corrupt workspace-view snapshot hydrates fresh Home without retrying", async () => {
  const retryTimers = fakeTimers();
  const saveTimers = fakeTimers();
  const hydrations = [];
  let reads = 0;
  const saver = createWorkspaceViewSaver({
    clearTimeoutFn: saveTimers.clearTimeoutFn,
    debounceMs: 5,
    save: async () => ({ revision: 1 }),
    setTimeoutFn: saveTimers.setTimeoutFn,
  });
  const props = {
    applyPendingTarget: () => {},
    barrierRef: {
      current: { barrier: { profile_id: "profile-a", state: "reachable" } },
    },
    clearRetryTimeout: retryTimers.clearTimeoutFn,
    onHydration: (hydration) => hydrations.push(hydration),
    openSessionEntries: [],
    pendingTargetRef: { current: null },
    readSnapshot: async () => {
      reads += 1;
      throw new Error("Workspace view canonical-byte divergence: corrupt bytes");
    },
    retryTimeout: retryTimers.setTimeoutFn,
    rosterRef: { current: { state: "reachable", sessionRefs: [] } },
    rosterState: "reachable",
    saver,
  };
  const mounted = await mountHarness(createElement(RestoreHarness, props));
  try {
    assert.equal(reads, 1);
    assert.equal(retryTimers.count(), 0, "corrupt stored bytes must not enter the transient retry loop");
    assert.equal(saver.isArmed(), true, "fresh Home may arm only after corrupt-byte recovery commits");
    assert.equal(hydrations.length, 1);
    assert.equal(hydrations[0].source, "invalid");
    assert.deepEqual(hydrations[0].target, { kind: "home" });
    assert.deepEqual(hydrations[0].openSessionRefs, []);
  } finally {
    await mounted.unmount();
  }
});

test("[pin] mounted production pending-target effect selects a live fallback when the roster lands", async () => {
  const retryTimers = fakeTimers();
  const saveTimers = fakeTimers();
  const selected = [];
  const pendingTargetRef = { current: null };
  const rosterRef = {
    current: { state: "unreachable", reason: "Fresh roster pending." },
  };
  const saver = createWorkspaceViewSaver({
    clearTimeoutFn: saveTimers.clearTimeoutFn,
    debounceMs: 5,
    save: async () => ({ revision: 18 }),
    setTimeoutFn: saveTimers.setTimeoutFn,
  });
  const baseProps = {
    applyPendingTarget: (target) => selected.push(target),
    barrierRef: {
      current: { barrier: { profile_id: "profile-a", state: "reachable" } },
    },
    clearRetryTimeout: retryTimers.clearTimeoutFn,
    pendingTargetRef,
    readSnapshot: async () => snapshotRecord({
      activeTarget: { kind: "session", sessionRef: "not-in-open-set" },
      openSessionRefs: ["fallback-session"],
    }),
    retryTimeout: retryTimers.setTimeoutFn,
    rosterRef,
    saver,
  };
  const mounted = await mountHarness(createElement(RestoreHarness, {
    ...baseProps,
    openSessionEntries: [{
      reason: "Fresh roster pending.",
      sessionRef: "fallback-session",
      state: "unknown",
    }],
    rosterState: "unreachable",
  }));
  try {
    assert.deepEqual(selected, []);
    assert.deepEqual(pendingTargetRef.current, {
      profileId: "profile-a",
      requestedTarget: { kind: "session", sessionRef: "not-in-open-set" },
    });

    rosterRef.current = { state: "reachable", sessionRefs: ["fallback-session"] };
    await mounted.render(createElement(RestoreHarness, {
      ...baseProps,
      openSessionEntries: [{ sessionRef: "fallback-session", state: "live" }],
      rosterState: "reachable",
    }));

    assert.deepEqual(selected, [{
      kind: "session",
      sessionRef: "fallback-session",
      state: "live",
    }], "the production pending-target effect must retry selection from the fresh roster");
    assert.equal(pendingTargetRef.current, null);

    const shell = readFileSync(new URL("./AppShell.jsx", import.meta.url), "utf8");
    assert.match(
      shell,
      /useWorkspaceViewRestoreEffects\(\{[\s\S]*?applyPendingTarget: applyPendingWorkspaceViewTarget[\s\S]*?\}\);/,
      "AppShell must mount the behaviorally exercised restore/pending-target effects",
    );
  } finally {
    await mounted.unmount();
  }
});

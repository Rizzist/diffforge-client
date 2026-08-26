import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  createSessionWindowIncarnationGuard,
  removeSessionWindowAfterNativeCheck,
  removeSessionWindowBreakout,
  removeSpaceWindowBreakout,
  returnSessionWindowToSpaceLeaf,
  sessionWindowRosterPresentation,
  sessionWindowShouldRefresh,
  trackSessionWindowAfterNativeCheck,
  trackSessionWindowBreakout,
  trackSessionWindowStateIfCurrent,
  trackSpaceWindowBreakout,
} from "./sessionWindowBridge.js";
import {
  commitLatestSpaceEntryIntent,
  createSpaceEntryIntentSequence,
  resolveLatestSpaceEntryIntent,
} from "./useSpaces.js";

function source(name) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

let hostModulePromise;

async function sessionWindowHostModule() {
  if (!hostModulePromise) {
    hostModulePromise = import("vite").then(async ({ createServer }) => {
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
    });
  }
  return hostModulePromise;
}

async function sessionSurfaceModule() {
  const { createServer } = await import("vite");
  const server = await createServer({
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    ssr: { noExternal: ["styled-components", /^@xterm\//] },
  });
  try {
    return await server.ssrLoadModule("/src/sessions/SessionSurface.jsx");
  } finally {
    await server.close();
  }
}

function renderFunctionComponent(React, render, {
  memoValues = new Map(),
  stateValues = new Map(),
} = {}) {
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals.H;
  let id = 0;
  let memoIndex = 0;
  let stateIndex = 0;
  internals.H = {
    use(value) { return value; },
    useActionState(_action, initial) { return [initial, () => {}, false]; },
    useCallback(callback) { return callback; },
    useContext(context) { return context?._currentValue ?? context?._currentValue2; },
    useDebugValue() {},
    useDeferredValue(value) { return value; },
    useEffect() {},
    useFormState(_action, initial) { return [initial, () => {}]; },
    useHostTransitionStatus() { return null; },
    useId() { id += 1; return `session-window-test-${id}`; },
    useImperativeHandle() {},
    useInsertionEffect() {},
    useLayoutEffect() {},
    useMemo(factory) {
      memoIndex += 1;
      return memoValues.has(memoIndex) ? memoValues.get(memoIndex) : factory();
    },
    useMemoCache(size) {
      return Array(size).fill(Symbol.for("react.memo_cache_sentinel"));
    },
    useOptimistic(value) { return [value, () => {}]; },
    useReducer(_reducer, initial, initialize) {
      return [initialize ? initialize(initial) : initial, () => {}];
    },
    useRef(initial) { return { current: initial }; },
    useState(initial) {
      stateIndex += 1;
      const value = stateValues.has(stateIndex)
        ? stateValues.get(stateIndex)
        : typeof initial === "function" ? initial() : initial;
      return [value, () => {}];
    },
    useSyncExternalStore(_subscribe, getSnapshot) { return getSnapshot(); },
    useTransition() { return [false, (callback) => callback()]; },
  };
  try {
    return render();
  } finally {
    internals.H = previousDispatcher;
  }
}

function renderSessionWindowHostState(SessionWindowHost, target) {
  const hadReact = Object.hasOwn(globalThis, "React");
  const previousReact = globalThis.React;
  const hadWindow = Object.hasOwn(globalThis, "window");
  const previousWindow = globalThis.window;
  globalThis.React = React;
  globalThis.window = {
    location: {
      hash: "#/session?session_id=session-a&space_id=space-current&leaf_id=leaf-current&title=Original+URL+session",
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
    },
  };
  try {
    const tree = renderFunctionComponent(React, () => SessionWindowHost(), {
      memoValues: new Map([[1, {
        close: () => {},
        isFullscreen: async () => false,
        onResized: async () => () => {},
        setFullscreen: async () => {},
        startDragging: () => {},
      }]]),
      stateValues: new Map([[3, target]]),
    });
    return renderToStaticMarkup(tree);
  } finally {
    if (hadReact) globalThis.React = previousReact;
    else delete globalThis.React;
    if (hadWindow) globalThis.window = previousWindow;
    else delete globalThis.window;
  }
}

function findElement(node, predicate) {
  if (!node || typeof node !== "object") return null;
  if (predicate(node)) return node;
  const children = node.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, predicate);
    if (found) return found;
  }
  return null;
}

function singleLeafSpaceRecord(sessionRef) {
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

test("session breakout close cleanup removes exactly the destroyed window", () => {
  const first = trackSessionWindowBreakout({}, { label: "session-window-a" }, {
    id: "session-a",
    title: "A",
  });
  const both = trackSessionWindowBreakout(first, { label: "session-window-b" }, {
    id: "session-b",
    title: "B",
  });
  const after = removeSessionWindowBreakout(both, {
    session_id: "session-a",
    window_id: "session-window-a",
  });
  assert.deepEqual(Object.keys(after), ["session-window-b"]);
  assert.strictEqual(removeSessionWindowBreakout(after, {
    window_id: "session-window-a",
  }), after, "duplicate close reports must be idempotent");
});

test("space leaf breakout cleanup keeps duplicate-session leaves distinct", () => {
  const first = trackSpaceWindowBreakout({}, { label: "session-window-leaf-a" }, {
    leafId: "leaf-a",
    sessionId: "session-shared",
    spaceId: "space-1",
  });
  const both = trackSpaceWindowBreakout(first, { label: "session-window-leaf-b" }, {
    leafId: "leaf-b",
    sessionId: "session-shared",
    spaceId: "space-1",
  });
  const after = removeSpaceWindowBreakout(both, {
    leaf_id: "leaf-a",
    session_id: "session-shared",
    space_id: "space-1",
  });
  assert.deepEqual(Object.keys(after), ["session-window-leaf-b"]);
  const ordinary = trackSessionWindowBreakout({}, { label: "session-window-session-shared" }, {
    id: "session-shared",
  });
  assert.strictEqual(removeSessionWindowBreakout(ordinary, {
    leaf_id: "leaf-a",
    session_id: "session-shared",
    space_id: "space-1",
    window_id: "session-window-leaf-a",
  }), ordinary, "closing a leaf must not untrack the ordinary window for the same session");
});

test("session window roster honesty never promotes URL or stale local state to live", () => {
  const stale = { id: "session-a", title: "Stale local row" };
  assert.deepEqual(sessionWindowRosterPresentation({
    rosterState: "pending",
    sessionId: "session-a",
    sessions: [stale],
  }), {
    mode: "unknown",
    reason: "The daemon session roster has not answered yet.",
  });
  assert.deepEqual(sessionWindowRosterPresentation({
    rosterState: "unreachable",
    reason: "roster transport failed",
    sessionId: "session-a",
    sessions: [stale],
  }), { mode: "unknown", reason: "roster transport failed" });
  assert.deepEqual(sessionWindowRosterPresentation({
    rosterState: "reachable",
    sessionId: "session-a",
    sessions: [],
  }), { mode: "tombstone" });
  assert.deepEqual(sessionWindowRosterPresentation({
    rosterState: "reachable",
    sessionId: "session-a",
    sessions: [stale],
  }), { mode: "live", session: stale });
});

test("breakout refresh routing follows roster and exact saved-space authorities", () => {
  assert.equal(sessionWindowShouldRefresh({}, { scope: "sessions" }), true);
  assert.equal(sessionWindowShouldRefresh({ spaceId: "space-a" }, { scope: "sessions" }), true);
  assert.equal(sessionWindowShouldRefresh(
    { spaceId: "space-a" },
    { scope: "space", space_id: "space-a" },
  ), true);
  assert.equal(sessionWindowShouldRefresh(
    { spaceId: "space-a" },
    { scope: "space", space_id: "space-b" },
  ), false);
  assert.equal(sessionWindowShouldRefresh({}, { scope: "space", space_id: "space-a" }), false);
});

test("space host renders non-live cards with the current canonical leaf session", async () => {
  const {
    default: SessionWindowHost,
    resolveSessionWindowLeafTarget,
  } = await sessionWindowHostModule();
  const record = singleLeafSpaceRecord("session-b");
  const tombstone = resolveSessionWindowLeafTarget({
    leafId: "leaf-current",
    record,
    sessions: [{ id: "session-a", title: "Original URL session" }],
    sessionsRead: { ok: true, rows: [{ id: "session-a" }] },
  });
  assert.equal(tombstone.mode, "tombstone");
  const tombstoneMarkup = renderSessionWindowHostState(SessionWindowHost, tombstone);
  assert.match(tombstoneMarkup, /data-tone="tombstone" role="status"/);
  assert.match(
    tombstoneMarkup,
    /The published session roster no longer lists “session-b”\./,
  );
  assert.doesNotMatch(tombstoneMarkup, /session-a/);

  const unknown = resolveSessionWindowLeafTarget({
    leafId: "leaf-current",
    record,
    sessions: [],
    sessionsRead: { ok: false, error: new Error("roster transport failed") },
  });
  assert.equal(unknown.mode, "unknown");
  const unknownMarkup = renderSessionWindowHostState(SessionWindowHost, unknown);
  assert.match(unknownMarkup, /data-tone="unknown" role="status"/);
  assert.match(unknownMarkup, /The current saved leaf refers to “session-b”\./);
  assert.doesNotMatch(unknownMarkup, /session-a/);
});

test("Return asks main to restore the target and then closes the native child", async () => {
  const { returnSessionWindowToMain } = await sessionWindowHostModule();
  const calls = [];
  await returnSessionWindowToMain(
    async (control) => { calls.push(`control:${control}`); },
    { close: async () => { calls.push("native:close"); } },
  );
  assert.deepEqual(calls, ["control:return", "native:close"]);

  const host = source("./SessionWindowHost.jsx");
  assert.doesNotMatch(
    host,
    /beforeunload|SESSION_WINDOW_CLOSED_EVENT/,
    "browser or React teardown must not publish a synthetic native close",
  );
  const shell = readFileSync(new URL("../app/AppShell.jsx", import.meta.url), "utf8");
  const controlStart = shell.indexOf("listen(SESSION_WINDOW_CONTROL_EVENT");
  const controlEnd = shell.indexOf("}).then((stop) => {", controlStart);
  assert.ok(controlStart >= 0 && controlEnd > controlStart, "Return control listener must exist");
  const controlListener = shell.slice(controlStart, controlEnd);
  assert.doesNotMatch(
    controlListener,
    /removeSessionWindowBreakout|removeSpaceWindowBreakoutOp/,
    "Return control must not clear tracking before native absence is confirmed",
  );
});

test("Return routing enters the originating space before focusing its exact leaf", async () => {
  const calls = [];
  const returned = await returnSessionWindowToSpaceLeaf({
    enterSpace: async (spaceId) => { calls.push(`enter:${spaceId}`); return true; },
    focusLeaf: (leafId) => { calls.push(`focus:${leafId}`); },
    leafId: "leaf-exact",
    spaceId: "space-origin",
  });
  assert.equal(returned, true);
  assert.deepEqual(calls, ["enter:space-origin", "focus:leaf-exact"]);

  const failedCalls = [];
  const failed = await returnSessionWindowToSpaceLeaf({
    enterSpace: async (spaceId) => { failedCalls.push(`enter:${spaceId}`); return false; },
    focusLeaf: (leafId) => { failedCalls.push(`focus:${leafId}`); },
    leafId: "leaf-must-not-focus",
    spaceId: "space-failed",
  });
  assert.equal(failed, false);
  assert.deepEqual(failedCalls, ["enter:space-failed"]);

  const shell = readFileSync(new URL("../app/AppShell.jsx", import.meta.url), "utf8");
  const controlStart = shell.indexOf("listen(SESSION_WINDOW_CONTROL_EVENT");
  const controlEnd = shell.indexOf("}).then((stop) => {", controlStart);
  assert.ok(controlStart >= 0 && controlEnd > controlStart, "Return control listener must exist");
  assert.match(
    shell.slice(controlStart, controlEnd),
    /enterSpaceFromRail\(spaceBreakout\.spaceId, spaceBreakout\.leafId\)/,
    "Return control must route the tracked originating space and exact leaf",
  );
});

test("breakout authority refresh bridge reaches hosts after roster reads and saved layouts", () => {
  const host = source("./SessionWindowHost.jsx");
  const spacesHook = source("./useSpaces.js");
  const shell = readFileSync(new URL("../app/AppShell.jsx", import.meta.url), "utf8");
  const saveStart = spacesHook.indexOf('const record = await invoke("space_save_layout"');
  const saveEnd = spacesHook.indexOf("if (record?.id)", saveStart);
  const successfulSaveBlock = spacesHook.slice(saveStart, saveEnd);
  assert.match(host, /listen\(SESSION_WINDOW_REFRESH_EVENT/);
  assert.match(host, /sessionWindowShouldRefresh\(params, event\?\.payload\)/);
  assert.match(shell, /emit\(SESSION_WINDOW_REFRESH_EVENT, \{ scope: "sessions" \}\)/);
  assert.match(successfulSaveBlock, /emit\(SESSION_WINDOW_REFRESH_EVENT, \{\s*scope: "space"/);
});

test("newer same-space Return intent supersedes an older entry still flushing", async () => {
  const intents = createSpaceEntryIntentSequence();
  const flushGate = deferred();
  const activated = [];
  const loaded = [];
  const pendingEnterB = resolveLatestSpaceEntryIntent({
    activeSpaceId: "space-a",
    activeSpaceState: { focusedLeaf: "leaf-a" },
    activate: (spaceId) => activated.push(spaceId),
    flush: async () => flushGate.promise,
    intents,
    load: async (spaceId) => { loaded.push(spaceId); return { id: spaceId }; },
    spaceId: "space-b",
  });

  const returnToA = await resolveLatestSpaceEntryIntent({
    activeSpaceId: "space-a",
    activeSpaceState: { focusedLeaf: "leaf-a" },
    activate: (spaceId) => activated.push(spaceId),
    flush: async () => {},
    intents,
    load: async (spaceId) => { loaded.push(spaceId); return { id: spaceId }; },
    spaceId: "space-a",
  });
  flushGate.resolve();

  assert.equal(returnToA.status, "current");
  assert.equal((await pendingEnterB).status, "superseded");
  assert.deepEqual(activated, [], "the stale B continuation must never activate B");
  assert.deepEqual(loaded, [], "the stale B continuation must never read B");

  const commitIntents = createSpaceEntryIntentSequence();
  const resolved = await resolveLatestSpaceEntryIntent({
    activeSpaceId: "",
    activeSpaceState: null,
    activate: () => {},
    intents: commitIntents,
    load: async () => ({ id: "space-loaded" }),
    spaceId: "space-loaded",
  });
  assert.equal(resolved.status, "loaded");
  commitIntents.begin();
  const published = [];
  const committed = commitLatestSpaceEntryIntent({
    commit: (resolution) => { published.push(resolution.record.id); return true; },
    intents: commitIntents,
    resolution: resolved,
  });
  assert.equal(committed, false);
  assert.deepEqual(
    published,
    [],
    "a newer intent after resolution must prevent the stale result from publishing",
  );
});

test("native existence gate refuses to track a window already gone", async () => {
  const guard = createSessionWindowIncarnationGuard();
  const tracked = [];
  const incarnation = await trackSessionWindowAfterNativeCheck({
    guard,
    label: "session-window-gone",
    nativeExists: async () => false,
    track: (token) => tracked.push(token),
  });
  assert.equal(incarnation, null);
  assert.deepEqual(tracked, []);
});

test("native liveness and incarnation guard preserve a newer reopened window", async () => {
  const guard = createSessionWindowIncarnationGuard();
  const label = "session-window-stable-label";
  let breakouts = {};
  const track = async (sessionId) => trackSessionWindowAfterNativeCheck({
    guard,
    label,
    nativeExists: async () => true,
    track: (token) => {
      breakouts = trackSessionWindowBreakout(
        breakouts,
        { incarnation: token, label },
        { id: sessionId },
      );
    },
  });

  const firstIncarnation = await track("session-old");
  let removalCalls = 0;
  const pageTeardownReport = await removeSessionWindowAfterNativeCheck({
    guard,
    label,
    nativeExists: async () => true,
    remove: () => { removalCalls += 1; },
  });
  assert.equal(pageTeardownReport, false, "an existing native window must remain tracked");
  assert.equal(breakouts[label].sessionId, "session-old");

  const staleGoneGate = deferred();
  const staleDestroyed = removeSessionWindowAfterNativeCheck({
    guard,
    label,
    nativeExists: async () => {
      await staleGoneGate.promise;
      return false;
    },
    remove: () => {
      removalCalls += 1;
      breakouts = removeSessionWindowBreakout(breakouts, { window_id: label });
    },
  });
  const reopenedIncarnation = await track("session-new");
  assert.ok(reopenedIncarnation > firstIncarnation);
  staleGoneGate.resolve();
  assert.equal(await staleDestroyed, false);
  assert.equal(removalCalls, 0, "the old Destroyed continuation must not remove the reopen");
  assert.equal(breakouts[label].sessionId, "session-new");
  assert.equal(breakouts[label].incarnation, reopenedIncarnation);

  const confirmedGone = await removeSessionWindowAfterNativeCheck({
    guard,
    label,
    nativeExists: async () => false,
    remove: () => {
      removalCalls += 1;
      breakouts = removeSessionWindowBreakout(breakouts, { window_id: label });
    },
  });
  assert.equal(confirmedGone, true);
  assert.equal(removalCalls, 1);
  assert.deepEqual(breakouts, {});

  await track("session-prior-to-failed-reopen");
  assert.equal(breakouts[label].sessionId, "session-prior-to-failed-reopen");
  const failedReopen = await trackSessionWindowAfterNativeCheck({
    guard,
    label,
    nativeExists: async () => false,
    remove: () => {
      removalCalls += 1;
      breakouts = removeSessionWindowBreakout(breakouts, { window_id: label });
    },
    track: () => assert.fail("a confirmed-gone reopen must never track"),
  });
  assert.equal(failedReopen, null);
  assert.equal(removalCalls, 2);
  assert.deepEqual(
    breakouts,
    {},
    "the false open gate owns cleanup of tracking left by the previous incarnation",
  );

  const updaterGuard = createSessionWindowIncarnationGuard();
  const updaterLabel = "session-window-deferred-updater";
  let deferredUpdater = null;
  let updaterTrackCalls = 0;
  const updaterIncarnation = await trackSessionWindowAfterNativeCheck({
    guard: updaterGuard,
    label: updaterLabel,
    nativeExists: async () => true,
    track: (token) => {
      deferredUpdater = (current) => trackSessionWindowStateIfCurrent({
        current,
        isCurrent: () => updaterGuard.isCurrent(updaterLabel, token),
        track: (latest) => {
          updaterTrackCalls += 1;
          return trackSessionWindowBreakout(
            latest,
            { incarnation: token, label: updaterLabel },
            { id: "session-stale-readd" },
          );
        },
      });
    },
  });
  const currentTokenOne = trackSessionWindowBreakout(
    {},
    { incarnation: updaterIncarnation, label: updaterLabel },
    { id: "session-current-token-one" },
  );
  const invalidatedBeforeCommit = await removeSessionWindowAfterNativeCheck({
    guard: updaterGuard,
    label: updaterLabel,
    nativeExists: async () => false,
    remove: () => {},
  });
  assert.equal(invalidatedBeforeCommit, true);
  assert.equal(typeof deferredUpdater, "function");
  const afterDeferredUpdater = deferredUpdater(currentTokenOne);
  assert.strictEqual(
    afterDeferredUpdater,
    currentTokenOne,
    "an updater deferred past native invalidation must return the identical current state",
  );
  assert.equal(updaterTrackCalls, 0, "the stale updater must not invoke its tracking mutation");
});

test("session header pop-out affordance calls its production command prop", async () => {
  const [{ default: React }, { default: SessionSurface }] = await Promise.all([
    import("react"),
    sessionSurfaceModule(),
  ]);
  const session = {
    id: "session-clicked",
    provider: "openai",
    provider_session_id: "provider-clicked",
    status: "idle",
    title: "Clicked session",
  };
  const calls = [];
  const tree = renderFunctionComponent(React, () => SessionSurface({
    activeSessionId: session.id,
    draftOpen: false,
    onPopOutSession: (selected) => calls.push(selected),
    openSessions: [session],
    sessions: [session],
  }));
  const affordance = findElement(
    tree,
    (element) => element.props?.["aria-label"] === "Pop out session",
  );
  assert.ok(affordance, "the active session header must expose its pop-out affordance");
  affordance.props.onClick();
  assert.deepEqual(calls, [session]);
});

import assert from "node:assert/strict";
import test from "node:test";
import React from "react";

/* F9 Phase 1 pins: SessionView is the ONE session view every host mounts. It
   genuinely renders the one-line header (Chat/Shell/Traj toggle + gear anchor),
   the active view's real content (SessionTranscript), and the composer — not as
   opaque children but as its own JSX driven by an explicit props contract — and
   standalone SessionSurface delegates each of its panes to it with that wiring
   intact. Rendered with the house fake-hook harness (node --test has no DOM):
   component identities are compared against the returned element tree, so the
   leaf components stay elements (never deep-rendered) and the pin turns on
   SessionView's own structure. */

function renderFunctionComponent(reactRef, render, {
  memoValues = new Map(),
  stateValues = new Map(),
} = {}) {
  const internals = reactRef.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
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
    useId() { id += 1; return `session-view-test-${id}`; },
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

async function sessionGraph() {
  const { createServer } = await import("vite");
  const server = await createServer({
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    ssr: { noExternal: ["styled-components", /^@xterm\//] },
  });
  try {
    const [surface, view, settingsMenu, composer, transcript] = await Promise.all([
      server.ssrLoadModule("/src/sessions/SessionSurface.jsx"),
      server.ssrLoadModule("/src/sessions/SessionView.jsx"),
      server.ssrLoadModule("/src/sessions/SessionSettingsMenu.jsx"),
      server.ssrLoadModule("/src/sessions/SessionComposer.jsx"),
      server.ssrLoadModule("/src/sessions/SessionTranscript.jsx"),
    ]);
    return { surface, view, settingsMenu, composer, transcript };
  } finally {
    await server.close();
  }
}

const SESSION = {
  id: "session-view-pane",
  provider: "haider",
  provider_session_id: "provider-view-pane",
  status: "idle",
  title: "Pane view session",
};

test("[pin] SessionView renders the Chat/Shell/Traj toggle, the active view content, and the composer for the chat mode", async () => {
  const { view, settingsMenu, composer, transcript } = await sessionGraph();
  const SessionView = view.default;
  const SessionViewToggle = settingsMenu.SessionViewToggle;
  const SessionComposer = composer.default;
  const SessionTranscript = transcript.default;

  const tree = renderFunctionComponent(React, () => SessionView({
    active: true,
    session: SESSION,
    mode: "ui",
    chatTabActive: true,
    onPopOutSession: () => {},
    runStatusView: {
      authority: "activity",
      source: "roster",
      structuredStatus: "absent",
      label: "",
    },
  }));

  assert.ok(findElement(tree, (element) => element.type === SessionViewToggle),
    "SessionView must render the Chat/Shell/Traj toggle");
  assert.ok(findElement(tree, (element) => element.type === SessionTranscript),
    "SessionView must render the active view's real content (the transcript)");
  assert.ok(findElement(tree, (element) => element.type === SessionComposer),
    "SessionView must render the composer — dropping it from the pane fails here");
  assert.ok(
    findElement(tree, (element) => element.props?.["aria-label"] === "Pop out session"),
    "SessionView must render the one-line header (its pop-out affordance)",
  );
});

test("[pin] standalone SessionSurface delegates each open pane to SessionView with live wiring", async () => {
  const { surface, view } = await sessionGraph();
  const SessionSurface = surface.default;
  const SessionView = view.default;

  const tree = renderFunctionComponent(React, () => SessionSurface({
    activeSessionId: SESSION.id,
    draftOpen: false,
    onPopOutSession: () => {},
    openSessions: [SESSION],
    sessions: [SESSION],
  }));

  const pane = findElement(tree, (element) => element.type === SessionView);
  assert.ok(pane, "SessionSurface must render each open session pane through SessionView");
  assert.equal(pane.props.session, SESSION,
    "the pane must be delegated the exact session it renders");
  assert.equal(pane.props.active, true,
    "the active session's pane must be delegated with active=true");
  assert.equal(typeof pane.props.onSubmit, "function",
    "SessionSurface must wire the composer submit into the delegated pane");
  assert.equal(typeof pane.props.renderAgentSurface, "function",
    "SessionSurface must hand the gear's agent-settings surfaces into the pane");
});

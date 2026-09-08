import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";

import {
  buildSessionViewProps,
  buildSpaceLeafSessionViewProps,
  sessionViewModeForViewKind,
  spaceLeafViewKindForMode,
} from "./sessionViewController.js";
import {
  createSpaceLeaf,
  createSpaceStack,
  createSpaceState,
} from "./spacesModel.js";
import { reachableSpacesRoster, reconcileSpaceState } from "./spacesController.js";

/* F9 Phase 2 pins: a space leaf renders the REAL shared SessionView (body
   only) for chat, shell, AND traj — the shell mounts the real SessionTerminal
   (PTY), killing the "Shell view not rendered in spaces yet" placeholder.
   Rendered with the house fake-hook harness (node --test has no DOM): the leaf
   components stay elements (never deep-rendered), so the pins turn on the real
   component structure the surface mounts. */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

function renderFunctionComponent(reactRef, render) {
  const internals = reactRef.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previousDispatcher = internals.H;
  let id = 0;
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
    useId() { id += 1; return `space-view-test-${id}`; },
    useImperativeHandle() {},
    useInsertionEffect() {},
    useLayoutEffect() {},
    useMemo(factory) { return factory(); },
    useMemoCache(size) { return Array(size).fill(Symbol.for("react.memo_cache_sentinel")); },
    useOptimistic(value) { return [value, () => {}]; },
    useReducer(_reducer, initial, initialize) {
      return [initialize ? initialize(initial) : initial, () => {}];
    },
    useRef(initial) { return { current: initial }; },
    useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; },
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

async function spaceGraph() {
  const { createServer } = await import("vite");
  const server = await createServer({
    appType: "custom",
    logLevel: "silent",
    optimizeDeps: { noDiscovery: true },
    server: { middlewareMode: true },
    ssr: { noExternal: ["styled-components", /^@xterm\//] },
  });
  try {
    const [space, view, terminal, transcript, trajectory, composer] = await Promise.all([
      server.ssrLoadModule("/src/sessions/SpaceSurface.jsx"),
      server.ssrLoadModule("/src/sessions/SessionView.jsx"),
      server.ssrLoadModule("/src/sessions/SessionTerminal.jsx"),
      server.ssrLoadModule("/src/sessions/SessionTranscript.jsx"),
      server.ssrLoadModule("/src/sessions/SessionTrajectory.jsx"),
      server.ssrLoadModule("/src/sessions/SessionComposer.jsx"),
    ]);
    return { space, view, terminal, transcript, trajectory, composer };
  } finally {
    await server.close();
  }
}

const SESSION = {
  id: "session-space-leaf",
  provider: "haider",
  provider_session_id: "provider-space-leaf",
  status: "idle",
  title: "Space leaf session",
};

/* A one-stack space whose single live leaf shows `viewKind`. Built through the
   real model (reconciliation supplies the live renderState) so the surface's
   own presentation/focus authority reads it exactly as in the app. */
function liveSpaceState(viewKind) {
  const leaf = createSpaceLeaf({ id: "leaf-1", sessionRef: SESSION.id, viewKind });
  const root = createSpaceStack("stack-1", [leaf], "leaf-1");
  const state = createSpaceState({ members: [SESSION.id], root, focusedLeaf: "leaf-1" });
  return reconcileSpaceState(state, reachableSpacesRoster([SESSION.id]));
}

function renderSpaceLeafPane(SpaceSurface, SessionView, viewKind) {
  const tree = renderFunctionComponent(React, () => SpaceSurface({
    space: { id: "space-1", name: "Space One" },
    state: liveSpaceState(viewKind),
    sessions: [SESSION],
    onSetLeafView: () => {},
    onSelectTab: () => {},
    onFocusLeaf: () => {},
    onCloseLeaf: () => {},
    onDragOutLeaf: () => {},
    onExitSpace: () => {},
    onPopOutLeaf: () => {},
  }));
  const pane = findElement(tree, (element) => element.type === SessionView);
  return pane;
}

test("[pin] a live space SHELL leaf mounts the real SessionView + SessionTerminal (no placeholder)", async () => {
  const { space, view, terminal } = await spaceGraph();
  const SpaceSurface = space.default;
  const SessionView = view.default;
  const SessionTerminal = terminal.default;

  const pane = renderSpaceLeafPane(SpaceSurface, SessionView, "shell");
  assert.ok(pane, "the shell leaf must delegate to the shared SessionView, not a placeholder card");
  assert.equal(pane.props.session, SESSION, "the pane must render this leaf's exact session");
  assert.equal(pane.props.mode, "terminal", "a shell leaf must drive SessionView's terminal mode");
  assert.equal(pane.props.showHeader, false,
    "the space header owns identity/toggle; the leaf mounts the body only");
  assert.equal(pane.props.active, true, "a rendered leaf is visible, so its pane is active");

  // SessionView has no hooks — invoke it directly to inspect its subtree.
  const viewTree = SessionView(pane.props);
  assert.ok(
    findElement(viewTree, (element) => element.type === SessionTerminal),
    "the shell leaf's SessionView MUST mount the real SessionTerminal (PTY) — "
      + "dropping it from the space path fails here",
  );
});

test("[pin] a space leaf's composer RENDERS with the controller's chip defaults (no null crash)", async () => {
  const { space, view, composer } = await spaceGraph();
  const SpaceSurface = space.default;
  const SessionView = view.default;
  const SessionComposer = composer.default;

  const pane = renderSpaceLeafPane(SpaceSurface, SessionView, "chat");
  const viewTree = SessionView(pane.props);
  const composerEl = findElement(viewTree, (element) => element.type === SessionComposer);
  assert.ok(composerEl, "the chat leaf must mount the real composer");

  /* Deep-render the composer with EXACTLY the props SessionView hands it. The
     composer dereferences chipOptions/chipValues DURING render (chipOptions[key],
     chipOptions.speedApplicable, chipValues.model), so a null default from the
     controller crashes here — an empty-object default renders. The shallower
     element-identity pins never execute the composer body, so they miss it. */
  let rendered = null;
  assert.doesNotThrow(() => {
    rendered = renderFunctionComponent(React, () => SessionComposer(composerEl.props));
  }, "the space-leaf composer must render with the controller's honest chip defaults, not crash");
  assert.ok(rendered && typeof rendered === "object",
    "the composer must produce a real element tree from the leaf's props");
});

test("[pin] a live space CHAT leaf renders the real transcript + composer through SessionView", async () => {
  const { space, view, transcript, composer } = await spaceGraph();
  const SpaceSurface = space.default;
  const SessionView = view.default;
  const SessionTranscript = transcript.default;
  const SessionComposer = composer.default;

  const pane = renderSpaceLeafPane(SpaceSurface, SessionView, "chat");
  assert.ok(pane, "the chat leaf must delegate to the shared SessionView");
  assert.equal(pane.props.mode, "ui", "a chat leaf must drive SessionView's chat (ui) mode");
  assert.equal(typeof pane.props.onSubmit, "function",
    "the space surface must wire the controlled composer submit into the pane");

  const viewTree = SessionView(pane.props);
  assert.ok(findElement(viewTree, (element) => element.type === SessionTranscript),
    "the chat leaf's SessionView must render the real transcript");
  assert.ok(findElement(viewTree, (element) => element.type === SessionComposer),
    "the chat leaf's SessionView must render the real composer");
});

test("[pin] a live space TRAJ leaf renders the real trajectory through SessionView", async () => {
  const { space, view, trajectory } = await spaceGraph();
  const SpaceSurface = space.default;
  const SessionView = view.default;
  const SessionTrajectory = trajectory.default;

  const pane = renderSpaceLeafPane(SpaceSurface, SessionView, "trajectory");
  assert.ok(pane, "the traj leaf must delegate to the shared SessionView");
  assert.equal(pane.props.mode, "trajectory", "a traj leaf must drive SessionView's trajectory mode");

  const viewTree = SessionView(pane.props);
  assert.ok(findElement(viewTree, (element) => element.type === SessionTrajectory),
    "the traj leaf's SessionView must render the real trajectory");
});

test("[pin] the shared controller maps view kinds and defaults SessionView's contract honestly", () => {
  assert.equal(sessionViewModeForViewKind("chat"), "ui");
  assert.equal(sessionViewModeForViewKind("shell"), "terminal");
  assert.equal(sessionViewModeForViewKind("trajectory"), "trajectory");
  assert.equal(sessionViewModeForViewKind("bogus"), "ui", "an unknown view kind falls back to chat");
  assert.equal(spaceLeafViewKindForMode("terminal"), "shell", "shell is the terminal mode's view kind");

  // A minimal call still yields a complete, honest bundle (no fake queue/status).
  const props = buildSessionViewProps(SESSION, { mode: "terminal" });
  assert.equal(props.session, SESSION);
  assert.equal(props.mode, "terminal");
  assert.equal(props.showHeader, true, "default keeps the header (standalone is unchanged)");
  assert.equal(props.queueState, null, "no fabricated queue in a lean host");
  assert.equal(props.surfaceStatusForSession, null, "no fabricated surface status");
  assert.ok(props.runStatusView && typeof props.runStatusView === "object",
    "runStatusView is always an object so the chat layer never reads null.authority");

  // The space-leaf context turns the header off and wires only what it owns.
  const selected = [];
  const leaf = { id: "leaf-9", sessionRef: SESSION.id, viewKind: "shell" };
  const attachments = [{ path: "/tmp/diffforge-paste-1.png" }];
  const onAttachmentsChange = () => {};
  const leafProps = buildSpaceLeafSessionViewProps(SESSION, leaf, {
    onSetLeafView: (leafId, viewKind) => selected.push([leafId, viewKind]),
    composerValue: "hello",
    onSubmit: () => true,
    composerAttachments: attachments,
    onAttachmentsChange,
  });
  assert.equal(leafProps.showHeader, false, "a space leaf mounts the body only");
  assert.equal(leafProps.active, true);
  assert.equal(leafProps.mode, "terminal");
  assert.equal(leafProps.composerValue, "hello", "the leaf's controlled draft rides through");
  assert.equal(typeof leafProps.onSubmit, "function");
  /* Teeth for the controlled-attachment guarantee ACROSS the builder bridge:
     the leaf's staged attachments and its change callback must be the exact
     ones handed in — dropping the builder's attachment forwarding fails here. */
  assert.equal(leafProps.composerAttachments, attachments,
    "the leaf's staged attachments must be forwarded through the builder to the composer");
  assert.equal(leafProps.onAttachmentsChange, onAttachmentsChange,
    "the attachment-change callback must be forwarded through the builder");
  leafProps.onSelectView("trajectory");
  assert.deepEqual(selected, [["leaf-9", "trajectory"]],
    "selecting a view maps the SessionView mode back to the leaf's spaces view kind");
});

test("[pin] the placeholder is gone and the surface delegates live leaves to SessionView", () => {
  const surface = read("./SpaceSurface.jsx");
  assert.doesNotMatch(surface, /Shell view not rendered in spaces yet/,
    "the shell placeholder must be removed — spaces mount the real shell now");
  assert.match(surface, /import SessionView from "\.\/SessionView\.jsx"/,
    "SpaceSurface must import the shared SessionView");
  assert.match(surface, /buildSpaceLeafSessionViewProps\(session, leaf, \{/,
    "a live leaf must be delegated to SessionView through the shared controller");

  // Preservation: standalone's SessionView contract still carries the header on
  // by default, so its panes are unchanged by this phase.
  const view = read("./SessionView.jsx");
  assert.match(view, /showHeader = true/,
    "showHeader defaults on so standalone/draft/home panes stay byte-identical");
  assert.match(view, /\{showHeader && workHeader\}/,
    "only an explicit showHeader=false (a space leaf) drops the header row");
});

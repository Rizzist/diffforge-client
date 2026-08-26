import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  addSpaceMember,
  applySpaceReconciliation,
  closeSpaceLeaf,
  createSpaceLeaf,
  createSpaceSplit,
  createSpaceStack,
  createSpaceState,
  deserializeSpaceLayout,
  dragOutSpaceLeaf,
  emptySpaceState,
  focusedSpaceSessionRef,
  focusSpaceLeaf,
  openSpaceLeaf,
  removeSpaceMember,
  revealOrOpenSpaceSession,
  serializeSpaceLayout,
  setSpaceActiveTab,
  SpaceLayoutCanonicalDivergenceError,
  spaceLeafCount,
  spaceLeafIds,
  spaceWindowLeaves,
} from "./spacesModel.js";

function leaf(id, sessionRef, viewKind = "chat") {
  return createSpaceLeaf({ id, sessionRef, viewKind });
}

function stack(id, tabs, active = tabs[0].id) {
  return createSpaceStack(id, tabs, active);
}

function splitState() {
  return createSpaceState({
    members: ["session-a", "session-b", "session-c"],
    root: createSpaceSplit("split-main", "horizontal", [
      stack("stack-left", [leaf("leaf-a", "session-a"), leaf("leaf-b", "session-b")]),
      stack("stack-right", [leaf("leaf-c", "session-c")]),
    ], [2, 1]),
    focusedLeaf: "leaf-c",
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test("empty, open, close, active-tab, and degenerate merge keep focus valid", () => {
  let state = openSpaceLeaf(emptySpaceState(), leaf("leaf-a", "session-a"), {
    initialStackId: "stack-main",
  });
  state = openSpaceLeaf(state, leaf("leaf-b", "session-b"));
  assert.equal(state.focusedLeaf, "leaf-b");
  assert.equal(state.root.active, "leaf-b");

  state = setSpaceActiveTab(state, "stack-main", "leaf-a");
  assert.equal(state.focusedLeaf, "leaf-a");
  state = closeSpaceLeaf(state, "leaf-a");
  assert.equal(state.focusedLeaf, "leaf-b");
  assert.equal(state.root.active, "leaf-b");
  assert.deepEqual(state.members, ["session-a", "session-b"]);

  state = closeSpaceLeaf(state, "leaf-b");
  assert.equal(state.root, null);
  assert.equal(state.focusedLeaf, null);
  assert.deepEqual(state.members, ["session-a", "session-b"]);
});

test("reveal-or-open focuses an existing view and otherwise opens in the focused stack", () => {
  const initial = splitState();
  const revealed = revealOrOpenSpaceSession(initial, "session-a");
  assert.equal(revealed.focusedLeaf, "leaf-a");
  assert.equal(revealed.root.children[0].active, "leaf-a");
  assert.equal(spaceLeafCount(revealed), 3);

  const opened = revealOrOpenSpaceSession(revealed, "session-new", {
    leafId: "leaf-new",
  });
  assert.equal(opened.focusedLeaf, "leaf-new");
  assert.equal(opened.root.children[0].active, "leaf-new");
  assert.deepEqual(opened.members, ["session-a", "session-b", "session-c", "session-new"]);
});

test("membership removal is explicit while leaf close and reconciliation preserve it", () => {
  const original = splitState();
  const closed = closeSpaceLeaf(original, "leaf-a");
  assert.deepEqual(closed.members, original.members);

  const marked = applySpaceReconciliation(original, [
    { leaf_id: "leaf-a", session_ref: "session-a", state: "live" },
    { leaf_id: "leaf-b", session_ref: "session-b", state: "tombstone" },
    {
      leaf_id: "leaf-c",
      session_ref: "session-c",
      state: "unknown",
      reason: "daemon unavailable",
    },
  ]);
  assert.deepEqual(marked.members, original.members);
  assert.deepEqual(marked.root.children[0].tabs[1].renderState, { state: "tombstone" });
  assert.deepEqual(marked.root.children[1].tabs[0].renderState, {
    state: "unknown",
    reason: "daemon unavailable",
  });
  assert.equal(serializeSpaceLayout(marked).includes("renderState"), false);

  const removed = removeSpaceMember(marked, "session-a");
  assert.equal(removed.members.includes("session-a"), false);
  assert.equal(spaceLeafIds(removed).includes("leaf-a"), false);
  assert.strictEqual(addSpaceMember(removed, "session-a").members.includes("session-a"), true);
});

test("missing reconciliation is rendered unknown instead of fabricating liveness", () => {
  const marked = applySpaceReconciliation(splitState(), []);
  const allStates = [];
  for (const pane of marked.root.children) {
    for (const tab of pane.tabs) allStates.push(tab.renderState);
  }
  assert.ok(allStates.every((state) => state.state === "unknown"));
  assert.ok(allStates.every((state) => state.reason.includes("No reconciliation")));
});

test("[pin] constructors and open adopt reconciled leaves verbatim", () => {
  const marked = applySpaceReconciliation(splitState(), [{
    leaf_id: "leaf-a",
    session_ref: "session-a",
    state: "unknown",
    reason: "daemon-published uncertainty",
  }]);
  const reconciledLeaf = marked.root.children[0].tabs[0];
  const expectedLeaf = structuredClone(reconciledLeaf);
  const adoptedStack = createSpaceStack("stack-adopted", [reconciledLeaf]);
  const siblingStack = stack("stack-sibling", [leaf("leaf-sibling", "session-sibling")]);
  const adoptedSplit = createSpaceSplit(
    "split-adopted",
    "horizontal",
    [adoptedStack, siblingStack],
  );

  assert.deepEqual(adoptedStack.tabs[0], expectedLeaf);
  assert.strictEqual(adoptedStack.tabs[0], reconciledLeaf);
  assert.strictEqual(adoptedSplit.children[0], adoptedStack);
  assert.deepEqual(adoptedSplit.children[0].tabs[0], expectedLeaf);
  assert.strictEqual(adoptedSplit.children[0].tabs[0], reconciledLeaf);

  const opened = openSpaceLeaf(emptySpaceState(), reconciledLeaf, {
    initialStackId: "stack-opened",
  });
  assert.deepEqual(opened.root.tabs[0], expectedLeaf);
  assert.strictEqual(opened.root.tabs[0], reconciledLeaf);
});

test("[pin] rail highlight derives only from the single focused leaf", () => {
  const state = focusSpaceLeaf(splitState(), "leaf-a");
  const poisonedIndependentSelection = { ...state, railSelection: "session-c" };
  assert.equal(focusedSpaceSessionRef(poisonedIndependentSelection), "session-a");
  assert.equal(state.root.children[0].active, "leaf-a");
  assert.equal(state.focusedLeaf, "leaf-a");
});

test("[pin] save-load-save is byte-identical canonical JSON", () => {
  const state = splitState();
  const first = serializeSpaceLayout(state);
  const restored = deserializeSpaceLayout(first, state.focusedLeaf);
  const second = serializeSpaceLayout(restored);
  assert.equal(second, first);
  assert.equal(
    first,
    "{\"members\":[\"session-a\",\"session-b\",\"session-c\"],\"root\":{\"kind\":\"split\",\"id\":\"split-main\",\"direction\":\"horizontal\",\"children\":[{\"kind\":\"stack\",\"id\":\"stack-left\",\"tabs\":[{\"kind\":\"leaf\",\"id\":\"leaf-a\",\"sessionRef\":\"session-a\",\"viewKind\":\"chat\",\"viewState\":{\"activeSubTab\":null}},{\"kind\":\"leaf\",\"id\":\"leaf-b\",\"sessionRef\":\"session-b\",\"viewKind\":\"chat\",\"viewState\":{\"activeSubTab\":null}}],\"active\":\"leaf-a\"},{\"kind\":\"stack\",\"id\":\"stack-right\",\"tabs\":[{\"kind\":\"leaf\",\"id\":\"leaf-c\",\"sessionRef\":\"session-c\",\"viewKind\":\"chat\",\"viewState\":{\"activeSubTab\":null}}],\"active\":\"leaf-c\"}],\"sizes\":[2,1]}}",
  );
});

test("[pin] shared fixture is byte-identical across canonical serializers", () => {
  const fixture = readFileSync(
    new URL("../../src-tauri/tests/fixtures/spaces_canonical_layout.json", import.meta.url),
    "utf8",
  );
  const restored = deserializeSpaceLayout(fixture, "leaf-private");
  assert.equal(serializeSpaceLayout(restored), fixture);
});

test("[pin] float-form fixture bytes are rejected as a canonical divergence", () => {
  const fixture = readFileSync(
    new URL("../../src-tauri/tests/fixtures/spaces_canonical_layout.json", import.meta.url),
    "utf8",
  );
  const floatForm = fixture.replace('"sizes":[2,1]', '"sizes":[2.0,1]');
  assert.notEqual(floatForm, fixture);
  assert.throws(
    () => deserializeSpaceLayout(floatForm, "leaf-private"),
    (error) => error instanceof SpaceLayoutCanonicalDivergenceError
      && error.code === "SPACE_LAYOUT_CANONICAL_DIVERGENCE",
  );
});

test("[pin] key-reordered fixture bytes are rejected as a canonical divergence", () => {
  const fixture = readFileSync(
    new URL("../../src-tauri/tests/fixtures/spaces_canonical_layout.json", import.meta.url),
    "utf8",
  );
  const decoded = JSON.parse(fixture);
  const keyReordered = JSON.stringify({ root: decoded.root, members: decoded.members });
  assert.throws(
    () => deserializeSpaceLayout(keyReordered, "leaf-private"),
    (error) => error instanceof SpaceLayoutCanonicalDivergenceError
      && error.code === "SPACE_LAYOUT_CANONICAL_DIVERGENCE",
  );
});

test("split sizes are positive safe-integer weights and default without renormalizing", () => {
  const children = [
    stack("stack-one", [leaf("leaf-one", "session-one")]),
    stack("stack-two", [leaf("leaf-two", "session-two")]),
  ];
  assert.deepEqual(createSpaceSplit("split-default", "horizontal", children).sizes, [1, 1]);
  assert.deepEqual(createSpaceSplit("split-relative", "horizontal", children, [2, 1]).sizes, [2, 1]);
  assert.throws(
    () => createSpaceSplit("split-float", "horizontal", children, [1.5, 1]),
    /positive safe-integer weights/,
  );
  assert.throws(
    () => createSpaceSplit("split-zero", "horizontal", children, [0, 1]),
    /positive safe-integer weights/,
  );
  assert.throws(
    () => createSpaceSplit(
      "split-unsafe",
      "horizontal",
      children,
      [Number.MAX_SAFE_INTEGER + 1, 1],
    ),
    /positive safe-integer weights/,
  );
});

test("[pin] drag-out reparents without losing, duplicating, or mutating a leaf", () => {
  const unreconciled = splitState();
  unreconciled.root.children[0].tabs[1].viewState.activeSubTab = "inspector";
  const state = applySpaceReconciliation(unreconciled, [
    { leaf_id: "leaf-a", session_ref: "session-a", state: "live" },
    {
      leaf_id: "leaf-b",
      session_ref: "session-b",
      state: "unknown",
      reason: "daemon-published uncertainty",
    },
    { leaf_id: "leaf-c", session_ref: "session-c", state: "tombstone" },
  ]);
  const originalLeaf = state.root.children[0].tabs[1];
  const snapshot = structuredClone(state);
  deepFreeze(state);
  const beforeIds = spaceLeafIds(state);
  const dragged = dragOutSpaceLeaf(state, "leaf-b", "leaf-c", {
    splitId: "split-dragged",
    stackId: "stack-dragged",
    direction: "vertical",
    position: "before",
  });
  const afterIds = spaceLeafIds(dragged);

  assert.equal(spaceLeafCount(dragged), spaceLeafCount(state));
  assert.deepEqual(new Set(afterIds), new Set(beforeIds));
  assert.equal(new Set(afterIds).size, afterIds.length);
  assert.deepEqual(state, snapshot);
  assert.equal(dragged.focusedLeaf, "leaf-b");
  assert.equal(dragged.root.children[1].kind, "split");
  const movedLeaf = dragged.root.children[1].children[0].tabs[0];
  assert.deepEqual(movedLeaf, originalLeaf);
  assert.strictEqual(movedLeaf, originalLeaf);
});

test("drag-out collapses an emptied source pane and preserves the target", () => {
  const state = splitState();
  const dragged = dragOutSpaceLeaf(state, "leaf-c", "leaf-a", {
    splitId: "split-replacement",
    stackId: "stack-replacement",
  });
  assert.equal(spaceLeafCount(dragged), 3);
  assert.deepEqual(new Set(spaceLeafIds(dragged)), new Set(["leaf-a", "leaf-b", "leaf-c"]));
  assert.equal(dragged.root.id, "split-replacement");
});

test("[pin] duplicate session references within one stack are rejected", () => {
  const state = openSpaceLeaf(emptySpaceState(), leaf("leaf-a", "session-a"), {
    initialStackId: "stack-main",
  });
  assert.throws(
    () => openSpaceLeaf(state, leaf("leaf-a-copy", "session-a")),
    /duplicated within one stack/,
  );
});

test("[pin] the same session remains valid across different panes", () => {
  const state = splitState();
  const opened = openSpaceLeaf(state, leaf("leaf-a-mirror", "session-a"), {
    stackId: "stack-right",
  });
  assert.equal(spaceLeafCount(opened), 4);
  assert.equal(opened.root.children[1].tabs.at(-1).sessionRef, "session-a");
  assert.equal(opened.focusedLeaf, "leaf-a-mirror");
});

test("[pin] a space root resolves to one stable window per leaf", () => {
  const state = splitState();
  const opened = openSpaceLeaf(state, leaf("leaf-a-mirror", "session-a"), {
    stackId: "stack-right",
  });
  assert.deepEqual(
    spaceWindowLeaves(opened),
    [
      { leafId: "leaf-a", sessionId: "session-a", viewKind: "chat" },
      { leafId: "leaf-b", sessionId: "session-b", viewKind: "chat" },
      { leafId: "leaf-c", sessionId: "session-c", viewKind: "chat" },
      { leafId: "leaf-a-mirror", sessionId: "session-a", viewKind: "chat" },
    ],
  );
});

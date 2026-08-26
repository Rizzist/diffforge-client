const VIEW_KINDS = new Set(["chat", "shell", "trajectory"]);
const SPLIT_DIRECTIONS = new Set(["horizontal", "vertical"]);
const MAX_LAYOUT_NODES = 4096;

export class SpaceLayoutCanonicalDivergenceError extends Error {
  constructor() {
    super("Space layout canonical-byte divergence: input bytes differ from canonical serialization.");
    this.name = "SpaceLayoutCanonicalDivergenceError";
    this.code = "SPACE_LAYOUT_CANONICAL_DIVERGENCE";
  }
}

function requireTrimmed(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be a non-empty, already-trimmed string.`);
  }
  return value;
}

function canonicalViewState(viewState = {}) {
  const activeSubTab = viewState?.activeSubTab == null
    ? null
    : requireTrimmed(viewState.activeSubTab, "activeSubTab");
  return { activeSubTab };
}

function compareUnicodeCodePoints(left, right) {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex);
    const rightPoint = right.codePointAt(rightIndex);
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return left.length - right.length;
}

function sortedMembers(members) {
  return [...members].sort(compareUnicodeCodePoints);
}

function validateSplitWeights(sizes, childCount) {
  if (!Array.isArray(sizes) || sizes.length !== childCount) {
    throw new Error("Split sizes must have one value per child.");
  }
  if (sizes.some((size) => !Number.isSafeInteger(size) || size <= 0)) {
    throw new Error("Split sizes must be positive safe-integer weights.");
  }
}

export function createSpaceLeaf({
  id,
  sessionRef,
  viewKind = "chat",
  viewState = {},
} = {}) {
  requireTrimmed(id, "Leaf id");
  requireTrimmed(sessionRef, "Leaf sessionRef");
  if (!VIEW_KINDS.has(viewKind)) {
    throw new Error(`Unsupported leaf viewKind '${viewKind}'.`);
  }
  return {
    kind: "leaf",
    id,
    sessionRef,
    viewKind,
    viewState: canonicalViewState(viewState),
  };
}

export function createSpaceStack(id, tabs, active = null) {
  requireTrimmed(id, "Stack id");
  if (!Array.isArray(tabs) || tabs.length === 0) {
    throw new Error("A stack must contain at least one leaf.");
  }
  const stack = {
    kind: "stack",
    id,
    tabs: [...tabs],
    active: active == null ? tabs[0]?.id : requireTrimmed(active, "Active leaf id"),
  };
  validateNode(stack, { nodeIds: new Set(), leafIds: new Set(), leafSessionRefs: [] }, false);
  return stack;
}

export function createSpaceSplit(id, direction, children, sizes = null) {
  requireTrimmed(id, "Split id");
  if (!SPLIT_DIRECTIONS.has(direction)) {
    throw new Error(`Unsupported split direction '${direction}'.`);
  }
  if (!Array.isArray(children) || children.length < 2) {
    throw new Error("A split must contain at least two children.");
  }
  const weights = sizes == null ? children.map(() => 1) : sizes;
  validateSplitWeights(weights, children.length);
  const split = {
    kind: "split",
    id,
    direction,
    children: [...children],
    sizes: [...weights],
  };
  validateNode(split, { nodeIds: new Set(), leafIds: new Set(), leafSessionRefs: [] }, false);
  return split;
}

function visitLeaves(node, visitor) {
  if (!node) return;
  if (node.kind === "leaf") {
    visitor(node);
    return;
  }
  const children = node.kind === "stack" ? node.tabs : node.children;
  for (const child of children) visitLeaves(child, visitor);
}

function visitNodes(node, visitor) {
  if (!node) return;
  visitor(node);
  if (node.kind === "stack") {
    for (const tab of node.tabs) visitNodes(tab, visitor);
  } else if (node.kind === "split") {
    for (const child of node.children) visitNodes(child, visitor);
  }
}

export function spaceLeafIds(state) {
  const ids = [];
  visitLeaves(state?.root ?? null, (leaf) => ids.push(leaf.id));
  return ids;
}

/* A space root is a window SET, not a second layout model. Preserve every
   leaf coordinate in traversal order: the same session may intentionally
   appear in multiple panes and each leaf owns a distinct native window. */
export function spaceWindowLeaves(state) {
  validateSpaceState(state);
  const leaves = [];
  visitLeaves(state.root, (leaf) => {
    leaves.push({
      leafId: leaf.id,
      sessionId: leaf.sessionRef,
      viewKind: leaf.viewKind,
    });
  });
  return leaves;
}

export function spaceLeafCount(state) {
  return spaceLeafIds(state).length;
}

function findLeaf(root, leafId) {
  let found = null;
  visitLeaves(root, (leaf) => {
    if (found == null && leaf.id === leafId) found = leaf;
  });
  return found;
}

function findFirstLeafForSession(root, sessionRef) {
  let found = null;
  visitLeaves(root, (leaf) => {
    if (found == null && leaf.sessionRef === sessionRef) found = leaf;
  });
  return found;
}

function findNode(root, nodeId) {
  let found = null;
  visitNodes(root, (node) => {
    if (found == null && node.id === nodeId) found = node;
  });
  return found;
}

function findStackForLeaf(node, leafId) {
  if (!node) return null;
  if (node.kind === "stack") {
    return node.tabs.some((tab) => tab.id === leafId) ? node : null;
  }
  if (node.kind === "split") {
    for (const child of node.children) {
      const stack = findStackForLeaf(child, leafId);
      if (stack) return stack;
    }
  }
  return null;
}

function firstActiveLeafId(node) {
  if (!node) return null;
  if (node.kind === "stack") return node.active;
  if (node.kind === "split") {
    for (const child of node.children) {
      const leafId = firstActiveLeafId(child);
      if (leafId) return leafId;
    }
  }
  return null;
}

function validateNode(node, context, leafAllowed = false) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new Error("Every layout node must be an object.");
  }
  if (context.nodeIds.size >= MAX_LAYOUT_NODES) {
    throw new Error(`A space layout may contain at most ${MAX_LAYOUT_NODES} nodes.`);
  }
  requireTrimmed(node.id, "Layout node id");
  if (context.nodeIds.has(node.id)) {
    throw new Error(`Layout node id '${node.id}' is duplicated.`);
  }
  context.nodeIds.add(node.id);

  if (node.kind === "leaf") {
    if (!leafAllowed) throw new Error("A leaf must belong to a stack.");
    requireTrimmed(node.sessionRef, "Leaf sessionRef");
    if (!VIEW_KINDS.has(node.viewKind)) {
      throw new Error(`Unsupported leaf viewKind '${node.viewKind}'.`);
    }
    canonicalViewState(node.viewState);
    context.leafIds.add(node.id);
    context.leafSessionRefs.push(node.sessionRef);
    return;
  }

  if (leafAllowed) {
    throw new Error("Stack tabs must be leaf nodes.");
  }
  if (node.kind === "stack") {
    if (!Array.isArray(node.tabs) || node.tabs.length === 0) {
      throw new Error("A saved stack must contain at least one leaf.");
    }
    requireTrimmed(node.active, "Active leaf id");
    const stackSessions = new Set();
    for (const tab of node.tabs) {
      validateNode(tab, context, true);
      if (stackSessions.has(tab.sessionRef)) {
        throw new Error(`Session reference '${tab.sessionRef}' is duplicated within one stack.`);
      }
      stackSessions.add(tab.sessionRef);
    }
    if (!node.tabs.some((tab) => tab.id === node.active)) {
      throw new Error(`Stack '${node.id}' has no active leaf named '${node.active}'.`);
    }
    return;
  }
  if (node.kind === "split") {
    if (!SPLIT_DIRECTIONS.has(node.direction)) {
      throw new Error(`Unsupported split direction '${node.direction}'.`);
    }
    if (!Array.isArray(node.children) || node.children.length < 2) {
      throw new Error("A saved split must contain at least two children.");
    }
    validateSplitWeights(node.sizes, node.children.length);
    for (const child of node.children) {
      if (child?.kind === "leaf") throw new Error("Split children must be stacks or splits.");
      validateNode(child, context, false);
    }
    return;
  }
  throw new Error(`Unsupported layout node kind '${node.kind}'.`);
}

export function validateSpaceState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Space state must be an object.");
  }
  if (!Array.isArray(state.members)) throw new Error("Space members must be an array.");
  const members = new Set();
  for (const sessionRef of state.members) {
    requireTrimmed(sessionRef, "Space member sessionRef");
    if (members.has(sessionRef)) throw new Error(`Space member '${sessionRef}' is duplicated.`);
    members.add(sessionRef);
  }
  const context = { nodeIds: new Set(), leafIds: new Set(), leafSessionRefs: [] };
  if (state.root != null) {
    if (state.root.kind === "leaf") throw new Error("A layout root must be a stack or split.");
    validateNode(state.root, context, false);
  }
  for (const sessionRef of context.leafSessionRefs) {
    if (!members.has(sessionRef)) {
      throw new Error(`Open session reference '${sessionRef}' is not a member of the space.`);
    }
  }
  if (state.root == null) {
    if (state.focusedLeaf != null) throw new Error("An empty space cannot have a focused leaf.");
  } else {
    requireTrimmed(state.focusedLeaf, "Focused leaf id");
    if (!context.leafIds.has(state.focusedLeaf)) {
      throw new Error(`Focused leaf '${state.focusedLeaf}' does not exist in the layout.`);
    }
  }
  return state;
}

export function createSpaceState({ members = [], root = null, focusedLeaf = null } = {}) {
  const state = {
    members: sortedMembers(members),
    root,
    focusedLeaf,
  };
  return validateSpaceState(state);
}

export function emptySpaceState() {
  return createSpaceState();
}

function replaceNode(node, nodeId, replacement) {
  if (node.id === nodeId) return replacement;
  if (node.kind === "stack") return node;
  if (node.kind === "split") {
    let changed = false;
    const children = node.children.map((child) => {
      const next = replaceNode(child, nodeId, replacement);
      changed ||= next !== child;
      return next;
    });
    return changed ? { ...node, children } : node;
  }
  return node;
}

function updateStack(node, stackId, updater) {
  if (node.kind === "stack") return node.id === stackId ? updater(node) : node;
  if (node.kind === "split") {
    let changed = false;
    const children = node.children.map((child) => {
      const next = updateStack(child, stackId, updater);
      changed ||= next !== child;
      return next;
    });
    return changed ? { ...node, children } : node;
  }
  return node;
}

function withFocusedLeaf(state, leafId) {
  const stack = findStackForLeaf(state.root, leafId);
  if (!stack) throw new Error(`Leaf '${leafId}' does not exist.`);
  const root = updateStack(state.root, stack.id, (current) => ({ ...current, active: leafId }));
  return validateSpaceState({ ...state, root, focusedLeaf: leafId });
}

export function focusSpaceLeaf(state, leafId) {
  validateSpaceState(state);
  requireTrimmed(leafId, "Focused leaf id");
  return withFocusedLeaf(state, leafId);
}

export function setSpaceActiveTab(state, stackId, leafId) {
  validateSpaceState(state);
  requireTrimmed(stackId, "Stack id");
  requireTrimmed(leafId, "Active leaf id");
  const stack = findNode(state.root, stackId);
  if (!stack || stack.kind !== "stack") throw new Error(`Stack '${stackId}' does not exist.`);
  if (!stack.tabs.some((tab) => tab.id === leafId)) {
    throw new Error(`Leaf '${leafId}' does not belong to stack '${stackId}'.`);
  }
  return withFocusedLeaf(state, leafId);
}

export function focusedSpaceSessionRef(state) {
  validateSpaceState(state);
  if (state.focusedLeaf == null) return null;
  return findLeaf(state.root, state.focusedLeaf).sessionRef;
}

export function spaceLeafById(state, leafId) {
  validateSpaceState(state);
  requireTrimmed(leafId, "Leaf id");
  return findLeaf(state.root, leafId);
}

export function addSpaceMember(state, sessionRef) {
  validateSpaceState(state);
  requireTrimmed(sessionRef, "Space member sessionRef");
  if (state.members.includes(sessionRef)) return state;
  return validateSpaceState({ ...state, members: sortedMembers([...state.members, sessionRef]) });
}

function normalizeAfterRemoval(node) {
  if (!node) return null;
  if (node.kind === "leaf") return node;
  if (node.kind === "stack") {
    if (node.tabs.length === 0) return null;
    const active = node.tabs.some((tab) => tab.id === node.active)
      ? node.active
      : node.tabs[0].id;
    return active === node.active ? node : { ...node, active };
  }
  const children = [];
  const sizes = [];
  node.children.forEach((child, index) => {
    const normalized = normalizeAfterRemoval(child);
    if (normalized) {
      children.push(normalized);
      sizes.push(node.sizes[index] ?? 1);
    }
  });
  if (children.length === 0) return null;
  if (children.length === 1) return children[0];
  return { ...node, children, sizes };
}

export function mergeDegenerateSpaceNodes(root) {
  return normalizeAfterRemoval(root);
}

function removeLeaf(node, leafId) {
  if (node.kind === "stack") {
    const index = node.tabs.findIndex((tab) => tab.id === leafId);
    if (index < 0) return { node, removed: null };
    const tabs = node.tabs.filter((tab) => tab.id !== leafId);
    const removed = node.tabs[index];
    if (tabs.length === 0) return { node: null, removed };
    let active = node.active;
    if (active === leafId) active = tabs[Math.min(index, tabs.length - 1)].id;
    return { node: { ...node, tabs, active }, removed };
  }
  if (node.kind === "split") {
    for (let index = 0; index < node.children.length; index += 1) {
      const result = removeLeaf(node.children[index], leafId);
      if (!result.removed) continue;
      const children = [...node.children];
      const sizes = [...node.sizes];
      if (result.node) {
        children[index] = result.node;
      } else {
        children.splice(index, 1);
        sizes.splice(index, 1);
      }
      return {
        node: normalizeAfterRemoval({ ...node, children, sizes }),
        removed: result.removed,
      };
    }
  }
  return { node, removed: null };
}

function normalizedFocus(root, preferred) {
  if (!root) return null;
  return preferred && findLeaf(root, preferred) ? preferred : firstActiveLeafId(root);
}

export function closeSpaceLeaf(state, leafId) {
  validateSpaceState(state);
  requireTrimmed(leafId, "Leaf id");
  const result = removeLeaf(state.root, leafId);
  if (!result.removed) throw new Error(`Leaf '${leafId}' does not exist.`);
  const root = normalizeAfterRemoval(result.node);
  const focusedLeaf = normalizedFocus(root, state.focusedLeaf === leafId ? null : state.focusedLeaf);
  return validateSpaceState({ ...state, root, focusedLeaf });
}

function removeLeavesForSession(node, sessionRef) {
  if (!node) return null;
  if (node.kind === "stack") {
    const tabs = node.tabs.filter((tab) => tab.sessionRef !== sessionRef);
    const active = tabs.some((tab) => tab.id === node.active) ? node.active : tabs[0]?.id;
    return tabs.length === 0 ? null : { ...node, tabs, active };
  }
  if (node.kind === "split") {
    const children = [];
    const sizes = [];
    node.children.forEach((child, index) => {
      const next = removeLeavesForSession(child, sessionRef);
      if (next) {
        children.push(next);
        sizes.push(node.sizes[index]);
      }
    });
    return normalizeAfterRemoval({ ...node, children, sizes });
  }
  return node;
}

// Membership removal is intentionally explicit and closes every view of that
// member. Closing an individual leaf never changes membership.
export function removeSpaceMember(state, sessionRef) {
  validateSpaceState(state);
  requireTrimmed(sessionRef, "Space member sessionRef");
  if (!state.members.includes(sessionRef)) return state;
  const root = removeLeavesForSession(state.root, sessionRef);
  const focusedLeaf = normalizedFocus(root, state.focusedLeaf);
  return validateSpaceState({
    ...state,
    members: state.members.filter((member) => member !== sessionRef),
    root,
    focusedLeaf,
  });
}

export function openSpaceLeaf(state, leafInput, { stackId = null, initialStackId = null } = {}) {
  validateSpaceState(state);
  const leaf = leafInput?.kind === "leaf"
    ? leafInput
    : createSpaceLeaf(leafInput);
  validateNode(leaf, { nodeIds: new Set(), leafIds: new Set(), leafSessionRefs: [] }, true);
  if (findNode(state.root, leaf.id)) throw new Error(`Layout node id '${leaf.id}' is duplicated.`);
  const members = state.members.includes(leaf.sessionRef)
    ? state.members
    : sortedMembers([...state.members, leaf.sessionRef]);

  if (!state.root) {
    requireTrimmed(initialStackId, "Initial stack id");
    if (initialStackId === leaf.id) throw new Error(`Layout node id '${leaf.id}' is duplicated.`);
    return validateSpaceState({
      members,
      root: createSpaceStack(initialStackId, [leaf], leaf.id),
      focusedLeaf: leaf.id,
    });
  }

  const targetStack = stackId == null
    ? findStackForLeaf(state.root, state.focusedLeaf)
    : findNode(state.root, requireTrimmed(stackId, "Stack id"));
  if (!targetStack || targetStack.kind !== "stack") {
    throw new Error("A target stack is required to open a leaf.");
  }
  if (targetStack.tabs.some((tab) => tab.sessionRef === leaf.sessionRef)) {
    throw new Error(`Session reference '${leaf.sessionRef}' is duplicated within one stack.`);
  }
  const root = updateStack(state.root, targetStack.id, (stack) => ({
    ...stack,
    tabs: [...stack.tabs, leaf],
    active: leaf.id,
  }));
  return validateSpaceState({ members, root, focusedLeaf: leaf.id });
}

export function revealOrOpenSpaceSession(state, sessionRef, options = {}) {
  validateSpaceState(state);
  requireTrimmed(sessionRef, "Session reference");
  const existing = findFirstLeafForSession(state.root, sessionRef);
  if (existing) return focusSpaceLeaf(state, existing.id);
  return openSpaceLeaf(state, {
    id: options.leafId,
    sessionRef,
    viewKind: options.viewKind ?? "chat",
    viewState: options.viewState ?? {},
  }, {
    stackId: options.stackId ?? null,
    initialStackId: options.initialStackId ?? null,
  });
}

export function dragOutSpaceLeaf(state, leafId, targetLeafId = null, {
  splitId,
  stackId,
  direction = "horizontal",
  position = "after",
} = {}) {
  validateSpaceState(state);
  requireTrimmed(leafId, "Dragged leaf id");
  const target = targetLeafId ?? state.focusedLeaf;
  requireTrimmed(target, "Target leaf id");
  if (leafId === target) throw new Error("A leaf cannot be dragged out relative to itself.");
  if (!SPLIT_DIRECTIONS.has(direction)) {
    throw new Error(`Unsupported split direction '${direction}'.`);
  }
  if (position !== "before" && position !== "after") {
    throw new Error("Drag-out position must be 'before' or 'after'.");
  }
  requireTrimmed(splitId, "New split id");
  requireTrimmed(stackId, "New stack id");
  for (const id of [splitId, stackId]) {
    if (findNode(state.root, id) || id === splitId && stackId === splitId) {
      throw new Error(`Layout node id '${id}' is duplicated.`);
    }
  }
  if (!findLeaf(state.root, target)) throw new Error(`Leaf '${target}' does not exist.`);

  const beforeIds = spaceLeafIds(state);
  const removal = removeLeaf(state.root, leafId);
  if (!removal.removed) throw new Error(`Leaf '${leafId}' does not exist.`);
  const withoutDragged = normalizeAfterRemoval(removal.node);
  const targetStack = findStackForLeaf(withoutDragged, target);
  if (!targetStack) throw new Error(`Target leaf '${target}' was lost during drag-out.`);
  const newStack = {
    kind: "stack",
    id: stackId,
    tabs: [removal.removed],
    active: removal.removed.id,
  };
  const children = position === "before"
    ? [newStack, targetStack]
    : [targetStack, newStack];
  const split = createSpaceSplit(splitId, direction, children, [1, 1]);
  const root = replaceNode(withoutDragged, targetStack.id, split);
  const next = validateSpaceState({ ...state, root, focusedLeaf: leafId });
  const afterIds = spaceLeafIds(next);
  if (afterIds.length !== beforeIds.length
    || new Set(afterIds).size !== afterIds.length
    || beforeIds.some((id) => !afterIds.includes(id))) {
    throw new Error("Drag-out violated the leaf identity invariant.");
  }
  return next;
}

function mapLeaves(node, mapper) {
  if (node.kind === "leaf") return mapper(node);
  if (node.kind === "stack") return { ...node, tabs: node.tabs.map((tab) => mapLeaves(tab, mapper)) };
  return { ...node, children: node.children.map((child) => mapLeaves(child, mapper)) };
}

export function applySpaceReconciliation(state, reconciliations) {
  validateSpaceState(state);
  if (!Array.isArray(reconciliations)) {
    throw new Error("Space reconciliation must be an array.");
  }
  const byLeaf = new Map();
  for (const item of reconciliations) {
    requireTrimmed(item?.leaf_id, "Reconciled leaf id");
    requireTrimmed(item?.session_ref, "Reconciled session reference");
    if (byLeaf.has(item.leaf_id)) {
      throw new Error(`Leaf '${item.leaf_id}' has duplicate reconciliation results.`);
    }
    if (!["live", "tombstone", "unknown"].includes(item.state)) {
      throw new Error(`Unsupported reconciliation state '${item.state}'.`);
    }
    if (item.state === "unknown") requireTrimmed(item.reason, "Unknown-state reason");
    byLeaf.set(item.leaf_id, item);
  }
  const root = state.root == null ? null : mapLeaves(state.root, (leaf) => {
    const item = byLeaf.get(leaf.id);
    if (item && item.session_ref !== leaf.sessionRef) {
      throw new Error(`Reconciliation for leaf '${leaf.id}' names a different session.`);
    }
    const renderState = item == null
      ? { state: "unknown", reason: "No reconciliation result was provided." }
      : item.state === "unknown"
        ? { state: "unknown", reason: item.reason }
        : { state: item.state };
    return { ...leaf, renderState };
  });
  return validateSpaceState({ ...state, root });
}

function canonicalNode(node) {
  if (node.kind === "leaf") {
    return {
      kind: "leaf",
      id: node.id,
      sessionRef: node.sessionRef,
      viewKind: node.viewKind,
      viewState: canonicalViewState(node.viewState),
    };
  }
  if (node.kind === "stack") {
    return {
      kind: "stack",
      id: node.id,
      tabs: node.tabs.map(canonicalNode),
      active: node.active,
    };
  }
  return {
    kind: "split",
    id: node.id,
    direction: node.direction,
    children: node.children.map(canonicalNode),
    sizes: [...node.sizes],
  };
}

export function serializeSpaceLayout(state) {
  validateSpaceState(state);
  return JSON.stringify({
    members: sortedMembers(state.members),
    root: state.root == null ? null : canonicalNode(state.root),
  });
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(", ")}.`);
  }
}

function decodeNode(value) {
  if (value?.kind === "leaf") {
    assertExactKeys(value, ["kind", "id", "sessionRef", "viewKind", "viewState"], "Leaf");
    assertExactKeys(value.viewState, ["activeSubTab"], "Leaf viewState");
    return createSpaceLeaf(value);
  }
  if (value?.kind === "stack") {
    assertExactKeys(value, ["kind", "id", "tabs", "active"], "Stack");
    if (!Array.isArray(value.tabs)) throw new Error("Stack tabs must be an array.");
    return createSpaceStack(value.id, value.tabs.map(decodeNode), value.active);
  }
  if (value?.kind === "split") {
    assertExactKeys(value, ["kind", "id", "direction", "children", "sizes"], "Split");
    if (!Array.isArray(value.children)) throw new Error("Split children must be an array.");
    return createSpaceSplit(
      value.id,
      value.direction,
      value.children.map(decodeNode),
      value.sizes,
    );
  }
  throw new Error(`Unsupported layout node kind '${value?.kind}'.`);
}

export function deserializeSpaceLayout(layoutJson, focusedLeaf = null) {
  const decoded = JSON.parse(layoutJson);
  assertExactKeys(decoded, ["members", "root"], "Space layout");
  if (!Array.isArray(decoded.members)) throw new Error("Space members must be an array.");
  const state = createSpaceState({
    members: decoded.members,
    root: decoded.root == null ? null : decodeNode(decoded.root),
    focusedLeaf,
  });
  const canonical = serializeSpaceLayout(state);
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(layoutJson);
  const canonicalBytes = encoder.encode(canonical);
  if (inputBytes.length !== canonicalBytes.length
    || inputBytes.some((byte, index) => byte !== canonicalBytes[index])) {
    throw new SpaceLayoutCanonicalDivergenceError();
  }
  return state;
}

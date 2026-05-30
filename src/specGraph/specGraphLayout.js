import ELK from "elkjs/lib/elk.bundled.js";
import {
  dimensionsForNode,
  graphRootNode,
  isContainmentEdge,
  isWorkspaceNodeType,
  nodeKind,
} from "./specGraphCore.js";

const elk = new ELK();

const NODE_COLLISION_PADDING = {
  workspace: 72,
  folder: 34,
  file: 46,
  abstract: 52,
};

const RADIAL_LAYOUT_PROFILES = {
  spec: {
    rootRadius: 380,
    childRadius: 268,
    depthStep: 96,
    rootChildStep: 34,
    rootChildCap: 900,
    orphanRadius: 540,
    unplacedRadius: 680,
  },
};

const COLLISION_GRID_SIZE = 220;
const COLLISION_MAX_ITERATIONS = 90;
const COLLISION_REST_EPSILON = 0.18;
const GREEDY_RING_LIMIT = 64;

function setNodeCenter(layout, node, center) {
  const dimensions = dimensionsForNode(node);
  layout.set(node.id, {
    x: center.x - dimensions.width / 2,
    y: center.y - dimensions.height / 2,
  });
}

function centerFor(layout, node) {
  const dimensions = dimensionsForNode(node);
  const position = layout.get(node.id) || { x: 0, y: 0 };
  return {
    x: position.x + dimensions.width / 2,
    y: position.y + dimensions.height / 2,
  };
}

function collisionPaddingForNode(node) {
  return NODE_COLLISION_PADDING[nodeKind(node)] ?? NODE_COLLISION_PADDING.abstract;
}

function rectForCenter(node, center) {
  const dimensions = dimensionsForNode(node);
  const padding = collisionPaddingForNode(node);
  return {
    left: center.x - dimensions.width / 2 - padding,
    right: center.x + dimensions.width / 2 + padding,
    top: center.y - dimensions.height / 2 - padding,
    bottom: center.y + dimensions.height / 2 + padding,
  };
}

function rectForLayoutNode(layout, node) {
  return rectForCenter(node, centerFor(layout, node));
}

function overlapArea(left, right) {
  const width = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const height = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  return width > 0 && height > 0 ? width * height : 0;
}

function rectsOverlap(left, right) {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top;
}

function collisionScore(rect, occupiedRects) {
  return occupiedRects.reduce((score, occupied) => score + overlapArea(rect, occupied), 0);
}

function averageCenterForNodes(layout, nodes) {
  if (!nodes.length) return null;
  const total = nodes.reduce(
    (acc, node) => {
      const center = centerFor(layout, node);
      return { x: acc.x + center.x, y: acc.y + center.y };
    },
    { x: 0, y: 0 },
  );
  return {
    x: total.x / nodes.length,
    y: total.y / nodes.length,
  };
}

function angleBetween(from, to, fallbackAngle) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.hypot(dx, dy) > 1 ? Math.atan2(dy, dx) : fallbackAngle;
}

function abstractPlacementDistance(node, linkedStructural) {
  const nodeDimensions = dimensionsForNode(node);
  const nodeRadius = Math.max(nodeDimensions.width, nodeDimensions.height) / 2;
  const linkedRadius = linkedStructural.reduce((radius, target) => {
    const dimensions = dimensionsForNode(target);
    return Math.max(radius, Math.max(dimensions.width, dimensions.height) / 2);
  }, 86);
  return nodeRadius + linkedRadius + 132 + Math.min(170, Math.max(0, linkedStructural.length - 1) * 26);
}

function spiralCandidateCenters(origin, angle, baseDistance) {
  const angleOffsets = [0, -0.34, 0.34, -0.68, 0.68, -1.04, 1.04, -1.42, 1.42, Math.PI, Math.PI - 0.55, -Math.PI + 0.55];
  const distances = [
    baseDistance,
    baseDistance + 86,
    baseDistance + 176,
    baseDistance + 286,
    baseDistance + 430,
    baseDistance + 620,
    baseDistance + 860,
    baseDistance + 1180,
    baseDistance + 1580,
    baseDistance + 2060,
  ];
  return distances.flatMap((distance) => angleOffsets.map((offset) => ({
    x: origin.x + Math.cos(angle + offset) * distance,
    y: origin.y + Math.sin(angle + offset) * distance,
  })));
}

function placeNodeAvoidingCollisions(layout, node, candidates, occupiedRects) {
  let bestCenter = candidates[0] || { x: 0, y: 0 };
  let bestScore = Number.POSITIVE_INFINITY;

  for (const [index, center] of candidates.entries()) {
    const rect = rectForCenter(node, center);
    const score = collisionScore(rect, occupiedRects);
    if (score <= 0) {
      setNodeCenter(layout, node, center);
      occupiedRects.push(rect);
      return;
    }

    const weightedScore = score * 1000 + index;
    if (weightedScore < bestScore) {
      bestScore = weightedScore;
      bestCenter = center;
    }
  }

  setNodeCenter(layout, node, bestCenter);
  occupiedRects.push(rectForCenter(node, bestCenter));
}

function nodePackingDiameter(node) {
  const dimensions = dimensionsForNode(node);
  const padding = collisionPaddingForNode(node);
  return Math.max(dimensions.width, dimensions.height) + padding * 2;
}

function childArcForNode(node) {
  const dimensions = dimensionsForNode(node);
  const padding = collisionPaddingForNode(node);
  return Math.max(dimensions.width, dimensions.height * 1.2) + padding * 2.45;
}

function radiusForChildren(children, rootChild, depth, profile) {
  if (!children.length) return rootChild ? profile.rootRadius : profile.childRadius;
  const totalArc = children.reduce((sum, child) => sum + childArcForNode(child), 0);
  const largest = children.reduce((value, child) => Math.max(value, nodePackingDiameter(child)), 0);
  const spread = rootChild ? Math.PI * 2 : Math.min(Math.PI * 1.55, 1.08 + children.length * 0.2);
  const crowdRadius = totalArc / Math.max(spread, 0.001);
  return Math.max(
    rootChild ? profile.rootRadius : profile.childRadius,
    crowdRadius,
    largest * 1.18,
  )
    + Math.min(profile.rootChildCap, Math.max(0, children.length - 3) * profile.rootChildStep)
    + depth * profile.depthStep;
}

function indexRect(grid, rect, nodeIndex) {
  const left = Math.floor(rect.left / COLLISION_GRID_SIZE);
  const right = Math.floor(rect.right / COLLISION_GRID_SIZE);
  const top = Math.floor(rect.top / COLLISION_GRID_SIZE);
  const bottom = Math.floor(rect.bottom / COLLISION_GRID_SIZE);
  for (let x = left; x <= right; x += 1) {
    for (let y = top; y <= bottom; y += 1) {
      const key = `${x}:${y}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(nodeIndex);
    }
  }
}

function collisionPairs(layout, nodes) {
  const grid = new Map();
  const rects = nodes.map((node) => rectForLayoutNode(layout, node));
  rects.forEach((rect, index) => indexRect(grid, rect, index));
  const pairs = [];
  const seen = new Set();
  grid.forEach((indices) => {
    for (let leftIndex = 0; leftIndex < indices.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < indices.length; rightIndex += 1) {
        const left = indices[leftIndex];
        const right = indices[rightIndex];
        const key = left < right ? `${left}:${right}` : `${right}:${left}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (rectsOverlap(rects[left], rects[right])) {
          pairs.push({ left, right, leftRect: rects[left], rightRect: rects[right] });
        }
      }
    }
  });
  return pairs;
}

function separationForRects(leftRect, rightRect, leftCenter, rightCenter) {
  const overlapX = Math.min(leftRect.right, rightRect.right) - Math.max(leftRect.left, rightRect.left);
  const overlapY = Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top);
  if (overlapX <= 0 || overlapY <= 0) return null;
  const centerDx = rightCenter.x - leftCenter.x;
  const centerDy = rightCenter.y - leftCenter.y;
  if (overlapX < overlapY) {
    return {
      x: (centerDx >= 0 ? 1 : -1) * (overlapX + 2),
      y: 0,
    };
  }
  if (overlapY < overlapX) {
    return {
      x: 0,
      y: (centerDy >= 0 ? 1 : -1) * (overlapY + 2),
    };
  }
  const angle = Math.atan2(centerDy || 1, centerDx || 1);
  return {
    x: Math.cos(angle) * (overlapX + 2),
    y: Math.sin(angle) * (overlapY + 2),
  };
}

function moveNodeCenter(layout, node, delta) {
  const current = centerFor(layout, node);
  setNodeCenter(layout, node, {
    x: current.x + delta.x,
    y: current.y + delta.y,
  });
}

function relaxLayoutCollisions(layout, nodes, fixedNodeId) {
  if (nodes.length < 2) return layout;
  for (let iteration = 0; iteration < COLLISION_MAX_ITERATIONS; iteration += 1) {
    const pairs = collisionPairs(layout, nodes);
    if (!pairs.length) return layout;

    const deltas = new Map(nodes.map((node) => [node.id, { x: 0, y: 0, hits: 0 }]));
    for (const pair of pairs) {
      const leftNode = nodes[pair.left];
      const rightNode = nodes[pair.right];
      const leftCenter = centerFor(layout, leftNode);
      const rightCenter = centerFor(layout, rightNode);
      const separation = separationForRects(pair.leftRect, pair.rightRect, leftCenter, rightCenter);
      if (!separation) continue;

      const leftFixed = leftNode.id === fixedNodeId;
      const rightFixed = rightNode.id === fixedNodeId;
      const leftShare = leftFixed ? 0 : (rightFixed ? 1 : 0.5);
      const rightShare = rightFixed ? 0 : (leftFixed ? 1 : 0.5);
      if (leftShare > 0) {
        const delta = deltas.get(leftNode.id);
        delta.x -= separation.x * leftShare;
        delta.y -= separation.y * leftShare;
        delta.hits += 1;
      }
      if (rightShare > 0) {
        const delta = deltas.get(rightNode.id);
        delta.x += separation.x * rightShare;
        delta.y += separation.y * rightShare;
        delta.hits += 1;
      }
    }

    let largestMove = 0;
    nodes.forEach((node) => {
      if (node.id === fixedNodeId) return;
      const delta = deltas.get(node.id);
      if (!delta?.hits) return;
      const move = {
        x: delta.x / Math.max(1, delta.hits),
        y: delta.y / Math.max(1, delta.hits),
      };
      largestMove = Math.max(largestMove, Math.hypot(move.x, move.y));
      moveNodeCenter(layout, node, move);
    });

    if (largestMove < COLLISION_REST_EPSILON) return layout;
  }
  return layout;
}

function greedyCandidateCenters(preferred, rootCenter, node, index) {
  const radialAngle = angleBetween(rootCenter, preferred, -Math.PI / 2 + index * 0.61803398875);
  const step = Math.max(76, nodePackingDiameter(node) * 0.72);
  const centers = [preferred];
  for (let ring = 1; ring <= GREEDY_RING_LIMIT; ring += 1) {
    const radius = step * ring;
    const slots = Math.max(12, Math.min(96, Math.ceil((Math.PI * 2 * radius) / step)));
    centers.push({
      x: rootCenter.x + Math.cos(radialAngle) * (Math.hypot(preferred.x - rootCenter.x, preferred.y - rootCenter.y) + radius),
      y: rootCenter.y + Math.sin(radialAngle) * (Math.hypot(preferred.x - rootCenter.x, preferred.y - rootCenter.y) + radius),
    });
    for (let slot = 0; slot < slots; slot += 1) {
      const angle = radialAngle + (slot / slots) * Math.PI * 2;
      centers.push({
        x: preferred.x + Math.cos(angle) * radius,
        y: preferred.y + Math.sin(angle) * radius,
      });
    }
  }
  return centers;
}

function greedyPackWithoutOverlap(layout, nodes, root) {
  if (nodes.length < 2) return layout;
  const rootCenter = root ? centerFor(layout, root) : { x: 0, y: 0 };
  const kindRank = { workspace: 0, folder: 1, file: 2, abstract: 3 };
  const ordered = [...nodes].sort((left, right) => (
    (left.id === root?.id ? -1 : 0) - (right.id === root?.id ? -1 : 0)
    || (kindRank[nodeKind(left)] ?? 4) - (kindRank[nodeKind(right)] ?? 4)
    || nodePackingDiameter(right) - nodePackingDiameter(left)
    || (left.title || "").localeCompare(right.title || "")
    || left.id.localeCompare(right.id)
  ));
  const occupiedRects = [];

  ordered.forEach((node, index) => {
    const preferred = centerFor(layout, node);
    const candidates = greedyCandidateCenters(preferred, rootCenter, node, index);
    let bestCenter = candidates[0];
    let bestScore = Number.POSITIVE_INFINITY;
    for (const [candidateIndex, center] of candidates.entries()) {
      const rect = rectForCenter(node, center);
      const score = collisionScore(rect, occupiedRects);
      if (score <= 0) {
        bestCenter = center;
        bestScore = 0;
        break;
      }
      const travel = Math.hypot(center.x - preferred.x, center.y - preferred.y);
      const weighted = score * 100000 + travel + candidateIndex;
      if (weighted < bestScore) {
        bestScore = weighted;
        bestCenter = center;
      }
    }
    setNodeCenter(layout, node, bestCenter);
    occupiedRects.push(rectForCenter(node, bestCenter));
  });

  return layout;
}

function finalizeLayout(layout, nodes, root) {
  relaxLayoutCollisions(layout, nodes, root?.id);
  if (collisionPairs(layout, nodes).length) {
    greedyPackWithoutOverlap(layout, nodes, root);
  }
  return layout;
}

function sortedChildren(children, nodeById) {
  return [...children].sort((leftId, rightId) => {
    const left = nodeById.get(leftId);
    const right = nodeById.get(rightId);
    const leftKind = nodeKind(left);
    const rightKind = nodeKind(right);
    const kindRank = { folder: 0, file: 1, workspace: 2, abstract: 3 };
    return (kindRank[leftKind] ?? 4) - (kindRank[rightKind] ?? 4)
      || (left?.title || "").localeCompare(right?.title || "");
  });
}

export function radialHierarchyLayout(nodes, edges) {
  const root = graphRootNode(nodes, edges);
  if (!root) return new Map();
  const profile = RADIAL_LAYOUT_PROFILES.spec;

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const layout = new Map();
  const placed = new Set();
  const containmentEdges = edges.filter(isContainmentEdge);
  const childrenByParent = new Map();
  const structuralChildIds = new Set();
  for (const edge of containmentEdges) {
    if (!childrenByParent.has(edge.from)) childrenByParent.set(edge.from, []);
    childrenByParent.get(edge.from).push(edge.to);
    structuralChildIds.add(edge.to);
  }

  setNodeCenter(layout, root, { x: 0, y: 0 });
  placed.add(root.id);

  const placeChildren = (parentId, parentAngle, depth) => {
    const parent = nodeById.get(parentId);
    const children = sortedChildren(childrenByParent.get(parentId) || [], nodeById)
      .filter((id) => nodeById.has(id) && !placed.has(id));
    if (!parent || !children.length) return;

    const childNodes = children.map((id) => nodeById.get(id)).filter(Boolean);
    const parentCenter = centerFor(layout, parent);
    const rootChild = parentId === root.id;
    const spread = rootChild ? Math.PI * 2 : Math.min(Math.PI * 1.55, 1.08 + children.length * 0.2);
    const start = rootChild ? -Math.PI / 2 : parentAngle - spread / 2;
    const radius = radiusForChildren(childNodes, rootChild, depth, profile);
    children.forEach((childId, index) => {
      const child = nodeById.get(childId);
      const angle = rootChild
        ? start + (index / Math.max(children.length, 1)) * Math.PI * 2
        : start + ((index + 0.5) / Math.max(children.length, 1)) * spread;
      const center = {
        x: parentCenter.x + Math.cos(angle) * radius,
        y: parentCenter.y + Math.sin(angle) * radius,
      };
      setNodeCenter(layout, child, center);
      placed.add(childId);
      placeChildren(childId, angle, depth + 1);
    });
  };

  placeChildren(root.id, -Math.PI / 2, 0);

  const orphanStructural = nodes
    .filter((node) => node.id !== root.id)
    .filter((node) => ["folder", "file"].includes(nodeKind(node)))
    .filter((node) => !structuralChildIds.has(node.id) && !placed.has(node.id));
  const orphanRadius = Math.max(
    profile.orphanRadius,
    orphanStructural.reduce((sum, node) => sum + childArcForNode(node), 0) / (Math.PI * 2),
  );
  orphanStructural.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(orphanStructural.length, 1)) * Math.PI * 2;
    setNodeCenter(layout, node, {
      x: Math.cos(angle) * orphanRadius,
      y: Math.sin(angle) * orphanRadius,
    });
    placed.add(node.id);
  });

  const structuralKinds = new Set(["workspace", "folder", "file"]);
  const abstractNodes = nodes.filter((node) => !structuralKinds.has(nodeKind(node)) && !placed.has(node.id));
  const rootCenter = centerFor(layout, root);
  const occupiedRects = nodes
    .filter((node) => placed.has(node.id) && layout.has(node.id))
    .map((node) => rectForLayoutNode(layout, node));

  abstractNodes.forEach((node, index) => {
    const linkedStructural = edges
      .filter((edge) => !isContainmentEdge(edge) && (edge.from === node.id || edge.to === node.id))
      .map((edge) => (edge.from === node.id ? edge.to : edge.from))
      .map((id) => nodeById.get(id))
      .filter((target) => target && ["workspace", "folder", "file"].includes(nodeKind(target)) && layout.has(target.id));

    if (linkedStructural.length) {
      const anchorCenter = averageCenterForNodes(layout, linkedStructural) || rootCenter;
      const fallbackAngle = -Math.PI / 2 + ((index + 0.5) / Math.max(abstractNodes.length, 1)) * Math.PI * 2;
      const angle = angleBetween(rootCenter, anchorCenter, fallbackAngle);
      placeNodeAvoidingCollisions(
        layout,
        node,
        spiralCandidateCenters(anchorCenter, angle, abstractPlacementDistance(node, linkedStructural)),
        occupiedRects,
      );
    } else {
      const angle = Math.PI / 5 + (index / Math.max(abstractNodes.length, 1)) * Math.PI * 2;
      placeNodeAvoidingCollisions(
        layout,
        node,
        spiralCandidateCenters(rootCenter, angle, abstractPlacementDistance(node, [])),
        occupiedRects,
      );
    }
    placed.add(node.id);
  });

  const unplaced = nodes.filter((node) => !placed.has(node.id));
  unplaced.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(unplaced.length, 1)) * Math.PI * 2;
    placeNodeAvoidingCollisions(
      layout,
      node,
      spiralCandidateCenters(rootCenter, angle, profile.unplacedRadius),
      occupiedRects,
    );
  });

  return finalizeLayout(layout, nodes, root);
}

export async function elkFallbackLayout(nodes, edges) {
  const graph = {
    id: "spec-graph",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "56",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.edgeRouting": "SPLINES",
    },
    children: nodes.map((node) => {
      const dimensions = dimensionsForNode(node);
      return { id: node.id, width: dimensions.width, height: dimensions.height };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      sources: [edge.from],
      targets: [edge.to],
    })),
  };
  const result = await elk.layout(graph);
  const layout = new Map((result.children || []).map((child) => [child.id, { x: child.x || 0, y: child.y || 0 }]));
  return finalizeLayout(layout, nodes, graphRootNode(nodes, edges));
}

export async function layoutSpecGraph(nodes, edges) {
  if (!nodes.length) return new Map();
  if (edges.some(isContainmentEdge) || nodes.some((node) => isWorkspaceNodeType(node.node_type))) {
    return radialHierarchyLayout(nodes, edges);
  }
  try {
    return await elkFallbackLayout(nodes, edges);
  } catch {
    return radialHierarchyLayout(nodes, edges);
  }
}

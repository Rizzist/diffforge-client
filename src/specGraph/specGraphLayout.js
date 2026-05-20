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
  workspace: 36,
  folder: 18,
  file: 24,
  abstract: 32,
};

const RADIAL_LAYOUT_PROFILES = {
  spec: {
    rootRadius: 282,
    childRadius: 178,
    depthStep: 38,
    rootChildStep: 10,
    rootChildCap: 120,
    orphanRadius: 360,
    unplacedRadius: 460,
  },
  knowledge: {
    rootRadius: 176,
    childRadius: 112,
    depthStep: 18,
    rootChildStep: 5,
    rootChildCap: 42,
    orphanRadius: 230,
    unplacedRadius: 260,
  },
};

const KNOWLEDGE_OUTWARD_PROFILE = {
  rootRadius: 132,
  childRadius: 82,
  rootSizeStep: 28,
  childSizeStep: 12,
  rootFanoutStep: 6,
  childFanoutStep: 5,
  depthStep: 7,
  maxRootDistance: 360,
  maxChildDistance: 230,
  collisionIterations: 72,
  collisionPadding: 24,
};

const KNOWLEDGE_ROOT_ANGLE_PRESETS = {
  1: [-Math.PI / 2],
  2: [-Math.PI * 0.78, Math.PI * 0.22],
  3: [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6],
};

const KNOWLEDGE_COLLISION_DIMENSIONS = {
  root: { width: 190, height: 118 },
  concept: { width: 168, height: 98 },
  nested: { width: 142, height: 78 },
  deep: { width: 120, height: 66 },
};

function setNodeCenter(layout, node, center) {
  const dimensions = dimensionsForNode(node);
  layout.set(node.id, {
    x: center.x - dimensions.width / 2,
    y: center.y - dimensions.height / 2,
  });
}

function isKnowledgeRootNode(node) {
  const type = String(node?.knowledge_node_type || node?.node_type || "").toLowerCase();
  return Boolean(node?.is_root)
    || type === "workspace"
    || type === "repo_root";
}

function stableHash(value) {
  const source = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableUnit(value) {
  return stableHash(value) / 0xffffffff;
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
  return nodeRadius + linkedRadius + 78 + Math.min(72, Math.max(0, linkedStructural.length - 1) * 18);
}

function spiralCandidateCenters(origin, angle, baseDistance) {
  const angleOffsets = [0, -0.46, 0.46, -0.92, 0.92, -1.38, 1.38, Math.PI, Math.PI - 0.55, -Math.PI + 0.55];
  const distances = [
    baseDistance,
    baseDistance + 56,
    baseDistance + 116,
    baseDistance + 184,
    baseDistance + 264,
    baseDistance + 360,
    baseDistance + 480,
    baseDistance + 640,
    baseDistance + 840,
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

function normalizeKnowledgeLinks(nodes, edges) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const seen = new Set();
  return edges
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to)
    .map((edge) => {
      const pairKey = [edge.from, edge.to].sort().join("<->");
      const directedKey = `${edge.from}->${edge.to}:${edge.kind || ""}`;
      return { edge, pairKey, directedKey };
    })
    .filter(({ directedKey }) => {
      if (seen.has(directedKey)) return false;
      seen.add(directedKey);
      return true;
    });
}

function knowledgeNodeLabel(node) {
  return String(node?.display_title || node?.displayTitle || node?.title || node?.id || "");
}

function compareKnowledgeChildIds(leftId, rightId, nodeById, metricsById = null) {
  const left = nodeById.get(leftId);
  const right = nodeById.get(rightId);
  const leftMetrics = metricsById?.get(leftId);
  const rightMetrics = metricsById?.get(rightId);
  if (leftMetrics && rightMetrics) {
    return rightMetrics.descendantCount - leftMetrics.descendantCount
      || rightMetrics.childCount - leftMetrics.childCount
      || knowledgeNodeLabel(left).localeCompare(knowledgeNodeLabel(right));
  }
  return knowledgeNodeLabel(left).localeCompare(knowledgeNodeLabel(right));
}

function sortedKnowledgeChildIds(childIds, nodeById, metricsById = null) {
  return [...new Set(childIds || [])]
    .filter((childId) => nodeById.has(childId))
    .sort((leftId, rightId) => compareKnowledgeChildIds(leftId, rightId, nodeById, metricsById));
}

function wouldCreateKnowledgeCycle(parentById, parentId, childId) {
  let current = parentId;
  const seen = new Set([childId]);
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentById.get(current);
  }
  return false;
}

function buildChildrenByParent(parentById, nodeById) {
  const childrenByParent = new Map();
  parentById.forEach((parentId, childId) => {
    if (!nodeById.has(parentId) || !nodeById.has(childId) || parentId === childId) return;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(childId);
  });
  return childrenByParent;
}

function knowledgeEdgeSortKey(edge) {
  return [
    String(edge.from || ""),
    String(edge.kind || ""),
    String(edge.to || ""),
    String(edge.id || ""),
  ].join("|");
}

export function buildKnowledgeOutwardHierarchy(nodes, edges) {
  const nodeById = new Map((nodes || []).map((node) => [node.id, node]));
  const root = (nodes || []).find(isKnowledgeRootNode) || graphRootNode(nodes || [], edges || []) || nodes?.[0] || null;
  const parentById = new Map();
  if (!root) {
    return {
      root: null,
      nodeById,
      childrenByParent: new Map(),
      parentById,
      metricsById: new Map(),
      branchIndexById: new Map(),
      depthById: new Map(),
      rootChildIds: [],
    };
  }

  const rootId = root.id;
  const setParent = (parentId, childId, replaceRootParent = false) => {
    if (!nodeById.has(parentId) || !nodeById.has(childId) || childId === rootId || parentId === childId) return false;
    if (wouldCreateKnowledgeCycle(parentById, parentId, childId)) return false;
    const currentParent = parentById.get(childId);
    if (currentParent && !(replaceRootParent && currentParent === rootId)) return false;
    parentById.set(childId, parentId);
    return true;
  };

  [...(edges || [])]
    .filter(isContainmentEdge)
    .sort((left, right) => {
      const leftRoot = left.from === rootId ? 1 : 0;
      const rightRoot = right.from === rootId ? 1 : 0;
      return leftRoot - rightRoot || knowledgeEdgeSortKey(left).localeCompare(knowledgeEdgeSortKey(right));
    })
    .forEach((edge) => {
      setParent(edge.from, edge.to, true);
    });

  for (const node of nodes || []) {
    if (node.id !== rootId && !parentById.has(node.id)) {
      parentById.set(node.id, rootId);
    }
  }

  const normalizedLinks = normalizeKnowledgeLinks(nodes || [], edges || []);
  const outgoingCounts = new Map();
  normalizedLinks
    .filter(({ edge }) => !isContainmentEdge(edge))
    .forEach(({ edge }) => {
      outgoingCounts.set(edge.from, (outgoingCounts.get(edge.from) || 0) + 1);
    });

  normalizedLinks
    .filter(({ edge }) => !isContainmentEdge(edge))
    .map(({ edge }) => edge)
    .filter((edge) => edge.from !== rootId && edge.to !== rootId)
    .sort((left, right) => {
      return (outgoingCounts.get(right.from) || 0) - (outgoingCounts.get(left.from) || 0)
        || knowledgeEdgeSortKey(left).localeCompare(knowledgeEdgeSortKey(right));
    })
    .forEach((edge) => {
      if (parentById.get(edge.to) !== rootId) return;
      setParent(edge.from, edge.to, true);
    });

  const childrenByParent = buildChildrenByParent(parentById, nodeById);
  const metricsById = new Map();
  const visiting = new Set();

  const visit = (nodeId, depth = 0) => {
    if (metricsById.has(nodeId)) return metricsById.get(nodeId);
    if (visiting.has(nodeId)) {
      return {
        id: nodeId,
        depth,
        childCount: 0,
        descendantCount: 0,
        leafCount: 1,
        weight: 1,
      };
    }
    visiting.add(nodeId);
    const childIds = sortedKnowledgeChildIds(childrenByParent.get(nodeId), nodeById);
    let descendantCount = 0;
    let leafCount = childIds.length ? 0 : 1;

    childIds.forEach((childId) => {
      const childMetrics = visit(childId, depth + 1);
      descendantCount += 1 + childMetrics.descendantCount;
      leafCount += childMetrics.leafCount;
    });

    visiting.delete(nodeId);
    const metric = {
      id: nodeId,
      depth,
      childCount: childIds.length,
      descendantCount,
      leafCount,
      weight: 1 + Math.min(4.8, Math.sqrt(descendantCount + 1) * 0.46 + childIds.length * 0.22),
    };
    metricsById.set(nodeId, metric);
    return metric;
  };

  visit(rootId, 0);
  for (const node of nodes || []) {
    if (!metricsById.has(node.id)) {
      parentById.set(node.id, rootId);
      visit(node.id, 1);
    }
  }

  const sortedChildrenByParent = new Map();
  childrenByParent.forEach((childIds, parentId) => {
    sortedChildrenByParent.set(parentId, sortedKnowledgeChildIds(childIds, nodeById, metricsById));
  });

  const branchIndexById = new Map();
  const depthById = new Map([[rootId, 0]]);
  const rootChildIds = sortedChildrenByParent.get(rootId) || [];
  const assignBranch = (nodeId, branchIndex, depth) => {
    branchIndexById.set(nodeId, branchIndex);
    depthById.set(nodeId, depth);
    (sortedChildrenByParent.get(nodeId) || []).forEach((childId) => {
      assignBranch(childId, branchIndex, depth + 1);
    });
  };
  rootChildIds.forEach((childId, branchIndex) => {
    assignBranch(childId, branchIndex, 1);
  });

  return {
    root,
    nodeById,
    childrenByParent: sortedChildrenByParent,
    parentById,
    metricsById,
    branchIndexById,
    depthById,
    rootChildIds,
  };
}

function knowledgeAngleWeight(metrics) {
  return metrics?.weight || 1;
}

function weightedKnowledgeAngles(childIds, centerAngle, span, metricsById) {
  const weights = childIds.map((childId) => knowledgeAngleWeight(metricsById.get(childId)));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0) || 1;
  const anglesById = new Map();
  let cursor = centerAngle - span / 2;
  childIds.forEach((childId, index) => {
    const slice = span * (weights[index] / totalWeight);
    anglesById.set(childId, cursor + slice / 2);
    cursor += slice;
  });
  return anglesById;
}

function knowledgeAngleBetween(from, to, fallbackAngle) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.hypot(dx, dy) > 0.001 ? Math.atan2(dy, dx) : fallbackAngle;
}

function knowledgeAngleDelta(fromAngle, toAngle) {
  return Math.atan2(Math.sin(toAngle - fromAngle), Math.cos(toAngle - fromAngle));
}

function knowledgePolarPoint(origin, angle, radius) {
  return {
    x: origin.x + Math.cos(angle) * radius,
    y: origin.y + Math.sin(angle) * radius,
  };
}

function knowledgeRootChildAngles(childIds, metricsById) {
  const preset = KNOWLEDGE_ROOT_ANGLE_PRESETS[childIds.length];
  if (preset) {
    return new Map(childIds.map((childId, index) => [childId, preset[index]]));
  }

  const weights = childIds.map((childId) => knowledgeAngleWeight(metricsById.get(childId)));
  const totalWeight = weights.reduce((total, weight) => total + weight, 0) || 1;
  const firstSlice = Math.PI * 2 * (weights[0] / totalWeight);
  const anglesById = new Map();
  let cursor = -Math.PI / 2 - firstSlice / 2;
  childIds.forEach((childId, index) => {
    const slice = Math.PI * 2 * (weights[index] / totalWeight);
    anglesById.set(childId, cursor + slice / 2);
    cursor += slice;
  });
  return anglesById;
}

function knowledgeChildSpread(parentMetrics, childCount) {
  if (childCount <= 1) return 0;
  const descendantSpread = Math.log2((parentMetrics?.descendantCount || 0) + 1) * 0.16;
  const fanoutSpread = Math.log2(childCount + 1) * 0.42;
  return Math.min(Math.PI * 1.16, Math.max(0.78, 0.68 + fanoutSpread + descendantSpread));
}

function knowledgeForwardChildSpread(parentMetrics, childCount) {
  if (childCount <= 1) return 0;
  const outwardFanout = Math.min(4, childCount - 1) * 0.18;
  const descendantSpread = Math.log2((parentMetrics?.descendantCount || 0) + 1) * 0.08;
  const wrapSpread = childCount > 5 ? Math.log2(childCount - 3) * 0.46 : 0;
  return Math.min(Math.PI * 1.48, 0.42 + outwardFanout + descendantSpread + wrapSpread);
}

function knowledgeForwardNestedChildAngles(childIds, parentAngle, parentMetrics, metricsById) {
  if (childIds.length === 1) {
    const childId = childIds[0];
    const bend = (stableUnit(`${childId}:knowledge-forward-single-bend`) - 0.5) * 0.12;
    return new Map([[childId, parentAngle + bend]]);
  }

  return weightedKnowledgeAngles(
    childIds,
    parentAngle,
    knowledgeForwardChildSpread(parentMetrics, childIds.length),
    metricsById,
  );
}

function knowledgeNestedChildAngles(childIds, parentAngle, parentMetrics, metricsById, depth = 1) {
  if (depth >= 2) {
    return knowledgeForwardNestedChildAngles(childIds, parentAngle, parentMetrics, metricsById);
  }

  if (childIds.length === 1) {
    const childId = childIds[0];
    const bend = (stableUnit(`${childId}:knowledge-single-bend`) - 0.5) * 0.2;
    return new Map([[childId, parentAngle + bend]]);
  }

  return weightedKnowledgeAngles(
    childIds,
    parentAngle,
    knowledgeChildSpread(parentMetrics, childIds.length),
    metricsById,
  );
}

function knowledgeBranchDistance(childMetrics, siblingCount, depth, isRootChild, totalNodes) {
  const profile = KNOWLEDGE_OUTWARD_PROFILE;
  const compactScale = totalNodes <= 4 ? 0.82 : totalNodes <= 8 ? 0.9 : 1;
  const nestedDepth = Math.max(0, depth - 1);
  const grapeScale = isRootChild ? 1 : Math.max(0.58, 0.86 - nestedDepth * 0.12);
  const descendantPush = Math.log2((childMetrics?.descendantCount || 0) + 1)
    * (isRootChild ? profile.rootSizeStep : profile.childSizeStep);
  const childFanoutPush = Math.max(0, (childMetrics?.childCount || 0) - 2)
    * (isRootChild ? profile.rootFanoutStep : profile.childFanoutStep);
  const siblingPush = Math.max(0, siblingCount - 3)
    * (isRootChild ? profile.rootFanoutStep : profile.childFanoutStep);
  const depthPush = depth * profile.depthStep;
  const distance = (
    (isRootChild ? profile.rootRadius : profile.childRadius)
    + descendantPush
    + childFanoutPush
    + siblingPush
    + depthPush
  ) * compactScale * grapeScale;
  return Math.min(isRootChild ? profile.maxRootDistance : profile.maxChildDistance, distance);
}

function knowledgeNestedLayerRadius(parentRadius, branchDistance, depth) {
  const levelGap = Math.max(58, branchDistance * (depth <= 1 ? 0.96 : 0.9));
  return parentRadius + levelGap;
}

function shiftLayoutNode(layout, node, dx, dy) {
  const center = centerFor(layout, node);
  setNodeCenter(layout, node, {
    x: center.x + dx,
    y: center.y + dy,
  });
}

function knowledgeCollisionDimensions(node, depth) {
  if (isKnowledgeRootNode(node)) return KNOWLEDGE_COLLISION_DIMENSIONS.root;
  if (depth >= 4) return KNOWLEDGE_COLLISION_DIMENSIONS.deep;
  if (depth >= 3) return KNOWLEDGE_COLLISION_DIMENSIONS.nested;
  return KNOWLEDGE_COLLISION_DIMENSIONS.concept;
}

function knowledgeExpandedRectForLayoutNode(layout, node, depthById) {
  const center = centerFor(layout, node);
  const dimensions = knowledgeCollisionDimensions(node, depthById?.get(node.id) || 0);
  const padding = KNOWLEDGE_OUTWARD_PROFILE.collisionPadding;
  return {
    left: center.x - dimensions.width / 2 - padding,
    right: center.x + dimensions.width / 2 + padding,
    top: center.y - dimensions.height / 2 - padding,
    bottom: center.y + dimensions.height / 2 + padding,
  };
}

function knowledgeClusterRelated(left, right, parentById, depthById) {
  const leftParent = parentById?.get(left.id);
  const rightParent = parentById?.get(right.id);
  if (leftParent === right.id || rightParent === left.id) return true;
  return Boolean(leftParent && leftParent === rightParent)
    && Math.max(depthById?.get(left.id) || 0, depthById?.get(right.id) || 0) >= 2;
}

function resolveKnowledgeCollisions(layout, nodes, root, depthById, parentById) {
  if (nodes.length < 2) return;
  const rootId = root?.id;
  for (let iteration = 0; iteration < KNOWLEDGE_OUTWARD_PROFILE.collisionIterations; iteration += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      const left = nodes[leftIndex];
      if (!layout.has(left.id)) continue;
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const right = nodes[rightIndex];
        if (!layout.has(right.id)) continue;

        const leftRect = knowledgeExpandedRectForLayoutNode(layout, left, depthById);
        const rightRect = knowledgeExpandedRectForLayoutNode(layout, right, depthById);
        const overlapX = Math.min(leftRect.right, rightRect.right) - Math.max(leftRect.left, rightRect.left);
        const overlapY = Math.min(leftRect.bottom, rightRect.bottom) - Math.max(leftRect.top, rightRect.top);
        if (overlapX <= 0 || overlapY <= 0) continue;
        const clusterRelated = knowledgeClusterRelated(left, right, parentById, depthById);
        if (clusterRelated && Math.min(overlapX, overlapY) < 10) continue;

        const leftCenter = centerFor(layout, left);
        const rightCenter = centerFor(layout, right);
        let dx = rightCenter.x - leftCenter.x;
        let dy = rightCenter.y - leftCenter.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.001) {
          const angle = stableUnit(`${left.id}:${right.id}:knowledge-collision`) * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          distance = 1;
        }
        const nx = dx / distance;
        const ny = dy / distance;
        const push = clusterRelated
          ? Math.min(28, Math.min(overlapX, overlapY) * 0.25 + 5)
          : Math.min(64, Math.min(overlapX, overlapY) * 0.58 + 8);
        const leftFixed = left.id === rootId;
        const rightFixed = right.id === rootId;

        if (leftFixed && !rightFixed) {
          shiftLayoutNode(layout, right, nx * push, ny * push);
        } else if (rightFixed && !leftFixed) {
          shiftLayoutNode(layout, left, -nx * push, -ny * push);
        } else if (!leftFixed && !rightFixed) {
          shiftLayoutNode(layout, left, -nx * push * 0.5, -ny * push * 0.5);
          shiftLayoutNode(layout, right, nx * push * 0.5, ny * push * 0.5);
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function reinforceKnowledgeRadialDepth(layout, nodes, root, parentById, depthById, radialAngleById, radialRadiusById) {
  if (!root) return;
  const rootCenter = centerFor(layout, root);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const orderedNodes = [...nodes]
    .filter((node) => node.id !== root.id && layout.has(node.id))
    .sort((left, right) => (radialRadiusById.get(left.id) || 0) - (radialRadiusById.get(right.id) || 0));

  orderedNodes.forEach((node) => {
    const parent = nodeById.get(parentById?.get(node.id));
    if (!parent || !layout.has(parent.id)) return;

    const desiredRadius = radialRadiusById.get(node.id);
    const desiredParentRadius = radialRadiusById.get(parent.id) || 0;
    if (!Number.isFinite(desiredRadius) || desiredRadius <= desiredParentRadius) return;

    const parentCenter = centerFor(layout, parent);
    const parentRadius = Math.hypot(parentCenter.x - rootCenter.x, parentCenter.y - rootCenter.y);
    const expectedGap = desiredRadius - desiredParentRadius;
    const minRadius = parentRadius + Math.max(42, Math.min(86, expectedGap * 0.78));
    const currentCenter = centerFor(layout, node);
    const currentRadius = Math.hypot(currentCenter.x - rootCenter.x, currentCenter.y - rootCenter.y);
    const desiredAngle = radialAngleById.get(node.id) ?? -Math.PI / 2;
    const depth = depthById?.get(node.id) || 0;
    const currentAngle = knowledgeAngleBetween(rootCenter, currentCenter, desiredAngle);
    const angleRestore = depth >= 3
      ? knowledgeAngleDelta(currentAngle, desiredAngle) * 0.72
      : 0;
    if (currentRadius >= minRadius && Math.abs(angleRestore) < 0.08) return;

    setNodeCenter(
      layout,
      node,
      knowledgePolarPoint(
        rootCenter,
        currentAngle + angleRestore,
        Math.max(currentRadius, minRadius),
      ),
    );
  });
}

export function knowledgeForceLayout(nodes, edges) {
  if (!nodes.length) return new Map();

  const {
    root,
    nodeById,
    childrenByParent,
    depthById,
    metricsById,
    parentById,
  } = buildKnowledgeOutwardHierarchy(nodes, edges);
  if (!root) return new Map();

  const layout = new Map();
  const placed = new Set([root.id]);
  setNodeCenter(layout, root, { x: 0, y: 0 });
  const rootCenter = centerFor(layout, root);
  const radialAngleById = new Map([[root.id, -Math.PI / 2]]);
  const radialRadiusById = new Map([[root.id, 0]]);

  const placeChildren = (parentId, parentAngle, depth) => {
    const parent = nodeById.get(parentId);
    const childIds = childrenByParent.get(parentId) || [];
    if (!parent || !childIds.length) return;

    const isRoot = parentId === root.id;
    const parentCenter = centerFor(layout, parent);
    const parentRadius = isRoot
      ? 0
      : Math.hypot(parentCenter.x - rootCenter.x, parentCenter.y - rootCenter.y);
    const parentRadialAngle = isRoot
      ? parentAngle
      : knowledgeAngleBetween(rootCenter, parentCenter, parentAngle);
    const parentMetrics = metricsById.get(parentId);
    const angleById = isRoot
      ? knowledgeRootChildAngles(childIds, metricsById)
      : knowledgeNestedChildAngles(childIds, parentRadialAngle, parentMetrics, metricsById, depth);

    childIds.forEach((childId) => {
      const child = nodeById.get(childId);
      if (!child || placed.has(childId)) return;
      const angle = angleById.get(childId) ?? parentRadialAngle;
      const distance = knowledgeBranchDistance(
        metricsById.get(childId),
        childIds.length,
        depth,
        isRoot,
        nodes.length,
      );
      const childCenter = isRoot
        ? {
          x: parentCenter.x + Math.cos(angle) * distance,
          y: parentCenter.y + Math.sin(angle) * distance,
        }
        : knowledgePolarPoint(
          rootCenter,
          angle,
          knowledgeNestedLayerRadius(parentRadius, distance, depth),
        );
      setNodeCenter(layout, child, childCenter);
      radialAngleById.set(childId, angle);
      radialRadiusById.set(childId, Math.hypot(childCenter.x - rootCenter.x, childCenter.y - rootCenter.y));
      placed.add(childId);
      placeChildren(childId, angle, depth + 1);
    });
  };

  placeChildren(root.id, -Math.PI / 2, 0);

  nodes
    .filter((node) => !placed.has(node.id))
    .forEach((node, index, unplaced) => {
      const angle = -Math.PI / 2 + (index / Math.max(unplaced.length, 1)) * Math.PI * 2;
      setNodeCenter(layout, node, {
        x: rootCenter.x + Math.cos(angle) * KNOWLEDGE_OUTWARD_PROFILE.maxRootDistance,
        y: rootCenter.y + Math.sin(angle) * KNOWLEDGE_OUTWARD_PROFILE.maxRootDistance,
      });
      radialAngleById.set(node.id, angle);
      radialRadiusById.set(node.id, KNOWLEDGE_OUTWARD_PROFILE.maxRootDistance);
      placed.add(node.id);
    });

  resolveKnowledgeCollisions(layout, nodes, root, depthById, parentById);
  reinforceKnowledgeRadialDepth(layout, nodes, root, parentById, depthById, radialAngleById, radialRadiusById);
  resolveKnowledgeCollisions(layout, nodes, root, depthById, parentById);
  reinforceKnowledgeRadialDepth(layout, nodes, root, parentById, depthById, radialAngleById, radialRadiusById);
  return layout;
}

export function radialHierarchyLayout(nodes, edges, options = {}) {
  const root = graphRootNode(nodes, edges);
  if (!root) return new Map();
  const profile = RADIAL_LAYOUT_PROFILES[options.variant] || RADIAL_LAYOUT_PROFILES.spec;

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

    const parentCenter = centerFor(layout, parent);
    const rootChild = parentId === root.id;
    const spread = rootChild ? Math.PI * 2 : Math.min(Math.PI * 1.25, 0.7 + children.length * 0.28);
    const start = rootChild ? -Math.PI / 2 : parentAngle - spread / 2;
    const radius = (rootChild ? profile.rootRadius : profile.childRadius)
      + Math.min(profile.rootChildCap, Math.max(0, children.length - 3) * profile.rootChildStep)
      + depth * profile.depthStep;
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
  orphanStructural.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(orphanStructural.length, 1)) * Math.PI * 2;
    setNodeCenter(layout, node, {
      x: Math.cos(angle) * profile.orphanRadius,
      y: Math.sin(angle) * profile.orphanRadius,
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

  return layout;
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
  return new Map((result.children || []).map((child) => [child.id, { x: child.x || 0, y: child.y || 0 }]));
}

export async function layoutSpecGraph(nodes, edges, options = {}) {
  if (!nodes.length) return new Map();
  if (options.variant === "knowledge") {
    return knowledgeForceLayout(nodes, edges);
  }
  if (edges.some(isContainmentEdge) || nodes.some((node) => isWorkspaceNodeType(node.node_type))) {
    return radialHierarchyLayout(nodes, edges, options);
  }
  try {
    return await elkFallbackLayout(nodes, edges);
  } catch {
    return radialHierarchyLayout(nodes, edges, options);
  }
}

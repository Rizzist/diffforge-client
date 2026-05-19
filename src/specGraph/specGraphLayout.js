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

const KNOWLEDGE_FORCE_PROFILE = {
  iterations: 280,
  linkDistance: 118,
  rootLinkDistance: 132,
  crossLinkDistance: 104,
  linkStrength: 0.055,
  rootLinkStrength: 0.046,
  repulsion: 5400,
  collisionPadding: 28,
  centerStrength: 0.012,
  rootCenterStrength: 0.11,
  anchorStrength: 0.006,
  velocityDecay: 0.72,
  minDistance: 34,
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

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

function knowledgeNodeRadius(node) {
  const dimensions = dimensionsForNode(node);
  return Math.max(dimensions.width, dimensions.height) * (isKnowledgeRootNode(node) ? 0.24 : 0.2);
}

function applyKnowledgeAntiLinearity(simNodes) {
  if (simNodes.length < 3) return;

  const xs = simNodes.map((node) => node.x);
  const ys = simNodes.map((node) => node.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const shortSide = Math.min(width, height);
  const longSide = Math.max(width, height);
  if (longSide < 1 || shortSide / longSide > 0.36) return;

  const vertical = width < height;
  simNodes.forEach((node, index) => {
    if (node.root) return;
    const wave = ((index % 2) ? -1 : 1) * (44 + (index % 3) * 14);
    const jitter = (stableUnit(node.id) - 0.5) * 30;
    if (vertical) {
      node.x += wave + jitter;
    } else {
      node.y += wave + jitter;
    }
  });
}

function compactKnowledgeLayout(simNodes) {
  if (!simNodes.length) return;

  const centroid = simNodes.reduce(
    (acc, node) => ({ x: acc.x + node.x, y: acc.y + node.y }),
    { x: 0, y: 0 },
  );
  centroid.x /= simNodes.length;
  centroid.y /= simNodes.length;

  simNodes.forEach((node) => {
    node.x -= centroid.x;
    node.y -= centroid.y;
  });
}

export function knowledgeForceLayout(nodes, edges) {
  if (!nodes.length) return new Map();

  const root = nodes.find(isKnowledgeRootNode) || graphRootNode(nodes, edges) || nodes[0];
  const links = normalizeKnowledgeLinks(nodes, edges);
  const degreeById = new Map(nodes.map((node) => [node.id, 0]));
  links.forEach(({ edge }) => {
    degreeById.set(edge.from, (degreeById.get(edge.from) || 0) + 1);
    degreeById.set(edge.to, (degreeById.get(edge.to) || 0) + 1);
  });

  const orderedNodes = [...nodes].sort((left, right) => {
    if (left.id === root.id) return -1;
    if (right.id === root.id) return 1;
    return (degreeById.get(right.id) || 0) - (degreeById.get(left.id) || 0)
      || String(left.title || left.id).localeCompare(String(right.title || right.id));
  });

  const simNodes = orderedNodes.map((node, index) => {
    if (node.id === root.id) {
      return {
        node,
        id: node.id,
        root: true,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        anchorX: 0,
        anchorY: 0,
      };
    }

    const ring = Math.floor((index - 1) / 8);
    const radius = 92 + ring * 48 + stableUnit(`${node.id}:radius`) * 18;
    const angle = -Math.PI / 2 + (index - 1) * GOLDEN_ANGLE + stableUnit(node.id) * 0.68;
    return {
      node,
      id: node.id,
      root: false,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      anchorX: Math.cos(angle) * radius,
      anchorY: Math.sin(angle) * radius,
    };
  });

  const simById = new Map(simNodes.map((node) => [node.id, node]));
  const pairCounts = new Map();
  links.forEach(({ pairKey }) => {
    pairCounts.set(pairKey, (pairCounts.get(pairKey) || 0) + 1);
  });

  for (let tick = 0; tick < KNOWLEDGE_FORCE_PROFILE.iterations; tick += 1) {
    const progress = tick / Math.max(1, KNOWLEDGE_FORCE_PROFILE.iterations - 1);
    const alpha = 1 - progress;

    links.forEach(({ edge, pairKey }) => {
      const source = simById.get(edge.from);
      const target = simById.get(edge.to);
      if (!source || !target) return;

      let dx = target.x - source.x;
      let dy = target.y - source.y;
      let distance = Math.hypot(dx, dy);
      if (distance < 0.001) {
        const angle = stableUnit(`${edge.id || pairKey}:link`) * Math.PI * 2;
        dx = Math.cos(angle) * 0.001;
        dy = Math.sin(angle) * 0.001;
        distance = 0.001;
      }

      const touchesRoot = source.root || target.root;
      const crossLink = !isContainmentEdge(edge);
      const parallelBonus = Math.min(16, Math.max(0, (pairCounts.get(pairKey) || 1) - 1) * 5);
      const targetDistance = (touchesRoot
        ? KNOWLEDGE_FORCE_PROFILE.rootLinkDistance
        : crossLink
          ? KNOWLEDGE_FORCE_PROFILE.crossLinkDistance
          : KNOWLEDGE_FORCE_PROFILE.linkDistance) - parallelBonus;
      const strength = (touchesRoot
        ? KNOWLEDGE_FORCE_PROFILE.rootLinkStrength
        : KNOWLEDGE_FORCE_PROFILE.linkStrength) * alpha;
      const force = (distance - targetDistance) * strength;
      const fx = (dx / distance) * force;
      const fy = (dy / distance) * force;

      if (!source.root) {
        source.vx += fx;
        source.vy += fy;
      }
      if (!target.root) {
        target.vx -= fx;
        target.vy -= fy;
      }
    });

    for (let leftIndex = 0; leftIndex < simNodes.length; leftIndex += 1) {
      const left = simNodes[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < simNodes.length; rightIndex += 1) {
        const right = simNodes[rightIndex];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let distance = Math.hypot(dx, dy);
        if (distance < 0.001) {
          const angle = stableUnit(`${left.id}:${right.id}:repel`) * Math.PI * 2;
          dx = Math.cos(angle) * 0.001;
          dy = Math.sin(angle) * 0.001;
          distance = 0.001;
        }

        const minimum = knowledgeNodeRadius(left.node) + knowledgeNodeRadius(right.node) + KNOWLEDGE_FORCE_PROFILE.collisionPadding;
        const collisionForce = distance < minimum ? (minimum - distance) * 0.16 : 0;
        const chargeForce = KNOWLEDGE_FORCE_PROFILE.repulsion / Math.max(distance * distance, KNOWLEDGE_FORCE_PROFILE.minDistance ** 2);
        const force = (chargeForce + collisionForce) * alpha;
        const fx = (dx / distance) * force;
        const fy = (dy / distance) * force;

        if (!left.root) {
          left.vx -= fx;
          left.vy -= fy;
        }
        if (!right.root) {
          right.vx += fx;
          right.vy += fy;
        }
      }
    }

    simNodes.forEach((simNode) => {
      if (simNode.root) {
        simNode.vx += -simNode.x * KNOWLEDGE_FORCE_PROFILE.rootCenterStrength * alpha;
        simNode.vy += -simNode.y * KNOWLEDGE_FORCE_PROFILE.rootCenterStrength * alpha;
      } else {
        simNode.vx += -simNode.x * KNOWLEDGE_FORCE_PROFILE.centerStrength * alpha;
        simNode.vy += -simNode.y * KNOWLEDGE_FORCE_PROFILE.centerStrength * alpha;
        simNode.vx += (simNode.anchorX - simNode.x) * KNOWLEDGE_FORCE_PROFILE.anchorStrength * alpha;
        simNode.vy += (simNode.anchorY - simNode.y) * KNOWLEDGE_FORCE_PROFILE.anchorStrength * alpha;
      }

      simNode.vx *= KNOWLEDGE_FORCE_PROFILE.velocityDecay;
      simNode.vy *= KNOWLEDGE_FORCE_PROFILE.velocityDecay;
      simNode.x += simNode.vx;
      simNode.y += simNode.vy;
    });
  }

  applyKnowledgeAntiLinearity(simNodes);
  compactKnowledgeLayout(simNodes);

  const layout = new Map();
  simNodes.forEach((simNode) => {
    setNodeCenter(layout, simNode.node, { x: simNode.x, y: simNode.y });
  });
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

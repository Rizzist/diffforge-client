import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
} from "@xyflow/react";
import ELK from "elkjs/lib/elk.bundled.js";
import { KeyboardArrowLeft } from "@styled-icons/material-rounded/KeyboardArrowLeft";
import styled from "styled-components";
import "@xyflow/react/dist/style.css";

const SPEC_GRAPH_CACHE_EVENT = "cloud-mcp-spec-graph-cache";
const MAX_VISIBLE_AGENT_ORBITS = 6;
const elk = new ELK();

const NODE_DIMENSIONS = {
  workspace: { width: 172, height: 172 },
  folder: { width: 150, height: 92 },
  file: { width: 136, height: 78 },
  abstract: { width: 166, height: 104 },
};

function cleanText(value) {
  return String(value || "")
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, " ")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, " ")
    .replace(/\x1BO./g, " ")
    .replace(/\x1B[@-Z\\-_]/g, " ")
    .replace(/\[(?:\??\d[\d;?]*|[OI])[@-~]?/g, " ")
    .replace(/\]\d+;rgb:[^\s\\]*(?:\\)?/gi, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .trim();
}

function text(value, fallback = "") {
  const cleaned = cleanText(value);
  return cleaned || fallback;
}

function field(item, ...keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function booleanField(item, ...keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
    }
  }
  return false;
}

function jsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function metadata(item) {
  return jsonObject(field(item, "metadata", "metadata_json", "metadataJson"));
}

function isFileNodeType(nodeType) {
  return nodeType === "file" || nodeType === "implementation_unit";
}

function isFolderNodeType(nodeType) {
  return nodeType === "folder";
}

function isWorkspaceNodeType(nodeType) {
  return ["workspace", "repository", "repo_root", "root"].includes(nodeType);
}

function nodeKind(node) {
  if (isWorkspaceNodeType(node?.node_type)) return "workspace";
  if (isFolderNodeType(node?.node_type)) return "folder";
  if (isFileNodeType(node?.node_type)) return "file";
  return "abstract";
}

function normalizeFreshnessState(value) {
  switch (text(value).toLowerCase()) {
    case "updated":
    case "in_sync":
    case "verified":
    case "linked":
      return "updated";
    case "no_spec":
    case "uncovered":
    case "not_specified":
      return "no_spec";
    case "behind_code":
    case "code_ahead":
    case "needs_review":
    case "review":
    case "stale":
      return "behind_code";
    case "out_of_spec":
    case "incomplete":
    case "cancelled":
    case "interrupted":
      return "out_of_spec";
    case "ahead_of_code":
    case "spec_ahead":
    case "candidate":
    case "none":
    case "unknown":
    default:
      return "ahead_of_code";
  }
}

function freshnessLabel(value) {
  switch (normalizeFreshnessState(value)) {
    case "updated":
      return "updated";
    case "no_spec":
      return "no spec";
    case "behind_code":
      return "behind code";
    case "out_of_spec":
      return "out of spec";
    case "ahead_of_code":
    default:
      return "ahead of code";
  }
}

function freshnessTone(value) {
  switch (normalizeFreshnessState(value)) {
    case "updated":
      return "#34d399";
    case "no_spec":
      return "#64748b";
    case "behind_code":
      return "#fb7185";
    case "out_of_spec":
      return "#fb923c";
    case "ahead_of_code":
    default:
      return "#fbbf24";
  }
}

function isWorktreeFileNode(node) {
  if (!isFileNodeType(node?.node_type)) return false;
  if (isLeasedFileNode(node)) return false;
  return node.file_source === "worktree" || node.provisional || node.pending_main_sync;
}

function isLeasedFileNode(node) {
  if (!isFileNodeType(node?.node_type)) return false;
  return node.file_source === "lease"
    || node.file_origin === "lease"
    || node.file_state === "lease"
    || node.lease_state === "active";
}

function isLocalOnlyNode(node) {
  return node?.local_only === true
    || node?.ignored_overlay === true
    || node?.file_source === "local_ignored";
}

function hasActiveSpecs(node) {
  return Array.isArray(node?.active_specs) && node.active_specs.length > 0;
}

function isUnspecifiedStructuralNode(node) {
  return ["workspace", "folder", "file"].includes(nodeKind(node)) && !hasActiveSpecs(node);
}

function nodeTone(node) {
  if (isUnspecifiedStructuralNode(node)) return "#64748b";
  if (isLeasedFileNode(node)) return "#f59e0b";
  if (isWorktreeFileNode(node)) return "#38bdf8";
  if (isWorkspaceNodeType(node?.node_type)) return "#2dd4bf";
  if (isFolderNodeType(node?.node_type)) return "#a78bfa";
  return freshnessTone(node?.freshness_state);
}

function liveAgentsFor(node) {
  const activeAgents = jsonArray(field(node, "active_agents", "activeAgents", "live_agents", "liveAgents"));
  if (activeAgents.length) return activeAgents;
  const count = Number(field(node, "active_agent_count", "activeAgentCount", "live_agent_count", "liveAgentCount")) || 0;
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({ id: `live-agent-${index}` }));
}

function normalizeNode(raw, index = 0) {
  const meta = metadata(raw);
  const id = text(field(raw, "id", "node_id", "nodeId", "task_id", "taskId"), `spec-${index}`);
  const title = text(field(raw, "title", "summary"), "Untitled spec");
  const nodeType = text(field(raw, "node_type", "nodeType", "type"), "feature").toLowerCase();
  const summary = text(field(raw, "summary", "current_summary", "body", "description"), "");
  const purpose = text(field(raw, "purpose"), summary || "Intentional behavior captured from prompts, checkpoints, and patch history.");
  const rawMarkdown = field(raw, "markdown");
  const freshnessState = normalizeFreshnessState(field(raw, "freshness_state", "freshnessState", "spec_state", "specState"));
  const activeAgents = jsonArray(field(raw, "active_agents", "activeAgents", "live_agents", "liveAgents"));
  const activeAgentCount = Math.max(
    activeAgents.length,
    Number(field(raw, "active_agent_count", "activeAgentCount", "live_agent_count", "liveAgentCount")) || 0,
  );
  const fileSource = text(
    field(raw, "file_source", "fileSource") || field(meta, "source", "file_source", "fileSource"),
  ).toLowerCase();
  const fileOrigin = text(
    field(raw, "file_origin", "fileOrigin") || field(meta, "origin", "file_origin", "fileOrigin"),
    fileSource,
  ).toLowerCase();
  const provisional = booleanField(raw, "provisional", "isProvisional") || booleanField(meta, "provisional", "isProvisional");
  const pendingMainSync = booleanField(raw, "pending_main_sync", "pendingMainSync")
    || booleanField(meta, "pending_main_sync", "pendingMainSync");
  const fileState = text(
    field(raw, "file_state", "fileState") || field(meta, "file_state", "fileState"),
  ).toLowerCase();
  const leaseState = text(
    field(raw, "lease_state", "leaseState") || field(meta, "lease_state", "leaseState"),
  ).toLowerCase();
  const localOnly = booleanField(raw, "local_only", "localOnly")
    || booleanField(meta, "local_only", "localOnly");
  const ignoredOverlay = booleanField(raw, "ignored_overlay", "ignoredOverlay")
    || booleanField(meta, "ignored_overlay", "ignoredOverlay");
  const notificationCount = Math.max(
    0,
    Number(field(raw, "notification_count", "notificationCount", "out_of_spec_count", "outOfSpecCount")) || 0,
  );
  const outOfSpecCount = Math.max(
    notificationCount,
    Number(field(raw, "out_of_spec_count", "outOfSpecCount")) || 0,
  );
  return {
    ...raw,
    id,
    title,
    node_type: nodeType,
    path: text(field(raw, "path") || field(meta, "path")),
    summary,
    purpose,
    freshness_state: freshnessState,
    spec_state: freshnessState,
    spec_state_label: freshnessLabel(freshnessState),
    active_agent_count: activeAgentCount,
    active_agents: activeAgents,
    specs: jsonArray(field(raw, "specs")),
    active_specs: jsonArray(field(raw, "active_specs", "activeSpecs")),
    superseded_specs: jsonArray(field(raw, "superseded_specs", "supersededSpecs")),
    agent_rationale: jsonArray(field(raw, "agent_rationale", "agentRationale")),
    notifications: jsonArray(field(raw, "notifications")),
    notification_count: notificationCount,
    out_of_spec_count: outOfSpecCount,
    file_source: fileSource,
    file_origin: fileOrigin,
    file_state: fileState,
    lease_state: leaseState,
    local_only: localOnly,
    ignored_overlay: ignoredOverlay,
    provisional,
    pending_main_sync: pendingMainSync,
    markdown: typeof rawMarkdown === "string" && rawMarkdown.trim()
      ? rawMarkdown
      : fallbackMarkdown({ title, summary, purpose, freshness_state: freshnessState }),
    markdown_path: text(field(raw, "markdown_path", "markdownPath")),
    metadata: meta,
  };
}

function fallbackMarkdown(node) {
  return [
    `# ${node.title || "Spec Node"}`,
    "",
    node.summary || node.purpose || "No spec summary has been recorded yet.",
    "",
    `Spec status: \`${freshnessLabel(node.freshness_state)}\``,
  ].join("\n");
}

function isConsolidationSpec(spec) {
  const reason = text(field(spec, "supersession_reason", "supersessionReason")).toLowerCase();
  return ["consolidat", "merg", "incorporat", "absorb", "combin", "roll into", "rolled into"]
    .some((marker) => reason.includes(marker));
}

function splitSpecHistory(activeSpecs, supersededSpecs) {
  const active = Array.isArray(activeSpecs) ? activeSpecs : [];
  const superseded = Array.isArray(supersededSpecs) ? supersededSpecs : [];
  const activeIds = new Set(active.map((spec) => text(field(spec, "id"))).filter(Boolean));
  const consolidatedByActiveId = new Map(active.map((spec) => [text(field(spec, "id")), []]));
  const historical = [];

  superseded.forEach((spec) => {
    if (!isConsolidationSpec(spec)) {
      historical.push(spec);
      return;
    }
    const targetId = text(field(spec, "superseded_by_id", "supersededById"));
    if (targetId && activeIds.has(targetId)) {
      consolidatedByActiveId.get(targetId).push(spec);
      return;
    }
    if (active.length === 1) {
      const onlyActiveId = text(field(active[0], "id"));
      consolidatedByActiveId.get(onlyActiveId)?.push(spec);
    }
  });

  return {
    active: active.map((spec) => ({
      ...spec,
      consolidated_specs: consolidatedByActiveId.get(text(field(spec, "id"))) || [],
    })),
    historical,
  };
}

function normalizeSnapshot(snapshot) {
  const matrix = snapshot?.specGraph || snapshot?.raw || {};
  const specNodes = Array.isArray(snapshot?.specNodes)
    ? snapshot.specNodes
    : Array.isArray(matrix?.nodes)
      ? matrix.nodes
      : [];
  const nodes = specNodes.map((node, index) => normalizeNode(node, index));
  const edgeSource = Array.isArray(snapshot?.specEdges)
    ? snapshot.specEdges
    : Array.isArray(matrix?.edges)
      ? matrix.edges
      : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = edgeSource
    .map((edge, index) => {
      const meta = metadata(edge);
      if (meta.hidden || field(edge, "hidden") === true) return null;
      return {
        id: text(field(edge, "id"), `edge-${index}`),
        from: text(field(edge, "from_node_id", "fromNodeId", "from", "source")),
        to: text(field(edge, "to_node_id", "toNodeId", "to", "target")),
        kind: text(field(edge, "edge_kind", "edgeKind", "kind"), "related"),
        metadata: meta,
      };
    })
    .filter(Boolean)
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  return {
    matrix,
    nodes,
    edges,
    agentWork: snapshot?.agentWork || matrix?.agent_work || {},
    graphStats: snapshot?.graphStats || matrix?.graph_stats || matrix?.graphStats || {},
  };
}

function mergeLocalIgnoredOverlay(graph, overlay, enabled) {
  if (!enabled || !overlay || typeof overlay !== "object") return graph;
  const overlayNodes = Array.isArray(overlay.nodes) ? overlay.nodes : [];
  if (!overlayNodes.length) return graph;

  const existingPaths = new Set(graph.nodes.map((node) => text(node.path)).filter(Boolean));
  const existingIds = new Set(graph.nodes.map((node) => node.id));
  const localNodes = overlayNodes
    .map((node, index) => normalizeNode(node, graph.nodes.length + index))
    .filter((node) => node.id && !existingIds.has(node.id))
    .filter((node) => {
      const path = text(node.path);
      return !path || !existingPaths.has(path);
    });
  if (!localNodes.length) return graph;

  const root = graphRootNode(graph.nodes, graph.edges);
  const localEdges = root
    ? localNodes.map((node) => ({
      id: `local-ignored-edge-${root.id}-${node.id}`,
      from: root.id,
      to: node.id,
      kind: "contains",
      metadata: {
        source: "local_ignored_overlay",
        visible: true,
        containment: true,
        local_only: true,
        ignored_overlay: true,
        path: node.path,
      },
    }))
    : [];

  return {
    ...graph,
    nodes: [...graph.nodes, ...localNodes],
    edges: [...graph.edges, ...localEdges],
    graphStats: {
      ...graph.graphStats,
      localIgnoredOverlayCount: localNodes.length,
      localIgnoredOverlayCacheHit: overlay.cache_hit === true,
    },
  };
}

function selectedFallback(nodes, selectedNodeId) {
  return nodes.find((node) => node.id === selectedNodeId) || nodes[0] || null;
}

function isContainmentEdge(edge) {
  return edge.kind === "contains" || edge.metadata?.containment === true;
}

function dimensionsForNode(node) {
  return NODE_DIMENSIONS[nodeKind(node)] || NODE_DIMENSIONS.abstract;
}

function graphRootNode(nodes, edges) {
  const workspaceNode = nodes.find((node) => isWorkspaceNodeType(node.node_type));
  if (workspaceNode) return workspaceNode;
  if (!nodes.length) return null;
  const degreeById = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (degreeById.has(edge.from)) degreeById.set(edge.from, degreeById.get(edge.from) + 1);
    if (degreeById.has(edge.to)) degreeById.set(edge.to, degreeById.get(edge.to) + 1);
  }
  return [...nodes].sort((left, right) => {
    const scoreFor = (node) => {
      const title = `${node.id} ${node.title}`.toLowerCase();
      const centralHint = title.includes("project") || title.includes("root") || title.includes("workspace") ? 160 : 0;
      const typeHint = isFileNodeType(node.node_type) ? -20 : 20;
      return centralHint + typeHint + (degreeById.get(node.id) || 0) * 20;
    };
    return scoreFor(right) - scoreFor(left) || left.title.localeCompare(right.title);
  })[0];
}

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

function radialHierarchyLayout(nodes, edges) {
  const root = graphRootNode(nodes, edges);
  if (!root) return new Map();

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
    const radius = (rootChild ? 282 : 178) + Math.min(120, Math.max(0, children.length - 3) * 10) + depth * 38;
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
      x: Math.cos(angle) * 360,
      y: Math.sin(angle) * 360,
    });
    placed.add(node.id);
  });

  const structuralKinds = new Set(["workspace", "folder", "file"]);
  const abstractNodes = nodes.filter((node) => !structuralKinds.has(nodeKind(node)));
  const rootCenter = centerFor(layout, root);
  abstractNodes.forEach((node, index) => {
    const linkedStructural = edges
      .filter((edge) => !isContainmentEdge(edge) && (edge.from === node.id || edge.to === node.id))
      .map((edge) => (edge.from === node.id ? edge.to : edge.from))
      .map((id) => nodeById.get(id))
      .filter((target) => target && ["workspace", "folder", "file"].includes(nodeKind(target)) && layout.has(target.id));

    if (linkedStructural.length) {
      const direction = linkedStructural.reduce(
        (acc, target) => {
          const center = centerFor(layout, target);
          const dx = center.x - rootCenter.x;
          const dy = center.y - rootCenter.y;
          const length = Math.hypot(dx, dy);
          if (length < 1) return acc;
          return { x: acc.x + dx / length, y: acc.y + dy / length };
        },
        { x: 0, y: 0 },
      );
      const directionLength = Math.hypot(direction.x, direction.y);
      const angle = directionLength > 0.25
        ? Math.atan2(direction.y, direction.x)
        : -Math.PI / 2 + ((index + 0.5) / Math.max(abstractNodes.length, 1)) * Math.PI * 2;
      const radius = 214 + Math.min(96, Math.max(0, linkedStructural.length - 1) * 18);
      const offset = ((index % 3) - 1) * 52;
      setNodeCenter(layout, node, {
        x: rootCenter.x + Math.cos(angle) * radius + Math.cos(angle + Math.PI / 2) * offset,
        y: rootCenter.y + Math.sin(angle) * radius + Math.sin(angle + Math.PI / 2) * offset,
      });
    } else {
      const angle = Math.PI / 5 + (index / Math.max(abstractNodes.length, 1)) * Math.PI * 2;
      setNodeCenter(layout, node, {
        x: Math.cos(angle) * 238,
        y: Math.sin(angle) * 238,
      });
    }
    placed.add(node.id);
  });

  const unplaced = nodes.filter((node) => !placed.has(node.id));
  unplaced.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / Math.max(unplaced.length, 1)) * Math.PI * 2;
    setNodeCenter(layout, node, {
      x: Math.cos(angle) * 460,
      y: Math.sin(angle) * 460,
    });
  });

  return layout;
}

async function elkFallbackLayout(nodes, edges) {
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

async function layoutSpecGraph(nodes, edges) {
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

function flowEdgeStyle(edge) {
  if (isContainmentEdge(edge)) {
    return {
      stroke: "rgba(148, 163, 184, 0.72)",
      strokeWidth: 3,
    };
  }
  return {
    stroke: "rgba(56, 189, 248, 0.82)",
    strokeWidth: 3.2,
  };
}

function toFlowEdges(edges) {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
    type: isContainmentEdge(edge) ? "straight" : "bezier",
    animated: !isContainmentEdge(edge),
    zIndex: isContainmentEdge(edge) ? 1 : 2,
    interactionWidth: 18,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: isContainmentEdge(edge) ? "rgba(148, 163, 184, 0.92)" : "rgba(56, 189, 248, 0.9)",
      width: 16,
      height: 16,
    },
    style: flowEdgeStyle(edge),
    data: edge,
  }));
}

const INVISIBLE_HANDLE_STYLE = {
  opacity: 0,
  pointerEvents: "none",
};

export default function SpecGraphWorkspaceView({
  defaultWorkingDirectory,
  rootDirectory,
  workspace,
}) {
  const repoPath = rootDirectory || defaultWorkingDirectory || "";
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [state, setState] = useState("idle");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [showLocalIgnored, setShowLocalIgnored] = useState(false);
  const [localIgnoredOverlay, setLocalIgnoredOverlay] = useState(null);
  const [localIgnoredState, setLocalIgnoredState] = useState("idle");
  const [localIgnoredError, setLocalIgnoredError] = useState("");

  const applySnapshot = useCallback((next) => {
    if (!next || typeof next !== "object") return;
    setSnapshot(next);
    setError(text(next.syncError || next.sync_error));
    setState(text(next.syncState || next.sync_state, "ready"));
  }, []);

  const loadLocalIgnoredOverlay = useCallback(() => {
    if (!repoPath) return;
    setLocalIgnoredState("loading");
    setLocalIgnoredError("");
    invoke("cloud_mcp_get_local_ignored_spec_graph_overlay", { repoPath })
      .then((overlay) => {
        setLocalIgnoredOverlay(overlay);
        setLocalIgnoredState("ready");
      })
      .catch((nextError) => {
        setLocalIgnoredError(nextError?.message || String(nextError));
        setLocalIgnoredState("error");
      });
  }, [repoPath]);

  useEffect(() => {
    if (!repoPath) return undefined;
    let cancelled = false;
    let unlistenCache = null;

    setState((current) => (current === "idle" ? "loading" : current));

    invoke("cloud_mcp_get_cached_spec_graph", {
      repoPath,
      workspaceId: workspace?.id || null,
      workspaceName: workspace?.name || null,
    })
      .then((next) => {
        if (!cancelled) applySnapshot(next);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError?.message || String(nextError));
          setState("error");
        }
      });

    listen(SPEC_GRAPH_CACHE_EVENT, (event) => {
      const next = event?.payload;
      if (!next || next.repoPath !== repoPath) return;
      applySnapshot(next);
    }).then((nextUnlisten) => {
      if (cancelled) {
        nextUnlisten();
        return;
      }
      unlistenCache = nextUnlisten;
    });

    invoke("cloud_mcp_start_spec_graph_sync", {
      repoPath,
      workspaceId: workspace?.id || null,
      workspaceName: workspace?.name || null,
    })
      .then((next) => {
        if (!cancelled) applySnapshot(next);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError?.message || String(nextError));
          setState("error");
        }
      });

    return () => {
      cancelled = true;
      if (typeof unlistenCache === "function") unlistenCache();
    };
  }, [applySnapshot, repoPath, workspace?.id, workspace?.name]);

  useEffect(() => {
    if (showLocalIgnored) loadLocalIgnoredOverlay();
  }, [loadLocalIgnoredOverlay, showLocalIgnored]);

  const baseSpecGraph = useMemo(() => normalizeSnapshot(snapshot), [snapshot]);
  const specGraph = useMemo(
    () => mergeLocalIgnoredOverlay(baseSpecGraph, localIgnoredOverlay, showLocalIgnored),
    [baseSpecGraph, localIgnoredOverlay, showLocalIgnored],
  );
  const selectedNode = selectedFallback(specGraph.nodes, selectedNodeId);
  const localIgnoredCount = Array.isArray(localIgnoredOverlay?.nodes)
    ? localIgnoredOverlay.nodes.length
    : 0;

  useEffect(() => {
    if (specGraph.nodes.length && !specGraph.nodes.some((node) => node.id === selectedNodeId)) {
      const root = graphRootNode(specGraph.nodes, specGraph.edges);
      setSelectedNodeId(root?.id || specGraph.nodes[0].id);
    }
  }, [specGraph.edges, specGraph.nodes, selectedNodeId]);

  return (
    <SpecGraphSurface aria-label={`${workspace?.name || "Workspace"} Spec Graph`} data-state={state}>
      {error && <SpecGraphError>{error}</SpecGraphError>}
      {localIgnoredError && <SpecGraphError>{localIgnoredError}</SpecGraphError>}

      <SpecGraphToolbar>
        <LocalIgnoredToggle
          type="button"
          data-active={showLocalIgnored ? "true" : "false"}
          onClick={() => {
            setShowLocalIgnored((current) => !current);
          }}
        >
          {showLocalIgnored ? "Hide local ignored" : "Show local ignored"}
        </LocalIgnoredToggle>
        <LocalIgnoredHint>
          {localIgnoredState === "loading"
            ? "checking .agents cache"
            : showLocalIgnored
              ? `${localIgnoredCount} local-only whitelisted path${localIgnoredCount === 1 ? "" : "s"}`
              : "local only, not synced"}
        </LocalIgnoredHint>
      </SpecGraphToolbar>

      <SpecGraphShell>
        <SpecGraphMain>
          <GraphView
            nodes={specGraph.nodes}
            edges={specGraph.edges}
            selectedNodeId={selectedNode?.id}
            onSelect={setSelectedNodeId}
            state={state}
          />
        </SpecGraphMain>

        <SpecInspector node={selectedNode} />
      </SpecGraphShell>
    </SpecGraphSurface>
  );
}

function GraphView({ nodes, edges, selectedNodeId, onSelect, state }) {
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState([]);
  const flowInstanceRef = useRef(null);
  const lastFitTopologyRef = useRef("");
  const nodeTypes = useMemo(() => ({ specGraphNode: SpecGraphNode }), []);

  useEffect(() => {
    let cancelled = false;
    if (!nodes.length) {
      setFlowNodes([]);
      setFlowEdges([]);
      lastFitTopologyRef.current = "";
      return () => {
        cancelled = true;
      };
    }

    const topologyKey = `${nodes.map((node) => node.id).join("|")}:${edges.map((edge) => edge.id).join("|")}`;
    layoutSpecGraph(nodes, edges).then((layout) => {
      if (cancelled) return;
      const nextNodes = nodes.map((node) => {
        const dimensions = dimensionsForNode(node);
        return {
          id: node.id,
          type: "specGraphNode",
          position: layout.get(node.id) || { x: 0, y: 0 },
          data: {
            node,
            onSelect,
            selected: false,
          },
          draggable: false,
          selectable: true,
          style: {
            width: dimensions.width,
            height: dimensions.height,
          },
        };
      });
      setFlowNodes(nextNodes);
      setFlowEdges(toFlowEdges(edges));
      if (topologyKey !== lastFitTopologyRef.current) {
        lastFitTopologyRef.current = topologyKey;
        window.requestAnimationFrame(() => {
          flowInstanceRef.current?.fitView({ padding: 0.18, duration: 360 });
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [edges, nodes, onSelect, setFlowEdges, setFlowNodes]);

  useEffect(() => {
    setFlowNodes((current) => current.map((node) => ({
      ...node,
      data: {
        ...node.data,
        selected: node.id === selectedNodeId,
      },
    })));
  }, [selectedNodeId, setFlowNodes]);

  if (!nodes.length) {
    const isSyncing = ["loading", "syncing"].includes(state);
    return <EmptyState>{isSyncing ? "Syncing spec graph..." : "No spec graph nodes yet."}</EmptyState>;
  }

  return (
    <FlowFrame>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={(instance) => {
          flowInstanceRef.current = instance;
        }}
        onNodeClick={(_, node) => onSelect(node.id)}
        fitView
        fitViewOptions={{ padding: 0.18, duration: 360 }}
        minZoom={0.18}
        maxZoom={1.8}
        nodesConnectable={false}
        nodesDraggable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background color="rgba(148, 163, 184, 0.08)" gap={28} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </FlowFrame>
  );
}

function SpecGraphNode({ data, selected }) {
  const node = data.node;
  const kind = nodeKind(node);
  const tone = nodeTone(node);
  const liveAgents = liveAgentsFor(node);
  const liveAgentCount = liveAgents.length;
  const outOfSpecCount = Number(node.out_of_spec_count || node.notification_count) || 0;
  const active = Boolean(selected || data.selected);
  const path = text(node.path);
  const leased = isLeasedFileNode(node);
  const worktree = isWorktreeFileNode(node);

  return (
    <FlowNodeCard
      className="nodrag"
      type="button"
      $active={active}
      $kind={kind}
      $tone={tone}
      $live={liveAgentCount > 0}
      $provisional={worktree}
      $leased={leased}
      $unspecified={isUnspecifiedStructuralNode(node)}
      onClick={(event) => {
        event.stopPropagation();
        data.onSelect(node.id);
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} style={INVISIBLE_HANDLE_STYLE} />
      <Handle type="source" position={Position.Bottom} isConnectable={false} style={INVISIBLE_HANDLE_STYLE} />
      {liveAgents.slice(0, MAX_VISIBLE_AGENT_ORBITS).map((agent, index) => (
        <ActiveAgentOrbit
          key={`${node.id}-orbit-${field(agent, "agent_id", "agentId", "id") || index}`}
          aria-hidden="true"
          $tone={tone}
          $index={index}
          $total={liveAgentCount}
        />
      ))}
      {liveAgentCount > 0 && <AgentCountBadge>{liveAgentCount}</AgentCountBadge>}
      {outOfSpecCount > 0 && <OutOfSpecBadge title={`${outOfSpecCount} out of spec`}>{outOfSpecCount}</OutOfSpecBadge>}
      <NodeKindLabel $kind={kind}>{isUnspecifiedStructuralNode(node) ? "no spec" : leased ? "leased" : kind}</NodeKindLabel>
      <NodeTitle $kind={kind}>{node.title}</NodeTitle>
      {path && kind !== "workspace" && <NodePath>{path}</NodePath>}
    </FlowNodeCard>
  );
}

function SpecInspector({ node }) {
  if (!node) {
    return (
      <Inspector>
        <InspectorEmpty>Select a spec node.</InspectorEmpty>
      </Inspector>
    );
  }

  const specHistory = splitSpecHistory(node.active_specs, node.superseded_specs);

  return (
    <Inspector>
      <InspectorHeader>
        <h2>{node.title}</h2>
        <InspectorFacts>
          <span data-state={node.freshness_state}>{freshnessLabel(node.freshness_state)}</span>
          {isUnspecifiedStructuralNode(node) && <span data-state="no_spec">structural</span>}
          {isLocalOnlyNode(node) && <span data-state="local_only">local only</span>}
          {isLeasedFileNode(node) && <span data-state="leased">leased</span>}
          {isWorktreeFileNode(node) && <span data-state="worktree">worktree</span>}
          <span>{node.active_agent_count} {node.active_agent_count === 1 ? "agent" : "agents"}</span>
          {(Number(node.out_of_spec_count || node.notification_count) || 0) > 0 && (
            <span data-state="out_of_spec">out of spec: {Number(node.out_of_spec_count || node.notification_count) || 0}</span>
          )}
        </InspectorFacts>
      </InspectorHeader>
      <MarkdownPane>
        <SpecObjectList title="Active Specs" specs={specHistory.active} empty="No active specs recorded yet." />
        <SpecObjectList
          title="Superseded History"
          specs={specHistory.historical}
          empty="No superseded specs yet."
          historical
        />
      </MarkdownPane>
    </Inspector>
  );
}

function SpecObjectList({ title, specs, empty, historical = false }) {
  const visibleSpecs = Array.isArray(specs) ? specs : [];
  const [expandedPriorSpecs, setExpandedPriorSpecs] = useState({});
  const togglePriorSpecs = useCallback((specKey) => {
    setExpandedPriorSpecs((current) => ({
      ...current,
      [specKey]: !current[specKey],
    }));
  }, []);

  return (
    <SpecObjectsSection>
      <h3>{title}</h3>
      {visibleSpecs.length ? (
        visibleSpecs.map((spec, index) => {
          const specKey = field(spec, "id") || `${title}-${index}`;
          const priorSpecs = Array.isArray(spec.consolidated_specs) ? spec.consolidated_specs : [];
          const priorSpecsExpanded = Boolean(expandedPriorSpecs[specKey]);
          return (
            <SpecObjectCard key={specKey} $historical={historical}>
              <p>{text(field(spec, "statement"), "Unnamed spec")}</p>
              {priorSpecs.length > 0 && (
                <>
                  <PriorSpecsButton
                    type="button"
                    aria-expanded={priorSpecsExpanded ? "true" : "false"}
                    $expanded={priorSpecsExpanded}
                    onClick={() => togglePriorSpecs(specKey)}
                  >
                    <PriorSpecsIcon aria-hidden="true" />
                    {priorSpecs.length} prior {priorSpecs.length === 1 ? "version" : "versions"}
                  </PriorSpecsButton>
                  {priorSpecsExpanded && (
                    <PriorSpecsList>
                      {priorSpecs.map((priorSpec, priorIndex) => (
                        <PriorSpecItem key={field(priorSpec, "id") || `${specKey}-prior-${priorIndex}`}>
                          <span>Previously</span>
                          <p>{text(field(priorSpec, "statement"), "Unnamed spec")}</p>
                          {text(field(priorSpec, "supersession_reason")) && (
                            <small>{text(field(priorSpec, "supersession_reason"))}</small>
                          )}
                        </PriorSpecItem>
                      ))}
                    </PriorSpecsList>
                  )}
                </>
              )}
              {historical && text(field(spec, "supersession_reason")) && (
                <small>Reason: {text(field(spec, "supersession_reason"))}</small>
              )}
            </SpecObjectCard>
          );
        })
      ) : (
        <SpecObjectsEmpty>{empty}</SpecObjectsEmpty>
      )}
    </SpecObjectsSection>
  );
}

const SpecGraphSurface = styled.section`
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 10px;
  background:
    linear-gradient(180deg, rgba(17, 24, 39, 0.95), rgba(10, 11, 14, 0.96)),
    #0a0b0e;
  color: var(--forge-text, #dbe7f7);
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SpecGraphError = styled.div`
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: 8px;
  background: rgba(127, 29, 29, 0.22);
  color: #fecaca;
  padding: 10px;
`;

const SpecGraphToolbar = styled.div`
  align-items: center;
  display: flex;
  gap: 10px;
  justify-content: flex-start;
  min-height: 34px;
`;

const LocalIgnoredToggle = styled.button`
  background: rgba(15, 23, 42, 0.88);
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.84);
  cursor: pointer;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.06em;
  padding: 8px 12px;
  text-transform: uppercase;
  transition: border-color 160ms ease, color 160ms ease, transform 160ms ease;

  &[data-active="true"] {
    border-color: rgba(251, 191, 36, 0.68);
    color: #fde68a;
  }

  &:hover {
    border-color: rgba(251, 191, 36, 0.72);
    color: #fef3c7;
    transform: translateY(-1px);
  }
`;

const LocalIgnoredHint = styled.span`
  color: rgba(148, 163, 184, 0.78);
  font-size: 11px;
  font-weight: 760;
`;

const SpecGraphShell = styled.div`
  align-items: stretch;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 34%);
  gap: 10px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: hidden;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 1fr) minmax(260px, 40%);
  }
`;

const SpecGraphMain = styled.main`
  border: 1px solid rgba(230, 236, 245, 0.07);
  border-radius: 8px;
  background: rgba(7, 9, 13, 0.58);
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const FlowFrame = styled.div`
  height: 100%;
  min-height: 0;
  position: relative;

  .react-flow {
    background: rgba(3, 6, 11, 0.62);
  }

  .react-flow__node {
    transition: transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .react-flow__edges {
    z-index: 3;
  }

  .react-flow__edge {
    z-index: 3 !important;
  }

  .react-flow__edge-path {
    transition: stroke 180ms ease, stroke-width 180ms ease;
    filter: drop-shadow(0 0 8px rgba(125, 211, 252, 0.45));
    stroke-linecap: round;
  }

  .react-flow__controls {
    border: 1px solid rgba(230, 236, 245, 0.1);
    border-radius: 8px;
    overflow: hidden;
    box-shadow: none;
  }

  .react-flow__controls-button {
    background: rgba(13, 17, 23, 0.92);
    border-bottom-color: rgba(230, 236, 245, 0.08);
    color: rgba(219, 231, 247, 0.82);
  }
`;

const FlowNodeCard = styled.button`
  align-items: center;
  border: 1px solid ${({ $active, $leased, $provisional, $tone }) => ($active || $leased || $provisional ? $tone : "rgba(230, 236, 245, 0.14)")};
  border-radius: ${({ $kind }) => {
    if ($kind === "folder") return "12px";
    if ($kind === "file") return "9px";
    return "999px";
  }};
  background:
    radial-gradient(circle at 48% 38%, ${({ $tone }) => `${$tone || "#38bdf8"}26`}, rgba(13, 17, 23, 0.88) 62%),
    rgba(13, 17, 23, 0.94);
  box-shadow: ${({ $active, $leased, $live, $provisional, $tone }) => {
    if ($active) return `0 0 0 2px ${$tone}55, 0 18px 44px rgba(0, 0, 0, 0.34)`;
    if ($leased) return `0 0 0 1px ${$tone}55, 0 0 26px ${$tone}22, 0 12px 30px rgba(0, 0, 0, 0.24)`;
    if ($provisional) return `0 0 0 1px ${$tone}44, 0 0 24px ${$tone}22, 0 12px 30px rgba(0, 0, 0, 0.24)`;
    if ($live) return `0 0 0 1px ${$tone}33, 0 12px 30px rgba(0, 0, 0, 0.24)`;
    return "0 12px 30px rgba(0, 0, 0, 0.2)";
  }};
  color: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  height: 100%;
  justify-content: center;
  opacity: ${({ $unspecified }) => ($unspecified ? 0.68 : 1)};
  outline: ${({ $leased, $provisional, $tone }) => ($leased || $provisional ? `1px dashed ${$tone}66` : "none")};
  outline-offset: 4px;
  overflow: visible;
  padding: ${({ $kind }) => ($kind === "workspace" ? "20px" : "10px 12px")};
  position: relative;
  text-align: center;
  width: 100%;

  &::before {
    background: ${({ $kind, $tone }) => ($kind === "folder" ? `${$tone || "#a78bfa"}66` : "transparent")};
    border-radius: 8px 8px 3px 3px;
    content: "";
    display: ${({ $kind }) => ($kind === "folder" ? "block" : "none")};
    height: 9px;
    left: 14px;
    position: absolute;
    top: -7px;
    width: 38px;
  }

  &:hover {
    border-color: ${({ $tone }) => $tone || "#38bdf8"};
    transform: scale(1.025);
  }
`;

const NodeKindLabel = styled.span`
  color: ${({ $kind }) => ($kind === "workspace" ? "rgba(167, 243, 208, 0.84)" : "rgba(219, 231, 247, 0.45)")};
  font-size: ${({ $kind }) => ($kind === "workspace" ? "10px" : "8.5px")};
  font-weight: 900;
  letter-spacing: 0.08em;
  line-height: 1;
  text-transform: uppercase;
`;

const NodeTitle = styled.div`
  color: var(--forge-text-soft, #eef5ff);
  display: -webkit-box;
  font-size: ${({ $kind }) => ($kind === "workspace" ? "14px" : $kind === "abstract" ? "12px" : "11px")};
  font-weight: 840;
  line-height: 1.18;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: ${({ $kind }) => ($kind === "workspace" ? 5 : 3)};
  word-break: break-word;
`;

const NodePath = styled.div`
  color: rgba(219, 231, 247, 0.45);
  font-size: 8.5px;
  font-weight: 680;
  line-height: 1.15;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AgentCountBadge = styled.span`
  align-items: center;
  background: rgba(7, 12, 19, 0.92);
  border: 1px solid rgba(230, 236, 245, 0.16);
  border-radius: 999px;
  color: #f8fafc;
  display: inline-flex;
  font-size: 10px;
  font-weight: 900;
  height: 22px;
  justify-content: center;
  min-width: 22px;
  padding: 0 6px;
  position: absolute;
  right: -7px;
  top: -7px;
  z-index: 3;
`;

const OutOfSpecBadge = styled.span`
  align-items: center;
  background: rgba(124, 45, 18, 0.94);
  border: 1px solid rgba(251, 146, 60, 0.58);
  border-radius: 999px;
  color: #ffedd5;
  display: inline-flex;
  font-size: 10px;
  font-weight: 920;
  height: 22px;
  justify-content: center;
  left: -7px;
  min-width: 22px;
  padding: 0 6px;
  position: absolute;
  top: -7px;
  z-index: 3;
`;

const ActiveAgentOrbit = styled.span`
  animation: spec-node-agent-orbit ${({ $index }) => `${2.7 + (($index || 0) * 0.42)}s`} linear infinite ${({ $index }) => ($index % 2 ? "reverse" : "normal")};
  animation-delay: ${({ $index }) => `${-0.28 * ($index || 0)}s`};
  border-radius: 999px;
  inset: ${({ $index }) => `-${10 + (($index || 0) * 5)}px`};
  pointer-events: none;
  position: absolute;
  z-index: 2;

  &::before {
    background: ${({ $tone }) => $tone || "#34d399"};
    border: 2px solid rgba(7, 12, 19, 0.96);
    border-radius: 999px;
    box-shadow:
      0 0 0 ${({ $total }) => ($total > 1 ? "3px" : "2px")} ${({ $tone }) => `${$tone || "#34d399"}33`},
      0 0 18px ${({ $tone }) => `${$tone || "#34d399"}99`};
    content: "";
    height: 9px;
    position: absolute;
    right: 0;
    top: ${({ $index, $total }) => {
      if (($total || 0) < 2) return "50%";
      const spread = (($index || 0) % 3) - 1;
      return `${50 + spread * 9}%`;
    }};
    transform: translate(50%, -50%);
    width: 9px;
  }

  @keyframes spec-node-agent-orbit {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
`;

const Inspector = styled.aside`
  border: 1px solid rgba(230, 236, 245, 0.07);
  border-radius: 8px;
  background: rgba(13, 17, 23, 0.72);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const InspectorHeader = styled.header`
  align-items: flex-start;
  border-bottom: 1px solid rgba(230, 236, 245, 0.07);
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 12px;

  h2 {
    color: var(--forge-text-soft, #eef5ff);
    font-size: 14px;
    font-weight: 820;
    line-height: 1.24;
    margin: 0;
    min-width: 0;
  }
`;

const InspectorFacts = styled.div`
  align-items: flex-end;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 5px;

  span {
    border: 1px solid rgba(230, 236, 245, 0.12);
    border-radius: 999px;
    color: rgba(238, 245, 255, 0.82);
    font-size: 10px;
    font-weight: 820;
    line-height: 1;
    padding: 5px 8px;
    text-transform: lowercase;
  }

  span[data-state="updated"] {
    border-color: rgba(52, 211, 153, 0.3);
    color: #86efac;
  }

  span[data-state="behind_code"] {
    border-color: rgba(251, 113, 133, 0.3);
    color: #fda4af;
  }

  span[data-state="ahead_of_code"] {
    border-color: rgba(251, 191, 36, 0.3);
    color: #fde68a;
  }

  span[data-state="no_spec"] {
    border-color: rgba(100, 116, 139, 0.38);
    color: #cbd5e1;
  }

  span[data-state="out_of_spec"] {
    border-color: rgba(251, 146, 60, 0.38);
    color: #fed7aa;
  }

  span[data-state="worktree"] {
    border-color: rgba(56, 189, 248, 0.42);
    color: #bae6fd;
  }
`;

const MarkdownPane = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
`;

const SpecObjectsSection = styled.section`
  border-top: 1px solid rgba(230, 236, 245, 0.07);
  padding: 12px;

  h3 {
    color: rgba(238, 245, 255, 0.72);
    font-size: 10px;
    font-weight: 860;
    letter-spacing: 0.08em;
    margin: 0 0 8px;
    text-transform: uppercase;
  }
`;

const SpecObjectCard = styled.article`
  border: 1px solid ${({ $historical }) => ($historical ? "rgba(148, 163, 184, 0.16)" : "rgba(52, 211, 153, 0.18)")};
  border-radius: 8px;
  background: ${({ $historical }) => ($historical ? "rgba(15, 23, 42, 0.38)" : "rgba(6, 78, 59, 0.14)")};
  padding: 9px 10px;

  & + & {
    margin-top: 7px;
  }

  p {
    color: rgba(229, 236, 246, ${({ $historical }) => ($historical ? 0.58 : 0.86)});
    font-size: 11px;
    font-weight: 650;
    line-height: 1.45;
    margin: 0;
  }

  small {
    color: rgba(251, 191, 36, 0.82);
    display: block;
    font-size: 10px;
    font-weight: 650;
    line-height: 1.4;
    margin-top: 7px;
  }
`;

const PriorSpecsButton = styled.button`
  align-items: center;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 999px;
  background: rgba(7, 12, 19, 0.38);
  color: rgba(219, 231, 247, 0.66);
  cursor: pointer;
  display: inline-flex;
  font-size: 10px;
  font-weight: 780;
  gap: 3px;
  line-height: 1;
  margin-top: 8px;
  padding: 5px 8px 5px 6px;

  &:hover {
    border-color: rgba(52, 211, 153, 0.24);
    color: rgba(238, 245, 255, 0.9);
  }

  svg {
    transform: ${({ $expanded }) => ($expanded ? "rotate(-90deg)" : "rotate(0deg)")};
  }
`;

const PriorSpecsIcon = styled(KeyboardArrowLeft)`
  height: 14px;
  transition: transform 140ms ease;
  width: 14px;
`;

const PriorSpecsList = styled.div`
  border-left: 1px solid rgba(52, 211, 153, 0.18);
  display: grid;
  gap: 7px;
  margin-top: 8px;
  padding-left: 9px;
`;

const PriorSpecItem = styled.div`
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.36);
  padding: 8px 9px;

  span {
    color: rgba(219, 231, 247, 0.42);
    display: block;
    font-size: 9px;
    font-weight: 850;
    letter-spacing: 0.06em;
    line-height: 1;
    margin-bottom: 5px;
    text-transform: uppercase;
  }

  p {
    color: rgba(229, 236, 246, 0.68);
    font-size: 10.5px;
    font-weight: 640;
    line-height: 1.42;
    margin: 0;
  }

  small {
    color: rgba(251, 191, 36, 0.74);
  }
`;

const SpecObjectsEmpty = styled.div`
  color: rgba(219, 231, 247, 0.38);
  font-size: 11px;
  font-weight: 650;
`;

const InspectorEmpty = styled.div`
  color: rgba(219, 231, 247, 0.48);
  font-size: 12px;
  font-weight: 680;
  padding: 14px;
`;

const EmptyState = styled.div`
  color: rgba(219, 231, 247, 0.48);
  font-size: 12px;
  font-weight: 680;
  padding: 14px;
`;

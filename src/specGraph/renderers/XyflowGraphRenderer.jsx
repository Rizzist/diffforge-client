import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  BaseEdge,
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getStraightPath,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import styled from "styled-components";
import "@xyflow/react/dist/style.css";
import { buildKnowledgeOutwardHierarchy } from "../specGraphLayout.js";
import {
  dimensionsForNode,
  field,
  isContainmentEdge,
  isNoSpecNode,
  liveAgentsFor,
  nodeKind,
  nodeSourceState,
  nodeSourceTone,
  nodeTone,
  text,
} from "../specGraphCore.js";

const MAX_VISIBLE_AGENT_ORBITS = 6;
const EMPTY_LAYOUT = new Map();
const KIND_TONES = {
  workspace: "#2dd4bf",
  folder: "#a78bfa",
  file: "#60a5fa",
  abstract: "#c084fc",
};
const LIGHT_READABLE_TONES = {
  "#22c55e": "#0a7f45",
  "#34d399": "#047857",
  "#38bdf8": "#0066cc",
  "#60a5fa": "#0066cc",
  "#2dd4bf": "#0f766e",
  "#a78bfa": "#6d28d9",
  "#c084fc": "#7e22ce",
  "#f59e0b": "#8b5a00",
  "#fbbf24": "#8b5a00",
  "#fb923c": "#9a3412",
  "#fb7185": "#b42318",
  "#94a3b8": "#64748b",
  "#64748b": "#475569",
};
const KNOWLEDGE_NODE_DIMENSIONS = {
  root: { width: 190, height: 118 },
  branch: { width: 168, height: 98 },
  nested: { width: 142, height: 78 },
  deep: { width: 120, height: 66 },
};
const KNOWLEDGE_DOT_CENTER = { x: 0.5, y: 0.55 };
const KNOWLEDGE_DOT_RADIUS = {
  root: 24,
  branch: 18,
  nested: 13,
  deep: 10,
};
const KNOWLEDGE_BRANCH_TONES = [
  "#38bdf8",
  "#2dd4bf",
  "#a78bfa",
  "#f59e0b",
  "#fb7185",
  "#34d399",
  "#f472b6",
  "#fbbf24",
];
const VIEWPORT_FIT_DELAYS = [90, 240];

const EDGE_ANCHORS = [
  { id: "top-left", position: Position.Top, x: 0.24, y: 0 },
  { id: "top", position: Position.Top, x: 0.5, y: 0 },
  { id: "top-right", position: Position.Top, x: 0.76, y: 0 },
  { id: "right-top", position: Position.Right, x: 1, y: 0.24 },
  { id: "right", position: Position.Right, x: 1, y: 0.5 },
  { id: "right-bottom", position: Position.Right, x: 1, y: 0.76 },
  { id: "bottom-right", position: Position.Bottom, x: 0.76, y: 1 },
  { id: "bottom", position: Position.Bottom, x: 0.5, y: 1 },
  { id: "bottom-left", position: Position.Bottom, x: 0.24, y: 1 },
  { id: "left-bottom", position: Position.Left, x: 0, y: 0.76 },
  { id: "left", position: Position.Left, x: 0, y: 0.5 },
  { id: "left-top", position: Position.Left, x: 0, y: 0.24 },
];

function colorWithAlpha(color, alpha) {
  return color?.startsWith("#") ? `${color}${alpha}` : color;
}

function alphaHex(alpha) {
  return Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, "0");
}

function toneWithAlpha(tone, alpha) {
  return colorWithAlpha(tone || "#94a3b8", alphaHex(alpha));
}

function tintStrength(value) {
  return Math.min(0.86, Math.max(0, Number(value) || 0));
}

function lightReadableTone(color, fallback = "#0066cc") {
  const key = typeof color === "string" ? color.trim().toLowerCase() : "";
  return LIGHT_READABLE_TONES[key] || color || fallback;
}

function kindTone(kind) {
  return KIND_TONES[kind] || KIND_TONES.abstract;
}

function sourceLabel(sourceState) {
  switch (sourceState) {
    case "lease":
      return "lease";
    case "worktree":
      return "worktree";
    case "main":
      return "main";
    case "local":
      return "local";
    default:
      return "";
  }
}

function isKnowledgeCrossLink(edge, variant) {
  return variant === "knowledge" && !isContainmentEdge(edge);
}

function isKnowledgeRootNode(node) {
  const type = text(node?.knowledge_node_type || node?.node_type).toLowerCase();
  return Boolean(node?.is_root)
    || type === "workspace"
    || type === "repo_root";
}

function knowledgeDepth(node) {
  return Number(node?.__knowledgeDepth ?? node?.knowledge_depth ?? node?.knowledgeDepth) || 0;
}

function knowledgeVisualLevel(node) {
  if (isKnowledgeRootNode(node)) return "root";
  const depth = knowledgeDepth(node);
  if (depth >= 4) return "deep";
  if (depth >= 3) return "nested";
  return "branch";
}

function knowledgeVisualSpec(node) {
  const level = knowledgeVisualLevel(node);
  return {
    level,
    dimensions: KNOWLEDGE_NODE_DIMENSIONS[level] || KNOWLEDGE_NODE_DIMENSIONS.branch,
    radius: KNOWLEDGE_DOT_RADIUS[level] || KNOWLEDGE_DOT_RADIUS.branch,
  };
}

function knowledgeTintStrength(metrics, branchIndex, isRoot) {
  if (isRoot) {
    return Math.min(0.28, 0.12 + Math.log2((metrics?.descendantCount || 0) + 1) * 0.025);
  }
  if (branchIndex === undefined || branchIndex === null) return 0;
  const descendants = metrics?.descendantCount || 0;
  const childCount = metrics?.childCount || 0;
  if (!descendants && !childCount) return 0.1;
  return Math.min(0.78, 0.14 + Math.log2(descendants + 1) * 0.16 + Math.min(0.16, childCount * 0.04));
}

function buildKnowledgeTintMap(nodes, edges) {
  const {
    root,
    metricsById,
    branchIndexById,
    depthById,
  } = buildKnowledgeOutwardHierarchy(nodes, edges);
  const tintById = new Map();
  if (!root) return tintById;

  nodes.forEach((node) => {
    const rootNode = node.id === root.id;
    const branchIndex = branchIndexById.get(node.id);
    const depth = depthById.get(node.id) || 0;
    const tone = rootNode
      ? "#cbd5e1"
      : KNOWLEDGE_BRANCH_TONES[(branchIndex || 0) % KNOWLEDGE_BRANCH_TONES.length];
    tintById.set(node.id, {
      tone,
      depth,
      strength: knowledgeTintStrength(metricsById.get(node.id), branchIndex, rootNode),
    });
  });

  return tintById;
}

function dimensionsForFlowNode(node, variant) {
  if (variant === "knowledge") {
    return knowledgeVisualSpec(node).dimensions;
  }
  return dimensionsForNode(node);
}

function knowledgeDotRadius(node) {
  return knowledgeVisualSpec(node).radius;
}

function anchorRatioForNode(node, anchor, variant) {
  if (variant !== "knowledge") {
    return { x: anchor.x, y: anchor.y };
  }

  const dimensions = dimensionsForFlowNode(node, variant);
  const direction = normalizedVector({
    x: anchor.x - KNOWLEDGE_DOT_CENTER.x,
    y: anchor.y - KNOWLEDGE_DOT_CENTER.y,
  });
  const radius = knowledgeDotRadius(node);

  return {
    x: KNOWLEDGE_DOT_CENTER.x + (direction.x * radius) / dimensions.width,
    y: KNOWLEDGE_DOT_CENTER.y + (direction.y * radius) / dimensions.height,
  };
}

function knowledgeDotCenterFor(layout, node) {
  const dimensions = dimensionsForFlowNode(node, "knowledge");
  const position = layout.get(node.id) || { x: 0, y: 0 };
  return {
    x: position.x + dimensions.width * KNOWLEDGE_DOT_CENTER.x,
    y: position.y + dimensions.height * KNOWLEDGE_DOT_CENTER.y,
  };
}

function knowledgeDotPointForDirection(layout, node, direction) {
  const center = knowledgeDotCenterFor(layout, node);
  const radius = knowledgeDotRadius(node);
  return {
    x: center.x + direction.x * radius,
    y: center.y + direction.y * radius,
  };
}

function flowEdgeColor(edge, sourceNode, targetNode, variant) {
  if (variant === "knowledge") {
    return isKnowledgeCrossLink(edge, variant)
      ? "rgba(148, 163, 184, 0.38)"
      : "rgba(148, 163, 184, 0.62)";
  }
  if (isKnowledgeCrossLink(edge, variant)) {
    return "rgba(148, 163, 184, 0.36)";
  }
  if ([sourceNode, targetNode].some((node) => node && isNoSpecNode(node))) {
    return isContainmentEdge(edge) ? "rgba(100, 116, 139, 0.38)" : "rgba(100, 116, 139, 0.46)";
  }
  if (isContainmentEdge(edge)) {
    return "rgba(148, 163, 184, 0.58)";
  }
  const abstractNode = [sourceNode, targetNode].find((node) => nodeKind(node) === "abstract");
  if (abstractNode) return colorWithAlpha(nodeTone(abstractNode), "8f");
  return colorWithAlpha(nodeSourceTone(targetNode || sourceNode), "cc");
}

function flowEdgeStyle(edge, sourceNode, targetNode, variant) {
  if (variant === "knowledge") {
    const crossLink = isKnowledgeCrossLink(edge, variant);
    return {
      stroke: flowEdgeColor(edge, sourceNode, targetNode, variant),
      strokeWidth: crossLink ? 1.45 : 2.35,
      opacity: crossLink ? 0.72 : 0.86,
    };
  }
  if (isKnowledgeCrossLink(edge, variant)) {
    return {
      stroke: flowEdgeColor(edge, sourceNode, targetNode, variant),
      strokeWidth: 1.35,
      strokeDasharray: "5 9",
      opacity: 0.46,
    };
  }
  const abstractLink = !isContainmentEdge(edge)
    && [sourceNode, targetNode].some((node) => nodeKind(node) === "abstract");
  const mutedLink = [sourceNode, targetNode].some((node) => node && isNoSpecNode(node));
  return {
    stroke: flowEdgeColor(edge, sourceNode, targetNode, variant),
    strokeWidth: mutedLink ? 1.7 : (abstractLink ? 1.9 : (isContainmentEdge(edge) ? 2.1 : 2.7)),
    strokeDasharray: abstractLink ? "4 8" : undefined,
    opacity: abstractLink ? 0.64 : undefined,
  };
}

function edgeTouchesAbstract(edge, sourceNode, targetNode) {
  return !isContainmentEdge(edge)
    && [sourceNode, targetNode].some((node) => nodeKind(node) === "abstract");
}

function prefixedHandleId(type, anchorId) {
  return `${type}-${anchorId}`;
}

function anchorPointForNode(layout, node, anchor, variant) {
  const dimensions = dimensionsForFlowNode(node, variant);
  const position = layout.get(node.id) || { x: 0, y: 0 };
  const ratio = anchorRatioForNode(node, anchor, variant);
  return {
    x: position.x + dimensions.width * ratio.x,
    y: position.y + dimensions.height * ratio.y,
  };
}

function centerFor(layout, node, variant) {
  if (variant === "knowledge") {
    return knowledgeDotCenterFor(layout, node);
  }

  const dimensions = dimensionsForFlowNode(node, variant);
  const position = layout.get(node.id) || { x: 0, y: 0 };
  return {
    x: position.x + dimensions.width / 2,
    y: position.y + dimensions.height / 2,
  };
}

function knowledgeEdgeEndpoints(edge, nodeById, layout, variant) {
  if (variant !== "knowledge") return null;
  const sourceNode = nodeById.get(edge.from);
  const targetNode = nodeById.get(edge.to);
  if (!sourceNode || !targetNode) return null;

  const sourceCenter = centerFor(layout, sourceNode, variant);
  const targetCenter = centerFor(layout, targetNode, variant);
  const sourceDirection = normalizedVector({
    x: targetCenter.x - sourceCenter.x,
    y: targetCenter.y - sourceCenter.y,
  });
  const targetDirection = { x: -sourceDirection.x, y: -sourceDirection.y };

  return {
    sourcePoint: knowledgeDotPointForDirection(layout, sourceNode, sourceDirection),
    targetPoint: knowledgeDotPointForDirection(layout, targetNode, targetDirection),
  };
}

function outwardVectorForPosition(position) {
  switch (position) {
    case Position.Top:
      return { x: 0, y: -1 };
    case Position.Right:
      return { x: 1, y: 0 };
    case Position.Bottom:
      return { x: 0, y: 1 };
    case Position.Left:
      return { x: -1, y: 0 };
    default:
      return { x: 0, y: 0 };
  }
}

function normalizedVector(vector, fallback = { x: 0, y: 1 }) {
  const length = Math.hypot(vector.x, vector.y);
  if (length < 0.001) return fallback;
  return {
    x: vector.x / length,
    y: vector.y / length,
  };
}

function dotProduct(left, right) {
  return left.x * right.x + left.y * right.y;
}

function closestEdgeHandles(edge, nodeById, layout, variant) {
  const sourceNode = nodeById.get(edge.from);
  const targetNode = nodeById.get(edge.to);
  if (!sourceNode || !targetNode) {
    return {
      sourceHandle: prefixedHandleId("source", "bottom"),
      targetHandle: prefixedHandleId("target", "top"),
    };
  }

  const sourceCenter = centerFor(layout, sourceNode, variant);
  const targetCenter = centerFor(layout, targetNode, variant);
  const sourceDirection = normalizedVector({
    x: targetCenter.x - sourceCenter.x,
    y: targetCenter.y - sourceCenter.y,
  });
  const targetDirection = { x: -sourceDirection.x, y: -sourceDirection.y };
  let best = null;

  for (const sourceAnchor of EDGE_ANCHORS) {
    const sourcePoint = anchorPointForNode(layout, sourceNode, sourceAnchor, variant);
    const sourceAlignment = dotProduct(outwardVectorForPosition(sourceAnchor.position), sourceDirection);

    for (const targetAnchor of EDGE_ANCHORS) {
      const targetPoint = anchorPointForNode(layout, targetNode, targetAnchor, variant);
      const targetAlignment = dotProduct(outwardVectorForPosition(targetAnchor.position), targetDirection);
      const distance = Math.hypot(targetPoint.x - sourcePoint.x, targetPoint.y - sourcePoint.y);
      const alignmentPenalty = (2 - sourceAlignment - targetAlignment) * 42;
      const score = distance + alignmentPenalty;

      if (!best || score < best.score) {
        best = { sourceAnchor, targetAnchor, score };
      }
    }
  }

  return {
    sourceHandle: prefixedHandleId("source", best?.sourceAnchor.id || "bottom"),
    targetHandle: prefixedHandleId("target", best?.targetAnchor.id || "top"),
  };
}

function toFlowEdges(edges, nodes, layout, variant) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const sourceNode = nodeById.get(edge.from);
    const targetNode = nodeById.get(edge.to);
    const color = flowEdgeColor(edge, sourceNode, targetNode, variant);
    const knowledgeCrossLink = isKnowledgeCrossLink(edge, variant);
    const endpoints = knowledgeEdgeEndpoints(edge, nodeById, layout, variant);
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      ...closestEdgeHandles(edge, nodeById, layout, variant),
      type: variant === "knowledge" ? "knowledgeStraight" : (isContainmentEdge(edge) ? "straight" : "bezier"),
      animated: variant === "knowledge" ? false : !isContainmentEdge(edge),
      className: [
        edgeTouchesAbstract(edge, sourceNode, targetNode) ? "df-edge-abstract" : "",
        knowledgeCrossLink ? "df-edge-crosslink" : "",
      ].filter(Boolean).join(" "),
      zIndex: knowledgeCrossLink ? 0 : 1,
      interactionWidth: knowledgeCrossLink ? 12 : 18,
      markerEnd: variant === "knowledge"
        ? undefined
        : {
          type: MarkerType.ArrowClosed,
          color,
          width: knowledgeCrossLink ? 9 : 14,
          height: knowledgeCrossLink ? 9 : 14,
        },
      style: flowEdgeStyle(edge, sourceNode, targetNode, variant),
      data: endpoints ? { ...edge, ...endpoints } : edge,
    };
  });
}

const INVISIBLE_HANDLE_STYLE = {
  opacity: 0,
  pointerEvents: "none",
};

function edgeHandleStyle(anchor, node, variant) {
  const style = { ...INVISIBLE_HANDLE_STYLE };

  if (variant === "knowledge") {
    const ratio = anchorRatioForNode(node, anchor, variant);
    style.bottom = "auto";
    style.left = `${ratio.x * 100}%`;
    style.right = "auto";
    style.top = `${ratio.y * 100}%`;
    style.transform = "translate(-50%, -50%)";
    return style;
  }

  if (anchor.position === Position.Top || anchor.position === Position.Bottom) {
    style.left = `${anchor.x * 100}%`;
  } else {
    style.top = `${anchor.y * 100}%`;
  }

  return style;
}

function viewportFitPadding(variant) {
  return variant === "knowledge" ? 0.14 : 0.18;
}

function graphViewportKey(nodes, edges, layout, variant) {
  const nodeKey = (nodes || [])
    .map((node) => {
      const position = layout.get(node.id) || { x: 0, y: 0 };
      return `${node.id}@${Math.round(position.x)},${Math.round(position.y)}`;
    })
    .sort()
    .join("|");
  const edgeKey = (edges || [])
    .map((edge) => `${edge.from || ""}->${edge.to || ""}:${edge.kind || ""}`)
    .sort()
    .join("|");
  return `${variant || "spec"}::${nodeKey}::${edgeKey}`;
}

export default function XyflowGraphRenderer({
  nodes,
  edges,
  layout,
  layoutPending = false,
  selectedNodeId,
  onSelect,
  state,
  emptyLabel = "No spec graph nodes yet.",
  layoutLabel = "Laying out spec graph...",
  variant = "spec",
}) {
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState([]);
  const nodeTypes = useMemo(() => ({ specGraphNode: SpecGraphNode }), []);
  const edgeTypes = useMemo(() => ({ knowledgeStraight: KnowledgeStraightEdge }), []);
  const activeLayout = layout || EMPTY_LAYOUT;
  const viewportInteractedRef = useRef(false);
  const viewportKey = useMemo(
    () => graphViewportKey(nodes, edges, activeLayout, variant),
    [activeLayout, edges, nodes, variant],
  );

  useEffect(() => {
    viewportInteractedRef.current = false;
  }, [viewportKey]);

  const handleMoveStart = useCallback((event) => {
    if (event) viewportInteractedRef.current = true;
  }, []);
  const shouldSkipViewportFit = useCallback(() => viewportInteractedRef.current, []);

  useEffect(() => {
    if (!nodes.length) {
      setFlowNodes([]);
      setFlowEdges([]);
      return;
    }

    if (layoutPending) {
      return;
    }

    const knowledgeTintById = variant === "knowledge" ? buildKnowledgeTintMap(nodes, edges) : EMPTY_LAYOUT;
    const renderNodes = variant === "knowledge"
      ? nodes.map((node) => ({
        ...node,
        __knowledgeDepth: knowledgeTintById.get(node.id)?.depth || 0,
      }))
      : nodes;
    const flowLayout = new Map();
    renderNodes.forEach((node) => {
      const position = activeLayout.get(node.id) || { x: 0, y: 0 };
      if (variant !== "knowledge") {
        flowLayout.set(node.id, position);
        return;
      }

      const originalDimensions = dimensionsForNode(node);
      const flowDimensions = dimensionsForFlowNode(node, variant);
      flowLayout.set(node.id, {
        x: position.x + (originalDimensions.width - flowDimensions.width) / 2,
        y: position.y + (originalDimensions.height - flowDimensions.height) / 2,
      });
    });
    const nextNodes = renderNodes.map((node) => {
      const dimensions = dimensionsForFlowNode(node, variant);
      return {
        id: node.id,
        type: "specGraphNode",
        position: flowLayout.get(node.id) || { x: 0, y: 0 },
        zIndex: 10,
        className: variant === "knowledge" ? "df-knowledge-flow-node" : "",
        data: {
          node,
          onSelect,
          selected: node.id === selectedNodeId,
          variant,
          knowledgeTint: knowledgeTintById.get(node.id) || null,
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
    setFlowEdges(toFlowEdges(edges, renderNodes, flowLayout, variant));
  }, [activeLayout, edges, layoutPending, nodes, onSelect, selectedNodeId, setFlowEdges, setFlowNodes, variant]);

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
    return <EmptyState>{isSyncing ? "Syncing graph..." : emptyLabel}</EmptyState>;
  }

  if (layoutPending && !flowNodes.length) {
    return <EmptyState>{layoutLabel}</EmptyState>;
  }

  if (!flowNodes.length) {
    return <EmptyState>{layoutLabel}</EmptyState>;
  }

  return (
    <FlowFrame $variant={variant}>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onMoveStart={handleMoveStart}
        onNodeClick={(_, node) => onSelect(node.id)}
        minZoom={0.18}
        maxZoom={1.8}
        elevateEdgesOnSelect={false}
        nodesConnectable={false}
        nodesDraggable={false}
        panOnDrag
        panOnScroll={false}
        zoomOnScroll
        proOptions={{ hideAttribution: true }}
        zIndexMode="manual"
      >
        <ViewportFitController
          fitKey={viewportKey}
          shouldSkipFit={shouldSkipViewportFit}
          variant={variant}
        />
        <Background color="rgba(148, 163, 184, 0.08)" gap={28} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </FlowFrame>
  );
}

function ViewportFitController({ fitKey, shouldSkipFit, variant }) {
  const reactFlow = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const lastFittedKeyRef = useRef("");

  useEffect(() => {
    if (!fitKey || !nodesInitialized) return undefined;
    if (lastFittedKeyRef.current === fitKey) return undefined;
    lastFittedKeyRef.current = fitKey;

    let cancelled = false;
    let secondFrame = 0;
    const timeouts = [];
    const fit = () => {
      if (cancelled || shouldSkipFit?.()) return;
      reactFlow.fitView({ padding: viewportFitPadding(variant), duration: 0 });
    };

    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(fit);
    });
    VIEWPORT_FIT_DELAYS.forEach((delay) => {
      timeouts.push(window.setTimeout(fit, delay));
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      timeouts.forEach((timeout) => window.clearTimeout(timeout));
    };
  }, [fitKey, nodesInitialized, reactFlow, shouldSkipFit, variant]);

  return null;
}

function SpecGraphNode({ data, selected }) {
  if (data.variant === "knowledge") {
    return <KnowledgeGraphNode data={data} selected={selected} />;
  }

  const node = data.node;
  const kind = nodeKind(node);
  const statusTone = nodeTone(node);
  const sourceState = nodeSourceState(node);
  const sourceTone = nodeSourceTone(node);
  const nodeKindTone = kindTone(kind);
  const liveAgents = liveAgentsFor(node);
  const liveAgentCount = liveAgents.length;
  const outOfSpecCount = Number(node.out_of_spec_count || node.notification_count) || 0;
  const active = Boolean(selected || data.selected);
  const title = text(node.display_title || node.displayTitle || node.title);
  const path = text(node.display_path || node.displayPath || node.path);
  const noSpec = isNoSpecNode(node);
  const source = sourceLabel(sourceState);

  return (
    <FlowNodeCard
      className="nodrag"
      type="button"
      $active={active}
      $kind={kind}
      $kindTone={nodeKindTone}
      $statusTone={statusTone}
      $sourceState={sourceState}
      $sourceTone={sourceTone}
      $live={liveAgentCount > 0}
      $noSpec={noSpec}
      onClick={(event) => {
        event.stopPropagation();
        data.onSelect(node.id);
      }}
    >
      <SourceAccent
        aria-hidden="true"
        $kind={kind}
        $noSpec={noSpec}
        $sourceState={sourceState}
        $sourceTone={sourceTone}
      />
      {EDGE_ANCHORS.map((anchor) => (
        <Handle
          key={`target-${anchor.id}`}
          id={prefixedHandleId("target", anchor.id)}
          type="target"
          position={anchor.position}
          isConnectable={false}
          style={edgeHandleStyle(anchor, node, data.variant)}
        />
      ))}
      {EDGE_ANCHORS.map((anchor) => (
        <Handle
          key={`source-${anchor.id}`}
          id={prefixedHandleId("source", anchor.id)}
          type="source"
          position={anchor.position}
          isConnectable={false}
          style={edgeHandleStyle(anchor, node, data.variant)}
        />
      ))}
      {liveAgents.slice(0, MAX_VISIBLE_AGENT_ORBITS).map((agent, index) => (
        <ActiveAgentOrbit
          key={`${node.id}-orbit-${field(agent, "agent_id", "agentId", "id") || index}`}
          aria-hidden="true"
          $tone={sourceTone}
          $index={index}
          $total={liveAgentCount}
        />
      ))}
      {liveAgentCount > 0 && <AgentCountBadge>{liveAgentCount}</AgentCountBadge>}
      {outOfSpecCount > 0 && <OutOfSpecBadge title={`${outOfSpecCount} out of spec`}>{outOfSpecCount}</OutOfSpecBadge>}
      <NodeMetaRow $kind={kind}>
        <NodeKindLabel $kind={kind} $noSpec={noSpec} $statusTone={statusTone}>
          {noSpec ? "no spec" : kind}
        </NodeKindLabel>
        {source && kind !== "folder" && !noSpec && (
          <NodeSourceChip $sourceTone={sourceTone}>{source}</NodeSourceChip>
        )}
      </NodeMetaRow>
      <NodeTitle $kind={kind} $noSpec={noSpec} title={title}>{title}</NodeTitle>
      {path && kind === "file" && <NodePath>{path}</NodePath>}
    </FlowNodeCard>
  );
}

function KnowledgeStraightEdge({
  id,
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  interactionWidth,
}) {
  const sourcePoint = data?.sourcePoint || { x: sourceX, y: sourceY };
  const targetPoint = data?.targetPoint || { x: targetX, y: targetY };
  const [path] = getStraightPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
  });

  return (
    <BaseEdge
      id={id}
      path={path}
      style={style}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
    />
  );
}

function KnowledgeGraphNode({ data, selected }) {
  const node = data.node;
  const active = Boolean(selected || data.selected);
  const title = text(node.display_title || node.displayTitle || node.title, "Knowledge concept");
  const root = isKnowledgeRootNode(node);
  const tint = data.knowledgeTint || {};
  const depth = Number(tint.depth) || 0;
  const visualLevel = knowledgeVisualLevel(node);

  return (
    <KnowledgeFlowNodeButton
      className="nodrag"
      type="button"
      $active={active}
      $root={root}
      onClick={(event) => {
        event.stopPropagation();
        data.onSelect(node.id);
      }}
    >
      {EDGE_ANCHORS.map((anchor) => (
        <Handle
          key={`target-${anchor.id}`}
          id={prefixedHandleId("target", anchor.id)}
          type="target"
          position={anchor.position}
          isConnectable={false}
          style={edgeHandleStyle(anchor, node, data.variant)}
        />
      ))}
      {EDGE_ANCHORS.map((anchor) => (
        <Handle
          key={`source-${anchor.id}`}
          id={prefixedHandleId("source", anchor.id)}
          type="source"
          position={anchor.position}
          isConnectable={false}
          style={edgeHandleStyle(anchor, node, data.variant)}
        />
      ))}
      <KnowledgeNodeLabel title={title} $depth={depth} $visualLevel={visualLevel}>{title}</KnowledgeNodeLabel>
      <KnowledgeNodeDot
        aria-hidden="true"
        className="df-knowledge-hit-target"
        $active={active}
        $root={root}
        $tintStrength={tint.strength || 0}
        $tone={tint.tone || "#94a3b8"}
        $visualLevel={visualLevel}
      />
    </KnowledgeFlowNodeButton>
  );
}

const FlowFrame = styled.div`
  height: 100%;
  min-height: 0;
  position: relative;

  .react-flow {
    background: ${({ $variant }) => ($variant === "knowledge" ? "rgba(3, 6, 11, 0.72)" : "rgba(3, 6, 11, 0.62)")};
  }

  html[data-forge-theme="light"] & .react-flow {
    background: ${({ $variant }) => ($variant === "knowledge" ? "#f7f7f8" : "#ffffff")};
  }

  ${({ $variant }) => ($variant === "knowledge" ? `
    .react-flow__node.df-knowledge-flow-node {
      pointer-events: none;
    }

    .react-flow__node.df-knowledge-flow-node .df-knowledge-hit-target {
      pointer-events: auto;
    }

    .react-flow__edge,
    .react-flow__edge-path,
    .react-flow__edge-interaction {
      pointer-events: none;
    }

    .react-flow__edge-path {
      filter: none;
      stroke-linecap: round;
    }

  ` : "")}

  .react-flow__node {
    transition:
      filter 180ms ease,
      opacity 180ms ease,
      transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .react-flow__edges {
    z-index: 1;
  }

  .react-flow__nodes {
    z-index: 2;
  }

  .react-flow__edge {
    opacity: 1;
    transition: opacity 180ms ease;
    z-index: 1 !important;
  }

  .react-flow__edge-path {
    transition:
      filter 180ms ease,
      opacity 180ms ease,
      stroke 180ms ease,
      stroke-width 180ms ease;
    filter: ${({ $variant }) => ($variant === "knowledge" ? "none" : "drop-shadow(0 0 8px rgba(125, 211, 252, 0.45))")};
    stroke-linecap: round;
  }

  .react-flow__edge.df-edge-abstract {
    opacity: 0.62;
  }

  .react-flow__edge.df-edge-abstract .react-flow__edge-path {
    filter: ${({ $variant }) => ($variant === "knowledge" ? "none" : "drop-shadow(0 0 4px rgba(125, 211, 252, 0.18))")};
  }

  .react-flow__edge.df-edge-crosslink {
    opacity: ${({ $variant }) => ($variant === "knowledge" ? 0.62 : 0.5)};
    z-index: ${({ $variant }) => ($variant === "knowledge" ? 1 : 0)} !important;
  }

  .react-flow__edge.df-edge-crosslink .react-flow__edge-path {
    filter: none;
  }

  html[data-forge-theme="light"] & .react-flow__edge-path {
    filter: none;
  }

  html[data-forge-theme="light"] & .react-flow__edge.df-edge-abstract {
    opacity: 0.74;
  }

  html[data-forge-theme="light"] & .react-flow__edge.df-edge-crosslink {
    opacity: 0.42;
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

  html[data-forge-theme="light"] & .react-flow__controls {
    border-color: rgba(0, 0, 0, 0.08);
  }

  html[data-forge-theme="light"] & .react-flow__controls-button {
    background: #fafafc;
    border-bottom-color: rgba(0, 0, 0, 0.08);
    color: #333333;
  }
`;

const KnowledgeFlowNodeButton = styled.button`
  align-items: center;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: flex;
  height: 100%;
  justify-content: center;
  outline: none;
  overflow: visible;
  padding: 0;
  position: relative;
  width: 100%;
`;

const KnowledgeNodeLabel = styled.span`
  color: rgba(203, 213, 225, 0.74);
  display: -webkit-box;
  font-size: ${({ $visualLevel }) => {
    if ($visualLevel === "root") return "13px";
    if ($visualLevel === "branch") return "12px";
    if ($visualLevel === "nested") return "10.4px";
    return "9.4px";
  }};
  font-weight: ${({ $visualLevel }) => ($visualLevel === "deep" ? 620 : 660)};
  left: 50%;
  letter-spacing: 0;
  line-height: ${({ $visualLevel }) => ($visualLevel === "root" || $visualLevel === "branch" ? 1.14 : 1.08)};
  max-width: ${({ $visualLevel }) => {
    if ($visualLevel === "root") return "174px";
    if ($visualLevel === "branch") return "154px";
    if ($visualLevel === "nested") return "124px";
    return "106px";
  }};
  overflow: hidden;
  pointer-events: none;
  position: absolute;
  text-align: center;
  text-shadow: 0 1px 7px rgba(0, 0, 0, 0.72);
  top: ${({ $visualLevel }) => {
    if ($visualLevel === "root") return "5px";
    if ($visualLevel === "branch") return "6px";
    if ($visualLevel === "nested") return "7px";
    return "6px";
  }};
  transform: translateX(-50%);
  width: max-content;
  z-index: 2;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;

  html[data-forge-theme="light"] & {
    color: rgba(55, 65, 81, 0.78);
    text-shadow: 0 1px 0 rgba(255, 255, 255, 0.78);
  }
`;

const KnowledgeNodeDot = styled.span`
  background: ${({ $active, $root, $tintStrength, $tone }) => {
    const strength = tintStrength($tintStrength);
    const tintAlpha = $active ? 0.46 + strength * 0.34 : 0.22 + strength * 0.42;
    const baseAlpha = $active ? 0.94 : ($root ? 0.82 : 0.76);
    return `
      radial-gradient(circle at 38% 31%, rgba(248, 250, 252, 0.86), transparent 35%),
      linear-gradient(135deg, ${toneWithAlpha($tone, tintAlpha)}, rgba(148, 163, 184, ${baseAlpha}) 84%)
    `;
  }};
  border: ${({ $active, $tintStrength, $tone }) => {
    const strength = tintStrength($tintStrength);
    return $active
      ? `2px solid ${toneWithAlpha($tone, 0.78 + strength * 0.18)}`
      : `2px solid ${toneWithAlpha($tone, 0.38 + strength * 0.42)}`;
  }};
  border-radius: 999px;
  box-shadow: ${({ $active, $tintStrength, $tone }) => {
    const strength = tintStrength($tintStrength);
    return $active
      ? `0 0 0 6px ${toneWithAlpha($tone, 0.18 + strength * 0.2)}, 0 0 28px ${toneWithAlpha($tone, 0.26 + strength * 0.3)}, inset 0 0 0 2px rgba(248, 250, 252, 0.16)`
      : `0 0 0 4px ${toneWithAlpha($tone, 0.1 + strength * 0.16)}, 0 0 18px ${toneWithAlpha($tone, 0.14 + strength * 0.22)}, inset 0 0 0 1px rgba(248, 250, 252, 0.12)`;
  }};
  height: ${({ $visualLevel }) => `${(KNOWLEDGE_DOT_RADIUS[$visualLevel] || KNOWLEDGE_DOT_RADIUS.branch) * 2}px`};
  left: 50%;
  position: absolute;
  top: 58%;
  transform: translate(-50%, -50%);
  transition:
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
  width: ${({ $visualLevel }) => `${(KNOWLEDGE_DOT_RADIUS[$visualLevel] || KNOWLEDGE_DOT_RADIUS.branch) * 2}px`};
  z-index: 1;

  ${KnowledgeFlowNodeButton}:hover & {
    background: ${({ $tintStrength, $tone }) => {
      const strength = tintStrength($tintStrength);
      return `
        radial-gradient(circle at 38% 31%, rgba(255, 255, 255, 0.92), transparent 35%),
        linear-gradient(135deg, ${toneWithAlpha($tone, 0.52 + strength * 0.34)}, rgba(241, 245, 249, 0.96) 84%)
      `;
    }};
    border-color: ${({ $tintStrength, $tone }) => toneWithAlpha($tone, 0.78 + tintStrength($tintStrength) * 0.16)};
    box-shadow: ${({ $tintStrength, $tone }) => {
      const strength = tintStrength($tintStrength);
      return `0 0 0 6px ${toneWithAlpha($tone, 0.18 + strength * 0.18)}, 0 0 28px ${toneWithAlpha($tone, 0.26 + strength * 0.3)}`;
    }};
  }

  html[data-forge-theme="light"] & {
    background: ${({ $active, $tintStrength, $tone }) => {
      const strength = tintStrength($tintStrength);
      return `
        radial-gradient(circle at 38% 31%, rgba(255, 255, 255, 0.86), transparent 34%),
        linear-gradient(135deg, ${toneWithAlpha($tone, 0.28 + strength * 0.28)}, rgba(75, 85, 99, ${$active ? 0.82 : 0.64}) 86%)
      `;
    }};
    border-color: ${({ $tintStrength, $tone }) => toneWithAlpha($tone, 0.28 + tintStrength($tintStrength) * 0.34)};
    box-shadow: ${({ $active, $tintStrength, $tone }) => {
      const strength = tintStrength($tintStrength);
      return $active
        ? `0 0 0 5px ${toneWithAlpha($tone, 0.12 + strength * 0.14)}`
        : `0 0 0 3px ${toneWithAlpha($tone, 0.07 + strength * 0.1)}`;
    }};
  }
`;

const FlowNodeCard = styled.button`
  align-items: center;
  border: ${({ $active, $kind, $kindTone, $noSpec, $sourceState, $sourceTone, $statusTone }) => {
    if ($active && $noSpec) return "1px solid rgba(148, 163, 184, 0.5)";
    if ($active) return `1.5px solid ${$statusTone || "#38bdf8"}`;
    if ($noSpec) return "1px solid rgba(100, 116, 139, 0.32)";
    if ($sourceState === "lease") return `1.5px dashed ${$sourceTone || "#f59e0b"}`;
    if ($sourceState === "local") return `1.2px dotted ${$sourceTone || "#94a3b8"}`;
    if ($sourceState === "worktree") return `1.2px solid ${colorWithAlpha($sourceTone || "#38bdf8", "cc")}`;
    if ($sourceState === "main") return `1px solid ${colorWithAlpha($sourceTone || "#22c55e", "8f")}`;
    if ($kind === "abstract") return `1px dashed ${colorWithAlpha($kindTone || "#c084fc", "99")}`;
    return "1px solid rgba(230, 236, 245, 0.14)";
  }};
  border-radius: ${({ $kind }) => {
    if ($kind === "folder") return "8px";
    if ($kind === "file") return "7px";
    if ($kind === "abstract") return "22px 9px 22px 9px";
    return "999px";
  }};
  background: ${({ $kind, $kindTone, $noSpec, $statusTone }) => {
    if ($noSpec) {
      return "rgba(15, 23, 42, 0.64)";
    }
    if ($kind === "abstract") {
      return `
        linear-gradient(135deg, ${colorWithAlpha($kindTone || "#c084fc", "24")}, rgba(13, 17, 23, 0.94) 56%),
        radial-gradient(circle at 52% 46%, ${colorWithAlpha($statusTone || "#fbbf24", "24")}, transparent 68%),
        rgba(13, 17, 23, 0.96)
      `;
    }
    return `
      radial-gradient(circle at 48% 36%, ${colorWithAlpha($statusTone || "#38bdf8", "24")}, rgba(13, 17, 23, 0.88) 62%),
      rgba(13, 17, 23, 0.94)
    `;
  }};
  box-shadow: ${({ $active, $live, $noSpec, $sourceState, $sourceTone, $statusTone }) => {
    if ($active && $noSpec) {
      return "0 0 0 2px rgba(100, 116, 139, 0.14), 0 10px 24px rgba(0, 0, 0, 0.18)";
    }
    if ($active) {
      return `0 0 0 2px ${colorWithAlpha($statusTone || "#38bdf8", "55")}, 0 0 0 5px ${colorWithAlpha($sourceTone || "#38bdf8", "22")}, 0 18px 44px rgba(0, 0, 0, 0.34)`;
    }
    if ($sourceState === "lease") {
      return `0 0 0 1px ${colorWithAlpha($sourceTone || "#f59e0b", "44")}, 0 0 24px ${colorWithAlpha($sourceTone || "#f59e0b", "22")}, 0 12px 30px rgba(0, 0, 0, 0.24)`;
    }
    if ($sourceState === "worktree") {
      return `0 0 0 1px ${colorWithAlpha($sourceTone || "#38bdf8", "33")}, 0 0 24px ${colorWithAlpha($sourceTone || "#38bdf8", "1f")}, 0 12px 30px rgba(0, 0, 0, 0.24)`;
    }
    if ($live) return `0 0 0 1px ${colorWithAlpha($sourceTone || "#34d399", "33")}, 0 12px 30px rgba(0, 0, 0, 0.24)`;
    if ($noSpec) return "0 8px 18px rgba(0, 0, 0, 0.14)";
    return "0 12px 30px rgba(0, 0, 0, 0.2)";
  }};
  color: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: ${({ $kind }) => ($kind === "folder" ? "3px" : "4px")};
  height: 100%;
  justify-content: center;
  min-width: 0;
  opacity: ${({ $active, $noSpec, $sourceState }) => {
    if ($noSpec) return $active ? 0.86 : 0.7;
    return $sourceState === "local" ? 0.76 : 1;
  }};
  outline: none;
  overflow: visible;
  padding: ${({ $kind }) => {
    if ($kind === "workspace") return "20px";
    if ($kind === "folder") return "7px 8px 6px";
    if ($kind === "file") return "9px 12px 9px 16px";
    return "12px 14px";
  }};
  position: relative;
  text-align: center;
  width: 100%;

  &::before {
    background: ${({ $kind, $kindTone, $noSpec }) => {
      if ($kind !== "folder") return "transparent";
      return $noSpec ? "rgba(100, 116, 139, 0.48)" : colorWithAlpha($kindTone || "#a78bfa", "88");
    }};
    border: ${({ $kind, $noSpec, $sourceTone }) => (
      $kind === "folder"
        ? `1px solid ${$noSpec ? "rgba(100, 116, 139, 0.48)" : colorWithAlpha($sourceTone || "#22c55e", "aa")}`
        : "0"
    )};
    border-bottom: 0;
    border-radius: 8px 8px 3px 3px;
    content: "";
    display: ${({ $kind }) => ($kind === "folder" ? "block" : "none")};
    height: 8px;
    left: 10px;
    position: absolute;
    top: -6px;
    width: 30px;
    z-index: 1;
  }

  &::after {
    content: "";
    pointer-events: none;
    position: absolute;
    z-index: 1;
    ${({ $kind, $kindTone, $noSpec, $sourceTone }) => {
      if ($kind === "file") {
        return `
          background: ${$noSpec ? "rgba(100, 116, 139, 0.48)" : colorWithAlpha($sourceTone || "#22c55e", "cc")};
          clip-path: polygon(100% 0, 0 0, 100% 100%);
          height: 14px;
          right: 0;
          top: 0;
          width: 14px;
        `;
      }
      if ($kind === "abstract") {
        return `
          background: rgba(13, 17, 23, 0.96);
          border: 1px solid ${colorWithAlpha($kindTone || "#c084fc", "bb")};
          height: 14px;
          right: 16px;
          top: -6px;
          transform: rotate(45deg);
          width: 14px;
        `;
      }
      return "display: none;";
    }}
  }

  html[data-forge-theme="light"] & {
    border-color: ${({ $active, $noSpec, $sourceTone, $statusTone }) => (
      $active
        ? lightReadableTone($noSpec ? "#64748b" : ($statusTone || $sourceTone))
        : colorWithAlpha(lightReadableTone($noSpec ? "#64748b" : ($sourceTone || $statusTone)), "40")
    )};
    background: ${({ $kind, $kindTone, $noSpec, $statusTone }) => {
      if ($noSpec) return "#f8fafc";
      if ($kind === "abstract") {
        return `linear-gradient(135deg, ${colorWithAlpha(lightReadableTone($kindTone, "#7e22ce"), "12")}, #ffffff 58%)`;
      }
      return `linear-gradient(180deg, #ffffff, ${colorWithAlpha(lightReadableTone($statusTone || "#0066cc"), "08")})`;
    }};
    box-shadow: ${({ $active, $noSpec, $sourceTone, $statusTone }) => (
      $active
        ? `0 0 0 2px ${colorWithAlpha(lightReadableTone($noSpec ? "#64748b" : ($statusTone || $sourceTone)), "24")}, 0 1px 2px rgba(0, 0, 0, 0.06)`
        : "0 1px 2px rgba(0, 0, 0, 0.05)"
    )};
    opacity: ${({ $active, $noSpec, $sourceState }) => {
      if ($noSpec) return $active ? 0.94 : 0.82;
      return $sourceState === "local" ? 0.84 : 1;
    }};
  }

  html[data-forge-theme="light"] &::before {
    background: ${({ $kind, $kindTone, $noSpec }) => {
      if ($kind !== "folder") return "transparent";
      return $noSpec ? "#94a3b8" : colorWithAlpha(lightReadableTone($kindTone || "#7e22ce"), "66");
    }};
    border-color: ${({ $noSpec, $sourceTone }) => (
      $noSpec ? "#94a3b8" : colorWithAlpha(lightReadableTone($sourceTone || "#0a7f45"), "99")
    )};
  }

  html[data-forge-theme="light"] &::after {
    ${({ $kind, $kindTone, $noSpec, $sourceTone }) => {
      if ($kind === "file") {
        return `background: ${$noSpec ? "#94a3b8" : lightReadableTone($sourceTone || "#0a7f45")};`;
      }
      if ($kind === "abstract") {
        return `
          background: #ffffff;
          border-color: ${colorWithAlpha(lightReadableTone($kindTone || "#7e22ce"), "aa")};
        `;
      }
      return "";
    }}
  }

  html[data-forge-theme="light"] &:hover {
    border-color: ${({ $noSpec, $sourceTone, $statusTone }) => (
      lightReadableTone($noSpec ? "#64748b" : ($sourceTone || $statusTone), "#0066cc")
    )};
  }
`;

const SourceAccent = styled.span`
  pointer-events: none;
  position: absolute;
  z-index: 1;
  ${({ $kind, $noSpec, $sourceState, $sourceTone }) => {
    if ($sourceState === "unknown") return "display: none;";
    if ($kind === "workspace") {
      return `
        background: transparent;
        border: 1px solid ${$noSpec ? "rgba(100, 116, 139, 0.36)" : colorWithAlpha($sourceTone || "#22c55e", "88")};
        border-radius: 999px;
        inset: 8px;
      `;
    }
    if ($kind === "folder") {
      return `
        background: ${$noSpec ? "rgba(100, 116, 139, 0.44)" : colorWithAlpha($sourceTone || "#22c55e", "d9")};
        border-radius: 999px;
        bottom: 6px;
        height: 3px;
        left: 10px;
        right: 10px;
      `;
    }
    if ($kind === "file") {
      return `
        background: ${$noSpec ? "rgba(100, 116, 139, 0.44)" : colorWithAlpha($sourceTone || "#22c55e", "d9")};
        border-radius: 0 999px 999px 0;
        bottom: 13px;
        left: 0;
        top: 13px;
        width: 5px;
      `;
    }
    return `
      background: ${$noSpec ? "rgba(100, 116, 139, 0.42)" : colorWithAlpha($sourceTone || "#94a3b8", "b8")};
      border-radius: 999px;
      bottom: 10px;
      height: 2px;
      right: 10px;
      transform: rotate(-28deg);
      width: 24px;
    `;
  }}

  html[data-forge-theme="light"] & {
    ${({ $kind, $noSpec, $sourceState, $sourceTone }) => {
      if ($sourceState === "unknown") return "";
      if ($kind === "workspace") {
        return `border-color: ${$noSpec ? "rgba(100, 116, 139, 0.42)" : colorWithAlpha(lightReadableTone($sourceTone || "#0a7f45"), "88")};`;
      }
      return `background: ${$noSpec ? "rgba(100, 116, 139, 0.58)" : colorWithAlpha(lightReadableTone($sourceTone || "#0a7f45"), "d9")};`;
    }}
  }
`;

const NodeMetaRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${({ $kind }) => ($kind === "workspace" ? "6px" : "4px")};
  justify-content: center;
  max-width: 100%;
  min-width: 0;
  position: relative;
  z-index: 2;
`;

const NodeKindLabel = styled.span`
  color: ${({ $kind, $noSpec, $statusTone }) => {
    if ($noSpec) return "rgba(203, 213, 225, 0.5)";
    if ($kind === "workspace") return "rgba(167, 243, 208, 0.84)";
    return colorWithAlpha($statusTone || "#e2e8f0", "cc");
  }};
  font-size: ${({ $kind }) => {
    if ($kind === "workspace") return "10px";
    if ($kind === "folder") return "7.5px";
    return "8.5px";
  }};
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: ${({ $kind, $noSpec, $statusTone }) => {
      if ($noSpec) return "#64748b";
      if ($kind === "workspace") return "#047857";
      return lightReadableTone($statusTone || "#0066cc");
    }};
  }
`;

const NodeSourceChip = styled.span`
  background: ${({ $sourceTone }) => colorWithAlpha($sourceTone || "#22c55e", "1f")};
  border: 1px solid ${({ $sourceTone }) => colorWithAlpha($sourceTone || "#22c55e", "66")};
  border-radius: 999px;
  color: ${({ $sourceTone }) => colorWithAlpha($sourceTone || "#22c55e", "f2")};
  display: inline-flex;
  font-size: 8px;
  font-weight: 900;
  line-height: 1;
  max-width: 58px;
  min-width: 0;
  overflow: hidden;
  padding: 1px 4px;
  text-overflow: ellipsis;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    background: ${({ $sourceTone }) => colorWithAlpha(lightReadableTone($sourceTone || "#0066cc"), "12")};
    border-color: ${({ $sourceTone }) => colorWithAlpha(lightReadableTone($sourceTone || "#0066cc"), "44")};
    color: ${({ $sourceTone }) => lightReadableTone($sourceTone || "#0066cc")};
  }
`;

const NodeTitle = styled.div`
  color: ${({ $noSpec }) => ($noSpec ? "rgba(226, 232, 240, 0.68)" : "var(--forge-text-soft, #eef5ff)")};
  display: -webkit-box;
  font-size: ${({ $kind }) => {
    if ($kind === "workspace") return "14px";
    if ($kind === "folder") return "10.5px";
    if ($kind === "abstract") return "11.5px";
    return "11px";
  }};
  font-weight: 840;
  line-height: ${({ $kind }) => ($kind === "folder" ? 1.12 : 1.18)};
  max-width: 100%;
  overflow: hidden;
  position: relative;
  text-overflow: ellipsis;
  z-index: 2;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: ${({ $kind }) => {
    if ($kind === "workspace") return 5;
    if ($kind === "folder") return 2;
    if ($kind === "file") return 2;
    return 3;
  }};
  word-break: break-word;

  html[data-forge-theme="light"] & {
    color: ${({ $noSpec }) => ($noSpec ? "#5f6673" : "#1d1d1f")};
  }
`;

const NodePath = styled.div`
  color: rgba(219, 231, 247, 0.45);
  font-size: 8.2px;
  font-weight: 680;
  line-height: 1.15;
  max-width: 100%;
  overflow: hidden;
  position: relative;
  text-overflow: ellipsis;
  white-space: nowrap;
  z-index: 2;

  html[data-forge-theme="light"] & {
    color: #6e6e73;
  }
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

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(0, 0, 0, 0.1);
    color: #1d1d1f;
  }
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

  html[data-forge-theme="light"] & {
    background: rgba(139, 90, 0, 0.08);
    border-color: rgba(139, 90, 0, 0.22);
    color: #5c4100;
  }
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

const EmptyState = styled.div`
  color: rgba(219, 231, 247, 0.48);
  font-size: 12px;
  font-weight: 680;
  padding: 14px;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;

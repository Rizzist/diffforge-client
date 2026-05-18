import { useEffect, useMemo, useRef } from "react";
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
import styled from "styled-components";
import "@xyflow/react/dist/style.css";
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

function flowEdgeColor(edge, sourceNode, targetNode) {
  if (isContainmentEdge(edge)) {
    return "rgba(148, 163, 184, 0.58)";
  }
  const abstractNode = [sourceNode, targetNode].find((node) => nodeKind(node) === "abstract");
  if (abstractNode) return colorWithAlpha(nodeTone(abstractNode), "cc");
  return colorWithAlpha(nodeSourceTone(targetNode || sourceNode), "cc");
}

function flowEdgeStyle(edge, sourceNode, targetNode) {
  const abstractLink = !isContainmentEdge(edge)
    && [sourceNode, targetNode].some((node) => nodeKind(node) === "abstract");
  return {
    stroke: flowEdgeColor(edge, sourceNode, targetNode),
    strokeWidth: isContainmentEdge(edge) ? 2.1 : 2.7,
    strokeDasharray: abstractLink ? "6 7" : undefined,
  };
}

function prefixedHandleId(type, anchorId) {
  return `${type}-${anchorId}`;
}

function anchorPointForNode(layout, node, anchor) {
  const dimensions = dimensionsForNode(node);
  const position = layout.get(node.id) || { x: 0, y: 0 };
  return {
    x: position.x + dimensions.width * anchor.x,
    y: position.y + dimensions.height * anchor.y,
  };
}

function centerFor(layout, node) {
  const dimensions = dimensionsForNode(node);
  const position = layout.get(node.id) || { x: 0, y: 0 };
  return {
    x: position.x + dimensions.width / 2,
    y: position.y + dimensions.height / 2,
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

function closestEdgeHandles(edge, nodeById, layout) {
  const sourceNode = nodeById.get(edge.from);
  const targetNode = nodeById.get(edge.to);
  if (!sourceNode || !targetNode) {
    return {
      sourceHandle: prefixedHandleId("source", "bottom"),
      targetHandle: prefixedHandleId("target", "top"),
    };
  }

  const sourceCenter = centerFor(layout, sourceNode);
  const targetCenter = centerFor(layout, targetNode);
  const sourceDirection = normalizedVector({
    x: targetCenter.x - sourceCenter.x,
    y: targetCenter.y - sourceCenter.y,
  });
  const targetDirection = { x: -sourceDirection.x, y: -sourceDirection.y };
  let best = null;

  for (const sourceAnchor of EDGE_ANCHORS) {
    const sourcePoint = anchorPointForNode(layout, sourceNode, sourceAnchor);
    const sourceAlignment = dotProduct(outwardVectorForPosition(sourceAnchor.position), sourceDirection);

    for (const targetAnchor of EDGE_ANCHORS) {
      const targetPoint = anchorPointForNode(layout, targetNode, targetAnchor);
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

function toFlowEdges(edges, nodes, layout) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return edges.map((edge) => {
    const sourceNode = nodeById.get(edge.from);
    const targetNode = nodeById.get(edge.to);
    const color = flowEdgeColor(edge, sourceNode, targetNode);
    return {
      id: edge.id,
      source: edge.from,
      target: edge.to,
      ...closestEdgeHandles(edge, nodeById, layout),
      type: isContainmentEdge(edge) ? "straight" : "bezier",
      animated: !isContainmentEdge(edge),
      zIndex: 0,
      interactionWidth: 18,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 14,
        height: 14,
      },
      style: flowEdgeStyle(edge, sourceNode, targetNode),
      data: edge,
    };
  });
}

const INVISIBLE_HANDLE_STYLE = {
  opacity: 0,
  pointerEvents: "none",
};

function edgeHandleStyle(anchor) {
  const style = { ...INVISIBLE_HANDLE_STYLE };
  if (anchor.position === Position.Top || anchor.position === Position.Bottom) {
    style.left = `${anchor.x * 100}%`;
  } else {
    style.top = `${anchor.y * 100}%`;
  }
  return style;
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
}) {
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState([]);
  const flowInstanceRef = useRef(null);
  const lastFitTopologyRef = useRef("");
  const nodeTypes = useMemo(() => ({ specGraphNode: SpecGraphNode }), []);
  const activeLayout = layout || EMPTY_LAYOUT;

  useEffect(() => {
    if (!nodes.length || layoutPending) {
      setFlowNodes([]);
      setFlowEdges([]);
      if (!nodes.length) lastFitTopologyRef.current = "";
      return;
    }

    const topologyKey = `${nodes.map((node) => node.id).join("|")}:${edges.map((edge) => edge.id).join("|")}`;
    const nextNodes = nodes.map((node) => {
      const dimensions = dimensionsForNode(node);
      return {
        id: node.id,
        type: "specGraphNode",
        position: activeLayout.get(node.id) || { x: 0, y: 0 },
        zIndex: 10,
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
    setFlowEdges(toFlowEdges(edges, nodes, activeLayout));
    if (topologyKey !== lastFitTopologyRef.current) {
      lastFitTopologyRef.current = topologyKey;
      window.requestAnimationFrame(() => {
        flowInstanceRef.current?.fitView({ padding: 0.18, duration: 360 });
      });
    }
  }, [activeLayout, edges, layoutPending, nodes, onSelect, setFlowEdges, setFlowNodes]);

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

  if (layoutPending) {
    return <EmptyState>{layoutLabel}</EmptyState>;
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
        elevateEdgesOnSelect={false}
        nodesConnectable={false}
        nodesDraggable={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
        zIndexMode="manual"
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
          style={edgeHandleStyle(anchor)}
        />
      ))}
      {EDGE_ANCHORS.map((anchor) => (
        <Handle
          key={`source-${anchor.id}`}
          id={prefixedHandleId("source", anchor.id)}
          type="source"
          position={anchor.position}
          isConnectable={false}
          style={edgeHandleStyle(anchor)}
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
        {source && kind !== "folder" && (
          <NodeSourceChip $sourceTone={sourceTone}>{source}</NodeSourceChip>
        )}
      </NodeMetaRow>
      <NodeTitle $kind={kind} $noSpec={noSpec} title={title}>{title}</NodeTitle>
      {path && kind === "file" && <NodePath>{path}</NodePath>}
    </FlowNodeCard>
  );
}

const FlowFrame = styled.div`
  height: 100%;
  min-height: 0;
  position: relative;

  .react-flow {
    background: rgba(3, 6, 11, 0.62);
  }

  html[data-forge-theme="light"] & .react-flow {
    background: #ffffff;
  }

  .react-flow__node {
    transition: transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .react-flow__edges {
    z-index: 1;
  }

  .react-flow__nodes {
    z-index: 2;
  }

  .react-flow__edge {
    z-index: 1 !important;
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

  html[data-forge-theme="light"] & .react-flow__controls {
    border-color: rgba(0, 0, 0, 0.08);
  }

  html[data-forge-theme="light"] & .react-flow__controls-button {
    background: #fafafc;
    border-bottom-color: rgba(0, 0, 0, 0.08);
    color: #333333;
  }
`;

const FlowNodeCard = styled.button`
  align-items: center;
  border: ${({ $active, $kind, $kindTone, $sourceState, $sourceTone, $statusTone }) => {
    if ($active) return `1.5px solid ${$statusTone || "#38bdf8"}`;
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
      return "linear-gradient(180deg, rgba(30, 41, 59, 0.96), rgba(15, 23, 42, 0.98))";
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
    if ($noSpec) return "0 9px 22px rgba(0, 0, 0, 0.2)";
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
  opacity: ${({ $sourceState }) => ($sourceState === "local" ? 0.76 : 1)};
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
      return $noSpec ? "rgba(100, 116, 139, 0.92)" : colorWithAlpha($kindTone || "#a78bfa", "88");
    }};
    border: ${({ $kind, $sourceTone }) => ($kind === "folder" ? `1px solid ${colorWithAlpha($sourceTone || "#22c55e", "aa")}` : "0")};
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
    ${({ $kind, $kindTone, $sourceTone }) => {
      if ($kind === "file") {
        return `
          background: ${colorWithAlpha($sourceTone || "#22c55e", "cc")};
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

  &:hover {
    border-color: ${({ $sourceTone, $statusTone }) => $sourceTone || $statusTone || "#38bdf8"};
    transform: scale(1.025);
  }

  html[data-forge-theme="light"] & {
    border-color: ${({ $active, $sourceTone, $statusTone }) => (
      $active ? ($statusTone || "#0066cc") : colorWithAlpha($sourceTone || $statusTone || "#0066cc", "33")
    )};
    background: #ffffff;
    box-shadow: none;
  }

  html[data-forge-theme="light"] &:hover {
    border-color: ${({ $sourceTone, $statusTone }) => $sourceTone || $statusTone || "#0066cc"};
    transform: scale(1.015);
  }
`;

const SourceAccent = styled.span`
  pointer-events: none;
  position: absolute;
  z-index: 1;
  ${({ $kind, $sourceState, $sourceTone }) => {
    if ($sourceState === "unknown") return "display: none;";
    if ($kind === "workspace") {
      return `
        background: transparent;
        border: 1.5px solid ${colorWithAlpha($sourceTone || "#22c55e", "88")};
        border-radius: 999px;
        inset: 8px;
      `;
    }
    if ($kind === "folder") {
      return `
        background: ${colorWithAlpha($sourceTone || "#22c55e", "d9")};
        border-radius: 999px;
        bottom: 6px;
        height: 3px;
        left: 10px;
        right: 10px;
      `;
    }
    if ($kind === "file") {
      return `
        background: ${colorWithAlpha($sourceTone || "#22c55e", "d9")};
        border-radius: 0 999px 999px 0;
        bottom: 13px;
        left: 0;
        top: 13px;
        width: 5px;
      `;
    }
    return `
      background: ${colorWithAlpha($sourceTone || "#94a3b8", "b8")};
      border-radius: 999px;
      bottom: 10px;
      height: 2px;
      right: 10px;
      transform: rotate(-28deg);
      width: 24px;
    `;
  }}
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
    if ($noSpec) return "rgba(226, 232, 240, 0.62)";
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
      if ($noSpec) return "#7a7a7a";
      if ($kind === "workspace") return "#0a7f45";
      return $statusTone || "#0066cc";
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
    background: ${({ $sourceTone }) => colorWithAlpha($sourceTone || "#0066cc", "12")};
    border-color: ${({ $sourceTone }) => colorWithAlpha($sourceTone || "#0066cc", "44")};
    color: ${({ $sourceTone }) => $sourceTone || "#0066cc"};
  }
`;

const NodeTitle = styled.div`
  color: ${({ $noSpec }) => ($noSpec ? "rgba(238, 245, 255, 0.78)" : "var(--forge-text-soft, #eef5ff)")};
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
    color: ${({ $noSpec }) => ($noSpec ? "#7a7a7a" : "#1d1d1f")};
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
    color: #7a7a7a;
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
`;

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
  isLeasedFileNode,
  isUnspecifiedStructuralNode,
  isWorktreeFileNode,
  liveAgentsFor,
  nodeKind,
  nodeTone,
  text,
} from "../specGraphCore.js";

const MAX_VISIBLE_AGENT_ORBITS = 6;
const EMPTY_LAYOUT = new Map();

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
  return edges.map((edge) => ({
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
    return <EmptyState>{isSyncing ? "Syncing spec graph..." : "No spec graph nodes yet."}</EmptyState>;
  }

  if (layoutPending) {
    return <EmptyState>Laying out spec graph...</EmptyState>;
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
  const tone = nodeTone(node);
  const liveAgents = liveAgentsFor(node);
  const liveAgentCount = liveAgents.length;
  const outOfSpecCount = Number(node.out_of_spec_count || node.notification_count) || 0;
  const active = Boolean(selected || data.selected);
  const title = text(node.display_title || node.displayTitle || node.title);
  const path = text(node.display_path || node.displayPath || node.path);
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
          $tone={tone}
          $index={index}
          $total={liveAgentCount}
        />
      ))}
      {liveAgentCount > 0 && <AgentCountBadge>{liveAgentCount}</AgentCountBadge>}
      {outOfSpecCount > 0 && <OutOfSpecBadge title={`${outOfSpecCount} out of spec`}>{outOfSpecCount}</OutOfSpecBadge>}
      <NodeKindLabel $kind={kind}>{isUnspecifiedStructuralNode(node) ? "no spec" : leased ? "leased" : kind}</NodeKindLabel>
      <NodeTitle $kind={kind} title={title}>{title}</NodeTitle>
      {path && kind !== "workspace" && <NodePath>{path}</NodePath>}
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

const EmptyState = styled.div`
  color: rgba(219, 231, 247, 0.48);
  font-size: 12px;
  font-weight: 680;
  padding: 14px;
`;

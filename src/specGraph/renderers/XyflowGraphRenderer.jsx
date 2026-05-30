import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import styled from "styled-components";
import "@xyflow/react/dist/style.css";
import {
  dimensionsForNode,
  field,
  isContainmentEdge,
  isNoSpecNode,
  liveAgentsFor,
  nodeProjectContext,
  nodeKind,
  nodeSourceState,
  nodeSourceTone,
  nodeTone,
  text,
} from "../specGraphCore.js";

const MAX_VISIBLE_AGENT_ORBITS = 6;
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
const VIEWPORT_FIT_DELAYS = [90, 240];
const PROJECT_GROUP_PADDING = {
  top: 64,
  right: 58,
  bottom: 48,
  left: 58,
};
const PROJECT_GROUP_MIN_SIZE = {
  width: 250,
  height: 180,
};
const PROJECT_GROUP_TONES = [
  "#14b8a6",
  "#3b82f6",
  "#f59e0b",
  "#ef4444",
  "#22c55e",
  "#06b6d4",
  "#a855f7",
  "#e11d48",
];

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

function dimensionsForFlowNode(node) {
  return dimensionsForNode(node);
}

function stableToneIndex(value) {
  const source = String(value || "");
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) {
    hash = ((hash << 5) - hash + source.charCodeAt(index)) | 0;
  }
  return Math.abs(hash) % PROJECT_GROUP_TONES.length;
}

function safeFlowId(value) {
  return String(value || "project")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "project";
}

function pathLeaf(value) {
  const parts = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[parts.length - 1] || "";
}

function pathHead(value) {
  const parts = String(value || "")
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts[0] || "";
}

function projectGroupLabel(context, fallback) {
  return text(
    context.mountId
      || pathHead(context.visiblePath)
      || pathLeaf(context.projectRoot)
      || fallback,
    "Project",
  );
}

function projectGroupInfosForNode(node) {
  const context = nodeProjectContext(node);
  const mountId = text(context.mountId);
  if (mountId) {
    const parts = mountId
      .replace(/\\/g, "/")
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 1) {
      return parts.map((_, index) => {
        const key = parts.slice(0, index + 1).join("/");
        return {
          key,
          label: key,
          projectRoot: index === parts.length - 1 ? context.projectRoot : "",
          visiblePath: key,
          workspaceRoot: context.workspaceRoot,
          depth: index + 1,
        };
      });
    }
  }
  const key = text(mountId || context.projectRoot || context.sourceRepoId);
  if (!key) return [];
  return [{
    key,
    label: projectGroupLabel(context, key),
    projectRoot: context.projectRoot,
    visiblePath: context.visiblePath,
    workspaceRoot: context.workspaceRoot,
    depth: 1,
  }];
}

function projectGroupFlowNodes(nodes, layout, selectedNodeId) {
  const groups = new Map();
  nodes.forEach((node) => {
    const groupInfos = projectGroupInfosForNode(node);
    if (!groupInfos.length) return;
    const position = layout.get(node.id);
    if (!position) return;
    const dimensions = dimensionsForFlowNode(node);
    groupInfos.forEach((groupInfo) => {
      const existing = groups.get(groupInfo.key) || {
        ...groupInfo,
        left: Number.POSITIVE_INFINITY,
        top: Number.POSITIVE_INFINITY,
        right: Number.NEGATIVE_INFINITY,
        bottom: Number.NEGATIVE_INFINITY,
        memberIds: [],
      };
      existing.left = Math.min(existing.left, position.x);
      existing.top = Math.min(existing.top, position.y);
      existing.right = Math.max(existing.right, position.x + dimensions.width);
      existing.bottom = Math.max(existing.bottom, position.y + dimensions.height);
      existing.memberIds.push(node.id);
      groups.set(groupInfo.key, existing);
    });
  });

  return [...groups.values()]
    .sort((left, right) => (left.depth || 0) - (right.depth || 0) || left.label.localeCompare(right.label) || left.key.localeCompare(right.key))
    .map((group) => {
      const width = Math.max(
        PROJECT_GROUP_MIN_SIZE.width,
        group.right - group.left + PROJECT_GROUP_PADDING.left + PROJECT_GROUP_PADDING.right,
      );
      const height = Math.max(
        PROJECT_GROUP_MIN_SIZE.height,
        group.bottom - group.top + PROJECT_GROUP_PADDING.top + PROJECT_GROUP_PADDING.bottom,
      );
      const tone = PROJECT_GROUP_TONES[stableToneIndex(group.key)];
      return {
        id: `project-group-${safeFlowId(group.key)}`,
        type: "projectGroup",
        position: {
          x: group.left - PROJECT_GROUP_PADDING.left,
          y: group.top - PROJECT_GROUP_PADDING.top,
        },
        zIndex: Math.max(0, Math.min(4, Number(group.depth || 1) - 1)),
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
        style: {
          width,
          height,
        },
        data: {
          label: group.label,
          projectRoot: group.projectRoot,
          visiblePath: group.visiblePath,
          memberCount: group.memberIds.length,
          memberIds: group.memberIds,
          selected: group.memberIds.includes(selectedNodeId),
          tone,
        },
      };
    });
}

function flowEdgeColor(edge, sourceNode, targetNode) {
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

function flowEdgeStyle(edge, sourceNode, targetNode) {
  const abstractLink = !isContainmentEdge(edge)
    && [sourceNode, targetNode].some((node) => nodeKind(node) === "abstract");
  const mutedLink = [sourceNode, targetNode].some((node) => node && isNoSpecNode(node));
  return {
    stroke: flowEdgeColor(edge, sourceNode, targetNode),
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

function anchorPointForNode(layout, node, anchor) {
  const dimensions = dimensionsForFlowNode(node);
  const position = layout.get(node.id) || { x: 0, y: 0 };
  return {
    x: position.x + dimensions.width * anchor.x,
    y: position.y + dimensions.height * anchor.y,
  };
}

function centerFor(layout, node) {
  const dimensions = dimensionsForFlowNode(node);
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
      className: [
        edgeTouchesAbstract(edge, sourceNode, targetNode) ? "df-edge-abstract" : "",
      ].filter(Boolean).join(" "),
      zIndex: 1,
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

function graphViewportKey(nodes, edges, layout) {
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
  return `${nodeKey}::${edgeKey}`;
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
  const nodeTypes = useMemo(() => ({
    projectGroup: ProjectGroupNode,
    specGraphNode: SpecGraphNode,
  }), []);
  const activeLayout = layout || new Map();
  const viewportInteractedRef = useRef(false);
  const viewportKey = useMemo(
    () => graphViewportKey(nodes, edges, activeLayout),
    [activeLayout, edges, nodes],
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

    const projectGroups = projectGroupFlowNodes(nodes, activeLayout, selectedNodeId);
    const nextNodes = nodes.map((node) => {
      const dimensions = dimensionsForFlowNode(node);
      return {
        id: node.id,
        type: "specGraphNode",
        position: activeLayout.get(node.id) || { x: 0, y: 0 },
        zIndex: 10,
        data: {
          node,
          onSelect,
          selected: node.id === selectedNodeId,
        },
        draggable: false,
        selectable: true,
        style: {
          width: dimensions.width,
          height: dimensions.height,
        },
      };
    });
    setFlowNodes([...projectGroups, ...nextNodes]);
    setFlowEdges(toFlowEdges(edges, nodes, activeLayout));
  }, [activeLayout, edges, layoutPending, nodes, onSelect, selectedNodeId, setFlowEdges, setFlowNodes]);

  useEffect(() => {
    setFlowNodes((current) => current.map((node) => ({
      ...node,
      data: {
        ...node.data,
        selected: node.type === "projectGroup"
          ? Array.isArray(node.data?.memberIds) && node.data.memberIds.includes(selectedNodeId)
          : node.id === selectedNodeId,
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
    <FlowFrame>
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onMoveStart={handleMoveStart}
        onNodeClick={(_, node) => {
          if (node.type === "specGraphNode") onSelect(node.id);
        }}
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
        />
        <Background color="rgba(148, 163, 184, 0.08)" gap={28} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </FlowFrame>
  );
}

function ViewportFitController({ fitKey, shouldSkipFit }) {
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
      reactFlow.fitView({ padding: 0.18, duration: 0 });
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
  }, [fitKey, nodesInitialized, reactFlow, shouldSkipFit]);

  return null;
}

function ProjectGroupNode({ data }) {
  const label = text(data?.label, "Project");
  const projectRoot = text(data?.projectRoot || data?.visiblePath);
  const count = Number(data?.memberCount) || 0;
  return (
    <ProjectGroupFrame
      aria-hidden="true"
      $selected={Boolean(data?.selected)}
      $tone={data?.tone || "#14b8a6"}
    >
      <ProjectGroupHeader $tone={data?.tone || "#14b8a6"}>
        <ProjectGroupLabel title={label}>{label}</ProjectGroupLabel>
        {count > 0 && <ProjectGroupCount>{count}</ProjectGroupCount>}
      </ProjectGroupHeader>
      {projectRoot && <ProjectGroupPath title={projectRoot}>{projectRoot}</ProjectGroupPath>}
    </ProjectGroupFrame>
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
        {source && kind !== "folder" && !noSpec && (
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
    transition:
      filter 180ms ease,
      opacity 180ms ease,
      transform 420ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .react-flow__node-projectGroup {
    pointer-events: none;
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
    filter: drop-shadow(0 0 8px rgba(125, 211, 252, 0.45));
    stroke-linecap: round;
  }

  .react-flow__edge.df-edge-abstract {
    opacity: 0.62;
  }

  .react-flow__edge.df-edge-abstract .react-flow__edge-path {
    filter: drop-shadow(0 0 4px rgba(125, 211, 252, 0.18));
  }

  html[data-forge-theme="light"] & .react-flow__edge-path {
    filter: none;
  }

  html[data-forge-theme="light"] & .react-flow__edge.df-edge-abstract {
    opacity: 0.74;
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

const ProjectGroupFrame = styled.div`
  background:
    linear-gradient(135deg, ${({ $tone }) => colorWithAlpha($tone || "#14b8a6", "18")}, transparent 42%),
    rgba(5, 10, 18, 0.42);
  border: 1px solid ${({ $selected, $tone }) => colorWithAlpha($tone || "#14b8a6", $selected ? "aa" : "66")};
  border-radius: 8px;
  box-shadow: ${({ $selected, $tone }) => (
    $selected
      ? `0 0 0 2px ${colorWithAlpha($tone || "#14b8a6", "22")}, inset 0 0 34px ${colorWithAlpha($tone || "#14b8a6", "12")}`
      : `inset 0 0 26px ${colorWithAlpha($tone || "#14b8a6", "0f")}`
  )};
  height: 100%;
  overflow: hidden;
  pointer-events: none;
  position: relative;
  width: 100%;

  &::before {
    background-image:
      linear-gradient(${({ $tone }) => colorWithAlpha($tone || "#14b8a6", "1a")} 1px, transparent 1px),
      linear-gradient(90deg, ${({ $tone }) => colorWithAlpha($tone || "#14b8a6", "1a")} 1px, transparent 1px);
    background-size: 28px 28px;
    content: "";
    inset: 0;
    opacity: 0.34;
    position: absolute;
  }

  &::after {
    border: 1px dashed ${({ $tone }) => colorWithAlpha($tone || "#14b8a6", "54")};
    border-radius: 6px;
    content: "";
    inset: 10px;
    opacity: ${({ $selected }) => ($selected ? 0.82 : 0.52)};
    position: absolute;
  }

  html[data-forge-theme="light"] & {
    background:
      linear-gradient(135deg, ${({ $tone }) => colorWithAlpha(lightReadableTone($tone || "#0f766e"), "12")}, transparent 46%),
      rgba(255, 255, 255, 0.7);
    border-color: ${({ $selected, $tone }) => colorWithAlpha(lightReadableTone($tone || "#0f766e"), $selected ? "aa" : "55")};
    box-shadow: ${({ $selected, $tone }) => (
      $selected
        ? `0 0 0 2px ${colorWithAlpha(lightReadableTone($tone || "#0f766e"), "18")}`
        : "0 1px 2px rgba(0, 0, 0, 0.04)"
    )};
  }

  html[data-forge-theme="light"] &::before {
    background-image:
      linear-gradient(${({ $tone }) => colorWithAlpha(lightReadableTone($tone || "#0f766e"), "12")} 1px, transparent 1px),
      linear-gradient(90deg, ${({ $tone }) => colorWithAlpha(lightReadableTone($tone || "#0f766e"), "12")} 1px, transparent 1px);
  }

  html[data-forge-theme="light"] &::after {
    border-color: ${({ $tone }) => colorWithAlpha(lightReadableTone($tone || "#0f766e"), "44")};
  }
`;

const ProjectGroupHeader = styled.div`
  align-items: center;
  background: ${({ $tone }) => colorWithAlpha($tone || "#14b8a6", "20")};
  border: 1px solid ${({ $tone }) => colorWithAlpha($tone || "#14b8a6", "5c")};
  border-radius: 999px;
  color: ${({ $tone }) => colorWithAlpha($tone || "#14b8a6", "f2")};
  display: inline-flex;
  gap: 7px;
  left: 16px;
  max-width: calc(100% - 32px);
  min-width: 0;
  padding: 5px 8px 5px 10px;
  position: absolute;
  top: 14px;
  z-index: 2;

  html[data-forge-theme="light"] & {
    background: ${({ $tone }) => colorWithAlpha(lightReadableTone($tone || "#0f766e"), "10")};
    border-color: ${({ $tone }) => colorWithAlpha(lightReadableTone($tone || "#0f766e"), "42")};
    color: ${({ $tone }) => lightReadableTone($tone || "#0f766e")};
  }
`;

const ProjectGroupLabel = styled.div`
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
`;

const ProjectGroupCount = styled.div`
  align-items: center;
  background: rgba(4, 9, 16, 0.72);
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.86);
  display: inline-flex;
  flex: 0 0 auto;
  font-size: 9px;
  font-weight: 900;
  height: 18px;
  justify-content: center;
  min-width: 18px;
  padding: 0 5px;

  html[data-forge-theme="light"] & {
    background: rgba(255, 255, 255, 0.86);
    color: #1d1d1f;
  }
`;

const ProjectGroupPath = styled.div`
  bottom: 13px;
  color: rgba(219, 231, 247, 0.38);
  font-size: 9px;
  font-weight: 720;
  left: 18px;
  max-width: calc(100% - 36px);
  overflow: hidden;
  position: absolute;
  text-overflow: ellipsis;
  white-space: nowrap;
  z-index: 2;

  html[data-forge-theme="light"] & {
    color: #6e6e73;
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

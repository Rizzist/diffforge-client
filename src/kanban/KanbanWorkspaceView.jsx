import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import styled from "styled-components";

const GRAPH_NODE_SIZES = {
  main: 154,
  related: 108,
  distant: 74,
};
const GRAPH_MIN_ZOOM = 0.48;
const GRAPH_MAX_ZOOM = 1.8;
const GRAPH_ZOOM_STEP = 0.16;
const MAX_VISIBLE_AGENT_ORBITS = 6;

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

function metadata(item) {
  return jsonObject(field(item, "metadata", "metadata_json", "metadataJson"));
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

function isFileNodeType(nodeType) {
  return nodeType === "file" || nodeType === "implementation_unit";
}

function normalizeFreshnessState(value) {
  switch (text(value).toLowerCase()) {
    case "updated":
    case "in_sync":
    case "verified":
    case "linked":
      return "updated";
    case "behind_code":
    case "code_ahead":
    case "needs_review":
    case "review":
    case "stale":
      return "behind_code";
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
    case "behind_code":
      return "behind code";
    case "ahead_of_code":
    default:
      return "ahead of code";
  }
}

function freshnessTone(value) {
  switch (normalizeFreshnessState(value)) {
    case "updated":
      return "#34d399";
    case "behind_code":
      return "#fb7185";
    case "ahead_of_code":
    default:
      return "#fbbf24";
  }
}

function liveAgentsFor(node) {
  const count = Number(field(node, "active_agent_count", "activeAgentCount", "live_agent_count", "liveAgentCount")) || 0;
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({ id: `live-agent-${index}`, status: "active" }));
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
  const activeAgentCount = Math.max(
    0,
    Number(field(raw, "active_agent_count", "activeAgentCount", "live_agent_count", "liveAgentCount")) || 0,
  );
  const specs = jsonArray(field(raw, "specs"));
  const activeSpecs = jsonArray(field(raw, "active_specs", "activeSpecs"));
  const supersededSpecs = jsonArray(field(raw, "superseded_specs", "supersededSpecs"));
  const agentRationale = jsonArray(field(raw, "agent_rationale", "agentRationale"));
  return {
    ...raw,
    id,
    title,
    node_type: nodeType,
    summary,
    purpose,
    freshness_state: freshnessState,
    spec_state: freshnessState,
    spec_state_label: freshnessLabel(freshnessState),
    active_agent_count: activeAgentCount,
    specs,
    active_specs: activeSpecs,
    superseded_specs: supersededSpecs,
    agent_rationale: agentRationale,
    markdown: typeof rawMarkdown === "string" && rawMarkdown.trim()
      ? rawMarkdown
      : fallbackMarkdown({ title, summary, purpose, freshness_state: freshnessState, metadata: meta }),
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

function legacyTaskToNode(task, index) {
  const meta = metadata(task);
  return normalizeNode({
    id: field(task, "id", "task_id", "taskId") || `legacy-${index}`,
    title: field(task, "title", "summary"),
    summary: field(task, "body", "description", "summary"),
    node_type: "feature",
    status: field(task, "status"),
    active_agent_count: field(task, "agent_id", "agentId") ? 1 : 0,
    metadata: meta,
  }, index);
}

function normalizeSnapshot(snapshot) {
  const matrix = snapshot?.specGraph || snapshot?.raw || {};
  const specNodes = Array.isArray(snapshot?.specNodes)
    ? snapshot.specNodes
    : Array.isArray(matrix?.nodes)
      ? matrix.nodes
      : [];
  const fallbackTasks = Array.isArray(snapshot?.tasks) ? snapshot.tasks : [];
  const nodes = (specNodes.length ? specNodes : fallbackTasks.map(legacyTaskToNode))
    .map((node, index) => normalizeNode(node, index));

  const edgeSource = Array.isArray(snapshot?.specEdges)
    ? snapshot.specEdges
    : Array.isArray(matrix?.edges)
      ? matrix.edges
      : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  let edges = edgeSource
    .map((edge, index) => {
      const meta = metadata(edge);
      if (meta.hidden || field(edge, "hidden") === true) return null;
      return {
        id: text(field(edge, "id"), `edge-${index}`),
        from: text(field(edge, "from_node_id", "fromNodeId", "from", "source")),
        to: text(field(edge, "to_node_id", "toNodeId", "to", "target")),
        kind: text(field(edge, "edge_kind", "edgeKind", "kind"), "related"),
      };
    })
    .filter(Boolean)
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  if (!edges.length && nodes.length > 1) {
    const hub = nodes.find((node) => node.id.includes("project")) || nodes[0];
    edges = nodes
      .filter((node) => node.id !== hub.id)
      .slice(0, 32)
      .map((node, index) => ({
        id: `inferred-${index}`,
        from: hub.id,
        to: node.id,
        kind: "inferred",
      }));
  }

  return {
    matrix,
    nodes,
    edges,
    agentWork: snapshot?.agentWork || matrix?.agent_work || {},
    graphStats: snapshot?.graphStats || matrix?.graph_stats || matrix?.graphStats || {},
  };
}

function graphNodeSize(depth) {
  if (depth === 0) return GRAPH_NODE_SIZES.main;
  if (depth === 1) return GRAPH_NODE_SIZES.related;
  return GRAPH_NODE_SIZES.distant;
}

function graphLayerConfig(depth) {
  if (depth <= 0) return { radius: 0, maxPerRing: 1 };
  if (depth === 1) return { radius: 172, maxPerRing: 10 };
  return { radius: 288 + (depth - 2) * 108, maxPerRing: 18 };
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function graphRootNode(nodes, edges) {
  if (!nodes.length) return null;
  const degreeById = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (degreeById.has(edge.from)) degreeById.set(edge.from, degreeById.get(edge.from) + 1);
    if (degreeById.has(edge.to)) degreeById.set(edge.to, degreeById.get(edge.to) + 1);
  }
  return [...nodes].sort((left, right) => {
    const scoreFor = (node) => {
      const title = `${node.id} ${node.title}`.toLowerCase();
      const centralHint = title.includes("project") || title.includes("root") || title.includes("workspace") ? 140 : 0;
      const activeHint = node.active_agent_count * 90;
      const typeHint = isFileNodeType(node.node_type) ? -18 : 18;
      const freshnessHint = node.freshness_state === "updated" ? 0 : 18;
      return centralHint
        + activeHint
        + typeHint
        + freshnessHint
        + (degreeById.get(node.id) || 0) * 20;
    };
    const delta = scoreFor(right) - scoreFor(left);
    return delta || left.title.localeCompare(right.title);
  })[0];
}

function graphLayout(nodes, edges) {
  const root = graphRootNode(nodes, edges);
  const byId = {};
  if (!root) return { width: 760, height: 520, byId, rootId: "" };

  const nodeIds = new Set(nodes.map((node) => node.id));
  const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));
  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }

  const depthById = new Map([[root.id, 0]]);
  const queue = [root.id];
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    const depth = depthById.get(id) || 0;
    for (const next of adjacency.get(id) || []) {
      if (!depthById.has(next)) {
        depthById.set(next, depth + 1);
        queue.push(next);
      }
    }
  }

  const layers = new Map();
  for (const node of nodes) {
    const depth = depthById.has(node.id) ? depthById.get(node.id) : 2;
    if (!layers.has(depth)) layers.set(depth, []);
    layers.get(depth).push(node);
  }
  for (const layer of layers.values()) {
    layer.sort((left, right) => left.title.localeCompare(right.title));
  }

  let maxRadius = 0;
  for (const [depth, layer] of layers) {
    if (depth === 0) continue;
    const config = graphLayerConfig(depth);
    const overflowRings = Math.max(0, Math.ceil(layer.length / config.maxPerRing) - 1);
    maxRadius = Math.max(maxRadius, config.radius + overflowRings * 92);
  }

  const canvasRadius = Math.max(310, maxRadius + GRAPH_NODE_SIZES.main);
  const width = Math.max(760, canvasRadius * 2 + 80);
  const height = Math.max(560, canvasRadius * 2 + 80);
  const centerX = width / 2;
  const centerY = height / 2;

  for (const [depth, layer] of layers) {
    const size = graphNodeSize(depth);
    if (depth === 0) {
      byId[root.id] = { x: centerX - size / 2, y: centerY - size / 2, size, depth: 0 };
      continue;
    }

    const config = graphLayerConfig(depth);
    layer.forEach((node, index) => {
      const ringIndex = Math.floor(index / config.maxPerRing);
      const ringOffset = ringIndex * config.maxPerRing;
      const itemsInRing = Math.min(config.maxPerRing, layer.length - ringOffset);
      const angleOffset = depth % 2 === 0 ? Math.PI / Math.max(itemsInRing, 1) : 0;
      const angle = ((index - ringOffset) / Math.max(itemsInRing, 1)) * Math.PI * 2
        - Math.PI / 2
        + angleOffset;
      const radius = config.radius + ringIndex * 92;
      byId[node.id] = {
        x: centerX + Math.cos(angle) * radius - size / 2,
        y: centerY + Math.sin(angle) * radius - size / 2,
        size,
        depth,
      };
    });
  }

  return { width, height, byId, rootId: root.id };
}

function selectedFallback(nodes, selectedNodeId) {
  return nodes.find((node) => node.id === selectedNodeId) || nodes[0] || null;
}

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
  const refreshInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!repoPath || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setState((current) => (current === "idle" ? "loading" : current));
    try {
      const next = await invoke("cloud_mcp_get_spec_graph", {
        repoPath,
        workspaceId: workspace?.id || null,
        workspaceName: workspace?.name || null,
      });
      setSnapshot(next);
      setError("");
      setState("ready");
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
      setState("error");
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [repoPath, workspace?.id, workspace?.name]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1500);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const specGraph = useMemo(() => normalizeSnapshot(snapshot), [snapshot]);
  const selectedNode = selectedFallback(specGraph.nodes, selectedNodeId);

  useEffect(() => {
    if (!selectedNodeId && specGraph.nodes.length) {
      setSelectedNodeId(specGraph.nodes[0].id);
    }
  }, [specGraph.nodes, selectedNodeId]);

  return (
    <SpecGraphSurface aria-label={`${workspace?.name || "Workspace"} Spec Graph`} data-state={state}>
      {error && <SpecGraphError>{error}</SpecGraphError>}

      <SpecGraphShell>
        <SpecGraphMain>
          <GraphView
            nodes={specGraph.nodes}
            edges={specGraph.edges}
            selectedNodeId={selectedNode?.id}
            onSelect={setSelectedNodeId}
          />
        </SpecGraphMain>

        <SpecInspector node={selectedNode} />
      </SpecGraphShell>
    </SpecGraphSurface>
  );
}

function GraphView({ nodes, edges, selectedNodeId, onSelect }) {
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const centeredLayoutRef = useRef("");
  const layout = useMemo(() => graphLayout(nodes, edges), [nodes, edges]);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return undefined;
    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      setViewportSize({ width: rect.width, height: rect.height });
    };
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const centerGraph = useCallback((nextZoom = 1) => {
    const root = layout.byId[layout.rootId];
    if (!root || !viewportSize.width || !viewportSize.height) return;
    setPan({
      x: viewportSize.width / 2 - (root.x + root.size / 2) * nextZoom,
      y: viewportSize.height / 2 - (root.y + root.size / 2) * nextZoom,
    });
  }, [layout, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    const centerKey = `${layout.rootId}:${nodes.length}:${edges.length}:${Math.round(viewportSize.width)}x${Math.round(viewportSize.height)}`;
    if (centeredLayoutRef.current === centerKey) return;
    centeredLayoutRef.current = centerKey;
    setZoom(1);
    centerGraph(1);
  }, [centerGraph, edges.length, layout.rootId, nodes.length, viewportSize.height, viewportSize.width]);

  const zoomAt = useCallback((nextZoom, origin = null) => {
    setZoom((currentZoom) => {
      const clamped = clampNumber(nextZoom, GRAPH_MIN_ZOOM, GRAPH_MAX_ZOOM);
      if (clamped === currentZoom) return currentZoom;
      const rect = viewportRef.current?.getBoundingClientRect();
      const center = origin && rect
        ? { x: origin.x - rect.left, y: origin.y - rect.top }
        : { x: viewportSize.width / 2, y: viewportSize.height / 2 };
      setPan((currentPan) => ({
        x: center.x - ((center.x - currentPan.x) / currentZoom) * clamped,
        y: center.y - ((center.y - currentPan.y) / currentZoom) * clamped,
      }));
      return clamped;
    });
  }, [viewportSize.height, viewportSize.width]);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("[data-graph-node]")) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pan,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [pan]);

  const handlePointerMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({
      x: drag.pan.x + event.clientX - drag.startX,
      y: drag.pan.y + event.clientY - drag.startY,
    });
  }, []);

  const finishDrag = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleWheel = useCallback((event) => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    zoomAt(zoom + direction * GRAPH_ZOOM_STEP, { x: event.clientX, y: event.clientY });
  }, [zoom, zoomAt]);

  if (!nodes.length) {
    return <EmptyState>No spec graph nodes yet.</EmptyState>;
  }

  return (
    <GraphScroller
      ref={viewportRef}
      $dragging={isDragging}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onWheel={handleWheel}
    >
      <GraphToolbar>
        <GraphToolButton type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomAt(zoom - GRAPH_ZOOM_STEP)}>
          -
        </GraphToolButton>
        <GraphToolButton type="button" aria-label="Reset graph view" title="Reset graph view" onClick={() => {
          setZoom(1);
          centerGraph(1);
        }}>
          •
        </GraphToolButton>
        <GraphToolButton type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomAt(zoom + GRAPH_ZOOM_STEP)}>
          +
        </GraphToolButton>
      </GraphToolbar>
      <GraphCanvas
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
        }}
      >
        <EdgeLayer width={layout.width} height={layout.height} aria-hidden="true">
          {edges.map((edge) => {
            const from = layout.byId[edge.from];
            const to = layout.byId[edge.to];
            if (!from || !to) return null;
            return (
              <g key={edge.id}>
                <line
                  x1={from.x + from.size / 2}
                  y1={from.y + from.size / 2}
                  x2={to.x + to.size / 2}
                  y2={to.y + to.size / 2}
                />
              </g>
            );
          })}
        </EdgeLayer>
        {nodes.map((node) => {
          const point = layout.byId[node.id] || { x: 20, y: 20, size: GRAPH_NODE_SIZES.distant, depth: 2 };
          const tone = freshnessTone(node.freshness_state);
          const liveAgents = liveAgentsFor(node);
          const liveAgentCount = liveAgents.length;
          return (
            <GraphNodeButton
              key={node.id}
              type="button"
              data-graph-node="true"
              style={{
                left: point.x,
                top: point.y,
                width: point.size,
                height: point.size,
              }}
              $tone={tone}
              $active={node.id === selectedNodeId}
              $depth={point.depth}
              $freshness={node.freshness_state}
              $live={liveAgentCount > 0}
              onClick={() => onSelect(node.id)}
            >
              {liveAgents.slice(0, MAX_VISIBLE_AGENT_ORBITS).map((agent, index) => (
                <ActiveAgentOrbit
                  key={`${node.id}-orbit-${field(agent, "agent_id", "agentId", "id") || index}`}
                  aria-hidden="true"
                  $depth={point.depth}
                  $tone={tone}
                  $index={index}
                  $total={liveAgentCount}
                />
              ))}
              {liveAgentCount > 0 && <AgentCountBadge>{liveAgentCount}</AgentCountBadge>}
              <NodeTitle $depth={point.depth}>{node.title}</NodeTitle>
            </GraphNodeButton>
          );
        })}
      </GraphCanvas>
    </GraphScroller>
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

  return (
    <Inspector>
      <InspectorHeader>
        <h2>{node.title}</h2>
        <InspectorFacts>
          <span data-state={node.freshness_state}>{freshnessLabel(node.freshness_state)}</span>
          <span>{node.active_agent_count} {node.active_agent_count === 1 ? "agent" : "agents"}</span>
        </InspectorFacts>
      </InspectorHeader>
      <MarkdownPane>
        <pre>{node.markdown}</pre>
        <SpecObjectList title="Active Specs" specs={node.active_specs} empty="No active specs recorded yet." />
        <SpecObjectList
          title="Superseded History"
          specs={node.superseded_specs}
          empty="No superseded specs yet."
          historical
        />
      </MarkdownPane>
    </Inspector>
  );
}

function SpecObjectList({ title, specs, empty, historical = false }) {
  const visibleSpecs = Array.isArray(specs) ? specs : [];
  return (
    <SpecObjectsSection>
      <h3>{title}</h3>
      {visibleSpecs.length ? (
        visibleSpecs.map((spec, index) => (
          <SpecObjectCard key={field(spec, "id") || `${title}-${index}`} $historical={historical}>
            <p>{text(field(spec, "statement"), "Unnamed spec")}</p>
            {historical && text(field(spec, "supersession_reason")) && (
              <small>Reason: {text(field(spec, "supersession_reason"))}</small>
            )}
          </SpecObjectCard>
        ))
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

const GraphScroller = styled.div`
  height: 100%;
  overflow: hidden;
  position: relative;
  touch-action: none;
  cursor: ${({ $dragging }) => ($dragging ? "grabbing" : "grab")};
  user-select: none;
`;

const GraphCanvas = styled.div`
  left: 0;
  position: absolute;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
`;

const GraphToolbar = styled.div`
  align-items: center;
  display: flex;
  gap: 5px;
  left: 10px;
  position: absolute;
  top: 10px;
  z-index: 4;
`;

const GraphToolButton = styled.button`
  align-items: center;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 7px;
  background: rgba(13, 17, 23, 0.82);
  color: rgba(219, 231, 247, 0.8);
  cursor: pointer;
  display: inline-flex;
  font-size: 15px;
  font-weight: 850;
  height: 30px;
  justify-content: center;
  line-height: 1;
  padding: 0;
  width: 30px;

  &:hover {
    border-color: rgba(56, 189, 248, 0.44);
    color: #dff5ff;
  }
`;

const EdgeLayer = styled.svg`
  inset: 0;
  pointer-events: none;
  position: absolute;

  line {
    stroke: rgba(230, 236, 245, 0.18);
    stroke-linecap: round;
    stroke-width: 1.2;
  }
`;

const GraphNodeButton = styled.button`
  align-items: center;
  border: 1px solid ${({ $active, $tone }) => ($active ? $tone : "rgba(230, 236, 245, 0.13)")};
  border-radius: 999px;
  background:
    radial-gradient(circle at 48% 38%, ${({ $tone }) => `${$tone || "#38bdf8"}24`}, rgba(13, 17, 23, 0.86) 58%),
    rgba(13, 17, 23, 0.9);
  box-shadow: ${({ $active, $live, $tone }) => {
    if ($active) return `0 0 0 2px ${$tone}4d, 0 18px 44px rgba(0, 0, 0, 0.34)`;
    if ($live) return `0 0 0 1px ${$tone}33, 0 12px 30px rgba(0, 0, 0, 0.24)`;
    return "0 12px 30px rgba(0, 0, 0, 0.2)";
  }};
  color: inherit;
  cursor: pointer;
  display: flex;
  justify-content: center;
  padding: ${({ $depth }) => ($depth === 0 ? "18px" : $depth === 1 ? "13px" : "9px")};
  position: absolute;
  text-align: center;
  overflow: visible;

  &:hover {
    border-color: ${({ $tone }) => $tone || "#38bdf8"};
    transform: scale(1.025);
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
`;

const ActiveAgentOrbit = styled.span`
  animation: spec-node-agent-orbit ${({ $depth, $index }) => {
    const base = $depth === 0 ? 3.2 : $depth === 1 ? 2.75 : 2.35;
    return `${base + (($index || 0) * 0.42)}s`;
  }} linear infinite ${({ $index }) => ($index % 2 ? "reverse" : "normal")};
  animation-delay: ${({ $index }) => `${-0.28 * ($index || 0)}s`};
  border-radius: 999px;
  inset: ${({ $depth, $index }) => {
    const base = $depth === 0 ? 13 : $depth === 1 ? 10 : 8;
    return `-${base + (($index || 0) * 5)}px`;
  }};
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
    height: ${({ $depth }) => ($depth === 0 ? "11px" : $depth === 1 ? "9px" : "7px")};
    position: absolute;
    right: 0;
    top: ${({ $index, $total }) => {
      if (($total || 0) < 2) return "50%";
      const spread = (($index || 0) % 3) - 1;
      return `${50 + spread * 9}%`;
    }};
    transform: translate(50%, -50%);
    width: ${({ $depth }) => ($depth === 0 ? "11px" : $depth === 1 ? "9px" : "7px")};
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

const NodeTitle = styled.div`
  color: var(--forge-text-soft, #eef5ff);
  display: -webkit-box;
  font-size: ${({ $depth }) => ($depth === 0 ? "13px" : $depth === 1 ? "10.5px" : "9px")};
  font-weight: ${({ $depth }) => ($depth === 0 ? 820 : 780)};
  line-height: 1.18;
  overflow: hidden;
  text-overflow: ellipsis;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: ${({ $depth }) => ($depth === 0 ? 5 : $depth === 1 ? 4 : 3)};
  word-break: break-word;
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
`;

const MarkdownPane = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;

  pre {
    color: rgba(229, 236, 246, 0.86);
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 11px;
    font-weight: 560;
    line-height: 1.5;
    margin: 0;
    padding: 12px;
    white-space: pre-wrap;
    word-break: break-word;
  }
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

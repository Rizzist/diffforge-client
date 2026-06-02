import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { layoutSpecGraph } from "../specGraphLayout.js";
import ThreeGraphRenderer from "./ThreeGraphRenderer.jsx";

const MAX_VIEWPORT_CACHE_ENTRIES = 24;
const graphViewportCache = new Map();

function graphTopologyKey(nodes, edges) {
  const nodeKey = (nodes || [])
    .map((node) => node.id)
    .filter(Boolean)
    .sort()
    .join("|");
  const edgeKey = (edges || [])
    .map((edge) => `${edge.from || ""}->${edge.to || ""}:${edge.kind || ""}`)
    .sort()
    .join("|");
  return `${nodeKey}::${edgeKey}`;
}

function graphViewportCacheKey(viewKey, topologyKey) {
  const owner = String(viewKey || "spec-graph").trim() || "spec-graph";
  return `${owner}::${topologyKey || "empty"}`;
}

function readGraphViewportCache(cacheKey) {
  return graphViewportCache.get(cacheKey) || null;
}

function writeGraphViewportCache(cacheKey, cameraState) {
  if (!cacheKey || !cameraState) return;
  const next = {
    x: Number(cameraState.x),
    y: Number(cameraState.y),
    zoom: Number(cameraState.zoom),
  };
  if (!Number.isFinite(next.x) || !Number.isFinite(next.y) || !Number.isFinite(next.zoom)) return;
  if (graphViewportCache.has(cacheKey)) graphViewportCache.delete(cacheKey);
  graphViewportCache.set(cacheKey, next);
  while (graphViewportCache.size > MAX_VIEWPORT_CACHE_ENTRIES) {
    graphViewportCache.delete(graphViewportCache.keys().next().value);
  }
}

export default function GraphRendererHost({
  nodes,
  edges,
  selectedNodeId,
  onSelect,
  state,
  emptyLabel,
  layoutLabel,
  viewKey,
}) {
  const [layout, setLayout] = useState(() => new Map());
  const [layoutPending, setLayoutPending] = useState(false);
  const lastLayoutKeyRef = useRef("");
  const topologyKey = useMemo(() => graphTopologyKey(nodes, edges), [edges, nodes]);
  const viewportCacheKey = useMemo(
    () => graphViewportCacheKey(viewKey, topologyKey),
    [topologyKey, viewKey],
  );
  const initialCameraState = useMemo(
    () => readGraphViewportCache(viewportCacheKey),
    [viewportCacheKey],
  );
  const handleCameraChange = useCallback((cameraState) => {
    writeGraphViewportCache(viewportCacheKey, cameraState);
  }, [viewportCacheKey]);

  useEffect(() => {
    let cancelled = false;

    if (!nodes.length) {
      setLayout(new Map());
      setLayoutPending(false);
      lastLayoutKeyRef.current = "";
      return () => {
        cancelled = true;
      };
    }

    if (topologyKey === lastLayoutKeyRef.current) {
      setLayoutPending(false);
      return () => {
        cancelled = true;
      };
    }

    setLayout(new Map());
    setLayoutPending(true);
    const runLayout = () => {
      layoutSpecGraph(nodes, edges)
        .then((nextLayout) => {
          if (cancelled) return;
          lastLayoutKeyRef.current = topologyKey;
          setLayout(nextLayout);
          setLayoutPending(false);
        })
        .catch(() => {
          if (cancelled) return;
          lastLayoutKeyRef.current = topologyKey;
          setLayout(new Map());
          setLayoutPending(false);
        });
    };
    let idleId = 0;
    let timeoutId = 0;
    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(runLayout, { timeout: 360 });
    } else {
      timeoutId = window.setTimeout(runLayout, 0);
    }

    return () => {
      cancelled = true;
      if (idleId && typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [edges, nodes, topologyKey]);

  return (
    <ThreeGraphRenderer
      nodes={nodes}
      edges={edges}
      layout={layout}
      layoutPending={layoutPending}
      selectedNodeId={selectedNodeId}
      onSelect={onSelect}
      initialCameraState={initialCameraState}
      onCameraChange={handleCameraChange}
      state={state}
      emptyLabel={emptyLabel}
      layoutLabel={layoutLabel}
      viewportCacheKey={viewportCacheKey}
    />
  );
}

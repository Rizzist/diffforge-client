import { useEffect, useMemo, useRef, useState } from "react";
import { layoutSpecGraph } from "../specGraphLayout.js";
import ThreeGraphRenderer from "./ThreeGraphRenderer.jsx";

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

export default function GraphRendererHost({
  nodes,
  edges,
  selectedNodeId,
  onSelect,
  state,
  emptyLabel,
  layoutLabel,
}) {
  const [layout, setLayout] = useState(() => new Map());
  const [layoutPending, setLayoutPending] = useState(false);
  const lastLayoutKeyRef = useRef("");
  const topologyKey = useMemo(() => graphTopologyKey(nodes, edges), [edges, nodes]);

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
      state={state}
      emptyLabel={emptyLabel}
      layoutLabel={layoutLabel}
    />
  );
}

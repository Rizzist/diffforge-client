import { useEffect, useMemo, useRef, useState } from "react";
import { layoutSpecGraph } from "../specGraphLayout.js";
import ThreeGraphRenderer from "./ThreeGraphRenderer.jsx";
import XyflowGraphRenderer from "./XyflowGraphRenderer.jsx";

const THREE_RENDERER_ENABLED = false;

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
  rendererPreference = "xyflow",
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
    layoutSpecGraph(nodes, edges).then((nextLayout) => {
      if (cancelled) return;
      lastLayoutKeyRef.current = topologyKey;
      setLayout(nextLayout);
      setLayoutPending(false);
    });

    return () => {
      cancelled = true;
    };
  }, [edges, nodes, topologyKey]);

  const rendererProps = {
    nodes,
    edges,
    layout,
    layoutPending,
    selectedNodeId,
    onSelect,
    state,
    emptyLabel,
    layoutLabel,
  };

  if (THREE_RENDERER_ENABLED && rendererPreference === "three") {
    return <ThreeGraphRenderer {...rendererProps} />;
  }

  return <XyflowGraphRenderer {...rendererProps} />;
}

import { useEffect, useState } from "react";
import { layoutSpecGraph } from "../specGraphLayout.js";
import ThreeGraphRenderer from "./ThreeGraphRenderer.jsx";
import XyflowGraphRenderer from "./XyflowGraphRenderer.jsx";

const THREE_RENDERER_ENABLED = false;

export default function GraphRendererHost({
  nodes,
  edges,
  selectedNodeId,
  onSelect,
  state,
  rendererPreference = "xyflow",
}) {
  const [layout, setLayout] = useState(() => new Map());
  const [layoutPending, setLayoutPending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!nodes.length) {
      setLayout(new Map());
      setLayoutPending(false);
      return () => {
        cancelled = true;
      };
    }

    setLayoutPending(true);
    layoutSpecGraph(nodes, edges).then((nextLayout) => {
      if (cancelled) return;
      setLayout(nextLayout);
      setLayoutPending(false);
    });

    return () => {
      cancelled = true;
    };
  }, [edges, nodes]);

  const rendererProps = {
    nodes,
    edges,
    layout,
    layoutPending,
    selectedNodeId,
    onSelect,
    state,
  };

  if (THREE_RENDERER_ENABLED && rendererPreference === "three") {
    return <ThreeGraphRenderer {...rendererProps} />;
  }

  return <XyflowGraphRenderer {...rendererProps} />;
}

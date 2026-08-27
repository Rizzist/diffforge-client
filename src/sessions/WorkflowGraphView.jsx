import styled from "styled-components";

/* Live workflow-graph view (P6): the workflow_graph_v1 runtime projection —
   topology (nodes + edges) and per-node state from workflow.graph.state,
   kept live by the useWorkflowGraph watch loop. DISPLAY-ONLY: it renders
   the projection and dispatches nothing — every invoke lives in
   useWorkflowGraph.js. Honesty rules render here:
   - the ast_digest FENCE badge: the rendered topology is "as of" that
     digest, verbatim from the daemon — never recomputed locally, and an
     absent digest says "not published";
   - an UNSEEN state read renders "not read yet" — never collapsed into a
     "no live workflow graph" claim for a state we never read;
   - a read that said null renders the honest "No live workflow graph for
     this session." — never a fabricated empty graph;
   - per-node state is the projection's published string VERBATIM (a node
     without one says "state not published" — never a guessed phase);
   - edges render only when the ast PUBLISHED an edge list — otherwise
     "Topology edges not published", never a zero-edge topology as fact;
   - the live watch cursor and through_cursor render VERBATIM;
   - an unknown journal event renders as an unrecognized activity with its
     raw type — never dropped, never coerced. */

const FENCE_TITLE = "ast_digest — the topology fence. The topology rendered "
  + "below is the graph as of this digest, verbatim from the daemon; it is "
  + "never recomputed locally.";

const EVENT_LABELS = {
  workflow_graph_started: "graph started",
  workflow_node_activated: "node activated",
  workflow_node_completed: "node completed",
  workflow_node_rejected: "node rejected",
};

export default function WorkflowGraphView({
  entry = undefined,
  cursor = null,
  events = [],
  error = "",
  unavailable = false,
}) {
  if (unavailable) {
    return (
      <GraphSection aria-label="Workflow live graph">
        <GraphTitle>Live graph</GraphTitle>
        <GraphMutedHint>
          The workflow live graph is unavailable on this daemon.
        </GraphMutedHint>
      </GraphSection>
    );
  }

  return (
    <GraphSection aria-label="Workflow live graph">
      <GraphHeader>
        <GraphTitle>Live graph</GraphTitle>
        {/* Live watch cursor: the decimal STRING as-is — null is honestly
            "no position yet" (the loop has not baselined), never a
            fabricated "0" and never a numeric round-trip. */}
        <GraphCursorChip title="The session-journal cursor the live watch has advanced through (after_cursor = next_cursor, verbatim).">
          watch cursor: {cursor == null ? "(none yet)" : cursor}
        </GraphCursorChip>
      </GraphHeader>

      {/* An UNSEEN read stays "not read yet" — claiming "no live graph"
          here would fabricate a daemon statement we never received. */}
      {entry == null && (
        <GraphMutedHint>Workflow graph not read yet.</GraphMutedHint>
      )}

      {entry?.kind === "none" && (
        <GraphMutedHint>
          No live workflow graph for this session.
        </GraphMutedHint>
      )}

      {entry?.kind === "graph" && (
        <>
          <GraphFactGrid>
            <GraphFactRow>
              <b>graph</b>
              <span>{entry.graphId || "(unnamed)"}</span>
            </GraphFactRow>
            <GraphFactRow>
              <b>phase</b>
              <span>{entry.phase || "(not published)"}</span>
            </GraphFactRow>
            {/* THE topology fence: ast_digest verbatim. The topology below
                is "as of" this digest — never recomputed locally. */}
            <GraphFenceBadge title={FENCE_TITLE}>
              <b>ast digest (fence)</b>
              <span>{entry.astDigest ?? "(not published)"}</span>
            </GraphFenceBadge>
            <GraphFactRow>
              <b>through_cursor</b>
              {/* The decimal cursor string as-is — no numeric round-trip. */}
              <span>{entry.throughCursor ?? "(not published)"}</span>
            </GraphFactRow>
            {entry.backEdgeActivations != null && (
              <GraphFactRow>
                <b>back-edge activations</b>
                <span>{JSON.stringify(entry.backEdgeActivations)}</span>
              </GraphFactRow>
            )}
          </GraphFactGrid>

          <GraphGroupLabel>Nodes</GraphGroupLabel>
          {entry.nodes.length === 0 && (
            <GraphMutedHint>The projection published no nodes.</GraphMutedHint>
          )}
          <GraphNodeList>
            {entry.nodes.map((node, index) => (
              <GraphNodeRow key={node.nodeId || `node:${index}`}>
                <GraphNodeId>{node.nodeId || "(unnamed node)"}</GraphNodeId>
                {/* Per-node state: the projection's published string,
                    VERBATIM — an absent one is admitted, never guessed
                    from the node's id or name. */}
                <GraphNodeStateChip data-state={node.state ?? "unpublished"}>
                  {node.state ?? "state not published"}
                </GraphNodeStateChip>
              </GraphNodeRow>
            ))}
          </GraphNodeList>

          <GraphGroupLabel>Edges</GraphGroupLabel>
          {/* Edges are LIFTED from the ast — when the ast publishes no
              edge list, that absence is said out loud, never rendered as
              a zero-edge topology. */}
          {!entry.edgesPublished && (
            <GraphMutedHint>
              Topology edges not published by this graph&apos;s ast.
            </GraphMutedHint>
          )}
          {entry.edgesPublished && entry.edges.length === 0 && (
            <GraphMutedHint>The ast published an empty edge list.</GraphMutedHint>
          )}
          {entry.edgesPublished && entry.edges.length > 0 && (
            <GraphEdgeList>
              {entry.edges.map((edge, index) => (
                <GraphEdgeRow data-kind={edge.kind} key={`edge:${index}`}>
                  <GraphEdgeKindBadge data-kind={edge.kind}>
                    {edge.kind === "unknown"
                      ? (edge.kindRaw ?? "(no kind)")
                      : edge.kind.replace("_", " ")}
                  </GraphEdgeKindBadge>
                  <span>
                    {edge.from ?? "(graph input)"}
                    {" → "}
                    {edge.to ?? "(no target)"}
                  </span>
                </GraphEdgeRow>
              ))}
            </GraphEdgeList>
          )}
        </>
      )}

      {events.length > 0 && (
        <>
          <GraphGroupLabel>Recent activity</GraphGroupLabel>
          <GraphEventList>
            {events.map((event, index) => (
              <GraphEventRow data-kind={event.kind} key={`event:${index}`}>
                <span>
                  {event.cursor == null ? "·" : event.cursor}
                </span>
                {event.kind === "unknown" ? (
                  /* An unknown journal fact is an unrecognized activity —
                     shown with its raw type, never dropped or coerced. */
                  <em title="A journal fact type this client does not recognize — preserved verbatim, never dropped.">
                    unrecognized activity
                    {event.typeRaw ? ` (${event.typeRaw})` : " (untyped)"}
                  </em>
                ) : (
                  <span>{EVENT_LABELS[event.kind] ?? event.kind}</span>
                )}
              </GraphEventRow>
            ))}
          </GraphEventList>
        </>
      )}

      {error && <GraphErrorHint role="alert">{error}</GraphErrorHint>}
    </GraphSection>
  );
}

const GraphSection = styled.section`
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 10px 14px;
  min-height: 0;
  overflow-y: auto;
`;

const GraphHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const GraphTitle = styled.div`
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const GraphCursorChip = styled.span`
  padding: 1px 6px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-family: var(--forge-mono, monospace);
`;

const GraphFactGrid = styled.div`
  display: grid;
  gap: 2px;
`;

const GraphFactRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 10px;
  color: var(--forge-text-soft);

  b {
    flex: 0 0 auto;
    color: var(--forge-text-muted);
    font-weight: 650;
  }

  span {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-family: var(--forge-mono, monospace);
  }
`;

const GraphFenceBadge = styled(GraphFactRow)`
  padding: 2px 6px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.52);
  border-radius: 6px;
  width: fit-content;
  max-width: 100%;
`;

const GraphGroupLabel = styled.div`
  padding-top: 4px;
  color: var(--forge-text-muted);
  font-size: 9px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.04em;
`;

const GraphNodeList = styled.div`
  display: grid;
  gap: 2px;
`;

const GraphNodeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 7px;
`;

const GraphNodeId = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--forge-text-soft);
  font-family: var(--forge-mono, monospace);
  font-size: 11px;
`;

const GraphNodeStateChip = styled.span`
  flex: 0 0 auto;
  padding: 1px 6px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 5px;
  color: var(--forge-text-muted);
  font-size: 9px;
  font-weight: 600;

  &[data-state="completed"],
  &[data-state="complete"] {
    color: var(--forge-green, #4fbf6f);
  }

  &[data-state="rejected"] {
    color: var(--forge-red);
  }

  &[data-state="activated"],
  &[data-state="active"] {
    color: var(--forge-tint-soft, var(--forge-blue, #62a0ff));
  }
`;

const GraphEdgeList = styled.div`
  display: grid;
  gap: 1px;
`;

const GraphEdgeRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 1px 8px;
  font-size: 10px;
  color: var(--forge-text-soft);

  > span {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-family: var(--forge-mono, monospace);
  }
`;

const GraphEdgeKindBadge = styled.span`
  flex: 0 0 auto;
  padding: 0 5px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 5px;
  color: var(--forge-text-muted);
  font-size: 9px;
  font-weight: 600;

  &[data-kind="back"] {
    color: var(--forge-tint-soft, var(--forge-blue, #62a0ff));
  }

  &[data-kind="unknown"] {
    font-style: italic;
  }
`;

const GraphEventList = styled.div`
  display: grid;
  gap: 1px;
`;

const GraphEventRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 8px;
  font-size: 10px;
  color: var(--forge-text-soft);

  > span:first-child {
    flex: 0 0 auto;
    min-width: 28px;
    color: var(--forge-text-muted);
    font-family: var(--forge-mono, monospace);
    text-align: right;
  }

  em {
    color: var(--forge-text-muted);
  }
`;

const GraphMutedHint = styled.div`
  padding: 2px 0;
  color: var(--forge-text-muted);
  font-size: 10px;
`;

const GraphErrorHint = styled.div`
  padding: 2px 0;
  color: var(--forge-red);
  font-size: 10px;
`;

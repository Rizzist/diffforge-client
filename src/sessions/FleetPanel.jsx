import { useCallback, useState } from "react";
import styled from "styled-components";

import { findFleetNode, nodeLabel } from "./fleetModel.js";

/* Subagent fleet panel (P2). PRESENTATIONAL ONLY — every daemon read/write
   lives in useFleet.js; this component renders fleetModel views and
   dispatches through callbacks. The honesty rules render here:
   - a node with folded children shows "N more not shown" and is NEVER drawn
     as a plain leaf; a bounded/truncated snapshot carries a visible
     "Bounded snapshot" banner and is never presented as the complete tree;
   - absent metrics/usage render as "no data", never a fabricated 0, and
     an absent completeness flag renders as UNKNOWN — "partial" is claimed
     only for an explicit false from the daemon;
   - a node without a daemon callsign shows its agent id VISIBLY marked as a
     client fallback (id: prefix + explanatory title), never dressed up as a
     daemon-assigned identity;
   - an UNREAD fleet ("Fleet not read.") and an available-but-empty fleet
     ("No subagents.") are distinct states;
   - the composer messages only a REAL selected agent through its REAL
     parent session id, and is disabled when the fleet is unavailable. */

const STATE_ORDER = ["queued", "live", "waiting", "done", "failed", "cancelled"];

function formatElapsed(ms) {
  if (ms == null) return "no data";
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(Math.round(seconds % 60)).padStart(2, "0")}s`;
}

function compactJson(value) {
  try {
    const text = JSON.stringify(value);
    return text.length > 60 ? `${text.slice(0, 60)}…` : text;
  } catch {
    return String(value);
  }
}

function FleetNodeRows({ node, level, selectedAgentId, onSelectNode }) {
  const label = nodeLabel(node);
  return (
    <>
      <NodeRow
        data-bounded={node.bounded ? "true" : undefined}
        data-selected={node.agentId === selectedAgentId ? "true" : undefined}
        data-state={node.state.kind}
        onClick={() => onSelectNode?.(node)}
        style={{ "--fleet-indent": `${level * 16}px` }}
        title="Open this subagent's nested transcript"
        type="button"
      >
        <NodeStateDot aria-hidden="true" data-state={node.state.kind} />
        {label.fallback ? (
          <NodeFallbackId title="No daemon callsign — showing the agent id (client fallback)">
            id:{label.text || "unknown"}
          </NodeFallbackId>
        ) : (
          <NodeCallsign>{label.text}</NodeCallsign>
        )}
        <NodeTask>{node.task}</NodeTask>
        <NodeState data-state={node.state.kind}>{node.state.label}</NodeState>
      </NodeRow>
      {node.children.map((child) => (
        <FleetNodeRows
          key={child.agentId || child.sessionId}
          level={level + 1}
          node={child}
          onSelectNode={onSelectNode}
          selectedAgentId={selectedAgentId}
        />
      ))}
      {node.foldedChildren > 0 && (
        <FoldedRow style={{ "--fleet-indent": `${(level + 1) * 16}px` }}>
          {node.foldedChildren} more not shown (bounded)
        </FoldedRow>
      )}
    </>
  );
}

export default function FleetPanel({
  entry = undefined,
  error = "",
  loading = false,
  unavailable = false,
  selectedAgentId = "",
  onSelectNode = null,
  onRefresh = null,
  onObserveAll = null,
  onSendMessage = null,
}) {
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);

  const selectedNode = entry ? findFleetNode(entry.tree, selectedAgentId) : null;
  const selectedLabel = selectedNode ? nodeLabel(selectedNode) : null;

  const commitSend = useCallback(async () => {
    if (!selectedNode || !messageText.trim() || sending) return;
    setSending(true);
    try {
      const result = await onSendMessage?.(selectedNode, messageText);
      if (result?.ok) {
        setLastReceipt(result.receipt);
        setMessageText("");
      }
    } finally {
      setSending(false);
    }
  }, [messageText, onSendMessage, selectedNode, sending]);

  if (unavailable) {
    return (
      <FleetSection aria-label="Subagents">
        <FleetHeader>
          <FleetTitle>Subagents</FleetTitle>
        </FleetHeader>
        <FleetMutedHint>Subagent fleet is unavailable on this daemon.</FleetMutedHint>
      </FleetSection>
    );
  }

  const rollup = entry?.rollup || null;
  const truncation = entry?.truncation || null;
  const roots = entry?.tree?.roots || [];

  return (
    <FleetSection aria-label="Subagents">
      <FleetHeader>
        <FleetTitle>Subagents</FleetTitle>
        <FleetHeaderActions>
          {entry && roots.length > 0 && (
            <FleetHeaderButton
              onClick={() => onObserveAll?.()}
              title="Observe every listed child session in one batch (session.observe_batch)"
              type="button"
            >
              Observe all
            </FleetHeaderButton>
          )}
          <FleetHeaderButton
            disabled={loading}
            onClick={() => onRefresh?.()}
            title="Re-read the fleet snapshot (session.fleet)"
            type="button"
          >
            {loading ? "Reading…" : entry ? "Refresh" : "Read fleet"}
          </FleetHeaderButton>
        </FleetHeaderActions>
      </FleetHeader>

      {error && <FleetErrorLine role="alert">{error}</FleetErrorLine>}

      {!entry && !error && (
        <FleetMutedHint>
          {loading ? "Reading the fleet snapshot…" : "Fleet not read."}
        </FleetMutedHint>
      )}

      {entry && (
        <>
          {rollup && (
            <RollupRow aria-label="Fleet rollup">
              <RollupChip title="Nodes returned in this snapshot">
                nodes {rollup.nodeCount ?? "no data"}
              </RollupChip>
              {STATE_ORDER.map((stateKey) => {
                const count = rollup.states[stateKey];
                if (count == null || count === 0) return null;
                return (
                  <RollupChip data-state={stateKey} key={stateKey}>
                    {stateKey} {count}
                  </RollupChip>
                );
              })}
              <RollupChip title="Deepest returned descendant">
                depth {rollup.maxDepth ?? "no data"}
              </RollupChip>
              <RollupChip title="Total elapsed over returned nodes (absent metrics are 'no data', never zero)">
                elapsed {formatElapsed(rollup.elapsedMs)}
              </RollupChip>
              <RollupChip title="Total tool attempts over returned nodes">
                tools {rollup.toolAttempts ?? "no data"}
              </RollupChip>
              <RollupChip
                title={rollup.usage != null
                  ? "Usage totals as the daemon reported them (verbatim)"
                  : "At least one node lacks durable usage truth — no data, not zero"}
              >
                usage {rollup.usage != null ? compactJson(rollup.usage) : "no data"}
              </RollupChip>
              {/* Completeness is a TRI-state claim: "partial" only when the
                  daemon explicitly said metrics_complete:false; an ABSENT
                  flag is unknown — asserting "partial" (or "complete") from
                  absence would fabricate a report the daemon never made. */}
              {rollup.metricsComplete === false && (
                <RollupChip data-warn="true" title="The daemon reported these metric totals as incomplete">
                  metrics partial
                </RollupChip>
              )}
              {rollup.metricsComplete == null && (
                <RollupChip title="The daemon did not report whether these metric totals are complete">
                  metrics completeness unknown
                </RollupChip>
              )}
            </RollupRow>
          )}

          {truncation?.kind === "bounded" && (
            <BoundedBanner>
              Bounded snapshot — not the complete tree
              (node limit {truncation.nodeLimit ?? "?"}, depth limit {truncation.depthLimit ?? "?"}).
            </BoundedBanner>
          )}

          {roots.length === 0 && (
            <FleetMutedHint>
              {truncation?.kind === "bounded"
                ? "No nodes returned in this bounded snapshot."
                : "No subagents."}
            </FleetMutedHint>
          )}

          {roots.length > 0 && (
            <FleetTree role="tree">
              {roots.map((node) => (
                <FleetNodeRows
                  key={node.agentId || node.sessionId}
                  level={0}
                  node={node}
                  onSelectNode={onSelectNode}
                  selectedAgentId={selectedAgentId}
                />
              ))}
            </FleetTree>
          )}

          <ComposerBlock>
            {selectedNode ? (
              <>
                <ComposerTarget>
                  Message{" "}
                  {selectedLabel.fallback ? (
                    <NodeFallbackId title="No daemon callsign — showing the agent id (client fallback)">
                      id:{selectedLabel.text || "unknown"}
                    </NodeFallbackId>
                  ) : (
                    <strong>{selectedLabel.text}</strong>
                  )}
                  {selectedNode.parentSessionId == null && (
                    <ComposerWarn>
                      {" "}— parent session unknown; cannot address this agent
                    </ComposerWarn>
                  )}
                </ComposerTarget>
                <ComposerRow>
                  <ComposerInput
                    disabled={selectedNode.parentSessionId == null}
                    onChange={(event) => setMessageText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void commitSend();
                      }
                    }}
                    placeholder="agent.message to the selected subagent…"
                    rows={2}
                    value={messageText}
                  />
                  <ComposerSend
                    disabled={sending || !messageText.trim()
                      || selectedNode.parentSessionId == null}
                    onClick={() => { void commitSend(); }}
                    type="button"
                  >
                    {sending ? "Sending…" : "Send"}
                  </ComposerSend>
                </ComposerRow>
                {lastReceipt && (
                  <ReceiptLine title="agent.message receipt, as the daemon reported it">
                    delivery: {lastReceipt.delivery.raw || "(unnamed)"}
                    {" · "}run {lastReceipt.childRunId || "(none)"}
                    {lastReceipt.childRunState != null
                      && ` · run state ${compactJson(lastReceipt.childRunState)}`}
                  </ReceiptLine>
                )}
              </>
            ) : (
              <FleetMutedHint>Select a subagent to message it.</FleetMutedHint>
            )}
          </ComposerBlock>
        </>
      )}
    </FleetSection>
  );
}

const FleetSection = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  padding: 10px 14px;
  overflow-y: auto;
`;

const FleetHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const FleetTitle = styled.span`
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 650;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const FleetHeaderActions = styled.div`
  display: inline-flex;
  gap: 6px;
`;

const FleetHeaderButton = styled.button`
  padding: 2px 8px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: var(--forge-surface);
  font-size: 11px;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

const FleetMutedHint = styled.p`
  margin: 0;
  color: var(--forge-text-muted);
  font-size: 12px;
`;

const FleetErrorLine = styled.p`
  margin: 0;
  color: var(--forge-danger, #d66);
  font-size: 12px;
`;

const RollupRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
`;

const RollupChip = styled.span`
  padding: 2px 7px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--forge-surface);
  font-size: 11px;
  white-space: nowrap;

  &[data-state="failed"] {
    color: var(--forge-danger, #d66);
  }

  &[data-state="live"] {
    color: var(--forge-accent, #6a6);
  }

  &[data-warn="true"] {
    color: var(--forge-warning, #ca4);
    border-style: dashed;
  }
`;

const BoundedBanner = styled.p`
  margin: 0;
  padding: 5px 9px;
  border: 1px dashed var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text-muted);
  background: var(--forge-surface);
  font-size: 11px;
`;

const FleetTree = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const NodeRow = styled.button`
  display: flex;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
  margin-left: var(--fleet-indent, 0px);
  padding: 4px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  text-align: left;
  cursor: pointer;

  &:hover {
    background: var(--forge-surface-hover);
  }

  &[data-selected="true"] {
    border-color: var(--forge-border-strong);
    background: var(--forge-surface);
  }
`;

const NodeStateDot = styled.i`
  flex: none;
  align-self: center;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--forge-text-muted);

  &[data-state="live"] { background: var(--forge-accent, #6a6); }
  &[data-state="waiting"] { background: var(--forge-warning, #ca4); }
  &[data-state="failed"] { background: var(--forge-danger, #d66); }
  &[data-state="done"] { background: var(--forge-text-soft); }
`;

const NodeCallsign = styled.strong`
  flex: none;
  color: var(--forge-text);
  font-size: 12px;
  font-weight: 650;
`;

/* The client fallback label: visibly an agent id, never a daemon identity. */
const NodeFallbackId = styled.code`
  flex: none;
  padding: 0 4px;
  border: 1px dashed var(--forge-border-strong);
  border-radius: 4px;
  color: var(--forge-text-muted);
  font-family: var(--forge-mono, monospace);
  font-size: 11px;
`;

const NodeTask = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--forge-text-soft);
  font-size: 12px;
`;

const NodeState = styled.em`
  flex: none;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-style: normal;

  &[data-state="failed"] { color: var(--forge-danger, #d66); }
  &[data-state="live"] { color: var(--forge-accent, #6a6); }
`;

/* Folded remainder: descendants exist but were not returned — this row is
   what keeps a bounded node from ever reading as a leaf. */
const FoldedRow = styled.div`
  margin-left: var(--fleet-indent, 0px);
  padding: 2px 8px;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-style: italic;
`;

const ComposerBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding-top: 6px;
  border-top: 1px solid var(--forge-border, rgba(128, 128, 128, 0.25));
`;

const ComposerTarget = styled.span`
  color: var(--forge-text-soft);
  font-size: 12px;
`;

const ComposerWarn = styled.em`
  color: var(--forge-warning, #ca4);
  font-size: 11px;
  font-style: normal;
`;

const ComposerRow = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 6px;
`;

const ComposerInput = styled.textarea`
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text);
  background: var(--forge-surface);
  font-size: 12px;
  resize: vertical;

  &:disabled {
    opacity: 0.6;
  }
`;

const ComposerSend = styled.button`
  flex: none;
  padding: 5px 12px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text);
  background: var(--forge-surface);
  font-size: 12px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--forge-surface-hover);
  }

  &:disabled {
    opacity: 0.6;
    cursor: default;
  }
`;

const ReceiptLine = styled.p`
  margin: 0;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-family: var(--forge-mono, monospace);
`;

import { useCallback, useState } from "react";
import styled from "styled-components";

import { cancelEligibility, findFleetNode, nodeLabel } from "./fleetModel.js";

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
   - message and cancel dispatch only through a node's REAL parent session
     id + agent id. A missing parent disables both controls with the same
     honest note;
   - an accepted cancel receipt stays "cancel requested" pending until the
     fleet/descendant authority publishes a terminal node state. */

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

/* Shared by the message composer and per-row Cancel control: neither may
   guess the current surface/session as a missing parent coordinate. */
function nodeAddressing(node) {
  if (node?.parentSessionId == null) {
    return {
      addressable: false,
      reason: "parent session unknown; cannot address this agent",
    };
  }
  if (!node.agentId) {
    return {
      addressable: false,
      reason: "agent id unknown; cannot address this agent",
    };
  }
  return { addressable: true, reason: "" };
}

function CancelFeedback({ cancelReason, cancelState, eligibility }) {
  const receipt = cancelState?.receipt;
  const terminalSeq = receipt?.terminalSeq;
  if (receipt?.status.kind === "accepted") {
    if (eligibility.kind === "terminal") {
      return (
        <NodeCancelNote>
          finished in published state: {eligibility.publishedState}
          {terminalSeq != null && <> · terminal seq {terminalSeq}</>}
        </NodeCancelNote>
      );
    }
    return (
      <NodeCancelNote data-kind="pending">
        cancel requested (pending)
        {terminalSeq != null && <> · terminal seq {terminalSeq}</>}
      </NodeCancelNote>
    );
  }
  if (receipt?.status.kind === "already_terminal") {
    return (
      <NodeCancelNote>
        already finished
        {terminalSeq != null && <> · terminal seq {terminalSeq}</>}
      </NodeCancelNote>
    );
  }
  if (receipt?.status.kind === "unknown") {
    return (
      <NodeCancelNote data-kind="unknown">
        unrecognized cancel status: {receipt.status.raw || "(unnamed)"}
        {terminalSeq != null && <> · terminal seq {terminalSeq}</>}
      </NodeCancelNote>
    );
  }
  if (cancelState?.error) {
    return <NodeCancelError role="alert">Cancel failed: {cancelState.error}</NodeCancelError>;
  }
  if (cancelReason) return <NodeCancelNote>{cancelReason}</NodeCancelNote>;
  return null;
}

function FleetNodeRows({
  cancelByAgent,
  cancelUnavailable,
  node,
  level,
  onCancelAgent,
  selectedAgentId,
  onSelectNode,
}) {
  const label = nodeLabel(node);
  const stateKind = node.state?.kind ?? "unknown";
  const stateLabel = node.state == null
    ? "state not published"
    : node.state.kind === "unknown"
      ? `unrecognized state: ${node.state.label || "(unnamed)"}`
      : node.state.label;
  const eligibility = cancelEligibility(node);
  const addressing = nodeAddressing(node);
  const cancelState = cancelByAgent[node.agentId] || null;
  const commandUnavailableReason = typeof cancelUnavailable === "string"
    ? cancelUnavailable
    : cancelUnavailable
      ? "Cancel unavailable on this daemon."
      : "";
  const callbackUnavailableReason = typeof onCancelAgent === "function"
    ? ""
    : "Cancel unavailable: cancel control is not mounted.";
  const cancelReason = addressing.reason || eligibility.reason
    || commandUnavailableReason || callbackUnavailableReason;
  const requestPending = Boolean(cancelState?.pending) && eligibility.kind !== "terminal";
  const cancelDisabled = Boolean(cancelReason) || requestPending
    || cancelState?.receipt != null;
  return (
    <>
      <NodeLine style={{ "--fleet-indent": `${level * 16}px` }}>
        <NodeRow
          data-bounded={node.bounded ? "true" : undefined}
          data-selected={node.agentId === selectedAgentId ? "true" : undefined}
          data-state={stateKind}
          onClick={() => onSelectNode?.(node)}
          title="Open this subagent's nested transcript"
          type="button"
        >
          <NodeStateDot aria-hidden="true" data-state={stateKind} />
          {label.fallback ? (
            <NodeFallbackId title="No daemon callsign — showing the agent id (client fallback)">
              id:{label.text || "unknown"}
            </NodeFallbackId>
          ) : (
            <NodeCallsign>{label.text}</NodeCallsign>
          )}
          <NodeTask>{node.task}</NodeTask>
          <NodeState data-state={stateKind}>{stateLabel}</NodeState>
        </NodeRow>
        <NodeCancelControl>
          <NodeCancelButton
            disabled={cancelDisabled}
            onClick={() => {
              if (cancelDisabled) return;
              void onCancelAgent(node.parentSessionId, node.agentId);
            }}
            title={requestPending
              ? "Cancel requested; waiting for a terminal fleet publication"
              : cancelReason || "Request cancellation for this published non-terminal agent"}
            type="button"
          >
            {requestPending && cancelState.receipt == null ? "Cancelling…" : "Cancel"}
          </NodeCancelButton>
          <CancelFeedback
            cancelReason={cancelReason}
            cancelState={cancelState}
            eligibility={eligibility}
          />
          {cancelState?.receipt != null && addressing.reason && (
            <NodeCancelNote>{addressing.reason}</NodeCancelNote>
          )}
        </NodeCancelControl>
      </NodeLine>
      {node.children.map((child) => (
        <FleetNodeRows
          cancelByAgent={cancelByAgent}
          cancelUnavailable={cancelUnavailable}
          key={child.agentId || child.sessionId}
          level={level + 1}
          node={child}
          onCancelAgent={onCancelAgent}
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
  cancelByAgent = {},
  cancelUnavailable = "",
  entry = undefined,
  error = "",
  fallbackEntry = undefined,
  loading = false,
  unavailable = false,
  selectedAgentId = "",
  onSelectNode = null,
  onRefresh = null,
  onReconnect = null,
  onObserveAll = null,
  onCancelAgent = null,
  onSendMessage = null,
  streamError = "",
  streamLoading = false,
  streamMode = "unavailable",
  streamRepair = null,
}) {
  const [messageText, setMessageText] = useState("");
  const [sending, setSending] = useState(false);
  const [lastReceipt, setLastReceipt] = useState(null);

  const selectedNode = entry ? findFleetNode(entry.tree, selectedAgentId) : null;
  const selectedLabel = selectedNode ? nodeLabel(selectedNode) : null;
  const selectedAddressing = nodeAddressing(selectedNode);

  const commitSend = useCallback(async () => {
    if (!selectedNode || !selectedAddressing.addressable || !messageText.trim() || sending) return;
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
  }, [messageText, onSendMessage, selectedAddressing.addressable, selectedNode, sending]);

  const isLive = streamMode === "live" && entry != null;

  if (unavailable && !isLive) {
    return (
      <FleetSection aria-label="Subagents">
        <FleetHeader>
          <FleetTitle>Subagents</FleetTitle>
          <StreamBadge data-mode="snapshot">
            {streamMode === "snapshot"
              ? "Point-in-time snapshot — live stream unavailable"
              : "Point-in-time snapshot — live stream not connected"}
          </StreamBadge>
        </FleetHeader>
        {streamError && <FleetErrorLine role="alert">{streamError}</FleetErrorLine>}
        <FleetMutedHint>Subagent fleet is unavailable on this daemon.</FleetMutedHint>
      </FleetSection>
    );
  }

  /* Live baselines do not publish P2 metrics. If a snapshot rollup is
     available beside live data, it stays visibly labeled point-in-time. */
  const rollup = isLive ? fallbackEntry?.rollup || null : entry?.rollup || null;
  const truncation = isLive ? null : entry?.truncation || null;
  const fanout = isLive ? entry?.fanout || null : null;
  const streamTruncation = isLive ? entry?.truncation || null : null;
  const roots = entry?.tree?.roots || [];
  const unknownEvents = isLive && Array.isArray(entry?.tree?.unrecognizedEvents)
    ? entry.tree.unrecognizedEvents
    : [];

  return (
    <FleetSection aria-label="Subagents">
      <FleetHeader>
        <FleetTitle>Subagents</FleetTitle>
        <StreamBadge data-mode={isLive ? "live" : "snapshot"}>
          {isLive
            ? "Live descendant stream"
            : streamLoading
              ? "Connecting live stream — tree below is a point-in-time snapshot"
              : streamMode === "snapshot"
                ? "Point-in-time snapshot — live stream unavailable"
                : "Point-in-time snapshot — live stream not connected"}
        </StreamBadge>
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
            disabled={streamLoading}
            onClick={() => onReconnect?.()}
            title={isLive
              ? "Detach and reconnect the live descendant stream from held per-child cursors"
              : "Try to attach the live descendant stream"}
            type="button"
          >
            {streamLoading ? "Connecting…" : isLive ? "Reconnect live" : "Retry live"}
          </FleetHeaderButton>
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

      {streamError && <FleetErrorLine role="alert">{streamError}</FleetErrorLine>}
      {error && <FleetErrorLine role="alert">{error}</FleetErrorLine>}

      {isLive && fanout && (
        <LiveNotice data-warn={fanout.limited ? "true" : undefined}>
          Fan-out: requested children {fanout.requestedChildren ?? "unknown"}; accepted children{" "}
          {fanout.acceptedChildren ?? "unknown"}; hard limit {fanout.hardLimit ?? "unknown"}.
          {fanout.limited && (
            <> Accepted is below requested; some requested children were not streamed.</>
          )}
        </LiveNotice>
      )}

      {isLive && streamTruncation && (
        <LiveNotice data-warn={streamTruncation.truncated ? "true" : undefined}>
          {streamTruncation.truncated === true ? (
            streamTruncation.omittedCountTrusted ? (
              <>Truncation: truncated — streamed children {streamTruncation.streamedChildren ?? "unknown"}; omitted children {streamTruncation.omittedChildren ?? "unknown"}.</>
            ) : (
              <>Truncation: truncated — streamed children {streamTruncation.streamedChildren ?? "unknown"}; omitted total unknown (count incomplete, so it is not a trustworthy total).</>
            )
          ) : streamTruncation.truncated === false ? (
            <>Truncation: not truncated — streamed children {streamTruncation.streamedChildren ?? "unknown"}.</>
          ) : (
            <>Truncation status not published — streamed children {streamTruncation.streamedChildren ?? "unknown"}.</>
          )}
        </LiveNotice>
      )}

      {streamRepair && (
        <RepairNotice>
          Repair reattached after a reported gap using this client&apos;s held per-child cursors.
          The repair frame made no sequence claim. Resumed {streamRepair.resumedChildren} of{" "}
          {streamRepair.namedChildren.length} named children; any child without a held cursor remains an explicit gap.
        </RepairNotice>
      )}

      {unknownEvents.slice(-3).map((fact, index) => (
        <LiveNotice key={`${fact.sessionId}:${fact.agentId}:${fact.seq ?? index}`} data-warn="true">
          Unrecognized live change preserved: {fact.kindRaw ?? "unnamed kind"}.
        </LiveNotice>
      ))}

      {!entry && !error && (
        <FleetMutedHint>
          {loading ? "Reading the fleet snapshot…" : "Fleet not read."}
        </FleetMutedHint>
      )}

      {entry && (
        <>
          {rollup && (
            <RollupRow aria-label="Fleet rollup">
              {isLive && (
                <RollupChip data-warn="true" title="These totals came from the separate fallback snapshot, not the live stream">
                  point-in-time snapshot rollup
                </RollupChip>
              )}
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
                  cancelByAgent={cancelByAgent}
                  cancelUnavailable={cancelUnavailable}
                  key={node.agentId || node.sessionId}
                  level={0}
                  node={node}
                  onCancelAgent={onCancelAgent}
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
                  {!selectedAddressing.addressable && (
                    <ComposerWarn>
                      {" "}— {selectedAddressing.reason}
                    </ComposerWarn>
                  )}
                </ComposerTarget>
                <ComposerRow>
                  <ComposerInput
                    disabled={!selectedAddressing.addressable}
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
                      || !selectedAddressing.addressable}
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

const StreamBadge = styled.span`
  padding: 2px 7px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: var(--forge-surface);
  font-size: 10px;
  white-space: nowrap;

  &[data-mode="live"] {
    color: var(--forge-accent, #6a6);
  }
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

const LiveNotice = styled.p`
  margin: 0;
  padding: 5px 9px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text-muted);
  background: var(--forge-surface);
  font-size: 11px;

  &[data-warn="true"] {
    color: var(--forge-warning, #ca4);
    border-style: dashed;
  }
`;

const RepairNotice = styled(LiveNotice)`
  color: var(--forge-warning, #ca4);
  border-style: dashed;
`;

const FleetTree = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const NodeLine = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 7px;
  min-width: 0;
  margin-left: var(--fleet-indent, 0px);
`;

const NodeRow = styled.button`
  display: flex;
  flex: 1;
  align-items: baseline;
  gap: 7px;
  min-width: 0;
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

const NodeCancelControl = styled.span`
  display: flex;
  flex: 0 1 260px;
  min-width: 84px;
  align-items: flex-end;
  flex-direction: column;
  gap: 2px;
`;

const NodeCancelButton = styled.button`
  flex: none;
  padding: 3px 8px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-danger, #d66);
  background: var(--forge-surface);
  font-size: 10.5px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: var(--forge-surface-hover);
  }

  &:disabled {
    color: var(--forge-text-muted);
    opacity: 0.65;
    cursor: default;
  }
`;

const NodeCancelNote = styled.small`
  color: var(--forge-text-muted);
  font-size: 10px;
  line-height: 1.2;
  text-align: right;

  &[data-kind="pending"] { color: var(--forge-warning, #ca4); }
  &[data-kind="unknown"] { font-style: italic; }
`;

const NodeCancelError = styled(NodeCancelNote)`
  color: var(--forge-danger, #d66);
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

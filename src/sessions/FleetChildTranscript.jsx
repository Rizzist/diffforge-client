import styled from "styled-components";

import SessionTranscript from "./SessionTranscript.jsx";
import { nodeLabel } from "./fleetModel.js";

/* Drilldown for one selected fleet child (P2). PRESENTATIONAL ONLY — every
   dispatch rides useFleet callbacks. The nested transcript is
   AUTHORITATIVE: it is the child
   session's own projection feed, mounted through the shared
   SessionTranscript keyed by the child's REAL session id — never
   reconstructed from the parent's rows, and never given a fabricated title
   (the header shows the daemon callsign or a visibly-marked agent-id
   fallback). Lineage renders only the real ids the fleet published:
   an absent parent is "unknown", never a guess. The session.observe digest
   is offered verbatim (opaque daemon authority) as the read-only observed
   record beside the live feed. */

function digestText(digest) {
  try {
    return JSON.stringify(digest, null, 2);
  } catch {
    return String(digest);
  }
}

export default function FleetChildTranscript({
  node = null,
  digest = undefined,
  onObserve = null,
}) {
  if (!node) return null;
  const label = nodeLabel(node);
  return (
    <ChildWrap aria-label="Subagent transcript">
      <LineageBar>
        {label.fallback ? (
          <FallbackId title="No daemon callsign — showing the agent id (client fallback)">
            id:{label.text || "unknown"}
          </FallbackId>
        ) : (
          <Callsign>{label.text}</Callsign>
        )}
        <LineageFact title="This child's own session — the transcript below is its feed">
          session {node.sessionId || "unknown"}
        </LineageFact>
        <LineageFact title="Parent session id as the fleet published it">
          under parent {node.parentSessionId ?? "unknown"}
        </LineageFact>
        {node.parentAgentId != null && (
          <LineageFact title="Parent agent id as the fleet published it">
            via agent {node.parentAgentId}
          </LineageFact>
        )}
        <LineageState data-state={node.state.kind}>{node.state.label}</LineageState>
      </LineageBar>

      <TranscriptHost>
        {/* The child session's own projection feed — the authority. */}
        <SessionTranscript session={{ id: node.sessionId }} />
      </TranscriptHost>

      <DigestBlock>
        <summary>
          Observe digest (session.observe — verbatim)
          <DigestRefresh
            onClick={(event) => {
              event.preventDefault();
              onObserve?.();
            }}
            title="Re-read the observation digest for this child session"
            type="button"
          >
            {digest === undefined ? "Observe" : "Re-observe"}
          </DigestRefresh>
        </summary>
        {digest === undefined ? (
          <DigestHint>Not observed yet.</DigestHint>
        ) : (
          <DigestPre>{digestText(digest)}</DigestPre>
        )}
      </DigestBlock>
    </ChildWrap>
  );
}

const ChildWrap = styled.section`
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  border-top: 1px solid var(--forge-border, rgba(128, 128, 128, 0.25));
`;

const LineageBar = styled.div`
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 6px 14px;
`;

const Callsign = styled.strong`
  color: var(--forge-text);
  font-size: 12px;
  font-weight: 650;
`;

const FallbackId = styled.code`
  padding: 0 4px;
  border: 1px dashed var(--forge-border-strong);
  border-radius: 4px;
  color: var(--forge-text-muted);
  font-family: var(--forge-mono, monospace);
  font-size: 11px;
`;

const LineageFact = styled.em`
  color: var(--forge-text-muted);
  font-size: 11px;
  font-style: normal;
  font-family: var(--forge-mono, monospace);
`;

const LineageState = styled.span`
  color: var(--forge-text-muted);
  font-size: 11px;

  &[data-state="failed"] { color: var(--forge-danger, #d66); }
  &[data-state="live"] { color: var(--forge-accent, #6a6); }
`;

const TranscriptHost = styled.div`
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
`;

const DigestBlock = styled.details`
  flex: none;
  padding: 4px 14px 8px;
  border-top: 1px solid var(--forge-border, rgba(128, 128, 128, 0.25));

  > summary {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--forge-text-muted);
    font-size: 11px;
    cursor: pointer;
    user-select: none;
  }
`;

const DigestRefresh = styled.button`
  padding: 1px 7px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: var(--forge-surface);
  font-size: 10px;
  cursor: pointer;

  &:hover {
    background: var(--forge-surface-hover);
  }
`;

const DigestHint = styled.p`
  margin: 4px 0 0;
  color: var(--forge-text-muted);
  font-size: 11px;
`;

const DigestPre = styled.pre`
  max-height: 180px;
  margin: 4px 0 0;
  padding: 8px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  overflow: auto;
  color: var(--forge-text-soft);
  background: var(--forge-surface);
  font-size: 10.5px;
  line-height: 1.4;
`;

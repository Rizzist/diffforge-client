import styled from "styled-components";

import { sessionActivityVisualState } from "./sessionActivity.js";
import { surfaceStatusPillTone } from "./surfaceStatusPillTone.js";
import { ModelBrandIcon } from "./modelBrand.jsx";

/* The work-header status pill. It leads with the session's model/provider
   brand mark (the SAME mark the rail shows, via ModelBrandIcon) and carries
   the harness status line beside it. The pill's ring/text tone is a truthful
   read of the session's real state (see surfaceStatusPillTone) — never a
   manufactured "good"; availability degradation outranks the run bucket. */
export function SurfaceStatusPill({ session, statusPillView, availability, statusLine }) {
  const view = statusPillView || {};
  const tone = surfaceStatusPillTone(session, view, availability);
  return (
    <StatusPill
      data-session-availability={availability?.reason}
      data-status={view.status}
      data-status-authority={view.authority}
      data-status-source={view.source}
      data-status-tone={tone || undefined}
      data-structured-status={view.structuredStatus}
      title={view.title}
    >
      <ModelBrandIcon
        model={session?.model}
        provider={session?.provider}
        status={sessionActivityVisualState(session)}
      />
      <span>{availability?.label || statusLine}</span>
    </StatusPill>
  );
}

const StatusPill = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.01em;

  /* The harness line stays byte-exact; a floating pill just can't grow
     without bound, so extreme lines clip visually (full text on hover). */
  > span {
    max-width: 300px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  /* Connected and healthy: the reference's green "Idle" ring. The brand mark
     keeps its own colour; only the ring/label take the tone. */
  &[data-status-tone="good"] {
    border-color: rgba(var(--forge-green-rgb), 0.3);
    color: var(--forge-good-text);
    background: rgba(var(--forge-green-rgb), 0.1);
  }

  &[data-status-tone="warn"] {
    border-color: rgba(var(--forge-amber-rgb), 0.34);
    color: var(--forge-amber);
    background: rgba(var(--forge-amber-rgb), 0.12);
  }

  &[data-status-tone="bad"] {
    border-color: rgba(var(--forge-red-rgb), 0.34);
    color: var(--forge-red);
    background: rgba(var(--forge-red-rgb), 0.12);
  }
`;

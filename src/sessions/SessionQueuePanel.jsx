import { useState } from "react";
import styled from "styled-components";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { MoreHoriz } from "@styled-icons/material-rounded/MoreHoriz";

import { queuePresentation } from "./queueViewModel.js";

function modeLabel(mode) {
  if (mode === "steer") return "Steer";
  if (mode === "subturn") return "Subturn";
  return "Queue";
}

function createdLabel(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unknown" : date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/* The persistent portion of this panel is only a projection of queue.list +
   QueueChanged. `confirmation` is deliberately separate: it is short-lived
   evidence about this client's own successful submit and remains useful on
   older daemons that do not advertise queue_control_v1. */
export default function SessionQueuePanel({
  state,
  confirmation = null,
  actionBusy = "",
  actionError = "",
  onPromoteSteer = null,
  onRemove = null,
  onRefresh = null,
}) {
  const [detailsFor, setDetailsFor] = useState("");
  const presentation = queuePresentation(state);
  if (!confirmation && !presentation.renderQueue) return null;

  return (
    <QueuePanelRoot data-queue-state={presentation.kind}>
      {confirmation && (
        <OwnSubmission role="status">
          <QueueText>{confirmation.text}</QueueText>
          <QueueMeta>
            <DispositionBadge data-disposition={confirmation.disposition}>
              {confirmation.label}
            </DispositionBadge>
            <span>{confirmation.detail}</span>
          </QueueMeta>
        </OwnSubmission>
      )}

      {presentation.kind === "unknown" && (
        <QueueAvailability role="status">
          <span>Queue unavailable · {presentation.reason}</span>
          {onRefresh && <button onClick={onRefresh} type="button">Retry</button>}
        </QueueAvailability>
      )}

      {presentation.kind === "empty" && (
        <QueueAvailability data-empty="true" role="status">
          Queue empty
        </QueueAvailability>
      )}

      {presentation.kind === "rows" && (
        <AuthoritativeQueue aria-label="Held messages">
          <QueueHeading>
            <span>Queued</span>
            <em>{presentation.rows.length}</em>
          </QueueHeading>
          {presentation.rows.map((row) => {
            const promoteBusy = actionBusy === `promoteSteer:${row.id}`;
            const removeBusy = actionBusy === `remove:${row.id}`;
            return (
              <QueueRow key={row.id}>
                {/* Render-complete law: this is the daemon's row.text itself,
                    with CSS preserving whitespace. */}
                <QueueText>{row.text}</QueueText>
                <QueueActions>
                  <SteerButton
                    disabled={Boolean(actionBusy)}
                    onClick={() => onPromoteSteer?.(row.id)}
                    type="button"
                  >
                    {promoteBusy ? "Steering…" : "Steer"}
                  </SteerButton>
                  <QueueIconButton
                    aria-label="Delete queued message"
                    disabled={Boolean(actionBusy)}
                    onClick={() => onRemove?.(row.id)}
                    title="Delete queued message"
                    type="button"
                  >
                    {removeBusy ? "…" : <Delete aria-hidden="true" />}
                  </QueueIconButton>
                  <QueueIconButton
                    aria-expanded={detailsFor === row.id}
                    aria-label="Queued message details"
                    onClick={() => setDetailsFor((current) => (
                      current === row.id ? "" : row.id
                    ))}
                    title="Queued message details"
                    type="button"
                  >
                    <MoreHoriz aria-hidden="true" />
                  </QueueIconButton>
                </QueueActions>
                {detailsFor === row.id && (
                  <QueueDetails>
                    #{row.ordinal} · {modeLabel(row.mode)} · {createdLabel(row.created_at_ms)}
                  </QueueDetails>
                )}
              </QueueRow>
            );
          })}
        </AuthoritativeQueue>
      )}

      {actionError && <QueueActionError role="alert">{actionError}</QueueActionError>}
    </QueuePanelRoot>
  );
}

const QueuePanelRoot = styled.div`
  width: min(48.5rem, calc(100% - 2 * clamp(20px, 7%, 64px)));
  flex: 0 0 auto;
  margin: 6px auto 0;
`;

const OwnSubmission = styled.div`
  display: grid;
  gap: 5px;
  padding: 8px 11px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.32);
  border-radius: 12px;
  color: var(--forge-text-soft);
  background: rgba(var(--forge-tint-rgb), 0.08);
`;

const QueueText = styled.div`
  overflow-wrap: anywhere;
  color: var(--forge-text);
  font-size: 11.5px;
  line-height: 1.4;
  white-space: pre-wrap;
`;

const QueueMeta = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  color: var(--forge-text-muted);
  font-size: 9.5px;
`;

const DispositionBadge = styled.strong`
  flex: 0 0 auto;
  padding: 2px 6px;
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: var(--forge-surface-control);
  font-size: 9px;

  &[data-disposition="queued"],
  &[data-disposition="steer_pending"],
  &[data-disposition="subturn_pending"] {
    color: var(--forge-amber);
  }

  &[data-disposition="started"] {
    color: var(--forge-green);
  }
`;

const QueueAvailability = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border: 1px dashed var(--forge-border);
  border-radius: 10px;
  color: var(--forge-amber);
  font-size: 10.5px;

  &[data-empty="true"] {
    color: var(--forge-text-muted);
  }

  button {
    padding: 2px 7px;
    border: 0;
    border-radius: 999px;
    color: var(--forge-text-soft);
    background: var(--forge-surface-control);
    cursor: pointer;
    font: inherit;
  }
`;

const AuthoritativeQueue = styled.div`
  display: grid;
  gap: 5px;
`;

const QueueHeading = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  color: var(--forge-text-muted);
  font-size: 9px;
  font-weight: 760;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  em {
    display: grid;
    min-width: 15px;
    height: 15px;
    place-items: center;
    border-radius: 999px;
    background: var(--forge-surface-control);
    font-size: 8px;
    font-style: normal;
  }
`;

const QueueRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px 10px;
  padding: 7px 8px 7px 11px;
  border: 1px solid var(--forge-border);
  border-radius: 12px;
  background: var(--forge-surface-control);
`;

const QueueActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 3px;
`;

const SteerButton = styled.button`
  padding: 4px 9px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.38);
  border-radius: 999px;
  color: var(--forge-text-soft);
  background: rgba(var(--forge-tint-rgb), 0.12);
  cursor: pointer;
  font-size: 9.5px;
  font-weight: 720;

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`;

const QueueIconButton = styled.button`
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: var(--forge-text-muted);
  background: transparent;
  cursor: pointer;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover:not(:disabled) {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`;

const QueueDetails = styled.div`
  grid-column: 1 / -1;
  color: var(--forge-text-muted);
  font-size: 9.5px;
`;

const QueueActionError = styled.p`
  margin: 5px 3px 0;
  color: var(--forge-amber);
  font-size: 10.5px;
`;

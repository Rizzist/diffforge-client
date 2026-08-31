import { useCallback } from "react";
import styled from "styled-components";
import { Edit } from "@styled-icons/material-rounded/Edit";
import { Memory } from "@styled-icons/material-rounded/Memory";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";
import { Replay } from "@styled-icons/material-rounded/Replay";

import { retryEligibility } from "./lifecycleModel.js";

function firstError(errors) {
  return Object.values(errors || {}).find(Boolean) || "";
}

/* Presentational lifecycle menu shared by the rail row and session header.
   It owns no daemon state and performs no IPC: callbacks come from
   useSessionLifecycle. The only post-fork navigation coordinate is the new
   session id returned by forkReceiptView. */
export default function SessionLifecycleMenuItems({
  errorBySession = {},
  onBeginRename = null,
  onCompact = null,
  onDismiss = null,
  onFork = null,
  onForked = null,
  onRetry = null,
  pendingBySession = {},
  session,
  unavailableByAction = {},
}) {
  const pending = pendingBySession[session?.id] || {};
  const errors = errorBySession[session?.id] || {};
  const busy = Object.values(pending).some(Boolean);
  const retry = retryEligibility(session);

  const run = useCallback(async (action, callback) => {
    const receipt = await callback?.();
    if (action === "fork" && receipt?.sessionId !== undefined) {
      onForked?.(receipt);
    }
    /* Keep a rejected/unavailable action open so its honest reason replaces
       the pending label in place. A receipt may close the menu; fork
       navigation still uses only the receipt-backed new session id. */
    if (receipt != null) onDismiss?.();
  }, [onDismiss, onForked]);

  const callbackByAction = {
    rename: onBeginRename,
    compact: onCompact,
    fork: onFork,
    retry: onRetry,
  };
  const unavailableReason = (action) => unavailableByAction[action]
    || (typeof callbackByAction[action] === "function"
      ? ""
      : `${action[0].toUpperCase()}${action.slice(1)} unavailable: lifecycle control is not mounted.`);
  const renameDisabled = busy || Boolean(unavailableReason("rename"));
  const compactDisabled = busy || Boolean(unavailableReason("compact"));
  const forkDisabled = busy || Boolean(unavailableReason("fork"));
  const retryReason = unavailableReason("retry") || retry.reason;
  const retryDisabled = busy || Boolean(unavailableReason("retry")) || !retry.eligible;
  const error = firstError(errors);

  return (
    <>
      <LifecycleMenuItem
        disabled={renameDisabled}
        onClick={() => {
          if (renameDisabled) return;
          onDismiss?.();
          onBeginRename?.(session);
        }}
        title={unavailableReason("rename") || "Rename this session"}
        role="menuitem"
        type="button"
      >
        <Edit aria-hidden="true" />
        <LifecycleActionCopy>
          <span>{pending.rename ? "Renaming…" : unavailableReason("rename") ? "Rename unavailable" : "Rename"}</span>
          {unavailableReason("rename") && <small>{unavailableReason("rename")}</small>}
        </LifecycleActionCopy>
      </LifecycleMenuItem>
      <LifecycleMenuItem
        disabled={compactDisabled}
        onClick={() => void run("compact", () => onCompact?.(session.id))}
        title={unavailableReason("compact") || "Compact this session context"}
        role="menuitem"
        type="button"
      >
        <Memory aria-hidden="true" />
        <LifecycleActionCopy>
          <span>{pending.compact ? "Compacting…" : unavailableReason("compact") ? "Compact unavailable" : "Compact context"}</span>
          {unavailableReason("compact") && <small>{unavailableReason("compact")}</small>}
        </LifecycleActionCopy>
      </LifecycleMenuItem>
      <LifecycleMenuItem
        disabled={forkDisabled}
        onClick={() => void run("fork", () => onFork?.(session.id))}
        title={unavailableReason("fork") || "Fork this session from daemon authority"}
        role="menuitem"
        type="button"
      >
        <OpenInNew aria-hidden="true" />
        <LifecycleActionCopy>
          <span>{pending.fork ? "Forking…" : unavailableReason("fork") ? "Fork unavailable" : "Fork session"}</span>
          {unavailableReason("fork") && <small>{unavailableReason("fork")}</small>}
        </LifecycleActionCopy>
      </LifecycleMenuItem>
      <LifecycleMenuItem
        disabled={retryDisabled}
        onClick={() => void run("retry", () => onRetry?.(session))}
        title={retryReason || "Retry the failed run published by the daemon"}
        role="menuitem"
        type="button"
      >
        <Replay aria-hidden="true" />
        <LifecycleActionCopy>
          <span>{pending.retry ? "Retrying…" : retryDisabled ? "Retry unavailable" : "Retry failed run"}</span>
          {retryDisabled && !pending.retry && <small>{retryReason}</small>}
        </LifecycleActionCopy>
      </LifecycleMenuItem>
      {error && <LifecycleError role="alert">Lifecycle action failed: {error}</LifecycleError>}
    </>
  );
}

export const LifecycleMenuItem = styled.button`
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 11.5px;
  font-weight: 550;
  cursor: pointer;
  text-align: left;

  > svg {
    flex: 0 0 auto;
    width: 13px;
    height: 13px;
    margin-top: 1px;
    opacity: 0.8;
  }

  &:hover:not(:disabled) {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }

  &:disabled {
    color: var(--forge-text-muted);
    cursor: default;
    opacity: 0.72;
  }
`;

const LifecycleActionCopy = styled.span`
  display: grid;
  min-width: 0;
  gap: 2px;

  > small {
    max-width: 250px;
    color: var(--forge-text-muted);
    font-size: 9px;
    font-weight: 450;
    line-height: 1.25;
    white-space: normal;
  }
`;

const LifecycleError = styled.div`
  max-width: 260px;
  padding: 5px 8px;
  color: var(--forge-red);
  font-size: 9.5px;
  line-height: 1.3;
`;

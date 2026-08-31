import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  forkReceiptView,
  lifecycleUnavailableFromError,
  renameArgs,
  retryEligibility,
} from "./lifecycleModel.js";

const ACTION_LABELS = Object.freeze({
  rename: "Rename",
  compact: "Compact",
  fork: "Fork",
  retry: "Retry",
});

function nestedActionState(current, sessionId, action, value) {
  const previous = current[sessionId] || {};
  const nextForSession = { ...previous, [action]: value };
  if (value === false || value === "") delete nextForSession[action];
  if (Object.keys(nextForSession).length === 0) {
    const next = { ...current };
    delete next[sessionId];
    return next;
  }
  return { ...current, [sessionId]: nextForSession };
}

/* Single reconcile point for session lifecycle IPC. No callback edits the
   session roster/title/run state: pending is the only pre-receipt UI fact,
   and every accepted receipt is followed by the injected authority refresh.
   Feature gates settle once per action so one unavailable command cannot
   spam the daemon or falsely disable independently supported actions. */
export function useSessionLifecycle({ enabled = true, refreshAuthority = null } = {}) {
  const [pendingBySession, setPendingBySession] = useState({});
  const [errorBySession, setErrorBySession] = useState({});
  const [unavailableByAction, setUnavailableByAction] = useState({});
  const unavailableRef = useRef({});

  const markPending = useCallback((sessionId, action, value) => {
    setPendingBySession((current) => nestedActionState(current, sessionId, action, value));
  }, []);

  const setActionError = useCallback((sessionId, action, value) => {
    setErrorBySession((current) => nestedActionState(current, sessionId, action, value));
  }, []);

  const settleError = useCallback((action, sessionId, thrown, fallback) => {
    const message = String(thrown?.message ?? thrown ?? fallback);
    if (lifecycleUnavailableFromError(thrown)) {
      unavailableRef.current[action] = true;
      const reason = `${ACTION_LABELS[action]} unavailable on this daemon: ${message}`;
      setUnavailableByAction((current) => ({ ...current, [action]: reason }));
      setActionError(sessionId, action, "");
      return;
    }
    setActionError(sessionId, action, message);
  }, [setActionError]);

  const runLifecycle = useCallback(async (
    action,
    sessionId,
    dispatch,
    receiptView = (receipt) => receipt,
  ) => {
    if (!enabled || !sessionId || unavailableRef.current[action]) return null;
    markPending(sessionId, action, true);
    setActionError(sessionId, action, "");
    try {
      let receipt;
      try {
        receipt = await dispatch();
      } catch (thrown) {
        settleError(action, sessionId, thrown,
          `Unable to ${action} the session.`);
        return null;
      }
      const view = receiptView(receipt);
      try {
        await refreshAuthority?.();
      } catch (thrown) {
        setActionError(
          sessionId,
          action,
          `${ACTION_LABELS[action]} was accepted, but the authoritative session refresh failed: ${String(thrown?.message ?? thrown)}`,
        );
      }
      return view;
    } finally {
      markPending(sessionId, action, false);
    }
  }, [enabled, markPending, refreshAuthority, setActionError, settleError]);

  const rename = useCallback((sessionId, title) => runLifecycle(
    "rename",
    sessionId,
    // `ade_` avoids collisions with the pre-existing local-roster commands; the
    // daemon, not the local sessions row, owns session titles.
    () => invoke("ade_session_rename", {
      session_id: sessionId,
      ...renameArgs(title),
    }),
  ), [runLifecycle]);

  const compact = useCallback((sessionId, branchId) => runLifecycle(
    "compact",
    sessionId,
    () => invoke("session_compact", {
      session_id: sessionId,
      ...(branchId ? { branch_id: branchId } : {}),
    }),
  ), [runLifecycle]);

  const fork = useCallback((sessionId, sourceBranchId, forkNodeId) => runLifecycle(
    "fork",
    sessionId,
    () => invoke("session_fork", {
      session_id: sessionId,
      ...(sourceBranchId ? { source_branch_id: sourceBranchId } : {}),
      ...(forkNodeId ? { fork_node_id: forkNodeId } : {}),
    }),
    forkReceiptView,
  ), [runLifecycle]);

  const retry = useCallback((session) => {
    if (!retryEligibility(session).eligible) return Promise.resolve(null);
    return runLifecycle(
      "retry",
      session.id,
      () => invoke("run_retry", { session_id: session.id }),
    );
  }, [runLifecycle]);

  return {
    pendingBySession,
    errorBySession,
    unavailableByAction,
    rename,
    compact,
    fork,
    retry,
  };
}

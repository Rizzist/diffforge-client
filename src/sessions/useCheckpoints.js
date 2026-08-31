import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  checkpointUnavailableFromError,
  conflictView,
  decimalStringOrNull,
  listPageView,
  mutationReceiptView,
  sortCheckpointsNewestFirst,
} from "./checkpointModel.js";

/* Single command-name reconcile point for the checkpoint SDK. All four
   invokes live here; the panel receives view state and callbacks only. */

const PAGE_LIMIT = 50;

function sessionValue(current, sessionId, value) {
  const next = { ...current };
  if (value == null || value === false || value === "") delete next[sessionId];
  else next[sessionId] = value;
  return next;
}

function branchArgs(branchId) {
  return typeof branchId === "string" && branchId.length > 0
    ? { branch_id: branchId }
    : {};
}

function mergeCheckpointViews(previous, incoming) {
  const rows = [...(previous || []), ...(incoming || [])];
  const checkpointIds = new Set();
  return sortCheckpointsNewestFirst(rows.filter((checkpoint) => {
    if (checkpoint.checkpointId == null) return true;
    if (checkpointIds.has(checkpoint.checkpointId)) return false;
    checkpointIds.add(checkpoint.checkpointId);
    return true;
  }));
}

export function useCheckpoints({ enabled = true } = {}) {
  /* sessionId -> accumulated, authority-listed page view. Missing means
     UNREAD; an entry with checkpoints:[] means the daemon returned empty. */
  const [bySession, setBySession] = useState({});
  const bySessionRef = useRef({});
  const [loadingBySession, setLoadingBySession] = useState({});
  const [pendingBySession, setPendingBySession] = useState({});
  const [errorBySession, setErrorBySession] = useState({});
  const [conflictBySession, setConflictBySession] = useState({});
  const [receiptBySession, setReceiptBySession] = useState({});
  const [unavailable, setUnavailable] = useState(false);
  const unavailableRef = useRef(false);

  const commitBySession = useCallback((sessionId, updater) => {
    setBySession((current) => {
      const value = updater(current[sessionId]);
      const next = { ...current, [sessionId]: value };
      bySessionRef.current = next;
      return next;
    });
  }, []);

  const markUnavailable = useCallback(() => {
    unavailableRef.current = true;
    setUnavailable(true);
  }, []);

  const settleError = useCallback((sessionId, thrown, fallback) => {
    if (checkpointUnavailableFromError(thrown)) {
      markUnavailable();
      setErrorBySession((current) => sessionValue(current, sessionId, ""));
      return "unavailable";
    }
    const conflict = conflictView(thrown);
    if (conflict) {
      setConflictBySession((current) => sessionValue(current, sessionId, conflict));
      setErrorBySession((current) => sessionValue(current, sessionId, ""));
      return "conflict";
    }
    const message = String(thrown?.message ?? thrown ?? fallback);
    setErrorBySession((current) => sessionValue(current, sessionId, message));
    return "error";
  }, [markUnavailable]);

  const list = useCallback(async (
    sessionId,
    branchId = null,
    cursor = null,
    append = false,
  ) => {
    if (!enabled || !sessionId || unavailableRef.current) return null;
    const hasCursor = cursor != null;
    const position = hasCursor ? decimalStringOrNull(cursor) : null;
    /* A numeric/malformed cursor never reaches the boundary; it may already
       have lost precision and must not be recast as a daemon position. */
    if (hasCursor && position == null) return null;
    setLoadingBySession((current) => sessionValue(current, sessionId, true));
    setErrorBySession((current) => sessionValue(current, sessionId, ""));
    try {
      const payload = {
        session_id: sessionId,
        ...branchArgs(branchId),
        ...(position == null ? {} : { cursor: position }),
        limit: PAGE_LIMIT,
      };
      const page = listPageView(await invoke("checkpoint_list", payload));
      commitBySession(sessionId, (previous) => {
        const checkpoints = append
          ? mergeCheckpointViews(previous?.checkpoints, page.checkpoints)
          : page.checkpoints;
        return {
          ...page,
          branchId: typeof branchId === "string" && branchId.length > 0
            ? branchId
            : null,
          checkpoints,
          empty: checkpoints.length === 0,
          loaded: true,
        };
      });
      /* A successful explicit re-read is how the operator dismisses a
         conflict after inspecting the moved workspace. */
      setConflictBySession((current) => sessionValue(current, sessionId, null));
      return page;
    } catch (thrown) {
      settleError(sessionId, thrown, "Unable to read the checkpoint timeline.");
      return null;
    } finally {
      setLoadingBySession((current) => sessionValue(current, sessionId, false));
    }
  }, [commitBySession, enabled, settleError]);

  const loadMore = useCallback((sessionId, branchId = null) => {
    const entry = bySessionRef.current[sessionId];
    if (!entry || entry.endOfList || entry.cursorState !== "more") {
      return Promise.resolve(null);
    }
    /* nextCursor is the validated DECIMAL STRING returned by listPageView;
       list sends this exact string under the SDK's cursor key. */
    return list(sessionId, branchId, entry.nextCursor, true);
  }, [list]);

  const runMutation = useCallback(async (
    action,
    sessionId,
    branchId,
    dispatch,
    coordinate,
  ) => {
    if (!enabled || !sessionId || unavailableRef.current) return null;
    setPendingBySession((current) => sessionValue(current, sessionId, {
      action,
      coordinate,
    }));
    setErrorBySession((current) => sessionValue(current, sessionId, ""));
    setConflictBySession((current) => sessionValue(current, sessionId, null));
    setReceiptBySession((current) => sessionValue(current, sessionId, null));
    try {
      let rawReceipt;
      try {
        rawReceipt = await dispatch();
      } catch (thrown) {
        settleError(sessionId, thrown, `Unable to ${action} the checkpoint.`);
        return null;
      }
      /* Some SDK transports resolve typed outcomes instead of throwing
         them. A conflict is still terminal for this gesture: show it and
         never retry with the workspace's current digest. */
      const conflict = conflictView(rawReceipt);
      if (conflict) {
        setConflictBySession((current) => sessionValue(current, sessionId, conflict));
        return null;
      }
      const receipt = mutationReceiptView(rawReceipt);
      setReceiptBySession((current) => sessionValue(current, sessionId, receipt));
      /* No optimistic timeline edit. Only after the daemon receipt do we
         replace the list from checkpoint_list authority. */
      await list(sessionId, branchId);
      return receipt;
    } finally {
      setPendingBySession((current) => sessionValue(current, sessionId, null));
    }
  }, [enabled, list, settleError]);

  const undo = useCallback((sessionId, branchId, target) => {
    if (typeof target !== "string" || target.length === 0) return Promise.resolve(null);
    return runMutation(
      "undo",
      sessionId,
      branchId,
      () => invoke("checkpoint_undo", {
        session_id: sessionId,
        ...branchArgs(branchId),
        target,
      }),
      target,
    );
  }, [runMutation]);

  const redo = useCallback((sessionId, branchId, target) => {
    if (typeof target !== "string" || target.length === 0) return Promise.resolve(null);
    return runMutation(
      "redo",
      sessionId,
      branchId,
      () => invoke("checkpoint_redo", {
        session_id: sessionId,
        ...branchArgs(branchId),
        target,
      }),
      target,
    );
  }, [runMutation]);

  const rollbackTurn = useCallback((sessionId, branchId, runId) => {
    if (typeof runId !== "string" || runId.length === 0) return Promise.resolve(null);
    return runMutation(
      "rollback this turn",
      sessionId,
      branchId,
      () => invoke("checkpoint_rollback_turn", {
        session_id: sessionId,
        ...branchArgs(branchId),
        run_id: runId,
      }),
      runId,
    );
  }, [runMutation]);

  return {
    bySession,
    loadingBySession,
    pendingBySession,
    errorBySession,
    conflictBySession,
    receiptBySession,
    unavailable,
    list,
    loadMore,
    undo,
    redo,
    rollbackTurn,
  };
}

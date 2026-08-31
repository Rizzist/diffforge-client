import { useCallback, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  cancelReceiptView,
  fleetTreeView,
  fleetUnavailableFromError,
  messageReceiptView,
  rollupView,
  truncationView,
} from "./fleetModel.js";

/* React seam for the subagent fleet surface (P2). EVERY invoke() for the
   five fleet commands — session_fleet, session_observe,
   session_observe_batch, agent_message, agent_cancel — lives in this file: the single
   reconcile point if the SDK's arg names drift. The hook carries daemon
   facts through the fleetModel transforms and adds nothing of its own:
   - fleetBySession stores what session_fleet actually returned (the Tauri
     command resolves to the snapshot itself), typed through
     fleetTreeView/rollupView/truncationView — bounded stays bounded,
     absence stays "no data";
   - childDigests stores each session.observe digest VERBATIM (opaque daemon
     authority — the nested projection is never rebuilt locally), keyed by
     the child session id it was requested for; a batch correlates strictly
     by request order, as the SDK defines;
   - dispatches carry only REAL coordinates: agent_message goes out only
     with a non-empty (session_id, agent, text), and an observe batch
     outside the SDK's 1..=64 bound never reaches the wire;
   - a daemon that lacks a fleet read/message feature settles into the shared
     `unavailable` state once. agent_cancel has its own settle-once gate, so
     its absence never disables the other fleet commands. */

function updateCancelState(current, agentId, patch) {
  return {
    ...current,
    [agentId]: {
      pending: false,
      receipt: null,
      error: "",
      ...current[agentId],
      ...patch,
    },
  };
}

export function useFleet({ enabled = true } = {}) {
  /* sessionId -> { tree, rollup, truncation } (fleetModel views). A session
     without an entry is UNREAD — not the same claim as "no subagents". */
  const [fleetBySession, setFleetBySession] = useState({});
  /* childSessionId -> verbatim session.observe digest (opaque). */
  const [childDigests, setChildDigests] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  /* agentId -> { pending, receipt, error }. An accepted receipt keeps
     pending:true because only a later fleet/descendant publication can prove
     the node terminal; the receipt itself never changes fleetBySession. */
  const [cancelByAgent, setCancelByAgent] = useState({});
  const [cancelUnavailable, setCancelUnavailable] = useState("");

  const unavailableRef = useRef(false);
  const cancelUnavailableRef = useRef(false);
  const cancelInFlightRef = useRef(new Set());
  const markUnavailable = useCallback(() => {
    unavailableRef.current = true;
    setUnavailable(true);
  }, []);

  const settleError = useCallback((thrown, fallback) => {
    if (fleetUnavailableFromError(thrown)) {
      markUnavailable();
      return true;
    }
    setError(String(thrown?.message ?? thrown ?? fallback));
    return false;
  }, [markUnavailable]);

  const loadFleet = useCallback(async (sessionId) => {
    /* An unavailable daemon stays unavailable for this hook's lifetime —
       never poll a feature the daemon told us it does not have. */
    if (!enabled || !sessionId || unavailableRef.current) return null;
    setLoading(true);
    try {
      const snapshot = await invoke("session_fleet", { session_id: sessionId });
      const entry = {
        tree: fleetTreeView(snapshot),
        rollup: rollupView(snapshot?.rollup),
        truncation: truncationView(snapshot),
      };
      setFleetBySession((current) => ({ ...current, [sessionId]: entry }));
      setError("");
      return entry;
    } catch (thrown) {
      settleError(thrown, "Unable to read the subagent fleet.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [enabled, settleError]);

  const observeChild = useCallback(async (
    childSessionId,
    { lastEventLimit = 50, metadataOnly = false } = {},
  ) => {
    if (!enabled || !childSessionId || unavailableRef.current) return null;
    try {
      const digest = await invoke("session_observe", {
        session_id: childSessionId,
        last_event_limit: lastEventLimit,
        metadata_only: metadataOnly,
      });
      /* The digest is OPAQUE daemon authority — stored verbatim, never
         reshaped into a local projection. */
      setChildDigests((current) => ({ ...current, [childSessionId]: digest ?? null }));
      return digest ?? null;
    } catch (thrown) {
      settleError(thrown, "Unable to observe the child session.");
      return null;
    }
  }, [enabled, settleError]);

  const observeBatch = useCallback(async (
    sessionIds,
    { lastEventLimit = 50, metadataOnly = false } = {},
  ) => {
    const ids = Array.isArray(sessionIds)
      ? sessionIds.filter((id) => typeof id === "string" && id.length > 0)
      : [];
    /* SDK bound: 1..=64 ids. An out-of-range batch never reaches the wire. */
    if (!enabled || ids.length < 1 || ids.length > 64 || unavailableRef.current) return null;
    try {
      const digests = await invoke("session_observe_batch", {
        session_ids: ids,
        last_event_limit: lastEventLimit,
        metadata_only: metadataOnly,
      });
      if (!Array.isArray(digests)) return null;
      /* Request order IS the correlation — the SDK returns digests in the
         exact order the ids were sent. */
      setChildDigests((current) => {
        const next = { ...current };
        digests.forEach((digest, index) => {
          if (index < ids.length) next[ids[index]] = digest ?? null;
        });
        return next;
      });
      return digests;
    } catch (thrown) {
      settleError(thrown, "Unable to observe the child sessions.");
      return null;
    }
  }, [enabled, settleError]);

  /* Message one direct child of `sessionId`. House law: only REAL
     coordinates are dispatched — a missing session id, agent id, or empty
     text never reaches the wire, and an unavailable fleet dispatches
     nothing. The receipt is the daemon's; after a delivery the fleet is
     RE-READ from authority instead of locally synthesizing the child's new
     run state. */
  const sendMessage = useCallback(async (sessionId, agent, text) => {
    const agentId = typeof agent === "string" ? agent.trim() : "";
    const body = typeof text === "string" ? text.trim() : "";
    if (!enabled || !sessionId || !agentId || !body || unavailableRef.current) return null;
    try {
      const receipt = await invoke("agent_message", {
        session_id: sessionId,
        agent: agentId,
        text: body,
      });
      const view = messageReceiptView(receipt);
      void loadFleet(sessionId);
      return { ok: true, receipt: view };
    } catch (thrown) {
      settleError(thrown, "Unable to message the agent.");
      return null;
    }
  }, [enabled, loadFleet, settleError]);

  /* Cancel one child using the same real parent-session + agent addressing
     rule as agent.message. Pending is per node. `accepted` remains pending
     and does not touch the node tree; `already_terminal` is a successful,
     settled receipt. Feature-gate failures settle only this command. */
  const cancelAgent = useCallback(async (sessionId, agent) => {
    const agentId = typeof agent === "string" ? agent.trim() : "";
    if (!enabled || !sessionId || !agentId || cancelUnavailableRef.current
      || cancelInFlightRef.current.has(agentId)) return null;
    cancelInFlightRef.current.add(agentId);
    setCancelByAgent((current) => updateCancelState(current, agentId, {
      pending: true,
      receipt: null,
      error: "",
    }));
    try {
      const receipt = await invoke("agent_cancel", {
        session_id: sessionId,
        agent: agentId,
      });
      const view = cancelReceiptView(receipt);
      setCancelByAgent((current) => updateCancelState(current, agentId, {
        pending: view.status.kind === "accepted",
        receipt: view,
        error: "",
      }));
      /* This is an authority re-read, not an optimistic state change. The
         separately mounted descendant stream may publish first. */
      void loadFleet(sessionId);
      return { ok: true, receipt: view };
    } catch (thrown) {
      const message = String(
        thrown?.message ?? thrown ?? "Unable to cancel the agent.",
      );
      if (fleetUnavailableFromError(thrown)) {
        cancelUnavailableRef.current = true;
        setCancelUnavailable(`Cancel unavailable on this daemon: ${message}`);
        setCancelByAgent((current) => updateCancelState(current, agentId, {
          pending: false,
          receipt: null,
          error: "",
        }));
        return null;
      }
      setCancelByAgent((current) => updateCancelState(current, agentId, {
        pending: false,
        receipt: null,
        error: message,
      }));
      return null;
    } finally {
      cancelInFlightRef.current.delete(agentId);
    }
  }, [enabled, loadFleet]);

  return {
    fleetBySession,
    childDigests,
    loading,
    error,
    unavailable,
    cancelByAgent,
    cancelUnavailable,
    loadFleet,
    observeChild,
    observeBatch,
    sendMessage,
    cancelAgent,
  };
}

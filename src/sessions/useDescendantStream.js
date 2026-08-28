import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  applyStreamEvent,
  baselineView,
  cursorsFor,
  descendantUnavailableFromError,
  repairPlan,
} from "./descendantStreamModel.js";

/* One AppShell-owned live descendant attachment. The existing useFleet lane
   remains the point-in-time fallback and owns all snapshot/observe/message
   commands. This hook owns exactly the two descendant commands and two push
   subscriptions, and exposes an explicit live | snapshot | unavailable
   mode so a fallback tree can never masquerade as live. */

const DEFAULT_MAX_CHILDREN = 64;

export function useDescendantStream({ enabled = true } = {}) {
  const [stream, setStream] = useState({
    sessionId: "",
    mode: "unavailable",
    entry: null,
    loading: false,
    error: "",
    repair: null,
  });

  const activeRef = useRef(null);
  const treeRef = useRef(null);
  const heldBySessionRef = useRef(new Map());
  const operationRef = useRef(0);
  const maxChildrenRef = useRef(DEFAULT_MAX_CHILDREN);
  const repairCountRef = useRef(0);
  const featureUnavailableRef = useRef(false);
  const mountedRef = useRef(true);

  const streamHandlerRef = useRef(null);
  const repairHandlerRef = useRef(null);
  const listenersPromiseRef = useRef(null);
  const unlistenersRef = useRef([]);
  const listenerEpochRef = useRef(0);

  const detachId = useCallback(async (attachmentId) => {
    if (!attachmentId) return;
    try {
      await invoke("session_descendants_detach", { attachment_id: attachmentId });
    } catch {
      /* Detach is best-effort during view changes/unmount. The attachment id
         is cleared before the await, so no late frame can regain ownership. */
    }
  }, []);

  const releaseAttachment = useCallback(async () => {
    const active = activeRef.current;
    activeRef.current = null;
    treeRef.current = null;
    if (active?.attachmentId) await detachId(active.attachmentId);
  }, [detachId]);

  const closeListeners = useCallback(() => {
    listenerEpochRef.current += 1;
    const unlisteners = unlistenersRef.current;
    unlistenersRef.current = [];
    listenersPromiseRef.current = null;
    for (const unlisten of unlisteners) unlisten();
  }, []);

  const ensureListeners = useCallback(async () => {
    if (!enabled) return false;
    if (listenersPromiseRef.current) return listenersPromiseRef.current;
    const epoch = listenerEpochRef.current;
    const pending = Promise.all([
      listen("session-descendant-stream", (message) => {
        streamHandlerRef.current?.(message?.payload ?? {});
      }),
      listen("session-descendant-repair", (message) => {
        repairHandlerRef.current?.(message?.payload ?? {});
      }),
    ]).then((unlisteners) => {
      if (!mountedRef.current || epoch !== listenerEpochRef.current) {
        for (const unlisten of unlisteners) unlisten();
        return false;
      }
      unlistenersRef.current = unlisteners;
      return true;
    }).catch(() => {
      listenersPromiseRef.current = null;
      return false;
    });
    listenersPromiseRef.current = pending;
    return pending;
  }, [enabled]);

  const handleStreamPayload = useCallback((payload) => {
    const active = activeRef.current;
    if (!active || payload?.attachment_id !== active.attachmentId) return;
    const nextTree = applyStreamEvent(treeRef.current, payload?.event);
    if (nextTree === treeRef.current) return;
    treeRef.current = nextTree;
    heldBySessionRef.current.set(active.sessionId, cursorsFor(nextTree));
    setStream((current) => {
      if (current.sessionId !== active.sessionId || current.mode !== "live") return current;
      return {
        ...current,
        entry: current.entry ? { ...current.entry, tree: nextTree } : current.entry,
      };
    });
  }, []);
  streamHandlerRef.current = handleStreamPayload;

  const connect = useCallback(async (
    sessionId,
    cursors,
    { maxChildren = DEFAULT_MAX_CHILDREN, repair = null } = {},
  ) => {
    const operation = ++operationRef.current;
    maxChildrenRef.current = maxChildren;
    await releaseAttachment();
    if (operation !== operationRef.current || !enabled || !mountedRef.current) return null;

    setStream((current) => ({
      ...current,
      sessionId,
      mode: "unavailable",
      entry: null,
      loading: true,
      error: "",
      repair: repair ?? current.repair,
    }));

    try {
      const listening = await ensureListeners();
      if (!listening) throw new Error("Unable to subscribe to descendant stream events.");
      const attached = await invoke("session_descendants_attach", {
        session_id: sessionId,
        cursors,
        max_children: maxChildren,
      });
      const attachmentId = String(attached?.attachment_id ?? "");
      if (!attachmentId) throw new Error("Descendant attach returned no attachment id.");
      if (operation !== operationRef.current || !mountedRef.current) {
        await detachId(attachmentId);
        return null;
      }

      const baseline = baselineView(attached?.baseline);
      /* The re-baseline cannot erase positions this client already applied.
         Keep both; cursorsFor selects the BigInt-newest value per pair. */
      const tree = {
        ...baseline.tree,
        appliedCursors: [
          ...baseline.tree.appliedCursors,
          ...cursors,
        ],
      };
      const entry = { ...baseline, tree };
      activeRef.current = { attachmentId, sessionId };
      treeRef.current = tree;
      heldBySessionRef.current.set(sessionId, cursorsFor(tree));
      setStream({
        sessionId,
        mode: "live",
        entry,
        loading: false,
        error: "",
        repair,
      });
      return entry;
    } catch (thrown) {
      if (operation !== operationRef.current || !mountedRef.current) return null;
      if (descendantUnavailableFromError(thrown)) featureUnavailableRef.current = true;
      setStream({
        sessionId,
        mode: "snapshot",
        entry: null,
        loading: false,
        error: descendantUnavailableFromError(thrown)
          ? "Live descendant stream is unavailable on this daemon; showing a point-in-time snapshot."
          : `Live descendant attach failed; showing a point-in-time snapshot. ${String(thrown?.message ?? thrown ?? "")}`,
        repair,
      });
      return null;
    }
  }, [detachId, enabled, ensureListeners, releaseAttachment]);

  const start = useCallback(async (sessionId, { force = false, maxChildren } = {}) => {
    if (!enabled || !sessionId) return null;
    const limit = typeof maxChildren === "number" && Number.isFinite(maxChildren)
      ? maxChildren
      : maxChildrenRef.current;
    const active = activeRef.current;
    if (!force && active?.sessionId === sessionId) return null;
    if (featureUnavailableRef.current) {
      setStream({
        sessionId,
        mode: "snapshot",
        entry: null,
        loading: false,
        error: "Live descendant stream is unavailable on this daemon; showing a point-in-time snapshot.",
        repair: null,
      });
      return null;
    }
    const held = heldBySessionRef.current.get(sessionId) ?? [];
    return connect(sessionId, held, { maxChildren: limit });
  }, [connect, enabled]);

  const reconnect = useCallback((sessionId, options = {}) => (
    start(sessionId, { ...options, force: true })
  ), [start]);

  const stop = useCallback(async () => {
    operationRef.current += 1;
    await releaseAttachment();
    if (!mountedRef.current) return;
    setStream({
      sessionId: "",
      mode: "unavailable",
      entry: null,
      loading: false,
      error: "",
      repair: null,
    });
  }, [releaseAttachment]);

  const handleRepairPayload = useCallback((payload) => {
    const active = activeRef.current;
    if (!active || payload?.attachment_id !== active.attachmentId) return;
    const children = Array.isArray(payload?.children) ? payload.children : [];
    /* Repair frames carry NO position. The only resume positions allowed
       onto the wire are this client's already-applied per-child cursors. */
    const held = cursorsFor(treeRef.current);
    heldBySessionRef.current.set(active.sessionId, held);
    const plan = repairPlan(children, held);
    const namedChildren = children
      .filter((child) => child?.session_id && child?.agent_id)
      .map((child) => ({
        session_id: child.session_id,
        agent_id: child.agent_id,
      }));
    repairCountRef.current += 1;
    const notice = {
      count: repairCountRef.current,
      namedChildren,
      resumedChildren: plan.length,
    };
    setStream((current) => ({ ...current, repair: notice, loading: true }));
    void connect(active.sessionId, plan, {
      maxChildren: maxChildrenRef.current,
      repair: notice,
    });
  }, [connect]);
  repairHandlerRef.current = handleRepairPayload;

  useEffect(() => {
    mountedRef.current = true;
    if (enabled) void ensureListeners();
    else void stop();
  }, [enabled, ensureListeners, stop]);

  useEffect(() => () => {
    mountedRef.current = false;
    operationRef.current += 1;
    closeListeners();
    const attachmentId = activeRef.current?.attachmentId;
    activeRef.current = null;
    treeRef.current = null;
    if (attachmentId) void detachId(attachmentId);
  }, [closeListeners, detachId]);

  return {
    ...stream,
    start,
    reconnect,
    stop,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  graphStateView,
  watchPageView,
  watchSignal,
  workflowGraphUnavailableFromError,
} from "./workflowGraphModel.js";

/* React seam for the workflow live-runtime graph surface (P6). EVERY
   invoke() for the two workflow_graph_v1 commands — workflow_graph_state,
   workflow_graph_watch — lives in this file: the single reconcile point if
   the SDK's arg names drift. Both Tauri commands resolve to the UNWRAPPED
   inner value (the state object or null; the watch page object), like
   P0.5's do. The hook carries daemon facts through the workflowGraphModel
   transforms and adds nothing of its own:
   - graphBySession stores what workflow_graph_state actually said, the
     honest "none" view included — a session without an entry has an
     UNREAD graph, which is NOT the same claim as "no live graph";
   - graphBySession is written ONLY from workflow_graph_state reads: the
     watch page is a CHANGE SIGNAL (events arrived / next_cursor advanced /
     a cursor gap appeared → re-fetch state), NEVER a reduction input — no
     node state is ever computed from events client-side;
   - cursors are u64-scale DECIMAL STRINGS across the Tauri boundary:
     after_cursor advances to the page's next_cursor VERBATIM as that
     string — never through a numeric round-trip, which would silently
     collapse 9007199254740993 to 9007199254740992 and replay from the
     wrong position; a page with no next_cursor drops the position to null
     so the loop re-baselines from a fresh state read instead of inventing
     a resume cursor;
   - watch events (unknown types included, preserved raw) accumulate in a
     bounded recentEvents list for the view's activity strip;
   - a daemon that lacks the feature settles into `unavailable` once — no
     retry spam. */

const WATCH_POLL_MS = 1500;
const WATCH_PAGE_LIMIT = 64;
const RECENT_EVENT_CAP = 30;

export function useWorkflowGraph({ enabled = true, pollMs = WATCH_POLL_MS } = {}) {
  /* sessionId -> graphStateView (kind "graph" | "none"). ONLY
     workflow_graph_state reads populate this. */
  const [graphBySession, setGraphBySession] = useState({});
  /* The live watch position for the watched session, VERBATIM from the
     last page's next_cursor — a decimal STRING, never numeric (null = no
     position: unbaselined). */
  const [cursor, setCursor] = useState(null);
  /* Bounded journal-fact views from watch pages — unknown kinds kept. */
  const [recentEvents, setRecentEvents] = useState([]);
  const [watchSessionId, setWatchSessionId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  const unavailableRef = useRef(false);
  const markUnavailable = useCallback(() => {
    unavailableRef.current = true;
    setUnavailable(true);
  }, []);

  const settleError = useCallback((thrown, fallback) => {
    if (workflowGraphUnavailableFromError(thrown)) {
      markUnavailable();
      return true;
    }
    setError(String(thrown?.message ?? thrown ?? fallback));
    return false;
  }, [markUnavailable]);

  const loadState = useCallback(async (sessionId, graphId = undefined) => {
    /* An unavailable daemon stays unavailable for this hook's lifetime —
       never poll a feature the daemon told us it does not have. */
    if (!enabled || !sessionId || unavailableRef.current) return null;
    setLoading(true);
    try {
      const payload = { session_id: sessionId };
      /* graph_id is OPTIONAL on the wire: it rides the payload only when
         the caller names one — otherwise the key is OMITTED so the daemon
         selects the session's most-recently-changed graph. */
      if (typeof graphId === "string" && graphId.length > 0) {
        payload.graph_id = graphId;
      }
      const state = await invoke("workflow_graph_state", payload);
      /* null = the daemon honestly saying there is NO live workflow graph
         for this session — stored as the typed "none" view, never a
         fabricated empty graph. */
      const view = graphStateView(state ?? null);
      setGraphBySession((current) => ({ ...current, [sessionId]: view }));
      setError("");
      return view;
    } catch (thrown) {
      settleError(thrown, "Unable to read the workflow graph.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [enabled, settleError]);

  const watch = useCallback(async (sessionId, afterCursor, limit = WATCH_PAGE_LIMIT) => {
    if (!enabled || !sessionId || unavailableRef.current) return null;
    try {
      const page = await invoke("workflow_graph_watch", {
        session_id: sessionId,
        after_cursor: afterCursor,
        limit,
      });
      /* The page's cursors and journal facts ride the view VERBATIM —
         unknown event types preserved. NOTHING here writes graphBySession:
         the page is a change signal, not a graph. */
      return watchPageView(page ?? null);
    } catch (thrown) {
      settleError(thrown, "Unable to watch the workflow graph.");
      return null;
    }
  }, [enabled, settleError]);

  /* Latest-callback mirrors so the poll loop never restarts on identity
     churn. */
  const loadStateRef = useRef(loadState);
  const watchRef = useRef(watch);
  useEffect(() => {
    loadStateRef.current = loadState;
  }, [loadState]);
  useEffect(() => {
    watchRef.current = watch;
  }, [watch]);

  /* startWatch(sessionId) begins the live poll for one session (the empty
     string stops it — stopWatch is the same gesture named). */
  const startWatch = useCallback((sessionId) => {
    setWatchSessionId(typeof sessionId === "string" ? sessionId : "");
  }, []);
  const stopWatch = useCallback(() => {
    setWatchSessionId("");
  }, []);

  useEffect(() => {
    if (!enabled || !watchSessionId || unavailable) return undefined;
    let cancelled = false;
    let timer = null;
    /* The watch position for THIS loop. null = unbaselined: the next tick
       reads workflow_graph_state first — its through_cursor is the only
       honest place a watch may start from. */
    const cursorRef = { current: null };
    setCursor(null);
    setRecentEvents([]);

    const baseline = async () => {
      const view = await loadStateRef.current(watchSessionId);
      if (cancelled) return;
      /* With a live graph the watch resumes from its through_cursor,
         VERBATIM (the decimal string, never a numeric round-trip). With
         none ("none" view) the watch starts from the string "0" purely
         as a change signal — a workflow_graph_started fact will trigger
         the authoritative state re-fetch. */
      const start = view?.kind === "graph" && view.throughCursor != null
        ? view.throughCursor
        : "0";
      cursorRef.current = start;
      setCursor(start);
    };

    const tick = async () => {
      if (cancelled || unavailableRef.current) return;
      if (cursorRef.current == null) {
        await baseline();
      } else {
        const page = await watchRef.current(watchSessionId, cursorRef.current);
        if (!cancelled && page) {
          const signal = watchSignal(page);
          /* HOUSE LAW: watch is a CHANGE SIGNAL only. Events arrived, the
             cursor advanced, or a gap appeared → RE-FETCH the state for
             the authoritative projection. The events are never reduced
             into node states here. */
          if (signal.changed) {
            await loadStateRef.current(watchSessionId);
          }
          if (page.events.length > 0) {
            setRecentEvents((current) => (
              [...current, ...page.events].slice(-RECENT_EVENT_CAP)
            ));
          }
          /* HOUSE LAW: after_cursor = next_cursor, verbatim. A null
             position (no next_cursor published) re-baselines next tick
             instead of guessing a resume cursor. */
          cursorRef.current = signal.nextAfterCursor;
          setCursor(signal.nextAfterCursor);
        }
      }
      if (cancelled || unavailableRef.current) return;
      timer = setTimeout(() => {
        void tick();
      }, pollMs);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, pollMs, unavailable, watchSessionId]);

  return {
    graphBySession,
    cursor,
    recentEvents,
    watchSessionId,
    loading,
    error,
    unavailable,
    loadState,
    watch,
    startWatch,
    stopWatch,
  };
}

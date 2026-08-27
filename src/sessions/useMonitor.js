import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  advanceWatchCursor,
  MONITOR_CURSOR_BASELINE,
  monitorCursorOrNull,
  monitorListReceiptView,
  monitorUnavailableFromError,
  registerOutcomeView,
  removeOutcomeView,
  watchDeliveries,
  watchOutcomeView,
} from "./monitorModel.js";

/* React seam for the monitor manager surface (P4). EVERY invoke() for the
   four monitor_control_v1 / monitor_delivery_v1 commands — monitor_list,
   monitor_register, monitor_remove, monitor_watch — lives in this file:
   the single reconcile point if the SDK's arg names drift. Each Tauri
   command resolves to the UNWRAPPED receipt (like P0.5/P6's do), and the
   hook carries daemon facts through the monitorModel transforms and adds
   nothing of its own:
   - bySession stores what monitor_list actually said (policy + per-source
     availability tri-state + the discriminated outcome) — a session
     without an entry is UNREAD, which is NOT the same claim as "no
     monitors", and a rejected list outcome stays a rejection view with NO
     monitors array to render;
   - register/remove return the daemon's STRUCTURED outcome view
     (registered/removed vs a typed rejection) — never a fabricated
     success, never a bare string — and a successful mutation RE-READS the
     registry from list authority instead of locally editing rows;
   - monitor.watch is a cursor loop over DECIMAL STRINGS: the baseline is
     the string "0", after_cursor rides the wire as the validated string,
     and the position advances VERBATIM to the largest published cursor
     (replay_through_cursor / each delivery's cursor) under BigInt
     comparison — never through numeric coercion, which would silently collapse
     9007199254740993 to 9007199254740992 and replay the wrong span;
   - deliveries accumulate bounded, deduped by the daemon's delivery_key
     (its exact-redelivery identity) — never synthesized locally;
   - a daemon that lacks the feature settles into `unavailable` once — no
     retry spam. */

const WATCH_POLL_MS = 1500;
const DELIVERY_CAP = 50;

export function useMonitor({ enabled = true, pollMs = WATCH_POLL_MS } = {}) {
  /* sessionId -> monitorListReceiptView. Absent entry = UNREAD. */
  const [bySession, setBySession] = useState({});
  /* Bounded deliveryReportView rows from the live watch, arrival order. */
  const [deliveries, setDeliveries] = useState([]);
  /* The live watch position, VERBATIM decimal string (null = no watch). */
  const [cursor, setCursor] = useState(null);
  /* The latest monitor.watch outcome view (watching / structured
     rejection / unknown), for honest watch-state display. */
  const [watchOutcome, setWatchOutcome] = useState(null);
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
    if (monitorUnavailableFromError(thrown)) {
      markUnavailable();
      return true;
    }
    setError(String(thrown?.message ?? thrown ?? fallback));
    return false;
  }, [markUnavailable]);

  const list = useCallback(async (sessionId) => {
    /* An unavailable daemon stays unavailable for this hook's lifetime —
       never poll a feature the daemon told us it does not have. */
    if (!enabled || !sessionId || unavailableRef.current) return null;
    setLoading(true);
    try {
      const receipt = await invoke("monitor_list", { session_id: sessionId });
      const view = monitorListReceiptView(receipt);
      setBySession((current) => ({ ...current, [sessionId]: view }));
      setError("");
      return view;
    } catch (thrown) {
      settleError(thrown, "Unable to list monitors.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [enabled, settleError]);

  /* Register one monitor. Only a REAL spec dispatches: a source object
     with a string kind (buildRegisterSpec's output) — malformed specs
     never reach the wire. The outcome view is returned STRUCTURED
     (registered vs typed rejection); a registered outcome RE-READS the
     registry from list authority instead of appending a local row. */
  const register = useCallback(async (sessionId, spec) => {
    const source = spec?.source;
    const sourceOk = source != null && typeof source === "object"
      && typeof source.kind === "string" && source.kind.length > 0;
    if (!enabled || !sessionId || !sourceOk || unavailableRef.current) return null;
    try {
      const payload = {
        session_id: sessionId,
        source,
        action: spec.action,
        occurrence: spec.occurrence,
        lifetime: spec.lifetime,
      };
      /* filter is OPTIONAL on the wire: the key rides the payload only
         when the form built one — never null/empty filler. */
      if (spec.filter != null) {
        payload.filter = spec.filter;
      }
      const receipt = await invoke("monitor_register", payload);
      const outcome = registerOutcomeView(receipt?.outcome);
      if (outcome.status === "registered") void list(sessionId);
      return outcome;
    } catch (thrown) {
      settleError(thrown, "Unable to register the monitor.");
      return null;
    }
  }, [enabled, list, settleError]);

  /* Remove one monitor by its REAL id. A removed outcome RE-READS the
     registry from list authority. */
  const remove = useCallback(async (sessionId, monitorId) => {
    const id = typeof monitorId === "string" ? monitorId.trim() : "";
    if (!enabled || !sessionId || !id || unavailableRef.current) return null;
    try {
      const receipt = await invoke("monitor_remove", {
        session_id: sessionId,
        monitor_id: id,
      });
      const outcome = removeOutcomeView(receipt?.outcome);
      if (outcome.status === "removed") void list(sessionId);
      return outcome;
    } catch (thrown) {
      settleError(thrown, "Unable to remove the monitor.");
      return null;
    }
  }, [enabled, list, settleError]);

  /* One monitor.watch dispatch. after_cursor rides the wire as a DECIMAL
     STRING — the caller's position validated verbatim, falling back to
     the baseline "0" only when no valid position is held. */
  const watch = useCallback(async (sessionId, afterCursor) => {
    if (!enabled || !sessionId || unavailableRef.current) return null;
    const position = monitorCursorOrNull(afterCursor) ?? MONITOR_CURSOR_BASELINE;
    try {
      const receipt = await invoke("monitor_watch", {
        session_id: sessionId,
        after_cursor: position,
      });
      return {
        outcome: watchOutcomeView(receipt?.outcome),
        reports: watchDeliveries(receipt),
      };
    } catch (thrown) {
      settleError(thrown, "Unable to watch monitor deliveries.");
      return null;
    }
  }, [enabled, settleError]);

  /* Latest-callback mirror so the poll loop never restarts on identity
     churn. */
  const watchRef = useRef(watch);
  useEffect(() => {
    watchRef.current = watch;
  }, [watch]);

  /* startWatch(sessionId) begins the delivery cursor loop for one session
     (the empty string stops it — stopWatch is the same gesture named). */
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
    /* HOUSE LAW: the watch baseline is the decimal STRING "0" — never the
       number 0, never a guessed position. */
    const positionRef = { current: MONITOR_CURSOR_BASELINE };
    setCursor(MONITOR_CURSOR_BASELINE);
    setDeliveries([]);
    setWatchOutcome(null);

    const tick = async () => {
      if (cancelled || unavailableRef.current) return;
      const result = await watchRef.current(watchSessionId, positionRef.current);
      if (!cancelled && result) {
        setWatchOutcome(result.outcome);
        if (result.reports.length > 0) {
          /* Dedupe by the daemon's delivery_key — its exact-redelivery
             identity. Keyless rows are kept (nothing is invented to drop
             them by). */
          setDeliveries((current) => {
            const seen = new Set(
              current.map((row) => row.deliveryKey).filter((key) => key != null),
            );
            const fresh = result.reports.filter((row) => (
              row.deliveryKey == null || !seen.has(row.deliveryKey)
            ));
            return [...current, ...fresh].slice(-DELIVERY_CAP);
          });
        }
        /* HOUSE LAW: the position advances VERBATIM to the largest
           published cursor — replay_through_cursor and each delivery's
           cursor — under BigInt comparison. A receipt publishing nothing
           newer leaves the position unchanged. */
        const next = advanceWatchCursor(positionRef.current, [
          result.outcome?.replayThroughCursor,
          ...result.reports.map((row) => row.cursor),
        ]);
        if (next != null && next !== positionRef.current) {
          positionRef.current = next;
          setCursor(next);
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
    bySession,
    deliveries,
    cursor,
    watchOutcome,
    watchSessionId,
    loading,
    error,
    unavailable,
    list,
    register,
    remove,
    watch,
    startWatch,
    stopWatch,
  };
}

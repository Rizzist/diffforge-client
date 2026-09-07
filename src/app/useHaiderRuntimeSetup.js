import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  INITIAL_SETUP_STATE,
  continueWithout as continueWithoutTransition,
  installFailed,
  installProgress,
  installRequested,
  installResolved,
  noticeDismissed,
  retryStartRequested,
  setupCompleted,
  startFailed,
  startResolved,
  statusResolved,
  statusUnknown,
} from "./haiderRuntimeSetupModel.js";

/* App-scope seam for the pre-login Haider runtime setup gate (F1-UI). All
   three SDK commands — haider_runtime_status, haider_install_latest,
   haider_daemon_start — and the "haider-install-progress" subscription live
   in this file; the screen/notice stay presentational and the model stays
   pure. AppShell mounts exactly one instance (main window only).

   - The status probe is the OFFLINE local check (no refreshLatest): no
     network rides the boot path before login. A rejection or a stalled
     probe settles the NON-BLOCKING "unknown" stage; the model's stage
     guards make a late resolution after the timeout a no-op.
   - The progress listener is subscribed on mount — BEFORE any install can
     dispatch, per the SDK contract — and unsubscribed on unmount. Install
     additionally awaits the subscription so no early frame is dropped.
   - Nothing installs without a click, and only one mutation runs at a
     time (the SDK rejects overlap with `busy` anyway). */

const STATUS_CHECK_TIMEOUT_MS = 10_000;
/* How long the outcome facts stay on screen before the ceremony proceeds
   automatically (mirrors the auth success hold's order of magnitude). */
export const DONE_HOLD_MS = 2_400;

export function useHaiderRuntimeSetup() {
  const [state, setState] = useState(INITIAL_SETUP_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;

  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  /* Resolves once the progress subscription is registered. */
  const listenerReadyRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /* Progress events (app-wide, LITERAL name). Subscribe before install. */
  useEffect(() => {
    let cancelled = false;
    let unlisten = null;
    listenerReadyRef.current = listen("haider-install-progress", (event) => {
      setState((current) => installProgress(current, event?.payload));
    }).then((stop) => {
      if (cancelled) {
        stop();
      } else {
        unlisten = stop;
      }
    }).catch(() => {
      /* A failed subscription only loses live progress display; the
         install result itself is terminal and still lands. */
    });
    return () => {
      cancelled = true;
      listenerReadyRef.current = null;
      if (unlisten) unlisten();
    };
  }, []);

  /* One offline status probe per app open. */
  useEffect(() => {
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setState((current) => statusUnknown(current, {
          message: "The runtime status check did not answer in time.",
        }));
      }
    }, STATUS_CHECK_TIMEOUT_MS);
    invoke("haider_runtime_status")
      .then((receipt) => {
        if (!cancelled) setState((current) => statusResolved(current, receipt));
      })
      .catch((thrown) => {
        if (!cancelled) setState((current) => statusUnknown(current, thrown));
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  /* Hold the outcome facts briefly, then close the gate automatically. */
  useEffect(() => {
    if (state.stage !== "done") return undefined;
    const timer = setTimeout(() => {
      setState((current) => setupCompleted(current));
    }, DONE_HOLD_MS);
    return () => clearTimeout(timer);
  }, [state.stage]);

  const runStart = useCallback(async () => {
    try {
      const receipt = await invoke("haider_daemon_start");
      if (mountedRef.current) setState((current) => startResolved(current, receipt));
    } catch (thrown) {
      if (mountedRef.current) setState((current) => startFailed(current, thrown));
    }
  }, []);

  const runInstall = useCallback(async () => {
    if (busyRef.current) return;
    if (!["needed", "unknown", "failed"].includes(stateRef.current.stage)) return;
    busyRef.current = true;
    setState((current) => installRequested(current));
    try {
      /* Contract: subscribe before invoking install. */
      if (listenerReadyRef.current) await listenerReadyRef.current;
      const receipt = await invoke("haider_install_latest");
      if (!mountedRef.current) return;
      setState((current) => installResolved(current, receipt));
      /* Success proceeds into the daemon start automatically. */
      await runStart();
    } catch (thrown) {
      if (mountedRef.current) setState((current) => installFailed(current, thrown));
    } finally {
      busyRef.current = false;
    }
  }, [runStart]);

  /* The Install click (setup screen and unknown-notice alike). */
  const install = useCallback(() => {
    const stage = stateRef.current.stage;
    if (stage !== "needed" && stage !== "unknown") return;
    void runInstall();
  }, [runInstall]);

  /* Retry is offered only for an explicitly retryable rejection, and re-runs
     the leg that actually failed. */
  const retry = useCallback(() => {
    const { stage, failure } = stateRef.current;
    if (stage !== "failed" || failure?.retryable !== true) return;
    if (failure.during === "start") {
      setState((current) => retryStartRequested(current));
      void runStart();
    } else {
      void runInstall();
    }
  }, [runInstall, runStart]);

  const handleContinueWithout = useCallback(() => {
    setState((current) => continueWithoutTransition(current));
  }, []);

  const dismissNotice = useCallback(() => {
    setState((current) => noticeDismissed(current));
  }, []);

  return {
    state,
    install,
    retry,
    continueWithout: handleContinueWithout,
    dismissNotice,
  };
}

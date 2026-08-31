import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

import { sshUnavailableFromError } from "./sshProfileModel.js";
import {
  createPtyCaptureState,
  inputArgs,
  openArgs,
  outputChunkView,
  ptyStateView,
  reducePtyCaptureState,
  resizeArgs,
} from "./sshPtyModel.js";

/* App-owned SDK boundary for interactive saved-profile PTYs. All four PTY
   commands and the three focused shell subscriptions live here. Receipts
   never write lifecycle state; only published state/closed pushes can. */

function keyedFlag(current, key, value) {
  const next = { ...current };
  if (value) next[key] = true;
  else delete next[key];
  return next;
}

function receiptShellId(receipt) {
  const id = receipt?.id ?? receipt?.shell?.id ?? receipt?.row?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export function useSshPty({ enabled = true } = {}) {
  const [capture, dispatchCapture] = useReducer(
    reducePtyCaptureState,
    undefined,
    createPtyCaptureState,
  );
  const [stateByShell, setStateByShell] = useState({});
  const [closedByShell, setClosedByShell] = useState({});
  const [eofByShell, setEofByShell] = useState({});
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  const mountedRef = useRef(true);
  const unavailableRef = useRef(false);
  const closedByShellRef = useRef({});
  const lastResizeByShellRef = useRef(new Map());

  const markUnavailable = useCallback(() => {
    if (unavailableRef.current) return;
    unavailableRef.current = true;
    if (!mountedRef.current) return;
    setUnavailable(true);
    setError("");
  }, []);

  /* Fixed client copy prevents secret-bearing input transport errors from
     ever becoming renderable. Feature gates settle once and fence all later
     dispatches, so an unavailable daemon cannot produce retry spam. */
  const settleError = useCallback((thrown, fallback) => {
    if (sshUnavailableFromError(thrown)) {
      markUnavailable();
      return "unavailable";
    }
    if (unavailableRef.current) return "unavailable";
    if (mountedRef.current) setError(fallback);
    return "error";
  }, [markUnavailable]);

  const open = useCallback(async (profile, term, size) => {
    if (!enabled || unavailableRef.current) return null;
    if (mountedRef.current) {
      setOpening(true);
      setError("");
    }
    try {
      const args = openArgs(profile, term, size);
      const receipt = await invoke("ssh_shell_open", args);
      const id = receiptShellId(receipt);
      if (id != null) {
        lastResizeByShellRef.current.set(id, args.size);
      }
      /* Identity may be used to route output. State from this receipt is
         deliberately ignored; the daemon must publish a lifecycle push. */
      return receipt;
    } catch (thrown) {
      settleError(thrown, "Unable to open the interactive SSH shell.");
      return null;
    } finally {
      if (mountedRef.current) setOpening(false);
    }
  }, [enabled, settleError]);

  const input = useCallback(async (shellId, data) => {
    if (!enabled || unavailableRef.current || closedByShellRef.current[shellId]) {
      return null;
    }
    try {
      return await invoke("ssh_shell_input", inputArgs(shellId, data));
    } catch (thrown) {
      settleError(thrown, "Unable to send input to the interactive SSH shell.");
      return null;
    }
  }, [enabled, settleError]);

  const resize = useCallback(async (shellId, size) => {
    if (!enabled || unavailableRef.current || closedByShellRef.current[shellId]) {
      return null;
    }
    let args;
    try {
      args = resizeArgs(shellId, size);
    } catch (thrown) {
      settleError(thrown, "Unable to resize the interactive SSH shell.");
      return null;
    }
    const previous = lastResizeByShellRef.current.get(args.id);
    if (previous?.cols === args.size.cols && previous?.rows === args.size.rows) {
      return null;
    }
    try {
      const receipt = await invoke("ssh_shell_resize", args);
      lastResizeByShellRef.current.set(args.id, args.size);
      return receipt;
    } catch (thrown) {
      settleError(thrown, "Unable to resize the interactive SSH shell.");
      return null;
    }
  }, [enabled, settleError]);

  const eof = useCallback(async (shellId) => {
    if (!enabled || unavailableRef.current || closedByShellRef.current[shellId]) {
      return null;
    }
    if (mountedRef.current) {
      setEofByShell((current) => keyedFlag(current, shellId, true));
      setError("");
    }
    try {
      /* The receipt is not a close publication. The UI remains event-driven
         until a state or closed push arrives. */
      return await invoke("ssh_shell_eof", { id: shellId });
    } catch (thrown) {
      settleError(thrown, "Unable to send EOF to the interactive SSH shell.");
      return null;
    } finally {
      if (mountedRef.current) {
        setEofByShell((current) => keyedFlag(current, shellId, false));
      }
    }
  }, [enabled, settleError]);

  const handleState = useCallback((sourceEvent, payload) => {
    const view = ptyStateView(payload, sourceEvent);
    if (view.shellId == null || !mountedRef.current) return;
    setStateByShell((current) => ({ ...current, [view.shellId]: view }));
    if (view.closed) {
      closedByShellRef.current = {
        ...closedByShellRef.current,
        [view.shellId]: true,
      };
      setClosedByShell((current) => keyedFlag(current, view.shellId, true));
    }
  }, []);

  const handleOutput = useCallback((payload) => {
    const chunk = outputChunkView(payload);
    if (chunk.shellId == null || !mountedRef.current) return;
    dispatchCapture({ type: "output", chunk });
  }, []);

  const handleTransportPublished = useCallback((payload) => {
    if (!mountedRef.current) return;
    dispatchCapture({ type: "transport-published", payload });
  }, []);

  useEffect(() => {
    if (!enabled || unavailable) return undefined;
    let disposed = false;
    let unlisteners = [];
    /* A new listener boundary cannot inherit an older connection's bytes. */
    dispatchCapture({ type: "listener-boundary" });
    void Promise.all([
      listen("shell-state", (event) => {
        if (!disposed) handleState("shell-state", event?.payload ?? {});
      }),
      listen("shell-closed", (event) => {
        if (!disposed) handleState("shell-closed", event?.payload ?? {});
      }),
      listen("shell-output", (event) => {
        if (!disposed) handleOutput(event?.payload ?? {});
      }),
      listen("haider-roster-bootstrap-changed", (event) => {
        if (!disposed) handleTransportPublished(event?.payload ?? {});
      }),
    ]).then((stops) => {
      if (disposed) {
        for (const stop of stops) stop();
      } else {
        unlisteners = stops;
        /* The native bridge replies with its current published connection
           state, closing the listener-install race before future reconnects. */
        void emit("haider-roster-bootstrap-request", {}).catch(() => {});
      }
    }).catch((thrown) => {
      if (!disposed) {
        settleError(thrown, "Unable to subscribe to interactive SSH shell events.");
      }
    });
    return () => {
      disposed = true;
      for (const stop of unlisteners) stop();
      unlisteners = [];
    };
  }, [
    enabled,
    handleOutput,
    handleState,
    handleTransportPublished,
    settleError,
    unavailable,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    outputByShell: capture.outputByShell,
    stateByShell,
    closedByShell,
    eofByShell,
    subscriptionId: capture.subscriptionId,
    opening,
    error,
    unavailable,
    open,
    input,
    resize,
    eof,
  };
}

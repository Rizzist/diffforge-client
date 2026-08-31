import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import {
  closeOutcomeView,
  execReceiptView,
  outputBufferView,
  outputEntryView,
  shellRowView,
  shellUnavailableFromError,
} from "./shellModel.js";

/* AppShell-owned SDK seam for the unified per-session shell registry. All
   three invokes and all four pushed subscriptions live here. Registry rows
   and lifecycle changes remain daemon-published facts; close and exec never
   apply optimistic state. Output is kept only as a bounded, explicitly
   connection-transient buffer per daemon shell id. */

const OUTPUT_ENTRY_CAP = 200;
const OUTPUT_TEXT_CAP = 64 * 1024;

function keyedFlag(current, key, value) {
  const next = { ...current };
  if (value) next[key] = true;
  else delete next[key];
  return next;
}

function eventShellSource(payload) {
  const source = payload?.shell ?? payload?.row ?? payload;
  if (!source || typeof source !== "object") return null;
  const row = { ...source };
  /* Additive identity fields may ride beside `shell`. They are still pushed
     daemon facts, not locally derived values. */
  for (const key of ["session_id", "branch_id", "cwd", "scope"]) {
    if (!Object.hasOwn(row, key) && Object.hasOwn(payload || {}, key)) {
      row[key] = payload[key];
    }
  }
  return row;
}

function boundedOutputView(previous, payload) {
  let entries = [...(previous?.entries || []), outputEntryView(payload)];
  let bufferDiscarded = previous?.bufferDiscarded === true;
  if (entries.length > OUTPUT_ENTRY_CAP) {
    entries = entries.slice(-OUTPUT_ENTRY_CAP);
    bufferDiscarded = true;
  }

  let textLength = entries.reduce((total, entry) => (
    total + (typeof entry.text === "string" ? entry.text.length : 0)
  ), 0);
  while (textLength > OUTPUT_TEXT_CAP && entries.length > 0) {
    const first = entries[0];
    const firstLength = typeof first.text === "string" ? first.text.length : 0;
    const excess = textLength - OUTPUT_TEXT_CAP;
    bufferDiscarded = true;
    if (firstLength === 0 || firstLength <= excess) {
      entries.shift();
      textLength -= firstLength;
    } else {
      entries[0] = { ...first, text: first.text.slice(excess) };
      textLength -= excess;
    }
  }
  return outputBufferView(entries, { bufferDiscarded });
}

export function useShells({ enabled = true } = {}) {
  /* Missing key = registry unread. Present [] = the daemon published an
     honestly empty registry for that session. */
  const [bySession, setBySession] = useState({});
  const [outputByShell, setOutputByShell] = useState({});
  const [closeOutcomeByShell, setCloseOutcomeByShell] = useState({});
  const [execReceiptBySession, setExecReceiptBySession] = useState({});
  const [closingByShell, setClosingByShell] = useState({});
  const [executingBySession, setExecutingBySession] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  const mountedRef = useRef(true);
  const unavailableRef = useRef(false);
  const pendingReadsRef = useRef(0);

  const beginRead = useCallback(() => {
    pendingReadsRef.current += 1;
    if (mountedRef.current) setLoading(true);
  }, []);
  const endRead = useCallback(() => {
    pendingReadsRef.current = Math.max(0, pendingReadsRef.current - 1);
    if (mountedRef.current && pendingReadsRef.current === 0) setLoading(false);
  }, []);

  const markUnavailable = useCallback(() => {
    if (unavailableRef.current) return;
    unavailableRef.current = true;
    if (!mountedRef.current) return;
    setUnavailable(true);
    setError("");
  }, []);

  const settleError = useCallback((thrown, fallback) => {
    if (shellUnavailableFromError(thrown)) {
      markUnavailable();
      return "unavailable";
    }
    if (unavailableRef.current) return "unavailable";
    if (mountedRef.current) {
      setError(String(thrown?.message ?? thrown ?? fallback));
    }
    return "error";
  }, [markUnavailable]);

  const commitPublishedShell = useCallback((published) => {
    if (!published) return;
    const row = published?.kind && Object.hasOwn(published.kind, "recognized")
      ? published
      : shellRowView(published);
    if (row.id == null || !mountedRef.current) return;
    setBySession((current) => {
      let changed = false;
      const next = { ...current };
      for (const [sessionId, rows] of Object.entries(current)) {
        const index = rows.findIndex((candidate) => candidate.id === row.id);
        const explicitTarget = row.sessionId != null && row.sessionId === sessionId;
        if (index < 0 && !explicitTarget) continue;
        if (index < 0) next[sessionId] = [...rows, row];
        else next[sessionId] = rows.map((candidate, rowIndex) => (
          rowIndex === index ? row : candidate
        ));
        changed = true;
      }
      return changed ? next : current;
    });
  }, []);

  const list = useCallback(async (sessionId) => {
    if (!enabled || !sessionId || unavailableRef.current) return null;
    beginRead();
    if (mountedRef.current) setError("");
    try {
      const receipt = await invoke("shell_list", { session_id: sessionId });
      const rows = Array.isArray(receipt) ? receipt : receipt?.shells;
      if (!Array.isArray(rows)) {
        throw new Error("Shell registry response was not a shell-row array.");
      }
      const views = rows.map(shellRowView);
      if (mountedRef.current && !unavailableRef.current) {
        setBySession((current) => ({ ...current, [sessionId]: views }));
      }
      return views;
    } catch (thrown) {
      settleError(thrown, "Unable to list shells.");
      return null;
    } finally {
      endRead();
    }
  }, [beginRead, enabled, endRead, settleError]);

  /* No optimistic close: neither the registry row nor its state changes
     until the daemon resolves with a published close outcome. */
  const close = useCallback(async (shellId) => {
    const id = typeof shellId === "string" ? shellId.trim() : "";
    if (!enabled || !id || unavailableRef.current) return null;
    if (mountedRef.current) {
      setClosingByShell((current) => keyedFlag(current, id, true));
      setError("");
    }
    try {
      const outcome = closeOutcomeView(
        await invoke("shell_close", { shell_id: id }),
      );
      if (mountedRef.current && !unavailableRef.current) {
        setCloseOutcomeByShell((current) => ({ ...current, [id]: outcome }));
        if (outcome.shell != null) commitPublishedShell(outcome.shell);
      }
      return outcome;
    } catch (thrown) {
      settleError(thrown, "Unable to close the shell.");
      return null;
    } finally {
      if (mountedRef.current) {
        setClosingByShell((current) => keyedFlag(current, id, false));
      }
    }
  }, [commitPublishedShell, enabled, settleError]);

  /* branch_id and cwd are Option fields: absent values omit their keys.
     The exact command text is dispatched after only a nonblank guard. */
  const exec = useCallback(async (sessionId, branchId, command, cwd) => {
    const body = typeof command === "string" ? command : "";
    if (!enabled || !sessionId || !body.trim() || unavailableRef.current) return null;
    const payload = { session_id: sessionId, command: body };
    if (typeof branchId === "string" && branchId.length > 0) {
      payload.branch_id = branchId;
    }
    if (typeof cwd === "string" && cwd.trim().length > 0) {
      payload.cwd = cwd.trim();
    }
    if (mountedRef.current) {
      setExecutingBySession((current) => keyedFlag(current, sessionId, true));
      setError("");
    }
    try {
      const receipt = execReceiptView(await invoke("shell_exec", payload));
      if (mountedRef.current && !unavailableRef.current) {
        setExecReceiptBySession((current) => ({
          ...current,
          [sessionId]: receipt,
        }));
      }
      return receipt;
    } catch (thrown) {
      settleError(thrown, "Unable to run the shell command.");
      return null;
    } finally {
      if (mountedRef.current) {
        setExecutingBySession((current) => keyedFlag(current, sessionId, false));
      }
    }
  }, [enabled, settleError]);

  const handleShellEvent = useCallback((payload) => {
    commitPublishedShell(eventShellSource(payload));
  }, [commitPublishedShell]);

  const handleOutput = useCallback((payload) => {
    const id = typeof payload?.id === "string" && payload.id.length > 0
      ? payload.id
      : typeof payload?.shell_id === "string" && payload.shell_id.length > 0
        ? payload.shell_id
        : null;
    if (id == null || !mountedRef.current) return;
    setOutputByShell((current) => ({
      ...current,
      [id]: boundedOutputView(current[id], { ...payload, id }),
    }));
  }, []);

  useEffect(() => {
    if (!enabled || unavailable) return undefined;
    let disposed = false;
    let unlisteners = [];
    void Promise.all([
      listen("shell-opened", (event) => {
        if (!disposed) handleShellEvent(event?.payload ?? {});
      }),
      listen("shell-state", (event) => {
        if (!disposed) handleShellEvent(event?.payload ?? {});
      }),
      listen("shell-closed", (event) => {
        if (!disposed) handleShellEvent(event?.payload ?? {});
      }),
      listen("shell-output", (event) => {
        if (!disposed) handleOutput(event?.payload ?? {});
      }),
    ]).then((stops) => {
      if (disposed) {
        for (const stop of stops) stop();
      } else {
        unlisteners = stops;
      }
    }).catch((thrown) => {
      if (!disposed) settleError(thrown, "Unable to subscribe to shell events.");
    });
    return () => {
      disposed = true;
      for (const stop of unlisteners) stop();
      unlisteners = [];
    };
  }, [enabled, handleOutput, handleShellEvent, settleError, unavailable]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    bySession,
    outputByShell,
    closeOutcomeByShell,
    execReceiptBySession,
    closingByShell,
    executingBySession,
    loading,
    error,
    unavailable,
    list,
    close,
    exec,
  };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  capabilityUnavailableFromError,
  hookListView,
  toolManifestView,
  trustArgs,
} from "./capabilityModel.js";

/* AppShell-owned boundary for hooks_v1 and tool_inventory_v1. The two
   feature lanes deliberately do not share unavailable/error state: a daemon
   may advertise either one independently. Hook mutations are receipt-first
   and always followed by a fresh hooks_list authority read; no row changes
   optimistically. */

function pendingFlag(current, digest, action) {
  const next = { ...current };
  if (action) next[digest] = action;
  else delete next[digest];
  return next;
}

function errorText(thrown, fallback) {
  return String(thrown?.message ?? thrown ?? fallback);
}

export function useCapabilities({ enabled = true } = {}) {
  /* Missing key = unread. A present entry with rows/tools [] is an honestly
     empty authority publication for that workspace or session. */
  const [hooksByCwd, setHooksByCwd] = useState({});
  const [toolsBySession, setToolsBySession] = useState({});
  const [hookReceiptByDigest, setHookReceiptByDigest] = useState({});
  const [hookPendingByDigest, setHookPendingByDigest] = useState({});
  const [hookLoading, setHookLoading] = useState(false);
  const [toolLoading, setToolLoading] = useState(false);
  const [hookError, setHookError] = useState("");
  const [toolError, setToolError] = useState("");
  const [hooksUnavailable, setHooksUnavailable] = useState(false);
  const [toolsUnavailable, setToolsUnavailable] = useState(false);

  const mountedRef = useRef(true);
  const hooksUnavailableRef = useRef(false);
  const toolsUnavailableRef = useRef(false);
  const hookReadsRef = useRef(0);
  const toolReadsRef = useRef(0);

  const beginHookRead = useCallback(() => {
    hookReadsRef.current += 1;
    if (mountedRef.current) setHookLoading(true);
  }, []);
  const endHookRead = useCallback(() => {
    hookReadsRef.current = Math.max(0, hookReadsRef.current - 1);
    if (mountedRef.current && hookReadsRef.current === 0) setHookLoading(false);
  }, []);
  const beginToolRead = useCallback(() => {
    toolReadsRef.current += 1;
    if (mountedRef.current) setToolLoading(true);
  }, []);
  const endToolRead = useCallback(() => {
    toolReadsRef.current = Math.max(0, toolReadsRef.current - 1);
    if (mountedRef.current && toolReadsRef.current === 0) setToolLoading(false);
  }, []);

  const markHooksUnavailable = useCallback(() => {
    if (hooksUnavailableRef.current) return;
    hooksUnavailableRef.current = true;
    if (!mountedRef.current) return;
    setHooksUnavailable(true);
    setHookError("");
  }, []);
  const markToolsUnavailable = useCallback(() => {
    if (toolsUnavailableRef.current) return;
    toolsUnavailableRef.current = true;
    if (!mountedRef.current) return;
    setToolsUnavailable(true);
    setToolError("");
  }, []);

  const settleHookError = useCallback((thrown, fallback) => {
    if (capabilityUnavailableFromError(thrown)) {
      markHooksUnavailable();
      return "unavailable";
    }
    if (hooksUnavailableRef.current) return "unavailable";
    if (mountedRef.current) setHookError(errorText(thrown, fallback));
    return "error";
  }, [markHooksUnavailable]);
  const settleToolError = useCallback((thrown, fallback) => {
    if (capabilityUnavailableFromError(thrown)) {
      markToolsUnavailable();
      return "unavailable";
    }
    if (toolsUnavailableRef.current) return "unavailable";
    if (mountedRef.current) setToolError(errorText(thrown, fallback));
    return "error";
  }, [markToolsUnavailable]);

  const listHooks = useCallback(async (cwd) => {
    if (!enabled || typeof cwd !== "string" || cwd.length === 0
      || hooksUnavailableRef.current) return null;
    beginHookRead();
    if (mountedRef.current) setHookError("");
    try {
      const result = await invoke("hooks_list", { cwd });
      if (!Array.isArray(result?.hooks)) {
        throw new Error("Hook list response did not publish a hooks array.");
      }
      const view = hookListView(result);
      if (mountedRef.current && !hooksUnavailableRef.current) {
        setHooksByCwd((current) => ({ ...current, [cwd]: view }));
      }
      return view;
    } catch (thrown) {
      settleHookError(thrown, "Unable to list workspace hooks.");
      return null;
    } finally {
      endHookRead();
    }
  }, [beginHookRead, enabled, endHookRead, settleHookError]);

  const listTools = useCallback(async (sessionId) => {
    if (!enabled || !sessionId || toolsUnavailableRef.current) return null;
    beginToolRead();
    if (mountedRef.current) setToolError("");
    try {
      const result = await invoke("tools_inventory", { session_id: sessionId });
      if (!Array.isArray(result?.inventory?.tools)
        || !Array.isArray(result?.inventory?.remembered_grants)) {
        throw new Error("Tool inventory response did not publish canonical arrays.");
      }
      const view = {
        sessionId: typeof result.session_id === "string" ? result.session_id : null,
        tools: result.inventory.tools.map(toolManifestView),
        /* Remembered permission decisions are deliberately retained as the
           daemon's complete raw records, including additive future fields. */
        rememberedDecisions: result.inventory.remembered_grants,
      };
      if (mountedRef.current && !toolsUnavailableRef.current) {
        setToolsBySession((current) => ({ ...current, [sessionId]: view }));
      }
      return view;
    } catch (thrown) {
      settleToolError(thrown, "Unable to read the session tool inventory.");
      return null;
    } finally {
      endToolRead();
    }
  }, [beginToolRead, enabled, endToolRead, settleToolError]);

  const load = useCallback(async (cwd, sessionId) => {
    const hookRead = typeof cwd === "string" && cwd.length > 0
      ? listHooks(cwd)
      : Promise.resolve(null);
    const toolRead = sessionId ? listTools(sessionId) : Promise.resolve(null);
    const [hooks, tools] = await Promise.all([hookRead, toolRead]);
    return { hooks, tools };
  }, [listHooks, listTools]);

  const finishHookMutation = useCallback(async (cwd, requestedDigest, receipt) => {
    const receiptView = {
      digest: typeof receipt?.digest === "string" ? receipt.digest : null,
      trusted: typeof receipt?.trusted === "boolean" ? receipt.trusted : null,
      relisted: null,
    };
    if (mountedRef.current && !hooksUnavailableRef.current) {
      setHookReceiptByDigest((current) => ({
        ...current,
        [requestedDigest]: receiptView,
      }));
    }
    const relisted = await listHooks(cwd);
    if (mountedRef.current && !hooksUnavailableRef.current) {
      setHookReceiptByDigest((current) => ({
        ...current,
        [requestedDigest]: { ...receiptView, relisted: relisted != null },
      }));
    }
    return receipt;
  }, [listHooks]);

  const trust = useCallback(async (cwd, digest) => {
    if (!enabled || typeof cwd !== "string" || cwd.length === 0
      || typeof digest !== "string" || hooksUnavailableRef.current) return null;
    if (mountedRef.current) {
      setHookPendingByDigest((current) => pendingFlag(current, digest, "trust"));
      setHookError("");
    }
    try {
      const receipt = await invoke("hooks_trust", trustArgs(digest));
      return await finishHookMutation(cwd, digest, receipt);
    } catch (thrown) {
      settleHookError(thrown, "Unable to trust the published hook digest.");
      return null;
    } finally {
      if (mountedRef.current) {
        setHookPendingByDigest((current) => pendingFlag(current, digest, null));
      }
    }
  }, [enabled, finishHookMutation, settleHookError]);

  const revoke = useCallback(async (cwd, digest) => {
    if (!enabled || typeof cwd !== "string" || cwd.length === 0
      || typeof digest !== "string" || hooksUnavailableRef.current) return null;
    if (mountedRef.current) {
      setHookPendingByDigest((current) => pendingFlag(current, digest, "revoke"));
      setHookError("");
    }
    try {
      const receipt = await invoke("hooks_revoke", trustArgs(digest));
      return await finishHookMutation(cwd, digest, receipt);
    } catch (thrown) {
      settleHookError(thrown, "Unable to revoke the published hook digest.");
      return null;
    } finally {
      if (mountedRef.current) {
        setHookPendingByDigest((current) => pendingFlag(current, digest, null));
      }
    }
  }, [enabled, finishHookMutation, settleHookError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    hooksByCwd,
    toolsBySession,
    hookReceiptByDigest,
    hookPendingByDigest,
    hookLoading,
    toolLoading,
    hookError,
    toolError,
    hooksUnavailable,
    toolsUnavailable,
    listHooks,
    listTools,
    load,
    trust,
    revoke,
  };
}

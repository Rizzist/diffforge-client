import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  addArgs,
  profileRowView,
  scopeView,
  sshUnavailableFromError,
  testOutcomeView,
  updateArgs,
} from "./sshProfileModel.js";

/* AppShell-owned SDK seam for daemon SSH profile management. All six
   commands live here. Rows change only after an authoritative list; add,
   update, remove, and scope receipts land before that re-list. */

function keyedFlag(current, key, value) {
  const next = { ...current };
  if (value) next[key] = true;
  else delete next[key];
  return next;
}

function clearOnce(callback) {
  let cleared = false;
  return () => {
    if (cleared) return;
    cleared = true;
    try {
      callback?.();
    } catch {
      // Secret state clearing is best-effort across an unmounting caller.
    }
  };
}

function receiptName(action, receipt) {
  if (action === "remove") return typeof receipt === "string" ? receipt : null;
  return profileRowView(receipt).name;
}

export function invalidateTestOutcomeForMutation(current, action, receipt) {
  const name = receiptName(action, receipt);
  if (typeof name !== "string" || !name) return current;
  let next = current;
  for (const [sessionId, outcomes] of Object.entries(current)) {
    if (!outcomes || !Object.hasOwn(outcomes, name)) continue;
    if (next === current) next = { ...current };
    const remaining = { ...outcomes };
    delete remaining[name];
    next[sessionId] = remaining;
  }
  return next;
}

export function useSshProfiles({ enabled = true } = {}) {
  /* Missing session key = registry unread. Present [] = daemon-published
     empty registry. Tests and scopes are also absent until their receipts. */
  const [bySession, setBySession] = useState({});
  const [testBySession, setTestBySession] = useState({});
  const [scopeReceiptBySession, setScopeReceiptBySession] = useState({});
  const [mutationReceiptBySession, setMutationReceiptBySession] = useState({});
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [updatingByName, setUpdatingByName] = useState({});
  const [removingByName, setRemovingByName] = useState({});
  const [testingByName, setTestingByName] = useState({});
  const [settingScopeBySession, setSettingScopeBySession] = useState({});
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

  /* SSH errors are deliberately rendered as fixed client copy. Even if an
     older transport echoes request material, it never enters panel state. */
  const settleError = useCallback((thrown, fallback) => {
    if (sshUnavailableFromError(thrown)) {
      markUnavailable();
      return "unavailable";
    }
    if (unavailableRef.current) return "unavailable";
    if (mountedRef.current) setError(fallback);
    return "error";
  }, [markUnavailable]);

  const list = useCallback(async (sessionId) => {
    if (!enabled || !sessionId || unavailableRef.current) return null;
    beginRead();
    if (mountedRef.current) setError("");
    try {
      const result = await invoke("ssh_list", { session_id: sessionId });
      if (!Array.isArray(result?.profiles)) {
        throw new Error("SSH profile list did not publish a profiles array.");
      }
      const rows = result.profiles.map(profileRowView);
      if (mountedRef.current && !unavailableRef.current) {
        setBySession((current) => ({ ...current, [sessionId]: rows }));
      }
      return rows;
    } catch (thrown) {
      settleError(thrown, "Unable to read SSH profiles from the daemon.");
      return null;
    } finally {
      endRead();
    }
  }, [beginRead, enabled, endRead, settleError]);

  const finishMutation = useCallback(async (sessionId, action, receipt) => {
    const published = {
      action,
      name: receiptName(action, receipt),
      relisted: null,
    };
    if (mountedRef.current && !unavailableRef.current) {
      setTestBySession((current) => (
        invalidateTestOutcomeForMutation(current, action, receipt)
      ));
      setMutationReceiptBySession((current) => ({
        ...current,
        [sessionId]: published,
      }));
    }
    const relisted = await list(sessionId);
    if (mountedRef.current && !unavailableRef.current) {
      setMutationReceiptBySession((current) => ({
        ...current,
        [sessionId]: { ...published, relisted: relisted != null },
      }));
    }
    return receipt;
  }, [list]);

  const add = useCallback(async (sessionId, profile, clearSecrets) => {
    const clearSubmittedSecrets = clearOnce(clearSecrets);
    if (!enabled || !sessionId || !profile || unavailableRef.current) {
      clearSubmittedSecrets();
      return null;
    }
    if (mountedRef.current) {
      setAdding(true);
      setError("");
    }
    try {
      const request = invoke("ssh_add", addArgs(profile));
      profile = null;
      clearSubmittedSecrets();
      const receipt = await request;
      return await finishMutation(sessionId, "add", receipt);
    } catch (thrown) {
      settleError(thrown, "Unable to add the SSH profile.");
      return null;
    } finally {
      profile = null;
      clearSubmittedSecrets();
      if (mountedRef.current) setAdding(false);
    }
  }, [enabled, finishMutation, settleError]);

  const update = useCallback(async (sessionId, name, changes, clearSecrets) => {
    const clearSubmittedSecrets = clearOnce(clearSecrets);
    if (!enabled || !sessionId || typeof name !== "string" || !name
      || !changes || unavailableRef.current) {
      clearSubmittedSecrets();
      return null;
    }
    if (mountedRef.current) {
      setUpdatingByName((current) => keyedFlag(current, name, true));
      setError("");
    }
    try {
      const request = invoke("ssh_update", updateArgs(name, changes));
      changes = null;
      clearSubmittedSecrets();
      const receipt = await request;
      return await finishMutation(sessionId, "update", receipt);
    } catch (thrown) {
      settleError(thrown, "Unable to update the SSH profile.");
      return null;
    } finally {
      changes = null;
      clearSubmittedSecrets();
      if (mountedRef.current) {
        setUpdatingByName((current) => keyedFlag(current, name, false));
      }
    }
  }, [enabled, finishMutation, settleError]);

  const remove = useCallback(async (sessionId, name) => {
    if (!enabled || !sessionId || typeof name !== "string" || !name
      || unavailableRef.current) return null;
    if (mountedRef.current) {
      setRemovingByName((current) => keyedFlag(current, name, true));
      setError("");
    }
    try {
      const receipt = await invoke("ssh_remove", { name });
      return await finishMutation(sessionId, "remove", receipt);
    } catch (thrown) {
      settleError(thrown, "Unable to remove the SSH profile.");
      return null;
    } finally {
      if (mountedRef.current) {
        setRemovingByName((current) => keyedFlag(current, name, false));
      }
    }
  }, [enabled, finishMutation, settleError]);

  const test = useCallback(async (sessionId, name, timeoutS) => {
    if (!enabled || !sessionId || typeof name !== "string" || !name
      || unavailableRef.current) return null;
    const args = { name };
    if (Number.isInteger(timeoutS) && timeoutS >= 0) args.timeout_s = timeoutS;
    if (mountedRef.current) {
      setTestingByName((current) => keyedFlag(current, name, true));
      setError("");
    }
    try {
      const view = testOutcomeView(await invoke("ssh_test", args));
      if (mountedRef.current && !unavailableRef.current) {
        setTestBySession((current) => ({
          ...current,
          [sessionId]: { ...(current[sessionId] || {}), [name]: view },
        }));
      }
      return view;
    } catch (thrown) {
      settleError(thrown, "Unable to test SSH profile reachability.");
      return null;
    } finally {
      if (mountedRef.current) {
        setTestingByName((current) => keyedFlag(current, name, false));
      }
    }
  }, [enabled, settleError]);

  const setSessionScope = useCallback(async (sessionId, scope) => {
    if (!enabled || !sessionId || !scope || unavailableRef.current) return null;
    if (mountedRef.current) {
      setSettingScopeBySession((current) => keyedFlag(current, sessionId, true));
      setError("");
    }
    try {
      const receipt = await invoke("ssh_set_session_scope", {
        session_id: sessionId,
        scope,
      });
      const published = {
        sessionId: typeof receipt?.session_id === "string" ? receipt.session_id : null,
        scope: scopeView(receipt?.scope),
        relisted: null,
      };
      if (mountedRef.current && !unavailableRef.current) {
        setScopeReceiptBySession((current) => ({
          ...current,
          [sessionId]: published,
        }));
      }
      const relisted = await list(sessionId);
      if (mountedRef.current && !unavailableRef.current) {
        setScopeReceiptBySession((current) => ({
          ...current,
          [sessionId]: { ...published, relisted: relisted != null },
        }));
      }
      return receipt;
    } catch (thrown) {
      settleError(thrown, "Unable to set the session SSH scope.");
      return null;
    } finally {
      if (mountedRef.current) {
        setSettingScopeBySession((current) => keyedFlag(current, sessionId, false));
      }
    }
  }, [enabled, list, settleError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    bySession,
    testBySession,
    scopeReceiptBySession,
    mutationReceiptBySession,
    loading,
    adding,
    updatingByName,
    removingByName,
    testingByName,
    settingScopeBySession,
    error,
    unavailable,
    list,
    add,
    update,
    remove,
    test,
    setSessionScope,
  };
}

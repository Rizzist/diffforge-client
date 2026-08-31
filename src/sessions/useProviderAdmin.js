import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  configureArgs,
  conflictView,
  fenceFor,
  lockdownView,
  providerAdminUnavailableFromError,
} from "./providerAdminModel.js";

/* AppShell-owned command boundary for provider administration. The existing
   haider_library_snapshot reader is injected by SessionSurface, so this hook
   owns exactly the five new SDK invokes and never opens a second provider
   list door. Configure, remove, and lockdown settle unavailable separately. */

const PROVIDER_TRUST_VALUES = new Set(["full", "lockdown"]);
const DECIMAL_REVISION = /^\d+$/;

function keyedValue(current, key, value) {
  const next = { ...current };
  if (value) next[key] = value;
  else delete next[key];
  return next;
}

function errorText(thrown, fallback) {
  return String(thrown?.message ?? thrown ?? fallback);
}

function providerNamesFromSnapshot(snapshot) {
  if (!Array.isArray(snapshot?.providers)) return [];
  return [...new Set(snapshot.providers
    .map((row) => (typeof row?.provider === "string" ? row.provider : ""))
    .filter(Boolean))];
}

function revisionFromSnapshot(snapshot) {
  if (!Array.isArray(snapshot?.providers)) return undefined;
  const revision = snapshot?.provider_revision;
  return typeof revision === "string" && DECIMAL_REVISION.test(revision)
    ? revision
    : undefined;
}

/* A conflict is a client-side stop sign, not a retry hint. A successful
   authority read replaces the held fence with the exact decimal string it
   published; conflict coordinates are never used as replacement authority. */
export function createProviderConflictGate() {
  const conflicted = new Set();
  const heldRevisions = new Map();
  return {
    completeAuthorityRead(snapshot, releaseConflicts = false) {
      const revision = revisionFromSnapshot(snapshot);
      if (revision === undefined) return false;
      const providers = new Set([
        ...heldRevisions.keys(),
        ...providerNamesFromSnapshot(snapshot),
      ]);
      for (const provider of providers) {
        if (!conflicted.has(provider)) heldRevisions.set(provider, revision);
      }
      if (releaseConflicts) {
        for (const provider of conflicted) heldRevisions.set(provider, revision);
        conflicted.clear();
      }
      return true;
    },
    conflictedProviders() {
      return [...conflicted];
    },
    fenceBlockReason(provider, expectedRevision) {
      if (conflicted.has(provider)) return "conflicted";
      if (typeof expectedRevision !== "string" || !DECIMAL_REVISION.test(expectedRevision)) {
        return "invalid_revision";
      }
      const heldRevision = heldRevisions.get(provider);
      return heldRevision !== undefined && expectedRevision !== heldRevision
        ? "stale_revision"
        : null;
    },
    heldRevision(provider) {
      return heldRevisions.get(provider);
    },
    markConflicted(provider) {
      if (typeof provider !== "string" || provider.length === 0) return;
      conflicted.add(provider);
    },
  };
}

export function useProviderAdmin({ enabled = true, invokeCommand = invoke } = {}) {
  const [lockdownByProvider, setLockdownByProvider] = useState({});
  const [globalLockdown, setGlobalLockdown] = useState(undefined);
  const [lastReceipt, setLastReceipt] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [configurePending, setConfigurePending] = useState(false);
  const [removePendingByProvider, setRemovePendingByProvider] = useState({});
  const [trustPendingByProvider, setTrustPendingByProvider] = useState({});
  const [quotaPending, setQuotaPending] = useState(false);
  const [lockdownLoading, setLockdownLoading] = useState(false);
  const [configureError, setConfigureError] = useState("");
  const [removeError, setRemoveError] = useState("");
  const [lockdownError, setLockdownError] = useState("");
  const [configureUnavailable, setConfigureUnavailable] = useState(false);
  const [removeUnavailable, setRemoveUnavailable] = useState(false);
  const [lockdownUnavailable, setLockdownUnavailable] = useState(false);

  const mountedRef = useRef(true);
  const configureUnavailableRef = useRef(false);
  const removeUnavailableRef = useRef(false);
  const lockdownUnavailableRef = useRef(false);
  const lockdownReadsRef = useRef(0);
  const configurePendingRef = useRef(false);
  const removePendingRef = useRef(new Set());
  const trustPendingRef = useRef(new Set());
  const quotaPendingRef = useRef(false);
  const conflictGateRef = useRef(null);
  if (conflictGateRef.current === null) {
    conflictGateRef.current = createProviderConflictGate();
  }

  const markConflict = useCallback((action, provider, decoded) => {
    conflictGateRef.current.markConflicted(provider);
    if (!mountedRef.current) return;
    setConflict({
      action,
      provider,
      ...decoded,
      conflictedProviders: conflictGateRef.current.conflictedProviders(),
    });
  }, []);

  const fencedMutationAllowed = useCallback((feature, provider, expectedRevision) => {
    const reason = conflictGateRef.current.fenceBlockReason(provider, expectedRevision);
    if (reason === null) return true;
    if (!mountedRef.current) return false;
    const message = reason === "conflicted"
      ? `${provider} has a revision conflict; re-read required before any fenced mutation.`
      : reason === "stale_revision"
        ? `${provider} is still holding a stale revision; use the freshly re-read provider row.`
        : `${provider} requires an unchanged decimal-string revision from provider authority.`;
    if (feature === "configure") setConfigureError(message);
    else if (feature === "remove") setRemoveError(message);
    else setLockdownError(message);
    return false;
  }, []);

  const markConfigureUnavailable = useCallback(() => {
    if (configureUnavailableRef.current) return;
    configureUnavailableRef.current = true;
    if (!mountedRef.current) return;
    setConfigureUnavailable(true);
    setConfigureError("");
  }, []);
  const markRemoveUnavailable = useCallback(() => {
    if (removeUnavailableRef.current) return;
    removeUnavailableRef.current = true;
    if (!mountedRef.current) return;
    setRemoveUnavailable(true);
    setRemoveError("");
  }, []);
  const markLockdownUnavailable = useCallback(() => {
    if (lockdownUnavailableRef.current) return;
    lockdownUnavailableRef.current = true;
    if (!mountedRef.current) return;
    setLockdownUnavailable(true);
    setLockdownError("");
  }, []);

  const settleError = useCallback((feature, thrown, fallback, action, provider) => {
    if (providerAdminUnavailableFromError(thrown)) {
      if (feature === "configure") markConfigureUnavailable();
      else if (feature === "remove") markRemoveUnavailable();
      else markLockdownUnavailable();
      return "unavailable";
    }
    const decoded = conflictView(thrown);
    if (decoded) {
      markConflict(action, provider, decoded);
      return "conflict";
    }
    if (!mountedRef.current) return "error";
    const message = errorText(thrown, fallback);
    if (feature === "configure") setConfigureError(message);
    else if (feature === "remove") setRemoveError(message);
    else setLockdownError(message);
    return "error";
  }, [markConfigureUnavailable, markConflict, markLockdownUnavailable, markRemoveUnavailable]);

  const beginLockdownRead = useCallback(() => {
    lockdownReadsRef.current += 1;
    if (mountedRef.current) setLockdownLoading(true);
  }, []);
  const endLockdownRead = useCallback(() => {
    lockdownReadsRef.current = Math.max(0, lockdownReadsRef.current - 1);
    if (mountedRef.current && lockdownReadsRef.current === 0) setLockdownLoading(false);
  }, []);

  const readLockdown = useCallback(async (provider = undefined) => {
    if (!enabled || lockdownUnavailableRef.current) return null;
    const args = {};
    if (typeof provider === "string" && provider.length > 0) args.provider = provider;
    beginLockdownRead();
    if (mountedRef.current) setLockdownError("");
    try {
      const status = lockdownView(await invokeCommand("lockdown_status", args));
      if (mountedRef.current && !lockdownUnavailableRef.current) {
        if (typeof provider === "string" && provider.length > 0) {
          setLockdownByProvider((current) => ({ ...current, [provider]: status }));
        } else {
          setGlobalLockdown(status);
        }
      }
      return status;
    } catch (thrown) {
      settleError(
        "lockdown",
        thrown,
        "Unable to read daemon-published lockdown status.",
        "read_lockdown",
        provider,
      );
      return null;
    } finally {
      endLockdownRead();
    }
  }, [beginLockdownRead, enabled, endLockdownRead, invokeCommand, settleError]);

  const loadLockdown = useCallback(async (providers = []) => {
    if (!enabled || lockdownUnavailableRef.current) return null;
    const global = await readLockdown();
    if (lockdownUnavailableRef.current) return null;
    const names = [...new Set((Array.isArray(providers) ? providers : [])
      .filter((name) => typeof name === "string" && name.length > 0))];
    for (const name of names) {
      if (lockdownUnavailableRef.current) break;
      await readLockdown(name);
    }
    return global;
  }, [enabled, readLockdown]);

  const readAuthority = useCallback(async (readProviders, clearConflict = false) => {
    if (typeof readProviders !== "function") return null;
    const snapshot = await readProviders();
    if (!snapshot || typeof snapshot !== "object") return null;
    await loadLockdown(providerNamesFromSnapshot(snapshot));
    const acceptedRevision = conflictGateRef.current.completeAuthorityRead(snapshot, clearConflict);
    if (clearConflict && acceptedRevision && mountedRef.current) setConflict(null);
    return snapshot;
  }, [loadLockdown]);

  const load = useCallback(async (readProviders) => (
    readAuthority(readProviders)
  ), [readAuthority]);

  const reread = useCallback(async (readProviders) => (
    readAuthority(readProviders, true)
  ), [readAuthority]);

  const finishMutation = useCallback(async (action, provider, receipt, readProviders) => {
    const receiptView = { action, provider, receipt, relisted: null };
    if (mountedRef.current) setLastReceipt(receiptView);
    const snapshot = await load(readProviders);
    if (mountedRef.current) {
      setLastReceipt((current) => (
        current?.receipt === receipt
          ? { ...receiptView, relisted: snapshot != null }
          : current
      ));
    }
    return receipt;
  }, [load]);

  const configure = useCallback(async (mode, fields, readProviders) => {
    if (!enabled || configureUnavailableRef.current || configurePendingRef.current) return null;
    const args = configureArgs(mode, fields);
    const provider = typeof args.provider === "string" ? args.provider : "";
    if (!provider || typeof args.enabled !== "boolean" || !Array.isArray(args.models)
      || !Object.hasOwn(args, "expected_revision")) {
      if (mountedRef.current) {
        setConfigureError("Provider configuration requires published provider authority. Re-read before submitting.");
      }
      return null;
    }
    if (!fencedMutationAllowed("configure", provider, args.expected_revision)) return null;
    configurePendingRef.current = true;
    if (mountedRef.current) {
      setConfigurePending(true);
      setConfigureError("");
    }
    try {
      const receipt = await invokeCommand("provider_configure", args);
      const returnedConflict = conflictView(receipt);
      if (returnedConflict) {
        markConflict(mode, provider, returnedConflict);
        return null;
      }
      return await finishMutation(mode, provider, receipt, readProviders);
    } catch (thrown) {
      settleError(
        "configure",
        thrown,
        `Unable to ${mode === "create" ? "create" : "update"} provider ${provider}.`,
        mode,
        provider,
      );
      return null;
    } finally {
      configurePendingRef.current = false;
      if (mountedRef.current) setConfigurePending(false);
    }
  }, [enabled, fencedMutationAllowed, finishMutation, invokeCommand, markConflict, settleError]);

  const remove = useCallback(async (row, readProviders) => {
    const provider = typeof row?.name === "string" ? row.name : "";
    const expectedRevision = fenceFor(row);
    if (!enabled || removeUnavailableRef.current || !provider
      || removePendingRef.current.has(provider)) return null;
    if (expectedRevision === undefined) {
      if (mountedRef.current) {
        setRemoveError("Remove requires the revision from a provider row. Re-read provider authority first.");
      }
      return null;
    }
    if (!fencedMutationAllowed("remove", provider, expectedRevision)) return null;
    removePendingRef.current.add(provider);
    if (mountedRef.current) {
      setRemovePendingByProvider((current) => keyedValue(current, provider, true));
      setRemoveError("");
    }
    try {
      const receipt = await invokeCommand("provider_remove", {
        provider,
        expected_revision: expectedRevision,
      });
      const returnedConflict = conflictView(receipt);
      if (returnedConflict) {
        markConflict("remove", provider, returnedConflict);
        return null;
      }
      return await finishMutation("remove", provider, receipt, readProviders);
    } catch (thrown) {
      settleError("remove", thrown, `Unable to remove provider ${provider}.`, "remove", provider);
      return null;
    } finally {
      removePendingRef.current.delete(provider);
      if (mountedRef.current) {
        setRemovePendingByProvider((current) => keyedValue(current, provider, false));
      }
    }
  }, [enabled, fencedMutationAllowed, finishMutation, invokeCommand, markConflict, settleError]);

  const setTrust = useCallback(async (row, trust, readProviders) => {
    const provider = typeof row?.name === "string" ? row.name : "";
    const expectedRevision = fenceFor(row);
    if (!enabled || lockdownUnavailableRef.current || !provider
      || trustPendingRef.current.has(provider)) return null;
    if (!PROVIDER_TRUST_VALUES.has(trust)) {
      if (mountedRef.current) setLockdownError("Choose full or lockdown trust explicitly.");
      return null;
    }
    if (expectedRevision === undefined) {
      if (mountedRef.current) {
        setLockdownError("Trust changes require the revision from a provider row. Re-read provider authority first.");
      }
      return null;
    }
    if (!fencedMutationAllowed("lockdown", provider, expectedRevision)) return null;
    trustPendingRef.current.add(provider);
    if (mountedRef.current) {
      setTrustPendingByProvider((current) => keyedValue(current, provider, trust));
      setLockdownError("");
    }
    try {
      const receipt = await invokeCommand("provider_set_trust", {
        name: provider,
        trust,
        expected_revision: expectedRevision,
      });
      const returnedConflict = conflictView(receipt);
      if (returnedConflict) {
        markConflict("set_trust", provider, returnedConflict);
        return null;
      }
      return await finishMutation("set_trust", provider, receipt, readProviders);
    } catch (thrown) {
      settleError(
        "lockdown",
        thrown,
        `Unable to set ${provider} trust to ${trust}.`,
        "set_trust",
        provider,
      );
      return null;
    } finally {
      trustPendingRef.current.delete(provider);
      if (mountedRef.current) {
        setTrustPendingByProvider((current) => keyedValue(current, provider, null));
      }
    }
  }, [enabled, fencedMutationAllowed, finishMutation, invokeCommand, markConflict, settleError]);

  const setQuota = useCallback(async (bytes, readProviders) => {
    if (!enabled || lockdownUnavailableRef.current || quotaPendingRef.current) return null;
    if (!Number.isSafeInteger(bytes) || bytes < 0) {
      if (mountedRef.current) setLockdownError("Lockdown quota must be a non-negative safe integer of bytes.");
      return null;
    }
    quotaPendingRef.current = true;
    if (mountedRef.current) {
      setQuotaPending(true);
      setLockdownError("");
    }
    try {
      const receipt = await invokeCommand("lockdown_set_quota", { bytes });
      const status = lockdownView(receipt);
      if (mountedRef.current) setGlobalLockdown(status);
      return await finishMutation("set_quota", null, receipt, readProviders);
    } catch (thrown) {
      settleError(
        "lockdown",
        thrown,
        "Unable to set the daemon lockdown quota.",
        "set_quota",
        null,
      );
      return null;
    } finally {
      quotaPendingRef.current = false;
      if (mountedRef.current) setQuotaPending(false);
    }
  }, [enabled, finishMutation, invokeCommand, settleError]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    lockdownByProvider,
    globalLockdown,
    lastReceipt,
    conflict,
    configurePending,
    removePendingByProvider,
    trustPendingByProvider,
    quotaPending,
    lockdownLoading,
    configureError,
    removeError,
    lockdownError,
    configureUnavailable,
    removeUnavailable,
    lockdownUnavailable,
    readLockdown,
    loadLockdown,
    load,
    reread,
    configure,
    remove,
    setTrust,
    setQuota,
  };
}

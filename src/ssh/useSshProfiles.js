import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildSshSaveRequest,
  deleteSshProfile,
  listSshProfiles,
  saveSshProfile,
} from "./sshProfileContract.js";

function getErrorMessage(error, fallback) {
  if (!error) {
    return fallback;
  }
  if (typeof error === "string") {
    return error;
  }
  if (typeof error?.message === "string" && error.message) {
    return error.message;
  }
  return fallback;
}

// Shared SSH profile store used by both the Settings panel and the terminal
// client picker. `lazy` defers the first fetch until refresh() is called
// (the terminal picker only loads when its menu opens).
export function useSshProfiles(options = {}) {
  const { lazy = false } = options;
  const [profiles, setProfiles] = useState([]);
  const [status, setStatus] = useState(lazy ? "idle" : "loading");
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  const loadedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setStatus((current) => (current === "idle" ? "loading" : current === "ready" ? "refreshing" : "loading"));
    setError("");
    try {
      const next = await listSshProfiles();
      loadedRef.current = true;
      if (!mountedRef.current) {
        return next;
      }
      setProfiles(next);
      setStatus("ready");
      return next;
    } catch (loadError) {
      if (mountedRef.current) {
        setStatus("error");
        setError(getErrorMessage(loadError, "Unable to load SSH clients."));
      }
      return [];
    }
  }, []);

  useEffect(() => {
    if (lazy) {
      return;
    }
    void refresh();
  }, [lazy, refresh]);

  // Fetch once on demand (used when the picker menu opens).
  const ensureLoaded = useCallback(() => {
    if (loadedRef.current) {
      return;
    }
    void refresh();
  }, [refresh]);

  const save = useCallback(async (form) => {
    const { request, error: validationError } = buildSshSaveRequest(form);
    if (validationError) {
      return { ok: false, error: validationError };
    }
    try {
      const summary = await saveSshProfile(request);
      await refresh();
      return { ok: true, profile: summary };
    } catch (saveError) {
      return { ok: false, error: getErrorMessage(saveError, "Unable to save SSH client.") };
    }
  }, [refresh]);

  const remove = useCallback(async (profileId) => {
    try {
      await deleteSshProfile(profileId);
      await refresh();
      return { ok: true };
    } catch (removeError) {
      return { ok: false, error: getErrorMessage(removeError, "Unable to delete SSH client.") };
    }
  }, [refresh]);

  return {
    profiles,
    status,
    error,
    isLoading: status === "loading" || status === "refreshing",
    refresh,
    ensureLoaded,
    save,
    remove,
  };
}

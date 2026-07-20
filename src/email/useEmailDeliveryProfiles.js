import { useCallback, useEffect, useRef, useState } from "react";

import {
  buildEmailProfileSaveRequest,
  deleteEmailProfile,
  fetchEmailCapabilitySnapshot,
  listEmailProfiles,
  saveEmailProfile,
} from "./emailDeliveryContract.js";

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

// Store for the Email Delivery settings panel: sender profiles plus the
// device capability snapshot (credential-store health, journal health,
// runtime). Profiles never carry secrets — only has_secret.
export function useEmailDeliveryProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [capability, setCapability] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setStatus((current) => (current === "ready" ? "refreshing" : "loading"));
    setError("");
    try {
      const [nextProfiles, snapshot] = await Promise.all([
        listEmailProfiles(),
        fetchEmailCapabilitySnapshot().catch(() => null),
      ]);
      if (!mountedRef.current) {
        return nextProfiles;
      }
      setProfiles(nextProfiles);
      setCapability(snapshot);
      setStatus("ready");
      return nextProfiles;
    } catch (loadError) {
      if (mountedRef.current) {
        setStatus("error");
        setError(getErrorMessage(loadError, "Unable to load email sender profiles."));
      }
      return [];
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(async (form) => {
    const { request, error: validationError } = buildEmailProfileSaveRequest(form);
    if (validationError) {
      return { ok: false, error: validationError };
    }
    try {
      const result = await saveEmailProfile(request);
      await refresh();
      return { ok: true, profile: result?.profile || null };
    } catch (saveError) {
      return {
        ok: false,
        error: getErrorMessage(saveError, "Unable to save the sender profile."),
      };
    }
  }, [refresh]);

  const remove = useCallback(async (profileRef) => {
    try {
      await deleteEmailProfile(profileRef);
      await refresh();
      return { ok: true };
    } catch (removeError) {
      return {
        ok: false,
        error: getErrorMessage(removeError, "Unable to delete the sender profile."),
      };
    }
  }, [refresh]);

  return {
    profiles,
    capability,
    status,
    error,
    isLoading: status === "loading" || status === "refreshing",
    refresh,
    save,
    remove,
  };
}

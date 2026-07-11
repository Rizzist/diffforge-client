import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

const AUTH_STATE_CHANGED_EVENT = "desktop-auth-state-changed";
const AUTH_STATUS_VALUES = new Set(["authenticated", "checking", "exchanging", "signedOut", "waiting"]);

export const DEFAULT_AUTH_MESSAGE = "Sign in with your Diff Forge AI web account.";

const listeners = new Set();

function personalScope() {
  return {
    id: "personal",
    type: "personal",
    label: "Personal",
    teamId: null,
  };
}

function normalizeAccountScope() {
  return personalScope();
}

function accountScopeKey() {
  return "personal";
}

function normalizeAccountScopes() {
  return [personalScope()];
}

function normalizeAuthStatus(status, user) {
  const normalized = String(status || "").trim();
  if (normalized === "authenticated") {
    return user ? "authenticated" : "signedOut";
  }
  return AUTH_STATUS_VALUES.has(normalized) ? normalized : "signedOut";
}

function normalizeSnapshot(nextSnapshot = {}) {
  const user = nextSnapshot.user && typeof nextSnapshot.user === "object"
    ? nextSnapshot.user
    : null;
  const status = normalizeAuthStatus(nextSnapshot.status, user);
  const accountScopes = normalizeAccountScopes(nextSnapshot.accountScopes);
  const activeScope = normalizeAccountScope(nextSnapshot.activeScope);

  return {
    status,
    stage: String(nextSnapshot.stage || (status === "authenticated" ? "authenticated" : "idle")),
    message: String(nextSnapshot.message || DEFAULT_AUTH_MESSAGE),
    error: String(nextSnapshot.error || ""),
    user,
    activeScope: accountScopes.find((scope) => scope.id === activeScope.id) || activeScope,
    accountScopes,
    accountKey: String(nextSnapshot.accountKey || user?.id || user?.$id || user?.email || ""),
    entitlements: nextSnapshot.entitlements && typeof nextSnapshot.entitlements === "object"
      ? nextSnapshot.entitlements
      : {},
    billingStatus: nextSnapshot.billingStatus || null,
    version: Number(nextSnapshot.version || 0),
    updatedAtMs: Number(nextSnapshot.updatedAtMs || 0),
  };
}

let snapshot = normalizeSnapshot();
let authorityVersion = 0;
let nativeStarted = false;
let nativeStartPromise = null;
let nativeUnlisten = null;
// While true, the user explicitly chose "Continue Offline": keep the restored
// account authenticated and ignore the native bridge's offline signedOut churn
// until a real authenticated snapshot (a successful reconnect) arrives.
let offlineModeActive = false;

const OFFLINE_SESSION_STORAGE_KEY = "diffforge:auth:last-authenticated";

function persistAuthenticatedSnapshot(snap) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    if (snap && snap.status === "authenticated" && snap.user) {
      window.localStorage.setItem(
        OFFLINE_SESSION_STORAGE_KEY,
        JSON.stringify({
          user: snap.user,
          accountScopes: snap.accountScopes,
          activeScope: snap.activeScope,
          accountKey: snap.accountKey,
          entitlements: snap.entitlements,
          billingStatus: snap.billingStatus,
        }),
      );
    }
  } catch {
    // Best effort; offline restore just won't be available.
  }
}

function readPersistedAuthenticatedSnapshot() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(OFFLINE_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return parsed && parsed.user ? parsed : null;
  } catch {
    return null;
  }
}

function authAuthoritySignature(value) {
  const object = value && typeof value === "object" ? value : {};
  return `${String(object.status || "")}:${String(object.accountKey || "")}`;
}

function emitAuthChange(partial) {
  const nextSnapshot = normalizeSnapshot({
    ...snapshot,
    ...partial,
    version: Number(snapshot.version || 0) + 1,
  });
  if (authAuthoritySignature(nextSnapshot) !== authAuthoritySignature(snapshot)) {
    authorityVersion += 1;
  }
  snapshot = nextSnapshot;
  persistAuthenticatedSnapshot(snapshot);
  listeners.forEach((listener) => listener());
}

function applyNativeSnapshot(nextSnapshot) {
  const nextUpdatedAtMs = Number(nextSnapshot?.updatedAtMs || 0);
  const currentUpdatedAtMs = Number(snapshot.updatedAtMs || 0);
  if (nextUpdatedAtMs > 0 && currentUpdatedAtMs > 0 && nextUpdatedAtMs < currentUpdatedAtMs) {
    return snapshot;
  }
  const normalized = normalizeSnapshot(nextSnapshot);
  // Honor an explicit "Continue Offline": don't let the native bridge's offline
  // session-check churn knock the user back to the sign-in screen. A genuine
  // authenticated snapshot (reconnect succeeded) clears offline mode and wins.
  if (offlineModeActive) {
    if (normalized.status === "authenticated") {
      offlineModeActive = false;
    } else {
      return snapshot;
    }
  }
  // Value-identical snapshots (ignoring the churn counters) must be no-ops:
  // re-persisting to localStorage and waking every listener per redundant
  // native event is how auth-event feedback loops storm the whole app.
  const { version: _prevVersion, updatedAtMs: _prevUpdated, ...previousRest } = snapshot;
  const { version: _nextVersion, updatedAtMs: _nextUpdated, ...nextRest } = normalized;
  if (snapshotValuesEqual(previousRest, nextRest)) {
    // Keep the SAME object identity: replacing it here (even without waking
    // listeners) made useSyncExternalStore see a "changed" store on every
    // render pass and force another render — with the native bridge emitting
    // redundant auth events during session restore, that chained into a
    // full-shell render storm (~1,700+ commits/5s at boot). Only the internal
    // ordering counters advance, mutated in place; nothing consumes them
    // reactively.
    snapshot.version = Number(normalized.version || 0);
    snapshot.updatedAtMs = Number(normalized.updatedAtMs || 0);
    return snapshot;
  }
  if (authAuthoritySignature(normalized) !== authAuthoritySignature(snapshot)) {
    authorityVersion += 1;
  }
  snapshot = normalized;
  persistAuthenticatedSnapshot(snapshot);
  listeners.forEach((listener) => listener());
  return snapshot;
}

function snapshotValuesEqual(left, right) {
  try {
    return JSON.stringify(left || null) === JSON.stringify(right || null);
  } catch {
    return left === right;
  }
}

function normalizedAccountKey(value) {
  return String(value || "").trim();
}

async function refreshNativeSnapshot() {
  const nextSnapshot = await invoke("desktop_auth_snapshot_command");
  return applyNativeSnapshot(nextSnapshot);
}

function startNativeAuthBridge() {
  if (nativeStartPromise) {
    return nativeStartPromise;
  }

  nativeStartPromise = (async () => {
    if (!nativeStarted) {
      nativeStarted = true;
      try {
        nativeUnlisten = await listen(AUTH_STATE_CHANGED_EVENT, (event) => {
          applyNativeSnapshot(event.payload || {});
        });
      } catch (error) {
        emitAuthChange({
          error: error?.message || "Desktop auth listener is unavailable.",
        });
      }
    }

    return refreshNativeSnapshot();
  })();

  return nativeStartPromise;
}

function subscribe(listener) {
  listeners.add(listener);
  void startNativeAuthBridge();

  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

async function applyNativeCommand(command, payload = {}) {
  const result = await invoke(command, payload);
  return sanitizeNativeAuthResult(result);
}

function sanitizeNativeAuthResult(result) {
  if (!result || typeof result !== "object") {
    return result;
  }

  if (result.snapshot && typeof result.snapshot === "object") {
    const snapshotResult = applyNativeSnapshot(result.snapshot);
    const safeResult = { ...result };
    delete safeResult.session;
    delete safeResult.state;
    return {
      ...safeResult,
      snapshot: snapshotResult,
    };
  }

  return applyNativeSnapshot(result);
}

if (typeof window !== "undefined") {
  void startNativeAuthBridge();
  window.addEventListener("beforeunload", () => {
    if (typeof nativeUnlisten === "function") {
      nativeUnlisten();
      nativeUnlisten = null;
    }
  });
}

export function useAuthSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const authStore = {
  getSnapshot,
  getAuthorityVersion() {
    return authorityVersion;
  },
  refresh: refreshNativeSnapshot,
  async startLogin() {
    const result = await invoke("desktop_auth_start_login");
    return sanitizeNativeAuthResult(result);
  },
  async completeDeepLink(url) {
    const result = await invoke("desktop_auth_handle_deep_link", { url });
    return sanitizeNativeAuthResult(result);
  },
  async validateSession() {
    return applyNativeCommand("desktop_auth_validate_session");
  },
  async signOut() {
    return applyNativeCommand("desktop_auth_sign_out");
  },
  async applyBillingStatus(billingStatus, { expectedAccountKey = "" } = {}) {
    const expected = normalizedAccountKey(expectedAccountKey);
    if (expected && normalizedAccountKey(snapshot.accountKey) !== expected) {
      return snapshot;
    }
    if (snapshotValuesEqual(snapshot.billingStatus, billingStatus)) {
      return snapshot;
    }
    return applyNativeCommand("desktop_auth_apply_billing_status", {
      billing_status: billingStatus,
      expected_account_key: expected || null,
    });
  },
  getActiveScope() {
    return snapshot.activeScope || personalScope();
  },
  getAccountScopes() {
    return snapshot.accountScopes || [personalScope()];
  },
  // True only after at least one successful sign-in on this device (a saved
  // account snapshot exists) — gates the muted "Continue Offline" button.
  hasSavedOfflineSession() {
    return Boolean(readPersistedAuthenticatedSnapshot());
  },
  // Enter the app offline using the last signed-in account, ignoring the native
  // bridge's offline session-check until a real reconnect authenticates.
  continueOffline() {
    const saved = readPersistedAuthenticatedSnapshot();
    if (!saved) {
      return snapshot;
    }
    offlineModeActive = true;
    emitAuthChange({
      status: "authenticated",
      stage: "offline",
      message: "Offline mode. Using your last signed-in account; cloud sync is paused.",
      error: "",
      user: saved.user,
      accountScopes: saved.accountScopes,
      activeScope: saved.activeScope,
      accountKey: saved.accountKey,
      entitlements: saved.entitlements,
      billingStatus: saved.billingStatus,
    });
    return snapshot;
  },
  setChecking(message) {
    emitAuthChange({
      status: "checking",
      stage: "session_restore",
      message,
      error: "",
    });
  },
  setExchanging(message = "Finishing desktop sign in...") {
    emitAuthChange({
      status: "exchanging",
      stage: "session_exchange",
      message,
      error: "",
    });
  },
  setStage(stage, message) {
    emitAuthChange({
      stage,
      ...(typeof message === "string" ? { message } : {}),
    });
  },
  async setActiveScope(scope) {
    const normalizedScope = normalizeAccountScope(scope);
    if (accountScopeKey(snapshot.activeScope) === accountScopeKey(normalizedScope)) {
      return snapshot;
    }
    emitAuthChange({ activeScope: normalizedScope });
    return applyNativeCommand("desktop_auth_set_active_scope", { scope: normalizedScope });
  },
  setSignedOut({
    message = DEFAULT_AUTH_MESSAGE,
    error = "",
    clearSession = true,
    clearPending = false,
  } = {}) {
    const clearNativeSession = clearSession || clearPending;
    emitAuthChange({
      status: "signedOut",
      stage: "idle",
      message,
      error,
      user: clearNativeSession ? null : snapshot.user,
      activeScope: clearNativeSession ? personalScope() : snapshot.activeScope,
      accountScopes: clearNativeSession ? [personalScope()] : snapshot.accountScopes,
      accountKey: clearNativeSession ? "" : snapshot.accountKey,
      entitlements: clearNativeSession ? {} : snapshot.entitlements,
      billingStatus: clearNativeSession ? null : snapshot.billingStatus,
    });
    if (clearNativeSession) {
      offlineModeActive = false;
      try {
        window.localStorage?.removeItem(OFFLINE_SESSION_STORAGE_KEY);
      } catch {
        // ignore
      }
      void applyNativeCommand("desktop_auth_sign_out").catch(() => {});
    }
  },
  setMessage(message) {
    emitAuthChange({ message });
  },
  setError(error) {
    emitAuthChange({ error });
  },
};

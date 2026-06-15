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

function normalizeAccountScope(scope) {
  const raw = scope && typeof scope === "object" ? scope : {};
  const type = String(raw.type || raw.scopeType || "personal").trim().toLowerCase();
  const teamId = typeof raw.teamId === "string" ? raw.teamId.trim() : "";

  if (type === "team" && teamId) {
    return {
      id: raw.id || `team:${teamId}`,
      type: "team",
      label: String(raw.label || raw.team?.name || "Team").trim() || "Team",
      teamId,
      team: raw.team || null,
    };
  }

  return personalScope();
}

function accountScopeKey(scope) {
  const normalized = normalizeAccountScope(scope);
  return normalized.type === "team" && normalized.teamId
    ? `team:${normalized.teamId}`
    : "personal";
}

function normalizeAccountScopes(scopes) {
  const byId = new Map();
  [personalScope(), ...(Array.isArray(scopes) ? scopes : [])]
    .map(normalizeAccountScope)
    .forEach((scope) => byId.set(scope.id, scope));
  return Array.from(byId.values());
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
let nativeStarted = false;
let nativeStartPromise = null;
let nativeUnlisten = null;

function emitAuthChange(partial) {
  snapshot = normalizeSnapshot({
    ...snapshot,
    ...partial,
    version: Number(snapshot.version || 0) + 1,
  });
  listeners.forEach((listener) => listener());
}

function applyNativeSnapshot(nextSnapshot) {
  const nextUpdatedAtMs = Number(nextSnapshot?.updatedAtMs || 0);
  const currentUpdatedAtMs = Number(snapshot.updatedAtMs || 0);
  if (nextUpdatedAtMs > 0 && currentUpdatedAtMs > 0 && nextUpdatedAtMs < currentUpdatedAtMs) {
    return snapshot;
  }
  snapshot = normalizeSnapshot(nextSnapshot);
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
  async applyBillingStatus(billingStatus) {
    if (snapshotValuesEqual(snapshot.billingStatus, billingStatus)) {
      return snapshot;
    }
    return applyNativeCommand("desktop_auth_apply_billing_status", { billingStatus });
  },
  getActiveScope() {
    return snapshot.activeScope || personalScope();
  },
  getAccountScopes() {
    return snapshot.accountScopes || [personalScope()];
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

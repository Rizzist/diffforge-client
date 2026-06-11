import { useSyncExternalStore } from "react";

const SESSION_TOKEN_KEY = "diffforge.desktop.sessionToken";
const SESSION_USER_KEY = "diffforge.desktop.user";
const SESSION_SCOPE_KEY = "diffforge.desktop.accountScope";
const PENDING_STATE_KEY = "diffforge.desktop.pendingAuthState";
const AUTH_VALUE_PATTERN = /^[A-Za-z0-9_-]{24,192}$/;

export const DEFAULT_AUTH_MESSAGE = "Sign in with your Diff Forge AI web account.";

const listeners = new Set();

function canUseStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readStorageValue(key) {
  if (!canUseStorage()) {
    return "";
  }

  return window.localStorage.getItem(key) || "";
}

function writeStorageValue(key, value) {
  if (canUseStorage()) {
    window.localStorage.setItem(key, value);
  }
}

function removeStorageValue(key) {
  if (canUseStorage()) {
    window.localStorage.removeItem(key);
  }
}

export function isSafeAuthValue(value) {
  return typeof value === "string" && AUTH_VALUE_PATTERN.test(value);
}

function readStoredToken() {
  const token = readStorageValue(SESSION_TOKEN_KEY);

  return isSafeAuthValue(token) ? token : "";
}

function readPendingState() {
  const state = readStorageValue(PENDING_STATE_KEY);

  return isSafeAuthValue(state) ? state : "";
}

function readStoredUser() {
  try {
    const user = JSON.parse(readStorageValue(SESSION_USER_KEY) || "null");

    return user && typeof user === "object" ? user : null;
  } catch {
    return null;
  }
}

function personalScope() {
  return {
    id: "personal",
    type: "personal",
    label: "Personal",
    teamId: null,
  };
}

function normalizeAccountScopes(user) {
  const scopes = Array.isArray(user?.accountScopes)
    ? user.accountScopes
    : Array.isArray(user?.scopes)
      ? user.scopes
      : [];
  const normalized = scopes
    .map((scope) => {
      const type = String(scope?.type || scope?.scopeType || "personal").trim().toLowerCase();
      const teamId = typeof scope?.teamId === "string" ? scope.teamId.trim() : "";

      if (type === "team" && teamId) {
        return {
          id: `team:${teamId}`,
          type: "team",
          label: String(scope?.label || scope?.team?.name || "Team").trim() || "Team",
          teamId,
          team: scope?.team || null,
        };
      }

      return personalScope();
    });
  const byId = new Map();

  [personalScope(), ...normalized].forEach((scope) => {
    byId.set(scope.id, scope);
  });

  return Array.from(byId.values());
}

function normalizeAccountScope(value, user = readStoredUser()) {
  const raw = value && typeof value === "object" ? value : {};
  const type = String(raw.type || raw.scopeType || "personal").trim().toLowerCase();
  const teamId = typeof raw.teamId === "string" ? raw.teamId.trim() : "";
  const scopes = normalizeAccountScopes(user);

  if (type === "team" && teamId) {
    return scopes.find((scope) => scope.type === "team" && scope.teamId === teamId) || personalScope();
  }

  return personalScope();
}

function readStoredScope(user = readStoredUser()) {
  try {
    const scope = JSON.parse(readStorageValue(SESSION_SCOPE_KEY) || "null");

    return normalizeAccountScope(scope, user);
  } catch {
    return personalScope();
  }
}

let snapshot = {
  status: "signedOut",
  stage: "idle",
  message: DEFAULT_AUTH_MESSAGE,
  error: "",
  user: readStoredUser(),
  token: readStoredToken(),
  activeScope: readStoredScope(),
  pendingState: readPendingState(),
  version: 0,
};

function emitAuthChange(partial) {
  snapshot = {
    ...snapshot,
    ...partial,
    version: snapshot.version + 1,
  };

  listeners.forEach((listener) => listener());
}

function clearSessionStorage() {
  removeStorageValue(SESSION_TOKEN_KEY);
  removeStorageValue(SESSION_USER_KEY);
  removeStorageValue(SESSION_SCOPE_KEY);
}

function clearPendingStorage() {
  removeStorageValue(PENDING_STATE_KEY);
}

function persistSessionStorage(session) {
  if (!session?.token || !session?.user) {
    throw new Error("Desktop session is missing.");
  }

  writeStorageValue(SESSION_TOKEN_KEY, session.token);
  writeStorageValue(SESSION_USER_KEY, JSON.stringify(session.user));
  const activeScope = readStoredScope(session.user);
  writeStorageValue(SESSION_SCOPE_KEY, JSON.stringify(activeScope));

  return {
    activeScope,
    token: session.token,
    user: session.user,
  };
}

function subscribe(listener) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return snapshot;
}

function syncFromStorage() {
  const token = readStoredToken();
  const user = readStoredUser();
  const activeScope = readStoredScope(user);
  const pendingState = readPendingState();
  const next = {
    token,
    user,
    activeScope,
    pendingState,
  };

  if (snapshot.status === "authenticated" && !token) {
    next.status = "signedOut";
    next.stage = "idle";
    next.message = "Your desktop session expired. Sign in again with the web app.";
    next.error = "";
  }

  emitAuthChange(next);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if ([SESSION_TOKEN_KEY, SESSION_USER_KEY, SESSION_SCOPE_KEY, PENDING_STATE_KEY].includes(event.key)) {
      syncFromStorage();
    }
  });
}

export function useAuthSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const authStore = {
  getSnapshot,
  getToken() {
    return readStoredToken();
  },
  getPendingState() {
    return readPendingState();
  },
  getActiveScope() {
    return readStoredScope(readStoredUser());
  },
  getAccountScopes() {
    return normalizeAccountScopes(readStoredUser());
  },
  setChecking(message) {
    emitAuthChange({
      status: "signedOut",
      stage: "session_restore",
      message,
      error: "",
      user: readStoredUser(),
      token: readStoredToken(),
      activeScope: readStoredScope(),
      pendingState: readPendingState(),
    });
  },
  setWaiting(pendingState, message = "Finish sign in in your browser, then return here.") {
    writeStorageValue(PENDING_STATE_KEY, pendingState);
    emitAuthChange({
      status: "waiting",
      stage: "browser_handoff",
      message,
      error: "",
      pendingState,
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
  setAuthenticated(sessionUser, message) {
    const token = readStoredToken();
    const activeScope = readStoredScope(sessionUser);

    if (sessionUser && typeof sessionUser === "object") {
      writeStorageValue(SESSION_USER_KEY, JSON.stringify(sessionUser));
      writeStorageValue(SESSION_SCOPE_KEY, JSON.stringify(activeScope));
    }

    emitAuthChange({
      status: "authenticated",
      stage: "authenticated",
      message: message ?? snapshot.message,
      error: "",
      user: sessionUser,
      token,
      activeScope,
      pendingState: readPendingState(),
    });
  },
  saveAuthenticatedSession(session, message) {
    const persisted = persistSessionStorage(session);

    emitAuthChange({
      status: "authenticated",
      stage: "authenticated",
      message: message ?? snapshot.message,
      error: "",
      user: persisted.user,
      token: persisted.token,
      activeScope: persisted.activeScope,
      pendingState: readPendingState(),
    });
  },
  persistAuthenticatedSession(session) {
    return persistSessionStorage(session);
  },
  setActiveScope(scope) {
    const user = readStoredUser();
    const activeScope = normalizeAccountScope(scope, user);

    writeStorageValue(SESSION_SCOPE_KEY, JSON.stringify(activeScope));
    emitAuthChange({ activeScope });
  },
  setSignedOut({
    message = DEFAULT_AUTH_MESSAGE,
    error = "",
    clearSession = true,
    clearPending = false,
  } = {}) {
    if (clearSession) {
      clearSessionStorage();
    }

    if (clearPending) {
      clearPendingStorage();
    }

    emitAuthChange({
      status: "signedOut",
      stage: "idle",
      message,
      error,
      user: clearSession ? null : readStoredUser(),
      token: clearSession ? "" : readStoredToken(),
      activeScope: clearSession ? personalScope() : readStoredScope(),
      pendingState: clearPending ? "" : readPendingState(),
    });
  },
  clearPending() {
    clearPendingStorage();
    emitAuthChange({
      pendingState: "",
    });
  },
  clearSession() {
    clearSessionStorage();
    emitAuthChange({
      user: null,
      token: "",
      activeScope: personalScope(),
    });
  },
  setMessage(message) {
    emitAuthChange({ message });
  },
  setError(error) {
    emitAuthChange({ error });
  },
};

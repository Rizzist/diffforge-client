import { useSyncExternalStore } from "react";

const SESSION_TOKEN_KEY = "diffforge.desktop.sessionToken";
const SESSION_USER_KEY = "diffforge.desktop.user";
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

let snapshot = {
  status: "signedOut",
  message: DEFAULT_AUTH_MESSAGE,
  error: "",
  user: readStoredUser(),
  token: readStoredToken(),
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
}

function clearPendingStorage() {
  removeStorageValue(PENDING_STATE_KEY);
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
  const pendingState = readPendingState();
  const next = {
    token,
    user,
    pendingState,
  };

  if (snapshot.status === "authenticated" && !token) {
    next.status = "signedOut";
    next.message = "Your desktop session expired. Sign in again with the web app.";
    next.error = "";
  }

  emitAuthChange(next);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if ([SESSION_TOKEN_KEY, SESSION_USER_KEY, PENDING_STATE_KEY].includes(event.key)) {
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
  setChecking(message) {
    emitAuthChange({
      status: "signedOut",
      message,
      error: "",
      user: readStoredUser(),
      token: readStoredToken(),
      pendingState: readPendingState(),
    });
  },
  setWaiting(pendingState, message = "Finish sign in in your browser, then return here.") {
    writeStorageValue(PENDING_STATE_KEY, pendingState);
    emitAuthChange({
      status: "waiting",
      message,
      error: "",
      pendingState,
    });
  },
  setExchanging(message = "Finishing desktop sign in...") {
    emitAuthChange({
      status: "exchanging",
      message,
      error: "",
    });
  },
  setAuthenticated(sessionUser, message) {
    const token = readStoredToken();

    if (sessionUser && typeof sessionUser === "object") {
      writeStorageValue(SESSION_USER_KEY, JSON.stringify(sessionUser));
    }

    emitAuthChange({
      status: "authenticated",
      message: message ?? snapshot.message,
      error: "",
      user: sessionUser,
      token,
      pendingState: readPendingState(),
    });
  },
  saveAuthenticatedSession(session, message) {
    if (!session?.token || !session?.user) {
      throw new Error("Desktop session is missing.");
    }

    writeStorageValue(SESSION_TOKEN_KEY, session.token);
    writeStorageValue(SESSION_USER_KEY, JSON.stringify(session.user));
    emitAuthChange({
      status: "authenticated",
      message: message ?? snapshot.message,
      error: "",
      user: session.user,
      token: session.token,
      pendingState: readPendingState(),
    });
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
      message,
      error,
      user: clearSession ? null : readStoredUser(),
      token: clearSession ? "" : readStoredToken(),
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
    });
  },
  setMessage(message) {
    emitAuthChange({ message });
  },
  setError(error) {
    emitAuthChange({ error });
  },
};

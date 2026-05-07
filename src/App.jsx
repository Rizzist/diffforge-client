import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { createGlobalStyle, keyframes } from "styled-components";
import { Bolt } from "@styled-icons/material-rounded/Bolt";
import { CheckCircle } from "@styled-icons/material-rounded/CheckCircle";
import { Close } from "@styled-icons/material-rounded/Close";
import { CloudDone } from "@styled-icons/material-rounded/CloudDone";
import { Code } from "@styled-icons/material-rounded/Code";
import { CropSquare } from "@styled-icons/material-rounded/CropSquare";
import { ErrorOutline } from "@styled-icons/material-rounded/ErrorOutline";
import { Key } from "@styled-icons/material-rounded/Key";
import { Login } from "@styled-icons/material-rounded/Login";
import { Logout } from "@styled-icons/material-rounded/Logout";
import { Remove } from "@styled-icons/material-rounded/Remove";
import { OpenInBrowser } from "@styled-icons/material-rounded/OpenInBrowser";
import { Pending } from "@styled-icons/material-rounded/Pending";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { Settings } from "@styled-icons/material-rounded/Settings";
import { SmartToy } from "@styled-icons/material-rounded/SmartToy";
import { Terminal as TerminalIcon } from "@styled-icons/material-rounded/Terminal";
import { authStore, DEFAULT_AUTH_MESSAGE, isSafeAuthValue, useAuthSnapshot } from "./authStore";

const WEB_LOGIN_URL = "https://diffforge.ai/desktop/login";
const PRICING_URL = "https://diffforge.ai/pricing";
const BRAND_NAME = "Diff Forge AI";
const TITLE_BAR_HEIGHT = "34px";
const LAUNCH_MINIMUM_MS = 1400;
const WORKSPACE_INIT_MS = 1800;
const AUTH_STARTUP_TIMEOUT_MS = 5000;
const DEEP_LINK_STARTUP_TIMEOUT_MS = 1000;
const SESSION_RESTORE_TIMEOUT_MS = 5000;
const SESSION_RESTORE_TIMEOUT_MESSAGE = "Secure session check timed out after 5 seconds.";
const AUTH_EXCHANGE_TIMEOUT_MS = 10000;
const AUTH_EXCHANGE_TIMEOUT_MESSAGE = "Desktop sign in timed out. Try again.";
const OPEN_BROWSER_TIMEOUT_MS = 5000;
const BACKEND_HELLO_TIMEOUT_MS = 5000;
const BACKEND_HELLO_TIMEOUT_MESSAGE = "Diff Forge API check timed out.";
const PLAN_REFRESH_TIMEOUT_MS = 5000;
const LOGOUT_TIMEOUT_MS = 5000;
const VIEW_TRANSITION_MS = 170;
const AUTH_STEPS = ["Browser sign in", "State match", "Desktop session"];
const AGENT_PROVIDERS = [
  { id: "codex", label: "Codex", shortLabel: "Codex" },
  { id: "claude", label: "Claude Code", shortLabel: "Claude" },
];
const AGENT_INSTALL_GUIDES = {
  codex: {
    nativeInstallUrl: "https://github.com/openai/codex/releases/latest",
    nativeInstallLabel: "GitHub release binaries",
    installCommand: "npm install -g @openai/codex",
  },
  claude: {
    nativeInstallUrl: "https://code.claude.com/docs/en/quickstart",
    nativeInstallLabel: "Native install guide",
    installCommand: "npm install -g @anthropic-ai/claude-code",
  },
};
const DEFAULT_AGENT_STATUSES = AGENT_PROVIDERS.map((provider) => ({
  ...provider,
  binary: provider.id,
  installed: false,
  authenticated: false,
  version: "Not checked",
  authMessage: "Check local agent status.",
  installCommand: AGENT_INSTALL_GUIDES[provider.id].installCommand,
  nativeInstallUrl: AGENT_INSTALL_GUIDES[provider.id].nativeInstallUrl,
  nativeInstallLabel: AGENT_INSTALL_GUIDES[provider.id].nativeInstallLabel,
  npmAvailable: false,
  npmVersion: "Not checked",
  npmInstalled: false,
  npmPackageVersion: "Not checked",
  recommendNativeInstall: true,
  connectCommand: provider.id === "codex" ? "codex login" : "claude",
}));
const AUTH_TILE_SIZE = 40;
const AUTH_TILE_COLUMNS = 64;
const AUTH_TILE_ROWS = 24;
const AUTH_TILE_BURSTS = Array.from({ length: 156 }, (_, index) => {
  const col = (index * 9 + Math.floor(index / 4) * 5) % AUTH_TILE_COLUMNS;
  const row = (index * 7 + Math.floor(index / 6) * 4) % AUTH_TILE_ROWS;
  const delay = `${((index * 0.47) % 12).toFixed(1)}s`;
  const duration = `${(7.2 + (index % 8) * 0.48).toFixed(1)}s`;
  const peak = (0.2 + (index % 6) * 0.026).toFixed(3);

  return [col, row, delay, duration, peak];
});

function AuthSquareBackdrop() {
  return (
    <SquareField aria-hidden="true">
      {AUTH_TILE_BURSTS.map(([col, row, delay, duration, peak]) => (
        <SquarePulse
          key={`${col}-${row}-${delay}`}
          style={{
            "--left": `${col * AUTH_TILE_SIZE}px`,
            "--top": `${row * AUTH_TILE_SIZE}px`,
            "--delay": delay,
            "--duration": duration,
            "--peak": peak,
          }}
        />
      ))}
    </SquareField>
  );
}

function createAuthState() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);

  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function isPaidUser(sessionUser) {
  return sessionUser?.planStatus === "paid";
}

function parseAuthCallback(urlValue) {
  try {
    const url = new URL(urlValue);

    if (url.protocol !== "diffforge:" || url.hostname !== "auth" || url.pathname !== "/callback") {
      return null;
    }

    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";

    if (!isSafeAuthValue(code) || !isSafeAuthValue(state)) {
      return null;
    }

    return { code, state };
  } catch {
    return null;
  }
}

function getErrorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function isDesktopSessionExpiredError(error) {
  const message = getErrorMessage(error, "").toLowerCase();

  return (
    message.includes("desktop session expired")
    || message.includes("session expired")
    || message.includes("invalid desktop session")
    || message.includes("unauthorized")
    || message.includes("forbidden")
  );
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(message));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function runWindowAction(action) {
  action().catch(() => {
    // Window controls are best-effort; failed actions should not break app state.
  });
}

function getAgentTone(agent) {
  if (!agent?.installed) {
    return "offline";
  }

  return agent.authenticated ? "ready" : "needsAuth";
}

export default function App() {
  const {
    status: authState,
    message: authMessage,
    error: authError,
    user,
  } = useAuthSnapshot();
  const [apiState, setApiState] = useState("checking");
  const [apiMessage, setApiMessage] = useState("Checking connection");
  const [activeView, setActiveView] = useState("dashboard");
  const [visibleView, setVisibleView] = useState("dashboard");
  const [viewMotion, setViewMotion] = useState("entered");
  const [activeAgent, setActiveAgent] = useState("codex");
  const [agentStatuses, setAgentStatuses] = useState(DEFAULT_AGENT_STATUSES);
  const [agentStatusState, setAgentStatusState] = useState("idle");
  const [agentStatusError, setAgentStatusError] = useState("");
  const [agentInstallState, setAgentInstallState] = useState({});
  const [agentInstallResults, setAgentInstallResults] = useState({});
  const [agentDisconnectState, setAgentDisconnectState] = useState({});
  const [agentActionResults, setAgentActionResults] = useState({});
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState("");
  const [workspaceSyncState, setWorkspaceSyncState] = useState("idle");
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isLaunchScreenVisible, setLaunchScreenVisible] = useState(true);
  const [workspaceState, setWorkspaceState] = useState("idle");
  const authStartupFinishedRef = useRef(false);
  const authFlowIdRef = useRef(0);
  const launchStartedAtRef = useRef(Date.now());
  const viewTransitionTimeoutRef = useRef(null);
  const agentInitialStatusUserRef = useRef("");

  const setSignedOut = useCallback((
    message = DEFAULT_AUTH_MESSAGE,
    error = "",
    options = {},
  ) => {
    authStore.setSignedOut({
      message,
      error,
      clearSession: options.clearSession !== false,
      clearPending: options.clearPending === true,
    });
    setActiveView("dashboard");
    setVisibleView("dashboard");
    setViewMotion("entered");
    setWorkspaceState("idle");
    setWorkspaces([]);
    setActiveWorkspaceId("");
    setWorkspaceSyncState("idle");
    setWorkspaceName("");
    agentInitialStatusUserRef.current = "";
    setWorkspaceError("");
  }, []);

  const setAuthenticated = useCallback((sessionUser) => {
    const isPaid = isPaidUser(sessionUser);

    authStore.setAuthenticated(
      sessionUser,
      isPaid ? "Initializing workspace..." : "Upgrade to unlock the desktop workspace.",
    );
    setActiveView("dashboard");
    setVisibleView("dashboard");
    setViewMotion("entered");
    setWorkspaceState(isPaid ? "initializing" : "billingRequired");
    setWorkspaceSyncState("idle");
    agentInitialStatusUserRef.current = "";
    setWorkspaceError("");
  }, []);

  const showView = useCallback((nextView) => {
    if (nextView === activeView && nextView === visibleView) {
      return;
    }

    window.clearTimeout(viewTransitionTimeoutRef.current);
    setActiveView(nextView);
    setViewMotion("exiting");

    viewTransitionTimeoutRef.current = window.setTimeout(() => {
      setVisibleView(nextView);
      window.requestAnimationFrame(() => {
        setViewMotion("entered");
      });
    }, VIEW_TRANSITION_MS);
  }, [activeView, visibleView]);

  const completeAuthStartup = useCallback(() => {
    if (authStartupFinishedRef.current) {
      return;
    }

    authStartupFinishedRef.current = true;
    setAuthInitialized(true);
  }, []);

  const checkBackend = useCallback(async () => {
    setApiState("checking");
    setApiMessage("Checking connection");

    try {
      await withTimeout(
        invoke("backend_ping"),
        BACKEND_HELLO_TIMEOUT_MS,
        BACKEND_HELLO_TIMEOUT_MESSAGE,
      );
      setApiState("online");
      setApiMessage("Diff Forge API online");
    } catch (error) {
      const errorMessage = getErrorMessage(error, BACKEND_HELLO_TIMEOUT_MESSAGE);
      setApiState("offline");
      setApiMessage(
        errorMessage === BACKEND_HELLO_TIMEOUT_MESSAGE
          ? "Connection check timed out. Check your internet connection."
          : "Unable to reach Diff Forge API. Check your internet connection.",
      );
    }
  }, []);

  const validateStoredSession = useCallback(async () => {
    const token = authStore.getToken();
    const validationFlowId = authFlowIdRef.current;

    if (!isSafeAuthValue(token)) {
      setSignedOut(DEFAULT_AUTH_MESSAGE, "", { clearPending: true });
      return;
    }

    authStore.setChecking("Checking saved desktop session. You can still sign in with the web app.");

    try {
      const session = await withTimeout(
        invoke("validate_desktop_session", { token }),
        SESSION_RESTORE_TIMEOUT_MS,
        SESSION_RESTORE_TIMEOUT_MESSAGE,
      );
      if (validationFlowId !== authFlowIdRef.current) {
        return;
      }

      setAuthenticated(session.user);
    } catch (error) {
      if (validationFlowId !== authFlowIdRef.current) {
        return;
      }

      const restoreError = getErrorMessage(error, "Unable to restore your desktop session.");
      const didTimeout = restoreError === SESSION_RESTORE_TIMEOUT_MESSAGE;
      setSignedOut(
        didTimeout
          ? "Secure session check timed out. Sign in with the web app."
          : "Your desktop session expired. Sign in again with the web app.",
        restoreError,
        { clearPending: true },
      );
    }
  }, [setAuthenticated, setSignedOut]);

  const completeDesktopLogin = useCallback(async (callbackUrl) => {
    const callback = parseAuthCallback(callbackUrl);

    if (!callback) {
      return false;
    }

    authFlowIdRef.current += 1;
    const loginFlowId = authFlowIdRef.current;
    const pendingState = authStore.getPendingState();

    if (!pendingState || callback.state !== pendingState) {
      setSignedOut(
        DEFAULT_AUTH_MESSAGE,
        "Desktop login state did not match. Start again from this app.",
        { clearPending: true },
      );
      return true;
    }

    authStore.setExchanging();

    try {
      const session = await withTimeout(
        invoke("exchange_desktop_auth_code", {
          code: callback.code,
          state: callback.state,
        }),
        AUTH_EXCHANGE_TIMEOUT_MS,
        AUTH_EXCHANGE_TIMEOUT_MESSAGE,
      );

      if (loginFlowId !== authFlowIdRef.current) {
        return true;
      }

      authStore.saveAuthenticatedSession(session);
      authStore.clearPending();
      setAuthenticated(session.user);
    } catch (error) {
      if (loginFlowId !== authFlowIdRef.current) {
        return true;
      }

      setSignedOut(
        DEFAULT_AUTH_MESSAGE,
        getErrorMessage(error, "Desktop login expired. Try again."),
        { clearPending: true },
      );
    }

    return true;
  }, [setAuthenticated, setSignedOut]);

  const startWebLogin = useCallback(async () => {
    authFlowIdRef.current += 1;
    const state = createAuthState();
    authStore.setWaiting(state);

    try {
      const loginUrl = `${WEB_LOGIN_URL}?state=${encodeURIComponent(state)}`;
      await withTimeout(
        openUrl(loginUrl),
        OPEN_BROWSER_TIMEOUT_MS,
        "Unable to open the web login.",
      );
    } catch (error) {
      setSignedOut(
        DEFAULT_AUTH_MESSAGE,
        getErrorMessage(error, "Unable to open the web login."),
        { clearSession: false, clearPending: true },
      );
    }
  }, [setSignedOut]);

  const openPricing = useCallback(async () => {
    try {
      await withTimeout(
        openUrl(PRICING_URL),
        OPEN_BROWSER_TIMEOUT_MS,
        "Unable to open pricing.",
      );
    } catch (error) {
      authStore.setError(getErrorMessage(error, "Unable to open pricing."));
    }
  }, []);

  const refreshSubscriptionStatus = useCallback(async () => {
    const token = authStore.getToken();
    const refreshFlowId = authFlowIdRef.current;

    if (!isSafeAuthValue(token)) {
      setSignedOut(DEFAULT_AUTH_MESSAGE, "", { clearPending: true });
      return;
    }

    authStore.setMessage("Checking plan status...");
    authStore.setError("");

    try {
      const session = await withTimeout(
        invoke("validate_desktop_session", { token }),
        PLAN_REFRESH_TIMEOUT_MS,
        "Plan status check timed out.",
      );
      if (refreshFlowId !== authFlowIdRef.current) {
        return;
      }

      setAuthenticated(session.user);
    } catch (error) {
      if (refreshFlowId !== authFlowIdRef.current) {
        return;
      }

      setSignedOut(
        "Your desktop session expired. Sign in again with the web app.",
        getErrorMessage(error, "Unable to refresh plan status."),
        { clearPending: true },
      );
    }
  }, [setAuthenticated, setSignedOut]);

  const refreshAgentStatuses = useCallback(async () => {
    setAgentStatusState("checking");
    setAgentStatusError("");

    try {
      const statuses = await invoke("agent_statuses");
      const statusMap = new Map(statuses.map((status) => [status.id, status]));
      setAgentStatuses(
        AGENT_PROVIDERS.map((provider) => ({
          ...DEFAULT_AGENT_STATUSES.find((status) => status.id === provider.id),
          ...provider,
          ...(statusMap.get(provider.id) || {}),
        })),
      );
      setAgentStatusState("idle");
    } catch (error) {
      setAgentStatusState("error");
      setAgentStatusError(getErrorMessage(error, "Unable to check local agents."));
    }
  }, []);

  const connectAgent = useCallback(async (provider) => {
    setAgentStatusState("checking");
    setAgentStatusError("");
    setAgentActionResults((results) => {
      const nextResults = { ...results };
      delete nextResults[provider];
      return nextResults;
    });

    try {
      await invoke("start_agent_login", { provider });
      setAgentStatusState("idle");
      setAgentActionResults((results) => ({
        ...results,
        [provider]: {
          tone: "neutral",
          message: "Opened login in a terminal. Use Recheck after the login completes.",
        },
      }));
    } catch (error) {
      setAgentStatusState("error");
      setAgentStatusError(getErrorMessage(error, "Unable to open local agent login."));
    }
  }, []);

  const disconnectAgent = useCallback(async (provider) => {
    setAgentDisconnectState((state) => ({ ...state, [provider]: "disconnecting" }));
    setAgentStatusError("");
    setAgentActionResults((results) => {
      const nextResults = { ...results };
      delete nextResults[provider];
      return nextResults;
    });

    try {
      const result = await invoke("disconnect_agent", { provider });
      setAgentActionResults((results) => ({
        ...results,
        [provider]: {
          tone: "warning",
          message: result?.message || `${result?.label || "Agent"} disconnected from this machine.`,
        },
      }));
      setAgentStatuses((statuses) => statuses.map((agent) => (
        agent.id === provider
          ? {
            ...agent,
            authenticated: false,
            authMessage: result?.message || `${agent.label} disconnected from this machine.`,
          }
          : agent
      )));
    } catch (error) {
      setAgentActionResults((results) => ({
        ...results,
        [provider]: {
          tone: "warning",
          message: getErrorMessage(error, "Unable to disconnect local agent."),
        },
      }));
    } finally {
      setAgentDisconnectState((state) => ({ ...state, [provider]: "idle" }));
    }
  }, []);

  const installAgentWithNpm = useCallback(async (provider) => {
    setAgentInstallState((state) => ({ ...state, [provider]: "installing" }));
    setAgentStatusError("");
    setAgentInstallResults((results) => {
      const nextResults = { ...results };
      delete nextResults[provider];
      return nextResults;
    });

    try {
      const result = await invoke("install_agent", { provider });
      setAgentInstallResults((results) => ({ ...results, [provider]: { ...result, source: "npm" } }));

      if (result?.installed) {
        await refreshAgentStatuses();
      }
    } catch (error) {
      setAgentInstallResults((results) => ({
        ...results,
        [provider]: {
          source: "npm",
          installed: false,
          permissionDenied: false,
          message: getErrorMessage(error, "Unable to install local agent."),
        },
      }));
    } finally {
      setAgentInstallState((state) => ({ ...state, [provider]: "idle" }));
    }
  }, [refreshAgentStatuses]);

  const openAgentNativeInstaller = useCallback(async (agent) => {
    const guide = AGENT_INSTALL_GUIDES[agent.id] || {};
    const nativeInstallUrl = agent.nativeInstallUrl || guide.nativeInstallUrl;

    if (!nativeInstallUrl) {
      setAgentInstallResults((results) => ({
        ...results,
        [agent.id]: {
          source: "native",
          installed: false,
          permissionDenied: false,
          message: "Native installer page is not configured.",
        },
      }));
      return;
    }

    try {
      await withTimeout(
        openUrl(nativeInstallUrl),
        OPEN_BROWSER_TIMEOUT_MS,
        "Unable to open native installer page.",
      );
      setAgentInstallResults((results) => ({
        ...results,
        [agent.id]: {
          source: "native",
          installed: false,
          permissionDenied: false,
          message: `Opened ${agent.nativeInstallLabel || guide.nativeInstallLabel}. Recheck after install finishes.`,
        },
      }));
    } catch (error) {
      setAgentInstallResults((results) => ({
        ...results,
        [agent.id]: {
          source: "native",
          installed: false,
          permissionDenied: false,
          message: getErrorMessage(error, "Unable to open native installer page."),
        },
      }));
    }
  }, []);

  const expireDesktopSession = useCallback((error) => {
    setSignedOut(
      "Your desktop session expired. Sign in again with the web app.",
      getErrorMessage(error, "Desktop session expired."),
      { clearPending: true },
    );
  }, [setSignedOut]);

  const loadWorkspaces = useCallback(async () => {
    const token = authStore.getToken();

    if (!isSafeAuthValue(token)) {
      expireDesktopSession("Desktop session required to load workspaces.");
      return;
    }

    setWorkspaceSyncState("loading");
    setWorkspaceError("");

    try {
      const result = await invoke("list_workspaces", { token });
      const nextWorkspaces = Array.isArray(result?.workspaces) ? result.workspaces : [];
      setWorkspaces(nextWorkspaces);

      if (nextWorkspaces.length === 0) {
        setActiveWorkspaceId("");
      } else {
        const nextActive = nextWorkspaces.find((workspace) => workspace.id === activeWorkspaceId) || nextWorkspaces[0];
        setActiveWorkspaceId(nextActive.id);
      }

      setWorkspaceSyncState("idle");
    } catch (error) {
      if (isDesktopSessionExpiredError(error)) {
        expireDesktopSession(error);
        return;
      }

      setWorkspaceSyncState("error");
      setWorkspaceError(getErrorMessage(error, "Unable to load workspaces."));
    }
  }, [activeWorkspaceId, expireDesktopSession]);

  const createFirstWorkspace = useCallback(async (event) => {
    event.preventDefault();

    const token = authStore.getToken();
    const name = workspaceName.trim();

    if (!isSafeAuthValue(token)) {
      expireDesktopSession("Desktop session required to create a workspace.");
      return;
    }

    if (!name) {
      setWorkspaceError("Name your first workspace.");
      return;
    }

    setWorkspaceSyncState("creating");
    setWorkspaceError("");

    try {
      const result = await invoke("create_workspace", {
        token,
        name,
      });
      const workspace = result?.workspace;

      if (!workspace) {
        throw new Error("Workspace was not returned by the API.");
      }

      setWorkspaces([workspace]);
      setActiveWorkspaceId(workspace.id);
      setWorkspaceName("");
      setWorkspaceSyncState("idle");
    } catch (error) {
      if (isDesktopSessionExpiredError(error)) {
        expireDesktopSession(error);
        return;
      }

      setWorkspaceSyncState("error");
      setWorkspaceError(getErrorMessage(error, "Unable to create workspace."));
    }
  }, [expireDesktopSession, workspaceName]);

  const logout = useCallback(async () => {
    authFlowIdRef.current += 1;
    const token = authStore.getToken();

    setSignedOut(DEFAULT_AUTH_MESSAGE, "", { clearPending: true });

    if (isSafeAuthValue(token)) {
      try {
        await withTimeout(
          invoke("logout_desktop_session", { token }),
          LOGOUT_TIMEOUT_MS,
          "Desktop sign out timed out.",
        );
      } catch {
        // Local session cleanup still wins if the remote revoke cannot complete.
      }
    }
  }, [setSignedOut]);

  const handleTitleBarMouseDown = useCallback((event) => {
    if (event.button !== 0 || event.target.closest("[data-window-control]")) {
      return;
    }

    if (event.detail === 2) {
      runWindowAction(() => getCurrentWindow().toggleMaximize());
      return;
    }

    runWindowAction(() => getCurrentWindow().startDragging());
  }, []);

  const minimizeWindow = useCallback((event) => {
    event.stopPropagation();
    runWindowAction(() => getCurrentWindow().minimize());
  }, []);

  const toggleMaximizeWindow = useCallback((event) => {
    event.stopPropagation();
    runWindowAction(() => getCurrentWindow().toggleMaximize());
  }, []);

  const closeWindow = useCallback((event) => {
    event.stopPropagation();
    runWindowAction(() => getCurrentWindow().close());
  }, []);

  useEffect(() => {
    checkBackend();
  }, [checkBackend]);

  useEffect(() => () => {
    window.clearTimeout(viewTransitionTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (authState === "authenticated") {
      return;
    }

    setWorkspaceState("idle");
    setWorkspaces([]);
    setActiveWorkspaceId("");
    setWorkspaceSyncState("idle");
    agentInitialStatusUserRef.current = "";
  }, [authState]);

  useEffect(() => {
    if (authInitialized) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      if (authStartupFinishedRef.current) {
        return;
      }

      authFlowIdRef.current += 1;
      setSignedOut(
        "Secure session check timed out. Sign in with the web app.",
        SESSION_RESTORE_TIMEOUT_MESSAGE,
        { clearPending: true },
      );
      completeAuthStartup();
    }, AUTH_STARTUP_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authInitialized, completeAuthStartup, setSignedOut]);

  useEffect(() => {
    let isMounted = true;
    let unlistenDeepLinks = null;

    onOpenUrl(async (urls) => {
      if (!isMounted) {
        return;
      }

      for (const url of urls) {
        const handled = await completeDesktopLogin(url);

        if (!isMounted || handled) {
          break;
        }
      }
    })
      .then((unlisten) => {
        if (!isMounted && typeof unlisten === "function") {
          unlisten();
          return;
        }

        unlistenDeepLinks = unlisten;
      })
      .catch((error) => {
        if (isMounted) {
          authStore.setError(getErrorMessage(error, "Desktop login callback listener is unavailable."));
        }
      });

    async function initializeAuth() {
      try {
        let startUrls = [];
        let handledDeepLink = false;

        try {
          startUrls = await withTimeout(
            getCurrent(),
            DEEP_LINK_STARTUP_TIMEOUT_MS,
            "Desktop startup link check timed out.",
          );
        } catch {
          startUrls = [];
        }

        if (!isMounted) {
          return;
        }

        if (Array.isArray(startUrls)) {
          for (const url of startUrls) {
            const handled = await completeDesktopLogin(url);
            handledDeepLink = handled || handledDeepLink;

            if (!isMounted || handled) {
              break;
            }
          }
        }

        if (!handledDeepLink && isMounted) {
          await validateStoredSession();
        }
      } catch (error) {
        if (isMounted && !authStartupFinishedRef.current) {
          authFlowIdRef.current += 1;
          setSignedOut(
            "Unable to restore your desktop session. Sign in with the web app.",
            getErrorMessage(error, "Desktop sign in is unavailable."),
            { clearPending: true },
          );
        }
      } finally {
        if (isMounted) {
          completeAuthStartup();
        }
      }
    }

    initializeAuth();

    return () => {
      isMounted = false;

      if (typeof unlistenDeepLinks === "function") {
        unlistenDeepLinks();
      }
    };
  }, [completeAuthStartup, completeDesktopLogin, setSignedOut, validateStoredSession]);

  useEffect(() => {
    if (!authInitialized) {
      return undefined;
    }

    const elapsed = Date.now() - launchStartedAtRef.current;
    const remaining = Math.max(350, LAUNCH_MINIMUM_MS - elapsed);
    const timeoutId = window.setTimeout(() => {
      setLaunchScreenVisible(false);
    }, remaining);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authInitialized]);

  useEffect(() => {
    if (authState !== "authenticated" || workspaceState !== "initializing" || isLaunchScreenVisible) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setWorkspaceState("ready");
      authStore.setMessage("Workspace ready.");
    }, WORKSPACE_INIT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authState, isLaunchScreenVisible, workspaceState]);

  useEffect(() => {
    if (authState === "authenticated" && isPaidUser(user) && workspaceState === "ready") {
      const userKey = user?.id || user?.email || "paid-user";

      if (agentInitialStatusUserRef.current !== userKey) {
        agentInitialStatusUserRef.current = userKey;
        refreshAgentStatuses();
      }

      loadWorkspaces();
    }
  }, [authState, loadWorkspaces, refreshAgentStatuses, user, workspaceState]);

  const isAuthBusy = authState === "waiting" || authState === "exchanging";
  const authPanelTitle = {
    waiting: "Waiting for web sign in",
    exchanging: "Finishing desktop sign in",
    signedOut: "Continue in browser",
  }[authState] || "Continue in browser";
  const authButtonLabel = {
    waiting: "Waiting...",
    exchanging: "Finishing...",
  }[authState] || "Sign in with web";
  const authStateLabel = {
    authenticated: "active",
    exchanging: "exchanging",
    signedOut: "ready",
    waiting: "waiting",
  }[authState] || "ready";
  const displayName = user?.name || user?.email || "there";
  const userIsPaid = isPaidUser(user);
  const planLabel = userIsPaid ? "Pro" : "Free";
  const connectedAgentCount = agentStatuses.filter((agent) => agent.installed && agent.authenticated).length;
  const shouldShowWorkspaceSetup = workspaceSyncState !== "loading" && workspaces.length === 0;
  const isConnectivityBlocked = authState !== "authenticated" && (apiState === "checking" || apiState === "offline");
  const shouldShowLaunchScreen = isLaunchScreenVisible || isConnectivityBlocked;
  const launchState = isConnectivityBlocked && apiState === "offline"
    ? "offline"
    : isConnectivityBlocked && apiState === "checking"
      ? "checking"
      : "loading";
  const launchStatus = launchState === "offline"
    ? "No internet connection"
    : launchState === "checking"
      ? "Checking connection..."
      : !authInitialized
        ? "Checking secure session..."
        : authState === "authenticated"
          ? "Preparing workspace..."
          : "Opening sign in...";
  const launchDetail = launchState === "offline"
    ? apiMessage
    : launchState === "checking"
      ? "Contacting the Diff Forge API before opening sign in."
      : !authInitialized
        ? "Validating this device before showing your workspace."
        : "Finishing the desktop handoff.";

  return (
    <>
      <GlobalStyle />
      <AppFrame>
        <WindowTitleBar data-tauri-drag-region onMouseDown={handleTitleBarMouseDown}>
          <WindowTitle data-tauri-drag-region>
            <img src="/logo.webp" alt="" />
            <span>{BRAND_NAME}</span>
          </WindowTitle>
          <WindowControls aria-label="Window controls">
            <WindowControlButton
              aria-label="Minimize"
              data-window-control
              onClick={minimizeWindow}
              title="Minimize"
              type="button"
            >
              <TitleMinimizeIcon aria-hidden="true" />
            </WindowControlButton>
            <WindowControlButton
              aria-label="Maximize"
              data-window-control
              onClick={toggleMaximizeWindow}
              title="Maximize"
              type="button"
            >
              <TitleMaximizeIcon aria-hidden="true" />
            </WindowControlButton>
            <WindowControlButton
              aria-label="Close"
              data-window-control
              data-variant="close"
              onClick={closeWindow}
              title="Close"
              type="button"
            >
              <TitleCloseIcon aria-hidden="true" />
            </WindowControlButton>
          </WindowControls>
        </WindowTitleBar>

        <AppContent>
          {shouldShowLaunchScreen ? (
            <SplashScreen aria-label={`${BRAND_NAME} is launching`} data-state={launchState}>
              <AmbientPanel data-position="left">
                <span>&gt; codex</span>
                <p>Analyzing codebase...</p>
                <p>Generating changes...</p>
              </AmbientPanel>
              <AmbientPanel data-position="right">
                <span>src/engine/runner.ts</span>
                <p>+ return output</p>
                <p>- return result</p>
              </AmbientPanel>
              <SplashCenter>
                <SplashLogo src="/logo.webp" alt="" />
                <SplashTitle>{BRAND_NAME}</SplashTitle>
                <SplashTagline>Manage Codex & Claude Code. Build faster.</SplashTagline>
                <LoadingTrack aria-hidden="true" data-state={launchState}>
                  {launchState !== "offline" && <LoadingFill />}
                </LoadingTrack>
                <LaunchStatusPanel data-state={launchState}>
                  <LaunchStatusIcon aria-hidden="true" data-state={launchState}>
                    {launchState === "offline" ? (
                      <ErrorIcon />
                    ) : launchState === "checking" ? (
                      <PendingIcon />
                    ) : (
                      <ConnectedIcon />
                    )}
                  </LaunchStatusIcon>
                  <LaunchStatusCopy>
                    <LoadingText>{launchStatus}</LoadingText>
                    <LoadingDetail>{launchDetail}</LoadingDetail>
                  </LaunchStatusCopy>
                </LaunchStatusPanel>
                {launchState === "offline" && (
                  <LaunchActions>
                    <SecondaryButton disabled={apiState === "checking"} onClick={checkBackend} type="button">
                      <ButtonRefreshIcon aria-hidden="true" />
                      <span>Retry connection</span>
                    </SecondaryButton>
                  </LaunchActions>
                )}
              </SplashCenter>
            </SplashScreen>
          ) : authState === "authenticated" && !userIsPaid ? (
            <PricingScreen aria-label="Desktop pricing">
              <PricingHero>
                <BrandMark as="div" aria-label="Diffforge">
                  <img src="/logo.webp" alt="" />
                  <strong>Diffforge</strong>
                </BrandMark>
                <PricingCopy>
                  <Kicker>Plan required</Kicker>
                  <PricingTitle>Upgrade to unlock the desktop workspace</PricingTitle>
                  <PricingText>
                    You are signed in as {displayName}. Free accounts can review pricing here,
                    but the desktop dashboard stays locked until your plan is paid.
                  </PricingText>
                </PricingCopy>
                <PricingActions>
                  <PrimaryButton onClick={openPricing} type="button">
                    <ButtonBrowserIcon aria-hidden="true" />
                    <span>Open pricing</span>
                  </PrimaryButton>
                  <SecondaryButton onClick={refreshSubscriptionStatus} type="button">
                    <ButtonRefreshIcon aria-hidden="true" />
                    <span>Check status</span>
                  </SecondaryButton>
                  <SecondaryButton onClick={logout} type="button">
                    <ButtonLogoutIcon aria-hidden="true" />
                    <span>Sign out</span>
                  </SecondaryButton>
                </PricingActions>
                {authError && <FormMessage $state="error">{authError}</FormMessage>}
              </PricingHero>

              <PricingPlans aria-label="Plans">
                <PricingPlanCard>
                  <PlanEyebrow>{planLabel}</PlanEyebrow>
                  <PlanPrice>$0</PlanPrice>
                  <PlanDescription>Browser login, pricing access, and account setup.</PlanDescription>
                  <PlanFeatureList>
                    <li>Web account login</li>
                    <li>Pricing and billing status</li>
                    <li>Desktop dashboard locked</li>
                  </PlanFeatureList>
                </PricingPlanCard>

                <PricingPlanCard data-featured="true">
                  <PlanEyebrow>Pro</PlanEyebrow>
                  <PlanPrice>
                    $25<span>/mo</span>
                  </PlanPrice>
                  <PlanDescription>Paid status unlocks the native dashboard shell.</PlanDescription>
                  <PlanFeatureList>
                    <li>Desktop workspace dashboard</li>
                    <li>Blank desktop workspace shell</li>
                    <li>Priority native app access</li>
                  </PlanFeatureList>
                </PricingPlanCard>
              </PricingPlans>
            </PricingScreen>
          ) : authState === "authenticated" && workspaceState !== "ready" ? (
            <SplashScreen aria-label={`${BRAND_NAME} is initializing workspace`}>
              <AmbientPanel data-position="left">
                <span>&gt; workspace</span>
                <p>Syncing session...</p>
                <p>Preparing workspace...</p>
              </AmbientPanel>
              <AmbientPanel data-position="right">
                <span>{displayName}</span>
                <p>Agents ready</p>
                <p>Workspace ready</p>
              </AmbientPanel>
              <SplashCenter>
                <SplashLogo src="/logo.webp" alt="" />
                <SplashTitle>Welcome back</SplashTitle>
                <SplashTagline>{displayName}</SplashTagline>
                <LoadingTrack aria-hidden="true">
                  <LoadingFill />
                </LoadingTrack>
                <LoadingText>Initializing workspace...</LoadingText>
              </SplashCenter>
            </SplashScreen>
          ) : authState === "authenticated" ? (
            <DashboardShell>
              <WorkspaceRail aria-label="Workspace navigation">
                <RailTop>
                  <RailSectionTitle>Workspaces</RailSectionTitle>
                  <WorkspaceList>
                    {workspaces.map((workspace) => (
                      <WorkspaceButton
                        data-active={workspace.id === activeWorkspaceId}
                        key={workspace.id}
                        onClick={() => {
                          setActiveWorkspaceId(workspace.id);
                        }}
                        type="button"
                      >
                        <WorkspaceAccent aria-hidden="true" />
                        <strong>{workspace.name}</strong>
                      </WorkspaceButton>
                    ))}
                    {workspaceSyncState === "loading" && (
                      <WorkspaceMuted>Loading...</WorkspaceMuted>
                    )}
                  </WorkspaceList>
                </RailTop>

                <RailFooter>
                  <RailActionButton
                    data-active={activeView === "dashboard"}
                    onClick={() => showView("dashboard")}
                    type="button"
                  >
                      <ButtonForgeIcon aria-hidden="true" />
                      <span>Workspace</span>
                    </RailActionButton>
                  <RailActionButton
                    data-active={activeView === "settings"}
                    onClick={() => showView("settings")}
                    type="button"
                  >
                    <ButtonSettingsIcon aria-hidden="true" />
                    <span>Settings</span>
                  </RailActionButton>
                  <RailActionButton onClick={logout} type="button">
                    <ButtonLogoutIcon aria-hidden="true" />
                    <span>Sign out</span>
                  </RailActionButton>
                </RailFooter>
              </WorkspaceRail>

              {visibleView === "settings" ? (
                <SettingsPage data-motion={viewMotion}>
                  <PageHeader>
                    <div>
                      <Kicker>Settings</Kicker>
                      <DashboardTitle>Desktop settings</DashboardTitle>
                      <PageSubline>Local agents and verified account state for this device.</PageSubline>
                    </div>
                    <SecondaryButton onClick={() => showView("dashboard")} type="button">
                      <ConnectedIcon aria-hidden="true" />
                      <span>Back</span>
                    </SecondaryButton>
                  </PageHeader>

                  <AgentSettingsPanel>
                    <PanelHeaderRow>
                      <div>
                        <PanelKicker>Local agents</PanelKicker>
                        <PanelHeading>Codex and Claude Code</PanelHeading>
                      </div>
                      <AgentPanelActions>
                        <AgentReadyPill data-tone={connectedAgentCount > 0 ? "blue" : "orange"}>
                          <ButtonBotIcon aria-hidden="true" />
                          <span>{connectedAgentCount}/2 ready</span>
                        </AgentReadyPill>
                        <SecondaryButton disabled={agentStatusState === "checking"} onClick={refreshAgentStatuses} type="button">
                          <ButtonRefreshIcon aria-hidden="true" />
                          <span>{agentStatusState === "checking" ? "Checking..." : "Recheck"}</span>
                        </SecondaryButton>
                      </AgentPanelActions>
                    </PanelHeaderRow>

                    {agentStatusError && <FormMessage $state="error">{agentStatusError}</FormMessage>}

                    <AgentCardGrid>
                      {agentStatuses.map((agent) => {
                        const installResult = agentInstallResults[agent.id];
                        const actionResult = agentActionResults[agent.id];
                        const isInstallingAgent = agentInstallState[agent.id] === "installing";
                        const isDisconnectingAgent = agentDisconnectState[agent.id] === "disconnecting";
                        const needsInstallMessage = `${agent.label} needs to be installed before this action.`;
                        const authActionDisabled = !agent.installed || agentStatusState === "checking" || isDisconnectingAgent;
                        const useDisabled = !agent.installed;
                        const authActionTitle = !agent.installed
                          ? needsInstallMessage
                          : isDisconnectingAgent
                            ? `Disconnecting ${agent.label}.`
                          : agentStatusState === "checking"
                            ? "Checking local agent status."
                            : agent.authenticated
                              ? `Disconnect ${agent.label} from this machine.`
                              : `Connect ${agent.label}`;
                        const useTitle = !agent.installed ? needsInstallMessage : `Use ${agent.label}`;
                        const npmInstallLabel = isInstallingAgent
                          ? "Installing..."
                          : installResult?.source === "npm" && !installResult.installed
                            ? "Retry npm install"
                            : agent.installed
                              ? "Update with npm"
                              : "Install with npm";
                        const installMessageTone = installResult?.installed
                          ? "success"
                          : installResult?.permissionDenied
                            ? "warning"
                            : "neutral";

                        return (
                          <AgentCard data-tone={getAgentTone(agent)} key={agent.id}>
                            <AgentCardHeader>
                              <AgentIcon data-tone={getAgentTone(agent)}>
                                {agent.id === "codex" ? <ButtonCodeIcon aria-hidden="true" /> : <ButtonBotIcon aria-hidden="true" />}
                              </AgentIcon>
                              <div>
                                <AgentName>{agent.label}</AgentName>
                                <AgentMeta>{agent.version}</AgentMeta>
                              </div>
                            </AgentCardHeader>
                            <AgentStatusText>{agent.authMessage}</AgentStatusText>

                            {!agent.installed && (
                              <AgentInstallPanel>
                                <AgentInstallTopline>
                                  <span>{agent.nativeInstallLabel}</span>
                                  <AgentInstallBadge>Recommended</AgentInstallBadge>
                                </AgentInstallTopline>
                                <AgentInstallHint>
                                  {agent.npmAvailable
                                    ? `npm ${agent.npmVersion} detected. Native install is still preferred.`
                                    : "npm was not detected. Use the native installer path."}
                                </AgentInstallHint>
                                <AgentInstallActions>
                                  <PrimaryButton onClick={() => openAgentNativeInstaller(agent)} type="button">
                                    <ButtonBrowserIcon aria-hidden="true" />
                                    <span>Native installer</span>
                                  </PrimaryButton>
                                  {agent.npmAvailable && (
                                    <SecondaryButton
                                      disabled={isInstallingAgent}
                                      onClick={() => installAgentWithNpm(agent.id)}
                                      type="button"
                                    >
                                      {isInstallingAgent ? <PendingIcon aria-hidden="true" /> : <ButtonTerminalIcon aria-hidden="true" />}
                                      <span>{npmInstallLabel}</span>
                                    </SecondaryButton>
                                  )}
                                </AgentInstallActions>
                                {agent.npmAvailable && <AgentInstallCommand>{agent.installCommand}</AgentInstallCommand>}
                                {installResult?.message && (
                                  <AgentInstallMessage data-tone={installMessageTone}>
                                    {installResult.message}
                                  </AgentInstallMessage>
                                )}
                              </AgentInstallPanel>
                            )}

                            <AgentActions>
                              {agent.authenticated ? (
                                <AgentActionTooltip title={authActionTitle}>
                                  <PrimaryDangerButton
                                    disabled={authActionDisabled}
                                    onClick={() => disconnectAgent(agent.id)}
                                    title={authActionTitle}
                                    type="button"
                                  >
                                    {isDisconnectingAgent ? <PendingIcon aria-hidden="true" /> : <ButtonLogoutIcon aria-hidden="true" />}
                                    <span>{isDisconnectingAgent ? "Disconnecting..." : "Disconnect"}</span>
                                  </PrimaryDangerButton>
                                </AgentActionTooltip>
                              ) : (
                                <AgentActionTooltip title={authActionTitle}>
                                  <SecondaryButton
                                    disabled={authActionDisabled}
                                    onClick={() => connectAgent(agent.id)}
                                    title={authActionTitle}
                                    type="button"
                                  >
                                    <ButtonKeyIcon aria-hidden="true" />
                                    <span>Connect</span>
                                  </SecondaryButton>
                                </AgentActionTooltip>
                              )}
                              <AgentActionTooltip title={useTitle}>
                                <SecondaryButton
                                  disabled={useDisabled}
                                  onClick={() => {
                                    setActiveAgent(agent.id);
                                    showView("dashboard");
                                  }}
                                  title={useTitle}
                                  type="button"
                                >
                                  <ButtonTerminalIcon aria-hidden="true" />
                                  <span>Use</span>
                                </SecondaryButton>
                              </AgentActionTooltip>
                            </AgentActions>
                            {actionResult?.message && (
                              <AgentInstallMessage data-tone={actionResult.tone || "neutral"}>
                                {actionResult.message}
                              </AgentInstallMessage>
                            )}
                          </AgentCard>
                        );
                      })}
                    </AgentCardGrid>
                  </AgentSettingsPanel>

                  <AccountSettingsPanel>
                    <PanelHeaderRow>
                      <div>
                        <PanelKicker>Account info</PanelKicker>
                        <PanelHeading>Signed-in desktop account</PanelHeading>
                      </div>
                    </PanelHeaderRow>

                    <AccountCard data-tone="blue">
                      <AccountCardHeader>
                        <div>
                          <SettingsLabel>Account</SettingsLabel>
                          <SettingsValue>{displayName}</SettingsValue>
                          <SettingsHint>Server-returned desktop session user.</SettingsHint>
                        </div>
                        <AgentReadyPill data-tone={connectedAgentCount > 0 ? "blue" : "orange"}>
                          <ButtonBotIcon aria-hidden="true" />
                          <span>{connectedAgentCount}/2 ready</span>
                        </AgentReadyPill>
                      </AccountCardHeader>

                      <SettingsIdentityGrid>
                        <SettingsIdentityItem>
                          <span>Email</span>
                          <strong>{user?.email || "Not returned"}</strong>
                        </SettingsIdentityItem>
                        <SettingsIdentityItem>
                          <span>Plan</span>
                          <strong>{planLabel}</strong>
                        </SettingsIdentityItem>
                        <SettingsIdentityItem>
                          <span>Session</span>
                          <strong>Device active</strong>
                        </SettingsIdentityItem>
                      </SettingsIdentityGrid>

                      <AccountCardFooter>
                        <SettingsHint>Signing out clears this device session.</SettingsHint>
                        <PrimaryDangerButton onClick={logout} type="button">
                          <ButtonLogoutIcon aria-hidden="true" />
                          <span>Sign out</span>
                        </PrimaryDangerButton>
                      </AccountCardFooter>
                    </AccountCard>
                  </AccountSettingsPanel>
                </SettingsPage>
              ) : (
                <>
                  <ForgeWorkspace aria-label="Forge workspace" data-motion={viewMotion}>
                    {shouldShowWorkspaceSetup ? (
                      <WorkspaceSetupPanel onSubmit={createFirstWorkspace}>
                        <SetupHeader>
                          <Kicker>First workspace</Kicker>
                          <DashboardTitle>Create your workspace</DashboardTitle>
                          <PageSubline>Name it, then the workspace syncs through the protected API.</PageSubline>
                        </SetupHeader>
                        {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
                        <SetupField>
                          <SettingsLabel>Workspace name</SettingsLabel>
                          <SetupInput
                            maxLength={80}
                            onChange={(event) => setWorkspaceName(event.target.value)}
                            placeholder="My workspace"
                            value={workspaceName}
                          />
                        </SetupField>
                        <PrimaryButton disabled={workspaceSyncState === "creating"} type="submit">
                          <ButtonForgeIcon aria-hidden="true" />
                          <span>{workspaceSyncState === "creating" ? "Creating..." : "Create workspace"}</span>
                        </PrimaryButton>
                      </WorkspaceSetupPanel>
                    ) : (
                      <BlankWorkspaceSurface>
                        {(workspaceError || agentStatusError) && (
                          <BlankStatusStack>
                            {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
                            {agentStatusError && <FormMessage $state="error">{agentStatusError}</FormMessage>}
                          </BlankStatusStack>
                        )}
                      </BlankWorkspaceSurface>
                    )}
                  </ForgeWorkspace>
                </>
              )}
            </DashboardShell>
          ) : (
            <LoginScreen>
              <AuthSquareBackdrop />
              <LoginLayout>
                <BrandPanel aria-labelledby="desktop-title">
                  <BrandMark href="#" aria-label={BRAND_NAME}>
                    <img src="/logo.webp" alt="" />
                    <strong>{BRAND_NAME}</strong>
                  </BrandMark>

                  <IntroCopy>
                    <Kicker>Web sign in</Kicker>
                    <Headline id="desktop-title">Sign in to {BRAND_NAME}</Headline>
                    <Lede>
                      Use your browser for secure {BRAND_NAME} authentication, then return to this native app.
                    </Lede>
                    <IntroFeatureList aria-label="Desktop auth status">
                      <IntroFeature data-tone="blue">
                        <span />
                        Browser handoff
                      </IntroFeature>
                      <IntroFeature data-tone="orange">
                        <span />
                        Deep-link callback
                      </IntroFeature>
                      <IntroFeature>
                        <span />
                        Server session check
                      </IntroFeature>
                    </IntroFeatureList>
                  </IntroCopy>
                </BrandPanel>

                <LoginCard aria-label="Desktop sign in">
                  <LoginPanel>
                    <LoginCardTop>
                      <PanelKicker>Native app access</PanelKicker>
                      <LoginCardBadge data-state={authState}>{authStateLabel}</LoginCardBadge>
                    </LoginCardTop>
                    <LoginIconWrap aria-hidden="true">
                      {isAuthBusy ? <PendingIcon /> : <ButtonLoginIcon />}
                    </LoginIconWrap>
                    <SessionTitle>{authPanelTitle}</SessionTitle>
                    <SessionText>{authMessage}</SessionText>
                    {authError && <FormMessage $state="error">{authError}</FormMessage>}
                    <AuthStepRail aria-label="Desktop sign in checkpoints">
                      {AUTH_STEPS.map((step, index) => (
                        <AuthStep data-active={index === 0 || isAuthBusy} key={step}>
                          <span>{index + 1}</span>
                          <strong>{step}</strong>
                        </AuthStep>
                      ))}
                    </AuthStepRail>
                    <PrimaryButton disabled={isAuthBusy} onClick={startWebLogin} type="button">
                      <ButtonBrowserIcon aria-hidden="true" />
                      <span>{authButtonLabel}</span>
                    </PrimaryButton>
                  </LoginPanel>
                </LoginCard>
              </LoginLayout>
            </LoginScreen>
          )}
        </AppContent>
      </AppFrame>
    </>
  );
}

const GlobalStyle = createGlobalStyle`
  :root {
    color: #f7f9ff;
    background: #030508;
    color-scheme: dark;
    font-family:
      Inter,
      ui-sans-serif,
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    font-synthesis: none;
    text-rendering: optimizeLegibility;
  }

  * {
    box-sizing: border-box;
    scrollbar-color: rgba(98, 160, 255, 0.72) rgba(6, 9, 16, 0.72);
    scrollbar-width: thin;
  }

  *::-webkit-scrollbar {
    width: 10px;
    height: 10px;
  }

  *::-webkit-scrollbar-track {
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012)),
      rgba(6, 9, 16, 0.76);
  }

  *::-webkit-scrollbar-thumb {
    min-height: 42px;
    border: 2px solid rgba(6, 9, 16, 0.88);
    border-radius: 999px;
    background:
      linear-gradient(180deg, rgba(98, 160, 255, 0.9), rgba(47, 128, 255, 0.56) 48%, rgba(255, 122, 24, 0.72)),
      #2f80ff;
    background-clip: padding-box;
  }

  *::-webkit-scrollbar-thumb:hover {
    background:
      linear-gradient(180deg, #8bb9ff, rgba(98, 160, 255, 0.72) 46%, #ff9a3d),
      #62a0ff;
    background-clip: padding-box;
  }

  *::-webkit-scrollbar-corner {
    background: rgba(6, 9, 16, 0.76);
  }

  html,
  body,
  #app {
    min-width: 320px;
    min-height: 100vh;
    margin: 0;
    background: #030508;
  }

  body {
    overflow: hidden;
    background:
      linear-gradient(180deg, rgba(47, 128, 255, 0.1), rgba(3, 5, 8, 0) 34rem),
      linear-gradient(135deg, rgba(255, 122, 24, 0.08), rgba(3, 5, 8, 0) 28rem),
      #030508;
  }

  button {
    cursor: pointer;
    font: inherit;
  }

  button:disabled {
    cursor: not-allowed;
  }

  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      scroll-behavior: auto !important;
      transition-duration: 0.001ms !important;
    }
  }
`;

const AppFrame = styled.div`
  display: grid;
  min-width: 320px;
  min-height: 100vh;
  grid-template-rows: ${TITLE_BAR_HEIGHT} minmax(0, 1fr);
  background: #030508;
`;

const WindowTitleBar = styled.header`
  display: grid;
  height: ${TITLE_BAR_HEIGHT};
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  color: #e8eef8;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
    #060910;
  user-select: none;
`;

const WindowTitle = styled.div`
  display: inline-flex;
  min-width: 0;
  height: 100%;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  color: #eaf0f5;
  font-size: 12px;
  font-weight: 820;

  img {
    display: block;
    width: 18px;
    height: 18px;
    border-radius: 4px;
    object-fit: cover;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const WindowControls = styled.div`
  display: inline-flex;
  height: 100%;
  align-items: stretch;
`;

const WindowControlButton = styled.button`
  display: grid;
  width: 46px;
  height: 100%;
  place-items: center;
  border: 0;
  border-radius: 0;
  color: #c9d2dc;
  background: transparent;

  &:hover {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.09);
  }

  &[data-variant="close"]:hover {
    color: #ffffff;
    background: #d83b32;
  }
`;

const AppContent = styled.div`
  min-height: 0;
  overflow: auto;
  background:
    linear-gradient(180deg, rgba(47, 128, 255, 0.1) 0%, rgba(3, 5, 8, 0) 34rem),
    linear-gradient(135deg, rgba(255, 122, 24, 0.08) 0%, rgba(3, 5, 8, 0) 28rem),
    linear-gradient(90deg, rgba(255, 255, 255, 0.035) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px),
    #030508;
  background-size: auto, auto, 96px 96px, 96px 96px, auto;
`;

const splashPulse = keyframes`
  0%,
  100% {
    opacity: 0.72;
    transform: translate3d(0, 0, 0);
  }

  50% {
    opacity: 1;
    transform: translate3d(0, -4px, 0);
  }
`;

const loadingOrangeSweep = keyframes`
  0% {
    opacity: 0;
    transform: translateX(-145%);
  }

  14% {
    opacity: 1;
  }

  82% {
    opacity: 1;
  }

  100% {
    opacity: 0;
    transform: translateX(330%);
  }
`;

const shellReveal = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.992);
  }

  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

const railReveal = keyframes`
  from {
    opacity: 0;
    transform: translateX(-10px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const sideReveal = keyframes`
  from {
    opacity: 0;
    transform: translateX(10px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
`;

const panelEnter = keyframes`
  from {
    opacity: 0;
    transform: translateY(8px);
  }

  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const panelExit = keyframes`
  from {
    opacity: 1;
    transform: translateY(0);
  }

  to {
    opacity: 0;
    transform: translateY(5px);
  }
`;

const quietSweep = keyframes`
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(100%);
  }
`;

const squareFade = keyframes`
  0%,
  72%,
  100% {
    opacity: 0;
  }

  10%,
  32% {
    opacity: var(--peak);
  }

  48% {
    opacity: 0;
  }
`;

const SplashScreen = styled.main`
  position: relative;
  display: grid;
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  overflow: hidden;
  place-items: center;
  padding: clamp(20px, 6vh, 48px);
  color: #f7f9ff;
  background:
    linear-gradient(145deg, rgba(47, 128, 255, 0.13), rgba(3, 5, 8, 0) 42%),
    linear-gradient(315deg, rgba(255, 122, 24, 0.15), rgba(3, 5, 8, 0) 40%),
    linear-gradient(90deg, rgba(255, 255, 255, 0.032) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px),
    #030508;
  background-size: auto, auto, 92px 92px, 92px 92px, auto;

  &::before {
    position: absolute;
    inset: 26px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012)),
      rgba(3, 5, 8, 0.46);
    content: "";
  }

  @media (max-width: 760px) {
    padding: 28px;

    &::before {
      inset: 14px;
    }
  }

  @media (max-height: 660px) {
    padding: 18px;

    &::before {
      inset: 12px;
    }
  }
`;

const AmbientPanel = styled.div`
  position: absolute;
  z-index: 1;
  display: grid;
  gap: 10px;
  width: min(320px, 28vw);
  min-height: 126px;
  padding: 18px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: rgba(232, 238, 248, 0.38);
  background: rgba(10, 15, 23, 0.38);
  box-shadow: inset 0 0 40px rgba(255, 255, 255, 0.02);
  font-family:
    "Cascadia Mono",
    "SFMono-Regular",
    Consolas,
    monospace;
  font-size: 13px;
  line-height: 1.35;
  animation: ${splashPulse} 3s ease-in-out infinite;

  &[data-position="left"] {
    top: 12%;
    left: 6%;
  }

  &[data-position="right"] {
    right: 6%;
    bottom: 24%;
    animation-delay: 0.9s;
  }

  span {
    color: #62a0ff;
    font-weight: 800;
  }

  p {
    margin: 0;
  }

  p:last-child {
    color: rgba(255, 154, 61, 0.56);
  }

  @media (max-width: 980px) {
    display: none;
  }
`;

const SplashCenter = styled.section`
  position: relative;
  z-index: 2;
  display: grid;
  width: min(680px, 100%);
  justify-items: center;
  gap: clamp(10px, 2.5vh, 18px);
  text-align: center;
`;

const SplashLogo = styled.img`
  display: block;
  width: clamp(132px, 28vh, 258px);
  height: clamp(132px, 28vh, 258px);
  border-radius: 8px;
  object-fit: cover;
  filter:
    drop-shadow(0 0 24px rgba(47, 128, 255, 0.36))
    drop-shadow(0 0 28px rgba(255, 122, 24, 0.28));
  animation: ${splashPulse} 2.8s ease-in-out infinite;

  @media (max-width: 760px) {
    width: clamp(112px, 24vh, 184px);
    height: clamp(112px, 24vh, 184px);
  }
`;

const SplashTitle = styled.h1`
  margin: 0;
  color: #ffffff;
  font-size: clamp(38px, 7vw, 64px);
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1;
  text-shadow: 0 0 24px rgba(47, 128, 255, 0.22);

  @media (max-width: 760px) {
    font-size: 42px;
  }
`;

const SplashTagline = styled.p`
  margin: 0;
  color: #a7b2c2;
  font-size: clamp(15px, 2.2vw, 19px);
  font-weight: 650;
  line-height: 1.5;

  @media (max-width: 760px) {
    font-size: 16px;
  }
`;

const LoadingTrack = styled.div`
  position: relative;
  width: min(520px, 88%);
  height: 7px;
  overflow: hidden;
  border: 1px solid rgba(98, 160, 255, 0.44);
  border-radius: 8px;
  background: linear-gradient(90deg, #0e4fd3, #2f80ff 42%, #62a0ff);
  box-shadow:
    inset 0 0 12px rgba(255, 255, 255, 0.12),
    0 0 18px rgba(47, 128, 255, 0.28);

  &[data-state="offline"] {
    border-color: rgba(255, 107, 107, 0.42);
    background:
      linear-gradient(90deg, rgba(255, 107, 107, 0.16), rgba(255, 122, 24, 0.2)),
      #10151f;
    box-shadow:
      inset 0 0 12px rgba(255, 255, 255, 0.07),
      0 0 18px rgba(255, 107, 107, 0.14);
  }
`;

const LoadingFill = styled.div`
  width: 34%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(
    90deg,
    rgba(255, 122, 24, 0),
    #ff7a18 28%,
    #ff9a3d 56%,
    rgba(255, 186, 96, 0)
  );
  box-shadow:
    0 0 14px rgba(255, 122, 24, 0.62),
    0 0 18px rgba(255, 154, 61, 0.4);
  animation: ${loadingOrangeSweep} 1.55s cubic-bezier(0.45, 0, 0.25, 1) infinite;
`;

const LoadingText = styled.p`
  margin: 0;
  color: #d1d8e2;
  font-size: 16px;
  font-weight: 720;
`;

const LoadingDetail = styled.p`
  margin: 3px 0 0;
  color: #8f9bad;
  font-size: 13px;
  font-weight: 620;
  line-height: 1.45;
`;

const LaunchStatusPanel = styled.div`
  display: grid;
  width: min(520px, 92%);
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(47, 128, 255, 0.24);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.012)),
    rgba(6, 9, 16, 0.74);
  text-align: left;
  box-shadow: 0 20px 54px rgba(0, 0, 0, 0.22);

  &[data-state="offline"] {
    border-color: rgba(255, 107, 107, 0.32);
    background:
      linear-gradient(145deg, rgba(255, 107, 107, 0.12), rgba(255, 122, 24, 0.08)),
      rgba(6, 9, 16, 0.78);
  }

  @media (max-width: 520px) {
    grid-template-columns: 1fr;
    justify-items: center;
    text-align: center;
  }
`;

const LaunchStatusIcon = styled.span`
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid rgba(47, 128, 255, 0.38);
  border-radius: 8px;
  color: #62a0ff;
  background: rgba(47, 128, 255, 0.14);

  &[data-state="offline"] {
    border-color: rgba(255, 107, 107, 0.4);
    color: #ffb1b1;
    background: rgba(255, 107, 107, 0.14);
  }
`;

const LaunchStatusCopy = styled.div`
  min-width: 0;
`;

const LaunchActions = styled.div`
  display: flex;
  justify-content: center;
  width: min(260px, 92%);

  > button {
    width: 100%;
    min-height: 44px;
  }
`;

const LoginScreen = styled.main`
  position: relative;
  display: grid;
  width: 100%;
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  isolation: isolate;
  overflow: hidden;
  background: #030508;
`;

const LoginLayout = styled.div`
  position: relative;
  z-index: 1;
  display: grid;
  width: min(1080px, calc(100% - clamp(28px, 6vw, 48px)));
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  grid-template-columns: minmax(0, 1fr) minmax(320px, 430px);
  align-items: center;
  align-content: center;
  gap: clamp(28px, 5vw, 56px);
  margin: 0 auto;
  padding: clamp(18px, 6vh, 48px) 0;
  animation: ${shellReveal} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  @media (max-width: 860px) {
    width: min(100% - 28px, 620px);
    grid-template-columns: 1fr;
    gap: 28px;
    padding: 28px 0;
  }

  @media (max-height: 720px) and (min-width: 861px) {
    grid-template-columns: minmax(0, 0.9fr) minmax(320px, 400px);
    align-items: start;
    gap: 26px;
    padding: 18px 0;
  }
`;

const SquareField = styled.div`
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(185, 191, 203, 0.24) 1px, transparent 1px),
    linear-gradient(180deg, rgba(185, 191, 203, 0.22) 1px, transparent 1px),
    #030508;
  background-size: ${AUTH_TILE_SIZE}px ${AUTH_TILE_SIZE}px;

  &::after {
    position: absolute;
    inset: 0;
    z-index: 2;
    background:
      linear-gradient(90deg, rgba(3, 5, 8, 0.72), rgba(3, 5, 8, 0.12) 46%, rgba(3, 5, 8, 0.6)),
      linear-gradient(180deg, rgba(3, 5, 8, 0.06), rgba(3, 5, 8, 0.48));
    content: "";
  }
`;

const SquarePulse = styled.span`
  position: absolute;
  top: var(--top);
  left: var(--left);
  z-index: 1;
  width: ${AUTH_TILE_SIZE}px;
  height: ${AUTH_TILE_SIZE}px;
  background: rgba(188, 194, 205, 0.96);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
  opacity: 0;
  animation: ${squareFade} var(--duration) ease-in-out var(--delay) infinite;
`;

const BrandPanel = styled.section`
  position: relative;
  z-index: 1;
  display: grid;
  min-height: min(520px, calc(100vh - ${TITLE_BAR_HEIGHT} - 96px));
  align-content: center;
  gap: clamp(24px, 5vh, 48px);
  padding: clamp(8px, 2vh, 20px) 0;
  animation: ${railReveal} 320ms cubic-bezier(0.2, 0.8, 0.2, 1) 60ms both;

  @media (max-width: 860px) {
    min-height: auto;
    gap: 34px;
    padding: 0;
  }

  @media (max-height: 720px) and (min-width: 861px) {
    min-height: auto;
    gap: 18px;
    padding: 0;
  }
`;

const BrandMark = styled.a`
  display: inline-flex;
  width: fit-content;
  align-items: center;
  gap: 12px;
  color: #ffffff;
  font-size: 17px;
  text-decoration: none;

  img {
    display: block;
    width: 38px;
    height: 38px;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 8px;
    background: #050607;
    object-fit: cover;
    filter:
      drop-shadow(0 0 10px rgba(47, 128, 255, 0.28))
      drop-shadow(0 0 12px rgba(255, 122, 24, 0.18));
  }
`;

const IntroCopy = styled.div`
  display: grid;
  gap: clamp(12px, 2.4vh, 18px);
`;

const Kicker = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const Headline = styled.h1`
  max-width: 620px;
  margin: 0;
  color: #ffffff;
  font-size: clamp(38px, 5.6vw, 68px);
  font-weight: 820;
  letter-spacing: 0;
  line-height: 0.98;

  @media (max-width: 860px) {
    font-size: clamp(40px, 13vw, 58px);
  }

  @media (max-height: 720px) and (min-width: 861px) {
    font-size: clamp(34px, 8vh, 48px);
    line-height: 1.03;
  }
`;

const Lede = styled.p`
  max-width: 560px;
  margin: 0;
  color: #a7b2c2;
  font-size: clamp(15px, 2vw, 18px);
  line-height: 1.62;

  @media (max-height: 720px) and (min-width: 861px) {
    line-height: 1.45;
  }
`;

const IntroFeatureList = styled.ul`
  display: grid;
  max-width: 540px;
  gap: 10px;
  margin: 4px 0 0;
  padding: 20px 0 0;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  list-style: none;

  @media (max-height: 720px) and (min-width: 861px) {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    padding-top: 12px;
  }
`;

const IntroFeature = styled.li`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: #a7b2c2;
  font-size: 14px;
  font-weight: 720;
  line-height: 1.5;

  span {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: #f7f9ff;
  }

  &[data-tone="blue"] span {
    background: #2f80ff;
  }

  &[data-tone="orange"] span {
    background: #ff7a18;
  }

  @media (max-height: 720px) and (min-width: 861px) {
    gap: 7px;
    font-size: 12px;
    line-height: 1.35;
  }
`;

const ApiStatus = styled.div`
  display: grid;
  width: min(100%, 560px);
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px 18px;
  padding: 18px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
    rgba(10, 15, 23, 0.74);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.24);
  animation: ${panelEnter} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) 180ms both;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

const StatusSummary = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
  color: #eef4f8;
  font-size: 14px;
  font-weight: 760;
`;

const StatusBadge = styled.span`
  display: grid;
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  color: #ffffff;
  background: rgba(255, 122, 24, 0.22);
  border: 1px solid rgba(255, 122, 24, 0.4);

  ${ApiStatus}[data-state="online"] & {
    background: rgba(47, 128, 255, 0.18);
    border-color: rgba(47, 128, 255, 0.48);
  }

  ${ApiStatus}[data-state="offline"] & {
    background: rgba(255, 107, 107, 0.16);
    border-color: rgba(255, 107, 107, 0.42);
  }
`;

const iconPulse = keyframes`
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
`;

const statusIconSize = `
  width: 18px;
  height: 18px;
`;

const ConnectedIcon = styled(CloudDone)`
  ${statusIconSize}
`;

const ErrorIcon = styled(ErrorOutline)`
  ${statusIconSize}
`;

const PendingIcon = styled(Pending)`
  ${statusIconSize}
  animation: ${iconPulse} 1.2s linear infinite;
`;

const StatusButton = styled.button`
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 14px;
  border: 1px solid rgba(47, 128, 255, 0.36);
  border-radius: 8px;
  color: #f7f9ff;
  background: rgba(47, 128, 255, 0.14);
  font-size: 13px;
  font-weight: 800;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    transform 160ms ease;

  &:hover:not(:disabled) {
    border-color: rgba(98, 160, 255, 0.64);
    background: rgba(47, 128, 255, 0.22);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.68;
  }

  @media (max-width: 860px) {
    width: 100%;
  }
`;

const ApiBase = styled.p`
  grid-column: 1 / -1;
  margin: 0;
  overflow-wrap: anywhere;
  color: #8f9aa5;
  font-size: 12px;
  font-weight: 700;
`;

const PricingScreen = styled.main`
  display: grid;
  min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
  grid-template-columns: minmax(0, 0.86fr) minmax(360px, 1fr);
  align-items: center;
  gap: 36px;
  padding: 48px;
  color: #f7fafc;
  background:
    linear-gradient(145deg, rgba(47, 128, 255, 0.14), rgba(3, 5, 8, 0) 40%),
    linear-gradient(315deg, rgba(255, 122, 24, 0.13), rgba(3, 5, 8, 0) 36%),
    #030508;
  animation: ${shellReveal} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    align-items: start;
    padding: 28px;
  }
`;

const PricingHero = styled.section`
  display: grid;
  align-content: center;
  gap: 24px;
`;

const PricingCopy = styled.div`
  display: grid;
  gap: 16px;
`;

const PricingTitle = styled.h1`
  max-width: 640px;
  margin: 0;
  color: #ffffff;
  font-size: clamp(40px, 6vw, 68px);
  font-weight: 900;
  letter-spacing: 0;
  line-height: 0.98;
`;

const PricingText = styled.p`
  max-width: 580px;
  margin: 0;
  color: #a7b2c2;
  font-size: 17px;
  line-height: 1.72;
`;

const PricingActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;

  button {
    min-width: 150px;
    padding: 0 16px;
  }
`;

const PricingPlans = styled.section`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

const PricingPlanCard = styled.article`
  position: relative;
  display: grid;
  min-height: 430px;
  align-content: start;
  gap: 18px;
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background: rgba(17, 22, 27, 0.9);

  &[data-featured="true"] {
    border-color: rgba(47, 128, 255, 0.42);
    background:
      linear-gradient(145deg, rgba(47, 128, 255, 0.16), rgba(255, 122, 24, 0.09)),
      rgba(17, 22, 27, 0.92);
    box-shadow: 0 28px 80px rgba(47, 128, 255, 0.12);
  }
`;

const PlanEyebrow = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const PlanPrice = styled.h2`
  margin: 0;
  color: #ffffff;
  font-size: 56px;
  font-weight: 900;
  letter-spacing: 0;
  line-height: 0.95;

  span {
    color: #8f9aa5;
    font-size: 18px;
    font-weight: 760;
  }
`;

const PlanDescription = styled.p`
  margin: 0;
  color: #bdc6ce;
  font-size: 14px;
  line-height: 1.62;
`;

const PlanFeatureList = styled.ul`
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    position: relative;
    padding-left: 20px;
    color: #e8eef3;
    font-size: 13px;
    line-height: 1.5;
  }

  li::before {
    position: absolute;
    top: 0.55em;
    left: 0;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #62a0ff;
    content: "";
  }
`;

const DashboardShell = styled.main`
  display: grid;
  min-width: 320px;
  height: calc(100vh - ${TITLE_BAR_HEIGHT});
  min-height: 0;
  grid-template-columns: 172px minmax(280px, 1fr);
  color: #f7fafc;
  overflow: hidden;
  background:
    radial-gradient(circle at 82% 10%, rgba(47, 128, 255, 0.11), transparent 18rem),
    radial-gradient(circle at 18% 88%, rgba(255, 122, 24, 0.09), transparent 16rem),
    #030508;
  animation: ${shellReveal} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  @media (max-width: 980px) {
    grid-template-columns: 164px minmax(0, 1fr);
  }

  @media (max-width: 760px) {
    height: auto;
    min-height: calc(100vh - ${TITLE_BAR_HEIGHT});
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

const WorkspaceRail = styled.aside`
  display: grid;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: 12px;
  padding: 12px;
  border-right: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(3, 5, 8, 0.78);
  backdrop-filter: blur(18px);
  animation: ${railReveal} 300ms cubic-bezier(0.2, 0.8, 0.2, 1) 40ms both;

  @media (max-width: 760px) {
    min-height: auto;
    grid-template-rows: auto auto;
    border-right: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.09);
  }
`;

const RailTop = styled.div`
  display: grid;
  align-content: start;
  gap: 9px;
  min-height: 0;
  overflow: auto;
  padding-bottom: 4px;
`;

const RailSectionTitle = styled.p`
  margin: 0;
  color: #687386;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  animation: ${panelEnter} 220ms cubic-bezier(0.2, 0.8, 0.2, 1) 80ms both;
`;

const WorkspaceList = styled.div`
  display: grid;
  gap: 5px;
`;

const WorkspaceButton = styled.button`
  position: relative;
  display: grid;
  min-height: 32px;
  grid-template-columns: 4px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #e8eef8;
  background: transparent;
  text-align: left;
  opacity: 0;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    transform 160ms ease;
  animation: ${panelEnter} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &:nth-child(1) {
    animation-delay: 110ms;
  }

  &:nth-child(2) {
    animation-delay: 145ms;
  }

  &:nth-child(3) {
    animation-delay: 180ms;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 800;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-active="true"],
  &:hover {
    border-color: rgba(47, 128, 255, 0.36);
    background: rgba(47, 128, 255, 0.14);
    transform: translateX(2px);
  }
`;

const WorkspaceAccent = styled.span`
  width: 3px;
  height: 16px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  transition:
    background 180ms ease,
    box-shadow 180ms ease,
    transform 180ms ease;

  ${WorkspaceButton}[data-active="true"] & {
    background: linear-gradient(180deg, #62a0ff, #ff9a3d);
    box-shadow:
      0 0 10px rgba(47, 128, 255, 0.32),
      0 0 10px rgba(255, 122, 24, 0.18);
    transform: scaleY(1.12);
  }
`;

const WorkspaceMuted = styled.p`
  margin: 0;
  padding: 8px 9px;
  color: #687386;
  font-size: 12px;
  font-weight: 760;
`;

const RailFooter = styled.div`
  display: grid;
  gap: 6px;
  min-height: 0;
  padding-top: 10px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(3, 5, 8, 0.88);
  animation: ${panelEnter} 260ms cubic-bezier(0.2, 0.8, 0.2, 1) 220ms both;
`;

const RailActionButton = styled.button`
  display: inline-flex;
  min-height: 34px;
  align-items: center;
  gap: 9px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #c5cdd6;
  background: transparent;
  font-size: 12px;
  font-weight: 800;
  transition:
    background 160ms ease,
    color 160ms ease,
    transform 160ms ease;

  svg {
    width: 16px;
    height: 16px;
  }

  &[data-active="true"],
  &:hover {
    color: #ffffff;
    background: rgba(47, 128, 255, 0.12);
    transform: translateX(2px);
  }
`;

const BlankWorkspace = styled.section`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.026) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    rgba(3, 5, 8, 0.18);
  background-size: 76px 76px, 76px 76px, auto;
  animation: ${panelEnter} ${VIEW_TRANSITION_MS + 90}ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &::after {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(90deg, transparent, rgba(98, 160, 255, 0.035), transparent),
      radial-gradient(circle at 50% 50%, rgba(47, 128, 255, 0.05), transparent 34rem);
    content: "";
    opacity: 0.72;
    animation: ${quietSweep} 7s ease-in-out infinite;
  }

  &[data-motion="exiting"] {
    animation: ${panelExit} ${VIEW_TRANSITION_MS}ms ease both;
    pointer-events: none;
  }

  @media (max-width: 980px) {
    min-height: 360px;
  }
`;

const ForgeWorkspace = styled.section`
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
  overflow: hidden;
  padding: 8px;
  background:
    radial-gradient(circle at 84% 10%, rgba(47, 128, 255, 0.12), transparent 16rem),
    rgba(3, 5, 8, 0.18);
  animation: ${panelEnter} ${VIEW_TRANSITION_MS + 90}ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &[data-motion="exiting"] {
    animation: ${panelExit} ${VIEW_TRANSITION_MS}ms ease both;
    pointer-events: none;
  }

  @media (max-width: 760px) {
    padding: 8px;
  }
`;

const BlankWorkspaceSurface = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  align-content: start;
  width: 100%;
  height: 100%;
  padding: 12px;
  background: rgba(3, 5, 8, 0.14);
`;

const WorkspaceSetupPanel = styled.form`
  display: grid;
  width: min(520px, 100%);
  align-self: center;
  justify-self: center;
  gap: 16px;
  padding: 22px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background:
    radial-gradient(circle at 85% 10%, rgba(47, 128, 255, 0.14), transparent 14rem),
    rgba(13, 20, 31, 0.9);
`;

const SetupHeader = styled.div`
  display: grid;
  gap: 6px;
`;

const SetupField = styled.label`
  display: grid;
  gap: 8px;
`;

const SetupInput = styled.input`
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  color: #f7f9ff;
  background: rgba(6, 9, 16, 0.92);
  font: inherit;

  &:focus {
    border-color: rgba(47, 128, 255, 0.5);
    outline: none;
    box-shadow: 0 0 0 3px rgba(47, 128, 255, 0.12);
  }
`;

const BlankStatusStack = styled.div`
  display: grid;
  justify-self: end;
  width: min(520px, 100%);
  gap: 8px;
`;

const AgentSettingsPanel = styled.section`
  position: relative;
  display: grid;
  gap: 16px;
  align-self: start;
  min-width: 0;
  min-height: 340px;
  overflow: visible;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(47, 128, 255, 0.14), transparent 36%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.015)),
    rgba(13, 20, 31, 0.86);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);

  &::before {
    position: absolute;
    inset: 0 0 auto;
    height: 2px;
    background: linear-gradient(90deg, #2f80ff, rgba(255, 122, 24, 0.72), transparent);
    content: "";
  }
`;

const AgentPanelActions = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;

  button {
    min-height: 40px;
  }
`;

const AgentReadyPill = styled.div`
  display: inline-flex;
  min-height: 40px;
  align-items: center;
  gap: 8px;
  padding: 0 11px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  color: #e8eef8;
  background: rgba(6, 9, 16, 0.74);
  font-size: 12px;
  font-weight: 900;

  svg {
    width: 17px;
    height: 17px;
  }

  &[data-tone="blue"] {
    border-color: rgba(47, 128, 255, 0.38);
    color: #8bb9ff;
    background: rgba(47, 128, 255, 0.13);
  }

  &[data-tone="orange"] {
    border-color: rgba(255, 122, 24, 0.38);
    color: #ffb16a;
    background: rgba(255, 122, 24, 0.12);
  }
`;

const AgentCardGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  min-height: 0;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
  }
`;

const AgentCard = styled.section`
  position: relative;
  display: grid;
  align-content: start;
  gap: 12px;
  min-height: 100%;
  overflow: hidden;
  padding: 16px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.012)),
    rgba(6, 9, 16, 0.78);
  transition:
    border-color 160ms ease,
    background 160ms ease,
    transform 160ms ease;

  &::before {
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: rgba(255, 255, 255, 0.12);
    content: "";
  }

  &:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.018)),
      rgba(8, 13, 20, 0.88);
    transform: translateY(-1px);
  }

  &[data-tone="ready"] {
    border-color: rgba(47, 128, 255, 0.32);
  }

  &[data-tone="ready"]::before {
    background: #2f80ff;
  }

  &[data-tone="needsAuth"] {
    border-color: rgba(255, 122, 24, 0.32);
  }

  &[data-tone="needsAuth"]::before {
    background: #ff7a18;
  }
`;

const AgentCardHeader = styled.div`
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
`;

const AgentIcon = styled.span`
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(255, 255, 255, 0.04);

  svg {
    width: 19px;
    height: 19px;
  }

  &[data-tone="ready"] {
    border-color: rgba(47, 128, 255, 0.36);
    color: #62a0ff;
    background: rgba(47, 128, 255, 0.14);
  }

  &[data-tone="needsAuth"] {
    border-color: rgba(255, 122, 24, 0.36);
    color: #ff9a3d;
    background: rgba(255, 122, 24, 0.14);
  }
`;

const AgentName = styled.h3`
  margin: 0;
  overflow: hidden;
  color: #f7f9ff;
  font-size: 15px;
  font-weight: 900;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AgentMeta = styled.p`
  margin: 3px 0 0;
  overflow: hidden;
  color: #687386;
  font-size: 12px;
  font-weight: 760;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AgentStatusText = styled.p`
  margin: 0;
  min-height: 38px;
  color: #a7b2c2;
  font-size: 13px;
  line-height: 1.45;
`;

const AgentInstallPanel = styled.div`
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.035);
`;

const AgentInstallTopline = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #f7f9ff;
  font-size: 12px;
  font-weight: 860;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const AgentInstallBadge = styled.span`
  flex: 0 0 auto;
  padding: 4px 7px;
  border: 1px solid rgba(47, 128, 255, 0.34);
  border-radius: 999px;
  color: #8bb9ff;
  background: rgba(47, 128, 255, 0.12);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
`;

const AgentInstallHint = styled.p`
  margin: 0;
  color: #8793a5;
  font-size: 12px;
  font-weight: 720;
  line-height: 1.45;
`;

const AgentInstallActions = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
`;

const AgentInstallCommand = styled.code`
  display: block;
  min-width: 0;
  overflow: hidden;
  padding: 8px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(3, 5, 8, 0.54);
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AgentInstallMessage = styled.p`
  margin: 0;
  padding: 8px 9px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  color: #a7b2c2;
  background: rgba(6, 9, 16, 0.58);
  font-size: 12px;
  font-weight: 760;
  line-height: 1.45;
  overflow-wrap: anywhere;

  &[data-tone="success"] {
    border-color: rgba(47, 128, 255, 0.32);
    color: #8bb9ff;
    background: rgba(47, 128, 255, 0.1);
  }

  &[data-tone="warning"] {
    border-color: rgba(255, 122, 24, 0.34);
    color: #ffb269;
    background: rgba(255, 122, 24, 0.1);
  }
`;

const AgentActions = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`;

const AgentActionTooltip = styled.span`
  display: block;
  min-width: 0;

  button {
    width: 100%;
  }
`;

const PageHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 16px;

  @media (max-width: 760px) {
    align-items: flex-start;
    flex-direction: column;
  }
`;

const PageSubline = styled.p`
  margin: 7px 0 0;
  color: #a7b2c2;
  font-size: 14px;
  line-height: 1.5;
`;

const DashboardTitle = styled.h1`
  margin: 6px 0 0;
  color: #ffffff;
  font-size: 28px;
  font-weight: 850;
  letter-spacing: 0;
`;

const PanelHeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;

  > div:first-child {
    min-width: 0;
  }
`;

const PanelKicker = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.11em;
  text-transform: uppercase;
`;

const PanelHeading = styled.h2`
  margin: 4px 0 0;
  color: #f7f9ff;
  font-size: 17px;
  font-weight: 900;
  letter-spacing: 0;
`;

const SettingsPage = styled.section`
  display: grid;
  grid-column: 2 / -1;
  align-content: start;
  gap: 18px;
  min-height: 0;
  overflow: auto;
  padding: 24px;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px),
    linear-gradient(180deg, rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    rgba(3, 5, 8, 0.1);
  background-size: 72px 72px, 72px 72px, auto;
  animation: ${panelEnter} ${VIEW_TRANSITION_MS + 90}ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &[data-motion="exiting"] {
    animation: ${panelExit} ${VIEW_TRANSITION_MS}ms ease both;
    pointer-events: none;
  }

  @media (max-width: 760px) {
    grid-column: 1;
    padding: 18px;
  }
`;

const AccountSettingsPanel = styled.section`
  display: grid;
  gap: 14px;
  padding-top: 8px;
`;

const AccountCard = styled.section`
  display: grid;
  gap: 16px;
  padding: 18px;
  border: 1px solid rgba(47, 128, 255, 0.32);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(47, 128, 255, 0.13), transparent 38%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.016)),
    rgba(13, 20, 31, 0.86);
`;

const AccountCardHeader = styled.div`
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;

  > div:first-child {
    display: grid;
    min-width: min(100%, 280px);
    gap: 10px;
  }
`;

const AccountCardFooter = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding-top: 2px;

  button {
    min-height: 42px;
    min-width: 132px;
  }

  @media (max-width: 760px) {
    align-items: stretch;
    flex-direction: column;
  }
`;

const SettingsLabel = styled.p`
  margin: 0;
  color: #ff9a3d;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.1em;
  text-transform: uppercase;
`;

const SettingsValue = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #ffffff;
  font-size: 19px;
  font-weight: 820;
  line-height: 1.25;
`;

const SettingsHint = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #a7b2c2;
  font-size: 13px;
  line-height: 1.55;
`;

const SettingsIdentityGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-top: 4px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const SettingsIdentityItem = styled.div`
  display: grid;
  min-width: 0;
  gap: 5px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.09);
  border-radius: 8px;
  background: rgba(6, 9, 16, 0.58);

  span {
    color: #687386;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: #f7f9ff;
    font-size: 13px;
    font-weight: 860;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const LoginCard = styled.section`
  position: relative;
  z-index: 1;
  width: 100%;
  padding: clamp(20px, 4vh, 30px);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  background:
    radial-gradient(circle at 86% 10%, rgba(47, 128, 255, 0.16), transparent 14rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.045), rgba(255, 255, 255, 0.018)),
    rgba(10, 15, 23, 0.88);
  box-shadow: 0 28px 90px rgba(0, 0, 0, 0.46);
  animation: ${sideReveal} 320ms cubic-bezier(0.2, 0.8, 0.2, 1) 110ms both;

  @media (max-width: 860px) {
    padding: 24px;
  }
`;

const LoginPanel = styled.div`
  display: grid;
  gap: clamp(12px, 2.4vh, 18px);
`;

const SessionPanel = styled.div`
  display: grid;
  gap: 16px;
`;

const LoginCardTop = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
`;

const LoginCardBadge = styled.span`
  padding: 5px 9px;
  border: 1px solid rgba(47, 128, 255, 0.36);
  border-radius: 8px;
  color: #62a0ff;
  background: rgba(47, 128, 255, 0.14);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  &[data-state="waiting"],
  &[data-state="exchanging"] {
    border-color: rgba(255, 122, 24, 0.36);
    color: #ff9a3d;
    background: rgba(255, 122, 24, 0.14);
  }
`;

const LoginIconWrap = styled.span`
  display: grid;
  width: clamp(38px, 6vh, 44px);
  height: clamp(38px, 6vh, 44px);
  place-items: center;
  border: 1px solid rgba(47, 128, 255, 0.42);
  border-radius: 8px;
  color: #62a0ff;
  background: rgba(47, 128, 255, 0.14);
  box-shadow: 0 0 18px rgba(47, 128, 255, 0.14);
  transition:
    background 180ms ease,
    border-color 180ms ease,
    color 180ms ease,
    transform 180ms ease;

  ${LoginPanel}:hover & {
    transform: translateY(-1px) scale(1.02);
  }
`;

const SuccessBadge = styled(LoginIconWrap)`
  border-color: rgba(255, 122, 24, 0.42);
  color: #ff9a3d;
  background: rgba(255, 122, 24, 0.14);
`;

const SessionTitle = styled.h2`
  margin: 0;
  color: #ffffff;
  font-size: clamp(21px, 3.5vh, 24px);
  font-weight: 820;
  letter-spacing: 0;
`;

const SessionText = styled.p`
  margin: 0;
  overflow-wrap: anywhere;
  color: #a7b2c2;
  font-size: 15px;
  line-height: 1.55;
`;

const AuthStepRail = styled.div`
  display: grid;
  gap: 9px;
  padding: clamp(10px, 2vh, 14px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.22);
`;

const AuthStep = styled.div`
  display: grid;
  min-height: clamp(30px, 5vh, 38px);
  grid-template-columns: 24px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  color: #a7b2c2;
  font-size: 12px;
  font-weight: 800;
  opacity: 0;
  animation: ${panelEnter} 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both;

  &:nth-child(1) {
    animation-delay: 170ms;
  }

  &:nth-child(2) {
    animation-delay: 205ms;
  }

  &:nth-child(3) {
    animation-delay: 240ms;
  }

  span {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    color: #687386;
    background: rgba(255, 255, 255, 0.04);
    font-size: 11px;
  }

  &[data-active="true"] {
    color: #f7f9ff;
  }

  &[data-active="true"] span {
    border-color: rgba(47, 128, 255, 0.42);
    color: #62a0ff;
    background: rgba(47, 128, 255, 0.14);
  }
`;

const PrimaryButton = styled.button`
  display: inline-flex;
  min-width: 0;
  min-height: clamp(44px, 6.5vh, 50px);
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 8px;
  color: #ffffff;
  background: #2f80ff;
  font-weight: 880;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;

  &:hover:not(:disabled) {
    background: #62a0ff;
    box-shadow: 0 0 18px rgba(47, 128, 255, 0.24);
    transform: translateY(-1px);
  }

  &:disabled {
    opacity: 0.7;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const SecondaryButton = styled(PrimaryButton)`
  border: 1px solid rgba(255, 255, 255, 0.14);
  color: #f7f9ff;
  background: rgba(6, 9, 16, 0.76);

  &:hover:not(:disabled) {
    border-color: rgba(47, 128, 255, 0.5);
    background: rgba(255, 255, 255, 0.08);
  }
`;

const PrimaryDangerButton = styled(SecondaryButton)`
  border-color: rgba(255, 140, 140, 0.28);
  color: #ffd2d2;

  &:hover:not(:disabled) {
    border-color: rgba(255, 140, 140, 0.5);
    background: rgba(255, 140, 140, 0.1);
  }
`;

const FormMessage = styled.p`
  margin: 0;
  padding: ${({ $state }) => ($state === "error" ? "11px 13px" : 0)};
  border: ${({ $state }) => ($state === "error" ? "1px solid rgba(255, 107, 107, 0.34)" : 0)};
  border-radius: ${({ $state }) => ($state === "error" ? "8px" : 0)};
  color: ${({ $state }) => ($state === "error" ? "#ffd0d0" : "#a7b2c2")};
  background: ${({ $state }) => ($state === "error" ? "rgba(255, 107, 107, 0.12)" : "transparent")};
  font-size: 14px;
  line-height: 1.55;
`;

const buttonIconSize = `
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
`;

const titleIconSize = `
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
`;

const TitleMinimizeIcon = styled(Remove)`
  ${titleIconSize}
`;

const TitleMaximizeIcon = styled(CropSquare)`
  ${titleIconSize}
`;

const TitleCloseIcon = styled(Close)`
  ${titleIconSize}
`;

const ButtonRefreshIcon = styled(Refresh)`
  ${buttonIconSize}
`;

const ButtonLoginIcon = styled(Login)`
  ${buttonIconSize}
`;

const ButtonBrowserIcon = styled(OpenInBrowser)`
  ${buttonIconSize}
`;

const ButtonLogoutIcon = styled(Logout)`
  ${buttonIconSize}
`;

const ButtonSettingsIcon = styled(Settings)`
  ${buttonIconSize}
`;

const ButtonForgeIcon = styled(Bolt)`
  ${buttonIconSize}
`;

const ButtonCodeIcon = styled(Code)`
  ${buttonIconSize}
`;

const ButtonBotIcon = styled(SmartToy)`
  ${buttonIconSize}
`;

const ButtonTerminalIcon = styled(TerminalIcon)`
  ${buttonIconSize}
`;

const ButtonKeyIcon = styled(Key)`
  ${buttonIconSize}
`;

const ButtonCheckIcon = styled(CheckCircle)`
  ${buttonIconSize}
`;

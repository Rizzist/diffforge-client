import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { Webview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import {
  ButtonBrowserIcon,
  ButtonRefreshIcon,
  FormMessage,
  PageSubline,
} from "../app/appStyles";

const WEB_SESSION_STORAGE_KEY = "diffforge.workspaceWebSessions.v1";
const DEFAULT_WEB_URL = "http://127.0.0.1:5173";
const PROCESS_REFRESH_MS = 7000;
const WEBVIEW_MIN_SIZE_PX = 12;

function getErrorMessage(error, fallback = "Unable to update web view.") {
  if (typeof error === "string" && error.trim()) {
    return error;
  }
  if (error?.message) {
    return error.message;
  }
  return fallback;
}

function safeWorkspaceKey(workspaceId) {
  return String(workspaceId || "workspace")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 48) || "workspace";
}

function webviewLabelForWorkspace(workspaceId) {
  return `workspace-web-${safeWorkspaceKey(workspaceId)}`;
}

function readWebSessions() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(WEB_SESSION_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readWorkspaceUrl(workspaceId) {
  const sessions = readWebSessions();
  const entry = sessions[safeWorkspaceKey(workspaceId)] || sessions[workspaceId];
  const url = typeof entry?.url === "string" ? entry.url.trim() : "";
  return url || DEFAULT_WEB_URL;
}

function persistWorkspaceUrl(workspaceId, url) {
  try {
    const sessions = readWebSessions();
    sessions[safeWorkspaceKey(workspaceId)] = {
      updatedAt: new Date().toISOString(),
      url,
    };
    window.localStorage.setItem(WEB_SESSION_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Web view history is a convenience; navigation still works if persistence is unavailable.
  }
}

function normalizeProcessRoots(rootDirectory, defaultWorkingDirectory) {
  const seen = new Set();
  return [rootDirectory, defaultWorkingDirectory]
    .map((root) => String(root || "").trim())
    .filter(Boolean)
    .filter((root) => {
      const key = root.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function isLoopbackAddress(address) {
  const value = String(address || "").trim().toLowerCase();
  return !value
    || value === "*"
    || value === "0.0.0.0"
    || value === "::"
    || value === "[::]"
    || value === "127.0.0.1"
    || value === "::1"
    || value === "[::1]"
    || value === "localhost";
}

function processUrlSuggestions(snapshot) {
  const suggestions = new Map();
  const processes = Array.isArray(snapshot?.processes) ? snapshot.processes : [];

  for (const process of processes) {
    const ports = Array.isArray(process?.boundPorts) ? process.boundPorts : [];
    for (const port of ports) {
      const portNumber = Number(port?.port || 0);
      if (!Number.isInteger(portNumber) || portNumber <= 0) {
        continue;
      }

      const address = isLoopbackAddress(port?.address) ? "127.0.0.1" : String(port.address || "127.0.0.1");
      const url = `http://${address}:${portNumber}`;
      const label = process.displayName || process.name || process.groupLabel || `Port ${portNumber}`;
      suggestions.set(url, {
        label,
        port: portNumber,
        url,
      });
    }
  }

  return Array.from(suggestions.values()).sort((left, right) => (
    left.port - right.port || left.label.localeCompare(right.label)
  )).slice(0, 8);
}

function localUrlBadge(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return "Web";
  }
}

export default function WebWorkspaceView({
  defaultWorkingDirectory = "",
  rootDirectory = "",
  workspace,
}) {
  const workspaceId = workspace?.id || "";
  const webviewLabel = useMemo(() => webviewLabelForWorkspace(workspaceId), [workspaceId]);
  const initialUrl = useMemo(() => readWorkspaceUrl(workspaceId), [workspaceId]);
  const [draftUrl, setDraftUrl] = useState(initialUrl);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [processSnapshot, setProcessSnapshot] = useState(null);
  const [processState, setProcessState] = useState("idle");
  const viewportRef = useRef(null);
  const webviewRef = useRef(null);
  const boundsFrameRef = useRef(0);
  const hiddenRef = useRef(false);
  const navigationSerialRef = useRef(0);
  const currentUrlRef = useRef(currentUrl);

  const processRoots = useMemo(
    () => normalizeProcessRoots(rootDirectory, defaultWorkingDirectory),
    [defaultWorkingDirectory, rootDirectory],
  );
  const processRootsKey = processRoots.join("\n");
  const suggestions = useMemo(() => processUrlSuggestions(processSnapshot), [processSnapshot]);
  const activeBadge = localUrlBadge(currentUrl);
  const suggestionsListId = useMemo(
    () => `workspace-web-url-suggestions-${safeWorkspaceKey(workspaceId)}`,
    [workspaceId],
  );

  useEffect(() => {
    currentUrlRef.current = currentUrl;
  }, [currentUrl]);

  useEffect(() => {
    const nextUrl = readWorkspaceUrl(workspaceId);
    setDraftUrl(nextUrl);
    setCurrentUrl(nextUrl);
    setError("");
    setStatus("idle");
  }, [workspaceId]);

  const hideCurrentWebview = useCallback(async () => {
    hiddenRef.current = true;
    window.cancelAnimationFrame(boundsFrameRef.current);
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    try {
      await webview.hide();
    } catch {
      // The native view may have been destroyed during app/window shutdown.
    }
  }, []);

  const updateBounds = useCallback(async () => {
    const webview = webviewRef.current;
    const viewport = viewportRef.current;
    if (!webview || !viewport || hiddenRef.current) {
      return;
    }

    const rect = viewport.getBoundingClientRect();
    const width = Math.max(0, Math.round(rect.width));
    const height = Math.max(0, Math.round(rect.height));
    const x = Math.round(rect.left);
    const y = Math.round(rect.top);

    if (width < WEBVIEW_MIN_SIZE_PX || height < WEBVIEW_MIN_SIZE_PX) {
      try {
        await webview.hide();
      } catch {
        // Best-effort hide; a stale webview will be recreated on the next navigation.
      }
      return;
    }

    try {
      await webview.setPosition(new LogicalPosition(x, y));
      await webview.setSize(new LogicalSize(width, height));
      await webview.show();
    } catch (boundsError) {
      setError(getErrorMessage(boundsError, "Unable to place the web view."));
    }
  }, []);

  const scheduleBoundsUpdate = useCallback(() => {
    window.cancelAnimationFrame(boundsFrameRef.current);
    boundsFrameRef.current = window.requestAnimationFrame(() => {
      updateBounds();
    });
  }, [updateBounds]);

  const getOrCreateWebview = useCallback(async (url) => {
    hiddenRef.current = false;

    if (webviewRef.current?.label === webviewLabel) {
      return { created: false, webview: webviewRef.current };
    }

    if (webviewRef.current && webviewRef.current.label !== webviewLabel) {
      await hideCurrentWebview();
      webviewRef.current = null;
    }

    const existing = await Webview.getByLabel(webviewLabel);
    if (existing) {
      webviewRef.current = existing;
      scheduleBoundsUpdate();
      return { created: false, webview: existing };
    }

    const viewport = viewportRef.current;
    const rect = viewport?.getBoundingClientRect();
    const width = Math.max(WEBVIEW_MIN_SIZE_PX, Math.round(rect?.width || 640));
    const height = Math.max(WEBVIEW_MIN_SIZE_PX, Math.round(rect?.height || 360));
    const x = Math.round(rect?.left || 0);
    const y = Math.round(rect?.top || 0);
    const parentWindow = getCurrentWindow();
    const createdWebview = new Webview(parentWindow, webviewLabel, {
      acceptFirstMouse: true,
      devtools: true,
      dragDropEnabled: false,
      focus: false,
      height,
      url,
      width,
      x,
      y,
    });

    webviewRef.current = createdWebview;
    createdWebview.once("tauri://created", () => {
      setStatus("ready");
      setError("");
      scheduleBoundsUpdate();
    }).catch(() => {});
    createdWebview.once("tauri://error", (event) => {
      setStatus("error");
      setError(getErrorMessage(event?.payload, "Unable to create the web view."));
    }).catch(() => {});

    scheduleBoundsUpdate();
    return { created: true, webview: createdWebview };
  }, [hideCurrentWebview, scheduleBoundsUpdate, webviewLabel]);

  const navigate = useCallback(async (nextUrl) => {
    const rawUrl = String(nextUrl || "").trim();
    if (!rawUrl || !workspaceId) {
      return;
    }

    const serial = navigationSerialRef.current + 1;
    navigationSerialRef.current = serial;
    setStatus("loading");
    setError("");

    try {
      const normalizedUrl = await invoke("workspace_web_normalize_url", { url: rawUrl });
      const { created } = await getOrCreateWebview(normalizedUrl);

      if (navigationSerialRef.current !== serial) {
        return;
      }

      if (!created) {
        try {
          await invoke("workspace_web_navigate", {
            label: webviewLabel,
            url: normalizedUrl,
          });
        } catch (navigateError) {
          const missing = getErrorMessage(navigateError, "").toLowerCase().includes("not found");
          if (!missing) {
            throw navigateError;
          }
          webviewRef.current = null;
          await getOrCreateWebview(normalizedUrl);
        }
      }

      if (navigationSerialRef.current !== serial) {
        return;
      }

      setCurrentUrl(normalizedUrl);
      setDraftUrl(normalizedUrl);
      persistWorkspaceUrl(workspaceId, normalizedUrl);
      setStatus("ready");
      scheduleBoundsUpdate();
    } catch (navigateError) {
      if (navigationSerialRef.current !== serial) {
        return;
      }
      setStatus("error");
      setError(getErrorMessage(navigateError));
    }
  }, [getOrCreateWebview, scheduleBoundsUpdate, webviewLabel, workspaceId]);

  const reload = useCallback(async () => {
    if (!workspaceId) {
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const { created } = await getOrCreateWebview(currentUrlRef.current);
      if (!created) {
        await invoke("workspace_web_reload", { label: webviewLabel });
      }
      setStatus("ready");
      scheduleBoundsUpdate();
    } catch (reloadError) {
      setStatus("error");
      setError(getErrorMessage(reloadError, "Unable to reload the web view."));
    }
  }, [getOrCreateWebview, scheduleBoundsUpdate, webviewLabel, workspaceId]);

  const loadProcesses = useCallback(async ({ silent = false } = {}) => {
    if (!workspaceId) {
      return;
    }

    setProcessState(silent ? "refreshing" : "loading");
    try {
      const snapshot = await invoke("list_developer_processes", {
        activeWorkspaceRoot: rootDirectory || "",
        workspaceRoots: processRoots,
      });
      setProcessSnapshot(snapshot);
      setProcessState("idle");
    } catch {
      setProcessState("idle");
    }
  }, [processRootsKey, rootDirectory, workspaceId]);

  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      await loadProcesses();
    };
    sync();
    const intervalId = window.setInterval(() => {
      if (!cancelled && document.visibilityState !== "hidden") {
        loadProcesses({ silent: true });
      }
    }, PROCESS_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [loadProcesses]);

  useEffect(() => {
    if (!workspaceId) {
      return undefined;
    }

    let cancelled = false;
    const show = async () => {
      try {
        const normalizedUrl = await invoke("workspace_web_normalize_url", { url: currentUrlRef.current });
        if (cancelled) {
          return;
        }
        setCurrentUrl(normalizedUrl);
        setDraftUrl((draft) => (draft ? draft : normalizedUrl));
        await getOrCreateWebview(normalizedUrl);
        if (!cancelled) {
          scheduleBoundsUpdate();
        }
      } catch (showError) {
        if (!cancelled) {
          setError(getErrorMessage(showError));
          setStatus("error");
        }
      }
    };

    show();

    return () => {
      cancelled = true;
      hideCurrentWebview();
    };
  }, [getOrCreateWebview, hideCurrentWebview, scheduleBoundsUpdate, workspaceId]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) {
      return undefined;
    }

    const observer = new ResizeObserver(scheduleBoundsUpdate);
    observer.observe(viewport);
    window.addEventListener("resize", scheduleBoundsUpdate);
    window.addEventListener("focus", scheduleBoundsUpdate);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleBoundsUpdate);
      window.removeEventListener("focus", scheduleBoundsUpdate);
      window.cancelAnimationFrame(boundsFrameRef.current);
    };
  }, [scheduleBoundsUpdate]);

  const handleSubmit = (event) => {
    event.preventDefault();
    navigate(draftUrl);
  };

  const hasSuggestions = suggestions.length > 0;
  const isBusy = status === "loading";

  return (
    <WebWorkspaceSurface aria-label="Workspace web view">
      <WebToolbar>
        <WebAddressForm onSubmit={handleSubmit}>
          <WebToolbarLabel
            data-state={status}
            title={
              processState === "loading" || processState === "refreshing"
                ? "Scanning workspace ports"
                : workspace?.name || "Workspace web"
            }
          >
            <span />
            {isBusy ? "Loading" : status === "error" ? "Needs attention" : activeBadge}
          </WebToolbarLabel>
          <WebAddressInput
            aria-label="Web view URL"
            autoCapitalize="none"
            autoCorrect="off"
            list={hasSuggestions ? suggestionsListId : undefined}
            onChange={(event) => setDraftUrl(event.target.value)}
            placeholder="localhost:5173 or https://example.com"
            spellCheck={false}
            value={draftUrl}
          />
          {hasSuggestions && (
            <datalist id={suggestionsListId}>
              {suggestions.map((suggestion) => (
                <option
                  key={suggestion.url}
                  label={`${suggestion.label} :${suggestion.port}`}
                  value={suggestion.url}
                />
              ))}
            </datalist>
          )}
          <WebIconButton
            aria-label="Open URL"
            disabled={isBusy || !draftUrl.trim()}
            title="Open URL"
            type="submit"
          >
            <ButtonBrowserIcon aria-hidden="true" />
          </WebIconButton>
          <WebIconButton
            aria-label="Reload"
            disabled={isBusy || !currentUrl}
            onClick={reload}
            title="Reload"
            type="button"
          >
            <ButtonRefreshIcon aria-hidden="true" />
          </WebIconButton>
        </WebAddressForm>

        {error && <FormMessage $state="error">{error}</FormMessage>}
      </WebToolbar>

      <WebViewportShell>
        <WebNativeViewport ref={viewportRef} aria-label="Native browser viewport" />
        <WebViewportOverlay aria-hidden="true" data-visible={!currentUrl || status === "error"}>
          <ButtonBrowserIcon />
          <PageSubline>{error ? "Web view paused" : "Open a URL to start browsing."}</PageSubline>
        </WebViewportOverlay>
      </WebViewportShell>
    </WebWorkspaceSurface>
  );
}

const WebWorkspaceSurface = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  background: #05070a;
`;

const WebToolbar = styled.header`
  position: relative;
  z-index: 5;
  display: grid;
  gap: 6px;
  min-height: 42px;
  padding: 5px 8px;
  border-bottom: 1px solid rgba(142, 153, 171, 0.14);
  background: #06090e;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22);
`;

const WebToolbarLabel = styled.div`
  display: inline-flex;
  min-width: 0;
  max-width: 170px;
  height: 30px;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid rgba(125, 160, 205, 0.15);
  border-radius: 7px;
  box-sizing: border-box;
  color: #cbd5e1;
  background: rgba(13, 18, 27, 0.86);
  overflow: hidden;
  font-size: 11px;
  font-weight: 820;
  line-height: 1;
  white-space: nowrap;

  span {
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: #59b38f;
    box-shadow: 0 0 12px rgba(89, 179, 143, 0.42);
  }

  &[data-state="loading"] span {
    background: #eab308;
    box-shadow: 0 0 12px rgba(234, 179, 8, 0.42);
  }

  &[data-state="error"] {
    border-color: rgba(239, 107, 107, 0.34);
    color: #ffc8c8;
  }

  &[data-state="error"] span {
    background: #ef6b6b;
    box-shadow: 0 0 12px rgba(239, 107, 107, 0.42);
  }
`;

const WebAddressForm = styled.form`
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr) 32px 32px;
  align-items: center;
  gap: 6px;

  @media (max-width: 720px) {
    grid-template-columns: minmax(0, 1fr) 32px 32px;

    ${WebToolbarLabel} {
      display: none;
    }
  }
`;

const WebAddressInput = styled.input`
  width: 100%;
  min-width: 0;
  height: 30px;
  padding: 0 11px;
  border: 1px solid rgba(142, 153, 171, 0.17);
  border-radius: 7px;
  box-sizing: border-box;
  color: #f2f5f9;
  background: #020409;
  font: inherit;
  font-size: 12px;
  font-weight: 760;
  outline: none;

  &::placeholder {
    color: #677385;
  }

  &:focus {
    border-color: rgba(96, 165, 250, 0.56);
    box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.12);
  }
`;

const WebIconButton = styled.button`
  display: grid;
  width: 32px;
  height: 30px;
  min-width: 32px;
  place-items: center;
  border: 1px solid rgba(142, 153, 171, 0.17);
  border-radius: 7px;
  color: #cbd5e1;
  background: rgba(16, 22, 32, 0.9);
  cursor: pointer;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    color 150ms ease;

  svg {
    width: 17px;
    height: 17px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(96, 165, 250, 0.38);
    color: #ffffff;
    background: rgba(37, 99, 235, 0.28);
  }

  &:disabled {
    cursor: default;
    opacity: 0.48;
  }
`;

const WebViewportShell = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #0b0f14;
`;

const WebNativeViewport = styled.div`
  position: absolute;
  inset: 0;
  min-width: 0;
  min-height: 0;
  background: #ffffff;
`;

const WebViewportOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: #9aa7b8;
  background:
    linear-gradient(90deg, rgba(230, 236, 245, 0.026) 1px, transparent 1px),
    linear-gradient(180deg, rgba(230, 236, 245, 0.022) 1px, transparent 1px),
    #070a0f;
  background-size: 72px 72px, 72px 72px, auto;
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease;

  svg {
    width: 42px;
    height: 42px;
    color: #718097;
  }

  &[data-visible="true"] {
    opacity: 1;
  }
`;

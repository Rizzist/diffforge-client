import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { ArrowForward } from "@styled-icons/material-rounded/ArrowForward";
import { Language } from "@styled-icons/material-rounded/Language";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { Search } from "@styled-icons/material-rounded/Search";

const DEFAULT_WEB_URL = "https://www.google.com";
const SEARCH_URL = "https://www.google.com/search?q=";
const LOCAL_HOST_PATTERN = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;
const WORKSPACE_WEBVIEW_LOAD_EVENT = "workspace-webview-load";
const NATIVE_LOAD_TIMEOUT_MS = 12000;

function hasTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function normalizeWebInput(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(raw);
  if (hasScheme) {
    try {
      const url = new URL(raw);
      if (url.protocol === "http:" || url.protocol === "https:") {
        return url.href;
      }
      return "";
    } catch {
      return "";
    }
  }

  if (LOCAL_HOST_PATTERN.test(raw)) {
    try {
      return new URL(`http://${raw}`).href;
    } catch {
      return "";
    }
  }

  const looksLikeHost = /^[^\s/]+\.[^\s]+/.test(raw);
  if (looksLikeHost) {
    try {
      return new URL(`https://${raw}`).href;
    } catch {
      return "";
    }
  }

  return `${SEARCH_URL}${encodeURIComponent(raw)}`;
}

function webviewLabelForWorkspace(workspace, sequence) {
  const raw = [
    workspace?.id,
    workspace?.name,
  ]
    .filter(Boolean)
    .join("-")
    .toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54) || "workspace";
  return `workspace-web-${slug}-${sequence}`;
}

function hostForUrl(url) {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function viewportNativeRect(viewport) {
  if (!viewport) {
    return null;
  }
  const rect = viewport.getBoundingClientRect();
  return {
    height: Math.max(0, Math.round(rect.height)),
    width: Math.max(0, Math.round(rect.width)),
    x: Math.max(0, Math.round(rect.left)),
    y: Math.max(0, Math.round(rect.top)),
  };
}

export default function WebWorkspaceView({ workspace }) {
  const [history, setHistory] = useState(() => [DEFAULT_WEB_URL]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [addressValue, setAddressValue] = useState(DEFAULT_WEB_URL);
  const [addressError, setAddressError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [nativeEnabled, setNativeEnabled] = useState(() => hasTauriRuntime());
  const [nativeStatus, setNativeStatus] = useState("idle");
  const viewportRef = useRef(null);
  const nativeLabelRef = useRef("");
  const nativeGenerationRef = useRef(0);
  const nativeRectRef = useRef("");
  const nativeStatusRef = useRef("idle");
  const nativeTimeoutRef = useRef(0);
  const mountedRef = useRef(false);

  const currentUrl = history[historyIndex] || DEFAULT_WEB_URL;
  const currentHost = useMemo(() => hostForUrl(currentUrl), [currentUrl]);
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setAddressValue(currentUrl);
  }, [currentUrl]);

  useEffect(() => {
    nativeStatusRef.current = nativeStatus;
  }, [nativeStatus]);

  const clearNativeLoadTimeout = useCallback(() => {
    if (nativeTimeoutRef.current) {
      window.clearTimeout(nativeTimeoutRef.current);
      nativeTimeoutRef.current = 0;
    }
  }, []);

  const closeNativeWebview = useCallback(async (label = nativeLabelRef.current) => {
    clearNativeLoadTimeout();
    const safeLabel = String(label || "").trim();
    if (nativeLabelRef.current === safeLabel) {
      nativeLabelRef.current = "";
    }
    nativeRectRef.current = "";
    nativeGenerationRef.current += 1;
    if (!safeLabel || !hasTauriRuntime()) {
      return;
    }
    await invoke("workspace_webview_close", { label: safeLabel }).catch(() => {});
  }, [clearNativeLoadTimeout]);

  const fitNativeWebview = useCallback(async (label = nativeLabelRef.current, visible = nativeStatusRef.current === "ready") => {
    const viewport = viewportRef.current;
    const safeLabel = String(label || "").trim();
    if (!safeLabel || !viewport || !nativeEnabled || !hasTauriRuntime()) {
      return false;
    }

    const rect = viewportNativeRect(viewport);
    if (!rect) {
      return false;
    }

    if (rect.width < 24 || rect.height < 24) {
      await invoke("workspace_webview_fit", {
        height: rect.height,
        label: safeLabel,
        visible: false,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      }).catch(() => {});
      return false;
    }

    const rectKey = `${rect.x}:${rect.y}:${rect.width}:${rect.height}:${visible ? "show" : "hide"}`;
    if (nativeRectRef.current !== rectKey) {
      nativeRectRef.current = rectKey;
      await invoke("workspace_webview_fit", {
        height: rect.height,
        label: safeLabel,
        visible,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      });
    }
    return true;
  }, [nativeEnabled]);

  const openNativeWebview = useCallback(async (targetUrl) => {
    if (!nativeEnabled || !hasTauriRuntime()) {
      return false;
    }

    const viewport = viewportRef.current;
    if (!viewport) {
      return false;
    }

    const rect = viewportNativeRect(viewport);
    if (!rect || rect.width < 24 || rect.height < 24) {
      return false;
    }

    const generation = nativeGenerationRef.current + 1;
    nativeGenerationRef.current = generation;
    const previousLabel = nativeLabelRef.current;
    const label = webviewLabelForWorkspace(workspace, generation);
    nativeLabelRef.current = label;
    nativeRectRef.current = "";
    clearNativeLoadTimeout();
    if (previousLabel) {
      await invoke("workspace_webview_close", { label: previousLabel }).catch(() => {});
    }

    if (mountedRef.current) {
      setNativeStatus("loading");
    }

    nativeTimeoutRef.current = window.setTimeout(() => {
      if (!mountedRef.current || nativeGenerationRef.current !== generation || nativeLabelRef.current !== label) {
        return;
      }
      nativeLabelRef.current = "";
      nativeRectRef.current = "";
      setNativeStatus("fallback");
      setNativeEnabled(false);
      void invoke("workspace_webview_close", { label }).catch(() => {});
    }, NATIVE_LOAD_TIMEOUT_MS);

    try {
      await invoke("workspace_webview_open", {
        height: rect.height,
        label,
        url: targetUrl,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      });
      return true;
    } catch {
      if (mountedRef.current && nativeGenerationRef.current === generation) {
        clearNativeLoadTimeout();
        nativeLabelRef.current = "";
        setNativeStatus("fallback");
        setNativeEnabled(false);
      }
      return false;
    }
  }, [clearNativeLoadTimeout, nativeEnabled, workspace]);

  const retryNativeOnNavigation = useCallback(() => {
    if (hasTauriRuntime()) {
      setNativeEnabled(true);
    }
  }, []);

  useEffect(() => {
    if (!hasTauriRuntime()) {
      return undefined;
    }

    let disposed = false;
    let unlistenLoad = null;
    listen(WORKSPACE_WEBVIEW_LOAD_EVENT, (event) => {
      const payload = event?.payload || {};
      const label = String(payload.label || "").trim();
      if (!label || label !== nativeLabelRef.current) {
        return;
      }

      const loadEvent = String(payload.event || "").trim().toLowerCase();
      if (loadEvent === "started") {
        nativeStatusRef.current = "loading";
        setNativeStatus("loading");
        void fitNativeWebview(label, false).catch(() => {});
        return;
      }

      if (loadEvent === "finished") {
        clearNativeLoadTimeout();
        nativeStatusRef.current = "ready";
        setNativeStatus("ready");
        void fitNativeWebview(label, true).catch(() => {});
      }
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenLoad = unlisten;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (typeof unlistenLoad === "function") {
        unlistenLoad();
      }
    };
  }, [clearNativeLoadTimeout, fitNativeWebview]);

  useEffect(() => {
    if (!nativeEnabled) {
      void closeNativeWebview();
      return undefined;
    }

    let disposed = false;
    window.requestAnimationFrame(() => {
      if (!disposed) {
        void openNativeWebview(currentUrl);
      }
    });

    return () => {
      disposed = true;
    };
  }, [closeNativeWebview, currentUrl, nativeEnabled, openNativeWebview, reloadKey]);

  useEffect(() => () => {
    void closeNativeWebview();
  }, [closeNativeWebview]);

  useEffect(() => {
    if (!nativeEnabled) {
      return undefined;
    }

    let frameHandle = 0;
    let burstCount = 0;
    const scheduleFit = () => {
      window.cancelAnimationFrame(frameHandle);
      frameHandle = window.requestAnimationFrame(() => {
        void fitNativeWebview();
      });
    };

    const burstFit = () => {
      scheduleFit();
      burstCount += 1;
      if (burstCount < 18) {
        frameHandle = window.requestAnimationFrame(burstFit);
      }
    };

    const observer = new ResizeObserver(scheduleFit);
    if (viewportRef.current) {
      observer.observe(viewportRef.current);
    }
    window.addEventListener("resize", scheduleFit);
    frameHandle = window.requestAnimationFrame(burstFit);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleFit);
      window.cancelAnimationFrame(frameHandle);
    };
  }, [fitNativeWebview, nativeEnabled]);

  const navigateTo = useCallback((targetUrl) => {
    retryNativeOnNavigation();
    setHistory((previous) => {
      const base = previous.slice(0, historyIndex + 1);
      if (base[base.length - 1] === targetUrl) {
        return base;
      }
      return [...base, targetUrl];
    });
    setHistoryIndex((history[historyIndex] || "") === targetUrl ? historyIndex : historyIndex + 1);
    setReloadKey((key) => key + 1);
  }, [history, historyIndex, retryNativeOnNavigation]);

  const handleSubmit = useCallback((event) => {
    event.preventDefault();
    const targetUrl = normalizeWebInput(addressValue);
    if (!targetUrl) {
      setAddressError("Enter a web address or search.");
      return;
    }
    setAddressError("");
    navigateTo(targetUrl);
  }, [addressValue, navigateTo]);

  const goBack = useCallback(() => {
    setAddressError("");
    retryNativeOnNavigation();
    setHistoryIndex((index) => Math.max(0, index - 1));
  }, [retryNativeOnNavigation]);

  const goForward = useCallback(() => {
    setAddressError("");
    retryNativeOnNavigation();
    setHistoryIndex((index) => Math.min(history.length - 1, index + 1));
  }, [history.length, retryNativeOnNavigation]);

  const refresh = useCallback(() => {
    setAddressError("");
    retryNativeOnNavigation();
    setReloadKey((key) => key + 1);
  }, [retryNativeOnNavigation]);

  const openCurrentExternally = useCallback(() => {
    openUrl(currentUrl).catch(() => {
      window.open(currentUrl, "_blank", "noopener,noreferrer");
    });
  }, [currentUrl]);

  return (
    <WebSurface aria-label="Workspace web">
      <WebToolbar>
        <WebNavControls>
          <WebIconButton
            aria-label="Back"
            disabled={!canGoBack}
            onClick={goBack}
            title="Back"
            type="button"
          >
            <ArrowBack aria-hidden="true" />
          </WebIconButton>
          <WebIconButton
            aria-label="Forward"
            disabled={!canGoForward}
            onClick={goForward}
            title="Forward"
            type="button"
          >
            <ArrowForward aria-hidden="true" />
          </WebIconButton>
          <WebIconButton
            aria-label="Refresh"
            onClick={refresh}
            title="Refresh"
            type="button"
          >
            <Refresh aria-hidden="true" />
          </WebIconButton>
        </WebNavControls>

        <WebAddressForm onSubmit={handleSubmit}>
          <SearchIcon aria-hidden="true" />
          <WebAddressInput
            aria-label="Search or enter URL"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            inputMode="url"
            onChange={(event) => {
              setAddressValue(event.target.value);
              if (addressError) {
                setAddressError("");
              }
            }}
            placeholder="Search or enter URL"
            spellCheck="false"
            value={addressValue}
          />
          <WebSubmitButton aria-label="Go" title="Go" type="submit">
            <ArrowForward aria-hidden="true" />
          </WebSubmitButton>
        </WebAddressForm>

        <WebRightControls>
          <WebHostPill data-status={nativeStatus}>
            <Language aria-hidden="true" />
            <span>{currentHost}</span>
          </WebHostPill>
          <WebIconButton
            aria-label="Open in browser"
            onClick={openCurrentExternally}
            title="Open in browser"
            type="button"
          >
            <OpenInNew aria-hidden="true" />
          </WebIconButton>
        </WebRightControls>
      </WebToolbar>

      {addressError ? <WebInlineError role="alert">{addressError}</WebInlineError> : null}

      <WebViewport ref={viewportRef}>
        {nativeEnabled ? (
          <NativeWebviewBackdrop data-status={nativeStatus}>
            <Language aria-hidden="true" />
            <span>{nativeStatus === "loading" ? "Loading" : currentHost}</span>
          </NativeWebviewBackdrop>
        ) : (
          <WebFrame
            key={`${currentUrl}:${reloadKey}`}
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-presentation allow-same-origin allow-scripts"
            src={currentUrl}
            title="Workspace web view"
          />
        )}
      </WebViewport>
    </WebSurface>
  );
}

const WebSurface = styled.section`
  --web-bg: #030405;
  --web-panel: #080b10;
  --web-panel-strong: #0d121a;
  --web-border: #1d2530;
  --web-border-soft: #151b23;
  --web-text: #d5dbe4;
  --web-muted: #87919f;
  --web-blue: #68a3ff;
  --web-green: #6ee7a8;
  --web-danger: #ff9b9b;

  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
  color: var(--web-text);
  background: var(--web-bg);

  html[data-forge-theme="light"] & {
    --web-bg: #ffffff;
    --web-panel: #f5f7fb;
    --web-panel-strong: #ffffff;
    --web-border: #dce3ee;
    --web-border-soft: #e8edf4;
    --web-text: #1c2430;
    --web-muted: #687488;
    --web-blue: #0066cc;
    --web-green: #12835d;
    --web-danger: #b42318;
  }
`;

const WebToolbar = styled.header`
  display: grid;
  min-width: 0;
  min-height: 52px;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--web-border);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.025), rgba(255, 255, 255, 0)), var(--web-panel);

  @media (max-width: 820px) {
    grid-template-columns: auto minmax(0, 1fr);
  }
`;

const WebNavControls = styled.div`
  display: inline-grid;
  grid-auto-flow: column;
  grid-auto-columns: 32px;
  gap: 6px;
`;

const WebRightControls = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;

  @media (max-width: 820px) {
    display: none;
  }
`;

const WebIconButton = styled.button`
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--web-text);
  background: transparent;
  transition:
    border-color 150ms ease,
    background 150ms ease,
    color 150ms ease,
    opacity 150ms ease;

  svg {
    width: 18px;
    height: 18px;
  }

  &:hover:not(:disabled) {
    border-color: var(--web-border);
    background: rgba(255, 255, 255, 0.06);
    color: #ffffff;
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    color: var(--web-text);
    background: rgba(0, 102, 204, 0.07);
  }

  &:focus-visible {
    outline: 1px solid var(--web-blue);
    outline-offset: 2px;
  }

  &:disabled {
    cursor: default;
    opacity: 0.36;
  }
`;

const WebAddressForm = styled.form`
  display: grid;
  min-width: 0;
  height: 36px;
  grid-template-columns: 32px minmax(0, 1fr) 32px;
  align-items: center;
  border: 1px solid var(--web-border);
  border-radius: 7px;
  background: var(--web-panel-strong);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);

  &:focus-within {
    border-color: rgba(104, 163, 255, 0.76);
    box-shadow:
      0 0 0 1px rgba(104, 163, 255, 0.16),
      inset 0 1px 0 rgba(255, 255, 255, 0.035);
  }
`;

const SearchIcon = styled(Search)`
  width: 17px;
  height: 17px;
  justify-self: center;
  color: var(--web-muted);
`;

const WebAddressInput = styled.input`
  min-width: 0;
  width: 100%;
  border: 0;
  outline: 0;
  color: var(--web-text);
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;

  &::placeholder {
    color: var(--web-muted);
  }
`;

const WebSubmitButton = styled(WebIconButton)`
  width: 28px;
  height: 28px;
  justify-self: center;
  color: var(--web-blue);

  svg {
    width: 17px;
    height: 17px;
  }
`;

const WebHostPill = styled.div`
  display: inline-flex;
  max-width: 220px;
  min-width: 0;
  height: 30px;
  align-items: center;
  gap: 7px;
  padding: 0 10px;
  border: 1px solid var(--web-border);
  border-radius: 7px;
  color: var(--web-muted);
  background: rgba(255, 255, 255, 0.035);
  font-size: 12px;
  font-weight: 720;

  &[data-status="ready"] {
    border-color: rgba(110, 231, 168, 0.28);
    color: var(--web-green);
  }

  svg {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const WebInlineError = styled.div`
  min-height: 30px;
  padding: 7px 14px;
  border-bottom: 1px solid rgba(255, 155, 155, 0.24);
  color: var(--web-danger);
  background: rgba(120, 24, 24, 0.18);
  font-size: 12px;
  font-weight: 720;
`;

const WebViewport = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--web-bg);
`;

const NativeWebviewBackdrop = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 12px;
  color: var(--web-muted);
  background:
    linear-gradient(90deg, transparent, rgba(104, 163, 255, 0.04), transparent),
    var(--web-bg);
  font-size: 13px;
  font-weight: 740;

  &[data-status="loading"] {
    color: var(--web-blue);
  }

  svg {
    width: 32px;
    height: 32px;
  }
`;

const WebFrame = styled.iframe`
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
  background: #ffffff;
`;

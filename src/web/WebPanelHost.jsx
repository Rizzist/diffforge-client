import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { ArrowForward } from "@styled-icons/material-rounded/ArrowForward";
import { Close } from "@styled-icons/material-rounded/Close";
import { Language } from "@styled-icons/material-rounded/Language";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { SubdirectoryArrowLeft } from "@styled-icons/material-rounded/SubdirectoryArrowLeft";

import { GlobalStyle } from "../app/appStyles.js";
import {
  DEFAULT_WEB_URL,
  hostForUrl,
  normalizeWebInput,
  useNativeWebview,
} from "./webNative.js";
import {
  WEB_PANEL_CONTROL_EVENT,
  WEB_PANEL_CONTROL_NAVIGATE,
  WEB_PANEL_CONTROL_RETURN,
} from "./webPanelBridge.js";

function parseWebPanelParams() {
  if (typeof window === "undefined") {
    return { paneId: "", url: DEFAULT_WEB_URL, theme: "dark", windowId: "" };
  }
  const hash = window.location.hash || "";
  const queryIndex = hash.indexOf("?");
  const params = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : "");
  const theme = String(params.get("theme") || "dark").toLowerCase() === "light" ? "light" : "dark";
  return {
    paneId: params.get("paneId") || "",
    theme,
    url: normalizeWebInput(params.get("url") || "") || DEFAULT_WEB_URL,
    windowId: params.get("windowId") || "",
  };
}

export default function WebPanelHost() {
  const params = useMemo(() => parseWebPanelParams(), []);
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const windowLabel = useMemo(() => {
    try {
      return currentWindow.label || params.windowId || "";
    } catch {
      return params.windowId || "";
    }
  }, [currentWindow, params.windowId]);

  const [history, setHistory] = useState(() => [params.url]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [addressValue, setAddressValue] = useState(params.url);
  const [addressError, setAddressError] = useState("");
  const viewportRef = useRef(null);

  const currentUrl = history[historyIndex] || DEFAULT_WEB_URL;
  const currentHost = useMemo(() => hostForUrl(currentUrl), [currentUrl]);
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  useEffect(() => {
    document.documentElement.dataset.forgeTheme = params.theme;
  }, [params.theme]);

  useEffect(() => {
    setAddressValue(currentUrl);
  }, [currentUrl]);

  const scopeParts = useMemo(() => [params.paneId || "pane"], [params.paneId]);

  const emitNavigate = useCallback((url) => {
    if (!params.paneId || !url) {
      return;
    }
    emit(WEB_PANEL_CONTROL_EVENT, {
      control: WEB_PANEL_CONTROL_NAVIGATE,
      paneId: params.paneId,
      url,
      windowId: windowLabel,
    }).catch(() => {});
  }, [params.paneId, windowLabel]);

  const handleLoadedUrl = useCallback((loadedUrl) => {
    if (loadedUrl) {
      setAddressValue(loadedUrl);
      emitNavigate(loadedUrl);
    }
  }, [emitNavigate]);

  const { reload } = useNativeWebview({
    viewportRef,
    url: currentUrl,
    visible: true,
    parentWindowLabel: windowLabel,
    scopeParts,
    onNavigate: handleLoadedUrl,
  });

  const navigateTo = useCallback((targetUrl) => {
    setHistory((previous) => {
      const base = previous.slice(0, historyIndex + 1);
      if (base[base.length - 1] === targetUrl) {
        return base;
      }
      return [...base, targetUrl];
    });
    setHistoryIndex((index) => ((history[index] || "") === targetUrl ? index : index + 1));
    emitNavigate(targetUrl);
  }, [emitNavigate, history, historyIndex]);

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
    setHistoryIndex((index) => Math.max(0, index - 1));
  }, []);

  const goForward = useCallback(() => {
    setAddressError("");
    setHistoryIndex((index) => Math.min(history.length - 1, index + 1));
  }, [history.length]);

  const refresh = useCallback(() => {
    setAddressError("");
    reload();
  }, [reload]);

  const returnToGrid = useCallback(() => {
    emit(WEB_PANEL_CONTROL_EVENT, {
      control: WEB_PANEL_CONTROL_RETURN,
      paneId: params.paneId,
      url: currentUrl,
      windowId: windowLabel,
    }).catch(() => {});
    currentWindow.close().catch(() => {});
  }, [currentUrl, currentWindow, params.paneId, windowLabel]);

  return (
    <HostSurface data-workspace-web-surface="true">
      <GlobalStyle />
      <HostTitleBar
        data-tauri-drag-region="true"
        onPointerDown={(event) => {
          if (event.button === 0 && event.target === event.currentTarget) {
            currentWindow.startDragging().catch(() => {});
          }
        }}
      >
        <HostTitleIdentity data-tauri-drag-region="true">
          <Language aria-hidden="true" />
          <span>{currentHost}</span>
        </HostTitleIdentity>
        <HostTitleActions>
          <HostTextButton onClick={returnToGrid} title="Return this page to the grid" type="button">
            <SubdirectoryArrowLeft aria-hidden="true" />
            <span>Return to grid</span>
          </HostTextButton>
          <HostIconButton aria-label="Close" onClick={() => currentWindow.close().catch(() => {})} title="Close" type="button">
            <Close aria-hidden="true" />
          </HostIconButton>
        </HostTitleActions>
      </HostTitleBar>

      <HostNav onSubmit={handleSubmit}>
        <HostIconButton aria-label="Back" disabled={!canGoBack} onClick={goBack} title="Back" type="button">
          <ArrowBack aria-hidden="true" />
        </HostIconButton>
        <HostIconButton aria-label="Forward" disabled={!canGoForward} onClick={goForward} title="Forward" type="button">
          <ArrowForward aria-hidden="true" />
        </HostIconButton>
        <HostIconButton aria-label="Refresh" onClick={refresh} title="Refresh" type="button">
          <Refresh aria-hidden="true" />
        </HostIconButton>
        <HostAddressInput
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
      </HostNav>

      {addressError ? <HostInlineError role="alert">{addressError}</HostInlineError> : null}

      <HostViewport ref={viewportRef}>
        <HostBackdrop>
          <Language aria-hidden="true" />
          <span>{currentHost}</span>
        </HostBackdrop>
      </HostViewport>
    </HostSurface>
  );
}

const HostSurface = styled.section`
  --web-bg: #030405;
  --web-panel: #080b10;
  --web-panel-strong: #0d121a;
  --web-border: #1d2530;
  --web-text: #d5dbe4;
  --web-muted: #87919f;
  --web-blue: #68a3ff;
  --web-danger: #ff9b9b;

  display: grid;
  width: 100vw;
  height: 100vh;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
  color: var(--web-text);
  background: var(--web-bg);

  html[data-forge-theme="light"] & {
    --web-bg: #ffffff;
    --web-panel: #f5f7fb;
    --web-panel-strong: #ffffff;
    --web-border: #dce3ee;
    --web-text: #1c2430;
    --web-muted: #687488;
    --web-blue: #0066cc;
    --web-danger: #b42318;
  }
`;

const HostTitleBar = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--web-border);
  background: var(--web-panel);
`;

const HostTitleIdentity = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  color: var(--web-muted);
  font-size: 12px;
  font-weight: 720;

  svg {
    flex: 0 0 auto;
    width: 15px;
    height: 15px;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const HostTitleActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
`;

const HostIconButton = styled.button`
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--web-text);
  background: transparent;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled) {
    border-color: var(--web-border);
    background: rgba(255, 255, 255, 0.06);
  }

  &:disabled {
    cursor: default;
    opacity: 0.36;
  }
`;

const HostTextButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--web-border);
  border-radius: 7px;
  color: var(--web-text);
  background: var(--web-panel-strong);
  font-size: 12px;
  font-weight: 720;

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover {
    border-color: var(--web-blue);
    color: var(--web-blue);
  }
`;

const HostNav = styled.form`
  display: grid;
  grid-template-columns: auto auto auto minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--web-border);
  background: var(--web-panel);
`;

const HostAddressInput = styled.input`
  min-width: 0;
  width: 100%;
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--web-border);
  border-radius: 8px;
  outline: 0;
  color: var(--web-text);
  background: var(--web-panel-strong);
  font-size: 13px;
  font-weight: 600;

  &::placeholder {
    color: var(--web-muted);
  }

  &:focus {
    border-color: var(--web-blue);
  }
`;

const HostInlineError = styled.div`
  padding: 6px 12px;
  color: var(--web-danger);
  background: rgba(120, 24, 24, 0.18);
  font-size: 12px;
  font-weight: 720;
`;

const HostViewport = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--web-bg);
`;

const HostBackdrop = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--web-muted);
  font-size: 13px;
  font-weight: 720;

  svg {
    width: 30px;
    height: 30px;
  }
`;

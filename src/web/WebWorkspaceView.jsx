import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { ArrowForward } from "@styled-icons/material-rounded/ArrowForward";
import { Language } from "@styled-icons/material-rounded/Language";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { Search } from "@styled-icons/material-rounded/Search";

import {
  TerminalRailControls,
  TerminalRestartButton,
  TerminalRestartPill,
} from "../app/appStyles.js";
import {
  DEFAULT_WEB_URL,
  hasTauriRuntime,
  hostForUrl,
  nativeErrorMessage,
  normalizeWebInput,
  useNativeWebview,
} from "./webNative.js";

export default function WebWorkspaceView({
  isActive = true,
  webviewObscured = false,
  workspace,
}) {
  const [history, setHistory] = useState(() => [DEFAULT_WEB_URL]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [addressValue, setAddressValue] = useState(DEFAULT_WEB_URL);
  const [addressError, setAddressError] = useState("");
  const [nativeError, setNativeError] = useState("");
  const viewportRef = useRef(null);
  const historyIndexRef = useRef(historyIndex);

  historyIndexRef.current = historyIndex;

  const currentUrl = history[historyIndex] || DEFAULT_WEB_URL;
  const currentHost = useMemo(() => hostForUrl(currentUrl), [currentUrl]);
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;
  const nativeRuntimeAvailable = hasTauriRuntime();
  const nativeVisible = Boolean(isActive && !webviewObscured);
  const nativeScopeParts = useMemo(
    () => [workspace?.id || "workspace-tab", "workspace-web-tab"],
    [workspace?.id],
  );

  useEffect(() => {
    setAddressValue(currentUrl);
  }, [currentUrl]);

  const handleLoadedUrl = useCallback((loadedUrl) => {
    const safeUrl = String(loadedUrl || "").trim();
    if (!safeUrl) {
      return;
    }
    setAddressValue(safeUrl);
    setHistory((previous) => previous.map((url, index) => (
      index === historyIndexRef.current ? safeUrl : url
    )));
  }, []);

  const { reload, status: nativeStatus } = useNativeWebview({
    viewportRef,
    url: currentUrl,
    visible: nativeVisible,
    enabled: true,
    scopeParts: nativeScopeParts,
    onNavigate: handleLoadedUrl,
    onError: (error) => {
      setNativeError(nativeErrorMessage(error, "Unable to open the embedded web view."));
    },
  });

  const navigateTo = useCallback((targetUrl) => {
    setNativeError("");
    setHistory((previous) => {
      const base = previous.slice(0, historyIndex + 1);
      if (base[base.length - 1] === targetUrl) {
        return base;
      }
      return [...base, targetUrl];
    });
    setHistoryIndex((index) => ((history[index] || "") === targetUrl ? index : index + 1));
  }, [history, historyIndex]);

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
    setNativeError("");
    setHistoryIndex((index) => Math.max(0, index - 1));
  }, []);

  const goForward = useCallback(() => {
    setAddressError("");
    setNativeError("");
    setHistoryIndex((index) => Math.min(history.length - 1, index + 1));
  }, [history.length]);

  const refresh = useCallback(() => {
    setAddressError("");
    setNativeError("");
    reload();
  }, [reload]);

  const openCurrentExternally = useCallback(() => {
    openUrl(currentUrl).catch(() => {
      window.open(currentUrl, "_blank", "noopener,noreferrer");
    });
  }, [currentUrl]);

  return (
    <WebSurface aria-label="Workspace web" data-workspace-web-surface="true">
      <WebToolbar data-terminal-control="true">
        <WebNavControls data-rail-row="secondary">
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

        <WebRightControls data-rail-row="primary">
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
        {nativeRuntimeAvailable ? (
          <NativeWebviewBackdrop data-status={nativeError ? "error" : nativeStatus}>
            <Language aria-hidden="true" />
            <span>
              {nativeError
                ? "Web view unavailable"
                : nativeStatus === "loading"
                  ? "Loading"
                  : currentHost}
            </span>
            {nativeError ? (
              <NativeWebviewFallback role="alert">
                <small>{nativeError}</small>
                <NativeWebviewActions>
                  <NativeWebviewActionButton onClick={refresh} type="button">
                    <Refresh aria-hidden="true" />
                    <span>Retry</span>
                  </NativeWebviewActionButton>
                  <NativeWebviewActionButton onClick={openCurrentExternally} type="button">
                    <OpenInNew aria-hidden="true" />
                    <span>Open External</span>
                  </NativeWebviewActionButton>
                </NativeWebviewActions>
              </NativeWebviewFallback>
            ) : null}
          </NativeWebviewBackdrop>
        ) : (
          <WebFrame
            key={currentUrl}
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
  --web-panel: #0b0e14;
  --web-panel-strong: #0d121a;
  --web-border: rgba(226, 232, 240, 0.08);
  --web-text: rgba(255, 255, 255, 0.82);
  --web-muted: rgba(226, 232, 240, 0.62);
  --web-blue: #68a3ff;
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
    --web-panel: #eef1f5;
    --web-panel-strong: #ffffff;
    --web-border: rgba(24, 34, 48, 0.12);
    --web-text: rgba(48, 54, 68, 0.82);
    --web-muted: rgba(48, 54, 68, 0.58);
    --web-blue: #0066cc;
    --web-danger: #b42318;
  }
`;

const WebToolbar = styled(TerminalRestartPill)`
  border-bottom-color: var(--web-border);
  background: var(--web-panel);
`;

const WebNavControls = styled(TerminalRailControls)`
  order: 0;
`;

const WebRightControls = styled(TerminalRailControls)``;

const WebIconButton = styled(TerminalRestartButton)`
  color: var(--web-text);

  html[data-forge-theme="light"] &:hover:not(:disabled),
  html[data-forge-theme="light"] &:focus-visible {
    color: var(--forge-text, #1d2430);
  }
`;

const WebAddressForm = styled.form`
  display: flex;
  min-width: min(100%, 220px);
  align-items: center;
  flex: 999 1 320px;
  gap: 5px;
  order: 1;
  height: 24px;
  padding: 0 5px 0 8px;
  border: 1px solid var(--web-border);
  border-radius: 8px;
  background: var(--web-panel-strong);
`;

const SearchIcon = styled(Search)`
  width: 14px;
  height: 14px;
  color: var(--web-muted);
`;

const WebAddressInput = styled.input`
  min-width: 0;
  flex: 1 1 120px;
  height: 20px;
  padding: 0;
  border: 0;
  outline: 0;
  color: var(--web-text);
  background: transparent;
  font-size: 11px;
  font-weight: 650;

  &::placeholder {
    color: var(--web-muted);
  }
`;

const WebSubmitButton = styled(WebIconButton)`
  width: 20px;
  height: 20px;
  min-width: 20px;
  color: var(--web-blue);
`;

const WebInlineError = styled.div`
  grid-row: 2;
  padding: 5px 12px;
  color: var(--web-danger);
  background: rgba(120, 24, 24, 0.18);
  font-size: 12px;
  font-weight: 700;
`;

const WebViewport = styled.div`
  grid-row: 3;
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--web-bg);
`;

const WebFrame = styled.iframe`
  width: 100%;
  height: 100%;
  border: 0;
  background: #ffffff;
`;

const NativeWebviewBackdrop = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 10px;
  color: var(--web-muted);
  font-size: 12px;
  font-weight: 700;

  svg {
    width: 28px;
    height: 28px;
  }

  &[data-status="error"] {
    color: var(--web-danger);
  }
`;

const NativeWebviewFallback = styled.div`
  display: grid;
  max-width: 420px;
  gap: 12px;
  justify-items: center;
  padding: 0 20px;
  text-align: center;

  small {
    color: var(--web-muted);
    font-size: 12px;
    line-height: 1.45;
  }
`;

const NativeWebviewActions = styled.div`
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px;
`;

const NativeWebviewActionButton = styled.button`
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 6px;
  padding: 0 12px;
  border: 1px solid var(--web-border);
  border-radius: 7px;
  color: var(--web-text);
  background: var(--web-panel-strong);
  font-size: 12px;
  font-weight: 740;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover {
    border-color: var(--web-blue);
  }
`;

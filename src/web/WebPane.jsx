import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { ArrowForward } from "@styled-icons/material-rounded/ArrowForward";
import { Close } from "@styled-icons/material-rounded/Close";
import { DragIndicator } from "@styled-icons/material-rounded/DragIndicator";
import { Fullscreen } from "@styled-icons/material-rounded/Fullscreen";
import { FullscreenExit } from "@styled-icons/material-rounded/FullscreenExit";
import { Language } from "@styled-icons/material-rounded/Language";
import { LayoutSplit } from "@styled-icons/bootstrap/LayoutSplit";
import { LayoutRow } from "@styled-icons/remix-line/LayoutRow";
import { Refresh } from "@styled-icons/material-rounded/Refresh";

import {
  DEFAULT_WEB_URL,
  hostForUrl,
  normalizeWebInput,
  useNativeWebview,
} from "./webNative.js";

function PopOutGlyph(props) {
  return (
    <svg fill="none" height="13" viewBox="0 0 24 24" width="13" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M14 4h6v6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      <path d="M20 4 11 13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      <path d="M9 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

export default function WebPane({
  terminalIndex,
  paneId,
  workspaceId,
  initialUrl = DEFAULT_WEB_URL,
  isActive = true,
  isFullscreen = false,
  fullscreenActive = false,
  dragActive = false,
  poppedOut = false,
  onDragHandlePointerDown,
  onSplit,
  onToggleFullscreen,
  onClose,
  onPopOut,
  onReturnFromBreakout,
  onFocusBreakout,
  onNavigate,
}) {
  const startUrl = useMemo(() => normalizeWebInput(initialUrl) || DEFAULT_WEB_URL, [initialUrl]);
  const [history, setHistory] = useState(() => [startUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [addressValue, setAddressValue] = useState(startUrl);
  const [addressError, setAddressError] = useState("");
  const viewportRef = useRef(null);

  const currentUrl = history[historyIndex] || DEFAULT_WEB_URL;
  const currentHost = useMemo(() => hostForUrl(currentUrl), [currentUrl]);
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;

  useEffect(() => {
    setAddressValue(currentUrl);
  }, [currentUrl]);

  const scopeParts = useMemo(
    () => [workspaceId, `idx${terminalIndex}`],
    [workspaceId, terminalIndex],
  );

  // A native child webview composites on top of the DOM, so it must be hidden
  // while a pane drag is in flight (it can't follow the placeholder), while the
  // pane is popped out, and while another pane is fullscreen.
  const visible = Boolean(
    isActive
    && !dragActive
    && !poppedOut
    && (!fullscreenActive || isFullscreen),
  );

  const handleLoadedUrl = useCallback((loadedUrl) => {
    if (loadedUrl) {
      setAddressValue(loadedUrl);
      onNavigate?.(loadedUrl);
    }
  }, [onNavigate]);

  const { reload } = useNativeWebview({
    viewportRef,
    url: currentUrl,
    visible,
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
    onNavigate?.(targetUrl);
  }, [history, historyIndex, onNavigate]);

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

  return (
    <WebPaneSurface data-workspace-web-surface="true" data-active={isActive ? "true" : undefined}>
      <WebPaneRail>
        <WebPaneIdentity
          aria-label="Move web panel"
          data-terminal-drag-handle="true"
          onPointerDown={(event) => onDragHandlePointerDown?.(event, terminalIndex, paneId)}
          title="Drag to move"
          type="button"
        >
          <DragIndicator aria-hidden="true" />
          <Language aria-hidden="true" />
          <span>{currentHost}</span>
        </WebPaneIdentity>
        <WebPaneRailControls>
          <WebPaneIconButton
            aria-label="Split right"
            onClick={() => onSplit?.({ direction: "vertical", terminalIndex, paneId })}
            title="Split right"
            type="button"
          >
            <LayoutSplit aria-hidden="true" />
          </WebPaneIconButton>
          <WebPaneIconButton
            aria-label="Split down"
            onClick={() => onSplit?.({ direction: "horizontal", terminalIndex, paneId })}
            title="Split down"
            type="button"
          >
            <LayoutRow aria-hidden="true" />
          </WebPaneIconButton>
          <WebPaneIconButton
            aria-label="Open in window"
            onClick={() => onPopOut?.(terminalIndex, paneId, currentUrl)}
            title="Open in window"
            type="button"
          >
            <PopOutGlyph aria-hidden="true" />
          </WebPaneIconButton>
          <WebPaneIconButton
            aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            onClick={() => onToggleFullscreen?.(terminalIndex, paneId)}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            type="button"
          >
            {isFullscreen ? <FullscreenExit aria-hidden="true" /> : <Fullscreen aria-hidden="true" />}
          </WebPaneIconButton>
          <WebPaneIconButton
            aria-label="Close web panel"
            data-tone="close"
            onClick={() => onClose?.(terminalIndex, paneId)}
            title="Close"
            type="button"
          >
            <Close aria-hidden="true" />
          </WebPaneIconButton>
        </WebPaneRailControls>
      </WebPaneRail>

      <WebPaneNav onSubmit={handleSubmit}>
        <WebPaneIconButton
          aria-label="Back"
          disabled={!canGoBack}
          onClick={goBack}
          title="Back"
          type="button"
        >
          <ArrowBack aria-hidden="true" />
        </WebPaneIconButton>
        <WebPaneIconButton
          aria-label="Forward"
          disabled={!canGoForward}
          onClick={goForward}
          title="Forward"
          type="button"
        >
          <ArrowForward aria-hidden="true" />
        </WebPaneIconButton>
        <WebPaneIconButton
          aria-label="Refresh"
          onClick={refresh}
          title="Refresh"
          type="button"
        >
          <Refresh aria-hidden="true" />
        </WebPaneIconButton>
        <WebPaneAddressInput
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
      </WebPaneNav>

      {addressError ? <WebPaneInlineError role="alert">{addressError}</WebPaneInlineError> : null}

      <WebPaneViewport ref={viewportRef}>
        <WebPaneBackdrop>
          <Language aria-hidden="true" />
          <span>{currentHost}</span>
        </WebPaneBackdrop>
        {poppedOut ? (
          <WebPaneBreakoutOverlay>
            <strong>Opened in window</strong>
            <WebPaneBreakoutActions>
              <WebPaneOverlayButton onClick={() => onFocusBreakout?.(terminalIndex, paneId)} type="button">
                Focus window
              </WebPaneOverlayButton>
              <WebPaneOverlayButton data-tone="primary" onClick={() => onReturnFromBreakout?.(terminalIndex, paneId)} type="button">
                Return to grid
              </WebPaneOverlayButton>
            </WebPaneBreakoutActions>
          </WebPaneBreakoutOverlay>
        ) : null}
      </WebPaneViewport>
    </WebPaneSurface>
  );
}

const WebPaneSurface = styled.section`
  --web-bg: #030405;
  --web-panel: #080b10;
  --web-panel-strong: #0d121a;
  --web-border: #1d2530;
  --web-text: #d5dbe4;
  --web-muted: #87919f;
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
  border-radius: 10px;
  border: 1px solid var(--web-border);

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

const WebPaneRail = styled.header`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 5px 6px 5px 4px;
  border-bottom: 1px solid var(--web-border);
  background: var(--web-panel);
`;

const WebPaneIdentity = styled.button`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border: 0;
  border-radius: 6px;
  color: var(--web-muted);
  background: transparent;
  cursor: grab;
  font-size: 12px;
  font-weight: 700;

  &:active {
    cursor: grabbing;
  }

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

const WebPaneRailControls = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 2px;
`;

const WebPaneIconButton = styled.button`
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--web-text);
  background: transparent;
  transition: border-color 150ms ease, background 150ms ease, color 150ms ease, opacity 150ms ease;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled) {
    border-color: var(--web-border);
    background: rgba(255, 255, 255, 0.06);
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    background: rgba(0, 102, 204, 0.08);
  }

  &[data-tone="close"]:hover:not(:disabled) {
    color: var(--web-danger);
  }

  &:disabled {
    cursor: default;
    opacity: 0.36;
  }
`;

const WebPaneNav = styled.form`
  display: grid;
  min-width: 0;
  grid-template-columns: auto auto auto minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--web-border);
  background: var(--web-panel);
`;

const WebPaneAddressInput = styled.input`
  min-width: 0;
  width: 100%;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--web-border);
  border-radius: 7px;
  outline: 0;
  color: var(--web-text);
  background: var(--web-panel-strong);
  font-size: 12px;
  font-weight: 600;

  &::placeholder {
    color: var(--web-muted);
  }

  &:focus {
    border-color: var(--web-blue);
  }
`;

const WebPaneInlineError = styled.div`
  padding: 5px 12px;
  color: var(--web-danger);
  background: rgba(120, 24, 24, 0.18);
  font-size: 12px;
  font-weight: 700;
`;

const WebPaneViewport = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--web-bg);
`;

const WebPaneBackdrop = styled.div`
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
`;

const WebPaneBreakoutOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 14px;
  color: var(--web-text);
  background: var(--web-bg);
  font-size: 13px;
  font-weight: 720;
`;

const WebPaneBreakoutActions = styled.div`
  display: inline-flex;
  gap: 8px;
`;

const WebPaneOverlayButton = styled.button`
  min-height: 32px;
  padding: 0 14px;
  border: 1px solid var(--web-border);
  border-radius: 7px;
  color: var(--web-text);
  background: var(--web-panel-strong);
  font-size: 12px;
  font-weight: 740;

  &[data-tone="primary"] {
    border-color: var(--web-blue);
    color: var(--web-blue);
  }

  &:hover {
    border-color: var(--web-blue);
  }
`;

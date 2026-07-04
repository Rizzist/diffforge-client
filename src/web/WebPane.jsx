import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { ArrowForward } from "@styled-icons/material-rounded/ArrowForward";
import { AdsClick } from "@styled-icons/material-rounded/AdsClick";
import { Close } from "@styled-icons/material-rounded/Close";
import { Fullscreen } from "@styled-icons/material-rounded/Fullscreen";
import { FullscreenExit } from "@styled-icons/material-rounded/FullscreenExit";
import { Language } from "@styled-icons/material-rounded/Language";
import { LayoutSplit } from "@styled-icons/bootstrap/LayoutSplit";
import { LayoutRow } from "@styled-icons/remix-line/LayoutRow";
import { Refresh } from "@styled-icons/material-rounded/Refresh";

import {
  ButtonBotIcon,
  ButtonDragIcon,
  TerminalCloseButton,
  TerminalPaneInlineRailControls,
  TerminalRailIdentity,
  TerminalRestartButton,
  TerminalRestartPill,
  TitleMinimizeIcon,
} from "../app/appStyles.js";
import {
  DEFAULT_WEB_URL,
  hasTauriRuntime,
  hostForUrl,
  normalizeWebInput,
  useNativeWebview,
} from "./webNative.js";
import { useWebAgentPromptOverlay } from "./webAgentPromptOverlay.js";
import { useWebElementPicker } from "./webElementPicker.js";
import PanelAgentPromptActivity from "../terminals/PanelAgentPromptActivity.jsx";
import PanelAgentPromptComposer from "../terminals/PanelAgentPromptComposer.jsx";

const PANEL_AGENT_PROMPT_WEBVIEW_BOTTOM_INSET = 118;
const PANEL_AGENT_PROMPT_MENU_WEBVIEW_BOTTOM_INSET = 224;

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
  isFocused = false,
  isFullscreen = false,
  fullscreenActive = false,
  dragActive = false,
  layoutKey = "",
  poppedOut = false,
  breakoutReturnUrl = "",
  webviewObscured = false,
  adoptLabel = "",
  adoptNonce = 0,
  onNativeLabelChange = null,
  onDragHandlePointerDown,
  onSplit,
  onMinimize,
  onToggleFullscreen,
  onClose,
  onPopOut,
  onReturnFromBreakout,
  onFocusBreakout,
  onNavigate,
  onAgentPromptOpenChange,
  onDismissPanelAgentPromptActivityItem = null,
  controlCommand = null,
  defaultPanelAgentPromptTargetIds = [],
  panelKind = "web",
  panelAgentPromptActivityItems = [],
  onSubmitPanelAgentPrompt = null,
  panelAgentPromptTargets = [],
  scopeParts: providedScopeParts = null,
  showAgentPromptControl = true,
  showCloseButton = true,
  showDragHandle = true,
  showFullscreenControl = true,
  inlineToolbarInNav = false,
  showMinimizeControl = true,
  showPopOutControl = true,
  showSplitControls = true,
}) {
  const startUrl = useMemo(() => normalizeWebInput(initialUrl) || DEFAULT_WEB_URL, [initialUrl]);
  const [history, setHistory] = useState(() => [startUrl]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [addressValue, setAddressValue] = useState(startUrl);
  const [addressError, setAddressError] = useState("");
  const [agentPromptOpen, setAgentPromptOpen] = useState(false);
  const [agentPromptTargetMenuOpen, setAgentPromptTargetMenuOpen] = useState(false);
  const viewportRef = useRef(null);
  const controlCommandSeenRef = useRef(0);

  const currentUrl = history[historyIndex] || DEFAULT_WEB_URL;
  const currentHost = useMemo(() => hostForUrl(currentUrl), [currentUrl]);
  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex < history.length - 1;
  const agentPromptControlVisible = showAgentPromptControl;

  useEffect(() => {
    setAddressValue(currentUrl);
  }, [currentUrl]);

  useEffect(() => {
    onAgentPromptOpenChange?.(agentPromptOpen);
  }, [agentPromptOpen, onAgentPromptOpenChange]);

  useEffect(() => {
    if (!showAgentPromptControl && agentPromptOpen) {
      setAgentPromptOpen(false);
    }
  }, [agentPromptOpen, showAgentPromptControl]);

  useEffect(() => {
    if (!agentPromptOpen) {
      setAgentPromptTargetMenuOpen(false);
    }
  }, [agentPromptOpen]);

  const scopeParts = useMemo(() => {
    const explicitParts = (Array.isArray(providedScopeParts) ? providedScopeParts : [])
      .map((part) => String(part || "").trim())
      .filter(Boolean);
    if (explicitParts.length) {
      return explicitParts;
    }
    const fallbackParts = [
      workspaceId ? String(workspaceId).trim() : "",
      terminalIndex !== undefined && terminalIndex !== null ? `idx${terminalIndex}` : "",
      !workspaceId && paneId ? String(paneId).trim() : "",
    ].filter(Boolean);
    return fallbackParts.length ? fallbackParts : ["web-pane"];
  }, [paneId, providedScopeParts, terminalIndex, workspaceId]);

  // A native child webview composites on top of the DOM, so it must be hidden
  // while a pane drag is in flight (it can't follow the placeholder), while the
  // pane is popped out, and while another pane is fullscreen.
  const visible = Boolean(
    isActive
    && !dragActive
    && !poppedOut
    && !webviewObscured
    && (!fullscreenActive || isFullscreen),
  );
  const nativeAgentPromptOverlayActive = Boolean(
    agentPromptOpen
    && agentPromptControlVisible
    && visible
    && !poppedOut
    && hasTauriRuntime(),
  );

  const handleLoadedUrl = useCallback((loadedUrl) => {
    if (loadedUrl) {
      setAddressValue(loadedUrl);
      setHistory((previous) => {
        const activeIndex = Math.min(Math.max(historyIndex, 0), Math.max(0, previous.length - 1));
        if ((previous[activeIndex] || "") === loadedUrl) {
          return previous;
        }
        return [...previous.slice(0, activeIndex + 1), loadedUrl];
      });
      setHistoryIndex((index) => ((history[index] || "") === loadedUrl ? index : index + 1));
      onNavigate?.(loadedUrl);
    }
  }, [history, historyIndex, onNavigate]);

  const handleNativeLabelChange = useCallback((label) => {
    onNativeLabelChange?.(paneId, label);
  }, [onNativeLabelChange, paneId]);

  const effectiveBreakoutReturnUrl = normalizeWebInput(breakoutReturnUrl)
    || String(breakoutReturnUrl || "").trim()
    || currentUrl;

  // Returning from a pop-out window with a living webview to adopt: the page is
  // wherever the window last navigated, so sync the pane's own history/address
  // bar to it (the loaded-url guard in the hook keeps this from reloading).
  const prevPoppedOutRef = useRef(poppedOut);
  useEffect(() => {
    const wasPoppedOut = prevPoppedOutRef.current;
    prevPoppedOutRef.current = poppedOut;
    if (!wasPoppedOut || poppedOut) {
      return;
    }
    const returnUrl = normalizeWebInput(breakoutReturnUrl) || String(breakoutReturnUrl || "").trim();
    if (!returnUrl) {
      return;
    }
    setHistory((previous) => {
      const activeIndex = Math.min(Math.max(historyIndex, 0), Math.max(0, previous.length - 1));
      if ((previous[activeIndex] || "") === returnUrl) {
        return previous;
      }
      return [...previous.slice(0, activeIndex + 1), returnUrl];
    });
    setHistoryIndex((index) => ((history[index] || "") === returnUrl ? index : index + 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poppedOut]);

  const { evaluate, reload } = useNativeWebview({
    layoutKey,
    viewportRef,
    url: currentUrl,
    visible,
    scopeParts,
    // While popped out, the breakout window owns the native webview: never fit,
    // re-open, or close it from the grid side. On return the pane adopts the
    // window's living webview back via adoptLabel/adoptNonce (no reload).
    suspended: poppedOut,
    adoptLabel,
    adoptNonce,
    adoptCurrentUrl: effectiveBreakoutReturnUrl,
    onLabelChange: handleNativeLabelChange,
    viewportInsetBottom: agentPromptOpen && !nativeAgentPromptOverlayActive
      ? agentPromptTargetMenuOpen
        ? PANEL_AGENT_PROMPT_MENU_WEBVIEW_BOTTOM_INSET
        : PANEL_AGENT_PROMPT_WEBVIEW_BOTTOM_INSET
      : 0,
    onNavigate: handleLoadedUrl,
  });

  const webElementPicker = useWebElementPicker({
    currentUrl,
    enabled: agentPromptOpen && agentPromptControlVisible && visible && !poppedOut,
    evaluate,
    panelKind,
    paneId,
    workspaceId,
  });
  const dismissPanelAgentPromptActivityItem = useCallback((itemId) => {
    const safeItemId = String(itemId || "").trim();
    if (safeItemId) {
      onDismissPanelAgentPromptActivityItem?.(safeItemId);
    }
  }, [onDismissPanelAgentPromptActivityItem]);
  const webAgentPromptOverlay = useWebAgentPromptOverlay({
    autoDismissCompleted: Boolean(isFocused),
    activityItems: panelAgentPromptActivityItems,
    contextRefs: webElementPicker.contextRefs,
    defaultSelectedTargetIds: defaultPanelAgentPromptTargetIds,
    enabled: nativeAgentPromptOverlayActive,
    evaluate,
    onClearContext: webElementPicker.clearSelection,
    onClose: () => setAgentPromptOpen(false),
    onDismissCompletedItem: dismissPanelAgentPromptActivityItem,
    onSubmit: onSubmitPanelAgentPrompt,
    panelKind,
    panelPaneId: paneId,
    targets: panelAgentPromptTargets,
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

  useEffect(() => {
    const nonce = Number(controlCommand?.nonce || 0);
    if (!nonce || controlCommandSeenRef.current === nonce) {
      return;
    }
    controlCommandSeenRef.current = nonce;
    const action = String(controlCommand?.action || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (action === "navigate" || action === "search" || action === "open") {
      const rawTarget = action === "search"
        ? controlCommand?.search || controlCommand?.query || controlCommand?.url
        : controlCommand?.url || controlCommand?.search || controlCommand?.query;
      const targetUrl = normalizeWebInput(rawTarget);
      if (!targetUrl) {
        setAddressError("Enter a web address or search.");
        return;
      }
      setAddressError("");
      navigateTo(targetUrl);
      return;
    }
    if (action === "reload" || action === "refresh") {
      refresh();
      return;
    }
    if (action === "back" || action === "go-back") {
      goBack();
      return;
    }
    if (action === "forward" || action === "go-forward") {
      goForward();
    }
  }, [controlCommand, goBack, goForward, navigateTo, refresh]);

  const dragHandleVisible = showDragHandle && typeof onDragHandlePointerDown === "function";
  const closeButtonVisible = showCloseButton && typeof onClose === "function";
  const splitControlsVisible = showSplitControls && typeof onSplit === "function";
  const popOutControlVisible = showPopOutControl && typeof onPopOut === "function";
  const minimizeControlVisible = showMinimizeControl && typeof onMinimize === "function";
  const fullscreenControlVisible = showFullscreenControl && typeof onToggleFullscreen === "function";
  const hasPanelAgentPromptActivity = Array.isArray(panelAgentPromptActivityItems)
    && panelAgentPromptActivityItems.length > 0;
  const toolbarControlsVisible = agentPromptControlVisible
    || splitControlsVisible
    || popOutControlVisible
    || minimizeControlVisible
    || fullscreenControlVisible;
  const toolbarControls = (
    <>
      {agentPromptControlVisible ? (
        <>
          <WebPaneIconButton
            aria-label="Prompt terminal agents"
            aria-pressed={agentPromptOpen ? "true" : "false"}
            data-active={agentPromptOpen ? "true" : undefined}
            onClick={() => setAgentPromptOpen((open) => !open)}
            title="Prompt terminal agents"
            type="button"
          >
            <ButtonBotIcon aria-hidden="true" />
          </WebPaneIconButton>
          {agentPromptOpen ? (
            <WebPaneIconButton
              aria-label="Select web element"
              aria-pressed={webElementPicker.armed || webElementPicker.contextRefs.length ? "true" : "false"}
              data-active={webElementPicker.armed || webElementPicker.contextRefs.length ? "true" : undefined}
              disabled={!visible || poppedOut}
              onClick={webElementPicker.togglePicker}
              title="Select web element"
              type="button"
            >
              <AdsClick aria-hidden="true" />
            </WebPaneIconButton>
          ) : null}
        </>
      ) : null}
      {splitControlsVisible ? (
        <>
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
        </>
      ) : null}
      {popOutControlVisible ? (
        <WebPaneIconButton
          aria-label="Open in window"
          onClick={() => onPopOut?.(terminalIndex, paneId, currentUrl)}
          title="Open in window"
          type="button"
        >
          <PopOutGlyph aria-hidden="true" />
        </WebPaneIconButton>
      ) : null}
      {minimizeControlVisible ? (
        <WebPaneIconButton
          aria-label="Minimize web panel"
          disabled={poppedOut}
          onClick={() => onMinimize?.(terminalIndex, paneId)}
          title={poppedOut ? "Return to grid before minimizing" : "Minimize"}
          type="button"
        >
          <TitleMinimizeIcon aria-hidden="true" />
        </WebPaneIconButton>
      ) : null}
      {fullscreenControlVisible ? (
        <WebPaneIconButton
          aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => onToggleFullscreen?.(terminalIndex, paneId)}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          type="button"
        >
          {isFullscreen ? <FullscreenExit aria-hidden="true" /> : <Fullscreen aria-hidden="true" />}
        </WebPaneIconButton>
      ) : null}
    </>
  );
  return (
    <WebPaneSurface data-workspace-web-surface="true" data-active={isActive ? "true" : undefined}>
      <WebPaneRail data-terminal-control="true" data-toolbar-inline-nav={inlineToolbarInNav ? "true" : undefined}>
        {dragHandleVisible ? (
          <WebPaneIdentity data-web-pane-rail-section="identity">
            <WebPaneDragButton
              aria-label="Drag web panel"
              data-terminal-drag-handle="true"
              onPointerDown={(event) => onDragHandlePointerDown?.(event, terminalIndex, paneId)}
              title={isFullscreen ? "Exit fullscreen to reorder panels" : "Drag web panel"}
              type="button"
            >
              <ButtonDragIcon aria-hidden="true" />
            </WebPaneDragButton>
          </WebPaneIdentity>
        ) : null}
        <WebPaneNav data-web-pane-rail-section="nav" onSubmit={handleSubmit}>
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
          {inlineToolbarInNav && toolbarControlsVisible ? (
            <WebPaneNavControls aria-label="Web controls" role="group">
              {toolbarControls}
            </WebPaneNavControls>
          ) : null}
        </WebPaneNav>
        {(!inlineToolbarInNav || closeButtonVisible) && (toolbarControlsVisible || closeButtonVisible) ? (
          <WebPaneRailControls data-rail-row="inline" data-web-pane-rail-section="controls">
            {!inlineToolbarInNav ? toolbarControls : null}
            {closeButtonVisible ? (
              <WebPaneCloseButton
                aria-label="Close web panel"
                data-tone="close"
                onClick={() => onClose?.(terminalIndex, paneId)}
                title="Close"
                type="button"
              >
                <Close aria-hidden="true" />
              </WebPaneCloseButton>
            ) : null}
          </WebPaneRailControls>
        ) : null}
        {hasPanelAgentPromptActivity ? (
          <WebPaneActivityRow data-web-pane-rail-section="activity">
            <PanelAgentPromptActivity
              autoDismissCompleted={Boolean(isFocused)}
              items={panelAgentPromptActivityItems}
              onDismissCompletedItem={dismissPanelAgentPromptActivityItem}
            />
          </WebPaneActivityRow>
        ) : null}
      </WebPaneRail>

      {addressError ? <WebPaneInlineError role="alert">{addressError}</WebPaneInlineError> : null}

      <WebPaneViewport data-agent-prompt-open={agentPromptOpen ? "true" : undefined} ref={viewportRef}>
        <WebPaneBackdrop>
          <Language aria-hidden="true" />
          <span>{currentHost}</span>
        </WebPaneBackdrop>
        {poppedOut ? (
          <WebPaneBreakoutOverlay>
            <strong>Opened in window</strong>
            <WebPaneBreakoutActions>
              {typeof onFocusBreakout === "function" ? (
                <WebPaneOverlayButton onClick={() => onFocusBreakout?.(terminalIndex, paneId, effectiveBreakoutReturnUrl)} type="button">
                  Focus window
                </WebPaneOverlayButton>
              ) : null}
              {typeof onReturnFromBreakout === "function" ? (
                <WebPaneOverlayButton data-tone="primary" onClick={() => onReturnFromBreakout?.(terminalIndex, paneId, effectiveBreakoutReturnUrl)} type="button">
                  Return to grid
                </WebPaneOverlayButton>
              ) : null}
            </WebPaneBreakoutActions>
          </WebPaneBreakoutOverlay>
        ) : null}
        {agentPromptOpen && agentPromptControlVisible && !webAgentPromptOverlay.active ? (
          <PanelAgentPromptComposer
            autoFocus
            contextRefs={webElementPicker.contextRefs}
            defaultSelectedTargetIds={defaultPanelAgentPromptTargetIds}
            onClearContext={webElementPicker.clearSelection}
            onClose={() => setAgentPromptOpen(false)}
            onSubmit={onSubmitPanelAgentPrompt}
            onTargetMenuOpenChange={setAgentPromptTargetMenuOpen}
            panelKind={panelKind}
            panelPaneId={paneId}
            targets={panelAgentPromptTargets}
          />
        ) : null}
        {agentPromptOpen && webElementPicker.error ? (
          <WebPanePickerError role="alert">{webElementPicker.error}</WebPanePickerError>
        ) : null}
      </WebPaneViewport>
    </WebPaneSurface>
  );
}

const WebPaneSurface = styled.section`
  --web-bg: #030405;
  --web-panel: #0b0e14;
  --web-panel-strong: #0d121a;
  --web-border: rgba(226, 232, 240, 0.08);
  --web-text: rgba(255, 255, 255, 0.82);
  --web-muted: rgba(226, 232, 240, 0.62);
  --web-blue: #68a3ff;
  --web-danger: #ff9b9b;

  container-type: inline-size;
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr);
  overflow: hidden;
  color: var(--web-text);
  background: var(--web-bg);
  border-radius: 0;
  border: 1px solid var(--web-border);

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

const WebPaneRail = styled(TerminalRestartPill)`
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-rows: minmax(24px, auto) minmax(24px, auto);
  align-items: center;
  column-gap: 4px;
  row-gap: 2px;
  border-bottom-color: var(--web-border);
  background: var(--web-panel);

  && [data-web-pane-rail-section="identity"] {
    grid-column: 1;
    grid-row: 1;
  }

  && [data-web-pane-rail-section="nav"] {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  && [data-web-pane-rail-section="controls"] {
    grid-column: 2 / -1;
    grid-row: 1;
  }

  && [data-web-pane-rail-section="secondary"] {
    grid-column: 2;
    grid-row: 1;
    width: auto;
    justify-self: end;
    flex-wrap: wrap;
  }

  && [data-web-pane-rail-section="primary"] {
    grid-column: 3;
    grid-row: 1;
    justify-self: end;
  }

  && [data-web-pane-rail-section="activity"] {
    grid-column: 1 / -1;
    grid-row: 3;
  }

  &&[data-toolbar-inline-nav="true"] {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(24px, auto);
  }

  &&[data-toolbar-inline-nav="true"] [data-web-pane-rail-section="nav"] {
    grid-column: 1 / -1;
    grid-row: 1;
  }

  &&[data-toolbar-inline-nav="true"] [data-web-pane-rail-section="activity"] {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  /* The controls row stays beside the drag handle at every pane width (the old
     760px container fallback pushed it to a second row on ordinary panes);
     TerminalPaneInlineRailControls flex-wraps naturally if space truly runs out. */
  && [data-web-pane-rail-section="controls"] {
    min-width: 0;
    flex-wrap: wrap;
  }

  /* Neutralize the inherited TerminalRestartPill 520px fallback: this rail
     keeps its base single-row layout at every width. */
  @container (max-width: 520px) {
    && {
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: center;
    }
  }
`;

const WebPaneIdentity = styled(TerminalRailIdentity)`
  flex: 0 0 auto;
  min-width: 0;
`;

const WebPaneDragButton = styled(TerminalRestartButton)`
  color: var(--web-text);
`;

const WebPaneRailControls = styled(TerminalPaneInlineRailControls)`
  color: var(--web-text);
`;

const WebPaneIconButton = styled(TerminalRestartButton)`
  color: var(--web-text);

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    color: var(--forge-text, #1d2430);
  }
`;

const WebPaneNav = styled.form`
  display: flex;
  grid-column: 1 / -1;
  grid-row: 2;
  width: 100%;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  align-content: center;
  gap: 2px;
  padding: 0;
  border: 0;
  background: transparent;
`;

const WebPaneNavControls = styled.span`
  display: inline-flex;
  min-width: 0;
  flex: 0 1 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
`;

const WebPaneActivityRow = styled.div`
  display: flex;
  grid-column: 1 / -1;
  grid-row: 3;
  min-width: 0;
  justify-content: flex-end;
`;

const WebPaneAddressInput = styled.input`
  min-width: 0;
  flex: 1 1 120px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--web-border);
  border-radius: 7px;
  outline: 0;
  color: var(--web-text);
  background: var(--web-panel-strong);
  font-size: 11px;
  font-weight: 600;

  &::placeholder {
    color: var(--web-muted);
  }

  &:focus {
    border-color: var(--web-blue);
  }
`;

const WebPaneCloseButton = styled(TerminalCloseButton)`
  &[data-tone="close"]:hover:not(:disabled) {
    color: var(--web-danger);
  }
`;

const WebPaneInlineError = styled.div`
  grid-row: 2;
  padding: 5px 12px;
  color: var(--web-danger);
  background: rgba(120, 24, 24, 0.18);
  font-size: 12px;
  font-weight: 700;
`;

const WebPaneViewport = styled.div`
  grid-row: 3;
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

const WebPanePickerError = styled.div`
  position: absolute;
  right: 12px;
  bottom: 78px;
  z-index: 43;
  max-width: min(360px, calc(100% - 24px));
  padding: 6px 9px;
  border: 1px solid rgba(252, 165, 165, 0.28);
  border-radius: 999px;
  color: #fecaca;
  background: rgba(69, 10, 10, 0.76);
  font-size: 11px;
  font-weight: 760;
  line-height: 1.2;
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.28);

  html[data-forge-theme="light"] & {
    color: #991b1b;
    background: rgba(254, 226, 226, 0.9);
  }
`;

import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { AdsClick } from "@styled-icons/material-rounded/AdsClick";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { ArrowForward } from "@styled-icons/material-rounded/ArrowForward";
import { Language } from "@styled-icons/material-rounded/Language";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";
import { Refresh } from "@styled-icons/material-rounded/Refresh";

import {
  ButtonBotIcon,
  ButtonCloseIcon,
  ButtonDragIcon,
  GlobalStyle,
  TerminalCloseButton,
  TerminalRailControls,
  TerminalRailIdentity,
  TerminalRestartButton,
  TerminalRestartPill,
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
import {
  WEB_PANEL_COMMAND_EVENT,
  WEB_PANEL_CONTROL_EVENT,
  WEB_PANEL_CONTROL_NAVIGATE,
  WEB_PANEL_CONTROL_RETURN,
} from "./webPanelBridge.js";
import PanelAgentPromptActivity from "../terminals/PanelAgentPromptActivity.jsx";
import PanelAgentPromptComposer from "../terminals/PanelAgentPromptComposer.jsx";
import {
  PANEL_AGENT_PROMPT_ACTIVITY_EVENT,
  PANEL_AGENT_PROMPT_ACTIVITY_REQUEST_EVENT,
  PANEL_AGENT_PROMPT_RESULT_EVENT,
  PANEL_AGENT_PROMPT_SUBMIT_EVENT,
  PANEL_AGENT_PROMPT_TARGETS_EVENT,
  PANEL_AGENT_PROMPT_TARGETS_REQUEST_EVENT,
  createPanelAgentPromptRequestId,
  normalizePanelAgentPromptActivityItems,
  normalizePanelAgentPromptTargets,
} from "../terminals/panelAgentPromptBridge.js";

const PANEL_AGENT_PROMPT_WEBVIEW_BOTTOM_INSET = 118;
const PANEL_AGENT_PROMPT_MENU_WEBVIEW_BOTTOM_INSET = 224;

function parseWebPanelParams() {
  if (typeof window === "undefined") {
    return { paneId: "", url: DEFAULT_WEB_URL, theme: "dark", windowId: "", workspaceId: "" };
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
    workspaceId: params.get("workspaceId") || "",
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
  const [agentPromptOpen, setAgentPromptOpen] = useState(false);
  const [agentPromptTargetMenuOpen, setAgentPromptTargetMenuOpen] = useState(false);
  const [agentPromptActivityItems, setAgentPromptActivityItems] = useState([]);
  const [agentPromptTargets, setAgentPromptTargets] = useState([]);
  const [defaultAgentPromptTargetIds, setDefaultAgentPromptTargetIds] = useState([]);
  const viewportRef = useRef(null);
  const agentPromptTargetsRequestIdRef = useRef("");

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

  useEffect(() => {
    if (!agentPromptOpen) {
      setAgentPromptTargetMenuOpen(false);
    }
  }, [agentPromptOpen]);

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
      setHistory((previous) => {
        const activeIndex = Math.min(Math.max(historyIndex, 0), Math.max(0, previous.length - 1));
        if ((previous[activeIndex] || "") === loadedUrl) {
          return previous;
        }
        return [...previous.slice(0, activeIndex + 1), loadedUrl];
      });
      setHistoryIndex((index) => ((history[index] || "") === loadedUrl ? index : index + 1));
      emitNavigate(loadedUrl);
    }
  }, [emitNavigate, history, historyIndex]);

  const nativeAgentPromptOverlayActive = Boolean(agentPromptOpen && hasTauriRuntime());

  const { evaluate, reload } = useNativeWebview({
    viewportRef,
    url: currentUrl,
    visible: true,
    parentWindowLabel: windowLabel,
    scopeParts,
    viewportInsetBottom: agentPromptOpen && !nativeAgentPromptOverlayActive
      ? agentPromptTargetMenuOpen
        ? PANEL_AGENT_PROMPT_MENU_WEBVIEW_BOTTOM_INSET
        : PANEL_AGENT_PROMPT_WEBVIEW_BOTTOM_INSET
      : 0,
    onNavigate: handleLoadedUrl,
  });

  const webElementPicker = useWebElementPicker({
    currentUrl,
    enabled: agentPromptOpen,
    evaluate,
    panelKind: "web",
    paneId: params.paneId,
    workspaceId: params.workspaceId,
  });

  const requestAgentPromptTargets = useCallback(() => {
    const requestId = createPanelAgentPromptRequestId("web-panel-targets");
    agentPromptTargetsRequestIdRef.current = requestId;
    emit(PANEL_AGENT_PROMPT_TARGETS_REQUEST_EVENT, {
      panelKind: "web",
      paneId: params.paneId,
      requestId,
      windowId: windowLabel,
      workspaceId: params.workspaceId,
    }).catch(() => {});
  }, [params.paneId, params.workspaceId, windowLabel]);

  const requestAgentPromptActivity = useCallback(() => {
    emit(PANEL_AGENT_PROMPT_ACTIVITY_REQUEST_EVENT, {
      panelKind: "web",
      paneId: params.paneId,
      windowId: windowLabel,
      workspaceId: params.workspaceId,
    }).catch(() => {});
  }, [params.paneId, params.workspaceId, windowLabel]);

  useEffect(() => {
    requestAgentPromptActivity();
  }, [requestAgentPromptActivity]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(PANEL_AGENT_PROMPT_ACTIVITY_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const paneId = String(payload.paneId || payload.pane_id || payload.panelPaneId || payload.panel_pane_id || "").trim();
      if (!paneId || (params.paneId && paneId !== params.paneId)) {
        return;
      }
      const workspaceId = String(payload.workspaceId || payload.workspace_id || "").trim();
      if (workspaceId && params.workspaceId && workspaceId !== params.workspaceId) {
        return;
      }
      const windowId = String(payload.windowId || payload.window_id || "").trim();
      if (windowId && windowId !== windowLabel) {
        return;
      }
      setAgentPromptActivityItems(normalizePanelAgentPromptActivityItems(payload.items));
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [params.paneId, params.workspaceId, windowLabel]);

  useEffect(() => {
    if (agentPromptOpen) {
      requestAgentPromptTargets();
    }
  }, [agentPromptOpen, requestAgentPromptTargets]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(PANEL_AGENT_PROMPT_TARGETS_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const requestId = String(payload.requestId || payload.request_id || "").trim();
      const windowId = String(payload.windowId || payload.window_id || "").trim();
      if (requestId && requestId !== agentPromptTargetsRequestIdRef.current) {
        return;
      }
      if (windowId && windowId !== windowLabel) {
        return;
      }
      const workspaceId = String(payload.workspaceId || payload.workspace_id || "").trim();
      if (workspaceId && params.workspaceId && workspaceId !== params.workspaceId) {
        return;
      }
      setAgentPromptTargets(normalizePanelAgentPromptTargets(payload.targets));
      setDefaultAgentPromptTargetIds(
        (Array.isArray(payload.defaultSelectedTargetIds)
          ? payload.defaultSelectedTargetIds
          : Array.isArray(payload.default_selected_target_ids)
            ? payload.default_selected_target_ids
            : []
        ).map((id) => String(id || "").trim()).filter(Boolean),
      );
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [params.workspaceId, windowLabel]);

  const submitAgentPrompt = useCallback(async ({ contextRefs, targetIds, targetTerminalIndexes, text }) => {
    const requestId = createPanelAgentPromptRequestId("web-panel-submit");
    let unlisten = () => {};
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        settled = true;
        unlisten();
      };
      const timeoutId = window.setTimeout(() => {
        if (settled) {
          return;
        }
        cleanup();
        reject(new Error("Timed out sending prompt."));
      }, 15000);
      listen(PANEL_AGENT_PROMPT_RESULT_EVENT, (event) => {
        const payload = event?.payload || {};
        if (String(payload.requestId || payload.request_id || "").trim() !== requestId) {
          return;
        }
        const windowId = String(payload.windowId || payload.window_id || "").trim();
        if (windowId && windowId !== windowLabel) {
          return;
        }
        window.clearTimeout(timeoutId);
        cleanup();
        if (payload.ok === true) {
          resolve(payload);
        } else {
          reject(new Error(String(payload.error || "Unable to send prompt.")));
        }
      })
        .then((nextUnlisten) => {
          if (settled) {
            nextUnlisten();
          } else {
            unlisten = nextUnlisten;
            emit(PANEL_AGENT_PROMPT_SUBMIT_EVENT, {
              contextRefs,
              panelKind: "web",
              paneId: params.paneId,
              requestId,
              targetIds,
              targetTerminalIndexes,
              text,
              windowId: windowLabel,
              workspaceId: params.workspaceId,
            }).catch((error) => {
              window.clearTimeout(timeoutId);
              cleanup();
              reject(error);
            });
          }
        })
        .catch((error) => {
          window.clearTimeout(timeoutId);
          cleanup();
          reject(error);
        });
    });
  }, [params.paneId, params.workspaceId, windowLabel]);

  const webAgentPromptOverlay = useWebAgentPromptOverlay({
    activityItems: agentPromptActivityItems,
    contextRefs: webElementPicker.contextRefs,
    defaultSelectedTargetIds: defaultAgentPromptTargetIds,
    enabled: nativeAgentPromptOverlayActive,
    evaluate,
    onClearContext: webElementPicker.clearSelection,
    onClose: () => setAgentPromptOpen(false),
    onSubmit: submitAgentPrompt,
    targets: agentPromptTargets,
    windowId: windowLabel,
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

  const startWindowDrag = useCallback((event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    currentWindow.startDragging().catch(() => {});
  }, [currentWindow]);

  const startChromeDrag = useCallback((event) => {
    if (
      event.button !== 0
      || event.target?.closest?.("button, input, textarea, select, a, [contenteditable='true']")
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    currentWindow.startDragging().catch(() => {});
  }, [currentWindow]);

  const returnToGrid = useCallback(() => {
    emit(WEB_PANEL_CONTROL_EVENT, {
      control: WEB_PANEL_CONTROL_RETURN,
      paneId: params.paneId,
      url: currentUrl,
      windowId: windowLabel,
    })
      .catch(() => {})
      .finally(() => {
        currentWindow.close().catch(() => {});
      });
  }, [currentUrl, currentWindow, params.paneId, windowLabel]);

  useEffect(() => {
    if (!params.paneId) {
      return undefined;
    }
    let disposed = false;
    let unlisten = () => {};
    listen(WEB_PANEL_COMMAND_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const paneId = String(payload.paneId || payload.pane_id || "").trim();
      const windowId = String(payload.windowId || payload.window_id || "").trim();
      if (paneId && paneId !== params.paneId) {
        return;
      }
      if (windowId && windowId !== windowLabel) {
        return;
      }
      const action = String(payload.action || payload.command?.action || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
      if (action === "navigate" || action === "search" || action === "open") {
        const rawTarget = action === "search"
          ? payload.search || payload.query || payload.url || payload.command?.search || payload.command?.query || payload.command?.url
          : payload.url || payload.search || payload.query || payload.command?.url || payload.command?.search || payload.command?.query;
        const targetUrl = normalizeWebInput(rawTarget);
        if (!targetUrl) {
          setAddressError("Enter a web address or search.");
          return;
        }
        setAddressError("");
        navigateTo(targetUrl);
        currentWindow.setFocus().catch(() => {});
        return;
      }
      if (action === "reload" || action === "refresh") {
        refresh();
        currentWindow.setFocus().catch(() => {});
        return;
      }
      if (action === "back" || action === "go-back") {
        goBack();
        currentWindow.setFocus().catch(() => {});
        return;
      }
      if (action === "forward" || action === "go-forward") {
        goForward();
        currentWindow.setFocus().catch(() => {});
        return;
      }
      if (action === "focus" || action === "popout" || action === "open-window") {
        currentWindow.setFocus().catch(() => {});
        return;
      }
      if (action === "return" || action === "return-to-grid") {
        returnToGrid();
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [
    currentWindow,
    goBack,
    goForward,
    navigateTo,
    params.paneId,
    refresh,
    returnToGrid,
    windowLabel,
  ]);

  return (
    <HostSurface data-workspace-web-surface="true">
      <GlobalStyle />
      <HostChrome data-terminal-control="true">
        <HostTopRail
          data-tauri-drag-region="true"
          data-terminal-control="true"
          onPointerDown={startChromeDrag}
        >
          <HostRailIdentity data-tauri-drag-region="true">
            <HostIconButton
              aria-label="Move web window"
              data-terminal-drag-handle="true"
              onPointerDown={startWindowDrag}
              title="Move window"
              type="button"
            >
              <ButtonDragIcon aria-hidden="true" />
            </HostIconButton>
          </HostRailIdentity>

          <HostRailControls data-rail-row="primary">
            <HostCloseButton aria-label="Close" onClick={() => currentWindow.close().catch(() => {})} title="Close" type="button">
              <ButtonCloseIcon aria-hidden="true" />
            </HostCloseButton>
          </HostRailControls>

          <HostRailControls data-rail-row="secondary">
            <PanelAgentPromptActivity items={agentPromptActivityItems} />
            <HostIconButton
              aria-label="Prompt terminal agents"
              aria-pressed={agentPromptOpen ? "true" : "false"}
              data-active={agentPromptOpen ? "true" : undefined}
              onClick={() => setAgentPromptOpen((open) => !open)}
              title="Prompt terminal agents"
              type="button"
            >
              <ButtonBotIcon aria-hidden="true" />
            </HostIconButton>
            {agentPromptOpen ? (
              <HostIconButton
                aria-label="Select web element"
                aria-pressed={webElementPicker.armed || webElementPicker.contextRefs.length ? "true" : "false"}
                data-active={webElementPicker.armed || webElementPicker.contextRefs.length ? "true" : undefined}
                onClick={webElementPicker.togglePicker}
                title="Select web element"
                type="button"
              >
                <AdsClick aria-hidden="true" />
              </HostIconButton>
            ) : null}
            <HostIconButton
              aria-label="Return web panel to the app"
              aria-pressed="true"
              data-active="true"
              onClick={returnToGrid}
              title="Return to app"
              type="button"
            >
              <OpenInNew aria-hidden="true" />
            </HostIconButton>
          </HostRailControls>
        </HostTopRail>

        <HostNavRow>
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
        </HostNavRow>
      </HostChrome>

      {addressError ? <HostInlineError role="alert">{addressError}</HostInlineError> : null}

      <HostViewport data-agent-prompt-open={agentPromptOpen ? "true" : undefined} ref={viewportRef}>
        <HostBackdrop>
          <Language aria-hidden="true" />
          <span>{currentHost}</span>
        </HostBackdrop>
        {agentPromptOpen && !webAgentPromptOverlay.active ? (
          <PanelAgentPromptComposer
            autoFocus
            contextRefs={webElementPicker.contextRefs}
            defaultSelectedTargetIds={defaultAgentPromptTargetIds}
            onClearContext={webElementPicker.clearSelection}
            onClose={() => setAgentPromptOpen(false)}
            onSubmit={submitAgentPrompt}
            onTargetMenuOpenChange={setAgentPromptTargetMenuOpen}
            panelKind="web"
            panelPaneId={params.paneId}
            targets={agentPromptTargets}
            windowId={windowLabel}
          />
        ) : null}
        {agentPromptOpen && webElementPicker.error ? (
          <HostPickerError role="alert">{webElementPicker.error}</HostPickerError>
        ) : null}
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

const HostChrome = styled.header`
  position: relative;
  z-index: 80;
  container-type: inline-size;
  display: grid;
  width: 100%;
  min-width: 0;
  grid-template-rows: auto auto;
  border-bottom: 1px solid var(--web-border);
  background: var(--web-panel);
`;

const HostTopRail = styled(TerminalRestartPill)`
  min-height: 30px;
  padding: 3px 8px;
  border-bottom-color: rgba(226, 232, 240, 0.06);
  background: transparent;

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(24, 34, 48, 0.1);
    background: transparent;
  }
`;

const HostRailIdentity = styled(TerminalRailIdentity)`
  flex: 0 1 auto;
  min-width: 0;
  color: var(--web-muted);

  svg {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
  }
`;

const HostRailControls = styled(TerminalRailControls)``;

const HostIconButton = styled(TerminalRestartButton)`
  color: var(--web-text);

  html[data-forge-theme="light"] &:hover:not(:disabled),
  html[data-forge-theme="light"] &:focus-visible {
    color: var(--forge-text, #1d2430);
  }
`;

const HostCloseButton = styled(TerminalCloseButton)``;

const HostNavRow = styled.div`
  display: flex;
  min-width: 0;
  min-height: 34px;
  align-items: center;
  padding: 4px 8px 5px;
  background: var(--web-panel);
`;

const HostNav = styled.form`
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  flex: 1 1 auto;
  gap: 4px;
  padding: 0;
  border: 0;
  background: transparent;
`;

const HostAddressInput = styled.input`
  min-width: 0;
  flex: 1 1 auto;
  height: 26px;
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

const HostInlineError = styled.div`
  grid-row: 2;
  padding: 6px 12px;
  color: var(--web-danger);
  background: rgba(120, 24, 24, 0.18);
  font-size: 12px;
  font-weight: 720;
`;

const HostViewport = styled.div`
  grid-row: 3;
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

const HostPickerError = styled.div`
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

import React, { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AdsClick } from "@styled-icons/material-rounded/AdsClick";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";
import {
  ButtonBotIcon,
  ButtonCloseIcon,
  ButtonDragIcon,
  ButtonFullscreenExitIcon,
  ButtonFullscreenIcon,
  ButtonProcessIcon,
  GlobalStyle,
  TerminalAgentLabel,
  TerminalCloseButton,
  TerminalRailControls,
  TerminalRailIdentity,
  TerminalRestartButton,
  TerminalRestartPill,
} from "../app/appStyles.js";
import { usePopoutWindowFullscreen } from "../app/usePopoutWindowFullscreen.js";
import PcbPanel from "./PcbPanel.jsx";
import PcbWorkspacePane from "./PcbWorkspacePane.jsx";
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
import {
  PCB_PANEL_COMMAND_EVENT,
  PCB_PANEL_CONTROL_BOARD_CHANGE,
  PCB_PANEL_CONTROL_EVENT,
  PCB_PANEL_CONTROL_RETURN,
} from "./pcbPanelBridge.js";

// Routing gate: AppShell renders <PcbWindowHost /> (instead of the full shell)
// when the window's hash starts with this prefix.
export const PCB_WINDOW_HASH = "#/pcb-window";

function parsePcbWindowParams() {
  const hash = typeof window !== "undefined" ? window.location.hash || "" : "";
  const queryIndex = hash.indexOf("?");
  const search = queryIndex >= 0 ? hash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(search);
  return {
    board_path: params.get("board_path") || params.get("boardPath") || "",
    repo_path: params.get("repo_path") || params.get("repoPath") || "",
    board_name: params.get("board_name") || params.get("boardName") || "",
    mode: params.get("mode") || "",
    pane_id: params.get("pane_id") || params.get("paneId") || "",
    tab: params.get("tab") || "pcb",
    theme: params.get("theme") || "dark",
    window_id: params.get("window_id") || params.get("windowId") || "",
    workspace_id: params.get("workspace_id") || params.get("workspaceId") || "",
  };
}

function safeTauriWindowCall(windowHandle, action, ...args) {
  try {
    Promise.resolve(windowHandle?.[action]?.(...args)).catch(() => {});
  } catch {
    // Native window handles can be released during close/return races.
  }
}

const WindowRoot = styled.div`
  position: fixed;
  inset: 0;
  display: flex;
  background: #050b14;
  padding: 8px;
`;

// Standalone host for the popped-out board. The OS window provides the title
// bar + close control; this just mounts a single full-window PcbPanel and keeps
// the workspace watcher running so edits live-reload here too.
export default function PcbWindowHost() {
  const [params] = useState(parsePcbWindowParams);
  const [panelCommand, setPanelCommand] = useState(null);
  const [agentPromptOpen, setAgentPromptOpen] = useState(false);
  const [elementPicker, setElementPicker] = useState(null);
  const [agentPromptActivityItems, setAgentPromptActivityItems] = useState([]);
  const [agentPromptTargets, setAgentPromptTargets] = useState([]);
  const [defaultAgentPromptTargetIds, setDefaultAgentPromptTargetIds] = useState([]);
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const { isFullscreen, toggleFullscreen } = usePopoutWindowFullscreen(currentWindow);
  const agentPromptTargetsRequestIdRef = React.useRef("");
  const windowLabel = useMemo(() => {
    try {
      return currentWindow.label || params.window_id || "";
    } catch {
      return params.window_id || "";
    }
  }, [currentWindow, params.window_id]);
  const board = useMemo(
    () => ({ path: params.board_path, name: params.board_name || params.board_path }),
    [params],
  );
  const isPanelWindow = params.mode === "panel" || Boolean(params.pane_id);

  useEffect(() => {
    document.documentElement.dataset.forgeTheme =
      String(params.theme || "dark").toLowerCase() === "light" ? "light" : "dark";
  }, [params.theme]);

  useEffect(() => {
    if (params.repo_path) {
      invoke("pcb_watch_start", { repo_path: params.repo_path }).catch(() => {});
    }
  }, [params.repo_path]);

  const startWindowDrag = useCallback((event) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    safeTauriWindowCall(currentWindow, "startDragging");
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
    safeTauriWindowCall(currentWindow, "startDragging");
  }, [currentWindow]);

  const returnToGrid = useCallback(() => {
    emit(PCB_PANEL_CONTROL_EVENT, {
      control: PCB_PANEL_CONTROL_RETURN,
      pane_id: params.pane_id,
      window_id: windowLabel,
      workspace_id: params.workspace_id,
    })
      .catch(() => {})
      .finally(() => {
        safeTauriWindowCall(currentWindow, "close");
      });
  }, [currentWindow, params.pane_id, params.workspace_id, windowLabel]);

  const requestAgentPromptTargets = useCallback(() => {
    const requestId = createPanelAgentPromptRequestId("pcb-panel-targets");
    agentPromptTargetsRequestIdRef.current = requestId;
    emit(PANEL_AGENT_PROMPT_TARGETS_REQUEST_EVENT, {
      panel_kind: "pcb",
      pane_id: params.pane_id,
      request_id: requestId,
      window_id: windowLabel,
      workspace_id: params.workspace_id,
    }).catch(() => {});
  }, [params.pane_id, params.workspace_id, windowLabel]);

  const requestAgentPromptActivity = useCallback(() => {
    if (!isPanelWindow || !params.pane_id) {
      return;
    }
    emit(PANEL_AGENT_PROMPT_ACTIVITY_REQUEST_EVENT, {
      panel_kind: "pcb",
      pane_id: params.pane_id,
      window_id: windowLabel,
      workspace_id: params.workspace_id,
    }).catch(() => {});
  }, [isPanelWindow, params.pane_id, params.workspace_id, windowLabel]);

  useEffect(() => {
    requestAgentPromptActivity();
  }, [requestAgentPromptActivity]);

  useEffect(() => {
    if (!isPanelWindow || !params.pane_id) {
      return undefined;
    }
    let disposed = false;
    let unlisten = () => {};
    listen(PANEL_AGENT_PROMPT_ACTIVITY_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const paneId = String(payload.pane_id || payload.panel_pane_id || "").trim();
      if (!paneId || paneId !== params.pane_id) {
        return;
      }
      const workspaceId = String(payload.workspace_id || "").trim();
      if (workspaceId && params.workspace_id && workspaceId !== params.workspace_id) {
        return;
      }
      const windowId = String(payload.window_id || "").trim();
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
  }, [isPanelWindow, params.pane_id, params.workspace_id, windowLabel]);

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
      const requestId = String(payload.request_id || "").trim();
      const windowId = String(payload.window_id || "").trim();
      if (requestId && requestId !== agentPromptTargetsRequestIdRef.current) {
        return;
      }
      if (windowId && windowId !== windowLabel) {
        return;
      }
      const workspaceId = String(payload.workspace_id || "").trim();
      if (workspaceId && params.workspace_id && workspaceId !== params.workspace_id) {
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
  }, [params.workspace_id, windowLabel]);

  const submitAgentPrompt = useCallback(async ({ context_refs: contextRefs, target_ids: targetIds, target_terminal_indexes: targetTerminalIndexes, text }) => {
    const requestId = createPanelAgentPromptRequestId("pcb-panel-submit");
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
        if (String(payload.request_id || "").trim() !== requestId) {
          return;
        }
        const windowId = String(payload.window_id || "").trim();
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
              context_refs: Array.isArray(contextRefs) ? contextRefs : [],
              panel_kind: "pcb",
              pane_id: params.pane_id,
              request_id: requestId,
              target_ids: targetIds,
              target_terminal_indexes: targetTerminalIndexes,
              text,
              window_id: windowLabel,
              workspace_id: params.workspace_id,
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
  }, [params.pane_id, params.workspace_id, windowLabel]);

  useEffect(() => {
    if (!isPanelWindow || !params.pane_id) {
      return undefined;
    }
    let disposed = false;
    let unlisten = () => {};
    listen(PCB_PANEL_COMMAND_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const paneId = String(payload.pane_id || "").trim();
      const workspaceId = String(payload.workspace_id || "").trim();
      const windowId = String(payload.window_id || "").trim();
      if (paneId && paneId !== params.pane_id) {
        return;
      }
      if (workspaceId && workspaceId !== params.workspace_id) {
        return;
      }
      if (windowId && windowId !== windowLabel) {
        return;
      }
      const action = String(payload.action || payload.command?.action || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
      if (action === "focus" || action === "open" || action === "popout" || action === "open-window") {
        safeTauriWindowCall(currentWindow, "setFocus");
        return;
      }
      if (action === "return" || action === "return-to-grid") {
        returnToGrid();
        return;
      }
      setPanelCommand({
        ...(payload.command || payload),
        action,
        nonce: Number(payload.nonce || payload.command?.nonce || 0) || Date.now() + Math.random(),
      });
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
  }, [currentWindow, isPanelWindow, params.pane_id, params.workspace_id, returnToGrid, windowLabel]);

  const handlePanelBoardChange = useCallback((nextBoard) => {
    if (!isPanelWindow || !params.pane_id) {
      return;
    }
    emit(PCB_PANEL_CONTROL_EVENT, {
      board: nextBoard || null,
      control: PCB_PANEL_CONTROL_BOARD_CHANGE,
      pane_id: params.pane_id,
      window_id: windowLabel,
      workspace_id: params.workspace_id,
    }).catch(() => {});
  }, [isPanelWindow, params.pane_id, params.workspace_id, windowLabel]);

  if (isPanelWindow) {
    return (
      <PanelWindowRoot data-workspace-pcb-panel-window="true">
        <GlobalStyle />
        <PanelChrome
          data-tauri-drag-region="true"
          data-terminal-control="true"
          onPointerDown={startChromeDrag}
        >
          <PanelIdentity data-tauri-drag-region="true">
            <PanelIconButton
              aria-label="Move PCB window"
              data-terminal-drag-handle="true"
              onPointerDown={startWindowDrag}
              title="Move window"
              type="button"
            >
              <ButtonDragIcon aria-hidden="true" />
            </PanelIconButton>
            <PanelGlyph aria-hidden="true">
              <ButtonProcessIcon aria-hidden="true" />
            </PanelGlyph>
            <PanelTitle data-tauri-drag-region="true" title="PCB">
              PCB
            </PanelTitle>
          </PanelIdentity>
          <TerminalRailControls data-rail-row="primary">
            <PanelIconButton
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              aria-pressed={isFullscreen ? "true" : "false"}
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              type="button"
            >
              {isFullscreen ? (
                <ButtonFullscreenExitIcon aria-hidden="true" />
              ) : (
                <ButtonFullscreenIcon aria-hidden="true" />
              )}
            </PanelIconButton>
            <PanelCloseButton aria-label="Close" onClick={() => safeTauriWindowCall(currentWindow, "close")} title="Close" type="button">
              <ButtonCloseIcon aria-hidden="true" />
            </PanelCloseButton>
          </TerminalRailControls>
          <TerminalRailControls data-rail-row="secondary">
            <PanelIconButton
              aria-label="Prompt terminal agents"
              aria-pressed={agentPromptOpen ? "true" : "false"}
              data-active={agentPromptOpen ? "true" : undefined}
              onClick={() => setAgentPromptOpen((open) => !open)}
              title="Prompt terminal agents"
              type="button"
            >
              <ButtonBotIcon aria-hidden="true" />
            </PanelIconButton>
            {agentPromptOpen && elementPicker ? (
              <PanelIconButton
                aria-label="Select board element"
                aria-pressed={elementPicker.enabled || elementPicker.count ? "true" : "false"}
                data-active={elementPicker.enabled || elementPicker.count ? "true" : undefined}
                onClick={elementPicker.toggle}
                title={elementPicker.count
                  ? `Select board element (${elementPicker.count} held)`
                  : "Select board element"}
                type="button"
              >
                <AdsClick aria-hidden="true" />
              </PanelIconButton>
            ) : null}
            <PanelIconButton
              aria-label="Return PCB panel to the app"
              aria-pressed="true"
              data-active="true"
              onClick={returnToGrid}
              title="Return to app"
              type="button"
            >
              <OpenInNew aria-hidden="true" />
            </PanelIconButton>
          </TerminalRailControls>
        </PanelChrome>
        <PanelBody>
          {agentPromptActivityItems.length ? (
            <PanelActivityOverlay>
              <PanelAgentPromptActivity items={agentPromptActivityItems} />
            </PanelActivityOverlay>
          ) : null}
          <PcbWorkspacePane
            controlCommand={panelCommand}
            is_active
            onBoardChange={handlePanelBoardChange}
            onElementPickerChange={setElementPicker}
            pane_id={params.pane_id}
            repo_path={params.repo_path}
            workspace_id={params.workspace_id}
          />
          {agentPromptOpen ? (
            <PanelAgentPromptComposer
              autoFocus
              context_refs={elementPicker?.contexts || []}
              default_selected_target_ids={defaultAgentPromptTargetIds}
              onClearContext={elementPicker?.clear}
              onClose={() => setAgentPromptOpen(false)}
              onSubmit={submitAgentPrompt}
              panel_kind="pcb"
              panel_pane_id={params.pane_id}
              targets={agentPromptTargets}
              window_id={windowLabel}
            />
          ) : null}
        </PanelBody>
      </PanelWindowRoot>
    );
  }

  return (
    <WindowRoot>
      <GlobalStyle />
      <PcbPanel
        board={board}
        defaultTab={params.tab}
        is_active
        repo_path={params.repo_path}
        workspace_id={params.workspace_id}
      />
    </WindowRoot>
  );
}

const PanelWindowRoot = styled.div`
  container-type: inline-size;
  display: grid;
  width: 100vw;
  height: 100vh;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
  color: rgba(226, 232, 240, 0.88);
  background: #020304;
`;

const PanelChrome = styled(TerminalRestartPill)`
  border-bottom-color: rgba(226, 232, 240, 0.08);
  background: #0b0e14;
`;

const PanelIdentity = styled(TerminalRailIdentity)`
  min-width: 0;
`;

const PanelGlyph = styled.span`
  display: inline-flex;
  width: 18px;
  height: 18px;
  align-items: center;
  justify-content: center;
  color: rgba(167, 243, 208, 0.92);

  svg {
    width: 14px;
    height: 14px;
  }
`;

const PanelTitle = styled(TerminalAgentLabel)`
  max-width: min(18rem, 42cqi);
  color: rgba(226, 232, 240, 0.92);
  font-size: 12px;
`;

const PanelIconButton = styled(TerminalRestartButton)``;

const PanelCloseButton = styled(TerminalCloseButton)``;

const PanelBody = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

// Prompt activity floats over the board content (matching the web panel's
// in-page overlay) instead of riding in the window's button rail.
const PanelActivityOverlay = styled.div`
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 6;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;

  > * {
    pointer-events: auto;
  }
`;

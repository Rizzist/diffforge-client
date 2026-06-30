import React, { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";
import {
  ButtonCloseIcon,
  ButtonDragIcon,
  ButtonProcessIcon,
  GlobalStyle,
  TerminalAgentLabel,
  TerminalCloseButton,
  TerminalRailControls,
  TerminalRailIdentity,
  TerminalRestartButton,
  TerminalRestartPill,
} from "../app/appStyles.js";
import PcbPanel from "./PcbPanel.jsx";
import PcbWorkspacePane from "./PcbWorkspacePane.jsx";
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
    boardPath: params.get("boardPath") || "",
    repoPath: params.get("repoPath") || "",
    boardName: params.get("boardName") || "",
    mode: params.get("mode") || "",
    paneId: params.get("paneId") || "",
    tab: params.get("tab") || "pcb",
    theme: params.get("theme") || "dark",
    windowId: params.get("windowId") || "",
    workspaceId: params.get("workspaceId") || "",
  };
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
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const windowLabel = useMemo(() => {
    try {
      return currentWindow.label || params.windowId || "";
    } catch {
      return params.windowId || "";
    }
  }, [currentWindow, params.windowId]);
  const board = useMemo(
    () => ({ path: params.boardPath, name: params.boardName || params.boardPath }),
    [params],
  );
  const isPanelWindow = params.mode === "panel" || Boolean(params.paneId);

  useEffect(() => {
    document.documentElement.dataset.forgeTheme =
      String(params.theme || "dark").toLowerCase() === "light" ? "light" : "dark";
  }, [params.theme]);

  useEffect(() => {
    if (params.repoPath) {
      invoke("pcb_watch_start", { repoPath: params.repoPath }).catch(() => {});
    }
  }, [params.repoPath]);

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
    emit(PCB_PANEL_CONTROL_EVENT, {
      control: PCB_PANEL_CONTROL_RETURN,
      paneId: params.paneId,
      windowId: windowLabel,
      workspaceId: params.workspaceId,
    })
      .catch(() => {})
      .finally(() => {
        currentWindow.close().catch(() => {});
      });
  }, [currentWindow, params.paneId, params.workspaceId, windowLabel]);

  useEffect(() => {
    if (!isPanelWindow || !params.paneId) {
      return undefined;
    }
    let disposed = false;
    let unlisten = () => {};
    listen(PCB_PANEL_COMMAND_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const paneId = String(payload.paneId || payload.pane_id || "").trim();
      const workspaceId = String(payload.workspaceId || payload.workspace_id || "").trim();
      const windowId = String(payload.windowId || payload.window_id || "").trim();
      if (paneId && paneId !== params.paneId) {
        return;
      }
      if (workspaceId && workspaceId !== params.workspaceId) {
        return;
      }
      if (windowId && windowId !== windowLabel) {
        return;
      }
      const action = String(payload.action || payload.command?.action || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
      if (action === "focus" || action === "open" || action === "popout" || action === "open-window") {
        currentWindow.setFocus().catch(() => {});
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
  }, [currentWindow, isPanelWindow, params.paneId, params.workspaceId, returnToGrid, windowLabel]);

  const handlePanelBoardChange = useCallback((nextBoard) => {
    if (!isPanelWindow || !params.paneId) {
      return;
    }
    emit(PCB_PANEL_CONTROL_EVENT, {
      board: nextBoard || null,
      control: PCB_PANEL_CONTROL_BOARD_CHANGE,
      paneId: params.paneId,
      windowId: windowLabel,
      workspaceId: params.workspaceId,
    }).catch(() => {});
  }, [isPanelWindow, params.paneId, params.workspaceId, windowLabel]);

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
          <TerminalRailControls data-rail-row="secondary">
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
            <PanelCloseButton aria-label="Close" onClick={() => currentWindow.close().catch(() => {})} title="Close" type="button">
              <ButtonCloseIcon aria-hidden="true" />
            </PanelCloseButton>
          </TerminalRailControls>
        </PanelChrome>
        <PanelBody>
          <PcbWorkspacePane
            controlCommand={panelCommand}
            isActive
            onBoardChange={handlePanelBoardChange}
            paneId={params.paneId}
            repoPath={params.repoPath}
            workspaceId={params.workspaceId}
          />
        </PanelBody>
      </PanelWindowRoot>
    );
  }

  return (
    <WindowRoot>
      <GlobalStyle />
      <PcbPanel board={board} defaultTab={params.tab} isActive repoPath={params.repoPath} />
    </WindowRoot>
  );
}

const PanelWindowRoot = styled.div`
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
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

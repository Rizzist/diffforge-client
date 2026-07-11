import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";
import { Movie } from "@styled-icons/material-rounded/Movie";
import {
  ButtonBotIcon,
  ButtonCloseIcon,
  ButtonDragIcon,
  ButtonFullscreenExitIcon,
  ButtonFullscreenIcon,
  GlobalStyle,
  TerminalAgentLabel,
  TerminalCloseButton,
  TerminalRailControls,
  TerminalRailIdentity,
  TerminalRestartButton,
  TerminalRestartPill,
} from "../app/appStyles.js";
import { usePopoutWindowFullscreen } from "../app/usePopoutWindowFullscreen.js";
import VideoWorkspacePane from "./VideoWorkspacePane.jsx";
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
  VIDEO_PANEL_COMMAND_EVENT,
  VIDEO_PANEL_CONTROL_EVENT,
  VIDEO_PANEL_CONTROL_PROJECT_CHANGE,
  VIDEO_PANEL_CONTROL_RETURN,
  VIDEO_WINDOW_HASH,
} from "./videoPanelBridge.js";

export { VIDEO_WINDOW_HASH };

function parseVideoWindowParams() {
  const hash = typeof window !== "undefined" ? window.location.hash || "" : "";
  const queryIndex = hash.indexOf("?");
  const search = queryIndex >= 0 ? hash.slice(queryIndex + 1) : "";
  const params = new URLSearchParams(search);
  return {
    mode: params.get("mode") || "",
    paneId: params.get("paneId") || "",
    repoPath: params.get("repoPath") || "",
    theme: params.get("theme") || "dark",
    windowId: params.get("windowId") || "",
    workspaceId: params.get("workspaceId") || "",
  };
}

function safeTauriWindowCall(windowHandle, action, ...args) {
  try {
    Promise.resolve(windowHandle?.[action]?.(...args)).catch(() => {});
  } catch {
    // Native window handles can be released during close/return races.
  }
}

// Standalone host for the popped-out Video Editor pane. Mirrors PcbWindowHost:
// custom chrome with drag region, return-to-grid control event, and the
// cross-window agent-prompt bridge (panelKind "video").
export default function VideoWindowHost() {
  const [params] = useState(parseVideoWindowParams);
  const [panelCommand, setPanelCommand] = useState(null);
  const [agentPromptOpen, setAgentPromptOpen] = useState(false);
  const [agentPromptActivityItems, setAgentPromptActivityItems] = useState([]);
  const [agentPromptTargets, setAgentPromptTargets] = useState([]);
  const [defaultAgentPromptTargetIds, setDefaultAgentPromptTargetIds] = useState([]);
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const { isFullscreen, toggleFullscreen } = usePopoutWindowFullscreen(currentWindow);
  const agentPromptTargetsRequestIdRef = useRef("");
  const windowLabel = useMemo(() => {
    try {
      return currentWindow.label || params.windowId || "";
    } catch {
      return params.windowId || "";
    }
  }, [currentWindow, params.windowId]);

  useEffect(() => {
    document.documentElement.dataset.forgeTheme =
      String(params.theme || "dark").toLowerCase() === "light" ? "light" : "dark";
  }, [params.theme]);

  useEffect(() => {
    if (params.repoPath) {
      invoke("video_watch_start", { repoPath: params.repoPath }).catch(() => {});
    }
  }, [params.repoPath]);

  const startWindowDrag = useCallback(
    (event) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      safeTauriWindowCall(currentWindow, "startDragging");
    },
    [currentWindow],
  );

  const startChromeDrag = useCallback(
    (event) => {
      if (
        event.button !== 0
        || event.target?.closest?.("button, input, textarea, select, a, [contenteditable='true']")
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      safeTauriWindowCall(currentWindow, "startDragging");
    },
    [currentWindow],
  );

  const returnToGrid = useCallback(() => {
    emit(VIDEO_PANEL_CONTROL_EVENT, {
      control: VIDEO_PANEL_CONTROL_RETURN,
      paneId: params.paneId,
      windowId: windowLabel,
      workspaceId: params.workspaceId,
    })
      .catch(() => {})
      .finally(() => {
        safeTauriWindowCall(currentWindow, "close");
      });
  }, [currentWindow, params.paneId, params.workspaceId, windowLabel]);

  const requestAgentPromptTargets = useCallback(() => {
    const requestId = createPanelAgentPromptRequestId("video-panel-targets");
    agentPromptTargetsRequestIdRef.current = requestId;
    emit(PANEL_AGENT_PROMPT_TARGETS_REQUEST_EVENT, {
      panelKind: "video",
      paneId: params.paneId,
      requestId,
      windowId: windowLabel,
      workspaceId: params.workspaceId,
    }).catch(() => {});
  }, [params.paneId, params.workspaceId, windowLabel]);

  const requestAgentPromptActivity = useCallback(() => {
    if (!params.paneId) {
      return;
    }
    emit(PANEL_AGENT_PROMPT_ACTIVITY_REQUEST_EVENT, {
      panelKind: "video",
      paneId: params.paneId,
      windowId: windowLabel,
      workspaceId: params.workspaceId,
    }).catch(() => {});
  }, [params.paneId, params.workspaceId, windowLabel]);

  useEffect(() => {
    requestAgentPromptActivity();
  }, [requestAgentPromptActivity]);

  useEffect(() => {
    if (!params.paneId) {
      return undefined;
    }
    let disposed = false;
    let unlisten = () => {};
    listen(PANEL_AGENT_PROMPT_ACTIVITY_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const paneId = String(payload.paneId || payload.pane_id || payload.panelPaneId || payload.panel_pane_id || "").trim();
      if (!paneId || paneId !== params.paneId) {
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
        )
          .map((id) => String(id || "").trim())
          .filter(Boolean),
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

  const submitAgentPrompt = useCallback(
    async ({ target_ids: targetIds, target_terminal_indexes: targetTerminalIndexes, text }) => {
      const requestId = createPanelAgentPromptRequestId("video-panel-submit");
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
                panelKind: "video",
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
    },
    [params.paneId, params.workspaceId, windowLabel],
  );

  useEffect(() => {
    if (!params.paneId) {
      return undefined;
    }
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_PANEL_COMMAND_EVENT, (event) => {
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
      const action = String(payload.action || payload.command?.action || "")
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, "-");
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
  }, [currentWindow, params.paneId, params.workspaceId, returnToGrid, windowLabel]);

  const handleProjectChange = useCallback(
    (project) => {
      if (!params.paneId) {
        return;
      }
      emit(VIDEO_PANEL_CONTROL_EVENT, {
        control: VIDEO_PANEL_CONTROL_PROJECT_CHANGE,
        paneId: params.paneId,
        project: project || null,
        windowId: windowLabel,
        workspaceId: params.workspaceId,
      }).catch(() => {});
    },
    [params.paneId, params.workspaceId, windowLabel],
  );

  return (
    <PanelWindowRoot data-workspace-video-panel-window="true">
      <GlobalStyle />
      <PanelChrome data-tauri-drag-region="true" data-terminal-control="true" onPointerDown={startChromeDrag}>
        <PanelIdentity data-tauri-drag-region="true">
          <PanelIconButton
            aria-label="Move video editor window"
            data-terminal-drag-handle="true"
            onPointerDown={startWindowDrag}
            title="Move window"
            type="button"
          >
            <ButtonDragIcon aria-hidden="true" />
          </PanelIconButton>
          <PanelGlyph aria-hidden="true">
            <Movie aria-hidden="true" />
          </PanelGlyph>
          <PanelTitle data-tauri-drag-region="true" title="Video editor">
            Video editor
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
          <PanelCloseButton
            aria-label="Close"
            onClick={() => safeTauriWindowCall(currentWindow, "close")}
            title="Close"
            type="button"
          >
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
          <PanelIconButton
            aria-label="Return video editor to the app"
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
        <VideoWorkspacePane
          agentPromptActivity={agentPromptActivityItems}
          controlCommand={panelCommand}
          isActive
          onProjectChange={handleProjectChange}
          paneId={params.paneId}
          repoPath={params.repoPath}
          workspaceId={params.workspaceId}
        />
        {agentPromptOpen ? (
          <PanelAgentPromptComposer
            autoFocus
            default_selected_target_ids={defaultAgentPromptTargetIds}
            onClose={() => setAgentPromptOpen(false)}
            onSubmit={submitAgentPrompt}
            panel_kind="video"
            panel_pane_id={params.paneId}
            targets={agentPromptTargets}
            window_id={windowLabel}
          />
        ) : null}
      </PanelBody>
    </PanelWindowRoot>
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

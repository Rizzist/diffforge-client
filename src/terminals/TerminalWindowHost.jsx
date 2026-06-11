import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { Terminal as XTerm } from "@xterm/xterm";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";

import {
  ButtonBrowserIcon,
  ButtonCloseIcon,
  ButtonDragIcon,
  ButtonFullscreenIcon,
  ButtonRefreshIcon,
  ButtonSplitHorizontalIcon,
  ButtonSplitVerticalIcon,
  TerminalAgentDot,
  TerminalAgentLabel,
  TerminalCloseButton,
  TerminalRailControls,
  TerminalRailIdentity,
  TerminalRestartButton,
  TerminalRestartDropdown,
  TerminalRestartMenu,
  TerminalRestartOption,
  TerminalRestartPill,
  TerminalStateDebugBadge,
} from "../app/appStyles.js";
import { measureTerminalGrid } from "./terminalResizeController";
import {
  TERMINAL_WINDOW_CONTROL_CLOSE_TERMINAL,
  TERMINAL_WINDOW_CONTROL_EVENT,
  TERMINAL_WINDOW_CONTROL_FULLSCREEN,
  TERMINAL_WINDOW_CONTROL_RESTART_AS,
  TERMINAL_WINDOW_CONTROL_SPLIT_HORIZONTAL,
  TERMINAL_WINDOW_CONTROL_SPLIT_VERTICAL,
  TERMINAL_WINDOW_CONTROL_UI_VIEW,
  TERMINAL_WINDOW_META_EVENT,
  TERMINAL_WINDOW_META_REQUEST_EVENT,
} from "./terminalWindowBridge.js";
import { TERMINAL_DARK_THEME, TERMINAL_LIGHT_THEME } from "./WorkspaceTerminal/index.jsx";

export const TERMINAL_WINDOW_HASH = "#/terminal-window";
export const TERMINAL_WINDOW_CLOSED_EVENT = "forge-terminal-window-closed";

const TERMINAL_WINDOW_RESIZE_DEBOUNCE_MS = 90;
const TERMINAL_WINDOW_REATTACH_DELAY_MS = 1200;

const HostShell = styled.div`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  border: 1px solid rgba(230, 236, 245, 0.14);
  border-radius: 10px;
  background: ${TERMINAL_DARK_THEME.background};
  clip-path: inset(0 round 10px);

  html[data-forge-theme="light"] & {
    border-color: rgba(24, 34, 48, 0.16);
    background: ${TERMINAL_LIGHT_THEME.background};
  }
`;

const HostTerminalSurface = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  padding: 6px 4px 6px 10px;
  background: ${TERMINAL_DARK_THEME.background};

  html[data-forge-theme="light"] & {
    background: ${TERMINAL_LIGHT_THEME.background};
  }

  .xterm {
    width: 100%;
    height: 100%;
  }

  .xterm .xterm-viewport {
    background: transparent;
  }
`;

const HostNotice = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: 6px;
  text-align: center;
  color: rgba(230, 236, 245, 0.6);
  background: rgba(2, 3, 4, 0.78);
  font-size: 12px;
  font-weight: 650;

  strong {
    color: rgba(230, 236, 245, 0.9);
    font-size: 13px;
  }

  html[data-forge-theme="light"] & {
    color: rgba(24, 34, 48, 0.62);
    background: rgba(255, 255, 255, 0.82);

    strong {
      color: rgba(24, 34, 48, 0.92);
    }
  }
`;

function parseTerminalWindowParams() {
  if (typeof window === "undefined") {
    return {
      agentKind: "",
      agentLabel: "Terminal",
      colorSlot: "",
      paneId: "",
      theme: "",
      title: "Terminal",
    };
  }

  const hash = window.location.hash || "";
  const queryIndex = hash.indexOf("?");
  const params = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : "");

  return {
    agentKind: params.get("agentKind") || "",
    agentLabel: params.get("agentLabel") || params.get("title") || "Terminal",
    colorSlot: params.get("colorSlot") || "",
    paneId: params.get("paneId") || "",
    theme: params.get("theme") || "",
    title: params.get("title") || "Terminal",
  };
}

function base64ToUint8Array(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Window Breakout host: renders one running terminal pane in its own native
 * window with the exact in-grid header bar (agent dot, name, state badge,
 * controls). The pane's PTY keeps living in the main process; this window is
 * an extra subscriber on the terminal output transport (scrollback replayed
 * from the headless buffer), so opening/closing it never disturbs the agent.
 * The grid pane in the main window broadcasts live header meta and executes
 * the control clicks this window emits back.
 */
export default function TerminalWindowHost() {
  const params = useMemo(parseTerminalWindowParams, []);
  const { paneId, theme, title } = params;
  const containerRef = useRef(null);
  const restartMenuRef = useRef(null);
  const [status, setStatus] = useState("connecting");
  const [statusDetail, setStatusDetail] = useState("");
  const [restartMenuOpen, setRestartMenuOpen] = useState(false);
  const [meta, setMeta] = useState(() => ({
    agentKind: params.agentKind,
    agentLabel: params.agentLabel,
    agentTitle: params.agentLabel,
    canOpenUiView: false,
    canSplit: true,
    colorSlot: params.colorSlot,
    roleOptions: [],
    stateLabel: "",
  }));

  useEffect(() => {
    document.documentElement.dataset.terminalWindow = "true";
    document.body.dataset.terminalWindow = "true";
    document.body.style.background = "transparent";
    if (theme) {
      document.documentElement.dataset.forgeTheme = theme;
    }

    return () => {
      delete document.documentElement.dataset.terminalWindow;
      delete document.body.dataset.terminalWindow;
    };
  }, [theme]);

  // Live header meta from the grid pane: agent identity, state badge, and
  // which controls are currently available.
  useEffect(() => {
    if (!paneId) {
      return undefined;
    }

    let disposed = false;
    let unlisten = () => {};
    listen(TERMINAL_WINDOW_META_EVENT, (event) => {
      if (disposed || String(event.payload?.paneId || "") !== paneId) {
        return;
      }
      setMeta((current) => ({ ...current, ...event.payload }));
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
        emit(TERMINAL_WINDOW_META_REQUEST_EVENT, { paneId }).catch(() => {});
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten();
    };
  }, [paneId]);

  useEffect(() => {
    if (!restartMenuOpen) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!restartMenuRef.current?.contains(event.target)) {
        setRestartMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => document.removeEventListener("pointerdown", handlePointerDown, true);
  }, [restartMenuOpen]);

  useEffect(() => {
    const container = containerRef.current;
    if (!paneId || !container) {
      setStatus("error");
      setStatusDetail("This window is missing its terminal identity.");
      return undefined;
    }

    let disposed = false;
    let socket = null;
    let term = null;
    let resizeTimer = 0;
    let reattachTimer = 0;
    let detachResize = () => {};

    const fitTerminal = () => {
      if (disposed || !term) {
        return;
      }

      const measurement = measureTerminalGrid({ container, term });
      if (!measurement.ok) {
        return;
      }

      if (term.cols !== measurement.cols || term.rows !== measurement.rows) {
        term.resize(measurement.cols, measurement.rows);
      }
      invoke("terminal_resize", {
        paneId,
        cols: measurement.cols,
        rows: measurement.rows,
      }).catch(() => {});
    };

    const scheduleFit = () => {
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
      resizeTimer = window.setTimeout(() => {
        resizeTimer = 0;
        fitTerminal();
      }, TERMINAL_WINDOW_RESIZE_DEBOUNCE_MS);
    };

    // Restarting the terminal (e.g. from this window's restart menu) creates
    // a new PTY instance and drops the old transport stream; reattach instead
    // of dying so the window survives restarts. If the pane truly closes, the
    // main window closes this window for us.
    const scheduleReattach = () => {
      if (disposed || reattachTimer) {
        return;
      }
      setStatus("connecting");
      setStatusDetail("Reattaching to the terminal...");
      reattachTimer = window.setTimeout(() => {
        reattachTimer = 0;
        void attach();
      }, TERMINAL_WINDOW_REATTACH_DELAY_MS);
    };

    const attach = async () => {
      let instanceId = 0;
      try {
        const info = await invoke("terminal_pane_runtime_info", { paneId });
        instanceId = Number(info?.instanceId || 0);
      } catch {
        scheduleReattach();
        return;
      }
      if (disposed || !term) {
        return;
      }

      term.reset();

      // Replay the headless scrollback before live frames arrive.
      try {
        const snapshot = await invoke("terminal_headless_output_snapshot", {
          paneId,
          instanceId,
        });
        if (!disposed && snapshot?.bytesBase64) {
          term.write(base64ToUint8Array(snapshot.bytesBase64));
        }
      } catch {
        // A missing snapshot only loses scrollback; live output still works.
      }
      if (disposed) {
        return;
      }

      const endpoint = await invoke("terminal_output_transport_endpoint");
      if (disposed) {
        return;
      }

      try {
        socket?.close();
      } catch {
        // Old socket teardown is best-effort.
      }
      socket = new WebSocket(endpoint.url);
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        try {
          socket.send(JSON.stringify({
            id: `terminal-window-${paneId}`,
            instanceId,
            paneId,
            token: endpoint.token,
            type: "subscribe",
          }));
        } catch {
          setStatus("error");
          setStatusDetail("Unable to subscribe to terminal output.");
        }
      };
      socket.onmessage = (event) => {
        if (disposed) {
          return;
        }
        if (typeof event.data === "string") {
          setStatus("ready");
          setStatusDetail("");
          return;
        }
        term?.write(new Uint8Array(event.data));
      };
      socket.onclose = () => {
        if (!disposed) {
          scheduleReattach();
        }
      };
      socket.onerror = () => {
        if (!disposed) {
          scheduleReattach();
        }
      };

      window.requestAnimationFrame(() => {
        fitTerminal();
        term?.focus();
      });
    };

    const run = async () => {
      const isLightTheme = document.documentElement.dataset.forgeTheme === "light";
      term = new XTerm({
        allowProposedApi: false,
        convertEol: false,
        cursorBlink: true,
        cursorStyle: "block",
        customGlyphs: true,
        fastScrollModifier: "alt",
        fastScrollSensitivity: 5,
        fontFamily: "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.0,
        macOptionIsMeta: true,
        scrollback: 10000,
        smoothScrollDuration: 0,
        theme: isLightTheme ? TERMINAL_LIGHT_THEME : TERMINAL_DARK_THEME,
      });
      term.open(container);

      term.onData((data) => {
        invoke("terminal_write", { paneId, data }).catch(() => {});
      });

      window.addEventListener("resize", scheduleFit);
      detachResize = () => window.removeEventListener("resize", scheduleFit);

      await attach();
    };

    run().catch((error) => {
      if (!disposed) {
        setStatus("error");
        setStatusDetail(String(error?.message || error || "Unable to attach to the terminal."));
      }
    });

    return () => {
      disposed = true;
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
      if (reattachTimer) {
        window.clearTimeout(reattachTimer);
      }
      detachResize();
      try {
        socket?.close();
      } catch {
        // Socket teardown is best-effort.
      }
      try {
        term?.dispose();
      } catch {
        // Renderer teardown is best-effort.
      }
    };
  }, [paneId]);

  const sendControl = useCallback((control, extra = {}) => {
    if (!paneId) {
      return;
    }
    emit(TERMINAL_WINDOW_CONTROL_EVENT, { control, paneId, ...extra }).catch(() => {});
  }, [paneId]);

  const startWindowDrag = useCallback((event) => {
    if (event.button !== 0) {
      return;
    }
    Promise.resolve(getCurrentWindow().startDragging()).catch(() => {});
  }, []);

  const closeWindow = useCallback(() => {
    try {
      Promise.resolve(getCurrentWindow().close()).catch(() => {});
    } catch {
      // Window close is best-effort; the main grid converges via events.
    }
  }, []);

  const handleRestartButtonClick = useCallback(() => {
    if (meta.roleOptions.length) {
      setRestartMenuOpen((isOpen) => !isOpen);
      return;
    }
    sendControl(TERMINAL_WINDOW_CONTROL_RESTART_AS, { roleId: meta.agentKind });
  }, [meta.agentKind, meta.roleOptions.length, sendControl]);

  const stateBadgeLabel = meta.stateLabel
    || (status === "ready" ? "Live" : status === "connecting" ? "Linking" : "Off");
  const agentTitle = meta.agentTitle || meta.agentLabel || title;

  return (
    <HostShell>
      <TerminalRestartPill data-tauri-drag-region data-terminal-control="true">
        <TerminalRailIdentity data-tauri-drag-region>
          {/* Drag handle lives at the far left of the rail, away from the
              destructive close button on the right. */}
          <TerminalRestartButton
            aria-label="Move window"
            onPointerDown={startWindowDrag}
            title="Move window"
            type="button"
          >
            <ButtonDragIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalAgentDot
            aria-hidden="true"
            data-agent={meta.agentKind || undefined}
            data-slot={meta.colorSlot || undefined}
            title={agentTitle}
          />
          <TerminalAgentLabel data-tauri-drag-region title={agentTitle}>
            {meta.agentLabel || title}
          </TerminalAgentLabel>
          <TerminalStateDebugBadge title={`Terminal state: ${stateBadgeLabel}`}>
            {stateBadgeLabel}
          </TerminalStateDebugBadge>
        </TerminalRailIdentity>
        <TerminalRailControls data-rail-row="primary">
          <TerminalCloseButton
            aria-label="Close terminal"
            onClick={() => sendControl(TERMINAL_WINDOW_CONTROL_CLOSE_TERMINAL)}
            title="Close terminal"
            type="button"
          >
            <ButtonCloseIcon aria-hidden="true" />
          </TerminalCloseButton>
        </TerminalRailControls>
        <TerminalRailControls data-rail-row="secondary">
          <TerminalRestartButton
            aria-label="Return terminal to the app"
            aria-pressed="true"
            data-active="true"
            onClick={closeWindow}
            title="Return to app"
            type="button"
          >
            <OpenInNew aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Show UI view in the app"
            disabled={!meta.canOpenUiView}
            onClick={() => sendControl(TERMINAL_WINDOW_CONTROL_UI_VIEW)}
            title={meta.canOpenUiView ? "Return to the app and show UI view" : "No thread available"}
            type="button"
          >
            <ButtonBrowserIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Split terminal horizontally"
            disabled={!meta.canSplit}
            onClick={() => sendControl(TERMINAL_WINDOW_CONTROL_SPLIT_HORIZONTAL)}
            title={meta.canSplit ? "Split terminal horizontally (new pane opens in the app)" : "Terminal limit reached"}
            type="button"
          >
            <ButtonSplitHorizontalIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Split terminal vertically"
            disabled={!meta.canSplit}
            onClick={() => sendControl(TERMINAL_WINDOW_CONTROL_SPLIT_VERTICAL)}
            title={meta.canSplit ? "Split terminal vertically (new pane opens in the app)" : "Terminal limit reached"}
            type="button"
          >
            <ButtonSplitVerticalIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Open terminal threads in the app"
            onClick={() => sendControl(TERMINAL_WINDOW_CONTROL_FULLSCREEN)}
            title="Return to the app and open terminal threads"
            type="button"
          >
            <ButtonFullscreenIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartMenu data-terminal-control="true" ref={restartMenuRef}>
            <TerminalRestartButton
              aria-expanded={restartMenuOpen ? "true" : "false"}
              aria-haspopup="menu"
              aria-label="Restart terminal"
              onClick={handleRestartButtonClick}
              title="Restart terminal or choose runtime"
              type="button"
            >
              <ButtonRefreshIcon aria-hidden="true" />
            </TerminalRestartButton>
            <TerminalRestartDropdown data-open={restartMenuOpen ? "true" : "false"} role="menu">
              {meta.roleOptions.map((option) => (
                <TerminalRestartOption
                  data-role={option.id}
                  data-selected={option.id === meta.agentKind ? "true" : "false"}
                  key={option.id}
                  onClick={() => {
                    setRestartMenuOpen(false);
                    sendControl(TERMINAL_WINDOW_CONTROL_RESTART_AS, { roleId: option.id });
                  }}
                  role="menuitem"
                  title={option.id === meta.agentKind ? `Restart ${option.label}` : `Restart as ${option.label}`}
                  type="button"
                >
                  <strong>
                    {option.id === meta.agentKind ? `Restart ${option.label}` : option.label}
                  </strong>
                </TerminalRestartOption>
              ))}
            </TerminalRestartDropdown>
          </TerminalRestartMenu>
        </TerminalRailControls>
      </TerminalRestartPill>
      <HostTerminalSurface ref={containerRef}>
        {status !== "ready" && (
          <HostNotice>
            <strong>
              {status === "connecting"
                ? "Attaching terminal..."
                : status === "closed"
                  ? "Terminal disconnected"
                  : "Terminal attach failed"}
            </strong>
            {statusDetail && <span>{statusDetail}</span>}
          </HostNotice>
        )}
      </HostTerminalSurface>
    </HostShell>
  );
}

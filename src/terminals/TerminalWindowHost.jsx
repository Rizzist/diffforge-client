import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";

import {
  ButtonBrowserIcon,
  ButtonCloseIcon,
  ButtonDragIcon,
  ButtonForgeIcon,
  ButtonFullscreenIcon,
  ButtonRefreshIcon,
  ButtonSplitHorizontalIcon,
  ButtonSplitVerticalIcon,
  GlobalStyle,
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
import { guardXtermDuringPushToTalk } from "./xtermPushToTalkGuard.js";
import {
  TERMINAL_WINDOW_CONTROL_CLOSE_TERMINAL,
  TERMINAL_WINDOW_CONTROL_EVENT,
  TERMINAL_WINDOW_CONTROL_FONT_SIZE,
  TERMINAL_WINDOW_CONTROL_FORK,
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
const TERMINAL_WINDOW_FONT_SIZE_DEFAULT = 12;
const TERMINAL_WINDOW_FONT_SIZE_MIN = 8;
const TERMINAL_WINDOW_FONT_SIZE_MAX = 24;
const TERMINAL_WINDOW_FONT_SIZE_STEP = 1;
// Emitted by the Rust drag watcher to this window's label while a todo/doc drag
// hovers it, so the popped-out terminal shows the same "Drop here" affordance as
// an in-grid terminal. The main window owns the payload and commits on release.
const TERMINAL_DRAG_TARGET_EVENT = "forge-terminal-drag-target";

const HostShell = styled.div`
  container-type: inline-size;
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

const HostDropOverlay = styled.div`
  position: absolute;
  inset: 10px;
  z-index: 40;
  display: grid;
  place-items: center;
  pointer-events: none;
  border: 2px dotted rgba(138, 216, 255, 0.94);
  border-radius: 14px;
  background: rgba(2, 8, 14, 0.54);
  box-shadow:
    inset 0 0 0 1px rgba(255, 173, 124, 0.24),
    0 0 32px rgba(138, 216, 255, 0.12);
`;

const HostDropOverlayLabel = styled.div`
  padding: 8px 12px;
  border: 1px solid rgba(138, 216, 255, 0.3);
  border-radius: 999px;
  color: #e9f8ff;
  background: linear-gradient(135deg, rgba(6, 16, 26, 0.96), rgba(28, 16, 10, 0.92));
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
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

  .xterm-helper-textarea {
    position: absolute !important;
    left: -10000px !important;
    top: 0 !important;
    width: 0 !important;
    height: 0 !important;
    min-width: 0 !important;
    min-height: 0 !important;
    padding: 0 !important;
    border: 0 !important;
    outline: 0 !important;
    opacity: 0 !important;
    color: transparent !important;
    background: transparent !important;
    resize: none !important;
    overflow: hidden !important;
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
      terminalIndex: 0,
      theme: "",
      title: "Terminal",
      workspaceId: "",
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
    terminalIndex: Number.parseInt(params.get("terminalIndex") || "0", 10) || 0,
    theme: params.get("theme") || "",
    title: params.get("title") || "Terminal",
    workspaceId: params.get("workspaceId") || "",
  };
}

function clampTerminalWindowFontSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) {
    return TERMINAL_WINDOW_FONT_SIZE_DEFAULT;
  }
  return Math.min(
    TERMINAL_WINDOW_FONT_SIZE_MAX,
    Math.max(TERMINAL_WINDOW_FONT_SIZE_MIN, Math.round(size)),
  );
}

function terminalWindowFontSizeStorageKey(workspaceId, terminalIndex, paneId) {
  const safeWorkspaceId = String(workspaceId || "").trim();
  if (safeWorkspaceId) {
    return `diffforge.terminal.fontSize.v1:${safeWorkspaceId}:${Number(terminalIndex) || 0}`;
  }
  return `diffforge.terminal.window.fontSize.v1:${String(paneId || "pane").trim()}`;
}

function readStoredTerminalWindowFontSize(workspaceId, terminalIndex, paneId) {
  try {
    const stored = window.localStorage.getItem(
      terminalWindowFontSizeStorageKey(workspaceId, terminalIndex, paneId),
    );
    if (stored === null || stored === "") {
      return TERMINAL_WINDOW_FONT_SIZE_DEFAULT;
    }
    return clampTerminalWindowFontSize(stored);
  } catch {
    return TERMINAL_WINDOW_FONT_SIZE_DEFAULT;
  }
}

function writeStoredTerminalWindowFontSize(workspaceId, terminalIndex, paneId, size) {
  try {
    const key = terminalWindowFontSizeStorageKey(workspaceId, terminalIndex, paneId);
    if (clampTerminalWindowFontSize(size) === TERMINAL_WINDOW_FONT_SIZE_DEFAULT) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, String(clampTerminalWindowFontSize(size)));
    }
  } catch {
    // Font size persistence is convenience state only.
  }
}

function ButtonFontMinusIcon(props) {
  return (
    <svg fill="none" height="12" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M4 19 10.5 5h1L18 19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      <path d="M6.6 14.4h8.8" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
      <path d="M16 8h6" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
}

function ButtonFontPlusIcon(props) {
  return (
    <svg fill="none" height="12" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M3 19 9.5 5h1L16 19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      <path d="M5.6 14.4h8.8" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
      <path d="M19 5v6M16 8h6" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
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
  const { paneId, terminalIndex, theme, title, workspaceId } = params;
  const containerRef = useRef(null);
  const xtermRef = useRef(null);
  const terminalInstanceIdRef = useRef(0);
  const fitTerminalRef = useRef(() => {});
  const restartMenuRef = useRef(null);
  const [status, setStatus] = useState("connecting");
  const [statusDetail, setStatusDetail] = useState("");
  const [restartMenuOpen, setRestartMenuOpen] = useState(false);
  const [dropTargetActive, setDropTargetActive] = useState(false);
  const [terminalFontSize, setTerminalFontSize] = useState(
    () => readStoredTerminalWindowFontSize(workspaceId, terminalIndex, paneId),
  );
  const terminalFontSizeRef = useRef(terminalFontSize);
  const [meta, setMeta] = useState(() => ({
    agentKind: params.agentKind,
    agentLabel: params.agentLabel,
    agentTitle: params.agentLabel,
    canFork: false,
    canOpenUiView: false,
    canSplit: true,
    colorSlot: params.colorSlot,
    roleOptions: [],
    stateLabel: "",
  }));
  const metaRef = useRef(meta);

  useEffect(() => {
    metaRef.current = meta;
  }, [meta]);

  useEffect(() => {
    terminalFontSizeRef.current = terminalFontSize;
    const term = xtermRef.current;
    if (!term || term.options.fontSize === terminalFontSize) {
      return;
    }
    term.options.fontSize = terminalFontSize;
    const applyFit = () => fitTerminalRef.current?.();
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(applyFit);
      });
    } else {
      applyFit();
    }
  }, [terminalFontSize]);

  const adjustTerminalFontSize = useCallback((delta) => {
    const current = terminalFontSizeRef.current;
    const next = clampTerminalWindowFontSize(
      (Number(current) || TERMINAL_WINDOW_FONT_SIZE_DEFAULT) + delta,
    );
    if (next === current) {
      return;
    }
    terminalFontSizeRef.current = next;
    writeStoredTerminalWindowFontSize(workspaceId, terminalIndex, paneId, next);
    if (paneId) {
      emit(TERMINAL_WINDOW_CONTROL_EVENT, {
        control: TERMINAL_WINDOW_CONTROL_FONT_SIZE,
        fontSize: next,
        paneId,
      }).catch(() => {});
    }
    setTerminalFontSize(next);
  }, [paneId, terminalIndex, workspaceId]);

  const claimTerminalAudioTarget = useCallback(() => {
    const instanceId = Number(terminalInstanceIdRef.current || 0);
    if (!paneId || !instanceId) {
      return;
    }

    invoke("set_terminal_audio_input_target", {
      active: true,
      instanceId,
      paneId,
    }).catch(() => {});
    invoke("set_terminal_audio_route_gate", { allowTerminal: true }).catch(() => {});
  }, [paneId]);

  useEffect(() => {
    window.addEventListener("focus", claimTerminalAudioTarget);
    window.addEventListener("pointerdown", claimTerminalAudioTarget, true);
    return () => {
      window.removeEventListener("focus", claimTerminalAudioTarget);
      window.removeEventListener("pointerdown", claimTerminalAudioTarget, true);
    };
  }, [claimTerminalAudioTarget]);

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

  // Cross-window drop affordance: the Rust watcher targets this window's label
  // directly, so every event here is meant for this window.
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(TERMINAL_DRAG_TARGET_EVENT, (event) => {
      if (disposed) {
        return;
      }
      setDropTargetActive(Boolean(event.payload?.active));
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      setDropTargetActive(false);
      unlisten();
    };
  }, []);

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
    let detachPushToTalkGuard = () => {};
    let detachFocusBlink = () => {};

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
    fitTerminalRef.current = fitTerminal;

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
      terminalInstanceIdRef.current = instanceId;
      claimTerminalAudioTarget();

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
        // Alt+click must never synthesize arrow keys: agent CLIs treat Up as
        // history recall, so a stray Option+click would paste the previous
        // prompt into the composer.
        altClickMovesCursor: false,
        convertEol: false,
        cursorBlink: true,
        cursorStyle: "block",
        customGlyphs: true,
        fastScrollModifier: "alt",
        fastScrollSensitivity: 5,
        fontFamily: "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, monospace",
        fontSize: terminalFontSizeRef.current,
        lineHeight: 1.0,
        macOptionIsMeta: true,
        scrollback: 10000,
        smoothScrollDuration: 0,
        theme: isLightTheme ? TERMINAL_LIGHT_THEME : TERMINAL_DARK_THEME,
      });
      xtermRef.current = term;
      term.open(container);
      detachPushToTalkGuard = guardXtermDuringPushToTalk(term);

      // Pause the cursor-blink repaint while this detached window is unfocused
      // or hidden instead of blinking continuously regardless of focus.
      const syncCursorBlink = () => {
        const focused = typeof document === "undefined"
          ? true
          : !document.hidden
            && (typeof document.hasFocus !== "function" || document.hasFocus());
        if (term && term.options.cursorBlink !== focused) {
          term.options.cursorBlink = focused;
        }
      };
      window.addEventListener("focus", syncCursorBlink);
      window.addEventListener("blur", syncCursorBlink);
      document.addEventListener("visibilitychange", syncCursorBlink);
      detachFocusBlink = () => {
        window.removeEventListener("focus", syncCursorBlink);
        window.removeEventListener("blur", syncCursorBlink);
        document.removeEventListener("visibilitychange", syncCursorBlink);
      };
      syncCursorBlink();

      term.onData((data) => {
        invoke("terminal_write", {
          appForkEnabled: metaRef.current?.canFork === true,
          paneId,
          data,
        }).catch(() => {});
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
      detachPushToTalkGuard();
      detachFocusBlink();
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
      if (xtermRef.current === term) {
        xtermRef.current = null;
      }
      if (fitTerminalRef.current === fitTerminal) {
        fitTerminalRef.current = () => {};
      }
    };
  }, [claimTerminalAudioTarget, paneId]);

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
    <HostShell
      onFocusCapture={claimTerminalAudioTarget}
      onDragOver={(event) => {
        // The OS may deliver a doc drag's dragover here; accept it so the cursor
        // reads as droppable. The actual commit is owned by the main window
        // (via the Rust release signal), so this window never reads the payload.
        if (dropTargetActive) {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "copy";
          }
        }
      }}
      onDrop={(event) => {
        if (dropTargetActive) {
          event.preventDefault();
        }
      }}
      onPointerDownCapture={claimTerminalAudioTarget}
    >
      {/* This window's root returns before the main app mounts GlobalStyle;
          without it box-sizing stays content-box and the header pill
          (width: 100% + padding) overflows, clipping the right-edge close
          button. */}
      <GlobalStyle />
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
            aria-label="Decrease terminal font size"
            disabled={terminalFontSize <= TERMINAL_WINDOW_FONT_SIZE_MIN}
            onClick={() => adjustTerminalFontSize(-TERMINAL_WINDOW_FONT_SIZE_STEP)}
            title={`Decrease terminal font size (${terminalFontSize}px)`}
            type="button"
          >
            <ButtonFontMinusIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Increase terminal font size"
            disabled={terminalFontSize >= TERMINAL_WINDOW_FONT_SIZE_MAX}
            onClick={() => adjustTerminalFontSize(TERMINAL_WINDOW_FONT_SIZE_STEP)}
            title={`Increase terminal font size (${terminalFontSize}px)`}
            type="button"
          >
            <ButtonFontPlusIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Fork terminal session"
            disabled={!meta.canFork}
            onClick={() => sendControl(TERMINAL_WINDOW_CONTROL_FORK)}
            title={meta.canFork ? "Fork this session" : "Waiting for provider session id"}
            type="button"
          >
            <ButtonForgeIcon aria-hidden="true" />
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
            aria-label="Maximize terminal in the app"
            onClick={() => sendControl(TERMINAL_WINDOW_CONTROL_FULLSCREEN)}
            title="Return to the app and maximize terminal"
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
        {dropTargetActive && (
          <HostDropOverlay>
            <HostDropOverlayLabel>Drop here</HostDropOverlayLabel>
          </HostDropOverlay>
        )}
      </HostTerminalSurface>
    </HostShell>
  );
}

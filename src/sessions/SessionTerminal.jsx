import { Channel, invoke } from "@tauri-apps/api/core";
import { useEffect, useRef } from "react";
import styled from "styled-components";
import { Terminal as XTerm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { measureTerminalGrid } from "../terminals/terminalResizeController";
import { guardXtermDuringPushToTalk } from "../terminals/xtermPushToTalkGuard.js";
import {
  TERMINAL_DARK_THEME,
  TERMINAL_LIGHT_THEME,
} from "../terminals/WorkspaceTerminal/terminalCore.js";
import { sessionWorkingDirectory } from "./sessionsModel.js";

/* Lean single-PTY host for a Haider session pane. Deliberately NOT the
   19k-line WorkspaceTerminal: one terminal, one PTY, no thread overlay, no
   role machinery. The PTY stays alive across session switches — the host
   component stays mounted (hidden) for every opened session, so switching
   back is instant and scrollback survives. */

const SESSION_TERMINAL_RESIZE_DEBOUNCE_MS = 120;
const SESSION_TERMINAL_GRID_GUARD_PX = 2;

function getSessionTerminalTheme() {
  return document.documentElement.dataset.forgeTheme === "light"
    ? TERMINAL_LIGHT_THEME
    : TERMINAL_DARK_THEME;
}

/* xterm's private cell dimensions can land on device-pixel fractions that
   differ slightly from the final canvas allocation. Reserve a tiny amount of
   the real mount box before flooring so the renderer can never gain a row or
   column that does not quite fit. */
function measureSessionTerminalGrid({ container, term }) {
  const measurement = measureTerminalGrid({
    container,
    term,
    minCols: 1,
    minRows: 1,
  });
  if (!measurement.ok) {
    return measurement;
  }

  const safeCols = Math.floor(
    Math.max(0, measurement.containerWidth - SESSION_TERMINAL_GRID_GUARD_PX)
      / measurement.actualCellWidth,
  );
  const safeRows = Math.floor(
    Math.max(0, measurement.containerHeight - SESSION_TERMINAL_GRID_GUARD_PX)
      / measurement.actualCellHeight,
  );

  if (safeCols < 1 || safeRows < 1) {
    return {
      ...measurement,
      ok: false,
      reason: "terminal_mount_too_small",
    };
  }

  return {
    ...measurement,
    cols: Math.min(measurement.cols, safeCols),
    rows: Math.min(measurement.rows, safeRows),
    safeCols,
    safeRows,
  };
}

export function sessionPaneToken(sessionId) {
  return String(sessionId || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "session";
}

export function sessionPaneId(sessionId) {
  // Keeps the pane-id shape the backend already parses:
  // workspace-terminal-{token}-{index}-{role}.
  return `workspace-terminal-${sessionPaneToken(sessionId)}-0-haider`;
}

export default function SessionTerminal({ session, active }) {
  const containerRef = useRef(null);
  const mountRef = useRef(null);
  const xtermRef = useRef(null);
  const instanceIdRef = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  /* One PTY per mount; the engine never re-runs for prop changes. */
  useEffect(() => {
    const container = mountRef.current;
    const observedHost = containerRef.current;
    if (!container || !observedHost || !session?.id) {
      return undefined;
    }

    const paneId = sessionPaneId(session.id);
    let disposed = false;
    let term = null;
    let resizeTimer = 0;
    let lateFitTimer = 0;
    let firstOutputFitFrame = 0;
    let firstOutputFitRequested = false;
    let resizeObserver = null;
    let themeObserver = null;
    let detachPushToTalk = () => {};

    // Recency is DAEMON-owned: reconcile syncs latest_at_ms from the
    // harness's updated_at. Local touches on open/keystrokes made merely
    // OPENING a session jump to the top of Recent — bad UX, and redundant
    // because real activity bumps the daemon clock anyway.

    const applyTerminalTheme = () => {
      if (disposed || !term) {
        return;
      }
      term.options.theme = getSessionTerminalTheme();
      term.refresh(0, Math.max(0, term.rows - 1));
    };

    /* The frame must match the HARNESS's background, not the ADE theme:
       haider emits OSC 11 (set terminal background) when its own theme
       changes, so track it and paint the host frame with that exact color.
       "rgb:RRRR/GGGG/BBBB" (X11, 8-16 bit per channel) and "#rrggbb" forms. */
    const parseOscColor = (data) => {
      const text = String(data || "").trim();
      if (text.startsWith("#")) {
        return text;
      }
      const match = text.match(/^rgb:([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})\/([0-9a-fA-F]{1,4})$/);
      if (!match) {
        return null;
      }
      const channel = (value) => value.padEnd(4, value).slice(0, 2);
      return `#${channel(match[1])}${channel(match[2])}${channel(match[3])}`;
    };
    /* Query forms ("?") must be swallowed: xterm's built-in responder would
       write "\x1b]11;rgb:..\x1b\\" into the PTY, and the haider TUI renders
       that reply as literal keystrokes in its input line. */
    const isOscColorQuery = (data) => String(data || "").trim().startsWith("?");
    const swallowOscColorQuery = (data) => isOscColorQuery(data);
    const applyHarnessBackground = (data) => {
      if (disposed) {
        return isOscColorQuery(data);
      }
      if (isOscColorQuery(data)) {
        return true;
      }
      const color = parseOscColor(data);
      if (color && observedHost) {
        observedHost.style.background = color;
      }
      return false; // let xterm keep its own OSC set handling
    };

    const fitTerminal = () => {
      if (disposed || !term) {
        return;
      }
      const measurement = measureSessionTerminalGrid({ container, term });
      if (!measurement.ok) {
        return;
      }
      if (term.cols !== measurement.cols || term.rows !== measurement.rows) {
        term.resize(measurement.cols, measurement.rows);
      }
      invoke("terminal_resize", {
        pane_id: paneId,
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
      }, SESSION_TERMINAL_RESIZE_DEBOUNCE_MS);
    };

    const run = async () => {
      term = new XTerm({
        // Proposed API is required by the Unicode 11 addon (emoji widths).
        allowProposedApi: true,
        altClickMovesCursor: false,
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
        theme: getSessionTerminalTheme(),
      });
      xtermRef.current = term;
      // Unicode 11 widths: without this, emoji measure 1 cell but paint 2 —
      // the harness TUI assumes standard wide emoji, so glyphs render halved.
      try {
        const { Unicode11Addon } = await import("@xterm/addon-unicode11");
        term.loadAddon(new Unicode11Addon());
        term.unicode.activeVersion = "11";
      } catch {
        // Addon missing — widths fall back to xterm defaults.
      }
      term.open(container);
      detachPushToTalk = guardXtermDuringPushToTalk(term);
      term.parser.registerOscHandler(10, swallowOscColorQuery);
      term.parser.registerOscHandler(11, applyHarnessBackground);
      term.parser.registerOscHandler(12, swallowOscColorQuery);

      term.onData((data) => {
        invoke("terminal_write", { pane_id: paneId, data }).catch(() => {});
      });

      const outputChannel = new Channel((message) => {
        if (disposed || !term) {
          return;
        }
        const bytes = message instanceof ArrayBuffer
          ? new Uint8Array(message)
          : ArrayBuffer.isView(message)
            ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
            : null;
        if (bytes?.byteLength) {
          term.write(bytes);
          if (!firstOutputFitRequested) {
            firstOutputFitRequested = true;
            firstOutputFitFrame = window.requestAnimationFrame(() => {
              firstOutputFitFrame = 0;
              fitTerminal();
            });
          }
        }
      });

      const initial = measureSessionTerminalGrid({ container, term });
      const workingDirectory = sessionWorkingDirectory(session);
      const instanceId = Date.now() % 2_000_000_000;
      instanceIdRef.current = instanceId;

      const result = await invoke("terminal_open", {
        request: {
          pane_id: paneId,
          instance_id: instanceId,
          kind: "haider",
          agent_id: "haider",
          agent_kind: "haider",
          provider: "haider",
          /* Never fresh: with no provider session the haider launch args are
             identical, and fresh_session=true would veto adopting the live
             PTY — session shells must survive Chat/Shell toggles. */
          fresh_session: false,
          adopt_existing: true,
          provider_session_id: session.provider_session_id || "",
          plain_shell: false,
          session_mode: "",
          slot_key: `session-${sessionPaneToken(session.id)}`,
          terminal_index: 0,
          thread_id: "",
          working_directory: workingDirectory,
          workspace_id: session.id,
          workspace_name: session.title,
          terminal_name: "Haider",
          terminal_nickname: session.title,
          app_control_mcp: false,
          cols: initial.ok ? initial.cols : 100,
          rows: initial.ok ? initial.rows : 30,
        },
        output_channel: outputChannel,
      });
      if (disposed) {
        return;
      }
      if (result && Number(result.instance_id)) {
        instanceIdRef.current = Number(result.instance_id);
      }
      fitTerminal();
      // Font metrics settle after the face loads and after xterm's first
      // paint — refit on both so a full-screen TUI never keeps stale rows.
      lateFitTimer = window.setTimeout(() => {
        lateFitTimer = 0;
        fitTerminal();
      }, 250);
      if (typeof document !== "undefined" && document.fonts?.ready) {
        void document.fonts.ready.then(() => {
          if (!disposed) {
            window.requestAnimationFrame(fitTerminal);
          }
        });
      }
      if (activeRef.current) {
        term.focus();
      }
    };

    run().catch((error) => {
      if (!disposed && term) {
        term.write(`\r\n\x1b[31mUnable to start session: ${String(error?.message || error)}\x1b[0m\r\n`);
      }
    });

    window.addEventListener("resize", scheduleFit);
    if (typeof ResizeObserver === "function") {
      resizeObserver = new ResizeObserver(scheduleFit);
      resizeObserver.observe(observedHost);
    }
    if (typeof MutationObserver === "function") {
      themeObserver = new MutationObserver(applyTerminalTheme);
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-forge-theme"],
      });
    }

    return () => {
      disposed = true;
      window.removeEventListener("resize", scheduleFit);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (themeObserver) {
        themeObserver.disconnect();
      }
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
      if (lateFitTimer) {
        window.clearTimeout(lateFitTimer);
      }
      if (firstOutputFitFrame) {
        window.cancelAnimationFrame(firstOutputFitFrame);
      }
      detachPushToTalk();
      // The PTY outlives the component: session shells persist across
      // Chat/Shell toggles and session switches, and the next mount adopts
      // the live instance (adopt_existing). terminal_close happens only when
      // the session itself is deleted or the app shuts down.
      if (term) {
        term.dispose();
      }
      xtermRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  /* Refit + focus when this session becomes the visible one. */
  useEffect(() => {
    if (!active) {
      return;
    }
    const term = xtermRef.current;
    const container = mountRef.current;
    if (!term || !container) {
      return;
    }
    const measurement = measureSessionTerminalGrid({ container, term });
    if (measurement.ok) {
      if (term.cols !== measurement.cols || term.rows !== measurement.rows) {
        term.resize(measurement.cols, measurement.rows);
      }
      invoke("terminal_resize", {
        pane_id: sessionPaneId(session.id),
        cols: measurement.cols,
        rows: measurement.rows,
      }).catch(() => {});
    }
    term.focus();
  }, [active, session?.id]);

  return (
    <TerminalHost ref={containerRef}>
      <TerminalMount ref={mountRef} />
    </TerminalHost>
  );
}

const TerminalHost = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  box-sizing: border-box;
  padding: 3px;
  overflow: hidden;
  background: ${TERMINAL_DARK_THEME.background};

  html[data-forge-theme="light"] & {
    background: ${TERMINAL_LIGHT_THEME.background};
  }
`;

/* The frame belongs to TerminalHost. This padding-free box is both xterm's
   mount and the resize measurement target, so its client size is the exact
   renderer area rather than the renderer area plus CSS padding. */
const TerminalMount = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  .xterm {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .xterm .xterm-viewport {
    background: transparent !important;
  }
`;

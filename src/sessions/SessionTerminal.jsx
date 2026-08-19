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
} from "../terminals/WorkspaceTerminal/index.jsx";
import { sessionWorkingDirectory, updateSession } from "./sessionsModel.js";

/* Lean single-PTY host for a Haider session pane. Deliberately NOT the
   19k-line WorkspaceTerminal: one terminal, one PTY, no thread overlay, no
   role machinery. The PTY stays alive across session switches — the host
   component stays mounted (hidden) for every opened session, so switching
   back is instant and scrollback survives. */

const SESSION_TERMINAL_RESIZE_DEBOUNCE_MS = 120;
const SESSION_TOUCH_DEBOUNCE_MS = 15_000;

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
  const xtermRef = useRef(null);
  const instanceIdRef = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  /* One PTY per mount; the engine never re-runs for prop changes. */
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !session?.id) {
      return undefined;
    }

    const paneId = sessionPaneId(session.id);
    let disposed = false;
    let term = null;
    let resizeTimer = 0;
    let resizeObserver = null;
    let detachPushToTalk = () => {};
    let lastTouchAt = 0;

    const touchSession = () => {
      const now = Date.now();
      if (now - lastTouchAt < SESSION_TOUCH_DEBOUNCE_MS) {
        return;
      }
      lastTouchAt = now;
      void updateSession(session.id, { touch: true, status: "running" }).catch(() => {});
    };

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
      const isLightTheme = document.documentElement.dataset.forgeTheme === "light";
      term = new XTerm({
        allowProposedApi: false,
        altClickMovesCursor: false,
        convertEol: false,
        cursorBlink: true,
        cursorStyle: "block",
        customGlyphs: true,
        fastScrollModifier: "alt",
        fastScrollSensitivity: 5,
        fontFamily: "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.0,
        macOptionIsMeta: true,
        scrollback: 10000,
        smoothScrollDuration: 0,
        theme: isLightTheme ? TERMINAL_LIGHT_THEME : TERMINAL_DARK_THEME,
      });
      xtermRef.current = term;
      term.open(container);
      detachPushToTalk = guardXtermDuringPushToTalk(term);

      term.onData((data) => {
        touchSession();
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
        }
      });

      const initial = measureTerminalGrid({ container, term });
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
          fresh_session: !session.provider_session_id,
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
      touchSession();
      fitTerminal();
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
      resizeObserver.observe(container);
    }

    return () => {
      disposed = true;
      window.removeEventListener("resize", scheduleFit);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (resizeTimer) {
        window.clearTimeout(resizeTimer);
      }
      detachPushToTalk();
      // The PTY intentionally outlives the component only when the whole
      // app closes; unmounting a session host means the session was closed
      // in the UI, so shut the PTY down with it.
      invoke("terminal_close", {
        pane_id: paneId,
        instance_id: instanceIdRef.current || undefined,
      }).catch(() => {});
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
    const container = containerRef.current;
    if (!term || !container) {
      return;
    }
    const measurement = measureTerminalGrid({ container, term });
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

  return <TerminalHost ref={containerRef} />;
}

const TerminalHost = styled.div`
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 6px 2px 6px 8px;
  background: ${TERMINAL_DARK_THEME.background};

  html[data-forge-theme="light"] & {
    background: ${TERMINAL_LIGHT_THEME.background};
  }

  .xterm {
    height: 100%;
  }
`;

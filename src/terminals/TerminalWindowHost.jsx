import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { Terminal as XTerm } from "@xterm/xterm";
import { Close } from "@styled-icons/material-rounded/Close";

import { measureTerminalGrid } from "./terminalResizeController";

export const TERMINAL_WINDOW_HASH = "#/terminal-window";
export const TERMINAL_WINDOW_CLOSED_EVENT = "forge-terminal-window-closed";

const TERMINAL_WINDOW_BACKGROUND = "#020304";
const TERMINAL_WINDOW_RESIZE_DEBOUNCE_MS = 90;

const HostShell = styled.div`
  display: grid;
  grid-template-rows: 34px minmax(0, 1fr);
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  border: 1px solid rgba(230, 236, 245, 0.14);
  border-radius: 10px;
  background: ${TERMINAL_WINDOW_BACKGROUND};
  clip-path: inset(0 round 10px);
`;

const HostTitleBar = styled.header`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid rgba(230, 236, 245, 0.09);
  background: linear-gradient(180deg, rgba(37, 42, 49, 0.92), rgba(14, 17, 21, 0.94));
  user-select: none;
  -webkit-app-region: drag;
`;

const HostStatusDot = styled.span`
  width: 7px;
  height: 7px;
  flex: none;
  border-radius: 999px;
  background: ${(props) => (props.$state === "ready"
    ? "#4bd4aa"
    : props.$state === "error" || props.$state === "closed"
      ? "#ff6b6b"
      : "#ff9f43")};
`;

const HostTitle = styled.span`
  min-width: 0;
  overflow: hidden;
  color: rgba(230, 236, 245, 0.88);
  font-size: 12px;
  font-weight: 740;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const HostTitleMeta = styled.span`
  margin-left: auto;
  overflow: hidden;
  color: rgba(230, 236, 245, 0.4);
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  white-space: nowrap;
`;

const HostCloseButton = styled.button`
  display: inline-flex;
  width: 24px;
  height: 24px;
  flex: none;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 7px;
  color: rgba(230, 236, 245, 0.62);
  background: transparent;
  cursor: pointer;
  -webkit-app-region: no-drag;

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover {
    color: #fff;
    background: rgba(214, 69, 69, 0.85);
  }
`;

const HostTerminalSurface = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  padding: 6px 4px 6px 10px;
  background: ${TERMINAL_WINDOW_BACKGROUND};

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
`;

function parseTerminalWindowParams() {
  if (typeof window === "undefined") {
    return { paneId: "", title: "Terminal" };
  }

  const hash = window.location.hash || "";
  const queryIndex = hash.indexOf("?");
  const params = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : "");

  return {
    paneId: params.get("paneId") || "",
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

const TERMINAL_WINDOW_THEME = {
  background: TERMINAL_WINDOW_BACKGROUND,
  black: "#1c2026",
  blue: "#7db0ff",
  brightBlack: "#565f6c",
  brightBlue: "#9cc4ff",
  brightCyan: "#9be8df",
  brightGreen: "#7fe0c0",
  brightMagenta: "#d9b2ff",
  brightRed: "#ff9191",
  brightWhite: "#f4f7fa",
  brightYellow: "#ffd08a",
  cursor: "#e6ecf5",
  cyan: "#7fd6cb",
  foreground: "#dbe3ee",
  green: "#4bd4aa",
  magenta: "#c08bff",
  red: "#ff6b6b",
  selectionBackground: "rgba(125, 176, 255, 0.32)",
  white: "#dbe3ee",
  yellow: "#ffb454",
};

/**
 * Window Breakout host: renders one running terminal pane in its own native
 * window. The pane's PTY keeps living in the main process; this window is an
 * extra subscriber on the terminal output transport (scrollback replayed from
 * the headless buffer), so opening/closing it never disturbs the agent.
 */
export default function TerminalWindowHost() {
  const { paneId, title } = useMemo(parseTerminalWindowParams, []);
  const containerRef = useRef(null);
  const [status, setStatus] = useState("connecting");
  const [statusDetail, setStatusDetail] = useState("");

  useEffect(() => {
    document.documentElement.dataset.terminalWindow = "true";
    document.body.dataset.terminalWindow = "true";
    document.body.style.background = "transparent";

    return () => {
      delete document.documentElement.dataset.terminalWindow;
      delete document.body.dataset.terminalWindow;
    };
  }, []);

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

    const run = async () => {
      const info = await invoke("terminal_pane_runtime_info", { paneId });
      const instanceId = Number(info?.instanceId || 0);
      if (disposed) {
        return;
      }

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
        theme: TERMINAL_WINDOW_THEME,
      });
      term.open(container);

      term.onData((data) => {
        invoke("terminal_write", { paneId, data }).catch(() => {});
      });

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
          return;
        }
        term?.write(new Uint8Array(event.data));
      };
      socket.onclose = () => {
        if (!disposed) {
          setStatus("closed");
          setStatusDetail("The terminal session ended or restarted. Close this window and reopen it from the grid.");
        }
      };
      socket.onerror = () => {
        if (!disposed) {
          setStatus("error");
          setStatusDetail("Lost the terminal output connection.");
        }
      };

      window.addEventListener("resize", scheduleFit);
      detachResize = () => window.removeEventListener("resize", scheduleFit);

      window.requestAnimationFrame(() => {
        fitTerminal();
        term?.focus();
      });
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

  const closeWindow = () => {
    try {
      Promise.resolve(getCurrentWindow().close()).catch(() => {});
    } catch {
      // Window close is best-effort; the main grid converges via events.
    }
  };

  return (
    <HostShell>
      <HostTitleBar data-tauri-drag-region>
        <HostStatusDot $state={status} aria-hidden="true" />
        <HostTitle data-tauri-drag-region title={title}>{title}</HostTitle>
        <HostTitleMeta data-tauri-drag-region>Window breakout</HostTitleMeta>
        <HostCloseButton
          aria-label="Return terminal to the grid"
          onClick={closeWindow}
          title="Return to grid"
          type="button"
        >
          <Close aria-hidden="true" />
        </HostCloseButton>
      </HostTitleBar>
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

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// tscircuit tab ids → the labels the user thinks in: schematic = Circuits,
// pcb = Wiring, cad = 3D. RunFrame renders the tab UI + pan/zoom/rotate controls.
export const PCB_TABS = ["schematic", "pcb", "cad"];
export const PCB_STORE_CHANGED_EVENT = "pcb-store-changed";

// RunFrame's dependency tree (eval worker, sucrase, spice/3d/pcb solvers …) does
// not bundle through the app's Vite build, and loading it as a CDN module into
// the host React tree triggers a dual-React hooks crash. So we render it inside
// an isolated iframe that pulls RunFrame + its whole tree from esm.sh and uses
// its own React instance. The board source is streamed in over postMessage, so
// edits live-reload without reloading the frame.
const RUNFRAME_VERSION = "0.0.2130";
const REACT_VERSION = "19.2.4";

function buildSrcDoc(defaultTab) {
  const safeTab = PCB_TABS.includes(defaultTab) ? defaultTab : "pcb";
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body, #root { height: 100%; margin: 0; background: #07101d; }
      #status { color: #94a3b8; font: 12px system-ui, sans-serif; padding: 16px; }
    </style>
  </head>
  <body>
    <div id="root"><div id="status">Loading renderer…</div></div>
    <script type="module">
      const VER = ${JSON.stringify(REACT_VERSION)};
      const RF = ${JSON.stringify(RUNFRAME_VERSION)};
      const TAB = ${JSON.stringify(safeTab)};
      try {
        const React = (await import("https://esm.sh/react@" + VER)).default;
        const { createRoot } = await import("https://esm.sh/react-dom@" + VER + "/client?deps=react@" + VER);
        const { RunFrame } = await import(
          "https://esm.sh/@tscircuit/runframe@" + RF + "/runner?deps=react@" + VER + ",react-dom@" + VER
        );
        const root = createRoot(document.getElementById("root"));
        let lastCode = "";
        function renderCode(code) {
          lastCode = code;
          root.render(
            React.createElement(RunFrame, {
              fsMap: { "main.tsx": code },
              entrypoint: "main.tsx",
              availableTabs: ["schematic", "pcb", "cad"],
              defaultTab: TAB,
            }),
          );
        }
        window.addEventListener("message", (event) => {
          const data = event.data;
          if (data && data.type === "pcb:code" && typeof data.code === "string") {
            renderCode(data.code);
          }
        });
        window.parent.postMessage({ type: "pcb:ready" }, "*");
      } catch (err) {
        const status = document.getElementById("status");
        if (status) status.textContent = "Renderer failed to load: " + err;
        window.parent.postMessage({ type: "pcb:error", message: String(err) }, "*");
      }
    </script>
  </body>
</html>`;
}

const PanelShell = styled.section`
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  height: 100%;
  width: 100%;
  background: #07101d;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 10px;
  overflow: hidden;

  &[data-active="true"] {
    border-color: rgba(16, 185, 129, 0.4);
  }
`;

const PanelHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(15, 23, 42, 0.6);
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  flex: 0 0 auto;
`;

const PanelTitle = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: #a7f3d0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PanelActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
`;

const HeaderButton = styled.button`
  appearance: none;
  border: none;
  background: transparent;
  color: #cbd5f5;
  font-size: 14px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    background: rgba(148, 163, 184, 0.16);
    color: #ffffff;
  }
`;

const PanelBody = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  display: flex;
`;

const BoardFrame = styled.iframe`
  flex: 1 1 auto;
  min-height: 0;
  min-width: 0;
  width: 100%;
  height: 100%;
  border: none;
  background: #07101d;
`;

const PanelMessage = styled.div`
  margin: auto;
  padding: 16px;
  font-size: 12px;
  color: #94a3b8;
  text-align: center;
  max-width: 80%;

  &[data-tone="error"] {
    color: #fca5a5;
  }
`;

export default function PcbPanel({
  board,
  repoPath,
  defaultTab = "pcb",
  isActive = false,
  onActivate,
  onClose,
  onPopOut,
}) {
  const boardPath = board?.path || "";
  const [source, setSource] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const iframeRef = useRef(null);
  const frameReadyRef = useRef(false);
  const srcDoc = useMemo(() => buildSrcDoc(defaultTab), [defaultTab]);

  const readSource = useCallback(() => {
    if (!repoPath || !boardPath) {
      return;
    }
    invoke("pcb_document_read", { repoPath, boardPath })
      .then((doc) => {
        setSource(typeof doc?.source === "string" ? doc.source : "");
        setStatus("ready");
        setError("");
      })
      .catch((err) => {
        setError(String(err));
        setStatus("error");
      });
  }, [repoPath, boardPath]);

  useEffect(() => {
    setStatus("loading");
    setSource(null);
    readSource();
  }, [readSource]);

  // Live reload: re-read when the watcher reports this board changed on disk.
  useEffect(() => {
    if (!boardPath) {
      return undefined;
    }
    let unlisten;
    let cancelled = false;
    listen(PCB_STORE_CHANGED_EVENT, (event) => {
      const paths = event?.payload?.paths;
      if (Array.isArray(paths) && paths.includes(boardPath)) {
        readSource();
      }
    })
      .then((fn) => {
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [boardPath, readSource]);

  const postSource = useCallback((code) => {
    const frame = iframeRef.current;
    if (frame && frame.contentWindow && typeof code === "string") {
      frame.contentWindow.postMessage({ type: "pcb:code", code }, "*");
    }
  }, []);

  // Bridge: forward the board source once the frame signals it's ready, and on
  // every subsequent source change.
  useEffect(() => {
    function handleMessage(event) {
      if (event.source !== iframeRef.current?.contentWindow) {
        return;
      }
      const data = event.data;
      if (data?.type === "pcb:ready") {
        frameReadyRef.current = true;
        if (source != null) {
          postSource(source);
        }
      } else if (data?.type === "pcb:error") {
        setError(String(data.message || "Renderer error"));
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [source, postSource]);

  useEffect(() => {
    if (frameReadyRef.current && source != null) {
      postSource(source);
    }
  }, [source, postSource]);

  // A reloaded frame (srcDoc change) must re-handshake before we post again.
  const handleFrameLoad = useCallback(() => {
    frameReadyRef.current = false;
  }, []);

  return (
    <PanelShell data-active={isActive ? "true" : "false"} onMouseDown={onActivate}>
      <PanelHeader>
        <PanelTitle title={boardPath}>{board?.name || "PCB"}</PanelTitle>
        <PanelActions>
          {onPopOut ? (
            <HeaderButton
              aria-label="Open in new window"
              onClick={() => onPopOut(board)}
              title="Open in new window"
              type="button"
            >
              ⤢
            </HeaderButton>
          ) : null}
          {onClose ? (
            <HeaderButton
              aria-label="Close board"
              onClick={() => onClose(board)}
              title="Close"
              type="button"
            >
              ×
            </HeaderButton>
          ) : null}
        </PanelActions>
      </PanelHeader>
      <PanelBody>
        {status === "error" ? (
          <PanelMessage data-tone="error">Could not load board: {error}</PanelMessage>
        ) : (
          <BoardFrame
            onLoad={handleFrameLoad}
            ref={iframeRef}
            sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"
            srcDoc={srcDoc}
            title={`PCB board ${board?.name || ""}`}
          />
        )}
      </PanelBody>
    </PanelShell>
  );
}

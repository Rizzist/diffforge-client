import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import runframeBootstrapUrl from "./pcbRunframeBootstrap.js?url";
import runframeStandaloneUrl from "@tscircuit/runframe/standalone?url";

export const PCB_VIEW_TABS = [
  { id: "pcb", label: "PCB" },
  { id: "schematic", label: "Schematic" },
  { id: "cad", label: "3D" },
  { id: "assembly", label: "Assembly" },
  { id: "pinout", label: "Pinout" },
  { id: "analog_simulation", label: "Simulation" },
  { id: "bom", label: "BOM" },
  { id: "circuit_json", label: "JSON" },
  { id: "errors", label: "Errors" },
  { id: "render_log", label: "Render Log" },
  { id: "solvers", label: "Solvers" },
];
export const PCB_TABS = PCB_VIEW_TABS.map((tab) => tab.id);
export const PCB_STORE_CHANGED_EVENT = "pcb-store-changed";
const PCB_SET_ACTIVE_TAB_MESSAGE = "diffforge:pcb:set-active-tab";

function normalizeRepoIdentity(repoPath) {
  return String(repoPath || "").trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}

function normalizePcbTab(tab) {
  return PCB_TABS.includes(tab) ? tab : "pcb";
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");
}

function escapeScriptData(value) {
  return String(value || "").replace(/<\/script/giu, "<\\/script");
}

function buildSrcDoc(defaultTab, source) {
  const safeTab = normalizePcbTab(defaultTab);
  const bootstrapUrl = escapeHtmlAttribute(runframeBootstrapUrl);
  const runframeUrl = escapeHtmlAttribute(runframeStandaloneUrl);
  const tabAttr = escapeHtmlAttribute(safeTab);
  const sourceText = escapeScriptData(source);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body, #root { height: 100%; margin: 0; background: #07101d; }
      #status { color: #94a3b8; font: 12px system-ui, sans-serif; padding: 16px; }
      #root [role="tablist"].rf-h-9 { display: none !important; }
      body[data-diffforge-pcb-frame="true"] #root > div > div > .rf-flex.rf-flex-col.rf-h-full > .rf-flex.rf-items-center.rf-gap-2.rf-p-2.rf-pb-0 {
        display: none !important;
      }
    </style>
  </head>
  <body data-diffforge-pcb-frame="true">
    <div id="root"><div id="status">Loading renderer…</div></div>
    <script type="tscircuit-tsx" data-file-path="main.tsx">${sourceText}</script>
    <script src="${bootstrapUrl}" data-default-tab="${tabAttr}"></script>
    <script src="${runframeUrl}"></script>
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

  &[data-embedded="true"] {
    border: 0;
    border-radius: 0;
  }

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

const ViewTabRail = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  overflow-x: auto;
  overflow-y: hidden;
  flex: 0 0 auto;
  min-width: 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  background: rgba(3, 7, 18, 0.88);
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.35) transparent;

  &::-webkit-scrollbar {
    height: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    background: rgba(148, 163, 184, 0.35);
    border-radius: 999px;
  }
`;

const ViewTabButton = styled.button`
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(15, 23, 42, 0.56);
  color: #aeb7c8;
  border-radius: 6px;
  height: 24px;
  padding: 0 8px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  flex: 0 0 auto;
  cursor: pointer;

  &:hover {
    border-color: rgba(147, 197, 253, 0.45);
    color: #eef4ff;
    background: rgba(30, 41, 59, 0.86);
  }

  &[data-active="true"] {
    border-color: rgba(96, 165, 250, 0.62);
    background: rgba(37, 99, 235, 0.22);
    color: #dbeafe;
    box-shadow: inset 0 0 0 1px rgba(147, 197, 253, 0.18);
  }
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
  embedded = false,
  repoPath,
  defaultTab = "pcb",
  isActive = false,
  onActivate,
  onClose,
  onPopOut,
  showHeader = true,
}) {
  const boardPath = board?.path || "";
  const defaultTabId = normalizePcbTab(defaultTab);
  const [activeTab, setActiveTab] = useState(defaultTabId);
  const [source, setSource] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const frameRef = useRef(null);
  const readSeqRef = useRef(0);
  const srcDoc = useMemo(
    () => (typeof source === "string" ? buildSrcDoc(defaultTabId, source) : ""),
    [defaultTabId, source],
  );

  const sendActiveTabToFrame = useCallback((tab = activeTab) => {
    const targetWindow = frameRef.current?.contentWindow;
    if (!targetWindow) {
      return;
    }
    targetWindow.postMessage({
      source: "diffforge-pcb-panel",
      tab: normalizePcbTab(tab),
      type: PCB_SET_ACTIVE_TAB_MESSAGE,
    }, "*");
  }, [activeTab]);

  useEffect(() => {
    setActiveTab(defaultTabId);
  }, [boardPath, defaultTabId]);

  useEffect(() => {
    if (typeof source !== "string") {
      return;
    }
    sendActiveTabToFrame(activeTab);
  }, [activeTab, sendActiveTabToFrame, source]);

  const readSource = useCallback(() => {
    const readSeq = readSeqRef.current + 1;
    readSeqRef.current = readSeq;
    if (!repoPath || !boardPath) {
      return;
    }
    invoke("pcb_document_read", { repoPath, boardPath })
      .then((doc) => {
        if (readSeqRef.current !== readSeq) {
          return;
        }
        setSource(typeof doc?.source === "string" ? doc.source : "");
        setStatus("ready");
        setError("");
      })
      .catch((err) => {
        if (readSeqRef.current !== readSeq) {
          return;
        }
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
      const eventRepo = normalizeRepoIdentity(event?.payload?.repoPath);
      if (eventRepo && eventRepo !== normalizeRepoIdentity(repoPath)) {
        return;
      }
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

  return (
    <PanelShell
      data-active={isActive ? "true" : "false"}
      data-embedded={embedded ? "true" : undefined}
      onMouseDown={onActivate}
    >
      {showHeader ? (
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
      ) : null}
      <ViewTabRail aria-label="PCB view selector">
        {PCB_VIEW_TABS.map((tab) => (
          <ViewTabButton
            aria-pressed={activeTab === tab.id}
            data-active={activeTab === tab.id ? "true" : undefined}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            type="button"
          >
            {tab.label}
          </ViewTabButton>
        ))}
      </ViewTabRail>
      <PanelBody>
        {status === "error" ? (
          <PanelMessage data-tone="error">Could not load board: {error}</PanelMessage>
        ) : source == null ? (
          <PanelMessage>Loading board…</PanelMessage>
        ) : (
          <BoardFrame
            onLoad={() => sendActiveTabToFrame(activeTab)}
            ref={frameRef}
            sandbox="allow-scripts allow-same-origin allow-downloads allow-popups"
            srcDoc={srcDoc}
            title={`PCB board ${board?.name || ""}`}
          />
        )}
      </PanelBody>
    </PanelShell>
  );
}

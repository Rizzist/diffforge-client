import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import runframeBootstrapUrl from "./pcbRunframeBootstrap.js?url";
import runframeStandaloneUrl from "@tscircuit/runframe/standalone?url";
import evalWebWorkerBlobUrl from "@tscircuit/eval/blob-url";

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
const RUNFRAME_WORKER_PLACEHOLDER = "<--INJECT_TSCIRCUIT_EVAL_WEB_WORKER_BLOB_URL-->";

let patchedRunframeStandaloneUrlPromise = null;

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeScriptData(value) {
  return String(value || "")
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--");
}

function normalizeRepoIdentity(repoPath) {
  return String(repoPath || "").trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}

function normalizePcbTab(tab) {
  return PCB_TABS.includes(tab) ? tab : "pcb";
}

function getPatchedRunframeStandaloneUrl() {
  if (!patchedRunframeStandaloneUrlPromise) {
    patchedRunframeStandaloneUrlPromise = fetch(runframeStandaloneUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Unable to load PCB renderer bundle (${response.status})`);
        }
        return response.text();
      })
      .then((source) => {
        const workerUrl = String(evalWebWorkerBlobUrl || "");
        const patchedSource = source.replace(RUNFRAME_WORKER_PLACEHOLDER, workerUrl);
        if (patchedSource === source && source.includes(RUNFRAME_WORKER_PLACEHOLDER)) {
          throw new Error("Unable to inject PCB renderer worker URL.");
        }
        return URL.createObjectURL(new Blob([patchedSource], { type: "text/javascript" }));
      });
  }
  return patchedRunframeStandaloneUrlPromise;
}

function buildSrcDoc({ source, tab, runframeScriptUrl }) {
  const safeTab = normalizePcbTab(tab);
  const scriptUrl = escapeHtmlAttribute(runframeScriptUrl);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body, #root {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #ffffff;
      }
      body {
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      #status {
        position: fixed;
        inset: 0;
        display: grid;
        place-items: center;
        padding: 24px;
        color: #6b7280;
        font: 700 16px/1.4 Inter, ui-sans-serif, system-ui, sans-serif;
        text-align: center;
        background: #ffffff;
      }
      #root:not(:empty) + #status {
        display: none;
      }
      [role="tablist"].rf-h-9,
      .rf-flex.rf-items-center.rf-gap-2.rf-p-2.rf-pb-0 {
        display: none !important;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <div id="status">Loading PCB renderer...</div>
    <script type="tscircuit-tsx" data-path="main.tsx">${escapeScriptData(source)}</script>
    <script src="${escapeHtmlAttribute(runframeBootstrapUrl)}" data-default-tab="${escapeHtmlAttribute(safeTab)}"></script>
    <script src="${scriptUrl}"></script>
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
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border: 0;
  background: #ffffff;
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
  workspaceId = "",
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
  const [runframeScriptUrl, setRunframeScriptUrl] = useState("");
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const frameRef = useRef(null);
  const readSeqRef = useRef(0);
  const normalizedRepoPath = useMemo(() => normalizeRepoIdentity(repoPath), [repoPath]);

  useEffect(() => {
    setActiveTab(defaultTabId);
  }, [boardPath, defaultTabId]);

  useEffect(() => {
    let cancelled = false;
    getPatchedRunframeStandaloneUrl()
      .then((url) => {
        if (!cancelled) {
          setRunframeScriptUrl(url);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err?.message || err));
          setStatus("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const frameSrcDoc = useMemo(() => {
    if (typeof source !== "string" || !runframeScriptUrl) {
      return "";
    }
    return buildSrcDoc({ source, tab: defaultTabId, runframeScriptUrl });
  }, [defaultTabId, runframeScriptUrl, source]);

  const sendActiveTabToFrame = useCallback(() => {
    const target = frameRef.current?.contentWindow;
    if (!target) {
      return;
    }
    target.postMessage({
      source: "diffforge-pcb-panel",
      tab: activeTab,
      type: PCB_SET_ACTIVE_TAB_MESSAGE,
    }, "*");
  }, [activeTab]);

  useEffect(() => {
    if (!frameSrcDoc) {
      return undefined;
    }
    let cancelled = false;
    let attempt = 0;
    const send = () => {
      if (cancelled) {
        return;
      }
      sendActiveTabToFrame();
      attempt += 1;
      if (attempt < 12) {
        window.setTimeout(send, 100);
      }
    };
    send();
    return () => {
      cancelled = true;
    };
  }, [activeTab, frameSrcDoc, sendActiveTabToFrame]);

  const readSource = useCallback(() => {
    const readSeq = readSeqRef.current + 1;
    readSeqRef.current = readSeq;
    if (!repoPath || !boardPath) {
      return;
    }
    invoke("pcb_document_read", { repoPath, boardPath, workspaceId })
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
  }, [repoPath, boardPath, workspaceId]);

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
      const eventWorkspace = String(event?.payload?.workspaceId || event?.payload?.workspace_id || "").trim();
      if (eventRepo && eventRepo !== normalizedRepoPath) {
        return;
      }
      if (eventWorkspace && workspaceId && eventWorkspace !== workspaceId) {
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
  }, [boardPath, normalizedRepoPath, readSource, repoPath, workspaceId]);

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
        ) : source == null || !runframeScriptUrl ? (
          <PanelMessage>Loading board…</PanelMessage>
        ) : (
          <BoardFrame
            key={`${boardPath}:${source.length}:${runframeScriptUrl}`}
            onLoad={sendActiveTabToFrame}
            ref={frameRef}
            srcDoc={frameSrcDoc}
            title={`${board?.name || "PCB"} renderer`}
          />
        )}
      </PanelBody>
    </PanelShell>
  );
}

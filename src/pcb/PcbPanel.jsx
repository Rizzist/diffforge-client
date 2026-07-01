import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createCircuitWebWorker } from "@tscircuit/eval/worker";
import evalWebWorkerBlobUrl from "@tscircuit/eval/blob-url";
import manifoldModuleUrl from "manifold-3d/manifold.js?url";
import manifoldWasmUrl from "manifold-3d/manifold.wasm?url";
import runframeStandalonePreviewUrl from "@tscircuit/runframe/standalone-preview?url";

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
const PCB_MAIN_FILE_PATH = "main.tsx";
const PCB_RENDER_TIMEOUT_MS = 30000;

function serializeJavaScriptLiteral(value) {
  return String(JSON.stringify(value) ?? "null")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildRunframePreviewBootstrapSource({
  circuitJson,
  previewProps,
  manifoldModuleUrl,
  manifoldWasmUrl,
}) {
  const embeddedCircuitJson = serializeJavaScriptLiteral(normalizeCircuitJsonPayload(circuitJson));
  const embeddedPreviewProps = serializeJavaScriptLiteral(sanitizeRunframePreviewProps(previewProps));
  const embeddedManifoldModuleUrl = serializeJavaScriptLiteral(manifoldModuleUrl);
  const embeddedManifoldWasmUrl = serializeJavaScriptLiteral(manifoldWasmUrl);

  return PCB_RUNFRAME_PREVIEW_BOOTSTRAP_SOURCE
    .replace(
      "(function () {",
      `(function () {\n  var embeddedCircuitJson = ${embeddedCircuitJson};\n  var embeddedPreviewProps = ${embeddedPreviewProps};\n  var embeddedManifoldModuleUrl = ${embeddedManifoldModuleUrl};\n  var embeddedManifoldWasmUrl = ${embeddedManifoldWasmUrl};`,
    )
    .replace(
      `  window.CIRCUIT_JSON = normalizeCircuitJson(readJsonScript("circuit-json", []));
  window.CIRCUIT_JSON_PREVIEW_PROPS = sanitizePreviewProps(readJsonScript("preview-props", {}));`,
      `  window.CIRCUIT_JSON = normalizeCircuitJson(embeddedCircuitJson);
  window.CIRCUIT_JSON_PREVIEW_PROPS = sanitizePreviewProps(embeddedPreviewProps);`,
    );
}

const PCB_RUNFRAME_PREVIEW_BOOTSTRAP_SOURCE = `
(function () {
  var noopScriptUrl = null;
  function readJsonScript(id, fallback) {
    var element = document.getElementById(id);
    if (!element) {
      return fallback;
    }
    try {
      return JSON.parse(element.textContent || "");
    } catch (error) {
      console.error("Failed to parse PCB preview payload", error);
      return fallback;
    }
  }
  function normalizeCircuitJson(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (Array.isArray(value && value.circuitJson)) {
      return value.circuitJson;
    }
    if (Array.isArray(value && value.circuit_json)) {
      return value.circuit_json;
    }
    if (Array.isArray(value && value.elements)) {
      return value.elements;
    }
    return [];
  }
  function sanitizePreviewProps(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    delete value.circuitJson;
    delete value.circuit_json;
    delete value.elements;
    return value;
  }
  function isPostpigUrl(value) {
    try {
      return new URL(String(value), window.location.href).hostname === "postpig.tscircuit.com";
    } catch {
      return false;
    }
  }
  function getNoopScriptUrl() {
    if (!noopScriptUrl) {
      noopScriptUrl = URL.createObjectURL(new Blob([""], { type: "text/javascript" }));
    }
    return noopScriptUrl;
  }
  var originalFetch = window.fetch && window.fetch.bind(window);
  if (originalFetch) {
    window.fetch = function (input, init) {
      var target = typeof input === "string" ? input : input && input.url;
      if (isPostpigUrl(target)) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return originalFetch(input, init);
    };
  }
  if (navigator.sendBeacon) {
    var originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      if (isPostpigUrl(url)) {
        return true;
      }
      return originalSendBeacon(url, data);
    };
  }
  if (window.XMLHttpRequest) {
    var originalOpen = window.XMLHttpRequest.prototype.open;
    var originalSend = window.XMLHttpRequest.prototype.send;
    window.XMLHttpRequest.prototype.open = function (method, url) {
      this.__diffforgeBlockedPostpig = isPostpigUrl(url);
      return originalOpen.apply(this, arguments);
    };
    window.XMLHttpRequest.prototype.send = function () {
      if (this.__diffforgeBlockedPostpig) {
        return;
      }
      return originalSend.apply(this, arguments);
    };
  }
  if (window.HTMLScriptElement) {
    var srcDescriptor = Object.getOwnPropertyDescriptor(window.HTMLScriptElement.prototype, "src");
    var originalSetAttribute = window.HTMLScriptElement.prototype.setAttribute;
    if (srcDescriptor && srcDescriptor.set && srcDescriptor.get) {
      Object.defineProperty(window.HTMLScriptElement.prototype, "src", {
        configurable: true,
        enumerable: srcDescriptor.enumerable,
        get: function () {
          return srcDescriptor.get.call(this);
        },
        set: function (value) {
          return srcDescriptor.set.call(this, isPostpigUrl(value) ? getNoopScriptUrl() : value);
        },
      });
    }
    window.HTMLScriptElement.prototype.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === "src" && isPostpigUrl(value)) {
        return originalSetAttribute.call(this, name, getNoopScriptUrl());
      }
      return originalSetAttribute.apply(this, arguments);
    };
  }
  if (!window.ManifoldModule) {
    window.ManifoldModule = function () {
      return import(embeddedManifoldModuleUrl).then(function (module) {
        if (!module || typeof module.default !== "function") {
          throw new Error("Local Manifold module did not export a default initializer.");
        }
        return module.default({
          locateFile: function (path) {
            return String(path).endsWith(".wasm") ? embeddedManifoldWasmUrl : path;
          },
        });
      });
    };
  }
  window.CIRCUIT_JSON = normalizeCircuitJson(readJsonScript("circuit-json", []));
  window.CIRCUIT_JSON_PREVIEW_PROPS = sanitizePreviewProps(readJsonScript("preview-props", {}));
})();
`;

let pcbRenderQueue = Promise.resolve();

function enqueuePcbRender(task) {
  const run = pcbRenderQueue.then(task, task);
  pcbRenderQueue = run.catch(() => {});
  return run;
}

function escapeHtmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeRepoIdentity(repoPath) {
  return String(repoPath || "").trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}

function normalizePcbTab(tab) {
  return PCB_TABS.includes(tab) ? tab : "pcb";
}

function normalizeCircuitJsonPayload(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.circuitJson)) {
    return value.circuitJson;
  }
  if (Array.isArray(value?.circuit_json)) {
    return value.circuit_json;
  }
  if (Array.isArray(value?.elements)) {
    return value.elements;
  }
  return [];
}

function sanitizeRunframePreviewProps(value) {
  const props = { ...(value || {}) };
  delete props.circuitJson;
  delete props.circuit_json;
  delete props.elements;
  return props;
}

function getErrorMessage(error) {
  if (!error) {
    return "Unknown renderer error";
  }
  if (error instanceof Error) {
    return error.message || String(error);
  }
  if (typeof error === "object" && "message" in error) {
    return String(error.message || error);
  }
  return String(error);
}

function getWorkerEventMessage(event) {
  if (event?.message) {
    return event.message;
  }
  if (event?.error) {
    return getErrorMessage(event.error);
  }
  return `PCB renderer worker failed${event?.type ? ` (${event.type})` : ""}`;
}

function withTimeout(promise, label, timeoutMs = PCB_RENDER_TIMEOUT_MS) {
  let timeoutId = null;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`Timed out while ${label}.`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout])
    .finally(() => {
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    });
}

function buildPreviewSrcDoc({
  bootstrapUrl,
  scriptUrl,
}) {
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
      [role="tablist"].rf-h-9,
      .rf-flex.rf-items-center.rf-gap-2.rf-p-2.rf-pb-0 {
        display: none !important;
      }
      .rf-min-h-\\[620px\\],
      .rf-min-h-\\[calc\\(100vh-240px\\)\\] {
        min-height: 0 !important;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script src="${escapeHtmlAttribute(bootstrapUrl)}"></script>
    <script src="${escapeHtmlAttribute(scriptUrl)}"></script>
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

const RunFrameSurface = styled.div`
  position: relative;
  flex: 1 1 auto;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #ffffff;

  [role="tablist"].rf-h-9,
  .rf-flex.rf-items-center.rf-gap-2.rf-p-2.rf-pb-0 {
    display: none !important;
  }

  .rf-min-h-\\[620px\\],
  .rf-min-h-\\[calc\\(100vh-240px\\)\\] {
    min-height: 0 !important;
  }

  .rf-h-full,
  .rf-flex-grow {
    min-height: 0;
  }
`;

const PreviewFrame = styled.iframe`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  border: 0;
  background: #ffffff;
`;

const RenderErrorBanner = styled.div`
  position: absolute;
  z-index: 2;
  top: 8px;
  left: 8px;
  right: 8px;
  padding: 8px 10px;
  border: 1px solid rgba(239, 68, 68, 0.28);
  border-radius: 6px;
  background: rgba(254, 242, 242, 0.96);
  color: #991b1b;
  font-size: 11px;
  line-height: 1.35;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.12);
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
  const [circuitJson, setCircuitJson] = useState(null);
  const [runframePreviewBootstrapUrl, setRunframePreviewBootstrapUrl] = useState("");
  const [renderLog, setRenderLog] = useState(null);
  const [solverEvents, setSolverEvents] = useState([]);
  const [renderStatus, setRenderStatus] = useState("idle");
  const [renderError, setRenderError] = useState("");
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState("");
  const readSeqRef = useRef(0);
  const renderSeqRef = useRef(0);
  const normalizedRepoPath = useMemo(() => normalizeRepoIdentity(repoPath), [repoPath]);
  const fsMap = useMemo(() => {
    if (typeof source !== "string") {
      return null;
    }
    return { [PCB_MAIN_FILE_PATH]: source };
  }, [source]);
  const previewProps = useMemo(() => ({
    activeEffectName: renderLog?.lastRenderEvent?.phase,
    allowSelectingVersion: false,
    availableTabs: PCB_TABS,
    code: source || "",
    defaultActiveTab: activeTab,
    defaultTab: activeTab,
    errorMessage: renderError || null,
    errorStack: renderError ? "" : null,
    fsMap: fsMap || {},
    isRunningCode: renderStatus === "rendering",
    isWebEmbedded: true,
    projectName: board?.name || boardPath || "PCB",
    renderLog,
    showCodeTab: false,
    showFileMenu: false,
    showImportAndFormatButtons: false,
    showRenderLogTab: true,
    showRightHeaderContent: false,
    showToggleFullScreen: false,
    solverEvents,
  }), [activeTab, board?.name, boardPath, fsMap, renderError, renderLog, renderStatus, solverEvents, source]);
  const previewSrcDoc = useMemo(() => {
    if (!circuitJson || !runframePreviewBootstrapUrl) {
      return "";
    }
    return buildPreviewSrcDoc({
      bootstrapUrl: runframePreviewBootstrapUrl,
      scriptUrl: runframeStandalonePreviewUrl,
    });
  }, [circuitJson, runframePreviewBootstrapUrl]);

  useEffect(() => {
    setActiveTab(defaultTabId);
  }, [boardPath, defaultTabId]);

  useEffect(() => {
    if (!circuitJson) {
      setRunframePreviewBootstrapUrl("");
      return undefined;
    }
    const bootstrapUrl = URL.createObjectURL(new Blob(
      [buildRunframePreviewBootstrapSource({
        circuitJson,
        previewProps,
        manifoldModuleUrl,
        manifoldWasmUrl,
      })],
      { type: "text/javascript" },
    ));
    setRunframePreviewBootstrapUrl(bootstrapUrl);
    return () => {
      URL.revokeObjectURL(bootstrapUrl);
    };
  }, [circuitJson, previewProps]);

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
        setCircuitJson(null);
        setRenderLog(null);
        setRenderError("");
        setSolverEvents([]);
        setRenderStatus("idle");
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
    setCircuitJson(null);
    setRenderLog(null);
    setRenderError("");
    setSolverEvents([]);
    setRenderStatus("idle");
    readSource();
  }, [readSource]);

  useEffect(() => {
    if (!fsMap) {
      return undefined;
    }
    const renderSeq = renderSeqRef.current + 1;
    renderSeqRef.current = renderSeq;
    let cancelled = false;
    let worker = null;
    let cleanupWorkerErrorListeners = () => {};

    const isCurrent = () => !cancelled && renderSeqRef.current === renderSeq;
    const updateRenderLog = (updater) => {
      if (!isCurrent()) {
        return;
      }
      setRenderLog((previous) => updater(previous || {
        debugOutputs: [],
        eventsProcessed: 0,
        progress: 0,
        renderEvents: [],
      }));
    };

    const renderBoard = async () => {
      if (!isCurrent()) {
        return;
      }
      setCircuitJson(null);
      setRenderError("");
      setRenderLog({
        debugOutputs: [],
        eventsProcessed: 0,
        progress: 0,
        renderEvents: [],
      });
      setSolverEvents([]);
      setRenderStatus("rendering");
      try {
        worker = await withTimeout(createCircuitWebWorker({
          projectConfig: {
            projectBaseUrl: normalizedRepoPath || repoPath || "",
          },
          verbose: false,
          webWorkerBlobUrl: evalWebWorkerBlobUrl,
        }), "starting PCB renderer worker");
        const workerErrorPromise = new Promise((_, reject) => {
          const rawWorker = worker?.__rawWorker;
          if (!rawWorker?.addEventListener) {
            return;
          }
          const handleWorkerError = (event) => {
            reject(new Error(getWorkerEventMessage(event)));
          };
          rawWorker.addEventListener("error", handleWorkerError);
          rawWorker.addEventListener("messageerror", handleWorkerError);
          cleanupWorkerErrorListeners = () => {
            rawWorker.removeEventListener("error", handleWorkerError);
            rawWorker.removeEventListener("messageerror", handleWorkerError);
          };
        });
        const runWorkerStep = (promise, label) => (
          withTimeout(Promise.race([promise, workerErrorPromise]), label)
        );
        worker.on("board:renderPhaseStarted", (event) => {
          const entry = { ...event, createdAt: Date.now() };
          updateRenderLog((previous) => {
            const eventsProcessed = (previous.eventsProcessed || 0) + 1;
            return {
              ...previous,
              eventsProcessed,
              lastRenderEvent: entry,
              progress: Math.min(0.95, Math.max(previous.progress || 0, eventsProcessed / 30)),
              renderEvents: [...(previous.renderEvents || []), entry].slice(-250),
            };
          });
        });
        worker.on("debug:logOutput", (event) => {
          updateRenderLog((previous) => ({
            ...previous,
            debugOutputs: [
              ...(previous.debugOutputs || []),
              { content: event?.content, name: event?.name, type: "debug" },
            ].slice(-100),
          }));
        });
        worker.on("solver:started", (event) => {
          if (!isCurrent()) {
            return;
          }
          setSolverEvents((previous) => [...previous, event]);
        });

        await runWorkerStep(worker.executeWithFsMap({
          fsMap,
          mainComponentPath: PCB_MAIN_FILE_PATH,
        }), "executing PCB source");
        const settled = runWorkerStep(worker.renderUntilSettled(), "settling PCB render");
        const initialCircuitJson = await runWorkerStep(worker.getCircuitJson(), "reading initial PCB JSON");
        if (isCurrent()) {
          setCircuitJson(normalizeCircuitJsonPayload(initialCircuitJson));
          updateRenderLog((previous) => ({
            ...previous,
            progress: Math.max(previous.progress || 0, 0.55),
          }));
        }
        await settled;
        const finalCircuitJson = await runWorkerStep(worker.getCircuitJson(), "reading final PCB JSON");
        if (isCurrent()) {
          setCircuitJson(normalizeCircuitJsonPayload(finalCircuitJson));
          setRenderStatus("ready");
          setRenderError("");
          updateRenderLog((previous) => ({
            ...previous,
            progress: 1,
          }));
        }
      } catch (err) {
        if (isCurrent()) {
          setRenderError(getErrorMessage(err));
          setRenderStatus("error");
          updateRenderLog((previous) => ({
            ...previous,
            progress: previous.progress || 1,
          }));
        }
      } finally {
        cleanupWorkerErrorListeners();
        try {
          await worker?.clearEventListeners?.();
        } catch {
          // Best-effort cleanup; render errors above are the useful user signal.
        }
        try {
          await worker?.kill?.();
        } catch {
          // A newer render may have already replaced the global eval worker.
        }
      }
    };

    void enqueuePcbRender(renderBoard);

    return () => {
      cancelled = true;
      try {
        void worker?.kill?.();
      } catch {
        // Worker cleanup is best effort during live reload churn.
      }
    };
  }, [fsMap, normalizedRepoPath, repoPath]);

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
        ) : source == null ? (
          <PanelMessage>Loading board…</PanelMessage>
        ) : renderStatus === "error" && !circuitJson ? (
          <PanelMessage data-tone="error">Could not render board: {renderError}</PanelMessage>
        ) : !circuitJson || !previewSrcDoc ? (
          <PanelMessage>Rendering board…</PanelMessage>
        ) : (
          <RunFrameSurface>
            {renderError ? (
              <RenderErrorBanner>
                PCB renderer warning: {renderError}
              </RenderErrorBanner>
            ) : null}
            <PreviewFrame
              key={`${boardPath}:${activeTab}:${circuitJson.length}:${renderStatus}:${renderError}`}
              srcDoc={previewSrcDoc}
              title={`${board?.name || "PCB"} renderer`}
            />
          </RunFrameSurface>
        )}
      </PanelBody>
    </PanelShell>
  );
}

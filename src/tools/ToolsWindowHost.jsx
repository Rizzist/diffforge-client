import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "@vscode/codicons/dist/codicon.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import { GlobalStyle } from "../app/appStyles.js";
import {
  TOOLS_WINDOW_CLOSED_EVENT,
  TOOLS_WINDOW_AGENT_COMPANION_CLOSE,
  TOOLS_WINDOW_AGENT_COMPANION_EVENT,
  TOOLS_WINDOW_AGENT_COMPANION_FOCUS,
  TOOLS_WINDOW_AGENT_COMPANION_OPEN,
  TOOLS_WINDOW_CONTROL_CLOSE,
  TOOLS_WINDOW_CONTROL_DELETE,
  TOOLS_WINDOW_CONTROL_DISCARD,
  TOOLS_WINDOW_CONTROL_EVENT,
  TOOLS_WINDOW_CONTROL_FOCUS_MAIN,
  TOOLS_WINDOW_CONTROL_RETURN,
  TOOLS_WINDOW_CONTROL_RUN,
  TOOLS_WINDOW_CONTROL_SAVE_LOCAL,
  TOOLS_WINDOW_CONTROL_SAVE_PUSH,
  TOOLS_WINDOW_CONTROL_UPDATE,
  TOOLS_WINDOW_META_EVENT,
  TOOLS_WINDOW_META_REQUEST_EVENT,
} from "./toolsWindowBridge.js";

const TOOL_WINDOW_THEME_STORAGE_PREFIX = "diffforge.tools.breakout.theme.";
const TOOLS_WINDOW_THEMES = [
  { id: "dark", label: "Dark" },
  { id: "navy", label: "Navy" },
  { id: "gold", label: "Gold" },
  { id: "light", label: "Light" },
];

const A4_WIDTH = 794;
const A4_HEIGHT = 1123;
const PAGE_MIN_SCALE = 0.42;
const PAGE_MAX_SCALE = 2.2;
const PAGE_INLINE_GUTTER = 68;
const PAGE_VERTICAL_GUTTER = 176;
const ZOOM_FACTOR_MIN = 0.52;
const ZOOM_FACTOR_MAX = 2.8;
const ZOOM_STEP = 1.14;
const ZOOM_WHEEL_INTENSITY = 0.0014;

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizedMode(value) {
  return text(value).toLowerCase() === "scripts" ? "scripts" : "docs";
}

function normalizedWindowTheme(value, fallback = "dark") {
  const normalized = text(value).toLowerCase();
  return TOOLS_WINDOW_THEMES.some((theme) => theme.id === normalized) ? normalized : fallback;
}

function metaIsHtmlDocument(meta) {
  const kind = text(meta?.documentKind || meta?.document_kind || meta?.source || meta?.kind).toLowerCase();
  const extension = text(meta?.extension || meta?.ext).trim().replace(/^\./u, "").toLowerCase();
  const mimeType = text(meta?.mimeType || meta?.mime_type).toLowerCase();
  const path = text(meta?.pathKey || meta?.path_key || meta?.documentKey || meta?.document_key).toLowerCase();
  return kind === "html"
    || extension === "html"
    || extension === "htm"
    || mimeType.startsWith("text/html")
    || path.endsWith(".html")
    || path.endsWith(".htm");
}

function parseToolsWindowParams() {
  if (typeof window === "undefined") {
    return { key: "", mode: "docs", theme: "dark", title: "Tools", windowId: "" };
  }
  const hash = window.location.hash || "";
  const queryIndex = hash.indexOf("?");
  const params = new URLSearchParams(queryIndex >= 0 ? hash.slice(queryIndex + 1) : "");
  return {
    key: params.get("key") || "",
    mode: normalizedMode(params.get("mode")),
    theme: normalizedWindowTheme(params.get("theme")),
    title: params.get("title") || "Tools",
    windowId: params.get("windowId") || getCurrentWebviewWindow().label || "",
  };
}

function readStoredTheme(mode, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    return normalizedWindowTheme(window.localStorage?.getItem(`${TOOL_WINDOW_THEME_STORAGE_PREFIX}${mode}`), fallback);
  } catch {
    return fallback;
  }
}

function writeStoredTheme(mode, theme) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(`${TOOL_WINDOW_THEME_STORAGE_PREFIX}${mode}`, theme);
  } catch {
    // Cosmetic preference only.
  }
}

function pageMetrics(scale, script = false) {
  const safeScale = Math.max(PAGE_MIN_SCALE, Math.min(PAGE_MAX_SCALE, Number(scale) || 1));
  const pageWidth = A4_WIDTH * safeScale;
  const pageHeight = A4_HEIGHT * safeScale;
  const paddingTop = Math.max(22, 52 * safeScale);
  const paddingInline = Math.max(24, 58 * safeScale);
  const paddingBottom = Math.max(28, 76 * safeScale);
  const titleFontSize = Math.max(17, 30 * safeScale);
  const bodyFontSize = Math.max(11, 15 * safeScale) * (script ? 0.9 : 1);
  const bodyLineHeight = bodyFontSize * (script ? 1.62 : 1.72);
  const averageCharWidth = bodyFontSize * (script ? 0.585 : 0.55);
  const titleHeight = titleFontSize * 1.18 + Math.max(5, 8 * safeScale) + 1 + Math.max(12, 24 * safeScale);
  const bodyHeight = Math.max(1, pageHeight - paddingTop - paddingBottom - 2);
  return {
    bodyFontSize,
    bodyLineHeight,
    columns: Math.max(12, Math.floor((pageWidth - paddingInline * 2 - 20 * safeScale) / averageCharWidth)),
    pageHeight,
    pageWidth,
    paddingBottom,
    paddingInline,
    paddingTop,
    rowsFirst: Math.max(1, Math.floor((bodyHeight - titleHeight) / bodyLineHeight)),
    rowsRest: Math.max(1, Math.floor(bodyHeight / bodyLineHeight)),
    safeScale,
    titleFontSize,
  };
}

function clampZoomFactor(value) {
  return Math.max(ZOOM_FACTOR_MIN, Math.min(ZOOM_FACTOR_MAX, Number(value) || 1));
}

function clampPageScale(value) {
  return Math.max(PAGE_MIN_SCALE, Math.min(PAGE_MAX_SCALE, Number(value) || 1));
}

function visualRows(content, columns, preserveWords = true) {
  const source = String(content ?? "");
  const safeColumns = Math.max(8, Number.parseInt(columns, 10) || 80);
  if (!source.length) return [{ start: 0, end: 0 }];
  const rows = [];
  let offset = 0;
  while (offset <= source.length) {
    const newlineIndex = source.indexOf("\n", offset);
    const lineEnd = newlineIndex === -1 ? source.length : newlineIndex;
    if (lineEnd === offset) {
      rows.push({ start: offset, end: newlineIndex === -1 ? lineEnd : lineEnd + 1 });
    } else {
      let chunkStart = offset;
      while (chunkStart < lineEnd) {
        let chunkEnd = Math.min(lineEnd, chunkStart + safeColumns);
        if (preserveWords && chunkEnd < lineEnd) {
          for (let index = chunkEnd; index > chunkStart + 1; index -= 1) {
            if (/\s/u.test(source.charAt(index - 1))) {
              chunkEnd = index;
              break;
            }
          }
        }
        rows.push({
          start: chunkStart,
          end: chunkEnd === lineEnd && newlineIndex !== -1 ? lineEnd + 1 : chunkEnd,
        });
        chunkStart = chunkEnd;
      }
    }
    if (newlineIndex === -1) break;
    offset = newlineIndex + 1;
    if (offset === source.length) {
      rows.push({ start: source.length, end: source.length });
      break;
    }
  }
  return rows;
}

function paginateContent(content, scale, script = false) {
  const source = String(content ?? "");
  const metrics = pageMetrics(scale, script);
  const rows = visualRows(source, metrics.columns, !script);
  if (!source.length) {
    return [{
      capacityRows: metrics.rowsFirst,
      end: 0,
      firstPage: true,
      index: 0,
      start: 0,
      text: "",
    }];
  }
  const pages = [];
  let pageStart = 0;
  let pageIndex = 0;
  let pageRows = 0;
  let pageCapacity = metrics.rowsFirst;
  rows.forEach((row) => {
    if (pageRows >= pageCapacity && row.start > pageStart) {
      pages.push({
        capacityRows: pageCapacity,
        end: row.start,
        firstPage: pageIndex === 0,
        index: pageIndex,
        start: pageStart,
        text: source.slice(pageStart, row.start),
      });
      pageIndex += 1;
      pageStart = row.start;
      pageRows = 0;
      pageCapacity = metrics.rowsRest;
    }
    pageRows += 1;
  });
  pages.push({
    capacityRows: pageCapacity,
    end: source.length,
    firstPage: pageIndex === 0,
    index: pageIndex,
    start: pageStart,
    text: source.slice(pageStart),
  });
  return pages;
}

function replacePageContent(content, page, pageContent) {
  const source = String(content ?? "");
  const start = Math.max(0, Math.min(source.length, Number(page?.start) || 0));
  const end = Math.max(start, Math.min(source.length, Number(page?.end) || start));
  return `${source.slice(0, start)}${String(pageContent ?? "")}${source.slice(end)}`;
}

function pageStyle(scale, script = false) {
  const metrics = pageMetrics(scale, script);
  return {
    "--tools-window-body-font-size": `${metrics.bodyFontSize}px`,
    "--tools-window-body-line-height": `${metrics.bodyLineHeight}px`,
    "--tools-window-page-height": `${Math.round(metrics.pageHeight)}px`,
    "--tools-window-page-padding-bottom": `${Math.round(metrics.paddingBottom)}px`,
    "--tools-window-page-padding-inline": `${Math.round(metrics.paddingInline)}px`,
    "--tools-window-page-padding-top": `${Math.round(metrics.paddingTop)}px`,
    "--tools-window-page-width": `${Math.round(metrics.pageWidth)}px`,
    "--tools-window-title-font-size": `${metrics.titleFontSize}px`,
  };
}

function metaMatches(meta, params) {
  if (!meta) return false;
  if (text(meta.windowId) && text(params.windowId) && text(meta.windowId) !== text(params.windowId)) {
    return false;
  }
  if (normalizedMode(meta.mode) !== params.mode) return false;
  const metaKey = text(meta.key);
  return !params.key || !metaKey || metaKey === params.key;
}

function toolsWindowIsMacPlatform() {
  if (typeof navigator === "undefined") {
    return false;
  }

  return /mac|darwin/iu.test([
    navigator.userAgentData?.platform,
    navigator.platform,
    navigator.userAgent,
  ].filter(Boolean).join(" "));
}

async function readToolsWindowFrameState(currentWindow) {
  const [isFullscreen, isMaximized] = await Promise.all([
    currentWindow.isFullscreen(),
    currentWindow.isMaximized(),
  ]);
  return {
    expanded: Boolean(isFullscreen || isMaximized),
    isFullscreen: Boolean(isFullscreen),
    isMaximized: Boolean(isMaximized),
  };
}

async function exitToolsWindowSimpleFullscreen(currentWindow) {
  if (!toolsWindowIsMacPlatform() || typeof currentWindow.setSimpleFullscreen !== "function") {
    return;
  }

  try {
    await currentWindow.setSimpleFullscreen(false);
  } catch {
    // Only clears legacy simple-fullscreen state from older dev sessions.
  }
}

export default function ToolsWindowHost() {
  const params = useMemo(parseToolsWindowParams, []);
  const currentWindow = useMemo(() => getCurrentWindow(), []);
  const [meta, setMeta] = useState(null);
  const [theme, setTheme] = useState(() => readStoredTheme(params.mode, params.theme));
  const [fitScale, setFitScale] = useState(0.78);
  const [zoomFactor, setZoomFactor] = useState(1);
  const [maximized, setMaximized] = useState(false);
  const [localTitle, setLocalTitle] = useState(params.title);
  const [localContent, setLocalContent] = useState("");
  const [localError, setLocalError] = useState("");
  const canvasRef = useRef(null);
  const lastLocalEditAtRef = useRef(0);
  const pendingContentRef = useRef("");

  useEffect(() => {
    document.documentElement.dataset.toolsWindow = "true";
    document.body.dataset.toolsWindow = "true";
    document.body.style.background = "transparent";
    return () => {
      delete document.documentElement.dataset.toolsWindow;
      delete document.body.dataset.toolsWindow;
    };
  }, []);

  useEffect(() => {
    writeStoredTheme(params.mode, theme);
  }, [params.mode, theme]);

  const requestMeta = useCallback(() => {
    emit(TOOLS_WINDOW_META_REQUEST_EVENT, {
      key: params.key,
      mode: params.mode,
      windowId: params.windowId,
    }).catch(() => {});
  }, [params.key, params.mode, params.windowId]);

  const sendAgentCompanion = useCallback((action) => {
    emit(TOOLS_WINDOW_AGENT_COMPANION_EVENT, {
      action,
      key: params.key,
      mode: params.mode,
      title: localTitle,
      windowId: params.windowId,
    }).catch(() => {});
  }, [localTitle, params.key, params.mode, params.windowId]);

  const refreshWindowFrameState = useCallback(async () => {
    try {
      const frameState = await readToolsWindowFrameState(currentWindow);
      setMaximized(frameState.expanded);
      return frameState;
    } catch {
      return null;
    }
  }, [currentWindow]);

  useEffect(() => {
    let disposed = false;
    let unlistenResize = null;
    let unlistenFocus = null;
    const refresh = () => {
      if (!disposed) {
        refreshWindowFrameState();
      }
    };

    refresh();

    currentWindow.onResized(refresh)
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenResize = unlisten;
        }
      })
      .catch(() => {});

    currentWindow.onFocusChanged(refresh)
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenFocus = unlisten;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (typeof unlistenResize === "function") {
        unlistenResize();
      }
      if (typeof unlistenFocus === "function") {
        unlistenFocus();
      }
    };
  }, [currentWindow, refreshWindowFrameState]);

  useEffect(() => () => {
    emit(TOOLS_WINDOW_AGENT_COMPANION_EVENT, {
      action: TOOLS_WINDOW_AGENT_COMPANION_CLOSE,
      key: params.key,
      mode: params.mode,
      windowId: params.windowId,
    }).catch(() => {});
  }, [params.key, params.mode, params.windowId]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(TOOLS_WINDOW_META_EVENT, (event) => {
      if (disposed || !metaMatches(event.payload, params)) return;
      const nextMeta = event.payload || {};
      const nextContent = String(nextMeta.content ?? "");
      const nextTitle = text(nextMeta.title, params.title);
      setMeta(nextMeta);
      if (nextMeta.error) {
        setLocalError("");
      }
      setLocalTitle((current) => (
        Date.now() - lastLocalEditAtRef.current < 350 && current !== nextTitle
          ? current
          : nextTitle
      ));
      setLocalContent((current) => {
        if (nextContent === pendingContentRef.current) {
          return nextContent;
        }
        if (Date.now() - lastLocalEditAtRef.current < 350 && current !== nextContent) {
          return current;
        }
        return nextContent;
      });
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
        requestMeta();
      })
      .catch(() => {
        requestMeta();
      });
    return () => {
      disposed = true;
      unlisten();
    };
  }, [params, requestMeta]);

  useEffect(() => {
    const notifyClosed = () => {
      emit(TOOLS_WINDOW_CLOSED_EVENT, {
        key: params.key,
        mode: params.mode,
        windowId: params.windowId,
      }).catch(() => {});
    };
    window.addEventListener("beforeunload", notifyClosed);
    return () => {
      window.removeEventListener("beforeunload", notifyClosed);
      notifyClosed();
    };
  }, [params.key, params.mode, params.windowId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window === "undefined") return undefined;
    let frame = 0;
    const updateScale = () => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const widthScale = Math.max(PAGE_MIN_SCALE, (bounds.width - PAGE_INLINE_GUTTER) / A4_WIDTH);
      const heightScale = Math.max(PAGE_MIN_SCALE, (bounds.height - PAGE_VERTICAL_GUTTER) / A4_HEIGHT);
      const nextScale = Math.min(PAGE_MAX_SCALE, widthScale, heightScale);
      setFitScale((current) => (Math.abs(current - nextScale) < 0.005 ? current : nextScale));
    };
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateScale);
    };
    updateScale();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(canvas);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [maximized]);

  const sendControl = useCallback((control, extra = {}) => {
    emit(TOOLS_WINDOW_CONTROL_EVENT, {
      control,
      key: params.key,
      mode: params.mode,
      windowId: params.windowId,
      ...extra,
    }).catch(() => {});
  }, [params.key, params.mode, params.windowId]);

  const updateOwner = useCallback((patch) => {
    lastLocalEditAtRef.current = Date.now();
    pendingContentRef.current = Object.prototype.hasOwnProperty.call(patch, "content")
      ? String(patch.content ?? "")
      : pendingContentRef.current;
    sendControl(TOOLS_WINDOW_CONTROL_UPDATE, patch);
  }, [sendControl]);

  const returnToMain = useCallback(() => {
    sendControl(TOOLS_WINDOW_CONTROL_RETURN);
    currentWindow.close().catch(() => {});
  }, [currentWindow, sendControl]);

  const focusMain = useCallback(() => {
    sendControl(TOOLS_WINDOW_CONTROL_FOCUS_MAIN);
  }, [sendControl]);

  const openHtmlInBrowser = useCallback(async () => {
    if (!metaIsHtmlDocument(meta)) return;
    try {
      setLocalError("");
      await invoke("open_html_document_in_browser", {
        content: localContent,
        title: text(localTitle, "document"),
      });
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error || "Unable to open HTML document in the browser."));
    }
  }, [localContent, localTitle, meta]);

  const toggleMaximized = useCallback(async () => {
    const latestFrameState = await refreshWindowFrameState();
    const isExpanded = latestFrameState?.expanded ?? maximized;
    const nextMaximized = !isExpanded;
    try {
      if (nextMaximized) {
        await exitToolsWindowSimpleFullscreen(currentWindow);
        await currentWindow.setFullscreen(true);
      } else if (latestFrameState?.isFullscreen) {
        await currentWindow.setFullscreen(false);
      } else {
        await currentWindow.toggleMaximize();
      }
    } catch {
      if (nextMaximized) {
        await currentWindow.toggleMaximize().catch(() => {});
      } else {
        await currentWindow.setFullscreen(false).catch(() => {});
        await currentWindow.toggleMaximize().catch(() => {});
      }
    }
    const finalFrameState = await refreshWindowFrameState();
    const finalMaximized = finalFrameState?.expanded ?? nextMaximized;
    setMaximized(finalMaximized);
    sendAgentCompanion(finalMaximized
      ? TOOLS_WINDOW_AGENT_COMPANION_OPEN
      : TOOLS_WINDOW_AGENT_COMPANION_CLOSE);
  }, [currentWindow, maximized, refreshWindowFrameState, sendAgentCompanion]);

  const zoomIn = useCallback(() => {
    setZoomFactor((current) => clampZoomFactor(current * ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomFactor((current) => clampZoomFactor(current / ZOOM_STEP));
  }, []);

  const resetZoom = useCallback(() => {
    setZoomFactor(1);
  }, []);

  const handleCanvasWheel = useCallback((event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const delta = Number(event.deltaY || 0);
    setZoomFactor((current) => clampZoomFactor(current * Math.exp(-delta * ZOOM_WHEEL_INTENSITY)));
  }, []);

  const mode = params.mode;
  const isScript = mode === "scripts";
  const pageScale = useMemo(() => clampPageScale(fitScale * zoomFactor), [fitScale, zoomFactor]);
  const pages = useMemo(() => paginateContent(localContent, pageScale, isScript), [isScript, localContent, pageScale]);
  const busy = Boolean(meta?.busy);
  const readOnly = Boolean(meta?.readOnly);
  const title = text(localTitle, isScript ? "Script" : "Document");
  const subtitle = text(meta?.subtitle || meta?.pathKey || meta?.documentKey || meta?.scriptKey);
  const zoomLabel = `${Math.round(pageScale * 100)}%`;

  return (
    <>
      <GlobalStyle />
      <ToolsWindowShell data-maximized={maximized ? "true" : "false"} data-mode={mode} data-theme={theme}>
        <ToolsWindowTitleBar
          data-tauri-drag-region="true"
          onPointerDown={(event) => {
            if (event.button !== 0 || event.target?.closest?.("[data-tools-window-control]")) return;
            currentWindow.startDragging().catch(() => {});
          }}
        >
          <ToolsWindowIdentity data-tauri-drag-region="true">
            <strong>{isScript ? "Script" : "Document"}</strong>
            <span>{subtitle || title}</span>
          </ToolsWindowIdentity>
          <ToolsWindowDocumentActions data-tools-window-control="true">
            <ToolsWindowButton onClick={() => sendControl(TOOLS_WINDOW_CONTROL_CLOSE)} type="button">
              Close
            </ToolsWindowButton>
            {!isScript && metaIsHtmlDocument(meta) ? (
              <ToolsWindowButton onClick={() => void openHtmlInBrowser()} type="button">
                Browser
              </ToolsWindowButton>
            ) : null}
            {!isScript && meta?.dirty ? (
              <ToolsWindowButton disabled={busy} onClick={() => sendControl(TOOLS_WINDOW_CONTROL_DISCARD)} type="button">
                Discard changes
              </ToolsWindowButton>
            ) : null}
            <ToolsWindowButton
              data-danger="true"
              disabled={busy || readOnly || !meta?.canDelete}
              onClick={() => sendControl(TOOLS_WINDOW_CONTROL_DELETE)}
              type="button"
            >
              Delete
            </ToolsWindowButton>
            <ToolsWindowButton
              disabled={busy || readOnly || !text(localTitle)}
              onClick={() => sendControl(TOOLS_WINDOW_CONTROL_SAVE_LOCAL)}
              type="button"
            >
              {busy && meta?.state === "savingLocal" ? "Saving locally..." : "Save Local"}
            </ToolsWindowButton>
            {isScript ? (
              <ToolsWindowPrimaryButton
                disabled={busy || !text(localTitle)}
                onClick={() => sendControl(TOOLS_WINDOW_CONTROL_RUN)}
                type="button"
              >
                {meta?.running ? "Queue run" : "Run"}
              </ToolsWindowPrimaryButton>
            ) : (
              <ToolsWindowPrimaryButton
                disabled={busy || readOnly || !text(localTitle)}
                onClick={() => sendControl(TOOLS_WINDOW_CONTROL_SAVE_PUSH)}
                type="button"
              >
                {busy && meta?.state === "saving" ? "Saving..." : "Save"}
              </ToolsWindowPrimaryButton>
            )}
          </ToolsWindowDocumentActions>
          <ToolsWindowTopActions>
            <ToolsWindowTopButton data-tools-window-control="true" onClick={focusMain} type="button">Focus main</ToolsWindowTopButton>
            <ToolsWindowTopButton data-tools-window-control="true" onClick={returnToMain} type="button">Return</ToolsWindowTopButton>
            <ToolsWindowIconButton
              aria-label={maximized ? "Exit full screen" : "Enter full screen"}
              aria-pressed={maximized ? "true" : "false"}
              data-active={maximized ? "true" : undefined}
              data-tools-window-control="true"
              onClick={toggleMaximized}
              title={maximized ? "Exit full screen" : "Full screen"}
              type="button"
            >
              <span className={`codicon ${maximized ? "codicon-chrome-restore" : "codicon-chrome-maximize"}`} aria-hidden="true" />
            </ToolsWindowIconButton>
          </ToolsWindowTopActions>
        </ToolsWindowTitleBar>

        <ToolsWindowToolbar>
          <ToolsWindowThemeSwitch aria-label="Window theme">
            {TOOLS_WINDOW_THEMES.map((option) => (
              <ToolsWindowThemeButton
                aria-pressed={theme === option.id}
                data-active={theme === option.id ? "true" : "false"}
                key={option.id}
                onClick={() => setTheme(option.id)}
                type="button"
              >
                {option.label}
              </ToolsWindowThemeButton>
            ))}
          </ToolsWindowThemeSwitch>
          <ToolsWindowZoomControls aria-label="Page zoom">
            <ToolsWindowIconButton
              aria-label="Zoom out"
              data-tools-window-control="true"
              disabled={pageScale <= PAGE_MIN_SCALE + 0.001}
              onClick={zoomOut}
              type="button"
            >
              <span className="codicon codicon-zoom-out" aria-hidden="true" />
            </ToolsWindowIconButton>
            <ToolsWindowZoomValue onClick={resetZoom} title="Reset zoom" type="button">
              {zoomLabel}
            </ToolsWindowZoomValue>
            <ToolsWindowIconButton
              aria-label="Zoom in"
              data-tools-window-control="true"
              disabled={pageScale >= PAGE_MAX_SCALE - 0.001}
              onClick={zoomIn}
              type="button"
            >
              <span className="codicon codicon-zoom-in" aria-hidden="true" />
            </ToolsWindowIconButton>
          </ToolsWindowZoomControls>
          <ToolsWindowStatus data-tone={meta?.dirty ? "draft" : busy ? "busy" : "ready"}>
            {meta?.dirty ? "Draft" : busy ? "Working" : "Ready"}
          </ToolsWindowStatus>
        </ToolsWindowToolbar>

        {meta?.error || localError ? <ToolsWindowError role="alert">{String(meta?.error || localError)}</ToolsWindowError> : null}

        <ToolsWindowMain data-agent-dock={maximized ? "true" : "false"}>
          <ToolsWindowCanvas
            onWheel={handleCanvasWheel}
            ref={canvasRef}
            style={pageStyle(pageScale, isScript)}
          >
            {meta ? (
              <ToolsWindowPageStack>
                {pages.map((page) => (
                  <ToolsWindowPage data-first-page={page.firstPage ? "true" : "false"} key={page.index}>
                    {page.firstPage ? (
                      <ToolsWindowTitleInput
                        aria-label={isScript ? "Script name" : "Document name"}
                        onChange={(event) => {
                          const nextTitle = event.target.value;
                          setLocalTitle(nextTitle);
                          updateOwner({ title: nextTitle });
                        }}
                        placeholder={isScript ? "script_name" : "document_name"}
                        readOnly={readOnly}
                        value={localTitle}
                      />
                    ) : null}
                    <ToolsWindowBodyTextarea
                      aria-label={`${isScript ? "Script" : "Document"} content page ${page.index + 1}`}
                      onChange={(event) => {
                        const nextContent = replacePageContent(localContent, page, event.target.value);
                        setLocalContent(nextContent);
                        updateOwner({ content: nextContent });
                      }}
                      placeholder={page.firstPage ? (isScript ? "#!/usr/bin/env zsh" : "# Notes") : ""}
                      readOnly={readOnly}
                      rows={page.capacityRows}
                      spellCheck={false}
                      value={page.text}
                    />
                  </ToolsWindowPage>
                ))}
              </ToolsWindowPageStack>
            ) : (
              <ToolsWindowEmpty>
                <strong>Connecting to Tools</strong>
                <span>Waiting for the main Diff Forge window to provide the editor state.</span>
                <ToolsWindowTopButton onClick={requestMeta} type="button">Retry</ToolsWindowTopButton>
              </ToolsWindowEmpty>
            )}
          </ToolsWindowCanvas>
          {maximized ? (
            <ToolsWindowAgentDock>
              <ToolsWindowAgentDockHeader>
                <strong>Agent</strong>
                <span>Terminal orchestrator</span>
              </ToolsWindowAgentDockHeader>
              <ToolsWindowAgentDockStatus>
                <span />
                <strong>Companion</strong>
              </ToolsWindowAgentDockStatus>
              <ToolsWindowAgentDockActions>
                <ToolsWindowTopButton
                  data-tools-window-control="true"
                  onClick={() => sendAgentCompanion(TOOLS_WINDOW_AGENT_COMPANION_FOCUS)}
                  type="button"
                >
                  Focus
                </ToolsWindowTopButton>
                <ToolsWindowTopButton
                  data-tools-window-control="true"
                  onClick={() => sendAgentCompanion(TOOLS_WINDOW_AGENT_COMPANION_OPEN)}
                  type="button"
                >
                  Open
                </ToolsWindowTopButton>
              </ToolsWindowAgentDockActions>
            </ToolsWindowAgentDock>
          ) : null}
        </ToolsWindowMain>
      </ToolsWindowShell>
    </>
  );
}

const ToolsWindowShell = styled.main`
  --tools-window-bg: #121314;
  --tools-window-panel: rgba(28, 29, 31, 0.96);
  --tools-window-page-bg: #202124;
  --tools-window-page-border: rgba(232, 234, 237, 0.14);
  --tools-window-page-shadow: 0 24px 70px rgba(0, 0, 0, 0.34);
  --tools-window-text: #e8eaed;
  --tools-window-muted: rgba(232, 234, 237, 0.58);
  --tools-window-accent: #8ab4f8;
  --tools-window-accent-rgb: 138, 180, 248;
  --tools-window-danger: #f28b82;
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  border: 1px solid rgba(var(--tools-window-accent-rgb), 0.18);
  border-radius: 12px;
  color: var(--tools-window-text);
  background:
    radial-gradient(circle at 50% -14%, rgba(var(--tools-window-accent-rgb), 0.12), transparent 40%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.025), transparent 180px),
    var(--tools-window-bg);
  clip-path: inset(0 round 12px);

  &[data-theme="navy"] {
    --tools-window-bg: #06101d;
    --tools-window-panel: rgba(9, 20, 35, 0.94);
    --tools-window-page-bg: #07111f;
    --tools-window-page-border: rgba(96, 165, 250, 0.2);
    --tools-window-accent: #93c5fd;
    --tools-window-accent-rgb: 147, 197, 253;
  }

  &[data-theme="gold"] {
    --tools-window-bg: #050607;
    --tools-window-panel: rgba(13, 15, 18, 0.94);
    --tools-window-page-bg: #090805;
    --tools-window-page-border: rgba(255, 209, 102, 0.16);
    --tools-window-page-shadow: 0 24px 60px rgba(0, 0, 0, 0.28);
    --tools-window-text: #fff6df;
    --tools-window-muted: rgba(230, 236, 245, 0.58);
    --tools-window-accent: #ffd166;
    --tools-window-accent-rgb: 255, 209, 102;
  }

  &[data-theme="light"] {
    --tools-window-bg: #edf0f5;
    --tools-window-panel: rgba(255, 255, 255, 0.94);
    --tools-window-page-bg: #ffffff;
    --tools-window-page-border: rgba(20, 34, 52, 0.16);
    --tools-window-page-shadow: 0 24px 58px rgba(20, 34, 52, 0.16);
    --tools-window-text: #172033;
    --tools-window-muted: rgba(23, 32, 51, 0.58);
    --tools-window-accent: #315fbd;
    --tools-window-accent-rgb: 49, 95, 189;
  }
`;

const ToolsWindowTitleBar = styled.header`
  display: grid;
  grid-template-columns: minmax(140px, 0.48fr) minmax(240px, 1.6fr) max-content;
  min-width: 0;
  align-items: center;
  gap: 12px;
  padding: 10px 12px 8px;
  border-bottom: 1px solid rgba(var(--tools-window-accent-rgb), 0.11);
  background: rgba(0, 0, 0, 0.2);
  user-select: none;

  @media (max-width: 920px) {
    grid-template-columns: minmax(120px, 1fr) max-content;
  }
`;

const ToolsWindowIdentity = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;

  strong {
    color: var(--tools-window-text);
    font-size: 13px;
    font-weight: 850;
  }

  span {
    overflow: hidden;
    color: var(--tools-window-muted);
    font-size: 11px;
    font-weight: 720;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ToolsWindowTopActions = styled.div`
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  min-width: 0;
`;

const ToolsWindowTopButton = styled.button`
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(var(--tools-window-accent-rgb), 0.18);
  border-radius: 8px;
  color: var(--tools-window-text);
  background: rgba(var(--tools-window-accent-rgb), 0.08);
  font-size: 11px;
  font-weight: 820;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    outline: none;
    border-color: rgba(var(--tools-window-accent-rgb), 0.38);
    background: rgba(var(--tools-window-accent-rgb), 0.15);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

const ToolsWindowIconButton = styled(ToolsWindowTopButton)`
  display: inline-grid;
  width: 30px;
  min-width: 30px;
  padding: 0;
  place-items: center;

  &[data-active="true"] {
    border-color: rgba(var(--tools-window-accent-rgb), 0.42);
    background: rgba(var(--tools-window-accent-rgb), 0.18);
  }
`;

const ToolsWindowToolbar = styled.div`
  display: grid;
  grid-template-columns: max-content minmax(150px, 1fr) max-content;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-bottom: 1px solid rgba(var(--tools-window-accent-rgb), 0.1);

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
    justify-items: start;
  }
`;

const ToolsWindowDocumentActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  min-width: 0;
  max-width: 100%;

  @media (max-width: 920px) {
    grid-column: 1 / -1;
    grid-row: 2;
  }
`;

const ToolsWindowThemeSwitch = styled.div`
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(var(--tools-window-accent-rgb), 0.16);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.16);
`;

const ToolsWindowThemeButton = styled.button`
  min-height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 7px;
  color: var(--tools-window-muted);
  background: transparent;
  font-size: 11px;
  font-weight: 850;
  cursor: pointer;

  &[data-active="true"] {
    color: var(--tools-window-text);
    background: rgba(var(--tools-window-accent-rgb), 0.18);
  }
`;

const ToolsWindowStatus = styled.div`
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  padding: 0 10px;
  border: 1px solid rgba(var(--tools-window-accent-rgb), 0.16);
  border-radius: 999px;
  color: var(--tools-window-muted);
  font-size: 11px;
  font-weight: 850;
  text-transform: uppercase;

  &[data-tone="draft"] {
    color: #fde68a;
    border-color: rgba(253, 230, 138, 0.26);
    background: rgba(113, 63, 18, 0.28);
  }

  &[data-tone="busy"] {
    color: #bfdbfe;
    border-color: rgba(191, 219, 254, 0.24);
    background: rgba(30, 64, 175, 0.22);
  }
`;

const ToolsWindowZoomControls = styled.div`
  display: inline-flex;
  align-items: center;
  justify-self: center;
  gap: 6px;
  min-width: 0;
  padding: 3px;
  border: 1px solid rgba(var(--tools-window-accent-rgb), 0.14);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.14);

  @media (max-width: 760px) {
    justify-self: start;
  }
`;

const ToolsWindowZoomValue = styled.button`
  min-width: 58px;
  min-height: 28px;
  padding: 0 9px;
  border: 0;
  border-radius: 7px;
  color: var(--tools-window-muted);
  background: transparent;
  font-size: 11px;
  font-weight: 860;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    color: var(--tools-window-text);
    background: rgba(var(--tools-window-accent-rgb), 0.1);
    outline: none;
  }
`;

const ToolsWindowError = styled.div`
  margin: 8px 14px 0;
  padding: 9px 11px;
  border: 1px solid rgba(248, 113, 113, 0.28);
  border-radius: 8px;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.34);
  font-size: 12px;
  font-weight: 720;
`;

const ToolsWindowCanvas = styled.section`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 34px;
  overscroll-behavior: contain;
`;

const ToolsWindowMain = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  &[data-agent-dock="true"] {
    grid-template-columns: minmax(0, 1fr) clamp(230px, 18vw, 320px);
  }
`;

const ToolsWindowPageStack = styled.div`
  display: grid;
  justify-content: center;
  gap: 28px;
  padding-bottom: 34px;
`;

const ToolsWindowPage = styled.article`
  display: flex;
  width: var(--tools-window-page-width);
  min-height: var(--tools-window-page-height);
  flex-direction: column;
  box-sizing: border-box;
  padding:
    var(--tools-window-page-padding-top)
    var(--tools-window-page-padding-inline)
    var(--tools-window-page-padding-bottom);
  border: 1px solid var(--tools-window-page-border);
  border-radius: 8px;
  background: var(--tools-window-page-bg);
  box-shadow: var(--tools-window-page-shadow);
`;

const ToolsWindowTitleInput = styled.input`
  width: 100%;
  min-width: 0;
  margin: 0 0 24px;
  padding: 0 0 8px;
  border: 0;
  border-bottom: 1px solid rgba(var(--tools-window-accent-rgb), 0.15);
  color: var(--tools-window-text);
  background: transparent;
  font-family: Georgia, "Times New Roman", serif;
  font-size: var(--tools-window-title-font-size);
  font-weight: 800;
  letter-spacing: 0;

  &:focus {
    outline: none;
    border-bottom-color: rgba(var(--tools-window-accent-rgb), 0.44);
  }
`;

const ToolsWindowBodyTextarea = styled.textarea`
  width: 100%;
  min-width: 0;
  flex: 1 1 auto;
  resize: none;
  border: 0;
  color: var(--tools-window-text);
  background: transparent;
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: var(--tools-window-body-font-size);
  font-weight: 560;
  line-height: var(--tools-window-body-line-height);
  letter-spacing: 0;
  overflow: hidden;

  ${ToolsWindowShell}[data-mode="scripts"] & {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    font-weight: 650;
  }

  ${ToolsWindowShell}:not([data-theme="light"]) &::placeholder {
    color: rgba(230, 236, 245, 0.32);
  }

  &:focus {
    outline: none;
  }
`;

const ToolsWindowEmpty = styled.div`
  display: grid;
  min-height: 100%;
  place-content: center;
  gap: 9px;
  color: var(--tools-window-muted);
  text-align: center;

  strong {
    color: var(--tools-window-text);
    font-size: 15px;
  }
`;

const ToolsWindowAgentDock = styled.aside`
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  padding: 14px;
  border-left: 1px solid rgba(var(--tools-window-accent-rgb), 0.13);
  overflow: hidden auto;
  background:
    radial-gradient(circle at 50% 0%, rgba(var(--tools-window-accent-rgb), 0.12), transparent 42%),
    color-mix(in srgb, var(--tools-window-panel) 92%, black);
`;

const ToolsWindowAgentDockHeader = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;

  strong {
    color: var(--tools-window-text);
    font-size: 13px;
    font-weight: 900;
  }

  span {
    overflow: hidden;
    color: var(--tools-window-muted);
    font-size: 11px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ToolsWindowAgentDockStatus = styled.div`
  display: inline-flex;
  align-items: center;
  width: fit-content;
  gap: 8px;
  min-height: 28px;
  padding: 0 10px;
  border: 1px solid rgba(134, 239, 172, 0.24);
  border-radius: 999px;
  color: #bbf7d0;
  background: rgba(20, 83, 45, 0.2);
  font-size: 11px;
  font-weight: 850;

  span {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: #86efac;
    box-shadow: 0 0 0 4px rgba(134, 239, 172, 0.12);
  }
`;

const ToolsWindowAgentDockActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;

const ToolsWindowButton = styled.button`
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid rgba(var(--tools-window-accent-rgb), 0.18);
  border-radius: 8px;
  color: var(--tools-window-text);
  background: rgba(0, 0, 0, 0.14);
  font-size: 11px;
  font-weight: 840;
  cursor: pointer;

  &[data-danger="true"] {
    border-color: color-mix(in srgb, var(--tools-window-danger) 35%, transparent);
    color: color-mix(in srgb, var(--tools-window-danger) 82%, var(--tools-window-text));
  }

  &:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  &:not(:disabled):hover,
  &:not(:disabled):focus-visible {
    outline: none;
    border-color: rgba(var(--tools-window-accent-rgb), 0.36);
    background: rgba(var(--tools-window-accent-rgb), 0.12);
  }
`;

const ToolsWindowPrimaryButton = styled(ToolsWindowButton)`
  border-color: rgba(var(--tools-window-accent-rgb), 0.42);
  background: var(--tools-window-accent);
  color: #07111f;

  ${ToolsWindowShell}[data-theme="light"] & {
    color: #ffffff;
  }
`;

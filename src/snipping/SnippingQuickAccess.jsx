import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowForward } from "@styled-icons/material-rounded/ArrowForward";
import { Close } from "@styled-icons/material-rounded/Close";
import { CloudUpload } from "@styled-icons/material-rounded/CloudUpload";
import { ContentCopy } from "@styled-icons/material-rounded/ContentCopy";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { Gesture } from "@styled-icons/material-rounded/Gesture";
import { ModeEdit } from "@styled-icons/material-rounded/ModeEdit";
import { RadioButtonUnchecked } from "@styled-icons/material-rounded/RadioButtonUnchecked";
import { Rectangle } from "@styled-icons/material-rounded/Rectangle";
import { Send } from "@styled-icons/material-rounded/Send";
import { TextFields } from "@styled-icons/material-rounded/TextFields";
import { Undo } from "@styled-icons/material-rounded/Undo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { createGlobalStyle } from "styled-components";

const SNIPPING_CAPTURE_SAVED_EVENT = "forge-snipping-capture-saved";
const SNIPPING_SOURCE_UPDATED_EVENT = "forge-snip-source-updated";
const SNIPPING_LIVE_PREVIEW_EVENT = "forge-snip-live-preview";
const SNIPPING_LIVE_PREVIEW_THROTTLE_MS = 120;
const SNIPPING_LIVE_PREVIEW_MAX_WIDTH = 512;
const SNIPPING_ANNOTATION_TODO_EVENT = "diffforge:snipping-annotation-todo";

export const SNIPPING_TOAST_HASH = "#/snipping-toasts";
export const SNIPPING_EDITOR_HASH = "#/snipping-editor";
export const SNIPPING_FLOAT_HASH = "#/snipping-float";


const TOOL_OPTIONS = [
  { id: "pen", label: "Pen", Icon: Gesture },
  { id: "arrow", label: "Arrow", Icon: ArrowForward },
  { id: "rect", label: "Box", Icon: Rectangle },
  { id: "circle", label: "Circle", Icon: RadioButtonUnchecked },
  { id: "text", label: "Text", Icon: TextFields },
];

const COLOR_OPTIONS = ["#f8fafc", "#ef4444", "#f59e0b", "#22c55e", "#38bdf8", "#a855f7"];

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function assetLocalPath(asset) {
  return text(asset?.localPath || asset?.local_path || asset?.path);
}

function assetName(asset) {
  const localPath = assetLocalPath(asset);
  return text(asset?.name || asset?.filename || localPath.split(/[\\/]/u).pop(), "snip.png");
}

function assetPreviewUrl(asset) {
  const localPath = assetLocalPath(asset);
  if (!localPath) return "";
  try {
    return convertFileSrc(localPath);
  } catch {
    return "";
  }
}

function decodePathToken(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const binary = window.atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    try {
      return window.atob(padded);
    } catch {
      return "";
    }
  }
}

function pathFromHash(prefix) {
  const hash = window.location.hash || "";
  const raw = hash.startsWith(prefix) ? hash.slice(prefix.length).replace(/^\/+/u, "") : "";
  return decodePathToken(raw.split(/[?#]/u)[0]);
}

function pathsFromHash(prefix) {
  const decoded = pathFromHash(prefix);
  if (!decoded) return [];
  try {
    const parsed = JSON.parse(decoded);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => text(item)).filter(Boolean);
    }
  } catch {
    // Single-image routes encode a plain path.
  }
  return [decoded].filter(Boolean);
}

// WebKit blocks fetch() on asset: URLs ("Load failed"), so image bytes come
// through the backend as a data URL; this also keeps canvases untainted.
function loadImageElementFromPath(localPath) {
  if (!text(localPath)) {
    return Promise.reject(new Error("Image path is unavailable."));
  }

  return invoke("snipping_read_asset_data_url", { path: localPath })
    .then((dataUrl) => new Promise((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve({ image });
      image.onerror = () => reject(new Error("Unable to load image."));
      image.src = dataUrl;
    }));
}

async function renderAnnotatedImageDataUrl(localPath, annotations = []) {
  const { image } = await loadImageElementFromPath(localPath);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, width, height);
  annotations.forEach((annotation) => drawAnnotation(context, annotation));
  return canvas.toDataURL("image/png");
}

async function copySnipToClipboard(snip) {
  try {
    await invoke("diffforge_copy_asset_to_clipboard", {
      path: snip.localPath,
    });
    return "Copied image";
  } catch {
    // Fall through to web clipboard fallback.
  }

  const previewUrl = snip.previewUrl || assetPreviewUrl(snip);
  if (previewUrl && navigator?.clipboard?.write && window.ClipboardItem) {
    const response = await fetch(previewUrl);
    if (!response.ok) {
      throw new Error(`Unable to read snip image: ${response.status}`);
    }
    const sourceBlob = await response.blob();
    const mimeType = sourceBlob.type || "image/png";
    const blob = sourceBlob.type ? sourceBlob : new Blob([sourceBlob], { type: mimeType });
    await navigator.clipboard.write([
      new window.ClipboardItem({
        [mimeType]: blob,
      }),
    ]);
    return "Copied image";
  }

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(snip.localPath);
    return "Copied path";
  }

  throw new Error("Clipboard is not available in this webview.");
}

function useFloatingWindowBody(kind) {
  useEffect(() => {
    document.documentElement.dataset.snippingFloating = kind;
    document.body.dataset.snippingFloating = kind;
    return () => {
      delete document.documentElement.dataset.snippingFloating;
      delete document.body.dataset.snippingFloating;
    };
  }, [kind]);
}

// Legacy dock route: snip previews are standalone draggable windows
// (#/snipping-float) from the moment they are captured, so a leftover dock
// window from an older session simply closes itself.
export default function SnippingQuickAccess() {
  useEffect(() => {
    getCurrentWindow().close().catch(() => {});
  }, []);

  return <SnipFloatingGlobalStyle />;
}

/**
 * One snip preview = one draggable native window, from the moment it is
 * captured. Grab it anywhere to move it (no drag handle, no morphing into a
 * different surface); hovering reveals the actions.
 */
export function SnippingFloatWindow() {
  const initialPath = useMemo(() => pathFromHash(SNIPPING_FLOAT_HASH), []);
  // Annotating an original retargets this same window to the edited copy
  // (originals get copied exactly once; edited copies always save in place),
  // so the preview keeps showing the latest annotated view.
  const [localPath, setLocalPath] = useState(initialPath);
  const [imageVersion, setImageVersion] = useState(0);
  // While the annotation editor is open, it streams composited frames here so
  // edits are visible live; the autosaved file takes back over on each save.
  const [liveFrameUrl, setLiveFrameUrl] = useState("");
  const localPathRef = useRef(initialPath);
  const previewUrl = useMemo(() => {
    if (liveFrameUrl) return liveFrameUrl;
    const url = assetPreviewUrl({ localPath });
    if (!url || !imageVersion) return url;
    return `${url}${url.includes("?") ? "&" : "?"}v=${imageVersion}`;
  }, [imageVersion, liveFrameUrl, localPath]);
  const name = useMemo(() => assetName({ localPath }), [localPath]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const statusTimerRef = useRef(0);

  useFloatingWindowBody("float");

  useEffect(() => {
    localPathRef.current = localPath;
  }, [localPath]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(SNIPPING_SOURCE_UPDATED_EVENT, (event) => {
      if (disposed) return;
      const payload = event?.payload || {};
      const original = text(payload.originalPath || payload.original_path);
      const edited = text(payload.editedPath || payload.edited_path || payload.path);
      if (!edited) return;
      const current = localPathRef.current;
      if (current !== original && current !== edited) return;
      setLocalPath(edited);
      setImageVersion((version) => version + 1);
      // The saved file now contains everything the live frames showed.
      setLiveFrameUrl("");
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
      unlisten();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(SNIPPING_LIVE_PREVIEW_EVENT, (event) => {
      if (disposed) return;
      const payload = event?.payload || {};
      const sourcePath = text(payload.sourcePath || payload.source_path);
      const targetPath = text(payload.targetPath || payload.target_path);
      const dataUrl = text(payload.dataUrl || payload.data_url);
      if (!dataUrl) return;
      const current = localPathRef.current;
      if (current !== sourcePath && (!targetPath || current !== targetPath)) return;
      setLiveFrameUrl(dataUrl);
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
      unlisten();
    };
  }, []);

  const showStatus = useCallback((nextStatus) => {
    setStatus(nextStatus);
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
    }
    statusTimerRef.current = window.setTimeout(() => {
      statusTimerRef.current = 0;
      setStatus("");
    }, 2400);
  }, []);

  useEffect(() => () => {
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
    }
  }, []);

  const closeFloat = useCallback(() => {
    getCurrentWindow().close().catch(() => {});
  }, []);

  const dismissFloat = useCallback(() => {
    if (localPath) {
      invoke("snipping_dismiss_capture_toast", {
        request: { path: localPath },
      }).catch(() => {});
    }
    closeFloat();
  }, [closeFloat, localPath]);

  const runAction = useCallback(async (action) => {
    if (!localPath || busy) return;
    setBusy(true);

    try {
      if (action === "delete") {
        await invoke("diffforge_delete_untracked_asset", { path: localPath });
        dismissFloat();
      } else if (action === "copy") {
        const copyStatus = await copySnipToClipboard({ localPath, name, previewUrl });
        showStatus(copyStatus);
      } else if (action === "edit") {
        await invoke("snipping_open_annotation_editor", { path: localPath });
        showStatus("Editor opened");
      } else if (action === "upload") {
        await invoke("snipping_upload_untracked_asset", {
          request: {
            group: "snips",
            name,
            path: localPath,
          },
        });
        showStatus("Tracked for upload");
      }
    } catch (error) {
      showStatus(error?.message || String(error || "Action failed"));
    } finally {
      setBusy(false);
    }
  }, [busy, dismissFloat, localPath, name, previewUrl, showStatus]);

  // Manual double-press detection: the native window drag begins on the
  // first press, so a synthetic dblclick event is not reliable here.
  const lastPressAtRef = useRef(0);
  const beginDrag = useCallback((event) => {
    if (event.button !== 0 || event.target.closest("button")) return;
    // Stop WebKit from starting a selection highlight while the native
    // window drag takes over.
    event.preventDefault();

    const now = Date.now();
    if (now - lastPressAtRef.current < 360) {
      lastPressAtRef.current = 0;
      void runAction("edit");
      return;
    }
    lastPressAtRef.current = now;
    // Rust tracks the drag so releasing this preview over a drop target in
    // the main window (todo card, terminal pane) can consume it.
    invoke("snipping_preview_drag_started", {
      label: getCurrentWindow().label,
    }).catch(() => {});
    getCurrentWindow().startDragging().catch(() => {});
  }, [runAction]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeFloat();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeFloat]);

  return (
    <>
      <SnipFloatingGlobalStyle />
      <FloatWindowRoot
        data-busy={busy ? "true" : "false"}
        onDoubleClick={() => runAction("edit")}
        onMouseDown={beginDrag}
        title={`${name} — drag anywhere, double-click to annotate`}
      >
        {previewUrl ? (
          <img alt={name} draggable={false} src={previewUrl} />
        ) : (
          <span data-empty="true">Preview unavailable</span>
        )}
        <FloatCloseButton
          aria-label={`Dismiss ${name}`}
          onClick={dismissFloat}
          title="Dismiss"
          type="button"
        >
          <Close aria-hidden="true" />
        </FloatCloseButton>
        <FloatUploadButton
          aria-label={`Upload ${name}`}
          disabled={busy}
          onClick={() => runAction("upload")}
          title="Upload snip"
          type="button"
        >
          <CloudUpload aria-hidden="true" />
          <span>Upload</span>
        </FloatUploadButton>
        <FloatActionBar>
          <FloatActionButton
            aria-label={`Copy ${name}`}
            disabled={busy}
            onClick={() => runAction("copy")}
            title="Copy image"
            type="button"
          >
            <ContentCopy aria-hidden="true" />
          </FloatActionButton>
          <FloatActionButton
            aria-label={`Annotate ${name}`}
            disabled={busy}
            onClick={() => runAction("edit")}
            title="Annotate copy"
            type="button"
          >
            <ModeEdit aria-hidden="true" />
          </FloatActionButton>
          <FloatActionButton
            aria-label={`Delete ${name}`}
            data-danger="true"
            disabled={busy}
            onClick={() => runAction("delete")}
            title="Delete file"
            type="button"
          >
            <Delete aria-hidden="true" />
          </FloatActionButton>
        </FloatActionBar>
        {status ? <FloatStatusPill aria-live="polite">{status}</FloatStatusPill> : null}
      </FloatWindowRoot>
    </>
  );
}

const FloatWindowRoot = styled.main`
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 12px;
  background: rgba(9, 12, 18, 0.85);
  clip-path: inset(0 round 12px);
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;

  &:active {
    cursor: grabbing;
  }

  img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
  }

  > span[data-empty="true"] {
    color: rgba(248, 250, 252, 0.6);
    font-size: 11px;
    font-weight: 700;
  }

  /* All chrome (close, upload, action pill, status) stays invisible until
     the preview is hovered; the bare image is the whole resting surface. */
  > button,
  > div {
    opacity: 0;
    pointer-events: none;
    transition: opacity 140ms ease;
  }

  &:hover > button,
  &:hover > div {
    opacity: 1;
    pointer-events: auto;
  }
`;

const FloatCloseButton = styled.button`
  position: absolute;
  top: 6px;
  left: 6px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  color: #f8fafc;
  background: rgba(7, 10, 16, 0.85);
  cursor: pointer;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover {
    border-color: rgba(239, 107, 107, 0.5);
    background: rgba(76, 22, 26, 0.9);
  }
`;

const FloatUploadButton = styled.button`
  position: absolute;
  top: 6px;
  right: 6px;
  display: inline-flex;
  min-height: 22px;
  align-items: center;
  gap: 4px;
  padding: 0 9px;
  border: 1px solid rgba(125, 176, 255, 0.34);
  border-radius: 999px;
  color: #cfe3ff;
  background: rgba(7, 10, 16, 0.85);
  font-size: 10px;
  font-weight: 760;
  cursor: pointer;

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover:not(:disabled) {
    color: #06121f;
    background: #7db0ff;
    border-color: transparent;
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

const FloatActionBar = styled.div`
  position: absolute;
  bottom: 6px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  background: rgba(7, 10, 16, 0.88);
  transform: translateX(-50%);
`;

const FloatActionButton = styled.button`
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.82);
  background: transparent;
  cursor: pointer;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(:disabled) {
    color: #fff;
    background: rgba(125, 176, 255, 0.22);
  }

  &[data-danger="true"]:hover:not(:disabled) {
    color: #fff;
    background: rgba(214, 69, 69, 0.85);
  }

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`;

const FloatStatusPill = styled.span`
  position: absolute;
  top: 7px;
  left: 50%;
  max-width: calc(100% - 132px);
  overflow: hidden;
  padding: 3px 9px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.92);
  background: rgba(7, 10, 16, 0.88);
  font-size: 10px;
  font-weight: 740;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  white-space: nowrap;
`;

export function SnippingAnnotationEditorWindow() {
  const localPaths = useMemo(() => pathsFromHash(SNIPPING_EDITOR_HASH), []);
  const [activePath, setActivePath] = useState(() => localPaths[0] || "");
  const previewUrl = useMemo(() => assetPreviewUrl({ localPath: activePath }), [activePath]);
  const name = useMemo(() => assetName({ localPath: activePath }), [activePath]);
  const activeIndex = Math.max(0, localPaths.indexOf(activePath));
  const multiImage = localPaths.length > 1;
  const canvasRef = useRef(null);
  const imageRef = useRef(null);
  const draftRef = useRef(null);
  const drawingRef = useRef(false);
  const [tool, setTool] = useState("pen");
  const [color, setColor] = useState("#ef4444");
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [annotationsByPath, setAnnotationsByPath] = useState({});
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState("Loading image...");
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [todoDraft, setTodoDraft] = useState("");
  const [dispatchTargets, setDispatchTargets] = useState([]);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState("");
  const [targetThreadId, setTargetThreadId] = useState("");
  const annotations = annotationsByPath[activePath] || [];

  useEffect(() => {
    let disposed = false;
    invoke("snipping_dispatch_targets")
      .then((targets) => {
        if (disposed || !Array.isArray(targets)) return;
        setDispatchTargets(targets);
        setTargetWorkspaceId((current) => {
          if (current && targets.some((target) => target.workspaceId === current)) return current;
          return text(targets[0]?.workspaceId);
        });
      })
      .catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  const targetWorkspace = useMemo(
    () => dispatchTargets.find((target) => target.workspaceId === targetWorkspaceId) || null,
    [dispatchTargets, targetWorkspaceId],
  );

  useEffect(() => {
    setTargetThreadId((current) => {
      if (!current) return current;
      const threads = targetWorkspace?.threads || [];
      return threads.some((thread) => thread.threadId === current) ? current : "";
    });
  }, [targetWorkspace]);

  useFloatingWindowBody("editor");

  const updateActiveAnnotations = useCallback((updater) => {
    if (!activePath) return;
    setAnnotationsByPath((current) => {
      const currentAnnotations = current[activePath] || [];
      const nextAnnotations = typeof updater === "function" ? updater(currentAnnotations) : updater;
      return {
        ...current,
        [activePath]: Array.isArray(nextAnnotations) ? nextAnnotations : [],
      };
    });
  }, [activePath]);

  useEffect(() => {
    if (!previewUrl) {
      setStatus("No snip selected.");
      return undefined;
    }
    let disposed = false;
    let objectUrl = "";
    const image = new window.Image();
    imageRef.current = null;
    draftRef.current = null;
    drawingRef.current = false;
    setDraft(null);
    setCanvasSize({ width: 0, height: 0 });
    setStatus("Loading image...");
    image.onload = () => {
      if (disposed) return;
      imageRef.current = image;
      setCanvasSize({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
      setStatus(multiImage ? `Ready ${activeIndex + 1}/${localPaths.length}` : "Ready");
    };
    image.onerror = () => {
      if (!disposed) setStatus("Unable to load snip.");
    };

    // WebKit blocks fetch() on asset: URLs ("Load failed"); read the bytes
    // through the backend instead, which also keeps the canvas untainted.
    invoke("snipping_read_asset_data_url", { path: activePath })
      .then((dataUrl) => {
        if (disposed) return;
        image.src = dataUrl;
      })
      .catch((error) => {
        if (!disposed) setStatus(error?.message || String(error || "Unable to load snip."));
      });

    return () => {
      disposed = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeIndex, localPaths.length, multiImage, previewUrl]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !canvasSize.width || !canvasSize.height) return;
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    annotations.forEach((annotation) => drawAnnotation(context, annotation));
    if (draft) drawAnnotation(context, draft);
  }, [annotations, canvasSize.height, canvasSize.width, draft]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  const pointFromEvent = useCallback((event) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }, []);

  const beginDraw = useCallback((event) => {
    if (event.button !== 0 || !canvasSize.width || !canvasSize.height) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    if (tool === "text") {
      const value = window.prompt("Text annotation");
      if (!value?.trim()) return;
      updateActiveAnnotations((current) => [
        ...current,
        {
          type: "text",
          x: point.x,
          y: point.y,
          text: value.trim(),
          color,
          size: Math.max(14, strokeWidth * 5),
        },
      ]);
      setStatus("Text added");
      return;
    }
    const annotation = {
      type: tool,
      color,
      size: strokeWidth,
      startX: point.x,
      startY: point.y,
      endX: point.x,
      endY: point.y,
      points: tool === "pen" ? [point] : undefined,
    };
    draftRef.current = annotation;
    drawingRef.current = true;
    setDraft(annotation);
  }, [canvasSize.height, canvasSize.width, color, pointFromEvent, strokeWidth, tool, updateActiveAnnotations]);

  const updateDraw = useCallback((event) => {
    if (!drawingRef.current || !draftRef.current) return;
    const point = pointFromEvent(event);
    const nextDraft = draftRef.current.type === "pen"
      ? { ...draftRef.current, points: [...(draftRef.current.points || []), point], endX: point.x, endY: point.y }
      : { ...draftRef.current, endX: point.x, endY: point.y };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, [pointFromEvent]);

  const finishDraw = useCallback(() => {
    if (!drawingRef.current || !draftRef.current) return;
    const annotation = draftRef.current;
    drawingRef.current = false;
    draftRef.current = null;
    setDraft(null);
    updateActiveAnnotations((current) => [...current, annotation]);
    setStatus("Annotation added");
  }, [updateActiveAnnotations]);

  const undo = useCallback(() => {
    updateActiveAnnotations((current) => current.slice(0, -1));
    setStatus("Undone");
  }, [updateActiveAnnotations]);

  const copyCanvas = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setStatus("Copying image...");
    try {
      const imageDataUrl = canvas.toDataURL("image/png");
      await invoke("diffforge_copy_image_data_url_to_clipboard", {
        imageDataUrl,
      });
      setStatus("Copied annotated image");
    } catch (error) {
      setStatus(error?.message || String(error || "Unable to copy image."));
    }
  }, []);

  // Autosave chain: the first save of an original returns the new edited-copy
  // path; every later autosave for that original updates the same copy in
  // place. Re-opening the original in a fresh editor session starts a new
  // version. Edited copies always update in place.
  const autosaveTargetsRef = useRef({});
  const autosaveTimerRef = useRef(0);
  const livePreviewTimerRef = useRef(0);
  const livePreviewLastSentRef = useRef(0);

  // Streams the composited canvas to the snip preview window while drawing,
  // so edits are visible there live (downscaled JPEG frames, throttled).
  const emitLivePreviewFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activePath || !canvas.width || !canvas.height) return;

    let dataUrl = "";
    try {
      const scale = Math.min(1, SNIPPING_LIVE_PREVIEW_MAX_WIDTH / canvas.width);
      if (scale < 1) {
        const frame = document.createElement("canvas");
        frame.width = Math.max(1, Math.round(canvas.width * scale));
        frame.height = Math.max(1, Math.round(canvas.height * scale));
        frame.getContext("2d").drawImage(canvas, 0, 0, frame.width, frame.height);
        dataUrl = frame.toDataURL("image/jpeg", 0.72);
      } else {
        dataUrl = canvas.toDataURL("image/jpeg", 0.72);
      }
    } catch {
      return;
    }
    if (!dataUrl) return;

    emit(SNIPPING_LIVE_PREVIEW_EVENT, {
      kind: "snip_live_preview",
      sourcePath: activePath,
      targetPath: autosaveTargetsRef.current[activePath] || "",
      dataUrl,
    }).catch(() => {});
  }, [activePath]);

  useEffect(() => {
    if (!canvasSize.width || !canvasSize.height) return undefined;
    if (!draft && !(annotationsByPath[activePath] || []).length) return undefined;

    const elapsed = Date.now() - livePreviewLastSentRef.current;
    const delay = Math.max(16, SNIPPING_LIVE_PREVIEW_THROTTLE_MS - elapsed);
    if (livePreviewTimerRef.current) {
      window.clearTimeout(livePreviewTimerRef.current);
    }
    livePreviewTimerRef.current = window.setTimeout(() => {
      livePreviewTimerRef.current = 0;
      livePreviewLastSentRef.current = Date.now();
      emitLivePreviewFrame();
    }, delay);

    // Intentionally no cleanup on dependency change: the trailing frame must
    // still fire after the last stroke update settles.
    return undefined;
  }, [activePath, annotationsByPath, canvasSize.height, canvasSize.width, draft, emitLivePreviewFrame]);

  useEffect(() => () => {
    if (livePreviewTimerRef.current) {
      window.clearTimeout(livePreviewTimerRef.current);
    }
  }, []);
  const persistAnnotatedImage = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !activePath || !canvas.width || !canvas.height) return;
    if (!(annotationsByPath[activePath] || []).length) return;
    setStatus("Saving…");
    try {
      const imageDataUrl = canvas.toDataURL("image/png");
      const sourcePath = autosaveTargetsRef.current[activePath] || activePath;
      const result = await invoke("snipping_save_edited_untracked_asset", {
        request: {
          imageDataUrl,
          sourcePath,
        },
      });
      const savedPath = text(result?.local_path || result?.localPath || result?.path);
      if (savedPath) {
        autosaveTargetsRef.current[activePath] = savedPath;
      }
      setStatus("Saved");
    } catch (error) {
      setStatus(error?.message || String(error || "Unable to save annotated image."));
    }
  }, [activePath, annotationsByPath]);

  useEffect(() => {
    if (!(annotationsByPath[activePath] || []).length) return undefined;
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      void persistAnnotatedImage();
    }, 900);
    return () => window.clearTimeout(autosaveTimerRef.current);
  }, [activePath, annotationsByPath, persistAnnotatedImage]);

  const queueTodo = useCallback(async (event) => {
    event.preventDefault();
    const text = todoDraft.trim();
    if (!text) {
      setStatus("Describe the todo first");
      return;
    }
    if (!localPaths.length) {
      setStatus("No images are ready yet");
      return;
    }
    if (!targetWorkspaceId) {
      setStatus("Pick a workspace first");
      return;
    }
    setStatus(`Queueing todo with ${localPaths.length} image${localPaths.length === 1 ? "" : "s"}...`);
    try {
      const images = await Promise.all(localPaths.map(async (path, index) => {
        const imageDataUrl = activePath === path && canvasRef.current && canvasRef.current.width > 0 && canvasRef.current.height > 0
          ? canvasRef.current.toDataURL("image/png")
          : await renderAnnotatedImageDataUrl(path, annotationsByPath[path] || []);
        const imageName = assetName({ localPath: path });
        return {
          name: `${imageName.replace(/\.[^.]+$/u, "") || `image-${index + 1}`}-annotated.png`,
          src: imageDataUrl,
          type: "image/png",
        };
      }));
      await emit(SNIPPING_ANNOTATION_TODO_EVENT, {
        createdAt: new Date().toISOString(),
        images,
        name,
        sourceName: name,
        sourcePath: activePath,
        sourcePaths: localPaths,
        targetThreadId,
        text,
        workspaceId: targetWorkspaceId,
        workspaceName: String(targetWorkspace?.workspaceName || "").trim(),
      });
      setTodoDraft("");
      setStatus(`Queued todo with ${images.length} image${images.length === 1 ? "" : "s"}`);
    } catch (error) {
      setStatus(error?.message || String(error || "Unable to queue todo."));
    }
  }, [activePath, annotationsByPath, localPaths, name, targetThreadId, targetWorkspace, targetWorkspaceId, todoDraft]);

  const closeEditor = useCallback(() => {
    getCurrentWindow().close().catch(() => {});
  }, []);

  const savedState = status === "Saved" ? "saved" : status === "Saving…" ? "saving" : "idle";

  return (
    <>
      <SnipFloatingGlobalStyle />
      <EditorViewport>
        <EditorWindowRoot>
          <EditorTitleBar data-tauri-drag-region>
            <EditorTitleMeta data-tauri-drag-region>
              <strong data-tauri-drag-region>{name}</strong>
              {multiImage && (
                <span data-tauri-drag-region>{activeIndex + 1} / {localPaths.length}</span>
              )}
            </EditorTitleMeta>
            <EditorStatus data-state={savedState} data-tauri-drag-region>
              <i aria-hidden="true" />
              {savedState === "saved" ? "Saved" : savedState === "saving" ? "Saving" : status}
            </EditorStatus>
            <FloatingButton aria-label="Close editor" onClick={closeEditor} title="Close" type="button">
              <Close aria-hidden="true" />
            </FloatingButton>
          </EditorTitleBar>

          {multiImage && (
            <EditorBatchStrip aria-label="Selected images">
              {localPaths.map((path, index) => {
                const itemName = assetName({ localPath: path });
                const itemPreviewUrl = assetPreviewUrl({ localPath: path });
                const annotationCount = (annotationsByPath[path] || []).length;
                const active = path === activePath;
                return (
                  <EditorThumbButton
                    aria-label={`Edit ${itemName}`}
                    data-active={active ? "true" : "false"}
                    key={path}
                    onClick={() => setActivePath(path)}
                    title={itemName}
                    type="button"
                  >
                    {itemPreviewUrl ? <img alt="" draggable={false} src={itemPreviewUrl} /> : <span>{index + 1}</span>}
                    <strong>{index + 1}</strong>
                    {annotationCount > 0 && <small>{annotationCount}</small>}
                  </EditorThumbButton>
                );
              })}
            </EditorBatchStrip>
          )}

          <EditorStage>
            <canvas
              aria-label="Snip annotation canvas"
              onMouseDown={beginDraw}
              onMouseLeave={finishDraw}
              onMouseMove={updateDraw}
              onMouseUp={finishDraw}
              ref={canvasRef}
            />
            <EditorFloatingRail aria-label="Annotation tools">
              <EditorToolGroup>
                {TOOL_OPTIONS.map(({ id, label, Icon }) => (
                  <EditorToolButton aria-label={label} data-active={tool === id} key={id} onClick={() => setTool(id)} title={label} type="button">
                    <Icon aria-hidden="true" />
                  </EditorToolButton>
                ))}
              </EditorToolGroup>
              <EditorRailDivider aria-hidden="true" />
              <EditorToolGroup data-compact="true">
                {COLOR_OPTIONS.map((option) => (
                  <ColorButton aria-label={`Use ${option}`} data-active={color === option} key={option} onClick={() => setColor(option)} style={{ "--snip-color": option }} title={option} type="button" />
                ))}
              </EditorToolGroup>
              <EditorRailDivider aria-hidden="true" />
              <EditorToolGroup data-compact="true">
                {[3, 5, 9].map((size) => (
                  <SizeDotButton
                    aria-label={`Stroke size ${size}`}
                    data-active={strokeWidth === size ? "true" : "false"}
                    key={size}
                    onClick={() => setStrokeWidth(size)}
                    title={`Stroke ${size}`}
                    type="button"
                  >
                    <i aria-hidden="true" style={{ width: size + 3, height: size + 3 }} />
                  </SizeDotButton>
                ))}
              </EditorToolGroup>
              <EditorRailDivider aria-hidden="true" />
              <EditorToolGroup>
                <EditorToolButton aria-label="Undo" disabled={!annotations.length} onClick={undo} title="Undo" type="button">
                  <Undo aria-hidden="true" />
                </EditorToolButton>
                <EditorToolButton aria-label="Clear annotations" disabled={!annotations.length} onClick={() => { updateActiveAnnotations([]); setStatus("Cleared"); }} title="Clear" type="button">
                  <Delete aria-hidden="true" />
                </EditorToolButton>
                <EditorToolButton aria-label="Copy annotated image" onClick={copyCanvas} title="Copy image" type="button">
                  <ContentCopy aria-hidden="true" />
                </EditorToolButton>
              </EditorToolGroup>
            </EditorFloatingRail>
          </EditorStage>

          <EditorComposer onSubmit={queueTodo}>
            <EditorTargetSelect
              aria-label="Target workspace"
              onChange={(event) => setTargetWorkspaceId(event.target.value)}
              value={targetWorkspaceId}
            >
              {!dispatchTargets.length && <option value="">No workspaces</option>}
              {dispatchTargets.map((target) => (
                <option key={target.workspaceId} value={target.workspaceId}>
                  {target.workspaceName || target.workspaceId}
                </option>
              ))}
            </EditorTargetSelect>
            <EditorTargetSelect
              aria-label="Target terminal"
              disabled={!(targetWorkspace?.threads || []).length}
              onChange={(event) => setTargetThreadId(event.target.value)}
              value={targetThreadId}
            >
              <option value="">Any terminal</option>
              {(targetWorkspace?.threads || []).map((thread) => (
                <option key={thread.threadId} value={thread.threadId}>
                  {thread.label}
                </option>
              ))}
            </EditorTargetSelect>
            <input
              aria-label="Todo for coding agent"
              onChange={(event) => setTodoDraft(event.target.value)}
              placeholder="Circle an area, describe the fix, send it to an agent…"
              value={todoDraft}
            />
            <EditorSendButton aria-label="Queue todo with this image" disabled={!todoDraft.trim()} title="Queue todo with this image" type="submit">
              <Send aria-hidden="true" />
            </EditorSendButton>
          </EditorComposer>
        </EditorWindowRoot>
      </EditorViewport>
    </>
  );
}

function drawAnnotation(context, annotation) {
  if (!annotation) return;
  context.save();
  context.strokeStyle = annotation.color || "#ef4444";
  context.fillStyle = annotation.color || "#ef4444";
  context.lineWidth = annotation.size || 5;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (annotation.type === "pen") {
    const points = annotation.points || [];
    if (points.length < 2) {
      context.beginPath();
      context.arc(annotation.startX, annotation.startY, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    } else {
      context.beginPath();
      context.moveTo(points[0].x, points[0].y);
      points.slice(1).forEach((point) => context.lineTo(point.x, point.y));
      context.stroke();
    }
  } else if (annotation.type === "rect") {
    const x = Math.min(annotation.startX, annotation.endX);
    const y = Math.min(annotation.startY, annotation.endY);
    const width = Math.abs(annotation.endX - annotation.startX);
    const height = Math.abs(annotation.endY - annotation.startY);
    context.strokeRect(x, y, width, height);
  } else if (annotation.type === "circle") {
    const x = (annotation.startX + annotation.endX) / 2;
    const y = (annotation.startY + annotation.endY) / 2;
    const radiusX = Math.abs(annotation.endX - annotation.startX) / 2;
    const radiusY = Math.abs(annotation.endY - annotation.startY) / 2;
    context.beginPath();
    context.ellipse(x, y, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.stroke();
  } else if (annotation.type === "arrow") {
    drawArrow(context, annotation.startX, annotation.startY, annotation.endX, annotation.endY, annotation.size || 5);
  } else if (annotation.type === "text") {
    // Text sits on a solid card so it stays readable for humans and for AI
    // agents consuming the annotated image.
    const fontSize = annotation.size || 24;
    context.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
    const paddingX = Math.round(fontSize * 0.5);
    const paddingY = Math.round(fontSize * 0.32);
    const textWidth = context.measureText(annotation.text).width;
    const boxX = annotation.x - paddingX;
    const boxY = annotation.y - fontSize - paddingY;
    const boxWidth = textWidth + paddingX * 2;
    const boxHeight = fontSize + paddingY * 2;
    const radius = Math.min(10, boxHeight / 3);
    context.beginPath();
    if (typeof context.roundRect === "function") {
      context.roundRect(boxX, boxY, boxWidth, boxHeight, radius);
    } else {
      context.rect(boxX, boxY, boxWidth, boxHeight);
    }
    context.fillStyle = "rgba(9, 11, 16, 0.88)";
    context.fill();
    context.lineWidth = Math.max(2, fontSize / 12);
    context.strokeStyle = annotation.color || "#ef4444";
    context.stroke();
    context.fillStyle = "#f8fafc";
    context.textBaseline = "alphabetic";
    context.fillText(annotation.text, annotation.x, annotation.y - paddingY / 2);
  }

  context.restore();
}

function drawArrow(context, startX, startY, endX, endY, size) {
  const angle = Math.atan2(endY - startY, endX - startX);
  const headLength = Math.max(16, size * 4);
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.stroke();
  context.beginPath();
  context.moveTo(endX, endY);
  context.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
  context.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();
}

const SnipFloatingGlobalStyle = createGlobalStyle`
  html,
  body,
  #app {
    width: 100%;
    height: 100%;
    margin: 0;
    overflow: hidden;
    background: transparent !important;
    user-select: none;
  }

`;

const FloatingButton = styled.button`
  display: inline-grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  color: #f8fafc;
  background: rgba(7, 10, 16, 0.72);
  cursor: pointer;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.36);
    background: rgba(15, 23, 36, 0.94);
  }

  &[data-danger="true"] {
    color: #ffd4d4;
  }

  &[data-danger="true"]:hover:not(:disabled) {
    border-color: rgba(239, 107, 107, 0.48);
    background: rgba(76, 22, 26, 0.94);
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

// Transparent gutter so the rounded chrome and its CSS shadow render fully
// inside the (shadowless, transparent) native window.
const EditorViewport = styled.div`
  width: 100vw;
  height: 100vh;
  padding: 12px;
  background: transparent;
`;

const EditorWindowRoot = styled.main`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 18px;
  background: rgba(8, 10, 15, 0.97);
  color: #f8fafc;
  clip-path: inset(0 round 18px);
  box-shadow:
    0 28px 80px rgba(0, 0, 0, 0.55),
    0 4px 18px rgba(0, 0, 0, 0.4);
  font-family:
    Inter,
    ui-sans-serif,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
`;

const EditorTitleBar = styled.header`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  min-height: 40px;
  padding: 7px 10px 7px 14px;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
`;

const EditorTitleMeta = styled.div`
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 8px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 12.5px;
    font-weight: 800;
    letter-spacing: 0.01em;
  }

  span {
    flex: none;
    color: rgba(248, 250, 252, 0.5);
    font-size: 11px;
    font-weight: 750;
  }
`;

// Auto-save indicator: a quiet dot + word, never a button.
const EditorStatus = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: rgba(248, 250, 252, 0.55);
  font-size: 11px;
  font-weight: 750;
  white-space: nowrap;

  i {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.7);
  }

  &[data-state="saved"] {
    color: rgba(187, 247, 208, 0.85);
  }

  &[data-state="saved"] i {
    background: #4ade80;
  }

  &[data-state="saving"] i {
    background: #60a5fa;
  }
`;

// Thin, horizontally scrollable strip of the other selected images.
const EditorBatchStrip = styled.div`
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  padding: 4px 12px 8px;
  scrollbar-width: thin;
`;

const EditorThumbButton = styled.button`
  position: relative;
  flex: 0 0 auto;
  width: 54px;
  height: 32px;
  overflow: hidden;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 7px;
  color: #f8fafc;
  background: rgba(255, 255, 255, 0.055);
  cursor: pointer;

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  > span {
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    color: rgba(248, 250, 252, 0.62);
    font-size: 11px;
    font-weight: 850;
  }

  strong,
  small {
    position: absolute;
    display: inline-grid;
    min-width: 14px;
    height: 14px;
    place-items: center;
    border-radius: 999px;
    font-size: 8px;
    font-weight: 900;
    line-height: 1;
  }

  strong {
    left: 3px;
    bottom: 3px;
    color: rgba(248, 250, 252, 0.92);
    background: rgba(7, 10, 16, 0.78);
  }

  small {
    top: 3px;
    right: 3px;
    color: rgba(204, 251, 241, 0.96);
    background: rgba(13, 148, 136, 0.76);
  }

  &[data-active="true"],
  &:hover,
  &:focus-visible {
    border-color: rgba(147, 197, 253, 0.56);
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.18);
  }
`;

// The canvas owns the whole stage; the tools float over it as a glass pill
// hugging the artwork's left edge — annotation controls live "around the
// thing", not in app chrome.
const EditorStage = styled.section`
  position: relative;
  display: grid;
  flex: 1;
  min-width: 0;
  min-height: 0;
  place-items: center;
  overflow: hidden;
  padding: 14px 14px 14px 68px;
  background:
    radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.1), transparent 42%),
    #05070b;

  canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    border-radius: 10px;
    box-shadow:
      0 24px 70px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(230, 236, 245, 0.08);
    cursor: crosshair;
  }
`;

const EditorFloatingRail = styled.nav`
  position: absolute;
  left: 12px;
  top: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-height: calc(100% - 24px);
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 7px;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 999px;
  background: rgba(10, 13, 19, 0.86);
  backdrop-filter: blur(14px);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
  transform: translateY(-50%);
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const EditorRailDivider = styled.span`
  width: 18px;
  height: 1px;
  flex: none;
  background: rgba(230, 236, 245, 0.12);
`;

const EditorToolGroup = styled.div`
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  gap: 5px;

  &[data-compact="true"] {
    gap: 6px;
  }
`;

const EditorToolButton = styled.button`
  display: inline-grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 0;
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.78);
  background: transparent;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;

  svg {
    width: 17px;
    height: 17px;
  }

  &:hover:not(:disabled) {
    color: #ffffff;
    background: rgba(230, 236, 245, 0.1);
  }

  &[data-active="true"] {
    color: #ffffff;
    background: rgba(59, 130, 246, 0.42);
    box-shadow: 0 0 0 1px rgba(147, 197, 253, 0.38);
  }

  &:disabled {
    cursor: default;
    opacity: 0.35;
  }
`;

const ColorButton = styled.button`
  width: 16px;
  height: 16px;
  flex: none;
  border: 1px solid rgba(230, 236, 245, 0.25);
  border-radius: 999px;
  background: var(--snip-color);
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;

  &:hover {
    transform: scale(1.15);
  }

  &[data-active="true"] {
    box-shadow:
      0 0 0 2px rgba(8, 10, 15, 0.95),
      0 0 0 4px var(--snip-color);
    transform: scale(1.05);
  }
`;

const SizeDotButton = styled.button`
  display: inline-grid;
  width: 22px;
  height: 22px;
  flex: none;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;

  i {
    display: block;
    border-radius: 999px;
    background: rgba(248, 250, 252, 0.55);
    transition: background 120ms ease;
  }

  &:hover i {
    background: rgba(248, 250, 252, 0.85);
  }

  &[data-active="true"] {
    background: rgba(59, 130, 246, 0.32);
  }

  &[data-active="true"] i {
    background: #ffffff;
  }
`;

const EditorTargetSelect = styled.select`
  height: 32px;
  max-width: 150px;
  padding: 0 9px;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.85);
  background: rgba(230, 236, 245, 0.06);
  font-size: 11px;
  font-weight: 750;
  outline: none;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus {
    border-color: rgba(147, 197, 253, 0.4);
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

const EditorComposer = styled.form`
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  padding: 10px 12px 12px;
  background: transparent;

  input {
    flex: 1;
    min-width: 0;
    height: 36px;
    padding: 0 14px;
    border: 1px solid rgba(230, 236, 245, 0.12);
    border-radius: 999px;
    color: #f8fafc;
    background: rgba(230, 236, 245, 0.06);
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    outline: none;
  }

  input::placeholder {
    color: rgba(248, 250, 252, 0.4);
  }

  input:focus {
    border-color: rgba(147, 197, 253, 0.45);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
  }
`;

const EditorSendButton = styled.button`
  display: inline-grid;
  width: 36px;
  height: 36px;
  flex: none;
  place-items: center;
  border: 1px solid rgba(147, 197, 253, 0.34);
  border-radius: 999px;
  color: #e0f2fe;
  background: rgba(37, 99, 235, 0.32);
  cursor: pointer;
  transition: background 120ms ease;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(147, 197, 253, 0.56);
    background: rgba(37, 99, 235, 0.5);
  }

  &:disabled {
    cursor: default;
    opacity: 0.4;
  }
`;

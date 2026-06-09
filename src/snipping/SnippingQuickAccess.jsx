import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowForward } from "@styled-icons/material-rounded/ArrowForward";
import { Close } from "@styled-icons/material-rounded/Close";
import { ContentCopy } from "@styled-icons/material-rounded/ContentCopy";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { Gesture } from "@styled-icons/material-rounded/Gesture";
import { LibraryAddCheck } from "@styled-icons/material-rounded/LibraryAddCheck";
import { ModeEdit } from "@styled-icons/material-rounded/ModeEdit";
import { PushPin } from "@styled-icons/material-rounded/PushPin";
import { RadioButtonUnchecked } from "@styled-icons/material-rounded/RadioButtonUnchecked";
import { Rectangle } from "@styled-icons/material-rounded/Rectangle";
import { Save } from "@styled-icons/material-rounded/Save";
import { Send } from "@styled-icons/material-rounded/Send";
import { TextFields } from "@styled-icons/material-rounded/TextFields";
import { Undo } from "@styled-icons/material-rounded/Undo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { createGlobalStyle } from "styled-components";

const SNIPPING_CAPTURE_SAVED_EVENT = "forge-snipping-capture-saved";
const SNIPPING_ANNOTATION_TODO_EVENT = "diffforge:snipping-annotation-todo";
const SNIP_TOAST_LIMIT = 6;

export const SNIPPING_TOAST_HASH = "#/snipping-toasts";
export const SNIPPING_PIN_HASH = "#/snipping-pin";
export const SNIPPING_EDITOR_HASH = "#/snipping-editor";

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

function loadImageElementFromPath(localPath) {
  const previewUrl = assetPreviewUrl({ localPath });
  if (!previewUrl) {
    return Promise.reject(new Error("Image path is unavailable."));
  }

  return fetch(previewUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`Unable to read image: ${response.status}`);
      return response.blob();
    })
    .then((blob) => new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const image = new window.Image();
      image.onload = () => resolve({ image, objectUrl });
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Unable to load image."));
      };
      image.src = objectUrl;
    }));
}

async function renderAnnotatedImageDataUrl(localPath, annotations = []) {
  const { image, objectUrl } = await loadImageElementFromPath(localPath);
  try {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, width, height);
    annotations.forEach((annotation) => drawAnnotation(context, annotation));
    return canvas.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function snipToastFromPayload(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const item = source.item && typeof source.item === "object" ? source.item : source;
  const localPath = assetLocalPath(item) || assetLocalPath(source);
  if (!localPath) return null;

  const name = assetName(item);
  const savedAtMs = Number(source.savedAtMs || source.saved_at_ms || Date.now());
  const id = text(item.id || item.untrackedId || item.untracked_id, `snip-${savedAtMs}-${localPath}`);
  return {
    id,
    localPath,
    name,
    originalPath: text(source.originalPath || source.original_path),
    previewUrl: assetPreviewUrl({ ...item, localPath }),
    savedAtMs,
    status: "",
    width: Number(source.width || item.width || 0),
    height: Number(source.height || item.height || 0),
  };
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

function setTransientStatus(setSnips, snipId, status) {
  setSnips((current) => current.map((snip) => (
    snip.id === snipId ? { ...snip, status } : snip
  )));
  window.setTimeout(() => {
    setSnips((current) => current.map((snip) => (
      snip.id === snipId && snip.status === status ? { ...snip, status: "" } : snip
    )));
  }, 1700);
}

export default function SnippingQuickAccess() {
  const [snips, setSnips] = useState([]);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const hadSnipsRef = useRef(false);

  useFloatingWindowBody("quick-access");

  useEffect(() => {
    invoke("snipping_recent_capture_toasts")
      .then((result) => {
        const items = Array.isArray(result?.items) ? result.items : [];
        const nextSnips = items
          .map(snipToastFromPayload)
          .filter(Boolean)
          .slice(0, SNIP_TOAST_LIMIT);
        if (nextSnips.length) {
          setSnips(nextSnips);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten = null;

    listen(SNIPPING_CAPTURE_SAVED_EVENT, (event) => {
      if (disposed) return;
      const snip = snipToastFromPayload(event?.payload);
      if (!snip) return;
      setSnips((current) => [
        snip,
        ...current.filter((item) => item.localPath !== snip.localPath),
      ].slice(0, SNIP_TOAST_LIMIT));
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
      if (typeof unlisten === "function") {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    if (snips.length) {
      hadSnipsRef.current = true;
      return;
    }
    if (hadSnipsRef.current) {
      getCurrentWindow().close().catch(() => {});
    }
  }, [snips.length]);

  const dismissSnip = useCallback((snipId) => {
    setSnips((current) => current.filter((snip) => snip.id !== snipId));
  }, []);

  const runSnipAction = useCallback(async (snip, action) => {
    if (!snip?.id) return;
    setBusyIds((current) => {
      const next = new Set(current);
      next.add(snip.id);
      return next;
    });
    setSnips((current) => current.map((item) => (
      item.id === snip.id ? { ...item, status: "" } : item
    )));

    try {
      if (action === "delete") {
        await invoke("diffforge_delete_untracked_asset", { path: snip.localPath });
        dismissSnip(snip.id);
      } else if (action === "copy") {
        const status = await copySnipToClipboard(snip);
        setTransientStatus(setSnips, snip.id, status);
      } else if (action === "edit") {
        await invoke("snipping_open_annotation_editor", { path: snip.localPath });
        setTransientStatus(setSnips, snip.id, "Editor opened");
      } else if (action === "pin") {
        await invoke("snipping_open_pinned_window", { path: snip.localPath });
        setTransientStatus(setSnips, snip.id, "Pinned");
      } else if (action === "upload") {
        await invoke("snipping_upload_untracked_asset", {
          request: {
            group: "snips",
            name: snip.name,
            path: snip.localPath,
          },
        });
        setTransientStatus(setSnips, snip.id, "Tracked for upload");
      }
    } catch (error) {
      setTransientStatus(setSnips, snip.id, error?.message || String(error || "Action failed"));
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(snip.id);
        return next;
      });
    }
  }, [dismissSnip]);

  if (!snips.length) {
    return <SnipFloatingGlobalStyle />;
  }

  return (
    <>
      <SnipFloatingGlobalStyle />
      <QuickAccessRoot aria-label="Snip quick access" aria-live="polite">
        {snips.map((snip) => {
          const busy = busyIds.has(snip.id);
          const dimensions = snip.width > 0 && snip.height > 0
            ? `${Math.round(snip.width)} x ${Math.round(snip.height)}`
            : "";

          return (
            <QuickAccessCard data-busy={busy ? "true" : "false"} key={snip.id}>
              <QuickAccessPreview>
                {snip.previewUrl ? (
                  <img alt={snip.name} draggable={false} src={snip.previewUrl} />
                ) : (
                  <span>{snip.name}</span>
                )}
              </QuickAccessPreview>

              <QuickAccessBody>
                <strong>{snip.name}</strong>
                <span>{snip.status || dimensions || "Untracked snip"}</span>
              </QuickAccessBody>

              <QuickAccessActions>
                <QuickAccessButton aria-label={`Copy ${snip.name}`} disabled={busy} onClick={() => runSnipAction(snip, "copy")} title="Copy image" type="button">
                  <ContentCopy aria-hidden="true" />
                </QuickAccessButton>
                <QuickAccessButton aria-label={`Edit ${snip.name}`} disabled={busy} onClick={() => runSnipAction(snip, "edit")} title="Annotate copy" type="button">
                  <ModeEdit aria-hidden="true" />
                </QuickAccessButton>
                <QuickAccessButton aria-label={`Pin ${snip.name}`} disabled={busy} onClick={() => runSnipAction(snip, "pin")} title="Float screenshot" type="button">
                  <PushPin aria-hidden="true" />
                </QuickAccessButton>
                <QuickAccessButton aria-label={`Upload ${snip.name}`} disabled={busy} onClick={() => runSnipAction(snip, "upload")} title="Track and upload" type="button">
                  <LibraryAddCheck aria-hidden="true" />
                </QuickAccessButton>
                <QuickAccessButton aria-label={`Delete ${snip.name}`} data-danger="true" disabled={busy} onClick={() => runSnipAction(snip, "delete")} title="Delete file" type="button">
                  <Delete aria-hidden="true" />
                </QuickAccessButton>
              </QuickAccessActions>

              <QuickAccessDismissButton aria-label={`Dismiss ${snip.name}`} disabled={busy} onClick={() => dismissSnip(snip.id)} title="Dismiss" type="button">
                <Close aria-hidden="true" />
              </QuickAccessDismissButton>
            </QuickAccessCard>
          );
        })}
      </QuickAccessRoot>
    </>
  );
}

export function SnippingPinnedWindow() {
  const localPath = useMemo(() => pathFromHash(SNIPPING_PIN_HASH), []);
  const previewUrl = useMemo(() => assetPreviewUrl({ localPath }), [localPath]);
  const name = useMemo(() => assetName({ localPath }), [localPath]);
  const [status, setStatus] = useState("");

  useFloatingWindowBody("pinned");

  const runAction = useCallback(async (action) => {
    try {
      if (action === "copy") {
        setStatus(await copySnipToClipboard({ localPath, name, previewUrl }));
      } else if (action === "edit") {
        await invoke("snipping_open_annotation_editor", { path: localPath });
        setStatus("Editor opened");
      } else if (action === "close") {
        await getCurrentWindow().close();
      }
    } catch (error) {
      setStatus(error?.message || String(error || "Action failed"));
    }
  }, [localPath, name, previewUrl]);

  return (
    <>
      <SnipFloatingGlobalStyle />
      <PinnedWindowRoot>
        <PinnedDragBar data-tauri-drag-region>
          <strong>{name}</strong>
          {status && <span>{status}</span>}
        </PinnedDragBar>
        <PinnedImageFrame>
          {previewUrl ? <img alt={name} draggable={false} src={previewUrl} /> : <span>No snip selected</span>}
        </PinnedImageFrame>
        <FloatingToolbar>
          <FloatingButton aria-label="Copy pinned snip" onClick={() => runAction("copy")} title="Copy" type="button">
            <ContentCopy aria-hidden="true" />
          </FloatingButton>
          <FloatingButton aria-label="Edit pinned snip" onClick={() => runAction("edit")} title="Edit" type="button">
            <ModeEdit aria-hidden="true" />
          </FloatingButton>
          <FloatingButton aria-label="Close pinned snip" onClick={() => runAction("close")} title="Close" type="button">
            <Close aria-hidden="true" />
          </FloatingButton>
        </FloatingToolbar>
      </PinnedWindowRoot>
    </>
  );
}

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
  const annotations = annotationsByPath[activePath] || [];

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

    fetch(previewUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`Unable to read snip: ${response.status}`);
        return response.blob();
      })
      .then((blob) => {
        if (disposed) return;
        objectUrl = URL.createObjectURL(blob);
        image.src = objectUrl;
      })
      .catch((error) => {
        if (!disposed) setStatus(error?.message || "Unable to load snip.");
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

  const saveCopy = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !activePath) return;
    setStatus("Saving edited copy...");
    try {
      const imageDataUrl = canvas.toDataURL("image/png");
      await invoke("snipping_save_edited_untracked_asset", {
        request: {
          imageDataUrl,
          sourcePath: activePath,
        },
      });
      setStatus("Saved edited copy");
    } catch (error) {
      setStatus(error?.message || String(error || "Unable to save edited copy."));
    }
  }, [activePath]);

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
        text,
      });
      setTodoDraft("");
      setStatus(`Queued todo with ${images.length} image${images.length === 1 ? "" : "s"}`);
    } catch (error) {
      setStatus(error?.message || String(error || "Unable to queue todo."));
    }
  }, [activePath, annotationsByPath, localPaths, name, todoDraft]);

  const closeEditor = useCallback(() => {
    getCurrentWindow().close().catch(() => {});
  }, []);

  return (
    <>
      <SnipFloatingGlobalStyle />
      <EditorWindowRoot>
        <EditorTitleBar data-tauri-drag-region>
          <div>
            <strong>{multiImage ? "Annotate Selection" : "Annotate"}</strong>
            <span>{multiImage ? `${name} · ${activeIndex + 1}/${localPaths.length}` : name}</span>
          </div>
          <EditorStatus>{status}</EditorStatus>
          <FloatingButton aria-label="Close editor" onClick={closeEditor} title="Close" type="button">
            <Close aria-hidden="true" />
          </FloatingButton>
        </EditorTitleBar>

        <EditorControlsStack>
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
          <EditorToolbar>
            <EditorToolGroup>
              {TOOL_OPTIONS.map(({ id, label, Icon }) => (
                <EditorToolButton aria-label={label} data-active={tool === id} key={id} onClick={() => setTool(id)} title={label} type="button">
                  <Icon aria-hidden="true" />
                </EditorToolButton>
              ))}
            </EditorToolGroup>
            <EditorToolGroup>
              {COLOR_OPTIONS.map((option) => (
                <ColorButton aria-label={`Use ${option}`} data-active={color === option} key={option} onClick={() => setColor(option)} style={{ "--snip-color": option }} title={option} type="button" />
              ))}
            </EditorToolGroup>
            <StrokeControl>
              <span>Stroke</span>
              <input max="14" min="2" onChange={(event) => setStrokeWidth(Number(event.target.value) || 5)} type="range" value={strokeWidth} />
            </StrokeControl>
            <EditorToolButton aria-label="Undo" disabled={!annotations.length} onClick={undo} title="Undo" type="button">
              <Undo aria-hidden="true" />
            </EditorToolButton>
            <EditorToolButton aria-label="Clear annotations" disabled={!annotations.length} onClick={() => { updateActiveAnnotations([]); setStatus("Cleared"); }} title="Clear" type="button">
              <Delete aria-hidden="true" />
            </EditorToolButton>
            <EditorToolButton aria-label="Copy annotated image" onClick={copyCanvas} title="Copy image" type="button">
              <ContentCopy aria-hidden="true" />
            </EditorToolButton>
            <EditorSaveButton onClick={saveCopy} type="button">
              <Save aria-hidden="true" />
              <span>Save copy</span>
            </EditorSaveButton>
          </EditorToolbar>
        </EditorControlsStack>

        <EditorCanvasStage>
          <canvas
            aria-label="Snip annotation canvas"
            onMouseDown={beginDraw}
            onMouseLeave={finishDraw}
            onMouseMove={updateDraw}
            onMouseUp={finishDraw}
            ref={canvasRef}
          />
        </EditorCanvasStage>
        <EditorTodoComposer onSubmit={queueTodo}>
          <input
            aria-label="Todo for coding agent"
            onChange={(event) => setTodoDraft(event.target.value)}
            placeholder="Circle an area, describe the fix, send it to a coding agent..."
            value={todoDraft}
          />
          <EditorTodoSendButton disabled={!todoDraft.trim()} title="Queue todo with this image" type="submit">
            <Send aria-hidden="true" />
            <span>Queue todo</span>
          </EditorTodoSendButton>
        </EditorTodoComposer>
      </EditorWindowRoot>
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
    context.font = `800 ${annotation.size || 24}px Inter, system-ui, sans-serif`;
    context.lineWidth = Math.max(3, (annotation.size || 24) / 8);
    context.strokeStyle = "rgba(0, 0, 0, 0.45)";
    context.strokeText(annotation.text, annotation.x, annotation.y);
    context.fillStyle = annotation.color || "#ef4444";
    context.fillText(annotation.text, annotation.x, annotation.y);
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

  body[data-snipping-floating="editor"],
  body[data-snipping-floating="pinned"] {
    background: #070a10 !important;
  }
`;

const QuickAccessRoot = styled.aside`
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  flex-direction: column-reverse;
  align-items: flex-start;
  justify-content: flex-start;
  gap: 10px;
  padding: 10px;
  overflow: hidden;
  pointer-events: none;
`;

const QuickAccessCard = styled.article`
  position: relative;
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  align-items: center;
  width: 292px;
  min-height: 92px;
  padding: 8px;
  gap: 10px;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 16px;
  background: rgba(9, 12, 18, 0.82);
  box-shadow:
    0 18px 42px rgba(0, 0, 0, 0.34),
    0 0 0 1px rgba(0, 0, 0, 0.2);
  pointer-events: auto;
  transform: translateX(0);
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    transform 150ms ease;

  &:hover,
  &:focus-within {
    border-color: rgba(255, 255, 255, 0.34);
    box-shadow:
      0 22px 52px rgba(0, 0, 0, 0.44),
      0 0 0 1px rgba(255, 255, 255, 0.09);
    transform: translateX(2px);
  }
`;

const QuickAccessPreview = styled.div`
  width: 96px;
  height: 72px;
  overflow: hidden;
  border-radius: 11px;
  background: rgba(255, 255, 255, 0.06);

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
  }

  span {
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    padding: 8px;
    color: rgba(248, 250, 252, 0.62);
    font-size: 10px;
    font-weight: 800;
    text-align: center;
  }
`;

const QuickAccessBody = styled.div`
  display: grid;
  min-width: 0;
  gap: 4px;
  padding-right: 4px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #f8fafc;
    font-size: 13px;
    font-weight: 850;
  }

  span {
    color: rgba(248, 250, 252, 0.62);
    font-size: 11px;
    font-weight: 700;
  }
`;

const QuickAccessActions = styled.div`
  position: absolute;
  right: 8px;
  bottom: 8px;
  z-index: 2;
  display: inline-flex;
  gap: 5px;
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity 140ms ease,
    transform 140ms ease;

  ${QuickAccessCard}:hover &,
  ${QuickAccessCard}:focus-within & {
    opacity: 1;
    transform: translateY(0);
  }
`;

const QuickAccessButton = styled.button`
  display: inline-grid;
  width: 25px;
  height: 25px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  color: #f8fafc;
  background: rgba(7, 10, 16, 0.72);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.24);
  cursor: pointer;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(255, 255, 255, 0.38);
    background: rgba(15, 23, 36, 0.92);
  }

  &[data-danger="true"] {
    color: #ffd4d4;
  }

  &[data-danger="true"]:hover:not(:disabled) {
    border-color: rgba(239, 107, 107, 0.46);
    background: rgba(76, 22, 26, 0.92);
  }

  &:disabled {
    cursor: default;
    opacity: 0.48;
  }
`;

const QuickAccessDismissButton = styled(QuickAccessButton)`
  position: absolute;
  top: 50%;
  left: -11px;
  z-index: 3;
  opacity: 0;
  transform: translate(-4px, -50%);
  transition:
    opacity 140ms ease,
    transform 140ms ease;

  ${QuickAccessCard}:hover &,
  ${QuickAccessCard}:focus-within & {
    opacity: 1;
    transform: translate(0, -50%);
  }
`;

const FloatingToolbar = styled.div`
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 5;
  display: inline-flex;
  gap: 6px;
  opacity: 0;
  transform: translateY(-3px);
  transition:
    opacity 140ms ease,
    transform 140ms ease;
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

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

const PinnedWindowRoot = styled.main`
  position: relative;
  display: grid;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: rgba(7, 10, 16, 0.94);
  color: #f8fafc;

  &:hover ${FloatingToolbar},
  &:focus-within ${FloatingToolbar} {
    opacity: 1;
    transform: translateY(0);
  }
`;

const PinnedDragBar = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 8px 112px 8px 12px;
  background: linear-gradient(180deg, rgba(7, 10, 16, 0.72), rgba(7, 10, 16, 0));
  cursor: move;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 12px;
    font-weight: 850;
  }

  span {
    color: rgba(248, 250, 252, 0.62);
    font-size: 11px;
    font-weight: 700;
  }
`;

const PinnedImageFrame = styled.div`
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  overflow: hidden;

  img {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }

  span {
    color: rgba(248, 250, 252, 0.62);
    font-size: 13px;
    font-weight: 800;
  }
`;

const EditorWindowRoot = styled.main`
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #070a10;
  color: #f8fafc;
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
  min-height: 50px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(12, 16, 24, 0.95);
  cursor: move;

  > div {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 13px;
    font-weight: 850;
  }

  span {
    color: rgba(248, 250, 252, 0.58);
    font-size: 11px;
    font-weight: 700;
  }
`;

const EditorStatus = styled.span`
  color: rgba(248, 250, 252, 0.62);
  font-size: 11px;
  font-weight: 750;
`;

const EditorControlsStack = styled.div`
  display: grid;
  min-width: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(9, 12, 18, 0.92);
`;

const EditorBatchStrip = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow-x: auto;
  padding: 9px 12px 0;
  scrollbar-width: thin;
`;

const EditorThumbButton = styled.button`
  position: relative;
  flex: 0 0 auto;
  width: 72px;
  height: 52px;
  overflow: hidden;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
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
    font-size: 12px;
    font-weight: 850;
  }

  strong,
  small {
    position: absolute;
    display: inline-grid;
    min-width: 18px;
    height: 18px;
    place-items: center;
    border-radius: 999px;
    font-size: 9px;
    font-weight: 900;
    line-height: 1;
  }

  strong {
    left: 5px;
    bottom: 5px;
    color: rgba(248, 250, 252, 0.92);
    background: rgba(7, 10, 16, 0.78);
  }

  small {
    top: 5px;
    right: 5px;
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

const EditorToolbar = styled.nav`
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 48px;
  padding: 8px 12px;
  overflow-x: auto;
  scrollbar-width: thin;
`;

const EditorToolGroup = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
`;

const EditorToolButton = styled.button`
  display: inline-grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 9px;
  color: #f8fafc;
  background: rgba(255, 255, 255, 0.055);
  cursor: pointer;

  svg {
    width: 18px;
    height: 18px;
  }

  &[data-active="true"],
  &:hover:not(:disabled) {
    border-color: rgba(147, 197, 253, 0.44);
    background: rgba(59, 130, 246, 0.22);
  }

  &:disabled {
    cursor: default;
    opacity: 0.42;
  }
`;

const ColorButton = styled.button`
  width: 24px;
  height: 24px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-radius: 999px;
  background: var(--snip-color);
  cursor: pointer;

  &[data-active="true"] {
    border-color: #f8fafc;
    box-shadow: 0 0 0 2px rgba(147, 197, 253, 0.42);
  }
`;

const StrokeControl = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: rgba(248, 250, 252, 0.62);
  font-size: 11px;
  font-weight: 750;

  input {
    width: 96px;
  }
`;

const EditorSaveButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin-left: auto;
  padding: 8px 10px;
  border: 1px solid rgba(89, 211, 153, 0.32);
  border-radius: 10px;
  color: #d8ffe9;
  background: rgba(22, 101, 52, 0.34);
  cursor: pointer;
  font-size: 12px;
  font-weight: 850;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover {
    border-color: rgba(89, 211, 153, 0.52);
    background: rgba(22, 101, 52, 0.48);
  }
`;

const EditorCanvasStage = styled.section`
  display: grid;
  min-height: 0;
  place-items: center;
  overflow: auto;
  padding: 18px;
  background:
    radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.12), transparent 40%),
    #05070b;

  canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    border-radius: 10px;
    box-shadow:
      0 24px 70px rgba(0, 0, 0, 0.5),
      0 0 0 1px rgba(255, 255, 255, 0.08);
    cursor: crosshair;
  }
`;

const EditorTodoComposer = styled.form`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 10px 12px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background:
    linear-gradient(180deg, rgba(9, 12, 18, 0.86), rgba(7, 10, 16, 0.98)),
    #070a10;

  input {
    min-width: 0;
    height: 40px;
    padding: 0 15px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 999px;
    color: #f8fafc;
    background: rgba(255, 255, 255, 0.055);
    font: inherit;
    font-size: 12px;
    font-weight: 750;
    outline: none;
  }

  input::placeholder {
    color: rgba(248, 250, 252, 0.42);
  }

  input:focus {
    border-color: rgba(147, 197, 253, 0.48);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.14);
  }
`;

const EditorTodoSendButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 40px;
  padding: 0 14px;
  border: 1px solid rgba(147, 197, 253, 0.34);
  border-radius: 999px;
  color: #e0f2fe;
  background: rgba(37, 99, 235, 0.28);
  cursor: pointer;
  font-size: 12px;
  font-weight: 850;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(147, 197, 253, 0.56);
    background: rgba(37, 99, 235, 0.42);
  }

  &:disabled {
    cursor: default;
    opacity: 0.46;
  }
`;

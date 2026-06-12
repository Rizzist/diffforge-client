import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Eraser } from "@styled-icons/boxicons-solid/Eraser";
import { ArrowForward } from "@styled-icons/material-rounded/ArrowForward";
import { BlurOn } from "@styled-icons/material-rounded/BlurOn";
import { Check } from "@styled-icons/material-rounded/Check";
import { Close } from "@styled-icons/material-rounded/Close";
import { CloudUpload } from "@styled-icons/material-rounded/CloudUpload";
import { ContentCopy } from "@styled-icons/material-rounded/ContentCopy";
import { Crop } from "@styled-icons/material-rounded/Crop";
import { CropSquare } from "@styled-icons/material-rounded/CropSquare";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { Gesture } from "@styled-icons/material-rounded/Gesture";
import { Grain } from "@styled-icons/material-rounded/Grain";
import { Highlight } from "@styled-icons/material-rounded/Highlight";
import { HighlightAlt } from "@styled-icons/material-rounded/HighlightAlt";
import { HorizontalRule } from "@styled-icons/material-rounded/HorizontalRule";
import { Link } from "@styled-icons/material-rounded/Link";
import { ModeEdit } from "@styled-icons/material-rounded/ModeEdit";
import { Numbers } from "@styled-icons/material-rounded/Numbers";
import { Public } from "@styled-icons/material-rounded/Public";
import { RadioButtonUnchecked } from "@styled-icons/material-rounded/RadioButtonUnchecked";
import { Rectangle } from "@styled-icons/material-rounded/Rectangle";
import { Send } from "@styled-icons/material-rounded/Send";
import { TextFields } from "@styled-icons/material-rounded/TextFields";
import { Texture } from "@styled-icons/material-rounded/Texture";
import { Undo } from "@styled-icons/material-rounded/Undo";
import { ZoomIn } from "@styled-icons/material-rounded/ZoomIn";
import { ZoomOut } from "@styled-icons/material-rounded/ZoomOut";
import { Folder } from "@styled-icons/material-rounded/Folder";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import styled, { createGlobalStyle, keyframes } from "styled-components";
import { sanitizeTerminalColor } from "../terminals/terminalColors.js";

const SNIPPING_CAPTURE_SAVED_EVENT = "forge-snipping-capture-saved";
const SNIPPING_SOURCE_UPDATED_EVENT = "forge-snip-source-updated";
const SNIPPING_LIVE_PREVIEW_EVENT = "forge-snip-live-preview";
const SNIPPING_FLOAT_ASSIGN_EVENT = "forge-snip-float-assign";
const SNIPPING_FLOAT_DISPOSE_EVENT = "forge-snip-float-dispose";
const SNIPPING_EDITOR_DISPOSE_EVENT = "forge-snip-editor-dispose";
// ~22fps: frames are tiny (max edge capped below), so the encode+emit cost
// per frame stays in the low milliseconds and the preview tracks the pen in
// realtime without pinning a core.
const SNIPPING_LIVE_PREVIEW_THROTTLE_MS = 45;
const SNIPPING_LIVE_PREVIEW_MAX_EDGE = 512;
const SNIPPING_ANNOTATION_TODO_EVENT = "diffforge:snipping-annotation-todo";

export const SNIPPING_TOAST_HASH = "#/snipping-toasts";
export const SNIPPING_EDITOR_HASH = "#/snipping-editor";
export const SNIPPING_FLOAT_HASH = "#/snipping-float";
export const SNIPPING_STRIP_HASH = "#/snipping-strip";

const SNIPPING_EDITOR_WINDOW_PREFIX = "snipping-editor";
const SNIPPING_FLOAT_WINDOW_PREFIX = "snip-float";
const SNIPPING_STRIP_ANIM_EVENT = "forge-snip-strip-anim";
const SNIPPING_STRIP_RECENT_LIMIT = 16;
const SNIPPING_FLOATS_CHANGED_EVENT = "forge-snip-floats-changed";


// Quick-access tools. Closed shapes (rect/oval) are one abstract "shape" tool
// parameterized by kind + fill mode (outline | solid | marker | spotlight);
// the rail exposes the common combos directly and the bottom options bar
// unlocks every combination when a shape tool is active.
const TOOL_GROUPS = [
  [
    { id: "pen", label: "Pen", Icon: Gesture, tool: "pen" },
    { id: "line", label: "Line", Icon: HorizontalRule, tool: "line" },
    { id: "arrow", label: "Arrow", Icon: ArrowForward, tool: "arrow" },
  ],
  [
    { id: "rect-outline", label: "Rectangle outline", Icon: CropSquare, tool: "shape", shape: "rect", mode: "outline" },
    { id: "rect-solid", label: "Solid rectangle", Icon: Rectangle, tool: "shape", shape: "rect", mode: "solid" },
    { id: "oval-outline", label: "Oval outline", Icon: RadioButtonUnchecked, tool: "shape", shape: "oval", mode: "outline" },
  ],
  [
    { id: "spotlight", label: "Highlight area (dims the rest)", Icon: HighlightAlt, tool: "shape", shape: "rect", mode: "spotlight" },
    { id: "marker", label: "Highlighter", Icon: Highlight, tool: "shape", shape: "rect", mode: "marker" },
    { id: "blur", label: "Blur (redact)", Icon: BlurOn, tool: "blur" },
  ],
  [
    { id: "text", label: "Text", Icon: TextFields, tool: "text" },
    { id: "number", label: "Number badge", Icon: Numbers, tool: "number" },
    { id: "crop", label: "Crop", Icon: Crop, tool: "crop" },
  ],
  [
    { id: "eraser", label: "Eraser (drag over annotations to remove them)", Icon: Eraser, tool: "eraser" },
  ],
];

const SHAPE_KIND_OPTIONS = [
  { id: "rect", label: "Rectangle", Icon: CropSquare },
  { id: "oval", label: "Oval", Icon: RadioButtonUnchecked },
];

const SHAPE_MODE_OPTIONS = [
  { id: "outline", label: "Outline", Icon: CropSquare },
  { id: "solid", label: "Solid fill", Icon: Rectangle },
  { id: "marker", label: "Highlighter fill", Icon: Highlight },
  { id: "spotlight", label: "Spotlight (dim the rest)", Icon: HighlightAlt },
];

const BLUR_STRATEGY_OPTIONS = [
  { id: "pixelate", label: "Pixelate", Icon: Texture },
  { id: "smooth", label: "Smooth blur", Icon: BlurOn },
  { id: "static", label: "Static (blur + heavy noise)", Icon: Grain },
];

const BLUR_POWER_OPTIONS = [1, 2, 3, 4, 5];

const TEXT_BG_OPTIONS = [
  { id: "none", label: "No background" },
  { id: "dark", label: "Dark card" },
  { id: "light", label: "Light card" },
  { id: "accent", label: "Accent card (uses the selected color)" },
];

const STROKE_OPTIONS = [3, 5, 9];
// Text / number badge sizing rides the shared stroke selector (S/M/L), then
// scales up with very large captures so labels stay legible.
const TEXT_SIZE_BY_STROKE = { 3: 18, 5: 26, 9: 38 };
const NUMBER_RADIUS_BY_STROKE = { 3: 14, 5: 18, 9: 26 };

const COLOR_OPTIONS = ["#f8fafc", "#ef4444", "#f59e0b", "#22c55e", "#38bdf8", "#a855f7"];

// react-select theme for the composer's workspace/terminal pickers: compact
// dark pills with an upward menu (the composer sits on the bottom edge).
function targetColorAlpha(hex, alpha) {
  const value = String(hex || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    return `rgba(147, 197, 253, ${alpha})`;
  }
  const r = Number.parseInt(value.slice(1, 3), 16);
  const g = Number.parseInt(value.slice(3, 5), 16);
  const b = Number.parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TARGET_SELECT_STYLES = {
  container: (base) => ({ ...base, flex: "0 1 auto", minWidth: 110, maxWidth: 172 }),
  control: (base, state) => {
    // Terminal options carry the terminal's color; tint the pill with it so
    // the chosen target reads at a glance. Workspace options have no color
    // and keep the neutral blue focus accent.
    const accent = state.getValue()?.[0]?.color || "";
    return {
      ...base,
      minHeight: 32,
      height: 32,
      borderRadius: 999,
      backgroundColor: state.isFocused ? "rgba(230, 236, 245, 0.09)" : "rgba(230, 236, 245, 0.06)",
      borderColor: accent
        ? targetColorAlpha(accent, state.isFocused ? 0.66 : 0.38)
        : state.isFocused
          ? "rgba(147, 197, 253, 0.45)"
          : "rgba(230, 236, 245, 0.12)",
      boxShadow: state.isFocused && accent ? `0 0 0 3px ${targetColorAlpha(accent, 0.13)}` : "none",
      cursor: "pointer",
      transition: "border-color 120ms ease, background-color 120ms ease, box-shadow 140ms ease",
      ":hover": { borderColor: accent ? targetColorAlpha(accent, 0.6) : "rgba(147, 197, 253, 0.4)" },
    };
  },
  valueContainer: (base) => ({ ...base, padding: "0 2px 0 11px", flexWrap: "nowrap" }),
  singleValue: (base) => ({
    ...base,
    display: "flex",
    minWidth: 0,
    margin: 0,
    color: "rgba(248, 250, 252, 0.9)",
    fontSize: 12,
    fontWeight: 700,
  }),
  placeholder: (base) => ({
    ...base,
    color: "rgba(248, 250, 252, 0.42)",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  }),
  input: (base) => ({ ...base, color: "#f8fafc", fontSize: 12, margin: 0, padding: 0 }),
  indicatorSeparator: () => ({ display: "none" }),
  dropdownIndicator: (base, state) => ({
    ...base,
    padding: "0 9px 0 1px",
    color: state.isFocused ? "rgba(248, 250, 252, 0.85)" : "rgba(248, 250, 252, 0.45)",
    transition: "color 120ms ease, transform 160ms ease",
    transform: state.selectProps.menuIsOpen ? "rotate(180deg)" : "none",
    ":hover": { color: "#ffffff" },
  }),
  menu: (base) => ({
    ...base,
    borderRadius: 12,
    backgroundColor: "rgba(15, 19, 27, 0.99)",
    border: "1px solid rgba(230, 236, 245, 0.12)",
    boxShadow: "0 -10px 36px rgba(0, 0, 0, 0.5), 0 18px 48px rgba(0, 0, 0, 0.45)",
    overflow: "hidden",
    marginBottom: 8,
  }),
  menuList: (base) => ({ ...base, padding: 5, maxHeight: 240 }),
  option: (base, state) => {
    const accent = state.data?.color || "";
    return {
      ...base,
      display: "flex",
      alignItems: "center",
      borderRadius: 8,
      padding: "7px 10px",
      fontSize: 12,
      fontWeight: 650,
      color: state.isSelected ? "#ffffff" : "rgba(248, 250, 252, 0.85)",
      backgroundColor: state.isSelected
        ? (accent ? targetColorAlpha(accent, 0.26) : "rgba(59, 130, 246, 0.45)")
        : state.isFocused
          ? "rgba(230, 236, 245, 0.09)"
          : "transparent",
      cursor: "pointer",
      ":active": { backgroundColor: accent ? targetColorAlpha(accent, 0.2) : "rgba(59, 130, 246, 0.32)" },
    };
  },
  noOptionsMessage: (base) => ({
    ...base,
    color: "rgba(248, 250, 252, 0.5)",
    fontSize: 12,
    fontWeight: 650,
  }),
};

const TargetOptionLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;

  i {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--target-option-dot, rgba(148, 163, 184, 0.5));
  }

  &[data-any="true"] i {
    background: transparent;
    border: 1.5px solid rgba(148, 163, 184, 0.55);
  }

  svg {
    flex: none;
    width: 13px;
    height: 13px;
    color: rgba(148, 163, 184, 0.85);
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

function workspaceOptionLabelRenderer(option) {
  return (
    <TargetOptionLabel>
      <Folder aria-hidden="true" />
      <span>{option.label}</span>
    </TargetOptionLabel>
  );
}

function terminalOptionLabelRenderer(option) {
  return (
    <TargetOptionLabel
      data-any={option.value === "" ? "true" : "false"}
      style={option.color ? { "--target-option-dot": option.color } : undefined}
    >
      <i aria-hidden="true" />
      <span>{option.label}</span>
    </TargetOptionLabel>
  );
}

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

function versionedAssetPreviewUrl(localPath, imageVersion = 0) {
  const url = assetPreviewUrl({ localPath });
  if (!url || !imageVersion) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${imageVersion}`;
}

function useStripTilePreviewUrl(localPath, imageVersion = 0, assetFallback = true) {
  const assetUrl = useMemo(
    () => (assetFallback ? versionedAssetPreviewUrl(localPath, imageVersion) : ""),
    [assetFallback, imageVersion, localPath],
  );
  const [dataUrl, setDataUrl] = useState("");
  const [assetUrlFailed, setAssetUrlFailed] = useState(false);
  const requestRef = useRef(0);

  useEffect(() => {
    const path = text(localPath);
    setDataUrl("");
    setAssetUrlFailed(false);
    if (!path) return undefined;

    let cancelled = false;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    invoke("snipping_read_asset_data_url", { path })
      .then((nextDataUrl) => {
        if (cancelled || requestRef.current !== requestId) return;
        const normalized = text(nextDataUrl);
        if (normalized) {
          setDataUrl(normalized);
        }
      })
      .catch(() => {
        // Keep the asset:-URL fallback below; the file may still paint fine.
      });

    return () => {
      cancelled = true;
    };
  }, [imageVersion, localPath]);

  const onImageError = useCallback(() => {
    if (dataUrl) {
      setDataUrl("");
      setAssetUrlFailed(false);
    } else {
      setAssetUrlFailed(true);
    }
  }, [dataUrl]);

  return {
    previewUrl: dataUrl || (assetFallback && !assetUrlFailed ? assetUrl : ""),
    onImageError,
  };
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
  return exportAnnotatedCanvas(image, annotations).toDataURL("image/png");
}

async function copySnipToClipboard(snip) {
  try {
    await invoke("diffforge_copy_asset_to_clipboard", {
      path: snip.localPath,
    });
    return "Copied to clipboard";
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
    return "Copied to clipboard";
  }

  if (navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(snip.localPath);
    return "Copied to clipboard";
  }

  throw new Error("Clipboard is not available in this webview.");
}

async function copyTextToClipboard(value) {
  const normalized = text(value);
  if (!normalized || !navigator?.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(normalized);
    return true;
  } catch {
    return false;
  }
}

/**
 * Upload-button state machine shared by the floating preview and the strip
 * tile: idle -> uploading -> done when the snip upload-public setting mints a
 * link during upload, or idle -> uploading -> private -> publishing -> done
 * when snip uploads stay private and "Make public" is an explicit second
 * step. In "done" the same button becomes "Copy URL" for the public link. A
 * different adopted snip or an annotation save resets to idle because the
 * uploaded asset no longer matches the visible pixels.
 */
function useSnipCloudUpload({ imageVersion, localPath, name, showStatus }) {
  const [uploadState, setUploadState] = useState("idle");
  const [assetId, setAssetId] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [urlCopied, setUrlCopied] = useState(false);
  const copiedTimerRef = useRef(0);

  useEffect(() => {
    setUploadState("idle");
    setAssetId("");
    setPublicUrl("");
    setUrlCopied(false);
  }, [imageVersion, localPath]);

  useEffect(() => () => {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  const uploadToCloud = useCallback(async () => {
    setUploadState("uploading");
    try {
      const result = await invoke("snipping_upload_untracked_asset_to_cloud", {
        request: {
          group: "snips",
          name,
          path: localPath,
        },
      });
      setAssetId(text(result?.assetId || result?.asset_id));
      const url = text(result?.publicUrl || result?.public_url);
      if (url) {
        setPublicUrl(url);
        setUploadState("done");
        showStatus("Uploaded");
      } else {
        setUploadState("private");
        showStatus("Uploaded privately");
      }
    } catch (error) {
      setUploadState("idle");
      throw error;
    }
  }, [localPath, name, showStatus]);

  const makePublic = useCallback(async () => {
    if (!assetId) return;
    setUploadState("publishing");
    try {
      const result = await invoke("snipping_publish_uploaded_asset", {
        request: { assetId },
      });
      const url = text(result?.publicUrl || result?.public_url);
      if (!url) {
        throw new Error("Publish finished without a public URL.");
      }
      setPublicUrl(url);
      setUploadState("done");
      showStatus("Public URL ready");
    } catch (error) {
      setUploadState("private");
      throw error;
    }
  }, [assetId, showStatus]);

  const copyPublicUrl = useCallback(async () => {
    const copied = await copyTextToClipboard(publicUrl);
    showStatus(copied ? "URL copied" : "Clipboard is not available in this webview.");
    if (!copied) return;
    setUrlCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = 0;
      setUrlCopied(false);
    }, 1400);
  }, [publicUrl, showStatus]);

  return { copyPublicUrl, makePublic, uploadState, uploadToCloud, urlCopied };
}

/* Shared icon+label body for the snip upload button across its five states;
   the surrounding button supplies state styling via data-state. */
function SnipUploadButtonBody({ uploadState, urlCopied }) {
  if (uploadState === "uploading" || uploadState === "publishing") {
    return (
      <>
        <FloatUploadSpinner aria-hidden="true" />
        <span>{uploadState === "publishing" ? "Publishing" : "Uploading"}</span>
      </>
    );
  }
  if (uploadState === "private") {
    return (
      <>
        <Public aria-hidden="true" />
        <span>Make public</span>
      </>
    );
  }
  if (uploadState === "done") {
    return urlCopied ? (
      <>
        <Check aria-hidden="true" />
        <span>Copied</span>
      </>
    ) : (
      <>
        <Link aria-hidden="true" />
        <span>Copy URL</span>
      </>
    );
  }
  return (
    <>
      <CloudUpload aria-hidden="true" />
      <span>Upload</span>
    </>
  );
}

function SnipStatusPill({ status }) {
  const label = text(status);
  if (!label) return null;
  const copied = /copied/iu.test(label);
  return (
    <FloatStatusPill
      aria-label={copied ? "Copied to clipboard" : label}
      aria-live="polite"
      data-tone={copied ? "success" : "info"}
    >
      {copied ? <Check aria-hidden="true" /> : null}
      <span>{copied ? "Copied" : label}</span>
    </FloatStatusPill>
  );
}

function snipUploadButtonTitle(uploadState, name) {
  if (uploadState === "uploading") return `Uploading ${name}`;
  if (uploadState === "publishing") return `Publishing ${name}`;
  if (uploadState === "private") return `Make ${name} public`;
  if (uploadState === "done") return `Copy public URL for ${name}`;
  return `Upload ${name}`;
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
    const current = getCurrentWindow();
    const label = text(current.label);
    if (label.startsWith(SNIPPING_FLOAT_WINDOW_PREFIX)) {
      invoke("snipping_close_snip_float", { label }).catch(() => {
        current.close().catch(() => {});
      });
      return;
    }
    current.close().catch(() => {});
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
  const [closing, setClosing] = useState(false);
  const localPathRef = useRef(initialPath);
  const closingRef = useRef(false);
  const { previewUrl: filePreviewUrl, onImageError } = useStripTilePreviewUrl(localPath, imageVersion);
  const previewUrl = useMemo(() => {
    if (closing) return "";
    if (liveFrameUrl) return liveFrameUrl;
    return filePreviewUrl;
  }, [closing, filePreviewUrl, liveFrameUrl]);
  const name = useMemo(() => assetName({ localPath }), [localPath]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const busyRef = useRef(false);
  // Rust watches the global cursor and arms the hover chrome — CSS :hover
  // alone never fires while this window is unfocused, which used to hide the
  // buttons until a focusing click (and made every action cost two clicks).
  const [hoverArmed, setHoverArmed] = useState(false);
  const statusTimerRef = useRef(0);

  useFloatingWindowBody("float");

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const beginClosing = useCallback(() => {
    closingRef.current = true;
    setClosing(true);
    setBusy(true);
    setHoverArmed(false);
    setLiveFrameUrl("");
    setStatus("");
  }, []);

  useEffect(() => {
    closingRef.current = closing;
  }, [closing]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    const ownLabel = getCurrentWindow().label;

    listen(SNIPPING_FLOAT_DISPOSE_EVENT, (event) => {
      if (disposed) return;
      const payload = event?.payload || {};
      if (text(payload.label) !== ownLabel) return;
      beginClosing();
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
  }, [beginClosing]);

  // Warm-pool adoption: this window may have booted with no path in its URL,
  // parked hidden until a capture claims it. The path arrives by event, plus
  // a queryable fallback in case adoption raced the page boot.
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    const ownLabel = getCurrentWindow().label;
    const adopt = (path) => {
      if (disposed || !path) return;
      closingRef.current = false;
      setClosing(false);
      setBusy(false);
      setStatus("");
      setHoverArmed(false);
      localPathRef.current = path;
      setLocalPath(path);
      setImageVersion((version) => version + 1);
      setLiveFrameUrl("");
    };

    listen(SNIPPING_FLOAT_ASSIGN_EVENT, (event) => {
      const payload = event?.payload || {};
      if (text(payload.label) !== ownLabel) return;
      adopt(text(payload.path));
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {});

    if (!initialPath) {
      invoke("snipping_float_assigned_path")
        .then((result) => adopt(text(result?.path)))
        .catch(() => {});
    }

    return () => {
      disposed = true;
      unlisten();
    };
  }, [initialPath]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    const ownLabel = getCurrentWindow().label;

    listen("snipping-float-hover", (event) => {
      if (disposed) return;
      const payload = event?.payload || {};
      if (text(payload.label) !== ownLabel) return;
      setHoverArmed(payload.hovered === true);
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
    localPathRef.current = localPath;
  }, [localPath]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(SNIPPING_SOURCE_UPDATED_EVENT, (event) => {
      if (disposed || closingRef.current) return;
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
      if (disposed || closingRef.current) return;
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

  const { copyPublicUrl, makePublic, uploadState, uploadToCloud, urlCopied } = useSnipCloudUpload({
    imageVersion,
    localPath,
    name,
    showStatus,
  });

  const closeFloat = useCallback(() => {
    if (closingRef.current) return;
    beginClosing();
    const label = getCurrentWindow().label;
    invoke("snipping_close_snip_float", { label })
      .catch((error) => {
        closingRef.current = false;
        setClosing(false);
        setBusy(false);
        showStatus(error?.message || String(error || "Unable to close snip preview."));
      });
  }, [beginClosing, showStatus]);

  const dismissFloat = useCallback(() => {
    if (closingRef.current) return;
    if (localPath) {
      invoke("snipping_dismiss_capture_toast", {
        request: { path: localPath },
      }).catch(() => {});
    }
    closeFloat();
  }, [closeFloat, localPath]);

  const runAction = useCallback(async (action) => {
    if (!localPath || busyRef.current || closingRef.current) return;
    const actionPath = localPath;
    if (action === "delete") {
      beginClosing();
    }
    setBusy(true);

    try {
      if (action === "delete") {
        await invoke("diffforge_delete_untracked_asset", { path: actionPath });
      } else if (action === "copy") {
        const copyStatus = await copySnipToClipboard({ localPath: actionPath, name, previewUrl });
        showStatus(copyStatus);
      } else if (action === "edit") {
        await invoke("snipping_open_annotation_editor", { path: actionPath });
        showStatus("Editor opened");
      } else if (action === "upload") {
        if (uploadState === "done") {
          await copyPublicUrl();
        } else if (uploadState === "private") {
          await makePublic();
        } else {
          await uploadToCloud();
        }
      }
    } catch (error) {
      if (action === "delete") {
        closingRef.current = false;
        setClosing(false);
      }
      showStatus(error?.message || String(error || "Action failed"));
    } finally {
      if (action !== "delete") {
        setBusy(false);
      }
    }
  }, [beginClosing, copyPublicUrl, localPath, makePublic, name, previewUrl, showStatus, uploadState, uploadToCloud]);

  // Manual double-press detection: the native window drag begins on the
  // first press, so a synthetic dblclick event is not reliable here.
  const lastPressAtRef = useRef(0);
  const beginDrag = useCallback((event) => {
    if (closing) return;
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
  }, [closing, runAction]);

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
        data-closing={closing ? "true" : "false"}
        data-hovered={hoverArmed ? "true" : "false"}
        onDoubleClick={() => runAction("edit")}
        onMouseDown={beginDrag}
        title={`${name} — drag anywhere, double-click to annotate`}
      >
        {previewUrl ? (
          <img alt={name} draggable={false} onError={onImageError} src={previewUrl} />
        ) : (
          <span data-empty="true">Preview unavailable</span>
        )}
        <FloatCloseButton
          aria-label={`Dismiss ${name}`}
          disabled={closing}
          onClick={dismissFloat}
          title="Dismiss"
          type="button"
        >
          <Close aria-hidden="true" />
        </FloatCloseButton>
        <FloatUploadButton
          aria-label={snipUploadButtonTitle(uploadState, name)}
          data-state={uploadState}
          disabled={busy || closing}
          onClick={() => runAction("upload")}
          title={snipUploadButtonTitle(uploadState, name)}
          type="button"
        >
          <SnipUploadButtonBody uploadState={uploadState} urlCopied={urlCopied} />
        </FloatUploadButton>
        {uploadState === "uploading" || uploadState === "publishing"
          ? <FloatUploadProgress aria-hidden="true" />
          : null}
        <FloatActionBar>
          <FloatActionButton
            aria-label={`Copy ${name}`}
            disabled={busy || closing}
            onClick={() => runAction("copy")}
            title="Copy image"
            type="button"
          >
            <ContentCopy aria-hidden="true" />
          </FloatActionButton>
          <FloatActionButton
            aria-label={`Annotate ${name}`}
            disabled={busy || closing}
            onClick={() => runAction("edit")}
            title="Annotate copy"
            type="button"
          >
            <ModeEdit aria-hidden="true" />
          </FloatActionButton>
          <FloatActionButton
            aria-label={`Delete ${name}`}
            data-danger="true"
            disabled={busy || closing}
            onClick={() => runAction("delete")}
            title="Delete file"
            type="button"
          >
            <Delete aria-hidden="true" />
          </FloatActionButton>
        </FloatActionBar>
        <SnipStatusPill status={status} />
      </FloatWindowRoot>
    </>
  );
}

const FloatWindowRoot = styled.main`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
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
    /* Absolutely pinned to the window box: percentage sizes on in-flow
       children of auto grid/flex tracks don't resolve reliably in WebKit
       (the img lays out at the capture's intrinsic size and the overflow
       clip eats it off-center — seen in production). Against the fixed
       containing block the box is exact, and object-fit: contain then
       scales the whole capture to fit the golden-ratio window, dead-
       centered, never cropped. */
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    object-position: center;
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
     the preview is hovered; the bare image is the whole resting surface.
     data-hovered is the Rust cursor watcher's verdict — it arms the chrome
     even while the window is unfocused, where CSS :hover never fires. */
  > button,
  > div {
    opacity: 0;
    pointer-events: none;
    transition: opacity 140ms ease;
  }

  &:hover > button,
  &[data-hovered="true"] > button,
  &:hover > div,
  &[data-hovered="true"] > div {
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

/* The strip tile's stand-in for the preview's close button: same slot, same
   shape, but it pins (opens the draggable preview) instead of dismissing. */
const FloatPinButton = styled.button`
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

  &:hover:not(:disabled) {
    border-color: rgba(125, 176, 255, 0.55);
    background: rgba(23, 37, 62, 0.92);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
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

  /* Mid-flow and uploaded chrome stays visible without hover (overrides the
     parent's hidden-until-hover rule): the user must see progress, the
     pending Make public step, and the Copy URL affordance at a glance. */
  &[data-state="uploading"],
  &[data-state="publishing"],
  &[data-state="private"],
  &[data-state="done"] {
    opacity: 1;
    pointer-events: auto;
  }

  &[data-state="uploading"]:disabled,
  &[data-state="publishing"]:disabled {
    opacity: 1;
    cursor: progress;
  }

  /* Private = uploaded but not shared yet: amber prompt for the next step. */
  &[data-state="private"] {
    border-color: rgba(247, 201, 72, 0.5);
    color: #f7e8c1;
  }

  &[data-state="private"]:hover:not(:disabled) {
    color: #1c1503;
    background: #f7c948;
    border-color: transparent;
  }

  &[data-state="done"] {
    border-color: rgba(94, 222, 153, 0.45);
    color: #d9f7e7;
  }

  &[data-state="done"]:hover:not(:disabled) {
    color: #06150d;
    background: #5ede99;
    border-color: transparent;
  }
`;

const floatUploadSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const FloatUploadSpinner = styled.span`
  flex: 0 0 auto;
  width: 11px;
  height: 11px;
  border: 2px solid rgba(207, 227, 255, 0.35);
  border-top-color: #cfe3ff;
  border-radius: 50%;
  animation: ${floatUploadSpin} 0.7s linear infinite;
`;

const floatUploadSlide = keyframes`
  from {
    transform: translateX(-100%);
  }

  to {
    transform: translateX(250%);
  }
`;

/* Indeterminate upload bar pinned to the preview's bottom edge. A span on
   purpose: the hidden-until-hover chrome rule only targets buttons and divs,
   so the bar stays visible while the cursor wanders off mid-upload. */
const FloatUploadProgress = styled.span`
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 3px;
  overflow: hidden;
  background: rgba(125, 176, 255, 0.18);
  pointer-events: none;
  z-index: 3;

  &::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 40%;
    border-radius: 999px;
    background: #7db0ff;
    animation: ${floatUploadSlide} 1.1s ease-in-out infinite;
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
  top: 8px;
  left: 50%;
  display: inline-flex;
  min-height: 25px;
  max-width: calc(100% - 96px);
  align-items: center;
  gap: 6px;
  overflow: hidden;
  padding: 5px 10px 5px 8px;
  border: 1px solid rgba(125, 176, 255, 0.32);
  border-radius: 999px;
  color: #dceaff;
  background: linear-gradient(180deg, rgba(10, 14, 22, 0.95), rgba(5, 8, 13, 0.9));
  box-shadow:
    0 12px 28px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
  font-size: 11px;
  font-weight: 720;
  line-height: 1;
  pointer-events: none;
  text-overflow: ellipsis;
  transform: translateX(-50%);
  white-space: nowrap;
  z-index: 4;

  svg {
    flex: 0 0 auto;
    width: 13px;
    height: 13px;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &[data-tone="success"] {
    border-color: rgba(94, 222, 153, 0.48);
    color: #e9fff3;
    background: linear-gradient(180deg, rgba(12, 30, 22, 0.96), rgba(6, 17, 13, 0.92));
  }

  &[data-tone="success"] svg {
    color: #68f0a8;
  }
`;

/**
 * Backdrop content for the strip bar. Every tile on the bar is a real snip
 * preview window now — Rust parks them on a horizontal queue over this band
 * (one unified queue system with the bottom-left column), so the webview
 * renders no tiles, no drag ghost, and no drag-out bridge: dragging a tile
 * out of (or into) the bar is just dragging the preview window itself.
 */
export function SnippingRecentStrip() {
  return null;
}

/**
 * The tray-toggled recent-snips bar, spanning the full monitor width: pinned
 * under the menu bar on macOS, above the taskbar on Windows/Linux (Rust owns
 * placement, sizing, and the open/close animation cues).
 */
export function SnippingStripWindow() {
  const [animPhase, setAnimPhase] = useState("open");
  const [animOrigin, setAnimOrigin] = useState("top");
  const [openNonce, setOpenNonce] = useState(0);
  const animPhaseRef = useRef("open");
  // Epoch-ms of the last close cue: the watchdog must not fight the hide
  // animation, but a window still visible long after a close cue (or with no
  // cue at all) has missed its open cue and must force itself visible.
  const lastCloseCueMsRef = useRef(0);

  useFloatingWindowBody("strip");

  useEffect(() => {
    animPhaseRef.current = animPhase;
  }, [animPhase]);

  useEffect(() => {
    let cancelled = false;
    let unlistenAnim = null;
    const playOpen = () => {
      // Re-mount the strip on every open so it always shows fresh snips,
      // and two-frame the transition so the closed state paints first. The
      // timeout backstop matters: rAF can stall in an unfocused overlay
      // webview, which used to strand the shell at opacity 0 — a frosted
      // bar with invisible (but still draggable) tiles.
      setOpenNonce((nonce) => nonce + 1);
      setAnimPhase("closed");
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setAnimPhase("open"));
      });
      window.setTimeout(() => {
        if (!cancelled && animPhaseRef.current !== "open") {
          setAnimPhase("open");
        }
      }, 90);
    };
    listen(SNIPPING_STRIP_ANIM_EVENT, (event) => {
      if (cancelled) return;
      const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
      const phase = text(payload.phase) === "open" ? "open" : "closed";
      const origin = text(payload.origin) === "bottom" ? "bottom" : "top";
      setAnimOrigin(origin);
      if (phase === "open") {
        lastCloseCueMsRef.current = 0;
        if (animPhaseRef.current === "open") {
          setOpenNonce((nonce) => nonce + 1);
          setAnimPhase("open");
          return;
        }
        playOpen();
      } else {
        lastCloseCueMsRef.current = Date.now();
        setAnimPhase("closed");
      }
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenAnim = unlisten;
      })
      .catch(() => {});
    // Missed-cue watchdog. The open cue is emitted the moment Rust shows the
    // window, which loses against the first page boot (no listener yet) and
    // can lose again on re-shows under load. Any tick that finds the window
    // visible, the shell closed, and no recent close cue plays the open.
    const watchdog = window.setInterval(() => {
      if (cancelled || animPhaseRef.current === "open") return;
      const sinceClose = Date.now() - lastCloseCueMsRef.current;
      if (lastCloseCueMsRef.current > 0 && sinceClose < 700) return;
      getCurrentWindow()
        .isVisible()
        .then((visible) => {
          if (cancelled || !visible || animPhaseRef.current === "open") return;
          playOpen();
        })
        .catch(() => {});
    }, 250);
    return () => {
      cancelled = true;
      window.clearInterval(watchdog);
      if (unlistenAnim) unlistenAnim();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        invoke("snipping_toggle_snip_strip").catch(() => {});
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return (
    <>
      <SnipFloatingGlobalStyle />
      <StripWindowShell data-anim={animPhase} data-origin={animOrigin}>
        <SnippingRecentStrip key={openNonce} />
      </StripWindowShell>
    </>
  );
}

/* Flush, full-bleed sheet: the window itself is pinned to the work-area edge
   and the native vibrancy layer (Rust applies it with a matching 14px corner
   radius) provides the glass — the webview only tints it. */
const StripWindowShell = styled.main`
  box-sizing: border-box;
  display: grid;
  height: 100vh;
  padding: 0;
  overflow: hidden;
  background: transparent;
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
  transform-origin: top center;
  transition:
    opacity 150ms ease,
    transform 180ms cubic-bezier(0.2, 0.9, 0.3, 1.15);
  will-change: opacity, transform;

  &[data-origin="bottom"] {
    transform: translateY(10px) scale(0.98);
    transform-origin: bottom center;
  }

  &[data-anim="open"],
  &[data-anim="open"][data-origin="bottom"] {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
`;

export function SnippingAnnotationEditorWindow() {
  const localPaths = useMemo(() => pathsFromHash(SNIPPING_EDITOR_HASH), []);
  const [activePath, setActivePath] = useState(() => localPaths[0] || "");
  const previewUrl = useMemo(() => assetPreviewUrl({ localPath: activePath }), [activePath]);
  const name = useMemo(() => assetName({ localPath: activePath }), [activePath]);
  const activeIndex = Math.max(0, localPaths.indexOf(activePath));
  const multiImage = localPaths.length > 1;
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const draftRef = useRef(null);
  const drawingRef = useRef(false);
  const editorClosingRef = useRef(false);
  // Autosave chain: the first save of an original returns the new edited-copy
  // path; every later autosave for that original updates the same copy in
  // place. Re-opening the original in a fresh editor session starts a new
  // version. Edited copies always update in place.
  const autosaveTargetsRef = useRef({});
  const autosaveTimerRef = useRef(0);
  const livePreviewTimerRef = useRef(0);
  const livePreviewLastSentRef = useRef(0);
  const livePreviewFrameCanvasRef = useRef(null);
  const [tool, setTool] = useState("pen");
  const [shapeKind, setShapeKind] = useState("rect");
  const [shapeMode, setShapeMode] = useState("outline");
  const [blurStrategy, setBlurStrategy] = useState("pixelate");
  const [blurPower, setBlurPower] = useState(3);
  const [textBg, setTextBg] = useState("dark");
  const [textEditor, setTextEditor] = useState(null);
  const textEditorRef = useRef(null);
  // Cursor-anchored copy/paste: the cursor's image-space position picks what
  // ⌘C grabs and where ⌘V drops it; the hovered annotation gets an outline.
  const cursorRef = useRef({ x: 0, y: 0, inside: false });
  const annotationClipboardRef = useRef(null);
  const pasteSpreadRef = useRef(0);
  // Eraser drag session: true between mouse-down and release, counting the
  // annotations removed along the way for the status line.
  const erasingRef = useRef(false);
  const erasedCountRef = useRef(0);
  const [hoverIndex, setHoverIndex] = useState(-1);
  const [color, setColor] = useState("#ef4444");
  const [strokeWidth, setStrokeWidth] = useState(5);
  const [annotationsByPath, setAnnotationsByPath] = useState({});
  const [draft, setDraft] = useState(null);
  const [status, setStatus] = useState("Loading image...");
  const [editorClosing, setEditorClosing] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  // Zoom is relative to "fit the stage" (1 = the image fills the available
  // area, upscaling small snips); wheel / pinch / buttons move it, anchored
  // on the cursor so the point under the pointer stays put.
  const viewportRef = useRef(null);
  const zoomRef = useRef(1);
  const pendingZoomAnchorRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [todoDraft, setTodoDraft] = useState("");
  const [dispatchTargets, setDispatchTargets] = useState([]);
  const [targetWorkspaceId, setTargetWorkspaceId] = useState("");
  const [targetThreadId, setTargetThreadId] = useState("");
  // Whether the edited snip is currently pinned on screen as a floating
  // preview: the action cluster shows a pin button when it is not, and a
  // close button when it is.
  const [floatOpen, setFloatOpen] = useState(false);
  const annotations = annotationsByPath[activePath] || [];
  const hasCrop = annotations.some((annotation) => annotation.type === "crop");

  useEffect(() => {
    if (!activePath) {
      setFloatOpen(false);
      return undefined;
    }
    let cancelled = false;
    const refreshFloatState = () => {
      invoke("snipping_snip_float_open", { path: activePath })
        .then((result) => {
          if (!cancelled) setFloatOpen(Boolean(result?.open));
        })
        .catch(() => {});
    };
    refreshFloatState();
    // Manually closing (or pinning) the preview elsewhere flips the button.
    let unlisten = () => {};
    listen(SNIPPING_FLOATS_CHANGED_EVENT, refreshFloatState)
      .then((nextUnlisten) => {
        if (cancelled) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten();
    };
  }, [activePath]);

  const toggleFloatPin = useCallback(async () => {
    if (!activePath) return;
    try {
      if (floatOpen) {
        await invoke("snipping_close_snip_float_for_path", { path: activePath });
        setFloatOpen(false);
        setStatus("Pinned preview closed");
      } else {
        // Unfocused so the editor keeps focus (and keyboard shortcuts).
        await invoke("snipping_open_snip_float", { path: activePath, focused: false });
        setFloatOpen(true);
        setStatus("Pinned to screen");
      }
    } catch (error) {
      setStatus(error?.message || String(error || "Pin failed"));
    }
  }, [activePath, floatOpen]);

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

  const workspaceOptions = useMemo(() => dispatchTargets.map((target) => ({
    label: text(target.workspaceName, target.workspaceId),
    value: target.workspaceId,
  })), [dispatchTargets]);

  const threadOptions = useMemo(() => [
    { color: "", label: "Any terminal", value: "" },
    ...(targetWorkspace?.threads || []).map((thread, index) => ({
      color: sanitizeTerminalColor(
        thread.color,
        Number.isInteger(thread.terminalIndex) ? thread.terminalIndex : index,
      ),
      label: text(thread.label, thread.threadId),
      value: thread.threadId,
    })),
  ], [targetWorkspace]);

  useEffect(() => {
    setTargetThreadId((current) => {
      if (!current) return current;
      const threads = targetWorkspace?.threads || [];
      return threads.some((thread) => thread.threadId === current) ? current : "";
    });
  }, [targetWorkspace]);

  useFloatingWindowBody("editor");

  const beginEditorDispose = useCallback(() => {
    editorClosingRef.current = true;
    setEditorClosing(true);
    drawingRef.current = false;
    draftRef.current = null;
    imageRef.current = null;
    setDraft(null);
    setTextEditor(null);
    setHoverIndex(-1);
    setStatus("");
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = 0;
    }
    if (livePreviewTimerRef.current) {
      window.clearTimeout(livePreviewTimerRef.current);
      livePreviewTimerRef.current = 0;
    }
    if (livePreviewFrameCanvasRef.current) {
      livePreviewFrameCanvasRef.current.width = 0;
      livePreviewFrameCanvasRef.current.height = 0;
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    const ownLabel = getCurrentWindow().label;

    listen(SNIPPING_EDITOR_DISPOSE_EVENT, (event) => {
      if (disposed) return;
      const payload = event?.payload || {};
      if (text(payload.label) !== ownLabel) return;
      beginEditorDispose();
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
      editorClosingRef.current = true;
      if (autosaveTimerRef.current) window.clearTimeout(autosaveTimerRef.current);
      if (livePreviewTimerRef.current) window.clearTimeout(livePreviewTimerRef.current);
      unlisten();
    };
  }, [beginEditorDispose]);

  // The native window is created hidden; reveal it only once this webview has
  // committed its first painted frame (double rAF) so opening never flashes
  // an unpainted window.
  useEffect(() => {
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        const current = getCurrentWindow();
        current.show().then(() => current.setFocus()).catch(() => {});
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const updateActiveAnnotations = useCallback((updater) => {
    if (editorClosingRef.current) return;
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
    if (editorClosingRef.current) return undefined;
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
      if (disposed || editorClosingRef.current) return;
      imageRef.current = image;
      setCanvasSize({ width: image.naturalWidth || image.width, height: image.naturalHeight || image.height });
      setStatus(multiImage ? `Ready ${activeIndex + 1}/${localPaths.length}` : "Ready");
    };
    image.onerror = () => {
      if (!disposed && !editorClosingRef.current) setStatus("Unable to load snip.");
    };

    // WebKit blocks fetch() on asset: URLs ("Load failed"); read the bytes
    // through the backend instead, which also keeps the canvas untainted.
    invoke("snipping_read_asset_data_url", { path: activePath })
      .then((dataUrl) => {
        if (disposed || editorClosingRef.current) return;
        image.src = dataUrl;
      })
      .catch((error) => {
        if (!disposed && !editorClosingRef.current) {
          setStatus(error?.message || String(error || "Unable to load snip."));
        }
      });

    return () => {
      disposed = true;
      image.onload = null;
      image.onerror = null;
      image.src = "";
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [activeIndex, localPaths.length, multiImage, previewUrl]);

  // Stage size drives the fit scale; track it live so window resizes keep
  // the image filling the available area.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || typeof window.ResizeObserver !== "function") return undefined;
    const observer = new window.ResizeObserver(() => {
      setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    });
    observer.observe(viewport);
    setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  // Switching images resets to fit.
  useEffect(() => {
    setZoom(1);
  }, [activePath]);

  const fitScale = useMemo(() => {
    if (!canvasSize.width || !canvasSize.height || !viewportSize.width || !viewportSize.height) return 1;
    // The sizer adds 4px padding per side; account for it so "fit" never
    // shows scrollbars.
    return Math.max(
      0.05,
      Math.min(
        (viewportSize.width - 8) / canvasSize.width,
        (viewportSize.height - 8) / canvasSize.height,
      ),
    );
  }, [canvasSize.height, canvasSize.width, viewportSize.height, viewportSize.width]);
  const displayWidth = Math.max(1, Math.round(canvasSize.width * fitScale * zoom));
  const displayHeight = Math.max(1, Math.round(canvasSize.height * fitScale * zoom));

  const setZoomAnchored = useCallback((nextZoom, clientX, clientY) => {
    const clamped = Math.min(8, Math.max(0.25, nextZoom));
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (viewport && canvas) {
      const canvasRect = canvas.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const anchorX = typeof clientX === "number" ? clientX : viewportRect.left + viewportRect.width / 2;
      const anchorY = typeof clientY === "number" ? clientY : viewportRect.top + viewportRect.height / 2;
      pendingZoomAnchorRef.current = {
        fractionX: (anchorX - canvasRect.left) / Math.max(1, canvasRect.width),
        fractionY: (anchorY - canvasRect.top) / Math.max(1, canvasRect.height),
        viewportX: anchorX - viewportRect.left,
        viewportY: anchorY - viewportRect.top,
      };
    }
    setZoom(clamped);
  }, []);

  // After the zoom re-render, scroll so the anchored image point stays under
  // the pointer instead of the view jumping back to center.
  useLayoutEffect(() => {
    const anchor = pendingZoomAnchorRef.current;
    if (!anchor) return;
    pendingZoomAnchorRef.current = null;
    const viewport = viewportRef.current;
    const canvas = canvasRef.current;
    if (!viewport || !canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
    const viewportRect = viewport.getBoundingClientRect();
    const contentX = canvasRect.left - viewportRect.left + viewport.scrollLeft;
    const contentY = canvasRect.top - viewportRect.top + viewport.scrollTop;
    viewport.scrollLeft = contentX + anchor.fractionX * canvasRect.width - anchor.viewportX;
    viewport.scrollTop = contentY + anchor.fractionY * canvasRect.height - anchor.viewportY;
  }, [zoom]);

  // Native listeners: WKWebView treats React's synthetic onWheel as passive
  // (preventDefault dropped), and trackpad pinches arrive as gesture events,
  // not ctrl-wheels.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      const step = event.ctrlKey ? -event.deltaY * 0.01 : -event.deltaY * 0.0022;
      setZoomAnchored(zoomRef.current * Math.exp(step), event.clientX, event.clientY);
    };
    let gestureStartZoom = 1;
    const handleGestureStart = (event) => {
      event.preventDefault();
      gestureStartZoom = zoomRef.current;
    };
    const handleGestureChange = (event) => {
      event.preventDefault();
      setZoomAnchored(gestureStartZoom * (event.scale || 1), event.clientX, event.clientY);
    };
    viewport.addEventListener("wheel", handleWheel, { passive: false });
    viewport.addEventListener("gesturestart", handleGestureStart);
    viewport.addEventListener("gesturechange", handleGestureChange);
    return () => {
      viewport.removeEventListener("wheel", handleWheel);
      viewport.removeEventListener("gesturestart", handleGestureStart);
      viewport.removeEventListener("gesturechange", handleGestureChange);
    };
  }, [setZoomAnchored]);

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !canvasSize.width || !canvasSize.height) return;
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const context = canvas.getContext("2d");
    const combined = draft ? [...annotations, draft] : annotations;
    renderAnnotationsToContext(context, image, combined, { preview: true });
    if (!draft && hoverIndex >= 0 && hoverIndex < annotations.length) {
      drawHoverOutline(context, annotations[hoverIndex]);
    }
  }, [annotations, canvasSize.height, canvasSize.width, draft, hoverIndex]);

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

  // Text/number badge dimensions in image pixels: keyed off the shared
  // stroke selector, scaled up for very large captures.
  const imageScale = Math.max(1, canvasSize.width / 1400);
  const textFontPx = Math.round((TEXT_SIZE_BY_STROKE[strokeWidth] || 26) * imageScale);
  const numberRadiusPx = Math.round((NUMBER_RADIUS_BY_STROKE[strokeWidth] || 18) * imageScale);

  useEffect(() => {
    textEditorRef.current = textEditor;
  }, [textEditor]);

  // Switching images abandons any half-typed text annotation.
  useEffect(() => {
    setTextEditor(null);
  }, [activePath]);

  const commitTextEditor = useCallback(() => {
    const editor = textEditorRef.current;
    if (!editor) return;
    setTextEditor(null);
    const value = String(editor.value || "").replace(/\s+$/u, "");
    if (!value.trim()) return;
    const card = resolveTextCardStyle(textBg, color);
    updateActiveAnnotations((current) => [
      ...current,
      {
        type: "text",
        x: editor.x,
        y: editor.y,
        text: value,
        color,
        bg: card.bg,
        textColor: card.textColor,
        size: textFontPx,
      },
    ]);
    setStatus("Text added");
  }, [color, textBg, textFontPx, updateActiveAnnotations]);

  // Inline text editing: clicking with the text tool drops a real input on
  // the canvas (window.prompt is unavailable inside the Tauri webview).
  const openTextEditor = useCallback((point) => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    const canvasRect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    const scale = canvasRect.width / canvas.width;
    setTextEditor({
      x: point.x,
      y: point.y,
      left: canvasRect.left - stageRect.left + point.x * scale,
      top: canvasRect.top - stageRect.top + point.y * scale,
      scale,
      value: "",
    });
  }, []);

  const selectTool = useCallback((option) => {
    commitTextEditor();
    setTool(option.tool);
    if (option.shape) setShapeKind(option.shape);
    if (option.mode) setShapeMode(option.mode);
  }, [commitTextEditor]);

  const isToolOptionActive = useCallback((option) => (
    option.tool === "shape"
      ? tool === "shape" && shapeKind === option.shape && shapeMode === option.mode
      : tool === option.tool
  ), [shapeKind, shapeMode, tool]);

  // Removes the topmost annotation under the point, using the same hit
  // shapes hover and ⌘C use; sweeping back over a spot peels stacked
  // annotations one pass at a time. Hover is reset because indexes shift.
  const eraseAtPoint = useCallback((point) => {
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    updateActiveAnnotations((current) => {
      const index = annotationAtPoint(current, point, context);
      if (index < 0) return current;
      erasedCountRef.current += 1;
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
    setHoverIndex(-1);
  }, [updateActiveAnnotations]);

  const beginDraw = useCallback((event) => {
    if (event.button !== 0 || !canvasSize.width || !canvasSize.height) return;
    event.preventDefault();
    const point = pointFromEvent(event);
    const hadTextEditor = Boolean(textEditorRef.current);
    if (hadTextEditor) commitTextEditor();
    if (tool === "eraser") {
      erasingRef.current = true;
      erasedCountRef.current = 0;
      eraseAtPoint(point);
      return;
    }
    if (tool === "text") {
      // The first click after an open editor only commits it; the next click
      // starts a fresh label.
      if (!hadTextEditor) openTextEditor(point);
      return;
    }
    if (tool === "number") {
      updateActiveAnnotations((current) => {
        const nextValue = current.reduce(
          (max, annotation) => (annotation.type === "number" ? Math.max(max, annotation.value || 0) : max),
          0,
        ) + 1;
        return [
          ...current,
          { type: "number", x: point.x, y: point.y, value: nextValue, color, radius: numberRadiusPx },
        ];
      });
      setStatus("Number added");
      return;
    }
    const base = {
      color,
      size: strokeWidth,
      startX: point.x,
      startY: point.y,
      endX: point.x,
      endY: point.y,
    };
    const annotation = tool === "pen" ? { ...base, type: "pen", points: [point] }
      : tool === "line" ? { ...base, type: "line" }
        : tool === "arrow" ? { ...base, type: "arrow" }
          : tool === "blur" ? {
            ...base,
            type: "blur",
            strategy: blurStrategy,
            power: blurPower,
            // The noise layer is seeded so redraws are stable frame to frame.
            seed: Math.floor(Math.random() * 2 ** 31),
          }
            : tool === "crop" ? { ...base, type: "crop" }
              : { ...base, type: "shape", shape: shapeKind, mode: shapeMode };
    draftRef.current = annotation;
    drawingRef.current = true;
    setDraft(annotation);
  }, [blurPower, blurStrategy, canvasSize.height, canvasSize.width, color, commitTextEditor, eraseAtPoint, numberRadiusPx, openTextEditor, pointFromEvent, shapeKind, shapeMode, strokeWidth, tool, updateActiveAnnotations]);

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
    if (erasingRef.current) {
      erasingRef.current = false;
      setStatus(erasedCountRef.current
        ? `Erased ${erasedCountRef.current} annotation${erasedCountRef.current === 1 ? "" : "s"}`
        : "Nothing to erase there");
      erasedCountRef.current = 0;
      return;
    }
    if (!drawingRef.current || !draftRef.current) return;
    const annotation = draftRef.current;
    drawingRef.current = false;
    draftRef.current = null;
    setDraft(null);
    // Area tools ignore accidental click-without-drag gestures.
    const needsArea = annotation.type === "shape" || annotation.type === "blur" || annotation.type === "crop";
    if (needsArea
      && (Math.abs(annotation.endX - annotation.startX) < 4 || Math.abs(annotation.endY - annotation.startY) < 4)) {
      return;
    }
    if (annotation.type === "crop") {
      // One crop per image: redrawing replaces it, undo removes it.
      updateActiveAnnotations((current) => [...current.filter((item) => item.type !== "crop"), annotation]);
      setStatus("Crop set — saves and sends use the cropped area");
      return;
    }
    updateActiveAnnotations((current) => [...current, annotation]);
    setStatus("Annotation added");
  }, [updateActiveAnnotations]);

  const handleCanvasMouseMove = useCallback((event) => {
    const point = pointFromEvent(event);
    cursorRef.current = { x: point.x, y: point.y, inside: true };
    if (erasingRef.current) {
      eraseAtPoint(point);
      return;
    }
    if (drawingRef.current) {
      setHoverIndex(-1);
      updateDraw(event);
      return;
    }
    const context = canvasRef.current?.getContext("2d");
    setHoverIndex(context ? annotationAtPoint(annotations, point, context) : -1);
  }, [annotations, eraseAtPoint, pointFromEvent, updateDraw]);

  const handleCanvasMouseLeave = useCallback(() => {
    cursorRef.current = { ...cursorRef.current, inside: false };
    setHoverIndex(-1);
    finishDraw();
  }, [finishDraw]);

  // ⌘C/⌘X over an annotation copies/cuts the topmost one under the cursor;
  // ⌘V pastes the clipboard centered on the current cursor position (or
  // staggered next to the original when the cursor is off the canvas). The
  // clipboard survives image switches, so annotations copy across snips.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "x" && key !== "v") return;
      const target = event.target;
      const tag = String(target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      const context = canvasRef.current?.getContext("2d");
      if (!context) return;
      if (key === "c" || key === "x") {
        const cursor = cursorRef.current;
        if (!cursor.inside) return;
        const index = annotationAtPoint(annotations, cursor, context);
        if (index < 0) return;
        event.preventDefault();
        annotationClipboardRef.current = JSON.parse(JSON.stringify(annotations[index]));
        pasteSpreadRef.current = 0;
        const label = annotationLabel(annotations[index]);
        if (key === "x") {
          updateActiveAnnotations((current) => current.filter((_, itemIndex) => itemIndex !== index));
          setHoverIndex(-1);
          setStatus(`Cut ${label} — ⌘V pastes at the cursor`);
        } else {
          setStatus(`Copied ${label} — ⌘V pastes at the cursor`);
        }
        return;
      }
      const clip = annotationClipboardRef.current;
      if (!clip) return;
      const bounds = annotationDisplayBounds(clip, context);
      if (!bounds) return;
      event.preventDefault();
      const cursor = cursorRef.current;
      let dx;
      let dy;
      if (cursor.inside) {
        dx = cursor.x - (bounds.x + bounds.width / 2);
        dy = cursor.y - (bounds.y + bounds.height / 2);
      } else {
        // No cursor anchor: stagger repeat pastes so copies don't stack.
        pasteSpreadRef.current += 1;
        dx = 26 * pasteSpreadRef.current;
        dy = 26 * pasteSpreadRef.current;
      }
      const pasted = translateAnnotation(clip, dx, dy);
      if (pasted.type === "blur") {
        pasted.seed = Math.floor(Math.random() * 2 ** 31);
      }
      updateActiveAnnotations((current) => {
        if (pasted.type === "number") {
          pasted.value = current.reduce(
            (max, item) => (item.type === "number" ? Math.max(max, item.value || 0) : max),
            0,
          ) + 1;
        }
        return [...current, pasted];
      });
      setStatus(`Pasted ${annotationLabel(pasted)}`);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [annotations, updateActiveAnnotations]);

  const undo = useCallback(() => {
    updateActiveAnnotations((current) => current.slice(0, -1));
    setStatus("Undone");
  }, [updateActiveAnnotations]);

  // Exports re-render from the source image (never the visible canvas): the
  // preview canvas carries UI-only chrome like the crop overlay, and crop
  // itself changes the output dimensions.
  const exportActiveDataUrl = useCallback(() => {
    const image = imageRef.current;
    if (!image) return "";
    return exportAnnotatedCanvas(image, annotationsByPath[activePath] || []).toDataURL("image/png");
  }, [activePath, annotationsByPath]);

  const copyCanvas = useCallback(async () => {
    setStatus("Copying image...");
    try {
      const imageDataUrl = exportActiveDataUrl();
      if (!imageDataUrl) return;
      await invoke("diffforge_copy_image_data_url_to_clipboard", {
        imageDataUrl,
      });
      setStatus("Copied annotated image");
    } catch (error) {
      setStatus(error?.message || String(error || "Unable to copy image."));
    }
  }, [exportActiveDataUrl]);

  // Streams the composited canvas to the snip preview window while drawing,
  // so edits are visible there live (downscaled JPEG frames, throttled).
  const emitLivePreviewFrame = useCallback(() => {
    if (editorClosingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas || !activePath || !canvas.width || !canvas.height) return;

    let dataUrl = "";
    try {
      // Cap BOTH edges: the old width-only cap let tall captures through at
      // full resolution, which made every frame a multi-megapixel JPEG
      // encode — the actual source of the preview lag. The frame canvas is
      // reused across frames to avoid a per-frame allocation.
      const scale = Math.min(
        1,
        SNIPPING_LIVE_PREVIEW_MAX_EDGE / canvas.width,
        SNIPPING_LIVE_PREVIEW_MAX_EDGE / canvas.height,
      );
      if (scale < 1) {
        let frame = livePreviewFrameCanvasRef.current;
        if (!frame) {
          frame = document.createElement("canvas");
          livePreviewFrameCanvasRef.current = frame;
        }
        const frameWidth = Math.max(1, Math.round(canvas.width * scale));
        const frameHeight = Math.max(1, Math.round(canvas.height * scale));
        if (frame.width !== frameWidth) frame.width = frameWidth;
        if (frame.height !== frameHeight) frame.height = frameHeight;
        frame.getContext("2d").drawImage(canvas, 0, 0, frameWidth, frameHeight);
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
    if (editorClosingRef.current) return undefined;
    if (!canvasSize.width || !canvasSize.height) return undefined;
    if (!draft && !(annotationsByPath[activePath] || []).length) return undefined;

    const elapsed = Date.now() - livePreviewLastSentRef.current;
    const delay = Math.max(16, SNIPPING_LIVE_PREVIEW_THROTTLE_MS - elapsed);
    if (livePreviewTimerRef.current) {
      window.clearTimeout(livePreviewTimerRef.current);
    }
    livePreviewTimerRef.current = window.setTimeout(() => {
      livePreviewTimerRef.current = 0;
      if (editorClosingRef.current) return;
      livePreviewLastSentRef.current = Date.now();
      emitLivePreviewFrame();
    }, delay);

    // Intentionally no cleanup on dependency change: the trailing frame must
    // still fire after the last stroke update settles.
    return undefined;
  }, [activePath, annotationsByPath, canvasSize.height, canvasSize.width, draft, emitLivePreviewFrame]);

  useEffect(() => () => {
    editorClosingRef.current = true;
    if (livePreviewTimerRef.current) {
      window.clearTimeout(livePreviewTimerRef.current);
      livePreviewTimerRef.current = 0;
    }
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = 0;
    }
  }, []);
  const persistAnnotatedImage = useCallback(async () => {
    if (editorClosingRef.current) return;
    if (!imageRef.current || !activePath) return;
    if (!(annotationsByPath[activePath] || []).length) return;
    setStatus("Saving…");
    try {
      const imageDataUrl = exportActiveDataUrl();
      if (!imageDataUrl) return;
      const sourcePath = autosaveTargetsRef.current[activePath] || activePath;
      if (editorClosingRef.current) return;
      const result = await invoke("snipping_save_edited_untracked_asset", {
        request: {
          imageDataUrl,
          sourcePath,
        },
      });
      const savedPath = text(result?.local_path || result?.localPath || result?.path);
      if (editorClosingRef.current) return;
      if (savedPath) {
        autosaveTargetsRef.current[activePath] = savedPath;
      }
      setStatus("Saved");
    } catch (error) {
      setStatus(error?.message || String(error || "Unable to save annotated image."));
    }
  }, [activePath, annotationsByPath, exportActiveDataUrl]);

  useEffect(() => {
    if (editorClosingRef.current) return undefined;
    if (!(annotationsByPath[activePath] || []).length) return undefined;
    window.clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = window.setTimeout(() => {
      if (editorClosingRef.current) return;
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
        const imageDataUrl = activePath === path && imageRef.current
          ? exportActiveDataUrl()
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
  }, [activePath, annotationsByPath, exportActiveDataUrl, localPaths, name, targetThreadId, targetWorkspace, targetWorkspaceId, todoDraft]);

  const closeEditor = useCallback(() => {
    beginEditorDispose();
    const current = getCurrentWindow();
    const label = text(current.label);
    if (!label.startsWith(SNIPPING_EDITOR_WINDOW_PREFIX)) {
      current.close().catch(() => {});
      return;
    }
    invoke("snipping_close_annotation_editor", { label }).catch(() => {
      current.close().catch(() => {});
    });
  }, [beginEditorDispose]);

  const savedState = status === "Saved" ? "saved" : status === "Saving…" ? "saving" : "idle";

  return (
    <>
      <SnipFloatingGlobalStyle />
      <EditorViewport>
        <EditorWindowRoot data-closing={editorClosing ? "true" : "false"}>
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

          <EditorStage ref={stageRef}>
            <EditorCanvasViewport ref={viewportRef}>
              <EditorCanvasSizer>
                <canvas
                  aria-label="Snip annotation canvas"
                  onMouseDown={beginDraw}
                  onMouseLeave={handleCanvasMouseLeave}
                  onMouseMove={handleCanvasMouseMove}
                  onMouseUp={finishDraw}
                  ref={canvasRef}
                  style={canvasSize.width > 0 ? { width: displayWidth, height: displayHeight } : undefined}
                />
              </EditorCanvasSizer>
            </EditorCanvasViewport>
            {textEditor && (() => {
              const card = resolveTextCardStyle(textBg, color);
              return (
                <EditorTextOverlayInput
                  autoFocus
                  aria-label="Text annotation"
                  onChange={(event) => {
                    const value = event.target.value;
                    setTextEditor((current) => (current ? { ...current, value } : current));
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      commitTextEditor();
                    } else if (event.key === "Escape") {
                      setTextEditor(null);
                    }
                  }}
                  placeholder="Type…"
                  rows={textEditor.value.split("\n").length}
                  style={{
                    left: textEditor.left,
                    top: textEditor.top,
                    fontSize: Math.max(11, textFontPx * textEditor.scale),
                    color: card.textColor,
                    background: card.bg || "transparent",
                    width: `${Math.min(48, Math.max(8, textEditor.value.split("\n")
                      .reduce((max, line) => Math.max(max, line.length), 0) + 3))}ch`,
                  }}
                  value={textEditor.value}
                />
              );
            })()}
            {/* Creation tools stay on the left rail; the act-on-the-result
                buttons live top-right (under the batch strip when several
                images are selected) where they are quickest to reach. */}
            <EditorActionCluster aria-label="Annotation actions">
              <EditorToolButton aria-label="Zoom out" onClick={() => setZoomAnchored(zoom / 1.25)} title="Zoom out" type="button">
                <ZoomOut aria-hidden="true" />
              </EditorToolButton>
              <EditorZoomReadout
                aria-label="Reset zoom to fit"
                onClick={() => setZoom(1)}
                title="Reset zoom to fit"
                type="button"
              >
                {Math.round(fitScale * zoom * 100)}%
              </EditorZoomReadout>
              <EditorToolButton aria-label="Zoom in" onClick={() => setZoomAnchored(zoom * 1.25)} title="Zoom in" type="button">
                <ZoomIn aria-hidden="true" />
              </EditorToolButton>
              <EditorBarDivider aria-hidden="true" />
              <EditorToolButton aria-label="Undo" disabled={!annotations.length} onClick={undo} title="Undo" type="button">
                <Undo aria-hidden="true" />
              </EditorToolButton>
              <EditorToolButton aria-label="Clear annotations" disabled={!annotations.length} onClick={() => { updateActiveAnnotations([]); setStatus("Cleared"); }} title="Clear" type="button">
                <Delete aria-hidden="true" />
              </EditorToolButton>
              <EditorToolButton aria-label="Copy annotated image" onClick={copyCanvas} title="Copy image" type="button">
                <ContentCopy aria-hidden="true" />
              </EditorToolButton>
              <EditorToolButton
                aria-label={floatOpen ? "Close pinned preview" : "Pin as draggable preview"}
                onClick={toggleFloatPin}
                title={floatOpen ? "Close pinned preview" : "Pin as draggable preview"}
                type="button"
              >
                {floatOpen ? (
                  <Close aria-hidden="true" />
                ) : (
                  <svg aria-hidden="true" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z" />
                  </svg>
                )}
              </EditorToolButton>
            </EditorActionCluster>
            <EditorFloatingRail aria-label="Annotation tools">
              {TOOL_GROUPS.map((group, groupIndex) => (
                <Fragment key={group[0].id}>
                  {groupIndex > 0 && <EditorRailDivider aria-hidden="true" />}
                  <EditorToolGroup>
                    {group.map((option) => (
                      <EditorToolButton
                        aria-label={option.label}
                        data-active={isToolOptionActive(option)}
                        key={option.id}
                        onClick={() => selectTool(option)}
                        title={option.label}
                        type="button"
                      >
                        <option.Icon aria-hidden="true" />
                      </EditorToolButton>
                    ))}
                  </EditorToolGroup>
                </Fragment>
              ))}
            </EditorFloatingRail>
            {/* Style + contextual options live in one bottom pill: colors and
                stroke size are always one click away, and the active tool
                appends its own controls (shape kind/fill, blur strategy and
                power, text card background, crop reset) instead of cramming
                everything into the rail. */}
            <EditorOptionsBar aria-label="Style and tool options">
              <EditorToolGroup data-compact="true" data-row="true">
                {COLOR_OPTIONS.map((option) => (
                  <ColorButton aria-label={`Use ${option}`} data-active={color === option} key={option} onClick={() => setColor(option)} style={{ "--snip-color": option }} title={option} type="button" />
                ))}
                <CustomColorButton data-active={!COLOR_OPTIONS.includes(color)} title="Custom color">
                  <input
                    aria-label="Custom color"
                    onChange={(event) => setColor(event.target.value)}
                    type="color"
                    value={color}
                  />
                </CustomColorButton>
              </EditorToolGroup>
              <EditorBarDivider aria-hidden="true" />
              <EditorToolGroup data-compact="true" data-row="true">
                {STROKE_OPTIONS.map((size) => (
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
              {tool === "shape" && (
                <>
                  <EditorBarDivider aria-hidden="true" />
                  <EditorToolGroup data-row="true">
                    {SHAPE_KIND_OPTIONS.map((option) => (
                      <EditorToolButton
                        aria-label={option.label}
                        data-active={shapeKind === option.id}
                        key={option.id}
                        onClick={() => setShapeKind(option.id)}
                        title={option.label}
                        type="button"
                      >
                        <option.Icon aria-hidden="true" />
                      </EditorToolButton>
                    ))}
                  </EditorToolGroup>
                  <EditorBarDivider aria-hidden="true" />
                  <EditorToolGroup data-row="true">
                    {SHAPE_MODE_OPTIONS.map((option) => (
                      <EditorToolButton
                        aria-label={option.label}
                        data-active={shapeMode === option.id}
                        key={option.id}
                        onClick={() => setShapeMode(option.id)}
                        title={option.label}
                        type="button"
                      >
                        <option.Icon aria-hidden="true" />
                      </EditorToolButton>
                    ))}
                  </EditorToolGroup>
                </>
              )}
              {tool === "blur" && (
                <>
                  <EditorBarDivider aria-hidden="true" />
                  <EditorToolGroup data-row="true">
                    {BLUR_STRATEGY_OPTIONS.map((option) => (
                      <EditorToolButton
                        aria-label={option.label}
                        data-active={blurStrategy === option.id}
                        key={option.id}
                        onClick={() => setBlurStrategy(option.id)}
                        title={option.label}
                        type="button"
                      >
                        <option.Icon aria-hidden="true" />
                      </EditorToolButton>
                    ))}
                  </EditorToolGroup>
                  <EditorBarDivider aria-hidden="true" />
                  <EditorToolGroup data-compact="true" data-row="true">
                    {BLUR_POWER_OPTIONS.map((power) => (
                      <SizeDotButton
                        aria-label={`Blur power ${power}`}
                        data-active={blurPower === power ? "true" : "false"}
                        key={power}
                        onClick={() => setBlurPower(power)}
                        title={`Blur power ${power}`}
                        type="button"
                      >
                        <i aria-hidden="true" style={{ width: power * 2 + 3, height: power * 2 + 3 }} />
                      </SizeDotButton>
                    ))}
                  </EditorToolGroup>
                </>
              )}
              {tool === "text" && (
                <>
                  <EditorBarDivider aria-hidden="true" />
                  <EditorToolGroup data-compact="true" data-row="true">
                    {TEXT_BG_OPTIONS.map((option) => (
                      <TextBgButton
                        aria-label={option.label}
                        data-active={textBg === option.id}
                        data-kind={option.id}
                        key={option.id}
                        onClick={() => setTextBg(option.id)}
                        style={option.id === "accent" ? { "--snip-color": color } : undefined}
                        title={option.label}
                        type="button"
                      />
                    ))}
                  </EditorToolGroup>
                </>
              )}
              {tool === "crop" && hasCrop && (
                <>
                  <EditorBarDivider aria-hidden="true" />
                  <EditorBarTextButton
                    onClick={() => {
                      updateActiveAnnotations((current) => current.filter((item) => item.type !== "crop"));
                      setStatus("Crop cleared");
                    }}
                    type="button"
                  >
                    Reset crop
                  </EditorBarTextButton>
                </>
              )}
            </EditorOptionsBar>
          </EditorStage>

          <EditorComposer onSubmit={queueTodo}>
            <EditorComposerInner>
              <input
                aria-label="Todo for coding agent"
                onChange={(event) => setTodoDraft(event.target.value)}
                placeholder="Circle an area, describe the fix, send it to an agent…"
                value={todoDraft}
              />
              <EditorComposerControls>
                <Select
                  aria-label="Target workspace"
                  formatOptionLabel={workspaceOptionLabelRenderer}
                  isDisabled={!dispatchTargets.length}
                  isSearchable={false}
                  menuPlacement="top"
                  onChange={(option) => setTargetWorkspaceId(option?.value || "")}
                  options={workspaceOptions}
                  placeholder="Workspace"
                  styles={TARGET_SELECT_STYLES}
                  value={workspaceOptions.find((option) => option.value === targetWorkspaceId) || null}
                />
                <Select
                  aria-label="Target terminal"
                  formatOptionLabel={terminalOptionLabelRenderer}
                  isDisabled={!(targetWorkspace?.threads || []).length}
                  isSearchable={false}
                  menuPlacement="top"
                  onChange={(option) => setTargetThreadId(option?.value || "")}
                  options={threadOptions}
                  placeholder="Any terminal"
                  styles={TARGET_SELECT_STYLES}
                  value={threadOptions.find((option) => option.value === targetThreadId) || threadOptions[0] || null}
                />
                <EditorSendButton aria-label="Queue todo with this image" disabled={!todoDraft.trim()} title="Queue todo with this image" type="submit">
                  <Send aria-hidden="true" />
                </EditorSendButton>
              </EditorComposerControls>
            </EditorComposerInner>
          </EditorComposer>
        </EditorWindowRoot>
      </EditorViewport>
    </>
  );
}

// --- Annotation rendering pipeline ---------------------------------------
//
// Annotations render in fixed passes so the result is deterministic no matter
// the order things were drawn in: blur redactions touch the raw image first,
// then spotlight highlights dim everything that is not highlighted, then the
// drawn marks (pen/line/arrow/shapes/text/numbers) layer on top in creation
// order. Crop never paints — it narrows the export bounds (and shows as a
// preview-only overlay in the editor).
function renderAnnotationsToContext(context, image, annotations, { preview = false } = {}) {
  const canvas = context.canvas;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  annotations.forEach((annotation) => {
    if (annotation?.type === "blur") applyBlurAnnotation(context, annotation);
  });
  applySpotlightPass(
    context,
    annotations.filter((annotation) => annotation?.type === "shape" && annotation.mode === "spotlight"),
  );
  annotations.forEach((annotation) => {
    if (!annotation || annotation.type === "blur" || annotation.type === "crop") return;
    if (annotation.type === "shape" && annotation.mode === "spotlight") return;
    drawAnnotation(context, annotation);
  });
  if (preview) {
    const crop = lastCropOf(annotations);
    if (crop) drawCropOverlay(context, crop);
  }
}

function lastCropOf(annotations) {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    if (annotations[index]?.type === "crop") return annotations[index];
  }
  return null;
}

function exportAnnotatedCanvas(image, annotations = []) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  renderAnnotationsToContext(context, image, annotations);
  const crop = lastCropOf(annotations);
  if (!crop) return canvas;
  const region = annotationBounds(crop, canvas);
  if (region.width < 4 || region.height < 4) return canvas;
  const cropped = document.createElement("canvas");
  cropped.width = Math.round(region.width);
  cropped.height = Math.round(region.height);
  cropped.getContext("2d").drawImage(
    canvas,
    region.x, region.y, region.width, region.height,
    0, 0, cropped.width, cropped.height,
  );
  return cropped;
}

// --- Cursor hit-testing for copy/paste ------------------------------------

function normalizedBox(annotation) {
  const x = Math.min(annotation.startX, annotation.endX);
  const y = Math.min(annotation.startY, annotation.endY);
  return {
    x,
    y,
    width: Math.abs(annotation.endX - annotation.startX),
    height: Math.abs(annotation.endY - annotation.startY),
  };
}

function pointInBox(point, box, pad = 0) {
  if (!box) return false;
  return point.x >= box.x - pad
    && point.x <= box.x + box.width + pad
    && point.y >= box.y - pad
    && point.y <= box.y + box.height + pad;
}

function distanceToSegment(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq
    ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq))
    : 0;
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

function textAnnotationBounds(annotation, context) {
  const fontSize = annotation.size || 24;
  const lines = String(annotation.text || "").split("\n");
  context.save();
  context.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
  const textWidth = lines.reduce((max, line) => Math.max(max, context.measureText(line).width), 0);
  context.restore();
  const lineHeight = Math.round(fontSize * 1.25);
  const paddingX = annotation.bg ? Math.round(fontSize * 0.45) : 0;
  const paddingY = annotation.bg ? Math.round(fontSize * 0.3) : 0;
  return {
    x: annotation.x - paddingX,
    y: annotation.y - paddingY,
    width: textWidth + paddingX * 2,
    height: lineHeight * lines.length + paddingY * 2,
  };
}

/// Loose bounding box of any annotation, for hover outlines and paste
/// anchoring. Returns null when the annotation has no usable geometry.
function annotationDisplayBounds(annotation, context) {
  if (!annotation) return null;
  if (annotation.type === "text") return textAnnotationBounds(annotation, context);
  if (annotation.type === "number") {
    const radius = Math.max(10, annotation.radius || 18);
    return { x: annotation.x - radius, y: annotation.y - radius, width: radius * 2, height: radius * 2 };
  }
  if (annotation.type === "pen") {
    const points = annotation.points || [];
    if (!points.length) return null;
    const pad = (annotation.size || 5) / 2;
    const minX = points.reduce((min, point) => Math.min(min, point.x), Infinity);
    const minY = points.reduce((min, point) => Math.min(min, point.y), Infinity);
    const maxX = points.reduce((max, point) => Math.max(max, point.x), -Infinity);
    const maxY = points.reduce((max, point) => Math.max(max, point.y), -Infinity);
    return { x: minX - pad, y: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
  }
  if (typeof annotation.startX !== "number") return null;
  const pad = (annotation.size || 5) / 2;
  const box = normalizedBox(annotation);
  return { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
}

// Hit shapes follow what the annotation visually occupies: strokes test
// against the stroked path, filled/area shapes against their interior, and
// outlines only against a band around the border (so a big outline rect
// doesn't swallow every copy underneath it).
function annotationHitTest(annotation, point, context, pad) {
  if (annotation.type === "pen") {
    const points = annotation.points || [];
    const reach = (annotation.size || 5) / 2 + pad;
    if (!points.length) return false;
    if (points.length === 1) return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= reach;
    for (let index = 1; index < points.length; index += 1) {
      if (distanceToSegment(point, points[index - 1], points[index]) <= reach) return true;
    }
    return false;
  }
  if (annotation.type === "line" || annotation.type === "arrow") {
    const reach = (annotation.size || 5) / 2 + pad + (annotation.type === "arrow" ? 4 : 0);
    return distanceToSegment(
      point,
      { x: annotation.startX, y: annotation.startY },
      { x: annotation.endX, y: annotation.endY },
    ) <= reach;
  }
  if (annotation.type === "text") {
    return pointInBox(point, textAnnotationBounds(annotation, context), pad);
  }
  if (annotation.type === "number") {
    const radius = Math.max(10, annotation.radius || 18);
    return Math.hypot(point.x - annotation.x, point.y - annotation.y) <= radius + pad;
  }
  if (annotation.type === "blur") {
    return pointInBox(point, normalizedBox(annotation), pad);
  }
  if (annotation.type === "shape") {
    const box = normalizedBox(annotation);
    const stroke = (annotation.size || 5) / 2;
    if (annotation.shape === "oval") {
      const centerX = box.x + box.width / 2;
      const centerY = box.y + box.height / 2;
      const inside = (radiusX, radiusY) => radiusX > 0 && radiusY > 0
        && ((point.x - centerX) / radiusX) ** 2 + ((point.y - centerY) / radiusY) ** 2 <= 1;
      if (annotation.mode === "outline") {
        return inside(box.width / 2 + stroke + pad, box.height / 2 + stroke + pad)
          && !inside(box.width / 2 - stroke - pad, box.height / 2 - stroke - pad);
      }
      return inside(box.width / 2 + pad, box.height / 2 + pad);
    }
    if (annotation.mode === "outline") {
      return pointInBox(point, box, stroke + pad) && !pointInBox(point, box, -(stroke + pad));
    }
    return pointInBox(point, box, pad);
  }
  return false;
}

/// Topmost annotation under the cursor (crop is positional, never copied).
function annotationAtPoint(annotations, point, context) {
  const pad = Math.max(6, context.canvas.width / 250);
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (!annotation || annotation.type === "crop") continue;
    if (annotationHitTest(annotation, point, context, pad)) return index;
  }
  return -1;
}

function translateAnnotation(annotation, dx, dy) {
  const moved = { ...annotation };
  if (Array.isArray(annotation.points)) {
    moved.points = annotation.points.map((point) => ({ ...point, x: point.x + dx, y: point.y + dy }));
  }
  if (typeof moved.startX === "number") {
    moved.startX += dx;
    moved.endX += dx;
    moved.startY += dy;
    moved.endY += dy;
  }
  if (typeof moved.x === "number") {
    moved.x += dx;
    moved.y += dy;
  }
  return moved;
}

function annotationLabel(annotation) {
  if (annotation?.type === "shape") {
    const shape = annotation.shape === "oval" ? "oval" : "rectangle";
    const mode = annotation.mode === "spotlight" ? "highlight "
      : annotation.mode === "marker" ? "highlighter "
        : annotation.mode === "solid" ? "solid " : "";
    return `${mode}${shape}`;
  }
  return {
    pen: "pen stroke",
    line: "line",
    arrow: "arrow",
    text: "text",
    number: "number badge",
    blur: "blur region",
  }[annotation?.type] || "annotation";
}

function drawHoverOutline(context, annotation) {
  const bounds = annotationDisplayBounds(annotation, context);
  if (!bounds) return;
  const pad = Math.max(4, context.canvas.width / 400);
  context.save();
  context.setLineDash([5, 4]);
  context.lineWidth = Math.max(1.25, context.canvas.width / 1200);
  context.strokeStyle = "rgba(147, 197, 253, 0.85)";
  context.strokeRect(bounds.x - pad, bounds.y - pad, bounds.width + pad * 2, bounds.height + pad * 2);
  context.restore();
}

/// Normalized start/end box clamped to the canvas.
function annotationBounds(annotation, canvas) {
  const left = Math.max(0, Math.min(annotation.startX, annotation.endX));
  const top = Math.max(0, Math.min(annotation.startY, annotation.endY));
  const right = Math.min(canvas.width, Math.max(annotation.startX, annotation.endX));
  const bottom = Math.min(canvas.height, Math.max(annotation.startY, annotation.endY));
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(0, Math.round(right - left)),
    height: Math.max(0, Math.round(bottom - top)),
  };
}

// Deterministic PRNG: blur noise must be identical on every redraw (and in
// the exported file) for a given annotation.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function contrastColorFor(color) {
  const hex = String(color || "").trim();
  const match = /^#?([0-9a-f]{6})$/iu.exec(hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex);
  if (!match) return "#f8fafc";
  const value = parseInt(match[1], 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0b1018" : "#f8fafc";
}

function colorWithAlpha(color, alpha) {
  const hex = String(color || "").trim();
  const normalized = /^#[0-9a-f]{3}$/iu.test(hex)
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const match = /^#([0-9a-f]{6})$/iu.exec(normalized);
  if (!match) return color;
  const value = parseInt(match[1], 16);
  return `rgba(${(value >> 16) & 0xff}, ${(value >> 8) & 0xff}, ${value & 0xff}, ${alpha})`;
}

function resolveTextCardStyle(bgOption, accent) {
  if (bgOption === "dark") return { bg: "rgba(8, 11, 17, 0.92)", textColor: accent };
  if (bgOption === "light") {
    // Near-white accents would vanish on the light card.
    return {
      bg: "rgba(248, 250, 252, 0.95)",
      textColor: contrastColorFor(accent) === "#0b1018" ? "#0b1018" : accent,
    };
  }
  if (bgOption === "accent") return { bg: accent, textColor: contrastColorFor(accent) };
  return { bg: null, textColor: accent };
}

// Destructive redaction: pixel data is destroyed by downscaling (block
// average or iterative resampling), then seeded noise is mixed in so the
// region cannot be deconvolved back to the original, while still reading as
// a smooth blur next to the rest of the image.
function applyBlurAnnotation(context, annotation) {
  const canvas = context.canvas;
  const region = annotationBounds(annotation, canvas);
  if (region.width < 3 || region.height < 3) return;
  const power = Math.min(5, Math.max(1, annotation.power || 3));
  const strategy = annotation.strategy || "pixelate";
  const scratch = document.createElement("canvas");
  const scratchContext = scratch.getContext("2d");
  if (strategy === "pixelate") {
    const block = Math.max(4, Math.round((Math.max(canvas.width, canvas.height) / 240) * power * 2.4));
    scratch.width = Math.max(1, Math.round(region.width / block));
    scratch.height = Math.max(1, Math.round(region.height / block));
    scratchContext.imageSmoothingEnabled = true;
    scratchContext.drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, scratch.width, scratch.height);
    context.save();
    context.imageSmoothingEnabled = false;
    context.drawImage(scratch, 0, 0, scratch.width, scratch.height, region.x, region.y, region.width, region.height);
    context.restore();
  } else {
    // smooth/static: two down/upscale bounces approximate a gaussian.
    const factor = 1.6 + power * 1.7;
    scratch.width = Math.max(1, Math.round(region.width / factor));
    scratch.height = Math.max(1, Math.round(region.height / factor));
    scratchContext.imageSmoothingEnabled = true;
    scratchContext.drawImage(canvas, region.x, region.y, region.width, region.height, 0, 0, scratch.width, scratch.height);
    const bounce = document.createElement("canvas");
    bounce.width = Math.max(1, Math.round(scratch.width / 2));
    bounce.height = Math.max(1, Math.round(scratch.height / 2));
    const bounceContext = bounce.getContext("2d");
    bounceContext.imageSmoothingEnabled = true;
    bounceContext.drawImage(scratch, 0, 0, scratch.width, scratch.height, 0, 0, bounce.width, bounce.height);
    context.save();
    context.imageSmoothingEnabled = true;
    context.drawImage(bounce, 0, 0, bounce.width, bounce.height, region.x, region.y, region.width, region.height);
    context.restore();
  }
  const noiseAmplitude = strategy === "static" ? 26 + power * 9 : 7 + power * 3;
  const random = mulberry32(annotation.seed || 1);
  const imageData = context.getImageData(region.x, region.y, region.width, region.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const noise = (random() - 0.5) * 2 * noiseAmplitude;
    data[index] += noise;
    data[index + 1] += noise;
    data[index + 2] += noise;
  }
  context.putImageData(imageData, region.x, region.y);
}

function traceShapePath(context, annotation) {
  context.beginPath();
  if (annotation.shape === "oval") {
    const centerX = (annotation.startX + annotation.endX) / 2;
    const centerY = (annotation.startY + annotation.endY) / 2;
    const radiusX = Math.abs(annotation.endX - annotation.startX) / 2;
    const radiusY = Math.abs(annotation.endY - annotation.startY) / 2;
    context.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
  } else {
    const x = Math.min(annotation.startX, annotation.endX);
    const y = Math.min(annotation.startY, annotation.endY);
    context.rect(x, y, Math.abs(annotation.endX - annotation.startX), Math.abs(annotation.endY - annotation.startY));
  }
}

// All spotlight shapes share one dim pass: the canvas (post-blur) is copied,
// everything dims once, and each highlighted region is restored from the
// copy — several spotlights never double-dim each other.
function applySpotlightPass(context, spotlights) {
  if (!spotlights.length) return;
  const canvas = context.canvas;
  const copy = document.createElement("canvas");
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext("2d").drawImage(canvas, 0, 0);
  context.save();
  context.fillStyle = "rgba(4, 7, 12, 0.62)";
  context.fillRect(0, 0, canvas.width, canvas.height);
  spotlights.forEach((annotation) => {
    context.save();
    traceShapePath(context, annotation);
    context.clip();
    context.drawImage(copy, 0, 0);
    context.restore();
    context.save();
    traceShapePath(context, annotation);
    context.lineWidth = Math.max(1.5, canvas.width / 1100);
    context.strokeStyle = "rgba(248, 250, 252, 0.55)";
    context.stroke();
    context.restore();
  });
  context.restore();
}

function drawCropOverlay(context, crop) {
  const canvas = context.canvas;
  const region = annotationBounds(crop, canvas);
  context.save();
  context.beginPath();
  context.rect(0, 0, canvas.width, canvas.height);
  context.rect(region.x, region.y, region.width, region.height);
  context.fillStyle = "rgba(3, 5, 9, 0.62)";
  context.fill("evenodd");
  context.setLineDash([7, 5]);
  context.lineWidth = Math.max(1.5, canvas.width / 900);
  context.strokeStyle = "rgba(248, 250, 252, 0.9)";
  context.strokeRect(region.x, region.y, region.width, region.height);
  context.restore();
}

function drawTextAnnotation(context, annotation) {
  const fontSize = annotation.size || 24;
  const lines = String(annotation.text || "").split("\n");
  context.save();
  context.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
  context.textBaseline = "top";
  const lineHeight = Math.round(fontSize * 1.25);
  const textWidth = lines.reduce((max, line) => Math.max(max, context.measureText(line).width), 0);
  if (annotation.bg) {
    const paddingX = Math.round(fontSize * 0.45);
    const paddingY = Math.round(fontSize * 0.3);
    const boxHeight = lineHeight * lines.length + paddingY * 2;
    context.beginPath();
    if (typeof context.roundRect === "function") {
      context.roundRect(annotation.x - paddingX, annotation.y - paddingY, textWidth + paddingX * 2, boxHeight, Math.min(10, fontSize * 0.4));
    } else {
      context.rect(annotation.x - paddingX, annotation.y - paddingY, textWidth + paddingX * 2, boxHeight);
    }
    context.fillStyle = annotation.bg;
    context.fill();
  }
  lines.forEach((line, index) => {
    const y = annotation.y + index * lineHeight;
    if (!annotation.bg) {
      // Bare text gets a contrast halo so it survives any backdrop.
      context.lineWidth = Math.max(2, fontSize / 9);
      context.lineJoin = "round";
      context.strokeStyle = contrastColorFor(annotation.color) === "#f8fafc"
        ? "rgba(248, 250, 252, 0.9)"
        : "rgba(5, 8, 13, 0.85)";
      context.strokeText(line, annotation.x, y);
    }
    context.fillStyle = annotation.textColor || annotation.color || "#ef4444";
    context.fillText(line, annotation.x, y);
  });
  context.restore();
}

function drawNumberAnnotation(context, annotation) {
  const radius = Math.max(10, annotation.radius || 18);
  context.save();
  context.beginPath();
  context.arc(annotation.x, annotation.y, radius, 0, Math.PI * 2);
  context.fillStyle = annotation.color || "#ef4444";
  context.fill();
  context.lineWidth = Math.max(2, radius * 0.14);
  context.strokeStyle = "rgba(248, 250, 252, 0.92)";
  context.stroke();
  context.fillStyle = contrastColorFor(annotation.color || "#ef4444");
  context.font = `800 ${Math.round(radius * 1.05)}px Inter, system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(String(annotation.value || 1), annotation.x, annotation.y + radius * 0.05);
  context.restore();
}

function drawAnnotation(context, annotation) {
  if (!annotation) return;
  if (annotation.type === "text") {
    drawTextAnnotation(context, annotation);
    return;
  }
  if (annotation.type === "number") {
    drawNumberAnnotation(context, annotation);
    return;
  }
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
  } else if (annotation.type === "line") {
    context.beginPath();
    context.moveTo(annotation.startX, annotation.startY);
    context.lineTo(annotation.endX, annotation.endY);
    context.stroke();
  } else if (annotation.type === "arrow") {
    drawArrow(context, annotation.startX, annotation.startY, annotation.endX, annotation.endY, annotation.size || 5);
  } else if (annotation.type === "shape") {
    if (annotation.mode === "solid") {
      traceShapePath(context, annotation);
      context.fill();
    } else if (annotation.mode === "marker") {
      // Highlighter: translucent color wash over the content.
      context.fillStyle = colorWithAlpha(annotation.color || "#f59e0b", 0.38);
      traceShapePath(context, annotation);
      context.fill();
    } else {
      traceShapePath(context, annotation);
      context.stroke();
    }
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
  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

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
  width: 28px;
  height: 28px;
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

// The native window is transparent; the rounded editor card paints the whole
// viewport and macOS derives the window shadow from its alpha.
const EditorViewport = styled.div`
  width: 100vw;
  height: 100vh;
  background: transparent;
`;

const EditorWindowRoot = styled.main`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border: 1px solid rgba(230, 236, 245, 0.14);
  border-radius: 14px;
  background: #05070b;
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
  gap: 10px;
  min-height: 34px;
  padding: 4px 8px 4px 12px;
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
  gap: 5px;
  min-width: 0;
  overflow-x: auto;
  padding: 2px 10px 6px;
  scrollbar-width: thin;
`;

const EditorThumbButton = styled.button`
  position: relative;
  flex: 0 0 auto;
  width: 48px;
  height: 28px;
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
  /* Flex centering, not grid: the canvas's max-width/max-height percentages
     must resolve against the stage (definite flex height) — inside an
     auto-sized grid row they resolve to none, the canvas lays out at
     intrinsic size and the overflow clip eats it off-center. The stage ends
     above the composer, so centering here already excludes the chat input;
     the extra bottom padding keeps the artwork from hugging it. */
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  /* The padding reserves the chrome bands so the artwork can never slide
     under floating controls: top clears the zoom/undo action cluster, bottom
     clears the options pill, left clears the tool rail. */
  padding: 52px 12px 56px 52px;
  background:
    radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.08), transparent 42%),
    #05070b;

  canvas {
    display: block;
    border-radius: 8px;
    /* Crisp capture edge: a 1px light hairline ringed by a 1px dark halo
       reads clearly against the dark stage and against light screenshots. */
    box-shadow:
      0 0 0 1px rgba(230, 236, 245, 0.45),
      0 0 0 2px rgba(2, 4, 8, 0.95),
      0 18px 54px rgba(0, 0, 0, 0.55);
    cursor: crosshair;
  }
`;

// Scrollable zoom viewport: the canvas's display size is set inline (image
// size × fit scale × zoom); when it overflows, this pane pans it.
const EditorCanvasViewport = styled.div`
  flex: 1;
  min-width: 0;
  min-height: 0;
  align-self: stretch;
  overflow: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

// Grows with the zoomed canvas so scroll reaches every edge, but stretches
// to the viewport and centers when the canvas is smaller than it.
const EditorCanvasSizer = styled.div`
  display: grid;
  place-items: center;
  min-width: 100%;
  min-height: 100%;
  width: max-content;
  height: max-content;
  padding: 4px;
`;

const EditorZoomReadout = styled.button`
  flex: none;
  min-width: 38px;
  padding: 0 4px;
  border: 0;
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.62);
  background: transparent;
  font-size: 10.5px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 24px;
  cursor: pointer;

  &:hover {
    color: #f8fafc;
    background: rgba(255, 255, 255, 0.08);
  }
`;

/* The rail spans the stage's full height, top edge to bottom edge (the
   options pill keeps clear of it via its own max-width), with the tool
   groups centered via auto margins instead of justify-content —
   overflow-safe, so a short window can still scroll to the first and last
   tool. */
const EditorFloatingRail = styled.nav`
  position: absolute;
  left: 8px;
  top: 8px;
  bottom: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 10px 5px;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 999px;
  background: rgba(10, 13, 19, 0.86);
  backdrop-filter: blur(14px);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  > :first-child {
    margin-top: auto;
  }

  > :last-child {
    margin-bottom: auto;
  }
`;

// Act-on-the-result buttons (undo / clear / copy) hug the stage's top-right
// corner as a horizontal glass pill — directly under the batch strip when
// one is showing, and always one short reach from the canvas.
const EditorActionCluster = styled.nav`
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 4px;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 999px;
  background: rgba(10, 13, 19, 0.86);
  backdrop-filter: blur(14px);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
`;

const EditorRailDivider = styled.span`
  width: 18px;
  height: 1px;
  flex: none;
  background: rgba(230, 236, 245, 0.12);
`;

// Bottom pill twin of the rail: always-available style controls plus the
// active tool's own options, centered under the canvas.
const EditorOptionsBar = styled.nav`
  position: absolute;
  left: 50%;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 9px;
  /* Wide enough clearance that the centered pill can never reach the
     full-height tool rail hugging the left edge. */
  max-width: calc(100% - 128px);
  overflow-x: auto;
  overflow-y: hidden;
  padding: 6px 12px;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 999px;
  background: rgba(10, 13, 19, 0.86);
  backdrop-filter: blur(14px);
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.45);
  transform: translateX(-50%);
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const EditorBarDivider = styled.span`
  width: 1px;
  height: 18px;
  flex: none;
  background: rgba(230, 236, 245, 0.12);
`;

const EditorBarTextButton = styled.button`
  flex: none;
  padding: 4px 10px;
  border: 1px solid rgba(230, 236, 245, 0.16);
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.85);
  background: transparent;
  font-size: 11px;
  font-weight: 750;
  white-space: nowrap;
  cursor: pointer;

  &:hover {
    color: #ffffff;
    background: rgba(230, 236, 245, 0.1);
  }
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

  &[data-row="true"] {
    flex-direction: row;
  }
`;

const EditorToolButton = styled.button`
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 0;
  border-radius: 999px;
  color: rgba(248, 250, 252, 0.78);
  background: transparent;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;

  svg {
    width: 16px;
    height: 16px;
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

// Rainbow swatch wrapping a native color input: every color is reachable
// without widening the bar beyond one extra dot.
const CustomColorButton = styled.label`
  position: relative;
  width: 16px;
  height: 16px;
  flex: none;
  overflow: hidden;
  border: 1px solid rgba(230, 236, 245, 0.25);
  border-radius: 999px;
  background: conic-gradient(#ef4444, #f59e0b, #22c55e, #38bdf8, #a855f7, #ef4444);
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;

  input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }

  &:hover {
    transform: scale(1.15);
  }

  &[data-active="true"] {
    box-shadow:
      0 0 0 2px rgba(8, 10, 15, 0.95),
      0 0 0 4px rgba(147, 197, 253, 0.8);
    transform: scale(1.05);
  }
`;

// Text card background swatches: none (slashed), dark, light, accent (mirrors
// the selected color via --snip-color).
const TextBgButton = styled.button`
  position: relative;
  width: 16px;
  height: 16px;
  flex: none;
  overflow: hidden;
  border: 1px solid rgba(230, 236, 245, 0.3);
  border-radius: 5px;
  background: transparent;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;

  &[data-kind="none"]::after {
    content: "";
    position: absolute;
    inset: -2px;
    background: linear-gradient(
      135deg,
      transparent 44%,
      rgba(239, 107, 107, 0.9) 47%,
      rgba(239, 107, 107, 0.9) 53%,
      transparent 56%
    );
  }

  &[data-kind="dark"] {
    background: #0a0e15;
  }

  &[data-kind="light"] {
    background: #f3f5f8;
  }

  &[data-kind="accent"] {
    background: var(--snip-color, #ef4444);
  }

  &:hover {
    transform: scale(1.15);
  }

  &[data-active="true"] {
    box-shadow:
      0 0 0 2px rgba(8, 10, 15, 0.95),
      0 0 0 4px rgba(147, 197, 253, 0.8);
    transform: scale(1.05);
  }
`;

// Inline text annotation editor pinned over the canvas at the click point;
// mirrors the exact font sizing the committed annotation will render with.
const EditorTextOverlayInput = styled.textarea`
  position: absolute;
  z-index: 4;
  min-width: 60px;
  max-width: calc(100% - 24px);
  padding: 2px 6px;
  border: 1.5px dashed rgba(147, 197, 253, 0.75);
  border-radius: 6px;
  outline: none;
  resize: none;
  overflow: hidden;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  font-weight: 700;
  line-height: 1.25;
  caret-color: #93c5fd;

  &::placeholder {
    color: rgba(148, 163, 184, 0.65);
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

const EditorComposer = styled.form`
  flex: none;
  padding: 8px 16px 12px;
  border-top: 1px solid rgba(230, 236, 245, 0.07);
  background: rgba(10, 13, 19, 0.6);

  /* The prompt line lives inside the composer card; the card carries the
     border and focus ring, so the input itself stays bare. */
  input {
    width: 100%;
    min-width: 0;
    height: 30px;
    padding: 0 6px;
    border: 0;
    color: #f8fafc;
    background: transparent;
    font: inherit;
    font-size: 12px;
    font-weight: 700;
    outline: none;
  }

  input::placeholder {
    color: rgba(248, 250, 252, 0.4);
  }
`;

/* One composer card, centered with a capped width (ChatGPT-style) so it
   doesn't stretch edge to edge on wide editor windows: the prompt line sits
   on top and the dispatch controls (workspace and terminal pickers
   bottom-left, send bottom-right) dock inside the card's bottom edge. */
const EditorComposerInner = styled.div`
  display: flex;
  flex-direction: column;
  gap: 7px;
  width: 100%;
  max-width: 780px;
  margin: 0 auto;
  padding: 8px 9px 9px;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 18px;
  background: rgba(230, 236, 245, 0.06);
  transition: border-color 120ms ease, box-shadow 140ms ease;

  &:focus-within {
    border-color: rgba(147, 197, 253, 0.45);
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
  }
`;

const EditorComposerControls = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;

  > :last-child {
    margin-left: auto;
  }
`;

const EditorSendButton = styled.button`
  display: inline-grid;
  width: 32px;
  height: 32px;
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

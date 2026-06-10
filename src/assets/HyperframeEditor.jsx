import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import styled, { keyframes } from "styled-components";
import { AddCircle } from "@styled-icons/material-rounded/AddCircle";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { Audiotrack } from "@styled-icons/material-rounded/Audiotrack";
import { ArrowDownward } from "@styled-icons/material-rounded/ArrowDownward";
import { ArrowUpward } from "@styled-icons/material-rounded/ArrowUpward";
import { CheckBox } from "@styled-icons/material-rounded/CheckBox";
import { CheckBoxOutlineBlank } from "@styled-icons/material-rounded/CheckBoxOutlineBlank";
import { Code } from "@styled-icons/material-rounded/Code";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { FileDownload } from "@styled-icons/material-rounded/FileDownload";
import { Image } from "@styled-icons/material-rounded/Image";
import { Close } from "@styled-icons/material-rounded/Close";
import { Movie } from "@styled-icons/material-rounded/Movie";
import { Pause } from "@styled-icons/material-rounded/Pause";
import { PhotoLibrary } from "@styled-icons/material-rounded/PhotoLibrary";
import { PlayArrow } from "@styled-icons/material-rounded/PlayArrow";
import { RestartAlt } from "@styled-icons/material-rounded/RestartAlt";
import { Save } from "@styled-icons/material-rounded/Save";
import { Send } from "@styled-icons/material-rounded/Send";
import { SmartToy } from "@styled-icons/material-rounded/SmartToy";
import { Timeline } from "@styled-icons/material-rounded/Timeline";
import { VideoLibrary } from "@styled-icons/material-rounded/VideoLibrary";

import MediaTranscriptChip from "./MediaTranscriptChip.jsx";
import { getMediaTranscriptStatus } from "./videoTranscription";

const HYPERFRAME_VERSION = "1.0";
const HYPERFRAME_MARKER = "diffforge-hyperframe";
const HYPERFRAME_MANIFEST_SCRIPT_ID = "diffforge-hyperframe-manifest";
const HYPERFRAME_DRAFT_PREFIX = "diffforge:hyperframe:draft:";
const HYPERFRAME_AI_JOBS_PREFIX = "diffforge:hyperframe:aijobs:";
const REMOTE_TODO_QUEUE_EVENT = "diffforge:remote-todo-queue";
const TODO_QUEUE_RECEIPTS_PREFIX = "diffforge.todoQueue.remoteCommandReceipts.v1";
const AI_JOB_FADE_MS = 2600;
const AI_JOB_UNDELIVERED_MS = 8000;
const AI_JOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const AI_AGENT_OPTIONS = [
  { id: "", label: "Any available agent" },
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "opencode", label: "OpenCode" },
];
const DEFAULT_CLIP_DURATION = 3;
const DEFAULT_CANVAS = { height: 720, width: 1280 };
const ASSET_IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const ASSET_VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "webm"]);
const ASSET_AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav", "wma"]);

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampNumber(value, min, max, fallback = min) {
  const number = numberValue(value, fallback);
  return Math.max(min, Math.min(max, number));
}

function jsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      return jsonObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return null;
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function shortLabel(value, maxLength = 34) {
  const raw = text(value);
  if (raw.length <= maxLength) return raw;
  return `${raw.slice(0, Math.max(1, maxLength - 3))}...`;
}

function slug(value, fallback = "hyperframe") {
  const normalized = text(value, fallback)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized || fallback;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function jsonScriptEscape(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</gu, "\\u003c")
    .replace(/>/gu, "\\u003e")
    .replace(/&/gu, "\\u0026");
}

function assetId(asset, fallback = "") {
  return text(asset?.assetId || asset?.asset_id || asset?.id || asset?.untrackedId || asset?.untracked_id, fallback);
}

function assetName(asset, fallback = "asset") {
  return text(asset?.name || asset?.filename || asset?.fileName || asset?.file_name, fallback);
}

function assetKind(asset) {
  return text(asset?.kind || asset?.assetKind || asset?.asset_kind || asset?.mimeType || asset?.mime_type, "asset");
}

function assetMimeType(asset) {
  return text(asset?.mimeType || asset?.mime_type || asset?.contentType || asset?.content_type);
}

function assetLocalPath(asset) {
  return text(
    asset?.localPath
      || asset?.local_path
      || asset?.path
      || asset?.localPathHint
      || asset?.local_path_hint
      || asset?.lastLocalPath
      || asset?.last_local_path,
  );
}

function assetKey(asset, fallback = "") {
  return assetId(asset) || assetLocalPath(asset) || assetName(asset, fallback);
}

function assetLocalAvailable(asset) {
  const explicit = asset?.localAvailable ?? asset?.local_available;
  if (typeof explicit === "boolean") return explicit && Boolean(assetLocalPath(asset));
  const localStatus = text(asset?.localStatus || asset?.local_status).toLowerCase().replace(/[_\s]+/gu, "-");
  if (["deleted", "local-deleted", "missing", "unavailable"].includes(localStatus)) return false;
  return Boolean(assetLocalPath(asset));
}

function assetFileExtension(asset) {
  const source = assetName(asset, "") || assetLocalPath(asset);
  const filename = source.split(/[\\/]/u).pop() || "";
  const match = filename.match(/\.([^.\\/]+)$/u);
  return text(match?.[1]).toLowerCase();
}

function assetIsImage(asset) {
  const mimeType = assetMimeType(asset).toLowerCase();
  const kind = assetKind(asset).toLowerCase();
  return mimeType.startsWith("image/")
    || kind === "image"
    || ASSET_IMAGE_EXTENSIONS.has(assetFileExtension(asset));
}

function assetIsVideo(asset) {
  const mimeType = assetMimeType(asset).toLowerCase();
  const kind = assetKind(asset).toLowerCase();
  return mimeType.startsWith("video/")
    || kind === "video"
    || ASSET_VIDEO_EXTENSIONS.has(assetFileExtension(asset));
}

function assetIsAudio(asset) {
  const mimeType = assetMimeType(asset).toLowerCase();
  const kind = assetKind(asset).toLowerCase();
  return mimeType.startsWith("audio/")
    || kind === "audio"
    || ASSET_AUDIO_EXTENSIONS.has(assetFileExtension(asset));
}

function assetIsHtml(asset) {
  const mimeType = assetMimeType(asset).toLowerCase();
  const extension = assetFileExtension(asset);
  return mimeType === "text/html" || extension === "html" || extension === "htm";
}

function assetMetadata(asset) {
  return jsonObject(asset?.metadata) || jsonObject(asset?.meta) || {};
}

export function assetLooksLikeHyperframe(asset) {
  const metadata = assetMetadata(asset);
  const kind = assetKind(asset).toLowerCase();
  const sourceKind = text(asset?.sourceKind || asset?.source_kind || metadata.sourceKind || metadata.source_kind).toLowerCase();
  const assetType = text(asset?.assetType || asset?.asset_type || metadata.assetType || metadata.asset_type).toLowerCase();
  const filename = assetName(asset).toLowerCase();
  return kind === "hyperframe"
    || sourceKind === "hyperframe"
    || assetType === "hyperframe"
    || filename.endsWith(".hyperframe.html")
    || filename.endsWith(".hyperframes.html")
    || Boolean(metadata.hyperframe || metadata.diffforgeHyperframe || metadata.diffforge_hyperframe);
}

export function assetCanContainHyperframe(asset) {
  return assetLooksLikeHyperframe(asset) || assetIsHtml(asset);
}

function assetPreviewUrl(asset) {
  const localPath = assetLocalPath(asset);
  if (!localPath || !assetIsImage(asset)) return "";
  try {
    return convertFileSrc(localPath);
  } catch {
    return "";
  }
}

function fileUrlFromPath(path) {
  const normalized = text(path).replace(/\\/gu, "/");
  if (!normalized) return "";
  if (/^[a-z][a-z0-9+.-]*:/iu.test(normalized)) return normalized;
  const encoded = normalized.split("/").map((part) => encodeURIComponent(part)).join("/");
  if (/^[a-z]:/iu.test(encoded)) return `file:///${encoded}`;
  return `file://${encoded.startsWith("/") ? "" : "/"}${encoded}`;
}

function dataUrlToText(dataUrl) {
  const raw = text(dataUrl);
  const commaIndex = raw.indexOf(",");
  if (commaIndex < 0) return raw;
  const header = raw.slice(0, commaIndex).toLowerCase();
  const payload = raw.slice(commaIndex + 1);
  if (header.includes(";base64")) {
    const binary = window.atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }
  return decodeURIComponent(payload.replace(/\+/gu, "%20"));
}

async function readAssetDataUrl(asset) {
  const localPath = typeof asset === "string" ? asset : assetLocalPath(asset);
  if (!localPath) throw new Error("Local asset path is required.");
  return invoke("snipping_read_asset_data_url", { path: localPath });
}

async function readAssetText(asset) {
  return dataUrlToText(await readAssetDataUrl(asset));
}

function htmlLooksLikeHyperframe(html) {
  const source = text(html).toLowerCase();
  return source.includes(HYPERFRAME_MARKER)
    || source.includes(HYPERFRAME_MANIFEST_SCRIPT_ID)
    || source.includes("data-hyperframe")
    || source.includes("__diffforge_hyperframe__");
}

function parseHyperframeManifestFromHtml(html) {
  if (!text(html)) return null;
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const script = doc.getElementById(HYPERFRAME_MANIFEST_SCRIPT_ID)
      || doc.querySelector("script[data-hyperframe-manifest]");
    if (script?.textContent) {
      return jsonObject(JSON.parse(script.textContent));
    }
    const meta = doc.querySelector('meta[name="diffforge-hyperframe-manifest"]');
    if (meta?.content) {
      return jsonObject(JSON.parse(meta.content));
    }
  } catch {
    return null;
  }
  const assignment = html.match(/__DIFFFORGE_HYPERFRAME__\s*=\s*(\{[\s\S]*?\});/u);
  if (assignment?.[1]) {
    try {
      return jsonObject(JSON.parse(assignment[1]));
    } catch {
      return null;
    }
  }
  return null;
}

function hyperframeAssetReference(asset) {
  const id = assetKey(asset, `asset-${Math.random().toString(16).slice(2)}`);
  const localPath = assetLocalPath(asset);
  const mimeType = assetMimeType(asset);
  const kind = assetIsImage(asset)
    ? "image"
    : assetIsVideo(asset)
      ? "video"
      : assetIsAudio(asset)
        ? "audio"
        : assetKind(asset);
  return {
    id,
    assetId: assetId(asset),
    kind,
    localPath,
    mimeType,
    name: assetName(asset, "asset"),
    sha256: text(asset?.sha256 || asset?.hash || asset?.contentHash || asset?.content_hash),
  };
}

function defaultHyperframeManifest(asset) {
  const title = assetName(asset, "Untitled Hyperframe").replace(/\.hyperframes?\.html$/iu, "").replace(/\.html$/iu, "");
  return {
    canvas: { ...DEFAULT_CANVAS },
    duration: DEFAULT_CLIP_DURATION,
    exportSettings: {
      fps: 24,
      format: "html",
      quality: 0.86,
    },
    title,
    version: HYPERFRAME_VERSION,
    assets: [],
    timeline: [],
  };
}

function normalizeHyperframeManifest(manifest, sourceAsset) {
  const base = defaultHyperframeManifest(sourceAsset);
  const input = jsonObject(manifest) || {};
  const assets = jsonArray(input.assets).map((asset, index) => {
    const object = jsonObject(asset) || {};
    const id = text(object.id || object.assetId || object.asset_id || object.localPath || object.local_path, `asset-${index + 1}`);
    return {
      ...object,
      id,
      assetId: text(object.assetId || object.asset_id),
      kind: text(object.kind || object.type, "asset"),
      localPath: text(object.localPath || object.local_path),
      mimeType: text(object.mimeType || object.mime_type),
      name: text(object.name || object.filename, `Asset ${index + 1}`),
    };
  });
  const timeline = jsonArray(input.timeline).map((clip, index) => {
    const object = jsonObject(clip) || {};
    const assetIdValue = text(object.assetId || object.asset_id || object.assetRef || object.asset_ref);
    const sourceIn = clampNumber(object.sourceIn ?? object.source_in, 0, 86400, 0);
    const rawSourceOut = object.sourceOut ?? object.source_out;
    // sourceOut <= sourceIn (including the 0 default) means "play to the natural end".
    const sourceOut = clampNumber(rawSourceOut, 0, 86400, 0);
    return {
      id: text(object.id, `clip-${index + 1}`),
      assetId: assetIdValue,
      duration: clampNumber(object.duration, 0.25, 3600, DEFAULT_CLIP_DURATION),
      label: text(object.label),
      sourceIn,
      sourceOut: sourceOut > sourceIn ? sourceOut : 0,
      start: clampNumber(object.start, 0, 3600, index * DEFAULT_CLIP_DURATION),
      title: text(object.title),
      transcriptExcerpt: text(object.transcriptExcerpt || object.transcript_excerpt).slice(0, 400),
      type: text(object.type || object.kind, "clip"),
    };
  });
  const canvas = jsonObject(input.canvas) || {};
  const normalized = {
    ...base,
    ...input,
    assets,
    canvas: {
      height: Math.round(clampNumber(canvas.height ?? input.height, 240, 4320, DEFAULT_CANVAS.height)),
      width: Math.round(clampNumber(canvas.width ?? input.width, 320, 7680, DEFAULT_CANVAS.width)),
    },
    duration: clampNumber(input.duration, 0.25, 24 * 60 * 60, base.duration),
    exportSettings: {
      ...base.exportSettings,
      ...(jsonObject(input.exportSettings) || jsonObject(input.export_settings) || {}),
    },
    timeline,
    title: text(input.title, base.title),
    version: text(input.version, HYPERFRAME_VERSION),
  };
  if (!normalized.timeline.length && normalized.assets.length) {
    normalized.timeline = normalized.assets.map((item, index) => ({
      id: `clip-${index + 1}`,
      assetId: item.id,
      duration: DEFAULT_CLIP_DURATION,
      start: index * DEFAULT_CLIP_DURATION,
      title: item.name,
      type: "clip",
    }));
  }
  normalized.duration = Math.max(
    normalized.duration,
    ...normalized.timeline.map((clip) => numberValue(clip.start) + numberValue(clip.duration)),
    DEFAULT_CLIP_DURATION,
  );
  return normalized;
}

export async function loadHyperframeAsset(asset) {
  const html = await readAssetText(asset);
  const isHyperframe = assetLooksLikeHyperframe(asset) || htmlLooksLikeHyperframe(html);
  return {
    html,
    isHyperframe,
    manifest: normalizeHyperframeManifest(parseHyperframeManifestFromHtml(html), asset),
  };
}

function timelineDuration(timeline, fallback = DEFAULT_CLIP_DURATION) {
  return Math.max(
    fallback,
    ...jsonArray(timeline).map((clip) => numberValue(clip.start) + numberValue(clip.duration)),
  );
}

function dedupeAssets(assets) {
  const byKey = new Map();
  jsonArray(assets).forEach((asset, index) => {
    if (!asset || typeof asset !== "object") return;
    const key = assetKey(asset, `asset-${index}`);
    if (!key || byKey.has(key)) return;
    byKey.set(key, asset);
  });
  return [...byKey.values()];
}

function resolvedManifest(manifest, assetMap, options = {}) {
  const forPreview = Boolean(options.forPreview);
  const embeddedSources = jsonObject(options.embeddedSources) || {};
  const assets = jsonArray(manifest.assets).map((ref) => {
    const source = assetMap.get(ref.id) || assetMap.get(ref.assetId) || null;
    const localPath = text(ref.localPath || assetLocalPath(source));
    const kind = text(ref.kind, source ? (assetIsImage(source) ? "image" : assetIsVideo(source) ? "video" : assetKind(source)) : "asset");
    let src = text(embeddedSources[ref.id] || embeddedSources[ref.assetId]);
    if (!src && forPreview && localPath) {
      try {
        src = convertFileSrc(localPath);
      } catch {
        src = "";
      }
    }
    if (!src && localPath) {
      src = fileUrlFromPath(localPath);
    }
    return {
      ...ref,
      kind,
      localPath,
      mimeType: text(ref.mimeType || assetMimeType(source)),
      name: text(ref.name || assetName(source), "asset"),
      src,
    };
  });
  return {
    ...manifest,
    assets,
    timeline: jsonArray(manifest.timeline),
  };
}

function buildHyperframeHtml(manifest, assetMap, options = {}) {
  const nextManifest = resolvedManifest(manifest, assetMap, options);
  const title = text(nextManifest.title, "Hyperframe");
  const manifestJson = jsonScriptEscape(nextManifest);
  return `<!doctype html>
<html lang="en" data-${HYPERFRAME_MARKER}="true">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="${HYPERFRAME_MARKER}" content="${htmlEscape(HYPERFRAME_VERSION)}">
  <title>${htmlEscape(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #080a0f; color: #f5f7fb; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #080a0f; }
    .hf-player { width: min(100vw, ${nextManifest.canvas?.width || DEFAULT_CANVAS.width}px); aspect-ratio: ${(nextManifest.canvas?.width || DEFAULT_CANVAS.width)} / ${(nextManifest.canvas?.height || DEFAULT_CANVAS.height)}; position: relative; overflow: hidden; background: #10151f; }
    .hf-frame { position: absolute; inset: 0; display: grid; place-items: center; background: radial-gradient(circle at 30% 10%, rgba(71, 196, 255, 0.18), transparent 36%), linear-gradient(135deg, #111827, #080a0f 62%, #18181b); }
    .hf-frame img, .hf-frame video { width: 100%; height: 100%; object-fit: contain; background: #07080c; }
    .hf-placeholder { width: min(70%, 720px); padding: 28px; border: 1px solid rgba(255,255,255,0.18); background: rgba(9,13,21,0.72); border-radius: 12px; text-align: center; }
    .hf-placeholder strong { display: block; font-size: clamp(22px, 3vw, 44px); margin-bottom: 10px; }
    .hf-bar { position: absolute; left: 18px; right: 18px; bottom: 16px; height: 5px; background: rgba(255,255,255,0.18); border-radius: 999px; overflow: hidden; }
    .hf-progress { display: block; height: 100%; width: 0%; background: #5eead4; }
  </style>
</head>
<body>
  <main class="hf-player" aria-label="${htmlEscape(title)}">
    <section class="hf-frame" id="hf-frame"></section>
    <div class="hf-bar" aria-hidden="true"><span class="hf-progress" id="hf-progress"></span></div>
  </main>
  <script id="${HYPERFRAME_MANIFEST_SCRIPT_ID}" type="application/json">${manifestJson}</script>
  <script>
(() => {
  const manifestElement = document.getElementById("${HYPERFRAME_MANIFEST_SCRIPT_ID}");
  const manifest = JSON.parse(manifestElement.textContent || "{}");
  const frame = document.getElementById("hf-frame");
  const progress = document.getElementById("hf-progress");
  const assets = new Map((manifest.assets || []).map((asset) => [asset.id, asset]));
  const timeline = [...(manifest.timeline || [])].sort((left, right) => Number(left.start || 0) - Number(right.start || 0));
  const duration = Math.max(Number(manifest.duration || 0), ...timeline.map((clip) => Number(clip.start || 0) + Number(clip.duration || 0)), 1);
  let activeClipId = "";
  let mediaElement = null;
  let activeClip = null;
  let playing = true;
  let clock = 0;
  let lastNow = performance.now();
  let lastPostAt = 0;

  function clipAt(time) {
    return timeline.find((clip) => time >= Number(clip.start || 0) && time < Number(clip.start || 0) + Number(clip.duration || 0)) || timeline[0] || null;
  }

  function clipSourceTime(clip, timelineTime) {
    const sourceIn = Math.max(0, Number((clip && clip.sourceIn) || 0));
    const sourceOut = Math.max(0, Number((clip && clip.sourceOut) || 0));
    const offset = Math.max(0, timelineTime - Number((clip && clip.start) || 0));
    let sourceTime = sourceIn + offset;
    if (sourceOut > sourceIn) sourceTime = Math.min(sourceTime, Math.max(sourceIn, sourceOut - 0.04));
    return sourceTime;
  }

  function syncMediaTime(force) {
    if (!mediaElement || !activeClip) return;
    const desired = clipSourceTime(activeClip, clock);
    if (force || Math.abs((mediaElement.currentTime || 0) - desired) > 0.35) {
      try { mediaElement.currentTime = desired; } catch {}
    }
  }

  function playMedia() {
    if (!mediaElement) return;
    mediaElement.play().catch(() => {
      mediaElement.muted = true;
      mediaElement.play().catch(() => {});
    });
  }

  function appendPlaceholder(title, subtitle) {
    const placeholder = document.createElement("div");
    placeholder.className = "hf-placeholder";
    placeholder.innerHTML = "<strong></strong><span></span>";
    placeholder.querySelector("strong").textContent = title;
    placeholder.querySelector("span").textContent = subtitle;
    frame.appendChild(placeholder);
  }

  function renderClip(clip) {
    const asset = clip ? assets.get(clip.assetId) : null;
    const nextId = clip && asset ? clip.id + ":" + asset.id : "placeholder";
    if (activeClipId === nextId) return;
    activeClipId = nextId;
    activeClip = clip || null;
    frame.textContent = "";
    mediaElement = null;
    const kind = asset ? String(asset.kind || "").toLowerCase() : "";
    if (asset && asset.src && kind === "image") {
      const image = document.createElement("img");
      image.alt = asset.name || manifest.title || "Hyperframe asset";
      image.src = asset.src;
      frame.appendChild(image);
      return;
    }
    if (asset && asset.src && (kind === "video" || kind === "audio")) {
      const media = document.createElement(kind === "audio" ? "audio" : "video");
      media.loop = false;
      media.playsInline = true;
      media.preload = "auto";
      media.muted = false;
      media.src = asset.src;
      if (kind === "audio") media.style.display = "none";
      frame.appendChild(media);
      if (kind === "audio") appendPlaceholder(asset.name || clip.title || "Audio", "audio");
      mediaElement = media;
      syncMediaTime(true);
      if (playing) playMedia();
      return;
    }
    appendPlaceholder(
      (asset && asset.name) || (clip && clip.title) || manifest.title || "Hyperframe",
      asset ? (asset.kind || "asset") : "No clip",
    );
  }

  function postState(now, force) {
    if (!force && now - lastPostAt < 120) return;
    lastPostAt = now;
    try {
      window.parent.postMessage({ duration, playing, time: clock, type: "hf-state" }, "*");
    } catch {}
  }

  window.addEventListener("message", (event) => {
    const data = event && event.data;
    if (!data || data.type !== "hf-control") return;
    if (data.action === "play") playing = true;
    if (data.action === "pause") playing = false;
    if (data.action === "toggle") playing = !playing;
    if (data.action === "seek") {
      clock = Math.max(0, Math.min(duration, Number(data.time || 0)));
      renderClip(clipAt(clock));
      syncMediaTime(true);
    }
    if (mediaElement) {
      if (playing) playMedia();
      else mediaElement.pause();
    }
    postState(performance.now(), true);
  });

  function tick(now) {
    const previousClock = clock;
    if (playing) clock = (clock + Math.max(0, now - lastNow) / 1000) % duration;
    lastNow = now;
    const clip = clipAt(clock);
    renderClip(clip);
    syncMediaTime(clock < previousClock);
    if (mediaElement && playing && mediaElement.paused) playMedia();
    if (progress) progress.style.width = String(Math.min(100, Math.max(0, clock / duration * 100))) + "%";
    postState(now, false);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})();
  </script>
</body>
</html>
`;
}

function readDraft(key) {
  if (!key || typeof window === "undefined") return null;
  try {
    return jsonObject(JSON.parse(window.localStorage.getItem(key) || "null"));
  } catch {
    return null;
  }
}

function writeDraft(key, value) {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Draft persistence is best-effort only.
  }
}

function clearDraft(key) {
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Draft persistence is best-effort only.
  }
}

function dataUrlFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Unable to read export blob."));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load image."));
    image.src = src;
  });
}

async function prepareImageCache(manifest, assetMap) {
  const cache = new Map();
  await Promise.all(jsonArray(manifest.assets).map(async (ref) => {
    const source = assetMap.get(ref.id) || assetMap.get(ref.assetId);
    if (!source || !assetIsImage(source) || !assetLocalPath(source)) return;
    try {
      const dataUrl = await readAssetDataUrl(source);
      cache.set(ref.id, await loadImage(dataUrl));
    } catch {
      // Non-image or unreadable media is rendered as a labeled card.
    }
  }));
  return cache;
}

function drawWrappedText(ctx, value, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = text(value).split(/\s+/u).filter(Boolean);
  let line = "";
  let lines = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      lines += 1;
      line = word;
      if (lines >= maxLines) return;
    } else {
      line = candidate;
    }
  }
  if (line && lines < maxLines) {
    ctx.fillText(line, x, y + lines * lineHeight);
  }
}

function drawHyperframeFrame(ctx, manifest, assetMap, imageCache, time) {
  const width = ctx.canvas.width;
  const height = ctx.canvas.height;
  const timeline = jsonArray(manifest.timeline).sort((left, right) => numberValue(left.start) - numberValue(right.start));
  const clip = timeline.find((item) => time >= numberValue(item.start) && time < numberValue(item.start) + numberValue(item.duration))
    || timeline[0]
    || null;
  const ref = clip ? jsonArray(manifest.assets).find((item) => item.id === clip.assetId) : null;
  const source = ref ? assetMap.get(ref.id) || assetMap.get(ref.assetId) : null;
  const image = ref ? imageCache.get(ref.id) : null;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#111827");
  gradient.addColorStop(0.55, "#070a10");
  gradient.addColorStop(1, "#0f172a");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgba(94, 234, 212, 0.14)";
  ctx.beginPath();
  ctx.arc(width * 0.18, height * 0.12, width * 0.22, 0, Math.PI * 2);
  ctx.fill();

  if (image) {
    const scale = Math.min(width / image.width, height / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  } else {
    ctx.fillStyle = "rgba(8, 13, 23, 0.74)";
    const cardWidth = width * 0.62;
    const cardHeight = height * 0.32;
    const cardX = (width - cardWidth) / 2;
    const cardY = (height - cardHeight) / 2;
    ctx.fillRect(cardX, cardY, cardWidth, cardHeight);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
    ctx.lineWidth = Math.max(2, width / 640);
    ctx.strokeRect(cardX, cardY, cardWidth, cardHeight);
    ctx.fillStyle = "#f8fafc";
    ctx.font = `700 ${Math.max(30, Math.round(width / 24))}px Inter, system-ui, sans-serif`;
    ctx.textAlign = "center";
    drawWrappedText(ctx, source ? assetName(source) : text(clip?.title || manifest.title, "Hyperframe"), width / 2, cardY + cardHeight * 0.42, cardWidth * 0.82, Math.max(36, width / 22), 2);
    ctx.fillStyle = "#94a3b8";
    ctx.font = `500 ${Math.max(18, Math.round(width / 58))}px Inter, system-ui, sans-serif`;
    ctx.fillText(source ? assetKind(source) : "clip", width / 2, cardY + cardHeight * 0.76);
  }

  const duration = timelineDuration(manifest.timeline, numberValue(manifest.duration, DEFAULT_CLIP_DURATION));
  const progress = duration ? Math.min(1, Math.max(0, time / duration)) : 0;
  ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
  ctx.fillRect(width * 0.04, height * 0.94, width * 0.92, Math.max(6, height * 0.006));
  ctx.fillStyle = "#5eead4";
  ctx.fillRect(width * 0.04, height * 0.94, width * 0.92 * progress, Math.max(6, height * 0.006));
}

async function renderPosterDataUrl(manifest, assetMap) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(clampNumber(manifest.canvas?.width, 320, 7680, DEFAULT_CANVAS.width));
  canvas.height = Math.round(clampNumber(manifest.canvas?.height, 240, 4320, DEFAULT_CANVAS.height));
  const ctx = canvas.getContext("2d");
  const imageCache = await prepareImageCache(manifest, assetMap);
  drawHyperframeFrame(ctx, manifest, assetMap, imageCache, 0);
  return canvas.toDataURL("image/png");
}

async function renderWebmDataUrl(manifest, assetMap, onProgress) {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("WebM recording is unavailable in this webview.");
  }
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : MediaRecorder.isTypeSupported("video/webm")
      ? "video/webm"
      : "";
  if (!mimeType) throw new Error("WebM recording is unavailable in this webview.");
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(clampNumber(manifest.canvas?.width, 320, 3840, DEFAULT_CANVAS.width));
  canvas.height = Math.round(clampNumber(manifest.canvas?.height, 240, 2160, DEFAULT_CANVAS.height));
  const ctx = canvas.getContext("2d");
  const fps = Math.round(clampNumber(manifest.exportSettings?.fps, 12, 60, 24));
  const duration = Math.min(60, timelineDuration(manifest.timeline, numberValue(manifest.duration, DEFAULT_CLIP_DURATION)));
  const frameCount = Math.max(1, Math.ceil(duration * fps));
  const imageCache = await prepareImageCache(manifest, assetMap);
  const stream = canvas.captureStream(fps);
  const chunks = [];
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 4_000_000,
  });
  const finished = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data?.size) chunks.push(event.data);
    };
    recorder.onerror = () => reject(recorder.error || new Error("WebM recording failed."));
    recorder.onstop = () => resolve();
  });
  recorder.start();
  for (let index = 0; index < frameCount; index += 1) {
    const time = index / fps;
    drawHyperframeFrame(ctx, manifest, assetMap, imageCache, time);
    onProgress?.(Math.round((index / frameCount) * 100));
    await new Promise((resolve) => window.setTimeout(resolve, 1000 / fps));
  }
  recorder.stop();
  await finished;
  onProgress?.(100);
  const blob = new Blob(chunks, { type: "video/webm" });
  return dataUrlFromBlob(blob);
}

function isUntrackedAsset(asset) {
  return Boolean(asset?.untracked || text(asset?.assetScope || asset?.asset_scope).toLowerCase() === "untracked");
}

function assetTypeLabel(asset) {
  if (assetIsImage(asset)) return "Image";
  if (assetIsVideo(asset)) return "Video";
  if (assetIsAudio(asset)) return "Audio";
  if (assetLooksLikeHyperframe(asset)) return "Hyperframe";
  const extension = assetFileExtension(asset);
  return extension ? extension.toUpperCase() : shortLabel(assetKind(asset).toUpperCase(), 10);
}

function assetIcon(asset) {
  if (assetIsVideo(asset)) return <Movie aria-hidden="true" />;
  if (assetIsAudio(asset)) return <Audiotrack aria-hidden="true" />;
  if (assetIsImage(asset)) return <Image aria-hidden="true" />;
  if (assetLooksLikeHyperframe(asset)) return <VideoLibrary aria-hidden="true" />;
  return <Code aria-hidden="true" />;
}

function formatTimecode(seconds) {
  const safe = Math.max(0, numberValue(seconds, 0));
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, "0")}`;
}

// Mirrors getTodoQueueRemoteCommandReceiptStorageKey in TerminalView so the editor can
// observe the lifecycle receipts the terminal records for queued remote todos.
function todoQueueReceiptsStorageKey(workspaceId) {
  const safeWorkspaceId = String(workspaceId || "default")
    .replace(/[^\w.-]/g, "_")
    .slice(0, 120) || "default";
  return `${TODO_QUEUE_RECEIPTS_PREFIX}.${safeWorkspaceId}`;
}

function readTodoQueueReceipt(workspaceId, commandId) {
  if (typeof window === "undefined" || !commandId) return null;
  try {
    const receipts = jsonObject(JSON.parse(window.localStorage.getItem(todoQueueReceiptsStorageKey(workspaceId)) || "{}")) || {};
    return jsonObject(receipts[commandId]);
  } catch {
    return null;
  }
}

const AI_JOB_TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled", "timed_out", "released", "duplicate_ignored"]);

function aiJobPhaseFromReceiptStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["completed"].includes(normalized)) return "completed";
  if (["failed", "cancelled", "canceled", "timed_out", "timeout", "duplicate_ignored", "released"].includes(normalized)) return "failed";
  if (["sending", "submitted"].includes(normalized)) return "editing";
  if (["paused", "parked", "resume_ready", "resume_requested", "interrupted"].includes(normalized)) return "paused";
  if (normalized === "queued") return "queued";
  return "";
}

function aiJobPhaseLabel(phase) {
  switch (phase) {
    case "editing":
      return "Editing";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "paused":
      return "Paused";
    case "undelivered":
      return "Not delivered";
    default:
      return "Queued";
  }
}

function normalizeAiJob(job) {
  const object = jsonObject(job);
  if (!object) return null;
  const commandId = text(object.commandId || object.id);
  const workspaceId = text(object.workspaceId);
  if (!commandId || !workspaceId) return null;
  const rangeObject = jsonObject(object.range) || {};
  const start = Math.max(0, numberValue(rangeObject.start, 0));
  const end = Math.max(start, numberValue(rangeObject.end, start));
  return {
    agentId: text(object.agentId),
    commandId,
    completedAtMs: numberValue(object.completedAtMs, 0),
    createdAtMs: numberValue(object.createdAtMs, Date.now()),
    instruction: text(object.instruction).slice(0, 400),
    phase: text(object.phase, "queued"),
    range: end > start ? { end, start } : null,
    workspaceId,
    workspaceName: text(object.workspaceName, workspaceId),
  };
}

function readAiJobs(storageKey) {
  if (!storageKey || typeof window === "undefined") return [];
  try {
    const nowMs = Date.now();
    return jsonArray(JSON.parse(window.localStorage.getItem(storageKey) || "[]"))
      .map(normalizeAiJob)
      .filter(Boolean)
      .filter((job) => nowMs - job.createdAtMs < AI_JOB_MAX_AGE_MS)
      .filter((job) => !(job.phase === "completed" && job.completedAtMs && nowMs - job.completedAtMs > AI_JOB_FADE_MS));
  } catch {
    return [];
  }
}

function writeAiJobs(storageKey, jobs) {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(jsonArray(jobs).slice(0, 24)));
  } catch {
    // Job persistence is best-effort only.
  }
}

function buildHyperframeTodoText({ instruction, manifest, range, rangeClips, sourcePath }) {
  const mediaTranscriptLines = jsonArray(manifest.assets)
    .filter((ref) => ["audio", "video"].includes(String(ref.kind || "").toLowerCase()))
    .map((ref) => {
      const transcript = jsonObject(ref.transcript) || {};
      if (transcript.srtPath || transcript.jsonPath) {
        return `Transcript for "${ref.name}" (asset ${ref.id}): SRT ${transcript.srtPath}${transcript.jsonPath ? `, word-level JSON ${transcript.jsonPath}` : ""}`;
      }
      return `No transcript attached for "${ref.name}" (asset ${ref.id}).`;
    });
  const lines = [
    "[Hyperframe edit request]",
    `Project: ${text(manifest.title, "Hyperframe")}`,
    sourcePath ? `File: ${sourcePath}` : "",
    `Canvas: ${manifest.canvas.width}x${manifest.canvas.height}, total duration ${timelineDuration(manifest.timeline, numberValue(manifest.duration, DEFAULT_CLIP_DURATION)).toFixed(2)}s`,
    range
      ? `Target timeline range: ${range.start.toFixed(2)}s to ${range.end.toFixed(2)}s${rangeClips.length ? ` (clips: ${rangeClips.map((clip) => `${clip.id}${clip.title ? ` "${clip.title}"` : ""}`).join(", ")})` : ""}`
      : "Target timeline range: entire timeline",
    ...mediaTranscriptLines,
    mediaTranscriptLines.length
      ? "Video/audio clips support sourceIn/sourceOut (seconds into the source media) for cutting. To cut or crop media, adjust clip sourceIn/sourceOut plus start/duration in the manifest timeline; use the transcript timestamps to find content. sourceOut 0 means play to the end."
      : "",
    "",
    instruction,
    "",
    sourcePath
      ? `Edit the hyperframe HTML file at ${sourcePath} directly. The project manifest is embedded as JSON in <script id="${HYPERFRAME_MANIFEST_SCRIPT_ID}" type="application/json">. Apply the requested change to the selected time range only and keep every other clip, asset reference, and setting intact. Keep the manifest valid JSON and the file a self-contained hyperframe document.`
      : `The project manifest is embedded as JSON in <script id="${HYPERFRAME_MANIFEST_SCRIPT_ID}" type="application/json"> inside the hyperframe HTML document. Apply the requested change to the selected time range only and keep everything else intact.`,
  ];
  return lines.filter((line) => line !== "").join("\n");
}

export default function HyperframeEditor({
  asset,
  assets = [],
  initialDocument = null,
  onBack,
  onRefreshTracked,
  onRefreshUntracked,
  workspaces = [],
}) {
  const [activePanel, setActivePanel] = useState("assets");
  const [busyKey, setBusyKey] = useState("");
  const [error, setError] = useState("");
  const [exportProgress, setExportProgress] = useState(0);
  const [exportedItems, setExportedItems] = useState([]);
  const [loadedAssetKey, setLoadedAssetKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [manifest, setManifest] = useState(() => defaultHyperframeManifest(asset));
  const [selectedClipId, setSelectedClipId] = useState("");
  const [status, setStatus] = useState("Opening");
  const [playerState, setPlayerState] = useState({ duration: 0, playing: true, time: 0 });
  const [timelineSelection, setTimelineSelection] = useState(null);
  const [aiWorkspaceId, setAiWorkspaceId] = useState("");
  const [aiAgentId, setAiAgentId] = useState("");
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiSendError, setAiSendError] = useState("");
  const [aiJobs, setAiJobs] = useState([]);
  const loadRunRef = useRef(0);
  const previewFrameRef = useRef(null);
  const timelineStripRef = useRef(null);
  const timelineDragRef = useRef(null);
  const aiJobsLoadedKeyRef = useRef("");
  const playerTimeRef = useRef(0);
  const pendingSeekTimeRef = useRef(null);
  const reloadFromDiskRef = useRef(() => {});

  const currentAssetKey = assetKey(asset);
  const draftKey = currentAssetKey ? `${HYPERFRAME_DRAFT_PREFIX}${currentAssetKey}` : "";
  const aiJobsKey = currentAssetKey ? `${HYPERFRAME_AI_JOBS_PREFIX}${currentAssetKey}` : "";

  const availableAssets = useMemo(() => (
    dedupeAssets(assets)
      .filter((item) => assetLocalAvailable(item))
      .filter((item) => assetKey(item) !== currentAssetKey)
      .filter((item) => !/\.(srt|transcript\.json)$/iu.test(assetName(item)))
      .sort((left, right) => assetName(left).localeCompare(assetName(right)))
  ), [assets, currentAssetKey]);

  const assetMap = useMemo(() => {
    const map = new Map();
    availableAssets.forEach((item) => {
      const key = assetKey(item);
      if (key) map.set(key, item);
      const id = assetId(item);
      if (id) map.set(id, item);
    });
    jsonArray(manifest.assets).forEach((ref) => {
      if (!map.has(ref.id)) map.set(ref.id, ref);
    });
    return map;
  }, [availableAssets, manifest.assets]);

  const includedIds = useMemo(() => new Set(jsonArray(manifest.assets).map((item) => item.id)), [manifest.assets]);
  const sortedTimeline = useMemo(() => (
    jsonArray(manifest.timeline).slice().sort((left, right) => numberValue(left.start) - numberValue(right.start))
  ), [manifest.timeline]);
  const duration = useMemo(() => timelineDuration(manifest.timeline, numberValue(manifest.duration, DEFAULT_CLIP_DURATION)), [manifest]);
  const iframeHtml = useMemo(() => buildHyperframeHtml(manifest, assetMap, { forPreview: true }), [assetMap, manifest]);

  useEffect(() => {
    const runId = loadRunRef.current + 1;
    loadRunRef.current = runId;
    setLoading(true);
    setError("");
    setStatus("Opening");
    setExportedItems([]);
    setSelectedClipId("");
    const load = async () => {
      try {
        const loaded = initialDocument?.assetKey === currentAssetKey
          ? initialDocument
          : await loadHyperframeAsset(asset);
        if (loadRunRef.current !== runId) return;
        const nextManifest = normalizeHyperframeManifest(loaded.manifest, asset);
        const draft = readDraft(draftKey);
        const draftManifest = jsonObject(draft?.manifest);
        if (draftManifest) {
          setManifest(normalizeHyperframeManifest(draftManifest, asset));
          setStatus("Draft restored");
        } else {
          setManifest(nextManifest);
          setStatus(loaded.isHyperframe ? "Ready" : "Converted");
        }
        setLoadedAssetKey(currentAssetKey);
      } catch (nextError) {
        if (loadRunRef.current !== runId) return;
        setManifest(defaultHyperframeManifest(asset));
        setError(nextError?.message || String(nextError || "Unable to open Hyperframe."));
        setStatus("Open failed");
      } finally {
        if (loadRunRef.current === runId) setLoading(false);
      }
    };
    void load();
  }, [asset, currentAssetKey, draftKey, initialDocument]);

  useEffect(() => {
    if (loading || !loadedAssetKey || loadedAssetKey !== currentAssetKey) return undefined;
    const timeout = window.setTimeout(() => {
      writeDraft(draftKey, {
        manifest,
        sourceAssetKey: currentAssetKey,
        updatedAt: Date.now(),
      });
      setStatus((current) => (["Opening", "Saving", "Exporting"].includes(current) ? current : "Autosaved"));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [currentAssetKey, draftKey, loadedAssetKey, loading, manifest]);

  useEffect(() => {
    const handlePlayerMessage = (event) => {
      const data = event?.data;
      if (!data || data.type !== "hf-state") return;
      if (previewFrameRef.current && event.source !== previewFrameRef.current.contentWindow) return;
      const time = Math.max(0, numberValue(data.time, 0));
      playerTimeRef.current = time;
      setPlayerState({
        duration: Math.max(0, numberValue(data.duration, 0)),
        playing: data.playing !== false,
        time,
      });
    };
    window.addEventListener("message", handlePlayerMessage);
    return () => window.removeEventListener("message", handlePlayerMessage);
  }, []);

  const sendPlayerCommand = useCallback((action, time) => {
    try {
      previewFrameRef.current?.contentWindow?.postMessage(
        { action, time, type: "hf-control" },
        "*",
      );
    } catch {
      // The preview iframe may not be ready yet.
    }
    if (action === "play" || action === "pause") {
      setPlayerState((current) => ({ ...current, playing: action === "play" }));
    }
    if (action === "seek") {
      setPlayerState((current) => ({ ...current, time: Math.max(0, numberValue(time, 0)) }));
    }
  }, []);

  useEffect(() => {
    if (!aiJobsKey || aiJobsLoadedKeyRef.current === aiJobsKey) return;
    aiJobsLoadedKeyRef.current = aiJobsKey;
    setAiJobs(readAiJobs(aiJobsKey));
  }, [aiJobsKey]);

  useEffect(() => {
    if (!aiJobsKey || aiJobsLoadedKeyRef.current !== aiJobsKey) return;
    writeAiJobs(aiJobsKey, aiJobs);
  }, [aiJobs, aiJobsKey]);

  useEffect(() => {
    if (!workspaces.length) return;
    setAiWorkspaceId((current) => (
      current && workspaces.some((workspace) => workspace.id === current)
        ? current
        : text(workspaces[0]?.id)
    ));
  }, [workspaces]);

  const hasActiveAiJobs = aiJobs.some((job) => !AI_JOB_TERMINAL_STATUSES.has(job.phase) || job.phase === "completed");
  useEffect(() => {
    if (!hasActiveAiJobs) return undefined;
    const syncJobs = () => {
      const nowMs = Date.now();
      let agentFinishedEditing = false;
      setAiJobs((current) => {
        let changed = false;
        const next = current
          .map((job) => {
            if (job.phase === "completed" || job.phase === "failed") return job;
            const receipt = readTodoQueueReceipt(job.workspaceId, job.commandId);
            const receiptPhase = aiJobPhaseFromReceiptStatus(receipt?.status);
            if (receiptPhase && receiptPhase !== job.phase) {
              changed = true;
              if (receiptPhase === "completed") {
                agentFinishedEditing = true;
              }
              return {
                ...job,
                completedAtMs: receiptPhase === "completed" ? nowMs : job.completedAtMs,
                phase: receiptPhase,
              };
            }
            if (!receipt && job.phase === "queued" && nowMs - job.createdAtMs > AI_JOB_UNDELIVERED_MS) {
              changed = true;
              return { ...job, phase: "undelivered" };
            }
            return job;
          })
          .filter((job) => {
            if (job.phase === "completed" && job.completedAtMs && nowMs - job.completedAtMs > AI_JOB_FADE_MS) {
              changed = true;
              return false;
            }
            return true;
          });
        return changed ? next : current;
      });
      if (agentFinishedEditing) {
        window.setTimeout(() => reloadFromDiskRef.current?.(), 0);
      }
    };
    syncJobs();
    const timer = window.setInterval(syncJobs, 1500);
    window.addEventListener("storage", syncJobs);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", syncJobs);
    };
  }, [hasActiveAiJobs]);

  const timelineTimeFromClientX = useCallback((clientX) => {
    const strip = timelineStripRef.current;
    if (!strip || !duration) return 0;
    const bounds = strip.getBoundingClientRect();
    if (!bounds.width) return 0;
    const ratio = clampNumber((clientX - bounds.left) / bounds.width, 0, 1, 0);
    return Number((ratio * duration).toFixed(2));
  }, [duration]);

  const handleTimelinePointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    const startTime = timelineTimeFromClientX(event.clientX);
    timelineDragRef.current = { moved: false, startClientX: event.clientX, startTime };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [timelineTimeFromClientX]);

  const handleTimelinePointerMove = useCallback((event) => {
    const drag = timelineDragRef.current;
    if (!drag) return;
    if (!drag.moved && Math.abs(event.clientX - drag.startClientX) < 5) return;
    drag.moved = true;
    const currentTime = timelineTimeFromClientX(event.clientX);
    setTimelineSelection({
      end: Math.max(drag.startTime, currentTime),
      start: Math.min(drag.startTime, currentTime),
    });
  }, [timelineTimeFromClientX]);

  const handleTimelinePointerUp = useCallback((event) => {
    const drag = timelineDragRef.current;
    timelineDragRef.current = null;
    if (!drag) return;
    if (!drag.moved) {
      sendPlayerCommand("seek", timelineTimeFromClientX(event.clientX));
    }
  }, [sendPlayerCommand, timelineTimeFromClientX]);

  const selectClipRange = useCallback((clip) => {
    const start = Math.max(0, numberValue(clip.start, 0));
    setSelectedClipId(clip.id);
    setTimelineSelection({
      end: Number((start + Math.max(0.25, numberValue(clip.duration, DEFAULT_CLIP_DURATION))).toFixed(2)),
      start: Number(start.toFixed(2)),
    });
  }, []);

  const updateManifest = useCallback((updater) => {
    setManifest((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      return normalizeHyperframeManifest(next, asset);
    });
  }, [asset]);

  const attachTranscriptToManifest = useCallback((localPath, result) => {
    const safePath = text(localPath);
    if (!safePath || !result?.srtPath) return;
    updateManifest((current) => ({
      ...current,
      assets: jsonArray(current.assets).map((ref) => (
        text(ref.localPath) === safePath
          ? {
            ...ref,
            ...(result.durationSeconds ? { durationSeconds: result.durationSeconds } : {}),
            transcript: {
              generatedAt: new Date().toISOString(),
              jsonPath: text(result.jsonPath),
              language: text(result.language, "en"),
              srtPath: text(result.srtPath),
              tool: text(result.tool, "deepgram"),
            },
          }
          : ref
      )),
    }));
    setStatus("Transcript attached");
  }, [updateManifest]);

  const transcriptScanRef = useRef(new Set());
  useEffect(() => {
    if (loading) return;
    jsonArray(manifest.assets)
      .filter((ref) => ["audio", "video"].includes(String(ref.kind || "").toLowerCase()))
      .filter((ref) => text(ref.localPath) && !jsonObject(ref.transcript))
      .forEach((ref) => {
        const path = text(ref.localPath);
        if (transcriptScanRef.current.has(path)) return;
        transcriptScanRef.current.add(path);
        void getMediaTranscriptStatus(path).then((statusResult) => {
          if (statusResult?.exists) {
            attachTranscriptToManifest(path, {
              jsonPath: statusResult.jsonPath,
              srtPath: statusResult.srtPath,
              tool: "existing",
            });
          }
        });
      });
  }, [attachTranscriptToManifest, loading, manifest.assets]);

  const setTitle = useCallback((value) => {
    updateManifest((current) => ({ ...current, title: value }));
  }, [updateManifest]);

  const toggleIncludedAsset = useCallback((candidate) => {
    const ref = hyperframeAssetReference(candidate);
    updateManifest((current) => {
      const exists = jsonArray(current.assets).some((item) => item.id === ref.id);
      if (exists) {
        return {
          ...current,
          assets: jsonArray(current.assets).filter((item) => item.id !== ref.id),
          timeline: jsonArray(current.timeline).filter((clip) => clip.assetId !== ref.id),
        };
      }
      const start = timelineDuration(current.timeline, 0);
      return {
        ...current,
        assets: [...jsonArray(current.assets), ref],
        timeline: [
          ...jsonArray(current.timeline),
          {
            id: `clip-${Date.now().toString(36)}-${ref.id.replace(/[^a-z0-9_-]+/giu, "-")}`,
            assetId: ref.id,
            duration: DEFAULT_CLIP_DURATION,
            start,
            title: ref.name,
            type: "clip",
          },
        ],
      };
    });
  }, [updateManifest]);

  const addTimelineClip = useCallback((ref) => {
    updateManifest((current) => ({
      ...current,
      timeline: [
        ...jsonArray(current.timeline),
        {
          id: `clip-${Date.now().toString(36)}`,
          assetId: ref.id,
          duration: DEFAULT_CLIP_DURATION,
          start: timelineDuration(current.timeline, 0),
          title: ref.name,
          type: "clip",
        },
      ],
    }));
  }, [updateManifest]);

  const updateClip = useCallback((clipId, patch) => {
    updateManifest((current) => ({
      ...current,
      timeline: jsonArray(current.timeline).map((clip) => (
        clip.id === clipId
          ? {
            ...clip,
            ...patch,
            duration: patch.duration === undefined ? clip.duration : clampNumber(patch.duration, 0.25, 3600, DEFAULT_CLIP_DURATION),
            start: patch.start === undefined ? clip.start : clampNumber(patch.start, 0, 3600, 0),
          }
          : clip
      )),
    }));
  }, [updateManifest]);

  const removeClip = useCallback((clipId) => {
    updateManifest((current) => ({
      ...current,
      timeline: jsonArray(current.timeline).filter((clip) => clip.id !== clipId),
    }));
  }, [updateManifest]);

  const moveClip = useCallback((clipId, direction) => {
    updateManifest((current) => {
      const timeline = sortedTimeline.length ? sortedTimeline : jsonArray(current.timeline);
      const index = timeline.findIndex((clip) => clip.id === clipId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= timeline.length) return current;
      const next = timeline.slice();
      const [clip] = next.splice(index, 1);
      next.splice(nextIndex, 0, clip);
      let cursor = 0;
      return {
        ...current,
        timeline: next.map((item) => {
          const updated = { ...item, start: Number(cursor.toFixed(2)) };
          cursor += numberValue(item.duration, DEFAULT_CLIP_DURATION);
          return updated;
        }),
      };
    });
  }, [sortedTimeline, updateManifest]);

  const resetDraft = useCallback(() => {
    clearDraft(draftKey);
    setStatus("Draft cleared");
    setLoading(true);
    const reload = async () => {
      const loaded = await loadHyperframeAsset(asset);
      setManifest(normalizeHyperframeManifest(loaded.manifest, asset));
      setLoading(false);
    };
    void reload().catch((nextError) => {
      setError(nextError?.message || String(nextError || "Unable to reset draft."));
      setLoading(false);
    });
  }, [asset, draftKey]);

  const reloadAgentChanges = useCallback(() => {
    // Pull the agent's on-disk edit into the editor automatically, resuming
    // playback where the user left off so the update feels seamless.
    pendingSeekTimeRef.current = playerTimeRef.current;
    clearDraft(draftKey);
    const reload = async () => {
      const loaded = await loadHyperframeAsset(asset);
      setManifest(normalizeHyperframeManifest(loaded.manifest, asset));
      setStatus("Agent changes loaded");
    };
    void reload().catch((nextError) => {
      setError(nextError?.message || String(nextError || "Unable to load agent changes."));
      setStatus("Reload failed");
    });
  }, [asset, draftKey]);
  reloadFromDiskRef.current = reloadAgentChanges;

  const refreshLibraries = useCallback(async () => {
    await Promise.all([
      typeof onRefreshUntracked === "function" ? onRefreshUntracked({ silent: true, force: true }) : Promise.resolve(null),
      typeof onRefreshTracked === "function" ? onRefreshTracked({ silent: true, force: true }) : Promise.resolve(null),
    ]);
  }, [onRefreshTracked, onRefreshUntracked]);

  const recordExport = useCallback((result, label) => {
    const item = result?.item || null;
    setExportedItems((current) => [
      {
        id: `${Date.now()}-${label}`,
        label,
        name: text(item?.name || item?.filename || result?.path, label),
        path: text(result?.path || item?.localPath || item?.local_path),
      },
      ...current,
    ].slice(0, 6));
  }, []);

  const saveTextExport = useCallback(async ({ label, name, overwrite = false, text: body }) => {
    setBusyKey(label);
    setError("");
    setStatus("Saving");
    try {
      const result = await invoke("diffforge_save_untracked_text_asset", {
        request: {
          group: "hyperframes",
          name,
          overwrite,
          path: overwrite ? assetLocalPath(asset) : undefined,
          text: body,
        },
      });
      recordExport(result, label);
      await refreshLibraries();
      setStatus("Saved");
      return result;
    } catch (nextError) {
      setError(nextError?.message || String(nextError || "Unable to save Hyperframe export."));
      return null;
    } finally {
      setBusyKey("");
    }
  }, [asset, recordExport, refreshLibraries]);

  const exportProjectHtml = useCallback(async () => {
    const name = `${slug(manifest.title)}.hyperframe.html`;
    const html = buildHyperframeHtml(manifest, assetMap, { forPreview: false });
    const overwrite = isUntrackedAsset(asset) && assetLocalPath(asset) && assetFileExtension(asset) === "html";
    const result = await saveTextExport({
      label: overwrite ? "Project HTML updated" : "Project HTML saved",
      name,
      overwrite,
      text: html,
    });
    if (result && overwrite) {
      clearDraft(draftKey);
    }
  }, [asset, assetMap, draftKey, manifest, saveTextExport]);

  const exportManifestJson = useCallback(async () => {
    await saveTextExport({
      label: "Manifest JSON saved",
      name: `${slug(manifest.title)}.hyperframe.json`,
      text: JSON.stringify(resolvedManifest(manifest, assetMap, { forPreview: false }), null, 2),
    });
  }, [assetMap, manifest, saveTextExport]);

  const saveDataUrlExport = useCallback(async ({ dataUrl, label, name }) => {
    setBusyKey(label);
    setError("");
    setStatus("Exporting");
    try {
      const result = await invoke("diffforge_save_untracked_data_url_asset", {
        request: {
          dataUrl,
          group: "hyperframes",
          name,
        },
      });
      recordExport(result, label);
      await refreshLibraries();
      setStatus("Exported");
      return result;
    } catch (nextError) {
      setError(nextError?.message || String(nextError || "Unable to save Hyperframe export."));
      return null;
    } finally {
      setBusyKey("");
      setExportProgress(0);
    }
  }, [recordExport, refreshLibraries]);

  const exportPosterPng = useCallback(async () => {
    const dataUrl = await renderPosterDataUrl(manifest, assetMap);
    await saveDataUrlExport({
      dataUrl,
      label: "Poster PNG saved",
      name: `${slug(manifest.title)}-poster.png`,
    });
  }, [assetMap, manifest, saveDataUrlExport]);

  const exportWebm = useCallback(async () => {
    setExportProgress(0);
    const dataUrl = await renderWebmDataUrl(manifest, assetMap, setExportProgress);
    await saveDataUrlExport({
      dataUrl,
      label: "WebM render saved",
      name: `${slug(manifest.title)}.webm`,
    });
  }, [assetMap, manifest, saveDataUrlExport]);

  const runExport = useCallback(async (action) => {
    setError("");
    try {
      if (action === "html") await exportProjectHtml();
      if (action === "json") await exportManifestJson();
      if (action === "poster") await exportPosterPng();
      if (action === "webm") await exportWebm();
    } catch (nextError) {
      setError(nextError?.message || String(nextError || "Unable to export Hyperframe."));
      setBusyKey("");
      setExportProgress(0);
      setStatus("Export failed");
    }
  }, [exportManifestJson, exportPosterPng, exportProjectHtml, exportWebm]);

  const selectionClips = useMemo(() => {
    if (!timelineSelection) return [];
    return sortedTimeline.filter((clip) => {
      const start = numberValue(clip.start, 0);
      const end = start + numberValue(clip.duration, DEFAULT_CLIP_DURATION);
      return end > timelineSelection.start && start < timelineSelection.end;
    });
  }, [sortedTimeline, timelineSelection]);

  const aiWorkspace = useMemo(() => (
    workspaces.find((workspace) => workspace.id === aiWorkspaceId) || null
  ), [aiWorkspaceId, workspaces]);

  const sendAiEdit = useCallback(() => {
    const instruction = text(aiInstruction);
    setAiSendError("");
    if (!instruction) {
      setAiSendError("Describe the edit you want first.");
      return;
    }
    if (!aiWorkspace?.id) {
      setAiSendError("Choose a workspace to send the edit to.");
      return;
    }
    const commandId = `hyperframe-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
    const sourcePath = assetLocalPath(asset);
    const todoText = buildHyperframeTodoText({
      instruction,
      manifest,
      range: timelineSelection,
      rangeClips: selectionClips,
      sourcePath,
    });
    window.dispatchEvent(new CustomEvent(REMOTE_TODO_QUEUE_EVENT, {
      detail: {
        commandId,
        item: {
          createdAt: new Date().toISOString(),
          id: commandId,
          kind: "todo",
          remoteCommand: {
            commandId,
            source: "hyperframe-editor",
          },
          source: "next-remote-control",
          targetAgentId: aiAgentId || "",
          text: todoText,
          workspaceId: aiWorkspace.id,
        },
        source: "hyperframe-editor",
        workspaceId: aiWorkspace.id,
        workspaceName: aiWorkspace.name || "",
      },
    }));
    setAiJobs((current) => [
      {
        agentId: aiAgentId || "",
        commandId,
        completedAtMs: 0,
        createdAtMs: Date.now(),
        instruction,
        phase: "queued",
        range: timelineSelection ? { ...timelineSelection } : null,
        workspaceId: aiWorkspace.id,
        workspaceName: aiWorkspace.name || aiWorkspace.id,
      },
      ...current,
    ].slice(0, 24));
    setAiInstruction("");
    setStatus("Edit sent");
  }, [aiAgentId, aiInstruction, aiWorkspace, asset, manifest, selectionClips, timelineSelection]);

  const dismissAiJob = useCallback((commandId) => {
    setAiJobs((current) => current.filter((job) => job.commandId !== commandId));
  }, []);

  const panelTitle = activePanel === "timeline"
    ? "Timeline"
    : activePanel === "export"
      ? "Export"
      : activePanel === "agent"
        ? "AI Edit"
        : "Assets";

  return (
    <HyperframeSurface aria-label="Hyperframe editor">
      <HyperframeTopbar>
        <HyperframeIconButton aria-label="Back to assets" onClick={onBack} title="Back to assets" type="button">
          <ArrowBack aria-hidden="true" />
        </HyperframeIconButton>
        <HyperframeTitleBlock>
          <HyperframeKicker>
            <VideoLibrary aria-hidden="true" />
            <span>Hyperframe</span>
          </HyperframeKicker>
          <HyperframeTitleInput
            aria-label="Hyperframe title"
            disabled={loading}
            onChange={(event) => setTitle(event.target.value)}
            value={manifest.title}
          />
        </HyperframeTitleBlock>
        <HyperframeStatus>
          <span>{loading ? "Loading" : status}</span>
          <strong>{manifest.assets.length} asset{manifest.assets.length === 1 ? "" : "s"} / {duration.toFixed(1)}s</strong>
        </HyperframeStatus>
      </HyperframeTopbar>
      {(error || loading) && (
        <HyperframeNotice data-error={error ? "true" : "false"}>
          {error || "Opening Hyperframe..."}
        </HyperframeNotice>
      )}
      <HyperframeWorkspace>
        <HyperframePreviewPane>
          <HyperframePreviewFrame
            onLoad={() => {
              const pendingSeekTime = pendingSeekTimeRef.current;
              if (pendingSeekTime == null) return;
              pendingSeekTimeRef.current = null;
              window.setTimeout(() => sendPlayerCommand("seek", pendingSeekTime), 60);
            }}
            ref={previewFrameRef}
            sandbox="allow-scripts"
            srcDoc={iframeHtml}
            title={`${manifest.title} preview`}
          />
          <HyperframePlayerBar>
            <HyperframeIconButton
              aria-label={playerState.playing ? "Pause preview" : "Play preview"}
              onClick={() => sendPlayerCommand(playerState.playing ? "pause" : "play")}
              title={playerState.playing ? "Pause" : "Play"}
              type="button"
            >
              {playerState.playing ? <Pause aria-hidden="true" /> : <PlayArrow aria-hidden="true" />}
            </HyperframeIconButton>
            <HyperframePlayerScrubber
              aria-label="Preview position"
              max={Math.max(playerState.duration, duration, 0.25)}
              min="0"
              onChange={(event) => sendPlayerCommand("seek", Number(event.target.value))}
              step="0.05"
              type="range"
              value={Math.min(playerState.time, Math.max(playerState.duration, duration, 0.25))}
            />
            <HyperframePlayerTime>
              {formatTimecode(playerState.time)} / {formatTimecode(Math.max(playerState.duration, duration))}
            </HyperframePlayerTime>
          </HyperframePlayerBar>
        </HyperframePreviewPane>
        <HyperframeInspector>
          <HyperframePanelHeader>
            <strong>{panelTitle}</strong>
            <span>{activePanel === "assets" ? `${manifest.assets.length} included` : activePanel === "timeline" ? `${sortedTimeline.length} clip${sortedTimeline.length === 1 ? "" : "s"}` : activePanel === "agent" ? `${aiJobs.length} job${aiJobs.length === 1 ? "" : "s"}` : `${exportedItems.length} output${exportedItems.length === 1 ? "" : "s"}`}</span>
          </HyperframePanelHeader>
          {activePanel === "assets" && (
            <HyperframeAssetPicker>
              {availableAssets.map((candidate) => {
                const key = assetKey(candidate);
                const included = includedIds.has(key);
                const preview = assetPreviewUrl(candidate);
                const candidateLocalPath = assetLocalPath(candidate);
                const isMedia = assetIsVideo(candidate) || assetIsAudio(candidate);
                return (
                  <HyperframeAssetEntry key={key}>
                    <HyperframeAssetOption
                      aria-pressed={included}
                      data-included={included ? "true" : "false"}
                      onClick={() => toggleIncludedAsset(candidate)}
                      title={candidateLocalPath || assetName(candidate)}
                      type="button"
                    >
                      <HyperframeAssetCheck>
                        {included ? <CheckBox aria-hidden="true" /> : <CheckBoxOutlineBlank aria-hidden="true" />}
                      </HyperframeAssetCheck>
                      <HyperframeAssetThumb>
                        {preview ? (
                          <img alt="" draggable={false} src={preview} />
                        ) : (
                          assetIcon(candidate)
                        )}
                      </HyperframeAssetThumb>
                      <HyperframeAssetText>
                        <strong>{assetName(candidate)}</strong>
                        <span>{assetTypeLabel(candidate)}</span>
                      </HyperframeAssetText>
                    </HyperframeAssetOption>
                    {isMedia && candidateLocalPath ? (
                      <HyperframeAssetChipRow>
                        <MediaTranscriptChip
                          localPath={candidateLocalPath}
                          mediaName={assetName(candidate)}
                          onTranscribed={(result) => attachTranscriptToManifest(candidateLocalPath, result)}
                        />
                      </HyperframeAssetChipRow>
                    ) : null}
                  </HyperframeAssetEntry>
                );
              })}
              {!availableAssets.length && (
                <HyperframeEmpty>No local assets available.</HyperframeEmpty>
              )}
            </HyperframeAssetPicker>
          )}
          {activePanel === "timeline" && (
            <HyperframeTimelinePanel>
              <HyperframeTimelineStats>
                <span>{duration.toFixed(2)} seconds</span>
                <span>{manifest.canvas.width}x{manifest.canvas.height}</span>
              </HyperframeTimelineStats>
              <HyperframeTimelineList>
                {sortedTimeline.map((clip, index) => {
                  const ref = manifest.assets.find((item) => item.id === clip.assetId);
                  const source = ref ? assetMap.get(ref.id) || ref : null;
                  const selected = selectedClipId === clip.id;
                  return (
                    <HyperframeTimelineClip data-selected={selected ? "true" : "false"} key={clip.id}>
                      <HyperframeClipHeader>
                        <button onClick={() => setSelectedClipId(selected ? "" : clip.id)} type="button">
                          <PlayArrow aria-hidden="true" />
                          <span>{shortLabel(ref?.name || source?.name || clip.title || `Clip ${index + 1}`, 28)}</span>
                        </button>
                        <HyperframeClipActions>
                          <HyperframeIconButton aria-label="Move clip up" disabled={index === 0} onClick={() => moveClip(clip.id, -1)} title="Move up" type="button">
                            <ArrowUpward aria-hidden="true" />
                          </HyperframeIconButton>
                          <HyperframeIconButton aria-label="Move clip down" disabled={index >= sortedTimeline.length - 1} onClick={() => moveClip(clip.id, 1)} title="Move down" type="button">
                            <ArrowDownward aria-hidden="true" />
                          </HyperframeIconButton>
                          <HyperframeIconButton aria-label="Remove clip" data-danger="true" onClick={() => removeClip(clip.id)} title="Remove clip" type="button">
                            <Delete aria-hidden="true" />
                          </HyperframeIconButton>
                        </HyperframeClipActions>
                      </HyperframeClipHeader>
                      <HyperframeClipFields>
                        <label>
                          <span>Start</span>
                          <input min="0" onChange={(event) => updateClip(clip.id, { start: event.target.value })} step="0.25" type="number" value={clip.start} />
                        </label>
                        <label>
                          <span>Duration</span>
                          <input min="0.25" onChange={(event) => updateClip(clip.id, { duration: event.target.value })} step="0.25" type="number" value={clip.duration} />
                        </label>
                        {["audio", "video"].includes(String(ref?.kind || "").toLowerCase()) ? (
                          <>
                            <label title="Seconds into the source media where this clip starts playing">
                              <span>Source in</span>
                              <input min="0" onChange={(event) => updateClip(clip.id, { sourceIn: event.target.value })} step="0.1" type="number" value={clip.sourceIn || 0} />
                            </label>
                            <label title="Seconds into the source media where this clip stops (0 = play to end)">
                              <span>Source out</span>
                              <input min="0" onChange={(event) => updateClip(clip.id, { sourceOut: event.target.value })} step="0.1" type="number" value={clip.sourceOut || 0} />
                            </label>
                          </>
                        ) : null}
                      </HyperframeClipFields>
                    </HyperframeTimelineClip>
                  );
                })}
              </HyperframeTimelineList>
              {manifest.assets.length > 0 && (
                <HyperframeAddClipList>
                  {manifest.assets.map((ref) => (
                    <HyperframeMiniButton key={ref.id} onClick={() => addTimelineClip(ref)} type="button">
                      <AddCircle aria-hidden="true" />
                      <span>{shortLabel(ref.name, 22)}</span>
                    </HyperframeMiniButton>
                  ))}
                </HyperframeAddClipList>
              )}
            </HyperframeTimelinePanel>
          )}
          {activePanel === "agent" && (
            <HyperframeAgentPanel>
              <HyperframeAgentSelectionCard data-active={timelineSelection ? "true" : "false"}>
                <strong>
                  {timelineSelection
                    ? `${formatTimecode(timelineSelection.start)} – ${formatTimecode(timelineSelection.end)}`
                    : "Entire timeline"}
                </strong>
                <span>
                  {timelineSelection
                    ? `${selectionClips.length} clip${selectionClips.length === 1 ? "" : "s"} in range — drag on the timeline below to adjust`
                    : "Drag across the timeline below to target a specific area"}
                </span>
                {timelineSelection ? (
                  <HyperframeMiniButton onClick={() => setTimelineSelection(null)} type="button">
                    <Close aria-hidden="true" />
                    <span>Clear selection</span>
                  </HyperframeMiniButton>
                ) : null}
              </HyperframeAgentSelectionCard>
              <HyperframeAgentField>
                <span>Workspace</span>
                <select
                  aria-label="Target workspace"
                  onChange={(event) => setAiWorkspaceId(event.target.value)}
                  value={aiWorkspaceId}
                >
                  {!workspaces.length ? <option value="">No workspaces available</option> : null}
                  {workspaces.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                  ))}
                </select>
              </HyperframeAgentField>
              <HyperframeAgentField>
                <span>Coding agent</span>
                <select
                  aria-label="Target coding agent"
                  onChange={(event) => setAiAgentId(event.target.value)}
                  value={aiAgentId}
                >
                  {AI_AGENT_OPTIONS.map((option) => (
                    <option key={option.id || "any"} value={option.id}>{option.label}</option>
                  ))}
                </select>
              </HyperframeAgentField>
              <HyperframeAgentField>
                <span>What should change?</span>
                <textarea
                  aria-label="Edit instructions"
                  onChange={(event) => setAiInstruction(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      sendAiEdit();
                    }
                  }}
                  placeholder={timelineSelection
                    ? "e.g. Make this section punchier: shorten the clips and add the logo poster at the end"
                    : "e.g. Reorder the intro clips and tighten total duration to 12 seconds"}
                  rows={4}
                  value={aiInstruction}
                />
              </HyperframeAgentField>
              <HyperframeAgentSendRow>
                <span>{aiSendError || "Queued for the workspace's terminals — keep that workspace open."}</span>
                <HyperframeAgentSendButton
                  disabled={!workspaces.length || !text(aiInstruction)}
                  onClick={sendAiEdit}
                  title="Send edit to agent (Cmd/Ctrl+Enter)"
                  type="button"
                >
                  <Send aria-hidden="true" />
                  <span>Send to agent</span>
                </HyperframeAgentSendButton>
              </HyperframeAgentSendRow>
              <HyperframeAgentJobList>
                {aiJobs.map((job) => (
                  <HyperframeAgentJob data-phase={job.phase} key={job.commandId}>
                    <HyperframeAgentJobDot aria-hidden="true" data-phase={job.phase} />
                    <HyperframeAgentJobBody>
                      <strong title={job.instruction}>{shortLabel(job.instruction, 64)}</strong>
                      <span>
                        {job.range
                          ? `${formatTimecode(job.range.start)} – ${formatTimecode(job.range.end)}`
                          : "Entire timeline"}
                        {" · "}
                        {job.workspaceName}
                        {job.agentId ? ` · ${AI_AGENT_OPTIONS.find((option) => option.id === job.agentId)?.label || job.agentId}` : ""}
                      </span>
                    </HyperframeAgentJobBody>
                    <HyperframeAgentJobStatus data-phase={job.phase}>
                      {aiJobPhaseLabel(job.phase)}
                    </HyperframeAgentJobStatus>
                    {["failed", "undelivered"].includes(job.phase) ? (
                      <HyperframeIconButton
                        aria-label="Dismiss job"
                        onClick={() => dismissAiJob(job.commandId)}
                        title="Dismiss"
                        type="button"
                      >
                        <Close aria-hidden="true" />
                      </HyperframeIconButton>
                    ) : null}
                  </HyperframeAgentJob>
                ))}
                {!aiJobs.length ? (
                  <HyperframeEmpty>No AI edits sent yet.</HyperframeEmpty>
                ) : null}
              </HyperframeAgentJobList>
            </HyperframeAgentPanel>
          )}
          {activePanel === "export" && (
            <HyperframeExportPanel>
              <HyperframeExportGrid>
                <HyperframeExportButton disabled={Boolean(busyKey)} onClick={() => runExport("html")} type="button">
                  <Save aria-hidden="true" />
                  <strong>HTML</strong>
                  <span>{isUntrackedAsset(asset) ? "Update project" : "Save project"}</span>
                </HyperframeExportButton>
                <HyperframeExportButton disabled={Boolean(busyKey)} onClick={() => runExport("json")} type="button">
                  <Code aria-hidden="true" />
                  <strong>JSON</strong>
                  <span>Save manifest</span>
                </HyperframeExportButton>
                <HyperframeExportButton disabled={Boolean(busyKey)} onClick={() => runExport("poster")} type="button">
                  <Image aria-hidden="true" />
                  <strong>PNG</strong>
                  <span>Save poster</span>
                </HyperframeExportButton>
                <HyperframeExportButton disabled={Boolean(busyKey)} onClick={() => runExport("webm")} type="button">
                  <Movie aria-hidden="true" />
                  <strong>WebM</strong>
                  <span>Render video</span>
                </HyperframeExportButton>
              </HyperframeExportGrid>
              {busyKey && (
                <HyperframeProgress>
                  <span>{busyKey}</span>
                  <i style={{ width: `${exportProgress || 18}%` }} />
                </HyperframeProgress>
              )}
              <HyperframeExportActions>
                <HyperframeMiniButton disabled={loading || Boolean(busyKey)} onClick={resetDraft} type="button">
                  <RestartAlt aria-hidden="true" />
                  <span>Reset</span>
                </HyperframeMiniButton>
              </HyperframeExportActions>
              <HyperframeExportList>
                {exportedItems.map((item) => (
                  <li key={item.id} title={item.path}>
                    <FileDownload aria-hidden="true" />
                    <span>{shortLabel(item.name, 42)}</span>
                  </li>
                ))}
              </HyperframeExportList>
            </HyperframeExportPanel>
          )}
        </HyperframeInspector>
      </HyperframeWorkspace>
      <HyperframeTimelineStripSection aria-label="Timeline">
        <HyperframeTimelineStripHeader>
          <span>
            {timelineSelection
              ? `Selected ${formatTimecode(timelineSelection.start)} – ${formatTimecode(timelineSelection.end)}`
              : "Drag to select a timeline area · click to seek"}
          </span>
          <span>{formatTimecode(playerState.time)} / {formatTimecode(Math.max(playerState.duration, duration))}</span>
        </HyperframeTimelineStripHeader>
        <HyperframeTimelineStrip
          onPointerDown={handleTimelinePointerDown}
          onPointerMove={handleTimelinePointerMove}
          onPointerUp={handleTimelinePointerUp}
          ref={timelineStripRef}
        >
          {sortedTimeline.map((clip, index) => {
            const start = numberValue(clip.start, 0);
            const clipDuration = Math.max(0.25, numberValue(clip.duration, DEFAULT_CLIP_DURATION));
            const ref = manifest.assets.find((item) => item.id === clip.assetId);
            return (
              <HyperframeTimelineBlock
                data-selected={selectedClipId === clip.id ? "true" : "false"}
                key={clip.id}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  selectClipRange(clip);
                }}
                style={{
                  left: `${(start / duration) * 100}%`,
                  width: `${Math.max(1.2, (clipDuration / duration) * 100)}%`,
                }}
                title={`${ref?.name || clip.title || `Clip ${index + 1}`} — double-click to select range`}
              >
                <span>{shortLabel(ref?.name || clip.title || `Clip ${index + 1}`, 18)}</span>
              </HyperframeTimelineBlock>
            );
          })}
          {aiJobs.filter((job) => job.range).map((job) => (
            <HyperframeTimelineJobBand
              data-phase={job.phase}
              key={`band-${job.commandId}`}
              style={{
                left: `${(job.range.start / duration) * 100}%`,
                width: `${Math.max(0.8, ((job.range.end - job.range.start) / duration) * 100)}%`,
              }}
              title={`${aiJobPhaseLabel(job.phase)}: ${shortLabel(job.instruction, 60)}`}
            />
          ))}
          {timelineSelection ? (
            <HyperframeTimelineSelection
              style={{
                left: `${(timelineSelection.start / duration) * 100}%`,
                width: `${Math.max(0.4, ((timelineSelection.end - timelineSelection.start) / duration) * 100)}%`,
              }}
            />
          ) : null}
          <HyperframeTimelinePlayhead
            style={{ left: `${Math.min(100, (playerState.time / Math.max(playerState.duration, duration, 0.25)) * 100)}%` }}
          />
        </HyperframeTimelineStrip>
      </HyperframeTimelineStripSection>
      <HyperframeDock aria-label="Hyperframe editor sections">
        <HyperframeDockButton aria-pressed={activePanel === "assets"} data-active={activePanel === "assets"} onClick={() => setActivePanel("assets")} type="button">
          <PhotoLibrary aria-hidden="true" />
          <span>Assets</span>
        </HyperframeDockButton>
        <HyperframeDockButton aria-pressed={activePanel === "timeline"} data-active={activePanel === "timeline"} onClick={() => setActivePanel("timeline")} type="button">
          <Timeline aria-hidden="true" />
          <span>Timeline</span>
        </HyperframeDockButton>
        <HyperframeDockButton aria-pressed={activePanel === "agent"} data-active={activePanel === "agent"} onClick={() => setActivePanel("agent")} type="button">
          <SmartToy aria-hidden="true" />
          <span>AI Edit</span>
          {aiJobs.some((job) => ["queued", "editing", "paused"].includes(job.phase)) ? (
            <HyperframeDockBadge aria-hidden="true" />
          ) : null}
        </HyperframeDockButton>
        <HyperframeDockButton aria-pressed={activePanel === "export"} data-active={activePanel === "export"} onClick={() => setActivePanel("export")} type="button">
          <FileDownload aria-hidden="true" />
          <span>Export</span>
        </HyperframeDockButton>
      </HyperframeDock>
    </HyperframeSurface>
  );
}

const hyperframeSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const HyperframeSurface = styled.section`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  color: var(--forge-text);
  background: var(--forge-bg);
`;

const HyperframeTopbar = styled.header`
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 14px 16px 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.18);
`;

const HyperframeIconButton = styled.button`
  display: inline-grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  color: inherit;
  background: rgba(15, 23, 42, 0.42);
  cursor: pointer;

  svg {
    width: 18px;
    height: 18px;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.46;
  }

  &[data-danger="true"] {
    color: #fecaca;
  }
`;

const HyperframeTitleBlock = styled.div`
  display: grid;
  min-width: 0;
  gap: 3px;
`;

const HyperframeKicker = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--forge-muted);
  font-size: 0.72rem;
  font-weight: 800;
  text-transform: uppercase;

  svg {
    width: 15px;
    height: 15px;
  }
`;

const HyperframeTitleInput = styled.input`
  min-width: 0;
  width: 100%;
  border: 0;
  padding: 0;
  color: var(--forge-text);
  background: transparent;
  font: inherit;
  font-size: 1.12rem;
  font-weight: 800;
  outline: none;
`;

const HyperframeStatus = styled.div`
  display: grid;
  justify-items: end;
  gap: 3px;
  min-width: 120px;
  color: var(--forge-muted);
  font-size: 0.72rem;

  strong {
    color: var(--forge-text);
    font-size: 0.76rem;
  }
`;

const HyperframeNotice = styled.div`
  margin: 10px 16px 0;
  padding: 9px 11px;
  border: 1px solid rgba(59, 130, 246, 0.28);
  border-radius: 8px;
  color: #bfdbfe;
  background: rgba(30, 64, 175, 0.16);
  font-size: 0.78rem;

  &[data-error="true"] {
    border-color: rgba(248, 113, 113, 0.32);
    color: #fecaca;
    background: rgba(127, 29, 29, 0.16);
  }

  &:not([data-error="true"])::before {
    content: "";
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 8px;
    border: 2px solid rgba(191, 219, 254, 0.38);
    border-top-color: #bfdbfe;
    border-radius: 999px;
    animation: ${hyperframeSpin} 720ms linear infinite;
    vertical-align: -1px;
  }
`;

const HyperframeWorkspace = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 390px);
  gap: 12px;
  min-width: 0;
  min-height: 0;
  flex: 1;
  padding: 12px 16px;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
  }
`;

const HyperframePreviewPane = styled.div`
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: #05070c;
`;

const HyperframePreviewFrame = styled.iframe`
  width: 100%;
  height: 100%;
  min-height: 320px;
  border: 0;
  background: #05070c;
`;

const HyperframeInspector = styled.aside`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.24);
`;

const HyperframePanelHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);

  strong {
    font-size: 0.86rem;
  }

  span {
    color: var(--forge-muted);
    font-size: 0.74rem;
  }
`;

const HyperframeAssetPicker = styled.div`
  display: grid;
  align-content: start;
  gap: 8px;
  min-height: 0;
  overflow: auto;
  padding: 10px;
`;

const HyperframeAssetOption = styled.button`
  display: grid;
  grid-template-columns: 26px 46px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 58px;
  padding: 7px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  color: inherit;
  text-align: left;
  background: rgba(2, 6, 23, 0.26);
  cursor: pointer;

  &[data-included="true"] {
    border-color: rgba(94, 234, 212, 0.44);
    background: rgba(20, 184, 166, 0.1);
  }
`;

const HyperframeAssetEntry = styled.div`
  display: grid;
  min-width: 0;
  gap: 4px;
`;

const HyperframeAssetChipRow = styled.div`
  display: flex;
  min-width: 0;
  justify-content: flex-start;
  padding-left: 34px;
`;

const HyperframeAssetCheck = styled.span`
  display: grid;
  place-items: center;
  color: #5eead4;

  svg {
    width: 20px;
    height: 20px;
  }
`;

const HyperframeAssetThumb = styled.span`
  display: grid;
  place-items: center;
  width: 46px;
  height: 42px;
  overflow: hidden;
  border-radius: 7px;
  color: var(--forge-muted);
  background: rgba(15, 23, 42, 0.72);

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  svg {
    width: 22px;
    height: 22px;
  }
`;

const HyperframeAssetText = styled.span`
  display: grid;
  min-width: 0;
  gap: 3px;

  strong,
  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 0.8rem;
  }

  span {
    color: var(--forge-muted);
    font-size: 0.72rem;
  }
`;

const HyperframeEmpty = styled.div`
  padding: 18px 12px;
  border: 1px dashed rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  color: var(--forge-muted);
  text-align: center;
  font-size: 0.8rem;
`;

const HyperframeTimelinePanel = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
`;

const HyperframeTimelineStats = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  color: var(--forge-muted);
  font-size: 0.74rem;
`;

const HyperframeTimelineList = styled.div`
  display: grid;
  align-content: start;
  gap: 8px;
  min-height: 0;
  overflow: auto;
  padding: 0 10px 10px;
`;

const HyperframeTimelineClip = styled.article`
  display: grid;
  gap: 8px;
  padding: 9px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.24);

  &[data-selected="true"] {
    border-color: rgba(96, 165, 250, 0.42);
  }
`;

const HyperframeClipHeader = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;

  > button {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    border: 0;
    padding: 0;
    color: inherit;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  svg {
    width: 17px;
    height: 17px;
    flex: 0 0 auto;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 750;
    font-size: 0.8rem;
  }
`;

const HyperframeClipActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 5px;

  ${HyperframeIconButton} {
    width: 26px;
    height: 26px;

    svg {
      width: 15px;
      height: 15px;
    }
  }
`;

const HyperframeClipFields = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;

  label {
    display: grid;
    gap: 4px;
    min-width: 0;
    color: var(--forge-muted);
    font-size: 0.7rem;
    font-weight: 700;
  }

  input {
    min-width: 0;
    width: 100%;
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 7px;
    padding: 7px 8px;
    color: var(--forge-text);
    background: rgba(2, 6, 23, 0.36);
  }
`;

const HyperframeAddClipList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  padding: 0 10px 10px;
`;

const HyperframeMiniButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 30px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  padding: 6px 9px;
  color: inherit;
  background: rgba(15, 23, 42, 0.38);
  cursor: pointer;
  font-size: 0.76rem;
  font-weight: 750;

  svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }
`;

const HyperframeExportPanel = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 10px;
  overflow: auto;
  padding: 10px;
`;

const HyperframeExportGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
`;

const HyperframeExportButton = styled.button`
  display: grid;
  justify-items: start;
  gap: 5px;
  min-width: 0;
  min-height: 92px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  padding: 12px;
  color: inherit;
  background: rgba(2, 6, 23, 0.28);
  cursor: pointer;

  svg {
    width: 22px;
    height: 22px;
    color: #5eead4;
  }

  strong {
    font-size: 0.84rem;
  }

  span {
    color: var(--forge-muted);
    font-size: 0.72rem;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

const HyperframeProgress = styled.div`
  display: grid;
  gap: 6px;
  color: var(--forge-muted);
  font-size: 0.74rem;

  &::after {
    content: "";
    display: block;
    height: 1px;
  }

  > i {
    display: block;
    height: 6px;
    border-radius: 999px;
    background: #5eead4;
    min-width: 18%;
  }
`;

const HyperframeExportActions = styled.div`
  display: flex;
  justify-content: flex-end;
`;

const HyperframeExportList = styled.ul`
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;

  li {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    color: var(--forge-muted);
    font-size: 0.74rem;
  }

  svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    color: #93c5fd;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const HyperframeDock = styled.nav`
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 16px 14px;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(2, 6, 23, 0.12);
`;

const HyperframeDockButton = styled.button`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 0;
  min-height: 42px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  color: var(--forge-muted);
  background: rgba(15, 23, 42, 0.36);
  cursor: pointer;
  font-weight: 800;

  svg {
    width: 18px;
    height: 18px;
  }

  &[data-active="true"] {
    color: var(--forge-text);
    border-color: rgba(94, 234, 212, 0.46);
    background: rgba(20, 184, 166, 0.14);
  }
`;

const hyperframePulse = keyframes`
  0%, 100% {
    opacity: 0.5;
  }

  50% {
    opacity: 1;
  }
`;

const hyperframeFadeOut = keyframes`
  0%, 55% {
    opacity: 1;
  }

  100% {
    opacity: 0;
  }
`;

const HyperframeDockBadge = styled.i`
  position: absolute;
  top: 7px;
  right: 9px;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #f2c24e;
  animation: ${hyperframePulse} 1400ms ease-in-out infinite;
`;

const HyperframePlayerBar = styled.div`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(2, 6, 23, 0.55);
`;

const HyperframePlayerScrubber = styled.input`
  width: 100%;
  min-width: 0;
  height: 22px;
  margin: 0;
  accent-color: #5eead4;
  cursor: pointer;
  background: transparent;
`;

const HyperframePlayerTime = styled.span`
  min-width: 86px;
  color: var(--forge-muted);
  font-size: 0.72rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
`;

const HyperframeTimelineStripSection = styled.section`
  display: grid;
  gap: 5px;
  padding: 8px 16px 4px;
  border-top: 1px solid rgba(148, 163, 184, 0.14);
`;

const HyperframeTimelineStripHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--forge-muted);
  font-size: 0.7rem;

  span:last-child {
    font-variant-numeric: tabular-nums;
  }
`;

const HyperframeTimelineStrip = styled.div`
  position: relative;
  height: 52px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  background:
    repeating-linear-gradient(90deg, rgba(148, 163, 184, 0.08) 0 1px, transparent 1px 10%),
    rgba(2, 6, 23, 0.42);
  cursor: crosshair;
  touch-action: none;
  user-select: none;
`;

const HyperframeTimelineBlock = styled.div`
  position: absolute;
  top: 9px;
  bottom: 9px;
  display: grid;
  align-items: center;
  overflow: hidden;
  padding: 0 7px;
  border: 1px solid rgba(94, 234, 212, 0.32);
  border-radius: 6px;
  background: rgba(13, 148, 136, 0.2);
  pointer-events: auto;

  span {
    overflow: hidden;
    color: rgba(240, 253, 250, 0.88);
    font-size: 0.66rem;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
    pointer-events: none;
  }

  &[data-selected="true"] {
    border-color: rgba(96, 165, 250, 0.6);
    background: rgba(37, 99, 235, 0.24);
  }
`;

const HyperframeTimelineJobBand = styled.div`
  position: absolute;
  top: 2px;
  height: 5px;
  border-radius: 999px;
  background: #94a3b8;
  pointer-events: none;

  &[data-phase="queued"],
  &[data-phase="undelivered"] {
    background: #94a3b8;
  }

  &[data-phase="editing"] {
    background: #f2c24e;
    animation: ${hyperframePulse} 1100ms ease-in-out infinite;
  }

  &[data-phase="paused"] {
    background: #fb923c;
  }

  &[data-phase="failed"] {
    background: #ef6b6b;
  }

  &[data-phase="completed"] {
    background: #3ccb7f;
    animation: ${hyperframeFadeOut} 2400ms ease forwards;
  }
`;

const HyperframeTimelineSelection = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  border: 1px solid rgba(96, 165, 250, 0.66);
  border-top: 0;
  border-bottom: 0;
  background: rgba(59, 130, 246, 0.16);
  pointer-events: none;
`;

const HyperframeTimelinePlayhead = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1.5px;
  background: #f8fafc;
  box-shadow: 0 0 8px rgba(248, 250, 252, 0.55);
  pointer-events: none;
`;

const HyperframeAgentPanel = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 10px;
  overflow: auto;
  padding: 10px;
`;

const HyperframeAgentSelectionCard = styled.div`
  display: grid;
  justify-items: start;
  gap: 5px;
  padding: 10px;
  border: 1px dashed rgba(148, 163, 184, 0.3);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.26);

  strong {
    font-size: 0.86rem;
    font-variant-numeric: tabular-nums;
  }

  span {
    color: var(--forge-muted);
    font-size: 0.72rem;
  }

  &[data-active="true"] {
    border-color: rgba(96, 165, 250, 0.5);
    border-style: solid;
    background: rgba(37, 99, 235, 0.1);
  }
`;

const HyperframeAgentField = styled.label`
  display: grid;
  gap: 5px;
  color: var(--forge-muted);
  font-size: 0.72rem;
  font-weight: 700;

  select,
  textarea {
    min-width: 0;
    width: 100%;
    border: 1px solid rgba(148, 163, 184, 0.22);
    border-radius: 7px;
    padding: 8px 9px;
    color: var(--forge-text);
    background: rgba(2, 6, 23, 0.4);
    font: inherit;
    font-weight: 500;
  }

  textarea {
    resize: vertical;
    min-height: 74px;
    line-height: 1.45;
  }

  select:focus-visible,
  textarea:focus-visible {
    outline: 2px solid rgba(94, 234, 212, 0.4);
    outline-offset: 1px;
  }
`;

const HyperframeAgentSendRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;

  > span {
    min-width: 0;
    color: var(--forge-muted);
    font-size: 0.7rem;
  }
`;

const HyperframeAgentSendButton = styled.button`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
  min-height: 34px;
  border: 1px solid rgba(94, 234, 212, 0.46);
  border-radius: 8px;
  padding: 7px 13px;
  color: #042f2e;
  background: #5eead4;
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 800;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled) {
    background: #99f6e4;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

const HyperframeAgentJobList = styled.div`
  display: grid;
  align-content: start;
  gap: 7px;
`;

const HyperframeAgentJob = styled.div`
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 9px;
  padding: 8px 9px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.28);

  &[data-phase="completed"] {
    animation: ${hyperframeFadeOut} 2400ms ease forwards;
  }

  ${HyperframeIconButton} {
    width: 24px;
    height: 24px;

    svg {
      width: 14px;
      height: 14px;
    }
  }
`;

const HyperframeAgentJobDot = styled.i`
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #94a3b8;

  &[data-phase="editing"] {
    background: #f2c24e;
    animation: ${hyperframePulse} 1100ms ease-in-out infinite;
  }

  &[data-phase="paused"] {
    background: #fb923c;
  }

  &[data-phase="failed"],
  &[data-phase="undelivered"] {
    background: #ef6b6b;
  }

  &[data-phase="completed"] {
    background: #3ccb7f;
  }
`;

const HyperframeAgentJobBody = styled.div`
  display: grid;
  min-width: 0;
  gap: 3px;

  strong {
    overflow: hidden;
    font-size: 0.76rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--forge-muted);
    font-size: 0.68rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const HyperframeAgentJobStatus = styled.span`
  flex: 0 0 auto;
  padding: 2px 8px;
  border-radius: 999px;
  color: #cbd5e1;
  background: rgba(148, 163, 184, 0.14);
  font-size: 0.66rem;
  font-weight: 800;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  white-space: nowrap;

  &[data-phase="editing"] {
    color: #fde68a;
    background: rgba(242, 194, 78, 0.16);
  }

  &[data-phase="paused"] {
    color: #fed7aa;
    background: rgba(251, 146, 60, 0.16);
  }

  &[data-phase="failed"],
  &[data-phase="undelivered"] {
    color: #fecaca;
    background: rgba(239, 107, 107, 0.16);
  }

  &[data-phase="completed"] {
    color: #bbf7d0;
    background: rgba(60, 203, 127, 0.16);
  }
`;

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import styled, { keyframes } from "styled-components";
import { AddCircle } from "@styled-icons/material-rounded/AddCircle";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { ArrowDownward } from "@styled-icons/material-rounded/ArrowDownward";
import { ArrowUpward } from "@styled-icons/material-rounded/ArrowUpward";
import { CheckBox } from "@styled-icons/material-rounded/CheckBox";
import { CheckBoxOutlineBlank } from "@styled-icons/material-rounded/CheckBoxOutlineBlank";
import { Code } from "@styled-icons/material-rounded/Code";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { FileDownload } from "@styled-icons/material-rounded/FileDownload";
import { Image } from "@styled-icons/material-rounded/Image";
import { Movie } from "@styled-icons/material-rounded/Movie";
import { PhotoLibrary } from "@styled-icons/material-rounded/PhotoLibrary";
import { PlayArrow } from "@styled-icons/material-rounded/PlayArrow";
import { RestartAlt } from "@styled-icons/material-rounded/RestartAlt";
import { Save } from "@styled-icons/material-rounded/Save";
import { Timeline } from "@styled-icons/material-rounded/Timeline";
import { VideoLibrary } from "@styled-icons/material-rounded/VideoLibrary";

const HYPERFRAME_VERSION = "1.0";
const HYPERFRAME_MARKER = "diffforge-hyperframe";
const HYPERFRAME_MANIFEST_SCRIPT_ID = "diffforge-hyperframe-manifest";
const HYPERFRAME_DRAFT_PREFIX = "diffforge:hyperframe:draft:";
const DEFAULT_CLIP_DURATION = 3;
const DEFAULT_CANVAS = { height: 720, width: 1280 };
const ASSET_IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const ASSET_VIDEO_EXTENSIONS = new Set(["m4v", "mov", "mp4", "webm"]);

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
  const kind = assetIsImage(asset) ? "image" : assetIsVideo(asset) ? "video" : assetKind(asset);
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
    return {
      id: text(object.id, `clip-${index + 1}`),
      assetId: assetIdValue,
      duration: clampNumber(object.duration, 0.25, 3600, DEFAULT_CLIP_DURATION),
      start: clampNumber(object.start, 0, 3600, index * DEFAULT_CLIP_DURATION),
      title: text(object.title),
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
  let videoElement = null;
  const started = performance.now();

  function clipAt(time) {
    return timeline.find((clip) => time >= Number(clip.start || 0) && time < Number(clip.start || 0) + Number(clip.duration || 0)) || timeline[0] || null;
  }

  function renderClip(clip) {
    const asset = clip ? assets.get(clip.assetId) : null;
    const nextId = clip && asset ? clip.id + ":" + asset.id : "placeholder";
    if (activeClipId === nextId) return;
    activeClipId = nextId;
    frame.textContent = "";
    videoElement = null;
    if (asset && asset.src && String(asset.kind || "").toLowerCase() === "image") {
      const image = document.createElement("img");
      image.alt = asset.name || manifest.title || "Hyperframe asset";
      image.src = asset.src;
      frame.appendChild(image);
      return;
    }
    if (asset && asset.src && String(asset.kind || "").toLowerCase() === "video") {
      const video = document.createElement("video");
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.src = asset.src;
      frame.appendChild(video);
      videoElement = video;
      video.play().catch(() => {});
      return;
    }
    const placeholder = document.createElement("div");
    placeholder.className = "hf-placeholder";
    placeholder.innerHTML = "<strong></strong><span></span>";
    placeholder.querySelector("strong").textContent = asset?.name || clip?.title || manifest.title || "Hyperframe";
    placeholder.querySelector("span").textContent = asset ? (asset.kind || "asset") : "No clip";
    frame.appendChild(placeholder);
  }

  function tick(now) {
    const elapsed = ((now - started) / 1000) % duration;
    const clip = clipAt(elapsed);
    renderClip(clip);
    if (progress) progress.style.width = String(Math.min(100, Math.max(0, elapsed / duration * 100))) + "%";
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
  if (assetLooksLikeHyperframe(asset)) return "Hyperframe";
  const extension = assetFileExtension(asset);
  return extension ? extension.toUpperCase() : shortLabel(assetKind(asset).toUpperCase(), 10);
}

function assetIcon(asset) {
  if (assetIsVideo(asset)) return <Movie aria-hidden="true" />;
  if (assetIsImage(asset)) return <Image aria-hidden="true" />;
  if (assetLooksLikeHyperframe(asset)) return <VideoLibrary aria-hidden="true" />;
  return <Code aria-hidden="true" />;
}

export default function HyperframeEditor({
  asset,
  assets = [],
  initialDocument = null,
  onBack,
  onRefreshTracked,
  onRefreshUntracked,
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
  const loadRunRef = useRef(0);

  const currentAssetKey = assetKey(asset);
  const draftKey = currentAssetKey ? `${HYPERFRAME_DRAFT_PREFIX}${currentAssetKey}` : "";

  const availableAssets = useMemo(() => (
    dedupeAssets(assets)
      .filter((item) => assetLocalAvailable(item))
      .filter((item) => assetKey(item) !== currentAssetKey)
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

  const updateManifest = useCallback((updater) => {
    setManifest((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      return normalizeHyperframeManifest(next, asset);
    });
  }, [asset]);

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

  const panelTitle = activePanel === "timeline" ? "Timeline" : activePanel === "export" ? "Export" : "Assets";

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
            sandbox="allow-scripts"
            srcDoc={iframeHtml}
            title={`${manifest.title} preview`}
          />
        </HyperframePreviewPane>
        <HyperframeInspector>
          <HyperframePanelHeader>
            <strong>{panelTitle}</strong>
            <span>{activePanel === "assets" ? `${manifest.assets.length} included` : activePanel === "timeline" ? `${sortedTimeline.length} clip${sortedTimeline.length === 1 ? "" : "s"}` : `${exportedItems.length} output${exportedItems.length === 1 ? "" : "s"}`}</span>
          </HyperframePanelHeader>
          {activePanel === "assets" && (
            <HyperframeAssetPicker>
              {availableAssets.map((candidate) => {
                const key = assetKey(candidate);
                const included = includedIds.has(key);
                const preview = assetPreviewUrl(candidate);
                return (
                  <HyperframeAssetOption
                    aria-pressed={included}
                    data-included={included ? "true" : "false"}
                    key={key}
                    onClick={() => toggleIncludedAsset(candidate)}
                    title={assetLocalPath(candidate) || assetName(candidate)}
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
      <HyperframeDock aria-label="Hyperframe editor sections">
        <HyperframeDockButton aria-pressed={activePanel === "assets"} data-active={activePanel === "assets"} onClick={() => setActivePanel("assets")} type="button">
          <PhotoLibrary aria-hidden="true" />
          <span>Assets</span>
        </HyperframeDockButton>
        <HyperframeDockButton aria-pressed={activePanel === "timeline"} data-active={activePanel === "timeline"} onClick={() => setActivePanel("timeline")} type="button">
          <Timeline aria-hidden="true" />
          <span>Timeline</span>
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
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  padding: 10px 16px 14px;
  border-top: 1px solid rgba(148, 163, 184, 0.18);
  background: rgba(2, 6, 23, 0.12);
`;

const HyperframeDockButton = styled.button`
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

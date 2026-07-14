import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Pause } from "@styled-icons/material-rounded/Pause";
import { PhotoCamera } from "@styled-icons/material-rounded/PhotoCamera";
import { PlayArrow } from "@styled-icons/material-rounded/PlayArrow";
import { SkipPrevious } from "@styled-icons/material-rounded/SkipPrevious";
import {
  clipEndMs,
  clipsAtMs,
  formatTimecode,
  prepareGainEvaluator,
  preparePropEvaluator,
  projectDurationMs,
} from "./videoEditorModel.js";
import { VIDEO_EXPORT_PROGRESS_EVENT } from "./videoPanelBridge.js";
import { VideoErrorText, VideoHint, VideoIconButton, VideoPaneButton, VideoSecondaryButton } from "./videoStyles.js";
import { getRenderabilitySnapshot, subscribeToRenderability } from "../app/renderability.js";

const PRELOAD_AHEAD_MS = 3000;
const EVICT_BEHIND_MS = 5000;
const SECONDARY_DRIFT_MS = 350;
const SECONDARY_DRIFT_INTERVAL_MS = 1000;

const PreviewRoot = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
`;

const PreviewStage = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  background: #000000;
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const PreviewFrame = styled.div`
  position: relative;
  overflow: hidden;
  background: ${(props) => props.$background || "#000000"};
`;

const PreviewLayer = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;

  video,
  img {
    max-width: 100%;
    max-height: 100%;
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
  }
`;

const PreviewTextOverlay = styled.div`
  position: absolute;
  transform: translate(-50%, -50%);
  white-space: pre-wrap;
  line-height: 1.25;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;

  &:hover {
    outline: 1px dashed rgba(96, 165, 250, 0.7);
    outline-offset: 2px;
  }

  &[data-dragging="true"] {
    cursor: grabbing;
    outline: 1px dashed rgba(16, 185, 129, 0.85);
    outline-offset: 2px;
  }
`;

const PreviewEmpty = styled.div`
  color: rgba(148, 163, 184, 0.6);
  font-size: 12px;
  font-weight: 650;
  text-align: center;
  padding: 12px;
`;

const TransportRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 2px 0;
  flex: 0 0 auto;
`;

const TransportTime = styled.span`
  font-size: 11px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  color: #cbd5f5;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: #334155;
  }
`;

const TransportScrub = styled.input`
  flex: 1 1 auto;
  min-width: 40px;
  accent-color: #10b981;
`;

// --- Stage overlays (Tier 1 preview additions) -------------------------------
// Everything below sits ON the black letterbox stage, which is deliberately
// theme-independent (dark in both themes), so none of these carry
// `html[data-forge-theme="light"]` blocks — matching the stage convention.

// Vignette approximation (contract §1): sits above the media element inside
// the transform wrapper so it moves/scales with the clip.
const PreviewVignette = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
`;

// Full-frame solid used by dip-black / dip-white transitions; opacity driven
// per-frame from the current time (seek-safe, no CSS animations).
const PreviewDipOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  opacity: 0;
`;

// "FX approximate" hint chip on the stage corner (once, not per clip).
const StageFxBadge = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 4;
  font-size: 10px;
  font-weight: 700;
  color: #e2e8f0;
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 999px;
  padding: 3px 9px;
  pointer-events: none;
  white-space: nowrap;
`;

// Draft render result panel over the stage (§6).
const DraftOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 5;
  background: rgba(2, 3, 4, 0.94);
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;

  video {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    object-fit: contain;
    background: #000000;
    border-radius: 6px;
  }
`;

const DraftOverlayBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
`;

const DraftLabelChip = styled.span`
  font-size: 10px;
  font-weight: 750;
  color: #a7f3d0;
  background: rgba(16, 185, 129, 0.16);
  border: 1px solid rgba(16, 185, 129, 0.35);
  border-radius: 999px;
  padding: 3px 9px;
  white-space: nowrap;
`;

const DraftCloseButton = styled.button`
  margin-left: auto;
  appearance: none;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(15, 23, 42, 0.72);
  color: #e2e8f0;
  font-size: 11px;
  font-weight: 700;
  border-radius: 6px;
  padding: 3px 10px;
  cursor: pointer;

  &:hover {
    background: rgba(30, 41, 59, 0.92);
  }
`;

// Transform/crop handles for the selected media clip. Positioned in stage
// pixels (the frame is already screen-sized), so handle chrome stays
// constant-size regardless of previewScale/zoom.
const TransformHandlesBox = styled.div`
  position: absolute;
  z-index: 3;
  border: 1px solid rgba(96, 165, 250, 0.9);
  box-shadow: 0 0 0 1px rgba(2, 6, 23, 0.55);
  cursor: move;
  touch-action: none;
`;

const TransformHandleDot = styled.div`
  position: absolute;
  width: 11px;
  height: 11px;
  border-radius: 3px;
  background: #0f172a;
  border: 1.5px solid #60a5fa;
  transform: translate(-50%, -50%);
  touch-action: none;
`;

const CropToggleChip = styled.button`
  position: absolute;
  top: 4px;
  left: 4px;
  appearance: none;
  font-size: 10px;
  font-weight: 750;
  color: #bfdbfe;
  background: rgba(15, 23, 42, 0.85);
  border: 1px solid rgba(96, 165, 250, 0.5);
  border-radius: 999px;
  padding: 2px 9px;
  cursor: pointer;

  &[data-active="true"] {
    color: #0f172a;
    background: #60a5fa;
  }
`;

function isImageAsset(assetPath) {
  return /\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(assetPath || "");
}

function mediaSourceMs(clip, timelineMs) {
  return (clip?.sourceInMs || 0) + Math.max(0, timelineMs - (clip?.timelineStartMs || 0)) * (clip?.speed || 1);
}

function timelineMsFromMedia(clip, element) {
  const speed = clip?.speed || 1;
  return (clip?.timelineStartMs || 0) + ((element.currentTime * 1000 - (clip?.sourceInMs || 0)) / speed);
}

function mediaElementAtEnd(element) {
  if (!element) {
    return false;
  }
  const duration = Number(element.duration);
  return Boolean(
    element.ended
    || (Number.isFinite(duration) && duration > 0 && Number(element.currentTime) >= duration - 0.004),
  );
}

function isFfmpegInstallError(value) {
  return /ffmpeg|ffprobe|drawtext|video tools/i.test(String(value || ""));
}

function sameTimingWindow(left, right) {
  return Boolean(
    left
      && right
      && left.assetPath === right.assetPath
      && left.timelineStartMs === right.timelineStartMs
      && left.durationMs === right.durationMs
      && (left.sourceInMs || 0) === (right.sourceInMs || 0)
      && (left.speed || 1) === (right.speed || 1),
  );
}

function linkedAudioPartner(active, videoClip) {
  if (!videoClip?.linkId) {
    return null;
  }
  return (
    active.audio.find(({ clip }) => clip.linkId === videoClip.linkId && sameTimingWindow(videoClip, clip))?.clip || null
  );
}

function hasLinkedVideoTwin(project, audioClip) {
  if (!audioClip?.linkId) {
    return false;
  }
  for (const track of project?.tracks || []) {
    if (track.kind !== "video" || track.muted) {
      continue;
    }
    for (const clip of track.clips || []) {
      if (clip.linkId === audioClip.linkId && sameTimingWindow(clip, audioClip) && !isImageAsset(clip.assetPath)) {
        return true;
      }
    }
  }
  return false;
}

function nextClipBoundaryMs(project, timelineMs) {
  let next = Number.POSITIVE_INFINITY;
  for (const track of project?.tracks || []) {
    if (track.muted) {
      continue;
    }
    for (const clip of track.clips || []) {
      if (clip.timelineStartMs > timelineMs + 0.5) {
        next = Math.min(next, clip.timelineStartMs);
      }
    }
  }
  return Number.isFinite(next) ? next : null;
}

function topVisual(active) {
  return active.video.length ? active.video[active.video.length - 1] : null;
}

function volumeLevel(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

const TEXT_ENTRANCE_MS = 250;
const WORD_REVEAL_RAMP_MS = 150;
const DEFAULT_HIGHLIGHT_COLOR = "#fbbf24";

// CSS approximation of clip.fx (contract §1). previewScale scales blur so it
// tracks the rendered stage size (renderedStageWidth / project width).
// Temperature is a documented, subtle approximation: warm → sepia tint,
// cool → slight hue rotation. grain/curves/lut/chromaKey are NOT previewed.
function fxFilterString(fx, previewScale) {
  if (!fx) {
    return "";
  }
  const parts = [];
  if (fx.exposure) {
    parts.push(`brightness(${(1 + fx.exposure * 0.35).toFixed(4)})`);
  }
  if (fx.contrast !== 1) {
    parts.push(`contrast(${fx.contrast})`);
  }
  if (fx.saturation !== 1) {
    parts.push(`saturate(${fx.saturation})`);
  }
  if (fx.blur > 0) {
    parts.push(`blur(${(fx.blur * Math.max(0, previewScale)).toFixed(2)}px)`);
  }
  if (fx.temperature > 0) {
    parts.push(`sepia(${(fx.temperature / 300).toFixed(4)})`);
  } else if (fx.temperature < 0) {
    parts.push(`hue-rotate(${(fx.temperature * 0.12).toFixed(2)}deg)`);
  }
  return parts.join(" ");
}

// CSS has no "addition" blend mode; plus-lighter is the closest match.
function cssBlendMode(blend) {
  if (!blend || blend === "normal") {
    return "";
  }
  return blend === "addition" ? "plus-lighter" : blend;
}

function fxHasNonPreviewable(fx) {
  return Boolean(fx && ((fx.curves && fx.curves !== "none") || fx.lut || fx.chromaKey || fx.grain > 0));
}

// Static crop preview (contract §3): inset percentages from crop fractions.
function cropClipPath(crop) {
  if (!crop) {
    return "";
  }
  const pct = (value) => `${((value || 0) * 100).toFixed(3)}%`;
  return `inset(${pct(crop.t)} ${pct(crop.r)} ${pct(crop.b)} ${pct(crop.l)})`;
}

// Honest single-layer transition approximation (contract §2). The preview
// renders one visual clip at a time, so per-clip opacity multipliers are
// composed on top of the clip's own keyframed opacity: the outgoing clip
// ramps out during [boundary - d, boundary]; the incoming clip's ramp-in
// resolves to 1 by the time it becomes the visible clip. Dips hand the
// midpoint to the full-stage overlay below.
function transitionOpacityMultiplier(track, clip, timelineMs) {
  const transitions = track?.transitions;
  if (!Array.isArray(transitions) || !transitions.length || !clip) {
    return 1;
  }
  let mult = 1;
  for (const transition of transitions) {
    const durationMs = Number(transition?.durationMs) || 0;
    if (durationMs <= 0) {
      continue;
    }
    const afterClip = (track.clips || []).find((entry) => entry.id === transition.afterClipId);
    if (!afterClip) {
      continue;
    }
    const boundaryMs = clipEndMs(afterClip);
    const windowStartMs = boundaryMs - durationMs;
    if (timelineMs < windowStartMs || timelineMs > boundaryMs) {
      continue;
    }
    const progress = clamp01((timelineMs - windowStartMs) / durationMs);
    const isDip = transition.kind === "dip-black" || transition.kind === "dip-white";
    if (clip.id === transition.afterClipId) {
      // Outgoing clip: linear 1→0; dips finish the fade in the first half.
      mult *= isDip ? clamp01(1 - progress * 2) : 1 - progress;
    } else if (Math.abs(clip.timelineStartMs - boundaryMs) < 1) {
      // Incoming clip: linear 0→1; dips ramp in over the second half.
      mult *= isDip ? clamp01((progress - 0.5) * 2) : progress;
    }
  }
  return mult;
}

// Full-stage dip overlay state at a time, across all tracks (first hit wins).
function dipOverlayAt(project, timelineMs) {
  for (const track of project?.tracks || []) {
    if (track.muted) {
      continue;
    }
    for (const transition of track.transitions || []) {
      if (transition.kind !== "dip-black" && transition.kind !== "dip-white") {
        continue;
      }
      const durationMs = Number(transition?.durationMs) || 0;
      if (durationMs <= 0) {
        continue;
      }
      const afterClip = (track.clips || []).find((entry) => entry.id === transition.afterClipId);
      if (!afterClip) {
        continue;
      }
      const boundaryMs = clipEndMs(afterClip);
      const windowStartMs = boundaryMs - durationMs;
      if (timelineMs < windowStartMs || timelineMs > boundaryMs) {
        continue;
      }
      const progress = clamp01((timelineMs - windowStartMs) / durationMs);
      const alpha = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
      return { color: transition.kind === "dip-white" ? "#ffffff" : "#000000", alpha: clamp01(alpha) };
    }
  }
  return null;
}

// Text animations (contract §4): word anims need word timings; without them
// they fall back to none. pop/fade animate the whole clip entrance.
function effectiveTextAnim(clip) {
  const anim = clip?.anim || "none";
  if (anim === "pop" || anim === "fade") {
    return anim;
  }
  if (
    (anim === "typewriter" || anim === "word-reveal" || anim === "word-highlight")
    && Array.isArray(clip?.words)
    && clip.words.length
  ) {
    return anim;
  }
  return "none";
}

function isWordAnim(anim) {
  return anim === "typewriter" || anim === "word-reveal" || anim === "word-highlight";
}

// Whole-clip entrance state, derived from the clip-relative time (seek-safe).
function textEntranceState(anim, clipRelMs) {
  if (anim === "pop") {
    const progress = clamp01(clipRelMs / TEXT_ENTRANCE_MS);
    return { opacity: progress, scale: 0.85 + 0.15 * progress };
  }
  if (anim === "fade") {
    return { opacity: clamp01(clipRelMs / TEXT_ENTRANCE_MS), scale: 1 };
  }
  return { opacity: 1, scale: 1 };
}

// Per-word render state. Typewriter hides upcoming words (visibility keeps
// the layout stable so revealed words don't reflow on every start).
function wordSpanState(anim, word, clipRelMs, highlightColor) {
  if (anim === "typewriter") {
    return { visibility: word.startMs <= clipRelMs ? "visible" : "hidden", opacity: 1, color: "" };
  }
  if (anim === "word-reveal") {
    return { visibility: "visible", opacity: clamp01((clipRelMs - word.startMs) / WORD_REVEAL_RAMP_MS), color: "" };
  }
  if (anim === "word-highlight") {
    const activeWord = clipRelMs >= word.startMs && clipRelMs < word.endMs;
    return { visibility: "visible", opacity: 1, color: activeWord ? highlightColor : "" };
  }
  return { visibility: "visible", opacity: 1, color: "" };
}

// Approximate realtime preview of the timeline: the topmost active video-track
// clip renders visually (with CSS transform/opacity), audible clips play
// through pooled media elements, and text clips render as DOM overlays. Export
// via ffmpeg is the exact compositor; preview prioritizes responsive editing.
export default function VideoEditor({
  mediaRootAbs = "",
  playback = null,
  playheadMs = 0,
  playing = false,
  project,
  // Relative path of the open .pipe project inside the repo — required for
  // Draft render (§6). Optional: the pane passes it when available.
  projectRelPath = "",
  repoPath = "",
  // Currently selected media clip (object) + change callback for the
  // transform/crop handles overlay. Optional: overlay hides without them.
  selectedClip = null,
  // { startMs, endMs } timeline selection; Draft render falls back to the
  // full timeline when absent.
  selectedRange = null,
  onClipTransformChange = null,
  // Flushes the pane's debounced project autosave. Draft render reads the
  // saved file, so this must run before video_draft_render.
  onFlushProjectSave = null,
  onFfmpegInstallRequired = null,
  onSeek,
  onTogglePlay,
  onUpdateTextClip,
  toolsInstallNonce = 0,
}) {
  const frameRef = useRef(null);
  const stageRef = useRef(null);
  const visualLayerRef = useRef(null);
  const mediaPoolRef = useRef(new Map());
  const rafRef = useRef(0);
  const lastGapTickRef = useRef(0);
  const primaryClockIdRef = useRef("");
  const selfClockWriteRef = useRef(false);
  const projectRef = useRef(project);
  const durationRef = useRef(0);
  const playingRef = useRef(playing);
  const playheadMsRef = useRef(playheadMs);
  playheadMsRef.current = playheadMs;
  const renderedVisualIdRef = useRef("");
  const renderedVisualIsImageRef = useRef(false);
  const gainEvaluatorCacheRef = useRef(new Map());
  const propEvaluatorCacheRef = useRef(new Map());
  const textOverlayRefs = useRef(new Map());
  const fontScaleRef = useRef(0);
  const transportScrubRef = useRef(null);
  const transportTimeRef = useRef(null);
  const [draggingTextId, setDraggingTextId] = useState("");
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [capturingFrame, setCapturingFrame] = useState(false);
  const dipOverlayRef = useRef(null);
  const handlesOverlayRef = useRef(null);
  const frameSizeRef = useRef({ width: 0, height: 0 });
  const selectedClipRef = useRef(null);
  const draftJobIdRef = useRef("");
  const [draftJob, setDraftJob] = useState(null);
  const [draftResult, setDraftResult] = useState(null);
  const [draftError, setDraftError] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  // Whether the retained draft result is currently shown over the live
  // preview — the Live/Draft toggle flips this without discarding the result.
  const [draftView, setDraftView] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  // Bumped every time the visual layer node (re)mounts. The media-sync effect
  // depends on it: without this, an attach refused because the layer didn't
  // exist yet (stage still measuring 0 on project open) or because the layer
  // was re-keyed to a new clip is never retried — a stuck black preview.
  const [visualLayerNonce, setVisualLayerNonce] = useState(0);
  const setVisualLayerNode = useCallback((element) => {
    visualLayerRef.current = element;
    if (element) {
      setVisualLayerNonce((nonce) => nonce + 1);
    }
  }, []);

  const durationMs = useMemo(() => projectDurationMs(project), [project]);
  const active = useMemo(() => clipsAtMs(project, playheadMs), [playheadMs, project]);
  const visual = topVisual(active);
  const visualIsImage = visual ? isImageAsset(visual.clip.assetPath) : false;
  renderedVisualIdRef.current = visual?.clip.id || "";
  renderedVisualIsImageRef.current = visualIsImage;
  projectRef.current = project;
  durationRef.current = durationMs;
  playingRef.current = playing;
  selectedClipRef.current = selectedClip;

  useEffect(() => {
    if (isFfmpegInstallError(draftError)) {
      onFfmpegInstallRequired?.();
    }
  }, [draftError, onFfmpegInstallRequired]);

  useEffect(() => {
    if (toolsInstallNonce > 0) {
      setDraftError((current) => (isFfmpegInstallError(current) ? "" : current));
    }
  }, [toolsInstallNonce]);

  const settings = project?.settings || { width: 1920, height: 1080, background: "#000000" };
  const aspect = settings.width / Math.max(1, settings.height);

  // One stage badge (not per clip) when any timeline clip carries fx the CSS
  // preview cannot approximate (curves/lut/chromaKey/grain).
  const fxNeedsDraftBadge = useMemo(() => {
    for (const track of project?.tracks || []) {
      if (track.kind === "text") {
        continue;
      }
      for (const clip of track.clips || []) {
        if (fxHasNonPreviewable(clip.fx)) {
          return true;
        }
      }
    }
    return false;
  }, [project]);

  const hasDipTransitions = useMemo(() => {
    for (const track of project?.tracks || []) {
      for (const transition of track.transitions || []) {
        if (transition.kind === "dip-black" || transition.kind === "dip-white") {
          return true;
        }
      }
    }
    return false;
  }, [project]);

  // Meme-editor essential: grab a title on the preview and put it where it
  // belongs. Fractions are relative to the project frame.
  const beginTextDrag = useCallback(
    (event, clip) => {
      if (event.button !== 0 || !onUpdateTextClip) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setDraggingTextId(clip.id);
      const moveTo = (moveEvent) => {
        const rect = frameRef.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          return;
        }
        const x = Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width));
        const y = Math.min(1, Math.max(0, (moveEvent.clientY - rect.top) / rect.height));
        onUpdateTextClip(clip.id, { style: { x, y } }, { transient: true });
      };
      const finish = (endEvent) => {
        window.removeEventListener("pointermove", moveTo);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        setDraggingTextId("");
        const rect = frameRef.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0 && endEvent?.clientX != null) {
          const x = Math.min(1, Math.max(0, (endEvent.clientX - rect.left) / rect.width));
          const y = Math.min(1, Math.max(0, (endEvent.clientY - rect.top) / rect.height));
          onUpdateTextClip(clip.id, { style: { x, y } }, { transient: false });
        }
      };
      window.addEventListener("pointermove", moveTo);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [onUpdateTextClip],
  );

  // Fit the project frame into the stage.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") {
      return undefined;
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) {
        setStageSize({ width: rect.width, height: rect.height });
      }
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const frameSize = useMemo(() => {
    const maxWidth = Math.max(0, stageSize.width - 8);
    const maxHeight = Math.max(0, stageSize.height - 8);
    if (!maxWidth || !maxHeight) {
      return { width: 0, height: 0 };
    }
    const width = Math.min(maxWidth, maxHeight * aspect);
    return { width, height: width / aspect };
  }, [aspect, stageSize]);

  // previewScale (== fontScale): renderedStageWidth / project width. Blur and
  // any other pixel-sized fx approximations scale by it so they track zoom.
  const fontScale = frameSize.width > 0 ? frameSize.width / Math.max(1, settings.width) : 0;
  fontScaleRef.current = fontScale;
  frameSizeRef.current = frameSize;

  const assetSrc = useCallback(
    (assetPath) => {
      if (!assetPath || !mediaRootAbs) {
        return "";
      }
      const tail = assetPath.startsWith("media/") ? assetPath.slice("media/".length) : assetPath;
      const abs = `${mediaRootAbs.replace(/[\\/]+$/, "")}/${tail}`;
      try {
        return convertFileSrc(abs);
      } catch {
        return "";
      }
    },
    [mediaRootAbs],
  );

  const getGainEvaluator = useCallback((clip) => {
    const cached = gainEvaluatorCacheRef.current.get(clip.id);
    if (cached?.gainRef === clip.gain) {
      return cached.evaluate;
    }
    const evaluate = prepareGainEvaluator(clip.gain);
    gainEvaluatorCacheRef.current.set(clip.id, { gainRef: clip.gain, evaluate });
    return evaluate;
  }, []);

  const getPropEvaluator = useCallback((clip, prop) => {
    const key = `${clip.id}:${prop}`;
    const kfRef = clip.kf?.[prop] || null;
    const cached = propEvaluatorCacheRef.current.get(key);
    if (cached?.kfRef === kfRef && cached?.transformRef === clip.transform) {
      return cached.evaluate;
    }
    const evaluate = preparePropEvaluator(clip, prop);
    propEvaluatorCacheRef.current.set(key, { kfRef, transformRef: clip.transform, evaluate });
    return evaluate;
  }, []);

  const detachEntry = useCallback((entry) => {
    if (!entry?.element) {
      return;
    }
    entry.visible = false;
    entry.element.style.display = "none";
    if (entry.element.parentElement !== document.body) {
      document.body.appendChild(entry.element);
    }
  }, []);

  const removeEntry = useCallback(
    (entry) => {
      if (!entry?.element) {
        return;
      }
      try {
        entry.element.pause();
      } catch {
        /* best-effort cleanup */
      }
      entry.element.remove();
      mediaPoolRef.current.delete(entry.clipId);
    },
    [],
  );

  const ensureEntry = useCallback(
    (track, clip) => {
      const tag = track.kind === "audio" ? "audio" : "video";
      let entry = mediaPoolRef.current.get(clip.id);
      if (entry && entry.tag !== tag) {
        removeEntry(entry);
        entry = null;
      }
      if (!entry) {
        const element = document.createElement(tag);
        element.preload = "auto";
        element.style.display = "none";
        element.muted = true;
        if (tag === "video") {
          element.playsInline = true;
        }
        document.body.appendChild(element);
        entry = {
          clip,
          clipId: clip.id,
          element,
          lastCorrectionAtMs: 0,
          lastVolume: -1,
          pendingSeekMs: -1,
          preloadKey: "",
          src: "",
          tag,
          track,
          visible: false,
        };
        mediaPoolRef.current.set(clip.id, entry);
      }
      entry.clip = clip;
      entry.track = track;
      entry.element.preload = "auto";
      entry.element.playbackRate = clip.speed || 1;
      const src = assetSrc(clip.assetPath);
      if (entry.src !== src && src) {
        // Never assign an empty src (mediaRoot still resolving on project
        // open) — it wedges the element until the next src swap.
        entry.src = src;
        entry.preloadKey = "";
        entry.pendingSeekMs = -1;
        entry.element.src = src;
      }
      return entry;
    },
    [assetSrc, removeEntry],
  );

  const attachVisualEntry = useCallback(
    (entry) => {
      const host = visualLayerRef.current;
      if (
        !host
        || !entry?.element
        || renderedVisualIsImageRef.current
        || renderedVisualIdRef.current !== entry.clip.id
      ) {
        return false;
      }
      for (const other of mediaPoolRef.current.values()) {
        if (other !== entry && other.element?.parentElement === host) {
          detachEntry(other);
        }
      }
      if (entry.element.parentElement !== host) {
        host.appendChild(entry.element);
      }
      entry.element.style.display = "";
      entry.visible = true;
      return true;
    },
    [detachEntry],
  );

  const seekEntryToTimeline = useCallback((entry, timelineMs) => {
    const sourceMs = Math.max(0, mediaSourceMs(entry.clip, timelineMs));
    try {
      // Redundant re-syncs (effect restarts, repeated seekActive calls) must
      // be no-ops: assigning currentTime — even to ~the same value — makes
      // some decoders hiccup audibly. Exception: an element that has loaded
      // nothing yet (fresh src) needs one assignment regardless — the seek is
      // what makes a paused element decode and paint its first frame — but
      // repeats of the SAME pre-metadata seek are deduped via pendingSeekMs.
      if (entry.element.readyState === 0) {
        if (entry.pendingSeekMs === sourceMs) {
          return;
        }
        entry.pendingSeekMs = sourceMs;
      } else if (Math.abs(entry.element.currentTime * 1000 - sourceMs) < 60) {
        return;
      }
      entry.element.currentTime = sourceMs / 1000;
    } catch {
      /* media metadata may not be seekable yet */
    }
  }, []);

  const preloadEntry = useCallback((entry) => {
    const sourceMs = Math.max(0, entry.clip.sourceInMs || 0);
    const key = `${entry.clip.id}:${entry.src}:${sourceMs}`;
    if (entry.preloadKey === key) {
      return;
    }
    entry.preloadKey = key;
    try {
      entry.element.currentTime = sourceMs / 1000;
      entry.element.load?.();
    } catch {
      /* best-effort preload */
    }
  }, []);

  const setEntryVolume = useCallback(
    (entry, volumeClip, timelineMs) => {
      const clipRelMs = Math.max(0, timelineMs - volumeClip.timelineStartMs);
      const level = volumeLevel(getGainEvaluator(volumeClip)(clipRelMs));
      if (Math.abs(level - entry.lastVolume) > 0.01) {
        entry.element.volume = level;
        entry.lastVolume = level;
      }
    },
    [getGainEvaluator],
  );

  const audioIsActivelyPlaying = useCallback(() => {
    for (const entry of mediaPoolRef.current.values()) {
      const element = entry?.element;
      if (
        element
        && !element.paused
        && !element.ended
        && !element.muted
        && Number(element.volume || 0) > 0.001
      ) {
        return true;
      }
    }
    return false;
  }, []);

  const syncMediaForTime = useCallback(
    (timelineMs, { now = performance.now(), playing: shouldPlay = playingRef.current, seekActive = false } = {}) => {
      const currentProject = projectRef.current;
      const activeNow = clipsAtMs(currentProject, timelineMs);
      const visualNow = topVisual(activeNow);
      const visualMediaId = visualNow && !isImageAsset(visualNow.clip.assetPath) ? visualNow.clip.id : "";
      const skippedAudioIds = new Set();
      const videoVolumeDrivers = new Map();
      for (const { clip } of activeNow.video) {
        const partner = linkedAudioPartner(activeNow, clip);
        if (partner) {
          skippedAudioIds.add(partner.id);
          videoVolumeDrivers.set(clip.id, partner);
        }
      }

      const activeItems = [];
      for (const entry of activeNow.video) {
        if (!entry.clip.assetPath || isImageAsset(entry.clip.assetPath)) {
          continue;
        }
        activeItems.push({
          ...entry,
          visible: entry.clip.id === visualMediaId,
          volumeClip: videoVolumeDrivers.get(entry.clip.id) || entry.clip,
        });
      }
      for (const entry of activeNow.audio) {
        if (!entry.clip.assetPath || skippedAudioIds.has(entry.clip.id)) {
          continue;
        }
        activeItems.push({ ...entry, visible: false, volumeClip: entry.clip });
      }

      const wantedIds = new Set();
      const activeEntries = [];
      let visibleEntry = null;
      for (const item of activeItems) {
        wantedIds.add(item.clip.id);
        const entry = ensureEntry(item.track, item.clip);
        if (item.visible) {
          visibleEntry = entry;
        }
        if (seekActive) {
          seekEntryToTimeline(entry, timelineMs);
        }
        activeEntries.push({ entry, item });
      }
      // Attach first, detach second: if the successor can't attach yet (the
      // layer node re-keys on the next UI sync), keep whatever is currently
      // on screen — a hidden gap here is the "preview flashes black" bug.
      const visualAttached = visibleEntry ? attachVisualEntry(visibleEntry) : false;
      const visualHost = visualLayerRef.current;
      const keepCurrentOccupant = (entry) =>
        !visualAttached && visualHost && entry.element?.parentElement === visualHost;
      for (const { entry, item } of activeEntries) {
        if (!item.visible && !keepCurrentOccupant(entry)) {
          detachEntry(entry);
        }
      }

      const primary =
        activeEntries.find(({ entry }) => entry.clip.id === visualMediaId)?.entry
        || (!visualMediaId ? activeEntries.find(({ item }) => item.track.kind === "audio")?.entry || null : null);

      for (const { entry, item } of activeEntries) {
        const isPrimary = entry === primary;
        if (!seekActive && !isPrimary && shouldPlay) {
          const drift = Math.abs(entry.element.currentTime * 1000 - mediaSourceMs(entry.clip, timelineMs));
          if (drift > SECONDARY_DRIFT_MS && now - entry.lastCorrectionAtMs > SECONDARY_DRIFT_INTERVAL_MS) {
            seekEntryToTimeline(entry, timelineMs);
            entry.lastCorrectionAtMs = now;
          }
        }
        entry.element.muted = false;
        entry.element.playbackRate = entry.clip.speed || 1;
        setEntryVolume(entry, item.volumeClip, timelineMs);
        // Calling play() on an ended HTMLMediaElement implicitly restarts it
        // at zero. The playback clock reads currentTime immediately after
        // this sync, so that restart used to teleport the whole timeline to
        // the clip's beginning instead of reaching its end.
        if (shouldPlay && entry.element.paused && !mediaElementAtEnd(entry.element)) {
          entry.element.play().catch(() => {});
        }
        if (!shouldPlay && !entry.element.paused) {
          entry.element.pause();
        }
      }

      for (const track of currentProject?.tracks || []) {
        if (track.muted || track.kind === "text") {
          continue;
        }
        for (const clip of track.clips || []) {
          if (
            !clip.assetPath
            || isImageAsset(clip.assetPath)
            || clip.timelineStartMs <= timelineMs
            || clip.timelineStartMs > timelineMs + PRELOAD_AHEAD_MS
            || (track.kind === "audio" && hasLinkedVideoTwin(currentProject, clip))
          ) {
            continue;
          }
          wantedIds.add(clip.id);
          const entry = ensureEntry(track, clip);
          detachEntry(entry);
          entry.element.muted = true;
          if (!entry.element.paused) {
            entry.element.pause();
          }
          preloadEntry(entry);
        }
      }

      for (const [clipId, entry] of mediaPoolRef.current.entries()) {
        if (wantedIds.has(clipId)) {
          continue;
        }
        const endedRecently = clipEndMs(entry.clip) <= timelineMs && clipEndMs(entry.clip) >= timelineMs - EVICT_BEHIND_MS;
        if (endedRecently) {
          if (!keepCurrentOccupant(entry)) {
            detachEntry(entry);
          }
          if (!entry.element.paused) {
            entry.element.pause();
          }
          continue;
        }
        if (keepCurrentOccupant(entry)) {
          // Far-seek with the successor not attachable yet: hold the last
          // frame one more sync instead of blanking; it's removed next pass.
          // Visual fallback only — it must not keep sounding.
          entry.element.muted = true;
          if (!entry.element.paused) {
            entry.element.pause();
          }
          continue;
        }
        removeEntry(entry);
      }

      return { active: activeNow, nextBoundaryMs: nextClipBoundaryMs(currentProject, timelineMs), primary };
    },
    [
      attachVisualEntry,
      detachEntry,
      ensureEntry,
      preloadEntry,
      removeEntry,
      seekEntryToTimeline,
      setEntryVolume,
    ],
  );

  const updateTransportDom = useCallback((ms) => {
    const duration = durationRef.current;
    const max = Math.max(1000, duration);
    if (transportScrubRef.current) {
      transportScrubRef.current.max = String(max);
      transportScrubRef.current.value = String(Math.min(Math.max(0, ms), max));
    }
    if (transportTimeRef.current) {
      transportTimeRef.current.textContent = `${formatTimecode(ms)} / ${formatTimecode(duration)}`;
    }
  }, []);

  const applyPreviewStyles = useCallback(
    (timelineMs) => {
      const activeNow = clipsAtMs(projectRef.current, timelineMs);
      const visualNow = topVisual(activeNow);
      if (visualNow?.clip.id === renderedVisualIdRef.current && visualLayerRef.current) {
        const clipRelMs = Math.max(0, timelineMs - visualNow.clip.timelineStartMs);
        const opacity = getPropEvaluator(visualNow.clip, "opacity")(clipRelMs);
        const x = getPropEvaluator(visualNow.clip, "x")(clipRelMs);
        const y = getPropEvaluator(visualNow.clip, "y")(clipRelMs);
        const scale = getPropEvaluator(visualNow.clip, "scale")(clipRelMs);
        // Transitions multiply on top of the clip's own keyframed opacity.
        const transitionMult = transitionOpacityMultiplier(visualNow.track, visualNow.clip, timelineMs);
        visualLayerRef.current.style.opacity = String(opacity * transitionMult);
        visualLayerRef.current.style.transform = `translate(${x * 100}%, ${y * 100}%) scale(${scale})`;
        // FX/crop on the pooled <video> element (attached imperatively, so it
        // can't get these from JSX). Images get theirs from JSX props.
        const mediaNode = visualLayerRef.current.querySelector("video");
        if (mediaNode) {
          const filterValue = fxFilterString(visualNow.clip.fx, fontScaleRef.current);
          if (mediaNode.style.filter !== filterValue) {
            mediaNode.style.filter = filterValue;
          }
          const clipPathValue = cropClipPath(visualNow.clip.crop);
          if (mediaNode.style.clipPath !== clipPathValue) {
            mediaNode.style.clipPath = clipPathValue;
          }
        }
        // Keep the selection handles glued to the rendered bounds while the
        // transform is keyframed / the playhead moves.
        const selClip = selectedClipRef.current;
        const handlesNode = handlesOverlayRef.current;
        const frame = frameSizeRef.current;
        if (handlesNode && selClip && visualNow.clip.id === selClip.id && frame.width > 0) {
          const width = frame.width * scale;
          const height = frame.height * scale;
          handlesNode.style.left = `${frame.width * (0.5 + x) - width / 2}px`;
          handlesNode.style.top = `${frame.height * (0.5 + y) - height / 2}px`;
          handlesNode.style.width = `${width}px`;
          handlesNode.style.height = `${height}px`;
        }
      }
      if (dipOverlayRef.current) {
        const dip = dipOverlayAt(projectRef.current, timelineMs);
        dipOverlayRef.current.style.backgroundColor = dip ? dip.color : "transparent";
        dipOverlayRef.current.style.opacity = dip ? dip.alpha.toFixed(4) : "0";
      }
      for (const { clip } of activeNow.text) {
        const node = textOverlayRefs.current.get(clip.id);
        if (!node) {
          continue;
        }
        const currentFontScale = fontScaleRef.current;
        const outlineWidth = (clip.style?.outlineWidth || 0) * currentFontScale;
        node.style.left = `${(clip.style?.x ?? 0.5) * 100}%`;
        node.style.top = `${(clip.style?.y ?? 0.85) * 100}%`;
        node.style.fontSize = `${Math.max(6, (clip.style?.fontSize || 48) * currentFontScale)}px`;
        node.style.webkitTextStroke = outlineWidth > 0 ? `${outlineWidth}px ${clip.style?.outlineColor || "#000000"}` : "";
        node.style.paintOrder = outlineWidth > 0 ? "stroke fill" : "";
        // Caption animations (contract §4): everything derives from the
        // clip-relative time so seeking is deterministic.
        const anim = effectiveTextAnim(clip);
        const clipRelTextMs = Math.max(0, timelineMs - clip.timelineStartMs);
        const entrance = textEntranceState(anim, clipRelTextMs);
        node.style.opacity = String(entrance.opacity);
        if (anim === "pop") {
          node.style.transform = `translate(-50%, -50%) scale(${entrance.scale.toFixed(4)})`;
        }
        if (isWordAnim(anim) && Array.isArray(clip.words)) {
          const highlightColor = clip.animOpts?.highlightColor || DEFAULT_HIGHLIGHT_COLOR;
          for (const span of node.querySelectorAll("[data-word-index]")) {
            const word = clip.words[Number(span.dataset.wordIndex)];
            if (!word) {
              continue;
            }
            const wordState = wordSpanState(anim, word, clipRelTextMs, highlightColor);
            span.style.visibility = wordState.visibility;
            span.style.opacity = String(wordState.opacity);
            span.style.color = wordState.color;
          }
        }
      }
    },
    [getPropEvaluator],
  );

  useEffect(() => {
    const currentMs = playback?.getMs?.() ?? playheadMs;
    updateTransportDom(currentMs);
    applyPreviewStyles(currentMs);
    if (!playback?.subscribe) {
      return undefined;
    }
    return playback.subscribe((ms, isPlaying) => {
      updateTransportDom(ms);
      applyPreviewStyles(ms);
      if (selfClockWriteRef.current) {
        return;
      }
      syncMediaForTime(ms, { now: performance.now(), playing: isPlaying, seekActive: true });
    });
  }, [applyPreviewStyles, playback, playheadMs, syncMediaForTime, updateTransportDom]);

  useEffect(() => {
    const currentMs = playback?.getMs?.() ?? playheadMs;
    syncMediaForTime(currentMs, { now: performance.now(), playing, seekActive: !playing });
    applyPreviewStyles(currentMs);
  }, [applyPreviewStyles, playback, playing, playheadMs, syncMediaForTime, visual?.clip.id, visualIsImage, visualLayerNonce]);

  // FX/crop on the pooled <video> element when editing while paused: the
  // per-tick path above only runs on playback/seek, so an inspector fx edit
  // must reach the attached element through this effect (declared after the
  // sync effect so the element is already attached). Empty values clear stale
  // styles left over from pool reuse.
  const visualFx = visual?.clip.fx || null;
  const visualCrop = visual?.clip.crop || null;
  useEffect(() => {
    const host = visualLayerRef.current;
    const mediaNode = host?.querySelector("video");
    if (!mediaNode) {
      return;
    }
    mediaNode.style.filter = fxFilterString(visualFx, fontScaleRef.current);
    mediaNode.style.clipPath = cropClipPath(visualCrop);
  }, [fontScale, visualCrop, visualFx, visualIsImage, visualLayerNonce, visual?.clip.id]);

  // Playback clock: use the active media element as master. The rAF loop never
  // drift-seeks that primary element; seeks happen on explicit seek, play
  // start, secondary correction, preload, or clip-boundary handoff.
  useEffect(() => {
    window.cancelAnimationFrame(rafRef.current);
    lastGapTickRef.current = 0;
    if (!playing) {
      return undefined;
    }
    let disposed = false;
    let renderable = getRenderabilitySnapshot().renderable;

    const writeClockMs = (nextMs) => {
      if (playback?.setMs) {
        selfClockWriteRef.current = true;
        playback.setMs(nextMs);
        selfClockWriteRef.current = false;
      } else {
        updateTransportDom(nextMs);
        applyPreviewStyles(nextMs);
      }
    };

    const shouldRunClock = () => renderable || audioIsActivelyPlaying();
    const pauseHiddenSilentPlayback = () => {
      const currentMs = playback?.getMs?.() ?? playheadMsRef.current;
      syncMediaForTime(currentMs, { now: performance.now(), playing: false, seekActive: false });
    };
    const stopClock = () => {
      if (rafRef.current) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      lastGapTickRef.current = 0;
    };
    const scheduleClock = () => {
      if (disposed || rafRef.current || !shouldRunClock()) {
        return;
      }
      rafRef.current = window.requestAnimationFrame(tick);
    };

    const startMs = playback?.getMs?.() ?? playheadMsRef.current;
    const startShouldPlay = shouldRunClock();
    const startSync = syncMediaForTime(startMs, { now: performance.now(), playing: startShouldPlay, seekActive: true });
    primaryClockIdRef.current = startSync.primary?.clip.id || "";

    const tick = (now) => {
      rafRef.current = 0;
      if (disposed) {
        return;
      }
      if (!shouldRunClock()) {
        pauseHiddenSilentPlayback();
        return;
      }
      const currentMs = playback?.getMs?.() ?? startMs;
      let sync = syncMediaForTime(currentMs, { now, playing: true, seekActive: false });
      const primaryId = sync.primary?.clip.id || "";
      if (primaryId && primaryId !== primaryClockIdRef.current) {
        sync = syncMediaForTime(currentMs, { now, playing: true, seekActive: true });
      }
      primaryClockIdRef.current = sync.primary?.clip.id || "";
      let nextMs = currentMs;
      if (sync.primary?.element) {
        nextMs = mediaElementAtEnd(sync.primary.element)
          ? clipEndMs(sync.primary.clip)
          : Math.max(0, Math.min(clipEndMs(sync.primary.clip), timelineMsFromMedia(sync.primary.clip, sync.primary.element)));
        lastGapTickRef.current = 0;
        if (nextMs >= clipEndMs(sync.primary.clip) - 4) {
          nextMs = clipEndMs(sync.primary.clip);
          const nextSync = syncMediaForTime(nextMs, { now, playing: true, seekActive: true });
          primaryClockIdRef.current = nextSync.primary?.clip.id || "";
        }
      } else {
        if (!lastGapTickRef.current) {
          lastGapTickRef.current = now;
        }
        const deltaMs = now - lastGapTickRef.current;
        lastGapTickRef.current = now;
        nextMs = currentMs + deltaMs;
        if (sync.nextBoundaryMs != null && nextMs >= sync.nextBoundaryMs) {
          nextMs = sync.nextBoundaryMs;
          lastGapTickRef.current = 0;
          const nextSync = syncMediaForTime(nextMs, { now, playing: true, seekActive: true });
          primaryClockIdRef.current = nextSync.primary?.clip.id || "";
        }
      }

      if (durationRef.current > 0 && nextMs >= durationRef.current) {
        writeClockMs(durationRef.current);
        onTogglePlay?.(false);
        return;
      }

      writeClockMs(nextMs);
      scheduleClock();
    };

    const unsubscribeRenderability = subscribeToRenderability((nextSnapshot) => {
      renderable = nextSnapshot.renderable;
      if (shouldRunClock()) {
        scheduleClock();
      } else {
        stopClock();
        pauseHiddenSilentPlayback();
      }
    });
    if (shouldRunClock()) {
      scheduleClock();
    } else {
      pauseHiddenSilentPlayback();
    }
    return () => {
      disposed = true;
      unsubscribeRenderability();
      stopClock();
    };
    // playheadMs deliberately read via ref: the 200ms UI-cadence prop must
    // not restart the playback loop (each restart re-seeks the primary).
  }, [applyPreviewStyles, audioIsActivelyPlaying, onTogglePlay, playback, playing, syncMediaForTime, updateTransportDom]);

  // Tear the pool down on unmount.
  useEffect(
    () => () => {
      window.cancelAnimationFrame(rafRef.current);
      for (const entry of mediaPoolRef.current.values()) {
        try {
          entry.element.pause();
        } catch {
          /* best-effort cleanup */
        }
        entry.element.remove();
      }
      mediaPoolRef.current.clear();
    },
    [],
  );

  // Freeze the current frame into media/assets — an instant AI start frame.
  const captureFrame = useCallback(() => {
    if (!repoPath || capturingFrame) {
      return;
    }
    const currentMs = playback?.getMs?.() ?? playheadMs;
    const activeNow = clipsAtMs(projectRef.current, currentMs);
    const captureVisual = topVisual(activeNow);
    if (!captureVisual || isImageAsset(captureVisual.clip.assetPath)) {
      return;
    }
    const clipRelMs = currentMs - captureVisual.clip.timelineStartMs;
    const sourceMs = Math.max(0, Math.round((captureVisual.clip.sourceInMs || 0) + clipRelMs * (captureVisual.clip.speed || 1)));
    setCapturingFrame(true);
    invoke("video_frame_extract", { repoPath, assetPath: captureVisual.clip.assetPath, atMs: sourceMs })
      .catch(() => {})
      .finally(() => setCapturingFrame(false));
  }, [capturingFrame, playback, playheadMs, repoPath]);

  const handleSeek = useCallback(
    (ms) => {
      const next = Math.max(0, Number(ms) || 0);
      playback?.setMs?.(next);
      onSeek?.(next);
    },
    [onSeek, playback],
  );

  // --- Draft render (contract §6) --------------------------------------------
  const draftRunning = Boolean(draftJob && !draftJob.done);

  const startDraftRender = useCallback(async () => {
    if (!repoPath || !projectRelPath || draftRunning) {
      return;
    }
    const hasRange =
      selectedRange
      && Number.isFinite(Number(selectedRange.startMs))
      && Number.isFinite(Number(selectedRange.endMs))
      && Number(selectedRange.endMs) > Number(selectedRange.startMs);
    const startMs = hasRange ? Math.max(0, Math.round(Number(selectedRange.startMs))) : 0;
    const endMs = hasRange ? Math.round(Number(selectedRange.endMs)) : Math.round(durationRef.current);
    if (endMs <= startMs) {
      setDraftError("The timeline is empty — add clips before draft rendering.");
      return;
    }
    setDraftError("");
    setDraftResult(null);
    setDraftView(false);
    setDraftNotice(endMs - startMs > 120000 ? "Draft range exceeds 120s — expect a slower render." : "");
    try {
      // The draft renders the SAVED .pipe file — flush the pane's debounced
      // autosave so edits from the last second are included.
      await onFlushProjectSave?.();
      const result = await invoke("video_draft_render", { repoPath, projectRelPath, startMs, endMs, height: 480 });
      const jobId = String(result?.jobId || "");
      draftJobIdRef.current = jobId;
      if (jobId) {
        setDraftJob({ jobId, percent: 0, done: false });
      } else {
        setDraftNotice("");
        setDraftError("Draft render did not return a job id.");
      }
    } catch (err) {
      setDraftNotice("");
      setDraftError(String(err));
    }
  }, [draftRunning, onFlushProjectSave, projectRelPath, repoPath, selectedRange]);

  // Same cancel command/convention as ExportPanel — draft renders ride the
  // shared export job registry.
  const cancelDraftRender = useCallback(() => {
    if (draftJob?.jobId && !draftJob.done) {
      invoke("video_export_cancel", { jobId: draftJob.jobId }).catch(() => {});
    }
  }, [draftJob]);

  // Switching projects invalidates the retained draft result and any live job.
  useEffect(() => {
    draftJobIdRef.current = "";
    setDraftJob(null);
    setDraftResult(null);
    setDraftError("");
    setDraftNotice("");
    setDraftView(false);
  }, [projectRelPath]);

  // Progress/completion rides the existing export progress event stream, keyed
  // by our own jobId (same convention as ExportPanel — never adopt other
  // jobs). Mounted for the component lifetime, like ExportPanel's listener,
  // so a fast job can't complete before registration.
  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};
    listen(VIDEO_EXPORT_PROGRESS_EVENT, (event) => {
      const payload = event?.payload;
      if (disposed || !payload?.jobId || String(payload.jobId) !== draftJobIdRef.current) {
        return;
      }
      setDraftJob({
        jobId: String(payload.jobId),
        percent: Number(payload.percent) || 0,
        done: Boolean(payload.done),
      });
      if (payload.done) {
        setDraftNotice("");
        const path = String(payload.path || payload.outputPath || "");
        if (payload.error) {
          setDraftError(String(payload.error));
        } else if (path) {
          setDraftResult({
            path,
            width: payload.width,
            height: payload.height,
            durationMs: payload.durationMs,
          });
          setDraftView(true);
        } else {
          setDraftError("Draft render finished without an output path.");
        }
      }
    })
      .then((next) => {
        if (disposed) {
          next();
        } else {
          unlisten = next;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);

  const draftSrc = useMemo(() => {
    if (!draftResult?.path) {
      return "";
    }
    const path = String(draftResult.path);
    const isAbsolute = path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
    if (isAbsolute) {
      try {
        return convertFileSrc(path);
      } catch {
        return "";
      }
    }
    return assetSrc(path);
  }, [assetSrc, draftResult]);

  // Pause the live preview whenever the draft overlay opens so its <video>
  // and the timeline's media pool never play audio simultaneously.
  const draftOverlayVisible = Boolean(draftResult && draftSrc && draftView);
  const onTogglePlayRef = useRef(onTogglePlay);
  onTogglePlayRef.current = onTogglePlay;
  useEffect(() => {
    if (draftOverlayVisible) {
      onTogglePlayRef.current?.(false);
    }
  }, [draftOverlayVisible]);

  // --- Transform/crop handles for the selected media clip ---------------------
  useEffect(() => {
    setCropMode(false);
  }, [selectedClip?.id]);

  const beginHandleDrag = useCallback(
    (event, mode) => {
      // mode: "move" | "corner" | "crop-l" | "crop-t" | "crop-r" | "crop-b"
      const clip = selectedClipRef.current;
      if (event.button !== 0 || !onClipTransformChange || !clip) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const frameRect = frameRef.current?.getBoundingClientRect();
      if (!frameRect || frameRect.width <= 0 || frameRect.height <= 0) {
        return;
      }
      const relMs = Math.max(0, (playback?.getMs?.() ?? playheadMsRef.current) - clip.timelineStartMs);
      const baseX = getPropEvaluator(clip, "x")(relMs);
      const baseY = getPropEvaluator(clip, "y")(relMs);
      const baseScale = getPropEvaluator(clip, "scale")(relMs);
      const baseCrop = { l: 0, t: 0, r: 0, b: 0, ...(clip.crop || {}) };
      // transform.x/y are frame fractions (translate(x*100%, y*100%) of the
      // full-frame layer), scale is about the frame center — same mapping as
      // the layer render math above.
      const centerX = frameRect.left + frameRect.width * (0.5 + baseX);
      const centerY = frameRect.top + frameRect.height * (0.5 + baseY);
      const startClientX = event.clientX;
      const startClientY = event.clientY;
      const startDist = Math.max(8, Math.hypot(startClientX - centerX, startClientY - centerY));
      const renderedW = Math.max(1, frameRect.width * baseScale);
      const renderedH = Math.max(1, frameRect.height * baseScale);
      const round4 = (value) => Number(value.toFixed(4));
      const clampCrop = (value) => Math.min(0.45, Math.max(0, value));
      const emit = (clientX, clientY, transient) => {
        if (mode === "move") {
          onClipTransformChange(
            clip.id,
            {
              transform: {
                x: round4(baseX + (clientX - startClientX) / frameRect.width),
                y: round4(baseY + (clientY - startClientY) / frameRect.height),
              },
            },
            { transient },
          );
        } else if (mode === "corner") {
          // Uniform scale anchored at center: distance ratio from the center.
          const dist = Math.hypot(clientX - centerX, clientY - centerY);
          const nextScale = Math.min(8, Math.max(0.05, baseScale * (dist / startDist)));
          onClipTransformChange(clip.id, { transform: { scale: round4(nextScale) } }, { transient });
        } else {
          // Crop edges: pointer deltas in fractions of the rendered clip size.
          const next = { ...baseCrop };
          if (mode === "crop-l") {
            next.l = clampCrop(baseCrop.l + (clientX - startClientX) / renderedW);
          } else if (mode === "crop-r") {
            next.r = clampCrop(baseCrop.r - (clientX - startClientX) / renderedW);
          } else if (mode === "crop-t") {
            next.t = clampCrop(baseCrop.t + (clientY - startClientY) / renderedH);
          } else if (mode === "crop-b") {
            next.b = clampCrop(baseCrop.b - (clientY - startClientY) / renderedH);
          }
          next.l = round4(next.l);
          next.t = round4(next.t);
          next.r = round4(next.r);
          next.b = round4(next.b);
          onClipTransformChange(clip.id, { crop: next }, { transient });
        }
      };
      const moveTo = (moveEvent) => emit(moveEvent.clientX, moveEvent.clientY, true);
      const finish = (endEvent) => {
        window.removeEventListener("pointermove", moveTo);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        if (endEvent?.clientX != null) {
          emit(endEvent.clientX, endEvent.clientY, false);
        }
      };
      window.addEventListener("pointermove", moveTo);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    },
    [getPropEvaluator, onClipTransformChange, playback],
  );

  const visualLayerStyle = visual
    ? (() => {
        const clipRelMs = Math.max(0, playheadMs - visual.clip.timelineStartMs);
        const opacity = getPropEvaluator(visual.clip, "opacity")(clipRelMs);
        const x = getPropEvaluator(visual.clip, "x")(clipRelMs);
        const y = getPropEvaluator(visual.clip, "y")(clipRelMs);
        const scale = getPropEvaluator(visual.clip, "scale")(clipRelMs);
        // Same composition as applyPreviewStyles: transition multiplier on top
        // of the clip's own opacity; fx.blend as mix-blend-mode.
        const transitionMult = transitionOpacityMultiplier(visual.track, visual.clip, playheadMs);
        const blendMode = cssBlendMode(visual.clip.fx?.blend);
        return {
          opacity: opacity * transitionMult,
          transform: `translate(${x * 100}%, ${y * 100}%) scale(${scale})`,
          mixBlendMode: blendMode || undefined,
        };
      })()
    : undefined;

  // Rendered bounds of the selected clip (stage px) for the handles overlay.
  const showHandles = Boolean(
    selectedClip
    && onClipTransformChange
    && visual
    && visual.clip.id === selectedClip.id
    && frameSize.width > 0,
  );
  const handlesRect = showHandles
    ? (() => {
        const clipRelMs = Math.max(0, playheadMs - visual.clip.timelineStartMs);
        const x = getPropEvaluator(visual.clip, "x")(clipRelMs);
        const y = getPropEvaluator(visual.clip, "y")(clipRelMs);
        const scale = getPropEvaluator(visual.clip, "scale")(clipRelMs);
        const width = frameSize.width * scale;
        const height = frameSize.height * scale;
        return {
          left: frameSize.width * (0.5 + x) - width / 2,
          top: frameSize.height * (0.5 + y) - height / 2,
          width,
          height,
        };
      })()
    : null;

  const dipNow = hasDipTransitions ? dipOverlayAt(project, playheadMs) : null;

  const scrubMax = Math.max(1000, durationMs);
  const currentStoreMs = playback?.getMs?.() ?? playheadMs;

  return (
    <PreviewRoot data-video-preview="true">
      <PreviewStage ref={stageRef}>
        {frameSize.width > 0 ? (
          <PreviewFrame
            $background={settings.background}
            ref={frameRef}
            style={{ width: `${frameSize.width}px`, height: `${frameSize.height}px` }}
          >
            {visual ? (
              <PreviewLayer
                key={`${visualIsImage ? "image" : "video"}-${visual.clip.id}`}
                ref={setVisualLayerNode}
                style={visualLayerStyle}
              >
                {visualIsImage ? (
                  <img
                    alt=""
                    draggable={false}
                    src={assetSrc(visual.clip.assetPath)}
                    style={{
                      filter: fxFilterString(visual.clip.fx, fontScale) || undefined,
                      clipPath: cropClipPath(visual.clip.crop) || undefined,
                    }}
                  />
                ) : null}
                {visual.clip.fx?.vignette > 0 ? (
                  <PreviewVignette
                    style={{
                      background: `radial-gradient(transparent 55%, rgba(0, 0, 0, ${(visual.clip.fx.vignette * 0.8).toFixed(3)}))`,
                    }}
                  />
                ) : null}
              </PreviewLayer>
            ) : (
              <PreviewLayer>
                <PreviewEmpty>
                  {durationMs > 0 ? "" : "Drop media on the timeline to start editing."}
                </PreviewEmpty>
              </PreviewLayer>
            )}
            {hasDipTransitions ? (
              <PreviewDipOverlay
                ref={dipOverlayRef}
                style={{
                  backgroundColor: dipNow ? dipNow.color : "transparent",
                  opacity: dipNow ? dipNow.alpha : 0,
                }}
              />
            ) : null}
            {active.text.map(({ clip }) => {
              const outlineWidth = (clip.style?.outlineWidth || 0) * fontScale;
              const textAnim = effectiveTextAnim(clip);
              const clipRelTextMs = Math.max(0, playheadMs - clip.timelineStartMs);
              const entrance = textEntranceState(textAnim, clipRelTextMs);
              const highlightColor = clip.animOpts?.highlightColor || DEFAULT_HIGHLIGHT_COLOR;
              return (
                <PreviewTextOverlay
                  data-dragging={draggingTextId === clip.id ? "true" : "false"}
                  key={clip.id}
                  onPointerDown={(event) => beginTextDrag(event, clip)}
                  ref={(element) => {
                    if (element) {
                      textOverlayRefs.current.set(clip.id, element);
                    } else {
                      textOverlayRefs.current.delete(clip.id);
                    }
                  }}
                  style={{
                    left: `${(clip.style?.x ?? 0.5) * 100}%`,
                    top: `${(clip.style?.y ?? 0.85) * 100}%`,
                    fontSize: `${Math.max(6, (clip.style?.fontSize || 48) * fontScale)}px`,
                    color: clip.style?.color || "#ffffff",
                    background: clip.style?.background || "transparent",
                    textAlign: clip.style?.align || "center",
                    fontWeight: clip.style?.bold === false ? 500 : 800,
                    fontFamily: clip.style?.fontFamily || "sans-serif",
                    padding: clip.style?.background ? "0.15em 0.4em" : 0,
                    borderRadius: clip.style?.background ? "0.2em" : 0,
                    textTransform: clip.style?.uppercase ? "uppercase" : "none",
                    WebkitTextStroke: outlineWidth > 0 ? `${outlineWidth}px ${clip.style?.outlineColor || "#000000"}` : undefined,
                    paintOrder: outlineWidth > 0 ? "stroke fill" : undefined,
                    textShadow: clip.style?.shadow ? "2px 2px 6px rgba(0, 0, 0, 0.75)" : "none",
                    opacity: entrance.opacity,
                    transform: textAnim === "pop" ? `translate(-50%, -50%) scale(${entrance.scale.toFixed(4)})` : undefined,
                  }}
                  title="Drag to position"
                >
                  {isWordAnim(textAnim) ? (
                    clip.words.map((word, index) => {
                      const wordState = wordSpanState(textAnim, word, clipRelTextMs, highlightColor);
                      return (
                        <React.Fragment key={`${clip.id}-w${index}`}>
                          {index ? " " : ""}
                          <span
                            data-word-index={index}
                            style={{
                              visibility: wordState.visibility,
                              opacity: wordState.opacity,
                              color: wordState.color || undefined,
                            }}
                          >
                            {word.text}
                          </span>
                        </React.Fragment>
                      );
                    })
                  ) : (
                    clip.text
                  )}
                </PreviewTextOverlay>
              );
            })}
            {handlesRect ? (
              <TransformHandlesBox
                onPointerDown={(event) => beginHandleDrag(event, "move")}
                ref={handlesOverlayRef}
                style={{
                  left: `${handlesRect.left}px`,
                  top: `${handlesRect.top}px`,
                  width: `${handlesRect.width}px`,
                  height: `${handlesRect.height}px`,
                }}
              >
                <CropToggleChip
                  data-active={cropMode ? "true" : "false"}
                  onClick={(event) => {
                    event.stopPropagation();
                    setCropMode((value) => !value);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  title="Toggle crop-edge handles"
                  type="button"
                >
                  Crop
                </CropToggleChip>
                {cropMode
                  ? [
                      { edge: "crop-l", style: { left: 0, top: "50%", cursor: "ew-resize" } },
                      { edge: "crop-r", style: { left: "100%", top: "50%", cursor: "ew-resize" } },
                      { edge: "crop-t", style: { left: "50%", top: 0, cursor: "ns-resize" } },
                      { edge: "crop-b", style: { left: "50%", top: "100%", cursor: "ns-resize" } },
                    ].map(({ edge, style }) => (
                      <TransformHandleDot
                        key={edge}
                        onPointerDown={(event) => beginHandleDrag(event, edge)}
                        style={style}
                      />
                    ))
                  : [
                      { corner: "nw", style: { left: 0, top: 0, cursor: "nwse-resize" } },
                      { corner: "ne", style: { left: "100%", top: 0, cursor: "nesw-resize" } },
                      { corner: "sw", style: { left: 0, top: "100%", cursor: "nesw-resize" } },
                      { corner: "se", style: { left: "100%", top: "100%", cursor: "nwse-resize" } },
                    ].map(({ corner, style }) => (
                      <TransformHandleDot
                        key={corner}
                        onPointerDown={(event) => beginHandleDrag(event, "corner")}
                        style={style}
                      />
                    ))}
              </TransformHandlesBox>
            ) : null}
          </PreviewFrame>
        ) : null}
        {fxNeedsDraftBadge ? <StageFxBadge>FX approximate — use Draft render</StageFxBadge> : null}
        {draftOverlayVisible ? (
          <DraftOverlay>
            <DraftOverlayBar>
              <DraftLabelChip>Exact draft render</DraftLabelChip>
              <DraftCloseButton
                onClick={() => setDraftView(false)}
                style={{ marginLeft: "auto" }}
                title="Back to the live preview (the draft stays available)"
                type="button"
              >
                Live
              </DraftCloseButton>
              <DraftCloseButton
                onClick={() => {
                  setDraftResult(null);
                  setDraftView(false);
                }}
                style={{ marginLeft: 0 }}
                title="Discard this draft render"
                type="button"
              >
                Close
              </DraftCloseButton>
            </DraftOverlayBar>
            <video controls src={draftSrc} />
          </DraftOverlay>
        ) : null}
      </PreviewStage>
      <TransportRow>
        <VideoIconButton
          data-active={playing ? "true" : "false"}
          onClick={() => onTogglePlay?.(!playing)}
          title={playing ? "Pause" : "Play"}
          type="button"
        >
          {playing ? <Pause aria-hidden="true" /> : <PlayArrow aria-hidden="true" />}
        </VideoIconButton>
        <VideoIconButton onClick={() => handleSeek(0)} title="Jump to start" type="button">
          <SkipPrevious aria-hidden="true" />
        </VideoIconButton>
        <VideoIconButton
          disabled={!visual || visualIsImage || !repoPath || capturingFrame}
          onClick={captureFrame}
          title="Capture this frame into the library (usable as an AI start frame)"
          type="button"
        >
          <PhotoCamera aria-hidden="true" />
        </VideoIconButton>
        <VideoPaneButton
          disabled={!repoPath || !projectRelPath || durationMs <= 0 || draftRunning}
          onClick={startDraftRender}
          title="Render the selected range (or full timeline) through the exact export pipeline at 480p"
          type="button"
        >
          {draftRunning ? `Draft ${Math.round(draftJob?.percent || 0)}%` : "Draft"}
        </VideoPaneButton>
        {draftRunning ? (
          <VideoSecondaryButton onClick={cancelDraftRender} title="Cancel the draft render" type="button">
            Cancel
          </VideoSecondaryButton>
        ) : null}
        {draftResult && !draftView ? (
          <VideoSecondaryButton
            onClick={() => setDraftView(true)}
            title="Show the last draft render over the live preview"
            type="button"
          >
            View draft
          </VideoSecondaryButton>
        ) : null}
        <TransportScrub
          defaultValue={Math.min(currentStoreMs, scrubMax)}
          max={scrubMax}
          min={0}
          onChange={(event) => handleSeek(Number(event.target.value))}
          ref={transportScrubRef}
          step={16}
          type="range"
        />
        <TransportTime ref={transportTimeRef}>
          {formatTimecode(currentStoreMs)} / {formatTimecode(durationMs)}
        </TransportTime>
      </TransportRow>
      {draftError ? <VideoErrorText>{draftError}</VideoErrorText> : null}
      {!draftError && draftNotice ? <VideoHint>{draftNotice}</VideoHint> : null}
    </PreviewRoot>
  );
}

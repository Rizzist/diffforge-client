import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
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
import { VideoIconButton } from "./videoStyles.js";
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
  repoPath = "",
  onSeek,
  onTogglePlay,
  onUpdateTextClip,
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

  const settings = project?.settings || { width: 1920, height: 1080, background: "#000000" };
  const aspect = settings.width / Math.max(1, settings.height);

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

  const fontScale = frameSize.width > 0 ? frameSize.width / Math.max(1, settings.width) : 0;
  fontScaleRef.current = fontScale;

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
        if (shouldPlay && entry.element.paused) {
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
        visualLayerRef.current.style.opacity = String(opacity);
        visualLayerRef.current.style.transform = `translate(${x * 100}%, ${y * 100}%) scale(${scale})`;
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
        nextMs = Math.max(0, Math.min(clipEndMs(sync.primary.clip), timelineMsFromMedia(sync.primary.clip, sync.primary.element)));
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

  const visualLayerStyle = visual
    ? (() => {
        const clipRelMs = Math.max(0, playheadMs - visual.clip.timelineStartMs);
        const opacity = getPropEvaluator(visual.clip, "opacity")(clipRelMs);
        const x = getPropEvaluator(visual.clip, "x")(clipRelMs);
        const y = getPropEvaluator(visual.clip, "y")(clipRelMs);
        const scale = getPropEvaluator(visual.clip, "scale")(clipRelMs);
        return {
          opacity,
          transform: `translate(${x * 100}%, ${y * 100}%) scale(${scale})`,
        };
      })()
    : undefined;

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
                  <img alt="" draggable={false} src={assetSrc(visual.clip.assetPath)} />
                ) : null}
              </PreviewLayer>
            ) : (
              <PreviewLayer>
                <PreviewEmpty>
                  {durationMs > 0 ? "" : "Drop media on the timeline to start editing."}
                </PreviewEmpty>
              </PreviewLayer>
            )}
            {active.text.map(({ clip }) => {
              const outlineWidth = (clip.style?.outlineWidth || 0) * fontScale;
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
                  }}
                  title="Drag to position"
                >
                  {clip.text}
                </PreviewTextOverlay>
              );
            })}
          </PreviewFrame>
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
    </PreviewRoot>
  );
}

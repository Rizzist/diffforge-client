import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Pause } from "@styled-icons/material-rounded/Pause";
import { PhotoCamera } from "@styled-icons/material-rounded/PhotoCamera";
import { PlayArrow } from "@styled-icons/material-rounded/PlayArrow";
import { SkipPrevious } from "@styled-icons/material-rounded/SkipPrevious";
import { clipsAtMs, formatTimecode, gainAtMs, projectDurationMs } from "./videoEditorModel.js";
import { VideoIconButton } from "./videoStyles.js";

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
`;

const TransportScrub = styled.input`
  flex: 1 1 auto;
  min-width: 40px;
  accent-color: #10b981;
`;

// Approximate realtime preview of the timeline: the topmost active video-track
// clip renders visually (with CSS transform/opacity), every active clip with
// audio plays through a pooled media element with live gain applied, and text
// clips render as DOM overlays. Export via ffmpeg is the exact compositor —
// this preview trades layered video compositing for responsiveness.
export default function VideoEditor({
  mediaRootAbs = "",
  playheadMs = 0,
  playing = false,
  project,
  repoPath = "",
  onSeek,
  onTogglePlay,
  onUpdateTextClip,
}) {
  const frameRef = useRef(null);
  const [draggingTextId, setDraggingTextId] = useState("");

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
  const stageRef = useRef(null);
  const mediaPoolRef = useRef(new Map());
  const rafRef = useRef(0);
  const lastTickRef = useRef(0);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });

  const durationMs = useMemo(() => projectDurationMs(project), [project]);
  const active = useMemo(() => clipsAtMs(project, playheadMs), [playheadMs, project]);

  const settings = project?.settings || { width: 1920, height: 1080, background: "#000000" };
  const aspect = settings.width / Math.max(1, settings.height);

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

  const assetSrc = useCallback(
    (assetPath) => {
      if (!assetPath || !mediaRootAbs) {
        return "";
      }
      // assetPath is repo-relative ("media/assets/x.mp4"); mediaRootAbs points
      // at "<repo>/media" — join on the segment after "media/".
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

  // Playback clock: advance the playhead with rAF while playing.
  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(rafRef.current);
      lastTickRef.current = 0;
      return undefined;
    }
    const tick = (now) => {
      if (!lastTickRef.current) {
        lastTickRef.current = now;
      }
      const deltaMs = now - lastTickRef.current;
      lastTickRef.current = now;
      const next = playheadRef.current + deltaMs;
      if (durationMs > 0 && next >= durationMs) {
        onSeek?.(durationMs);
        onTogglePlay?.(false);
        return;
      }
      onSeek?.(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [durationMs, onSeek, onTogglePlay, playing]);

  const playheadRef = useRef(playheadMs);
  playheadRef.current = playheadMs;

  // Audible playback: keep one hidden media element per active audible clip,
  // synced to the clip-relative source position with live gain.
  useEffect(() => {
    const pool = mediaPoolRef.current;
    const audible = [...active.video, ...active.audio].filter(({ track, clip }) => !track.muted && clip.assetPath);
    const wanted = new Set();
    for (const { clip } of audible) {
      wanted.add(clip.id);
      let element = pool.get(clip.id);
      if (!element) {
        element = document.createElement(clip.assetPath && active.audio.some((entry) => entry.clip.id === clip.id) ? "audio" : "video");
        element.muted = false;
        element.preload = "auto";
        element.style.display = "none";
        document.body.appendChild(element);
        pool.set(clip.id, element);
      }
      const src = assetSrc(clip.assetPath);
      if (element.dataset.src !== src) {
        element.dataset.src = src;
        element.src = src;
      }
      const clipRelMs = playheadMs - clip.timelineStartMs;
      const sourceMs = (clip.sourceInMs || 0) + clipRelMs * (clip.speed || 1);
      const drift = Math.abs(element.currentTime * 1000 - sourceMs);
      if (!playing || drift > 220) {
        try {
          element.currentTime = sourceMs / 1000;
        } catch {
          /* seeking before metadata is loaded */
        }
      }
      element.playbackRate = clip.speed || 1;
      element.volume = Math.min(1, Math.max(0, gainAtMs(clip.gain, clipRelMs)));
      if (playing && element.paused) {
        element.play().catch(() => {});
      }
      if (!playing && !element.paused) {
        element.pause();
      }
    }
    for (const [clipId, element] of pool.entries()) {
      if (!wanted.has(clipId)) {
        element.pause();
        element.remove();
        pool.delete(clipId);
      }
    }
  }, [active, assetSrc, playheadMs, playing]);

  // Tear the pool down on unmount.
  useEffect(
    () => () => {
      for (const element of mediaPoolRef.current.values()) {
        element.pause();
        element.remove();
      }
      mediaPoolRef.current.clear();
    },
    [],
  );

  // Visual: topmost active video clip (last video track wins).
  const visual = active.video.length ? active.video[active.video.length - 1] : null;
  const visualIsImage = visual ? /\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(visual.clip.assetPath || "") : false;
  const visualRef = useRef(null);

  // Freeze the current frame into media/assets — an instant AI start frame.
  const [capturingFrame, setCapturingFrame] = useState(false);
  const captureFrame = useCallback(() => {
    if (!visual || visualIsImage || !repoPath || capturingFrame) {
      return;
    }
    const clipRelMs = playheadMs - visual.clip.timelineStartMs;
    const sourceMs = Math.max(0, Math.round((visual.clip.sourceInMs || 0) + clipRelMs * (visual.clip.speed || 1)));
    setCapturingFrame(true);
    invoke("video_frame_extract", { repoPath, assetPath: visual.clip.assetPath, atMs: sourceMs })
      .catch(() => {})
      .finally(() => setCapturingFrame(false));
  }, [capturingFrame, playheadMs, repoPath, visual, visualIsImage]);

  useEffect(() => {
    const element = visualRef.current;
    if (!element || !visual || visualIsImage) {
      return;
    }
    const clipRelMs = playheadMs - visual.clip.timelineStartMs;
    const sourceMs = (visual.clip.sourceInMs || 0) + clipRelMs * (visual.clip.speed || 1);
    const drift = Math.abs(element.currentTime * 1000 - sourceMs);
    if (!playing || drift > 220) {
      try {
        element.currentTime = sourceMs / 1000;
      } catch {
        /* not yet seekable */
      }
    }
    element.playbackRate = visual.clip.speed || 1;
    if (playing && element.paused) {
      element.play().catch(() => {});
    }
    if (!playing && !element.paused) {
      element.pause();
    }
  }, [playheadMs, playing, visual, visualIsImage]);

  const fontScale = frameSize.width > 0 ? frameSize.width / Math.max(1, settings.width) : 0;

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
                style={{
                  opacity: visual.clip.transform?.opacity ?? 1,
                  transform: `translate(${(visual.clip.transform?.x || 0) * 100}%, ${(visual.clip.transform?.y || 0) * 100}%) scale(${visual.clip.transform?.scale ?? 1})`,
                }}
              >
                {visualIsImage ? (
                  <img alt="" draggable={false} src={assetSrc(visual.clip.assetPath)} />
                ) : (
                  <video key={visual.clip.id} muted playsInline ref={visualRef} src={assetSrc(visual.clip.assetPath)} />
                )}
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
        <VideoIconButton onClick={() => onSeek?.(0)} title="Jump to start" type="button">
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
          max={Math.max(1000, durationMs)}
          min={0}
          onChange={(event) => onSeek?.(Number(event.target.value))}
          step={16}
          type="range"
          value={Math.min(playheadMs, Math.max(1000, durationMs))}
        />
        <TransportTime>
          {formatTimecode(playheadMs)} / {formatTimecode(durationMs)}
        </TransportTime>
      </TransportRow>
    </PreviewRoot>
  );
}

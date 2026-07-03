import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { Add } from "@styled-icons/material-rounded/Add";
import { Close } from "@styled-icons/material-rounded/Close";
import { ContentCut } from "@styled-icons/material-rounded/ContentCut";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { Lock } from "@styled-icons/material-rounded/Lock";
import { LockOpen } from "@styled-icons/material-rounded/LockOpen";
import { DeleteSweep } from "@styled-icons/material-rounded/DeleteSweep";
import { Redo } from "@styled-icons/material-rounded/Redo";
import { TextFields } from "@styled-icons/material-rounded/TextFields";
import { Undo } from "@styled-icons/material-rounded/Undo";
import { VolumeOff } from "@styled-icons/material-rounded/VolumeOff";
import { VolumeUp } from "@styled-icons/material-rounded/VolumeUp";
import AppSelect from "../app/AppSelect.jsx";
import { VIDEO_ASSET_POINTER_DRAG_EVENT } from "./videoDragEvents.js";
import {
  addMediaClip,
  addTextClip,
  addTrack,
  clipEndMs,
  collectSnapPoints,
  findClip,
  formatTimecode,
  gainAtMs,
  MEME_TEXT_STYLE,
  moveClip,
  moveClips,
  moveClipToTrack,
  normalizeGain,
  projectDurationMs,
  removeClips,
  removeTrack,
  rippleDeleteClip,
  snapMs,
  splitClip,
  trimClipEnd,
  trimClipStart,
  updateClip,
  updateTrack,
} from "./videoEditorModel.js";
import {
  VideoDangerButton,
  VideoIconButton,
  VideoInput,
  VideoLabel,
  VideoSecondaryButton,
  VideoTextArea,
} from "./videoStyles.js";

const LABEL_RAIL_WIDTH = 76;
const RULER_HEIGHT = 20;
const TRACK_HEIGHTS = { video: 46, audio: 34, text: 26 };
const TRACK_GAP = 3;
const MIN_ZOOM = 8;
const MAX_ZOOM = 480;

const TimelineRoot = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: #030507;
`;

const TimelineToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  flex: 0 0 auto;
  border-bottom: 1px solid rgba(148, 163, 184, 0.09);
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const ToolbarTimecode = styled.span`
  font-size: 10.5px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  color: #a7f3d0;
  margin-right: 4px;
  white-space: nowrap;
`;

const ToolbarSpacer = styled.span`
  flex: 1 1 auto;
  min-width: 4px;
`;

const ToolbarDivider = styled.span`
  width: 1px;
  height: 12px;
  background: rgba(148, 163, 184, 0.16);
  flex: none;
  margin: 0 3px;
`;

const ZoomWrap = styled.label`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;

  input {
    width: 72px;
    accent-color: #10b981;
  }
`;

const AddTrackMenu = styled.div`
  position: absolute;
  z-index: 20;
  display: grid;
  gap: 2px;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 7px;
  background: rgba(7, 12, 22, 0.98);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.5);
`;

const AddTrackOption = styled.button`
  appearance: none;
  border: none;
  background: transparent;
  color: rgba(203, 213, 225, 0.9);
  font-size: 10.5px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 5px;
  cursor: pointer;
  text-align: left;

  &:hover {
    background: rgba(16, 185, 129, 0.16);
    color: #d1fae5;
  }
`;

const TimelineScroller = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  position: relative;
`;

const TimelineCanvas = styled.div`
  position: relative;
  min-width: 100%;
  padding-bottom: 6px;
`;

const RulerRow = styled.div`
  position: sticky;
  top: 0;
  z-index: 6;
  display: flex;
  height: ${RULER_HEIGHT}px;
  background: rgba(3, 5, 7, 0.96);
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
`;

const RulerRail = styled.div`
  position: sticky;
  left: 0;
  z-index: 2;
  width: ${LABEL_RAIL_WIDTH}px;
  flex: none;
  background: rgba(3, 5, 7, 0.98);
  border-right: 1px solid rgba(148, 163, 184, 0.12);
`;

const RulerTrack = styled.div`
  position: relative;
  flex: 1 1 auto;
  cursor: ew-resize;
`;

const RulerTick = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(148, 163, 184, 0.18);

  span {
    position: absolute;
    top: 2px;
    left: 3px;
    font-size: 8.5px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: rgba(148, 163, 184, 0.8);
    white-space: nowrap;
  }
`;

const TrackRow = styled.div`
  display: flex;
  margin-top: ${TRACK_GAP}px;
`;

const TrackLabelRail = styled.div`
  position: sticky;
  left: 0;
  z-index: 5;
  width: ${LABEL_RAIL_WIDTH}px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 0 3px;
  background: rgba(7, 14, 24, 0.92);
  border-right: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 0 4px 4px 0;
`;

const TrackLabelText = styled.span`
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: rgba(203, 213, 225, 0.88);
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TrackMiniButton = styled.button`
  appearance: none;
  border: none;
  background: transparent;
  color: rgba(148, 163, 184, 0.6);
  padding: 2px;
  cursor: pointer;
  border-radius: 4px;
  flex: none;
  display: inline-flex;

  svg {
    width: 10px;
    height: 10px;
  }

  &:hover {
    color: #f1f5f9;
    background: rgba(148, 163, 184, 0.14);
  }

  &[data-active="true"] {
    color: #fbbf24;
  }
`;

const TrackLane = styled.div`
  position: relative;
  flex: 1 1 auto;
  border-radius: 4px;
  background: ${(props) => (props.$kind === "audio" ? "rgba(14, 22, 36, 0.5)" : props.$kind === "text" ? "rgba(22, 15, 36, 0.38)" : "rgba(9, 16, 29, 0.6)")};

  &[data-drop-hint="true"] {
    outline: 1.5px dashed rgba(16, 185, 129, 0.6);
    outline-offset: -2px;
    background: rgba(16, 185, 129, 0.07);
  }
`;

const ClipBlock = styled.div`
  position: absolute;
  top: 2px;
  bottom: 2px;
  border-radius: 4px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  overflow: hidden;
  cursor: grab;
  user-select: none;
  background: ${(props) =>
    props.$kind === "audio"
      ? "linear-gradient(180deg, rgba(13, 74, 60, 0.8), rgba(6, 44, 36, 0.88))"
      : props.$kind === "text"
        ? "linear-gradient(180deg, rgba(76, 49, 138, 0.75), rgba(49, 30, 92, 0.85))"
        : "linear-gradient(180deg, rgba(23, 55, 99, 0.85), rgba(13, 34, 66, 0.92))"};

  &[data-selected="true"] {
    border-color: rgba(16, 185, 129, 0.85);
    box-shadow: 0 0 0 1px rgba(16, 185, 129, 0.45);
  }
`;

const ClipLabel = styled.div`
  position: absolute;
  inset: 2px 5px auto 5px;
  font-size: 8.5px;
  font-weight: 750;
  color: rgba(226, 232, 240, 0.92);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
`;

const ClipThumb = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: 0.32;
  pointer-events: none;
`;

const Filmstrip = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  pointer-events: none;

  img {
    flex: 1 1 0;
    min-width: 0;
    height: 100%;
    object-fit: cover;
    opacity: 0.34;
  }
`;

const WaveformSvg = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;

const TrimHandle = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 7px;
  cursor: ew-resize;
  z-index: 2;

  &[data-side="start"] {
    left: 0;
    border-left: 2px solid rgba(226, 232, 240, 0.45);
  }

  &[data-side="end"] {
    right: 0;
    border-right: 2px solid rgba(226, 232, 240, 0.45);
  }

  &:hover {
    background: rgba(16, 185, 129, 0.3);
  }
`;

const GainEnvelope = styled.svg`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  opacity: 0.9;
`;

const RangeOverlay = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 4;
  background: rgba(96, 165, 250, 0.12);
  border-left: 1px solid rgba(96, 165, 250, 0.55);
  border-right: 1px solid rgba(96, 165, 250, 0.55);
  pointer-events: none;
`;

const RangeChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid rgba(96, 165, 250, 0.45);
  border-radius: 999px;
  background: rgba(37, 99, 235, 0.16);
  color: #bfdbfe;
  font-size: 9px;
  font-weight: 750;
  font-variant-numeric: tabular-nums;
  padding: 1px 3px 1px 8px;
  white-space: nowrap;
  flex: none;

  button {
    appearance: none;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0 3px;
    font-size: 10px;
    line-height: 1;
  }
`;

const Playhead = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #f87171;
  z-index: 7;
  pointer-events: none;

  &::before {
    content: "";
    position: absolute;
    top: 0;
    left: -4px;
    border-left: 4.5px solid transparent;
    border-right: 4.5px solid transparent;
    border-top: 5px solid #f87171;
  }
`;

const InspectorPopover = styled.div`
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 12;
  display: grid;
  gap: 7px;
  width: min(280px, calc(100% - 12px));
  max-height: min(300px, calc(100% - 12px));
  overflow-y: auto;
  padding: 9px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 9px;
  background: rgba(7, 12, 22, 0.97);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
`;

const InspectorHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  font-weight: 800;
  color: #d1fae5;

  span {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const InspectorRow = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));
  gap: 6px;
`;

const KeyframeRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 5px;
  align-items: center;
`;

const SliderLabel = styled.label`
  display: grid;
  gap: 2px;
  font-size: 9px;
  font-weight: 750;
  color: #94a3b8;

  input[type="range"] {
    accent-color: #10b981;
    width: 100%;
  }
`;

function trackHeight(kind) {
  return TRACK_HEIGHTS[kind] || TRACK_HEIGHTS.video;
}

function clipDisplayName(clip, track) {
  if (track.kind === "text") {
    return clip.text || "Text";
  }
  const path = String(clip.assetPath || "");
  const segments = path.split("/");
  return segments[segments.length - 1] || "clip";
}

// Interactive multi-track timeline. All edits flow through the pure model
// helpers and surface as a whole-project onChange (the pane owns autosave and
// history). Media arrives via the pane-scoped pointer-drag channel.
export default function Timeline({
  assetsByPath = {},
  canRedo = false,
  canUndo = false,
  onChange,
  onRangesChange,
  onRedo,
  onSeek,
  onSelectClips,
  onUndo,
  paneToken = "",
  playheadMs = 0,
  project,
  ranges = [],
  repoPath = "",
  selectedClipIds = [],
}) {
  const selectedClipId = selectedClipIds.length === 1 ? selectedClipIds[0] : "";
  const selectedSet = useMemo(() => new Set(selectedClipIds), [selectedClipIds]);
  const selectClip = useCallback(
    (clipId, { additive = false } = {}) => {
      if (!clipId) {
        onSelectClips?.([]);
        return;
      }
      if (additive) {
        onSelectClips?.(
          selectedClipIds.includes(clipId)
            ? selectedClipIds.filter((entry) => entry !== clipId)
            : [...selectedClipIds, clipId],
        );
      } else {
        onSelectClips?.([clipId]);
      }
    },
    [onSelectClips, selectedClipIds],
  );
  const scrollerRef = useRef(null);
  const dragRef = useRef(null);
  const addTrackButtonRef = useRef(null);
  const [zoom, setZoom] = useState(60); // px per second
  const [dropHintTrackId, setDropHintTrackId] = useState("");
  const [addTrackOpen, setAddTrackOpen] = useState(false);
  const pxPerMs = zoom / 1000;

  const durationMs = useMemo(() => projectDurationMs(project), [project]);
  const canvasWidth = Math.max(640, (durationMs + 15000) * pxPerMs + LABEL_RAIL_WIDTH);

  const selected = useMemo(
    () => (selectedClipId ? findClip(project, selectedClipId) : null),
    [project, selectedClipId],
  );

  const timeFromClientX = useCallback(
    (clientX) => {
      const scroller = scrollerRef.current;
      if (!scroller) {
        return 0;
      }
      const rect = scroller.getBoundingClientRect();
      const x = clientX - rect.left + scroller.scrollLeft - LABEL_RAIL_WIDTH;
      return Math.max(0, x / pxPerMs);
    },
    [pxPerMs],
  );

  const laneRefs = useRef(new Map());
  const trackIdFromPoint = useCallback((clientX, clientY) => {
    for (const [trackId, element] of laneRefs.current.entries()) {
      const rect = element?.getBoundingClientRect?.();
      if (
        rect
        && clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom
      ) {
        return trackId;
      }
    }
    return "";
  }, []);

  // Library → timeline pointer-drag drop target (pane-scoped custom events).
  const projectRef = useRef(project);
  projectRef.current = project;
  useEffect(() => {
    const handleDrag = (event) => {
      const detail = event?.detail || {};
      if (!detail.asset || (detail.paneToken || "") !== paneToken) {
        return;
      }
      if (detail.phase === "move" || detail.phase === "start") {
        const trackId = trackIdFromPoint(detail.x, detail.y);
        const track = trackId
          ? (projectRef.current?.tracks || []).find((entry) => entry.id === trackId)
          : null;
        const accepts = track && track.kind !== "text" && !track.locked;
        setDropHintTrackId(accepts ? trackId : "");
        return;
      }
      if (detail.phase === "cancel") {
        setDropHintTrackId("");
        return;
      }
      if (detail.phase === "end") {
        setDropHintTrackId("");
        const trackId = trackIdFromPoint(detail.x, detail.y);
        if (!trackId) {
          return;
        }
        const track = (projectRef.current?.tracks || []).find((entry) => entry.id === trackId);
        if (!track || track.kind === "text" || track.locked) {
          return;
        }
        const dropMs = timeFromClientX(detail.x);
        const result = addMediaClip(projectRef.current, detail.asset, {
          trackId,
          timelineStartMs: dropMs,
        });
        onChange?.(result.project, { transient: false });
        onSelectClips?.([result.clipId]);
      }
    };
    window.addEventListener(VIDEO_ASSET_POINTER_DRAG_EVENT, handleDrag);
    return () => window.removeEventListener(VIDEO_ASSET_POINTER_DRAG_EVENT, handleDrag);
  }, [onChange, onSelectClips, paneToken, timeFromClientX, trackIdFromPoint]);

  // Ruler: plain drag scrubs; SHIFT-drag selects a time range (chips appear
  // in the toolbar, overlays across the tracks; ranges feed the AI context).
  const [draftRange, setDraftRange] = useState(null);
  const beginScrub = useCallback(
    (event) => {
      event.preventDefault();
      const anchorMs = timeFromClientX(event.clientX);
      if (event.shiftKey) {
        setDraftRange({ startMs: anchorMs, endMs: anchorMs });
        const handleMove = (moveEvent) => {
          const at = timeFromClientX(moveEvent.clientX);
          setDraftRange({ startMs: Math.min(anchorMs, at), endMs: Math.max(anchorMs, at) });
        };
        const handleUp = (upEvent) => {
          window.removeEventListener("pointermove", handleMove);
          window.removeEventListener("pointerup", handleUp);
          window.removeEventListener("pointercancel", handleUp);
          setDraftRange(null);
          const at = timeFromClientX(upEvent?.clientX ?? event.clientX);
          const startMs = Math.round(Math.min(anchorMs, at));
          const endMs = Math.round(Math.max(anchorMs, at));
          if (endMs - startMs >= 120) {
            onRangesChange?.([...(ranges || []), { startMs, endMs }]);
          }
        };
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp);
        window.addEventListener("pointercancel", handleUp);
        return;
      }
      onSeek?.(anchorMs);
      const handleMove = (moveEvent) => onSeek?.(timeFromClientX(moveEvent.clientX));
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
    },
    [onRangesChange, onSeek, ranges, timeFromClientX],
  );

  // Clip drag: move within/between compatible lanes (whole selection moves
  // together when the grabbed clip is part of it), or trim from a handle.
  // Starts/edges snap to other clips, the playhead, and zero (~8px window).
  const beginClipDrag = useCallback(
    (event, trackId, clip, mode) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const additive = event.shiftKey;
      const partOfSelection = selectedSet.has(clip.id);
      if (additive) {
        selectClip(clip.id, { additive: true });
        return; // shift-click is pure selection, never a drag
      }
      const groupIds = partOfSelection && selectedClipIds.length > 1 ? selectedClipIds : [clip.id];
      if (!partOfSelection) {
        selectClip(clip.id);
      }
      const snapThresholdMs = 8 / pxPerMs;
      const snapPoints = collectSnapPoints(project, groupIds, [playheadMs]);
      const startX = event.clientX;
      const startY = event.clientY;
      dragRef.current = {
        mode,
        clipId: clip.id,
        groupIds,
        trackId,
        startX,
        startY,
        originStartMs: clip.timelineStartMs,
        originEndMs: clipEndMs(clip),
        moved: false,
        latest: project,
      };
      const handleMove = (moveEvent) => {
        const drag = dragRef.current;
        if (!drag) {
          return;
        }
        const deltaMs = (moveEvent.clientX - drag.startX) / pxPerMs;
        if (Math.abs(moveEvent.clientX - drag.startX) + Math.abs(moveEvent.clientY - drag.startY) > 3) {
          drag.moved = true;
        }
        if (!drag.moved) {
          return;
        }
        let next = project;
        if (drag.mode === "move") {
          const proposedStart = Math.max(0, drag.originStartMs + deltaMs);
          const proposedEnd = proposedStart + (drag.originEndMs - drag.originStartMs);
          const byStart = snapMs(proposedStart, snapPoints, snapThresholdMs);
          const byEnd = snapMs(proposedEnd, snapPoints, snapThresholdMs) - (drag.originEndMs - drag.originStartMs);
          const snappedStart =
            Math.abs(byStart - proposedStart) <= Math.abs(byEnd - proposedStart) ? byStart : Math.max(0, byEnd);
          if (drag.groupIds.length > 1) {
            next = moveClips(project, drag.groupIds, snappedStart - drag.originStartMs);
          } else {
            const targetTrackId = trackIdFromPoint(moveEvent.clientX, moveEvent.clientY) || drag.trackId;
            next =
              targetTrackId !== drag.trackId
                ? moveClipToTrack(project, drag.clipId, targetTrackId, snappedStart)
                : moveClip(project, drag.clipId, snappedStart);
          }
        } else if (drag.mode === "trim-start") {
          const proposedEdge = drag.originStartMs + deltaMs;
          const snappedEdge = snapMs(proposedEdge, snapPoints, snapThresholdMs);
          next = trimClipStart(project, drag.clipId, snappedEdge - drag.originStartMs);
        } else if (drag.mode === "trim-end") {
          const proposedEdge = drag.originEndMs + deltaMs;
          const snappedEdge = snapMs(proposedEdge, snapPoints, snapThresholdMs);
          next = trimClipEnd(project, drag.clipId, snappedEdge - drag.originEndMs);
        }
        drag.latest = next;
        onChange?.(next, { transient: true });
      };
      const handleUp = () => {
        const drag = dragRef.current;
        dragRef.current = null;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        window.removeEventListener("pointercancel", handleUp);
        if (drag?.moved && drag.latest && drag.latest !== project) {
          onChange?.(drag.latest, { transient: false });
        }
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
      window.addEventListener("pointercancel", handleUp);
    },
    [onChange, playheadMs, project, pxPerMs, selectClip, selectedClipIds, selectedSet, trackIdFromPoint],
  );

  // Keyboard: delete selected clip, undo/redo.
  useEffect(() => {
    const handleKey = (event) => {
      const target = event.target;
      const tag = String(target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
          onRedo?.();
        } else {
          onUndo?.();
        }
        return;
      }
      if (!selectedClipIds.length || event.defaultPrevented) {
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onChange?.(removeClips(project, selectedClipIds), { transient: false });
        onSelectClips?.([]);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onChange, onRedo, onSelectClips, onUndo, project, selectedClipIds]);

  const splitSelectedAtPlayhead = useCallback(() => {
    if (!selectedClipId) {
      return;
    }
    onChange?.(splitClip(project, selectedClipId, playheadMs), { transient: false });
  }, [onChange, playheadMs, project, selectedClipId]);

  const rulerTicks = useMemo(() => {
    const targetPx = 90;
    const stepCandidatesMs = [250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000, 300000];
    const stepMs = stepCandidatesMs.find((step) => step * pxPerMs >= targetPx) || 600000;
    const total = durationMs + 15000;
    const ticks = [];
    for (let at = 0; at <= total; at += stepMs) {
      ticks.push(at);
    }
    return ticks;
  }, [durationMs, pxPerMs]);

  // Waveforms (audio clips) + filmstrips (video clips): fetched lazily per
  // asset from the ffmpeg-backed cached commands; failures degrade silently
  // to the flat clip block.
  const mediaVisualsRef = useRef(new Map()); // assetPath → { peaks?, frames?, pending }
  const [visualsVersion, setVisualsVersion] = useState(0);
  useEffect(() => {
    if (!repoPath) {
      return;
    }
    const wanted = new Map(); // assetPath → "waveform" | "filmstrip"
    for (const track of project?.tracks || []) {
      for (const clip of track.clips || []) {
        if (!clip.assetPath) {
          continue;
        }
        if (track.kind === "audio") {
          wanted.set(clip.assetPath, "waveform");
        } else if (track.kind === "video" && assetsByPath[clip.assetPath]?.kind === "video") {
          wanted.set(clip.assetPath, "filmstrip");
        }
      }
    }
    for (const [assetPath, kind] of wanted.entries()) {
      const cached = mediaVisualsRef.current.get(assetPath);
      if (cached?.pending || (kind === "waveform" ? cached?.peaks : cached?.frames)) {
        continue;
      }
      mediaVisualsRef.current.set(assetPath, { ...(cached || {}), pending: true });
      const call = kind === "waveform"
        ? invoke("video_media_waveform", { repoPath, path: assetPath, samples: 320 })
        : invoke("video_media_filmstrip", { repoPath, path: assetPath, frames: 8 });
      call
        .then((result) => {
          const entry = mediaVisualsRef.current.get(assetPath) || {};
          if (kind === "waveform" && Array.isArray(result?.peaks)) {
            entry.peaks = result.peaks;
          }
          if (kind === "filmstrip" && Array.isArray(result?.frames)) {
            entry.frames = result.frames;
          }
          entry.pending = false;
          mediaVisualsRef.current.set(assetPath, entry);
          setVisualsVersion((version) => version + 1);
        })
        .catch(() => {
          mediaVisualsRef.current.set(assetPath, { pending: false, failed: true });
        });
    }
  }, [assetsByPath, project, repoPath]);

  const waveformPolygon = useCallback((peaks, widthPx, heightPx) => {
    if (!Array.isArray(peaks) || !peaks.length) {
      return "";
    }
    const mid = heightPx / 2;
    const step = widthPx / peaks.length;
    const top = peaks.map((peak, index) => `${(index * step).toFixed(1)},${(mid - Math.min(1, peak) * mid * 0.92).toFixed(1)}`);
    const bottom = peaks
      .map((peak, index) => `${(index * step).toFixed(1)},${(mid + Math.min(1, peak) * mid * 0.92).toFixed(1)}`)
      .reverse();
    return `${top.join(" ")} ${bottom.join(" ")}`;
  }, []);

  const gainPath = useCallback((clip, widthPx, heightPx) => {
    const gain = normalizeGain(clip.gain);
    const points = [];
    const samples = 24;
    for (let index = 0; index <= samples; index += 1) {
      const atMs = (clip.durationMs * index) / samples;
      const level = gainAtMs(gain, atMs);
      const x = (atMs / clip.durationMs) * widthPx;
      const y = heightPx - Math.min(1, level / 2) * heightPx;
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    return points.join(" ");
  }, []);

  const updateSelectedClip = useCallback(
    (patch) => {
      if (!selectedClipId) {
        return;
      }
      onChange?.(updateClip(project, selectedClipId, patch), { transient: false });
    },
    [onChange, project, selectedClipId],
  );

  const selectedGain = selected && selected.track.kind !== "text" ? normalizeGain(selected.clip.gain) : null;

  const [addTrackMenuPos, setAddTrackMenuPos] = useState({ left: 0, top: 0 });
  const toggleAddTrack = useCallback(() => {
    const rect = addTrackButtonRef.current?.getBoundingClientRect?.();
    const rootRect = addTrackButtonRef.current?.closest?.("[data-video-timeline]")?.getBoundingClientRect?.();
    if (rect && rootRect) {
      setAddTrackMenuPos({ left: rect.left - rootRect.left, top: rect.bottom - rootRect.top + 2 });
    }
    setAddTrackOpen((open) => !open);
  }, []);

  return (
    <TimelineRoot data-video-timeline="true" style={{ position: "relative" }}>
      <TimelineToolbar>
        <ToolbarTimecode>{formatTimecode(playheadMs, { withMs: true })}</ToolbarTimecode>
        <VideoIconButton disabled={!canUndo} onClick={() => onUndo?.()} title="Undo (⌘Z)" type="button">
          <Undo aria-hidden="true" />
        </VideoIconButton>
        <VideoIconButton disabled={!canRedo} onClick={() => onRedo?.()} title="Redo (⇧⌘Z)" type="button">
          <Redo aria-hidden="true" />
        </VideoIconButton>
        <ToolbarDivider />
        <VideoIconButton
          disabled={!selectedClipId}
          onClick={splitSelectedAtPlayhead}
          title="Split at playhead"
          type="button"
        >
          <ContentCut aria-hidden="true" />
        </VideoIconButton>
        <VideoIconButton
          disabled={!selectedClipIds.length}
          onClick={() => {
            onChange?.(removeClips(project, selectedClipIds), { transient: false });
            onSelectClips?.([]);
          }}
          title={selectedClipIds.length > 1 ? `Delete ${selectedClipIds.length} clips` : "Delete clip"}
          type="button"
        >
          <Delete aria-hidden="true" />
        </VideoIconButton>
        <VideoIconButton
          disabled={!selectedClipId}
          onClick={() => {
            onChange?.(rippleDeleteClip(project, selectedClipId), { transient: false });
            onSelectClips?.([]);
          }}
          title="Ripple delete (close the gap)"
          type="button"
        >
          <DeleteSweep aria-hidden="true" />
        </VideoIconButton>
        <VideoIconButton
          onClick={() => {
            const result = addTextClip(project, { timelineStartMs: playheadMs });
            onChange?.(result.project, { transient: false });
            onSelectClips?.([result.clipId]);
          }}
          title="Add text at playhead"
          type="button"
        >
          <TextFields aria-hidden="true" />
        </VideoIconButton>
        <VideoIconButton onClick={toggleAddTrack} ref={addTrackButtonRef} title="Add track" type="button">
          <Add aria-hidden="true" />
        </VideoIconButton>
        <ToolbarSpacer />
        {(ranges || []).map((range, index) => (
          <RangeChip
            key={`${range.startMs}-${range.endMs}-${index}`}
            title="Selected range — included as AI context when you prompt an agent from this pane (⇧-drag the ruler to add more)"
          >
            {formatTimecode(range.startMs)}–{formatTimecode(range.endMs)}
            <button
              aria-label="Remove range"
              onClick={() => onRangesChange?.(ranges.filter((_, rangeIndex) => rangeIndex !== index))}
              type="button"
            >
              ×
            </button>
          </RangeChip>
        ))}
        {ranges?.length ? (
          <RangeChip as="span" title="Clear all ranges">
            <button aria-label="Clear all ranges" onClick={() => onRangesChange?.([])} type="button">
              clear
            </button>
          </RangeChip>
        ) : null}
        <ZoomWrap title="Zoom">
          <input
            max={MAX_ZOOM}
            min={MIN_ZOOM}
            onChange={(event) => setZoom(Number(event.target.value))}
            type="range"
            value={zoom}
          />
        </ZoomWrap>
      </TimelineToolbar>
      {addTrackOpen ? (
        <AddTrackMenu style={{ left: addTrackMenuPos.left, top: addTrackMenuPos.top }}>
          {["video", "audio", "text"].map((kind) => (
            <AddTrackOption
              key={kind}
              onClick={() => {
                onChange?.(addTrack(project, kind), { transient: false });
                setAddTrackOpen(false);
              }}
              type="button"
            >
              + {kind.charAt(0).toUpperCase() + kind.slice(1)} track
            </AddTrackOption>
          ))}
        </AddTrackMenu>
      ) : null}
      <TimelineScroller ref={scrollerRef}>
        <TimelineCanvas style={{ width: `${canvasWidth}px` }}>
          <RulerRow>
            <RulerRail />
            <RulerTrack onPointerDown={beginScrub}>
              {rulerTicks.map((at) => (
                <RulerTick key={at} style={{ left: `${at * pxPerMs}px` }}>
                  <span>{formatTimecode(at)}</span>
                </RulerTick>
              ))}
            </RulerTrack>
          </RulerRow>
          {(project?.tracks || []).map((track) => (
            <TrackRow key={track.id} style={{ height: `${trackHeight(track.kind)}px` }}>
              <TrackLabelRail>
                <TrackLabelText title={track.label}>{track.label}</TrackLabelText>
                {track.kind !== "text" ? (
                  <TrackMiniButton
                    data-active={track.muted ? "true" : "false"}
                    onClick={() => onChange?.(updateTrack(project, track.id, { muted: !track.muted }), { transient: false })}
                    title={track.muted ? "Unmute track" : "Mute track"}
                    type="button"
                  >
                    {track.muted ? <VolumeOff aria-hidden="true" /> : <VolumeUp aria-hidden="true" />}
                  </TrackMiniButton>
                ) : null}
                <TrackMiniButton
                  data-active={track.locked ? "true" : "false"}
                  onClick={() => onChange?.(updateTrack(project, track.id, { locked: !track.locked }), { transient: false })}
                  title={track.locked ? "Unlock track" : "Lock track"}
                  type="button"
                >
                  {track.locked ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
                </TrackMiniButton>
                <TrackMiniButton
                  onClick={() => onChange?.(removeTrack(project, track.id), { transient: false })}
                  title="Remove track"
                  type="button"
                >
                  <Close aria-hidden="true" />
                </TrackMiniButton>
              </TrackLabelRail>
              <TrackLane
                $kind={track.kind}
                data-drop-hint={dropHintTrackId === track.id ? "true" : "false"}
                data-video-lane={track.id}
                onPointerDown={(event) => {
                  if (event.target === event.currentTarget) {
                    onSelectClips?.([]);
                    onSeek?.(timeFromClientX(event.clientX));
                  }
                }}
                ref={(element) => {
                  if (element) {
                    laneRefs.current.set(track.id, element);
                  } else {
                    laneRefs.current.delete(track.id);
                  }
                }}
              >
                {(track.clips || []).map((clip) => {
                  const widthPx = Math.max(6, clip.durationMs * pxPerMs);
                  const asset = track.kind !== "text" ? assetsByPath[clip.assetPath] : null;
                  const visuals = clip.assetPath ? mediaVisualsRef.current.get(clip.assetPath) : null;
                  const filmstripFrames =
                    track.kind === "video" && widthPx > 90 && visuals?.frames?.length ? visuals.frames : null;
                  const waveformPeaks = track.kind === "audio" && visuals?.peaks?.length ? visuals.peaks : null;
                  return (
                    <ClipBlock
                      $kind={track.kind}
                      data-selected={selectedSet.has(clip.id) ? "true" : "false"}
                      key={clip.id}
                      onPointerDown={(event) => beginClipDrag(event, track.id, clip, "move")}
                      style={{ left: `${clip.timelineStartMs * pxPerMs}px`, width: `${widthPx}px` }}
                      title={`${clipDisplayName(clip, track)} · ${formatTimecode(clip.timelineStartMs)} → ${formatTimecode(clipEndMs(clip))}`}
                    >
                      {filmstripFrames ? (
                        <Filmstrip>
                          {filmstripFrames.map((frame, frameIndex) => (
                            <img alt="" draggable={false} key={frameIndex} src={frame} />
                          ))}
                        </Filmstrip>
                      ) : asset?.thumbnailDataUrl && track.kind === "video" ? (
                        <ClipThumb alt="" draggable={false} src={asset.thumbnailDataUrl} />
                      ) : null}
                      {waveformPeaks ? (
                        <WaveformSvg
                          preserveAspectRatio="none"
                          viewBox={`0 0 ${widthPx} ${trackHeight(track.kind) - 6}`}
                        >
                          <polygon
                            fill="rgba(52, 211, 153, 0.35)"
                            points={waveformPolygon(waveformPeaks, widthPx, trackHeight(track.kind) - 6)}
                          />
                        </WaveformSvg>
                      ) : null}
                      <ClipLabel>{clipDisplayName(clip, track)}</ClipLabel>
                      {track.kind !== "text" && widthPx > 30 ? (
                        <GainEnvelope preserveAspectRatio="none" viewBox={`0 0 ${widthPx} ${trackHeight(track.kind) - 6}`}>
                          <polyline
                            fill="none"
                            points={gainPath(clip, widthPx, trackHeight(track.kind) - 6)}
                            stroke="rgba(52, 211, 153, 0.85)"
                            strokeWidth="1.2"
                          />
                        </GainEnvelope>
                      ) : null}
                      {widthPx > 26 ? (
                        <>
                          <TrimHandle
                            data-side="start"
                            onPointerDown={(event) => beginClipDrag(event, track.id, clip, "trim-start")}
                          />
                          <TrimHandle
                            data-side="end"
                            onPointerDown={(event) => beginClipDrag(event, track.id, clip, "trim-end")}
                          />
                        </>
                      ) : null}
                    </ClipBlock>
                  );
                })}
              </TrackLane>
            </TrackRow>
          ))}
          {[...(ranges || []), ...(draftRange ? [draftRange] : [])].map((range, index) => (
            <RangeOverlay
              key={`range-${index}`}
              style={{
                left: `${LABEL_RAIL_WIDTH + range.startMs * pxPerMs}px`,
                width: `${Math.max(1, (range.endMs - range.startMs) * pxPerMs)}px`,
              }}
            />
          ))}
          <Playhead style={{ left: `${LABEL_RAIL_WIDTH + playheadMs * pxPerMs}px` }} />
        </TimelineCanvas>
      </TimelineScroller>
      {selected ? (
        <InspectorPopover data-video-clip-inspector="true">
          <InspectorHeader>
            <span>{clipDisplayName(selected.clip, selected.track)}</span>
            <VideoIconButton onClick={() => onSelectClips?.([])} title="Close" type="button">
              <Close aria-hidden="true" />
            </VideoIconButton>
          </InspectorHeader>
          {selected.track.kind === "text" ? (
            <>
              <VideoLabel>
                Text
                <VideoTextArea
                  onChange={(event) => updateSelectedClip({ text: event.target.value })}
                  rows={2}
                  value={selected.clip.text || ""}
                />
              </VideoLabel>
              <InspectorRow>
                <VideoLabel>
                  Size
                  <VideoInput
                    min={8}
                    onChange={(event) => updateSelectedClip({ style: { fontSize: Number(event.target.value) } })}
                    type="number"
                    value={selected.clip.style?.fontSize ?? 48}
                  />
                </VideoLabel>
                <VideoLabel>
                  Color
                  <VideoInput
                    onChange={(event) => updateSelectedClip({ style: { color: event.target.value } })}
                    type="color"
                    value={selected.clip.style?.color || "#ffffff"}
                  />
                </VideoLabel>
                <VideoLabel>
                  Align
                  <AppSelect
                    onChange={(value) => updateSelectedClip({ style: { align: value } })}
                    options={[
                      { value: "left", label: "Left" },
                      { value: "center", label: "Center" },
                      { value: "right", label: "Right" },
                    ]}
                    value={selected.clip.style?.align || "center"}
                  />
                </VideoLabel>
              </InspectorRow>
              <InspectorRow>
                <SliderLabel>
                  X · {Math.round((selected.clip.style?.x ?? 0.5) * 100)}%
                  <input
                    max={1}
                    min={0}
                    onChange={(event) => updateSelectedClip({ style: { x: Number(event.target.value) } })}
                    step={0.01}
                    type="range"
                    value={selected.clip.style?.x ?? 0.5}
                  />
                </SliderLabel>
                <SliderLabel>
                  Y · {Math.round((selected.clip.style?.y ?? 0.85) * 100)}%
                  <input
                    max={1}
                    min={0}
                    onChange={(event) => updateSelectedClip({ style: { y: Number(event.target.value) } })}
                    step={0.01}
                    type="range"
                    value={selected.clip.style?.y ?? 0.85}
                  />
                </SliderLabel>
              </InspectorRow>
              <InspectorRow>
                <SliderLabel>
                  Outline · {selected.clip.style?.outlineWidth ?? 0}px
                  <input
                    max={20}
                    min={0}
                    onChange={(event) => updateSelectedClip({ style: { outlineWidth: Number(event.target.value) } })}
                    step={1}
                    type="range"
                    value={selected.clip.style?.outlineWidth ?? 0}
                  />
                </SliderLabel>
                <VideoLabel>
                  Outline color
                  <VideoInput
                    onChange={(event) => updateSelectedClip({ style: { outlineColor: event.target.value } })}
                    type="color"
                    value={selected.clip.style?.outlineColor || "#000000"}
                  />
                </VideoLabel>
              </InspectorRow>
              <VideoLabel>
                Font
                <AppSelect
                  onChange={(value) => updateSelectedClip({ style: { fontFamily: value } })}
                  options={[
                    { value: "sans-serif", label: "Sans" },
                    { value: "Impact, 'Arial Black', sans-serif", label: "Impact (meme)" },
                    { value: "serif", label: "Serif" },
                    { value: "monospace", label: "Mono" },
                  ]}
                  value={selected.clip.style?.fontFamily || "sans-serif"}
                />
              </VideoLabel>
              <InspectorRow>
                <VideoSecondaryButton
                  data-active={selected.clip.style?.shadow ? "true" : "false"}
                  onClick={() => updateSelectedClip({ style: { shadow: !selected.clip.style?.shadow } })}
                  style={selected.clip.style?.shadow ? { borderColor: "rgba(16,185,129,0.5)", color: "#a7f3d0" } : undefined}
                  type="button"
                >
                  Shadow
                </VideoSecondaryButton>
                <VideoSecondaryButton
                  onClick={() => updateSelectedClip({ style: { uppercase: !selected.clip.style?.uppercase } })}
                  style={selected.clip.style?.uppercase ? { borderColor: "rgba(16,185,129,0.5)", color: "#a7f3d0" } : undefined}
                  type="button"
                >
                  AA
                </VideoSecondaryButton>
                <VideoSecondaryButton
                  onClick={() => updateSelectedClip({ style: { ...MEME_TEXT_STYLE } })}
                  title="Classic meme text: Impact, white, black outline, uppercase"
                  type="button"
                >
                  Meme
                </VideoSecondaryButton>
              </InspectorRow>
            </>
          ) : (
            <>
              <SliderLabel>
                Volume · {Math.round((selectedGain?.level ?? 1) * 100)}%
                <input
                  max={2}
                  min={0}
                  onChange={(event) => updateSelectedClip({ gain: { level: Number(event.target.value) } })}
                  step={0.01}
                  type="range"
                  value={selectedGain?.level ?? 1}
                />
              </SliderLabel>
              <InspectorRow>
                <VideoSecondaryButton
                  onClick={() =>
                    updateSelectedClip({
                      gain: {
                        keyframes: [
                          { atMs: 0, level: 0 },
                          { atMs: Math.min(1000, selected.clip.durationMs), level: selectedGain?.level ?? 1 },
                        ],
                      },
                    })
                  }
                  type="button"
                >
                  Fade in
                </VideoSecondaryButton>
                <VideoSecondaryButton
                  onClick={() =>
                    updateSelectedClip({
                      gain: {
                        keyframes: [
                          { atMs: Math.max(0, selected.clip.durationMs - 1000), level: selectedGain?.level ?? 1 },
                          { atMs: selected.clip.durationMs, level: 0 },
                        ],
                      },
                    })
                  }
                  type="button"
                >
                  Fade out
                </VideoSecondaryButton>
                <VideoSecondaryButton
                  onClick={() =>
                    updateSelectedClip({
                      gain: {
                        keyframes: [
                          ...(selectedGain?.keyframes || []),
                          {
                            atMs: Math.min(
                              Math.max(0, playheadMs - selected.clip.timelineStartMs),
                              selected.clip.durationMs,
                            ),
                            level: selectedGain?.level ?? 1,
                          },
                        ],
                      },
                    })
                  }
                  type="button"
                >
                  + Key
                </VideoSecondaryButton>
              </InspectorRow>
              {(selectedGain?.keyframes || []).map((frame, index) => (
                <KeyframeRow key={`${frame.atMs}-${index}`}>
                  <VideoInput
                    aria-label="Keyframe time (ms)"
                    min={0}
                    onChange={(event) => {
                      const frames = [...selectedGain.keyframes];
                      frames[index] = { ...frames[index], atMs: Number(event.target.value) };
                      updateSelectedClip({ gain: { keyframes: frames } });
                    }}
                    type="number"
                    value={frame.atMs}
                  />
                  <VideoInput
                    aria-label="Keyframe level"
                    max={4}
                    min={0}
                    onChange={(event) => {
                      const frames = [...selectedGain.keyframes];
                      frames[index] = { ...frames[index], level: Number(event.target.value) };
                      updateSelectedClip({ gain: { keyframes: frames } });
                    }}
                    step={0.05}
                    type="number"
                    value={frame.level}
                  />
                  <VideoIconButton
                    onClick={() => {
                      const frames = selectedGain.keyframes.filter((_, frameIndex) => frameIndex !== index);
                      updateSelectedClip({ gain: { keyframes: frames } });
                    }}
                    title="Remove keyframe"
                    type="button"
                  >
                    <Close aria-hidden="true" />
                  </VideoIconButton>
                </KeyframeRow>
              ))}
              {selectedGain?.keyframes?.length ? (
                <VideoDangerButton onClick={() => updateSelectedClip({ gain: { keyframes: [] } })} type="button">
                  Clear keyframes
                </VideoDangerButton>
              ) : null}
              <InspectorRow>
                <SliderLabel>
                  Opacity · {Math.round((selected.clip.transform?.opacity ?? 1) * 100)}%
                  <input
                    max={1}
                    min={0}
                    onChange={(event) => updateSelectedClip({ transform: { opacity: Number(event.target.value) } })}
                    step={0.01}
                    type="range"
                    value={selected.clip.transform?.opacity ?? 1}
                  />
                </SliderLabel>
                <SliderLabel>
                  Scale · {Math.round((selected.clip.transform?.scale ?? 1) * 100)}%
                  <input
                    max={3}
                    min={0.1}
                    onChange={(event) => updateSelectedClip({ transform: { scale: Number(event.target.value) } })}
                    step={0.01}
                    type="range"
                    value={selected.clip.transform?.scale ?? 1}
                  />
                </SliderLabel>
              </InspectorRow>
            </>
          )}
        </InspectorPopover>
      ) : null}
    </TimelineRoot>
  );
}

// Pure timeline model helpers for the Video Editor pane. No React, no Tauri —
// everything here is unit-testable and shared by the grid pane, the popout
// window host, and (indirectly) coding agents that edit the project JSON.
//
// Project shape (media/projects/<slug>.video.json, version 1):
//   { version, name, settings: { width, height, fps, background },
//     tracks: [{ id, kind: "video"|"audio"|"text", label, muted, locked, clips: [...] }] }
// Media clips: { id, assetPath, timelineStartMs, durationMs, sourceInMs, speed,
//   gain: { level, keyframes: [{ atMs, level }] }, transform: { x, y, scale, opacity } }
// Text clips: { id, text, timelineStartMs, durationMs, style: { fontSize, color,
//   background, x, y, align, bold, fontFamily } }

export const VIDEO_PROJECT_VERSION = 1;
export const VIDEO_TRACK_KINDS = ["video", "audio", "text"];
export const MIN_CLIP_DURATION_MS = 80;

let clipIdSeq = 0;

export function makeVideoId(prefix = "clip") {
  clipIdSeq += 1;
  const entropy = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${entropy}-${clipIdSeq}`;
}

function cleanNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value) {
  return typeof value === "string" ? value : "";
}

export function clampGainLevel(level) {
  return Math.min(4, Math.max(0, cleanNumber(level, 1)));
}

export function normalizeGain(gain) {
  const level = clampGainLevel(gain?.level ?? 1);
  const keyframes = Array.isArray(gain?.keyframes)
    ? gain.keyframes
        .filter((frame) => frame && Number.isFinite(Number(frame.atMs)))
        .map((frame) => ({
          atMs: Math.max(0, Math.round(cleanNumber(frame.atMs))),
          level: clampGainLevel(frame.level),
        }))
        .sort((a, b) => a.atMs - b.atMs)
    : [];
  return { level, keyframes };
}

export function normalizeTransform(transform) {
  return {
    x: cleanNumber(transform?.x, 0),
    y: cleanNumber(transform?.y, 0),
    scale: Math.min(8, Math.max(0.05, cleanNumber(transform?.scale, 1))),
    opacity: Math.min(1, Math.max(0, cleanNumber(transform?.opacity, 1))),
  };
}

// Property keyframes (opacity / x / y / scale). atMs is clip-relative;
// easing describes the segment FROM this keyframe to the next.
export const VIDEO_KF_PROPS = ["opacity", "x", "y", "scale"];
export const VIDEO_KF_EASINGS = ["linear", "hold", "smooth"];

function normalizeKfList(list, prop) {
  const clamp = (value) => {
    const v = cleanNumber(value, prop === "opacity" || prop === "scale" ? 1 : 0);
    if (prop === "opacity") {
      return Math.min(1, Math.max(0, v));
    }
    if (prop === "scale") {
      return Math.min(8, Math.max(0.05, v));
    }
    return Math.min(4, Math.max(-4, v));
  };
  return (Array.isArray(list) ? list : [])
    .filter((frame) => frame && Number.isFinite(Number(frame.atMs)))
    .map((frame) => ({
      atMs: Math.max(0, Math.round(cleanNumber(frame.atMs))),
      value: clamp(frame.value),
      easing: VIDEO_KF_EASINGS.includes(frame.easing) ? frame.easing : "linear",
    }))
    .sort((a, b) => a.atMs - b.atMs);
}

export function normalizeKf(kf) {
  const result = {};
  for (const prop of VIDEO_KF_PROPS) {
    const list = normalizeKfList(kf?.[prop], prop);
    if (list.length) {
      result[prop] = list;
    }
  }
  return result;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

// Interpolated keyframe value at a clip-relative time; ends clamp.
export function kfValueAtMs(frames, atMs, fallback) {
  const list = Array.isArray(frames) ? frames : [];
  if (!list.length) {
    return fallback;
  }
  if (atMs <= list[0].atMs) {
    return list[0].value;
  }
  const last = list[list.length - 1];
  if (atMs >= last.atMs) {
    return last.value;
  }
  for (let index = 0; index < list.length - 1; index += 1) {
    const from = list[index];
    const to = list[index + 1];
    if (atMs >= from.atMs && atMs <= to.atMs) {
      const span = to.atMs - from.atMs;
      if (span <= 0 || from.easing === "hold") {
        return from.easing === "hold" ? from.value : to.value;
      }
      let ratio = (atMs - from.atMs) / span;
      if (from.easing === "smooth") {
        ratio = smoothstep(ratio);
      }
      return from.value + (to.value - from.value) * ratio;
    }
  }
  return fallback;
}

// Effective property value at a clip-relative time (kf overrides static).
export function clipPropAtMs(clip, prop, atMs) {
  const statics = {
    opacity: clip?.transform?.opacity ?? 1,
    x: clip?.transform?.x ?? 0,
    y: clip?.transform?.y ?? 0,
    scale: clip?.transform?.scale ?? 1,
  };
  const frames = clip?.kf?.[prop];
  return kfValueAtMs(frames, atMs, statics[prop]);
}

export function normalizeTextStyle(style) {
  return {
    fontSize: Math.min(400, Math.max(8, cleanNumber(style?.fontSize, 48))),
    color: cleanText(style?.color) || "#ffffff",
    background: cleanText(style?.background),
    x: Math.min(1, Math.max(0, cleanNumber(style?.x, 0.5))),
    y: Math.min(1, Math.max(0, cleanNumber(style?.y, 0.85))),
    align: ["left", "center", "right"].includes(style?.align) ? style.align : "center",
    bold: style?.bold !== false,
    fontFamily: cleanText(style?.fontFamily) || "sans-serif",
    outlineColor: cleanText(style?.outlineColor) || "#000000",
    outlineWidth: Math.min(40, Math.max(0, cleanNumber(style?.outlineWidth, 0))),
    shadow: style?.shadow === true,
    uppercase: style?.uppercase === true,
  };
}

// Classic meme text: heavy white face, thick black outline, uppercase.
export const MEME_TEXT_STYLE = {
  color: "#ffffff",
  background: "",
  outlineColor: "#000000",
  outlineWidth: 6,
  shadow: false,
  uppercase: true,
  bold: true,
  fontFamily: "Impact, 'Arial Black', sans-serif",
};

export function normalizeClip(clip, trackKind) {
  if (!clip || typeof clip !== "object") {
    return null;
  }
  const base = {
    id: cleanText(clip.id) || makeVideoId("clip"),
    timelineStartMs: Math.max(0, Math.round(cleanNumber(clip.timelineStartMs))),
    durationMs: Math.max(MIN_CLIP_DURATION_MS, Math.round(cleanNumber(clip.durationMs, 1000))),
  };
  if (trackKind === "text") {
    return {
      ...base,
      text: cleanText(clip.text) || "Text",
      style: normalizeTextStyle(clip.style),
      captionGroup: cleanText(clip.captionGroup),
    };
  }
  return {
    ...base,
    assetPath: cleanText(clip.assetPath),
    sourceInMs: Math.max(0, Math.round(cleanNumber(clip.sourceInMs))),
    speed: Math.min(8, Math.max(0.1, cleanNumber(clip.speed, 1))),
    gain: normalizeGain(clip.gain),
    transform: normalizeTransform(clip.transform),
    kf: normalizeKf(clip.kf),
    linkId: cleanText(clip.linkId),
  };
}

export function normalizeTrack(track, index = 0) {
  if (!track || typeof track !== "object") {
    return null;
  }
  const kind = VIDEO_TRACK_KINDS.includes(track.kind) ? track.kind : "video";
  const clips = (Array.isArray(track.clips) ? track.clips : [])
    .map((clip) => normalizeClip(clip, kind))
    .filter(Boolean)
    .sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  return {
    id: cleanText(track.id) || makeVideoId("track"),
    kind,
    label: cleanText(track.label) || `${kind.charAt(0).toUpperCase()}${index + 1}`,
    muted: track.muted === true,
    locked: track.locked === true,
    clips,
  };
}

export function makeStarterProject(name = "untitled") {
  return {
    version: VIDEO_PROJECT_VERSION,
    name,
    settings: { width: 1920, height: 1080, fps: 30, background: "#000000" },
    tracks: [
      { id: makeVideoId("track"), kind: "video", label: "V1", muted: false, locked: false, clips: [] },
      { id: makeVideoId("track"), kind: "audio", label: "A1", muted: false, locked: false, clips: [] },
      { id: makeVideoId("track"), kind: "text", label: "T1", muted: false, locked: false, clips: [] },
    ],
    updatedAtMs: 0,
  };
}

export function normalizeProject(project) {
  if (!project || typeof project !== "object") {
    return makeStarterProject();
  }
  const tracks = (Array.isArray(project.tracks) ? project.tracks : [])
    .map((track, index) => normalizeTrack(track, index))
    .filter(Boolean);
  return {
    version: VIDEO_PROJECT_VERSION,
    name: cleanText(project.name) || "untitled",
    settings: {
      width: Math.max(16, Math.round(cleanNumber(project.settings?.width, 1920))),
      height: Math.max(16, Math.round(cleanNumber(project.settings?.height, 1080))),
      fps: Math.min(240, Math.max(1, cleanNumber(project.settings?.fps, 30))),
      background: cleanText(project.settings?.background) || "#000000",
    },
    tracks: tracks.length ? tracks : makeStarterProject().tracks,
    updatedAtMs: Math.max(0, Math.round(cleanNumber(project.updatedAtMs))),
  };
}

export function clipEndMs(clip) {
  return clip.timelineStartMs + clip.durationMs;
}

export function projectDurationMs(project) {
  let end = 0;
  for (const track of project?.tracks || []) {
    for (const clip of track.clips || []) {
      end = Math.max(end, clipEndMs(clip));
    }
  }
  return end;
}

// Linear interpolation over gain keyframes; atMs relative to clip start.
// Before the first keyframe → first level; after the last → last level.
// No keyframes → flat gain.level.
export function gainAtMs(gain, atMs) {
  const normalized = normalizeGain(gain);
  const frames = normalized.keyframes;
  if (!frames.length) {
    return normalized.level;
  }
  if (atMs <= frames[0].atMs) {
    return frames[0].level;
  }
  const last = frames[frames.length - 1];
  if (atMs >= last.atMs) {
    return last.level;
  }
  for (let index = 0; index < frames.length - 1; index += 1) {
    const from = frames[index];
    const to = frames[index + 1];
    if (atMs >= from.atMs && atMs <= to.atMs) {
      const span = to.atMs - from.atMs;
      if (span <= 0) {
        return to.level;
      }
      const ratio = (atMs - from.atMs) / span;
      return from.level + (to.level - from.level) * ratio;
    }
  }
  return normalized.level;
}

function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

export function findClip(project, clipId) {
  for (const track of project?.tracks || []) {
    const clip = (track.clips || []).find((entry) => entry.id === clipId);
    if (clip) {
      return { track, clip };
    }
  }
  return null;
}

function updateClipIn(project, clipId, updater) {
  const next = cloneProject(project);
  const found = findClip(next, clipId);
  if (!found || found.track.locked) {
    return project;
  }
  updater(found.clip, found.track);
  found.track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  return next;
}

// First position ≥ startMs on a track where a clip of durationMs fits without
// overlapping. Timelines never overlap: colliding placements slide forward
// into the first gap (or after the last clip).
export function firstFreePositionOnTrack(track, startMs, durationMs, ignoreIds = []) {
  const ignore = new Set(ignoreIds);
  const clips = (track?.clips || [])
    .filter((clip) => !ignore.has(clip.id))
    .sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  let candidate = Math.max(0, Math.round(startMs));
  for (const clip of clips) {
    if (candidate + durationMs <= clip.timelineStartMs) {
      break; // fits in the gap before this clip
    }
    if (candidate < clipEndMs(clip)) {
      candidate = clipEndMs(clip);
    }
  }
  return candidate;
}

export function moveClip(project, clipId, timelineStartMs) {
  return updateClipIn(project, clipId, (clip, track) => {
    clip.timelineStartMs = firstFreePositionOnTrack(track, timelineStartMs, clip.durationMs, [clip.id]);
  });
}

// Group move: shift every listed clip by the same delta, clamped so the
// earliest one lands at 0 (relative spacing always survives). Collisions with
// clips outside the group push the whole group forward until nothing overlaps.
export function moveClips(project, clipIds, deltaMs) {
  const ids = Array.isArray(clipIds) ? clipIds.filter(Boolean) : [];
  if (!ids.length) {
    return project;
  }
  const next = cloneProject(project);
  const idSet = new Set(ids);
  const targets = [];
  for (const clipId of ids) {
    const found = findClip(next, clipId);
    if (found && !found.track.locked) {
      targets.push(found);
    }
  }
  if (!targets.length) {
    return project;
  }
  const minStart = Math.min(...targets.map((entry) => entry.clip.timelineStartMs));
  let applied = Math.max(Math.round(deltaMs), -minStart);
  for (let iteration = 0; iteration < 10; iteration += 1) {
    let push = 0;
    for (const { clip, track } of targets) {
      const proposed = clip.timelineStartMs + applied;
      for (const other of track.clips) {
        if (idSet.has(other.id)) {
          continue;
        }
        if (proposed < clipEndMs(other) && proposed + clip.durationMs > other.timelineStartMs) {
          push = Math.max(push, clipEndMs(other) - proposed);
        }
      }
    }
    if (!push) {
      break;
    }
    applied += push;
  }
  for (const { clip, track } of targets) {
    clip.timelineStartMs += applied;
    track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  }
  return next;
}

export function removeClips(project, clipIds) {
  const ids = new Set(Array.isArray(clipIds) ? clipIds : []);
  if (!ids.size) {
    return project;
  }
  const next = cloneProject(project);
  for (const track of next.tracks) {
    if (!track.locked) {
      track.clips = track.clips.filter((clip) => !ids.has(clip.id));
    }
  }
  return next;
}

// Ripple delete: remove the clip and slide every later clip on the SAME
// track left by its duration, closing the gap.
export function rippleDeleteClip(project, clipId) {
  const next = cloneProject(project);
  const found = findClip(next, clipId);
  if (!found || found.track.locked) {
    return project;
  }
  const { clip, track } = found;
  const start = clip.timelineStartMs;
  const gap = clip.durationMs;
  track.clips = track.clips.filter((entry) => entry.id !== clipId);
  for (const entry of track.clips) {
    if (entry.timelineStartMs >= start) {
      entry.timelineStartMs = Math.max(0, entry.timelineStartMs - gap);
    }
  }
  track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  return next;
}

// Candidate snap targets: timeline zero, every other clip's edges, and any
// extra points (playhead). Sorted, deduped.
export function collectSnapPoints(project, excludeClipIds = [], extraPoints = []) {
  const exclude = new Set(Array.isArray(excludeClipIds) ? excludeClipIds : []);
  const points = new Set([0]);
  for (const point of extraPoints) {
    if (Number.isFinite(Number(point))) {
      points.add(Math.max(0, Math.round(Number(point))));
    }
  }
  for (const track of project?.tracks || []) {
    for (const clip of track.clips || []) {
      if (exclude.has(clip.id)) {
        continue;
      }
      points.add(clip.timelineStartMs);
      points.add(clipEndMs(clip));
    }
  }
  return [...points].sort((a, b) => a - b);
}

// Snap a proposed position to the nearest candidate within the threshold.
export function snapMs(proposedMs, snapPoints, thresholdMs) {
  let best = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const point of snapPoints || []) {
    const distance = Math.abs(point - proposedMs);
    if (distance < bestDistance) {
      best = point;
      bestDistance = distance;
    }
  }
  return best != null && bestDistance <= thresholdMs ? best : Math.round(proposedMs);
}

// Move a clip to another track of the same media family (video/audio share the
// clip shape; text clips only move between text tracks).
export function moveClipToTrack(project, clipId, targetTrackId, timelineStartMs) {
  const next = cloneProject(project);
  const found = findClip(next, clipId);
  const target = (next.tracks || []).find((track) => track.id === targetTrackId);
  if (!found || !target || found.track.locked || target.locked) {
    return project;
  }
  const sourceIsText = found.track.kind === "text";
  const targetIsText = target.kind === "text";
  if (sourceIsText !== targetIsText) {
    return project;
  }
  found.track.clips = found.track.clips.filter((clip) => clip.id !== clipId);
  found.clip.timelineStartMs = firstFreePositionOnTrack(
    target,
    timelineStartMs,
    found.clip.durationMs,
    [clipId],
  );
  target.clips.push(found.clip);
  target.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  return next;
}

// Trim the left edge: shifts timeline start and source-in together so the
// visible content stays anchored. deltaMs > 0 cuts material away. deltaMs is
// timeline time; source-in advances by deltaMs * speed (media time).
export function trimClipStart(project, clipId, deltaMs) {
  return updateClipIn(project, clipId, (clip) => {
    const speed = clip.speed || 1;
    const maxDelta = clip.durationMs - MIN_CLIP_DURATION_MS;
    const minDelta = -clip.timelineStartMs;
    const sourceFloor = clip.sourceInMs != null ? -(clip.sourceInMs / speed) : minDelta;
    const applied = Math.min(maxDelta, Math.max(Math.max(minDelta, sourceFloor), Math.round(deltaMs)));
    clip.timelineStartMs += applied;
    clip.durationMs -= applied;
    if (clip.sourceInMs != null) {
      clip.sourceInMs = Math.max(0, Math.round(clip.sourceInMs + applied * speed));
    }
  });
}

export function trimClipEnd(project, clipId, deltaMs) {
  return updateClipIn(project, clipId, (clip) => {
    clip.durationMs = Math.max(MIN_CLIP_DURATION_MS, clip.durationMs + Math.round(deltaMs));
  });
}

// Easing of the keyframe segment that spans an offset (drives boundary
// keyframes when cutting: a held segment must stay held on both sides).
function spanningEasing(frames, offset) {
  let easing = "linear";
  for (const frame of frames) {
    if (frame.atMs <= offset) {
      easing = frame.easing || "linear";
    } else {
      break;
    }
  }
  return easing;
}

// Partition a media clip's envelopes (gain + property keyframes) at a
// clip-relative offset, mutating `left` and `right` so each half renders
// identically to the uncut clip.
function partitionEnvelopesAt(left, right, offset) {
  const gainFrames = normalizeGain(left.gain).keyframes;
  if (gainFrames.length) {
    const cutLevel = gainAtMs(left.gain, offset);
    left.gain.keyframes = gainFrames
      .filter((frame) => frame.atMs < offset)
      .concat([{ atMs: offset, level: cutLevel }]);
    if (right) {
      right.gain.keyframes = [{ atMs: 0, level: cutLevel }].concat(
        gainFrames
          .filter((frame) => frame.atMs > offset)
          .map((frame) => ({ atMs: frame.atMs - offset, level: frame.level })),
      );
    }
  }
  const kf = normalizeKf(left.kf);
  for (const prop of VIDEO_KF_PROPS) {
    const propFrames = kf[prop];
    if (!propFrames?.length) {
      continue;
    }
    const cutValue = kfValueAtMs(propFrames, offset, propFrames[0].value);
    const easing = spanningEasing(propFrames, offset);
    left.kf[prop] = propFrames
      .filter((frame) => frame.atMs < offset)
      .concat([{ atMs: offset, value: cutValue, easing }]);
    if (right) {
      right.kf[prop] = [{ atMs: 0, value: cutValue, easing }].concat(
        propFrames
          .filter((frame) => frame.atMs > offset)
          .map((frame) => ({ ...frame, atMs: frame.atMs - offset })),
      );
    }
  }
}

// Rebase a clip's envelopes to start `cutMs` into the original (tail slices
// in ripple deletes): boundary values sampled at the cut, later frames shift.
function rebaseEnvelopesFrom(clip, cutMs) {
  const gainFrames = normalizeGain(clip.gain).keyframes;
  if (gainFrames.length) {
    const cutLevel = gainAtMs(clip.gain, cutMs);
    clip.gain.keyframes = [{ atMs: 0, level: cutLevel }].concat(
      gainFrames
        .filter((frame) => frame.atMs > cutMs)
        .map((frame) => ({ atMs: frame.atMs - cutMs, level: frame.level })),
    );
  }
  const kf = normalizeKf(clip.kf);
  for (const prop of VIDEO_KF_PROPS) {
    const propFrames = kf[prop];
    if (!propFrames?.length) {
      continue;
    }
    const cutValue = kfValueAtMs(propFrames, cutMs, propFrames[0].value);
    const easing = spanningEasing(propFrames, cutMs);
    clip.kf[prop] = [{ atMs: 0, value: cutValue, easing }].concat(
      propFrames
        .filter((frame) => frame.atMs > cutMs)
        .map((frame) => ({ ...frame, atMs: frame.atMs - cutMs })),
    );
  }
}

// Split one clip into two at an absolute timeline position. Envelopes are
// partitioned with boundary sampling; the right half is UNLINKED (linked
// splits go through splitLinkedAt, which relinks the halves as a new group).
// Returns { project, rightId } — rightId "" when the split was rejected.
function splitClipCore(project, clipId, atTimelineMs) {
  const next = cloneProject(project);
  const found = findClip(next, clipId);
  if (!found || found.track.locked) {
    return { project, rightId: "" };
  }
  const { clip, track } = found;
  const offset = Math.round(atTimelineMs) - clip.timelineStartMs;
  if (offset < MIN_CLIP_DURATION_MS || offset > clip.durationMs - MIN_CLIP_DURATION_MS) {
    return { project, rightId: "" };
  }
  const right = JSON.parse(JSON.stringify(clip));
  right.id = makeVideoId("clip");
  right.timelineStartMs = clip.timelineStartMs + offset;
  right.durationMs = clip.durationMs - offset;
  clip.durationMs = offset;
  if (track.kind !== "text") {
    right.sourceInMs = (clip.sourceInMs || 0) + Math.round(offset * (clip.speed || 1));
    right.linkId = "";
    partitionEnvelopesAt(clip, right, offset);
  }
  track.clips.push(right);
  track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  return { project: next, rightId: right.id };
}

export function splitClip(project, clipId, atTimelineMs) {
  return splitClipCore(project, clipId, atTimelineMs).project;
}

// --- Linked A/V clips ------------------------------------------------------

let linkIdSeq = 0;

export function linkedClipIds(project, clipId) {
  const found = findClip(project, clipId);
  const linkId = found?.clip?.linkId;
  if (!linkId) {
    return [clipId];
  }
  const ids = [];
  for (const track of project?.tracks || []) {
    for (const clip of track.clips || []) {
      if (clip.linkId === linkId) {
        ids.push(clip.id);
      }
    }
  }
  return ids.length ? ids : [clipId];
}

// Expand a selection with every linked partner (agent edits and UI actions
// operate on whole link groups unless explicitly unlinked).
export function expandWithLinks(project, clipIds) {
  const expanded = new Set();
  for (const clipId of Array.isArray(clipIds) ? clipIds : []) {
    for (const id of linkedClipIds(project, clipId)) {
      expanded.add(id);
    }
  }
  return [...expanded];
}

export function linkClips(project, clipIds) {
  const ids = Array.isArray(clipIds) ? clipIds.filter(Boolean) : [];
  if (ids.length < 2) {
    return project;
  }
  const next = cloneProject(project);
  linkIdSeq += 1;
  const linkId = `link-${Date.now().toString(36)}-${linkIdSeq}`;
  let touched = 0;
  for (const clipId of ids) {
    const found = findClip(next, clipId);
    if (found && found.track.kind !== "text" && !found.track.locked) {
      found.clip.linkId = linkId;
      touched += 1;
    }
  }
  return touched >= 2 ? next : project;
}

export function unlinkClip(project, clipId) {
  const next = cloneProject(project);
  const ids = linkedClipIds(next, clipId);
  if (ids.length < 2) {
    return project;
  }
  for (const id of ids) {
    const found = findClip(next, id);
    if (found) {
      found.clip.linkId = "";
    }
  }
  return next;
}

// Split a clip AND its linked partners at the same timeline instant; the
// right-hand halves get a fresh shared link id.
export function splitLinkedAt(project, clipId, atTimelineMs) {
  const ids = expandWithLinks(project, [clipId]);
  let next = project;
  const rightIds = [];
  for (const id of ids) {
    const result = splitClipCore(next, id, atTimelineMs);
    next = result.project;
    if (result.rightId) {
      rightIds.push(result.rightId);
    }
  }
  if (rightIds.length >= 2) {
    next = linkClips(next, rightIds);
  }
  return next;
}

// --- Property keyframe ops -------------------------------------------------

export function setClipKeyframe(project, clipId, prop, atMs, value, easing = "linear") {
  if (!VIDEO_KF_PROPS.includes(prop)) {
    return project;
  }
  return updateClipIn(project, clipId, (clip, track) => {
    if (track.kind === "text") {
      return;
    }
    const at = Math.max(0, Math.min(Math.round(atMs), clip.durationMs));
    const frames = (clip.kf?.[prop] || []).filter((frame) => Math.abs(frame.atMs - at) > 16);
    frames.push({ atMs: at, value, easing });
    clip.kf = normalizeKf({ ...clip.kf, [prop]: frames });
  });
}

export function removeClipKeyframe(project, clipId, prop, atMs) {
  return updateClipIn(project, clipId, (clip, track) => {
    if (track.kind === "text" || !clip.kf?.[prop]) {
      return;
    }
    const frames = clip.kf[prop].filter((frame) => Math.abs(frame.atMs - Math.round(atMs)) > 16);
    clip.kf = normalizeKf({ ...clip.kf, [prop]: frames });
  });
}

export function clearClipKeyframes(project, clipId, prop) {
  return updateClipIn(project, clipId, (clip, track) => {
    if (track.kind === "text") {
      return;
    }
    if (prop) {
      const nextKf = { ...clip.kf };
      delete nextKf[prop];
      clip.kf = normalizeKf(nextKf);
    } else {
      clip.kf = {};
    }
  });
}

// --- Clipboard --------------------------------------------------------------

export function serializeClips(project, clipIds) {
  const entries = [];
  let baseMs = Number.POSITIVE_INFINITY;
  for (const clipId of expandWithLinks(project, clipIds)) {
    const found = findClip(project, clipId);
    if (found) {
      entries.push({ trackKind: found.track.kind, clip: JSON.parse(JSON.stringify(found.clip)) });
      baseMs = Math.min(baseMs, found.clip.timelineStartMs);
    }
  }
  if (!entries.length) {
    return null;
  }
  return { kind: "diffforge-video-clips", baseMs, entries };
}

export function pasteClips(project, payload, atMs) {
  if (payload?.kind !== "diffforge-video-clips" || !Array.isArray(payload.entries) || !payload.entries.length) {
    return { project, clipIds: [] };
  }
  let next = cloneProject(project);
  const offset = Math.round(atMs) - (Number(payload.baseMs) || 0);
  const linkMap = new Map();
  const newIds = [];
  for (const entry of payload.entries) {
    const kind = VIDEO_TRACK_KINDS.includes(entry.trackKind) ? entry.trackKind : "video";
    let track = next.tracks.find((candidate) => candidate.kind === kind && !candidate.locked);
    if (!track) {
      next = addTrack(next, kind);
      track = next.tracks[next.tracks.length - 1];
    }
    const clip = normalizeClip(
      {
        ...entry.clip,
        id: makeVideoId("clip"),
        timelineStartMs: firstFreePositionOnTrack(
          track,
          Math.max(0, (entry.clip.timelineStartMs || 0) + offset),
          Math.max(MIN_CLIP_DURATION_MS, Math.round(entry.clip.durationMs || MIN_CLIP_DURATION_MS)),
        ),
      },
      kind,
    );
    if (clip.linkId) {
      if (!linkMap.has(clip.linkId)) {
        linkIdSeq += 1;
        linkMap.set(clip.linkId, `link-${Date.now().toString(36)}-p${linkIdSeq}`);
      }
      clip.linkId = linkMap.get(clip.linkId);
    }
    track.clips.push(clip);
    track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
    newIds.push(clip.id);
  }
  return { project: next, clipIds: newIds };
}

// --- Select forward / ripple family -----------------------------------------

export function clipIdsFromMs(project, fromMs, trackId = "") {
  const ids = [];
  for (const track of project?.tracks || []) {
    if (trackId && track.id !== trackId) {
      continue;
    }
    for (const clip of track.clips || []) {
      if (clipEndMs(clip) > fromMs) {
        ids.push(clip.id);
      }
    }
  }
  return ids;
}

// Ripple trim: trim an edge without opening a gap. The trimmed clip stays
// anchored at its original start (start-edge trims change the in-point, not
// the position), and everything after the clip's ORIGINAL end slides by the
// duration change — on the clip's track and its linked partners' tracks.
export function rippleTrim(project, clipId, edge, deltaMs) {
  const before = findClip(project, clipId);
  if (!before) {
    return project;
  }
  const beforeDuration = before.clip.durationMs;
  const beforeEnd = clipEndMs(before.clip);
  const affectedIds = expandWithLinks(project, [clipId]);
  const originalStarts = new Map();
  for (const id of affectedIds) {
    const found = findClip(project, id);
    if (found) {
      originalStarts.set(id, found.clip.timelineStartMs);
    }
  }
  let next = project;
  for (const id of affectedIds) {
    next = edge === "start" ? trimClipStart(next, id, deltaMs) : trimClipEnd(next, id, deltaMs);
  }
  const after = findClip(next, clipId);
  if (!after || next === project) {
    return project;
  }
  const durationDelta = after.clip.durationMs - beforeDuration;
  const cloned = cloneProject(next);
  const trackIds = new Set();
  for (const id of affectedIds) {
    const found = findClip(cloned, id);
    if (found) {
      trackIds.add(found.track.id);
    }
  }
  if (edge === "start") {
    // Re-anchor the trimmed clips: the in-point moved, the position must not.
    for (const id of affectedIds) {
      const found = findClip(cloned, id);
      if (found && originalStarts.has(id)) {
        found.clip.timelineStartMs = originalStarts.get(id);
      }
    }
  }
  if (durationDelta) {
    for (const track of cloned.tracks) {
      if (!trackIds.has(track.id) || track.locked) {
        continue;
      }
      for (const clip of track.clips) {
        if (!affectedIds.includes(clip.id) && clip.timelineStartMs >= beforeEnd) {
          clip.timelineStartMs = Math.max(0, clip.timelineStartMs + durationDelta);
        }
      }
      track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
    }
  }
  return cloned;
}

// Ripple delete a time range across all (or given) unlocked tracks: clips
// fully inside vanish, straddling clips get trimmed/split, and everything
// after slides left to close the gap.
export function rippleDeleteRange(project, startMs, endMs, trackIds = null) {
  const from = Math.max(0, Math.round(startMs));
  const to = Math.max(from, Math.round(endMs));
  const gap = to - from;
  if (!gap) {
    return project;
  }
  const affected = trackIds ? new Set(trackIds) : null;
  const next = cloneProject(project);
  for (const track of next.tracks) {
    if (track.locked || (affected && !affected.has(track.id))) {
      continue;
    }
    const kept = [];
    for (const clip of track.clips) {
      const start = clip.timelineStartMs;
      const end = clipEndMs(clip);
      if (end <= from) {
        kept.push(clip);
        continue;
      }
      if (start >= to) {
        clip.timelineStartMs = Math.max(0, start - gap);
        kept.push(clip);
        continue;
      }
      // Overlapping: keep the head before the range and/or the tail after it,
      // slicing gain/property envelopes at the cuts so both fragments render
      // exactly like the uncut clip did.
      if (start < from) {
        const head = JSON.parse(JSON.stringify(clip));
        head.durationMs = from - start;
        if (head.durationMs >= MIN_CLIP_DURATION_MS) {
          if (track.kind !== "text") {
            partitionEnvelopesAt(head, null, head.durationMs);
          }
          kept.push(normalizeClip(head, track.kind));
        }
      }
      if (end > to) {
        const tail = JSON.parse(JSON.stringify(clip));
        const cut = to - start;
        tail.id = makeVideoId("clip");
        tail.timelineStartMs = from;
        tail.durationMs = end - to;
        if (track.kind !== "text") {
          tail.sourceInMs = (clip.sourceInMs || 0) + Math.round(cut * (clip.speed || 1));
          rebaseEnvelopesFrom(tail, cut);
          tail.linkId = "";
        }
        if (tail.durationMs >= MIN_CLIP_DURATION_MS) {
          kept.push(normalizeClip(tail, track.kind));
        }
      }
    }
    track.clips = kept.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  }
  return next;
}

// Insert a gap (ripple insert): everything at/after atMs slides right;
// straddling clips are split first so the gap opens cleanly.
export function rippleInsertGap(project, atMs, gapMs, trackIds = null) {
  const at = Math.max(0, Math.round(atMs));
  const gap = Math.max(0, Math.round(gapMs));
  if (!gap) {
    return project;
  }
  const affected = trackIds ? new Set(trackIds) : null;
  let next = cloneProject(project);
  for (const track of next.tracks) {
    if (track.locked || (affected && !affected.has(track.id))) {
      continue;
    }
    for (const clip of [...track.clips]) {
      if (clip.timelineStartMs < at && clipEndMs(clip) > at) {
        next = splitClip(next, clip.id, at);
      }
    }
  }
  for (const track of next.tracks) {
    if (track.locked || (affected && !affected.has(track.id))) {
      continue;
    }
    for (const clip of track.clips) {
      if (clip.timelineStartMs >= at) {
        clip.timelineStartMs += gap;
      }
    }
    track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  }
  return next;
}

// --- Captions from transcripts ----------------------------------------------

export const CAPTION_TEXT_STYLE = {
  fontSize: 34,
  color: "#ffffff",
  background: "rgba(0, 0, 0, 0.55)",
  x: 0.5,
  y: 0.92,
  align: "center",
  bold: true,
  fontFamily: "sans-serif",
};

function splitCaptionText(segment, maxChars) {
  const words = Array.isArray(segment.words) && segment.words.length
    ? segment.words
    : String(segment.text || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((text, index, all) => {
          const span = segment.endMs - segment.startMs;
          return {
            text,
            startMs: segment.startMs + Math.round((span * index) / all.length),
            endMs: segment.startMs + Math.round((span * (index + 1)) / all.length),
          };
        });
  const chunks = [];
  let current = null;
  for (const word of words) {
    const text = String(word.text || "").trim();
    if (!text) {
      continue;
    }
    if (!current || `${current.text} ${text}`.length > maxChars) {
      current = { text, startMs: word.startMs, endMs: word.endMs };
      chunks.push(current);
    } else {
      current.text = `${current.text} ${text}`;
      current.endMs = word.endMs;
    }
  }
  return chunks;
}

// Build caption text clips for a media clip from its asset's transcript.
// Source times map to the timeline through the clip's trim + speed; captions
// outside the clip's visible window are dropped. Existing captions for the
// same group are replaced. Returns { project, count, trackId }.
export function addCaptionsForClip(project, clipId, segments, { maxChars = 42, style = {} } = {}) {
  const found = findClip(project, clipId);
  if (!found || found.track.kind === "text") {
    return { project, count: 0, trackId: "" };
  }
  const { clip } = found;
  const speed = clip.speed || 1;
  const sourceFrom = clip.sourceInMs || 0;
  const sourceTo = sourceFrom + clip.durationMs * speed;
  const captionGroup = `cap-${clip.id}`;
  let next = cloneProject(project);
  // Replace previous captions for this clip.
  for (const track of next.tracks) {
    if (track.kind === "text") {
      track.clips = track.clips.filter((entry) => entry.captionGroup !== captionGroup);
    }
  }
  let track = next.tracks.find((entry) => entry.kind === "text" && entry.label === "Captions" && !entry.locked);
  if (!track) {
    next = addTrack(next, "text");
    track = next.tracks[next.tracks.length - 1];
    track.label = "Captions";
  }
  let count = 0;
  for (const segment of Array.isArray(segments) ? segments : []) {
    if (segment.endMs <= sourceFrom || segment.startMs >= sourceTo) {
      continue;
    }
    for (const chunk of splitCaptionText(segment, maxChars)) {
      const startSrc = Math.max(chunk.startMs, sourceFrom);
      const endSrc = Math.min(chunk.endMs, sourceTo);
      if (endSrc - startSrc < 80) {
        continue;
      }
      const timelineStart = clip.timelineStartMs + Math.round((startSrc - sourceFrom) / speed);
      const durationMs = Math.max(MIN_CLIP_DURATION_MS, Math.round((endSrc - startSrc) / speed));
      track.clips.push(
        normalizeClip(
          {
            id: makeVideoId("cap"),
            text: chunk.text,
            timelineStartMs: timelineStart,
            durationMs,
            style: { ...CAPTION_TEXT_STYLE, ...style },
            captionGroup,
          },
          "text",
        ),
      );
      count += 1;
    }
  }
  track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  return { project: next, count, trackId: track.id };
}

// Remove transcript words from the cut: turns the words' source spans into
// timeline ranges via every clip using that asset, merges adjacent ranges,
// and ripple-deletes them. The AI-native "delete the umms" primitive.
export function rippleDeleteWords(project, assetPath, words, { mergeGapMs = 120 } = {}) {
  const spans = (Array.isArray(words) ? words : [])
    .filter((word) => Number.isFinite(Number(word?.startMs)) && Number.isFinite(Number(word?.endMs)))
    .map((word) => ({ startMs: Math.round(word.startMs), endMs: Math.round(word.endMs) }))
    .sort((a, b) => a.startMs - b.startMs);
  if (!spans.length) {
    return { project, ranges: [] };
  }
  const merged = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.startMs - last.endMs <= mergeGapMs) {
      last.endMs = Math.max(last.endMs, span.endMs);
    } else {
      merged.push({ ...span });
    }
  }
  // Map source spans to timeline ranges through every clip of this asset.
  const timelineRanges = [];
  for (const track of project?.tracks || []) {
    for (const clip of track.clips || []) {
      if (clip.assetPath !== assetPath) {
        continue;
      }
      const speed = clip.speed || 1;
      const sourceFrom = clip.sourceInMs || 0;
      const sourceTo = sourceFrom + clip.durationMs * speed;
      for (const span of merged) {
        const from = Math.max(span.startMs, sourceFrom);
        const to = Math.min(span.endMs, sourceTo);
        if (to - from < 40) {
          continue;
        }
        timelineRanges.push({
          startMs: clip.timelineStartMs + Math.round((from - sourceFrom) / speed),
          endMs: clip.timelineStartMs + Math.round((to - sourceFrom) / speed),
        });
      }
    }
  }
  timelineRanges.sort((a, b) => a.startMs - b.startMs);
  // Delete back-to-front so earlier ranges stay valid.
  let next = project;
  for (let index = timelineRanges.length - 1; index >= 0; index -= 1) {
    next = rippleDeleteRange(next, timelineRanges[index].startMs, timelineRanges[index].endMs);
  }
  return { project: next, ranges: timelineRanges };
}

export function removeClip(project, clipId) {
  const next = cloneProject(project);
  const found = findClip(next, clipId);
  if (!found || found.track.locked) {
    return project;
  }
  found.track.clips = found.track.clips.filter((clip) => clip.id !== clipId);
  return next;
}

export function addTrack(project, kind) {
  const next = cloneProject(project);
  const safeKind = VIDEO_TRACK_KINDS.includes(kind) ? kind : "video";
  const count = next.tracks.filter((track) => track.kind === safeKind).length;
  const prefix = safeKind === "video" ? "V" : safeKind === "audio" ? "A" : "T";
  next.tracks.push({
    id: makeVideoId("track"),
    kind: safeKind,
    label: `${prefix}${count + 1}`,
    muted: false,
    locked: false,
    clips: [],
  });
  return next;
}

export function removeTrack(project, trackId) {
  const next = cloneProject(project);
  next.tracks = next.tracks.filter((track) => track.id !== trackId);
  if (!next.tracks.length) {
    next.tracks = makeStarterProject().tracks;
  }
  return next;
}

// Reorder a track (track order = compositing order for video, stacking for UI).
export function moveTrackTo(project, trackId, toIndex) {
  const next = cloneProject(project);
  const fromIndex = next.tracks.findIndex((track) => track.id === trackId);
  if (fromIndex < 0) {
    return project;
  }
  const clamped = Math.max(0, Math.min(next.tracks.length - 1, Math.round(toIndex)));
  if (clamped === fromIndex) {
    return project;
  }
  const [track] = next.tracks.splice(fromIndex, 1);
  next.tracks.splice(clamped, 0, track);
  return next;
}

export function updateTrack(project, trackId, patch) {
  const next = cloneProject(project);
  const track = next.tracks.find((entry) => entry.id === trackId);
  if (!track) {
    return project;
  }
  if (typeof patch?.label === "string" && patch.label.trim()) {
    track.label = patch.label.trim();
  }
  if (typeof patch?.muted === "boolean") {
    track.muted = patch.muted;
  }
  if (typeof patch?.locked === "boolean") {
    track.locked = patch.locked;
  }
  return next;
}

export function updateClip(project, clipId, patch) {
  return updateClipIn(project, clipId, (clip, track) => {
    if (track.kind === "text") {
      if (typeof patch?.text === "string") {
        clip.text = patch.text;
      }
      if (patch?.style && typeof patch.style === "object") {
        clip.style = normalizeTextStyle({ ...clip.style, ...patch.style });
      }
    } else {
      if (patch?.gain && typeof patch.gain === "object") {
        clip.gain = normalizeGain({ ...clip.gain, ...patch.gain });
      }
      if (patch?.transform && typeof patch.transform === "object") {
        clip.transform = normalizeTransform({ ...clip.transform, ...patch.transform });
      }
      if (Number.isFinite(Number(patch?.speed))) {
        clip.speed = Math.min(8, Math.max(0.1, Number(patch.speed)));
      }
    }
    if (Number.isFinite(Number(patch?.timelineStartMs))) {
      clip.timelineStartMs = Math.max(0, Math.round(Number(patch.timelineStartMs)));
    }
    if (Number.isFinite(Number(patch?.durationMs))) {
      clip.durationMs = Math.max(MIN_CLIP_DURATION_MS, Math.round(Number(patch.durationMs)));
    }
  });
}

// Insert a media asset as a clip. Video/image assets land on a video track,
// audio assets on an audio track; creates a track when none exists or when the
// preferred track is locked. Placement never overlaps (slides into the first
// free gap at/after the requested position). A video WITH audio also gets a
// LINKED audio clip on an audio track so its sound is editable separately —
// the video clip itself is muted (the audio lives on the partner clip).
export function addMediaClip(project, asset, { trackId = "", timelineStartMs = 0, linkAudio = true } = {}) {
  const isAudio = asset?.kind === "audio";
  const wantedKind = isAudio ? "audio" : "video";
  let next = cloneProject(project);
  let track = next.tracks.find((entry) => entry.id === trackId && entry.kind === wantedKind && !entry.locked);
  if (!track) {
    track = next.tracks.find((entry) => entry.kind === wantedKind && !entry.locked);
  }
  if (!track) {
    next = addTrack(next, wantedKind);
    track = next.tracks[next.tracks.length - 1];
  }
  const fallbackDuration = asset?.kind === "image" ? 4000 : 3000;
  const durationMs = Math.max(MIN_CLIP_DURATION_MS, Math.round(cleanNumber(asset?.durationMs, fallbackDuration)));
  const wantsLinkedAudio = linkAudio && asset?.kind === "video" && asset?.hasAudio === true;
  const startMs = firstFreePositionOnTrack(track, timelineStartMs, durationMs);
  const clip = normalizeClip(
    {
      id: makeVideoId("clip"),
      assetPath: asset?.path || "",
      timelineStartMs: startMs,
      durationMs,
      sourceInMs: 0,
      speed: 1,
      // Muted when a linked audio partner carries the sound.
      gain: wantsLinkedAudio ? { level: 0, keyframes: [] } : undefined,
    },
    track.kind,
  );
  track.clips.push(clip);
  track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  let audioClipId = "";
  if (wantsLinkedAudio) {
    // The audio partner must sit at the SAME start (A/V sync) — pick the
    // first unlocked audio track with that slot free, else add one.
    let audioTrack = next.tracks.find(
      (entry) =>
        entry.kind === "audio"
        && !entry.locked
        && firstFreePositionOnTrack(entry, startMs, durationMs) === startMs,
    );
    if (!audioTrack) {
      next = addTrack(next, "audio");
      audioTrack = next.tracks[next.tracks.length - 1];
      // addTrack cloned the project — refind the video clip's track reference.
      track = next.tracks.find((entry) => entry.id === track.id) || track;
    }
    const audioClip = normalizeClip(
      {
        id: makeVideoId("clip"),
        assetPath: asset?.path || "",
        timelineStartMs: startMs,
        durationMs,
        sourceInMs: 0,
        speed: 1,
      },
      "audio",
    );
    audioTrack.clips.push(audioClip);
    audioTrack.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
    audioClipId = audioClip.id;
    linkIdSeq += 1;
    const linkId = `link-${Date.now().toString(36)}-av${linkIdSeq}`;
    const videoRef = findClip(next, clip.id);
    const audioRef = findClip(next, audioClip.id);
    if (videoRef && audioRef) {
      videoRef.clip.linkId = linkId;
      audioRef.clip.linkId = linkId;
    }
  }
  return { project: next, clipId: clip.id, trackId: track.id, audioClipId };
}

export function addTextClip(project, { trackId = "", timelineStartMs = 0, text = "Text" } = {}) {
  let next = cloneProject(project);
  let track = next.tracks.find((entry) => entry.id === trackId && entry.kind === "text" && !entry.locked);
  if (!track) {
    track = next.tracks.find((entry) => entry.kind === "text" && !entry.locked);
  }
  if (!track) {
    next = addTrack(next, "text");
    track = next.tracks[next.tracks.length - 1];
  }
  const clip = normalizeClip(
    { id: makeVideoId("clip"), text, timelineStartMs: Math.max(0, Math.round(timelineStartMs)), durationMs: 2400 },
    "text",
  );
  track.clips.push(clip);
  track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  return { project: next, clipId: clip.id, trackId: track.id };
}

// Clips overlapping [startMs, endMs) on any track — drives range-scoped AI
// context and range operations.
export function clipsInRange(project, startMs, endMs) {
  const result = [];
  for (const track of project?.tracks || []) {
    for (const clip of track.clips || []) {
      if (clip.timelineStartMs < endMs && clipEndMs(clip) > startMs) {
        result.push({ track, clip });
      }
    }
  }
  return result;
}

// Clips under the playhead per track kind — drives the preview compositor.
export function clipsAtMs(project, atMs) {
  const result = { video: [], audio: [], text: [] };
  for (const track of project?.tracks || []) {
    if (track.muted) {
      continue;
    }
    for (const clip of track.clips || []) {
      if (atMs >= clip.timelineStartMs && atMs < clipEndMs(clip)) {
        result[track.kind]?.push({ track, clip });
      }
    }
  }
  return result;
}

export function formatTimecode(ms, { withMs = false } = {}) {
  const safe = Math.max(0, Math.round(cleanNumber(ms)));
  const totalSeconds = Math.floor(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  const mm = String(minutes % 60).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const base = hours > 0 ? `${hours}:${mm}:${ss}` : `${minutes}:${ss}`;
  if (!withMs) {
    return base;
  }
  const millis = String(safe % 1000).padStart(3, "0");
  return `${base}.${millis}`;
}

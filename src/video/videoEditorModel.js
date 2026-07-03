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
  };
}

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
    };
  }
  return {
    ...base,
    assetPath: cleanText(clip.assetPath),
    sourceInMs: Math.max(0, Math.round(cleanNumber(clip.sourceInMs))),
    speed: Math.min(8, Math.max(0.1, cleanNumber(clip.speed, 1))),
    gain: normalizeGain(clip.gain),
    transform: normalizeTransform(clip.transform),
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

export function moveClip(project, clipId, timelineStartMs) {
  return updateClipIn(project, clipId, (clip) => {
    clip.timelineStartMs = Math.max(0, Math.round(timelineStartMs));
  });
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
  found.clip.timelineStartMs = Math.max(0, Math.round(timelineStartMs));
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

// Split one clip into two at an absolute timeline position. Gain keyframes are
// partitioned so each half keeps the envelope it had, with boundary values
// sampled at the cut so the ramp is preserved exactly.
export function splitClip(project, clipId, atTimelineMs) {
  const next = cloneProject(project);
  const found = findClip(next, clipId);
  if (!found || found.track.locked) {
    return project;
  }
  const { clip, track } = found;
  const offset = Math.round(atTimelineMs) - clip.timelineStartMs;
  if (offset < MIN_CLIP_DURATION_MS || offset > clip.durationMs - MIN_CLIP_DURATION_MS) {
    return project;
  }
  const right = JSON.parse(JSON.stringify(clip));
  right.id = makeVideoId("clip");
  right.timelineStartMs = clip.timelineStartMs + offset;
  right.durationMs = clip.durationMs - offset;
  clip.durationMs = offset;
  if (track.kind !== "text") {
    right.sourceInMs = (clip.sourceInMs || 0) + Math.round(offset * (clip.speed || 1));
    const frames = normalizeGain(clip.gain).keyframes;
    if (frames.length) {
      const cutLevel = gainAtMs(clip.gain, offset);
      clip.gain.keyframes = frames
        .filter((frame) => frame.atMs < offset)
        .concat([{ atMs: offset, level: cutLevel }]);
      right.gain.keyframes = [{ atMs: 0, level: cutLevel }].concat(
        frames
          .filter((frame) => frame.atMs > offset)
          .map((frame) => ({ atMs: frame.atMs - offset, level: frame.level })),
      );
    }
  }
  track.clips.push(right);
  track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  return next;
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
// preferred track is locked.
export function addMediaClip(project, asset, { trackId = "", timelineStartMs = 0 } = {}) {
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
  const clip = normalizeClip(
    {
      id: makeVideoId("clip"),
      assetPath: asset?.path || "",
      timelineStartMs: Math.max(0, Math.round(timelineStartMs)),
      durationMs: Math.max(MIN_CLIP_DURATION_MS, Math.round(cleanNumber(asset?.durationMs, fallbackDuration))),
      sourceInMs: 0,
      speed: 1,
    },
    track.kind,
  );
  track.clips.push(clip);
  track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  return { project: next, clipId: clip.id, trackId: track.id };
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

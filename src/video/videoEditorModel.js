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
export const RIPPLE_DELETE_WORDS_MERGE_GAP_MS = 120;

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
export const VIDEO_KF_EASINGS = ["linear", "hold", "smooth", "ease-in", "ease-out", "ease-in-out"];

// Cubic-bezier easing (CSS-style control points, P0=(0,0), P3=(1,1)).
// Evaluation MUST stay in exact parity with the Rust mirror (see
// docs/tier1-contract-2026-07-10.md §3): solve x(u)=t with 20 bisection
// iterations, return y(u). Fixture values are asserted on both sides.
const VIDEO_KF_BEZIERS = {
  "ease-in": [0.42, 0, 1, 1],
  "ease-out": [0, 0, 0.58, 1],
  "ease-in-out": [0.42, 0, 0.58, 1],
};

export function cubicBezierEase(easing, t) {
  const points = VIDEO_KF_BEZIERS[easing];
  if (!points || t <= 0) {
    return Math.max(0, Math.min(1, t));
  }
  if (t >= 1) {
    return 1;
  }
  const [p1x, p1y, p2x, p2y] = points;
  const sample = (coord1, coord2, u) =>
    3 * (1 - u) * (1 - u) * u * coord1 + 3 * (1 - u) * u * u * coord2 + u * u * u;
  let lo = 0;
  let hi = 1;
  for (let index = 0; index < 20; index += 1) {
    const mid = (lo + hi) / 2;
    if (sample(p1x, p2x, mid) < t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return sample(p1y, p2y, (lo + hi) / 2);
}

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

// ---------------------------------------------------------------------------
// Motion presets — tasteful still-image (and video) movement compiled into
// the EXISTING transform + x/y/scale keyframes, so preview and export need no
// new render paths. Aspect-aware: the base scale includes the cover ratio
// (media is contain-fitted by default, and Ken Burns over letterbox bars
// looks broken), and pan amplitudes clamp so an edge can never slide into
// frame. KEEP IN SYNC with the Rust mirror in src-tauri/src/video_editor.rs
// (video_mcp_motion_patch) — parity is covered by tests on both sides.

export const MOTION_PRESET_IDS = [
  "none",
  "kenburns-in",
  "kenburns-out",
  "pan-left",
  "pan-right",
  "pan-up",
  "pan-down",
  "drift",
];

export const MOTION_STRENGTHS = { subtle: 0.6, normal: 1, bold: 1.6 };

// preset/strength → { motion, transform, kf } patch for updateClip/setProps.
// assetWidth/Height come from the media probe (unknown → cover ratio 1);
// frameWidth/Height from project.settings. existingKf keeps opacity frames.
export function motionPresetPatch(preset, {
  durationMs = 4000,
  assetWidth = 0,
  assetHeight = 0,
  frameWidth = 1920,
  frameHeight = 1080,
  strength = "normal",
  existingKf = null,
  existingTransform = null,
} = {}) {
  const id = MOTION_PRESET_IDS.includes(preset) ? preset : "none";
  const keepOpacity = existingKf?.opacity ? { opacity: existingKf.opacity } : {};
  const baseOpacity = Number.isFinite(Number(existingTransform?.opacity))
    ? Number(existingTransform.opacity)
    : 1;
  if (id === "none") {
    return {
      motion: "",
      transform: { x: 0, y: 0, scale: 1, opacity: baseOpacity },
      kf: { ...keepOpacity },
    };
  }
  const s = MOTION_STRENGTHS[strength] ?? 1;
  const frameAspect = frameWidth > 0 && frameHeight > 0 ? frameWidth / frameHeight : 16 / 9;
  const assetAspect = assetWidth > 0 && assetHeight > 0 ? assetWidth / assetHeight : frameAspect;
  // Contain-fit fractions of the frame each axis actually fills.
  const fx = Math.min(1, assetAspect / frameAspect);
  const fy = Math.min(1, frameAspect / assetAspect);
  const cover = 1 / Math.min(fx, fy);

  let zoomStart = 1;
  let zoomEnd = 1;
  let xAmp = 0;
  let yAmp = 0;
  let xFrom = 0;
  let yFrom = 0;
  if (id === "kenburns-in" || id === "kenburns-out") {
    zoomStart = 1.02;
    zoomEnd = 1.02 + 0.12 * s;
    xAmp = 0.012 * s;
    yAmp = 0.008 * s;
    xFrom = -1;
    yFrom = 1;
    if (id === "kenburns-out") {
      [zoomStart, zoomEnd] = [zoomEnd, zoomStart];
      xFrom = -xFrom;
      yFrom = -yFrom;
    }
  } else if (id.startsWith("pan-")) {
    zoomStart = 1 + 0.1 * s;
    zoomEnd = zoomStart;
    const amp = 0.055 * s;
    if (id === "pan-left") {
      xAmp = amp;
      xFrom = 1; // image drifts leftwards across the frame
    } else if (id === "pan-right") {
      xAmp = amp;
      xFrom = -1;
    } else if (id === "pan-up") {
      yAmp = amp;
      yFrom = 1;
    } else {
      yAmp = amp;
      yFrom = -1;
    }
  } else {
    // drift: slow diagonal float with a gentle zoom.
    zoomStart = 1.03;
    zoomEnd = 1.03 + 0.05 * s;
    xAmp = 0.01 * s;
    yAmp = 0.008 * s;
    xFrom = -1;
    yFrom = 1;
  }
  const scaleStart = Math.min(8, cover * zoomStart);
  const scaleEnd = Math.min(8, cover * zoomEnd);
  const minScale = Math.min(scaleStart, scaleEnd);
  // Never pan far enough to reveal an edge, at any point of the move.
  const slackX = Math.max(0, (minScale * fx - 1) / 2);
  const slackY = Math.max(0, (minScale * fy - 1) / 2);
  xAmp = Math.min(xAmp, slackX);
  yAmp = Math.min(yAmp, slackY);

  const endMs = Math.max(100, Math.round(durationMs));
  const frames = (from, to) => [
    { atMs: 0, value: Number(from.toFixed(4)), easing: "smooth" },
    { atMs: endMs, value: Number(to.toFixed(4)), easing: "smooth" },
  ];
  const kf = { ...keepOpacity };
  if (scaleStart !== scaleEnd) {
    kf.scale = frames(scaleStart, scaleEnd);
  }
  if (xAmp > 0) {
    kf.x = frames(xFrom * xAmp, -xFrom * xAmp);
  }
  if (yAmp > 0) {
    kf.y = frames(yFrom * yAmp, -yFrom * yAmp);
  }
  return {
    motion: id,
    transform: {
      x: xAmp > 0 ? Number((xFrom * xAmp).toFixed(4)) : 0,
      y: yAmp > 0 ? Number((yFrom * yAmp).toFixed(4)) : 0,
      scale: Number(scaleStart.toFixed(4)),
      opacity: baseOpacity,
    },
    kf,
  };
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
      } else if (VIDEO_KF_BEZIERS[from.easing]) {
        ratio = cubicBezierEase(from.easing, ratio);
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

export function preparePropEvaluator(clip, prop) {
  const statics = {
    opacity: clip?.transform?.opacity ?? 1,
    x: clip?.transform?.x ?? 0,
    y: clip?.transform?.y ?? 0,
    scale: clip?.transform?.scale ?? 1,
  };
  const fallback = Object.prototype.hasOwnProperty.call(statics, prop) ? statics[prop] : 0;
  const frames = VIDEO_KF_PROPS.includes(prop) ? normalizeKf({ [prop]: clip?.kf?.[prop] })[prop] || [] : [];
  return (atMs) => kfValueAtMs(frames, atMs, fallback);
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

// --- Effects & color (contract §1) -------------------------------------------
// Defaults are never serialized: normalizeFx returns null when everything is
// at its default so clips without effects stay byte-identical in .pipe.

export const VIDEO_FX_CURVES = ["none", "vintage", "darker", "lighter", "increase_contrast", "strong_contrast"];
export const VIDEO_FX_BLENDS = ["normal", "multiply", "screen", "overlay", "lighten", "darken", "addition"];

export const VIDEO_FX_DEFAULTS = Object.freeze({
  exposure: 0,
  contrast: 1,
  saturation: 1,
  temperature: 0,
  curves: "none",
  lut: "",
  chromaKey: null,
  blur: 0,
  vignette: 0,
  grain: 0,
  blend: "normal",
});

export function normalizeFx(fx) {
  if (!fx || typeof fx !== "object") {
    return null;
  }
  const chroma = fx.chromaKey && typeof fx.chromaKey === "object"
    ? {
        color: cleanText(fx.chromaKey.color) || "#00ff00",
        similarity: Math.min(1, Math.max(0.01, cleanNumber(fx.chromaKey.similarity, 0.2))),
        blend: Math.min(1, Math.max(0, cleanNumber(fx.chromaKey.blend, 0.1))),
      }
    : null;
  const result = {
    exposure: Math.min(2, Math.max(-2, cleanNumber(fx.exposure, 0))),
    contrast: Math.min(2, Math.max(0.5, cleanNumber(fx.contrast, 1))),
    saturation: Math.min(3, Math.max(0, cleanNumber(fx.saturation, 1))),
    temperature: Math.min(100, Math.max(-100, cleanNumber(fx.temperature, 0))),
    curves: VIDEO_FX_CURVES.includes(fx.curves) ? fx.curves : "none",
    lut: cleanText(fx.lut),
    chromaKey: chroma,
    blur: Math.min(50, Math.max(0, cleanNumber(fx.blur, 0))),
    vignette: Math.min(1, Math.max(0, cleanNumber(fx.vignette, 0))),
    grain: Math.min(1, Math.max(0, cleanNumber(fx.grain, 0))),
    blend: VIDEO_FX_BLENDS.includes(fx.blend) ? fx.blend : "normal",
  };
  const isDefault = Object.keys(VIDEO_FX_DEFAULTS).every((key) => {
    if (key === "chromaKey") {
      return result.chromaKey === null;
    }
    return result[key] === VIDEO_FX_DEFAULTS[key];
  });
  return isDefault ? null : result;
}

// Static crop fractions of the source (contract §3); null when un-cropped.
export function normalizeCrop(crop) {
  if (!crop || typeof crop !== "object") {
    return null;
  }
  const side = (value) => Math.min(0.45, Math.max(0, cleanNumber(value, 0)));
  const result = { l: side(crop.l), t: side(crop.t), r: side(crop.r), b: side(crop.b) };
  return result.l || result.t || result.r || result.b ? result : null;
}

// --- Word-timed captions + text animations (contract §4) ---------------------

export const VIDEO_TEXT_ANIMS = ["none", "typewriter", "word-reveal", "word-highlight", "pop", "fade"];

export function normalizeWords(words, durationMs) {
  const list = (Array.isArray(words) ? words : [])
    .map((word) => ({
      text: cleanText(word?.text),
      startMs: Math.max(0, Math.round(cleanNumber(word?.startMs))),
      endMs: Math.max(0, Math.round(cleanNumber(word?.endMs))),
    }))
    .filter((word) => word.text && word.endMs > word.startMs && word.startMs < durationMs)
    .sort((a, b) => a.startMs - b.startMs);
  return list.length ? list : null;
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
    const textClip = {
      ...base,
      text: cleanText(clip.text) || "Text",
      style: normalizeTextStyle(clip.style),
      captionGroup: cleanText(clip.captionGroup),
      anim: VIDEO_TEXT_ANIMS.includes(clip.anim) ? clip.anim : "none",
    };
    const words = normalizeWords(clip.words, textClip.durationMs);
    if (words) {
      textClip.words = words;
    }
    if (textClip.anim === "word-highlight") {
      textClip.animOpts = {
        highlightColor: cleanText(clip.animOpts?.highlightColor) || "#fbbf24",
      };
    }
    return textClip;
  }
  const mediaClip = {
    ...base,
    assetPath: cleanText(clip.assetPath),
    sourceInMs: Math.max(0, Math.round(cleanNumber(clip.sourceInMs))),
    speed: Math.min(8, Math.max(0.1, cleanNumber(clip.speed, 1))),
    gain: normalizeGain(clip.gain),
    transform: normalizeTransform(clip.transform),
    kf: normalizeKf(clip.kf),
    linkId: cleanText(clip.linkId),
    // Applied motion-preset name (metadata only — the compiled transform/kf
    // above are what actually render; this lets UI/agents see what was used).
    motion: MOTION_PRESET_IDS.includes(cleanText(clip.motion)) ? cleanText(clip.motion) : "",
  };
  const fx = normalizeFx(clip.fx);
  if (fx) {
    mediaClip.fx = fx;
  }
  const crop = normalizeCrop(clip.crop);
  if (crop) {
    mediaClip.crop = crop;
  }
  return mediaClip;
}

// --- Transitions (contract §2) ------------------------------------------------

export const VIDEO_TRANSITION_KINDS = [
  "crossfade",
  "dip-black",
  "dip-white",
  "wipe-left",
  "wipe-right",
  "wipe-up",
  "wipe-down",
  "slide-left",
  "slide-right",
];

// A transition is valid only while its leading clip's end touches the next
// clip's start exactly (both on this track). Duration is clamped to half the
// shorter neighbor.
function transitionNeighbors(track, afterClipId) {
  const clips = track?.clips || [];
  const index = clips.findIndex((clip) => clip.id === afterClipId);
  if (index < 0 || index + 1 >= clips.length) {
    return null;
  }
  const left = clips[index];
  const right = clips[index + 1];
  if (clipEndMs(left) !== right.timelineStartMs) {
    return null;
  }
  return { left, right };
}

export function clampTransitionDurationMs(track, afterClipId, durationMs) {
  const neighbors = transitionNeighbors(track, afterClipId);
  if (!neighbors) {
    return 0;
  }
  const cap = Math.floor(Math.min(neighbors.left.durationMs, neighbors.right.durationMs) / 2);
  if (cap < 100) {
    return 0; // neighbors too short for the 100ms minimum — reject, never inflate
  }
  return Math.max(100, Math.min(3000, Math.min(cap, Math.round(cleanNumber(durationMs, 500)))));
}

export function normalizeTransitions(transitions, track) {
  const seen = new Set();
  const list = (Array.isArray(transitions) ? transitions : [])
    .map((transition) => {
      if (!transition || typeof transition !== "object") {
        return null;
      }
      const afterClipId = cleanText(transition.afterClipId);
      if (!afterClipId || seen.has(afterClipId) || !transitionNeighbors(track, afterClipId)) {
        return null;
      }
      const durationMs = clampTransitionDurationMs(track, afterClipId, transition.durationMs);
      if (!durationMs) {
        return null;
      }
      seen.add(afterClipId);
      return {
        id: cleanText(transition.id) || makeVideoId("transition"),
        afterClipId,
        kind: VIDEO_TRANSITION_KINDS.includes(transition.kind) ? transition.kind : "crossfade",
        durationMs,
      };
    })
    .filter(Boolean);
  return list;
}

// Drop transitions whose adjacency an edit just broke. Called by every
// geometry-mutating op; cheap (no clone — mutates the passed project).
export function pruneTransitions(project) {
  for (const track of project?.tracks || []) {
    if (Array.isArray(track.transitions) && track.transitions.length) {
      track.transitions = normalizeTransitions(track.transitions, track);
      if (!track.transitions.length) {
        delete track.transitions;
      }
    }
  }
  return project;
}

export function addTransition(project, trackId, afterClipId, kind, durationMs) {
  const next = cloneProject(project);
  const track = (next.tracks || []).find((candidate) => candidate.id === trackId);
  if (!track || track.locked || track.kind !== "video") {
    return project;
  }
  const clamped = clampTransitionDurationMs(track, afterClipId, durationMs);
  if (!clamped) {
    return project;
  }
  const existing = (track.transitions || []).filter((transition) => transition.afterClipId !== afterClipId);
  existing.push({
    id: makeVideoId("transition"),
    afterClipId,
    kind: VIDEO_TRANSITION_KINDS.includes(kind) ? kind : "crossfade",
    durationMs: clamped,
  });
  track.transitions = normalizeTransitions(existing, track);
  return next;
}

export function removeTransition(project, transitionId) {
  const next = cloneProject(project);
  let found = false;
  for (const track of next.tracks || []) {
    const before = (track.transitions || []).length;
    if (!before) {
      continue;
    }
    track.transitions = track.transitions.filter((transition) => transition.id !== transitionId);
    if (track.transitions.length !== before) {
      found = true;
    }
    if (!track.transitions.length) {
      delete track.transitions;
    }
  }
  return found ? next : project;
}

export function setTransitionDuration(project, transitionId, durationMs) {
  const next = cloneProject(project);
  for (const track of next.tracks || []) {
    for (const transition of track.transitions || []) {
      if (transition.id === transitionId) {
        const clamped = clampTransitionDurationMs(track, transition.afterClipId, durationMs);
        if (!clamped) {
          return project;
        }
        transition.durationMs = clamped;
        return next;
      }
    }
  }
  return project;
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
  const normalized = {
    id: cleanText(track.id) || makeVideoId("track"),
    kind,
    label: cleanText(track.label) || `${kind.charAt(0).toUpperCase()}${index + 1}`,
    muted: track.muted === true,
    locked: track.locked === true,
    clips,
  };
  if (kind === "video") {
    const transitions = normalizeTransitions(track.transitions, normalized);
    if (transitions.length) {
      normalized.transitions = transitions;
    }
  }
  return normalized;
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

export function prepareGainEvaluator(gain) {
  const normalized = normalizeGain(gain);
  const frames = normalized.keyframes;
  const baseLevel = normalized.level;
  return (atMs) => {
    if (!frames.length) {
      return baseLevel;
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
    return baseLevel;
  };
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
  return pruneTransitions(next);
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
  const ids = [...new Set(Array.isArray(clipIds) ? clipIds.filter(Boolean) : [])];
  if (!ids.length) {
    return project;
  }
  const next = cloneProject(project);
  const idSet = new Set(ids);
  const targets = [];
  for (const clipId of ids) {
    const found = findClip(next, clipId);
    if (!found || found.track.locked) {
      return project;
    }
    targets.push(found);
  }
  const minStart = Math.min(...targets.map((entry) => entry.clip.timelineStartMs));
  let applied = Math.max(Math.round(cleanNumber(deltaMs)), -minStart);
  for (;;) {
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
  return pruneTransitions(next);
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
  return pruneTransitions(next);
}

// Ripple delete uses the linked group's union interval and the same global
// timeline semantics as a range ripple. Selecting any member is therefore
// equivalent, even when members start/end at different times or share a lane.
export function rippleDeleteClip(project, clipId) {
  const selected = findClip(project, clipId);
  if (!selected) {
    return project;
  }
  const ids = expandWithLinks(project, [clipId]);
  const members = ids.map((id) => findClip(project, id)).filter(Boolean);
  if (!members.length || members.some((member) => member.track.locked)) {
    return project;
  }
  const from = Math.min(...members.map((member) => member.clip.timelineStartMs));
  const to = Math.max(...members.map((member) => clipEndMs(member.clip)));
  return rippleDeleteRange(project, from, to, null);
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
  return pruneTransitions(next);
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

// Still images have no source clock: their duration is pure display time and
// playback speed is meaningless.
export function isStillImageAsset(assetPath) {
  return /\.(png|jpe?g|webp|gif|bmp|tiff)$/i.test(assetPath || "");
}

export function trimClipEnd(project, clipId, deltaMs) {
  return updateClipIn(project, clipId, (clip) => {
    const requestedDuration = Math.max(
      MIN_CLIP_DURATION_MS,
      clip.durationMs + Math.round(deltaMs),
    );
    if (requestedDuration > clip.durationMs && clip.sourceInMs != null && !isStillImageAsset(clip.assetPath)) {
      // Extending a media edge is a time-stretch, not permission to read past
      // the source EOF. Preserve the currently-used source span and lower the
      // playback rate to fill the new timeline duration. This also keeps
      // linked video/audio pairs sample-aligned.
      const sourceSpanMs = clip.durationMs * (clip.speed || 1);
      const maxDurationMs = Math.max(clip.durationMs, Math.floor(sourceSpanMs / 0.1));
      clip.durationMs = Math.min(requestedDuration, maxDurationMs);
      clip.speed = Math.min(8, Math.max(0.1, sourceSpanMs / clip.durationMs));
      return;
    }
    clip.durationMs = requestedDuration;
  });
}

// Trim a linked/selected cohort transactionally. A sequential trim would
// otherwise mutate earlier members before discovering that a later partner
// lives on a locked track.
export function trimClips(project, clipIds, edge, deltaMs) {
  const ids = [...new Set(Array.isArray(clipIds) ? clipIds : [])];
  if (!ids.length || !["start", "end"].includes(edge)) {
    return project;
  }
  const members = ids.map((id) => findClip(project, id));
  if (members.some((member) => !member || member.track.locked)) {
    return project;
  }
  let next = project;
  for (const id of ids) {
    next = edge === "start" ? trimClipStart(next, id, deltaMs) : trimClipEnd(next, id, deltaMs);
  }
  return next;
}

// Set a media clip's playback rate directly (the inspector's Speed control).
// The consumed source span is preserved — timeline duration rescales to
// span / speed, exactly like trim-stretching — and linked partners follow so
// A/V stays sample-aligned.
export function setClipSpeed(project, clipId, speed) {
  const nextSpeed = Math.min(8, Math.max(0.1, cleanNumber(speed, 1)));
  const found = findClip(project, clipId);
  if (!found || found.track.kind === "text" || isStillImageAsset(found.clip.assetPath)) {
    return project;
  }
  const ids = linkedClipIds(project, clipId);
  const members = ids.map((id) => findClip(project, id));
  if (members.some((member) => !member || member.track.locked)) {
    return project;
  }
  let next = project;
  for (const id of ids) {
    next = updateClipIn(next, id, (clip) => {
      const sourceSpanMs = clip.durationMs * (clip.speed || 1);
      clip.speed = nextSpeed;
      clip.durationMs = Math.max(MIN_CLIP_DURATION_MS, Math.round(sourceSpanMs / nextSpeed));
    });
  }
  return next;
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
  // A transition anchored on the split clip belongs to the ORIGINAL junction,
  // which the new right fragment now owns — retarget before pruning.
  for (const transition of track.transitions || []) {
    if (transition.afterClipId === clip.id) {
      transition.afterClipId = right.id;
    }
  }
  return { project: pruneTransitions(next), rightId: right.id };
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

function freshLinkId(suffix = "") {
  linkIdSeq += 1;
  return `link-${Date.now().toString(36)}${suffix}-${linkIdSeq}`;
}

function linkGroups(project) {
  const groups = new Map();
  for (const track of project?.tracks || []) {
    for (const clip of track.clips || []) {
      if (!clip.linkId) {
        continue;
      }
      if (!groups.has(clip.linkId)) {
        groups.set(clip.linkId, []);
      }
      groups.get(clip.linkId).push({ track, clip });
    }
  }
  return groups;
}

function lockedTrackBlock(track, operation = "Ripple edit") {
  return {
    reason: "locked-track",
    trackId: track?.id || "",
    message: `${operation} blocked because ${track?.label || track?.id || "a required track"} is locked.`,
  };
}

// A scoped ripple follows whole link groups. A group is affected when it has
// a member on a seed/closed-over track AND any member lies in the edit's
// affected time cohort. That second, group-wide test is what catches a short
// twin whose longer partner reaches the range.
function rippleTrackIdsWithLinks(project, trackIds, affectsClip) {
  const tracks = project?.tracks || [];
  const affected = new Set(trackIds == null
    ? tracks.filter((track) => !track.locked).map((track) => track.id)
    : (Array.isArray(trackIds) ? trackIds : [...trackIds]));
  for (const track of project?.tracks || []) {
    if (affected.has(track.id) && track.locked) {
      return { affected: new Set(), touchedLinkIds: new Set(), blocked: lockedTrackBlock(track) };
    }
  }
  const groups = linkGroups(project);
  const touchedLinkIds = new Set();
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const [linkId, members] of groups) {
      if (!members.some((member) => affected.has(member.track.id))) {
        continue;
      }
      if (!members.some((member) => affectsClip(member.clip))) {
        continue;
      }
      touchedLinkIds.add(linkId);
      for (const member of members) {
        if (member.track.locked) {
          return {
            affected: new Set(),
            touchedLinkIds: new Set(),
            blocked: lockedTrackBlock(member.track),
          };
        }
        if (!affected.has(member.track.id)) {
          affected.add(member.track.id);
          expanded = true;
        }
      }
    }
  }
  return { affected, touchedLinkIds, blocked: null };
}

function addCohortMember(cohorts, linkId, clipId) {
  if (!linkId || !clipId) {
    return;
  }
  if (!cohorts.has(linkId)) {
    cohorts.set(linkId, []);
  }
  cohorts.get(linkId).push(clipId);
}

// Reassign every touched group as two complete cohorts. The left side keeps
// the old id, the right side receives exactly one fresh id, and singleton
// cohorts are explicitly unlinked.
function applyLinkCohorts(project, touchedLinkIds, leftCohorts, rightCohorts) {
  for (const linkId of touchedLinkIds) {
    const leftIds = [...new Set(leftCohorts.get(linkId) || [])];
    const rightIds = [...new Set(rightCohorts.get(linkId) || [])];
    const rightLinkId = rightIds.length >= 2 ? freshLinkId("-r") : "";
    const leftLinkId = leftIds.length >= 2 ? linkId : "";
    for (const clipId of leftIds) {
      const found = findClip(project, clipId);
      if (found && found.track.kind !== "text") {
        found.clip.linkId = leftLinkId;
      }
    }
    for (const clipId of rightIds) {
      const found = findClip(project, clipId);
      if (found && found.track.kind !== "text") {
        found.clip.linkId = rightLinkId;
      }
    }
  }
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
      const laneIndex = (project?.tracks || [])
        .filter((track) => track.kind === found.track.kind)
        .findIndex((track) => track.id === found.track.id);
      entries.push({
        trackKind: found.track.kind,
        laneIndex: Math.max(0, laneIndex),
        clip: JSON.parse(JSON.stringify(found.clip)),
      });
      baseMs = Math.min(baseMs, found.clip.timelineStartMs);
    }
  }
  if (!entries.length) {
    return null;
  }
  return { kind: "diffforge-video-clips", version: 2, baseMs, entries };
}

export function pasteClips(project, payload, atMs) {
  if (payload?.kind !== "diffforge-video-clips" || !Array.isArray(payload.entries) || !payload.entries.length) {
    return { project, clipIds: [] };
  }
  const requestedDelta = Math.round(cleanNumber(atMs)) - Math.round(cleanNumber(payload.baseMs));
  const prepared = [];
  for (const [index, entry] of payload.entries.entries()) {
    const kind = VIDEO_TRACK_KINDS.includes(entry.trackKind) ? entry.trackKind : "video";
    // Version-1/legacy payloads had no lane identity; they map to lane zero.
    const laneIndex = Math.max(0, Math.round(cleanNumber(entry.laneIndex, 0)));
    const sourceLinkId = typeof entry.clip?.linkId === "string" ? entry.clip.linkId : "";
    prepared.push({
      entry,
      index,
      kind,
      laneIndex,
      sourceLinkId,
      timelineStartMs: Math.max(0, Math.round(Number(entry.clip?.timelineStartMs) || 0)),
      durationMs: Math.max(
        MIN_CLIP_DURATION_MS,
        Math.round(Number(entry.clip?.durationMs) || MIN_CLIP_DURATION_MS),
      ),
    });
  }

  // Resolve every required lane before cloning. A locked lane is not skipped:
  // lane identity is positional, so substituting another lane would corrupt
  // stacked geometry.
  const existingLanes = new Map();
  for (const kind of VIDEO_TRACK_KINDS) {
    existingLanes.set(kind, (project?.tracks || []).filter((track) => track.kind === kind));
  }
  for (const item of prepared) {
    const lane = existingLanes.get(item.kind)?.[item.laneIndex];
    if (lane?.locked) {
      return {
        project,
        clipIds: [],
        blocked: lockedTrackBlock(lane, "Paste"),
      };
    }
  }

  let next = cloneProject(project);
  for (const kind of VIDEO_TRACK_KINDS) {
    const requiredMax = prepared
      .filter((item) => item.kind === kind)
      .reduce((maximum, item) => Math.max(maximum, item.laneIndex), -1);
    let lanes = next.tracks.filter((track) => track.kind === kind);
    while (lanes.length <= requiredMax) {
      const prefix = kind === "video" ? "V" : kind === "audio" ? "A" : "T";
      const track = {
        id: makeVideoId("track"),
        kind,
        label: `${prefix}${lanes.length + 1}`,
        muted: false,
        locked: false,
        clips: [],
      };
      next.tracks.push(track);
      lanes = next.tracks.filter((candidate) => candidate.kind === kind);
    }
  }
  const destinationLanes = new Map();
  for (const kind of VIDEO_TRACK_KINDS) {
    destinationLanes.set(kind, next.tracks.filter((track) => track.kind === kind));
  }
  for (const item of prepared) {
    item.track = destinationLanes.get(item.kind)[item.laneIndex];
  }

  // Relative overlap on one destination lane cannot be repaired by any
  // shared delta, so reject it before adding a single clip.
  for (const track of next.tracks) {
    const laneItems = prepared
      .filter((item) => item.track.id === track.id)
      .sort((a, b) => a.timelineStartMs - b.timelineStartMs || a.index - b.index);
    for (let index = 1; index < laneItems.length; index += 1) {
      if (laneItems[index].timelineStartMs < laneItems[index - 1].timelineStartMs + laneItems[index - 1].durationMs) {
        return {
          project,
          clipIds: [],
          blocked: {
            reason: "payload-overlap",
            trackId: track.id,
            message: `Paste blocked because clips overlap within ${track.label || "a destination lane"}.`,
          },
        };
      }
    }
  }

  const minStart = Math.min(...prepared.map((item) => item.timelineStartMs));
  let applied = Math.max(requestedDelta, -minStart);
  // Every entry shares this one delta. Rechecking all lanes after every push
  // finds the earliest placement at or after the request that fits the entire
  // payload against existing occupancy.
  for (;;) {
    let required = applied;
    for (const item of prepared) {
      const free = firstFreePositionOnTrack(
        item.track,
        item.timelineStartMs + applied,
        item.durationMs,
      );
      required = Math.max(required, free - item.timelineStartMs);
    }
    if (required === applied) {
      break;
    }
    applied = required;
  }

  const linkCounts = new Map();
  for (const item of prepared) {
    if (item.kind !== "text" && item.sourceLinkId) {
      linkCounts.set(item.sourceLinkId, (linkCounts.get(item.sourceLinkId) || 0) + 1);
    }
  }
  const linkMap = new Map();
  const newIds = [];
  for (const item of prepared) {
    const id = makeVideoId("clip");
    let linkId = "";
    if (item.sourceLinkId && (linkCounts.get(item.sourceLinkId) || 0) >= 2) {
      if (!linkMap.has(item.sourceLinkId)) {
        linkMap.set(item.sourceLinkId, freshLinkId("-p"));
      }
      linkId = linkMap.get(item.sourceLinkId);
    }
    const clip = normalizeClip({
      ...item.entry.clip,
      id,
      timelineStartMs: item.timelineStartMs + applied,
      linkId,
    }, item.kind);
    item.track.clips.push(clip);
    newIds.push(id);
  }
  for (const track of next.tracks) {
    track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  }
  return { project: pruneTransitions(next), clipIds: newIds };
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
  const affectedMembers = affectedIds.map((id) => findClip(project, id));
  if (affectedMembers.some((member) => !member || member.track.locked)) {
    return project;
  }
  const originalStarts = new Map();
  for (const id of affectedIds) {
    const found = findClip(project, id);
    if (found) {
      originalStarts.set(id, found.clip.timelineStartMs);
    }
  }
  const next = trimClips(project, affectedIds, edge, deltaMs);
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
  return pruneTransitions(cloned);
}

// Ripple delete a time range across all (or given) unlocked tracks: clips
// fully inside vanish, straddling clips get trimmed/split, and everything
// after slides left to close the gap.
function planRippleDeleteRange(project, startMs, endMs, trackIds = null) {
  let from = Math.max(0, Math.round(cleanNumber(startMs)));
  let to = Math.max(from, Math.round(cleanNumber(endMs)));
  if (to === from) {
    return { from, to, affected: new Set(), touchedLinkIds: new Set(), mutation: false, blocked: null };
  }
  let closure;
  for (;;) {
    closure = rippleTrackIdsWithLinks(project, trackIds, (clip) => clipEndMs(clip) > from);
    if (closure.blocked) {
      return { from, to, affected: new Set(), touchedLinkIds: new Set(), mutation: false, blocked: closure.blocked };
    }
    let expandedFrom = from;
    let expandedTo = to;
    for (const track of project?.tracks || []) {
      if (!closure.affected.has(track.id) || track.locked) {
        continue;
      }
      for (const clip of track.clips || []) {
        const start = clip.timelineStartMs;
        const end = clipEndMs(clip);
        if (end <= from || start >= to) {
          continue;
        }
        const headDuration = from - start;
        const tailDuration = end - to;
        if (headDuration > 0 && headDuration < MIN_CLIP_DURATION_MS) {
          expandedFrom = Math.min(expandedFrom, start);
        }
        if (tailDuration > 0 && tailDuration < MIN_CLIP_DURATION_MS) {
          expandedTo = Math.max(expandedTo, end);
        }
      }
    }
    if (expandedFrom === from && expandedTo === to) {
      break;
    }
    from = expandedFrom;
    to = expandedTo;
  }
  // Boundary expansion can change which group is temporally affected.
  closure = rippleTrackIdsWithLinks(project, trackIds, (clip) => clipEndMs(clip) > from);
  if (closure.blocked) {
    return { from, to, affected: new Set(), touchedLinkIds: new Set(), mutation: false, blocked: closure.blocked };
  }
  const mutation = closure.affected.size > 0 && (project?.tracks || []).some(
    (track) => closure.affected.has(track.id)
      && !track.locked
      && (track.clips || []).some((clip) => clipEndMs(clip) > from),
  );
  return { from, to, ...closure, mutation };
}

function applyRippleDeletePlan(project, plan) {
  if (plan.blocked || !plan.mutation || !plan.affected.size || plan.to <= plan.from) {
    return project;
  }
  const { from, to, affected, touchedLinkIds } = plan;
  const gap = to - from;
  const next = cloneProject(project);
  const leftCohorts = new Map();
  const rightCohorts = new Map();
  for (const track of next.tracks) {
    if (track.locked || !affected.has(track.id)) {
      continue;
    }
    const kept = [];
    for (const clip of track.clips) {
      const start = clip.timelineStartMs;
      const end = clipEndMs(clip);
      const originalLinkId = clip.linkId || "";
      if (end <= from) {
        kept.push(clip);
        if (touchedLinkIds.has(originalLinkId)) {
          addCohortMember(leftCohorts, originalLinkId, clip.id);
        }
        continue;
      }
      if (start >= to) {
        clip.timelineStartMs = Math.max(0, start - gap);
        kept.push(clip);
        if (touchedLinkIds.has(originalLinkId)) {
          addCohortMember(rightCohorts, originalLinkId, clip.id);
        }
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
          const normalizedHead = normalizeClip(head, track.kind);
          kept.push(normalizedHead);
          if (touchedLinkIds.has(originalLinkId)) {
            addCohortMember(leftCohorts, originalLinkId, normalizedHead.id);
          }
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
          const normalizedTail = normalizeClip(tail, track.kind);
          kept.push(normalizedTail);
          if (touchedLinkIds.has(originalLinkId)) {
            addCohortMember(rightCohorts, originalLinkId, normalizedTail.id);
          }
        }
      }
    }
    track.clips = kept.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  }
  applyLinkCohorts(next, touchedLinkIds, leftCohorts, rightCohorts);
  return pruneTransitions(next);
}

export function rippleDeleteRange(project, startMs, endMs, trackIds = null) {
  const plan = planRippleDeleteRange(project, startMs, endMs, trackIds);
  return applyRippleDeletePlan(project, plan);
}

// Insert a gap (ripple insert): everything at/after atMs slides right;
// straddling clips are split first so the gap opens cleanly.
export function rippleInsertGap(project, atMs, gapMs, trackIds = null) {
  const at = Math.max(0, Math.round(cleanNumber(atMs)));
  const gap = Math.max(0, Math.round(cleanNumber(gapMs)));
  if (!gap) {
    return project;
  }
  const closure = rippleTrackIdsWithLinks(project, trackIds, (clip) => clipEndMs(clip) > at);
  if (closure.blocked || !closure.affected.size) {
    return project;
  }
  const hasMutation = (project?.tracks || []).some(
    (track) => closure.affected.has(track.id)
      && !track.locked
      && (track.clips || []).some((clip) => {
        if (clip.timelineStartMs >= at) {
          return true;
        }
        if (clipEndMs(clip) <= at) {
          return false;
        }
        // A sub-minimum right remnant is deliberately kept with the left
        // fragment; by itself that is a no-op.
        return clipEndMs(clip) - at >= MIN_CLIP_DURATION_MS;
      }),
  );
  if (!hasMutation) {
    return project;
  }
  const next = cloneProject(project);
  const leftCohorts = new Map();
  const rightCohorts = new Map();
  for (const track of next.tracks) {
    if (track.locked || !closure.affected.has(track.id)) {
      continue;
    }
    const kept = [];
    for (const clip of track.clips) {
      const start = clip.timelineStartMs;
      const end = clipEndMs(clip);
      const originalLinkId = clip.linkId || "";
      const touched = closure.touchedLinkIds.has(originalLinkId);
      if (end <= at) {
        kept.push(clip);
        if (touched) {
          addCohortMember(leftCohorts, originalLinkId, clip.id);
        }
        continue;
      }
      if (start >= at) {
        clip.timelineStartMs += gap;
        kept.push(clip);
        if (touched) {
          addCohortMember(rightCohorts, originalLinkId, clip.id);
        }
        continue;
      }

      const leftDuration = at - start;
      const rightDuration = end - at;
      if (leftDuration < MIN_CLIP_DURATION_MS) {
        // Keep the tiny left remnant merged with its adjacent right fragment.
        clip.timelineStartMs += gap;
        kept.push(clip);
        if (touched) {
          addCohortMember(rightCohorts, originalLinkId, clip.id);
        }
        continue;
      }
      if (rightDuration < MIN_CLIP_DURATION_MS) {
        // Keep the tiny right remnant merged with its adjacent left fragment.
        kept.push(clip);
        if (touched) {
          addCohortMember(leftCohorts, originalLinkId, clip.id);
        }
        continue;
      }

      const right = JSON.parse(JSON.stringify(clip));
      right.id = makeVideoId("clip");
      right.timelineStartMs = at + gap;
      right.durationMs = rightDuration;
      clip.durationMs = leftDuration;
      if (track.kind !== "text") {
        right.sourceInMs = (clip.sourceInMs || 0) + Math.round(leftDuration * (clip.speed || 1));
        right.linkId = "";
        partitionEnvelopesAt(clip, right, leftDuration);
      }
      const normalizedLeft = normalizeClip(clip, track.kind);
      const normalizedRight = normalizeClip(right, track.kind);
      kept.push(normalizedLeft, normalizedRight);
      if (touched) {
        addCohortMember(leftCohorts, originalLinkId, normalizedLeft.id);
        addCohortMember(rightCohorts, originalLinkId, normalizedRight.id);
      }
    }
    track.clips = kept.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  }
  applyLinkCohorts(next, closure.touchedLinkIds, leftCohorts, rightCohorts);
  return pruneTransitions(next);
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

// Build caption text clips for a media clip from its asset's transcript —
// ONE caption per transcript segment, text verbatim (WYSIWYG with the SRT
// export: what you edit in the transcript panel is exactly what burns in).
// Source times map to the timeline through the clip's trim + speed; captions
// outside the clip's visible window are dropped. Existing captions for the
// same group are replaced. Returns { project, count, trackId }.
export function addCaptionsForClip(project, clipId, segments, { style = {} } = {}) {
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
    const text = String(segment.text || "").trim();
    if (!text) {
      continue;
    }
    const startSrc = Math.max(segment.startMs, sourceFrom);
    const endSrc = Math.min(segment.endMs, sourceTo);
    if (endSrc - startSrc < 80) {
      continue;
    }
    const timelineStart = clip.timelineStartMs + Math.round((startSrc - sourceFrom) / speed);
    const durationMs = Math.max(MIN_CLIP_DURATION_MS, Math.round((endSrc - startSrc) / speed));
    // Word timings ride along (clip-relative, trim/speed-mapped) so the
    // typewriter/word-reveal/word-highlight animations have data to drive.
    const words = (Array.isArray(segment.words) ? segment.words : [])
      .filter((word) => Number.isFinite(Number(word?.startMs)) && Number.isFinite(Number(word?.endMs)))
      .map((word) => ({
        text: String(word.text || "").trim(),
        startMs: Math.round((Math.max(Number(word.startMs), startSrc) - startSrc) / speed),
        endMs: Math.round((Math.min(Number(word.endMs), endSrc) - startSrc) / speed),
      }))
      .filter((word) => word.text && word.endMs > word.startMs);
    track.clips.push(
      normalizeClip(
        {
          id: makeVideoId("cap"),
          text,
          timelineStartMs: timelineStart,
          durationMs,
          style: { ...CAPTION_TEXT_STYLE, ...style },
          captionGroup,
          words: words.length ? words : undefined,
        },
        "text",
      ),
    );
    count += 1;
  }
  track.clips.sort((a, b) => a.timelineStartMs - b.timelineStartMs);
  return { project: next, count, trackId: track.id };
}

// Remove transcript words from the cut: turns the words' source spans into
// timeline ranges via every clip using that asset, merges adjacent ranges,
// and ripple-deletes them. The AI-native "delete the umms" primitive.
export function rippleDeleteWords(
  project,
  assetPath,
  words,
  { mergeGapMs = RIPPLE_DELETE_WORDS_MERGE_GAP_MS } = {},
) {
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
          trackId: track.id,
          trackLocked: track.locked === true,
        });
      }
    }
  }
  // A source mapping on a locked-only track would not be discovered by the
  // default unlocked-track ripple seed, so retain mapping provenance and veto
  // it explicitly before any back-to-front mutation begins.
  const lockedMapping = timelineRanges.find((range) => range.trackLocked);
  if (lockedMapping) {
    const track = (project?.tracks || []).find((entry) => entry.id === lockedMapping.trackId);
    return {
      project,
      ranges: [],
      blocked: lockedTrackBlock(track, "Word deletion"),
    };
  }
  timelineRanges.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  let effectiveRanges = [];
  for (const range of timelineRanges) {
    const last = effectiveRanges[effectiveRanges.length - 1];
    if (last && range.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, range.endMs);
    } else {
      effectiveRanges.push({ startMs: range.startMs, endMs: range.endMs });
    }
  }
  if (!effectiveRanges.length) {
    return { project, ranges: [] };
  }

  // Plan every range against the untouched project. Minimum-duration
  // expansion can make ranges overlap, so merge and re-plan until stable.
  for (;;) {
    const plannedRanges = [];
    for (const range of effectiveRanges) {
      const plan = planRippleDeleteRange(project, range.startMs, range.endMs, null);
      if (plan.blocked) {
        return { project, ranges: [], blocked: plan.blocked };
      }
      if (plan.mutation) {
        plannedRanges.push({ startMs: plan.from, endMs: plan.to });
      }
    }
    plannedRanges.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    const mergedRanges = [];
    for (const range of plannedRanges) {
      const last = mergedRanges[mergedRanges.length - 1];
      if (last && range.startMs <= last.endMs) {
        last.endMs = Math.max(last.endMs, range.endMs);
      } else {
        mergedRanges.push({ ...range });
      }
    }
    if (JSON.stringify(mergedRanges) === JSON.stringify(effectiveRanges)) {
      effectiveRanges = mergedRanges;
      break;
    }
    effectiveRanges = mergedRanges;
  }

  // Delete back-to-front so earlier ranges stay valid.
  let next = project;
  for (let index = effectiveRanges.length - 1; index >= 0; index -= 1) {
    const range = effectiveRanges[index];
    const plan = planRippleDeleteRange(next, range.startMs, range.endMs, null);
    if (plan.blocked) {
      // Defensive transactional fallback: discard the local immutable chain.
      return { project, ranges: [], blocked: plan.blocked };
    }
    next = applyRippleDeletePlan(next, plan);
  }
  return { project: next, ranges: effectiveRanges };
}

export function removeClip(project, clipId) {
  const next = cloneProject(project);
  const found = findClip(next, clipId);
  if (!found || found.track.locked) {
    return project;
  }
  found.track.clips = found.track.clips.filter((clip) => clip.id !== clipId);
  return pruneTransitions(next);
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
      if (typeof patch?.anim === "string") {
        clip.anim = VIDEO_TEXT_ANIMS.includes(patch.anim) ? patch.anim : "none";
        if (clip.anim === "word-highlight") {
          clip.animOpts = {
            highlightColor:
              cleanText(patch.animOpts?.highlightColor || clip.animOpts?.highlightColor) || "#fbbf24",
          };
        } else {
          delete clip.animOpts;
        }
      } else if (patch?.animOpts && typeof patch.animOpts === "object" && clip.anim === "word-highlight") {
        clip.animOpts = {
          highlightColor:
            cleanText(patch.animOpts.highlightColor) || clip.animOpts?.highlightColor || "#fbbf24",
        };
      }
      if (patch?.words !== undefined) {
        const words = normalizeWords(patch.words, clip.durationMs);
        if (words) {
          clip.words = words;
        } else {
          delete clip.words;
        }
      }
    } else {
      // fx/crop merge over current values; null (or a patch resolving to all
      // defaults) clears the field so untouched clips stay lean.
      if (patch?.fx !== undefined) {
        const fx = patch.fx === null ? null : normalizeFx({ ...VIDEO_FX_DEFAULTS, ...clip.fx, ...patch.fx });
        if (fx) {
          clip.fx = fx;
        } else {
          delete clip.fx;
        }
      }
      if (patch?.crop !== undefined) {
        const crop = patch.crop === null ? null : normalizeCrop({ ...clip.crop, ...patch.crop });
        if (crop) {
          clip.crop = crop;
        } else {
          delete clip.crop;
        }
      }
      if (patch?.gain && typeof patch.gain === "object") {
        clip.gain = normalizeGain({ ...clip.gain, ...patch.gain });
      }
      if (patch?.transform && typeof patch.transform === "object") {
        clip.transform = normalizeTransform({ ...clip.transform, ...patch.transform });
      }
      // Keyframes replace wholesale: motion presets own the whole x/y/scale
      // envelope (they carry existing opacity frames through themselves).
      if (patch?.kf && typeof patch.kf === "object") {
        clip.kf = normalizeKf(patch.kf);
      }
      if (typeof patch?.motion === "string") {
        clip.motion = MOTION_PRESET_IDS.includes(patch.motion) ? patch.motion : "";
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

// A generated video is inserted as a placeholder before its file exists, so
// its initial media record cannot tell us whether the finished MP4 has audio.
// Once probing completes, retrofit the same linked A/V shape used by normal
// media insertion without moving or replacing the placeholder clip.
export function reconcileGeneratedAssetClips(project, asset) {
  if (!project || asset?.kind !== "video" || !asset?.path) {
    return project;
  }
  let next = cloneProject(project);
  const videoClips = next.tracks
    .filter((track) => track.kind === "video")
    .flatMap((track) => track.clips || [])
    .filter((clip) => clip.assetPath === asset.path);
  let changed = false;

  for (const videoClip of videoClips) {
    const probedDurationMs = Math.round(Number(asset.durationMs));
    if (Number.isFinite(probedDurationMs) && probedDurationMs >= MIN_CLIP_DURATION_MS) {
      if (videoClip.durationMs !== probedDurationMs) {
        videoClip.durationMs = probedDurationMs;
        changed = true;
      }
      if (videoClip.linkId) {
        for (const track of next.tracks) {
          if (track.kind !== "audio") {
            continue;
          }
          for (const clip of track.clips || []) {
            if (clip.linkId === videoClip.linkId && clip.durationMs !== probedDurationMs) {
              clip.durationMs = probedDurationMs;
              changed = true;
            }
          }
        }
      }
    }
    if (asset.hasAudio !== true) {
      continue;
    }
    const alreadyLinked = Boolean(
      videoClip.linkId
      && next.tracks.some(
        (track) =>
          track.kind === "audio"
          && (track.clips || []).some(
            (clip) =>
              clip.linkId === videoClip.linkId
              && clip.assetPath === videoClip.assetPath
              && clip.timelineStartMs === videoClip.timelineStartMs
              && clip.durationMs === videoClip.durationMs,
          ),
      ),
    );
    if (alreadyLinked) {
      continue;
    }

    let audioTrack = next.tracks.find(
      (track) =>
        track.kind === "audio"
        && !track.locked
        && firstFreePositionOnTrack(track, videoClip.timelineStartMs, videoClip.durationMs)
          === videoClip.timelineStartMs,
    );
    if (!audioTrack) {
      next = addTrack(next, "audio");
      audioTrack = next.tracks[next.tracks.length - 1];
    }
    const currentVideo = findClip(next, videoClip.id)?.clip;
    if (!currentVideo) {
      continue;
    }
    const audioClip = normalizeClip(
      {
        id: makeVideoId("clip"),
        assetPath: currentVideo.assetPath,
        timelineStartMs: currentVideo.timelineStartMs,
        durationMs: currentVideo.durationMs,
        sourceInMs: currentVideo.sourceInMs || 0,
        speed: currentVideo.speed || 1,
      },
      "audio",
    );
    linkIdSeq += 1;
    const linkId = `link-${Date.now().toString(36)}-genav${linkIdSeq}`;
    currentVideo.linkId = linkId;
    currentVideo.gain = { level: 0, keyframes: [] };
    audioClip.linkId = linkId;
    audioTrack.clips.push(audioClip);
    audioTrack.clips.sort((left, right) => left.timelineStartMs - right.timelineStartMs);
    changed = true;
  }

  return changed ? next : project;
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

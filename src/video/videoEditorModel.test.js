import assert from "node:assert/strict";
import test from "node:test";

import {
  addCaptionsForClip,
  addTransition,
  clampTransitionDurationMs,
  cubicBezierEase,
  normalizeCrop,
  normalizeFx,
  normalizeWords,
  removeTransition,
  setTransitionDuration,
  addMediaClip,
  addTextClip,
  addTrack,
  clipPropAtMs,
  clipsAtMs,
  clipsInRange,
  collectSnapPoints,
  expandWithLinks,
  reconcileGeneratedAssetClips,
  formatTimecode,
  gainAtMs,
  kfValueAtMs,
  linkClips,
  makeStarterProject,
  motionPresetPatch,
  moveClip,
  moveClips,
  moveClipToTrack,
  normalizeProject,
  normalizeTextStyle,
  pasteClips,
  projectDurationMs,
  removeClip,
  removeClips,
  RIPPLE_DELETE_WORDS_MERGE_GAP_MS,
  rippleDeleteClip,
  rippleDeleteRange,
  rippleDeleteWords,
  rippleInsertGap,
  rippleTrim,
  serializeClips,
  setClipKeyframe,
  setClipSpeed,
  snapMs,
  splitClip,
  splitLinkedAt,
  trimClips,
  trimClipEnd,
  trimClipStart,
  unlinkClip,
  updateClip,
} from "./videoEditorModel.js";

function assertClose(actual, expected, epsilon = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function projectWithClip(overrides = {}) {
  const base = makeStarterProject("test");
  const videoTrack = base.tracks.find((track) => track.kind === "video");
  videoTrack.clips.push({
    id: "clip-1",
    assetPath: "media/assets/a.mp4",
    timelineStartMs: 1000,
    durationMs: 4000,
    sourceInMs: 500,
    speed: 1,
    gain: { level: 1, keyframes: [] },
    transform: { x: 0, y: 0, scale: 1, opacity: 1 },
    ...overrides,
  });
  return normalizeProject(base);
}

test("normalizes an arbitrary project and keeps starter tracks when empty", () => {
  const project = normalizeProject({});
  assert.equal(project.tracks.length, 3);
  assert.deepEqual(
    project.tracks.map((track) => track.kind),
    ["video", "audio", "text"],
  );
  assert.equal(project.settings.width, 1920);
});

test("computes project duration from the furthest clip end", () => {
  const project = projectWithClip();
  assert.equal(projectDurationMs(project), 5000);
});

test("interpolates gain keyframes linearly with clamped ends", () => {
  const gain = { level: 1, keyframes: [{ atMs: 0, level: 1 }, { atMs: 1000, level: 0 }] };
  assert.equal(gainAtMs(gain, -100), 1);
  assert.equal(gainAtMs(gain, 0), 1);
  assertClose(gainAtMs(gain, 500), 0.5);
  assert.equal(gainAtMs(gain, 1000), 0);
  assert.equal(gainAtMs(gain, 5000), 0);
});

test("uses flat level when there are no keyframes", () => {
  assertClose(gainAtMs({ level: 0.7, keyframes: [] }, 123), 0.7);
});

test("moves clips and clamps to zero", () => {
  const project = projectWithClip();
  const moved = moveClip(project, "clip-1", -500);
  const clip = moved.tracks.find((track) => track.kind === "video").clips[0];
  assert.equal(clip.timelineStartMs, 0);
});

test("moves clips between same-family tracks only", () => {
  let project = projectWithClip();
  project = addTrack(project, "video");
  const targetTrack = project.tracks.filter((track) => track.kind === "video")[1];
  const moved = moveClipToTrack(project, "clip-1", targetTrack.id, 2000);
  assert.equal(moved.tracks.filter((track) => track.kind === "video")[0].clips.length, 0);
  assert.equal(moved.tracks.filter((track) => track.kind === "video")[1].clips[0].timelineStartMs, 2000);

  const rejected = moveClipToTrack(project, "clip-1", "no-such-track", 0);
  assert.equal(rejected, project);
  const textTrack = project.tracks.find((track) => track.kind === "text");
  const crossFamily = moveClipToTrack(project, "clip-1", textTrack.id, 0);
  assert.equal(crossFamily, project);
});

test("trims the start by shifting timeline start and source-in together", () => {
  const project = projectWithClip();
  const trimmed = trimClipStart(project, "clip-1", 1000);
  const clip = trimmed.tracks.find((track) => track.kind === "video").clips[0];
  assert.equal(clip.timelineStartMs, 2000);
  assert.equal(clip.durationMs, 3000);
  assert.equal(clip.sourceInMs, 1500);
});

test("trim start scales source-in by clip speed", () => {
  const project = projectWithClip({ speed: 2 });
  const trimmed = trimClipStart(project, "clip-1", 1000);
  const clip = trimmed.tracks.find((track) => track.kind === "video").clips[0];
  assert.equal(clip.timelineStartMs, 2000);
  assert.equal(clip.durationMs, 3000);
  // 1000ms of timeline at 2x speed consumes 2000ms of source media.
  assert.equal(clip.sourceInMs, 2500);
});

test("never trims below the minimum duration", () => {
  const project = projectWithClip();
  const trimmed = trimClipEnd(project, "clip-1", -100000);
  const clip = trimmed.tracks.find((track) => track.kind === "video").clips[0];
  assert.ok(clip.durationMs > 0);
});

test("extending a media clip time-stretches its source instead of reading past EOF", () => {
  const project = projectWithClip({ timelineStartMs: 0, sourceInMs: 0, durationMs: 3000, speed: 1 });
  const stretched = trimClipEnd(project, "clip-1", 2000);
  const clip = stretched.tracks.find((track) => track.kind === "video").clips[0];
  assert.equal(clip.durationMs, 5000);
  assertClose(clip.speed, 0.6);
  assertClose(clip.durationMs * clip.speed, 3000);
});

test("linked A/V end stretching keeps both partners at the same speed", () => {
  const linked = addMediaClip(
    makeStarterProject("stretch"),
    { path: "media/assets/av.mp4", kind: "video", durationMs: 3000, hasAudio: true },
  );
  const stretched = trimClips(
    linked.project,
    [linked.clipId, linked.audioClipId],
    "end",
    2000,
  );
  const pair = stretched.tracks.flatMap((track) => track.clips).filter((clip) => clip.linkId);
  assert.equal(pair.length, 2);
  assert.ok(pair.every((clip) => clip.durationMs === 5000));
  assert.ok(pair.every((clip) => Math.abs(clip.speed - 0.6) < 1e-9));
});

test("setClipSpeed rescales duration to preserve the consumed source span", () => {
  const project = projectWithClip(); // 4000ms of timeline at 1x = 4000ms of source
  const spedUp = setClipSpeed(project, "clip-1", 2);
  const clip = spedUp.tracks.find((track) => track.kind === "video").clips[0];
  assert.equal(clip.speed, 2);
  assert.equal(clip.durationMs, 2000);
  assertClose(clip.durationMs * clip.speed, 4000);

  const slowed = setClipSpeed(spedUp, "clip-1", 0.5);
  const slowClip = slowed.tracks.find((track) => track.kind === "video").clips[0];
  assert.equal(slowClip.speed, 0.5);
  assert.equal(slowClip.durationMs, 8000);
});

test("setClipSpeed keeps linked A/V partners in lockstep", () => {
  const linked = addMediaClip(
    makeStarterProject("speed"),
    { path: "media/assets/av.mp4", kind: "video", durationMs: 3000, hasAudio: true },
  );
  const spedUp = setClipSpeed(linked.project, linked.clipId, 1.5);
  const pair = spedUp.tracks.flatMap((track) => track.clips).filter((clip) => clip.linkId);
  assert.equal(pair.length, 2);
  assert.ok(pair.every((clip) => clip.speed === 1.5));
  assert.ok(pair.every((clip) => clip.durationMs === 2000));
});

test("setClipSpeed clamps the rate and refuses text, still images, and locked tracks", () => {
  const clamped = setClipSpeed(projectWithClip(), "clip-1", 99);
  assert.equal(clamped.tracks.find((track) => track.kind === "video").clips[0].speed, 8);

  const image = projectWithClip({ assetPath: "media/assets/a.png" });
  assert.equal(setClipSpeed(image, "clip-1", 2), image);

  const withText = addTextClip(makeStarterProject("text"), { text: "hi", timelineStartMs: 0 });
  assert.equal(setClipSpeed(withText.project, withText.clipId, 2), withText.project);

  const locked = projectWithClip();
  locked.tracks.find((track) => track.kind === "video").locked = true;
  assert.equal(setClipSpeed(locked, "clip-1", 2), locked);
});

test("splits a clip preserving source continuity and gain envelope", () => {
  const project = projectWithClip({
    gain: { level: 1, keyframes: [{ atMs: 0, level: 1 }, { atMs: 4000, level: 0 }] },
  });
  const split = splitClip(project, "clip-1", 3000); // 2000ms into the clip
  const clips = split.tracks.find((track) => track.kind === "video").clips;
  assert.equal(clips.length, 2);
  const [left, right] = clips;
  assert.equal(left.durationMs, 2000);
  assert.equal(right.timelineStartMs, 3000);
  assert.equal(right.durationMs, 2000);
  assert.equal(right.sourceInMs, 2500);
  // Envelope sampled at the cut: 2000/4000 → level 0.5 on both sides.
  assertClose(gainAtMs(left.gain, left.durationMs), 0.5);
  assertClose(gainAtMs(right.gain, 0), 0.5);
  assertClose(gainAtMs(right.gain, right.durationMs), 0);
});

test("rejects splits too close to clip edges", () => {
  const project = projectWithClip();
  assert.equal(splitClip(project, "clip-1", 1010), project);
  assert.equal(splitClip(project, "clip-1", 4990), project);
});

test("removes clips and respects locked tracks", () => {
  const project = projectWithClip();
  const removed = removeClip(project, "clip-1");
  assert.equal(removed.tracks.find((track) => track.kind === "video").clips.length, 0);

  const locked = normalizeProject({
    ...project,
    tracks: project.tracks.map((track) => ({ ...track, locked: track.kind === "video" })),
  });
  assert.equal(removeClip(locked, "clip-1"), locked);
});

test("videos with audio expand into a linked, separately-editable A/V pair", () => {
  const starter = makeStarterProject("x");
  const result = addMediaClip(
    starter,
    { path: "media/assets/talk.mp4", kind: "video", durationMs: 5000, hasAudio: true },
    { timelineStartMs: 1000 },
  );
  const videoClip = result.project.tracks.find((track) => track.kind === "video").clips[0];
  const audioClip = result.project.tracks.find((track) => track.kind === "audio").clips[0];
  assert.ok(result.audioClipId);
  assert.equal(audioClip.id, result.audioClipId);
  assert.equal(audioClip.timelineStartMs, videoClip.timelineStartMs);
  assert.equal(audioClip.durationMs, videoClip.durationMs);
  assert.equal(videoClip.linkId, audioClip.linkId);
  assert.ok(videoClip.linkId);
  assert.equal(videoClip.gain.level, 0); // sound lives on the audio partner
  assert.equal(audioClip.gain.level, 1);
  assert.equal(expandWithLinks(result.project, [videoClip.id]).length, 2);

  // No audio in the source → no partner.
  const silent = addMediaClip(starter, { path: "media/assets/b.mp4", kind: "video", hasAudio: false });
  assert.equal(silent.audioClipId, "");
  assert.equal(silent.project.tracks.find((track) => track.kind === "audio").clips.length, 0);
});

test("finished generated MP4s retrofit linked audio onto placeholder clips", () => {
  const placeholder = addMediaClip(
    makeStarterProject("generated"),
    { path: "media/generated/job.mp4", kind: "video", durationMs: 5000 },
    { timelineStartMs: 1200 },
  ).project;
  const upgraded = reconcileGeneratedAssetClips(placeholder, {
    path: "media/generated/job.mp4",
    kind: "video",
    durationMs: 3000,
    hasAudio: true,
  });
  const video = upgraded.tracks.find((track) => track.kind === "video").clips[0];
  const audio = upgraded.tracks.find((track) => track.kind === "audio").clips[0];
  assert.equal(audio.assetPath, video.assetPath);
  assert.equal(audio.timelineStartMs, 1200);
  assert.equal(video.durationMs, 3000);
  assert.equal(audio.durationMs, 3000);
  assert.equal(audio.linkId, video.linkId);
  assert.ok(video.linkId);
  assert.equal(video.gain.level, 0);

  // Repeated store refreshes are idempotent.
  assert.equal(reconcileGeneratedAssetClips(upgraded, {
    path: "media/generated/job.mp4",
    kind: "video",
    durationMs: 3000,
    hasAudio: true,
  }), upgraded);
});

test("clips never overlap: adds, moves, and group moves slide into free space", () => {
  let project = projectWithClip(); // clip-1 at 1000..5000
  // Add colliding → slides to 5000.
  const added = addMediaClip(project, { path: "media/assets/b.mp4", kind: "video", durationMs: 2000 }, { timelineStartMs: 2000 });
  project = added.project;
  const clips = project.tracks.find((track) => track.kind === "video").clips;
  assert.equal(clips[1].timelineStartMs, 5000);
  // Move the second clip into the first → pushed to the free gap after it.
  const moved = moveClip(project, added.clipId, 1500);
  assert.equal(moved.tracks.find((track) => track.kind === "video").clips[1].timelineStartMs, 5000);
  // Group move colliding with an outsider pushes the whole group clear.
  const third = addMediaClip(moved, { path: "media/assets/c.mp4", kind: "video", durationMs: 1000 }, { timelineStartMs: 9000 });
  const groupMoved = moveClips(third.project, ["clip-1", added.clipId], 7000);
  const after = groupMoved.tracks.find((track) => track.kind === "video").clips;
  const ids = after.map((clip) => clip.id);
  const first = after[ids.indexOf("clip-1")];
  // clip-1 (4000ms) proposed at 8000 overlaps 9000..10000 outsider → pushed to 10000.
  assert.equal(first.timelineStartMs, 10000);
  // Relative spacing preserved (partner was +4000 from clip-1).
  const partner = after.find((clip) => clip.id === added.clipId);
  assert.equal(partner.timelineStartMs - first.timelineStartMs, 4000);
});

test("adds media clips to a matching track and creates one when missing", () => {
  const starter = makeStarterProject("x");
  const withVideo = addMediaClip(starter, { path: "media/assets/v.mp4", kind: "video", durationMs: 2500 });
  const videoTrack = withVideo.project.tracks.find((track) => track.kind === "video");
  assert.equal(videoTrack.clips[0].assetPath, "media/assets/v.mp4");
  assert.equal(videoTrack.clips[0].durationMs, 2500);

  const withAudio = addMediaClip(withVideo.project, { path: "media/assets/a.mp3", kind: "audio" });
  const audioTrack = withAudio.project.tracks.find((track) => track.kind === "audio");
  assert.equal(audioTrack.clips.length, 1);

  const noTracks = normalizeProject({ tracks: [{ id: "t", kind: "text", label: "T1", clips: [] }] });
  const created = addMediaClip(noTracks, { path: "media/assets/v.mp4", kind: "video" });
  assert.ok(created.project.tracks.some((track) => track.kind === "video"));
});

test("adds text clips with defaults", () => {
  const result = addTextClip(makeStarterProject("x"), { timelineStartMs: 700, text: "Title" });
  const textTrack = result.project.tracks.find((track) => track.kind === "text");
  assert.equal(textTrack.clips[0].text, "Title");
  assert.equal(textTrack.clips[0].timelineStartMs, 700);
});

test("updates clip patches through normalization", () => {
  const project = projectWithClip();
  const updated = updateClip(project, "clip-1", { gain: { level: 9 }, speed: 99 });
  const clip = updated.tracks.find((track) => track.kind === "video").clips[0];
  assert.equal(clip.gain.level, 4); // clamped
  assert.equal(clip.speed, 8); // clamped
});

test("reports active clips at a playhead position, skipping muted tracks", () => {
  const project = projectWithClip();
  assert.equal(clipsAtMs(project, 2000).video.length, 1);
  assert.equal(clipsAtMs(project, 6000).video.length, 0);
  const muted = normalizeProject({
    ...project,
    tracks: project.tracks.map((track) => ({ ...track, muted: track.kind === "video" })),
  });
  assert.equal(clipsAtMs(muted, 2000).video.length, 0);
});

test("normalizes meme-style text fields with defaults", () => {
  const defaults = normalizeTextStyle({});
  assert.equal(defaults.outlineWidth, 0);
  assert.equal(defaults.outlineColor, "#000000");
  assert.equal(defaults.shadow, false);
  assert.equal(defaults.uppercase, false);
  const meme = normalizeTextStyle({ outlineWidth: 99, outlineColor: "#111111", shadow: true, uppercase: true });
  assert.equal(meme.outlineWidth, 40); // clamped
  assert.equal(meme.outlineColor, "#111111");
  assert.equal(meme.shadow, true);
  assert.equal(meme.uppercase, true);
});

test("moves clip groups by a shared clamped delta", () => {
  let project = projectWithClip();
  const added = addMediaClip(project, { path: "media/assets/b.mp4", kind: "video", durationMs: 2000 }, { timelineStartMs: 6000 });
  project = added.project;
  const moved = moveClips(project, ["clip-1", added.clipId], -2000);
  const clips = moved.tracks.find((track) => track.kind === "video").clips;
  // clip-1 started at 1000 → clamp shifts everything by -1000, preserving spacing.
  assert.equal(clips[0].timelineStartMs, 0);
  assert.equal(clips[1].timelineStartMs, 5000);
});

test("removeClips deletes every selected clip at once", () => {
  let project = projectWithClip();
  const added = addMediaClip(project, { path: "media/assets/b.mp4", kind: "video" }, { timelineStartMs: 8000 });
  project = added.project;
  const next = removeClips(project, ["clip-1", added.clipId]);
  assert.equal(next.tracks.find((track) => track.kind === "video").clips.length, 0);
});

test("ripple delete closes the gap on the same track", () => {
  let project = projectWithClip(); // clip-1 at 1000, dur 4000
  const added = addMediaClip(project, { path: "media/assets/b.mp4", kind: "video", durationMs: 2000 }, { timelineStartMs: 7000 });
  project = added.project;
  const next = rippleDeleteClip(project, "clip-1");
  const clips = next.tracks.find((track) => track.kind === "video").clips;
  assert.equal(clips.length, 1);
  assert.equal(clips[0].timelineStartMs, 3000); // 7000 - 4000
});

test("linked ripple delete removes the whole group and ripples each member track once", () => {
  let project = projectWithClip(); // linked pair at 1000..5000
  const audio = addMediaClip(
    project,
    { path: "media/assets/a.mp4", kind: "audio", durationMs: 4000 },
    { timelineStartMs: 1000 },
  );
  project = linkClips(audio.project, ["clip-1", audio.clipId]);
  const videoFollower = addMediaClip(
    project,
    { path: "media/assets/b.mp4", kind: "video", durationMs: 2000 },
    { timelineStartMs: 7000 },
  );
  const audioFollower = addMediaClip(
    videoFollower.project,
    { path: "media/assets/b.mp3", kind: "audio", durationMs: 2000 },
    { timelineStartMs: 7000 },
  );

  const next = rippleDeleteClip(audioFollower.project, "clip-1");
  const video = next.tracks.find((track) => track.kind === "video").clips;
  const audioClips = next.tracks.find((track) => track.kind === "audio").clips;
  assert.deepEqual(video.map((clip) => clip.id), [videoFollower.clipId]);
  assert.deepEqual(audioClips.map((clip) => clip.id), [audioFollower.clipId]);
  assert.equal(video[0].timelineStartMs, 3000);
  assert.equal(audioClips[0].timelineStartMs, 3000);
  assert.equal(projectDurationMs(next), 5000);
});

test("asymmetric linked ripple delete is selection-independent and shifts title tracks globally", () => {
  const project = normalizeProject({
    tracks: [
      {
        id: "v1",
        kind: "video",
        clips: [
          { id: "video-twin", assetPath: "a.mp4", timelineStartMs: 1000, durationMs: 4000, linkId: "pair" },
          { id: "video-follower", assetPath: "b.mp4", timelineStartMs: 5500, durationMs: 1000 },
        ],
      },
      {
        id: "a1",
        kind: "audio",
        clips: [
          { id: "audio-twin", assetPath: "a.mp3", timelineStartMs: 1000, durationMs: 2000, linkId: "pair" },
          { id: "audio-follower", assetPath: "b.mp3", timelineStartMs: 5200, durationMs: 1000 },
        ],
      },
      {
        id: "t1",
        kind: "text",
        clips: [{ id: "title", text: "Title", timelineStartMs: 7000, durationMs: 1000 }],
      },
    ],
  });

  const fromVideo = rippleDeleteClip(project, "video-twin");
  const fromAudio = rippleDeleteClip(project, "audio-twin");
  assert.deepEqual(fromVideo, fromAudio);
  assert.equal(fromVideo.tracks.find((track) => track.id === "t1").clips[0].timelineStartMs, 3000);
  const audio = fromVideo.tracks.find((track) => track.id === "a1").clips;
  assert.deepEqual(audio.map((clip) => clip.id), ["audio-follower"]);
  assert.equal(audio[0].timelineStartMs, 1200);
  for (let index = 1; index < audio.length; index += 1) {
    assert.ok(audio[index - 1].timelineStartMs + audio[index - 1].durationMs <= audio[index].timelineStartMs);
  }
});

test("linked ripple delete uses the union for multiple members on one track", () => {
  const project = normalizeProject({
    tracks: [
      {
        id: "v1",
        kind: "video",
        clips: [{ id: "v", assetPath: "a.mp4", timelineStartMs: 1000, durationMs: 4000, linkId: "group" }],
      },
      {
        id: "a1",
        kind: "audio",
        clips: [
          { id: "a-left", assetPath: "a.mp3", timelineStartMs: 1000, durationMs: 1000, linkId: "group" },
          { id: "a-right", assetPath: "a.mp3", timelineStartMs: 3000, durationMs: 1000, linkId: "group" },
          { id: "a-follow", assetPath: "b.mp3", timelineStartMs: 5500, durationMs: 500 },
        ],
      },
    ],
  });
  const fromLeft = rippleDeleteClip(project, "a-left");
  const fromRight = rippleDeleteClip(project, "a-right");
  assert.deepEqual(fromLeft, fromRight);
  assert.deepEqual(fromLeft.tracks.find((track) => track.id === "a1").clips.map((clip) => clip.id), ["a-follow"]);
  assert.equal(fromLeft.tracks.find((track) => track.id === "a1").clips[0].timelineStartMs, 1500);
});

test("snap points include zero, clip edges, and extras; snapMs respects threshold", () => {
  const project = projectWithClip(); // edges at 1000 and 5000
  const points = collectSnapPoints(project, [], [2500]);
  assert.ok(points.includes(0));
  assert.ok(points.includes(1000));
  assert.ok(points.includes(5000));
  assert.ok(points.includes(2500));
  assert.equal(snapMs(1080, points, 100), 1000);
  assert.equal(snapMs(1300, points, 100), 1300); // out of threshold
});

test("clipsInRange returns overlapping clips only", () => {
  const project = projectWithClip(); // 1000..5000
  assert.equal(clipsInRange(project, 0, 999).length, 0);
  assert.equal(clipsInRange(project, 4999, 9000).length, 1);
  assert.equal(clipsInRange(project, 0, 1001).length, 1);
});

test("keyframe interpolation honors linear, hold, and smooth easings", () => {
  const frames = [
    { atMs: 0, value: 0, easing: "linear" },
    { atMs: 1000, value: 1, easing: "hold" },
    { atMs: 2000, value: 0.5, easing: "smooth" },
    { atMs: 3000, value: 1, easing: "linear" },
  ];
  assert.equal(kfValueAtMs(frames, -50, 9), 0);
  assert.ok(Math.abs(kfValueAtMs(frames, 500, 9) - 0.5) < 1e-9); // linear
  assert.equal(kfValueAtMs(frames, 1500, 9), 1); // hold keeps previous value
  const smoothMid = kfValueAtMs(frames, 2500, 9); // smoothstep(0.5) = 0.5 → midpoint
  assert.ok(Math.abs(smoothMid - 0.75) < 1e-9);
  assert.equal(kfValueAtMs(frames, 9999, 9), 1);
  assert.equal(kfValueAtMs([], 100, 7), 7); // fallback
});

test("setClipKeyframe stores normalized frames and clipPropAtMs resolves them", () => {
  let project = projectWithClip();
  project = setClipKeyframe(project, "clip-1", "opacity", 0, 1);
  project = setClipKeyframe(project, "clip-1", "opacity", 2000, 0, "hold");
  const clip = project.tracks.find((track) => track.kind === "video").clips[0];
  assert.equal(clip.kf.opacity.length, 2);
  assert.ok(Math.abs(clipPropAtMs(clip, "opacity", 1000) - 0.5) < 1e-9);
  assert.equal(clipPropAtMs(clip, "scale", 1000), 1); // static fallback
});

test("split partitions property keyframes with boundary sampling", () => {
  let project = projectWithClip();
  project = setClipKeyframe(project, "clip-1", "opacity", 0, 1);
  project = setClipKeyframe(project, "clip-1", "opacity", 4000, 0);
  const split = splitClip(project, "clip-1", 3000); // 2000 into the clip
  const clips = split.tracks.find((track) => track.kind === "video").clips;
  const [left, right] = clips;
  assert.ok(Math.abs(kfValueAtMs(left.kf.opacity, left.durationMs, 9) - 0.5) < 1e-9);
  assert.ok(Math.abs(kfValueAtMs(right.kf.opacity, 0, 9) - 0.5) < 1e-9);
});

test("linked clips select, split, and unlink as a group", () => {
  let project = projectWithClip();
  const audio = addMediaClip(project, { path: "media/assets/a.mp3", kind: "audio", durationMs: 4000 }, { timelineStartMs: 1000 });
  project = audio.project;
  project = linkClips(project, ["clip-1", audio.clipId]);
  assert.equal(expandWithLinks(project, ["clip-1"]).length, 2);

  const split = splitLinkedAt(project, "clip-1", 3000);
  const videoClips = split.tracks.find((track) => track.kind === "video").clips;
  const audioClips = split.tracks.find((track) => track.kind === "audio").clips;
  assert.equal(videoClips.length, 2);
  assert.equal(audioClips.length, 2);
  // Right halves are linked to each other, left halves keep the original link.
  assert.ok(videoClips[1].linkId);
  assert.equal(videoClips[1].linkId, audioClips[1].linkId);
  assert.notEqual(videoClips[1].linkId, videoClips[0].linkId);

  const unlinked = unlinkClip(split, videoClips[0].id);
  assert.equal(expandWithLinks(unlinked, [videoClips[0].id]).length, 1);
});

test("copy/paste round-trips clips with fresh ids and remapped links", () => {
  let project = projectWithClip();
  const audio = addMediaClip(project, { path: "media/assets/a.mp3", kind: "audio", durationMs: 4000 }, { timelineStartMs: 1000 });
  project = linkClips(audio.project, ["clip-1", audio.clipId]);
  const payload = serializeClips(project, ["clip-1"]); // link expansion pulls the audio too
  assert.equal(payload.entries.length, 2);
  const pasted = pasteClips(project, payload, 9000);
  assert.equal(pasted.clipIds.length, 2);
  const videoClips = pasted.project.tracks.find((track) => track.kind === "video").clips;
  assert.equal(videoClips.length, 2);
  assert.equal(videoClips[1].timelineStartMs, 9000);
  const pastedVideo = videoClips[1];
  const pastedAudio = pasted.project.tracks.find((track) => track.kind === "audio").clips[1];
  assert.equal(pastedVideo.linkId, pastedAudio.linkId);
  assert.notEqual(pastedVideo.linkId, videoClips[0].linkId);
});

test("linked paste uses one placement delta when only one member track collides", () => {
  let project = projectWithClip(); // source pair at 1000..5000
  const audio = addMediaClip(
    project,
    { path: "media/assets/a.mp4", kind: "audio", durationMs: 4000 },
    { timelineStartMs: 1000 },
  );
  project = linkClips(audio.project, ["clip-1", audio.clipId]);
  const payload = serializeClips(project, ["clip-1"]);
  const blocker = addMediaClip(
    project,
    { path: "media/assets/blocker.mp4", kind: "video", durationMs: 1000 },
    { timelineStartMs: 6000 },
  );

  const pasted = pasteClips(blocker.project, payload, 6000);
  const pastedClips = pasted.clipIds.map((id) =>
    pasted.project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id),
  );
  assert.equal(pastedClips.length, 2);
  assert.equal(pastedClips[0].timelineStartMs, 7000);
  assert.equal(pastedClips[1].timelineStartMs, 7000);
  assert.equal(pastedClips[0].timelineStartMs - 1000, pastedClips[1].timelineStartMs - 1000);
  assert.ok(pastedClips[0].linkId);
  assert.equal(pastedClips[0].linkId, pastedClips[1].linkId);
});

test("linked group drag placement keeps one delta when only one member track collides", () => {
  let project = projectWithClip(); // source pair at 1000..5000
  const audio = addMediaClip(
    project,
    { path: "media/assets/a.mp4", kind: "audio", durationMs: 4000 },
    { timelineStartMs: 1000 },
  );
  project = linkClips(audio.project, ["clip-1", audio.clipId]);
  project = addMediaClip(
    project,
    { path: "media/assets/blocker.mp4", kind: "video", durationMs: 1000 },
    { timelineStartMs: 6000 },
  ).project;

  const moved = moveClips(project, ["clip-1", audio.clipId], 5000);
  const video = moved.tracks.find((track) => track.kind === "video").clips.find((clip) => clip.id === "clip-1");
  const audioClip = moved.tracks.find((track) => track.kind === "audio").clips.find((clip) => clip.id === audio.clipId);
  assert.equal(video.timelineStartMs, 7000);
  assert.equal(audioClip.timelineStartMs, 7000);
});

test("linked group drag resolves every alternating collision and is atomic across locks", () => {
  const target = (id, linkId) => ({
    id,
    assetPath: `media/assets/${id}.mp4`,
    timelineStartMs: 0,
    durationMs: 100,
    linkId,
  });
  const blocker = (index) => ({
    id: `blocker-${index}`,
    assetPath: `media/assets/blocker-${index}.mp4`,
    timelineStartMs: (index + 1) * 100,
    durationMs: 100,
  });
  const project = normalizeProject({
    tracks: [
      {
        id: "v1",
        kind: "video",
        clips: [target("video-target", "link-many"), ...Array.from({ length: 12 }, (_, index) => index % 2 === 0 ? blocker(index) : null).filter(Boolean)],
      },
      {
        id: "a1",
        kind: "audio",
        clips: [target("audio-target", "link-many"), ...Array.from({ length: 12 }, (_, index) => index % 2 === 1 ? blocker(index) : null).filter(Boolean)],
      },
    ],
  });

  const moved = moveClips(project, ["video-target", "audio-target"], 100);
  const movedVideo = moved.tracks[0].clips.find((clip) => clip.id === "video-target");
  const movedAudio = moved.tracks[1].clips.find((clip) => clip.id === "audio-target");
  assert.equal(movedVideo.timelineStartMs, 1300);
  assert.equal(movedAudio.timelineStartMs, 1300);

  const locked = normalizeProject({
    ...project,
    tracks: project.tracks.map((track) => ({ ...track, locked: track.kind === "audio" })),
  });
  assert.equal(moveClips(locked, ["video-target", "audio-target"], 500), locked);
});

test("paste resolves every alternating collision with one payload-wide delta", () => {
  const blocker = (index) => ({
    id: `blocker-${index}`,
    assetPath: `media/assets/blocker-${index}.mp4`,
    timelineStartMs: (index + 1) * 100,
    durationMs: 100,
  });
  const project = normalizeProject({
    tracks: [
      {
        id: "v1",
        kind: "video",
        clips: Array.from({ length: 12 }, (_, index) => index % 2 === 0 ? blocker(index) : null).filter(Boolean),
      },
      {
        id: "a1",
        kind: "audio",
        clips: Array.from({ length: 12 }, (_, index) => index % 2 === 1 ? blocker(index) : null).filter(Boolean),
      },
    ],
  });
  const payload = {
    kind: "diffforge-video-clips",
    baseMs: 0,
    entries: [
      { trackKind: "video", clip: { id: "source-v", assetPath: "v.mp4", timelineStartMs: 0, durationMs: 100 } },
      { trackKind: "audio", clip: { id: "source-a", assetPath: "a.mp3", timelineStartMs: 0, durationMs: 100 } },
    ],
  };

  const pasted = pasteClips(project, payload, 100);
  const clips = pasted.clipIds.map((id) =>
    pasted.project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id),
  );
  assert.deepEqual(clips.map((clip) => clip.timelineStartMs), [1300, 1300]);
});

test("serialize and paste preserve stacked V1/V2 overlays on their source lanes", () => {
  const project = normalizeProject({
    tracks: [
      {
        id: "v1",
        kind: "video",
        clips: [{ id: "base", assetPath: "base.mp4", timelineStartMs: 0, durationMs: 1000 }],
      },
      {
        id: "v2",
        kind: "video",
        clips: [{ id: "overlay", assetPath: "overlay.mp4", timelineStartMs: 200, durationMs: 500 }],
      },
      { id: "a1", kind: "audio", clips: [] },
    ],
  });
  const payload = serializeClips(project, ["base", "overlay"]);
  assert.equal(payload.version, 2);
  assert.deepEqual(payload.entries.map((entry) => entry.laneIndex), [0, 1]);

  const pasted = pasteClips(project, payload, 5000);
  const pastedBase = pasted.project.tracks[0].clips.find((clip) => pasted.clipIds.includes(clip.id));
  const pastedOverlay = pasted.project.tracks[1].clips.find((clip) => pasted.clipIds.includes(clip.id));
  assert.equal(pastedBase.timelineStartMs, 5000);
  assert.equal(pastedOverlay.timelineStartMs, 5200);
});

test("paste aborts atomically when the required destination lane is locked", () => {
  const source = normalizeProject({
    tracks: [
      { id: "v1", kind: "video", clips: [] },
      {
        id: "v2",
        kind: "video",
        clips: [{ id: "overlay", assetPath: "overlay.mp4", timelineStartMs: 0, durationMs: 500 }],
      },
    ],
  });
  const payload = serializeClips(source, ["overlay"]);
  const destination = normalizeProject({
    tracks: [
      { id: "dest-v1", kind: "video", clips: [] },
      { id: "dest-v2", kind: "video", locked: true, clips: [] },
    ],
  });

  const result = pasteClips(destination, payload, 1000);
  assert.equal(result.project, destination);
  assert.deepEqual(result.clipIds, []);
  assert.equal(result.blocked.reason, "locked-track");
  assert.equal(result.blocked.trackId, "dest-v2");
});

test("paste clears the link id from a single copied group member", () => {
  const project = makeStarterProject("paste orphan");
  const payload = {
    kind: "diffforge-video-clips",
    version: 2,
    baseMs: 0,
    entries: [{
      trackKind: "video",
      laneIndex: 0,
      clip: {
        id: "orphan-source",
        assetPath: "orphan.mp4",
        timelineStartMs: 0,
        durationMs: 500,
        linkId: "source-link",
      },
    }],
  };

  const result = pasteClips(project, payload, 1000);
  const clip = result.project.tracks.find((track) => track.kind === "video").clips[0];
  assert.equal(clip.linkId, "");
});

test("legacy paste applies one delta to all entries and keeps twins in sync", () => {
  const project = normalizeProject({
    tracks: [
      {
        id: "v1",
        kind: "video",
        clips: [{ id: "blocker", assetPath: "blocker.mp4", timelineStartMs: 1000, durationMs: 1000 }],
      },
      { id: "a1", kind: "audio", clips: [] },
    ],
  });
  const payload = {
    kind: "diffforge-video-clips",
    baseMs: 0,
    entries: [
      {
        trackKind: "video",
        clip: { id: "legacy-v", assetPath: "v.mp4", timelineStartMs: 0, durationMs: 500, linkId: "legacy-link" },
      },
      {
        trackKind: "audio",
        clip: { id: "legacy-a", assetPath: "a.mp3", timelineStartMs: 200, durationMs: 500, linkId: "legacy-link" },
      },
    ],
  };

  const result = pasteClips(project, payload, 1000);
  const clips = result.clipIds.map((id) =>
    result.project.tracks.flatMap((track) => track.clips).find((clip) => clip.id === id),
  );
  assert.deepEqual(clips.map((clip) => clip.timelineStartMs), [2000, 2200]);
  assert.equal(clips[0].timelineStartMs, 0 + 2000);
  assert.equal(clips[1].timelineStartMs, 200 + 2000);
  assert.equal(clips[0].linkId, clips[1].linkId);
});

test("rippleTrim start edge keeps the clip anchored and closes the gap", () => {
  let project = projectWithClip({ timelineStartMs: 0, durationMs: 1000, sourceInMs: 0 });
  const later = addMediaClip(project, { path: "media/assets/b.mp4", kind: "video", durationMs: 1000 }, { timelineStartMs: 1000 });
  project = later.project;
  const trimmed = rippleTrim(project, "clip-1", "start", 200);
  const clips = trimmed.tracks.find((track) => track.kind === "video").clips;
  assert.equal(clips[0].timelineStartMs, 0); // anchored — no leading gap
  assert.equal(clips[0].durationMs, 800);
  assert.equal(clips[0].sourceInMs, 200); // in-point moved
  assert.equal(clips[1].timelineStartMs, 800); // follower closed the gap, no overlap
});

test("split preserves hold easing across the boundary and unlinks the right half", () => {
  let project = projectWithClip();
  project = setClipKeyframe(project, "clip-1", "opacity", 0, 1, "hold");
  project = setClipKeyframe(project, "clip-1", "opacity", 4000, 0);
  project = linkClips(project, ["clip-1", addMediaClip(project, { path: "media/assets/x.mp3", kind: "audio" }).clipId]);
  // linkClips cloned — refind and split the video clip only (plain split).
  const split = splitClip(project, "clip-1", 3000); // offset 2000, inside the held segment
  const clips = split.tracks.find((track) => track.kind === "video").clips;
  const [left, right] = clips;
  assert.equal(right.linkId, ""); // plain split never inherits the link
  // Held segment: value stays 1 on both sides of the cut.
  assert.equal(kfValueAtMs(left.kf.opacity, left.durationMs, 9), 1);
  assert.equal(kfValueAtMs(right.kf.opacity, 0, 9), 1);
  assert.equal(kfValueAtMs(right.kf.opacity, 1000, 9), 1); // still holding until 2000
});

test("rippleDeleteRange slices envelopes on head and tail fragments", () => {
  let project = projectWithClip(); // 1000..5000
  project = setClipKeyframe(project, "clip-1", "opacity", 0, 1);
  project = setClipKeyframe(project, "clip-1", "opacity", 4000, 0);
  const next = rippleDeleteRange(project, 2000, 3000); // clip-relative 1000..2000
  const clips = next.tracks.find((track) => track.kind === "video").clips;
  const [head, tail] = clips;
  // Head boundary sampled at 1000 → 0.75; tail rebased boundary at cut → 0.5.
  assert.ok(Math.abs(kfValueAtMs(head.kf.opacity, head.durationMs, 9) - 0.75) < 1e-9);
  assert.ok(Math.abs(kfValueAtMs(tail.kf.opacity, 0, 9) - 0.5) < 1e-9);
  assert.ok(Math.abs(kfValueAtMs(tail.kf.opacity, tail.durationMs, 9) - 0) < 1e-9);
});

test("rippleTrim closes the gap behind a shortened clip", () => {
  let project = projectWithClip(); // clip-1 at 1000..5000
  const later = addMediaClip(project, { path: "media/assets/b.mp4", kind: "video", durationMs: 2000 }, { timelineStartMs: 5000 });
  project = later.project;
  const trimmed = rippleTrim(project, "clip-1", "end", -1000);
  const clips = trimmed.tracks.find((track) => track.kind === "video").clips;
  assert.equal(clips[0].durationMs, 3000);
  assert.equal(clips[1].timelineStartMs, 4000); // slid left by 1000
});

test("linked non-ripple and ripple trims preflight every locked member atomically", () => {
  const project = normalizeProject({
    tracks: [
      {
        id: "v1",
        kind: "video",
        clips: [{ id: "video", assetPath: "a.mp4", timelineStartMs: 0, durationMs: 2000, linkId: "pair" }],
      },
      {
        id: "a1",
        kind: "audio",
        locked: true,
        clips: [{ id: "audio", assetPath: "a.mp3", timelineStartMs: 0, durationMs: 2000, linkId: "pair" }],
      },
    ],
  });

  assert.equal(trimClips(project, ["video", "audio"], "start", 250), project);
  assert.equal(trimClips(project, ["video", "audio"], "end", -250), project);
  assert.equal(rippleTrim(project, "video", "start", 250), project);
  assert.equal(rippleTrim(project, "video", "end", -250), project);
  assert.equal(project.tracks[0].clips[0].durationMs, 2000);
  assert.equal(project.tracks[1].clips[0].durationMs, 2000);
});

test("rippleDeleteRange trims straddlers and closes the gap across tracks", () => {
  let project = projectWithClip(); // video 1000..5000
  const audio = addMediaClip(project, { path: "media/assets/a.mp3", kind: "audio", durationMs: 6000 }, { timelineStartMs: 0 });
  project = audio.project;
  const next = rippleDeleteRange(project, 2000, 3000);
  const video = next.tracks.find((track) => track.kind === "video").clips;
  const audioClips = next.tracks.find((track) => track.kind === "audio").clips;
  // Video: head 1000..2000 + tail (was 3000..5000) now starting at 2000.
  assert.equal(video.length, 2);
  assert.equal(video[0].durationMs, 1000);
  assert.equal(video[1].timelineStartMs, 2000);
  assert.equal(video[1].durationMs, 2000);
  assert.equal(video[1].sourceInMs, 500 + 2000); // source continuity preserved
  // Audio: 6000 → 5000 total, ending at 5000 (the new project duration).
  assert.equal(audioClips.reduce((sum, clip) => sum + clip.durationMs, 0), 5000);
  assert.equal(projectDurationMs(next), 5000);
});

test("rippleDeleteRange relinks the right fragments of a linked pair", () => {
  let project = projectWithClip(); // video 1000..5000
  const audio = addMediaClip(
    project,
    { path: "media/assets/a.mp4", kind: "audio", durationMs: 4000 },
    { timelineStartMs: 1000 },
  );
  project = linkClips(audio.project, ["clip-1", audio.clipId]);
  const videoTrack = project.tracks.find((track) => track.kind === "video");
  const originalLinkId = videoTrack.clips[0].linkId;

  const next = rippleDeleteRange(project, 2000, 3000, [videoTrack.id]);
  const video = next.tracks.find((track) => track.kind === "video").clips;
  const audioClips = next.tracks.find((track) => track.kind === "audio").clips;
  assert.equal(video.length, 2);
  assert.equal(audioClips.length, 2);
  assert.equal(video[0].linkId, originalLinkId);
  assert.equal(audioClips[0].linkId, originalLinkId);
  assert.ok(video[1].linkId);
  assert.equal(video[1].linkId, audioClips[1].linkId);
  assert.notEqual(video[1].linkId, originalLinkId);
});

test("range closure follows a long twin when the scoped short twin ends before the range", () => {
  const project = normalizeProject({
    tracks: [
      {
        id: "v1",
        kind: "video",
        clips: [
          { id: "short", assetPath: "a.mp4", timelineStartMs: 0, durationMs: 1000, linkId: "pair" },
          { id: "video-follow", assetPath: "b.mp4", timelineStartMs: 5000, durationMs: 500 },
        ],
      },
      {
        id: "a1",
        kind: "audio",
        clips: [
          { id: "long", assetPath: "a.mp3", timelineStartMs: 0, durationMs: 4000, linkId: "pair" },
          { id: "audio-follow", assetPath: "b.mp3", timelineStartMs: 5000, durationMs: 500 },
        ],
      },
    ],
  });

  const next = rippleDeleteRange(project, 2000, 3000, ["v1"]);
  assert.equal(next.tracks.find((track) => track.id === "v1").clips.find((clip) => clip.id === "video-follow").timelineStartMs, 4000);
  assert.equal(next.tracks.find((track) => track.id === "a1").clips.find((clip) => clip.id === "audio-follow").timelineStartMs, 4000);
  const audioTail = next.tracks.find((track) => track.id === "a1").clips.find((clip) => clip.timelineStartMs === 2000);
  assert.equal(audioTail.durationMs, 1000);
});

test("rippleDeleteRange puts a wholly-right third member in the complete right cohort", () => {
  const project = normalizeProject({
    tracks: [
      {
        id: "v1",
        kind: "video",
        clips: [{ id: "v-long", assetPath: "a.mp4", timelineStartMs: 1000, durationMs: 4000, linkId: "triple" }],
      },
      {
        id: "a1",
        kind: "audio",
        clips: [{ id: "a-long", assetPath: "a.mp3", timelineStartMs: 1000, durationMs: 4000, linkId: "triple" }],
      },
      {
        id: "v2",
        kind: "video",
        clips: [{ id: "v-right", assetPath: "overlay.mp4", timelineStartMs: 4000, durationMs: 1000, linkId: "triple" }],
      },
    ],
  });

  const next = rippleDeleteRange(project, 2000, 3000, ["v1"]);
  const all = next.tracks.flatMap((track) => track.clips);
  const right = all.filter((clip) => clip.timelineStartMs >= 2000);
  assert.equal(right.length, 3);
  assert.ok(right[0].linkId);
  assert.equal(new Set(right.map((clip) => clip.linkId)).size, 1);
  assert.notEqual(right[0].linkId, "triple");
  const left = all.filter((clip) => clip.timelineStartMs === 1000);
  assert.deepEqual(left.map((clip) => clip.linkId), ["triple", "triple"]);
});

test("rippleInsertGap splits straddlers and shifts later clips right", () => {
  const project = projectWithClip(); // 1000..5000
  const next = rippleInsertGap(project, 2000, 1500);
  const clips = next.tracks.find((track) => track.kind === "video").clips;
  assert.equal(clips.length, 2);
  assert.equal(clips[0].durationMs, 1000);
  assert.equal(clips[1].timelineStartMs, 3500);
});

test("rippleInsertGap relinks the right fragments of a linked pair", () => {
  let project = projectWithClip(); // video 1000..5000
  const audio = addMediaClip(
    project,
    { path: "media/assets/a.mp4", kind: "audio", durationMs: 4000 },
    { timelineStartMs: 1000 },
  );
  project = linkClips(audio.project, ["clip-1", audio.clipId]);
  const videoTrack = project.tracks.find((track) => track.kind === "video");
  const originalLinkId = videoTrack.clips[0].linkId;

  const next = rippleInsertGap(project, 3000, 1500, [videoTrack.id]);
  const video = next.tracks.find((track) => track.kind === "video").clips;
  const audioClips = next.tracks.find((track) => track.kind === "audio").clips;
  assert.equal(video.length, 2);
  assert.equal(audioClips.length, 2);
  assert.equal(video[1].timelineStartMs, 4500);
  assert.equal(audioClips[1].timelineStartMs, 4500);
  assert.ok(video[1].linkId);
  assert.equal(video[1].linkId, audioClips[1].linkId);
  assert.notEqual(video[1].linkId, originalLinkId);
});

test("rippleInsertGap partitions every member so no link id spans the gap", () => {
  const project = normalizeProject({
    tracks: [
      {
        id: "v1",
        kind: "video",
        clips: [{ id: "tiny-right", assetPath: "v.mp4", timelineStartMs: 0, durationMs: 3050, linkId: "triple" }],
      },
      {
        id: "a1",
        kind: "audio",
        clips: [{ id: "straddler", assetPath: "a.mp3", timelineStartMs: 0, durationMs: 5000, linkId: "triple" }],
      },
      {
        id: "v2",
        kind: "video",
        clips: [{ id: "wholly-right", assetPath: "overlay.mp4", timelineStartMs: 4000, durationMs: 500, linkId: "triple" }],
      },
    ],
  });

  const next = rippleInsertGap(project, 3000, 1000, ["v1"]);
  const all = next.tracks.flatMap((track) => track.clips);
  const leftIds = new Set(all.filter((clip) => clip.timelineStartMs < 3000).map((clip) => clip.linkId).filter(Boolean));
  const right = all.filter((clip) => clip.timelineStartMs >= 4000);
  const rightIds = new Set(right.map((clip) => clip.linkId).filter(Boolean));
  assert.equal(right.length, 2);
  assert.equal(rightIds.size, 1);
  assert.ok([...rightIds].every((linkId) => !leftIds.has(linkId)));
  assert.ok(!rightIds.has("triple"));
});

test("range ripple no-ops preserve project identity", () => {
  const project = projectWithClip();
  assert.equal(rippleDeleteRange(project, 9000, 10000), project);
  assert.equal(rippleDeleteRange(project, 2000, 3000, []), project);
  assert.equal(rippleInsertGap(project, 9000, 1000), project);
  assert.equal(rippleInsertGap(project, 2000, 1000, []), project);
});

test("range ripple rejects a linked group when one partner track is locked", () => {
  let project = projectWithClip();
  const audio = addMediaClip(
    project,
    { path: "media/assets/a.mp4", kind: "audio", durationMs: 4000 },
    { timelineStartMs: 1000 },
  );
  project = linkClips(audio.project, ["clip-1", audio.clipId]);
  const videoTrack = project.tracks.find((track) => track.kind === "video");
  project.tracks.find((track) => track.kind === "audio").locked = true;

  assert.equal(rippleDeleteRange(project, 2000, 3000, [videoTrack.id]), project);
  assert.equal(rippleInsertGap(project, 3000, 1500, [videoTrack.id]), project);
});

test("addCaptionsForClip maps source segments through trim and speed", () => {
  const project = projectWithClip({ sourceInMs: 1000, speed: 2 }); // shows source 1000..9000 over timeline 1000..5000
  const segments = [
    { startMs: 1000, endMs: 3000, text: "hello there world" },
    { startMs: 20000, endMs: 21000, text: "off screen" },
  ];
  const result = addCaptionsForClip(project, "clip-1", segments);
  assert.ok(result.count >= 1);
  const captionTrack = result.project.tracks.find((track) => track.label === "Captions");
  const first = captionTrack.clips[0];
  assert.equal(first.timelineStartMs, 1000); // (1000-1000)/2 + 1000
  assert.equal(first.captionGroup, "cap-clip-1");
  // Re-running replaces rather than duplicates.
  const rerun = addCaptionsForClip(result.project, "clip-1", segments);
  const rerunTrack = rerun.project.tracks.find((track) => track.label === "Captions");
  assert.equal(rerunTrack.clips.length, captionTrack.clips.length);
});

test("rippleDeleteWords removes word spans through the clip mapping", () => {
  const project = projectWithClip(); // source 500..4500 over timeline 1000..5000, speed 1
  const words = [
    { startMs: 1500, endMs: 1700, text: "um" },
    { startMs: 1750, endMs: 1900, text: "uh" }, // merges with previous (gap < 120)
  ];
  const result = rippleDeleteWords(project, "media/assets/a.mp4", words);
  assert.equal(result.ranges.length, 1);
  assert.equal(result.ranges[0].startMs, 2000); // 1000 + (1500-500)
  const clips = result.project.tracks.find((track) => track.kind === "video").clips;
  const total = clips.reduce((sum, clip) => sum + clip.durationMs, 0);
  assert.equal(total, 4000 - 400);
});

test("rippleDeleteWords dedupes linked-pair ranges and shortens the timeline once", () => {
  const linked = addMediaClip(
    makeStarterProject("linked words"),
    { path: "media/assets/a.mp4", kind: "video", durationMs: 4000, hasAudio: true },
    { timelineStartMs: 1000 },
  );
  const words = [
    { startMs: 500, endMs: 700, text: "um" },
    { startMs: 1500, endMs: 1700, text: "uh" },
  ];

  const result = rippleDeleteWords(linked.project, "media/assets/a.mp4", words);
  assert.deepEqual(result.ranges, [
    { startMs: 1500, endMs: 1700 },
    { startMs: 2500, endMs: 2700 },
  ]);
  assert.equal(projectDurationMs(result.project), 4600);
  for (const kind of ["video", "audio"]) {
    const total = result.project.tracks
      .find((track) => track.kind === kind)
      .clips.reduce((sum, clip) => sum + clip.durationMs, 0);
    assert.equal(total, 3600);
  }
});

test("rippleDeleteWords unions overlapping timeline mappings before rippling", () => {
  const clip = (id, timelineStartMs, linkId) => ({
    id,
    assetPath: "media/assets/a.mp4",
    timelineStartMs,
    durationMs: 1000,
    sourceInMs: 0,
    speed: 1,
    linkId,
  });
  const project = normalizeProject({
    tracks: [
      { id: "v1", kind: "video", clips: [clip("v1-clip", 0, "link-1")] },
      { id: "a1", kind: "audio", clips: [clip("a1-clip", 0, "link-1")] },
      { id: "v2", kind: "video", clips: [clip("v2-clip", 100, "link-2")] },
      { id: "a2", kind: "audio", clips: [clip("a2-clip", 100, "link-2")] },
    ],
  });

  const result = rippleDeleteWords(project, "media/assets/a.mp4", [
    { startMs: 500, endMs: 700, text: "um" },
  ]);
  assert.deepEqual(result.ranges, [{ startMs: 500, endMs: 800 }]);
  assert.equal(projectDurationMs(result.project), 800);
});

test("rippleDeleteWords aborts atomically when a linked member track is locked", () => {
  const project = normalizeProject({
    tracks: [
      {
        id: "v1",
        kind: "video",
        clips: [{
          id: "video-source",
          assetPath: "media/assets/a.mp4",
          timelineStartMs: 0,
          durationMs: 2000,
          sourceInMs: 0,
          speed: 1,
          linkId: "pair",
        }],
      },
      {
        id: "a1",
        kind: "audio",
        locked: true,
        clips: [{
          id: "locked-partner",
          assetPath: "media/assets/different.mp3",
          timelineStartMs: 0,
          durationMs: 4000,
          sourceInMs: 0,
          speed: 1,
          linkId: "pair",
        }],
      },
    ],
  });

  const result = rippleDeleteWords(project, "media/assets/a.mp4", [
    { startMs: 1500, endMs: 1700, text: "um" },
  ]);
  assert.equal(result.project, project);
  assert.deepEqual(result.ranges, []);
  assert.equal(result.blocked.reason, "locked-track");
  assert.equal(result.blocked.trackId, "a1");
});

test("rippleDeleteWords aborts every range when one of several ranges is locked", () => {
  const project = normalizeProject({
    tracks: [
      {
        id: "v1",
        kind: "video",
        clips: [{
          id: "open-source",
          assetPath: "media/assets/a.mp4",
          timelineStartMs: 0,
          durationMs: 1000,
          sourceInMs: 0,
          speed: 1,
        }],
      },
      {
        id: "v2",
        kind: "video",
        locked: true,
        clips: [{
          id: "locked-source",
          assetPath: "media/assets/a.mp4",
          timelineStartMs: 2000,
          durationMs: 1000,
          sourceInMs: 1000,
          speed: 1,
        }],
      },
    ],
  });

  const result = rippleDeleteWords(project, "media/assets/a.mp4", [
    { startMs: 100, endMs: 250, text: "first" },
    { startMs: 1100, endMs: 1250, text: "blocked" },
  ]);
  assert.equal(result.project, project);
  assert.deepEqual(result.ranges, []);
  assert.equal(result.blocked.reason, "locked-track");
  assert.equal(result.blocked.trackId, "v2");
  assert.equal(project.tracks[0].clips[0].durationMs, 1000);
});

test("rippleDeleteWords reports an expanded effective range for a sub-80ms remnant", () => {
  const project = normalizeProject({
    tracks: [{
      id: "v1",
      kind: "video",
      clips: [{
        id: "fast",
        assetPath: "media/assets/fast.mp4",
        timelineStartMs: 0,
        durationMs: 1000,
        sourceInMs: 0,
        speed: 2,
      }],
    }],
  });

  const result = rippleDeleteWords(project, "media/assets/fast.mp4", [
    { startMs: 100, endMs: 300, text: "fast word" },
  ]);
  assert.deepEqual(result.ranges, [{ startMs: 0, endMs: 150 }]);
  const clips = result.project.tracks[0].clips;
  assert.equal(clips.length, 1);
  assert.equal(clips[0].timelineStartMs, 0);
  assert.equal(clips[0].durationMs, 850);
  assert.equal(clips[0].sourceInMs, 300);
});

test("rippleDeleteWords merges transcript gaps through 120ms inclusive", () => {
  assert.equal(RIPPLE_DELETE_WORDS_MERGE_GAP_MS, 120);
  const cases = [
    [79, [{ startMs: 1000, endMs: 1279 }], 4721],
    [80, [{ startMs: 1000, endMs: 1280 }], 4720],
    [100, [{ startMs: 1000, endMs: 1300 }], 4700],
    [120, [{ startMs: 1000, endMs: 1320 }], 4680],
    [121, [{ startMs: 1000, endMs: 1100 }, { startMs: 1221, endMs: 1321 }], 4800],
  ];
  for (const [gapMs, expectedRanges, expectedDurationMs] of cases) {
    const project = normalizeProject({
      tracks: [{
        id: "v1",
        kind: "video",
        clips: [{
          id: `source-${gapMs}`,
          assetPath: "media/assets/gaps.mp4",
          timelineStartMs: 0,
          durationMs: 5000,
          sourceInMs: 0,
          speed: 1,
        }],
      }],
    });
    const result = rippleDeleteWords(project, "media/assets/gaps.mp4", [
      { startMs: 1000, endMs: 1100, text: "first" },
      { startMs: 1100 + gapMs, endMs: 1200 + gapMs, text: "second" },
    ]);
    assert.deepEqual(result.ranges, expectedRanges, `gap ${gapMs}`);
    assert.equal(
      result.project.tracks[0].clips.reduce((sum, clip) => sum + clip.durationMs, 0),
      expectedDurationMs,
      `gap ${gapMs}`,
    );
  }
});

test("formats timecodes", () => {
  assert.equal(formatTimecode(0), "0:00");
  assert.equal(formatTimecode(65000), "1:05");
  assert.equal(formatTimecode(3723000), "1:02:03");
  assert.equal(formatTimecode(1500, { withMs: true }), "0:01.500");
});

// Motion presets — parity with the Rust mirror (video_mcp_apply_motion_preset
// in src-tauri/src/video_editor.rs); both suites assert the same numbers.
test("motionPresetPatch kenburns-in covers a square image and clamps the pan", () => {
  const patch = motionPresetPatch("kenburns-in", {
    durationMs: 4000,
    assetWidth: 1000,
    assetHeight: 1000,
    frameWidth: 1920,
    frameHeight: 1080,
  });
  assert.equal(patch.motion, "kenburns-in");
  assert.equal(patch.kf.scale[0].atMs, 0);
  assert.equal(patch.kf.scale[1].atMs, 4000);
  assert.ok(Math.abs(patch.kf.scale[0].value - 1.8133) < 0.0005);
  assert.ok(Math.abs(patch.kf.scale[1].value - 2.0267) < 0.0005);
  // Desired x amplitude 0.012 clamps to the 0.01 slack left by the zoom.
  assert.ok(Math.abs(patch.kf.x[0].value + 0.01) < 0.0005);
  assert.ok(Math.abs(patch.kf.x[1].value - 0.01) < 0.0005);
  assert.equal(patch.kf.scale[0].easing, "smooth");
  assert.ok(Math.abs(patch.transform.scale - 1.8133) < 0.0005);
});

test("motionPresetPatch pan-left with matching aspect keeps constant zoom on transform", () => {
  const patch = motionPresetPatch("pan-left", {
    durationMs: 3000,
    assetWidth: 1920,
    assetHeight: 1080,
    frameWidth: 1920,
    frameHeight: 1080,
  });
  assert.equal(patch.kf.scale, undefined);
  assert.ok(Math.abs(patch.transform.scale - 1.1) < 0.0005);
  assert.ok(Math.abs(patch.kf.x[0].value - 0.05) < 0.0005);
  assert.ok(Math.abs(patch.kf.x[1].value + 0.05) < 0.0005);
  assert.equal(patch.kf.y, undefined);
});

test("motionPresetPatch none clears motion but keeps opacity keyframes", () => {
  const patch = motionPresetPatch("none", {
    existingKf: { opacity: [{ atMs: 0, value: 0, easing: "linear" }] },
    existingTransform: { opacity: 0.8 },
  });
  assert.equal(patch.motion, "");
  assert.equal(patch.kf.scale, undefined);
  assert.equal(patch.kf.x, undefined);
  assert.equal(patch.kf.opacity.length, 1);
  assert.equal(patch.transform.scale, 1);
  assert.equal(patch.transform.opacity, 0.8);
});

test("motionPresetPatch strength scales amplitudes", () => {
  const subtle = motionPresetPatch("kenburns-in", { durationMs: 2000, strength: "subtle" });
  const bold = motionPresetPatch("kenburns-in", { durationMs: 2000, strength: "bold" });
  const subtleZoom = subtle.kf.scale[1].value - subtle.kf.scale[0].value;
  const boldZoom = bold.kf.scale[1].value - bold.kf.scale[0].value;
  assert.ok(boldZoom > subtleZoom * 2);
});

// --- Tier 1: bezier easing parity fixtures (contract docs/tier1-contract-2026-07-10.md §3)

test("cubic bezier easings match the shared parity fixtures", () => {
  const fixtures = {
    "ease-in": [0.017026, 0.093465, 0.315357, 0.621861, 0.839428],
    "ease-out": [0.160572, 0.378139, 0.684643, 0.906535, 0.982974],
    "ease-in-out": [0.019722, 0.129162, 0.499999, 0.870838, 0.980278],
  };
  const ts = [0.1, 0.25, 0.5, 0.75, 0.9];
  for (const [easing, expected] of Object.entries(fixtures)) {
    ts.forEach((t, index) => {
      assert.ok(
        Math.abs(cubicBezierEase(easing, t) - expected[index]) < 1e-4,
        `${easing} at t=${t}`,
      );
    });
  }
});

test("keyframe interpolation honors bezier easing", () => {
  const frames = [
    { atMs: 0, value: 0, easing: "ease-in" },
    { atMs: 1000, value: 100, easing: "linear" },
  ];
  const mid = kfValueAtMs(frames, 500, 0);
  assert.ok(Math.abs(mid - 31.5357) < 0.1, `got ${mid}`);
});

test("normalizeProject keeps bezier easings on keyframes", () => {
  const project = normalizeProject({
    tracks: [{
      kind: "video",
      clips: [{
        id: "c1", assetPath: "media/assets/a.mp4", timelineStartMs: 0, durationMs: 1000,
        kf: { opacity: [{ atMs: 0, value: 0, easing: "ease-in-out" }, { atMs: 900, value: 1, easing: "bogus" }] },
      }],
    }],
  });
  const frames = project.tracks[0].clips[0].kf.opacity;
  assert.equal(frames[0].easing, "ease-in-out");
  assert.equal(frames[1].easing, "linear");
});

// --- Tier 1: fx + crop normalization

test("normalizeFx returns null at defaults and clamps ranges", () => {
  assert.equal(normalizeFx(null), null);
  assert.equal(normalizeFx({ exposure: 0, contrast: 1 }), null);
  const fx = normalizeFx({ exposure: 9, saturation: -2, blend: "screen", chromaKey: { color: "#00ff00" } });
  assert.equal(fx.exposure, 2);
  assert.equal(fx.saturation, 0);
  assert.equal(fx.blend, "screen");
  assert.equal(fx.chromaKey.similarity, 0.2);
});

test("normalizeClip carries fx and crop only when meaningful", () => {
  const project = normalizeProject({
    tracks: [{
      kind: "video",
      clips: [
        { id: "plain", assetPath: "a.mp4", timelineStartMs: 0, durationMs: 1000, fx: { contrast: 1 }, crop: { l: 0 } },
        { id: "graded", assetPath: "a.mp4", timelineStartMs: 1000, durationMs: 1000, fx: { blur: 4 }, crop: { l: 0.6, r: 0.1 } },
      ],
    }],
  });
  const [plain, graded] = project.tracks[0].clips;
  assert.equal(plain.fx, undefined);
  assert.equal(plain.crop, undefined);
  assert.equal(graded.fx.blur, 4);
  assert.equal(graded.crop.l, 0.45); // clamped
  assert.equal(graded.crop.r, 0.1);
});

// --- Tier 1: transitions

function transitionFixture() {
  return normalizeProject({
    tracks: [{
      id: "v1", kind: "video",
      clips: [
        { id: "a", assetPath: "a.mp4", timelineStartMs: 0, durationMs: 4000 },
        { id: "b", assetPath: "b.mp4", timelineStartMs: 4000, durationMs: 4000 },
      ],
    }],
  });
}

test("addTransition validates adjacency and clamps duration", () => {
  const project = transitionFixture();
  const next = addTransition(project, "v1", "a", "wipe-left", 60000);
  const transition = next.tracks[0].transitions[0];
  assert.equal(transition.kind, "wipe-left");
  assert.equal(transition.durationMs, 2000); // half the shorter neighbor
  // Non-adjacent afterClipId (last clip) is rejected.
  assert.equal(addTransition(project, "v1", "b", "crossfade", 500), project);
});

test("transition duration clamp needs adjacency", () => {
  const project = transitionFixture();
  assert.equal(clampTransitionDurationMs(project.tracks[0], "b", 500), 0);
  assert.equal(clampTransitionDurationMs(project.tracks[0], "a", 500), 500);
});

test("edits that break adjacency prune the transition", () => {
  let project = addTransition(transitionFixture(), "v1", "a", "crossfade", 800);
  assert.equal(project.tracks[0].transitions.length, 1);
  const moved = moveClip(project, "b", 6000);
  assert.equal(moved.tracks[0].transitions, undefined);
  // Removing the trailing clip also prunes.
  const removed = removeClips(project, ["b"]);
  assert.equal(removed.tracks[0].transitions, undefined);
  // A no-op edit keeps it.
  const kept = moveClip(project, "b", 4000);
  assert.equal(kept.tracks[0].transitions?.length, 1);
});

test("removeTransition and setTransitionDuration work by id", () => {
  const project = addTransition(transitionFixture(), "v1", "a", "dip-black", 600);
  const id = project.tracks[0].transitions[0].id;
  const longer = setTransitionDuration(project, id, 1400);
  assert.equal(longer.tracks[0].transitions[0].durationMs, 1400);
  const gone = removeTransition(project, id);
  assert.equal(gone.tracks[0].transitions, undefined);
  assert.equal(removeTransition(project, "missing"), project);
});

// --- Tier 1: words + text animation

test("normalizeWords filters and sorts word timings", () => {
  assert.equal(normalizeWords([], 1000), null);
  const words = normalizeWords(
    [
      { text: "world", startMs: 400, endMs: 700 },
      { text: "hello", startMs: 0, endMs: 300 },
      { text: "", startMs: 100, endMs: 200 },
      { text: "late", startMs: 2000, endMs: 2100 },
    ],
    1000,
  );
  assert.equal(words.length, 2);
  assert.equal(words[0].text, "hello");
});

test("text clips normalize anim and words", () => {
  const project = normalizeProject({
    tracks: [{
      kind: "text",
      clips: [{
        id: "t1", text: "hello world", timelineStartMs: 0, durationMs: 1000,
        anim: "word-highlight",
        words: [{ text: "hello", startMs: 0, endMs: 300 }, { text: "world", startMs: 300, endMs: 700 }],
      }],
    }],
  });
  const clip = project.tracks[0].clips[0];
  assert.equal(clip.anim, "word-highlight");
  assert.equal(clip.words.length, 2);
  assert.equal(clip.animOpts.highlightColor, "#fbbf24");
});

// --- Iron-out regressions (adversarial round) --------------------------------

test("transition clamp rejects neighbors shorter than the 100ms minimum", () => {
  const project = normalizeProject({
    tracks: [{
      id: "v1", kind: "video",
      clips: [
        { id: "a", assetPath: "a.mp4", timelineStartMs: 0, durationMs: 150 },
        { id: "b", assetPath: "b.mp4", timelineStartMs: 150, durationMs: 150 },
      ],
    }],
  });
  assert.equal(clampTransitionDurationMs(project.tracks[0], "a", 500), 0);
  assert.equal(addTransition(project, "v1", "a", "crossfade", 500), project);
});

test("splitting the leading clip retargets its transition to the right fragment", () => {
  let project = normalizeProject({
    tracks: [{
      id: "v1", kind: "video",
      clips: [
        { id: "a", assetPath: "a.mp4", timelineStartMs: 0, durationMs: 4000 },
        { id: "b", assetPath: "b.mp4", timelineStartMs: 4000, durationMs: 4000 },
      ],
    }],
  });
  project = addTransition(project, "v1", "a", "crossfade", 800);
  const next = splitClip(project, "a", 2000);
  const track = next.tracks[0];
  assert.equal(track.transitions?.length, 1);
  const rightHalf = track.clips.find((clip) => clip.timelineStartMs === 2000);
  assert.equal(track.transitions[0].afterClipId, rightHalf.id);
});

test("transitions are rejected on audio tracks", () => {
  const project = normalizeProject({
    tracks: [{
      id: "a1", kind: "audio",
      clips: [
        { id: "x", assetPath: "x.mp3", timelineStartMs: 0, durationMs: 2000 },
        { id: "y", assetPath: "y.mp3", timelineStartMs: 2000, durationMs: 2000 },
      ],
      transitions: [{ id: "t", afterClipId: "x", kind: "crossfade", durationMs: 400 }],
    }],
  });
  assert.equal(project.tracks[0].transitions, undefined);
  assert.equal(addTransition(project, "a1", "x", "crossfade", 400), project);
});

test("removeClip prunes transitions whose junction it destroyed", () => {
  let project = normalizeProject({
    tracks: [{
      id: "v1", kind: "video",
      clips: [
        { id: "a", assetPath: "a.mp4", timelineStartMs: 0, durationMs: 2000 },
        { id: "b", assetPath: "b.mp4", timelineStartMs: 2000, durationMs: 2000 },
      ],
    }],
  });
  project = addTransition(project, "v1", "a", "crossfade", 400);
  const next = removeClip(project, "b");
  assert.equal(next.tracks[0].transitions, undefined);
});

test("addCaptionsForClip maps segment words into clip-relative words", () => {
  const project = normalizeProject({
    tracks: [{
      id: "v1", kind: "video",
      clips: [{ id: "src", assetPath: "talk.mp4", timelineStartMs: 0, durationMs: 4000, sourceInMs: 1000, speed: 1 }],
    }],
  });
  const { project: next, count } = addCaptionsForClip(project, "src", [
    {
      startMs: 1200,
      endMs: 2200,
      text: "hello brave world",
      words: [
        { text: "hello", startMs: 1200, endMs: 1500 },
        { text: "brave", startMs: 1500, endMs: 1800 },
        { text: "world", startMs: 1800, endMs: 2200 },
      ],
    },
  ]);
  assert.equal(count, 1);
  const caption = next.tracks.find((track) => track.kind === "text").clips[0];
  assert.equal(caption.words.length, 3);
  assert.deepEqual(caption.words[0], { text: "hello", startMs: 0, endMs: 300 });
  assert.deepEqual(caption.words[2], { text: "world", startMs: 600, endMs: 1000 });
});

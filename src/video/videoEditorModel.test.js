import assert from "node:assert/strict";
import test from "node:test";

import {
  addCaptionsForClip,
  addMediaClip,
  addTextClip,
  addTrack,
  clipPropAtMs,
  clipsAtMs,
  clipsInRange,
  collectSnapPoints,
  expandWithLinks,
  formatTimecode,
  gainAtMs,
  kfValueAtMs,
  linkClips,
  makeStarterProject,
  moveClip,
  moveClips,
  moveClipToTrack,
  normalizeProject,
  normalizeTextStyle,
  pasteClips,
  projectDurationMs,
  removeClip,
  removeClips,
  rippleDeleteClip,
  rippleDeleteRange,
  rippleDeleteWords,
  rippleInsertGap,
  rippleTrim,
  serializeClips,
  setClipKeyframe,
  snapMs,
  splitClip,
  splitLinkedAt,
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

test("rippleInsertGap splits straddlers and shifts later clips right", () => {
  const project = projectWithClip(); // 1000..5000
  const next = rippleInsertGap(project, 2000, 1500);
  const clips = next.tracks.find((track) => track.kind === "video").clips;
  assert.equal(clips.length, 2);
  assert.equal(clips[0].durationMs, 1000);
  assert.equal(clips[1].timelineStartMs, 3500);
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

test("formats timecodes", () => {
  assert.equal(formatTimecode(0), "0:00");
  assert.equal(formatTimecode(65000), "1:05");
  assert.equal(formatTimecode(3723000), "1:02:03");
  assert.equal(formatTimecode(1500, { withMs: true }), "0:01.500");
});

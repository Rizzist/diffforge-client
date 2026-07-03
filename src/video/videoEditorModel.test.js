import assert from "node:assert/strict";
import test from "node:test";

import {
  addMediaClip,
  addTextClip,
  addTrack,
  clipsAtMs,
  formatTimecode,
  gainAtMs,
  makeStarterProject,
  moveClip,
  moveClipToTrack,
  normalizeProject,
  projectDurationMs,
  removeClip,
  splitClip,
  trimClipEnd,
  trimClipStart,
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

test("formats timecodes", () => {
  assert.equal(formatTimecode(0), "0:00");
  assert.equal(formatTimecode(65000), "1:05");
  assert.equal(formatTimecode(3723000), "1:02:03");
  assert.equal(formatTimecode(1500, { withMs: true }), "0:01.500");
});

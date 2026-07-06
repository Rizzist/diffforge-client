import test from "node:test";
import assert from "node:assert/strict";
import { buildKeepRanges, detectTakeGroups, normalizeTakeTokens, takeSimilarity } from "./videoTakes.js";

const seg = (startMs, endMs, text) => ({ startMs, endMs, text });

test("normalizeTakeTokens strips punctuation and fillers", () => {
  assert.deepEqual(normalizeTakeTokens("Um, so TODAY — we're live!"), ["so", "today", "we're", "live"]);
});

test("takeSimilarity is high for a false start vs the full take", () => {
  const a = normalizeTakeTokens("So today we're going to");
  const b = normalizeTakeTokens("So today we're going to talk about the new editor");
  assert.ok(takeSimilarity(a, b) >= 0.8);
});

test("takeSimilarity is low for unrelated lines", () => {
  const a = normalizeTakeTokens("So today we're going to talk about the editor");
  const b = normalizeTakeTokens("Thanks for watching, see you next week");
  assert.ok(takeSimilarity(a, b) < 0.3);
});

test("detectTakeGroups groups consecutive retakes and recommends the last complete one", () => {
  const segments = [
    seg(0, 2000, "Hey everyone welcome back to the channel"),
    seg(2500, 4000, "So today we're going to"),
    seg(4500, 9000, "So today we're going to talk about the new video editor"),
    seg(9500, 14000, "So today we're going to talk about the brand new video editor"),
    seg(15000, 20000, "Let's jump right into the timeline"),
  ];
  const groups = detectTakeGroups(segments);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].takes.length, 3);
  assert.deepEqual(
    groups[0].takes.map((take) => take.segmentIndex),
    [1, 2, 3],
  );
  // Last take is complete → recommended.
  assert.equal(groups[0].recommendedIndex, 2);
});

test("detectTakeGroups recommends the last COMPLETE take when the final one is a fragment", () => {
  const segments = [
    seg(0, 5000, "The quick brown fox jumps over the lazy dog every single morning"),
    seg(5500, 7000, "The quick brown fox"),
  ];
  const groups = detectTakeGroups(segments);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].recommendedIndex, 0);
});

test("detectTakeGroups does not group across long gaps", () => {
  const segments = [
    seg(0, 2000, "So today we're going to talk about pricing"),
    seg(60000, 62000, "So today we're going to talk about pricing"),
  ];
  assert.equal(detectTakeGroups(segments).length, 0);
});

test("buildKeepRanges drops unselected takes and complements the timeline", () => {
  const groups = [
    {
      id: "take-1",
      recommendedIndex: 1,
      takes: [
        { segmentIndex: 1, startMs: 2000, endMs: 4000, text: "a" },
        { segmentIndex: 2, startMs: 4500, endMs: 9000, text: "b" },
      ],
    },
  ];
  const { keepRanges, droppedMs, droppedCount } = buildKeepRanges({
    durationMs: 20000,
    groups,
    selections: {},
  });
  assert.deepEqual(keepRanges, [
    { startMs: 0, endMs: 2000 },
    { startMs: 4000, endMs: 20000 },
  ]);
  assert.equal(droppedMs, 2000);
  assert.equal(droppedCount, 1);
});

test("buildKeepRanges keep-all selection leaves the timeline untouched", () => {
  const groups = [
    {
      id: "take-1",
      recommendedIndex: 0,
      takes: [
        { segmentIndex: 0, startMs: 0, endMs: 1000, text: "a" },
        { segmentIndex: 1, startMs: 1000, endMs: 2000, text: "b" },
      ],
    },
  ];
  const { keepRanges, droppedMs } = buildKeepRanges({
    durationMs: 5000,
    groups,
    selections: { "take-1": -1 },
  });
  assert.deepEqual(keepRanges, [{ startMs: 0, endMs: 5000 }]);
  assert.equal(droppedMs, 0);
});

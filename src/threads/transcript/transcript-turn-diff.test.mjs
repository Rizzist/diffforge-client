import test from "node:test";
import assert from "node:assert/strict";

import {
  attachTurnRecordsToGroups,
  buildTranscriptRows,
  extractTurnDiffs,
  flattenTranscriptItems,
  groupRowsIntoTurns,
  isTurnDiffMessage,
  normalizeTurnDiff,
  turnDiffSyntheticMessage,
} from "./builders.mjs";

/* ------------------------------------------------------------------ */
/* Fixtures (§1 pinned turn_diff contract)                              */
/* ------------------------------------------------------------------ */

function turnDiffMessage(overrides = {}) {
  return {
    id: "td-1",
    role: "system",
    kind: "turn_diff",
    turn_id: "turn-1",
    timestamp: "2026-07-07T12:01:00.000Z",
    files: [
      {
        path: "src/lib.rs",
        kind: "edit",
        additions: 2,
        deletions: 1,
        patch: "--- a/src/lib.rs\n+++ b/src/lib.rs\n@@ -1,2 +1,3 @@\n fn main() {\n-    old();\n+    new();\n+    extra();\n",
      },
      {
        path: "assets/logo.png",
        kind: "create",
        additions: 0,
        deletions: 0,
        binary: true,
      },
    ],
    total_additions: 2,
    total_deletions: 1,
    ...overrides,
  };
}

function turnItems() {
  return [
    {
      id: "u-1",
      type: "message",
      turn_id: "turn-1",
      message: {
        id: "u-1",
        role: "user",
        content: "Change it",
        turn_id: "turn-1",
        timestamp: "2026-07-07T12:00:00.000Z",
      },
    },
    {
      id: "t-1",
      type: "message",
      turn_id: "turn-1",
      message: {
        id: "t-1",
        role: "activity",
        kind: "tool-call",
        turn_id: "turn-1",
        timestamp: "2026-07-07T12:00:30.000Z",
        tool: { name: "apply_patch", status: "completed" },
      },
    },
    {
      id: "a-1",
      type: "message",
      turn_id: "turn-1",
      message: {
        id: "a-1",
        role: "assistant",
        content: "Done.",
        turn_id: "turn-1",
        timestamp: "2026-07-07T12:00:55.000Z",
      },
    },
    {
      id: "u-2",
      type: "message",
      turn_id: "turn-2",
      message: {
        id: "u-2",
        role: "user",
        content: "Now the next thing",
        turn_id: "turn-2",
        timestamp: "2026-07-07T12:05:00.000Z",
      },
    },
    {
      id: "a-2",
      type: "message",
      turn_id: "turn-2",
      message: {
        id: "a-2",
        role: "assistant",
        content: "Working on it.",
        turn_id: "turn-2",
        timestamp: "2026-07-07T12:05:10.000Z",
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Detection + normalization                                            */
/* ------------------------------------------------------------------ */

test("isTurnDiffMessage detects turn_diff kind variants", () => {
  assert.equal(isTurnDiffMessage(turnDiffMessage()), true);
  assert.equal(isTurnDiffMessage({ kind: "turn-diff" }), true);
  assert.equal(isTurnDiffMessage({ message_kind: "turn_diff" }), true);
  assert.equal(isTurnDiffMessage({ kind: "turn_summary" }), false);
  assert.equal(isTurnDiffMessage({}), false);
});

test("normalizeTurnDiff reads the §1 contract with camelCase aliases", () => {
  const diff = normalizeTurnDiff(turnDiffMessage());
  assert.equal(diff.turn_id, "turn-1");
  assert.equal(diff.files.length, 2);
  assert.equal(diff.total_additions, 2);
  assert.equal(diff.total_deletions, 1);
  assert.equal(diff.truncated, false);
  assert.equal(diff.files[0].patch.includes("@@ -1,2 +1,3 @@"), true);
  assert.equal(diff.files[1].binary, true);

  const camel = normalizeTurnDiff({
    kind: "turn_diff",
    turn_id: "turn-9",
    files: [{ path: "a.js", additions: 1, deletions: 0 }],
    total_additions: 1,
    total_deletions: 0,
    truncated: true,
  });
  assert.equal(camel.turn_id, "turn-9");
  assert.equal(camel.total_additions, 1);
  assert.equal(camel.truncated, true);
});

test("normalizeTurnDiff falls back to summed totals and message timestamp window", () => {
  const diff = normalizeTurnDiff({
    kind: "turn_diff",
    turn_id: "turn-1",
    timestamp: "2026-07-07T12:01:00.000Z",
    files: [
      { path: "a.js", additions: 4, deletions: 2 },
      { path: "b.js", additions: 1, deletions: 0 },
    ],
  });
  assert.equal(diff.total_additions, 5);
  assert.equal(diff.total_deletions, 2);
  assert.equal(diff.started_at_ms, Date.parse("2026-07-07T12:01:00.000Z"));
  assert.equal(diff.completed_at_ms, Date.parse("2026-07-07T12:01:00.000Z"));
});

test("normalizeTurnDiff carries the source record refs and files_omitted", () => {
  const diff = normalizeTurnDiff(turnDiffMessage({
    record_id: "rec-77",
    server_seq: 4210,
    truncated: true,
    files_omitted: 3,
  }));
  assert.equal(diff.record_id, "rec-77");
  assert.equal(diff.record_seq, 4210);
  assert.equal(diff.files_omitted, 3);
  assert.equal(diff.truncated, true);

  const camel = normalizeTurnDiff(turnDiffMessage({
    record_id: "rec-78",
    record_seq: 4211,
    files_omitted: 1,
  }));
  assert.equal(camel.record_id, "rec-78");
  assert.equal(camel.record_seq, 4211);
  assert.equal(camel.files_omitted, 1);

  const recordSeqAlias = normalizeTurnDiff(turnDiffMessage({ record_seq: 9 }));
  assert.equal(recordSeqAlias.record_seq, 9);

  const bare = normalizeTurnDiff(turnDiffMessage());
  assert.equal(bare.record_id, "");
  assert.equal(bare.record_seq, null);
  assert.equal(bare.files_omitted, 0);
});

test("turnDiffSyntheticMessage bears refs + truncated flag, null when empty", () => {
  assert.equal(turnDiffSyntheticMessage(null), null);
  assert.equal(turnDiffSyntheticMessage(normalizeTurnDiff(turnDiffMessage())), null);

  const message = turnDiffSyntheticMessage(normalizeTurnDiff(turnDiffMessage({
    record_id: "rec-77",
    server_seq: 4210,
    truncated: true,
  })));
  assert.deepEqual(message, {
    record_id: "rec-77",
    record_seq: 4210,
    truncated: true,
  });

  // Truncated with no refs still surfaces the flag (non-fetchable degrade).
  const refless = turnDiffSyntheticMessage(normalizeTurnDiff(turnDiffMessage({ truncated: true })));
  assert.deepEqual(refless, { truncated: true });

  // Refs without truncation stay carried for identity.
  const untruncated = turnDiffSyntheticMessage(normalizeTurnDiff(turnDiffMessage({ record_id: "rec-9" })));
  assert.deepEqual(untruncated, { record_id: "rec-9", truncated: false });
});

test("normalizeTurnDiff rejects non-turn-diff and empty messages", () => {
  assert.equal(normalizeTurnDiff({ kind: "turn_summary", turn_id: "t" }), null);
  assert.equal(normalizeTurnDiff({ kind: "turn_diff" }), null);
});

test("extractTurnDiffs maps by turn id", () => {
  const diffs = extractTurnDiffs([
    { role: "user", content: "hi" },
    turnDiffMessage(),
    turnDiffMessage({ id: "td-2", turn_id: "turn-2", files: [{ path: "x.js", additions: 1, deletions: 0 }] }),
  ]);
  assert.equal(diffs.size, 2);
  assert.equal(diffs.get("turn-1").files.length, 2);
  assert.equal(diffs.get("turn-2").files[0].path, "x.js");
});

test("extractTurnDiffs same-turn replacement is order-independent", () => {
  // Higher positive recordSeq wins in both message orders.
  const seqLow = turnDiffMessage({
    id: "td-a",
    record_seq: 10,
    files: [{ path: "low.js", additions: 1, deletions: 0 }],
  });
  const seqHigh = turnDiffMessage({
    id: "td-b",
    record_seq: 11,
    files: [{ path: "high.js", additions: 2, deletions: 0 }],
  });
  assert.equal(extractTurnDiffs([seqLow, seqHigh]).get("turn-1").files[0].path, "high.js");
  assert.equal(extractTurnDiffs([seqHigh, seqLow]).get("turn-1").files[0].path, "high.js");

  // Absent seqs: the later timestamp wins in both orders.
  const early = turnDiffMessage({
    id: "td-c",
    timestamp: "2026-07-07T12:01:00.000Z",
    files: [{ path: "early.js", additions: 1, deletions: 0 }],
  });
  const late = turnDiffMessage({
    id: "td-d",
    timestamp: "2026-07-07T12:02:00.000Z",
    files: [{ path: "late.js", additions: 1, deletions: 0 }],
  });
  assert.equal(extractTurnDiffs([early, late]).get("turn-1").files[0].path, "late.js");
  assert.equal(extractTurnDiffs([late, early]).get("turn-1").files[0].path, "late.js");

  // A seq-bearing record beats a seqless one regardless of order/timestamp.
  const seqless = turnDiffMessage({
    id: "td-e",
    timestamp: "2026-07-07T12:09:00.000Z",
    files: [{ path: "seqless.js", additions: 1, deletions: 0 }],
  });
  const seqBearing = turnDiffMessage({
    id: "td-f",
    record_seq: 5,
    timestamp: "2026-07-07T12:01:00.000Z",
    files: [{ path: "seq.js", additions: 1, deletions: 0 }],
  });
  assert.equal(extractTurnDiffs([seqless, seqBearing]).get("turn-1").files[0].path, "seq.js");
  assert.equal(extractTurnDiffs([seqBearing, seqless]).get("turn-1").files[0].path, "seq.js");

  // Full tie (equal seq + timestamp): the existing entry stays.
  const first = turnDiffMessage({
    id: "td-g",
    record_seq: 7,
    files: [{ path: "first.js", additions: 1, deletions: 0 }],
  });
  const second = turnDiffMessage({
    id: "td-h",
    record_seq: 7,
    files: [{ path: "second.js", additions: 1, deletions: 0 }],
  });
  assert.equal(extractTurnDiffs([first, second]).get("turn-1").files[0].path, "first.js");
});

/* ------------------------------------------------------------------ */
/* Row filtering                                                        */
/* ------------------------------------------------------------------ */

test("turn_diff messages never surface as transcript rows", () => {
  const items = [
    ...turnItems(),
    { id: "td-item", type: "message", turn_id: "turn-1", message: turnDiffMessage() },
    {
      id: "ag-1",
      type: "activityGroup",
      turn_id: "turn-1",
      messages: [turnDiffMessage({ id: "td-nested" })],
    },
  ];
  const rows = flattenTranscriptItems(items);
  assert.equal(rows.some((row) => isTurnDiffMessage(row.message || {})), false);
});

test("internal context user messages never surface as transcript rows", () => {
  const items = [
    ...turnItems(),
    {
      id: "noise-aborted",
      type: "message",
      turn_id: "turn-1",
      message: {
        id: "noise-aborted",
        role: "user",
        content: "<turn_aborted>codex marked the previous turn aborted</turn_aborted>",
      },
    },
    {
      id: "ag-noise",
      type: "activityGroup",
      turn_id: "turn-1",
      messages: [
        {
          id: "noise-interrupted",
          role: "user",
          content: "<turn_interrupted>user interrupted the turn</turn_interrupted>",
        },
        {
          id: "noise-env",
          role: "user",
          content: "<environment_context>cwd=/repo</environment_context>",
        },
      ],
    },
  ];
  const rows = flattenTranscriptItems(items);
  const userRows = rows.filter((row) => row.kind === "user");
  assert.deepEqual(userRows.map((row) => row.message.id), ["u-1", "u-2"]);
});

/* ------------------------------------------------------------------ */
/* Attachment (turn_id match + time-window fallback)                    */
/* ------------------------------------------------------------------ */

test("attachTurnRecordsToGroups matches turn ids first", () => {
  const groups = groupRowsIntoTurns(flattenTranscriptItems(turnItems()));
  const diffs = extractTurnDiffs([turnDiffMessage()]);
  const byGroupKey = attachTurnRecordsToGroups(groups, diffs);
  assert.equal(byGroupKey.size, 1);
  const [groupKey, diff] = [...byGroupKey.entries()][0];
  assert.equal(groups.find((group) => group.key === groupKey).turn_id, "turn-1");
  assert.equal(diff.files.length, 2);
});

test("attachTurnRecordsToGroups falls back to the timestamp window", () => {
  // Rows without turn ids: the diff's message timestamp lands inside the
  // first turn's row window (±2s tolerance).
  const items = turnItems().map((item) => ({
    ...item,
    turn_id: undefined,
    message: { ...item.message, turn_id: undefined },
  }));
  const groups = groupRowsIntoTurns(flattenTranscriptItems(items));
  const diffs = extractTurnDiffs([turnDiffMessage({
    turn_id: "turn-orphan",
    timestamp: "2026-07-07T12:00:40.000Z",
  })]);
  const byGroupKey = attachTurnRecordsToGroups(groups, diffs);
  assert.equal(byGroupKey.size, 1);
  const groupKey = [...byGroupKey.keys()][0];
  const group = groups.find((candidate) => candidate.key === groupKey);
  assert.equal(
    group.anchorRows[0].message.content,
    "Change it",
  );
});

/* ------------------------------------------------------------------ */
/* buildTranscriptRows integration                                      */
/* ------------------------------------------------------------------ */

test("buildTranscriptRows surfaces a reviewable file-change row from turn_diff", () => {
  const diffs = extractTurnDiffs([turnDiffMessage()]);
  const { rows } = buildTranscriptRows(turnItems(), {
    turnDiffs: diffs,
    expandedTurnKeys: new Set(),
  });
  // Settled turn-1 is folded; expand by finding its fold row group key.
  const fold = rows.find((row) => row.kind === "fold");
  const { rows: expandedRows } = buildTranscriptRows(turnItems(), {
    turnDiffs: diffs,
    expandedTurnKeys: new Set([fold.groupKey]),
  });
  const fileChange = expandedRows.find((row) => row.kind === "file-change");
  assert.ok(fileChange, "expected a file-change row");
  assert.ok(fileChange.turnDiff, "expected the row to carry the turn diff");
  assert.equal(fileChange.turnDiff.files.length, 2);
  assert.equal(fileChange.additions, 2);
  assert.equal(fileChange.deletions, 1);
  // Fold summary counts come through.
  assert.equal(fold.summary.additions, 2);
  assert.equal(fold.summary.deletions, 1);
});

test("synthetic turn_diff card row is fetchable and reports omitted files", () => {
  const diffs = extractTurnDiffs([turnDiffMessage({
    record_id: "rec-77",
    server_seq: 4210,
    truncated: true,
    files_omitted: 2,
  })]);
  const probe = buildTranscriptRows(turnItems(), { turnDiffs: diffs });
  const fold = probe.rows.find((row) => row.kind === "fold");
  const { rows } = buildTranscriptRows(turnItems(), {
    turnDiffs: diffs,
    expandedTurnKeys: new Set([fold.groupKey]),
  });
  const fileChange = rows.find((row) => row.kind === "file-change");
  assert.ok(fileChange, "expected the synthetic file-change row");
  assert.equal(fileChange.synthetic, true);
  // Rendering model: the card reads turnDiff.files_omitted for the
  // "N more files not shown" note and the message record refs + truncated
  // flag for the standard fetchable TruncatedChip.
  assert.equal(fileChange.turnDiff.files_omitted, 2);
  assert.equal(fileChange.turnDiff.truncated, true);
  assert.ok(fileChange.message, "expected a minimal message on the synthetic row");
  assert.equal(fileChange.message.record_id, "rec-77");
  assert.equal(fileChange.message.record_id, "rec-77");
  assert.equal(fileChange.message.record_seq, 4210);
  assert.equal(fileChange.message.record_seq, 4210);
  assert.equal(fileChange.message.truncated, true);
});

test("synthetic turn_diff card keeps message null without refs or truncation", () => {
  const diffs = extractTurnDiffs([turnDiffMessage()]);
  const probe = buildTranscriptRows(turnItems(), { turnDiffs: diffs });
  const fold = probe.rows.find((row) => row.kind === "fold");
  const { rows } = buildTranscriptRows(turnItems(), {
    turnDiffs: diffs,
    expandedTurnKeys: new Set([fold.groupKey]),
  });
  const fileChange = rows.find((row) => row.kind === "file-change");
  assert.ok(fileChange, "expected the synthetic file-change row");
  assert.equal(fileChange.message, null);
  assert.equal(fileChange.turnDiff.files_omitted, 0);
});

test("buildTranscriptRows attaches turn_diff to an existing file-change row", () => {
  const items = [
    ...turnItems().slice(0, 2),
    {
      id: "fc-1",
      type: "message",
      turn_id: "turn-1",
      message: {
        id: "fc-1",
        role: "activity",
        kind: "file-change",
        turn_id: "turn-1",
        timestamp: "2026-07-07T12:00:50.000Z",
        file_change: { files: [{ path: "src/lib.rs", additions: 2, deletions: 1 }] },
      },
    },
    ...turnItems().slice(2),
  ];
  const diffs = extractTurnDiffs([turnDiffMessage()]);
  const probe = buildTranscriptRows(items, { turnDiffs: diffs });
  const fold = probe.rows.find((row) => row.kind === "fold");
  const { rows } = buildTranscriptRows(items, {
    turnDiffs: diffs,
    expandedTurnKeys: new Set([fold.groupKey]),
  });
  const fileChangeRows = rows.filter((row) => row.kind === "file-change");
  assert.equal(fileChangeRows.length, 1);
  assert.equal(fileChangeRows[0].synthetic, undefined);
  assert.ok(fileChangeRows[0].turnDiff);
});

test("turns without turn_diff keep the counts-only card", () => {
  const items = turnItems();
  const turnSummaries = new Map([[
    "turn-1",
    {
      turn_id: "turn-1",
      started_at_ms: Date.parse("2026-07-07T12:00:00.000Z"),
      completed_at_ms: Date.parse("2026-07-07T12:01:00.000Z"),
      duration_ms: 60000,
      usage: null,
      file_change: {
        files: [{ path: "src/lib.rs", kind: "edit", additions: 2, deletions: 1 }],
        summary: "",
      },
    },
  ]]);
  const probe = buildTranscriptRows(items, { turnSummaries });
  const fold = probe.rows.find((row) => row.kind === "fold");
  const { rows } = buildTranscriptRows(items, {
    turnSummaries,
    expandedTurnKeys: new Set([fold.groupKey]),
  });
  const fileChange = rows.find((row) => row.kind === "file-change");
  assert.ok(fileChange, "expected the synthetic counts-only card");
  assert.equal(fileChange.turnDiff, undefined);
  assert.equal(fileChange.synthetic, true);
});

import test from "node:test";
import assert from "node:assert/strict";

import { buildTranscriptRows } from "./builders.mjs";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

// Turn 1's final assistant answer lands BETWEEN work rows (tool calls settle
// after the final message), so it belongs to the turn's workRows rather than
// the trailing tail. Folding must still keep it visible (t3-style: a fold
// hides the WORK, never the reply).
function midAnswerItems() {
  return [
    {
      id: "u-1",
      type: "message",
      turnId: "turn-1",
      message: { id: "u-1", role: "user", content: "Do the thing", turn_id: "turn-1", timestamp: "2026-07-07T12:00:00.000Z" },
    },
    {
      id: "ag-1",
      type: "activityGroup",
      turnId: "turn-1",
      messages: [
        { id: "t-1", role: "activity", kind: "tool-call", turn_id: "turn-1", timestamp: "2026-07-07T12:00:05.000Z", tool: { name: "exec_command", input: { cmd: "ls" } } },
      ],
    },
    {
      id: "a-1",
      type: "message",
      turnId: "turn-1",
      message: { id: "a-1", role: "assistant", content: "Here is the answer.", turn_id: "turn-1", timestamp: "2026-07-07T12:00:20.000Z" },
    },
    {
      id: "ag-2",
      type: "activityGroup",
      turnId: "turn-1",
      messages: [
        { id: "t-2", role: "activity", kind: "tool-call", turn_id: "turn-1", timestamp: "2026-07-07T12:00:25.000Z", tool: { name: "notify", input: { name: "done" } } },
      ],
    },
    {
      id: "u-2",
      type: "message",
      turnId: "turn-2",
      message: { id: "u-2", role: "user", content: "Next", turn_id: "turn-2", timestamp: "2026-07-07T12:05:00.000Z" },
    },
    {
      id: "ag-3",
      type: "activityGroup",
      turnId: "turn-2",
      messages: [
        { id: "t-3", role: "activity", kind: "tool-call", turn_id: "turn-2", timestamp: "2026-07-07T12:05:05.000Z", status: "running", tool: { name: "write_file", input: { path: "a.rs" }, status: "running" } },
      ],
    },
  ];
}

// Turn 1 is a pure tool run: no assistant text anywhere in the turn.
function textlessItems() {
  return [
    {
      id: "u-1",
      type: "message",
      turnId: "turn-1",
      message: { id: "u-1", role: "user", content: "Run checks", turn_id: "turn-1", timestamp: "2026-07-07T12:00:00.000Z" },
    },
    {
      id: "ag-1",
      type: "activityGroup",
      turnId: "turn-1",
      messages: [
        { id: "t-1", role: "activity", kind: "tool-call", turn_id: "turn-1", timestamp: "2026-07-07T12:00:05.000Z", tool: { name: "exec_command", input: { cmd: "npm test" } } },
        { id: "t-2", role: "activity", kind: "tool-call", turn_id: "turn-1", timestamp: "2026-07-07T12:00:30.000Z", tool: { name: "exec_command", input: { cmd: "npm run lint" } } },
      ],
    },
    {
      id: "u-2",
      type: "message",
      turnId: "turn-2",
      message: { id: "u-2", role: "user", content: "Next", turn_id: "turn-2", timestamp: "2026-07-07T12:05:00.000Z" },
    },
    {
      id: "ag-2",
      type: "activityGroup",
      turnId: "turn-2",
      messages: [
        { id: "t-3", role: "activity", kind: "tool-call", turn_id: "turn-2", timestamp: "2026-07-07T12:05:05.000Z", status: "running", tool: { name: "write_file", input: { path: "a.rs" }, status: "running" } },
      ],
    },
  ];
}

// Turn 1 ends with its assistant answer (the classic trailing-tail shape).
function tailAnswerItems() {
  return [
    {
      id: "u-1",
      type: "message",
      turnId: "turn-1",
      message: { id: "u-1", role: "user", content: "Explain", turn_id: "turn-1", timestamp: "2026-07-07T12:00:00.000Z" },
    },
    {
      id: "ag-1",
      type: "activityGroup",
      turnId: "turn-1",
      messages: [
        { id: "t-1", role: "activity", kind: "tool-call", turn_id: "turn-1", timestamp: "2026-07-07T12:00:05.000Z", tool: { name: "read_file", input: { path: "a.rs" } } },
      ],
    },
    {
      id: "a-1",
      type: "message",
      turnId: "turn-1",
      message: { id: "a-1", role: "assistant", content: "Explanation.", turn_id: "turn-1", timestamp: "2026-07-07T12:00:20.000Z" },
    },
    {
      id: "u-2",
      type: "message",
      turnId: "turn-2",
      message: { id: "u-2", role: "user", content: "Next", turn_id: "turn-2", timestamp: "2026-07-07T12:05:00.000Z" },
    },
    {
      id: "ag-2",
      type: "activityGroup",
      turnId: "turn-2",
      messages: [
        { id: "t-2", role: "activity", kind: "tool-call", turn_id: "turn-2", timestamp: "2026-07-07T12:05:05.000Z", status: "running", tool: { name: "write_file", input: { path: "b.rs" }, status: "running" } },
      ],
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Fold semantics: folding hides work, never the answer                */
/* ------------------------------------------------------------------ */

test("folded turns keep mid-work assistant answer rows visible", () => {
  const { rows } = buildTranscriptRows(midAnswerItems(), {
    expandedTurnKeys: new Set(),
    busy: true,
  });
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["user", "fold", "assistant", "user", "tool"],
  );
  const fold = rows.find((row) => row.kind === "fold");
  assert.equal(fold.folded, true);
  assert.equal(fold.foldable, true);
  // Fold header still summarizes the hidden work.
  assert.equal(fold.summary.toolCalls, 2);
  const assistant = rows.find((row) => row.kind === "assistant");
  assert.equal(assistant.message.id, "a-1");
  assert.equal(assistant.groupKey, fold.groupKey);
});

test("expanding restores original ordering without duplicating the answer", () => {
  const built = buildTranscriptRows(midAnswerItems(), {
    expandedTurnKeys: new Set(["turn:turn-1#0"]),
    busy: true,
  });
  assert.deepEqual(
    built.rows.map((row) => row.kind),
    ["user", "fold", "tool", "assistant", "tool", "user", "tool"],
  );
  const assistants = built.rows.filter((row) => row.kind === "assistant");
  assert.equal(assistants.length, 1);
  assert.equal(assistants[0].message.id, "a-1");
  const fold = built.rows.find((row) => row.kind === "fold");
  assert.equal(fold.folded, false);
  // The folded and expanded answer are the same row (stable key).
  const folded = buildTranscriptRows(midAnswerItems(), {
    expandedTurnKeys: new Set(),
    busy: true,
  });
  assert.equal(
    folded.rows.find((row) => row.kind === "assistant").key,
    assistants[0].key,
  );
});

test("turns without assistant text fold fully", () => {
  const { rows } = buildTranscriptRows(textlessItems(), {
    expandedTurnKeys: new Set(),
    busy: true,
  });
  assert.deepEqual(
    rows.map((row) => row.kind),
    ["user", "fold", "user", "tool"],
  );
  const fold = rows.find((row) => row.kind === "fold");
  assert.equal(fold.folded, true);
  assert.equal(fold.summary.toolCalls, 2);
});

test("trailing assistant answers stay visible folded and never duplicate expanded", () => {
  const folded = buildTranscriptRows(tailAnswerItems(), {
    expandedTurnKeys: new Set(),
    busy: true,
  });
  assert.deepEqual(
    folded.rows.map((row) => row.kind),
    ["user", "fold", "assistant", "user", "tool"],
  );
  const expanded = buildTranscriptRows(tailAnswerItems(), {
    expandedTurnKeys: new Set(["turn:turn-1#0"]),
    busy: true,
  });
  assert.deepEqual(
    expanded.rows.map((row) => row.kind),
    ["user", "fold", "tool", "assistant", "user", "tool"],
  );
  assert.equal(expanded.rows.filter((row) => row.kind === "assistant").length, 1);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildTranscriptBlocks,
  projectionRowKey,
  TOOL_STATUS_LABEL,
  TOOL_STATUS_UNRESOLVED,
  toolClusterOpenState,
  toolStatusOf,
} from "./sessionTranscriptBlocks.js";

function row(overrides) {
  return {
    seq: 1,
    ordinal: 0,
    projection_order: 0,
    branch_id: "",
    kind: "message",
    role: "assistant",
    text: "",
    meta: {},
    at_ms: 0,
    ...overrides,
  };
}

function visibleKinds(blocks) {
  return blocks.map((block) => (
    block.type === "tools" ? "tools" : block.row?.kind || block.type
  ));
}

test("v4 siblings use deterministic client order while preserving wire seq and ordinal", () => {
  const thinking = row({
    seq: 32,
    ordinal: 7,
    projection_order: 0,
    kind: "thinking",
    text: "compare the options",
    meta: { role: "assistant", reasoning: "compare the options", text: "ship it" },
  });
  const message = row({
    seq: 32,
    ordinal: 7,
    projection_order: 1,
    text: "ship it",
    meta: thinking.meta,
  });

  const blocks = buildTranscriptBlocks([message, thinking]);

  assert.deepEqual(visibleKinds(blocks), ["thinking", "message"]);
  assert.equal(thinking.seq, message.seq);
  assert.equal(thinking.ordinal, message.ordinal);
  assert.notEqual(projectionRowKey(thinking), projectionRowKey(message));
});

test("item-stream held thinking is emitted above its assistant reply", () => {
  const blocks = buildTranscriptBlocks([
    row({
      seq: 40,
      kind: "thinking",
      text: "reasoning lifecycle item",
      meta: { item: "reasoning" },
    }),
    row({
      seq: 41,
      text: "assistant lifecycle item",
      meta: { item: "agent_message" },
    }),
  ]);

  assert.deepEqual(visibleKinds(blocks), ["thinking", "message"]);
});

test("multiple held item-stream thinking rows keep wire-relative order before one reply", () => {
  const blocks = buildTranscriptBlocks([
    row({ seq: 62, kind: "thinking", text: "second step", meta: { item: "reasoning" } }),
    row({ seq: 61, kind: "thinking", text: "first step", meta: { item: "reasoning" } }),
    row({ seq: 63, text: "answer", meta: { item: "agent_message" } }),
  ]);

  assert.deepEqual(
    blocks.map((block) => block.row?.text),
    ["first step", "second step", "answer"],
  );
});

test("reasoning remains a separate row and never joins a tool group", () => {
  const blocks = buildTranscriptBlocks([
    row({ seq: 50, kind: "thinking", text: "plan", meta: { item: "reasoning" } }),
    row({
      seq: 51,
      kind: "tool",
      role: "tool",
      text: "cargo · completed",
      meta: { item: "tool_call", name: "cargo" },
    }),
    row({ seq: 52, text: "done", meta: { item: "agent_message" } }),
  ]);

  const thinkingIndex = blocks.findIndex((block) => block.row?.kind === "thinking");
  const messageIndex = blocks.findIndex((block) => block.row?.kind === "message");
  const toolBlock = blocks.find((block) => block.type === "tools");
  assert.ok(thinkingIndex >= 0);
  assert.ok(thinkingIndex < messageIndex);
  assert.deepEqual(toolBlock.rows.map((toolRow) => toolRow.kind), ["tool"]);
});

test("sealed reasoning renders through the collapsed thinking fold", () => {
  const source = readFileSync(new URL("./SessionTranscript.jsx", import.meta.url), "utf8");
  assert.match(source, /row\.kind === "thinking"[\s\S]*?<ThinkingFold text=\{row\.text\} \/>/);
  assert.match(source, /function ThinkingFold\(\{ text, live = false \}\)/);
  assert.match(source, /const \[open, setOpen\] = useState\(live\)/);
});

test("an outcome this build cannot name never reads as a success", () => {
  // The harness formats its typed status into prose, so cold rows only ever
  // carry a word. A word we do not recognise — including one a newer daemon
  // introduces — must not be reported as a finished, successful call.
  assert.equal(toolStatusOf({ text: "tool call settled as Rejected" }), "rejected");
  assert.equal(toolStatusOf({ text: "tool call settled as Conflict" }), "conflict");
  assert.equal(toolStatusOf({ text: "tool call settled as Quarantined" }), "unknown");
  assert.equal(toolStatusOf({ text: "" }), "unknown");
  assert.equal(TOOL_STATUS_LABEL.unknown, "Unknown");

  // Typed metadata outranks the prose wherever the row carries it.
  assert.equal(
    toolStatusOf({ meta: { status: "rejected" }, text: "tool call settled as Completed" }),
    "rejected",
  );

  // Only a real success is a success; everything unresolved opens the cluster.
  assert.equal(toolStatusOf({ text: "tool call settled as Completed" }), "ok");
  for (const status of ["failed", "rejected", "conflict", "unknown"]) {
    assert.ok(TOOL_STATUS_UNRESOLVED.has(status), `${status} must surface itself`);
  }
  assert.ok(!TOOL_STATUS_UNRESOLVED.has("ok"));
});

test("a multi-row cluster that is unresolved on arrival initializes open", () => {
  const rows = [
    row({ kind: "tool", role: "tool", meta: { status: "completed" } }),
    row({ seq: 2, kind: "tool", role: "tool", meta: { status: "quarantined" } }),
  ];

  assert.equal(toolClusterOpenState(undefined, rows), true);

  const source = readFileSync(new URL("./SessionTranscript.jsx", import.meta.url), "utf8");
  assert.match(
    source,
    /useState\(\(\) => toolClusterOpenState\(undefined, rows\)\)/,
    "ToolCluster must initialize from the tested open-state transition",
  );
});

test("a row becoming unresolved later reopens a closed multi-row cluster", () => {
  const settledRows = [
    row({ kind: "tool", role: "tool", meta: { status: "completed" } }),
    row({ seq: 2, kind: "tool", role: "tool", meta: { status: "completed" } }),
  ];
  const unresolvedRows = [
    settledRows[0],
    { ...settledRows[1], meta: { status: "conflict" } },
  ];

  const closed = toolClusterOpenState(undefined, settledRows);
  assert.equal(closed, false);
  assert.equal(toolClusterOpenState(closed, unresolvedRows), true);

  const source = readFileSync(new URL("./SessionTranscript.jsx", import.meta.url), "utf8");
  assert.match(
    source,
    /setOpen\(\(current\) => toolClusterOpenState\(current, rows\)\)/,
    "ToolCluster must reopen from the tested open-state transition",
  );
});

test("two assistant turns saying the same thing are two turns", () => {
  // Identical wording is not identical identity. Collapsing on text silently
  // removed part of the transcript; only a repeated row identity is a repeat.
  const blocks = buildTranscriptBlocks([
    { seq: 1, ordinal: 0, projection_order: 0, kind: "message", role: "assistant", text: "Done." },
    { seq: 2, ordinal: 0, projection_order: 0, kind: "message", role: "assistant", text: "Done." },
  ]);
  const said = blocks.filter((block) => block.type === "row").map((block) => block.row.text);
  assert.deepEqual(said, ["Done.", "Done."]);

  // The same row delivered twice still collapses.
  const repeated = buildTranscriptBlocks([
    { seq: 5, ordinal: 0, projection_order: 0, kind: "message", role: "assistant", text: "Once." },
    { seq: 5, ordinal: 0, projection_order: 0, kind: "message", role: "assistant", text: "Once." },
  ]);
  assert.equal(repeated.filter((block) => block.type === "row").length, 1);
});

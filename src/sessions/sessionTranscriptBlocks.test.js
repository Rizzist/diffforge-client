import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildTranscriptBlocks,
  projectionRowKey,
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

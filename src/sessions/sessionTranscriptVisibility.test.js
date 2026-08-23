import assert from "node:assert/strict";
import test from "node:test";
import { buildTranscriptBlocks } from "./sessionTranscriptBlocks.js";

function toolRow(item, seq, overrides = {}) {
  return {
    seq,
    ordinal: 0,
    projection_order: 0,
    branch_id: "",
    kind: "tool",
    role: "tool",
    text: `${item} · completed`,
    meta: { item },
    at_ms: 0,
    ...overrides,
  };
}

test("session_seen rows do not produce transcript blocks", () => {
  const metadataNamed = toolRow("session_seen", 1);
  const textNamed = toolRow("unclassified", 2, {
    text: "session_seen · completed",
    meta: {},
  });

  assert.deepEqual(buildTranscriptBlocks([metadataNamed, textNamed]), []);
});

test("owner-approved state rows remain visible in transcript blocks", () => {
  const visibleNames = [
    "model_selected",
    "context_compaction",
    "session_state",
    "run_state",
    "session_renamed",
  ];
  const blocks = buildTranscriptBlocks(
    visibleNames.map((item, index) => toolRow(item, index + 1)),
  );

  assert.deepEqual(
    blocks.flatMap((block) => block.type === "tools" ? block.rows : [block.row]),
    visibleNames.map((item, index) => toolRow(item, index + 1)),
  );
});

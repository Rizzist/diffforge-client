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

test("session_seen and session_renamed rows do not produce transcript blocks", () => {
  const metadataNamedSeen = toolRow("session_seen", 1);
  const textNamedSeen = toolRow("unclassified", 2, {
    text: "session_seen · completed",
    meta: {},
  });
  const metadataNamedRenamed = toolRow("session_renamed", 3);
  const textNamedRenamed = toolRow("unclassified", 4, {
    text: "session_renamed · completed",
    meta: {},
  });

  assert.deepEqual(buildTranscriptBlocks([
    metadataNamedSeen,
    textNamedSeen,
    metadataNamedRenamed,
    textNamedRenamed,
  ]), []);
});

test("owner-approved state rows remain visible in transcript blocks", () => {
  const visibleNames = [
    "model_selected",
    "context_compaction",
    "session_state",
    "run_state",
  ];
  const blocks = buildTranscriptBlocks(
    visibleNames.map((item, index) => toolRow(item, index + 1)),
  );

  assert.deepEqual(
    blocks.flatMap((block) => block.type === "tools" ? block.rows : [block.row]),
    visibleNames.map((item, index) => toolRow(item, index + 1)),
  );
});

test("agent_graph_rollup_v1 and typed subagent rows pass through instead of being swallowed", () => {
  const typedRows = [
    toolRow("child_spawn", 10, {
      kind: "child_spawn",
      role: "agent",
      text: "",
      meta: { item: "child_spawn", agent: "agent-child" },
    }),
    toolRow("child_result", 11, {
      kind: "child_result",
      role: "agent",
      text: "projection audited",
      meta: {
        item: "child_result",
        report: { agent: "agent-child", verified: "verified" },
      },
    }),
    toolRow("agent_graph_rollup_v1", 12, {
      kind: "agent_graph_rollup_v1",
      role: "agent",
      text: "",
      meta: {
        item: "extension",
        kind: "agent_graph_rollup_v1",
        data: { agent: "agent-child", state: "gate" },
      },
    }),
  ];
  // A pre-v9 cached row can still arrive as a generic tool. Its stable
  // extension kind remains sufficient authority to keep the fact visible.
  const cachedGenericRollup = toolRow("extension", 13, {
    meta: {
      item: "extension",
      kind: "agent_graph_rollup_v1",
      data: { agent: "agent-child", state: "complete" },
    },
  });
  const genuinelyInternalExtension = toolRow("extension", 14, {
    meta: { item: "extension", kind: "user_command_origin_v1" },
  });

  const visible = buildTranscriptBlocks([
    ...typedRows,
    cachedGenericRollup,
    genuinelyInternalExtension,
  ]).flatMap((block) => block.type === "tools" ? block.rows : [block.row]);

  assert.deepEqual(visible, [...typedRows, cachedGenericRollup]);
  assert.deepEqual(
    visible.slice(0, 3).map((row) => row.kind),
    ["child_spawn", "child_result", "agent_graph_rollup_v1"],
    "typed subagent activity must not be grouped as anonymous tools",
  );
});

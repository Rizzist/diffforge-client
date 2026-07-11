import test from "node:test";
import assert from "node:assert/strict";

import {
  SUBAGENT_NESTING_DEPTH_CAP,
  countToolCalls,
  flattenTranscriptItems,
  groupRowsIntoTurns,
  messageSubagent,
  subagentGroupStats,
} from "./builders.mjs";

/* ------------------------------------------------------------------ */
/* Fixtures                                                             */
/* ------------------------------------------------------------------ */

let fixtureCounter = 0;

function toolMessage({ subagent = null, name = "exec", timestamp = null } = {}) {
  fixtureCounter += 1;
  return {
    id: `m-${fixtureCounter}`,
    role: "activity",
    kind: "tool-call",
    turn_id: "turn-1",
    ...(timestamp ? { timestamp } : {}),
    tool: { name, status: "completed" },
    ...(subagent ? { subagent } : {}),
  };
}

function itemsWithWork(messages = []) {
  return [
    {
      id: "u-1",
      type: "message",
      turn_id: "turn-1",
      message: { id: "u-1", role: "user", content: "go", turn_id: "turn-1" },
    },
    ...messages.map((message) => ({
      id: message.id,
      type: "message",
      turn_id: "turn-1",
      message,
    })),
    {
      id: "a-1",
      type: "message",
      turn_id: "turn-1",
      message: { id: "a-1", role: "assistant", content: "done", turn_id: "turn-1" },
    },
  ];
}

function workRowsFor(messages, options = {}) {
  const groups = groupRowsIntoTurns(flattenTranscriptItems(itemsWithWork(messages)), options);
  const turnGroup = groups.find((group) => !group.divider);
  return turnGroup.workRows;
}

/* ------------------------------------------------------------------ */
/* messageSubagent extraction                                           */
/* ------------------------------------------------------------------ */

test("messageSubagent extracts parent and session references", () => {
  const subagent = messageSubagent({
    subagent: {
      id: "sa-2",
      parent_id: "sa-1",
      title: "Research",
      status: "running",
      agent_chat_session_id: "acs-9",
      provider_session_id: "ps-9",
    },
  });
  assert.equal(subagent.id, "sa-2");
  assert.equal(subagent.parent_id, "sa-1");
  assert.deepEqual(subagent.session_ref, {
    agent_chat_session_id: "acs-9",
    provider_session_id: "ps-9",
  });
  const camel = messageSubagent({
    subagent: { id: "sa-3", parent_id: "sa-2", provider_session_id: "ps-1" },
  });
  assert.equal(camel.parent_id, "sa-2");
  assert.deepEqual(camel.session_ref, { agent_chat_session_id: "", provider_session_id: "ps-1" });
  const bare = messageSubagent({ subagent: { id: "sa-4" } });
  assert.equal(bare.parent_id, "");
  assert.equal(bare.session_ref, null);
});

/* ------------------------------------------------------------------ */
/* Flat runs (existing behavior preserved)                              */
/* ------------------------------------------------------------------ */

test("consecutive same-id rows wrap into a single flat group", () => {
  const rows = workRowsFor([
    toolMessage({ subagent: { id: "sa-1", title: "Task A", status: "running" } }),
    toolMessage({ subagent: { id: "sa-1", title: "Task A", status: "completed" } }),
    toolMessage({}),
    toolMessage({ subagent: { id: "sa-1", title: "Task A" } }),
  ]);
  assert.deepEqual(rows.map((row) => row.kind), ["subagent-group", "tool", "subagent-group"]);
  const [first, , second] = rows;
  assert.equal(first.subagent_id, "sa-1");
  assert.equal(first.depth, 1);
  assert.equal(first.childRows.length, 2);
  assert.equal(first.status, "completed");
  assert.equal(second.childRows.length, 1);
});

test("unstamped rows pass through unchanged", () => {
  const rows = workRowsFor([
    toolMessage({}),
    toolMessage({ name: "grep" }),
  ]);
  assert.deepEqual(rows.map((row) => row.kind), ["tool", "tool"]);
});

/* ------------------------------------------------------------------ */
/* Nesting via parent_id chains                                         */
/* ------------------------------------------------------------------ */

test("parent_id chains nest child groups inside the parent", () => {
  const rows = workRowsFor([
    toolMessage({ subagent: { id: "sa-1", title: "Parent" } }),
    toolMessage({ subagent: { id: "sa-2", parent_id: "sa-1", title: "Child" } }),
    toolMessage({ subagent: { id: "sa-2", parent_id: "sa-1", title: "Child" } }),
    toolMessage({ subagent: { id: "sa-1", title: "Parent" } }),
  ]);
  assert.equal(rows.length, 1);
  const parent = rows[0];
  assert.equal(parent.kind, "subagent-group");
  assert.equal(parent.subagent_id, "sa-1");
  assert.equal(parent.depth, 1);
  // Parent children: first tool row, nested child group, closing tool row.
  assert.deepEqual(
    parent.childRows.map((row) => row.kind),
    ["tool", "subagent-group", "tool"],
  );
  const child = parent.childRows[1];
  assert.equal(child.subagent_id, "sa-2");
  assert.equal(child.depth, 2);
  assert.equal(child.title, "Child");
  assert.equal(child.childRows.length, 2);
});

test("rows deeper than the depth cap flatten into the depth-cap group", () => {
  assert.equal(SUBAGENT_NESTING_DEPTH_CAP, 3);
  const rows = workRowsFor([
    toolMessage({ subagent: { id: "a", title: "A" } }),
    toolMessage({ subagent: { id: "b", parent_id: "a", title: "B" } }),
    toolMessage({ subagent: { id: "c", parent_id: "b", title: "C" } }),
    toolMessage({ subagent: { id: "d", parent_id: "c", title: "D" } }),
    toolMessage({ subagent: { id: "d", parent_id: "c", title: "D" } }),
  ]);
  assert.equal(rows.length, 1);
  const a = rows[0];
  const b = a.childRows.find((row) => row.kind === "subagent-group");
  const c = b.childRows.find((row) => row.kind === "subagent-group");
  assert.equal(c.depth, 3);
  // No depth-4 group: d's rows flattened into c.
  const nestedInC = c.childRows.filter((row) => row.kind === "subagent-group");
  assert.equal(nestedInC.length, 0);
  assert.equal(c.childRows.filter((row) => row.kind === "tool").length, 3);
});

test("descendants of flattened runs stay inside the depth-cap group", () => {
  // 5-deep chain: d flattens into c (the depth-cap group) without a group
  // of its own, so e's parent_id points at a never-created group. e (and
  // anything deeper) must route into the same cap group instead of
  // resetting the stack and spawning a bogus top-level group.
  const rows = workRowsFor([
    toolMessage({ subagent: { id: "a", title: "A" } }),
    toolMessage({ subagent: { id: "b", parent_id: "a", title: "B" } }),
    toolMessage({ subagent: { id: "c", parent_id: "b", title: "C" } }),
    toolMessage({ subagent: { id: "d", parent_id: "c", title: "D" } }),
    toolMessage({ subagent: { id: "e", parent_id: "d", title: "E" } }),
    toolMessage({ subagent: { id: "e", parent_id: "d", title: "E" } }),
  ]);
  assert.equal(rows.length, 1, "no bogus top-level group for depth-5 rows");
  const a = rows[0];
  const b = a.childRows.find((row) => row.kind === "subagent-group");
  const c = b.childRows.find((row) => row.kind === "subagent-group");
  assert.equal(c.depth, 3);
  // No groups nest below the cap; d's and e's rows all flatten into c.
  assert.equal(c.childRows.filter((row) => row.kind === "subagent-group").length, 0);
  assert.equal(c.childRows.filter((row) => row.kind === "tool").length, 4);
});

test("a parent_id that references a closed run starts a new root group", () => {
  const rows = workRowsFor([
    toolMessage({ subagent: { id: "sa-1", title: "First" } }),
    toolMessage({}),
    toolMessage({ subagent: { id: "sa-2", parent_id: "sa-1", title: "Orphan" } }),
  ]);
  assert.deepEqual(rows.map((row) => row.kind), ["subagent-group", "tool", "subagent-group"]);
  const orphan = rows[2];
  assert.equal(orphan.subagent_id, "sa-2");
  assert.equal(orphan.depth, 1);
});

/* ------------------------------------------------------------------ */
/* Cross-session references                                             */
/* ------------------------------------------------------------------ */

test("cross-session subagents expose sessionRef; same-session refs stay hidden", () => {
  const stamped = (sessionId) => workRowsFor([
    toolMessage({
      subagent: {
        id: "sa-1",
        title: "Remote",
        agent_chat_session_id: "acs-other",
        provider_session_id: "ps-other",
      },
    }),
  ], { session_id: sessionId });

  const different = stamped("acs-current");
  assert.deepEqual(different[0].session_ref, {
    agent_chat_session_id: "acs-other",
    provider_session_id: "ps-other",
  });

  const matchingAgentChat = stamped("acs-other");
  assert.equal(matchingAgentChat[0].session_ref, null);

  const matchingProvider = stamped("ps-other");
  assert.equal(matchingProvider[0].session_ref, null);

  // Unknown current session: best effort, the ref still surfaces.
  const unknown = stamped("");
  assert.deepEqual(unknown[0].session_ref, {
    agent_chat_session_id: "acs-other",
    provider_session_id: "ps-other",
  });
});

test("subagents without session references never get a sessionRef", () => {
  const rows = workRowsFor([
    toolMessage({ subagent: { id: "sa-1", title: "Local" } }),
  ], { session_id: "acs-current" });
  assert.equal(rows[0].session_ref, null);
});

/* ------------------------------------------------------------------ */
/* Stats + counting                                                     */
/* ------------------------------------------------------------------ */

test("subagentGroupStats counts descendants recursively and derives duration", () => {
  const rows = workRowsFor([
    toolMessage({
      subagent: { id: "sa-1", title: "Parent" },
      timestamp: "2026-07-07T12:00:00.000Z",
    }),
    toolMessage({
      subagent: { id: "sa-2", parent_id: "sa-1", title: "Child" },
      timestamp: "2026-07-07T12:00:20.000Z",
    }),
    toolMessage({
      subagent: { id: "sa-1", title: "Parent" },
      timestamp: "2026-07-07T12:00:45.000Z",
    }),
  ]);
  const stats = subagentGroupStats(rows[0]);
  assert.equal(stats.messages, 3);
  assert.equal(stats.toolCalls, 3);
  assert.equal(stats.duration_ms, 45000);

  const childStats = subagentGroupStats(rows[0].childRows[1]);
  assert.equal(childStats.messages, 1);
  assert.equal(childStats.toolCalls, 1);
  assert.equal(childStats.duration_ms, null);
});

test("countToolCalls recurses through nested subagent groups", () => {
  const rows = workRowsFor([
    toolMessage({}),
    toolMessage({ subagent: { id: "sa-1" } }),
    toolMessage({ subagent: { id: "sa-2", parent_id: "sa-1" } }),
    toolMessage({ subagent: { id: "sa-3", parent_id: "sa-2" } }),
  ]);
  assert.equal(countToolCalls(rows), 4);
});

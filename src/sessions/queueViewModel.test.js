import assert from "node:assert/strict";
import test from "node:test";

import {
  applyQueueDelta,
  createQueueInvokeBoundary,
  effectiveSessionDeliveryMode,
  FEATURE_QUEUE_CONTROL_V1,
  mutateQueueRowWithRetry,
  queueListFailed,
  queueListStarted,
  queueListSucceeded,
  queuePresentation,
  queueStateForFeatures,
} from "./queueViewModel.js";

const row = (id, ordinal, text = `text ${ordinal}`) => ({
  id,
  text,
  mode: "queue",
  ordinal,
  created_at_ms: 1_753_500_000_000 + ordinal,
});

function install(rows = [row("held-1", 1)], revision = 31) {
  const initial = queueListStarted(queueStateForFeatures([FEATURE_QUEUE_CONTROL_V1]));
  return queueListSucceeded(initial, { revision, rows }).state;
}

test("queue_control_v1 alone authorizes a delivery mode for the submit payload", () => {
  assert.equal(
    effectiveSessionDeliveryMode([], "steer"),
    undefined,
    "a selected mode is absent on the wire when the feature bit is absent",
  );
  assert.equal(
    effectiveSessionDeliveryMode([FEATURE_QUEUE_CONTROL_V1], "steer"),
    "steer",
  );
  assert.equal(
    effectiveSessionDeliveryMode([FEATURE_QUEUE_CONTROL_V1], "future-mode"),
    "queue",
    "advertised mode support still normalizes unknown selections",
  );
});

test("unsupported never renders as empty", () => {
  const state = queueStateForFeatures([]);
  assert.equal(state.kind, "unsupported");
  assert.deepEqual(queuePresentation(state), {
    kind: "unsupported",
    renderQueue: false,
    empty: false,
    rows: [],
    reason: "",
  });
});

test("a failed list is unknown with its reason, never empty", () => {
  const supported = queueStateForFeatures([FEATURE_QUEUE_CONTROL_V1]);
  const state = queueListFailed(supported, new Error("daemon unavailable"));
  const presentation = queuePresentation(state);
  assert.equal(state.kind, "unknown");
  assert.equal(state.reason, "daemon unavailable");
  assert.equal(presentation.empty, false);
  assert.equal(presentation.kind, "unknown");
});

test("a view-only queue rejection is unknown-with-reason, never a frozen empty snapshot", () => {
  const listing = queueListStarted(queueStateForFeatures([FEATURE_QUEUE_CONTROL_V1]));
  const state = queueListFailed(listing, {
    code: "capability_denied",
    message: "A live queue watch requires Control capability.",
  });
  assert.equal(state.kind, "unknown");
  assert.equal(state.reason, "A live queue watch requires Control capability.");
  assert.deepEqual(state.rows, []);
  assert.equal(queuePresentation(state).empty, false);
});

test("only a valid successful empty list establishes empty", () => {
  const supported = queueStateForFeatures([FEATURE_QUEUE_CONTROL_V1]);
  const installed = queueListSucceeded(queueListStarted(supported), {
    revision: 9,
    rows: [],
  });
  assert.equal(installed.state.kind, "empty");
  assert.equal(queuePresentation(installed.state).empty, true);

  const malformed = queueListSucceeded(queueListStarted(supported), {
    revision: 10,
    rows: null,
  });
  assert.equal(malformed.state.kind, "unknown");
  assert.equal(queuePresentation(malformed.state).empty, false);
});

test("queue rows preserve render-complete text verbatim", () => {
  const text = "  keep this text\nverbatim  ";
  const state = install([row("held-1", 1, text)]);
  assert.equal(state.rows[0].text, text);
});

test("a stale delta is rejected without changing authoritative rows", () => {
  const state = install();
  const result = applyQueueDelta(state, {
    type: "queue_changed",
    revision: 31,
    change: { kind: "removed", id: "held-1" },
  }, { envelopeSeq: 31 });
  assert.equal(result.outcome, "stale");
  assert.strictEqual(result.state, state);
  assert.equal(result.state.rows.length, 1);
});

test("nonconsecutive queue revisions apply; only an explicit stream gap forces re-list", () => {
  const state = install([], 31);
  const applied = applyQueueDelta(state, {
    type: "queue_changed",
    revision: 36,
    change: { kind: "enqueued", row: row("held-1", 1) },
  }, { envelopeSeq: 36 });
  assert.equal(applied.outcome, "applied");
  assert.equal(applied.state.revision, 36);

  const gap = applyQueueDelta(applied.state, {
    type: "queue_changed",
    revision: 38,
    change: { kind: "removed", id: "held-1" },
  }, { envelopeSeq: 38, streamGap: true });
  assert.equal(gap.outcome, "gap");
  assert.equal(gap.relist, true);
  assert.equal(gap.state.kind, "unknown");
});

test("deltas arriving during list are buffered above the installed revision", () => {
  const listing = queueListStarted(queueStateForFeatures([FEATURE_QUEUE_CONTROL_V1]));
  const buffered = applyQueueDelta(listing, {
    type: "queue_changed",
    revision: 34,
    change: { kind: "enqueued", row: row("held-2", 2) },
  }, { envelopeSeq: 34 });
  assert.equal(buffered.outcome, "buffered");

  const installed = queueListSucceeded(buffered.state, {
    revision: 33,
    rows: [row("held-1", 1)],
  });
  assert.equal(installed.state.kind, "rows");
  assert.deepEqual(installed.state.rows.map((entry) => entry.id), ["held-1", "held-2"]);
});

test("malformed deltas fail closed", () => {
  const result = applyQueueDelta(install(), {
    type: "queue_changed",
    change: { kind: "removed", id: "held-1" },
  });
  assert.equal(result.outcome, "malformed");
  assert.equal(result.relist, true);
  assert.equal(result.state.kind, "unknown");
});

test("Tauri queue boundary uses stable ids and revision fences", async () => {
  const calls = [];
  const boundary = createQueueInvokeBoundary(async (command, args) => {
    calls.push([command, args]);
    return { revision: 32 };
  });
  await boundary.list({ sessionId: "session-1" });
  await boundary.remove({ sessionId: "session-1", id: "held-1", revision: 31 });
  await boundary.promoteSteer({ sessionId: "session-1", id: "held-2", revision: 32 });
  assert.deepEqual(calls, [
    ["queue_list", { session_id: "session-1" }],
    ["queue_remove", { session_id: "session-1", id: "held-1", revision: 31 }],
    ["queue_promote_steer", { session_id: "session-1", id: "held-2", revision: 32 }],
  ]);
});

test("RevisionConflict re-reads before retry and never trusts its current revision", async () => {
  const calls = [];
  let mutationCount = 0;
  const boundary = {
    remove: async (args) => {
      calls.push(["remove", args]);
      mutationCount += 1;
      if (mutationCount === 1) {
        throw {
          code: "revision_conflict",
          data: {
            kind: "revision_conflict",
            expected_revision: 31,
            current_revision: 999,
          },
        };
      }
      return { session_id: "session-1", id: "held-1", revision: 44 };
    },
    list: async (args) => {
      calls.push(["list", args]);
      return { revision: 40, rows: [row("held-1", 1)] };
    },
  };

  const result = await mutateQueueRowWithRetry({
    boundary,
    sessionId: "session-1",
    id: "held-1",
    action: "remove",
    state: install(),
  });

  assert.equal(result.status, "mutated");
  assert.deepEqual(calls.map(([kind]) => kind), ["remove", "list", "remove"]);
  assert.equal(calls[0][1].revision, 31);
  assert.equal(calls[2][1].revision, 40, "retry did not use the fresh list revision");
  assert.notEqual(calls[2][1].revision, 999, "retry trusted RevisionConflict.current_revision");
  assert.equal(result.state.kind, "empty");
  assert.equal(result.state.revision, 44);
});

test("conflict re-list skips retry when the stable id is already gone", async () => {
  const calls = [];
  const boundary = {
    promoteSteer: async (args) => {
      calls.push(["promote", args]);
      throw {
        code: "revision_conflict",
        data: { kind: "revision_conflict", current_revision: 40 },
      };
    },
    list: async (args) => {
      calls.push(["list", args]);
      return { revision: 40, rows: [] };
    },
  };
  const result = await mutateQueueRowWithRetry({
    boundary,
    sessionId: "session-1",
    id: "held-1",
    action: "promoteSteer",
    state: install(),
  });
  assert.equal(result.status, "gone");
  assert.deepEqual(calls.map(([kind]) => kind), ["promote", "list"]);
  assert.equal(result.state.kind, "empty");
});

test("conflict retries stop exactly at maxRetries with the last authoritative list", async () => {
  let mutationCalls = 0;
  let listCalls = 0;
  const boundary = {
    remove: async ({ revision }) => {
      mutationCalls += 1;
      if (mutationCalls === 5) {
        return { session_id: "session-1", id: "held-1", revision: revision + 1 };
      }
      throw {
        code: "revision_conflict",
        data: {
          kind: "revision_conflict",
          expected_revision: revision,
          current_revision: revision + 1,
        },
      };
    },
    list: async () => {
      listCalls += 1;
      return { revision: 31 + listCalls, rows: [row("held-1", 1)] };
    },
  };

  const result = await mutateQueueRowWithRetry({
    boundary,
    sessionId: "session-1",
    id: "held-1",
    action: "remove",
    state: install(),
    maxRetries: 1,
  });

  assert.equal(result.status, "conflict", "the fifth mutation must be unreachable");
  assert.equal(result.attempts, 2, "one initial mutation plus one retry");
  assert.equal(mutationCalls, 2, "mutation count must stop at maxRetries + 1");
  assert.equal(listCalls, 2, "each typed conflict refreshes the terminal state once");
  assert.equal(result.state.kind, "rows");
  assert.equal(result.state.revision, 33, "terminal conflict returns the last authoritative list");
  assert.deepEqual(result.state.rows.map((entry) => entry.id), ["held-1"]);
});

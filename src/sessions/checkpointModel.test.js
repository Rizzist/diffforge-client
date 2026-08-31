import assert from "node:assert/strict";
import test from "node:test";

import {
  checkpointUnavailableFromError,
  checkpointView,
  compareDecimalStrings,
  conflictView,
  decimalStringOrNull,
  listPageView,
  mutationReceiptView,
  sortCheckpointsNewestFirst,
} from "./checkpointModel.js";

function record(overrides = {}) {
  return {
    checkpoint_id: "cp-1",
    session_id: "session-1",
    branch_id: "branch-main",
    run_id: "run-1",
    effect_id: "effect-1",
    call_id: "call-1",
    seq: "9007199254740993",
    workspace_revision: "18446744073709551615",
    kind: "edit",
    origin: "tool",
    touched_paths: ["src/a.js", "src/b.js"],
    ...overrides,
  };
}

/* HOUSE LAW 1 — decimal strings only, BigInt ordering, no lossy coercion. */
test("[pin] checkpoint seqs/cursors remain decimal strings and compare exactly above 2^53", () => {
  const unsafe = "9007199254740993";
  assert.equal(decimalStringOrNull(unsafe), unsafe);
  assert.equal(typeof decimalStringOrNull(unsafe), "string");
  assert.equal(decimalStringOrNull(9007199254740993), null);
  assert.equal(decimalStringOrNull("12x"), null);
  assert.equal(decimalStringOrNull(""), null);

  assert.equal(compareDecimalStrings(unsafe, "9007199254740992"), 1);
  assert.equal(compareDecimalStrings("0007", "7"), 0);
  assert.equal(compareDecimalStrings(7, "7"), null);

  const view = checkpointView(record());
  assert.equal(view.seq, unsafe);
  assert.equal(view.workspaceRevision, "18446744073709551615");
  assert.equal(checkpointView(record({ seq: 9007199254740993 })).seq, null);
  assert.equal(checkpointView(record({ workspace_revision: 44 })).workspaceRevision, null);

  const sorted = sortCheckpointsNewestFirst([
    checkpointView(record({ checkpoint_id: "older", seq: "9007199254740992" })),
    checkpointView(record({ checkpoint_id: "newer", seq: unsafe })),
  ]);
  assert.deepEqual(sorted.map((checkpoint) => checkpoint.checkpointId), ["newer", "older"]);
});

/* HOUSE LAW 2 — page emptiness and null-as-END are independent facts. */
test("[pin] next_cursor null means end-of-list while empty pages alone mean no checkpoints", () => {
  const emptyEnd = listPageView({ checkpoints: [], next_cursor: null });
  assert.equal(emptyEnd.empty, true);
  assert.equal(emptyEnd.endOfList, true);
  assert.equal(emptyEnd.cursorState, "end");
  assert.equal(emptyEnd.nextCursor, null);

  const populatedEnd = listPageView({
    checkpoints: [record()],
    next_cursor: null,
  });
  assert.equal(populatedEnd.empty, false);
  assert.equal(populatedEnd.endOfList, true);
  assert.equal(populatedEnd.cursorState, "end");

  const emptyWithMore = listPageView({ checkpoints: [], next_cursor: "73" });
  assert.equal(emptyWithMore.empty, true);
  assert.equal(emptyWithMore.endOfList, false);
  assert.equal(emptyWithMore.nextCursor, "73");
  assert.equal(emptyWithMore.cursorState, "more");

  /* Absence/malformed data is not silently recast as the SDK's explicit
     null terminator. */
  assert.equal(listPageView({ checkpoints: [] }).endOfList, false);
  assert.equal(listPageView({ checkpoints: [], next_cursor: 73 }).cursorState, "invalid");
});

/* HOUSE LAW 3 — every published conflict fence remains visible. */
test("[pin] conflicts preserve the path and independently absent digests", () => {
  const missingExpected = conflictView({
    code: "workspace_conflict",
    path: "src/moved.js",
    current_digest: "sha256:current",
  });
  assert.deepEqual(missingExpected, {
    kind: "conflict",
    path: "src/moved.js",
    expectedDigest: null,
    currentDigest: "sha256:current",
  });

  const nested = conflictView({
    type: "conflict",
    details: {
      path: "README.md",
      expected_digest: "sha256:expected",
    },
  });
  assert.equal(nested.path, "README.md");
  assert.equal(nested.expectedDigest, "sha256:expected");
  assert.equal(nested.currentDigest, null);

  const neitherDigest = conflictView({ kind: "conflict", path: "package.json" });
  assert.equal(neitherDigest.expectedDigest, null);
  assert.equal(neitherDigest.currentDigest, null);
  assert.equal(conflictView(new Error("connection reset")), null);
});

/* HOUSE LAW 4 + typed absence — future enum values survive as themselves. */
test("[pin] unknown kind/origin stay raw and marked unrecognized; optional branch/revision stay absent", () => {
  const future = checkpointView(record({
    branch_id: undefined,
    workspace_revision: undefined,
    kind: "quantum_patch",
    origin: "future_scheduler",
  }));
  assert.deepEqual(future.kind, {
    kind: "unknown",
    raw: "quantum_patch",
    label: "quantum_patch",
    recognized: false,
  });
  assert.deepEqual(future.origin, {
    kind: "unknown",
    raw: "future_scheduler",
    label: "future_scheduler",
    recognized: false,
  });
  assert.equal(future.branchId, null);
  assert.equal(future.workspaceRevision, null);

  const known = checkpointView(record());
  assert.equal(known.kind.recognized, true);
  assert.equal(known.origin.recognized, true);
  assert.deepEqual(known.touchedPaths, ["src/a.js", "src/b.js"]);
});

/* HOUSE LAW 5 — the mutation view is receipt-only, especially restoration. */
test("[pin] mutation receipts retain restored_checkpoint_ids verbatim and infer nothing from the target", () => {
  const restored = ["cp-9", "cp-4", "future:id"];
  const receipt = mutationReceiptView({
    checkpoint: record({ checkpoint_id: "receipt-cp", seq: "44" }),
    restored_checkpoint_ids: restored,
    worker_generation: "generation-7",
  });
  assert.strictEqual(receipt.restoredCheckpointIds, restored);
  assert.deepEqual(receipt.restoredCheckpointIds, ["cp-9", "cp-4", "future:id"]);
  assert.equal(receipt.checkpoint.checkpointId, "receipt-cp");
  assert.equal(receipt.checkpoint.seq, "44");
  assert.equal(receipt.workerGeneration, "generation-7");

  const absent = mutationReceiptView({ checkpoint: record() });
  assert.equal(absent.restoredCheckpointIds, null);
  assert.equal(absent.workerGeneration, null);
});

test("checkpointUnavailableFromError reuses the shipped feature-gate detector", () => {
  assert.equal(checkpointUnavailableFromError(
    new Error("missing_feature: daemon does not advertise checkpoint_v1"),
  ), true);
  assert.equal(checkpointUnavailableFromError("does not advertise checkpoint.list"), true);
  assert.equal(checkpointUnavailableFromError(new Error("connection reset")), false);
});

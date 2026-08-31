import assert from "node:assert/strict";
import test from "node:test";

import {
  forkReceiptView,
  lifecycleUnavailableFromError,
  renameArgs,
  retryEligibility,
} from "./lifecycleModel.js";

test("[pin] cleared rename omits title while a real title is the only title-bearing shape", () => {
  for (const cleared of ["", "   ", undefined, null]) {
    const args = renameArgs(cleared);
    assert.deepEqual(args, {}, "clearing must produce an empty arg fragment");
    assert.equal(Object.prototype.hasOwnProperty.call(args, "title"), false,
      "clear means OMIT title, never an empty-string filler");
  }
  assert.deepEqual(renameArgs("  Daemon-owned title  "), {
    title: "Daemon-owned title",
  });
  assert.notDeepEqual(renameArgs("  Daemon-owned title  "), {},
    "the pin must also prove the set-title branch is live");
});

test("[pin] fork view copies the receipt coordinates verbatim and invents no identity", () => {
  const opaqueBranch = { daemon: "branch-coordinate" };
  const opaqueNode = { daemon: "node-coordinate" };
  const view = forkReceiptView({
    session_id: "new-session-authority",
    source_session_id: "source-session-authority",
    source_branch_id: opaqueBranch,
    fork_node_id: opaqueNode,
    title: "must not leak into a fabricated local title",
  });
  assert.equal(view.sessionId, "new-session-authority");
  assert.equal(view.sourceSessionId, "source-session-authority");
  assert.strictEqual(view.sourceBranchId, opaqueBranch,
    "branch coordinate must survive without coercion");
  assert.strictEqual(view.forkNodeId, opaqueNode,
    "node coordinate must survive without coercion");
  assert.equal(Object.prototype.hasOwnProperty.call(view, "title"), false,
    "the client must not name a fork");

  const absent = forkReceiptView({ source_session_id: "source-only" });
  assert.equal(absent.sessionId, undefined,
    "a missing new id stays absent instead of falling back to the source id");
});

test("[pin] lifecycle unavailability reuses feature-gate detection for String throws", () => {
  assert.equal(lifecycleUnavailableFromError(
    "missing_feature: daemon does not advertise session_lifecycle_v1",
  ), true);
  assert.equal(lifecycleUnavailableFromError(
    new Error("daemon does not advertise run_retry_v1"),
  ), true);
  assert.equal(lifecycleUnavailableFromError("connection reset"), false,
    "ordinary transport errors must remain retryable errors, not capability claims");
});

test("[pin] retry eligibility comes only from published run_state", () => {
  for (const runState of ["failed", "errored", "error"]) {
    const view = retryEligibility({
      run_state: runState,
      status: "idle",
      state_raw: "completed",
      title: "looks healthy",
    });
    assert.equal(view.eligible, true, `${runState} must be retryable`);
    assert.equal(view.kind, "eligible");
    assert.equal(view.runState, runState, "the published spelling survives for disclosure");
  }
  assert.equal(retryEligibility({ run_state: { state: "failed" } }).eligible, true,
    "a structured published run state is still daemon authority");

  const presentationOnly = retryEligibility({
    status: "error",
    state_raw: "failed",
    label: "failed",
    run_id: "run-that-does-not-prove-failure",
  });
  assert.deepEqual(presentationOnly, {
    kind: "unknown",
    eligible: false,
    runState: null,
    reason: "Retry unavailable: run state was not published by the daemon.",
  }, "labels, coarse status, state_raw, and run identity cannot authorize retry");

  const completed = retryEligibility({ run_state: "completed", status: "error" });
  assert.equal(completed.kind, "ineligible");
  assert.equal(completed.eligible, false,
    "a published non-failure wins over a scary presentation status");
});

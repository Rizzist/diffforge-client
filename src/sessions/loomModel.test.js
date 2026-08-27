import assert from "node:assert/strict";
import test from "node:test";

import {
  agentTypeView,
  cliPresence,
  cliPresenceLabel,
  installItemView,
  installJobView,
  installStateView,
  loomUnavailableFromError,
  personaBindingView,
  personaSelectionView,
  registrationReceiptView,
  retryOutcomeView,
  splitCommaList,
  watchOutcomeView,
} from "./loomModel.js";

function job(overrides = {}) {
  return {
    job_id: "job-1",
    agent_type_id: "researcher",
    agent_type_rev: 3,
    agent_type_digest: "digest-abc",
    state: "queued",
    progress: { total: 2, completed: 1, current_cli: "rg" },
    created_at_ms: 1000,
    updated_at_ms: 2000,
    ...overrides,
  };
}

test("agentTypeView defaults omitted list/string fields honestly", () => {
  const view = agentTypeView({
    id: "researcher",
    name: "Researcher",
    job: "research",
    in_type: "question",
    out_type: "report",
    rev: 4,
  });
  assert.deepEqual(view, {
    id: "researcher",
    name: "Researcher",
    job: "research",
    inType: "question",
    outType: "report",
    clis: [],
    apis: [],
    skills: [],
    scripts: [],
    color: "",
    glyph: "",
    rev: 4,
  });

  const full = agentTypeView({
    id: "t",
    name: "T",
    job: "j",
    in_type: "a",
    out_type: "b",
    clis: ["rg", "jq"],
    apis: ["api-1"],
    skills: ["s"],
    scripts: ["run.sh"],
    color: "#a0f",
    glyph: "🧭",
    rev: 1,
  });
  assert.deepEqual(full.clis, ["rg", "jq"]);
  assert.equal(full.color, "#a0f");
  assert.equal(full.glyph, "🧭");
});

test("[pin] cliPresence is a TRI-state: a missing key is 'unprobed', DISTINCT from false's 'missing'", () => {
  /* Absent key = the daemon never probed. This is a THIRD state. */
  assert.equal(cliPresence({ jq: true }, "rg"), "unprobed");
  /* Probed and absent from PATH. */
  assert.equal(cliPresence({ rg: false }, "rg"), "missing");
  /* Probed and found. */
  assert.equal(cliPresence({ rg: true }, "rg"), "present");
  /* The two negatives MUST be distinct — an unprobed program must never be
     rendered as missing. */
  assert.notEqual(cliPresence({ jq: true }, "rg"), cliPresence({ rg: false }, "rg"));
  /* No map at all = nothing was probed. */
  assert.equal(cliPresence(undefined, "rg"), "unprobed");
  assert.equal(cliPresence(null, "rg"), "unprobed");
  /* A non-boolean probe value is not a probe result we may claim. */
  assert.equal(cliPresence({ rg: "yes" }, "rg"), "unprobed");

  assert.equal(cliPresenceLabel("unprobed"), "not probed");
  assert.equal(cliPresenceLabel("missing"), "missing");
  assert.equal(cliPresenceLabel("present"), "present");
});

test("[pin] installStateView preserves an unknown daemon state verbatim as kind 'unknown'", () => {
  for (const known of ["queued", "installing", "verifying", "succeeded", "failed"]) {
    assert.deepEqual(installStateView(known), { kind: known, label: known, raw: known });
  }
  /* A future daemon word survives raw — never coerced onto a known state. */
  const unknown = installStateView("quarantined_by_policy");
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.label, "quarantined_by_policy");
  assert.equal(unknown.raw, "quarantined_by_policy");
});

test("[pin] installJobView.retryable is true ONLY for 'failed'", () => {
  assert.equal(installJobView(job({ state: "failed", error: "boom" })).retryable, true);
  assert.equal(installJobView(job({ state: "queued" })).retryable, false);
  assert.equal(installJobView(job({ state: "succeeded" })).retryable, false);
  assert.equal(installJobView(job({ state: "installing" })).retryable, false);
  assert.equal(installJobView(job({ state: "verifying" })).retryable, false);
  /* An UNKNOWN state is never retryable — we cannot claim it is safe. */
  assert.equal(installJobView(job({ state: "quarantined_by_policy" })).retryable, false);
});

test("installJobView carries progress and error verbatim, absence as null", () => {
  const view = installJobView(job({ state: "installing" }));
  assert.equal(view.jobId, "job-1");
  assert.equal(view.agentTypeId, "researcher");
  assert.equal(view.completed, 1);
  assert.equal(view.total, 2);
  assert.equal(view.currentCli, "rg");
  assert.equal(view.error, null);

  const bare = installJobView({ job_id: "job-2", state: "queued", progress: {} });
  assert.equal(bare.completed, null);
  assert.equal(bare.total, null);
  assert.equal(bare.currentCli, null);

  const failed = installJobView(job({ state: "failed", error: "cli exploded" }));
  assert.equal(failed.error, "cli exploded");
});

test("installItemView preserves per-item state and program", () => {
  const view = installItemView({
    job_id: "job-1",
    ordinal: 0,
    required_cli: { program: "rg" },
    state: "mystery_state",
  });
  assert.equal(view.program, "rg");
  assert.equal(view.state.kind, "unknown");
  assert.equal(view.state.raw, "mystery_state");
  assert.equal(view.error, null);
});

test("[pin] registrationReceiptView never synthesizes install_job_id", () => {
  const without = registrationReceiptView({
    id: "researcher",
    rev: 5,
    digest: "sha-123",
    updated: true,
  });
  /* Absent on the wire = there is NO install job — not one derived from
     id/rev/digest. */
  assert.equal(without.installJobId, null);
  assert.equal(without.digest, "sha-123");

  const withJob = registrationReceiptView({
    id: "researcher",
    rev: 5,
    digest: "sha-123",
    updated: false,
    install_job_id: "job-9",
  });
  assert.equal(withJob.installJobId, "job-9");
});

test("[pin] personaBindingView yields agentTypeId null when the receipt omits agent_type", () => {
  const unbound = personaBindingView({
    session_id: "sess-1",
    selected_seq: 7,
    worker_generation: 2,
  });
  /* No bound persona = null. Never a fabricated default agent type. */
  assert.equal(unbound.agentTypeId, null);
  assert.equal(unbound.sessionId, "sess-1");
  assert.equal(unbound.selectedSeq, 7);
  assert.equal(unbound.workerGeneration, 2);

  const bound = personaBindingView({
    session_id: "sess-1",
    agent_type: "researcher",
    selected_seq: 8,
    worker_generation: 2,
  });
  assert.equal(bound.agentTypeId, "researcher");
});

test("[pin] personaSelectionView keeps an UNSEEN binding 'unknown', DISTINCT from a seen 'none'", () => {
  /* No receipt observed for this session = we do NOT know the binding. */
  const unseen = personaSelectionView(undefined);
  assert.equal(unseen.kind, "unknown");
  assert.equal(unseen.agentTypeId, null);
  /* A SEEN receipt whose agent_type is absent is honestly "none". */
  const none = personaSelectionView(personaBindingView({
    session_id: "sess-1",
    selected_seq: 1,
    worker_generation: 1,
  }));
  assert.equal(none.kind, "none");
  assert.equal(none.agentTypeId, null);
  /* Unseen must NEVER collapse into "none" — that would fabricate absence. */
  assert.notEqual(unseen.kind, none.kind);
  /* A SEEN receipt with an id is bound to exactly that id. */
  const bound = personaSelectionView(personaBindingView({
    session_id: "sess-1",
    agent_type: "researcher",
    selected_seq: 2,
    worker_generation: 1,
  }));
  assert.equal(bound.kind, "bound");
  assert.equal(bound.agentTypeId, "researcher");
});

test("retryOutcomeView maps requeued/rejected and preserves unknown futures raw", () => {
  const requeued = retryOutcomeView({ status: "requeued", job: job({ state: "queued" }) });
  assert.equal(requeued.status, "requeued");
  assert.equal(requeued.job.jobId, "job-1");

  const rejected = retryOutcomeView({
    status: "rejected",
    rejection: { reason: "state_not_retryable", state: "succeeded" },
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reason, "state_not_retryable");
  assert.deepEqual(rejected.rejection, { reason: "state_not_retryable", state: "succeeded" });

  const future = retryOutcomeView({ status: "deferred_until_reboot", extra: 1 });
  assert.equal(future.status, "unknown");
  assert.deepEqual(future.raw, { status: "deferred_until_reboot", extra: 1 });
});

test("watchOutcomeView advances by next_cursor and preserves rejection/unknown", () => {
  const watching = watchOutcomeView({
    status: "watching",
    requested_after_cursor: 0,
    replay_through_cursor: 2,
    next_cursor: 2,
    events: [
      { cursor: 1, job: job({ state: "installing" }) },
      { cursor: 2, job: job({ state: "succeeded" }) },
    ],
  });
  assert.equal(watching.status, "watching");
  assert.equal(watching.nextCursor, 2);
  assert.equal(watching.events.length, 2);
  assert.equal(watching.events[1].job.state.kind, "succeeded");

  const noEvents = watchOutcomeView({
    status: "watching",
    requested_after_cursor: 2,
    replay_through_cursor: 2,
    next_cursor: 2,
  });
  assert.deepEqual(noEvents.events, []);

  const rejected = watchOutcomeView({
    status: "rejected",
    rejection: { reason: "cursor_ahead", requested: 9, head: 2 },
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.reason, "cursor_ahead");
  assert.deepEqual(rejected.rejection, { reason: "cursor_ahead", requested: 9, head: 2 });

  const future = watchOutcomeView({ status: "streaming_v2" });
  assert.equal(future.status, "unknown");
  assert.deepEqual(future.raw, { status: "streaming_v2" });
});

test("loomUnavailableFromError recognizes feature-missing phrasings only", () => {
  /* The daemon's REAL feature-gate error string (haider_rpc_ade). */
  assert.equal(
    loomUnavailableFromError("missing_feature: daemon does not advertise loom_v1"),
    true,
  );
  assert.equal(loomUnavailableFromError("unknown command: loom_list"), true);
  assert.equal(loomUnavailableFromError("loom is unavailable on this daemon"), true);
  assert.equal(loomUnavailableFromError(new Error("method not supported")), true);
  assert.equal(loomUnavailableFromError("not implemented"), true);
  assert.equal(loomUnavailableFromError("connection reset by peer"), false);
  assert.equal(loomUnavailableFromError("registry digest mismatch"), false);
});

test("splitCommaList trims and drops empties", () => {
  assert.deepEqual(splitCommaList(" rg, jq ,,  fd "), ["rg", "jq", "fd"]);
  assert.deepEqual(splitCommaList(""), []);
  assert.deepEqual(splitCommaList(null), []);
});

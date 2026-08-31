import assert from "node:assert/strict";
import test from "node:test";

import {
  agentTypeView,
  archiveOutcomeView,
  cancelOutcomeView,
  cliPresence,
  cliPresenceLabel,
  confirmOutcomeView,
  draftFenceFor,
  draftView,
  installItemView,
  installJobView,
  installStateView,
  loomConflictView,
  loomUnavailableFromError,
  personaBindingView,
  personaSelectionView,
  registryDeltaView,
  registryEntryView,
  registryFenceFor,
  registryListView,
  registryWatchView,
  registrationReceiptView,
  retryOutcomeView,
  splitCommaList,
  validationView,
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

test("[pin] validationView keeps one-based line and column verbatim and labels the digest as preview", () => {
  const receipt = {
    errors: [
      { line: 1, column: 17, field: "job", message: "expected a string" },
      { line: "3", column: "004", message: "future coordinate encoding" },
    ],
    canonical_digest: "sha256:preview-only",
  };
  const view = validationView(receipt);
  assert.deepEqual(view.errors, [
    { line: 1, column: 17, field: "job", message: "expected a string" },
    { line: "3", column: "004", field: null, message: "future coordinate encoding" },
  ]);
  assert.equal(view.errors[0].line, receipt.errors[0].line,
    "one-based line must not be re-based");
  assert.equal(view.errors[0].column, receipt.errors[0].column,
    "published column must not be rounded away");
  assert.equal(view.errors[1].column, "004",
    "even a future coordinate encoding is carried verbatim");
  assert.equal(view.canonicalDigestPreview, "sha256:preview-only");
  assert.equal(Object.prototype.hasOwnProperty.call(view, "digest"), false,
    "the preview must never masquerade as a stored registry digest");

  const sdkNested = validationView({
    errors: [{
      code: "invalid_field",
      message: "bad dependency",
      location: { line: 7, column: 13, field: "nodes[2].depends_on" },
    }],
  });
  assert.deepEqual(sdkNested.errors[0], {
    line: 7,
    column: 13,
    field: "nodes[2].depends_on",
    message: "bad dependency",
  });
});

test("[pin] draft and registry fence helpers echo read values without computing replacements", () => {
  const wireDraft = {
    authoring_id: "author-7",
    expected_revision: "9007199254740993",
    kind: "agent_type",
    id: "researcher",
    text: "{ agent type draft }",
    expected_rev: "00041",
    expected_digest: "digest-read-from-draft",
  };
  const draft = draftView(wireDraft);
  assert.deepEqual(draftFenceFor(draft), {
    authoring_id: wireDraft.authoring_id,
    expected_revision: wireDraft.expected_revision,
  });
  assert.deepEqual(registryFenceFor(draft), {
    expected_rev: wireDraft.expected_rev,
    expected_digest: wireDraft.expected_digest,
  });

  const listed = registryEntryView({
    id: "researcher",
    name: "Researcher",
    rev: "00041",
    digest: "digest-read-from-list",
  });
  assert.deepEqual(registryFenceFor(listed), {
    expected_rev: listed.rev,
    expected_digest: listed.digest,
  });
  assert.equal(draftFenceFor(draft).expected_revision, "9007199254740993",
    "a fence is not incremented or numeric-parsed");
  assert.equal(registryFenceFor(listed).expected_rev, "00041",
    "a listed fence keeps its exact representation");
  assert.equal(registryFenceFor({ rev: null, digest: null }), null,
    "an unread fence is omitted, never defaulted");
  assert.deepEqual(registryFenceFor({ rev: 9, digest: null }), { expected_rev: 9 },
    "an optional unread digest is omitted rather than invented");

  const sdkDraft = draftView({
    authoring_id: "author-sdk",
    revision: "9007199254740999",
    kind: "workflow",
    text: "workflow text",
  });
  assert.equal(draftFenceFor(sdkDraft).expected_revision, "9007199254740999",
    "the SDK draft's revision field is echoed as expected_revision on revise");
});

test("[pin] confirmOutcomeView treats confirmed null as not confirmed and fabricates no entry", () => {
  const wire = { confirmed: null, reason: "registry_revision_conflict" };
  const view = confirmOutcomeView(wire);
  assert.equal(view.kind, "not_confirmed");
  assert.equal(view.confirmed, null);
  assert.equal(view.reason, "registry_revision_conflict");
  assert.equal(Object.prototype.hasOwnProperty.call(view, "entry"), false,
    "no registry row may be fabricated from the submitted draft");

  const confirmed = { id: "researcher", rev: 5, digest: "saved" };
  assert.deepEqual(confirmOutcomeView({ confirmed }).confirmed, confirmed);
  assert.equal(confirmOutcomeView({ future: true }).kind, "unknown");
  const omittedNull = confirmOutcomeView({
    errors: [{
      message: "not valid",
      location: { line: 2, column: 5, field: "id" },
    }],
  });
  assert.equal(omittedNull.kind, "not_confirmed",
    "SDK Option::None omission plus errors is still not confirmed");
  assert.equal(omittedNull.errors[0].column, 5);
});

test("archiveOutcomeView keeps changed, already, not-found, and unknown distinct", () => {
  assert.deepEqual(
    archiveOutcomeView({ status: "changed", entry: { id: "a" } }).kind,
    "changed",
  );
  const already = archiveOutcomeView({ status: "already_archived", at: 7 });
  assert.equal(already.kind, "already");
  assert.equal(already.state, "already_archived");
  assert.equal(archiveOutcomeView({ status: "not_found", id: "gone" }).kind, "not_found");
  const future = { status: "retained_by_policy", policy: "org" };
  assert.equal(archiveOutcomeView(future).kind, "unknown");
  assert.deepEqual(archiveOutcomeView(future).raw, future);
});

test("[pin] cancelOutcomeView preserves already-terminal state and unknown output raw", () => {
  assert.equal(cancelOutcomeView("cancelled").kind, "cancelled");
  const terminalWire = { status: "already_terminal", state: "quarantined_future_state" };
  const terminal = cancelOutcomeView(terminalWire);
  assert.equal(terminal.kind, "already_terminal");
  assert.equal(terminal.state, terminalWire.state,
    "the daemon's terminal state must be shown verbatim");

  const futureWire = { status: "cancel_deferred", retry_after_ms: 500 };
  const future = cancelOutcomeView(futureWire);
  assert.equal(future.kind, "unknown");
  assert.equal(future.raw, futureWire,
    "unknown cancel output is raw, never coerced into success/failure");
  const sdkReceipt = {
    install_job_id: "install-7",
    outcome: { status: "already_terminal", state: "cancelled" },
  };
  assert.equal(cancelOutcomeView(sdkReceipt).state, "cancelled",
    "the unwrapped SDK receipt's outcome is decoded without losing its state");
  const sdkFuture = { install_job_id: "install-7", outcome: futureWire };
  assert.equal(cancelOutcomeView(sdkFuture).raw, futureWire,
    "an unknown SDK outcome is shown raw without its receipt wrapper");
});

test("[pin] a default list proves only none active; archived absence needs an explicit read", () => {
  const defaultRead = registryListView({ agent_types: [], workflows: [] });
  assert.deepEqual(defaultRead.activeAgentTypes, []);
  assert.deepEqual(defaultRead.activeWorkflows, []);
  assert.equal(defaultRead.archivedEntries, null,
    "default list excludes archived; [] would falsely claim none exist");
  assert.equal(defaultRead.archivedIncluded, false);

  const explicitRead = registryListView({
    agent_types: [],
    workflows: [],
    archived_agent_types: [],
    archived_workflows: [],
  }, { includeArchived: true });
  assert.deepEqual(explicitRead.archivedEntries, []);
  assert.equal(explicitRead.archivedIncluded, true);

  const withArchived = registryListView({
    agent_types: [],
    archived_entries: [{
      kind: "agent_type",
      id: "old-agent",
      name: "Old agent",
      rev: 2,
      digest: "read-digest",
    }],
  }, { includeArchived: true });
  assert.equal(withArchived.archivedEntries[0].archived, true);
  assert.equal(withArchived.archivedEntries[0].digest, "read-digest");
});

test("registryDeltaView validates decimal-string cursors and preserves unknown deltas", () => {
  const wire = {
    watch_id: "watch-1",
    delta: {
      action: "archived",
      cursor: "9007199254740993",
      after_cursor: "9007199254740992",
      registry_kind: "agent_type",
      entry: { id: "researcher" },
    },
  };
  const delta = registryDeltaView(wire);
  assert.equal(delta.kind, "archived");
  assert.equal(delta.cursor, "9007199254740993");
  assert.equal(delta.afterCursor, "9007199254740992");
  assert.equal(delta.id, "researcher");
  assert.equal(registryDeltaView({ cursor: 9007199254740992 }).cursor, null,
    "numeric cursors are rejected at the boundary");
  const future = { watch_id: "w", cursor: "9", action: "policy_retained", extra: 1 };
  const unknown = registryDeltaView(future);
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.raw, future);
  assert.equal(registryDeltaView({ action: "gap", cursor: "10" }).kind, "rebaseline");
  assert.equal(registryDeltaView({
    change: "revision_added",
    cursor: "11",
    entry: { kind: "workflow", id: "review" },
  }).kind, "updated");

  const watch = registryWatchView({
    watch_id: "watch-sdk",
    requested_after_cursor: "9007199254740998",
    baseline: {
      through_cursor: "9007199254740999",
      entries: [
        {
          entry: {
            kind: "workflow",
            id: "review",
            rev: 37,
            digest: "digest-37",
            archived: false,
          },
          record: { name: "Review workflow", future: { opaque: true } },
        },
      ],
    },
  });
  assert.equal(watch.cursor, "9007199254740999");
  assert.equal(watch.baseline.activeWorkflows[0].name, "Review workflow");
  assert.equal(watch.baseline.activeWorkflows[0].digest, "digest-37");
  assert.equal(watch.baseline.cliPresentPublished, false,
    "an entries-only watch baseline must not erase a prior CLI probe map");
  assert.deepEqual(watch.baseline.archivedEntries, [],
    "loom.watch is an explicit archive-aware baseline");
});

test("typed Loom conflicts preserve expected/current coordinates for explicit re-read", () => {
  const registry = loomConflictView({
    code: "revision_conflict",
    message: "registry head moved",
    data: {
      kind: "loom_revision_conflict",
      expected: { rev: 37, digest: "observed-37" },
      current_rev: 38,
      current_digest: "current-38",
    },
  });
  assert.deepEqual({
    expectedRev: registry.expectedRev,
    currentRev: registry.currentRev,
    expectedDigest: registry.expectedDigest,
    currentDigest: registry.currentDigest,
  }, {
    expectedRev: 37,
    currentRev: 38,
    expectedDigest: "observed-37",
    currentDigest: "current-38",
  });

  const authoring = loomConflictView({
    code: "revision_conflict",
    data: {
      kind: "revision_conflict",
      expected_revision: "9007199254740993",
      current_revision: "9007199254740994",
    },
  });
  assert.equal(authoring.expectedRevision, "9007199254740993");
  assert.equal(authoring.currentRevision, "9007199254740994");
});

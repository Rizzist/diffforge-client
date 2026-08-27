import assert from "node:assert/strict";
import test from "node:test";

import {
  catalogEntryView,
  compileErrorListView,
  fenceFor,
  graphStatusView,
  isMainSessionEligible,
  revisionConflictView,
  workflowCatalogView,
  workflowInstanceView,
  workflowRecordView,
  workflowRegistrationReceiptView,
  workflowUnavailableFromError,
} from "./workflowModel.js";

function instance(overrides = {}) {
  return {
    id: "review_loop",
    revision: 4,
    digest: "src-digest-aaa",
    template_digest: "tpl-digest-bbb",
    pipe_version: "1",
    source: "a | b",
    node_metadata: { a: { note: "x" } },
    compiled_template: { nodes: ["a", "b"] },
    ...overrides,
  };
}

/* HOUSE LAW 1 — the two digests are never collapsed. */
test("[pin] workflowInstanceView keeps digest and template_digest DISTINCT and never backfills either", () => {
  const view = workflowInstanceView(instance());
  assert.equal(view.kind, "instance");
  assert.equal(view.digest, "src-digest-aaa");
  assert.equal(view.templateDigest, "tpl-digest-bbb");
  /* The two facts are independent — they must never be shown as one. */
  assert.notEqual(view.digest, view.templateDigest);

  /* A built-in has NO user-source digest: typed absence (null), never a
     copy of template_digest. */
  const builtIn = workflowInstanceView(instance({ digest: undefined }));
  assert.equal(builtIn.digest, null);
  assert.equal(builtIn.templateDigest, "tpl-digest-bbb");

  /* And an instance without a compiled digest never borrows the source
     digest the other way. */
  const uncompiled = workflowInstanceView(instance({ template_digest: undefined }));
  assert.equal(uncompiled.digest, "src-digest-aaa");
  assert.equal(uncompiled.templateDigest, null);

  /* ONLY template_digest is the selection fence — never the user-source
     digest, even when template_digest is absent. */
  assert.equal(fenceFor(view), "tpl-digest-bbb");
  assert.notEqual(fenceFor(view), view.digest);
  assert.equal(fenceFor(uncompiled), undefined);
});

/* HOUSE LAW 2 — the fence exists only when it was actually read. */
test("[pin] fenceFor returns undefined (key omitted) without a real instance read — never a fabricated fence", () => {
  /* No read at all. */
  assert.equal(fenceFor(undefined), undefined);
  assert.equal(fenceFor(null), undefined);
  /* A read that said "does not exist" carries no fence. */
  assert.equal(fenceFor(workflowInstanceView(null)), undefined);
  /* An instance without template_digest carries no fence — not "", not
     null, not the user-source digest. */
  const noFence = fenceFor(workflowInstanceView(instance({ template_digest: undefined })));
  assert.equal(noFence, undefined);
  assert.notEqual(noFence, null);
  assert.notEqual(noFence, "");
  /* An empty-string template_digest is not a fence either. */
  assert.equal(fenceFor(workflowInstanceView(instance({ template_digest: "" }))), undefined);
  /* Only a real read yields the fence, verbatim. */
  assert.equal(fenceFor(workflowInstanceView(instance())), "tpl-digest-bbb");
});

/* HOUSE LAW 3 — catalog absence is NOT an empty catalog. The wire field
   is Array | null: null = the daemon did not advertise the catalog
   feature (loom_list does NOT throw for this), [] = advertised with zero
   entries. */
test("[pin] workflow_catalog null/absent is 'unavailable', DISTINCT from a present empty catalog", () => {
  /* The shipped SDK shape: workflow_catalog: null = feature NOT
     advertised. This must NEVER be read as "0 workflows". */
  const nullField = workflowCatalogView({ agent_types: [], workflows: [], workflow_catalog: null });
  assert.equal(nullField.kind, "unavailable");
  /* An older daemon without the field at all is also unavailable. */
  const absent = workflowCatalogView({ agent_types: [], workflows: [] });
  assert.equal(absent.kind, "unavailable");
  /* The catalog feature advertised with zero entries is honestly
     available — an array, even empty, means advertised. */
  const empty = workflowCatalogView({ agent_types: [], workflows: [], workflow_catalog: [] });
  assert.equal(empty.kind, "available");
  assert.deepEqual(empty.entries, []);
  /* The two states must NEVER collapse — "unavailable" is not "0". */
  assert.notEqual(nullField.kind, empty.kind);
  assert.notEqual(absent.kind, empty.kind);
  /* No result at all is also unavailable, never an empty catalog. */
  assert.equal(workflowCatalogView(null).kind, "unavailable");
  assert.equal(workflowCatalogView(undefined).kind, "unavailable");

  const populated = workflowCatalogView({
    workflow_catalog: [
      { origin: "built_in", id: "solo", main_session_eligible: true, template: {} },
    ],
  });
  assert.equal(populated.kind, "available");
  assert.equal(populated.entries.length, 1);
  assert.equal(populated.entries[0].kind, "built_in");
});

/* HOUSE LAW 4 — instance:null is "does not exist". */
test("[pin] workflowInstanceView(null) is kind 'missing' — never a substituted row", () => {
  const missing = workflowInstanceView(null);
  assert.deepEqual(missing, { kind: "missing" });
  /* No instance-shaped fields may leak out of a missing read: nothing to
     render as a current row, built-in, or local compile. */
  assert.equal(missing.id, undefined);
  assert.equal(missing.templateDigest, undefined);
  assert.equal(workflowInstanceView(undefined).kind, "missing");
});

/* HOUSE LAW 5 — eligibility is the published boolean only. */
test("[pin] main_session_eligible comes from the published boolean — never id prefix, origin, or template shape", () => {
  /* An id that LOOKS main-session-ish confers nothing. */
  const mainLookingId = catalogEntryView({
    origin: "built_in",
    id: "main_default",
    main_session_eligible: false,
    template: { start: "main" },
  });
  assert.equal(mainLookingId.mainSessionEligible, false);
  assert.equal(isMainSessionEligible(mainLookingId), false);

  /* origin built_in confers nothing on its own; an ABSENT boolean is not
     eligibility. */
  const absentBoolean = catalogEntryView({ origin: "built_in", id: "x", template: {} });
  assert.equal(absentBoolean.mainSessionEligible, false);
  /* Truthy non-booleans are not the published boolean. */
  const truthyString = catalogEntryView({
    origin: "user", id: "y", main_session_eligible: "yes", workflow: {},
  });
  assert.equal(truthyString.mainSessionEligible, false);

  /* Only the explicit boolean grants eligibility — on either origin. */
  assert.equal(
    isMainSessionEligible(catalogEntryView({
      origin: "user", id: "weird_prefix_zzz", main_session_eligible: true, workflow: {},
    })),
    true,
  );
  /* An unknown origin publishes NO eligibility, whatever its fields say. */
  const unknown = catalogEntryView({
    origin: "future_origin", id: "z", main_session_eligible: true,
  });
  assert.equal(unknown.kind, "unknown");
  assert.equal(isMainSessionEligible(unknown), false);
});

/* HOUSE LAW 6 — a revision conflict is decoded for display, never retried.
   The shipped error is WorkflowCommandError { code, message, retryable,
   data }, and the conflict coordinates live UNDER data:
   { code: "revision_conflict", data: { kind: "workflow_revision_conflict",
     expected_digest, current_digest, current_revision } }. */
test("[pin] revisionConflictView decodes the coordinates from error.data for a re-read prompt and nothing else", () => {
  const conflict = revisionConflictView({
    code: "revision_conflict",
    message: "workflow template digest changed",
    retryable: false,
    data: {
      kind: "workflow_revision_conflict",
      expected_digest: "tpl-old",
      current_digest: "tpl-new",
      current_revision: 9,
    },
  });
  assert.equal(conflict.kind, "revision_conflict");
  assert.equal(conflict.expectedDigest, "tpl-old");
  assert.equal(conflict.currentDigest, "tpl-new");
  assert.equal(conflict.currentRevision, 9);
  /* Expected and current must come through as THEMSELVES — swapping them
     would tell the user to re-read the wrong side. */
  assert.notEqual(conflict.expectedDigest, conflict.currentDigest);

  /* The coordinates live ONLY under data. Decoys at the error's TOP level
     must be ignored — a decode that reads top-level fields fails here. */
  const nested = revisionConflictView({
    code: "revision_conflict",
    message: "conflict",
    expected_digest: "decoy-top-expected",
    current_digest: "decoy-top-current",
    current_revision: 999,
    data: {
      kind: "workflow_revision_conflict",
      expected_digest: "a",
      current_digest: "b",
      current_revision: 2,
    },
  });
  assert.equal(nested.expectedDigest, "a");
  assert.equal(nested.currentDigest, "b");
  assert.equal(nested.currentRevision, 2);

  /* data.kind alone identifies a conflict, even without the code. */
  const byDataKind = revisionConflictView({
    message: "boom",
    data: {
      kind: "workflow_revision_conflict",
      expected_digest: "x",
      current_digest: "y",
      current_revision: 1,
    },
  });
  assert.equal(byDataKind.kind, "revision_conflict");
  assert.equal(byDataKind.expectedDigest, "x");

  /* String-form errors decode too — the message-regex path is the
     LAST-RESORT fallback for a bare String error. */
  const fromString = revisionConflictView(
    'revision_conflict: expected_digest=tpl-old current_digest=tpl-new current_revision=9',
  );
  assert.equal(fromString.kind, "revision_conflict");
  assert.equal(fromString.expectedDigest, "tpl-old");
  assert.equal(fromString.currentDigest, "tpl-new");
  assert.equal(fromString.currentRevision, 9);

  /* JSON-string errors decode as the same nested structure. */
  const fromJson = revisionConflictView(JSON.stringify({
    code: "revision_conflict",
    message: "conflict",
    data: {
      kind: "workflow_revision_conflict",
      expected_digest: "a",
      current_digest: "b",
      current_revision: 2,
    },
  }));
  assert.equal(fromJson.expectedDigest, "a");
  assert.equal(fromJson.currentDigest, "b");

  /* A non-conflict error is NOT a conflict — null, so callers cannot grow
     an auto-resubmit path off an ordinary failure. */
  assert.equal(revisionConflictView("connection reset by peer"), null);
  assert.equal(revisionConflictView(new Error("missing_feature: x")), null);
  /* Missing fields stay null — never fabricated into a usable digest. */
  const partial = revisionConflictView("revision_conflict");
  assert.equal(partial.kind, "revision_conflict");
  assert.equal(partial.expectedDigest, null);
  assert.equal(partial.currentDigest, null);
  assert.equal(partial.currentRevision, null);
});

test("catalogEntryView tags built_in/user and keeps an unknown origin opaque", () => {
  const builtIn = catalogEntryView({
    origin: "built_in", id: "solo", main_session_eligible: true, template: { n: 1 },
  });
  assert.equal(builtIn.kind, "built_in");
  assert.equal(builtIn.id, "solo");
  assert.deepEqual(builtIn.template, { n: 1 });

  const user = catalogEntryView({
    origin: "user", id: "mine", main_session_eligible: false, workflow: { w: 1 },
  });
  assert.equal(user.kind, "user");
  assert.deepEqual(user.workflow, { w: 1 });

  /* Unknown origin: raw preserved, NO v1 identity/eligibility/template. */
  const unknown = catalogEntryView({ origin: "v2_thing", id: "hidden", template: {} });
  assert.equal(unknown.kind, "unknown");
  assert.equal(unknown.originRaw, "v2_thing");
  assert.equal(unknown.id, undefined);
  assert.equal(unknown.template, undefined);
  assert.deepEqual(unknown.raw, { origin: "v2_thing", id: "hidden", template: {} });
});

test("workflowRecordView renders id/name when present, else stays an opaque record", () => {
  const named = workflowRecordView({ id: "wf-1", name: "Review loop", steps: 3 });
  assert.equal(named.id, "wf-1");
  assert.equal(named.name, "Review loop");
  assert.deepEqual(named.raw, { id: "wf-1", name: "Review loop", steps: 3 });
  /* No invented summary fields for a shape we do not own. */
  const opaque = workflowRecordView({ blob: true });
  assert.equal(opaque.id, null);
  assert.equal(opaque.name, null);
  assert.deepEqual(opaque.raw, { blob: true });
});

test("graphStatusView types the run fields and keeps null/absent as honest 'none'", () => {
  /* No active pinned workflow: honest none, never an invented graph. */
  assert.deepEqual(graphStatusView(null), { kind: "none" });
  assert.deepEqual(graphStatusView(undefined), { kind: "none" });

  const active = graphStatusView({
    graph_id: "g-1",
    template: "review_loop",
    digest: "tpl-digest-bbb",
    template_version: 2,
    start_node: "plan",
    phase: "running",
    current_node: "review",
    ready_nodes: ["fix", "ship"],
    attempt: 1,
    nodes: { plan: { state: "done" } },
    blocked_reason: null,
    pending_menus: [],
    run_set: { id: "rs-1" },
  });
  assert.equal(active.kind, "active");
  assert.equal(active.graphId, "g-1");
  assert.equal(active.template, "review_loop");
  assert.equal(active.phase, "running");
  assert.equal(active.currentNode, "review");
  assert.deepEqual(active.readyNodes, ["fix", "ship"]);
  assert.equal(active.attempt, 1);
  /* Opaque carriage: nodes/blocked_reason/run_set verbatim. */
  assert.deepEqual(active.nodes, { plan: { state: "done" } });
  assert.equal(active.blockedReason, null);
  assert.deepEqual(active.runSet, { id: "rs-1" });

  /* Absent optionals stay typed-absent, never fabricated. */
  const sparse = graphStatusView({ graph_id: "g-2", template: "t", phase: "blocked" });
  assert.equal(sparse.startNode, null);
  assert.equal(sparse.currentNode, null);
  assert.deepEqual(sparse.readyNodes, []);
  assert.equal(sparse.attempt, null);
  assert.equal(sparse.runSet, null);
});

test("workflowRegistrationReceiptView maps id/rev/digest/updated", () => {
  const receipt = workflowRegistrationReceiptView({
    id: "wf-1", rev: 3, digest: "d-1", updated: true,
  });
  assert.deepEqual(receipt, { id: "wf-1", rev: 3, digest: "d-1", updated: true });
  assert.equal(workflowRegistrationReceiptView({ id: "wf-2" }).updated, false);
  assert.equal(workflowRegistrationReceiptView({ id: "wf-2" }).rev, null);
});

test("compileErrorListView surfaces the daemon's compile error list verbatim, never swallowed", () => {
  /* Structured list on the error record. */
  assert.deepEqual(
    compileErrorListView({ message: "compile failed", errors: ["line 1: bad pipe", "line 4: unknown node"] }),
    ["line 1: bad pipe", "line 4: unknown node"],
  );
  assert.deepEqual(
    compileErrorListView({ compile_errors: ["cycle detected"] }),
    ["cycle detected"],
  );
  /* JSON-string errors decode as structure. */
  assert.deepEqual(
    compileErrorListView(JSON.stringify({ errors: ["e1", "e2"] })),
    ["e1", "e2"],
  );
  /* Non-string items survive verbatim (stringified, not dropped). */
  assert.deepEqual(
    compileErrorListView({ errors: [{ line: 2, msg: "bad" }] }),
    ['{"line":2,"msg":"bad"}'],
  );
  /* No structured list: the raw message IS the surfaced failure. */
  assert.deepEqual(compileErrorListView("pipe compile exploded"), ["pipe compile exploded"]);
  /* Even a shapeless failure yields a non-empty, honest line. */
  assert.deepEqual(compileErrorListView(null), ["Workflow registration failed."]);
});

test("workflowUnavailableFromError reuses Loom's feature-gate recognition", () => {
  assert.equal(
    workflowUnavailableFromError("missing_feature: daemon does not advertise graph_v1"),
    true,
  );
  assert.equal(workflowUnavailableFromError("unknown command: graph_status"), true);
  assert.equal(workflowUnavailableFromError(new Error("method not supported")), true);
  assert.equal(workflowUnavailableFromError("connection reset by peer"), false);
  assert.equal(workflowUnavailableFromError("revision_conflict"), false);
});

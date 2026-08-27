/* Workflow / convergence-graph view model (P1′): pure, side-effect-free
   transforms between the daemon's wire shapes and what the UI renders.
   House law, same as Loom's: a plausible local computation must not stand
   in for a fact an authority already publishes, and absence must never be
   fabricated into a value. Concretely —
   - the two digests are never collapsed: `WorkflowInstanceV1.digest` (the
     user-source digest, absent for built-ins) and `template_digest` (the
     compiled graph digest) are DISTINCT facts, and ONLY `template_digest`
     is the selection fence;
   - a null (or missing) `workflow_catalog` field means the catalog
     FEATURE is unavailable — never an empty catalog;
   - `instance: null` means the instance does not exist — never a
     substituted current row, built-in, or local compile;
   - main-session eligibility is the published `main_session_eligible`
     boolean and nothing else — never inferred from id prefix, origin, or
     template shape;
   - a `revision_conflict` is decoded and shown (expected vs current) so
     the user can re-read; it is never auto-retried with the current
     digest;
   - workflow run state comes only from `graph_status` — never derived from
     the workflows list, a selected agent_type, or session lineage. */

export { loomUnavailableFromError as workflowUnavailableFromError } from "./loomModel.js";

function textOrNull(value) {
  return typeof value === "string" ? value : null;
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

/* One workflow_catalog entry, origin-tagged. Only the two origins the v1
   contract publishes expose identity/eligibility/payload; an UNKNOWN origin
   is preserved raw and exposes NOTHING of the v1 shape — we may not claim
   an id, eligibility, or template for a record we do not recognize. */
export function catalogEntryView(entry) {
  const origin = entry?.origin;
  if (origin === "built_in") {
    return {
      kind: "built_in",
      id: String(entry?.id ?? ""),
      /* Eligibility is the PUBLISHED boolean only: exactly `true` is
         eligible. Never inferred from id prefix, origin, or template. */
      mainSessionEligible: entry?.main_session_eligible === true,
      template: entry?.template ?? null,
      raw: entry ?? null,
    };
  }
  if (origin === "user") {
    return {
      kind: "user",
      id: String(entry?.id ?? ""),
      mainSessionEligible: entry?.main_session_eligible === true,
      workflow: entry?.workflow ?? null,
      raw: entry ?? null,
    };
  }
  return {
    kind: "unknown",
    originRaw: origin == null ? null : String(origin),
    raw: entry ?? null,
  };
}

/* The main-session picker filter: the published boolean, nothing else. An
   unknown-origin entry publishes no eligibility, so it is never eligible. */
export function isMainSessionEligible(entryView) {
  if (!entryView || entryView.kind === "unknown") return false;
  return entryView.mainSessionEligible === true;
}

/* The catalog from a loom_list result. The wire field is Array | null:
   `workflow_catalog: null` (or an absent/older field) is the daemon NOT
   advertising the catalog feature — a typed "unavailable" state, NEVER an
   empty catalog. Only a real array — even an empty one — is an advertised
   catalog ("available", possibly with zero entries). Null is never read as
   "0 workflows". */
export function workflowCatalogView(listResult) {
  const raw = listResult && typeof listResult === "object"
    ? listResult.workflow_catalog
    : null;
  if (!Array.isArray(raw)) {
    return { kind: "unavailable", entries: [] };
  }
  return { kind: "available", entries: raw.map(catalogEntryView) };
}

/* One compiled user-workflow record from loom_list's `workflows`. The
   record is OPAQUE: render id/name when present, otherwise keep the raw
   record — never invent summary fields for a shape we do not own. */
export function workflowRecordView(record) {
  return {
    id: textOrNull(record?.id),
    name: textOrNull(record?.name),
    raw: record ?? null,
  };
}

/* A workflow_instance_get result. `instance: null` means the instance DOES
   NOT EXIST — kind "missing", never a substituted current row, built-in,
   or local compile. For a real instance the two digests stay SEPARATE:
   `digest` is the user-source digest (typed-absent for built-ins) and
   `templateDigest` is the compiled-graph digest — only the latter is ever
   a selection fence. pipe_version/node_metadata absence stays null. */
export function workflowInstanceView(instance) {
  if (instance == null) return { kind: "missing" };
  return {
    kind: "instance",
    id: String(instance?.id ?? ""),
    revision: finiteOrNull(instance?.revision),
    /* User-source digest: absent for built-ins, and NEVER backfilled from
       template_digest — the two are independent facts. */
    digest: textOrNull(instance?.digest),
    templateDigest: textOrNull(instance?.template_digest),
    pipeVersion: instance?.pipe_version ?? null,
    source: textOrNull(instance?.source),
    nodeMetadata: instance?.node_metadata ?? null,
    compiledTemplate: instance?.compiled_template ?? null,
  };
}

/* THE fence rule. `expected_digest` may be sent iff it was actually read:
   it is `templateDigest` copied verbatim from a workflowInstanceView of a
   real instance. Anything else — no read, a missing instance, an instance
   without a template_digest — returns undefined so the caller OMITS the
   key entirely (never null, never "", never the user-source digest, never
   a fabricated fence). */
export function fenceFor(instanceView) {
  if (!instanceView || instanceView.kind !== "instance") return undefined;
  const fence = instanceView.templateDigest;
  return typeof fence === "string" && fence.length > 0 ? fence : undefined;
}

/* A graph_status read. A null/absent status is the daemon honestly saying
   there is NO active pinned workflow for the session — kind "none", never
   an invented graph. An active graph types phase/current_node/ready_nodes/
   attempt and carries nodes/blocked_reason/pending menus/run_set OPAQUE —
   we do not fabricate structure the projection did not publish. */
export function graphStatusView(status) {
  if (status == null) return { kind: "none" };
  return {
    kind: "active",
    graphId: String(status?.graph_id ?? ""),
    template: String(status?.template ?? ""),
    digest: textOrNull(status?.digest),
    templateVersion: finiteOrNull(status?.template_version),
    startNode: textOrNull(status?.start_node),
    phase: String(status?.phase ?? ""),
    currentNode: textOrNull(status?.current_node),
    readyNodes: Array.isArray(status?.ready_nodes)
      ? status.ready_nodes.map((node) => String(node))
      : [],
    attempt: finiteOrNull(status?.attempt),
    nodes: status?.nodes ?? null,
    blockedReason: status?.blocked_reason ?? null,
    pendingMenu: status?.pending_menu ?? null,
    pendingMenus: Array.isArray(status?.pending_menus) ? status.pending_menus : [],
    runSet: status?.run_set ?? null,
  };
}

function errorRecord(error) {
  if (error && typeof error === "object") return error;
  if (typeof error === "string") {
    try {
      const parsed = JSON.parse(error);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* Not JSON — fall through to text extraction. */
    }
  }
  return null;
}

function extractField(message, key) {
  const match = message.match(new RegExp(`${key}[^\\w]+([\\w:.=/+-]+)`));
  return match ? match[1] : null;
}

/* Decode a revision_conflict error into expected vs current. Returns null
   for anything that is not a revision conflict. The decoded view exists to
   PROMPT A RE-READ of the instance — there is deliberately no field here a
   caller could use to auto-resubmit with the current digest behind the
   user's selection; missing values stay null, never fabricated.

   The shipped command's error is WorkflowCommandError
   { code, message, retryable, data }, and the conflict coordinates live
   UNDER `data`:
   { code: "revision_conflict", data: { kind: "workflow_revision_conflict",
     expected_digest, current_digest, current_revision } }.
   Reading them at the error's TOP level would decode every real conflict
   to null — `data` is the one body we extract from; the message-regex path
   below is a last-resort fallback for a bare String error only. */
export function revisionConflictView(error) {
  const message = String(error?.message ?? error ?? "");
  const record = errorRecord(error);
  const data = record?.data && typeof record.data === "object" ? record.data : null;
  const dataSaysConflict = data?.kind === "workflow_revision_conflict";
  const codeSaysConflict = record?.code === "revision_conflict";
  if (!dataSaysConflict && !codeSaysConflict && !/revision_conflict/i.test(message)) {
    return null;
  }
  /* The coordinates come from `data` — never the error's top level. */
  const body = data;
  /* An unextractable revision stays null — Number(null) is 0, and a
     fabricated revision 0 would be a fact nobody published. */
  const extractedRevision = extractField(message, "current_revision");
  return {
    kind: "revision_conflict",
    expectedDigest: textOrNull(body?.expected_digest) ?? extractField(message, "expected_digest"),
    currentDigest: textOrNull(body?.current_digest) ?? extractField(message, "current_digest"),
    currentRevision: finiteOrNull(body?.current_revision)
      ?? (extractedRevision == null ? null : finiteOrNull(Number(extractedRevision))),
    raw: error ?? null,
  };
}

/* A loom_register_workflow SUCCESS receipt: { id, rev, digest, updated }. */
export function workflowRegistrationReceiptView(receipt) {
  return {
    id: String(receipt?.id ?? ""),
    rev: finiteOrNull(receipt?.rev),
    digest: String(receipt?.digest ?? ""),
    updated: receipt?.updated === true,
  };
}

/* A loom_register_workflow REJECTION carries the compile error list. The
   list is surfaced VERBATIM: an array on the error record is returned
   item-for-item; when no structured list is found the raw message itself
   is the list — the failure is never swallowed into an empty list or a
   pretended success. */
export function compileErrorListView(error) {
  const record = errorRecord(error);
  for (const key of ["compile_errors", "errors"]) {
    const list = record?.[key];
    if (Array.isArray(list) && list.length > 0) {
      return list.map((item) => (typeof item === "string" ? item : JSON.stringify(item)));
    }
  }
  const message = String(error?.message ?? error ?? "");
  return message ? [message] : ["Workflow registration failed."];
}

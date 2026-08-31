/* Loom agent-type view model: pure, side-effect-free transforms between the
   daemon's wire shapes and what the UI renders. House law: a plausible local
   computation must not stand in for a fact an authority already publishes,
   and absence must never be fabricated into a value. Concretely —
   cli_present is a TRI-state (a missing key means "not probed", never
   "missing"), unknown install states survive verbatim, retry is offered only
   for `failed`, and an absent bound agent_type is null, never a default. */

export const LOOM_KNOWN_INSTALL_STATES = Object.freeze([
  "queued",
  "installing",
  "verifying",
  "succeeded",
  "failed",
]);

const KNOWN_INSTALL_STATE_SET = new Set(LOOM_KNOWN_INSTALL_STATES);

function textOrEmpty(value) {
  return typeof value === "string" ? value : "";
}

function stringList(value) {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

/* Comma-separated editor input -> string array (empty entries dropped). */
export function splitCommaList(text) {
  return String(text ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/* Normalize one registry record. clis/apis/skills/scripts may be omitted on
   the wire when empty — default to []; color/glyph default to "". */
export function agentTypeView(record) {
  return {
    id: String(record?.id ?? ""),
    name: String(record?.name ?? ""),
    job: textOrEmpty(record?.job),
    inType: textOrEmpty(record?.in_type),
    outType: textOrEmpty(record?.out_type),
    clis: stringList(record?.clis),
    apis: stringList(record?.apis),
    skills: stringList(record?.skills),
    scripts: stringList(record?.scripts),
    color: textOrEmpty(record?.color),
    glyph: textOrEmpty(record?.glyph),
    rev: finiteOrNull(record?.rev),
  };
}

function textOrNull(value) {
  return typeof value === "string" ? value : null;
}

function owns(record, key) {
  return Boolean(record && Object.prototype.hasOwnProperty.call(record, key));
}

/* Wave 3 registry rows add CAS/archive facts to the shipped agent-type
   projection without changing agentTypeView's established shape. Revision
   and digest are copied from the list row exactly; neither is derived from
   the record body. `archived` is true only when the list explicitly says so
   (or the row came from the list's explicit archived collection). */
export function registryEntryView(record, kind = "agent_type", archived = undefined) {
  const registryKind = typeof kind === "string" ? kind : "";
  const base = registryKind === "agent_type"
    ? agentTypeView(record)
    : {
      id: String(record?.id ?? ""),
      name: textOrEmpty(record?.name),
      rev: owns(record, "rev") ? record.rev : null,
      raw: record ?? null,
    };
  const publishedArchived = archived === true
    || record?.archived === true
    || record?.is_archived === true
    || record?.archived_at != null
    || record?.archived_at_ms != null;
  return {
    ...base,
    registryKind,
    /* CAS revisions are opaque fence values here, not presentation numbers. */
    rev: owns(record, "rev") ? record.rev : base.rev,
    digest: textOrNull(record?.digest),
    archived: publishedArchived,
    raw: record ?? null,
  };
}

function listRows(result, key, nestedKey = key) {
  if (Array.isArray(result?.[key])) return result[key];
  if (Array.isArray(result?.archived?.[nestedKey])) return result.archived[nestedKey];
  return [];
}

/* A default loom.list read establishes only the ACTIVE registry. Archived is
   deliberately `null` until include_archived was explicitly requested; []
   after a default read must never be presented as proof that no archived
   records exist. The SDK has shipped both separate archived collections and
   archive-tagged rows during development, so this view accepts either while
   preserving the same honesty boundary. */
export function registryListView(result, { includeArchived = false } = {}) {
  const baselineRows = Array.isArray(result?.entries)
    ? result.entries.map((row) => (
      row?.entry && typeof row.entry === "object"
        ? {
          ...(row?.record && typeof row.record === "object" ? row.record : {}),
          ...row.entry,
        }
        : row
    ))
    : [];
  const agentRows = [
    ...(Array.isArray(result?.agent_types) ? result.agent_types : []),
    ...baselineRows.filter((row) => row?.kind === "agent_type"),
  ];
  const workflowRows = [
    ...(Array.isArray(result?.workflows) ? result.workflows : []),
    ...baselineRows.filter((row) => row?.kind === "workflow"),
  ];
  const explicitArchivedAgents = listRows(result, "archived_agent_types", "agent_types");
  const explicitArchivedWorkflows = listRows(result, "archived_workflows", "workflows");
  const archivedRows = Array.isArray(result?.archived_entries) ? result.archived_entries : [];

  const activeAgentTypes = agentRows
    .filter((row) => !registryEntryView(row, "agent_type").archived)
    .map((row) => registryEntryView(row, "agent_type", false));
  const activeWorkflows = workflowRows
    .filter((row) => !registryEntryView(row, "workflow").archived)
    .map((row) => registryEntryView(row, "workflow", false));

  let archivedEntries = null;
  if (includeArchived) {
    const taggedAgents = agentRows
      .filter((row) => registryEntryView(row, "agent_type").archived);
    const taggedWorkflows = workflowRows
      .filter((row) => registryEntryView(row, "workflow").archived);
    archivedEntries = [
      ...explicitArchivedAgents.map((row) => registryEntryView(row, "agent_type", true)),
      ...explicitArchivedWorkflows.map((row) => registryEntryView(row, "workflow", true)),
      ...archivedRows.map((row) => registryEntryView(row, row?.kind, true)),
      ...taggedAgents.map((row) => registryEntryView(row, "agent_type", true)),
      ...taggedWorkflows.map((row) => registryEntryView(row, "workflow", true)),
    ];
  }

  return {
    activeAgentTypes,
    activeWorkflows,
    archivedEntries,
    archivedIncluded: includeArchived === true,
    cliPresentPublished: owns(result, "cli_present"),
    cliPresent: result?.cli_present && typeof result.cli_present === "object"
      ? result.cli_present
      : {},
  };
}

/* THE tri-state pin. cli_present is `{ program: bool }` where a MISSING key
   is a third state — the daemon never probed that program. Only an explicit
   `true` is "present" and only an explicit `false` is "missing"; anything
   else (absent key, absent map, non-boolean value) is honestly "unprobed",
   never coerced into a probe result the daemon did not publish. */
export function cliPresence(cliPresent, program) {
  if (!cliPresent || typeof cliPresent !== "object" || Array.isArray(cliPresent)) {
    return "unprobed";
  }
  if (!Object.prototype.hasOwnProperty.call(cliPresent, program)) return "unprobed";
  const probed = cliPresent[program];
  if (probed === true) return "present";
  if (probed === false) return "missing";
  return "unprobed";
}

export function cliPresenceLabel(presence) {
  if (presence === "present") return "present";
  if (presence === "missing") return "missing";
  return "not probed";
}

/* Install state as the daemon said it. An unrecognized string is kind
   "unknown" with the raw daemon string preserved verbatim as the label —
   never coerced onto a known state, never dropped. */
export function installStateView(state) {
  const raw = typeof state === "string" ? state : String(state ?? "");
  if (KNOWN_INSTALL_STATE_SET.has(raw)) {
    return { kind: raw, label: raw, raw };
  }
  return { kind: "unknown", label: raw, raw };
}

/* One install job for display. Retry is offered ONLY for a job the daemon
   reported as `failed` — an unknown state is not retryable (we cannot claim
   a state we do not recognize is safe to requeue). Absent progress numbers
   stay null; they are never fabricated into zeros. */
export function installJobView(job) {
  const state = installStateView(job?.state);
  const progress = job?.progress && typeof job.progress === "object" ? job.progress : {};
  return {
    jobId: String(job?.job_id ?? ""),
    agentTypeId: String(job?.agent_type_id ?? ""),
    state,
    completed: finiteOrNull(progress.completed),
    total: finiteOrNull(progress.total),
    currentCli: progress.current_cli == null ? null : String(progress.current_cli),
    error: job?.error == null ? null : String(job.error),
    retryable: state.kind === "failed",
  };
}

export function installItemView(item) {
  return {
    jobId: String(item?.job_id ?? ""),
    ordinal: finiteOrNull(item?.ordinal),
    program: String(item?.required_cli?.program ?? ""),
    state: installStateView(item?.state),
    error: item?.error == null ? null : String(item.error),
  };
}

/* Registration receipt. `install_job_id` is OPTIONAL on the wire: when the
   daemon omits it there is no install job to poll — installJobId is null and
   must never be synthesized from id/rev/digest. */
export function registrationReceiptView(receipt) {
  return {
    id: String(receipt?.id ?? ""),
    rev: finiteOrNull(receipt?.rev),
    digest: String(receipt?.digest ?? ""),
    updated: receipt?.updated === true,
    installJobId: receipt?.install_job_id ?? null,
  };
}

/* Persona binding receipt. Selecting an agent type binds a PERSONA to the
   session — it does not install, prove PATH presence, grant execution, or
   scope CLIs. An absent `agent_type` means no persona is bound: null, never
   a fabricated default. */
export function personaBindingView(receipt) {
  return {
    sessionId: String(receipt?.session_id ?? ""),
    agentTypeId: receipt?.agent_type ?? null,
    selectedSeq: finiteOrNull(receipt?.selected_seq),
    workerGeneration: finiteOrNull(receipt?.worker_generation),
  };
}

/* Persona selection state for the header control. An UNSEEN receipt (no
   session_select_agent_type receipt observed for this session — binding is
   undefined) is UNKNOWN: we may not claim "No persona" for a binding we
   never read. Only a SEEN receipt may claim "none" (agent_type absent) or
   "bound" (agent_type present). Unknown and none are DISTINCT states. */
export function personaSelectionView(binding) {
  if (binding == null) return { kind: "unknown", agentTypeId: null };
  return binding.agentTypeId == null
    ? { kind: "none", agentTypeId: null }
    : { kind: "bound", agentTypeId: binding.agentTypeId };
}

function rejectionReason(rejection) {
  const reason = rejection?.reason;
  return typeof reason === "string" ? reason : null;
}

/* Retry outcome: requeued carries the fresh job; rejected carries the
   daemon's rejection verbatim; anything else is an unknown future status
   preserved raw for display — never crashed on, never coerced. */
export function retryOutcomeView(outcome) {
  if (outcome?.status === "requeued") {
    return { status: "requeued", job: installJobView(outcome.job) };
  }
  if (outcome?.status === "rejected") {
    return {
      status: "rejected",
      reason: rejectionReason(outcome.rejection),
      rejection: outcome.rejection ?? null,
    };
  }
  return { status: "unknown", raw: outcome ?? null };
}

/* Watch outcome: same preservation discipline as retry. `nextCursor` is the
   only polling authority — it advances the caller's after_cursor. */
export function watchOutcomeView(outcome) {
  if (outcome?.status === "watching") {
    return {
      status: "watching",
      requestedAfterCursor: finiteOrNull(outcome.requested_after_cursor),
      replayThroughCursor: finiteOrNull(outcome.replay_through_cursor),
      nextCursor: finiteOrNull(outcome.next_cursor),
      events: Array.isArray(outcome.events)
        ? outcome.events.map((event) => ({
          cursor: finiteOrNull(event?.cursor),
          job: installJobView(event?.job),
        }))
        : [],
    };
  }
  if (outcome?.status === "rejected") {
    return {
      status: "rejected",
      reason: rejectionReason(outcome.rejection),
      rejection: outcome.rejection ?? null,
    };
  }
  return { status: "unknown", raw: outcome ?? null };
}

/* ---------- Wave 3 authoring + live-registry projections ---------- */

export const LOOM_CURSOR_BASELINE = "0";
const DECIMAL_CURSOR = /^\d+$/;

/* Registry watch positions are opaque u64 decimal STRINGS. A number is
   rejected even when it happens to be safe: accepting it would make the
   boundary lossy for larger cursors and invite numeric round-trips. */
export function loomCursorOrNull(value) {
  return typeof value === "string" && DECIMAL_CURSOR.test(value) ? value : null;
}

export function loomCursorAdvances(current, candidate) {
  const next = loomCursorOrNull(candidate);
  if (next == null) return false;
  const held = loomCursorOrNull(current);
  return held == null || BigInt(next) > BigInt(held);
}

/* loom.validate is non-mutating. Coordinates are copied VERBATIM: the
   daemon already publishes one-based line and column values, so the view
   neither subtracts one nor rounds a location down to its line. The digest
   property is named `canonicalDigestPreview` to prevent callers from
   presenting it as a digest already stored on a registry entry. */
export function validationView(receipt) {
  return {
    errors: Array.isArray(receipt?.errors)
      ? receipt.errors.map((error) => ({
        line: error?.location?.line ?? error?.line,
        column: error?.location?.column ?? error?.column,
        field: owns(error?.location, "field")
          ? error.location.field
          : owns(error, "field") ? error.field : null,
        message: owns(error, "message") ? error.message : null,
      }))
      : [],
    canonicalDigestPreview: textOrNull(receipt?.canonical_digest),
  };
}

/* A returned authoring draft is authority for its authoring CAS fence.
   Registry CAS coordinates may also be published on the draft (for a
   revision of an existing entry); when absent the UI may use a separately
   listed entry. Every value is retained exactly as read. */
export function draftView(draft) {
  if (draft == null || typeof draft !== "object") return null;
  return {
    authoringId: owns(draft, "authoring_id") ? draft.authoring_id : null,
    expectedRevision: owns(draft, "expected_revision")
      ? draft.expected_revision
      : owns(draft, "revision") ? draft.revision : null,
    registryKind: textOrNull(draft.kind),
    registryId: textOrNull(draft.id) ?? textOrNull(draft.registry_id),
    text: owns(draft, "text") ? draft.text : null,
    expectedRev: owns(draft, "expected_rev") ? draft.expected_rev : null,
    expectedDigest: owns(draft, "expected_digest") ? draft.expected_digest : null,
    raw: draft,
  };
}

/* Fence helpers ECHO values the client actually read. They do not increment,
   default, hash, parse, or otherwise manufacture a CAS coordinate. */
export function draftFenceFor(draft) {
  if (!draft || draft.authoringId == null || draft.expectedRevision == null) return null;
  return {
    authoring_id: draft.authoringId,
    expected_revision: draft.expectedRevision,
  };
}

export function registryFenceFor(entryOrDraft) {
  if (!entryOrDraft || typeof entryOrDraft !== "object") return null;
  const expectedRev = owns(entryOrDraft, "expectedRev")
    ? entryOrDraft.expectedRev
    : entryOrDraft.rev;
  const expectedDigest = owns(entryOrDraft, "expectedDigest")
    ? entryOrDraft.expectedDigest
    : entryOrDraft.digest;
  const fence = {};
  if (expectedRev != null) fence.expected_rev = expectedRev;
  if (expectedDigest != null) fence.expected_digest = expectedDigest;
  return Object.keys(fence).length > 0 ? fence : null;
}

function publishedReason(value) {
  if (typeof value?.reason === "string") return value.reason;
  if (typeof value?.outcome?.reason === "string") return value.outcome.reason;
  return null;
}

/* `confirmed: null` is a first-class daemon outcome, not an exceptional
   absence and emphatically not success. No registry entry is ever created
   from the submitted draft. */
export function confirmOutcomeView(receipt) {
  if (owns(receipt, "confirmed") && receipt.confirmed === null) {
    return {
      kind: "not_confirmed",
      confirmed: null,
      reason: publishedReason(receipt),
      errors: validationView(receipt).errors,
      raw: receipt,
    };
  }
  if (owns(receipt, "confirmed") && receipt.confirmed != null) {
    return {
      kind: "confirmed",
      confirmed: receipt.confirmed,
      reason: publishedReason(receipt),
      raw: receipt,
    };
  }
  /* The Rust SDK omits an Option::None field during serialization while
     retaining the daemon's validation errors. That omission is the same
     not-confirmed outcome, never permission to fabricate success. */
  if (!owns(receipt, "confirmed") && Array.isArray(receipt?.errors)) {
    return {
      kind: "not_confirmed",
      confirmed: null,
      reason: publishedReason(receipt),
      errors: validationView(receipt).errors,
      raw: receipt,
    };
  }
  return { kind: "unknown", raw: receipt ?? null };
}

function outcomeBody(receipt) {
  return receipt?.outcome && typeof receipt.outcome === "object"
    ? receipt.outcome
    : receipt;
}

/* Archive/unarchive receipts have three known result families. The daemon's
   more specific already-state and not-found body are kept raw; a future
   outcome remains unknown rather than being called success. */
export function archiveOutcomeView(receipt) {
  const body = outcomeBody(receipt);
  const status = typeof body === "string"
    ? body
    : String(body?.status ?? body?.kind ?? "");
  if (status === "changed") {
    return { kind: "changed", entry: body?.entry ?? body?.record ?? null, raw: receipt ?? null };
  }
  if (status === "already" || status.startsWith("already_")) {
    return {
      kind: "already",
      state: status,
      entry: body?.entry ?? null,
      raw: receipt ?? null,
    };
  }
  if (status === "not_found" || status === "not-found") {
    return { kind: "not_found", raw: receipt ?? null };
  }
  return { kind: "unknown", raw: receipt ?? null };
}

/* Install cancellation is receipt-first. `already_terminal.state` remains
   the daemon's value verbatim, including future state names. Unknown output
   stays raw and is never coerced to cancelled/failed. */
export function cancelOutcomeView(receipt) {
  const outcome = receipt?.outcome && typeof receipt.outcome === "object"
    ? receipt.outcome
    : receipt;
  if (outcome === "cancelled" || outcome?.status === "cancelled" || outcome?.kind === "cancelled") {
    return { kind: "cancelled", raw: receipt };
  }
  const terminal = outcome?.status === "already_terminal"
    || outcome?.kind === "already_terminal"
    || owns(outcome, "already_terminal");
  if (terminal) {
    const body = outcome?.already_terminal && typeof outcome.already_terminal === "object"
      ? outcome.already_terminal
      : outcome;
    return {
      kind: "already_terminal",
      state: owns(body, "state") ? body.state : null,
      raw: receipt,
    };
  }
  return { kind: "unknown", raw: outcome ?? null };
}

function deltaAction(delta) {
  const raw = delta?.action ?? delta?.op ?? delta?.change ?? delta?.status ?? delta?.type;
  return typeof raw === "string" ? raw : null;
}

/* Pushed registry deltas are scoped by watch_id and carry decimal-string
   cursors. Known actions expose only their published entry/id; unknown
   actions remain raw so the hook can re-baseline instead of guessing how to
   edit its list. Gap/reconnect signals are likewise explicit re-baseline
   requests, never locally repaired sequences. */
export function registryDeltaView(payload) {
  const delta = payload?.delta && typeof payload.delta === "object" ? payload.delta : payload;
  const rawAction = deltaAction(delta);
  const normalizedRaw = rawAction?.replaceAll("-", "_") ?? null;
  const aliases = {
    revision_added: "updated",
    entry_added: "registered",
    entry_archived: "archived",
    entry_unarchived: "unarchived",
    entry_removed: "removed",
  };
  const normalized = aliases[normalizedRaw] ?? normalizedRaw;
  const known = new Set(["upserted", "registered", "updated", "archived", "unarchived", "removed"]);
  const gap = normalized === "gap" || normalized === "reconnect" || delta?.gap === true;
  return {
    kind: gap ? "rebaseline" : known.has(normalized) ? normalized : "unknown",
    watchId: textOrNull(payload?.watch_id) ?? textOrNull(delta?.watch_id),
    cursor: loomCursorOrNull(delta?.cursor ?? payload?.cursor),
    afterCursor: loomCursorOrNull(delta?.after_cursor ?? payload?.after_cursor),
    registryKind: textOrNull(delta?.registry_kind) ?? textOrNull(delta?.kind_name)
      ?? textOrNull(delta?.entry_kind),
    id: textOrNull(delta?.id) ?? textOrNull(delta?.entry?.id),
    entry: delta?.entry && typeof delta.entry === "object"
      ? {
        ...(delta?.record && typeof delta.record === "object" ? delta.record : {}),
        ...delta.entry,
      }
      : delta?.record ?? null,
    raw: payload ?? null,
  };
}

/* loom.watch returns a watch id plus an authoritative list baseline. The
   baseline cursor is held only if it is a valid decimal string. */
export function registryWatchView(receipt) {
  const baseline = receipt?.baseline && typeof receipt.baseline === "object"
    ? receipt.baseline
    : {};
  const includeArchived = baseline?.include_archived === true
    || Array.isArray(baseline?.entries)
    || Array.isArray(baseline?.archived_agent_types)
    || Array.isArray(baseline?.archived_workflows)
    || Array.isArray(baseline?.archived_entries)
    || baseline?.archived != null;
  return {
    watchId: textOrNull(receipt?.watch_id),
    cursor: loomCursorOrNull(
      baseline?.through_cursor ?? baseline?.cursor ?? receipt?.through_cursor,
    ),
    baseline: registryListView(baseline, { includeArchived }),
    raw: receipt ?? null,
  };
}

/* Typed CAS conflicts are display-only. Current values are deliberately not
   exposed as retry payloads: the caller must explicitly re-read the draft or
   registry entry before another mutation. */
export function loomConflictView(error) {
  const candidates = [error?.data, error?.conflict, error?.outcome, error]
    .filter((value) => value && typeof value === "object");
  const source = candidates.find((value) => (
    value.code === "revision_conflict"
      || value.kind === "revision_conflict"
      || value.status === "revision_conflict"
      || owns(value, "current_revision")
      || owns(value, "current_rev")
      || owns(value, "current_digest")
  ));
  const message = String(error?.message ?? error ?? "");
  if (!source && !/revision[_ -]conflict/i.test(message)) return null;
  const body = source ?? {};
  return {
    kind: "revision_conflict",
    expectedRevision: owns(body, "expected_revision") ? body.expected_revision : null,
    currentRevision: owns(body, "current_revision") ? body.current_revision : null,
    expectedRev: owns(body, "expected_rev")
      ? body.expected_rev
      : owns(body?.expected, "rev") ? body.expected.rev : null,
    currentRev: owns(body, "current_rev") ? body.current_rev : null,
    expectedDigest: textOrNull(body.expected_digest) ?? textOrNull(body?.expected?.digest),
    currentDigest: textOrNull(body.current_digest),
    raw: error ?? null,
  };
}

/* A daemon that lacks the Loom feature throws a String error. Detect the
   common "this method does not exist / is not supported" phrasings so the
   hook can settle into an honest "unavailable" state instead of spamming
   retries. Anything else stays an ordinary error. */
const LOOM_UNAVAILABLE_PATTERNS = [
  /* The daemon's actual feature gate: "missing_feature: daemon does not
     advertise <feature>" (haider_rpc_ade). */
  /missing_feature/i,
  /does not advertise/i,
  /unavailable/i,
  /unsupported/i,
  /not supported/i,
  /unknown (?:command|method|request|cmd)/i,
  /no such (?:command|method)/i,
  /not implemented/i,
  /feature[^.]*disabled/i,
];

export function loomUnavailableFromError(error) {
  const message = String(error?.message ?? error ?? "");
  return LOOM_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(message));
}

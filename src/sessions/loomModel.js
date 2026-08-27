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

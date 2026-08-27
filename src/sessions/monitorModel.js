/* Monitor manager view model (P4): pure, side-effect-free transforms
   between the monitor_control_v1 / monitor_delivery_v1 wire shapes and what
   the UI renders. House law:
   - per-source availability is a TRI-state: only an explicit "available"
     from the daemon renders as available; "unavailable" keeps its typed
     reason verbatim; anything else — an absent state, an unrecognized
     string, a missing row — is honestly "unknown", NEVER shown available;
   - the `monitors` array is authoritative ONLY under the `listed` outcome:
     a rejected/unknown list outcome carries NO monitors view at all — the
     UI shows the honest outcome, never "0 monitors" for a list the daemon
     refused to produce;
   - a register/remove/watch rejection is a STRUCTURED typed reason object,
     carried with its discriminant and fields verbatim — never flattened to
     a bare string, never dressed up as a success;
   - monitor.watch cursors are u64-scale DECIMAL STRINGS across the Tauri
     boundary: "0" is the real baseline, comparisons are BigInt over the
     strings, and the position advances VERBATIM to a published cursor.
     Nothing here numeric-parses a cursor — 9007199254740993 must never
     silently become 9007199254740992. */

export { loomUnavailableFromError as monitorUnavailableFromError } from "./loomModel.js";

/* The documented source families (MonitorSourceKindWire). "advanced" is a
   FORM mode, not a wire kind — it submits a validated structured object. */
export const MONITOR_SOURCE_KINDS = Object.freeze([
  "sms",
  "process",
  "file",
  "poll",
  "timer",
]);

export const MONITOR_FILTER_FIELDS = Object.freeze([
  "address",
  "body",
  "payload",
]);

export const MONITOR_FILTER_OPERATORS = Object.freeze([
  "equals",
  "contains",
  "starts_with",
  "ends_with",
]);

export const MONITOR_OCCURRENCES = Object.freeze(["once", "every"]);

export const MONITOR_LIFETIME_KINDS = Object.freeze(["session", "timeout"]);

/* The typed rejection discriminants (MonitorControlRejectionWire). An
   unrecognized reason is preserved verbatim as kind "unknown". */
export const MONITOR_REJECTION_REASONS = Object.freeze([
  "capability_denied",
  "control_attachment_required",
  "source_unavailable",
  "limit_reached",
  "not_found",
  "session_not_found",
  "stale_generation",
  "cursor_ahead",
  "invalid_request",
  "command_conflict",
  "service_stopped",
  "store_unavailable",
]);

const KNOWN_REJECTION_SET = new Set(MONITOR_REJECTION_REASONS);
const KNOWN_SOURCE_KIND_SET = new Set(MONITOR_SOURCE_KINDS);

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function textOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/* ---------------------------------------------------------------- cursors */

/* HOUSE LAW 4. Cursors are u64-scale DECIMAL STRINGS across the Tauri
   boundary and ride VERBATIM: a string of decimal digits is the published
   position ("0" included); anything else — absence, a non-decimal string,
   or a NUMBER (which may already have lost precision crossing the
   boundary) — is null. */
const DECIMAL_CURSOR = /^\d+$/;

export const MONITOR_CURSOR_BASELINE = "0";

export function monitorCursorOrNull(value) {
  return typeof value === "string" && DECIMAL_CURSOR.test(value) ? value : null;
}

/* BigInt order over the decimal strings — never JS number math, which
   would silently collapse 9007199254740993 to 9007199254740992 and replay
   the wrong span. A candidate advances only when it is a real decimal
   cursor strictly beyond the current position (or the position is null). */
export function cursorAdvances(current, candidate) {
  const next = monitorCursorOrNull(candidate);
  if (next == null) return false;
  const held = monitorCursorOrNull(current);
  if (held == null) return true;
  return BigInt(next) > BigInt(held);
}

/* The watch position after one receipt: the LARGEST published candidate
   cursor (BigInt-compared), adopted VERBATIM as its decimal string. With
   no candidate beyond the current position the position is unchanged —
   never guessed, never re-serialized. */
export function advanceWatchCursor(current, candidates) {
  let position = monitorCursorOrNull(current);
  const list = Array.isArray(candidates) ? candidates : [candidates];
  for (const candidate of list) {
    if (cursorAdvances(position, candidate)) {
      position = monitorCursorOrNull(candidate);
    }
  }
  return position;
}

/* ---------------------------------------------- per-source availability */

/* HOUSE LAW 1 — the availability TRI-state. Accepts both the flat receipt
   row ({ kind|source, state, reason? }) and the nested wire row
   ({ source, availability: { state, reason } }). Only an explicit
   "available" is available; "unavailable" keeps its typed reason verbatim
   (string or { reason } object); EVERYTHING else — absent state, an
   unrecognized string, a malformed row — is "unknown", with the daemon's
   raw state string preserved. An absent state is NEVER shown available. */
export function sourceAvailabilityView(row) {
  const source = String(row?.source ?? row?.kind ?? "");
  const nested = row?.availability && typeof row.availability === "object"
    ? row.availability
    : null;
  const stateRaw = typeof row?.state === "string"
    ? row.state
    : typeof nested?.state === "string" ? nested.state : null;
  if (stateRaw === "available") {
    return { source, state: "available", reason: null, stateRaw };
  }
  if (stateRaw === "unavailable") {
    const reasonRaw = row?.reason ?? nested?.reason ?? null;
    const reason = typeof reasonRaw === "string"
      ? textOrNull(reasonRaw)
      : textOrNull(reasonRaw?.reason);
    return { source, state: "unavailable", reason, stateRaw };
  }
  return { source, state: "unknown", reason: null, stateRaw };
}

export function sourceAvailabilityViews(rows) {
  return Array.isArray(rows) ? rows.map(sourceAvailabilityView) : [];
}

/* ------------------------------------------------------------- policy */

/* Capability policy verbatim ("view" / "control" / an unknown future
   string carried as-is). An absent capability is null — "not published",
   never a granted default. */
export function policyView(policy) {
  if (!policy || typeof policy !== "object") return null;
  return {
    list: textOrNull(policy.list),
    register: textOrNull(policy.register),
    registerRequiresControlAttachment:
      policy.register_requires_control_attachment === true,
    remove: textOrNull(policy.remove),
    removeRequiresControlAttachment:
      policy.remove_requires_control_attachment === true,
    watch: textOrNull(policy.watch),
  };
}

/* ---------------------------------------------------------- rejections */

/* HOUSE LAW 3 — a rejection is DATA. The typed reason discriminant rides
   verbatim (`reason`), its sibling fields are summarized into `detail`,
   and the whole daemon object is preserved in `raw`. An unrecognized
   reason keeps its raw spelling under kind "unknown" — never coerced,
   never flattened to a bare message string. */
export function rejectionView(rejection) {
  const reason = typeof rejection?.reason === "string" ? rejection.reason : null;
  const parts = [];
  if (rejection && typeof rejection === "object") {
    for (const [key, value] of Object.entries(rejection)) {
      if (key === "reason") continue;
      let text;
      try {
        text = typeof value === "string" ? value : JSON.stringify(value);
      } catch {
        text = String(value);
      }
      parts.push(`${key}: ${text}`);
    }
  }
  return {
    kind: reason != null && KNOWN_REJECTION_SET.has(reason) ? reason : "unknown",
    reason,
    detail: parts.length > 0 ? parts.join(", ") : null,
    raw: rejection ?? null,
  };
}

/* --------------------------------------------------------- registry rows */

/* Compact display text for one typed source declaration — the declaration
   itself stays verbatim in the row view. An untyped source admits it. */
export function sourceSummary(source) {
  if (typeof source === "string") return source;
  const kind = textOrNull(source?.kind);
  if (kind == null) return "(untyped source)";
  const details = [];
  if (typeof source.command === "string" && source.command.length > 0) {
    details.push(source.command);
  }
  if (typeof source.path === "string" && source.path.length > 0) {
    details.push(source.path);
  }
  if (Number.isFinite(source.interval_ms)) {
    details.push(`every ${source.interval_ms}ms`);
  }
  return details.length > 0 ? `${kind} · ${details.join(" · ")}` : kind;
}

/* Compact display text for one filter. null = the registration carries no
   filter — a distinct, honest fact, not an empty predicate. */
export function filterSummary(filter) {
  if (!filter || typeof filter !== "object") return null;
  const field = String(filter.field ?? "?");
  const operator = String(filter.operator ?? "?");
  const value = String(filter.value ?? "");
  const caseMark = filter.case_sensitive === true ? " (case-sensitive)" : "";
  return `${field} ${operator} "${value}"${caseMark}`;
}

/* One durable registry row (MonitorRegistrationWire). The source/filter/
   action declarations ride VERBATIM; expires_at_ms absent means a
   session-lifetime registration (null, never a fabricated deadline). */
export function monitorRegistrationView(row) {
  return {
    monitorId: String(row?.monitor_id ?? ""),
    sessionId: String(row?.session_id ?? ""),
    branchId: row?.branch_id ?? null,
    agentId: row?.agent_id ?? null,
    source: row?.source ?? null,
    sourceKind: textOrNull(row?.source?.kind),
    sourceKindKnown: KNOWN_SOURCE_KIND_SET.has(row?.source?.kind),
    filter: row?.filter ?? null,
    action: row?.action ?? null,
    /* report defaults TRUE on the wire (monitor_default_report) — carrying
       that documented default is the contract, not a fabrication. */
    report: row?.action?.report === false ? false : true,
    followUp: textOrNull(row?.action?.follow_up),
    occurrence: textOrNull(row?.occurrence),
    createdAtMs: finiteOrNull(row?.created_at_ms),
    expiresAtMs: finiteOrNull(row?.expires_at_ms),
  };
}

/* ------------------------------------------------------------ outcomes */

/* HOUSE LAW 2 — the list outcome. `monitors` exists ONLY on the `listed`
   view (an empty array there is genuine emptiness — the daemon listed and
   found none). A rejected/unknown outcome carries NO monitors property:
   the UI can only render the honest outcome, never "0 monitors". */
export function listOutcomeView(outcome) {
  if (outcome?.status === "listed") {
    return {
      status: "listed",
      monitors: Array.isArray(outcome.monitors)
        ? outcome.monitors.map(monitorRegistrationView)
        : [],
    };
  }
  if (outcome?.status === "rejected") {
    return { status: "rejected", rejection: rejectionView(outcome.rejection) };
  }
  return { status: "unknown", raw: outcome ?? null };
}

/* HOUSE LAW 3 — the register outcome. `registered` carries the daemon's
   registration row (and its monitor_id); `rejected` carries the STRUCTURED
   typed reason; an unknown future status is preserved raw — never coerced
   into a success, never flattened to a string. */
export function registerOutcomeView(outcome) {
  if (outcome?.status === "registered") {
    const record = outcome.monitor ?? outcome.registration ?? null;
    const monitor = record != null ? monitorRegistrationView(record) : null;
    const monitorId = monitor?.monitorId || String(outcome.monitor_id ?? "");
    return { status: "registered", monitorId, monitor };
  }
  if (outcome?.status === "rejected") {
    return { status: "rejected", rejection: rejectionView(outcome.rejection) };
  }
  return { status: "unknown", raw: outcome ?? null };
}

/* The remove outcome, same preservation discipline. */
export function removeOutcomeView(outcome) {
  if (outcome?.status === "removed") {
    return { status: "removed", monitorId: String(outcome.monitor_id ?? "") };
  }
  if (outcome?.status === "rejected") {
    return { status: "rejected", rejection: rejectionView(outcome.rejection) };
  }
  return { status: "unknown", raw: outcome ?? null };
}

/* The watch outcome. Its cursors are DECIMAL STRINGS, verbatim-or-null —
   a numeric cursor is treated as unpublished rather than round-tripped. */
export function watchOutcomeView(outcome) {
  if (outcome?.status === "watching") {
    return {
      status: "watching",
      watchId: String(outcome.watch_id ?? ""),
      requestedAfterCursor: monitorCursorOrNull(outcome.requested_after_cursor),
      replayThroughCursor: monitorCursorOrNull(outcome.replay_through_cursor),
    };
  }
  if (outcome?.status === "rejected") {
    return { status: "rejected", rejection: rejectionView(outcome.rejection) };
  }
  return { status: "unknown", raw: outcome ?? null };
}

/* The full monitor.list receipt: policy + per-source availability +
   outcome, each through its honest view. */
export function monitorListReceiptView(receipt) {
  return {
    sessionId: String(receipt?.session_id ?? ""),
    policy: policyView(receipt?.policy),
    sources: sourceAvailabilityViews(receipt?.sources),
    outcome: listOutcomeView(receipt?.outcome),
  };
}

/* ----------------------------------------------------------- deliveries */

/* One durable delivery revision (MonitorDeliveryReportWire). The cursor is
   the owning session-journal sequence, a DECIMAL STRING verbatim; the
   dedupe keys are the daemon's exact-redelivery identities. */
export function deliveryReportView(report) {
  return {
    reportId: String(report?.report_id ?? ""),
    monitorId: String(report?.monitor_id ?? ""),
    sessionId: String(report?.session_id ?? ""),
    source: textOrNull(report?.source),
    status: report?.status == null ? null : String(report.status),
    events: Array.isArray(report?.events) ? report.events : [],
    coalescedCount: finiteOrNull(report?.coalesced_count),
    omittedCount: finiteOrNull(report?.omitted_count),
    action: report?.action ?? null,
    cursor: monitorCursorOrNull(report?.cursor),
    deliveryKey: textOrNull(report?.dedupe?.delivery_key),
    reportKey: textOrNull(report?.dedupe?.report_key),
    raw: report ?? null,
  };
}

/* Delivery rows a watch receipt exposes, tolerantly: a `deliveries` or
   `reports` array of either bare report objects or { watch_id, report }
   frame-shaped rows. A receipt exposing none yields [] — nothing is
   fabricated from the outcome. */
export function watchDeliveries(receipt) {
  const rows = Array.isArray(receipt?.deliveries)
    ? receipt.deliveries
    : Array.isArray(receipt?.reports) ? receipt.reports : [];
  return rows.map((row) => deliveryReportView(row?.report ?? row));
}

/* -------------------------------------------------------- register form */

/* Exact positive-integer parse for interval/timeout form fields WITHOUT
   numeric coercion (banned near cursor code): digits are validated,
   bounded through BigInt, then folded exactly. */
function positiveIntFromText(text) {
  const raw = String(text ?? "").trim();
  if (!DECIMAL_CURSOR.test(raw)) return null;
  const big = BigInt(raw);
  if (big <= 0n || big > 9007199254740991n) return null;
  let value = 0;
  for (const ch of raw) value = value * 10 + (ch.charCodeAt(0) - 48);
  return value;
}

/* Build the monitor.register vocabulary objects from the panel's form
   state. Client-side validation only refuses to DISPATCH malformed
   requests — the daemon's structured rejection remains the authority for
   everything else. Returns { ok: true, spec } (spec.filter null when the
   form built none) or { ok: false, errors }. */
export function buildRegisterSpec(form) {
  const errors = [];
  let source = null;
  const kind = form?.sourceKind;
  if (kind === "sms") {
    source = { kind: "sms" };
  } else if (kind === "process") {
    const command = String(form?.command ?? "").trim();
    if (!command) errors.push("A process source needs a command.");
    else source = { kind: "process", command };
  } else if (kind === "file") {
    const path = String(form?.path ?? "").trim();
    if (!path) errors.push("A file source needs a path.");
    else source = { kind: "file", path };
  } else if (kind === "poll") {
    const command = String(form?.command ?? "").trim();
    const intervalMs = positiveIntFromText(form?.intervalMs);
    if (!command) errors.push("A poll source needs a command.");
    if (intervalMs == null) errors.push("A poll source needs a positive whole interval_ms.");
    if (command && intervalMs != null) {
      source = { kind: "poll", command, interval_ms: intervalMs };
    }
  } else if (kind === "timer") {
    const intervalMs = positiveIntFromText(form?.intervalMs);
    if (intervalMs == null) errors.push("A timer source needs a positive whole interval_ms.");
    else source = { kind: "timer", interval_ms: intervalMs };
  } else if (kind === "advanced") {
    /* Validated structured entry for less-common shapes: a JSON object
       with a string `kind`, submitted VERBATIM. */
    let parsed;
    try {
      parsed = JSON.parse(String(form?.advancedSource ?? ""));
    } catch {
      errors.push("Advanced source is not valid JSON.");
    }
    if (parsed !== undefined) {
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        errors.push("Advanced source must be a JSON object.");
      } else if (typeof parsed.kind !== "string" || parsed.kind.length === 0) {
        errors.push('Advanced source must carry a string "kind".');
      } else {
        source = parsed;
      }
    }
  } else {
    errors.push("Pick a source kind.");
  }

  let filter = null;
  if (form?.filterEnabled === true) {
    const field = form?.filterField;
    const operator = form?.filterOperator;
    const value = String(form?.filterValue ?? "");
    if (!MONITOR_FILTER_FIELDS.includes(field)) {
      errors.push("Pick a filter field.");
    }
    if (!MONITOR_FILTER_OPERATORS.includes(operator)) {
      errors.push("Pick a filter operator.");
    }
    if (value.length === 0) {
      errors.push("A filter needs a value.");
    }
    if (MONITOR_FILTER_FIELDS.includes(field)
      && MONITOR_FILTER_OPERATORS.includes(operator)
      && value.length > 0) {
      filter = {
        field,
        operator,
        value,
        case_sensitive: form?.filterCaseSensitive === true,
      };
    }
  }

  const action = { report: form?.report === false ? false : true };
  const followUp = String(form?.followUp ?? "").trim();
  if (followUp) action.follow_up = followUp;

  const occurrence = MONITOR_OCCURRENCES.includes(form?.occurrence)
    ? form.occurrence
    : "every";

  let lifetime = { kind: "session" };
  if (form?.lifetimeKind === "timeout") {
    const timeoutMs = positiveIntFromText(form?.timeoutMs);
    if (timeoutMs == null) {
      errors.push("A timeout lifetime needs a positive whole timeout_ms.");
    } else {
      lifetime = { kind: "timeout", timeout_ms: timeoutMs };
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, spec: { source, filter, action, occurrence, lifetime } };
}

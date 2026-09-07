const STRUCTURED_FIELDS = ["state", "detail"];

function nonEmptyText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}

function structuredPublication(surface) {
  if (!surface || typeof surface !== "object") return "absent";
  const published = STRUCTURED_FIELDS.some(
    (field) => surface[field] !== null && surface[field] !== undefined,
  );
  return published ? "published-empty" : "absent";
}

function presentation(label, authority, source, structuredStatus) {
  return {
    authority,
    label,
    source,
    structuredStatus,
  };
}

function daemonStructuredPresentation(surface) {
  const detail = nonEmptyText(surface?.detail);
  if (detail !== null) {
    return presentation(detail, "daemon-structured", "daemon-detail", "published");
  }
  const state = nonEmptyText(surface?.state);
  if (state !== null) {
    return presentation(state, "daemon-structured", "daemon-state", "published");
  }
  return null;
}

function localSessionStatus(session) {
  const raw = nonEmptyText(session?.state_raw);
  if (raw !== null) return raw;
  if (session?.status === "running") return "Running";
  if (session?.status === "waiting") return "Waiting";
  if (session?.status === "error") return "Error";
  if (session?.status === "idle") return "Idle";
  return "Unknown";
}

/* Keep the wire distinction intact: an omitted optional field stays omitted,
   an explicit null stays null, and a published empty string stays empty. */
export function statusSegmentEntry(status) {
  const entry = { line: status?.line };
  if (!status || typeof status !== "object") return entry;
  for (const field of STRUCTURED_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(status, field)) {
      entry[field] = status[field];
    }
  }
  return entry;
}

/* Own the event-to-state boundary here so the listener cannot normalize
   optional structured fields before they reach the snapshot. A missing whole
   status is a typed clear; a present line-only status remains a stored entry
   whose structured fields are absent. */
export function applySessionSurfaceStatusEvent(event, sessions, setSurfaceStatus) {
  const payload = event?.payload || {};
  const local = sessions.find(
    (row) => row.provider_session_id === payload.session_id,
  );
  if (!local) return null;

  setSurfaceStatus((current) => {
    if (!payload.status || typeof payload.status !== "object") {
      if (!Object.prototype.hasOwnProperty.call(current, local.id)) return current;
      const cleared = { ...current };
      delete cleared[local.id];
      return cleared;
    }
    return {
      ...current,
      [local.id]: statusSegmentEntry(payload.status),
    };
  });

  return { local, payload };
}

/* The adoption barrier for the composer's own identity (A03/W8.3).
   The SDK's SurfaceWatchState stamps its retained `caller_owner` on EVERY
   payload it emits — watch adoptions and subsequent deltas alike — and its
   adoption replaces that retained identity with the response's optional
   value: present from a 970 watch, cleared for a legacy 969 response. No
   delta is emitted before adoption. A payload without the field can
   therefore only come from a watch whose adoption established NO identity,
   so mirroring each accepted payload exactly IS the epoch fence: absence
   means "identity unknown" — the previously `retained` value is
   surrendered, never remembered — and never fabricates an identity. */
export function adoptSurfaceCallerIdentity(payload, retained = "") {
  if (typeof payload?.caller_owner === "string") return payload.caller_owner;
  return "";
}

/* input_mirror_v1 revisions are publisher-local u64 DECIMAL STRINGS and may
   exceed 2^53 — compare them as decimals, never through Number(). */
function surfaceRevisionAdvances(candidate, floor) {
  const next = String(candidate).replace(/^0+(?=.)/, "");
  const applied = String(floor).replace(/^0+(?=.)/, "");
  if (next.length !== applied.length) return next.length > applied.length;
  return next > applied;
}

/* Owner discrimination for one input-mirror frame (A03/W8.3).
   `session.surface_watch.caller_owner` (970) publishes the composer's OWN
   identity: once adopted, "is this mine" is owner-identity EQUALITY — never
   revision+text resemblance, which two publishers can legitimately share.
   Without it (969 daemons) the documented fallback stands unchanged: an
   exact revision+text echo of one of our publishes teaches us our owner id,
   later frames from that learned owner drop as echoes, and every other lane
   applies when its OWN revision advances — a fresh publisher's revision 1 is
   newer than nothing of ours. A self frame never yields "apply", so a
   delayed self-echo can never overwrite newer local typing or attachments. */
export function surfaceInputMirrorPlan(input, {
  callerOwner = "",
  learnedOwner = "",
  history = null,
  floors = null,
} = {}) {
  if (input?.text == null) return { kind: "none" };
  const { text } = input;
  const owner = typeof input.owner === "string" ? input.owner : "";
  const revision = String(input.revision ?? 0);
  if (callerOwner) {
    /* Daemon-published identity: the ONLY self test. learnOwner stays empty
       because there is nothing left to guess. */
    if (owner === callerOwner) return { kind: "self-echo", learnOwner: "" };
  } else {
    if (history && history.get(revision) === text) {
      return { kind: "self-echo", learnOwner: owner };
    }
    if (owner && owner === learnedOwner) return { kind: "drop" };
  }
  const floor = floors ? floors[owner] : undefined;
  if (floor !== undefined && !surfaceRevisionAdvances(revision, floor)) {
    return { kind: "drop" };
  }
  return { kind: "apply", owner, revision, text };
}

/* A daemon state/detail is authoritative. Everything else is display text
   with explicit presentation-only provenance; the line is never parsed. */
export function surfaceStatusPresentation(surface, session) {
  const structured = daemonStructuredPresentation(surface);
  if (structured !== null) return structured;

  const structuredStatus = structuredPublication(surface);
  const line = nonEmptyText(surface?.line);
  if (line !== null) {
    return presentation(line, "presentation-only", "daemon-line", structuredStatus);
  }
  return presentation(
    localSessionStatus(session),
    "presentation-only",
    "local-session",
    structuredStatus,
  );
}

/* This is the pill's render seam: the visible label and its DOM provenance
   are selected together, so raw display text cannot replace the label while
   retaining structured authority from a different presentation. */
export function surfaceStatusPillView(surface, session, availability = null) {
  const statusPresentation = surfaceStatusPresentation(surface, session);
  const rawStatusLine = typeof surface?.line === "string" ? surface.line.trim() : "";
  return {
    authority: availability ? "availability" : statusPresentation.authority,
    label: availability?.label || statusPresentation.label,
    source: availability ? "session-availability" : statusPresentation.source,
    status: availability ? "unavailable" : session?.status,
    structuredStatus: statusPresentation.structuredStatus,
    title: availability?.detail || rawStatusLine || statusPresentation.label,
  };
}

/* The transcript may display a daemon line or local raw state while a run is
   active, but it must not manufacture activity copy. A structured idle value
   is authoritative and suppresses the shimmer. */
export function surfaceActivityStatusPresentation(surface, session) {
  const structured = daemonStructuredPresentation(surface);
  if (structured !== null) {
    const state = nonEmptyText(surface?.state);
    if ((state !== null && /^idle\b/i.test(state))
      || /^idle\b/i.test(structured.label)) return null;
    return structured;
  }

  const structuredStatus = structuredPublication(surface);
  const line = nonEmptyText(surface?.line);
  if (line !== null) {
    return presentation(line, "presentation-only", "daemon-line", structuredStatus);
  }

  const local = nonEmptyText(session?.state_raw);
  if (local === null || /^idle\b/i.test(local)) return null;
  return presentation(local, "presentation-only", "local-session", structuredStatus);
}

/* This is the shimmer's render seam. It always returns the complete rendered
   view, including the empty label/absent provenance case, so consumers never
   need a second status fallback after the activity-specific helper. */
export function surfaceRunStatusView(surface, session, activityIsRunning, runIsActive) {
  const statusPresentation = activityIsRunning && runIsActive
    ? surfaceActivityStatusPresentation(surface, session)
    : null;
  return {
    authority: statusPresentation?.authority,
    label: statusPresentation?.label || "",
    source: statusPresentation?.source,
    structuredStatus: statusPresentation?.structuredStatus,
  };
}

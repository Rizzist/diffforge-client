/* session.observe's stable wire vocabulary plus the detailed RunState names
   emitted by older/direct projections. These are authority-owned state facts;
   run_id is deliberately absent because it identifies the selected run but
   does not say whether that run is terminal. */
const ACTIVE_RUN_STATES = new Set([
  "active",
  "running",
  "queued",
  "thinking",
  "streaming",
  "running_tool",
  "waiting",
  "retrying",
  "parked_permission",
  "parked_input",
  "permission_required",
  "input_required",
  "compacting",
  "verifying",
  "concluding",
  "cancelling",
]);
const TERMINAL_RUN_STATES = new Set([
  "idle",
  "done",
  "complete",
  "completed",
  "errored",
  "error",
  "cancelled",
  "canceled",
]);
const UNRESOLVED_RUN_STATES = new Set(["effect_unknown", "unknown"]);

function normalizedState(value) {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .split(":", 1)[0]
    .replace(/[- .]+/g, "_");
}

function publishedRunState(session) {
  const raw = normalizedState(session?.state_raw);
  if (raw) return raw;

  const runState = session?.run_state;
  if (typeof runState === "string") return normalizedState(runState);
  if (runState && typeof runState === "object") {
    for (const key of ["status", "state", "kind", "type", "name"]) {
      const candidate = normalizedState(runState[key]);
      if (candidate) return candidate;
    }
  }
  return "";
}

function coarseStatus(session) {
  return normalizedState(session?.status);
}

/* SessionSummary.run_id identifies the ONE run run_state describes. Current
   daemons retain that id when select_observed_run falls back to the latest
   terminal run, so activity comes from run_state (or explicit live metrics),
   never from run identity. Missing agent_metrics means no metrics authority;
   it is not the value false. */
export function sessionRunActivityState(session) {
  if (!session || typeof session !== "object") return "unknown";

  const state = publishedRunState(session);
  if (ACTIVE_RUN_STATES.has(state)) return "active";
  if (TERMINAL_RUN_STATES.has(state)) return "inactive";
  if (UNRESOLVED_RUN_STATES.has(state)) return "unknown";

  const status = coarseStatus(session);
  if (ACTIVE_RUN_STATES.has(status)) return "active";
  if (TERMINAL_RUN_STATES.has(status)) return "inactive";
  if (UNRESOLVED_RUN_STATES.has(status)) return "unknown";

  if (session?.agent_metrics?.live === true) return "active";
  if (session?.agent_metrics?.live === false) return "inactive";
  return "unknown";
}

export function sessionRunIsActive(session) {
  return sessionRunActivityState(session) === "active";
}

export function sessionRunCanCancel(session) {
  return sessionRunIsActive(session)
    && typeof session?.run_id === "string"
    && Boolean(session.run_id.trim());
}

/* Status color remains a separate fact from run identity. In particular, an
   active run whose coarse state is unknown stays neutral: knowing WHICH run
   exists does not tell this client whether that run is healthy or working.
   Contradictory coordinates are neutral too, rather than choosing the
   reassuring green or the working animation. */
export function sessionActivityVisualState(session) {
  const status = coarseStatus(session);
  if (status === "unknown" || !status) return "unknown";
  if (status === "error") return "error";

  const activity = sessionRunActivityState(session);
  if (status === "running" || status === "waiting") {
    return activity === "active" ? status : "unknown";
  }
  if (status === "idle") {
    return activity === "inactive" ? "idle" : "unknown";
  }
  return "unknown";
}

/* Closing is allowed without a warning only when every summary establishes
   inactivity. A summary with neither a run coordinate nor a recognised
   run-state value is uncertainty, and the modal names it as uncertainty
   rather than claiming the session is working. */
export function sessionCloseCautionSummary(sessions) {
  let active = 0;
  let unknown = 0;
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const state = sessionRunActivityState(session);
    if (state === "active") active += 1;
    else if (state === "unknown") unknown += 1;
  }
  return { active, unknown, total: active + unknown };
}

import {
  rosterFromSessionsRead,
  rosterWithConfirmedSession,
  unreachableSpacesRoster,
} from "./spacesController.js";

export const HAIDER_ROSTER_BOOTSTRAP_CHANGED_EVENT = "haider-roster-bootstrap-changed";
export const HAIDER_ROSTER_BOOTSTRAP_REQUEST_EVENT = "haider-roster-bootstrap-request";

export const ROSTER_BOOTSTRAP_PENDING_REASON =
  "A fresh daemon session roster has not been applied yet.";
export const ROSTER_BOOTSTRAP_ROWS_PENDING_REASON =
  "The fresh daemon session roster is applied, but its projected rows have not been read yet.";
export const ROSTER_BOOTSTRAP_INVALID_REASON =
  "The daemon session roster bootstrap state is invalid.";

/* Native publishes reachable only after every session.list page has been
   atomically applied. Keep that production handoff testable: publish the
   barrier first, then read the committed projection only for reachable. */
export async function applyRosterBootstrapEvent(value, publishGate, refreshSessions) {
  const next = publishGate({ type: "barrier", value });
  if (next.barrier.state === "reachable") {
    await refreshSessions();
  }
  return next;
}

function trimmed(value) {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function validGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function validTimestamp(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

/* Fail closed at the native event boundary. A malformed reachable payload can
   never authorize locally cached rows; it becomes an explicitly unreachable
   state instead. */
export function normalizeRosterBootstrapState(value) {
  if (value?.state === "reachable"
    && trimmed(value.profile_id)
    && validGeneration(value.daemon_generation)
    && validTimestamp(value.applied_at_ms)) {
    return {
      state: "reachable",
      profile_id: value.profile_id,
      daemon_generation: value.daemon_generation,
      applied_at_ms: value.applied_at_ms,
    };
  }
  if ((value?.state === "pending" || value?.state === "unreachable")
    && trimmed(value.reason)) {
    return { state: value.state, reason: value.reason };
  }
  return { state: "unreachable", reason: ROSTER_BOOTSTRAP_INVALID_REASON };
}

function rosterForGate(barrier, read) {
  if (barrier.state !== "reachable") {
    return unreachableSpacesRoster(barrier.reason);
  }
  if (!read) {
    return unreachableSpacesRoster(ROSTER_BOOTSTRAP_ROWS_PENDING_REASON);
  }
  if (read.ok === true && !Array.isArray(read.rows)) {
    return unreachableSpacesRoster("The projected daemon session rows are unavailable.");
  }
  return rosterFromSessionsRead(read);
}

function withConfirmedSessions(roster, confirmedSessionRefs) {
  return confirmedSessionRefs.reduce(
    (current, sessionRef) => rosterWithConfirmedSession(current, sessionRef),
    roster,
  );
}

export function createSessionsRosterGate() {
  const barrier = {
    state: "pending",
    reason: ROSTER_BOOTSTRAP_PENDING_REASON,
  };
  return {
    barrier,
    barrierRevision: 0,
    confirmationRevision: 0,
    confirmedSessionRefs: [],
    read: null,
    roster: rosterForGate(barrier, null),
  };
}

/* The reducer's revision is the ordering fence between native daemon truth
   and the local sqlite projection. Every barrier publication invalidates
   reads begun under the prior connection/generation. Even after a complete
   roster applies, a new local read must land before refs can be published. */
export function reduceSessionsRosterGate(current, action) {
  const state = current || createSessionsRosterGate();
  if (action?.type === "barrier") {
    const barrier = normalizeRosterBootstrapState(action.value);
    const barrierRevision = state.barrierRevision + 1;
    return {
      barrier,
      barrierRevision,
      confirmationRevision: state.confirmationRevision,
      confirmedSessionRefs: [],
      read: null,
      roster: rosterForGate(barrier, null),
    };
  }
  if (action?.type === "confirmed-session") {
    const sessionRef = action.sessionRef;
    const confirmationRevision = state.confirmationRevision + 1;
    const confirmedSessionRefs = [...new Set([
      ...state.confirmedSessionRefs,
      sessionRef,
    ])];
    return {
      ...state,
      confirmationRevision,
      confirmedSessionRefs,
      roster: rosterWithConfirmedSession(state.roster, sessionRef),
    };
  }
  if (action?.type === "sessions-read") {
    if (action.barrierRevision !== state.barrierRevision) {
      return state;
    }
    const read = action.read;
    const readIsFreshCompleteProjection = state.barrier.state === "reachable"
      && read?.ok === true
      && Array.isArray(read.rows)
      && action.confirmationRevision === state.confirmationRevision;
    const confirmedSessionRefs = readIsFreshCompleteProjection
      ? []
      : state.confirmedSessionRefs;
    const roster = withConfirmedSessions(
      rosterForGate(state.barrier, read),
      confirmedSessionRefs,
    );
    return {
      ...state,
      confirmedSessionRefs,
      read,
      roster,
    };
  }
  throw new Error(`Unsupported sessions roster gate action '${String(action?.type || "")}'.`);
}

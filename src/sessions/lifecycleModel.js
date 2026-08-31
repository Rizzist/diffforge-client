import { loomUnavailableFromError } from "./loomModel.js";

/* Pure view/argument helpers for session lifecycle actions. The daemon is
   the only authority for titles, fork identity/lineage, and run state: these
   helpers preserve omission and published coordinates instead of filling in
   plausible client values. */

const RETRYABLE_RUN_STATES = new Set(["failed", "errored", "error"]);

function normalizedRunState(value) {
  if (typeof value !== "string") return "";
  return value.trim().toLowerCase().replace(/[- .]+/g, "_");
}

function publishedRunState(session) {
  if (!session || typeof session !== "object"
    || !Object.prototype.hasOwnProperty.call(session, "run_state")) {
    return null;
  }
  const publication = session.run_state;
  if (typeof publication === "string") {
    const normalized = normalizedRunState(publication);
    return normalized ? { normalized, raw: publication } : null;
  }
  if (!publication || typeof publication !== "object" || Array.isArray(publication)) {
    return null;
  }
  for (const key of ["state", "status", "kind", "type", "name"]) {
    if (!Object.prototype.hasOwnProperty.call(publication, key)) continue;
    const normalized = normalizedRunState(publication[key]);
    if (normalized) return { normalized, raw: publication[key] };
  }
  return null;
}

/* An empty/whitespace editor value is the daemon's documented CLEAR
   operation: the title key is absent. A real title is the only case that
   emits the key. In particular, this helper never emits title: "". */
export function renameArgs(title) {
  const value = typeof title === "string" ? title.trim() : "";
  return value ? { title: value } : {};
}

/* The receipt is the fork authority. Every coordinate is copied directly
   from its matching wire field; absence remains undefined and no session id,
   title, lineage, branch, or node is derived on the client. */
export function forkReceiptView(receipt) {
  return {
    sessionId: receipt?.session_id,
    sourceSessionId: receipt?.source_session_id,
    sourceBranchId: receipt?.source_branch_id,
    forkNodeId: receipt?.fork_node_id,
  };
}

/* Retry eligibility reads ONLY the daemon's published run_state. Coarse
   status, state_raw, labels, messages, and ids are deliberately ignored.
   Unknown and known-ineligible are distinct so a disabled UI can explain
   whether the daemon withheld the fact or published a non-failure state. */
export function retryEligibility(session) {
  const state = publishedRunState(session);
  if (state == null) {
    return {
      kind: "unknown",
      eligible: false,
      runState: null,
      reason: "Retry unavailable: run state was not published by the daemon.",
    };
  }
  if (RETRYABLE_RUN_STATES.has(state.normalized)) {
    return {
      kind: "eligible",
      eligible: true,
      runState: state.raw,
      reason: "",
    };
  }
  return {
    kind: "ineligible",
    eligible: false,
    runState: state.raw,
    reason: `Retry unavailable: daemon run state is “${state.raw}”.`,
  };
}

/* Lifecycle uses the same feature-gate vocabulary as Loom. Keeping one
   detector prevents a String throw from turning into repeated failing UI. */
export function lifecycleUnavailableFromError(error) {
  return loomUnavailableFromError(error);
}

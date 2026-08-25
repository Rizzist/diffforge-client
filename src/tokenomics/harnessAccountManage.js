// Harness account MANAGEMENT for the tokenomics accounts row: the add flows
// (OAuth sign-in, OAuth import, API key) and the remove lifecycle.
//
// Every decision here is pure and pinned under node:test; the view only
// performs the invokes these decisions call for. The RPC doors consumed
// (src-tauri/src/haider_rpc_ade.rs):
//   account_oauth_start { provider, desired_alias }
//   account_oauth_status { flow_id, attempt_id }
//   account_oauth_cancel { flow_id, attempt_id }
//   account_oauth_add { provider, alias, flow_id, attempt_id, oauth_reference }
//   haider_account_oauth_import_sources {} -> Option<Vec<row>> (None = unpublished)
//   haider_account_oauth_import { source }
//   account_add_api_key { provider, alias, api_key, validation_model }
//   account_remove { alias, expected_revision }
//
// Honesty rules enforced here (same law as harnessAccountRoster.js):
// - Optimistic-NEVER: a completed add or remove NEVER edits the roster
//   locally. These machines hold no descriptors at all; success surfaces only
//   a `relist: true` effect, and the roster changes exclusively via
//   account_list (watch signal or the explicit re-list on success).
// - Absent facts stay absent: a missing authorization_url/user_code renders
//   as missing, an absent import catalog is "unpublished" (not empty), and an
//   absent descriptor auth_method is UNKNOWN — never sniffed into a kind.
// - Secrets are wiped: the API-key draft loses its key the moment the submit
//   invoke settles, success or failure alike.

import { HARNESS_ACCOUNTS_UNSUPPORTED_CODE, harnessRosterErrorCode } from "./harnessAccountRoster.js";

function wireText(value) {
  return String(value ?? "").trim();
}

/* ---- shared typed-failure prose (mirrors the daemon's public codes) ----- */

export function harnessManageFailureMessage(code) {
  const text = wireText(code);
  if (text.includes("unauthorized")) return "The credential was rejected (401) — check it and try again.";
  if (text.includes("permission_denied")) return "The identity lacks access to the model or endpoint (403).";
  if (text.includes("provider_error")) return "The provider was unreachable — try again.";
  if (text.includes("restage_required")) return "The staged secret expired — submit again.";
  if (text.includes("revision_conflict")) return "The account list changed underneath — a refresh is required before you try again.";
  if (text.includes("invalid_argument")) return "The daemon rejected the request (bad alias, provider, or source).";
  if (text.includes("busy")) return "The daemon is busy — try again in a moment.";
  if (text.includes(HARNESS_ACCOUNTS_UNSUPPORTED_CODE)) return "The harness connection is unavailable.";
  return text || "The request failed.";
}

/* ---- OAuth sign-in flow machine ----------------------------------------
   idle -> starting -> pending -> claiming -> succeeded
                    \-> unavailable        \-> failed
   pending/claiming -> cancelled (user) | failed (daemon reason)
   Terminal phases: unavailable | succeeded | failed | cancelled.           */

const ADD_FLOW_ACTIVE_PHASES = new Set(["starting", "pending", "claiming"]);

export function createHarnessAddFlowState() {
  return {
    phase: "idle",
    provider: "",
    alias: "",
    flowId: "",
    attemptId: "",
    authorizationUrl: "",
    userCode: "",
    expiresAtMs: null,
    oauthReference: "",
    message: "",
  };
}

export function harnessAddFlowIsActive(state) {
  return ADD_FLOW_ACTIVE_PHASES.has(state?.phase);
}

export function harnessAddFlowShouldPoll(state) {
  return state?.phase === "pending";
}

export function harnessAddFlowBegin(state, { provider, alias } = {}) {
  if (harnessAddFlowIsActive(state)) return state;
  const cleanProvider = wireText(provider);
  const cleanAlias = wireText(alias) || cleanProvider;
  if (!cleanProvider) return state;
  return {
    ...createHarnessAddFlowState(),
    phase: "starting",
    provider: cleanProvider,
    alias: cleanAlias,
  };
}

/* `account_oauth_start` result: { availability, flow_id?, authorization_url?,
   user_code?, provider_origin?, loopback_port?, expires_at_ms?, attempt_id }.
   The daemon answers unsupported registrations with availability
   { available: false, reason? } instead of a flow — that reason crosses
   verbatim. A started flow with no flow_id is a daemon defect surfaced as a
   failure, never a fabricated pending state. */
export function harnessAddFlowOnStartResult(state, result) {
  if (state.phase !== "starting") return state;
  const availability = result?.availability;
  if (availability && typeof availability === "object" && availability.available === false) {
    return {
      ...state,
      phase: "unavailable",
      message: wireText(availability.reason),
    };
  }
  const flowId = wireText(result?.flow_id);
  const attemptId = wireText(result?.attempt_id);
  if (!flowId || !attemptId) {
    return {
      ...state,
      phase: "failed",
      message: "The daemon reported the flow started but published no flow id.",
    };
  }
  return {
    ...state,
    phase: "pending",
    flowId,
    attemptId,
    /* Absent url/code render as absent — the pending card says exactly what
       the daemon published and nothing more. */
    authorizationUrl: wireText(result?.authorization_url),
    userCode: wireText(result?.user_code),
    expiresAtMs: Number.isInteger(result?.expires_at_ms) ? result.expires_at_ms : null,
  };
}

export function harnessAddFlowOnStartError(state, error) {
  if (state.phase !== "starting") return state;
  return {
    ...state,
    phase: "failed",
    message: harnessManageFailureMessage(harnessRosterErrorCode(error)),
  };
}

/* One `account_oauth_status` poll result. Stale polls (a different flow, or
   a flow no longer pending — the user may have cancelled while the poll was
   in flight) change nothing. Non-terminal daemon statuses (waiting_browser,
   waiting_device, exchanging, unknown) keep the flow pending. */
export function harnessAddFlowOnStatus(state, flowId, attemptId, statusResult) {
  if (
    state.phase !== "pending"
    || wireText(flowId) !== state.flowId
    || wireText(attemptId) !== state.attemptId
    || wireText(statusResult?.flow_id) !== state.flowId
  ) return state;
  const status = statusResult?.status && typeof statusResult.status === "object"
    ? statusResult.status
    : {};
  const kind = wireText(status.status);
  if (kind === "ready") {
    const reference = wireText(status.oauth_reference);
    if (!reference) {
      return {
        ...state,
        phase: "failed",
        message: "The daemon reported the flow ready without an oauth reference.",
      };
    }
    return { ...state, phase: "claiming", oauthReference: reference };
  }
  if (kind === "failed") {
    return {
      ...state,
      phase: "failed",
      message: `Sign-in failed (${wireText(status.public_code) || "unknown"}).`,
    };
  }
  if (kind === "expired") {
    return { ...state, phase: "failed", message: "The sign-in flow expired — start again." };
  }
  if (kind === "cancelled") {
    return { ...state, phase: "cancelled", message: "" };
  }
  return state;
}

export function harnessAddFlowOnStatusError(state, flowId, attemptId, error) {
  if (
    state.phase !== "pending"
    || wireText(flowId) !== state.flowId
    || wireText(attemptId) !== state.attemptId
  ) return state;
  const code = harnessRosterErrorCode(error);
  return {
    ...state,
    phase: "failed",
    /* Flows die with the daemon connection — the honest recovery is a fresh
       start, with the daemon's code carried. */
    message: `The sign-in flow was lost (${code || "connection changed"}) — start again.`,
  };
}

export function harnessAddFlowClaimPayload(state) {
  if (state.phase !== "claiming") return null;
  return {
    provider: state.provider,
    alias: state.alias,
    flow_id: state.flowId,
    attempt_id: state.attemptId,
    oauth_reference: state.oauthReference,
  };
}

/* The daemon accepted the claim (`account_oauth_add` returned a descriptor).
   The machine deliberately DROPS that descriptor: the roster is account_list
   authority, so the only effect a completed add may emit is `relist: true`.
   The oauth reference is wiped — it is claim material, not display state. */
export function harnessAddFlowOnClaimResult(state) {
  if (state.phase !== "claiming") return { state, relist: false };
  return {
    state: { ...state, phase: "succeeded", oauthReference: "", message: "" },
    relist: true,
  };
}

export function harnessAddFlowOnClaimError(state, error) {
  if (state.phase !== "claiming") return state;
  return {
    ...state,
    phase: "failed",
    oauthReference: "",
    message: harnessManageFailureMessage(harnessRosterErrorCode(error)),
  };
}

/* The daemon publishes the flow deadline. It bounds polling even if the
   bridge keeps returning nonterminal statuses forever; expiry also produces
   the exact cancel payload for best-effort daemon cleanup. */
export function harnessAddFlowExpire(state, nowMs, fallbackExpiresAtMs = null) {
  const deadline = Number.isInteger(state?.expiresAtMs)
    ? state.expiresAtMs
    : Number.isInteger(fallbackExpiresAtMs) ? fallbackExpiresAtMs : null;
  if (
    state.phase !== "pending"
    || !Number.isInteger(deadline)
    || !Number.isFinite(nowMs)
    || nowMs < deadline
  ) {
    return { state, cancelPayload: null };
  }
  return {
    state: {
      ...state,
      phase: "failed",
      oauthReference: "",
      message: Number.isInteger(state.expiresAtMs)
        ? "The sign-in flow expired — start again."
        : "Sign-in polling stopped because the daemon published no deadline — start again.",
    },
    cancelPayload: { flow_id: state.flowId, attempt_id: state.attemptId },
  };
}

/* Cancel from an active flow surfaces the daemon-cancel payload; cancel of a
   terminal/idle card just resets it. */
export function harnessAddFlowCancel(state) {
  if (state.phase === "pending" || state.phase === "claiming") {
    return {
      state: { ...state, phase: "cancelled", oauthReference: "", message: "" },
      cancelPayload: { flow_id: state.flowId, attempt_id: state.attemptId },
    };
  }
  /* A start has no flow id yet. Mark it cancelled so the async start attempt
     can recognize that close won the race, await its result, and cancel the
     daemon-published flow instead of orphaning it. */
  if (state.phase === "starting") {
    return {
      state: { ...state, phase: "cancelled", oauthReference: "", message: "" },
      cancelPayload: null,
    };
  }
  return { state: createHarnessAddFlowState(), cancelPayload: null };
}

export function harnessAddFlowDismiss(state) {
  if (harnessAddFlowIsActive(state)) return state;
  return createHarnessAddFlowState();
}

/* ---- OAuth import catalog (published authority, carried verbatim) ------- */

export function createHarnessImportCatalogState() {
  return { state: "idle", sources: null, reason: "" };
}

/* Browsers clamp (or wrap) larger timeout delays. Keep every OAuth expiry
   arm inside the signed 32-bit timer range, then let the caller re-arm until
   the published deadline actually arrives. */
export const HARNESS_SAFE_TIMEOUT_MAX_MS = 2_147_483_647;

export function harnessOauthExpiryWaitMs({
  deadlineMs,
  wallNowMs,
  monotonicDeadlineMs,
  monotonicNowMs,
}) {
  const wallRemaining = Number(deadlineMs) - Number(wallNowMs);
  const monotonicRemaining = Number(monotonicDeadlineMs) - Number(monotonicNowMs);
  const remaining = Math.min(wallRemaining, monotonicRemaining);
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  return Math.min(HARNESS_SAFE_TIMEOUT_MAX_MS, Math.ceil(remaining));
}

/* `haider_account_oauth_import_sources` returns Option<Vec<row>>: null means this
   daemon publishes NO catalog — a different fact from a catalog listing
   nothing, and both are different from a fetch failure. */
export function harnessImportCatalogOnResult(result) {
  if (result == null) return { state: "unpublished", sources: null, reason: "" };
  if (!Array.isArray(result)) {
    return {
      state: "error",
      sources: null,
      reason: "The daemon published a malformed import catalog (expected a row list).",
    };
  }
  const malformedIndex = result.findIndex((row) => (
    !row
    || typeof row !== "object"
    || Array.isArray(row)
    || typeof row.source !== "string"
    || !row.source.trim()
    || row.source !== row.source.trim()
    || (row.provider != null && typeof row.provider !== "string")
    || (row.default_alias != null && typeof row.default_alias !== "string")
    || (row.unavailable_reason != null && typeof row.unavailable_reason !== "string")
    || (row.available != null && typeof row.available !== "boolean")
  ));
  if (malformedIndex >= 0) {
    return {
      state: "error",
      sources: null,
      reason: `The daemon published a malformed import catalog row at index ${malformedIndex} (invalid field shape).`,
    };
  }
  return { state: "loaded", sources: result, reason: "" };
}

export function harnessImportCatalogOnError(error) {
  return { state: "error", sources: null, reason: harnessRosterErrorCode(error) };
}

/* Rows cross verbatim: source, provider, default_alias, available, and the
   daemon's own unavailable_reason prose. `available` is tri-state — only an
   explicit true is importable, only an explicit false is unavailable, and
   absence stays unknown (rendered not-importable, labelled unknown). */
export function harnessImportCatalogPresentation(catalog) {
  if (!catalog || catalog.state === "idle") return { phase: "loading", rows: [], reason: "" };
  if (catalog.state === "unpublished") {
    return { phase: "unpublished", rows: [], reason: "" };
  }
  if (catalog.state === "error") {
    return { phase: "unavailable", rows: [], reason: catalog.reason || "" };
  }
  const rows = (catalog.sources || []).map((row) => {
    const available = row?.available === true ? true : row?.available === false ? false : null;
    return {
      source: wireText(row?.source),
      provider: wireText(row?.provider),
      defaultAlias: wireText(row?.default_alias),
      available,
      unavailableReason: wireText(row?.unavailable_reason),
    };
  });
  if (!rows.length) return { phase: "empty", rows: [], reason: "" };
  return { phase: "ready", rows, reason: "" };
}

/* Import lifecycle: idle -> in_flight -> idle (relist) | failed. Success
   emits relist:true and NOTHING else — the imported descriptor arrives via
   account_list like every other roster fact. */
export function createHarnessImportState() {
  return { phase: "idle", source: "", message: "" };
}

export function harnessImportBegin(state, source) {
  const clean = wireText(source);
  if (!clean || state.phase === "in_flight") return { state, payload: null };
  return {
    state: { phase: "in_flight", source: clean, message: "" },
    payload: { source: clean },
  };
}

export function harnessImportOnResult(state) {
  if (state.phase !== "in_flight") return { state, relist: false };
  return { state: createHarnessImportState(), relist: true };
}

export function harnessImportOnError(state, error) {
  if (state.phase !== "in_flight") return { state, relist: false };
  const code = harnessRosterErrorCode(error);
  return {
    state: { phase: "failed", source: state.source, message: harnessManageFailureMessage(code) },
    relist: false,
  };
}

export function harnessImportDismiss(state) {
  if (state.phase === "in_flight") return state;
  return createHarnessImportState();
}

/* ---- remove lifecycle: confirm -> in_flight -> daemon-confirmed --------- */

export function createHarnessRemoveState() {
  return { phase: "idle", alias: "", expectedRevision: null, message: "" };
}

/* An accidental remove is costly (the 954+ daemon makes removal durable via
   tombstones), so the affordance always passes through an inline confirm. */
export function harnessRemoveRequest(state, alias, revision) {
  const clean = wireText(alias && typeof alias === "object" ? alias.alias : alias);
  /* The open confirmation owns one immutable alias/revision pair. Repeated
     chip clicks cannot retarget it before dismissal or daemon settlement. */
  if (!clean || state.phase === "confirm" || state.phase === "in_flight") return state;
  return {
    phase: "confirm",
    alias: clean,
    expectedRevision: Number.isInteger(revision) ? revision : null,
    message: "",
  };
}

export function harnessRemoveDismiss(state) {
  if (state.phase === "in_flight") return state;
  return createHarnessRemoveState();
}

/* Only a confirmed request may reach the daemon. `expected_revision` is the
   roster revision the user was looking at — the daemon rejects a stale one
   with revision_conflict rather than removing the wrong thing. A revision
   the roster never published crosses as null, never as a fabricated 0. */
export function harnessRemoveBegin(state) {
  if (state.phase !== "confirm") return { state, payload: null };
  return {
    state: {
      phase: "in_flight",
      alias: state.alias,
      expectedRevision: state.expectedRevision,
      message: "",
    },
    payload: {
      alias: state.alias,
      expected_revision: state.expectedRevision,
    },
  };
}

/* The daemon confirmed the removal. The machine holds no descriptors, so
   there is nothing to splice — the row disappears only when account_list
   stops publishing it, which the relist effect (and the roster watch) make
   immediate. */
export function harnessRemoveOnResult(state) {
  if (state.phase !== "in_flight") return { state, relist: false };
  return { state: createHarnessRemoveState(), relist: true };
}

export function harnessRemoveOnError(state, error) {
  if (state.phase !== "in_flight") return { state, relist: false };
  const code = harnessRosterErrorCode(error);
  const revisionConflict = code.includes("revision_conflict");
  return {
    state: {
      phase: "failed",
      alias: state.alias,
      expectedRevision: state.expectedRevision,
      message: revisionConflict
        ? "The account list changed underneath — refreshing before you try again."
        : harnessManageFailureMessage(code),
    },
    /* A revision conflict means the roster moved underneath — the honest
       reaction is a re-list so the user confirms against what exists now. */
    relist: revisionConflict,
  };
}

/* A conflict-triggered refresh settles after the failure is already visible.
   Update the prose with what actually happened; never claim a pending or
   failed read already refreshed the roster. */
export function harnessRemoveOnRefreshResult(state, refreshOutcome) {
  if (state.phase !== "failed") return state;
  const outcome = refreshOutcome === true ? "refreshed"
    : refreshOutcome === false ? "failed"
      : wireText(refreshOutcome);
  if (outcome === "refreshed") {
    return {
      ...state,
      message: "The account list changed underneath — the roster is now refreshed; review it and try again.",
    };
  }
  if (outcome === "failed") {
    return {
      ...state,
      message: "The account list changed underneath, and the roster refresh failed — refresh before trying again.",
    };
  }
  return {
    ...state,
    message: outcome === "superseded"
      ? "The account list changed underneath, and a newer roster refresh superseded this read — review the list before trying again."
      : "The account list changed underneath while this view became inactive — review the list before trying again.",
  };
}

/* ---- API-key draft (secret redaction) ----------------------------------- */

export function createHarnessApiKeyDraft() {
  return { provider: "", alias: "", key: "" };
}

export function harnessApiKeyDraftEdit(draft, field, value) {
  if (!["provider", "alias", "key"].includes(field)) return draft;
  return { ...draft, [field]: String(value ?? "") };
}

export function harnessApiKeySubmitReady(draft) {
  return Boolean(wireText(draft?.provider) && String(draft?.key || "").length);
}

/* The exact `account_add_api_key` arguments — the key crosses ONLY here, into
   the invoke, and nowhere else (no logs, no titles, no derived state). */
export function harnessApiKeySubmitPayload(draft) {
  if (!harnessApiKeySubmitReady(draft)) return null;
  return {
    provider: wireText(draft.provider),
    alias: wireText(draft.alias) || null,
    api_key: String(draft.key),
    validation_model: null,
  };
}

/* Called the moment the submit invoke settles — success or failure. The key
   never survives a submit in state; a failed validation costs a retype, and
   that is the price of never retaining a secret. */
export function harnessApiKeyRedactDraft(draft) {
  return { ...createHarnessApiKeyDraft(), provider: String(draft?.provider ?? ""), alias: String(draft?.alias ?? ""), key: "" };
}

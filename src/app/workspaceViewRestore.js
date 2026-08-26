import { useCallback, useEffect, useRef, useState } from "react";

import { serializeWorkspaceView } from "./workspaceViewPersistence.js";

export const WORKSPACE_VIEW_SCHEMA_VERSION = 1;
export const WORKSPACE_VIEW_HYDRATION_COMPLETE = "complete";

const RECORD_KEYS = Object.freeze([
  "profile_id",
  "revision",
  "schema_version",
  "updated_at_ms",
  "view_json",
]);
const ROOT_KEYS = Object.freeze(["active_space_id", "active_target", "open_sessions"]);
const TARGET_KEYS = Object.freeze({
  home: ["kind"],
  session: ["kind", "session_ref"],
  space: ["kind", "space_id"],
});
const MISSING_PROJECTED_SESSION_REASON =
  "The fresh roster confirmed this session, but its projected row is unavailable.";
const UNAVAILABLE_ROSTER_REASON = "The fresh daemon session roster is unavailable.";
const MAX_PROFILE_ID_BYTES = 512;
const MAX_VIEW_JSON_BYTES = 1024 * 1024;
const RUST_EDGE_WHITESPACE = /^\p{White_Space}|\p{White_Space}$/u;
const DEFAULT_RESTORE_RETRY_DELAY_MS = 500;
const defaultSetTimeout = (...args) => globalThis.setTimeout(...args);
const defaultClearTimeout = (...args) => globalThis.clearTimeout(...args);
const reportInvalidSnapshot = (reason) => {
  console.warn("Ignoring an invalid workspace-view snapshot.", reason);
};
const reportTransientReadError = (error) => {
  console.error(
    "Unable to read the workspace-view snapshot; persistence remains unarmed and the read will retry.",
    error,
  );
};

function errorText(error) {
  if (typeof error === "string") return error;
  if (typeof error?.message === "string") return error.message;
  if (error?.cause != null && error.cause !== error) return errorText(error.cause);
  return String(error);
}

/* Native validates stored bytes before returning a record. Only its explicit
   stored-row/view validation failures authorize fresh-Home recovery; SQLite,
   IPC, and other read failures leave persistence unarmed for a later barrier. */
export function workspaceViewGetFailureIsInvalidSnapshot(error) {
  const message = errorText(error);
  return /^Workspace view for profile '.*' (uses unsupported schema version|has invalid revision)/.test(message)
    || message.startsWith("Workspace view canonical-byte divergence:")
    || message.startsWith("Workspace view exceeds the ")
    || message.startsWith("Unable to decode workspace view:")
    || message.startsWith("A workspace view may contain at most ")
    || message.startsWith("Open session reference ")
    || message.startsWith("Active session reference ")
    || message.startsWith("Active target space id ")
    || message.startsWith("Active space id ");
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  if (actual.length !== canonical.length
    || actual.some((key, index) => key !== canonical[index])) {
    throw new Error(`${label} contains partial or unsupported fields.`);
  }
}

function requireExpectedProfileId(expectedProfileId) {
  if (typeof expectedProfileId !== "string"
    || expectedProfileId.length === 0
    || RUST_EDGE_WHITESPACE.test(expectedProfileId)) {
    throw new Error("The expected workspace-view profile id is invalid.");
  }
  for (let index = 0; index < expectedProfileId.length; index += 1) {
    const unit = expectedProfileId.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = expectedProfileId.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error("The expected workspace-view profile id is invalid.");
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error("The expected workspace-view profile id is invalid.");
    }
  }
  if (new TextEncoder().encode(expectedProfileId).byteLength > MAX_PROFILE_ID_BYTES) {
    throw new Error("The expected workspace-view profile id is invalid.");
  }
}

function requireProfileMatch(recordProfileId, expectedProfileId) {
  if (recordProfileId !== expectedProfileId) {
    throw new Error("The workspace-view snapshot belongs to a different profile.");
  }
}

function decodedActiveTarget(value) {
  const expected = TARGET_KEYS[value?.kind];
  if (!expected) {
    throw new Error("The workspace-view active target kind is unsupported.");
  }
  exactKeys(value, expected, "Workspace-view active target");
  if (value.kind === "session") {
    return { kind: "session", sessionRef: value.session_ref };
  }
  if (value.kind === "space") {
    return { kind: "space", spaceId: value.space_id };
  }
  return { kind: "home" };
}

/**
 * Validate the native record again at the JS trust boundary. Canonical-byte
 * equality delegates all reference/count/UTF-8 limits to the saver serializer,
 * so a partial, reordered, unknown-field, or oversized snapshot cannot hydrate.
 */
export function validateWorkspaceViewSnapshot(record, expectedProfileId) {
  requireExpectedProfileId(expectedProfileId);
  if (record === null) {
    return {
      status: "absent",
      revision: null,
      openSessionRefs: [],
      activeTarget: { kind: "home" },
      activeSpaceId: null,
    };
  }
  exactKeys(record, RECORD_KEYS, "Workspace-view record");
  requireProfileMatch(record.profile_id, expectedProfileId);
  if (record.schema_version !== WORKSPACE_VIEW_SCHEMA_VERSION) {
    throw new Error(`Workspace-view schema version '${String(record.schema_version)}' is unsupported.`);
  }
  if (!Number.isSafeInteger(record.revision) || record.revision <= 0) {
    throw new Error("Workspace-view revision must be a positive safe integer.");
  }
  if (!Number.isSafeInteger(record.updated_at_ms) || record.updated_at_ms < 0) {
    throw new Error("Workspace-view update time must be a non-negative safe integer.");
  }
  if (typeof record.view_json !== "string") {
    throw new Error("Workspace-view JSON must be a string.");
  }
  if (new TextEncoder().encode(record.view_json).byteLength > MAX_VIEW_JSON_BYTES) {
    throw new Error(`Workspace view exceeds the ${MAX_VIEW_JSON_BYTES}-byte limit.`);
  }

  let decoded;
  try {
    decoded = JSON.parse(record.view_json);
  } catch (error) {
    throw new Error(`Unable to decode workspace-view JSON: ${String(error?.message || error)}`);
  }
  exactKeys(decoded, ROOT_KEYS, "Workspace view");
  const activeTarget = decodedActiveTarget(decoded.active_target);
  const canonical = serializeWorkspaceView({
    openSessionRefs: decoded.open_sessions,
    activeTarget,
    activeSpaceId: decoded.active_space_id,
  });
  if (canonical !== record.view_json) {
    throw new Error("Workspace-view canonical-byte divergence.");
  }
  if (activeTarget.kind === "space" && decoded.active_space_id !== activeTarget.spaceId) {
    throw new Error("Workspace-view active space does not match its space target.");
  }
  if (activeTarget.kind === "session" && decoded.active_space_id !== null) {
    throw new Error("A session-target workspace view cannot also carry an active space.");
  }
  return {
    status: "restored",
    revision: record.revision,
    openSessionRefs: [...decoded.open_sessions],
    activeTarget,
    activeSpaceId: decoded.active_space_id,
  };
}

/** Preserve the ordered persisted open-set even when none of its refs is live. */
export function reconcileWorkspaceOpenSessions(openSessionRefs, roster) {
  if (!Array.isArray(openSessionRefs)) {
    throw new Error("Workspace-view open session references must be an array.");
  }
  const rosterIsFresh = roster?.state === "reachable" && Array.isArray(roster.sessionRefs);
  const freshRefs = rosterIsFresh ? new Set(roster.sessionRefs) : null;
  const reason = typeof roster?.reason === "string" && roster.reason.trim()
    ? roster.reason
    : UNAVAILABLE_ROSTER_REASON;
  return openSessionRefs.map((sessionRef) => {
    if (!freshRefs) return { sessionRef, state: "unknown", reason };
    return freshRefs.has(sessionRef)
      ? { sessionRef, state: "live" }
      : { sessionRef, state: "tombstone" };
  });
}

/**
 * Select the persisted primary target without confusing roster absence with
 * open-set absence. A tombstone/unknown target that remains open stays selected
 * and receives an honest card; only a target missing from the open-set falls back.
 */
export function selectWorkspaceRestoreTarget(activeTarget, openEntries) {
  if (!Array.isArray(openEntries)) {
    throw new Error("Workspace-view reconciled open entries must be an array.");
  }
  if (activeTarget?.kind === "space") {
    return { kind: "space", spaceId: activeTarget.spaceId };
  }
  if (activeTarget?.kind === "home") return { kind: "home" };
  if (activeTarget?.kind !== "session") {
    throw new Error("Workspace-view restore target is unsupported.");
  }
  const selected = openEntries.find((entry) => entry.sessionRef === activeTarget.sessionRef);
  if (selected) {
    return {
      kind: "session",
      sessionRef: selected.sessionRef,
      state: selected.state,
    };
  }
  const fallback = openEntries.find((entry) => entry.state === "live");
  return fallback
    ? { kind: "session", sessionRef: fallback.sessionRef, state: "live" }
    : { kind: "home" };
}

export function freshWorkspaceViewHydration(profileId, source = "absent", reason = "") {
  return {
    phase: WORKSPACE_VIEW_HYDRATION_COMPLETE,
    source,
    profileId,
    revision: null,
    openSessionRefs: [],
    openEntries: [],
    requestedTarget: { kind: "home" },
    target: { kind: "home" },
    targetSelectionPending: false,
    activeSpaceId: null,
    reason,
  };
}

/** Build the complete pure hydration decision; invalid bytes import no intent. */
export function decideWorkspaceViewHydration({ record, profileId, roster } = {}) {
  let snapshot;
  try {
    snapshot = validateWorkspaceViewSnapshot(record, profileId);
  } catch (error) {
    return freshWorkspaceViewHydration(
      profileId,
      "invalid",
      String(error?.message || error),
    );
  }
  if (snapshot.status === "absent") {
    return freshWorkspaceViewHydration(profileId);
  }
  const openEntries = reconcileWorkspaceOpenSessions(snapshot.openSessionRefs, roster);
  const targetMissingFromOpenSet = snapshot.activeTarget.kind === "session"
    && !openEntries.some((entry) => entry.sessionRef === snapshot.activeTarget.sessionRef);
  return {
    phase: WORKSPACE_VIEW_HYDRATION_COMPLETE,
    source: "restored",
    profileId,
    revision: snapshot.revision,
    openSessionRefs: snapshot.openSessionRefs,
    openEntries,
    requestedTarget: snapshot.activeTarget,
    target: selectWorkspaceRestoreTarget(snapshot.activeTarget, openEntries),
    targetSelectionPending: targetMissingFromOpenSet
      && openEntries.some((entry) => entry.state === "unknown"),
    activeSpaceId: snapshot.activeSpaceId,
    reason: "",
  };
}

/** The saver receives no command until ordinary/space hydration is complete. */
export function workspaceViewRestoreArmArgs({ phase, profileId, revision } = {}) {
  if (phase !== WORKSPACE_VIEW_HYDRATION_COMPLETE) return null;
  return { profileId, revision };
}

/** A live verdict still needs its fresh projected row before anything mounts. */
export function workspaceOpenSessionPresentation(entry, sessionsById) {
  if (entry?.state === "tombstone") return { mode: "tombstone" };
  if (entry?.state === "unknown") {
    return { mode: "unknown", reason: entry.reason || UNAVAILABLE_ROSTER_REASON };
  }
  if (entry?.state !== "live") {
    return { mode: "unknown", reason: UNAVAILABLE_ROSTER_REASON };
  }
  const session = sessionsById?.get?.(entry.sessionRef) ?? null;
  return session
    ? { mode: "live", session }
    : { mode: "unknown", reason: MISSING_PROJECTED_SESSION_REASON };
}

/**
 * Production restore/persistence effects, kept as one mounted seam so React's
 * commit ordering is testable. The saver is disarmed before every read. State
 * hydration publishes a completion token; only the later commit may arm, and
 * the ordinary scheduling effect consequently rejects pre-hydration defaults.
 *
 * Transient reads retry on their own timer while remaining unarmed. Invalid
 * stored bytes instead hydrate fresh Home once and arm a new revision.
 */
export function useWorkspaceViewRestoreEffects({
  applyHydration,
  applyPendingTarget,
  authState,
  barrierRef,
  barrierRevision = 0,
  clearTimeoutFn = defaultClearTimeout,
  onInvalidSnapshot = reportInvalidSnapshot,
  onTransientReadError = reportTransientReadError,
  openSessionEntries = [],
  pendingTargetRef,
  profileId = null,
  readSnapshot,
  restoreRetryDelayMs = DEFAULT_RESTORE_RETRY_DELAY_MS,
  rosterRef,
  rosterState = "pending",
  saver,
  scheduleIntent,
  setTimeoutFn = defaultSetTimeout,
} = {}) {
  const restoreSequenceRef = useRef(0);
  const restoreStateRef = useRef({ profileId: null, status: "idle" });
  const retryTimerRef = useRef(null);
  const [hydrationCompletion, setHydrationCompletion] = useState(null);
  const [retryRevision, setRetryRevision] = useState(0);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current == null) return;
    clearTimeoutFn(retryTimerRef.current);
    retryTimerRef.current = null;
  }, [clearTimeoutFn]);

  const restoreForProfile = useCallback(async (nextProfileId, sequence) => {
    const isCurrent = () => {
      const barrier = barrierRef.current.barrier;
      return restoreSequenceRef.current === sequence
        && barrier.state === "reachable"
        && barrier.profile_id === nextProfileId;
    };

    let hydration;
    try {
      const record = await readSnapshot(nextProfileId);
      if (!isCurrent()) return;
      hydration = decideWorkspaceViewHydration({
        record,
        profileId: nextProfileId,
        roster: rosterRef.current,
      });
    } catch (error) {
      if (!isCurrent()) return;
      if (!workspaceViewGetFailureIsInvalidSnapshot(error)) {
        onTransientReadError(error);
        restoreStateRef.current = { profileId: nextProfileId, status: "read-error" };
        clearRetryTimer();
        retryTimerRef.current = setTimeoutFn(() => {
          retryTimerRef.current = null;
          if (!isCurrent()) return;
          setRetryRevision((current) => current + 1);
        }, restoreRetryDelayMs);
        return;
      }
      hydration = freshWorkspaceViewHydration(
        nextProfileId,
        "invalid",
        String(error?.message || error || "Unable to load the workspace view."),
      );
    }

    pendingTargetRef.current = hydration.targetSelectionPending
      ? { profileId: nextProfileId, requestedTarget: hydration.requestedTarget }
      : null;
    if (hydration.source === "invalid" && hydration.reason) {
      onInvalidSnapshot(hydration.reason);
    }
    if (!isCurrent()) return;

    await applyHydration(hydration);
    if (!isCurrent()) return;
    /* This state publication forces a commit containing every hydration setter
       above. The arming effect below cannot run against merely queued state. */
    setHydrationCompletion({ hydration, profileId: nextProfileId, sequence });
  }, [
    applyHydration,
    barrierRef,
    clearRetryTimer,
    onInvalidSnapshot,
    onTransientReadError,
    pendingTargetRef,
    readSnapshot,
    restoreRetryDelayMs,
    rosterRef,
    setTimeoutFn,
  ]);

  useEffect(() => () => clearRetryTimer(), [clearRetryTimer]);

  useEffect(() => {
    if (!profileId) {
      if (restoreStateRef.current.status === "loading"
        || restoreStateRef.current.status === "read-error") {
        restoreSequenceRef.current += 1;
        restoreStateRef.current = { profileId: null, status: "idle" };
        clearRetryTimer();
      }
      return;
    }
    const current = restoreStateRef.current;
    if (current.profileId === profileId && current.status === "complete") return;

    clearRetryTimer();
    const sequence = restoreSequenceRef.current + 1;
    restoreSequenceRef.current = sequence;
    restoreStateRef.current = { profileId, status: "loading" };
    pendingTargetRef.current = null;
    setHydrationCompletion(null);
    /* Fence this profile before reading: the scheduling effect in this commit
       sees an unarmed saver and must discard empty/default presentation state. */
    saver.disarm();
    void restoreForProfile(profileId, sequence);
  }, [
    barrierRevision,
    clearRetryTimer,
    pendingTargetRef,
    profileId,
    restoreForProfile,
    retryRevision,
    saver,
  ]);

  useEffect(() => {
    const completion = hydrationCompletion;
    if (!completion) return;
    const barrier = barrierRef.current.barrier;
    if (restoreSequenceRef.current !== completion.sequence
      || barrier.state !== "reachable"
      || barrier.profile_id !== completion.profileId) {
      return;
    }
    const armArgs = workspaceViewRestoreArmArgs(completion.hydration);
    if (!armArgs) return;
    saver.arm(armArgs);
    restoreStateRef.current = { profileId: completion.profileId, status: "complete" };
  }, [barrierRef, hydrationCompletion, saver]);

  useEffect(() => {
    const pending = pendingTargetRef.current;
    if (!pending || rosterState !== "reachable") return;
    if (pending.profileId !== profileId) {
      pendingTargetRef.current = null;
      return;
    }
    const target = selectWorkspaceRestoreTarget(pending.requestedTarget, openSessionEntries);
    pendingTargetRef.current = null;
    applyPendingTarget(target);
  }, [
    applyPendingTarget,
    openSessionEntries,
    pendingTargetRef,
    profileId,
    rosterState,
  ]);

  useEffect(() => {
    if (authState === "authenticated") return;
    restoreSequenceRef.current += 1;
    restoreStateRef.current = { profileId: null, status: "idle" };
    pendingTargetRef.current = null;
    setHydrationCompletion(null);
    clearRetryTimer();
    saver.disarm();
  }, [authState, clearRetryTimer, pendingTargetRef, saver]);

  useEffect(() => {
    scheduleIntent();
  }, [scheduleIntent]);
}

/*
 * Workspace-view persistence deliberately owns presentation intent only. The
 * serializer constructs the Rust boundary's exact, canonical JSON shape from
 * references; callers cannot accidentally persist session rows, transcripts,
 * process ids, or other runtime state through this seam.
 */

const MAX_PROFILE_ID_BYTES = 512;
const MAX_REFERENCE_BYTES = 4096;
const MAX_OPEN_SESSIONS = 4096;
const MAX_VIEW_JSON_BYTES = 1024 * 1024;
const REVISION_CONFLICT_PREFIX = "Workspace view revision conflict:";
const MAX_CONFLICT_RESYNCS_PER_DELIVERY = 8;
/* Rust str::trim follows Unicode's White_Space property. JavaScript trim()
   has one materially different edge here: it includes U+FEFF and omits
   U+0085, so use the property explicitly to admit exactly Rust-trimmed refs. */
const RUST_EDGE_WHITESPACE = /^\p{White_Space}|\p{White_Space}$/u;

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function rejectUnpairedSurrogates(value, label) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error(`${label} must not contain an unpaired UTF-16 surrogate.`);
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error(`${label} must not contain an unpaired UTF-16 surrogate.`);
    }
  }
}

function requireReference(value, label) {
  if (typeof value !== "string" || value.length === 0 || RUST_EDGE_WHITESPACE.test(value)) {
    throw new Error(`${label} must be a non-empty, already-trimmed string.`);
  }
  rejectUnpairedSurrogates(value, label);
  if (utf8ByteLength(value) > MAX_REFERENCE_BYTES) {
    throw new Error(`${label} may contain at most ${MAX_REFERENCE_BYTES} bytes.`);
  }
  return value;
}

function requireProfileId(value) {
  if (typeof value !== "string" || value.length === 0 || RUST_EDGE_WHITESPACE.test(value)) {
    throw new Error("Profile id must be a non-empty, already-trimmed string.");
  }
  rejectUnpairedSurrogates(value, "Profile id");
  if (utf8ByteLength(value) > MAX_PROFILE_ID_BYTES) {
    throw new Error(`Profile id may contain at most ${MAX_PROFILE_ID_BYTES} bytes.`);
  }
  return value;
}

function requireRevision(value) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Workspace view revision must be null or a positive safe integer.");
  }
  return value;
}

function canonicalActiveTarget(activeTarget) {
  if (!activeTarget || typeof activeTarget !== "object" || Array.isArray(activeTarget)) {
    throw new Error("Workspace view active target must be a presentation target object.");
  }
  if (activeTarget.kind === "session") {
    return {
      kind: "session",
      session_ref: requireReference(activeTarget.sessionRef, "Active session reference"),
    };
  }
  if (activeTarget.kind === "space") {
    return {
      kind: "space",
      space_id: requireReference(activeTarget.spaceId, "Active target space id"),
    };
  }
  if (activeTarget.kind === "home") return { kind: "home" };
  throw new Error("Workspace view active target kind must be 'session', 'space', or 'home'.");
}

/**
 * Serialize to the exact compact bytes accepted by WorkspaceView in Rust.
 * Open-session order is significant and is never sorted.
 */
export function serializeWorkspaceView({
  openSessionRefs,
  activeTarget,
  activeSpaceId,
} = {}) {
  if (!Array.isArray(openSessionRefs)) {
    throw new Error("Workspace view open session references must be an array.");
  }
  if (openSessionRefs.length > MAX_OPEN_SESSIONS) {
    throw new Error(`A workspace view may contain at most ${MAX_OPEN_SESSIONS} open session references.`);
  }
  const seen = new Set();
  const openSessions = openSessionRefs.map((sessionRef) => {
    const validated = requireReference(sessionRef, "Open session reference");
    if (seen.has(validated)) {
      throw new Error(`Open session reference '${validated}' is duplicated.`);
    }
    seen.add(validated);
    return validated;
  });
  const canonicalSpaceId = activeSpaceId === null
    ? null
    : requireReference(activeSpaceId, "Active space id");
  const viewJson = JSON.stringify({
    open_sessions: openSessions,
    active_target: canonicalActiveTarget(activeTarget),
    active_space_id: canonicalSpaceId,
  });
  if (utf8ByteLength(viewJson) > MAX_VIEW_JSON_BYTES) {
    throw new Error(`Workspace view exceeds the ${MAX_VIEW_JSON_BYTES}-byte limit.`);
  }
  return viewJson;
}

function errorText(error) {
  if (typeof error === "string") return error;
  if (typeof error?.message === "string") return error.message;
  if (error?.cause != null && error.cause !== error) return errorText(error.cause);
  return String(error);
}

/* Rust emits exactly:
 *   Workspace view revision conflict: expected 1, current 2.
 * It may arrive from Tauri as either a rejected string or an Error message.
 */
function conflictCurrentRevision(error, attemptedRevision) {
  const text = errorText(error);
  if (!text.startsWith(REVISION_CONFLICT_PREFIX)) {
    return { conflict: false, revision: null };
  }
  const match = text.match(
    /^Workspace view revision conflict: expected (\d+), current (\d+|absent)\.$/,
  );
  if (!match) return { conflict: false, revision: null };
  const expected = Number(match[1]);
  if (!Number.isSafeInteger(expected) || expected !== attemptedRevision) {
    return { conflict: false, revision: null };
  }
  if (match[2] === "absent") return { conflict: true, revision: null };
  const revision = Number(match[2]);
  return Number.isSafeInteger(revision) && revision > 0
    ? { conflict: true, revision }
    : { conflict: false, revision: null };
}

/**
 * A hydration-gated, revision-fenced, last-state-wins workspace-view saver.
 *
 * `save` is the injected workspace_view_save seam. It receives snake_case
 * command arguments and must resolve to the saved record (including revision).
 */
export function createWorkspaceViewSaver({
  save,
  onError = () => {},
  debounceMs = 200,
  setTimeoutFn = (...args) => globalThis.setTimeout(...args),
  clearTimeoutFn = (...args) => globalThis.clearTimeout(...args),
} = {}) {
  if (typeof save !== "function") {
    throw new Error("A workspace view saver requires a save function.");
  }
  if (typeof onError !== "function") {
    throw new Error("Workspace view saver onError must be a function.");
  }
  if (!Number.isFinite(debounceMs) || debounceMs < 0) {
    throw new Error("Workspace view saver debounceMs must be a non-negative number.");
  }

  let armed = false;
  let profileId = null;
  let revision = null;
  let generation = 0;
  let pending = null;
  let timer = null;
  let inFlight = null;
  let inFlightGeneration = null;

  const clearTimer = () => {
    if (timer == null) return;
    clearTimeoutFn(timer);
    timer = null;
  };

  const isCurrent = (payload) => (
    armed
    && payload.generation === generation
    && payload.profileId === profileId
  );

  const deliver = () => {
    if (inFlight) return inFlight;
    if (!pending) return Promise.resolve();

    inFlightGeneration = generation;
    inFlight = (async () => {
      let conflictResyncs = 0;
      while (pending) {
        const payload = pending;
        pending = null;
        if (!isCurrent(payload)) continue;
        inFlightGeneration = payload.generation;

        const args = {
          profile_id: payload.profileId,
          view_json: payload.viewJson,
          expected_revision: revision,
        };
        try {
          const record = await save(args);
          if (!isCurrent(payload)) continue;
          revision = requireRevision(record?.revision);
          if (revision === null) {
            throw new Error("workspace_view_save returned no saved revision.");
          }
          conflictResyncs = 0;
        } catch (error) {
          if (!isCurrent(payload)) continue;
          const conflict = conflictCurrentRevision(error, args.expected_revision);
          if (conflict.conflict && conflictResyncs < MAX_CONFLICT_RESYNCS_PER_DELIVERY) {
            revision = conflict.revision;
            pending = pending ?? payload;
            conflictResyncs += 1;
            continue;
          }
          /* A newer payload scheduled during the failed write remains the
             truth. Otherwise restore the failed payload for flush/schedule. */
          pending = pending ?? payload;
          onError(error, args);
          break;
        }
      }
    })().finally(() => {
      inFlight = null;
      inFlightGeneration = null;
    });
    return inFlight;
  };

  return {
    /* Arm only after workspace_view_get has resolved for this exact profile.
       null revision explicitly means the restored profile has no stored row. */
    arm(restored = {}) {
      const nextProfileId = requireProfileId(restored.profileId);
      if (!("revision" in restored)) {
        throw new Error("Arming workspace view persistence requires a restored revision.");
      }
      const nextRevision = requireRevision(restored.revision);
      generation += 1;
      clearTimer();
      pending = null;
      profileId = nextProfileId;
      revision = nextRevision;
      armed = true;
    },

    disarm() {
      generation += 1;
      clearTimer();
      pending = null;
      profileId = null;
      revision = null;
      armed = false;
    },

    schedule(payload) {
      /* This check is intentionally before serialization/validation. During
         hydration, renders may contain defaults; they must be dropped without
         retaining even a canonicalized snapshot. */
      if (!armed || payload?.profileId !== profileId) return false;
      const viewJson = serializeWorkspaceView(payload);
      pending = {
        generation,
        profileId,
        viewJson,
      };
      clearTimer();
      timer = setTimeoutFn(() => {
        timer = null;
        void deliver();
      }, debounceMs);
      return true;
    },

    async flush() {
      if (!armed) return;
      clearTimer();
      /* Await an older generation too: it cannot mutate current state, but
         serializing the injected save calls avoids revision races at the seam. */
      if (inFlight) await inFlight;
      if (!armed || !pending) return;
      await deliver();
    },

    hasPending() {
      return Boolean(
        armed
        && (pending?.generation === generation || inFlightGeneration === generation),
      );
    },

    isArmed() {
      return armed;
    },

    getRevision() {
      return armed ? revision : null;
    },
  };
}

/* pagehide cannot be awaited by the browser, but flush() starts the injected
 * save immediately and is also directly awaitable by a mediated close path. */
export function bindWorkspaceViewPagehide(saver, target = globalThis.window) {
  if (!saver || typeof saver.flush !== "function") {
    throw new Error("A pagehide binding requires a workspace view saver.");
  }
  if (!target || typeof target.addEventListener !== "function"
    || typeof target.removeEventListener !== "function") {
    throw new Error("A pagehide binding requires an event target.");
  }
  const onPagehide = () => { void saver.flush(); };
  target.addEventListener("pagehide", onPagehide);
  return () => target.removeEventListener("pagehide", onPagehide);
}

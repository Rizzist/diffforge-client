export const FEATURE_QUEUE_CONTROL_V1 = "queue_control_v1";

const DELIVERY_MODES = new Set(["queue", "steer", "subturn"]);
const REMOVING_CHANGES = new Set(["removed", "promoted_steer", "consumed"]);

function safeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function reasonText(value, fallback) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value.message === "string" && value.message.trim()) {
    return value.message.trim();
  }
  return fallback;
}

function withRuntime(state, fields = {}) {
  return {
    ...state,
    listInFlight: fields.listInFlight ?? state.listInFlight ?? false,
    bufferedDeltas: fields.bufferedDeltas ?? state.bufferedDeltas ?? [],
  };
}

export function unsupportedQueueState() {
  return {
    kind: "unsupported",
    revision: null,
    rows: [],
    reason: "",
    listInFlight: false,
    bufferedDeltas: [],
  };
}

export function unknownQueueState(reason = "Queue state has not been loaded.") {
  return {
    kind: "unknown",
    revision: null,
    rows: [],
    reason: reasonText(reason, "Queue state is unknown."),
    listInFlight: false,
    bufferedDeltas: [],
  };
}

export function queueStateForFeatures(features) {
  return Array.isArray(features) && features.includes(FEATURE_QUEUE_CONTROL_V1)
    ? unknownQueueState()
    : unsupportedQueueState();
}

function normalizeQueueRow(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.id !== "string" || !value.id) return null;
  if (typeof value.text !== "string") return null;
  if (!DELIVERY_MODES.has(value.mode)) return null;
  if (!Number.isSafeInteger(value.ordinal) || value.ordinal < 1) return null;
  if (!Number.isSafeInteger(value.created_at_ms) || value.created_at_ms < 0) return null;
  return {
    id: value.id,
    /* Render-complete law: do not trim, normalize, or reconstruct this. */
    text: value.text,
    mode: value.mode,
    ordinal: value.ordinal,
    created_at_ms: value.created_at_ms,
  };
}

function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const revision = safeRevision(snapshot.revision);
  if (revision == null || !Array.isArray(snapshot.rows)) return null;
  const rows = snapshot.rows.map(normalizeQueueRow);
  if (rows.some((row) => row == null)) return null;
  const ids = new Set();
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (ids.has(row.id) || row.ordinal !== index + 1) return null;
    ids.add(row.id);
  }
  return { revision, rows };
}

function normalizedDelta(delta, envelopeSeq) {
  if (!delta || typeof delta !== "object" || Array.isArray(delta)) return null;
  if (delta.type != null && delta.type !== "queue_changed") return null;
  const revision = safeRevision(delta.revision);
  if (revision == null) return null;
  if (envelopeSeq != null && safeRevision(envelopeSeq) !== revision) return null;
  const change = delta.change;
  if (!change || typeof change !== "object" || Array.isArray(change)) return null;
  if (change.kind === "enqueued") {
    const row = normalizeQueueRow(change.row);
    return row ? { revision, change: { kind: "enqueued", row } } : null;
  }
  if (REMOVING_CHANGES.has(change.kind)) {
    return typeof change.id === "string" && change.id
      ? { revision, change: { kind: change.kind, id: change.id } }
      : null;
  }
  return null;
}

function authoritativeState(revision, rows) {
  return {
    kind: rows.length ? "rows" : "empty",
    revision,
    rows,
    reason: "",
    listInFlight: false,
    bufferedDeltas: [],
  };
}

export function queueListStarted(state) {
  if (state?.kind === "unsupported" || state?.listInFlight) return state;
  return withRuntime(state || unknownQueueState(), {
    listInFlight: true,
    bufferedDeltas: [],
  });
}

export function queueListFailed(state, reason) {
  if (state?.kind === "unsupported") return state;
  return unknownQueueState(reasonText(reason, "Unable to read the held queue."));
}

function applyNormalizedDelta(state, delta) {
  if (delta.revision <= state.revision) {
    return { state, outcome: "stale", relist: false };
  }
  const rows = state.rows;
  if (delta.change.kind === "enqueued") {
    const row = delta.change.row;
    if (rows.some((candidate) => candidate.id === row.id)
      || row.ordinal !== rows.length + 1) {
      return {
        state: unknownQueueState("Queue delta did not follow the authoritative row order."),
        outcome: "malformed",
        relist: true,
      };
    }
    return {
      state: authoritativeState(delta.revision, [...rows, row]),
      outcome: "applied",
      relist: false,
    };
  }

  const removedIndex = rows.findIndex((row) => row.id === delta.change.id);
  if (removedIndex < 0) {
    return {
      state: unknownQueueState("Queue delta named a row outside the authoritative snapshot."),
      outcome: "malformed",
      relist: true,
    };
  }
  const nextRows = rows
    .filter((_, index) => index !== removedIndex)
    .map((row, index) => ({ ...row, ordinal: index + 1 }));
  return {
    state: authoritativeState(delta.revision, nextRows),
    outcome: "applied",
    relist: false,
  };
}

export function queueListSucceeded(state, snapshot) {
  if (state?.kind === "unsupported") {
    return { state, outcome: "unsupported", relist: false };
  }
  const normalized = normalizeSnapshot(snapshot);
  if (!normalized) {
    return {
      state: unknownQueueState("Malformed queue.list response."),
      outcome: "malformed",
      relist: true,
    };
  }
  let result = {
    state: authoritativeState(normalized.revision, normalized.rows),
    outcome: "installed",
    relist: false,
  };
  for (const delta of state?.bufferedDeltas || []) {
    result = applyNormalizedDelta(result.state, delta);
    if (result.relist) return result;
  }
  return result;
}

/* Queue revisions live in the session-event sequence space and may skip when
   non-queue events commit. Only the attachment layer can report a real gap;
   callers pass that signal explicitly instead of inferring it from revision
   arithmetic. */
export function applyQueueDelta(state, delta, {
  envelopeSeq = null,
  streamGap = false,
} = {}) {
  if (state?.kind === "unsupported") {
    return { state, outcome: "unsupported", relist: false };
  }
  if (streamGap) {
    return {
      state: unknownQueueState("The session watch has a sequence gap; re-reading the queue."),
      outcome: "gap",
      relist: true,
    };
  }
  const normalized = normalizedDelta(delta, envelopeSeq);
  if (!normalized) {
    return {
      state: unknownQueueState("Malformed QueueChanged payload."),
      outcome: "malformed",
      relist: true,
    };
  }
  if (state?.listInFlight) {
    const buffered = state.bufferedDeltas || [];
    const lastRevision = buffered.length
      ? buffered[buffered.length - 1].revision
      : safeRevision(state.revision);
    if (lastRevision != null && normalized.revision <= lastRevision) {
      return { state, outcome: "stale", relist: false };
    }
    return {
      state: withRuntime(state, { bufferedDeltas: [...buffered, normalized] }),
      outcome: "buffered",
      relist: false,
    };
  }
  if (state?.kind !== "empty" && state?.kind !== "rows") {
    return {
      state: unknownQueueState("Queue delta arrived without an authoritative list snapshot."),
      outcome: "needs_relist",
      relist: true,
    };
  }
  return applyNormalizedDelta(state, normalized);
}

export function queueStreamGap(state, reason = "The session watch lost events.") {
  if (state?.kind === "unsupported") return state;
  return unknownQueueState(reason);
}

export function queuePresentation(state) {
  switch (state?.kind) {
    case "unsupported":
      return { kind: "unsupported", renderQueue: false, empty: false, rows: [], reason: "" };
    case "empty":
      return { kind: "empty", renderQueue: true, empty: true, rows: [], reason: "" };
    case "rows":
      return { kind: "rows", renderQueue: true, empty: false, rows: state.rows, reason: "" };
    default:
      return {
        kind: "unknown",
        renderQueue: true,
        empty: false,
        rows: [],
        reason: reasonText(state?.reason, "Queue state is unknown."),
      };
  }
}

function responseBody(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value.body && typeof value.body === "object" ? value.body : value;
}

export function revisionConflictData(error) {
  const body = responseBody(error);
  const data = body?.data;
  if (body?.code !== "revision_conflict"
    || !data
    || data.kind !== "revision_conflict"
    || safeRevision(data.current_revision) == null) {
    return null;
  }
  return {
    expectedRevision: safeRevision(data.expected_revision),
    currentRevision: data.current_revision,
  };
}

export function createQueueInvokeBoundary(invokeCommand) {
  const mutation = (command, { sessionId, id, revision }) => invokeCommand(command, {
    session_id: sessionId,
    id,
    revision,
  });
  return {
    list: ({ sessionId }) => invokeCommand("queue_list", { session_id: sessionId }),
    remove: (args) => mutation("queue_remove", args),
    promoteSteer: (args) => mutation("queue_promote_steer", args),
  };
}

function applyMutationReceipt(state, action, id, response) {
  const body = responseBody(response);
  const revision = safeRevision(body?.revision);
  if (revision == null || body?.id !== id) {
    return unknownQueueState(`Malformed queue.${action} response.`);
  }
  if ((state.kind !== "rows" && state.kind !== "empty") || revision <= state.revision) {
    return unknownQueueState(`Stale queue.${action} response.`);
  }
  const rows = state.rows
    .filter((row) => row.id !== id)
    .map((row, index) => ({ ...row, ordinal: index + 1 }));
  return authoritativeState(revision, rows);
}

/* Conflict retry law for a stable row id. The typed conflict's current
   revision proves only that our fence is stale; it is never copied into the
   retry. Every retry revision comes from a successful fresh queue.list, and
   the retry is skipped if that same stable id is no longer present. */
export async function mutateQueueRowWithRetry({
  boundary,
  sessionId,
  id,
  action,
  state,
  maxRetries = 1,
}) {
  if (!boundary || !["remove", "promoteSteer"].includes(action)) {
    throw new TypeError("A queue mutation boundary and known action are required.");
  }
  if (state?.kind !== "rows" || !state.rows.some((row) => row.id === id)) {
    return { status: "missing", state, attempts: 0 };
  }

  let working = state;
  let attempts = 0;
  let retries = 0;
  while (true) {
    attempts += 1;
    try {
      const response = await boundary[action]({
        sessionId,
        id,
        revision: working.revision,
      });
      return {
        status: "mutated",
        state: applyMutationReceipt(working, action, id, response),
        attempts,
        response,
      };
    } catch (error) {
      if (!revisionConflictData(error)) throw error;

      let snapshot;
      try {
        snapshot = await boundary.list({ sessionId });
      } catch (listError) {
        return {
          status: "unknown",
          state: queueListFailed(working, listError),
          attempts,
          error: listError,
        };
      }
      const refreshed = queueListSucceeded(queueListStarted(working), snapshot);
      working = refreshed.state;
      if (refreshed.relist || working.kind === "unknown") {
        return { status: "unknown", state: working, attempts, error };
      }
      if (working.kind !== "rows" || !working.rows.some((row) => row.id === id)) {
        return { status: "gone", state: working, attempts };
      }
      if (retries >= maxRetries) {
        return { status: "conflict", state: working, attempts, error };
      }
      retries += 1;
    }
  }
}

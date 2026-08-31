import { shellRowView } from "./shellModel.js";

const KNOWN_STREAMS = new Set(["stdout", "stderr"]);
const OUTPUT_CHUNK_CAP = 1_000;
const PTY_STATE_EVENT = ["shell", "state"].join("-");
const PTY_CLOSED_EVENT = ["shell", "closed"].join("-");
const PUBLISHED_STATE_EVENTS = new Set([PTY_STATE_EVENT, PTY_CLOSED_EVENT]);

export const SSH_PTY_TRANSIENT_MARKER =
  "[connection-transient] output before this point was not captured.";

function transientBuffer(entries, subscriptionId, bufferDiscarded = false) {
  return {
    delivery: "connection_transient",
    replayable: false,
    complete: false,
    startsAt: "subscription_start",
    priorOutputCaptured: false,
    marker: SSH_PTY_TRANSIENT_MARKER,
    subscriptionId,
    bufferDiscarded,
    entries,
  };
}

function appendOutput(previous, chunk, subscriptionId) {
  let entries = [...(previous?.entries || []), chunk];
  let bufferDiscarded = previous?.bufferDiscarded === true;
  if (entries.length > OUTPUT_CHUNK_CAP) {
    entries = entries.slice(-OUTPUT_CHUNK_CAP);
    bufferDiscarded = true;
  }
  return transientBuffer(entries, subscriptionId, bufferDiscarded);
}

function transportSignal(payload) {
  if (payload?.state === "reachable"
    && typeof payload.profile_id === "string"
    && payload.profile_id.length > 0
    && Number.isSafeInteger(payload.daemon_generation)
    && payload.daemon_generation >= 0) {
    return {
      phase: "reachable",
      profileId: payload.profile_id,
      daemonGeneration: payload.daemon_generation,
    };
  }
  if (payload?.state === "pending" || payload?.state === "unreachable") {
    return { phase: "interrupted", profileId: null, daemonGeneration: null };
  }
  return null;
}

function startsNewCapture(previous, next, hasBufferedOutput) {
  if (previous == null) return next.phase === "interrupted" && hasBufferedOutput;
  if (next.phase === "interrupted") return previous.phase === "reachable";
  if (previous.phase === "interrupted") return false;
  return previous.profileId !== next.profileId
    || previous.daemonGeneration !== next.daemonGeneration;
}

function newCaptureBoundary(current, transport = current.transport) {
  return {
    ...current,
    outputByShell: {},
    subscriptionId: current.subscriptionId + 1,
    transport,
  };
}

export function createPtyCaptureState() {
  return {
    outputByShell: {},
    subscriptionId: 0,
    transport: null,
  };
}

/* Output and published transport signals share one reducer so callback order is
   the capture order. A disconnect or changed daemon generation resets the old
   bytes before a later output action can enter the new subscription. */
export function reducePtyCaptureState(current = createPtyCaptureState(), action = {}) {
  if (action.type === "listener-boundary") return newCaptureBoundary(current);

  if (action.type === "transport-published") {
    const nextTransport = transportSignal(action.payload);
    if (nextTransport == null) return current;
    const hasBufferedOutput = Object.keys(current.outputByShell).length > 0;
    return startsNewCapture(current.transport, nextTransport, hasBufferedOutput)
      ? newCaptureBoundary(current, nextTransport)
      : { ...current, transport: nextTransport };
  }

  if (action.type === "output") {
    const chunk = action.chunk;
    if (chunk?.shellId == null) return current;
    return {
      ...current,
      outputByShell: {
        ...current.outputByShell,
        [chunk.shellId]: appendOutput(
          current.outputByShell[chunk.shellId],
          chunk,
          current.subscriptionId,
        ),
      },
    };
  }

  return current;
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function measuredSize(size) {
  if (!Number.isInteger(size?.cols) || size.cols < 1
    || !Number.isInteger(size?.rows) || size.rows < 1) {
    throw new TypeError("PTY size must contain measured positive integer cols and rows.");
  }
  return { cols: size.cols, rows: size.rows };
}

function profileName(profile) {
  return requiredText(
    typeof profile === "string" ? profile : profile?.name,
    "SSH profile name",
  );
}

/* The daemon owns every credential. Opening sends only the selected public
   profile name, terminal identity, and a real measured grid. session_id is
   intentionally omitted: this profile-manager surface opens an app-level
   saved-profile shell. */
export function openArgs(profile, term, size) {
  return {
    name: profileName(profile),
    term: requiredText(term, "Terminal type"),
    size: measuredSize(size),
  };
}

export function resizeArgs(id, size) {
  return {
    id: requiredText(id, "Shell id"),
    size: measuredSize(size),
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return globalThis.btoa(binary);
}

/* xterm's onData value is not trimmed, line-buffered, edited, or echoed.
   UTF-8/base64 is only the pinned daemon wire envelope. */
export function inputArgs(id, data) {
  if (typeof data !== "string") {
    throw new TypeError("PTY input must be the string emitted by xterm.");
  }
  return {
    id: requiredText(id, "Shell id"),
    data_b64: bytesToBase64(new TextEncoder().encode(data)),
  };
}

function base64Bytes(value) {
  if (typeof value !== "string") return null;
  try {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
}

function streamView(stream) {
  const raw = typeof stream === "string"
    ? stream
    : typeof stream?.raw === "string"
      ? stream.raw
      : null;
  return {
    raw,
    recognized: raw != null && KNOWN_STREAMS.has(raw),
    label: raw == null ? "not published" : raw,
  };
}

/* A chunk is exactly the bytes delivered by the output push on this connection.
   The view carries no cursor, replay promise, synthetic text, or completeness
   claim; xterm receives the decoded bytes directly. */
export function outputChunkView(payload) {
  const bytes = base64Bytes(payload?.chunk_b64);
  return {
    shellId: typeof payload?.id === "string" && payload.id.length > 0
      ? payload.id
      : null,
    stream: streamView(payload?.stream),
    bytes,
    decoded: bytes != null,
    delivery: "connection_transient",
    replayable: false,
    complete: false,
    priorOutputCaptured: false,
  };
}

function absentState() {
  return {
    kind: "absent",
    raw: null,
    label: "not published",
    recognized: false,
  };
}

/* Lifecycle is eligible for display only when it arrived through one of the
   two published PTY lifecycle events. Passing an open/eof/resize/input receipt
   without an event name deliberately produces an absent state. */
export function ptyStateView(payload, sourceEvent = null) {
  const published = PUBLISHED_STATE_EVENTS.has(sourceEvent);
  const source = payload?.shell ?? payload?.row ?? payload;
  const row = shellRowView(source);
  const state = published ? row.state : absentState();
  return {
    shellId: row.id,
    sourceEvent: published ? sourceEvent : null,
    published,
    state,
    label: state.raw == null
      ? "not published"
      : state.recognized
        ? state.raw
        : `${state.raw} (unrecognized)`,
    closed: published && (
      sourceEvent === PTY_CLOSED_EVENT
      || state.raw === "closed"
      || state.raw === "exited"
    ),
  };
}

import { createCoreRepoNameDisplayMasker } from "../coreRepoNameDisplay.js";
import { stripLiveViewControlSequences } from "../liveViewSanitizer.js";

const ACTIVE_FLUSH_MS = 8;
const BACKGROUND_FLUSH_MS = 120;
const ACTIVE_FRAME_BYTES = 16 * 1024;
const BACKGROUND_FRAME_BYTES = ACTIVE_FRAME_BYTES;
const INSPECTION_TEXT_LIMIT = 2400;
const INITIAL_INSPECTION_CHUNKS = 80;
const TRANSPORT_DOOMED_SOCKET_GRACE_MS = 8_000;

const sessions = new Map();

function createSession(id, options = {}) {
  return {
    active: false,
    decoder: null,
    flushTimer: 0,
    id,
    inspectChunks: 0,
    masker: createCoreRepoNameDisplayMasker({
      coreRepoPath: options.coreRepoPath || "",
      functionalRepoPath: options.functionalRepoPath || "",
    }),
    outputChunks: 0,
    queue: [],
    queuedBytes: 0,
    scheduledAt: 0,
    transportInspect: false,
    transportSocket: null,
  };
}

function getSession(id) {
  let session = sessions.get(id);
  if (!session) {
    session = createSession(id);
    sessions.set(id, session);
  }
  return session;
}

function exactUint8Array(data) {
  if (data instanceof Uint8Array) {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
      return data;
    }
    return data.slice();
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
  }
  return new Uint8Array(0);
}

function visibleByteEstimate(data, limit = Number.POSITIVE_INFINITY) {
  let visible = 0;
  for (let index = 0; index < data.byteLength; index += 1) {
    const byte = data[index];
    if (byte >= 0x20 && byte !== 0x7f) {
      visible += 1;
      if (visible >= limit) {
        return visible;
      }
    }
  }
  return visible;
}

function takeInspectionText(session, data, shouldInspect) {
  if (!shouldInspect || session.inspectChunks >= INITIAL_INSPECTION_CHUNKS) {
    return "";
  }
  session.inspectChunks += 1;
  if (!session.decoder) {
    session.decoder = new TextDecoder("utf-8", { fatal: false });
  }
  const decoded = session.decoder.decode(data, { stream: true });
  const visible = stripLiveViewControlSequences(decoded);
  return visible.length > INSPECTION_TEXT_LIMIT
    ? visible.slice(-INSPECTION_TEXT_LIMIT)
    : visible;
}

function scheduleFlush(session) {
  if (session.flushTimer) {
    return;
  }
  const delay = session.active ? ACTIVE_FLUSH_MS : BACKGROUND_FLUSH_MS;
  session.scheduledAt = performance.now();
  session.flushTimer = setTimeout(() => {
    session.flushTimer = 0;
    flushSession(session);
  }, delay);
}

function flushSession(session) {
  if (!session.queue.length) {
    return;
  }

  const budget = session.active ? ACTIVE_FRAME_BYTES : BACKGROUND_FRAME_BYTES;
  const batch = [];
  let batchBytes = 0;
  let inputBytes = 0;
  let visibleChars = 0;
  let sourceChunks = 0;
  let inspectionText = "";

  while (session.queue.length && batchBytes < budget) {
    const next = session.queue[0];
    const remainingBudget = budget - batchBytes;
    if (next.data.byteLength <= remainingBudget) {
      session.queue.shift();
      batch.push(next.data);
      batchBytes += next.data.byteLength;
      inputBytes += next.input_bytes;
      visibleChars += next.visible_chars;
      sourceChunks += next.source_chunks;
      inspectionText = `${inspectionText}${next.inspection_text || ""}`.slice(-INSPECTION_TEXT_LIMIT);
      continue;
    }

    const head = next.data.slice(0, remainingBudget);
    const tail = next.data.slice(remainingBudget);
    const splitRatio = remainingBudget / Math.max(1, next.data.byteLength);
    batch.push(head);
    batchBytes += head.byteLength;
    inputBytes += Math.round(next.input_bytes * splitRatio);
    visibleChars += visibleByteEstimate(head, 1);
    sourceChunks += 1;
    next.data = tail;
    next.input_bytes = Math.max(0, next.input_bytes - Math.round(next.input_bytes * splitRatio));
    next.visible_chars = visibleByteEstimate(tail, 1);
    next.inspection_text = "";
  }

  session.queuedBytes = Math.max(0, session.queuedBytes - batchBytes);
  if (!batchBytes) {
    scheduleFlush(session);
    return;
  }

  const output = new Uint8Array(batchBytes);
  let offset = 0;
  for (const data of batch) {
    output.set(data, offset);
    offset += data.byteLength;
  }

  postMessage({
    active: session.active,
    data: output.buffer,
    displayBytes: output.byteLength,
    id: session.id,
    input_bytes: inputBytes,
    inspection_text: inspectionText,
    source_chunks: sourceChunks,
    type: "output",
    visible_chars: visibleChars,
    workerQueueBytes: session.queuedBytes,
    worker_scheduled_delay_ms: session.scheduledAt
      ? performance.now() - session.scheduledAt
      : 0,
  }, [output.buffer]);

  if (session.queue.length) {
    scheduleFlush(session);
  }
}

function enqueueChunk(id, rawData, options = {}) {
  const session = getSession(id);
  session.active = options.active === true;
  const startedAt = performance.now();
  const rawBytes = rawData.byteLength;
  if (!rawBytes) {
    return;
  }

  const masked = exactUint8Array(session.masker.maskBytes(rawData));
  if (!masked.byteLength) {
    return;
  }

  session.outputChunks += 1;
  const shouldInspect = options.inspect === true;
  const inspectionText = takeInspectionText(session, masked, shouldInspect);
  const visibleChars = visibleByteEstimate(masked, 1);
  session.queue.push({
    data: masked,
    input_bytes: rawBytes,
    inspection_text: inspectionText,
    source_chunks: 1,
    visible_chars: visibleChars,
  });
  session.queuedBytes += masked.byteLength;

  if (
    session.queuedBytes >= (session.active ? ACTIVE_FRAME_BYTES : BACKGROUND_FRAME_BYTES)
    || performance.now() - startedAt >= 4
  ) {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = 0;
    }
    flushSession(session);
  } else {
    scheduleFlush(session);
  }
}

function closeSessionTransport(session) {
  if (!session?.transportSocket) {
    return;
  }
  const socket = session.transportSocket;
  session.transportSocket = null;
  try {
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    if (socket.readyState === WebSocket.CONNECTING) {
      // Aborting a CONNECTING socket makes WebKit log a failed-connection
      // console error on every optimistic workspace close. The transport
      // listener is app-global and outlives the workspace, so let the
      // handshake finish and close cleanly. A grace timer bounds doomed
      // sockets when the endpoint is genuinely dead so rapid open/close
      // cycling cannot accumulate CONNECTING sockets indefinitely.
      const graceTimer = setTimeout(() => {
        if (socket.readyState === WebSocket.CONNECTING) {
          try {
            socket.close();
          } catch (_error) {
            // Best effort only.
          }
        }
      }, TRANSPORT_DOOMED_SOCKET_GRACE_MS);
      socket.onclose = () => {
        clearTimeout(graceTimer);
      };
      socket.onopen = () => {
        clearTimeout(graceTimer);
        try {
          socket.close();
        } catch (_error) {
          // Best effort only.
        }
      };
      return;
    }
    socket.onopen = null;
    socket.close();
  } catch (_error) {
    // Best effort only.
  }
}

function connectTransport(message = {}) {
  const id = String(message.id || "");
  const endpoint = message.endpoint || {};
  if (!id || !endpoint.url || !endpoint.token || !message.pane_id || !message.instance_id) {
    postMessage({
      error: "Terminal output transport connection request is incomplete.",
      id,
      type: "transport-error",
    });
    return;
  }

  // Lookup only — never recreate: a dispose that raced an in-flight endpoint
  // resolution used to resurrect the session here and subscribe a socket
  // nobody owned.
  const session = sessions.get(id);
  if (!session) {
    postMessage({
      error: "Terminal output transport session is not registered.",
      id,
      type: "transport-error",
    });
    return;
  }
  closeSessionTransport(session);
  session.active = message.active === true;
  session.transportInspect = message.inspect === true;

  let socket = null;
  try {
    socket = new WebSocket(endpoint.url);
    socket.binaryType = "arraybuffer";
  } catch (error) {
    postMessage({
      error: error?.message || String(error || "Unable to create terminal output transport."),
      id,
      type: "transport-error",
    });
    return;
  }

  session.transportSocket = socket;

  socket.onopen = () => {
    try {
      socket.send(JSON.stringify({
        id,
        instance_id: message.instance_id,
        pane_id: message.pane_id,
        token: endpoint.token,
        type: "subscribe",
      }));
    } catch (error) {
      postMessage({
        error: error?.message || String(error || "Unable to subscribe terminal output transport."),
        id,
        type: "transport-error",
      });
    }
  };

  socket.onmessage = (event) => {
    if (typeof event.data === "string") {
      try {
        const payload = JSON.parse(event.data);
        if (payload?.type === "ready") {
          postMessage({ id, type: "transport-ready" });
        }
      } catch (_error) {
        // Non-control text is ignored; terminal bytes are sent as binary frames.
      }
      return;
    }

    const data = event.data instanceof ArrayBuffer
      ? new Uint8Array(event.data)
      : ArrayBuffer.isView(event.data)
        ? new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength)
        : new Uint8Array(0);
    if (!data.byteLength) {
      return;
    }
    enqueueChunk(id, data, {
      active: session.active === true,
      inspect: session.transportInspect === true,
    });
  };

  socket.onerror = () => {
    if (session.transportSocket === socket) {
      postMessage({
        error: "Terminal output transport socket failed.",
        id,
        type: "transport-error",
      });
    }
  };

  socket.onclose = () => {
    if (session.transportSocket === socket) {
      session.transportSocket = null;
      postMessage({ id, type: "transport-closed" });
    }
  };
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "register") {
    // Re-registering an id must not leak the previous session's live socket
    // or its pending flush timer.
    const previous = sessions.get(message.id);
    if (previous) {
      if (previous.flushTimer) {
        clearTimeout(previous.flushTimer);
      }
      closeSessionTransport(previous);
    }
    const session = createSession(message.id, message);
    sessions.set(message.id, session);
    return;
  }

  if (message.type === "dispose") {
    const session = sessions.get(message.id);
    if (session?.flushTimer) {
      clearTimeout(session.flushTimer);
    }
    closeSessionTransport(session);
    sessions.delete(message.id);
    return;
  }

  if (message.type === "paths") {
    const session = getSession(message.id);
    session.masker.setPaths({
      coreRepoPath: message.coreRepoPath || "",
      functionalRepoPath: message.functionalRepoPath || "",
    });
    return;
  }

  if (message.type === "priority") {
    const session = getSession(message.id);
    session.active = message.active === true;
    if (session.active && session.queue.length) {
      if (session.flushTimer) {
        clearTimeout(session.flushTimer);
        session.flushTimer = 0;
      }
      flushSession(session);
    }
    return;
  }

  if (message.type === "connectTransport") {
    connectTransport(message);
    return;
  }

  if (message.type === "chunk") {
    enqueueChunk(message.id, new Uint8Array(message.data), {
      active: message.active === true,
      inspect: message.inspect === true,
    });
  }
};

import { createCoreRepoNameDisplayMasker } from "../coreRepoNameDisplay.js";
import { stripLiveViewControlSequences } from "../liveViewSanitizer.js";

const ACTIVE_FLUSH_MS = 8;
const BACKGROUND_FLUSH_MS = 260;
const BACKGROUND_HOT_FLUSH_MS = 900;
const ACTIVE_FRAME_BYTES = 24 * 1024;
const BACKGROUND_FRAME_BYTES = 4 * 1024;
const BACKGROUND_HOT_FRAME_BYTES = 2 * 1024;
const BACKGROUND_SNAPSHOT_FRAME_BYTES = 64 * 1024;
const ACTIVE_MAX_QUEUE_BYTES = 2 * 1024 * 1024;
const BACKGROUND_MAX_QUEUE_BYTES = 512 * 1024;
const BACKGROUND_HOT_MAX_QUEUE_BYTES = 192 * 1024;
const BACKGROUND_FLUSH_QUEUE_BYTES = 256 * 1024;
const ACTIVE_MAX_IN_FLIGHT_BYTES = 128 * 1024;
const ACTIVE_MAX_IN_FLIGHT_FRAMES = 6;
const BACKGROUND_MAX_IN_FLIGHT_BYTES = 16 * 1024;
const BACKGROUND_MAX_IN_FLIGHT_FRAMES = 2;
const BACKGROUND_SNAPSHOT_MAX_IN_FLIGHT_BYTES = 128 * 1024;
const BACKGROUND_SNAPSHOT_MAX_IN_FLIGHT_FRAMES = 2;
const INSPECTION_TEXT_LIMIT = 2400;
const INITIAL_INSPECTION_CHUNKS = 80;
const DIRTY_BATCH_ACTIVE_FLUSH_MS = 4;
const DIRTY_BATCH_BACKGROUND_FLUSH_MS = 16;

const sessions = new Map();
const pendingDirtyNotifications = new Map();
let dirtyBatchTimer = 0;
let dirtyBatchDueAt = 0;

function createSession(id, options = {}) {
  return {
    active: false,
    decoder: new TextDecoder("utf-8", { fatal: false }),
    dirtyNotified: false,
    droppedBytes: 0,
    droppedChunks: 0,
    flushTimer: 0,
    generation: 0,
    id,
    inFlightBytes: 0,
    inFlightFrames: 0,
    inputHotUntil: 0,
    inspectChunks: 0,
    masker: createCoreRepoNameDisplayMasker({
      coreRepoPath: options.coreRepoPath || "",
      functionalRepoPath: options.functionalRepoPath || "",
    }),
    nextFrameId: 1,
    outputChunks: 0,
    pendingFlushAfterAck: false,
    queue: [],
    queuedBytes: 0,
    scheduledAt: 0,
    snapshotDrainMode: false,
    transportInspect: false,
    transportSocket: null,
    transportState: "idle",
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
  const decoded = session.decoder.decode(data, { stream: true });
  const visible = stripLiveViewControlSequences(decoded);
  return visible.length > INSPECTION_TEXT_LIMIT
    ? visible.slice(-INSPECTION_TEXT_LIMIT)
    : visible;
}

function getMaxQueueBytes(session) {
  if (session.active) {
    return ACTIVE_MAX_QUEUE_BYTES;
  }
  const inputHot = Date.now() < Number(session.inputHotUntil || 0);
  return inputHot ? BACKGROUND_HOT_MAX_QUEUE_BYTES : BACKGROUND_MAX_QUEUE_BYTES;
}

function getSessionFrameBytes(session) {
  if (session.active) {
    return ACTIVE_FRAME_BYTES;
  }
  if (session.snapshotDrainMode) {
    return BACKGROUND_SNAPSHOT_FRAME_BYTES;
  }
  const inputHot = Date.now() < Number(session.inputHotUntil || 0);
  return inputHot ? BACKGROUND_HOT_FRAME_BYTES : BACKGROUND_FRAME_BYTES;
}

function trimSessionQueue(session) {
  const maxQueueBytes = getMaxQueueBytes(session);
  if (!maxQueueBytes || session.queuedBytes <= maxQueueBytes) {
    return;
  }

  let overflowBytes = session.queuedBytes - maxQueueBytes;
  while (overflowBytes > 0 && session.queue.length) {
    const next = session.queue[0];
    const nextBytes = Number(next?.data?.byteLength || 0);
    if (nextBytes <= 0) {
      session.queue.shift();
      continue;
    }

    if (nextBytes <= overflowBytes) {
      session.queue.shift();
      session.queuedBytes = Math.max(0, session.queuedBytes - nextBytes);
      session.droppedBytes += nextBytes;
      session.droppedChunks += 1;
      overflowBytes -= nextBytes;
      continue;
    }

    const droppedHead = next.data.slice(0, overflowBytes);
    const keptTail = next.data.slice(overflowBytes);
    const dropRatio = overflowBytes / Math.max(1, nextBytes);
    next.data = keptTail;
    next.inputBytes = Math.max(0, next.inputBytes - Math.round(next.inputBytes * dropRatio));
    next.visibleChars = visibleByteEstimate(keptTail, Number.POSITIVE_INFINITY);
    next.inspectionText = "";
    session.queuedBytes = Math.max(0, session.queuedBytes - droppedHead.byteLength);
    session.droppedBytes += droppedHead.byteLength;
    session.droppedChunks += 1;
    overflowBytes = 0;
  }
}

function dirtyNotificationForSession(session) {
  return {
    active: session.active,
    droppedBytes: session.droppedBytes,
    droppedChunks: session.droppedChunks,
    id: session.id,
    workerQueueBytes: session.queuedBytes,
    workerScheduledDelayMs: session.scheduledAt
      ? performance.now() - session.scheduledAt
      : 0,
  };
}

function flushDirtyBatch() {
  dirtyBatchTimer = 0;
  dirtyBatchDueAt = 0;
  if (!pendingDirtyNotifications.size) {
    return;
  }

  const entries = Array.from(pendingDirtyNotifications.values()).filter((entry) => (
    entry?.id && sessions.has(entry.id)
  ));
  pendingDirtyNotifications.clear();
  if (!entries.length) {
    return;
  }

  postMessage({
    entries,
    type: "dirty-batch",
  });
}

function queueDirtyNotification(session) {
  pendingDirtyNotifications.set(session.id, dirtyNotificationForSession(session));
  const delay = session.active
    ? DIRTY_BATCH_ACTIVE_FLUSH_MS
    : DIRTY_BATCH_BACKGROUND_FLUSH_MS;
  const dueAt = performance.now() + delay;
  if (dirtyBatchTimer && dirtyBatchDueAt && dirtyBatchDueAt <= dueAt) {
    return;
  }

  if (dirtyBatchTimer) {
    clearTimeout(dirtyBatchTimer);
  }
  dirtyBatchDueAt = dueAt;
  dirtyBatchTimer = setTimeout(flushDirtyBatch, delay);
}

function clearQueuedDirtyNotification(id) {
  pendingDirtyNotifications.delete(id);
  if (!pendingDirtyNotifications.size && dirtyBatchTimer) {
    clearTimeout(dirtyBatchTimer);
    dirtyBatchTimer = 0;
    dirtyBatchDueAt = 0;
  }
}

function scheduleFlush(session) {
  if (session.flushTimer) {
    return;
  }
  if (session.dirtyNotified) {
    return;
  }
  if (session.inFlightFrames >= getMaxInFlightFrames(session)
    || session.inFlightBytes >= getMaxInFlightBytes(session)) {
    session.pendingFlushAfterAck = true;
    return;
  }
  const inputHot = !session.active && Date.now() < Number(session.inputHotUntil || 0);
  const delay = session.active
    ? ACTIVE_FLUSH_MS
    : inputHot
      ? BACKGROUND_HOT_FLUSH_MS
      : BACKGROUND_FLUSH_MS;
  session.scheduledAt = performance.now();
  session.flushTimer = setTimeout(() => {
    session.flushTimer = 0;
    notifyDirty(session);
  }, delay);
}

function notifyDirty(session) {
  if (!session.queue.length || session.dirtyNotified) {
    return;
  }
  if (
    session.inFlightFrames >= getMaxInFlightFrames(session)
    || session.inFlightBytes >= getMaxInFlightBytes(session)
  ) {
    session.pendingFlushAfterAck = true;
    return;
  }

  session.dirtyNotified = true;
  queueDirtyNotification(session);
}

function notifyDrainComplete(session, reason = "empty") {
  session.dirtyNotified = false;
  postMessage({
    active: session.active,
    id: session.id,
    reason,
    type: "drain-complete",
    workerQueueBytes: session.queuedBytes,
  });
}

function snapshotDrainSession(session) {
  const drainedBytes = session.queuedBytes;
  const drainedChunks = session.queue.reduce(
    (total, entry) => total + Math.max(1, Number(entry?.sourceChunks || 0)),
    0,
  );
  session.queue.length = 0;
  session.queuedBytes = 0;
  session.dirtyNotified = false;
  session.pendingFlushAfterAck = false;
  session.snapshotDrainMode = false;
  postMessage({
    active: session.active,
    id: session.id,
    reason: "snapshot",
    snapshotBytes: drainedBytes,
    snapshotChunks: drainedChunks,
    type: "drain-complete",
    workerQueueBytes: 0,
  });
}

function drainSession(session, requestedMaxBytes = 0) {
  clearQueuedDirtyNotification(session.id);
  if (!session.queue.length) {
    notifyDrainComplete(session, "empty");
    return;
  }
  if (!session.active && session.snapshotDrainMode) {
    snapshotDrainSession(session);
    return;
  }
  if (
    session.inFlightFrames >= getMaxInFlightFrames(session)
    || session.inFlightBytes >= getMaxInFlightBytes(session)
  ) {
    session.pendingFlushAfterAck = true;
    notifyDrainComplete(session, "backpressure");
    return;
  }

  const sessionBudget = getSessionFrameBytes(session);
  const requestedBudget = Math.max(0, Number(requestedMaxBytes || 0));
  const budget = requestedBudget > 0
    ? Math.max(1, Math.min(sessionBudget, requestedBudget))
    : sessionBudget;
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
      inputBytes += next.inputBytes;
      visibleChars += next.visibleChars;
      sourceChunks += next.sourceChunks;
      inspectionText = `${inspectionText}${next.inspectionText || ""}`.slice(-INSPECTION_TEXT_LIMIT);
      continue;
    }

    const head = next.data.slice(0, remainingBudget);
    const tail = next.data.slice(remainingBudget);
    const splitRatio = remainingBudget / Math.max(1, next.data.byteLength);
    batch.push(head);
    batchBytes += head.byteLength;
    inputBytes += Math.round(next.inputBytes * splitRatio);
    visibleChars += visibleByteEstimate(head, Number.POSITIVE_INFINITY);
    sourceChunks += 1;
    next.data = tail;
    next.inputBytes = Math.max(0, next.inputBytes - Math.round(next.inputBytes * splitRatio));
    next.visibleChars = visibleByteEstimate(tail, Number.POSITIVE_INFINITY);
    next.inspectionText = "";
  }

  session.queuedBytes = Math.max(0, session.queuedBytes - batchBytes);
  if (!batchBytes) {
    scheduleFlush(session);
    notifyDrainComplete(session, "empty_batch");
    return;
  }

  const output = new Uint8Array(batchBytes);
  let offset = 0;
  for (const data of batch) {
    output.set(data, offset);
    offset += data.byteLength;
  }

  const frameId = session.nextFrameId;
  session.nextFrameId += 1;
  session.inFlightFrames += 1;
  session.inFlightBytes += output.byteLength;
  session.dirtyNotified = false;
  session.pendingFlushAfterAck = false;

		  postMessage({
		    active: session.active,
		    data: output.buffer,
		    displayBytes: output.byteLength,
    droppedBytes: session.droppedBytes,
    droppedChunks: session.droppedChunks,
		    frameId,
    generation: session.generation,
    id: session.id,
    inputBytes,
    inspectionText,
    sourceChunks,
    type: "output",
    visibleChars,
    workerQueueBytes: session.queuedBytes,
    workerScheduledDelayMs: session.scheduledAt
      ? performance.now() - session.scheduledAt
      : 0,
  }, [output.buffer]);

  if (session.queue.length) {
    scheduleFlush(session);
  }
}

function getMaxInFlightBytes(session) {
  if (!session.active && session.snapshotDrainMode) {
    return BACKGROUND_SNAPSHOT_MAX_IN_FLIGHT_BYTES;
  }
  return session.active
    ? ACTIVE_MAX_IN_FLIGHT_BYTES
    : BACKGROUND_MAX_IN_FLIGHT_BYTES;
}

function getMaxInFlightFrames(session) {
  if (!session.active && session.snapshotDrainMode) {
    return BACKGROUND_SNAPSHOT_MAX_IN_FLIGHT_FRAMES;
  }
  return session.active
    ? ACTIVE_MAX_IN_FLIGHT_FRAMES
    : BACKGROUND_MAX_IN_FLIGHT_FRAMES;
}

function acknowledgeFrame(id, frame = {}) {
  const session = sessions.get(id);
  if (!session) {
    return;
  }
  session.inFlightFrames = Math.max(0, session.inFlightFrames - 1);
  session.inFlightBytes = Math.max(0, session.inFlightBytes - Math.max(0, Number(frame.bytes || 0)));
  if (session.queue.length && (session.pendingFlushAfterAck || !session.flushTimer)) {
    session.pendingFlushAfterAck = false;
    scheduleFlush(session);
  }
}

function closeTransport(session) {
  const socket = session.transportSocket;
  session.transportSocket = null;
  session.transportState = "closed";
  if (!socket) {
    return;
  }
  socket.onopen = null;
  socket.onmessage = null;
  socket.onerror = null;
  socket.onclose = null;
  try {
    socket.close();
  } catch (_error) {
    // Best effort only; disposal owns cleanup.
  }
}

function connectTransport(id, options = {}) {
  const session = getSession(id);
  if (session.transportState === "ready" && session.transportSocket?.readyState === WebSocket.OPEN) {
    postMessage({
      id,
      sessionId: id,
      type: "transport-ready",
    });
    return;
  }

  if (session.transportState === "connecting" || session.transportState === "ready") {
    return;
  }

  const endpoint = options.endpoint || {};
  if (typeof WebSocket === "undefined" || !endpoint.url || !endpoint.token) {
    postMessage({
      error: "Terminal output WebSocket endpoint is unavailable.",
      id,
      type: "transport-error",
    });
    return;
  }

  session.transportInspect = options.inspect === true;
  session.transportState = "connecting";
  let socket = null;
  try {
    socket = new WebSocket(endpoint.url);
    socket.binaryType = "arraybuffer";
  } catch (error) {
    session.transportState = "error";
    postMessage({
      error: error?.message || "Unable to open terminal output WebSocket.",
      id,
      type: "transport-error",
    });
    return;
  }

  session.transportSocket = socket;
  socket.onopen = () => {
    try {
      socket.send(JSON.stringify({
        sessionId: id,
        token: endpoint.token,
        type: "subscribe",
      }));
    } catch (error) {
      session.transportState = "error";
      postMessage({
        error: error?.message || "Unable to subscribe to terminal output transport.",
        id,
        type: "transport-error",
      });
      closeTransport(session);
    }
  };
  socket.onmessage = (event) => {
    if (typeof event.data === "string") {
      let message = null;
      try {
        message = JSON.parse(event.data);
      } catch (_error) {
        return;
      }
      if (message?.type === "terminal-output-ready") {
        session.transportState = "ready";
        postMessage({
          id,
          sessionId: message.sessionId || id,
          type: "transport-ready",
        });
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
      active: session.active,
      inputHotUntil: Number(session.inputHotUntil || 0),
      inspect: session.transportInspect,
    });
  };
  socket.onerror = () => {
    session.transportState = "error";
    postMessage({
      error: "Terminal output WebSocket transport failed.",
      id,
      type: "transport-error",
    });
  };
  socket.onclose = () => {
    if (session.transportSocket === socket) {
      session.transportSocket = null;
      if (session.transportState !== "error") {
        session.transportState = "closed";
      }
    }
  };
}

function enqueueChunk(id, rawData, options = {}) {
  const session = getSession(id);
  session.active = options.active === true;
  if (session.active) {
    session.snapshotDrainMode = false;
  }
  session.inputHotUntil = Math.max(
    Number(session.inputHotUntil || 0),
    Number(options.inputHotUntil || 0),
  );
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
  const visibleChars = visibleByteEstimate(masked, Number.POSITIVE_INFINITY);
	  session.queue.push({
    data: masked,
    inputBytes: rawBytes,
    inspectionText,
    sourceChunks: 1,
    visibleChars,
	  });
	  session.queuedBytes += masked.byteLength;
  trimSessionQueue(session);

	  const shouldFlushImmediately = session.active
	    ? session.queuedBytes >= ACTIVE_FRAME_BYTES || performance.now() - startedAt >= 4
	    : Date.now() >= Number(session.inputHotUntil || 0)
	      && session.queuedBytes >= BACKGROUND_FLUSH_QUEUE_BYTES;

  if (shouldFlushImmediately) {
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = 0;
    }
    notifyDirty(session);
  } else {
    scheduleFlush(session);
  }
}

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "register") {
    const session = createSession(message.id, message);
    sessions.set(message.id, session);
    return;
  }

  if (message.type === "dispose") {
    const session = sessions.get(message.id);
    if (session?.flushTimer) {
      clearTimeout(session.flushTimer);
    }
    clearQueuedDirtyNotification(message.id);
    if (session) {
      closeTransport(session);
    }
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
    if (session.active) {
      session.snapshotDrainMode = false;
    }
    session.inputHotUntil = Math.max(
      Number(session.inputHotUntil || 0),
      Number(message.inputHotUntil || 0),
    );
    if (session.active && session.queue.length) {
      if (session.flushTimer) {
        clearTimeout(session.flushTimer);
        session.flushTimer = 0;
      }
      notifyDirty(session);
    }
    return;
  }

  if (message.type === "connectTransport") {
    connectTransport(message.id, {
      endpoint: message.endpoint,
      inspect: message.inspect === true,
    });
    return;
  }

  if (message.type === "ack") {
    acknowledgeFrame(message.id, {
      bytes: message.bytes,
      frameId: message.frameId,
    });
    return;
  }

  if (message.type === "drain") {
    const session = getSession(message.id);
    session.active = message.active === true;
    session.snapshotDrainMode = !session.active && message.snapshot === true;
    session.inputHotUntil = Math.max(
      Number(session.inputHotUntil || 0),
      Number(message.inputHotUntil || 0),
    );
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = 0;
    }
    drainSession(session, message.maxBytes);
    return;
  }

  if (message.type === "snapshotReplay") {
    const session = getSession(message.id);
    if (session.flushTimer) {
      clearTimeout(session.flushTimer);
      session.flushTimer = 0;
    }
    session.generation = Math.max(
      session.generation + 1,
      Number(message.generation || 0),
    );
    session.queue.length = 0;
    session.queuedBytes = 0;
    session.dirtyNotified = false;
    clearQueuedDirtyNotification(session.id);
    session.pendingFlushAfterAck = false;
    session.inFlightBytes = 0;
    session.inFlightFrames = 0;
    session.snapshotDrainMode = false;
    session.droppedBytes = 0;
    session.droppedChunks = 0;
    return;
  }

  if (message.type === "chunk") {
    enqueueChunk(message.id, new Uint8Array(message.data), {
      active: message.active === true,
      inputHotUntil: Number(message.inputHotUntil || 0),
      inspect: message.inspect === true,
    });
  }
};

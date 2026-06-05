import { createCoreRepoNameDisplayMasker } from "../coreRepoNameDisplay.js";
import { stripLiveViewControlSequences } from "../liveViewSanitizer.js";

const ACTIVE_FLUSH_MS = 8;
const BACKGROUND_FLUSH_MS = 32;
const ACTIVE_FRAME_BYTES = 16 * 1024;
const BACKGROUND_FRAME_BYTES = 8 * 1024;
const INSPECTION_TEXT_LIMIT = 2400;
const INITIAL_INSPECTION_CHUNKS = 80;

const sessions = new Map();

function createSession(id, options = {}) {
  return {
    active: false,
    decoder: new TextDecoder("utf-8", { fatal: false }),
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
  const visibleChars = visibleByteEstimate(masked, Number.POSITIVE_INFINITY);
  session.queue.push({
    data: masked,
    inputBytes: rawBytes,
    inspectionText,
    sourceChunks: 1,
    visibleChars,
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
    return;
  }

  if (message.type === "chunk") {
    enqueueChunk(message.id, new Uint8Array(message.data), {
      active: message.active === true,
      inspect: message.inspect === true,
    });
  }
};

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";

import { logTerminalStatus } from "../terminalStatusLog.js";
import {
  TERMINAL_ENTER_SEQUENCE,
  TERMINAL_ENTER_SEQUENCE_MOD1,
  TERMINAL_INPUT_EVENT,
  getTerminalInputDebugFields,
} from "./terminalCore.js";

const TERMINAL_INPUT_TRANSPORT_BUFFERED_LIMIT_BYTES = 512 * 1024;
const TERMINAL_INPUT_TRANSPORT_QUEUE_LIMIT = 4096;
const TERMINAL_INPUT_TRANSPORT_RETRY_MS = 4;

let terminalInputTransportEndpoint = null;
let terminalInputTransportSocket = null;
let terminalInputTransportConnectPromise = null;
let terminalInputTransportFlushTimer = 0;
let terminalInputTransportFallbackPromise = null;
let terminalInputTransportQueue = [];
let terminalInputTransportNextMessageId = 1;
const terminalInputTransportPendingAcks = new Map();

export function terminalInputDataIsSubmit(value) {
  const text = String(value || "");
  return text.includes("\r")
    || text.includes("\n")
    || text.includes(TERMINAL_ENTER_SEQUENCE)
    || text.includes(TERMINAL_ENTER_SEQUENCE_MOD1);
}

function isTerminalInputTransportAvailable() {
  return typeof WebSocket !== "undefined";
}

function isTerminalInputTransportOpen() {
  return (
    isTerminalInputTransportAvailable()
    && terminalInputTransportSocket?.readyState === WebSocket.OPEN
  );
}

function cleanTerminalInputTransportPayload(payload) {
  const cleanPayload = {};
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      cleanPayload[key] = value;
    }
  });
  return cleanPayload;
}

function getTerminalInputTransportLogFields(payload = {}, extra = {}) {
  const data = String(payload?.data || "");
  return {
    data: getTerminalInputDebugFields(data),
    hasPromptEventId: Boolean(String(payload?.promptEventId || "").trim()),
    hasPromptEventText: Boolean(String(payload?.promptEventText || "").trim()),
    instanceId: payload?.instanceId || "",
    isSubmitInput: terminalInputDataIsSubmit(data),
    paneId: payload?.paneId || "",
    promptEventId: String(payload?.promptEventId || "").trim(),
    promptEventSource: String(payload?.promptEventSource || "").trim(),
    promptTextLength: String(payload?.promptEventText || "").trim().length,
    threadId: payload?.threadId || "",
    ...extra,
  };
}

function logTerminalInputTransportSubmit(phase, payload, extra = {}) {
  if (!payload?.promptEventId && !payload?.promptEventText) {
    return;
  }

  logTerminalStatus(
    phase,
    getTerminalInputTransportLogFields(payload, extra),
  );
}

function invokeTerminalInputPayload(payload) {
  return invoke("terminal_write", {
    data: payload?.data || "",
    instanceId: payload?.instanceId,
    paneId: payload?.paneId,
    promptEventId: payload?.promptEventId,
    promptEventRevision: payload?.promptEventRevision,
    promptEventSource: payload?.promptEventSource,
    promptEventSubmittedAt: payload?.promptEventSubmittedAt,
    promptEventText: payload?.promptEventText,
    threadId: payload?.threadId,
  });
}

function scheduleTerminalInputTransportFlush(delayMs = 0) {
  if (terminalInputTransportFlushTimer || typeof window === "undefined") {
    return;
  }
  terminalInputTransportFlushTimer = window.setTimeout(() => {
    terminalInputTransportFlushTimer = 0;
    flushTerminalInputTransportQueue();
  }, delayMs);
}

function fallbackTerminalInputTransportQueue() {
  if (terminalInputTransportFallbackPromise) {
    return terminalInputTransportFallbackPromise;
  }

  const queuedEntries = terminalInputTransportQueue.splice(0);
  terminalInputTransportFallbackPromise = queuedEntries
    .reduce(
      (promise, entry) => promise
        .then(() => {
          logTerminalInputTransportSubmit("frontend.terminal_input_transport.fallback_emit", entry.payload, {
            messageId: entry.messageId,
            reason: "transport_unavailable",
          });
          return entry.messageId
            ? invokeTerminalInputPayload(entry.payload)
            : emit(TERMINAL_INPUT_EVENT, entry.payload);
        })
        .then((result) => {
          entry.resolveAck?.(result);
          return result;
        })
        .catch((error) => {
          entry.rejectAck?.(error);
        }),
      Promise.resolve(),
    )
    .finally(() => {
      terminalInputTransportFallbackPromise = null;
    });
  return terminalInputTransportFallbackPromise;
}

function rejectTerminalInputTransportPendingAcks(error) {
  Array.from(terminalInputTransportPendingAcks.values()).forEach((ack) => {
    ack.reject(error);
  });
}

function resetTerminalInputTransportSocket(socket) {
  if (terminalInputTransportSocket === socket) {
    terminalInputTransportSocket = null;
  }
}

function handleTerminalInputTransportMessage(event) {
  let message = null;
  try {
    message = JSON.parse(String(event?.data || ""));
  } catch {
    return;
  }
  if (message?.type !== "terminal-input-ack" || !message.messageId) {
    return;
  }

  const ack = terminalInputTransportPendingAcks.get(message.messageId);
  if (!ack) {
    return;
  }
  logTerminalStatus("frontend.terminal_input_transport.ack", {
    ...(ack.fields || {}),
    error: message.ok ? "" : String(message.error || ""),
    messageId: message.messageId,
    ok: Boolean(message.ok),
  });
  if (message.ok) {
    ack.resolve(message);
  } else {
    ack.reject(new Error(message.error || "Terminal input write failed."));
  }
}

function createTerminalInputTransportEntry(payload, waitForAck = false) {
  const entry = {
    logFields: waitForAck ? getTerminalInputTransportLogFields(payload) : null,
    messageId: "",
    payload,
    rejectAck: null,
    resolveAck: null,
    waitPromise: null,
  };

  if (!waitForAck) {
    return entry;
  }

  const messageId = `terminal-input-${Date.now().toString(36)}-${terminalInputTransportNextMessageId.toString(36)}`;
  terminalInputTransportNextMessageId += 1;
  entry.messageId = messageId;
  entry.waitPromise = new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      const ack = terminalInputTransportPendingAcks.get(messageId);
      if (ack?.timer) {
        window.clearTimeout(ack.timer);
      }
      terminalInputTransportPendingAcks.delete(messageId);
      callback(value);
    };
    entry.resolveAck = (value) => finish(resolve, value);
    entry.rejectAck = (error) => finish(reject, error);
    const timer = typeof window !== "undefined"
      ? window.setTimeout(() => {
        entry.rejectAck?.(new Error("Terminal input write acknowledgement timed out."));
      }, 8000)
      : 0;
    terminalInputTransportPendingAcks.set(messageId, {
      fields: entry.logFields,
      reject: entry.rejectAck,
      resolve: entry.resolveAck,
      timer,
    });
  });
  return entry;
}

function sendTerminalInputTransportEntry(socket, entry) {
  socket.send(JSON.stringify({
    token: terminalInputTransportEndpoint.token,
    ...(entry.messageId ? { messageId: entry.messageId } : {}),
    payload: entry.payload,
  }));
}

function ensureTerminalInputTransport() {
  if (!isTerminalInputTransportAvailable()) {
    return Promise.reject(new Error("Terminal input WebSocket transport is unavailable."));
  }
  if (isTerminalInputTransportOpen()) {
    return Promise.resolve(terminalInputTransportSocket);
  }
  if (terminalInputTransportConnectPromise) {
    return terminalInputTransportConnectPromise;
  }

  terminalInputTransportConnectPromise = Promise.resolve(terminalInputTransportEndpoint)
    .then((endpoint) => endpoint || invoke("terminal_input_transport_endpoint"))
    .then((endpoint) => {
      terminalInputTransportEndpoint = endpoint;
      return new Promise((resolve, reject) => {
        let settled = false;
        const socket = new WebSocket(endpoint.url);
        socket.onopen = () => {
          settled = true;
          terminalInputTransportSocket = socket;
          terminalInputTransportConnectPromise = null;
          socket.onmessage = handleTerminalInputTransportMessage;
          flushTerminalInputTransportQueue();
          resolve(socket);
        };
        socket.onclose = () => {
          resetTerminalInputTransportSocket(socket);
          rejectTerminalInputTransportPendingAcks(new Error("Terminal input WebSocket transport closed."));
          if (!settled) {
            terminalInputTransportConnectPromise = null;
            reject(new Error("Terminal input WebSocket transport closed before opening."));
          }
        };
        socket.onerror = () => {
          if (!settled) {
            terminalInputTransportConnectPromise = null;
            reject(new Error("Terminal input WebSocket transport failed."));
          }
        };
      });
    })
    .catch((error) => {
      terminalInputTransportConnectPromise = null;
      throw error;
    });

  return terminalInputTransportConnectPromise;
}

function flushTerminalInputTransportQueue() {
  if (!terminalInputTransportQueue.length) {
    return;
  }

  if (!isTerminalInputTransportOpen() || !terminalInputTransportEndpoint?.token) {
    ensureTerminalInputTransport().catch(() => {
      fallbackTerminalInputTransportQueue();
    });
    return;
  }

  const socket = terminalInputTransportSocket;
  while (
    terminalInputTransportQueue.length
    && socket.bufferedAmount < TERMINAL_INPUT_TRANSPORT_BUFFERED_LIMIT_BYTES
  ) {
    const entry = terminalInputTransportQueue.shift();
    try {
      sendTerminalInputTransportEntry(socket, entry);
      logTerminalInputTransportSubmit("frontend.terminal_input_transport.sent", entry.payload, {
        messageId: entry.messageId,
        socketBufferedAmount: socket.bufferedAmount,
        waitForAck: Boolean(entry.messageId),
      });
    } catch {
      terminalInputTransportQueue.unshift(entry);
      resetTerminalInputTransportSocket(socket);
      ensureTerminalInputTransport().catch(() => {
        fallbackTerminalInputTransportQueue();
      });
      return;
    }
  }

  if (terminalInputTransportQueue.length) {
    scheduleTerminalInputTransportFlush(TERMINAL_INPUT_TRANSPORT_RETRY_MS);
  }
}

export function warmTerminalInputTransport() {
  ensureTerminalInputTransport().catch(() => {});
}

export function sendTerminalInputPayload(payload, options = {}) {
  const cleanPayload = cleanTerminalInputTransportPayload(payload);
  const waitForAck = Boolean(options?.waitForAck);
  if (!isTerminalInputTransportAvailable()) {
    logTerminalInputTransportSubmit("frontend.terminal_input_transport.fallback_emit_unavailable", cleanPayload, {
      waitForAck,
    });
    return waitForAck
      ? invokeTerminalInputPayload(cleanPayload)
      : emit(TERMINAL_INPUT_EVENT, cleanPayload);
  }

  const entry = createTerminalInputTransportEntry(cleanPayload, waitForAck);

  if (isTerminalInputTransportOpen() && terminalInputTransportEndpoint?.token) {
    const socket = terminalInputTransportSocket;
    if (socket.bufferedAmount < TERMINAL_INPUT_TRANSPORT_BUFFERED_LIMIT_BYTES) {
      try {
        sendTerminalInputTransportEntry(socket, entry);
        logTerminalInputTransportSubmit("frontend.terminal_input_transport.sent", cleanPayload, {
          messageId: entry.messageId,
          socketBufferedAmount: socket.bufferedAmount,
          waitForAck,
        });
        return entry.waitPromise || Promise.resolve({ queued: true, transport: "websocket" });
      } catch {
        resetTerminalInputTransportSocket(socket);
      }
    }
  }

  if (terminalInputTransportQueue.length >= TERMINAL_INPUT_TRANSPORT_QUEUE_LIMIT) {
    logTerminalInputTransportSubmit("frontend.terminal_input_transport.fallback_emit_queue_full", cleanPayload, {
      queueLength: terminalInputTransportQueue.length,
      waitForAck,
    });
    return waitForAck
      ? invokeTerminalInputPayload(cleanPayload)
      : emit(TERMINAL_INPUT_EVENT, cleanPayload);
  }

  terminalInputTransportQueue.push(entry);
  logTerminalInputTransportSubmit("frontend.terminal_input_transport.queued", cleanPayload, {
    messageId: entry.messageId,
    queueLength: terminalInputTransportQueue.length,
    waitForAck,
  });
  ensureTerminalInputTransport().catch(() => {
    fallbackTerminalInputTransportQueue();
  });
  scheduleTerminalInputTransportFlush();
  return entry.waitPromise || Promise.resolve({ queued: true, transport: "websocket" });
}

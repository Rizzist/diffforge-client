import { invoke } from "@tauri-apps/api/core";

const callbacks = new Map();
const transportStatusCallbacks = new Map();
const transportHandshakes = new Map();
let worker = null;
let workerFailed = false;
let outputTransportEndpointPromise = null;

function terminalOutputTransportEndpoint() {
  if (!outputTransportEndpointPromise) {
    outputTransportEndpointPromise = invoke("terminal_output_transport_endpoint").catch((error) => {
      outputTransportEndpointPromise = null;
      throw error;
    });
  }
  return outputTransportEndpointPromise;
}

function resetTerminalOutputTransportEndpoint() {
  outputTransportEndpointPromise = null;
}

function settleTransportHandshake(id, ok, payload = {}) {
  const handshake = transportHandshakes.get(id);
  if (!handshake) {
    return;
  }
  transportHandshakes.delete(id);
  if (handshake.timer) {
    window.clearTimeout(handshake.timer);
  }
  if (ok) {
    handshake.resolve(payload);
  } else {
    handshake.reject(new Error(payload.error || "Terminal output transport failed."));
  }
}

function createWorker() {
  if (worker || workerFailed) {
    return worker;
  }

  try {
    worker = new Worker(new URL("./terminalOutputWorker.js", import.meta.url), {
      name: "diffforge-terminal-output",
      type: "module",
    });
  } catch (error) {
    workerFailed = true;
    worker = null;
    return null;
  }

  worker.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === "transport-ready") {
      transportStatusCallbacks.get(message.id)?.(message);
      settleTransportHandshake(message.id, true, message);
      return;
    }
    if (message.type === "transport-error") {
      resetTerminalOutputTransportEndpoint();
      transportStatusCallbacks.get(message.id)?.(message);
      settleTransportHandshake(message.id, false, message);
      return;
    }
    if (message.type === "transport-closed") {
      resetTerminalOutputTransportEndpoint();
      transportStatusCallbacks.get(message.id)?.(message);
      settleTransportHandshake(message.id, false, {
        error: "Terminal output transport socket closed.",
      });
      return;
    }
    if (message.type !== "output") {
      return;
    }
    const callback = callbacks.get(message.id);
    if (!callback) {
      return;
    }
    callback({
      ...message,
      data: new Uint8Array(message.data),
    });
  };

  worker.onerror = () => {
    workerFailed = true;
    transportStatusCallbacks.forEach((callback, id) => {
      callback({
        error: "Terminal output worker crashed.",
        id,
        type: "transport-error",
      });
    });
    callbacks.clear();
    transportStatusCallbacks.clear();
    transportHandshakes.forEach((handshake) => {
      if (handshake.timer) {
        window.clearTimeout(handshake.timer);
      }
      handshake.reject(new Error("Terminal output worker crashed."));
    });
    transportHandshakes.clear();
    try {
      worker?.terminate();
    } catch (_error) {
      // Ignore worker shutdown failures; the caller falls back to inline output.
    }
    worker = null;
  };

  return worker;
}

function exactTransferBuffer(data) {
  if (data instanceof ArrayBuffer) {
    return data;
  }
  if (data instanceof Uint8Array) {
    if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
      return data.buffer;
    }
    return data.slice().buffer;
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer;
  }
  return null;
}

export function createTerminalOutputWorkerSession(options = {}) {
  const id = String(options.id || "");
  const outputWorker = createWorker();
  if (!id || !outputWorker) {
    return null;
  }

  callbacks.set(id, options.onOutput);
  if (typeof options.onTransportStatus === "function") {
    transportStatusCallbacks.set(id, options.onTransportStatus);
  }
  outputWorker.postMessage({
    coreRepoPath: options.coreRepoPath || "",
    functionalRepoPath: options.functionalRepoPath || "",
    id,
    type: "register",
  });

  return {
    dispose() {
      callbacks.delete(id);
      transportStatusCallbacks.delete(id);
      settleTransportHandshake(id, false, {
        error: "Terminal output worker session was disposed.",
      });
      try {
        outputWorker.postMessage({ id, type: "dispose" });
      } catch (_error) {
        // Worker fallback is intentionally silent here.
      }
    },

    enqueue(data, metadata = {}) {
      const transferBuffer = exactTransferBuffer(data);
      if (!transferBuffer?.byteLength) {
        return false;
      }
      try {
        outputWorker.postMessage({
          active: metadata.active === true,
          data: transferBuffer,
          id,
          inspect: metadata.inspect === true,
          type: "chunk",
        }, [transferBuffer]);
        return true;
      } catch (_error) {
        return false;
      }
    },

    prepareTransport(metadata = {}) {
      if (!metadata.paneId || !metadata.instanceId) {
        return Promise.reject(new Error("Terminal output transport is missing terminal identity."));
      }
      const existing = transportHandshakes.get(id);
      if (existing?.promise) {
        return existing.promise;
      }

      const timeoutMs = Number.isFinite(metadata.timeoutMs)
        ? Math.max(200, metadata.timeoutMs)
        : 1200;
      let promise = null;
      promise = terminalOutputTransportEndpoint().then((endpoint) => (
        new Promise((resolve, reject) => {
          const timer = window.setTimeout(() => {
            transportHandshakes.delete(id);
            reject(new Error("Timed out connecting terminal output transport."));
          }, timeoutMs);
          transportHandshakes.set(id, {
            promise,
            reject,
            resolve,
            timer,
          });
          try {
            outputWorker.postMessage({
              active: metadata.active === true,
              endpoint,
              id,
              inspect: metadata.inspect === true,
              instanceId: metadata.instanceId,
              paneId: metadata.paneId,
              type: "connectTransport",
            });
          } catch (error) {
            window.clearTimeout(timer);
            transportHandshakes.delete(id);
            reject(error);
          }
        })
      )).catch((error) => {
        transportHandshakes.delete(id);
        resetTerminalOutputTransportEndpoint();
        throw error;
      });

      transportHandshakes.set(id, {
        promise,
        reject: () => {},
        resolve: () => {},
        timer: 0,
      });
      return promise;
    },

    setActive(active) {
      try {
        outputWorker.postMessage({ active: active === true, id, type: "priority" });
      } catch (_error) {
        // Best effort only.
      }
    },

    updatePaths(paths = {}) {
      try {
        outputWorker.postMessage({
          coreRepoPath: paths.coreRepoPath || "",
          functionalRepoPath: paths.functionalRepoPath || "",
          id,
          type: "paths",
        });
      } catch (_error) {
        // Best effort only.
      }
    },
  };
}

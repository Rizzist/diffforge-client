import { invoke } from "@tauri-apps/api/core";

const callbacks = new Map();
const transportReadySessions = new Set();
const transportWaiters = new Map();
let worker = null;
let workerFailed = false;
let terminalOutputTransportEndpoint = null;
let terminalOutputTransportEndpointPromise = null;

function ensureTerminalOutputTransportEndpoint() {
  if (typeof WebSocket === "undefined") {
    return Promise.reject(new Error("Terminal output WebSocket transport is unavailable."));
  }
  if (terminalOutputTransportEndpoint) {
    return Promise.resolve(terminalOutputTransportEndpoint);
  }
  if (terminalOutputTransportEndpointPromise) {
    return terminalOutputTransportEndpointPromise;
  }

  terminalOutputTransportEndpointPromise = invoke("terminal_output_transport_endpoint")
    .then((endpoint) => {
      terminalOutputTransportEndpoint = endpoint;
      terminalOutputTransportEndpointPromise = null;
      return endpoint;
    })
    .catch((error) => {
      terminalOutputTransportEndpointPromise = null;
      throw error;
    });

  return terminalOutputTransportEndpointPromise;
}

function settleTransportWaiter(id, result = {}) {
  const waiter = transportWaiters.get(id);
  if (!waiter) {
    return;
  }
  transportWaiters.delete(id);
  if (waiter.timer) {
    window.clearTimeout(waiter.timer);
  }
  if (result.ok) {
    waiter.resolve(result.sessionId || id);
  } else {
    waiter.reject(new Error(result.error || "Terminal output transport failed."));
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

  const dispatchDirtyNotification = (message = {}) => {
    const callback = callbacks.get(message.id);
    const onDirty = typeof callback === "function"
      ? null
      : callback?.onDirty;
    if (typeof onDirty !== "function") {
      return;
    }

    onDirty({
      active: message.active === true,
      droppedBytes: Number(message.droppedBytes || 0),
      droppedChunks: Number(message.droppedChunks || 0),
      id: message.id,
      workerQueueBytes: Number(message.workerQueueBytes || 0),
      workerScheduledDelayMs: Number(message.workerScheduledDelayMs || 0),
    });
  };

  worker.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === "transport-ready") {
      transportReadySessions.add(message.id);
      settleTransportWaiter(message.id, {
        ok: true,
        sessionId: message.sessionId || message.id,
      });
      return;
    }
    if (message.type === "transport-error") {
      transportReadySessions.delete(message.id);
      settleTransportWaiter(message.id, {
        error: message.error,
        ok: false,
      });
      return;
    }
    if (message.type === "dirty-batch") {
      const entries = Array.isArray(message.entries) ? message.entries : [];
      entries.forEach((entry) => dispatchDirtyNotification(entry));
      return;
    }
    if (message.type === "dirty") {
      dispatchDirtyNotification(message);
      return;
    }
	    if (message.type === "drain-complete") {
	      const callback = callbacks.get(message.id);
	      const onDrain = typeof callback === "function"
	        ? null
	        : callback?.onDrain;
	      if (typeof onDrain === "function") {
	        onDrain({
	          active: message.active === true,
	          id: message.id,
	          reason: message.reason || "",
	          snapshotBytes: Number(message.snapshotBytes || 0),
	          snapshotChunks: Number(message.snapshotChunks || 0),
	          workerQueueBytes: Number(message.workerQueueBytes || 0),
	        });
	      }
	      return;
	    }
	    if (message.type !== "output") {
	      return;
	    }
    const callback = callbacks.get(message.id);
    const onOutput = typeof callback === "function"
      ? callback
      : callback?.onOutput;
    if (typeof onOutput !== "function") {
      try {
        worker?.postMessage({
          bytes: Number(message.displayBytes || 0),
          frameId: message.frameId,
          id: message.id,
          type: "ack",
        });
      } catch (_error) {
        // Best effort: disposal will clear worker-side state.
      }
      return;
    }
    let acknowledged = false;
    const acknowledge = () => {
      if (acknowledged) {
        return;
      }
      acknowledged = true;
      try {
        worker?.postMessage({
          bytes: Number(message.displayBytes || 0),
          frameId: message.frameId,
          id: message.id,
          type: "ack",
        });
      } catch (_error) {
        // Best effort only; the worker will also reset on dispose.
      }
    };
	    try {
	      onOutput({
	        ...message,
	        acknowledge,
	        data: new Uint8Array(message.data),
	        generation: Number(message.generation || 0),
	      });
    } catch (error) {
      acknowledge();
      throw error;
    }
  };

  worker.onerror = () => {
    workerFailed = true;
    callbacks.clear();
    transportReadySessions.clear();
    Array.from(transportWaiters.keys()).forEach((id) => {
      settleTransportWaiter(id, {
        error: "Terminal output worker failed.",
        ok: false,
      });
    });
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

  callbacks.set(id, {
    onDrain: options.onDrain,
    onDirty: options.onDirty,
    onOutput: options.onOutput,
  });
  let snapshotGeneration = 0;
  outputWorker.postMessage({
    coreRepoPath: options.coreRepoPath || "",
    functionalRepoPath: options.functionalRepoPath || "",
    id,
    type: "register",
  });

  return {
    id,
    outputTransportSessionId: id,

    dispose() {
      callbacks.delete(id);
      transportReadySessions.delete(id);
      settleTransportWaiter(id, {
        error: "Terminal output session was disposed.",
        ok: false,
      });
      try {
        outputWorker.postMessage({ id, type: "dispose" });
      } catch (_error) {
        // Worker fallback is intentionally silent here.
      }
    },

    prepareTransport(metadata = {}) {
      if (transportReadySessions.has(id)) {
        return Promise.resolve(id);
      }
      const existingWaiter = transportWaiters.get(id);
      if (existingWaiter?.promise) {
        return existingWaiter.promise;
      }

      const timeoutMs = Math.max(0, Number(metadata.timeoutMs || 900));
      const promise = ensureTerminalOutputTransportEndpoint()
        .then((endpoint) => new Promise((resolve, reject) => {
          const waiter = {
            promise: null,
            reject,
            resolve,
            timer: 0,
          };
          waiter.promise = promise;
          transportWaiters.set(id, waiter);
          if (timeoutMs > 0 && typeof window !== "undefined") {
            waiter.timer = window.setTimeout(() => {
              transportWaiters.delete(id);
              reject(new Error("Terminal output transport did not become ready in time."));
            }, timeoutMs);
          }
          try {
            outputWorker.postMessage({
              endpoint,
              id,
              inspect: metadata.inspect === true,
              type: "connectTransport",
            });
          } catch (error) {
            transportWaiters.delete(id);
            if (waiter.timer) {
              window.clearTimeout(waiter.timer);
            }
            reject(error);
          }
        }));

      return promise;
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
          inputHotUntil: typeof window === "undefined"
            ? 0
            : Number(window.__diffforgeTerminalInputHotUntil || 0),
          inspect: metadata.inspect === true,
          type: "chunk",
        }, [transferBuffer]);
        return true;
      } catch (_error) {
        return false;
      }
    },

	    requestDrain(metadata = {}) {
	      const maxBytes = Math.max(0, Number(metadata.maxBytes || 0));
	      try {
	        outputWorker.postMessage({
	          active: metadata.active === true,
	          id,
          inputHotUntil: typeof window === "undefined"
            ? 0
            : Number(window.__diffforgeTerminalInputHotUntil || 0),
	          maxBytes,
	          reason: metadata.reason || "",
	          snapshot: metadata.snapshot === true,
	          type: "drain",
	        });
        return true;
      } catch (_error) {
        return false;
      }
    },

	    setActive(active) {
      try {
        outputWorker.postMessage({
          active: active === true,
          id,
          inputHotUntil: typeof window === "undefined"
            ? 0
            : Number(window.__diffforgeTerminalInputHotUntil || 0),
          type: "priority",
        });
      } catch (_error) {
        // Best effort only.
      }
	    },

	    resetAfterSnapshotReplay() {
	      snapshotGeneration += 1;
	      try {
	        outputWorker.postMessage({
	          generation: snapshotGeneration,
	          id,
	          type: "snapshotReplay",
	        });
	      } catch (_error) {
	        // The snapshot replay still updates the visible terminal; worker reset is best effort.
	      }
	      return snapshotGeneration;
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

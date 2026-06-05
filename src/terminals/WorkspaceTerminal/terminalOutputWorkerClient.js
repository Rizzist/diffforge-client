const callbacks = new Map();
let worker = null;
let workerFailed = false;

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
    callbacks.clear();
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
  outputWorker.postMessage({
    coreRepoPath: options.coreRepoPath || "",
    functionalRepoPath: options.functionalRepoPath || "",
    id,
    type: "register",
  });

  return {
    dispose() {
      callbacks.delete(id);
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

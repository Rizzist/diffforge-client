import { listen } from "@tauri-apps/api/event";

const sharedListeners = new Map();

const reportSharedEventError = (eventName, error) => {
  console.error(`Shared Tauri event listener failed for ${String(eventName)}`, error);
};

const ensureSharedListener = (eventName) => {
  let entry = sharedListeners.get(eventName);
  if (entry) {
    if (!entry.listenPromise && !entry.unlisten) {
      entry.listenPromise = listen(eventName, entry.dispatcher)
        .then((unlisten) => {
          entry.unlisten = unlisten;
          return unlisten;
        })
        .catch((error) => {
          entry.listenPromise = null;
          reportSharedEventError(eventName, error);
        });
    }
    return entry;
  }

  entry = {
    dispatcher: null,
    handlers: new Set(),
    listenPromise: null,
    unlisten: null,
  };
  entry.dispatcher = (event) => {
    Array.from(entry.handlers).forEach((handler) => {
      try {
        const result = handler(event);
        if (result && typeof result.catch === "function") {
          result.catch((error) => {
            reportSharedEventError(eventName, error);
          });
        }
      } catch (error) {
        reportSharedEventError(eventName, error);
      }
    });
  };
  sharedListeners.set(eventName, entry);
  entry.listenPromise = listen(eventName, entry.dispatcher)
    .then((unlisten) => {
      entry.unlisten = unlisten;
      return unlisten;
    })
    .catch((error) => {
      entry.listenPromise = null;
      reportSharedEventError(eventName, error);
    });
  return entry;
};

export const listenShared = (eventName, handler) => {
  const entry = ensureSharedListener(eventName);
  entry.handlers.add(handler);
  let subscribed = true;
  return () => {
    if (!subscribed) {
      return;
    }
    subscribed = false;
    entry.handlers.delete(handler);
  };
};

// Tauri's native event subscription is asynchronous. Callers that must emit
// immediately after mounting (notably durable remote-command replay) need a
// positive signal that the native listener exists, rather than merely that a
// JavaScript handler was added to this registry.
export const waitSharedListenerReady = async (eventName) => {
  const entry = ensureSharedListener(eventName);
  if (typeof entry.unlisten === "function") {
    return true;
  }
  const unlisten = await entry.listenPromise;
  if (typeof unlisten !== "function") {
    throw new Error(`Shared Tauri event listener is not ready for ${String(eventName)}`);
  }
  return true;
};

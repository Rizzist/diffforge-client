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

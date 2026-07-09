export function paneControlOperationPending(queue, paneId) {
  if (!(queue instanceof Map)) {
    return false;
  }
  const key = String(paneId || "").trim();
  return Boolean(key && queue.has(key));
}

export function enqueuePaneControlOperation(queue, paneId, operation) {
  if (!(queue instanceof Map)) {
    throw new TypeError("Pane control queue must be a Map.");
  }
  if (typeof operation !== "function") {
    throw new TypeError("Pane control operation must be a function.");
  }
  const key = String(paneId || "").trim();
  if (!key) {
    return Promise.reject(new Error("Pane control operation requires a pane id."));
  }

  const previous = queue.get(key) || Promise.resolve();
  const current = Promise.resolve(previous)
    .catch(() => {})
    .then(operation);
  queue.set(key, current);
  return current.finally(() => {
    if (queue.get(key) === current) {
      queue.delete(key);
    }
  });
}

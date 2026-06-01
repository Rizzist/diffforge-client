export function selectTodoQueueDispatchCandidate({
  queuedItems = [],
  isBoundaryItem = () => false,
  resolveItemTarget = () => null,
} = {}) {
  const items = (Array.isArray(queuedItems) ? queuedItems : []).filter(Boolean);
  if (!items.length) {
    return {
      item: null,
      target: null,
      reason: "no_queued_items",
    };
  }

  const firstItem = items[0] || null;
  const firstItemIsBoundary = Boolean(firstItem && isBoundaryItem(firstItem));
  const nonBoundaryItems = firstItemIsBoundary
    ? items.filter((item) => !isBoundaryItem(item))
    : items;
  const selectableItems = nonBoundaryItems.length ? nonBoundaryItems : [firstItem];
  let firstUnavailable = null;
  const resolvedItems = new Map();
  const resolve = (item) => {
    if (!resolvedItems.has(item)) {
      resolvedItems.set(item, resolveItemTarget(item) || {});
    }
    return resolvedItems.get(item) || {};
  };

  const tryItems = (predicate, selectionReason) => {
    for (const item of selectableItems) {
      const resolved = resolve(item);
      if (!predicate(resolved)) {
        continue;
      }
      if (resolved.target || resolved.available) {
        return {
          ...resolved,
          item,
          reason: selectionReason,
          target: resolved.target || resolved,
        };
      }
      if (!firstUnavailable) {
        firstUnavailable = {
          ...resolved,
          item,
          reason: resolved.reason || "no_available_terminal",
        };
      }
    }
    return null;
  };

  return tryItems((resolved) => Boolean(resolved.hasExplicitTerminalTarget), "targeted_terminal_available")
    || tryItems((resolved) => !resolved.hasExplicitTerminalTarget, "generic_terminal_available")
    || {
      item: firstUnavailable?.item || selectableItems[0] || null,
      target: null,
      reason: firstUnavailable?.reason || "no_available_terminal",
      unavailable: firstUnavailable,
    };
}

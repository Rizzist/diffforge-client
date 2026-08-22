export function sessionPaneToken(sessionId) {
  return String(sessionId || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "session";
}

export function sessionPaneId(sessionId) {
  // Keeps the pane-id shape the backend already parses:
  // workspace-terminal-{token}-{index}-{role}.
  return `workspace-terminal-${sessionPaneToken(sessionId)}-0-haider`;
}

export function effectiveSessionPaneId(paneOverrides, sessionId) {
  return paneOverrides?.[sessionId] || sessionPaneId(sessionId);
}

export function rehomeSessionViewMode(
  viewModes,
  { hostSessionId, targetSessionId },
) {
  const current = viewModes || {};
  if (!hostSessionId || !targetSessionId || hostSessionId === targetSessionId) {
    return current;
  }

  /* Only a visible Shell follows the pane. A hidden/warm terminal behind
     Chat does not make the materialization Shell-originated. Writing "ui"
     explicitly also prevents an old target preference from winning. */
  const targetMode = current[hostSessionId] === "terminal" ? "terminal" : "ui";
  if (current[targetSessionId] === targetMode) {
    return current;
  }
  return { ...current, [targetSessionId]: targetMode };
}

export function rehomeSessionPane(
  paneOverrides,
  { paneId, hostSessionId, targetSessionId },
) {
  const current = paneOverrides || {};
  if (!paneId || !hostSessionId || !targetSessionId || hostSessionId === targetSessionId) {
    return current;
  }
  const hostPaneId = effectiveSessionPaneId(current, hostSessionId);
  if (hostPaneId !== paneId) {
    return current;
  }
  const targetPaneId = effectiveSessionPaneId(current, targetSessionId);
  if (targetPaneId === paneId) {
    return current;
  }

  /* Move both sides. A one-way target override leaves the host falling back
     to the same canonical pane, so two mounted xterms claim one backend PTY. */
  return {
    ...current,
    [hostSessionId]: targetPaneId,
    [targetSessionId]: paneId,
  };
}

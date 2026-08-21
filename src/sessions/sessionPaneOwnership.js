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

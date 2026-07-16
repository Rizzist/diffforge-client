export async function restartStaleProviderTerminalsAcrossWorkspaces({
  enabledWorkspaceIds,
  provider,
  resolveTerminal,
  restartTerminalSession,
  staleRows,
  terminalPaneId,
}) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  if (!normalizedProvider) {
    return { blocked: 0, queued: 0, restarted: 0, workspaces: [] };
  }
  const enabled = new Set(
    [...(enabledWorkspaceIds || [])]
      .map((workspaceId) => String(workspaceId || "").trim())
      .filter(Boolean),
  );
  let restarted = 0;
  let queued = 0;
  let blocked = 0;
  const touchedWorkspaces = new Set();

  for (const row of Array.isArray(staleRows) ? staleRows : []) {
    if (String(row?.kind || row?.provider || "").trim().toLowerCase() !== normalizedProvider) {
      continue;
    }
    const workspaceId = String(row?.workspace_id || "").trim();
    const terminalIndex = Number(row?.terminal_index);
    const paneId = String(row?.pane_id || "").trim();
    if (!workspaceId || !enabled.has(workspaceId) || !Number.isInteger(terminalIndex)) {
      continue;
    }
    if (
      row?.needs_restart === false
    ) {
      blocked += 1;
      continue;
    }

    const terminal = resolveTerminal({ paneId, row, terminalIndex, workspaceId });
    const livePaneId = String(terminalPaneId(terminal) || "").trim();
    if (!terminal || (paneId && livePaneId && livePaneId !== paneId)) {
      blocked += 1;
      continue;
    }
    const instanceId = Number(row?.instance_id);
    const launchEpoch = String(row?.launch_epoch || "").trim();
    if (!Number.isSafeInteger(instanceId) || instanceId <= 0 || !launchEpoch) {
      blocked += 1;
      continue;
    }
    const result = await restartTerminalSession({
      instanceId,
      launchEpoch,
      mode: "restart_when_idle",
      paneId,
      provider: normalizedProvider,
      row,
      terminalIndex,
      workspaceId,
    });
    if (result?.status === "queued" || result?.queued === true) {
      queued += 1;
      touchedWorkspaces.add(workspaceId);
      continue;
    }
    if (result?.status !== "completed") {
      blocked += 1;
      continue;
    }
    restarted += 1;
    touchedWorkspaces.add(workspaceId);
  }

  return { blocked, queued, restarted, workspaces: [...touchedWorkspaces] };
}

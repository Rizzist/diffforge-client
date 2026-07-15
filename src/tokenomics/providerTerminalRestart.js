export async function restartStaleProviderTerminalsAcrossWorkspaces({
  enabledWorkspaceIds,
  provider,
  relaunchTerminal,
  resolveTerminal,
  restartIfIdle,
  staleRows,
  terminalIsIdle,
  terminalPaneId,
}) {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  if (!normalizedProvider) {
    return { blocked: 0, restarted: 0, workspaces: [] };
  }
  const enabled = new Set(
    [...(enabledWorkspaceIds || [])]
      .map((workspaceId) => String(workspaceId || "").trim())
      .filter(Boolean),
  );
  let restarted = 0;
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
      || row?.restart_eligible !== true
      || row?.idle !== true
      || row?.busy === true
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
    if (!terminalIsIdle(terminal)) {
      blocked += 1;
      continue;
    }

    const instanceId = Number(row?.instance_id);
    const launchEpoch = String(row?.launch_epoch || "").trim();
    if (!Number.isSafeInteger(instanceId) || instanceId <= 0 || !launchEpoch) {
      blocked += 1;
      continue;
    }
    const guarded = await restartIfIdle({ instanceId, launchEpoch, paneId, row });
    if (guarded?.restarted !== true) {
      blocked += 1;
      continue;
    }
    relaunchTerminal({ paneId, provider: normalizedProvider, row, terminalIndex, workspaceId });
    restarted += 1;
    touchedWorkspaces.add(workspaceId);
  }

  return { blocked, restarted, workspaces: [...touchedWorkspaces] };
}

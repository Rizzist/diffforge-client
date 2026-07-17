// ---- Stale-roster reconciliation ------------------------------------------
//
// The backend's stale inventory joins per-pane launch stamps against live
// terminals. Two failure modes leave that roster stale on the frontend:
//   1. A pane that no longer exists in the workspace's CURRENT terminal set
//      (closed terminal, app-control pane miscounted into a workspace) keeps
//      a phantom "Terminal N needs restart" row alive.
//   2. A pane whose stamp was never rewritten after a completed restart keeps
//      claiming "needs restart" forever, and the bulk "Restart N idle" flow
//      resurrects the badge by restarting it again.
// The ledger below records the exact stale CLAIM (stamped -> target identity)
// that a completed restart already serviced, and the presence resolver lets
// the app shell veto rows whose terminal is gone. Both are fail-open: an
// unknown pane or workspace keeps its row so legitimately stale terminals
// never flicker out.

const RESTARTED_CLAIMS_MAX_PANES = 200;
const restartedProviderTerminalClaims = new Map();
let staleTerminalLivePresenceResolver = null;

function providerTerminalClaimKey(row) {
  return String(row?.pane_id || "").trim();
}

function providerTerminalClaimIdentity(row) {
  return {
    provider: String(row?.kind || row?.provider || "").trim().toLowerCase(),
    stamped_auth_revision: String(row?.stamped_auth_revision || "").trim(),
    stamped_profile_id: String(row?.stamped_profile_id || "").trim(),
    target_auth_revision: String(row?.target_auth_revision || "").trim(),
    target_profile_id: String(row?.target_profile_id || "").trim(),
  };
}

/** AppShell registers the frontend live-terminal set here. The resolver gets
 * `{ paneId, terminalIndex, workspaceId }` and returns true (present), false
 * (definitively absent from the workspace's current terminals), or null when
 * the workspace snapshot is unknown (fail open). Returns an unregister fn. */
export function registerStaleTerminalLivePresence(resolver) {
  const safeResolver = typeof resolver === "function" ? resolver : null;
  staleTerminalLivePresenceResolver = safeResolver;
  return () => {
    if (staleTerminalLivePresenceResolver === safeResolver) {
      staleTerminalLivePresenceResolver = null;
    }
  };
}

/** Record that a completed restart serviced this row's stale claim. Keyed by
 * pane and replaced on every restart, so only the LATEST restarted claim is
 * suppressed; any different stamped/target pair (a genuinely new staleness)
 * still surfaces. */
export function recordRestartedProviderTerminalClaim(row) {
  const paneId = providerTerminalClaimKey(row);
  if (!paneId) {
    return;
  }
  if (restartedProviderTerminalClaims.size > RESTARTED_CLAIMS_MAX_PANES) {
    restartedProviderTerminalClaims.clear();
  }
  restartedProviderTerminalClaims.set(paneId, providerTerminalClaimIdentity(row));
}

export function isRestartedProviderTerminalClaim(row) {
  const paneId = providerTerminalClaimKey(row);
  if (!paneId) {
    return false;
  }
  const recorded = restartedProviderTerminalClaims.get(paneId);
  if (!recorded) {
    return false;
  }
  const claim = providerTerminalClaimIdentity(row);
  return recorded.provider === claim.provider
    && recorded.stamped_profile_id === claim.stamped_profile_id
    && recorded.stamped_auth_revision === claim.stamped_auth_revision
    && recorded.target_profile_id === claim.target_profile_id
    && recorded.target_auth_revision === claim.target_auth_revision;
}

export function resetProviderTerminalStaleReconciliation() {
  restartedProviderTerminalClaims.clear();
  staleTerminalLivePresenceResolver = null;
}

/** Reconcile backend stale rows against the CURRENT frontend truth: drop
 * claims a completed restart already serviced and rows whose terminal no
 * longer exists. Unknown presence (no resolver, missing workspace snapshot,
 * resolver error) keeps the row — legit stale terminals must never vanish. */
export function reconcileProviderTerminalStaleRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (isRestartedProviderTerminalClaim(row)) {
      return false;
    }
    if (!staleTerminalLivePresenceResolver) {
      return true;
    }
    const terminalIndex = Number(row?.terminal_index);
    let present = null;
    try {
      present = staleTerminalLivePresenceResolver({
        paneId: providerTerminalClaimKey(row),
        terminalIndex: Number.isInteger(terminalIndex) ? terminalIndex : null,
        workspaceId: String(row?.workspace_id || "").trim(),
      });
    } catch {
      present = null;
    }
    return present !== false;
  });
}

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

  // Drop claims a completed restart already serviced and rows whose terminal
  // no longer exists — the bulk "Restart N idle" flow must never resurrect a
  // cleared badge by restarting a stale-stamped pane again.
  for (const row of reconcileProviderTerminalStaleRows(staleRows)) {
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
    // The replacement session adopted the target account; a later snapshot
    // that still carries this exact stale claim is a stale stamp, not a
    // terminal that needs another restart.
    recordRestartedProviderTerminalClaim(row);
    restarted += 1;
    touchedWorkspaces.add(workspaceId);
  }

  return { blocked, queued, restarted, workspaces: [...touchedWorkspaces] };
}

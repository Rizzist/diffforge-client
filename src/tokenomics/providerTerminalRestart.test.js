import assert from "node:assert/strict";
import test from "node:test";

import {
  isRestartedProviderTerminalClaim,
  reconcileProviderTerminalStaleRows,
  recordRestartedProviderTerminalClaim,
  registerStaleTerminalLivePresence,
  resetProviderTerminalStaleReconciliation,
  restartStaleProviderTerminalsAcrossWorkspaces,
} from "./providerTerminalRestart.js";

function staleRow(overrides = {}) {
  return {
    busy: false,
    idle: true,
    instance_id: 21,
    kind: "claude",
    launch_epoch: "pane-x:21",
    needs_restart: true,
    pane_id: "pane-x",
    restart_eligible: true,
    stamped_auth_revision: "rev-a",
    stamped_profile_id: "profile-a",
    target_auth_revision: "rev-b",
    target_profile_id: "profile-b",
    terminal_index: 0,
    workspace_id: "w1",
    ...overrides,
  };
}

test("provider-wide restart spans enabled workspaces and queues busy panes", async () => {
  resetProviderTerminalStaleReconciliation();
  const requested = [];
  const rows = [
    {
      busy: false,
      idle: true,
      instance_id: 11,
      kind: "codex",
      launch_epoch: "pane-a:11",
      needs_restart: true,
      pane_id: "pane-a",
      restart_eligible: true,
      terminal_index: 0,
      workspace_id: "w1",
    },
    {
      busy: true,
      idle: false,
      instance_id: 12,
      kind: "codex",
      launch_epoch: "pane-b:12",
      needs_restart: true,
      pane_id: "pane-b",
      restart_eligible: false,
      terminal_index: 1,
      workspace_id: "w2",
    },
    {
      busy: false,
      idle: true,
      instance_id: 13,
      kind: "codex",
      launch_epoch: "pane-c:13",
      needs_restart: true,
      pane_id: "pane-c",
      restart_eligible: true,
      terminal_index: 2,
      workspace_id: "w2",
    },
    {
      busy: false,
      idle: true,
      instance_id: 14,
      kind: "codex",
      launch_epoch: "pane-disabled:14",
      needs_restart: true,
      pane_id: "pane-disabled",
      restart_eligible: true,
      terminal_index: 0,
      workspace_id: "w3",
    },
  ];

  const result = await restartStaleProviderTerminalsAcrossWorkspaces({
    enabledWorkspaceIds: new Set(["w1", "w2"]),
    provider: "codex",
    staleRows: rows,
    resolveTerminal: ({ paneId, row }) => ({ pane_id: paneId, state: row.busy ? "busy" : "idle" }),
    terminalPaneId: (terminal) => terminal?.pane_id,
    restartTerminalSession: async ({ mode, paneId, row }) => {
      requested.push({ mode, paneId });
      return row.busy ? { status: "queued" } : { status: "completed" };
    },
  });

  assert.deepEqual(requested, [
    { mode: "restart_when_idle", paneId: "pane-a" },
    { mode: "restart_when_idle", paneId: "pane-b" },
    { mode: "restart_when_idle", paneId: "pane-c" },
  ]);
  assert.deepEqual(result, {
    blocked: 0,
    queued: 1,
    restarted: 2,
    workspaces: ["w1", "w2"],
  });
});

test("reconcile drops rows whose terminal is gone but fails open on unknown workspaces", () => {
  resetProviderTerminalStaleReconciliation();
  const release = registerStaleTerminalLivePresence(({ paneId, workspaceId }) => {
    if (workspaceId === "unknown-workspace") return null;
    return paneId !== "pane-gone";
  });
  try {
    const rows = [
      staleRow({ pane_id: "pane-live" }),
      staleRow({ pane_id: "pane-gone", terminal_index: 4 }),
      staleRow({ pane_id: "pane-unhydrated", workspace_id: "unknown-workspace" }),
    ];
    assert.deepEqual(
      reconcileProviderTerminalStaleRows(rows).map((row) => row.pane_id),
      ["pane-live", "pane-unhydrated"],
    );
  } finally {
    release();
  }
});

test("reconcile keeps every row when no presence resolver is registered", () => {
  resetProviderTerminalStaleReconciliation();
  const rows = [staleRow(), staleRow({ pane_id: "pane-y", terminal_index: 1 })];
  assert.deepEqual(reconcileProviderTerminalStaleRows(rows), rows);
});

test("a completed restart records the claim so the badge clears and stays cleared", async () => {
  resetProviderTerminalStaleReconciliation();
  const row = staleRow();
  const requested = [];
  const restart = () => restartStaleProviderTerminalsAcrossWorkspaces({
    enabledWorkspaceIds: new Set(["w1"]),
    provider: "claude",
    staleRows: [row],
    resolveTerminal: ({ paneId }) => ({ pane_id: paneId }),
    terminalPaneId: (terminal) => terminal?.pane_id,
    restartTerminalSession: async ({ paneId }) => {
      requested.push(paneId);
      return { status: "completed" };
    },
  });

  const first = await restart();
  assert.equal(first.restarted, 1);
  assert.equal(isRestartedProviderTerminalClaim(row), true);
  // A stale backend stamp that still reports the serviced claim is filtered
  // from the roster instead of resurrecting the badge.
  assert.deepEqual(reconcileProviderTerminalStaleRows([row]), []);
  // The bulk "Restart N idle" flow skips the serviced claim entirely.
  const second = await restart();
  assert.deepEqual(second, { blocked: 0, queued: 0, restarted: 0, workspaces: [] });
  assert.deepEqual(requested, ["pane-x"]);
});

test("a genuinely new stale claim on a restarted pane still surfaces", () => {
  resetProviderTerminalStaleReconciliation();
  recordRestartedProviderTerminalClaim(staleRow());
  // Same pane, but the active account moved on (new target profile): the
  // pane legitimately needs another restart and must not be suppressed.
  const newerClaim = staleRow({ target_auth_revision: "rev-c", target_profile_id: "profile-c" });
  assert.equal(isRestartedProviderTerminalClaim(newerClaim), false);
  assert.deepEqual(reconcileProviderTerminalStaleRows([newerClaim]), [newerClaim]);
  // A different launch stamp (the pane relaunched under another account)
  // also surfaces.
  const restampedClaim = staleRow({ stamped_auth_revision: "rev-z", stamped_profile_id: "profile-z" });
  assert.equal(isRestartedProviderTerminalClaim(restampedClaim), false);
});

test("the ledger keeps only the latest serviced claim per pane", () => {
  resetProviderTerminalStaleReconciliation();
  const claimToB = staleRow();
  const claimToC = staleRow({ target_auth_revision: "rev-c", target_profile_id: "profile-c" });
  recordRestartedProviderTerminalClaim(claimToB);
  recordRestartedProviderTerminalClaim(claimToC);
  assert.equal(isRestartedProviderTerminalClaim(claimToC), true);
  // The older claim is live again (e.g. the account switched back): show it.
  assert.equal(isRestartedProviderTerminalClaim(claimToB), false);
});

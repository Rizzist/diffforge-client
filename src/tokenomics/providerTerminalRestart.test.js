import assert from "node:assert/strict";
import test from "node:test";

import { restartStaleProviderTerminalsAcrossWorkspaces } from "./providerTerminalRestart.js";

test("provider-wide restart spans enabled workspaces and leaves busy panes running", async () => {
  const restartedPaneIds = [];
  const relaunched = [];
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
    resolveTerminal: ({ paneId }) => ({ pane_id: paneId, state: "idle" }),
    terminalPaneId: (terminal) => terminal?.pane_id,
    terminalIsIdle: (terminal) => terminal?.state === "idle",
    restartIfIdle: async ({ paneId }) => {
      restartedPaneIds.push(paneId);
      return { restarted: true };
    },
    relaunchTerminal: ({ paneId, workspaceId }) => relaunched.push({ paneId, workspaceId }),
  });

  assert.deepEqual(restartedPaneIds, ["pane-a", "pane-c"]);
  assert.deepEqual(relaunched, [
    { paneId: "pane-a", workspaceId: "w1" },
    { paneId: "pane-c", workspaceId: "w2" },
  ]);
  assert.deepEqual(result, { blocked: 1, restarted: 2, workspaces: ["w1", "w2"] });
});

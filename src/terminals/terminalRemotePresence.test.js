import assert from "node:assert/strict";
import test from "node:test";

import {
  getTerminalRemotePresenceForPane,
  normalizeTerminalRemotePresenceWorkspaceId,
} from "./terminalRemotePresence.js";

test("terminal remote presence workspace normalization mirrors backend keys", () => {
  assert.equal(
    normalizeTerminalRemotePresenceWorkspaceId(" /srv/Repo/ ", "linux"),
    "/srv/Repo",
  );
  assert.notEqual(
    normalizeTerminalRemotePresenceWorkspaceId("/srv/Repo", "linux"),
    normalizeTerminalRemotePresenceWorkspaceId("/srv/repo", "linux"),
  );
  assert.equal(
    normalizeTerminalRemotePresenceWorkspaceId("C:\\Users\\Rizzi\\Code\\DiffForge\\", "windows"),
    "c:/users/rizzi/code/diffforge",
  );
  assert.equal(
    normalizeTerminalRemotePresenceWorkspaceId("//?/C:\\Users\\Rizzi\\Code\\DiffForge\\", "windows"),
    "c:/users/rizzi/code/diffforge",
  );
});

test("terminal remote presence matches equivalent normalized workspace ids", () => {
  const item = {
    instance_id: 3,
    pane_id: "shared-pane",
    shell_controller: false,
    shell_viewers: 1,
    stream_key: "stream-a",
    workspace_id: "/workspace-a",
  };
  const presence = getTerminalRemotePresenceForPane({ items: [item] }, {
    workspaceId: "/workspace-a/",
    paneId: "shared-pane",
    instanceId: 3,
  });

  assert.equal(presence, item);
});

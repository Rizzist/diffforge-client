import test from "node:test";
import assert from "node:assert/strict";

import {
  WORKSPACE_PROJECT_INVENTORY_LIMIT,
  buildPcbProjectInventory,
  buildVideoProjectInventory,
  findWorkspaceProjectMatch,
  normalizeWorkspaceProjectEntry,
  normalizeWorkspaceProjectList,
  pcbProjectIdFromPath,
  validateWorkspaceProjectCommandPayload,
  validateWorkspaceProjectCommandWorkspace,
  videoProjectIdFromPath,
  workspaceProjectActiveIdFromPath,
  workspaceProjectCommandRequestedWorkspaceId,
  workspaceProjectInventoriesEqual,
} from "./workspaceProjectInventory.js";

test("pcbProjectIdFromPath strips the board extension", () => {
  assert.equal(pcbProjectIdFromPath("hardware/main-board/main-board.board.tsx"), "main-board");
  assert.equal(pcbProjectIdFromPath("hardware\\nested\\other.board.tsx"), "other");
  assert.equal(pcbProjectIdFromPath(""), "");
});

test("videoProjectIdFromPath strips pipe and legacy extensions", () => {
  assert.equal(videoProjectIdFromPath("media/projects/launch-video.video.pipe"), "launch-video");
  assert.equal(videoProjectIdFromPath("media/projects/old-cut.video.json"), "old-cut");
  assert.equal(videoProjectIdFromPath("media/projects/loose-file.txt"), "loose-file.txt");
});

test("normalizeWorkspaceProjectEntry emits the pinned snake_case row", () => {
  const row = normalizeWorkspaceProjectEntry({
    id: " board-1 ",
    name: " Board One ",
    path: " hardware/board-1/board-1.board.tsx ",
    updated_at_ms: 1234.7,
  });
  assert.deepEqual(row, {
    id: "board-1",
    name: "Board One",
    path: "hardware/board-1/board-1.board.tsx",
    updated_at_ms: 1234,
  });
});

test("normalizeWorkspaceProjectEntry falls back id->path and name->id, drops zero timestamps", () => {
  const row = normalizeWorkspaceProjectEntry({ path: "media/projects/a.video.pipe", updated_at_ms: 0 });
  assert.deepEqual(row, {
    id: "media/projects/a.video.pipe",
    name: "media/projects/a.video.pipe",
    path: "media/projects/a.video.pipe",
  });
  assert.equal(normalizeWorkspaceProjectEntry({ name: "no path" }), null);
  assert.equal(normalizeWorkspaceProjectEntry(null), null);
});

test("normalizeWorkspaceProjectList dedupes by path and caps at the inventory limit", () => {
  const entries = Array.from({ length: WORKSPACE_PROJECT_INVENTORY_LIMIT + 10 }, (_, index) => ({
    id: `board-${index}`,
    name: `Board ${index}`,
    path: `hardware/board-${index % 55}/board-${index % 55}.board.tsx`,
  }));
  const rows = normalizeWorkspaceProjectList(entries);
  assert.equal(rows.length, WORKSPACE_PROJECT_INVENTORY_LIMIT);
  const paths = new Set(rows.map((row) => row.path));
  assert.equal(paths.size, rows.length);
});

test("buildPcbProjectInventory keeps board ids and derives missing ones", () => {
  const rows = buildPcbProjectInventory([
    { id: "main", name: "main", path: "hardware/main/main.board.tsx", updated_at_ms: 42 },
    { name: "derived", path: "hardware/derived/derived.board.tsx" },
    { name: "skipped-no-path" },
  ]);
  assert.deepEqual(rows, [
    { id: "main", name: "main", path: "hardware/main/main.board.tsx", updated_at_ms: 42 },
    { id: "derived", name: "derived", path: "hardware/derived/derived.board.tsx" },
  ]);
});

test("buildVideoProjectInventory derives slug ids from project paths", () => {
  const rows = buildVideoProjectInventory([
    { name: "Launch", path: "media/projects/launch.video.pipe", updated_at_ms: 7 },
    { name: "Legacy", path: "media/projects/legacy.video.json" },
  ]);
  assert.deepEqual(rows, [
    { id: "launch", name: "Launch", path: "media/projects/launch.video.pipe", updated_at_ms: 7 },
    { id: "legacy", name: "Legacy", path: "media/projects/legacy.video.json" },
  ]);
});

test("findWorkspaceProjectMatch prefers path, then id, then name", () => {
  const projects = [
    { id: "one", name: "First", path: "media/projects/one.video.pipe" },
    { id: "two", name: "Second", path: "media/projects/two.video.pipe" },
  ];
  assert.equal(
    findWorkspaceProjectMatch(projects, { project_id: "one", path: "media/projects/two.video.pipe" }).id,
    "two",
  );
  assert.equal(findWorkspaceProjectMatch(projects, { project_id: "one" }).id, "one");
  assert.equal(findWorkspaceProjectMatch(projects, { project_id: "Second" }).id, "two");
  assert.equal(findWorkspaceProjectMatch(projects, { project_id: "missing" }), null);
  assert.equal(findWorkspaceProjectMatch(projects, {}), null);
});

test("workspaceProjectActiveIdFromPath maps active paths to inventory ids", () => {
  assert.equal(
    workspaceProjectActiveIdFromPath(
      "hardware/power-board/power-board.board.tsx",
      [],
      "pcb",
    ),
    "power-board",
  );
  assert.equal(
    workspaceProjectActiveIdFromPath(
      "media/projects/launch.video.pipe",
      [{ id: "launch", name: "Launch", path: "media/projects/launch.video.pipe" }],
      "video",
    ),
    "launch",
  );
  assert.equal(
    workspaceProjectActiveIdFromPath("media/projects/legacy.video.json", [], "video"),
    "legacy",
  );
  assert.equal(workspaceProjectActiveIdFromPath("", [], "pcb"), null);
});

test("validateWorkspaceProjectCommandPayload enforces create names", () => {
  assert.equal(validateWorkspaceProjectCommandPayload({ action: "create", name: "Board" }).ok, true);
  const missing = validateWorkspaceProjectCommandPayload({ action: "create", name: "  " });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "invalid_name");
  const tooLong = validateWorkspaceProjectCommandPayload({ action: "create", name: "x".repeat(121) });
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.reason, "invalid_name");
});

test("validateWorkspaceProjectCommandPayload requires a project reference for delete/open", () => {
  assert.equal(validateWorkspaceProjectCommandPayload({ action: "delete", project_id: "one" }).ok, true);
  assert.equal(validateWorkspaceProjectCommandPayload({ action: "open", path: "media/projects/one.video.pipe" }).ok, true);
  const missing = validateWorkspaceProjectCommandPayload({ action: "open" });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "missing_project_reference");
  const unsupported = validateWorkspaceProjectCommandPayload({ action: "rename", project_id: "one" });
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.reason, "unsupported_action");
});

test("validateWorkspaceProjectCommandWorkspace requires an explicit known workspace id", () => {
  const workspaces = [{ id: "ws-known" }];
  assert.equal(workspaceProjectCommandRequestedWorkspaceId({
    payload: { workspace_id: " ws-known " },
  }), "ws-known");

  const missing = validateWorkspaceProjectCommandWorkspace({}, workspaces);
  assert.deepEqual(missing, {
    ok: false,
    reason: "workspace_not_found",
    workspace: null,
    workspace_id: "",
  });

  const unknown = validateWorkspaceProjectCommandWorkspace({
    request: { workspace_id: "ws-missing" },
  }, workspaces);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.reason, "workspace_not_found");
  assert.equal(unknown.workspace_id, "ws-missing");

  const known = validateWorkspaceProjectCommandWorkspace({
    workspace_id: "ws-known",
  }, (workspaceId) => workspaces.find((workspace) => workspace.id === workspaceId));
  assert.equal(known.ok, true);
  assert.equal(known.workspace_id, "ws-known");
  assert.equal(known.workspace, workspaces[0]);
});

test("workspaceProjectInventoriesEqual compares rows structurally", () => {
  const left = {
    "ws-1": {
      pcb_active_project_id: "a",
      video_active_project_id: null,
      pcb_projects: [{ id: "a", name: "a", path: "hardware/a/a.board.tsx" }],
      video_projects: [],
    },
  };
  const same = {
    "ws-1": {
      pcb_active_project_id: "a",
      video_active_project_id: null,
      pcb_projects: [{ id: "a", name: "a", path: "hardware/a/a.board.tsx" }],
      video_projects: [],
    },
  };
  const different = {
    "ws-1": {
      pcb_active_project_id: null,
      video_active_project_id: null,
      pcb_projects: [{ id: "a", name: "a", path: "hardware/a/a.board.tsx", updated_at_ms: 5 }],
      video_projects: [],
    },
  };
  assert.equal(workspaceProjectInventoriesEqual(left, same), true);
  assert.equal(workspaceProjectInventoriesEqual(left, different), false);
  assert.equal(workspaceProjectInventoriesEqual(left, {}), false);
  assert.equal(workspaceProjectInventoriesEqual({}, {}), true);
});

// Level 1 remote PCB/Video project management — pure helpers.
//
// Inventory side: the per-workspace `pcb_projects` / `video_projects` arrays
// ride the fire-and-forget workspace catalog snapshot
// (cloud_mcp_sync_device_workspaces_snapshot). Rows are normalized to the
// pinned snake_case contract `{ id, name, path, updated_at_ms? }`, deduped by
// repo-relative path, and capped so the cloud payload stays small.
//
// Command side: payload validation + project resolution for the six remote
// command kinds (pcb_project_create/delete/open, video_project_create/
// delete/open) handled in AppShell's remote-command listener.

export const WORKSPACE_PROJECT_INVENTORY_LIMIT = 50;
export const WORKSPACE_PROJECT_NAME_LIMIT = 120;

const WORKSPACE_PROJECT_TEXT_LIMIT = 256;
const WORKSPACE_PROJECT_PATH_LIMIT = 1024;

const PCB_BOARD_EXTENSION = ".board.tsx";
const VIDEO_PROJECT_EXTENSIONS = [".video.pipe", ".video.json"];

function cleanWorkspaceProjectText(value, limit = WORKSPACE_PROJECT_TEXT_LIMIT) {
  return String(value ?? "").trim().slice(0, limit);
}

function cleanWorkspaceProjectPath(value) {
  return cleanWorkspaceProjectText(value, WORKSPACE_PROJECT_PATH_LIMIT).replace(/\\/g, "/");
}

function workspaceProjectPathLeaf(path) {
  return cleanWorkspaceProjectPath(path).split("/").filter(Boolean).pop() || "";
}

// Board id = file name without the .board.tsx extension (pcb.rs pcb_board_id).
export function pcbProjectIdFromPath(path) {
  const leaf = workspaceProjectPathLeaf(path);
  return leaf.endsWith(PCB_BOARD_EXTENSION)
    ? leaf.slice(0, -PCB_BOARD_EXTENSION.length)
    : leaf;
}

// Project id = file name without the .video.pipe / .video.json extension
// (video_editor.rs video_project_slug_from_file_name).
export function videoProjectIdFromPath(path) {
  const leaf = workspaceProjectPathLeaf(path);
  for (const extension of VIDEO_PROJECT_EXTENSIONS) {
    if (leaf.endsWith(extension)) {
      return leaf.slice(0, -extension.length);
    }
  }
  return leaf;
}

export function normalizeWorkspaceProjectEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }
  const path = cleanWorkspaceProjectPath(
    entry.path ?? entry.project_path ?? entry.board_path,
  );
  if (!path) {
    return null;
  }
  const id = cleanWorkspaceProjectText(
    entry.id ?? entry.project_id ?? entry.board_id,
  ) || path;
  const name = cleanWorkspaceProjectText(
    entry.name ?? entry.project_name ?? entry.title,
  ) || id;
  const updatedAtMs = Number(entry.updated_at_ms ?? entry.updatedAtMs);
  const row = { id, name, path };
  if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) {
    row.updated_at_ms = Math.floor(updatedAtMs);
  }
  return row;
}

export function normalizeWorkspaceProjectList(entries, limit = WORKSPACE_PROJECT_INVENTORY_LIMIT) {
  const rows = [];
  const seenPaths = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const row = normalizeWorkspaceProjectEntry(entry);
    if (!row || seenPaths.has(row.path)) {
      continue;
    }
    seenPaths.add(row.path);
    rows.push(row);
    if (rows.length >= limit) {
      break;
    }
  }
  return rows;
}

// pcb_documents_list boards → inventory rows ({ id, name, path, updatedAtMs }).
export function buildPcbProjectInventory(boards) {
  return normalizeWorkspaceProjectList(
    (Array.isArray(boards) ? boards : []).map((board) => ({
      ...(board && typeof board === "object" ? board : {}),
      id: String(board?.id || "").trim() || pcbProjectIdFromPath(board?.path),
    })),
  );
}

// video_projects_list projects → inventory rows ({ name, path, updatedAtMs }).
export function buildVideoProjectInventory(projects) {
  return normalizeWorkspaceProjectList(
    (Array.isArray(projects) ? projects : []).map((project) => ({
      ...(project && typeof project === "object" ? project : {}),
      id: videoProjectIdFromPath(project?.path),
    })),
  );
}

// Command targets accept project_id | path; path wins, then stable id, then
// display name (ids and names are equal for both surfaces today, but a
// renamed video project keeps its slug id).
export function findWorkspaceProjectMatch(projects, { project_id: projectId = "", path = "" } = {}) {
  const items = Array.isArray(projects) ? projects : [];
  const cleanPath = cleanWorkspaceProjectPath(path);
  if (cleanPath) {
    const byPath = items.find((project) => project?.path === cleanPath);
    if (byPath) {
      return byPath;
    }
  }
  const cleanId = cleanWorkspaceProjectText(projectId);
  if (cleanId) {
    const byId = items.find((project) => project?.id === cleanId);
    if (byId) {
      return byId;
    }
    const byName = items.find((project) => project?.name === cleanId);
    if (byName) {
      return byName;
    }
  }
  return null;
}

export function workspaceProjectActiveIdFromPath(path, projects = [], kind = "") {
  const cleanPath = cleanWorkspaceProjectPath(path);
  if (!cleanPath) {
    return null;
  }
  const matchedId = cleanWorkspaceProjectText(
    findWorkspaceProjectMatch(projects, { path: cleanPath })?.id,
  );
  if (matchedId) {
    return matchedId;
  }
  const normalizedKind = cleanWorkspaceProjectText(kind).toLowerCase();
  const derivedId = normalizedKind === "video"
    ? videoProjectIdFromPath(cleanPath)
    : normalizedKind === "pcb"
      ? pcbProjectIdFromPath(cleanPath)
      : cleanPath;
  return cleanWorkspaceProjectText(derivedId) || null;
}

export function validateWorkspaceProjectCommandPayload({
  action = "",
  name = "",
  project_id: projectId = "",
  path = "",
} = {}) {
  if (action === "create") {
    const trimmedName = String(name ?? "").trim();
    if (!trimmedName || trimmedName.length > WORKSPACE_PROJECT_NAME_LIMIT) {
      return {
        ok: false,
        reason: "invalid_name",
        message: `Project create needs a name of 1-${WORKSPACE_PROJECT_NAME_LIMIT} characters.`,
      };
    }
    return { ok: true, reason: "" };
  }
  if (action === "delete" || action === "open") {
    if (!cleanWorkspaceProjectText(projectId) && !cleanWorkspaceProjectPath(path)) {
      return {
        ok: false,
        reason: "missing_project_reference",
        message: "Project command needs a project_id or path.",
      };
    }
    return { ok: true, reason: "" };
  }
  return {
    ok: false,
    reason: "unsupported_action",
    message: `Unsupported project action: ${String(action || "")}`,
  };
}

export function workspaceProjectCommandRequestedWorkspaceId(event = {}) {
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const request = event?.request && typeof event.request === "object" ? event.request : {};
  return cleanWorkspaceProjectText(
    event?.workspace_id || payload.workspace_id || request.workspace_id,
  );
}

export function validateWorkspaceProjectCommandWorkspace(event = {}, workspaceResolver = null) {
  const workspaceId = workspaceProjectCommandRequestedWorkspaceId(event);
  if (!workspaceId) {
    return { ok: false, reason: "workspace_not_found", workspace: null, workspace_id: "" };
  }
  let workspace = null;
  if (typeof workspaceResolver === "function") {
    workspace = workspaceResolver(workspaceId) || null;
  } else if (Array.isArray(workspaceResolver)) {
    workspace = workspaceResolver.find((candidate) => (
      cleanWorkspaceProjectText(candidate?.id ?? candidate?.workspace_id) === workspaceId
    )) || null;
  }
  if (!workspace) {
    return { ok: false, reason: "workspace_not_found", workspace: null, workspace_id: workspaceId };
  }
  return { ok: true, reason: "", workspace, workspace_id: workspaceId };
}

function workspaceProjectRowsEqual(left, right) {
  const leftRows = Array.isArray(left) ? left : [];
  const rightRows = Array.isArray(right) ? right : [];
  if (leftRows.length !== rightRows.length) {
    return false;
  }
  return leftRows.every((row, index) => {
    const other = rightRows[index];
    return row?.id === other?.id
      && row?.name === other?.name
      && row?.path === other?.path
      && (row?.updated_at_ms ?? null) === (other?.updated_at_ms ?? null);
  });
}

export function workspaceProjectInventoriesEqual(left, right) {
  const leftEntries = left && typeof left === "object" ? left : {};
  const rightEntries = right && typeof right === "object" ? right : {};
  const leftKeys = Object.keys(leftEntries);
  const rightKeys = Object.keys(rightEntries);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((workspaceId) => {
    const leftEntry = leftEntries[workspaceId];
    const rightEntry = rightEntries[workspaceId];
    if (!rightEntry) {
      return false;
    }
    return workspaceProjectRowsEqual(leftEntry?.pcb_projects, rightEntry?.pcb_projects)
      && workspaceProjectRowsEqual(leftEntry?.video_projects, rightEntry?.video_projects)
      && (leftEntry?.pcb_active_project_id ?? null) === (rightEntry?.pcb_active_project_id ?? null)
      && (leftEntry?.video_active_project_id ?? null) === (rightEntry?.video_active_project_id ?? null);
  });
}

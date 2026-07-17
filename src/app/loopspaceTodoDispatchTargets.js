function cleanText(value) {
  return String(value || "").trim();
}

function terminalIndex(terminal = {}) {
  const value = Number(
    terminal.terminal_index
      ?? terminal.target_terminal_index
      ?? terminal.index
      ?? terminal.logical_index
      ?? terminal.panel_index,
  );
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function terminalId(terminal = {}) {
  return cleanText(
    terminal.pane_id
      || terminal.terminal_id
      || terminal.target_terminal_id
      || terminal.panel_id
      || terminal.id,
  );
}

function terminalIds(terminal = {}) {
  return new Set([
    terminal.pane_id,
    terminal.terminal_id,
    terminal.target_terminal_id,
    terminal.panel_id,
    terminal.id,
    terminal.provider_session_id,
    terminal.native_session_id,
    terminal.session_id,
  ].map(cleanText).filter(Boolean));
}

function terminalName(terminal = {}) {
  return cleanText(
    terminal.terminal_nickname
      || terminal.terminal_name
      || terminal.display_name
      || terminal.name
      || terminal.agent_display_name,
  );
}

function terminalThreadId(terminal = {}) {
  return cleanText(terminal.thread_id || terminal.target_thread_id);
}

function normalizedName(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

function workspaceId(workspace = {}) {
  return cleanText(workspace.workspace_id || workspace.id || workspace.target_workspace_id);
}

function terminalsForWorkspace(terminalWorkspaces, targetWorkspaceId) {
  const workspace = (Array.isArray(terminalWorkspaces) ? terminalWorkspaces : [])
    .find((candidate) => workspaceId(candidate) === targetWorkspaceId);
  return Array.isArray(workspace?.terminals) ? workspace.terminals : [];
}

export function normalizeLoopspaceTodoWorkspaceIds(value) {
  const values = Array.isArray(value)
    ? value
    : cleanText(value).split(/[\n,;]+/g);
  const seen = new Set();
  return values
    .map((item) => (
      item && typeof item === "object"
        ? workspaceId(item)
        : cleanText(item).replace(/^["']|["']$/g, "")
    ))
    .filter(Boolean)
    .filter((id) => {
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
}

export function resolveLoopspaceTodoTerminalSelectors({
  targetTerminalId = "",
  targetTerminalIndex = null,
  targetTerminalMode = "auto",
  targetTerminalName = "",
  targetThreadId = "",
  targetWorkspaceIds = [],
  terminalWorkspaces = [],
} = {}) {
  const workspaceIds = normalizeLoopspaceTodoWorkspaceIds(targetWorkspaceIds);
  const requestedId = cleanText(targetTerminalId);
  const requestedIndex = Number.isInteger(targetTerminalIndex) && targetTerminalIndex >= 0
    ? targetTerminalIndex
    : null;
  const requestedName = cleanText(targetTerminalName);
  const requestedThreadId = cleanText(targetThreadId);
  const hasEquivalentSelector = Boolean(
    requestedThreadId || Number.isInteger(requestedIndex) || requestedName,
  );
  const hasSelector = Boolean(requestedId || hasEquivalentSelector);
  const pinned = cleanText(targetTerminalMode).toLowerCase() === "pinned" || hasSelector;

  const requestedIdWorkspace = requestedId
    ? workspaceIds.find((targetWorkspaceId) => (
      terminalsForWorkspace(terminalWorkspaces, targetWorkspaceId)
        .some((terminal) => terminalIds(terminal).has(requestedId))
    )) || (workspaceIds.length === 1 ? workspaceIds[0] : "")
    : "";

  return workspaceIds.map((targetWorkspaceId) => {
    const terminals = terminalsForWorkspace(terminalWorkspaces, targetWorkspaceId);
    const terminalWithRequestedId = requestedId && requestedIdWorkspace === targetWorkspaceId
      ? terminals.find((candidate) => terminalIds(candidate).has(requestedId)) || null
      : null;
    if (requestedId && requestedIdWorkspace === targetWorkspaceId && !terminalWithRequestedId) {
      return {
        workspace_id: targetWorkspaceId,
        target_terminal_mode: "pinned",
        target_terminal_id: requestedId,
        ...(Number.isInteger(requestedIndex) ? { target_terminal_index: requestedIndex } : {}),
        ...(requestedName ? { target_terminal_name: requestedName } : {}),
        ...(requestedThreadId ? { target_thread_id: requestedThreadId } : {}),
      };
    }
    let terminal = terminalWithRequestedId;
    if (!terminal && requestedThreadId) {
      terminal = terminals.find((candidate) => terminalThreadId(candidate) === requestedThreadId) || null;
    }
    if (!terminal && Number.isInteger(requestedIndex)) {
      terminal = terminals.find((candidate) => terminalIndex(candidate) === requestedIndex) || null;
    }
    if (!terminal && requestedName) {
      const targetName = normalizedName(requestedName);
      terminal = terminals.find((candidate) => normalizedName(terminalName(candidate)) === targetName) || null;
    }

    if (terminal) {
      const resolvedId = terminalId(terminal);
      const resolvedIndex = terminalIndex(terminal);
      const resolvedName = terminalName(terminal);
      const resolvedThreadId = terminalThreadId(terminal);
      return {
        workspace_id: targetWorkspaceId,
        target_terminal_mode: "pinned",
        ...(resolvedId ? { target_terminal_id: resolvedId } : {}),
        ...(Number.isInteger(resolvedIndex)
          ? { target_terminal_index: resolvedIndex }
          : Number.isInteger(requestedIndex)
            ? { target_terminal_index: requestedIndex }
            : {}),
        ...(resolvedName || requestedName
          ? { target_terminal_name: resolvedName || requestedName }
          : {}),
        ...(resolvedThreadId || requestedThreadId
          ? { target_thread_id: resolvedThreadId || requestedThreadId }
          : {}),
      };
    }

    if (pinned && hasEquivalentSelector) {
      return {
        workspace_id: targetWorkspaceId,
        target_terminal_mode: "pinned",
        ...(Number.isInteger(requestedIndex) ? { target_terminal_index: requestedIndex } : {}),
        ...(requestedName ? { target_terminal_name: requestedName } : {}),
        ...(requestedThreadId ? { target_thread_id: requestedThreadId } : {}),
      };
    }

    return {
      workspace_id: targetWorkspaceId,
      target_terminal_mode: "auto",
    };
  });
}

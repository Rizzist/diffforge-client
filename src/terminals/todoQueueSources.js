export const TODO_QUEUE_SOURCE_TODO_AUTO = "tui-todo-auto-queue";
export const TODO_QUEUE_SOURCE_PANEL_AGENT_PROMPT = "tui-panel-agent-prompt";
export const TODO_QUEUE_SOURCE_TERMINAL_DIRECT = "tui-terminal-direct-input";
export const TODO_QUEUE_SOURCE_VOICE_AGENT = "tui-voice-agent-queue";
export const TODO_QUEUE_SOURCE_VOICE_PLAN = "tui-voice-plan-queue";
export const TODO_QUEUE_SOURCE_REMOTE_CONTROL = "next-remote-control";

const TODO_QUEUE_REMOTE_LIST_ONLY_COMMANDS = new Set([
  "todo.create",
  "todo_create",
  "workspace_todo_listed_created",
]);

const TODO_QUEUE_REMOTE_LISTED_STATUSES = new Set([
  "in_list",
  "list",
  "listed",
  "ready",
  "released",
  "unqueued",
]);

export function normalizeTodoQueueSourceValue(value) {
  return String(value || "").trim();
}

export function getTodoQueueTerminalTargetIdCandidate(item = {}) {
  const remoteCommand = item?.remote_command && typeof item.remote_command === "object"
    ? item.remote_command
    : item?.remoteCommand && typeof item.remoteCommand === "object"
      ? item.remoteCommand
      : {};
  return String(
    item?.target_terminal_id
      || item?.targetTerminalId
      || item?.terminal_id
      || item?.terminalId
      || item?.pane_id
      || item?.paneId
      || remoteCommand?.target_terminal_id
      || remoteCommand?.targetTerminalId
      || remoteCommand?.terminal_id
      || remoteCommand?.terminalId
      || remoteCommand?.pane_id
      || remoteCommand?.paneId
      || "",
  ).trim();
}

export function getTodoQueueDirectTargetTerminalIndexCandidate(item = {}) {
  if (!getTodoQueueTerminalTargetIdCandidate(item)) {
    return undefined;
  }
  const remoteCommand = item?.remote_command && typeof item.remote_command === "object"
    ? item.remote_command
    : item?.remoteCommand && typeof item.remoteCommand === "object"
      ? item.remoteCommand
      : {};
  return item?.target_terminal_index
    ?? item?.targetTerminalIndex
    ?? remoteCommand?.target_terminal_index
    ?? remoteCommand?.targetTerminalIndex
    ?? item?.terminal_index
    ?? item?.terminalIndex
    ?? remoteCommand?.terminal_index
    ?? remoteCommand?.terminalIndex;
}

export function todoQueueRemoteCommandIsListOnly({ command_kind: commandKind, status } = {}) {
  const normalizedCommandKind = String(commandKind || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (TODO_QUEUE_REMOTE_LISTED_STATUSES.has(normalizedStatus)) {
    return true;
  }
  return !normalizedStatus && TODO_QUEUE_REMOTE_LIST_ONLY_COMMANDS.has(normalizedCommandKind);
}

export function getTodoQueueAutoQueueSourceForSource({ source } = {}) {
  const normalizedSource = normalizeTodoQueueSourceValue(source);
  if (
    normalizedSource === TODO_QUEUE_SOURCE_TERMINAL_DIRECT
    || normalizedSource === TODO_QUEUE_SOURCE_PANEL_AGENT_PROMPT
    || normalizedSource === TODO_QUEUE_SOURCE_VOICE_AGENT
    || normalizedSource === TODO_QUEUE_SOURCE_VOICE_PLAN
    || normalizedSource === TODO_QUEUE_SOURCE_REMOTE_CONTROL
  ) {
    return normalizedSource;
  }

  return TODO_QUEUE_SOURCE_TODO_AUTO;
}

export function getTodoQueuePromptEventSourceForSource({ source } = {}) {
  const normalizedSource = normalizeTodoQueueSourceValue(source);
  if (normalizedSource === TODO_QUEUE_SOURCE_TODO_AUTO) {
    return "todo-auto-queue";
  }
  if (normalizedSource === TODO_QUEUE_SOURCE_TERMINAL_DIRECT) {
    return "terminal-direct-input";
  }
  if (normalizedSource === TODO_QUEUE_SOURCE_PANEL_AGENT_PROMPT) {
    return "panel-agent-prompt";
  }
  if (normalizedSource === TODO_QUEUE_SOURCE_VOICE_AGENT) {
    return "voice-agent-queue";
  }
  if (normalizedSource === TODO_QUEUE_SOURCE_VOICE_PLAN) {
    return "voice-plan-queue";
  }
  if (normalizedSource === TODO_QUEUE_SOURCE_REMOTE_CONTROL) {
    return "remote-control";
  }

  return "terminal-view-drop";
}

export function getTodoQueueLifecycleSourceForSource({ source } = {}) {
  const normalizedSource = normalizeTodoQueueSourceValue(source);
  if (
    normalizedSource === TODO_QUEUE_SOURCE_TODO_AUTO
    || normalizedSource === TODO_QUEUE_SOURCE_PANEL_AGENT_PROMPT
    || normalizedSource === TODO_QUEUE_SOURCE_TERMINAL_DIRECT
    || normalizedSource === TODO_QUEUE_SOURCE_VOICE_AGENT
    || normalizedSource === TODO_QUEUE_SOURCE_VOICE_PLAN
    || normalizedSource === TODO_QUEUE_SOURCE_REMOTE_CONTROL
  ) {
    return normalizedSource;
  }

  return "tui-todo-drop";
}

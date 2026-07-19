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

const TODO_QUEUE_ACTIVE_RECEIPT_STATUSES = new Set([
  "accepted",
  "active",
  "dispatching",
  "dispatched",
  "in-progress",
  "in_progress",
  "processing",
  "running",
  "sending",
  "submitted",
]);

export function normalizeTodoQueueSourceValue(value) {
  return String(value || "").trim();
}

export function getTodoQueueSessionRefValues(value = {}) {
  const object = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const refs = new Set();
  [
    object.provider_session_id,
    object.native_session_id,
    object.session_id,
  ].forEach((candidate) => {
    const cleaned = normalizeTodoQueueSourceValue(candidate);
    if (cleaned) refs.add(cleaned);
  });
  return refs;
}

export function getTodoQueueTerminalPaneIdentity(paneId) {
  const pane = normalizeTodoQueueSourceValue(paneId);
  if (!pane) return "";
  const match = pane.match(/^(.*-\d+)-[a-z][a-z0-9_-]*$/i);
  return match ? match[1] : pane;
}

export function normalizeTodoQueueTerminalReceipts(receipts, paneId, options = {}) {
  const pane = getTodoQueueTerminalPaneIdentity(paneId);
  const liveSessionId = normalizeTodoQueueSourceValue(options.session_id);
  const liveInstanceId = normalizeTodoQueueSourceValue(options.instance_id);
  if (!pane || !receipts || typeof receipts !== "object" || Array.isArray(receipts)) {
    return [];
  }
  return Object.entries(receipts)
    .map(([key, receipt]) => {
      if (!receipt || typeof receipt !== "object") return null;
      if (getTodoQueueTerminalPaneIdentity(receipt.pane_id) !== pane) return null;
      const receivedAtMs = Number(receipt.received_at_ms) || 0;
      const updatedAtMs = Number(receipt.updated_at_ms) || receivedAtMs;
      if (!receivedAtMs && !updatedAtMs) return null;
      const commandId = normalizeTodoQueueSourceValue(receipt.command_id) || normalizeTodoQueueSourceValue(key);
      const itemId = normalizeTodoQueueSourceValue(receipt.item_id);
      const receiptSessions = getTodoQueueSessionRefValues(receipt);
      const receiptInstanceId = normalizeTodoQueueSourceValue(
        receipt.terminal_instance_id || receipt.target_terminal_instance_id || receipt.instance_id,
      );
      const rawStatus = normalizeTodoQueueSourceValue(receipt.status).toLowerCase() || "queued";
      const active = TODO_QUEUE_ACTIVE_RECEIPT_STATUSES.has(rawStatus);
      // An active receipt is only rewritten to "interrupted" when it CARRIES
      // identity that the live terminal cannot confirm: a receipt naming a
      // session must match the live session, and a receipt naming an
      // instance must match the live instance. Identity-less receipts (e.g.
      // direct typed prompts captured by the backend, which record neither a
      // session nor an instance) stay bound to the pane so the current todo
      // keeps showing while the turn runs.
      const sessionMatches = Boolean(liveSessionId && receiptSessions.has(liveSessionId));
      const sessionKnownStale = Boolean(receiptSessions.size > 0 && !sessionMatches);
      const instanceKnownStale = Boolean(liveInstanceId && receiptInstanceId && receiptInstanceId !== liveInstanceId);
      const isCurrent = Boolean(active && !sessionKnownStale && !instanceKnownStale);
      const staleActive = Boolean(active && !isCurrent);
      return {
        command_id: commandId,
        item_id: itemId,
        is_current: isCurrent,
        original_status: staleActive ? rawStatus : "",
        received_at_ms: receivedAtMs || updatedAtMs,
        session_id: Array.from(receiptSessions)[0] || liveSessionId,
        stale_active: staleActive,
        status: staleActive ? "interrupted" : rawStatus,
        terminal_instance_id: receiptInstanceId,
        text: normalizeTodoQueueSourceValue(receipt.text),
        updated_at_ms: updatedAtMs,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.received_at_ms - left.received_at_ms);
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

import { sanitizeTerminalColor } from "../terminals/terminalColors.js";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function integerOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => (
      fieldValue !== ""
        && fieldValue !== null
        && fieldValue !== undefined
        && !(typeof fieldValue === "number" && !Number.isFinite(fieldValue))
    )),
  );
}

export function normalizeSnippingDispatchTargetThread(thread, fallbackIndex = null) {
  const targetTerminalIndex = integerOrNull(
    thread?.target_terminal_index ?? thread?.terminal_index ?? fallbackIndex,
  );
  const targetColorSlot = integerOrNull(
    thread?.target_color_slot ?? thread?.color_slot ?? targetTerminalIndex ?? fallbackIndex,
  );
  const targetThreadId = text(
    thread?.target_thread_id || thread?.thread_id || thread?.id,
  );
  const targetTerminalId = text(
    thread?.target_terminal_id || thread?.terminal_id || thread?.pane_id,
  );
  const targetTerminalName = text(
    thread?.target_terminal_name || thread?.terminal_name || thread?.terminal_nickname || thread?.display_name || thread?.label || thread?.name,
    targetThreadId,
  );
  const targetAgentId = text(
    thread?.target_agent_id || thread?.agent_id || thread?.agent_kind,
  ).toLowerCase();
  const targetAgentLabel = text(
    thread?.target_agent_label || thread?.agent_display_name || thread?.agent_label || targetAgentId,
  );
  const rawColor = text(
    thread?.target_terminal_color || thread?.color,
  );
  const fallbackSlot = targetColorSlot ?? targetTerminalIndex ?? fallbackIndex;
  const targetTerminalColor = rawColor || Number.isInteger(fallbackSlot)
    ? sanitizeTerminalColor(rawColor, fallbackSlot ?? 0)
    : "";

  return compactObject({
    color: targetTerminalColor,
    label: targetTerminalName,
    target_agent_id: targetAgentId,
    target_agent_label: targetAgentLabel,
    target_color_slot: targetColorSlot,
    target_terminal_color: targetTerminalColor,
    target_terminal_id: targetTerminalId,
    target_terminal_index: targetTerminalIndex,
    target_terminal_name: targetTerminalName,
    target_thread_id: targetThreadId,
    terminal_index: targetTerminalIndex,
    thread_id: targetThreadId,
    value: targetThreadId,
  });
}

export function normalizeSnippingDispatchTargets(value) {
  return array(value)
    .map((target) => {
      const workspaceId = text(target?.workspace_id);
      if (!workspaceId) return null;
      const threads = array(target?.threads)
        .map((thread, index) => normalizeSnippingDispatchTargetThread(thread, index))
        .filter((thread) => thread.thread_id);
      if (!threads.length) return null;
      return {
        workspace_id: workspaceId,
        workspace_name: text(target?.workspace_name, workspaceId),
        threads,
      };
    })
    .filter(Boolean);
}

export function buildSnippingAnnotationTargetFields({ target_thread_id: targetThreadId, targetWorkspace } = {}) {
  const requestedThreadId = text(targetThreadId);
  if (!requestedThreadId) return {};

  const threads = array(targetWorkspace?.threads);
  const selectedIndex = threads.findIndex((thread) => (
    text(
      thread?.target_thread_id || thread?.thread_id || thread?.id,
    ) === requestedThreadId
  ));
  const selectedThread = selectedIndex >= 0 ? threads[selectedIndex] : {};
  const normalizedTarget = normalizeSnippingDispatchTargetThread({
    ...selectedThread,
    target_thread_id: requestedThreadId,
    thread_id: requestedThreadId,
  }, selectedIndex >= 0 ? selectedIndex : null);

  return compactObject({
    explicit_target: true,
    target_explicit: true,
    target_thread_id: requestedThreadId,
    user_pinned_target: true,
    target_agent_id: normalizedTarget.target_agent_id,
    target_agent_label: normalizedTarget.target_agent_label,
    target_color_slot: normalizedTarget.target_color_slot,
    target_terminal_color: normalizedTarget.target_terminal_color,
    target_terminal_id: normalizedTarget.target_terminal_id,
    target_terminal_index: normalizedTarget.target_terminal_index,
    target_terminal_name: normalizedTarget.target_terminal_name,
  });
}

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
    thread?.targetTerminalIndex
      ?? thread?.target_terminal_index
      ?? thread?.terminalIndex
      ?? thread?.terminal_index
      ?? fallbackIndex,
  );
  const targetColorSlot = integerOrNull(
    thread?.targetColorSlot
      ?? thread?.target_color_slot
      ?? thread?.colorSlot
      ?? thread?.color_slot
      ?? targetTerminalIndex
      ?? fallbackIndex,
  );
  const targetThreadId = text(
    thread?.targetThreadId
      || thread?.target_thread_id
      || thread?.threadId
      || thread?.thread_id
      || thread?.id,
  );
  const targetTerminalId = text(
    thread?.targetTerminalId
      || thread?.target_terminal_id
      || thread?.terminalId
      || thread?.terminal_id
      || thread?.paneId
      || thread?.pane_id,
  );
  const targetTerminalName = text(
    thread?.targetTerminalName
      || thread?.target_terminal_name
      || thread?.terminalName
      || thread?.terminal_name
      || thread?.terminalNickname
      || thread?.terminal_nickname
      || thread?.displayName
      || thread?.display_name
      || thread?.label
      || thread?.name,
    targetThreadId,
  );
  const targetAgentId = text(
    thread?.targetAgentId
      || thread?.target_agent_id
      || thread?.agentId
      || thread?.agent_id
      || thread?.agentKind
      || thread?.agent_kind,
  ).toLowerCase();
  const targetAgentLabel = text(
    thread?.targetAgentLabel
      || thread?.target_agent_label
      || thread?.agentDisplayName
      || thread?.agent_display_name
      || thread?.agentLabel
      || thread?.agent_label
      || targetAgentId,
  );
  const rawColor = text(
    thread?.targetTerminalColor
      || thread?.target_terminal_color
      || thread?.color,
  );
  const fallbackSlot = targetColorSlot ?? targetTerminalIndex ?? fallbackIndex;
  const targetTerminalColor = rawColor || Number.isInteger(fallbackSlot)
    ? sanitizeTerminalColor(rawColor, fallbackSlot ?? 0)
    : "";

  return compactObject({
    color: targetTerminalColor,
    label: targetTerminalName,
    targetAgentId,
    targetAgentLabel,
    targetColorSlot,
    targetTerminalColor,
    targetTerminalId,
    targetTerminalIndex,
    targetTerminalName,
    targetThreadId,
    terminalIndex: targetTerminalIndex,
    threadId: targetThreadId,
    value: targetThreadId,
  });
}

export function normalizeSnippingDispatchTargets(value) {
  return array(value)
    .map((target) => {
      const workspaceId = text(target?.workspaceId || target?.workspace_id);
      if (!workspaceId) return null;
      const threads = array(target?.threads)
        .map((thread, index) => normalizeSnippingDispatchTargetThread(thread, index))
        .filter((thread) => thread.threadId);
      if (!threads.length) return null;
      return {
        workspaceId,
        workspaceName: text(target?.workspaceName || target?.workspace_name, workspaceId),
        threads,
      };
    })
    .filter(Boolean);
}

export function buildSnippingAnnotationTargetFields({ targetThreadId, targetWorkspace } = {}) {
  const requestedThreadId = text(targetThreadId);
  if (!requestedThreadId) return {};

  const threads = array(targetWorkspace?.threads);
  const selectedIndex = threads.findIndex((thread) => (
    text(
      thread?.targetThreadId
        || thread?.target_thread_id
        || thread?.threadId
        || thread?.thread_id
        || thread?.id,
    ) === requestedThreadId
  ));
  const selectedThread = selectedIndex >= 0 ? threads[selectedIndex] : {};
  const normalizedTarget = normalizeSnippingDispatchTargetThread({
    ...selectedThread,
    targetThreadId: requestedThreadId,
    threadId: requestedThreadId,
  }, selectedIndex >= 0 ? selectedIndex : null);

  return compactObject({
    explicitTarget: true,
    targetExplicit: true,
    targetThreadId: requestedThreadId,
    userPinnedTarget: true,
    targetAgentId: normalizedTarget.targetAgentId,
    targetAgentLabel: normalizedTarget.targetAgentLabel,
    targetColorSlot: normalizedTarget.targetColorSlot,
    targetTerminalColor: normalizedTarget.targetTerminalColor,
    targetTerminalId: normalizedTarget.targetTerminalId,
    targetTerminalIndex: normalizedTarget.targetTerminalIndex,
    targetTerminalName: normalizedTarget.targetTerminalName,
  });
}

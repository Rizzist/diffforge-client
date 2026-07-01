export const PANEL_AGENT_PROMPT_TARGETS_REQUEST_EVENT = "diffforge:panel-agent-prompt-targets-request";
export const PANEL_AGENT_PROMPT_TARGETS_EVENT = "diffforge:panel-agent-prompt-targets";
export const PANEL_AGENT_PROMPT_SUBMIT_EVENT = "diffforge:panel-agent-prompt-submit";
export const PANEL_AGENT_PROMPT_RESULT_EVENT = "diffforge:panel-agent-prompt-result";
export const PANEL_AGENT_PROMPT_ACTIVITY_REQUEST_EVENT = "diffforge:panel-agent-prompt-activity-request";
export const PANEL_AGENT_PROMPT_ACTIVITY_EVENT = "diffforge:panel-agent-prompt-activity";

export function createPanelAgentPromptRequestId(prefix = "panel-agent-prompt") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizePanelAgentPromptTargets(value) {
  return (Array.isArray(value) ? value : [])
    .map((target) => {
      const terminalIndex = Number.parseInt(target?.terminalIndex ?? target?.terminal_index, 10);
      const id = String(target?.id || (Number.isInteger(terminalIndex) ? terminalIndex : "")).trim();
      if (!id || !Number.isInteger(terminalIndex) || terminalIndex < 0) {
        return null;
      }
      return {
        color: String(target?.color || target?.targetTerminalColor || target?.target_terminal_color || "").trim(),
        id,
        label: String(target?.label || target?.name || `Agent ${terminalIndex + 1}`).trim(),
        paneId: String(target?.paneId || target?.pane_id || target?.targetTerminalId || target?.target_terminal_id || "").trim(),
        role: String(target?.role || target?.agentId || target?.agent_id || target?.targetAgentId || target?.target_agent_id || "").trim(),
        short: String(target?.short || "").trim(),
        terminalIndex,
        title: String(target?.title || "").trim(),
      };
    })
    .filter(Boolean);
}

export function normalizePanelAgentPromptActivityItems(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const itemId = String(item?.itemId || item?.item_id || item?.id || "").trim();
      if (!itemId) {
        return null;
      }
      const rawStatus = String(item?.status || item?.state || "queued").trim().toLowerCase();
      const status = rawStatus === "completed" || rawStatus === "running" ? rawStatus : "queued";
      const submittedAtMs = Number(item?.submittedAtMs ?? item?.submitted_at_ms ?? 0);
      const terminalIndex = Number.parseInt(item?.targetTerminalIndex ?? item?.target_terminal_index, 10);
      return {
        color: String(item?.color || item?.targetTerminalColor || item?.target_terminal_color || "").trim(),
        completedAtMs: Number(item?.completedAtMs ?? item?.completed_at_ms ?? 0) || 0,
        id: itemId,
        itemId,
        label: String(item?.label || item?.targetLabel || item?.target_label || "Agent").trim(),
        panelKind: String(item?.panelKind || item?.panel_kind || "panel").trim(),
        panelPaneId: String(item?.panelPaneId || item?.panel_pane_id || item?.paneId || item?.pane_id || "").trim(),
        role: String(item?.role || item?.targetAgentId || item?.target_agent_id || "").trim(),
        short: String(item?.short || "").trim(),
        status,
        submittedAtMs: Number.isFinite(submittedAtMs) && submittedAtMs > 0 ? submittedAtMs : Date.now(),
        text: String(item?.text || item?.prompt || "").trim(),
        title: String(item?.title || "").trim(),
        windowId: String(item?.windowId || item?.window_id || "").trim(),
        workspaceId: String(item?.workspaceId || item?.workspace_id || "").trim(),
        ...(Number.isInteger(terminalIndex) && terminalIndex >= 0 ? { targetTerminalIndex: terminalIndex } : {}),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.submittedAtMs - right.submittedAtMs);
}

import { normalizePcbElementContexts } from "../pcb/pcbElementContext.js";

export const PANEL_AGENT_PROMPT_TARGETS_REQUEST_EVENT = "diffforge:panel-agent-prompt-targets-request";
export const PANEL_AGENT_PROMPT_TARGETS_EVENT = "diffforge:panel-agent-prompt-targets";
export const PANEL_AGENT_PROMPT_SUBMIT_EVENT = "diffforge:panel-agent-prompt-submit";
export const PANEL_AGENT_PROMPT_RESULT_EVENT = "diffforge:panel-agent-prompt-result";
export const PANEL_AGENT_PROMPT_ACTIVITY_REQUEST_EVENT = "diffforge:panel-agent-prompt-activity-request";
export const PANEL_AGENT_PROMPT_ACTIVITY_EVENT = "diffforge:panel-agent-prompt-activity";
export const PANEL_AGENT_PROMPT_ACTIVITY_DISMISS_EVENT = "diffforge:panel-agent-prompt-activity-dismiss";

export function createPanelAgentPromptRequestId(prefix = "panel-agent-prompt") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function compactPanelAgentPromptText(value, maxLength = 240) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function clampPanelAgentPromptMultilineText(value, maxLength = 1600) {
  const text = String(value || "").trim();
  if (!text || text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function truncatePanelAgentPromptBlock(value, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 3) {
    return text.slice(0, Math.max(0, maxLength));
  }
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function clampPanelAgentPromptBlocks(blocks, maxLength = 1600) {
  const cleanBlocks = blocks.map((block) => String(block || "").trim()).filter(Boolean);
  if (!cleanBlocks.length) {
    return "";
  }
  const separator = "\n\n";
  const joined = cleanBlocks.join(separator);
  if (joined.length <= maxLength) {
    return joined;
  }
  const separatorBudget = separator.length * Math.max(0, cleanBlocks.length - 1);
  let remaining = Math.max(cleanBlocks.length, maxLength - separatorBudget);
  const budgets = Array(cleanBlocks.length).fill(0);
  let pending = cleanBlocks.map((_block, index) => index);
  while (pending.length) {
    const share = Math.max(1, Math.floor(remaining / pending.length));
    const nextPending = [];
    for (const index of pending) {
      if (cleanBlocks[index].length <= share) {
        budgets[index] = cleanBlocks[index].length;
        remaining -= budgets[index];
      } else {
        nextPending.push(index);
      }
    }
    if (nextPending.length === pending.length) {
      const base = Math.max(1, Math.floor(remaining / nextPending.length));
      let extra = remaining - base * nextPending.length;
      for (const index of nextPending) {
        budgets[index] = base + (extra > 0 ? 1 : 0);
        extra -= 1;
      }
      break;
    }
    pending = nextPending;
  }
  return cleanBlocks
    .map((block, index) => truncatePanelAgentPromptBlock(block, budgets[index]))
    .join(separator);
}

export function normalizePanelAgentPromptContextRefs(value) {
  const values = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value]
      : [];
  return values
    .map((context) => {
      const kind = String(context?.kind || context?.type || "").trim().toLowerCase();
      return kind === "pcb-element"
        ? normalizePcbElementContexts([context])[0] || null
        : null;
    })
    .filter(Boolean)
    .slice(0, 3);
}

function joinPanelAgentPromptParts(parts) {
  return parts.map((part) => compactPanelAgentPromptText(part, 120)).filter(Boolean).join(" · ");
}

function formatPcbElementBlock(context) {
  const lines = ["Selected PCB element context:"];
  if (context.boardTitle || context.sourceAnchor?.path) {
    const board = context.boardTitle && context.sourceAnchor?.path
      ? `${context.boardTitle} (${context.sourceAnchor.path})`
      : context.boardTitle || context.sourceAnchor?.path;
    lines.push(`- board: ${board}`);
  }
  if (context.tab) {
    lines.push(`- view: ${context.tab}`);
  }
  const element = joinPanelAgentPromptParts([
    context.designator,
    context.elementType,
    context.footprint,
    context.value,
  ]);
  if (element) {
    lines.push(`- element: ${element}`);
  } else if (context.label) {
    lines.push(`- element: ${context.label}`);
  }
  if (context.position) {
    const position = `(${context.position.xMm}, ${context.position.yMm}) mm`;
    lines.push(`- position: ${position}${context.layer ? `, layer ${context.layer}` : ""}`);
  }
  if (context.pads?.length) {
    lines.push(`- pads: ${context.pads.map((pad) => (
      [pad.pin, pad.net].filter(Boolean).join(" → ")
    )).filter(Boolean).join(", ")}`);
  }
  if (context.neighbors?.length) {
    lines.push(`- connected: ${context.neighbors.join("; ")}`);
  }
  if (context.sourceAnchor?.path && context.sourceAnchor.line) {
    lines.push(`- source: ${context.sourceAnchor.path}:${context.sourceAnchor.line}`);
    if (context.sourceAnchor.snippet) {
      lines.push(`  ${context.sourceAnchor.snippet.split(/\n/).join("\n  ")}`);
    }
  }
  return lines.join("\n");
}

export function formatPanelAgentPromptContextNote(contextRefs) {
  const contexts = normalizePanelAgentPromptContextRefs(contextRefs);
  if (!contexts.length) {
    return null;
  }
  return {
    title: contexts.length === 1 ? "Selected PCB element" : "Selected PCB elements",
    text: clampPanelAgentPromptBlocks(contexts.map(formatPcbElementBlock), 1600),
  };
}

function normalizePanelAgentPromptActivityStatus(value) {
  const rawStatus = String(value || "queued").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["completed", "complete", "done", "success", "succeeded"].includes(rawStatus)) {
    return "completed";
  }
  if (["running", "processing", "in_flight", "sending", "dispatching", "active"].includes(rawStatus)) {
    return "running";
  }
  if (["failed", "failure", "error", "errored", "timed_out", "timeout"].includes(rawStatus)) {
    return "failed";
  }
  if (["interrupted", "cancelled", "canceled", "stopped", "aborted"].includes(rawStatus)) {
    return "interrupted";
  }
  return "queued";
}

export function normalizePanelAgentPromptTargets(value) {
  return (Array.isArray(value) ? value : [])
    .map((target) => {
      const terminalIndex = Number.parseInt(target?.terminal_index, 10);
      const id = String(target?.id || (Number.isInteger(terminalIndex) ? terminalIndex : "")).trim();
      if (!id || !Number.isInteger(terminalIndex) || terminalIndex < 0) {
        return null;
      }
      return {
        color: String(target?.color || target?.target_terminal_color || "").trim(),
        id,
        label: String(target?.label || target?.name || `Agent ${terminalIndex + 1}`).trim(),
        pane_id: String(target?.pane_id || target?.target_terminal_id || "").trim(),
        role: String(target?.role || target?.agent_id || target?.target_agent_id || "").trim(),
        short: String(target?.short || "").trim(),
        terminal_index: terminalIndex,
        title: String(target?.title || "").trim(),
      };
    })
    .filter(Boolean);
}

export function normalizePanelAgentPromptActivityItems(value) {
  return (Array.isArray(value) ? value : [])
    .map((item) => {
      const itemId = String(item?.item_id || item?.id || "").trim();
      if (!itemId) {
        return null;
      }
      const status = normalizePanelAgentPromptActivityStatus(item?.status || item?.state);
      const submittedAtMs = Number(item?.submitted_at_ms ?? 0);
      const terminalIndex = Number.parseInt(item?.target_terminal_index, 10);
      return {
        color: String(item?.color || item?.target_terminal_color || "").trim(),
        completed_at_ms: Number(item?.completed_at_ms ?? 0) || 0,
        error: String(item?.error || item?.message || "").trim(),
        id: itemId,
        item_id: itemId,
        label: String(item?.label || item?.target_label || "Agent").trim(),
        panel_kind: String(item?.panel_kind || "panel").trim(),
        panel_pane_id: String(item?.panel_pane_id || item?.pane_id || "").trim(),
        role: String(item?.role || item?.target_agent_id || "").trim(),
        short: String(item?.short || "").trim(),
        status,
        submitted_at_ms: Number.isFinite(submittedAtMs) && submittedAtMs > 0 ? submittedAtMs : Date.now(),
        text: String(item?.text || item?.prompt || "").trim(),
        title: String(item?.title || "").trim(),
        window_id: String(item?.window_id || "").trim(),
        workspace_id: String(item?.workspace_id || "").trim(),
        ...(Number.isInteger(terminalIndex) && terminalIndex >= 0 ? { target_terminal_index: terminalIndex } : {}),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.submitted_at_ms - right.submitted_at_ms);
}

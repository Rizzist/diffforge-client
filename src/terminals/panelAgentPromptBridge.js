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

function compactPanelAgentPromptMultilineText(value, maxLength = 1600) {
  const normalized = String(value || "")
    .split(/\n+/)
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function panelAgentPromptNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : 0;
}

function normalizeWebElementContextRef(context) {
  if (!context || typeof context !== "object") {
    return null;
  }
  const kind = String(context.kind || context.type || "").trim().toLowerCase();
  if (kind && kind !== "web-element") {
    return null;
  }
  const selector = compactPanelAgentPromptText(context.selector, 260);
  const element = compactPanelAgentPromptText(context.element || context.tagName || context.tag_name, 140);
  const url = compactPanelAgentPromptText(context.url, 420);
  if (!selector && !element && !url) {
    return null;
  }
  const rect = context.rect && typeof context.rect === "object" ? context.rect : {};
  const pageRect = context.pageRect && typeof context.pageRect === "object"
    ? context.pageRect
    : context.page_rect && typeof context.page_rect === "object"
      ? context.page_rect
      : {};
  const scroll = context.scroll && typeof context.scroll === "object" ? context.scroll : {};
  const viewport = context.viewport && typeof context.viewport === "object" ? context.viewport : {};
  const styles = context.styles && typeof context.styles === "object" ? context.styles : {};
  const attributes = context.attributes && typeof context.attributes === "object" ? context.attributes : {};
  const parent = context.parent && typeof context.parent === "object" ? context.parent : null;
  return {
    attributes: {
      ariaLabel: compactPanelAgentPromptText(attributes["aria-label"] || attributes.ariaLabel || attributes.aria_label, 160),
      alt: compactPanelAgentPromptText(attributes.alt, 160),
      href: compactPanelAgentPromptText(attributes.href, 240),
      placeholder: compactPanelAgentPromptText(attributes.placeholder, 160),
      role: compactPanelAgentPromptText(attributes.role, 80),
      title: compactPanelAgentPromptText(attributes.title, 160),
      type: compactPanelAgentPromptText(attributes.type, 80),
    },
    capturedAtMs: Number(context.capturedAtMs || context.captured_at_ms || 0) || Date.now(),
    element,
    id: compactPanelAgentPromptText(context.id || context.contextId || context.context_id, 120),
    kind: "web-element",
    panelKind: compactPanelAgentPromptText(context.panelKind || context.panel_kind || "web", 80),
    paneId: compactPanelAgentPromptText(context.paneId || context.pane_id, 120),
    pageRect: {
      height: panelAgentPromptNumber(pageRect.height),
      left: panelAgentPromptNumber(pageRect.left ?? pageRect.x),
      top: panelAgentPromptNumber(pageRect.top ?? pageRect.y),
      width: panelAgentPromptNumber(pageRect.width),
    },
    parent: parent ? {
      element: compactPanelAgentPromptText(parent.element || parent.tagName || parent.tag_name, 140),
      selector: compactPanelAgentPromptText(parent.selector, 220),
      text: compactPanelAgentPromptText(parent.text, 180),
    } : null,
    rect: {
      height: panelAgentPromptNumber(rect.height),
      left: panelAgentPromptNumber(rect.left ?? rect.x),
      top: panelAgentPromptNumber(rect.top ?? rect.y),
      width: panelAgentPromptNumber(rect.width),
    },
    scroll: {
      x: panelAgentPromptNumber(scroll.x),
      y: panelAgentPromptNumber(scroll.y),
    },
    selector,
    styles: {
      backgroundColor: compactPanelAgentPromptText(styles.backgroundColor || styles.background_color, 80),
      borderColor: compactPanelAgentPromptText(styles.borderColor || styles.border_color, 80),
      borderRadius: compactPanelAgentPromptText(styles.borderRadius || styles.border_radius, 80),
      color: compactPanelAgentPromptText(styles.color, 80),
      display: compactPanelAgentPromptText(styles.display, 80),
      fontSize: compactPanelAgentPromptText(styles.fontSize || styles.font_size, 80),
      fontWeight: compactPanelAgentPromptText(styles.fontWeight || styles.font_weight, 80),
      gap: compactPanelAgentPromptText(styles.gap, 80),
      lineHeight: compactPanelAgentPromptText(styles.lineHeight || styles.line_height, 80),
      padding: compactPanelAgentPromptText(styles.padding, 120),
    },
    text: compactPanelAgentPromptText(context.text, 360),
    title: compactPanelAgentPromptText(context.title, 160),
    url,
    viewport: {
      height: panelAgentPromptNumber(viewport.height),
      width: panelAgentPromptNumber(viewport.width),
    },
    workspaceId: compactPanelAgentPromptText(context.workspaceId || context.workspace_id, 160),
  };
}

export function normalizePanelAgentPromptContextRefs(value) {
  const values = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? [value]
      : [];
  return values
    .map((context) => normalizeWebElementContextRef(context))
    .filter(Boolean)
    .slice(0, 3);
}

export function formatPanelAgentPromptContextNote(contextRefs) {
  const contexts = normalizePanelAgentPromptContextRefs(contextRefs);
  if (!contexts.length) {
    return null;
  }
  const lines = [
    contexts.length === 1
      ? "Selected web element context:"
      : `Selected web element contexts (${contexts.length}):`,
  ];
  contexts.forEach((context, index) => {
    if (contexts.length > 1) {
      lines.push(`Element ${index + 1}:`);
    }
    if (context.url) {
      lines.push(`- url: ${context.url}`);
    }
    if (context.title) {
      lines.push(`- page title: ${context.title}`);
    }
    if (context.element) {
      lines.push(`- element: ${context.element}`);
    }
    if (context.selector) {
      lines.push(`- selector: ${context.selector}`);
    }
    if (context.text) {
      lines.push(`- text: ${context.text}`);
    }
    const attrs = [];
    if (context.attributes.role) attrs.push(`role=${context.attributes.role}`);
    if (context.attributes.ariaLabel) attrs.push(`aria-label=${context.attributes.ariaLabel}`);
    if (context.attributes.alt) attrs.push(`alt=${context.attributes.alt}`);
    if (context.attributes.placeholder) attrs.push(`placeholder=${context.attributes.placeholder}`);
    if (context.attributes.href) attrs.push(`href=${context.attributes.href}`);
    if (attrs.length) {
      lines.push(`- attributes: ${attrs.join("; ")}`);
    }
    if (context.rect.width || context.rect.height) {
      lines.push(`- viewport rect: x=${context.rect.left}, y=${context.rect.top}, w=${context.rect.width}, h=${context.rect.height}`);
    }
    if (context.scroll.x || context.scroll.y) {
      lines.push(`- page scroll: x=${context.scroll.x}, y=${context.scroll.y}`);
    }
    const styleParts = [];
    if (context.styles.display) styleParts.push(`display=${context.styles.display}`);
    if (context.styles.fontSize) styleParts.push(`font=${context.styles.fontSize}${context.styles.fontWeight ? `/${context.styles.fontWeight}` : ""}`);
    if (context.styles.color) styleParts.push(`color=${context.styles.color}`);
    if (context.styles.backgroundColor) styleParts.push(`background=${context.styles.backgroundColor}`);
    if (context.styles.borderRadius) styleParts.push(`radius=${context.styles.borderRadius}`);
    if (context.styles.padding) styleParts.push(`padding=${context.styles.padding}`);
    if (styleParts.length) {
      lines.push(`- styles: ${styleParts.join("; ")}`);
    }
    if (context.parent?.element) {
      lines.push(`- parent: ${context.parent.element}${context.parent.text ? ` text=${context.parent.text}` : ""}`);
    }
  });
  return {
    title: contexts.length === 1 ? "Selected web element" : "Selected web elements",
    text: compactPanelAgentPromptMultilineText(lines.join("\n"), 1600),
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
      const status = normalizePanelAgentPromptActivityStatus(item?.status || item?.state);
      const submittedAtMs = Number(item?.submittedAtMs ?? item?.submitted_at_ms ?? 0);
      const terminalIndex = Number.parseInt(item?.targetTerminalIndex ?? item?.target_terminal_index, 10);
      return {
        color: String(item?.color || item?.targetTerminalColor || item?.target_terminal_color || "").trim(),
        completedAtMs: Number(item?.completedAtMs ?? item?.completed_at_ms ?? 0) || 0,
        error: String(item?.error || item?.message || "").trim(),
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

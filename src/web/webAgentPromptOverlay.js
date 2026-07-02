import { useCallback, useEffect, useMemo, useRef } from "react";

import { hasTauriRuntime } from "./webNative.js";

const WEB_AGENT_PROMPT_OVERLAY_KEY = "__diffforgeWebAgentPromptOverlay";
const WEB_AGENT_PROMPT_OVERLAY_POLL_MS = 120;

function cleanText(value) {
  return String(value || "").trim();
}

function cleanArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeOverlayTarget(target) {
  if (!target || typeof target !== "object") {
    return null;
  }
  const id = cleanText(target.id ?? target.value ?? target.terminalIndex ?? target.terminal_index);
  if (!id) {
    return null;
  }
  const terminalIndex = Number.isInteger(target.terminalIndex)
    ? target.terminalIndex
    : Number.isInteger(target.terminal_index)
      ? target.terminal_index
      : undefined;
  const short = cleanText(
    target.short
      || target.terminalNickname
      || target.terminal_nickname
      || target.label
      || target.name,
  );
  return {
    color: cleanText(target.color) || "#8bb8ff",
    id,
    label: cleanText(target.label || short || `Agent ${terminalIndex !== undefined ? terminalIndex + 1 : ""}`) || "Agent",
    role: cleanText(target.role),
    short,
    terminalIndex,
    title: cleanText(target.title),
  };
}

function normalizeOverlayTargets(targets) {
  return cleanArray(targets).map(normalizeOverlayTarget).filter(Boolean);
}

function normalizeOverlayTargetIds(ids) {
  return cleanArray(ids).map((id) => cleanText(id)).filter(Boolean);
}

function normalizeOverlayActivityItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }
  const itemId = cleanText(item.itemId || item.item_id || item.id);
  if (!itemId) {
    return null;
  }
  const rawStatus = cleanText(item.status || item.state || "queued").toLowerCase();
  const status = rawStatus === "completed" || rawStatus === "running" ? rawStatus : "queued";
  const submittedAtMs = Number(item.submittedAtMs ?? item.submitted_at_ms ?? 0);
  return {
    color: cleanText(item.color || item.targetTerminalColor || item.target_terminal_color) || "#8bb8ff",
    itemId,
    label: cleanText(item.label || item.targetLabel || item.target_label || "Agent") || "Agent",
    short: cleanText(item.short),
    status,
    submittedAtMs: Number.isFinite(submittedAtMs) && submittedAtMs > 0 ? submittedAtMs : Date.now(),
    text: cleanText(item.text || item.prompt || item.title),
    title: cleanText(item.title),
  };
}

function normalizeOverlayActivityItems(items) {
  return cleanArray(items)
    .map(normalizeOverlayActivityItem)
    .filter(Boolean)
    .sort((left, right) => left.submittedAtMs - right.submittedAtMs);
}

function buildOverlayConfig({
  activityItems = [],
  contextRefs = [],
  defaultSelectedTargetIds = [],
  targets = [],
} = {}) {
  return {
    activityItems: normalizeOverlayActivityItems(activityItems),
    contextRefs: cleanArray(contextRefs).filter((context) => context && typeof context === "object"),
    defaultSelectedTargetIds: normalizeOverlayTargetIds(defaultSelectedTargetIds),
    targets: normalizeOverlayTargets(targets),
  };
}

function buildWebAgentPromptOverlayScript(action, config = {}) {
  const safeAction = JSON.stringify(cleanText(action) || "show");
  const safeConfig = JSON.stringify(config || {});
  return `(() => {
    const ACTION = ${safeAction};
    const CONFIG = ${safeConfig};
    const KEY = ${JSON.stringify(WEB_AGENT_PROMPT_OVERLAY_KEY)};
    const HOST_ID = "diffforge-web-agent-prompt-overlay";

    function text(value) {
      return String(value || "").trim();
    }

    function array(value) {
      return Array.isArray(value) ? value : [];
    }

    function html(value) {
      return text(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function normalizeTargets(targets) {
      return array(targets).map((target) => {
        const id = text(target && (target.id || target.value || target.terminalIndex || target.terminal_index));
        if (!id) return null;
        return {
          color: text(target.color) || "#8bb8ff",
          id,
          label: text(target.label || target.short || target.name) || "Agent",
          role: text(target.role).toLowerCase(),
          short: text(target.short || target.terminalNickname || target.terminal_nickname || target.label || target.name) || "Agent",
          title: text(target.title)
        };
      }).filter(Boolean);
    }

    function normalizeSelectedIds(targets, selectedIds, fallbackIds) {
      const allowed = new Set(targets.map((target) => target.id));
      const selected = array(selectedIds)
        .map(text)
        .filter((id, index, list) => id && allowed.has(id) && list.indexOf(id) === index);
      if (selected.length) return selected;
      const fallback = array(fallbackIds)
        .map(text)
        .filter((id, index, list) => id && allowed.has(id) && list.indexOf(id) === index);
      if (fallback.length) return fallback;
      return targets[0] ? [targets[0].id] : [];
    }

    function normalizeActivityItems(items) {
      return array(items).map((item) => {
        const itemId = text(item && (item.itemId || item.item_id || item.id));
        if (!itemId) return null;
        const rawStatus = text(item.status || item.state || "queued").toLowerCase();
        const status = rawStatus === "completed" || rawStatus === "running" ? rawStatus : "queued";
        const submittedAtMs = Number(item.submittedAtMs || item.submitted_at_ms || 0);
        return {
          color: text(item.color || item.targetTerminalColor || item.target_terminal_color) || "#8bb8ff",
          itemId,
          label: text(item.label || item.targetLabel || item.target_label || "Agent") || "Agent",
          short: text(item.short),
          status,
          submittedAtMs: Number.isFinite(submittedAtMs) && submittedAtMs > 0 ? submittedAtMs : Date.now(),
          text: text(item.text || item.prompt || item.title),
          title: text(item.title)
        };
      }).filter(Boolean).sort((left, right) => left.submittedAtMs - right.submittedAtMs);
    }

    function statusLabel(status) {
      if (status === "completed") return "completed";
      if (status === "running") return "running";
      return "queued";
    }

    function compactActivityText(value, limit) {
      const raw = text(value).replace(/\\s+/g, " ");
      const max = Number(limit) > 0 ? Number(limit) : 15;
      if (!raw || raw.length <= max) return raw;
      return raw.slice(0, Math.max(0, max - 1)).trimEnd() + "...";
    }

    function contextLabel(context) {
      if (!context || typeof context !== "object") return "";
      const element = text(context.element || context.tagName || context.tag_name || "element");
      let host = "";
      try {
        host = new URL(context.url || "").host;
      } catch (_) {}
      return [element, host].filter(Boolean).join(" on ");
    }

    function iconForRole(role) {
      if (role === "claude") return "✺";
      if (role === "codex") return "◉";
      if (role === "opencode") return "▣";
      return "›";
    }

    function pushEvent(state, event) {
      state.events.push({
        ...event,
        createdAtMs: Date.now()
      });
    }

    function stopOverlayEvent(event) {
      event.stopPropagation();
    }

    function capturePromptSelection(prompt) {
      if (!prompt || typeof prompt.selectionStart !== "number" || typeof prompt.selectionEnd !== "number") {
        return null;
      }
      return {
        direction: prompt.selectionDirection || "none",
        end: prompt.selectionEnd,
        start: prompt.selectionStart
      };
    }

    function focusPrompt(prompt, selection) {
      if (!prompt || prompt.disabled) return;
      window.requestAnimationFrame(() => {
        if (!prompt.isConnected || prompt.disabled) return;
        try {
          prompt.focus({ preventScroll: true });
        } catch (_) {
          prompt.focus();
        }
        if (
          selection
          && typeof prompt.setSelectionRange === "function"
          && typeof selection.start === "number"
          && typeof selection.end === "number"
        ) {
          try {
            prompt.setSelectionRange(selection.start, selection.end, selection.direction || "none");
          } catch (_) {}
        }
      });
    }

    function shieldOverlayControl(element) {
      if (!element) return;
      [
        "beforeinput",
        "click",
        "compositionend",
        "compositionstart",
        "compositionupdate",
        "contextmenu",
        "dblclick",
        "input",
        "keydown",
        "keypress",
        "keyup",
        "mousedown",
        "mouseup",
        "pointerdown",
        "pointerup",
        "touchend",
        "touchstart"
      ].forEach((eventName) => {
        element.addEventListener(eventName, stopOverlayEvent);
      });
    }

    function submit(state) {
      const prompt = text(state.prompt);
      const targets = normalizeTargets(state.config.targets);
      const selectedIds = normalizeSelectedIds(targets, state.selectedIds, state.config.defaultSelectedTargetIds);
      if (!prompt) {
        state.error = "Type a prompt.";
        render(state);
        return;
      }
      if (!selectedIds.length) {
        state.error = "Choose at least one agent.";
        render(state);
        return;
      }
      state.error = "";
      state.submitting = true;
      state.selectedIds = selectedIds;
      pushEvent(state, {
        targetIds: selectedIds,
        text: prompt,
        type: "submit"
      });
      render(state);
    }

    function styleHost(host) {
      host.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483646",
        "pointer-events:none",
        "font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
        "color:#e2e8f0"
      ].join(";");
    }

    function render(state) {
      const host = state.host;
      const root = state.root;
      if (!host || !root) return;
      styleHost(host);

      const targets = normalizeTargets(state.config.targets);
      state.selectedIds = normalizeSelectedIds(targets, state.selectedIds, state.config.defaultSelectedTargetIds);
      const selected = state.selectedIds
        .map((id) => targets.find((target) => target.id === id))
        .filter(Boolean);
      const first = selected[0] || targets[0] || null;
      const selectedLabel = selected.length > 1
        ? (first ? first.short : "Agents") + " +" + String(selected.length - 1)
        : first
          ? first.short
          : "Agents";
      const accent = first && first.color ? first.color : "#8bb8ff";
      const selectedRole = first && first.role ? first.role : "";
      const disabled = state.submitting || !targets.length;
      const context = array(state.config.contextRefs).find((item) => item && typeof item === "object") || null;
      const contextText = contextLabel(context) || "Selected web element";
      const menu = state.menuOpen ? \`
        <div class="menu" role="listbox" aria-label="Terminal agents">
          \${targets.length ? targets.map((target) => {
            const checked = state.selectedIds.includes(target.id);
            return \`
              <button class="option" data-target-id="\${html(target.id)}" data-selected="\${checked ? "true" : "false"}" type="button">
                <span class="check">\${checked ? "✓" : ""}</span>
                <span class="harness">\${html(iconForRole(target.role))}</span>
                <span class="dot" style="--target-color:\${html(target.color)}"></span>
                <span class="name">\${html(target.short || target.label)}</span>
              </button>
            \`;
          }).join("") : \`<div class="empty">No coding agents open</div>\`}
        </div>
      \` : "";
      const activityItems = normalizeActivityItems(state.config.activityItems).slice(-3).reverse();
      const activity = activityItems.length ? \`
        <div class="activity-stack" aria-label="Agent prompt activity">
          \${activityItems.map((item) => {
            const label = compactActivityText(item.text || item.title || item.label || "Prompt", 15);
            const target = item.short || item.label || "Agent";
            const title = [item.text || item.title || "Panel prompt", target ? "Target: " + target : "", statusLabel(item.status)].filter(Boolean).join(" - ");
            return \`
              <div class="activity-item" data-status="\${html(item.status)}" style="--activity-color:\${html(item.color)}" title="\${html(title)}">
                <span class="activity-dot" data-status="\${html(item.status)}"></span>
                <span class="activity-label">\${html(label || "Prompt")}</span>
                <span class="activity-status">\${html(statusLabel(item.status))}</span>
              </div>
            \`;
          }).join("")}
        </div>
      \` : "";
      const previousPrompt = root.querySelector('[data-role="prompt"]');
      const promptHadFocus = previousPrompt && root.activeElement === previousPrompt;
      const promptSelection = promptHadFocus ? capturePromptSelection(previousPrompt) : null;
      if (promptHadFocus && typeof previousPrompt.value === "string" && previousPrompt.value !== state.prompt) {
        state.prompt = previousPrompt.value;
      }

      root.innerHTML = \`
        <style>
          :host { all: initial; }
          * { box-sizing: border-box; letter-spacing: 0; }
          @keyframes diffforge-panel-agent-spin {
            to { transform: rotate(360deg); }
          }
          .activity-stack {
            position: absolute;
            top: max(10px, env(safe-area-inset-top, 0px));
            right: max(10px, env(safe-area-inset-right, 0px));
            z-index: 2;
            display: grid;
            min-width: 144px;
            max-width: min(260px, calc(100vw - 24px));
            gap: 4px;
            pointer-events: none;
          }
          .activity-item {
            display: grid;
            min-width: 0;
            height: 22px;
            grid-template-columns: 14px minmax(42px, 1fr) auto;
            align-items: center;
            gap: 6px;
            padding: 0 8px 0 5px;
            border: 1px solid rgba(148, 163, 184, 0.24);
            border-radius: 999px;
            color: rgba(226, 232, 240, 0.94);
            background: rgba(4, 8, 14, 0.82);
            box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28), inset 0 1px 0 rgba(255, 255, 255, 0.05);
            backdrop-filter: blur(12px);
          }
          .activity-item[data-status="completed"] {
            border-color: rgba(74, 222, 128, 0.34);
            color: rgba(220, 252, 231, 0.96);
            background: rgba(20, 83, 45, 0.34);
          }
          .activity-dot {
            position: relative;
            width: 11px;
            height: 11px;
            border: 2px solid color-mix(in srgb, var(--activity-color) 24%, rgba(148, 163, 184, 0.42));
            border-top-color: var(--activity-color);
            border-radius: 999px;
            animation: diffforge-panel-agent-spin 1350ms linear infinite;
          }
          .activity-dot[data-status="running"] {
            border-color: color-mix(in srgb, var(--activity-color) 30%, rgba(148, 163, 184, 0.34));
            border-top-color: var(--activity-color);
            animation-duration: 760ms;
          }
          .activity-dot[data-status="completed"] {
            border-color: rgba(134, 239, 172, 0.92);
            background: #22c55e;
            animation: none;
          }
          .activity-dot[data-status="completed"]::after {
            content: "";
            position: absolute;
            left: 3px;
            top: 1px;
            width: 3px;
            height: 6px;
            border: solid rgba(4, 20, 10, 0.92);
            border-width: 0 1.5px 1.5px 0;
            transform: rotate(45deg);
          }
          .activity-label {
            min-width: 0;
            overflow: hidden;
            font: 850 10.5px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .activity-status {
            color: rgba(148, 163, 184, 0.94);
            font: 820 9.5px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;
            text-transform: lowercase;
          }
          .activity-item[data-status="completed"] .activity-status {
            color: rgba(187, 247, 208, 0.92);
          }
          .shell {
            position: absolute;
            left: 50%;
            bottom: max(12px, env(safe-area-inset-bottom, 0px));
            transform: translateX(-50%);
            display: grid;
            width: min(760px, calc(100vw - 24px));
            max-width: calc(100vw - 24px);
            min-width: 0;
            grid-template-columns: minmax(0, 1fr);
            gap: 3px;
            padding: 5px;
            border: 1px solid rgba(148, 163, 184, 0.28);
            border-radius: 24px;
            background: rgba(6, 10, 18, 0.82);
            box-shadow: 0 12px 34px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.04);
            backdrop-filter: blur(14px);
            pointer-events: auto;
          }
          textarea {
            width: 100%;
            min-width: 0;
            min-height: 30px;
            max-height: 54px;
            resize: none;
            padding: 6px 11px;
            border: 1px solid rgba(148, 163, 184, 0.2);
            border-radius: 999px;
            outline: 0;
            color: rgba(241, 245, 249, 0.94);
            background: rgba(2, 6, 12, 0.72);
            font: 650 11px/15px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;
            overflow-y: auto;
          }
          textarea:focus {
            border-color: rgba(96, 165, 250, 0.58);
            box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.13);
          }
          textarea::placeholder { color: rgba(148, 163, 184, 0.68); }
          textarea:disabled { cursor: not-allowed; opacity: 0.62; }
          .context-row {
            display: \${context ? "flex" : "none"};
            min-width: 0;
            align-items: center;
            justify-content: flex-start;
          }
          .context {
            display: inline-flex;
            max-width: min(360px, 100%);
            min-width: 0;
            height: 20px;
            align-items: center;
            gap: 5px;
            padding: 2px 3px 2px 7px;
            border: 1px solid rgba(52, 211, 153, 0.28);
            border-radius: 999px;
            color: rgba(209, 250, 229, 0.94);
            background: rgba(6, 78, 59, 0.2);
          }
          .context-kind {
            flex: 0 0 auto;
            font-size: 9.5px;
            font-weight: 860;
            line-height: 1;
            text-transform: uppercase;
            opacity: 0.78;
          }
          .context-text {
            min-width: 0;
            overflow: hidden;
            font-size: 10.5px;
            font-weight: 780;
            line-height: 1;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .context-clear {
            appearance: none;
            display: inline-flex;
            width: 17px;
            height: 17px;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            border: 0;
            border-radius: 999px;
            color: currentColor;
            background: rgba(255, 255, 255, 0.1);
            cursor: pointer;
            font-size: 13px;
            line-height: 1;
          }
          .footer {
            position: relative;
            display: flex;
            min-width: 0;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
          }
          .selector {
            appearance: none;
            display: inline-flex;
            width: fit-content;
            max-width: calc(100% - 36px);
            height: 22px;
            min-width: 0;
            align-items: center;
            gap: 4px;
            padding: 0 5px 0 6px;
            border: 1px solid color-mix(in srgb, var(--target-color) 40%, transparent);
            border-radius: 999px;
            color: rgba(226, 232, 240, 0.92);
            background: rgba(2, 6, 12, 0.74);
            box-shadow: 0 0 0 0 rgba(0,0,0,0);
            cursor: pointer;
          }
          .selector:focus-visible {
            outline: 0;
            box-shadow: 0 0 0 2px color-mix(in srgb, var(--target-color) 16%, transparent);
          }
          .harness {
            display: inline-flex;
            width: 13px;
            height: 13px;
            flex: 0 0 auto;
            align-items: center;
            justify-content: center;
            color: currentColor;
            font-size: 13px;
            font-weight: 820;
            line-height: 1;
          }
          .dot {
            width: 6px;
            height: 6px;
            flex: 0 0 auto;
            border: 1px solid rgba(255, 255, 255, 0.44);
            border-radius: 999px;
            background: var(--target-color);
            box-shadow: 0 0 10px color-mix(in srgb, var(--target-color) 72%, transparent);
          }
          .name {
            min-width: 0;
            overflow: hidden;
            font-size: 10.5px;
            font-weight: 820;
            line-height: 1;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .chevron {
            width: 10px;
            height: 10px;
            flex: 0 0 auto;
            color: rgba(148, 163, 184, 0.92);
            transform: \${state.menuOpen ? "rotate(180deg)" : "none"};
          }
          .menu {
            position: absolute;
            left: 0;
            bottom: 28px;
            z-index: 2;
            min-width: 150px;
            max-width: min(260px, calc(100vw - 32px));
            max-height: 136px;
            overflow: auto;
            padding: 3px;
            border: 1px solid rgba(230, 236, 245, 0.13);
            border-radius: 14px;
            background: rgba(15, 19, 27, 0.99);
            box-shadow: 0 -8px 26px rgba(0, 0, 0, 0.34), 0 10px 28px rgba(0, 0, 0, 0.22);
          }
          .option {
            appearance: none;
            display: flex;
            width: 100%;
            min-height: 28px;
            align-items: center;
            gap: 5px;
            padding: 5px 7px;
            border: 0;
            border-radius: 11px;
            color: rgba(226, 232, 240, 0.9);
            background: transparent;
            cursor: pointer;
            font: 800 10.5px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;
            text-align: left;
          }
          .option:hover { background: rgba(230, 236, 245, 0.09); }
          .option[data-selected="true"] { color: #fff; background: rgba(96, 165, 250, 0.16); }
          .check {
            width: 10px;
            flex: 0 0 10px;
            color: rgba(147, 197, 253, 0.96);
            font-size: 10px;
          }
          .empty {
            padding: 7px 9px;
            color: rgba(148, 163, 184, 0.72);
            font: 720 11px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;
          }
          .send {
            appearance: none;
            display: inline-flex;
            width: 30px;
            height: 30px;
            flex: 0 0 30px;
            align-items: center;
            justify-content: center;
            margin-left: auto;
            border: 1px solid rgba(96, 165, 250, 0.38);
            border-radius: 999px;
            color: rgba(219, 234, 254, 0.96);
            background: rgba(37, 99, 235, 0.28);
            cursor: pointer;
          }
          .send:hover:not(:disabled) {
            border-color: rgba(147, 197, 253, 0.62);
            background: rgba(37, 99, 235, 0.4);
          }
          .send:disabled { cursor: not-allowed; opacity: 0.48; }
          .send svg { width: 15px; height: 15px; }
          .error {
            display: \${state.error ? "block" : "none"};
            min-width: 0;
            padding: 0 12px 2px;
            color: #fca5a5;
            font: 760 11px/1.3 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;
          }
        </style>
        \${activity}
        <div class="shell" role="group" aria-label="Send prompt to terminal agents">
          <textarea aria-label="Prompt" data-role="prompt" placeholder="\${targets.length ? "Prompt selected agents" : "Open a coding-agent terminal first"}" rows="1" \${disabled ? "disabled" : ""}></textarea>
          <div class="context-row">
            <div class="context" title="\${html(contextText)}">
              <span class="context-kind">Element</span>
              <span class="context-text">\${html(contextText)}</span>
              <button aria-label="Clear selected web element" class="context-clear" data-role="clear-context" type="button">×</button>
            </div>
          </div>
          <div class="footer">
            <button aria-expanded="\${state.menuOpen ? "true" : "false"}" aria-label="Terminal agents" class="selector" data-role="selector" style="--target-color:\${html(accent)}" type="button" \${disabled ? "disabled" : ""}>
              <span class="harness">\${html(iconForRole(selectedRole))}</span>
              <span class="dot" style="--target-color:\${html(accent)}"></span>
              <span class="name">\${html(selectedLabel)}</span>
              <svg class="chevron" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>
            </button>
            \${menu}
            <button aria-label="Send prompt" class="send" data-role="send" type="button" \${disabled || !state.selectedIds.length || !text(state.prompt) ? "disabled" : ""}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3.4 20.4 21 12 3.4 3.6 3 10.1 14.4 12 3 13.9z"/></svg>
            </button>
          </div>
          <div class="error" role="alert">\${html(state.error)}</div>
        </div>
      \`;

      const shell = root.querySelector(".shell");
      shieldOverlayControl(shell);

      const prompt = root.querySelector('[data-role="prompt"]');
      if (prompt) {
        prompt.value = state.prompt;
        shieldOverlayControl(prompt);
        prompt.addEventListener("pointerdown", () => focusPrompt(prompt));
        prompt.addEventListener("click", () => focusPrompt(prompt));
        prompt.addEventListener("input", (event) => {
          event.stopPropagation();
          state.prompt = event.target.value;
          state.error = "";
          const send = root.querySelector('[data-role="send"]');
          if (send) {
            send.disabled = state.submitting || !state.selectedIds.length || !text(state.prompt);
          }
        });
        prompt.addEventListener("keydown", (event) => {
          event.stopPropagation();
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            submit(state);
          } else if (event.key === "Escape") {
            event.preventDefault();
            pushEvent(state, { type: "close" });
          }
        });
        if (promptHadFocus && !disabled) {
          focusPrompt(prompt, promptSelection);
        } else if (!state.didAutofocus && !disabled) {
          state.didAutofocus = true;
          focusPrompt(prompt);
        }
      }

      const selector = root.querySelector('[data-role="selector"]');
      if (selector) {
        shieldOverlayControl(selector);
        selector.addEventListener("click", (event) => {
          event.stopPropagation();
          state.menuOpen = !state.menuOpen;
          render(state);
        });
      }

      root.querySelectorAll("[data-target-id]").forEach((button) => {
        shieldOverlayControl(button);
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          const id = text(button.getAttribute("data-target-id"));
          if (!id) return;
          if (state.selectedIds.includes(id)) {
            state.selectedIds = state.selectedIds.filter((targetId) => targetId !== id);
          } else {
            state.selectedIds = [...state.selectedIds, id];
          }
          state.error = "";
          render(state);
        });
      });

      const send = root.querySelector('[data-role="send"]');
      if (send) {
        shieldOverlayControl(send);
        send.addEventListener("click", (event) => {
          event.stopPropagation();
          submit(state);
        });
      }

      const clear = root.querySelector('[data-role="clear-context"]');
      if (clear) {
        shieldOverlayControl(clear);
        clear.addEventListener("click", (event) => {
          event.stopPropagation();
          pushEvent(state, { type: "clearContext" });
        });
      }
    }

    function ensureState() {
      let state = window[KEY];
      let host = document.getElementById(HOST_ID);
      if (!host) {
        host = document.createElement("div");
        host.id = HOST_ID;
        document.documentElement.appendChild(host);
      }
      if (!host.shadowRoot) {
        host.attachShadow({ mode: "open" });
      }
      if (!state || state.host !== host || state.root !== host.shadowRoot) {
        state = {
          config: { activityItems: [], contextRefs: [], defaultSelectedTargetIds: [], targets: [] },
          didAutofocus: false,
          error: "",
          events: [],
          host,
          menuOpen: false,
          prompt: "",
          root: host.shadowRoot,
          selectedIds: [],
          submitting: false
        };
        state.drainEvents = () => {
          const events = state.events.slice();
          state.events.length = 0;
          return events;
        };
        state.destroy = () => {
          state.host.remove();
          delete window[KEY];
        };
        state.setError = (message) => {
          state.error = text(message);
          state.submitting = false;
          render(state);
        };
        state.setSubmitting = (submitting) => {
          state.submitting = Boolean(submitting);
          render(state);
        };
        state.finishSubmit = () => {
          state.prompt = "";
          state.error = "";
          state.submitting = false;
          render(state);
        };
        window[KEY] = state;
      }
      state.host = host;
      state.root = host.shadowRoot;
      return state;
    }

    if (ACTION === "hide") {
      const state = window[KEY];
      if (state && typeof state.destroy === "function") {
        state.destroy();
      } else {
        const host = document.getElementById(HOST_ID);
        if (host) host.remove();
        delete window[KEY];
      }
      return { ok: true };
    }

    if (ACTION === "drain") {
      const state = window[KEY];
      return state && typeof state.drainEvents === "function" ? state.drainEvents() : [{ type: "missing" }];
    }

    if (ACTION === "error") {
      const state = ensureState();
      state.setError(CONFIG.message || "Unable to send prompt.");
      return { ok: true };
    }

    if (ACTION === "submitting") {
      const state = ensureState();
      state.setSubmitting(CONFIG.submitting !== false);
      return { ok: true };
    }

    if (ACTION === "submitted") {
      const state = ensureState();
      state.finishSubmit();
      return { ok: true };
    }

    const state = ensureState();
    state.config = {
      activityItems: normalizeActivityItems(CONFIG.activityItems),
      contextRefs: array(CONFIG.contextRefs),
      defaultSelectedTargetIds: array(CONFIG.defaultSelectedTargetIds).map(text).filter(Boolean),
      targets: normalizeTargets(CONFIG.targets)
    };
    state.selectedIds = normalizeSelectedIds(state.config.targets, state.selectedIds, state.config.defaultSelectedTargetIds);
    render(state);
    return { ok: true };
  })()`;
}

function normalizeOverlayEvents(value) {
  return cleanArray(value).filter((event) => event && typeof event === "object");
}

export function useWebAgentPromptOverlay({
  activityItems = [],
  contextRefs = [],
  defaultSelectedTargetIds = [],
  enabled = false,
  evaluate,
  onClearContext = null,
  onClose = null,
  onSubmit = null,
  targets = [],
  windowId = "",
} = {}) {
  const activityItemsRef = useRef(activityItems);
  const clearContextRef = useRef(onClearContext);
  const closeRef = useRef(onClose);
  const contextRefsRef = useRef(contextRefs);
  const defaultSelectedTargetIdsRef = useRef(defaultSelectedTargetIds);
  const evaluateRef = useRef(evaluate);
  const submitRef = useRef(onSubmit);
  const targetsRef = useRef(targets);
  const windowIdRef = useRef(windowId);

  activityItemsRef.current = activityItems;
  clearContextRef.current = onClearContext;
  closeRef.current = onClose;
  contextRefsRef.current = contextRefs;
  defaultSelectedTargetIdsRef.current = defaultSelectedTargetIds;
  evaluateRef.current = evaluate;
  submitRef.current = onSubmit;
  targetsRef.current = targets;
  windowIdRef.current = windowId;

  const nativeEnabled = Boolean(enabled) && hasTauriRuntime() && typeof evaluate === "function";
  const config = useMemo(() => buildOverlayConfig({
    activityItems,
    contextRefs,
    defaultSelectedTargetIds,
    targets,
  }), [activityItems, contextRefs, defaultSelectedTargetIds, targets]);
  const configRef = useRef(config);
  configRef.current = config;
  const configSignature = useMemo(() => JSON.stringify(config), [config]);

  const runOverlayAction = useCallback((action, payload = {}, options = {}) => {
    const evaluator = evaluateRef.current;
    if (typeof evaluator !== "function") {
      return Promise.reject(new Error("Workspace web view is unavailable."));
    }
    return evaluator(buildWebAgentPromptOverlayScript(action, payload), {
      expectResult: options.expectResult !== false,
    });
  }, []);

  useEffect(() => {
    if (!nativeEnabled) {
      if (typeof evaluate === "function") {
        void evaluate(buildWebAgentPromptOverlayScript("hide"), { expectResult: false }).catch(() => {});
      }
      return undefined;
    }
    void runOverlayAction("show", configRef.current, { expectResult: false }).catch(() => {});
    return undefined;
  }, [configSignature, evaluate, nativeEnabled, runOverlayAction]);

  useEffect(() => {
    if (!nativeEnabled) {
      return undefined;
    }
    return () => {
      const evaluator = evaluateRef.current;
      if (typeof evaluator === "function") {
        void evaluator(buildWebAgentPromptOverlayScript("hide"), { expectResult: false }).catch(() => {});
      }
    };
  }, [nativeEnabled]);

  useEffect(() => {
    if (!nativeEnabled) {
      return undefined;
    }
    let disposed = false;
    let timeoutId = 0;

    const poll = async () => {
      if (disposed) {
        return;
      }
      try {
        const events = normalizeOverlayEvents(
          await runOverlayAction("drain", {}, { expectResult: true }),
        );
        for (const event of events) {
          if (disposed) {
            return;
          }
          const type = cleanText(event.type);
          if (type === "close") {
            closeRef.current?.();
            return;
          }
          if (type === "missing") {
            await runOverlayAction("show", buildOverlayConfig({
              activityItems: activityItemsRef.current,
              contextRefs: contextRefsRef.current,
              defaultSelectedTargetIds: defaultSelectedTargetIdsRef.current,
              targets: targetsRef.current,
            }), { expectResult: false }).catch(() => {});
            continue;
          }
          if (type === "clearContext") {
            await clearContextRef.current?.();
            continue;
          }
          if (type !== "submit") {
            continue;
          }
          const text = cleanText(event.text);
          const targetIds = normalizeOverlayTargetIds(event.targetIds);
          const currentTargets = normalizeOverlayTargets(targetsRef.current);
          const targetTerminalIndexes = targetIds
            .map((targetId) => currentTargets.find((target) => target.id === targetId)?.terminalIndex)
            .filter((terminalIndex) => Number.isInteger(terminalIndex));
          try {
            await submitRef.current?.({
              contextRefs: contextRefsRef.current,
              targetIds,
              targetTerminalIndexes,
              text,
              windowId: windowIdRef.current,
            });
            if (disposed) {
              return;
            }
            await runOverlayAction("submitted", {}, { expectResult: false }).catch(() => {});
          } catch (err) {
            if (disposed) {
              return;
            }
            await runOverlayAction("error", {
              message: err?.message || String(err || "Unable to send prompt."),
            }, { expectResult: false }).catch(() => {});
          }
        }
      } catch {
        // Navigations briefly tear down the external document; the next poll will
        // reinstall the overlay through the config effect.
        void runOverlayAction("show", buildOverlayConfig({
          activityItems: activityItemsRef.current,
          contextRefs: contextRefsRef.current,
          defaultSelectedTargetIds: defaultSelectedTargetIdsRef.current,
          targets: targetsRef.current,
        }), { expectResult: false }).catch(() => {});
      }
      timeoutId = window.setTimeout(poll, WEB_AGENT_PROMPT_OVERLAY_POLL_MS);
    };

    timeoutId = window.setTimeout(poll, 80);
    return () => {
      disposed = true;
      window.clearTimeout(timeoutId);
    };
  }, [nativeEnabled, runOverlayAction]);

  return {
    active: nativeEnabled,
  };
}

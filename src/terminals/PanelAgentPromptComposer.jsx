import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import styled from "styled-components";
import { Close } from "@styled-icons/material-rounded/Close";
import { ScatterPlot } from "@styled-icons/material-rounded/ScatterPlot";
import { Send } from "@styled-icons/material-rounded/Send";

import {
  WorkspaceCreateAgentClaudeIcon,
  WorkspaceCreateAgentCodexIcon,
  WorkspaceCreateAgentOpenCodeIcon,
  WorkspaceCreateAgentTerminalIcon,
} from "../app/appStyles.js";

function AgentHarnessIcon({ role }) {
  const normalizedRole = String(role || "").trim().toLowerCase();
  if (normalizedRole === "codex") {
    return <WorkspaceCreateAgentCodexIcon aria-hidden="true" />;
  }
  if (normalizedRole === "claude") {
    return <WorkspaceCreateAgentClaudeIcon aria-hidden="true" />;
  }
  if (normalizedRole === "swarm") {
    return <ScatterPlot aria-hidden="true" />;
  }
  if (normalizedRole === "opencode") {
    return (
      <WorkspaceCreateAgentOpenCodeIcon
        aria-hidden="true"
        fill="none"
        viewBox="0 0 24 30"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M18 24H6V12H18V24Z" fill="currentColor" opacity="0.72" />
        <path d="M18 6H6V24H18V6ZM24 30H0V0H24V30Z" fill="currentColor" />
      </WorkspaceCreateAgentOpenCodeIcon>
    );
  }
  return <WorkspaceCreateAgentTerminalIcon aria-hidden="true" />;
}

function normalizeSelectedTargetIds(targets, selectedIds) {
  const targetIdSet = new Set((Array.isArray(targets) ? targets : []).map((target) => target.id));
  return (Array.isArray(selectedIds) ? selectedIds : [])
    .map((id) => String(id || "").trim())
    .filter((id, index, list) => id && targetIdSet.has(id) && list.indexOf(id) === index);
}

function panelAgentColorAlpha(hex, alpha, fallback = "rgba(96, 165, 250, 0.18)") {
  const value = String(hex || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    return fallback;
  }
  const r = Number.parseInt(value.slice(1, 3), 16);
  const g = Number.parseInt(value.slice(3, 5), 16);
  const b = Number.parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function compactTargetName(option) {
  return String(
    option?.short || option?.terminal_nickname || option?.label || option?.name || "",
  ).trim();
}

function targetOptionLabelRenderer(option, { context } = {}) {
  return (
    <TargetOptionLabel
      data-context={context || "menu"}
      style={{ "--panel-agent-color": option.color || "#8bb8ff" }}
    >
      <HarnessIcon data-role={option.role}>
        <AgentHarnessIcon role={option.role} />
      </HarnessIcon>
      <TargetDot aria-hidden="true" />
      <TargetName>{compactTargetName(option) || option.label}</TargetName>
    </TargetOptionLabel>
  );
}

function contextRefLabel(context) {
  if (!context || typeof context !== "object") {
    return "";
  }
  if (typeof context.label === "string" && context.label.trim()) {
    // PCB element contexts carry a prebuilt pill label (designator/net).
    return context.label.trim();
  }
  const element = String(context.element || context.tag_name || "element").trim();
  const host = (() => {
    try {
      return new URL(context.url || "").host;
    } catch {
      return "";
    }
  })();
  return [element, host].filter(Boolean).join(" on ");
}

const TARGET_SELECT_STYLES = {
  container: (base) => ({
    ...base,
    display: "inline-block",
    flex: "0 1 auto",
    minWidth: 0,
    maxWidth: "100%",
    width: "fit-content",
  }),
  control: (base, state) => {
    const accent = state.getValue()?.[0]?.color || "";
    return {
      ...base,
      width: "fit-content",
      maxWidth: "100%",
      height: 22,
      minHeight: 22,
      padding: "0 2px",
      borderRadius: 999,
      backgroundColor: state.isFocused
        ? "var(--panel-agent-picker-bg-focus)"
        : "var(--panel-agent-picker-bg)",
      borderColor: accent
        ? panelAgentColorAlpha(accent, state.isFocused ? 0.72 : 0.36)
        : state.isFocused
          ? "var(--panel-agent-picker-border-focus)"
          : "var(--panel-agent-picker-border)",
      boxShadow: state.isFocused
        ? `0 0 0 2px ${accent ? panelAgentColorAlpha(accent, 0.12) : "rgba(96, 165, 250, 0.12)"}`
        : "none",
      cursor: "pointer",
      transition: "border-color 120ms ease, background-color 120ms ease, box-shadow 140ms ease",
      ":hover": {
        borderColor: accent ? panelAgentColorAlpha(accent, 0.58) : "var(--panel-agent-picker-border-focus)",
      },
    };
  },
  valueContainer: (base) => ({
    ...base,
    width: "auto",
    maxWidth: "100%",
    height: 20,
    minHeight: 20,
    flexWrap: "nowrap",
    overflowX: "hidden",
    overflowY: "hidden",
    padding: "0 1px 0 2px",
    gap: 0,
  }),
  multiValue: (base, state) => ({
    ...base,
    minWidth: 0,
    maxWidth: 112,
    flex: "0 0 auto",
    alignItems: "center",
    margin: 0,
    border: 0,
    borderRadius: 999,
    backgroundColor: "transparent",
  }),
  multiValueLabel: (base) => ({
    ...base,
    minWidth: 0,
    padding: "0 3px",
    color: "var(--panel-agent-picker-text)",
    fontSize: 10.5,
    fontWeight: 800,
  }),
  multiValueRemove: (base) => ({
    ...base,
    display: "none",
  }),
  placeholder: (base) => ({
    ...base,
    color: "var(--panel-agent-picker-placeholder)",
    fontSize: 10.5,
    fontWeight: 760,
  }),
  input: (base) => ({
    ...base,
    color: "var(--panel-agent-picker-text)",
    fontSize: 10.5,
    margin: 0,
    padding: 0,
  }),
  indicatorsContainer: (base) => ({
    ...base,
    flex: "0 0 auto",
    height: 20,
    alignSelf: "stretch",
  }),
  indicatorSeparator: () => ({ display: "none" }),
  clearIndicator: (base) => ({
    ...base,
    padding: "0 1px",
    color: "var(--panel-agent-picker-muted)",
    ":hover": { color: "var(--panel-agent-picker-text-strong)" },
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    padding: "0 3px 0 1px",
    color: state.isFocused ? "var(--panel-agent-picker-text-strong)" : "var(--panel-agent-picker-muted)",
    transition: "color 120ms ease, transform 160ms ease",
    transform: state.selectProps.menuIsOpen ? "rotate(180deg)" : "none",
    ":hover": { color: "var(--panel-agent-picker-text-strong)" },
  }),
  menu: (base) => ({
    ...base,
    left: 0,
    right: "auto",
    minWidth: 150,
    width: "max-content",
    maxWidth: "min(260px, calc(100vw - 32px))",
    zIndex: 80,
    marginBottom: 6,
    overflow: "hidden",
    border: "1px solid var(--panel-agent-picker-menu-border)",
    borderRadius: 14,
    backgroundColor: "var(--panel-agent-picker-menu-bg)",
    boxShadow: "0 -8px 26px rgba(0, 0, 0, 0.34), 0 10px 28px rgba(0, 0, 0, 0.22)",
  }),
  menuList: (base) => ({
    ...base,
    maxHeight: 136,
    padding: 3,
  }),
  option: (base, state) => {
    const accent = state.data?.color || "";
    return {
      ...base,
      display: "flex",
      alignItems: "center",
      minHeight: 28,
      borderRadius: 11,
      padding: "5px 7px",
      color: state.isSelected
        ? "var(--panel-agent-picker-text-strong)"
        : "var(--panel-agent-picker-text)",
      backgroundColor: state.isSelected
        ? panelAgentColorAlpha(accent, 0.24, "var(--panel-agent-picker-option-selected-bg)")
        : state.isFocused
          ? "var(--panel-agent-picker-option-hover-bg)"
          : "transparent",
      cursor: "pointer",
      ":active": {
        backgroundColor: panelAgentColorAlpha(accent, 0.2, "var(--panel-agent-picker-option-active-bg)"),
      },
    };
  },
  noOptionsMessage: (base) => ({
    ...base,
    color: "var(--panel-agent-picker-placeholder)",
    fontSize: 11,
    fontWeight: 720,
    padding: "7px 9px",
  }),
};

export default function PanelAgentPromptComposer({
  autoFocus = false,
  context_refs: contextRefs = [],
  default_selected_target_ids: defaultSelectedTargetIds = [],
  onClose = null,
  onClearContext = null,
  onSubmit = null,
  onTargetMenuOpenChange = null,
  panel_kind: panelKind = "panel",
  panel_pane_id: panelPaneId = "",
  targets = [],
  window_id: windowId = "",
}) {
  const [selectedTargetIds, setSelectedTargetIds] = useState(() => (
    normalizeSelectedTargetIds(targets, defaultSelectedTargetIds)
  ));
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // Video panes transcribe missing media before submitting; the pane
  // broadcasts progress so the composer can say why it's busy.
  const [prepHint, setPrepHint] = useState("");
  useEffect(() => {
    if (panelKind !== "video") {
      return undefined;
    }
    const onPrep = (event) => {
      const detail = event?.detail || {};
      if (detail.phase === "transcribing") {
        const count = Number(detail.count) || 0;
        setPrepHint(`Transcribing ${count} clip${count === 1 ? "" : "s"} for context…`);
      } else {
        setPrepHint("");
      }
    };
    window.addEventListener("diffforge-video-agent-prep", onPrep);
    return () => window.removeEventListener("diffforge-video-agent-prep", onPrep);
  }, [panelKind]);
  const inputRef = useRef(null);
  const targetSignature = useMemo(
    () => (Array.isArray(targets) ? targets : []).map((target) => target.id).join("|"),
    [targets],
  );
  const targetOptions = useMemo(() => (
    (Array.isArray(targets) ? targets : []).map((target) => {
      const fallbackLabel = target.label || `Agent ${target.terminal_index + 1}`;
      const shortLabel = compactTargetName(target);
      return {
        ...target,
        color: target.color || "#8bb8ff",
        fullLabel: fallbackLabel,
        label: shortLabel || fallbackLabel,
        short: shortLabel,
        value: target.id,
      };
    })
  ), [targets]);
  const selectedOptions = useMemo(() => {
    const selectedIdSet = new Set(selectedTargetIds);
    return targetOptions.filter((target) => selectedIdSet.has(target.id));
  }, [selectedTargetIds, targetOptions]);
  const selectedContexts = useMemo(() => (
    (Array.isArray(contextRefs) ? contextRefs : []).filter((context) => context && typeof context === "object")
  ), [contextRefs]);

  useEffect(() => {
    setSelectedTargetIds((current) => {
      const normalizedCurrent = normalizeSelectedTargetIds(targets, current);
      if (normalizedCurrent.length) {
        return normalizedCurrent;
      }
      return normalizeSelectedTargetIds(targets, defaultSelectedTargetIds);
    });
  }, [defaultSelectedTargetIds, targetSignature, targets]);

  useEffect(() => {
    if (!autoFocus) {
      return;
    }
    const frameId = window.requestAnimationFrame(() => inputRef.current?.focus?.());
    return () => window.cancelAnimationFrame(frameId);
  }, [autoFocus]);

  useEffect(() => () => {
    onTargetMenuOpenChange?.(false);
  }, [onTargetMenuOpenChange]);

  const updateSelectedTargets = useCallback((options) => {
    setError("");
    setSelectedTargetIds(
      (Array.isArray(options) ? options : [])
        .map((option) => String(option?.id || option?.value || "").trim())
        .filter(Boolean),
    );
  }, []);

  const submitPrompt = useCallback(async (event) => {
    event?.preventDefault?.();
    if (submitting) {
      return;
    }
    const text = prompt.trim();
    if (!text) {
      setError("Type a prompt.");
      return;
    }
    const targetIds = normalizeSelectedTargetIds(targets, selectedTargetIds);
    if (!targetIds.length) {
      setError("Choose at least one agent.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onSubmit?.({
        context_refs: contextRefs,
        panel_kind: panelKind,
        panel_pane_id: panelPaneId,
        target_ids: targetIds,
        target_terminal_indexes: targetIds
          .map((targetId) => targets.find((target) => target.id === targetId)?.terminal_index)
          .filter((terminalIndex) => Number.isInteger(terminalIndex)),
        text,
        window_id: windowId,
      });
      await onClearContext?.();
      setPrompt("");
    } catch (err) {
      setError(err?.message || String(err || "Unable to send prompt."));
    } finally {
      setSubmitting(false);
    }
  }, [contextRefs, onClearContext, onSubmit, panelKind, panelPaneId, prompt, selectedTargetIds, submitting, targets, windowId]);

  const targetCount = Array.isArray(targets) ? targets.length : 0;
  const selectedCount = selectedTargetIds.length;

  return (
    <ComposerShell
      aria-label="Send prompt to terminal agents"
      data-terminal-control="true"
      onSubmit={submitPrompt}
    >
      <PromptInput
        aria-label="Prompt"
        disabled={submitting || !targetCount}
        onChange={(event) => {
          setPrompt(event.target.value);
          if (error) {
            setError("");
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent?.isComposing) {
            submitPrompt(event);
          }
          if (event.key === "Escape") {
            onClose?.();
          }
        }}
        placeholder={targetCount ? "Prompt selected agents" : "Open a coding-agent terminal first"}
        ref={inputRef}
        rows={1}
        value={prompt}
      />
      {selectedContexts.length ? (
        <ContextChipRow>
          {selectedContexts.map((context, index) => {
            const selectedContextLabel = contextRefLabel(context);
            return (
              <ContextChip
                key={context.id || context.selector || `${selectedContextLabel}:${index}`}
                title={selectedContextLabel || "Selected element"}
              >
                <ContextChipKind>{context.kind === "pcb-element" ? "PCB" : "Element"}</ContextChipKind>
                <ContextChipText>{selectedContextLabel || "Selected element"}</ContextChipText>
                {typeof onClearContext === "function" && index === selectedContexts.length - 1 ? (
                  <ContextChipButton
                    aria-label="Clear selected elements"
                    disabled={submitting}
                    onClick={onClearContext}
                    title="Clear selected elements"
                    type="button"
                  >
                    <Close aria-hidden="true" />
                  </ContextChipButton>
                ) : null}
              </ContextChip>
            );
          })}
        </ContextChipRow>
      ) : null}
      <ComposerFooter>
        <TargetPickerFrame>
          {targetCount ? (
            <Select
              aria-label="Terminal agents"
              closeMenuOnSelect={false}
              formatOptionLabel={targetOptionLabelRenderer}
              hideSelectedOptions={false}
              isClearable={false}
              isDisabled={submitting}
              isMulti
              isSearchable={false}
              menuPlacement="top"
              noOptionsMessage={() => "No coding agents open"}
              onChange={updateSelectedTargets}
              onMenuClose={() => onTargetMenuOpenChange?.(false)}
              onMenuOpen={() => onTargetMenuOpenChange?.(true)}
              options={targetOptions}
              placeholder="Agents"
              styles={TARGET_SELECT_STYLES}
              value={selectedOptions}
            />
          ) : (
            <EmptyTargets>No agents</EmptyTargets>
          )}
        </TargetPickerFrame>
        <SendButton
          aria-label="Send prompt"
          disabled={submitting || !targetCount || !selectedCount || !prompt.trim()}
          title="Send prompt"
          type="submit"
        >
          <Send aria-hidden="true" />
        </SendButton>
      </ComposerFooter>
      {error ? <ComposerError role="alert">{error}</ComposerError> : null}
      {prepHint && submitting ? <ComposerPrepHint>{prepHint}</ComposerPrepHint> : null}
    </ComposerShell>
  );
}

const ComposerShell = styled.form`
  --panel-agent-picker-bg: rgba(2, 6, 12, 0.74);
  --panel-agent-picker-bg-focus: rgba(15, 23, 42, 0.86);
  --panel-agent-picker-border: rgba(148, 163, 184, 0.2);
  --panel-agent-picker-border-focus: rgba(96, 165, 250, 0.58);
  --panel-agent-picker-menu-bg: rgba(15, 19, 27, 0.99);
  --panel-agent-picker-menu-border: rgba(230, 236, 245, 0.13);
  --panel-agent-picker-muted: rgba(148, 163, 184, 0.78);
  --panel-agent-picker-option-active-bg: rgba(96, 165, 250, 0.16);
  --panel-agent-picker-option-hover-bg: rgba(230, 236, 245, 0.09);
  --panel-agent-picker-option-selected-bg: rgba(96, 165, 250, 0.22);
  --panel-agent-picker-placeholder: rgba(148, 163, 184, 0.72);
  --panel-agent-picker-text: rgba(226, 232, 240, 0.9);
  --panel-agent-picker-text-strong: #ffffff;

  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  z-index: 42;
  display: grid;
  width: min(760px, calc(100% - 24px));
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  gap: 3px;
  padding: 5px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  border-radius: 24px;
  background: rgba(6, 10, 18, 0.82);
  box-shadow:
    0 12px 34px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(14px);

  @media (max-width: 620px) {
    width: calc(100% - 16px);
    padding: 5px;
  }

  html[data-forge-theme="light"] & {
    --panel-agent-picker-bg: rgba(248, 250, 252, 0.82);
    --panel-agent-picker-bg-focus: rgba(255, 255, 255, 0.96);
    --panel-agent-picker-border: rgba(24, 34, 48, 0.16);
    --panel-agent-picker-border-focus: rgba(0, 102, 204, 0.5);
    --panel-agent-picker-menu-bg: rgba(255, 255, 255, 0.99);
    --panel-agent-picker-menu-border: rgba(24, 34, 48, 0.14);
    --panel-agent-picker-muted: rgba(71, 85, 105, 0.76);
    --panel-agent-picker-option-active-bg: rgba(0, 102, 204, 0.12);
    --panel-agent-picker-option-hover-bg: rgba(15, 23, 42, 0.06);
    --panel-agent-picker-option-selected-bg: rgba(0, 102, 204, 0.14);
    --panel-agent-picker-placeholder: rgba(71, 85, 105, 0.68);
    --panel-agent-picker-text: rgba(30, 41, 59, 0.9);
    --panel-agent-picker-text-strong: rgba(15, 23, 42, 0.96);

    border-color: rgba(24, 34, 48, 0.16);
    background: rgba(255, 255, 255, 0.88);
    box-shadow:
      0 12px 34px rgba(24, 34, 48, 0.14),
      inset 0 1px 0 rgba(255, 255, 255, 0.7);
  }
`;

const TargetPickerFrame = styled.div`
  display: inline-flex;
  flex: 0 1 auto;
  min-width: 0;
  max-width: calc(100% - 36px);
  width: auto;
`;

const ContextChipRow = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-start;
  flex-wrap: wrap;
  gap: 4px;
`;

const ContextChip = styled.div`
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
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);

  html[data-forge-theme="light"] & {
    border-color: rgba(5, 150, 105, 0.24);
    color: rgba(6, 95, 70, 0.96);
    background: rgba(209, 250, 229, 0.72);
  }
`;

const ContextChipKind = styled.span`
  flex: 0 0 auto;
  color: currentColor;
  font-size: 9.5px;
  font-weight: 860;
  letter-spacing: 0;
  text-transform: uppercase;
  opacity: 0.78;
`;

const ContextChipText = styled.span`
  min-width: 0;
  overflow: hidden;
  font-size: 10.5px;
  font-weight: 780;
  letter-spacing: 0;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ContextChipButton = styled.button`
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

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.18);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

const TargetOptionLabel = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  color: currentColor;

  &[data-context="value"] {
    gap: 4px;
  }
`;

const HarnessIcon = styled.span`
  display: inline-flex;
  width: 13px;
  height: 13px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: currentColor;

  svg {
    width: 12px;
    height: 12px;
  }

  &[data-role="opencode"] svg {
    width: 9px;
    height: 12px;
  }
`;

const TargetDot = styled.span`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.44);
  border-radius: 999px;
  background: var(--panel-agent-color);
  box-shadow: 0 0 10px color-mix(in srgb, var(--panel-agent-color) 72%, transparent);
`;

const TargetName = styled.span`
  min-width: 0;
  overflow: hidden;
  font-size: 10.5px;
  font-weight: 820;
  letter-spacing: 0;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const EmptyTargets = styled.span`
  min-height: 22px;
  display: inline-flex;
  width: auto;
  align-items: center;
  padding: 0 8px;
  border: 1px solid var(--panel-agent-picker-border);
  border-radius: 999px;
  background: var(--panel-agent-picker-bg);
  color: rgba(148, 163, 184, 0.86);
  font-size: 11px;
  font-weight: 780;
  white-space: nowrap;
`;

const ComposerFooter = styled.div`
  display: flex;
  min-width: 0;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
`;

const PromptInput = styled.textarea`
  width: 100%;
  min-width: 0;
  max-height: 54px;
  min-height: 30px;
  resize: none;
  padding: 6px 11px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 999px;
  outline: 0;
  color: rgba(241, 245, 249, 0.94);
  background: rgba(2, 6, 12, 0.72);
  font-size: 11px;
  font-weight: 650;
  line-height: 15px;
  overflow-y: auto;

  &:focus {
    border-color: rgba(96, 165, 250, 0.58);
    box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.13);
  }

  &::placeholder {
    color: rgba(148, 163, 184, 0.68);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.62;
  }

  html[data-forge-theme="light"] & {
    color: rgba(18, 24, 36, 0.92);
    background: rgba(255, 255, 255, 0.92);
  }
`;

const SendButton = styled.button`
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

  svg {
    width: 15px;
    height: 15px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(147, 197, 253, 0.62);
    background: rgba(37, 99, 235, 0.4);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }
`;

const ComposerError = styled.div`
  grid-column: 1 / -1;
  min-width: 0;
  padding: 0 12px 2px;
  color: #fca5a5;
  font-size: 11px;
  font-weight: 760;
  line-height: 1.3;
`;

const ComposerPrepHint = styled.div`
  grid-column: 1 / -1;
  min-width: 0;
  padding: 0 12px 2px;
  color: #93c5fd;
  font-size: 10.5px;
  font-weight: 650;
  line-height: 1.3;
`;

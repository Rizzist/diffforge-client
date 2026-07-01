import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Select from "react-select";
import styled from "styled-components";
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
      <TargetName>{option.label}</TargetName>
    </TargetOptionLabel>
  );
}

const TARGET_SELECT_STYLES = {
  container: (base) => ({
    ...base,
    minWidth: 0,
    width: "100%",
  }),
  control: (base, state) => {
    const accent = state.getValue()?.[0]?.color || "";
    return {
      ...base,
      height: 36,
      minHeight: 36,
      borderRadius: 8,
      backgroundColor: state.isFocused
        ? "var(--panel-agent-picker-bg-focus)"
        : "var(--panel-agent-picker-bg)",
      borderColor: accent
        ? panelAgentColorAlpha(accent, state.isFocused ? 0.72 : 0.36)
        : state.isFocused
          ? "var(--panel-agent-picker-border-focus)"
          : "var(--panel-agent-picker-border)",
      boxShadow: state.isFocused
        ? `0 0 0 3px ${accent ? panelAgentColorAlpha(accent, 0.12) : "rgba(96, 165, 250, 0.12)"}`
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
    height: 34,
    minHeight: 34,
    flexWrap: "nowrap",
    overflowX: "auto",
    overflowY: "hidden",
    padding: "3px 6px",
    gap: 4,
  }),
  multiValue: (base, state) => ({
    ...base,
    minWidth: 0,
    maxWidth: 178,
    flex: "0 0 auto",
    alignItems: "center",
    border: `1px solid ${panelAgentColorAlpha(state.data?.color, 0.34, "rgba(148, 163, 184, 0.2)")}`,
    borderRadius: 999,
    backgroundColor: panelAgentColorAlpha(state.data?.color, 0.18, "rgba(15, 23, 42, 0.74)"),
  }),
  multiValueLabel: (base) => ({
    ...base,
    minWidth: 0,
    padding: "3px 5px 3px 7px",
    color: "var(--panel-agent-picker-text)",
    fontSize: 11,
    fontWeight: 800,
  }),
  multiValueRemove: (base) => ({
    ...base,
    borderRadius: 999,
    color: "var(--panel-agent-picker-muted)",
    ":hover": {
      color: "var(--panel-agent-picker-text-strong)",
      backgroundColor: "rgba(248, 113, 113, 0.22)",
    },
  }),
  placeholder: (base) => ({
    ...base,
    color: "var(--panel-agent-picker-placeholder)",
    fontSize: 12,
    fontWeight: 760,
  }),
  input: (base) => ({
    ...base,
    color: "var(--panel-agent-picker-text)",
    fontSize: 12,
    margin: 0,
    padding: 0,
  }),
  indicatorsContainer: (base) => ({
    ...base,
    alignSelf: "stretch",
  }),
  indicatorSeparator: () => ({ display: "none" }),
  clearIndicator: (base) => ({
    ...base,
    padding: "0 3px",
    color: "var(--panel-agent-picker-muted)",
    ":hover": { color: "var(--panel-agent-picker-text-strong)" },
  }),
  dropdownIndicator: (base, state) => ({
    ...base,
    padding: "0 8px 0 2px",
    color: state.isFocused ? "var(--panel-agent-picker-text-strong)" : "var(--panel-agent-picker-muted)",
    transition: "color 120ms ease, transform 160ms ease",
    transform: state.selectProps.menuIsOpen ? "rotate(180deg)" : "none",
    ":hover": { color: "var(--panel-agent-picker-text-strong)" },
  }),
  menu: (base) => ({
    ...base,
    zIndex: 80,
    marginBottom: 8,
    overflow: "hidden",
    border: "1px solid var(--panel-agent-picker-menu-border)",
    borderRadius: 8,
    backgroundColor: "var(--panel-agent-picker-menu-bg)",
    boxShadow: "0 -10px 36px rgba(0, 0, 0, 0.36), 0 18px 48px rgba(0, 0, 0, 0.28)",
  }),
  menuList: (base) => ({
    ...base,
    maxHeight: 220,
    padding: 5,
  }),
  option: (base, state) => {
    const accent = state.data?.color || "";
    return {
      ...base,
      display: "flex",
      alignItems: "center",
      minHeight: 34,
      borderRadius: 7,
      padding: "7px 9px",
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
    fontSize: 12,
    fontWeight: 720,
  }),
};

export default function PanelAgentPromptComposer({
  autoFocus = false,
  defaultSelectedTargetIds = [],
  onClose = null,
  onSubmit = null,
  panelKind = "panel",
  panelPaneId = "",
  targets = [],
  windowId = "",
}) {
  const [selectedTargetIds, setSelectedTargetIds] = useState(() => (
    normalizeSelectedTargetIds(targets, defaultSelectedTargetIds)
  ));
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);
  const targetSignature = useMemo(
    () => (Array.isArray(targets) ? targets : []).map((target) => target.id).join("|"),
    [targets],
  );
  const targetOptions = useMemo(() => (
    (Array.isArray(targets) ? targets : []).map((target) => ({
      ...target,
      color: target.color || "#8bb8ff",
      label: target.label || `Agent ${target.terminalIndex + 1}`,
      value: target.id,
    }))
  ), [targets]);
  const selectedOptions = useMemo(() => {
    const selectedIdSet = new Set(selectedTargetIds);
    return targetOptions.filter((target) => selectedIdSet.has(target.id));
  }, [selectedTargetIds, targetOptions]);

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
        panelKind,
        panelPaneId,
        targetIds,
        targetTerminalIndexes: targetIds
          .map((targetId) => targets.find((target) => target.id === targetId)?.terminalIndex)
          .filter((terminalIndex) => Number.isInteger(terminalIndex)),
        text,
        windowId,
      });
      setPrompt("");
      onClose?.();
    } catch (err) {
      setError(err?.message || String(err || "Unable to send prompt."));
    } finally {
      setSubmitting(false);
    }
  }, [onClose, onSubmit, panelKind, panelPaneId, prompt, selectedTargetIds, submitting, targets, windowId]);

  const targetCount = Array.isArray(targets) ? targets.length : 0;
  const selectedCount = selectedTargetIds.length;

  return (
    <ComposerShell
      aria-label="Send prompt to terminal agents"
      data-terminal-control="true"
      onSubmit={submitPrompt}
    >
      <TargetPickerFrame>
        {targetCount ? (
          <Select
            aria-label="Terminal agents"
            closeMenuOnSelect={false}
            formatOptionLabel={targetOptionLabelRenderer}
            hideSelectedOptions={false}
            isClearable
            isDisabled={submitting}
            isMulti
            isSearchable={false}
            menuPlacement="top"
            noOptionsMessage={() => "No coding agents open"}
            onChange={updateSelectedTargets}
            options={targetOptions}
            placeholder="Choose agents"
            styles={TARGET_SELECT_STYLES}
            value={selectedOptions}
          />
        ) : (
          <EmptyTargets>No coding agents open</EmptyTargets>
        )}
      </TargetPickerFrame>
      <PromptRow>
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
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              submitPrompt(event);
            }
            if (event.key === "Escape") {
              onClose?.();
            }
          }}
          placeholder={targetCount ? "Prompt selected agents" : "Open a coding-agent terminal first"}
          ref={inputRef}
          rows={2}
          value={prompt}
        />
        <SendButton
          aria-label="Send prompt"
          disabled={submitting || !targetCount || !selectedCount || !prompt.trim()}
          title="Send prompt"
          type="submit"
        >
          <Send aria-hidden="true" />
        </SendButton>
      </PromptRow>
      {error ? <ComposerError role="alert">{error}</ComposerError> : null}
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
  left: 10px;
  right: 10px;
  bottom: 10px;
  z-index: 42;
  display: grid;
  min-width: 0;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 8px;
  background: rgba(6, 10, 18, 0.94);
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.34),
    inset 0 1px 0 rgba(255, 255, 255, 0.04);
  backdrop-filter: blur(14px);

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
    background: rgba(255, 255, 255, 0.94);
    box-shadow:
      0 18px 44px rgba(24, 34, 48, 0.16),
      inset 0 1px 0 rgba(255, 255, 255, 0.7);
  }
`;

const TargetPickerFrame = styled.div`
  display: block;
  min-width: 0;
`;

const TargetOptionLabel = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  color: currentColor;

  &[data-context="value"] {
    gap: 5px;
  }
`;

const HarnessIcon = styled.span`
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  color: currentColor;

  svg {
    width: 15px;
    height: 15px;
  }

  &[data-role="opencode"] svg {
    width: 12px;
    height: 15px;
  }
`;

const TargetDot = styled.span`
  width: 8px;
  height: 8px;
  flex: 0 0 auto;
  border: 1px solid rgba(255, 255, 255, 0.44);
  border-radius: 999px;
  background: var(--panel-agent-color);
  box-shadow: 0 0 10px color-mix(in srgb, var(--panel-agent-color) 72%, transparent);
`;

const TargetName = styled.span`
  min-width: 0;
  overflow: hidden;
  font-size: 11px;
  font-weight: 820;
  letter-spacing: 0;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const EmptyTargets = styled.span`
  min-height: 28px;
  display: inline-flex;
  align-items: center;
  color: rgba(148, 163, 184, 0.86);
  font-size: 11px;
  font-weight: 780;
`;

const PromptRow = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 34px;
  gap: 8px;
  align-items: end;
`;

const PromptInput = styled.textarea`
  width: 100%;
  min-width: 0;
  max-height: 120px;
  min-height: 42px;
  resize: vertical;
  padding: 8px 10px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 7px;
  outline: 0;
  color: rgba(241, 245, 249, 0.94);
  background: rgba(2, 6, 12, 0.86);
  font-size: 12px;
  font-weight: 650;
  line-height: 1.35;

  &:focus {
    border-color: rgba(96, 165, 250, 0.58);
    box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.13);
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
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(96, 165, 250, 0.38);
  border-radius: 8px;
  color: rgba(219, 234, 254, 0.96);
  background: rgba(37, 99, 235, 0.28);
  cursor: pointer;

  svg {
    width: 17px;
    height: 17px;
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
  min-width: 0;
  color: #fca5a5;
  font-size: 11px;
  font-weight: 760;
  line-height: 1.3;
`;

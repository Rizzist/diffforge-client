import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  const toggleTarget = useCallback((targetId) => {
    const safeTargetId = String(targetId || "").trim();
    if (!safeTargetId) {
      return;
    }
    setError("");
    setSelectedTargetIds((current) => (
      current.includes(safeTargetId)
        ? current.filter((id) => id !== safeTargetId)
        : [...current, safeTargetId]
    ));
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
      <TargetRail aria-label="Terminal agents">
        {targetCount ? targets.map((target) => {
          const selected = selectedTargetIds.includes(target.id);
          return (
            <TargetChip
              aria-pressed={selected}
              data-selected={selected ? "true" : undefined}
              key={target.id}
              onClick={() => toggleTarget(target.id)}
              style={{ "--panel-agent-color": target.color || "#8bb8ff" }}
              title={target.title || target.label}
              type="button"
            >
              <HarnessIcon data-role={target.role}>
                <AgentHarnessIcon role={target.role} />
              </HarnessIcon>
              <TargetDot aria-hidden="true" />
              <TargetName>{target.label}</TargetName>
            </TargetChip>
          );
        }) : (
          <EmptyTargets>No coding agents open</EmptyTargets>
        )}
      </TargetRail>
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
    border-color: rgba(24, 34, 48, 0.16);
    background: rgba(255, 255, 255, 0.94);
    box-shadow:
      0 18px 44px rgba(24, 34, 48, 0.16),
      inset 0 1px 0 rgba(255, 255, 255, 0.7);
  }
`;

const TargetRail = styled.div`
  display: flex;
  min-width: 0;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
`;

const TargetChip = styled.button`
  appearance: none;
  display: inline-flex;
  height: 28px;
  min-width: 0;
  max-width: 180px;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  padding: 0 9px 0 7px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.86);
  background: rgba(15, 23, 42, 0.78);
  cursor: pointer;

  &:hover {
    border-color: color-mix(in srgb, var(--panel-agent-color) 58%, rgba(148, 163, 184, 0.22));
  }

  &[data-selected="true"] {
    border-color: color-mix(in srgb, var(--panel-agent-color) 72%, white);
    color: #ffffff;
    background: color-mix(in srgb, var(--panel-agent-color) 22%, rgba(15, 23, 42, 0.9));
  }

  html[data-forge-theme="light"] & {
    color: rgba(48, 54, 68, 0.86);
    background: rgba(248, 250, 252, 0.88);
  }

  html[data-forge-theme="light"] &[data-selected="true"] {
    color: rgba(18, 24, 36, 0.94);
    background: color-mix(in srgb, var(--panel-agent-color) 16%, white);
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

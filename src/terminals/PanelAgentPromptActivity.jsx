import { useEffect, useMemo } from "react";
import styled, { keyframes } from "styled-components";

import { normalizePanelAgentPromptActivityItems } from "./panelAgentPromptBridge.js";

const COMPLETED_DISMISS_MS = 5000;

const STATUS_LABELS = {
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
  queued: "Queued",
  running: "Running",
};

function compactActivityText(value, limit = 15) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}...`;
}

export default function PanelAgentPromptActivity({
  autoDismissCompleted = false,
  items = [],
  onDismissCompletedItem = null,
}) {
  const normalizedItems = normalizePanelAgentPromptActivityItems(items);
  const visibleItems = normalizedItems.slice(-4).reverse();
  const completedVisibleItemKey = useMemo(() => (
    visibleItems
      .filter((item) => item.status === "completed")
      .map((item) => String(item.itemId || item.id || "").trim())
      .filter(Boolean)
      .join("\n")
  ), [visibleItems]);

  useEffect(() => {
    if (!autoDismissCompleted || typeof onDismissCompletedItem !== "function") {
      return undefined;
    }
    const completedIds = completedVisibleItemKey.split("\n").filter(Boolean);
    if (!completedIds.length) {
      return undefined;
    }
    const timeoutIds = completedIds.map((itemId) => window.setTimeout(() => {
      onDismissCompletedItem(itemId);
    }, COMPLETED_DISMISS_MS));
    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [autoDismissCompleted, completedVisibleItemKey, onDismissCompletedItem]);

  if (!normalizedItems.length) {
    return null;
  }

  return (
    <ActivityStack
      aria-label="Agent prompt activity"
      data-dismissible={typeof onDismissCompletedItem === "function" ? "true" : undefined}
      data-terminal-control="true"
    >
      {visibleItems.map((item) => {
        const status = item.status || "queued";
        const label = compactActivityText(item.text || item.title || item.label || "Prompt");
        const target = item.short || item.label || "Agent";
        const statusLabel = STATUS_LABELS[status] || STATUS_LABELS.queued;
        const title = [
          item.text || item.title || "Panel prompt",
          target ? `Target: ${target}` : "",
          statusLabel,
        ].filter(Boolean).join(" - ");
        return (
          <ActivityRow
            data-status={status}
            key={item.itemId}
            style={{ "--panel-agent-activity-color": item.color || "#8bb8ff" }}
            title={title}
          >
            <ActivityDot aria-hidden="true" data-status={status} />
            <ActivityLabel>{label}</ActivityLabel>
            <ActivityStatus>{STATUS_LABELS[status] || STATUS_LABELS.queued}</ActivityStatus>
            {status === "completed" && typeof onDismissCompletedItem === "function" ? (
              <ActivityDismissButton
                aria-label="Dismiss completed prompt"
                onClick={() => onDismissCompletedItem(item.itemId)}
                title="Dismiss completed prompt"
                type="button"
              >
                ×
              </ActivityDismissButton>
            ) : null}
            {status === "completed" && autoDismissCompleted ? (
              <ActivityCountdown aria-hidden="true" />
            ) : null}
          </ActivityRow>
        );
      })}
    </ActivityStack>
  );
}

const activitySpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const ActivityStack = styled.div`
  display: grid;
  min-width: 142px;
  max-width: min(260px, 42vw);
  max-height: 78px;
  gap: 3px;
  overflow: hidden;
  pointer-events: none;

  &[data-dismissible="true"] {
    pointer-events: auto;
  }
`;

const ActivityRow = styled.div`
  position: relative;
  display: grid;
  min-width: 0;
  height: 20px;
  grid-template-columns: 14px minmax(42px, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 5px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.88);
  background: rgba(2, 6, 12, 0.72);
  backdrop-filter: blur(10px);

  &[data-status="completed"] {
    grid-template-columns: 14px minmax(42px, 1fr) auto 16px;
    border-color: rgba(74, 222, 128, 0.28);
    color: rgba(220, 252, 231, 0.96);
    background: rgba(20, 83, 45, 0.3);
  }

  &[data-status="failed"] {
    border-color: rgba(248, 113, 113, 0.36);
    color: rgba(254, 226, 226, 0.98);
    background: rgba(127, 29, 29, 0.36);
  }

  &[data-status="interrupted"] {
    border-color: rgba(251, 191, 36, 0.34);
    color: rgba(254, 243, 199, 0.96);
    background: rgba(120, 53, 15, 0.32);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(24, 34, 48, 0.14);
    color: rgba(30, 41, 59, 0.86);
    background: rgba(255, 255, 255, 0.78);
  }

  html[data-forge-theme="light"] &[data-status="completed"] {
    border-color: rgba(10, 127, 69, 0.22);
    color: rgba(15, 91, 55, 0.94);
    background: rgba(220, 252, 231, 0.78);
  }

  html[data-forge-theme="light"] &[data-status="failed"] {
    border-color: rgba(185, 28, 28, 0.24);
    color: rgba(127, 29, 29, 0.94);
    background: rgba(254, 226, 226, 0.82);
  }

  html[data-forge-theme="light"] &[data-status="interrupted"] {
    border-color: rgba(180, 83, 9, 0.24);
    color: rgba(120, 53, 15, 0.94);
    background: rgba(254, 243, 199, 0.82);
  }
`;

const ActivityDot = styled.span`
  position: relative;
  width: 11px;
  height: 11px;
  border: 2px solid color-mix(in srgb, var(--panel-agent-activity-color) 24%, rgba(148, 163, 184, 0.42));
  border-top-color: var(--panel-agent-activity-color);
  border-radius: 999px;
  background: transparent;
  animation: ${activitySpin} 1350ms linear infinite;

  &[data-status="running"] {
    border-color: color-mix(in srgb, var(--panel-agent-activity-color) 30%, rgba(148, 163, 184, 0.34));
    border-top-color: var(--panel-agent-activity-color);
    animation-duration: 760ms;
  }

  &[data-status="completed"] {
    display: grid;
    place-items: center;
    border-color: rgba(134, 239, 172, 0.92);
    background: #22c55e;
    animation: none;
  }

  &[data-status="completed"]::after {
    content: "";
    display: block;
    width: 3px;
    height: 6px;
    border: solid rgba(4, 20, 10, 0.92);
    border-width: 0 1.5px 1.5px 0;
    transform: translateY(-0.5px) rotate(45deg);
  }

  &[data-status="failed"] {
    border-color: rgba(252, 165, 165, 0.92);
    border-top-color: rgba(252, 165, 165, 0.92);
    background: rgba(239, 68, 68, 0.86);
    animation: none;
  }

  &[data-status="failed"]::before,
  &[data-status="failed"]::after {
    content: "";
    position: absolute;
    left: 3px;
    top: 4px;
    width: 5px;
    height: 1.5px;
    border-radius: 999px;
    background: rgba(69, 10, 10, 0.94);
  }

  &[data-status="failed"]::before {
    transform: rotate(45deg);
  }

  &[data-status="failed"]::after {
    transform: rotate(-45deg);
  }

  &[data-status="interrupted"] {
    border-color: rgba(253, 230, 138, 0.9);
    border-top-color: rgba(253, 230, 138, 0.9);
    background: rgba(245, 158, 11, 0.78);
    animation: none;
  }
`;

const ActivityLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  font-size: 10.5px;
  font-weight: 850;
  letter-spacing: 0;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ActivityStatus = styled.span`
  color: rgba(148, 163, 184, 0.92);
  font-size: 9.5px;
  font-weight: 820;
  letter-spacing: 0;
  line-height: 1;
  text-transform: lowercase;

  [data-status="completed"] & {
    color: rgba(187, 247, 208, 0.92);
  }

  [data-status="failed"] & {
    color: rgba(254, 202, 202, 0.92);
  }

  [data-status="interrupted"] & {
    color: rgba(253, 230, 138, 0.92);
  }

  html[data-forge-theme="light"] & {
    color: rgba(71, 85, 105, 0.76);
  }

  html[data-forge-theme="light"] [data-status="completed"] & {
    color: rgba(15, 91, 55, 0.78);
  }

  html[data-forge-theme="light"] [data-status="failed"] & {
    color: rgba(127, 29, 29, 0.78);
  }

  html[data-forge-theme="light"] [data-status="interrupted"] & {
    color: rgba(120, 53, 15, 0.78);
  }
`;

const ActivityDismissButton = styled.button`
  appearance: none;
  display: inline-flex;
  width: 16px;
  height: 16px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  color: currentColor;
  background: transparent;
  cursor: pointer;
  font-size: 15px;
  font-weight: 760;
  line-height: 1;
  opacity: 0.72;

  &:hover {
    background: rgba(255, 255, 255, 0.12);
    opacity: 1;
  }
`;

const countdownShrink = keyframes`
  from {
    transform: scaleX(1);
  }

  to {
    transform: scaleX(0);
  }
`;

const ActivityCountdown = styled.span`
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 2px;
  height: 2px;
  border-radius: 999px;
  background: rgba(187, 247, 208, 0.72);
  transform-origin: right center;
  animation: ${countdownShrink} ${COMPLETED_DISMISS_MS}ms linear forwards;
  pointer-events: none;
`;

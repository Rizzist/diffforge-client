import styled, { keyframes } from "styled-components";

import { normalizePanelAgentPromptActivityItems } from "./panelAgentPromptBridge.js";

const STATUS_LABELS = {
  completed: "Completed",
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

export default function PanelAgentPromptActivity({ items = [] }) {
  const normalizedItems = normalizePanelAgentPromptActivityItems(items);
  if (!normalizedItems.length) {
    return null;
  }
  const visibleItems = normalizedItems.slice(-4).reverse();

  return (
    <ActivityStack aria-label="Agent prompt activity" data-terminal-control="true">
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
`;

const ActivityRow = styled.div`
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
    border-color: rgba(74, 222, 128, 0.28);
    color: rgba(220, 252, 231, 0.96);
    background: rgba(20, 83, 45, 0.3);
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
    border-color: rgba(134, 239, 172, 0.92);
    background: #22c55e;
    animation: none;
  }

  &[data-status="completed"]::after {
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

  html[data-forge-theme="light"] & {
    color: rgba(71, 85, 105, 0.76);
  }

  html[data-forge-theme="light"] [data-status="completed"] & {
    color: rgba(15, 91, 55, 0.78);
  }
`;

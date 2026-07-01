import styled, { keyframes } from "styled-components";

import { normalizePanelAgentPromptActivityItems } from "./panelAgentPromptBridge.js";

const STATUS_LABELS = {
  completed: "Completed",
  queued: "Queued",
  running: "Running",
};

export default function PanelAgentPromptActivity({ items = [] }) {
  const normalizedItems = normalizePanelAgentPromptActivityItems(items);
  if (!normalizedItems.length) {
    return null;
  }

  return (
    <ActivityStack aria-label="Agent prompt activity" data-terminal-control="true">
      {normalizedItems.slice(0, 4).map((item) => {
        const status = item.status || "queued";
        const label = item.label || "Agent";
        const title = item.title || `${label}: ${STATUS_LABELS[status] || STATUS_LABELS.queued}`;
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

const runningPulse = keyframes`
  0%,
  100% {
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--panel-agent-activity-color) 46%, transparent);
  }

  50% {
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--panel-agent-activity-color) 0%, transparent);
  }
`;

const ActivityStack = styled.div`
  display: grid;
  min-width: 116px;
  max-width: min(220px, 36vw);
  max-height: 78px;
  gap: 3px;
  overflow: hidden;
  pointer-events: none;
`;

const ActivityRow = styled.div`
  display: grid;
  min-width: 0;
  height: 18px;
  grid-template-columns: 12px minmax(28px, 1fr) auto;
  align-items: center;
  gap: 5px;
  padding: 0 7px 0 5px;
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
  width: 8px;
  height: 8px;
  border: 1px solid color-mix(in srgb, var(--panel-agent-activity-color) 72%, white);
  border-radius: 999px;
  background: transparent;

  &[data-status="running"] {
    background: var(--panel-agent-activity-color);
    animation: ${runningPulse} 1200ms ease-in-out infinite;
  }

  &[data-status="completed"] {
    border-color: rgba(134, 239, 172, 0.92);
    background: #22c55e;
    animation: none;
  }
`;

const ActivityLabel = styled.span`
  min-width: 0;
  overflow: hidden;
  font-size: 10px;
  font-weight: 820;
  letter-spacing: 0;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const ActivityStatus = styled.span`
  color: rgba(148, 163, 184, 0.92);
  font-size: 9px;
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

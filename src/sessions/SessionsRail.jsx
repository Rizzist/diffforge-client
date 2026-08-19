import { useEffect, useState } from "react";
import styled from "styled-components";

import {
  RailActionButton,
  RailViewActions,
  SettingsNavGroupLabel,
  ButtonAddIcon,
} from "../app/appStyles.js";
import {
  formatSessionRelativeTime,
  groupSessionsByDay,
} from "./sessionsModel.js";

/* Codex-style session rail: New chat on top, then day-grouped session rows.
   Rendered inside the workspace rail's list area; visual language reuses the
   existing rail components (RailActionButton rows inside RailViewActions
   boxes, 9px uppercase day labels). */

export default function SessionsRail({
  sessions,
  activeSessionId,
  onNewChat,
  onSelectSession,
}) {
  /* Relative times tick once a minute while the rail is mounted. */
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const groups = groupSessionsByDay(sessions, nowMs);

  return (
    <SessionsRailRoot onClick={(event) => event.stopPropagation()}>
      <RailViewActions aria-label="New session">
        <RailActionButton
          aria-label="New chat"
          data-scope="global"
          onClick={onNewChat}
          title="New chat (⌘N)"
          type="button"
        >
          <ButtonAddIcon aria-hidden="true" />
          <span>New chat</span>
        </RailActionButton>
      </RailViewActions>

      {groups.map((group) => (
        <SessionDayGroup key={group.key}>
          <SettingsNavGroupLabel>{group.label}</SettingsNavGroupLabel>
          <RailViewActions aria-label={`Sessions from ${group.label}`}>
            {group.sessions.map((session) => (
              <SessionRowButton
                data-active={session.id === activeSessionId ? "true" : undefined}
                key={session.id}
                onClick={() => onSelectSession(session)}
                title={session.first_user_message || session.title}
                type="button"
              >
                <SessionStatusDot
                  aria-hidden="true"
                  data-status={session.status}
                />
                <SessionRowTitle>{session.title}</SessionRowTitle>
                <SessionRowMeta>
                  {formatSessionRelativeTime(session.latest_at_ms, nowMs)}
                </SessionRowMeta>
              </SessionRowButton>
            ))}
          </RailViewActions>
        </SessionDayGroup>
      ))}

      {!groups.length && (
        <SessionsEmptyHint>
          No sessions yet. Start with New chat.
        </SessionsEmptyHint>
      )}
    </SessionsRailRoot>
  );
}

const SessionsRailRoot = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 7px;
  overflow-y: auto;
  padding: 2px 8px 10px;
`;

const SessionDayGroup = styled.div`
  display: grid;
  gap: 2px;
`;

/* Dedicated row: RailActionButton's internal span sizing wraps a
   three-part row (dot · title · meta) onto two lines; this keeps the
   same 26px/11px metrics and active pill on a plain flex row. */
const SessionRowButton = styled.button`
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 26px;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 11px;
  font-weight: 550;
  cursor: pointer;
  text-align: left;

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }

  &[data-active="true"] {
    color: var(--forge-text);
    border-color: rgba(var(--forge-tint-soft-rgb), 0.52);
    background: var(--forge-surface-selected);
  }
`;

const SessionStatusDot = styled.span`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--forge-text-disabled);

  &[data-status="running"] {
    background: var(--forge-green);
  }

  &[data-status="error"] {
    background: var(--forge-red);
  }
`;

const SessionRowTitle = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const SessionRowMeta = styled.em`
  margin-left: auto;
  color: var(--forge-text-muted);
  font-size: 9.5px;
  font-style: normal;
`;

const SessionsEmptyHint = styled.div`
  padding: 10px 8px;
  color: var(--forge-text-muted);
  font-size: 11px;
`;

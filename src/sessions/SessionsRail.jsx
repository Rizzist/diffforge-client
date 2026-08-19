import { useEffect, useState } from "react";
import styled from "styled-components";

import {
  SettingsNavGroupLabel,
  ButtonEditIcon,
} from "../app/appStyles.js";
import {
  formatSessionRelativeTime,
  groupSessionsByDay,
} from "./sessionsModel.js";

/* Codex-style session rail: a compact compose "New chat" on top, then
   day-grouped session rows. Collapsed rail shows ONLY the compose button —
   no rows, no labels — for a clean icon strip; the expanded list is
   unchanged. New chat opens a zero-cost draft (no session is created until
   the first prompt is submitted). */

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
      <NewChatButton
        aria-label="New chat"
        onClick={onNewChat}
        title="New chat (⌘N)"
        type="button"
      >
        <ButtonEditIcon aria-hidden="true" />
        <span>New chat</span>
      </NewChatButton>

      <SessionListArea>
        {groups.map((group) => (
          <SessionDayGroup key={group.key}>
            <SettingsNavGroupLabel>{group.label}</SettingsNavGroupLabel>
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
          </SessionDayGroup>
        ))}

        {!groups.length && (
          <SessionsEmptyHint>
            No sessions yet. Start with New chat.
          </SessionsEmptyHint>
        )}
      </SessionListArea>
    </SessionsRailRoot>
  );
}

const SessionsRailRoot = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  padding: 2px 8px 10px;

  [data-collapsed="true"] & {
    align-items: center;
    padding: 2px 4px 10px;
    overflow: hidden;
  }
`;

const NewChatButton = styled.button`
  display: inline-flex;
  min-height: 26px;
  align-items: center;
  gap: 7px;
  align-self: stretch;
  padding: 0 8px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: var(--forge-surface);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  text-align: left;

  svg {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
    opacity: 0.85;
  }

  &:hover {
    color: var(--forge-text);
    border-color: var(--forge-border-strong);
    background: var(--forge-surface-hover);
  }

  /* Collapsed rail: icon-only square. */
  [data-collapsed="true"] & {
    width: 30px;
    min-height: 30px;
    align-self: center;
    justify-content: center;
    gap: 0;
    padding: 0;
  }

  [data-collapsed="true"] & span {
    display: none;
  }
`;

/* The whole list disappears when the rail is collapsed — clean icon strip. */
const SessionListArea = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 7px;

  [data-collapsed="true"] & {
    display: none;
  }
`;

const SessionDayGroup = styled.div`
  display: grid;
  gap: 2px;
`;

/* Dedicated row: shared rail buttons wrap a three-part row (dot · title ·
   meta); this keeps 26px/11px metrics and the active pill on a flex row. */
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

  &[data-status="waiting"] {
    background: var(--forge-amber);
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

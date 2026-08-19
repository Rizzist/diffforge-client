import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { PushPin } from "@styled-icons/material-rounded/PushPin";
import { Edit } from "@styled-icons/material-rounded/Edit";

import {
  SettingsNavGroupLabel,
  ButtonEditIcon,
} from "../app/appStyles.js";
import { formatSessionRelativeTime } from "./sessionsModel.js";
import { ModelBrandIcon } from "./modelBrand.jsx";

/* Codex-style session rail: a compact compose "New chat" on top, then two
   groups — Pinned (user-pinned rows) and Recent (everything else, newest
   first). Rows lead with the brand mark of the session's current model.
   Right-click opens Pin/Unpin + Rename; renames set a title lock so daemon
   reconciles never clobber them. Collapsed rail shows ONLY the compose
   button. New chat opens a zero-cost draft (no session is created until the
   harness acts). */

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

  const [menu, setMenu] = useState(null); // { session, x, y }
  const [renamingId, setRenamingId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const close = (event) => {
      if (menuRef.current && menuRef.current.contains(event.target)) {
        return;
      }
      setMenu(null);
    };
    const onKey = (event) => {
      if (event.key === "Escape") {
        setMenu(null);
      }
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = useCallback((event, session) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({
      session,
      x: Math.min(event.clientX, window.innerWidth - 170),
      y: Math.min(event.clientY, window.innerHeight - 96),
    });
  }, []);

  const togglePin = useCallback(async (session) => {
    setMenu(null);
    try {
      await invoke("session_set_pinned", {
        session_id: session.id,
        pinned: !session.pinned,
      });
    } catch {
      // Store predates pinning — the rail simply keeps the flat list.
    }
  }, []);

  const beginRename = useCallback((session) => {
    setMenu(null);
    setRenamingId(session.id);
    setRenameDraft(session.title);
  }, []);

  const commitRename = useCallback(async () => {
    const id = renamingId;
    const title = renameDraft.trim();
    setRenamingId("");
    if (!id || !title) {
      return;
    }
    try {
      await invoke("session_rename", { session_id: id, title });
    } catch {
      // Store predates renaming — leave the daemon title in place.
    }
  }, [renameDraft, renamingId]);

  const sorted = [...sessions].sort(
    (a, b) => (b.latest_at_ms || 0) - (a.latest_at_ms || 0),
  );
  const pinned = sorted.filter((session) => session.pinned);
  const recent = sorted.filter((session) => !session.pinned);

  const renderRow = (session) => {
    if (session.id === renamingId) {
      return (
        <SessionRenameRow key={session.id}>
          <ModelBrandIcon
            model={session.model}
            provider={session.provider}
            status={session.status}
          />
          <SessionRenameInput
            autoFocus
            onBlur={() => void commitRename()}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commitRename();
              } else if (event.key === "Escape") {
                event.preventDefault();
                setRenamingId("");
              }
            }}
            value={renameDraft}
          />
        </SessionRenameRow>
      );
    }
    return (
      <SessionRowButton
        data-active={session.id === activeSessionId ? "true" : undefined}
        key={session.id}
        onClick={() => onSelectSession(session)}
        onContextMenu={(event) => openMenu(event, session)}
        title={session.first_user_message || session.title}
        type="button"
      >
        <ModelBrandIcon
          model={session.model}
          provider={session.provider}
          status={session.status}
        />
        <SessionRowTitle>{session.title}</SessionRowTitle>
        <SessionRowMeta>
          {formatSessionRelativeTime(session.latest_at_ms, nowMs)}
        </SessionRowMeta>
      </SessionRowButton>
    );
  };

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
        {pinned.length > 0 && (
          <SessionGroup>
            <SettingsNavGroupLabel>Pinned</SettingsNavGroupLabel>
            {pinned.map(renderRow)}
          </SessionGroup>
        )}
        {recent.length > 0 && (
          <SessionGroup>
            <SettingsNavGroupLabel>Recent</SettingsNavGroupLabel>
            {recent.map(renderRow)}
          </SessionGroup>
        )}

        {!sorted.length && (
          <SessionsEmptyHint>
            No sessions yet. Start with New chat.
          </SessionsEmptyHint>
        )}
      </SessionListArea>

      {menu && createPortal(
        <SessionContextMenu
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
        >
          <SessionContextItem
            onClick={() => void togglePin(menu.session)}
            type="button"
          >
            <PushPin aria-hidden="true" />
            <span>{menu.session.pinned ? "Unpin" : "Pin"}</span>
          </SessionContextItem>
          <SessionContextItem
            onClick={() => beginRename(menu.session)}
            type="button"
          >
            <Edit aria-hidden="true" />
            <span>Rename</span>
          </SessionContextItem>
        </SessionContextMenu>,
        document.body,
      )}
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

const SessionGroup = styled.div`
  display: grid;
  gap: 2px;
`;

/* Dedicated row: shared rail buttons wrap a three-part row (mark · title ·
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

const SessionRenameRow = styled.div`
  display: flex;
  min-height: 26px;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 6px;
`;

const SessionRenameInput = styled.input`
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.52);
  border-radius: 6px;
  color: var(--forge-text);
  background: var(--forge-surface);
  font-size: 11px;
  font-weight: 550;
  outline: none;
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

const SessionContextMenu = styled.div`
  position: fixed;
  z-index: 950;
  display: grid;
  min-width: 148px;
  gap: 1px;
  padding: 4px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 9px;
  background: var(--forge-surface-raised, var(--forge-surface));
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
`;

const SessionContextItem = styled.button`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 11.5px;
  font-weight: 550;
  cursor: pointer;
  text-align: left;

  svg {
    width: 13px;
    height: 13px;
    opacity: 0.8;
  }

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }
`;

const SessionsEmptyHint = styled.div`
  padding: 10px 8px;
  color: var(--forge-text-muted);
  font-size: 11px;
`;

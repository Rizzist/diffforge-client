import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { PushPin } from "@styled-icons/material-rounded/PushPin";
import { Terminal } from "@styled-icons/material-rounded/Terminal";
import { Edit } from "@styled-icons/material-rounded/Edit";
import { Movie } from "@styled-icons/material-rounded/Movie";
import { Close } from "@styled-icons/material-rounded/Close";

import {
  SettingsNavGroupLabel,
  ButtonEditIcon,
  RailComposeRow,
  RailSearchRow,
  RailSearchIcon,
  RailSearchField,
} from "../app/appStyles.js";
import {
  formatSessionRelativeTime,
  partitionSessionsForRail,
} from "./sessionsModel.js";
import { ModelBrandIcon } from "./modelBrand.jsx";

/* Session Deck rail list: a prominent "New chat" compose row on top, then
   activity-ranked Pinned/Recent groups and quiet trailing groups for local or
   activity-less rows. Rows lead with the brand mark of the current model.
   Right-click opens Pin/Unpin + Rename; renames set a title lock so daemon
   reconciles never clobber them. The collapsed rail keeps the rows as a
   brand-dot icon strip (compose stays as an icon square). New chat opens a
   zero-cost draft (no session is created until the harness acts). */

export default function SessionsRail({
  sessions,
  activeSessionId,
  activeMediaId = "",
  mediaSessions = [],
  onDeleteMedia = null,
  onNewChat,
  onNewMedia = null,
  onSearchChange = null,
  onSelectMedia = null,
  onSelectSession,
  onToggleShell = null,
  onUpdateMedia = null,
  searchQuery = "",
  shellPrefs = {},
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
    if (session.kind === "media") {
      onUpdateMedia?.(session.id, { pinned: !session.pinned });
      return;
    }
    try {
      await invoke("session_set_pinned", {
        session_id: session.id,
        pinned: !session.pinned,
      });
    } catch {
      // Store predates pinning — the rail simply keeps the flat list.
    }
  }, [onUpdateMedia]);

  const deleteMedia = useCallback((session) => {
    setMenu(null);
    onDeleteMedia?.(session.id);
  }, [onDeleteMedia]);

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
    if (mediaSessions.some((row) => row.id === id)) {
      onUpdateMedia?.(id, { title });
      return;
    }
    try {
      await invoke("session_rename", { session_id: id, title });
    } catch {
      // Store predates renaming — leave the daemon title in place.
    }
  }, [mediaSessions, onUpdateMedia, renameDraft, renamingId]);

  /* Rail search narrows every coordinate domain by title or opening message. */
  const allSessions = [...sessions, ...mediaSessions];
  const query = searchQuery.trim().toLowerCase();
  const matches = query
    ? allSessions.filter((session) => (
      String(session.title || "").toLowerCase().includes(query)
      || String(session.first_user_message || "").toLowerCase().includes(query)
    ))
    : allSessions;
  const {
    ranked,
    local,
    unordered,
  } = partitionSessionsForRail(matches);
  const pinned = ranked.filter((session) => session.pinned);
  const recent = ranked.filter((session) => !session.pinned);

  /* Parked = the harness says a human is needed: 937's typed card, or 936's
     frozen waiting_why on an older daemon. */
  const parkOf = (session) => Boolean(session.needs_input?.kind)
    || session.status === "waiting";
  const statusSlot = (session) => {
    const status = session.status || "";
    /* 937 needs_input carries the park's own typed kind and can name kinds
       this build predates — prefer it, humanise anything unrecognised, and
       keep 936's waiting_why (frozen at three kinds) as the fallback. */
    if (status === "error") {
      return <StatusErrorRing aria-label="Errored">!</StatusErrorRing>;
    }
    if (status === "running") {
      return <StatusSpinner aria-label="Working" />;
    }
    /* Settled rows: daemon-durable seen state. Activity after the last ack
       shows the dot; the active session never does (viewing IS the ack —
       the daemon receipt clears it moments later). */
    const unseen = session.id !== activeSessionId
      && Number(session.last_activity_ms) > Number(session.seen_at_ms || 0);
    return (
      <SessionRowMeta>
        {unseen && <UnseenDot aria-label="New activity" />}
        {formatSessionRelativeTime(session.latest_at_ms, nowMs)}
      </SessionRowMeta>
    );
  };

  const renderRow = (session) => {
    if (session.kind === "media") {
      if (session.id === renamingId) {
        return (
          <SessionRenameRow key={session.id}>
            <MediaRowGlyph aria-hidden="true">
              <Movie size={13} />
            </MediaRowGlyph>
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
          data-active={session.id === activeMediaId ? "true" : undefined}
          key={session.id}
          onClick={() => onSelectMedia?.(session)}
          onContextMenu={(event) => openMenu(event, session)}
          title={`${session.title} — media session (under development)`}
          type="button"
        >
          <MediaRowGlyph aria-hidden="true">
            <Movie size={13} />
          </MediaRowGlyph>
          <SessionRowTitle>{session.title}</SessionRowTitle>
          <MediaDevTag aria-label="Under development">dev</MediaDevTag>
          {statusSlot(session)}
        </SessionRowButton>
      );
    }
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
          park={parkOf(session)}
          provider={session.provider}
          status={session.status}
        />
        <SessionRowTitle data-shell={shellPrefs[session.id] === true ? "on" : undefined}>
          {session.title}
        </SessionRowTitle>
        {statusSlot(session)}
        {/* Row actions replace the time on hover — same slot, so the row
            never reflows under the pointer. */}
        {/* Spans, not buttons: the row itself is a button and nesting one
            inside another is invalid and swallows clicks. */}
        <RowActions>
          <RowActionButton
            aria-label={session.pinned ? "Unpin" : "Pin"}
            data-on={session.pinned ? "true" : undefined}
            onClick={(event) => {
              event.stopPropagation();
              void togglePin(session);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              event.stopPropagation();
              void togglePin(session);
            }}
            role="button"
            tabIndex={0}
            title={session.pinned ? "Unpin this chat" : "Pin this chat"}
          >
            <PinGlyph aria-hidden="true" />
          </RowActionButton>
          {/* A running session's shell is doing work — turning it off is
              only offered once it settles. */}
          {(() => {
            const shellOn = shellPrefs[session.id] === true;
            const locked = shellOn && session.status === "running";
            const toggle = (event) => {
              event.stopPropagation();
              if (locked) return;
              onToggleShell?.(session.id);
            };
            return (
              <RowActionButton
                aria-disabled={locked ? "true" : undefined}
                aria-label={shellOn ? "Turn shell off" : "Turn shell on"}
                data-locked={locked ? "true" : undefined}
                data-on={shellOn ? "true" : undefined}
                onClick={toggle}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  toggle(event);
                }}
                role="button"
                tabIndex={0}
                title={shellOn
                  ? (locked
                    ? "Shell is busy — turn it off once it settles"
                    : "Turn this shell off")
                  : "Keep this shell running"}
              >
                <TerminalGlyph aria-hidden="true" />
              </RowActionButton>
            );
          })()}
        </RowActions>
      </SessionRowButton>
    );
  };

  return (
    <SessionsRailRoot onClick={(event) => event.stopPropagation()}>
      {/* New chat | New media: half-width pair (collapsed: stacked icons). */}
      <ComposePairRow>
        <RailComposeRow
          aria-label="New chat"
          onClick={onNewChat}
          title="New chat (⌘N)"
          type="button"
        >
          <ButtonEditIcon aria-hidden="true" />
          <span>New chat</span>
        </RailComposeRow>
        <RailComposeRow
          aria-label="New media"
          onClick={onNewMedia || undefined}
          title="New media — transcribe, translate, summarize, convert"
          type="button"
        >
          <Movie aria-hidden="true" size={13} />
          <span>New media</span>
        </RailComposeRow>
      </ComposePairRow>

      {/* Persistent chat search under New chat (folds away when the rail is
          collapsed — RailSearchRow hides itself). */}
      <RailSearchRow>
        <RailSearchBox>
          <RailSearchIcon aria-hidden="true" />
          <RailSearchField
            aria-label="Search chats"
            onChange={(event) => onSearchChange?.(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                onSearchChange?.("");
              }
            }}
            placeholder="Search chats…"
            value={searchQuery}
          />
        </RailSearchBox>
      </RailSearchRow>

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
        {local.length > 0 && (
          <TrailingSessionGroup>
            <SettingsNavGroupLabel>Local</SettingsNavGroupLabel>
            {local.map(renderRow)}
          </TrailingSessionGroup>
        )}
        {unordered.length > 0 && (
          <TrailingSessionGroup>
            <SettingsNavGroupLabel>No activity</SettingsNavGroupLabel>
            {unordered.map(renderRow)}
          </TrailingSessionGroup>
        )}

        {!allSessions.length && (
          <SessionsEmptyHint>
            No sessions yet. Start with New chat.
          </SessionsEmptyHint>
        )}
        {allSessions.length > 0 && !matches.length && (
          <SessionsEmptyHint>
            No sessions match “{searchQuery.trim()}”.
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
          {menu.session.kind === "media" && (
            <SessionContextItem
              data-danger="true"
              onClick={() => deleteMedia(menu.session)}
              type="button"
            >
              <Close aria-hidden="true" />
              <span>Delete</span>
            </SessionContextItem>
          )}
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
    align-items: stretch;
    padding: 2px 6px 10px;
    overflow-y: auto;
    scrollbar-width: none;
  }

  [data-collapsed="true"] &::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
`;

/* Collapsed rail: the list stays as a brand-dot icon strip — group labels
   and row text fold away, the marks keep their activity badges. */

/* Right-slot status indicators — one per row, shape-distinct so color is
   never the only signal: chip (words) / hollow ring / motion / dot / text. */
const UnseenDot = styled.i`
  flex: 0 0 auto;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--forge-accent-soft);
`;

const StatusErrorRing = styled.span`
  display: grid;
  flex: 0 0 auto;
  width: 13px;
  height: 13px;
  place-items: center;
  border: 1.5px solid var(--forge-red);
  border-radius: 50%;
  color: var(--forge-red);
  font-size: 8px;
  font-weight: 800;
  line-height: 1;
`;

const StatusSpinner = styled.span`
  flex: 0 0 auto;
  width: 11px;
  height: 11px;
  border: 1.5px solid rgba(var(--forge-tint-soft-rgb), 0.25);
  border-top-color: var(--forge-amber);
  border-radius: 50%;
  animation: rail-status-spin 1.2s linear infinite;

  @keyframes rail-status-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

/* Media session rows: distinct glyph + an honest "dev" tag. */
const MediaRowGlyph = styled.span`
  display: grid;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 5px;
  color: var(--forge-tint-soft, var(--forge-blue, #62a0ff));
  background: rgba(var(--forge-tint-rgb), 0.14);
`;

const MediaDevTag = styled.span`
  flex: 0 0 auto;
  padding: 0 4px;
  border: 1px solid color-mix(in srgb, var(--forge-amber) 45%, transparent);
  border-radius: 4px;
  color: var(--forge-amber);
  font-size: 7px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;

  [data-collapsed="true"] & {
    display: none;
  }
`;

/* The compose pair: two half-width rows; collapsed rail stacks them as
   icon squares (each row's own collapsed styling applies). */
const ComposePairRow = styled.div`
  display: flex;
  gap: 6px;

  > button {
    flex: 1;
    min-width: 0;
  }

  > button span {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  [data-collapsed="true"] & {
    flex-direction: column;
    gap: 4px;
  }
`;

const SessionListArea = styled.div`
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 7px;

  /* Collapsed rail shows chrome only — the session list folds away. */
  [data-collapsed="true"] & {
    display: none;
  }
`;

/* Search box: magnifier inside the field. */
const RailSearchBox = styled.div`
  position: relative;
  display: flex;
  align-items: center;

  svg {
    position: absolute;
    left: 8px;
    color: var(--forge-text-muted);
    pointer-events: none;
  }

  input {
    padding-left: 26px;
  }
`;

const SessionGroup = styled.div`
  display: grid;
  gap: 2px;

  [data-collapsed="true"] & ${SettingsNavGroupLabel} {
    display: none;
  }
`;

const TrailingSessionGroup = styled(SessionGroup)`
  margin-top: 2px;
  padding-top: 7px;
  border-top: 1px solid rgba(var(--forge-tint-rgb), 0.1);
`;

/* Dedicated row: shared rail buttons wrap a three-part row (mark · title ·
   meta) on the Session Deck's 284px measure — 30px rows, 12px type. */
const SessionRowButton = styled.button`
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 9px 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 12px;
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

  /* Collapsed: a centered brand mark, nothing else. */
  [data-collapsed="true"] & {
    min-height: 30px;
    justify-content: center;
    gap: 0;
    padding: 0;
  }
`;

const PinGlyph = styled(PushPin)`
  width: 12px;
  height: 12px;
`;

const TerminalGlyph = styled(Terminal)`
  width: 12px;
  height: 12px;
`;

/* Hover actions occupy the same right slot as the time, so the row keeps its
   width and nothing shifts under the pointer. They fade and slide rather than
   snapping, so the pointer crossing a long list doesn't strobe. */
const RowActions = styled.span`
  position: absolute;
  top: 50%;
  right: 8px;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transform: translateY(-50%) translateX(4px);
  pointer-events: none;
  transition: opacity 140ms ease, transform 140ms ease;

  ${SessionRowButton}:hover &,
  ${SessionRowButton}:focus-within & {
    opacity: 1;
    transform: translateY(-50%);
    pointer-events: auto;
  }

  [data-collapsed="true"] & { display: none; }
`;

const RowActionButton = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  border-radius: 5px;
  color: var(--forge-text-muted);
  cursor: pointer;

  svg { width: 12px; height: 12px; }

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }

  /* On = the state is real and current, so it reads at full strength. */
  &[data-on="true"] { color: var(--forge-accent-soft); }

  &[data-locked="true"] {
    opacity: 0.4;
    cursor: default;
  }

  &[data-locked="true"]:hover { background: transparent; }
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
  /* A live shell is stated by the title's own weight of presence rather than
     another glyph competing in the row: shells that are running read at full
     strength, everything else sits a step back. */
  opacity: 0.72;
  transition: opacity 160ms ease;

  &[data-shell="on"] {
    opacity: 1;
  }

  [data-collapsed="true"] & {
    display: none;
  }
`;

const SessionRowMeta = styled.em`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-left: auto;
  transition: opacity 140ms ease;

  ${SessionRowButton}:hover &,
  ${SessionRowButton}:focus-within & {
    opacity: 0;
  }
  color: var(--forge-text-muted);
  font-size: 9.5px;
  font-style: normal;

  [data-collapsed="true"] & {
    display: none;
  }
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

  &[data-danger="true"] {
    color: var(--forge-red);
  }

  &[data-danger="true"]:hover {
    color: var(--forge-red);
    background: color-mix(in srgb, var(--forge-red) 12%, transparent);
  }
`;

const SessionsEmptyHint = styled.div`
  padding: 10px 8px;
  color: var(--forge-text-muted);
  font-size: 11px;
`;

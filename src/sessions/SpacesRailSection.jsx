import { useCallback, useState } from "react";
import styled from "styled-components";
import { ArrowBack } from "@styled-icons/material-rounded/ArrowBack";
import { Close } from "@styled-icons/material-rounded/Close";
import { Edit } from "@styled-icons/material-rounded/Edit";
import { Workspaces } from "@styled-icons/material-rounded/Workspaces";

import { SettingsNavGroupLabel, ButtonAddIcon } from "../app/appStyles.js";

/* Rail Spaces section: the space switcher strip. Everything is inline — the
   create field, the rename field, and the delete confirm all replace their
   row in place (no modals). Clicking a space ENTERS it (the rail scopes to
   its members); the "All sessions" row is the way back. The active space row
   highlight is list identity, not session focus — session focus derives from
   the space model's focused leaf and is rendered on the session rows. */

export default function SpacesRailSection({
  activeSpaceId = "",
  listError = "",
  onCreateSpace,
  onDeleteSpace,
  onEnterSpace,
  onExitSpace,
  onRenameSpace,
  spaces = [],
}) {
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState("");
  const [renamingId, setRenamingId] = useState("");
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");

  const commitCreate = useCallback(() => {
    const name = createDraft.trim();
    setCreating(false);
    setCreateDraft("");
    if (name) onCreateSpace?.(name);
  }, [createDraft, onCreateSpace]);

  const commitRename = useCallback(() => {
    const id = renamingId;
    const name = renameDraft.trim();
    setRenamingId("");
    setRenameDraft("");
    if (id && name) onRenameSpace?.(id, name);
  }, [renameDraft, renamingId, onRenameSpace]);

  const nameFieldKeys = (commit, cancel) => (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  };

  return (
    <SpacesSection aria-label="Spaces">
      <SpacesHeader>
        <SettingsNavGroupLabel>Spaces</SettingsNavGroupLabel>
        <SpacesHeaderAction
          aria-label="New space"
          onClick={() => {
            setCreating(true);
            setConfirmDeleteId("");
          }}
          title="New space"
          type="button"
        >
          <ButtonAddIcon aria-hidden="true" />
        </SpacesHeaderAction>
      </SpacesHeader>

      {activeSpaceId && (
        <SpaceRowButton
          aria-label="All sessions"
          data-exit="true"
          onClick={() => onExitSpace?.()}
          title="Leave this space — back to all sessions"
          type="button"
        >
          <SpaceGlyph aria-hidden="true" data-exit="true">
            <ArrowBack size={12} />
          </SpaceGlyph>
          <SpaceRowTitle>All sessions</SpaceRowTitle>
        </SpaceRowButton>
      )}

      {creating && (
        <SpaceEditRow>
          <SpaceGlyph aria-hidden="true">
            <Workspaces size={12} />
          </SpaceGlyph>
          <SpaceEditInput
            aria-label="New space name"
            autoFocus
            onBlur={commitCreate}
            onChange={(event) => setCreateDraft(event.target.value)}
            onKeyDown={nameFieldKeys(commitCreate, () => {
              setCreating(false);
              setCreateDraft("");
            })}
            placeholder="Space name…"
            value={createDraft}
          />
        </SpaceEditRow>
      )}

      {spaces.map((space) => {
        if (space.id === renamingId) {
          return (
            <SpaceEditRow key={space.id}>
              <SpaceGlyph aria-hidden="true">
                <Workspaces size={12} />
              </SpaceGlyph>
              <SpaceEditInput
                aria-label="Space name"
                autoFocus
                onBlur={commitRename}
                onChange={(event) => setRenameDraft(event.target.value)}
                onKeyDown={nameFieldKeys(commitRename, () => {
                  setRenamingId("");
                  setRenameDraft("");
                })}
                value={renameDraft}
              />
            </SpaceEditRow>
          );
        }
        if (space.id === confirmDeleteId) {
          return (
            <SpaceConfirmRow key={space.id}>
              <span>Delete “{space.name}”?</span>
              <SpaceConfirmDelete
                onClick={() => {
                  setConfirmDeleteId("");
                  onDeleteSpace?.(space.id);
                }}
                type="button"
              >
                Delete
              </SpaceConfirmDelete>
              <SpaceConfirmKeep
                onClick={() => setConfirmDeleteId("")}
                type="button"
              >
                Keep
              </SpaceConfirmKeep>
            </SpaceConfirmRow>
          );
        }
        return (
          <SpaceRowButton
            data-active={space.id === activeSpaceId ? "true" : undefined}
            key={space.id}
            onClick={() => onEnterSpace?.(space.id)}
            title={space.name}
            type="button"
          >
            <SpaceGlyph aria-hidden="true">
              <Workspaces size={12} />
            </SpaceGlyph>
            <SpaceRowTitle>{space.name}</SpaceRowTitle>
            <SpaceRowActions>
              <SpaceRowAction
                aria-label="Rename space"
                onClick={(event) => {
                  event.stopPropagation();
                  setRenamingId(space.id);
                  setRenameDraft(space.name);
                  setConfirmDeleteId("");
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  setRenamingId(space.id);
                  setRenameDraft(space.name);
                }}
                role="button"
                tabIndex={0}
                title="Rename this space"
              >
                <Edit aria-hidden="true" />
              </SpaceRowAction>
              <SpaceRowAction
                aria-label="Delete space"
                data-danger="true"
                onClick={(event) => {
                  event.stopPropagation();
                  setConfirmDeleteId(space.id);
                  setRenamingId("");
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  event.stopPropagation();
                  setConfirmDeleteId(space.id);
                }}
                role="button"
                tabIndex={0}
                title="Delete this space (sessions are kept)"
              >
                <Close aria-hidden="true" />
              </SpaceRowAction>
            </SpaceRowActions>
          </SpaceRowButton>
        );
      })}

      {/* An unreadable store is an error line, never an empty list. */}
      {listError && <SpacesErrorHint role="alert">{listError}</SpacesErrorHint>}
    </SpacesSection>
  );
}

const SpacesSection = styled.div`
  display: grid;
  gap: 2px;
`;

const SpacesHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;

  ${SettingsNavGroupLabel} {
    margin: 0;
  }
`;

const SpacesHeaderAction = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  border: 0;
  border-radius: 5px;
  color: var(--forge-text-muted);
  background: transparent;
  cursor: pointer;

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }
`;

const SpaceRowButton = styled.button`
  position: relative;
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 28px;
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

  &[data-exit="true"] {
    color: var(--forge-text-muted);
  }
`;

const SpaceGlyph = styled.span`
  display: grid;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  place-items: center;
  border-radius: 5px;
  color: var(--forge-tint-soft, var(--forge-blue, #62a0ff));
  background: rgba(var(--forge-tint-rgb), 0.14);

  &[data-exit="true"] {
    color: var(--forge-text-muted);
    background: transparent;
  }
`;

const SpaceRowTitle = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const SpaceRowActions = styled.span`
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

  ${SpaceRowButton}:hover &,
  ${SpaceRowButton}:focus-within & {
    opacity: 1;
    transform: translateY(-50%);
    pointer-events: auto;
  }
`;

const SpaceRowAction = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 19px;
  height: 19px;
  border-radius: 5px;
  color: var(--forge-text-muted);
  cursor: pointer;

  svg {
    width: 12px;
    height: 12px;
  }

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }

  &[data-danger="true"]:hover {
    color: var(--forge-red);
    background: color-mix(in srgb, var(--forge-red) 12%, transparent);
  }
`;

const SpaceEditRow = styled.div`
  display: flex;
  min-height: 26px;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 6px;
`;

const SpaceEditInput = styled.input`
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

const SpaceConfirmRow = styled.div`
  display: flex;
  min-height: 28px;
  align-items: center;
  gap: 6px;
  padding: 0 9px 0 8px;
  border-radius: 8px;
  color: var(--forge-text-soft);
  background: color-mix(in srgb, var(--forge-red) 8%, transparent);
  font-size: 11px;
  font-weight: 550;

  > span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
`;

const SpaceConfirmDelete = styled.button`
  flex: 0 0 auto;
  padding: 2px 7px;
  border: 1px solid color-mix(in srgb, var(--forge-red) 45%, transparent);
  border-radius: 5px;
  color: var(--forge-red);
  background: transparent;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    background: color-mix(in srgb, var(--forge-red) 14%, transparent);
  }
`;

const SpaceConfirmKeep = styled.button`
  flex: 0 0 auto;
  padding: 2px 7px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 5px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }
`;

const SpacesErrorHint = styled.div`
  padding: 4px 8px;
  color: var(--forge-red);
  font-size: 10px;
`;

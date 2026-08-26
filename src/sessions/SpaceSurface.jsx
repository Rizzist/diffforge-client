import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import styled from "styled-components";
import { Close } from "@styled-icons/material-rounded/Close";
import { Forum } from "@styled-icons/material-rounded/Forum";
import { OpenInNew } from "@styled-icons/material-rounded/OpenInNew";
import { Terminal } from "@styled-icons/material-rounded/Terminal";
import { Timeline } from "@styled-icons/material-rounded/Timeline";
import { Workspaces } from "@styled-icons/material-rounded/Workspaces";

import SessionComposer from "./SessionComposer.jsx";
import SessionTranscript from "./SessionTranscript.jsx";
import SessionTrajectory from "./SessionTrajectory.jsx";
import {
  createSpaceSessionSubmitFor,
  sessionsByIdMap,
  spaceLeafPresentation,
  SPACE_LAYOUT_CANONICAL_DIVERGENCE,
} from "./spacesController.js";

/* The space surface renders the space's ONE layout tree: splits sized by
   integer weights, stacks as tab strips, leaves as the existing session view
   components. Every mutation is a callback into the model door (useSpaces) —
   this component holds no layout state of its own, and the focus ring it
   paints comes from state.focusedLeaf alone. Reconciliation honesty on
   leaves: tombstone and unknown-with-reason cards are visibly distinct from
   live views, and a non-live leaf never mounts a live session component. */

const VIEW_KIND_GLYPHS = {
  chat: Forum,
  shell: Terminal,
  trajectory: Timeline,
};

const EDGE_DROPS = [
  { edge: "left", direction: "horizontal", position: "before" },
  { edge: "right", direction: "horizontal", position: "after" },
  { edge: "top", direction: "vertical", position: "before" },
  { edge: "bottom", direction: "vertical", position: "after" },
];

export default function SpaceSurface({
  space = null,
  state = null,
  error = null,
  deleteError = "",
  saveError = "",
  opError = "",
  sessions = [],
  onFocusLeaf,
  onSelectTab,
  onCloseLeaf,
  onDragOutLeaf,
  onExitSpace,
  onPopOutAll = null,
  onPopOutLeaf = null,
  onDismissDeleteError,
  onHeaderDragStart = null,
}) {
  const sessionsById = useMemo(() => sessionsByIdMap(sessions), [sessions]);
  const [dragLeafId, setDragLeafId] = useState("");
  const [dropHint, setDropHint] = useState(null); // { stackId, edge }
  /* Composer state keyed by session ref so two panes of one session read the
     same draft, and a tab flip does not eat typed text, staged attachments, or
     oversized paste blocks. The composer is fully controlled: without these
     three, image/large-text pastes and file attachments are silently dropped. */
  const [drafts, setDrafts] = useState({});
  const [pastesBySession, setPastesBySession] = useState({});
  const [attachmentsBySession, setAttachmentsBySession] = useState({});
  const submitCommandFor = useMemo(() => createSpaceSessionSubmitFor(invoke), []);

  const endDrag = useCallback(() => {
    setDragLeafId("");
    setDropHint(null);
  }, []);

  /* The composer hands back both the composite prompt (typed text + paste
     blocks) and its staged attachments; both must ride the submit. */
  const submitFor = useCallback((session) => async (prompt, attachments) => {
    try {
      /* The shared submit seam reads attachments.length, so its caller always
         supplies an array — including plain-text and large-text-only submits. */
      await submitCommandFor(session)(prompt, attachments || []);
      /* A settled submit clears every part of this session's composer — typed
         text, paste blocks, and staged attachments — so nothing is silently
         carried into the next prompt. */
      setDrafts((current) => ({ ...current, [session.id]: "" }));
      setPastesBySession((current) => ({ ...current, [session.id]: [] }));
      setAttachmentsBySession((current) => ({ ...current, [session.id]: [] }));
      return true;
    } catch {
      /* Failed submits keep text, paste blocks, AND attachments — all are the
         unrecoverable parts. */
      return false;
    }
  }, [submitCommandFor]);

  /* onAttachmentsChange receives either a next array or an updater function
     (the composer stages pasted images through an updater). */
  const setAttachmentsFor = useCallback((sessionId, next) => {
    setAttachmentsBySession((current) => {
      const previous = current[sessionId] || [];
      const resolved = typeof next === "function" ? next(previous) : next;
      return { ...current, [sessionId]: resolved };
    });
  }, []);

  const renderLeaf = (leaf) => {
    const presentation = spaceLeafPresentation(leaf, sessionsById);
    if (presentation.mode === "tombstone") {
      return (
        <LeafStateCard data-tone="tombstone">
          <LeafStateTag>tombstone</LeafStateTag>
          <strong>Session removed</strong>
          <span>
            The daemon no longer lists “{leaf.sessionRef}”. The tab is kept —
            close it when you are done with it.
          </span>
        </LeafStateCard>
      );
    }
    if (presentation.mode === "unknown") {
      return (
        <LeafStateCard data-tone="unknown">
          <LeafStateTag>unknown</LeafStateTag>
          <strong>Session state unknown</strong>
          <span>{presentation.reason}</span>
        </LeafStateCard>
      );
    }
    const session = presentation.session;
    if (leaf.viewKind === "trajectory") {
      return (
        <LeafViewHost>
          <SessionTrajectory session={session} />
        </LeafViewHost>
      );
    }
    if (leaf.viewKind === "shell") {
      /* The model carries shell leaves; this surface does not render them
         yet. An honest placeholder beats a silently blank PTY. */
      return (
        <LeafStateCard data-tone="unknown">
          <LeafStateTag>shell</LeafStateTag>
          <strong>Shell view not rendered in spaces yet</strong>
          <span>Open “{session.title || leaf.sessionRef}” from All sessions for its shell.</span>
        </LeafStateCard>
      );
    }
    return (
      <LeafViewHost>
        <SessionTranscript session={session} />
        <SessionComposer
          attachments={attachmentsBySession[session.id] || []}
          onAttachmentsChange={(next) => setAttachmentsFor(session.id, next)}
          onPastedBlocksChange={(next) => setPastesBySession((current) => ({
            ...current,
            [session.id]: next,
          }))}
          onSubmit={submitFor(session)}
          onValueChange={(text) => setDrafts((current) => ({
            ...current,
            [session.id]: text,
          }))}
          pastedBlocks={pastesBySession[session.id] || []}
          placeholder={`Message ${session.title || "session"}…`}
          value={drafts[session.id] || ""}
        />
      </LeafViewHost>
    );
  };

  const renderStack = (stack) => {
    const activeTab = stack.tabs.find((tab) => tab.id === stack.active) || stack.tabs[0];
    const dropTargetId = activeTab.id !== dragLeafId
      ? activeTab.id
      : stack.tabs.find((tab) => tab.id !== dragLeafId)?.id || null;
    return (
      <StackPane key={stack.id}>
        <StackTabStrip role="tablist">
          {stack.tabs.map((tab) => {
            const presentation = spaceLeafPresentation(tab, sessionsById);
            const Glyph = VIEW_KIND_GLYPHS[tab.viewKind] || Forum;
            const title = sessionsById.get(tab.sessionRef)?.title || tab.sessionRef;
            return (
              <StackTab
                aria-selected={tab.id === stack.active}
                data-active={tab.id === stack.active ? "true" : undefined}
                data-focused={tab.id === state.focusedLeaf ? "true" : undefined}
                data-state={presentation.mode}
                draggable
                key={tab.id}
                onClick={() => onSelectTab?.(stack.id, tab.id)}
                onDragEnd={endDrag}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", tab.id);
                  event.dataTransfer.effectAllowed = "move";
                  setDragLeafId(tab.id);
                }}
                role="tab"
                title={title}
                type="button"
              >
                <Glyph aria-hidden="true" size={12} />
                <span>{title}</span>
                {presentation.mode !== "live" && (
                  <StackTabStateMark data-state={presentation.mode}>
                    {presentation.mode === "tombstone" ? "gone" : "?"}
                  </StackTabStateMark>
                )}
                <StackTabPopout
                  aria-label="Pop out leaf"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPopOutLeaf?.({
                      leafId: tab.id,
                      sessionId: tab.sessionRef,
                      spaceId: space?.id,
                      title,
                    });
                  }}
                  role="button"
                  tabIndex={-1}
                  title="Open this leaf in its own window"
                >
                  <OpenInNew aria-hidden="true" />
                </StackTabPopout>
                <StackTabClose
                  aria-label="Close view"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseLeaf?.(tab.id);
                  }}
                  role="button"
                  tabIndex={-1}
                  title="Close this view (the session stays a member)"
                >
                  <Close aria-hidden="true" />
                </StackTabClose>
              </StackTab>
            );
          })}
        </StackTabStrip>
        <StackContent
          data-focused={activeTab.id === state.focusedLeaf ? "true" : undefined}
          onMouseDownCapture={() => {
            if (activeTab.id !== state.focusedLeaf) onFocusLeaf?.(activeTab.id);
          }}
        >
          {renderLeaf(activeTab)}
          {dragLeafId && dropTargetId && EDGE_DROPS.map(({ edge, direction, position }) => (
            <EdgeDropZone
              data-edge={edge}
              data-hot={dropHint?.stackId === stack.id && dropHint?.edge === edge
                ? "true"
                : undefined}
              key={edge}
              onDragLeave={() => setDropHint((current) => (
                current?.stackId === stack.id && current?.edge === edge ? null : current
              ))}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropHint({ stackId: stack.id, edge });
              }}
              onDrop={(event) => {
                event.preventDefault();
                const leafId = event.dataTransfer.getData("text/plain") || dragLeafId;
                endDrag();
                if (leafId && leafId !== dropTargetId) {
                  onDragOutLeaf?.(leafId, dropTargetId, { direction, position });
                }
              }}
            />
          ))}
        </StackContent>
      </StackPane>
    );
  };

  const renderNode = (node) => {
    if (node.kind === "stack") return renderStack(node);
    if (node.kind === "split") {
      return (
        <SplitBox data-direction={node.direction} key={node.id}>
          {node.children.map((child, index) => (
            <SplitCell key={child.id} style={{ flexGrow: node.sizes[index] }}>
              {renderNode(child)}
            </SplitCell>
          ))}
        </SplitBox>
      );
    }
    return null;
  };

  return (
    <SpaceSurfaceRoot>
      <SpaceHeader onMouseDown={onHeaderDragStart || undefined}>
        <SpaceHeaderGlyph aria-hidden="true">
          <Workspaces size={13} />
        </SpaceHeaderGlyph>
        <SpaceHeaderTitle>{space?.name || "Space"}</SpaceHeaderTitle>
        {opError && <SpaceHeaderNotice data-tone="red">{opError}</SpaceHeaderNotice>}
        {saveError && (
          <SpaceHeaderNotice data-tone="amber" title={saveError}>
            Layout save failed — retrying on the next change
          </SpaceHeaderNotice>
        )}
        <SpaceHeaderPopOutAll
          disabled={!state?.root || !onPopOutAll}
          onClick={() => onPopOutAll?.()}
          onMouseDown={(event) => event.stopPropagation()}
          title="Open every leaf in its own window"
          type="button"
        >
          <OpenInNew aria-hidden="true" />
          <span>Pop out all</span>
        </SpaceHeaderPopOutAll>
        <SpaceHeaderExit
          onClick={() => onExitSpace?.()}
          onMouseDown={(event) => event.stopPropagation()}
          title="Leave this space"
          type="button"
        >
          All sessions
        </SpaceHeaderExit>
      </SpaceHeader>

      {deleteError && (
        <SpaceDeleteErrorStrip data-error-type="space-delete" role="alert">
          <span>Space deletion failed: {deleteError}</span>
          <button
            aria-label="Dismiss space deletion error"
            onClick={() => onDismissDeleteError?.()}
            type="button"
          >
            <Close aria-hidden="true" />
          </button>
        </SpaceDeleteErrorStrip>
      )}

      {error ? (
        <SpaceBodyCenter>
          <SpaceErrorCard role="alert">
            <LeafStateTag>{error.code}</LeafStateTag>
            <strong>
              {error.code === SPACE_LAYOUT_CANONICAL_DIVERGENCE
                ? "This space's saved layout diverged from its canonical bytes"
                : "This space could not be opened"}
            </strong>
            <span>{error.message}</span>
            <em>
              The stored layout was left exactly as it is — nothing was
              normalized or reset.
            </em>
          </SpaceErrorCard>
        </SpaceBodyCenter>
      ) : !state ? (
        <SpaceBodyCenter>
          <SpaceMutedHint>Opening space…</SpaceMutedHint>
        </SpaceBodyCenter>
      ) : state.root == null ? (
        <SpaceBodyCenter>
          <SpaceMutedHint>
            This space is empty. New chat opens a session into it, and clicking
            a member session in the rail adds a view here.
          </SpaceMutedHint>
        </SpaceBodyCenter>
      ) : (
        <SpaceBody>{renderNode(state.root)}</SpaceBody>
      )}
    </SpaceSurfaceRoot>
  );
}

const SpaceSurfaceRoot = styled.div`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

const SpaceHeader = styled.div`
  display: flex;
  min-height: 34px;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border-bottom: 1px solid rgba(var(--forge-tint-rgb), 0.1);
`;

const SpaceHeaderGlyph = styled.span`
  display: grid;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  place-items: center;
  border-radius: 6px;
  color: var(--forge-tint-soft, var(--forge-blue, #62a0ff));
  background: rgba(var(--forge-tint-rgb), 0.14);
`;

const SpaceHeaderTitle = styled.span`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text);
  font-size: 12.5px;
  font-weight: 640;
  white-space: nowrap;
  text-overflow: ellipsis;
`;

const SpaceHeaderNotice = styled.span`
  overflow: hidden;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 650;
  white-space: nowrap;
  text-overflow: ellipsis;

  &[data-tone="amber"] {
    border: 1px solid color-mix(in srgb, var(--forge-amber) 42%, transparent);
    color: var(--forge-amber);
  }

  &[data-tone="red"] {
    border: 1px solid color-mix(in srgb, var(--forge-red) 42%, transparent);
    color: var(--forge-red);
  }
`;

const SpaceHeaderExit = styled.button`
  flex: 0 0 auto;
  padding: 3px 9px;
  border: 1px solid var(--forge-border-strong);
  border-radius: 6px;
  color: var(--forge-text-soft);
  background: transparent;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }
`;

const SpaceHeaderPopOutAll = styled(SpaceHeaderExit)`
  display: inline-flex;
  margin-left: auto;
  align-items: center;
  gap: 5px;

  svg { width: 11px; height: 11px; }

  &:disabled {
    opacity: 0.45;
    cursor: default;
  }
`;

const SpaceDeleteErrorStrip = styled.div`
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-bottom: 1px solid color-mix(in srgb, var(--forge-red) 42%, transparent);
  color: var(--forge-red);
  background: color-mix(in srgb, var(--forge-red) 7%, var(--forge-surface));
  font-size: 11px;
  font-weight: 600;

  span {
    min-width: 0;
    flex: 1;
    overflow-wrap: anywhere;
  }

  button {
    display: grid;
    width: 20px;
    height: 20px;
    flex: 0 0 auto;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 5px;
    color: currentColor;
    background: transparent;
    cursor: pointer;

    &:hover {
      background: color-mix(in srgb, var(--forge-red) 12%, transparent);
    }

    svg {
      width: 14px;
      height: 14px;
    }
  }
`;

const SpaceBody = styled.div`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  padding: 8px;
`;

const SpaceBodyCenter = styled.div`
  display: grid;
  min-height: 0;
  flex: 1;
  place-items: center;
  padding: 24px;
`;

const SpaceMutedHint = styled.div`
  max-width: 420px;
  color: var(--forge-text-muted);
  font-size: 12px;
  text-align: center;
`;

const SpaceErrorCard = styled.div`
  display: grid;
  max-width: 480px;
  gap: 8px;
  padding: 16px 18px;
  border: 1px solid color-mix(in srgb, var(--forge-red) 45%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--forge-red) 6%, transparent);

  strong {
    color: var(--forge-text);
    font-size: 13px;
  }

  span {
    color: var(--forge-text-soft);
    font-size: 11.5px;
    overflow-wrap: anywhere;
  }

  em {
    color: var(--forge-text-muted);
    font-size: 10.5px;
    font-style: normal;
  }
`;

const SplitBox = styled.div`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  gap: 6px;

  &[data-direction="horizontal"] {
    flex-direction: row;
  }

  &[data-direction="vertical"] {
    flex-direction: column;
  }
`;

const SplitCell = styled.div`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-basis: 0;
  flex-shrink: 1;
`;

const StackPane = styled.div`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  border: 1px solid rgba(var(--forge-tint-rgb), 0.12);
  border-radius: 10px;
  background: var(--forge-surface);
`;

const StackTabStrip = styled.div`
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  overflow-x: auto;
  border-bottom: 1px solid rgba(var(--forge-tint-rgb), 0.1);
  scrollbar-width: none;

  &::-webkit-scrollbar {
    height: 0;
  }
`;

const StackTab = styled.button`
  display: inline-flex;
  min-width: 0;
  max-width: 180px;
  align-items: center;
  gap: 6px;
  padding: 3px 7px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: var(--forge-text-muted);
  background: transparent;
  font-size: 11px;
  font-weight: 570;
  cursor: pointer;

  > span {
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }

  &[data-active="true"] {
    color: var(--forge-text);
    background: var(--forge-surface-selected);
  }

  /* The FOCUSED leaf's tab (one per space) reads with the accent ring. */
  &[data-focused="true"] {
    border-color: rgba(var(--forge-tint-soft-rgb), 0.52);
  }

  &[data-state="tombstone"] > span {
    text-decoration: line-through;
    opacity: 0.7;
  }
`;

const StackTabStateMark = styled.i`
  flex: 0 0 auto;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 7.5px;
  font-weight: 800;
  font-style: normal;
  letter-spacing: 0.06em;
  text-transform: uppercase;

  &[data-state="tombstone"] {
    border: 1px solid var(--forge-border-strong);
    color: var(--forge-text-muted);
  }

  &[data-state="unknown"] {
    border: 1px solid color-mix(in srgb, var(--forge-amber) 45%, transparent);
    color: var(--forge-amber);
  }
`;

const StackTabClose = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 4px;
  color: var(--forge-text-muted);
  cursor: pointer;

  svg {
    width: 10px;
    height: 10px;
  }

  &:hover {
    color: var(--forge-text);
    background: var(--forge-surface-hover);
  }
`;

const StackTabPopout = styled(StackTabClose)`
  opacity: 0.58;

  ${StackTab}:hover &,
  ${StackTab}:focus-visible & {
    opacity: 1;
  }
`;

const StackContent = styled.div`
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  border-radius: 0 0 10px 10px;

  &[data-focused="true"] {
    box-shadow: inset 0 0 0 1px rgba(var(--forge-tint-soft-rgb), 0.4);
  }
`;

const LeafViewHost = styled.div`
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1;
  flex-direction: column;
`;

const LeafStateCard = styled.div`
  display: grid;
  align-content: center;
  justify-items: center;
  flex: 1;
  gap: 6px;
  margin: 12px;
  padding: 18px;
  border-radius: 8px;
  text-align: center;

  strong {
    color: var(--forge-text);
    font-size: 12.5px;
  }

  span {
    max-width: 360px;
    color: var(--forge-text-muted);
    font-size: 11px;
    overflow-wrap: anywhere;
  }

  /* Tombstone: the session is KNOWN gone — quiet, final, dashed. */
  &[data-tone="tombstone"] {
    border: 1px dashed var(--forge-border-strong);
  }

  /* Unknown: the daemon has not answered — amber, provisional. */
  &[data-tone="unknown"] {
    border: 1px solid color-mix(in srgb, var(--forge-amber) 40%, transparent);
    background: color-mix(in srgb, var(--forge-amber) 5%, transparent);
  }
`;

const LeafStateTag = styled.i`
  padding: 1px 6px;
  border: 1px solid currentColor;
  border-radius: 4px;
  color: var(--forge-text-muted);
  font-size: 8px;
  font-weight: 800;
  font-style: normal;
  letter-spacing: 0.07em;
  text-transform: uppercase;

  [data-tone="unknown"] > & {
    color: var(--forge-amber);
  }
`;

const EdgeDropZone = styled.div`
  position: absolute;
  z-index: 5;

  &[data-edge="left"] {
    top: 0;
    bottom: 0;
    left: 0;
    width: 26%;
  }

  &[data-edge="right"] {
    top: 0;
    right: 0;
    bottom: 0;
    width: 26%;
  }

  &[data-edge="top"] {
    top: 0;
    right: 26%;
    left: 26%;
    height: 30%;
  }

  &[data-edge="bottom"] {
    right: 26%;
    bottom: 0;
    left: 26%;
    height: 30%;
  }

  &[data-hot="true"] {
    border: 1.5px dashed rgba(var(--forge-tint-soft-rgb), 0.6);
    border-radius: 8px;
    background: rgba(var(--forge-tint-rgb), 0.1);
  }
`;

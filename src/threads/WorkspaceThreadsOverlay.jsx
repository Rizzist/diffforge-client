import { AddComment } from "@styled-icons/material-rounded/AddComment";
import { ChevronLeft } from "@styled-icons/material-rounded/ChevronLeft";
import { ChevronRight } from "@styled-icons/material-rounded/ChevronRight";
import { Edit } from "@styled-icons/fa-regular/Edit";
import { Search } from "@styled-icons/material-rounded/Search";
import { memo, useEffect, useState } from "react";
import styled, { keyframes } from "styled-components";

import WorkspaceThreadDetail from "./WorkspaceThreadDetail.jsx";
import { getWorkspaceThreadLabel } from "./workspaceThreads";

const overlayFadeIn = keyframes`
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
`;

const overlayPanelIn = keyframes`
  from {
    opacity: 0;
    transform: scale(0.985);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
`;

const OverlayRoot = styled.div`
  position: absolute;
  inset: 0;
  z-index: 60;
  display: grid;
  min-width: 0;
  min-height: 0;
  color: #d8e2ef;
  background: rgba(0, 0, 0, 0.94);
  animation: ${overlayFadeIn} 140ms ease both;
  backdrop-filter: blur(7px);
  pointer-events: auto;
  user-select: text;
`;

const OverlayPanel = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(140px, 184px) minmax(0, 1fr);
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: #030405;
  box-shadow: none;
  animation: ${overlayPanelIn} 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transition: grid-template-columns 180ms cubic-bezier(0.16, 1, 0.3, 1);

  &[data-rail-collapsed="true"] {
    grid-template-columns: 36px minmax(0, 1fr);
  }

  @media (max-width: 760px) {
    grid-template-columns: minmax(132px, 56vw) minmax(0, 1fr);

    &[data-rail-collapsed="true"] {
      grid-template-columns: 36px minmax(0, 1fr);
    }
  }
`;

const ThreadRail = styled.aside`
  position: relative;
  z-index: 2;
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: visible;
  border-right: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(0, 0, 0, 0.92);
`;

const DrawerToggle = styled.button`
  position: absolute;
  top: 8px;
  right: -11px;
  z-index: 4;
  display: grid;
  width: 22px;
  height: 24px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(94, 111, 132, 0.34);
  border-radius: 999px;
  color: #94a3b8;
  background: rgba(10, 15, 23, 0.96);
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.24);
  transition:
    border-color 130ms ease,
    color 130ms ease,
    background 130ms ease,
    transform 130ms ease;

  &:hover {
    border-color: rgba(115, 151, 212, 0.42);
    color: #f6f9fd;
    background: rgba(17, 25, 37, 0.98);
    transform: translateX(1px);
  }

  &:focus-visible {
    outline: 2px solid rgba(105, 152, 220, 0.7);
    outline-offset: 2px;
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

const WorkspaceList = styled.div`
  display: grid;
  min-height: 0;
  align-content: start;
  gap: 14px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 40px 7px 8px;
`;

const RailActionStack = styled.div`
  display: grid;
  min-width: 0;
  height: 62px;
  align-content: start;
  gap: 5px;
`;

const RailActionButton = styled.button`
  display: flex;
  min-width: 0;
  height: 28px;
  align-items: center;
  gap: 7px;
  padding: 0 7px;
  border: 1px solid rgba(94, 111, 132, 0.18);
  border-radius: 5px;
  color: #758296;
  background: rgba(148, 163, 184, 0.035);
  text-align: left;
  opacity: 0.64;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  &:hover:not(:disabled),
  &[data-active="true"] {
    color: #dbe4f0;
    background: rgba(148, 163, 184, 0.08);
    opacity: 1;
  }

  &:disabled {
    cursor: not-allowed;
  }

  svg {
    width: 15px;
    height: 15px;
    flex: 0 0 auto;
  }

  span {
    min-width: 0;
    overflow: hidden;
    font-size: 11px;
    font-weight: 740;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const WorkspaceGroup = styled.section`
  display: grid;
  min-width: 0;
  gap: 5px;
`;

const WorkspaceTopline = styled.div`
  min-width: 0;
  padding: 0 5px 3px;
  color: #7b8798;
  font-size: 10px;
  font-weight: 780;
  letter-spacing: 0.06em;
  line-height: 1.2;
  text-transform: uppercase;

  span {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ThreadList = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;
`;

const CollapsedRail = styled.div`
  display: grid;
  min-height: 0;
  align-content: start;
  gap: 14px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 40px 6px 8px;
`;

const CollapsedRailActionStack = styled.div`
  display: grid;
  min-width: 0;
  height: 62px;
  align-content: start;
  gap: 5px;
`;

const CollapsedRailActionButton = styled.button`
  display: grid;
  width: 24px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(94, 111, 132, 0.18);
  border-radius: 5px;
  color: #758296;
  background: rgba(148, 163, 184, 0.035);
  opacity: 0.64;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  &:hover:not(:disabled),
  &[data-active="true"] {
    color: #dbe4f0;
    background: rgba(148, 163, 184, 0.08);
    opacity: 1;
  }

  &:disabled {
    cursor: not-allowed;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

const CollapsedWorkspaceGroup = styled.section`
  display: grid;
  min-width: 0;
  gap: 5px;
`;

const CollapsedWorkspaceMarker = styled.div`
  display: grid;
  width: 100%;
  height: 15px;
  place-items: end center;
  padding-bottom: 3px;

  span {
    width: 12px;
    height: 1px;
    background: rgba(148, 163, 184, 0.14);
    opacity: 0;
  }

  &[data-visible="true"] span {
    opacity: 1;
  }
`;

const CollapsedThreadButton = styled.button`
  position: relative;
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #bdcad9;
  background: transparent;
  transition:
    background 130ms ease,
    border-color 130ms ease;

  &[data-selected="true"] {
    border-color: rgba(103, 143, 204, 0.24);
    background: rgba(99, 145, 214, 0.14);
  }

  &:hover {
    background: rgba(148, 163, 184, 0.08);
  }

  &:focus-visible {
    outline: 2px solid rgba(105, 152, 220, 0.7);
    outline-offset: 2px;
  }
`;

const ThreadRow = styled.button`
  display: flex;
  min-width: 0;
  min-height: 24px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 5px;
  color: #bdcad9;
  background: transparent;
  text-align: left;
  transition:
    background 130ms ease,
    border-color 130ms ease,
    color 130ms ease;

  &[data-selected="true"] {
    border-color: rgba(103, 143, 204, 0.2);
    color: #f6f9fd;
    background: rgba(99, 145, 214, 0.14);
  }

  &:hover {
    color: #f6f9fd;
    background: rgba(148, 163, 184, 0.08);
  }

  strong {
    min-width: 0;
    overflow: hidden;
    font-size: 11px;
    font-weight: 740;
    letter-spacing: 0;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const TerminalStateDot = styled.span`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 99px;
  background: #556273;

  &[data-live="true"] {
    background: #35d18a;
    box-shadow: 0 0 10px rgba(53, 209, 138, 0.28);
  }

  &[data-state="starting"] {
    background: #f9b44c;
    box-shadow: 0 0 10px rgba(249, 180, 76, 0.24);
  }

  &[data-state="error"] {
    background: #ef6b6b;
    box-shadow: 0 0 10px rgba(239, 107, 107, 0.24);
  }
`;

const EmptyThreads = styled.div`
  padding: 7px 8px;
  color: #6e7b8d;
  font-size: 11px;
  font-weight: 720;
`;

function getThreadRows(workspaceThreads, workspaceId) {
  const entry = workspaceThreads?.[workspaceId];
  if (!entry) {
    return [];
  }

  return (entry.threadOrder || [])
    .map((threadId) => entry.threads?.[threadId])
    .filter((thread) => thread?.materialized);
}

function getThreadState(thread) {
  return {
    isLive: Boolean(thread.terminalBinding && thread.status === "active"),
    label: getWorkspaceThreadLabel(thread),
  };
}

function WorkspaceThreadsOverlay({
  agentStatuses,
  onClose,
  onActiveThreadChange,
  onCreateChat,
  onSelectModel,
  onSelectThread,
  onSubmitMessage,
  open,
  selectedThreadId,
  selectedWorkspaceId,
  workspaceThreads,
  workspaces,
}) {
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [newChatActive, setNewChatActive] = useState(false);
  const [localSelection, setLocalSelection] = useState(() => ({
    threadId: selectedThreadId || "",
    workspaceId: selectedWorkspaceId || "",
  }));

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setLocalSelection((selection) => ({
      threadId: selection.threadId || selectedThreadId || "",
      workspaceId: selection.workspaceId || selectedWorkspaceId || "",
    }));
  }, [open, selectedThreadId, selectedWorkspaceId]);

  const collapsedThreadGroups = (workspaces || [])
    .map((workspace) => ({
      threads: getThreadRows(workspaceThreads, workspace.id),
      workspace,
    }))
    .filter((group) => group.threads.length > 0);
  const threadGroups = (workspaces || []).map((workspace) => ({
    threads: getThreadRows(workspaceThreads, workspace.id),
    workspace,
  }));
  const hasVisibleThreads = collapsedThreadGroups.length > 0;
  const selectedThreadFromLocal = workspaceThreads?.[localSelection.workspaceId]
    ?.threads?.[localSelection.threadId];
  const fallbackSelection = collapsedThreadGroups[0]?.threads?.[0]
    ? {
      thread: collapsedThreadGroups[0].threads[0],
      workspace: collapsedThreadGroups[0].workspace,
    }
    : { thread: null, workspace: null };
  const activeThread = selectedThreadFromLocal?.materialized
    ? selectedThreadFromLocal
    : fallbackSelection.thread;
  const activeWorkspace = activeThread
    ? (workspaces || []).find((workspace) => workspace.id === activeThread.workspaceId)
      || fallbackSelection.workspace
    : null;
  const activeWorkspaceId = activeWorkspace?.id || activeThread?.workspaceId || "";
  const activeThreadId = activeThread?.id || "";
  const newChatWorkspace = (workspaces || []).find((workspace) => workspace.id === selectedWorkspaceId)
    || activeWorkspace
    || fallbackSelection.workspace
    || (workspaces || [])[0]
    || null;
  const visibleActiveWorkspaceId = newChatActive ? "" : activeWorkspaceId;
  const visibleActiveThreadId = newChatActive ? "" : activeThreadId;
  const selectThread = (workspaceId, threadId) => {
    setNewChatActive(false);
    setLocalSelection({ threadId, workspaceId });
    onSelectThread?.(workspaceId, threadId);
  };
  const openNewChat = () => {
    setNewChatActive(true);
    if (railCollapsed) {
      setRailCollapsed(false);
    }
  };
  const createChat = async (request) => {
    const result = await onCreateChat?.({
      ...request,
      workspace: request?.workspace || newChatWorkspace,
    });
    const nextWorkspaceId = result?.workspaceId || result?.workspace?.id || newChatWorkspace?.id || "";
    const nextThreadId = result?.threadId || result?.thread?.id || "";
    if (nextWorkspaceId && nextThreadId) {
      setLocalSelection({ threadId: nextThreadId, workspaceId: nextWorkspaceId });
      onSelectThread?.(nextWorkspaceId, nextThreadId);
      setNewChatActive(false);
    }

    return result;
  };

  useEffect(() => {
    if (open && !hasVisibleThreads) {
      setNewChatActive(true);
    }
  }, [hasVisibleThreads, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    onActiveThreadChange?.({
      thread: newChatActive ? null : activeThread || null,
      threadId: newChatActive ? "" : activeThreadId,
      workspace: newChatActive ? newChatWorkspace : activeWorkspace || null,
      workspaceId: newChatActive ? newChatWorkspace?.id || "" : activeWorkspaceId,
    });
  }, [
    activeThread,
    activeThreadId,
    activeWorkspace,
    activeWorkspaceId,
    newChatActive,
    newChatWorkspace,
    onActiveThreadChange,
    open,
  ]);

  if (!open) {
    return null;
  }

  return (
    <OverlayRoot aria-label="Workspace threads" data-terminal-control="true" role="dialog">
      <OverlayPanel data-rail-collapsed={railCollapsed ? "true" : "false"}>
        <ThreadRail>
          <DrawerToggle
            aria-label={railCollapsed ? "Expand threads sidebar" : "Collapse threads sidebar"}
            onClick={() => setRailCollapsed((value) => !value)}
            title={railCollapsed ? "Expand threads" : "Collapse threads"}
            type="button"
          >
            {railCollapsed ? (
              <ChevronRight aria-hidden="true" />
            ) : (
              <ChevronLeft aria-hidden="true" />
            )}
          </DrawerToggle>

          {railCollapsed ? (
            <CollapsedRail aria-label="Collapsed workspace threads">
              <CollapsedRailActionStack aria-label="Thread actions">
                <CollapsedRailActionButton
                  aria-label="New Chat"
                  data-active={newChatActive ? "true" : "false"}
                  onClick={openNewChat}
                  title="New Chat"
                  type="button"
                >
                  <AddComment aria-hidden="true" />
                </CollapsedRailActionButton>
                <CollapsedRailActionButton
                  aria-label="Search"
                  disabled
                  title="Search"
                  type="button"
                >
                  <Search aria-hidden="true" />
                </CollapsedRailActionButton>
              </CollapsedRailActionStack>
              {collapsedThreadGroups.map(({ threads, workspace }, workspaceIndex) => (
                <CollapsedWorkspaceGroup key={workspace.id}>
                  <CollapsedWorkspaceMarker
                    aria-hidden="true"
                    data-visible={workspaceIndex > 0 ? "true" : "false"}
                  >
                    <span />
                  </CollapsedWorkspaceMarker>
                  <ThreadList>
                    {threads.map((thread) => {
                      const isSelected = visibleActiveWorkspaceId === workspace.id
                        && visibleActiveThreadId === thread.id;
                      const { isLive, label } = getThreadState(thread);

                      return (
                        <CollapsedThreadButton
                          aria-label={`${workspace.name}: ${label}`}
                          data-selected={isSelected ? "true" : "false"}
                          key={thread.id}
                          onClick={() => selectThread(workspace.id, thread.id)}
                          title={`${workspace.name}: ${label}`}
                          type="button"
                        >
                          <TerminalStateDot
                            aria-hidden="true"
                            data-live={isLive ? "true" : "false"}
                            data-state={thread.status}
                          />
                        </CollapsedThreadButton>
                      );
                    })}
                  </ThreadList>
                </CollapsedWorkspaceGroup>
              ))}
            </CollapsedRail>
          ) : (
            <WorkspaceList>
              <RailActionStack aria-label="Thread actions">
                <RailActionButton
                  data-active={newChatActive ? "true" : "false"}
                  onClick={openNewChat}
                  title="New Chat"
                  type="button"
                >
                  <Edit aria-hidden="true" />
                  <span>New Chat</span>
                </RailActionButton>
                <RailActionButton disabled title="Search" type="button">
                  <Search aria-hidden="true" />
                  <span>Search</span>
                </RailActionButton>
              </RailActionStack>
              {threadGroups.map(({ threads, workspace }) => {
                return (
                  <WorkspaceGroup key={workspace.id}>
                    <WorkspaceTopline>
                      <span title={workspace.name}>{workspace.name}</span>
                    </WorkspaceTopline>
                    <ThreadList>
                      {threads.length ? threads.map((thread) => {
                        const isSelected = visibleActiveWorkspaceId === workspace.id
                          && visibleActiveThreadId === thread.id;
                        const { isLive, label } = getThreadState(thread);

                        return (
                          <ThreadRow
                            data-selected={isSelected ? "true" : "false"}
                            key={thread.id}
                            onClick={() => selectThread(workspace.id, thread.id)}
                            title={label}
                            type="button"
                          >
                            <strong>{label}</strong>
                            <TerminalStateDot
                              aria-hidden="true"
                              data-live={isLive ? "true" : "false"}
                              data-state={thread.status}
                            />
                          </ThreadRow>
                        );
                      }) : (
                        <EmptyThreads>No threads</EmptyThreads>
                      )}
                    </ThreadList>
                  </WorkspaceGroup>
                );
              })}
            </WorkspaceList>
          )}
        </ThreadRail>

        <WorkspaceThreadDetail
          agentStatuses={agentStatuses}
          newChatActive={newChatActive}
          onCreateChat={createChat}
          onSelectModel={onSelectModel}
          onSubmitMessage={onSubmitMessage}
          thread={newChatActive ? null : activeThread}
          workspace={newChatActive ? newChatWorkspace : activeWorkspace}
        />
      </OverlayPanel>
    </OverlayRoot>
  );
}

export default memo(WorkspaceThreadsOverlay);

import { ChevronLeft } from "@styled-icons/material-rounded/ChevronLeft";
import { ChevronRight } from "@styled-icons/material-rounded/ChevronRight";
import { DeleteOutline } from "@styled-icons/material-rounded/DeleteOutline";
import { Edit } from "@styled-icons/fa-regular/Edit";
import { Search } from "@styled-icons/material-rounded/Search";
import { memo, useEffect } from "react";
import styled, { keyframes } from "styled-components";

import WorkspaceThreadDetail from "./WorkspaceThreadDetail.jsx";
import {
  getWorkspaceThreadCanArchive,
  getWorkspaceThreadHasSession,
  getWorkspaceThreadLabel,
  getWorkspaceThreadProviderBinding,
  getWorkspaceThreadTurnState,
} from "./workspaceThreads";

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
  --thread-bg: #09090b;
  --thread-card: #0d0d10;
  --thread-fg: #f4f4f5;
  --thread-muted: #a1a1aa;
  --thread-muted-soft: rgba(161, 161, 170, 0.58);
  --thread-border: rgba(255, 255, 255, 0.065);
  --thread-accent: rgba(255, 255, 255, 0.055);
  --thread-accent-strong: rgba(255, 255, 255, 0.085);
  --thread-primary: rgba(98, 132, 255, 0.28);
  --thread-primary-hover: rgba(98, 132, 255, 0.36);
  color: var(--thread-fg);
  background: var(--thread-bg);
  animation: ${overlayFadeIn} 140ms ease both;
  backdrop-filter: blur(7px);
  pointer-events: auto;
  user-select: text;
`;

const OverlayPanel = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(212px, 256px) minmax(0, 1fr);
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background: var(--thread-bg);
  box-shadow: none;
  animation: ${overlayPanelIn} 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transition: grid-template-columns 180ms cubic-bezier(0.16, 1, 0.3, 1);

  &[data-rail-collapsed="true"] {
    grid-template-columns: 48px minmax(0, 1fr);
  }

  @media (max-width: 760px) {
    grid-template-columns: minmax(190px, 72vw) minmax(0, 1fr);

    &[data-rail-collapsed="true"] {
      grid-template-columns: 48px minmax(0, 1fr);
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
  border-right: 1px solid var(--thread-border);
  background: var(--thread-bg);
`;

const DrawerToggle = styled.button`
  position: absolute;
  top: 10px;
  right: -12px;
  z-index: 4;
  display: grid;
  width: 24px;
  height: 24px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  color: var(--thread-muted);
  background: #111116;
  box-shadow: 0 10px 22px rgba(0, 0, 0, 0.28);
  transition:
    border-color 130ms ease,
    color 130ms ease,
    background 130ms ease,
    transform 130ms ease;

  &:hover {
    border-color: rgba(255, 255, 255, 0.18);
    color: var(--thread-fg);
    background: #18181d;
    transform: translateX(1px);
  }

  &:focus-visible {
    outline: 2px solid rgba(98, 132, 255, 0.68);
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
  gap: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 42px 8px 10px;
  background: var(--thread-bg);

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.1);
  }
`;

const RailActionStack = styled.div`
  display: grid;
  min-width: 0;
  padding-bottom: 2px;
  align-content: start;
  gap: 4px;
`;

const RailActionButton = styled.button`
  display: flex;
  min-width: 0;
  height: 32px;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--thread-fg);
  background: transparent;
  text-align: left;
  font: inherit;
  opacity: 1;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  &:hover:not(:disabled),
  &[data-active="true"] {
    color: var(--thread-fg);
    background: var(--thread-accent);
    opacity: 1;
  }

  &:disabled {
    color: var(--thread-muted-soft);
    opacity: 0.58;
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
    font-size: 13px;
    font-weight: 540;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const WorkspaceGroup = styled.section`
  display: grid;
  min-width: 0;
  gap: 3px;
`;

const WorkspaceTopline = styled.div`
  min-width: 0;
  padding: 7px 8px 4px;
  color: var(--thread-muted);
  font-size: 12px;
  font-weight: 560;
  letter-spacing: 0;
  line-height: 1.2;
  text-transform: none;

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
  gap: 4px;
  margin: 0 14px;
  padding: 2px 0 2px 10px;
  border-left: 1px solid var(--thread-border);
`;

const CollapsedThreadList = styled(ThreadList)`
  place-items: center;
  margin: 0;
  padding: 0;
  border-left: 0;
`;

const CollapsedRail = styled.div`
  display: grid;
  min-height: 0;
  align-content: start;
  gap: 8px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 42px 8px 10px;
  background: var(--thread-bg);
`;

const CollapsedRailActionStack = styled.div`
  display: grid;
  min-width: 0;
  padding-bottom: 2px;
  align-content: start;
  gap: 4px;
`;

const CollapsedRailActionButton = styled.button`
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--thread-fg);
  background: transparent;
  opacity: 1;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  &:hover:not(:disabled),
  &[data-active="true"] {
    color: var(--thread-fg);
    background: var(--thread-accent);
    opacity: 1;
  }

  &:disabled {
    color: var(--thread-muted-soft);
    opacity: 0.58;
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
  gap: 4px;
`;

const CollapsedWorkspaceMarker = styled.div`
  display: grid;
  width: 100%;
  height: 15px;
  place-items: end center;
  padding-bottom: 3px;

  span {
    width: 18px;
    height: 1px;
    background: var(--thread-border);
    opacity: 0;
  }

  &[data-visible="true"] span {
    opacity: 1;
  }
`;

const CollapsedThreadButton = styled.button`
  position: relative;
  display: grid;
  width: 32px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--thread-muted);
  background: transparent;
  transition:
    background 130ms ease,
    border-color 130ms ease;

  &[data-selected="true"] {
    border-color: rgba(98, 132, 255, 0.24);
    background: var(--thread-primary);
  }

  &:hover {
    background: var(--thread-accent);
  }

  &:focus-visible {
    outline: 2px solid rgba(98, 132, 255, 0.68);
    outline-offset: 2px;
  }
`;

const ThreadRow = styled.div`
  display: flex;
  min-width: 0;
  height: 28px;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 0 4px 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--thread-muted);
  background: transparent;
  font: inherit;
  text-align: left;
  transition:
    background 130ms ease,
    border-color 130ms ease,
    color 130ms ease;

  &[data-selected="true"] {
    border-color: rgba(98, 132, 255, 0.22);
    color: var(--thread-fg);
    background: var(--thread-primary);
  }

  &:hover {
    color: var(--thread-fg);
    background: var(--thread-accent);
  }

  &[data-selected="true"]:hover {
    background: var(--thread-primary-hover);
  }
`;

const ThreadSelectButton = styled.button`
  display: flex;
  min-width: 0;
  height: 100%;
  flex: 1 1 auto;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;

  strong {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 520;
    letter-spacing: 0;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:focus-visible {
    outline: 2px solid rgba(98, 132, 255, 0.68);
    outline-offset: 2px;
  }
`;

const ThreadRowText = styled.span`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
`;

const ThreadArchiveButton = styled.button`
  display: grid;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: var(--thread-muted-soft);
  background: transparent;
  opacity: 0;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  ${ThreadRow}:hover &,
  ${ThreadRow}:focus-within & {
    opacity: 1;
  }

  &:hover {
    color: #fecaca;
    background: rgba(248, 113, 113, 0.12);
  }

  &:focus-visible {
    opacity: 1;
    outline: 2px solid rgba(248, 113, 113, 0.48);
    outline-offset: 1px;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

const TerminalStateDot = styled.span`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 99px;
  background: #71717a;

  &[data-nosession="true"] {
    background: #fcd34d;
    box-shadow: 0 0 10px rgba(252, 211, 77, 0.24);
  }

  &[data-live="true"] {
    background: #34d399;
    box-shadow: 0 0 10px rgba(52, 211, 153, 0.28);
  }

  &[data-live="true"][data-nosession="true"] {
    background: #fcd34d;
    box-shadow: 0 0 10px rgba(252, 211, 77, 0.24);
  }

  &[data-state="starting"] {
    background: #fbbf24;
    box-shadow: 0 0 10px rgba(251, 191, 36, 0.24);
  }

  &[data-state="error"] {
    background: #f87171;
    box-shadow: 0 0 10px rgba(248, 113, 113, 0.24);
  }

  &[data-state="running"] {
    background: #fcd34d;
    box-shadow: 0 0 10px rgba(252, 211, 77, 0.26);
  }

  &[data-state="completed"] {
    background: #34d399;
    box-shadow: 0 0 10px rgba(52, 211, 153, 0.28);
  }

  &[data-state="interrupted"] {
    background: #fbbf24;
    box-shadow: 0 0 10px rgba(251, 191, 36, 0.24);
  }

  &[data-live="true"][data-nosession="false"]:not([data-state="error"]) {
    background: #34d399;
    box-shadow: 0 0 10px rgba(52, 211, 153, 0.28);
  }

  &[data-live="true"][data-nosession="true"] {
    background: #fcd34d;
    box-shadow: 0 0 10px rgba(252, 211, 77, 0.24);
  }
`;

const EmptyThreads = styled.div`
  padding: 7px 8px;
  color: var(--thread-muted-soft);
  font-size: 12px;
  font-weight: 500;
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

function terminalMatchesThreadBinding(terminal, terminalBinding) {
  if (!terminal) {
    return false;
  }

  if (!terminalBinding) {
    return true;
  }

  const terminalIndexMatches = Number(terminal.terminalIndex) === Number(terminalBinding.terminalIndex);
  const instanceMatches = !terminalBinding.instanceId
    || Number(terminal.instanceId) === Number(terminalBinding.instanceId);
  const paneMatches = !terminalBinding.paneId || terminal.paneId === terminalBinding.paneId;
  return terminalIndexMatches && instanceMatches && paneMatches;
}

function getThreadState(thread, entry) {
  const providerBinding = getWorkspaceThreadProviderBinding(thread, thread?.currentAgent);
  const terminalBinding = providerBinding?.terminalBinding || thread?.terminalBinding;
  const turnState = getWorkspaceThreadTurnState(thread);
  const hasSession = getWorkspaceThreadHasSession(thread);
  const terminalIndex = terminalBinding?.terminalIndex ?? thread?.terminalIndex;
  const terminalKey = terminalIndex == null ? "" : String(terminalIndex);
  const mappedTerminal = terminalKey ? entry?.terminals?.[terminalKey] : null;
  const isTerminalMappedToThread = Boolean(
    mappedTerminal?.threadId === thread?.id
      && terminalMatchesThreadBinding(mappedTerminal, terminalBinding),
  );
  const isActiveTerminal = Boolean(
    isTerminalMappedToThread
      && ["active", "starting"].includes(String(mappedTerminal?.status || "").toLowerCase())
      && ["active", "starting"].includes(String(thread?.status || "").toLowerCase()),
  );
  const dotState = turnState === "error"
    ? "error"
    : hasSession && isActiveTerminal
      ? String(thread?.status || mappedTerminal?.status || "active").toLowerCase()
      : turnState === "running"
        ? "running"
        : turnState === "interrupted"
          ? "interrupted"
          : isActiveTerminal
            ? thread?.status || "idle"
            : "idle";

  return {
    canArchive: getWorkspaceThreadCanArchive(thread),
    isLive: Boolean(hasSession && isActiveTerminal),
    isNonSessionActive: !hasSession,
    label: getWorkspaceThreadLabel(thread),
    state: dotState,
  };
}

function WorkspaceThreadsOverlay({
  agentStatuses,
  composerDrafts,
  onArchiveThread,
  onClose,
  onActiveThreadChange,
  onCreateChat,
  onDraftInput,
  onSelectModel,
  onSelectThread,
  onSubmitMessage,
  onViewStateChange,
  open,
  selectedThreadId,
  selectedWorkspaceId,
  viewState,
  workspaceThreads,
  workspaces,
}) {
  const safeViewState = viewState && typeof viewState === "object" && !Array.isArray(viewState)
    ? viewState
    : {};
  const railCollapsed = safeViewState.railCollapsed === true;
  const newChatActive = safeViewState.newChatActive === true;
  const localSelection = {
    threadId: safeViewState.selectedThreadId || selectedThreadId || "",
    workspaceId: safeViewState.selectedWorkspaceId || selectedWorkspaceId || "",
  };
  const commitViewState = (workspaceId, patch = {}) => {
    const safeWorkspaceId = workspaceId
      || patch.workspaceId
      || patch.selectedWorkspaceId
      || localSelection.workspaceId
      || selectedWorkspaceId
      || "";
    if (!safeWorkspaceId) {
      return;
    }
    onViewStateChange?.(safeWorkspaceId, {
      ...patch,
      workspaceId: safeWorkspaceId,
    });
  };

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
    commitViewState(workspaceId, {
      newChatActive: false,
      selectedThreadId: threadId,
      selectedWorkspaceId: workspaceId,
    });
    onSelectThread?.(workspaceId, threadId);
  };
  const archiveThread = (event, workspaceId, threadId) => {
    event.preventDefault();
    event.stopPropagation();
    onArchiveThread?.(workspaceId, threadId);
  };
  const openNewChat = () => {
    const workspaceId = newChatWorkspace?.id || selectedWorkspaceId || activeWorkspaceId || "";
    commitViewState(workspaceId, {
      newChatActive: true,
      railCollapsed: false,
      selectedWorkspaceId: workspaceId,
    });
  };
  const createChat = async (request) => {
    const result = await onCreateChat?.({
      ...request,
      workspace: request?.workspace || newChatWorkspace,
    });
    const nextWorkspaceId = result?.workspaceId || result?.workspace?.id || newChatWorkspace?.id || "";
    const nextThreadId = result?.threadId || result?.thread?.id || "";
    if (nextWorkspaceId && nextThreadId) {
      commitViewState(nextWorkspaceId, {
        newChatActive: false,
        selectedThreadId: nextThreadId,
        selectedWorkspaceId: nextWorkspaceId,
      });
      onSelectThread?.(nextWorkspaceId, nextThreadId);
    }

    return result;
  };

  useEffect(() => {
    if (open && !hasVisibleThreads) {
      const workspaceId = newChatWorkspace?.id || selectedWorkspaceId || activeWorkspaceId || "";
      commitViewState(workspaceId, {
        newChatActive: true,
        selectedWorkspaceId: workspaceId,
      });
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
            onClick={() => commitViewState(activeWorkspaceId || selectedWorkspaceId, {
              railCollapsed: !railCollapsed,
            })}
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
                  <Edit aria-hidden="true" />
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
                  <CollapsedThreadList>
                    {threads.map((thread) => {
                      const isSelected = visibleActiveWorkspaceId === workspace.id
                        && visibleActiveThreadId === thread.id;
                      const { isLive, isNonSessionActive, label, state } = getThreadState(
                        thread,
                        workspaceThreads?.[workspace.id],
                      );
                      const title = `${workspace.name}: ${label}`;

                      return (
                        <CollapsedThreadButton
                          aria-label={title}
                          data-selected={isSelected ? "true" : "false"}
                          key={thread.id}
                          onClick={() => selectThread(workspace.id, thread.id)}
                          title={title}
                          type="button"
                        >
                          <TerminalStateDot
                            aria-hidden="true"
                            data-live={isLive ? "true" : "false"}
                            data-nosession={isNonSessionActive ? "true" : "false"}
                            data-state={state}
                          />
                        </CollapsedThreadButton>
                      );
                    })}
                  </CollapsedThreadList>
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
                        const {
                          canArchive,
                          isLive,
                          isNonSessionActive,
                          label,
                          state,
                        } = getThreadState(thread, workspaceThreads?.[workspace.id]);

                        return (
                          <ThreadRow
                            data-selected={isSelected ? "true" : "false"}
                            key={thread.id}
                            title={label}
                          >
                            <ThreadSelectButton
                              onClick={() => selectThread(workspace.id, thread.id)}
                              type="button"
                            >
                              <ThreadRowText>
                                <strong>{label}</strong>
                              </ThreadRowText>
                              <TerminalStateDot
                                aria-hidden="true"
                                data-live={isLive ? "true" : "false"}
                                data-nosession={isNonSessionActive ? "true" : "false"}
                                data-state={state}
                              />
                            </ThreadSelectButton>
                            {canArchive ? (
                              <ThreadArchiveButton
                                aria-label={`Archive ${label}`}
                                onClick={(event) => archiveThread(event, workspace.id, thread.id)}
                                title="Archive thread"
                                type="button"
                              >
                                <DeleteOutline aria-hidden="true" />
                              </ThreadArchiveButton>
                            ) : null}
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
          composerDrafts={composerDrafts}
          newChatActive={newChatActive}
          onCreateChat={createChat}
          onDraftInput={onDraftInput}
          onSelectModel={onSelectModel}
          onSubmitMessage={onSubmitMessage}
          thread={newChatActive ? null : activeThread}
          workspace={newChatActive ? newChatWorkspace : activeWorkspace}
          workspaceThreadEntry={workspaceThreads?.[newChatActive ? newChatWorkspace?.id || "" : activeWorkspaceId]}
        />
      </OverlayPanel>
    </OverlayRoot>
  );
}

export default memo(WorkspaceThreadsOverlay);

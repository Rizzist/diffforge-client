import { ChevronLeft } from "@styled-icons/material-rounded/ChevronLeft";
import { ChevronRight } from "@styled-icons/material-rounded/ChevronRight";
import { Close } from "@styled-icons/material-rounded/Close";
import { DeleteOutline } from "@styled-icons/material-rounded/DeleteOutline";
import { Edit } from "@styled-icons/fa-regular/Edit";
import { PushPin } from "@styled-icons/material-rounded/PushPin";
import { Search } from "@styled-icons/material-rounded/Search";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

import WorkspaceThreadDetail from "./WorkspaceThreadDetail.jsx";
import {
  getWorkspaceThreadCanArchive,
  getWorkspaceThreadCanPin,
  getWorkspaceThreadIsPinned,
  getWorkspaceThreadLabel,
  getWorkspaceThreadProviderBinding,
  getWorkspaceThreadTurnState,
} from "./workspaceThreads";

const THREAD_VIEW_STATE = {
  LIVE_SESSION: "live-session",
  LIVE_NO_SESSION: "live-no-session",
  DETACHED_SESSION: "detached-session",
  INACTIVE_NO_SESSION: "inactive-no-session",
};

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
  --thread-bg: #050505;
  --thread-bg-soft: #080808;
  --thread-card: rgba(32, 32, 32, 0.92);
  --thread-fg: #f4f7fa;
  --thread-muted: #a5a7ad;
  --thread-muted-soft: rgba(165, 167, 173, 0.58);
  --thread-border: rgba(255, 255, 255, 0.08);
  --thread-accent: rgba(255, 255, 255, 0.07);
  --thread-accent-strong: rgba(255, 255, 255, 0.1);
  --thread-primary: rgba(255, 255, 255, 0.1);
  --thread-primary-hover: rgba(255, 255, 255, 0.13);
  --thread-blue: #a8a8a8;
  --thread-ember: #dfa55a;
  --thread-green: #3ccb7f;
  --thread-red: #ef6b6b;
  color: var(--thread-fg);
  background:
    linear-gradient(rgba(255, 255, 255, 0.018) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255, 255, 255, 0.014) 1px, transparent 1px),
    #050505;
  background-size: 86px 86px, 86px 86px, auto;
  animation: ${overlayFadeIn} 140ms ease both;
  backdrop-filter: blur(10px);
  pointer-events: auto;
  user-select: text;
`;

const OverlayPanel = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(188px, 220px) minmax(0, 1fr);
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background:
    linear-gradient(90deg, rgba(255, 255, 255, 0.018), transparent 28%),
    var(--thread-bg);
  box-shadow: none;
  animation: ${overlayPanelIn} 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
  transition: grid-template-columns 180ms cubic-bezier(0.16, 1, 0.3, 1);

  &[data-rail-collapsed="true"] {
    grid-template-columns: 48px minmax(0, 1fr);
  }

  @media (max-width: 760px) {
    grid-template-columns: minmax(180px, 58vw) minmax(0, 1fr);

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
  border-right: 0;
  background-color: #101820;
  background-image: url("/textures/thread-rail-carbon-fiber.png");
  background-repeat: repeat;
  box-shadow: none;
`;

const DrawerToggle = styled.button`
  position: absolute;
  top: 12px;
  right: -13px;
  z-index: 4;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  color: #d6d6d6;
  background: rgba(45, 45, 45, 0.96);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.045),
    0 10px 22px rgba(0, 0, 0, 0.32);
  transition:
    border-color 130ms ease,
    color 130ms ease,
    background 130ms ease,
    transform 130ms ease;

  &:hover {
    border-color: rgba(255, 255, 255, 0.16);
    color: var(--thread-fg);
    background: rgba(58, 58, 58, 0.98);
    transform: translateX(1px);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.22);
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
  gap: 12px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 26px 12px 16px;
  background: transparent;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(170, 170, 170, 0.16);
  }
`;

const RailActionStack = styled.div`
  display: grid;
  min-width: 0;
  padding-bottom: 10px;
  align-content: start;
  gap: 2px;
`;

const RailActionButton = styled.button`
  display: flex;
  min-width: 0;
  height: 30px;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 10px;
  color: #e9e9e9;
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
    border-color: transparent;
    background: rgba(255, 255, 255, 0.095);
    opacity: 1;
  }

  &:disabled {
    color: rgba(233, 233, 233, 0.72);
    opacity: 1;
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
    font-size: 12px;
    font-weight: 480;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ThreadSearchPanel = styled.div`
  display: grid;
  min-width: 0;
  gap: 6px;
  padding: 0 0 10px;
`;

const ThreadSearchField = styled.div`
  display: grid;
  min-width: 0;
  height: 31px;
  grid-template-columns: 18px minmax(0, 1fr) 20px;
  align-items: center;
  gap: 5px;
  padding: 0 5px 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 9px;
  color: rgba(233, 233, 233, 0.78);
  background: rgba(0, 0, 0, 0.18);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.025);

  &:focus-within {
    border-color: rgba(255, 255, 255, 0.2);
    color: var(--thread-fg);
    background: rgba(0, 0, 0, 0.24);
  }

  svg {
    width: 14px;
    height: 14px;
  }
`;

const ThreadSearchInput = styled.input`
  min-width: 0;
  border: 0;
  color: var(--thread-fg);
  background: transparent;
  font: inherit;
  font-size: 12px;
  font-weight: 480;
  line-height: 1.2;
  outline: 0;

  &::placeholder {
    color: rgba(233, 233, 233, 0.42);
  }
`;

const ThreadSearchClearButton = styled.button`
  display: grid;
  width: 20px;
  height: 20px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: rgba(233, 233, 233, 0.68);
  background: transparent;
  opacity: 0;
  pointer-events: none;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  &[data-visible="true"] {
    opacity: 1;
    pointer-events: auto;
  }

  &:hover {
    color: var(--thread-fg);
    background: rgba(255, 255, 255, 0.09);
  }

  &:focus-visible {
    opacity: 1;
    outline: 2px solid rgba(255, 255, 255, 0.22);
    outline-offset: 1px;
  }

  svg {
    width: 13px;
    height: 13px;
  }
`;

const ThreadSearchSummary = styled.div`
  min-width: 0;
  padding: 0 6px;
  color: rgba(225, 225, 225, 0.48);
  font-size: 11px;
  font-weight: 460;
  line-height: 1.2;
`;

const WorkspaceGroup = styled.section`
  display: grid;
  min-width: 0;
  gap: 5px;
`;

const WorkspaceTopline = styled.div`
  min-width: 0;
  padding: 0 5px;
  color: rgba(225, 225, 225, 0.52);
  font-size: 11px;
  font-weight: 460;
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
  gap: 1px;
  margin: 0;
  padding: 0;
  border-left: 0;
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
  padding: 28px 8px 10px;
  background-color: #101820;
  background-image: url("/textures/thread-rail-carbon-fiber.png");
  background-repeat: repeat;
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
  border-radius: 10px;
  color: #e9e9e9;
  background: transparent;
  opacity: 1;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  &:hover:not(:disabled),
  &[data-active="true"] {
    color: var(--thread-fg);
    background: rgba(255, 255, 255, 0.095);
    opacity: 1;
  }

  &:disabled {
    color: rgba(233, 233, 233, 0.62);
    opacity: 1;
    cursor: not-allowed;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

const CollapsedThreadsRegion = styled.div`
  display: grid;
  min-width: 0;
  max-height: 0;
  gap: 8px;
  overflow: hidden;
  opacity: 0;
  pointer-events: none;
  transition:
    max-height 160ms ease,
    opacity 140ms ease,
    visibility 0s linear 140ms;
  visibility: hidden;
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
    border-color: rgba(255, 255, 255, 0.16);
    background: var(--thread-primary);
  }

  &:hover {
    background: var(--thread-accent);
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.22);
    outline-offset: 2px;
  }
`;

const ThreadRow = styled.div`
  position: relative;
  display: grid;
  min-width: 0;
  height: 27px;
  grid-template-columns: minmax(0, 1fr) 15px;
  align-items: center;
  gap: 3px;
  padding: 0 4px 0 7px;
  border: 1px solid transparent;
  border-radius: 8px;
  color: rgba(236, 236, 236, 0.86);
  background: transparent;
  font: inherit;
  text-align: left;
  transition:
    background 130ms ease,
    border-color 130ms ease,
    color 130ms ease;

  &[data-selected="true"] {
    border-color: transparent;
    color: var(--thread-fg);
    background: rgba(255, 255, 255, 0.105);
  }

  &:hover {
    color: var(--thread-fg);
    border-color: transparent;
    background: rgba(255, 255, 255, 0.075);
  }

  &[data-selected="true"]:hover {
    background: rgba(255, 255, 255, 0.13);
  }
`;

const ThreadSelectButton = styled.button`
  display: flex;
  min-width: 0;
  height: 100%;
  align-items: center;
  justify-content: flex-start;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;

  strong {
    min-width: 0;
    overflow: hidden;
    font-size: 11px;
    font-weight: 480;
    letter-spacing: 0;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:focus-visible {
    outline: 2px solid rgba(255, 255, 255, 0.22);
    outline-offset: 2px;
  }
`;

const ThreadRowText = styled.span`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  transition: padding-left 130ms ease;

  ${ThreadRow}[data-can-pin="true"]:hover &,
  ${ThreadRow}[data-pinned="true"] & {
    padding-left: 17px;
  }
`;

const ThreadPinButton = styled.button`
  position: absolute;
  left: 3px;
  top: 50%;
  z-index: 2;
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: rgba(244, 244, 244, 0.74);
  background: rgba(58, 58, 58, 0.98);
  opacity: 0;
  transform: translateY(-50%);
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease;

  ${ThreadRow}:hover &,
  ${ThreadRow}:focus-within &,
  ${ThreadRow}[data-pinned="true"] & {
    opacity: 1;
  }

  ${ThreadRow}[data-pinned="true"] & {
    color: #f2c24e;
    background: rgba(62, 52, 30, 0.9);
  }

  &:hover {
    color: #ffe39a;
    background: rgba(84, 68, 34, 0.98);
  }

  &:focus-visible {
    opacity: 1;
    outline: 2px solid rgba(242, 194, 78, 0.48);
    outline-offset: 1px;
  }

  svg {
    width: 12px;
    height: 12px;
  }
`;

const ThreadStatusSlot = styled.span`
  position: relative;
  display: grid;
  width: 15px;
  height: 18px;
  place-items: center;
  justify-self: end;
`;

const ThreadArchiveButton = styled.button`
  position: absolute;
  inset: 0;
  z-index: 1;
  display: grid;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 7px;
  color: rgba(244, 244, 244, 0.72);
  background: rgba(58, 58, 58, 0.98);
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
    color: #ffd6d6;
    background: rgba(239, 107, 107, 0.14);
  }

  &:focus-visible {
    opacity: 1;
    outline: 2px solid rgba(248, 113, 113, 0.48);
    outline-offset: 1px;
  }

  svg {
    width: 12px;
    height: 12px;
  }
`;

const TerminalStateDot = styled.span`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 99px;
  background: #7a8493;

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_SESSION}"] {
    background: var(--thread-green);
    box-shadow: 0 0 11px rgba(60, 203, 127, 0.32);
  }

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_NO_SESSION}"] {
    background: #fcd34d;
    box-shadow: 0 0 10px rgba(252, 211, 77, 0.24);
  }

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_SESSION}"][data-state="starting"] {
    background: #dfa55a;
    box-shadow: 0 0 11px rgba(223, 165, 90, 0.28);
  }

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_SESSION}"][data-state="error"] {
    background: var(--thread-red);
    box-shadow: 0 0 11px rgba(239, 107, 107, 0.28);
  }

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_SESSION}"][data-state="running"] {
    background: #f2c24e;
    box-shadow: 0 0 11px rgba(242, 194, 78, 0.3);
  }

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_SESSION}"][data-state="completed"] {
    background: var(--thread-green);
    box-shadow: 0 0 11px rgba(60, 203, 127, 0.32);
  }

  &[data-view-state="${THREAD_VIEW_STATE.LIVE_SESSION}"][data-state="interrupted"] {
    background: #dfa55a;
    box-shadow: 0 0 11px rgba(223, 165, 90, 0.28);
  }
`;

const EmptyThreads = styled.div`
  padding: 4px 10px;
  color: var(--thread-muted-soft);
  font-size: 12px;
  font-weight: 460;
`;

function getThreadRows(workspaceThreads, workspaceId) {
  const entry = workspaceThreads?.[workspaceId];
  if (!entry) {
    return [];
  }

  return (entry.threadOrder || [])
    .map((threadId) => entry.threads?.[threadId])
    .filter((thread) => thread?.materialized)
    .map((thread, index) => ({
      thread,
      threadState: getThreadState(thread, entry),
      index,
    }))
    .filter(({ threadState }) => (
      threadState.threadViewState !== THREAD_VIEW_STATE.INACTIVE_NO_SESSION
    ))
    .map(({ thread, index }) => ({ index, thread }))
    .sort((left, right) => {
      const leftPinned = getWorkspaceThreadIsPinned(left.thread);
      const rightPinned = getWorkspaceThreadIsPinned(right.thread);
      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1;
      }
      return left.index - right.index;
    })
    .map(({ thread }) => thread);
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
  const hasSession = Boolean(thread?.transcriptSessionId || providerBinding?.nativeSessionId);
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
  let threadViewState = THREAD_VIEW_STATE.INACTIVE_NO_SESSION;
  if (isActiveTerminal) {
    threadViewState = hasSession
      ? THREAD_VIEW_STATE.LIVE_SESSION
      : THREAD_VIEW_STATE.LIVE_NO_SESSION;
  } else if (hasSession) {
    threadViewState = THREAD_VIEW_STATE.DETACHED_SESSION;
  }

  const dotState = isActiveTerminal
    ? String(thread?.status || mappedTerminal?.status || "active").toLowerCase()
    : turnState === "error"
      ? "error"
      : turnState === "running"
        ? "running"
        : turnState === "interrupted"
          ? "interrupted"
          : "idle";

  return {
    canArchive: getWorkspaceThreadCanArchive(thread),
    canPin: getWorkspaceThreadCanPin(thread),
    isLive: Boolean(hasSession && isActiveTerminal),
    isNonSessionActive: threadViewState === THREAD_VIEW_STATE.LIVE_NO_SESSION,
    label: getWorkspaceThreadLabel(thread),
    pinned: getWorkspaceThreadIsPinned(thread),
    state: dotState,
    threadViewState,
  };
}

function isThreadVisibleInOverlay(thread, entry) {
  return Boolean(
    thread?.materialized
      && getThreadState(thread, entry).threadViewState !== THREAD_VIEW_STATE.INACTIVE_NO_SESSION,
  );
}

function normalizeThreadSearchText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function addThreadSearchPart(parts, value) {
  const text = normalizeThreadSearchText(value);
  if (text) {
    parts.push(text);
  }
}

function getThreadSearchText(thread, workspace) {
  const metadataParts = [];
  const messageParts = [];
  const providerBindings = thread?.providerBindings && typeof thread.providerBindings === "object"
    ? Object.values(thread.providerBindings)
    : [];

  addThreadSearchPart(metadataParts, workspace?.name);
  addThreadSearchPart(metadataParts, thread?.id);
  addThreadSearchPart(metadataParts, thread?.title);
  addThreadSearchPart(metadataParts, thread?.sessionName);
  addThreadSearchPart(metadataParts, thread?.currentAgent);
  addThreadSearchPart(metadataParts, thread?.preferredAgent);
  addThreadSearchPart(metadataParts, thread?.slotKey);
  addThreadSearchPart(metadataParts, thread?.status);
  addThreadSearchPart(metadataParts, thread?.transcriptSessionId);
  addThreadSearchPart(metadataParts, thread?.pendingPrompt?.text);
  addThreadSearchPart(metadataParts, thread?.pendingPrompt?.message);
  addThreadSearchPart(metadataParts, thread?.latestTurn?.state);
  addThreadSearchPart(metadataParts, thread?.latestTurn?.error);
  addThreadSearchPart(metadataParts, getWorkspaceThreadLabel(thread));

  providerBindings.forEach((binding) => {
    addThreadSearchPart(metadataParts, binding?.agentId);
    addThreadSearchPart(metadataParts, binding?.modelId);
    addThreadSearchPart(metadataParts, binding?.nativeSessionId);
    addThreadSearchPart(metadataParts, binding?.nativeSessionTitle);
    addThreadSearchPart(metadataParts, binding?.status);
  });

  (Array.isArray(thread?.messages) ? thread.messages : []).forEach((message) => {
    addThreadSearchPart(messageParts, message?.role);
    addThreadSearchPart(messageParts, message?.title);
    addThreadSearchPart(messageParts, message?.text);
  });

  return {
    label: normalizeThreadSearchText(getWorkspaceThreadLabel(thread)),
    message: messageParts.join(" "),
    metadata: metadataParts.join(" "),
  };
}

function getThreadSearchScore(thread, workspace, query) {
  const normalizedQuery = normalizeThreadSearchText(query);
  if (!normalizedQuery) {
    return 0;
  }

  const searchText = getThreadSearchText(thread, workspace);
  const haystack = `${searchText.metadata} ${searchText.message}`;
  if (!haystack) {
    return 0;
  }

  const tokens = normalizedQuery.split(" ").filter(Boolean);
  if (!tokens.every((token) => haystack.includes(token))) {
    return 0;
  }

  let score = 100;
  if (searchText.label === normalizedQuery) {
    score += 900;
  } else if (searchText.label.startsWith(normalizedQuery)) {
    score += 760;
  } else if (searchText.label.includes(normalizedQuery)) {
    score += 620;
  }

  if (searchText.metadata.includes(normalizedQuery)) {
    score += 360;
  }
  if (searchText.message.includes(normalizedQuery)) {
    score += 180;
  }
  if (getWorkspaceThreadIsPinned(thread)) {
    score += 20;
  }

  return score;
}

function countThreadRows(threadGroups) {
  return (Array.isArray(threadGroups) ? threadGroups : [])
    .reduce((total, group) => total + (Array.isArray(group?.threads) ? group.threads.length : 0), 0);
}

function WorkspaceThreadsOverlay({
  agentStatuses,
  composerAttachments,
  composerDrafts,
  onArchiveThread,
  onClose,
  onActiveThreadChange,
  onCreateChat,
  onDraftInput,
  onSelectModel,
  onSelectThread,
  onSubmitMessage,
  onTogglePinnedThread,
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
  const searchInputRef = useRef(null);
  const [searchActive, setSearchActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const normalizedSearchQuery = normalizeThreadSearchText(deferredSearchQuery);
  const searchVisible = searchActive || normalizeThreadSearchText(searchQuery).length > 0;
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
  const closeSearch = () => {
    setSearchActive(false);
    setSearchQuery("");
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (searchVisible) {
          closeSearch();
          return;
        }
        onClose?.();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open, searchVisible]);

  useEffect(() => {
    if (open) {
      return;
    }

    closeSearch();
  }, [open]);

  useEffect(() => {
    if (!open || !searchActive || railCollapsed) {
      return undefined;
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [open, railCollapsed, searchActive]);

  const collapsedThreadGroups = useMemo(() => (workspaces || [])
    .map((workspace) => ({
      threads: getThreadRows(workspaceThreads, workspace.id),
      workspace,
    }))
    .filter((group) => group.threads.length > 0), [workspaceThreads, workspaces]);
  const threadGroups = useMemo(() => (workspaces || []).map((workspace) => ({
    threads: getThreadRows(workspaceThreads, workspace.id),
    workspace,
  })), [workspaceThreads, workspaces]);
  const searchedThreadGroups = useMemo(() => {
    if (!normalizedSearchQuery) {
      return threadGroups;
    }

    return threadGroups
      .map(({ threads, workspace }) => ({
        threads: threads
          .map((thread, index) => ({
            index,
            score: getThreadSearchScore(thread, workspace, normalizedSearchQuery),
            thread,
          }))
          .filter((result) => result.score > 0)
          .sort((left, right) => right.score - left.score || left.index - right.index)
          .map((result) => result.thread),
        workspace,
      }))
      .filter((group) => group.threads.length > 0);
  }, [normalizedSearchQuery, threadGroups]);
  const visibleThreadGroups = searchVisible ? searchedThreadGroups : threadGroups;
  const totalThreadCount = useMemo(() => countThreadRows(threadGroups), [threadGroups]);
  const visibleThreadCount = useMemo(() => countThreadRows(visibleThreadGroups), [visibleThreadGroups]);
  const hasVisibleThreads = collapsedThreadGroups.length > 0;
  const selectedThreadFromLocal = workspaceThreads?.[localSelection.workspaceId]
    ?.threads?.[localSelection.threadId];
  const selectedThreadEntry = workspaceThreads?.[localSelection.workspaceId];
  const fallbackSelection = collapsedThreadGroups[0]?.threads?.[0]
    ? {
      thread: collapsedThreadGroups[0].threads[0],
      workspace: collapsedThreadGroups[0].workspace,
    }
    : { thread: null, workspace: null };
  const activeThread = isThreadVisibleInOverlay(selectedThreadFromLocal, selectedThreadEntry)
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
  const togglePinnedThread = (event, workspaceId, threadId) => {
    event.preventDefault();
    event.stopPropagation();
    onTogglePinnedThread?.(workspaceId, threadId);
  };
  const openNewChat = () => {
    closeSearch();
    const workspaceId = newChatWorkspace?.id || selectedWorkspaceId || activeWorkspaceId || "";
    commitViewState(workspaceId, {
      newChatActive: true,
      railCollapsed: false,
      selectedWorkspaceId: workspaceId,
    });
  };
  const openSearch = () => {
    setSearchActive(true);
    const workspaceId = activeWorkspaceId || selectedWorkspaceId || localSelection.workspaceId || "";
    if (railCollapsed) {
      commitViewState(workspaceId, {
        railCollapsed: false,
      });
    }
    window.setTimeout(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }, 0);
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

  const searchSummary = normalizedSearchQuery
    ? `${visibleThreadCount} ${visibleThreadCount === 1 ? "result" : "results"}`
    : `${totalThreadCount} ${totalThreadCount === 1 ? "thread" : "threads"}`;

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
                  data-active={searchVisible ? "true" : "false"}
                  onClick={openSearch}
                  title="Search"
                  type="button"
                >
                  <Search aria-hidden="true" />
                </CollapsedRailActionButton>
              </CollapsedRailActionStack>
              <CollapsedThreadsRegion aria-hidden="true">
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
                        const {
                          isLive,
                          isNonSessionActive,
                          label,
                          state,
                          threadViewState,
                        } = getThreadState(
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
                              data-view-state={threadViewState}
                            />
                          </CollapsedThreadButton>
                        );
                      })}
                    </CollapsedThreadList>
                  </CollapsedWorkspaceGroup>
                ))}
              </CollapsedThreadsRegion>
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
                <RailActionButton
                  data-active={searchVisible ? "true" : "false"}
                  onClick={openSearch}
                  title="Search"
                  type="button"
                >
                  <Search aria-hidden="true" />
                  <span>Search</span>
                </RailActionButton>
              </RailActionStack>
              {searchVisible ? (
                <ThreadSearchPanel>
                  <ThreadSearchField>
                    <Search aria-hidden="true" />
                    <ThreadSearchInput
                      aria-label="Search threads"
                      onChange={(event) => setSearchQuery(event.target.value)}
                      placeholder="Search threads"
                      ref={searchInputRef}
                      spellCheck={false}
                      type="search"
                      value={searchQuery}
                    />
                    <ThreadSearchClearButton
                      aria-label="Clear search"
                      data-visible={searchVisible ? "true" : "false"}
                      onClick={closeSearch}
                      title="Clear search"
                      type="button"
                    >
                      <Close aria-hidden="true" />
                    </ThreadSearchClearButton>
                  </ThreadSearchField>
                  <ThreadSearchSummary>{searchSummary}</ThreadSearchSummary>
                </ThreadSearchPanel>
              ) : null}
              {searchVisible && normalizedSearchQuery && visibleThreadCount === 0 ? (
                <EmptyThreads>No matching threads</EmptyThreads>
              ) : visibleThreadGroups.map(({ threads, workspace }) => {
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
                          canPin,
                          isLive,
                          isNonSessionActive,
                          label,
                          pinned,
                          state,
                          threadViewState,
                        } = getThreadState(thread, workspaceThreads?.[workspace.id]);

                        return (
                          <ThreadRow
                            data-can-pin={canPin ? "true" : "false"}
                            data-can-archive={canArchive ? "true" : "false"}
                            data-pinned={pinned ? "true" : "false"}
                            data-selected={isSelected ? "true" : "false"}
                            key={thread.id}
                            title={label}
                          >
                            {canPin ? (
                              <ThreadPinButton
                                aria-label={pinned ? `Unpin ${label}` : `Pin ${label}`}
                                onClick={(event) => togglePinnedThread(event, workspace.id, thread.id)}
                                title={pinned ? "Unpin thread" : "Pin thread"}
                                type="button"
                              >
                                <PushPin aria-hidden="true" />
                              </ThreadPinButton>
                            ) : null}
                            <ThreadSelectButton
                              onClick={() => selectThread(workspace.id, thread.id)}
                              type="button"
                            >
                              <ThreadRowText>
                                <strong>{label}</strong>
                              </ThreadRowText>
                            </ThreadSelectButton>
                            <ThreadStatusSlot>
                          <TerminalStateDot
                            aria-hidden="true"
                            data-live={isLive ? "true" : "false"}
                            data-nosession={isNonSessionActive ? "true" : "false"}
                            data-state={state}
                            data-view-state={threadViewState}
                          />
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
                            </ThreadStatusSlot>
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
          composerAttachments={composerAttachments}
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

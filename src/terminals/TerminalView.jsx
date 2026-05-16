import { invoke } from "@tauri-apps/api/core";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import {
  ButtonForgeIcon,
  DashboardTitle,
  ForgeWorkspace,
  FormMessage,
  Kicker,
  PageSubline,
  PrimaryButton,
  ResizeHandle,
  ResizePanel,
  ResizePanelGroup,
  SettingsLabel,
  SetupField,
  SetupHeader,
  SetupInput,
  WorkspaceSetupPanel,
  WorkspaceTerminalPanels,
} from "../app/appStyles";
import FilesWorkspaceView from "../files/FilesWorkspaceView.jsx";
import WebWorkspaceView from "../web/WebWorkspaceView.jsx";
import WorkspaceTerminal, {
  getTerminalPaneMinSizePercent,
  getWorkspaceTerminalPaneId,
} from "./WorkspaceTerminal.jsx";

const TERMINAL_FULLSCREEN_TRANSITION_MS = 190;
const TERMINAL_FULLSCREEN_DEFAULT_MOTION = {
  originScaleX: 1,
  originScaleY: 1,
  originX: 0,
  originY: 0,
  phase: "idle",
};

const TerminalWorkspaceMain = styled.div`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
`;

const TerminalPanelAnchor = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: #020304;
  pointer-events: none;

  &[data-terminal-drag-placeholder="true"]::after {
    position: absolute;
    inset: 8px;
    border: 1px dashed rgba(148, 163, 184, 0.46);
    border-radius: 8px;
    background: rgba(148, 163, 184, 0.08);
    box-shadow: inset 0 0 20px rgba(148, 163, 184, 0.08);
    content: "";
  }
`;

const TerminalSurfaceLayer = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  overflow: visible;
  background: #020304;
  pointer-events: none;
`;

const TerminalSurfaceSlot = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: var(--terminal-slot-width, 0px);
  height: var(--terminal-slot-height, 0px);
  min-width: 0;
  min-height: 0;
  overflow: visible;
  background: #020304;
  pointer-events: auto;
  transform: translate3d(var(--terminal-slot-x, 0px), var(--terminal-slot-y, 0px), 0);
  transition:
    width 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
    height 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
    transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
    filter 140ms ease,
    opacity 140ms ease;
  will-change: width, height, transform;

  &[data-terminal-hidden="true"] {
    visibility: hidden;
    pointer-events: none;
  }

  &[data-terminal-dragging="true"] {
    z-index: 260;
    pointer-events: none;
    transition: none;
    filter: drop-shadow(0 28px 48px rgba(0, 0, 0, 0.46));
  }

  &[data-terminal-dragging="true"] > * {
    transform: scale(1.012);
    transform-origin: center;
  }

  &[data-terminal-fullscreen="true"] {
    z-index: 240;
  }
`;

const TODO_QUEUE_STORAGE_PREFIX = "diffforge.todoQueue.v1";
const TODO_QUEUE_VISIBLE_MIN_WIDTH = 1120;
const TODO_QUEUE_MAX_ITEMS = 120;
const TODO_QUEUE_MAX_TEXT_LENGTH = 4000;
const TODO_QUEUE_MAX_NOTE_TEXT_LENGTH = 24000;
const TODO_QUEUE_NOTE_LINE_THRESHOLD = 6;
const TODO_QUEUE_NOTE_TITLE_LENGTH = 42;
const TODO_QUEUE_MAX_PASTE_IMAGES = 8;
const TODO_QUEUE_IMAGE_TERMINALS = new Set(["codex", "claude", "opencode"]);
const WORKSPACE_TOOL_TABS = [
  { id: "orchestrator", label: "Orchestrator" },
  { id: "files", label: "Files" },
  { id: "web", label: "Web" },
];

const TodoQueueSurface = styled.aside`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  padding: 0;
  border-left: 1px solid rgba(230, 236, 245, 0.08);
  color: #e8eef8;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012)),
    rgba(5, 8, 13, 0.96);
  overflow: hidden;
`;

const OrchestratorTopNav = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  min-height: 40px;
  border-bottom: 1px solid rgba(230, 236, 245, 0.08);
  background: rgba(2, 4, 8, 0.44);
`;

const OrchestratorTopButton = styled.button`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-right: 1px solid rgba(230, 236, 245, 0.07);
  color: #9eabbc;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 780;
  line-height: 1;
  outline: none;
  transition:
    background 140ms ease,
    color 140ms ease,
    opacity 140ms ease;

  &:last-child {
    border-right: 0;
  }

  &[data-active="true"] {
    color: #f7fafc;
    background: rgba(47, 128, 255, 0.13);
  }

  &:disabled {
    cursor: default;
    opacity: 0.4;
  }

  &:not(:disabled):hover {
    color: #f7fafc;
    background: rgba(47, 128, 255, 0.16);
  }
`;

const OrchestratorView = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr);
`;

const OrchestratorVoiceArea = styled.div`
  display: grid;
  min-height: 116px;
  place-items: center;
  border-bottom: 1px solid rgba(230, 236, 245, 0.08);
  background:
    radial-gradient(circle at center, rgba(98, 160, 255, 0.14), transparent 62%),
    rgba(2, 4, 8, 0.26);
`;

const OrchestratorVoiceButton = styled.button`
  display: grid;
  width: 74px;
  height: 74px;
  place-items: center;
  border: 1px solid rgba(138, 216, 255, 0.28);
  border-radius: 999px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.06), rgba(255, 255, 255, 0.015)),
    rgba(5, 10, 18, 0.92);
  box-shadow:
    0 14px 34px rgba(0, 0, 0, 0.32),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  outline: none;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    transform 150ms ease;

  &:hover {
    border-color: rgba(138, 216, 255, 0.46);
    box-shadow:
      0 16px 38px rgba(0, 0, 0, 0.36),
      0 0 22px rgba(47, 128, 255, 0.12),
      inset 0 1px 0 rgba(255, 255, 255, 0.1);
  }

  &:active {
    transform: scale(0.98);
  }
`;

const OrchestratorVoiceLogo = styled.img.attrs({
  alt: "",
  draggable: false,
  src: "/logo.webp",
})`
  width: 48px;
  height: 48px;
  object-fit: contain;
  user-select: none;
`;

const OrchestratorSectionTabs = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 38px;
  border-bottom: 1px solid rgba(230, 236, 245, 0.08);
`;

const OrchestratorSectionButton = styled.button`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-right: 1px solid rgba(230, 236, 245, 0.07);
  color: #8996a8;
  background: rgba(2, 4, 8, 0.3);
  font-size: 11px;
  font-weight: 780;
  outline: none;
  transition:
    background 140ms ease,
    color 140ms ease;

  &:last-child {
    border-right: 0;
  }

  &[data-active="true"] {
    color: #f7fafc;
    background: rgba(47, 128, 255, 0.12);
  }

  &:hover {
    color: #f7fafc;
    background: rgba(47, 128, 255, 0.16);
  }
`;

const OrchestratorContent = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const OrchestratorHistoryView = styled.div`
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  padding: 18px;
  color: #7f8da1;
  background: rgba(2, 4, 8, 0.76);
  font-size: 12px;
  font-weight: 720;
`;

const WorkspaceToolSurface = styled.div`
  display: grid;
  width: 100%;
  height: 100%;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #05070a;

  > * {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  &[data-tool="files"] {
    background: var(--files-vscode-editor, #030405);
  }
`;

const TodoQueueComposer = styled.form`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
`;

const TodoQueueBoard = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
`;

const TodoQueueTextArea = styled.textarea`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  resize: none;
  padding: calc(8px + var(--todo-list-offset, 0px)) 36px 8px 32px;
  border: 0;
  border-radius: 0;
  color: #f7fafc;
  background: rgba(2, 4, 8, 0.76);
  font: 12px/1.45 "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
  outline: none;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    background 150ms ease,
    padding 150ms ease;

  &::placeholder {
    color: rgba(166, 178, 194, 0.58);
  }

  &:focus {
    border-color: rgba(98, 160, 255, 0.46);
    background: rgba(2, 5, 10, 0.94);
    box-shadow:
      0 0 0 1px rgba(98, 160, 255, 0.12),
      0 0 22px rgba(47, 128, 255, 0.08);
  }
`;

const TodoQueueList = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 2;
  display: grid;
  align-content: start;
  max-height: calc(100% - 42px);
  gap: 0;
  overflow-x: hidden;
  overflow-y: auto;
`;

const TodoQueueItemCard = styled.article`
  position: relative;
  display: grid;
  min-height: 35px;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: start;
  padding: 8px 36px 8px 12px;
  border: 0;
  border-radius: 0;
  color: #eef4fb;
  background: transparent;
  cursor: grab;
  touch-action: none;
  transition:
    background 150ms ease,
    opacity 150ms ease,
    transform 150ms ease;
  user-select: none;

  &::before {
    content: "\\2022";
    color: #8bb8ff;
    font-size: 13px;
    font-weight: 900;
    line-height: 1.45;
  }

  &:hover {
    background: rgba(47, 128, 255, 0.1);
  }

  &:active {
    cursor: grabbing;
  }

  &[data-todo-dragging="true"] {
    opacity: 0.42;
    transform: scale(0.985);
  }

  &[data-todo-editing="true"] {
    padding-right: 12px;
    cursor: text;
    user-select: text;
  }

  &[data-todo-reordering="true"] {
    background: rgba(47, 128, 255, 0.14);
  }

  &:hover [data-todo-delete="true"],
  &:focus-within [data-todo-delete="true"] {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
`;

const TodoQueueItemContent = styled.div`
  display: grid;
  min-width: 0;
  align-items: center;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr);

  &[data-has-preview="true"] {
    grid-template-columns: auto minmax(0, 1fr);
  }
`;

const TodoQueueItemImageFrame = styled.div`
  display: grid;
  width: 128px;
  height: 128px;
  place-items: center;
  align-self: center;
  overflow: hidden;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 8px;
  background: rgba(2, 4, 8, 0.34);
`;

const TodoQueueItemImage = styled.img.attrs({ draggable: false })`
  display: block;
  max-width: 128px;
  max-height: 128px;
  object-fit: contain;
  user-select: none;
`;

const TodoQueueItemNoteFrame = styled.div`
  display: grid;
  width: 128px;
  height: 128px;
  grid-template-rows: auto minmax(0, 1fr);
  align-self: center;
  gap: 10px;
  overflow: hidden;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(98, 160, 255, 0.12), rgba(255, 255, 255, 0.025)),
    rgba(2, 4, 8, 0.34);
`;

const TodoQueueItemNoteTitle = styled.div`
  min-width: 0;
  overflow: hidden;
  color: #edf5ff;
  font-size: 10px;
  font-weight: 820;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TodoQueueItemNoteIcon = styled.div`
  position: relative;
  width: 42px;
  height: 52px;
  align-self: center;
  justify-self: center;
  border: 1px solid rgba(138, 216, 255, 0.42);
  border-radius: 5px;
  background: rgba(13, 17, 23, 0.7);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);

  &::before {
    position: absolute;
    top: -1px;
    right: -1px;
    width: 14px;
    height: 14px;
    border-bottom: 1px solid rgba(138, 216, 255, 0.32);
    border-left: 1px solid rgba(138, 216, 255, 0.32);
    border-bottom-left-radius: 4px;
    background: rgba(98, 160, 255, 0.18);
    content: "";
  }

  &::after {
    position: absolute;
    right: 9px;
    bottom: 11px;
    left: 9px;
    height: 16px;
    border-top: 1px solid rgba(237, 245, 255, 0.44);
    border-bottom: 1px solid rgba(237, 245, 255, 0.28);
    box-shadow: 0 7px 0 rgba(237, 245, 255, 0.22);
    content: "";
  }
`;

const TodoQueueItemText = styled.p`
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: #edf5ff;
  font-size: 12px;
  font-weight: 690;
  line-height: 1.45;
`;

const TodoQueueItemEditor = styled.textarea`
  width: 100%;
  min-height: 86px;
  max-height: 240px;
  resize: vertical;
  padding: 0;
  border: 0;
  color: #f7fafc;
  background: transparent;
  outline: none;
  font-size: 12px;
  font-weight: 690;
  line-height: 1.45;
  font-family: inherit;
`;

const TodoQueueDraftBullet = styled.span`
  position: absolute;
  top: calc(8px + var(--todo-list-offset, 0px));
  left: 12px;
  z-index: 1;
  color: #8bb8ff;
  font-size: 13px;
  font-weight: 900;
  line-height: 1.45;
  pointer-events: none;
  transition: top 150ms ease;

  &::before {
    content: "\\2022";
  }
`;

const TodoQueueDeleteButton = styled.button`
  position: absolute;
  top: 6px;
  right: 7px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid rgba(239, 107, 107, 0.14);
  border-radius: 6px;
  color: #ffd0d0;
  background: rgba(127, 29, 29, 0.18);
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition:
    background 140ms ease,
    border-color 140ms ease,
    opacity 140ms ease,
    transform 140ms ease;

  &:hover {
    border-color: rgba(239, 107, 107, 0.34);
    background: rgba(239, 107, 107, 0.16);
  }
`;

const TodoQueueError = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 3;
  border: 1px solid rgba(248, 113, 113, 0.26);
  border-radius: 8px;
  padding: 8px 9px;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.18);
  font-size: 11px;
  font-weight: 720;
  line-height: 1.4;
`;

const TodoDragPreview = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  z-index: 6000;
  display: grid;
  width: min(var(--todo-drag-width, 280px), calc(100vw - 24px));
  max-height: min(260px, calc(100vh - 24px));
  gap: 7px;
  overflow: hidden;
  padding: 10px;
  border: 1px solid rgba(138, 216, 255, 0.52);
  border-radius: 8px;
  color: #f5fbff;
  background:
    linear-gradient(90deg, rgba(47, 128, 255, 0.18), rgba(255, 122, 24, 0.08)),
    rgba(5, 10, 18, 0.96);
  box-shadow:
    0 22px 54px rgba(0, 0, 0, 0.46),
    0 0 0 1px rgba(255, 255, 255, 0.05);
  opacity: 0.96;
  pointer-events: none;
  transform: translate3d(var(--todo-drag-x, 0px), var(--todo-drag-y, 0px), 0);
  will-change: transform;
`;

const TodoDragPreviewText = styled.div`
  overflow: hidden;
  overflow-wrap: anywhere;
  color: #f4faff;
  font-size: 12px;
  font-weight: 760;
  line-height: 1.45;
  white-space: pre-wrap;
`;

const TERMINAL_PANEL_ANCHOR_SELECTOR = "[data-terminal-panel-anchor='true']";

function normalizeViewTerminalRows(rows) {
  const usedIndexes = new Set();
  const normalizedRows = [];

  if (!Array.isArray(rows)) {
    return [];
  }

  rows.forEach((row) => {
    const rowIndexes = Array.isArray(row?.terminalIndexes)
      ? row.terminalIndexes
      : Array.isArray(row)
        ? row
        : [];
    const terminalIndexes = [];

    rowIndexes.forEach((index) => {
      const terminalIndex = Number.parseInt(index, 10);
      if (
        Number.isInteger(terminalIndex)
        && terminalIndex >= 0
        && !usedIndexes.has(terminalIndex)
      ) {
        usedIndexes.add(terminalIndex);
        terminalIndexes.push(terminalIndex);
      }
    });

    if (terminalIndexes.length) {
      normalizedRows.push({
        rowIndex: normalizedRows.length,
        terminalIndexes,
      });
    }
  });

  return normalizedRows;
}

function cloneTerminalRows(rows) {
  return normalizeViewTerminalRows(rows).map((row, rowIndex) => ({
    rowIndex,
    terminalIndexes: row.terminalIndexes.slice(),
  }));
}

function serializeTerminalRows(rows) {
  return cloneTerminalRows(rows)
    .map((row) => row.terminalIndexes.join(","))
    .join("|");
}

function areTerminalRowsEqual(leftRows, rightRows) {
  const left = cloneTerminalRows(leftRows);
  const right = cloneTerminalRows(rightRows);

  return left.length === right.length
    && left.every((leftRow, rowIndex) => (
      leftRow.terminalIndexes.length === right[rowIndex].terminalIndexes.length
      && leftRow.terminalIndexes.every((terminalIndex, columnIndex) => (
        terminalIndex === right[rowIndex].terminalIndexes[columnIndex]
      ))
    ));
}

function removeTerminalFromRows(rows, terminalIndex) {
  return cloneTerminalRows(rows)
    .map((row) => row.terminalIndexes.filter((index) => index !== terminalIndex))
    .filter((terminalIndexes) => terminalIndexes.length)
    .map((terminalIndexes, rowIndex) => ({
      rowIndex,
      terminalIndexes,
    }));
}

function findTerminalRowPosition(rows, terminalIndex) {
  const normalizedRows = cloneTerminalRows(rows);

  for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex += 1) {
    const columnIndex = normalizedRows[rowIndex].terminalIndexes.indexOf(terminalIndex);
    if (columnIndex >= 0) {
      return { rowIndex, columnIndex };
    }
  }

  return null;
}

function insertTerminalInRows(rows, terminalIndex, target) {
  const withoutTerminal = removeTerminalFromRows(rows, terminalIndex);

  if (!withoutTerminal.length) {
    return [{ rowIndex: 0, terminalIndexes: [terminalIndex] }];
  }

  const rowIndex = Math.max(0, Math.min(Number.parseInt(target?.rowIndex, 10) || 0, withoutTerminal.length));
  const nextRows = withoutTerminal.map((row) => row.terminalIndexes.slice());

  if (rowIndex >= nextRows.length) {
    nextRows.push([terminalIndex]);
  } else {
    const columnIndex = Math.max(
      0,
      Math.min(Number.parseInt(target?.columnIndex, 10) || 0, nextRows[rowIndex].length),
    );
    nextRows[rowIndex].splice(columnIndex, 0, terminalIndex);
  }

  return nextRows
    .filter((terminalIndexes) => terminalIndexes.length)
    .map((terminalIndexes, nextRowIndex) => ({
      rowIndex: nextRowIndex,
      terminalIndexes,
    }));
}

function getAbsoluteRect(relativeRect, containerRect) {
  if (!relativeRect || !containerRect) {
    return null;
  }

  return {
    bottom: containerRect.top + relativeRect.top + relativeRect.height,
    height: relativeRect.height,
    left: containerRect.left + relativeRect.left,
    right: containerRect.left + relativeRect.left + relativeRect.width,
    top: containerRect.top + relativeRect.top,
    width: relativeRect.width,
  };
}

function pointIsInRect(clientX, clientY, rect) {
  return rect
    && clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom;
}

function getPlainDomRect(rect) {
  if (!rect) {
    return null;
  }

  return {
    height: Number(rect.height || 0),
    left: Number(rect.left || 0),
    top: Number(rect.top || 0),
    width: Number(rect.width || 0),
  };
}

function getTodoDropTargetFromPoint({
  clientX,
  clientY,
  containerRect,
  fullscreenTerminalIndex,
  rects,
  terminalIndexes,
}) {
  if (
    Number.isInteger(fullscreenTerminalIndex)
    && pointIsInRect(clientX, clientY, containerRect)
  ) {
    return fullscreenTerminalIndex;
  }

  for (const terminalIndex of terminalIndexes || []) {
    const rect = getAbsoluteRect(rects?.[terminalIndex], containerRect);
    if (pointIsInRect(clientX, clientY, rect)) {
      return terminalIndex;
    }
  }

  return null;
}

function getRowsWithMetrics(rows, rects, containerRect, draggedTerminalIndex) {
  return cloneTerminalRows(rows)
    .map((row, rowIndex) => {
      const rowRects = row.terminalIndexes
        .filter((terminalIndex) => terminalIndex !== draggedTerminalIndex)
        .map((terminalIndex) => ({
          rect: getAbsoluteRect(rects[terminalIndex], containerRect),
          terminalIndex,
        }))
        .filter((entry) => entry.rect);

      if (!rowRects.length) {
        return null;
      }

      return {
        bottom: Math.max(...rowRects.map((entry) => entry.rect.bottom)),
        left: Math.min(...rowRects.map((entry) => entry.rect.left)),
        rects: rowRects,
        right: Math.max(...rowRects.map((entry) => entry.rect.right)),
        rowIndex,
        top: Math.min(...rowRects.map((entry) => entry.rect.top)),
      };
    })
    .filter(Boolean);
}

function getDragTargetFromPoint({
  clientX,
  clientY,
  containerRect,
  draggedTerminalIndex,
  rects,
  rows,
}) {
  const normalizedRows = cloneTerminalRows(rows);
  const rowMetrics = getRowsWithMetrics(normalizedRows, rects, containerRect, draggedTerminalIndex);

  for (const row of normalizedRows) {
    for (const terminalIndex of row.terminalIndexes) {
      if (terminalIndex === draggedTerminalIndex) {
        continue;
      }

      const rect = getAbsoluteRect(rects[terminalIndex], containerRect);
      if (!pointIsInRect(clientX, clientY, rect)) {
        continue;
      }

      const position = findTerminalRowPosition(normalizedRows, terminalIndex);
      if (!position) {
        continue;
      }

      return {
        columnIndex: position.columnIndex + (clientX >= rect.left + rect.width / 2 ? 1 : 0),
        rowIndex: position.rowIndex,
      };
    }
  }

  if (!rowMetrics.length) {
    return { columnIndex: 0, rowIndex: 0 };
  }

  const firstRow = rowMetrics[0];
  const lastRow = rowMetrics[rowMetrics.length - 1];

  if (clientY < firstRow.top) {
    return { columnIndex: 0, rowIndex: 0 };
  }

  if (clientY > lastRow.bottom) {
    return { columnIndex: 0, rowIndex: normalizedRows.length };
  }

  const nearestRow = rowMetrics.reduce((bestRow, row) => {
    if (clientY >= row.top && clientY <= row.bottom) {
      return row;
    }

    const rowCenter = row.top + (row.bottom - row.top) / 2;
    const bestCenter = bestRow.top + (bestRow.bottom - bestRow.top) / 2;
    return Math.abs(clientY - rowCenter) < Math.abs(clientY - bestCenter) ? row : bestRow;
  }, rowMetrics[0]);

  const sortedRects = nearestRow.rects
    .slice()
    .sort((left, right) => left.rect.left - right.rect.left);
  const beforeIndex = sortedRects.findIndex((entry) => clientX < entry.rect.left + entry.rect.width / 2);
  const targetTerminalIndex = beforeIndex >= 0
    ? sortedRects[beforeIndex].terminalIndex
    : sortedRects[sortedRects.length - 1].terminalIndex;
  const position = findTerminalRowPosition(normalizedRows, targetTerminalIndex);

  if (!position) {
    return {
      columnIndex: normalizedRows[nearestRow.rowIndex]?.terminalIndexes.length || 0,
      rowIndex: nearestRow.rowIndex,
    };
  }

  return {
    columnIndex: beforeIndex >= 0 ? position.columnIndex : position.columnIndex + 1,
    rowIndex: position.rowIndex,
  };
}

function areRectMapsEqual(left, right) {
  const leftKeys = Object.keys(left || {});
  const rightKeys = Object.keys(right || {});

  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => {
      const leftRect = left[key];
      const rightRect = right[key];
      return rightRect
        && Math.abs(leftRect.left - rightRect.left) < 0.5
        && Math.abs(leftRect.top - rightRect.top) < 0.5
        && Math.abs(leftRect.width - rightRect.width) < 0.5
        && Math.abs(leftRect.height - rightRect.height) < 0.5;
    });
}

function areRectsEqual(leftRect, rightRect) {
  if (!leftRect || !rightRect) {
    return leftRect === rightRect;
  }

  return Math.abs(leftRect.left - rightRect.left) < 0.5
    && Math.abs(leftRect.top - rightRect.top) < 0.5
    && Math.abs(leftRect.width - rightRect.width) < 0.5
    && Math.abs(leftRect.height - rightRect.height) < 0.5;
}

function canUseTodoQueueStorage() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function getTodoQueueStorageKey(workspaceId) {
  const safeWorkspaceId = String(workspaceId || "default")
    .replace(/[^\w.-]/g, "_")
    .slice(0, 120) || "default";

  return `${TODO_QUEUE_STORAGE_PREFIX}.${safeWorkspaceId}`;
}

function normalizeTodoQueueText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, TODO_QUEUE_MAX_TEXT_LENGTH);
}

function normalizeTodoQueueMultilineText(value, maxLength = TODO_QUEUE_MAX_NOTE_TEXT_LENGTH) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function getTodoQueueLineCount(value) {
  const text = normalizeTodoQueueMultilineText(value);
  return text ? text.split("\n").length : 0;
}

function getTodoQueuePastedLinesLabel(lineCount) {
  return `[pasted-lines ${Math.max(1, Number(lineCount || 0))}]`;
}

function getTodoQueueNoteTitle(value) {
  const normalizedTitle = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalizedTitle) {
    return "Pasted note";
  }

  return normalizedTitle.length > TODO_QUEUE_NOTE_TITLE_LENGTH
    ? `${normalizedTitle.slice(0, TODO_QUEUE_NOTE_TITLE_LENGTH - 3)}...`
    : normalizedTitle;
}

function normalizeTodoQueueNote(value) {
  const note = typeof value === "string"
    ? { text: value }
    : value && typeof value === "object"
      ? value
      : null;
  const text = normalizeTodoQueueMultilineText(note?.text || note?.content);

  if (!text) {
    return null;
  }

  const lineCount = getTodoQueueLineCount(text);

  return {
    lineCount,
    text,
    title: getTodoQueuePastedLinesLabel(lineCount),
    preview: getTodoQueueNoteTitle(note?.preview || note?.title || text),
  };
}

function getTodoQueueItemNote(item) {
  return normalizeTodoQueueNote(item?.note || item?.noteText || item?.longText);
}

function getTodoQueueNoteFromPastedText(value) {
  return getTodoQueueLineCount(value) > TODO_QUEUE_NOTE_LINE_THRESHOLD
    ? normalizeTodoQueueNote(value)
    : null;
}

function normalizeTodoQueueImage(value) {
  const image = typeof value === "string"
    ? { src: value }
    : value && typeof value === "object"
      ? value
      : null;
  const src = typeof image?.src === "string" ? image.src.trim() : "";

  if (!src || !src.startsWith("data:image/")) {
    return null;
  }

  return {
    name: typeof image.name === "string" ? image.name.slice(0, 160) : "",
    src,
    type: typeof image.type === "string" ? image.type.slice(0, 80) : "",
  };
}

function getTodoQueueItemImage(item) {
  return normalizeTodoQueueImage(item?.image || item?.imageDataUrl || item?.imageSrc);
}

function dedupeTodoQueueImages(images) {
  const seenSources = new Set();

  return (Array.isArray(images) ? images : [])
    .map(normalizeTodoQueueImage)
    .filter((image) => {
      if (!image || seenSources.has(image.src)) {
        return false;
      }

      seenSources.add(image.src);
      return true;
    });
}

function getTodoQueueItemTerminalText(item) {
  const text = normalizeTodoQueueText(item?.text);
  const note = getTodoQueueItemNote(item);

  if (text && note?.text) {
    return `${text}\n\n${note.text}`;
  }

  return text || note?.text || "";
}

function normalizeTodoTerminalAgentId(value) {
  return String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function findTodoAgentStatus(agentStatuses, agentId) {
  const normalizedAgentId = normalizeTodoTerminalAgentId(agentId);
  return (Array.isArray(agentStatuses) ? agentStatuses : []).find((status) => (
    normalizeTodoTerminalAgentId(status?.id) === normalizedAgentId
  )) || null;
}

function todoModelLooksImageCapable(model) {
  const normalized = String(model || "").trim().toLowerCase();

  if (!normalized) {
    return null;
  }

  if ([
    "gpt-3.5",
    "o1-mini",
    "o3-mini",
    "deepseek",
    "codestral",
    "devstral",
    "llama",
    "qwen-coder",
    "kimi",
  ].some((marker) => normalized.includes(marker))) {
    return false;
  }

  if ([
    "gpt-4o",
    "gpt-4.1",
    "gpt-5",
    "claude-3",
    "claude-opus-4",
    "claude-sonnet-4",
    "claude-haiku-4",
    "sonnet-4",
    "opus-4",
    "gemini",
    "pixtral",
    "llava",
    "minicpm-v",
    "vision",
    "multimodal",
    "omni",
    "qwen-vl",
    "qwen2-vl",
    "qwen2.5-vl",
  ].some((marker) => normalized.includes(marker))
    || normalized.includes("-vl")
    || normalized.includes("/vl")
    || normalized.endsWith(":vl")) {
    return true;
  }

  return null;
}

function resolveTodoImageInputSupport({ agent, agentStatuses, role }) {
  const roleId = normalizeTodoTerminalAgentId(role || agent?.id);
  const agentId = roleId === "generic" || roleId === "terminal" || roleId === "shell"
    ? roleId
    : normalizeTodoTerminalAgentId(agent?.id || roleId);
  const status = findTodoAgentStatus(agentStatuses, agentId);
  const statusSupport = String(status?.imageInputSupport || "").trim().toLowerCase();
  const activeModel = String(
    status?.activeModel
    || status?.model
    || status?.selectedModel
    || status?.configuredModel
    || "",
  ).trim();

  if (!TODO_QUEUE_IMAGE_TERMINALS.has(agentId)) {
    return {
      activeModel,
      reason: "This terminal does not accept image todos.",
      state: "unsupported",
      supported: false,
    };
  }

  if (agentId === "codex" || agentId === "claude") {
    return {
      activeModel,
      reason: status?.imageInputReason || `${agent?.label || agentId} supports image input.`,
      state: "supported",
      supported: true,
    };
  }

  if (agentId === "opencode") {
    if (status?.imageInputSupported === true || statusSupport === "supported") {
      return {
        activeModel,
        reason: status?.imageInputReason || "OpenCode is using an image-capable model.",
        state: "supported",
        supported: true,
      };
    }

    if (status?.imageInputSupported === false && statusSupport === "unsupported") {
      return {
        activeModel,
        reason: status?.imageInputReason || "OpenCode is using a text-only model.",
        state: "unsupported",
        supported: false,
      };
    }

    const modelSupport = todoModelLooksImageCapable(activeModel);
    if (modelSupport === true) {
      return {
        activeModel,
        reason: `OpenCode is using an image-capable model (${activeModel}).`,
        state: "supported",
        supported: true,
      };
    }
    if (modelSupport === false) {
      return {
        activeModel,
        reason: `OpenCode is using a text-only model (${activeModel}).`,
        state: "unsupported",
        supported: false,
      };
    }

    return {
      activeModel,
      reason: activeModel
        ? `OpenCode image support is unknown for ${activeModel}.`
        : "OpenCode image input depends on the selected model; no image-capable model was detected.",
      state: activeModel ? "unknown" : "conditional",
      supported: false,
    };
  }

  return {
    activeModel,
    reason: "This terminal does not accept image todos.",
    state: "unsupported",
    supported: false,
  };
}

function getTodoImageUnsupportedDropMessage(capability) {
  const reason = typeof capability?.reason === "string" ? capability.reason.trim() : "";
  return reason || "Drop image todos on Codex, Claude, or OpenCode with a vision model.";
}

function getTodoImageMimeType(image) {
  const normalized = normalizeTodoQueueImage(image);
  if (!normalized) {
    return "";
  }

  return normalized.type
    || normalized.src.match(/^data:(image\/[^;]+);base64,/i)?.[1]
    || "";
}

function todoImageToAttachmentPayload(image, index = 0) {
  const normalized = normalizeTodoQueueImage(image);
  const mimeType = getTodoImageMimeType(normalized);

  if (!normalized || !mimeType) {
    return null;
  }

  return {
    dataUrl: normalized.src,
    mimeType,
    name: normalized.name || `todo-image-${index + 1}`,
  };
}

function formatSavedTodoImageAttachments(images) {
  return (Array.isArray(images) ? images : [])
    .map((image, index) => {
      const name = String(image?.name || `image-${index + 1}`).trim();
      const path = String(image?.path || "").trim();
      return path ? `[image-attached ${index + 1}] ${name} -> ${path}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function saveTodoQueueImageAttachments(images) {
  const payload = (Array.isArray(images) ? images : [images])
    .map(todoImageToAttachmentPayload)
    .filter(Boolean);

  if (!payload.length) {
    return [];
  }

  return invoke("save_todo_image_attachments", { images: payload });
}

async function saveTodoQueueTextAttachment(note) {
  const normalizedNote = normalizeTodoQueueNote(note);

  if (!normalizedNote?.text) {
    return null;
  }

  return invoke("save_todo_text_attachment", {
    request: {
      text: normalizedNote.text,
      title: normalizedNote.title,
    },
  });
}

async function prepareTodoTerminalText(item) {
  const text = normalizeTodoQueueText(item?.text);
  const image = getTodoQueueItemImage(item);
  const note = getTodoQueueItemNote(item);
  const parts = [];

  if (text) {
    parts.push(text);
  }

  if (image) {
    const savedImages = await saveTodoQueueImageAttachments([image]);
    const imageBlock = formatSavedTodoImageAttachments(savedImages);

    if (!imageBlock) {
      throw new Error("Unable to prepare pasted image for terminal.");
    }

    parts.push(imageBlock);
  }

  if (note?.text) {
    try {
      const savedNote = await saveTodoQueueTextAttachment(note);
      const savedPath = String(savedNote?.path || "").trim();
      const lineCount = Number(savedNote?.lineCount || note.lineCount || getTodoQueueLineCount(note.text));
      const label = getTodoQueuePastedLinesLabel(lineCount);

      parts.push(savedPath ? `${label} -> ${savedPath}` : `${label}\n${note.text}`);
    } catch {
      parts.push(`${getTodoQueuePastedLinesLabel(note.lineCount || getTodoQueueLineCount(note.text))}\n${note.text}`);
    }
  }

  return parts.filter(Boolean).join("\n\n");
}

function getTodoClipboardFileSignature(file) {
  if (!file) {
    return "";
  }

  return [
    String(file.name || "clipboard-image"),
    String(file.type || ""),
    String(file.size || 0),
    String(file.lastModified || 0),
  ].join("|");
}

function getTodoClipboardImageFiles(clipboardData) {
  const itemFiles = Array.from(clipboardData?.items || [])
    .filter((item) => item?.kind === "file" && String(item.type || "").startsWith("image/"))
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
  const clipboardFiles = Array.from(clipboardData?.files || [])
    .filter((file) => String(file?.type || "").startsWith("image/"));
  const seenFiles = new Set();

  return itemFiles.concat(clipboardFiles)
    .filter((file) => {
      const signature = getTodoClipboardFileSignature(file);
      if (!signature || seenFiles.has(signature)) {
        return false;
      }

      seenFiles.add(signature);
      return true;
    })
    .slice(0, TODO_QUEUE_MAX_PASTE_IMAGES);
}

function readTodoImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(normalizeTodoQueueImage({
        name: file?.name || "",
        src: String(reader.result || ""),
        type: file?.type || "",
      }));
    });
    reader.addEventListener("error", () => reject(reader.error || new Error("Unable to read image.")));
    reader.readAsDataURL(file);
  });
}

function getTodoDropErrorMessage(error) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  return "Unable to send todo to terminal.";
}

function createTodoQueueItem(text, options = {}) {
  const createdAt = new Date().toISOString();
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const image = normalizeTodoQueueImage(options.image);
  const note = normalizeTodoQueueNote(options.note);

  return {
    createdAt,
    id,
    ...(image ? { image } : {}),
    ...(note ? { note } : {}),
    text,
  };
}

function normalizeTodoQueueItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const text = normalizeTodoQueueText(item.text);
  const image = getTodoQueueItemImage(item);
  const note = getTodoQueueItemNote(item);
  if (!text && !image && !note) {
    return null;
  }

  return {
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    id: typeof item.id === "string" && item.id.trim()
      ? item.id
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...(image ? { image } : {}),
    ...(note ? { note } : {}),
    text,
  };
}

function normalizeTodoQueueItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeTodoQueueItem)
    .filter(Boolean)
    .slice(0, TODO_QUEUE_MAX_ITEMS);
}

function readTodoQueueItems(storageKey) {
  if (!canUseTodoQueueStorage()) {
    return [];
  }

  try {
    return normalizeTodoQueueItems(JSON.parse(window.localStorage.getItem(storageKey) || "[]"));
  } catch {
    return [];
  }
}

function writeTodoQueueItems(storageKey, items) {
  if (!canUseTodoQueueStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalizeTodoQueueItems(items)));
  } catch {
    // The queue is a convenience layer; storage failures should not interrupt terminal work.
  }
}

const TodoQueuePanel = memo(function TodoQueuePanel({
  activeDragItemId = "",
  defaultWorkingDirectory = "",
  draft,
  dropError = "",
  items,
  onBeginTodoDrag,
  onDraftChange,
  onOpenWorkspaceSettings,
  onRemoveItem,
  onReorderItem,
  onSubmitDraft,
  onUpdateItem,
  rootDirectory = "",
  workspace,
  workspaceError = "",
  workspaceId,
}) {
  const [activeWorkspaceTool, setActiveWorkspaceTool] = useState("orchestrator");
  const [activeOrchestratorSection, setActiveOrchestratorSection] = useState("todo");
  const [editingItemId, setEditingItemId] = useState("");
  const [editingDraft, setEditingDraft] = useState("");
  const [reorderingItemId, setReorderingItemId] = useState("");
  const [todoListOffset, setTodoListOffset] = useState(0);
  const todoBoardRef = useRef(null);
  const todoItemElementsRef = useRef(new Map());
  const todoReorderDragRef = useRef(null);
  const draftTextAreaRef = useRef(null);
  const editingTextAreaRef = useRef(null);
  const todoListRef = useRef(null);
  const skipEditBlurCommitRef = useRef(false);

  const handleDraftKeyDown = useCallback((event) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    onSubmitDraft();
  }, [onSubmitDraft]);

  const handleDraftPaste = useCallback((event) => {
    const imageFiles = getTodoClipboardImageFiles(event.clipboardData);
    const note = getTodoQueueNoteFromPastedText(event.clipboardData?.getData?.("text/plain") || "");

    if (!imageFiles.length) {
      if (note) {
        event.preventDefault();
        onSubmitDraft({ note });
      }
      return;
    }

    event.preventDefault();
    Promise.all(imageFiles.map(readTodoImageFile))
      .then((images) => {
        const normalizedImages = dedupeTodoQueueImages(images);
        if (normalizedImages.length) {
          const createdItems = onSubmitDraft({ images: normalizedImages, note }) || [];
          const firstImageItem = createdItems.find((item) => getTodoQueueItemImage(item)) || createdItems[0];

          if (firstImageItem?.id) {
            setEditingItemId(firstImageItem.id);
            setEditingDraft(normalizeTodoQueueText(firstImageItem.text));
            skipEditBlurCommitRef.current = false;
          }
        }
      })
      .catch(() => {});
  }, [onSubmitDraft]);

  const handleSubmit = useCallback((event) => {
    event.preventDefault();
    onSubmitDraft();
  }, [onSubmitDraft]);

  const beginItemEdit = useCallback((item) => {
    const text = normalizeTodoQueueText(item?.text);
    if (!item?.id) {
      return;
    }

    setEditingItemId(item.id);
    setEditingDraft(text);
    skipEditBlurCommitRef.current = false;
  }, []);

  const clearItemEdit = useCallback(() => {
    setEditingItemId("");
    setEditingDraft("");
  }, []);

  const commitItemEdit = useCallback(() => {
    if (!editingItemId) {
      return;
    }

    onUpdateItem?.(editingItemId, editingDraft);
    skipEditBlurCommitRef.current = true;
    clearItemEdit();
  }, [clearItemEdit, editingDraft, editingItemId, onUpdateItem]);

  const handleItemEditBlur = useCallback(() => {
    if (skipEditBlurCommitRef.current) {
      skipEditBlurCommitRef.current = false;
      return;
    }

    commitItemEdit();
  }, [commitItemEdit]);

  const handleItemEditKeyDown = useCallback((event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      skipEditBlurCommitRef.current = true;
      clearItemEdit();
      return;
    }

    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    commitItemEdit();
  }, [clearItemEdit, commitItemEdit]);

  const focusDraftTextArea = useCallback(() => {
    draftTextAreaRef.current?.focus?.();
  }, []);

  const handleBoardPointerDown = useCallback((event) => {
    if (
      event.target === draftTextAreaRef.current
      || event.target?.closest?.("[data-todo-card='true']")
      || event.target?.closest?.("[data-todo-control='true']")
    ) {
      return;
    }

    event.preventDefault();
    focusDraftTextArea();
  }, [focusDraftTextArea]);

  const setTodoItemElement = useCallback((itemId, element) => {
    if (element) {
      todoItemElementsRef.current.set(itemId, element);
      return;
    }

    todoItemElementsRef.current.delete(itemId);
  }, []);

  const handlePointerDown = useCallback((event, item) => {
    if (
      event.button !== 0
      || event.detail > 1
      || editingItemId === item?.id
      || event.target?.closest?.("[data-todo-control='true']")
    ) {
      return;
    }

    const text = normalizeTodoQueueText(item?.text);
    const terminalText = getTodoQueueItemTerminalText(item);
    const image = getTodoQueueItemImage(item);
    const note = getTodoQueueItemNote(item);
    if (!terminalText && !image && !note) {
      event.preventDefault();
      return;
    }

    const sourceRect = getPlainDomRect(event.currentTarget?.getBoundingClientRect?.());
    if (!sourceRect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    todoReorderDragRef.current = {
      itemId: item.id,
      pointerId: event.pointerId,
    };
    setReorderingItemId(item.id);
    onBeginTodoDrag?.({
      clientX: event.clientX,
      clientY: event.clientY,
      item: {
        id: item.id,
        ...(image ? { image } : {}),
        ...(note ? { note } : {}),
        text,
      },
      pointerId: event.pointerId,
      sourceRect,
      workspaceId,
    });
  }, [editingItemId, onBeginTodoDrag, workspaceId]);

  useEffect(() => {
    if (!editingItemId) {
      return;
    }

    const element = editingTextAreaRef.current;
    element?.focus?.();
    element?.setSelectionRange?.(editingDraft.length, editingDraft.length);
  }, [editingItemId]);

  useEffect(() => {
    if (editingItemId && !items.some((item) => item.id === editingItemId)) {
      clearItemEdit();
    }
  }, [clearItemEdit, editingItemId, items]);

  useLayoutEffect(() => {
    const listElement = todoListRef.current;

    if (!listElement || !items.length) {
      setTodoListOffset(0);
      return undefined;
    }

    const updateOffset = () => {
      const nextOffset = Math.ceil(listElement.getBoundingClientRect().height || 0);
      setTodoListOffset((currentOffset) => (
        currentOffset === nextOffset ? currentOffset : nextOffset
      ));
    };

    updateOffset();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateOffset);
      return () => window.removeEventListener("resize", updateOffset);
    }

    const observer = new ResizeObserver(updateOffset);
    observer.observe(listElement);

    return () => observer.disconnect();
  }, [activeOrchestratorSection, items.length]);

  useEffect(() => {
    const drag = todoReorderDragRef.current;
    if (!reorderingItemId || !drag) {
      return undefined;
    }

    const getTargetIndex = (clientY) => {
      const entries = items
        .map((item, index) => ({
          id: item.id,
          index,
          rect: todoItemElementsRef.current.get(item.id)?.getBoundingClientRect?.(),
        }))
        .filter((entry) => entry.rect);

      for (const entry of entries) {
        if (clientY < entry.rect.top + entry.rect.height / 2) {
          return entry.index;
        }
      }

      return entries.length;
    };

    const handlePointerMove = (event) => {
      const currentDrag = todoReorderDragRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      const boardRect = todoBoardRef.current?.getBoundingClientRect?.();
      if (!pointIsInRect(event.clientX, event.clientY, boardRect)) {
        return;
      }

      onReorderItem?.(currentDrag.itemId, getTargetIndex(event.clientY));
    };

    const endDrag = (event) => {
      const currentDrag = todoReorderDragRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      todoReorderDragRef.current = null;
      setReorderingItemId("");
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [items, onReorderItem, reorderingItemId]);

  return (
    <TodoQueueSurface aria-label="Orchestrator">
      <OrchestratorTopNav aria-label="Workspace tool">
        {WORKSPACE_TOOL_TABS.map((tool) => (
          <OrchestratorTopButton
            data-active={activeWorkspaceTool === tool.id ? "true" : "false"}
            key={tool.id}
            onClick={() => setActiveWorkspaceTool(tool.id)}
            type="button"
          >
            {tool.label}
          </OrchestratorTopButton>
        ))}
      </OrchestratorTopNav>
      {activeWorkspaceTool === "files" ? (
        <WorkspaceToolSurface data-tool="files">
          <FilesWorkspaceView
            defaultWorkingDirectory={defaultWorkingDirectory}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
            rootDirectory={rootDirectory}
            workspace={workspace}
            workspaceError={workspaceError}
          />
        </WorkspaceToolSurface>
      ) : activeWorkspaceTool === "web" ? (
        <WorkspaceToolSurface data-tool="web">
          <WebWorkspaceView
            defaultWorkingDirectory={defaultWorkingDirectory}
            rootDirectory={rootDirectory}
            workspace={workspace}
          />
        </WorkspaceToolSurface>
      ) : (
        <OrchestratorView>
          <OrchestratorVoiceArea>
            <OrchestratorVoiceButton aria-label="Voice agent" type="button">
              <OrchestratorVoiceLogo />
            </OrchestratorVoiceButton>
          </OrchestratorVoiceArea>
          <OrchestratorSectionTabs aria-label="Orchestrator section">
            <OrchestratorSectionButton
              data-active={activeOrchestratorSection === "todo" ? "true" : "false"}
              onClick={() => setActiveOrchestratorSection("todo")}
              type="button"
            >
              Todo
            </OrchestratorSectionButton>
            <OrchestratorSectionButton
              data-active={activeOrchestratorSection === "history" ? "true" : "false"}
              onClick={() => setActiveOrchestratorSection("history")}
              type="button"
            >
              Voice History
            </OrchestratorSectionButton>
          </OrchestratorSectionTabs>
          <OrchestratorContent>
            {activeOrchestratorSection === "todo" ? (
              <TodoQueueComposer onSubmit={handleSubmit}>
                <TodoQueueBoard
                  onPointerDown={handleBoardPointerDown}
                  ref={todoBoardRef}
                  style={{ "--todo-list-offset": `${todoListOffset}px` }}
                >
                  <TodoQueueTextArea
                    aria-label="New todo"
                    maxLength={TODO_QUEUE_MAX_TEXT_LENGTH}
                    onChange={(event) => onDraftChange(event.target.value)}
                    onKeyDown={handleDraftKeyDown}
                    onPaste={handleDraftPaste}
                    placeholder="Type a todo..."
                    ref={draftTextAreaRef}
                    spellCheck="true"
                    value={draft}
                  />
                  <TodoQueueDraftBullet aria-hidden="true" />

                  {items.length > 0 && (
                    <TodoQueueList aria-label="Todo objects" ref={todoListRef} role="list">
                      {items.map((item) => {
                        const isEditing = editingItemId === item.id;
                        const image = getTodoQueueItemImage(item);
                        const note = getTodoQueueItemNote(item);
                        const hasPreview = Boolean(image || note);

                        return (
                          <TodoQueueItemCard
                            data-todo-card="true"
                            data-todo-dragging={activeDragItemId === item.id ? "true" : undefined}
                            data-todo-editing={isEditing ? "true" : undefined}
                            data-todo-reordering={reorderingItemId === item.id ? "true" : undefined}
                            key={item.id}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              beginItemEdit(item);
                            }}
                            onPointerDown={(event) => handlePointerDown(event, item)}
                            ref={(element) => setTodoItemElement(item.id, element)}
                            role="listitem"
                            title="Drag into an agent terminal. Double-click to edit."
                          >
                            <TodoQueueItemContent data-has-preview={hasPreview ? "true" : "false"}>
                              {image && (
                                <TodoQueueItemImageFrame>
                                  <TodoQueueItemImage alt="" src={image.src} />
                                </TodoQueueItemImageFrame>
                              )}
                              {!image && note && (
                                <TodoQueueItemNoteFrame>
                                  <TodoQueueItemNoteTitle>{note.title}</TodoQueueItemNoteTitle>
                                  <TodoQueueItemNoteIcon aria-hidden="true" />
                                </TodoQueueItemNoteFrame>
                              )}
                              {isEditing ? (
                                <TodoQueueItemEditor
                                  aria-label="Edit todo"
                                  data-todo-control="true"
                                  maxLength={TODO_QUEUE_MAX_TEXT_LENGTH}
                                  onBlur={handleItemEditBlur}
                                  onChange={(event) => setEditingDraft(event.target.value)}
                                  onKeyDown={handleItemEditKeyDown}
                                  ref={editingTextAreaRef}
                                  spellCheck="true"
                                  value={editingDraft}
                                />
                              ) : (
                                <TodoQueueItemText>{item.text}</TodoQueueItemText>
                              )}
                            </TodoQueueItemContent>
                            {!isEditing && (
                              <TodoQueueDeleteButton
                                aria-label="Delete todo"
                                data-todo-control="true"
                                data-todo-delete="true"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onRemoveItem?.(item.id);
                                }}
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                }}
                                title="Delete"
                                type="button"
                              >
                                x
                              </TodoQueueDeleteButton>
                            )}
                          </TodoQueueItemCard>
                        );
                      })}
                    </TodoQueueList>
                  )}

                  {dropError && <TodoQueueError role="alert">{dropError}</TodoQueueError>}
                </TodoQueueBoard>
              </TodoQueueComposer>
            ) : (
              <OrchestratorHistoryView>Voice history</OrchestratorHistoryView>
            )}
          </OrchestratorContent>
        </OrchestratorView>
      )}
    </TodoQueueSurface>
  );
});

function TerminalView({
  defaultWorkingDirectory = "",
  terminalWorkspace,
  terminalAgentsByIndex = {},
  terminalRolesByIndex = {},
  terminalThreadsByIndex = {},
  terminalWorkspaceWorkingDirectory,
  terminalWorkspaceLogicalIndexes,
  terminalWorkspaceLogicalTerminalCount,
  agentStatusError,
  agentStatuses,
  agentStatusState,
  changeWorkspaceTerminalRole,
  closeWorkspaceTerminal,
  createWorkspaceThreadTerminal,
  createFirstWorkspace,
  handlePreparedTerminalChange,
  onOpenWorkspaceSettings,
  onArchiveWorkspaceThread,
  onSelectWorkspaceThread,
  onThreadTerminalLifecycle,
  refreshAgentStatuses,
  reorderWorkspaceTerminalDisplayLayout,
  setWorkspaceName,
  shouldPrewarmWorkspaceTerminals,
  shouldShowWorkspaceSetup,
  showSettingsView,
  splitWorkspaceTerminal,
  terminalDisplayRows,
  viewMotion,
  workspaceAgentLaunchEpoch,
  workspaceError,
  workspaceName,
  workspaceSyncState,
  workspaceTerminalAgentLaunchReady,
  workspaceTerminalRenderAgent,
  workspaceThreads = {},
  workspaces = [],
}) {
  const hasWorkspaceTerminals = Boolean(terminalWorkspace);
  const logicalTerminalIndexes = Array.isArray(terminalWorkspaceLogicalIndexes)
    ? terminalWorkspaceLogicalIndexes
    : [];
  const displayTerminalRows = Array.isArray(terminalDisplayRows)
    ? terminalDisplayRows
    : [];
  const hasVisibleWorkspaceTerminalPanes = hasWorkspaceTerminals && displayTerminalRows.length > 0;
  const [activeTerminalPaneId, setActiveTerminalPaneId] = useState("");
  const [fullscreenTerminalIndex, setFullscreenTerminalIndex] = useState(null);
  const [fullscreenMotion, setFullscreenMotion] = useState(TERMINAL_FULLSCREEN_DEFAULT_MOTION);
  const [terminalLayoutRects, setTerminalLayoutRects] = useState({});
  const [terminalPanelRect, setTerminalPanelRect] = useState(null);
  const [terminalDragState, setTerminalDragState] = useState(null);
  const activeDisplayRows = terminalDragState?.previewRows || displayTerminalRows;
  const activeDisplayRowsSignature = serializeTerminalRows(activeDisplayRows);
  const terminalDragActive = Boolean(terminalDragState);
  const [todoDragState, setTodoDragState] = useState(null);
  const [todoDropError, setTodoDropError] = useState("");
  const todoDragActive = Boolean(todoDragState);
  const [todoQueueDraft, setTodoQueueDraft] = useState("");
  const [todoQueueItems, setTodoQueueItems] = useState([]);
  const [terminalWorkspaceMainWidth, setTerminalWorkspaceMainWidth] = useState(0);
  const fullscreenTransitionTimerRef = useRef(0);
  const layoutMeasureFrameRef = useRef(0);
  const terminalDragStateRef = useRef(null);
  const terminalLayoutRectsRef = useRef({});
  const terminalPanelRectRef = useRef(null);
  const terminalWorkspaceMainRef = useRef(null);
  const terminalPanelsRef = useRef(null);
  const todoDragStateRef = useRef(null);
  const todoQueueStorageKeyRef = useRef("");
  const todoQueueStorageKey = useMemo(
    () => getTodoQueueStorageKey(terminalWorkspace?.id),
    [terminalWorkspace?.id],
  );
  todoQueueStorageKeyRef.current = todoQueueStorageKey;
  const getTerminalAgent = useCallback((terminalIndex) => (
    Object.prototype.hasOwnProperty.call(terminalAgentsByIndex, terminalIndex)
      ? terminalAgentsByIndex[terminalIndex]
      : workspaceTerminalRenderAgent
  ), [terminalAgentsByIndex, workspaceTerminalRenderAgent]);
  const getTerminalRole = useCallback((terminalIndex) => (
    terminalRolesByIndex[terminalIndex] || getTerminalAgent(terminalIndex)?.id || ""
  ), [getTerminalAgent, terminalRolesByIndex]);
  const getTerminalThread = useCallback((terminalIndex) => (
    terminalThreadsByIndex[terminalIndex] || null
  ), [terminalThreadsByIndex]);
  const getTerminalPaneId = useCallback((terminalIndex) => {
    const role = getTerminalRole(terminalIndex);
    const agent = getTerminalAgent(terminalIndex);
    const paneAgentId = String(role || "").toLowerCase() === "generic"
      ? "generic"
      : agent?.id;

    return getWorkspaceTerminalPaneId(terminalWorkspace?.id, terminalIndex, paneAgentId);
  }, [getTerminalAgent, getTerminalRole, terminalWorkspace?.id]);
  const getTerminalImageInputSupport = useCallback((terminalIndex) => (
    resolveTodoImageInputSupport({
      agent: getTerminalAgent(terminalIndex),
      agentStatuses,
      role: getTerminalRole(terminalIndex),
    })
  ), [agentStatuses, getTerminalAgent, getTerminalRole]);
  const visibleTerminalPaneIds = useMemo(() => (
    terminalWorkspace
      ? logicalTerminalIndexes.map((terminalIndex) => getTerminalPaneId(terminalIndex))
      : []
  ), [getTerminalPaneId, logicalTerminalIndexes, terminalWorkspace]);
  const visibleTerminalPaneIdSignature = visibleTerminalPaneIds.join("|");
  const activePaneId = activeTerminalPaneId || visibleTerminalPaneIds[0] || "";
  const selectedWorkspaceThreadId = terminalWorkspace
    ? workspaceThreads?.[terminalWorkspace.id]?.activeThreadId || ""
    : "";
  const fullscreenActive = Number.isInteger(fullscreenTerminalIndex)
    && logicalTerminalIndexes.includes(fullscreenTerminalIndex);
  const fullscreenState = fullscreenActive
    ? fullscreenMotion.phase === "opening" || fullscreenMotion.phase === "closing"
      ? fullscreenMotion.phase
      : "open"
    : "idle";
  const fullscreenMotionStyle = useMemo(() => ({
    "--terminal-fullscreen-duration": `${TERMINAL_FULLSCREEN_TRANSITION_MS}ms`,
    "--terminal-fullscreen-origin-scale-x": fullscreenMotion.originScaleX || 1,
    "--terminal-fullscreen-origin-scale-y": fullscreenMotion.originScaleY || 1,
    "--terminal-fullscreen-origin-x": `${fullscreenMotion.originX || 0}px`,
    "--terminal-fullscreen-origin-y": `${fullscreenMotion.originY || 0}px`,
  }), [fullscreenMotion]);

  const measureTerminalLayout = useCallback(() => {
    const root = terminalPanelsRef.current;
    if (!root) {
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const nextPanelRect = {
      height: rootRect.height,
      left: rootRect.left,
      top: rootRect.top,
      width: rootRect.width,
    };
    const nextRects = {};

    root.querySelectorAll(TERMINAL_PANEL_ANCHOR_SELECTOR).forEach((element) => {
      const terminalIndex = Number.parseInt(element.getAttribute("data-terminal-index") || "", 10);
      if (!Number.isInteger(terminalIndex)) {
        return;
      }

      const rect = element.getBoundingClientRect();
      nextRects[terminalIndex] = {
        height: rect.height,
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
        width: rect.width,
      };
    });

    terminalLayoutRectsRef.current = nextRects;
    terminalPanelRectRef.current = nextPanelRect;
    setTerminalLayoutRects((currentRects) => (
      areRectMapsEqual(currentRects, nextRects) ? currentRects : nextRects
    ));
    setTerminalPanelRect((currentRect) => (
      areRectsEqual(currentRect, nextPanelRect) ? currentRect : nextPanelRect
    ));
  }, []);

  const scheduleMeasureTerminalLayout = useCallback(() => {
    if (layoutMeasureFrameRef.current) {
      return;
    }

    layoutMeasureFrameRef.current = window.requestAnimationFrame(() => {
      layoutMeasureFrameRef.current = 0;
      measureTerminalLayout();
    });
  }, [measureTerminalLayout]);

  const clearFullscreenTransitionTimer = useCallback(() => {
    if (fullscreenTransitionTimerRef.current) {
      window.clearTimeout(fullscreenTransitionTimerRef.current);
      fullscreenTransitionTimerRef.current = 0;
    }
  }, []);

  const getFullscreenMotionFromRect = useCallback((sourceRect) => {
    const targetRect = terminalPanelsRef.current?.getBoundingClientRect?.();
    const sourceWidth = Number(sourceRect?.width || 0);
    const sourceHeight = Number(sourceRect?.height || 0);
    const targetWidth = Number(targetRect?.width || 0);
    const targetHeight = Number(targetRect?.height || 0);

    if (!targetRect || !sourceWidth || !sourceHeight || !targetWidth || !targetHeight) {
      return TERMINAL_FULLSCREEN_DEFAULT_MOTION;
    }

    return {
      originScaleX: sourceWidth / targetWidth,
      originScaleY: sourceHeight / targetHeight,
      originX: Number(sourceRect.left || 0) - Number(targetRect.left || 0),
      originY: Number(sourceRect.top || 0) - Number(targetRect.top || 0),
      phase: "idle",
    };
  }, []);

  useEffect(() => () => {
    clearFullscreenTransitionTimer();
    if (layoutMeasureFrameRef.current) {
      window.cancelAnimationFrame(layoutMeasureFrameRef.current);
      layoutMeasureFrameRef.current = 0;
    }
  }, [clearFullscreenTransitionTimer]);

  useEffect(() => {
    setTodoQueueItems(readTodoQueueItems(todoQueueStorageKey));
    setTodoQueueDraft("");
  }, [todoQueueStorageKey]);

  useEffect(() => {
    const element = terminalWorkspaceMainRef.current;
    if (!element) {
      return undefined;
    }

    const updateWidth = () => {
      const nextWidth = Math.round(element.getBoundingClientRect().width || 0);
      setTerminalWorkspaceMainWidth((currentWidth) => (
        currentWidth === nextWidth ? currentWidth : nextWidth
      ));
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, [shouldShowWorkspaceSetup]);

  useLayoutEffect(() => {
    measureTerminalLayout();
  }, [activeDisplayRowsSignature, fullscreenActive, measureTerminalLayout]);

  useEffect(() => {
    const root = terminalPanelsRef.current;
    if (!root || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(scheduleMeasureTerminalLayout);
    observer.observe(root);
    root.querySelectorAll(TERMINAL_PANEL_ANCHOR_SELECTOR).forEach((element) => {
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, [activeDisplayRowsSignature, scheduleMeasureTerminalLayout]);

  useEffect(() => {
    window.addEventListener("resize", scheduleMeasureTerminalLayout);
    return () => window.removeEventListener("resize", scheduleMeasureTerminalLayout);
  }, [scheduleMeasureTerminalLayout]);

  useEffect(() => {
    setActiveTerminalPaneId((currentPaneId) => (
      currentPaneId && visibleTerminalPaneIds.includes(currentPaneId)
        ? currentPaneId
        : visibleTerminalPaneIds[0] || ""
    ));
  }, [visibleTerminalPaneIdSignature]);

  useEffect(() => {
    setFullscreenTerminalIndex((currentIndex) => (
      Number.isInteger(currentIndex) && logicalTerminalIndexes.includes(currentIndex)
        ? currentIndex
        : null
    ));
  }, [logicalTerminalIndexes]);

  useEffect(() => {
    if (
      Number.isInteger(fullscreenTerminalIndex)
      && !logicalTerminalIndexes.includes(fullscreenTerminalIndex)
    ) {
      clearFullscreenTransitionTimer();
      setFullscreenMotion(TERMINAL_FULLSCREEN_DEFAULT_MOTION);
    }
  }, [clearFullscreenTransitionTimer, fullscreenTerminalIndex, logicalTerminalIndexes]);

  const handleActivateTerminalPane = useCallback(({ paneId }) => {
    if (paneId) {
      setActiveTerminalPaneId(paneId);
    }
  }, []);

  const handleSplitTerminal = useCallback(({ direction, terminalIndex }) => {
    splitWorkspaceTerminal?.({
      direction,
      terminalIndex,
      workspaceId: terminalWorkspace?.id || "",
    });
  }, [splitWorkspaceTerminal, terminalWorkspace?.id]);

  const updateTodoQueueItems = useCallback((updater) => {
    setTodoQueueItems((currentItems) => {
      const nextItems = normalizeTodoQueueItems(
        typeof updater === "function" ? updater(currentItems) : updater,
      );
      writeTodoQueueItems(todoQueueStorageKeyRef.current, nextItems);
      return nextItems;
    });
  }, []);

  const submitTodoQueueDraft = useCallback((options = {}) => {
    const text = normalizeTodoQueueText(todoQueueDraft);
    const images = dedupeTodoQueueImages(Array.isArray(options.images) ? options.images : [options.image]);
    const note = normalizeTodoQueueNote(options.note);

    if (!text && !images.length && !note) {
      return [];
    }

    const nextItems = images.length
      ? images.map((image, imageIndex) => (
        createTodoQueueItem(imageIndex === 0 ? text : "", {
          image,
          ...(imageIndex === 0 && note ? { note } : {}),
        })
      ))
      : [createTodoQueueItem(text, note ? { note } : {})];

    updateTodoQueueItems((currentItems) => currentItems.concat(nextItems));
    setTodoDropError("");
    setTodoQueueDraft("");
    return nextItems;
  }, [todoQueueDraft, updateTodoQueueItems]);

  const removeTodoQueueItem = useCallback((itemId) => {
    updateTodoQueueItems((currentItems) => (
      currentItems.filter((item) => item.id !== itemId)
    ));
  }, [updateTodoQueueItems]);

  const reorderTodoQueueItem = useCallback((itemId, targetIndex) => {
    updateTodoQueueItems((currentItems) => {
      const currentIndex = currentItems.findIndex((item) => item.id === itemId);
      if (currentIndex < 0) {
        return currentItems;
      }

      const movingItem = currentItems[currentIndex];
      const withoutItem = currentItems.filter((item) => item.id !== itemId);
      const rawTargetIndex = Math.max(
        0,
        Math.min(Number.parseInt(targetIndex, 10) || 0, currentItems.length),
      );
      const adjustedTargetIndex = currentIndex < rawTargetIndex
        ? rawTargetIndex - 1
        : rawTargetIndex;
      const nextTargetIndex = Math.max(0, Math.min(adjustedTargetIndex, withoutItem.length));

      if (nextTargetIndex === currentIndex) {
        return currentItems;
      }

      withoutItem.splice(nextTargetIndex, 0, movingItem);
      return withoutItem;
    });
  }, [updateTodoQueueItems]);

  const updateTodoQueueItemText = useCallback((itemId, nextText) => {
    const text = normalizeTodoQueueText(nextText);

    updateTodoQueueItems((currentItems) => (
      currentItems
        .map((item) => (
          item.id === itemId
            ? { ...item, text }
            : item
        ))
        .filter((item) => (
          normalizeTodoQueueText(item.text)
          || getTodoQueueItemImage(item)
          || getTodoQueueItemNote(item)
        ))
    ));
  }, [updateTodoQueueItems]);

  const updateTodoDragState = useCallback((updater) => {
    setTodoDragState((currentState) => {
      const nextState = typeof updater === "function" ? updater(currentState) : updater;
      todoDragStateRef.current = nextState || null;
      return nextState || null;
    });
  }, []);

  const handleBeginTodoDrag = useCallback((event) => {
    const text = normalizeTodoQueueText(event?.item?.text);
    const image = getTodoQueueItemImage(event?.item);
    const note = getTodoQueueItemNote(event?.item);
    const sourceRect = event?.sourceRect;

    if (
      (!text && !image && !note)
      || !terminalWorkspace?.id
      || !sourceRect
      || !terminalPanelsRef.current
      || terminalDragActive
    ) {
      return;
    }

    measureTerminalLayout();

    const containerRect = terminalPanelsRef.current?.getBoundingClientRect?.();
    const targetTerminalIndex = getTodoDropTargetFromPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      containerRect,
      fullscreenTerminalIndex: fullscreenActive ? fullscreenTerminalIndex : null,
      rects: terminalLayoutRectsRef.current,
      terminalIndexes: logicalTerminalIndexes,
    });
    const dragWidth = Math.max(220, Number(sourceRect.width || 0));
    const dragHeight = Math.max(0, Number(sourceRect.height || 0));
    const offsetX = dragWidth / 2;
    const offsetY = Math.max(0, Math.min(dragHeight - 4, dragHeight * 0.68));

    setTodoDropError("");
    updateTodoDragState({
      height: dragHeight,
      itemId: event.item?.id || "",
      offsetX,
      offsetY,
      pointerId: event.pointerId,
      targetTerminalIndex,
      text,
      ...(image ? { image } : {}),
      ...(note ? { note } : {}),
      width: dragWidth,
      workspaceId: event.workspaceId || terminalWorkspace.id,
      x: Number(event.clientX || 0) - offsetX,
      y: Number(event.clientY || 0) - offsetY,
    });
  }, [
    fullscreenActive,
    fullscreenTerminalIndex,
    logicalTerminalIndexes,
    measureTerminalLayout,
    terminalDragActive,
    terminalWorkspace?.id,
    updateTodoDragState,
  ]);

  const updateTerminalDragState = useCallback((updater) => {
    setTerminalDragState((currentState) => {
      const nextState = typeof updater === "function" ? updater(currentState) : updater;
      terminalDragStateRef.current = nextState || null;
      return nextState || null;
    });
  }, []);

  const handleBeginTerminalDrag = useCallback((event) => {
    if (
      fullscreenActive
      || logicalTerminalIndexes.length <= 1
      || !terminalWorkspace?.id
      || !event?.surfaceRect
      || todoDragActive
    ) {
      return;
    }

    measureTerminalLayout();

    const sourceRows = cloneTerminalRows(displayTerminalRows);
    const sourceRect = event.surfaceRect || event.panelRect;
    const containerRect = terminalPanelsRef.current?.getBoundingClientRect?.();

    if (!sourceRows.length || !sourceRect || !containerRect) {
      return;
    }

    const offsetX = Number(event.clientX || 0) - Number(sourceRect.left || 0);
    const offsetY = Number(event.clientY || 0) - Number(sourceRect.top || 0);
    const nextState = {
      height: Number(sourceRect.height || 0),
      offsetX,
      offsetY,
      paneId: event.paneId || "",
      pointerId: event.pointerId,
      previewRows: sourceRows,
      sourceRows,
      terminalIndex: event.terminalIndex,
      width: Number(sourceRect.width || 0),
      workspaceId: event.workspaceId || terminalWorkspace.id,
      x: Number(event.clientX || 0) - Number(containerRect.left || 0) - offsetX,
      y: Number(event.clientY || 0) - Number(containerRect.top || 0) - offsetY,
    };

    setActiveTerminalPaneId(event.paneId || "");
    updateTerminalDragState(nextState);
  }, [
    displayTerminalRows,
    fullscreenActive,
    logicalTerminalIndexes.length,
    measureTerminalLayout,
    terminalWorkspace?.id,
    todoDragActive,
    updateTerminalDragState,
  ]);

  useEffect(() => {
    if (!todoDragActive) {
      return undefined;
    }

    const previousCursor = document.body.style.cursor;
    const previousTouchAction = document.body.style.touchAction;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.touchAction = "none";
    document.body.style.userSelect = "none";

    const resolveDropTarget = (clientX, clientY) => {
      const containerRect = terminalPanelsRef.current?.getBoundingClientRect?.();
      if (!containerRect) {
        return null;
      }

      return getTodoDropTargetFromPoint({
        clientX,
        clientY,
        containerRect,
        fullscreenTerminalIndex: fullscreenActive ? fullscreenTerminalIndex : null,
        rects: terminalLayoutRectsRef.current,
        terminalIndexes: logicalTerminalIndexes,
      });
    };

    const cancelDrag = () => {
      updateTodoDragState(null);
    };

    const commitDrag = (targetTerminalIndex) => {
      const currentDrag = todoDragStateRef.current;
      if (!currentDrag) {
        return;
      }

      const paneId = Number.isInteger(targetTerminalIndex)
        ? getTerminalPaneId(targetTerminalIndex)
        : "";
      const targetRole = Number.isInteger(targetTerminalIndex)
        ? String(getTerminalRole(targetTerminalIndex) || "").toLowerCase()
        : "";
      const shouldAutoSubmit = !["generic", "terminal", "shell"].includes(targetRole);

      updateTodoDragState(null);

      if (!paneId) {
        return;
      }

      const image = getTodoQueueItemImage(currentDrag);
      const imageInputSupport = Number.isInteger(targetTerminalIndex)
        ? getTerminalImageInputSupport(targetTerminalIndex)
        : { supported: false };

      if (image && !imageInputSupport.supported) {
        setTodoDropError(getTodoImageUnsupportedDropMessage(imageInputSupport));
        return;
      }

      setActiveTerminalPaneId(paneId);
      prepareTodoTerminalText(currentDrag)
        .then((terminalText) => {
          if (!terminalText) {
            throw new Error("Add text, an image, or a pasted note before sending this todo to a terminal.");
          }

          return invoke("terminal_write", {
            data: `${terminalText}${shouldAutoSubmit ? "\r" : ""}`,
            paneId,
          });
        })
        .then(() => {
          setTodoDropError("");
          if (currentDrag.itemId) {
            updateTodoQueueItems((currentItems) => (
              currentItems.filter((item) => item.id !== currentDrag.itemId)
            ));
          }
        })
        .catch((error) => {
          setTodoDropError(getTodoDropErrorMessage(error));
        });
    };

    const handlePointerMove = (event) => {
      const currentDrag = todoDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      event.preventDefault();

      const targetTerminalIndex = resolveDropTarget(event.clientX, event.clientY);
      updateTodoDragState({
        ...currentDrag,
        targetTerminalIndex,
        x: event.clientX - currentDrag.offsetX,
        y: event.clientY - currentDrag.offsetY,
      });
    };

    const handlePointerUp = (event) => {
      const currentDrag = todoDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      event.preventDefault();
      commitDrag(resolveDropTarget(event.clientX, event.clientY));
    };

    const handlePointerCancel = (event) => {
      const currentDrag = todoDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      cancelDrag();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.touchAction = previousTouchAction;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [
    fullscreenActive,
    fullscreenTerminalIndex,
    getTerminalImageInputSupport,
    getTerminalRole,
    getTerminalPaneId,
    logicalTerminalIndexes,
    todoDragActive,
    updateTodoQueueItems,
    updateTodoDragState,
  ]);

  useEffect(() => {
    if (!terminalDragActive) {
      return undefined;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event) => {
      const currentDrag = terminalDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      event.preventDefault();

      const containerRect = terminalPanelsRef.current?.getBoundingClientRect?.();
      if (!containerRect) {
        return;
      }

      const target = getDragTargetFromPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        containerRect,
        draggedTerminalIndex: currentDrag.terminalIndex,
        rects: terminalLayoutRectsRef.current,
        rows: currentDrag.previewRows,
      });
      const nextPreviewRows = insertTerminalInRows(
        currentDrag.previewRows,
        currentDrag.terminalIndex,
        target,
      );

      updateTerminalDragState({
        ...currentDrag,
        previewRows: areTerminalRowsEqual(currentDrag.previewRows, nextPreviewRows)
          ? currentDrag.previewRows
          : nextPreviewRows,
        x: event.clientX - containerRect.left - currentDrag.offsetX,
        y: event.clientY - containerRect.top - currentDrag.offsetY,
      });
    };

    const commitDrag = () => {
      const currentDrag = terminalDragStateRef.current;
      if (!currentDrag) {
        return;
      }

      const nextRows = cloneTerminalRows(currentDrag.previewRows);
      if (!areTerminalRowsEqual(currentDrag.sourceRows, nextRows)) {
        reorderWorkspaceTerminalDisplayLayout?.({
          displayRows: nextRows,
          workspaceId: currentDrag.workspaceId,
        });
      }

      updateTerminalDragState(null);
    };

    const cancelDrag = () => {
      updateTerminalDragState(null);
    };

    const handlePointerUp = (event) => {
      const currentDrag = terminalDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      event.preventDefault();
      commitDrag();
    };

    const handlePointerCancel = (event) => {
      const currentDrag = terminalDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      cancelDrag();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [
    reorderWorkspaceTerminalDisplayLayout,
    terminalDragActive,
    updateTerminalDragState,
  ]);

  const handleToggleFullscreenTerminal = useCallback(({ paneId, panelRect, surfaceRect, terminalIndex }) => {
    if (paneId) {
      setActiveTerminalPaneId(paneId);
    }

    const motion = getFullscreenMotionFromRect(panelRect || surfaceRect);
    clearFullscreenTransitionTimer();

    if (fullscreenActive && fullscreenTerminalIndex === terminalIndex) {
      setFullscreenMotion({
        ...motion,
        phase: "closing",
      });
      fullscreenTransitionTimerRef.current = window.setTimeout(() => {
        fullscreenTransitionTimerRef.current = 0;
        setFullscreenTerminalIndex((currentIndex) => (
          currentIndex === terminalIndex ? null : currentIndex
        ));
        setFullscreenMotion(TERMINAL_FULLSCREEN_DEFAULT_MOTION);
      }, TERMINAL_FULLSCREEN_TRANSITION_MS);
      return;
    }

    const threadId = getTerminalThread(terminalIndex)?.id || "";
    if (terminalWorkspace?.id && threadId) {
      onSelectWorkspaceThread?.(terminalWorkspace.id, threadId);
    }

    setFullscreenTerminalIndex(terminalIndex);
    setFullscreenMotion({
      ...motion,
      phase: "opening",
    });
    fullscreenTransitionTimerRef.current = window.setTimeout(() => {
      fullscreenTransitionTimerRef.current = 0;
      setFullscreenMotion((currentMotion) => (
        currentMotion.phase === "opening"
          ? { ...currentMotion, phase: "open" }
          : currentMotion
      ));
    }, TERMINAL_FULLSCREEN_TRANSITION_MS);
  }, [
    clearFullscreenTransitionTimer,
    fullscreenActive,
    fullscreenTerminalIndex,
    getFullscreenMotionFromRect,
    getTerminalThread,
    onSelectWorkspaceThread,
    terminalWorkspace?.id,
  ]);

  const getTerminalSlotStyle = useCallback((terminalIndex) => {
    const draggingThisTerminal = terminalDragState?.terminalIndex === terminalIndex;
    const fullscreenThisTerminal = fullscreenActive && fullscreenTerminalIndex === terminalIndex;

    if (draggingThisTerminal) {
      return {
        "--terminal-slot-height": `${Math.max(0, terminalDragState.height || 0)}px`,
        "--terminal-slot-width": `${Math.max(0, terminalDragState.width || 0)}px`,
        "--terminal-slot-x": `${terminalDragState.x || 0}px`,
        "--terminal-slot-y": `${terminalDragState.y || 0}px`,
      };
    }

    if (fullscreenThisTerminal && terminalPanelRect) {
      return {
        "--terminal-slot-height": `${Math.max(0, terminalPanelRect.height || 0)}px`,
        "--terminal-slot-width": `${Math.max(0, terminalPanelRect.width || 0)}px`,
        "--terminal-slot-x": "0px",
        "--terminal-slot-y": "0px",
      };
    }

    const rect = terminalLayoutRects[terminalIndex];
    if (!rect) {
      return {
        "--terminal-slot-height": "0px",
        "--terminal-slot-width": "0px",
        "--terminal-slot-x": "0px",
        "--terminal-slot-y": "0px",
      };
    }

    return {
      "--terminal-slot-height": `${Math.max(0, rect.height || 0)}px`,
      "--terminal-slot-width": `${Math.max(0, rect.width || 0)}px`,
      "--terminal-slot-x": `${rect.left || 0}px`,
      "--terminal-slot-y": `${rect.top || 0}px`,
    };
  }, [
    fullscreenActive,
    fullscreenTerminalIndex,
    terminalDragState,
    terminalLayoutRects,
    terminalPanelRect,
  ]);

  const todoQueueVisible = Boolean(
    hasVisibleWorkspaceTerminalPanes
    && terminalWorkspaceMainWidth >= TODO_QUEUE_VISIBLE_MIN_WIDTH,
  );
  const todoDragImage = getTodoQueueItemImage(todoDragState);
  const todoDragNote = getTodoQueueItemNote(todoDragState);
  const todoDragHasPreview = Boolean(todoDragImage || todoDragNote);
  const terminalWorkspaceContent = hasVisibleWorkspaceTerminalPanes ? (
    <WorkspaceTerminalPanels
      data-terminal-dragging={terminalDragActive ? "true" : "false"}
      data-terminal-fullscreen={fullscreenActive ? "true" : "false"}
      data-terminal-fullscreen-state={fullscreenState}
      data-todo-dragging={todoDragActive ? "true" : "false"}
      ref={terminalPanelsRef}
      style={fullscreenMotionStyle}
    >
      <ResizePanelGroup
        id={`workspace-terminal-rows-${terminalWorkspace.id}`}
        orientation="vertical"
      >
        {activeDisplayRows.map((row, rowOrderIndex) => (
          <Fragment key={`row-${row.rowIndex}`}>
            {rowOrderIndex > 0 && (
              <ResizeHandle
                data-direction="vertical"
              />
            )}
            <ResizePanel
              data-terminal-row="true"
              defaultSize={`${100 / activeDisplayRows.length}%`}
              id={`workspace-terminal-row-${terminalWorkspace.id}-${row.rowIndex}`}
              minSize={getTerminalPaneMinSizePercent(activeDisplayRows.length)}
            >
              <ResizePanelGroup
                id={`workspace-terminal-cols-${terminalWorkspace.id}-${row.rowIndex}`}
                orientation="horizontal"
              >
                {row.terminalIndexes.map((terminalIndex, columnIndex) => (
                  <Fragment key={`${terminalWorkspace.id}-${terminalIndex}`}>
                    {columnIndex > 0 && (
                      <ResizeHandle
                        data-direction="horizontal"
                      />
                    )}
                    <ResizePanel
                      data-terminal-column="true"
                      data-terminal-leaf="true"
                      defaultSize={`${100 / row.terminalIndexes.length}%`}
                      id={`workspace-terminal-col-${terminalWorkspace.id}-${terminalIndex}`}
                      minSize={getTerminalPaneMinSizePercent(row.terminalIndexes.length)}
                    >
                      <TerminalPanelAnchor
                        data-terminal-drag-placeholder={
                          terminalDragState?.terminalIndex === terminalIndex ? "true" : undefined
                        }
                        data-terminal-index={terminalIndex}
                        data-terminal-panel-anchor="true"
                      />
                    </ResizePanel>
                  </Fragment>
                ))}
              </ResizePanelGroup>
            </ResizePanel>
          </Fragment>
        ))}
      </ResizePanelGroup>
      <TerminalSurfaceLayer aria-hidden={false}>
        {logicalTerminalIndexes.map((terminalIndex) => {
          const draggingThisTerminal = terminalDragState?.terminalIndex === terminalIndex;
          const fullscreenThisTerminal = fullscreenActive && terminalIndex === fullscreenTerminalIndex;
          const hasMeasuredRect = Boolean(terminalLayoutRects[terminalIndex])
            || draggingThisTerminal
            || fullscreenThisTerminal;

          return (
            <TerminalSurfaceSlot
              data-terminal-dragging={draggingThisTerminal ? "true" : "false"}
              data-terminal-fullscreen={fullscreenThisTerminal ? "true" : "false"}
              data-terminal-hidden={hasMeasuredRect ? "false" : "true"}
              key={`${terminalWorkspace.id}-${terminalIndex}`}
              style={getTerminalSlotStyle(terminalIndex)}
            >
              <WorkspaceTerminal
                key={`${terminalWorkspace.id}-${terminalIndex}-${getTerminalRole(terminalIndex)}-${terminalWorkspaceWorkingDirectory || ""}`}
                agent={getTerminalAgent(terminalIndex)}
                agentLaunchEpoch={workspaceAgentLaunchEpoch}
                agentLaunchReady={workspaceTerminalAgentLaunchReady}
                agentStatuses={agentStatuses}
                agentStatusError={agentStatusError}
                agentStatusState={agentStatusState}
                fullscreenState={fullscreenState}
                isActive={activePaneId === getTerminalPaneId(terminalIndex)}
                isFullscreen={fullscreenThisTerminal}
                onActivateTerminal={handleActivateTerminalPane}
                onBeginTerminalDrag={handleBeginTerminalDrag}
                onChangeTerminalRole={changeWorkspaceTerminalRole}
                onCloseTerminal={closeWorkspaceTerminal}
                onCreateWorkspaceThreadTerminal={createWorkspaceThreadTerminal}
                onOpenSettings={showSettingsView}
                onArchiveWorkspaceThread={onArchiveWorkspaceThread}
                onPreparedTerminalChange={handlePreparedTerminalChange}
                onRecheckAgents={refreshAgentStatuses}
                onSplitTerminal={handleSplitTerminal}
                onSelectWorkspaceThread={onSelectWorkspaceThread}
                onThreadTerminalLifecycle={onThreadTerminalLifecycle}
                onToggleFullscreenTerminal={handleToggleFullscreenTerminal}
                prewarmShell={shouldPrewarmWorkspaceTerminals}
                terminalCount={terminalWorkspaceLogicalTerminalCount}
                terminalIndex={terminalIndex}
                terminalRole={getTerminalRole(terminalIndex)}
                thread={getTerminalThread(terminalIndex)}
                threadsViewActive={fullscreenThisTerminal}
                todoDropActive={todoDragActive}
                todoDropTarget={todoDragState?.targetTerminalIndex === terminalIndex}
                workingDirectory={terminalWorkspaceWorkingDirectory}
                workspace={terminalWorkspace}
                workspaceError={workspaceError}
                workspaceThreads={workspaceThreads}
                workspaces={workspaces}
                selectedWorkspaceThreadId={selectedWorkspaceThreadId}
              />
            </TerminalSurfaceSlot>
          );
        })}
      </TerminalSurfaceLayer>
    </WorkspaceTerminalPanels>
  ) : !hasWorkspaceTerminals ? (
    <WorkspaceTerminal
      key={`${terminalWorkspace?.id || "empty"}-${logicalTerminalIndexes[0] || 0}-${getTerminalRole(logicalTerminalIndexes[0] || 0)}-${terminalWorkspaceWorkingDirectory || ""}`}
      agent={terminalWorkspace ? workspaceTerminalRenderAgent : null}
      agentLaunchEpoch={workspaceAgentLaunchEpoch}
      agentLaunchReady={workspaceTerminalAgentLaunchReady}
      agentStatuses={agentStatuses}
      agentStatusError={agentStatusError}
      agentStatusState={agentStatusState}
      fullscreenState="idle"
      isActive={activePaneId === getTerminalPaneId(logicalTerminalIndexes[0] || 0)}
      isFullscreen={false}
      onActivateTerminal={handleActivateTerminalPane}
      onChangeTerminalRole={changeWorkspaceTerminalRole}
      onCloseTerminal={closeWorkspaceTerminal}
      onCreateWorkspaceThreadTerminal={createWorkspaceThreadTerminal}
      onOpenSettings={showSettingsView}
      onArchiveWorkspaceThread={onArchiveWorkspaceThread}
      onPreparedTerminalChange={handlePreparedTerminalChange}
      onRecheckAgents={refreshAgentStatuses}
      onSplitTerminal={handleSplitTerminal}
      onSelectWorkspaceThread={onSelectWorkspaceThread}
      onThreadTerminalLifecycle={onThreadTerminalLifecycle}
      onToggleFullscreenTerminal={handleToggleFullscreenTerminal}
      prewarmShell={terminalWorkspace ? shouldPrewarmWorkspaceTerminals : false}
      terminalCount={terminalWorkspaceLogicalTerminalCount}
      terminalIndex={logicalTerminalIndexes[0] || 0}
      terminalRole={getTerminalRole(logicalTerminalIndexes[0] || 0)}
      thread={getTerminalThread(logicalTerminalIndexes[0] || 0)}
      threadsViewActive={false}
      workingDirectory={terminalWorkspaceWorkingDirectory}
      workspace={terminalWorkspace}
      workspaceError={workspaceError}
      workspaceThreads={workspaceThreads}
      workspaces={workspaces}
      selectedWorkspaceThreadId={selectedWorkspaceThreadId}
    />
  ) : null;

  return (
    <ForgeWorkspace aria-label="Forge workspace" data-motion={viewMotion}>
      {shouldShowWorkspaceSetup ? (
        <WorkspaceSetupPanel onSubmit={createFirstWorkspace}>
          <SetupHeader>
            <Kicker>First workspace</Kicker>
            <DashboardTitle>Create your workspace</DashboardTitle>
            <PageSubline>Name it, then the workspace syncs through the protected API.</PageSubline>
          </SetupHeader>
          {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
          <SetupField>
            <SettingsLabel>Workspace name</SettingsLabel>
            <SetupInput
              maxLength={80}
              onChange={(event) => setWorkspaceName(event.target.value)}
              placeholder="My workspace"
              value={workspaceName}
            />
          </SetupField>
          <PrimaryButton disabled={workspaceSyncState === "creating"} type="submit">
            <ButtonForgeIcon aria-hidden="true" />
            <span>{workspaceSyncState === "creating" ? "Creating..." : "Create workspace"}</span>
          </PrimaryButton>
        </WorkspaceSetupPanel>
      ) : (
          <TerminalWorkspaceMain ref={terminalWorkspaceMainRef}>
            {hasVisibleWorkspaceTerminalPanes ? (
              <ResizePanelGroup
                id={`workspace-terminal-main-${terminalWorkspace.id}`}
                orientation="horizontal"
              >
                <ResizePanel
                  defaultSize={todoQueueVisible ? "76%" : "100%"}
                  id={`workspace-terminal-main-grid-${terminalWorkspace.id}`}
                  minSize={todoQueueVisible ? "54%" : "100%"}
                >
                  {terminalWorkspaceContent}
                </ResizePanel>
                {todoQueueVisible && (
                  <>
                    <ResizeHandle data-direction="horizontal" />
                    <ResizePanel
                      defaultSize="24%"
                      id={`workspace-terminal-todo-queue-${terminalWorkspace.id}`}
                      maxSize="36%"
                      minSize="18%"
                    >
                      <TodoQueuePanel
                        activeDragItemId={todoDragState?.itemId || ""}
                        defaultWorkingDirectory={defaultWorkingDirectory}
                        draft={todoQueueDraft}
                        dropError={todoDropError}
                        items={todoQueueItems}
                        onBeginTodoDrag={handleBeginTodoDrag}
                        onDraftChange={setTodoQueueDraft}
                        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
                        onRemoveItem={removeTodoQueueItem}
                        onReorderItem={reorderTodoQueueItem}
                        onSubmitDraft={submitTodoQueueDraft}
                        onUpdateItem={updateTodoQueueItemText}
                        rootDirectory={terminalWorkspaceWorkingDirectory || defaultWorkingDirectory}
                        workspace={terminalWorkspace}
                        workspaceError={workspaceError}
                        workspaceId={terminalWorkspace.id}
                      />
                    </ResizePanel>
                  </>
                )}
              </ResizePanelGroup>
            ) : terminalWorkspaceContent}
            {todoDragState && (
              <TodoDragPreview
                aria-hidden="true"
                style={{
                  "--todo-drag-width": `${Math.max(220, Number(todoDragState.width || 0))}px`,
                  "--todo-drag-x": `${Math.round(Number(todoDragState.x || 0))}px`,
                  "--todo-drag-y": `${Math.round(Number(todoDragState.y || 0))}px`,
                }}
              >
                <TodoQueueItemContent data-has-preview={todoDragHasPreview ? "true" : "false"}>
                  {todoDragImage && (
                    <TodoQueueItemImageFrame>
                      <TodoQueueItemImage alt="" src={todoDragImage.src} />
                    </TodoQueueItemImageFrame>
                  )}
                  {!todoDragImage && todoDragNote && (
                    <TodoQueueItemNoteFrame>
                      <TodoQueueItemNoteTitle>{todoDragNote.title}</TodoQueueItemNoteTitle>
                      <TodoQueueItemNoteIcon aria-hidden="true" />
                    </TodoQueueItemNoteFrame>
                  )}
                  {normalizeTodoQueueText(todoDragState.text) && (
                    <TodoDragPreviewText>{todoDragState.text}</TodoDragPreviewText>
                  )}
                </TodoQueueItemContent>
              </TodoDragPreview>
            )}
          </TerminalWorkspaceMain>
      )}
    </ForgeWorkspace>
  );
}

export default memo(TerminalView);

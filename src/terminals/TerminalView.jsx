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

function TerminalView({
  terminalWorkspace,
  terminalAgentsByIndex = {},
  terminalRolesByIndex = {},
  terminalWorkspaceWorkingDirectory,
  terminalWorkspaceLogicalIndexes,
  terminalWorkspaceLogicalTerminalCount,
  agentStatusError,
  agentStatuses,
  agentStatusState,
  changeWorkspaceTerminalRole,
  closeWorkspaceTerminal,
  createFirstWorkspace,
  handlePreparedTerminalChange,
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
}) {
  const hasWorkspaceTerminals = Boolean(terminalWorkspace);
  const logicalTerminalIndexes = Array.isArray(terminalWorkspaceLogicalIndexes)
    ? terminalWorkspaceLogicalIndexes
    : [];
  const displayTerminalRows = Array.isArray(terminalDisplayRows)
    ? terminalDisplayRows
    : [];
  const activeDisplayRows = terminalDragState?.previewRows || displayTerminalRows;
  const activeDisplayRowsSignature = serializeTerminalRows(activeDisplayRows);
  const terminalDragActive = Boolean(terminalDragState);
  const hasVisibleWorkspaceTerminalPanes = hasWorkspaceTerminals && displayTerminalRows.length > 0;
  const [activeTerminalPaneId, setActiveTerminalPaneId] = useState("");
  const [fullscreenTerminalIndex, setFullscreenTerminalIndex] = useState(null);
  const [fullscreenMotion, setFullscreenMotion] = useState(TERMINAL_FULLSCREEN_DEFAULT_MOTION);
  const [terminalLayoutRects, setTerminalLayoutRects] = useState({});
  const [terminalPanelRect, setTerminalPanelRect] = useState(null);
  const [terminalDragState, setTerminalDragState] = useState(null);
  const fullscreenTransitionTimerRef = useRef(0);
  const layoutMeasureFrameRef = useRef(0);
  const terminalDragStateRef = useRef(null);
  const terminalLayoutRectsRef = useRef({});
  const terminalPanelRectRef = useRef(null);
  const terminalPanelsRef = useRef(null);
  const getTerminalAgent = useCallback((terminalIndex) => (
    Object.prototype.hasOwnProperty.call(terminalAgentsByIndex, terminalIndex)
      ? terminalAgentsByIndex[terminalIndex]
      : workspaceTerminalRenderAgent
  ), [terminalAgentsByIndex, workspaceTerminalRenderAgent]);
  const getTerminalRole = useCallback((terminalIndex) => (
    terminalRolesByIndex[terminalIndex] || getTerminalAgent(terminalIndex)?.id || ""
  ), [getTerminalAgent, terminalRolesByIndex]);
  const getTerminalPaneId = useCallback((terminalIndex) => {
    const role = getTerminalRole(terminalIndex);
    const agent = getTerminalAgent(terminalIndex);
    const paneAgentId = String(role || "").toLowerCase() === "generic"
      ? "generic"
      : agent?.id;

    return getWorkspaceTerminalPaneId(terminalWorkspace?.id, terminalIndex, paneAgentId);
  }, [getTerminalAgent, getTerminalRole, terminalWorkspace?.id]);
  const visibleTerminalPaneIds = useMemo(() => (
    terminalWorkspace
      ? logicalTerminalIndexes.map((terminalIndex) => getTerminalPaneId(terminalIndex))
      : []
  ), [getTerminalPaneId, logicalTerminalIndexes, terminalWorkspace]);
  const visibleTerminalPaneIdSignature = visibleTerminalPaneIds.join("|");
  const activePaneId = activeTerminalPaneId || visibleTerminalPaneIds[0] || "";
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
    updateTerminalDragState,
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
          <TerminalWorkspaceMain>
            {hasVisibleWorkspaceTerminalPanes ? (
              <WorkspaceTerminalPanels
                data-terminal-dragging={terminalDragActive ? "true" : "false"}
                data-terminal-fullscreen={fullscreenActive ? "true" : "false"}
                data-terminal-fullscreen-state={fullscreenState}
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
                          onOpenSettings={showSettingsView}
                          onPreparedTerminalChange={handlePreparedTerminalChange}
                          onRecheckAgents={refreshAgentStatuses}
                          onSplitTerminal={handleSplitTerminal}
                          onToggleFullscreenTerminal={handleToggleFullscreenTerminal}
                          prewarmShell={shouldPrewarmWorkspaceTerminals}
                          terminalCount={terminalWorkspaceLogicalTerminalCount}
                          terminalIndex={terminalIndex}
                          terminalRole={getTerminalRole(terminalIndex)}
                          workingDirectory={terminalWorkspaceWorkingDirectory}
                          workspace={terminalWorkspace}
                          workspaceError={workspaceError}
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
                onOpenSettings={showSettingsView}
                onPreparedTerminalChange={handlePreparedTerminalChange}
                onRecheckAgents={refreshAgentStatuses}
                onSplitTerminal={handleSplitTerminal}
                onToggleFullscreenTerminal={handleToggleFullscreenTerminal}
                prewarmShell={terminalWorkspace ? shouldPrewarmWorkspaceTerminals : false}
                terminalCount={terminalWorkspaceLogicalTerminalCount}
                terminalIndex={logicalTerminalIndexes[0] || 0}
                terminalRole={getTerminalRole(logicalTerminalIndexes[0] || 0)}
                workingDirectory={terminalWorkspaceWorkingDirectory}
                workspace={terminalWorkspace}
                workspaceError={workspaceError}
              />
            ) : null}
          </TerminalWorkspaceMain>
      )}
    </ForgeWorkspace>
  );
}

export default memo(TerminalView);

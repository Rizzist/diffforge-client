import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  GlobalStyle,
  AppFrame,
  WindowTitleBar,
  WindowTitle,
  WindowControls,
  WindowControlButton,
  AppContent,
  workspaceCloseSpin,
  WorkspaceCloseOverlay,
  WorkspaceClosePanel,
  WorkspaceCloseSpinner,
  WorkspaceCloseTitle,
  WorkspaceCloseDetail,
  WorkspaceCloseCounter,
  WorkspaceCloseProgressTrack,
  WorkspaceCloseProgressBar,
  splashPulse,
  loadingOrangeSweep,
  shellReveal,
  railReveal,
  sideReveal,
  panelEnter,
  panelExit,
  quietSweep,
  squareFade,
  SplashScreen,
  AmbientPanel,
  SplashCenter,
  SplashLogo,
  SplashTitle,
  SplashTagline,
  LoadingTrack,
  LoadingFill,
  LoadingText,
  LoadingDetail,
  LaunchStatusPanel,
  LaunchStatusIcon,
  LaunchStatusCopy,
  LaunchActions,
  LoginScreen,
  LoginLayout,
  SquareField,
  SquarePulse,
  BrandPanel,
  BrandMark,
  IntroCopy,
  Kicker,
  Headline,
  Lede,
  IntroFeatureList,
  IntroFeature,
  ApiStatus,
  StatusSummary,
  StatusBadge,
  iconPulse,
  statusIconSize,
  ConnectedIcon,
  ErrorIcon,
  PendingIcon,
  StatusButton,
  ApiBase,
  PricingScreen,
  PricingHero,
  PricingCopy,
  PricingTitle,
  PricingText,
  PricingActions,
  PricingPlans,
  PricingPlanCard,
  PlanEyebrow,
  PlanPrice,
  PlanDescription,
  PlanFeatureList,
  AuthenticatedWorkspaceFrame,
  WorkspaceStartupOverlay,
  DashboardShell,
  WorkspaceRail,
  RailTop,
  RailSectionTitle,
  WorkspaceList,
  WorkspaceRow,
  WorkspaceButton,
  WorkspaceLabel,
  WorkspaceSettingsButton,
  WorkspaceAccent,
  WorkspaceMuted,
  RailFooter,
  RailActionButton,
  BlankWorkspace,
  ForgeWorkspace,
  TerminalWorkspaceSurface,
  WorkspaceTerminalPanels,
  ResizePanelGroup,
  ResizePanel,
  ResizeHandle,
  TerminalDevMetricsBar,
  TerminalDevMetric,
  TerminalFrame,
  XtermSurface,
  TerminalClosedSurface,
  TerminalClosedLabel,
  TerminalClosingOverlay,
  TerminalRestartPill,
  TerminalAgentIdBadge,
  TerminalRestartButton,
  TerminalCloseButton,
  TerminalEmptyPanel,
  TerminalEmptyActions,
  TerminalEmptyCopy,
  TerminalAgentList,
  TerminalAgentRow,
  FilesWorkspaceSurface,
  FileExplorerPane,
  FileExplorerHeader,
  FileExplorerActions,
  FileIconButton,
  FileRootPath,
  FileTree,
  FileTreeItem,
  FileTreeButton,
  FileDisclosure,
  FileKindIcon,
  FileTreeName,
  FileGitStatusMark,
  FileTreeChildren,
  FileTreeMessage,
  FileTreeEmpty,
  FilePreviewPane,
  FilePreviewHeader,
  FilePreviewTitle,
  FilePreviewMeta,
  FileGitStatusPill,
  FileMetaPill,
  FilePreviewPath,
  FileContentFrame,
  FilePreviewScroll,
  HighlightedCodeBlock,
  FileDiffPanel,
  FileDiffHeader,
  FileDiffBadge,
  FileDiffMessage,
  DiffCodeBlock,
  DiffLine,
  FileEmptyState,
  FileEmptyIcon,
  VaultWorkspaceSurface,
  VaultPlaceholderPanel,
  VaultPlaceholderIcon,
  VaultStatusGrid,
  AudioWorkspaceSurface,
  AudioSetupPanel,
  AudioHeroRow,
  AudioStatePill,
  AudioStatusGrid,
  AudioPathBlock,
  AudioCodePath,
  AudioRuntimeHint,
  AudioProgressPanel,
  AudioProgressTopline,
  AudioProgressTrack,
  AudioProgressBar,
  AudioProgressMeta,
  AudioActionRow,
  AudioWidgetShell,
  AudioWidgetHeader,
  AudioWidgetTitle,
  AudioWidgetMeter,
  AudioWidgetStatus,
  AudioRecordingTimer,
  AudioWidgetTranscript,
  AudioWidgetActions,
  McpWorkspaceSurface,
  McpHeaderPanel,
  McpTitleRow,
  McpStatsGrid,
  McpLayout,
  McpRegistryPanel,
  McpPanelTopline,
  McpServerList,
  McpServerButton,
  McpServerIcon,
  McpServerCopy,
  McpStatusBadge,
  McpEditorPanel,
  McpEditorHeader,
  McpSwitchButton,
  McpFieldGrid,
  McpWideField,
  McpInput,
  McpTextarea,
  McpJsonTextarea,
  McpTransportTabs,
  McpTransportButton,
  McpAccessGrid,
  McpAccessPanel,
  McpAccessTopline,
  McpInlineActions,
  McpCheckList,
  McpCheckRow,
  McpEmptyAccess,
  McpScopePreview,
  McpEditorActions,
  WorkspaceSetupPanel,
  SetupHeader,
  SetupField,
  SetupInput,
  BlankStatusStack,
  WorkspaceSettingsOverlay,
  WorkspaceSettingsDialog,
  WorkspaceSettingsDialogHeader,
  WorkspaceModalCloseButton,
  WorkspaceSettingsForm,
  WorkspaceSettingsInput,
  WorkspaceNumberInput,
  RootDirectoryInput,
  WorkspaceSettingsFieldGrid,
  WorkspaceSettingsActions,
  AgentSettingsPanel,
  AgentPanelActions,
  AgentReadyPill,
  AgentCardGrid,
  AgentCard,
  AgentCardHeader,
  AgentIcon,
  AgentName,
  AgentMeta,
  AgentStatusText,
  AgentInstallPanel,
  AgentInstallTopline,
  AgentInstallBadge,
  AgentInstallHint,
  AgentInstallActions,
  AgentInstallCommand,
  AgentPermissionHint,
  AgentInstallMessage,
  AgentActions,
  AgentActionTooltip,
  PageHeader,
  PageSubline,
  DashboardTitle,
  PanelHeaderRow,
  PanelKicker,
  PanelHeading,
  SettingsPage,
  AccountSettingsPanel,
  AccountCard,
  AccountCardHeader,
  AccountCardFooter,
  SettingsLabel,
  SettingsValue,
  SettingsHint,
  SettingsIdentityGrid,
  SettingsIdentityItem,
  LoginCard,
  LoginPanel,
  SessionPanel,
  LoginCardTop,
  LoginCardBadge,
  LoginIconWrap,
  SuccessBadge,
  SessionTitle,
  SessionText,
  AuthStepRail,
  AuthStep,
  PrimaryButton,
  SecondaryButton,
  PrimaryDangerButton,
  FormMessage,
  buttonIconSize,
  titleIconSize,
  TitleMinimizeIcon,
  TitleMaximizeIcon,
  TitleRestoreIcon,
  TitleCloseIcon,
  ButtonRefreshIcon,
  ButtonAddIcon,
  ButtonLoginIcon,
  ButtonBrowserIcon,
  ButtonCloseIcon,
  ButtonFolderIcon,
  ButtonLogoutIcon,
  ButtonSettingsIcon,
  ButtonForgeIcon,
  ButtonCodeIcon,
  ButtonBotIcon,
  ButtonTerminalIcon,
  ButtonKeyIcon,
  ButtonMicIcon,
  ButtonHubIcon,
  ButtonCheckIcon,
  FileChevronIcon,
  FileExpandIcon,
  FileFolderTreeIcon,
  FileDocumentIcon
} from "../app/appStyles";
import { createTerminalResizeController, measureTerminalGrid } from "./terminalResizeController";
import { addTerminalMetrics, getWorkspaceOpenTelemetryFields, patchTerminalMetrics, writeTerminalTelemetry } from "./terminalTelemetry.jsx";

const TERMINAL_THEME_BACKGROUND = "#020304";
const WORKSPACE_TERMINAL_PANE_PREFIX = "workspace-terminal";
const MIN_WORKSPACE_TERMINAL_COUNT = 1;
const MAX_WORKSPACE_TERMINAL_COUNT = 12;
const WORKSPACE_TERMINAL_PRIMARY_COLUMNS = 2;
const WORKSPACE_TERMINAL_WIDE_START_INDEX = 4;
const WORKSPACE_TERMINAL_WIDE_COLUMNS = 4;
const TERMINAL_DEFAULT_COLS = 80;
const TERMINAL_DEFAULT_ROWS = 24;
const TERMINAL_MIN_COLS = 20;
const TERMINAL_MIN_ROWS = 6;
const TERMINAL_MAX_COLS = 400;
const TERMINAL_MAX_ROWS = 160;
const TERMINAL_ENABLE_WEBGL_RENDERER = false;
const TERMINAL_START_METRIC_WAIT_MS = 900;
const TERMINAL_START_METRIC_POLL_MS = 16;
const TERMINAL_DEFAULT_SCROLLBACK_ROWS = 10000;
const TERMINAL_WEBGL_IDLE_DELAY_MS = 420;
const TERMINAL_WEBGL_FIRST_OUTPUT_DELAY_MS = 80;
const TERMINAL_WEBGL_STAGGER_MS = 90;
const TERMINAL_WEBGL_MAX_DELAY_MS = 1200;
const TERMINAL_RENDER_PROBE_AFTER_WRITE_MS = 80;
const TERMINAL_RENDER_PROBE_AFTER_WEBGL_MS = 140;
const TERMINAL_RENDER_PROBE_AFTER_RESIZE_MS = 80;
const TERMINAL_RESIZE_DEBUG_IDLE_MS = 140;
const TERMINAL_RESIZE_DEBUG_RECENT_MS = 1800;
const TERMINAL_RESIZE_DEBUG_PROBE_DELAYS_MS = [0, 16, 80, 180, 360];
const TERMINAL_XTERM_RENDER_LOG_MIN_MS = 120;
const TERMINAL_BLANK_STARTUP_PROBE_MS = 800;
const TERMINAL_BLANK_STARTUP_CONFIRM_MS = 800;
const TERMINAL_BLANK_STARTUP_RESTART_DELAY_MS = 800;
const TERMINAL_BLANK_STARTUP_RESTART_LIMIT = 3;
const TERMINAL_SCROLLBAR_HIDE_DELAY_MS = 700;
const TERMINAL_SCROLLBAR_INTENT_MS = 900;
const TERMINAL_SCROLL_ANCHOR_TARGET_FRACTION = 0.6;
const TERMINAL_SCROLL_ANCHOR_SEARCH_RADIUS_ROWS = 180;
const TERMINAL_SCROLL_ANCHOR_MAX_TEXT_CHARS = 360;
const TERMINAL_SCROLL_ANCHOR_MIN_ALNUM_CHARS = 2;
const TERMINAL_AGENT_ID_SUFFIXES = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const TERMINAL_AGENT_COLOR_SLOT_COUNT = 16;
const TERMINAL_AUDIO_INPUT_REFOCUS_EVENT = "forge-terminal-audio-input-refocus";

function normalizeWorkspaceTerminalCount(value) {
  const count = Number.parseInt(value, 10);

  if (!Number.isFinite(count)) {
    return MIN_WORKSPACE_TERMINAL_COUNT;
  }

  return Math.min(MAX_WORKSPACE_TERMINAL_COUNT, Math.max(MIN_WORKSPACE_TERMINAL_COUNT, count));
}

function getErrorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function isTerminalSessionMissingError(error) {
  const message = getErrorMessage(error, "").toLowerCase();

  return message.includes("terminal session is not running")
    || message.includes("terminal session not running");
}

let nextWorkspaceTerminalInstanceId = 1;

function getSafePaneToken(value) {
  const token = String(value || "workspace")
    .replace(/[^a-zA-Z0-9_-]/g, "-")
    .slice(0, 48);

  return token || "workspace";
}

export function getWorkspaceTerminalPaneId(workspaceId, terminalIndex, agentId = "agent") {
  return `${WORKSPACE_TERMINAL_PANE_PREFIX}-${getSafePaneToken(workspaceId)}-${terminalIndex}-${agentId || "agent"}`;
}

function getTerminalAgentKind(agentId) {
  const normalizedAgentId = String(agentId || "").toLowerCase();

  if (normalizedAgentId.includes("claude")) {
    return "claude";
  }

  if (normalizedAgentId.includes("codex")) {
    return "codex";
  }

  return "agent";
}

function getAgentTone(agent) {
  if (!agent?.installed) {
    return "offline";
  }

  return agent.authenticated ? "ready" : "needsAuth";
}

function getAgentStatusSummary(agentStatuses) {
  if (!Array.isArray(agentStatuses)) {
    return [];
  }

  const codex = agentStatuses.find((agent) => agent.id === "codex");
  const claude = agentStatuses.find((agent) => agent.id === "claude");

  return [codex, claude].filter(Boolean);
}

function getTerminalAgentId(agentId, terminalIndex) {
  const kind = getTerminalAgentKind(agentId);
  const prefix = kind === "claude" ? "CL" : kind === "codex" ? "CX" : "AG";
  const safeIndex = Math.max(0, Number.parseInt(terminalIndex, 10) || 0);
  const suffix = TERMINAL_AGENT_ID_SUFFIXES[safeIndex % TERMINAL_AGENT_ID_SUFFIXES.length] || "A";

  return `${prefix}${suffix}`;
}

function getTerminalAgentColorSlot(terminalIndex) {
  const safeIndex = Math.max(0, Number.parseInt(terminalIndex, 10) || 0);

  return String(safeIndex % TERMINAL_AGENT_COLOR_SLOT_COUNT);
}

export function getDefaultTerminalIndexes(count) {
  const terminalCount = normalizeWorkspaceTerminalCount(count);

  return Array.from({ length: terminalCount }, (_, index) => index);
}

export function normalizeWorkspaceTerminalIndexes(indexes, count) {
  const terminalCount = normalizeWorkspaceTerminalCount(count);
  const usedIndexes = new Set();
  const normalizedIndexes = [];

  if (Array.isArray(indexes)) {
    indexes.forEach((index) => {
      const terminalIndex = Number.parseInt(index, 10);

      if (
        Number.isInteger(terminalIndex)
        && terminalIndex >= 0
        && terminalIndex < MAX_WORKSPACE_TERMINAL_COUNT
        && !usedIndexes.has(terminalIndex)
      ) {
        usedIndexes.add(terminalIndex);
        normalizedIndexes.push(terminalIndex);
      }
    });
  }

  let nextIndex = 0;

  while (normalizedIndexes.length < terminalCount) {
    if (!usedIndexes.has(nextIndex)) {
      usedIndexes.add(nextIndex);
      normalizedIndexes.push(nextIndex);
    }

    nextIndex += 1;
  }

  return normalizedIndexes.slice(0, terminalCount);
}

export function closeWorkspaceTerminalPane({
  agentId,
  nextTerminalCount,
  previousTerminalCount,
  reason,
  terminalIndex,
  workspaceId,
}) {
  const paneId = getWorkspaceTerminalPaneId(workspaceId, terminalIndex, agentId);

  writeTerminalTelemetry({
    paneId,
    phase: "frontend.workspace.terminal.close_removed_start",
    fields: {
      agentId,
      nextTerminalCount,
      previousTerminalCount,
      reason,
      terminalIndex,
      workspaceId,
    },
  });

  invoke("terminal_close", { paneId })
    .then(() => {
      writeTerminalTelemetry({
        paneId,
        phase: "frontend.workspace.terminal.close_removed_done",
        fields: {
          agentId,
          nextTerminalCount,
          previousTerminalCount,
          reason,
          terminalIndex,
          workspaceId,
        },
      });
    })
    .catch((error) => {
      writeTerminalTelemetry({
        paneId,
        phase: "frontend.workspace.terminal.close_removed_error",
        fields: {
          agentId,
          error: getErrorMessage(error, "Unable to close removed terminal."),
          nextTerminalCount,
          previousTerminalCount,
          reason,
          terminalIndex,
          workspaceId,
        },
      });
    });
}

export function getTerminalPanelRows(terminalIndexes) {
  const indexes = Array.isArray(terminalIndexes)
    ? terminalIndexes
    : getDefaultTerminalIndexes(terminalIndexes);
  const visibleIndexes = indexes.length ? indexes : getDefaultTerminalIndexes(MIN_WORKSPACE_TERMINAL_COUNT);
  const rows = new Map();

  visibleIndexes.forEach((terminalIndex) => {
    const safeIndex = Math.max(0, Number.parseInt(terminalIndex, 10) || 0);
    const isPrimarySlot = safeIndex < WORKSPACE_TERMINAL_WIDE_START_INDEX;
    const rowIndex = isPrimarySlot
      ? Math.floor(safeIndex / WORKSPACE_TERMINAL_PRIMARY_COLUMNS)
      : Math.floor(WORKSPACE_TERMINAL_WIDE_START_INDEX / WORKSPACE_TERMINAL_PRIMARY_COLUMNS)
        + Math.floor((safeIndex - WORKSPACE_TERMINAL_WIDE_START_INDEX) / WORKSPACE_TERMINAL_WIDE_COLUMNS);
    const columnIndex = isPrimarySlot
      ? safeIndex % WORKSPACE_TERMINAL_PRIMARY_COLUMNS
      : (safeIndex - WORKSPACE_TERMINAL_WIDE_START_INDEX) % WORKSPACE_TERMINAL_WIDE_COLUMNS;

    if (!rows.has(rowIndex)) {
      rows.set(rowIndex, []);
    }

    rows.get(rowIndex).push({ columnIndex, terminalIndex: safeIndex });
  });

  return Array.from(rows.entries())
    .sort(([leftRow], [rightRow]) => leftRow - rightRow)
    .map(([rowIndex, rowTerminals]) => ({
      rowIndex,
      terminalIndexes: rowTerminals
        .sort((left, right) => left.columnIndex - right.columnIndex)
        .map(({ terminalIndex }) => terminalIndex),
    }));
}

function getNextWorkspaceTerminalInstanceId() {
  const instanceId = nextWorkspaceTerminalInstanceId;
  nextWorkspaceTerminalInstanceId = nextWorkspaceTerminalInstanceId >= Number.MAX_SAFE_INTEGER
    ? 1
    : nextWorkspaceTerminalInstanceId + 1;

  return instanceId;
}

function normalizeTerminalDimension(value, fallback, minimum, maximum) {
  const dimension = Number.isFinite(value) ? Math.floor(value) : fallback;

  return Math.min(maximum, Math.max(minimum, dimension));
}

export function getTerminalPaneMinSizePercent(panelCount) {
  const count = Math.max(1, Number.parseInt(panelCount, 10) || 1);
  const fairShare = 100 / count;
  const minimum = Math.max(5, Math.min(18, fairShare * 0.55));

  return `${minimum.toFixed(2)}%`;
}

function getElementDiagnostics(element) {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    display: style.display,
    visibility: style.visibility,
    opacity: Number.parseFloat(style.opacity || "1"),
    overflow: style.overflow,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    position: style.position,
    zIndex: style.zIndex,
    pointerEvents: style.pointerEvents,
    backgroundColor: style.backgroundColor,
    color: style.color,
    transform: style.transform === "none" ? "" : style.transform,
  };
}

function getShortElementClassName(element) {
  if (!element?.className) {
    return "";
  }

  if (typeof element.className === "string") {
    return element.className.slice(0, 180);
  }

  return String(element.className?.baseVal || "").slice(0, 180);
}

function getElementDescriptor(element) {
  if (!element) {
    return null;
  }

  const style = window.getComputedStyle(element);

  return {
    tag: element.tagName?.toLowerCase() || "",
    id: (element.id || "").slice(0, 80),
    className: getShortElementClassName(element),
    dataState: element.getAttribute?.("data-state") || "",
    dataDirection: element.getAttribute?.("data-direction") || "",
    dataResizeHandleState: element.getAttribute?.("data-resize-handle-state") || "",
    dataPanelId: element.getAttribute?.("data-panel-id") || element.getAttribute?.("data-panel") || "",
    display: style.display,
    visibility: style.visibility,
    opacity: Number.parseFloat(style.opacity || "1"),
    pointerEvents: style.pointerEvents,
    position: style.position,
    zIndex: style.zIndex,
    backgroundColor: style.backgroundColor,
  };
}

function getPointElementDiagnostics(container, label, x, y) {
  const topElement = document.elementFromPoint(x, y);
  const containerContainsTop = Boolean(topElement && container.contains(topElement));

  return {
    label,
    x: Math.round(x),
    y: Math.round(y),
    containerContainsTop,
    topElement: getElementDescriptor(topElement),
    closestXterm: getElementDescriptor(topElement?.closest?.(".xterm")),
    closestFrame: getElementDescriptor(topElement?.closest?.("[data-state]")),
    closestResizeHandle: getElementDescriptor(topElement?.closest?.("[data-resize-handle-state]")),
  };
}

function getTerminalPointDiagnostics(container) {
  const rect = container.getBoundingClientRect();

  if (rect.width <= 0 || rect.height <= 0) {
    return [];
  }

  const left = rect.left;
  const top = rect.top;
  const right = rect.right;
  const bottom = rect.bottom;

  return [
    getPointElementDiagnostics(container, "center", left + rect.width / 2, top + rect.height / 2),
    getPointElementDiagnostics(container, "top_left", left + Math.min(12, rect.width / 3), top + Math.min(12, rect.height / 3)),
    getPointElementDiagnostics(container, "top_right", right - Math.min(12, rect.width / 3), top + Math.min(12, rect.height / 3)),
    getPointElementDiagnostics(container, "bottom_left", left + Math.min(12, rect.width / 3), bottom - Math.min(12, rect.height / 3)),
    getPointElementDiagnostics(container, "bottom_right", right - Math.min(12, rect.width / 3), bottom - Math.min(12, rect.height / 3)),
  ];
}

function getTerminalDomRowsDiagnostics(rowsElement) {
  if (!rowsElement) {
    return null;
  }

  const rowElements = Array.from(rowsElement.children);
  let nonEmptyDomRows = 0;
  let domTextLength = 0;
  let firstNonEmptyText = "";

  rowElements.forEach((row) => {
    const text = (row.textContent || "").trim();

    if (!text) {
      return;
    }

    nonEmptyDomRows += 1;
    domTextLength += text.length;

    if (!firstNonEmptyText) {
      firstNonEmptyText = text.slice(0, 120);
    }
  });

  return {
    childCount: rowElements.length,
    nonEmptyDomRows,
    domTextLength,
    firstNonEmptyText,
  };
}

function getTerminalBufferDiagnostics(terminal) {
  const buffer = terminal.buffer?.active;

  if (!buffer) {
    return null;
  }

  let nonEmptyViewportRows = 0;
  let wrappedViewportRows = 0;
  const viewportStart = Math.max(0, buffer.viewportY || 0);
  const viewportEnd = Math.min(buffer.length || 0, viewportStart + (terminal.rows || 0));

  for (let index = viewportStart; index < viewportEnd; index += 1) {
    const line = buffer.getLine(index);

    if (!line) {
      continue;
    }

    if (line.isWrapped) {
      wrappedViewportRows += 1;
    }

    if (line.translateToString(true).trim().length > 0) {
      nonEmptyViewportRows += 1;
    }
  }

  return {
    baseY: buffer.baseY,
    cursorX: buffer.cursorX,
    cursorY: buffer.cursorY,
    length: buffer.length,
    viewportY: buffer.viewportY,
    nonEmptyViewportRows,
    wrappedViewportRows,
  };
}

function clampTerminalLine(value, minimum, maximum) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(numericValue)));
}

function normalizeTerminalAnchorText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TERMINAL_SCROLL_ANCHOR_MAX_TEXT_CHARS);
}

function getTerminalAnchorTokens(value) {
  return normalizeTerminalAnchorText(value)
    .toLowerCase()
    .match(/[a-z0-9_./:-]{2,}/g) || [];
}

function getTerminalAnchorAlnumCount(value) {
  const matches = normalizeTerminalAnchorText(value).match(/[a-z0-9]/gi);

  return matches ? matches.length : 0;
}

function getTerminalAnchorLineText(buffer, row) {
  const line = buffer?.getLine?.(row);

  if (!line) {
    return "";
  }

  return normalizeTerminalAnchorText(line.translateToString(true));
}

function isUsefulTerminalAnchorText(text) {
  const normalizedText = normalizeTerminalAnchorText(text);

  if (!normalizedText) {
    return false;
  }

  if (getTerminalAnchorAlnumCount(normalizedText) < TERMINAL_SCROLL_ANCHOR_MIN_ALNUM_CHARS) {
    return false;
  }

  return /[a-z0-9]/i.test(normalizedText);
}

function getTerminalWrappedGroupBounds(buffer, row) {
  let start = row;
  let end = row;

  while (start > 0 && buffer.getLine(start)?.isWrapped) {
    start -= 1;
  }

  while (end + 1 < buffer.length && buffer.getLine(end + 1)?.isWrapped) {
    end += 1;
  }

  return { end, start };
}

function getTerminalWrappedGroupText(buffer, bounds) {
  const parts = [];

  for (let row = bounds.start; row <= bounds.end; row += 1) {
    const line = buffer.getLine(row);

    if (line) {
      parts.push(line.translateToString(false));
    }
  }

  return normalizeTerminalAnchorText(parts.join(""));
}

function buildTerminalAnchorCandidate(buffer, row, targetRow) {
  const lineText = getTerminalAnchorLineText(buffer, row);

  if (!isUsefulTerminalAnchorText(lineText)) {
    return null;
  }

  const groupBounds = getTerminalWrappedGroupBounds(buffer, row);
  const groupText = getTerminalWrappedGroupText(buffer, groupBounds);
  const groupLineCount = groupBounds.end - groupBounds.start + 1;
  const distanceFromTarget = Math.abs(row - targetRow);
  const textLengthScore = Math.min(lineText.length, 120);
  const alnumScore = Math.min(getTerminalAnchorAlnumCount(lineText), 80);
  const wrappedPenalty = groupLineCount > 1 ? 4 : 0;

  return {
    groupLineCount,
    groupOffsetRatio: groupLineCount > 1 ? (row - groupBounds.start) / (groupLineCount - 1) : 0,
    groupStart: groupBounds.start,
    groupText,
    lineText,
    row,
    score: textLengthScore + alnumScore - distanceFromTarget * 24 - wrappedPenalty,
    viewportOffset: row - buffer.viewportY,
  };
}

function captureTerminalScrollAnchor(terminal) {
  const buffer = terminal.buffer?.active;

  if (!buffer || buffer.type === "alternate" || buffer.length <= 0) {
    return { mode: "skip", reason: buffer?.type === "alternate" ? "alternate_buffer" : "missing_buffer" };
  }

  const distanceFromBottom = Math.max(0, buffer.baseY - buffer.viewportY);

  if (distanceFromBottom === 0) {
    return {
      baseY: buffer.baseY,
      distanceFromBottom,
      mode: "bottom",
      viewportY: buffer.viewportY,
    };
  }

  const viewportStart = Math.max(0, buffer.viewportY || 0);
  const viewportEnd = Math.min(buffer.length - 1, viewportStart + Math.max(0, terminal.rows - 1));
  const targetOffset = clampTerminalLine(
    Math.round(Math.max(0, terminal.rows - 1) * TERMINAL_SCROLL_ANCHOR_TARGET_FRACTION),
    0,
    Math.max(0, viewportEnd - viewportStart),
  );
  const targetRow = viewportStart + targetOffset;
  let bestCandidate = null;

  for (let row = viewportStart; row <= viewportEnd; row += 1) {
    const candidate = buildTerminalAnchorCandidate(buffer, row, targetRow);

    if (!candidate) {
      continue;
    }

    if (!bestCandidate || candidate.score > bestCandidate.score) {
      bestCandidate = candidate;
    }
  }

  if (!bestCandidate) {
    return {
      baseY: buffer.baseY,
      distanceFromBottom,
      mode: "distance",
      viewportY: buffer.viewportY,
    };
  }

  return {
    ...bestCandidate,
    baseY: buffer.baseY,
    distanceFromBottom,
    mode: "anchor",
    rows: terminal.rows,
    viewportY: buffer.viewportY,
  };
}

function scoreTerminalAnchorMatch(anchor, candidate, predictedRow) {
  if (!candidate) {
    return Number.NEGATIVE_INFINITY;
  }

  const anchorGroupText = normalizeTerminalAnchorText(anchor.groupText);
  const anchorLineText = normalizeTerminalAnchorText(anchor.lineText);
  const candidateGroupText = normalizeTerminalAnchorText(candidate.groupText);
  const candidateLineText = normalizeTerminalAnchorText(candidate.lineText);
  let score = 0;

  if (anchorGroupText && candidateGroupText === anchorGroupText) {
    score += 1000;
  } else if (anchorLineText && candidateGroupText.includes(anchorLineText)) {
    score += 760;
  } else if (anchorLineText && candidateLineText === anchorLineText) {
    score += 720;
  } else if (
    anchorLineText
    && candidateLineText
    && (candidateLineText.includes(anchorLineText) || anchorLineText.includes(candidateLineText))
  ) {
    score += 520;
  }

  const anchorTokens = getTerminalAnchorTokens(anchorGroupText || anchorLineText);
  const candidateTokens = new Set(getTerminalAnchorTokens(candidateGroupText || candidateLineText));
  const tokenOverlap = anchorTokens.filter((token) => candidateTokens.has(token)).length;

  if (anchorTokens.length > 0) {
    score += (tokenOverlap / anchorTokens.length) * 360;
  }

  score -= Math.abs(candidate.row - predictedRow) * 0.8;

  return score;
}

function findTerminalScrollAnchorMatch(buffer, terminal, anchor, fallbackViewportY) {
  const targetRow = clampTerminalLine(
    fallbackViewportY + anchor.viewportOffset,
    0,
    Math.max(0, buffer.length - 1),
  );
  const searchRadius = Math.max(
    TERMINAL_SCROLL_ANCHOR_SEARCH_RADIUS_ROWS,
    Math.max(terminal.rows || 0, anchor.rows || 0) * 4,
  );
  const searchStart = Math.max(0, targetRow - searchRadius);
  const searchEnd = Math.min(buffer.length - 1, targetRow + searchRadius);
  const seenGroups = new Set();
  let bestMatch = null;

  for (let row = searchStart; row <= searchEnd; row += 1) {
    const lineText = getTerminalAnchorLineText(buffer, row);

    if (!isUsefulTerminalAnchorText(lineText)) {
      continue;
    }

    const groupBounds = getTerminalWrappedGroupBounds(buffer, row);
    const groupKey = `${groupBounds.start}:${groupBounds.end}`;

    if (seenGroups.has(groupKey)) {
      continue;
    }

    seenGroups.add(groupKey);

    const groupLineCount = groupBounds.end - groupBounds.start + 1;
    const matchRow = clampTerminalLine(
      groupBounds.start + Math.round((groupLineCount - 1) * (anchor.groupOffsetRatio || 0)),
      groupBounds.start,
      groupBounds.end,
    );
    const candidate = {
      groupText: getTerminalWrappedGroupText(buffer, groupBounds),
      lineText: getTerminalAnchorLineText(buffer, matchRow),
      row: matchRow,
    };
    const score = scoreTerminalAnchorMatch(anchor, candidate, targetRow);

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        ...candidate,
        score,
      };
    }
  }

  return bestMatch && bestMatch.score >= 360 ? bestMatch : null;
}

function restoreTerminalScrollAnchor(terminal, anchor) {
  const buffer = terminal.buffer?.active;

  if (!buffer || !anchor || anchor.mode === "skip" || buffer.type === "alternate") {
    return { mode: "skip", reason: buffer?.type === "alternate" ? "alternate_buffer" : "missing_anchor" };
  }

  if (anchor.mode === "bottom") {
    terminal.scrollToBottom();
    return { mode: "bottom" };
  }

  const fallbackViewportY = clampTerminalLine(
    buffer.baseY - Math.max(0, anchor.distanceFromBottom || 0),
    0,
    Math.max(0, buffer.baseY),
  );

  if (anchor.mode !== "anchor") {
    terminal.scrollToLine(fallbackViewportY);
    return {
      mode: "distance",
      viewportY: fallbackViewportY,
    };
  }

  const match = findTerminalScrollAnchorMatch(buffer, terminal, anchor, fallbackViewportY);

  if (!match) {
    terminal.scrollToLine(fallbackViewportY);
    return {
      mode: "distance_fallback",
      viewportY: fallbackViewportY,
    };
  }

  const nextViewportY = clampTerminalLine(
    match.row - Math.max(0, anchor.viewportOffset || 0),
    0,
    Math.max(0, buffer.baseY),
  );

  terminal.scrollToLine(nextViewportY);

  return {
    matchScore: Math.round(match.score),
    mode: "anchor",
    viewportY: nextViewportY,
  };
}

function getTerminalRenderDiagnostics(container, terminal, rendererMode) {
  const terminalElement = terminal.element || container.querySelector(".xterm");
  const screenElement = container.querySelector(".xterm-screen");
  const rowsElement = container.querySelector(".xterm-rows");
  const viewportElement = container.querySelector(".xterm-viewport");
  const helperTextarea = container.querySelector(".xterm-helper-textarea");
  const terminalFrame = container.closest("[data-state]");
  const resizePanel = container.closest("[data-panel-id], [data-panel]");
  const canvases = Array.from(container.querySelectorAll("canvas"));
  const visibleCanvasCount = canvases.filter((canvas) => {
    const rect = canvas.getBoundingClientRect();
    const style = window.getComputedStyle(canvas);

    return rect.width > 0
      && rect.height > 0
      && style.visibility !== "hidden"
      && style.display !== "none"
      && Number.parseFloat(style.opacity || "1") > 0;
  }).length;
  const primaryCanvas = canvases[0];
  const canvasRect = primaryCanvas?.getBoundingClientRect();

  const buffer = getTerminalBufferDiagnostics(terminal);
  const domRows = getTerminalDomRowsDiagnostics(rowsElement);

  return {
    rendererMode,
    devicePixelRatio: window.devicePixelRatio || 1,
    terminalCols: terminal.cols,
    terminalRows: terminal.rows,
    container: getElementDiagnostics(container),
    containerScroll: {
      scrollLeft: Math.round(container.scrollLeft || 0),
      scrollTop: Math.round(container.scrollTop || 0),
    },
    terminalFrame: getElementDiagnostics(terminalFrame),
    resizePanel: getElementDiagnostics(resizePanel),
    terminalElement: getElementDiagnostics(terminalElement),
    screen: getElementDiagnostics(screenElement),
    rows: getElementDiagnostics(rowsElement),
    domRows,
    viewport: getElementDiagnostics(viewportElement),
    topElements: getTerminalPointDiagnostics(container),
    activeElement: getElementDescriptor(document.activeElement),
    helperTextareaFocused: document.activeElement === helperTextarea,
    canvasCount: canvases.length,
    visibleCanvasCount,
    canvas: primaryCanvas
      ? {
        width: primaryCanvas.width,
        height: primaryCanvas.height,
        clientWidth: Math.round(canvasRect?.width || 0),
        clientHeight: Math.round(canvasRect?.height || 0),
      }
      : null,
    buffer,
    possibleVisualBlank: Boolean(
      buffer
      && domRows
      && buffer.nonEmptyViewportRows > 0
      && domRows.nonEmptyDomRows === 0
      && visibleCanvasCount === 0
    ),
  };
}

export default function WorkspaceTerminal({
  agent,
  agentLaunchEpoch = 0,
  agentLaunchReady = true,
  agentStatuses,
  agentStatusError,
  agentStatusState,
  onCloseTerminal,
  onOpenSettings,
  onPreparedTerminalChange,
  onRecheckAgents,
  prewarmShell = false,
  terminalIndex = 0,
  terminalCount = 1,
  useWebglRenderer = TERMINAL_ENABLE_WEBGL_RENDERER,
  workingDirectory,
  workspace,
  workspaceError,
}) {
  const containerRef = useRef(null);
  const terminalInstanceIdRef = useRef(0);
  const agentLaunchEpochRef = useRef(agentLaunchEpoch);
  const agentLaunchReadyRef = useRef(agentLaunchReady);
  const lastAgentLaunchEpochRef = useRef(0);
  const startAgentInPrewarmedTerminalRef = useRef(null);
  const blankStartupRestartCountRef = useRef(0);
  const terminalClosingRef = useRef(false);
  const [terminalState, setTerminalState] = useState(agent ? "starting" : "blocked");
  const [terminalError, setTerminalError] = useState("");
  const [restartKey, setRestartKey] = useState(0);
  const [terminalClosed, setTerminalClosed] = useState(false);
  const [terminalClosing, setTerminalClosing] = useState(false);
  const paneId = getWorkspaceTerminalPaneId(workspace?.id, terminalIndex, agent?.id);
  const terminalAgentKind = getTerminalAgentKind(agent?.id);
  const terminalAgentId = getTerminalAgentId(agent?.id, terminalIndex);
  const terminalAgentTitle = `${agent?.label || "Agent"} terminal ${terminalAgentId}`;

  useEffect(() => {
    setTerminalClosed(false);
    terminalClosingRef.current = false;
    setTerminalClosing(false);
    lastAgentLaunchEpochRef.current = 0;
    blankStartupRestartCountRef.current = 0;
  }, [agent?.id, terminalIndex, workspace?.id]);

  useEffect(() => {
    agentLaunchEpochRef.current = agentLaunchEpoch;
    agentLaunchReadyRef.current = agentLaunchReady;

    if (
      agentLaunchReady
      && agentLaunchEpoch > 0
      && lastAgentLaunchEpochRef.current !== agentLaunchEpoch
      && typeof startAgentInPrewarmedTerminalRef.current === "function"
    ) {
      lastAgentLaunchEpochRef.current = agentLaunchEpoch;
      startAgentInPrewarmedTerminalRef.current("agent_launch_epoch", agentLaunchEpoch);
    }
  }, [agentLaunchEpoch, agentLaunchReady]);

  useEffect(() => {
    patchTerminalMetrics({ terminalCount });
  }, [terminalCount]);

  useEffect(() => {
    if (!agent) {
      startAgentInPrewarmedTerminalRef.current = null;
      setTerminalState("blocked");
      setTerminalError("");
      terminalClosingRef.current = false;
      setTerminalClosing(false);
      return undefined;
    }

    if (terminalClosed) {
      setTerminalState("closed");
      setTerminalError("");
      terminalClosingRef.current = false;
      setTerminalClosing(false);
      return undefined;
    }

    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    let isDisposed = false;
    let webglAttachTimer = 0;
    let webglAttachAt = 0;
    let webglAttachAttempted = false;
    const renderProbeTimers = new Set();
    const resizeDebugProbeTimers = new Set();
    const startupWatchTimers = new Set();
    // Tauri's WebView can corrupt xterm's WebGL glyph atlas during rapid multi-pane resize.
    let rendererMode = useWebglRenderer ? "webgl_pending" : "canvas";
    let runtimeTerminalState = "starting";
    let startAgentInCurrentPty = null;
    let hasOpenPty = false;
    let activeWebglAddon = null;
    let resizeController = null;
    let lastResizeMeasureAt = 0;
    let lastResizeMeasureSize = null;
    let lastXtermRenderLogAt = 0;
    let pendingResizeScrollAnchor = null;
    let resizeIdleDebugTimer = 0;
    let resizeWriteBarrierActive = false;
    let resizeWriteBarrierStartedAt = 0;
    let resizeWriteBarrierReason = "";
    let resizeWriteBarrierBytes = 0;
    const resizeWriteBarrierQueue = [];
    let sawFirstOutput = false;
    let outputBytes = 0;
    let outputChunks = 0;
    const disposables = [];
    const startupMetricTimers = new Set();
    const terminalInstanceId = getNextWorkspaceTerminalInstanceId();
    terminalInstanceIdRef.current = terminalInstanceId;
    const lifecycleStartedAt = performance.now();

    writeTerminalTelemetry({
      paneId,
      instanceId: terminalInstanceId,
      phase: "frontend.terminal.mount",
      fields: {
        terminalIndex,
        terminalCount,
        ...getWorkspaceOpenTelemetryFields(workspace?.id),
      },
    });

    const waitForStartupMetricPoll = (delayMs) => new Promise((resolve) => {
      if (isDisposed) {
        resolve();
        return;
      }

      const timer = window.setTimeout(() => {
        startupMetricTimers.delete(timer);
        resolve();
      }, Math.max(0, delayMs));

      startupMetricTimers.add(timer);
    });

    const terminal = new XTerm({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.22,
      macOptionIsMeta: true,
      scrollback: TERMINAL_DEFAULT_SCROLLBACK_ROWS,
      theme: {
        background: TERMINAL_THEME_BACKGROUND,
        foreground: "#e8eef8",
        cursor: "#ff9a3d",
        cursorAccent: "#030508",
        selectionBackground: "#2f80ff55",
        black: "#030508",
        brightBlack: "#687386",
        blue: "#62a0ff",
        brightBlue: "#8bb9ff",
        cyan: "#6fd7ff",
        brightCyan: "#a7e8ff",
        green: "#7ee787",
        brightGreen: "#9dffad",
        magenta: "#d2a8ff",
        brightMagenta: "#e1c7ff",
        red: "#ff6b6b",
        brightRed: "#ff9a9a",
        white: "#e8eef8",
        brightWhite: "#ffffff",
        yellow: "#ffb269",
        brightYellow: "#ffd08a",
      },
    });

    terminal.open(container);
    const terminalScrollableElement = container.querySelector(".xterm-scrollable-element");
    writeTerminalTelemetry({
      paneId,
      instanceId: terminalInstanceId,
      phase: "frontend.terminal.open_xterm",
      elapsedMs: performance.now() - lifecycleStartedAt,
    });

    const setTerminalAudioInputTarget = (active) => {
      if (active && isDisposed) {
        return;
      }

      invoke("set_terminal_audio_input_target", {
        active,
        instanceId: terminalInstanceId,
        paneId,
      }).catch(() => {});
    };
    let terminalFocusClearTimer = 0;
    const markTerminalAudioInputTarget = () => {
      if (terminalFocusClearTimer) {
        window.clearTimeout(terminalFocusClearTimer);
        terminalFocusClearTimer = 0;
      }

      setTerminalAudioInputTarget(true);
    };
    const clearTerminalAudioInputTarget = () => setTerminalAudioInputTarget(false);
    const clearTerminalAudioInputTargetIfAppUnfocused = () => {
      window.setTimeout(() => {
        Window.getFocusedWindow()
          .then((focusedWindow) => {
            if (!isDisposed && !focusedWindow) {
              clearTerminalAudioInputTarget();
            }
          })
          .catch(() => {});
      }, 30);
    };
    const scheduleClearTerminalAudioInputTarget = () => {
      if (terminalFocusClearTimer) {
        window.clearTimeout(terminalFocusClearTimer);
      }

      terminalFocusClearTimer = window.setTimeout(() => {
        terminalFocusClearTimer = 0;
        if (!container.contains(document.activeElement)) {
          clearTerminalAudioInputTarget();
        }
      }, 0);
    };

    container.addEventListener("focusin", markTerminalAudioInputTarget, true);
    container.addEventListener("focusout", scheduleClearTerminalAudioInputTarget, true);
    container.addEventListener("pointerdown", markTerminalAudioInputTarget, true);
    window.addEventListener("blur", clearTerminalAudioInputTargetIfAppUnfocused, true);
    Window.getCurrent()
      .onFocusChanged((event) => {
        if (!event.payload) {
          clearTerminalAudioInputTargetIfAppUnfocused();
        }
      })
      .then((unlisten) => {
        if (isDisposed) {
          unlisten();
          return;
        }

        disposables.push(unlisten);
      })
      .catch(() => {});

    let terminalScrollbarHideTimer = 0;
    let terminalScrollIntentUntil = 0;
    const updateTerminalScrollbarOverflow = () => {
      const activeBuffer = terminal.buffer?.active;
      const hasOverflow = Boolean(activeBuffer && activeBuffer.baseY > 0);

      if (hasOverflow) {
        container.dataset.scrollbarOverflow = "true";
      } else {
        delete container.dataset.scrollbarOverflow;
      }

      return hasOverflow;
    };
    const hideTerminalScrollbar = () => {
      terminalScrollbarHideTimer = 0;
      if (!isDisposed) {
        delete container.dataset.scrolling;
      }
    };
    const scheduleHideTerminalScrollbar = () => {
      if (terminalScrollbarHideTimer) {
        window.clearTimeout(terminalScrollbarHideTimer);
      }

      terminalScrollbarHideTimer = window.setTimeout(
        hideTerminalScrollbar,
        TERMINAL_SCROLLBAR_HIDE_DELAY_MS,
      );
    };
    const showTerminalScrollbar = () => {
      if (isDisposed) {
        return;
      }

      if (updateTerminalScrollbarOverflow()) {
        container.dataset.scrolling = "true";
        scheduleHideTerminalScrollbar();
      }
    };
    const markTerminalScrollIntent = () => {
      terminalScrollIntentUntil = performance.now() + TERMINAL_SCROLLBAR_INTENT_MS;
    };
    const handleTerminalScrollIntent = () => {
      markTerminalScrollIntent();
      showTerminalScrollbar();
    };
    const handleTerminalScrollKeyIntent = (event) => {
      if (
        event.key === "PageUp"
        || event.key === "PageDown"
        || event.key === "Home"
        || event.key === "End"
      ) {
        handleTerminalScrollIntent();
      }
    };
    const handleTerminalViewportScroll = () => {
      updateTerminalScrollbarOverflow();
      if (performance.now() <= terminalScrollIntentUntil) {
        showTerminalScrollbar();
      }
    };

    if (terminalScrollableElement) {
      terminalScrollableElement.addEventListener("wheel", handleTerminalScrollIntent, { passive: true });
      terminalScrollableElement.addEventListener("touchmove", handleTerminalScrollIntent, { passive: true });
      container.addEventListener("keydown", handleTerminalScrollKeyIntent, true);
      disposables.push(terminal.onScroll(handleTerminalViewportScroll));
      disposables.push(terminal.onWriteParsed(updateTerminalScrollbarOverflow));
      disposables.push(terminal.onResize(updateTerminalScrollbarOverflow));
      updateTerminalScrollbarOverflow();
      disposables.push(() => {
        if (terminalScrollbarHideTimer) {
          window.clearTimeout(terminalScrollbarHideTimer);
          terminalScrollbarHideTimer = 0;
        }

        delete container.dataset.scrolling;
        delete container.dataset.scrollbarOverflow;
        terminalScrollableElement.removeEventListener("wheel", handleTerminalScrollIntent);
        terminalScrollableElement.removeEventListener("touchmove", handleTerminalScrollIntent);
        container.removeEventListener("keydown", handleTerminalScrollKeyIntent, true);
      });
    }
    listen(TERMINAL_AUDIO_INPUT_REFOCUS_EVENT, (event) => {
      if (
        isDisposed
        || event.payload?.paneId !== paneId
        || event.payload?.instanceId !== terminalInstanceId
      ) {
        return;
      }

      markTerminalAudioInputTarget();
      terminal.focus();
      window.setTimeout(() => {
        if (!isDisposed) {
          terminal.focus();
        }
      }, 0);
    })
      .then((unlisten) => {
        if (isDisposed) {
          unlisten();
          return;
        }

        disposables.push(unlisten);
      })
      .catch(() => {});
    disposables.push(() => {
      if (terminalFocusClearTimer) {
        window.clearTimeout(terminalFocusClearTimer);
        terminalFocusClearTimer = 0;
      }
      container.removeEventListener("focusin", markTerminalAudioInputTarget, true);
      container.removeEventListener("focusout", scheduleClearTerminalAudioInputTarget, true);
      container.removeEventListener("pointerdown", markTerminalAudioInputTarget, true);
      window.removeEventListener("blur", clearTerminalAudioInputTargetIfAppUnfocused, true);
      clearTerminalAudioInputTarget();
    });

    const attachWebglRenderer = (reason = "scheduled") => {
      if (!useWebglRenderer || isDisposed || webglAttachAttempted) {
        return;
      }

      webglAttachAttempted = true;
      const webglStartedAt = performance.now();
      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.webgl.attach_start",
        fields: { reason },
      });
      const webglAddon = new WebglAddon();

      try {
        terminal.loadAddon(webglAddon);
        rendererMode = "webgl";
        activeWebglAddon = webglAddon;
        disposables.push(webglAddon);
        disposables.push(webglAddon.onContextLoss(() => {
          rendererMode = "canvas";
          if (activeWebglAddon === webglAddon) {
            activeWebglAddon = null;
          }
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.webgl.context_loss",
          });
          scheduleRenderProbe("webgl_context_loss", 0);
          webglAddon.dispose();
        }));
        patchTerminalMetrics({ webglMs: performance.now() - webglStartedAt });
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.webgl.attach_done",
          elapsedMs: performance.now() - webglStartedAt,
          fields: { reason },
        });
        refreshTerminalRenderer("webgl_attach_done", { reason });
        scheduleRenderProbe("webgl_attach_done", TERMINAL_RENDER_PROBE_AFTER_WEBGL_MS, { reason });
      } catch {
        // WebGL is best-effort; xterm keeps its canvas renderer when WebGL2 is unavailable.
        rendererMode = "canvas";
        webglAddon.dispose();
        patchTerminalMetrics({ webglMs: performance.now() - webglStartedAt });
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.webgl.attach_error",
          elapsedMs: performance.now() - webglStartedAt,
          fields: { reason },
        });
        scheduleRenderProbe("webgl_attach_error", 0, { reason });
      }
    };

    const scheduleWebglAttach = (reason, baseDelayMs) => {
      if (!useWebglRenderer || isDisposed || webglAttachAttempted) {
        return;
      }

      const delayMs = Math.min(
        TERMINAL_WEBGL_MAX_DELAY_MS,
        Math.max(0, baseDelayMs + terminalIndex * TERMINAL_WEBGL_STAGGER_MS),
      );
      const attachAt = performance.now() + delayMs;

      if (webglAttachTimer && webglAttachAt <= attachAt) {
        return;
      }

      if (webglAttachTimer) {
        window.clearTimeout(webglAttachTimer);
      }

      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.webgl.attach_schedule",
        fields: {
          reason,
          delayMs,
          terminalIndex,
          rendererMode,
        },
      });
      webglAttachAt = attachAt;
      webglAttachTimer = window.setTimeout(() => {
        webglAttachTimer = 0;
        webglAttachAt = 0;
        attachWebglRenderer(reason);
      }, delayMs);
    };

    scheduleWebglAttach("xterm_open", 0);

    const logRenderProbe = (reason, extraFields = {}) => {
      if (isDisposed) {
        return;
      }

      let renderDiagnostics = {};

      try {
        renderDiagnostics = getTerminalRenderDiagnostics(container, terminal, rendererMode);
      } catch (error) {
        renderDiagnostics = {
          renderProbeError: getErrorMessage(error, "Unable to inspect terminal render state."),
        };
      }

      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.render.probe",
        cols: terminal.cols,
        rows: terminal.rows,
        fields: {
          reason,
          terminalIndex,
          terminalState: runtimeTerminalState,
          uptimeMs: performance.now() - lifecycleStartedAt,
          ...extraFields,
          ...renderDiagnostics,
        },
      });

      if (renderDiagnostics?.possibleVisualBlank) {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.render.possible_visual_blank",
          cols: terminal.cols,
          rows: terminal.rows,
          fields: {
            reason,
            terminalIndex,
            terminalState: runtimeTerminalState,
            uptimeMs: performance.now() - lifecycleStartedAt,
            outputBytes,
            outputChunks,
            ...extraFields,
            ...renderDiagnostics,
          },
        });
      }
    };

    const scheduleRenderProbe = (reason, delayMs = 0, extraFields = {}) => {
      if (isDisposed) {
        return;
      }

      const timer = window.setTimeout(() => {
        renderProbeTimers.delete(timer);
        logRenderProbe(reason, extraFields);
      }, Math.max(0, delayMs));

      renderProbeTimers.add(timer);
    };

    const scheduleResizeDebugProbes = (reason, extraFields = {}) => {
      if (isDisposed) {
        return;
      }

      TERMINAL_RESIZE_DEBUG_PROBE_DELAYS_MS.forEach((delayMs) => {
        const timer = window.setTimeout(() => {
          resizeDebugProbeTimers.delete(timer);

          if (isDisposed) {
            return;
          }

          logRenderProbe(reason, {
            delayMs,
            lastResizeMeasureSize,
            sinceLastResizeMeasureMs: lastResizeMeasureAt ? performance.now() - lastResizeMeasureAt : null,
            ...extraFields,
          });
        }, delayMs);

        resizeDebugProbeTimers.add(timer);
      });
    };

    const scheduleResizeIdleDebugProbes = (extraFields = {}) => {
      if (isDisposed) {
        return;
      }

      if (resizeIdleDebugTimer) {
        window.clearTimeout(resizeIdleDebugTimer);
      }

      resizeIdleDebugTimer = window.setTimeout(() => {
        resizeIdleDebugTimer = 0;

        if (isDisposed) {
          return;
        }

        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.resize.idle",
          cols: terminal.cols,
          rows: terminal.rows,
          fields: {
            lastResizeMeasureSize,
            rendererMode,
            sinceLastResizeMeasureMs: lastResizeMeasureAt ? performance.now() - lastResizeMeasureAt : null,
            terminalIndex,
            ...extraFields,
          },
        });
        scheduleResizeDebugProbes("resize_idle_probe", extraFields);
      }, TERMINAL_RESIZE_DEBUG_IDLE_MS);
    };

    const refreshTerminalRenderer = (reason, extraFields = {}) => {
      if (isDisposed || typeof terminal.refresh !== "function") {
        return false;
      }

      try {
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.render.refresh",
          cols: terminal.cols,
          rows: terminal.rows,
          fields: {
            reason,
            rendererMode,
            terminalIndex,
            ...extraFields,
          },
        });
        return true;
      } catch (error) {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.render.refresh_error",
          fields: {
            reason,
            rendererMode,
            terminalIndex,
            error: getErrorMessage(error, "Unable to refresh terminal renderer."),
          },
        });
      }

      return false;
    };

    const scheduleBlankStartupWatch = (reason, delayMs = TERMINAL_BLANK_STARTUP_PROBE_MS, previousProbe = null) => {
      if (isDisposed) {
        return;
      }

      const timer = window.setTimeout(() => {
        startupWatchTimers.delete(timer);

        if (isDisposed || runtimeTerminalState !== "running") {
          return;
        }

        const bufferDiagnostics = getTerminalBufferDiagnostics(terminal);
        const hasVisibleRows = (bufferDiagnostics?.nonEmptyViewportRows || 0) > 0;
        const cursorMoved = (bufferDiagnostics?.cursorX || 0) > 0 || (bufferDiagnostics?.cursorY || 0) > 0;

        if (hasVisibleRows || cursorMoved || outputBytes > 8) {
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.start.visible_buffer_ready",
            cols: terminal.cols,
            rows: terminal.rows,
            fields: {
              reason,
              rendererMode,
              terminalIndex,
              outputBytes,
              outputChunks,
              retryConfirmMs: TERMINAL_BLANK_STARTUP_CONFIRM_MS,
              retryProbeMs: TERMINAL_BLANK_STARTUP_PROBE_MS,
              buffer: bufferDiagnostics,
            },
          });
          return;
        }

        const restartAttempt = blankStartupRestartCountRef.current + 1;
        const probeFields = {
          reason,
          rendererMode,
          terminalIndex,
          outputBytes,
          outputChunks,
          restartAttempt,
          retryConfirmMs: TERMINAL_BLANK_STARTUP_CONFIRM_MS,
          retryProbeMs: TERMINAL_BLANK_STARTUP_PROBE_MS,
          buffer: bufferDiagnostics,
        };

        if (!previousProbe) {
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.start.blank_probe",
            cols: terminal.cols,
            rows: terminal.rows,
            fields: probeFields,
          });
          refreshTerminalRenderer("blank_startup_probe", {
            outputBytes,
            outputChunks,
          });
          scheduleRenderProbe("blank_startup_probe_after_refresh", TERMINAL_RENDER_PROBE_AFTER_RESIZE_MS, {
            outputBytes,
            outputChunks,
          });
          scheduleBlankStartupWatch("blank_startup_confirm", TERMINAL_BLANK_STARTUP_CONFIRM_MS, {
            outputBytes,
            outputChunks,
          });
          return;
        }

        const outputChanged = outputBytes !== previousProbe.outputBytes
          || outputChunks !== previousProbe.outputChunks;
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.start.blank_visible_buffer",
          cols: terminal.cols,
          rows: terminal.rows,
          fields: {
            ...probeFields,
            previousOutputBytes: previousProbe.outputBytes,
            previousOutputChunks: previousProbe.outputChunks,
            outputChanged,
          },
        });

        refreshTerminalRenderer("blank_startup_watch", {
          outputBytes,
          outputChunks,
        });
        scheduleRenderProbe("blank_startup_after_refresh", TERMINAL_RENDER_PROBE_AFTER_RESIZE_MS, {
          outputBytes,
          outputChunks,
        });

        if (blankStartupRestartCountRef.current >= TERMINAL_BLANK_STARTUP_RESTART_LIMIT) {
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.start.blank_restart_limit",
            fields: {
              outputBytes,
              outputChunks,
              restartLimit: TERMINAL_BLANK_STARTUP_RESTART_LIMIT,
              retryConfirmMs: TERMINAL_BLANK_STARTUP_CONFIRM_MS,
              retryProbeMs: TERMINAL_BLANK_STARTUP_PROBE_MS,
            },
          });
          hasOpenPty = false;
          runtimeTerminalState = "error";
          setTerminalState("error");
          setTerminalError(`${agent.label} started but did not produce visible terminal output.`);
          invoke("terminal_close", { paneId, instanceId: terminalInstanceId }).catch(() => {});
          return;
        }

        blankStartupRestartCountRef.current += 1;
        const restartDelayMs = TERMINAL_BLANK_STARTUP_RESTART_DELAY_MS;
        hasOpenPty = false;
        runtimeTerminalState = "restarting";
        setTerminalState("starting");
        invoke("terminal_close", { paneId, instanceId: terminalInstanceId }).catch(() => {});
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.start.blank_restart_scheduled",
          fields: {
            outputBytes,
            outputChunks,
            restartAttempt,
            restartDelayMs,
            retryConfirmMs: TERMINAL_BLANK_STARTUP_CONFIRM_MS,
            retryProbeMs: TERMINAL_BLANK_STARTUP_PROBE_MS,
          },
        });
        window.setTimeout(() => {
          if (!isDisposed) {
            setRestartKey((key) => key + 1);
          }
        }, restartDelayMs);
      }, delayMs);

      startupWatchTimers.add(timer);
    };

    scheduleRenderProbe("xterm_open", 0);
    disposables.push(terminal.onResize(({ cols, rows }) => {
      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.xterm.resize",
        cols,
        rows,
        fields: {
          lastResizeMeasureSize,
          rendererMode,
          sinceLastResizeMeasureMs: lastResizeMeasureAt ? performance.now() - lastResizeMeasureAt : null,
          terminalIndex,
        },
      });
    }));
    disposables.push(terminal.onRender(({ start, end }) => {
      const now = performance.now();

      if (
        !lastResizeMeasureAt
        || now - lastResizeMeasureAt > TERMINAL_RESIZE_DEBUG_RECENT_MS
        || now - lastXtermRenderLogAt < TERMINAL_XTERM_RENDER_LOG_MIN_MS
      ) {
        return;
      }

      lastXtermRenderLogAt = now;
      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.xterm.render",
        cols: terminal.cols,
        rows: terminal.rows,
        fields: {
          end,
          lastResizeMeasureSize,
          rendererMode,
          sinceLastResizeMeasureMs: now - lastResizeMeasureAt,
          start,
          terminalIndex,
        },
      });
    }));

    if (terminalIndex === 0) {
      terminal.focus();
    }

    runtimeTerminalState = "starting";
    setTerminalState("starting");
    setTerminalError("");

    const measureTerminalSizeForOpen = (reason, options = {}) => {
      const shouldLogTelemetry = options.logTelemetry !== false;
      const measuredAt = performance.now();
      const measurement = measureTerminalGrid({
        container,
        term: terminal,
        defaultCols: TERMINAL_DEFAULT_COLS,
        defaultRows: TERMINAL_DEFAULT_ROWS,
        minCols: TERMINAL_MIN_COLS,
        minRows: TERMINAL_MIN_ROWS,
        maxCols: TERMINAL_MAX_COLS,
        maxRows: TERMINAL_MAX_ROWS,
      });
      const cols = measurement.ok ? measurement.cols : 0;
      const rows = measurement.ok ? measurement.rows : 0;
      const gridMs = performance.now() - measuredAt;

      lastResizeMeasureAt = performance.now();
      lastResizeMeasureSize = {
        cols,
        rows,
        skipped: !measurement.ok,
      };
      patchTerminalMetrics({ gridMs });

      if (shouldLogTelemetry) {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.resize.measure",
          cols,
          rows,
          elapsedMs: gridMs,
          fields: {
            actualCellHeight: measurement.actualCellHeight ?? null,
            actualCellWidth: measurement.actualCellWidth ?? null,
            containerHeight: Math.round(measurement.containerHeight || 0),
            containerWidth: Math.round(measurement.containerWidth || 0),
            measurementOk: measurement.ok,
            metricSource: measurement.metricSource ?? null,
            rawCols: measurement.rawCols ?? null,
            rawRows: measurement.rawRows ?? null,
            reason,
            skipped: measurement.ok ? "" : measurement.reason,
            terminalIndex,
          },
        });
      }

      return {
        ...measurement,
        cols,
        elapsedMs: gridMs,
        rows,
        skipped: !measurement.ok,
      };
    };

    const waitForTerminalSizeForOpen = async (reason) => {
      const waitStartedAt = performance.now();
      let attempts = 1;
      let measurement = measureTerminalSizeForOpen(`${reason}_metric_wait`, { logTelemetry: true });

      while (
        !isDisposed
        && !measurement.ok
        && performance.now() - waitStartedAt < TERMINAL_START_METRIC_WAIT_MS
      ) {
        await waitForStartupMetricPoll(TERMINAL_START_METRIC_POLL_MS);

        if (isDisposed) {
          return null;
        }

        attempts += 1;
        measurement = measureTerminalSizeForOpen(`${reason}_metric_wait`, { logTelemetry: false });
      }

      const waitMs = performance.now() - waitStartedAt;

      if (measurement.ok) {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.open.metrics_ready",
          cols: measurement.cols,
          rows: measurement.rows,
          elapsedMs: waitMs,
          fields: {
            actualCellHeight: measurement.actualCellHeight,
            actualCellWidth: measurement.actualCellWidth,
            attempts,
            containerHeight: Math.round(measurement.containerHeight),
            containerWidth: Math.round(measurement.containerWidth),
            metricSource: measurement.metricSource,
            rawCols: measurement.rawCols,
            rawRows: measurement.rawRows,
            reason,
            terminalIndex,
          },
        });
        return measurement;
      }

      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.open.metrics_timeout",
        cols: 0,
        rows: 0,
        elapsedMs: waitMs,
        fields: {
          attempts,
          lastActualCellHeight: measurement.actualCellHeight ?? null,
          lastActualCellWidth: measurement.actualCellWidth ?? null,
          lastReason: measurement.reason,
          metricSource: measurement.metricSource ?? null,
          reason,
          terminalIndex,
          timeoutMs: TERMINAL_START_METRIC_WAIT_MS,
        },
      });

      throw new Error("Terminal render metrics were not ready before PTY startup.");
    };

    const writeTerminalOutput = (data, options = {}) => {
      if (isDisposed || !data?.byteLength) {
        return;
      }

      const isFirstOutputChunk = options.isFirstOutputChunk === true;

      if (resizeWriteBarrierActive && !options.fromResizeBarrier) {
        const queuedData = typeof data.slice === "function" ? data.slice() : new Uint8Array(data);
        const wasEmpty = resizeWriteBarrierQueue.length === 0;

        resizeWriteBarrierQueue.push({
          data: queuedData,
          isFirstOutputChunk,
        });
        resizeWriteBarrierBytes += queuedData.byteLength;

        if (wasEmpty) {
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.output.resize_barrier_queue_start",
            cols: terminal.cols,
            rows: terminal.rows,
            fields: {
              bytes: queuedData.byteLength,
              reason: resizeWriteBarrierReason,
              terminalIndex,
            },
          });
        }

        return;
      }

      terminal.write(data, () => {
        if (isDisposed) {
          return;
        }

        if (isFirstOutputChunk) {
          refreshTerminalRenderer("first_output_written", {
            bytes: data.byteLength,
            transport: "binary_channel",
          });
          scheduleRenderProbe(
            "first_output_written",
            TERMINAL_RENDER_PROBE_AFTER_WRITE_MS,
            {
              bytes: data.byteLength,
              transport: "binary_channel",
            },
          );
        }
      });
    };

    const openResizeWriteBarrier = (event) => {
      if (resizeWriteBarrierActive) {
        return;
      }

      resizeWriteBarrierActive = true;
      resizeWriteBarrierStartedAt = performance.now();
      resizeWriteBarrierReason = event?.reason || "resize";
      resizeWriteBarrierBytes = 0;
      resizeWriteBarrierQueue.length = 0;
      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.output.resize_barrier_start",
        cols: event?.cols,
        rows: event?.rows,
        fields: {
          reason: resizeWriteBarrierReason,
          terminalIndex,
        },
      });
    };

    const closeResizeWriteBarrier = (reason) => {
      const queuedWrites = resizeWriteBarrierQueue.splice(0);
      const queuedBytes = resizeWriteBarrierBytes;
      const barrierMs = resizeWriteBarrierStartedAt
        ? performance.now() - resizeWriteBarrierStartedAt
        : 0;

      resizeWriteBarrierActive = false;
      resizeWriteBarrierStartedAt = 0;
      resizeWriteBarrierReason = "";
      resizeWriteBarrierBytes = 0;

      if (queuedWrites.length) {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.output.resize_barrier_flush",
          cols: terminal.cols,
          rows: terminal.rows,
          elapsedMs: barrierMs,
          fields: {
            bytes: queuedBytes,
            chunks: queuedWrites.length,
            reason,
            terminalIndex,
          },
        });
      }

      queuedWrites.forEach((queuedWrite) => {
        writeTerminalOutput(queuedWrite.data, {
          fromResizeBarrier: true,
          isFirstOutputChunk: queuedWrite.isFirstOutputChunk,
        });
      });

      return {
        barrierMs,
        queuedBytes,
        queuedChunks: queuedWrites.length,
      };
    };

    resizeController = createTerminalResizeController({
      canResize: () => hasOpenPty && !isDisposed,
      container,
      defaultCols: TERMINAL_DEFAULT_COLS,
      defaultRows: TERMINAL_DEFAULT_ROWS,
      getWebglAddon: () => activeWebglAddon,
      instanceId: () => terminalInstanceId,
      maxCols: TERMINAL_MAX_COLS,
      maxRows: TERMINAL_MAX_ROWS,
      minCols: TERMINAL_MIN_COLS,
      minRows: TERMINAL_MIN_ROWS,
      onDone: (event) => {
        if (isDisposed) {
          return;
        }

        const scrollAnchor = pendingResizeScrollAnchor;
        pendingResizeScrollAnchor = null;
        const scrollAnchorRestore = restoreTerminalScrollAnchor(terminal, scrollAnchor);
        const resizeBarrier = closeResizeWriteBarrier(event.reason || "resize_applied");
        lastResizeMeasureAt = performance.now();
        lastResizeMeasureSize = {
          cols: event.cols,
          rows: event.rows,
          skipped: false,
        };
        patchTerminalMetrics({
          gridMs: event.elapsedMs,
          resizeLagMs: event.elapsedMs,
        });
        addTerminalMetrics({
          resizeBatches: 1,
          resizePanes: 1,
        });
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.resize.applied",
          cols: event.cols,
          rows: event.rows,
          elapsedMs: event.elapsedMs,
          fields: {
            actualCellHeight: event.actualCellHeight,
            actualCellWidth: event.actualCellWidth,
            clearedTextureAtlas: event.clearedTextureAtlas,
            containerHeight: Math.round(event.containerHeight),
            containerWidth: Math.round(event.containerWidth),
            metricSource: event.metricSource,
            rawCols: event.rawCols,
            rawRows: event.rawRows,
            reason: event.reason,
            rendererMode,
            resizeBarrierBytes: resizeBarrier.queuedBytes,
            resizeBarrierChunks: resizeBarrier.queuedChunks,
            resizeBarrierMs: resizeBarrier.barrierMs,
            scrollAnchorDistanceFromBottom: scrollAnchor?.distanceFromBottom ?? null,
            scrollAnchorMatchScore: scrollAnchorRestore?.matchScore ?? null,
            scrollAnchorMode: scrollAnchor?.mode ?? "",
            scrollAnchorRestoreMode: scrollAnchorRestore?.mode ?? "",
            scrollAnchorViewportOffset: scrollAnchor?.viewportOffset ?? null,
            scrollAnchorViewportY: scrollAnchorRestore?.viewportY ?? null,
            terminalIndex,
          },
        });
        scheduleResizeIdleDebugProbes({
          requestedCols: event.cols,
          requestedRows: event.rows,
          resizeReason: event.reason,
        });
        scheduleRenderProbe("resize_applied", TERMINAL_RENDER_PROBE_AFTER_RESIZE_MS, {
          requestedCols: event.cols,
          requestedRows: event.rows,
          resizeReason: event.reason,
        });
      },
      onError: (event) => {
        const scrollAnchor = pendingResizeScrollAnchor;
        pendingResizeScrollAnchor = null;
        const resizeBarrier = closeResizeWriteBarrier(event.reason || "resize_error");

        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.resize.error",
          cols: event.cols,
          rows: event.rows,
          elapsedMs: event.elapsedMs,
          fields: {
            error: getErrorMessage(event.error, "Unable to resize terminal."),
            reason: event.reason,
            resizeBarrierBytes: resizeBarrier.queuedBytes,
            resizeBarrierChunks: resizeBarrier.queuedChunks,
            resizeBarrierMs: resizeBarrier.barrierMs,
            scrollAnchorMode: scrollAnchor?.mode ?? "",
            terminalIndex,
          },
        });
      },
      onSkip: (event) => {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.resize.skip",
          cols: event.cols,
          rows: event.rows,
          fields: {
            actualCellHeight: event.actualCellHeight ?? null,
            actualCellWidth: event.actualCellWidth ?? null,
            containerHeight: Math.round(event.containerHeight || 0),
            containerWidth: Math.round(event.containerWidth || 0),
            metricSource: event.metricSource ?? null,
            reason: event.reason,
            skipped: event.skipped,
            terminalIndex,
          },
        });
      },
      onStart: (event) => {
        pendingResizeScrollAnchor = captureTerminalScrollAnchor(terminal);
        openResizeWriteBarrier(event);
        lastResizeMeasureAt = performance.now();
        lastResizeMeasureSize = {
          cols: event.cols,
          rows: event.rows,
          skipped: false,
        };
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.resize.native_start",
          cols: event.cols,
          rows: event.rows,
          fields: {
            actualCellHeight: event.actualCellHeight,
            actualCellWidth: event.actualCellWidth,
            containerHeight: Math.round(event.containerHeight),
            containerWidth: Math.round(event.containerWidth),
            metricSource: event.metricSource,
            rawCols: event.rawCols,
            rawRows: event.rawRows,
            reason: event.reason,
            scrollAnchorDistanceFromBottom: pendingResizeScrollAnchor?.distanceFromBottom ?? null,
            scrollAnchorMode: pendingResizeScrollAnchor?.mode ?? "",
            scrollAnchorViewportOffset: pendingResizeScrollAnchor?.viewportOffset ?? null,
            terminalIndex,
          },
        });
      },
      paneId: () => paneId,
      term: terminal,
    });
    resizeController?.schedule("mount");

    async function startTerminal() {
      try {
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.start.begin",
          elapsedMs: performance.now() - lifecycleStartedAt,
          fields: getWorkspaceOpenTelemetryFields(workspace?.id),
        });
        const outputChannel = new Channel((message) => {
          if (isDisposed) {
            return;
          }

          const data = message instanceof ArrayBuffer
            ? new Uint8Array(message)
            : ArrayBuffer.isView(message)
              ? new Uint8Array(message.buffer, message.byteOffset, message.byteLength)
              : null;

          if (!data?.byteLength) {
            return;
          }

          addTerminalMetrics({
            ipcEvents: 1,
            ipcBytes: data.byteLength,
          });
          patchTerminalMetrics({ outputLagMs: 0 });

          const isFirstOutputChunk = !sawFirstOutput;
          outputChunks += 1;
          outputBytes += data.byteLength;

          if (isFirstOutputChunk) {
            sawFirstOutput = true;
            writeTerminalTelemetry({
              paneId,
              instanceId: terminalInstanceId,
              phase: "frontend.output.first_chunk",
              elapsedMs: performance.now() - lifecycleStartedAt,
              fields: {
                bytes: data.byteLength,
                transport: "binary_channel",
              },
            });
            scheduleWebglAttach("first_output", TERMINAL_WEBGL_FIRST_OUTPUT_DELAY_MS);
          }

          writeTerminalOutput(data, {
            isFirstOutputChunk,
          });
        });
        disposables.push(await listen("forge-terminal-exit", (event) => {
          if (
            event.payload?.paneId === paneId
            && event.payload?.instanceId === terminalInstanceId
            && !isDisposed
          ) {
            writeTerminalTelemetry({
              paneId,
              instanceId: terminalInstanceId,
              phase: "frontend.exit",
              elapsedMs: performance.now() - lifecycleStartedAt,
              fields: { exitCode: event.payload.exitCode ?? null },
            });
            hasOpenPty = false;
            runtimeTerminalState = "exited";
            setTerminalState("exited");
          }
        }));
        disposables.push(terminal.onData((data) => {
          if (!hasOpenPty || isDisposed) {
            return;
          }

          const safeData = data.replace(/\x03/g, "");

          if (!safeData) {
            return;
          }

          invoke("terminal_write", {
            paneId,
            instanceId: terminalInstanceId,
            data: safeData,
          }).catch((error) => {
            if (isTerminalSessionMissingError(error)) {
              writeTerminalTelemetry({
                paneId,
                instanceId: terminalInstanceId,
                phase: "frontend.write.skip_missing_session",
              });
              return;
            }

            if (!isDisposed) {
              setTerminalError(getErrorMessage(error, "Unable to write to terminal."));
            }
          });
        }));

        const initialSize = await waitForTerminalSizeForOpen("terminal_open");

        if (isDisposed || !initialSize) {
          return;
        }

        if (terminal.cols !== initialSize.cols || terminal.rows !== initialSize.rows) {
          terminal.resize(initialSize.cols, initialSize.rows);
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.open.xterm_initial_resize",
            cols: initialSize.cols,
            rows: initialSize.rows,
            elapsedMs: performance.now() - lifecycleStartedAt,
            fields: {
              metricSource: initialSize.metricSource,
              terminalIndex,
            },
          });
        }

        const shouldPrewarmShell = prewarmShell && !agentLaunchReadyRef.current;
        const openKind = shouldPrewarmShell ? "prewarm-pty" : agent.id;
        const openProvider = shouldPrewarmShell ? null : agent.id;
        let agentStartedInCurrentPty = !shouldPrewarmShell;

        startAgentInCurrentPty = async (reason = "agent_launch_ready", launchEpoch = agentLaunchEpochRef.current) => {
          if (isDisposed || !hasOpenPty || agentStartedInCurrentPty) {
            return;
          }

          agentStartedInCurrentPty = true;
          startupWatchTimers.forEach((timer) => window.clearTimeout(timer));
          startupWatchTimers.clear();
          runtimeTerminalState = "starting";
          setTerminalState("starting");
          setTerminalError("");

          const agentLaunchStartedAt = performance.now();
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.agent_launch.batch_attach_start",
            cols: terminal.cols,
            rows: terminal.rows,
            fields: {
              agentId: agent.id,
              launchEpoch,
              reason,
              terminalIndex,
              ...getWorkspaceOpenTelemetryFields(workspace?.id),
            },
          });

          runtimeTerminalState = "running";
          setTerminalState("running");
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.agent_launch.batch_attach_done",
            cols: terminal.cols,
            rows: terminal.rows,
            elapsedMs: performance.now() - agentLaunchStartedAt,
            fields: {
              agentId: agent.id,
              launchEpoch,
              reason,
              terminalIndex,
              ...getWorkspaceOpenTelemetryFields(workspace?.id),
            },
          });
          resizeController?.resizeNow("agent_launch_done");
          scheduleRenderProbe("agent_launch_done", TERMINAL_RENDER_PROBE_AFTER_RESIZE_MS, {
            initialCols: initialSize.cols,
            initialRows: initialSize.rows,
            reason,
          });
          scheduleBlankStartupWatch("agent_launch_done");
        };
        startAgentInPrewarmedTerminalRef.current = shouldPrewarmShell ? startAgentInCurrentPty : null;

        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.open.invoke_start",
          cols: initialSize.cols,
          rows: initialSize.rows,
          elapsedMs: performance.now() - lifecycleStartedAt,
          fields: {
            kind: openKind,
            prewarmShell: shouldPrewarmShell,
            hasWorkingDirectory: Boolean(workingDirectory),
            workingDirectory: workingDirectory || "",
            ...getWorkspaceOpenTelemetryFields(workspace?.id),
          },
        });

        const openStartedAt = performance.now();
        if (isDisposed) {
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.open.skip_disposed",
            elapsedMs: performance.now() - openStartedAt,
            fields: {
              terminalIndex,
              ...getWorkspaceOpenTelemetryFields(workspace?.id),
            },
          });
          return;
        }

        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.open.dispatch",
          elapsedMs: performance.now() - openStartedAt,
          fields: {
            terminalIndex,
            transport: "binary_channel",
            hasWorkingDirectory: Boolean(workingDirectory),
            workingDirectory: workingDirectory || "",
            ...getWorkspaceOpenTelemetryFields(workspace?.id),
          },
        });
        await invoke("terminal_open", {
          request: {
            paneId,
            instanceId: terminalInstanceId,
            kind: openKind,
            provider: openProvider,
            model: "",
            workingDirectory: workingDirectory || "",
            workspaceId: workspace?.id || "",
            workspaceName: workspace?.name || "",
            cols: initialSize.cols,
            rows: initialSize.rows,
          },
          outputChannel,
        });

        if (isDisposed) {
          invoke("terminal_close", { paneId, instanceId: terminalInstanceId }).catch(() => {});
          return;
        }

        hasOpenPty = true;
        runtimeTerminalState = shouldPrewarmShell ? "prewarmed" : "running";
        setTerminalState(shouldPrewarmShell ? "starting" : "running");
        patchTerminalMetrics({ startupMs: performance.now() - openStartedAt });
        writeTerminalTelemetry({
          paneId,
          instanceId: terminalInstanceId,
          phase: "frontend.open.invoke_done",
          cols: initialSize.cols,
          rows: initialSize.rows,
          elapsedMs: performance.now() - openStartedAt,
          fields: {
            kind: openKind,
            prewarmShell: shouldPrewarmShell,
          },
        });
        resizeController?.resizeNow("terminal_open_done");
        scheduleRenderProbe("terminal_open_done", TERMINAL_RENDER_PROBE_AFTER_RESIZE_MS, {
          initialCols: initialSize.cols,
          initialRows: initialSize.rows,
          prewarmShell: shouldPrewarmShell,
        });

        scheduleWebglAttach("idle", TERMINAL_WEBGL_IDLE_DELAY_MS);

        if (terminalIndex === 0) {
          terminal.focus();
        }

        if (shouldPrewarmShell) {
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.prewarm.ready",
            elapsedMs: performance.now() - openStartedAt,
            fields: {
              agentId: agent.id,
              terminalIndex,
              ...getWorkspaceOpenTelemetryFields(workspace?.id),
            },
          });
          onPreparedTerminalChange?.({
            agentId: agent.id,
            instanceId: terminalInstanceId,
            paneId,
            ready: true,
            terminalIndex,
            workspaceId: workspace?.id || "",
          });

          if (agentLaunchReadyRef.current && agentLaunchEpochRef.current > 0) {
            lastAgentLaunchEpochRef.current = agentLaunchEpochRef.current;
            startAgentInCurrentPty("prewarm_ready_after_gate", agentLaunchEpochRef.current);
          }

          return;
        }

        scheduleBlankStartupWatch("terminal_open_done");
      } catch (error) {
        if (!isDisposed) {
          runtimeTerminalState = "error";
          setTerminalState("error");
          setTerminalError(getErrorMessage(error, `Unable to launch ${agent.label}.`));
          writeTerminalTelemetry({
            paneId,
            instanceId: terminalInstanceId,
            phase: "frontend.start.error",
            elapsedMs: performance.now() - lifecycleStartedAt,
            fields: { error: getErrorMessage(error, "Unable to launch terminal.") },
          });
        }
      }
    }

    startTerminal();

    return () => {
      isDisposed = true;
      resizeController?.dispose();
      activeWebglAddon = null;
      if (webglAttachTimer) {
        window.clearTimeout(webglAttachTimer);
      }
      if (resizeIdleDebugTimer) {
        window.clearTimeout(resizeIdleDebugTimer);
      }
      startupMetricTimers.forEach((timer) => window.clearTimeout(timer));
      startupMetricTimers.clear();
      renderProbeTimers.forEach((timer) => window.clearTimeout(timer));
      renderProbeTimers.clear();
      resizeDebugProbeTimers.forEach((timer) => window.clearTimeout(timer));
      resizeDebugProbeTimers.clear();
      startupWatchTimers.forEach((timer) => window.clearTimeout(timer));
      startupWatchTimers.clear();
      resizeWriteBarrierActive = false;
      resizeWriteBarrierQueue.length = 0;
      resizeWriteBarrierBytes = 0;
      pendingResizeScrollAnchor = null;
      disposables.forEach((dispose) => {
        if (typeof dispose === "function") {
          dispose();
        } else {
          dispose?.dispose?.();
        }
      });
      hasOpenPty = false;
      if (startAgentInPrewarmedTerminalRef.current === startAgentInCurrentPty) {
        startAgentInPrewarmedTerminalRef.current = null;
      }
      onPreparedTerminalChange?.({
        agentId: agent?.id || "",
        instanceId: terminalInstanceId,
        paneId,
        ready: false,
        terminalIndex,
        workspaceId: workspace?.id || "",
      });
      writeTerminalTelemetry({
        paneId,
        instanceId: terminalInstanceId,
        phase: "frontend.terminal.cleanup",
        elapsedMs: performance.now() - lifecycleStartedAt,
        fields: getWorkspaceOpenTelemetryFields(workspace?.id),
      });
      invoke("terminal_close", { paneId, instanceId: terminalInstanceId }).catch(() => {});
      terminal.dispose();
    };
  }, [agent?.id, agent?.label, onPreparedTerminalChange, paneId, restartKey, terminalClosed, useWebglRenderer, workingDirectory, workspace?.id]);

  const closeTerminal = useCallback(async () => {
    if (terminalClosed || terminalClosingRef.current) {
      return;
    }

    setTerminalError("");
    terminalClosingRef.current = true;
    setTerminalClosing(true);
    setTerminalState("closing");

    try {
      await invoke("terminal_close", {
        paneId,
        instanceId: terminalInstanceIdRef.current || undefined,
      });
    } catch (error) {
      terminalClosingRef.current = false;
      setTerminalClosing(false);
      setTerminalError(getErrorMessage(error, "Unable to close terminal."));
      return;
    }

    terminalClosingRef.current = false;
    setTerminalClosing(false);
    setTerminalClosed(true);
    setTerminalState("closed");
    onCloseTerminal?.({
      paneId,
      terminalIndex,
      workspaceId: workspace?.id || "",
    });
  }, [onCloseTerminal, paneId, terminalClosed, terminalIndex, workspace?.id]);

  if (!agent) {
    return (
      <TerminalWorkspaceSurface>
        <TerminalEmptyPanel>
          <TerminalEmptyCopy>
            <PanelKicker>Terminal readiness</PanelKicker>
            <PanelHeading>Install and connect Codex or Claude Code</PanelHeading>
            <PageSubline>
              The workspace opens a live local PTY only after a provider CLI is installed and authenticated.
            </PageSubline>
          </TerminalEmptyCopy>
          <TerminalAgentList>
            {getAgentStatusSummary(agentStatuses).map((status) => (
              <TerminalAgentRow data-tone={getAgentTone(status)} key={status.id}>
                <AgentIcon data-tone={getAgentTone(status)}>
                  {status.id === "codex" ? <ButtonCodeIcon aria-hidden="true" /> : <ButtonBotIcon aria-hidden="true" />}
                </AgentIcon>
                <div>
                  <strong>{status.label}</strong>
                  <span>{status.authMessage}</span>
                </div>
              </TerminalAgentRow>
            ))}
          </TerminalAgentList>
          {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
          {agentStatusError && <FormMessage $state="error">{agentStatusError}</FormMessage>}
          <TerminalEmptyActions>
            <SecondaryButton disabled={agentStatusState === "checking"} onClick={onRecheckAgents} type="button">
              <ButtonRefreshIcon aria-hidden="true" />
              <span>{agentStatusState === "checking" ? "Checking..." : "Recheck"}</span>
            </SecondaryButton>
            <PrimaryButton onClick={onOpenSettings} type="button">
              <ButtonSettingsIcon aria-hidden="true" />
              <span>Settings</span>
            </PrimaryButton>
          </TerminalEmptyActions>
        </TerminalEmptyPanel>
      </TerminalWorkspaceSurface>
    );
  }

  return (
    <TerminalWorkspaceSurface>
      <TerminalRestartPill>
        <TerminalAgentIdBadge
          aria-label={terminalAgentTitle}
          data-agent={terminalAgentKind}
          data-slot={getTerminalAgentColorSlot(terminalIndex)}
          title={terminalAgentTitle}
        >
          {terminalAgentId}
        </TerminalAgentIdBadge>
        <TerminalRestartButton
          aria-label="Restart terminal"
          disabled={terminalClosing}
          onClick={() => {
            if (terminalClosing) {
              return;
            }

            setTerminalClosed(false);
            terminalClosingRef.current = false;
            setTerminalClosing(false);
            setTerminalState("starting");
            setTerminalError("");
            setRestartKey((key) => key + 1);
          }}
          title="Restart terminal"
          type="button"
        >
          <ButtonRefreshIcon aria-hidden="true" />
        </TerminalRestartButton>
        <TerminalCloseButton
          aria-label="Close terminal"
          disabled={terminalClosed || terminalClosing}
          onClick={closeTerminal}
          title="Close terminal"
          type="button"
        >
          <ButtonCloseIcon aria-hidden="true" />
        </TerminalCloseButton>
      </TerminalRestartPill>

      {(terminalError || agentStatusError || workspaceError) && (
        <BlankStatusStack>
          {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
          {terminalError && <FormMessage $state="error">{terminalError}</FormMessage>}
          {agentStatusError && <FormMessage $state="error">{agentStatusError}</FormMessage>}
        </BlankStatusStack>
      )}

      <TerminalFrame aria-busy={terminalClosing ? "true" : "false"} data-state={terminalState}>
        {terminalClosed ? (
          <TerminalClosedSurface aria-live="polite" role="status">
            <TerminalClosedLabel>Terminal Closed</TerminalClosedLabel>
          </TerminalClosedSurface>
        ) : (
          <>
            <XtermSurface ref={containerRef} />
            {terminalClosing && (
              <TerminalClosingOverlay aria-live="polite" role="status">
                <div>
                  <span aria-hidden="true" data-spinner="true" />
                  <strong>Closing terminal</strong>
                  <span>Shutting it down...</span>
                </div>
              </TerminalClosingOverlay>
            )}
          </>
        )}
      </TerminalFrame>
    </TerminalWorkspaceSurface>
  );
}

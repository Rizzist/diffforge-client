import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  collapseFunctionalRepoPathToCoreRepoPath,
  createCoreRepoNameDisplayMasker,
  getCoreRepoDisplayLabel,
} from "./coreRepoNameDisplay";
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
  TerminalFrame,
  XtermSurface,
  TerminalClosedSurface,
  TerminalClosedLabel,
  TerminalClosingOverlay,
  TerminalStatusOverlay,
  TerminalStatusSpinner,
  TerminalStatusCopy,
  TerminalParkedBar,
  TerminalParkedSpinner,
  TerminalParkedCopy,
  TerminalParkedAgents,
  TerminalParkedAgentBadge,
  TerminalParkedCancelButton,
  TerminalRestartPill,
  TerminalAgentIdBadge,
  TerminalProjectBadge,
  TerminalRestartMenu,
  TerminalRestartDropdown,
  TerminalRestartOption,
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
import {
  createTerminalResizeController,
  measureTerminalGrid,
} from "./terminalResizeController";
import {
  addTerminalMetrics,
  patchTerminalMetrics,
} from "./terminalTelemetry.jsx";

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
const TERMINAL_RESIZE_WRITE_BARRIER_MAX_MS = 100;
const TERMINAL_BLANK_STARTUP_PROBE_MS = 800;
const TERMINAL_BLANK_STARTUP_CONFIRM_MS = 800;
const TERMINAL_BACKEND_PREP_DETAIL_MS = 2500;
const TERMINAL_SCROLLBAR_HIDE_DELAY_MS = 700;
const TERMINAL_SCROLLBAR_INTENT_MS = 900;
const TERMINAL_SCROLL_ANCHOR_TARGET_FRACTION = 0.6;
const TERMINAL_SCROLL_ANCHOR_SEARCH_RADIUS_ROWS = 180;
const TERMINAL_SCROLL_ANCHOR_MAX_TEXT_CHARS = 360;
const TERMINAL_SCROLL_ANCHOR_MIN_ALNUM_CHARS = 2;
const TERMINAL_AGENT_COLOR_SLOT_COUNT = 16;
const TERMINAL_AUDIO_INPUT_REFOCUS_EVENT = "forge-terminal-audio-input-refocus";
const TERMINAL_ACTIVE_PANE_EVENT = "forge-terminal-active-pane-change";
const TERMINAL_PARKED_PROMPT_EVENT = "forge-terminal-parked-prompt";
const TERMINAL_OUTPUT_BATCH_MAX_MS = 33;
const TERMINAL_OUTPUT_BATCH_MAX_BYTES = 32 * 1024;
const TERMINAL_INPUT_BATCH_MS = 8;
const TERMINAL_DELETE_INPUT_BATCH_MS = 28;
const TERMINAL_INPUT_BATCH_MAX_CHARS = 64;
const TERMINAL_SHIFT_ENTER_SEQUENCE = "\x1b[13;2u";
const TODO_DRAG_MIME = "application/x-diffforge-todo";
let activeTerminalKeyboardTarget = null;

const terminalKeyboardTargetMatches = (paneId, instanceId) => (
  activeTerminalKeyboardTarget?.paneId === paneId
  && Number(activeTerminalKeyboardTarget?.instanceId || 0) === Number(instanceId || 0)
);

const setActiveTerminalKeyboardTarget = (paneId, instanceId) => {
  activeTerminalKeyboardTarget = {
    instanceId: Number(instanceId || 0),
    paneId,
  };
};

const clearActiveTerminalKeyboardTargetIfCurrent = (paneId, instanceId) => {
  if (terminalKeyboardTargetMatches(paneId, instanceId)) {
    activeTerminalKeyboardTarget = null;
  }
};

const TODO_DROP_OVERLAY_STYLE = {
  position: "absolute",
  inset: "10px",
  zIndex: 9,
  display: "grid",
  placeItems: "center",
  border: "2px dotted rgba(138, 216, 255, 0.92)",
  borderRadius: "14px",
  background: "rgba(2, 8, 14, 0.54)",
  boxShadow: "inset 0 0 0 1px rgba(255, 173, 124, 0.24), 0 0 32px rgba(138, 216, 255, 0.12)",
  pointerEvents: "none",
};
const TODO_DROP_OVERLAY_LABEL_STYLE = {
  border: "1px solid rgba(138, 216, 255, 0.3)",
  borderRadius: "999px",
  padding: "8px 12px",
  color: "#e9f8ff",
  background: "linear-gradient(135deg, rgba(6, 16, 26, 0.96), rgba(28, 16, 10, 0.92))",
  fontSize: "12px",
  fontWeight: 800,
  letterSpacing: "0.04em",
  textTransform: "uppercase",
};

function isWindowsTerminalHost() {
  if (typeof navigator === "undefined") {
    return false;
  }

  const platform = String(navigator.platform || "");
  const userAgent = String(navigator.userAgent || "");

  return /windows|win32|win64|wince/i.test(`${platform} ${userAgent}`);
}

const TERMINAL_IS_WINDOWS_HOST = isWindowsTerminalHost();
const TERMINAL_SCROLLBAR_PLATFORM = TERMINAL_IS_WINDOWS_HOST ? "native" : "overlay";
const TERMINAL_ROLE_SWITCH_OPTIONS = [
  { id: "codex", label: "Codex", shortLabel: "CX" },
  { id: "claude", label: "Claude Code", shortLabel: "CL" },
  { id: "generic", label: "Terminal", shortLabel: "SH" },
  { id: "opencode", label: "OpenCode", shortLabel: "OC" },
];

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

function getDraggedTodoPrompt(dataTransfer) {
  const customPayload = dataTransfer?.getData(TODO_DRAG_MIME);
  if (customPayload) {
    try {
      const parsed = JSON.parse(customPayload);
      const text = String(parsed?.text || "").trim();
      if (text) {
        return text;
      }
    } catch (_error) {
      const text = String(customPayload || "").trim();
      if (text) {
        return text;
      }
    }
  }

  return String(dataTransfer?.getData("text/plain") || "").trim();
}

function isTodoDragTransfer(dataTransfer) {
  const transferTypes = Array.from(dataTransfer?.types || []);
  return transferTypes.includes(TODO_DRAG_MIME) || transferTypes.includes("text/plain");
}

function isTerminalSessionMissingError(error) {
  const message = getErrorMessage(error, "").toLowerCase();

  return message.includes("terminal session is not running")
    || message.includes("terminal session not running");
}

function getTerminalInputDebugFields(data) {
  const text = String(data || "");
  const bytes = Array.from(new TextEncoder().encode(text));

  return {
    bytes: bytes.length,
    chars: Array.from(text).length,
    controlByteHex: bytes
      .filter((byte) => byte < 32 || byte === 127)
      .slice(0, 12)
      .map((byte) => byte.toString(16).padStart(2, "0")),
    escapeCount: bytes.filter((byte) => byte === 0x1b).length,
    hasEscape: bytes.includes(0x1b),
    isBareEscape: bytes.length === 1 && bytes[0] === 0x1b,
    prefixHex: bytes.slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")),
    startsWithEscape: bytes[0] === 0x1b,
  };
}

function stripTerminalControlSequences(text) {
  const value = String(text || "");
  let output = "";
  let index = 0;

  while (index < value.length) {
    const code = value.charCodeAt(index);

    if (code === 0x1b) {
      const next = value[index + 1] || "";

      if (next === "[") {
        index += 2;
        while (index < value.length) {
          const finalCode = value.charCodeAt(index);
          index += 1;
          if (finalCode >= 0x40 && finalCode <= 0x7e) {
            break;
          }
        }
        continue;
      }

      if (next === "]") {
        index += 2;
        while (index < value.length) {
          const currentCode = value.charCodeAt(index);
          if (currentCode === 0x07) {
            index += 1;
            break;
          }
          if (currentCode === 0x1b && value[index + 1] === "\\") {
            index += 2;
            break;
          }
          index += 1;
        }
        continue;
      }

      index += next ? 2 : 1;
      continue;
    }

    if (code >= 0x20 && code !== 0x7f) {
      output += value[index];
    }
    index += 1;
  }

  return output;
}

function isTerminalGeneratedReplyInput(data) {
  const text = String(data || "");

  return /^\x1b\[\d+;\d+R$/.test(text)
    || /^\x1b\[\??[0-9;]*c$/.test(text);
}

function getTerminalOutputDebugFields(data) {
  const bytes = Array.from(data || []);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(data || new Uint8Array());
  const displayText = stripTerminalControlSequences(text);
  const displayChars = Array.from(displayText);

  return {
    bytes: bytes.length,
    chars: displayChars.length,
    controlByteHex: bytes
      .filter((byte) => byte < 32 || byte === 127)
      .slice(0, 16)
      .map((byte) => byte.toString(16).padStart(2, "0")),
    controlBytes: bytes.filter((byte) => byte < 32 || byte === 127).length,
    escapeBytes: bytes.filter((byte) => byte === 0x1b).length,
    hasEscape: bytes.includes(0x1b),
    prefixHex: bytes.slice(0, 24).map((byte) => byte.toString(16).padStart(2, "0")),
    printableChars: displayChars.length,
    safePreview: displayChars
      .slice(0, 120)
      .join("")
      .trim(),
    startsWithEscape: bytes[0] === 0x1b,
    visibleChars: displayChars.filter((character) => !/\s/.test(character)).length,
  };
}

function getTerminalKeyDebugFields(event, extraFields = {}) {
  return {
    altKey: Boolean(event.altKey),
    code: event.code || "",
    ctrlKey: Boolean(event.ctrlKey),
    defaultPrevented: Boolean(event.defaultPrevented),
    isComposing: Boolean(event.isComposing),
    key: event.key || "",
    metaKey: Boolean(event.metaKey),
    repeat: Boolean(event.repeat),
    shiftKey: Boolean(event.shiftKey),
    targetTag: event.target?.tagName || "",
    ...extraFields,
  };
}

function isPlainShiftEnterEvent(event) {
  return event.key === "Enter"
    && event.shiftKey
    && !event.metaKey
    && !event.ctrlKey
    && !event.altKey
    && !event.isComposing;
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

  if (normalizedAgentId.includes("generic") || normalizedAgentId.includes("shell")) {
    return "generic";
  }

  if (normalizedAgentId.includes("claude")) {
    return "claude";
  }

  if (normalizedAgentId.includes("opencode") || normalizedAgentId.includes("open-code")) {
    return "opencode";
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
  const opencode = agentStatuses.find((agent) => agent.id === "opencode");

  return [codex, claude, opencode].filter(Boolean);
}

function getShortRealAgentId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.replace(/[^a-z0-9]/gi, "").slice(0, 3);
}

function getTerminalAgentId(agentId, realAgentId) {
  const realId = getShortRealAgentId(realAgentId);
  if (realId) return realId;

  const kind = getTerminalAgentKind(agentId);
  if (kind === "generic") return "sh";

  return "...";
}

function getTerminalRoleSwitchOptions(agentStatuses) {
  const installedAgentIds = new Set(
    (Array.isArray(agentStatuses) ? agentStatuses : [])
      .filter((agent) => agent.installed)
      .map((agent) => agent.id),
  );

  return TERMINAL_ROLE_SWITCH_OPTIONS.filter((option) => (
    option.id === "generic" || installedAgentIds.has(option.id)
  ));
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
  waitForCleanup = false,
  workspaceId,
}) {
  const paneId = getWorkspaceTerminalPaneId(workspaceId, terminalIndex, agentId);


  return invoke("terminal_close", {
    paneId,
    waitForCleanup: waitForCleanup || undefined,
  })
    .then(() => {
      return { closed: true, paneId };
    })
    .catch((error) => {
      const message = getErrorMessage(error, "Unable to close removed terminal.");
      return { closed: false, error: message, paneId };
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

export default function WorkspaceTerminal({
  agent,
  agentLaunchEpoch = 0,
  agentLaunchReady = true,
  agentStatuses,
  agentStatusError,
  agentStatusState,
  onChangeTerminalRole,
  onCloseTerminal,
  onOpenSettings,
  onPreparedTerminalChange,
  onRecheckAgents,
  prewarmShell = false,
  terminalIndex = 0,
  terminalCount = 1,
  terminalRole = "",
  useWebglRenderer = TERMINAL_ENABLE_WEBGL_RENDERER,
  workingDirectory,
  workspace,
  workspaceError,
}) {
  const containerRef = useRef(null);
  const xtermRef = useRef(null);
  const terminalInstanceIdRef = useRef(0);
  const agentLaunchEpochRef = useRef(agentLaunchEpoch);
  const agentLaunchReadyRef = useRef(agentLaunchReady);
  const lastAgentLaunchEpochRef = useRef(0);
  const startAgentInPrewarmedTerminalRef = useRef(null);
  const blankStartupProbeCountRef = useRef(0);
  const terminalClosingRef = useRef(false);
  const preserveCoordinationOnNextCleanupRef = useRef(false);
  const preserveCoordinationOnNextOpenRef = useRef(false);
  const parkedPromptRef = useRef(null);
  const [terminalState, setTerminalState] = useState(agent ? "starting" : "blocked");
  const [terminalError, setTerminalError] = useState("");
  const [terminalStatus, setTerminalStatus] = useState(() => ({
    detail: agent ? "Preparing pane." : "No terminal agent is configured.",
    title: agent ? "Starting Terminal" : "Terminal Blocked",
    visible: Boolean(agent),
  }));
  const [restartKey, setRestartKey] = useState(0);
  const [terminalClosed, setTerminalClosed] = useState(false);
  const [terminalClosing, setTerminalClosing] = useState(false);
  const [restartRoleMenuOpen, setRestartRoleMenuOpen] = useState(false);
  const [terminalLaunchInfo, setTerminalLaunchInfo] = useState(null);
  const [parkedPrompt, setParkedPrompt] = useState(null);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const terminalRoleId = String(terminalRole || agent?.id || "").toLowerCase();
  const isGenericTerminal = terminalRoleId === "generic" || agent?.id === "generic";
  const paneAgentId = isGenericTerminal ? "generic" : agent?.id;
  const paneId = getWorkspaceTerminalPaneId(workspace?.id, terminalIndex, paneAgentId);
  const terminalAgentKind = getTerminalAgentKind(paneAgentId);
  const terminalAgentId = getTerminalAgentId(paneAgentId, terminalLaunchInfo?.agentId);
  const terminalAgentTitle = `${isGenericTerminal ? "Generic shell" : agent?.label || "Agent"} terminal ${terminalAgentId}`;
  const projectRoot = collapseFunctionalRepoPathToCoreRepoPath(
    terminalLaunchInfo?.projectRoot || terminalLaunchInfo?.workingDirectory || workingDirectory || "",
  );
  const projectLabel = getCoreRepoDisplayLabel(projectRoot, workspace?.name || "Project");
  const coordinationMode = terminalLaunchInfo?.coordinationMode || "";
  const hasIsolatedWorktree = !isGenericTerminal && Boolean(
    coordinationMode === "worktree_required"
    || (terminalLaunchInfo?.agentBranchRoot && coordinationMode !== "coordination_only"),
  );
  const isolationLabel = isGenericTerminal
    ? "plain shell"
    : hasIsolatedWorktree
      ? "isolated edits"
      : "preparing isolation";
  const projectBadgeLabel = isGenericTerminal
    ? `${projectLabel} plain shell terminal`
    : `${projectLabel} editing with isolated branch protection`;
  const projectBadgeTitle = isGenericTerminal
    ? `${projectLabel} - generic shell with normal terminal controls`
    : `${projectLabel} - edits are isolated in the agent worktree until merge`;
  const focusTerminalKeyboardInput = useCallback(() => {
    const terminal = xtermRef.current;
    if (!terminal) {
      return;
    }

    try {
      terminal.focus();
    } catch (_) {
      return;
    }

    window.setTimeout(() => {
      if (terminal !== xtermRef.current) {
        return;
      }

      try {
        terminal.focus();
      } catch (_) {
        // Terminal may have been disposed between activation and the deferred focus pass.
      }
    }, 0);
  }, []);
  const selectTerminalPane = useCallback(() => {
    const instanceId = terminalInstanceIdRef.current || 0;
    setActiveTerminalKeyboardTarget(paneId, instanceId);
    setTerminalFocused(true);
    focusTerminalKeyboardInput();
    window.dispatchEvent(new CustomEvent(TERMINAL_ACTIVE_PANE_EVENT, {
      detail: {
        instanceId,
        paneId,
        terminalIndex,
        workspaceId: workspace?.id || "",
      },
    }));
  }, [focusTerminalKeyboardInput, paneId, terminalIndex, workspace?.id]);
  const requestTerminalAudioInputTarget = useCallback((active) => {
    const instanceId = terminalInstanceIdRef.current || undefined;

    if (active && !instanceId) {
      clearActiveTerminalKeyboardTargetIfCurrent(paneId, terminalInstanceIdRef.current || 0);
      setTerminalFocused(false);
      return Promise.resolve(false);
    }

    if (active) {
      setActiveTerminalKeyboardTarget(paneId, instanceId);
    }

    return invoke("set_terminal_audio_input_target", {
      active,
      instanceId,
      paneId,
    })
      .then(() => {
        if (active) {
          selectTerminalPane();
        } else {
          clearActiveTerminalKeyboardTargetIfCurrent(paneId, instanceId);
          setTerminalFocused(false);
        }

        return true;
      })
      .catch(() => {
        if (active) {
          clearActiveTerminalKeyboardTargetIfCurrent(paneId, instanceId);
          setTerminalFocused(false);
        }

        return false;
      });
  }, [paneId, selectTerminalPane]);

  useEffect(() => {
    const handleActivePaneChange = (event) => {
      setTerminalFocused(
        event.detail?.paneId === paneId
        && Number(event.detail?.instanceId || 0) === Number(terminalInstanceIdRef.current || 0),
      );
    };

    window.addEventListener(TERMINAL_ACTIVE_PANE_EVENT, handleActivePaneChange);

    return () => {
      window.removeEventListener(TERMINAL_ACTIVE_PANE_EVENT, handleActivePaneChange);
    };
  }, [paneId]);

  useEffect(() => {
    parkedPromptRef.current = parkedPrompt;
    const terminal = xtermRef.current;
    if (!terminal) {
      return;
    }

    const isParked = Boolean(parkedPrompt);
    terminal.options.disableStdin = isParked;
    terminal.options.cursorBlink = !isParked;
    if (isParked) {
      terminal.blur?.();
    }
  }, [parkedPrompt]);

  useEffect(() => {
    setTerminalClosed(false);
    terminalClosingRef.current = false;
    setTerminalClosing(false);
    setTerminalLaunchInfo(null);
    setParkedPrompt(null);
    lastAgentLaunchEpochRef.current = 0;
    blankStartupProbeCountRef.current = 0;
  }, [agent?.id, terminalIndex, terminalRoleId, workspace?.id]);

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
    let disposed = false;
    let unlisten = null;

    listen(TERMINAL_PARKED_PROMPT_EVENT, (event) => {
      const payload = event.payload || {};
      if (
        payload.paneId !== paneId
        || Number(payload.instanceId || 0) !== Number(terminalInstanceIdRef.current || 0)
      ) {
        return;
      }

      if (payload.status === "parked") {
        setParkedPrompt(payload);
      } else {
        setParkedPrompt(null);
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [paneId]);

  useEffect(() => {
    if (terminalClosed || terminalClosing) {
      return undefined;
    }

    let disposed = false;
    const syncParkedPrompt = async () => {
      const instanceId = Number(terminalInstanceIdRef.current || 0);
      if (!instanceId || disposed) {
        return;
      }
      try {
        const payload = await invoke("terminal_get_parked_prompt", {
          paneId,
          instanceId,
        });
        if (disposed) {
          return;
        }
        if (payload?.status === "parked") {
          setParkedPrompt(payload);
        } else {
          setParkedPrompt(null);
        }
      } catch {
        // Best-effort recovery path; the event listener remains the primary path.
      }
    };

    syncParkedPrompt();
    const intervalId = window.setInterval(syncParkedPrompt, 1000);
    return () => {
      disposed = true;
      window.clearInterval(intervalId);
    };
  }, [paneId, terminalClosed, terminalClosing, terminalState, restartKey]);

  useEffect(() => {
    if (!agent) {
      startAgentInPrewarmedTerminalRef.current = null;
      preserveCoordinationOnNextCleanupRef.current = false;
      preserveCoordinationOnNextOpenRef.current = false;
      setTerminalState("blocked");
      setTerminalError("");
      setTerminalStatus({
        detail: "No terminal agent is configured.",
        title: "Terminal Blocked",
        visible: true,
      });
      setTerminalLaunchInfo(null);
      setParkedPrompt(null);
      terminalClosingRef.current = false;
      setTerminalClosing(false);
      return undefined;
    }

    if (terminalClosed) {
      preserveCoordinationOnNextCleanupRef.current = false;
      preserveCoordinationOnNextOpenRef.current = false;
      setTerminalState("closed");
      setTerminalError("");
      setTerminalStatus({
        detail: "This pane is closed.",
        title: "Terminal Closed",
        visible: false,
      });
      setTerminalLaunchInfo(null);
      setParkedPrompt(null);
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
    const startupWatchTimers = new Set();
    // Tauri's WebView can corrupt xterm's WebGL glyph atlas during rapid multi-pane resize.
    let rendererMode = useWebglRenderer ? "webgl_pending" : "canvas";
    let runtimeTerminalState = "starting";
    const preserveCoordinationForThisStart = preserveCoordinationOnNextOpenRef.current && !isGenericTerminal;
    preserveCoordinationOnNextOpenRef.current = false;
    if (!preserveCoordinationForThisStart) {
      setTerminalLaunchInfo(null);
    }
    let startAgentInCurrentPty = null;
    let hasOpenPty = false;
    let startupControlReplyBridgeOpen = false;
    let activeWebglAddon = null;
    let resizeController = null;
    let backendPrepDetailTimer = 0;
    let pendingResizeScrollAnchor = null;
    let resizeWriteBarrierActive = false;
    let resizeWriteBarrierStartedAt = 0;
    let resizeWriteBarrierReason = "";
    let resizeWriteBarrierBytes = 0;
    let resizeWriteBarrierTimer = 0;
    const resizeWriteBarrierQueue = [];
    const pendingOutputWrites = [];
    let pendingOutputBytes = 0;
    let outputBatchRafId = 0;
    let outputBatchTimeoutId = 0;
    let outputBatchQueuedAt = 0;
    let sawFirstOutput = false;
    let sawFirstVisibleOutput = false;
    let outputBytes = 0;
    let outputChunks = 0;
    let visibleOutputBytes = 0;
    let visibleOutputChunks = 0;
    const disposables = [];
    const startupMetricTimers = new Set();
    const terminalInstanceId = getNextWorkspaceTerminalInstanceId();
    terminalInstanceIdRef.current = terminalInstanceId;
    const lifecycleStartedAt = performance.now();
    const setPaneStage = (state, title, detail = "", fields = {}) => {
      if (isDisposed) {
        return;
      }

      runtimeTerminalState = state;
      setTerminalState(state);
      setTerminalStatus({
        detail,
        title,
        visible: state !== "running" && state !== "prewarmed" && state !== "closed" && !terminalClosed,
      });
    };

    setPaneStage("starting", "Preparing Terminal", "Creating terminal renderer.");

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

    container.dataset.scrollbarPlatform = TERMINAL_SCROLLBAR_PLATFORM;

    const terminal = new XTerm({
      allowProposedApi: false,
      convertEol: true,
      cursorBlink: !parkedPromptRef.current,
      cursorStyle: "block",
      disableStdin: Boolean(parkedPromptRef.current),
      fontFamily: "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.22,
      macOptionIsMeta: true,
      // Codex keeps cwd/status text on the live cursor row; do not let narrow resizes reflow stale worktree cells.
      reflowCursorLine: false,
      scrollback: TERMINAL_DEFAULT_SCROLLBACK_ROWS,
      ...(TERMINAL_IS_WINDOWS_HOST ? { windowsPty: { backend: "conpty" } } : {}),
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
        scrollbarSliderBackground: "rgba(172, 185, 207, 0.46)",
        scrollbarSliderHoverBackground: "rgba(192, 204, 224, 0.62)",
        scrollbarSliderActiveBackground: "rgba(210, 221, 238, 0.78)",
      },
    });
    xtermRef.current = terminal;

    terminal.open(container);
    const terminalScrollableElement = container.querySelector(".xterm-scrollable-element");

    let terminalFocusClearTimer = 0;
    const markTerminalAudioInputTarget = () => {
      if (terminalFocusClearTimer) {
        window.clearTimeout(terminalFocusClearTimer);
        terminalFocusClearTimer = 0;
      }

      if (!isDisposed) {
        focusTerminalKeyboardInput();
        requestTerminalAudioInputTarget(true);
      }
    };
    const clearTerminalAudioInputTarget = () => {
      if (!isDisposed) {
        requestTerminalAudioInputTarget(false);
      }
    };
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
        if (!container.contains(document.activeElement) && document.hasFocus()) {
          clearTerminalAudioInputTarget();
        }
      }, 0);
    };
    const clearTerminalAudioInputTargetIfPointerOutside = (event) => {
      if (!container.contains(event.target)) {
        clearTerminalAudioInputTarget();
      }
    };

    container.addEventListener("focusin", markTerminalAudioInputTarget, true);
    container.addEventListener("focusout", scheduleClearTerminalAudioInputTarget, true);
    container.addEventListener("pointerdown", markTerminalAudioInputTarget, true);
    document.addEventListener("pointerdown", clearTerminalAudioInputTargetIfPointerOutside, true);
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

    let updateTerminalScrollbarOverflow = () => false;
    let scheduleTerminalScrollbarRefresh = () => {};

    if (TERMINAL_SCROLLBAR_PLATFORM === "overlay" && terminalScrollableElement) {
      let terminalScrollbarHideTimer = 0;
      const terminalScrollbarRefreshTimers = new Set();
      let terminalScrollIntentUntil = 0;
      const getTerminalMaxViewportY = (activeBuffer) => Math.max(
        0,
        Number(activeBuffer?.baseY || 0),
        Number(activeBuffer?.length || 0) - Math.max(1, Number(terminal.rows) || TERMINAL_DEFAULT_ROWS),
      );

      updateTerminalScrollbarOverflow = () => {
        const activeBuffer = terminal.buffer?.active;
        const hasOverflow = Boolean(
          activeBuffer
          && activeBuffer.type !== "alternate"
          && (
            Number(activeBuffer.baseY || 0) > 0
            || getTerminalMaxViewportY(activeBuffer) > 0
          ),
        );

        if (hasOverflow) {
          container.dataset.scrollbarOverflow = "true";
        } else {
          delete container.dataset.scrollbarOverflow;
        }

        return hasOverflow;
      };
      scheduleTerminalScrollbarRefresh = (delays = [0, 80, 240]) => {
        delays.forEach((delayMs) => {
          const refreshTimer = window.setTimeout(() => {
            terminalScrollbarRefreshTimers.delete(refreshTimer);
            if (!isDisposed) {
              updateTerminalScrollbarOverflow();
            }
          }, Math.max(0, delayMs));

          terminalScrollbarRefreshTimers.add(refreshTimer);
        });
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

      disposables.push(terminal.onWriteParsed(updateTerminalScrollbarOverflow));
      disposables.push(terminal.onResize(updateTerminalScrollbarOverflow));
      terminalScrollableElement.addEventListener("wheel", handleTerminalScrollIntent, { passive: true });
      terminalScrollableElement.addEventListener("touchmove", handleTerminalScrollIntent, { passive: true });
      container.addEventListener("keydown", handleTerminalScrollKeyIntent, true);
      disposables.push(terminal.onScroll(handleTerminalViewportScroll));
      updateTerminalScrollbarOverflow();
      scheduleTerminalScrollbarRefresh([0, 80, 240, 800, 1600]);

      disposables.push(() => {
        if (terminalScrollbarHideTimer) {
          window.clearTimeout(terminalScrollbarHideTimer);
          terminalScrollbarHideTimer = 0;
        }
        terminalScrollbarRefreshTimers.forEach((timer) => window.clearTimeout(timer));
        terminalScrollbarRefreshTimers.clear();

        delete container.dataset.scrolling;
        delete container.dataset.scrollbarOverflow;
        delete container.dataset.scrollbarPlatform;

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
      document.removeEventListener("pointerdown", clearTerminalAudioInputTargetIfPointerOutside, true);
      window.removeEventListener("blur", clearTerminalAudioInputTargetIfAppUnfocused, true);
      clearTerminalAudioInputTarget();
    });

    const attachWebglRenderer = (reason = "scheduled") => {
      if (!useWebglRenderer || isDisposed || webglAttachAttempted) {
        return;
      }

      webglAttachAttempted = true;
      const webglStartedAt = performance.now();
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
          webglAddon.dispose();
        }));
        patchTerminalMetrics({ webglMs: performance.now() - webglStartedAt });
        refreshTerminalRenderer("webgl_attach_done", { reason });
      } catch {
        // WebGL is best-effort; xterm keeps its canvas renderer when WebGL2 is unavailable.
        rendererMode = "canvas";
        webglAddon.dispose();
        patchTerminalMetrics({ webglMs: performance.now() - webglStartedAt });
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

      webglAttachAt = attachAt;
      webglAttachTimer = window.setTimeout(() => {
        webglAttachTimer = 0;
        webglAttachAt = 0;
        attachWebglRenderer(reason);
      }, delayMs);
    };

    scheduleWebglAttach("xterm_open", 0);

    const refreshTerminalRenderer = (reason, extraFields = {}) => {
      if (isDisposed || typeof terminal.refresh !== "function") {
        return false;
      }

      try {
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
        return true;
      } catch (error) {
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

        if (hasVisibleRows || visibleOutputChunks > 0) {
          setTerminalStatus((current) => ({
            ...current,
            visible: false,
          }));
          return;
        }

        blankStartupProbeCountRef.current += 1;
        const blankProbeAttempt = blankStartupProbeCountRef.current;
        const probeFields = {
          reason,
          rendererMode,
          terminalIndex,
          outputBytes,
          outputChunks,
          blankProbeAttempt,
          cursorMoved,
          retryConfirmMs: TERMINAL_BLANK_STARTUP_CONFIRM_MS,
          retryProbeMs: TERMINAL_BLANK_STARTUP_PROBE_MS,
          visibleOutputBytes,
          visibleOutputChunks,
          buffer: bufferDiagnostics,
        };

        if (!previousProbe) {
          refreshTerminalRenderer("blank_startup_probe", {
            outputBytes,
            outputChunks,
          });
          scheduleBlankStartupWatch("blank_startup_confirm", TERMINAL_BLANK_STARTUP_CONFIRM_MS, {
            outputBytes,
            outputChunks,
            visibleOutputBytes,
            visibleOutputChunks,
          });
          return;
        }

        const outputChanged = outputBytes !== previousProbe.outputBytes
          || outputChunks !== previousProbe.outputChunks
          || visibleOutputBytes !== previousProbe.visibleOutputBytes
          || visibleOutputChunks !== previousProbe.visibleOutputChunks;

        refreshTerminalRenderer("blank_startup_watch", {
          outputBytes,
          outputChunks,
        });

      }, delayMs);

      startupWatchTimers.add(timer);
    };

    if (terminalIndex === 0) {
      terminal.focus();
    }

    runtimeTerminalState = "starting";
    setTerminalState("starting");
    setTerminalError("");

    const measureTerminalSizeForOpen = (reason) => {
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

      patchTerminalMetrics({ gridMs });

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
      let measurement = measureTerminalSizeForOpen(`${reason}_metric_wait`);

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
        measurement = measureTerminalSizeForOpen(`${reason}_metric_wait`);
      }

      const waitMs = performance.now() - waitStartedAt;

      if (measurement.ok) {
        return measurement;
      }


      throw new Error("Terminal render metrics were not ready before PTY startup.");
    };

    const cancelTerminalOutputBatchTimers = () => {
      if (outputBatchRafId) {
        window.cancelAnimationFrame(outputBatchRafId);
        outputBatchRafId = 0;
      }
      if (outputBatchTimeoutId) {
        window.clearTimeout(outputBatchTimeoutId);
        outputBatchTimeoutId = 0;
      }
    };

    const combineTerminalOutputWrites = (writes) => {
      if (writes.length === 1) {
        return writes[0].data;
      }

      const combined = new Uint8Array(writes.reduce((total, write) => total + write.data.byteLength, 0));
      let offset = 0;
      writes.forEach((write) => {
        combined.set(write.data, offset);
        offset += write.data.byteLength;
      });
      return combined;
    };

    const flushTerminalOutputBatch = (reason) => {
      if (isDisposed || !pendingOutputWrites.length) {
        cancelTerminalOutputBatchTimers();
        pendingOutputWrites.length = 0;
        pendingOutputBytes = 0;
        outputBatchQueuedAt = 0;
        return;
      }

      const writes = pendingOutputWrites.splice(0);
      const batchBytes = pendingOutputBytes;
      const queuedMs = outputBatchQueuedAt ? performance.now() - outputBatchQueuedAt : 0;
      pendingOutputBytes = 0;
      outputBatchQueuedAt = 0;
      cancelTerminalOutputBatchTimers();

      const batchData = combineTerminalOutputWrites(writes);
      const isFirstOutputChunk = writes.some((write) => write.isFirstOutputChunk);
      const isFirstVisibleOutputChunk = writes.some((write) => write.isFirstVisibleOutputChunk);
      const outputDebug = getTerminalOutputDebugFields(batchData);
      const shouldLogWrite = outputChunks <= 10
        || isFirstOutputChunk
        || isFirstVisibleOutputChunk
        || writes.length > 1;

      if (shouldLogWrite) {
      }

      terminal.write(batchData, () => {
        if (isDisposed) {
          return;
        }

        updateTerminalScrollbarOverflow();
        scheduleTerminalScrollbarRefresh([40, 160]);

        if (isFirstOutputChunk) {
          refreshTerminalRenderer("first_output_written", {
            bytes: batchData.byteLength,
            transport: "binary_channel",
          });
        }

        if (isFirstVisibleOutputChunk) {
          refreshTerminalRenderer("first_visible_output_written", {
            bytes: batchData.byteLength,
            transport: "binary_channel",
          });
          setTerminalStatus((current) => ({
            ...current,
            visible: false,
          }));
        }

        if (shouldLogWrite) {
        }
      });
    };

    const scheduleTerminalOutputBatchFlush = () => {
      if (!outputBatchRafId) {
        outputBatchRafId = window.requestAnimationFrame(() => {
          outputBatchRafId = 0;
          flushTerminalOutputBatch("animation_frame");
        });
      }

      if (!outputBatchTimeoutId) {
        outputBatchTimeoutId = window.setTimeout(() => {
          outputBatchTimeoutId = 0;
          flushTerminalOutputBatch("max_latency");
        }, TERMINAL_OUTPUT_BATCH_MAX_MS);
      }
    };

    const writeTerminalOutput = (data, options = {}) => {
      if (isDisposed || !data?.byteLength) {
        return;
      }

      const isFirstOutputChunk = options.isFirstOutputChunk === true;
      const isFirstVisibleOutputChunk = options.isFirstVisibleOutputChunk === true;
      const outputDebug = options.outputDebug || getTerminalOutputDebugFields(data);

      if (resizeWriteBarrierActive && !options.fromResizeBarrier) {
        const queuedData = typeof data.slice === "function" ? data.slice() : new Uint8Array(data);
        const wasEmpty = resizeWriteBarrierQueue.length === 0;

        resizeWriteBarrierQueue.push({
          data: queuedData,
          isFirstOutputChunk,
          isFirstVisibleOutputChunk,
          outputDebug,
        });
        resizeWriteBarrierBytes += queuedData.byteLength;

        if (wasEmpty) {
        }

        return;
      }

      const queuedData = typeof data.slice === "function" ? data.slice() : new Uint8Array(data);
      if (!pendingOutputWrites.length) {
        outputBatchQueuedAt = performance.now();
      }
      pendingOutputWrites.push({
        data: queuedData,
        isFirstOutputChunk,
        isFirstVisibleOutputChunk,
        outputDebug,
      });
      pendingOutputBytes += queuedData.byteLength;

      if (pendingOutputBytes >= TERMINAL_OUTPUT_BATCH_MAX_BYTES) {
        flushTerminalOutputBatch("max_bytes");
        return;
      }

      scheduleTerminalOutputBatchFlush();
    };

    const openResizeWriteBarrier = (event) => {
      if (resizeWriteBarrierActive) {
        return;
      }

      flushTerminalOutputBatch("resize_barrier_start");
      resizeWriteBarrierActive = true;
      resizeWriteBarrierStartedAt = performance.now();
      resizeWriteBarrierReason = event?.reason || "resize";
      resizeWriteBarrierBytes = 0;
      resizeWriteBarrierQueue.length = 0;
      resizeWriteBarrierTimer = window.setTimeout(() => {
        resizeWriteBarrierTimer = 0;
        if (resizeWriteBarrierActive) {
          closeResizeWriteBarrier("resize_barrier_max_ms");
        }
      }, TERMINAL_RESIZE_WRITE_BARRIER_MAX_MS);
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
      if (resizeWriteBarrierTimer) {
        window.clearTimeout(resizeWriteBarrierTimer);
        resizeWriteBarrierTimer = 0;
      }

      if (queuedWrites.length) {
      }

      queuedWrites.forEach((queuedWrite) => {
        writeTerminalOutput(queuedWrite.data, {
          fromResizeBarrier: true,
          isFirstOutputChunk: queuedWrite.isFirstOutputChunk,
          isFirstVisibleOutputChunk: queuedWrite.isFirstVisibleOutputChunk,
          outputDebug: queuedWrite.outputDebug,
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
        patchTerminalMetrics({
          gridMs: event.elapsedMs,
          resizeLagMs: event.elapsedMs,
        });
        addTerminalMetrics({
          resizeBatches: 1,
          resizePanes: 1,
        });
      },
      onError: (event) => {
        const scrollAnchor = pendingResizeScrollAnchor;
        pendingResizeScrollAnchor = null;
        const resizeBarrier = closeResizeWriteBarrier(event.reason || "resize_error");

      },
      onSchedule: (event) => {
      },
      onSkip: (event) => {
      },
      onStart: (event) => {
        pendingResizeScrollAnchor = captureTerminalScrollAnchor(terminal);
        openResizeWriteBarrier(event);
      },
      paneId: () => paneId,
      term: terminal,
    });
    resizeController?.schedule("mount");

    async function startTerminal() {
      try {
        setPaneStage("starting", "Preparing Terminal", "Creating terminal session.");
        const outputDisplayMasker = createCoreRepoNameDisplayMasker({
          coreRepoPath: collapseFunctionalRepoPathToCoreRepoPath(workingDirectory || ""),
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

          const displayData = outputDisplayMasker.maskBytes(data);
          if (!displayData.byteLength) {
            return;
          }

          const isFirstOutputChunk = !sawFirstOutput;
          outputChunks += 1;
          outputBytes += displayData.byteLength;
          const outputDebug = getTerminalOutputDebugFields(displayData);
          const hasVisibleOutput = outputDebug.visibleChars > 0;
          const isFirstVisibleOutputChunk = hasVisibleOutput && !sawFirstVisibleOutput;

          if (hasVisibleOutput) {
            visibleOutputBytes += displayData.byteLength;
            visibleOutputChunks += 1;
          }

          if (isFirstOutputChunk) {
            sawFirstOutput = true;
            scheduleWebglAttach("first_output", TERMINAL_WEBGL_FIRST_OUTPUT_DELAY_MS);
          }

          if (outputChunks <= 10) {
          }

          if (isFirstVisibleOutputChunk) {
            sawFirstVisibleOutput = true;
          }

          writeTerminalOutput(displayData, {
            isFirstOutputChunk,
            isFirstVisibleOutputChunk,
            outputDebug,
          });
        });
        disposables.push(await listen("forge-terminal-exit", (event) => {
          if (
            event.payload?.paneId === paneId
            && event.payload?.instanceId === terminalInstanceId
            && !isDisposed
          ) {
            hasOpenPty = false;
            setPaneStage(
              "exited",
              "Terminal Exited",
              event.payload.exitCode == null
                ? "Process ended."
                : `Process exited with code ${event.payload.exitCode}.`,
            );
          }
        }));
        let terminalInputBuffer = "";
        let terminalInputFlushTimer = 0;
        let terminalInputWriteChain = Promise.resolve();
        const writeTerminalInputChunk = (data, reason) => {
          const isEscapeInput = String(data || "").includes("\x1b");
          const escapeDebugFields = isEscapeInput
            ? {
              reason,
              terminalIndex,
              ...getTerminalInputDebugFields(data),
            }
            : null;

          terminalInputWriteChain = terminalInputWriteChain
            .catch(() => {})
            .then(() => {
              if (escapeDebugFields) {
              }

              return invoke("terminal_write", {
                paneId,
                instanceId: terminalInstanceId,
                data,
              }).then((result) => {
                if (escapeDebugFields) {
                }

                return result;
              });
            })
            .catch((error) => {
              if (escapeDebugFields) {
              }

              if (isTerminalSessionMissingError(error)) {
                return;
              }

              if (!isDisposed) {
                setTerminalError(getErrorMessage(error, "Unable to write to terminal."));
              }
            });
          if (data.length > 1) {
          }
        };
        const flushTerminalInput = (reason) => {
          if (terminalInputFlushTimer) {
            window.clearTimeout(terminalInputFlushTimer);
            terminalInputFlushTimer = 0;
          }
          if (!terminalInputBuffer || !hasOpenPty || isDisposed) {
            terminalInputBuffer = "";
            return terminalInputWriteChain;
          }
          const queuedData = terminalInputBuffer;
          terminalInputBuffer = "";
          writeTerminalInputChunk(queuedData, reason);
          return terminalInputWriteChain;
        };
        const scheduleTerminalInputFlush = (delayMs = TERMINAL_INPUT_BATCH_MS) => {
          if (terminalInputFlushTimer) {
            return;
          }
          terminalInputFlushTimer = window.setTimeout(() => {
            terminalInputFlushTimer = 0;
            flushTerminalInput("timer");
          }, delayMs);
        };
        disposables.push(() => {
          if (terminalInputFlushTimer) {
            window.clearTimeout(terminalInputFlushTimer);
            terminalInputFlushTimer = 0;
          }
          terminalInputBuffer = "";
        });
        const handleTerminalShiftEnterKey = (event, source = "xterm_custom_key_handler") => {
          if (
            !isPlainShiftEnterEvent(event)
            || isGenericTerminal
            || isDisposed
            || !hasOpenPty
            || parkedPromptRef.current
          ) {
            return false;
          }

          event.preventDefault();
          event.stopPropagation?.();
          event.stopImmediatePropagation?.();

          flushTerminalInput("shift_enter_flush_before");
          writeTerminalInputChunk(TERMINAL_SHIFT_ENTER_SEQUENCE, "shift_enter");
          return true;
        };
        disposables.push(terminal.onData((data) => {
          if (isDisposed || parkedPromptRef.current) {
            return;
          }

          const safeData = isGenericTerminal ? data : data.replace(/\x03/g, "");

          if (!safeData) {
            return;
          }

          const startupControlReply = !hasOpenPty
            && startupControlReplyBridgeOpen
            && isTerminalGeneratedReplyInput(safeData);

          if (!hasOpenPty && !startupControlReply) {
            return;
          }

          if (safeData.startsWith("\x1b")) {
            flushTerminalInput("escape_sequence_flush_before");
            writeTerminalInputChunk(
              safeData,
              startupControlReply
                ? "startup_terminal_control_reply"
                : safeData === "\x1b"
                  ? "escape"
                  : "escape_sequence",
            );
            return;
          }

          terminalInputBuffer += safeData;
          const isDeleteInput = safeData === "\x7f"
            || safeData === "\b"
            || safeData === "\x1b[3~";
          if (
            safeData.includes("\r")
            || safeData.includes("\n")
            || terminalInputBuffer.length >= TERMINAL_INPUT_BATCH_MAX_CHARS
          ) {
            flushTerminalInput(
              safeData.includes("\r") || safeData.includes("\n")
                ? "submit"
                : "buffer_limit",
            );
          } else {
            scheduleTerminalInputFlush(
              isDeleteInput ? TERMINAL_DELETE_INPUT_BATCH_MS : TERMINAL_INPUT_BATCH_MS,
            );
          }
        }));
        const handleTerminalSelectionDelete = (event) => {
          if (
            isGenericTerminal
            || isDisposed
            || !hasOpenPty
            || parkedPromptRef.current
            || event.defaultPrevented
            || !["Backspace", "Delete"].includes(event.key)
            || event.metaKey
            || event.ctrlKey
            || event.altKey
            || event.shiftKey
            || !terminal.hasSelection?.()
          ) {
            return;
          }

          const selection = terminal.getSelection?.() || "";
          if (!selection.replace(/[\r\n]/g, "")) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          Promise.resolve(flushTerminalInput("selection_delete_flush_before"))
            .then(() => invoke("terminal_delete_selection", {
              paneId,
              instanceId: terminalInstanceId,
              selection,
            }))
            .then((result) => {
              if (result?.deleted) {
                terminal.clearSelection?.();
              }
            })
            .catch((error) => {
              if (!isDisposed) {
                setTerminalError(getErrorMessage(error, "Unable to delete terminal selection."));
              }
            });
        };
        container.addEventListener("keydown", handleTerminalSelectionDelete, true);
        disposables.push(() => {
          container.removeEventListener("keydown", handleTerminalSelectionDelete, true);
        });
        const handleTerminalEscapeKey = (event, source = "container_capture_keydown") => {
          const isPlainEscape = event.key === "Escape"
            && !event.metaKey
            && !event.ctrlKey
            && !event.altKey
            && !event.shiftKey;
          if (event.key === "Escape") {
          }

          if (
            !isPlainEscape
            || isDisposed
            || !hasOpenPty
          ) {
            return false;
          }

          event.preventDefault();
          event.stopPropagation?.();
          event.stopImmediatePropagation?.();

          if (parkedPromptRef.current && !isGenericTerminal) {
            invoke("terminal_interrupt_agent", {
              paneId,
              instanceId: terminalInstanceId,
              reason: "escape_key",
            }).catch((error) => {
              if (!isDisposed) {
                setTerminalError(getErrorMessage(error, "Unable to interrupt terminal agent."));
              }
            });
            return true;
          }

          flushTerminalInput("escape_keydown_flush_before");
          writeTerminalInputChunk("\x1b", "escape_keydown");
          return true;
        };
        const handleTerminalEscapeInterrupt = (event) => {
          handleTerminalEscapeKey(event, "container_capture_keydown");
        };
        container.addEventListener("keydown", handleTerminalEscapeInterrupt, true);
        disposables.push(() => {
          container.removeEventListener("keydown", handleTerminalEscapeInterrupt, true);
        });
        const handleWindowTerminalEscape = (event) => {
          if (
            event.key !== "Escape"
            || !terminalKeyboardTargetMatches(paneId, terminalInstanceId)
          ) {
            return;
          }

          handleTerminalEscapeKey(event, "window_capture_keydown");
        };
        window.addEventListener("keydown", handleWindowTerminalEscape, true);
        disposables.push(() => {
          window.removeEventListener("keydown", handleWindowTerminalEscape, true);
        });
        const handleDocumentTerminalEscape = (event) => {
          if (event.key !== "Escape") {
            return;
          }
          const eventTarget = event.target;
          const targetInsideContainer = eventTarget instanceof Node
            && container.contains(eventTarget);
          const activeInsideContainer = document.activeElement instanceof Node
            && container.contains(document.activeElement);
          const selectedKeyboardTarget = terminalKeyboardTargetMatches(paneId, terminalInstanceId);
          if (!targetInsideContainer && !activeInsideContainer && !selectedKeyboardTarget) {
            return;
          }
          handleTerminalEscapeKey(event, "document_capture_keydown");
        };
        document.addEventListener("keydown", handleDocumentTerminalEscape, true);
        disposables.push(() => {
          document.removeEventListener("keydown", handleDocumentTerminalEscape, true);
        });
        if (typeof terminal.attachCustomKeyEventHandler === "function") {
          terminal.attachCustomKeyEventHandler((event) => {
            if (handleTerminalShiftEnterKey(event, "xterm_custom_key_handler")) {
              return false;
            }
            if (event.key === "Escape" && handleTerminalEscapeKey(event, "xterm_custom_key_handler")) {
              return false;
            }
            return true;
          });
          disposables.push(() => {
            try {
              terminal.attachCustomKeyEventHandler(() => true);
            } catch (_) {
              // Terminal may already be disposed during teardown.
            }
          });
        }

        setPaneStage("starting", "Measuring Terminal", "Waiting for renderer dimensions.");
        const initialSize = await waitForTerminalSizeForOpen("terminal_open");

        if (isDisposed || !initialSize) {
          return;
        }

        if (terminal.cols !== initialSize.cols || terminal.rows !== initialSize.rows) {
          terminal.resize(initialSize.cols, initialSize.rows);
        }

        const shouldPrewarmShell = !isGenericTerminal && prewarmShell && !agentLaunchReadyRef.current;
        const openKind = isGenericTerminal || shouldPrewarmShell ? "prewarm-pty" : agent.id;
        const openProvider = isGenericTerminal || shouldPrewarmShell ? null : agent.id;
        let agentStartedInCurrentPty = isGenericTerminal || !shouldPrewarmShell;

        startAgentInCurrentPty = async (reason = "agent_launch_ready", launchEpoch = agentLaunchEpochRef.current) => {
          if (isDisposed || !hasOpenPty || agentStartedInCurrentPty) {
            return;
          }

          agentStartedInCurrentPty = true;
          startupWatchTimers.forEach((timer) => window.clearTimeout(timer));
          startupWatchTimers.clear();
          setPaneStage("starting", "Starting Agent", "Attaching the prepared terminal.");
          setTerminalError("");

          const agentLaunchStartedAt = performance.now();

          setPaneStage("running", "Agent Running", "Terminal is connected.");
          resizeController?.resizeNow("agent_launch_done");
          scheduleBlankStartupWatch("agent_launch_done");
        };
        startAgentInPrewarmedTerminalRef.current = shouldPrewarmShell ? startAgentInCurrentPty : null;


        const openStartedAt = performance.now();
        const clearBackendPrepDetailTimer = () => {
          if (backendPrepDetailTimer) {
            window.clearTimeout(backendPrepDetailTimer);
            backendPrepDetailTimer = 0;
          }
        };
        if (isGenericTerminal) {
          setPaneStage(
            "starting",
            "Preparing Shell",
            "Opening terminal.",
            {
              kind: openKind,
              prewarmShell: shouldPrewarmShell,
            },
          );
        } else {
          setPaneStage(
            "starting",
            "Opening Agent Terminal",
            "Opening terminal backend.",
            {
              kind: openKind,
              prewarmShell: shouldPrewarmShell,
            },
          );
        }
        if (isDisposed) {
          return;
        }

        const invokeTerminalOpen = async () => {
          if (isDisposed) {
            throw new Error("Terminal launch was cancelled.");
          }

          setPaneStage(
            "starting",
            isGenericTerminal ? "Preparing Shell" : "Preparing Agent",
            isGenericTerminal
              ? "Opening terminal."
              : "Opening terminal backend.",
            {
              kind: openKind,
              prewarmShell: shouldPrewarmShell,
            },
          );

          startupControlReplyBridgeOpen = true;
          return invoke("terminal_open", {
            request: {
              paneId,
              instanceId: terminalInstanceId,
              kind: openKind,
              provider: openProvider,
              model: "",
              plainShell: isGenericTerminal,
              preserveCoordinationSession: preserveCoordinationForThisStart,
              slotKey: String(Math.max(0, Number.parseInt(terminalIndex, 10) || 0) + 1),
              terminalIndex,
              workingDirectory: workingDirectory || "",
              workspaceId: workspace?.id || "",
              workspaceName: workspace?.name || "",
              cols: initialSize.cols,
              rows: initialSize.rows,
            },
            outputChannel,
          });
        };
        if (!isGenericTerminal && !shouldPrewarmShell) {
          backendPrepDetailTimer = window.setTimeout(() => {
            backendPrepDetailTimer = 0;
            if (isDisposed || hasOpenPty || runtimeTerminalState !== "starting") {
              return;
            }
            setTerminalStatus({
              detail: "Initial Git/worktree setup is still running.",
              mode: "detail",
              title: "Preparing Isolated Worktree",
              visible: true,
            });
          }, TERMINAL_BACKEND_PREP_DETAIL_MS);
        }
        const openResult = await invokeTerminalOpen();
        clearBackendPrepDetailTimer();

        if (isDisposed) {
          startupControlReplyBridgeOpen = false;
          invoke("terminal_close", { paneId, instanceId: terminalInstanceId }).catch(() => {});
          return;
        }

        outputDisplayMasker.setPaths({
          coreRepoPath: collapseFunctionalRepoPathToCoreRepoPath(
            openResult?.projectRoot || openResult?.workingDirectory || workingDirectory || "",
          ),
          functionalRepoPath: openResult?.agentBranchRoot || openResult?.workingDirectory || "",
        });
        hasOpenPty = true;
        startupControlReplyBridgeOpen = false;
        setTerminalLaunchInfo(openResult || null);
        if (shouldPrewarmShell) {
          runtimeTerminalState = "prewarmed";
          setTerminalState("prewarmed");
          setTerminalStatus({
            detail: "Waiting for the agent launch gate.",
            title: "Terminal Prepared",
            visible: false,
          });
        } else {
          setPaneStage("running", "Terminal Running", "Terminal is connected.");
          setTerminalStatus({
            detail: "Terminal is connected.",
            title: "Terminal Running",
            visible: false,
          });
        }
        patchTerminalMetrics({ startupMs: performance.now() - openStartedAt });
        resizeController?.resizeNow("terminal_open_done");

        scheduleWebglAttach("idle", TERMINAL_WEBGL_IDLE_DELAY_MS);

        if (terminalIndex === 0) {
          terminal.focus();
        }

        if (shouldPrewarmShell) {
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
        startupControlReplyBridgeOpen = false;
        if (backendPrepDetailTimer) {
          window.clearTimeout(backendPrepDetailTimer);
          backendPrepDetailTimer = 0;
        }
        if (!isDisposed) {
          const errorMessage = getErrorMessage(error, `Unable to launch ${agent.label}.`);
          setPaneStage("error", "Terminal Launch Failed", errorMessage);
          setTerminalError(errorMessage);
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
      if (backendPrepDetailTimer) {
        window.clearTimeout(backendPrepDetailTimer);
      }
      startupMetricTimers.forEach((timer) => window.clearTimeout(timer));
      startupMetricTimers.clear();
      startupWatchTimers.forEach((timer) => window.clearTimeout(timer));
      startupWatchTimers.clear();
      cancelTerminalOutputBatchTimers();
      pendingOutputWrites.length = 0;
      pendingOutputBytes = 0;
      outputBatchQueuedAt = 0;
      resizeWriteBarrierActive = false;
      if (resizeWriteBarrierTimer) {
        window.clearTimeout(resizeWriteBarrierTimer);
        resizeWriteBarrierTimer = 0;
      }
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
      if (xtermRef.current === terminal) {
        xtermRef.current = null;
      }
      onPreparedTerminalChange?.({
        agentId: agent?.id || "",
        instanceId: terminalInstanceId,
        paneId,
        ready: false,
        terminalIndex,
        workspaceId: workspace?.id || "",
      });
      clearActiveTerminalKeyboardTargetIfCurrent(paneId, terminalInstanceId);
      const preserveCoordinationSession = preserveCoordinationOnNextCleanupRef.current && !isGenericTerminal;
      preserveCoordinationOnNextCleanupRef.current = false;
      invoke("terminal_close", {
        paneId,
        instanceId: terminalInstanceId,
        preserveCoordinationSession,
      }).catch(() => {});
      terminal.dispose();
    };
  }, [agent?.id, agent?.label, isGenericTerminal, onPreparedTerminalChange, paneId, requestTerminalAudioInputTarget, restartKey, terminalClosed, terminalRoleId, useWebglRenderer, workingDirectory, workspace?.id]);

  const [terminalDropActive, setTerminalDropActive] = useState(false);

  const handleTerminalTodoDragEnter = useCallback((event) => {
    if (terminalClosed || terminalClosing) {
      return;
    }

    if (!isTodoDragTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setTerminalDropActive(true);
    event.dataTransfer.dropEffect = "copy";
  }, [terminalClosed, terminalClosing]);

  const handleTerminalTodoDragOver = useCallback((event) => {
    if (terminalClosed || terminalClosing) {
      return;
    }

    if (!isTodoDragTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setTerminalDropActive(true);
    event.dataTransfer.dropEffect = "copy";
  }, [terminalClosed, terminalClosing]);

  const handleTerminalTodoDragLeave = useCallback((event) => {
    if (!isTodoDragTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setTerminalDropActive(false);
  }, []);

  const handleTerminalTodoDrop = useCallback(async (event) => {
    event.preventDefault();
    event.stopPropagation();
    setTerminalDropActive(false);

    if (terminalClosed || terminalClosing) {
      return;
    }

    const prompt = getDraggedTodoPrompt(event.dataTransfer);
    if (!prompt) {
      return;
    }

    setTerminalError("");

    try {
      await invoke("terminal_write", {
        paneId,
        instanceId: terminalInstanceIdRef.current || undefined,
        data: `${prompt}\r`,
      });
    } catch (error) {
      setTerminalError(getErrorMessage(error, "Unable to send terminal input."));
    }
  }, [paneId, terminalClosed, terminalClosing]);

  const closeTerminal = useCallback(async () => {
    if (terminalClosed || terminalClosingRef.current) {
      return;
    }

    setTerminalError("");
    terminalClosingRef.current = true;
    setTerminalClosing(true);
    setTerminalState("closing");
    setTerminalStatus({
      detail: "Shutting down the PTY.",
      title: "Closing Terminal",
      visible: false,
    });

    try {
      await invoke("terminal_close", {
        paneId,
        instanceId: terminalInstanceIdRef.current || undefined,
      });
    } catch (error) {
      terminalClosingRef.current = false;
      setTerminalClosing(false);
      const errorMessage = getErrorMessage(error, "Unable to close terminal.");
      setTerminalState("error");
      setTerminalStatus({
        detail: errorMessage,
        title: "Terminal Close Failed",
        visible: true,
      });
      setTerminalError(errorMessage);
      return;
    }

    terminalClosingRef.current = false;
    setTerminalClosing(false);
    setTerminalClosed(true);
    setTerminalState("closed");
    setTerminalStatus({
      detail: "This pane is closed.",
      title: "Terminal Closed",
      visible: false,
    });
    onCloseTerminal?.({
      paneId,
      terminalIndex,
      workspaceId: workspace?.id || "",
    });
  }, [onCloseTerminal, paneId, terminalClosed, terminalIndex, workspace?.id]);

  const cancelParkedPrompt = useCallback(async () => {
    if (!parkedPrompt?.taskId || terminalClosingRef.current) {
      return;
    }

    setTerminalError("");
    try {
      await invoke("terminal_cancel_parked_task", {
        paneId,
        instanceId: parkedPrompt.instanceId,
        taskId: parkedPrompt.taskId,
      });
      setParkedPrompt(null);
    } catch (error) {
      setTerminalError(getErrorMessage(error, "Unable to cancel parked task."));
    }
  }, [paneId, parkedPrompt]);

  const restartTerminalAs = useCallback((roleId = terminalAgentKind) => {
    if (terminalClosing) {
      return;
    }

    const nextRoleId = String(roleId || terminalAgentKind).toLowerCase();
    setRestartRoleMenuOpen(false);

    if (nextRoleId && nextRoleId !== terminalAgentKind) {
      onChangeTerminalRole?.({
        role: nextRoleId,
        terminalIndex,
        workspaceId: workspace?.id || "",
      });
      return;
    }

    setTerminalClosed(false);
    terminalClosingRef.current = false;
    preserveCoordinationOnNextCleanupRef.current = !isGenericTerminal;
    preserveCoordinationOnNextOpenRef.current = !isGenericTerminal;
    setTerminalClosing(false);
    setTerminalState("starting");
    setTerminalError("");
    setTerminalStatus({
      detail: "Restarting terminal session.",
      title: "Preparing Terminal",
      visible: true,
    });
    setRestartKey((key) => key + 1);
  }, [isGenericTerminal, onChangeTerminalRole, terminalAgentKind, terminalClosing, terminalIndex, workspace?.id]);

  const showTerminalStatusOverlay = Boolean(
    terminalStatus?.visible
    && !terminalClosed
    && !terminalClosing
    && !parkedPrompt,
  );
  const terminalStatusTitle = terminalState === "error" && terminalError
    ? "Terminal Launch Failed"
    : terminalStatus?.title || "Preparing Terminal";
  const terminalStatusDetail = terminalState === "error" && terminalError
    ? terminalError
    : terminalStatus?.detail || "";
  const terminalStatusMode = terminalState === "error"
    ? "detail"
    : terminalStatus?.mode || (terminalState === "starting" ? "compact" : "detail");

  if (!agent) {
    return (
      <TerminalWorkspaceSurface>
        <TerminalEmptyPanel>
          <TerminalEmptyCopy>
            <PanelKicker>Terminal readiness</PanelKicker>
            <PanelHeading>Install and connect Codex, Claude Code, or OpenCode</PanelHeading>
            <PageSubline>
              The workspace opens a live local PTY only after a provider CLI is installed and authenticated.
            </PageSubline>
          </TerminalEmptyCopy>
          <TerminalAgentList>
            {getAgentStatusSummary(agentStatuses).map((status) => (
              <TerminalAgentRow data-tone={getAgentTone(status)} key={status.id}>
                <AgentIcon data-tone={getAgentTone(status)}>
                  {status.id === "codex" || status.id === "opencode" ? (
                    <ButtonCodeIcon aria-hidden="true" />
                  ) : (
                    <ButtonBotIcon aria-hidden="true" />
                  )}
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
    <TerminalWorkspaceSurface
      data-focused={terminalFocused ? "true" : "false"}
      data-pane-id={paneId}
      data-terminal-index={terminalIndex}
      onFocusCapture={() => requestTerminalAudioInputTarget(true)}
      onPointerDownCapture={() => requestTerminalAudioInputTarget(true)}
    >
      <TerminalRestartPill>
        <TerminalAgentIdBadge
          aria-label={terminalAgentTitle}
          data-agent={terminalAgentKind}
          data-slot={getTerminalAgentColorSlot(terminalIndex)}
          title={terminalAgentTitle}
        >
          {terminalAgentId}
        </TerminalAgentIdBadge>
        <TerminalProjectBadge
          aria-label={projectBadgeLabel}
          title={projectBadgeTitle}
        >
          <strong>{projectLabel}</strong>
          <span>{isolationLabel}</span>
        </TerminalProjectBadge>
        <TerminalRestartMenu
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setRestartRoleMenuOpen(false);
            }
          }}
        >
          <TerminalRestartButton
            aria-expanded={restartRoleMenuOpen ? "true" : "false"}
            aria-haspopup="menu"
            aria-label="Restart terminal"
            disabled={terminalClosing}
            onClick={() => setRestartRoleMenuOpen((isOpen) => !isOpen)}
            title="Restart terminal or choose runtime"
            type="button"
          >
            <ButtonRefreshIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartDropdown data-open={restartRoleMenuOpen ? "true" : "false"} role="menu">
            {getTerminalRoleSwitchOptions(agentStatuses).map((option) => (
              <TerminalRestartOption
                data-role={option.id}
                data-selected={option.id === terminalAgentKind ? "true" : "false"}
                key={option.id}
                onClick={() => restartTerminalAs(option.id)}
                role="menuitem"
                title={`Restart as ${option.label}`}
                type="button"
              >
                <strong>{option.id === terminalAgentKind ? `Restart ${option.label}` : option.label}</strong>
                <span>{option.shortLabel}</span>
              </TerminalRestartOption>
            ))}
          </TerminalRestartDropdown>
        </TerminalRestartMenu>
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

      <TerminalFrame
        aria-busy={terminalClosing ? "true" : "false"}
        data-state={terminalState}
        data-drop-active={!isGenericTerminal && terminalDropActive ? "true" : "false"}
        onDragEnter={isGenericTerminal ? undefined : handleTerminalTodoDragEnter}
        onDragLeave={isGenericTerminal ? undefined : handleTerminalTodoDragLeave}
        onDragOver={isGenericTerminal ? undefined : handleTerminalTodoDragOver}
        onDrop={isGenericTerminal ? undefined : handleTerminalTodoDrop}
      >
        {terminalClosed ? (
          <TerminalClosedSurface aria-live="polite" role="status">
            <TerminalClosedLabel>Terminal Closed</TerminalClosedLabel>
          </TerminalClosedSurface>
        ) : (
          <>
            <XtermSurface
              data-scrollbar-platform={TERMINAL_SCROLLBAR_PLATFORM}
              data-parked={parkedPrompt ? "true" : "false"}
              onDragEnter={isGenericTerminal ? undefined : handleTerminalTodoDragEnter}
              onDragLeave={isGenericTerminal ? undefined : handleTerminalTodoDragLeave}
              onDragOver={isGenericTerminal ? undefined : handleTerminalTodoDragOver}
              onDrop={isGenericTerminal ? undefined : handleTerminalTodoDrop}
              ref={containerRef}
            />
            {showTerminalStatusOverlay && (
              <TerminalStatusOverlay
                aria-live={terminalState === "error" ? "assertive" : "polite"}
                data-mode={terminalStatusMode}
                data-tone={terminalState === "error" ? "error" : "neutral"}
                role="status"
              >
                <div>
                  {terminalState !== "error" && <TerminalStatusSpinner aria-hidden="true" />}
                  {terminalStatusMode !== "compact" && (
                    <TerminalStatusCopy>
                      <strong>{terminalStatusTitle}</strong>
                      {terminalStatusDetail && <span>{terminalStatusDetail}</span>}
                    </TerminalStatusCopy>
                  )}
                </div>
              </TerminalStatusOverlay>
            )}
            {terminalClosing && (
              <TerminalClosingOverlay aria-live="polite" role="status">
                <div>
                  <span aria-hidden="true" data-spinner="true" />
                  <strong>Closing terminal</strong>
                  <span>Shutting it down...</span>
                </div>
              </TerminalClosingOverlay>
            )}
            {parkedPrompt && (
              <TerminalParkedBar aria-live="polite" role="status">
                <TerminalParkedSpinner aria-hidden="true" />
                <TerminalParkedCopy>
                  <strong>Parked: {parkedPrompt.title || "Waiting for dependency"}</strong>
                  <span>
                    Waiting on{" "}
                    <TerminalParkedAgents>
                      {(parkedPrompt.waitingOn || []).length
                        ? parkedPrompt.waitingOn.map((agent, index) => (
                          <TerminalParkedAgentBadge key={`${agent.agentId || agent.agentLabel || "agent"}-${index}`}>
                            {agent.agentLabel || getShortRealAgentId(agent.agentId) || "agent"}
                          </TerminalParkedAgentBadge>
                        ))
                        : <TerminalParkedAgentBadge>peer</TerminalParkedAgentBadge>}
                    </TerminalParkedAgents>
                  </span>
                </TerminalParkedCopy>
                <TerminalParkedCancelButton onClick={cancelParkedPrompt} type="button">
                  Cancel task
                </TerminalParkedCancelButton>
              </TerminalParkedBar>
            )}
            {terminalDropActive && (
              <div style={TODO_DROP_OVERLAY_STYLE}>
                <div style={TODO_DROP_OVERLAY_LABEL_STYLE}>Drop grouped prompt here</div>
              </div>
            )}
          </>
        )}
      </TerminalFrame>
    </TerminalWorkspaceSurface>
  );
}

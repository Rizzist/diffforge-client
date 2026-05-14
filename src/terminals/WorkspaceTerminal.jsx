import { Channel, invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import {
  collapseFunctionalRepoPathToCoreRepoPath,
  createCoreRepoNameDisplayMasker,
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
  TerminalAgentDot,
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
  ButtonDragIcon,
  ButtonSplitHorizontalIcon,
  ButtonSplitVerticalIcon,
  ButtonFullscreenIcon,
  ButtonFullscreenExitIcon,
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
  getTerminalActualCellSize,
  measureTerminalGrid,
} from "./terminalResizeController";
import {
  getTerminalDiagnosticEnvironment,
  isTerminalDiagnosticLoggingEnabled,
  logTerminalDiagnosticDuration,
  logTerminalDiagnosticEvent,
  startTerminalDiagnosticHeartbeat,
  syncTerminalDiagnosticLogging,
} from "./terminalDiagnostics";
import {
  isWindowsTerminalDiagnosticLoggingEnabled,
  logWindowsTerminalDiagnosticEvent,
  syncWindowsTerminalDiagnosticLogging,
} from "./windowsTerminalDiagnostics";
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
const TERMINAL_START_LAYOUT_WAIT_MS = 4000;
const TERMINAL_START_METRIC_WAIT_MS = 900;
const TERMINAL_START_METRIC_POLL_MS = 16;
const TERMINAL_START_GEOMETRY_WAIT_MS = 1400;
const TERMINAL_START_GEOMETRY_POLL_MS = 16;
const TERMINAL_GEOMETRY_TOLERANCE_PX = 3;
const TERMINAL_DEFAULT_SCROLLBACK_ROWS = 10000;
const TERMINAL_WEBGL_IDLE_DELAY_MS = 420;
const TERMINAL_WEBGL_FIRST_OUTPUT_DELAY_MS = 80;
const TERMINAL_WEBGL_STAGGER_MS = 90;
const TERMINAL_WEBGL_MAX_DELAY_MS = 1200;
const TERMINAL_BLANK_STARTUP_PROBE_MS = 800;
const TERMINAL_BLANK_STARTUP_CONFIRM_MS = 800;
const TERMINAL_BACKEND_PREP_DETAIL_MS = 2500;
const TERMINAL_SCROLLBAR_HIDE_DELAY_MS = 700;
const TERMINAL_SCROLLBAR_INTENT_MS = 900;
const TERMINAL_SCROLL_DIAGNOSTIC_THROTTLE_MS = 180;
const WINDOWS_TERMINAL_REPAINT_TRANSIENT_SCROLLBACK_MS = 1600;
const WINDOWS_TERMINAL_RESIZE_LIVE_CLEAR_DELAY_MS = 80;
const WINDOWS_TERMINAL_RESIZE_SCROLLBACK_PURGE_DELAY_MS = 90;
const WINDOWS_TERMINAL_RESIZE_TRANSIENT_SCROLLBAR_HIDE_MS = 360;
const WINDOWS_TERMINAL_RESIZE_TRANSIENT_SCROLLBACK_MS = 2500;
const WINDOWS_TERMINAL_RESIZE_LIVE_CLEAR_AGENT_KINDS = new Set(["claude"]);
const TERMINAL_AGENT_COLOR_SLOT_COUNT = 16;
const TERMINAL_AUDIO_INPUT_REFOCUS_EVENT = "forge-terminal-audio-input-refocus";
const TERMINAL_INPUT_EVENT = "forge-terminal-input";
const TERMINAL_INPUT_ERROR_EVENT = "forge-terminal-input-error";
const TERMINAL_PARKED_PROMPT_EVENT = "forge-terminal-parked-prompt";
const TERMINAL_OUTPUT_DIAGNOSTIC_WINDOW_MS = 1000;
const TERMINAL_OUTPUT_BATCH_MAX_MS = 33;
const TERMINAL_OUTPUT_BATCH_MAX_BYTES = 32 * 1024;
const TERMINAL_GLOBAL_RENDER_BACKGROUND_MIN_MS = TERMINAL_OUTPUT_BATCH_MAX_MS;
const TERMINAL_GLOBAL_RENDER_BACKGROUND_MAX_MS = 75;
const TERMINAL_GLOBAL_RENDER_MAX_PANES_PER_FRAME = 2;
const TERMINAL_GLOBAL_RENDER_BACKGROUND_PANES_PER_FRAME = 1;
const TERMINAL_GLOBAL_RENDER_FRAME_BUDGET_MS = 8;
const TERMINAL_OUTPUT_CHUNK_DIAGNOSTIC_SLOW_MS = 8;
const TERMINAL_OUTPUT_WRITE_DIAGNOSTIC_SLOW_MS = 16;
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

const terminalRenderNow = () => (
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now()
);

const terminalGlobalRenderScheduler = (() => {
  const entries = new Map();
  let rafId = 0;
  let timerId = 0;
  let frameId = 0;

  const hasWindow = () => typeof window !== "undefined";

  const clearTimer = () => {
    if (timerId && hasWindow()) {
      window.clearTimeout(timerId);
    }
    timerId = 0;
  };

  const entryAge = (entry, now = terminalRenderNow()) => {
    const queuedAt = Number(entry.getQueuedAt?.() || 0);
    return queuedAt > 0 ? Math.max(0, now - queuedAt) : 0;
  };

  const entryBytes = (entry) => Math.max(0, Number(entry.getPendingBytes?.() || 0));

  const isEntryActive = (entry) => Boolean(entry.isActive?.());

  const isEntryDue = (entry, now = terminalRenderNow()) => {
    if (!entry.hasPending?.()) {
      return false;
    }

    const age = entryAge(entry, now);
    if (entryBytes(entry) >= TERMINAL_OUTPUT_BATCH_MAX_BYTES) {
      return true;
    }

    if (isEntryActive(entry)) {
      return age >= 0;
    }

    return age >= TERMINAL_GLOBAL_RENDER_BACKGROUND_MIN_MS;
  };

  const nextDelayMs = (now = terminalRenderNow()) => {
    let delay = null;

    entries.forEach((entry) => {
      if (!entry.hasPending?.()) {
        return;
      }

      if (isEntryActive(entry) || entryBytes(entry) >= TERMINAL_OUTPUT_BATCH_MAX_BYTES) {
        delay = 0;
        return;
      }

      const age = entryAge(entry, now);
      const remaining = Math.max(0, TERMINAL_GLOBAL_RENDER_BACKGROUND_MIN_MS - age);
      delay = delay == null ? remaining : Math.min(delay, remaining);
    });

    return delay;
  };

  const scheduleFrame = () => {
    if (!hasWindow() || rafId) {
      return;
    }

    rafId = window.requestAnimationFrame(() => {
      rafId = 0;
      flushFrame();
    });
  };

  const scheduleTimer = () => {
    if (!hasWindow() || rafId) {
      return;
    }

    const delay = nextDelayMs();
    if (delay == null) {
      clearTimer();
      return;
    }

    if (delay <= 0) {
      clearTimer();
      scheduleFrame();
      return;
    }

    clearTimer();
    timerId = window.setTimeout(() => {
      timerId = 0;
      scheduleFrame();
    }, Math.min(delay, TERMINAL_GLOBAL_RENDER_BACKGROUND_MAX_MS));
  };

  const scheduleNext = () => {
    const delay = nextDelayMs();
    if (delay == null) {
      clearTimer();
      return;
    }

    if (delay <= 0) {
      clearTimer();
      scheduleFrame();
      return;
    }

    scheduleTimer();
  };

  const compareEntries = (now) => (left, right) => {
    const leftActive = isEntryActive(left);
    const rightActive = isEntryActive(right);
    if (leftActive !== rightActive) {
      return leftActive ? -1 : 1;
    }

    const leftAge = entryAge(left, now);
    const rightAge = entryAge(right, now);
    const leftOverdue = leftAge >= TERMINAL_GLOBAL_RENDER_BACKGROUND_MAX_MS;
    const rightOverdue = rightAge >= TERMINAL_GLOBAL_RENDER_BACKGROUND_MAX_MS;
    if (leftOverdue !== rightOverdue) {
      return leftOverdue ? -1 : 1;
    }

    const leftBytes = entryBytes(left);
    const rightBytes = entryBytes(right);
    if (leftBytes !== rightBytes) {
      return rightBytes - leftBytes;
    }

    return rightAge - leftAge;
  };

  const flushReasonForEntry = (entry, now) => {
    const age = entryAge(entry, now);
    if (entryBytes(entry) >= TERMINAL_OUTPUT_BATCH_MAX_BYTES) {
      return "global_max_bytes_frame";
    }
    if (isEntryActive(entry)) {
      return "global_active_frame";
    }
    if (age >= TERMINAL_GLOBAL_RENDER_BACKGROUND_MAX_MS) {
      return "global_background_max_latency_frame";
    }
    return "global_background_frame";
  };

  const flushFrame = () => {
    const frameStartedAt = terminalRenderNow();
    const candidates = Array.from(entries.values())
      .filter((entry) => isEntryDue(entry, frameStartedAt))
      .sort(compareEntries(frameStartedAt));

    let flushed = 0;
    let activeFlushed = 0;
    let backgroundFlushed = 0;
    let deferred = 0;
    let bytes = 0;

    frameId += 1;

    for (const entry of candidates) {
      const active = isEntryActive(entry);
      const age = entryAge(entry, frameStartedAt);
      const starved = age >= TERMINAL_GLOBAL_RENDER_BACKGROUND_MAX_MS;
      const elapsedMs = terminalRenderNow() - frameStartedAt;
      const reachedPaneBudget = flushed >= TERMINAL_GLOBAL_RENDER_MAX_PANES_PER_FRAME;
      const reachedBackgroundBudget = !active
        && backgroundFlushed >= TERMINAL_GLOBAL_RENDER_BACKGROUND_PANES_PER_FRAME
        && !starved;
      const reachedTimeBudget = !active
        && flushed > 0
        && elapsedMs >= TERMINAL_GLOBAL_RENDER_FRAME_BUDGET_MS
        && !starved;

      if (reachedPaneBudget || reachedBackgroundBudget || reachedTimeBudget) {
        deferred += 1;
        continue;
      }

      const entryPendingBytes = entryBytes(entry);
      bytes += entryPendingBytes;
      entry.flush(flushReasonForEntry(entry, frameStartedAt));
      flushed += 1;
      if (active) {
        activeFlushed += 1;
      } else {
        backgroundFlushed += 1;
      }
    }

    const elapsedMs = terminalRenderNow() - frameStartedAt;
    logTerminalDiagnosticEvent(
      "frontend.global_render_frame",
      {
        activeFlushed,
        backgroundFlushed,
        bytes,
        candidates: candidates.length,
        deferred,
        elapsedMs,
        frameId,
        flushed,
        registered: entries.size,
      },
      { minElapsedMs: TERMINAL_GLOBAL_RENDER_FRAME_BUDGET_MS },
    );

    scheduleNext();
  };

  return {
    cancel() {
      scheduleNext();
    },
    register(entry) {
      if (!entry?.id) {
        return;
      }
      entries.set(entry.id, entry);
      scheduleNext();
    },
    request(id) {
      const entry = entries.get(id);
      if (!entry?.hasPending?.()) {
        scheduleNext();
        return;
      }
      if (isEntryActive(entry) || entryBytes(entry) >= TERMINAL_OUTPUT_BATCH_MAX_BYTES) {
        clearTimer();
        scheduleFrame();
      } else {
        scheduleTimer();
      }
    },
    unregister(id) {
      entries.delete(id);
      scheduleNext();
    },
  };
})();

const TODO_DROP_OVERLAY_STYLE = {
  position: "absolute",
  inset: "10px",
  zIndex: 9,
  display: "grid",
  placeItems: "center",
  border: "1px dotted rgba(138, 216, 255, 0.46)",
  borderRadius: "14px",
  background: "rgba(2, 8, 14, 0.18)",
  boxShadow: "inset 0 0 0 1px rgba(138, 216, 255, 0.08)",
  pointerEvents: "none",
};
const TODO_DROP_OVERLAY_TARGET_STYLE = {
  border: "2px dotted rgba(138, 216, 255, 0.94)",
  background: "rgba(2, 8, 14, 0.54)",
  boxShadow: "inset 0 0 0 1px rgba(255, 173, 124, 0.24), 0 0 32px rgba(138, 216, 255, 0.12)",
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
const TERMINAL_WINDOWS_PTY_BACKEND = "conpty";
const TERMINAL_WINDOWS_INTERESTING_DEC_PRIVATE_MODES = new Set([
  1000,
  1002,
  1003,
  1006,
  1007,
  1047,
  1048,
  1049,
  2004,
  2026,
]);
const TERMINAL_ROLE_SWITCH_OPTIONS = [
  { id: "codex", label: "Codex"},
  { id: "claude", label: "Claude Code" },
  { id: "generic", label: "Terminal" },
  { id: "opencode", label: "OpenCode" },
];
const TERMINAL_CONTROL_SELECTOR = "[data-terminal-control='true']";
const TERMINAL_FULLSCREEN_RESIZE_DELAYS_MS = [0, 80, 190, 280];

function buildWindowsPtyOptions(info = null) {
  if (!TERMINAL_IS_WINDOWS_HOST) {
    return undefined;
  }

  const buildNumber = Number(info?.buildNumber ?? info?.build_number ?? 0);
  if (Number.isFinite(buildNumber) && buildNumber > 0) {
    return {
      backend: TERMINAL_WINDOWS_PTY_BACKEND,
      buildNumber,
    };
  }

  return {
    backend: TERMINAL_WINDOWS_PTY_BACKEND,
  };
}

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

function getTerminalOutputVisibleCharCount(data, maxCount = Number.POSITIVE_INFINITY) {
  if (!data?.length) {
    return 0;
  }

  let visibleChars = 0;
  let escapeMode = "";

  for (let index = 0; index < data.length; index += 1) {
    const byte = data[index];

    if (escapeMode === "csi") {
      if (byte >= 0x40 && byte <= 0x7e) {
        escapeMode = "";
      }
      continue;
    }

    if (escapeMode === "osc") {
      if (byte === 0x07) {
        escapeMode = "";
        continue;
      }
      if (byte === 0x1b && data[index + 1] === 0x5c) {
        index += 1;
        escapeMode = "";
      }
      continue;
    }

    if (byte === 0x1b) {
      const nextByte = data[index + 1];
      if (nextByte === 0x5b) {
        escapeMode = "csi";
        index += 1;
      } else if (nextByte === 0x5d) {
        escapeMode = "osc";
        index += 1;
      } else if (nextByte != null) {
        index += 1;
      }
      continue;
    }

    if (byte > 0x20 && byte !== 0x7f) {
      visibleChars += 1;
      if (visibleChars >= maxCount) {
        return visibleChars;
      }
    }
  }

  return visibleChars;
}

function getTerminalOutputByteStats(data) {
  if (!data?.length) {
    return {
      controlBytes: 0,
      escapeBytes: 0,
      visibleChars: 0,
    };
  }

  let controlBytes = 0;
  let escapeBytes = 0;
  let visibleChars = 0;
  let escapeMode = "";

  for (let index = 0; index < data.length; index += 1) {
    const byte = data[index];

    if (byte < 0x20 || byte === 0x7f) {
      controlBytes += 1;
      if (byte === 0x1b) {
        escapeBytes += 1;
      }
    }

    if (escapeMode === "csi") {
      if (byte >= 0x40 && byte <= 0x7e) {
        escapeMode = "";
      }
      continue;
    }

    if (escapeMode === "osc") {
      if (byte === 0x07) {
        escapeMode = "";
        continue;
      }
      if (byte === 0x1b && data[index + 1] === 0x5c) {
        index += 1;
        escapeMode = "";
      }
      continue;
    }

    if (byte === 0x1b) {
      const nextByte = data[index + 1];
      if (nextByte === 0x5b) {
        escapeMode = "csi";
        index += 1;
      } else if (nextByte === 0x5d) {
        escapeMode = "osc";
        index += 1;
      } else if (nextByte != null) {
        index += 1;
      }
      continue;
    }

    if (byte > 0x20 && byte !== 0x7f) {
      visibleChars += 1;
    }
  }

  return {
    controlBytes,
    escapeBytes,
    visibleChars,
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

function getEventTargetElement(target) {
  if (typeof Element !== "undefined" && target instanceof Element) {
    return target;
  }

  if (typeof Node !== "undefined" && target instanceof Node) {
    return target.parentElement;
  }

  return null;
}

function isTerminalControlEventTarget(target) {
  return Boolean(getEventTargetElement(target)?.closest?.(TERMINAL_CONTROL_SELECTOR));
}

function getPlainDomRect(rect) {
  if (!rect) {
    return null;
  }

  return {
    height: Number(rect.height) || 0,
    left: Number(rect.left) || 0,
    top: Number(rect.top) || 0,
    width: Number(rect.width) || 0,
  };
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
    hasScrollback: Boolean(
      buffer.type !== "alternate"
      && (
        Number(buffer.baseY || 0) > 0
        || Number(buffer.length || 0) > Math.max(1, Number(terminal.rows) || TERMINAL_DEFAULT_ROWS)
      ),
    ),
    length: buffer.length,
    nonEmptyViewportRows,
    type: buffer.type || "",
    viewportY: buffer.viewportY,
    wrappedViewportRows,
  };
}

function getTerminalElementDiagnostics(element) {
  if (!element) {
    return null;
  }

  const bounds = typeof element.getBoundingClientRect === "function"
    ? element.getBoundingClientRect()
    : null;
  const style = typeof window !== "undefined" && typeof window.getComputedStyle === "function"
    ? window.getComputedStyle(element)
    : null;

  return {
    clientHeight: Math.round(Number(element.clientHeight || 0)),
    clientWidth: Math.round(Number(element.clientWidth || 0)),
    display: style?.display || "",
    offsetHeight: Math.round(Number(element.offsetHeight || 0)),
    offsetWidth: Math.round(Number(element.offsetWidth || 0)),
    overflowY: style?.overflowY || "",
    pointerEvents: style?.pointerEvents || "",
    rectHeight: bounds ? Math.round(Number(bounds.height || 0)) : 0,
    rectWidth: bounds ? Math.round(Number(bounds.width || 0)) : 0,
    scrollHeight: Math.round(Number(element.scrollHeight || 0)),
    scrollTop: Math.round(Number(element.scrollTop || 0)),
    visibility: style?.visibility || "",
  };
}

function getTerminalModesDiagnostics(terminal) {
  try {
    const modes = terminal?.modes;

    return {
      applicationCursorKeysMode: Boolean(modes?.applicationCursorKeysMode),
      mouseTrackingMode: modes?.mouseTrackingMode || "unavailable",
      originMode: Boolean(modes?.originMode),
      sendFocusMode: Boolean(modes?.sendFocusMode),
      wraparoundMode: Boolean(modes?.wraparoundMode),
    };
  } catch (_) {
    return {
      applicationCursorKeysMode: false,
      mouseTrackingMode: "unavailable",
      originMode: false,
      sendFocusMode: false,
      wraparoundMode: false,
    };
  }
}

function getTerminalScrollDiagnostics(terminal, container, scrollableElement) {
  const buffer = getTerminalBufferDiagnostics(terminal) || {};
  const viewportElement = container?.querySelector?.(".xterm-viewport") || null;
  const screenElement = container?.querySelector?.(".xterm-screen") || null;
  const options = terminal?.options || {};

  return {
    bufferBaseY: Number(buffer.baseY || 0),
    bufferCursorX: Number(buffer.cursorX || 0),
    bufferCursorY: Number(buffer.cursorY || 0),
    bufferHasScrollback: Boolean(buffer.hasScrollback),
    bufferLength: Number(buffer.length || 0),
    bufferType: buffer.type || "",
    bufferViewportY: Number(buffer.viewportY || 0),
    cols: Number(terminal?.cols || 0),
    container: getTerminalElementDiagnostics(container),
    fastScrollSensitivity: Number(options.fastScrollSensitivity || 0),
    mouse: getTerminalModesDiagnostics(terminal),
    nativeViewport: getTerminalElementDiagnostics(viewportElement),
    rows: Number(terminal?.rows || 0),
    screen: getTerminalElementDiagnostics(screenElement),
    scrollSensitivity: Number(options.scrollSensitivity || 0),
    scrollback: Number(options.scrollback || 0),
    scrollable: getTerminalElementDiagnostics(scrollableElement),
    scrollOnUserInput: options.scrollOnUserInput !== false,
    windowsPtyBackend: options.windowsPty?.backend || "",
    windowsPtyBuildNumber: Number(options.windowsPty?.buildNumber || 0),
  };
}

function getCsiParamNumbers(params) {
  if (!Array.isArray(params)) {
    return [];
  }

  const numbers = [];
  params.forEach((param) => {
    const values = Array.isArray(param) ? param : [param];
    values.forEach((value) => {
      const number = Number(value);
      if (Number.isFinite(number)) {
        numbers.push(number);
      }
    });
  });

  return numbers;
}

function getFirstCsiParam(params, fallback = 0) {
  const numbers = getCsiParamNumbers(params);
  return numbers.length > 0 ? numbers[0] : fallback;
}

function getWindowsTerminalCompactState(terminal, container, scrollableElement) {
  const buffer = getTerminalBufferDiagnostics(terminal) || {};
  const viewportElement = container?.querySelector?.(".xterm-viewport") || null;
  const screenElement = container?.querySelector?.(".xterm-screen") || null;
  const containerState = getTerminalElementDiagnostics(container);
  const viewportState = getTerminalElementDiagnostics(viewportElement);
  const screenState = getTerminalElementDiagnostics(screenElement);
  const scrollableState = getTerminalElementDiagnostics(scrollableElement);
  const cellSize = getTerminalActualCellSize(terminal);
  const cols = Number(terminal?.cols || 0);
  const rows = Number(terminal?.rows || 0);
  const cellWidth = Number(cellSize?.actualCellWidth || 0);
  const cellHeight = Number(cellSize?.actualCellHeight || 0);
  const validCellSize = Boolean(
    cellSize?.valid
    && Number.isFinite(cellWidth)
    && Number.isFinite(cellHeight)
    && cellWidth > 0
    && cellHeight > 0,
  );
  const expectedScreenWidth = validCellSize ? Math.round(cols * cellWidth) : 0;
  const expectedScreenHeight = validCellSize ? Math.round(rows * cellHeight) : 0;

  return {
    baseY: Number(buffer.baseY || 0),
    bufferLength: Number(buffer.length || 0),
    bufferType: buffer.type || "",
    cellHeight,
    cellWidth,
    cols,
    containerHeight: Number(containerState.clientHeight || 0),
    containerWidth: Number(containerState.clientWidth || 0),
    cursorX: Number(buffer.cursorX || 0),
    cursorY: Number(buffer.cursorY || 0),
    expectedScreenHeight,
    expectedScreenWidth,
    hasScrollback: Boolean(buffer.hasScrollback),
    mouseTrackingMode: getTerminalModesDiagnostics(terminal).mouseTrackingMode,
    rows,
    screenHeight: Number(screenState.clientHeight || 0),
    screenHeightDelta: Number(screenState.clientHeight || 0) - expectedScreenHeight,
    screenWidth: Number(screenState.clientWidth || 0),
    screenWidthDelta: Number(screenState.clientWidth || 0) - expectedScreenWidth,
    scrollableHeight: Number(scrollableState.clientHeight || 0),
    scrollableScrollHeight: Number(scrollableState.scrollHeight || 0),
    scrollableScrollTop: Number(scrollableState.scrollTop || 0),
    validCellSize,
    viewportHeight: Number(viewportState.clientHeight || 0),
    viewportScrollHeight: Number(viewportState.scrollHeight || 0),
    viewportScrollTop: Number(viewportState.scrollTop || 0),
    viewportWidth: Number(viewportState.clientWidth || 0),
    viewportY: Number(buffer.viewportY || 0),
  };
}

function isWindowsTerminalGeometrySettled(state, targetSize) {
  if (!state || !targetSize) {
    return false;
  }

  if (Number(state.cols || 0) !== Number(targetSize.cols || 0)) {
    return false;
  }

  if (Number(state.rows || 0) !== Number(targetSize.rows || 0)) {
    return false;
  }

  if (!state.validCellSize) {
    return false;
  }

  if (
    state.containerHeight <= 0
    || state.containerWidth <= 0
    || state.screenHeight <= 0
    || state.screenWidth <= 0
    || state.viewportHeight <= 0
    || state.viewportWidth <= 0
  ) {
    return false;
  }

  const widthTolerance = Math.max(TERMINAL_GEOMETRY_TOLERANCE_PX, Math.ceil(Number(state.cellWidth || 0)));
  const heightTolerance = Math.max(TERMINAL_GEOMETRY_TOLERANCE_PX, Math.ceil(Number(state.cellHeight || 0)));

  return Math.abs(Number(state.screenWidthDelta || 0)) <= widthTolerance
    && Math.abs(Number(state.screenHeightDelta || 0)) <= heightTolerance;
}

function hashWindowsTerminalDiagnosticText(value) {
  const text = String(value || "");
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function getWindowsTerminalFrameFingerprintForRange(terminal, startIndex, rowCount) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      log: {
        available: false,
      },
      rowHashes: [],
    };
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const rows = Math.max(1, Number(rowCount || terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const start = Math.max(0, Math.min(bufferLength, Math.floor(Number(startIndex || 0))));
  const end = Math.max(start, Math.min(bufferLength, start + rows));
  const rowHashes = [];
  let aggregate = "811c9dc5";
  let blankPrefixRows = 0;
  let blankSuffixRows = 0;
  let firstNonEmptyRow = -1;
  let lastNonEmptyRow = -1;
  let nonEmptyRows = 0;
  let wrappedRows = 0;

  for (let index = start; index < end; index += 1) {
    const line = buffer.getLine?.(index);
    const text = line?.translateToString?.(false) || "";
    const normalized = text.trimEnd();
    const rowHash = hashWindowsTerminalDiagnosticText(normalized);
    const isNonEmpty = normalized.trim().length > 0;

    rowHashes.push(rowHash);
    aggregate = hashWindowsTerminalDiagnosticText(`${aggregate}:${rowHash}:${line?.isWrapped ? 1 : 0}`);

    if (line?.isWrapped) {
      wrappedRows += 1;
    }

    if (isNonEmpty) {
      nonEmptyRows += 1;
      if (firstNonEmptyRow < 0) {
        firstNonEmptyRow = index - start;
      }
      lastNonEmptyRow = index - start;
    } else if (nonEmptyRows === 0) {
      blankPrefixRows += 1;
    }
  }

  for (let offset = rowHashes.length - 1; offset >= 0; offset -= 1) {
    const line = buffer.getLine?.(start + offset);
    const normalized = (line?.translateToString?.(false) || "").trimEnd();
    if (normalized.trim().length > 0) {
      break;
    }
    blankSuffixRows += 1;
  }

  return {
    log: {
      aggregateHash: aggregate,
      available: true,
      baseY: Number(buffer.baseY || 0),
      blankPrefixRows,
      blankSuffixRows,
      bufferLength,
      bufferType: buffer.type || "",
      cursorX: Number(buffer.cursorX || 0),
      cursorY: Number(buffer.cursorY || 0),
      end,
      firstNonEmptyRow,
      lastNonEmptyRow,
      nonEmptyRows,
      rowCount: end - start,
      rows: Number(terminal?.rows || 0),
      start,
      viewportY: Number(buffer.viewportY || 0),
      wrappedRows,
    },
    rowHashes,
  };
}

function getWindowsTerminalLiveFrameFingerprint(terminal) {
  const buffer = terminal?.buffer?.active;
  const baseY = Number(buffer?.baseY || 0);
  const rows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  return getWindowsTerminalFrameFingerprintForRange(terminal, baseY, rows);
}

function getWindowsTerminalHistoryTailFingerprint(terminal) {
  const buffer = terminal?.buffer?.active;
  const baseY = Number(buffer?.baseY || 0);
  const rows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  if (!buffer || baseY <= 0) {
    return {
      log: {
        available: false,
        baseY,
        reason: "no_scrollback",
      },
      rowHashes: [],
    };
  }

  return getWindowsTerminalFrameFingerprintForRange(terminal, Math.max(0, baseY - rows), rows);
}

function compareWindowsTerminalFrameFingerprints(current, previous) {
  if (!current?.log?.available || !previous?.log?.available) {
    return {
      comparable: false,
      rowMatchRatio: 0,
      sameAggregateHash: false,
    };
  }

  const currentHashes = Array.isArray(current.rowHashes) ? current.rowHashes : [];
  const previousHashes = Array.isArray(previous.rowHashes) ? previous.rowHashes : [];
  const comparableRows = Math.min(currentHashes.length, previousHashes.length);
  let matchingRows = 0;

  for (let index = 0; index < comparableRows; index += 1) {
    if (currentHashes[index] === previousHashes[index]) {
      matchingRows += 1;
    }
  }

  return {
    comparable: comparableRows > 0,
    currentNonEmptyRows: Number(current.log.nonEmptyRows || 0),
    matchingRows,
    previousNonEmptyRows: Number(previous.log.nonEmptyRows || 0),
    rowCountCompared: comparableRows,
    rowMatchRatio: comparableRows > 0 ? matchingRows / comparableRows : 0,
    sameAggregateHash: current.log.aggregateHash === previous.log.aggregateHash,
  };
}

function WorkspaceTerminal({
  agent,
  agentLaunchEpoch = 0,
  agentLaunchReady = true,
  agentStatuses,
  agentStatusError,
  agentStatusState,
  fullscreenState = "idle",
  isActive = false,
  isFullscreen = false,
  onActivateTerminal,
  onChangeTerminalRole,
  onCloseTerminal,
  onOpenSettings,
  onPreparedTerminalChange,
  onRecheckAgents,
  onBeginTerminalDrag,
  onSplitTerminal,
  onToggleFullscreenTerminal,
  prewarmShell = false,
  terminalIndex = 0,
  terminalCount = 1,
  terminalRole = "",
  todoDropActive = false,
  todoDropTarget = false,
  useWebglRenderer = TERMINAL_ENABLE_WEBGL_RENDERER,
  workingDirectory,
  workspace,
  workspaceError,
}) {
  const containerRef = useRef(null);
  const restartMenuRef = useRef(null);
  const resizeControllerRef = useRef(null);
  const surfaceRef = useRef(null);
  const xtermRef = useRef(null);
  const terminalInstanceIdRef = useRef(0);
  const agentLaunchEpochRef = useRef(agentLaunchEpoch);
  const agentLaunchReadyRef = useRef(agentLaunchReady);
  const terminalActiveRef = useRef(Boolean(isActive));
  const lastAgentLaunchEpochRef = useRef(0);
  const startAgentInPrewarmedTerminalRef = useRef(null);
  const blankStartupProbeCountRef = useRef(0);
  const terminalClosingRef = useRef(false);
  const preserveCoordinationOnNextCleanupRef = useRef(false);
  const preserveCoordinationOnNextOpenRef = useRef(false);
  const parkedPromptRef = useRef(null);
  const cancellingParkedPromptKeysRef = useRef(new Set());
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
  const [terminalFocused, setTerminalFocused] = useState(Boolean(isActive));
  const terminalRoleId = String(terminalRole || agent?.id || "").toLowerCase();
  const isGenericTerminal = terminalRoleId === "generic" || agent?.id === "generic";
  const paneAgentId = isGenericTerminal ? "generic" : agent?.id;
  const paneId = getWorkspaceTerminalPaneId(workspace?.id, terminalIndex, paneAgentId);
  const terminalAgentKind = getTerminalAgentKind(paneAgentId);
  const terminalAgentTitle = isGenericTerminal
    ? "Generic shell terminal"
    : `${agent?.label || "Agent"} terminal`;
  const updateTerminalInteractiveState = useCallback((active, parked = parkedPromptRef.current) => {
    const terminal = xtermRef.current;
    if (!terminal) {
      return;
    }

    const acceptsInteractiveInput = Boolean(active) && !parked;
    terminal.options.disableStdin = Boolean(parked);
    terminal.options.cursorBlink = acceptsInteractiveInput;

    if (!acceptsInteractiveInput) {
      terminal.blur?.();
    }
  }, []);
  const focusTerminalKeyboardInput = useCallback((force = false) => {
    if (!force && !terminalActiveRef.current) {
      return;
    }

    if (parkedPromptRef.current) {
      return;
    }

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
  const activateTerminalPane = useCallback((source = "terminal_activation") => {
    const instanceId = terminalInstanceIdRef.current || 0;
    terminalActiveRef.current = true;
    setActiveTerminalKeyboardTarget(paneId, instanceId);
    setTerminalFocused(true);
    updateTerminalInteractiveState(true);
    onActivateTerminal?.({
      instanceId,
      paneId,
      source,
      terminalIndex,
      workspaceId: workspace?.id || "",
    });
    focusTerminalKeyboardInput(true);
  }, [
    focusTerminalKeyboardInput,
    onActivateTerminal,
    paneId,
    terminalIndex,
    updateTerminalInteractiveState,
    workspace?.id,
  ]);
  const requestTerminalAudioInputTarget = useCallback((active) => {
    const instanceId = terminalInstanceIdRef.current || undefined;

    if (active && !instanceId) {
      return Promise.resolve(false);
    }

    return invoke("set_terminal_audio_input_target", {
      active,
      instanceId,
      paneId,
    })
      .then(() => {
        if (!active) {
          clearActiveTerminalKeyboardTargetIfCurrent(paneId, instanceId);
        }

        return true;
      })
      .catch(() => {
        if (active) {
          clearActiveTerminalKeyboardTargetIfCurrent(paneId, instanceId);
        }

        return false;
      });
  }, [paneId]);

  const handleTerminalSurfaceFocusCapture = useCallback((event) => {
    if (isTerminalControlEventTarget(event.target)) {
      return;
    }

    activateTerminalPane("terminal_focus");
    requestTerminalAudioInputTarget(true);
  }, [activateTerminalPane, requestTerminalAudioInputTarget]);

  const handleTerminalSurfacePointerDownCapture = useCallback((event) => {
    if (isTerminalControlEventTarget(event.target)) {
      return;
    }

    activateTerminalPane("terminal_pointer");
    requestTerminalAudioInputTarget(true);
  }, [activateTerminalPane, requestTerminalAudioInputTarget]);

  useEffect(() => {
    terminalActiveRef.current = Boolean(isActive);
    setTerminalFocused(Boolean(isActive));
    updateTerminalInteractiveState(Boolean(isActive));

    if (isActive) {
      setActiveTerminalKeyboardTarget(paneId, terminalInstanceIdRef.current || 0);
      return undefined;
    }

    clearActiveTerminalKeyboardTargetIfCurrent(paneId, terminalInstanceIdRef.current || 0);
    requestTerminalAudioInputTarget(false);
    return undefined;
  }, [isActive, paneId, requestTerminalAudioInputTarget, updateTerminalInteractiveState]);

  useEffect(() => {
    const controller = resizeControllerRef.current;
    if (!controller) {
      return undefined;
    }

    const reason = isFullscreen
      ? `terminal_fullscreen_${fullscreenState || "open"}`
      : "terminal_fullscreen_grid";
    const timers = [];

    TERMINAL_FULLSCREEN_RESIZE_DELAYS_MS.forEach((delayMs) => {
      if (delayMs <= 0) {
        controller.schedule(reason, 0);
        return;
      }

      timers.push(window.setTimeout(() => {
        controller.schedule(reason, 0);
      }, delayMs));
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [fullscreenState, isFullscreen]);

  useEffect(() => {
    if (!restartRoleMenuOpen) {
      return undefined;
    }

    const handleRestartMenuPointerDown = (event) => {
      const menu = restartMenuRef.current;

      if (
        menu
        && typeof Node !== "undefined"
        && event.target instanceof Node
        && menu.contains(event.target)
      ) {
        return;
      }

      setRestartRoleMenuOpen(false);
    };

    const handleRestartMenuKeyDown = (event) => {
      if (event.key === "Escape") {
        setRestartRoleMenuOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleRestartMenuPointerDown, true);
    document.addEventListener("keydown", handleRestartMenuKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handleRestartMenuPointerDown, true);
      document.removeEventListener("keydown", handleRestartMenuKeyDown, true);
    };
  }, [restartRoleMenuOpen]);

  useEffect(() => {
    parkedPromptRef.current = parkedPrompt;
    updateTerminalInteractiveState(terminalActiveRef.current, Boolean(parkedPrompt));
  }, [parkedPrompt, updateTerminalInteractiveState]);

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

      const promptKey = `${Number(payload.instanceId || 0)}:${payload.taskId || ""}`;
      if (payload.status === "parked") {
        if (cancellingParkedPromptKeysRef.current.has(promptKey)) {
          return;
        }
        setParkedPrompt(payload);
      } else {
        cancellingParkedPromptKeysRef.current.delete(promptKey);
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
    const pendingOutputWrites = [];
    let pendingOutputBytes = 0;
    let outputBatchQueuedAt = 0;
    let outputWriteInFlight = false;
    let sawFirstOutput = false;
    let sawFirstVisibleOutput = false;
    let outputBytes = 0;
    let outputChunks = 0;
    let visibleOutputBytes = 0;
    let visibleOutputChunks = 0;
    let outputDiagnosticWindowStartedAt = performance.now();
    let outputDiagnosticChunks = 0;
    let outputDiagnosticInputBytes = 0;
    let outputDiagnosticDisplayBytes = 0;
    let outputDiagnosticVisibleChars = 0;
    let outputDiagnosticVisibleChunks = 0;
    let outputDiagnosticEscapeBytes = 0;
    let outputDiagnosticControlBytes = 0;
    let outputDiagnosticMaskMs = 0;
    let outputDiagnosticMaskMaxMs = 0;
    let outputDiagnosticDebugMs = 0;
    let outputDiagnosticDebugMaxMs = 0;
    let outputDiagnosticWriteBatches = 0;
    let outputDiagnosticWriteBytes = 0;
    let outputDiagnosticWriteChunks = 0;
    let outputDiagnosticWriteCallbackMs = 0;
    let outputDiagnosticWriteCallbackMaxMs = 0;
    let outputDiagnosticCombineMs = 0;
    let outputDiagnosticCombineMaxMs = 0;
    let outputDiagnosticQueuedMaxMs = 0;
    const outputDiagnosticFlushReasons = {};
    const disposables = [];
    const startupMetricTimers = new Set();
    const terminalInstanceId = getNextWorkspaceTerminalInstanceId();
    const renderSchedulerId = `${paneId}:${terminalInstanceId}`;
    terminalInstanceIdRef.current = terminalInstanceId;
    if (terminalActiveRef.current) {
      setActiveTerminalKeyboardTarget(paneId, terminalInstanceId);
    }
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
      convertEol: false,
      cursorBlink: terminalActiveRef.current && !parkedPromptRef.current,
      cursorStyle: "block",
      disableStdin: Boolean(parkedPromptRef.current),
      fastScrollModifier: "alt",
      fastScrollSensitivity: 5,
      fontFamily: "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.22,
      macOptionIsMeta: true,
      // Codex keeps cwd/status text on the live cursor row; do not let narrow resizes reflow stale worktree cells.
      reflowCursorLine: false,
      scrollSensitivity: 1,
      scrollOnEraseInDisplay: TERMINAL_IS_WINDOWS_HOST,
      scrollback: TERMINAL_DEFAULT_SCROLLBACK_ROWS,
      smoothScrollDuration: 0,
      ...(TERMINAL_IS_WINDOWS_HOST ? { windowsPty: buildWindowsPtyOptions() } : {}),
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

    const terminalDiagnosticsEnabled = isTerminalDiagnosticLoggingEnabled();
    const windowsTerminalDiagnosticsEnabled = isWindowsTerminalDiagnosticLoggingEnabled();
    syncTerminalDiagnosticLogging();
    syncWindowsTerminalDiagnosticLogging();
    startTerminalDiagnosticHeartbeat();
    let terminalScrollableElement = null;
    let terminalRendererOpened = false;
    let windowsPtyOptions = TERMINAL_IS_WINDOWS_HOST ? buildWindowsPtyOptions() : null;
    const applyWindowsPtyOptions = (info = null) => {
      if (!TERMINAL_IS_WINDOWS_HOST) {
        return null;
      }

      windowsPtyOptions = buildWindowsPtyOptions(info);
      terminal.options.windowsPty = windowsPtyOptions;
      return windowsPtyOptions;
    };
    const loadWindowsTerminalPtyInfo = async () => {
      if (!TERMINAL_IS_WINDOWS_HOST) {
        return null;
      }

      try {
        const info = await invoke("terminal_windows_pty_info");
        const options = applyWindowsPtyOptions(info);
        if (windowsTerminalDiagnosticsEnabled) {
          logWindowsTerminalDiagnosticEvent("frontend.windows_terminal.host_ready", {
            backend: options?.backend || "",
            buildNumber: Number(options?.buildNumber || 0),
            paneId,
            terminalIndex,
          });
        }

        return options;
      } catch (error) {
        const options = applyWindowsPtyOptions();
        if (windowsTerminalDiagnosticsEnabled) {
          logWindowsTerminalDiagnosticEvent("frontend.windows_terminal.host_info_error", {
            backend: options?.backend || "",
            message: getErrorMessage(error, "Unable to load Windows PTY metadata."),
            paneId,
            terminalIndex,
          });
        }

        return options;
      }
    };
    const getTerminalOpenContainerMeasurement = () => {
      const bounds = typeof container.getBoundingClientRect === "function"
        ? container.getBoundingClientRect()
        : null;
      const containerHeight = Number(bounds?.height ?? container.clientHeight ?? 0);
      const containerWidth = Number(bounds?.width ?? container.clientWidth ?? 0);

      return {
        clientHeight: Math.round(Number(container.clientHeight || 0)),
        clientWidth: Math.round(Number(container.clientWidth || 0)),
        containerHeight,
        containerWidth,
        ok: Number.isFinite(containerHeight)
          && Number.isFinite(containerWidth)
          && containerHeight >= 1
          && containerWidth >= 1,
      };
    };
    const openTerminalRenderer = (reason, fields = {}) => {
      if (terminalRendererOpened) {
        return true;
      }

      if (isDisposed) {
        return false;
      }

      const measurement = getTerminalOpenContainerMeasurement();
      if (!measurement.ok) {
        return false;
      }

      terminal.open(container);
      terminalRendererOpened = true;
      terminalScrollableElement = container.querySelector(".xterm-scrollable-element");
      logTerminalDiagnosticEvent("frontend.terminal_mount", {
        ...getTerminalDiagnosticEnvironment(),
        containerClientHeight: measurement.clientHeight,
        containerClientWidth: measurement.clientWidth,
        containerHeight: measurement.containerHeight,
        containerWidth: measurement.containerWidth,
        fontSize: 12,
        isWindowsHost: TERMINAL_IS_WINDOWS_HOST,
        lineHeight: 1.22,
        openAttempts: fields.attempts ?? null,
        openReason: reason,
        openWaitMs: fields.waitMs ?? null,
        paneId,
        rendererMode,
        scrollbarPlatform: TERMINAL_SCROLLBAR_PLATFORM,
        scrollOnEraseInDisplay: terminal.options.scrollOnEraseInDisplay === true,
        scrollback: TERMINAL_DEFAULT_SCROLLBACK_ROWS,
        terminalIndex,
        useWebglRenderer,
        windowsPty: TERMINAL_IS_WINDOWS_HOST ? windowsPtyOptions?.backend || TERMINAL_WINDOWS_PTY_BACKEND : "",
        windowsPtyBuildNumber: Number(windowsPtyOptions?.buildNumber || 0),
      });

      return true;
    };
    const waitForTerminalRendererOpen = async (reason) => {
      if (openTerminalRenderer(reason, { attempts: 1, waitMs: 0 })) {
        return true;
      }

      const waitStartedAt = performance.now();
      let attempts = 1;
      const firstMeasurement = getTerminalOpenContainerMeasurement();
      logTerminalDiagnosticEvent("frontend.terminal_mount_deferred", {
        ...firstMeasurement,
        paneId,
        reason,
        terminalIndex,
      });
      setPaneStage("starting", "Preparing Terminal", "Waiting for terminal layout.");

      while (
        !isDisposed
        && performance.now() - waitStartedAt < TERMINAL_START_LAYOUT_WAIT_MS
      ) {
        await waitForStartupMetricPoll(TERMINAL_START_METRIC_POLL_MS);

        if (isDisposed) {
          return false;
        }

        attempts += 1;
        if (
          openTerminalRenderer(reason, {
            attempts,
            waitMs: performance.now() - waitStartedAt,
          })
        ) {
          return true;
        }
      }

      throw new Error("Terminal container was not visible before renderer startup.");
    };

    const logWindowsTerminalCompactDiagnostic = (phase, fields = {}) => {
      if (!windowsTerminalDiagnosticsEnabled) {
        return;
      }

      logWindowsTerminalDiagnosticEvent(phase, {
        ...fields,
        paneId,
        rendererMode,
        state: getWindowsTerminalCompactState(terminal, container, terminalScrollableElement),
        terminalIndex,
      });
    };

    const waitForTerminalRenderFrame = () => new Promise((resolve) => {
      if (isDisposed) {
        resolve();
        return;
      }

      if (typeof window.requestAnimationFrame !== "function") {
        const timer = window.setTimeout(() => {
          startupMetricTimers.delete(timer);
          resolve();
        }, TERMINAL_START_GEOMETRY_POLL_MS);
        startupMetricTimers.add(timer);
        return;
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });

    const waitForWindowsTerminalGeometrySettled = async (reason, targetSize) => {
      if (!targetSize) {
        return { ok: false, attempts: 0, elapsedMs: 0 };
      }

      const startedAt = performance.now();
      let attempts = 0;
      let lastState = null;

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.geometry_wait_start", {
        reason,
        targetCols: Number(targetSize.cols || 0),
        targetRows: Number(targetSize.rows || 0),
      });

      while (!isDisposed && performance.now() - startedAt < TERMINAL_START_GEOMETRY_WAIT_MS) {
        attempts += 1;
        if (
          terminal.cols !== targetSize.cols
          || terminal.rows !== targetSize.rows
          || attempts % 4 === 1
        ) {
          terminal.resize(targetSize.cols, targetSize.rows);
        }

        refreshTerminalRenderer(`${reason}_geometry_${attempts}`);
        await waitForTerminalRenderFrame();
        lastState = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);

        if (isWindowsTerminalGeometrySettled(lastState, targetSize)) {
          logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.geometry_ready", {
            attempts,
            elapsedMs: performance.now() - startedAt,
            reason,
            targetCols: Number(targetSize.cols || 0),
            targetRows: Number(targetSize.rows || 0),
          });
          return {
            attempts,
            elapsedMs: performance.now() - startedAt,
            ok: true,
            state: lastState,
          };
        }

        await waitForStartupMetricPoll(TERMINAL_START_GEOMETRY_POLL_MS);
      }

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.geometry_unsettled", {
        attempts,
        elapsedMs: performance.now() - startedAt,
        lastState,
        reason,
        targetCols: Number(targetSize.cols || 0),
        targetRows: Number(targetSize.rows || 0),
      });

      return {
        attempts,
        elapsedMs: performance.now() - startedAt,
        ok: false,
        state: lastState,
      };
    };

    let windowsTerminalControlSequenceId = 0;
    let windowsTerminalLastEraseDisplayFrame = null;
    let windowsTerminalDuplicateEraseDisplayFrames = 0;
    let windowsTerminalScrollOnEraseRestoreTimer = 0;
    let windowsTerminalSuppressedEraseDisplayFrames = 0;
    let windowsTerminalAgentRepaintTransientUntil = 0;
    let windowsTerminalLastKnownBaseY = 0;
    let windowsTerminalProtectedScrollbackBaseY = 0;
    let windowsTerminalProtectScrollbackUntil = 0;
    let windowsTerminalResizeLiveClearCount = 0;
    let windowsTerminalResizeLiveClearPendingEvent = null;
    let windowsTerminalResizeLiveClearTimer = 0;
    let windowsTerminalResizeLiveClearWritesInFlight = 0;
    let windowsTerminalResizeScrollbackPurgeReason = "";
    let windowsTerminalResizeScrollbackPurgeTimer = 0;
    let windowsTerminalResizeScrollbackPurgeInFlight = false;
    let windowsTerminalResizeStartState = null;
    let windowsTerminalResizeTransientUntil = 0;
    let windowsTerminalResizeTransientScrollbarTimer = 0;
    let windowsTerminalTransientResizeScrollbackRows = 0;
    const clearWindowsTerminalTransientScrollbarMask = (reason) => {
      if (!TERMINAL_IS_WINDOWS_HOST) {
        return;
      }

      if (windowsTerminalResizeTransientScrollbarTimer) {
        window.clearTimeout(windowsTerminalResizeTransientScrollbarTimer);
        startupMetricTimers.delete(windowsTerminalResizeTransientScrollbarTimer);
        windowsTerminalResizeTransientScrollbarTimer = 0;
      }

      if (container.dataset.resizeTransientScrollback === "true") {
        delete container.dataset.resizeTransientScrollback;
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.resize_transient_scrollbar_unmasked", {
          reason,
        });
      }
    };
    const markWindowsTerminalTransientScrollbar = (reason) => {
      if (!TERMINAL_IS_WINDOWS_HOST || isGenericTerminal) {
        return;
      }

      const wasMasked = container.dataset.resizeTransientScrollback === "true";
      container.dataset.resizeTransientScrollback = "true";

      if (!wasMasked) {
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.resize_transient_scrollbar_masked", {
          reason,
        });
      }

      if (windowsTerminalResizeTransientScrollbarTimer) {
        window.clearTimeout(windowsTerminalResizeTransientScrollbarTimer);
        startupMetricTimers.delete(windowsTerminalResizeTransientScrollbarTimer);
        windowsTerminalResizeTransientScrollbarTimer = 0;
      }

      windowsTerminalResizeTransientScrollbarTimer = window.setTimeout(() => {
        startupMetricTimers.delete(windowsTerminalResizeTransientScrollbarTimer);
        windowsTerminalResizeTransientScrollbarTimer = 0;
        if (!isDisposed) {
          clearWindowsTerminalTransientScrollbarMask("transient_scrollbar_timeout");
        }
      }, WINDOWS_TERMINAL_RESIZE_TRANSIENT_SCROLLBAR_HIDE_MS);
      startupMetricTimers.add(windowsTerminalResizeTransientScrollbarTimer);
    };
    const protectWindowsTerminalScrollback = (baseY, reason) => {
      const protectedBaseY = Math.max(0, Number(baseY || 0));
      if (!TERMINAL_IS_WINDOWS_HOST || protectedBaseY <= 0) {
        return;
      }

      const previousProtectedBaseY = windowsTerminalProtectedScrollbackBaseY;
      windowsTerminalProtectedScrollbackBaseY = Math.max(
        windowsTerminalProtectedScrollbackBaseY,
        protectedBaseY,
      );
      windowsTerminalTransientResizeScrollbackRows = 0;
      clearWindowsTerminalTransientScrollbarMask(reason);

      if (windowsTerminalProtectedScrollbackBaseY !== previousProtectedBaseY) {
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.protected_scrollback", {
          baseY: protectedBaseY,
          protectedBaseY: windowsTerminalProtectedScrollbackBaseY,
          reason,
        });
      }
    };
    const protectNextWindowsTerminalScrollbackGrowth = (reason) => {
      if (!TERMINAL_IS_WINDOWS_HOST) {
        return;
      }

      windowsTerminalProtectScrollbackUntil = Math.max(
        windowsTerminalProtectScrollbackUntil,
        performance.now() + WINDOWS_TERMINAL_REPAINT_TRANSIENT_SCROLLBACK_MS,
      );

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.protected_scrollback_window", {
        reason,
      });
    };
    const suppressWindowsTerminalScrollOnEraseForCurrentClear = (reason) => {
      if (!TERMINAL_IS_WINDOWS_HOST) {
        return false;
      }

      if (windowsTerminalScrollOnEraseRestoreTimer) {
        window.clearTimeout(windowsTerminalScrollOnEraseRestoreTimer);
        startupMetricTimers.delete(windowsTerminalScrollOnEraseRestoreTimer);
        windowsTerminalScrollOnEraseRestoreTimer = 0;
      }

      terminal.options.scrollOnEraseInDisplay = false;
      windowsTerminalSuppressedEraseDisplayFrames += 1;
      if (reason !== "resize_growth_live_viewport_clear") {
        windowsTerminalAgentRepaintTransientUntil = Math.max(
          windowsTerminalAgentRepaintTransientUntil,
          performance.now() + WINDOWS_TERMINAL_REPAINT_TRANSIENT_SCROLLBACK_MS,
        );
      }

      windowsTerminalScrollOnEraseRestoreTimer = window.setTimeout(() => {
        startupMetricTimers.delete(windowsTerminalScrollOnEraseRestoreTimer);
        windowsTerminalScrollOnEraseRestoreTimer = 0;

        if (!isDisposed) {
          terminal.options.scrollOnEraseInDisplay = TERMINAL_IS_WINDOWS_HOST;
        }
      }, 0);
      startupMetricTimers.add(windowsTerminalScrollOnEraseRestoreTimer);

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.scroll_on_erase_suppressed", {
        reason,
        suppressedEraseDisplayFrames: windowsTerminalSuppressedEraseDisplayFrames,
      });

      return true;
    };
    const noteWindowsTerminalTransientScrollbackRows = (deltaRows, state, reason) => {
      const baseY = Number(state?.baseY || 0);
      if (
        !TERMINAL_IS_WINDOWS_HOST
        || isGenericTerminal
        || baseY <= 0
        || deltaRows <= 0
        || windowsTerminalProtectedScrollbackBaseY > 0
      ) {
        return;
      }

      windowsTerminalTransientResizeScrollbackRows = baseY;
      markWindowsTerminalTransientScrollbar(reason);
      windowsTerminalResizeTransientUntil = Math.max(
        windowsTerminalResizeTransientUntil,
        performance.now() + WINDOWS_TERMINAL_RESIZE_TRANSIENT_SCROLLBACK_MS,
      );

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.resize_scrollback_transient", {
        baseY,
        deltaRows,
        reason,
        transientRows: windowsTerminalTransientResizeScrollbackRows,
      });
    };
    const observeWindowsTerminalBaseY = (reason, providedState = null) => {
      const state = providedState || getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
      const baseY = Number(state?.baseY || 0);
      const previousBaseY = Number(windowsTerminalLastKnownBaseY || 0);
      const now = performance.now();
      const reasonText = String(reason || "");
      const insideTransientWindow = now <= windowsTerminalResizeTransientUntil
        || now <= windowsTerminalAgentRepaintTransientUntil;
      const isResizeObservation = reasonText.includes("resize");

      if (baseY < windowsTerminalProtectedScrollbackBaseY) {
        windowsTerminalProtectedScrollbackBaseY = baseY;
      }

      if (baseY > previousBaseY && now <= windowsTerminalProtectScrollbackUntil) {
        protectWindowsTerminalScrollback(baseY, reason);
      } else if (
        baseY > previousBaseY
        && (insideTransientWindow || isResizeObservation)
      ) {
        noteWindowsTerminalTransientScrollbackRows(baseY - previousBaseY, state, reason);
      } else if (baseY < previousBaseY) {
        windowsTerminalTransientResizeScrollbackRows = Math.min(
          windowsTerminalTransientResizeScrollbackRows,
          baseY,
        );
      }

      windowsTerminalLastKnownBaseY = baseY;
      return state;
    };
    const canPurgeWindowsTerminalResizeScrollback = (providedState = null) => {
      if (!TERMINAL_IS_WINDOWS_HOST || isGenericTerminal) {
        return false;
      }

      const state = providedState || getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
      const baseY = Number(state?.baseY || 0);
      const now = performance.now();
      const insideResizeWindow = now <= windowsTerminalResizeTransientUntil;
      const insideRepaintWindow = now <= windowsTerminalAgentRepaintTransientUntil;

      if (windowsTerminalProtectedScrollbackBaseY > 0) {
        return false;
      }

      return state?.bufferType === "normal"
        && baseY > 0
        && (
          windowsTerminalTransientResizeScrollbackRows >= baseY
          || (insideResizeWindow && windowsTerminalTransientResizeScrollbackRows > 0)
          || insideRepaintWindow
        );
    };
    const finishWindowsTerminalResizeScrollbackPurge = (reason) => {
      const state = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
      windowsTerminalLastKnownBaseY = Number(state.baseY || 0);
      windowsTerminalTransientResizeScrollbackRows = Math.min(
        windowsTerminalTransientResizeScrollbackRows,
        Number(state.baseY || 0),
      );
      windowsTerminalProtectedScrollbackBaseY = Math.min(
        windowsTerminalProtectedScrollbackBaseY,
        Number(state.baseY || 0),
      );
      if (Number(state.baseY || 0) <= 0) {
        windowsTerminalTransientResizeScrollbackRows = 0;
        windowsTerminalProtectedScrollbackBaseY = 0;
        windowsTerminalProtectScrollbackUntil = 0;
        windowsTerminalResizeTransientUntil = 0;
        windowsTerminalAgentRepaintTransientUntil = 0;
        clearWindowsTerminalTransientScrollbarMask(reason);
      }

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.resize_scrollback_purge_done", {
        reason,
        transientRows: windowsTerminalTransientResizeScrollbackRows,
      });
      updateTerminalScrollbarOverflow();
      scheduleTerminalScrollbarRefresh([40, 160]);
    };
    const scheduleWindowsTerminalResizeScrollbackPurge = (reason) => {
      if (!TERMINAL_IS_WINDOWS_HOST || isGenericTerminal) {
        return false;
      }

      const state = observeWindowsTerminalBaseY(`${reason}_schedule`);
      if (!canPurgeWindowsTerminalResizeScrollback(state)) {
        return false;
      }

      if (windowsTerminalResizeScrollbackPurgeTimer) {
        window.clearTimeout(windowsTerminalResizeScrollbackPurgeTimer);
        startupMetricTimers.delete(windowsTerminalResizeScrollbackPurgeTimer);
        windowsTerminalResizeScrollbackPurgeTimer = 0;
      }

      windowsTerminalResizeScrollbackPurgeReason = reason;
      windowsTerminalResizeScrollbackPurgeTimer = window.setTimeout(() => {
        startupMetricTimers.delete(windowsTerminalResizeScrollbackPurgeTimer);
        windowsTerminalResizeScrollbackPurgeTimer = 0;

        if (isDisposed) {
          return;
        }

        const purgeState = observeWindowsTerminalBaseY(`${reason}_purge`);
        if (!canPurgeWindowsTerminalResizeScrollback(purgeState)) {
          return;
        }

        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.resize_scrollback_purge_requested", {
          reason,
          transientRows: windowsTerminalTransientResizeScrollbackRows,
        });

        try {
          windowsTerminalResizeScrollbackPurgeInFlight = true;
          terminal.write("\x1b[3J", () => {
            windowsTerminalResizeScrollbackPurgeInFlight = false;
            if (!isDisposed) {
              finishWindowsTerminalResizeScrollbackPurge(reason);
            }
          });
        } catch (error) {
          windowsTerminalResizeScrollbackPurgeInFlight = false;
          logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.resize_scrollback_purge_error", {
            message: getErrorMessage(error, "Unable to purge transient resize scrollback."),
            reason,
          });
        }
      }, WINDOWS_TERMINAL_RESIZE_SCROLLBACK_PURGE_DELAY_MS);
      startupMetricTimers.add(windowsTerminalResizeScrollbackPurgeTimer);
      return true;
    };
    const rememberWindowsTerminalResizeStart = (event = {}) => {
      if (!TERMINAL_IS_WINDOWS_HOST || isGenericTerminal) {
        return;
      }

      const state = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
      const baseY = Number(state.baseY || 0);
      windowsTerminalResizeStartState = {
        baseY,
        bufferLength: Number(state.bufferLength || 0),
        reason: event.reason || "resize",
        rows: Number(state.rows || 0),
      };
      if (baseY > 0 && windowsTerminalTransientResizeScrollbackRows < baseY) {
        protectWindowsTerminalScrollback(baseY, "resize_start_existing_scrollback");
      }
      windowsTerminalLastKnownBaseY = baseY;
      windowsTerminalResizeTransientUntil = Math.max(
        windowsTerminalResizeTransientUntil,
        performance.now() + WINDOWS_TERMINAL_RESIZE_TRANSIENT_SCROLLBACK_MS,
      );
    };
    const shouldClearWindowsTerminalLiveViewportOnResize = (event, state) => {
      if (
        !TERMINAL_IS_WINDOWS_HOST
        || isGenericTerminal
        || !WINDOWS_TERMINAL_RESIZE_LIVE_CLEAR_AGENT_KINDS.has(terminalAgentKind)
        || state?.bufferType !== "normal"
      ) {
        return false;
      }

      const previousRows = Number(event?.previousRows || windowsTerminalResizeStartState?.rows || 0);
      const nextRows = Number(event?.rows || state?.rows || terminal.rows || 0);

      return previousRows > 0 && nextRows > previousRows;
    };
    const runWindowsTerminalLiveViewportClear = () => {
      const event = windowsTerminalResizeLiveClearPendingEvent;
      windowsTerminalResizeLiveClearPendingEvent = null;
      windowsTerminalResizeLiveClearTimer = 0;

      if (isDisposed || !event) {
        return false;
      }

      const state = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
      if (!shouldClearWindowsTerminalLiveViewportOnResize(event, state)) {
        return false;
      }

      windowsTerminalResizeLiveClearCount += 1;
      windowsTerminalResizeLiveClearWritesInFlight += 1;

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.resize_live_viewport_clear_requested", {
        clearCount: windowsTerminalResizeLiveClearCount,
        nextRows: Number(event?.rows || state?.rows || terminal.rows || 0),
        previousRows: Number(event?.previousRows || windowsTerminalResizeStartState?.rows || 0),
        reason: event?.reason || "resize_done",
      });

      try {
        terminal.write("\x1b[2J", () => {
          windowsTerminalResizeLiveClearWritesInFlight = Math.max(
            0,
            windowsTerminalResizeLiveClearWritesInFlight - 1,
          );
          if (isDisposed) {
            return;
          }

          logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.resize_live_viewport_clear_done", {
            clearCount: windowsTerminalResizeLiveClearCount,
            reason: event?.reason || "resize_done",
          });
          refreshTerminalRenderer("windows_resize_live_viewport_clear");
        });
      } catch (error) {
        windowsTerminalResizeLiveClearWritesInFlight = Math.max(
          0,
          windowsTerminalResizeLiveClearWritesInFlight - 1,
        );
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.resize_live_viewport_clear_error", {
          message: getErrorMessage(error, "Unable to clear transient resize viewport."),
          reason: event?.reason || "resize_done",
        });
      }

      return true;
    };
    const clearWindowsTerminalLiveViewportForResize = (event, state) => {
      if (!shouldClearWindowsTerminalLiveViewportOnResize(event, state)) {
        return false;
      }

      windowsTerminalResizeLiveClearPendingEvent = {
        ...event,
        previousRows: Number(windowsTerminalResizeStartState?.rows || 0),
        rows: Number(event?.rows || state?.rows || terminal.rows || 0),
      };

      if (windowsTerminalResizeLiveClearTimer) {
        window.clearTimeout(windowsTerminalResizeLiveClearTimer);
        startupMetricTimers.delete(windowsTerminalResizeLiveClearTimer);
        windowsTerminalResizeLiveClearTimer = 0;
      }

      windowsTerminalResizeLiveClearTimer = window.setTimeout(() => {
        startupMetricTimers.delete(windowsTerminalResizeLiveClearTimer);
        runWindowsTerminalLiveViewportClear();
      }, WINDOWS_TERMINAL_RESIZE_LIVE_CLEAR_DELAY_MS);
      startupMetricTimers.add(windowsTerminalResizeLiveClearTimer);

      return true;
    };
    const rememberWindowsTerminalResizeDone = (event = {}) => {
      if (!TERMINAL_IS_WINDOWS_HOST || isGenericTerminal) {
        return;
      }

      const state = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
      const startBaseY = Number(windowsTerminalResizeStartState?.baseY ?? windowsTerminalLastKnownBaseY);
      const baseY = Number(state.baseY || 0);
      const deltaRows = baseY - startBaseY;

      if (deltaRows > 0) {
        noteWindowsTerminalTransientScrollbackRows(deltaRows, state, event.reason || "resize_done");
      } else {
        windowsTerminalTransientResizeScrollbackRows = Math.min(
          windowsTerminalTransientResizeScrollbackRows,
          baseY,
        );
      }

      windowsTerminalLastKnownBaseY = baseY;
      clearWindowsTerminalLiveViewportForResize(event, state);
      windowsTerminalResizeStartState = null;
      scheduleWindowsTerminalResizeScrollbackPurge(event.reason || "resize_done");
    };
    const scheduleWindowsTerminalControlAfterLog = (
      sequenceId,
      control,
      action,
      getAfterFields = null,
    ) => {
      if (!windowsTerminalDiagnosticsEnabled) {
        return;
      }

      const timer = window.setTimeout(() => {
        startupMetricTimers.delete(timer);
        const afterFields = typeof getAfterFields === "function" ? getAfterFields() : {};
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.control_after", {
          action,
          ...afterFields,
          control,
          sequenceId,
        });
      }, 0);
      startupMetricTimers.add(timer);
    };

    const logWindowsTerminalControl = (
      control,
      fields = {},
      scheduleAfter = false,
      getAfterFields = null,
    ) => {
      if (!windowsTerminalDiagnosticsEnabled) {
        return 0;
      }

      windowsTerminalControlSequenceId += 1;
      const sequenceId = windowsTerminalControlSequenceId;
      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.control", {
        control,
        sequenceId,
        ...fields,
      });

      if (scheduleAfter) {
        scheduleWindowsTerminalControlAfterLog(sequenceId, control, fields.action || "", getAfterFields);
      }

      return sequenceId;
    };

    const registerWindowsTerminalControlDiagnostics = () => {
      if (!TERMINAL_IS_WINDOWS_HOST) {
        return;
      }

      if (typeof terminal.parser?.registerCsiHandler !== "function") {
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.parser_unavailable", {
          reason: "registerCsiHandler missing",
        });
        return;
      }

      disposables.push(terminal.parser.registerCsiHandler({ final: "J" }, (params) => {
        const actionParam = getFirstCsiParam(params, 0);
        const allParams = getCsiParamNumbers(params);
        const observedState = observeWindowsTerminalBaseY("erase_display_control");
        const activeBufferType = getTerminalBufferDiagnostics(terminal)?.type || "";
        const isInternalResizeLiveClear = actionParam === 2
          && activeBufferType !== "alternate"
          && windowsTerminalResizeLiveClearWritesInFlight > 0;
        const shouldAllowTransientResizePurge = actionParam === 3
          && activeBufferType !== "alternate"
          && windowsTerminalResizeScrollbackPurgeInFlight
          && canPurgeWindowsTerminalResizeScrollback(observedState);
        const shouldBlockSavedLineErase = actionParam === 3
          && activeBufferType !== "alternate"
          && !shouldAllowTransientResizePurge;
        const shouldSuppressScrollOnErase = isInternalResizeLiveClear;
        const scrollOnEraseSuppressed = shouldSuppressScrollOnErase
          ? suppressWindowsTerminalScrollOnEraseForCurrentClear("resize_growth_live_viewport_clear")
          : false;
        const action = shouldBlockSavedLineErase ? "block" : "allow";
        const control = actionParam === 3 ? "erase_saved_lines" : "erase_display";
        const liveFrameBefore = actionParam === 2
          ? getWindowsTerminalLiveFrameFingerprint(terminal)
          : null;
        const historyTailBefore = actionParam === 2
          ? getWindowsTerminalHistoryTailFingerprint(terminal)
          : null;
        const previousFrameComparison = actionParam === 2
          ? compareWindowsTerminalFrameFingerprints(liveFrameBefore, windowsTerminalLastEraseDisplayFrame)
          : null;
        const historyTailComparison = actionParam === 2
          ? compareWindowsTerminalFrameFingerprints(liveFrameBefore, historyTailBefore)
          : null;

        if (actionParam === 2) {
          if (previousFrameComparison?.sameAggregateHash) {
            windowsTerminalDuplicateEraseDisplayFrames += 1;
          } else {
            windowsTerminalDuplicateEraseDisplayFrames = 0;
          }
          windowsTerminalLastEraseDisplayFrame = liveFrameBefore;
        }

        logWindowsTerminalControl(control, {
          action,
          bufferType: activeBufferType,
          duplicateEraseDisplayFrames: actionParam === 2
            ? windowsTerminalDuplicateEraseDisplayFrames
            : undefined,
          frameBefore: liveFrameBefore?.log || null,
          historyTailBefore: historyTailBefore?.log || null,
          historyTailComparison,
          params: allParams.length > 0 ? allParams : [actionParam],
          previousFrameComparison,
          resizeScrollbackPurgeAllowed: shouldAllowTransientResizePurge,
          resizeScrollbackPurgeReason: shouldAllowTransientResizePurge
            ? windowsTerminalResizeScrollbackPurgeReason || "incoming_erase_saved_lines"
            : "",
          resizeTransientRows: windowsTerminalTransientResizeScrollbackRows,
          resizeLiveClearInFlight: windowsTerminalResizeLiveClearWritesInFlight > 0,
          resizeLiveClearInternal: isInternalResizeLiveClear,
          scrollOnEraseSuppressed,
          suppressedEraseDisplayFrames: actionParam === 2
            ? windowsTerminalSuppressedEraseDisplayFrames
            : undefined,
        }, true, () => ({
          frameAfter: actionParam === 2
            ? getWindowsTerminalLiveFrameFingerprint(terminal).log
            : null,
          historyTailAfter: actionParam === 2
            ? getWindowsTerminalHistoryTailFingerprint(terminal).log
            : null,
          scrollOnEraseInDisplay: terminal.options.scrollOnEraseInDisplay === true,
          resizeTransientRows: windowsTerminalTransientResizeScrollbackRows,
        }));

        if (actionParam === 2 && !isInternalResizeLiveClear && activeBufferType !== "alternate") {
          protectNextWindowsTerminalScrollbackGrowth("agent_erase_display");
          if (Number(observedState?.baseY || 0) > 0) {
            protectWindowsTerminalScrollback(observedState.baseY, "agent_erase_display_existing_scrollback");
          }
        }

        if (shouldBlockSavedLineErase && canPurgeWindowsTerminalResizeScrollback(observedState)) {
          scheduleWindowsTerminalResizeScrollbackPurge("blocked_erase_saved_lines_after");
        }

        return shouldBlockSavedLineErase;
      }));

      const registerDecPrivateModeHandler = (mode) => terminal.parser.registerCsiHandler(
        { prefix: "?", final: mode === "set" ? "h" : "l" },
        (params) => {
          const observedState = observeWindowsTerminalBaseY(`dec_private_${mode}`);
          const allParams = getCsiParamNumbers(params);
          const interestingParams = allParams.filter((param) => (
            TERMINAL_WINDOWS_INTERESTING_DEC_PRIVATE_MODES.has(param)
          ));

          if (interestingParams.length > 0) {
            const control = interestingParams.some((param) => param === 1047 || param === 1048 || param === 1049)
              ? "alternate_buffer"
              : interestingParams.includes(2026)
                ? "sync_output"
                : interestingParams.some((param) => param >= 1000 && param <= 1007)
                  ? "mouse_mode"
                  : "dec_private_mode";

            logWindowsTerminalControl(control, {
              action: "allow",
              mode,
              params: interestingParams,
              resizeTransientRows: windowsTerminalTransientResizeScrollbackRows,
            }, control === "alternate_buffer");

            if (
              control === "sync_output"
              && canPurgeWindowsTerminalResizeScrollback(observedState)
            ) {
              scheduleWindowsTerminalResizeScrollbackPurge(`sync_output_${mode}`);
            }
          }

          return false;
        },
      );

      disposables.push(registerDecPrivateModeHandler("set"));
      disposables.push(registerDecPrivateModeHandler("reset"));

      let cursorMoveWindowStartedAt = 0;
      let cursorMoveWindowCount = 0;
      const registerCursorMoveHandler = (final) => terminal.parser.registerCsiHandler(
        { final },
        (params) => {
          const observedState = observeWindowsTerminalBaseY(`cursor_position_${final}`);
          if (canPurgeWindowsTerminalResizeScrollback(observedState)) {
            scheduleWindowsTerminalResizeScrollbackPurge(`cursor_position_${final}`);
          }

          const now = performance.now();
          if (now - cursorMoveWindowStartedAt > 2000) {
            cursorMoveWindowStartedAt = now;
            cursorMoveWindowCount = 0;
          }

          if (cursorMoveWindowCount < 8) {
            cursorMoveWindowCount += 1;
            logWindowsTerminalControl("cursor_position", {
              action: "allow",
              final,
              params: getCsiParamNumbers(params),
            }, false);
          }

          return false;
        },
      );

      disposables.push(registerCursorMoveHandler("H"));
      disposables.push(registerCursorMoveHandler("f"));
    };

    registerWindowsTerminalControlDiagnostics();

    let windowsTerminalLastResizeLogAt = 0;
    disposables.push(terminal.onResize(() => {
      const now = performance.now();
      if (windowsTerminalDiagnosticsEnabled && now - windowsTerminalLastResizeLogAt >= 250) {
        windowsTerminalLastResizeLogAt = now;
        const timer = window.setTimeout(() => {
          startupMetricTimers.delete(timer);
          const state = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
          observeWindowsTerminalBaseY("xterm_resize_settled", state);
          scheduleWindowsTerminalResizeScrollbackPurge("xterm_resize_settled");
          logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.resize_settled", {
            reason: "xterm_resize",
            resizeTransientRows: windowsTerminalTransientResizeScrollbackRows,
          });
        }, TERMINAL_START_GEOMETRY_POLL_MS);
        startupMetricTimers.add(timer);
      }
    }));

    let windowsTerminalLastScrollLogAt = 0;
    disposables.push(terminal.onScroll((viewportY) => {
      const now = performance.now();
      if (windowsTerminalDiagnosticsEnabled && now - windowsTerminalLastScrollLogAt >= 250) {
        windowsTerminalLastScrollLogAt = now;
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.scroll", {
          viewportY: Number(viewportY || 0),
        });
      }
    }));

    const flushOutputDiagnosticWindow = (reason = "window") => {
      if (!terminalDiagnosticsEnabled) {
        return;
      }

      const elapsedMs = performance.now() - outputDiagnosticWindowStartedAt;
      if (
        elapsedMs < TERMINAL_OUTPUT_DIAGNOSTIC_WINDOW_MS
        && outputDiagnosticChunks === 0
        && outputDiagnosticWriteBatches === 0
      ) {
        return;
      }

      logTerminalDiagnosticEvent("frontend.output_window", {
        chunks: outputDiagnosticChunks,
        combineMaxMs: outputDiagnosticCombineMaxMs,
        combineMs: outputDiagnosticCombineMs,
        controlBytes: outputDiagnosticControlBytes,
        debugMaxMs: outputDiagnosticDebugMaxMs,
        debugMs: outputDiagnosticDebugMs,
        displayBytes: outputDiagnosticDisplayBytes,
        elapsedMs,
        escapeBytes: outputDiagnosticEscapeBytes,
        flushReasons: { ...outputDiagnosticFlushReasons },
        inputBytes: outputDiagnosticInputBytes,
        maskMaxMs: outputDiagnosticMaskMaxMs,
        maskMs: outputDiagnosticMaskMs,
        paneId,
        queuedMaxMs: outputDiagnosticQueuedMaxMs,
        reason,
        rendererMode,
        terminalIndex,
        visibleChars: outputDiagnosticVisibleChars,
        visibleChunks: outputDiagnosticVisibleChunks,
        writeBatches: outputDiagnosticWriteBatches,
        writeBytes: outputDiagnosticWriteBytes,
        writeCallbackMaxMs: outputDiagnosticWriteCallbackMaxMs,
        writeCallbackMs: outputDiagnosticWriteCallbackMs,
        writeChunks: outputDiagnosticWriteChunks,
      });

      outputDiagnosticWindowStartedAt = performance.now();
      outputDiagnosticChunks = 0;
      outputDiagnosticInputBytes = 0;
      outputDiagnosticDisplayBytes = 0;
      outputDiagnosticVisibleChars = 0;
      outputDiagnosticVisibleChunks = 0;
      outputDiagnosticEscapeBytes = 0;
      outputDiagnosticControlBytes = 0;
      outputDiagnosticMaskMs = 0;
      outputDiagnosticMaskMaxMs = 0;
      outputDiagnosticDebugMs = 0;
      outputDiagnosticDebugMaxMs = 0;
      outputDiagnosticWriteBatches = 0;
      outputDiagnosticWriteBytes = 0;
      outputDiagnosticWriteChunks = 0;
      outputDiagnosticWriteCallbackMs = 0;
      outputDiagnosticWriteCallbackMaxMs = 0;
      outputDiagnosticCombineMs = 0;
      outputDiagnosticCombineMaxMs = 0;
      outputDiagnosticQueuedMaxMs = 0;
      Object.keys(outputDiagnosticFlushReasons).forEach((key) => {
        delete outputDiagnosticFlushReasons[key];
      });
    };

    disposables.push(() => flushOutputDiagnosticWindow("dispose"));

    let terminalFocusClearTimer = 0;
    const markTerminalAudioInputTarget = () => {
      if (terminalFocusClearTimer) {
        window.clearTimeout(terminalFocusClearTimer);
        terminalFocusClearTimer = 0;
      }

      if (!isDisposed) {
        activateTerminalPane("terminal_dom_focus");
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

      if (terminalActiveRef.current) {
        requestTerminalAudioInputTarget(true);
        focusTerminalKeyboardInput();
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
      if (!useWebglRenderer || isDisposed || webglAttachAttempted || !terminalRendererOpened) {
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
          logTerminalDiagnosticEvent("frontend.webgl.context_loss", {
            paneId,
            reason,
            terminalIndex,
          });
          webglAddon.dispose();
        }));
        patchTerminalMetrics({ webglMs: performance.now() - webglStartedAt });
        logTerminalDiagnosticDuration("frontend.webgl.attach_done", webglStartedAt, {
          paneId,
          reason,
          terminalIndex,
        });
        refreshTerminalRenderer("webgl_attach_done", { reason });
      } catch {
        // WebGL is best-effort; xterm keeps its canvas renderer when WebGL2 is unavailable.
        rendererMode = "canvas";
        webglAddon.dispose();
        patchTerminalMetrics({ webglMs: performance.now() - webglStartedAt });
        logTerminalDiagnosticDuration("frontend.webgl.attach_failed", webglStartedAt, {
          paneId,
          reason,
          terminalIndex,
        });
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

    focusTerminalKeyboardInput();

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
      terminalGlobalRenderScheduler.cancel(renderSchedulerId);
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

      if (outputWriteInFlight) {
        scheduleTerminalOutputBatchFlush();
        return;
      }

      const flushStartedAt = performance.now();
      const writes = pendingOutputWrites.splice(0);
      const batchBytes = pendingOutputBytes;
      const queuedMs = outputBatchQueuedAt ? performance.now() - outputBatchQueuedAt : 0;
      pendingOutputBytes = 0;
      outputBatchQueuedAt = 0;
      cancelTerminalOutputBatchTimers();

      const combineStartedAt = performance.now();
      const batchData = combineTerminalOutputWrites(writes);
      const combineMs = performance.now() - combineStartedAt;
      const isFirstOutputChunk = writes.some((write) => write.isFirstOutputChunk);
      const isFirstVisibleOutputChunk = writes.some((write) => write.isFirstVisibleOutputChunk);
      const batchVisibleChars = writes.reduce(
        (total, write) => total + (Number(write.outputDebug?.visibleChars) || 0),
        0,
      );
      const shouldCollectOutputDebug = isFirstOutputChunk
        || isFirstVisibleOutputChunk;
      const debugStartedAt = shouldCollectOutputDebug ? performance.now() : 0;
      const outputDebug = shouldCollectOutputDebug
        ? getTerminalOutputDebugFields(batchData)
        : { visibleChars: batchVisibleChars };
      const debugMs = shouldCollectOutputDebug ? performance.now() - debugStartedAt : 0;
      if (terminalDiagnosticsEnabled) {
        outputDiagnosticWriteBatches += 1;
        outputDiagnosticWriteBytes += batchBytes;
        outputDiagnosticWriteChunks += writes.length;
        outputDiagnosticCombineMs += combineMs;
        outputDiagnosticCombineMaxMs = Math.max(outputDiagnosticCombineMaxMs, combineMs);
        outputDiagnosticDebugMs += debugMs;
        outputDiagnosticDebugMaxMs = Math.max(outputDiagnosticDebugMaxMs, debugMs);
        outputDiagnosticQueuedMaxMs = Math.max(outputDiagnosticQueuedMaxMs, queuedMs);
        outputDiagnosticFlushReasons[reason] = (outputDiagnosticFlushReasons[reason] || 0) + 1;
      }
      const shouldLogWrite = outputChunks <= 10
        || isFirstOutputChunk
        || isFirstVisibleOutputChunk
        || writes.length > 1;

      if (shouldLogWrite) {
      }

      const writeStartedAt = performance.now();
      outputWriteInFlight = true;
      const handleTerminalWriteComplete = () => {
        outputWriteInFlight = false;
        const writeCallbackMs = performance.now() - writeStartedAt;
        const elapsedMs = performance.now() - flushStartedAt;
        if (terminalDiagnosticsEnabled) {
          outputDiagnosticWriteCallbackMs += writeCallbackMs;
          outputDiagnosticWriteCallbackMaxMs = Math.max(
            outputDiagnosticWriteCallbackMaxMs,
            writeCallbackMs,
          );
          if (performance.now() - outputDiagnosticWindowStartedAt >= TERMINAL_OUTPUT_DIAGNOSTIC_WINDOW_MS) {
            flushOutputDiagnosticWindow("write_callback");
          }
        }
        logTerminalDiagnosticEvent(
          "frontend.output_write.slow",
          {
            batchBytes,
            combineMs,
            debugMs,
            elapsedMs,
            isFirstOutputChunk,
            isFirstVisibleOutputChunk,
            paneId,
            queuedMs,
            reason,
            rendererMode,
            terminalIndex,
            visibleChars: outputDebug.visibleChars,
            writeCallbackMs,
            writes: writes.length,
          },
          { minElapsedMs: TERMINAL_OUTPUT_WRITE_DIAGNOSTIC_SLOW_MS },
        );
        if (isDisposed) {
          return;
        }

        if (pendingOutputWrites.length) {
          scheduleTerminalOutputBatchFlush();
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
      };

      try {
        terminal.write(batchData, handleTerminalWriteComplete);
      } catch (error) {
        outputWriteInFlight = false;
        logTerminalDiagnosticEvent("frontend.output_write.error", {
          batchBytes,
          message: error?.message || String(error || "terminal write failed"),
          paneId,
          reason,
          rendererMode,
          terminalIndex,
          writes: writes.length,
        });
        if (pendingOutputWrites.length) {
          scheduleTerminalOutputBatchFlush();
        }
      }
    };

    const scheduleTerminalOutputBatchFlush = () => {
      terminalGlobalRenderScheduler.request(renderSchedulerId);
    };

    terminalGlobalRenderScheduler.register({
      flush: (reason) => flushTerminalOutputBatch(reason),
      getPendingBytes: () => pendingOutputBytes,
      getQueuedAt: () => outputBatchQueuedAt,
      hasPending: () => !isDisposed && !outputWriteInFlight && pendingOutputWrites.length > 0,
      id: renderSchedulerId,
      isActive: () => terminalActiveRef.current,
    });
    disposables.push(() => terminalGlobalRenderScheduler.unregister(renderSchedulerId));

    const writeTerminalOutput = (data, options = {}) => {
      if (isDisposed || !data?.byteLength) {
        return;
      }

      const isFirstOutputChunk = options.isFirstOutputChunk === true;
      const isFirstVisibleOutputChunk = options.isFirstVisibleOutputChunk === true;
      const outputDebug = options.outputDebug || {
        visibleChars: getTerminalOutputVisibleCharCount(data),
      };

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
        scheduleTerminalOutputBatchFlush();
        return;
      }

      scheduleTerminalOutputBatchFlush();
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

        rememberWindowsTerminalResizeDone(event);
        patchTerminalMetrics({
          gridMs: event.elapsedMs,
          resizeLagMs: event.elapsedMs,
        });
        addTerminalMetrics({
          resizeBatches: 1,
          resizePanes: 1,
        });
      },
      onError: () => {
        if (windowsTerminalResizeLiveClearTimer) {
          window.clearTimeout(windowsTerminalResizeLiveClearTimer);
          startupMetricTimers.delete(windowsTerminalResizeLiveClearTimer);
          windowsTerminalResizeLiveClearTimer = 0;
        }
        windowsTerminalResizeLiveClearWritesInFlight = 0;
        windowsTerminalResizeLiveClearPendingEvent = null;
        windowsTerminalResizeStartState = null;
      },
      onStart: (event) => {
        rememberWindowsTerminalResizeStart(event);
      },
      paneId: () => paneId,
      term: terminal,
    });
    resizeControllerRef.current = resizeController;
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

          const chunkStartedAt = performance.now();
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

          const maskStartedAt = performance.now();
          const displayData = outputDisplayMasker.maskBytes(data);
          const maskMs = performance.now() - maskStartedAt;
          if (!displayData.byteLength) {
            return;
          }

          const isFirstOutputChunk = !sawFirstOutput;
          outputChunks += 1;
          outputBytes += displayData.byteLength;
          const outputByteStats = terminalDiagnosticsEnabled
            ? getTerminalOutputByteStats(displayData)
            : null;
          const visibleChars = outputByteStats
            ? outputByteStats.visibleChars
            : getTerminalOutputVisibleCharCount(displayData, 1);
          const hasVisibleOutput = visibleChars > 0;
          const isFirstVisibleOutputChunk = hasVisibleOutput && !sawFirstVisibleOutput;
          const shouldCollectOutputDebug = isFirstOutputChunk
            || isFirstVisibleOutputChunk;
          const debugStartedAt = shouldCollectOutputDebug ? performance.now() : 0;
          const outputDebug = shouldCollectOutputDebug
            ? getTerminalOutputDebugFields(displayData)
            : { visibleChars };
          const debugMs = shouldCollectOutputDebug ? performance.now() - debugStartedAt : 0;
          if (terminalDiagnosticsEnabled) {
            outputDiagnosticChunks += 1;
            outputDiagnosticInputBytes += data.byteLength;
            outputDiagnosticDisplayBytes += displayData.byteLength;
            outputDiagnosticVisibleChars += outputByteStats.visibleChars;
            outputDiagnosticEscapeBytes += outputByteStats.escapeBytes;
            outputDiagnosticControlBytes += outputByteStats.controlBytes;
            outputDiagnosticMaskMs += maskMs;
            outputDiagnosticMaskMaxMs = Math.max(outputDiagnosticMaskMaxMs, maskMs);
            outputDiagnosticDebugMs += debugMs;
            outputDiagnosticDebugMaxMs = Math.max(outputDiagnosticDebugMaxMs, debugMs);
            if (hasVisibleOutput) {
              outputDiagnosticVisibleChunks += 1;
            }
            if (performance.now() - outputDiagnosticWindowStartedAt >= TERMINAL_OUTPUT_DIAGNOSTIC_WINDOW_MS) {
              flushOutputDiagnosticWindow("chunk");
            }
          }

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

          logTerminalDiagnosticEvent(
            "frontend.output_chunk.slow",
            {
              debugMs,
              displayBytes: displayData.byteLength,
              elapsedMs: performance.now() - chunkStartedAt,
              inputBytes: data.byteLength,
              isFirstOutputChunk,
              isFirstVisibleOutputChunk,
              maskMs,
              outputChunks,
              paneId,
              rendererMode,
              terminalIndex,
              visibleChars: outputDebug.visibleChars,
            },
            { minElapsedMs: TERMINAL_OUTPUT_CHUNK_DIAGNOSTIC_SLOW_MS },
          );

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
        disposables.push(await listen(TERMINAL_INPUT_ERROR_EVENT, (event) => {
          if (
            event.payload?.paneId === paneId
            && event.payload?.instanceId === terminalInstanceId
            && !isDisposed
          ) {
            setTerminalError(getErrorMessage(event.payload?.message, "Unable to write to terminal."));
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

              return emit(TERMINAL_INPUT_EVENT, {
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

          if (!isGenericTerminal) {
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
        await loadWindowsTerminalPtyInfo();

        if (isDisposed) {
          return;
        }

        const rendererOpened = await waitForTerminalRendererOpen("terminal_open");

        if (isDisposed || !rendererOpened) {
          return;
        }

        const initialSize = await waitForTerminalSizeForOpen("terminal_open");

        if (isDisposed || !initialSize) {
          return;
        }

        if (terminal.cols !== initialSize.cols || terminal.rows !== initialSize.rows) {
          terminal.resize(initialSize.cols, initialSize.rows);
        }

        if (TERMINAL_IS_WINDOWS_HOST) {
          setPaneStage("starting", "Measuring Terminal", "Stabilizing renderer geometry.");
          await waitForWindowsTerminalGeometrySettled("terminal_open", initialSize);
        }

        if (isDisposed) {
          return;
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
              detail: "Initial protected session setup is still running.",
              mode: "detail",
              title: "Preparing Protected Session",
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
        const startupMs = performance.now() - openStartedAt;
        patchTerminalMetrics({ startupMs });
        logTerminalDiagnosticEvent("frontend.terminal_open.done", {
          agentStarted: !shouldPrewarmShell,
          paneId,
          rendererMode,
          startupMs,
          terminalIndex,
        });
        resizeController?.resizeNow("terminal_open_done");

        scheduleWebglAttach("idle", TERMINAL_WEBGL_IDLE_DELAY_MS);

        focusTerminalKeyboardInput();

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
      if (resizeControllerRef.current === resizeController) {
        resizeControllerRef.current = null;
      }
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
  }, [activateTerminalPane, agent?.id, agent?.label, focusTerminalKeyboardInput, isGenericTerminal, onPreparedTerminalChange, paneId, requestTerminalAudioInputTarget, restartKey, terminalClosed, terminalRoleId, useWebglRenderer, workingDirectory, workspace?.id]);

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

    const relatedTarget = event.relatedTarget;
    if (
      relatedTarget
      && typeof relatedTarget === "object"
      && "nodeType" in relatedTarget
      && event.currentTarget?.contains?.(relatedTarget)
    ) {
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
        data: `${prompt}${isGenericTerminal ? "" : "\r"}`,
      });
    } catch (error) {
      setTerminalError(getErrorMessage(error, "Unable to send terminal input."));
    }
  }, [isGenericTerminal, paneId, terminalClosed, terminalClosing]);

  const pointerTodoDropVisible = Boolean(todoDropActive) && !terminalClosed && !terminalClosing;
  const nativeTodoDropVisible = terminalDropActive && !terminalClosed && !terminalClosing;
  const todoDropOverlayVisible = pointerTodoDropVisible || nativeTodoDropVisible;
  const todoDropOverlayTarget = nativeTodoDropVisible || Boolean(todoDropTarget);

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

    const cancelledPrompt = parkedPrompt;
    const promptKey = `${Number(cancelledPrompt.instanceId || 0)}:${cancelledPrompt.taskId}`;
    cancellingParkedPromptKeysRef.current.add(promptKey);
    setTerminalError("");
    setParkedPrompt(null);
    parkedPromptRef.current = null;
    updateTerminalInteractiveState(terminalActiveRef.current, false);
    focusTerminalKeyboardInput(true);
    try {
      await invoke("terminal_cancel_parked_task", {
        paneId,
        instanceId: cancelledPrompt.instanceId,
        taskId: cancelledPrompt.taskId,
      });
    } catch (error) {
      cancellingParkedPromptKeysRef.current.delete(promptKey);
      setParkedPrompt(cancelledPrompt);
      setTerminalError(getErrorMessage(error, "Unable to cancel parked task."));
    }
  }, [focusTerminalKeyboardInput, paneId, parkedPrompt, updateTerminalInteractiveState]);

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

  const canSplitTerminal = terminalCount < MAX_WORKSPACE_TERMINAL_COUNT;
  const splitTerminal = useCallback((direction) => {
    if (terminalClosed || terminalClosing || !canSplitTerminal) {
      return;
    }

    onSplitTerminal?.({
      direction,
      paneId,
      terminalIndex,
      workspaceId: workspace?.id || "",
    });
  }, [
    canSplitTerminal,
    onSplitTerminal,
    paneId,
    terminalClosed,
    terminalClosing,
    terminalIndex,
    workspace?.id,
  ]);
  const splitTerminalHorizontal = useCallback(() => {
    splitTerminal("vertical");
  }, [splitTerminal]);
  const splitTerminalVertical = useCallback(() => {
    splitTerminal("horizontal");
  }, [splitTerminal]);
  const toggleTerminalFullscreen = useCallback(() => {
    if (terminalClosed || terminalClosing) {
      return;
    }

    const surfaceElement = surfaceRef.current;
    const panelElement = surfaceElement?.parentElement || null;

    onToggleFullscreenTerminal?.({
      panelRect: getPlainDomRect(panelElement?.getBoundingClientRect?.()),
      paneId,
      surfaceRect: getPlainDomRect(surfaceElement?.getBoundingClientRect?.()),
      terminalIndex,
      workspaceId: workspace?.id || "",
    });
  }, [
    onToggleFullscreenTerminal,
    paneId,
    terminalClosed,
    terminalClosing,
    terminalIndex,
    workspace?.id,
  ]);
  const beginTerminalDrag = useCallback((event) => {
    if (
      terminalClosed
      || terminalClosing
      || isFullscreen
      || terminalCount <= 1
      || event.button !== 0
    ) {
      return;
    }

    const surfaceElement = surfaceRef.current;
    const panelElement = surfaceElement?.parentElement || null;

    event.preventDefault();
    event.stopPropagation();

    onBeginTerminalDrag?.({
      clientX: event.clientX,
      clientY: event.clientY,
      paneId,
      panelRect: getPlainDomRect(panelElement?.getBoundingClientRect?.()),
      pointerId: event.pointerId,
      surfaceRect: getPlainDomRect(surfaceElement?.getBoundingClientRect?.()),
      terminalIndex,
      workspaceId: workspace?.id || "",
    });
  }, [
    isFullscreen,
    onBeginTerminalDrag,
    paneId,
    terminalClosed,
    terminalClosing,
    terminalCount,
    terminalIndex,
    workspace?.id,
  ]);

  const terminalStatusErrorDetails = [
    workspaceError,
    terminalError,
    agentStatusError,
  ].filter(Boolean);
  const hasTerminalStatusError = terminalStatusErrorDetails.length > 0;
  const isTerminalStatusErrorOverlay = hasTerminalStatusError || terminalState === "error";
  const showTerminalStatusOverlay = Boolean(
    (isTerminalStatusErrorOverlay || terminalStatus?.visible)
    && !terminalClosed
    && !terminalClosing
    && !parkedPrompt,
  );
  const terminalStatusTitle = terminalError
    ? "Terminal Launch Failed"
    : hasTerminalStatusError
      ? "Terminal Error"
      : terminalStatus?.title || "Preparing Terminal";
  const terminalStatusDetails = hasTerminalStatusError
    ? terminalStatusErrorDetails
    : terminalStatus?.detail
      ? [terminalStatus.detail]
      : [];
  const terminalStatusMode = isTerminalStatusErrorOverlay
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
      data-terminal-fullscreen={isFullscreen ? "true" : undefined}
      data-terminal-fullscreen-state={isFullscreen ? fullscreenState : undefined}
      data-terminal-index={terminalIndex}
      onFocusCapture={handleTerminalSurfaceFocusCapture}
      onPointerDownCapture={handleTerminalSurfacePointerDownCapture}
      ref={surfaceRef}
    >
      <TerminalRestartPill data-terminal-control="true">
        <TerminalAgentDot
          aria-hidden="true"
          data-agent={terminalAgentKind}
          data-slot={getTerminalAgentColorSlot(terminalIndex)}
          title={terminalAgentTitle}
        />
        <TerminalRestartButton
          aria-label="Drag terminal"
          data-terminal-drag-handle="true"
          disabled={terminalClosed || terminalClosing || isFullscreen || terminalCount <= 1}
          onPointerDown={beginTerminalDrag}
          title={isFullscreen ? "Exit fullscreen to reorder terminals" : "Drag terminal"}
          type="button"
        >
          <ButtonDragIcon aria-hidden="true" />
        </TerminalRestartButton>
        <TerminalRestartButton
          aria-label="Split terminal horizontally"
          disabled={terminalClosed || terminalClosing || !canSplitTerminal}
          onClick={splitTerminalHorizontal}
          title={canSplitTerminal ? "Split terminal horizontally" : "Terminal limit reached"}
          type="button"
        >
          <ButtonSplitHorizontalIcon aria-hidden="true" />
        </TerminalRestartButton>
        <TerminalRestartButton
          aria-label="Split terminal vertically"
          disabled={terminalClosed || terminalClosing || !canSplitTerminal}
          onClick={splitTerminalVertical}
          title={canSplitTerminal ? "Split terminal vertically" : "Terminal limit reached"}
          type="button"
        >
          <ButtonSplitVerticalIcon aria-hidden="true" />
        </TerminalRestartButton>
        <TerminalRestartButton
          aria-label={isFullscreen ? "Exit terminal fullscreen" : "Make terminal fullscreen"}
          disabled={terminalClosed || terminalClosing}
          onClick={toggleTerminalFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Make terminal fullscreen"}
          type="button"
        >
          {isFullscreen ? (
            <ButtonFullscreenExitIcon aria-hidden="true" />
          ) : (
            <ButtonFullscreenIcon aria-hidden="true" />
          )}
        </TerminalRestartButton>
        <TerminalRestartMenu
          data-terminal-control="true"
          ref={restartMenuRef}
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

      <TerminalFrame
        aria-busy={terminalClosing ? "true" : "false"}
        data-state={terminalState}
        data-drop-active={todoDropOverlayTarget ? "true" : "false"}
        onDragEnter={handleTerminalTodoDragEnter}
        onDragLeave={handleTerminalTodoDragLeave}
        onDragOver={handleTerminalTodoDragOver}
        onDrop={handleTerminalTodoDrop}
      >
        {terminalClosed ? (
          <TerminalClosedSurface aria-live="polite" role="status">
            <TerminalClosedLabel>Terminal Closed</TerminalClosedLabel>
          </TerminalClosedSurface>
        ) : (
          <>
            <XtermSurface
              data-active={terminalFocused ? "true" : "false"}
              data-scrollbar-platform={TERMINAL_SCROLLBAR_PLATFORM}
              data-parked={parkedPrompt ? "true" : "false"}
              onDragEnter={handleTerminalTodoDragEnter}
              onDragLeave={handleTerminalTodoDragLeave}
              onDragOver={handleTerminalTodoDragOver}
              onDrop={handleTerminalTodoDrop}
              ref={containerRef}
            />
            {showTerminalStatusOverlay && (
              <TerminalStatusOverlay
                aria-live={isTerminalStatusErrorOverlay ? "assertive" : "polite"}
                data-copyable={isTerminalStatusErrorOverlay ? "true" : "false"}
                data-mode={terminalStatusMode}
                data-terminal-control={isTerminalStatusErrorOverlay ? "true" : undefined}
                data-tone={isTerminalStatusErrorOverlay ? "error" : "neutral"}
                role="status"
              >
                <div>
                  {!isTerminalStatusErrorOverlay && <TerminalStatusSpinner aria-hidden="true" />}
                  {terminalStatusMode !== "compact" && (
                    <TerminalStatusCopy>
                      <strong>{terminalStatusTitle}</strong>
                      {terminalStatusDetails.map((detail, index) => (
                        <span key={`${detail}-${index}`}>{detail}</span>
                      ))}
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
              <TerminalParkedBar aria-live="polite" data-terminal-control="true" role="status">
                <TerminalParkedSpinner aria-hidden="true" />
                <TerminalParkedCopy>
                  <strong>Parked: {parkedPrompt.title || "Waiting for dependency"}</strong>
                  <span>
                    Waiting on{" "}
                    <TerminalParkedAgents>
                      {(parkedPrompt.waitingOn || []).length
                        ? parkedPrompt.waitingOn.map((agent, index) => (
                          <TerminalParkedAgentBadge key={`${agent.agentId || agent.agentLabel || "agent"}-${index}`}>
                            {agent.agentLabel || "agent"}
                          </TerminalParkedAgentBadge>
                        ))
                        : <TerminalParkedAgentBadge>peer</TerminalParkedAgentBadge>}
                    </TerminalParkedAgents>
                  </span>
                </TerminalParkedCopy>
                <TerminalParkedCancelButton data-terminal-control="true" onClick={cancelParkedPrompt} type="button">
                  Cancel task
                </TerminalParkedCancelButton>
              </TerminalParkedBar>
            )}
            {todoDropOverlayVisible && (
              <div
                style={{
                  ...TODO_DROP_OVERLAY_STYLE,
                  ...(todoDropOverlayTarget ? TODO_DROP_OVERLAY_TARGET_STYLE : {}),
                }}
              >
                {todoDropOverlayTarget && (
                  <div style={TODO_DROP_OVERLAY_LABEL_STYLE}>Drop here</div>
                )}
              </div>
            )}
          </>
        )}
      </TerminalFrame>
    </TerminalWorkspaceSurface>
  );
}

export default memo(WorkspaceTerminal);

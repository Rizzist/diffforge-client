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
import {
  TERMINAL_IS_MACOS_HOST,
  TERMINAL_IS_WINDOWS_HOST,
  TERMINAL_SCROLL_STABILITY_MODE_NORMALIZER,
  TERMINAL_WINDOWS_INTERESTING_DEC_PRIVATE_MODES,
  TERMINAL_WINDOWS_PTY_BACKEND,
  buildWindowsPtyOptions,
  createTerminalOutputNormalizer,
  getTerminalAgentScrollStabilityMode,
  normalizeTerminalOutputBytes,
} from "./terminalScrollStabilityStrategies.jsx";

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
const TERMINAL_SCROLLBAR_PLATFORM = "native";
const TERMINAL_ROLE_SWITCH_OPTIONS = [
  { id: "codex", label: "Codex"},
  { id: "claude", label: "Claude Code" },
  { id: "generic", label: "Terminal" },
  { id: "opencode", label: "OpenCode" },
];
const TERMINAL_CONTROL_SELECTOR = "[data-terminal-control='true']";
const TERMINAL_FULLSCREEN_RESIZE_DELAYS_MS = [0, 80, 190, 280];
const TERMINAL_CODEX_RESIZE_GATE_SETTLE_MS = 140;
const TERMINAL_CODEX_RESIZE_GATE_RETRY_MS = 48;
const TERMINAL_CODEX_RESIZE_GATE_MAX_MS = 900;
const TERMINAL_CODEX_RESIZE_GATE_MAX_BYTES = 768 * 1024;
const TERMINAL_CODEX_RESIZE_REPAINT_MIN_BYTES = 180;
const TERMINAL_CODEX_RESIZE_PAINT_PROBE_WINDOW_MS = 5000;
const TERMINAL_CODEX_RESIZE_PAINT_PROBE_DELAYS_MS = [0, 34, 120, 320];
const TERMINAL_CODEX_RESIZE_OUTPUT_PROBE_THROTTLE_MS = 160;
const TERMINAL_CODEX_RESIZE_SCROLLBACK_CLEANUP_MS = 900;
const TERMINAL_CODEX_RESIZE_TOP_ARTIFACT_LOOKAHEAD_ROWS = 24;
const TERMINAL_CODEX_RESIZE_TOP_BLANK_PREFIX_MAX_ROWS = 4;
const TERMINAL_CODEX_RESIZE_ARTIFACT_PURGE_MAX_ROWS = 64;
const TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_MS = 1200;
const TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_DELAYS_MS = [0, 16, 50, 140, 320, 700];
const TERMINAL_CODEX_RESIZE_LIVE_TAIL_PRESERVE_ROWS_BELOW_COMPOSER = 2;
const TERMINAL_RENDERER_DOM_ROW_SNAPSHOT_LIMIT = 10;
const TERMINAL_DEC2026_SET_BYTES = new Uint8Array([0x1b, 0x5b, 0x3f, 0x32, 0x30, 0x32, 0x36, 0x68]);
const TERMINAL_DEC2026_RESET_BYTES = new Uint8Array([0x1b, 0x5b, 0x3f, 0x32, 0x30, 0x32, 0x36, 0x6c]);

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

function findTerminalByteSequence(data, sequence, fromIndex = 0) {
  if (!data?.length || !sequence?.length || sequence.length > data.length) {
    return -1;
  }

  const maxStart = data.length - sequence.length;
  for (let index = Math.max(0, fromIndex); index <= maxStart; index += 1) {
    let matched = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (data[index + offset] !== sequence[offset]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      return index;
    }
  }

  return -1;
}

function concatTerminalByteArrays(chunks) {
  const totalBytes = chunks.reduce((total, chunk) => total + Number(chunk?.byteLength || 0), 0);
  const combined = new Uint8Array(totalBytes);
  let offset = 0;

  chunks.forEach((chunk) => {
    if (!chunk?.byteLength) {
      return;
    }

    combined.set(chunk, offset);
    offset += chunk.byteLength;
  });

  return combined;
}

function coalesceCodexResizeRepaintBytes(data) {
  if (!data?.byteLength) {
    return {
      data,
      droppedBytes: 0,
      framesDropped: 0,
      framesSeen: 0,
    };
  }

  const frames = [];
  let searchIndex = 0;

  while (searchIndex < data.length) {
    const start = findTerminalByteSequence(data, TERMINAL_DEC2026_SET_BYTES, searchIndex);
    if (start < 0) {
      break;
    }

    const reset = findTerminalByteSequence(
      data,
      TERMINAL_DEC2026_RESET_BYTES,
      start + TERMINAL_DEC2026_SET_BYTES.length,
    );
    if (reset < 0) {
      break;
    }

    const end = reset + TERMINAL_DEC2026_RESET_BYTES.length;
    frames.push({ end, start });
    searchIndex = end;
  }

  if (frames.length <= 1) {
    return {
      data,
      droppedBytes: 0,
      framesDropped: 0,
      framesSeen: frames.length,
    };
  }

  let selectedFrameIndex = frames.length - 1;
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    const frame = frames[index];
    if (frame.end - frame.start >= TERMINAL_CODEX_RESIZE_REPAINT_MIN_BYTES) {
      selectedFrameIndex = index;
      break;
    }
  }

  const selectedFrame = frames[selectedFrameIndex];
  const output = data.slice(selectedFrame.start);

  return {
    data: output,
    droppedBytes: selectedFrame.start,
    framesDropped: selectedFrameIndex,
    framesSeen: frames.length,
  };
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

function hashTerminalDiagnosticText(value) {
  const text = String(value || "");
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sanitizeTerminalDiagnosticText(value, maxLength = 140) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trimEnd()
    .slice(0, maxLength);
}

function getTerminalRowTextDiagnostic(terminal, rowIndex) {
  const line = terminal?.buffer?.active?.getLine?.(rowIndex);
  const text = line?.translateToString?.(false) || "";
  const trimmed = text.trimEnd();

  return {
    hash: hashTerminalDiagnosticText(trimmed),
    isBlank: trimmed.trim().length <= 0,
    isWrapped: Boolean(line?.isWrapped),
    rowIndex: Math.max(0, Math.floor(Number(rowIndex || 0))),
    text: sanitizeTerminalDiagnosticText(trimmed),
    textLength: trimmed.length,
  };
}

function getTerminalRowsTextDiagnostic(terminal, startIndex, rowCount) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      available: false,
      rows: [],
    };
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const start = Math.max(0, Math.min(bufferLength, Math.floor(Number(startIndex || 0))));
  const count = Math.max(1, Math.floor(Number(rowCount || 1)));
  const end = Math.max(start, Math.min(bufferLength, start + count));
  const rows = [];
  let blankRows = 0;
  let nonEmptyRows = 0;

  for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);
    rows.push({
      ...row,
      offset: rowIndex - start,
    });

    if (row.isBlank) {
      blankRows += 1;
    } else {
      nonEmptyRows += 1;
    }
  }

  return {
    available: true,
    blankRows,
    bufferLength,
    end,
    nonEmptyRows,
    rowCount: rows.length,
    rows,
    start,
  };
}

function getTerminalBufferRowsDiagnostic(terminal, startIndex, rowCount) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      available: false,
      rowHashes: [],
    };
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const start = Math.max(0, Math.min(bufferLength, Math.floor(Number(startIndex || 0))));
  const count = Math.max(1, Math.floor(Number(rowCount || terminal?.rows || TERMINAL_DEFAULT_ROWS)));
  const end = Math.max(start, Math.min(bufferLength, start + count));
  const rowHashes = [];
  let aggregateHash = "811c9dc5";
  let blankPrefixRows = 0;
  let blankSuffixRows = 0;
  let firstNonEmptyRow = -1;
  let lastNonEmptyRow = -1;
  let nonEmptyRows = 0;
  let wrappedRows = 0;

  for (let index = start; index < end; index += 1) {
    const line = buffer.getLine?.(index);
    const text = line?.translateToString?.(false) || "";
    const trimmed = text.trimEnd();
    const rowHash = hashTerminalDiagnosticText(trimmed);
    const isNonEmpty = trimmed.trim().length > 0;

    rowHashes.push(rowHash);
    aggregateHash = hashTerminalDiagnosticText(`${aggregateHash}:${rowHash}:${line?.isWrapped ? 1 : 0}`);

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
    const trimmed = (line?.translateToString?.(false) || "").trimEnd();
    if (trimmed.trim().length > 0) {
      break;
    }
    blankSuffixRows += 1;
  }

  return {
    aggregateHash,
    available: true,
    baseY: Number(buffer.baseY || 0),
    blankPrefixRows,
    blankSuffixRows,
    bufferLength,
    cursorX: Number(buffer.cursorX || 0),
    cursorY: Number(buffer.cursorY || 0),
    end,
    firstNonEmptyRow,
    lastNonEmptyRow,
    nonEmptyRows,
    rowCount: end - start,
    rowHashes,
    start,
    viewportY: Number(buffer.viewportY || 0),
    wrappedRows,
  };
}

function getTerminalRowFingerprint(terminal, rowIndex) {
  const line = terminal?.buffer?.active?.getLine?.(rowIndex);
  const text = line?.translateToString?.(false) || "";
  const trimmed = text.trimEnd();
  const semanticHash = hashTerminalDiagnosticText(trimmed);

  return {
    hash: hashTerminalDiagnosticText(`${semanticHash}:${line?.isWrapped ? 1 : 0}`),
    isNonEmpty: trimmed.trim().length > 0,
    isWrapped: Boolean(line?.isWrapped),
    semanticHash,
    textLength: trimmed.length,
  };
}

function getTerminalViewportAnchorDiagnostic(terminal, maxAnchorRows = 6) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      available: false,
      rows: [],
    };
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const terminalRows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const viewportY = Math.max(0, Math.min(bufferLength, Number(buffer.viewportY || 0)));
  const visibleEnd = Math.max(viewportY, Math.min(bufferLength, viewportY + terminalRows));
  const rows = [];

  for (let index = viewportY; index < visibleEnd && rows.length < maxAnchorRows; index += 1) {
    const fingerprint = getTerminalRowFingerprint(terminal, index);
    if (!fingerprint.isNonEmpty) {
      continue;
    }

    rows.push({
      hash: fingerprint.hash,
      isWrapped: fingerprint.isWrapped,
      offset: index - viewportY,
      semanticHash: fingerprint.semanticHash,
      textLength: fingerprint.textLength,
    });
  }

  return {
    available: rows.length > 0,
    baseY: Number(buffer.baseY || 0),
    bufferLength,
    firstOffset: rows[0]?.offset ?? 0,
    maxOffset: rows.reduce((max, row) => Math.max(max, Number(row.offset || 0)), 0),
    rowCount: rows.length,
    rows,
    terminalRows,
    viewportY,
  };
}

function scoreTerminalViewportAnchorAt(terminal, anchor, candidateViewportY) {
  const anchorRows = Array.isArray(anchor?.rows) ? anchor.rows : [];
  if (!anchorRows.length) {
    return {
      matches: 0,
      requiredMatches: 1,
    };
  }

  let matches = 0;
  anchorRows.forEach((anchorRow) => {
    const rowIndex = candidateViewportY + Number(anchorRow.offset || 0);
    const fingerprint = getTerminalRowFingerprint(terminal, rowIndex);
    if (
      fingerprint.hash === anchorRow.hash
      && fingerprint.isWrapped === anchorRow.isWrapped
    ) {
      matches += 1;
    }
  });

  return {
    matches,
    requiredMatches: Math.min(3, Math.max(1, anchorRows.length)),
  };
}

function findTerminalViewportAnchorMatch(terminal, anchor, preferredViewportY) {
  const buffer = terminal?.buffer?.active;
  const anchorRows = Array.isArray(anchor?.rows) ? anchor.rows : [];

  if (!buffer || !anchor?.available || !anchorRows.length) {
    return {
      matched: false,
      matches: 0,
      preferredViewportY: 0,
      viewportY: -1,
    };
  }

  const baseY = Math.max(0, Number(buffer.baseY || 0));
  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const maxOffset = Math.max(0, Number(anchor.maxOffset || 0));
  const maxCandidate = Math.max(0, Math.min(baseY, bufferLength - maxOffset - 1));
  const preferred = Math.max(0, Math.min(maxCandidate, Math.floor(Number(preferredViewportY || 0))));
  const requiredMatches = Math.min(3, Math.max(1, anchorRows.length));
  let best = null;

  const consider = (candidateViewportY) => {
    const candidate = Math.max(0, Math.min(maxCandidate, Math.floor(Number(candidateViewportY || 0))));
    const score = scoreTerminalViewportAnchorAt(terminal, anchor, candidate);
    if (score.matches < requiredMatches) {
      return;
    }

    const distance = Math.abs(candidate - preferred);
    if (
      !best
      || score.matches > best.matches
      || (score.matches === best.matches && distance < best.distance)
    ) {
      best = {
        distance,
        matches: score.matches,
        viewportY: candidate,
      };
    }
  };

  const nearStart = Math.max(0, preferred - 40);
  const nearEnd = Math.min(maxCandidate, preferred + 40);
  for (let candidate = nearStart; candidate <= nearEnd; candidate += 1) {
    consider(candidate);
  }

  if (!best) {
    for (let candidate = 0; candidate <= maxCandidate; candidate += 1) {
      if (candidate >= nearStart && candidate <= nearEnd) {
        continue;
      }
      consider(candidate);
    }
  }

  if (!best) {
    return {
      matched: false,
      matches: 0,
      preferredViewportY: preferred,
      requiredMatches,
      viewportY: -1,
    };
  }

  return {
    distance: best.distance,
    matched: true,
    matches: best.matches,
    preferredViewportY: preferred,
    requiredMatches,
    viewportY: best.viewportY,
  };
}

function isCodexBannerTopBorderText(value) {
  const text = sanitizeTerminalDiagnosticText(value).trim();

  return /^╭[─\s]+╮?$/.test(text);
}

function isCodexBannerBottomBorderText(value) {
  const text = sanitizeTerminalDiagnosticText(value).trim();

  return /^╰[─\s]+╯?$/.test(text);
}

function isCodexBannerTitleText(value) {
  return /OpenAI Codex/.test(sanitizeTerminalDiagnosticText(value));
}

function isCodexResizeBannerArtifactText(value) {
  const text = sanitizeTerminalDiagnosticText(value).trim();

  return text.length <= 0
    || isCodexBannerTopBorderText(text)
    || isCodexBannerBottomBorderText(text)
    || isCodexBannerTitleText(text)
    || /^│\s*│?$/.test(text)
    || /^│\s*model:\s+/i.test(text)
    || /^│\s*directory:\s+/i.test(text)
    || /^│$/.test(text);
}

function getCodexResizeTopArtifactAdjustment(terminal, candidateViewportY) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      adjusted: false,
      reason: "buffer_unavailable",
      viewportY: Math.max(0, Math.floor(Number(candidateViewportY || 0))),
    };
  }

  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const baseY = Math.max(0, Math.min(bufferLength, Number(buffer.baseY || 0)));
  const terminalRows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const maxViewportY = Math.max(0, Math.min(baseY, bufferLength - 1));
  const viewportY = Math.max(0, Math.min(maxViewportY, Math.floor(Number(candidateViewportY || 0))));
  const distanceToLiveTop = baseY - viewportY;

  if (distanceToLiveTop <= 0) {
    return {
      adjusted: false,
      baseY,
      distanceToLiveTop,
      reason: "at_live_top",
      viewportY,
    };
  }

  if (distanceToLiveTop > terminalRows + 4) {
    return {
      adjusted: false,
      baseY,
      distanceToLiveTop,
      reason: "too_far_from_live_top",
      viewportY,
    };
  }

  const scanRows = Math.min(
    TERMINAL_CODEX_RESIZE_TOP_ARTIFACT_LOOKAHEAD_ROWS,
    Math.max(terminalRows, distanceToLiveTop + 8),
  );
  const scanEnd = Math.max(viewportY, Math.min(bufferLength, viewportY + scanRows));
  const preLiveBlankRows = [];
  const preLiveNonBlankRows = [];
  const preLiveTopBorderRows = [];
  const preLiveTitleRows = [];
  const liveTitleRows = [];

  for (let rowIndex = viewportY; rowIndex < scanEnd; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);

    if (rowIndex < baseY) {
      if (row.isBlank) {
        preLiveBlankRows.push(rowIndex);
      } else {
        preLiveNonBlankRows.push(rowIndex);
      }

      if (isCodexBannerTopBorderText(row.text)) {
        preLiveTopBorderRows.push(rowIndex);
      }
    }

    if (!isCodexBannerTitleText(row.text)) {
      continue;
    }

    if (rowIndex < baseY) {
      preLiveTitleRows.push(rowIndex);
    } else {
      liveTitleRows.push(rowIndex);
    }
  }

  const hasRepeatedTopBorders = preLiveTopBorderRows.length >= 2;
  const hasStrayTopBorderBeforeLive = preLiveTopBorderRows.length > 0 && liveTitleRows.length > 0;
  const hasBlankPrefixBeforeLive = preLiveBlankRows.length > 0
    && preLiveBlankRows.length <= TERMINAL_CODEX_RESIZE_TOP_BLANK_PREFIX_MAX_ROWS
    && preLiveNonBlankRows.length === 0
    && liveTitleRows.length > 0;
  const hasSplitBannerDuplicate = preLiveTitleRows.length > 0 && liveTitleRows.length > 0;

  if (
    !hasRepeatedTopBorders
    && !hasStrayTopBorderBeforeLive
    && !hasBlankPrefixBeforeLive
    && !hasSplitBannerDuplicate
  ) {
    return {
      adjusted: false,
      baseY,
      distanceToLiveTop,
      liveTitleRows,
      preLiveBlankRows,
      preLiveNonBlankRows,
      preLiveTitleRows,
      preLiveTopBorderRows,
      reason: "no_transient_banner_artifact",
      viewportY,
    };
  }

  return {
    adjusted: true,
    baseY,
    distanceToLiveTop,
    liveTitleRows,
    preLiveBlankRows,
    preLiveNonBlankRows,
    preLiveTitleRows,
    preLiveTopBorderRows,
    reason: hasRepeatedTopBorders
      ? "repeated_codex_banner_top_borders"
      : hasStrayTopBorderBeforeLive
        ? "stray_codex_banner_top_border_before_live"
        : hasBlankPrefixBeforeLive
          ? "blank_prefix_before_live_codex_banner"
          : "split_codex_banner_duplicate",
    viewportY: baseY,
    wasViewportY: viewportY,
  };
}

function getTerminalInternalActiveBuffer(terminal) {
  return terminal?._core?._bufferService?.buffer
    || terminal?._core?._bufferService?.buffers?.active
    || null;
}

function adjustTerminalRowAfterDeletion(rowIndex, deleteStart, deleteCount) {
  const row = Math.max(0, Math.floor(Number(rowIndex || 0)));
  const start = Math.max(0, Math.floor(Number(deleteStart || 0)));
  const count = Math.max(0, Math.floor(Number(deleteCount || 0)));
  const end = start + count;

  if (count <= 0 || row < start) {
    return row;
  }

  if (row < end) {
    return start;
  }

  return Math.max(0, row - count);
}

function getCodexResizeTopArtifactPurgePlan(terminal, topArtifactAdjustment) {
  const buffer = terminal?.buffer?.active;

  if (!buffer || !topArtifactAdjustment?.adjusted) {
    return {
      shouldPurge: false,
      reason: "not_adjusted",
    };
  }

  const baseY = Math.max(0, Math.floor(Number(topArtifactAdjustment.baseY || 0)));
  const start = Math.max(0, Math.floor(Number(
    topArtifactAdjustment.wasViewportY ?? topArtifactAdjustment.viewportY ?? 0,
  )));
  const rowCount = Math.max(0, baseY - start);

  if (rowCount <= 0) {
    return {
      shouldPurge: false,
      reason: "empty_range",
    };
  }

  if (rowCount > TERMINAL_CODEX_RESIZE_ARTIFACT_PURGE_MAX_ROWS) {
    return {
      shouldPurge: false,
      reason: "range_too_large",
      rowCount,
      start,
    };
  }

  const rows = [];
  const nonArtifactRows = [];
  let artifactRows = 0;
  let nonBlankRows = 0;

  for (let rowIndex = start; rowIndex < baseY; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);
    const isArtifact = isCodexResizeBannerArtifactText(row.text);
    rows.push(row);
    if (!row.isBlank) {
      nonBlankRows += 1;
    }
    if (isArtifact) {
      artifactRows += 1;
    } else {
      nonArtifactRows.push(row);
    }
  }

  if (nonArtifactRows.length > 0) {
    return {
      nonArtifactRows,
      reason: "range_contains_non_artifact_rows",
      rowCount,
      rows,
      shouldPurge: false,
      start,
    };
  }

  if (nonBlankRows <= 0 && !topArtifactAdjustment.liveTitleRows?.length) {
    return {
      reason: "blank_range_without_live_banner",
      rowCount,
      rows,
      shouldPurge: false,
      start,
    };
  }

  return {
    artifactRows,
    baseY,
    nonBlankRows,
    reason: topArtifactAdjustment.reason || "top_artifact",
    rowCount,
    rows,
    shouldPurge: true,
    start,
  };
}

function applyCodexResizeTopArtifactPurge(terminal, purgePlan) {
  if (!purgePlan?.shouldPurge) {
    return {
      purged: false,
      reason: purgePlan?.reason || "no_plan",
    };
  }

  const internalBuffer = getTerminalInternalActiveBuffer(terminal);
  const lines = internalBuffer?.lines;

  if (
    !internalBuffer
    || !lines
    || typeof lines.splice !== "function"
  ) {
    return {
      purged: false,
      reason: "internal_buffer_unavailable",
    };
  }

  const deleteStart = Math.max(0, Math.floor(Number(purgePlan.start || 0)));
  const deleteCount = Math.max(0, Math.floor(Number(purgePlan.rowCount || 0)));

  if (deleteCount <= 0 || deleteStart + deleteCount > Number(lines.length || 0)) {
    return {
      deleteCount,
      deleteStart,
      purged: false,
      reason: "invalid_delete_range",
    };
  }

  const beforeBaseY = Math.max(0, Number(internalBuffer.ybase || 0));
  const beforeViewportY = Math.max(0, Number(internalBuffer.ydisp || 0));
  const beforeSavedY = Math.max(0, Number(internalBuffer.savedY || 0));

  try {
    lines.splice(deleteStart, deleteCount);
    internalBuffer.ybase = adjustTerminalRowAfterDeletion(beforeBaseY, deleteStart, deleteCount);
    internalBuffer.ydisp = Math.min(
      internalBuffer.ybase,
      adjustTerminalRowAfterDeletion(beforeViewportY, deleteStart, deleteCount),
    );
    internalBuffer.savedY = adjustTerminalRowAfterDeletion(beforeSavedY, deleteStart, deleteCount);

    const bufferService = terminal?._core?._bufferService;
    try {
      bufferService?._onScroll?.fire?.(internalBuffer.ydisp);
    } catch (_error) {
    }

    return {
      afterBaseY: Number(internalBuffer.ybase || 0),
      afterViewportY: Number(internalBuffer.ydisp || 0),
      beforeBaseY,
      beforeViewportY,
      deleteCount,
      deleteStart,
      purged: true,
      reason: purgePlan.reason,
    };
  } catch (_error) {
    return {
      deleteCount,
      deleteStart,
      purged: false,
      reason: "delete_failed",
    };
  }
}

function getTerminalBottomBandDiagnostic(terminal) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      available: false,
    };
  }

  const terminalRows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const baseY = Math.max(0, Number(buffer.baseY || 0));
  const viewportY = Math.max(0, Number(buffer.viewportY || 0));
  const cursorX = Math.max(0, Number(buffer.cursorX || 0));
  const cursorY = Math.max(0, Number(buffer.cursorY || 0));
  const cursorAbsoluteRow = Math.max(0, Math.min(bufferLength - 1, baseY + cursorY));
  const liveEnd = Math.max(baseY, Math.min(bufferLength, baseY + terminalRows));
  const viewportEnd = Math.max(viewportY, Math.min(bufferLength, viewportY + terminalRows));
  const cursorWindowStart = Math.max(baseY, cursorAbsoluteRow - 5);
  const cursorWindowEnd = Math.min(liveEnd, cursorAbsoluteRow + 7);
  const liveTailStart = Math.max(baseY, liveEnd - 10);
  const viewportTailStart = Math.max(viewportY, viewportEnd - 10);
  let blankRowsBelowCursor = 0;
  let nonEmptyRowsBelowCursor = 0;
  let firstNonEmptyBelowCursor = -1;
  let lastNonEmptyBelowCursor = -1;

  for (let rowIndex = cursorAbsoluteRow + 1; rowIndex < liveEnd; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);
    if (row.isBlank) {
      blankRowsBelowCursor += 1;
    } else {
      nonEmptyRowsBelowCursor += 1;
      if (firstNonEmptyBelowCursor < 0) {
        firstNonEmptyBelowCursor = rowIndex;
      }
      lastNonEmptyBelowCursor = rowIndex;
    }
  }

  return {
    available: true,
    baseY,
    blankRowsBelowCursor,
    bufferLength,
    cursorAbsoluteRow,
    cursorLine: getTerminalRowTextDiagnostic(terminal, cursorAbsoluteRow),
    cursorWindow: getTerminalRowsTextDiagnostic(terminal, cursorWindowStart, cursorWindowEnd - cursorWindowStart),
    cursorX,
    cursorY,
    firstNonEmptyBelowCursor,
    lastNonEmptyBelowCursor,
    liveEnd,
    liveTail: getTerminalRowsTextDiagnostic(terminal, liveTailStart, liveEnd - liveTailStart),
    nonEmptyRowsBelowCursor,
    terminalRows,
    viewportEnd,
    viewportTail: getTerminalRowsTextDiagnostic(terminal, viewportTailStart, viewportEnd - viewportTailStart),
    viewportY,
  };
}

function getTerminalTopBandDiagnostic(terminal) {
  const buffer = terminal?.buffer?.active;

  if (!buffer) {
    return {
      available: false,
    };
  }

  const terminalRows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const bufferLength = Math.max(0, Number(buffer.length || 0));
  const baseY = Math.max(0, Number(buffer.baseY || 0));
  const viewportY = Math.max(0, Number(buffer.viewportY || 0));
  const cursorX = Math.max(0, Number(buffer.cursorX || 0));
  const cursorY = Math.max(0, Number(buffer.cursorY || 0));
  const sampleRows = Math.min(12, terminalRows);
  const viewportTop = getTerminalRowsTextDiagnostic(terminal, viewportY, sampleRows);
  const liveTop = getTerminalRowsTextDiagnostic(terminal, baseY, sampleRows);
  const viewportTexts = Array.isArray(viewportTop.rows)
    ? viewportTop.rows.map((row) => row.text)
    : [];
  const liveTexts = Array.isArray(liveTop.rows)
    ? liveTop.rows.map((row) => row.text)
    : [];
  const viewportCodexBannerRows = (viewportTop.rows || [])
    .filter((row) => /OpenAI Codex/.test(row.text || ""))
    .map((row) => row.rowIndex);
  const liveCodexBannerRows = (liveTop.rows || [])
    .filter((row) => /OpenAI Codex/.test(row.text || ""))
    .map((row) => row.rowIndex);

  return {
    available: true,
    baseMinusViewport: baseY - viewportY,
    baseY,
    bufferLength,
    cursorX,
    cursorY,
    liveCodexBannerRows,
    liveTop,
    liveTopTextHash: hashTerminalDiagnosticText(liveTexts.join("\n")),
    sampleRows,
    terminalRows,
    viewportCodexBannerRows,
    viewportTop,
    viewportTopTextHash: hashTerminalDiagnosticText(viewportTexts.join("\n")),
    viewportY,
  };
}

function isCodexComposerPromptText(value) {
  return sanitizeTerminalDiagnosticText(value).trimStart().startsWith("›");
}

function isCodexExpectedComposerFooterText(value) {
  const text = sanitizeTerminalDiagnosticText(value)
    .replace(/^[│╭╰╮╯─\s]+/g, "")
    .replace(/[│╭╰╮╯─\s]+$/g, "")
    .trim();

  return /^gpt-[\w.-]+(?:\s+[\w.-]+)?\s+·\s+\/.+/.test(text);
}

function isCodexExpectedComposerFooterBorderText(value) {
  const text = sanitizeTerminalDiagnosticText(value).trim();

  return /^[│╭╰╮╯─\s]+$/.test(text);
}

function areCodexExpectedComposerFooterRows(rows) {
  const nonEmptyRows = Array.isArray(rows) ? rows : [];

  if (
    nonEmptyRows.length < 1
    || nonEmptyRows.length > TERMINAL_CODEX_RESIZE_LIVE_TAIL_PRESERVE_ROWS_BELOW_COMPOSER + 1
  ) {
    return false;
  }

  let footerRows = 0;
  for (const row of nonEmptyRows) {
    const text = row?.text || "";
    if (isCodexExpectedComposerFooterText(text)) {
      footerRows += 1;
      continue;
    }

    if (isCodexExpectedComposerFooterBorderText(text)) {
      continue;
    }

    return false;
  }

  return footerRows >= 1;
}

function getCodexResizeLiveTailCleanupPlan(terminal) {
  const bottomBand = getTerminalBottomBandDiagnostic(terminal);

  if (!bottomBand.available) {
    return {
      bottomBand,
      reason: "buffer_unavailable",
      shouldClean: false,
    };
  }

  const terminalRows = Math.max(1, Number(bottomBand.terminalRows || terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const cursorY = Math.max(0, Number(bottomBand.cursorY || 0));
  const cursorAbsoluteRow = Math.max(0, Number(bottomBand.cursorAbsoluteRow || 0));
  const liveEnd = Math.max(cursorAbsoluteRow, Number(bottomBand.liveEnd || 0));
  const nonEmptyRowsBelow = [];

  for (let rowIndex = cursorAbsoluteRow + 1; rowIndex < liveEnd; rowIndex += 1) {
    const row = getTerminalRowTextDiagnostic(terminal, rowIndex);
    if (!row.isBlank) {
      nonEmptyRowsBelow.push(row);
    }
  }

  const cursorText = bottomBand.cursorLine?.text || "";
  const composerMatched = isCodexComposerPromptText(cursorText);
  const hasOnlyExpectedFooter = areCodexExpectedComposerFooterRows(nonEmptyRowsBelow);

  if (!composerMatched) {
    return {
      bottomBand,
      composerMatched,
      nonEmptyRowsBelow,
      reason: "cursor_not_composer",
      shouldClean: false,
    };
  }

  if (cursorY >= terminalRows - 1) {
    return {
      bottomBand,
      composerMatched,
      nonEmptyRowsBelow,
      reason: "cursor_on_last_row",
      shouldClean: false,
    };
  }

  if (!nonEmptyRowsBelow.length) {
    return {
      bottomBand,
      composerMatched,
      nonEmptyRowsBelow,
      reason: "tail_already_blank",
      shouldClean: false,
    };
  }

  if (hasOnlyExpectedFooter) {
    return {
      bottomBand,
      composerMatched,
      nonEmptyRowsBelow,
      reason: "expected_footer_only",
      shouldClean: false,
    };
  }

  const targetRow = Math.max(
    1,
    Math.min(
      terminalRows,
      cursorY + 2 + TERMINAL_CODEX_RESIZE_LIVE_TAIL_PRESERVE_ROWS_BELOW_COMPOSER,
    ),
  );
  const nonEmptySignature = nonEmptyRowsBelow
    .map((row) => `${row.rowIndex}:${row.hash}:${row.textLength}`)
    .join("|");

  return {
    bottomBand,
    composerMatched,
    nonEmptyRowsBelow,
    reason: "stale_live_tail",
    preservedRowsBelowComposer: TERMINAL_CODEX_RESIZE_LIVE_TAIL_PRESERVE_ROWS_BELOW_COMPOSER,
    sequence: `\x1b7\x1b[${targetRow};1H\x1b[0J\x1b8`,
    shouldClean: true,
    signature: [
      terminal?.cols || 0,
      terminalRows,
      bottomBand.baseY,
      cursorAbsoluteRow,
      bottomBand.cursorLine?.hash || "",
      nonEmptySignature,
    ].join(":"),
    targetRow,
  };
}

function getTerminalCanvasDiagnostics(container) {
  const canvases = Array.from(container?.querySelectorAll?.("canvas") || []);

  return canvases.map((canvas, index) => {
    const style = typeof window !== "undefined" && typeof window.getComputedStyle === "function"
      ? window.getComputedStyle(canvas)
      : null;
    const bounds = typeof canvas.getBoundingClientRect === "function"
      ? canvas.getBoundingClientRect()
      : null;

    return {
      className: String(canvas.className || ""),
      clientHeight: Math.round(Number(canvas.clientHeight || 0)),
      clientWidth: Math.round(Number(canvas.clientWidth || 0)),
      height: Math.round(Number(canvas.height || 0)),
      index,
      opacity: style?.opacity || "",
      rectHeight: bounds ? Math.round(Number(bounds.height || 0)) : 0,
      rectTop: bounds ? Math.round(Number(bounds.top || 0)) : 0,
      rectWidth: bounds ? Math.round(Number(bounds.width || 0)) : 0,
      styleHeight: style?.height || "",
      styleTransform: style?.transform || "",
      styleWidth: style?.width || "",
      width: Math.round(Number(canvas.width || 0)),
    };
  });
}

function getTerminalRowsDomSnapshot(container, limit = TERMINAL_RENDERER_DOM_ROW_SNAPSHOT_LIMIT) {
  const rowsElement = container?.querySelector?.(".xterm-rows") || null;
  const screenElement = container?.querySelector?.(".xterm-screen") || null;
  const textLayerElement = container?.querySelector?.(".xterm-text-layer") || null;
  const containerBounds = typeof container?.getBoundingClientRect === "function"
    ? container.getBoundingClientRect()
    : null;
  const rowsBounds = typeof rowsElement?.getBoundingClientRect === "function"
    ? rowsElement.getBoundingClientRect()
    : null;
  const rowLimit = Math.max(0, Math.floor(Number(limit || 0)));
  const rowElements = Array.from(rowsElement?.children || []).slice(0, rowLimit);

  return {
    childCount: Number(rowsElement?.children?.length || 0),
    firstRows: rowElements.map((rowElement, index) => {
      const bounds = typeof rowElement?.getBoundingClientRect === "function"
        ? rowElement.getBoundingClientRect()
        : null;
      const style = typeof window !== "undefined" && typeof window.getComputedStyle === "function"
        ? window.getComputedStyle(rowElement)
        : null;

      return {
        childCount: Number(rowElement?.children?.length || 0),
        className: String(rowElement?.className || ""),
        index,
        rectHeight: bounds ? Math.round(Number(bounds.height || 0)) : 0,
        rectLeft: bounds && containerBounds
          ? Math.round(Number(bounds.left || 0) - Number(containerBounds.left || 0))
          : 0,
        rectTop: bounds && containerBounds
          ? Math.round(Number(bounds.top || 0) - Number(containerBounds.top || 0))
          : 0,
        styleHeight: style?.height || "",
        styleTransform: style?.transform || "",
        text: sanitizeTerminalDiagnosticText(rowElement?.textContent || "", 180),
      };
    }),
    rowsElement: getTerminalElementDiagnostics(rowsElement),
    rowsRectTop: rowsBounds && containerBounds
      ? Math.round(Number(rowsBounds.top || 0) - Number(containerBounds.top || 0))
      : 0,
    screen: getTerminalElementDiagnostics(screenElement),
    textLayer: getTerminalElementDiagnostics(textLayerElement),
  };
}

function getTerminalRendererPaintDiagnostics(terminal, container, scrollableElement) {
  const screenElement = container?.querySelector?.(".xterm-screen") || null;
  const viewportElement = container?.querySelector?.(".xterm-viewport") || null;
  const rowsElement = container?.querySelector?.(".xterm-rows") || null;
  const textLayerElement = container?.querySelector?.(".xterm-text-layer") || null;
  const cursorLayerElement = container?.querySelector?.(".xterm-cursor-layer") || null;
  const containerBounds = typeof container?.getBoundingClientRect === "function"
    ? container.getBoundingClientRect()
    : null;
  const screenBounds = typeof screenElement?.getBoundingClientRect === "function"
    ? screenElement.getBoundingClientRect()
    : null;
  const dimensions = terminal?._core?._renderService?.dimensions || {};
  const cssCanvas = dimensions?.css?.canvas || {};
  const cssCell = dimensions?.css?.cell || {};
  const deviceCanvas = dimensions?.device?.canvas || {};
  const deviceCell = dimensions?.device?.cell || {};
  const buffer = terminal?.buffer?.active;
  const rows = Math.max(1, Number(terminal?.rows || TERMINAL_DEFAULT_ROWS));
  const baseY = Number(buffer?.baseY || 0);
  const viewportY = Number(buffer?.viewportY || 0);

  return {
    canvasCount: Number(container?.querySelectorAll?.("canvas")?.length || 0),
    canvases: getTerminalCanvasDiagnostics(container),
    cursorLayer: getTerminalElementDiagnostics(cursorLayerElement),
    liveRows: getTerminalBufferRowsDiagnostic(terminal, baseY, rows),
    paintBounds: {
      containerHeight: containerBounds ? Math.round(Number(containerBounds.height || 0)) : 0,
      cssPaintedBottom: container?.style?.getPropertyValue?.("--terminal-xterm-painted-bottom") || "",
      screenBottom: screenBounds && containerBounds
        ? Math.round(Number(screenBounds.bottom || 0) - Number(containerBounds.top || 0))
        : 0,
      unpaintedBottomPx: screenBounds && containerBounds
        ? Math.max(0, Math.round(Number(containerBounds.bottom || 0) - Number(screenBounds.bottom || 0)))
        : 0,
    },
    renderService: {
      actualCellHeight: Number(dimensions.actualCellHeight || 0),
      actualCellWidth: Number(dimensions.actualCellWidth || 0),
      cssCanvasHeight: Number(cssCanvas.height || 0),
      cssCanvasWidth: Number(cssCanvas.width || 0),
      cssCellHeight: Number(cssCell.height || 0),
      cssCellWidth: Number(cssCell.width || 0),
      deviceCanvasHeight: Number(deviceCanvas.height || 0),
      deviceCanvasWidth: Number(deviceCanvas.width || 0),
      deviceCellHeight: Number(deviceCell.height || 0),
      deviceCellWidth: Number(deviceCell.width || 0),
    },
    rowsDom: getTerminalRowsDomSnapshot(container),
    rowsElement: getTerminalElementDiagnostics(rowsElement),
    screen: getTerminalElementDiagnostics(screenElement),
    scrollable: getTerminalElementDiagnostics(scrollableElement),
    textLayer: getTerminalElementDiagnostics(textLayerElement),
    topBand: getTerminalTopBandDiagnostic(terminal),
    viewport: getTerminalElementDiagnostics(viewportElement),
    viewportRows: getTerminalBufferRowsDiagnostic(terminal, viewportY, rows),
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

function getTerminalCursorHomeDiagnostic(params) {
  const numbers = getCsiParamNumbers(params);

  if (numbers.length === 0) {
    return {
      isHome: true,
      variant: "bare",
    };
  }

  if (numbers.length > 2) {
    return {
      isHome: false,
      variant: "",
    };
  }

  const row = numbers[0] ?? 1;
  const column = numbers[1] ?? 1;
  const rowIsHome = row === 0 || row === 1;
  const columnIsHome = column === 0 || column === 1;

  if (!rowIsHome || !columnIsHome) {
    return {
      isHome: false,
      variant: "",
    };
  }

  return {
    isHome: true,
    variant: numbers.length === 1 ? "omitted_column" : "explicit",
  };
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
  const terminalScrollStabilityMode = getTerminalAgentScrollStabilityMode({
    agentKind: terminalAgentKind,
    isMacHost: TERMINAL_IS_MACOS_HOST,
    isWindowsHost: TERMINAL_IS_WINDOWS_HOST,
  });
  const useNormalizerAgentScrollStability = terminalScrollStabilityMode
    === TERMINAL_SCROLL_STABILITY_MODE_NORMALIZER
    && !isGenericTerminal;
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
    const terminalDiagnosticsEnabled = isTerminalDiagnosticLoggingEnabled();
    const windowsTerminalDiagnosticsEnabled = isWindowsTerminalDiagnosticLoggingEnabled();
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

    let terminalScrollableElement = null;
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
      scrollOnEraseInDisplay: false,
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

    const terminalOutputNormalizer = createTerminalOutputNormalizer({
      dropEraseDisplay2OutsideSync: terminalAgentKind === "codex",
      enabled: useNormalizerAgentScrollStability,
    });
    syncTerminalDiagnosticLogging();
    syncWindowsTerminalDiagnosticLogging();
    startTerminalDiagnosticHeartbeat();
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
      syncTerminalPaintBounds("xterm_open");
      scheduleTerminalPaintBoundsSync("xterm_open_settled", [34, 120]);
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
        scrollStabilityMode: terminalScrollStabilityMode || "off",
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
    let markCodexResizeGateActive = () => {};
    let scheduleCodexResizeGateFlush = () => {};
    let scheduleCodexResizePaintProbe = () => {};
    let logCodexResizePaintProbe = () => {};
    let isCodexResizePaintProbeActive = () => false;
    let applyCodexResizeScrollbackCleanup = () => false;
    let scheduleCodexResizeLiveTailCleanup = () => false;
    let handleCodexResizeCursorHomeSettled = () => {};
    let syncTerminalPaintBounds = () => false;
    let scheduleTerminalPaintBoundsSync = () => {};

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
    const logWindowsTerminalControl = (control, fields = {}) => {
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
      return sequenceId;
    };

    const registerWindowsTerminalControlDiagnostics = () => {
      if (!windowsTerminalDiagnosticsEnabled) {
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
        const activeBufferType = getTerminalBufferDiagnostics(terminal)?.type || "";
        const control = actionParam === 3 ? "erase_saved_lines" : "erase_display";

        logWindowsTerminalControl(control, {
          action: "allow",
          bufferType: activeBufferType,
          params: allParams.length > 0 ? allParams : [actionParam],
          scrollOnEraseInDisplay: terminal.options.scrollOnEraseInDisplay === true,
          scrollStabilityMode: terminalScrollStabilityMode || "off",
        });

        return false;
      }));

      const registerDecPrivateModeHandler = (mode) => terminal.parser.registerCsiHandler(
        { prefix: "?", final: mode === "set" ? "h" : "l" },
        (params) => {
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
            });
          }

          return false;
        },
      );

      disposables.push(registerDecPrivateModeHandler("set"));
      disposables.push(registerDecPrivateModeHandler("reset"));

      let cursorMoveWindowStartedAt = 0;
      let cursorMoveWindowCount = 0;
      const scheduleCursorHomeSettledDiagnostic = (sequenceId, final, params, beforeState, variant) => {
        const timer = window.setTimeout(() => {
          startupMetricTimers.delete(timer);
          if (isDisposed || !windowsTerminalDiagnosticsEnabled) {
            return;
          }

          const afterState = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
          logWindowsTerminalDiagnosticEvent("frontend.windows_terminal.cursor_home_settled", {
            action: "allow",
            beforeBaseY: Number(beforeState?.baseY || 0),
            beforeCursorX: Number(beforeState?.cursorX || 0),
            beforeCursorY: Number(beforeState?.cursorY || 0),
            beforeViewportY: Number(beforeState?.viewportY || 0),
            control: "cursor_home",
            deltaBaseY: Number(afterState.baseY || 0) - Number(beforeState?.baseY || 0),
            deltaCursorX: Number(afterState.cursorX || 0) - Number(beforeState?.cursorX || 0),
            deltaCursorY: Number(afterState.cursorY || 0) - Number(beforeState?.cursorY || 0),
            deltaViewportY: Number(afterState.viewportY || 0) - Number(beforeState?.viewportY || 0),
            final,
            paneId,
            params,
            rendererMode,
            sequenceId,
            source: "frontend",
            state: afterState,
            terminalIndex,
            variant,
          });
          handleCodexResizeCursorHomeSettled({
            afterState,
            beforeState,
            final,
            params,
            sequenceId,
            variant,
          });
        }, 0);
        startupMetricTimers.add(timer);
      };
      const registerCursorMoveHandler = (final) => terminal.parser.registerCsiHandler(
        { final },
        (params) => {
          const allParams = getCsiParamNumbers(params);
          const homeDiagnostic = getTerminalCursorHomeDiagnostic(params);
          if (homeDiagnostic.isHome) {
            const beforeState = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
            const sequenceId = logWindowsTerminalControl("cursor_home", {
              action: "allow",
              final,
              params: allParams,
              variant: homeDiagnostic.variant,
            });
            scheduleCursorHomeSettledDiagnostic(
              sequenceId,
              final,
              allParams,
              beforeState,
              homeDiagnostic.variant,
            );

            return false;
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
              params: allParams,
            }, false);
          }

          return false;
        },
      );

      disposables.push(registerCursorMoveHandler("H"));
      disposables.push(registerCursorMoveHandler("f"));
    };

    registerWindowsTerminalControlDiagnostics();

    syncTerminalPaintBounds = (reason = "sync") => {
      if (isDisposed || !container?.isConnected) {
        return false;
      }

      const screenElement = container.querySelector(".xterm-screen");
      if (!screenElement || typeof screenElement.getBoundingClientRect !== "function") {
        container.style.setProperty("--terminal-xterm-painted-bottom", "100%");
        return false;
      }

      const screenBounds = screenElement.getBoundingClientRect();
      const containerBounds = typeof container.getBoundingClientRect === "function"
        ? container.getBoundingClientRect()
        : null;
      const containerHeight = Number(containerBounds?.height || container.clientHeight || 0);
      const screenBottom = Number(screenBounds?.bottom || 0) - Number(containerBounds?.top || 0);

      if (
        !Number.isFinite(containerHeight)
        || containerHeight <= 0
        || !Number.isFinite(screenBottom)
        || screenBottom <= 0
      ) {
        container.style.setProperty("--terminal-xterm-painted-bottom", "100%");
        return false;
      }

      const paintedBottom = Math.max(0, Math.min(containerHeight, Math.ceil(screenBottom)));
      container.style.setProperty("--terminal-xterm-painted-bottom", `${paintedBottom}px`);
      container.style.setProperty("--terminal-xterm-container-height", `${Math.ceil(containerHeight)}px`);

      return true;
    };

    scheduleTerminalPaintBoundsSync = (reason = "scheduled", delaysMs = [0, 34, 120]) => {
      if (isDisposed) {
        return;
      }

      delaysMs.forEach((delayMs) => {
        const timer = window.setTimeout(() => {
          startupMetricTimers.delete(timer);
          syncTerminalPaintBounds(reason);
        }, Math.max(0, Number(delayMs || 0)));
        startupMetricTimers.add(timer);
      });
    };

    let windowsTerminalLastResizeLogAt = 0;
    disposables.push(terminal.onResize((event) => {
      markCodexResizeGateActive("xterm_resize", event);
      syncTerminalPaintBounds("xterm_resize");
      scheduleTerminalPaintBoundsSync("xterm_resize_settled", [34, 120, 260]);
      const now = performance.now();
      if (windowsTerminalDiagnosticsEnabled && now - windowsTerminalLastResizeLogAt >= 250) {
        windowsTerminalLastResizeLogAt = now;
        const timer = window.setTimeout(() => {
          startupMetricTimers.delete(timer);
          logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.resize_settled", {
            reason: "xterm_resize",
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

    const clearTerminalRendererRows = (reason, extraFields = {}) => {
      if (isDisposed || !container?.isConnected) {
        return {
          cleared: false,
          method: "unavailable",
        };
      }

      const rowsElement = container.querySelector(".xterm-rows");
      const screenElement = container.querySelector(".xterm-screen");
      const rowCount = Number(rowsElement?.children?.length || 0);
      let cleared = false;
      let method = "";

      try {
        const renderService = terminal?._core?._renderService;
        if (typeof renderService?.clear === "function") {
          renderService.clear();
          cleared = true;
          method = "render_service_clear";
        }
      } catch (_error) {
        cleared = false;
        method = "";
      }

      if (!cleared && rowsElement?.children?.length) {
        try {
          Array.from(rowsElement.children).forEach((rowElement) => {
            rowElement.replaceChildren();
          });
          cleared = true;
          method = "dom_row_replace_children";
        } catch (_error) {
          cleared = false;
          method = "dom_row_replace_failed";
        }
      }

      const forcedLayoutHeight = Number(screenElement?.offsetHeight || 0);

      if (windowsTerminalDiagnosticsEnabled) {
        const diagnosticFields = { ...(extraFields || {}) };
        if (Object.prototype.hasOwnProperty.call(diagnosticFields, "method")) {
          diagnosticFields.scrollMethod = diagnosticFields.method;
          delete diagnosticFields.method;
        }
        if (Object.prototype.hasOwnProperty.call(diagnosticFields, "reason")) {
          diagnosticFields.cleanupReason = diagnosticFields.reason;
          delete diagnosticFields.reason;
        }
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.renderer_rows_clear", {
          ...diagnosticFields,
          action: cleared ? "clear" : "skip",
          forcedLayoutHeight,
          rendererClearMethod: method,
          rendererClearReason: reason,
          rowCount,
        });
      }

      return {
        cleared,
        forcedLayoutHeight,
        method,
        rowCount,
      };
    };

    const refreshTerminalRenderer = (reason, extraFields = {}) => {
      if (isDisposed || typeof terminal.refresh !== "function") {
        return false;
      }

      try {
        if (extraFields.clearRowsBeforeRefresh === true) {
          clearTerminalRendererRows(`${reason}_before_refresh`, extraFields);
        }
        syncTerminalPaintBounds(`${reason}_before_refresh`);
        terminal.refresh(0, Math.max(0, terminal.rows - 1));
        syncTerminalPaintBounds(`${reason}_after_refresh`);
        scheduleTerminalPaintBoundsSync(`${reason}_refresh_settled`, [34]);
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
      const afterWriteRefreshReasons = writes
        .map((write) => write.afterWriteRefreshReason)
        .filter(Boolean);
      const scrollToBottomBeforeWrite = writes.some((write) => write.scrollToBottomBeforeWrite);
      const scrollToBottomAfterWrite = writes.some((write) => write.scrollToBottomAfterWrite);
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

        if (scrollToBottomAfterWrite && typeof terminal.scrollToBottom === "function") {
          try {
            terminal.scrollToBottom();
          } catch (_error) {
            // Best-effort: the resize repaint is already written.
          }
        }

        if (afterWriteRefreshReasons.length) {
          let clearedTextureAtlas = false;
          const clearTextureAtlas = activeWebglAddon?.clearTextureAtlas;
          if (typeof clearTextureAtlas === "function") {
            try {
              clearTextureAtlas.call(activeWebglAddon);
              clearedTextureAtlas = true;
            } catch (_error) {
              // Renderer refresh below is the fallback when the WebGL atlas cannot be cleared.
            }
          }

          const refreshed = refreshTerminalRenderer(afterWriteRefreshReasons[afterWriteRefreshReasons.length - 1], {
            bytes: batchData.byteLength,
            transport: "binary_channel",
          });
	          logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.codex_resize_gate", {
	            action: "after_write_refresh",
	            clearedTextureAtlas,
	            refreshed,
	            reasons: afterWriteRefreshReasons,
	            scrollToBottomAfterWrite,
	            scrollToBottomBeforeWrite,
	            scrolledToBottomBeforeWrite,
	          });
	          applyCodexResizeScrollbackCleanup("after_write_refresh", null, {
	            batchBytes,
	            clearedTextureAtlas,
	            refreshed,
	            scrollToBottomAfterWrite,
	            scrollToBottomBeforeWrite,
	            scrolledToBottomBeforeWrite,
	          });
	          const liveTailCleanedImmediately = applyCodexResizeLiveTailCleanup("after_write_refresh_immediate", {
	            allowWithPendingOutput: true,
	            batchBytes,
	            clearedTextureAtlas,
	            refreshed,
	            scrollToBottomAfterWrite,
	            scrollToBottomBeforeWrite,
	            scrolledToBottomBeforeWrite,
	          });
	          scheduleCodexResizeLiveTailCleanup("after_write_refresh", {
	            batchBytes,
	            clearedTextureAtlas,
	            liveTailCleanedImmediately,
	            refreshed,
	            scrollToBottomAfterWrite,
	            scrollToBottomBeforeWrite,
	            scrolledToBottomBeforeWrite,
	          });
	          scheduleCodexResizePaintProbe("codex_resize_gate_flush", "after_write_refresh", {
	            batchBytes,
	            clearedTextureAtlas,
	            liveTailCleanedImmediately,
	            refreshed,
	            scrollToBottomAfterWrite,
	            scrollToBottomBeforeWrite,
	            scrolledToBottomBeforeWrite,
	          });
        }

        if (isCodexResizePaintProbeActive()) {
          const liveTailCleanedImmediately = applyCodexResizeLiveTailCleanup("after_output_write_immediate", {
            allowWithPendingOutput: true,
            batchBytes,
            isFirstOutputChunk,
            isFirstVisibleOutputChunk,
            reason,
            writes: writes.length,
          });
          scheduleCodexResizePaintProbe("terminal_output_write", "after_output_write", {
            batchBytes,
            isFirstOutputChunk,
            isFirstVisibleOutputChunk,
            liveTailCleanedImmediately,
            reason,
            writes: writes.length,
          }, [0, 80]);
          scheduleCodexResizeLiveTailCleanup("after_output_write", {
            batchBytes,
            isFirstOutputChunk,
            isFirstVisibleOutputChunk,
            liveTailCleanedImmediately,
            reason,
            writes: writes.length,
          }, [16, 80]);
        }

        if (pendingOutputWrites.length) {
          scheduleTerminalOutputBatchFlush();
        }

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

      };

      let scrolledToBottomBeforeWrite = false;
      if (scrollToBottomBeforeWrite && typeof terminal.scrollToBottom === "function") {
        try {
          terminal.scrollToBottom();
          scrolledToBottomBeforeWrite = true;
        } catch (_error) {
          // Best-effort: the resize repaint can still be restored after parsing.
        }
      }

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

    const enqueueTerminalOutputWrite = (data, options = {}) => {
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
        afterWriteRefreshReason: options.afterWriteRefreshReason || "",
        data: queuedData,
	        isFirstOutputChunk,
	        isFirstVisibleOutputChunk,
	        outputDebug,
	        scrollToBottomBeforeWrite: options.scrollToBottomBeforeWrite === true,
	        scrollToBottomAfterWrite: options.scrollToBottomAfterWrite === true,
	      });
      pendingOutputBytes += queuedData.byteLength;

      if (pendingOutputBytes >= TERMINAL_OUTPUT_BATCH_MAX_BYTES) {
        scheduleTerminalOutputBatchFlush();
        return;
      }

      scheduleTerminalOutputBatchFlush();
    };

    const codexResizeGate = {
      active: false,
      epoch: 0,
      flushDueAt: 0,
      flushTimer: 0,
      lastObservedSize: null,
      lastOutputPaintProbeAt: 0,
      liveTailCleanupSequence: 0,
      liveTailCleanupUntil: 0,
      liveTailLastCleanedSignature: "",
      paintProbeSequence: 0,
      paintProbeUntil: 0,
      previousSize: null,
      queuedBytes: 0,
      queuedWrites: [],
      scrollbackCleanupAnchor: null,
      scrollbackCleanupLastHandledBaseY: 0,
      scrollbackCleanupLastTargetY: -1,
      scrollbackCleanupStartBaseY: 0,
      scrollbackCleanupStartedAtBottom: false,
      scrollbackCleanupStartViewportY: 0,
      scrollbackCleanupUntil: 0,
      startedAtBottom: false,
      startedAt: 0,
      startState: null,
      targetSize: null,
    };
    const isCodexResizeGateEnabled = () => (
      terminalAgentKind === "codex"
      && terminalOutputNormalizer.enabled
      && !isGenericTerminal
    );
    const normalizeCodexResizeGateSize = (size) => {
      const cols = Number(size?.cols || 0);
      const rows = Number(size?.rows || 0);

      if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
        return null;
      }

      return {
        cols: Math.floor(cols),
        rows: Math.floor(rows),
      };
    };
    const getCurrentCodexResizeGateSize = () => normalizeCodexResizeGateSize({
      cols: terminal.cols,
      rows: terminal.rows,
    });
    const codexResizeGateSizesEqual = (left, right) => (
      Boolean(left)
      && Boolean(right)
      && Number(left.cols || 0) === Number(right.cols || 0)
      && Number(left.rows || 0) === Number(right.rows || 0)
    );
    const clearCodexResizeGateTimer = () => {
      if (!codexResizeGate.flushTimer) {
        return;
      }

      window.clearTimeout(codexResizeGate.flushTimer);
      codexResizeGate.flushTimer = 0;
      codexResizeGate.flushDueAt = 0;
    };
    isCodexResizePaintProbeActive = () => (
      isCodexResizeGateEnabled()
      && (
        codexResizeGate.active
        || performance.now() <= Number(codexResizeGate.paintProbeUntil || 0)
      )
    );
    logCodexResizePaintProbe = (reason, action, extraFields = {}) => {
      if (!windowsTerminalDiagnosticsEnabled || !isCodexResizeGateEnabled() || isDisposed) {
        return;
      }

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.codex_resize_paint_probe", {
        action,
        epoch: codexResizeGate.epoch,
        paintProbeActive: isCodexResizePaintProbeActive(),
        paintProbeUntil: Number(codexResizeGate.paintProbeUntil || 0),
        reason,
        renderer: getTerminalRendererPaintDiagnostics(terminal, container, terminalScrollableElement),
        ...extraFields,
      });
    };
    scheduleCodexResizePaintProbe = (
      reason,
      action,
      extraFields = {},
      delaysMs = TERMINAL_CODEX_RESIZE_PAINT_PROBE_DELAYS_MS,
    ) => {
      if (!windowsTerminalDiagnosticsEnabled || !isCodexResizeGateEnabled() || isDisposed) {
        return;
      }

      const now = performance.now();
      if (
        action === "after_output_write"
        && now - codexResizeGate.lastOutputPaintProbeAt < TERMINAL_CODEX_RESIZE_OUTPUT_PROBE_THROTTLE_MS
      ) {
        return;
      }

      if (action === "after_output_write") {
        codexResizeGate.lastOutputPaintProbeAt = now;
      }

      codexResizeGate.paintProbeUntil = Math.max(
        Number(codexResizeGate.paintProbeUntil || 0),
        now + TERMINAL_CODEX_RESIZE_PAINT_PROBE_WINDOW_MS,
      );
      codexResizeGate.paintProbeSequence += 1;
      const probeId = codexResizeGate.paintProbeSequence;

      delaysMs.forEach((delayMs) => {
        const normalizedDelayMs = Math.max(0, Number(delayMs || 0));
        const timer = window.setTimeout(() => {
          startupMetricTimers.delete(timer);
          logCodexResizePaintProbe(reason, action, {
            delayMs: normalizedDelayMs,
            probeId,
            ...extraFields,
          });
        }, normalizedDelayMs);
        startupMetricTimers.add(timer);
      });
    };
    const isCodexResizeLiveTailCleanupActive = () => (
      isCodexResizeGateEnabled()
      && (
        codexResizeGate.active
        || performance.now() <= Number(codexResizeGate.liveTailCleanupUntil || 0)
      )
    );
    const applyCodexResizeLiveTailCleanup = (reason, extraFields = {}) => {
      if (!isCodexResizeLiveTailCleanupActive() || isDisposed) {
        return false;
      }

      const allowWithPendingOutput = extraFields.allowWithPendingOutput === true;
      if (outputWriteInFlight || (!allowWithPendingOutput && pendingOutputWrites.length > 0)) {
        return false;
      }

      const plan = getCodexResizeLiveTailCleanupPlan(terminal);

      if (!plan.shouldClean) {
        return false;
      }

      if (codexResizeGate.liveTailLastCleanedSignature === plan.signature) {
        return false;
      }

      codexResizeGate.liveTailLastCleanedSignature = plan.signature;

      try {
        terminal.write(plan.sequence, () => {
          if (isDisposed) {
            return;
          }

          refreshTerminalRenderer("codex_resize_live_tail_cleanup", {
            reason,
            targetRow: plan.targetRow,
          });
        });
        return true;
      } catch (_error) {
        codexResizeGate.liveTailLastCleanedSignature = "";
      }

      return false;
    };
    scheduleCodexResizeLiveTailCleanup = (
      reason,
      extraFields = {},
      delaysMs = TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_DELAYS_MS,
    ) => {
      if (!isCodexResizeLiveTailCleanupActive() || isDisposed) {
        return false;
      }

      codexResizeGate.liveTailCleanupUntil = Math.max(
        Number(codexResizeGate.liveTailCleanupUntil || 0),
        performance.now() + TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_MS,
      );
      codexResizeGate.liveTailCleanupSequence += 1;
      const cleanupId = codexResizeGate.liveTailCleanupSequence;

      delaysMs.forEach((delayMs) => {
        const normalizedDelayMs = Math.max(0, Number(delayMs || 0));
        const timer = window.setTimeout(() => {
          startupMetricTimers.delete(timer);
          applyCodexResizeLiveTailCleanup(reason, {
            cleanupId,
            delayMs: normalizedDelayMs,
            ...extraFields,
          });
        }, normalizedDelayMs);
        startupMetricTimers.add(timer);
      });

      return true;
    };
    const isCodexResizeScrollbackCleanupActive = () => (
      isCodexResizeGateEnabled()
      && (
        codexResizeGate.active
        || performance.now() <= Number(codexResizeGate.scrollbackCleanupUntil || 0)
      )
    );
    applyCodexResizeScrollbackCleanup = (reason, state = null, extraFields = {}) => {
      if (!isCodexResizeScrollbackCleanupActive() || isDisposed) {
        return false;
      }

	      let currentState = state || getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
	      let currentBaseY = Number(currentState?.baseY || 0);
	      let currentViewportY = Number(currentState?.viewportY || 0);
	      const cleanupBeforeBaseY = currentBaseY;
	      const cleanupBeforeViewportY = currentViewportY;
	      const shouldRestoreAfterTemporaryBottom = extraFields.scrollToBottomBeforeWrite === true
	        && !codexResizeGate.scrollbackCleanupStartedAtBottom;
	      const startBaseY = Number(codexResizeGate.scrollbackCleanupStartBaseY || 0);
      const startViewportY = Number(codexResizeGate.scrollbackCleanupStartViewportY || 0);
      const initialInsertedRows = currentBaseY - startBaseY;
      let insertedRows = initialInsertedRows;
      const fallbackInsertedRows = Number.isFinite(insertedRows) ? Math.max(0, insertedRows) : 0;
      let fallbackTargetViewportY = codexResizeGate.scrollbackCleanupStartedAtBottom
        ? currentBaseY
        : Math.max(0, Math.min(currentBaseY, startViewportY + fallbackInsertedRows));
      const anchorMatch = codexResizeGate.scrollbackCleanupStartedAtBottom
        ? {
          matched: false,
          matches: 0,
          preferredViewportY: fallbackTargetViewportY,
          viewportY: -1,
        }
        : findTerminalViewportAnchorMatch(
          terminal,
          codexResizeGate.scrollbackCleanupAnchor,
          fallbackTargetViewportY,
        );

      if (!Number.isFinite(insertedRows)) {
        return false;
      }

      let rawTargetViewportY = codexResizeGate.scrollbackCleanupStartedAtBottom
        ? currentBaseY
        : anchorMatch.matched
          ? Math.max(0, Math.min(currentBaseY, anchorMatch.viewportY))
          : fallbackTargetViewportY;
      const artifactCandidateViewportY = codexResizeGate.scrollbackCleanupStartedAtBottom
        ? Math.max(0, Math.min(currentBaseY, startBaseY))
        : rawTargetViewportY;
      let topArtifactAdjustment = getCodexResizeTopArtifactAdjustment(terminal, artifactCandidateViewportY);
      let targetViewportY = topArtifactAdjustment.adjusted
        ? Math.max(0, Math.min(currentBaseY, topArtifactAdjustment.viewportY))
        : rawTargetViewportY;
      const artifactPurgePlan = getCodexResizeTopArtifactPurgePlan(terminal, topArtifactAdjustment);
      const artifactPurgeResult = applyCodexResizeTopArtifactPurge(terminal, artifactPurgePlan);

      if (artifactPurgeResult.purged) {
        currentState = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
        currentBaseY = Number(currentState?.baseY || 0);
        currentViewportY = Number(currentState?.viewportY || 0);
        insertedRows = currentBaseY - startBaseY;
        fallbackTargetViewportY = codexResizeGate.scrollbackCleanupStartedAtBottom
          ? currentBaseY
          : Math.max(0, Math.min(currentBaseY, startViewportY + Math.max(0, insertedRows)));
        rawTargetViewportY = adjustTerminalRowAfterDeletion(
          rawTargetViewportY,
          artifactPurgeResult.deleteStart,
          artifactPurgeResult.deleteCount,
        );
        targetViewportY = codexResizeGate.scrollbackCleanupStartedAtBottom
          ? currentBaseY
          : adjustTerminalRowAfterDeletion(
            targetViewportY,
            artifactPurgeResult.deleteStart,
            artifactPurgeResult.deleteCount,
          );
        rawTargetViewportY = Math.max(0, Math.min(currentBaseY, rawTargetViewportY));
        targetViewportY = Math.max(0, Math.min(currentBaseY, targetViewportY));
        topArtifactAdjustment = {
          ...topArtifactAdjustment,
          purgeApplied: true,
          purgedRows: artifactPurgeResult.deleteCount,
          viewportY: targetViewportY,
        };
      }

	      if (
	        insertedRows <= 0
	        && !anchorMatch.matched
	        && !topArtifactAdjustment.adjusted
	        && !artifactPurgeResult.purged
	        && !shouldRestoreAfterTemporaryBottom
	      ) {
        return false;
      }

      const needsScroll = Math.abs(targetViewportY - currentViewportY) >= 1;
      if (!needsScroll && !artifactPurgeResult.purged) {
        return false;
      }

      if (
        !artifactPurgeResult.purged
        &&
        codexResizeGate.scrollbackCleanupLastHandledBaseY >= currentBaseY
        && codexResizeGate.scrollbackCleanupLastTargetY === targetViewportY
      ) {
        return false;
      }

      let scrolled = !needsScroll && artifactPurgeResult.purged;
      let method = scrolled ? "purgeOnly" : "";
      try {
        if (!needsScroll) {
          // The artifact purge already moved the live frame into the desired viewport.
        } else if (
          codexResizeGate.scrollbackCleanupStartedAtBottom
          && typeof terminal.scrollToBottom === "function"
        ) {
          terminal.scrollToBottom();
          method = "scrollToBottom";
          scrolled = true;
        } else if (typeof terminal.scrollToLine === "function") {
          terminal.scrollToLine(targetViewportY);
          method = "scrollToLine";
          scrolled = true;
        } else if (typeof terminal.scrollLines === "function") {
          terminal.scrollLines(targetViewportY - currentViewportY);
          method = "scrollLines";
          scrolled = true;
        }
      } catch (_error) {
        scrolled = false;
      }

      if (!scrolled) {
        return false;
      }

      codexResizeGate.scrollbackCleanupLastHandledBaseY = Math.max(
        codexResizeGate.scrollbackCleanupLastHandledBaseY,
        currentBaseY,
      );
      codexResizeGate.scrollbackCleanupLastTargetY = targetViewportY;
      const cleanupFields = {
        anchorMatched: anchorMatch.matched,
        anchorMatches: anchorMatch.matches,
        artifactPurgeApplied: artifactPurgeResult.purged,
        artifactPurgeDeleteCount: Number(artifactPurgeResult.deleteCount || 0),
        artifactPurgeDeleteStart: Number(artifactPurgeResult.deleteStart || 0),
        artifactPurgeReason: artifactPurgeResult.reason || artifactPurgePlan.reason || "",
        fallbackTargetViewportY,
        initialInsertedRows,
	        insertedRows,
	        method,
	        reason,
	        rawTargetViewportY,
	        shouldRestoreAfterTemporaryBottom,
	        topArtifactAdjusted: topArtifactAdjustment.adjusted,
        topArtifactReason: topArtifactAdjustment.reason,
        targetViewportY,
      };
      refreshTerminalRenderer("codex_resize_scrollback_cleanup", cleanupFields);

      const timer = window.setTimeout(() => {
        startupMetricTimers.delete(timer);
        const afterState = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.codex_resize_scrollback_cleanup", {
          action: "apply",
          afterBaseY: Number(afterState.baseY || 0),
          afterViewportY: Number(afterState.viewportY || 0),
	          beforeBaseY: cleanupBeforeBaseY,
	          beforeViewportY: cleanupBeforeViewportY,
          epoch: codexResizeGate.epoch,
          anchorMatched: anchorMatch.matched,
          anchorMatches: anchorMatch.matches,
          anchorPreferredViewportY: anchorMatch.preferredViewportY,
          anchorRequiredMatches: anchorMatch.requiredMatches || 0,
          anchorTargetViewportY: anchorMatch.viewportY,
          artifactPurgeApplied: artifactPurgeResult.purged,
          artifactPurgeDeleteCount: Number(artifactPurgeResult.deleteCount || 0),
          artifactPurgeDeleteStart: Number(artifactPurgeResult.deleteStart || 0),
          artifactPurgeReason: artifactPurgeResult.reason || artifactPurgePlan.reason || "",
          fallbackTargetViewportY,
          initialInsertedRows,
	          insertedRows,
	          method,
	          reason,
	          shouldRestoreAfterTemporaryBottom,
	          startBaseY,
          startedAtBottom: codexResizeGate.scrollbackCleanupStartedAtBottom,
          startViewportY,
          rawTargetViewportY,
          topArtifactAdjusted: topArtifactAdjustment.adjusted,
          topArtifactDistanceToLiveTop: Number(topArtifactAdjustment.distanceToLiveTop || 0),
          topArtifactPreLiveBlankRows: topArtifactAdjustment.preLiveBlankRows || [],
          topArtifactPreLiveNonBlankRows: topArtifactAdjustment.preLiveNonBlankRows || [],
          topArtifactLiveTitleRows: topArtifactAdjustment.liveTitleRows || [],
          topArtifactPreLiveTitleRows: topArtifactAdjustment.preLiveTitleRows || [],
          topArtifactPreLiveTopBorderRows: topArtifactAdjustment.preLiveTopBorderRows || [],
          topArtifactReason: topArtifactAdjustment.reason,
          topArtifactWasViewportY: Number(topArtifactAdjustment.wasViewportY ?? rawTargetViewportY),
          targetViewportY,
          ...extraFields,
        });
      }, 0);
      startupMetricTimers.add(timer);
      scheduleCodexResizePaintProbe("codex_resize_scrollback_cleanup", "after_scrollback_cleanup", {
        anchorMatched: anchorMatch.matched,
        anchorMatches: anchorMatch.matches,
        fallbackTargetViewportY,
        insertedRows,
        method,
        reason,
        rawTargetViewportY,
        topArtifactAdjusted: topArtifactAdjustment.adjusted,
        topArtifactReason: topArtifactAdjustment.reason,
        targetViewportY,
      }, [0, 80]);
      scheduleCodexResizeLiveTailCleanup("after_scrollback_cleanup", {
        anchorMatched: anchorMatch.matched,
        anchorMatches: anchorMatch.matches,
        fallbackTargetViewportY,
        insertedRows,
        method,
        reason,
        rawTargetViewportY,
        topArtifactAdjusted: topArtifactAdjustment.adjusted,
        topArtifactReason: topArtifactAdjustment.reason,
        targetViewportY,
      }, [0, 80, 180]);
      return true;
    };
    handleCodexResizeCursorHomeSettled = ({
      afterState,
      beforeState,
      final,
      params,
      sequenceId,
      variant,
    } = {}) => {
      if (!isCodexResizeScrollbackCleanupActive() || isDisposed) {
        return;
      }

      const deltaBaseY = Number(afterState?.baseY || 0) - Number(beforeState?.baseY || 0);
      if (!Number.isFinite(deltaBaseY) || deltaBaseY <= 0) {
        return;
      }

      applyCodexResizeScrollbackCleanup("cursor_home_settled", afterState, {
        deltaBaseY,
        final,
        params,
        sequenceId,
        variant,
      });
    };
    scheduleCodexResizeGateFlush = (
      reason,
      delayMs = TERMINAL_CODEX_RESIZE_GATE_SETTLE_MS,
      options = {},
    ) => {
      if (!isCodexResizeGateEnabled() || !codexResizeGate.active || isDisposed) {
        return;
      }

      const now = performance.now();
      const maxDueAt = codexResizeGate.startedAt + TERMINAL_CODEX_RESIZE_GATE_MAX_MS;
      const requestedDelayMs = Math.max(0, Number(delayMs || 0));
      const dueAt = Math.min(now + requestedDelayMs, maxDueAt);

      if (
        codexResizeGate.flushTimer
        && options.allowLater !== true
        && codexResizeGate.flushDueAt
        && codexResizeGate.flushDueAt <= dueAt + 1
      ) {
        return;
      }

      clearCodexResizeGateTimer();
      codexResizeGate.flushTimer = window.setTimeout(() => {
        codexResizeGate.flushTimer = 0;
        codexResizeGate.flushDueAt = 0;
        flushCodexResizeGate(reason);
      }, Math.max(0, dueAt - now));
      codexResizeGate.flushDueAt = dueAt;
    };
    const flushCodexResizeGate = (reason = "settled", force = false) => {
      if (!codexResizeGate.active || isDisposed) {
        return false;
      }

      const elapsedMs = performance.now() - codexResizeGate.startedAt;
      const state = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
      const targetSize = codexResizeGate.targetSize || getCurrentCodexResizeGateSize();
      const geometrySettled = isWindowsTerminalGeometrySettled(state, targetSize);
      const hitMaxDeadline = elapsedMs >= TERMINAL_CODEX_RESIZE_GATE_MAX_MS - 1;

      if (
        !force
        && !geometrySettled
        && !hitMaxDeadline
      ) {
        scheduleCodexResizeGateFlush(reason, TERMINAL_CODEX_RESIZE_GATE_RETRY_MS, {
          allowLater: true,
        });
        return false;
      }

      clearCodexResizeGateTimer();
      const queuedWrites = codexResizeGate.queuedWrites.splice(0);
      const queuedBytes = codexResizeGate.queuedBytes;
      const epoch = codexResizeGate.epoch;
      const previousSize = codexResizeGate.previousSize;
      const startedAtBottom = codexResizeGate.startedAtBottom;
      const startState = codexResizeGate.startState;
      codexResizeGate.active = false;
      codexResizeGate.scrollbackCleanupUntil = Math.max(
        Number(codexResizeGate.scrollbackCleanupUntil || 0),
        performance.now() + TERMINAL_CODEX_RESIZE_SCROLLBACK_CLEANUP_MS,
      );
      codexResizeGate.liveTailCleanupUntil = Math.max(
        Number(codexResizeGate.liveTailCleanupUntil || 0),
        performance.now() + TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_MS,
      );
      codexResizeGate.queuedBytes = 0;
      codexResizeGate.startedAt = 0;
      codexResizeGate.startedAtBottom = false;
      codexResizeGate.startState = null;
      codexResizeGate.previousSize = null;
      codexResizeGate.targetSize = null;

      if (!queuedWrites.length) {
        syncTerminalPaintBounds("codex_resize_gate_empty_flush");
        const refreshed = refreshTerminalRenderer("codex_resize_gate_empty_flush", {
          reason,
        });
        const cleaned = applyCodexResizeScrollbackCleanup("empty_flush", state, {
          refreshed,
        });
        const liveTailCleanupScheduled = scheduleCodexResizeLiveTailCleanup("empty_flush", {
          cleaned,
          refreshed,
        });
        scheduleCodexResizePaintProbe("codex_resize_gate_empty_flush", "after_empty_flush", {
          cleaned,
          liveTailCleanupScheduled,
          refreshed,
        }, [0, 80, 180]);
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.codex_resize_gate", {
          action: "flush_empty",
          cleaned,
          elapsedMs,
          epoch,
          force,
          geometrySettled,
          hitMaxDeadline,
          liveTailCleanupScheduled,
          previousCols: previousSize?.cols || 0,
          previousRows: previousSize?.rows || 0,
          reason,
          refreshed,
          targetCols: targetSize?.cols || 0,
          targetRows: targetSize?.rows || 0,
        });
        return true;
      }

      const combinedData = concatTerminalByteArrays(queuedWrites.map((write) => write.data));
      const coalesced = coalesceCodexResizeRepaintBytes(combinedData);
      const queuedRawChunks = queuedWrites.filter((write) => write.rawCodexResizeGateData === true).length;
      const resizeNormalizerBefore = terminalOutputNormalizer.enabled
        ? {
          droppedEraseDisplay2OutsideSync: terminalOutputNormalizer.droppedEraseDisplay2OutsideSync,
          droppedEraseScrollback3: terminalOutputNormalizer.droppedEraseScrollback3,
          droppedSyncEraseDisplay2: terminalOutputNormalizer.droppedSyncEraseDisplay2,
          passedEraseDisplay2: terminalOutputNormalizer.passedEraseDisplay2,
          pendingEscapeBytes: terminalOutputNormalizer.pendingEscape.byteLength,
          syncBlocksEnded: terminalOutputNormalizer.syncBlocksEnded,
          syncBlocksSeen: terminalOutputNormalizer.syncBlocksSeen,
        }
        : null;
	      const normalizedCoalescedData = terminalOutputNormalizer.enabled && coalesced.data?.byteLength
	        ? normalizeTerminalOutputBytes(terminalOutputNormalizer, coalesced.data)
	        : coalesced.data;
      const resizeNormalizerStats = resizeNormalizerBefore
        ? {
          deltaDroppedEraseDisplay2OutsideSync:
            terminalOutputNormalizer.droppedEraseDisplay2OutsideSync
            - resizeNormalizerBefore.droppedEraseDisplay2OutsideSync,
          deltaDroppedEraseScrollback3:
            terminalOutputNormalizer.droppedEraseScrollback3 - resizeNormalizerBefore.droppedEraseScrollback3,
          deltaDroppedSyncEraseDisplay2:
            terminalOutputNormalizer.droppedSyncEraseDisplay2 - resizeNormalizerBefore.droppedSyncEraseDisplay2,
          deltaPassedEraseDisplay2:
            terminalOutputNormalizer.passedEraseDisplay2 - resizeNormalizerBefore.passedEraseDisplay2,
          deltaPendingEscapeBytes:
            terminalOutputNormalizer.pendingEscape.byteLength - resizeNormalizerBefore.pendingEscapeBytes,
          deltaSyncBlocksEnded:
            terminalOutputNormalizer.syncBlocksEnded - resizeNormalizerBefore.syncBlocksEnded,
          deltaSyncBlocksSeen:
            terminalOutputNormalizer.syncBlocksSeen - resizeNormalizerBefore.syncBlocksSeen,
        }
        : null;
      scheduleCodexResizePaintProbe("codex_resize_gate_flush", "before_coalesced_write", {
        coalescedBytes: Number(coalesced.data?.byteLength || 0),
        droppedBytes: coalesced.droppedBytes,
        framesDropped: coalesced.framesDropped,
        framesSeen: coalesced.framesSeen,
        normalizedCoalescedBytes: Number(normalizedCoalescedData?.byteLength || 0),
        queuedBytes,
        queuedChunks: queuedWrites.length,
        queuedRawChunks,
        resizeDeltaDroppedEraseDisplay2OutsideSync:
          resizeNormalizerStats?.deltaDroppedEraseDisplay2OutsideSync || 0,
        resizeDeltaDroppedEraseScrollback3: resizeNormalizerStats?.deltaDroppedEraseScrollback3 || 0,
        resizeDeltaDroppedSyncEraseDisplay2: resizeNormalizerStats?.deltaDroppedSyncEraseDisplay2 || 0,
        resizeDeltaPassedEraseDisplay2: resizeNormalizerStats?.deltaPassedEraseDisplay2 || 0,
        resizeDeltaSyncBlocksEnded: resizeNormalizerStats?.deltaSyncBlocksEnded || 0,
        resizeDeltaSyncBlocksSeen: resizeNormalizerStats?.deltaSyncBlocksSeen || 0,
        scrollToBottomAfterWrite: startedAtBottom,
      }, [0]);
      scheduleCodexResizeLiveTailCleanup("before_coalesced_write", {
        coalescedBytes: Number(coalesced.data?.byteLength || 0),
        droppedBytes: coalesced.droppedBytes,
        framesDropped: coalesced.framesDropped,
        framesSeen: coalesced.framesSeen,
        queuedBytes,
        queuedChunks: queuedWrites.length,
      }, [180, 360]);
      if (normalizedCoalescedData?.byteLength) {
        const isFirstOutputChunk = queuedWrites.some((write) => write.isFirstOutputChunk);
        const isFirstVisibleOutputChunk = queuedWrites.some((write) => write.isFirstVisibleOutputChunk);
        const visibleChars = getTerminalOutputVisibleCharCount(normalizedCoalescedData);
        enqueueTerminalOutputWrite(normalizedCoalescedData, {
          afterWriteRefreshReason: "codex_resize_gate_flush",
	          isFirstOutputChunk,
	          isFirstVisibleOutputChunk,
	          outputDebug: { visibleChars },
	          scrollToBottomBeforeWrite: true,
	          scrollToBottomAfterWrite: startedAtBottom,
	        });
      }

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.codex_resize_gate", {
        action: "flush",
        coalescedBytes: Number(coalesced.data?.byteLength || 0),
        droppedBytes: coalesced.droppedBytes,
        elapsedMs,
        epoch,
        force,
        framesDropped: coalesced.framesDropped,
        framesSeen: coalesced.framesSeen,
        geometrySettled,
        hitMaxDeadline,
        normalizedCoalescedBytes: Number(normalizedCoalescedData?.byteLength || 0),
        previousBaseY: Number(startState?.baseY || 0),
        previousCols: previousSize?.cols || 0,
        previousRows: previousSize?.rows || 0,
        previousViewportY: Number(startState?.viewportY || 0),
        queuedBytes,
        queuedChunks: queuedWrites.length,
        queuedRawChunks,
        reason,
        resizeDeltaDroppedEraseDisplay2OutsideSync:
          resizeNormalizerStats?.deltaDroppedEraseDisplay2OutsideSync || 0,
        resizeDeltaDroppedEraseScrollback3: resizeNormalizerStats?.deltaDroppedEraseScrollback3 || 0,
        resizeDeltaDroppedSyncEraseDisplay2: resizeNormalizerStats?.deltaDroppedSyncEraseDisplay2 || 0,
        resizeDeltaPassedEraseDisplay2: resizeNormalizerStats?.deltaPassedEraseDisplay2 || 0,
        resizeDeltaPendingEscapeBytes: resizeNormalizerStats?.deltaPendingEscapeBytes || 0,
        resizeDeltaSyncBlocksEnded: resizeNormalizerStats?.deltaSyncBlocksEnded || 0,
        resizeDeltaSyncBlocksSeen: resizeNormalizerStats?.deltaSyncBlocksSeen || 0,
        scrollToBottomAfterWrite: startedAtBottom,
        targetCols: targetSize?.cols || 0,
        targetRows: targetSize?.rows || 0,
      });
      return true;
    };
    markCodexResizeGateActive = (reason = "resize", size = null) => {
      if (!isCodexResizeGateEnabled() || isDisposed) {
        return;
      }

      const targetSize = normalizeCodexResizeGateSize(size) || getCurrentCodexResizeGateSize();
      if (!targetSize) {
        return;
      }

      const previousObservedSize = codexResizeGate.lastObservedSize;
      const sizeChanged = Boolean(previousObservedSize)
        && !codexResizeGateSizesEqual(previousObservedSize, targetSize);
      codexResizeGate.lastObservedSize = targetSize;

      if (!previousObservedSize) {
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.codex_resize_gate", {
          action: "prime",
          reason,
          targetCols: targetSize.cols,
          targetRows: targetSize.rows,
        });
        return;
      }

      if (
        !sizeChanged
        && (
          !codexResizeGate.active
          || codexResizeGateSizesEqual(codexResizeGate.targetSize, targetSize)
        )
      ) {
        return;
      }

      if (!sawFirstVisibleOutput && visibleOutputChunks <= 0) {
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.codex_resize_gate", {
          action: "skip_before_visible_output",
          previousCols: previousObservedSize.cols,
          previousRows: previousObservedSize.rows,
          reason,
          targetCols: targetSize.cols,
          targetRows: targetSize.rows,
        });
        return;
      }

      const now = performance.now();
      const wasActive = codexResizeGate.active;
      const startState = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
      codexResizeGate.active = true;
      codexResizeGate.epoch += 1;
      codexResizeGate.previousSize = previousObservedSize;
      codexResizeGate.startedAt = now;
      codexResizeGate.startedAtBottom = Number(startState.viewportY || 0) >= Math.max(0, Number(startState.baseY || 0) - 1);
      codexResizeGate.startState = startState;
      codexResizeGate.targetSize = targetSize;
      codexResizeGate.scrollbackCleanupUntil = Math.max(
        Number(codexResizeGate.scrollbackCleanupUntil || 0),
        now + TERMINAL_CODEX_RESIZE_SCROLLBACK_CLEANUP_MS,
      );
      codexResizeGate.liveTailCleanupUntil = Math.max(
        Number(codexResizeGate.liveTailCleanupUntil || 0),
        now + TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_MS,
      );
      if (!wasActive) {
        codexResizeGate.liveTailLastCleanedSignature = "";
        codexResizeGate.scrollbackCleanupLastHandledBaseY = 0;
        codexResizeGate.scrollbackCleanupLastTargetY = -1;
        codexResizeGate.scrollbackCleanupAnchor = getTerminalViewportAnchorDiagnostic(terminal);
        codexResizeGate.scrollbackCleanupStartBaseY = Number(startState.baseY || 0);
        codexResizeGate.scrollbackCleanupStartedAtBottom = codexResizeGate.startedAtBottom;
        codexResizeGate.scrollbackCleanupStartViewportY = Number(startState.viewportY || 0);
      }

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.codex_resize_gate", {
        action: wasActive ? "retarget" : "start",
        epoch: codexResizeGate.epoch,
        previousBaseY: Number(startState.baseY || 0),
        previousCols: previousObservedSize.cols,
        previousRows: previousObservedSize.rows,
        previousViewportY: Number(startState.viewportY || 0),
        reason,
        liveTailCleanupUntil: Number(codexResizeGate.liveTailCleanupUntil || 0),
        startedAtBottom: codexResizeGate.startedAtBottom,
        scrollbackCleanupStartBaseY: codexResizeGate.scrollbackCleanupStartBaseY,
        scrollbackCleanupAnchorRows: Number(codexResizeGate.scrollbackCleanupAnchor?.rowCount || 0),
        scrollbackCleanupAnchorViewportY: Number(codexResizeGate.scrollbackCleanupAnchor?.viewportY || 0),
        scrollbackCleanupStartViewportY: codexResizeGate.scrollbackCleanupStartViewportY,
        scrollbackCleanupStartedAtBottom: codexResizeGate.scrollbackCleanupStartedAtBottom,
        targetCols: targetSize.cols,
        targetRows: targetSize.rows,
      });
      scheduleCodexResizePaintProbe(reason, wasActive ? "gate_retarget" : "gate_start", {
        previousCols: previousObservedSize.cols,
        previousRows: previousObservedSize.rows,
        targetCols: targetSize.cols,
        targetRows: targetSize.rows,
      }, [0]);

      scheduleCodexResizeGateFlush(reason, TERMINAL_CODEX_RESIZE_GATE_SETTLE_MS, {
        allowLater: true,
      });
    };
    const writeTerminalOutput = (data, options = {}) => {
      if (
        isCodexResizeGateEnabled()
        && codexResizeGate.active
        && data?.byteLength
      ) {
        const queuedData = typeof data.slice === "function" ? data.slice() : new Uint8Array(data);
        if (codexResizeGate.queuedBytes + queuedData.byteLength > TERMINAL_CODEX_RESIZE_GATE_MAX_BYTES) {
          flushCodexResizeGate("max_bytes", true);
        }

        if (codexResizeGate.active) {
          codexResizeGate.queuedWrites.push({
            data: queuedData,
            isFirstOutputChunk: options.isFirstOutputChunk === true,
            isFirstVisibleOutputChunk: options.isFirstVisibleOutputChunk === true,
            rawCodexResizeGateData: options.rawCodexResizeGateData === true,
          });
          codexResizeGate.queuedBytes += queuedData.byteLength;
          scheduleCodexResizeGateFlush("output");
          return;
        }
      }

      enqueueTerminalOutputWrite(data, options);
    };
    disposables.push(() => {
      clearCodexResizeGateTimer();
      codexResizeGate.active = false;
      codexResizeGate.flushDueAt = 0;
      codexResizeGate.lastObservedSize = null;
      codexResizeGate.lastOutputPaintProbeAt = 0;
      codexResizeGate.liveTailCleanupSequence = 0;
      codexResizeGate.liveTailCleanupUntil = 0;
      codexResizeGate.liveTailLastCleanedSignature = "";
      codexResizeGate.paintProbeUntil = 0;
      codexResizeGate.previousSize = null;
      codexResizeGate.queuedWrites.length = 0;
      codexResizeGate.queuedBytes = 0;
      codexResizeGate.scrollbackCleanupAnchor = null;
      codexResizeGate.scrollbackCleanupLastHandledBaseY = 0;
      codexResizeGate.scrollbackCleanupLastTargetY = -1;
      codexResizeGate.scrollbackCleanupStartBaseY = 0;
      codexResizeGate.scrollbackCleanupStartedAtBottom = false;
      codexResizeGate.scrollbackCleanupStartViewportY = 0;
      codexResizeGate.scrollbackCleanupUntil = 0;
      codexResizeGate.startedAt = 0;
      codexResizeGate.startedAtBottom = false;
      codexResizeGate.startState = null;
      codexResizeGate.targetSize = null;
    });

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

        patchTerminalMetrics({
          gridMs: event.elapsedMs,
          resizeLagMs: event.elapsedMs,
        });
        addTerminalMetrics({
          resizeBatches: 1,
          resizePanes: 1,
        });
        syncTerminalPaintBounds("resize_done");
        scheduleTerminalPaintBoundsSync("resize_done_settled", [34, 120, 260]);
        scheduleCodexResizeGateFlush(event.reason || "resize_done");
      },
      onError: () => {},
      onStart: (event) => {
        markCodexResizeGateActive(event.reason || "resize_start", event);
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

          const deferCodexResizeNormalization = terminalOutputNormalizer.enabled
            && isCodexResizeGateEnabled()
            && codexResizeGate.active;
          const normalizerBefore = terminalOutputNormalizer.enabled && !deferCodexResizeNormalization
            ? {
              droppedEraseDisplay2OutsideSync: terminalOutputNormalizer.droppedEraseDisplay2OutsideSync,
              droppedEraseScrollback3: terminalOutputNormalizer.droppedEraseScrollback3,
              droppedSyncEraseDisplay2: terminalOutputNormalizer.droppedSyncEraseDisplay2,
              passedEraseDisplay2: terminalOutputNormalizer.passedEraseDisplay2,
              pendingEscapeBytes: terminalOutputNormalizer.pendingEscape.byteLength,
              syncBlocksEnded: terminalOutputNormalizer.syncBlocksEnded,
              syncBlocksSeen: terminalOutputNormalizer.syncBlocksSeen,
            }
            : null;
          const terminalData = deferCodexResizeNormalization
            ? displayData
            : (
              terminalOutputNormalizer.enabled
                ? normalizeTerminalOutputBytes(terminalOutputNormalizer, displayData)
                : displayData
            );
          const normalizerChanged = normalizerBefore
            ? (
              terminalOutputNormalizer.droppedEraseDisplay2OutsideSync !== normalizerBefore.droppedEraseDisplay2OutsideSync
              || terminalOutputNormalizer.droppedEraseScrollback3 !== normalizerBefore.droppedEraseScrollback3
              || terminalOutputNormalizer.droppedSyncEraseDisplay2 !== normalizerBefore.droppedSyncEraseDisplay2
              || terminalOutputNormalizer.passedEraseDisplay2 !== normalizerBefore.passedEraseDisplay2
              || terminalOutputNormalizer.pendingEscape.byteLength !== normalizerBefore.pendingEscapeBytes
              || terminalOutputNormalizer.syncBlocksEnded !== normalizerBefore.syncBlocksEnded
              || terminalOutputNormalizer.syncBlocksSeen !== normalizerBefore.syncBlocksSeen
            )
            : false;
          const normalizerStats = normalizerBefore
            ? {
              changed: normalizerChanged,
              deltaDroppedEraseDisplay2OutsideSync:
                terminalOutputNormalizer.droppedEraseDisplay2OutsideSync
                - normalizerBefore.droppedEraseDisplay2OutsideSync,
              deltaDroppedEraseScrollback3:
                terminalOutputNormalizer.droppedEraseScrollback3 - normalizerBefore.droppedEraseScrollback3,
              deltaDroppedSyncEraseDisplay2:
                terminalOutputNormalizer.droppedSyncEraseDisplay2 - normalizerBefore.droppedSyncEraseDisplay2,
              deltaPassedEraseDisplay2:
                terminalOutputNormalizer.passedEraseDisplay2 - normalizerBefore.passedEraseDisplay2,
              deltaPendingEscapeBytes:
                terminalOutputNormalizer.pendingEscape.byteLength - normalizerBefore.pendingEscapeBytes,
              deltaSyncBlocksEnded:
                terminalOutputNormalizer.syncBlocksEnded - normalizerBefore.syncBlocksEnded,
              deltaSyncBlocksSeen:
                terminalOutputNormalizer.syncBlocksSeen - normalizerBefore.syncBlocksSeen,
              displayBytes: displayData.byteLength,
              outputBytes: terminalData.byteLength,
            }
            : null;

          if (deferCodexResizeNormalization) {
            logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.output_normalized", {
              action: "defer_codex_resize_gate",
              displayBytes: displayData.byteLength,
              outputBytes: terminalData.byteLength,
              pendingEscapeBytes: terminalOutputNormalizer.pendingEscape.byteLength,
            });
          }

          if (normalizerChanged) {
            logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.output_normalized", {
              displayBytes: displayData.byteLength,
              deltaDroppedEraseDisplay2OutsideSync:
                normalizerStats?.deltaDroppedEraseDisplay2OutsideSync || 0,
              deltaDroppedEraseScrollback3: normalizerStats?.deltaDroppedEraseScrollback3 || 0,
              deltaDroppedSyncEraseDisplay2: normalizerStats?.deltaDroppedSyncEraseDisplay2 || 0,
              deltaPassedEraseDisplay2: normalizerStats?.deltaPassedEraseDisplay2 || 0,
              deltaPendingEscapeBytes: normalizerStats?.deltaPendingEscapeBytes || 0,
              deltaSyncBlocksEnded: normalizerStats?.deltaSyncBlocksEnded || 0,
              deltaSyncBlocksSeen: normalizerStats?.deltaSyncBlocksSeen || 0,
              dropEraseDisplay2OutsideSync: terminalOutputNormalizer.dropEraseDisplay2OutsideSync,
              droppedEraseDisplay2OutsideSync:
                terminalOutputNormalizer.droppedEraseDisplay2OutsideSync,
              droppedEraseScrollback3: terminalOutputNormalizer.droppedEraseScrollback3,
              droppedSyncEraseDisplay2: terminalOutputNormalizer.droppedSyncEraseDisplay2,
              inSyncOutput: terminalOutputNormalizer.inSyncOutput,
              outputBytes: terminalData.byteLength,
              passedEraseDisplay2: terminalOutputNormalizer.passedEraseDisplay2,
              pendingEscapeBytes: terminalOutputNormalizer.pendingEscape.byteLength,
              syncBlocksEnded: terminalOutputNormalizer.syncBlocksEnded,
              syncBlocksSeen: terminalOutputNormalizer.syncBlocksSeen,
            });
          }

          if (!terminalData.byteLength) {
            return;
          }

          const isFirstOutputChunk = !sawFirstOutput;
          outputChunks += 1;
          outputBytes += terminalData.byteLength;
          const outputByteStats = terminalDiagnosticsEnabled
            ? getTerminalOutputByteStats(terminalData)
            : null;
          const visibleChars = outputByteStats
            ? outputByteStats.visibleChars
            : getTerminalOutputVisibleCharCount(terminalData, 1);
          const hasVisibleOutput = visibleChars > 0;
          const isFirstVisibleOutputChunk = hasVisibleOutput && !sawFirstVisibleOutput;
          const shouldCollectOutputDebug = isFirstOutputChunk
            || isFirstVisibleOutputChunk;
          const debugStartedAt = shouldCollectOutputDebug ? performance.now() : 0;
          const outputDebug = shouldCollectOutputDebug
            ? getTerminalOutputDebugFields(terminalData)
            : { visibleChars };
          const debugMs = shouldCollectOutputDebug ? performance.now() - debugStartedAt : 0;
          if (terminalDiagnosticsEnabled) {
            outputDiagnosticChunks += 1;
            outputDiagnosticInputBytes += data.byteLength;
            outputDiagnosticDisplayBytes += terminalData.byteLength;
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
            visibleOutputBytes += terminalData.byteLength;
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
              displayBytes: terminalData.byteLength,
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

          writeTerminalOutput(terminalData, {
            isFirstOutputChunk,
            isFirstVisibleOutputChunk,
            outputDebug,
            rawCodexResizeGateData: deferCodexResizeNormalization,
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

          if (!startupControlReply && isCodexResizePaintProbeActive()) {
            const inputDebug = getTerminalInputDebugFields(safeData);
            logCodexResizePaintProbe("terminal_input", "before_input_write", {
              hasNewline: safeData.includes("\n"),
              hasReturn: safeData.includes("\r"),
              inputDebug,
              startsWithEscape: safeData.startsWith("\x1b"),
            });
            scheduleCodexResizePaintProbe("terminal_input", "after_input_write", {
              hasNewline: safeData.includes("\n"),
              hasReturn: safeData.includes("\r"),
              inputBytes: inputDebug.bytes,
              startsWithEscape: safeData.startsWith("\x1b"),
            });
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
  }, [activateTerminalPane, agent?.id, agent?.label, focusTerminalKeyboardInput, isGenericTerminal, onPreparedTerminalChange, paneId, requestTerminalAudioInputTarget, restartKey, terminalAgentKind, terminalClosed, terminalRoleId, terminalScrollStabilityMode, useNormalizerAgentScrollStability, useWebglRenderer, workingDirectory, workspace?.id]);

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

  const xtermSurface = (
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
  );

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
            {xtermSurface}
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

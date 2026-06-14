import { Channel, invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  collapseFunctionalRepoPathToCoreRepoPath,
  createCoreRepoNameDisplayMasker,
} from "../coreRepoNameDisplay";
import {
  TERMINAL_WINDOW_CONTROL_CLOSE_TERMINAL,
  TERMINAL_WINDOW_CONTROL_EVENT,
  TERMINAL_WINDOW_CONTROL_FULLSCREEN,
  TERMINAL_WINDOW_CONTROL_RESTART_AS,
  TERMINAL_WINDOW_CONTROL_SPLIT_HORIZONTAL,
  TERMINAL_WINDOW_CONTROL_SPLIT_VERTICAL,
  TERMINAL_WINDOW_CONTROL_UI_VIEW,
  TERMINAL_WINDOW_META_EVENT,
  TERMINAL_WINDOW_META_REQUEST_EVENT,
} from "../terminalWindowBridge.js";
import {
  TODO_QUEUE_SOURCE_TERMINAL_DIRECT,
} from "../todoQueueSources.js";
import { createTerminalOutputWorkerSession } from "./terminalOutputWorkerClient.js";
import { guardXtermDuringPushToTalk } from "../xtermPushToTalkGuard.js";
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
  TerminalInlineUiView,
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
  TerminalRailIdentity,
  TerminalAgentLabel,
  TerminalAgentDot,
  TerminalStateDebugBadge,
  TerminalRailControls,
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
} from "../../app/appStyles";
import {
  createTerminalResizeController,
  measureTerminalGrid,
} from "../terminalResizeController";
import {
  getTerminalDiagnosticEnvironment,
  isTerminalDiagnosticLoggingEnabled,
  logTerminalDiagnosticDuration,
  logTerminalDiagnosticEvent,
  startTerminalDiagnosticHeartbeat,
  syncTerminalDiagnosticLogging,
} from "../terminalDiagnostics";
import {
  isWindowsTerminalDiagnosticLoggingEnabled,
  logWindowsTerminalDiagnosticEvent,
  syncWindowsTerminalDiagnosticLogging,
} from "../windowsTerminalDiagnostics";
import {
  addTerminalMetrics,
  patchTerminalMetrics,
} from "../terminalTelemetry.jsx";
import {
  TERMINAL_IS_WINDOWS_HOST,
  TERMINAL_WINDOWS_INTERESTING_DEC_PRIVATE_MODES,
  TERMINAL_WINDOWS_PTY_BACKEND,
  buildWindowsPtyOptions,
} from "../terminalScrollStabilityStrategies.jsx";
import {
  stripLiveViewControlSequences,
} from "../liveViewSanitizer.js";
import WorkspaceThreadsOverlay from "../../threads/WorkspaceThreadsOverlay.jsx";
import WorkspaceThreadDetail from "../../threads/WorkspaceThreadDetail.jsx";
import {
  getBigViewTextDiagnosticFields,
  logBigViewSyncDiagnosticEvent,
  logFileDragDiagnosticEvent,
} from "../../threads/bigViewSyncDiagnostics";
import {
  isTerminalControlHistoryPrompt,
  isTerminalModelPickerUiPrompt,
} from "../../threads/terminalControlPrompts.js";
import {
  parseTerminalStateTimestampMs,
  shouldSuppressThreadPropThinking,
  terminalAgentUsesActivityHooks,
} from "../terminalActivityState.js";
import {
  createWorkspaceThreadId,
  getWorkspaceThreadTerminalNickname,
  getWorkspaceThreadProviderBinding,
} from "../../threads/workspaceThreads";
import {
  MAX_WORKSPACE_TERMINAL_COUNT,
  TERMINAL_AUDIO_INPUT_REFOCUS_EVENT,
  TERMINAL_BACKEND_PREP_DETAIL_MS,
  TERMINAL_BLANK_STARTUP_CONFIRM_MS,
  TERMINAL_BLANK_STARTUP_PROBE_MS,
  TERMINAL_CLAUDE_RESIZE_BLANK_FRAME_GUARD_MS,
  TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_CHARS,
  TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_ROWS,
  TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_RATIO,
  TERMINAL_CODEX_RESIZE_GATE_MAX_BYTES,
  TERMINAL_CODEX_RESIZE_GATE_MAX_MS,
  TERMINAL_CODEX_RESIZE_GATE_RETRY_MS,
  TERMINAL_CODEX_RESIZE_GATE_SETTLE_MS,
  TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_DELAYS_MS,
  TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_MS,
  TERMINAL_CODEX_RESIZE_OUTPUT_PROBE_THROTTLE_MS,
  TERMINAL_CODEX_RESIZE_PAINT_PROBE_DELAYS_MS,
  TERMINAL_CODEX_RESIZE_PAINT_PROBE_WINDOW_MS,
  TERMINAL_CODEX_RESIZE_SCROLLBACK_CLEANUP_MS,
  TERMINAL_CODEX_SLASH_MENU_CLOSE_CLEANUP_DELAYS_MS,
  TERMINAL_CODEX_SLASH_MENU_CLOSE_CLEANUP_MS,
  TERMINAL_CODEX_SLASH_MENU_CLOSE_OUTPUT_QUIET_MS,
  TERMINAL_BACKGROUND_SCROLLBACK_ROWS,
  TERMINAL_DEFAULT_COLS,
  TERMINAL_DEFAULT_ROWS,
  TERMINAL_DEFAULT_SCROLLBACK_ROWS,
  TERMINAL_DELETE_INPUT_BATCH_MS,
  TERMINAL_ENABLE_WEBGL_RENDERER,
  TERMINAL_ENTER_SEQUENCE,
  TERMINAL_ENTER_SEQUENCE_MOD1,
  TERMINAL_INPUT_BATCH_MAX_CHARS,
  TERMINAL_INPUT_BATCH_MS,
  TERMINAL_INPUT_EVENT,
  TERMINAL_INPUT_ERROR_EVENT,
  TERMINAL_INPUT_HOT_EVENT,
  TERMINAL_MAX_COLS,
  TERMINAL_MAX_ROWS,
  TERMINAL_MIN_COLS,
  TERMINAL_MIN_ROWS,
  TERMINAL_OUTPUT_BATCH_MAX_BYTES,
  TERMINAL_OUTPUT_BATCH_MAX_MS,
  TERMINAL_OUTPUT_CHUNK_DIAGNOSTIC_SLOW_MS,
  TERMINAL_OUTPUT_DIAGNOSTIC_WINDOW_MS,
  TERMINAL_OUTPUT_FLUSH_ACTIVE_MAX_BYTES,
  TERMINAL_OUTPUT_FLUSH_BACKGROUND_MAX_BYTES,
  TERMINAL_OUTPUT_FLUSH_MIN_BYTES,
  TERMINAL_OUTPUT_WRITE_DIAGNOSTIC_SLOW_MS,
  TERMINAL_OUTPUT_WRITE_MIN_BYTES,
  TERMINAL_OUTPUT_WRITE_TARGET_MS,
  TERMINAL_PARKED_PROMPT_EVENT,
  TERMINAL_SHIFT_ENTER_SEQUENCE,
  TERMINAL_SLASH_COMMAND_MAX_LINE_CHARS,
  TERMINAL_SLASH_COMMAND_OUTPUT_PROBE_DELAYS_MS,
  TERMINAL_SLASH_COMMAND_OUTPUT_PROBE_THROTTLE_MS,
  TERMINAL_SLASH_COMMAND_PROBE_DELAYS_MS,
  TERMINAL_SLASH_COMMAND_PROBE_WINDOW_MS,
  TERMINAL_STABILITY_RESIZE_PROBE_DELAYS_MS,
  TERMINAL_SUBMIT_DIAGNOSTIC_SNAPSHOT_REQUEST_EVENT,
  TERMINAL_START_GEOMETRY_POLL_MS,
  TERMINAL_START_GEOMETRY_WAIT_MS,
  TERMINAL_START_LAYOUT_HIDDEN_POLL_MS,
  TERMINAL_START_LAYOUT_STILL_WAITING_LOG_MS,
  TERMINAL_START_LAYOUT_WAIT_MS,
  TERMINAL_START_METRIC_POLL_MS,
  TERMINAL_START_METRIC_STILL_WAITING_LOG_MS,
  TERMINAL_START_METRIC_WAIT_MS,
  TERMINAL_THEME_BACKGROUND,
  TERMINAL_TRANSIENT_HEADER_ARTIFACT_CLEANUP_DELAYS_MS,
  TERMINAL_TRANSIENT_HEADER_ARTIFACT_CLEANUP_MS,
  TERMINAL_TRANSIENT_HEADER_ARTIFACT_MAX_RETRIES,
  TERMINAL_TRANSIENT_HEADER_ARTIFACT_OUTPUT_QUIET_MS,
  TERMINAL_TRANSIENT_HEADER_ARTIFACT_REDRAW_QUIET_MS,
  TERMINAL_TRANSIENT_HEADER_ARTIFACT_RETRY_MS,
  TERMINAL_TRANSIENT_HEADER_ARTIFACT_STABLE_PLAN_MS,
  TERMINAL_WEBGL_BACKGROUND_DELAY_MS,
  TERMINAL_WEBGL_FIRST_OUTPUT_DELAY_MS,
  TERMINAL_WEBGL_IDLE_DELAY_MS,
  TERMINAL_WEBGL_MAX_DELAY_MS,
  TERMINAL_WEBGL_STAGGER_MS,
  WORKSPACE_THREAD_ARCHIVE_TERMINAL_RESET_EVENT,
  adjustTerminalRowAfterDeletion,
  applyCodexResizeTopArtifactPurge,
  applyTerminalTransientHeaderArtifactCleanup,
  buildTerminalComposerDraftInput,
  clearActiveTerminalKeyboardTargetIfCurrent,
  coalesceCodexResizeRepaintBytes,
  codexResizeGateSizesEqual,
  concatTerminalByteArrays,
  createCodexResizeGateState,
  createCodexSlashMenuCloseCleanupState,
  createSlashCommandDiagnosticState,
  extractNativeSessionIdFromOutput,
  findTerminalViewportAnchorMatch,
  getClaudeResizeDuplicateRepaintDecision,
  getCodexResizeLiveTailCleanupPlan,
  getCodexResizeTopArtifactAdjustment,
  getCodexResizeTopArtifactPurgePlan,
  getCsiParamNumbers,
  getFirstCsiParam,
  getTerminalAgentKind,
  getTerminalBufferDiagnostics,
  getTerminalBufferRowsDiagnostic,
  getTerminalCursorHomeDiagnostic,
  getTerminalInputDebugFields,
  getTerminalOutputByteStats,
  getTerminalOutputControlProfile,
  getTerminalOutputDebugFields,
  getTerminalOutputVisibleByteEstimate,
  getTerminalOutputVisibleCharCount,
  getTerminalRendererPaintDiagnostics,
  getTerminalSlashCommandInputSummary,
  getTerminalSlashCommandLineSnapshot,
  getTerminalStabilityFeatureFlags,
  getTerminalTransientHeaderArtifactCleanupPlan,
  getTerminalViewportAnchorDiagnostic,
  getWindowsTerminalCompactState,
  isTerminalSlashCommandDiagnosticAgentKind,
  isWindowsTerminalGeometrySettled,
  logThreadBridgeDiagnostic,
  normalizeCodexResizeGateSize,
  sanitizeTerminalDiagnosticText,
  setActiveTerminalKeyboardTarget,
  TERMINAL_PROMPT_SUBMITTED_EVENT,
  terminalGlobalRenderScheduler,
  terminalKeyboardTargetMatches,
} from "./terminalCore.js";
import {
  TODO_DROP_OVERLAY_LABEL_STYLE,
  TODO_DROP_OVERLAY_STYLE,
  TODO_DROP_OVERLAY_TARGET_STYLE,
  TERMINAL_FULLSCREEN_RESIZE_DELAYS_MS,
  TERMINAL_SCROLLBAR_PLATFORM,
  applyTerminalInputChunkToComposer,
  buildProviderTurnErrorProjectionEvents,
  buildProviderTurnProjectionEvents,
  buildProviderTurnStartProjectionEvents,
  buildTerminalSubmittedInput,
  clearWorkspaceThreadComposerDraftIfRevision,
  closeWorkspaceTerminalPane,
  createTerminalComposerState,
  createTerminalPromptSubmittedWaiter,
  createThreadProjectionToken,
  createWorkspaceThreadPromptAcceptedWaiter,
  getAgentStatusSummary,
  getAgentTone,
  getDefaultTerminalIndexes,
  getDraggedTodoPrompt,
  getDraggedWorkspaceFile,
  getErrorMessage,
  getNextWorkspaceTerminalInstanceId,
  getPlainDomRect,
  getTerminalAgentColorSlot,
  getTerminalPanelRows,
  getTerminalPaneMinSizePercent,
  getTerminalRoleSwitchOptions,
  getTerminalSubmitSequence,
  getTerminalComposerSnapshot,
  getTerminalComposerText,
  getEventTargetElement,
  getWorkspaceTerminalPaneId,
  getWorkspaceThreadComposerAttachments,
  getWorkspaceThreadComposerAttachmentSnapshot,
  getWorkspaceThreadComposerDraftSnapshot,
  getWorkspaceThreadComposerDraftStore,
  getWorkspaceThreadTerminalTarget,
  getThreadComposerSyncKey,
  isPlainShiftEnterEvent,
  isTerminalControlEventTarget,
  isTerminalGeneratedReplyInput,
  isTerminalSessionMissingError,
  isTodoDragTransfer,
  isWorkspaceFileDragTransfer,
  normalizeTerminalDimension,
  normalizeWorkspaceTerminalIndexes,
  appendWorkspaceThreadComposerAttachments,
  removeWorkspaceThreadComposerAttachment,
  setTerminalComposerText,
  setWorkspaceThreadComposerDraft,
  setWorkspaceThreadComposerAttachments,
  subscribeWorkspaceThreadComposerAttachments,
  subscribeWorkspaceThreadComposerDrafts,
  terminalInputChunkHasVisibleText,
  terminalInputChunkVisibleText,
  waitForWorkspaceThreadPromptAcceptedWithEnterRetries,
  warmTerminalPromptSubmittedListener,
  workspaceFileToComposerAttachment,
} from "./threadRuntime.js";
import { logTerminalStatus } from "../terminalStatusLog.js";
import {
  terminalPromptSubmittedPayloadIsAuthoritative,
} from "../terminalPromptSubmission.js";

export {
  TERMINAL_INPUT_HOT_EVENT,
  WORKSPACE_THREAD_ARCHIVE_TERMINAL_RESET_EVENT,
} from "./terminalCore.js";
export {
  closeWorkspaceTerminalPane,
  getDefaultTerminalIndexes,
  getTerminalAgentColorSlot,
  getTerminalPanelRows,
  getTerminalPaneMinSizePercent,
  getWorkspaceTerminalPaneId,
  normalizeWorkspaceTerminalIndexes,
} from "./threadRuntime.js";

function terminalInputDataIsSubmit(value) {
  const text = String(value || "");
  return text.includes("\r")
    || text.includes("\n")
    || text.includes(TERMINAL_ENTER_SEQUENCE)
    || text.includes(TERMINAL_ENTER_SEQUENCE_MOD1);
}

const TERMINAL_INPUT_TRANSPORT_BUFFERED_LIMIT_BYTES = 512 * 1024;
const TERMINAL_INPUT_TRANSPORT_QUEUE_LIMIT = 4096;
const TERMINAL_INPUT_TRANSPORT_RETRY_MS = 4;

let terminalInputTransportEndpoint = null;
let terminalInputTransportSocket = null;
let terminalInputTransportConnectPromise = null;
let terminalInputTransportFlushTimer = 0;
let terminalInputTransportFallbackPromise = null;
let terminalInputTransportQueue = [];
let terminalInputTransportNextMessageId = 1;
const terminalInputTransportPendingAcks = new Map();

function isTerminalInputTransportAvailable() {
  return typeof WebSocket !== "undefined";
}

function isTerminalInputTransportOpen() {
  return (
    isTerminalInputTransportAvailable()
    && terminalInputTransportSocket?.readyState === WebSocket.OPEN
  );
}

function cleanTerminalInputTransportPayload(payload) {
  const cleanPayload = {};
  Object.entries(payload || {}).forEach(([key, value]) => {
    if (value !== undefined) {
      cleanPayload[key] = value;
    }
  });
  return cleanPayload;
}

function getTerminalDirectTodoSafePromptId(promptEventId) {
  return String(promptEventId || "")
    .trim()
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .slice(0, 160);
}

function getTerminalDirectTodoRefs(promptEventId) {
  const safePromptId = getTerminalDirectTodoSafePromptId(promptEventId);
  if (!safePromptId) {
    return null;
  }
  return {
    todoAction: "dispatch",
    todoCommandId: `terminal-direct-command-${safePromptId}`,
    todoDispatchId: `terminal-direct-dispatch-${safePromptId}`,
    todoId: `terminal-direct-${safePromptId}`,
  };
}

function getTerminalInputTransportLogFields(payload = {}, extra = {}) {
  const data = String(payload?.data || "");
  return {
    data: getTerminalInputDebugFields(data),
    hasPromptEventId: Boolean(String(payload?.promptEventId || "").trim()),
    hasPromptEventText: Boolean(String(payload?.promptEventText || "").trim()),
    instanceId: payload?.instanceId || "",
    isSubmitInput: terminalInputDataIsSubmit(data),
    paneId: payload?.paneId || "",
    promptEventId: String(payload?.promptEventId || "").trim(),
    promptEventSource: String(payload?.promptEventSource || "").trim(),
    promptTextLength: String(payload?.promptEventText || "").trim().length,
    threadId: payload?.threadId || "",
    todoId: String(payload?.todoId || "").trim(),
    ...extra,
  };
}

function logTerminalInputTransportSubmit(phase, payload, extra = {}) {
  if (!payload?.promptEventId && !payload?.promptEventText) {
    return;
  }

  logTerminalStatus(
    phase,
    getTerminalInputTransportLogFields(payload, extra),
  );
}

function invokeTerminalInputPayload(payload) {
  return invoke("terminal_write", {
    data: payload?.data || "",
    instanceId: payload?.instanceId,
    paneId: payload?.paneId,
    promptEventId: payload?.promptEventId,
    promptEventRevision: payload?.promptEventRevision,
    promptEventSource: payload?.promptEventSource,
    promptEventSubmittedAt: payload?.promptEventSubmittedAt,
    promptEventText: payload?.promptEventText,
    todoAction: payload?.todoAction,
    todoCommandId: payload?.todoCommandId,
    todoDispatchId: payload?.todoDispatchId,
    todoId: payload?.todoId,
    threadId: payload?.threadId,
  });
}

function scheduleTerminalInputTransportFlush(delayMs = 0) {
  if (terminalInputTransportFlushTimer || typeof window === "undefined") {
    return;
  }
  terminalInputTransportFlushTimer = window.setTimeout(() => {
    terminalInputTransportFlushTimer = 0;
    flushTerminalInputTransportQueue();
  }, delayMs);
}

function fallbackTerminalInputTransportQueue() {
  if (terminalInputTransportFallbackPromise) {
    return terminalInputTransportFallbackPromise;
  }

  const queuedEntries = terminalInputTransportQueue.splice(0);
  terminalInputTransportFallbackPromise = queuedEntries
    .reduce(
      (promise, entry) => promise
        .then(() => {
          logTerminalInputTransportSubmit("frontend.terminal_input_transport.fallback_emit", entry.payload, {
            messageId: entry.messageId,
            reason: "transport_unavailable",
          });
          return entry.messageId
            ? invokeTerminalInputPayload(entry.payload)
            : emit(TERMINAL_INPUT_EVENT, entry.payload);
        })
        .then((result) => {
          entry.resolveAck?.(result);
          return result;
        })
        .catch((error) => {
          entry.rejectAck?.(error);
        }),
      Promise.resolve(),
    )
    .finally(() => {
      terminalInputTransportFallbackPromise = null;
    });
  return terminalInputTransportFallbackPromise;
}

function rejectTerminalInputTransportPendingAcks(error) {
  Array.from(terminalInputTransportPendingAcks.values()).forEach((ack) => {
    ack.reject(error);
  });
}

function resetTerminalInputTransportSocket(socket) {
  if (terminalInputTransportSocket === socket) {
    terminalInputTransportSocket = null;
  }
}

function handleTerminalInputTransportMessage(event) {
  let message = null;
  try {
    message = JSON.parse(String(event?.data || ""));
  } catch {
    return;
  }
  if (message?.type !== "terminal-input-ack" || !message.messageId) {
    return;
  }

  const ack = terminalInputTransportPendingAcks.get(message.messageId);
  if (!ack) {
    return;
  }
  logTerminalStatus("frontend.terminal_input_transport.ack", {
    ...(ack.fields || {}),
    error: message.ok ? "" : String(message.error || ""),
    messageId: message.messageId,
    ok: Boolean(message.ok),
  });
  if (message.ok) {
    ack.resolve(message);
  } else {
    ack.reject(new Error(message.error || "Terminal input write failed."));
  }
}

function createTerminalInputTransportEntry(payload, waitForAck = false) {
  const entry = {
    logFields: waitForAck ? getTerminalInputTransportLogFields(payload) : null,
    messageId: "",
    payload,
    rejectAck: null,
    resolveAck: null,
    waitPromise: null,
  };

  if (!waitForAck) {
    return entry;
  }

  const messageId = `terminal-input-${Date.now().toString(36)}-${terminalInputTransportNextMessageId.toString(36)}`;
  terminalInputTransportNextMessageId += 1;
  entry.messageId = messageId;
  entry.waitPromise = new Promise((resolve, reject) => {
    const finish = (callback, value) => {
      const ack = terminalInputTransportPendingAcks.get(messageId);
      if (ack?.timer) {
        window.clearTimeout(ack.timer);
      }
      terminalInputTransportPendingAcks.delete(messageId);
      callback(value);
    };
    entry.resolveAck = (value) => finish(resolve, value);
    entry.rejectAck = (error) => finish(reject, error);
    const timer = typeof window !== "undefined"
      ? window.setTimeout(() => {
        entry.rejectAck?.(new Error("Terminal input write acknowledgement timed out."));
      }, 8000)
      : 0;
    terminalInputTransportPendingAcks.set(messageId, {
      fields: entry.logFields,
      reject: entry.rejectAck,
      resolve: entry.resolveAck,
      timer,
    });
  });
  return entry;
}

function sendTerminalInputTransportEntry(socket, entry) {
  socket.send(JSON.stringify({
    token: terminalInputTransportEndpoint.token,
    ...(entry.messageId ? { messageId: entry.messageId } : {}),
    payload: entry.payload,
  }));
}

function ensureTerminalInputTransport() {
  if (!isTerminalInputTransportAvailable()) {
    return Promise.reject(new Error("Terminal input WebSocket transport is unavailable."));
  }
  if (isTerminalInputTransportOpen()) {
    return Promise.resolve(terminalInputTransportSocket);
  }
  if (terminalInputTransportConnectPromise) {
    return terminalInputTransportConnectPromise;
  }

  terminalInputTransportConnectPromise = Promise.resolve(terminalInputTransportEndpoint)
    .then((endpoint) => endpoint || invoke("terminal_input_transport_endpoint"))
    .then((endpoint) => {
      terminalInputTransportEndpoint = endpoint;
      return new Promise((resolve, reject) => {
        let settled = false;
        const socket = new WebSocket(endpoint.url);
        socket.onopen = () => {
          settled = true;
          terminalInputTransportSocket = socket;
          terminalInputTransportConnectPromise = null;
          socket.onmessage = handleTerminalInputTransportMessage;
          flushTerminalInputTransportQueue();
          resolve(socket);
        };
        socket.onclose = () => {
          resetTerminalInputTransportSocket(socket);
          rejectTerminalInputTransportPendingAcks(new Error("Terminal input WebSocket transport closed."));
          if (!settled) {
            terminalInputTransportConnectPromise = null;
            reject(new Error("Terminal input WebSocket transport closed before opening."));
          }
        };
        socket.onerror = () => {
          if (!settled) {
            terminalInputTransportConnectPromise = null;
            reject(new Error("Terminal input WebSocket transport failed."));
          }
        };
      });
    })
    .catch((error) => {
      terminalInputTransportConnectPromise = null;
      throw error;
    });

  return terminalInputTransportConnectPromise;
}

function flushTerminalInputTransportQueue() {
  if (!terminalInputTransportQueue.length) {
    return;
  }

  if (!isTerminalInputTransportOpen() || !terminalInputTransportEndpoint?.token) {
    ensureTerminalInputTransport().catch(() => {
      fallbackTerminalInputTransportQueue();
    });
    return;
  }

  const socket = terminalInputTransportSocket;
  while (
    terminalInputTransportQueue.length
    && socket.bufferedAmount < TERMINAL_INPUT_TRANSPORT_BUFFERED_LIMIT_BYTES
  ) {
    const entry = terminalInputTransportQueue.shift();
    try {
      sendTerminalInputTransportEntry(socket, entry);
      logTerminalInputTransportSubmit("frontend.terminal_input_transport.sent", entry.payload, {
        messageId: entry.messageId,
        socketBufferedAmount: socket.bufferedAmount,
        waitForAck: Boolean(entry.messageId),
      });
    } catch {
      terminalInputTransportQueue.unshift(entry);
      resetTerminalInputTransportSocket(socket);
      ensureTerminalInputTransport().catch(() => {
        fallbackTerminalInputTransportQueue();
      });
      return;
    }
  }

  if (terminalInputTransportQueue.length) {
    scheduleTerminalInputTransportFlush(TERMINAL_INPUT_TRANSPORT_RETRY_MS);
  }
}

function warmTerminalInputTransport() {
  ensureTerminalInputTransport().catch(() => {});
}

function sendTerminalInputPayload(payload, options = {}) {
  const cleanPayload = cleanTerminalInputTransportPayload(payload);
  const waitForAck = Boolean(options?.waitForAck);
  if (!isTerminalInputTransportAvailable()) {
    logTerminalInputTransportSubmit("frontend.terminal_input_transport.fallback_emit_unavailable", cleanPayload, {
      waitForAck,
    });
    return waitForAck
      ? invokeTerminalInputPayload(cleanPayload)
      : emit(TERMINAL_INPUT_EVENT, cleanPayload);
  }

  const entry = createTerminalInputTransportEntry(cleanPayload, waitForAck);

  if (isTerminalInputTransportOpen() && terminalInputTransportEndpoint?.token) {
    const socket = terminalInputTransportSocket;
    if (socket.bufferedAmount < TERMINAL_INPUT_TRANSPORT_BUFFERED_LIMIT_BYTES) {
      try {
        sendTerminalInputTransportEntry(socket, entry);
        logTerminalInputTransportSubmit("frontend.terminal_input_transport.sent", cleanPayload, {
          messageId: entry.messageId,
          socketBufferedAmount: socket.bufferedAmount,
          waitForAck,
        });
        return entry.waitPromise || Promise.resolve({ queued: true, transport: "websocket" });
      } catch {
        resetTerminalInputTransportSocket(socket);
      }
    }
  }

  if (terminalInputTransportQueue.length >= TERMINAL_INPUT_TRANSPORT_QUEUE_LIMIT) {
    logTerminalInputTransportSubmit("frontend.terminal_input_transport.fallback_emit_queue_full", cleanPayload, {
      queueLength: terminalInputTransportQueue.length,
      waitForAck,
    });
    return waitForAck
      ? invokeTerminalInputPayload(cleanPayload)
      : emit(TERMINAL_INPUT_EVENT, cleanPayload);
  }

  terminalInputTransportQueue.push(entry);
  logTerminalInputTransportSubmit("frontend.terminal_input_transport.queued", cleanPayload, {
    messageId: entry.messageId,
    queueLength: terminalInputTransportQueue.length,
    waitForAck,
  });
  ensureTerminalInputTransport().catch(() => {
    fallbackTerminalInputTransportQueue();
  });
  scheduleTerminalInputTransportFlush();
  return entry.waitPromise || Promise.resolve({ queued: true, transport: "websocket" });
}

function getTerminalClipboardImageFiles(clipboardData) {
  const itemFiles = Array.from(clipboardData?.items || [])
    .filter((item) => item?.kind === "file" && String(item.type || "").startsWith("image/"))
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
  const clipboardFiles = Array.from(clipboardData?.files || [])
    .filter((file) => String(file?.type || "").startsWith("image/"));
  const seen = new Set();

  return itemFiles.concat(clipboardFiles).filter((file) => {
    const signature = [
      String(file?.name || "clipboard-image"),
      String(file?.type || ""),
      String(file?.size || 0),
      String(file?.lastModified || 0),
    ].join("|");
    if (!signature || seen.has(signature)) {
      return false;
    }
    seen.add(signature);
    return true;
  });
}

function readTerminalImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || "").startsWith("image/")) {
      reject(new Error("Choose an image file."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Unable to read image."));
    reader.onload = () => resolve({
      dataUrl: String(reader.result || ""),
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      mimeType: file.type,
      name: file.name || "clipboard-image",
      size: file.size || 0,
      source: "tui_terminal_clipboard",
      status: "queued",
    });
    reader.readAsDataURL(file);
  });
}

function extractCodexMissingSavedSessionId(value) {
  const match = String(value || "").match(/No saved session found with ID\s+([0-9a-fA-F-]{16,})/i);
  return String(match?.[1] || "").trim();
}

function formatSavedTerminalImageAttachments(images, startIndex = 0) {
  return (Array.isArray(images) ? images : [])
    .map((image, index) => {
      const name = String(image?.name || `image-${startIndex + index + 1}`).trim();
      const path = String(image?.path || "").trim();
      return path ? `[image-attached ${startIndex + index + 1}] ${name} -> ${path}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function formatSavedTerminalFileAttachments(attachments, startIndex = 0) {
  return (Array.isArray(attachments) ? attachments : [])
    .map((attachment, index) => {
      const path = String(attachment?.savedPath || attachment?.path || "").trim();
      if (!path) {
        return "";
      }

      const name = String(attachment?.name || `file-${startIndex + index + 1}`).trim();
      const mimeType = String(attachment?.mimeType || "").trim();
      const label = mimeType.startsWith("image/") || String(attachment?.kind || "") === "image"
        ? "image-attached"
        : "file-attached";
      return `[${label} ${startIndex + index + 1}] ${name} -> ${path}`;
    })
    .filter(Boolean)
    .join("\n");
}

async function saveTerminalImageAttachments(attachments) {
  const savedPathAttachments = (Array.isArray(attachments) ? attachments : [])
    .filter((attachment) => String(attachment?.savedPath || attachment?.path || "").trim());
  const images = (Array.isArray(attachments) ? attachments : [])
    .map((attachment) => ({
      dataUrl: attachment.dataUrl,
      mimeType: attachment.mimeType,
      name: attachment.name,
    }))
    .filter((attachment) => attachment.dataUrl && attachment.mimeType);

  if (!images.length && !savedPathAttachments.length) {
    return "";
  }

  const blocks = [];
  if (savedPathAttachments.length) {
    blocks.push(formatSavedTerminalFileAttachments(savedPathAttachments, 0));
  }
  if (images.length) {
    const savedImages = await invoke("save_todo_image_attachments", { images });
    blocks.push(formatSavedTerminalImageAttachments(savedImages, savedPathAttachments.length));
  }

  const attachmentBlock = blocks.filter(Boolean).join("\n");
  if (!attachmentBlock) {
    throw new Error("Unable to prepare image attachment.");
  }
  return attachmentBlock;
}

const WORKSPACE_FILE_OPEN_EVENT = "diffforge:workspace-file-open";
const TERMINAL_FOCUS_REQUEST_EVENT = "diffforge:terminal-focus-request";
const TERMINAL_CONTROL_UI_SUPPRESSION_EVENT = "diffforge:terminal-control-ui-suppression";
const TERMINAL_CONTROL_UI_SUPPRESSION_DEFAULT_MS = 10000;
const TERMINAL_CODING_AGENT_INPUT_READY_DELAY_MS = 15000;
const TERMINAL_CODING_AGENT_READY_RECONCILE_QUIET_MS = 850;
const TERMINAL_CODING_AGENT_READY_RECONCILE_RETRY_MS = 350;
const TERMINAL_CODING_AGENT_READY_RECONCILE_MAX_MS = 12000;
const TERMINAL_THREAD_PROMPT_READY_ACTIVITY_MS = 250;
const TERMINAL_THREAD_PROMPT_READY_EARLY_MIN_MS = 120;
const TERMINAL_THREAD_PROMPT_READY_MIN_MS = 450;
const TERMINAL_THREAD_PROMPT_ECHO_READY_SUPPRESS_MS = 2500;
const TERMINAL_THREAD_PROMPT_ECHO_MIN_SUPPRESS_MS = 600;
const TERMINAL_PARKED_PROMPT_BLOCKING_STATUSES = new Set(["parked", "resume_ready", "resume_requested"]);

function normalizeTerminalPromptEpoch(value) {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }
  return Math.floor(numericValue);
}

function normalizeTerminalNativeRailState(value, fallback = "unknown") {
  const text = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return text || fallback;
}

function formatTerminalNativeRailLabel(value) {
  return normalizeTerminalNativeRailState(value, "unknown").replace(/[_-]+/g, " ");
}

function getTerminalNativeRailStateFields(value, label = "") {
  const nativeRailState = normalizeTerminalNativeRailState(value, "unknown");
  const nativeRailLabel = String(label || "").trim()
    || formatTerminalNativeRailLabel(nativeRailState);
  return {
    nativeRailLabel,
    nativeRailState,
    native_rail_label: nativeRailLabel,
    native_rail_state: nativeRailState,
  };
}

function resolveTerminalNativeRailState({
  activityStatus = "",
  parked = false,
  terminalState = "",
} = {}) {
  if (parked) {
    return "paused";
  }
  const state = normalizeTerminalNativeRailState(terminalState, "");
  const activity = normalizeTerminalNativeRailState(activityStatus, "");
  if (state && !["prewarmed", "running"].includes(state)) {
    return state;
  }
  return activity || state || "unknown";
}
const TERMINAL_URL_LINK_PATTERN = /((?:https?:\/\/|mailto:|tel:)[^\s"'`<>()\[\]{}|]+)/gi;
const TERMINAL_FILE_URL_LINK_PATTERN = /(file:\/\/\/?[^\s"'`<>()\[\]{}|]+)/gi;
const TERMINAL_QUOTED_PATH_LINK_PATTERN = /(["'`])((?:(?:[A-Za-z]:[\\/])|(?:\\\\[^\\/\s"'`<>()\[\]{}|;,]+[\\/][^\\/\s"'`<>()\[\]{}|;,]+[\\/])|(?:\/\/[^/\s"'`<>()\[\]{}|;,]+\/[^/\s"'`<>()\[\]{}|;,]+\/)|(?:~[A-Za-z0-9_.-]*[\\/])|(?:\/)|(?:\.{1,2}[\\/]))(?:(?!\1).)*?\.[A-Za-z0-9][A-Za-z0-9_.-]*(?::\d+(?::\d+)?)?)\1/g;
const TERMINAL_PATH_LINK_PATTERN = /((?:[A-Za-z]:[\\/]|\\\\[^\\/\s"'`<>()\[\]{}|;,]+[\\/][^\\/\s"'`<>()\[\]{}|;,]+[\\/]|\/\/[^/\s"'`<>()\[\]{}|;,]+\/[^/\s"'`<>()\[\]{}|;,]+\/|~[A-Za-z0-9_.-]*[\\/]|\/|\.{1,2}[\\/])(?:[^\s"'`<>()\[\]{}|;,]+[\\/])*[^\s"'`<>()\[\]{}|;,]*\.[A-Za-z0-9][A-Za-z0-9_.-]*(?::\d+(?::\d+)?)?)/g;
const TERMINAL_BARE_FILE_LINK_PATTERN = /(^|[\s"'`(<[{])([A-Za-z0-9_.-]*[A-Za-z0-9_-]\.[A-Za-z0-9][A-Za-z0-9_.-]*(?::\d+(?::\d+)?)?)(?=$|[\s"'`)>}\],;!?])/g;
const TERMINAL_BARE_FILE_EXTENSIONS = new Set([
  "astro",
  "c",
  "cc",
  "cfg",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "cxx",
  "env",
  "go",
  "h",
  "hpp",
  "htm",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "lock",
  "log",
  "lua",
  "md",
  "mdx",
  "mjs",
  "php",
  "ps1",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svelte",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

function getTerminalInputSequenceDiagnosticFields(data) {
  const value = String(data || "");
  return {
    ...getTerminalInputDebugFields(value),
    containsCarriageReturn: value.includes("\r"),
    containsCtrlU: value.includes("\x15"),
    containsEnterSequence: value.includes(TERMINAL_ENTER_SEQUENCE),
    containsLineFeed: value.includes("\n"),
    containsShiftEnterSequence: value.includes(TERMINAL_SHIFT_ENTER_SEQUENCE),
    isOnlyCarriageReturn: value === "\r",
    isOnlyEnterSequence: value === TERMINAL_ENTER_SEQUENCE,
    isOnlyLineFeed: value === "\n",
    isOnlyShiftEnterSequence: value === TERMINAL_SHIFT_ENTER_SEQUENCE,
    sequenceHex: Array.from(value)
      .slice(0, 48)
      .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
      .join(" "),
    startsWithEscape: value.startsWith("\x1b"),
    textLength: value.length,
  };
}

function dispatchTerminalControlUiSuppression(detail = {}) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }

  window.dispatchEvent(new CustomEvent(TERMINAL_CONTROL_UI_SUPPRESSION_EVENT, {
    detail: {
      durationMs: TERMINAL_CONTROL_UI_SUPPRESSION_DEFAULT_MS,
      reason: "terminal-control-ui",
      ...detail,
    },
  }));
}

function getParkedWaitingOnTerminalIndex(waitingOn) {
  const directIndex = Number.parseInt(
    waitingOn?.terminalIndex ?? waitingOn?.terminal_index,
    10,
  );
  if (Number.isInteger(directIndex) && directIndex >= 0) {
    return directIndex;
  }

  const slotIndex = Number.parseInt(waitingOn?.slotKey ?? waitingOn?.slot_key, 10);
  if (Number.isInteger(slotIndex) && slotIndex > 0) {
    return slotIndex - 1;
  }

  return null;
}

function getParkedWaitingOnColorSlot(waitingOn) {
  const terminalIndex = getParkedWaitingOnTerminalIndex(waitingOn);
  return terminalIndex == null ? "unknown" : getTerminalAgentColorSlot(terminalIndex);
}

function getParkedWaitingOnLabel(waitingOn) {
  const slotKey = String(waitingOn?.slotKey || waitingOn?.slot_key || "").trim();
  const taskTitle = String(waitingOn?.taskTitle || waitingOn?.task_title || "").trim();
  const resourceKey = String(waitingOn?.resourceKey || waitingOn?.resource_key || "").trim();
  const agentLabel = String(waitingOn?.agentLabel || waitingOn?.agent_label || "").trim();
  const agentId = String(waitingOn?.agentId || waitingOn?.agent_id || "").trim();
  const terminalLabel = slotKey ? `terminal ${slotKey}` : "peer terminal";
  const details = taskTitle || resourceKey || agentLabel || agentId;

  return details ? `${terminalLabel}: ${details}` : terminalLabel;
}

const TODO_DROP_OVERLAY_UNSUPPORTED_STYLE = {
  border: "2px dotted rgba(248, 113, 113, 0.96)",
  background: "rgba(45, 8, 13, 0.62)",
  boxShadow: "inset 0 0 0 1px rgba(248, 113, 113, 0.28), 0 0 34px rgba(248, 113, 113, 0.16)",
};
const TODO_DROP_OVERLAY_UNSUPPORTED_LABEL_STYLE = {
  border: "1px solid rgba(248, 113, 113, 0.42)",
  color: "#fee2e2",
  background: "linear-gradient(135deg, rgba(55, 12, 18, 0.98), rgba(26, 8, 11, 0.94))",
  maxWidth: "min(420px, calc(100% - 32px))",
  textAlign: "center",
  textTransform: "none",
  whiteSpace: "normal",
};
const TERMINAL_STARTUP_DEFAULT_MODELS = {
  claude: "sonnet",
  codex: "gpt-5.5",
};
const TERMINAL_SESSION_MODE_GENERAL = "general";
const TERMINAL_SESSION_MODE_MANAGED_PATCH = "managed_patch";
const TERMINAL_SESSION_MODE_DIRECT_EDIT = "direct_edit";
const TERMINAL_SESSION_MODE_ACTIVITY = "activity";
const TERMINAL_SESSION_MODE_FREE = "free";
const TERMINAL_SESSION_MODE_REMOTE_OPS = "remote_ops";
const FORGE_LIGHT_THEME_ID = "light";
export const TERMINAL_DARK_THEME = {
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
};
export const TERMINAL_LIGHT_THEME = {
  background: "#ffffff",
  foreground: "#1d1d1f",
  cursor: "#0066cc",
  cursorAccent: "#ffffff",
  selectionBackground: "#0066cc26",
  black: "#1d1d1f",
  brightBlack: "#7a7a7a",
  blue: "#0066cc",
  brightBlue: "#0071e3",
  cyan: "#0066cc",
  brightCyan: "#0071e3",
  green: "#0a7f45",
  brightGreen: "#0a7f45",
  magenta: "#5e5ce6",
  brightMagenta: "#5e5ce6",
  red: "#b42318",
  brightRed: "#d92d20",
  white: "#f5f5f7",
  brightWhite: "#ffffff",
  yellow: "#8b5a00",
  brightYellow: "#8b5a00",
  scrollbarSliderBackground: "rgba(0, 102, 204, 0.24)",
  scrollbarSliderHoverBackground: "rgba(0, 102, 204, 0.34)",
  scrollbarSliderActiveBackground: "rgba(0, 102, 204, 0.46)",
};

function getCurrentForgeThemeId() {
  if (typeof document === "undefined") {
    return "";
  }
  return document.documentElement?.dataset?.forgeTheme || "";
}

function getTerminalThemeForForgeTheme(themeId = getCurrentForgeThemeId()) {
  return themeId === FORGE_LIGHT_THEME_ID ? TERMINAL_LIGHT_THEME : TERMINAL_DARK_THEME;
}

function normalizeTerminalSessionMode(value, fallback = TERMINAL_SESSION_MODE_FREE) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (
    normalized === TERMINAL_SESSION_MODE_GENERAL
    || normalized === TERMINAL_SESSION_MODE_MANAGED_PATCH
    || normalized === TERMINAL_SESSION_MODE_DIRECT_EDIT
    || normalized === TERMINAL_SESSION_MODE_ACTIVITY
    || normalized === TERMINAL_SESSION_MODE_FREE
    || normalized === TERMINAL_SESSION_MODE_REMOTE_OPS
  ) {
    return normalized;
  }
  if (normalized === "managed" || normalized === "patch" || normalized === "worktree") {
    return TERMINAL_SESSION_MODE_MANAGED_PATCH;
  }
  if (normalized === "worker" || normalized === "general_worker") {
    return TERMINAL_SESSION_MODE_GENERAL;
  }
  if (normalized === "direct") {
    return TERMINAL_SESSION_MODE_DIRECT_EDIT;
  }
  if (normalized === "remote" || normalized === "ssh") {
    return TERMINAL_SESSION_MODE_REMOTE_OPS;
  }
  return fallback;
}

function defaultTerminalSessionModeForRole(roleId, _isPrewarm = false) {
  const role = String(roleId || "").trim().toLowerCase();
  if (role === "prewarm-pty") {
    return TERMINAL_SESSION_MODE_FREE;
  }
  return TERMINAL_SESSION_MODE_GENERAL;
}

const AGENT_ACCOUNTS_CHANGED_EVENT = "agent-accounts-changed";

/* Self-contained stale-account chip: each pane is stamped (Rust-side) with
   the agent account profile it spawned under. When the active profile for
   its agent kind changes, the pane keeps working on its old account — this
   chip just says so, and that a restart adopts the new one. Never forced. */
function TerminalAccountStaleChip({ paneId, agentKind }) {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    const kind = String(agentKind || "").toLowerCase().includes("claude")
      ? "claude"
      : String(agentKind || "").toLowerCase().includes("codex") ? "codex" : "";
    const safePaneId = String(paneId || "").trim();
    if (!kind || !safePaneId) {
      setStatus(null);
      return undefined;
    }
    let cancelled = false;
    let unlisten = null;
    const check = () => {
      invoke("agent_accounts_pane_profiles").then((state) => {
        if (cancelled) {
          return;
        }
        const stamp = state?.panes?.[safePaneId];
        const active = state?.active?.[kind];
        if (!stamp || !active?.profileId) {
          setStatus(null);
          return;
        }
        const auth = state?.auth?.[kind]?.[stamp.profileId];
        if (auth?.needsLogin) {
          setStatus({
            kind,
            mode: "needs-login",
            profileId: String(stamp.profileId || ""),
            label: String(stamp.profileLabel || "account"),
            message: String(auth.message || "Sign in again for this account"),
          });
          return;
        }
        if (String(stamp.profileId || "") !== String(active.profileId)) {
          setStatus({ mode: "stale", label: String(active.profileLabel || "new account") });
        } else {
          setStatus(null);
        }
      }).catch(() => {});
    };
    check();
    const interval = window.setInterval(check, 6000);
    listen(AGENT_ACCOUNTS_CHANGED_EVENT, check).then((next) => {
      if (cancelled) {
        next();
        return;
      }
      unlisten = next;
    }).catch(() => {});
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (unlisten) {
        unlisten();
      }
    };
  }, [agentKind, paneId]);

  if (!status) {
    return null;
  }

  const sharedStyle = {
    alignItems: "center",
    borderRadius: 999,
    display: "inline-flex",
    flex: "0 0 auto",
    fontSize: 10,
    fontWeight: 750,
    gap: 4,
    lineHeight: 1,
    padding: "3px 8px",
    whiteSpace: "nowrap",
  };

  if (status.mode === "needs-login") {
    return (
      <button
        onClick={() => {
          invoke("agent_accounts_start_profile_login", {
            agentKind: status.kind,
            profileId: status.profileId,
          }).catch(() => {});
        }}
        style={{
          ...sharedStyle,
          background: "rgba(251, 146, 60, 0.16)",
          border: "1px solid rgba(251, 146, 60, 0.52)",
          color: "rgba(254, 215, 170, 0.95)",
          cursor: "pointer",
        }}
        title={status.message}
        type="button"
      >
        {`↻ login ${status.label}`}
      </button>
    );
  }

  return (
    <span
      style={{
        ...sharedStyle,
        background: "rgba(251, 146, 60, 0.14)",
        border: "1px solid rgba(251, 146, 60, 0.45)",
        color: "rgba(254, 215, 170, 0.95)",
      }}
      title={`Account switched to “${status.label}”. This terminal still uses the account it started with — close and relaunch it to use the new one.`}
    >
      {`↻ ${status.label}`}
    </span>
  );
}

function getTerminalStartupDefaultModel(agentKind) {
  return TERMINAL_STARTUP_DEFAULT_MODELS[String(agentKind || "").trim().toLowerCase()] || "";
}

function cleanTerminalUrlLink(value) {
  return String(value || "")
    .trim()
    .replace(/[.,;!?]+$/g, "");
}

function cleanTerminalPathLink(value) {
  return String(value || "")
    .trim()
    .replace(/^["'`(]+|["'`).,;!?]+$/g, "");
}

function getTerminalPathOpenTarget(value) {
  return cleanTerminalPathLink(value).replace(/:\d+(?::\d+)?$/g, "");
}

function isTerminalUrlLink(value) {
  return /^(?:https?:|mailto:|tel:)/i.test(String(value || "").trim());
}

function isTerminalFileUrlLink(value) {
  return /^file:/i.test(String(value || "").trim());
}

function getTerminalPathFromFileUrl(value) {
  const raw = cleanTerminalUrlLink(value);
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== "file:") {
      return "";
    }

    const decodedPath = decodeURIComponent(url.pathname || "");
    const pathWithoutWindowsLeadingSlash = decodedPath.replace(/^\/([A-Za-z]:[\\/])/, "$1");
    return url.host ? `//${url.host}${pathWithoutWindowsLeadingSlash}` : pathWithoutWindowsLeadingSlash;
  } catch {
    return raw.replace(/^file:\/+/i, "");
  }
}

function isTerminalAbsolutePathLink(value) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/\/|\/|~[A-Za-z0-9_.-]*[\\/])/.test(String(value || "").trim());
}

function isTerminalRelativePathLink(value) {
  const cleanPath = String(value || "").trim();
  return Boolean(cleanPath)
    && !isTerminalAbsolutePathLink(cleanPath)
    && !/^[a-z][a-z0-9+.-]*:/i.test(cleanPath);
}

function isLikelyTerminalBareFileLink(value) {
  const cleanPath = getTerminalPathOpenTarget(value);
  const fileName = cleanPath.split(/[\\/]/).filter(Boolean).pop() || "";
  const extension = fileName.includes(".") ? fileName.split(".").pop().toLowerCase() : "";
  return TERMINAL_BARE_FILE_EXTENSIONS.has(extension);
}

function addTerminalLinkCandidate(candidates, rawPath, startIndex, kind = "path") {
  const cleanPath = kind === "url" || kind === "file-url"
    ? cleanTerminalUrlLink(rawPath)
    : cleanTerminalPathLink(rawPath);
  if (!cleanPath) {
    return;
  }

  candidates.push({
    kind,
    path: cleanPath,
    startIndex,
    endIndex: startIndex + cleanPath.length,
  });
}

function getNormalizedTerminalLinkCandidates(candidates) {
  const sortedCandidates = [...candidates].sort((first, second) => {
    if (first.startIndex !== second.startIndex) {
      return first.startIndex - second.startIndex;
    }
    return second.endIndex - first.endIndex;
  });
  const links = [];

  sortedCandidates.forEach((candidate) => {
    const overlapsExistingLink = links.some((link) => (
      candidate.startIndex < link.endIndex && candidate.endIndex > link.startIndex
    ));
    if (!overlapsExistingLink) {
      links.push(candidate);
    }
  });

  return links;
}

function getTerminalPathLinks(lineText) {
  const text = String(lineText || "");
  const candidates = [];

  TERMINAL_URL_LINK_PATTERN.lastIndex = 0;
  let match = TERMINAL_URL_LINK_PATTERN.exec(text);
  while (match) {
    addTerminalLinkCandidate(candidates, match[1] || "", match.index, "url");
    match = TERMINAL_URL_LINK_PATTERN.exec(text);
  }

  TERMINAL_FILE_URL_LINK_PATTERN.lastIndex = 0;
  match = TERMINAL_FILE_URL_LINK_PATTERN.exec(text);
  while (match) {
    addTerminalLinkCandidate(candidates, match[1] || "", match.index, "file-url");
    match = TERMINAL_FILE_URL_LINK_PATTERN.exec(text);
  }

  TERMINAL_QUOTED_PATH_LINK_PATTERN.lastIndex = 0;
  match = TERMINAL_QUOTED_PATH_LINK_PATTERN.exec(text);
  while (match) {
    const rawPath = match[2] || "";
    addTerminalLinkCandidate(candidates, rawPath, match.index + match[0].indexOf(rawPath), "path");
    match = TERMINAL_QUOTED_PATH_LINK_PATTERN.exec(text);
  }

  TERMINAL_PATH_LINK_PATTERN.lastIndex = 0;
  match = TERMINAL_PATH_LINK_PATTERN.exec(text);
  while (match) {
    const rawPath = match[1] || "";
    addTerminalLinkCandidate(candidates, rawPath, match.index + match[0].indexOf(rawPath), "path");
    match = TERMINAL_PATH_LINK_PATTERN.exec(text);
  }

  TERMINAL_BARE_FILE_LINK_PATTERN.lastIndex = 0;
  match = TERMINAL_BARE_FILE_LINK_PATTERN.exec(text);
  while (match) {
    const rawPath = match[2] || "";
    if (isLikelyTerminalBareFileLink(rawPath)) {
      addTerminalLinkCandidate(candidates, rawPath, match.index + match[0].indexOf(rawPath), "path");
    }
    match = TERMINAL_BARE_FILE_LINK_PATTERN.exec(text);
  }

  return getNormalizedTerminalLinkCandidates(candidates);
}

function getWorkspaceRelativePathForTerminalLink(path, workspaceRoot) {
  const cleanPath = String(path || "").replace(/\\/g, "/");
  const cleanWorkspaceRoot = String(workspaceRoot || "").replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!cleanPath || !cleanWorkspaceRoot) {
    return "";
  }
  if (cleanPath === cleanWorkspaceRoot) {
    return "";
  }
  const compareCaseInsensitive = /^[A-Za-z]:\//.test(cleanPath)
    || /^[A-Za-z]:\//.test(cleanWorkspaceRoot)
    || cleanPath.startsWith("//")
    || cleanWorkspaceRoot.startsWith("//");
  const comparePath = compareCaseInsensitive ? cleanPath.toLowerCase() : cleanPath;
  const compareWorkspaceRoot = compareCaseInsensitive ? cleanWorkspaceRoot.toLowerCase() : cleanWorkspaceRoot;
  if (comparePath === compareWorkspaceRoot) {
    return "";
  }
  if (!comparePath.startsWith(`${compareWorkspaceRoot}/`)) {
    return "";
  }
  return cleanPath.slice(cleanWorkspaceRoot.length + 1);
}

function getWorkspaceRelativePathForTerminalRelativeLink(path) {
  if (!isTerminalRelativePathLink(path)) {
    return "";
  }

  const cleanPath = getTerminalPathOpenTarget(path)
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");
  const parts = cleanPath.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "..")) {
    return "";
  }
  return parts.join("/");
}

function resolveTerminalRelativePathLink(path, workspaceRoot) {
  const cleanPath = getTerminalPathOpenTarget(path);
  if (!isTerminalRelativePathLink(cleanPath) || !workspaceRoot) {
    return cleanPath;
  }

  const root = String(workspaceRoot || "").replace(/[\\/]+$/g, "");
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  const relativePath = cleanPath
    .replace(/^[.][\\/]+/, "")
    .replace(/[\\/]+/g, separator);
  return `${root}${separator}${relativePath}`;
}

function isTerminalViewArrowShortcutEditableTarget(target, terminalKeyboardContainer) {
  const targetElement = getEventTargetElement(target);

  if (!targetElement) {
    return false;
  }

  if (
    typeof Node !== "undefined"
    && terminalKeyboardContainer instanceof Node
    && targetElement instanceof Node
    && terminalKeyboardContainer.contains(targetElement)
  ) {
    return false;
  }

  return Boolean(targetElement.closest?.(
    "input, textarea, select, [contenteditable], [role='textbox']",
  ));
}

// Per-terminal xterm zoom: each pane owns its font size (TUI surface only —
// UI View and Thread Details are untouched), persisted per workspace slot.
const TERMINAL_FONT_SIZE_DEFAULT = 12;
const TERMINAL_FONT_SIZE_MIN = 8;
const TERMINAL_FONT_SIZE_MAX = 24;
const TERMINAL_FONT_SIZE_STEP = 1;

function clampTerminalFontSize(value) {
  const size = Number(value);
  if (!Number.isFinite(size)) {
    return TERMINAL_FONT_SIZE_DEFAULT;
  }
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, Math.round(size)));
}

function terminalFontSizeStorageKey(workspaceId, terminalIndex) {
  return `diffforge.terminal.fontSize.v1:${String(workspaceId || "").trim()}:${Number(terminalIndex) || 0}`;
}

function readStoredTerminalFontSize(workspaceId, terminalIndex) {
  try {
    const stored = window.localStorage.getItem(terminalFontSizeStorageKey(workspaceId, terminalIndex));
    if (stored === null || stored === "") {
      return TERMINAL_FONT_SIZE_DEFAULT;
    }
    return clampTerminalFontSize(stored);
  } catch {
    return TERMINAL_FONT_SIZE_DEFAULT;
  }
}

function writeStoredTerminalFontSize(workspaceId, terminalIndex, size) {
  try {
    if (clampTerminalFontSize(size) === TERMINAL_FONT_SIZE_DEFAULT) {
      window.localStorage.removeItem(terminalFontSizeStorageKey(workspaceId, terminalIndex));
    } else {
      window.localStorage.setItem(
        terminalFontSizeStorageKey(workspaceId, terminalIndex),
        String(clampTerminalFontSize(size)),
      );
    }
  } catch {
    // Zoom persistence is convenience state only.
  }
}

function ButtonPopOutIcon(props) {
  return (
    <svg fill="none" height="12" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M14 4h6v6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      <path d="M20 4 11 13" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      <path d="M9 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function ButtonFontMinusIcon(props) {
  return (
    <svg fill="none" height="12" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M4 19 10.5 5h1L18 19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      <path d="M6.6 14.4h8.8" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
      <path d="M16 8h6" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
}

function ButtonFontPlusIcon(props) {
  return (
    <svg fill="none" height="12" viewBox="0 0 24 24" width="12" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M3 19 9.5 5h1L16 19" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
      <path d="M5.6 14.4h8.8" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
      <path d="M19 5v6M16 8h6" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
    </svg>
  );
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
  onArchiveWorkspaceThread,
  onWorkspaceThreadsViewStateChange,
  onOpenSettings,
  onPreparedTerminalChange,
  onRecheckAgents,
  onBeginTerminalDrag,
  onCreateWorkspaceThreadTerminal,
  onSplitTerminal,
  onSelectWorkspaceThread,
  onToggleWorkspaceThreadPinned,
  onThreadTerminalLifecycle,
  onToggleFullscreenTerminal,
  onPopOutTerminalWindow,
  prewarmShell = false,
  projectRoot = "",
  mountId = "",
  startupReady = true,
  terminalBreakoutActive = false,
  terminalSelectionMode = "pointerdown",
  windowBreakoutHosted = false,
  terminalIndex = 0,
  terminalCount = 1,
  terminalRole = "",
  thread = null,
  threadsViewActive = false,
  todoDropActive = false,
  todoDropTarget = false,
  todoDropUnsupportedMessage = "",
  useWebglRenderer = TERMINAL_ENABLE_WEBGL_RENDERER,
  workingDirectory,
  workspace,
  workspaceError,
  workspaceRootWasEmptyAtSelection = false,
  workspaceThreads = {},
  workspaces = [],
  selectedWorkspaceThreadId = "",
}) {
  const containerRef = useRef(null);
  const restartMenuRef = useRef(null);
  const resizeControllerRef = useRef(null);
  const windowBreakoutHostedRef = useRef(windowBreakoutHosted);

  // While a pane is hosted in its own Window Breakout window, the native
  // window owns the PTY size; the grid's resize controller stands down and
  // re-asserts the grid geometry the moment the pane returns.
  useEffect(() => {
    const wasHosted = windowBreakoutHostedRef.current;
    windowBreakoutHostedRef.current = windowBreakoutHosted;

    if (wasHosted && !windowBreakoutHosted) {
      resizeControllerRef.current?.resizeNow("window_breakout_return", {
        force: true,
        forceNative: true,
      });
    }
  }, [windowBreakoutHosted]);
  const surfaceRef = useRef(null);
  const xtermRef = useRef(null);
  // Per-terminal zoom (xterm only): the ref seeds the constructor, the effect
  // below applies live changes and pushes the new grid through the resize
  // controller (the same guarded path a container resize takes).
  const [terminalFontSize, setTerminalFontSize] = useState(
    () => readStoredTerminalFontSize(workspace?.id, terminalIndex),
  );
  const terminalFontSizeRef = useRef(terminalFontSize);

  useEffect(() => {
    terminalFontSizeRef.current = terminalFontSize;
    const terminal = xtermRef.current;
    if (!terminal || terminal.options.fontSize === terminalFontSize) {
      return;
    }
    terminal.options.fontSize = terminalFontSize;
    const applyResize = () => {
      resizeControllerRef.current?.resizeNow("font_size_change", {
        force: true,
        forceNative: true,
      });
    };
    if (typeof window.requestAnimationFrame === "function") {
      // Two frames so the renderer publishes the new cell metrics before the
      // grid is re-measured against them.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(applyResize);
      });
    } else {
      applyResize();
    }
  }, [terminalFontSize]);

  const adjustTerminalFontSize = useCallback((delta) => {
    setTerminalFontSize((current) => {
      const next = clampTerminalFontSize(
        (Number(current) || TERMINAL_FONT_SIZE_DEFAULT) + delta,
      );
      writeStoredTerminalFontSize(workspace?.id, terminalIndex, next);
      return next;
    });
  }, [terminalIndex, workspace?.id]);
  const terminalInstanceIdRef = useRef(0);
  const agentLaunchEpochRef = useRef(agentLaunchEpoch);
  const agentLaunchReadyRef = useRef(agentLaunchReady);
  const submittedPendingPromptIdsRef = useRef(new Set());
  const pendingPromptSendTimersRef = useRef(new Map());
  const terminalFirstVisibleOutputAtRef = useRef(0);
  const terminalRunningSinceRef = useRef(0);
  const terminalActiveRef = useRef(Boolean(isActive));
  const terminalActivePropRef = useRef(Boolean(isActive));
  const terminalInteractiveStateRef = useRef({
    acceptsInteractiveInput: null,
    cursorBlink: null,
    disableStdin: null,
  });
  const attachDeferredWebglRef = useRef(null);
  const terminalOutputWorkerSessionRef = useRef(null);
  const terminalOutputFlushNowRef = useRef(null);
  const terminalPointerSelectionPendingRef = useRef(false);
  const lastAgentLaunchEpochRef = useRef(0);
  const startAgentInPrewarmedTerminalRef = useRef(null);
  const blankStartupProbeCountRef = useRef(0);
  const terminalClosingRef = useRef(false);
  const terminalThemeRefreshTimerRef = useRef(0);
  const lastTerminalThemeRefreshKeyRef = useRef("");
  const preserveCoordinationOnNextCleanupRef = useRef(false);
  const preserveCoordinationOnNextOpenRef = useRef(false);
  const forceFreshSessionOnNextOpenRef = useRef(false);
  const providerSessionOverrideOnNextOpenRef = useRef("");
  const parkedPromptRef = useRef(null);
  const cancellingParkedPromptKeysRef = useRef(new Set());
  const threadComposerDraftsRef = useRef(getWorkspaceThreadComposerDraftStore());
  const threadComposerDirtyKeysRef = useRef(new Set());
  const threadComposerWriteChainRef = useRef(Promise.resolve());
  const [threadComposerDrafts, setThreadComposerDrafts] = useState(
    getWorkspaceThreadComposerDraftSnapshot,
  );
  const [threadComposerAttachments, setThreadComposerAttachments] = useState(
    getWorkspaceThreadComposerAttachmentSnapshot,
  );
  const [terminalState, setTerminalState] = useState(agent ? "starting" : "blocked");
  const [terminalStartupUnblocked, setTerminalStartupUnblocked] = useState(Boolean(startupReady));
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
  const [terminalUiViewActive, setTerminalUiViewActive] = useState(false);
  const [terminalUiComposerFocusToken, setTerminalUiComposerFocusToken] = useState(0);
  const terminalUiViewActiveRef = useRef(false);
  useEffect(() => {
    terminalUiViewActiveRef.current = terminalUiViewActive;
  }, [terminalUiViewActive]);
  useEffect(() => {
    warmTerminalInputTransport();
  }, []);
  const isTerminalStabilityRuntimeEnabled = useCallback(
    () => false,
    [],
  );
  const applyCurrentTerminalTheme = useCallback(() => {
    const terminal = xtermRef.current;
    if (!terminal) {
      return;
    }

    terminal.options.theme = getTerminalThemeForForgeTheme();
    if (typeof terminal.refresh === "function") {
      terminal.refresh(0, Math.max(0, terminal.rows - 1));
    }
  }, []);
  useEffect(() => {
    applyCurrentTerminalTheme();
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "data-forge-theme")) {
        applyCurrentTerminalTheme();
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-forge-theme"] });
    return () => observer.disconnect();
  }, [applyCurrentTerminalTheme]);
  const terminalRoleId = String(terminalRole || agent?.id || "").toLowerCase();
  const isGenericTerminal = terminalRoleId === "generic" || agent?.id === "generic";
  const paneAgentId = isGenericTerminal ? "generic" : agent?.id;
  const paneId = getWorkspaceTerminalPaneId(workspace?.id, terminalIndex, paneAgentId);
  const terminalSelectsOnPointerDown = terminalSelectionMode !== "pointerup";
  const terminalThreadId = thread?.id || "";
  const terminalThreadSlotKey = thread?.slotKey
    || String(Math.max(0, Number.parseInt(terminalIndex, 10) || 0) + 1);
  const terminalThreadActivityStatus = thread?.activityStatus || "idle";
  const terminalThreadIdRef = useRef(terminalThreadId);
  const terminalThreadSlotKeyRef = useRef(terminalThreadSlotKey);
  const terminalThreadActivityStatusRef = useRef(terminalThreadActivityStatus);
  const terminalThreadThinkingTraceSignatureRef = useRef("");
  const terminalThreadThinkingSinceRef = useRef(terminalThreadActivityStatus === "thinking" ? performance.now() : 0);
  const terminalThreadPromptEpochRef = useRef(0);
  const terminalThreadSubmittedPromptRef = useRef(null);
  const terminalThreadLastReadyAtMsRef = useRef(0);
  const terminalThreadLastWorkStartedAtRef = useRef(terminalThreadActivityStatus === "thinking" ? performance.now() : 0);
  const terminalThreadLastActiveOutputLifecycleAtRef = useRef(0);
  const pendingThreadStartingLifecycleRef = useRef(null);
  const threadsViewSelectedThreadRef = useRef(null);
  const terminalAgentKind = getTerminalAgentKind(paneAgentId);
  const terminalUsesActivityHooks = !isGenericTerminal && terminalAgentUsesActivityHooks(terminalAgentKind);
  const terminalDefaultSessionMode = defaultTerminalSessionModeForRole(terminalRoleId, prewarmShell && !agentLaunchReady);
  const [, setTerminalSessionMode] = useState(terminalDefaultSessionMode);
  const terminalSessionModeRef = useRef(terminalDefaultSessionMode);
  const terminalSessionModeExplicitRef = useRef(false);
  useEffect(() => {
    if (!terminalLaunchInfo && !terminalSessionModeExplicitRef.current) {
      terminalSessionModeRef.current = terminalDefaultSessionMode;
      setTerminalSessionMode(terminalDefaultSessionMode);
    }
  }, [terminalDefaultSessionMode, terminalLaunchInfo]);
  const threadProviderBinding = getWorkspaceThreadProviderBinding(thread, terminalAgentKind);
  const threadProviderSessionId = threadProviderBinding?.nativeSessionId
    || (String(thread?.currentAgent || "").toLowerCase() === terminalAgentKind ? thread?.transcriptSessionId : "")
    || "";
  const threadProviderModel = threadProviderBinding?.modelId || "";
  const terminalThreadTurnStateRef = useRef({
    latestTurn: null,
    latestTurnState: "",
    pendingPrompt: null,
    pendingPromptPresent: false,
  });
  terminalThreadTurnStateRef.current = {
    latestTurn: thread?.latestTurn || null,
    latestTurnState: String(
      thread?.latestTurn?.state || thread?.latestTurn?.status || "",
    ).trim().toLowerCase(),
    pendingPrompt: thread?.pendingPrompt || null,
    pendingPromptPresent: Boolean(thread?.pendingPrompt),
  };
  const workspaceThreadEntry = workspaceThreads?.[workspace?.id || ""];
  const getTerminalCliStatusLogBase = (fields = {}) => ({
    agentId: terminalAgentKind,
    eventTime: new Date().toISOString(),
    instanceId: terminalInstanceIdRef.current || "",
    paneId,
    terminalIndex,
    threadId: terminalThreadIdRef.current || "",
    workspaceId: workspace?.id || "",
    ...fields,
  });
  const setTerminalAudioInputTarget = useCallback((active, instanceId = terminalInstanceIdRef.current || 0, reason = "terminal_audio_target") => {
    const safeInstanceId = Number(instanceId || 0);
    if (!paneId || !safeInstanceId) {
      return;
    }

    invoke("set_terminal_audio_input_target", {
      active: Boolean(active),
      instanceId: safeInstanceId,
      paneId,
    }).catch((error) => {
      logTerminalDiagnosticEvent("frontend.audio_input_target.set_error", {
        active: Boolean(active),
        instanceId: safeInstanceId,
        message: error?.message || String(error || ""),
        paneId,
        reason,
        terminalIndex,
        workspaceId: workspace?.id || "",
      });
    });
  }, [paneId, terminalIndex, workspace?.id]);
  const resetTerminalReadinessForEpoch = ({
    activityStatus = "idle",
    instanceId = terminalInstanceIdRef.current,
    reason = "terminal_epoch_reset",
    threadId = terminalThreadIdRef.current,
  } = {}) => {
    terminalThreadThinkingSinceRef.current = 0;
    terminalThreadSubmittedPromptRef.current = null;
    terminalThreadLastReadyAtMsRef.current = 0;
    terminalThreadLastWorkStartedAtRef.current = 0;
    terminalThreadActivityStatusRef.current = String(activityStatus || "idle").trim().toLowerCase() || "idle";
    if (!isGenericTerminal) {
      logTerminalStatus("frontend.terminal_cli.instance_epoch_reset", getTerminalCliStatusLogBase({
        activityStatus: terminalThreadActivityStatusRef.current,
        instanceId,
        reason,
        source: reason,
        threadId,
      }));
    }
  };
  const markTerminalThreadActivityStatus = (status, options = {}) => {
    const nextStatus = String(status || "idle").trim().toLowerCase() || "idle";
    const previousStatus = String(terminalThreadActivityStatusRef.current || "").trim().toLowerCase();
    if (shouldSuppressThreadPropThinking({
      latestTurn: thread?.latestTurn || null,
      lastReadyAtMs: terminalThreadLastReadyAtMsRef.current,
      nextStatus,
      pendingPrompt: thread?.pendingPrompt || null,
      previousStatus,
      source: options.reason || "",
      submittedPrompt: terminalThreadSubmittedPromptRef.current,
      threadId: terminalThreadIdRef.current,
    })) {
      logTerminalStatus("frontend.terminal_cli.thread_prop_thinking_suppressed", getTerminalCliStatusLogBase({
        lastReadyAtMs: terminalThreadLastReadyAtMsRef.current || 0,
        latestTurnId: thread?.latestTurn?.turnId || thread?.latestTurn?.id || "",
        latestTurnMessageId: thread?.latestTurn?.messageId || "",
        latestTurnState: thread?.latestTurn?.state || thread?.latestTurn?.status || "",
        nextStatus,
        pendingPromptPresent: Boolean(thread?.pendingPrompt),
        previousStatus,
        source: options.reason || "",
      }));
      return false;
    }
    const thinkingSinceBefore = Number(terminalThreadThinkingSinceRef.current || 0);
    const thinkingElapsedBeforeMs = thinkingSinceBefore > 0
      ? Math.max(0, Math.round(performance.now() - thinkingSinceBefore))
      : 0;
    if (nextStatus === "thinking" && (previousStatus !== "thinking" || options.forceNewTurn === true)) {
      terminalThreadThinkingSinceRef.current = performance.now();
      terminalThreadLastWorkStartedAtRef.current = terminalThreadThinkingSinceRef.current;
    } else if (nextStatus !== "thinking" && previousStatus === "thinking") {
      terminalThreadThinkingSinceRef.current = 0;
    }
    terminalThreadActivityStatusRef.current = nextStatus;
    if (!isGenericTerminal && (previousStatus !== nextStatus || options.forceNewTurn === true)) {
      const finishCandidate = previousStatus === "thinking" && nextStatus !== "thinking";
      logTerminalStatus("frontend.terminal_cli.status_transition", getTerminalCliStatusLogBase({
        finishCandidate,
        finishSignalKind: finishCandidate ? (options.reason || "activity_status_transition") : "",
        forceNewTurn: Boolean(options.forceNewTurn),
        latestTurnId: thread?.latestTurn?.turnId || thread?.latestTurn?.id || "",
        latestTurnMessageId: thread?.latestTurn?.messageId || "",
        latestTurnState: thread?.latestTurn?.state || thread?.latestTurn?.status || "",
        nextStatus,
        pendingPromptPresent: Boolean(thread?.pendingPrompt),
        previousStatus,
        source: options.reason || "",
        thinkingElapsedBeforeMs,
      }));
    }
    return true;
  };
  const rememberTerminalThreadSubmittedPrompt = ({
    promptEventId = "",
    promptText = "",
    source = "terminal-submit",
    submittedAt = "",
    threadId = "",
  } = {}) => {
    const safePromptText = String(promptText || "").trim();
    const safeThreadId = String(threadId || terminalThreadIdRef.current || "").trim();
    if (!safePromptText || !safeThreadId) {
      return;
    }

    const safePromptEventId = String(promptEventId || "").trim();
    const currentPrompt = terminalThreadSubmittedPromptRef.current;
    const currentPromptEventId = String(currentPrompt?.promptEventId || "").trim();
    const currentPromptThreadId = String(currentPrompt?.threadId || "").trim();
    const canReusePromptEpoch = Boolean(
      safePromptEventId
        && currentPromptEventId === safePromptEventId
        && (!currentPromptThreadId || currentPromptThreadId === safeThreadId)
        && normalizeTerminalPromptEpoch(currentPrompt?.promptEpoch) > 0,
    );
    const promptEpoch = canReusePromptEpoch
      ? normalizeTerminalPromptEpoch(currentPrompt.promptEpoch)
      : normalizeTerminalPromptEpoch(terminalThreadPromptEpochRef.current) + 1;
    terminalThreadPromptEpochRef.current = promptEpoch;

    terminalThreadSubmittedPromptRef.current = {
      promptEpoch,
      promptEventId: safePromptEventId,
      promptText: safePromptText,
      source,
      submittedAt,
      submittedAtMs: performance.now(),
      threadId: safeThreadId,
    };
    logTerminalStatus("frontend.terminal_cli.submitted_prompt_remembered", getTerminalCliStatusLogBase({
      promptEpoch,
      promptEventId: safePromptEventId,
      promptSource: source,
      promptText: getBigViewTextDiagnosticFields(safePromptText),
      source: "remember_terminal_thread_submitted_prompt",
      threadId: safeThreadId,
    }));
    return terminalThreadSubmittedPromptRef.current;
  };
  const terminalEventListenerStateRef = useRef({});
  terminalEventListenerStateRef.current = {
    getTerminalCliStatusLogBase,
    isGenericTerminal,
    markTerminalThreadActivityStatus,
    onThreadTerminalLifecycle,
    paneId,
    rememberTerminalThreadSubmittedPrompt,
    terminalAgentKind,
    terminalIndex,
    terminalUsesActivityHooks,
    threadId: thread?.id || "",
    threadProviderSessionId,
    threadWorkspaceId: thread?.workspaceId || "",
    workspaceId: workspace?.id || "",
  };

  useEffect(() => {
    let disposed = false;
    let unlisten = null;

    listen(TERMINAL_PROMPT_SUBMITTED_EVENT, (event) => {
      const listenerState = terminalEventListenerStateRef.current || {};
      const payload = event?.payload || {};
      const payloadPaneId = String(payload.paneId || payload.pane_id || "").trim();
      const currentPaneId = String(listenerState.paneId || "").trim();
      const payloadWorkspaceId = String(payload.workspaceId || payload.workspace_id || "").trim();
      const currentWorkspaceId = String(listenerState.workspaceId || listenerState.threadWorkspaceId || "").trim();
      const payloadThreadId = String(payload.threadId || payload.thread_id || "").trim();
      const currentThreadId = String(listenerState.threadId || terminalThreadIdRef.current || "").trim();
      const payloadInstanceId = Number(payload.instanceId ?? payload.instance_id ?? 0);
      const currentInstanceId = Number(terminalInstanceIdRef.current || 0);
      const payloadTerminalIndex = Number(payload.terminalIndex ?? payload.terminal_index);
      const currentTerminalIndex = Number(listenerState.terminalIndex);
      const paneMatches = !payloadPaneId || !currentPaneId || payloadPaneId === currentPaneId;
      const workspaceMatches = !payloadWorkspaceId || !currentWorkspaceId || payloadWorkspaceId === currentWorkspaceId;
      const threadMatches = !payloadThreadId || !currentThreadId || payloadThreadId === currentThreadId;
      const instanceMatches = !Number.isFinite(payloadInstanceId)
        || payloadInstanceId <= 0
        || !Number.isFinite(currentInstanceId)
        || currentInstanceId <= 0
        || payloadInstanceId === currentInstanceId;
      const terminalIndexMatches = !Number.isFinite(payloadTerminalIndex)
        || !Number.isFinite(currentTerminalIndex)
        || payloadTerminalIndex === currentTerminalIndex;

      if (!paneMatches || !workspaceMatches || !threadMatches || !instanceMatches || !terminalIndexMatches) {
        return;
      }

      const promptSource = String(
        payload.promptSource
          || payload.prompt_source
          || payload.promptEventSource
          || payload.prompt_event_source
          || "terminal-prompt-submitted",
      ).trim();
      const submittedByActivityHook = promptSource === "activity_hook_user_prompt_submit"
        || promptSource === "cli_hook_user_prompt_submit";
      if (listenerState.terminalUsesActivityHooks && !submittedByActivityHook) {
        logTerminalStatus("frontend.terminal_cli.prompt_submitted_event_ignored", listenerState.getTerminalCliStatusLogBase?.({
          instanceId: payload.instanceId || payload.instance_id || "",
          paneId: payloadPaneId,
          promptEventId: payload.promptEventId || payload.prompt_event_id || "",
          promptMatch: payload.promptMatch,
          promptSource,
          reason: "activity_hook_owns_prompt_acceptance",
          source: "terminal_prompt_submitted_event",
          threadId: payloadThreadId || currentThreadId,
        }) || {});
        return;
      }

      if (!terminalPromptSubmittedPayloadIsAuthoritative(payload)) {
        logTerminalStatus("frontend.terminal_cli.prompt_submitted_event_ignored", listenerState.getTerminalCliStatusLogBase?.({
          instanceId: payload.instanceId || payload.instance_id || "",
          paneId: payloadPaneId,
          promptEventId: payload.promptEventId || payload.prompt_event_id || "",
          promptMatch: payload.promptMatch,
          promptSource: payload.promptSource || payload.prompt_source || "",
          reason: "prompt_not_authoritative",
          source: "terminal_prompt_submitted_event",
          threadId: payloadThreadId || currentThreadId,
        }) || {});
        return;
      }

      const promptEventId = String(payload.promptEventId || payload.prompt_event_id || "").trim();
      const observedPrompt = String(payload.observedPrompt || payload.observed_prompt || "").trim();
      const expectedPrompt = String(payload.expectedPrompt || payload.expected_prompt || "").trim();
      const fallbackPrompt = String(
        payload.prompt
          || payload.promptText
          || payload.prompt_text
          || payload.promptEventText
          || payload.prompt_event_text
          || "",
      ).trim();
      const promptText = observedPrompt || expectedPrompt || fallbackPrompt;
      const submittedAt = String(
        payload.promptEventSubmittedAt
          || payload.prompt_event_submitted_at
          || payload.submittedAt
          || payload.submitted_at
          || new Date().toISOString(),
      ).trim();
      const threadIdForPrompt = payloadThreadId || currentThreadId;
      if (!promptText || !threadIdForPrompt) {
        logTerminalStatus("frontend.terminal_cli.prompt_submitted_event_ignored", listenerState.getTerminalCliStatusLogBase?.({
          hasPrompt: Boolean(promptText),
          hasThreadId: Boolean(threadIdForPrompt),
          instanceId: payload.instanceId || payload.instance_id || "",
          paneId: payloadPaneId,
          promptEventId,
          promptSource,
          reason: "missing_prompt_identity",
          source: "terminal_prompt_submitted_event",
          threadId: threadIdForPrompt,
        }) || {});
        return;
      }

      const currentSubmittedPrompt = terminalThreadSubmittedPromptRef.current;
      const currentSubmittedPromptId = String(currentSubmittedPrompt?.promptEventId || "").trim();
      const submittedPromptRecord = listenerState.rememberTerminalThreadSubmittedPrompt?.({
        promptEventId,
        promptText,
        source: promptSource || "terminal_prompt_submitted_event",
        submittedAt,
        threadId: threadIdForPrompt,
      });
      listenerState.markTerminalThreadActivityStatus?.("thinking", {
        forceNewTurn: Boolean(promptEventId && promptEventId !== currentSubmittedPromptId),
        reason: "terminal_prompt_submitted_event",
      });
      logTerminalStatus("frontend.terminal_cli.prompt_submitted_event_remembered", listenerState.getTerminalCliStatusLogBase?.({
        instanceId: payload.instanceId || payload.instance_id || "",
        paneId: payloadPaneId,
        promptEpoch: submittedPromptRecord?.promptEpoch || 0,
        promptEventId,
        promptSource,
        promptText: getBigViewTextDiagnosticFields(promptText),
        source: "terminal_prompt_submitted_event",
        threadId: threadIdForPrompt,
      }) || {});
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }
      unlisten = nextUnlisten;
    }).catch(() => {});

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  const terminalStartupSnapshotRef = useRef(null);
  const terminalStabilityFeatures = useMemo(() => getTerminalStabilityFeatureFlags({
    agentKind: terminalAgentKind,
    isGenericTerminal,
  }), [isGenericTerminal, terminalAgentKind]);
  const useNormalizerAgentScrollStability = false;
  const workspaceEntryTerminal = workspaceThreadEntry?.terminals?.[String(terminalIndex)] || null;
  const terminalNickname = getWorkspaceThreadTerminalNickname(
    thread,
    threadProviderBinding,
    workspaceEntryTerminal,
  );
  const terminalRailAgentLabel = terminalNickname || (isGenericTerminal ? "Shell" : "Agent");
  const terminalRailAgentTitle = terminalNickname
    ? `${terminalNickname} terminal`
    : isGenericTerminal
      ? "Shell terminal"
      : "Agent terminal";
  const scheduleOpenCodeTerminalThemeRefresh = useCallback((themeId = getCurrentForgeThemeId()) => {
    if (isGenericTerminal || terminalAgentKind !== "opencode") {
      return;
    }

    const instanceId = terminalInstanceIdRef.current || 0;
    if (!paneId || !instanceId) {
      return;
    }

    const refreshKey = `${paneId}:${instanceId}:${themeId || ""}`;
    if (lastTerminalThemeRefreshKeyRef.current === refreshKey) {
      return;
    }
    lastTerminalThemeRefreshKeyRef.current = refreshKey;

    if (terminalThemeRefreshTimerRef.current) {
      window.clearTimeout(terminalThemeRefreshTimerRef.current);
    }
    terminalThemeRefreshTimerRef.current = window.setTimeout(() => {
      terminalThemeRefreshTimerRef.current = 0;
      invoke("terminal_refresh_theme", {
        paneId,
        instanceId,
      }).catch((error) => {
        logTerminalDiagnosticEvent("frontend.opencode_theme_refresh.error", {
          agentId: terminalAgentKind,
          instanceId,
          message: error?.message || String(error || ""),
          paneId,
          terminalIndex,
          themeId: themeId || "",
          workspaceId: workspace?.id || "",
        });
      });
    }, 120);
  }, [isGenericTerminal, paneId, terminalAgentKind, terminalIndex, workspace?.id]);
  useEffect(() => {
    if (isGenericTerminal || terminalAgentKind !== "opencode") {
      return undefined;
    }
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
      return undefined;
    }

    const root = document.documentElement;
    const refresh = () => {
      scheduleOpenCodeTerminalThemeRefresh(root?.dataset?.forgeTheme || "");
    };
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "data-forge-theme")) {
        refresh();
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ["data-forge-theme"] });
    refresh();
    return () => {
      observer.disconnect();
      if (terminalThemeRefreshTimerRef.current) {
        window.clearTimeout(terminalThemeRefreshTimerRef.current);
        terminalThemeRefreshTimerRef.current = 0;
      }
    };
  }, [isGenericTerminal, scheduleOpenCodeTerminalThemeRefresh, terminalAgentKind]);
  useEffect(() => {
    terminalThreadIdRef.current = terminalThreadId;
    terminalThreadSlotKeyRef.current = terminalThreadSlotKey;
  }, [terminalThreadId, terminalThreadSlotKey]);
  useEffect(() => {
    if (startupReady) {
      setTerminalStartupUnblocked(true);
    }
  }, [startupReady]);
  useEffect(() => {
    if (isGenericTerminal) {
      return;
    }
    const localActivityStatus = String(terminalThreadActivityStatusRef.current || "").trim().toLowerCase();
    const propActivityStatus = String(terminalThreadActivityStatus || "").trim().toLowerCase();
    const latestTurnState = String(
      thread?.latestTurn?.state || thread?.latestTurn?.status || "",
    ).trim().toLowerCase();
    const shouldTrace = (
      localActivityStatus === "thinking"
      || propActivityStatus === "thinking"
      || latestTurnState === "running"
    );
    if (!shouldTrace) {
      terminalThreadThinkingTraceSignatureRef.current = "";
      return;
    }
    const signature = [
      terminalThreadId,
      localActivityStatus,
      propActivityStatus,
      latestTurnState,
      thread?.latestTurn?.turnId || thread?.latestTurn?.id || "",
      thread?.latestTurn?.messageId || "",
      Boolean(thread?.pendingPrompt),
      Array.isArray(thread?.messages) ? thread.messages.length : 0,
    ].join("|");
    if (terminalThreadThinkingTraceSignatureRef.current === signature) {
      return;
    }
    terminalThreadThinkingTraceSignatureRef.current = signature;
    logTerminalStatus("frontend.terminal_cli.thinking_state_trace", getTerminalCliStatusLogBase({
      latestTurnId: thread?.latestTurn?.turnId || thread?.latestTurn?.id || "",
      latestTurnMessageId: thread?.latestTurn?.messageId || "",
      latestTurnState,
      localActivityStatus,
      messageCount: Array.isArray(thread?.messages) ? thread.messages.length : 0,
      pendingPromptId: thread?.pendingPrompt?.id || thread?.pendingPrompt?.promptEventId || "",
      pendingPromptPresent: Boolean(thread?.pendingPrompt),
      propActivityStatus,
      providerSessionPresent: Boolean(threadProviderSessionId),
      source: "thread_prop_render_trace",
    }));
  }, [
    isGenericTerminal,
    terminalThreadActivityStatus,
    terminalThreadId,
    thread?.latestTurn?.id,
    thread?.latestTurn?.messageId,
    thread?.latestTurn?.state,
    thread?.latestTurn?.status,
    thread?.latestTurn?.turnId,
    thread?.messages?.length,
    thread?.pendingPrompt,
    threadProviderSessionId,
  ]);
  useEffect(() => {
    const applied = markTerminalThreadActivityStatus(terminalThreadActivityStatus, {
      reason: "thread_prop_status_sync",
    });
    if (applied !== false && String(terminalThreadActivityStatus || "").trim().toLowerCase() === "thinking") {
    }
  }, [terminalThreadActivityStatus]);
  const openTerminalPathLink = useCallback((path, kind = "path") => {
    const linkKind = kind || (isTerminalUrlLink(path) ? "url" : "path");
    const cleanLink = linkKind === "url" || linkKind === "file-url"
      ? cleanTerminalUrlLink(path)
      : cleanTerminalPathLink(path);
    if (!cleanLink) {
      return;
    }

    if (linkKind === "url" && !isTerminalFileUrlLink(cleanLink)) {
      logBigViewSyncDiagnosticEvent("tui.terminal_link.open", {
        agentId: terminalAgentKind,
        instanceId: terminalInstanceIdRef.current || 0,
        isWorkspaceRelative: false,
        linkKind,
        paneId,
        path: cleanLink,
        relativePath: "",
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });

      openUrl(cleanLink).catch((error) => {
        logBigViewSyncDiagnosticEvent("tui.terminal_link.open_error", {
          agentId: terminalAgentKind,
          instanceId: terminalInstanceIdRef.current || 0,
          linkKind,
          message: error?.message || String(error || ""),
          paneId,
          path: cleanLink,
          terminalIndex,
          threadId: terminalThreadIdRef.current || "",
          workspaceId: workspace?.id || "",
        });
      });
      return;
    }

    const cleanPath = isTerminalFileUrlLink(cleanLink)
      ? getTerminalPathOpenTarget(getTerminalPathFromFileUrl(cleanLink))
      : getTerminalPathOpenTarget(cleanLink);
    if (!cleanPath) {
      return;
    }

    const openTarget = resolveTerminalRelativePathLink(cleanPath, workingDirectory);
    const relativePath = getWorkspaceRelativePathForTerminalLink(cleanPath, workingDirectory)
      || getWorkspaceRelativePathForTerminalLink(openTarget, workingDirectory)
      || getWorkspaceRelativePathForTerminalRelativeLink(cleanPath);
    logBigViewSyncDiagnosticEvent("tui.terminal_link.open", {
      agentId: terminalAgentKind,
      instanceId: terminalInstanceIdRef.current || 0,
      isWorkspaceRelative: Boolean(relativePath),
      linkKind,
      openTarget,
      paneId,
      path: cleanLink,
      relativePath,
      terminalIndex,
      threadId: terminalThreadIdRef.current || "",
      workspaceId: workspace?.id || "",
    });

    if (relativePath) {
      const workspaceOpenEvent = new CustomEvent(WORKSPACE_FILE_OPEN_EVENT, {
        cancelable: true,
        detail: {
          relativePath,
          workspaceId: workspace?.id || "",
        },
      });
      window.dispatchEvent(workspaceOpenEvent);
      if (workspaceOpenEvent.defaultPrevented) {
        return;
      }
    }

    openPath(openTarget).catch((error) => {
      logBigViewSyncDiagnosticEvent("tui.terminal_link.open_error", {
        agentId: terminalAgentKind,
        instanceId: terminalInstanceIdRef.current || 0,
        linkKind,
        message: error?.message || String(error || ""),
        openTarget,
        paneId,
        path: cleanLink,
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
    });
  }, [paneId, terminalAgentKind, terminalIndex, workingDirectory, workspace?.id]);
  const updateTerminalInteractiveState = useCallback((active, parked = parkedPromptRef.current) => {
    const acceptsInteractiveInput = Boolean(active) && !parked;
    const disableStdin = Boolean(parked);
    const previousState = terminalInteractiveStateRef.current;
    terminalOutputWorkerSessionRef.current?.setActive(Boolean(active));
    if (active) {
      terminalOutputFlushNowRef.current?.("terminal_activated");
    }
    terminalInteractiveStateRef.current = {
      acceptsInteractiveInput,
      cursorBlink: acceptsInteractiveInput,
      disableStdin,
    };

    const terminal = xtermRef.current;
    if (!terminal) {
      return;
    }

    if (previousState.disableStdin !== disableStdin) {
      terminal.options.disableStdin = disableStdin;
    }
    if (previousState.cursorBlink !== acceptsInteractiveInput) {
      terminal.options.cursorBlink = acceptsInteractiveInput;
    }
    // Breakout-hosted panes stay on the full budget: they can be read in
    // their own window while inactive in the grid.
    const scrollbackRows = active || windowBreakoutHostedRef.current
      ? TERMINAL_DEFAULT_SCROLLBACK_ROWS
      : TERMINAL_BACKGROUND_SCROLLBACK_ROWS;
    if (terminal.options.scrollback !== scrollbackRows) {
      terminal.options.scrollback = scrollbackRows;
    }

    if (!acceptsInteractiveInput && previousState.acceptsInteractiveInput !== false) {
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

    const terminalHasDomFocus = () => {
      if (typeof document === "undefined" || typeof Node === "undefined") {
        return false;
      }
      const activeElement = document.activeElement;
      const terminalElement = terminal.element || containerRef.current;
      return Boolean(
        activeElement
        && terminalElement instanceof Node
        && terminalElement.contains(activeElement),
      );
    };

    if (terminalHasDomFocus()) {
      return;
    }

    try {
      terminal.focus();
    } catch (_) {
      // Terminal may have been disposed between activation and the focus request.
    }
  }, []);
  const recordSubmittedAgentMessage = useCallback((instanceId, userMessage = "", options = {}) => {
    if (isGenericTerminal) {
      logThreadBridgeDiagnostic("frontend.thread_terminal_observed_prompt.skip", {
        instanceId,
        paneId,
        reason: "generic_terminal",
        rawText: getBigViewTextDiagnosticFields(userMessage),
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
      return;
    }

    const safeUserMessage = terminalInputChunkVisibleText(userMessage).trim();
    if (safeUserMessage.startsWith("/")) {
      logThreadBridgeDiagnostic("frontend.thread_terminal_observed_prompt.skip", {
        agentId: agent?.id || terminalAgentKind,
        instanceId,
        paneId,
        promptLength: safeUserMessage.length,
        reason: "slash_command",
        rawText: getBigViewTextDiagnosticFields(userMessage),
        visibleText: getBigViewTextDiagnosticFields(safeUserMessage),
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
      return;
    }
    if (!safeUserMessage) {
      logThreadBridgeDiagnostic("frontend.thread_terminal_observed_prompt.skip", {
        instanceId,
        paneId,
        reason: "empty_visible_text",
        rawText: getBigViewTextDiagnosticFields(userMessage),
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
      return;
    }

    logThreadBridgeDiagnostic("frontend.thread_terminal_observed_prompt", {
      agentId: agent?.id || terminalAgentKind,
      instanceId,
      paneId,
      promptLength: safeUserMessage.length,
      promptEventId: options.promptEventId || "",
      rawText: getBigViewTextDiagnosticFields(userMessage),
      source: options.source || options.messageSource || "",
      visibleText: getBigViewTextDiagnosticFields(safeUserMessage),
      slotKey: terminalThreadSlotKeyRef.current,
      terminalIndex,
      threadId: terminalThreadIdRef.current || "",
      workspaceId: workspace?.id || "",
    });
    const submittedPromptRecord = rememberTerminalThreadSubmittedPrompt({
      promptEventId: options.promptEventId || "",
      promptText: safeUserMessage,
      source: options.source || options.messageSource || "observed_terminal_prompt",
      submittedAt: options.messageCreatedAt || "",
      threadId: terminalThreadIdRef.current || "",
    });
    markTerminalThreadActivityStatus("thinking", {
      forceNewTurn: true,
      reason: "observed_terminal_prompt",
    });
    onThreadTerminalLifecycle?.({
      agentId: agent?.id || terminalAgentKind,
      instanceId,
      messageCreatedAt: options.messageCreatedAt,
      messageId: options.messageId,
      messageSource: options.messageSource || options.source,
      paneId,
      promptEpoch: submittedPromptRecord?.promptEpoch || 0,
      prompt_epoch: submittedPromptRecord?.promptEpoch || 0,
      promptEventId: options.promptEventId,
      repoPath: workingDirectory || "",
      slotKey: terminalThreadSlotKeyRef.current,
      source: options.source,
      status: "active",
      terminalIndex,
      threadId: terminalThreadIdRef.current,
      turnId: options.turnId,
      type: "message-submitted",
      userMessage: safeUserMessage,
      workspaceId: workspace?.id || "",
      workspaceName: workspace?.name || "",
    });
  }, [
    agent?.id,
    isGenericTerminal,
    onThreadTerminalLifecycle,
    paneId,
    terminalAgentKind,
    terminalIndex,
    workingDirectory,
    workspace?.id,
    workspace?.name,
  ]);

  useEffect(() => subscribeWorkspaceThreadComposerDrafts(() => {
    const snapshot = getWorkspaceThreadComposerDraftSnapshot();
    logBigViewSyncDiagnosticEvent("bigview.draft.store_subscriber", {
      keyCount: Object.keys(snapshot).length,
      keys: Object.keys(snapshot).slice(0, 8),
    });
    setThreadComposerDrafts(snapshot);
  }), []);

  useEffect(() => subscribeWorkspaceThreadComposerAttachments(() => {
    const snapshot = getWorkspaceThreadComposerAttachmentSnapshot();
    logBigViewSyncDiagnosticEvent("bigview.image.shared_attachment_subscriber", {
      keyCount: Object.keys(snapshot).length,
      keys: Object.keys(snapshot).slice(0, 8),
    });
    setThreadComposerAttachments(snapshot);
  }), []);

  const setThreadComposerDraftValue = useCallback((syncKey, value, reason = "unspecified") => {
    const key = String(syncKey || "");
    if (!key) {
      return;
    }

    const nextValue = String(value || "");
    const currentValue = threadComposerDraftsRef.current.has(key)
      ? threadComposerDraftsRef.current.get(key)
      : "";
    logBigViewSyncDiagnosticEvent("bigview.draft.store_set", {
      changed: currentValue !== nextValue,
      currentValueLength: currentValue.length,
      currentText: getBigViewTextDiagnosticFields(currentValue),
      nextValueLength: nextValue.length,
      nextText: getBigViewTextDiagnosticFields(nextValue),
      reason,
      syncKey: key,
    });
    return setWorkspaceThreadComposerDraft(key, value, {
      source: reason,
    });
  }, []);

  const getCurrentThreadComposerSyncKey = useCallback((instanceId = terminalInstanceIdRef.current) => {
    if (!workspace?.id || !terminalThreadIdRef.current || !paneId || !instanceId) {
      return "";
    }

    return getThreadComposerSyncKey(
      {
        id: terminalThreadIdRef.current,
        workspaceId: workspace.id,
      },
      {
        instanceId,
        paneId,
      },
    );
  }, [paneId, workspace?.id]);

  const queueWorkspaceThreadComposerWrite = useCallback(({
    binding,
    data,
    promptEventId,
    promptEventRevision,
    promptEventSource,
    promptEventSubmittedAt,
    promptEventText,
    threadId,
  }) => {
    if (!data || !binding?.paneId || !binding?.instanceId) {
      logThreadBridgeDiagnostic("frontend.thread_composer_write.skip", {
        hasData: Boolean(data),
        hasInstanceId: Boolean(binding?.instanceId),
        hasPaneId: Boolean(binding?.paneId),
        promptLength: String(promptEventText || "").length,
        reason: "missing_write_target",
        threadId: threadId || "",
      });
      return threadComposerWriteChainRef.current;
    }

    logThreadBridgeDiagnostic("frontend.thread_composer_write.queue", {
      inputDebug: getTerminalInputDebugFields(data),
      instanceId: binding.instanceId,
      paneId: binding.paneId,
      promptLength: String(promptEventText || "").length,
      terminalIndex: binding.terminalIndex ?? "",
      threadId: threadId || "",
    });
    threadComposerWriteChainRef.current = threadComposerWriteChainRef.current
      .catch(() => {})
      .then(async () => {
        logThreadBridgeDiagnostic("frontend.thread_composer_write.invoke", {
          inputDebug: getTerminalInputDebugFields(data),
          instanceId: binding.instanceId,
          paneId: binding.paneId,
          promptLength: String(promptEventText || "").length,
          terminalIndex: binding.terminalIndex ?? "",
          threadId: threadId || "",
        });
        await invoke("terminal_write", {
          data,
          instanceId: binding.instanceId,
          paneId: binding.paneId,
          promptEventId,
          promptEventRevision,
          promptEventSource,
          promptEventSubmittedAt,
          promptEventText,
          threadId,
        });
        logThreadBridgeDiagnostic("frontend.thread_composer_write.done", {
          inputDebug: getTerminalInputDebugFields(data),
          instanceId: binding.instanceId,
          paneId: binding.paneId,
          promptLength: String(promptEventText || "").length,
          terminalIndex: binding.terminalIndex ?? "",
          threadId: threadId || "",
        });
        return true;
      })
      .catch((error) => {
        logThreadBridgeDiagnostic("frontend.thread_composer_write.error", {
          inputDebug: getTerminalInputDebugFields(data),
          instanceId: binding.instanceId,
          message: error?.message || String(error || ""),
          paneId: binding.paneId,
          promptLength: String(promptEventText || "").length,
          terminalIndex: binding.terminalIndex ?? "",
          threadId: threadId || "",
        });
        throw error;
      });

    return threadComposerWriteChainRef.current;
  }, []);

  const syncWorkspaceThreadComposerInput = useCallback(({ nextValue, previousValue, thread: targetThread, workspace: targetWorkspace }) => {
    const nextDraft = String(nextValue || "");
    logBigViewSyncDiagnosticEvent("bigview.draft.sync_received", {
      agentId: terminalAgentKind,
      nextValueLength: nextDraft.length,
      nextText: getBigViewTextDiagnosticFields(nextDraft),
      paneId,
      previousValueLength: String(previousValue || "").length,
      previousText: getBigViewTextDiagnosticFields(previousValue || ""),
      targetThreadId: targetThread?.id || "",
      targetWorkspaceId: targetWorkspace?.id || workspace?.id || "",
      terminalIndex,
    });
    const {
      binding,
      latestThread,
    } = getWorkspaceThreadTerminalTarget({
      fallbackWorkspace: workspace,
      targetThread,
      targetWorkspace,
      terminalAgentKind,
      workspaceThreads,
    });
    const syncKey = getThreadComposerSyncKey(latestThread, binding);

    logBigViewSyncDiagnosticEvent("bigview.draft.target_resolved", {
      agentId: terminalAgentKind,
      bindingInstanceId: binding?.instanceId || "",
      bindingPaneId: binding?.paneId || "",
      latestThreadId: latestThread?.id || "",
      nextValueLength: nextDraft.length,
      nextText: getBigViewTextDiagnosticFields(nextDraft),
      paneId,
      syncKey,
      targetThreadId: targetThread?.id || "",
      targetWorkspaceId: targetWorkspace?.id || workspace?.id || "",
      terminalIndex,
    });

    if (!binding?.paneId || !binding?.instanceId || !latestThread?.id) {
      if (syncKey && latestThread?.id) {
        setThreadComposerDraftValue(syncKey, nextDraft, "bigview_sync_shared_only");
      }
      logBigViewSyncDiagnosticEvent("bigview.draft.shared_only", {
        agentId: terminalAgentKind,
        hasBinding: Boolean(binding?.paneId && binding?.instanceId),
        latestThreadId: latestThread?.id || "",
        nextValueLength: nextDraft.length,
        nextText: getBigViewTextDiagnosticFields(nextDraft),
        paneId,
        reason: !latestThread?.id ? "missing_thread" : "missing_live_binding",
        syncKey,
        targetWorkspaceId: targetWorkspace?.id || workspace?.id || "",
        terminalIndex,
      });
      logThreadBridgeDiagnostic("frontend.thread_composer_sync.shared_only", {
        agentId: terminalAgentKind,
        hasBinding: Boolean(binding?.paneId && binding?.instanceId),
        latestThreadId: latestThread?.id || "",
        nextValueLength: nextDraft.length,
        targetWorkspaceId: targetWorkspace?.id || workspace?.id || "",
      });
      return;
    }

    const previousDraft = threadComposerDraftsRef.current.has(syncKey)
      ? threadComposerDraftsRef.current.get(syncKey)
      : String(previousValue || "");
    const forceReplace = threadComposerDirtyKeysRef.current.has(syncKey);
    const data = buildTerminalComposerDraftInput(previousDraft, nextDraft, forceReplace);

    if (syncKey && latestThread?.id) {
      setThreadComposerDraftValue(syncKey, nextDraft, "bigview_sync_after_delta");
    }

    if (!data) {
      logBigViewSyncDiagnosticEvent("bigview.draft.no_terminal_delta", {
        agentId: terminalAgentKind,
        bindingInstanceId: binding.instanceId,
        bindingPaneId: binding.paneId,
        forceReplace,
        latestThreadId: latestThread.id,
        nextValueLength: nextDraft.length,
        paneId,
        previousDraftLength: previousDraft.length,
        syncKey,
        terminalIndex,
      });
      return;
    }

    logBigViewSyncDiagnosticEvent("bigview.draft.write_start", {
      agentId: terminalAgentKind,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      forceReplace,
      inputLength: data.length,
      latestThreadId: latestThread.id,
      nextValueLength: nextDraft.length,
      nextText: getBigViewTextDiagnosticFields(nextDraft),
      paneId,
      previousDraftLength: previousDraft.length,
      previousText: getBigViewTextDiagnosticFields(previousDraft),
      syncKey,
      terminalIndex,
    });
    queueWorkspaceThreadComposerWrite({
      binding,
      data,
      threadId: latestThread.id,
    }).then(() => {
      threadComposerDirtyKeysRef.current.delete(syncKey);
      logBigViewSyncDiagnosticEvent("bigview.draft.write_done", {
        agentId: terminalAgentKind,
        bindingInstanceId: binding.instanceId,
        bindingPaneId: binding.paneId,
        latestThreadId: latestThread.id,
        nextValueLength: nextDraft.length,
        paneId,
        syncKey,
        terminalIndex,
      });
    }).catch(() => {
      threadComposerDirtyKeysRef.current.add(syncKey);
      logBigViewSyncDiagnosticEvent("bigview.draft.write_error", {
        agentId: terminalAgentKind,
        bindingInstanceId: binding.instanceId,
        bindingPaneId: binding.paneId,
        latestThreadId: latestThread.id,
        nextValueLength: nextDraft.length,
        paneId,
        syncKey,
        terminalIndex,
      });
    });
  }, [
    queueWorkspaceThreadComposerWrite,
    paneId,
    setThreadComposerDraftValue,
    terminalAgentKind,
    terminalIndex,
    workspace,
    workspaceThreads,
  ]);

  const reloadTerminalWithProviderSession = useCallback(({
    agentId,
    providerSessionId,
    reason = "provider_turn_completed",
    threadId,
  }) => {
    const nextProviderSessionId = String(providerSessionId || "").trim();
    if (
      !nextProviderSessionId
      || isGenericTerminal
      || terminalClosed
      || terminalClosingRef.current
    ) {
      return;
    }

    providerSessionOverrideOnNextOpenRef.current = nextProviderSessionId;
    preserveCoordinationOnNextCleanupRef.current = true;
    preserveCoordinationOnNextOpenRef.current = true;
    logThreadBridgeDiagnostic("frontend.provider_turn.reload_terminal_session", {
      agentId: getTerminalAgentKind(agentId),
      paneId,
      providerSessionPresent: true,
      reason,
      terminalIndex,
      threadId: threadId || terminalThreadIdRef.current || "",
      workspaceId: workspace?.id || "",
    });
    setRestartKey((current) => current + 1);
  }, [
    isGenericTerminal,
    paneId,
    terminalClosed,
    terminalIndex,
    workspace?.id,
  ]);

  const queueClipboardImagesForCurrentTerminal = useCallback((event, surface = "tui_terminal") => {
    const imageFiles = getTerminalClipboardImageFiles(event?.clipboardData);
    const clipboardText = String(event?.clipboardData?.getData?.("text/plain") || "");
    if (!imageFiles.length) {
      if (clipboardText || Array.from(event?.clipboardData?.types || []).includes("text/plain")) {
        logBigViewSyncDiagnosticEvent("tui.text.paste_observed", {
          agentId: terminalAgentKind,
          clipboardTypes: Array.from(event?.clipboardData?.types || []),
          paneId,
          sourceSurface: surface,
          terminalIndex,
          text: getBigViewTextDiagnosticFields(clipboardText),
          threadId: terminalThreadIdRef.current || "",
          workspaceId: workspace?.id || "",
        });
      }
      return false;
    }

    event.preventDefault();
    event.stopPropagation?.();
    const syncKey = getCurrentThreadComposerSyncKey();
    logBigViewSyncDiagnosticEvent("tui.image.paste_start", {
      agentId: terminalAgentKind,
      fileCount: imageFiles.length,
      files: imageFiles.map((file) => ({
        mimeType: String(file?.type || ""),
        name: String(file?.name || ""),
        size: Number(file?.size || 0),
      })),
      paneId,
      sourceSurface: surface,
      syncKey,
      terminalIndex,
      threadId: terminalThreadIdRef.current || "",
      workspaceId: workspace?.id || "",
    });
    if (!syncKey) {
      logBigViewSyncDiagnosticEvent("tui.image.paste_skip", {
        agentId: terminalAgentKind,
        fileCount: imageFiles.length,
        paneId,
        reason: "missing_sync_key",
        sourceSurface: surface,
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
      return true;
    }

    Promise.all(imageFiles.map(readTerminalImageFile))
      .then((attachments) => {
        appendWorkspaceThreadComposerAttachments(syncKey, attachments, {
          fields: {
            agentId: terminalAgentKind,
            paneId,
            sourceSurface: surface,
            terminalIndex,
            threadId: terminalThreadIdRef.current || "",
            workspaceId: workspace?.id || "",
          },
          source: "tui_terminal_clipboard",
        });
        logBigViewSyncDiagnosticEvent("tui.image.paste_done", {
          agentId: terminalAgentKind,
          attachmentCount: attachments.length,
          paneId,
          sourceSurface: surface,
          syncKey,
          terminalIndex,
          threadId: terminalThreadIdRef.current || "",
          workspaceId: workspace?.id || "",
        });
      })
      .catch((error) => {
        logBigViewSyncDiagnosticEvent("tui.image.paste_error", {
          agentId: terminalAgentKind,
          fileCount: imageFiles.length,
          message: error?.message || String(error || ""),
          paneId,
          sourceSurface: surface,
          syncKey,
          terminalIndex,
          threadId: terminalThreadIdRef.current || "",
          workspaceId: workspace?.id || "",
        });
      });

    return true;
  }, [
    getCurrentThreadComposerSyncKey,
    paneId,
    terminalAgentKind,
    terminalIndex,
    workspace?.id,
  ]);

  const runWorkspaceThreadProviderTurn = useCallback(async ({
    agentId,
    binding,
    message,
    model,
    pendingPromptId = "",
    providerSessionId = "",
    repoPath = "",
    syncTerminalAfterTurn = true,
    terminalIndex: targetTerminalIndex,
    threadId,
    workspace: targetWorkspace,
    workspaceId: targetWorkspaceId,
  }) => {
    const text = String(message || "").trim();
    const safeAgentId = getTerminalAgentKind(agentId);
    const safeThreadId = String(threadId || "").trim();
    const safeWorkspaceId = String(targetWorkspaceId || targetWorkspace?.id || workspace?.id || "").trim();
    const safeRepoPath = String(repoPath || workingDirectory || "").trim();
    const modelId = String(model || "").trim();
    const previousProviderSessionId = String(providerSessionId || "").trim();
    const instanceId = binding?.instanceId || terminalInstanceIdRef.current || undefined;
    const lifecyclePaneId = binding?.paneId || paneId;
    const lifecycleTerminalIndex = targetTerminalIndex ?? binding?.terminalIndex ?? terminalIndex;
    const startedAt = new Date().toISOString();
    const userMessageId = pendingPromptId || createThreadProjectionToken("message-user");
    const turnId = `turn-${userMessageId}`;
    const assistantMessageId = createThreadProjectionToken("message-assistant");

    if (!text || !safeThreadId || !safeWorkspaceId || !safeRepoPath) {
      throw new Error("Unable to start the provider turn for this thread.");
    }

    logThreadBridgeDiagnostic("frontend.provider_turn.start", {
      agentId: safeAgentId,
      instanceId: instanceId || "",
      modelIdPresent: Boolean(modelId),
      paneId: lifecyclePaneId,
      pendingPromptId,
      providerSessionPresent: Boolean(previousProviderSessionId),
      repoPathPresent: Boolean(safeRepoPath),
      terminalIndex: lifecycleTerminalIndex,
      threadId: safeThreadId,
      userMessageLength: text.length,
      workspaceId: safeWorkspaceId,
    });
    onThreadTerminalLifecycle?.({
      activityStatus: "thinking",
      agentId: safeAgentId,
      instanceId,
      ...getTerminalNativeRailStateFields("thinking"),
      paneId: lifecyclePaneId,
      status: "active",
      terminalIndex: lifecycleTerminalIndex,
      threadId: safeThreadId,
      type: "agent-output",
      workspaceId: safeWorkspaceId,
    });
    onThreadTerminalLifecycle?.({
      agentId: safeAgentId,
      clearPendingPrompt: false,
      instanceId,
      model: modelId,
      modelSource: modelId ? "provider-api" : "",
      nativeSessionId: previousProviderSessionId,
      nativeSessionKind: previousProviderSessionId ? "session" : "",
      nativeSessionSource: previousProviderSessionId ? "provider-api" : "",
      ...getTerminalNativeRailStateFields("thinking"),
      paneId: lifecyclePaneId,
      pendingPromptId,
      projectionEvents: buildProviderTurnStartProjectionEvents({
        agentId: safeAgentId,
        startedAt,
        text,
        turnId,
        userMessageId,
      }),
      providerSessionId: previousProviderSessionId,
      repoPath: safeRepoPath,
      status: "active",
      terminalIndex: lifecycleTerminalIndex,
      threadId: safeThreadId,
      type: "provider-turn-started",
      workspaceId: safeWorkspaceId,
      workspaceName: targetWorkspace?.name || workspace?.name || "",
    });

    try {
      const result = await invoke("agent_thread_turn_start", {
        request: {
          agentId: safeAgentId,
          model: modelId || null,
          prompt: text,
          providerSessionId: previousProviderSessionId || null,
          workingDirectory: safeRepoPath,
        },
      });
      const completedAt = new Date().toISOString();
      const nextProviderSessionId = String(
        result?.providerSessionId || previousProviderSessionId || "",
      ).trim();
      const output = String(result?.output || "").trim();

      logThreadBridgeDiagnostic("frontend.provider_turn.completed", {
        agentId: safeAgentId,
        instanceId: instanceId || "",
        outputLength: output.length,
        paneId: lifecyclePaneId,
        pendingPromptId,
        providerSessionPresent: Boolean(nextProviderSessionId),
        terminalIndex: lifecycleTerminalIndex,
        threadId: safeThreadId,
        workspaceId: safeWorkspaceId,
      });
      if (nextProviderSessionId) {
        onThreadTerminalLifecycle?.({
          agentId: safeAgentId,
          instanceId,
          nativeSessionId: nextProviderSessionId,
          nativeSessionKind: "session",
          nativeSessionSource: "provider-api",
          paneId: lifecyclePaneId,
          providerSessionId: nextProviderSessionId,
          terminalIndex: lifecycleTerminalIndex,
          threadId: safeThreadId,
          type: "provider-session",
          workspaceId: safeWorkspaceId,
        });
      }
      onThreadTerminalLifecycle?.({
        agentId: safeAgentId,
        instanceId,
        model: result?.model || modelId,
        modelSource: modelId ? "provider-api" : "",
        nativeSessionId: nextProviderSessionId,
        nativeSessionKind: nextProviderSessionId ? "session" : "",
        nativeSessionSource: nextProviderSessionId ? "provider-api" : "",
        paneId: lifecyclePaneId,
        pendingPromptId,
        projectionEvents: buildProviderTurnProjectionEvents({
          agentId: safeAgentId,
          assistantMessageId,
          completedAt,
          output: output || result?.output || "",
          startedAt,
          text,
          turnId,
          userMessageId,
        }),
        providerSessionId: nextProviderSessionId,
        repoPath: safeRepoPath,
        status: "active",
        terminalIndex: lifecycleTerminalIndex,
        threadId: safeThreadId,
        type: "provider-turn-completed",
        workspaceId: safeWorkspaceId,
        workspaceName: targetWorkspace?.name || workspace?.name || "",
      });
      if (syncTerminalAfterTurn && nextProviderSessionId) {
        reloadTerminalWithProviderSession({
          agentId: safeAgentId,
          providerSessionId: nextProviderSessionId,
          reason: previousProviderSessionId
            ? "provider_turn_reload_existing_session"
            : "provider_turn_reload_created_session",
          threadId: safeThreadId,
        });
      }

      return result;
    } catch (error) {
      const messageText = getErrorMessage(error, "Unable to send message through the provider session.");
      logThreadBridgeDiagnostic("frontend.provider_turn.error", {
        agentId: safeAgentId,
        instanceId: instanceId || "",
        message: messageText,
        paneId: lifecyclePaneId,
        pendingPromptId,
        terminalIndex: lifecycleTerminalIndex,
        threadId: safeThreadId,
        workspaceId: safeWorkspaceId,
      });
      onThreadTerminalLifecycle?.({
        agentId: safeAgentId,
        instanceId,
        paneId: lifecyclePaneId,
        pendingPromptId,
        projectionEvents: buildProviderTurnErrorProjectionEvents({
          agentId: safeAgentId,
          completedAt: new Date().toISOString(),
          error: messageText,
          turnId,
          userMessageId,
        }),
        status: "error",
        terminalIndex: lifecycleTerminalIndex,
        threadId: safeThreadId,
        type: "provider-turn-error",
        workspaceId: safeWorkspaceId,
      });
      if (pendingPromptId) {
        onThreadTerminalLifecycle?.({
          error: messageText,
          pendingPromptId,
          threadId: safeThreadId,
          type: "pending-prompt-error",
          workspaceId: safeWorkspaceId,
        });
      }
      throw error;
    }
  }, [
    reloadTerminalWithProviderSession,
    onThreadTerminalLifecycle,
    paneId,
    terminalIndex,
    workingDirectory,
    workspace?.id,
    workspace?.name,
  ]);

  const submitWorkspaceThreadMessage = useCallback(async ({ message, model, thread: targetThread, workspace: targetWorkspace }) => {
    const text = String(message || "").trim();
    const modelId = String(model || "").trim();
    const {
      agentId,
      binding,
      latestThread,
      providerBinding,
      targetTerminalIndex,
      targetWorkspaceId,
    } = getWorkspaceThreadTerminalTarget({
      fallbackWorkspace: workspace,
      targetThread,
      targetWorkspace,
      terminalAgentKind,
      workspaceThreads,
    });
    if (!text) {
      logThreadBridgeDiagnostic("frontend.thread_submit.skip", {
        agentId,
        bindingInstanceId: binding?.instanceId || "",
        bindingPaneId: binding?.paneId || "",
        currentTerminalThreadId: terminalThreadIdRef.current || "",
        latestThreadId: latestThread?.id || "",
        reason: "empty_text",
        targetTerminalIndex,
        targetWorkspaceId,
        textLength: text.length,
      });
      throw new Error("Write a message before sending.");
    }

    const providerSessionId = String(
      latestThread?.transcriptSessionId || providerBinding?.nativeSessionId || "",
    ).trim();
    const workspaceId = targetWorkspaceId || targetWorkspace?.id || workspace?.id || "";

    if (!binding?.paneId || !binding?.instanceId) {
      if (
        latestThread?.id
        && targetWorkspaceId
        && typeof onCreateWorkspaceThreadTerminal === "function"
      ) {
        logThreadBridgeDiagnostic("frontend.thread_submit.spawn_terminal", {
          agentId,
          currentTerminalThreadId: terminalThreadIdRef.current || "",
          latestThreadId: latestThread.id,
          providerSessionPresent: Boolean(providerSessionId),
          reason: "no_live_tui",
          sendPolicy: "terminal-confirmed-only",
          sourceTerminalIndex: terminalIndex,
          targetTerminalIndex,
          targetWorkspaceId,
          textLength: text.length,
        });
        const result = await onCreateWorkspaceThreadTerminal({
          agentId,
          deliveryMode: "terminal-confirmed",
          message: text,
          model: modelId,
          providerSessionId,
          sourcePaneId: paneId,
          sourceTerminalIndex: terminalIndex,
          thread: latestThread,
          threadId: latestThread.id,
          workspace: targetWorkspace || workspace,
        });
        if (result?.promptDelivery && typeof result.promptDelivery.then === "function") {
          await result.promptDelivery;
        }
        return;
      }

      logThreadBridgeDiagnostic("frontend.thread_submit.skip", {
        agentId,
        bindingInstanceId: binding?.instanceId || "",
        bindingPaneId: binding?.paneId || "",
        currentTerminalThreadId: terminalThreadIdRef.current || "",
        latestThreadId: latestThread?.id || "",
        providerSessionPresent: Boolean(providerSessionId),
        reason: "missing_bound_terminal",
        sendPolicy: "terminal-confirmed-only",
        targetTerminalIndex,
        targetWorkspaceId,
        textLength: text.length,
      });
      throw new Error("No active terminal is bound to this thread.");
    }

    const syncKey = getThreadComposerSyncKey(latestThread, binding);

    logBigViewSyncDiagnosticEvent("bigview.submit.terminal_start", {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      hasImageAttachmentBlock: text.includes("[image-attached"),
      latestThreadId: latestThread.id,
      messageLength: text.length,
      model: modelId || "",
      syncKey,
      workspaceId,
    });
    logThreadBridgeDiagnostic("frontend.thread_submit.start", {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      bindingTerminalIndex: binding.terminalIndex ?? "",
      currentTerminalThreadId: terminalThreadIdRef.current || "",
      latestThreadId: latestThread.id,
      modelIdPresent: Boolean(modelId),
      sameAsTerminalThreadRef: latestThread.id === terminalThreadIdRef.current,
      targetTerminalIndex,
      targetWorkspaceId,
      textLength: text.length,
      workspaceId: workspace?.id || "",
    });
    if (latestThread.id === terminalThreadIdRef.current) {
      markTerminalThreadActivityStatus("thinking", {
        forceNewTurn: true,
        reason: "bigview_thread_submit",
      });
    }

    const promptId = createThreadProjectionToken("prompt");
    const startedAt = new Date().toISOString();
    const turnId = `turn-${promptId}`;
    let submittedPromptRecord = null;
    if (latestThread.id === terminalThreadIdRef.current) {
      submittedPromptRecord = rememberTerminalThreadSubmittedPrompt({
        promptEventId: promptId,
        promptText: text,
        source: "bigview_thread_submit",
        submittedAt: startedAt,
        threadId: latestThread.id,
      });
    }
    const previousDraft = threadComposerDraftsRef.current.has(syncKey)
      ? threadComposerDraftsRef.current.get(syncKey)
      : "";
    const syncData = buildTerminalComposerDraftInput(previousDraft, text, true);
    const terminalSubmitSequence = getTerminalSubmitSequence(agentId, isGenericTerminal);
    const terminalDirectSubmitData = `${buildTerminalComposerDraftInput("", text, true)}${terminalSubmitSequence}`;

    if (!terminalSubmitSequence) {
      logThreadBridgeDiagnostic("frontend.thread_submit.blocked", {
        agentId,
        bindingInstanceId: binding.instanceId,
        bindingPaneId: binding.paneId,
        latestThreadId: latestThread.id,
        promptId,
        reason: "missing_submit_sequence",
        sendPolicy: "terminal-confirmed-only",
        workspaceId,
      });
      throw new Error("This thread cannot send without a live coding-agent TUI.");
    }

    logBigViewSyncDiagnosticEvent("bigview.submit.terminal_sync_start", {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      hasImageAttachmentBlock: text.includes("[image-attached"),
      latestThreadId: latestThread.id,
      messageLength: text.length,
      syncDataLength: syncData.length,
      syncKey,
      workspaceId,
    });
    logThreadBridgeDiagnostic("frontend.thread_submit.sync_start", {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      bindingTerminalIndex: binding.terminalIndex ?? "",
      forceReplace: true,
      latestThreadId: latestThread.id,
      previousDraftLength: previousDraft.length,
      promptId,
      sendPolicy: "terminal-confirmed-only",
      textLength: text.length,
      workspaceId,
    });
    setThreadComposerDraftValue(syncKey, text, "bigview_submit_sync_prompt");
    try {
      if (syncData) {
        await queueWorkspaceThreadComposerWrite({
          binding,
          data: syncData,
          threadId: latestThread.id,
        });
      } else {
        await threadComposerWriteChainRef.current;
      }
      threadComposerDirtyKeysRef.current.delete(syncKey);
    } catch (error) {
      logThreadBridgeDiagnostic("frontend.thread_submit.failed", {
        agentId,
        bindingInstanceId: binding.instanceId,
        bindingPaneId: binding.paneId,
        latestThreadId: latestThread.id,
        message: getErrorMessage(error, "Unable to sync prompt into the terminal."),
        promptId,
        reason: "sync_failed",
        textLength: text.length,
        workspaceId,
      });
      throw error;
    }
    logBigViewSyncDiagnosticEvent("bigview.submit.terminal_sync_done", {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      hasImageAttachmentBlock: text.includes("[image-attached"),
      latestThreadId: latestThread.id,
      messageLength: text.length,
      syncKey,
      workspaceId,
    });
    logThreadBridgeDiagnostic("frontend.thread_submit.sync_done", {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      latestThreadId: latestThread.id,
      promptId,
      textLength: text.length,
      workspaceId,
    });

    onThreadTerminalLifecycle?.({
      agentId,
      instanceId: binding.instanceId,
      messageCreatedAt: startedAt,
      messageId: promptId,
      messageSource: "bigview-submit",
      paneId: binding.paneId,
      promptEpoch: submittedPromptRecord?.promptEpoch || 0,
      prompt_epoch: submittedPromptRecord?.promptEpoch || 0,
      promptEventId: promptId,
      promptEventSubmittedAt: startedAt,
      repoPath: latestThread.coordination?.worktreePath || workingDirectory || "",
      source: "bigview-submit",
      status: "active",
      terminalIndex: latestThread.terminalIndex ?? binding.terminalIndex,
      threadId: latestThread.id,
      turnId,
      type: "message-submitted",
      userMessage: text,
      workspaceId,
      workspaceName: targetWorkspace?.name || workspace?.name || "",
    });
    logBigViewSyncDiagnosticEvent("bigview.submit.materialized_local_turn", {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      latestThreadId: latestThread.id,
      messageLength: text.length,
      promptId,
      turnId,
      workspaceId,
    });

    const acceptedWaiter = createWorkspaceThreadPromptAcceptedWaiter({
      agentId,
      expectedPrompt: text,
      promptId,
      threadId: latestThread.id,
      timeoutMs: terminalAgentUsesActivityHooks(agentId) ? 3000 : undefined,
      workspaceId,
    });
    let acceptedDetail = null;
    let submitWaiter = null;
    let directSubmitRetried = false;
    let terminalSubmitted = false;
    const writeDirectTerminalSubmit = async ({
      promptEventSource = "bigview-submit",
      promptEventSubmittedAt = startedAt,
      timeoutMs = 1500,
    } = {}) => {
      submitWaiter = await createTerminalPromptSubmittedWaiter({
        agentId,
        allowObservedInputGateForHookManaged: true,
        expectedPrompt: text,
        instanceId: binding.instanceId,
        paneId: binding.paneId,
        promptId,
        threadId: latestThread.id,
        timeoutMs,
        workspaceId,
      });
      logThreadBridgeDiagnostic("frontend.thread_submit.enter_write", {
        agentId,
        bindingInstanceId: binding.instanceId,
        bindingPaneId: binding.paneId,
        directSubmitDataLength: terminalDirectSubmitData.length,
        latestThreadId: latestThread.id,
        promptEventSource,
        promptId,
        submitSequenceLength: terminalSubmitSequence.length,
        textLength: text.length,
        workspaceId,
      });
      if (text.includes("[image-attached")) {
        logBigViewSyncDiagnosticEvent("bigview.image.terminal_submit_enter_write", {
          agentId,
          bindingInstanceId: binding.instanceId,
          bindingPaneId: binding.paneId,
          directSubmitDataLength: terminalDirectSubmitData.length,
          latestThreadId: latestThread.id,
          messageLength: text.length,
          promptEventSource,
          promptId,
          syncKey,
          terminalSubmitSequenceLength: terminalSubmitSequence.length,
          workspaceId,
        });
      }
      await invoke("terminal_write", {
        data: terminalDirectSubmitData,
        instanceId: binding.instanceId,
        paneId: binding.paneId,
        promptEventId: promptId,
        promptEventSource,
        promptEventSubmittedAt,
        promptEventText: text,
        threadId: latestThread.id,
      });
      const submittedPayload = await submitWaiter.promise;
      submitWaiter = null;
      return submittedPayload;
    };
    try {
      try {
        await writeDirectTerminalSubmit();
      } catch (submitError) {
        const isSubmitObservationTimeout = String(submitError?.message || submitError || "")
          .includes("Timed out waiting for the prompt to be observed in the terminal.");
        const latestDraft = String(threadComposerDraftsRef.current.get(syncKey) || "").trim();
        if (!isSubmitObservationTimeout || latestDraft !== text) {
          throw submitError;
        }
        logThreadBridgeDiagnostic("frontend.thread_submit.enter_retry", {
          agentId,
          bindingInstanceId: binding.instanceId,
          bindingPaneId: binding.paneId,
          latestThreadId: latestThread.id,
          promptId,
          reason: "submit_observation_timeout_after_direct_enter",
          textLength: text.length,
          workspaceId,
        });
        directSubmitRetried = true;
        await writeDirectTerminalSubmit({
          promptEventSource: "bigview-submit-enter-retry",
          promptEventSubmittedAt: new Date().toISOString(),
          timeoutMs: 6000,
        });
      }
      terminalSubmitted = true;
      logThreadBridgeDiagnostic("frontend.thread_submit.await_session_acceptance", {
        agentId,
        bindingInstanceId: binding.instanceId,
        bindingPaneId: binding.paneId,
        latestThreadId: latestThread.id,
        promptId,
        sendPolicy: "terminal-confirmed-and-session-accepted",
        textLength: text.length,
        workspaceId,
      });
      try {
        acceptedDetail = await waitForWorkspaceThreadPromptAcceptedWithEnterRetries({
          acceptedWaiter,
          agentId,
          binding,
          expectedPrompt: text,
          getDraftValue: () => threadComposerDraftsRef.current.get(syncKey) || "",
          isGenericTerminal,
          allowEnterRetry: !directSubmitRetried,
          logPrefix: "frontend.thread_submit",
          promptId,
          retryDelaysMs: [1000],
          submitSequence: terminalSubmitSequence,
          threadId: latestThread.id,
          workspaceId,
        });
      } catch (acceptanceError) {
        acceptedWaiter.cancel();
        logBigViewSyncDiagnosticEvent("bigview.submit.session_acceptance_missed", {
          agentId,
          bindingInstanceId: binding.instanceId,
          bindingPaneId: binding.paneId,
          latestThreadId: latestThread.id,
          message: getErrorMessage(acceptanceError, "Prompt was submitted but session acceptance was not observed."),
          messageLength: text.length,
          promptId,
          syncKey,
          workspaceId,
        });
        logThreadBridgeDiagnostic("frontend.thread_submit.session_acceptance_missed", {
          agentId,
          bindingInstanceId: binding.instanceId,
          bindingPaneId: binding.paneId,
          latestThreadId: latestThread.id,
          message: getErrorMessage(acceptanceError, "Prompt was submitted but session acceptance was not observed."),
          promptId,
          textLength: text.length,
          workspaceId,
        });
      }
      if (text.includes("[image-attached")) {
        logBigViewSyncDiagnosticEvent("bigview.image.terminal_submit_accepted", {
          acceptedMatchedBy: acceptedDetail?.matchedBy || "",
          agentId,
          bindingInstanceId: binding.instanceId,
          bindingPaneId: binding.paneId,
          latestThreadId: latestThread.id,
          messageLength: text.length,
          promptId,
          syncKey,
          workspaceId,
        });
      }
    } catch (error) {
      submitWaiter?.cancel?.();
      acceptedWaiter.cancel();
      if (!terminalSubmitted) {
        const messageText = getErrorMessage(error, "Unable to submit prompt through the terminal.");
        onThreadTerminalLifecycle?.({
          agentId,
          instanceId: binding.instanceId,
          paneId: binding.paneId,
          pendingPromptId: promptId,
          projectionEvents: buildProviderTurnErrorProjectionEvents({
            agentId,
            completedAt: new Date().toISOString(),
            error: messageText,
            source: "bigview-submit",
            turnId,
            userMessageId: promptId,
          }),
          status: "error",
          terminalIndex: latestThread.terminalIndex ?? binding.terminalIndex,
          threadId: latestThread.id,
          type: "provider-turn-error",
          workspaceId,
        });
      }
      if (text.includes("[image-attached")) {
        logBigViewSyncDiagnosticEvent("bigview.image.terminal_submit_error", {
          agentId,
          bindingInstanceId: binding.instanceId,
          bindingPaneId: binding.paneId,
          latestThreadId: latestThread.id,
          message: getErrorMessage(error, "Unable to submit prompt through the terminal."),
          messageLength: text.length,
          promptId,
          syncKey,
          workspaceId,
        });
      }
      logThreadBridgeDiagnostic("frontend.thread_submit.failed", {
        agentId,
        bindingInstanceId: binding.instanceId,
        bindingPaneId: binding.paneId,
        latestThreadId: latestThread.id,
        message: getErrorMessage(error, "Unable to submit prompt through the terminal."),
        promptId,
        textLength: text.length,
        workspaceId,
      });
      throw error;
    }

    const acceptedProviderSessionId = String(acceptedDetail?.sessionId || providerSessionId || "").trim();
    setThreadComposerDraftValue(syncKey, "", "bigview_submit_confirmed_clear");
    if (terminalAgentUsesActivityHooks(agentId)) {
      logThreadBridgeDiagnostic("frontend.thread_submit.hook_managed_start_deferred", {
        agentId,
        bindingInstanceId: binding.instanceId,
        bindingPaneId: binding.paneId,
        latestThreadId: latestThread.id,
        matchedBy: acceptedDetail?.matchedBy || "",
        promptId,
        providerSessionPresent: Boolean(acceptedProviderSessionId),
        source: "terminal-confirmed",
        textLength: text.length,
        workspaceId,
      });
    } else {
      onThreadTerminalLifecycle?.({
        activityStatus: "thinking",
        agentId,
        instanceId: binding.instanceId,
        paneId: binding.paneId,
        status: "active",
        terminalIndex: latestThread.terminalIndex ?? binding.terminalIndex,
        threadId: latestThread.id,
        type: "agent-output",
        workspaceId,
      });
      const providerTurnStartProjectionEvents = buildProviderTurnStartProjectionEvents({
        agentId,
        includeUserMessage: false,
        source: "terminal-confirmed",
        startedAt,
        text,
        turnId,
        userMessageId: promptId,
      });
      logThreadBridgeDiagnostic("frontend.thread_submit.emit_provider_turn_started", {
        agentId,
        bindingInstanceId: binding.instanceId,
        bindingPaneId: binding.paneId,
        latestThreadId: latestThread.id,
        matchedBy: acceptedDetail?.matchedBy || "",
        promptId,
        providerSessionPresent: Boolean(acceptedProviderSessionId),
        projectionEventCount: providerTurnStartProjectionEvents.length,
        source: "terminal-confirmed",
        textLength: text.length,
        userProjectionEventCount: providerTurnStartProjectionEvents.filter((projectionEvent) => (
          projectionEvent?.type === "thread.message.user"
        )).length,
        userProjectionMessageIds: providerTurnStartProjectionEvents
          .filter((projectionEvent) => projectionEvent?.type === "thread.message.user")
          .map((projectionEvent) => projectionEvent?.messageId || "")
          .filter(Boolean),
        workspaceId,
      });
      onThreadTerminalLifecycle?.({
        agentId,
        clearPendingPrompt: false,
        instanceId: binding.instanceId,
        model: modelId,
        modelSource: modelId ? "terminal-confirmed" : "",
        nativeSessionId: acceptedProviderSessionId,
        nativeSessionKind: acceptedProviderSessionId ? "session" : "",
        nativeSessionSource: acceptedProviderSessionId ? "terminal-confirmed" : "",
        paneId: binding.paneId,
        pendingPromptId: promptId,
        projectionEvents: providerTurnStartProjectionEvents,
        providerSessionId: acceptedProviderSessionId,
        repoPath: latestThread.coordination?.worktreePath || workingDirectory || "",
        status: "active",
        terminalIndex: latestThread.terminalIndex ?? binding.terminalIndex,
        threadId: latestThread.id,
        type: "provider-turn-started",
        workspaceId,
        workspaceName: targetWorkspace?.name || workspace?.name || "",
      });
    }
    logThreadBridgeDiagnostic("frontend.thread_submit.confirmed", {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      latestThreadId: latestThread.id,
      matchedBy: acceptedDetail?.matchedBy || "",
      promptId,
      providerSessionPresent: Boolean(acceptedProviderSessionId),
      textLength: text.length,
      workspaceId,
    });
  }, [
    isGenericTerminal,
    onThreadTerminalLifecycle,
    onCreateWorkspaceThreadTerminal,
    paneId,
    queueWorkspaceThreadComposerWrite,
    setThreadComposerDraftValue,
    terminalAgentKind,
    terminalIndex,
    workingDirectory,
    workspace,
    workspace?.id,
    workspace?.name,
    workspaceThreads,
  ]);
  const createWorkspaceThreadChat = useCallback(async ({ agentId, message, model, workspace: targetWorkspace }) => {
    const text = String(message || "").trim();
    const nextAgentId = getTerminalAgentKind(agentId);
    const targetWorkspaceId = targetWorkspace?.id || workspace?.id || "";
    const requestedModel = String(model || "").trim();

    if (!text) {
      throw new Error("Write a message before starting a chat.");
    }

    if (!["codex", "claude", "opencode"].includes(nextAgentId)) {
      throw new Error("Choose a coding agent before starting a chat.");
    }

    if (!workspace?.id || targetWorkspaceId !== workspace.id) {
      throw new Error("Open the workspace before starting a chat there.");
    }

    if (typeof onCreateWorkspaceThreadTerminal !== "function") {
      throw new Error("Unable to create a workspace terminal for this chat.");
    }

    const result = onCreateWorkspaceThreadTerminal({
      agentId: nextAgentId,
      message: text,
      model: requestedModel,
      sourcePaneId: paneId,
      sourceTerminalIndex: terminalIndex,
      workspace: targetWorkspace || workspace,
    });
    if (result?.promptDelivery && typeof result.promptDelivery.then === "function") {
      await result.promptDelivery;
    }
    return result;
  }, [
    onCreateWorkspaceThreadTerminal,
    paneId,
    terminalIndex,
    workspace,
  ]);
  const changeWorkspaceThreadModel = useCallback(async ({
    model,
    thread: targetThread,
    thinkingPower: requestedThinkingPower,
    thinkingPowerSource: requestedThinkingPowerSource,
  }) => {
    const nextModel = String(model || "").trim();
    const {
      agentId,
      binding,
      latestThread,
    } = getWorkspaceThreadTerminalTarget({
      fallbackWorkspace: workspace,
      targetThread,
      terminalAgentKind,
      workspaceThreads,
    });
    const modelWorkspaceId = latestThread?.workspaceId || targetThread?.workspaceId || workspace?.id || "";
    const modelWorkspaceEntry = modelWorkspaceId ? workspaceThreads?.[modelWorkspaceId] : null;
    const modelTerminalSnapshot = Object.values(modelWorkspaceEntry?.terminals || {})
      .map((terminal) => ({
        agentId: terminal?.agentId || "",
        instanceId: terminal?.instanceId || "",
        paneId: terminal?.paneId || "",
        status: terminal?.status || "",
        terminalIndex: terminal?.terminalIndex ?? "",
        threadId: terminal?.threadId || "",
      }))
      .slice(0, 16);
    const modelThreadSnapshot = Object.values(modelWorkspaceEntry?.threads || {})
      .filter((entryThread) => entryThread?.terminalBinding || entryThread?.id === latestThread?.id)
      .map((entryThread) => ({
        activityStatus: entryThread?.activityStatus || "",
        currentAgent: entryThread?.currentAgent || "",
        id: entryThread?.id || "",
        latestTurnState: entryThread?.latestTurn?.state || "",
        providerModel: getWorkspaceThreadProviderBinding(
          entryThread,
          getTerminalAgentKind(entryThread?.currentAgent || agentId),
        )?.modelId || "",
        terminalBindingInstanceId: entryThread?.terminalBinding?.instanceId || "",
        terminalBindingPaneId: entryThread?.terminalBinding?.paneId || "",
        terminalIndex: entryThread?.terminalIndex ?? "",
      }))
      .slice(0, 16);
    const requestedCodexThinkingPower = String(requestedThinkingPower || "").trim().toLowerCase();
    const validCodexThinkingPowers = new Set(["low", "medium", "high", "xhigh"]);
    const thinkingPower = agentId === "codex"
      ? (
        validCodexThinkingPowers.has(requestedCodexThinkingPower)
          ? requestedCodexThinkingPower
          : nextModel.toLowerCase().includes("spark")
            ? "high"
            : "medium"
      )
      : "";
    const thinkingPowerSource = agentId === "codex"
      ? (
        validCodexThinkingPowers.has(requestedCodexThinkingPower)
          ? requestedThinkingPowerSource || "thread_detail"
          : "terminal_default_inference"
      )
      : "not_configured";
    const requestIncludesThinkingPower = Boolean(agentId === "codex" && thinkingPower);
    logBigViewSyncDiagnosticEvent("bigview.model_change.terminal_received", {
      agentId,
      bindingInstanceId: binding?.instanceId || "",
      bindingPaneId: binding?.paneId || "",
      hasModel: Boolean(nextModel),
      modelTerminalSnapshot,
      modelThreadSnapshot,
      model: nextModel,
      requestIncludesThinkingPower,
      thinkingPower,
      thinkingPowerSource,
      threadId: latestThread?.id || targetThread?.id || "",
      workspaceId: latestThread?.workspaceId || targetThread?.workspaceId || workspace?.id || "",
    });
    if (!nextModel || !binding?.paneId || !binding?.instanceId || !latestThread?.id) {
      logBigViewSyncDiagnosticEvent("bigview.model_change.terminal_error", {
        agentId,
        hasBinding: Boolean(binding?.paneId && binding?.instanceId),
        hasLatestThread: Boolean(latestThread?.id),
        hasModel: Boolean(nextModel),
        message: "No active terminal is bound to this thread.",
        model: nextModel,
        reason: !nextModel ? "missing_model" : !latestThread?.id ? "missing_thread" : "missing_live_terminal_binding",
        threadId: latestThread?.id || targetThread?.id || "",
        workspaceId: latestThread?.workspaceId || targetThread?.workspaceId || workspace?.id || "",
      });
      throw new Error("No active terminal is bound to this thread.");
    }

    if (
      nextModel.length > 120
      || !nextModel.split("").every((character) => /[A-Za-z0-9._:/-]/.test(character))
    ) {
      logBigViewSyncDiagnosticEvent("bigview.model_change.terminal_error", {
        agentId,
        message: "Model id is invalid.",
        model: nextModel,
        reason: "invalid_model_id",
        threadId: latestThread.id,
        workspaceId: latestThread.workspaceId || workspace?.id || "",
      });
      throw new Error("Model id is invalid.");
    }

    const command = agentId === "codex" && thinkingPower
      ? `/model ${nextModel} ${thinkingPower}`
      : `/model ${nextModel}`;
    logBigViewSyncDiagnosticEvent("bigview.model_change.terminal_write_start", {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      commandLength: command.length,
      model: nextModel,
      modelTerminalSnapshot,
      modelThreadSnapshot,
      requestIncludesThinkingPower,
      thinkingPower,
      thinkingPowerSource,
      threadId: latestThread.id,
      workspaceId: latestThread.workspaceId || workspace?.id || "",
    });
    dispatchTerminalControlUiSuppression({
      agentId,
      instanceId: binding.instanceId,
      model: nextModel,
      paneId: binding.paneId,
      reason: "model-change",
      terminalIndex: latestThread.terminalIndex ?? binding.terminalIndex,
      threadId: latestThread.id,
      workspaceId: latestThread.workspaceId || workspace?.id || "",
    });
    try {
      await invoke("terminal_write", {
        data: buildTerminalSubmittedInput(command, agentId),
        instanceId: binding.instanceId,
        paneId: binding.paneId,
        promptEventSource: "model-change",
        threadId: latestThread.id,
      });
    } catch (error) {
      logBigViewSyncDiagnosticEvent("bigview.model_change.terminal_write_error", {
        agentId,
        bindingInstanceId: binding.instanceId,
        bindingPaneId: binding.paneId,
        message: error?.message || String(error || ""),
        model: nextModel,
        requestIncludesThinkingPower,
        thinkingPower,
        thinkingPowerSource,
        threadId: latestThread.id,
        workspaceId: latestThread.workspaceId || workspace?.id || "",
      });
      throw error;
    }
    logBigViewSyncDiagnosticEvent("bigview.model_change.terminal_write_done", {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      model: nextModel,
      requestIncludesThinkingPower,
      thinkingPower,
      thinkingPowerSource,
      threadId: latestThread.id,
      workspaceId: latestThread.workspaceId || workspace?.id || "",
    });
    logBigViewSyncDiagnosticEvent("bigview.model_state.terminal_selected_emit", {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      model: nextModel,
      modelSource: "user",
      terminalIndex: latestThread.terminalIndex ?? binding.terminalIndex,
      threadId: latestThread.id,
      workspaceId: latestThread.workspaceId || workspace?.id || "",
    });
    onThreadTerminalLifecycle?.({
      agentId,
      instanceId: binding.instanceId,
      model: nextModel,
      modelId: nextModel,
      modelSource: "user",
      paneId: binding.paneId,
      terminalIndex: latestThread.terminalIndex ?? binding.terminalIndex,
      threadId: latestThread.id,
      type: "model-selected",
      workspaceId: latestThread.workspaceId || workspace?.id || "",
    });
  }, [onThreadTerminalLifecycle, terminalAgentKind, workspace, workspaceThreads]);
  const changeWorkspaceThreadAgent = useCallback(async ({ agentId, thread: targetThread, workspace: targetWorkspace }) => {
    const nextAgentId = getTerminalAgentKind(agentId);
    const targetTerminalIndex = Number.parseInt(
      targetThread?.terminalIndex ?? targetThread?.terminalBinding?.terminalIndex,
      10,
    );
    if (!targetThread?.id || !targetThread?.workspaceId || !Number.isInteger(targetTerminalIndex)) {
      throw new Error("This thread is not attached to a workspace terminal slot.");
    }

    onChangeTerminalRole?.({
      role: nextAgentId,
      source: "thread_agent_switch",
      terminalIndex: targetTerminalIndex,
      threadId: targetThread.id,
      workspaceId: targetThread.workspaceId || targetWorkspace?.id || workspace?.id || "",
    });
  }, [onChangeTerminalRole, workspace?.id]);
  const handleThreadsViewActiveThreadChange = useCallback((selection = {}) => {
    threadsViewSelectedThreadRef.current = selection?.thread
      ? selection
      : null;
  }, []);
  const activateTerminalPane = useCallback((source = "terminal_activation", options = {}) => {
    const focusKeyboard = options?.focusKeyboard !== false;
    const instanceId = terminalInstanceIdRef.current || 0;
    const alreadyActive = terminalActiveRef.current === true;

    if (!alreadyActive) {
      terminalActiveRef.current = true;
      setActiveTerminalKeyboardTarget(paneId, instanceId);
      updateTerminalInteractiveState(true);
      onActivateTerminal?.({
        instanceId,
        paneId,
        source,
        terminalIndex,
        workspaceId: workspace?.id || "",
      });
    } else if (focusKeyboard) {
      setActiveTerminalKeyboardTarget(paneId, instanceId);
    }
    setTerminalAudioInputTarget(true, instanceId, source);

    if (focusKeyboard) {
      focusTerminalKeyboardInput(true);
    }
  }, [
    focusTerminalKeyboardInput,
    onActivateTerminal,
    paneId,
    setTerminalAudioInputTarget,
    terminalIndex,
    updateTerminalInteractiveState,
    workspace?.id,
  ]);

  const requestTerminalDragFromEvent = useCallback((event, options = {}) => {
    const breakoutSurfaceDrag = options?.breakoutSurfaceDrag === true;

    if (
      terminalClosed
      || terminalClosing
      || isFullscreen
      || event.button !== 0
      || (breakoutSurfaceDrag && !terminalBreakoutActive)
      || (!terminalBreakoutActive && terminalCount <= 1)
    ) {
      return false;
    }

    const surfaceElement = surfaceRef.current;
    const panelElement = surfaceElement?.parentElement || null;

    event.preventDefault();
    event.stopPropagation();

    activateTerminalPane(
      breakoutSurfaceDrag ? "terminal_breakout_drag" : "terminal_drag",
      { focusKeyboard: false },
    );

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

    return true;
  }, [
    activateTerminalPane,
    isFullscreen,
    onBeginTerminalDrag,
    paneId,
    terminalBreakoutActive,
    terminalClosed,
    terminalClosing,
    terminalCount,
    terminalIndex,
    workspace?.id,
  ]);

  const beginBreakoutSurfaceDragGesture = useCallback((event) => {
    if (
      !terminalBreakoutActive
      || terminalClosed
      || terminalClosing
      || isFullscreen
      || event.button !== 0
    ) {
      return false;
    }

    return requestTerminalDragFromEvent(event, { breakoutSurfaceDrag: true });
  }, [
    isFullscreen,
    requestTerminalDragFromEvent,
    terminalBreakoutActive,
    terminalClosed,
    terminalClosing,
  ]);

  const handleTerminalSurfaceFocusCapture = useCallback((event) => {
    if (isTerminalControlEventTarget(event.target)) {
      return;
    }

    if (!terminalSelectsOnPointerDown && terminalPointerSelectionPendingRef.current) {
      return;
    }

    activateTerminalPane("terminal_focus", { focusKeyboard: false });
  }, [activateTerminalPane, terminalSelectsOnPointerDown]);

  const handleTerminalSurfacePointerDownCapture = useCallback((event) => {
    if (isTerminalControlEventTarget(event.target)) {
      return;
    }

    if (
      terminalBreakoutActive
      && beginBreakoutSurfaceDragGesture(event)
    ) {
      terminalPointerSelectionPendingRef.current = false;
      return;
    }

    if (!terminalSelectsOnPointerDown) {
      terminalPointerSelectionPendingRef.current = true;
      return;
    }

    activateTerminalPane("terminal_pointer", { focusKeyboard: false });
  }, [
    activateTerminalPane,
    beginBreakoutSurfaceDragGesture,
    terminalBreakoutActive,
    terminalSelectsOnPointerDown,
  ]);

  useEffect(() => {
    if (terminalSelectsOnPointerDown) {
      terminalPointerSelectionPendingRef.current = false;
      return undefined;
    }

    const clearPendingPointerSelection = () => {
      terminalPointerSelectionPendingRef.current = false;
    };

    window.addEventListener("pointerup", clearPendingPointerSelection, true);
    window.addEventListener("pointercancel", clearPendingPointerSelection, true);
    return () => {
      window.removeEventListener("pointerup", clearPendingPointerSelection, true);
      window.removeEventListener("pointercancel", clearPendingPointerSelection, true);
    };
  }, [terminalSelectsOnPointerDown]);
  const handleTerminalUiViewFocusCapture = useCallback(() => {
    activateTerminalPane("terminal_ui_view_focus", { focusKeyboard: false });
  }, [activateTerminalPane]);
  const handleTerminalUiViewPointerDownCapture = useCallback(() => {
    activateTerminalPane("terminal_ui_view_pointer", { focusKeyboard: false });
  }, [activateTerminalPane]);

  useEffect(() => {
    const nextActive = Boolean(isActive);
    const wasActiveProp = terminalActivePropRef.current === true;
    terminalActivePropRef.current = nextActive;
    terminalActiveRef.current = nextActive;
    updateTerminalInteractiveState(nextActive);

    if (nextActive) {
      const instanceId = terminalInstanceIdRef.current || 0;
      setActiveTerminalKeyboardTarget(paneId, instanceId);
      setTerminalAudioInputTarget(true, instanceId, "terminal_active_prop");
      if (!wasActiveProp) {
        attachDeferredWebglRef.current?.("terminal_activated");
        // Resizes are skipped while a pane's surface is hidden; activation is
        // the reveal path, so reconcile any size drift now.
        resizeControllerRef.current?.schedule("terminal_activated", 0);
      }
      return undefined;
    }

    const instanceId = terminalInstanceIdRef.current || 0;
    clearActiveTerminalKeyboardTargetIfCurrent(paneId, instanceId);
    setTerminalAudioInputTarget(false, instanceId, "terminal_inactive_prop");
    return undefined;
  }, [isActive, paneId, setTerminalAudioInputTarget, updateTerminalInteractiveState]);

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

  const materializeFreshThreadForTerminalSession = useCallback((target = {}) => {
    const targetWorkspaceId = String(target.workspaceId || workspace?.id || "").trim();
    const targetTerminalIndex = Number.parseInt(target.terminalIndex ?? terminalIndex, 10);
    const nextAgentId = getTerminalAgentKind(target.agentId || terminalAgentKind);
    if (
      !targetWorkspaceId
      || !Number.isInteger(targetTerminalIndex)
      || !["codex", "claude", "opencode"].includes(nextAgentId)
    ) {
      return "";
    }

    const nextThreadId = String(target.threadId || createWorkspaceThreadId(targetWorkspaceId, targetTerminalIndex)).trim();
    logThreadBridgeDiagnostic("frontend.thread_fresh_session.materialize", {
      agentId: nextAgentId,
      instanceId: target.instanceId || "",
      nextThreadId,
      paneId: target.paneId || "",
      repoPathPresent: Boolean(target.repoPath || workingDirectory),
      terminalIndex: targetTerminalIndex,
      workspaceId: targetWorkspaceId,
    });
    onThreadTerminalLifecycle?.({
      agentId: nextAgentId,
      freshSession: true,
      instanceId: target.instanceId || undefined,
      paneId: target.paneId || "",
      repoPath: target.repoPath || workingDirectory || "",
      slotKey: String(targetTerminalIndex + 1),
      status: "starting",
      terminalIndex: targetTerminalIndex,
      threadId: nextThreadId,
      transcriptHydrationMode: "session-only",
      type: "thread-starting",
      workspaceId: targetWorkspaceId,
      workspaceName: target.workspaceName || workspace?.name || "",
    });
    return nextThreadId;
  }, [
    onThreadTerminalLifecycle,
    terminalAgentKind,
    terminalIndex,
    workingDirectory,
    workspace?.id,
    workspace?.name,
  ]);

  const restartWithEmptyTerminalSession = useCallback((detail = {}) => {
    const nextSlotKey = String(Math.max(0, Number.parseInt(terminalIndex, 10) || 0) + 1);
    const nextThreadId = String(
      detail.nextThreadId
        || detail.threadId
        || createWorkspaceThreadId(workspace?.id || "", terminalIndex),
    ).trim();

    setRestartRoleMenuOpen(false);
    setTerminalClosed(false);
    terminalClosingRef.current = false;
    preserveCoordinationOnNextCleanupRef.current = false;
    preserveCoordinationOnNextOpenRef.current = false;
    forceFreshSessionOnNextOpenRef.current = true;
    terminalThreadIdRef.current = nextThreadId;
    terminalThreadSlotKeyRef.current = nextSlotKey;
    pendingThreadStartingLifecycleRef.current = {
      agentId: detail.agentId || terminalAgentKind,
      paneId,
      repoPath: detail.repoPath || workingDirectory || "",
      terminalIndex,
      threadId: nextThreadId,
      workspaceId: workspace?.id || "",
      workspaceName: detail.workspaceName || workspace?.name || "",
    };
    resetTerminalReadinessForEpoch({
      activityStatus: "idle",
      instanceId: 0,
      reason: "restart_empty_terminal_session",
      threadId: nextThreadId,
    });
    markTerminalThreadActivityStatus("idle", {
      reason: "restart_empty_terminal_session",
    });
    logThreadBridgeDiagnostic("frontend.thread_restart_empty_session", {
      currentThreadId: thread?.id || "",
      nextSlotKey,
      nextThreadId,
      paneId,
      reason: detail.reason || "",
      terminalIndex,
      workspaceId: workspace?.id || "",
    });
    setTerminalClosing(false);
    setTerminalState("starting");
    setTerminalError("");
    setTerminalLaunchInfo(null);
    setParkedPrompt(null);
    parkedPromptRef.current = null;
    setTerminalStatus({
      detail: detail.statusDetail || "Starting an empty terminal session.",
      title: "Preparing Terminal",
      visible: true,
    });
    setRestartKey((key) => key + 1);
  }, [paneId, terminalAgentKind, terminalIndex, thread?.id, workingDirectory, workspace?.id, workspace?.name]);

  useEffect(() => {
    const handleEmptyThreadReset = (event) => {
      const detail = event?.detail || {};
      const targetWorkspaceId = String(detail.workspaceId || "").trim();
      const targetThreadId = String(detail.threadId || "").trim();
      const targetPaneId = String(detail.paneId || "").trim();
      const targetTerminalIndex = Number.parseInt(detail.terminalIndex, 10);

      if (
        !targetWorkspaceId
        || targetWorkspaceId !== String(workspace?.id || "")
        || !Number.isInteger(targetTerminalIndex)
        || targetTerminalIndex !== terminalIndex
        || (targetPaneId && targetPaneId !== paneId)
        || (!targetPaneId && targetThreadId && targetThreadId !== terminalThreadIdRef.current && targetThreadId !== thread?.id)
        || terminalClosed
        || terminalClosingRef.current
      ) {
        return;
      }

      restartWithEmptyTerminalSession(detail);
    };

    window.addEventListener(WORKSPACE_THREAD_ARCHIVE_TERMINAL_RESET_EVENT, handleEmptyThreadReset);
    return () => {
      window.removeEventListener(WORKSPACE_THREAD_ARCHIVE_TERMINAL_RESET_EVENT, handleEmptyThreadReset);
    };
  }, [paneId, restartWithEmptyTerminalSession, terminalClosed, terminalIndex, thread?.id, workspace?.id]);

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
      const listenerState = terminalEventListenerStateRef.current || {};
      const payload = event.payload || {};
      if (
        payload.paneId !== listenerState.paneId
        || Number(payload.instanceId || 0) !== Number(terminalInstanceIdRef.current || 0)
      ) {
        return;
      }

      const promptKey = `${Number(payload.instanceId || 0)}:${payload.taskId || ""}`;
      const promptEventId = String(payload.promptEventId || payload.prompt_event_id || "").trim();
      const lifecycleThreadId = String(
        payload.threadId
        || payload.thread_id
        || terminalThreadIdRef.current
        || listenerState.threadId
        || "",
      ).trim();
      const lifecycleWorkspaceId = String(
        payload.workspaceId
        || payload.workspace_id
        || listenerState.workspaceId
        || listenerState.threadWorkspaceId
        || "",
      ).trim();
      const lifecycleTerminalIndex = Number.isFinite(Number(payload.terminalIndex ?? payload.terminal_index))
        ? Number(payload.terminalIndex ?? payload.terminal_index)
        : listenerState.terminalIndex;
      const parkedStatus = String(payload.activityStatus || payload.activity_status || payload.status || "").trim().toLowerCase();
      if (TERMINAL_PARKED_PROMPT_BLOCKING_STATUSES.has(parkedStatus)) {
        if (cancellingParkedPromptKeysRef.current.has(promptKey)) {
          return;
        }
        setParkedPrompt({ ...payload, activityStatus: parkedStatus, status: parkedStatus });
        if (lifecycleThreadId && lifecycleWorkspaceId) {
          listenerState.onThreadTerminalLifecycle?.({
            activityStatus: parkedStatus,
            agentId: listenerState.terminalAgentKind,
            instanceId: Number(payload.instanceId || terminalInstanceIdRef.current || 0) || undefined,
            inputReady: false,
            ...getTerminalNativeRailStateFields(parkedStatus),
            paneId: listenerState.paneId,
            pendingPromptId: promptEventId,
            promptEventId,
            source: parkedStatus === "parked" ? "terminal-parked" : `terminal-parked-${parkedStatus}`,
            status: parkedStatus,
            terminalIndex: lifecycleTerminalIndex,
            threadId: lifecycleThreadId,
            type: "agent-output",
            workspaceId: lifecycleWorkspaceId,
          });
        }
      } else {
        cancellingParkedPromptKeysRef.current.delete(promptKey);
        setParkedPrompt(null);
        if (
          parkedStatus === "resumed"
          && String(payload.reason || "").trim() !== "task_terminal"
          && lifecycleThreadId
          && lifecycleWorkspaceId
        ) {
          const startedAt = new Date().toISOString();
          const userMessageId = promptEventId || String(payload.taskId || "").trim() || createThreadProjectionToken("message-user");
          const turnId = `turn-${userMessageId}`;
          listenerState.onThreadTerminalLifecycle?.({
            activityStatus: parkedStatus,
            agentId: listenerState.terminalAgentKind,
            instanceId: Number(payload.instanceId || terminalInstanceIdRef.current || 0) || undefined,
            inputReady: false,
            ...getTerminalNativeRailStateFields(parkedStatus),
            paneId: listenerState.paneId,
            pendingPromptId: promptEventId || userMessageId,
            promptEventId: promptEventId || userMessageId,
            projectionEvents: buildProviderTurnStartProjectionEvents({
              agentId: listenerState.terminalAgentKind,
              includeUserMessage: false,
              source: "terminal-parked-resume",
              startedAt,
              text: payload.title ? `Resume parked task: ${payload.title}` : "Resume parked task.",
              turnId,
              userMessageId,
            }),
            source: "terminal-parked-resume",
            status: "active",
            terminalIndex: lifecycleTerminalIndex,
            threadId: lifecycleThreadId,
            type: "provider-turn-started",
            workspaceId: lifecycleWorkspaceId,
          });
        }
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
  }, []);

  useEffect(() => {
    if (!agent) {
      startAgentInPrewarmedTerminalRef.current = null;
      preserveCoordinationOnNextCleanupRef.current = false;
      preserveCoordinationOnNextOpenRef.current = false;
      forceFreshSessionOnNextOpenRef.current = false;
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
      forceFreshSessionOnNextOpenRef.current = false;
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

    if (!terminalStartupUnblocked) {
      startAgentInPrewarmedTerminalRef.current = null;
      setTerminalState("starting");
      setTerminalError("");
      setTerminalStatus({
        detail: "Loading the saved thread session before launching this terminal.",
        title: "Restoring Terminal",
        visible: true,
      });
      setTerminalLaunchInfo(null);
      setParkedPrompt(null);
      terminalClosingRef.current = false;
      setTerminalClosing(false);
      logTerminalStatus("frontend.terminal_lifecycle.wait_for_thread_restore", {
        agentId: agent?.id || terminalAgentKind,
        paneId,
        terminalIndex,
        terminalRoleId,
        threadId: terminalThreadIdRef.current || thread?.id || "",
        workspaceId: workspace?.id || "",
      });
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
    let webglBackgroundDeferred = false;
    const startupWatchTimers = new Set();
    // Tauri's WebView can corrupt xterm's WebGL glyph atlas during rapid multi-pane resize.
    let rendererMode = useWebglRenderer ? "webgl_pending" : "dom";
    let runtimeTerminalState = "starting";
    const preserveCoordinationForThisStart = preserveCoordinationOnNextOpenRef.current && !isGenericTerminal;
    const forceFreshSessionForThisStart = (
      forceFreshSessionOnNextOpenRef.current
      || Boolean(thread?.freshSessionStartedAt && !threadProviderSessionId)
    ) && !isGenericTerminal;
    const providerSessionOverrideForThisStart = forceFreshSessionForThisStart
      ? ""
      : String(providerSessionOverrideOnNextOpenRef.current || "").trim();
    const startupThreadProviderSessionId = forceFreshSessionForThisStart
      ? ""
      : providerSessionOverrideForThisStart || threadProviderSessionId;
    const startupDefaultModel = isGenericTerminal ? "" : getTerminalStartupDefaultModel(terminalAgentKind);
    const startupThreadProviderModel = isGenericTerminal ? "" : threadProviderModel || startupDefaultModel;
    const startupThreadProviderModelSource = threadProviderModel
      ? "session-restore"
      : startupThreadProviderModel
        ? "app-default"
        : "";
    const startupThreadId = terminalThreadIdRef.current;
    const startupSlotKey = forceFreshSessionForThisStart
      ? String(Math.max(0, Number.parseInt(terminalIndex, 10) || 0) + 1)
      : terminalThreadSlotKeyRef.current;
    preserveCoordinationOnNextOpenRef.current = false;
    forceFreshSessionOnNextOpenRef.current = false;
    providerSessionOverrideOnNextOpenRef.current = "";
    if (forceFreshSessionForThisStart) {
      terminalThreadSlotKeyRef.current = startupSlotKey;
    }
    if (!preserveCoordinationForThisStart || forceFreshSessionForThisStart) {
      setTerminalLaunchInfo(null);
    }
    const previousStartupSnapshot = terminalStartupSnapshotRef.current || {};
    const startupSnapshot = {
      forceFreshSessionForThisStart,
      preserveCoordinationForThisStart,
      restartKey,
      startupThreadId,
      startupThreadProviderSessionId,
      terminalClosed,
      terminalIndex,
      terminalState,
      threadProviderSessionId,
      workspaceId: workspace?.id || "",
    };
    terminalStartupSnapshotRef.current = startupSnapshot;
    logThreadBridgeDiagnostic("frontend.thread_terminal_start", {
      agentId: terminalAgentKind,
      forceFreshSessionForThisStart,
      isGenericTerminal,
      paneId,
      previousRestartKey: previousStartupSnapshot.restartKey ?? "",
      previousStartupThreadId: previousStartupSnapshot.startupThreadId || "",
      previousStartupThreadProviderSessionPresent: Boolean(previousStartupSnapshot.startupThreadProviderSessionId),
      previousTerminalState: previousStartupSnapshot.terminalState || "",
      providerSessionBecamePresent: Boolean(
        !previousStartupSnapshot.threadProviderSessionId && threadProviderSessionId,
      ),
      providerSessionChanged: previousStartupSnapshot.threadProviderSessionId !== undefined
        && previousStartupSnapshot.threadProviderSessionId !== threadProviderSessionId,
      preserveCoordinationForThisStart,
      providerSessionOverridePresent: Boolean(providerSessionOverrideForThisStart),
      restartKey,
      restartKeyChanged: previousStartupSnapshot.restartKey !== undefined
        && previousStartupSnapshot.restartKey !== restartKey,
      startupSlotKey,
      startupDefaultModel: startupDefaultModel || "",
      startupThreadId: startupThreadId || "",
      startupThreadProviderModelSource,
      startupThreadProviderModelPresent: Boolean(startupThreadProviderModel),
      startupThreadProviderSessionPresent: Boolean(startupThreadProviderSessionId),
      terminalClosed,
      terminalIndex,
      terminalState,
      threadProviderSessionPresent: Boolean(threadProviderSessionId),
      workspaceId: workspace?.id || "",
    });
    logBigViewSyncDiagnosticEvent("bigview.model_restore.terminal_start_snapshot", {
      agentId: terminalAgentKind,
      forceFreshSessionForThisStart,
      isGenericTerminal,
      paneId,
      providerSessionOverridePresent: Boolean(providerSessionOverrideForThisStart),
      restartKey,
      startupDefaultModel: startupDefaultModel || "",
      startupThreadId: startupThreadId || "",
      startupThreadProviderModel: startupThreadProviderModel || "",
      startupThreadProviderModelSource,
      startupThreadProviderSessionPresent: Boolean(startupThreadProviderSessionId),
      terminalIndex,
      threadProviderModel: threadProviderModel || "",
      threadProviderSessionPresent: Boolean(threadProviderSessionId),
      workspaceId: workspace?.id || "",
    });
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
    let outputAdaptiveFlushMaxBytes = TERMINAL_OUTPUT_BATCH_MAX_BYTES;
    let visibleOutputRefreshTimer = 0;
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
    let lastTerminalSizeDesyncSignature = "";
    const checkTerminalSizeDesyncOnInput = (reason) => {
      const nativeSize = resizeController?.getLastNativeAppliedSize?.();
      if (
        !nativeSize
        || resizeController?.hasPendingNativeResize?.()
        || nativeSize.paneId !== paneId
        || Number(nativeSize.instanceId || 0) !== Number(terminalInstanceId || 0)
      ) {
        return;
      }

      const terminalCols = Number(terminal?.cols || 0);
      const terminalRows = Number(terminal?.rows || 0);
      if (
        !terminalCols
        || !terminalRows
        || (nativeSize.cols === terminalCols && nativeSize.rows === terminalRows)
      ) {
        return;
      }

      const signature = `${nativeSize.cols}x${nativeSize.rows}->${terminalCols}x${terminalRows}`;
      if (signature !== lastTerminalSizeDesyncSignature) {
        lastTerminalSizeDesyncSignature = signature;
        logTerminalDiagnosticEvent("frontend.terminal_size_desync", {
          isGenericTerminal,
          nativeCols: nativeSize.cols,
          nativeRows: nativeSize.rows,
          paneId,
          reason,
          terminalCols,
          terminalRows,
          terminalIndex,
        });
      }
      if (isGenericTerminal) {
        resizeController?.resizeNow("interactive_input_size_desync", {
          force: true,
          forceNative: true,
        });
      }
    };
    const noteTerminalInteractiveInput = (reason = "input", durationMs = 0) => {
      terminalGlobalRenderScheduler.noteInteractiveInput?.(renderSchedulerId, {
        durationMs,
        reason,
      });
      checkTerminalSizeDesyncOnInput(reason);
    };
    terminalInstanceIdRef.current = terminalInstanceId;
    resetTerminalReadinessForEpoch({
      activityStatus: "idle",
      instanceId: terminalInstanceId,
      reason: "terminal_instance_allocated",
      threadId: startupThreadId,
    });
    const pendingThreadStartingLifecycle = pendingThreadStartingLifecycleRef.current;
    if (
      pendingThreadStartingLifecycle
      && String(pendingThreadStartingLifecycle.workspaceId || "") === String(workspace?.id || "")
      && Number(pendingThreadStartingLifecycle.terminalIndex) === terminalIndex
      && (
        !pendingThreadStartingLifecycle.paneId
        || pendingThreadStartingLifecycle.paneId === paneId
      )
    ) {
      pendingThreadStartingLifecycleRef.current = null;
      materializeFreshThreadForTerminalSession({
        ...pendingThreadStartingLifecycle,
        instanceId: terminalInstanceId,
        paneId,
        terminalIndex,
        threadId: startupThreadId || pendingThreadStartingLifecycle.threadId,
        workspaceId: workspace?.id || pendingThreadStartingLifecycle.workspaceId || "",
        workspaceName: workspace?.name || pendingThreadStartingLifecycle.workspaceName || "",
      });
    }
    terminalFirstVisibleOutputAtRef.current = 0;
    terminalRunningSinceRef.current = 0;
    const terminalDiagnosticsEnabled = isTerminalDiagnosticLoggingEnabled();
    const windowsTerminalDiagnosticsEnabled = isWindowsTerminalDiagnosticLoggingEnabled();
    if (terminalActiveRef.current) {
      setActiveTerminalKeyboardTarget(paneId, terminalInstanceId);
      setTerminalAudioInputTarget(true, terminalInstanceId, "terminal_instance_allocated");
    }
    const lifecycleStartedAt = performance.now();
    const setPaneStage = (state, title, detail = "", fields = {}) => {
      if (isDisposed) {
        return;
      }

      runtimeTerminalState = state;
      if (state === "running") {
        terminalRunningSinceRef.current = terminalRunningSinceRef.current || performance.now();
      } else if (state === "starting" || state === "blocked" || state === "closed" || state === "error") {
        terminalRunningSinceRef.current = 0;
      }
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
      // Alt+click must never synthesize arrow keys: agent CLIs treat Up as
      // history recall, so a stray Option+click would paste the previous
      // prompt into the composer.
      altClickMovesCursor: false,
      convertEol: false,
      cursorBlink: terminalActiveRef.current && !parkedPromptRef.current,
      cursorStyle: "block",
      customGlyphs: true,
      disableStdin: Boolean(parkedPromptRef.current),
      fastScrollModifier: "alt",
      fastScrollSensitivity: 5,
      fontFamily: "\"Cascadia Mono\", \"SFMono-Regular\", Consolas, monospace",
      // Per-terminal zoom: seeded from the persisted per-pane size; the
      // dedicated effect applies live +/- changes.
      fontSize: terminalFontSizeRef.current,
      lineHeight: 1.0,
      macOptionIsMeta: true,
      // Codex keeps cwd/status text on the live cursor row; do not let narrow resizes reflow stale worktree cells.
      // Plain shells are the opposite: the cursor row is the prompt/input line and only the shell's WINCH redraw
      // repaints it, so it must reflow with the rest of the buffer or resizes leave a stale gap in the input line.
      reflowCursorLine: isGenericTerminal,
      scrollSensitivity: 1,
      scrollOnEraseInDisplay: false,
      scrollback: TERMINAL_DEFAULT_SCROLLBACK_ROWS,
      smoothScrollDuration: 0,
      ...(TERMINAL_IS_WINDOWS_HOST ? { windowsPty: buildWindowsPtyOptions() } : {}),
      theme: getTerminalThemeForForgeTheme(),
    });
    xtermRef.current = terminal;
    const detachPushToTalkGuard = guardXtermDuringPushToTalk(terminal);

    let providerSessionCaptureBuffer = "";
    let providerSessionErrorBuffer = "";
    let providerSessionCaptureMissesLogged = 0;
    let capturedProviderSessionId = startupThreadProviderSessionId || "";
    let invalidProviderSessionEmitted = false;
    const emitInvalidProviderSession = (sessionId, message, source = "terminal-output") => {
      const invalidSessionId = String(sessionId || "").trim();
      if (
        invalidProviderSessionEmitted
        || isDisposed
        || isGenericTerminal
        || terminalAgentKind !== "codex"
        || !invalidSessionId
        || (startupThreadProviderSessionId && invalidSessionId !== startupThreadProviderSessionId)
      ) {
        return false;
      }

      invalidProviderSessionEmitted = true;
      capturedProviderSessionId = "";
      providerSessionCaptureBuffer = "";
      const threadId = terminalThreadIdRef.current || startupThreadId || "";
      const errorMessage = String(
        message || `Codex saved session ${invalidSessionId} is not available locally.`,
      );
      logThreadBridgeDiagnostic("frontend.thread_provider_session.invalid_resume", {
        agentId: terminalAgentKind,
        error: errorMessage,
        instanceId: terminalInstanceId,
        nativeSessionIdPresent: true,
        paneId,
        source,
        startupThreadProviderSessionPresent: Boolean(startupThreadProviderSessionId),
        terminalIndex,
        threadId,
        workspaceId: workspace?.id || "",
      });
      onThreadTerminalLifecycle?.({
        agentId: terminalAgentKind,
        error: errorMessage,
        instanceId: terminalInstanceId,
        nativeSessionId: invalidSessionId,
        nativeSessionKind: "session",
        nativeSessionSource: source,
        paneId,
        providerSessionId: invalidSessionId,
        sessionId: invalidSessionId,
        status: "error",
        terminalIndex,
        threadId,
        type: "provider-session-invalid",
        workspaceId: workspace?.id || "",
      });
      return true;
    };
    let codingAgentInputReadyEmitted = false;
    let codingAgentInputReadyEmissionKey = "";
    const emitCodingAgentInputReady = (source = "timer", options = {}) => {
      const submittedPromptForReady = terminalThreadSubmittedPromptRef.current;
      const readinessKey = String(
        options.readinessKey
          || submittedPromptForReady?.promptEventId
          || submittedPromptForReady?.promptEpoch
          || "startup",
      ).trim();
      const allowRepeated = options.allowRepeated === true && readinessKey !== "startup";
      if (allowRepeated && codingAgentInputReadyEmissionKey === readinessKey) {
        return false;
      }
      if (!allowRepeated && codingAgentInputReadyEmitted) {
        return false;
      }

      const readinessEvidence = String(
        options.readinessEvidence
          || options.completionEvidence
          || "",
      ).trim();
      if (!readinessEvidence) {
        codingAgentInputReadyEmitted = true;
        logThreadBridgeDiagnostic("frontend.thread_terminal_input_ready_timer_disabled", {
          agentId: terminalAgentKind,
          instanceId: terminalInstanceId,
          nativeSessionIdPresent: Boolean(capturedProviderSessionId),
          paneId,
          reason: "missing_positive_readiness_evidence",
          source,
          terminalIndex,
          threadId: terminalThreadIdRef.current || "",
          workspaceId: workspace?.id || "",
        });
        return false;
      }

      const inputReadyAt = new Date().toISOString();
      codingAgentInputReadyEmitted = true;
      codingAgentInputReadyEmissionKey = readinessKey;
      markTerminalThreadActivityStatus("idle", {
        reason: source,
      });
      terminalThreadLastReadyAtMsRef.current = parseTerminalStateTimestampMs(inputReadyAt) || Date.now();
      if (options.clearSubmittedPrompt !== false) {
        terminalThreadSubmittedPromptRef.current = null;
      }
      logThreadBridgeDiagnostic("frontend.thread_terminal_input_ready", {
        agentId: terminalAgentKind,
        inputReadyAt,
        instanceId: terminalInstanceId,
        nativeSessionIdPresent: Boolean(capturedProviderSessionId),
        paneId,
        promptEventId: submittedPromptForReady?.promptEventId || "",
        readinessKey,
        source,
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
      onThreadTerminalLifecycle?.({
        activityStatus: "idle",
        agentId: terminalAgentKind,
        commandPhase: "completed",
        completionEvidence: options.completionEvidence || source,
        completionInferred: options.completionInferred === true,
        completionSource: options.completionSource || source,
        inputReady: true,
        inputReadyAt,
        inputReadyConfidence: options.inputReadyConfidence || options.completionEvidence || source,
        instanceId: terminalInstanceId,
        ...getTerminalNativeRailStateFields("idle"),
        paneId,
        pendingPromptId: submittedPromptForReady?.promptEventId || "",
        promptEpoch: submittedPromptForReady?.promptEpoch || 0,
        prompt_epoch: submittedPromptForReady?.promptEpoch || 0,
        promptEventId: submittedPromptForReady?.promptEventId || "",
        promptEventSubmittedAt: submittedPromptForReady?.submittedAt || "",
        promptReadyAt: inputReadyAt,
        submittedAt: submittedPromptForReady?.submittedAt || "",
        terminalPrompt: submittedPromptForReady?.promptText || "",
        source,
        status: "active",
        terminalIndex,
        terminalWorkState: "complete",
        threadId: terminalThreadIdRef.current || "",
        type: "terminal-input-ready",
        workspaceId: workspace?.id || "",
      });
      return true;
    };
    const scheduleCodingAgentInputReady = (
      reason,
      delayMs = TERMINAL_CODING_AGENT_INPUT_READY_DELAY_MS,
    ) => {
      if (isDisposed || isGenericTerminal || terminalUsesActivityHooks || codingAgentInputReadyEmitted) {
        return;
      }

      const timer = window.setTimeout(() => {
        startupWatchTimers.delete(timer);
        emitCodingAgentInputReady(`timer:${reason}`);
      }, Math.max(0, Number(delayMs) || 0));
      startupWatchTimers.add(timer);
    };

    const isTerminalStabilityRuntimeActive = () => isTerminalStabilityRuntimeEnabled();
    if (terminalDiagnosticsEnabled) {
      syncTerminalDiagnosticLogging();
    }
    if (windowsTerminalDiagnosticsEnabled) {
      syncWindowsTerminalDiagnosticLogging();
    }
    startTerminalDiagnosticHeartbeat();
    warmTerminalPromptSubmittedListener();
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
      const terminalPathLinkProvider = terminal.registerLinkProvider?.({
        provideLinks(bufferLineNumber, callback) {
          try {
            const maxWrappedRows = 5;
            const lines = [];
            for (let offset = 0; offset < maxWrappedRows; offset += 1) {
              const line = terminal.buffer.active.getLine(bufferLineNumber - 1 + offset);
              if (!line) {
                break;
              }
              lines.push(line.translateToString(true));
            }

            const joinedText = lines.join("");
            const links = getTerminalPathLinks(joinedText)
              .map((link) => {
                const startRowOffset = Math.floor(link.startIndex / Math.max(1, terminal.cols));
                const endRowOffset = Math.floor(Math.max(0, link.endIndex - 1) / Math.max(1, terminal.cols));
                if (startRowOffset !== 0 || endRowOffset >= lines.length) {
                  return null;
                }

                return {
                  range: {
                    start: {
                      x: (link.startIndex % Math.max(1, terminal.cols)) + 1,
                      y: bufferLineNumber,
                    },
                    end: {
                      x: ((Math.max(0, link.endIndex - 1)) % Math.max(1, terminal.cols)) + 1,
                      y: bufferLineNumber + endRowOffset,
                    },
                  },
                  text: link.path,
                  activate: () => openTerminalPathLink(link.path, link.kind),
                };
              })
              .filter(Boolean);
            callback(links);
          } catch {
            callback([]);
          }
        },
      });
      if (terminalPathLinkProvider) {
        disposables.push(terminalPathLinkProvider);
      }
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
        scrollStabilityMode: "off",
        scrollOnEraseInDisplay: terminal.options.scrollOnEraseInDisplay === true,
        scrollback: TERMINAL_DEFAULT_SCROLLBACK_ROWS,
        terminalStabilityFeatures,
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
      let lastWaitingLogAt = waitStartedAt;
      const firstMeasurement = getTerminalOpenContainerMeasurement();
      logTerminalDiagnosticEvent("frontend.terminal_mount_deferred", {
        ...firstMeasurement,
        paneId,
        reason,
        terminalIndex,
      });
      setPaneStage("starting", "Preparing Terminal", "Waiting for terminal layout.");

      while (!isDisposed) {
        const waitMs = performance.now() - waitStartedAt;
        const pollMs = waitMs < TERMINAL_START_LAYOUT_WAIT_MS
          ? TERMINAL_START_METRIC_POLL_MS
          : TERMINAL_START_LAYOUT_HIDDEN_POLL_MS;
        await waitForStartupMetricPoll(pollMs);

        if (isDisposed) {
          return false;
        }

        attempts += 1;
        const attemptedAt = performance.now();
        if (
          openTerminalRenderer(reason, {
            attempts,
            waitMs: attemptedAt - waitStartedAt,
          })
        ) {
          return true;
        }

        if (attemptedAt - lastWaitingLogAt >= TERMINAL_START_LAYOUT_STILL_WAITING_LOG_MS) {
          lastWaitingLogAt = attemptedAt;
          logTerminalDiagnosticEvent("frontend.terminal_mount_waiting_for_visibility", {
            ...getTerminalOpenContainerMeasurement(),
            attempts,
            paneId,
            reason,
            terminalIndex,
            waitMs: attemptedAt - waitStartedAt,
          });
          setPaneStage("starting", "Preparing Terminal", "Waiting for visible workspace.");
        }
      }

      return false;
    };

    let getSlashCommandDiagnosticContext = () => null;
    const logWindowsTerminalCompactDiagnostic = (phase, fields = {}) => {
      if (!windowsTerminalDiagnosticsEnabled) {
        return;
      }

      const slashCommand = getSlashCommandDiagnosticContext();
      logWindowsTerminalDiagnosticEvent(phase, {
        ...fields,
        agentKind: terminalAgentKind,
        paneId,
        rendererMode,
        ...(slashCommand ? { slashCommand } : {}),
        state: getWindowsTerminalCompactState(terminal, container, terminalScrollableElement),
        terminalIndex,
      });
    };
    let markCodexResizeGateActive = () => {};
    let scheduleCodexResizeGateFlush = () => {};
    let scheduleCodexResizePaintProbe = () => {};
    let logCodexResizePaintProbe = () => {};
    let isCodexResizePaintProbeActive = () => false;
    let handleSlashCommandDiagnosticInput = () => {};
    let isSlashCommandDiagnosticProbeActive = () => false;
    let scheduleSlashCommandDiagnosticProbe = () => {};
    let logSlashCommandDiagnosticProbe = () => {};
    let markCodexSlashMenuCloseCleanup = () => {};
    let markCodexSlashMenuOutputActivity = () => {};
    let applyCodexResizeScrollbackCleanup = () => false;
    let scheduleCodexResizeLiveTailCleanup = () => false;
    let handleCodexResizeCursorHomeSettled = () => {};
    let scheduleTerminalStabilityResizeProbe = () => {};
    let scheduleTransientHeaderArtifactCleanup = () => false;
    let markTransientHeaderArtifactOutputActivity = () => {};
    let markTransientHeaderArtifactRedrawActivity = () => {};
    let markClaudeResizeBlankFrameGuardActive = () => {};
    let shouldDropClaudeResizeBlankFrame = () => false;
    let shouldDropClaudeResizeDuplicateRepaint = () => false;
    let scheduleClaudeDuplicateRepaintVisualCleanup = () => false;
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
      if (!windowsTerminalDiagnosticsEnabled && !terminalStabilityFeatures.transientHeaderArtifactCleanup) {
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
        markTransientHeaderArtifactRedrawActivity(control, {
          params: allParams.length > 0 ? allParams : [actionParam],
        });

        logWindowsTerminalControl(control, {
          action: "allow",
          bufferType: activeBufferType,
          params: allParams.length > 0 ? allParams : [actionParam],
          scrollOnEraseInDisplay: terminal.options.scrollOnEraseInDisplay === true,
          scrollStabilityMode: "off",
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
            if (
              control === "alternate_buffer"
              || control === "sync_output"
              || mode === "reset"
            ) {
              markTransientHeaderArtifactRedrawActivity(control, {
                mode,
                params: interestingParams,
              });
            }

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
          const includeRenderer = isSlashCommandDiagnosticProbeActive();
          logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.cursor_home_settled", {
            action: "allow",
            afterState,
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
            params,
            ...(includeRenderer
              ? { renderer: getTerminalRendererPaintDiagnostics(terminal, container, terminalScrollableElement) }
              : {}),
            sequenceId,
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
            markTransientHeaderArtifactRedrawActivity("cursor_home", {
              final,
              params: allParams,
              variant: homeDiagnostic.variant,
            });
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

    let paintBoundsSyncTimer = 0;
    let paintBoundsSyncDueAtMs = 0;
    scheduleTerminalPaintBoundsSync = (reason = "scheduled", delaysMs = [0, 34, 120]) => {
      if (isDisposed) {
        return;
      }

      // One trailing sync per burst. Resize storms used to fan out timer
      // batches ([34, 120, 260]) from multiple callbacks per resize, each
      // forcing layout reads; the furthest requested settle point wins.
      const delayMs = Math.max(0, ...delaysMs.map((value) => Number(value || 0)));
      const dueAtMs = performance.now() + delayMs;
      if (paintBoundsSyncTimer && paintBoundsSyncDueAtMs >= dueAtMs) {
        return;
      }
      if (paintBoundsSyncTimer) {
        window.clearTimeout(paintBoundsSyncTimer);
        startupMetricTimers.delete(paintBoundsSyncTimer);
      }
      const timer = window.setTimeout(() => {
        startupMetricTimers.delete(timer);
        if (paintBoundsSyncTimer === timer) {
          paintBoundsSyncTimer = 0;
          paintBoundsSyncDueAtMs = 0;
        }
        syncTerminalPaintBounds(reason);
      }, delayMs);
      paintBoundsSyncTimer = timer;
      paintBoundsSyncDueAtMs = dueAtMs;
      startupMetricTimers.add(timer);
    };

    let windowsTerminalLastResizeLogAt = 0;
    disposables.push(terminal.onResize((event) => {
      markTransientHeaderArtifactRedrawActivity("xterm_resize", {
        cols: Number(event?.cols || 0),
        rows: Number(event?.rows || 0),
      });
      markClaudeResizeBlankFrameGuardActive("xterm_resize", event);
      markCodexResizeGateActive("xterm_resize", event);
      scheduleTerminalStabilityResizeProbe("xterm_resize", "xterm_resize", {
        cols: Number(event?.cols || 0),
        rows: Number(event?.rows || 0),
      });
      scheduleTransientHeaderArtifactCleanup("xterm_resize", {
        cols: Number(event?.cols || 0),
        rows: Number(event?.rows || 0),
        source: "xterm_resize",
      });
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

    const pendingTerminalAudioInputChunks = [];
    let applyTerminalAudioInputChunk = (insertedText) => {
      if (insertedText) {
        pendingTerminalAudioInputChunks.push(insertedText);
      }
    };

    listen(TERMINAL_AUDIO_INPUT_REFOCUS_EVENT, (event) => {
      if (
        isDisposed
        || event.payload?.paneId !== paneId
        || event.payload?.instanceId !== terminalInstanceId
      ) {
        return;
      }

      const insertedText = String(event.payload?.insertedText || "");
      if (terminalActiveRef.current) {
        if (terminalUiViewActiveRef.current) {
          if (insertedText) {
            setTerminalUiComposerFocusToken((token) => token + 1);
          }
        } else {
          focusTerminalKeyboardInput();
        }
      }

      if (!insertedText || isGenericTerminal) {
        return;
      }

      applyTerminalAudioInputChunk(insertedText);
    })
      .then((unlisten) => {
        if (isDisposed) {
          unlisten();
          return;
        }

        disposables.push(unlisten);
      })
      .catch(() => {});
    const handleTerminalFocusRequest = (event) => {
      const detail = event?.detail || {};
      if (
        isDisposed
        || detail.paneId !== paneId
        || (
          detail.instanceId
          && Number(detail.instanceId) !== Number(terminalInstanceId)
        )
      ) {
        return;
      }

	      activateTerminalPane(detail.reason || "terminal_focus_request", {
	        focusKeyboard: detail.focusKeyboard === true,
	      });
    };
    window.addEventListener(TERMINAL_FOCUS_REQUEST_EVENT, handleTerminalFocusRequest);
    disposables.push(() => {
      window.removeEventListener(TERMINAL_FOCUS_REQUEST_EVENT, handleTerminalFocusRequest);
    });

    const attachWebglRenderer = (reason = "scheduled") => {
      if (!useWebglRenderer || isDisposed || webglAttachAttempted || !terminalRendererOpened) {
        return;
      }
      if (!terminalActiveRef.current && reason !== "terminal_activated") {
        rendererMode = "canvas_deferred";
        if (!webglBackgroundDeferred) {
          webglBackgroundDeferred = true;
          logTerminalDiagnosticEvent("frontend.webgl.background_deferred", {
            paneId,
            reason,
            terminalIndex,
          });
        }
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

      const backgroundDelayMs = terminalActiveRef.current ? 0 : TERMINAL_WEBGL_BACKGROUND_DELAY_MS;
      const staggerDelayMs = reason === "terminal_activated" ? 0 : terminalIndex * TERMINAL_WEBGL_STAGGER_MS;
      const delayMs = Math.min(
        TERMINAL_WEBGL_MAX_DELAY_MS,
        Math.max(0, baseDelayMs + backgroundDelayMs + staggerDelayMs),
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

    const attachDeferredWebgl = (reason = "terminal_activated") => {
      scheduleWebglAttach(reason, 0);
    };
    attachDeferredWebglRef.current = attachDeferredWebgl;
    disposables.push(() => {
      if (attachDeferredWebglRef.current === attachDeferredWebgl) {
        attachDeferredWebglRef.current = null;
      }
    });

    scheduleWebglAttach("xterm_open", TERMINAL_WEBGL_IDLE_DELAY_MS);

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

    const scheduleVisibleOutputRefresh = (reason, extraFields = {}, delayMs = 34) => {
      if (isDisposed || visibleOutputRefreshTimer) {
        return;
      }

      visibleOutputRefreshTimer = window.setTimeout(() => {
        visibleOutputRefreshTimer = 0;
        refreshTerminalRenderer(reason, extraFields);
      }, delayMs);
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
      let lastWaitingLogAt = waitStartedAt;
      let measurement = measureTerminalSizeForOpen(`${reason}_metric_wait`);

      if (!measurement.ok) {
        logTerminalDiagnosticEvent("frontend.terminal_metric_deferred", {
          ...measurement,
          paneId,
          reason,
          terminalIndex,
        });
      }

      while (!isDisposed && !measurement.ok) {
        const waitMs = performance.now() - waitStartedAt;
        const pollMs = waitMs < TERMINAL_START_METRIC_WAIT_MS
          ? TERMINAL_START_METRIC_POLL_MS
          : TERMINAL_START_LAYOUT_HIDDEN_POLL_MS;
        await waitForStartupMetricPoll(pollMs);

        if (isDisposed) {
          return null;
        }

        attempts += 1;
        measurement = measureTerminalSizeForOpen(`${reason}_metric_wait`);

        const attemptedAt = performance.now();
        if (!measurement.ok && attemptedAt - lastWaitingLogAt >= TERMINAL_START_METRIC_STILL_WAITING_LOG_MS) {
          lastWaitingLogAt = attemptedAt;
          logTerminalDiagnosticEvent("frontend.terminal_metric_waiting_for_dimensions", {
            ...measurement,
            attempts,
            paneId,
            reason,
            terminalIndex,
            waitMs: attemptedAt - waitStartedAt,
          });
          setPaneStage("starting", "Measuring Terminal", "Waiting for renderer dimensions.");
        }
      }

      return measurement.ok ? measurement : null;
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

    const getTerminalOutputFlushByteBudget = () => {
      const active = terminalActiveRef.current;
      const baseBudget = active
        ? TERMINAL_OUTPUT_FLUSH_ACTIVE_MAX_BYTES
        : TERMINAL_OUTPUT_FLUSH_BACKGROUND_MAX_BYTES;

      return Math.max(
        TERMINAL_OUTPUT_FLUSH_MIN_BYTES,
        Math.min(Math.floor(baseBudget), Math.floor(outputAdaptiveFlushMaxBytes)),
      );
    };

    const recordTerminalOutputWriteTiming = (writeCallbackMs, batchBytes) => {
      const elapsedMs = Math.max(0, Number(writeCallbackMs || 0));
      const bytes = Math.max(0, Number(batchBytes || 0));
      const active = terminalActiveRef.current;
      const maxBudget = active
        ? TERMINAL_OUTPUT_FLUSH_ACTIVE_MAX_BYTES
        : TERMINAL_OUTPUT_FLUSH_BACKGROUND_MAX_BYTES;
      if (elapsedMs >= TERMINAL_OUTPUT_WRITE_TARGET_MS && bytes > TERMINAL_OUTPUT_WRITE_MIN_BYTES) {
        outputAdaptiveFlushMaxBytes = Math.max(
          TERMINAL_OUTPUT_WRITE_MIN_BYTES,
          Math.floor(Math.min(outputAdaptiveFlushMaxBytes, bytes) * 0.65),
        );
        return;
      }

      if (elapsedMs <= TERMINAL_OUTPUT_WRITE_TARGET_MS / 2) {
        outputAdaptiveFlushMaxBytes = Math.min(
          maxBudget,
          Math.max(TERMINAL_OUTPUT_WRITE_MIN_BYTES, Math.ceil(outputAdaptiveFlushMaxBytes * 1.2)),
        );
      }
    };

    const splitTerminalOutputWrite = (write, byteCount) => {
      const originalBytes = Math.max(1, Number(write.data?.byteLength || 0));
      const selectedData = write.data.slice(0, byteCount);
      const remainingData = write.data.slice(byteCount);
      const visibleChars = Number(write.outputDebug?.visibleChars || 0);
      const selectedVisibleChars = Math.max(
        0,
        Math.min(visibleChars, Math.round(visibleChars * (selectedData.byteLength / originalBytes))),
      );
      const remainingVisibleChars = Math.max(0, visibleChars - selectedVisibleChars);

      return {
        remaining: {
          ...write,
          data: remainingData,
          isFirstOutputChunk: false,
          isFirstVisibleOutputChunk: false,
          outputDebug: {
            ...(write.outputDebug || {}),
            visibleChars: remainingVisibleChars,
          },
          scrollToBottomBeforeWrite: false,
        },
        selected: {
          ...write,
          afterWriteRefreshReason: "",
          data: selectedData,
          outputDebug: {
            ...(write.outputDebug || {}),
            visibleChars: selectedVisibleChars,
          },
          scrollToBottomAfterWrite: false,
        },
      };
    };

    const takeTerminalOutputBatch = (maxBytes) => {
      const writes = [];
      const queuedMs = outputBatchQueuedAt ? performance.now() - outputBatchQueuedAt : 0;
      const budget = Math.max(TERMINAL_OUTPUT_FLUSH_MIN_BYTES, Number(maxBytes || 0));
      let batchBytes = 0;

      while (pendingOutputWrites.length && batchBytes < budget) {
        const nextWrite = pendingOutputWrites[0];
        const nextBytes = Number(nextWrite?.data?.byteLength || 0);
        if (nextBytes <= 0) {
          pendingOutputWrites.shift();
          continue;
        }

        const remainingBudget = budget - batchBytes;
        if (nextBytes <= remainingBudget) {
          writes.push(pendingOutputWrites.shift());
          batchBytes += nextBytes;
          continue;
        }

        if (remainingBudget <= 0) {
          break;
        }

        const { selected, remaining } = splitTerminalOutputWrite(nextWrite, remainingBudget);
        writes.push(selected);
        pendingOutputWrites[0] = remaining;
        batchBytes += selected.data.byteLength;
        break;
      }

      pendingOutputBytes = Math.max(0, pendingOutputBytes - batchBytes);
      if (!pendingOutputWrites.length) {
        pendingOutputBytes = 0;
        outputBatchQueuedAt = 0;
      }

      return {
        batchBytes,
        budget,
        queuedMs,
        remainingBytes: pendingOutputBytes,
        writes,
      };
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
      const {
        batchBytes,
        budget: flushByteBudget,
        queuedMs,
        remainingBytes,
        writes,
      } = takeTerminalOutputBatch(getTerminalOutputFlushByteBudget());
      if (!writes.length || batchBytes <= 0) {
        scheduleTerminalOutputBatchFlush();
        return;
      }
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
      if (shouldDropClaudeResizeBlankFrame(batchData, {
        outputDebug,
        reason,
        writes: writes.length,
      })) {
        if (pendingOutputWrites.length) {
          scheduleTerminalOutputBatchFlush();
        }
        return;
      }
      if (shouldDropClaudeResizeDuplicateRepaint(batchData, {
        outputDebug,
        reason,
        writes: writes.length,
      })) {
        if (pendingOutputWrites.length) {
          scheduleTerminalOutputBatchFlush();
        }
        return;
      }
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
        markTransientHeaderArtifactOutputActivity(batchBytes, {
          reason,
          writes: writes.length,
        });
        scheduleClaudeDuplicateRepaintVisualCleanup("after_output_write", {
          batchBytes,
          reason,
          writes: writes.length,
        });
        const writeCallbackMs = performance.now() - writeStartedAt;
        recordTerminalOutputWriteTiming(writeCallbackMs, batchBytes);
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
            remainingBytes,
            rendererMode,
            terminalIndex,
            visibleChars: outputDebug.visibleChars,
            writeBudgetBytes: flushByteBudget,
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
          const clearedTextureAtlas = false;

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

        if (batchVisibleChars > 0) {
          scheduleVisibleOutputRefresh("visible_output_written_settled", {
            bytes: batchData.byteLength,
            reason,
            transport: "binary_channel",
            visibleChars: batchVisibleChars,
          }, terminalActiveRef.current ? 48 : 120);
        }

        if (isSlashCommandDiagnosticProbeActive()) {
          scheduleSlashCommandDiagnosticProbe("terminal_output_write", "after_output_write", {
            batchBytes,
            isFirstOutputChunk,
            isFirstVisibleOutputChunk,
            reason,
            writes: writes.length,
          }, TERMINAL_SLASH_COMMAND_OUTPUT_PROBE_DELAYS_MS);
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
    const flushCurrentOutputNow = () => {
      if (pendingOutputWrites.length) {
        terminalGlobalRenderScheduler.request(renderSchedulerId);
      }
    };
    terminalOutputFlushNowRef.current = flushCurrentOutputNow;

    terminalGlobalRenderScheduler.register({
      flush: (reason) => flushTerminalOutputBatch(reason),
      getPendingBytes: () => pendingOutputBytes,
      getQueuedAt: () => outputBatchQueuedAt,
      hasPriorityPending: () => terminalActiveRef.current && pendingOutputWrites.some((write) => (
        write?.isFirstOutputChunk === true
        || write?.isFirstVisibleOutputChunk === true
      )),
      hasPending: () => !isDisposed && !outputWriteInFlight && pendingOutputWrites.length > 0,
      id: renderSchedulerId,
      isActive: () => terminalActiveRef.current,
    });
    disposables.push(() => {
      if (terminalOutputFlushNowRef.current === flushCurrentOutputNow) {
        terminalOutputFlushNowRef.current = null;
      }
      terminalGlobalRenderScheduler.unregister(renderSchedulerId);
    });

    const enqueueTerminalOutputWrite = (data, options = {}) => {
      if (isDisposed || !data?.byteLength) {
        return;
      }

      const isFirstOutputChunk = options.isFirstOutputChunk === true;
      const isFirstVisibleOutputChunk = options.isFirstVisibleOutputChunk === true;
      const outputDebug = options.outputDebug || {
        visibleChars: getTerminalOutputVisibleCharCount(data),
      };

      const queuedData = data instanceof Uint8Array
        ? data
        : typeof data.slice === "function"
          ? data.slice()
          : new Uint8Array(data);
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

    const codexResizeGate = createCodexResizeGateState();
    const isCodexResizeGateEnabled = () => false;
    const claudeResizeBlankFrameGuard = {
      droppedDuplicateRepaints: 0,
      droppedFrames: 0,
      duplicateRepaintDecisions: 0,
      epoch: 0,
      lastDuplicateRepaintSignature: "",
      lastDroppedSignature: "",
      lastObservedSize: null,
      pendingDuplicateRepaintVisualCleanup: null,
      until: 0,
    };
    const isClaudeResizeBlankFrameGuardEnabled = () => (
      isTerminalStabilityRuntimeActive()
      && terminalStabilityFeatures.claudeResizeBlankFrameGuard === true
      && terminalStabilityFeatures.normalizerPipeline
      && !isGenericTerminal
      && !isDisposed
    );
    const isClaudeResizeDuplicateRepaintGuardEnabled = () => (
      isTerminalStabilityRuntimeActive()
      && terminalStabilityFeatures.claudeResizeDuplicateRepaintGuard === true
      && terminalStabilityFeatures.normalizerPipeline
      && !isGenericTerminal
      && !isDisposed
    );
    const isClaudeResizeRepaintGuardEnabled = () => (
      isClaudeResizeBlankFrameGuardEnabled()
      || isClaudeResizeDuplicateRepaintGuardEnabled()
    );
    const getCurrentTerminalResizeGateSize = () => normalizeCodexResizeGateSize({
      cols: terminal.cols,
      rows: terminal.rows,
    });
    markClaudeResizeBlankFrameGuardActive = (reason = "resize", size = null, options = {}) => {
      if (!isClaudeResizeRepaintGuardEnabled()) {
        return;
      }

      const targetSize = normalizeCodexResizeGateSize(size) || getCurrentTerminalResizeGateSize();
      const now = performance.now();
      const previousSize = claudeResizeBlankFrameGuard.lastObservedSize;
      const sizeChanged = Boolean(previousSize)
        && !codexResizeGateSizesEqual(previousSize, targetSize);

      claudeResizeBlankFrameGuard.until = Math.max(
        Number(claudeResizeBlankFrameGuard.until || 0),
        now + TERMINAL_CLAUDE_RESIZE_BLANK_FRAME_GUARD_MS,
      );
      claudeResizeBlankFrameGuard.lastObservedSize = targetSize || previousSize;
      if (sizeChanged || options.force === true) {
        claudeResizeBlankFrameGuard.epoch += 1;
      }

      if (windowsTerminalDiagnosticsEnabled && (sizeChanged || options.force === true)) {
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.claude_resize_blank_frame_guard", {
          action: "activate",
          epoch: claudeResizeBlankFrameGuard.epoch,
          reason,
          targetCols: targetSize?.cols || 0,
          targetRows: targetSize?.rows || 0,
          until: Number(claudeResizeBlankFrameGuard.until || 0),
        });
      }
    };
    scheduleClaudeDuplicateRepaintVisualCleanup = (reason = "after_output_write", extraFields = {}) => {
      const pending = claudeResizeBlankFrameGuard.pendingDuplicateRepaintVisualCleanup;
      if (!pending) {
        return false;
      }

      claudeResizeBlankFrameGuard.pendingDuplicateRepaintVisualCleanup = null;
      if (
        !isTransientHeaderArtifactCleanupEnabled()
        || performance.now() > Number(pending.until || 0)
      ) {
        return false;
      }

      return scheduleTransientHeaderArtifactCleanup("claude_duplicate_repaint_visual_fallback", {
        ...pending.fields,
        fallbackReason: reason,
        source: "duplicate_repaint_guard_visual_fallback",
        ...extraFields,
      }, [0]);
    };
    shouldDropClaudeResizeBlankFrame = (data, options = {}) => {
      if (
        !isClaudeResizeBlankFrameGuardEnabled()
        || !data?.byteLength
        || performance.now() > Number(claudeResizeBlankFrameGuard.until || 0)
      ) {
        return false;
      }

      const outputDebug = options.outputDebug?.printableChars == null
        ? getTerminalOutputDebugFields(data)
        : options.outputDebug;
      const controlProfile = getTerminalOutputControlProfile(data);
      const visibleChars = Number(outputDebug.visibleChars || 0);
      const printableChars = Number(outputDebug.printableChars || 0);
      const terminalRows = Math.max(1, Math.floor(Number(terminal.rows || 1)));
      const looksLikeBlankRepaint = controlProfile.hasCursorHome
        && visibleChars <= 0
        && (
          printableChars >= Math.max(8, Math.min(terminalRows, 24))
          || controlProfile.hasEraseDisplay
          || controlProfile.eraseLineCount >= Math.max(1, Math.min(terminalRows, 4))
        );

      if (!looksLikeBlankRepaint) {
        return false;
      }

      const buffer = terminal?.buffer?.active;
      const baseY = Math.max(0, Number(buffer?.baseY || 0));
      const viewportY = Math.max(0, Number(buffer?.viewportY || 0));
      const liveRows = getTerminalBufferRowsDiagnostic(terminal, baseY, terminalRows);
      const viewportRows = viewportY === baseY
        ? liveRows
        : getTerminalBufferRowsDiagnostic(terminal, viewportY, terminalRows);
      const existingNonEmptyRows = Math.max(
        Number(liveRows.nonEmptyRows || 0),
        Number(viewportRows.nonEmptyRows || 0),
      );

      if (existingNonEmptyRows <= 0) {
        return false;
      }

      const signature = [
        claudeResizeBlankFrameGuard.epoch,
        data.byteLength,
        controlProfile.cursorHomeCount,
        controlProfile.eraseDisplayCount,
        controlProfile.eraseLineCount,
        printableChars,
        visibleChars,
      ].join(":");
      claudeResizeBlankFrameGuard.droppedFrames += 1;
      claudeResizeBlankFrameGuard.lastDroppedSignature = signature;

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.claude_resize_blank_frame_guard", {
        action: "drop_blank_repaint",
        baseY,
        bytes: Number(data.byteLength || 0),
        cursorHomeCount: controlProfile.cursorHomeCount,
        droppedFrames: claudeResizeBlankFrameGuard.droppedFrames,
        epoch: claudeResizeBlankFrameGuard.epoch,
        eraseDisplayCount: controlProfile.eraseDisplayCount,
        eraseLineCount: controlProfile.eraseLineCount,
        existingNonEmptyRows,
        liveBlankPrefixRows: Number(liveRows.blankPrefixRows || 0),
        liveBlankSuffixRows: Number(liveRows.blankSuffixRows || 0),
        printableChars,
        reason: options.reason || "",
        signature,
        visibleChars,
        viewportBlankPrefixRows: Number(viewportRows.blankPrefixRows || 0),
        viewportBlankSuffixRows: Number(viewportRows.blankSuffixRows || 0),
        viewportY,
        writes: Number(options.writes || 0),
      });

      return true;
    };
    shouldDropClaudeResizeDuplicateRepaint = (data, options = {}) => {
      if (
        !isClaudeResizeDuplicateRepaintGuardEnabled()
        || !data?.byteLength
        || performance.now() > Number(claudeResizeBlankFrameGuard.until || 0)
      ) {
        return false;
      }

      const outputDebug = options.outputDebug?.printableChars == null
        ? getTerminalOutputDebugFields(data)
        : options.outputDebug;
      const visibleChars = Number(outputDebug.visibleChars || 0);
      if (visibleChars <= 0) {
        return false;
      }

      const controlProfile = getTerminalOutputControlProfile(data);
      if (!controlProfile.hasCursorHome) {
        return false;
      }

      claudeResizeBlankFrameGuard.duplicateRepaintDecisions += 1;
      const decision = getClaudeResizeDuplicateRepaintDecision(terminal, data, {
        controlProfile,
      });

      if (!decision.shouldDrop) {
        if (decision.shouldMaskFallback) {
          claudeResizeBlankFrameGuard.pendingDuplicateRepaintVisualCleanup = {
            fields: {
              blockingUniqueChars: Number(decision.blockingUniqueChars || 0),
              blockingUniqueRows: Number(decision.blockingUniqueRows || 0),
              bytes: Number(data.byteLength || 0),
              comparableRows: Number(decision.comparableRows || 0),
              matchedCharRatio: Number(decision.matchedCharRatio || 0),
              matchedChars: Number(decision.matchedChars || 0),
              matchedRatio: Number(decision.matchedRatio || 0),
              matchedRows: Number(decision.matchedRows || 0),
              reason: options.reason || "",
              repaintKindCounts: decision.repaintKindCounts || {},
              skipReason: decision.reason,
              uniqueSubstantialRows: Number(decision.uniqueSubstantialRows || 0),
            },
            until: performance.now() + 600,
          };
        }
        if (
          windowsTerminalDiagnosticsEnabled
          && claudeResizeBlankFrameGuard.duplicateRepaintDecisions <= 6
        ) {
          logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.claude_resize_duplicate_repaint_guard", {
            action: "allow",
            blockingUniqueChars: Number(decision.blockingUniqueChars || 0),
            blockingUniqueRows: Number(decision.blockingUniqueRows || 0),
            bytes: Number(data.byteLength || 0),
            comparableRows: Number(decision.comparableRows || 0),
            cursorHomeCount: controlProfile.cursorHomeCount,
            epoch: claudeResizeBlankFrameGuard.epoch,
            existingRows: Number(decision.existingRows || 0),
            matchedCharRatio: Number(decision.matchedCharRatio || 0),
            matchedChars: Number(decision.matchedChars || 0),
            matchedRatio: Number(decision.matchedRatio || 0),
            matchedRows: Number(decision.matchedRows || 0),
            minMatchedChars: TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_CHARS,
            minMatchedRows: TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_ROWS,
            minRatio: TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_RATIO,
            outputRows: Number(decision.outputRows || 0),
            printableChars: Number(outputDebug.printableChars || 0),
            reason: options.reason || "",
            repaintKindCounts: decision.repaintKindCounts || {},
            sampleRows: decision.sampleRows || [],
            shouldMaskFallback: Boolean(decision.shouldMaskFallback),
            skipReason: decision.reason,
            uniqueSampleRows: decision.uniqueSampleRows || [],
            uniqueSubstantialRows: Number(decision.uniqueSubstantialRows || 0),
            visibleChars,
            writes: Number(options.writes || 0),
          });
        }
        return false;
      }

      const signature = [
        claudeResizeBlankFrameGuard.epoch,
        data.byteLength,
        controlProfile.cursorHomeCount,
        decision.matchedRows,
        decision.matchedChars,
        decision.comparableRows,
        visibleChars,
      ].join(":");
      claudeResizeBlankFrameGuard.droppedDuplicateRepaints += 1;
      claudeResizeBlankFrameGuard.lastDuplicateRepaintSignature = signature;

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.claude_resize_duplicate_repaint_guard", {
        action: "drop_duplicate_repaint",
        blockingUniqueChars: Number(decision.blockingUniqueChars || 0),
        blockingUniqueRows: Number(decision.blockingUniqueRows || 0),
        bytes: Number(data.byteLength || 0),
        comparableChars: Number(decision.comparableChars || 0),
        comparableRows: Number(decision.comparableRows || 0),
        cursorHomeCount: controlProfile.cursorHomeCount,
        droppedDuplicateRepaints: claudeResizeBlankFrameGuard.droppedDuplicateRepaints,
        epoch: claudeResizeBlankFrameGuard.epoch,
        existingRows: Number(decision.existingRows || 0),
        hasClaudeHeader: Boolean(decision.hasClaudeHeader),
        matchedCharRatio: Number(decision.matchedCharRatio || 0),
        matchedChars: Number(decision.matchedChars || 0),
        matchedRatio: Number(decision.matchedRatio || 0),
        matchedRows: Number(decision.matchedRows || 0),
        minMatchedChars: TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_CHARS,
        minMatchedRows: TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_MATCHED_ROWS,
        minRatio: TERMINAL_CLAUDE_RESIZE_DUPLICATE_REPAINT_MIN_RATIO,
        outputRows: Number(decision.outputRows || 0),
        printableChars: Number(outputDebug.printableChars || 0),
        reason: options.reason || "",
        repaintKindCounts: decision.repaintKindCounts || {},
        sampleRows: decision.sampleRows || [],
        scanStart: Number(decision.scanStart || 0),
        shouldDropByShape: Boolean(decision.shouldDropByShape),
        signature,
        skipReason: decision.reason,
        uniqueSampleRows: decision.uniqueSampleRows || [],
        uniqueSubstantialRows: Number(decision.uniqueSubstantialRows || 0),
        visibleChars,
        writes: Number(options.writes || 0),
      });

      scheduleTransientHeaderArtifactCleanup("claude_duplicate_repaint_dropped", {
        bytes: Number(data.byteLength || 0),
        matchedRows: Number(decision.matchedRows || 0),
        source: "duplicate_repaint_guard",
      }, [120, 360]);

      return true;
    };
    const slashCommandDiagnosticState = createSlashCommandDiagnosticState();
    const codexSlashMenuCloseCleanupState = createCodexSlashMenuCloseCleanupState();
    const isSlashCommandDiagnosticEnabled = () => (
      windowsTerminalDiagnosticsEnabled
      && isTerminalStabilityRuntimeActive()
      && terminalStabilityFeatures.slashCommandDiagnostics
      && isTerminalSlashCommandDiagnosticAgentKind(terminalAgentKind)
      && !isGenericTerminal
      && !isDisposed
    );
    const getSlashCommandDiagnosticSnapshot = () => {
      const now = performance.now();
      const lineSnapshot = getTerminalSlashCommandLineSnapshot(slashCommandDiagnosticState.line);
      const keydownSnapshot = getTerminalSlashCommandLineSnapshot(slashCommandDiagnosticState.keydownLine);
      const activeSnapshot = (
        lineSnapshot.startsWithSlash
        && lineSnapshot.commandPreview.length >= keydownSnapshot.commandPreview.length
      )
        ? lineSnapshot
        : keydownSnapshot.startsWithSlash
          ? keydownSnapshot
          : lineSnapshot;
      const hasActiveProbe = now <= Number(slashCommandDiagnosticState.probeUntil || 0);
      if (!slashCommandDiagnosticState.active && !slashCommandDiagnosticState.keydownActive && !hasActiveProbe) {
        return null;
      }

      return {
        active: slashCommandDiagnosticState.active || slashCommandDiagnosticState.keydownActive,
        commandName: activeSnapshot.commandName || slashCommandDiagnosticState.lastSubmittedCommandName,
        commandPreview: activeSnapshot.commandPreview || slashCommandDiagnosticState.lastSubmittedCommandPreview,
        inputCommandName: lineSnapshot.commandName,
        inputCommandPreview: lineSnapshot.commandPreview,
        keydownCommandName: keydownSnapshot.commandName,
        keydownCommandPreview: keydownSnapshot.commandPreview,
        lastSubmittedCommandName: slashCommandDiagnosticState.lastSubmittedCommandName,
        lastSubmittedCommandPreview: slashCommandDiagnosticState.lastSubmittedCommandPreview,
        lineLength: activeSnapshot.lineLength,
        probeActive: hasActiveProbe,
        probeRemainingMs: Math.max(0, Math.round(Number(slashCommandDiagnosticState.probeUntil || 0) - now)),
        sequence: slashCommandDiagnosticState.sequence,
        source: lineSnapshot.startsWithSlash
          ? "pty_input"
          : keydownSnapshot.startsWithSlash
            ? "keydown"
            : "",
        startsWithSlash: activeSnapshot.startsWithSlash,
      };
    };
    getSlashCommandDiagnosticContext = () => (
      isSlashCommandDiagnosticEnabled() ? getSlashCommandDiagnosticSnapshot() : null
    );
    isSlashCommandDiagnosticProbeActive = () => (
      isSlashCommandDiagnosticEnabled()
      && performance.now() <= Number(slashCommandDiagnosticState.probeUntil || 0)
    );
    logSlashCommandDiagnosticProbe = (reason, action, extraFields = {}) => {
      if (!isSlashCommandDiagnosticEnabled()) {
        return;
      }

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.slash_command", {
        action,
        command: getSlashCommandDiagnosticSnapshot(),
        reason,
        renderer: getTerminalRendererPaintDiagnostics(terminal, container, terminalScrollableElement),
        ...extraFields,
      });
    };
    scheduleSlashCommandDiagnosticProbe = (
      reason,
      action,
      extraFields = {},
      delaysMs = TERMINAL_SLASH_COMMAND_PROBE_DELAYS_MS,
    ) => {
      if (!isSlashCommandDiagnosticEnabled()) {
        return;
      }

      const now = performance.now();
      if (
        action === "after_output_write"
        && now - Number(slashCommandDiagnosticState.lastOutputProbeAt || 0)
          < TERMINAL_SLASH_COMMAND_OUTPUT_PROBE_THROTTLE_MS
      ) {
        return;
      }

      if (action === "after_output_write") {
        slashCommandDiagnosticState.lastOutputProbeAt = now;
      }

      slashCommandDiagnosticState.probeUntil = Math.max(
        Number(slashCommandDiagnosticState.probeUntil || 0),
        now + TERMINAL_SLASH_COMMAND_PROBE_WINDOW_MS,
      );
      slashCommandDiagnosticState.probeSequence += 1;
      const probeId = slashCommandDiagnosticState.probeSequence;

      delaysMs.forEach((delayMs) => {
        const normalizedDelayMs = Math.max(0, Number(delayMs || 0));
        const timer = window.setTimeout(() => {
          startupMetricTimers.delete(timer);
          logSlashCommandDiagnosticProbe(reason, action, {
            delayMs: normalizedDelayMs,
            probeId,
            ...extraFields,
          });
        }, normalizedDelayMs);
        startupMetricTimers.add(timer);
      });
    };
    let terminalStabilityResizeProbeSequence = 0;
    const isTerminalStabilityResizeProbeEnabled = () => (
      windowsTerminalDiagnosticsEnabled
      && isTerminalStabilityRuntimeActive()
      && useNormalizerAgentScrollStability
      && terminalStabilityFeatures.resizeDiagnostics
      && !isGenericTerminal
      && !isDisposed
    );
    const logTerminalStabilityResizeProbe = (reason, action, extraFields = {}) => {
      if (!isTerminalStabilityResizeProbeEnabled()) {
        return;
      }

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.stability_resize_probe", {
        action,
        agentKind: terminalAgentKind,
        features: terminalStabilityFeatures,
        reason,
        renderer: getTerminalRendererPaintDiagnostics(terminal, container, terminalScrollableElement),
        state: getWindowsTerminalCompactState(terminal, container, terminalScrollableElement),
        ...extraFields,
      });
    };
    scheduleTerminalStabilityResizeProbe = (
      reason,
      action,
      extraFields = {},
      delaysMs = TERMINAL_STABILITY_RESIZE_PROBE_DELAYS_MS,
    ) => {
      if (!isTerminalStabilityResizeProbeEnabled()) {
        return;
      }

      terminalStabilityResizeProbeSequence += 1;
      const probeId = terminalStabilityResizeProbeSequence;
      delaysMs.forEach((delayMs) => {
        const normalizedDelayMs = Math.max(0, Number(delayMs || 0));
        const timer = window.setTimeout(() => {
          startupMetricTimers.delete(timer);
          logTerminalStabilityResizeProbe(reason, action, {
            delayMs: normalizedDelayMs,
            probeId,
            ...extraFields,
          });
        }, normalizedDelayMs);
        startupMetricTimers.add(timer);
      });
    };
    let transientHeaderArtifactCleanupSequence = 0;
    let transientHeaderArtifactCleanupUntil = 0;
    let transientHeaderArtifactCleanupLastSignature = "";
    let transientHeaderArtifactCleanupTimer = 0;
    let transientHeaderArtifactCleanupDueAt = 0;
    let transientHeaderArtifactCleanupRetryCount = 0;
    let transientHeaderArtifactCleanupLastOutputAt = 0;
    let transientHeaderArtifactCleanupLastRedrawAt = 0;
    let transientHeaderArtifactCleanupLastRedrawControl = "";
    let transientHeaderArtifactCleanupPendingReason = "";
    let transientHeaderArtifactCleanupPendingFields = {};
    let transientHeaderArtifactCleanupCandidateSignature = "";
    let transientHeaderArtifactCleanupCandidateSeenAt = 0;
    let transientHeaderArtifactVisualMask = null;
    let transientHeaderArtifactVisualMaskSequence = 0;
    const isTransientHeaderArtifactCleanupEnabled = () => (
      isTerminalStabilityRuntimeActive()
      && useNormalizerAgentScrollStability
      && terminalStabilityFeatures.normalizerPipeline
      && terminalStabilityFeatures.transientHeaderArtifactCleanup
      && !isGenericTerminal
      && !isDisposed
    );
    const clearTransientHeaderArtifactVisualMask = (reason = "clear", extraFields = {}) => {
      const currentMask = transientHeaderArtifactVisualMask;
      if (!currentMask) {
        return false;
      }

      const maskedRows = Array.isArray(currentMask.rows) ? currentMask.rows : [];
      maskedRows.forEach((maskedRow) => {
        const rowElement = maskedRow?.element;
        if (!rowElement || !rowElement.isConnected) {
          return;
        }

        if (rowElement.getAttribute("data-terminal-transient-header-mask") === currentMask.maskId) {
          rowElement.style.visibility = maskedRow.previousVisibility || "";
          rowElement.style.pointerEvents = maskedRow.previousPointerEvents || "";
          rowElement.style.opacity = maskedRow.previousOpacity || "";
          rowElement.removeAttribute("data-terminal-transient-header-mask");
        }
      });

      transientHeaderArtifactVisualMask = null;

      if (windowsTerminalDiagnosticsEnabled) {
        logTransientHeaderArtifactCleanup("mask_clear", {
          maskId: currentMask.maskId,
          maskedRows: maskedRows.length,
          reason,
          signature: currentMask.signature,
          ...extraFields,
        });
      }

      return true;
    };
    const resetTransientHeaderArtifactCandidate = (options = {}) => {
      transientHeaderArtifactCleanupCandidateSignature = "";
      transientHeaderArtifactCleanupCandidateSeenAt = 0;
      if (options.clearMask !== false) {
        clearTransientHeaderArtifactVisualMask(options.reason || "candidate_reset", options);
      }
    };
    const clearTransientHeaderArtifactCleanupTimer = () => {
      if (!transientHeaderArtifactCleanupTimer) {
        return;
      }

      window.clearTimeout(transientHeaderArtifactCleanupTimer);
      startupMetricTimers.delete(transientHeaderArtifactCleanupTimer);
      transientHeaderArtifactCleanupTimer = 0;
      transientHeaderArtifactCleanupDueAt = 0;
    };
    const logTransientHeaderArtifactCleanup = (action, fields = {}) => {
      if (!windowsTerminalDiagnosticsEnabled || !terminalStabilityFeatures.resizeDiagnostics || isDisposed) {
        return;
      }

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.transient_header_artifact_cleanup", {
        action,
        cleanupUntil: Number(transientHeaderArtifactCleanupUntil || 0),
        features: terminalStabilityFeatures,
        profileId: terminalStabilityFeatures.transientHeaderArtifactProfile || "",
        ...fields,
      });
    };
    const applyTransientHeaderArtifactVisualMask = (plan, stableSignature, reason, extraFields = {}) => {
      if (!plan?.shouldCleanup || !stableSignature || !container?.isConnected) {
        clearTransientHeaderArtifactVisualMask("mask_unavailable", {
          reason,
          ...extraFields,
        });
        return false;
      }

      const rowsElement = container.querySelector(".xterm-rows");
      const buffer = terminal?.buffer?.active;
      const rowElements = Array.from(rowsElement?.children || []);

      if (!rowsElement || !buffer || !rowElements.length) {
        clearTransientHeaderArtifactVisualMask("mask_rows_unavailable", {
          reason,
          ...extraFields,
        });
        return false;
      }

      const viewportY = Math.max(0, Math.floor(Number(buffer.viewportY || 0)));
      const terminalRows = Math.max(1, Math.floor(Number(terminal?.rows || rowElements.length || 1)));
      const visibleEnd = viewportY + Math.min(terminalRows, rowElements.length);
      const maskedRows = [];
      const seenRowIndexes = new Set();

      (plan.deleteBlocks || []).forEach((block) => {
        const deleteStart = Math.max(0, Math.floor(Number(block.deleteStart ?? block.start ?? 0)));
        const fallbackDeleteEnd = deleteStart + Math.max(0, Math.floor(Number(block.rowCount || 0)));
        const deleteEnd = Math.max(
          deleteStart,
          Math.floor(Number(block.deleteEnd ?? fallbackDeleteEnd)),
        );
        const maskStart = Math.max(deleteStart, viewportY);
        const maskEnd = Math.min(deleteEnd, visibleEnd);

        for (let rowIndex = maskStart; rowIndex < maskEnd; rowIndex += 1) {
          const childIndex = rowIndex - viewportY;
          const rowElement = rowElements[childIndex];
          if (!rowElement || seenRowIndexes.has(rowIndex)) {
            continue;
          }

          seenRowIndexes.add(rowIndex);
          maskedRows.push({
            childIndex,
            element: rowElement,
            previousOpacity: rowElement.style.opacity || "",
            previousPointerEvents: rowElement.style.pointerEvents || "",
            previousVisibility: rowElement.style.visibility || "",
            rowIndex,
          });
        }
      });

      if (!maskedRows.length) {
        clearTransientHeaderArtifactVisualMask("mask_no_visible_rows", {
          reason,
          ...extraFields,
        });
        return false;
      }

      if (
        transientHeaderArtifactVisualMask?.signature === stableSignature
        && transientHeaderArtifactVisualMask.rows?.length === maskedRows.length
        && maskedRows.every((maskedRow, index) => (
          transientHeaderArtifactVisualMask.rows[index]?.element === maskedRow.element
          && maskedRow.element?.getAttribute("data-terminal-transient-header-mask")
            === transientHeaderArtifactVisualMask.maskId
        ))
      ) {
        return true;
      }

      clearTransientHeaderArtifactVisualMask("mask_replace", {
        nextSignature: stableSignature,
        reason,
      });

      maskedRows.forEach((maskedRow) => {
        const rowElement = maskedRow.element;
        maskedRow.previousOpacity = rowElement.style.opacity || "";
        maskedRow.previousPointerEvents = rowElement.style.pointerEvents || "";
        maskedRow.previousVisibility = rowElement.style.visibility || "";
      });

      transientHeaderArtifactVisualMaskSequence += 1;
      const maskId = `${terminalInstanceId || paneId || "terminal"}:${
        transientHeaderArtifactVisualMaskSequence
      }`;

      maskedRows.forEach((maskedRow) => {
        const rowElement = maskedRow.element;
        rowElement.setAttribute("data-terminal-transient-header-mask", maskId);
        rowElement.style.visibility = "hidden";
        rowElement.style.pointerEvents = "none";
        rowElement.style.opacity = "0";
      });

      transientHeaderArtifactVisualMask = {
        appliedAt: performance.now(),
        firstRowIndex: maskedRows[0]?.rowIndex ?? -1,
        lastRowIndex: maskedRows[maskedRows.length - 1]?.rowIndex ?? -1,
        maskId,
        rows: maskedRows,
        signature: stableSignature,
      };

      logTransientHeaderArtifactCleanup("mask_apply", {
        firstRowIndex: transientHeaderArtifactVisualMask.firstRowIndex,
        lastRowIndex: transientHeaderArtifactVisualMask.lastRowIndex,
        maskId,
        maskedRows: maskedRows.length,
        reason,
        signature: stableSignature,
        viewportY,
        ...extraFields,
      });

      return true;
    };
    markTransientHeaderArtifactOutputActivity = (byteLength = 0, extraFields = {}) => {
      if (!isTransientHeaderArtifactCleanupEnabled()) {
        return;
      }

      transientHeaderArtifactCleanupLastOutputAt = performance.now();
      resetTransientHeaderArtifactCandidate();
      if (performance.now() <= Number(transientHeaderArtifactCleanupUntil || 0)) {
        scheduleTransientHeaderArtifactCleanup("output_activity", {
          bytes: Number(byteLength || 0),
          source: "terminal_output_write",
          ...extraFields,
        }, [TERMINAL_TRANSIENT_HEADER_ARTIFACT_OUTPUT_QUIET_MS + 16]);
      }
    };
    markTransientHeaderArtifactRedrawActivity = (control, extraFields = {}) => {
      if (!isTransientHeaderArtifactCleanupEnabled()) {
        return;
      }

      transientHeaderArtifactCleanupLastRedrawAt = performance.now();
      transientHeaderArtifactCleanupLastRedrawControl = String(control || "");
      resetTransientHeaderArtifactCandidate();
      if (performance.now() <= Number(transientHeaderArtifactCleanupUntil || 0)) {
        scheduleTransientHeaderArtifactCleanup("redraw_activity", {
          control: transientHeaderArtifactCleanupLastRedrawControl,
          source: "terminal_control",
          ...extraFields,
        }, [0]);
      }
    };
    const getTransientHeaderArtifactQuietState = () => {
      const now = performance.now();
      const pendingWrites = pendingOutputWrites.length;
      if (outputWriteInFlight || pendingWrites > 0) {
        return {
          pendingOutputBytes,
          pendingOutputWrites: pendingWrites,
          quiet: false,
          reason: "pending_output",
          waitMs: TERMINAL_TRANSIENT_HEADER_ARTIFACT_RETRY_MS,
        };
      }

      const outputAgeMs = transientHeaderArtifactCleanupLastOutputAt
        ? now - Number(transientHeaderArtifactCleanupLastOutputAt || 0)
        : Number.POSITIVE_INFINITY;
      const redrawAgeMs = transientHeaderArtifactCleanupLastRedrawAt
        ? now - Number(transientHeaderArtifactCleanupLastRedrawAt || 0)
        : Number.POSITIVE_INFINITY;
      const outputWaitMs = outputAgeMs < TERMINAL_TRANSIENT_HEADER_ARTIFACT_OUTPUT_QUIET_MS
        ? TERMINAL_TRANSIENT_HEADER_ARTIFACT_OUTPUT_QUIET_MS - outputAgeMs
        : 0;
      const redrawWaitMs = redrawAgeMs < TERMINAL_TRANSIENT_HEADER_ARTIFACT_REDRAW_QUIET_MS
        ? TERMINAL_TRANSIENT_HEADER_ARTIFACT_REDRAW_QUIET_MS - redrawAgeMs
        : 0;
      const waitMs = Math.ceil(Math.max(outputWaitMs, redrawWaitMs, 0));

      if (waitMs > 0) {
        return {
          lastRedrawControl: transientHeaderArtifactCleanupLastRedrawControl,
          outputAgeMs,
          quiet: false,
          reason: redrawWaitMs >= outputWaitMs ? "redraw_quiet_window" : "output_quiet_window",
          redrawAgeMs,
          waitMs,
        };
      }

      return {
        outputAgeMs,
        quiet: true,
        redrawAgeMs,
        waitMs: 0,
      };
    };
    const applyTransientHeaderArtifactCleanup = (reason, extraFields = {}) => {
      if (!isTransientHeaderArtifactCleanupEnabled()) {
        return false;
      }

      const now = performance.now();
      if (now > Number(transientHeaderArtifactCleanupUntil || 0)) {
        clearTransientHeaderArtifactCleanupTimer();
        resetTransientHeaderArtifactCandidate();
        return false;
      }

      const plan = getTerminalTransientHeaderArtifactCleanupPlan(terminal, {
        agentKind: terminalAgentKind,
        profileId: terminalStabilityFeatures.transientHeaderArtifactProfile,
      });
      const signature = plan.shouldCleanup
        ? `${plan.profileId}:${plan.keepBlock?.start || 0}:${
          (plan.deleteBlocks || [])
            .map((block) => `${block.start}-${block.deleteEnd ?? block.end}`)
            .join(",")
        }`
        : "";

      if (!plan.shouldCleanup) {
        resetTransientHeaderArtifactCandidate();
        if (windowsTerminalDiagnosticsEnabled && plan.blockCount > 1) {
          logTransientHeaderArtifactCleanup("skip", {
            blockCount: Number(plan.blockCount || 0),
            deleteRows: Number(plan.deleteRows || 0),
            reason,
            scanStart: Number(plan.scanStart || 0),
            skipReason: plan.reason,
            ...extraFields,
          });
        }
        return false;
      }

      if (signature && signature === transientHeaderArtifactCleanupLastSignature) {
        resetTransientHeaderArtifactCandidate();
        return false;
      }

      const stableSignature = [
        signature,
        plan.baseY,
        plan.viewportY,
        plan.bufferLength,
      ].join(":");
      applyTransientHeaderArtifactVisualMask(plan, stableSignature, reason, {
        ...extraFields,
      });
      if (
        !transientHeaderArtifactCleanupCandidateSignature
        || transientHeaderArtifactCleanupCandidateSignature !== stableSignature
      ) {
        transientHeaderArtifactCleanupCandidateSignature = stableSignature;
        transientHeaderArtifactCleanupCandidateSeenAt = now;
        scheduleTransientHeaderArtifactCleanup(reason, {
          candidateSignature: stableSignature,
          retryReason: "waiting_for_stable_plan",
          ...extraFields,
        }, [TERMINAL_TRANSIENT_HEADER_ARTIFACT_STABLE_PLAN_MS]);
        return false;
      }

      const stableForMs = now - Number(transientHeaderArtifactCleanupCandidateSeenAt || 0);
      if (stableForMs < TERMINAL_TRANSIENT_HEADER_ARTIFACT_STABLE_PLAN_MS) {
        scheduleTransientHeaderArtifactCleanup(reason, {
          candidateSignature: stableSignature,
          retryReason: "waiting_for_stable_plan",
          stableForMs,
          ...extraFields,
        }, [TERMINAL_TRANSIENT_HEADER_ARTIFACT_STABLE_PLAN_MS - stableForMs + 12]);
        return false;
      }

      const quietState = getTransientHeaderArtifactQuietState();
      if (!quietState.quiet) {
        transientHeaderArtifactCleanupRetryCount += 1;
        if (transientHeaderArtifactCleanupRetryCount > TERMINAL_TRANSIENT_HEADER_ARTIFACT_MAX_RETRIES) {
          logTransientHeaderArtifactCleanup("abort", {
            reason,
            retryCount: transientHeaderArtifactCleanupRetryCount,
            skipReason: quietState.reason,
            ...quietState,
            ...extraFields,
          });
          clearTransientHeaderArtifactCleanupTimer();
          resetTransientHeaderArtifactCandidate();
          return false;
        }

        scheduleTransientHeaderArtifactCleanup(reason, {
          retryCount: transientHeaderArtifactCleanupRetryCount,
          retryReason: quietState.reason,
          ...quietState,
          ...extraFields,
        }, [Math.max(16, quietState.waitMs || TERMINAL_TRANSIENT_HEADER_ARTIFACT_RETRY_MS)]);
        return false;
      }

      transientHeaderArtifactCleanupLastSignature = signature;
      transientHeaderArtifactCleanupRetryCount = 0;
      resetTransientHeaderArtifactCandidate({ clearMask: false });
      const beforeState = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
      const result = applyTerminalTransientHeaderArtifactCleanup(terminal, plan);

      if (!result.cleaned) {
        clearTransientHeaderArtifactVisualMask("apply_failed", {
          reason,
          resultReason: result.reason,
        });
        logTransientHeaderArtifactCleanup("apply_failed", {
          blockCount: Number(plan.blockCount || 0),
          deleteRows: Number(plan.deleteRows || 0),
          reason,
          resultReason: result.reason,
          ...extraFields,
        });
        return false;
      }

      const refreshed = refreshTerminalRenderer("transient_header_artifact_cleanup", {
        blockCount: Number(plan.blockCount || 0),
        deletedRows: Number(result.deletedRows || 0),
        profileId: plan.profileId,
        reason,
      });
      clearTransientHeaderArtifactVisualMask("cleanup_applied", {
        deletedRows: Number(result.deletedRows || 0),
        reason,
      });
      const afterState = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
      logTransientHeaderArtifactCleanup("apply", {
        afterBaseY: Number(afterState.baseY || 0),
        afterViewportY: Number(afterState.viewportY || 0),
        beforeBaseY: Number(beforeState.baseY || 0),
        beforeViewportY: Number(beforeState.viewportY || 0),
        blockCount: Number(plan.blockCount || 0),
        currentThreshold: Number(plan.currentThreshold || 0),
        deletedBlocks: result.deletedBlocks || [],
        deletedRows: Number(result.deletedRows || 0),
        expandedGapRows: (result.deletedBlocks || [])
          .reduce((total, block) => total + Number(block.expandedGapRows || 0), 0),
        keepBlockStart: Number(plan.keepBlock?.start || 0),
        reason,
        refreshed,
        resultReason: result.reason,
        scanStart: Number(plan.scanStart || 0),
        ...extraFields,
      });
      scheduleTerminalStabilityResizeProbe(reason, "after_transient_header_cleanup", {
        deletedRows: Number(result.deletedRows || 0),
        profileId: plan.profileId,
      }, [0, 180]);
      return true;
    };
    scheduleTransientHeaderArtifactCleanup = (
      reason,
      extraFields = {},
      delaysMs = TERMINAL_TRANSIENT_HEADER_ARTIFACT_CLEANUP_DELAYS_MS,
    ) => {
      if (!isTransientHeaderArtifactCleanupEnabled()) {
        return false;
      }

      const now = performance.now();
      const normalizedDelaysMs = Array.isArray(delaysMs) && delaysMs.length
        ? delaysMs
          .map((delayMs) => Math.max(0, Number(delayMs || 0)))
          .filter((delayMs) => Number.isFinite(delayMs))
        : [0];
      if (!normalizedDelaysMs.length) {
        normalizedDelaysMs.push(0);
      }
      if (!extraFields.retryReason) {
        transientHeaderArtifactCleanupRetryCount = 0;
      }
      const targetDelayMs = Math.min(...normalizedDelaysMs);
      const targetDueAt = now + targetDelayMs;

      transientHeaderArtifactCleanupUntil = Math.max(
        Number(transientHeaderArtifactCleanupUntil || 0),
        now + TERMINAL_TRANSIENT_HEADER_ARTIFACT_CLEANUP_MS,
      );
      transientHeaderArtifactCleanupPendingReason = reason;
      transientHeaderArtifactCleanupPendingFields = {
        ...extraFields,
      };

      if (
        transientHeaderArtifactCleanupTimer
        && transientHeaderArtifactCleanupDueAt > 0
        && targetDueAt + 8 >= transientHeaderArtifactCleanupDueAt
      ) {
        return true;
      }

      clearTransientHeaderArtifactCleanupTimer();
      transientHeaderArtifactCleanupSequence += 1;
      const cleanupId = transientHeaderArtifactCleanupSequence;

      transientHeaderArtifactCleanupDueAt = targetDueAt;
      transientHeaderArtifactCleanupTimer = window.setTimeout(() => {
        const timer = transientHeaderArtifactCleanupTimer;
        startupMetricTimers.delete(timer);
        transientHeaderArtifactCleanupTimer = 0;
        transientHeaderArtifactCleanupDueAt = 0;
        applyTransientHeaderArtifactCleanup(transientHeaderArtifactCleanupPendingReason || reason, {
          cleanupId,
          delayMs: targetDelayMs,
          ...transientHeaderArtifactCleanupPendingFields,
        });
      }, targetDelayMs);
      startupMetricTimers.add(transientHeaderArtifactCleanupTimer);

      logTransientHeaderArtifactCleanup("schedule", {
        cleanupId,
        delaysMs: normalizedDelaysMs,
        reason,
        ...extraFields,
      });

      return true;
    };
    const activateSlashCommandDiagnosticProbe = (reason, action, extraFields = {}) => {
      if (!isSlashCommandDiagnosticEnabled()) {
        return;
      }

      slashCommandDiagnosticState.probeUntil = Math.max(
        Number(slashCommandDiagnosticState.probeUntil || 0),
        performance.now() + TERMINAL_SLASH_COMMAND_PROBE_WINDOW_MS,
      );
      logSlashCommandDiagnosticProbe(reason, action, extraFields);
      scheduleSlashCommandDiagnosticProbe(reason, action, extraFields);
    };
    const resetSlashCommandDiagnosticLine = () => {
      slashCommandDiagnosticState.active = false;
      slashCommandDiagnosticState.commandName = "";
      slashCommandDiagnosticState.commandPreview = "";
      slashCommandDiagnosticState.keydownActive = false;
      slashCommandDiagnosticState.keydownCommandName = "";
      slashCommandDiagnosticState.keydownCommandPreview = "";
      slashCommandDiagnosticState.keydownLine = "";
      slashCommandDiagnosticState.lastLoggedPreview = "";
      slashCommandDiagnosticState.lastKeydownLoggedPreview = "";
      slashCommandDiagnosticState.line = "";
    };
    const applySlashCommandLineSnapshot = (snapshot) => {
      slashCommandDiagnosticState.commandName = snapshot.commandName;
      slashCommandDiagnosticState.commandPreview = snapshot.commandPreview;
    };
    const applySlashCommandKeydownSnapshot = (snapshot) => {
      slashCommandDiagnosticState.keydownCommandName = snapshot.commandName;
      slashCommandDiagnosticState.keydownCommandPreview = snapshot.commandPreview;
    };
    const appendSlashCommandDiagnosticPrintableInput = (inputData) => {
      const text = String(inputData || "");

      for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        const code = char.charCodeAt(0);

        if (char === "\r" || char === "\n") {
          continue;
        }

        if (char === "\x7f" || char === "\b") {
          slashCommandDiagnosticState.line = slashCommandDiagnosticState.line.slice(0, -1);
          continue;
        }

        if (code === 0x1b) {
          const next = text[index + 1] || "";
          if (next === "[") {
            index += 2;
            while (index < text.length) {
              const finalCode = text.charCodeAt(index);
              if (finalCode >= 0x40 && finalCode <= 0x7e) {
                break;
              }
              index += 1;
            }
          } else if (next) {
            index += 1;
          }
          continue;
        }

        if (code >= 0x20 && code !== 0x7f) {
          slashCommandDiagnosticState.line = (
            slashCommandDiagnosticState.line + char
          ).slice(-TERMINAL_SLASH_COMMAND_MAX_LINE_CHARS);
        }
      }
    };
    const getSlashCommandKeydownSummary = (event) => ({
      altKey: Boolean(event?.altKey),
      code: sanitizeTerminalDiagnosticText(event?.code || "", 40),
      ctrlKey: Boolean(event?.ctrlKey),
      isBackspace: event?.key === "Backspace",
      isEnter: event?.key === "Enter",
      isEscape: event?.key === "Escape",
      isPrintable: String(event?.key || "").length === 1
        && !event?.metaKey
        && !event?.ctrlKey
        && !event?.altKey,
      key: sanitizeTerminalDiagnosticText(event?.key || "", 40),
      metaKey: Boolean(event?.metaKey),
      repeat: Boolean(event?.repeat),
      shiftKey: Boolean(event?.shiftKey),
    });
    const appendSlashCommandDiagnosticKeydownInput = (event) => {
      if (!event) {
        return;
      }

      if (event.key === "Backspace") {
        slashCommandDiagnosticState.keydownLine = slashCommandDiagnosticState.keydownLine.slice(0, -1);
        return;
      }

      if (
        String(event.key || "").length === 1
        && !event.metaKey
        && !event.ctrlKey
        && !event.altKey
      ) {
        slashCommandDiagnosticState.keydownLine = (
          slashCommandDiagnosticState.keydownLine + event.key
        ).slice(-TERMINAL_SLASH_COMMAND_MAX_LINE_CHARS);
      }
    };
    const resetSlashCommandDiagnosticKeydownLine = () => {
      slashCommandDiagnosticState.keydownActive = false;
      slashCommandDiagnosticState.keydownCommandName = "";
      slashCommandDiagnosticState.keydownCommandPreview = "";
      slashCommandDiagnosticState.keydownLine = "";
      slashCommandDiagnosticState.lastKeydownLoggedPreview = "";
    };
    const handleSlashCommandDiagnosticKeyDown = (event, reason = "keydown") => {
      if (
        !isSlashCommandDiagnosticEnabled()
        || !event
        || event.isComposing
      ) {
        return;
      }

      const keySummary = getSlashCommandKeydownSummary(event);
      const wasActive = slashCommandDiagnosticState.keydownActive;
      const wasProbeActive = isSlashCommandDiagnosticProbeActive();
      const beforeSnapshot = getTerminalSlashCommandLineSnapshot(slashCommandDiagnosticState.keydownLine);

      if (keySummary.isEnter) {
        if (wasActive || beforeSnapshot.startsWithSlash) {
          slashCommandDiagnosticState.lastSubmittedCommandName = beforeSnapshot.commandName;
          slashCommandDiagnosticState.lastSubmittedCommandPreview = beforeSnapshot.commandPreview;
          activateSlashCommandDiagnosticProbe(reason, "keydown_submit", {
            key: keySummary,
            submittedCommand: beforeSnapshot,
          });
        } else if (wasProbeActive) {
          activateSlashCommandDiagnosticProbe(reason, "keydown_picker_submit", {
            key: keySummary,
          });
          markCodexSlashMenuCloseCleanup(reason, "keydown_picker_submit", {
            key: keySummary,
          });
        }
        resetSlashCommandDiagnosticKeydownLine();
        return;
      }

      if (keySummary.isEscape) {
        if (wasActive || beforeSnapshot.startsWithSlash) {
          activateSlashCommandDiagnosticProbe(reason, "keydown_cancel", {
            beforeCommand: beforeSnapshot,
            key: keySummary,
          });
          markCodexSlashMenuCloseCleanup(reason, "keydown_cancel", {
            beforeCommand: beforeSnapshot,
            key: keySummary,
          });
          resetSlashCommandDiagnosticKeydownLine();
        } else if (wasProbeActive) {
          activateSlashCommandDiagnosticProbe(reason, "keydown_picker_escape", {
            key: keySummary,
          });
          markCodexSlashMenuCloseCleanup(reason, "keydown_picker_escape", {
            key: keySummary,
          });
        }
        return;
      }

      appendSlashCommandDiagnosticKeydownInput(event);
      const afterSnapshot = getTerminalSlashCommandLineSnapshot(slashCommandDiagnosticState.keydownLine);

      if (afterSnapshot.startsWithSlash && !wasActive) {
        slashCommandDiagnosticState.keydownActive = true;
        if (!slashCommandDiagnosticState.active) {
          slashCommandDiagnosticState.sequence += 1;
        }
        applySlashCommandKeydownSnapshot(afterSnapshot);
        slashCommandDiagnosticState.lastKeydownLoggedPreview = afterSnapshot.commandPreview;
        activateSlashCommandDiagnosticProbe(reason, "keydown_start", {
          key: keySummary,
        });
      } else if (
        afterSnapshot.startsWithSlash
        && afterSnapshot.commandPreview !== slashCommandDiagnosticState.lastKeydownLoggedPreview
      ) {
        applySlashCommandKeydownSnapshot(afterSnapshot);
        slashCommandDiagnosticState.lastKeydownLoggedPreview = afterSnapshot.commandPreview;
        activateSlashCommandDiagnosticProbe(reason, "keydown_update", {
          key: keySummary,
        });
      } else if (wasActive && !afterSnapshot.startsWithSlash) {
        activateSlashCommandDiagnosticProbe(reason, "keydown_abandon", {
          beforeCommand: beforeSnapshot,
          key: keySummary,
        });
        resetSlashCommandDiagnosticKeydownLine();
      } else if (wasProbeActive && !keySummary.isPrintable) {
        activateSlashCommandDiagnosticProbe(reason, "keydown_picker_control", {
          key: keySummary,
        });
      }
    };
    handleSlashCommandDiagnosticInput = (inputData, reason = "xterm_on_data") => {
      if (!isSlashCommandDiagnosticEnabled()) {
        return;
      }

      const inputSummary = getTerminalSlashCommandInputSummary(inputData);
      const wasActive = slashCommandDiagnosticState.active;
      const wasProbeActive = isSlashCommandDiagnosticProbeActive();
      const beforeSnapshot = getTerminalSlashCommandLineSnapshot(slashCommandDiagnosticState.line);
      appendSlashCommandDiagnosticPrintableInput(inputData);
      const afterSnapshot = getTerminalSlashCommandLineSnapshot(slashCommandDiagnosticState.line);
      const hasSubmit = inputSummary.hasReturn || inputSummary.hasNewline;
      const hasCancel = String(inputData || "").includes("\x03");
      const isControlOnly = inputSummary.chars > 0 && !inputSummary.printablePreview;

      if (afterSnapshot.startsWithSlash && !wasActive) {
        slashCommandDiagnosticState.active = true;
        slashCommandDiagnosticState.sequence += 1;
        applySlashCommandLineSnapshot(afterSnapshot);
        slashCommandDiagnosticState.lastLoggedPreview = afterSnapshot.commandPreview;
        activateSlashCommandDiagnosticProbe(reason, "start", {
          input: inputSummary,
        });
      } else if (
        afterSnapshot.startsWithSlash
        && afterSnapshot.commandPreview !== slashCommandDiagnosticState.lastLoggedPreview
      ) {
        applySlashCommandLineSnapshot(afterSnapshot);
        slashCommandDiagnosticState.lastLoggedPreview = afterSnapshot.commandPreview;
        activateSlashCommandDiagnosticProbe(reason, "update", {
          input: inputSummary,
        });
      } else if (wasActive && !afterSnapshot.startsWithSlash && !hasSubmit && !hasCancel) {
        activateSlashCommandDiagnosticProbe(reason, "abandon", {
          beforeCommand: beforeSnapshot,
          input: inputSummary,
        });
        resetSlashCommandDiagnosticLine();
      }

      if (hasSubmit) {
        const submittedSnapshot = afterSnapshot.startsWithSlash ? afterSnapshot : beforeSnapshot;
        if (wasActive || submittedSnapshot.startsWithSlash) {
          applySlashCommandLineSnapshot(submittedSnapshot);
          slashCommandDiagnosticState.lastSubmittedCommandName = submittedSnapshot.commandName;
          slashCommandDiagnosticState.lastSubmittedCommandPreview = submittedSnapshot.commandPreview;
          activateSlashCommandDiagnosticProbe(reason, "submit", {
            input: inputSummary,
            submittedCommand: submittedSnapshot,
          });
        } else if (wasProbeActive) {
          activateSlashCommandDiagnosticProbe(reason, "picker_submit_input", {
            input: inputSummary,
          });
          markCodexSlashMenuCloseCleanup(reason, "picker_submit_input", {
            input: inputSummary,
          });
        }
        resetSlashCommandDiagnosticLine();
        return;
      }

      if (hasCancel && wasActive) {
        activateSlashCommandDiagnosticProbe(reason, "cancel", {
          beforeCommand: beforeSnapshot,
          input: inputSummary,
        });
        markCodexSlashMenuCloseCleanup(reason, "cancel", {
          beforeCommand: beforeSnapshot,
          input: inputSummary,
        });
        resetSlashCommandDiagnosticLine();
        return;
      }

      if (wasProbeActive && (inputSummary.hasEscape || isControlOnly)) {
        activateSlashCommandDiagnosticProbe(reason, "picker_control_input", {
          input: inputSummary,
        });
        if (inputSummary.hasEscape) {
          markCodexSlashMenuCloseCleanup(reason, "picker_escape_input", {
            input: inputSummary,
          });
        }
      }
    };
    const getCurrentCodexResizeGateSize = () => normalizeCodexResizeGateSize({
      cols: terminal.cols,
      rows: terminal.rows,
    });
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
      const coalescedData = coalesced.data;
      scheduleCodexResizePaintProbe("codex_resize_gate_flush", "before_coalesced_write", {
        coalescedBytes: Number(coalesced.data?.byteLength || 0),
        droppedBytes: coalesced.droppedBytes,
        framesDropped: coalesced.framesDropped,
        framesSeen: coalesced.framesSeen,
        outputBytes: Number(coalescedData?.byteLength || 0),
        queuedBytes,
        queuedChunks: queuedWrites.length,
        queuedRawChunks,
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
      if (coalescedData?.byteLength) {
        const isFirstOutputChunk = queuedWrites.some((write) => write.isFirstOutputChunk);
        const isFirstVisibleOutputChunk = queuedWrites.some((write) => write.isFirstVisibleOutputChunk);
        const visibleChars = getTerminalOutputVisibleCharCount(coalescedData);
        enqueueTerminalOutputWrite(coalescedData, {
          afterWriteRefreshReason: "codex_resize_gate_flush",
          isFirstOutputChunk,
          isFirstVisibleOutputChunk,
          outputDebug: { visibleChars },
          scrollToBottomAfterWrite: startedAtBottom,
          scrollToBottomBeforeWrite: true,
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
        outputBytes: Number(coalescedData?.byteLength || 0),
        previousBaseY: Number(startState?.baseY || 0),
        previousCols: previousSize?.cols || 0,
        previousRows: previousSize?.rows || 0,
        previousViewportY: Number(startState?.viewportY || 0),
        queuedBytes,
        queuedChunks: queuedWrites.length,
        queuedRawChunks,
        reason,
        scrollToBottomAfterWrite: startedAtBottom,
        targetCols: targetSize?.cols || 0,
        targetRows: targetSize?.rows || 0,
      });
      return true;
    };
    markCodexResizeGateActive = (reason = "resize", size = null, options = {}) => {
      if (!isCodexResizeGateEnabled() || isDisposed) {
        return;
      }

      const targetSize = normalizeCodexResizeGateSize(size) || getCurrentCodexResizeGateSize();
      if (!targetSize) {
        return;
      }

      const force = options.force === true;
      const synthetic = options.synthetic === true;
      const previousObservedSize = codexResizeGate.lastObservedSize;
      const sizeChanged = Boolean(previousObservedSize)
        && !codexResizeGateSizesEqual(previousObservedSize, targetSize);
      codexResizeGate.lastObservedSize = targetSize;

      if (!previousObservedSize) {
        logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.codex_resize_gate", {
          action: "prime",
          forced: force,
          reason,
          synthetic,
          targetCols: targetSize.cols,
          targetRows: targetSize.rows,
        });
        if (!force) {
          return;
        }
      }

      if (
        !sizeChanged
        && !force
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
      codexResizeGate.previousSize = previousObservedSize || targetSize;
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
      if (!wasActive || force) {
        codexResizeGate.liveTailLastCleanedSignature = "";
        codexResizeGate.scrollbackCleanupLastHandledBaseY = 0;
        codexResizeGate.scrollbackCleanupLastTargetY = -1;
        codexResizeGate.scrollbackCleanupAnchor = getTerminalViewportAnchorDiagnostic(terminal);
        codexResizeGate.scrollbackCleanupStartBaseY = Number(startState.baseY || 0);
        codexResizeGate.scrollbackCleanupStartedAtBottom = codexResizeGate.startedAtBottom;
        codexResizeGate.scrollbackCleanupStartViewportY = Number(startState.viewportY || 0);
      }

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.codex_resize_gate", {
        action: force
          ? (wasActive ? "synthetic_retarget" : "synthetic_start")
          : wasActive
            ? "retarget"
            : "start",
        epoch: codexResizeGate.epoch,
        forced: force,
        previousBaseY: Number(startState.baseY || 0),
        previousCols: (previousObservedSize || targetSize).cols,
        previousRows: (previousObservedSize || targetSize).rows,
        previousViewportY: Number(startState.viewportY || 0),
        reason,
        liveTailCleanupUntil: Number(codexResizeGate.liveTailCleanupUntil || 0),
        startedAtBottom: codexResizeGate.startedAtBottom,
        scrollbackCleanupStartBaseY: codexResizeGate.scrollbackCleanupStartBaseY,
        scrollbackCleanupAnchorRows: Number(codexResizeGate.scrollbackCleanupAnchor?.rowCount || 0),
        scrollbackCleanupAnchorViewportY: Number(codexResizeGate.scrollbackCleanupAnchor?.viewportY || 0),
        scrollbackCleanupStartViewportY: codexResizeGate.scrollbackCleanupStartViewportY,
        scrollbackCleanupStartedAtBottom: codexResizeGate.scrollbackCleanupStartedAtBottom,
        synthetic,
        targetCols: targetSize.cols,
        targetRows: targetSize.rows,
      });
      scheduleCodexResizePaintProbe(reason, wasActive ? "gate_retarget" : "gate_start", {
        forced: force,
        previousCols: (previousObservedSize || targetSize).cols,
        previousRows: (previousObservedSize || targetSize).rows,
        synthetic,
        targetCols: targetSize.cols,
        targetRows: targetSize.rows,
      }, [0]);

      scheduleCodexResizeGateFlush(reason, TERMINAL_CODEX_RESIZE_GATE_SETTLE_MS, {
        allowLater: true,
      });
    };
    const isCodexSlashMenuCloseCleanupEnabled = () => false;
    const isCodexSlashMenuCloseCleanupActive = () => (
      isCodexSlashMenuCloseCleanupEnabled()
      && codexSlashMenuCloseCleanupState.active
      && performance.now() <= Number(codexSlashMenuCloseCleanupState.cleanupUntil || 0)
    );
    const clearCodexSlashMenuCloseCleanupTimer = () => {
      if (!codexSlashMenuCloseCleanupState.quietTimer) {
        return;
      }

      window.clearTimeout(codexSlashMenuCloseCleanupState.quietTimer);
      codexSlashMenuCloseCleanupState.quietTimer = 0;
    };
    const logCodexSlashMenuCloseCleanup = (action, fields = {}) => {
      if (!windowsTerminalDiagnosticsEnabled || !terminalStabilityFeatures.slashMenuCloseResize || isDisposed) {
        return;
      }

      logWindowsTerminalCompactDiagnostic("frontend.windows_terminal.codex_slash_menu_close_cleanup", {
        action,
        cleanupActive: isCodexSlashMenuCloseCleanupActive(),
        cleanupUntil: Number(codexSlashMenuCloseCleanupState.cleanupUntil || 0),
        closeAction: codexSlashMenuCloseCleanupState.closeAction,
        closeReason: codexSlashMenuCloseCleanupState.closeReason,
        epoch: codexSlashMenuCloseCleanupState.epoch,
        lastOutputAgeMs: codexSlashMenuCloseCleanupState.lastOutputAt
          ? performance.now() - codexSlashMenuCloseCleanupState.lastOutputAt
          : -1,
        resizeEpoch: codexResizeGate.epoch,
        resizeGateActive: codexResizeGate.active,
        resizeRequested: codexSlashMenuCloseCleanupState.resizeRequested,
        ...fields,
      });
    };
    const applyCodexSlashMenuCloseCleanup = (reason, extraFields = {}) => {
      if (!isCodexSlashMenuCloseCleanupActive()) {
        return false;
      }

      const now = performance.now();
      if (now > Number(codexSlashMenuCloseCleanupState.cleanupUntil || 0)) {
        codexSlashMenuCloseCleanupState.active = false;
        clearCodexSlashMenuCloseCleanupTimer();
        return false;
      }

      if (outputWriteInFlight || pendingOutputWrites.length > 0) {
        scheduleCodexSlashMenuCloseCleanup(reason, {
          pendingOutputBytes,
          pendingOutputWrites: pendingOutputWrites.length,
          retryReason: "pending_output",
          ...extraFields,
        }, [TERMINAL_CODEX_SLASH_MENU_CLOSE_OUTPUT_QUIET_MS]);
        return false;
      }

      const quietForMs = codexSlashMenuCloseCleanupState.lastOutputAt
        ? now - Number(codexSlashMenuCloseCleanupState.lastOutputAt || 0)
        : TERMINAL_CODEX_SLASH_MENU_CLOSE_OUTPUT_QUIET_MS;
      if (quietForMs < TERMINAL_CODEX_SLASH_MENU_CLOSE_OUTPUT_QUIET_MS) {
        scheduleCodexSlashMenuCloseCleanup(reason, {
          quietForMs,
          retryReason: "waiting_for_output_quiet",
          ...extraFields,
        }, [TERMINAL_CODEX_SLASH_MENU_CLOSE_OUTPUT_QUIET_MS - quietForMs + 12]);
        return false;
      }

      codexResizeGate.scrollbackCleanupUntil = Math.max(
        Number(codexResizeGate.scrollbackCleanupUntil || 0),
        now + TERMINAL_CODEX_RESIZE_SCROLLBACK_CLEANUP_MS,
      );
      codexResizeGate.liveTailCleanupUntil = Math.max(
        Number(codexResizeGate.liveTailCleanupUntil || 0),
        now + TERMINAL_CODEX_RESIZE_LIVE_TAIL_CLEANUP_MS,
      );
      codexResizeGate.paintProbeUntil = Math.max(
        Number(codexResizeGate.paintProbeUntil || 0),
        now + TERMINAL_CODEX_RESIZE_PAINT_PROBE_WINDOW_MS,
      );

      const beforeState = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
      syncTerminalPaintBounds("codex_slash_menu_close_cleanup");
      const refreshed = refreshTerminalRenderer("codex_slash_menu_close_cleanup", {
        closeAction: codexSlashMenuCloseCleanupState.closeAction,
        closeReason: codexSlashMenuCloseCleanupState.closeReason,
        reason,
      });
      const scrollbackCleaned = applyCodexResizeScrollbackCleanup("codex_slash_menu_close_cleanup", beforeState, {
        closeAction: codexSlashMenuCloseCleanupState.closeAction,
        closeReason: codexSlashMenuCloseCleanupState.closeReason,
        quietForMs,
        syntheticSlashMenuClose: true,
        ...extraFields,
      });
      const liveTailCleaned = applyCodexResizeLiveTailCleanup("codex_slash_menu_close_cleanup_immediate", {
        allowWithPendingOutput: true,
        closeAction: codexSlashMenuCloseCleanupState.closeAction,
        closeReason: codexSlashMenuCloseCleanupState.closeReason,
        quietForMs,
        syntheticSlashMenuClose: true,
      });
      const liveTailScheduled = scheduleCodexResizeLiveTailCleanup("codex_slash_menu_close_cleanup", {
        closeAction: codexSlashMenuCloseCleanupState.closeAction,
        closeReason: codexSlashMenuCloseCleanupState.closeReason,
        quietForMs,
        syntheticSlashMenuClose: true,
      }, [0, 80, 180, 360]);
      scheduleCodexResizePaintProbe("codex_slash_menu_close_cleanup", "after_cleanup", {
        closeAction: codexSlashMenuCloseCleanupState.closeAction,
        closeReason: codexSlashMenuCloseCleanupState.closeReason,
        liveTailCleaned,
        liveTailScheduled,
        quietForMs,
        refreshed,
        scrollbackCleaned,
      }, [0, 80, 240]);

      const afterState = getWindowsTerminalCompactState(terminal, container, terminalScrollableElement);
      logCodexSlashMenuCloseCleanup("apply", {
        afterBaseY: Number(afterState.baseY || 0),
        afterViewportY: Number(afterState.viewportY || 0),
        beforeBaseY: Number(beforeState.baseY || 0),
        beforeViewportY: Number(beforeState.viewportY || 0),
        liveTailCleaned,
        liveTailScheduled,
        quietForMs,
        reason,
        refreshed,
        scrollbackCleaned,
        ...extraFields,
      });

      if (scrollbackCleaned || liveTailCleaned) {
        codexSlashMenuCloseCleanupState.active = false;
      }

      return scrollbackCleaned || liveTailCleaned || refreshed;
    };
    const scheduleCodexSlashMenuCloseCleanup = (
      reason,
      extraFields = {},
      delaysMs = TERMINAL_CODEX_SLASH_MENU_CLOSE_CLEANUP_DELAYS_MS,
    ) => {
      if (!isCodexSlashMenuCloseCleanupActive()) {
        return false;
      }

      codexSlashMenuCloseCleanupState.cleanupUntil = Math.max(
        Number(codexSlashMenuCloseCleanupState.cleanupUntil || 0),
        performance.now() + TERMINAL_CODEX_SLASH_MENU_CLOSE_CLEANUP_MS,
      );
      codexSlashMenuCloseCleanupState.cleanupSequence += 1;
      const cleanupId = codexSlashMenuCloseCleanupState.cleanupSequence;

      delaysMs.forEach((delayMs) => {
        const normalizedDelayMs = Math.max(0, Number(delayMs || 0));
        const timer = window.setTimeout(() => {
          startupMetricTimers.delete(timer);
          applyCodexSlashMenuCloseCleanup(reason, {
            cleanupId,
            delayMs: normalizedDelayMs,
            ...extraFields,
          });
        }, normalizedDelayMs);
        startupMetricTimers.add(timer);
      });

      return true;
    };
    markCodexSlashMenuCloseCleanup = (reason, action, extraFields = {}) => {
      if (!isCodexSlashMenuCloseCleanupEnabled()) {
        return false;
      }

      const targetSize = getCurrentCodexResizeGateSize();
      if (!targetSize) {
        return false;
      }

      const now = performance.now();
      codexSlashMenuCloseCleanupState.active = true;
      codexSlashMenuCloseCleanupState.cleanupUntil = Math.max(
        Number(codexSlashMenuCloseCleanupState.cleanupUntil || 0),
        now + TERMINAL_CODEX_SLASH_MENU_CLOSE_CLEANUP_MS,
      );
      codexSlashMenuCloseCleanupState.closeAction = String(action || "");
      codexSlashMenuCloseCleanupState.closeReason = String(reason || "");
      codexSlashMenuCloseCleanupState.epoch += 1;
      codexSlashMenuCloseCleanupState.startedAt = now;
      codexSlashMenuCloseCleanupState.lastOutputAt = 0;
      codexSlashMenuCloseCleanupState.resizeRequested = false;

      markCodexResizeGateActive(`codex_slash_menu_close:${action}`, targetSize, {
        force: true,
        synthetic: true,
      });

      clearCodexSlashMenuCloseCleanupTimer();
      const resizePulseTimer = window.setTimeout(() => {
        startupMetricTimers.delete(resizePulseTimer);
        codexSlashMenuCloseCleanupState.quietTimer = 0;
        if (!isCodexSlashMenuCloseCleanupActive()) {
          return;
        }

        try {
          const resizeResult = resizeController?.resizeNow?.(`codex_slash_menu_close:${action}`, {
            force: true,
            forceNative: true,
            nativeDelayMs: 0,
          });
          codexSlashMenuCloseCleanupState.resizeRequested = Boolean(resizeResult);
          if (resizeResult && typeof resizeResult.catch === "function") {
            resizeResult.catch(() => {});
          }
        } catch (_error) {
          codexSlashMenuCloseCleanupState.resizeRequested = false;
        }
      }, 50);
      codexSlashMenuCloseCleanupState.quietTimer = resizePulseTimer;
      startupMetricTimers.add(resizePulseTimer);

      scheduleCodexResizeGateFlush(`codex_slash_menu_close:${action}`, 260, {
        allowLater: true,
      });
      scheduleCodexSlashMenuCloseCleanup(reason, {
        closeAction: action,
        targetCols: targetSize.cols,
        targetRows: targetSize.rows,
        ...extraFields,
      });
      logCodexSlashMenuCloseCleanup("start", {
        closeAction: action,
        reason,
        targetCols: targetSize.cols,
        targetRows: targetSize.rows,
        ...extraFields,
      });

      return true;
    };
    markCodexSlashMenuOutputActivity = (byteLength = 0, extraFields = {}) => {
      if (!isCodexSlashMenuCloseCleanupActive()) {
        return;
      }

      codexSlashMenuCloseCleanupState.lastOutputAt = performance.now();
      scheduleCodexSlashMenuCloseCleanup("output_activity", {
        bytes: Number(byteLength || 0),
        ...extraFields,
      }, [TERMINAL_CODEX_SLASH_MENU_CLOSE_OUTPUT_QUIET_MS + 16]);
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
      clearTransientHeaderArtifactCleanupTimer();
      clearTransientHeaderArtifactVisualMask("dispose");
      clearCodexSlashMenuCloseCleanupTimer();
      codexSlashMenuCloseCleanupState.active = false;
      codexSlashMenuCloseCleanupState.cleanupUntil = 0;
      codexSlashMenuCloseCleanupState.lastOutputAt = 0;
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
      claudeResizeBlankFrameGuard.droppedDuplicateRepaints = 0;
      claudeResizeBlankFrameGuard.droppedFrames = 0;
      claudeResizeBlankFrameGuard.duplicateRepaintDecisions = 0;
      claudeResizeBlankFrameGuard.epoch = 0;
      claudeResizeBlankFrameGuard.lastDuplicateRepaintSignature = "";
      claudeResizeBlankFrameGuard.lastDroppedSignature = "";
      claudeResizeBlankFrameGuard.lastObservedSize = null;
      claudeResizeBlankFrameGuard.pendingDuplicateRepaintVisualCleanup = null;
      claudeResizeBlankFrameGuard.until = 0;
    });

    resizeController = createTerminalResizeController({
      canResize: () => hasOpenPty && !isDisposed && !windowBreakoutHostedRef.current,
      container,
      defaultCols: TERMINAL_DEFAULT_COLS,
      defaultRows: TERMINAL_DEFAULT_ROWS,
      // Plain shells repaint only the prompt row, and only on SIGWINCH; deferring the PTY resize
      // behind the agent-tuned commit window leaves zsh wrapping the input line at a stale width.
      ...(isGenericTerminal ? { nativeResizeCommitMs: 0, nativeResizeTrailingMs: 0 } : {}),
      instanceId: () => terminalInstanceId,
      isPriority: () => terminalActiveRef.current === true,
      // Hidden slots (inactive tab, unmeasured rect) keep layout, so their
      // ResizeObservers still fire; skip the reflow until the slot is shown.
      isVisible: () => {
        const slot = container.closest?.('[data-terminal-surface-slot="true"]');
        return !slot
          || (
            slot.getAttribute("data-terminal-tab-hidden") !== "true"
            && slot.getAttribute("data-terminal-hidden") !== "true"
          );
      },
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
        markTransientHeaderArtifactRedrawActivity("resize_done", {
          elapsedMs: Number(event.elapsedMs || 0),
          source: "resize_controller_done",
        });
        markClaudeResizeBlankFrameGuardActive(event.reason || "resize_done", event);
        // No immediate sync here: term.resize already ran the xterm onResize
        // handler (sync + settle schedule) when dimensions changed, and the
        // trailing sync below covers container drift that kept cols/rows.
        scheduleTerminalPaintBoundsSync("resize_done_settled", [34, 120, 260]);
        scheduleTerminalStabilityResizeProbe(event.reason || "resize_done", "resize_done", {
          elapsedMs: Number(event.elapsedMs || 0),
          source: "resize_controller",
        });
        scheduleTransientHeaderArtifactCleanup(event.reason || "resize_done", {
          elapsedMs: Number(event.elapsedMs || 0),
          source: "resize_controller_done",
        });
        scheduleCodexResizeGateFlush(event.reason || "resize_done");
      },
      onError: () => {},
      onStart: (event) => {
        markTransientHeaderArtifactRedrawActivity("resize_start", {
          source: "resize_controller_start",
        });
        markClaudeResizeBlankFrameGuardActive(event.reason || "resize_start", event, {
          force: true,
        });
        markCodexResizeGateActive(event.reason || "resize_start", event);
        scheduleTerminalStabilityResizeProbe(event.reason || "resize_start", "resize_start", {
          source: "resize_controller",
        }, [0, 120]);
        scheduleTransientHeaderArtifactCleanup(event.reason || "resize_start", {
          source: "resize_controller_start",
        }, [320, 900]);
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
        const outputSessionInspectionEnabled = !terminalUsesActivityHooks && !isGenericTerminal;
        const outputTextDecoder = outputSessionInspectionEnabled
          ? new TextDecoder("utf-8", { fatal: false })
          : null;
        let terminalSubmittedInputHasText = false;
        let terminalSubmittedInputText = "";
        let terminalSubmittedComposerState = createTerminalComposerState();
        let terminalReadyReconcileTimer = 0;
        let terminalReadyReconcileStartedAt = 0;
        let terminalReadyReconcileSequence = 0;
        const clearTerminalReadyReconcileTimer = () => {
          if (terminalReadyReconcileTimer) {
            window.clearTimeout(terminalReadyReconcileTimer);
            terminalReadyReconcileTimer = 0;
          }
        };
        disposables.push(clearTerminalReadyReconcileTimer);
        const normalizeTerminalReadyPromptText = (value) => String(value || "")
          .toLowerCase()
          .replace(/\s+/g, "");
        const getTerminalReadyPromptEvidence = () => {
          const activeBuffer = terminal?.buffer?.active;
          if (!activeBuffer) {
            return null;
          }

          const lineCount = Number(activeBuffer.length || 0);
          if (!lineCount) {
            return null;
          }

          const cursorLine = Math.min(
            lineCount - 1,
            Math.max(0, Number(activeBuffer.baseY || 0) + Number(activeBuffer.cursorY || 0)),
          );
          let startLine = cursorLine;
          while (startLine > 0 && activeBuffer.getLine(startLine)?.isWrapped) {
            startLine -= 1;
          }
          let endLine = cursorLine;
          while (endLine + 1 < lineCount && activeBuffer.getLine(endLine + 1)?.isWrapped) {
            endLine += 1;
          }

          const rowTexts = [];
          for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
            const line = activeBuffer.getLine(lineIndex);
            rowTexts.push(line ? line.translateToString(lineIndex === endLine).replace(/\u00a0/g, " ") : "");
          }
          const rawText = rowTexts.join("").replace(/[ \t]+$/g, "");
          const prefixMatch = rawText.match(/^([ \t]*(?:[\u203a\u276f\u2771>]\s*)+)/u);
          if (!prefixMatch) {
            return null;
          }

          const prefix = prefixMatch[1] || "";
          const hasSemanticPromptGlyph = /[\u203a\u276f\u2771]/u.test(prefix);
          const promptText = rawText.slice(prefix.length).trim();
          const currentComposerText = String(terminalSubmittedInputText || "").trim();
          if (!hasSemanticPromptGlyph && promptText) {
            const promptCompare = normalizeTerminalReadyPromptText(promptText);
            const composerCompare = normalizeTerminalReadyPromptText(currentComposerText);
            if (!composerCompare || !promptCompare.includes(composerCompare)) {
              return null;
            }
          }
          if (isTerminalModelPickerUiPrompt(promptText)) {
            return null;
          }

          const cursorX = Number(activeBuffer.cursorX || 0);
          if (Number.isFinite(cursorX) && cursorX < prefix.length) {
            return null;
          }

          return {
            cursorLine,
            cursorX,
            endLine,
            hasSemanticPromptGlyph,
            promptText,
            rawText,
            startLine,
          };
        };
        const shouldAttemptTerminalReadyReconcile = () => Boolean(
          terminalUsesActivityHooks
            && !isGenericTerminal
            && !isDisposed
            && hasOpenPty
            && !parkedPromptRef.current
            && (
              terminalThreadSubmittedPromptRef.current
              || String(terminalThreadActivityStatusRef.current || "").trim().toLowerCase() === "thinking"
            )
        );
        const runTerminalReadyReconcile = (reason, sequence) => {
          if (sequence !== terminalReadyReconcileSequence || !shouldAttemptTerminalReadyReconcile()) {
            return;
          }

          const evidence = getTerminalReadyPromptEvidence();
          if (evidence) {
            clearTerminalReadyReconcileTimer();
            const submittedPrompt = terminalThreadSubmittedPromptRef.current;
            const readinessKey = String(
              submittedPrompt?.promptEventId
                || submittedPrompt?.promptEpoch
                || `${terminalThreadIdRef.current || "thread"}:${terminalThreadLastWorkStartedAtRef.current || "ready"}`,
            );
            logThreadBridgeDiagnostic("frontend.thread_terminal_input_ready_reconcile", {
              agentId: terminalAgentKind,
              cursorLine: evidence.cursorLine,
              hasSemanticPromptGlyph: evidence.hasSemanticPromptGlyph,
              instanceId: terminalInstanceId,
              paneId,
              promptEventId: submittedPrompt?.promptEventId || "",
              promptText: getBigViewTextDiagnosticFields(evidence.promptText),
              reason,
              readinessKey,
              source: "terminal_prompt_ready_after_output_quiet",
              terminalIndex,
              threadId: terminalThreadIdRef.current || "",
              workspaceId: workspace?.id || "",
            });
            emitCodingAgentInputReady("terminal_prompt_ready_after_output_quiet", {
              allowRepeated: true,
              completionEvidence: "terminal_prompt_ready_after_output_quiet",
              completionInferred: true,
              completionSource: "terminal-readiness-reconcile",
              inputReadyConfidence: "terminal_prompt_ready_after_output_quiet",
              readinessEvidence: "terminal_prompt_line",
              readinessKey,
            });
            return;
          }

          if (performance.now() - terminalReadyReconcileStartedAt < TERMINAL_CODING_AGENT_READY_RECONCILE_MAX_MS) {
            terminalReadyReconcileTimer = window.setTimeout(() => {
              terminalReadyReconcileTimer = 0;
              runTerminalReadyReconcile(`${reason}:retry`, sequence);
            }, TERMINAL_CODING_AGENT_READY_RECONCILE_RETRY_MS);
          }
        };
        const scheduleTerminalReadyReconcile = (reason) => {
          if (!shouldAttemptTerminalReadyReconcile()) {
            return;
          }

          clearTerminalReadyReconcileTimer();
          terminalReadyReconcileStartedAt = performance.now();
          terminalReadyReconcileSequence += 1;
          const sequence = terminalReadyReconcileSequence;
          terminalReadyReconcileTimer = window.setTimeout(() => {
            terminalReadyReconcileTimer = 0;
            runTerminalReadyReconcile(reason, sequence);
          }, TERMINAL_CODING_AGENT_READY_RECONCILE_QUIET_MS);
        };
        const processPreparedTerminalOutput = (payload = {}) => {
          if (isDisposed) {
            return;
          }

          const chunkStartedAt = Number.isFinite(payload.chunkStartedAt)
            ? payload.chunkStartedAt
            : performance.now();
          const terminalData = payload.data instanceof Uint8Array
            ? payload.data
            : payload.data instanceof ArrayBuffer
              ? new Uint8Array(payload.data)
              : ArrayBuffer.isView(payload.data)
                ? new Uint8Array(payload.data.buffer, payload.data.byteOffset, payload.data.byteLength)
                : new Uint8Array(0);
          if (!terminalData.byteLength) {
            return;
          }

          const inputBytes = Number.isFinite(payload.inputBytes)
            ? payload.inputBytes
            : terminalData.byteLength;
          const sourceChunks = Number.isFinite(payload.sourceChunks)
            ? Math.max(1, payload.sourceChunks)
            : 1;
          const maskMs = Number.isFinite(payload.maskMs) ? payload.maskMs : 0;
          const debugExtraMs = Number.isFinite(payload.workerScheduledDelayMs)
            ? Math.max(0, payload.workerScheduledDelayMs)
            : 0;

          addTerminalMetrics({
            ipcEvents: sourceChunks,
            ipcBytes: inputBytes,
          });
          patchTerminalMetrics({ outputLagMs: 0 });

          const isFirstOutputChunk = !sawFirstOutput;
          outputChunks += sourceChunks;
          outputBytes += terminalData.byteLength;
          const shouldInspectTerminalText = outputSessionInspectionEnabled && (
            isFirstOutputChunk
            || (!capturedProviderSessionId && terminalThreadIdRef.current && outputChunks <= 80)
          );
          const visibleTerminalText = shouldInspectTerminalText
            ? String(payload.inspectionText || "")
            : "";
          if (visibleTerminalText) {
            providerSessionErrorBuffer = `${providerSessionErrorBuffer}${visibleTerminalText}`.slice(-2000);
            const missingSavedSessionId = extractCodexMissingSavedSessionId(providerSessionErrorBuffer);
            if (missingSavedSessionId) {
              emitInvalidProviderSession(
                missingSavedSessionId,
                providerSessionErrorBuffer,
                "codex-resume-output",
              );
            }
            if (!capturedProviderSessionId && terminalThreadIdRef.current) {
              providerSessionCaptureBuffer = `${providerSessionCaptureBuffer}${visibleTerminalText}`.slice(-2400);
              const nativeSessionId = extractNativeSessionIdFromOutput(
                terminalAgentKind,
                providerSessionCaptureBuffer,
              );
              if (nativeSessionId) {
                capturedProviderSessionId = nativeSessionId;
                logThreadBridgeDiagnostic("frontend.thread_provider_session.capture", {
                  agentId: terminalAgentKind,
                  bufferLength: providerSessionCaptureBuffer.length,
                  instanceId: terminalInstanceId,
                  nativeSessionIdPresent: true,
                  paneId,
                  terminalIndex,
                  threadId: terminalThreadIdRef.current || "",
                  workspaceId: workspace?.id || "",
                });
                onThreadTerminalLifecycle?.({
                  agentId: terminalAgentKind,
                  instanceId: terminalInstanceId,
                  nativeSessionId,
                  nativeSessionKind: "session",
                  nativeSessionSource: "terminal-output",
                  paneId,
                  terminalIndex,
                  threadId: terminalThreadIdRef.current,
                  type: "provider-session",
                  workspaceId: workspace?.id || "",
                });
              } else if (providerSessionCaptureMissesLogged < 8 && providerSessionCaptureBuffer.trim()) {
                providerSessionCaptureMissesLogged += 1;
                logThreadBridgeDiagnostic("frontend.thread_provider_session.capture_miss", {
                  agentId: terminalAgentKind,
                  bufferLength: providerSessionCaptureBuffer.length,
                  instanceId: terminalInstanceId,
                  paneId,
                  preview: sanitizeTerminalDiagnosticText(providerSessionCaptureBuffer, 200),
                  terminalIndex,
                  threadId: terminalThreadIdRef.current || "",
                  workspaceId: workspace?.id || "",
                });
              }
            }
          }

          const estimatedVisibleChars = Number.isFinite(payload.visibleChars)
            ? payload.visibleChars
            : getTerminalOutputVisibleByteEstimate(terminalData, 1);
          const outputByteStats = terminalDiagnosticsEnabled
            ? getTerminalOutputByteStats(terminalData)
            : null;
          const visibleChars = outputByteStats
            ? outputByteStats.visibleChars
            : estimatedVisibleChars;
          const hasVisibleOutput = visibleChars > 0;
          if (hasVisibleOutput && !terminalFirstVisibleOutputAtRef.current) {
            terminalFirstVisibleOutputAtRef.current = performance.now();
            logThreadBridgeDiagnostic("frontend.pending_prompt.terminal_visible_output_ready", {
              agentId: terminalAgentKind,
              instanceId: terminalInstanceId,
              paneId,
              terminalIndex,
              threadId: terminalThreadIdRef.current || "",
              visibleChars,
              workspaceId: workspace?.id || "",
            });
          }
          const isFirstVisibleOutputChunk = hasVisibleOutput && !sawFirstVisibleOutput;
          const shouldCollectOutputDebug = isFirstOutputChunk
            || isFirstVisibleOutputChunk;
          const debugStartedAt = shouldCollectOutputDebug ? performance.now() : 0;
          const outputDebug = shouldCollectOutputDebug
            ? getTerminalOutputDebugFields(terminalData)
            : { visibleChars };
          const debugMs = shouldCollectOutputDebug ? performance.now() - debugStartedAt : 0;
          if (terminalDiagnosticsEnabled) {
            outputDiagnosticChunks += sourceChunks;
            outputDiagnosticInputBytes += inputBytes;
            outputDiagnosticDisplayBytes += terminalData.byteLength;
            outputDiagnosticVisibleChars += visibleChars;
            outputDiagnosticEscapeBytes += outputByteStats?.escapeBytes || 0;
            outputDiagnosticControlBytes += outputByteStats?.controlBytes || 0;
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

          if (isFirstVisibleOutputChunk) {
            sawFirstVisibleOutput = true;
          }

          markCodexSlashMenuOutputActivity(terminalData.byteLength, {
            hasVisibleOutput,
            isFirstOutputChunk,
            isFirstVisibleOutputChunk,
            visibleChars,
          });

          logTerminalDiagnosticEvent(
            "frontend.output_chunk.slow",
            {
              debugMs,
              displayBytes: terminalData.byteLength,
              elapsedMs: performance.now() - chunkStartedAt,
              inputBytes,
              isFirstOutputChunk,
              isFirstVisibleOutputChunk,
              maskMs,
              outputChunks,
              paneId,
              rendererMode,
              terminalIndex,
              visibleChars: outputDebug.visibleChars,
              workerScheduledDelayMs: debugExtraMs,
            },
            { minElapsedMs: TERMINAL_OUTPUT_CHUNK_DIAGNOSTIC_SLOW_MS },
          );

          writeTerminalOutput(terminalData, {
            isFirstOutputChunk,
            isFirstVisibleOutputChunk,
            outputDebug,
            rawCodexResizeGateData: payload.rawCodexResizeGateData === true,
          });
          if (hasVisibleOutput) {
            scheduleTerminalReadyReconcile("visible_output_quiet");
          }
        };

        const processTerminalOutputInline = (data, chunkStartedAt = performance.now()) => {
          const maskStartedAt = performance.now();
          const displayData = outputDisplayMasker.maskBytes(data);
          const maskMs = performance.now() - maskStartedAt;
          if (!displayData.byteLength) {
            return;
          }

          const terminalData = displayData;

          if (!terminalData.byteLength) {
            return;
          }

          const isFirstOutputChunk = !sawFirstOutput;
          const shouldInspectTerminalText = outputSessionInspectionEnabled && (
            isFirstOutputChunk
            || (!capturedProviderSessionId && terminalThreadIdRef.current && outputChunks <= 80)
          );
          const inspectionText = shouldInspectTerminalText
            ? stripLiveViewControlSequences(outputTextDecoder.decode(terminalData, { stream: true }))
            : "";

          processPreparedTerminalOutput({
            chunkStartedAt,
            data: terminalData,
            inputBytes: data.byteLength,
            inspectionText,
            maskMs,
            rawCodexResizeGateData: false,
            sourceChunks: 1,
          });
        };

        const terminalOutputWorkerSession = createTerminalOutputWorkerSession({
          coreRepoPath: collapseFunctionalRepoPathToCoreRepoPath(workingDirectory || ""),
          id: `${paneId}:${terminalInstanceId}:output`,
          onTransportStatus: (event) => {
            if (event?.type === "transport-ready") {
              outputTransportReady = true;
              return;
            }
            if (event?.type === "transport-error" || event?.type === "transport-closed") {
              outputTransportFallback = true;
            }
          },
          onOutput: processPreparedTerminalOutput,
        });
        let outputTransportPreferred = false;
        let outputTransportReady = false;
        let outputTransportFallback = false;
        terminalOutputWorkerSessionRef.current = terminalOutputWorkerSession;
        terminalOutputWorkerSession?.setActive(terminalActiveRef.current === true);
        if (typeof terminalOutputWorkerSession?.prepareTransport === "function") {
          outputTransportPreferred = true;
          terminalOutputWorkerSession.prepareTransport({
            active: terminalActiveRef.current === true,
            inspect: outputSessionInspectionEnabled,
            instanceId: terminalInstanceId,
            paneId,
            timeoutMs: 1600,
          }).then(() => {
            outputTransportReady = true;
          }).catch(() => {
            outputTransportFallback = true;
          });
        }
        if (terminalOutputWorkerSession) {
          disposables.push(() => {
            if (terminalOutputWorkerSessionRef.current === terminalOutputWorkerSession) {
              terminalOutputWorkerSessionRef.current = null;
            }
            terminalOutputWorkerSession.dispose();
          });
        }

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

          if (outputTransportReady && !outputTransportFallback) {
            return;
          }

          if (terminalOutputWorkerSession?.enqueue(data, {
            active: terminalActiveRef.current === true,
            inspect: outputSessionInspectionEnabled,
          })) {
            return;
          }

          processTerminalOutputInline(data, chunkStartedAt);
        });

        let initialHeadlessOutputReplayInFlight = false;
        let initialHeadlessOutputReplayDone = false;
        const decodeHeadlessOutputBase64 = (value) => {
          try {
            const binary = window.atob(String(value || ""));
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) {
              bytes[index] = binary.charCodeAt(index);
            }
            return bytes;
          } catch (_error) {
            return new Uint8Array(0);
          }
        };
        const requestInitialHeadlessOutputReplay = (reason = "initial_headless_output_replay") => {
          if (
            isDisposed
            || !hasOpenPty
            || initialHeadlessOutputReplayDone
            || initialHeadlessOutputReplayInFlight
            || outputBytes > 0
            || visibleOutputChunks > 0
          ) {
            return;
          }

          initialHeadlessOutputReplayInFlight = true;
          invoke("terminal_headless_output_snapshot", {
            paneId,
            instanceId: terminalInstanceId,
          }).then((snapshot) => {
            if (
              isDisposed
              || outputBytes > 0
              || visibleOutputChunks > 0
              || Number(snapshot?.instanceId || 0) !== terminalInstanceId
            ) {
              return;
            }

            const bytes = decodeHeadlessOutputBase64(snapshot?.bytesBase64);
            if (!bytes.byteLength) {
              return;
            }

            initialHeadlessOutputReplayDone = true;
            if (terminalOutputWorkerSession?.enqueue(bytes, {
              active: terminalActiveRef.current === true,
              inspect: outputSessionInspectionEnabled,
            })) {
              return;
            }

            processTerminalOutputInline(bytes, performance.now());
          }).catch(() => {
            // The live output path remains authoritative; this is only a startup catch-up probe.
          }).finally(() => {
            initialHeadlessOutputReplayInFlight = false;
          });
        };
        const scheduleInitialHeadlessOutputReplay = (reason, delays = [260, 900]) => {
          delays.forEach((delayMs) => {
            const timer = window.setTimeout(() => {
              startupWatchTimers.delete(timer);
              requestInitialHeadlessOutputReplay(reason);
            }, delayMs);
            startupWatchTimers.add(timer);
          });
        };
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
            onThreadTerminalLifecycle?.({
              instanceId: terminalInstanceId,
              ...getTerminalNativeRailStateFields("exited"),
              paneId,
              terminalIndex,
              threadId: startupThreadId,
              type: "exited",
              workspaceId: workspace?.id || "",
            });
          }
        }));
        disposables.push(await listen(TERMINAL_INPUT_ERROR_EVENT, (event) => {
          if (
            event.payload?.paneId === paneId
            && event.payload?.instanceId === terminalInstanceId
            && !isDisposed
          ) {
            logBigViewSyncDiagnosticEvent("tui.text.pty_input_backend_error_event", {
              agentId: terminalAgentKind,
              instanceId: terminalInstanceId,
              message: event.payload?.message || "",
              paneId,
              terminalIndex,
              threadId: terminalThreadIdRef.current || "",
              workspaceId: workspace?.id || "",
            });
            setTerminalError(getErrorMessage(event.payload?.message, "Unable to write to terminal."));
          }
        }));
        let terminalInputBuffer = "";
        let terminalInputFlushTimer = 0;
        let terminalInputWriteChain = Promise.resolve();
        let terminalInputWriteQueue = [];
        let terminalInputWriteQueueTimer = 0;
        let terminalInputWriteQueueDraining = false;
        let terminalComposerDraftSyncTimer = 0;
        let terminalComposerDraftSyncPending = false;
        let terminalComposerDraftSyncValue = "";
        let terminalLastSelectionAt = 0;
        let terminalLastSelectionText = "";
        let terminalControlUiSuppressionUntilMs = 0;
        let terminalControlUiSuppressionReason = "";
        const setTerminalSubmittedComposerState = (nextState, reason = "unspecified") => {
          terminalSubmittedComposerState = nextState || createTerminalComposerState();
          terminalSubmittedInputText = getTerminalComposerText(terminalSubmittedComposerState);
          terminalSubmittedInputHasText = terminalSubmittedInputText.trim().length > 0;
          const traceComposerStateUpdate = !["terminal_input", "terminal_input_hot"].includes(reason);
          if (!traceComposerStateUpdate) {
            return;
          }
          logBigViewSyncDiagnosticEvent("tui.text.composer_state_updated", {
            agentId: terminalAgentKind,
            confidence: terminalSubmittedComposerState.confidence,
            cursorEnd: terminalSubmittedComposerState.cursorEnd,
            cursorStart: terminalSubmittedComposerState.cursorStart,
            draft: getBigViewTextDiagnosticFields(terminalSubmittedInputText),
            instanceId: terminalInstanceId,
            paneId,
            reason,
            revision: terminalSubmittedComposerState.revision,
            source: terminalSubmittedComposerState.source,
            terminalIndex,
            threadId: terminalThreadIdRef.current || "",
            workspaceId: workspace?.id || "",
          });
        };
        const getTerminalSelectionTextForComposer = () => {
          if (terminal?.hasSelection?.()) {
            const currentSelection = String(terminal.getSelection?.() || "").replace(/[\r\n]/g, "");
            if (currentSelection) {
              terminalLastSelectionAt = Date.now();
              terminalLastSelectionText = currentSelection;
              return currentSelection;
            }
          }

          if (terminalLastSelectionText && Date.now() - terminalLastSelectionAt < 1500) {
            return terminalLastSelectionText;
          }

          return "";
        };
        if (typeof terminal.onSelectionChange === "function") {
          disposables.push(terminal.onSelectionChange(() => {
            const selectionText = terminal?.hasSelection?.()
              ? String(terminal.getSelection?.() || "").replace(/[\r\n]/g, "")
              : "";
            if (selectionText) {
              terminalLastSelectionAt = Date.now();
              terminalLastSelectionText = selectionText;
            }
          }));
        }
        const syncCurrentTerminalComposerDraft = (value) => {
          if (isTerminalModelPickerUiPrompt(value)) {
            logBigViewSyncDiagnosticEvent("tui.text.control_ui_draft_sync_skip", {
              agentId: terminalAgentKind,
              draft: getBigViewTextDiagnosticFields(value),
              instanceId: terminalInstanceId,
              paneId,
              reason: "model_picker_ui_prompt",
              terminalIndex,
              threadId: terminalThreadIdRef.current || "",
              workspaceId: workspace?.id || "",
            });
            return;
          }
          setThreadComposerDraftValue(
            getCurrentThreadComposerSyncKey(terminalInstanceId),
            value,
            "terminal_input_observed",
          );
        };
        const flushCurrentTerminalComposerDraftSync = () => {
          if (!terminalComposerDraftSyncPending) {
            return;
          }
          if (terminalComposerDraftSyncTimer) {
            window.clearTimeout(terminalComposerDraftSyncTimer);
            terminalComposerDraftSyncTimer = 0;
          }
          terminalComposerDraftSyncPending = false;
          const pendingValue = terminalComposerDraftSyncValue;
          terminalComposerDraftSyncValue = "";
          syncCurrentTerminalComposerDraft(pendingValue);
        };
        const scheduleCurrentTerminalComposerDraftSync = (value, delayMs = 180) => {
          terminalComposerDraftSyncPending = true;
          terminalComposerDraftSyncValue = String(value || "");
          if (terminalComposerDraftSyncTimer) {
            window.clearTimeout(terminalComposerDraftSyncTimer);
          }
          terminalComposerDraftSyncTimer = window.setTimeout(() => {
            terminalComposerDraftSyncTimer = 0;
            terminalComposerDraftSyncPending = false;
            const pendingValue = terminalComposerDraftSyncValue;
            terminalComposerDraftSyncValue = "";
            syncCurrentTerminalComposerDraft(pendingValue);
          }, Math.max(0, Number(delayMs) || 0));
        };
        const isTerminalControlUiSuppressionActive = () => (
          terminalControlUiSuppressionUntilMs > Date.now()
        );
        const handleTerminalControlUiSuppression = (event) => {
          const detail = event?.detail || {};
          const requestedPaneId = String(detail.paneId || "");
          const requestedInstanceId = Number(detail.instanceId || 0);
          if (requestedPaneId && requestedPaneId !== paneId) {
            return;
          }
          if (
            Number.isFinite(requestedInstanceId)
            && requestedInstanceId > 0
            && requestedInstanceId !== Number(terminalInstanceId)
          ) {
            return;
          }

          const durationMs = Math.min(
            30000,
            Math.max(500, Number(detail.durationMs) || TERMINAL_CONTROL_UI_SUPPRESSION_DEFAULT_MS),
          );
          terminalControlUiSuppressionUntilMs = Math.max(
            terminalControlUiSuppressionUntilMs,
            Date.now() + durationMs,
          );
          terminalControlUiSuppressionReason = String(detail.reason || "terminal-control-ui");
          logBigViewSyncDiagnosticEvent("tui.text.control_ui_suppression_start", {
            agentId: terminalAgentKind,
            durationMs,
            instanceId: terminalInstanceId,
            paneId,
            reason: terminalControlUiSuppressionReason,
            terminalIndex,
            threadId: terminalThreadIdRef.current || "",
            workspaceId: workspace?.id || "",
          });
        };
        window.addEventListener(TERMINAL_CONTROL_UI_SUPPRESSION_EVENT, handleTerminalControlUiSuppression);
        disposables.push(() => {
          window.removeEventListener(TERMINAL_CONTROL_UI_SUPPRESSION_EVENT, handleTerminalControlUiSuppression);
        });
        const refreshTerminalComposerDraftFromStore = (reason = "unspecified") => {
          const syncKey = getCurrentThreadComposerSyncKey(terminalInstanceId);
          if (!syncKey) {
            return;
          }

          const storeHasDraft = threadComposerDraftsRef.current.has(syncKey);
          if (!storeHasDraft && !terminalSubmittedInputText) {
            return;
          }

          const previousDraft = terminalSubmittedInputText;
          const previousHadText = terminalSubmittedInputHasText;
          const nextDraft = storeHasDraft
            ? threadComposerDraftsRef.current.get(syncKey) || ""
            : "";
          if (isTerminalModelPickerUiPrompt(nextDraft)) {
            logBigViewSyncDiagnosticEvent("tui.text.control_ui_store_draft_clear", {
              agentId: terminalAgentKind,
              draft: getBigViewTextDiagnosticFields(nextDraft),
              instanceId: terminalInstanceId,
              paneId,
              reason,
              syncKey,
              terminalIndex,
              threadId: terminalThreadIdRef.current || "",
              workspaceId: workspace?.id || "",
            });
            setThreadComposerDraftValue(syncKey, "", "terminal_control_ui_store_clear");
            return;
          }
          setTerminalSubmittedComposerState(
            setTerminalComposerText(terminalSubmittedComposerState, nextDraft, {
              source: `store:${reason}`,
            }),
            `store:${reason}`,
          );
          if (
            previousDraft !== terminalSubmittedInputText
            || previousHadText !== terminalSubmittedInputHasText
          ) {
            logBigViewSyncDiagnosticEvent("tui.text.draft_refreshed_from_store", {
              agentId: terminalAgentKind,
              draftAfter: getBigViewTextDiagnosticFields(terminalSubmittedInputText),
              draftBefore: getBigViewTextDiagnosticFields(previousDraft),
              hadDraftAfter: terminalSubmittedInputHasText,
              hadDraftBefore: previousHadText,
              instanceId: terminalInstanceId,
              paneId,
              reason,
              storeHasDraft,
              syncKey,
              terminalIndex,
              threadId: terminalThreadIdRef.current || "",
              workspaceId: workspace?.id || "",
            });
          }
        };
        applyTerminalAudioInputChunk = (insertedText) => {
          const safeInsertedText = String(insertedText || "");
          if (!safeInsertedText || isGenericTerminal) {
            return;
          }

          refreshTerminalComposerDraftFromStore("audio_input_before_apply");
          const draftBeforeApply = terminalSubmittedInputText;
          const selectionText = getTerminalSelectionTextForComposer();
          if (terminalInputChunkHasVisibleText(safeInsertedText)) {
            terminalSubmittedInputHasText = true;
          }
          setTerminalSubmittedComposerState(
            applyTerminalInputChunkToComposer(
              terminalSubmittedComposerState,
              safeInsertedText,
              {
                selectionText,
                source: "audio_input",
              },
            ),
            "audio_input",
          );
          if (selectionText) {
            terminalLastSelectionAt = 0;
            terminalLastSelectionText = "";
          }
          syncCurrentTerminalComposerDraft(terminalSubmittedInputText);
          logBigViewSyncDiagnosticEvent("tui.audio.input_chunk_applied", {
            agentId: terminalAgentKind,
            composerConfidence: terminalSubmittedComposerState.confidence,
            composerRevision: terminalSubmittedComposerState.revision,
            draftAfter: getBigViewTextDiagnosticFields(terminalSubmittedInputText),
            draftBefore: getBigViewTextDiagnosticFields(draftBeforeApply),
            inputDebug: getTerminalInputDebugFields(safeInsertedText),
            instanceId: terminalInstanceId,
            paneId,
            selectionTextLength: selectionText.length,
            terminalIndex,
            threadId: terminalThreadIdRef.current || "",
            visibleText: getBigViewTextDiagnosticFields(terminalInputChunkVisibleText(safeInsertedText)),
            workspaceId: workspace?.id || "",
          });
        };
        while (pendingTerminalAudioInputChunks.length) {
          applyTerminalAudioInputChunk(pendingTerminalAudioInputChunks.shift());
        }
        const writeTerminalInputChunk = (data, reason, promptMetadata = null) => {
          const textData = String(data || "");
          const promptEventId = String(promptMetadata?.promptEventId || "").trim();
          const promptEventText = String(promptMetadata?.promptEventText || "").trim();
          const promptEventRevision = Number.parseInt(promptMetadata?.promptEventRevision, 10);
          const promptEventSource = String(promptMetadata?.promptEventSource || "").trim();
          const promptEventSubmittedAt = String(promptMetadata?.promptEventSubmittedAt || "").trim();
          const todoAction = String(promptMetadata?.todoAction || "").trim();
          const todoCommandId = String(promptMetadata?.todoCommandId || "").trim();
          const todoDispatchId = String(promptMetadata?.todoDispatchId || "").trim();
          const todoId = String(promptMetadata?.todoId || "").trim();
          const isEscapeInput = String(data || "").includes("\x1b");
          const isSubmitInput = terminalInputDataIsSubmit(textData);
          const isFocusEventInput = textData.includes("\x1b[I") || textData.includes("\x1b[O");
          if (typeof window !== "undefined") {
            const hotDurationMs = isSubmitInput ? 4500 : 2500;
            const hotUntil = Date.now() + hotDurationMs;
            window.__diffforgeTerminalInputHotUntil = Math.max(
              Number(window.__diffforgeTerminalInputHotUntil || 0),
              hotUntil,
            );
            window.dispatchEvent(new CustomEvent(TERMINAL_INPUT_HOT_EVENT, {
              detail: {
                hotUntil,
                instanceId: terminalInstanceId,
                isSubmitInput,
                paneId,
                reason,
                terminalIndex,
                workspaceId: workspace?.id || "",
              },
            }));
          }
          const tracePtyInputWrite = !isGenericTerminal
            && (
              textData.length > 1
              || isSubmitInput
              || isFocusEventInput
              || String(reason || "").includes("submit")
              || String(reason || "").includes("sync")
            );
          const escapeDebugFields = isEscapeInput
            ? {
              reason,
              terminalIndex,
              ...getTerminalInputDebugFields(data),
            }
            : null;

          handleSlashCommandDiagnosticInput(data, `pty_input_write:${reason}`);
          if (tracePtyInputWrite) {
            logBigViewSyncDiagnosticEvent("tui.text.pty_input_write_queued", {
              agentId: terminalAgentKind,
              draftBeforeWrite: getBigViewTextDiagnosticFields(terminalSubmittedInputText),
              hasOpenPty,
              inputDebug: getTerminalInputDebugFields(textData),
              instanceId: terminalInstanceId,
              isFocusEventInput,
              isSubmitInput,
              paneId,
              promptEventId,
              promptEventTextLength: promptEventText.length,
              reason,
              terminalIndex,
              threadId: terminalThreadIdRef.current || "",
              workspaceId: workspace?.id || "",
            });
          }

          const scheduleTerminalInputWriteQueueDrain = () => {
            if (terminalInputWriteQueueTimer || isDisposed) {
              return;
            }
            terminalInputWriteQueueTimer = window.setTimeout(() => {
              terminalInputWriteQueueTimer = 0;
              drainTerminalInputWriteQueue();
            }, 0);
          };
          const enqueueTerminalInputWrite = (invokeWrite, handleWriteError, waitForCompletion) => {
            let resolveQueuedWrite = null;
            const queuedWritePromise = new Promise((resolve) => {
              resolveQueuedWrite = resolve;
            });
            terminalInputWriteQueue.push({
              handleWriteError,
              invokeWrite,
              resolve: resolveQueuedWrite,
            });
            if (waitForCompletion) {
              drainTerminalInputWriteQueue();
            } else {
              scheduleTerminalInputWriteQueueDrain();
            }
            return waitForCompletion ? queuedWritePromise : Promise.resolve({ queued: true });
          };
          function drainTerminalInputWriteQueue() {
            if (terminalInputWriteQueueDraining || isDisposed) {
              return;
            }
            terminalInputWriteQueueDraining = true;
            const drainNext = () => {
              if (isDisposed) {
                terminalInputWriteQueue = [];
                terminalInputWriteQueueDraining = false;
                return Promise.resolve();
              }
              const entry = terminalInputWriteQueue.shift();
              if (!entry) {
                terminalInputWriteQueueDraining = false;
                return Promise.resolve();
              }
              return Promise.resolve()
                .then(entry.invokeWrite)
                .catch((error) => {
                  entry.handleWriteError?.(error);
                })
                .then((result) => {
                  entry.resolve?.(result);
                })
                .then(drainNext);
            };
            terminalInputWriteChain = terminalInputWriteChain
              .catch(() => {})
              .then(drainNext);
          }
          const invokeTerminalInputWrite = () => {
            if (escapeDebugFields) {
            }

            if (tracePtyInputWrite) {
              logBigViewSyncDiagnosticEvent("tui.text.pty_input_write_invoke", {
                agentId: terminalAgentKind,
                inputDebug: getTerminalInputDebugFields(textData),
                instanceId: terminalInstanceId,
                isFocusEventInput,
                isSubmitInput,
                paneId,
                promptEventId,
                promptEventTextLength: promptEventText.length,
                reason,
                terminalIndex,
                threadId: terminalThreadIdRef.current || "",
                workspaceId: workspace?.id || "",
              });
            }
            return sendTerminalInputPayload({
              paneId,
              instanceId: terminalInstanceId,
              data,
              promptEventId: promptEventId || undefined,
              promptEventRevision: Number.isFinite(promptEventRevision) ? promptEventRevision : undefined,
              promptEventSource: promptEventSource || undefined,
              promptEventSubmittedAt: promptEventSubmittedAt || undefined,
              promptEventText: promptEventText || undefined,
              todoAction: todoAction || undefined,
              todoCommandId: todoCommandId || undefined,
              todoDispatchId: todoDispatchId || undefined,
              todoId: todoId || undefined,
              threadId: terminalThreadIdRef.current,
            }, {
              waitForAck: serializeInputWrite,
            }).then((result) => {
              if (escapeDebugFields) {
              }

              if (tracePtyInputWrite) {
                logBigViewSyncDiagnosticEvent("tui.text.pty_input_write_done", {
                  agentId: terminalAgentKind,
                  inputDebug: getTerminalInputDebugFields(textData),
                  instanceId: terminalInstanceId,
                  isFocusEventInput,
                  isSubmitInput,
                  paneId,
                  promptEventId,
                  promptEventTextLength: promptEventText.length,
                  reason,
                  terminalIndex,
                  threadId: terminalThreadIdRef.current || "",
                  workspaceId: workspace?.id || "",
                });
              }
              return result;
            });
          };
          const handleTerminalInputWriteError = (error) => {
            if (escapeDebugFields) {
            }

            if (isTerminalSessionMissingError(error)) {
              return;
            }

            if (tracePtyInputWrite) {
              logBigViewSyncDiagnosticEvent("tui.text.pty_input_write_error", {
                agentId: terminalAgentKind,
                inputDebug: getTerminalInputDebugFields(textData),
                instanceId: terminalInstanceId,
                isFocusEventInput,
                isSubmitInput,
                message: error?.message || String(error || ""),
                paneId,
                promptEventId,
                promptEventTextLength: promptEventText.length,
                reason,
                terminalIndex,
                threadId: terminalThreadIdRef.current || "",
                workspaceId: workspace?.id || "",
              });
            }
            if (!isDisposed) {
              setTerminalError(getErrorMessage(error, "Unable to write to terminal."));
            }
          };
          const serializeInputWrite = isSubmitInput
            || Boolean(promptEventId || promptEventText)
            || String(reason || "").includes("submit")
            || String(reason || "").includes("sync")
            || String(reason || "").includes("flush_before");
          const queuedInputWrite = enqueueTerminalInputWrite(
            invokeTerminalInputWrite,
            handleTerminalInputWriteError,
            serializeInputWrite,
          );
          terminalInputWriteChain = queuedInputWrite.catch(() => {});
          if (data.length > 1) {
          }
          return queuedInputWrite;
        };
        const normalizeTerminalComposerObservation = (value) => String(value || "").replace(/\s+/g, "");
        const getTerminalComposerObservationText = () => {
          const activeBuffer = terminal?.buffer?.active;
          if (!activeBuffer) {
            return "";
          }

          const lineCount = activeBuffer.length || 0;
          const startLine = Math.max(0, lineCount - 80);
          const lines = [];
          for (let lineIndex = startLine; lineIndex < lineCount; lineIndex += 1) {
            const line = activeBuffer.getLine(lineIndex);
            if (line) {
              lines.push(line.translateToString(true));
            }
          }
          return lines.join("\n");
        };
        const getTerminalBufferText = (buffer, maxRows = 12, startLine = null) => {
          if (!buffer) {
            return "";
          }

          const lineCount = buffer.length || 0;
          const rowCount = Math.max(1, Number(maxRows) || 12);
          const firstLine = Number.isFinite(Number(startLine))
            ? Math.max(0, Number(startLine))
            : Math.max(0, lineCount - rowCount);
          const endLine = Math.min(lineCount, firstLine + rowCount);
          const lines = [];
          for (let lineIndex = firstLine; lineIndex < endLine; lineIndex += 1) {
            const line = buffer.getLine(lineIndex);
            if (line) {
              lines.push(line.translateToString(true));
            }
          }
          return lines.join("\n");
        };
        const normalizeTerminalPromptCompareText = (value) => String(value || "")
          .toLowerCase()
          .replace(/\s+/g, "");
        const getTerminalPromptWordSet = (value) => new Set(
          String(value || "")
            .toLowerCase()
            .match(/[a-z0-9_.-]{3,}/g) || [],
        );
        const terminalPromptCandidateIsPlausible = (candidate, expected) => {
          const safeCandidate = String(candidate || "").trim();
          const safeExpected = String(expected || "").trim();
          if (!safeCandidate) {
            return false;
          }
          if (isTerminalModelPickerUiPrompt(safeCandidate)) {
            return false;
          }
          if (isTerminalControlUiSuppressionActive()) {
            logBigViewSyncDiagnosticEvent("tui.text.control_ui_prompt_candidate_skip", {
              agentId: terminalAgentKind,
              candidate: getBigViewTextDiagnosticFields(safeCandidate),
              expectedLength: safeExpected.length,
              instanceId: terminalInstanceId,
              paneId,
              reason: terminalControlUiSuppressionReason || "terminal-control-ui",
              terminalIndex,
              threadId: terminalThreadIdRef.current || "",
              workspaceId: workspace?.id || "",
            });
            return false;
          }
          if (!safeExpected) {
            return true;
          }

          const candidateCompare = normalizeTerminalPromptCompareText(safeCandidate);
          const expectedCompare = normalizeTerminalPromptCompareText(safeExpected);
          if (candidateCompare === expectedCompare) {
            return true;
          }
          if (
            candidateCompare.length >= expectedCompare.length
            && candidateCompare.includes(expectedCompare.slice(0, Math.min(24, expectedCompare.length)))
          ) {
            return true;
          }
          const candidateCoverage = expectedCompare.length > 0
            ? candidateCompare.length / expectedCompare.length
            : 1;
          if (candidateCoverage < 0.75) {
            return false;
          }

          const candidateWords = getTerminalPromptWordSet(safeCandidate);
          const expectedWords = getTerminalPromptWordSet(safeExpected);
          if (!candidateWords.size || !expectedWords.size) {
            return false;
          }
          let overlap = 0;
          candidateWords.forEach((word) => {
            if (expectedWords.has(word)) {
              overlap += 1;
            }
          });
          return overlap / Math.max(candidateWords.size, expectedWords.size) >= 0.6;
        };
        const stripTerminalPromptLinePrefix = (rawLine) => {
          const text = String(rawLine || "")
            .replace(/\u00a0/g, " ")
            .replace(/[ \t]+$/g, "");
          const promptMatch = text.match(/^([ \t]*(?:[\u203a\u276f\u2771>]\s*)+)([\s\S]*)$/u);
          if (promptMatch) {
            return {
              prefixLength: promptMatch[1].length,
              promptText: promptMatch[2].trim(),
              rawText: text,
            };
          }

          const trimmedStartLength = text.length - text.trimStart().length;
          return {
            prefixLength: trimmedStartLength,
            promptText: text.trim(),
            rawText: text,
          };
        };
        const getTerminalActivePromptLineSnapshot = (expectedPrompt = "") => {
          const activeBuffer = terminal?.buffer?.active;
          if (!activeBuffer) {
            return null;
          }

          const lineCount = Number(activeBuffer.length || 0);
          if (!lineCount) {
            return null;
          }

          const cursorLine = Math.min(
            lineCount - 1,
            Math.max(0, Number(activeBuffer.baseY || 0) + Number(activeBuffer.cursorY || 0)),
          );
          let startLine = cursorLine;
          while (startLine > 0 && activeBuffer.getLine(startLine)?.isWrapped) {
            startLine -= 1;
          }
          let endLine = cursorLine;
          while (endLine + 1 < lineCount && activeBuffer.getLine(endLine + 1)?.isWrapped) {
            endLine += 1;
          }

          const rowTexts = [];
          for (let lineIndex = startLine; lineIndex <= endLine; lineIndex += 1) {
            const line = activeBuffer.getLine(lineIndex);
            if (!line) {
              rowTexts.push("");
              continue;
            }
            rowTexts.push(line.translateToString(lineIndex === endLine).replace(/\u00a0/g, " "));
          }

          const stripped = stripTerminalPromptLinePrefix(rowTexts.join(""));
          if (
            !stripped.promptText
            || !terminalPromptCandidateIsPlausible(stripped.promptText, expectedPrompt)
          ) {
            return {
              activeBufferBaseY: Number(activeBuffer.baseY || 0),
              activeBufferCursorX: Number(activeBuffer.cursorX || 0),
              activeBufferCursorY: Number(activeBuffer.cursorY || 0),
              endLine,
              plausible: false,
              promptStartOffset: stripped.prefixLength,
              promptText: stripped.promptText,
              rawText: stripped.rawText,
              rowTexts,
              startLine,
            };
          }

          return {
            activeBufferBaseY: Number(activeBuffer.baseY || 0),
            activeBufferCursorX: Number(activeBuffer.cursorX || 0),
            activeBufferCursorY: Number(activeBuffer.cursorY || 0),
            endLine,
            plausible: true,
            promptStartOffset: stripped.prefixLength,
            promptText: stripped.promptText,
            rawText: stripped.rawText,
            rowTexts,
            startLine,
          };
        };
        const getTerminalSelectionPromptRange = (lineSnapshot) => {
          if (!lineSnapshot || !terminal?.getSelectionPosition) {
            return null;
          }
          const position = terminal.getSelectionPosition();
          if (!position) {
            return null;
          }

          const activeBuffer = terminal?.buffer?.active;
          const rowCandidates = (row) => [
            Number(row),
            Number(activeBuffer?.viewportY || 0) + Number(row),
            Number(activeBuffer?.baseY || 0) + Number(row),
          ].filter(Number.isFinite);
          const resolveRow = (row) => rowCandidates(row).find((candidate) => (
            candidate >= lineSnapshot.startLine && candidate <= lineSnapshot.endLine
          ));
          const startRow = resolveRow(position.startRow);
          const endRow = resolveRow(position.endRow);
          if (!Number.isFinite(startRow) || !Number.isFinite(endRow)) {
            return null;
          }

          const rowOffset = (row, column) => {
            let offset = 0;
            for (let lineIndex = lineSnapshot.startLine; lineIndex < row; lineIndex += 1) {
              offset += String(lineSnapshot.rowTexts[lineIndex - lineSnapshot.startLine] || "").length;
            }
            return offset + Math.max(0, Number(column) || 0);
          };
          const rawStart = rowOffset(startRow, position.startColumn);
          const rawEnd = rowOffset(endRow, position.endColumn);
          const promptStart = Math.max(0, Number(lineSnapshot.promptStartOffset) || 0);
          const promptLength = String(lineSnapshot.promptText || "").length;
          const start = Math.max(0, Math.min(promptLength, Math.min(rawStart, rawEnd) - promptStart));
          const end = Math.max(0, Math.min(promptLength, Math.max(rawStart, rawEnd) - promptStart));
          if (end <= start) {
            return null;
          }
          return { end, start };
        };
        const getTerminalPromptTextForSubmit = (composerText) => {
          const safeComposerText = String(composerText || "").trim();
          const lineSnapshot = getTerminalActivePromptLineSnapshot(safeComposerText);
          const screenPrompt = String(lineSnapshot?.promptText || "").trim();
          const composerCompare = normalizeTerminalPromptCompareText(safeComposerText);
          const screenCompare = normalizeTerminalPromptCompareText(screenPrompt);
          const screenConfirmsComposer = Boolean(
            composerCompare
              && screenCompare
              && (
                screenCompare === composerCompare
                || (
                  screenCompare.length >= composerCompare.length
                  && screenCompare.includes(composerCompare)
                )
              ),
          );
          const useScreenPrompt = Boolean(
            lineSnapshot?.plausible
              && screenPrompt
              && (!safeComposerText || screenConfirmsComposer),
          );
          return {
            lineSnapshot,
            promptText: useScreenPrompt ? screenPrompt : safeComposerText,
            source: useScreenPrompt
              ? normalizeTerminalPromptCompareText(screenPrompt) === normalizeTerminalPromptCompareText(safeComposerText)
                ? "terminal_screen_confirmed"
                : "terminal_screen_reconciled"
              : "composer_state",
            usedTerminalScreen: useScreenPrompt,
          };
        };
        const getTerminalBufferTailText = (maxRows = 12) => (
          getTerminalBufferText(terminal?.buffer?.active, maxRows)
        );
        const getTerminalViewportText = (maxRows = 12) => {
          const activeBuffer = terminal?.buffer?.active;
          return getTerminalBufferText(
            activeBuffer,
            Math.min(Math.max(1, Number(maxRows) || 12), Number(terminal?.rows || maxRows || 12)),
            Number(activeBuffer?.viewportY || 0),
          );
        };
        const getTerminalControlUiPromptSnapshot = () => {
          const tailText = getTerminalBufferTailText(12);
          const viewportText = getTerminalViewportText(12);
          const active = isTerminalModelPickerUiPrompt(viewportText)
            || isTerminalModelPickerUiPrompt(tailText);
          return {
            active,
            tailText,
            viewportText,
          };
        };
        const getTerminalDomInputSnapshot = () => {
          const textarea = container?.querySelector?.("textarea");
          const activeElement = typeof document !== "undefined" ? document.activeElement : null;
          return {
            activeElementClass: String(activeElement?.className || ""),
            activeElementTag: String(activeElement?.tagName || ""),
            terminalElementText: getBigViewTextDiagnosticFields(terminal?.element?.textContent || "", {
              previewLength: 160,
            }),
            textareaFocused: Boolean(textarea && textarea === activeElement),
            textareaSelectionEnd: Number(textarea?.selectionEnd || 0),
            textareaSelectionStart: Number(textarea?.selectionStart || 0),
            textareaValue: getBigViewTextDiagnosticFields(textarea?.value || "", {
              previewLength: 120,
            }),
          };
        };
        const logTerminalSubmitDiagnosticSnapshot = (detail = {}) => {
          const requestedPaneId = String(
            detail.paneId || detail.bindingPaneId || "",
          ).trim();
          const requestedInstanceId = Number(
            detail.instanceId || detail.bindingInstanceId || 0,
          );
          if (requestedPaneId && requestedPaneId !== paneId) {
            return;
          }
          if (
            Number.isFinite(requestedInstanceId)
            && requestedInstanceId > 0
            && requestedInstanceId !== Number(terminalInstanceId)
          ) {
            return;
          }

          const delayMs = Math.max(0, Number(detail.delayMs) || 0);
          if (delayMs > 0) {
            window.setTimeout(() => {
              logTerminalSubmitDiagnosticSnapshot({
                ...detail,
                delayMs: 0,
                delayedFromMs: delayMs,
              });
            }, delayMs);
            return;
          }

          const syncKey = String(
            detail.syncKey || getCurrentThreadComposerSyncKey(terminalInstanceId) || "",
          );
          const expectedPrompt = String(detail.expectedPrompt || "").trim();
          const observedText = getTerminalComposerObservationText();
          const observed = normalizeTerminalComposerObservation(observedText);
          const expected = normalizeTerminalComposerObservation(expectedPrompt);
          const expectedHead = expected.slice(0, Math.min(96, expected.length));
          const expectedTail = expected.slice(Math.max(0, expected.length - 96));
          const activeBuffer = terminal?.buffer?.active;
          const draftStoreValue = syncKey
            ? String(threadComposerDraftsRef.current.get(syncKey) || "")
            : "";

          logBigViewSyncDiagnosticEvent("tui.text.submit_state_snapshot", {
            agentId: terminalAgentKind,
            activeBufferBaseY: Number(activeBuffer?.baseY || 0),
            activeBufferCursorX: Number(activeBuffer?.cursorX || 0),
            activeBufferCursorY: Number(activeBuffer?.cursorY || 0),
            activeBufferLength: Number(activeBuffer?.length || 0),
            activeBufferType: String(activeBuffer?.type || ""),
            activeBufferViewportY: Number(activeBuffer?.viewportY || 0),
            alternateBufferTail: getBigViewTextDiagnosticFields(
              getTerminalBufferText(terminal?.buffer?.alternate, 12),
              { previewLength: 180 },
            ),
            delayedFromMs: detail.delayedFromMs || 0,
            domInput: getTerminalDomInputSnapshot(),
            draftStore: getBigViewTextDiagnosticFields(draftStoreValue),
            expectedHeadPresent: Boolean(expectedHead) && observed.includes(expectedHead),
            expectedPrompt: getBigViewTextDiagnosticFields(expectedPrompt),
            expectedTailPresent: Boolean(expectedTail) && observed.includes(expectedTail),
            hasOpenPty,
            isDisposed,
            isGenericTerminal,
            observedContainsFullExpected: Boolean(expected) && observed.includes(expected),
            observedNormalizedLength: observed.length,
            paneId,
            parkedPromptPresent: Boolean(parkedPromptRef.current),
            promptId: detail.promptId || "",
            reason: detail.reason || "",
            requestedAtMs: detail.requestedAtMs || 0,
            normalBufferTail: getBigViewTextDiagnosticFields(
              getTerminalBufferText(terminal?.buffer?.normal, 12),
              { previewLength: 180 },
            ),
            screenTail: getBigViewTextDiagnosticFields(getTerminalBufferTailText(12), {
              previewLength: 180,
            }),
            source: detail.source || "frontend",
            submitSequenceLength: detail.submitSequenceLength || "",
            syncKey,
            targetTerminalIndex: detail.targetTerminalIndex ?? terminalIndex,
            terminalIndex,
            terminalInstanceId,
            terminalSubmittedDraft: getBigViewTextDiagnosticFields(terminalSubmittedInputText),
            threadId: terminalThreadIdRef.current || detail.threadId || "",
            viewportText: getBigViewTextDiagnosticFields(getTerminalViewportText(12), {
              previewLength: 180,
            }),
            workspaceId: workspace?.id || detail.workspaceId || "",
          });
        };
        const handleTerminalSubmitDiagnosticSnapshotRequest = (event) => {
          logTerminalSubmitDiagnosticSnapshot(event?.detail || {});
        };
        window.addEventListener(
          TERMINAL_SUBMIT_DIAGNOSTIC_SNAPSHOT_REQUEST_EVENT,
          handleTerminalSubmitDiagnosticSnapshotRequest,
        );
        disposables.push(() => {
          window.removeEventListener(
            TERMINAL_SUBMIT_DIAGNOSTIC_SNAPSHOT_REQUEST_EVENT,
            handleTerminalSubmitDiagnosticSnapshotRequest,
          );
        });
        const waitForTerminalComposerMessageObserved = (expectedMessage, fields = {}) => {
          const expected = normalizeTerminalComposerObservation(expectedMessage);
          const expectedNeedle = expected.slice(Math.max(0, expected.length - 96));
          const startedAt = Date.now();
          const timeoutMs = 900;
          const maxBacklogTimeoutMs = 8000;
          const pollMs = 25;

          logBigViewSyncDiagnosticEvent("tui.image.submit_wait_observed_start", {
            ...fields,
            expectedLength: expected.length,
            expectedNeedleLength: expectedNeedle.length,
            maxBacklogTimeoutMs,
            timeoutMs,
          });

          return new Promise((resolve) => {
            const poll = () => {
              const observedText = getTerminalComposerObservationText();
              const observed = normalizeTerminalComposerObservation(observedText);
              const matched = Boolean(expectedNeedle) && observed.includes(expectedNeedle);
              const elapsedMs = Date.now() - startedAt;
              const outputBacklogActive = pendingOutputBytes > 0 || outputWriteInFlight;
              const timedOut = elapsedMs >= timeoutMs
                && (!outputBacklogActive || elapsedMs >= maxBacklogTimeoutMs);

              if (matched || timedOut || isDisposed) {
                logBigViewSyncDiagnosticEvent("tui.image.submit_wait_observed_done", {
                  ...fields,
                  elapsedMs,
                  expectedLength: expected.length,
                  expectedNeedleLength: expectedNeedle.length,
                  maxBacklogTimeoutMs,
                  matched,
                  observedLength: observed.length,
                  outputBacklogActive,
                  pendingOutputBytes,
                  pendingOutputWrites: pendingOutputWrites.length,
                  timedOut: !matched && timedOut,
                });
                resolve(matched);
                return;
              }

              window.setTimeout(poll, outputBacklogActive ? Math.max(pollMs, 50) : pollMs);
            };

            poll();
          });
        };
        const takeTerminalInputBuffer = () => {
          if (terminalInputFlushTimer) {
            window.clearTimeout(terminalInputFlushTimer);
            terminalInputFlushTimer = 0;
          }
          const queuedData = terminalInputBuffer;
          terminalInputBuffer = "";
          return queuedData;
        };
        const writeBufferedTerminalInput = (queuedData, reason, promptMetadata = null) => {
          if (!queuedData || !hasOpenPty || isDisposed) {
            return terminalInputWriteChain;
          }
          return writeTerminalInputChunk(queuedData, reason, promptMetadata);
        };
        const flushTerminalInput = (reason, promptMetadata = null) => (
          writeBufferedTerminalInput(takeTerminalInputBuffer(), reason, promptMetadata)
        );
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
          if (terminalInputWriteQueueTimer) {
            window.clearTimeout(terminalInputWriteQueueTimer);
            terminalInputWriteQueueTimer = 0;
          }
          if (terminalComposerDraftSyncTimer) {
            window.clearTimeout(terminalComposerDraftSyncTimer);
            terminalComposerDraftSyncTimer = 0;
          }
          terminalInputBuffer = "";
          terminalInputWriteQueue = [];
          terminalComposerDraftSyncPending = false;
          terminalComposerDraftSyncValue = "";
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

          flushCurrentTerminalComposerDraftSync();
          refreshTerminalComposerDraftFromStore("shift_enter_before_update");
          flushTerminalInput("shift_enter_flush_before");
          setTerminalSubmittedComposerState(
            applyTerminalInputChunkToComposer(
              terminalSubmittedComposerState,
              "\n",
              {
                insertNewline: true,
                source: "shift_enter",
              },
            ),
            "shift_enter",
          );
          syncCurrentTerminalComposerDraft(terminalSubmittedInputText);
          writeTerminalInputChunk(TERMINAL_SHIFT_ENTER_SEQUENCE, "shift_enter");
          return true;
        };
        const submitTerminalComposerWithQueuedImages = (submitInput) => {
          const syncKey = getCurrentThreadComposerSyncKey(terminalInstanceId);
          const attachments = getWorkspaceThreadComposerAttachments(syncKey);
          if (!attachments.length) {
            return false;
          }

          flushCurrentTerminalComposerDraftSync();
          refreshTerminalComposerDraftFromStore("image_submit_before_submit");
          flushTerminalInput("image_submit_flush_before");
          const promptResolution = getTerminalPromptTextForSubmit(terminalSubmittedInputText);
          const controlUiSnapshot = getTerminalControlUiPromptSnapshot();
          if (
            isTerminalControlHistoryPrompt(promptResolution.promptText)
            || controlUiSnapshot.active
          ) {
            logBigViewSyncDiagnosticEvent("tui.image.control_ui_submit_skip", {
              agentId: terminalAgentKind,
              instanceId: terminalInstanceId,
              paneId,
              promptResolutionSource: promptResolution.source,
              reason: controlUiSnapshot.active ? "control_viewport_prompt" : "control_history_prompt",
              promptText: getBigViewTextDiagnosticFields(promptResolution.promptText),
              terminalIndex,
              threadId: terminalThreadIdRef.current || "",
              workspaceId: workspace?.id || "",
            });
            return false;
          }
          if (
            promptResolution.usedTerminalScreen
            && promptResolution.promptText
            && promptResolution.promptText !== terminalSubmittedInputText.trim()
          ) {
            setTerminalSubmittedComposerState(
              setTerminalComposerText(terminalSubmittedComposerState, promptResolution.promptText, {
                confidence: "certain",
                source: promptResolution.source,
              }),
              promptResolution.source,
            );
            syncCurrentTerminalComposerDraft(terminalSubmittedInputText);
          }
          const promptText = promptResolution.promptText;
          logBigViewSyncDiagnosticEvent("tui.image.submit_start", {
            agentId: terminalAgentKind,
            attachmentCount: attachments.length,
            hasPromptText: Boolean(promptText),
            instanceId: terminalInstanceId,
            paneId,
            promptResolutionSource: promptResolution.source,
            syncKey,
            terminalIndex,
            threadId: terminalThreadIdRef.current || "",
            workspaceId: workspace?.id || "",
          });
          saveTerminalImageAttachments(attachments)
            .then((imageBlock) => {
              const message = [promptText, imageBlock].filter(Boolean).join("\n\n");
              if (!message) {
                return;
              }

              const submitSequence = submitInput || getTerminalSubmitSequence(
                terminalAgentKind,
                isGenericTerminal,
              );
              const syncData = buildTerminalComposerDraftInput(promptText, message, true);
              setTerminalSubmittedComposerState(
                setTerminalComposerText(terminalSubmittedComposerState, "", {
                  cursor: 0,
                  source: "image_submit_sync_full",
                }),
                "image_submit_sync_full",
              );
              setThreadComposerDraftValue(syncKey, message, "tui_image_submit_sync_full");
              logBigViewSyncDiagnosticEvent("tui.image.submit_sync_start", {
                agentId: terminalAgentKind,
                attachmentCount: attachments.length,
                imageBlockLength: imageBlock.length,
                instanceId: terminalInstanceId,
                messageLength: message.length,
                paneId,
                promptTextLength: promptText.length,
                syncDataLength: syncData.length,
                syncKey,
                terminalIndex,
                threadId: terminalThreadIdRef.current || "",
                workspaceId: workspace?.id || "",
              });
              writeTerminalInputChunk(syncData, "image_submit_sync_full")
                .then(() => {
                  const waitFields = {
                    agentId: terminalAgentKind,
                    attachmentCount: attachments.length,
                    imageBlockLength: imageBlock.length,
                    instanceId: terminalInstanceId,
                    messageLength: message.length,
                    paneId,
                    promptTextLength: promptText.length,
                    syncKey,
                    terminalIndex,
                    threadId: terminalThreadIdRef.current || "",
                    workspaceId: workspace?.id || "",
                  };
                  return waitForTerminalComposerMessageObserved(message, waitFields);
                })
                .then((observedMatch) => {
                  logBigViewSyncDiagnosticEvent("tui.image.submit_enter_write", {
                    agentId: terminalAgentKind,
                    attachmentCount: attachments.length,
                    composerObservedBeforeEnter: observedMatch,
                    instanceId: terminalInstanceId,
                    paneId,
                    submitSequenceLength: submitSequence.length,
                    syncKey,
                    terminalIndex,
                    threadId: terminalThreadIdRef.current || "",
                    workspaceId: workspace?.id || "",
                  });
                  return writeTerminalInputChunk(submitSequence, "image_submit_enter");
                })
                .then(() => {
                  syncCurrentTerminalComposerDraft("");
                  setWorkspaceThreadComposerAttachments(syncKey, [], {
                    fields: {
                      agentId: terminalAgentKind,
                      paneId,
                      surface: "tui_terminal",
                      terminalIndex,
                      threadId: terminalThreadIdRef.current || "",
                      workspaceId: workspace?.id || "",
                    },
                    reason: "tui_submit_done_clear",
                    source: "tui_terminal",
                  });
                  recordSubmittedAgentMessage(terminalInstanceId, message);
                  logBigViewSyncDiagnosticEvent("tui.image.submit_done", {
                    agentId: terminalAgentKind,
                    attachmentCount: attachments.length,
                    imageBlockLength: imageBlock.length,
                    instanceId: terminalInstanceId,
                    messageLength: message.length,
                    paneId,
                    syncKey,
                    terminalIndex,
                    threadId: terminalThreadIdRef.current || "",
                    workspaceId: workspace?.id || "",
                  });
                });
            })
            .catch((error) => {
              setTerminalError(getErrorMessage(error, "Unable to submit queued image."));
              logBigViewSyncDiagnosticEvent("tui.image.submit_error", {
                agentId: terminalAgentKind,
                attachmentCount: attachments.length,
                instanceId: terminalInstanceId,
                message: error?.message || String(error || ""),
                paneId,
                syncKey,
                terminalIndex,
                threadId: terminalThreadIdRef.current || "",
                workspaceId: workspace?.id || "",
              });
            });
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

          const terminalGeneratedReply = isTerminalGeneratedReplyInput(safeData);
          const startupControlReply = !hasOpenPty
            && startupControlReplyBridgeOpen
            && terminalGeneratedReply;

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

          const isSubmitInput = terminalInputDataIsSubmit(safeData);
          const visibleInputText = terminalGeneratedReply
            ? ""
            : terminalInputChunkVisibleText(safeData);
          const isFocusEventInput = safeData.includes("\x1b[I") || safeData.includes("\x1b[O");
          if (
            !startupControlReply
            && !terminalGeneratedReply
            && isFocusEventInput
            && !isSubmitInput
            && !visibleInputText
          ) {
            return;
          }
          if (!startupControlReply && !terminalGeneratedReply && (isSubmitInput || visibleInputText)) {
            noteTerminalInteractiveInput(
              isSubmitInput ? "submit" : "input",
              isSubmitInput ? 1400 : 900,
            );
          }
          let confirmedSubmitBridge = null;
          const traceTextInputChunk = !startupControlReply
            && !terminalGeneratedReply
            && (
              safeData.length > 1
              || isSubmitInput
              || visibleInputText.length > 80
              || isFocusEventInput
              || safeData.includes("\x1b[200~")
              || safeData.includes("\x1b[201~")
            );

          if (traceTextInputChunk) {
            logBigViewSyncDiagnosticEvent("tui.text.input_chunk_received", {
              agentId: terminalAgentKind,
              draftBefore: getBigViewTextDiagnosticFields(terminalSubmittedInputText),
              hadDraftBefore: terminalSubmittedInputHasText,
              inputDebug: getTerminalInputDebugFields(safeData),
              isFocusEventInput,
              instanceId: terminalInstanceId,
              isSubmitInput,
              paneId,
              rawText: getBigViewTextDiagnosticFields(safeData),
              startupControlReply,
              terminalIndex,
              terminalGeneratedReply,
              threadId: terminalThreadIdRef.current || "",
              visibleText: getBigViewTextDiagnosticFields(visibleInputText),
              workspaceId: workspace?.id || "",
            });
          }

          const controlUiPromptSnapshot = !startupControlReply && !terminalGeneratedReply && !isGenericTerminal
            ? getTerminalControlUiPromptSnapshot()
            : null;
          const isControlUiPromptActive = Boolean(controlUiPromptSnapshot?.active);
          const shouldDeferComposerDraftSync = !startupControlReply
            && !terminalGeneratedReply
            && !isSubmitInput
            && !isControlUiPromptActive;
          if (
            !startupControlReply
            && !terminalGeneratedReply
            && terminalInputChunkHasVisibleText(safeData)
          ) {
            if (isControlUiPromptActive) {
              logBigViewSyncDiagnosticEvent("tui.text.control_ui_input_passthrough", {
                agentId: terminalAgentKind,
                inputDebug: getTerminalInputDebugFields(safeData),
                instanceId: terminalInstanceId,
                paneId,
                terminalIndex,
                threadId: terminalThreadIdRef.current || "",
                visibleText: getBigViewTextDiagnosticFields(visibleInputText),
                workspaceId: workspace?.id || "",
              });
            } else {
              if (!shouldDeferComposerDraftSync) {
                refreshTerminalComposerDraftFromStore("visible_input_before_apply");
              }
              terminalSubmittedInputHasText = true;
            }
          }
          if (!startupControlReply && !terminalGeneratedReply && isControlUiPromptActive) {
            if (terminalSubmittedInputText || terminalSubmittedInputHasText) {
              setTerminalSubmittedComposerState(
                setTerminalComposerText(terminalSubmittedComposerState, "", {
                  cursor: 0,
                  source: "control_ui_input_passthrough_clear",
                }),
                "control_ui_input_passthrough_clear",
              );
              syncCurrentTerminalComposerDraft("");
            }
          } else if (!startupControlReply && !terminalGeneratedReply) {
            if (shouldDeferComposerDraftSync) {
              const syncKey = getCurrentThreadComposerSyncKey(terminalInstanceId);
              const storeHasDraft = Boolean(syncKey && threadComposerDraftsRef.current.has(syncKey));
              if (storeHasDraft && !terminalSubmittedInputText) {
                refreshTerminalComposerDraftFromStore("input_before_apply");
              }
            } else {
              flushCurrentTerminalComposerDraftSync();
              refreshTerminalComposerDraftFromStore("input_before_apply");
            }
            const draftBeforeApply = terminalSubmittedInputText;
            const selectionText = getTerminalSelectionTextForComposer();
            setTerminalSubmittedComposerState(
              applyTerminalInputChunkToComposer(
                terminalSubmittedComposerState,
                safeData,
                {
                  selectionText,
                  source: isSubmitInput
                    ? "submit_boundary"
                    : safeData.startsWith("\x1b")
                      ? "escape_sequence"
                    : "terminal_input",
                },
              ),
              isSubmitInput ? "submit_boundary" : shouldDeferComposerDraftSync ? "terminal_input_hot" : "terminal_input",
            );
            if (selectionText) {
              terminalLastSelectionAt = 0;
              terminalLastSelectionText = "";
            }
            if (shouldDeferComposerDraftSync) {
              scheduleCurrentTerminalComposerDraftSync(terminalSubmittedInputText);
            } else {
              syncCurrentTerminalComposerDraft(terminalSubmittedInputText);
            }
            if (traceTextInputChunk) {
              logBigViewSyncDiagnosticEvent("tui.text.input_chunk_applied", {
                agentId: terminalAgentKind,
                composerConfidence: terminalSubmittedComposerState.confidence,
                composerCursorEnd: terminalSubmittedComposerState.cursorEnd,
                composerCursorStart: terminalSubmittedComposerState.cursorStart,
                composerRevision: terminalSubmittedComposerState.revision,
                draftAfter: getBigViewTextDiagnosticFields(terminalSubmittedInputText),
                draftBefore: getBigViewTextDiagnosticFields(draftBeforeApply),
                hadDraftAfter: terminalSubmittedInputHasText,
                inputDebug: getTerminalInputDebugFields(safeData),
                isFocusEventInput,
                instanceId: terminalInstanceId,
                isSubmitInput,
                paneId,
                rawText: getBigViewTextDiagnosticFields(safeData),
                selectionTextLength: selectionText.length,
                startupControlReply,
                terminalIndex,
                terminalGeneratedReply,
                threadId: terminalThreadIdRef.current || "",
                visibleText: getBigViewTextDiagnosticFields(visibleInputText),
                workspaceId: workspace?.id || "",
              });
            }
          }
          if (!startupControlReply && !terminalGeneratedReply && isSubmitInput) {
            flushCurrentTerminalComposerDraftSync();
            if (submitTerminalComposerWithQueuedImages(safeData)) {
              return;
            }
            logBigViewSyncDiagnosticEvent("tui.text.submit_boundary", {
              agentId: terminalAgentKind,
              draftAtSubmit: getBigViewTextDiagnosticFields(terminalSubmittedInputText),
              hasQueuedPromptForRecord: terminalSubmittedInputHasText,
              inputDebug: getTerminalInputDebugFields(safeData),
              isFocusEventInput,
              instanceId: terminalInstanceId,
              paneId,
              rawText: getBigViewTextDiagnosticFields(safeData),
              startupControlReply,
              terminalIndex,
              terminalGeneratedReply,
              threadId: terminalThreadIdRef.current || "",
              visibleText: getBigViewTextDiagnosticFields(visibleInputText),
              workspaceId: workspace?.id || "",
            });
            const submitPromptResolution = getTerminalPromptTextForSubmit(terminalSubmittedInputText);
            const submitControlUiSnapshot = getTerminalControlUiPromptSnapshot();
            const isControlViewportPrompt = Boolean(submitControlUiSnapshot.active);
            const isControlSuppressedScreenSubmit = Boolean(
              submitPromptResolution.source === "terminal_screen_reconciled"
              && isTerminalControlUiSuppressionActive()
            );
            if (
              !isControlViewportPrompt
              && !isControlSuppressedScreenSubmit
              && submitPromptResolution.usedTerminalScreen
              && submitPromptResolution.promptText
              && submitPromptResolution.promptText !== terminalSubmittedInputText.trim()
            ) {
              setTerminalSubmittedComposerState(
                setTerminalComposerText(terminalSubmittedComposerState, submitPromptResolution.promptText, {
                  confidence: "certain",
                  source: submitPromptResolution.source,
                }),
                submitPromptResolution.source,
              );
              syncCurrentTerminalComposerDraft(terminalSubmittedInputText);
            }
            const promptTextAtSubmit = submitPromptResolution.promptText;
            const isControlHistoryPrompt = isTerminalControlHistoryPrompt(promptTextAtSubmit);
            const shouldSuppressSubmitLifecycle = Boolean(
              isControlHistoryPrompt
              || isControlViewportPrompt
              || isControlSuppressedScreenSubmit
            );
            if (
              terminalSubmittedInputHasText
              && promptTextAtSubmit
              && !shouldSuppressSubmitLifecycle
              && !isGenericTerminal
            ) {
              const promptId = createThreadProjectionToken("terminal-prompt");
              const startedAt = new Date().toISOString();
              const observedPromptEventSource = submitPromptResolution.usedTerminalScreen
                ? `tui-manual-input:${submitPromptResolution.source}`
                : "tui-manual-input";
              const promptEventSource = TODO_QUEUE_SOURCE_TERMINAL_DIRECT;
              const terminalDirectTodoRefs = getTerminalDirectTodoRefs(promptId);
              const promptSnapshot = getTerminalComposerSnapshot(terminalSubmittedComposerState, {
                promptEventId: promptId,
                source: promptEventSource,
                submittedAt: startedAt,
              });
              const turnId = `turn-${promptId}`;
              const threadId = terminalThreadIdRef.current || "";
              const workspaceId = workspace?.id || "";
              const syncKey = getCurrentThreadComposerSyncKey(terminalInstanceId);
              const submittedWaiterReady = createTerminalPromptSubmittedWaiter({
                // Manually typed prompts carry synthetic terminal-direct todo
                // refs, so the Rust write observer marks them seen and the
                // UserPromptSubmit hook never re-emits a prompt-submitted
                // event. The terminal write confirmation is the only
                // immediate signal that can arrive for hook-managed agents
                // here; without it this waiter times out and the typed prompt
                // never reaches todo history.
                allowObservedInputGateForHookManaged: true,
                agentId: terminalAgentKind,
                expectedPrompt: promptTextAtSubmit,
                instanceId: terminalInstanceId,
                paneId,
                promptId,
                threadId,
                workspaceId,
              });
              const acceptedWaiter = createWorkspaceThreadPromptAcceptedWaiter({
                agentId: terminalAgentKind,
                expectedPrompt: promptTextAtSubmit,
                promptId,
                threadId,
                workspaceId,
              });
              confirmedSubmitBridge = {
                acceptedWaiter,
                promptEventId: promptId,
                promptEventRevision: promptSnapshot.revision,
                promptEventSource: promptSnapshot.source,
                promptEventSubmittedAt: promptSnapshot.submittedAt,
                promptEventText: promptTextAtSubmit,
                promptSnapshot,
                startedAt,
                submittedWaiterReady,
                syncKey,
                threadId,
                todoAction: terminalDirectTodoRefs?.todoAction || "",
                todoCommandId: terminalDirectTodoRefs?.todoCommandId || "",
                todoDispatchId: terminalDirectTodoRefs?.todoDispatchId || "",
                todoId: terminalDirectTodoRefs?.todoId || "",
                turnId,
                workspaceId,
              };
              logBigViewSyncDiagnosticEvent("tui.text.confirmed_submit_bridge_start", {
                agentId: terminalAgentKind,
                instanceId: terminalInstanceId,
                paneId,
                promptEventId: promptId,
                promptRevision: promptSnapshot.revision,
                promptSource: promptSnapshot.source,
                observedPromptSource: observedPromptEventSource,
                promptResolutionSource: submitPromptResolution.source,
                screenPrompt: getBigViewTextDiagnosticFields(
                  submitPromptResolution.lineSnapshot?.promptText || "",
                ),
                promptText: getBigViewTextDiagnosticFields(promptTextAtSubmit),
                syncKey,
                terminalIndex,
                threadId,
                workspaceId,
              });
            } else if (terminalSubmittedInputHasText && shouldSuppressSubmitLifecycle) {
              logBigViewSyncDiagnosticEvent("tui.text.control_ui_submit_bridge_skip", {
                agentId: terminalAgentKind,
                instanceId: terminalInstanceId,
                paneId,
                promptResolutionSource: submitPromptResolution.source,
                reason: isControlViewportPrompt
                  ? "control_viewport_prompt"
                  : isControlSuppressedScreenSubmit
                    ? "control_ui_suppressed_screen_reconciled"
                    : "control_history_prompt",
                suppressionReason: terminalControlUiSuppressionReason || "",
                suppressionActive: isTerminalControlUiSuppressionActive(),
                promptText: getBigViewTextDiagnosticFields(promptTextAtSubmit),
                terminalIndex,
                threadId: terminalThreadIdRef.current || "",
                workspaceId: workspace?.id || "",
              });
            }
            if (
              terminalSubmittedInputHasText
              && promptTextAtSubmit
              && !shouldSuppressSubmitLifecycle
              && !confirmedSubmitBridge
            ) {
              const submittedPromptRecord = rememberTerminalThreadSubmittedPrompt({
                promptEventId: confirmedSubmitBridge?.promptEventId || "",
                promptText: promptTextAtSubmit,
                source: confirmedSubmitBridge?.promptEventSource || "tui-manual-input",
                submittedAt: confirmedSubmitBridge?.promptEventSubmittedAt || "",
                threadId: terminalThreadIdRef.current || "",
              });
              recordSubmittedAgentMessage(
                terminalInstanceId,
                promptTextAtSubmit,
                confirmedSubmitBridge
                  ? {
                    messageCreatedAt: confirmedSubmitBridge.startedAt,
                    messageId: confirmedSubmitBridge.promptEventId,
                    messageSource: "tui-manual-input",
                    promptEpoch: submittedPromptRecord?.promptEpoch || 0,
                    prompt_epoch: submittedPromptRecord?.promptEpoch || 0,
                    promptEventId: confirmedSubmitBridge.promptEventId,
                    promptEventRevision: confirmedSubmitBridge.promptEventRevision,
                    promptEventSource: confirmedSubmitBridge.promptEventSource,
                    source: "tui-manual-input",
                    turnId: confirmedSubmitBridge.turnId,
                  }
                  : {
                    messageSource: "tui-manual-input",
                    promptEpoch: submittedPromptRecord?.promptEpoch || 0,
                    prompt_epoch: submittedPromptRecord?.promptEpoch || 0,
                    source: "tui-manual-input",
                  },
              );
            } else if (
              terminalSubmittedInputHasText
              && promptTextAtSubmit
              && !shouldSuppressSubmitLifecycle
              && confirmedSubmitBridge
            ) {
              logBigViewSyncDiagnosticEvent("tui.text.submit_local_turn_deferred", {
                agentId: terminalAgentKind,
                instanceId: terminalInstanceId,
                paneId,
                promptEventId: confirmedSubmitBridge.promptEventId,
                promptText: getBigViewTextDiagnosticFields(promptTextAtSubmit),
                reason: "await_backend_prompt_observed",
                terminalIndex,
                threadId: terminalThreadIdRef.current || "",
                workspaceId: workspace?.id || "",
              });
            }
            setTerminalSubmittedComposerState(
              setTerminalComposerText(terminalSubmittedComposerState, "", {
                cursor: 0,
                source: "submit_boundary_clear",
              }),
              "submit_boundary_clear",
            );
            syncCurrentTerminalComposerDraft("");
            logBigViewSyncDiagnosticEvent("tui.text.submit_boundary_cleared", {
              agentId: terminalAgentKind,
              instanceId: terminalInstanceId,
              paneId,
              terminalIndex,
              threadId: terminalThreadIdRef.current || "",
              workspaceId: workspace?.id || "",
            });
          }

          if (safeData.startsWith("\x1b") && !isSubmitInput) {
            flushTerminalInput("escape_sequence_flush_before");
            writeTerminalInputChunk(
              safeData,
              startupControlReply
                ? "startup_terminal_control_reply"
                : terminalGeneratedReply
                  ? "terminal_control_reply"
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
            isSubmitInput
            || terminalInputBuffer.length >= TERMINAL_INPUT_BATCH_MAX_CHARS
          ) {
            if (isSubmitInput && confirmedSubmitBridge) {
              const bridge = confirmedSubmitBridge;
              const submitData = takeTerminalInputBuffer();
              const promptMetadata = {
                promptEventId: bridge.promptEventId,
                promptEventRevision: bridge.promptEventRevision,
                promptEventSource: bridge.promptEventSource,
                promptEventSubmittedAt: bridge.promptEventSubmittedAt,
                promptEventText: bridge.promptEventText,
                todoAction: bridge.todoAction || undefined,
                todoCommandId: bridge.todoCommandId || undefined,
                todoDispatchId: bridge.todoDispatchId || undefined,
                todoId: bridge.todoId || undefined,
              };
              logTerminalStatus("frontend.tui_submit.enter_write_start", {
                agentId: terminalAgentKind,
                instanceId: terminalInstanceId,
                inputDebug: getTerminalInputDebugFields(submitData),
                paneId,
                promptEventId: bridge.promptEventId,
                promptTextLength: bridge.promptEventText.length,
                terminalIndex,
                threadId: bridge.threadId,
                workspaceId: bridge.workspaceId,
              });
              const writePromise = writeBufferedTerminalInput(submitData, "submit", promptMetadata);
              let submittedWaiter = null;
              Promise.resolve(bridge.submittedWaiterReady)
                .then((resolvedSubmittedWaiter) => {
                  submittedWaiter = resolvedSubmittedWaiter;
                  return Promise.resolve(writePromise)
                    .then((writeResult) => {
                      logTerminalStatus("frontend.tui_submit.enter_write_done", {
                        agentId: terminalAgentKind,
                        instanceId: terminalInstanceId,
                        paneId,
                        promptEventId: bridge.promptEventId,
                        promptTextLength: bridge.promptEventText.length,
                        terminalIndex,
                        threadId: bridge.threadId,
                        transport: writeResult?.transport || "",
                        workspaceId: bridge.workspaceId,
                      });
                    })
                    .then(() => submittedWaiter.promise)
                    .then((submittedPayload) => {
                      const submittedPromptRecord = rememberTerminalThreadSubmittedPrompt({
                        promptEventId: bridge.promptEventId,
                        promptText: bridge.promptEventText,
                        source: bridge.promptEventSource || "tui-manual-input",
                        submittedAt: bridge.promptEventSubmittedAt || "",
                        threadId: terminalThreadIdRef.current || bridge.threadId || "",
                      });
                      recordSubmittedAgentMessage(
                        terminalInstanceId,
                        bridge.promptEventText,
                        {
                          messageCreatedAt: bridge.startedAt,
                          messageId: bridge.promptEventId,
                          messageSource: "tui-manual-input",
                          promptEpoch: submittedPromptRecord?.promptEpoch || 0,
                          prompt_epoch: submittedPromptRecord?.promptEpoch || 0,
                          promptEventId: bridge.promptEventId,
                          promptEventRevision: bridge.promptEventRevision,
                          promptEventSource: bridge.promptEventSource,
                          source: "tui-manual-input",
                          turnId: bridge.turnId,
                        },
                      );
                      logBigViewSyncDiagnosticEvent("tui.text.confirmed_submit_bridge_observed", {
                        agentId: terminalAgentKind,
                        instanceId: terminalInstanceId,
                        observedPromptLength: String(submittedPayload?.observedPrompt || submittedPayload?.prompt || "").trim().length,
                        paneId,
                        promptEventId: bridge.promptEventId,
                        promptSource: submittedPayload?.promptSource || "",
                        terminalIndex,
                        threadId: bridge.threadId,
                        workspaceId: bridge.workspaceId,
                      });
                      return bridge.acceptedWaiter.promise;
                    })
                    .then((acceptedDetail) => {
                      const acceptedProviderSessionId = String(acceptedDetail?.sessionId || "").trim();
                      logBigViewSyncDiagnosticEvent("tui.text.confirmed_submit_bridge_accepted", {
                        acceptedMatchedBy: acceptedDetail?.matchedBy || "",
                        agentId: terminalAgentKind,
                        instanceId: terminalInstanceId,
                        paneId,
                        promptEventId: bridge.promptEventId,
                        providerSessionPresent: Boolean(acceptedProviderSessionId),
                        terminalIndex,
                        threadId: bridge.threadId,
                        workspaceId: bridge.workspaceId,
                      });
                      if (terminalUsesActivityHooks) {
                        logBigViewSyncDiagnosticEvent("tui.text.confirmed_submit_bridge_hook_managed_start_deferred", {
                          acceptedMatchedBy: acceptedDetail?.matchedBy || "",
                          agentId: terminalAgentKind,
                          instanceId: terminalInstanceId,
                          paneId,
                          promptEventId: bridge.promptEventId,
                          providerSessionPresent: Boolean(acceptedProviderSessionId),
                          terminalIndex,
                          threadId: bridge.threadId,
                          workspaceId: bridge.workspaceId,
                        });
                      } else {
                        const providerTurnStartProjectionEvents = buildProviderTurnStartProjectionEvents({
                          agentId: terminalAgentKind,
                          includeUserMessage: false,
                          source: "terminal-confirmed",
                          startedAt: bridge.startedAt,
                          text: bridge.promptEventText,
                          turnId: bridge.turnId,
                          userMessageId: bridge.promptEventId,
                        });
                        onThreadTerminalLifecycle?.({
                          activityStatus: "thinking",
                          agentId: terminalAgentKind,
                          instanceId: terminalInstanceId,
                          paneId,
                          status: "active",
                          terminalIndex,
                          threadId: bridge.threadId,
                          type: "agent-output",
                          workspaceId: bridge.workspaceId,
                        });
                        onThreadTerminalLifecycle?.({
                          agentId: terminalAgentKind,
                          clearPendingPrompt: false,
                          instanceId: terminalInstanceId,
                          nativeSessionId: acceptedProviderSessionId,
                          nativeSessionKind: acceptedProviderSessionId ? "session" : "",
                          nativeSessionSource: acceptedProviderSessionId ? "terminal-confirmed" : "",
                          paneId,
                          pendingPromptId: bridge.promptEventId,
                          projectionEvents: providerTurnStartProjectionEvents,
                          providerSessionId: acceptedProviderSessionId,
                          repoPath: workingDirectory || "",
                          status: "active",
                          terminalIndex,
                          threadId: bridge.threadId,
                          type: "provider-turn-started",
                          workspaceId: bridge.workspaceId,
                          workspaceName: workspace?.name || "",
                        });
                      }
                    })
                    .catch((error) => {
                      submittedWaiter?.cancel?.();
                      bridge.acceptedWaiter.cancel();
                      logBigViewSyncDiagnosticEvent("tui.text.confirmed_submit_bridge_error", {
                        agentId: terminalAgentKind,
                        instanceId: terminalInstanceId,
                        message: getErrorMessage(error, "Unable to confirm submitted terminal prompt."),
                        paneId,
                        promptEventId: bridge.promptEventId,
                        terminalIndex,
                        threadId: bridge.threadId,
                        workspaceId: bridge.workspaceId,
                      });
                    });
                })
                .catch((error) => {
                  bridge.acceptedWaiter.cancel();
                  logBigViewSyncDiagnosticEvent("tui.text.confirmed_submit_bridge_waiter_error", {
                    agentId: terminalAgentKind,
                    instanceId: terminalInstanceId,
                    message: getErrorMessage(error, "Unable to observe submitted terminal prompt."),
                    paneId,
                    promptEventId: bridge.promptEventId,
                    terminalIndex,
                    threadId: bridge.threadId,
                    workspaceId: bridge.workspaceId,
                  });
                });
              return;
            }
            flushTerminalInput(
              isSubmitInput
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
          const selectionLineSnapshot = getTerminalActivePromptLineSnapshot(terminalSubmittedInputText);
          const selectionRange = getTerminalSelectionPromptRange(selectionLineSnapshot);
          Promise.resolve(flushTerminalInput("selection_delete_flush_before"))
            .then(() => invoke("terminal_delete_selection", {
              currentLine: selectionLineSnapshot?.plausible
                ? selectionLineSnapshot.promptText
                : terminalSubmittedInputText,
              paneId,
              instanceId: terminalInstanceId,
              selection,
              selectionEnd: selectionRange?.end,
              selectionStart: selectionRange?.start,
            }))
            .then((result) => {
              if (result?.deleted) {
                const remainingLine = String(result?.remainingLine || "");
                if (remainingLine || result?.remainingChars === 0) {
                  setTerminalSubmittedComposerState(
                    setTerminalComposerText(terminalSubmittedComposerState, remainingLine, {
                      confidence: "certain",
                      source: "selection_delete_rewrite",
                    }),
                    "selection_delete_rewrite",
                  );
                } else {
                  setTerminalSubmittedComposerState(
                    applyTerminalInputChunkToComposer(
                      terminalSubmittedComposerState,
                      event.key === "Delete" ? "\x1b[3~" : "\x7f",
                      {
                        selectionText: selection,
                        source: "selection_delete",
                      },
                    ),
                    "selection_delete",
                  );
                }
                syncCurrentTerminalComposerDraft(terminalSubmittedInputText);
                terminalLastSelectionAt = 0;
                terminalLastSelectionText = "";
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
        const handleTerminalSlashCommandKeyDown = (event) => {
          handleSlashCommandDiagnosticKeyDown(event, "container_capture_keydown");
        };
        container.addEventListener("keydown", handleTerminalSlashCommandKeyDown, true);
        disposables.push(() => {
          container.removeEventListener("keydown", handleTerminalSlashCommandKeyDown, true);
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
            }).then((result) => {
              if (isDisposed) {
                return;
              }
              const interruptedActiveTask = Boolean(
                result?.interruptedActiveTask
                  ?? result?.interrupted_active_task
                  ?? false,
              );
              const interruptedParkedPromptCount = Number(
                result?.interruptedParkedPromptCount
                  ?? result?.interrupted_parked_prompt_count
                  ?? 0,
              ) || 0;
              const inputReadyAt = new Date().toISOString();
              const interruptSource = interruptedActiveTask || interruptedParkedPromptCount > 0
                ? "escape_key_task_interrupted"
                : "escape_key_manual_cancel";
              const submittedPromptForReady = terminalThreadSubmittedPromptRef.current;
              markTerminalThreadActivityStatus("idle", {
                reason: interruptSource,
              });
              terminalThreadLastReadyAtMsRef.current = parseTerminalStateTimestampMs(inputReadyAt) || Date.now();
              terminalThreadSubmittedPromptRef.current = null;
              onThreadTerminalLifecycle?.({
                activityStatus: "idle",
                agentId: terminalAgentKind,
                commandPhase: "cancelled",
                executionPhase: "interrupted",
                inputReady: true,
                inputReadyAt,
                inputReadyConfidence: interruptSource,
                instanceId: terminalInstanceId,
                ...getTerminalNativeRailStateFields("idle"),
                paneId,
                pendingPromptId: submittedPromptForReady?.promptEventId || "",
                promptEpoch: submittedPromptForReady?.promptEpoch || 0,
                prompt_epoch: submittedPromptForReady?.promptEpoch || 0,
                promptEventId: submittedPromptForReady?.promptEventId || "",
                promptEventSubmittedAt: submittedPromptForReady?.submittedAt || "",
                submittedAt: submittedPromptForReady?.submittedAt || "",
                terminalPrompt: submittedPromptForReady?.promptText || "",
                source: interruptSource,
                status: "active",
                terminalIndex,
                threadId: terminalThreadIdRef.current || "",
                turnStatus: "interrupted",
                type: "provider-turn-interrupted",
                workspaceId: workspace?.id || "",
              });
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
        const sessionModeForThisStart = normalizeTerminalSessionMode(
          terminalSessionModeRef.current,
          defaultTerminalSessionModeForRole(terminalRoleId, shouldPrewarmShell),
        );
        terminalSessionModeRef.current = sessionModeForThisStart;
        setTerminalSessionMode(sessionModeForThisStart);

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
          scheduleCodingAgentInputReady(`${reason}_agent_started`);
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
              freshSession: forceFreshSessionForThisStart,
              providerSessionId: startupThreadProviderSessionId,
              model: startupThreadProviderModel,
              plainShell: isGenericTerminal,
              preserveCoordinationSession: preserveCoordinationForThisStart,
              sessionMode: sessionModeForThisStart,
              projectRoot: projectRoot || "",
              mountId: mountId || "",
              slotKey: startupSlotKey,
              terminalIndex,
              threadId: startupThreadId,
              workingDirectory: workingDirectory || "",
              workspaceRootWasEmptyAtSelection: Boolean(workspaceRootWasEmptyAtSelection),
              workspaceId: workspace?.id || "",
              workspaceName: workspace?.name || "",
              terminalName: terminalRailAgentLabel,
              terminalNickname,
              cols: initialSize.cols,
              rows: initialSize.rows,
              outputTransport: outputTransportPreferred,
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
          invoke("terminal_close", {
            paneId,
            instanceId: terminalInstanceId,
            waitForCleanup: true,
          }).catch(() => {});
          return;
        }

        outputDisplayMasker.setPaths({
          coreRepoPath: collapseFunctionalRepoPathToCoreRepoPath(
            openResult?.projectRoot || openResult?.workingDirectory || workingDirectory || "",
          ),
          functionalRepoPath: openResult?.agentBranchRoot || openResult?.workingDirectory || "",
        });
        terminalOutputWorkerSession?.updatePaths({
          coreRepoPath: collapseFunctionalRepoPathToCoreRepoPath(
            openResult?.projectRoot || openResult?.workingDirectory || workingDirectory || "",
          ),
          functionalRepoPath: openResult?.agentBranchRoot || openResult?.workingDirectory || "",
        });
        hasOpenPty = true;
        startupControlReplyBridgeOpen = false;
        setTerminalLaunchInfo(openResult || null);
        const openedSessionMode = normalizeTerminalSessionMode(openResult?.sessionMode, sessionModeForThisStart);
        terminalSessionModeExplicitRef.current = false;
        terminalSessionModeRef.current = openedSessionMode;
        setTerminalSessionMode(openedSessionMode);
        terminalThreadSlotKeyRef.current = openResult?.slotKey || terminalThreadSlotKeyRef.current;
        logThreadBridgeDiagnostic("frontend.terminal_open.emit_opened_lifecycle", {
          agentId: agent?.id || terminalAgentKind,
          coordinationSessionPresent: Boolean(openResult?.sessionId),
          instanceId: terminalInstanceId,
          paneId,
          preserveCoordinationForThisStart,
          sessionMode: openResult?.sessionMode || sessionModeForThisStart,
          providerSessionOverridePresent: Boolean(providerSessionOverrideForThisStart),
          startupThreadProviderModel: startupThreadProviderModel || "",
          startupThreadProviderModelSource,
          startupThreadId: startupThreadId || "",
          startupThreadProviderSessionPresent: Boolean(startupThreadProviderSessionId),
          terminalIndex,
          workspaceId: workspace?.id || "",
        });
        onThreadTerminalLifecycle?.({
          agentBranch: openResult?.agentBranch || "",
          agentId: agent?.id || terminalAgentKind,
          coordinationAgentId: openResult?.agentId || "",
          coordinationMode: openResult?.coordinationMode || "",
          instanceId: terminalInstanceId,
          model: startupThreadProviderModel,
          modelSource: startupThreadProviderModelSource,
          nativeSessionId: startupThreadProviderSessionId,
          nativeSessionKind: startupThreadProviderSessionId ? "session" : "",
          nativeSessionSource: startupThreadProviderSessionId ? "session-restore" : "",
          paneId,
          providerSessionId: startupThreadProviderSessionId,
          sessionId: openResult?.sessionId || "",
          sessionMode: openResult?.sessionMode || sessionModeForThisStart,
          fileAuthority: openResult?.fileAuthority || "",
          slotKey: openResult?.slotKey || terminalThreadSlotKeyRef.current,
          status: shouldPrewarmShell ? "starting" : "active",
          terminalIndex,
          threadId: startupThreadId,
          type: "opened",
          workspaceId: workspace?.id || "",
          worktreePath: openResult?.agentBranchRoot || openResult?.workingDirectory || "",
        });
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
          if (isGenericTerminal) {
            // The PTY spawned at the size measured before open; any layout settle since then was
            // frontend-only. Force one committed PTY resize so the shell's first prompt row is laid
            // out at the real width before the user starts typing.
            resizeController?.resizeNow("generic_shell_open_settled", {
              force: true,
              forceNative: true,
            });
          }
          scheduleCodingAgentInputReady("terminal_open_done");
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
        onPreparedTerminalChange?.({
          agentId: agent?.id || terminalAgentKind,
          agentStarted: !shouldPrewarmShell,
          instanceId: terminalInstanceId,
          needsAgentStart: shouldPrewarmShell,
          paneId,
          ready: true,
          terminalIndex,
          threadId: startupThreadId,
          workspaceId: workspace?.id || "",
        });
        resizeController?.resizeNow("terminal_open_done");
        scheduleInitialHeadlessOutputReplay("terminal_open_done");

        scheduleWebglAttach("idle", TERMINAL_WEBGL_IDLE_DELAY_MS);

        focusTerminalKeyboardInput();

        const shouldWriteStartupModelRestore = false;
        if (
          startupThreadProviderModel
          && startupThreadProviderSessionId
          && !isGenericTerminal
          && !shouldPrewarmShell
          && shouldWriteStartupModelRestore
        ) {
          const restoreModelCommand = `/model ${startupThreadProviderModel}`;
          logBigViewSyncDiagnosticEvent("bigview.model_restore.terminal_write_scheduled", {
            agentId: terminalAgentKind,
            commandLength: restoreModelCommand.length,
            delayMs: 650,
            instanceId: terminalInstanceId,
            model: startupThreadProviderModel,
            paneId,
            providerSessionIdPresent: Boolean(startupThreadProviderSessionId),
            startupThreadId: startupThreadId || "",
            terminalIndex,
            workspaceId: workspace?.id || "",
          });
          window.setTimeout(() => {
            if (isDisposed) {
              logBigViewSyncDiagnosticEvent("bigview.model_restore.terminal_write_skip", {
                agentId: terminalAgentKind,
                instanceId: terminalInstanceId,
                model: startupThreadProviderModel,
                paneId,
                reason: "disposed",
                startupThreadId: startupThreadId || "",
                terminalIndex,
                workspaceId: workspace?.id || "",
              });
              return;
            }

            logBigViewSyncDiagnosticEvent("bigview.model_restore.terminal_write_start", {
              agentId: terminalAgentKind,
              commandLength: restoreModelCommand.length,
              instanceId: terminalInstanceId,
              model: startupThreadProviderModel,
              paneId,
              startupThreadId: startupThreadId || "",
              terminalIndex,
              workspaceId: workspace?.id || "",
            });
            dispatchTerminalControlUiSuppression({
              agentId: terminalAgentKind,
              instanceId: terminalInstanceId,
              model: startupThreadProviderModel,
              paneId,
              reason: "startup-model-restore",
              terminalIndex,
              threadId: startupThreadId || "",
              workspaceId: workspace?.id || "",
            });
            invoke("terminal_write", {
              data: buildTerminalSubmittedInput(restoreModelCommand, terminalAgentKind, isGenericTerminal),
              instanceId: terminalInstanceId,
              paneId,
              promptEventSource: "startup-model-restore",
              threadId: startupThreadId || "",
            }).then(() => {
              logBigViewSyncDiagnosticEvent("bigview.model_restore.terminal_write_done", {
                agentId: terminalAgentKind,
                instanceId: terminalInstanceId,
                model: startupThreadProviderModel,
                paneId,
                startupThreadId: startupThreadId || "",
                terminalIndex,
                workspaceId: workspace?.id || "",
              });
            }).catch((error) => {
              logBigViewSyncDiagnosticEvent("bigview.model_restore.terminal_write_error", {
                agentId: terminalAgentKind,
                instanceId: terminalInstanceId,
                message: error?.message || String(error || ""),
                model: startupThreadProviderModel,
                paneId,
                startupThreadId: startupThreadId || "",
                terminalIndex,
                workspaceId: workspace?.id || "",
              });
            });
          }, 650);
        } else {
          logBigViewSyncDiagnosticEvent("bigview.model_restore.terminal_write_skip", {
            agentId: terminalAgentKind,
            hasModel: Boolean(startupThreadProviderModel),
            hasProviderSession: Boolean(startupThreadProviderSessionId),
            isGenericTerminal,
            paneId,
            reason: !startupThreadProviderModel
              ? "missing_model"
              : !startupThreadProviderSessionId
                ? "missing_provider_session"
                : isGenericTerminal
                  ? "generic_terminal"
                  : shouldPrewarmShell
                    ? "prewarm_shell"
                    : "startup_model_restore_disabled",
            shouldPrewarmShell,
            startupThreadId: startupThreadId || "",
            terminalIndex,
            workspaceId: workspace?.id || "",
          });
        }

        if (shouldPrewarmShell) {
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
          const missingSavedSessionId = extractCodexMissingSavedSessionId(errorMessage);
          if (missingSavedSessionId) {
            emitInvalidProviderSession(
              missingSavedSessionId,
              errorMessage,
              "terminal-open-error",
            );
          }
          setPaneStage("error", "Terminal Launch Failed", errorMessage);
          setTerminalError(errorMessage);
          onThreadTerminalLifecycle?.({
            agentId: agent?.id || terminalAgentKind,
            error: errorMessage,
            paneId,
            terminalIndex,
            threadId: startupThreadId,
            type: "error",
            workspaceId: workspace?.id || "",
          });
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
      if (visibleOutputRefreshTimer) {
        window.clearTimeout(visibleOutputRefreshTimer);
        visibleOutputRefreshTimer = 0;
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
        threadId: startupThreadId,
        workspaceId: workspace?.id || "",
      });
      clearActiveTerminalKeyboardTargetIfCurrent(paneId, terminalInstanceId);
      setTerminalAudioInputTarget(false, terminalInstanceId, "terminal_cleanup");
      detachPushToTalkGuard();
      const preserveCoordinationSession = preserveCoordinationOnNextCleanupRef.current && !isGenericTerminal;
      preserveCoordinationOnNextCleanupRef.current = false;
      logTerminalStatus("frontend.terminal_lifecycle.cleanup_close", {
        agentId: agent?.id || terminalAgentKind,
        instanceId: terminalInstanceId,
        paneId,
        preserveCoordinationSession,
        restartKey,
        startupThreadId,
        terminalClosed,
        terminalIndex,
        terminalRoleId,
        workspaceId: workspace?.id || "",
      });
      invoke("terminal_close", {
        paneId,
        instanceId: terminalInstanceId,
        preserveCoordinationSession,
        waitForCleanup: true,
      }).catch(() => {});
      terminal.dispose();
    };
  // PTY lifetime must be tied to pane identity and explicit lifecycle actions only.
  // Volatile thread/global-state callbacks are intentionally excluded so ordinary
  // workspace-thread updates do not tear down live terminal processes.
  }, [mountId, paneId, projectRoot, restartKey, terminalClosed, terminalIndex, terminalRoleId, terminalStartupUnblocked, workspace?.id]);

  useEffect(() => {
    const pendingPrompt = thread?.pendingPrompt;
    const promptId = String(pendingPrompt?.id || "").trim();
    const promptText = String(pendingPrompt?.text || "").trim();
    const deliveryMode = String(pendingPrompt?.deliveryMode || "").trim().toLowerCase();
    const sessionAcceptanceOnly = deliveryMode === "session-acceptance";
    const requestedProviderDelivery = deliveryMode === "provider-api";
    const useTerminalConfirmedDelivery = true;
    let effectiveDeliveryMode = "terminal-confirmed-default";
    if (sessionAcceptanceOnly) {
      effectiveDeliveryMode = "session-acceptance";
    } else if (requestedProviderDelivery) {
      effectiveDeliveryMode = "terminal-confirmed-forced-from-provider-api";
    } else if (deliveryMode === "terminal-confirmed") {
      effectiveDeliveryMode = "terminal-confirmed";
    }
    const threadId = terminalThreadIdRef.current || thread?.id || "";
    const instanceId = terminalInstanceIdRef.current || 0;
    const hasSessionRestoreModel = Boolean(threadProviderSessionId && threadProviderModel);
    const pendingPromptTextDiagnostic = getBigViewTextDiagnosticFields(promptText, {
      previewLength: 180,
    });
    const pendingPromptLogFields = {
      agentId: terminalAgentKind,
      deliveryMode: effectiveDeliveryMode,
      hasPromptId: Boolean(promptId),
      hasPromptText: Boolean(promptText),
      promptText: pendingPromptTextDiagnostic,
      requestedDeliveryMode: deliveryMode,
      instanceId,
      isGenericTerminal,
      paneId,
      promptId,
      terminalClosing,
      terminalClosed,
      terminalIndex,
      terminalState,
      threadId,
      workspaceId: workspace?.id || thread?.workspaceId || "",
    };

    if (sessionAcceptanceOnly) {
      logTerminalStatus("frontend.pending_prompt.skip", {
        ...pendingPromptLogFields,
        reason: "session_acceptance_tracking_only",
      });
      return;
    }

    if (
      !promptId
      || !promptText
      || !threadId
      || !instanceId
      || !paneId
      || isGenericTerminal
      || terminalClosed
      || terminalClosing
      || terminalState !== "running"
    ) {
      if (promptId || promptText) {
        const reasons = [];
        if (!promptId) reasons.push("missing_prompt_id");
        if (!promptText) reasons.push("missing_prompt_text");
        if (!threadId) reasons.push("missing_thread_id");
        if (!instanceId) reasons.push("missing_instance_id");
        if (!paneId) reasons.push("missing_pane_id");
        if (isGenericTerminal) reasons.push("generic_terminal");
        if (terminalClosed) reasons.push("terminal_closed");
        if (terminalClosing) reasons.push("terminal_closing");
        if (terminalState !== "running") reasons.push("terminal_not_running");
        logTerminalStatus("frontend.pending_prompt.blocked", {
          ...pendingPromptLogFields,
          reasons,
        });
      }
      return;
    }

    if (submittedPendingPromptIdsRef.current.has(promptId)) {
      logTerminalStatus("frontend.pending_prompt.skip", {
        ...pendingPromptLogFields,
        reason: "already_submitted",
      });
      return;
    }
    if (pendingPromptSendTimersRef.current.has(promptId)) {
      logTerminalStatus("frontend.pending_prompt.skip", {
        ...pendingPromptLogFields,
        reason: "timer_already_pending",
      });
      return;
    }

    const initialStartedAt = performance.now();
    const maxWaitMs = 45_000;
    const visibleOutputSettledMs = hasSessionRestoreModel ? 1400 : 900;
    const runningFallbackMs = hasSessionRestoreModel ? 4200 : 2800;

    const getTerminalOpenSendDelayMs = () => {
      if (isGenericTerminal) {
        return 0;
      }

      const now = performance.now();
      const firstVisibleAt = terminalFirstVisibleOutputAtRef.current;
      const runningSince = terminalRunningSinceRef.current;
      if (firstVisibleAt > 0) {
        return Math.max(0, visibleOutputSettledMs - (now - firstVisibleAt));
      }

      if (runningSince > 0) {
        return Math.max(0, runningFallbackMs - (now - runningSince));
      }

      return 250;
    };

    const sendPendingPrompt = () => {
      pendingPromptSendTimersRef.current.delete(promptId);
      if (
        submittedPendingPromptIdsRef.current.has(promptId)
        || terminalClosingRef.current
        || !xtermRef.current
      ) {
        logTerminalStatus("frontend.pending_prompt.send_skip", {
          ...pendingPromptLogFields,
          hasXterm: Boolean(xtermRef.current),
          reason: submittedPendingPromptIdsRef.current.has(promptId)
            ? "already_submitted"
            : terminalClosingRef.current
              ? "terminal_closing"
              : "missing_xterm",
        });
        return;
      }

      const elapsedMs = performance.now() - initialStartedAt;
      const readyDelayMs = getTerminalOpenSendDelayMs();
      if (readyDelayMs > 0 && elapsedMs < maxWaitMs) {
        const nextDelayMs = Math.min(Math.max(readyDelayMs, 120), 750);
        logThreadBridgeDiagnostic("frontend.pending_prompt.wait_for_terminal_ready", {
          agentId: terminalAgentKind,
          elapsedMs: Math.round(elapsedMs),
          firstVisibleOutputSeen: terminalFirstVisibleOutputAtRef.current > 0,
          hasSessionRestoreModel,
          instanceId: terminalInstanceIdRef.current || instanceId,
          nextDelayMs,
          paneId,
          promptId,
          runningSinceSeen: terminalRunningSinceRef.current > 0,
          terminalIndex,
          threadId,
          workspaceId: workspace?.id || thread?.workspaceId || "",
        });
        logTerminalStatus("frontend.pending_prompt.wait_for_terminal_ready", {
          ...pendingPromptLogFields,
          elapsedMs: Math.round(elapsedMs),
          firstVisibleOutputSeen: terminalFirstVisibleOutputAtRef.current > 0,
          hasSessionRestoreModel,
          nextDelayMs,
          runningSinceSeen: terminalRunningSinceRef.current > 0,
        });
        const retryTimer = window.setTimeout(sendPendingPrompt, nextDelayMs);
        pendingPromptSendTimersRef.current.set(promptId, retryTimer);
        return;
      }

      const currentInstanceId = terminalInstanceIdRef.current || instanceId;
      const currentThreadId = terminalThreadIdRef.current || threadId;
      if (!currentInstanceId || !currentThreadId) {
        if (elapsedMs >= maxWaitMs) {
          const message = "Terminal did not become ready for the pending prompt.";
          logTerminalStatus("frontend.pending_prompt.failed", {
            ...pendingPromptLogFields,
            elapsedMs: Math.round(elapsedMs),
            message,
            reason: "terminal_ready_timeout",
          });
          setTerminalError(message);
          onThreadTerminalLifecycle?.({
            error: message,
            pendingPromptId: promptId,
            threadId,
            type: "pending-prompt-error",
            workspaceId: workspace?.id || thread?.workspaceId || "",
          });
          return;
        }
        logTerminalStatus("frontend.pending_prompt.wait_for_identity", {
          ...pendingPromptLogFields,
          elapsedMs: Math.round(elapsedMs),
          hasCurrentInstanceId: Boolean(currentInstanceId),
          hasCurrentThreadId: Boolean(currentThreadId),
          nextDelayMs: 250,
        });
        const retryTimer = window.setTimeout(sendPendingPrompt, 250);
        pendingPromptSendTimersRef.current.set(promptId, retryTimer);
        return;
      }

      submittedPendingPromptIdsRef.current.add(promptId);
      markTerminalThreadActivityStatus("thinking", {
        forceNewTurn: true,
        reason: "pending_prompt_send",
      });

      logThreadBridgeDiagnostic("frontend.pending_prompt.write_start", {
        agentId: terminalAgentKind,
        deliveryMode: effectiveDeliveryMode,
        elapsedMs: Math.round(elapsedMs),
        firstVisibleOutputSeen: terminalFirstVisibleOutputAtRef.current > 0,
        hasSessionRestoreModel,
        instanceId: currentInstanceId,
        paneId,
        promptId,
        terminalIndex,
        threadId: currentThreadId,
        workspaceId: workspace?.id || thread?.workspaceId || "",
      });
      logTerminalStatus("frontend.pending_prompt.write_start", {
        ...pendingPromptLogFields,
        elapsedMs: Math.round(elapsedMs),
        firstVisibleOutputSeen: terminalFirstVisibleOutputAtRef.current > 0,
        hasSessionRestoreModel,
        instanceId: currentInstanceId,
        promptTextLength: promptText.length,
        threadId: currentThreadId,
      });

      Promise.resolve()
        .then(async () => {
          const pendingWorkspaceId = workspace?.id || thread?.workspaceId || "";
          const pendingSyncKey = getThreadComposerSyncKey(
            {
              id: currentThreadId,
              workspaceId: pendingWorkspaceId,
            },
            {
              instanceId: currentInstanceId,
              paneId,
            },
          );
          const syncData = buildTerminalComposerDraftInput("", promptText, true);
          const syncSequenceTrace = getTerminalInputSequenceDiagnosticFields(syncData);
          setThreadComposerDraftValue(pendingSyncKey, promptText, "pending_prompt_sync_prompt");
          logTerminalStatus("frontend.pending_prompt.sync_write_start", {
            ...pendingPromptLogFields,
            instanceId: currentInstanceId,
            syncSequence: syncSequenceTrace,
            syncDataLength: syncData.length,
            threadId: currentThreadId,
          });
          logThreadBridgeDiagnostic("frontend.pending_prompt.sync_start", {
            agentId: terminalAgentKind,
            deliveryMode: effectiveDeliveryMode,
            instanceId: currentInstanceId,
            paneId,
            promptId,
            promptText: pendingPromptTextDiagnostic,
            sendPolicy: "pending-prompt-terminal-sync-then-submit",
            syncSequence: syncSequenceTrace,
            terminalIndex,
            threadId: currentThreadId,
            workspaceId: workspace?.id || thread?.workspaceId || "",
          });
          await invoke("terminal_write", {
            data: syncData,
            instanceId: currentInstanceId,
            paneId,
            threadId: currentThreadId,
          });
          logTerminalStatus("frontend.pending_prompt.sync_write_done", {
            ...pendingPromptLogFields,
            instanceId: currentInstanceId,
            syncSequence: syncSequenceTrace,
            syncDataLength: syncData.length,
            threadId: currentThreadId,
          });
          logThreadBridgeDiagnostic("frontend.pending_prompt.sync_done", {
            agentId: terminalAgentKind,
            deliveryMode: effectiveDeliveryMode,
            instanceId: currentInstanceId,
            paneId,
            promptId,
            promptText: pendingPromptTextDiagnostic,
            sendPolicy: "pending-prompt-terminal-sync-then-submit",
            syncSequence: syncSequenceTrace,
            terminalIndex,
            threadId: currentThreadId,
            workspaceId: workspace?.id || thread?.workspaceId || "",
          });
          const waiter = await createTerminalPromptSubmittedWaiter({
            allowObservedInputGateForHookManaged: true,
            agentId: terminalAgentKind,
            expectedPrompt: promptText,
            instanceId: currentInstanceId,
            paneId,
            promptId,
            threadId: currentThreadId,
            workspaceId: workspace?.id || thread?.workspaceId || "",
          });
          const acceptedWaiter = createWorkspaceThreadPromptAcceptedWaiter({
            agentId: terminalAgentKind,
            expectedPrompt: promptText,
            promptId,
            threadId: currentThreadId,
            workspaceId: workspace?.id || thread?.workspaceId || "",
          });
          try {
            const pendingPromptSubmittedAt = new Date().toISOString();
            const submitSequence = getTerminalSubmitSequence(terminalAgentKind, isGenericTerminal);
            const submitSequenceTrace = getTerminalInputSequenceDiagnosticFields(submitSequence);
            logTerminalStatus("frontend.pending_prompt.submit_write_start", {
              ...pendingPromptLogFields,
              instanceId: currentInstanceId,
              promptEventSubmittedAt: pendingPromptSubmittedAt,
              submitSequence: submitSequenceTrace,
              submitSequenceLength: submitSequence.length,
              threadId: currentThreadId,
            });
            logThreadBridgeDiagnostic("frontend.pending_prompt.submit_sequence_resolved", {
              agentId: terminalAgentKind,
              deliveryMode: effectiveDeliveryMode,
              instanceId: currentInstanceId,
              paneId,
              promptId,
              promptEventSubmittedAt: pendingPromptSubmittedAt,
              promptText: pendingPromptTextDiagnostic,
              sendPolicy: "pending-prompt-terminal-confirmed-submit",
              submitSequence: submitSequenceTrace,
              terminalIndex,
              threadId: currentThreadId,
              workspaceId: workspace?.id || thread?.workspaceId || "",
            });
            await invoke("terminal_write", {
              data: submitSequence,
              instanceId: currentInstanceId,
              paneId,
              promptEventId: promptId,
              promptEventSource: "pending-prompt",
              promptEventSubmittedAt: pendingPromptSubmittedAt,
              promptEventText: promptText,
              threadId: currentThreadId,
            });
            logTerminalStatus("frontend.pending_prompt.submit_write_done", {
              ...pendingPromptLogFields,
              instanceId: currentInstanceId,
              promptEventSubmittedAt: pendingPromptSubmittedAt,
              submitSequence: submitSequenceTrace,
              submitSequenceLength: submitSequence.length,
              threadId: currentThreadId,
            });
            logThreadBridgeDiagnostic("frontend.pending_prompt.submit_write_done", {
              agentId: terminalAgentKind,
              deliveryMode: effectiveDeliveryMode,
              instanceId: currentInstanceId,
              paneId,
              promptId,
              promptEventSubmittedAt: pendingPromptSubmittedAt,
              promptText: pendingPromptTextDiagnostic,
              sendPolicy: "pending-prompt-terminal-confirmed-submit",
              submitSequence: submitSequenceTrace,
              terminalIndex,
              threadId: currentThreadId,
              workspaceId: workspace?.id || thread?.workspaceId || "",
            });
            await waiter.promise;
            logTerminalStatus("frontend.pending_prompt.submit_observed", {
              ...pendingPromptLogFields,
              instanceId: currentInstanceId,
              threadId: currentThreadId,
            });
            logThreadBridgeDiagnostic("frontend.pending_prompt.await_session_acceptance", {
              agentId: terminalAgentKind,
              deliveryMode: effectiveDeliveryMode,
              instanceId: currentInstanceId,
              paneId,
              promptId,
              sendPolicy: "terminal-confirmed-and-session-accepted",
              terminalIndex,
              threadId: currentThreadId,
              workspaceId: workspace?.id || thread?.workspaceId || "",
            });
            return waitForWorkspaceThreadPromptAcceptedWithEnterRetries({
              acceptedWaiter,
              agentId: terminalAgentKind,
              binding: {
                instanceId: currentInstanceId,
                paneId,
                terminalIndex,
              },
              expectedPrompt: promptText,
              getDraftValue: () => threadComposerDraftsRef.current.get(pendingSyncKey) || "",
              isGenericTerminal,
              logPrefix: "frontend.pending_prompt",
              promptId,
              submitSequence: getTerminalSubmitSequence(terminalAgentKind, isGenericTerminal),
              threadId: currentThreadId,
              workspaceId: workspace?.id || thread?.workspaceId || "",
            });
          } catch (error) {
            waiter.cancel();
            acceptedWaiter.cancel();
            throw error;
          }
        })
        .then((acceptedDetail) => {
          const pendingWorkspaceId = workspace?.id || thread?.workspaceId || "";
          const pendingSyncKey = getThreadComposerSyncKey(
            {
              id: currentThreadId,
              workspaceId: pendingWorkspaceId,
            },
            {
              instanceId: currentInstanceId,
              paneId,
            },
          );
          setThreadComposerDraftValue(pendingSyncKey, "", "pending_prompt_confirmed_clear");
          if (useTerminalConfirmedDelivery && terminalUsesActivityHooks) {
            logThreadBridgeDiagnostic("frontend.pending_prompt.hook_managed_start_deferred", {
              agentId: terminalAgentKind,
              deliveryMode: effectiveDeliveryMode,
              instanceId: currentInstanceId,
              matchedBy: acceptedDetail?.matchedBy || "",
              paneId,
              promptId,
              providerSessionPresent: Boolean(acceptedDetail?.sessionId || threadProviderSessionId),
              source: "terminal-confirmed",
              terminalIndex,
              textLength: promptText.length,
              threadId: currentThreadId,
              workspaceId: workspace?.id || thread?.workspaceId || "",
            });
          } else if (useTerminalConfirmedDelivery) {
            const startedAt = new Date().toISOString();
            const userMessageId = promptId || createThreadProjectionToken("message-user");
            const turnId = `turn-${userMessageId}`;
            const workspaceId = workspace?.id || thread?.workspaceId || "";
            const acceptedProviderSessionId = String(acceptedDetail?.sessionId || threadProviderSessionId || "").trim();
            const repoPath = thread?.coordination?.worktreePath
              || terminalLaunchInfo?.agentBranchRoot
              || terminalLaunchInfo?.workingDirectory
              || workingDirectory
              || "";
            onThreadTerminalLifecycle?.({
              activityStatus: "thinking",
              agentId: terminalAgentKind,
              instanceId: currentInstanceId,
              paneId,
              status: "active",
              terminalIndex,
              threadId: currentThreadId,
              type: "agent-output",
              workspaceId,
            });
            const pendingPromptProjectionEvents = buildProviderTurnStartProjectionEvents({
              agentId: terminalAgentKind,
              includeUserMessage: false,
              source: "terminal-confirmed",
              startedAt,
              text: promptText,
              turnId,
              userMessageId,
            });
            logThreadBridgeDiagnostic("frontend.pending_prompt.emit_provider_turn_started", {
              agentId: terminalAgentKind,
              deliveryMode: effectiveDeliveryMode,
              instanceId: currentInstanceId,
              matchedBy: acceptedDetail?.matchedBy || "",
              paneId,
              promptId,
              providerSessionPresent: Boolean(acceptedProviderSessionId),
              projectionEventCount: pendingPromptProjectionEvents.length,
              source: "terminal-confirmed",
              terminalIndex,
              textLength: promptText.length,
              threadId: currentThreadId,
              userProjectionEventCount: pendingPromptProjectionEvents.filter((projectionEvent) => (
                projectionEvent?.type === "thread.message.user"
              )).length,
              userProjectionMessageIds: pendingPromptProjectionEvents
                .filter((projectionEvent) => projectionEvent?.type === "thread.message.user")
                .map((projectionEvent) => projectionEvent?.messageId || "")
                .filter(Boolean),
              workspaceId,
            });
            onThreadTerminalLifecycle?.({
              agentId: terminalAgentKind,
              clearPendingPrompt: false,
              instanceId: currentInstanceId,
              model: pendingPrompt?.model || threadProviderModel || "",
              modelSource: pendingPrompt?.model || threadProviderModel ? "terminal-confirmed" : "",
              nativeSessionId: acceptedProviderSessionId,
              nativeSessionKind: acceptedProviderSessionId ? "session" : "",
              nativeSessionSource: acceptedProviderSessionId ? "terminal-confirmed" : "",
              paneId,
              pendingPromptId: promptId,
              projectionEvents: pendingPromptProjectionEvents,
              providerSessionId: acceptedProviderSessionId,
              repoPath,
              status: "active",
              terminalIndex,
              threadId: currentThreadId,
              type: "provider-turn-started",
              workspaceId,
              workspaceName: workspace?.name || "",
            });
          }
          logThreadBridgeDiagnostic("frontend.pending_prompt.confirmed", {
            agentId: terminalAgentKind,
            deliveryMode: effectiveDeliveryMode,
            instanceId: currentInstanceId,
            matchedBy: acceptedDetail?.matchedBy || "",
            paneId,
            promptId,
            providerSessionPresent: Boolean(acceptedDetail?.sessionId || threadProviderSessionId),
            terminalIndex,
            threadId: currentThreadId,
            workspaceId: workspace?.id || thread?.workspaceId || "",
          });
          logTerminalStatus("frontend.pending_prompt.confirmed", {
            ...pendingPromptLogFields,
            instanceId: currentInstanceId,
            matchedBy: acceptedDetail?.matchedBy || "",
            providerSessionPresent: Boolean(acceptedDetail?.sessionId || threadProviderSessionId),
            threadId: currentThreadId,
          });
          onThreadTerminalLifecycle?.({
            pendingPromptId: promptId,
            threadId: currentThreadId,
            type: "pending-prompt-sent",
            workspaceId: workspace?.id || thread?.workspaceId || "",
          });
        })
        .catch((error) => {
          submittedPendingPromptIdsRef.current.delete(promptId);
          const message = getErrorMessage(error, "Unable to send initial chat message.");
          logThreadBridgeDiagnostic("frontend.pending_prompt.failed", {
            agentId: terminalAgentKind,
            deliveryMode: effectiveDeliveryMode,
            error: message,
            instanceId: currentInstanceId,
            paneId,
            promptId,
            terminalIndex,
            threadId: currentThreadId,
            workspaceId: workspace?.id || thread?.workspaceId || "",
          });
          logTerminalStatus("frontend.pending_prompt.failed", {
            ...pendingPromptLogFields,
            error: message,
            instanceId: currentInstanceId,
            threadId: currentThreadId,
          });
          setTerminalError(message);
          onThreadTerminalLifecycle?.({
            error: message,
            pendingPromptId: promptId,
            threadId: currentThreadId,
            type: "pending-prompt-error",
            workspaceId: workspace?.id || thread?.workspaceId || "",
          });
        });
    };

    const timer = window.setTimeout(sendPendingPrompt, 120);
    pendingPromptSendTimersRef.current.set(promptId, timer);
    logTerminalStatus("frontend.pending_prompt.scheduled", {
      ...pendingPromptLogFields,
      delayMs: 120,
      promptTextLength: promptText.length,
    });
    return () => {
      const currentTimer = pendingPromptSendTimersRef.current.get(promptId);
      if (currentTimer) {
        pendingPromptSendTimersRef.current.delete(promptId);
        window.clearTimeout(currentTimer);
      }
    };
  }, [
    isGenericTerminal,
    onThreadTerminalLifecycle,
    paneId,
    setThreadComposerDraftValue,
    terminalAgentKind,
    terminalClosed,
    terminalClosing,
    terminalIndex,
    terminalLaunchInfo?.agentBranchRoot,
    terminalLaunchInfo?.workingDirectory,
    terminalState,
    thread?.coordination?.worktreePath,
    thread?.id,
    thread?.pendingPrompt,
    thread?.workspaceId,
    threadProviderModel,
    threadProviderSessionId,
    workingDirectory,
    workspace,
    workspace?.id,
  ]);

  const [terminalDropActive, setTerminalDropActive] = useState(false);

  useEffect(() => () => {
    pendingPromptSendTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    pendingPromptSendTimersRef.current.clear();
  }, []);

  const getDragDiagnosticFields = useCallback((event) => ({
    hasWorkspaceFileType: isWorkspaceFileDragTransfer(event.dataTransfer),
    hasTodoType: isTodoDragTransfer(event.dataTransfer),
    paneId,
    terminalIndex,
    threadId: terminalThreadIdRef.current || "",
    types: Array.from(event.dataTransfer?.types || []),
    workspaceId: workspace?.id || "",
  }), [paneId, terminalIndex, workspace?.id]);

  const handleTerminalRawDragEnterCapture = useCallback((event) => {
    logFileDragDiagnosticEvent("tui.raw_drag_enter_capture", getDragDiagnosticFields(event));
  }, [getDragDiagnosticFields]);

  const handleTerminalRawDragOverCapture = useCallback((event) => {
    logFileDragDiagnosticEvent("tui.raw_drag_over_capture", getDragDiagnosticFields(event));
  }, [getDragDiagnosticFields]);

  const handleTerminalRawDropCapture = useCallback((event) => {
    logFileDragDiagnosticEvent("tui.raw_drop_capture", getDragDiagnosticFields(event));
  }, [getDragDiagnosticFields]);

  const handleTerminalTodoDragEnter = useCallback((event) => {
    if (terminalClosed || terminalClosing) {
      return;
    }

    if (!isTodoDragTransfer(event.dataTransfer) && !isWorkspaceFileDragTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setTerminalDropActive(true);
    event.dataTransfer.dropEffect = "copy";
    if (isWorkspaceFileDragTransfer(event.dataTransfer)) {
      logFileDragDiagnosticEvent("tui.drag_enter", {
        paneId,
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
    }
  }, [paneId, terminalClosed, terminalClosing, terminalIndex, workspace?.id]);

  const handleTerminalTodoDragOver = useCallback((event) => {
    if (terminalClosed || terminalClosing) {
      return;
    }

    if (!isTodoDragTransfer(event.dataTransfer) && !isWorkspaceFileDragTransfer(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setTerminalDropActive(true);
    event.dataTransfer.dropEffect = "copy";
    if (isWorkspaceFileDragTransfer(event.dataTransfer)) {
      logFileDragDiagnosticEvent("tui.drag_over", {
        paneId,
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
    }
  }, [paneId, terminalClosed, terminalClosing, terminalIndex, workspace?.id]);

  const handleTerminalTodoDragLeave = useCallback((event) => {
    if (!isTodoDragTransfer(event.dataTransfer) && !isWorkspaceFileDragTransfer(event.dataTransfer)) {
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

    activateTerminalPane("todo_native_drop");

    if (isWorkspaceFileDragTransfer(event.dataTransfer)) {
      const workspaceFile = getDraggedWorkspaceFile(event.dataTransfer);
      const attachment = workspaceFileToComposerAttachment(workspaceFile, "tui_fileviewer_drop");
      const syncKey = getCurrentThreadComposerSyncKey(terminalInstanceIdRef.current || 0);
      logFileDragDiagnosticEvent("tui.drop_received", {
        attachmentCreated: Boolean(attachment),
        hasSyncKey: Boolean(syncKey),
        instanceId: terminalInstanceIdRef.current || "",
        paneId,
        relativePath: workspaceFile?.relativePath || attachment?.relativePath || "",
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
      if (attachment && syncKey) {
        appendWorkspaceThreadComposerAttachments(syncKey, [attachment], {
          fields: {
            agentId: terminalAgentKind,
            instanceId: terminalInstanceIdRef.current || "",
            paneId,
            relativePath: attachment.relativePath || "",
            terminalIndex,
            threadId: terminalThreadIdRef.current || "",
            workspaceId: workspace?.id || "",
          },
          source: "tui_fileviewer_drop",
        });
        logFileDragDiagnosticEvent("tui.attachment_appended", {
          attachmentName: attachment.name,
          attachmentPath: attachment.savedPath,
          kind: attachment.kind,
          paneId,
          relativePath: attachment.relativePath || "",
          syncKey,
          terminalIndex,
          threadId: terminalThreadIdRef.current || "",
          workspaceId: workspace?.id || "",
        });
        return;
      }
      logFileDragDiagnosticEvent("tui.drop_skip", {
        attachmentCreated: Boolean(attachment),
        hasSyncKey: Boolean(syncKey),
        paneId,
        reason: !attachment ? "missing_attachment" : "missing_sync_key",
        terminalIndex,
        workspaceId: workspace?.id || "",
      });
    }

    const droppedPlainText = String(event.dataTransfer?.getData?.("text/plain") || "");
    const prompt = getDraggedTodoPrompt(event.dataTransfer);
    logBigViewSyncDiagnosticEvent("tui.text.native_drop_received", {
      agentId: terminalAgentKind,
      dataTransferTypes: Array.from(event.dataTransfer?.types || []),
      instanceId: terminalInstanceIdRef.current || "",
      isGenericTerminal,
      paneId,
      plainText: getBigViewTextDiagnosticFields(droppedPlainText),
      promptText: getBigViewTextDiagnosticFields(prompt),
      terminalIndex,
      threadId: terminalThreadIdRef.current || "",
      workspaceId: workspace?.id || "",
    });
    if (!prompt) {
      logBigViewSyncDiagnosticEvent("tui.image.native_drop_skip", {
        agentId: terminalAgentKind,
        instanceId: terminalInstanceIdRef.current || "",
        isGenericTerminal,
        paneId,
        reason: "missing_prompt",
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
      logBigViewSyncDiagnosticEvent("tui.text.native_drop_skip", {
        agentId: terminalAgentKind,
        dataTransferTypes: Array.from(event.dataTransfer?.types || []),
        instanceId: terminalInstanceIdRef.current || "",
        isGenericTerminal,
        paneId,
        plainText: getBigViewTextDiagnosticFields(droppedPlainText),
        reason: "missing_prompt",
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
      return;
    }

    setTerminalError("");
    logBigViewSyncDiagnosticEvent("tui.image.native_drop_start", {
      agentId: terminalAgentKind,
      hasImageAttachmentBlock: prompt.includes("[image-attached"),
      instanceId: terminalInstanceIdRef.current || "",
      isGenericTerminal,
      paneId,
      promptLength: prompt.length,
      terminalIndex,
      threadId: terminalThreadIdRef.current || "",
      workspaceId: workspace?.id || "",
    });
    logBigViewSyncDiagnosticEvent("tui.text.native_drop_write_start", {
      agentId: terminalAgentKind,
      instanceId: terminalInstanceIdRef.current || "",
      isGenericTerminal,
      paneId,
      promptText: getBigViewTextDiagnosticFields(prompt),
      submittedInput: getBigViewTextDiagnosticFields(
        buildTerminalSubmittedInput(prompt, terminalAgentKind, isGenericTerminal),
      ),
      terminalIndex,
      threadId: terminalThreadIdRef.current || "",
      workspaceId: workspace?.id || "",
    });
    const promptEventId = createThreadProjectionToken("native-drop-prompt");
    const promptEventSubmittedAt = new Date().toISOString();
    const syncKey = getCurrentThreadComposerSyncKey(terminalInstanceIdRef.current || 0);
    const previousDraft = syncKey
      ? String(threadComposerDraftsRef.current.get(syncKey) || "")
      : "";
    const submitSequence = getTerminalSubmitSequence(terminalAgentKind, isGenericTerminal);
    const draftTransaction = syncKey
      ? setThreadComposerDraftValue(syncKey, prompt, "native_drop_submit_sync")
      : null;
    const syncData = buildTerminalComposerDraftInput(previousDraft, prompt, true);
    let submittedWaiter = null;

    try {
      submittedWaiter = submitSequence
        ? await createTerminalPromptSubmittedWaiter({
          allowObservedInputGateForHookManaged: true,
          agentId: terminalAgentKind,
          expectedPrompt: prompt,
          instanceId: terminalInstanceIdRef.current || undefined,
          paneId,
          promptId: promptEventId,
          requirePromptMatch: true,
          threadId: terminalThreadIdRef.current,
          workspaceId: workspace?.id || "",
        })
        : null;
      await invoke("terminal_write", {
        paneId,
        instanceId: terminalInstanceIdRef.current || undefined,
        data: `${syncData}${submitSequence}` || prompt,
        promptEventId: submitSequence ? promptEventId : undefined,
        promptEventSource: submitSequence ? "native-drop" : undefined,
        promptEventSubmittedAt: submitSequence ? promptEventSubmittedAt : undefined,
        promptEventText: submitSequence ? prompt : undefined,
        threadId: terminalThreadIdRef.current,
      });
      if (submittedWaiter) {
        await submittedWaiter.promise;
        recordSubmittedAgentMessage(terminalInstanceIdRef.current || 0, prompt, {
          messageCreatedAt: promptEventSubmittedAt,
          messageId: promptEventId,
          messageSource: "native-drop",
          promptEventId,
          source: "native-drop",
          turnId: `turn-${promptEventId}`,
        });
        if (syncKey) {
          clearWorkspaceThreadComposerDraftIfRevision(syncKey, draftTransaction?.revision || 0, {
            expectedValue: prompt,
            source: "native_drop_submit_observed_clear",
            transactionId: promptEventId,
          });
        }
      }
      logBigViewSyncDiagnosticEvent("tui.image.native_drop_write_done", {
        agentId: terminalAgentKind,
        draftRevision: draftTransaction?.revision || 0,
        hasImageAttachmentBlock: prompt.includes("[image-attached"),
        instanceId: terminalInstanceIdRef.current || "",
        paneId,
        promptLength: prompt.length,
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
      logBigViewSyncDiagnosticEvent("tui.text.native_drop_write_done", {
        agentId: terminalAgentKind,
        draftRevision: draftTransaction?.revision || 0,
        instanceId: terminalInstanceIdRef.current || "",
        paneId,
        promptText: getBigViewTextDiagnosticFields(prompt),
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
    } catch (error) {
      submittedWaiter?.cancel?.();
      if (syncKey) {
        const clearResult = clearWorkspaceThreadComposerDraftIfRevision(syncKey, draftTransaction?.revision || 0, {
          expectedValue: prompt,
          source: "native_drop_submit_error_clear",
          transactionId: promptEventId,
        });
        const clearInputData = clearResult.cleared
          ? buildTerminalComposerDraftInput(prompt, "", true)
          : "";
        if (clearInputData) {
          try {
            await invoke("terminal_write", {
              data: clearInputData,
              instanceId: terminalInstanceIdRef.current || undefined,
              paneId,
              threadId: terminalThreadIdRef.current,
            });
          } catch (_) {
            // Best-effort cleanup; the original send error is more useful to show.
          }
        }
      }
      setTerminalError(getErrorMessage(error, "Unable to send terminal input."));
      logBigViewSyncDiagnosticEvent("tui.image.native_drop_write_error", {
        agentId: terminalAgentKind,
        draftRevision: draftTransaction?.revision || 0,
        hasImageAttachmentBlock: prompt.includes("[image-attached"),
        instanceId: terminalInstanceIdRef.current || "",
        message: error?.message || String(error || ""),
        paneId,
        promptLength: prompt.length,
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
      logBigViewSyncDiagnosticEvent("tui.text.native_drop_write_error", {
        agentId: terminalAgentKind,
        draftRevision: draftTransaction?.revision || 0,
        instanceId: terminalInstanceIdRef.current || "",
        message: error?.message || String(error || ""),
        paneId,
        promptText: getBigViewTextDiagnosticFields(prompt),
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
    }
  }, [
    activateTerminalPane,
    getCurrentThreadComposerSyncKey,
    isGenericTerminal,
    paneId,
    recordSubmittedAgentMessage,
    setThreadComposerDraftValue,
    terminalAgentKind,
    terminalClosed,
    terminalClosing,
    terminalIndex,
    workspace?.id,
  ]);

  const terminalComposerSyncKey = getCurrentThreadComposerSyncKey();
  const terminalComposerAttachments = terminalComposerSyncKey
    ? threadComposerAttachments[terminalComposerSyncKey] || []
    : [];

  useEffect(() => {
    logBigViewSyncDiagnosticEvent("tui.image.attachment_overlay_state", {
      agentId: terminalAgentKind,
      attachmentCount: terminalComposerAttachments.length,
      attachments: terminalComposerAttachments.slice(0, 8).map((attachment) => ({
        dataUrlLength: String(attachment?.dataUrl || "").length,
        id: String(attachment?.id || ""),
        mimeType: String(attachment?.mimeType || ""),
        name: String(attachment?.name || ""),
        size: Number(attachment?.size || 0),
        source: String(attachment?.source || ""),
        status: String(attachment?.status || ""),
      })),
      hasSyncKey: Boolean(terminalComposerSyncKey),
      instanceId: terminalInstanceIdRef.current || "",
      paneId,
      syncKey: terminalComposerSyncKey,
      terminalIndex,
      threadId: terminalThreadIdRef.current || "",
      workspaceId: workspace?.id || "",
    });
  }, [
    paneId,
    terminalAgentKind,
    terminalComposerAttachments,
    terminalComposerSyncKey,
    terminalIndex,
    workspace?.id,
  ]);

  const pointerTodoDropVisible = Boolean(todoDropActive && todoDropTarget) && !terminalClosed && !terminalClosing;
  const nativeTodoDropVisible = terminalDropActive && !terminalClosed && !terminalClosing;
  const todoDropOverlayVisible = pointerTodoDropVisible || nativeTodoDropVisible;
  const todoDropOverlayTarget = nativeTodoDropVisible || Boolean(todoDropTarget);
  const todoDropOverlayUnsupportedMessage = todoDropOverlayTarget
    ? String(todoDropUnsupportedMessage || "").trim()
    : "";

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
    onThreadTerminalLifecycle?.({
      instanceId: terminalInstanceIdRef.current || undefined,
      ...getTerminalNativeRailStateFields("closing"),
      paneId,
      status: "closing",
      terminalIndex,
      threadId: terminalThreadIdRef.current,
      type: "closing",
      workspaceId: workspace?.id || "",
    });

    try {
      setTerminalAudioInputTarget(false, terminalInstanceIdRef.current || 0, "terminal_close");
      await invoke("terminal_close", {
        paneId,
        instanceId: terminalInstanceIdRef.current || undefined,
        waitForCleanup: true,
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
      onThreadTerminalLifecycle?.({
        instanceId: terminalInstanceIdRef.current || undefined,
        ...getTerminalNativeRailStateFields("error"),
        paneId,
        status: "error",
        terminalIndex,
        threadId: terminalThreadIdRef.current,
        type: "error",
        workspaceId: workspace?.id || "",
      });
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
    onThreadTerminalLifecycle?.({
      instanceId: terminalInstanceIdRef.current || undefined,
      ...getTerminalNativeRailStateFields("closed"),
      paneId,
      terminalIndex,
      threadId: terminalThreadIdRef.current,
      type: "closed",
      workspaceId: workspace?.id || "",
    });
    onCloseTerminal?.({
      paneId,
      threadId: terminalThreadIdRef.current,
      terminalIndex,
      workspaceId: workspace?.id || "",
    });
  }, [onCloseTerminal, onThreadTerminalLifecycle, paneId, setTerminalAudioInputTarget, terminalClosed, terminalIndex, workspace?.id]);

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

  const detachThreadForNewTerminalSession = useCallback((target = {}) => {
    const targetWorkspaceId = String(target.workspaceId || workspace?.id || "").trim();
    const targetTerminalIndex = Number.parseInt(target.terminalIndex ?? terminalIndex, 10);
    if (!targetWorkspaceId || !Number.isInteger(targetTerminalIndex)) {
      return false;
    }

    onThreadTerminalLifecycle?.({
      agentId: getTerminalAgentKind(target.agentId || terminalAgentKind),
      forgetTerminalThread: true,
      instanceId: target.instanceId || undefined,
      paneId: target.paneId || "",
      rememberTerminalThread: false,
      status: "closed",
      terminalIndex: targetTerminalIndex,
      threadId: String(target.threadId || "").trim(),
      type: "closed",
      workspaceId: targetWorkspaceId,
    });
    return true;
  }, [onThreadTerminalLifecycle, terminalAgentKind, terminalIndex, workspace?.id]);

  const restartTerminalAs = useCallback((roleId = terminalAgentKind) => {
    if (terminalClosing) {
      return;
    }

    const nextRoleId = String(roleId || terminalAgentKind).toLowerCase();
    const nextSessionMode = defaultTerminalSessionModeForRole(nextRoleId);
    terminalSessionModeRef.current = nextSessionMode;
    terminalSessionModeExplicitRef.current = true;
    setTerminalSessionMode(nextSessionMode);
    setRestartRoleMenuOpen(false);

    detachThreadForNewTerminalSession({
      agentId: terminalAgentKind,
      instanceId: terminalInstanceIdRef.current || undefined,
      paneId,
      terminalIndex,
      threadId: terminalThreadIdRef.current || thread?.id || "",
      workspaceId: workspace?.id || "",
    });
    const nextThreadId = createWorkspaceThreadId(workspace?.id || "", terminalIndex);

    if (nextRoleId && nextRoleId !== terminalAgentKind) {
      pendingThreadStartingLifecycleRef.current = {
        agentId: nextRoleId,
        paneId,
        repoPath: workingDirectory || "",
        terminalIndex,
        threadId: nextThreadId,
        workspaceId: workspace?.id || "",
        workspaceName: workspace?.name || "",
      };
      terminalThreadIdRef.current = nextThreadId;
      terminalThreadSlotKeyRef.current = String(Math.max(0, Number.parseInt(terminalIndex, 10) || 0) + 1);
      resetTerminalReadinessForEpoch({
        activityStatus: "idle",
        instanceId: 0,
        reason: "terminal_restart_role_change",
        threadId: nextThreadId,
      });
      onChangeTerminalRole?.({
        role: nextRoleId,
        source: "terminal_restart_menu_new_session",
        startNewSession: true,
        terminalIndex,
        workspaceId: workspace?.id || "",
      });
      return;
    }

    restartWithEmptyTerminalSession({
      agentId: nextRoleId || terminalAgentKind,
      nextThreadId,
      statusDetail: "Starting a new terminal session.",
    });
  }, [
    detachThreadForNewTerminalSession,
    onChangeTerminalRole,
    paneId,
    restartWithEmptyTerminalSession,
    terminalAgentKind,
    terminalClosing,
    terminalIndex,
    thread,
    workingDirectory,
    workspace?.id,
    workspace?.name,
  ]);

  const canSplitTerminal = !threadsViewActive && terminalCount < MAX_WORKSPACE_TERMINAL_COUNT;
  const canOpenTerminalUiView = !threadsViewActive && !terminalClosed && !terminalClosing && Boolean(thread);
  const focusTerminalKeyboardInputAfterUiHide = useCallback(() => {
    const focusAfterHide = () => {
      if (terminalUiViewActiveRef.current) {
        return;
      }

      focusTerminalKeyboardInput(true);
    };

    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focusAfterHide);
      return;
    }

    window.setTimeout(focusAfterHide, 0);
  }, [focusTerminalKeyboardInput]);
  const toggleTerminalUiView = useCallback(() => {
    if (!canOpenTerminalUiView && !terminalUiViewActive) {
      return;
    }

    const nextUiViewActive = !terminalUiViewActive;
    activateTerminalPane("terminal_ui_view_toggle", { focusKeyboard: false });
    terminalUiViewActiveRef.current = nextUiViewActive;
    setTerminalUiViewActive(nextUiViewActive);
    if (!nextUiViewActive) {
      focusTerminalKeyboardInputAfterUiHide();
    }
  }, [
    activateTerminalPane,
    canOpenTerminalUiView,
    focusTerminalKeyboardInputAfterUiHide,
    terminalUiViewActive,
  ]);
  const setTerminalUiViewFromArrowShortcut = useCallback((nextUiViewActive) => {
    if (nextUiViewActive) {
      if (!canOpenTerminalUiView || terminalUiViewActiveRef.current) {
        return false;
      }

      activateTerminalPane("terminal_ui_view_arrow_shortcut", { focusKeyboard: false });
    } else {
      if (!terminalUiViewActiveRef.current) {
        return false;
      }

      activateTerminalPane("terminal_tui_view_arrow_shortcut", { focusKeyboard: false });
    }

    terminalUiViewActiveRef.current = nextUiViewActive;
    setTerminalUiViewActive(nextUiViewActive);
    if (!nextUiViewActive) {
      focusTerminalKeyboardInputAfterUiHide();
    }
    return true;
  }, [
    activateTerminalPane,
    canOpenTerminalUiView,
    focusTerminalKeyboardInputAfterUiHide,
  ]);
  useEffect(() => {
    if (terminalClosed || terminalClosing) {
      return undefined;
    }

    const handleTerminalViewArrowShortcut = (event) => {
      if (
        event.key !== "ArrowLeft"
        && event.key !== "ArrowRight"
      ) {
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
        return;
      }

      if (isTerminalViewArrowShortcutEditableTarget(event.target, containerRef.current)) {
        return;
      }

      const terminalInstanceId = terminalInstanceIdRef.current || 0;
      if (!isActive && !terminalKeyboardTargetMatches(paneId, terminalInstanceId)) {
        return;
      }

      const didChangeView = setTerminalUiViewFromArrowShortcut(event.key === "ArrowRight");
      if (!didChangeView) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
    };

    window.addEventListener("keydown", handleTerminalViewArrowShortcut, true);
    return () => {
      window.removeEventListener("keydown", handleTerminalViewArrowShortcut, true);
    };
  }, [
    isActive,
    paneId,
    setTerminalUiViewFromArrowShortcut,
    terminalClosed,
    terminalClosing,
  ]);
  useEffect(() => {
    if (!thread || terminalClosed || terminalClosing) {
      setTerminalUiViewActive(false);
    }
  }, [terminalClosed, terminalClosing, thread]);
  const splitTerminal = useCallback((direction) => {
    if (threadsViewActive || terminalClosed || terminalClosing || !canSplitTerminal) {
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
    threadsViewActive,
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
  const handleTerminalCloseButtonClick = threadsViewActive ? toggleTerminalFullscreen : closeTerminal;
  const beginTerminalDrag = useCallback((event) => {
    requestTerminalDragFromEvent(event);
  }, [requestTerminalDragFromEvent]);

  const terminalStatusErrorDetails = [
    workspaceError,
    terminalError,
    agentStatusError,
  ].filter(Boolean);
  const hasTerminalStatusError = terminalStatusErrorDetails.length > 0;
  const isTerminalStatusErrorOverlay = hasTerminalStatusError || terminalState === "error";
  const isTerminalStatusFinalOverlay = terminalState === "exited";
  const showTerminalStatusSpinner = !isTerminalStatusErrorOverlay && !isTerminalStatusFinalOverlay;
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
  const terminalStateDebugLabel = formatTerminalNativeRailLabel(resolveTerminalNativeRailState({
    activityStatus: terminalThreadActivityStatus,
    parked: Boolean(parkedPrompt),
    terminalState,
  }));

  // Window Breakout bridge: while this pane lives in its own native window,
  // the grid pane (still mounted as the placeholder) stays the source of
  // truth. It broadcasts the header identity/state the window renders, and
  // executes the control clicks the window sends back, so the breakout bar
  // is the exact in-grid bar and the PTY/agent never notices either move.
  const windowBreakoutMetaSignature = windowBreakoutHosted && paneId
    ? JSON.stringify({
      agentKind: terminalAgentKind,
      agentLabel: terminalRailAgentLabel,
      agentTitle: terminalRailAgentTitle,
      canOpenUiView: canOpenTerminalUiView,
      canSplit: canSplitTerminal,
      colorSlot: getTerminalAgentColorSlot(terminalIndex),
      paneId,
      roleOptions: getTerminalRoleSwitchOptions(agentStatuses)
        .map((option) => ({ id: option.id, label: option.label })),
      stateLabel: terminalStateDebugLabel,
    })
    : "";

  useEffect(() => {
    if (!windowBreakoutMetaSignature) {
      return undefined;
    }

    const meta = JSON.parse(windowBreakoutMetaSignature);
    emit(TERMINAL_WINDOW_META_EVENT, meta).catch(() => {});

    let disposed = false;
    let unlisten = () => {};
    listen(TERMINAL_WINDOW_META_REQUEST_EVENT, (event) => {
      if (disposed || String(event.payload?.paneId || "") !== meta.paneId) {
        return;
      }
      emit(TERMINAL_WINDOW_META_EVENT, meta).catch(() => {});
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten();
    };
  }, [windowBreakoutMetaSignature]);

  useEffect(() => {
    if (!windowBreakoutHosted || !paneId) {
      return undefined;
    }

    let disposed = false;
    let unlisten = () => {};
    listen(TERMINAL_WINDOW_CONTROL_EVENT, (event) => {
      if (disposed || String(event.payload?.paneId || "") !== paneId) {
        return;
      }

      const returnPaneToApp = () => {
        invoke("terminal_window_close", { paneId }).catch(() => {});
        getCurrentWindow().setFocus().catch(() => {});
      };

      switch (String(event.payload?.control || "")) {
        case TERMINAL_WINDOW_CONTROL_CLOSE_TERMINAL:
          closeTerminal();
          break;
        case TERMINAL_WINDOW_CONTROL_RESTART_AS:
          restartTerminalAs(String(event.payload?.roleId || "") || undefined);
          break;
        case TERMINAL_WINDOW_CONTROL_SPLIT_HORIZONTAL:
          splitTerminalHorizontal();
          break;
        case TERMINAL_WINDOW_CONTROL_SPLIT_VERTICAL:
          splitTerminalVertical();
          break;
        case TERMINAL_WINDOW_CONTROL_UI_VIEW:
          returnPaneToApp();
          toggleTerminalUiView();
          break;
        case TERMINAL_WINDOW_CONTROL_FULLSCREEN:
          returnPaneToApp();
          toggleTerminalFullscreen();
          break;
        default:
          break;
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten();
    };
  }, [
    closeTerminal,
    paneId,
    restartTerminalAs,
    splitTerminalHorizontal,
    splitTerminalVertical,
    toggleTerminalFullscreen,
    toggleTerminalUiView,
    windowBreakoutHosted,
  ]);

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
      data-active={isActive ? "true" : "false"}
      data-terminal-breakout={terminalBreakoutActive ? "true" : undefined}
      data-scrollbar-platform={TERMINAL_SCROLLBAR_PLATFORM}
      data-parked={parkedPrompt ? "true" : "false"}
      onDragEnterCapture={handleTerminalRawDragEnterCapture}
      onDragEnter={handleTerminalTodoDragEnter}
      onDragLeave={handleTerminalTodoDragLeave}
      onDragOverCapture={handleTerminalRawDragOverCapture}
      onDragOver={handleTerminalTodoDragOver}
      onDropCapture={handleTerminalRawDropCapture}
      onDrop={handleTerminalTodoDrop}
      onPaste={(event) => queueClipboardImagesForCurrentTerminal(event, "xterm_surface")}
      ref={containerRef}
    />
  );
  const terminalUiViewShouldRender = Boolean(thread)
    && !terminalClosed
    && !terminalClosing
    && terminalUiViewActive;
  const restartMenuAgentKind = terminalAgentKind;
  const restartRoleOptions = getTerminalRoleSwitchOptions(agentStatuses);

  return (
    <TerminalWorkspaceSurface
      data-focused={isActive ? "true" : "false"}
      data-pane-id={paneId}
      data-terminal-fullscreen={isFullscreen ? "true" : undefined}
      data-terminal-fullscreen-state={isFullscreen ? fullscreenState : undefined}
      data-terminal-breakout={terminalBreakoutActive ? "true" : undefined}
      data-terminal-index={terminalIndex}
      data-threads-view={threadsViewActive ? "true" : undefined}
      data-ui-view={terminalUiViewActive ? "true" : undefined}
      onFocusCapture={handleTerminalSurfaceFocusCapture}
      onPointerDownCapture={handleTerminalSurfacePointerDownCapture}
      ref={surfaceRef}
    >
      <TerminalRestartPill data-terminal-control="true">
        <TerminalRailIdentity>
          {/* Drag handle lives at the far left of the rail, away from the
              destructive close button on the right. */}
          <TerminalRestartButton
            aria-label="Drag terminal"
            data-terminal-drag-handle="true"
            disabled={terminalClosed || terminalClosing || isFullscreen || (!terminalBreakoutActive && terminalCount <= 1)}
            onPointerDown={beginTerminalDrag}
            title={isFullscreen ? "Exit fullscreen to reorder terminals" : "Drag terminal"}
            type="button"
          >
            <ButtonDragIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalAgentDot
            aria-hidden="true"
            data-agent={terminalAgentKind}
            data-slot={getTerminalAgentColorSlot(terminalIndex)}
            title={terminalRailAgentTitle}
          />
          <TerminalAgentLabel title={terminalRailAgentTitle}>
            {terminalRailAgentLabel}
          </TerminalAgentLabel>
          <TerminalStateDebugBadge title={`Terminal state: ${terminalStateDebugLabel}`}>
            {terminalStateDebugLabel}
          </TerminalStateDebugBadge>
          <TerminalAccountStaleChip agentKind={terminalAgentKind} paneId={paneId} />
        </TerminalRailIdentity>
        <TerminalRailControls data-rail-row="primary">
          <TerminalCloseButton
            aria-label={threadsViewActive ? "Exit threads view" : "Close terminal"}
            disabled={terminalClosed || terminalClosing}
            onClick={handleTerminalCloseButtonClick}
            title={threadsViewActive ? "Exit threads view" : "Close terminal"}
            type="button"
          >
            <ButtonCloseIcon aria-hidden="true" />
          </TerminalCloseButton>
        </TerminalRailControls>
        <TerminalRailControls data-rail-row="secondary">
          <TerminalRestartButton
            aria-label={terminalUiViewActive ? "Show terminal view" : "Show UI view"}
            aria-pressed={terminalUiViewActive ? "true" : "false"}
            data-active={terminalUiViewActive ? "true" : undefined}
            disabled={!canOpenTerminalUiView && !terminalUiViewActive}
            onClick={toggleTerminalUiView}
            title={
              terminalUiViewActive
                ? "Show terminal view"
                : canOpenTerminalUiView
                  ? "Show UI view"
                  : threadsViewActive
                    ? "Exit threads view first"
                    : "No thread available"
            }
            type="button"
          >
            <ButtonBrowserIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Open this terminal in its own window"
            disabled={
              terminalClosed
              || terminalClosing
              || threadsViewActive
              || windowBreakoutHosted
              || !paneId
              || typeof onPopOutTerminalWindow !== "function"
            }
            onClick={() => onPopOutTerminalWindow?.(terminalIndex, paneId)}
            title={
              windowBreakoutHosted
                ? "Already open in its own window"
                : threadsViewActive
                  ? "Exit threads view to pop out"
                  : "Open this terminal in its own window"
            }
            type="button"
          >
            <ButtonPopOutIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Decrease terminal font size"
            disabled={
              terminalClosed
              || terminalClosing
              || windowBreakoutHosted
              || terminalFontSize <= TERMINAL_FONT_SIZE_MIN
            }
            onClick={() => adjustTerminalFontSize(-TERMINAL_FONT_SIZE_STEP)}
            title={`Decrease terminal font size (${terminalFontSize}px)`}
            type="button"
          >
            <ButtonFontMinusIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Increase terminal font size"
            disabled={
              terminalClosed
              || terminalClosing
              || windowBreakoutHosted
              || terminalFontSize >= TERMINAL_FONT_SIZE_MAX
            }
            onClick={() => adjustTerminalFontSize(TERMINAL_FONT_SIZE_STEP)}
            title={`Increase terminal font size (${terminalFontSize}px)`}
            type="button"
          >
            <ButtonFontPlusIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Split terminal horizontally"
            disabled={threadsViewActive || terminalClosed || terminalClosing || !canSplitTerminal}
            onClick={splitTerminalHorizontal}
            title={threadsViewActive ? "Exit threads view to split" : canSplitTerminal ? "Split terminal horizontally" : "Terminal limit reached"}
            type="button"
          >
            <ButtonSplitHorizontalIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label="Split terminal vertically"
            disabled={threadsViewActive || terminalClosed || terminalClosing || !canSplitTerminal}
            onClick={splitTerminalVertical}
            title={threadsViewActive ? "Exit threads view to split" : canSplitTerminal ? "Split terminal vertically" : "Terminal limit reached"}
            type="button"
          >
            <ButtonSplitVerticalIcon aria-hidden="true" />
          </TerminalRestartButton>
          <TerminalRestartButton
            aria-label={isFullscreen ? "Exit terminal fullscreen" : "Open terminal threads"}
            disabled={terminalClosed || terminalClosing}
            onClick={toggleTerminalFullscreen}
            title={isFullscreen ? "Exit fullscreen" : "Open terminal threads"}
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
              aria-label={threadsViewActive ? "Start new session" : "Restart terminal"}
              disabled={terminalClosed || terminalClosing}
              onClick={() => setRestartRoleMenuOpen((isOpen) => !isOpen)}
              title={threadsViewActive ? "Start a new session in this terminal" : "Restart terminal or choose runtime"}
              type="button"
            >
              <ButtonRefreshIcon aria-hidden="true" />
            </TerminalRestartButton>
              <TerminalRestartDropdown data-open={restartRoleMenuOpen ? "true" : "false"} role="menu">
                {restartRoleOptions.map((option) => {
                  const optionSelected = option.id === restartMenuAgentKind;
                  return (
                    <TerminalRestartOption
                      data-role={option.id}
                      data-selected={optionSelected ? "true" : "false"}
                      key={option.id}
                      onClick={() => restartTerminalAs(option.id)}
                      role="menuitem"
                      title={threadsViewActive ? `Start new ${option.label} session` : `Restart as ${option.label}`}
                      type="button"
                    >
                      <strong>
                        {threadsViewActive
                          ? option.id === restartMenuAgentKind
                            ? `Restart ${option.label}`
                            : `New ${option.label} session`
                          : option.id === terminalAgentKind
                            ? `Restart ${option.label}`
                            : option.label}
                      </strong>
                    </TerminalRestartOption>
                  );
                })}
              </TerminalRestartDropdown>
          </TerminalRestartMenu>
        </TerminalRailControls>
        </TerminalRestartPill>

      <TerminalFrame
        aria-busy={terminalClosing ? "true" : "false"}
        data-terminal-breakout={terminalBreakoutActive ? "true" : undefined}
        data-state={terminalState}
        data-drop-active={todoDropOverlayTarget ? "true" : "false"}
        onDragEnter={handleTerminalTodoDragEnter}
        onDragLeave={handleTerminalTodoDragLeave}
        onDragOver={handleTerminalTodoDragOver}
        onDrop={handleTerminalTodoDrop}
        onPasteCapture={(event) => queueClipboardImagesForCurrentTerminal(event, "terminal_frame")}
      >
        {terminalClosed ? (
          <TerminalClosedSurface aria-live="polite" role="status">
            <TerminalClosedLabel>Terminal Closed</TerminalClosedLabel>
          </TerminalClosedSurface>
        ) : (
          <>
            {xtermSurface}
            {terminalUiViewShouldRender && (
              <TerminalInlineUiView
                aria-hidden={terminalUiViewActive ? undefined : "true"}
                data-active={terminalUiViewActive ? "true" : "false"}
                data-terminal-control="true"
                onFocusCapture={handleTerminalUiViewFocusCapture}
                onPointerDownCapture={handleTerminalUiViewPointerDownCapture}
              >
                <WorkspaceThreadDetail
                  agentStatuses={agentStatuses}
                  composerAttachments={threadComposerAttachments}
                  composerDrafts={threadComposerDrafts}
                  composerFocusToken={terminalUiComposerFocusToken}
                  density="compact"
                  onCreateChat={createWorkspaceThreadChat}
                  onDraftInput={syncWorkspaceThreadComposerInput}
                  onSelectModel={changeWorkspaceThreadModel}
                  onSubmitMessage={submitWorkspaceThreadMessage}
                  thread={thread}
                  todoDropActive={todoDropActive}
                  todoDropTarget={todoDropTarget}
	                  todoDropUnsupportedMessage={todoDropUnsupportedMessage}
	                  visible={terminalUiViewActive}
	                  workspace={workspace}
                  workspaceRoot={workingDirectory}
                  workspaceThreadEntry={workspaceThreadEntry}
                />
              </TerminalInlineUiView>
            )}
            {terminalComposerAttachments.length > 0 && (
              <div
                aria-label="Queued image attachments"
                data-terminal-control="true"
                style={{
                  position: "absolute",
                  top: 10,
                  right: 12,
                  left: 12,
                  zIndex: 38,
                  display: "grid",
                  gap: 7,
                  maxHeight: "34%",
                  overflow: "auto",
                  padding: "8px 9px",
                  border: "1px solid rgba(250, 204, 21, 0.28)",
                  borderRadius: 10,
                  color: "#f8fafc",
                  background: "linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.86))",
                  boxShadow: "0 12px 34px rgba(0, 0, 0, 0.34)",
                  pointerEvents: "auto",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    minWidth: 0,
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    color: "#fde68a",
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                  }}
                >
                  <span>{terminalComposerAttachments.length} image queued</span>
                  <span style={{ color: "rgba(253, 230, 138, 0.64)", fontWeight: 700 }}>not sent yet</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    minWidth: 0,
                    flexWrap: "wrap",
                    gap: 7,
                  }}
                >
                  {terminalComposerAttachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      title={attachment.name}
                      style={{
                        display: "grid",
                        width: 138,
                        gridTemplateColumns: "38px minmax(0, 1fr) 18px",
                        alignItems: "center",
                        gap: 7,
                        border: "1px solid rgba(255, 255, 255, 0.13)",
                        borderRadius: 8,
                        padding: 5,
                        background: "rgba(255, 255, 255, 0.06)",
                      }}
                    >
                      {attachment.dataUrl ? (
                        <img
                          alt=""
                          draggable={false}
                          src={attachment.dataUrl}
                          style={{
                            width: 38,
                            height: 32,
                            borderRadius: 6,
                            objectFit: "cover",
                            background: "rgba(255, 255, 255, 0.08)",
                          }}
                        />
                      ) : (
                        <span
                          aria-hidden="true"
                          style={{
                            display: "grid",
                            width: 38,
                            height: 32,
                            placeItems: "center",
                            borderRadius: 6,
                            background: "rgba(255, 255, 255, 0.08)",
                            color: "#fde68a",
                            fontSize: 14,
                            fontWeight: 900,
                          }}
                        >
                          IMG
                        </span>
                      )}
                      <span
                        style={{
                          minWidth: 0,
                          overflow: "hidden",
                          color: "#f8fafc",
                          fontSize: 11,
                          fontWeight: 720,
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {attachment.name || "image"}
                      </span>
                      <button
                        aria-label={`Remove ${attachment.name || "image"}`}
                        onClick={() => {
                          removeWorkspaceThreadComposerAttachment(terminalComposerSyncKey, attachment.id, {
                            fields: {
                              agentId: terminalAgentKind,
                              paneId,
                              terminalIndex,
                              threadId: terminalThreadIdRef.current || "",
                              workspaceId: workspace?.id || "",
                            },
                            source: "tui_terminal_overlay",
                          });
                        }}
                        style={{
                          display: "grid",
                          width: 18,
                          height: 18,
                          placeItems: "center",
                          padding: 0,
                          border: 0,
                          borderRadius: 5,
                          color: "#cbd5e1",
                          background: "rgba(255, 255, 255, 0.08)",
                          cursor: "pointer",
                          fontSize: 14,
                          lineHeight: 1,
                        }}
                        title="Remove queued image"
                        type="button"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <WorkspaceThreadsOverlay
              agentStatuses={agentStatuses}
              composerAttachments={threadComposerAttachments}
              composerDrafts={threadComposerDrafts}
              onActiveThreadChange={handleThreadsViewActiveThreadChange}
              onClose={toggleTerminalFullscreen}
              onCreateChat={createWorkspaceThreadChat}
              onArchiveThread={onArchiveWorkspaceThread}
              onDraftInput={syncWorkspaceThreadComposerInput}
              onSelectModel={changeWorkspaceThreadModel}
              onSelectThread={onSelectWorkspaceThread}
              onSubmitMessage={submitWorkspaceThreadMessage}
              onTogglePinnedThread={onToggleWorkspaceThreadPinned}
              onViewStateChange={onWorkspaceThreadsViewStateChange}
              open={threadsViewActive}
              selectedThreadId={selectedWorkspaceThreadId || terminalThreadId}
              selectedWorkspaceId={workspace?.id || ""}
              todoDropActive={todoDropActive}
              todoDropTarget={todoDropTarget}
              todoDropUnsupportedMessage={todoDropUnsupportedMessage}
              viewState={workspaceThreads?.[workspace?.id || ""]?.threadsView}
              workspaceRoot={workingDirectory}
              workspaceThreads={workspaceThreads}
              workspaces={workspaces}
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
                  {showTerminalStatusSpinner && <TerminalStatusSpinner aria-hidden="true" />}
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
                          <TerminalParkedAgentBadge
                            aria-label={getParkedWaitingOnLabel(agent)}
                            data-slot={getParkedWaitingOnColorSlot(agent)}
                            key={`${agent.slotKey || agent.agentId || agent.agentLabel || "agent"}-${index}`}
                            role="img"
                            title={getParkedWaitingOnLabel(agent)}
                          />
                        ))
                        : (
                          <TerminalParkedAgentBadge
                            aria-label="peer terminal"
                            data-slot="unknown"
                            role="img"
                            title="peer terminal"
                          />
                        )}
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
                  ...(todoDropOverlayUnsupportedMessage ? TODO_DROP_OVERLAY_UNSUPPORTED_STYLE : {}),
                }}
              >
                {todoDropOverlayTarget && (
                  <div
                    style={{
                      ...TODO_DROP_OVERLAY_LABEL_STYLE,
                      ...(todoDropOverlayUnsupportedMessage ? TODO_DROP_OVERLAY_UNSUPPORTED_LABEL_STYLE : {}),
                    }}
                  >
                    {todoDropOverlayUnsupportedMessage || "Drop here"}
                  </div>
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

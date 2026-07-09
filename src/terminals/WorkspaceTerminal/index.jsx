import { Channel, invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal as XTerm } from "@xterm/xterm";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  getAgentLaunchDefault,
  resolveAgentLaunchDefaultForModel,
} from "../../agents/agentLaunchDefaults.js";
import {
  collapseFunctionalRepoPathToCoreRepoPath,
  createCoreRepoNameDisplayMasker,
} from "../coreRepoNameDisplay";
import {
  TERMINAL_WINDOW_CONTROL_CLOSE_TERMINAL,
  TERMINAL_WINDOW_CONTROL_EVENT,
  TERMINAL_WINDOW_CONTROL_FONT_SIZE,
  TERMINAL_WINDOW_CONTROL_FORK,
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
import { SshClientPicker } from "../../ssh/SshClientPicker.jsx";
import { guardXtermDuringPushToTalk } from "../xtermPushToTalkGuard.js";
import {
  REMOTE_PERMISSION_CONFIG_REQUEST_EVENT,
  REMOTE_PERMISSION_CONFIG_RESULT_EVENT,
  REMOTE_PERMISSION_CONFIG_SOURCE,
  claudePermissionModeFromText,
  claudePermissionTargetAvailableInCycle,
  codexPermissionPickerOpen,
  codexPermissionPostSelectionState,
  cyclePermissionModeWithBestEffortRestore,
  findCodexPermissionPickerTarget,
  normalizePermissionModeForProvider,
  opencodeAgentModeFromText,
} from "../permissionModeAutomation.js";
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
  TERMINAL_FORK_REQUESTED_EVENT,
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
  TERMINAL_OUTPUT_FLUSH_HIDDEN_MAX_BYTES,
  TERMINAL_OUTPUT_FLUSH_MIN_BYTES,
  TERMINAL_OUTPUT_HIDDEN_BATCH_MAX_BYTES,
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
  TERMINAL_ACTIVITY_HOOK_EVENT,
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

const WORKSPACE_THREAD_MODEL_CHANGE_CONFIRM_TIMEOUT_MS = 15_000;
const WORKSPACE_THREAD_MODEL_CHANGE_CONFIRM_POLL_MS = 250;

function getWorkspaceThreadObservedModelChange(workspaceThreads, {
  agentId,
  threadId,
  workspaceId,
} = {}) {
  const safeWorkspaceId = String(workspaceId || "").trim();
  const safeThreadId = String(threadId || "").trim();
  const safeAgentId = getTerminalAgentKind(agentId);
  const observedThread = workspaceThreads?.[safeWorkspaceId]?.threads?.[safeThreadId] || null;
  const providerBinding = getWorkspaceThreadProviderBinding(observedThread, safeAgentId);
  return {
    model: String(
      providerBinding?.modelId
        || providerBinding?.model
        || providerBinding?.activeModel
        || "",
    ).trim(),
    modelSource: String(providerBinding?.modelSource || "").trim(),
    modelUpdatedAt: String(providerBinding?.modelUpdatedAt || "").trim(),
    providerSessionId: String(providerBinding?.nativeSessionId || "").trim(),
  };
}

function workspaceThreadModelChangeMatchesObservation(observation, {
  initialObservation,
  model,
  requireFreshObservation = false,
} = {}) {
  const requestedModel = String(model || "").trim();
  if (!requestedModel || observation?.model !== requestedModel) {
    return false;
  }
  if (!requireFreshObservation) {
    return true;
  }
  return Boolean(
    observation.modelUpdatedAt
      && observation.modelUpdatedAt !== String(initialObservation?.modelUpdatedAt || "").trim(),
  );
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

const APP_CONTROL_TERMINAL_WORKSPACE_IDS = new Set([
  "__diffforge_app_control__",
  "diffforge_app_control",
]);
const APP_CONTROL_TERMINAL_PANE_ID = "forge-app-control-agent-terminal";
const PENDING_PROMPT_SUBMIT_SYNC_SETTLE_MS = 120;
const PENDING_PROMPT_SUBMIT_OBSERVE_TIMEOUT_MS = 3000;
const PENDING_PROMPT_SUBMIT_RETRY_TIMEOUT_MS = 6000;
const PENDING_PROMPT_SUBMIT_FALLBACK_ACCEPT_GRACE_MS = 700;
const PENDING_PROMPT_SUBMIT_OBSERVED_ACCEPT_GRACE_MS = 1800;

function normalizeAppControlTerminalWorkspaceId(value) {
  return String(value || "").trim().toLowerCase();
}

function isAppControlTerminalSurface({ paneId, workspaceId } = {}) {
  const normalizedWorkspaceId = normalizeAppControlTerminalWorkspaceId(workspaceId);
  const normalizedPaneId = String(paneId || "").trim();
  return (
    APP_CONTROL_TERMINAL_WORKSPACE_IDS.has(normalizedWorkspaceId)
    || normalizedPaneId === APP_CONTROL_TERMINAL_PANE_ID
  );
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
    appForkEnabled: payload?.appForkEnabled === true,
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
const TERMINAL_PREWARM_PTY_REVEAL_SETTLE_MS = 520;
const TERMINAL_PREWARM_AGENT_DIRECT_OPEN_TIMEOUT_MS = 12000;
const TERMINAL_THREAD_PROMPT_READY_ACTIVITY_MS = 250;
const TERMINAL_THREAD_PROMPT_READY_EARLY_MIN_MS = 120;
const TERMINAL_THREAD_PROMPT_READY_MIN_MS = 450;
const TERMINAL_THREAD_PROMPT_ECHO_READY_SUPPRESS_MS = 2500;
const TERMINAL_THREAD_PROMPT_ECHO_MIN_SUPPRESS_MS = 600;
const TERMINAL_PARKED_PROMPT_BLOCKING_STATUSES = new Set(["parked", "resume_ready", "resume_requested"]);
const TERMINAL_WEBGL_LRU_CAP = 12;
const TERMINAL_RENDERER_ATTACH_MAX_PER_FRAME = 2;
const terminalWebglAddonRegistry = new Map();
let terminalWebglAddonRegistrySequence = 0;
// xterm's WebglAddon.dispose() is not idempotent; terminal cleanup can reach
// an addon through both the registry closure and the per-addon disposable.
const disposedTerminalWebglAddons = new WeakSet();

function disposeTerminalWebglAddonOnce(addon) {
  if (!addon || disposedTerminalWebglAddons.has(addon)) {
    return false;
  }
  disposedTerminalWebglAddons.add(addon);
  try {
    addon.dispose();
  } catch (_error) {
    // WebGL disposal is best effort; xterm keeps its DOM/canvas renderer.
  }
  return true;
}
const terminalRendererAttachQueue = [];
let terminalRendererAttachFrameScheduled = false;
let terminalRendererAttachFrameRemaining = TERMINAL_RENDERER_ATTACH_MAX_PER_FRAME;
const SHELL_LAUNCHER_MODE_TERMINAL = "generic";
const SHELL_LAUNCHER_AGENT_OPTIONS = Object.freeze([
  { id: SHELL_LAUNCHER_MODE_TERMINAL, label: "Terminal", command: "" },
  { id: "codex", label: "Codex", command: "codex" },
  { id: "claude", label: "Claude Code", command: "claude" },
  { id: "opencode", label: "OpenCode", command: "opencode" },
]);
const SHELL_LAUNCHER_AGENT_IDS = new Set(SHELL_LAUNCHER_AGENT_OPTIONS.map((option) => option.id));
const SHELL_LAUNCHER_AGENT_COMMAND_DELAY_MS = 950;

function requestTerminalRendererAttachFrame(callback) {
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(callback);
    return;
  }

  setTimeout(callback, 16);
}

function scheduleTerminalRendererAttachFrame() {
  if (terminalRendererAttachFrameScheduled) {
    return;
  }

  terminalRendererAttachFrameScheduled = true;
  requestTerminalRendererAttachFrame(() => {
    terminalRendererAttachFrameScheduled = false;
    terminalRendererAttachFrameRemaining = TERMINAL_RENDERER_ATTACH_MAX_PER_FRAME;
    flushTerminalRendererAttachQueue();
  });
}

function flushTerminalRendererAttachQueue() {
  while (
    terminalRendererAttachFrameRemaining > 0
    && terminalRendererAttachQueue.length > 0
  ) {
    terminalRendererAttachFrameRemaining -= 1;
    terminalRendererAttachQueue.shift()?.();
  }

  if (terminalRendererAttachQueue.length > 0) {
    scheduleTerminalRendererAttachFrame();
  }
}

function waitForTerminalRendererAttachTurn() {
  if (
    terminalRendererAttachQueue.length === 0
    && terminalRendererAttachFrameRemaining > 0
  ) {
    terminalRendererAttachFrameRemaining -= 1;
    scheduleTerminalRendererAttachFrame();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    terminalRendererAttachQueue.push(resolve);
    scheduleTerminalRendererAttachFrame();
  });
}

function removeTerminalWebglRegistryEntry(registryKey, addon = null) {
  const key = String(registryKey || "");
  if (!key) {
    return false;
  }
  const entry = terminalWebglAddonRegistry.get(key);
  if (!entry || (addon && entry.addon !== addon)) {
    return false;
  }
  terminalWebglAddonRegistry.delete(key);
  return true;
}

function disposeTerminalWebglRegistryEntry(registryKey, reason = "webgl_registry_dispose") {
  const key = String(registryKey || "");
  if (!key) {
    return false;
  }
  const entry = terminalWebglAddonRegistry.get(key);
  if (!entry) {
    return false;
  }
  terminalWebglAddonRegistry.delete(key);
  try {
    entry.dispose?.(reason);
  } catch (_error) {
    // WebGL disposal is best effort; xterm keeps its DOM/canvas renderer.
  }
  return true;
}

function disposeTerminalWebglRegistryEntryForAddon(registryKey, addon, reason = "webgl_registry_dispose") {
  const key = String(registryKey || "");
  if (!key || !addon) {
    return false;
  }
  const entry = terminalWebglAddonRegistry.get(key);
  if (!entry || entry.addon !== addon) {
    return false;
  }
  terminalWebglAddonRegistry.delete(key);
  try {
    entry.dispose?.(reason);
  } catch (_error) {
    // WebGL disposal is best effort; xterm keeps its DOM/canvas renderer.
  }
  return true;
}

function touchTerminalWebglRegistryEntry(registryKey) {
  const entry = terminalWebglAddonRegistry.get(String(registryKey || ""));
  if (!entry) {
    return false;
  }
  entry.lastActive = ++terminalWebglAddonRegistrySequence;
  return true;
}

function trimTerminalWebglRegistryForAttach(exemptRegistryKey = "") {
  const exemptKey = String(exemptRegistryKey || "");
  while (terminalWebglAddonRegistry.size >= TERMINAL_WEBGL_LRU_CAP) {
    let staleKey = "";
    let staleSequence = Number.POSITIVE_INFINITY;
    terminalWebglAddonRegistry.forEach((entry, key) => {
      if (key === exemptKey) {
        return;
      }
      const lastActive = Number(entry?.lastActive || 0);
      if (lastActive < staleSequence) {
        staleKey = key;
        staleSequence = lastActive;
      }
    });
    if (!staleKey) {
      return;
    }
    disposeTerminalWebglRegistryEntry(staleKey, "webgl_lru_cap");
  }
}

function registerTerminalWebglRegistryEntry(registryKey, entry) {
  const key = String(registryKey || "");
  if (!key || !entry?.addon) {
    return false;
  }
  disposeTerminalWebglRegistryEntry(key, "webgl_replaced");
  terminalWebglAddonRegistry.set(key, {
    ...entry,
    lastActive: ++terminalWebglAddonRegistrySequence,
  });
  return true;
}

function normalizeShellLauncherAgentId(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (normalized === "terminal" || normalized === "shell" || normalized === "generic") {
    return SHELL_LAUNCHER_MODE_TERMINAL;
  }
  if (normalized === "claude" || normalized === "claude-code" || normalized === "claudecode") {
    return "claude";
  }
  if (normalized === "opencode" || normalized === "open-code" || normalized === "opencode-ai" || normalized === "open-code-ai") {
    return "opencode";
  }
  if (normalized === "codex" || normalized === "openai-codex") {
    return "codex";
  }
  return SHELL_LAUNCHER_MODE_TERMINAL;
}

function getShellLauncherAgentOption(agentId) {
  const safeAgentId = normalizeShellLauncherAgentId(agentId);
  return SHELL_LAUNCHER_AGENT_OPTIONS.find((option) => option.id === safeAgentId)
    || SHELL_LAUNCHER_AGENT_OPTIONS[0];
}

function shellLauncherAgentReady(agentStatuses, agentId) {
  const safeAgentId = normalizeShellLauncherAgentId(agentId);
  if (safeAgentId === SHELL_LAUNCHER_MODE_TERMINAL) {
    return true;
  }
  const status = (Array.isArray(agentStatuses) ? agentStatuses : [])
    .find((candidate) => candidate?.id === safeAgentId);
  return status ? status.installed === true && status.authenticated === true : true;
}

function shellLauncherAgentStatusLabel(agentStatuses, agentId) {
  const safeAgentId = normalizeShellLauncherAgentId(agentId);
  if (safeAgentId === SHELL_LAUNCHER_MODE_TERMINAL) {
    return "Shell input";
  }
  const status = (Array.isArray(agentStatuses) ? agentStatuses : [])
    .find((candidate) => candidate?.id === safeAgentId);
  if (!status) {
    return "Ready";
  }
  if (!status.installed) {
    return "Unavailable";
  }
  if (!status.authenticated) {
    return "Sign in required";
  }
  return "Ready";
}

function shellLauncherPlainTextFromPaste(event) {
  return String(event?.clipboardData?.getData?.("text/plain") || "");
}

function shellLauncherEventIsPlainTextKey(event) {
  return Boolean(
    event
      && typeof event.key === "string"
      && event.key.length === 1
      && !event.altKey
      && !event.ctrlKey
      && !event.metaKey
  );
}

function shellLauncherDelay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, ms));
  });
}

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

function normalizeTerminalActivityHookEventType(value, fallback = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    || fallback;
}

function terminalActivityHookEventTypeFromPayload(payload = {}) {
  const directType = normalizeTerminalActivityHookEventType(
    payload.eventType || payload.event_type || payload.type,
  );
  if (directType) {
    return directType;
  }

  const hookName = String(payload.hookEventName || payload.hook_event_name || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (hookName === "userpromptsubmit") return "provider-turn-started";
  if (hookName === "stop") return "provider-turn-completed";
  if (hookName === "stopfailure" || hookName === "error") return "provider-turn-error";
  if (hookName === "interrupt") return "provider-turn-interrupted";
  return "";
}

function terminalActivityStatusFromHookPayload(payload = {}, eventType = "") {
  const explicitActivity = normalizeTerminalNativeRailState(
    payload.nativeRailState
      || payload.native_rail_state
      || payload.activityStatus
      || payload.activity_status,
    "",
  );
  if (explicitActivity) {
    return explicitActivity;
  }

  const type = normalizeTerminalActivityHookEventType(eventType);
  if (
    type === "provider-turn-started"
    || type === "message-submitted"
    || type === "pending-prompt-sent"
    || type === "agent-output"
    || type.endsWith("-started")
  ) {
    return "thinking";
  }
  if (type === "provider-turn-error" || type === "pending-prompt-error" || type.endsWith("-error")) {
    return "error";
  }
  if (type === "provider-turn-interrupted" || type.endsWith("-interrupted")) {
    return "interrupted";
  }
  if (
    type === "provider-turn-completed"
    || type.endsWith("-completed")
  ) {
    return "idle";
  }
  return "";
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

function isTerminalPromptObservedTimeout(error) {
  return String(error?.message || error || "")
    .includes("Timed out waiting for the prompt to be observed in the terminal");
}

function getPendingPromptSubmitAttemptSequences(agentKind, isGenericTerminal = false, options = {}) {
  const primary = getTerminalSubmitSequence(agentKind, isGenericTerminal);
  const sequences = [];
  if (options.preferCarriageReturn && getTerminalAgentKind(agentKind) === "codex") {
    sequences.push("\r");
  }
  if (primary) {
    sequences.push(primary);
  }
  if (getTerminalAgentKind(agentKind) === "codex" && primary !== "\r") {
    sequences.push("\r");
  }
  return [...new Set(sequences)];
}

function waitForPendingPromptSubmitSettle(delayMs = PENDING_PROMPT_SUBMIT_SYNC_SETTLE_MS) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(delayMs) || 0));
  });
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

function getTerminalStartupDefaultLaunch(agentKind, agentLaunchDefaults = null) {
  return getAgentLaunchDefault(agentKind, agentLaunchDefaults);
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
  agentLaunchAlert = null,
  agentLaunchDefaults = null,
  agentLaunchReady = true,
  agentStatuses,
  agentStatusError,
  agentStatusState,
  appControlMcp = false,
  confirmedTerminalPane = true,
  defaultSessionMode = "",
  dockedChrome = false,
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
  onForkTerminal,
  onMinimizeTerminal,
  onSplitTerminal,
  onSelectWorkspaceThread,
  onToggleWorkspaceThreadPinned,
  onThreadTerminalLifecycle,
  onToggleFullscreenTerminal,
  onPopOutTerminalWindow,
  prewarmShell = false,
  permissionMode = "",
  startupReady = true,
  showDockedDragHandle = false,
  terminalBreakoutActive = false,
  terminalSplitLimit = MAX_WORKSPACE_TERMINAL_COUNT,
  terminalSplitMode = "both",
  terminalSelectionMode = "pointerdown",
  windowBreakoutHosted = false,
  terminalIndex = 0,
  terminalCount = 1,
  draggablePaneCount = terminalCount,
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
  selectedWorkspaceThreadIdOverride = false,
  paneIdOverride = "",
}) {
  const containerRef = useRef(null);
  const restartMenuRef = useRef(null);
  const shellLauncherInputRef = useRef(null);
  const resizeControllerRef = useRef(null);
  const windowBreakoutHostedRef = useRef(windowBreakoutHosted);
  const terminalOutputFlushNowRef = useRef(null);

  // While a pane is hosted in its own Window Breakout window, the native
  // window owns the PTY size; the grid's resize controller stands down and
  // re-asserts the grid geometry the moment the pane returns.
  useLayoutEffect(() => {
    const wasHosted = windowBreakoutHostedRef.current;
    windowBreakoutHostedRef.current = windowBreakoutHosted;

    if (wasHosted && !windowBreakoutHosted) {
      terminalOutputFlushNowRef.current?.("window_breakout_return");
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
  const setTerminalFontSizeFromWindow = useCallback((fontSize) => {
    const next = clampTerminalFontSize(fontSize);
    if (terminalFontSizeRef.current === next) {
      return;
    }
    terminalFontSizeRef.current = next;
    writeStoredTerminalFontSize(workspace?.id, terminalIndex, next);
    setTerminalFontSize(next);
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
  // Tracks whether the app window is focused/visible so the xterm cursor-blink
  // repaint loop can pause while the window sits in the background.
  const windowFocusedRef = useRef(
    typeof document === "undefined"
      ? true
      : !document.hidden
        && (typeof document.hasFocus !== "function" || document.hasFocus()),
  );
  const attachDeferredWebglRef = useRef(null);
  const resetTerminalWebglRendererRef = useRef(null);
  const touchTerminalWebglRendererRef = useRef(null);
  const terminalOutputWorkerSessionRef = useRef(null);
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
  const forkFromProviderSessionOnNextOpenRef = useRef("");
  // opencode's Bun runtime segfaults mid-session (bun.report crashes); the
  // budget survives pane restarts so a crash loop degrades to the normal
  // exited overlay instead of respawning forever.
  const crashAutoRestartRef = useRef({ attempts: 0 });
  const forkTerminalActionRef = useRef(null);
  const canRequestForkTerminalRef = useRef(false);
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
  const terminalStateRef = useRef(agent ? "starting" : "blocked");
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
  const [restartMenuAlign, setRestartMenuAlign] = useState("right");
  const [terminalLaunchInfo, setTerminalLaunchInfo] = useState(null);
  const [parkedPrompt, setParkedPrompt] = useState(null);
  const [terminalUiViewActive, setTerminalUiViewActive] = useState(false);
  const [shellLauncherAgentId, setShellLauncherAgentId] = useState(SHELL_LAUNCHER_MODE_TERMINAL);
  const [shellLauncherDraft, setShellLauncherDraft] = useState("");
  const [shellLauncherError, setShellLauncherError] = useState("");
  const [shellLauncherSending, setShellLauncherSending] = useState(false);
  const [shellLauncherLaunchedAgentId, setShellLauncherLaunchedAgentId] = useState("");
  const [terminalUiComposerFocusToken, setTerminalUiComposerFocusToken] = useState(0);
  const terminalUiViewActiveRef = useRef(false);
  useEffect(() => {
    terminalUiViewActiveRef.current = terminalUiViewActive;
  }, [terminalUiViewActive]);
  useEffect(() => {
    terminalStateRef.current = terminalState;
  }, [terminalState]);
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
  const terminalChromeDocked = Boolean(dockedChrome);
  const normalizedDraggablePaneCount = Math.max(
    1,
    Number.parseInt(draggablePaneCount, 10) || terminalCount || 1,
  );
  const canDragTerminalPane = terminalBreakoutActive || normalizedDraggablePaneCount > 1;
  const terminalRoleId = String(terminalRole || agent?.id || "").toLowerCase();
  const isGenericTerminal = terminalRoleId === "generic" || agent?.id === "generic";
  const paneAgentId = isGenericTerminal ? "generic" : agent?.id;
  const paneId = String(paneIdOverride || "").trim()
    || getWorkspaceTerminalPaneId(workspace?.id, terminalIndex, paneAgentId);
  const terminalPaneConfirmed = Boolean(
    confirmedTerminalPane
      && paneId
      && Number.isInteger(Number.parseInt(terminalIndex, 10))
      && Number.parseInt(terminalCount, 10) > 0,
  );
  const terminalPaneConfirmedRef = useRef(terminalPaneConfirmed);
  terminalPaneConfirmedRef.current = terminalPaneConfirmed;
  const appControlTerminalSurface = isAppControlTerminalSurface({
    paneId,
    workspaceId: workspace?.id,
  });
  const terminalSelectsOnPointerDown = terminalSelectionMode !== "pointerup";
  const terminalThreadId = thread?.id || "";
  const terminalThreadSlotKey = thread?.slotKey
    || String(Math.max(0, Number.parseInt(terminalIndex, 10) || 0) + 1);
  const terminalAgentKind = getTerminalAgentKind(paneAgentId);
  const terminalUsesActivityHooks = !isGenericTerminal && terminalAgentUsesActivityHooks(terminalAgentKind);
  const terminalThreadActivityStatus = terminalUsesActivityHooks ? "starting" : "idle";
  const terminalThreadIdRef = useRef(terminalThreadId);
  const terminalThreadSlotKeyRef = useRef(terminalThreadSlotKey);
  const terminalThreadActivityStatusRef = useRef(terminalThreadActivityStatus);
  const workspaceThreadsLatestRef = useRef(workspaceThreads);
  const [terminalRuntimeActivityStatus, setTerminalRuntimeActivityStatus] = useState(terminalThreadActivityStatus);
  const terminalRuntimeActivityStatusRef = useRef(terminalThreadActivityStatus);
  const terminalThreadThinkingTraceSignatureRef = useRef("");
  const terminalThreadThinkingSinceRef = useRef(terminalThreadActivityStatus === "thinking" ? performance.now() : 0);
  const terminalThreadPromptEpochRef = useRef(0);
  const terminalThreadSubmittedPromptRef = useRef(null);
  const terminalThreadLastReadyAtMsRef = useRef(0);
  const terminalThreadLastWorkStartedAtRef = useRef(terminalThreadActivityStatus === "thinking" ? performance.now() : 0);
  const terminalThreadLastActiveOutputLifecycleAtRef = useRef(0);
  const pendingThreadStartingLifecycleRef = useRef(null);
  const threadsViewSelectedThreadRef = useRef(null);
  const shellLauncherSelectedAgentId = normalizeShellLauncherAgentId(shellLauncherAgentId);
  const shellLauncherSelectedOption = getShellLauncherAgentOption(shellLauncherSelectedAgentId);
  const shellLauncherSelectedReady = shellLauncherAgentReady(agentStatuses, shellLauncherSelectedAgentId);
  const shellLauncherSelectedStatus = shellLauncherAgentStatusLabel(agentStatuses, shellLauncherSelectedAgentId);
  const shellLauncherReadyToLaunch = Boolean(
    isGenericTerminal
      && shellLauncherSelectedAgentId !== SHELL_LAUNCHER_MODE_TERMINAL
      && !shellLauncherLaunchedAgentId
      && shellLauncherSelectedReady,
  );
  const shellLauncherHasLaunched = Boolean(
    isGenericTerminal
      && shellLauncherLaunchedAgentId
      && shellLauncherLaunchedAgentId === shellLauncherSelectedAgentId,
  );
  useEffect(() => {
    workspaceThreadsLatestRef.current = workspaceThreads;
  }, [workspaceThreads]);
  useEffect(() => {
    if (isGenericTerminal) {
      return;
    }
    setShellLauncherAgentId(SHELL_LAUNCHER_MODE_TERMINAL);
    setShellLauncherDraft("");
    setShellLauncherError("");
    setShellLauncherSending(false);
    setShellLauncherLaunchedAgentId("");
  }, [isGenericTerminal]);
  useEffect(() => {
    if (shellLauncherSelectedAgentId !== SHELL_LAUNCHER_MODE_TERMINAL) {
      return;
    }
    setShellLauncherError("");
    setShellLauncherLaunchedAgentId("");
  }, [shellLauncherSelectedAgentId]);
  useEffect(() => {
    if (!isGenericTerminal || terminalState === "running") {
      return;
    }
    setShellLauncherLaunchedAgentId("");
  }, [isGenericTerminal, terminalState]);
  const shouldDelayInitialPtyReveal = Boolean(agent && !isGenericTerminal && prewarmShell && !agentLaunchReady);
  const [terminalPtyRevealReady, setTerminalPtyRevealReady] = useState(!shouldDelayInitialPtyReveal);
  const terminalPtyRevealReadyRef = useRef(!shouldDelayInitialPtyReveal);
  const setTerminalPtyRevealReadyState = useCallback((ready) => {
    const nextReady = typeof ready === "function"
      ? Boolean(ready(terminalPtyRevealReadyRef.current))
      : Boolean(ready);
    terminalPtyRevealReadyRef.current = nextReady;
    setTerminalPtyRevealReady(nextReady);
  }, []);
  useEffect(() => {
    if (shouldDelayInitialPtyReveal) {
      setTerminalPtyRevealReadyState((currentReady) => (
        currentReady && terminalState === "running"
          ? true
          : false
      ));
      return;
    }

    setTerminalPtyRevealReadyState(true);
  }, [setTerminalPtyRevealReadyState, shouldDelayInitialPtyReveal, terminalState]);
  const terminalDefaultSessionMode = normalizeTerminalSessionMode(
    defaultSessionMode,
    defaultTerminalSessionModeForRole(terminalRoleId, prewarmShell && !agentLaunchReady),
  );
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
  const normalizeTerminalEpochActivityStatus = (activityStatus = "idle", agentId = terminalAgentKind) => {
    const nextStatus = String(activityStatus || "idle").trim().toLowerCase() || "idle";
    if (nextStatus === "idle" && terminalAgentUsesActivityHooks(agentId)) {
      return "starting";
    }
    return nextStatus;
  };
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
    agentId = terminalAgentKind,
    instanceId = terminalInstanceIdRef.current,
    reason = "terminal_epoch_reset",
    threadId = terminalThreadIdRef.current,
  } = {}) => {
    const nextActivityStatus = normalizeTerminalEpochActivityStatus(activityStatus, agentId);
    terminalThreadThinkingSinceRef.current = 0;
    terminalThreadSubmittedPromptRef.current = null;
    terminalThreadLastReadyAtMsRef.current = 0;
    terminalThreadLastWorkStartedAtRef.current = 0;
    terminalThreadActivityStatusRef.current = nextActivityStatus;
    terminalRuntimeActivityStatusRef.current = terminalThreadActivityStatusRef.current;
    setTerminalRuntimeActivityStatus((current) => (
      current === terminalRuntimeActivityStatusRef.current
        ? current
        : terminalRuntimeActivityStatusRef.current
    ));
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
    terminalRuntimeActivityStatusRef.current = nextStatus;
    setTerminalRuntimeActivityStatus((current) => (current === nextStatus ? current : nextStatus));
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
    appControlTerminalSurface,
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
      const submittedByCodexInputGate = listenerState.terminalAgentKind === "codex"
        && promptSource === "observed_input_gate";
      if (listenerState.terminalUsesActivityHooks && !submittedByActivityHook && !submittedByCodexInputGate) {
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

  useEffect(() => {
    let disposed = false;
    let unlisten = null;

    listen(TERMINAL_ACTIVITY_HOOK_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const listenerState = terminalEventListenerStateRef.current || {};
      const payload = event?.payload || {};
      const eventType = terminalActivityHookEventTypeFromPayload(payload);
      const nextActivityStatus = terminalActivityStatusFromHookPayload(payload, eventType);
      if (!eventType || !nextActivityStatus) {
        return;
      }

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

      const started = eventType === "provider-turn-started"
        || eventType === "message-submitted"
        || eventType === "pending-prompt-sent";
      const completed = eventType === "provider-turn-completed"
        || eventType === "provider-turn-error"
        || eventType === "provider-turn-interrupted";
      const promptEventId = String(
        payload.promptEventId
          || payload.prompt_event_id
          || payload.providerTurnId
          || payload.provider_turn_id
          || payload.turnId
          || payload.turn_id
          || "",
      ).trim();
      const promptText = String(
        payload.userMessage
          || payload.user_message
          || payload.message
          || "",
      ).trim();
      const submittedAt = String(
        payload.promptReadyAt
          || payload.prompt_ready_at
          || payload.inputReadyAt
          || payload.input_ready_at
          || new Date().toISOString(),
      ).trim();
      const threadIdForPrompt = payloadThreadId || currentThreadId;
      if (started && promptText && threadIdForPrompt) {
        listenerState.rememberTerminalThreadSubmittedPrompt?.({
          promptEventId,
          promptText,
          source: payload.source || `terminal_activity_hook:${eventType}`,
          submittedAt,
          threadId: threadIdForPrompt,
        });
      }

      listenerState.markTerminalThreadActivityStatus?.(nextActivityStatus, {
        forceNewTurn: Boolean(started),
        reason: `terminal_activity_hook:${eventType}`,
      });

      if (listenerState.appControlTerminalSurface && listenerState.onThreadTerminalLifecycle && threadIdForPrompt) {
        const lifecycleWorkspaceId = currentWorkspaceId || listenerState.workspaceId || listenerState.threadWorkspaceId || "";
        const lifecyclePaneId = payloadPaneId || currentPaneId;
        const lifecycleTerminalIndex = Number.isFinite(payloadTerminalIndex)
          ? payloadTerminalIndex
          : currentTerminalIndex;
        listenerState.onThreadTerminalLifecycle({
          activityStatus: nextActivityStatus,
          agentId: payload.agentId || payload.agent_id || payload.agentKind || payload.agent_kind || listenerState.terminalAgentKind || "",
          commandPhase: completed
            ? eventType === "provider-turn-error"
              ? "failed"
              : eventType === "provider-turn-interrupted"
                ? "interrupted"
                : "completed"
            : started
              ? "running"
              : "",
          completedAt: payload.completedAt || payload.completed_at || "",
          error: payload.error || "",
          eventType,
          hookEventName: payload.hookEventName || payload.hook_event_name || "",
          inputReady: payload.inputReady ?? payload.input_ready,
          instanceId: Number(payload.instanceId ?? payload.instance_id ?? terminalInstanceIdRef.current ?? 0) || undefined,
          message: payload.message || payload.userMessage || payload.user_message || "",
          model: payload.model || payload.model_id || payload.modelId || "",
          nativeSessionId: payload.providerSessionId || payload.provider_session_id || "",
          nativeSessionKind: payload.providerSessionId || payload.provider_session_id ? "session" : "",
          nativeSessionSource: payload.providerSessionId || payload.provider_session_id ? "terminal-activity-hook" : "",
          ...getTerminalNativeRailStateFields(nextActivityStatus),
          paneId: lifecyclePaneId,
          pendingPromptId: promptEventId,
          promptEventId,
          promptReadyAt: payload.promptReadyAt || payload.prompt_ready_at || "",
          providerSessionId: payload.providerSessionId || payload.provider_session_id || "",
          providerTurnId: payload.providerTurnId || payload.provider_turn_id || "",
          source: payload.source || `terminal_activity_hook:${eventType}`,
          status: completed
            ? eventType === "provider-turn-error"
              ? "failed"
              : eventType === "provider-turn-interrupted"
                ? "interrupted"
                : "completed"
            : "active",
          terminalIndex: lifecycleTerminalIndex,
          threadId: threadIdForPrompt,
          type: eventType,
          userMessage: payload.userMessage || payload.user_message || payload.message || "",
          workspaceId: lifecycleWorkspaceId,
        });
      }

      if (completed || payload.inputReady === true || payload.input_ready === true) {
        const inputReadyAt = String(
          payload.inputReadyAt
            || payload.input_ready_at
            || payload.completedAt
            || payload.completed_at
            || new Date().toISOString(),
        ).trim();
        terminalThreadLastReadyAtMsRef.current = parseTerminalStateTimestampMs(inputReadyAt) || Date.now();
        if (completed) {
          terminalThreadSubmittedPromptRef.current = null;
        }
      }

      logTerminalStatus("frontend.terminal_cli.activity_hook_badge_state", listenerState.getTerminalCliStatusLogBase?.({
        activityStatus: nextActivityStatus,
        eventType,
        hookEventName: payload.hookEventName || payload.hook_event_name || "",
        hookHealthStatus: payload.hookHealthStatus || payload.hook_health_status || "",
        instanceId: payload.instanceId || payload.instance_id || "",
        paneId: payloadPaneId || currentPaneId,
        providerSessionPresent: Boolean(payload.providerSessionId || payload.provider_session_id),
        source: payload.source || "terminal_activity_hook",
        threadId: payloadThreadId || currentThreadId,
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
    const localActivityStatus = String(
      terminalRuntimeActivityStatus || terminalThreadActivityStatusRef.current || "",
    ).trim().toLowerCase();
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
    terminalRuntimeActivityStatus,
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
      terminal.options.cursorBlink = acceptsInteractiveInput && windowFocusedRef.current;
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
  // Selecting a terminal pane must paint its active highlight immediately. The
  // heavy activation side effects — flushing buffered xterm output (which
  // rewrites the terminal DOM and triggers full style recalcs), attaching the
  // WebGL renderer, and forcing a size reconcile — previously ran synchronously
  // inside the pointerdown handler and inside a useLayoutEffect, so the browser
  // could not paint the new selection border until hundreds of ms of xterm work
  // finished. We coalesce that work into a single post-paint animation frame so
  // the highlight is instant while the terminal catches up one frame later.
  const activationDeferHandleRef = useRef(0);
  const activationDeferWorkRef = useRef(null);
  const [deferredXtermActive, setDeferredXtermActive] = useState(Boolean(isActive));
  const deferTerminalActivationWork = useCallback((work) => {
    if (typeof work !== "function") {
      return;
    }
    // Coalesce: the last work scheduled before the frame fires wins, so the
    // pointerdown flush and the prop-driven activation collapse into one pass.
    activationDeferWorkRef.current = work;
    if (activationDeferHandleRef.current) {
      return;
    }
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      const immediate = activationDeferWorkRef.current;
      activationDeferWorkRef.current = null;
      immediate?.();
      return;
    }
    activationDeferHandleRef.current = window.requestAnimationFrame(() => {
      activationDeferHandleRef.current = 0;
      const pending = activationDeferWorkRef.current;
      activationDeferWorkRef.current = null;
      if (typeof pending === "function") {
        pending();
      }
    });
  }, []);
  useEffect(() => () => {
    if (activationDeferHandleRef.current && typeof window !== "undefined") {
      window.cancelAnimationFrame(activationDeferHandleRef.current);
    }
    activationDeferHandleRef.current = 0;
    activationDeferWorkRef.current = null;
  }, []);
  useEffect(() => {
    // Pause the xterm cursor-blink repaint whenever the app window is unfocused
    // or hidden; only an active, focused, non-parked terminal should run it.
    const syncWindowFocus = () => {
      const focused = typeof document === "undefined"
        ? true
        : !document.hidden
          && (typeof document.hasFocus !== "function" || document.hasFocus());
      if (windowFocusedRef.current === focused) {
        return;
      }
      windowFocusedRef.current = focused;
      const terminal = xtermRef.current;
      if (!terminal) {
        return;
      }
      const wantBlink = Boolean(terminalInteractiveStateRef.current.acceptsInteractiveInput)
        && focused;
      if (terminal.options.cursorBlink !== wantBlink) {
        terminal.options.cursorBlink = wantBlink;
      }
    };
    window.addEventListener("focus", syncWindowFocus);
    window.addEventListener("blur", syncWindowFocus);
    document.addEventListener("visibilitychange", syncWindowFocus);
    return () => {
      window.removeEventListener("focus", syncWindowFocus);
      window.removeEventListener("blur", syncWindowFocus);
      document.removeEventListener("visibilitychange", syncWindowFocus);
    };
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
  const focusShellLauncherInput = useCallback(() => {
    const focusInput = () => {
      shellLauncherInputRef.current?.focus?.({ preventScroll: true });
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focusInput);
      return;
    }
    window.setTimeout(focusInput, 0);
  }, []);
  const chooseShellLauncherAgent = useCallback((nextAgentId) => {
    const nextId = normalizeShellLauncherAgentId(nextAgentId);
    if (!SHELL_LAUNCHER_AGENT_IDS.has(nextId)) {
      return;
    }
    if (nextId !== shellLauncherSelectedAgentId) {
      setShellLauncherDraft("");
      setShellLauncherError("");
      setShellLauncherLaunchedAgentId("");
    }
    setShellLauncherAgentId(nextId);
    if (nextId !== SHELL_LAUNCHER_MODE_TERMINAL) {
      terminalUiViewActiveRef.current = true;
      setTerminalUiViewActive(true);
      focusShellLauncherInput();
    }
  }, [focusShellLauncherInput, shellLauncherSelectedAgentId]);
  const submitShellLauncherPrompt = useCallback(async (promptOverride = "") => {
    const prompt = String(promptOverride || shellLauncherDraft || "").trim();
    const targetAgentId = shellLauncherSelectedAgentId;
    const targetOption = getShellLauncherAgentOption(targetAgentId);
    if (!isGenericTerminal || targetAgentId === SHELL_LAUNCHER_MODE_TERMINAL || !targetOption.command) {
      return;
    }
    if (!prompt) {
      focusShellLauncherInput();
      return;
    }
    if (!shellLauncherSelectedReady) {
      setShellLauncherError(`${targetOption.label} is not ready.`);
      focusShellLauncherInput();
      return;
    }
    const instanceId = terminalInstanceIdRef.current || 0;
    if (!paneId || !instanceId || terminalClosed || terminalClosing || terminalState !== "running") {
      setShellLauncherError("Terminal is not ready yet.");
      focusShellLauncherInput();
      return;
    }

    setShellLauncherSending(true);
    setShellLauncherError("");
    try {
      logBigViewSyncDiagnosticEvent("tui.shell_launcher.start", {
        agentId: targetAgentId,
        command: targetOption.command,
        instanceId,
        paneId,
        prompt: getBigViewTextDiagnosticFields(prompt),
        terminalIndex,
        workspaceId: workspace?.id || "",
      });
      await invoke("terminal_write", {
        data: `${targetOption.command}\r`,
        instanceId,
        paneId,
      });
      await shellLauncherDelay(SHELL_LAUNCHER_AGENT_COMMAND_DELAY_MS);
      await invoke("terminal_write", {
        data: buildTerminalSubmittedInput(prompt, targetAgentId, false),
        instanceId,
        paneId,
      });
      setShellLauncherDraft("");
      setShellLauncherLaunchedAgentId(targetAgentId);
      terminalUiViewActiveRef.current = false;
      setTerminalUiViewActive(false);
      focusTerminalKeyboardInput(true);
      logBigViewSyncDiagnosticEvent("tui.shell_launcher.done", {
        agentId: targetAgentId,
        command: targetOption.command,
        instanceId,
        paneId,
        promptLength: prompt.length,
        terminalIndex,
        workspaceId: workspace?.id || "",
      });
    } catch (error) {
      const message = getErrorMessage(error, `Unable to launch ${targetOption.label}.`);
      setShellLauncherError(message);
      logBigViewSyncDiagnosticEvent("tui.shell_launcher.error", {
        agentId: targetAgentId,
        command: targetOption.command,
        instanceId,
        message,
        paneId,
        terminalIndex,
        workspaceId: workspace?.id || "",
      });
      focusShellLauncherInput();
    } finally {
      setShellLauncherSending(false);
    }
  }, [
    focusShellLauncherInput,
    focusTerminalKeyboardInput,
    isGenericTerminal,
    paneId,
    shellLauncherDraft,
    shellLauncherSelectedAgentId,
    shellLauncherSelectedReady,
    terminalClosed,
    terminalClosing,
    terminalIndex,
    terminalState,
    workspace?.id,
  ]);
  const appendShellLauncherDraftFromTerminal = useCallback((text) => {
    const safeText = String(text || "");
    if (!safeText) {
      return;
    }
    setShellLauncherError("");
    setShellLauncherDraft((current) => `${current}${safeText}`);
    terminalUiViewActiveRef.current = true;
    setTerminalUiViewActive(true);
    focusShellLauncherInput();
  }, [focusShellLauncherInput]);
  const handleShellLauncherKeyDown = useCallback((event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitShellLauncherPrompt();
    }
  }, [submitShellLauncherPrompt]);
  const handleShellLauncherXtermKeyDownCapture = useCallback((event) => {
    if (
      !shellLauncherReadyToLaunch
      || shellLauncherSending
      || terminalUiViewActive
      || terminalClosed
      || terminalClosing
      || isTerminalControlEventTarget(event.target)
    ) {
      return;
    }
    if (shellLauncherEventIsPlainTextKey(event)) {
      event.preventDefault();
      event.stopPropagation();
      appendShellLauncherDraftFromTerminal(event.key);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      terminalUiViewActiveRef.current = true;
      setTerminalUiViewActive(true);
      focusShellLauncherInput();
    }
  }, [
    appendShellLauncherDraftFromTerminal,
    focusShellLauncherInput,
    shellLauncherReadyToLaunch,
    shellLauncherSending,
    terminalClosed,
    terminalClosing,
    terminalUiViewActive,
  ]);
  const handleShellLauncherXtermPasteCapture = useCallback((event) => {
    if (
      !shellLauncherReadyToLaunch
      || shellLauncherSending
      || terminalUiViewActive
      || terminalClosed
      || terminalClosing
      || isTerminalControlEventTarget(event.target)
    ) {
      return;
    }
    const pastedText = shellLauncherPlainTextFromPaste(event);
    if (!pastedText) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    appendShellLauncherDraftFromTerminal(pastedText);
  }, [
    appendShellLauncherDraftFromTerminal,
    shellLauncherReadyToLaunch,
    shellLauncherSending,
    terminalClosed,
    terminalClosing,
    terminalUiViewActive,
  ]);
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
    const draftTransaction = setThreadComposerDraftValue(syncKey, text, "bigview_submit_sync_prompt");
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
    const clearResult = clearWorkspaceThreadComposerDraftIfRevision(syncKey, draftTransaction?.revision || 0, {
      expectedValue: text,
      source: "bigview_submit_confirmed_clear",
      transactionId: promptId,
    });
    if (clearResult.cleared) {
      const clearInputData = buildTerminalComposerDraftInput(text, "", true);
      if (clearInputData) {
        try {
          await invoke("terminal_write", {
            data: clearInputData,
            instanceId: binding.instanceId,
            paneId: binding.paneId,
            threadId: latestThread.id,
          });
          logThreadBridgeDiagnostic("frontend.thread_submit.confirmed_terminal_draft_clear_done", {
            agentId,
            bindingInstanceId: binding.instanceId,
            bindingPaneId: binding.paneId,
            draftRevision: draftTransaction?.revision || 0,
            latestThreadId: latestThread.id,
            promptId,
            textLength: text.length,
            workspaceId,
          });
        } catch (clearError) {
          logThreadBridgeDiagnostic("frontend.thread_submit.confirmed_terminal_draft_clear_error", {
            agentId,
            bindingInstanceId: binding.instanceId,
            bindingPaneId: binding.paneId,
            draftRevision: draftTransaction?.revision || 0,
            latestThreadId: latestThread.id,
            message: getErrorMessage(clearError, "Unable to clear submitted terminal draft."),
            promptId,
            textLength: text.length,
            workspaceId,
          });
        }
      }
    } else {
      logThreadBridgeDiagnostic("frontend.thread_submit.confirmed_draft_clear_skip", {
        agentId,
        bindingInstanceId: binding.instanceId,
        bindingPaneId: binding.paneId,
        currentDraftLength: String(clearResult.value || "").length,
        currentDraftRevision: clearResult.revision || 0,
        expectedDraftRevision: draftTransaction?.revision || 0,
        latestThreadId: latestThread.id,
        promptId,
        reason: clearResult.reason || "draft_changed",
        textLength: text.length,
        workspaceId,
      });
    }
    if (terminalAgentUsesActivityHooks(agentId) && getTerminalAgentKind(agentId) !== "codex") {
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
    const initialModelObservation = getWorkspaceThreadObservedModelChange(workspaceThreadsLatestRef.current, {
      agentId,
      threadId: latestThread.id,
      workspaceId: latestThread.workspaceId || workspace?.id || "",
    });
    logBigViewSyncDiagnosticEvent("bigview.model_change.terminal_write_start", {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      commandLength: command.length,
      model: nextModel,
      modelTerminalSnapshot,
      modelThreadSnapshot,
      observedModel: initialModelObservation.model,
      observedModelSource: initialModelObservation.modelSource,
      observedModelUpdatedAt: initialModelObservation.modelUpdatedAt,
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
    const waitStartedAt = Date.now();
    const confirmationFields = {
      agentId,
      bindingInstanceId: binding.instanceId,
      bindingPaneId: binding.paneId,
      initialObservedModel: initialModelObservation.model,
      initialObservedModelSource: initialModelObservation.modelSource,
      initialObservedModelUpdatedAt: initialModelObservation.modelUpdatedAt,
      model: nextModel,
      requestIncludesThinkingPower,
      terminalIndex: latestThread.terminalIndex ?? binding.terminalIndex,
      thinkingPower,
      thinkingPowerSource,
      threadId: latestThread.id,
      timeoutMs: WORKSPACE_THREAD_MODEL_CHANGE_CONFIRM_TIMEOUT_MS,
      workspaceId: latestThread.workspaceId || workspace?.id || "",
    };
    logBigViewSyncDiagnosticEvent("bigview.model_change.confirm_wait_start", confirmationFields);
    let confirmedObservation = null;
    try {
      confirmedObservation = await new Promise((resolve, reject) => {
        const checkObservedModel = () => {
          const observation = getWorkspaceThreadObservedModelChange(workspaceThreadsLatestRef.current, {
            agentId,
            threadId: latestThread.id,
            workspaceId: latestThread.workspaceId || workspace?.id || "",
          });
          if (workspaceThreadModelChangeMatchesObservation(observation, {
            initialObservation: initialModelObservation,
            model: nextModel,
          })) {
            resolve(observation);
            return;
          }
          if (Date.now() - waitStartedAt >= WORKSPACE_THREAD_MODEL_CHANGE_CONFIRM_TIMEOUT_MS) {
            reject(new Error("Model change was written to the terminal but was not confirmed by session history yet."));
            return;
          }
          window.setTimeout(checkObservedModel, WORKSPACE_THREAD_MODEL_CHANGE_CONFIRM_POLL_MS);
        };
        window.setTimeout(checkObservedModel, 0);
      });
    } catch (error) {
      const latestObservation = getWorkspaceThreadObservedModelChange(workspaceThreadsLatestRef.current, {
        agentId,
        threadId: latestThread.id,
        workspaceId: latestThread.workspaceId || workspace?.id || "",
      });
      logBigViewSyncDiagnosticEvent("bigview.model_change.confirm_timeout", {
        ...confirmationFields,
        elapsedMs: Date.now() - waitStartedAt,
        message: error?.message || String(error || ""),
        observedModel: latestObservation.model,
        observedModelSource: latestObservation.modelSource,
        observedModelUpdatedAt: latestObservation.modelUpdatedAt,
      });
      throw error;
    }
    logBigViewSyncDiagnosticEvent("bigview.model_change.confirmed", {
      ...confirmationFields,
      elapsedMs: Date.now() - waitStartedAt,
      observedModel: confirmedObservation.model,
      observedModelSource: confirmedObservation.modelSource,
      observedModelUpdatedAt: confirmedObservation.modelUpdatedAt,
      providerSessionPresent: Boolean(confirmedObservation.providerSessionId),
    });
  }, [terminalAgentKind, workspace, workspaceThreads]);
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
      // Route keyboard + update selection (border) synchronously so the highlight
      // paints this frame; defer the xterm output flush past paint.
      setActiveTerminalKeyboardTarget(paneId, instanceId);
      onActivateTerminal?.({
        instanceId,
        paneId,
        source,
        terminalIndex,
        workspaceId: workspace?.id || "",
      });
      deferTerminalActivationWork(() => {
        updateTerminalInteractiveState(true);
      });
    } else if (focusKeyboard) {
      setActiveTerminalKeyboardTarget(paneId, instanceId);
    }
    setTerminalAudioInputTarget(true, instanceId, source);

    if (focusKeyboard) {
      focusTerminalKeyboardInput(true);
    }
  }, [
    deferTerminalActivationWork,
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
      || !canDragTerminalPane
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
    canDragTerminalPane,
    isFullscreen,
    onBeginTerminalDrag,
    paneId,
    terminalBreakoutActive,
    terminalClosed,
    terminalClosing,
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

  useLayoutEffect(() => {
    const nextActive = Boolean(isActive);
    const wasActiveProp = terminalActivePropRef.current === true;
    terminalActivePropRef.current = nextActive;
    terminalActiveRef.current = nextActive;

    if (nextActive) {
      const instanceId = terminalInstanceIdRef.current || 0;
      // Keyboard + audio routing stays synchronous (cheap) so input is correct
      // immediately; the expensive xterm work runs after the highlight paints.
      setActiveTerminalKeyboardTarget(paneId, instanceId);
      setTerminalAudioInputTarget(true, instanceId, "terminal_active_prop");
      deferTerminalActivationWork(() => {
        updateTerminalInteractiveState(nextActive);
        // Flip the xterm-subtree data-active attribute (cursor/helper selectors)
        // after paint so its descendant-selector recalc does not gate the border.
        setDeferredXtermActive(true);
        touchTerminalWebglRendererRef.current?.("terminal_active_prop");
        if (!wasActiveProp) {
          attachDeferredWebglRef.current?.("terminal_activated");
          // Resizes are skipped while a pane's surface is hidden; activation is
          // the reveal path, so reconcile any size drift now.
          resizeControllerRef.current?.schedule("terminal_activated", 0, {
            force: true,
            forceNative: true,
            nativeDelayMs: 0,
          });
        }
      });
      return undefined;
    }

    const instanceId = terminalInstanceIdRef.current || 0;
    clearActiveTerminalKeyboardTargetIfCurrent(paneId, instanceId);
    setTerminalAudioInputTarget(false, instanceId, "terminal_inactive_prop");
    deferTerminalActivationWork(() => {
      updateTerminalInteractiveState(nextActive);
      setDeferredXtermActive(false);
      resetTerminalWebglRendererRef.current?.("terminal_deactivated");
    });
    return undefined;
  }, [deferTerminalActivationWork, isActive, paneId, setTerminalAudioInputTarget, updateTerminalInteractiveState]);

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

  const toggleRestartRoleMenu = useCallback(() => {
    setRestartRoleMenuOpen((isOpen) => {
      if (isOpen) {
        return false;
      }

      // The dropdown is right-aligned to its button; with the button near the
      // pane's left edge that hangs the menu outside the pane, where ancestor
      // overflow clips it. Open toward whichever side of the rail has room.
      const wrapper = restartMenuRef.current;
      const rail = wrapper?.closest('[data-terminal-rail-pill="true"]');
      const wrapperRect = wrapper?.getBoundingClientRect();
      const railRect = rail?.getBoundingClientRect();
      if (wrapperRect && railRect) {
        const menuWidth = 224;
        const spaceLeftward = wrapperRect.right - railRect.left;
        const spaceRightward = railRect.right - wrapperRect.left;
        setRestartMenuAlign(
          spaceLeftward >= menuWidth || spaceLeftward >= spaceRightward ? "right" : "left",
        );
      }
      return true;
    });
  }, []);

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
      agentId: detail.agentId || terminalAgentKind,
      instanceId: 0,
      reason: "restart_empty_terminal_session",
      threadId: nextThreadId,
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

  // Surface repeated agent-batch launch failures (missing CLI, cloud auth,
  // backend timeouts) on the waiting pane. AppShell keeps retrying with
  // backoff; without this the pane just shows "starting" forever and the
  // real failure message never reaches the user.
  useEffect(() => {
    if (terminalClosed || terminalClosingRef.current) {
      return;
    }
    // Only prewarmed panes are genuinely parked behind the batch launch;
    // panes in "starting" run their own open flow with its own status UI
    // (and their failures surface through terminalError instead).
    if (terminalState !== "prewarmed") {
      return;
    }
    const alertMessage = String(agentLaunchAlert?.message || "").trim();
    if (alertMessage) {
      setTerminalStatus({
        detail: alertMessage,
        mode: "detail",
        title: "Agent Launch Stalled",
        visible: true,
      });
      return;
    }
    setTerminalStatus((current) => (
      current?.title === "Agent Launch Stalled"
        ? {
          detail: "Waiting for the agent launch gate.",
          title: "Terminal Prepared",
          visible: false,
        }
        : current
    ));
  }, [agentLaunchAlert, terminalClosed, terminalState]);

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
    const forkFromProviderSessionIdForThisStart = forceFreshSessionForThisStart
      ? ""
      : String(forkFromProviderSessionOnNextOpenRef.current || "").trim();
    const startupThreadProviderSessionId = (
      forceFreshSessionForThisStart
      || forkFromProviderSessionIdForThisStart
    )
      ? ""
      : providerSessionOverrideForThisStart || threadProviderSessionId;
    const startupDefaultLaunch = isGenericTerminal
      ? { effort: "", model: "", speed: "" }
      : getTerminalStartupDefaultLaunch(terminalAgentKind, agentLaunchDefaults);
    const startupDefaultModel = startupDefaultLaunch.model || "";
    const startupProviderSessionSuppressesDefaultModel = Boolean(
      startupThreadProviderSessionId
        && terminalAgentKind === "opencode"
        && !threadProviderModel,
    );
    const startupThreadProviderModel = isGenericTerminal
      ? ""
      : threadProviderModel || (startupProviderSessionSuppressesDefaultModel ? "" : startupDefaultModel);
    const startupThreadProviderModelSource = threadProviderModel
      ? "session-restore"
      : startupThreadProviderModel
        ? "settings-default"
        : "";
    const startupThreadProviderLaunch = startupThreadProviderModel
      ? resolveAgentLaunchDefaultForModel(
        terminalAgentKind,
        agentLaunchDefaults,
        startupThreadProviderModel,
      )
      : { effort: "", speed: "" };
    const startupThreadProviderEffort = startupThreadProviderLaunch.effort || "";
    const startupThreadProviderSpeed = startupThreadProviderLaunch.speed || "";
    const startupPermissionMode = isGenericTerminal ? "" : String(permissionMode || "").trim();
    const startupThreadId = terminalThreadIdRef.current;
    const startupSlotKey = forceFreshSessionForThisStart
      ? String(Math.max(0, Number.parseInt(terminalIndex, 10) || 0) + 1)
      : terminalThreadSlotKeyRef.current;
    preserveCoordinationOnNextOpenRef.current = false;
    forceFreshSessionOnNextOpenRef.current = false;
    providerSessionOverrideOnNextOpenRef.current = "";
    forkFromProviderSessionOnNextOpenRef.current = "";
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
      startupThreadProviderEffort: startupThreadProviderEffort || "",
      startupThreadId: startupThreadId || "",
      startupThreadProviderModelSource,
      startupThreadProviderModelPresent: Boolean(startupThreadProviderModel),
      startupThreadProviderSpeed: startupThreadProviderSpeed || "",
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
      startupThreadProviderEffort: startupThreadProviderEffort || "",
      startupThreadId: startupThreadId || "",
      startupThreadProviderModel: startupThreadProviderModel || "",
      startupThreadProviderModelSource,
      startupThreadProviderSpeed: startupThreadProviderSpeed || "",
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
    let forceOutputFlushAfterWriteReason = "";
    let outputAdaptiveFlushMaxBytes = TERMINAL_OUTPUT_BATCH_MAX_BYTES;
    let terminalOutputRenderVisible = () => !windowBreakoutHostedRef.current;
    const isTerminalOutputRenderVisible = () => {
      try {
        return terminalOutputRenderVisible() !== false;
      } catch (_error) {
        return terminalActiveRef.current === true && !windowBreakoutHostedRef.current;
      }
    };
    const isTerminalOutputHidden = () => !isTerminalOutputRenderVisible();
    let visibleOutputRefreshTimer = 0;
    let sawFirstOutput = false;
    let sawFirstVisibleOutput = false;
    let prewarmPtyOutputGateActive = false;
    let prewarmPtyRevealTimer = 0;
    let prewarmAgentDirectOpenTimer = 0;
    let prewarmPtyDroppedBytes = 0;
    let prewarmPtyDroppedChunks = 0;
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
    const webglRegistryKey = `${paneId}:${terminalInstanceId}`;
    const disposeWebglAddon = (webglAddon, reason = "webgl_dispose") => {
      if (!webglAddon) {
        return false;
      }
      // Prefer the registry dispose closure: it also releases the GL context
      // explicitly. The direct path below (addon.dispose() only) leaves the
      // context alive until GC, which exhausted WebKit's per-page cap under
      // workspace open/close cycling.
      if (disposeTerminalWebglRegistryEntryForAddon(webglRegistryKey, webglAddon, reason)) {
        return true;
      }
      removeTerminalWebglRegistryEntry(webglRegistryKey, webglAddon);
      if (activeWebglAddon === webglAddon) {
        activeWebglAddon = null;
        webglAttachAttempted = false;
        webglBackgroundDeferred = false;
        rendererMode = "canvas";
      }
      disposeTerminalWebglAddonOnce(webglAddon);
      logTerminalDiagnosticEvent("frontend.webgl.dispose", {
        paneId,
        reason,
        terminalIndex,
      });
      return true;
    };
    const disposeActiveWebglAddon = (reason = "webgl_dispose_active") => {
      if (!activeWebglAddon) {
        return false;
      }
      const webglAddon = activeWebglAddon;
      if (disposeTerminalWebglRegistryEntry(webglRegistryKey, reason)) {
        return true;
      }
      return disposeWebglAddon(webglAddon, reason);
    };
    const touchActiveWebglAddon = () => {
      touchTerminalWebglRegistryEntry(webglRegistryKey);
    };
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
      const nextVisible = state !== "running" && state !== "prewarmed" && state !== "closed" && !terminalClosed;
      // Identity-stable: hidden panes re-announce the same stage repeatedly
      // (layout wait loop); a fresh-but-equal object per call re-rendered the
      // whole pane each time.
      setTerminalStatus((current) => (
        current
          && current.detail === detail
          && current.title === title
          && current.visible === nextVisible
          ? current
          : { detail, title, visible: nextVisible }
      ));
    };

    setPaneStage("starting", "Preparing Terminal", "Creating terminal renderer.");

    const waitForStartupMetricPoll = (delayMs, watchElement = null) => new Promise((resolve) => {
      if (isDisposed) {
        resolve();
        return;
      }

      // While parked on a slow fallback poll, a ResizeObserver on the pane
      // container ends the wait the instant the hidden runtime gains size, so
      // slow polling never delays a reveal.
      let observer = null;
      const settle = () => {
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        resolve();
      };

      const timer = window.setTimeout(() => {
        startupMetricTimers.delete(timer);
        settle();
      }, Math.max(0, delayMs));

      startupMetricTimers.add(timer);

      if (watchElement && typeof ResizeObserver !== "undefined") {
        try {
          observer = new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            const box = entry?.contentRect;
            if (box && box.width > 0 && box.height > 0) {
              window.clearTimeout(timer);
              startupMetricTimers.delete(timer);
              settle();
            }
          });
          observer.observe(watchElement);
        } catch {
          observer = null;
        }
      }
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
      cursorBlink: terminalActiveRef.current && !parkedPromptRef.current && windowFocusedRef.current,
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
    const startupCapturedProviderSessionId = terminalAgentKind === "opencode"
      && startupThreadProviderSessionId
      && !startupThreadProviderSessionId.startsWith("ses_")
      ? ""
      : startupThreadProviderSessionId || "";
    let capturedProviderSessionId = startupCapturedProviderSessionId;
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
    const openTerminalRenderer = async (reason, fields = {}) => {
      if (terminalRendererOpened) {
        return true;
      }

      if (isDisposed) {
        return false;
      }

      let measurement = getTerminalOpenContainerMeasurement();
      if (!measurement.ok) {
        return false;
      }

      await waitForTerminalRendererAttachTurn();

      if (terminalRendererOpened) {
        return true;
      }

      if (isDisposed) {
        return false;
      }

      measurement = getTerminalOpenContainerMeasurement();
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
      if (!terminalPaneConfirmedRef.current) {
        logTerminalDiagnosticEvent("frontend.terminal_mount_skipped_unconfirmed_pane", {
          paneId,
          reason,
          terminalCount,
          terminalIndex,
        });
        return false;
      }

      if (await openTerminalRenderer(reason, { attempts: 1, waitMs: 0 })) {
        return true;
      }

      const waitStartedAt = performance.now();
      let attempts = 1;
      let lastWaitingLogAt = waitStartedAt;
      let nextPollMs = TERMINAL_START_METRIC_POLL_MS;
      const firstMeasurement = getTerminalOpenContainerMeasurement();
      logTerminalDiagnosticEvent("frontend.terminal_mount_deferred", {
        ...firstMeasurement,
        paneId,
        reason,
        terminalIndex,
      });
      setPaneStage("starting", "Preparing Terminal", "Waiting for terminal layout.");

      while (!isDisposed && terminalPaneConfirmedRef.current) {
        const pollMs = nextPollMs;
        nextPollMs = TERMINAL_START_LAYOUT_HIDDEN_POLL_MS;
        await waitForStartupMetricPoll(pollMs, container);

        if (isDisposed || !terminalPaneConfirmedRef.current) {
          return false;
        }

        attempts += 1;
        const attemptedAt = performance.now();
        if (
          await openTerminalRenderer(reason, {
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
      if (!terminalActiveRef.current && reason !== "terminal_activated" && reason !== "background_visible") {
        rendererMode = "canvas_deferred";
        if (!webglBackgroundDeferred) {
          webglBackgroundDeferred = true;
          logTerminalDiagnosticEvent("frontend.webgl.background_deferred", {
            paneId,
            reason,
            terminalIndex,
          });
          // Visible-but-unfocused panes stream constantly, and canvas2d for a
          // streaming pane costs far more per composite (~50-60ms measured)
          // than a WebGL context. Attach after a stagger instead of waiting
          // for focus; hidden tabs bail below via checkVisibility.
          scheduleWebglAttach(
            "background_visible",
            TERMINAL_WEBGL_BACKGROUND_DELAY_MS + terminalIndex * TERMINAL_WEBGL_STAGGER_MS,
          );
        }
        return;
      }
      if (reason === "background_visible" && container?.checkVisibility && !container.checkVisibility()) {
        // Hidden tab/minimized pane: stay on the cheap renderer; activation
        // re-schedules the attach.
        return;
      }

	      webglAttachAttempted = true;
	      const webglStartedAt = performance.now();
	      trimTerminalWebglRegistryForAttach(webglRegistryKey);
	      const webglAddon = new WebglAddon();

	      try {
	        terminal.loadAddon(webglAddon);
	        rendererMode = "webgl";
	        activeWebglAddon = webglAddon;
	        // The addon's canvas holds a live WebGL context until GC even after
	        // addon.dispose() — WebKit caps ~16 contexts per page, and open/close
	        // cycling exhausted them ("too many active WebGL contexts", oldest
	        // killed). Capture the canvas so dispose can release it explicitly.
	        const webglCanvas = container.querySelector(".xterm-screen canvas:last-of-type");
	        registerTerminalWebglRegistryEntry(webglRegistryKey, {
	          addon: webglAddon,
	          dispose: (disposeReason = "webgl_registry_dispose") => {
	            if (activeWebglAddon === webglAddon) {
	              activeWebglAddon = null;
	              webglAttachAttempted = false;
	              webglBackgroundDeferred = false;
	              rendererMode = "canvas";
	            }
	            disposeTerminalWebglAddonOnce(webglAddon);
	            try {
	              const gl = webglCanvas?.getContext?.("webgl2") || webglCanvas?.getContext?.("webgl");
	              // Skip contexts WebKit already force-lost at the page cap:
	              // losing them again raises INVALID_OPERATION console errors.
	              if (gl && !gl.isContextLost?.()) {
	                gl.getExtension?.("WEBGL_lose_context")?.loseContext?.();
	              }
	            } catch (_error) {
	              // Context release is best effort; GC reclaims it eventually.
	            }
	            void invoke("terminal_status_log", {
	              phase: "frontend.webgl_mode",
	              fields: { mode: "canvas_fallback", paneId, reason: disposeReason, terminalIndex },
	            }).catch(() => {});
	            logTerminalDiagnosticEvent("frontend.webgl.dispose", {
	              paneId,
	              reason: disposeReason,
	              terminalIndex,
	            });
	          },
	        });
	        void invoke("terminal_status_log", {
	          phase: "frontend.webgl_mode",
	          fields: { mode: "webgl", paneId, terminalIndex },
	        }).catch(() => {});
	        disposables.push(() => disposeWebglAddon(webglAddon, "terminal_cleanup"));
	        disposables.push(webglAddon.onContextLoss(() => {
	          rendererMode = "canvas";
	          if (activeWebglAddon === webglAddon) {
	            activeWebglAddon = null;
	          }
	          webglAttachAttempted = false;
	          webglBackgroundDeferred = false;
	          removeTerminalWebglRegistryEntry(webglRegistryKey, webglAddon);
	          void invoke("terminal_status_log", {
	            phase: "frontend.webgl_mode",
	            fields: { mode: "context_loss", paneId, terminalIndex },
	          }).catch(() => {});
	          logTerminalDiagnosticEvent("frontend.webgl.context_loss", {
	            paneId,
	            reason,
	            terminalIndex,
	          });
	          disposeWebglAddon(webglAddon, "webgl_context_loss");
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
	        webglBackgroundDeferred = false;
	        disposeWebglAddon(webglAddon, "webgl_attach_failed");
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

    const resetTerminalWebglRenderer = (reason) => {
      if (!useWebglRenderer) {
        return false;
      }

      if (webglAttachTimer) {
        window.clearTimeout(webglAttachTimer);
        webglAttachTimer = 0;
        webglAttachAt = 0;
      }

	      const hadAttempt = webglAttachAttempted;
	      const hadAddon = Boolean(activeWebglAddon);
	      disposeActiveWebglAddon(reason);

	      activeWebglAddon = null;
	      webglAttachAttempted = false;
	      webglBackgroundDeferred = false;
      rendererMode = "webgl_pending";
      logTerminalDiagnosticEvent("frontend.webgl.reset_for_reveal", {
        hadAddon,
        hadAttempt,
        paneId,
        reason,
        terminalIndex,
	      });
	      return hadAddon || hadAttempt;
	    };
	    resetTerminalWebglRendererRef.current = resetTerminalWebglRenderer;
	    touchTerminalWebglRendererRef.current = touchActiveWebglAddon;
	    disposables.push(() => {
	      if (resetTerminalWebglRendererRef.current === resetTerminalWebglRenderer) {
	        resetTerminalWebglRendererRef.current = null;
	      }
	      if (touchTerminalWebglRendererRef.current === touchActiveWebglAddon) {
	        touchTerminalWebglRendererRef.current = null;
	      }
	    });

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

        // The screen is genuinely blank here. A bare renderer refresh cannot
        // recover an agent that simply never painted (e.g. a TUI that came up
        // before it got a usable terminal size), so force a real resize first:
        // that rebuilds the texture atlas and TIOCSWINSZ-nudges the PTY into a
        // repaint. Refresh afterwards to flush whatever lands in the buffer.
        if (!previousProbe) {
          void resizeController?.resizeNow("blank_startup_probe", {
            force: true,
            forceNative: true,
            nativeDelayMs: 0,
          });
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

        void resizeController?.resizeNow("blank_startup_watch", {
          force: true,
          forceNative: true,
          nativeDelayMs: 0,
        });
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
        await waitForStartupMetricPoll(pollMs, container);

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

    const resetPrewarmPtyOutputGateCounters = () => {
      prewarmPtyDroppedBytes = 0;
      prewarmPtyDroppedChunks = 0;
    };

    const discardQueuedTerminalOutput = () => {
      cancelTerminalOutputBatchTimers();
      pendingOutputWrites.length = 0;
      pendingOutputBytes = 0;
      outputBatchQueuedAt = 0;
    };

    const hidePrewarmPtyOutput = (reason) => {
      if (prewarmPtyRevealTimer) {
        window.clearTimeout(prewarmPtyRevealTimer);
        prewarmPtyRevealTimer = 0;
      }
      prewarmPtyOutputGateActive = true;
      resetPrewarmPtyOutputGateCounters();
      discardQueuedTerminalOutput();
      setTerminalPtyRevealReadyState(false);
      logTerminalDiagnosticEvent("frontend.prewarm_pty_output_gate.hide", {
        paneId,
        reason,
        terminalIndex,
      });
    };

    const revealPrewarmPtyOutput = (reason, delayMs = TERMINAL_PREWARM_PTY_REVEAL_SETTLE_MS) => {
      if (isDisposed) {
        return;
      }

      if (prewarmPtyRevealTimer) {
        window.clearTimeout(prewarmPtyRevealTimer);
      }

      prewarmPtyRevealTimer = window.setTimeout(() => {
        prewarmPtyRevealTimer = 0;
        if (isDisposed) {
          return;
        }

        const droppedBytes = prewarmPtyDroppedBytes;
        const droppedChunks = prewarmPtyDroppedChunks;
        prewarmPtyOutputGateActive = false;
        resetPrewarmPtyOutputGateCounters();
        discardQueuedTerminalOutput();
        terminalFirstVisibleOutputAtRef.current = 0;
        sawFirstOutput = false;
        sawFirstVisibleOutput = false;
        visibleOutputBytes = 0;
        visibleOutputChunks = 0;

        try {
          terminal.clear?.();
        } catch (_error) {
          // Best-effort visual cleanup before the prepared PTY is revealed.
        }
        clearTerminalRendererRows("prewarm_pty_reveal", {
          droppedBytes,
          droppedChunks,
          reason,
        });
        setTerminalPtyRevealReadyState(true);
        resizeController?.resizeNow("prewarm_pty_reveal", {
          force: true,
          forceNative: true,
          nativeDelayMs: 0,
        });
        refreshTerminalRenderer("prewarm_pty_reveal", {
          droppedBytes,
          droppedChunks,
          reason,
        });
        logTerminalDiagnosticEvent("frontend.prewarm_pty_output_gate.reveal", {
          droppedBytes,
          droppedChunks,
          paneId,
          reason,
          terminalIndex,
        });
      }, Math.max(0, Number(delayMs) || 0));
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

    const getTerminalOutputFlushByteBudget = (options = {}) => {
      if (options.flushAll === true) {
        return Math.max(TERMINAL_OUTPUT_FLUSH_MIN_BYTES, pendingOutputBytes);
      }
      if (isTerminalOutputHidden()) {
        return TERMINAL_OUTPUT_FLUSH_HIDDEN_MAX_BYTES;
      }

      const active = terminalActiveRef.current;
      const baseBudget = active
        ? TERMINAL_OUTPUT_FLUSH_ACTIVE_MAX_BYTES
        : TERMINAL_OUTPUT_FLUSH_BACKGROUND_MAX_BYTES;

      return Math.max(
        TERMINAL_OUTPUT_FLUSH_MIN_BYTES,
        Math.min(Math.floor(baseBudget), Math.floor(outputAdaptiveFlushMaxBytes)),
      );
    };

    const recordTerminalOutputWriteTiming = (writeCallbackMs, batchBytes, options = {}) => {
      if (options.hidden === true) {
        return;
      }

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

    function scheduleRemainingTerminalOutputWrites() {
      if (!pendingOutputWrites.length) {
        forceOutputFlushAfterWriteReason = "";
        return;
      }

      const forcedFlushReason = forceOutputFlushAfterWriteReason;
      forceOutputFlushAfterWriteReason = "";
      if (forcedFlushReason) {
        flushTerminalOutputBatch(forcedFlushReason, { flushAll: true });
      } else {
        scheduleTerminalOutputBatchFlush();
      }
    }

    const flushTerminalOutputBatch = (reason, options = {}) => {
      if (isDisposed || !pendingOutputWrites.length) {
        cancelTerminalOutputBatchTimers();
        pendingOutputWrites.length = 0;
        pendingOutputBytes = 0;
        outputBatchQueuedAt = 0;
        forceOutputFlushAfterWriteReason = "";
        return;
      }

      if (outputWriteInFlight) {
        if (options.flushAll === true) {
          forceOutputFlushAfterWriteReason = reason || "flush_now";
        }
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
      } = takeTerminalOutputBatch(getTerminalOutputFlushByteBudget(options));
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
        scheduleRemainingTerminalOutputWrites();
        return;
      }
      if (shouldDropClaudeResizeDuplicateRepaint(batchData, {
        outputDebug,
        reason,
        writes: writes.length,
      })) {
        scheduleRemainingTerminalOutputWrites();
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
      const outputHiddenAtWrite = isTerminalOutputHidden();
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
        recordTerminalOutputWriteTiming(writeCallbackMs, batchBytes, {
          hidden: outputHiddenAtWrite,
        });
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

        scheduleRemainingTerminalOutputWrites();

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
        scheduleRemainingTerminalOutputWrites();
      }
    };

    const scheduleTerminalOutputBatchFlush = () => {
      terminalGlobalRenderScheduler.request(renderSchedulerId);
    };
    const flushCurrentOutputNow = (reason = "flush_now") => {
      if (!pendingOutputWrites.length) {
        return;
      }
      // Reveal used to drain the ENTIRE hidden backlog (≤256KB/pane, several
      // panes at once on a workspace switch) through xterm synchronously —
      // measured 2.5-3s main-thread freezes per switch. Catch up in normal
      // active-budget chunks instead; the render scheduler keeps this pane
      // flushing every frame until the backlog is gone (~16KB/frame).
      flushTerminalOutputBatch(reason);
      if (pendingOutputWrites.length) {
        scheduleTerminalOutputBatchFlush();
      }
    };
    terminalOutputFlushNowRef.current = flushCurrentOutputNow;

    terminalGlobalRenderScheduler.register({
      flush: (reason) => flushTerminalOutputBatch(reason),
      getPendingBytes: () => pendingOutputBytes,
      getQueuedAt: () => outputBatchQueuedAt,
      hasPriorityPending: () => terminalActiveRef.current
        && isTerminalOutputRenderVisible()
        && pendingOutputWrites.some((write) => (
          write?.isFirstOutputChunk === true
          || write?.isFirstVisibleOutputChunk === true
        )),
      hasPending: () => !isDisposed && !outputWriteInFlight && pendingOutputWrites.length > 0,
      id: renderSchedulerId,
      isActive: () => terminalActiveRef.current && isTerminalOutputRenderVisible(),
      isVisible: () => isTerminalOutputRenderVisible(),
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

      const outputBatchMaxBytes = isTerminalOutputHidden()
        ? TERMINAL_OUTPUT_HIDDEN_BATCH_MAX_BYTES
        : TERMINAL_OUTPUT_BATCH_MAX_BYTES;
      if (pendingOutputBytes >= outputBatchMaxBytes) {
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

    const terminalSurfaceSlot = container.closest?.('[data-terminal-surface-slot="true"]') || null;
    const elementNodeType = typeof Node !== "undefined" ? Node.ELEMENT_NODE : 1;
    const terminalVisibleForPaint = () => {
      if (isDisposed || !container?.isConnected) {
        return false;
      }

      if (
        terminalSurfaceSlot
        && (
          terminalSurfaceSlot.getAttribute("data-terminal-tab-hidden") === "true"
          || terminalSurfaceSlot.getAttribute("data-terminal-hidden") === "true"
        )
      ) {
        return false;
      }

      const rect = container.getBoundingClientRect?.();
      if (!rect || rect.width < 2 || rect.height < 2) {
        return false;
      }

      let node = container;
      while (node && node.nodeType === elementNodeType) {
        if (node.hidden) {
          return false;
        }
        const style = window.getComputedStyle?.(node);
        if (
          style
          && (
            style.display === "none"
            || style.visibility === "hidden"
            || style.visibility === "collapse"
          )
        ) {
          return false;
        }
        node = node.parentElement;
      }

      return true;
    };
    terminalOutputRenderVisible = () => terminalVisibleForPaint() && !windowBreakoutHostedRef.current;

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
      isVisible: terminalVisibleForPaint,
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

    // Reveal path: terminal slots and workspace runtime layers hide with
    // `visibility: hidden`, which keeps layout boxes alive, so ResizeObserver
    // does NOT fire when a workspace or tab goes hidden -> visible. Without an
    // explicit recovery the mount/activation resizes that ran while the surface
    // was hidden were skipped as "surface_hidden" and the terminal never
    // painted until a full reload.
    //
    // A plain refresh + non-forced resize is not enough on its own: when the
    // grid size was already applied during launch, the reveal resize is dropped
    // as a "duplicate_size" no-op, so no SIGWINCH reaches the agent and the
    // WebGL texture atlas is never rebuilt. A TUI agent (Claude/Codex) only
    // repaints on SIGWINCH, and a renderer whose atlas/backing store was built
    // while the slot was hidden stays blank until it is rebuilt -- which is the
    // intermittent "one pane is black until I restart it" bug. So the reveal
    // recovery forces a real resize (rebuilds the atlas + TIOCSWINSZ-nudges the
    // PTY into a repaint + syncs xterm's renderer dimensions), clears the
    // texture atlas directly as a belt-and-suspenders for the DOM/WebGL
    // renderer, does a full refresh, and re-paints once more shortly after in
    // case the render service was still settling visibility at the exact reveal
    // instant. This mirrors the manual "restart pane" cure without remounting.
    if (typeof MutationObserver === "function") {
      const recoverRevealedTerminalPaint = (reason, options = {}) => {
        if (isDisposed || !terminalVisibleForPaint()) {
          return;
        }
        if (!terminalPtyRevealReadyRef.current && runtimeTerminalState === "running") {
          setTerminalPtyRevealReadyState(true);
        }
        const resetWebgl = options.resetWebgl !== false;
        if (resetWebgl) {
          resetTerminalWebglRenderer(reason);
        }
        try {
          terminal.clearTextureAtlas?.();
        } catch (_error) {
          // Best effort: the DOM renderer has no atlas and older builds may not
          // expose this; the forced resize/refresh below still recovers paint.
        }
        void resizeController?.resizeNow(reason, {
          force: true,
          forceNative: true,
          nativeDelayMs: 0,
        });
        refreshTerminalRenderer(reason);
        if (terminalActiveRef.current === true) {
          attachDeferredWebglRef.current?.(reason);
        }
        scheduleVisibleOutputRefresh(`${reason}_retry`, {}, 48);
      };

      const revealTimers = new Set();
      let revealWebglResetScheduled = false;
      const scheduleRevealRecovery = (reason, options = {}) => {
        const delays = Array.isArray(options.delays) && options.delays.length
          ? options.delays
          : [0, 80, 220];
        const shouldResetWebgl = options.resetWebgl !== false && !revealWebglResetScheduled;
        if (shouldResetWebgl) {
          revealWebglResetScheduled = true;
        }
        delays.forEach((delayMs) => {
          const timer = window.setTimeout(() => {
            revealTimers.delete(timer);
            recoverRevealedTerminalPaint(delayMs ? `${reason}_settled` : reason, {
              resetWebgl: delayMs === 0 && shouldResetWebgl,
            });
          }, Math.max(0, Number(delayMs) || 0));
          revealTimers.add(timer);
        });
      };

      const observeTargets = [];
      let ancestor = terminalSurfaceSlot || container;
      while (ancestor && ancestor.nodeType === elementNodeType) {
        observeTargets.push(ancestor);
        if (ancestor === document.body || ancestor === document.documentElement) {
          break;
        }
        ancestor = ancestor.parentElement;
      }

      let surfaceWasVisible = terminalVisibleForPaint();
      let outputWasVisible = isTerminalOutputRenderVisible();
      const handleRevealCandidate = (reason, options = {}) => {
        const surfaceVisibleNow = terminalVisibleForPaint();
        const outputVisibleNow = isTerminalOutputRenderVisible();
        if (outputVisibleNow && (!outputWasVisible || options.force === true)) {
          flushCurrentOutputNow(reason);
        }
        if (surfaceVisibleNow && (!surfaceWasVisible || options.force === true)) {
          scheduleRevealRecovery(reason, options);
        }
        if (!surfaceVisibleNow) {
          revealWebglResetScheduled = false;
        }
        surfaceWasVisible = surfaceVisibleNow;
        outputWasVisible = outputVisibleNow;
      };

      const revealObserver = new MutationObserver(() => {
        handleRevealCandidate("surface_revealed");
      });
      observeTargets.forEach((target) => {
        revealObserver.observe(target, {
          attributes: true,
          attributeFilter: [
            "class",
            "data-active",
            "data-terminal-hidden",
            "data-terminal-tab-hidden",
            "data-visible",
            "hidden",
            "style",
          ],
        });
      });
      disposables.push(() => revealObserver.disconnect());

      const handleWindowReveal = () => {
        handleRevealCandidate("window_revealed", {
          delays: [0, 120, 320],
          force: true,
        });
      };
      window.addEventListener("focus", handleWindowReveal);
      window.addEventListener("pageshow", handleWindowReveal);
      document.addEventListener("visibilitychange", handleWindowReveal);
      disposables.push(() => {
        window.removeEventListener("focus", handleWindowReveal);
        window.removeEventListener("pageshow", handleWindowReveal);
        document.removeEventListener("visibilitychange", handleWindowReveal);
        revealTimers.forEach((timer) => window.clearTimeout(timer));
        revealTimers.clear();
      });
    }

    async function startTerminal() {
      try {
        setPaneStage("starting", "Preparing Terminal", "Creating terminal session.");
        const outputDisplayMasker = createCoreRepoNameDisplayMasker({
          coreRepoPath: collapseFunctionalRepoPathToCoreRepoPath(workingDirectory || ""),
        });
        const outputSessionInspectionEnabled = !isGenericTerminal;
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
        const shouldAttemptTerminalReadyReconcile = () => false;
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
          if (prewarmPtyOutputGateActive) {
            prewarmPtyDroppedBytes += terminalData.byteLength;
            prewarmPtyDroppedChunks += sourceChunks;
            return;
          }
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
                  providerSessionId: nativeSessionId,
                  terminalIndex,
                  threadId: terminalThreadIdRef.current,
                  type: "provider-session",
                  workspaceId: workspace?.id || "",
                });
                invoke("terminal_record_provider_session", {
                  request: {
                    paneId,
                    instanceId: terminalInstanceId,
                    providerSessionId: nativeSessionId,
                    source: "terminal-output",
                  },
                }).catch((error) => {
                  logThreadBridgeDiagnostic("frontend.thread_provider_session.record_error", {
                    agentId: terminalAgentKind,
                    instanceId: terminalInstanceId,
                    message: error?.message || String(error || ""),
                    paneId,
                    terminalIndex,
                    threadId: terminalThreadIdRef.current || "",
                    workspaceId: workspace?.id || "",
                  });
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

        let outputTransportPreferred = false;
        let outputTransportReady = false;
        let outputTransportFallback = false;
        const terminalOutputWorkerSession = terminalPaneConfirmedRef.current
          ? createTerminalOutputWorkerSession({
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
          })
          : null;
        terminalOutputWorkerSessionRef.current = terminalOutputWorkerSession;
        terminalOutputWorkerSession?.setActive(terminalActiveRef.current === true);
        if (typeof terminalOutputWorkerSession?.prepareTransport === "function" && terminalPaneConfirmedRef.current) {
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
            // opencode's Bun runtime segfaults mid-session (bun.report panics),
            // killing the PTY with a crash exit. Resume the same provider
            // session instead of stranding the pane on the exited overlay.
            // Only sessions that reached "running" qualify — a launch-time
            // crash falls through to the overlay so resume failures can never
            // loop — and a stable run must precede each budget refill.
            const runningUptimeMs = terminalRunningSinceRef.current > 0
              ? performance.now() - terminalRunningSinceRef.current
              : 0;
            if (runningUptimeMs > 120000) {
              crashAutoRestartRef.current.attempts = 0;
            }
            const crashRestartSessionId = String(
              capturedProviderSessionId || startupThreadProviderSessionId || "",
            ).trim();
            if (
              terminalAgentKind === "opencode"
              && event.payload.exitCode !== 0
              && crashRestartSessionId
              && runningUptimeMs > 0
              && !terminalClosingRef.current
              && crashAutoRestartRef.current.attempts < 3
            ) {
              crashAutoRestartRef.current.attempts += 1;
              logThreadBridgeDiagnostic("frontend.terminal_crash_auto_restart", {
                agentId: terminalAgentKind,
                attempt: crashAutoRestartRef.current.attempts,
                exitCode: event.payload.exitCode ?? null,
                instanceId: terminalInstanceId,
                paneId,
                runningUptimeMs: Math.round(runningUptimeMs),
                terminalIndex,
                threadId: terminalThreadIdRef.current || "",
                workspaceId: workspace?.id || "",
              });
              setPaneStage(
                "starting",
                "Restarting Terminal",
                "opencode crashed — resuming the session.",
              );
              reloadTerminalWithProviderSession({
                agentId: terminalAgentKind,
                providerSessionId: crashRestartSessionId,
                reason: "opencode_crash_auto_restart",
                threadId: terminalThreadIdRef.current || "",
              });
              return;
            }
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
              appForkEnabled: canRequestForkTerminalRef.current === true && hasOpenPty,
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
        const getTerminalBufferOutputMark = () => {
          const activeBuffer = terminal?.buffer?.active;
          if (!activeBuffer) {
            return 0;
          }
          return Math.max(0, Number(activeBuffer.length || 0));
        };
        const getTerminalBufferTextSince = (startLine, maxRows = 80) => {
          const activeBuffer = terminal?.buffer?.active;
          if (!activeBuffer) {
            return "";
          }
          const lineCount = Number(activeBuffer.length || 0);
          if (!lineCount) {
            return "";
          }
          const safeStartLine = Math.max(0, Number(startLine) || 0);
          if (safeStartLine >= lineCount) {
            return "";
          }
          const rowLimit = Math.max(1, Math.min(160, Number(maxRows) || 80));
          const firstLine = Math.max(safeStartLine, lineCount - rowLimit);
          return getTerminalBufferText(activeBuffer, Math.max(1, lineCount - firstLine), firstLine);
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
        const waitForRemotePermissionConfigSettle = (delayMs = 150) => (
          new Promise((resolve) => {
            window.setTimeout(resolve, Math.max(0, Number(delayMs) || 0));
          })
        );
        const remotePermissionConfigSnapshot = () => {
          const rows = Math.max(12, Math.min(80, Number(terminal?.rows || 24) || 24));
          return {
            tailText: getTerminalBufferTailText(rows),
            viewportText: getTerminalViewportText(rows),
          };
        };
        const remotePermissionConfigText = () => {
          const snapshot = remotePermissionConfigSnapshot();
          return [snapshot.viewportText, snapshot.tailText].filter(Boolean).join("\n");
        };
        const remotePermissionConfigViewportText = () => (
          remotePermissionConfigSnapshot().viewportText || ""
        );
        const remotePermissionConfigFreshTextSince = (startLine, maxRows = 80) => (
          getTerminalBufferTextSince(startLine, maxRows)
        );
        const writeRemotePermissionConfigInput = async (data) => {
          await invoke("terminal_write", {
            data,
            instanceId: terminalInstanceIdRef.current || terminalInstanceId || undefined,
            paneId,
            promptEventSource: REMOTE_PERMISSION_CONFIG_SOURCE,
            threadId: terminalThreadIdRef.current || startupThreadId || undefined,
          });
        };
        const sendRemotePermissionConfigResult = (detail, result) => {
          window.dispatchEvent(new CustomEvent(REMOTE_PERMISSION_CONFIG_RESULT_EVENT, {
            detail: {
              commandId: detail.commandId || "",
              permissionMode: detail.permissionMode || "",
              permissionRequestId: detail.permissionRequestId || "",
              provider: detail.provider || terminalAgentKind,
              targetPaneId: detail.targetPaneId || detail.paneId || paneId,
              ...result,
            },
          }));
        };
        const remotePermissionConfigRequestMatchesPane = (detail = {}) => {
          const requestedPaneId = String(detail.targetPaneId || detail.paneId || detail.terminalId || "").trim();
          if (requestedPaneId && requestedPaneId !== paneId) {
            return false;
          }
          const requestedWorkspaceId = String(detail.workspaceId || detail.workspace_id || "").trim();
          if (requestedWorkspaceId && requestedWorkspaceId !== String(workspace?.id || "").trim()) {
            return false;
          }
          const requestedThreadId = String(detail.targetThreadId || detail.threadId || "").trim();
          if (requestedThreadId && requestedThreadId !== String(terminalThreadIdRef.current || startupThreadId || "").trim()) {
            return false;
          }
          const requestedInstanceId = Number.parseInt(detail.instanceId || detail.terminalInstanceId || 0, 10);
          if (
            Number.isInteger(requestedInstanceId)
            && requestedInstanceId > 0
            && requestedInstanceId !== Number(terminalInstanceIdRef.current || terminalInstanceId || 0)
          ) {
            return false;
          }
          const requestedTerminalIndex = Number.parseInt(detail.targetTerminalIndex ?? detail.terminalIndex ?? "", 10);
          return !Number.isInteger(requestedTerminalIndex) || requestedTerminalIndex === terminalIndex;
        };
        const waitForCodexPermissionPicker = async (permissionMode, outputMark) => {
          const startedAt = Date.now();
          let latestMatch = findCodexPermissionPickerTarget(
            remotePermissionConfigFreshTextSince(outputMark, 80),
            permissionMode,
          );
          while (!latestMatch.found && !latestMatch.ambiguous && Date.now() - startedAt < 2_000) {
            await waitForRemotePermissionConfigSettle(120);
            latestMatch = findCodexPermissionPickerTarget(
              remotePermissionConfigFreshTextSince(outputMark, 80),
              permissionMode,
            );
          }
          return latestMatch;
        };
        const waitForCodexPermissionStatus = async (permissionMode) => {
          const statusOutputMark = getTerminalBufferOutputMark();
          await writeRemotePermissionConfigInput("\u0015/status\r");
          const startedAt = Date.now();
          let statusText = remotePermissionConfigFreshTextSince(statusOutputMark, 80);
          let freshOutputObserved = Boolean(statusText.trim());
          let latestState = codexPermissionPostSelectionState(statusText, permissionMode);
          while (
            (!freshOutputObserved || !latestState.matched)
            && !latestState.errorRows.length
            && Date.now() - startedAt < 2_000
          ) {
            await waitForRemotePermissionConfigSettle(160);
            statusText = remotePermissionConfigFreshTextSince(statusOutputMark, 80);
            freshOutputObserved = Boolean(statusText.trim());
            latestState = codexPermissionPostSelectionState(statusText, permissionMode);
          }
          return {
            ...latestState,
            statusChanged: freshOutputObserved,
          };
        };
        const applyCodexRemotePermissionConfig = async (permissionMode) => {
          const targetMode = normalizePermissionModeForProvider("codex", permissionMode);
          const pickerOutputMark = getTerminalBufferOutputMark();
          await writeRemotePermissionConfigInput("\u0015/permissions\r");
          const picker = await waitForCodexPermissionPicker(targetMode, pickerOutputMark);
          if (!picker.found) {
            await writeRemotePermissionConfigInput("\x1b");
            throw new Error(
              picker.rows.length
                ? `Codex permission mode ${targetMode} was not visible. Saw: ${picker.rows.join(", ")}.`
                : "Codex permission picker did not show available modes.",
            );
          }
          if (picker.arrowDownCount > 0) {
            await writeRemotePermissionConfigInput("\x1b[B".repeat(picker.arrowDownCount));
            await waitForRemotePermissionConfigSettle(80);
          }
          await writeRemotePermissionConfigInput("\r");
          await waitForRemotePermissionConfigSettle(260);
          const postText = remotePermissionConfigViewportText();
          if (codexPermissionPickerOpen(postText)) {
            await writeRemotePermissionConfigInput("\x1b");
            throw new Error(`Codex permission picker stayed open after selecting ${picker.label}.`);
          }
          const statusState = await waitForCodexPermissionStatus(targetMode);
          if (statusState.errorRows.length) {
            throw new Error(`Codex permission status reported an error after selecting ${picker.label}: ${statusState.errorRows.join(" ")}`);
          }
          if (!statusState.statusChanged) {
            throw new Error(`Unable to confirm Codex permission mode ${targetMode}; /status output did not update.`);
          }
          if (!statusState.matched) {
            throw new Error(
              `Unable to confirm Codex permission mode ${targetMode}. Saw status: ${statusState.evidenceRows.join(" ") || "none"}.`,
            );
          }
          return {
            applied: true,
            evidenceRows: statusState.evidenceRows,
            labelsSeen: picker.rows,
            message: `Permission mode changed to ${targetMode}.`,
            permissionMode: targetMode,
          };
        };
        const applyClaudeRemotePermissionConfig = async (permissionMode) => {
          const targetMode = normalizePermissionModeForProvider("claude", permissionMode);
          await writeRemotePermissionConfigInput("\u0015");
          await waitForRemotePermissionConfigSettle(80);
          let currentMode = claudePermissionModeFromText(remotePermissionConfigViewportText());
          const originalMode = currentMode;
          if (!originalMode) {
            await writeRemotePermissionConfigInput("\x1b");
            throw new Error("Unable to determine Claude's original permission mode; no mode keys were sent. Seen modes: none.");
          }
          if (currentMode === targetMode) {
            return {
              applied: true,
              message: `Permission mode already ${targetMode}.`,
              permissionMode: targetMode,
              seenModes: [currentMode],
            };
          }
          const maxCycleSteps = 8;
          const cycleClaudePermissionMode = async () => {
            await writeRemotePermissionConfigInput("\x1b[Z");
            await waitForRemotePermissionConfigSettle(180);
            currentMode = claudePermissionModeFromText(remotePermissionConfigViewportText());
            return currentMode;
          };
          const cycleResult = await cyclePermissionModeWithBestEffortRestore({
            cycleMode: cycleClaudePermissionMode,
            maxCycleSteps,
            originalMode,
            targetMode,
          });
          currentMode = cycleResult.currentMode;
          if (cycleResult.applied) {
            return {
              applied: true,
              message: `Permission mode changed to ${targetMode}.`,
              permissionMode: targetMode,
              seenModes: cycleResult.seenModes,
            };
          }
          await writeRemotePermissionConfigInput("\x1b").catch(() => {});
          const restartMessage = `Claude permission mode ${targetMode} requires restart with --permission-mode ${targetMode}.`;
          const restoreError = cycleResult.restoreError
            ? getErrorMessage(cycleResult.restoreError, "restore write failed")
            : "";
          const seenMessage = `Seen modes: ${cycleResult.seenModes.join(", ") || "none"}. Original mode: ${originalMode}. Current mode: ${currentMode || "unknown"}. Restore: ${cycleResult.restored ? "restored" : `failed${restoreError ? ` (${restoreError})` : ""}`}.`;
          if (cycleResult.cycleError) {
            throw new Error(`${getErrorMessage(cycleResult.cycleError, restartMessage)} ${seenMessage}`);
          }
          if (!claudePermissionTargetAvailableInCycle(targetMode, cycleResult.seenModes)) {
            throw new Error(`${restartMessage} ${seenMessage}`);
          }
          throw new Error(`${restartMessage} ${seenMessage}`);
        };
        const applyOpenCodeRemotePermissionConfig = async (permissionMode) => {
          const targetMode = normalizePermissionModeForProvider("opencode", permissionMode);
          await writeRemotePermissionConfigInput("\u0015");
          await waitForRemotePermissionConfigSettle(80);
          let currentMode = opencodeAgentModeFromText(remotePermissionConfigViewportText());
          const originalMode = currentMode;
          if (!originalMode) {
            await writeRemotePermissionConfigInput("\x1b");
            throw new Error("Unable to determine OpenCode's original agent mode; no mode keys were sent. Seen agents: none.");
          }
          if (currentMode === targetMode) {
            return {
              applied: true,
              message: `Permission mode already ${targetMode}.`,
              permissionMode: targetMode,
              seenModes: [currentMode],
            };
          }
          const maxCycleSteps = 8;
          const cycleOpenCodeAgentMode = async () => {
            await writeRemotePermissionConfigInput("\t");
            await waitForRemotePermissionConfigSettle(180);
            currentMode = opencodeAgentModeFromText(remotePermissionConfigViewportText());
            return currentMode;
          };
          const cycleResult = await cyclePermissionModeWithBestEffortRestore({
            cycleMode: cycleOpenCodeAgentMode,
            maxCycleSteps,
            originalMode,
            targetMode,
          });
          currentMode = cycleResult.currentMode;
          if (cycleResult.applied) {
            return {
              applied: true,
              message: `Permission mode changed to ${targetMode}.`,
              permissionMode: targetMode,
              seenModes: cycleResult.seenModes,
            };
          }
          await writeRemotePermissionConfigInput("\x1b").catch(() => {});
          const restoreError = cycleResult.restoreError
            ? getErrorMessage(cycleResult.restoreError, "restore write failed")
            : "";
          const seenMessage = `Seen agents: ${cycleResult.seenModes.join(", ") || "none"}. Original agent: ${originalMode}. Current agent: ${currentMode || "unknown"}. Restore: ${cycleResult.restored ? "restored" : `failed${restoreError ? ` (${restoreError})` : ""}`}.`;
          if (cycleResult.cycleError) {
            throw new Error(`${getErrorMessage(cycleResult.cycleError, `OpenCode agent ${targetMode} cycle failed.`)} ${seenMessage}`);
          }
          throw new Error(`OpenCode agent ${targetMode} was not reachable by Tab cycle. ${seenMessage}`);
        };
        const applyRemotePermissionConfig = async (detail = {}) => {
          const provider = normalizePermissionModeForProvider("opencode", detail.provider || terminalAgentKind) === "opencode"
            ? "opencode"
            : getTerminalAgentKind(detail.provider || terminalAgentKind);
          const permissionMode = normalizePermissionModeForProvider(provider, detail.permissionMode || detail.permission_mode);
          if (!permissionMode) {
            throw new Error("Remote permission configuration did not include a supported permission_mode.");
          }
          if (provider === "codex") {
            return applyCodexRemotePermissionConfig(permissionMode);
          }
          if (provider === "claude") {
            return applyClaudeRemotePermissionConfig(permissionMode);
          }
          if (provider === "opencode") {
            return applyOpenCodeRemotePermissionConfig(permissionMode);
          }
          throw new Error("Remote permission configuration requires provider codex, claude, or opencode.");
        };
        const handleRemotePermissionConfigRequest = (event) => {
          const detail = event?.detail && typeof event.detail === "object" ? event.detail : {};
          if (!remotePermissionConfigRequestMatchesPane(detail)) {
            return;
          }
          void (async () => {
            try {
              const result = await applyRemotePermissionConfig(detail);
              sendRemotePermissionConfigResult(detail, {
                ok: true,
                status: "applied",
                ...result,
              });
            } catch (error) {
              sendRemotePermissionConfigResult(detail, {
                error: getErrorMessage(error, "Unable to apply permission mode."),
                ok: false,
                status: "failed",
              });
            }
          })();
        };
        window.addEventListener(
          REMOTE_PERMISSION_CONFIG_REQUEST_EVENT,
          handleRemotePermissionConfigRequest,
        );
        disposables.push(() => {
          window.removeEventListener(
            REMOTE_PERMISSION_CONFIG_REQUEST_EVENT,
            handleRemotePermissionConfigRequest,
          );
        });
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
          // Query replies (OSC 4 palette, DA, etc.) written into a dead or
          // dying session get echoed back as raw escape text by the cooked-
          // mode tty (seen with bun's crash reporter querying colors on the
          // way down). A reply is only meaningful to a live foreground
          // process — drop it for terminal states.
          if (
            terminalGeneratedReply
            && ["exited", "closed", "blocked"].includes(terminalStateRef.current)
          ) {
            return;
          }
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
            const submittedTerminalCommand = String(promptTextAtSubmit || "").trim().toLowerCase();
            const isControlHistoryPrompt = isTerminalControlHistoryPrompt(promptTextAtSubmit);
            const isAppForkCommandSubmit = Boolean(
              terminalSubmittedInputHasText
              && submittedTerminalCommand === "fork"
              && !isGenericTerminal
              && canRequestForkTerminalRef.current,
            );
            const shouldSuppressSubmitLifecycle = Boolean(
              isControlHistoryPrompt
              || isControlViewportPrompt
              || isControlSuppressedScreenSubmit
              || isAppForkCommandSubmit
            );
            if (isAppForkCommandSubmit) {
              logBigViewSyncDiagnosticEvent("tui.text.fork_command_defer_to_backend", {
                agentId: terminalAgentKind,
                instanceId: terminalInstanceId,
                paneId,
                terminalIndex,
                threadId: terminalThreadIdRef.current || "",
                workspaceId: workspace?.id || "",
              });
            }
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
              const terminalDirectTodoRefs = appControlTerminalSurface
                ? null
                : getTerminalDirectTodoRefs(promptId);
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
                reason: isAppForkCommandSubmit
                  ? "app_fork_command"
                  : isControlViewportPrompt
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
              let codexConfirmedStartDispatched = false;
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
                      if (terminalUsesActivityHooks && terminalAgentKind === "codex") {
                        const providerTurnStartProjectionEvents = buildProviderTurnStartProjectionEvents({
                          agentId: terminalAgentKind,
                          includeUserMessage: false,
                          source: "terminal-confirmed",
                          startedAt: bridge.startedAt,
                          text: bridge.promptEventText,
                          turnId: bridge.turnId,
                          userMessageId: bridge.promptEventId,
                        });
                        codexConfirmedStartDispatched = true;
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
                          nativeSessionId: "",
                          nativeSessionKind: "",
                          nativeSessionSource: "",
                          paneId,
                          pendingPromptId: bridge.promptEventId,
                          projectionEvents: providerTurnStartProjectionEvents,
                          providerSessionId: "",
                          repoPath: workingDirectory || "",
                          status: "active",
                          terminalIndex,
                          threadId: bridge.threadId,
                          type: "provider-turn-started",
                          workspaceId: bridge.workspaceId,
                          workspaceName: workspace?.name || "",
                        });
                        logBigViewSyncDiagnosticEvent("tui.text.confirmed_submit_bridge_codex_start", {
                          agentId: terminalAgentKind,
                          instanceId: terminalInstanceId,
                          paneId,
                          promptEventId: bridge.promptEventId,
                          promptSource: submittedPayload?.promptSource || "",
                          reason: "terminal_submit_observed",
                          terminalIndex,
                          threadId: bridge.threadId,
                          workspaceId: bridge.workspaceId,
                        });
                      }
                      return bridge.acceptedWaiter.promise.catch((acceptanceError) => {
                        logBigViewSyncDiagnosticEvent("tui.text.confirmed_submit_bridge_acceptance_missed", {
                          agentId: terminalAgentKind,
                          instanceId: terminalInstanceId,
                          message: getErrorMessage(acceptanceError, "Prompt was submitted but session acceptance was not observed."),
                          paneId,
                          promptEventId: bridge.promptEventId,
                          terminalIndex,
                          threadId: bridge.threadId,
                          workspaceId: bridge.workspaceId,
                        });
                        return null;
                      });
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
                      if (codexConfirmedStartDispatched) {
                        if (acceptedProviderSessionId) {
                          onThreadTerminalLifecycle?.({
                            agentId: terminalAgentKind,
                            instanceId: terminalInstanceId,
                            nativeSessionId: acceptedProviderSessionId,
                            nativeSessionKind: "session",
                            nativeSessionSource: "terminal-confirmed:session-accepted",
                            paneId,
                            pendingPromptId: bridge.promptEventId,
                            providerSessionId: acceptedProviderSessionId,
                            repoPath: workingDirectory || "",
                            status: "active",
                            terminalIndex,
                            threadId: bridge.threadId,
                            type: "provider-session",
                            workspaceId: bridge.workspaceId,
                            workspaceName: workspace?.name || "",
                          });
                        }
                      } else if (terminalUsesActivityHooks) {
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
              const interruptedTodoCount = Number(
                result?.interruptedTodoCount
                  ?? result?.interrupted_todo_count
                  ?? 0,
              ) || 0;
              const inputReadyAt = new Date().toISOString();
              const interruptSource = interruptedActiveTask || interruptedParkedPromptCount > 0 || interruptedTodoCount > 0
                ? "escape_key_task_interrupted"
                : "escape_key_manual_cancel";
              const submittedPromptForReady = terminalThreadSubmittedPromptRef.current;
              markTerminalThreadActivityStatus("interrupted", {
                reason: interruptSource,
              });
              terminalThreadLastReadyAtMsRef.current = parseTerminalStateTimestampMs(inputReadyAt) || Date.now();
              terminalThreadSubmittedPromptRef.current = null;
              onThreadTerminalLifecycle?.({
                activityStatus: "interrupted",
                agentId: terminalAgentKind,
                commandPhase: "interrupted",
                executionPhase: "interrupted",
                inputReady: true,
                inputReadyAt,
                inputReadyConfidence: interruptSource,
                instanceId: terminalInstanceId,
                ...getTerminalNativeRailStateFields("interrupted"),
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
        const openProvider = isGenericTerminal ? null : agent.id;
        let agentStartedInCurrentPty = isGenericTerminal || !shouldPrewarmShell;
        const clearPrewarmAgentDirectOpenTimer = () => {
          if (!prewarmAgentDirectOpenTimer) {
            return;
          }

          window.clearTimeout(prewarmAgentDirectOpenTimer);
          startupWatchTimers.delete(prewarmAgentDirectOpenTimer);
          prewarmAgentDirectOpenTimer = 0;
        };
        const schedulePrewarmAgentDirectOpenFallback = (reason = "prewarm_waiting_for_agent_start") => {
          if (!shouldPrewarmShell || isDisposed || agentStartedInCurrentPty || terminalClosingRef.current) {
            return;
          }

          clearPrewarmAgentDirectOpenTimer();
          prewarmAgentDirectOpenTimer = window.setTimeout(() => {
            const timer = prewarmAgentDirectOpenTimer;
            startupWatchTimers.delete(timer);
            prewarmAgentDirectOpenTimer = 0;

            if (
              isDisposed
              || !hasOpenPty
              || agentStartedInCurrentPty
              || terminalClosingRef.current
              || terminalClosed
              || terminalStateRef.current !== "prewarmed"
            ) {
              return;
            }

            if (!agentLaunchReadyRef.current) {
              schedulePrewarmAgentDirectOpenFallback("agent_launch_not_ready");
              return;
            }

            logTerminalStatus("frontend.terminal_lifecycle.prewarm_direct_open_fallback", {
              agentId: terminalAgentKind,
              delayMs: TERMINAL_PREWARM_AGENT_DIRECT_OPEN_TIMEOUT_MS,
              paneId,
              reason,
              startupThreadId: startupThreadId || "",
              terminalIndex,
              workspaceId: workspace?.id || "",
            });
            restartWithEmptyTerminalSession({
              agentId: terminalAgentKind,
              nextThreadId: startupThreadId || undefined,
              reason: "prewarm_agent_start_timeout",
              statusDetail: "Starting the coding agent directly.",
            });
          }, TERMINAL_PREWARM_AGENT_DIRECT_OPEN_TIMEOUT_MS);
          startupWatchTimers.add(prewarmAgentDirectOpenTimer);
        };
        if (shouldPrewarmShell) {
          hidePrewarmPtyOutput("terminal_open_prewarm");
        } else {
          if (prewarmPtyRevealTimer) {
            window.clearTimeout(prewarmPtyRevealTimer);
            prewarmPtyRevealTimer = 0;
          }
          prewarmPtyOutputGateActive = false;
          resetPrewarmPtyOutputGateCounters();
          setTerminalPtyRevealReadyState(true);
        }
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
          clearPrewarmAgentDirectOpenTimer();
          startupWatchTimers.forEach((timer) => window.clearTimeout(timer));
          startupWatchTimers.clear();
          setPaneStage("starting", "Starting Agent", "Attaching the prepared terminal.");
          setTerminalError("");

          setPaneStage("running", "Agent Running", "Terminal is connected.");
          revealPrewarmPtyOutput(`${reason}_agent_started`, TERMINAL_PREWARM_PTY_REVEAL_SETTLE_MS);
          resizeController?.resizeNow("agent_launch_done", {
            force: true,
            forceNative: true,
            nativeDelayMs: 0,
          });
          refreshTerminalRenderer("agent_launch_done");
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
              agentId: terminalAgentKind,
              agentKind: terminalAgentKind,
              provider: openProvider,
              freshSession: forceFreshSessionForThisStart,
              providerSessionId: startupThreadProviderSessionId,
              forkFromProviderSessionId: forkFromProviderSessionIdForThisStart,
              model: startupThreadProviderModel,
              reasoningEffort: startupThreadProviderEffort,
              speed: startupThreadProviderSpeed,
              permissionMode: startupPermissionMode,
              plainShell: isGenericTerminal,
              preserveCoordinationSession: preserveCoordinationForThisStart,
              sessionMode: sessionModeForThisStart,
              slotKey: startupSlotKey,
              terminalIndex,
              threadId: startupThreadId,
              workingDirectory: workingDirectory || "",
              workspaceRootWasEmptyAtSelection: Boolean(workspaceRootWasEmptyAtSelection),
              workspaceId: workspace?.id || "",
              workspaceName: workspace?.name || "",
              terminalName: terminalRailAgentLabel,
              terminalNickname,
              appControlMcp: Boolean(appControlMcp && !isGenericTerminal),
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
        const backendReturnedProviderSession = Object.prototype.hasOwnProperty.call(openResult || {}, "providerSessionId");
        const openedProviderSessionId = String(
          backendReturnedProviderSession
            ? openResult?.providerSessionId || ""
            : startupThreadProviderSessionId || "",
        ).trim();
        const openedNativeSessionId = String(openResult?.nativeSessionId || openedProviderSessionId).trim();
        const openedForkFromProviderSessionId = String(
          openResult?.forkFromProviderSessionId
            || openResult?.fork_from_provider_session_id
            || forkFromProviderSessionIdForThisStart
            || "",
        ).trim();
        const openedProviderSessionDropped = Boolean(
          startupThreadProviderSessionId
            && !openedProviderSessionId
            && !openedForkFromProviderSessionId,
        );
        const openedSharedHistoryId = String(
          openResult?.sharedHistoryId
            || openResult?.shared_history_id
            || "",
        ).trim();
        const openedActivityStatus = normalizeTerminalEpochActivityStatus(
          openResult?.activityStatus || "idle",
          terminalAgentKind,
        );
        const openedCommandPhase = String(openResult?.commandPhase || "ready").trim() || "ready";
        const backendOpenedModel = String(openResult?.model || "").trim();
        const backendOpenedModelSource = String(openResult?.modelSource || "").trim();
        const openedProviderModel = backendOpenedModel || startupThreadProviderModel;
        const openedProviderModelSource = openedProviderModel
          ? backendOpenedModelSource === "request"
            ? startupThreadProviderModelSource || "request"
            : backendOpenedModelSource || startupThreadProviderModelSource
          : "";
        const openedInputReady = terminalUsesActivityHooks
          ? false
          : typeof openResult?.inputReady === "boolean"
            ? openResult.inputReady
            : !shouldPrewarmShell;
        const openedInputReadyAt = String(openResult?.inputReadyAt || "").trim()
          || (openedInputReady ? new Date().toISOString() : "");
        const rawOpenedTerminalWorkState = String(openResult?.terminalWorkState || "").trim();
        const openedTerminalWorkState = openedInputReady
          ? rawOpenedTerminalWorkState || "complete"
          : "running";
        logThreadBridgeDiagnostic("frontend.terminal_open.emit_opened_lifecycle", {
          agentId: agent?.id || terminalAgentKind,
          coordinationSessionPresent: Boolean(openResult?.sessionId),
          instanceId: terminalInstanceId,
          paneId,
          preserveCoordinationForThisStart,
          sessionMode: openResult?.sessionMode || sessionModeForThisStart,
          providerSessionOverridePresent: Boolean(providerSessionOverrideForThisStart),
          forkFromProviderSessionPresent: Boolean(openedForkFromProviderSessionId),
          openedProviderModel,
          openedProviderModelSource,
          startupThreadProviderModel: startupThreadProviderModel || "",
          startupThreadProviderModelSource,
          startupThreadProviderEffort,
          startupThreadProviderSpeed,
          startupPermissionMode,
          startupThreadId: startupThreadId || "",
          startupThreadProviderSessionPresent: Boolean(startupThreadProviderSessionId),
          backendProviderSessionPresent: Boolean(openedProviderSessionId),
          backendNativeSessionPresent: Boolean(openedNativeSessionId),
          backendProviderSessionReturned: backendReturnedProviderSession,
          openedProviderSessionDropped,
          terminalIndex,
          workspaceId: workspace?.id || "",
        });
        onThreadTerminalLifecycle?.({
          activityStatus: openedActivityStatus,
          agentBranch: openResult?.agentBranch || "",
          agentId: agent?.id || terminalAgentKind,
          commandPhase: openedCommandPhase,
          coordinationAgentId: openResult?.agentId || "",
          coordinationMode: openResult?.coordinationMode || "",
          inputReady: openedInputReady,
          inputReadyAt: openedInputReadyAt,
          inputReadyConfidence: openedInputReady ? "terminal-open" : "",
          instanceId: terminalInstanceId,
          model: openedProviderModel,
          modelSource: openedProviderModelSource,
          reasoningEffort: startupThreadProviderEffort,
          speed: startupThreadProviderSpeed,
          forkFromProviderSessionId: openedForkFromProviderSessionId,
          nativeSessionId: openedNativeSessionId,
          nativeSessionIdCleared: Boolean(openedForkFromProviderSessionId || openedProviderSessionDropped),
          nativeSessionKind: openedNativeSessionId ? "session" : "",
          nativeSessionSource: openedNativeSessionId ? "session-restore" : "",
          paneId,
          providerSessionId: openedProviderSessionId || openedNativeSessionId,
          providerSessionIdCleared: Boolean(openedForkFromProviderSessionId || openedProviderSessionDropped),
          sessionId: openResult?.sessionId || "",
          sharedHistoryId: openedSharedHistoryId,
          sessionMode: openResult?.sessionMode || sessionModeForThisStart,
          fileAuthority: openResult?.fileAuthority || "",
          slotKey: openResult?.slotKey || terminalThreadSlotKeyRef.current,
          status: openedInputReady ? "active" : "starting",
          statusTruth: openedTerminalWorkState,
          terminalWorkState: openedTerminalWorkState,
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
              nativeDelayMs: 0,
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
          model: startupThreadProviderModel,
          needsAgentStart: shouldPrewarmShell,
          paneId,
          forkFromProviderSessionId: openedForkFromProviderSessionId,
          providerSessionId: openedProviderSessionId || openedNativeSessionId,
          sharedHistoryId: openedSharedHistoryId,
          permissionMode: startupPermissionMode,
          ready: true,
          reasoningEffort: startupThreadProviderEffort,
          speed: startupThreadProviderSpeed,
          terminalIndex,
          threadId: startupThreadId,
          workspaceId: workspace?.id || "",
        });
        resizeController?.resizeNow("terminal_open_done", {
          force: true,
          forceNative: true,
          nativeDelayMs: 0,
        });
        refreshTerminalRenderer("terminal_open_done");
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
          let startedPrewarmedAgent = false;
          if (agentLaunchReadyRef.current && agentLaunchEpochRef.current > 0) {
            lastAgentLaunchEpochRef.current = agentLaunchEpochRef.current;
            startAgentInCurrentPty("prewarm_ready_after_gate", agentLaunchEpochRef.current);
            startedPrewarmedAgent = true;
          }
          if (!startedPrewarmedAgent) {
            schedulePrewarmAgentDirectOpenFallback("prewarm_shell_waiting_for_agent_start");
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
      disposeActiveWebglAddon("terminal_cleanup");
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
      if (prewarmPtyRevealTimer) {
        window.clearTimeout(prewarmPtyRevealTimer);
        prewarmPtyRevealTimer = 0;
      }
      if (prewarmAgentDirectOpenTimer) {
        window.clearTimeout(prewarmAgentDirectOpenTimer);
        prewarmAgentDirectOpenTimer = 0;
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
        forkFromProviderSessionId: forkFromProviderSessionIdForThisStart,
        providerSessionId: startupThreadProviderSessionId,
        permissionMode: String(permissionMode || "").trim(),
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
  }, [
    appControlTerminalSurface,
    paneId,
    restartKey,
    terminalClosed,
    terminalIndex,
    terminalRoleId,
    terminalStartupUnblocked,
    workspace?.id,
  ]);

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

      let pendingPromptDraftTransaction = null;
      let pendingPromptSyncKey = "";

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
          pendingPromptSyncKey = pendingSyncKey;
          const syncData = buildTerminalComposerDraftInput("", promptText, true);
          const syncSequenceTrace = getTerminalInputSequenceDiagnosticFields(syncData);
          pendingPromptDraftTransaction = setThreadComposerDraftValue(
            pendingSyncKey,
            promptText,
            "pending_prompt_sync_prompt",
          );
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
          const acceptedWaiter = createWorkspaceThreadPromptAcceptedWaiter({
            agentId: terminalAgentKind,
            expectedPrompt: promptText,
            promptId,
            threadId: currentThreadId,
            workspaceId: workspace?.id || thread?.workspaceId || "",
          });
          const acceptedPromise = acceptedWaiter.promise.then((detail) => ({
            detail,
            kind: "accepted",
          }), (error) => ({
            error,
            kind: "accept_error",
          }));
          const submitSequences = getPendingPromptSubmitAttemptSequences(
            terminalAgentKind,
            isGenericTerminal,
            { preferCarriageReturn: appControlTerminalSurface },
          );
          let activeSubmitWaiter = null;
          let directTodoCaptureSettled = false;
          let acceptedDetailFromRace = null;
          let observedSubmit = false;
          let observedSubmitRetried = false;

          const captureDirectTodoIfNeeded = async (pendingPromptSubmittedAt) => {
            if (directTodoCaptureSettled) {
              return;
            }
            directTodoCaptureSettled = true;
            if (appControlTerminalSurface) {
              logTerminalStatus("frontend.pending_prompt.direct_todo_capture_skip", {
                ...pendingPromptLogFields,
                instanceId: currentInstanceId,
                paneId,
                reason: "app_control_terminal",
                threadId: currentThreadId,
                workspaceId: workspace?.id || thread?.workspaceId || "",
              });
              logThreadBridgeDiagnostic("frontend.pending_prompt.direct_todo_capture_skip", {
                agentId: terminalAgentKind,
                deliveryMode: effectiveDeliveryMode,
                instanceId: currentInstanceId,
                paneId,
                promptId,
                reason: "app_control_terminal",
                terminalIndex,
                threadId: currentThreadId,
                workspaceId: workspace?.id || thread?.workspaceId || "",
              });
              return;
            }

            try {
              const capturedTodoItemId = await invoke("terminal_capture_direct_prompt_todo", {
                request: {
                  agentKind: terminalAgentKind,
                  itemId: "",
                  paneId,
                  prompt: promptText,
                  promptEventId: promptId,
                  terminalIndex,
                  threadId: currentThreadId,
                  workspaceId: workspace?.id || thread?.workspaceId || "",
                  workspaceName: workspace?.name || "",
                },
              });
              logTerminalStatus("frontend.pending_prompt.direct_todo_captured", {
                ...pendingPromptLogFields,
                capturedTodoItemId: capturedTodoItemId || "",
                instanceId: currentInstanceId,
                promptEventSubmittedAt: pendingPromptSubmittedAt,
                threadId: currentThreadId,
              });
              logThreadBridgeDiagnostic("frontend.pending_prompt.direct_todo_captured", {
                agentId: terminalAgentKind,
                capturedTodoItemId: capturedTodoItemId || "",
                deliveryMode: effectiveDeliveryMode,
                instanceId: currentInstanceId,
                paneId,
                promptId,
                promptText: pendingPromptTextDiagnostic,
                sendPolicy: "pending-prompt-terminal-direct-todo",
                terminalIndex,
                threadId: currentThreadId,
                workspaceId: workspace?.id || thread?.workspaceId || "",
              });
            } catch (captureError) {
              const captureMessage = getErrorMessage(captureError, "Unable to capture pending prompt todo.");
              logTerminalStatus("frontend.pending_prompt.direct_todo_capture_error", {
                ...pendingPromptLogFields,
                error: captureMessage,
                instanceId: currentInstanceId,
                promptEventSubmittedAt: pendingPromptSubmittedAt,
                threadId: currentThreadId,
              });
              logThreadBridgeDiagnostic("frontend.pending_prompt.direct_todo_capture_error", {
                agentId: terminalAgentKind,
                deliveryMode: effectiveDeliveryMode,
                error: captureMessage,
                instanceId: currentInstanceId,
                paneId,
                promptId,
                terminalIndex,
                threadId: currentThreadId,
                workspaceId: workspace?.id || thread?.workspaceId || "",
              });
            }
          };

          const writePendingPromptSubmit = async ({
            attemptIndex,
            promptEventSource,
            submitSequence,
            timeoutMs,
          }) => {
            const pendingPromptSubmittedAt = new Date().toISOString();
            const submitSequenceTrace = getTerminalInputSequenceDiagnosticFields(submitSequence);
            activeSubmitWaiter = await createTerminalPromptSubmittedWaiter({
              allowObservedInputGateForHookManaged: true,
              agentId: terminalAgentKind,
              expectedPrompt: promptText,
              instanceId: currentInstanceId,
              paneId,
              promptId,
              threadId: currentThreadId,
              timeoutMs,
              workspaceId: workspace?.id || thread?.workspaceId || "",
            });
            logTerminalStatus("frontend.pending_prompt.submit_write_start", {
              ...pendingPromptLogFields,
              attempt: attemptIndex + 1,
              instanceId: currentInstanceId,
              promptEventSubmittedAt: pendingPromptSubmittedAt,
              promptEventSource,
              submitSequence: submitSequenceTrace,
              submitSequenceLength: submitSequence.length,
              threadId: currentThreadId,
            });
            logThreadBridgeDiagnostic("frontend.pending_prompt.submit_sequence_resolved", {
              agentId: terminalAgentKind,
              attempt: attemptIndex + 1,
              deliveryMode: effectiveDeliveryMode,
              instanceId: currentInstanceId,
              paneId,
              promptId,
              promptEventSource,
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
              promptEventSource,
              promptEventSubmittedAt: pendingPromptSubmittedAt,
              promptEventText: promptText,
              threadId: currentThreadId,
            });
            logTerminalStatus("frontend.pending_prompt.submit_write_done", {
              ...pendingPromptLogFields,
              attempt: attemptIndex + 1,
              instanceId: currentInstanceId,
              promptEventSubmittedAt: pendingPromptSubmittedAt,
              promptEventSource,
              submitSequence: submitSequenceTrace,
              submitSequenceLength: submitSequence.length,
              threadId: currentThreadId,
            });
            logThreadBridgeDiagnostic("frontend.pending_prompt.submit_write_done", {
              agentId: terminalAgentKind,
              attempt: attemptIndex + 1,
              deliveryMode: effectiveDeliveryMode,
              instanceId: currentInstanceId,
              paneId,
              promptId,
              promptEventSource,
              promptEventSubmittedAt: pendingPromptSubmittedAt,
              promptText: pendingPromptTextDiagnostic,
              sendPolicy: "pending-prompt-terminal-confirmed-submit",
              submitSequence: submitSequenceTrace,
              terminalIndex,
              threadId: currentThreadId,
              workspaceId: workspace?.id || thread?.workspaceId || "",
            });
            await captureDirectTodoIfNeeded(pendingPromptSubmittedAt);
            const submitOutcome = await Promise.race([
              activeSubmitWaiter.promise.then((payload) => ({
                kind: "submitted",
                payload,
              }), (error) => ({
                error,
                kind: "submit_error",
              })),
              acceptedPromise,
            ]);
            if (submitOutcome.kind === "accepted") {
              activeSubmitWaiter.cancel();
              activeSubmitWaiter = null;
              return submitOutcome;
            }
            if (submitOutcome.kind === "submit_error") {
              activeSubmitWaiter = null;
              throw submitOutcome.error;
            }
            activeSubmitWaiter = null;
            return submitOutcome;
          };
          try {
            if (!submitSequences.length) {
              throw new Error("This pending prompt cannot send without a live coding-agent TUI.");
            }
            if (syncData && PENDING_PROMPT_SUBMIT_SYNC_SETTLE_MS > 0) {
              await waitForPendingPromptSubmitSettle();
            }
            let lastSubmitError = null;
            for (let attemptIndex = 0; attemptIndex < submitSequences.length; attemptIndex += 1) {
              const submitSequence = submitSequences[attemptIndex];
              const promptEventSource = attemptIndex === 0
                ? "pending-prompt"
                : "pending-prompt-submit-fallback";
              try {
                const submitOutcome = await writePendingPromptSubmit({
                  attemptIndex,
                  promptEventSource,
                  submitSequence,
                  timeoutMs: attemptIndex === 0
                    ? PENDING_PROMPT_SUBMIT_OBSERVE_TIMEOUT_MS
                    : PENDING_PROMPT_SUBMIT_RETRY_TIMEOUT_MS,
                });
                if (submitOutcome.kind === "accepted") {
                  acceptedDetailFromRace = submitOutcome.detail;
                } else if (submitOutcome.kind === "submitted") {
                  observedSubmit = true;
                  const hasFallback = attemptIndex < submitSequences.length - 1;
                  if (
                    hasFallback
                    && getTerminalAgentKind(terminalAgentKind) === "codex"
                    && submitSequence !== "\r"
                  ) {
                    const acceptedAfterObservedSubmit = await Promise.race([
                      acceptedPromise,
                      waitForPendingPromptSubmitSettle(PENDING_PROMPT_SUBMIT_OBSERVED_ACCEPT_GRACE_MS)
                        .then(() => ({ kind: "pending" })),
                    ]);
                    if (acceptedAfterObservedSubmit.kind === "accepted") {
                      acceptedDetailFromRace = acceptedAfterObservedSubmit.detail;
                    } else {
                      const latestDraft = String(threadComposerDraftsRef.current.get(pendingSyncKey) || "").trim();
                      if (latestDraft === promptText) {
                        observedSubmit = false;
                        observedSubmitRetried = true;
                        logTerminalStatus("frontend.pending_prompt.submit_observed_retry", {
                          ...pendingPromptLogFields,
                          attempt: attemptIndex + 1,
                          instanceId: currentInstanceId,
                          reason: "codex_primary_submit_observed_without_acceptance",
                          threadId: currentThreadId,
                        });
                        logThreadBridgeDiagnostic("frontend.pending_prompt.submit_observed_retry", {
                          agentId: terminalAgentKind,
                          attempt: attemptIndex + 1,
                          deliveryMode: effectiveDeliveryMode,
                          instanceId: currentInstanceId,
                          paneId,
                          promptId,
                          reason: "codex_primary_submit_observed_without_acceptance",
                          terminalIndex,
                          threadId: currentThreadId,
                          workspaceId: workspace?.id || thread?.workspaceId || "",
                        });
                        continue;
                      }
                    }
                  }
                }
                break;
              } catch (submitError) {
                activeSubmitWaiter?.cancel?.();
                activeSubmitWaiter = null;
                lastSubmitError = submitError;
                const hasFallback = attemptIndex < submitSequences.length - 1;
                const latestDraft = String(threadComposerDraftsRef.current.get(pendingSyncKey) || "").trim();
                const submitObservedTimedOut = isTerminalPromptObservedTimeout(submitError);
                if (!submitObservedTimedOut) {
                  throw submitError;
                }
                if (appControlTerminalSurface) {
                  observedSubmit = true;
                  logTerminalStatus("frontend.pending_prompt.submit_observation_missed_assumed_submitted", {
                    ...pendingPromptLogFields,
                    attempt: attemptIndex + 1,
                    instanceId: currentInstanceId,
                    reason: "app_control_terminal_write_completed",
                    threadId: currentThreadId,
                  });
                  logThreadBridgeDiagnostic("frontend.pending_prompt.submit_observation_missed_assumed_submitted", {
                    agentId: terminalAgentKind,
                    attempt: attemptIndex + 1,
                    deliveryMode: effectiveDeliveryMode,
                    instanceId: currentInstanceId,
                    paneId,
                    promptId,
                    reason: "app_control_terminal_write_completed",
                    sendPolicy: "terminal-orchestrator-write-confirmed",
                    terminalIndex,
                    threadId: currentThreadId,
                    workspaceId: workspace?.id || thread?.workspaceId || "",
                  });
                  break;
                }
                if (!hasFallback) {
                  const acceptedAfterObserverTimeout = await acceptedPromise;
                  if (acceptedAfterObserverTimeout.kind === "accepted") {
                    acceptedDetailFromRace = acceptedAfterObserverTimeout.detail;
                    break;
                  }
                  throw submitError;
                }
                const acceptedBeforeFallback = await Promise.race([
                  acceptedPromise,
                  waitForPendingPromptSubmitSettle(PENDING_PROMPT_SUBMIT_FALLBACK_ACCEPT_GRACE_MS)
                    .then(() => ({ kind: "pending" })),
                ]);
                if (acceptedBeforeFallback.kind === "accepted") {
                  acceptedDetailFromRace = acceptedBeforeFallback.detail;
                  break;
                }
                if (latestDraft !== promptText) {
                  throw submitError;
                }
                observedSubmitRetried = true;
                logTerminalStatus("frontend.pending_prompt.submit_observation_retry", {
                  ...pendingPromptLogFields,
                  attempt: attemptIndex + 1,
                  instanceId: currentInstanceId,
                  reason: "submit_observation_timeout",
                  threadId: currentThreadId,
                });
                logThreadBridgeDiagnostic("frontend.pending_prompt.submit_observation_retry", {
                  agentId: terminalAgentKind,
                  attempt: attemptIndex + 1,
                  deliveryMode: effectiveDeliveryMode,
                  instanceId: currentInstanceId,
                  paneId,
                  promptId,
                  reason: "submit_observation_timeout",
                  terminalIndex,
                  threadId: currentThreadId,
                  workspaceId: workspace?.id || thread?.workspaceId || "",
                });
              }
            }
            if (!observedSubmit && !acceptedDetailFromRace) {
              throw lastSubmitError || new Error("Timed out waiting for the prompt to be observed in the terminal.");
            }
            if (acceptedDetailFromRace) {
              logTerminalStatus("frontend.pending_prompt.submit_accepted_without_observer", {
                ...pendingPromptLogFields,
                instanceId: currentInstanceId,
                matchedBy: acceptedDetailFromRace?.matchedBy || "",
                threadId: currentThreadId,
              });
              logThreadBridgeDiagnostic("frontend.pending_prompt.submit_accepted_without_observer", {
                agentId: terminalAgentKind,
                deliveryMode: effectiveDeliveryMode,
                instanceId: currentInstanceId,
                matchedBy: acceptedDetailFromRace?.matchedBy || "",
                paneId,
                promptId,
                promptText: pendingPromptTextDiagnostic,
                sendPolicy: "terminal-accepted-before-submit-observed",
                terminalIndex,
                threadId: currentThreadId,
                workspaceId: workspace?.id || thread?.workspaceId || "",
              });
              return acceptedDetailFromRace;
            }
            logTerminalStatus("frontend.pending_prompt.submit_observed", {
              ...pendingPromptLogFields,
              instanceId: currentInstanceId,
              retried: observedSubmitRetried,
              threadId: currentThreadId,
            });
            if (appControlTerminalSurface) {
              logThreadBridgeDiagnostic("frontend.pending_prompt.app_control_delivery_confirmed", {
                agentId: terminalAgentKind,
                deliveryMode: effectiveDeliveryMode,
                instanceId: currentInstanceId,
                paneId,
                promptId,
                sendPolicy: "terminal-orchestrator-write-confirmed",
                terminalIndex,
                threadId: currentThreadId,
                workspaceId: workspace?.id || thread?.workspaceId || "",
              });
              return {
                matchedBy: "app-control-terminal-write-confirmed",
                promptEventId: promptId,
                sessionId: threadProviderSessionId || "",
              };
            }
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
              allowEnterRetry: !observedSubmitRetried,
              logPrefix: "frontend.pending_prompt",
              promptId,
              submitSequence: getTerminalAgentKind(terminalAgentKind) === "codex"
                ? submitSequences[submitSequences.length - 1] || getTerminalSubmitSequence(terminalAgentKind, isGenericTerminal)
                : submitSequences[0] || getTerminalSubmitSequence(terminalAgentKind, isGenericTerminal),
              threadId: currentThreadId,
              workspaceId: workspace?.id || thread?.workspaceId || "",
            });
          } catch (error) {
            activeSubmitWaiter?.cancel?.();
            acceptedWaiter.cancel();
            throw error;
          }
        })
        .then(async (acceptedDetail) => {
          const pendingWorkspaceId = workspace?.id || thread?.workspaceId || "";
          const pendingSyncKey = pendingPromptSyncKey || getThreadComposerSyncKey(
            {
              id: currentThreadId,
              workspaceId: pendingWorkspaceId,
            },
            {
              instanceId: currentInstanceId,
              paneId,
            },
          );
          const pendingPromptClearResult = clearWorkspaceThreadComposerDraftIfRevision(
            pendingSyncKey,
            pendingPromptDraftTransaction?.revision || 0,
            {
              expectedValue: promptText,
              source: "pending_prompt_confirmed_clear",
              transactionId: promptId,
            },
          );
          if (pendingPromptClearResult.cleared) {
            const clearInputData = buildTerminalComposerDraftInput(promptText, "", true);
            if (clearInputData) {
              try {
                await invoke("terminal_write", {
                  data: clearInputData,
                  instanceId: currentInstanceId,
                  paneId,
                  threadId: currentThreadId,
                });
                logThreadBridgeDiagnostic("frontend.pending_prompt.confirmed_terminal_draft_clear_done", {
                  agentId: terminalAgentKind,
                  deliveryMode: effectiveDeliveryMode,
                  draftRevision: pendingPromptDraftTransaction?.revision || 0,
                  instanceId: currentInstanceId,
                  paneId,
                  promptId,
                  terminalIndex,
                  textLength: promptText.length,
                  threadId: currentThreadId,
                  workspaceId: pendingWorkspaceId,
                });
                logTerminalStatus("frontend.pending_prompt.confirmed_terminal_draft_clear_done", {
                  ...pendingPromptLogFields,
                  draftRevision: pendingPromptDraftTransaction?.revision || 0,
                  instanceId: currentInstanceId,
                  threadId: currentThreadId,
                });
              } catch (clearError) {
                logThreadBridgeDiagnostic("frontend.pending_prompt.confirmed_terminal_draft_clear_error", {
                  agentId: terminalAgentKind,
                  deliveryMode: effectiveDeliveryMode,
                  draftRevision: pendingPromptDraftTransaction?.revision || 0,
                  error: getErrorMessage(clearError, "Unable to clear submitted terminal draft."),
                  instanceId: currentInstanceId,
                  paneId,
                  promptId,
                  terminalIndex,
                  textLength: promptText.length,
                  threadId: currentThreadId,
                  workspaceId: pendingWorkspaceId,
                });
                logTerminalStatus("frontend.pending_prompt.confirmed_terminal_draft_clear_error", {
                  ...pendingPromptLogFields,
                  draftRevision: pendingPromptDraftTransaction?.revision || 0,
                  error: getErrorMessage(clearError, "Unable to clear submitted terminal draft."),
                  instanceId: currentInstanceId,
                  threadId: currentThreadId,
                });
              }
            }
          } else {
            logThreadBridgeDiagnostic("frontend.pending_prompt.confirmed_draft_clear_skip", {
              agentId: terminalAgentKind,
              currentDraftLength: String(pendingPromptClearResult.value || "").length,
              currentDraftRevision: pendingPromptClearResult.revision || 0,
              deliveryMode: effectiveDeliveryMode,
              expectedDraftRevision: pendingPromptDraftTransaction?.revision || 0,
              instanceId: currentInstanceId,
              paneId,
              promptId,
              reason: pendingPromptClearResult.reason || "draft_changed",
              terminalIndex,
              textLength: promptText.length,
              threadId: currentThreadId,
              workspaceId: pendingWorkspaceId,
            });
            logTerminalStatus("frontend.pending_prompt.confirmed_draft_clear_skip", {
              ...pendingPromptLogFields,
              currentDraftLength: String(pendingPromptClearResult.value || "").length,
              currentDraftRevision: pendingPromptClearResult.revision || 0,
              expectedDraftRevision: pendingPromptDraftTransaction?.revision || 0,
              instanceId: currentInstanceId,
              reason: pendingPromptClearResult.reason || "draft_changed",
              threadId: currentThreadId,
            });
          }
          if (useTerminalConfirmedDelivery && terminalUsesActivityHooks && terminalAgentKind !== "codex") {
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
    appControlTerminalSurface,
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
    const shouldUseBackendHookSubmit = Boolean(
      terminalUsesActivityHooks
        && !isGenericTerminal
        && submitSequence
        && paneId
        && terminalInstanceIdRef.current
    );
    const draftTransaction = syncKey && !shouldUseBackendHookSubmit
      ? setThreadComposerDraftValue(syncKey, prompt, "native_drop_submit_sync")
      : null;
    const syncData = shouldUseBackendHookSubmit
      ? ""
      : buildTerminalComposerDraftInput(previousDraft, prompt, true);
    let submittedWaiter = null;

    try {
      submittedWaiter = submitSequence && !shouldUseBackendHookSubmit
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
      if (shouldUseBackendHookSubmit) {
        await invoke("todo_dispatch_backend_submit_now", {
          item: {
            id: promptEventId,
            promptEventId,
            status: "queued",
            targetAgentId: terminalAgentKind,
            targetTerminalId: paneId,
            targetTerminalIndex: terminalIndex,
            targetThreadId: terminalThreadIdRef.current || "",
            text: prompt,
            todoStatus: "queued",
            workspaceId: workspace?.id || "",
          },
          promptEventId,
          target: {
            agentId: terminalAgentKind,
            agentKind: terminalAgentKind,
            instanceId: terminalInstanceIdRef.current || undefined,
            paneId,
            terminalIndex,
            threadId: terminalThreadIdRef.current || "",
            workspaceId: workspace?.id || "",
            workspaceName: workspace?.name || "",
          },
          workspaceId: workspace?.id || "",
        });
      } else {
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
      }
      if (submittedWaiter) {
        await submittedWaiter.promise;
      }
      if (submittedWaiter || shouldUseBackendHookSubmit) {
        recordSubmittedAgentMessage(terminalInstanceIdRef.current || 0, prompt, {
          messageCreatedAt: promptEventSubmittedAt,
          messageId: promptEventId,
          messageSource: "native-drop",
          promptEventId,
          source: "native-drop",
          turnId: `turn-${promptEventId}`,
        });
        if (syncKey && !shouldUseBackendHookSubmit) {
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
    terminalUsesActivityHooks,
    workspace?.id,
    workspace?.name,
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
  // The bright "Drop here" target highlight is strictly coordinate-driven: it
  // shows only when the central resolver names this terminal the drop target.
  // The flaky HTML5 dragenter flag (terminalDropActive) can stick or fire over
  // empty space, so it only drives the faint overlay box, never the target.
  const todoDropOverlayTarget = pointerTodoDropVisible;
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
        agentId: nextRoleId,
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

  const terminalSplitModeId = String(terminalSplitMode || "both").trim().toLowerCase();
  const normalizedTerminalSplitLimit = Math.max(
    1,
    Math.min(
      MAX_WORKSPACE_TERMINAL_COUNT,
      Number.parseInt(terminalSplitLimit, 10) || MAX_WORKSPACE_TERMINAL_COUNT,
    ),
  );
  const terminalHorizontalSplitAllowed = terminalSplitModeId !== "vertical-only";
  const terminalVerticalSplitAllowed = terminalSplitModeId !== "horizontal-only";
  const canSplitTerminal = !threadsViewActive
    && typeof onSplitTerminal === "function"
    && terminalCount < normalizedTerminalSplitLimit
    && (terminalHorizontalSplitAllowed || terminalVerticalSplitAllowed);
  const canSplitTerminalHorizontally = canSplitTerminal && terminalHorizontalSplitAllowed;
  const canSplitTerminalVertically = canSplitTerminal && terminalVerticalSplitAllowed;
  const forkSourceProviderSessionId = String(threadProviderSessionId || "").trim();
  const canRequestForkTerminal = !threadsViewActive
    && !isGenericTerminal
    && !terminalClosed
    && !terminalClosing
    && typeof onForkTerminal === "function"
    && terminalCount < normalizedTerminalSplitLimit;
  const canForkTerminal = canRequestForkTerminal && terminalState === "running";
  const forkTerminalTitle = isGenericTerminal
    ? "Shell terminals do not have provider sessions to fork"
    : threadsViewActive
      ? "Exit threads view to fork"
      : terminalCount >= normalizedTerminalSplitLimit
        ? "Terminal limit reached"
        : terminalState === "running"
          ? "Fork this session"
          : "Terminal must be running to fork";
  const canOpenTerminalUiView = !threadsViewActive
    && !terminalClosed
    && !terminalClosing
    && (Boolean(thread) || isGenericTerminal);
  const fullscreenThreadUiViewActive = Boolean(isFullscreen && terminalUiViewActive && !threadsViewActive);
  const selectCurrentTerminalThreadForFullscreenView = useCallback(() => {
    if (!isFullscreen || !workspace?.id || !terminalThreadId) {
      return;
    }

    onWorkspaceThreadsViewStateChange?.(workspace.id, {
      newChatActive: false,
      selectedThreadId: terminalThreadId,
      selectedWorkspaceId: workspace.id,
    });
  }, [
    isFullscreen,
    onWorkspaceThreadsViewStateChange,
    terminalThreadId,
    workspace?.id,
  ]);
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
    if (nextUiViewActive) {
      selectCurrentTerminalThreadForFullscreenView();
      if (isGenericTerminal) {
        focusShellLauncherInput();
      }
    }
    terminalUiViewActiveRef.current = nextUiViewActive;
    setTerminalUiViewActive(nextUiViewActive);
    if (!nextUiViewActive) {
      focusTerminalKeyboardInputAfterUiHide();
    }
  }, [
    activateTerminalPane,
    canOpenTerminalUiView,
    focusShellLauncherInput,
    focusTerminalKeyboardInputAfterUiHide,
    isGenericTerminal,
    selectCurrentTerminalThreadForFullscreenView,
    terminalUiViewActive,
  ]);
  const closeTerminalUiView = useCallback(() => {
    if (!terminalUiViewActiveRef.current) {
      return;
    }

    activateTerminalPane("terminal_ui_view_close", { focusKeyboard: false });
    terminalUiViewActiveRef.current = false;
    setTerminalUiViewActive(false);
    focusTerminalKeyboardInputAfterUiHide();
  }, [
    activateTerminalPane,
    focusTerminalKeyboardInputAfterUiHide,
  ]);
  useEffect(() => {
    if ((!thread && !isGenericTerminal) || terminalClosed || terminalClosing) {
      terminalUiViewActiveRef.current = false;
      setTerminalUiViewActive(false);
    }
  }, [isGenericTerminal, terminalClosed, terminalClosing, thread]);
  useEffect(() => {
    if (!fullscreenThreadUiViewActive || !workspace?.id || !terminalThreadId) {
      return;
    }

    onWorkspaceThreadsViewStateChange?.(workspace.id, {
      newChatActive: false,
      selectedThreadId: terminalThreadId,
      selectedWorkspaceId: workspace.id,
    });
  }, [
    fullscreenThreadUiViewActive,
    onWorkspaceThreadsViewStateChange,
    terminalThreadId,
    workspace?.id,
  ]);
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
	  const minimizeTerminal = useCallback(() => {
	    if (terminalClosed || terminalClosing) {
	      return;
	    }
	    onMinimizeTerminal?.(terminalIndex);
	  }, [
	    onMinimizeTerminal,
	    terminalClosed,
	    terminalClosing,
	    terminalIndex,
	  ]);
	  const forkTerminalHere = useCallback((providerSessionIdOverride = "") => {
    const sourceProviderSessionId = String(
      providerSessionIdOverride || forkSourceProviderSessionId || "",
    ).trim();
    if (!canRequestForkTerminal || !sourceProviderSessionId) {
      return;
    }

    const currentThreadId = terminalThreadIdRef.current || thread?.id || "";
    const result = onForkTerminal?.({
      agentId: terminalAgentKind,
      forkFromProviderSessionId: sourceProviderSessionId,
      model: threadProviderModel,
      paneId,
      providerSessionId: sourceProviderSessionId,
      role: terminalAgentKind,
      sessionTitle: thread?.sessionName || thread?.title || "Original session",
      source: "terminal_fork_original",
      sourceWindowBreakoutHosted: windowBreakoutHosted,
      terminalIndex,
      threadId: currentThreadId,
      workspaceId: workspace?.id || "",
    });

    if (!result) {
      return;
    }

    setRestartRoleMenuOpen(false);
    setTerminalClosed(false);
    setTerminalClosing(false);
    terminalClosingRef.current = false;
    preserveCoordinationOnNextCleanupRef.current = false;
    preserveCoordinationOnNextOpenRef.current = false;
    forceFreshSessionOnNextOpenRef.current = false;
    providerSessionOverrideOnNextOpenRef.current = "";
    forkFromProviderSessionOnNextOpenRef.current = sourceProviderSessionId;
    resetTerminalReadinessForEpoch({
      activityStatus: "idle",
      agentId: terminalAgentKind,
      instanceId: 0,
      reason: "terminal_fork_here",
      threadId: currentThreadId,
    });
    onThreadTerminalLifecycle?.({
      activityStatus: "idle",
      agentId: terminalAgentKind,
      commandPhase: "starting",
      forkFromProviderSessionId: sourceProviderSessionId,
      inputReady: false,
      instanceId: terminalInstanceIdRef.current || undefined,
      nativeSessionId: "",
      nativeSessionIdCleared: true,
      nativeSessionKind: "",
      nativeSessionSource: "",
      paneId,
      providerSessionId: "",
      providerSessionIdCleared: true,
      status: "starting",
      statusTruth: "running",
      terminalIndex,
      terminalWorkState: "running",
      threadId: currentThreadId,
      type: "opened",
      workspaceId: workspace?.id || "",
    });
    logThreadBridgeDiagnostic("frontend.terminal_fork_here", {
      agentId: terminalAgentKind,
      paneId,
      providerSessionPresent: true,
      sourceWindowBreakoutHosted: windowBreakoutHosted,
      terminalIndex,
      threadId: currentThreadId,
      workspaceId: workspace?.id || "",
    });
    setTerminalState("starting");
    setTerminalError("");
    setTerminalLaunchInfo(null);
    setParkedPrompt(null);
    parkedPromptRef.current = null;
    setTerminalStatus({
      detail: "Starting a fork from the current provider session.",
      title: "Forking Session",
      visible: true,
    });
    setRestartKey((key) => key + 1);
  }, [
    canRequestForkTerminal,
    forkSourceProviderSessionId,
    onForkTerminal,
    onThreadTerminalLifecycle,
    paneId,
    terminalAgentKind,
    terminalIndex,
    thread?.id,
    thread?.sessionName,
    thread?.title,
    threadProviderModel,
    windowBreakoutHosted,
    workspace?.id,
  ]);
  const requestForkTerminal = useCallback(() => {
    if (!canForkTerminal) {
      return;
    }

    const currentInstanceId = terminalInstanceIdRef.current || 0;
    invoke("terminal_request_fork", {
      paneId,
      instanceId: currentInstanceId || undefined,
    })
      .then(() => {
        logBigViewSyncDiagnosticEvent("tui.text.fork_button_backend_requested", {
          agentId: terminalAgentKind,
          instanceId: currentInstanceId,
          paneId,
          terminalIndex,
          threadId: terminalThreadIdRef.current || "",
          workspaceId: workspace?.id || "",
        });
      })
      .catch((error) => {
        setTerminalError(getErrorMessage(error, "Unable to fork this session right now."));
        logBigViewSyncDiagnosticEvent("tui.text.fork_button_backend_error", {
          agentId: terminalAgentKind,
          instanceId: currentInstanceId,
          message: error?.message || String(error || ""),
          paneId,
          terminalIndex,
          threadId: terminalThreadIdRef.current || "",
          workspaceId: workspace?.id || "",
        });
      });
  }, [
    canForkTerminal,
    paneId,
    terminalAgentKind,
    terminalIndex,
    workspace?.id,
  ]);
  useEffect(() => {
    canRequestForkTerminalRef.current = canRequestForkTerminal;
    forkTerminalActionRef.current = forkTerminalHere;
  }, [
    canRequestForkTerminal,
    forkTerminalHere,
  ]);
  useEffect(() => {
    if (!paneId) {
      return undefined;
    }

    let disposed = false;
    let unlisten = () => {};
    listen(TERMINAL_FORK_REQUESTED_EVENT, (event) => {
      if (disposed) {
        return;
      }

      const payload = event.payload || {};
      if (String(payload.paneId || "") !== paneId) {
        return;
      }

      const eventInstanceId = Number(payload.instanceId || 0);
      const currentInstanceId = Number(terminalInstanceIdRef.current || 0);
      if (eventInstanceId && currentInstanceId && eventInstanceId !== currentInstanceId) {
        return;
      }

      const providerSessionId = String(payload.providerSessionId || "").trim();
      if (
        !canRequestForkTerminalRef.current
        || !providerSessionId
        || typeof forkTerminalActionRef.current !== "function"
      ) {
        setTerminalError("Unable to fork this session right now.");
        logBigViewSyncDiagnosticEvent("tui.text.fork_command_backend_unavailable", {
          agentId: terminalAgentKind,
          instanceId: currentInstanceId,
          paneId,
          providerSessionPresent: Boolean(providerSessionId),
          terminalIndex,
          threadId: terminalThreadIdRef.current || "",
          workspaceId: workspace?.id || "",
        });
        return;
      }

      logBigViewSyncDiagnosticEvent("tui.text.fork_command_backend_event", {
        agentId: terminalAgentKind,
        instanceId: currentInstanceId,
        paneId,
        providerSessionPresent: Boolean(payload.providerSessionId),
        terminalIndex,
        threadId: terminalThreadIdRef.current || "",
        workspaceId: workspace?.id || "",
      });
      forkTerminalActionRef.current(providerSessionId);
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
    paneId,
    terminalAgentKind,
    terminalIndex,
    workspace?.id,
  ]);
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
    activityStatus: terminalRuntimeActivityStatus || "idle",
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
      canFork: canForkTerminal,
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
        case TERMINAL_WINDOW_CONTROL_FONT_SIZE:
          setTerminalFontSizeFromWindow(event.payload?.fontSize);
          break;
        case TERMINAL_WINDOW_CONTROL_FORK:
          requestForkTerminal();
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
    requestForkTerminal,
    restartTerminalAs,
    setTerminalFontSizeFromWindow,
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
      data-active={deferredXtermActive ? "true" : "false"}
      data-pty-reveal-ready={terminalPtyRevealReady ? "true" : "false"}
      data-terminal-breakout={terminalBreakoutActive ? "true" : undefined}
      data-scrollbar-platform={TERMINAL_SCROLLBAR_PLATFORM}
      data-parked={parkedPrompt ? "true" : "false"}
      aria-hidden={terminalPtyRevealReady ? undefined : "true"}
      onDragEnterCapture={handleTerminalRawDragEnterCapture}
      onDragEnter={handleTerminalTodoDragEnter}
      onDragLeave={handleTerminalTodoDragLeave}
      onDragOverCapture={handleTerminalRawDragOverCapture}
      onDragOver={handleTerminalTodoDragOver}
      onDropCapture={handleTerminalRawDropCapture}
      onDrop={handleTerminalTodoDrop}
      onKeyDownCapture={handleShellLauncherXtermKeyDownCapture}
      onPaste={(event) => queueClipboardImagesForCurrentTerminal(event, "xterm_surface")}
      onPasteCapture={handleShellLauncherXtermPasteCapture}
      ref={containerRef}
    />
  );
  const threadOverlayOpen = Boolean(
    (threadsViewActive || fullscreenThreadUiViewActive)
      && !terminalClosed
      && !terminalClosing,
  );
  const shellLauncherUiViewShouldRender = Boolean(isGenericTerminal)
    && !terminalClosed
    && !terminalClosing
    && terminalUiViewActive
    && !fullscreenThreadUiViewActive;
  const terminalUiViewShouldRender = Boolean(thread)
    && !isGenericTerminal
    && !terminalClosed
    && !terminalClosing
    && terminalUiViewActive
    && !fullscreenThreadUiViewActive;
  const restartMenuAgentKind = terminalAgentKind;
  const restartRoleOptions = getTerminalRoleSwitchOptions(agentStatuses);
  const shellLauncherRailAgentKind = isGenericTerminal
    && shellLauncherSelectedAgentId !== SHELL_LAUNCHER_MODE_TERMINAL
      ? shellLauncherSelectedAgentId
      : terminalAgentKind;
  const shellLauncherRailAgentTitle = isGenericTerminal
    ? `Shell terminal mode: ${shellLauncherSelectedOption.label}`
    : terminalRailAgentTitle;
  const shellTerminalRailStateLabel = terminalClosed
    ? "closed"
    : terminalClosing
      ? "closing"
      : terminalState === "starting"
        ? "starting"
        : terminalState === "error"
          ? "error"
          : "terminal";
  const shellLauncherRailStateLabel = isGenericTerminal
    ? shellLauncherSelectedAgentId !== SHELL_LAUNCHER_MODE_TERMINAL
        ? shellLauncherSending
          ? "launching"
          : shellLauncherHasLaunched
            ? "running"
            : shellLauncherSelectedReady
              ? "ready"
              : shellLauncherSelectedStatus
        : shellTerminalRailStateLabel
    : terminalStateDebugLabel;
  const shellLauncherRailDotStyle = isGenericTerminal
    && shellLauncherSelectedAgentId !== SHELL_LAUNCHER_MODE_TERMINAL
      ? {
        "--terminal-slot-accent": shellLauncherHasLaunched ? "#3ccb7f" : "#f2c24e",
      }
      : undefined;
  const showDockedTerminalDragHandle = terminalChromeDocked && showDockedDragHandle && canDragTerminalPane;
  const terminalDragHandleVisible = !terminalChromeDocked || showDockedTerminalDragHandle;

  return (
    <TerminalWorkspaceSurface
      data-focused={isActive ? "true" : "false"}
      data-pane-id={paneId}
      data-terminal-fullscreen={isFullscreen ? "true" : undefined}
      data-terminal-fullscreen-state={isFullscreen ? fullscreenState : undefined}
      data-terminal-breakout={terminalBreakoutActive ? "true" : undefined}
      data-terminal-index={terminalIndex}
      data-threads-view={threadOverlayOpen ? "true" : undefined}
      data-ui-view={terminalUiViewActive ? "true" : undefined}
      onFocusCapture={handleTerminalSurfaceFocusCapture}
      onPointerDownCapture={handleTerminalSurfacePointerDownCapture}
      ref={surfaceRef}
    >
      <TerminalRestartPill data-terminal-control="true" data-terminal-rail-pill="true">
        <TerminalRailIdentity data-docked={terminalChromeDocked ? "true" : undefined}>
          {terminalDragHandleVisible && (
            <TerminalRestartButton
              aria-label="Drag terminal"
              data-terminal-drag-handle="true"
              disabled={terminalClosed || terminalClosing || isFullscreen || !canDragTerminalPane}
              onPointerDown={beginTerminalDrag}
              title={isFullscreen ? "Exit fullscreen to reorder terminals" : "Drag terminal"}
              type="button"
            >
              <ButtonDragIcon aria-hidden="true" />
            </TerminalRestartButton>
          )}
          {!terminalChromeDocked && (
            <>
              <TerminalAgentDot
                aria-hidden="true"
                data-agent={shellLauncherRailAgentKind}
                data-slot={getTerminalAgentColorSlot(terminalIndex)}
                style={shellLauncherRailDotStyle}
                title={shellLauncherRailAgentTitle}
              />
              <TerminalAgentLabel title={terminalRailAgentTitle}>
                {terminalRailAgentLabel}
              </TerminalAgentLabel>
            </>
          )}
          {!terminalChromeDocked && (
            <>
              <TerminalStateDebugBadge title={`Terminal state: ${shellLauncherRailStateLabel}`}>
                {shellLauncherRailStateLabel}
              </TerminalStateDebugBadge>
              <TerminalAccountStaleChip agentKind={terminalAgentKind} paneId={paneId} />
            </>
          )}
        </TerminalRailIdentity>
        <TerminalRailControls data-rail-row="primary">
          {!terminalChromeDocked && (
            <TerminalCloseButton
              aria-label={threadsViewActive ? "Exit threads view" : "Close terminal"}
              disabled={terminalClosed || terminalClosing}
              onClick={handleTerminalCloseButtonClick}
              title={threadsViewActive ? "Exit threads view" : "Close terminal"}
              type="button"
            >
              <ButtonCloseIcon aria-hidden="true" />
            </TerminalCloseButton>
          )}
        </TerminalRailControls>
        <TerminalRailControls data-rail-row="secondary">
          <TerminalRestartButton
            aria-label={terminalUiViewActive ? "Show terminal view" : isGenericTerminal ? "Show terminal launcher" : "Show UI view"}
            aria-pressed={terminalUiViewActive ? "true" : "false"}
            data-active={terminalUiViewActive ? "true" : undefined}
            disabled={!canOpenTerminalUiView && !terminalUiViewActive}
            onClick={toggleTerminalUiView}
            title={
              terminalUiViewActive
                ? "Show terminal view"
                : canOpenTerminalUiView
                  ? isGenericTerminal
                    ? "Show terminal launcher"
                    : "Show UI view"
                  : threadsViewActive
                    ? "Exit threads view first"
                    : "No thread available"
            }
            type="button"
          >
            <ButtonBrowserIcon aria-hidden="true" />
          </TerminalRestartButton>
          {isGenericTerminal && !terminalChromeDocked && !windowBreakoutHosted && (
            <SshClientPicker
              disabled={terminalClosed || terminalClosing || threadsViewActive || !paneId}
              paneId={paneId}
            />
          )}
          {!terminalChromeDocked && (
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
          )}
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
            aria-label="Fork terminal session"
            disabled={!canForkTerminal}
            onClick={requestForkTerminal}
            title={forkTerminalTitle}
            type="button"
          >
            <ButtonForgeIcon aria-hidden="true" />
          </TerminalRestartButton>
          {(!terminalChromeDocked || terminalSplitModeId !== "both") && (
            <>
              {terminalHorizontalSplitAllowed && (
                <TerminalRestartButton
                  aria-label="Split terminal horizontally"
                  disabled={threadsViewActive || terminalClosed || terminalClosing || !canSplitTerminalHorizontally}
                  onClick={splitTerminalHorizontal}
                  title={threadsViewActive ? "Exit threads view to split" : canSplitTerminalHorizontally ? "Split terminal horizontally" : "Terminal limit reached"}
                  type="button"
                >
                  <ButtonSplitHorizontalIcon aria-hidden="true" />
                </TerminalRestartButton>
              )}
              {terminalVerticalSplitAllowed && (
                <TerminalRestartButton
                  aria-label="Split terminal vertically"
                  disabled={threadsViewActive || terminalClosed || terminalClosing || !canSplitTerminalVertically}
                  onClick={splitTerminalVertical}
                  title={threadsViewActive ? "Exit threads view to split" : canSplitTerminalVertically ? "Split terminal vertically" : "Terminal limit reached"}
                  type="button"
                >
                  <ButtonSplitVerticalIcon aria-hidden="true" />
                </TerminalRestartButton>
              )}
            </>
          )}
          {!terminalChromeDocked && (
            <>
              <TerminalRestartButton
                aria-label="Minimize terminal"
                disabled={terminalClosed || terminalClosing || windowBreakoutHosted}
                onClick={minimizeTerminal}
                title={windowBreakoutHosted ? "Return to grid before minimizing" : "Minimize"}
                type="button"
              >
                <TitleMinimizeIcon aria-hidden="true" />
              </TerminalRestartButton>
	              <TerminalRestartButton
	                aria-label={isFullscreen ? "Restore terminal" : "Maximize terminal"}
	                disabled={terminalClosed || terminalClosing}
	                onClick={toggleTerminalFullscreen}
                title={isFullscreen ? "Restore terminal" : "Maximize terminal"}
                type="button"
              >
                {isFullscreen ? (
                  <ButtonFullscreenExitIcon aria-hidden="true" />
                ) : (
                  <ButtonFullscreenIcon aria-hidden="true" />
                )}
              </TerminalRestartButton>
            </>
          )}
          <TerminalRestartMenu
            data-terminal-control="true"
            ref={restartMenuRef}
          >
            <TerminalRestartButton
              aria-expanded={restartRoleMenuOpen ? "true" : "false"}
              aria-haspopup="menu"
              aria-label={threadsViewActive ? "Start new session" : "Restart terminal"}
              disabled={terminalClosed || terminalClosing}
              onClick={toggleRestartRoleMenu}
              title={threadsViewActive ? "Start a new session in this terminal" : "Restart terminal or choose runtime"}
              type="button"
            >
              <ButtonRefreshIcon aria-hidden="true" />
            </TerminalRestartButton>
              <TerminalRestartDropdown data-align={restartMenuAlign} data-open={restartRoleMenuOpen ? "true" : "false"} role="menu">
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
            {shellLauncherUiViewShouldRender && (
              <TerminalInlineUiView
                aria-hidden={terminalUiViewActive ? undefined : "true"}
                data-active={terminalUiViewActive ? "true" : "false"}
                data-terminal-control="true"
                onFocusCapture={handleTerminalUiViewFocusCapture}
                onPointerDownCapture={handleTerminalUiViewPointerDownCapture}
              >
                <div
                  style={{
                    display: "grid",
                    width: "100%",
                    height: "100%",
                    minWidth: 0,
                    minHeight: 0,
                    placeItems: "center",
                    padding: "clamp(18px, 5vw, 56px)",
                  }}
                >
                  <div
                    style={{
                      display: "grid",
                      width: "min(620px, 100%)",
                      minWidth: 0,
                      justifyItems: "center",
                      gap: 14,
                    }}
                  >
                    <div
                      aria-label="Terminal mode"
                      data-terminal-control="true"
                      role="group"
                      style={{
                        display: "flex",
                        width: "min(100%, 520px)",
                        minWidth: 0,
                        flexWrap: "wrap",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: 6,
                        padding: 4,
                        border: "1px solid rgba(148, 163, 184, 0.2)",
                        borderRadius: 999,
                        background: "rgba(15, 23, 42, 0.36)",
                      }}
                    >
                      {SHELL_LAUNCHER_AGENT_OPTIONS.map((option) => {
                        const optionSelected = option.id === shellLauncherSelectedAgentId;
                        const optionReady = shellLauncherAgentReady(agentStatuses, option.id);
                        return (
                          <button
                            aria-pressed={optionSelected ? "true" : "false"}
                            data-terminal-control="true"
                            disabled={!optionReady || shellLauncherSending}
                            key={option.id}
                            onClick={() => chooseShellLauncherAgent(option.id)}
                            style={{
                              minWidth: 92,
                              height: 32,
                              flex: "1 1 112px",
                              padding: "0 12px",
                              overflow: "hidden",
                              border: "1px solid",
                              borderColor: optionSelected
                                ? option.id === SHELL_LAUNCHER_MODE_TERMINAL
                                  ? "rgba(203, 213, 225, 0.34)"
                                  : "rgba(242, 194, 78, 0.46)"
                                : "transparent",
                              borderRadius: 999,
                              color: optionSelected ? "#ffffff" : "rgba(226, 232, 240, 0.74)",
                              background: optionSelected
                                ? option.id === SHELL_LAUNCHER_MODE_TERMINAL
                                  ? "rgba(148, 163, 184, 0.18)"
                                  : "rgba(242, 194, 78, 0.14)"
                                : "transparent",
                              cursor: optionReady && !shellLauncherSending ? "pointer" : "not-allowed",
                              fontSize: 12,
                              fontWeight: 850,
                              lineHeight: 1,
                              opacity: optionReady ? 1 : 0.42,
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={optionReady ? option.label : `${option.label}: ${shellLauncherAgentStatusLabel(agentStatuses, option.id)}`}
                            type="button"
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                    {shellLauncherSelectedAgentId !== SHELL_LAUNCHER_MODE_TERMINAL && (
                      <div
                        data-terminal-control="true"
                        style={{
                          display: "grid",
                          width: "min(100%, 560px)",
                          minWidth: 0,
                          gap: 10,
                        }}
                      >
                        <div
                          style={{
                            display: "grid",
                            minWidth: 0,
                            gap: 10,
                            padding: 14,
                            border: "1px solid rgba(148, 163, 184, 0.24)",
                            borderRadius: 18,
                            background: "rgba(2, 6, 23, 0.62)",
                            boxShadow: "0 22px 58px rgba(0, 0, 0, 0.28)",
                          }}
                        >
                          <textarea
                            aria-label={`Ask ${shellLauncherSelectedOption.label}`}
                            data-terminal-control="true"
                            disabled={shellLauncherSending || !shellLauncherSelectedReady}
                            onChange={(event) => {
                              setShellLauncherError("");
                              setShellLauncherDraft(event.target.value);
                            }}
                            onKeyDown={handleShellLauncherKeyDown}
                            placeholder={`Ask ${shellLauncherSelectedOption.label}`}
                            ref={shellLauncherInputRef}
                            rows={4}
                            style={{
                              width: "100%",
                              minWidth: 0,
                              minHeight: 104,
                              maxHeight: "32vh",
                              padding: "12px 13px",
                              border: "1px solid rgba(148, 163, 184, 0.22)",
                              borderRadius: 14,
                              color: "#f8fafc",
                              background: "rgba(15, 23, 42, 0.74)",
                              boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.04)",
                              font: "inherit",
                              fontSize: 14,
                              fontWeight: 650,
                              lineHeight: 1.4,
                              outline: "none",
                              resize: "vertical",
                            }}
                            value={shellLauncherDraft}
                          />
                          <div
                            style={{
                              display: "flex",
                              minWidth: 0,
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                            }}
                          >
                            <span
                              aria-live="polite"
                              style={{
                                minWidth: 0,
                                overflow: "hidden",
                                color: shellLauncherError || !shellLauncherSelectedReady
                                  ? "#fca5a5"
                                  : "rgba(203, 213, 225, 0.68)",
                                fontSize: 11,
                                fontWeight: 800,
                                lineHeight: 1.25,
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {shellLauncherError
                                || (!shellLauncherSelectedReady ? shellLauncherSelectedStatus : "")}
                            </span>
                            <button
                              aria-label={`Send to ${shellLauncherSelectedOption.label}`}
                              data-terminal-control="true"
                              disabled={
                                shellLauncherSending
                                || !shellLauncherSelectedReady
                                || !shellLauncherDraft.trim()
                              }
                              onClick={() => {
                                void submitShellLauncherPrompt();
                              }}
                              style={{
                                display: "inline-flex",
                                minWidth: 92,
                                height: 36,
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 7,
                                flex: "0 0 auto",
                                padding: "0 14px",
                                border: "1px solid rgba(242, 194, 78, 0.36)",
                                borderRadius: 999,
                                color: "#111827",
                                background: shellLauncherSending
                                  ? "rgba(242, 194, 78, 0.58)"
                                  : "#f2c24e",
                                cursor: shellLauncherSending || !shellLauncherSelectedReady || !shellLauncherDraft.trim()
                                  ? "not-allowed"
                                  : "pointer",
                                fontSize: 12,
                                fontWeight: 900,
                                lineHeight: 1,
                                opacity: shellLauncherSending || !shellLauncherSelectedReady || !shellLauncherDraft.trim()
                                  ? 0.58
                                  : 1,
                              }}
                              type="button"
                            >
                              <ButtonCodeIcon aria-hidden="true" />
                              <span>{shellLauncherSending ? "Starting" : "Send"}</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </TerminalInlineUiView>
            )}
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
              onClose={fullscreenThreadUiViewActive ? closeTerminalUiView : toggleTerminalFullscreen}
              onCreateChat={createWorkspaceThreadChat}
              onArchiveThread={onArchiveWorkspaceThread}
              onDraftInput={syncWorkspaceThreadComposerInput}
              onSelectModel={changeWorkspaceThreadModel}
              onSelectThread={onSelectWorkspaceThread}
              onSubmitMessage={submitWorkspaceThreadMessage}
              onTogglePinnedThread={onToggleWorkspaceThreadPinned}
              onViewStateChange={onWorkspaceThreadsViewStateChange}
              open={threadOverlayOpen}
              preferSelectedThreadId={selectedWorkspaceThreadIdOverride}
              selectedThreadId={selectedWorkspaceThreadIdOverride ? selectedWorkspaceThreadId : selectedWorkspaceThreadId || terminalThreadId}
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

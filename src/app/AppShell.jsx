import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  PhysicalPosition,
} from "@tauri-apps/api/window";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import "@xterm/xterm/css/xterm.css";
import "@vscode/codicons/dist/codicon.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authStore, DEFAULT_AUTH_MESSAGE, isSafeAuthValue, useAuthSnapshot } from "../authStore";
import { collapseFunctionalRepoPathToCoreRepoPath } from "../terminals/coreRepoNameDisplay";
import {
  closeWorkspaceTerminalPane,
  getDefaultTerminalIndexes,
  getTerminalPanelRows,
  normalizeWorkspaceTerminalIndexes,
  WORKSPACE_THREAD_ARCHIVE_TERMINAL_RESET_EVENT,
} from "../terminals/WorkspaceTerminal.jsx";
import { logThreadBridgeDiagnosticEvent } from "../terminals/terminalDiagnostics";
import { logTerminalStatus } from "../terminals/terminalStatusLog";
import {
  getBigViewTextDiagnosticFields,
  logBigViewSyncDiagnosticEvent,
} from "../threads/bigViewSyncDiagnostics";
import {
  getLiveTerminalForThread,
  getThreadTerminalGroundTruth,
  recordThreadTerminalReadiness,
} from "../threads/threadTerminalGroundTruth.js";
import {
  isTerminalControlHistoryPrompt,
} from "../threads/terminalControlPrompts.js";
import { TERMINAL_IS_WINDOWS_HOST } from "../terminals/terminalScrollStabilityStrategies.jsx";
import TerminalView from "../terminals/TerminalView.jsx";
import { createWorkspaceNotificationSfx } from "../notifications/notificationSfx";
import {
  formatWorkspaceNotificationBadgeCount,
  getWorkspaceNotificationSummaries,
  markWorkspaceNotificationsSeen,
  normalizeWorkspaceNotificationPath,
  persistWorkspaceNotifications,
  readWorkspaceNotifications,
  reconcileWorkspaceNotificationSnapshot,
  reduceTerminalParkedNotificationEvent,
  reduceThreadLifecycleNotificationEvent,
  reduceWorkspaceNotificationEvent,
  resolveWorkspaceIdForNotificationEvent,
  TERMINAL_PARKED_PROMPT_EVENT,
  WORKSPACE_NOTIFICATION_EVENT,
} from "../notifications/workspaceNotifications";
import {
  archiveWorkspaceThread,
  appendWorkspaceThreadProjectionEvents,
  bindWorkspaceThreadTerminal,
  clearWorkspaceThreadsBrowserPersistence,
  clearWorkspaceThreadPendingPrompt,
  createWorkspaceThreadId,
  ensureWorkspaceThreadsForTerminalIndexes,
  getWorkspaceThreadForTerminalIndex,
  getWorkspaceThreadCanArchive,
  getWorkspaceThreadProviderBinding,
  getWorkspaceThreadsByTerminalIndex,
  hydrateWorkspaceThreadSessionTranscript,
  markWorkspaceThreadAgentActivity,
  markWorkspaceThreadTerminalDetached,
  materializeWorkspaceThreadForTerminal,
  normalizeWorkspaceThreads,
  persistWorkspaceThreads,
  readWorkspaceThreads,
  selectWorkspaceThread,
  toggleWorkspaceThreadPinned,
  updateWorkspaceActiveTerminal,
  updateWorkspaceThreadAgent,
  updateWorkspaceThreadProviderModel,
  updateWorkspaceThreadProviderSession,
  updateWorkspaceThreadsViewState,
  workspaceThreadIdIsArchived,
  workspaceThreadSessionIsArchived,
} from "../threads/workspaceThreads";
import {
  AUDIO_TRANSCRIPTION_PROVIDER_CLOUD,
  readAudioTranscriptionProvider,
  readAutoOpenAudioRecorder,
  readDeepgramApiKey,
} from "../audio/audioCapture";
import {
  AUTH_TILE_SIZE,
  GlobalStyle,
  AppFrame,
  WindowResizeEdges,
  WindowResizeHandle,
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
  RailHeader,
  RailTop,
  RailSectionTitle,
  RailCollapseButton,
  WorkspaceList,
  WorkspaceRow,
  WorkspaceButton,
  WorkspaceLabel,
  WorkspaceCompactGlyph,
  WorkspaceNotificationBadge,
  WorkspaceSettingsButton,
  WorkspaceAccent,
  WorkspaceMuted,
  RailFooter,
  RailGlobalActions,
  RailActionButton,
  WorkspaceViewStack,
  WorkspaceViewPane,
  WorkspaceRuntimeLayer,
  WorkspaceIdleSurface,
  WorkspaceIdlePanel,
  WorkspaceIdleLogo,
  WorkspaceIdleTitle,
  WorkspaceIdleDetail,
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
  TerminalRestartPill,
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
  WorkspaceSettingsBusyOverlay,
  WorkspaceSettingsBusyPanel,
  WorkspaceSettingsDialogHeader,
  WorkspaceSettingsHeaderMain,
  WorkspaceSettingsHeaderMeta,
  WorkspaceSettingsHeaderActions,
  WorkspaceSettingsMetaPill,
  WorkspaceModalCloseButton,
  CrashRecoveryOverlay,
  CrashRecoveryDialog,
  CrashRecoveryIntro,
  CrashRecoveryList,
  CrashRecoveryItem,
  CrashRecoveryItemTitle,
  CrashRecoveryItemBody,
  CrashRecoveryMeta,
  CrashRecoveryActions,
  WorkspaceSettingsForm,
  WorkspaceSettingsInput,
  WorkspaceSettingsSelect,
  WorkspaceSettingsSelectIcon,
  WorkspaceSettingsSelectShell,
  RootDirectoryInput,
  WorkspaceSettingsTopGrid,
  WorkspaceRootChooser,
  WorkspaceRootActions,
  WorkspaceSettingsActions,
  WorkspaceSettingsSection,
  TerminalCountGrid,
  TerminalCountButton,
  TerminalCountMeta,
  TerminalLayoutPreview,
  TerminalLayoutPreviewRow,
  TerminalLayoutPreviewCell,
  TerminalRoleSummary,
  TerminalRoleSliderGrid,
  TerminalRoleSliderRow,
  TerminalRoleRange,
  TerminalRoleGrid,
  TerminalRoleCard,
  TerminalRoleButtonGroup,
  TerminalRoleButton,
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
  AppearanceThemeGrid,
  AppearanceThemeButton,
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
  ButtonDarkModeIcon,
  ButtonFolderIcon,
  ButtonLightModeIcon,
  ButtonLogoutIcon,
  ButtonSettingsIcon,
  ButtonForgeIcon,
  ButtonCodeIcon,
  ButtonBotIcon,
  ButtonTerminalIcon,
  ButtonKeyIcon,
  ButtonMicIcon,
  ButtonProcessIcon,
  ButtonHubIcon,
  ButtonCheckIcon,
  ButtonRailCollapseIcon,
  ButtonRailExpandIcon,
  FileChevronIcon,
  FileExpandIcon,
  FileFolderTreeIcon,
  FileDocumentIcon,
  VIEW_TRANSITION_MS
} from "./appStyles";
import McpsWorkspaceView from "../mcps/McpsWorkspaceView.jsx";
import FilesWorkspaceView, { getDirectoryName } from "../files/FilesWorkspaceView.jsx";
import SpecGraphWorkspaceView from "../specGraph/SpecGraphWorkspaceView.jsx";
import AudioWorkspaceView, { AudioWidgetWindow, AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT, AUDIO_WIDGET_HASH, AUDIO_WIDGET_VISIBILITY_CHANGED_EVENT } from "../audio/AudioWorkspaceView.jsx";
import ProcessesView from "../processes/ProcessesView.jsx";
import WebWorkspaceView, { WORKSPACE_WEB_CLOSE_REQUESTED_EVENT } from "../web/WebWorkspaceView.jsx";


const WEB_LOGIN_URL = "https://diffforge.ai/desktop/login";
const PRICING_URL = "https://diffforge.ai/pricing";
const BRAND_NAME = "Diff Forge AI";
const LAUNCH_MINIMUM_MS = 1400;
const AUTH_STARTUP_TIMEOUT_MS = 5000;
const DEEP_LINK_STARTUP_TIMEOUT_MS = 1000;
const SESSION_RESTORE_TIMEOUT_MS = 5000;
const SESSION_RESTORE_TIMEOUT_MESSAGE = "Secure session check timed out after 5 seconds.";
const AUTH_EXCHANGE_TIMEOUT_MS = 10000;
const AUTH_EXCHANGE_TIMEOUT_MESSAGE = "Desktop sign in timed out. Try again.";
const OPEN_BROWSER_TIMEOUT_MS = 5000;
const BACKEND_HELLO_TIMEOUT_MS = 5000;
const BACKEND_HELLO_TIMEOUT_MESSAGE = "Diff Forge API check timed out.";
const PLAN_REFRESH_TIMEOUT_MS = 5000;
const LOGOUT_TIMEOUT_MS = 5000;
const WINDOW_FRAME_STATE_DEFAULT = { isFullscreen: false, isMaximized: false };
const WINDOW_VIEWPORT_MARGIN_PX = 12;
const WINDOW_RESIZE_EDGES = [
  { placement: "top", direction: "North" },
  { placement: "right", direction: "East" },
  { placement: "bottom", direction: "South" },
  { placement: "left", direction: "West" },
  { placement: "top-left", direction: "NorthWest" },
  { placement: "top-right", direction: "NorthEast" },
  { placement: "bottom-right", direction: "SouthEast" },
  { placement: "bottom-left", direction: "SouthWest" },
];
const DEFAULT_WORKSPACE_VIEW = "terminals";
const SELECTED_WORKSPACE_DETAIL_VIEWS = new Set(["files", "specGraph", "web", "mcps"]);
const SPEC_GRAPH_CACHE_EVENT = "cloud-mcp-spec-graph-cache";
const KNOWLEDGE_GRAPH_CACHE_EVENT = "cloud-mcp-knowledge-graph-cache";
const WORKSPACE_TERMINAL_PANE_PREFIX = "workspace-terminal";
const TERMINAL_CLOSE_ALL_PROGRESS_EVENT = "forge-terminal-close-all-progress";
const TERMINAL_PROMPT_SUBMITTED_EVENT = "forge-terminal-prompt-submitted";
const AGENT_STATUS_CACHE_KEY = "diffforge.agentStatuses.v1";
const AGENT_STATUS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const WORKSPACE_SETTINGS_STORAGE_KEY = "diffforge.workspaceSettings.v1";
const WORKSPACE_LIFECYCLE_STORAGE_KEY = "diffforge.workspaceLifecycle.v1";
const WORKSPACE_RAIL_STORAGE_KEY = "diffforge.workspaceRail.v1";
const APP_APPEARANCE_STORAGE_KEY = "diffforge.appearance.v1";
const APP_THEME_DARK = "dark";
const APP_THEME_LIGHT = "light";
const APP_THEME_DEFAULT = APP_THEME_DARK;
const APP_THEME_META_COLORS = {
  [APP_THEME_DARK]: "#030508",
  [APP_THEME_LIGHT]: "#f5f5f7",
};
const APP_THEME_OPTIONS = [
  {
    detail: "Current preset",
    icon: "dark",
    id: APP_THEME_DARK,
    label: "Dark",
  },
  {
    detail: "Bright preset",
    icon: "light",
    id: APP_THEME_LIGHT,
    label: "Light",
  },
];
const WORKSPACE_RAIL_ANIMATION_MS = 220;
const FILE_EXPLORER_LAYOUT_STORAGE_KEY = "diffforge.fileExplorerLayout.v1";
const FILE_EXPLORER_DEFAULT_SIZE = 28;
const FILE_EXPLORER_MIN_SIZE = 16;
const FILE_EXPLORER_MAX_SIZE = 76;
const FILE_PREVIEW_DEFAULT_SIZE = 72;
const FILE_PREVIEW_MIN_SIZE = 24;
const FILE_PREVIEW_MAX_SIZE = 84;
const WORKSPACE_THREAD_PROJECTION_POLL_INTERVAL_MS = 700;
const WORKSPACE_THREAD_PROJECTION_POLL_TIMEOUT_MS = 30 * 60 * 1000;
const WORKSPACE_THREAD_PROMPT_READY_TRANSCRIPT_DELAY_MS = 120;
const WORKSPACE_PROMPT_DELIVERY_TIMEOUT_MS = 31 * 60 * 1000;
const WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT = "diffforge:workspace-thread-prompt-accepted";
const SPEC_EDIT_TODO_QUEUE_EVENT = "diffforge:spec-edit-todo-queue";
const SPEC_EDIT_TODO_QUEUE_DISPATCH_EVENT = "diffforge:spec-edit-todo-queue-dispatched";
const SPEC_EDIT_TODO_QUEUE_CANCEL_EVENT = "diffforge:spec-edit-todo-queue-cancelled";
const VOICE_PLAN_TASK_LIFECYCLE_EVENT = "diffforge:voice-plan-task-lifecycle";

function getThreadDiagnosticTextLength(value) {
  return String(value ?? "").length;
}

function normalizeWorkspaceThreadProjectionText(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function workspaceThreadMessageTimestampMs(message) {
  const createdAt = String(message?.createdAt || message?.created_at || "").trim();
  const numericTimestamp = Number.parseFloat(createdAt);
  if (Number.isFinite(numericTimestamp) && numericTimestamp > 1_000_000_000) {
    return numericTimestamp < 10_000_000_000 ? numericTimestamp * 1000 : numericTimestamp;
  }

  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function transcriptMessageIndicatesTurnComplete(message) {
  const id = normalizeWorkspaceThreadProjectionText(message?.id).toLowerCase();
  const kind = normalizeWorkspaceThreadProjectionText(message?.kind).toLowerCase();
  const status = normalizeWorkspaceThreadProjectionText(message?.status).toLowerCase();
  const title = normalizeWorkspaceThreadProjectionText(message?.title).toLowerCase();
  return kind === "task_complete"
    || kind === "final_answer"
    || status === "task_complete"
    || id.includes("task-complete")
    || title === "task complete";
}

function transcriptHasTurnCompletionForPrompt(messages, event = {}) {
  const promptText = normalizeWorkspaceThreadProjectionText(
    event.expectedUserMessage || event.userMessage || event.message,
  );
  const submittedAtMs = workspaceThreadMessageTimestampMs({
    createdAt: event.messageCreatedAt || event.submittedAt || event.createdAt,
  });
  const transcriptMessages = Array.isArray(messages) ? messages : [];
  let userIndex = -1;
  if (promptText) {
    transcriptMessages.forEach((message, index) => {
      const role = String(message?.role || "").trim().toLowerCase();
      if (
        role === "user"
        && normalizeWorkspaceThreadProjectionText(message?.text || message?.message) === promptText
      ) {
        userIndex = index;
      }
    });
  }
  if (userIndex < 0 && submittedAtMs) {
    transcriptMessages.forEach((message, index) => {
      const role = String(message?.role || "").trim().toLowerCase();
      const messageTimestampMs = workspaceThreadMessageTimestampMs(message);
      if (role === "user" && messageTimestampMs && messageTimestampMs >= submittedAtMs - 30000) {
        userIndex = index;
      }
    });
  }

  const hasExplicitCompletion = transcriptMessages.some((message, index) => {
    if (!transcriptMessageIndicatesTurnComplete(message)) {
      return false;
    }
    if (userIndex >= 0) {
      return index > userIndex;
    }
    const messageTimestampMs = workspaceThreadMessageTimestampMs(message);
    return submittedAtMs
      ? Boolean(messageTimestampMs && messageTimestampMs >= submittedAtMs - 30000)
      : true;
  });
  if (hasExplicitCompletion) {
    return true;
  }

  return false;
}

function transcriptLatestPostPromptMessage(messages, event = {}) {
  const userIndex = transcriptSubmittedPromptIndex(messages, event);
  if (userIndex < 0) {
    return null;
  }

  const transcriptMessages = Array.isArray(messages) ? messages : [];
  for (let index = transcriptMessages.length - 1; index > userIndex; index -= 1) {
    const message = transcriptMessages[index];
    const role = String(message?.role || "").trim().toLowerCase();
    const kind = String(message?.kind || "").trim().toLowerCase();
    const text = normalizeWorkspaceThreadProjectionText(message?.text || message?.message);
    if (role === "system" || kind === "reasoning") {
      continue;
    }
    if (role === "assistant" || role === "activity") {
      return {
        index,
        kind,
        message,
        role,
        text,
      };
    }
  }

  return null;
}

function transcriptHasSettledAssistantResponseForPrompt(messages, event = {}) {
  const latestPostPromptMessage = transcriptLatestPostPromptMessage(messages, event);
  if (!latestPostPromptMessage) {
    return false;
  }

  const { message, role, text } = latestPostPromptMessage;
  return Boolean(
    role === "assistant"
      && (
        text
        || transcriptMessageIndicatesTurnComplete(message)
      )
  );
}

function workspaceThreadProjectionHash(value) {
  const text = String(value || "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function workspaceThreadProjectionIdPart(value, fallback = "event") {
  const text = String(value || fallback);
  const clean = normalizeWorkspaceThreadProjectionText(text)
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return `${clean || fallback}-${workspaceThreadProjectionHash(text)}`;
}

function getLatestWorkspaceThreadUserMessage(thread) {
  return [...(Array.isArray(thread?.messages) ? thread.messages : [])]
    .reverse()
    .find((message) => String(message?.role || "").trim().toLowerCase() === "user") || null;
}

function getPromptEventIdFromRunningThread(thread) {
  const latestTurn = thread?.latestTurn || null;
  const turnId = String(latestTurn?.turnId || "").trim();
  if (turnId.startsWith("turn-")) {
    return turnId.slice(5);
  }

  const messageId = String(latestTurn?.messageId || "").trim();
  if (messageId) {
    return messageId;
  }

  const latestUserMessageId = String(getLatestWorkspaceThreadUserMessage(thread)?.id || "").trim();
  return latestUserMessageId;
}

function threadLatestRunningTurnMatchesPrompt(thread, event = {}) {
  const latestTurn = thread?.latestTurn || null;
  const latestTurnState = String(latestTurn?.state || "").trim().toLowerCase();
  if (latestTurnState !== "running") {
    return false;
  }

  const promptEventId = String(event.promptEventId || event.pendingPromptId || event.promptId || "").trim();
  const latestTurnId = String(latestTurn?.turnId || latestTurn?.id || "").trim();
  const latestMessageId = String(latestTurn?.messageId || "").trim();
  if (
    promptEventId
    && (
      latestTurnId.includes(promptEventId)
      || latestMessageId === promptEventId
      || String(getLatestWorkspaceThreadUserMessage(thread)?.id || "").trim() === promptEventId
    )
  ) {
    return true;
  }

  const expectedUserMessage = normalizeWorkspaceThreadProjectionText(
    event.expectedUserMessage || event.userMessage || event.message,
  );
  if (!expectedUserMessage) {
    return false;
  }

  const latestUserMessage = getLatestWorkspaceThreadUserMessage(thread);
  if (
    normalizeWorkspaceThreadProjectionText(latestUserMessage?.text || latestUserMessage?.message)
    !== expectedUserMessage
  ) {
    return false;
  }

  const expectedAtMs = workspaceThreadMessageTimestampMs({
    createdAt: event.expectedMessageCreatedAt || event.messageCreatedAt || event.submittedAt || event.createdAt,
  });
  const latestUserAtMs = workspaceThreadMessageTimestampMs(latestUserMessage);
  if (!expectedAtMs || !latestUserAtMs) {
    return false;
  }

  return Math.abs(latestUserAtMs - expectedAtMs) <= 2500;
}

function buildTerminalReadyProjectionEvents(thread, event = {}, groundTruth = null) {
  const latestTurn = thread?.latestTurn || null;
  const latestTurnState = String(latestTurn?.state || "").trim().toLowerCase();
  const turnId = String(latestTurn?.turnId || "").trim();
  if (latestTurnState !== "running" || !turnId) {
    return [];
  }

  const eventType = String(event.type || "").trim().toLowerCase();
  const shouldCompleteFromReadiness = eventType === "terminal-prompt-ready"
    && (
      threadLatestRunningTurnMatchesPrompt(thread, event)
      || groundTruth?.runningTurnLooksIdle === true
    );
  if (!shouldCompleteFromReadiness) {
    return [];
  }

  const completedAt = String(
    event.promptReadyAt
      || event.inputReadyAt
      || event.completedAt
      || new Date().toISOString(),
  ).trim();
  const eventKey = workspaceThreadProjectionIdPart(
    event.promptEventId || event.pendingPromptId || turnId,
    eventType || "terminal-ready",
  );
  return [{
    agentId: event.agentId || event.currentAgent || thread?.currentAgent || "",
    assistantMessageId: latestTurn.assistantMessageId || "",
    completedAt,
    createdAt: completedAt,
    id: `projection-terminal-ready-${workspaceThreadProjectionIdPart(turnId, "turn")}-${eventKey}`,
    messageId: latestTurn.messageId || "",
    source: eventType || "terminal-ready",
    status: "completed",
    turnId,
    type: "thread.turn.completed",
  }];
}

function transcriptSubmittedPromptIndex(messages, event = {}) {
  const promptText = normalizeWorkspaceThreadProjectionText(
    event.expectedUserMessage || event.userMessage || event.message,
  );
  const submittedAtMs = workspaceThreadMessageTimestampMs({
    createdAt: event.messageCreatedAt || event.submittedAt || event.createdAt,
  });
  const matchedBy = String(event.matchedBy || "").trim().toLowerCase();
  const allowTimestampFallback = event.allowTimestampFallback === true
    || matchedBy.includes("timestamp")
    || matchedBy.includes("recovery");
  const requireTimestampForCwdMatch = matchedBy && matchedBy !== "sessionid";
  const transcriptMessages = Array.isArray(messages) ? messages : [];
  let userIndex = -1;

  if (promptText) {
    transcriptMessages.forEach((message, index) => {
      const role = String(message?.role || "").trim().toLowerCase();
      if (role !== "user") {
        return;
      }
      const text = normalizeWorkspaceThreadProjectionText(message?.text || message?.message);
      if (text !== promptText) {
        return;
      }
      const messageTimestampMs = workspaceThreadMessageTimestampMs(message);
      if (submittedAtMs && messageTimestampMs && messageTimestampMs < submittedAtMs - 30000) {
        return;
      }
      if (submittedAtMs && requireTimestampForCwdMatch && !messageTimestampMs) {
        return;
      }
      userIndex = index;
    });
  }

  if (userIndex < 0 && allowTimestampFallback && submittedAtMs) {
    transcriptMessages.forEach((message, index) => {
      const role = String(message?.role || "").trim().toLowerCase();
      const messageTimestampMs = workspaceThreadMessageTimestampMs(message);
      if (role === "user" && messageTimestampMs && messageTimestampMs >= submittedAtMs - 30000) {
        userIndex = index;
      }
    });
  }

  return userIndex;
}

function transcriptHasSubmittedPromptEvidence(messages, event = {}) {
  return transcriptSubmittedPromptIndex(messages, event) >= 0;
}

function getTranscriptPromptMatchDiagnostics(messages, event = {}) {
  const expectedRaw = String(
    event.expectedUserMessage || event.userMessage || event.message || "",
  ).trim();
  const expected = normalizeWorkspaceThreadProjectionText(expectedRaw);
  const expectedHead = expected.slice(0, Math.min(96, expected.length));
  const expectedTail = expected.slice(Math.max(0, expected.length - 96));
  const submittedAtMs = workspaceThreadMessageTimestampMs({
    createdAt: event.messageCreatedAt || event.submittedAt || event.createdAt,
  });
  const transcriptMessages = Array.isArray(messages) ? messages : [];
  const roleCounts = transcriptMessages.reduce((counts, message) => {
    const role = String(message?.role || "").trim().toLowerCase() || "unknown";
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
  const userMessages = transcriptMessages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => String(message?.role || "").trim().toLowerCase() === "user");
  const recentUserMessages = userMessages.slice(-8).map(({ message, index }) => {
    const rawText = String(message?.text || message?.message || "");
    const normalized = normalizeWorkspaceThreadProjectionText(rawText);
    const messageTimestampMs = workspaceThreadMessageTimestampMs(message);
    return {
      exactNormalizedMatch: Boolean(expected) && normalized === expected,
      expectedContainsCandidate: Boolean(normalized) && expected.includes(normalized),
      expectedHeadPresent: Boolean(expectedHead) && normalized.includes(expectedHead),
      expectedTailPresent: Boolean(expectedTail) && normalized.includes(expectedTail),
      idPresent: Boolean(message?.id),
      index,
      kind: message?.kind || "",
      normalizedLength: normalized.length,
      role: message?.role || "",
      source: message?.source || "",
      status: message?.status || "",
      text: getBigViewTextDiagnosticFields(rawText),
      timestampDeltaMs: submittedAtMs && messageTimestampMs ? messageTimestampMs - submittedAtMs : "",
      timestampPresent: Boolean(messageTimestampMs),
      title: getBigViewTextDiagnosticFields(message?.title || ""),
    };
  });
  const recentMessages = transcriptMessages.slice(-8).map((message, offset) => ({
    idPresent: Boolean(message?.id),
    index: Math.max(0, transcriptMessages.length - 8) + offset,
    kind: message?.kind || "",
    role: message?.role || "",
    source: message?.source || "",
    status: message?.status || "",
    text: getBigViewTextDiagnosticFields(message?.text || message?.message || ""),
    title: getBigViewTextDiagnosticFields(message?.title || ""),
  }));

  return {
    expectedNormalizedLength: expected.length,
    expectedPrompt: getBigViewTextDiagnosticFields(expectedRaw),
    matchedIndex: transcriptSubmittedPromptIndex(messages, event),
    messageCount: transcriptMessages.length,
    recentMessages,
    recentUserMessages,
    roleCounts,
    submittedAtMsPresent: Boolean(submittedAtMs),
    userMessageCount: userMessages.length,
  };
}

function getWorkspaceThreadDiagnosticSnapshot(workspaceThreads, workspaceId, threadId, agentId = "") {
  const safeWorkspaceId = String(workspaceId || "").trim();
  const safeThreadId = String(threadId || "").trim();
  const entry = workspaceThreads?.[safeWorkspaceId] || null;
  const thread = entry?.threads?.[safeThreadId] || null;
  const currentAgent = String(thread?.currentAgent || agentId || "").trim().toLowerCase();
  const providerBinding = getWorkspaceThreadProviderBinding(thread, currentAgent);
  const terminalBinding = providerBinding?.terminalBinding || thread?.terminalBinding || null;
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  const lastMessage = messages.length ? messages[messages.length - 1] : null;
  const lastText = lastMessage?.text ?? lastMessage?.content ?? lastMessage?.message ?? "";

  return {
    activityStatus: thread?.activityStatus || "",
    agentId: currentAgent,
    currentAgent,
    freshSessionStartedAtPresent: Boolean(thread?.freshSessionStartedAt),
    hasPendingPrompt: Boolean(thread?.pendingPrompt?.text || thread?.pendingPrompt),
    hasTerminalBinding: Boolean(terminalBinding?.paneId && terminalBinding?.instanceId),
    hasThread: Boolean(thread),
    lastKind: lastMessage?.kind || "",
    lastMessageIdPresent: Boolean(lastMessage?.id),
    lastRole: lastMessage?.role || "",
    lastTextLength: getThreadDiagnosticTextLength(lastText),
    latestTurnIdPresent: Boolean(thread?.latestTurn?.turnId),
    latestTurnState: thread?.latestTurn?.state || "",
    messageCount: messages.length,
    projectionEventCount: Array.isArray(thread?.projectionEvents) ? thread.projectionEvents.length : 0,
    providerSessionIdPresent: Boolean(providerBinding?.nativeSessionId),
    providerSessionKind: providerBinding?.nativeSessionKind || "",
    providerSessionTitlePresent: Boolean(providerBinding?.nativeSessionTitle),
    selectedThreadId: entry?.threadsView?.selectedThreadId || entry?.activeThreadId || "",
    status: thread?.status || "",
    terminalBindingInstanceId: terminalBinding?.instanceId || "",
    terminalBindingPaneId: terminalBinding?.paneId || "",
    terminalBindingTerminalIndex: terminalBinding?.terminalIndex ?? "",
    terminalIndex: thread?.terminalIndex ?? "",
    threadId: safeThreadId,
    transcriptHydrationMode: thread?.transcriptHydrationMode || "",
    transcriptSessionIdPresent: Boolean(thread?.transcriptSessionId),
    workspaceId: safeWorkspaceId,
  };
}

function logWorkspaceThreadDiagnosticEvent(phase, fields = {}) {
  logThreadBridgeDiagnosticEvent(phase, fields);
}
const MCP_REGISTRY_STORAGE_KEY = "diffforge.mcpRegistry.v1";
const MCP_TEXT_LIMIT = 12000;
const MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH = 2048;
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
const TERMINAL_START_METRIC_WAIT_MS = 900;
const TERMINAL_START_METRIC_POLL_MS = 16;
const TERMINAL_DEFAULT_SCROLLBACK_ROWS = 10000;
const TERMINAL_METRICS_NOTIFY_MS = 250;
const TERMINAL_WEBGL_IDLE_DELAY_MS = 420;
const TERMINAL_WEBGL_FIRST_OUTPUT_DELAY_MS = 80;
const TERMINAL_WEBGL_STAGGER_MS = 90;
const TERMINAL_WEBGL_MAX_DELAY_MS = 1200;
const TERMINAL_BLANK_STARTUP_PROBE_MS = 800;
const TERMINAL_BLANK_STARTUP_CONFIRM_MS = 800;
const WORKSPACE_CLOSE_NATIVE_EXIT_TIMEOUT_MS = 30000;
const WORKSPACE_DEACTIVATE_RUNTIME_TIMEOUT_MS = 30000;
const WORKSPACE_SETTINGS_TERMINAL_CLEANUP_TIMEOUT_MS = 18000;
const WORKSPACE_SETTINGS_WAIT_FOR_TERMINAL_CLEANUP = !TERMINAL_IS_WINDOWS_HOST;
const WORKSPACE_SHARED_MCP_TIMEOUT_MS = 8000;
const WORKSPACE_CLOSE_BROWSER_TIMEOUT_MS = 1800;
const WORKSPACE_CLOSE_WINDOW_TIMEOUT_MS = 1200;
const WORKSPACE_CLOSE_INITIAL_STATE = { isActive: false, closed: 0, total: 0 };
const WORKSPACE_DEACTIVATION_INITIAL_STATE = {
  isActive: false,
  workspaceId: "",
  source: "",
  closed: 0,
  total: 0,
};
const AUTH_STEPS = ["Browser sign in", "State match", "Desktop session"];
const AGENT_PROVIDERS = [
  { id: "codex", label: "Codex", shortLabel: "Codex" },
  { id: "claude", label: "Claude Code", shortLabel: "Claude" },
  { id: "opencode", label: "OpenCode", shortLabel: "OpenCode" },
];
const WORKSPACE_AGENT_STARTUP_DEFAULT_MODELS = {
  claude: "sonnet",
  codex: "gpt-5.5",
};
const WORKSPACE_TERMINAL_ROLE_GENERIC = "generic";
const WORKSPACE_TERMINAL_ROLE_OPTIONS = [
  { id: "codex", label: "Codex", shortLabel: "CX" },
  { id: "claude", label: "Claude Code", shortLabel: "CL" },
  { id: WORKSPACE_TERMINAL_ROLE_GENERIC, label: "Terminal", shortLabel: "SH" },
  { id: "opencode", label: "OpenCode", shortLabel: "OC" },
];
const WORKSPACE_TERMINAL_ROLE_IDS = new Set(WORKSPACE_TERMINAL_ROLE_OPTIONS.map((role) => role.id));
const GENERIC_TERMINAL_AGENT = {
  id: WORKSPACE_TERMINAL_ROLE_GENERIC,
  label: "Generic shell",
  shortLabel: "Shell",
  binary: "",
  installed: true,
  authenticated: true,
  version: "Local shell",
  authMessage: "Plain terminal",
};
const WORKSPACE_TERMINAL_COUNT_OPTIONS = Array.from(
  { length: MAX_WORKSPACE_TERMINAL_COUNT },
  (_, index) => index + MIN_WORKSPACE_TERMINAL_COUNT,
);
const AGENT_INSTALL_GUIDES = {
  codex: {
    nativeInstallUrl: "https://github.com/openai/codex/releases/latest",
    nativeInstallLabel: "GitHub release binaries",
    installCommand: "npm install -g @openai/codex",
  },
  claude: {
    nativeInstallUrl: "https://code.claude.com/docs/en/quickstart",
    nativeInstallLabel: "Native install guide",
    installCommand: "npm install -g @anthropic-ai/claude-code",
  },
  opencode: {
    nativeInstallUrl: "https://opencode.ai/docs/",
    nativeInstallLabel: "Install script / package guide",
    installCommand: "npm install -g opencode-ai",
  },
};
const DEFAULT_AGENT_STATUSES = AGENT_PROVIDERS.map((provider) => ({
  ...provider,
  binary: provider.id,
  installed: false,
  authenticated: false,
  version: "Not checked",
  authMessage: "Check terminal CLI status.",
  installCommand: AGENT_INSTALL_GUIDES[provider.id].installCommand,
  nativeInstallUrl: AGENT_INSTALL_GUIDES[provider.id].nativeInstallUrl,
  nativeInstallLabel: AGENT_INSTALL_GUIDES[provider.id].nativeInstallLabel,
  npmAvailable: false,
  npmVersion: "Not checked",
  npmInstalled: false,
  npmPackageVersion: "Not checked",
  npmLatestVersion: "Not checked",
  npmUpdateAvailable: false,
  recommendNativeInstall: true,
  connectCommand: provider.id === "codex"
    ? "codex login"
    : provider.id === "opencode"
      ? "opencode auth login"
      : "claude",
  imageInputSupported: provider.id === "codex" || provider.id === "claude",
  imageInputSupport: provider.id === "opencode" ? "conditional" : "supported",
  imageInputReason: provider.id === "opencode"
    ? "OpenCode image input depends on the selected model."
    : `${provider.label} supports image input.`,
  activeModel: "",
  activeModelSupportsImages: provider.id === "codex" || provider.id === "claude",
}));

function getDefaultAgentStatus(providerId) {
  return DEFAULT_AGENT_STATUSES.find((status) => status.id === providerId);
}

function getAgentStatusReportedModel(status) {
  return String(
    status?.activeModel
      || status?.model
      || status?.selectedModel
      || status?.configuredModel
      || status?.nativeModel
      || "",
  ).trim();
}

function getWorkspaceAgentStartupModel(agentId, agentStatuses = DEFAULT_AGENT_STATUSES) {
  const normalizedAgentId = String(agentId || "").trim().toLowerCase();
  const status = (Array.isArray(agentStatuses) ? agentStatuses : []).find((candidate) => (
    String(candidate?.id || "").trim().toLowerCase() === normalizedAgentId
  ));
  return getAgentStatusReportedModel(status) || WORKSPACE_AGENT_STARTUP_DEFAULT_MODELS[normalizedAgentId] || "";
}

function normalizeCachedAgentStatus(status) {
  if (!status || typeof status !== "object") {
    return null;
  }

  const provider = AGENT_PROVIDERS.find((item) => item.id === status.id);
  const defaults = provider ? getDefaultAgentStatus(provider.id) : null;

  if (!provider || !defaults) {
    return null;
  }

  return {
    ...defaults,
    ...provider,
    authenticated: Boolean(status.authenticated),
    authMessage: status.authenticated
      ? "Cached terminal CLI session. Rechecking..."
      : "Cached terminal CLI state. Rechecking...",
    cached: true,
    installed: Boolean(status.installed),
    imageInputReason: typeof status.imageInputReason === "string"
      ? status.imageInputReason.slice(0, 240)
      : defaults.imageInputReason,
    imageInputSupported: Boolean(status.imageInputSupported),
    imageInputSupport: typeof status.imageInputSupport === "string"
      ? status.imageInputSupport.slice(0, 40)
      : defaults.imageInputSupport,
    activeModel: typeof status.activeModel === "string"
      ? status.activeModel.slice(0, 120)
      : defaults.activeModel,
    activeModelSupportsImages: Boolean(status.activeModelSupportsImages),
    npmAvailable: Boolean(status.npmAvailable),
    npmInstalled: Boolean(status.npmInstalled),
    npmLatestVersion: typeof status.npmLatestVersion === "string"
      ? status.npmLatestVersion.slice(0, 120)
      : defaults.npmLatestVersion,
    npmPackageVersion: typeof status.npmPackageVersion === "string"
      ? status.npmPackageVersion.slice(0, 120)
      : defaults.npmPackageVersion,
    npmUpdateAvailable: Boolean(status.npmUpdateAvailable),
    npmVersion: typeof status.npmVersion === "string"
      ? status.npmVersion.slice(0, 80)
      : defaults.npmVersion,
    recommendNativeInstall: status.recommendNativeInstall !== false,
    version: typeof status.version === "string"
      ? status.version.slice(0, 120)
      : defaults.version,
  };
}

function readCachedAgentStatuses() {
  try {
    const cached = JSON.parse(window.localStorage.getItem(AGENT_STATUS_CACHE_KEY) || "null");
    const savedAt = Number(cached?.savedAt);

    if (!Number.isFinite(savedAt) || Date.now() - savedAt > AGENT_STATUS_CACHE_TTL_MS) {
      return DEFAULT_AGENT_STATUSES;
    }

    const statusMap = new Map(
      (Array.isArray(cached?.statuses) ? cached.statuses : [])
        .map(normalizeCachedAgentStatus)
        .filter(Boolean)
        .map((status) => [status.id, status]),
    );

    if (!statusMap.size) {
      return DEFAULT_AGENT_STATUSES;
    }

    return AGENT_PROVIDERS.map((provider) => statusMap.get(provider.id) || getDefaultAgentStatus(provider.id));
  } catch {
    return DEFAULT_AGENT_STATUSES;
  }
}

function persistAgentStatusCache(statuses) {
  try {
    const safeStatuses = statuses.map((status) => ({
      authenticated: Boolean(status.authenticated),
      id: status.id,
      installed: Boolean(status.installed),
      imageInputReason: typeof status.imageInputReason === "string" ? status.imageInputReason.slice(0, 240) : "",
      imageInputSupported: Boolean(status.imageInputSupported),
      imageInputSupport: typeof status.imageInputSupport === "string" ? status.imageInputSupport.slice(0, 40) : "",
      activeModel: typeof status.activeModel === "string" ? status.activeModel.slice(0, 120) : "",
      activeModelSupportsImages: Boolean(status.activeModelSupportsImages),
      npmAvailable: Boolean(status.npmAvailable),
      npmInstalled: Boolean(status.npmInstalled),
      npmLatestVersion: typeof status.npmLatestVersion === "string" ? status.npmLatestVersion.slice(0, 120) : "",
      npmPackageVersion: typeof status.npmPackageVersion === "string" ? status.npmPackageVersion.slice(0, 120) : "",
      npmUpdateAvailable: Boolean(status.npmUpdateAvailable),
      npmVersion: typeof status.npmVersion === "string" ? status.npmVersion.slice(0, 80) : "",
      recommendNativeInstall: status.recommendNativeInstall !== false,
      version: typeof status.version === "string" ? status.version.slice(0, 120) : "",
    }));

    window.localStorage.setItem(
      AGENT_STATUS_CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        statuses: safeStatuses,
      }),
    );
  } catch {
    // Cached readiness is only a startup hint; fresh native checks remain authoritative.
  }
}

let nextWorkspaceTerminalInstanceId = 1;
const AUTH_TILE_COLUMNS = 64;
const AUTH_TILE_ROWS = 24;
const AUTH_TILE_BURSTS = Array.from({ length: 156 }, (_, index) => {
  const col = (index * 9 + Math.floor(index / 4) * 5) % AUTH_TILE_COLUMNS;
  const row = (index * 7 + Math.floor(index / 6) * 4) % AUTH_TILE_ROWS;
  const delay = `${((index * 0.47) % 12).toFixed(1)}s`;
  const duration = `${(7.2 + (index % 8) * 0.48).toFixed(1)}s`;
  const peak = (0.2 + (index % 6) * 0.026).toFixed(3);

  return [col, row, delay, duration, peak];
});

function AuthSquareBackdrop({ tone = "default" } = {}) {
  return (
    <SquareField aria-hidden="true" data-tone={tone}>
      {AUTH_TILE_BURSTS.map(([col, row, delay, duration, peak]) => (
        <SquarePulse
          key={`${col}-${row}-${delay}`}
          style={{
            "--left": `${col * AUTH_TILE_SIZE}px`,
            "--top": `${row * AUTH_TILE_SIZE}px`,
            "--delay": delay,
            "--duration": duration,
            "--peak": peak,
          }}
        />
      ))}
    </SquareField>
  );
}

function WorkspaceIdleState({ detail = "No workspace selected.", viewMotion }) {
  return (
    <WorkspaceIdleSurface aria-label="No workspace selected" data-motion={viewMotion}>
      <AuthSquareBackdrop tone="quiet" />
      <WorkspaceIdlePanel>
        <WorkspaceIdleLogo src="/logo.webp" alt="" />
        <WorkspaceIdleTitle>{BRAND_NAME}</WorkspaceIdleTitle>
        <WorkspaceIdleDetail>{detail}</WorkspaceIdleDetail>
      </WorkspaceIdlePanel>
    </WorkspaceIdleSurface>
  );
}

function createAuthState() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);

  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function isPaidUser(sessionUser) {
  return sessionUser?.planStatus === "paid";
}

function parseAuthCallback(urlValue) {
  try {
    const url = new URL(urlValue);

    if (url.protocol !== "diffforge:" || url.hostname !== "auth" || url.pathname !== "/callback") {
      return null;
    }

    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";

    if (!isSafeAuthValue(code) || !isSafeAuthValue(state)) {
      return null;
    }

    return { code, state };
  } catch {
    return null;
  }
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

function createSpecEditIntentId() {
  const randomId = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
  return `spec-edit-${randomId}`;
}

function cleanSpecEditPromptText(value, maxLength = 1800) {
  const cleaned = String(value || "")
    .replace(/\r/g, "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .trim();
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  return `${cleaned.slice(0, maxLength - 12).trimEnd()}...`;
}

function buildSpecEditAgentPrompt(intentId, payload, workspace, repoPath) {
  const operation = String(payload.operation || "edit").toLowerCase();
  const operationLabel = operation === "add"
    ? "add"
    : operation === "delete"
      ? "delete"
      : "edit";
  const targetTitle = cleanSpecEditPromptText(payload.targetTitle || "Spec node", 240);
  const targetPath = cleanSpecEditPromptText(payload.targetPath || "", 300);
  const currentStatement = cleanSpecEditPromptText(payload.currentStatement || "", 1800);
  const desiredStatement = cleanSpecEditPromptText(payload.desiredStatement || "", 1800);
  const userInstruction = cleanSpecEditPromptText(payload.userInstruction || "", 1800);
  const lines = [
    `Diff Forge Spec Edit Intent: ${intentId}`,
    "",
    `Operation: ${operationLabel}`,
    `Workspace: ${workspace?.name || workspace?.id || "Workspace"}`,
    `Repository path: ${repoPath || ""}`,
    `Target node id: ${payload.targetNodeId || ""}`,
    `Target node: ${targetTitle}`,
  ];
  if (targetPath) lines.push(`Target path: ${targetPath}`);
  if (payload.targetSpecObjectId) lines.push(`Target spec object id: ${payload.targetSpecObjectId}`);
  if (payload.baseGraphHash) lines.push(`Base graph cursor: ${payload.baseGraphHash}`);
  if (payload.baseNodeHash) lines.push(`Base node hash: ${payload.baseNodeHash}`);
  if (currentStatement) {
    lines.push("", "Current spec:", currentStatement);
  }
  if (desiredStatement) {
    lines.push("", operation === "add" ? "New spec:" : "Desired spec:", desiredStatement);
  }
  if (userInstruction) {
    lines.push("", "User instruction:", userInstruction);
  }
  lines.push(
    "",
    "Use coordination-kernel.start_task before changing files or specs. Include this spec_edit_intent_id in the task metadata or plan if the tool schema allows it.",
    "Acquire leases for affected paths before file edits. Checkpoint progress and submit_patch when complete.",
    "For delete, retire or supersede the selected spec through the Spec Graph workflow; do not hard-delete history.",
  );
  return lines.join("\n");
}

function specEditField(item, ...keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return "";
}

function normalizeSpecEditStatement(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function specEditJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function specEditSnapshotNodes(snapshot) {
  const graph = snapshot?.specGraph || snapshot?.raw || {};
  if (Array.isArray(snapshot?.specNodes)) return snapshot.specNodes;
  if (Array.isArray(graph?.nodes)) return graph.nodes;
  if (Array.isArray(snapshot?.nodes)) return snapshot.nodes;
  return [];
}

function specEditNodeActiveSpecs(node) {
  return specEditJsonArray(specEditField(node, "active_specs", "activeSpecs"));
}

function specEditSpecId(spec) {
  return String(specEditField(spec, "id", "spec_id", "specId") || "").trim();
}

function specEditSpecStatement(spec) {
  return String(specEditField(spec, "statement", "text", "title") || "");
}

function specEditSnapshotCursor(snapshot) {
  const graph = snapshot?.specGraph || snapshot?.raw || {};
  return String(specEditField(snapshot, "cursor") || specEditField(graph, "cursor") || "").trim();
}

function specEditSnapshotNodeHash(snapshot, nodeId) {
  const safeNodeId = String(nodeId || "").trim();
  if (!safeNodeId) return "";
  const hashes = snapshot?.nodeHashes || snapshot?.node_hashes || {};
  if (hashes && typeof hashes === "object" && !Array.isArray(hashes)) {
    return String(hashes[safeNodeId] || "").trim();
  }
  return "";
}

function specEditSpecSignature(spec) {
  return {
    id: specEditSpecId(spec),
    statement: normalizeSpecEditStatement(specEditSpecStatement(spec)),
    status: String(specEditField(spec, "status", "freshness_state", "freshnessState") || "").trim().toLowerCase(),
  };
}

function specEditNodeChangeSignature(node) {
  if (!node) return "";
  const activeSpecs = specEditNodeActiveSpecs(node).map(specEditSpecSignature);
  const supersededSpecs = specEditJsonArray(
    specEditField(node, "superseded_specs", "supersededSpecs"),
  ).map(specEditSpecSignature);
  return JSON.stringify({
    activeAgentCount: Number(specEditField(node, "active_agent_count", "activeAgentCount")) || 0,
    activeSpecs,
    fileState: String(specEditField(node, "file_state", "fileState") || "").trim().toLowerCase(),
    freshness: String(specEditField(node, "freshness_state", "freshnessState", "spec_state", "specState") || "").trim().toLowerCase(),
    lastCodeTouchAt: String(specEditField(node, "last_code_touch_at", "lastCodeTouchAt") || "").trim(),
    lastPatchEvidenceAt: String(specEditField(node, "last_patch_evidence_at", "lastPatchEvidenceAt") || "").trim(),
    leaseState: String(specEditField(node, "lease_state", "leaseState") || "").trim().toLowerCase(),
    markdownPath: String(specEditField(node, "markdown_path", "markdownPath") || "").trim(),
    notificationCount: Number(specEditField(node, "notification_count", "notificationCount", "out_of_spec_count", "outOfSpecCount")) || 0,
    supersededSpecs,
    updatedAt: String(specEditField(node, "updated_at", "updatedAt") || "").trim(),
  });
}

function specEditIntentResolvedByGraph(snapshot, intent) {
  const targetNodeId = String(intent?.targetNodeId || "").trim();
  if (!snapshot || !targetNodeId) return false;

  const node = specEditSnapshotNodes(snapshot).find((candidate) => (
    String(specEditField(candidate, "id", "node_id", "nodeId") || "").trim() === targetNodeId
  ));
  if (!node) return false;

  const activeSpecs = specEditNodeActiveSpecs(node);
  const operation = String(intent?.operation || "edit").toLowerCase();
  const targetSpecObjectId = String(intent?.targetSpecObjectId || "").trim();
  const currentStatement = normalizeSpecEditStatement(intent?.currentStatement);
  const desiredStatement = normalizeSpecEditStatement(intent?.desiredStatement);
  const activeIds = new Set(activeSpecs.map(specEditSpecId).filter(Boolean));
  const activeStatements = activeSpecs.map((spec) => normalizeSpecEditStatement(specEditSpecStatement(spec)));
  const targetActiveSpec = targetSpecObjectId
    ? activeSpecs.find((spec) => specEditSpecId(spec) === targetSpecObjectId)
    : null;

  if (operation === "add") {
    return Boolean(desiredStatement && activeStatements.includes(desiredStatement));
  }

  if (operation === "delete") {
    if (targetSpecObjectId) return !activeIds.has(targetSpecObjectId);
    return Boolean(currentStatement && !activeStatements.includes(currentStatement));
  }

  if (desiredStatement && activeStatements.includes(desiredStatement)) {
    return true;
  }
  if (targetSpecObjectId && !activeIds.has(targetSpecObjectId)) {
    return true;
  }
  if (targetActiveSpec && currentStatement) {
    return normalizeSpecEditStatement(specEditSpecStatement(targetActiveSpec)) !== currentStatement;
  }

  const baseNodeHash = String(intent?.baseNodeHash || "").trim();
  const nextNodeHash = specEditSnapshotNodeHash(snapshot, targetNodeId);
  if (baseNodeHash && nextNodeHash && nextNodeHash !== baseNodeHash) {
    return true;
  }

  const baseNodeSignature = String(intent?.targetNodeSignature || "").trim();
  const nextNodeSignature = specEditNodeChangeSignature(node);
  if ((!baseNodeHash || !nextNodeHash) && baseNodeSignature && nextNodeSignature && nextNodeSignature !== baseNodeSignature) {
    return true;
  }

  const baseGraphHash = String(intent?.baseGraphHash || "").trim();
  const nextGraphHash = specEditSnapshotCursor(snapshot);
  if (!baseNodeHash && !baseNodeSignature && baseGraphHash && nextGraphHash && nextGraphHash !== baseGraphHash) {
    return true;
  }

  return false;
}

function specEditProjectionEventCompletesIntent(event, intent) {
  const eventType = String(event?.type || "").trim().toLowerCase();
  if (!["thread.turn.completed", "thread.turn.error", "thread.turn.interrupted"].includes(eventType)) {
    return false;
  }
  const intentId = String(intent?.intentId || "").trim();
  const eventTurnId = String(event?.turnId || event?.turn_id || "").trim();
  const eventMessageId = String(event?.messageId || event?.message_id || "").trim();
  return Boolean(intentId && (eventTurnId === `turn-${intentId}` || eventMessageId === intentId));
}

function specEditIntentAgentFinished(workspaceThreads, intent) {
  const workspaceId = String(intent?.workspaceId || "").trim();
  const threadId = String(intent?.threadId || "").trim();
  if (!workspaceId || !threadId) return false;

  const thread = workspaceThreads?.[workspaceId]?.threads?.[threadId] || null;
  if (!thread) return false;

  const submittedAtMs = Number(intent?.submittedAtMs)
    || Date.parse(intent?.submittedAt || intent?.createdAt || "")
    || 0;
  const projectionEvents = Array.isArray(thread.projectionEvents) ? thread.projectionEvents : [];
  if (projectionEvents.some((event) => specEditProjectionEventCompletesIntent(event, intent))) {
    return true;
  }
  if (transcriptHasTurnCompletionForPrompt(thread.messages, {
    allowTimestampFallback: true,
    expectedUserMessage: intent?.promptText || "",
    messageCreatedAt: intent?.submittedAt || intent?.createdAt || "",
    submittedAt: intent?.submittedAt || intent?.createdAt || "",
  })) {
    return true;
  }

  const latestTurn = thread.latestTurn || null;
  const latestTurnState = String(latestTurn?.state || "").toLowerCase();
  const intentId = String(intent?.intentId || "").trim();
  const latestTurnMatchesIntent = Boolean(
    intentId
      && (
        String(latestTurn?.turnId || "").trim() === `turn-${intentId}`
        || String(latestTurn?.messageId || "").trim() === intentId
      ),
  );
  if (latestTurnState === "running") {
    const status = String(thread.status || "").toLowerCase();
    return ["closed", "error", "exited"].includes(status);
  }

  const turnUpdatedAtMs = Date.parse(
    latestTurn?.completedAt
      || latestTurn?.updatedAt
      || latestTurn?.startedAt
      || latestTurn?.requestedAt
      || "",
  ) || 0;
  if (["completed", "error", "interrupted"].includes(latestTurnState)) {
    return latestTurnMatchesIntent || !submittedAtMs || !turnUpdatedAtMs || turnUpdatedAtMs >= submittedAtMs - 30000;
  }

  const status = String(thread.status || "").toLowerCase();
  return ["closed", "error", "exited"].includes(status);
}

function specEditIntentResolvedByLifecycleEvent(intent, event = {}) {
  const eventType = String(event?.type || "").trim().toLowerCase();
  if (!["provider-turn-completed", "provider-turn-error", "closed", "exited", "error"].includes(eventType)) {
    return false;
  }

  const workspaceId = String(intent?.workspaceId || "").trim();
  const threadId = String(intent?.threadId || "").trim();
  const eventWorkspaceId = String(event?.workspaceId || "").trim();
  const eventThreadId = String(event?.threadId || "").trim();
  if ((workspaceId && eventWorkspaceId && workspaceId !== eventWorkspaceId)
    || (threadId && eventThreadId && threadId !== eventThreadId)) {
    return false;
  }

  const intentId = String(intent?.intentId || "").trim();
  const promptId = String(
    event?.pendingPromptId
      || event?.promptId
      || event?.promptEventId
      || event?.messageId
      || "",
  ).trim();
  if (intentId && promptId && promptId === intentId) {
    return true;
  }

  const projectionEvents = Array.isArray(event?.projectionEvents)
    ? event.projectionEvents
    : Array.isArray(event?.events)
      ? event.events
      : [];
  if (projectionEvents.some((projectionEvent) => specEditProjectionEventCompletesIntent(projectionEvent, intent))) {
    return true;
  }

  if (["closed", "exited", "error"].includes(eventType)) {
    return Boolean(threadId && eventThreadId && threadId === eventThreadId);
  }

  const completedAtMs = Date.parse(
    event?.completedAt || event?.messageCreatedAt || event?.createdAt || "",
  ) || 0;
  const submittedAtMs = Number(intent?.submittedAtMs)
    || Date.parse(intent?.submittedAt || intent?.createdAt || "")
    || 0;
  return Boolean(threadId && eventThreadId && threadId === eventThreadId)
    && (!completedAtMs || !submittedAtMs || completedAtMs >= submittedAtMs - 30000);
}

function isTerminalSessionMissingError(error) {
  const message = getErrorMessage(error, "").toLowerCase();

  return message.includes("terminal session is not running")
    || message.includes("terminal session not running");
}

function isDesktopSessionExpiredError(error) {
  const message = getErrorMessage(error, "").toLowerCase();

  return (
    message.includes("desktop session expired")
    || message.includes("session expired")
    || message.includes("invalid desktop session")
    || message.includes("unauthorized")
    || message.includes("forbidden")
  );
}

function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      reject(new Error(message));
    }, timeoutMs);

    Promise.resolve(promise).then(
      (value) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function hasTauriWindowMetadata() {
  return Boolean(window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label);
}

function getSafeCurrentWindow() {
  if (!hasTauriWindowMetadata()) {
    return null;
  }

  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

function getWindowControlPlatform() {
  if (typeof navigator === "undefined") {
    return "linux";
  }

  const platform = [
    navigator.userAgentData?.platform,
    navigator.platform,
    navigator.userAgent,
  ].filter(Boolean).join(" ").toLowerCase();

  if (/mac|darwin/.test(platform)) {
    return "macos";
  }

  if (/win/.test(platform)) {
    return "windows";
  }

  return "linux";
}

function runWindowAction(action) {
  try {
    const result = action();

    if (!result || typeof result.catch !== "function") {
      return;
    }

    result.catch(() => {
      // Window controls are best-effort; failed actions should not break app state.
    });
  } catch {
    // Window controls are best-effort; failed actions should not break app state.
  }
}

function normalizeCloseCount(value) {
  const count = Number(value);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function normalizeTerminalCloseProgress(payload) {
  const total = normalizeCloseCount(payload?.total);
  const closed = normalizeCloseCount(payload?.closed);

  return {
    closed: Math.min(closed, total || closed),
    total,
  };
}

async function closeWorkspaceWindowDirectly(appWindow) {
  try {
    await withTimeout(
      appWindow.close(),
      WORKSPACE_CLOSE_WINDOW_TIMEOUT_MS,
      "Window close timed out.",
    );
    return;
  } catch (closeError) {

    if (typeof appWindow.destroy !== "function") {
      throw closeError;
    }
  }

  if (typeof appWindow.destroy !== "function") {
    throw new Error("Window destroy is unavailable.");
  }

  try {
    await withTimeout(
      appWindow.destroy(),
      WORKSPACE_CLOSE_WINDOW_TIMEOUT_MS,
      "Window destroy timed out.",
    );
  } catch (destroyError) {
    throw destroyError;
  }

}

function requestWorkspaceWebClose(reason = "app_close") {
  try {
    window.dispatchEvent(new CustomEvent(WORKSPACE_WEB_CLOSE_REQUESTED_EVENT, {
      detail: { reason },
    }));
  } catch {
    // The backend close command below is the shutdown backstop.
  }

  return invoke("workspace_web_close_all").catch(() => 0);
}

async function closeWorkspaceWindowAfterTerminalShutdown(appWindow) {
  await withTimeout(
    requestWorkspaceWebClose("native_app_close"),
    WORKSPACE_CLOSE_BROWSER_TIMEOUT_MS,
    "Workspace browser close timed out.",
  ).catch(() => {});

  try {
    await withTimeout(
      invoke("close_app_after_terminal_shutdown"),
      WORKSPACE_CLOSE_NATIVE_EXIT_TIMEOUT_MS,
      "Native app exit timed out.",
    );
    return;
  } catch {
  }

  await closeWorkspaceWindowDirectly(appWindow);
}

async function readWindowFrameState(appWindow = getSafeCurrentWindow()) {
  if (!appWindow) {
    return null;
  }

  const [isFullscreen, isMaximized] = await Promise.all([
    appWindow.isFullscreen(),
    appWindow.isMaximized(),
  ]);

  return {
    isFullscreen: Boolean(isFullscreen),
    isMaximized: Boolean(isMaximized),
  };
}

function getFiniteNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) ? number : fallback;
}

function getBoundsRect(position, size) {
  const left = getFiniteNumber(position?.x);
  const top = getFiniteNumber(position?.y);
  const width = Math.max(0, getFiniteNumber(size?.width));
  const height = Math.max(0, getFiniteNumber(size?.height));

  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

function getMonitorWorkAreaRect(monitor) {
  const area = monitor?.workArea;

  if (!area?.position || !area?.size) {
    return null;
  }

  return getBoundsRect(area.position, area.size);
}

function getRectIntersectionArea(first, second) {
  const width = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const height = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));

  return width * height;
}

function getRectCenterDistance(first, second) {
  const firstX = first.left + first.width / 2;
  const firstY = first.top + first.height / 2;
  const secondX = second.left + second.width / 2;
  const secondY = second.top + second.height / 2;
  const deltaX = firstX - secondX;
  const deltaY = firstY - secondY;

  return deltaX * deltaX + deltaY * deltaY;
}

function selectRecoveryMonitor(monitors, windowRect) {
  return monitors.reduce((bestMonitor, monitor) => {
    const workAreaRect = getMonitorWorkAreaRect(monitor);

    if (!workAreaRect) {
      return bestMonitor;
    }

    const area = getRectIntersectionArea(windowRect, workAreaRect);
    const distance = getRectCenterDistance(windowRect, workAreaRect);

    if (!bestMonitor || area > bestMonitor.area || (area === bestMonitor.area && distance < bestMonitor.distance)) {
      return { monitor, area, distance };
    }

    return bestMonitor;
  }, null)?.monitor || null;
}

async function resolveRecoveryMonitor(windowRect) {
  try {
    const monitor = await currentMonitor();

    if (monitor) {
      return monitor;
    }
  } catch {
    // Fall back to all monitors when the current monitor is unavailable.
  }

  try {
    const monitors = await availableMonitors();

    return selectRecoveryMonitor(monitors, windowRect);
  } catch {
    return null;
  }
}

function clampWindowCoordinate(value, min, max) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

async function recoverWindowIntoViewport(appWindow = getSafeCurrentWindow()) {
  if (!appWindow) {
    return;
  }

  const [position, size] = await Promise.all([
    appWindow.outerPosition(),
    appWindow.outerSize(),
  ]);
  const windowRect = getBoundsRect(position, size);
  const monitor = await resolveRecoveryMonitor(windowRect);
  const workAreaRect = getMonitorWorkAreaRect(monitor);

  if (!workAreaRect) {
    return;
  }

  const marginX = Math.min(WINDOW_VIEWPORT_MARGIN_PX, Math.max(0, Math.floor(workAreaRect.width / 4)));
  const marginY = Math.min(WINDOW_VIEWPORT_MARGIN_PX, Math.max(0, Math.floor(workAreaRect.height / 4)));
  const nextX = Math.round(clampWindowCoordinate(
    windowRect.left,
    workAreaRect.left + marginX,
    workAreaRect.right - windowRect.width - marginX,
  ));
  const nextY = Math.round(clampWindowCoordinate(
    windowRect.top,
    workAreaRect.top + marginY,
    workAreaRect.bottom - windowRect.height - marginY,
  ));

  if (nextX !== Math.round(position.x) || nextY !== Math.round(position.y)) {
    await appWindow.setPosition(new PhysicalPosition(nextX, nextY));
  }
}

function getAgentTone(agent) {
  if (!agent?.installed) {
    return "offline";
  }

  return agent.authenticated ? "ready" : "needsAuth";
}

function getReadyAgent(agentStatuses, preferredAgentId = "codex") {
  const readyAgents = agentStatuses.filter((agent) => agent.installed && agent.authenticated);
  const preferredAgent = readyAgents.find((agent) => agent.id === preferredAgentId);

  return preferredAgent || readyAgents.find((agent) => agent.id === "codex") || readyAgents[0] || null;
}

function normalizeManagedAgentProviderId(value) {
  const providerId = String(value || "").trim();
  return ["codex", "claude", "opencode"].includes(providerId) ? providerId : "";
}

function getManagedAgentLabel(agentId) {
  return getDefaultAgentStatus(agentId)?.label || agentId || "coding agent";
}

function getAgentStatusSummary(agentStatuses) {
  const codex = agentStatuses.find((agent) => agent.id === "codex");
  const claude = agentStatuses.find((agent) => agent.id === "claude");
  const opencode = agentStatuses.find((agent) => agent.id === "opencode");

  return [codex, claude, opencode].filter(Boolean);
}

function getAgentUpdatesAvailable(agentStatuses) {
  return agentStatuses.filter((agent) => (
    agent.installed
    && agent.npmInstalled
    && agent.npmUpdateAvailable
  ));
}

function formatAgentList(agents) {
  const labels = agents.map((agent) => agent.shortLabel || agent.label).filter(Boolean);

  if (labels.length <= 1) {
    return labels[0] || "terminal CLIs";
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function getAgentUpdateSummary(agents) {
  const updateLabels = agents.map((agent) => {
    const currentVersion = agent.npmPackageVersion && agent.npmPackageVersion !== "Detected"
      ? agent.npmPackageVersion
      : "installed";
    const latestVersion = agent.npmLatestVersion && agent.npmLatestVersion !== "Not checked"
      ? agent.npmLatestVersion
      : "latest";

    return `${agent.shortLabel || agent.label} ${currentVersion} -> ${latestVersion}`;
  });

  return updateLabels.join(" / ");
}

function cleanWorkspaceRootDirectory(value) {
  if (typeof value !== "string") {
    return "";
  }

  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const uncVerbatimMatch = cleaned.match(/^[\\/]{2}\?[\\/]UNC[\\/](.+)$/i);

  if (uncVerbatimMatch) {
    return collapseFunctionalRepoPathToCoreRepoPath(`\\\\${uncVerbatimMatch[1]}`.trim());
  }

  const driveVerbatimMatch = cleaned.match(/^[\\/]{2}\?[\\/]([a-z]:[\\/].*)$/i);

  if (driveVerbatimMatch) {
    return collapseFunctionalRepoPathToCoreRepoPath(driveVerbatimMatch[1].trim());
  }

  return collapseFunctionalRepoPathToCoreRepoPath(cleaned);
}

function isWindowsSystemRootDirectory(value) {
  const cleaned = cleanWorkspaceRootDirectory(value)
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "")
    .toLowerCase();

  return /^[a-z]:\/windows(?:\/(?:system32|syswow64)(?:\/.*)?)?$/.test(cleaned)
    || /^\/[a-z]\/windows(?:\/(?:system32|syswow64)(?:\/.*)?)?$/.test(cleaned);
}

function isFilesystemRootDirectory(value) {
  return cleanWorkspaceRootDirectory(value).replace(/\\/g, "/") === "/";
}

function isDisallowedWorkspaceRootDirectory(value) {
  return isFilesystemRootDirectory(value) || isWindowsSystemRootDirectory(value);
}

function normalizeWorkspaceTerminalCount(value) {
  const count = Number.parseInt(value, 10);

  if (!Number.isFinite(count)) {
    return MIN_WORKSPACE_TERMINAL_COUNT;
  }

  return Math.min(MAX_WORKSPACE_TERMINAL_COUNT, Math.max(MIN_WORKSPACE_TERMINAL_COUNT, count));
}

function getWorkspaceTerminalRoleIds(roleOptions = WORKSPACE_TERMINAL_ROLE_OPTIONS) {
  return new Set(roleOptions.map((role) => role.id));
}

function getWorkspaceTerminalRoleOptions(agentStatuses = DEFAULT_AGENT_STATUSES) {
  const installedAgentIds = new Set(
    (Array.isArray(agentStatuses) ? agentStatuses : [])
      .filter((agent) => agent.installed)
      .map((agent) => agent.id),
  );
  const options = WORKSPACE_TERMINAL_ROLE_OPTIONS.filter((option) => (
    option.id === WORKSPACE_TERMINAL_ROLE_GENERIC || installedAgentIds.has(option.id)
  ));

  return options.some((option) => option.id === WORKSPACE_TERMINAL_ROLE_GENERIC)
    ? options
    : WORKSPACE_TERMINAL_ROLE_OPTIONS.filter((option) => option.id === WORKSPACE_TERMINAL_ROLE_GENERIC);
}

function getWorkspaceTerminalFallbackRole(
  roleOptions = WORKSPACE_TERMINAL_ROLE_OPTIONS,
  fallback = "codex",
) {
  const roleIds = getWorkspaceTerminalRoleIds(roleOptions);
  const fallbackRole = String(fallback || "").toLowerCase().trim();

  if (roleIds.has(fallbackRole)) {
    return fallbackRole;
  }

  return roleOptions.find((option) => option.id !== WORKSPACE_TERMINAL_ROLE_GENERIC)?.id
    || WORKSPACE_TERMINAL_ROLE_GENERIC;
}

function normalizeWorkspaceTerminalRole(
  value,
  fallback = "codex",
  roleOptions = WORKSPACE_TERMINAL_ROLE_OPTIONS,
) {
  const roleId = String(value || "").toLowerCase().trim();
  const roleIds = getWorkspaceTerminalRoleIds(roleOptions);

  if (roleIds.has(roleId)) {
    return roleId;
  }

  return getWorkspaceTerminalFallbackRole(roleOptions, fallback);
}

function normalizeWorkspaceTerminalRoles(
  value,
  count,
  fallback = "codex",
  roleOptions = WORKSPACE_TERMINAL_ROLE_OPTIONS,
) {
  const terminalCount = normalizeWorkspaceTerminalCount(count);
  const fallbackRole = normalizeWorkspaceTerminalRole(fallback, "codex", roleOptions);
  const roles = Array.isArray(value) ? value : [];

  return Array.from(
    { length: terminalCount },
    (_, index) => normalizeWorkspaceTerminalRole(roles[index], fallbackRole, roleOptions),
  );
}

function areWorkspaceTerminalRolesEqual(leftRoles, rightRoles) {
  if (!Array.isArray(leftRoles) || !Array.isArray(rightRoles) || leftRoles.length !== rightRoles.length) {
    return false;
  }

  return leftRoles.every((role, index) => role === rightRoles[index]);
}

function getTerminalRoleOption(role, roleOptions = WORKSPACE_TERMINAL_ROLE_OPTIONS) {
  const roleId = normalizeWorkspaceTerminalRole(role, "codex", roleOptions);

  return roleOptions.find((option) => option.id === roleId)
    || roleOptions[0]
    || WORKSPACE_TERMINAL_ROLE_OPTIONS[0];
}

function getWorkspaceTerminalRoleCounts(roles, roleOptions = WORKSPACE_TERMINAL_ROLE_OPTIONS) {
  return roleOptions.map((option) => ({
    ...option,
    count: roles.filter((role) => role === option.id).length,
  }));
}

function getWorkspaceTerminalRoleCountMap(roles, roleOptions = WORKSPACE_TERMINAL_ROLE_OPTIONS) {
  return Object.fromEntries(
    getWorkspaceTerminalRoleCounts(roles, roleOptions).map((role) => [role.id, role.count]),
  );
}

function buildWorkspaceTerminalRolesFromCounts(
  counts,
  count,
  roleOptions = WORKSPACE_TERMINAL_ROLE_OPTIONS,
) {
  const terminalCount = normalizeWorkspaceTerminalCount(count);
  const nextRoles = [];

  roleOptions.forEach((option) => {
    const roleCount = Math.max(0, Math.min(terminalCount, Number.parseInt(counts?.[option.id], 10) || 0));

    for (let index = 0; index < roleCount && nextRoles.length < terminalCount; index += 1) {
      nextRoles.push(option.id);
    }
  });

  while (nextRoles.length < terminalCount) {
    nextRoles.push(WORKSPACE_TERMINAL_ROLE_GENERIC);
  }

  return nextRoles.slice(0, terminalCount);
}

function rebalanceWorkspaceTerminalRoleCounts(
  roles,
  targetRole,
  targetCount,
  count,
  roleOptions = WORKSPACE_TERMINAL_ROLE_OPTIONS,
) {
  const terminalCount = normalizeWorkspaceTerminalCount(count);
  const roleId = normalizeWorkspaceTerminalRole(targetRole, "codex", roleOptions);
  const counts = getWorkspaceTerminalRoleCountMap(
    normalizeWorkspaceTerminalRoles(roles, terminalCount, "codex", roleOptions),
    roleOptions,
  );
  const requestedCount = Math.max(0, Math.min(terminalCount, Number.parseInt(targetCount, 10) || 0));
  const previousCount = counts[roleId] || 0;
  const delta = requestedCount - previousCount;

  counts[roleId] = requestedCount;

  if (delta > 0) {
    let remaining = delta;
    const drainOrder = [
      WORKSPACE_TERMINAL_ROLE_GENERIC,
      ...roleOptions
        .filter((option) => option.id !== WORKSPACE_TERMINAL_ROLE_GENERIC)
        .map((option) => option.id)
        .reverse(),
    ].filter((otherRole) => otherRole !== roleId);

    drainOrder.forEach((otherRole) => {
      if (remaining <= 0) {
        return;
      }

      const removed = Math.min(counts[otherRole] || 0, remaining);
      counts[otherRole] = (counts[otherRole] || 0) - removed;
      remaining -= removed;
    });

    counts[roleId] -= remaining;
  } else if (delta < 0) {
    const recipientRole = roleId === WORKSPACE_TERMINAL_ROLE_GENERIC
      ? getWorkspaceTerminalFallbackRole(roleOptions, "codex")
      : WORKSPACE_TERMINAL_ROLE_GENERIC;
    counts[recipientRole] = (counts[recipientRole] || 0) + Math.abs(delta);
  }

  return buildWorkspaceTerminalRolesFromCounts(counts, terminalCount, roleOptions);
}

function getWorkspaceTerminalRoleSummaryText(roles, roleOptions = WORKSPACE_TERMINAL_ROLE_OPTIONS) {
  return getWorkspaceTerminalRoleCounts(roles, roleOptions)
    .filter((role) => role.count > 0)
    .map((role) => `${role.shortLabel} ${role.count}`)
    .join(" / ") || `${getTerminalRoleOption("codex", roleOptions).shortLabel} 1`;
}

function getWorkspaceTerminalPaneAgentId(role) {
  return normalizeWorkspaceTerminalRole(role, "codex");
}

function getReadyWorkspaceTerminalAgent(agentStatuses, role) {
  const roleId = normalizeWorkspaceTerminalRole(role, "codex");

  if (roleId === WORKSPACE_TERMINAL_ROLE_GENERIC) {
    return GENERIC_TERMINAL_AGENT;
  }

  return getReadyAgent(agentStatuses, roleId);
}

function TerminalLayoutMiniature({ count, roleOptions, roles = [] }) {
  const rows = getTerminalPanelRows(getDefaultTerminalIndexes(count));
  const fallbackRole = getWorkspaceTerminalFallbackRole(roleOptions);
  const previewRoles = normalizeWorkspaceTerminalRoles(roles, count, fallbackRole, roleOptions);

  return (
    <TerminalLayoutPreview aria-hidden="true">
      {rows.map((row) => (
        <TerminalLayoutPreviewRow
          key={`preview-row-${count}-${row.rowIndex}`}
          style={{ "--preview-columns": row.terminalIndexes.length }}
        >
          {row.terminalIndexes.map((terminalIndex) => (
            <TerminalLayoutPreviewCell
              data-slot={previewRoles[terminalIndex] || "codex"}
              key={`preview-cell-${count}-${terminalIndex}`}
            />
          ))}
        </TerminalLayoutPreviewRow>
      ))}
    </TerminalLayoutPreview>
  );
}

function WorkspaceTerminalCountPicker({ disabled = false, onChange, roleOptions, roles, value }) {
  const selectedCount = normalizeWorkspaceTerminalCount(value);

  return (
    <TerminalCountGrid aria-label="Terminal count">
      {WORKSPACE_TERMINAL_COUNT_OPTIONS.map((count) => (
        <TerminalCountButton
          aria-pressed={count === selectedCount}
          data-selected={count === selectedCount}
          disabled={disabled}
          key={count}
          onClick={() => onChange(String(count))}
          title={`${count} ${count === 1 ? "terminal" : "terminals"}`}
          type="button"
        >
          <TerminalCountMeta>
            <strong>{count}</strong>
            <span>{count === 1 ? "terminal" : "terminals"}</span>
          </TerminalCountMeta>
          <TerminalLayoutMiniature count={count} roleOptions={roleOptions} roles={roles} />
        </TerminalCountButton>
      ))}
    </TerminalCountGrid>
  );
}

function WorkspaceTerminalRolePicker({
  count,
  disabled = false,
  onChange,
  roleOptions = WORKSPACE_TERMINAL_ROLE_OPTIONS,
  value,
}) {
  const terminalCount = normalizeWorkspaceTerminalCount(count);
  const fallbackRole = getWorkspaceTerminalFallbackRole(roleOptions);
  const roles = normalizeWorkspaceTerminalRoles(value, terminalCount, fallbackRole, roleOptions);
  const roleCounts = getWorkspaceTerminalRoleCounts(roles, roleOptions);

  return (
    <>
      <TerminalRoleSummary aria-label="Terminal role counts">
        {roleCounts.map((role) => (
          <WorkspaceSettingsMetaPill key={role.id}>
            <span>{role.shortLabel}</span>
            <strong>{role.count}</strong>
          </WorkspaceSettingsMetaPill>
        ))}
      </TerminalRoleSummary>
      <TerminalRoleSliderGrid aria-label="Terminal role distribution">
        {roleCounts.map((role) => (
          <TerminalRoleSliderRow data-role={role.id} key={role.id}>
            <span>
              <strong>{role.label}</strong>
              <em>{role.count}</em>
            </span>
            <TerminalRoleRange
              aria-label={`${role.label} terminal count`}
              data-role={role.id}
              disabled={disabled}
              max={terminalCount}
              min="0"
              onChange={(event) => {
                onChange(rebalanceWorkspaceTerminalRoleCounts(
                  roles,
                  role.id,
                  event.target.value,
                  terminalCount,
                  roleOptions,
                ));
              }}
              type="range"
              value={role.count}
            />
          </TerminalRoleSliderRow>
        ))}
      </TerminalRoleSliderGrid>
    </>
  );
}

function normalizeWorkspaceSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([workspaceId, settings]) => {
        const cleanedRootDirectory = cleanWorkspaceRootDirectory(settings?.rootDirectory);
        const rootDirectory = isDisallowedWorkspaceRootDirectory(cleanedRootDirectory)
          ? ""
            : cleanedRootDirectory;
        const terminalCount = normalizeWorkspaceTerminalCount(settings?.terminalCount);
        const terminalRoles = normalizeWorkspaceTerminalRoles(settings?.terminalRoles, terminalCount);
        const hasCustomTerminalRoles = terminalRoles.some((role) => role !== "codex");

        if (!workspaceId || (!rootDirectory && terminalCount === MIN_WORKSPACE_TERMINAL_COUNT && !hasCustomTerminalRoles)) {
          return null;
        }

        return [
          workspaceId,
          {
            rootDirectory: rootDirectory.slice(0, MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH),
            terminalCount,
            terminalRoles,
          },
        ];
      })
      .filter(Boolean),
  );
}

function readWorkspaceSettings() {
  try {
    return normalizeWorkspaceSettings(
      JSON.parse(window.localStorage.getItem(WORKSPACE_SETTINGS_STORAGE_KEY) || "{}"),
    );
  } catch {
    return {};
  }
}

function persistWorkspaceSettings(settings) {
  try {
    window.localStorage.setItem(
      WORKSPACE_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalizeWorkspaceSettings(settings)),
    );
  } catch {
    // Workspace root settings are convenience state; the app can still run without persistence.
  }
}

function normalizeEnabledWorkspaceIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set();
  const ids = [];

  value.forEach((workspaceId) => {
    const id = String(workspaceId || "").trim();
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    ids.push(id);
  });

  return ids;
}

function normalizeWorkspaceLifecycleSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { defaultWorkspaceId: "", enabledWorkspaceIds: [] };
  }

  return {
    defaultWorkspaceId: typeof value.defaultWorkspaceId === "string"
      ? value.defaultWorkspaceId.trim()
      : "",
    enabledWorkspaceIds: normalizeEnabledWorkspaceIds(value.enabledWorkspaceIds),
  };
}

function readWorkspaceLifecycleSettings() {
  try {
    return normalizeWorkspaceLifecycleSettings(
      JSON.parse(window.localStorage.getItem(WORKSPACE_LIFECYCLE_STORAGE_KEY) || "{}"),
    );
  } catch {
    return { defaultWorkspaceId: "", enabledWorkspaceIds: [] };
  }
}

function persistWorkspaceLifecycleSettings(settings) {
  try {
    window.localStorage.setItem(
      WORKSPACE_LIFECYCLE_STORAGE_KEY,
      JSON.stringify(normalizeWorkspaceLifecycleSettings(settings)),
    );
  } catch {
    // Workspace lifecycle preferences are convenience state; default startup can remain manual.
  }
}

function readWorkspaceRailCollapsed() {
  try {
    const settings = JSON.parse(window.localStorage.getItem(WORKSPACE_RAIL_STORAGE_KEY) || "{}");
    return Boolean(settings?.collapsed);
  } catch {
    return false;
  }
}

function persistWorkspaceRailCollapsed(collapsed) {
  try {
    window.localStorage.setItem(
      WORKSPACE_RAIL_STORAGE_KEY,
      JSON.stringify({ collapsed: Boolean(collapsed) }),
    );
  } catch {
    // Rail density is a visual preference; the expanded layout remains the safe default.
  }
}

function normalizeAppTheme(value) {
  const theme = String(value || "").trim().toLowerCase();
  return theme === APP_THEME_LIGHT ? APP_THEME_LIGHT : APP_THEME_DEFAULT;
}

function normalizeAppAppearanceSettings(value) {
  if (typeof value === "string") {
    return { theme: normalizeAppTheme(value) };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { theme: APP_THEME_DEFAULT };
  }

  return {
    theme: normalizeAppTheme(value.theme),
  };
}

function readAppAppearanceSettings() {
  try {
    const rawSettings = window.localStorage.getItem(APP_APPEARANCE_STORAGE_KEY);
    if (!rawSettings) {
      return { theme: APP_THEME_DEFAULT };
    }

    return normalizeAppAppearanceSettings(JSON.parse(rawSettings));
  } catch {
    return { theme: APP_THEME_DEFAULT };
  }
}

function persistAppAppearanceSettings(settings) {
  try {
    window.localStorage.setItem(
      APP_APPEARANCE_STORAGE_KEY,
      JSON.stringify(normalizeAppAppearanceSettings(settings)),
    );
  } catch {
    // Appearance preferences are cosmetic; the dark default remains usable without persistence.
  }
}

function applyForgeThemePreference(theme) {
  if (typeof document === "undefined") {
    return normalizeAppTheme(theme);
  }

  const normalizedTheme = normalizeAppTheme(theme);
  document.documentElement.dataset.forgeTheme = normalizedTheme;
  if (document.body) {
    document.body.dataset.forgeTheme = normalizedTheme;
  }

  const themeColor = APP_THEME_META_COLORS[normalizedTheme] || APP_THEME_META_COLORS[APP_THEME_DEFAULT];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);

  return normalizedTheme;
}

function findWorkspaceById(workspaces, workspaceId) {
  return workspaces.find((workspace) => workspace.id === workspaceId) || null;
}

function graphText(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }
  const normalized = String(value).trim();
  return normalized || fallback;
}

function normalizeGraphWorkspacePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function graphSnapshotBody(snapshot) {
  return snapshot?.specGraph || snapshot?.knowledgeGraph || snapshot?.raw || {};
}

function graphSnapshotWorkspaceId(snapshot) {
  const graph = graphSnapshotBody(snapshot);
  return graphText(
    snapshot?.workspaceId
      || snapshot?.workspace_id
      || graph?.workspace_id
      || graph?.workspaceId,
  );
}

function graphSnapshotRepoPath(snapshot) {
  const graph = graphSnapshotBody(snapshot);
  return graphText(snapshot?.repoPath || snapshot?.repo_path || graph?.repo_path || graph?.repoPath);
}

function graphSnapshotSyncState(snapshot, fallback = "idle") {
  return graphText(snapshot?.syncState || snapshot?.sync_state, fallback);
}

function graphSnapshotSyncError(snapshot) {
  return graphText(snapshot?.syncError || snapshot?.sync_error);
}

function workspaceGraphStateKey(repoPath, workspaceId) {
  const normalizedWorkspaceId = graphText(workspaceId);
  const normalizedRepoPath = normalizeGraphWorkspacePath(repoPath);
  if (!normalizedWorkspaceId && !normalizedRepoPath) {
    return "";
  }
  return `${normalizedWorkspaceId}::${normalizedRepoPath}`;
}

function workspaceGraphSnapshotKey(snapshot) {
  return workspaceGraphStateKey(
    graphSnapshotRepoPath(snapshot),
    graphSnapshotWorkspaceId(snapshot),
  );
}

function getWorkspaceRailInitials(name) {
  const parts = String(name || "Workspace")
    .trim()
    .split(/[\s._-]+/)
    .filter(Boolean);

  if (parts.length >= 2) {
    return `${parts[0][0] || "W"}${parts[1][0] || ""}`.toUpperCase();
  }

  return (parts[0] || "W").slice(0, 2).toUpperCase();
}

function parseCssPixelValue(value) {
  const numericValue = Number.parseFloat(String(value || "").trim());
  return Number.isFinite(numericValue) ? numericValue : null;
}

function easeWorkspaceRailProgress(progress) {
  const clampedProgress = Math.max(0, Math.min(1, progress));
  return 1 - ((1 - clampedProgress) ** 3);
}

function getWorkspaceRootDirectory(workspaceSettings, workspaceId) {
  return cleanWorkspaceRootDirectory(workspaceSettings?.[workspaceId]?.rootDirectory);
}

function getWorkspaceThreadStoreTargets(workspaces, workspaceSettings, defaultWorkingDirectory) {
  if (!Array.isArray(workspaces) || !workspaces.length) {
    return [];
  }

  return workspaces
    .map((workspace) => {
      const workspaceId = String(workspace?.id || "").trim();
      if (!workspaceId) {
        return null;
      }
      const rootDirectory = (
        getWorkspaceRootDirectory(workspaceSettings, workspaceId)
        || cleanWorkspaceRootDirectory(defaultWorkingDirectory)
      );
      if (!rootDirectory) {
        return null;
      }
      return { rootDirectory, workspaceId };
    })
    .filter(Boolean);
}

function getWorkspaceThreadStoreKey(targets) {
  return JSON.stringify(
    targets.map((target) => [
      target.workspaceId,
      target.rootDirectory,
    ]),
  );
}

function getWorkspaceTerminalCount(workspaceSettings, workspaceId) {
  return normalizeWorkspaceTerminalCount(workspaceSettings?.[workspaceId]?.terminalCount);
}

function getWorkspaceTerminalRoles(
  workspaceSettings,
  workspaceId,
  count,
  fallback = "codex",
  roleOptions = WORKSPACE_TERMINAL_ROLE_OPTIONS,
) {
  return normalizeWorkspaceTerminalRoles(
    workspaceSettings?.[workspaceId]?.terminalRoles,
    count,
    fallback,
    roleOptions,
  );
}

function normalizeWorkspaceTerminalSlotIndexes(indexes) {
  const usedIndexes = new Set();

  if (!Array.isArray(indexes)) {
    return [];
  }

  return indexes.reduce((normalizedIndexes, index) => {
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

    return normalizedIndexes;
  }, []);
}

function getWorkspaceLogicalTerminalIndexes(workspaceTerminalLogicalIndexes, workspaceId, terminalCount) {
  if (Object.prototype.hasOwnProperty.call(workspaceTerminalLogicalIndexes || {}, workspaceId)) {
    return normalizeWorkspaceTerminalSlotIndexes(workspaceTerminalLogicalIndexes[workspaceId]);
  }

  return normalizeWorkspaceTerminalIndexes(undefined, terminalCount);
}

function flattenWorkspaceDisplayRows(rows) {
  return Array.isArray(rows)
    ? rows.flatMap((row) => (
      Array.isArray(row?.terminalIndexes)
        ? row.terminalIndexes
        : Array.isArray(row)
          ? row
          : []
    ))
    : [];
}

function normalizeWorkspaceDisplayTerminalRows(layoutRows, terminalIndexes) {
  const logicalIndexes = normalizeWorkspaceTerminalSlotIndexes(terminalIndexes);
  const logicalIndexSet = new Set(logicalIndexes);
  const usedIndexes = new Set();
  const rows = [];

  if (Array.isArray(layoutRows)) {
    layoutRows.forEach((row) => {
      const rowIndexes = Array.isArray(row?.terminalIndexes)
        ? row.terminalIndexes
        : Array.isArray(row)
          ? row
          : [];
      const normalizedRow = [];

      rowIndexes.forEach((index) => {
        const terminalIndex = Number.parseInt(index, 10);
        if (
          Number.isInteger(terminalIndex)
          && logicalIndexSet.has(terminalIndex)
          && !usedIndexes.has(terminalIndex)
        ) {
          usedIndexes.add(terminalIndex);
          normalizedRow.push(terminalIndex);
        }
      });

      if (normalizedRow.length) {
        rows.push(normalizedRow);
      }
    });
  }

  const missingIndexes = logicalIndexes.filter((terminalIndex) => !usedIndexes.has(terminalIndex));
  if (missingIndexes.length) {
    getTerminalPanelRows(missingIndexes).forEach((row) => {
      if (row.terminalIndexes.length) {
        rows.push(row.terminalIndexes);
      }
    });
  }

  const normalizedRows = rows.length
    ? rows
    : getTerminalPanelRows(logicalIndexes).map((row) => row.terminalIndexes);

  return normalizedRows.map((terminalIndexes, rowIndex) => ({
    rowIndex,
    terminalIndexes,
  }));
}

function getWorkspaceDisplayTerminalRows(workspaceTerminalDisplayLayouts, workspaceId, logicalTerminalIndexes) {
  return normalizeWorkspaceDisplayTerminalRows(
    workspaceId ? workspaceTerminalDisplayLayouts?.[workspaceId] : null,
    logicalTerminalIndexes,
  );
}

function getDefaultWorkspaceDisplayTerminalRows(logicalTerminalIndexes) {
  return getTerminalPanelRows(logicalTerminalIndexes).map((row) => row.terminalIndexes);
}

function insertLogicalTerminalInDisplayRows(rows, sourceTerminalIndex, newTerminalIndex, direction) {
  const nextRows = normalizeWorkspaceDisplayTerminalRows(rows, flattenWorkspaceDisplayRows(rows))
    .map((row) => row.terminalIndexes.slice());
  const rowIndex = nextRows.findIndex((row) => row.includes(sourceTerminalIndex));

  if (rowIndex < 0) {
    nextRows.push([newTerminalIndex]);
    return nextRows;
  }

  if (direction === "vertical") {
    const columnIndex = nextRows[rowIndex].indexOf(sourceTerminalIndex);
    nextRows[rowIndex].splice(columnIndex + 1, 0, newTerminalIndex);
    return nextRows;
  }

  nextRows.splice(rowIndex + 1, 0, [newTerminalIndex]);
  return nextRows;
}

function removeLogicalTerminalFromDisplayRows(rows, terminalIndex) {
  return normalizeWorkspaceDisplayTerminalRows(rows, flattenWorkspaceDisplayRows(rows))
    .map((row) => row.terminalIndexes.filter((index) => index !== terminalIndex))
    .filter((row) => row.length);
}

function getWorkspaceDisplayRowValues(rows) {
  return normalizeWorkspaceDisplayTerminalRows(rows, flattenWorkspaceDisplayRows(rows))
    .map((row) => row.terminalIndexes.slice());
}

function areWorkspaceDisplayRowsEqual(leftRows, rightRows) {
  const leftValues = getWorkspaceDisplayRowValues(leftRows);
  const rightValues = getWorkspaceDisplayRowValues(rightRows);

  return leftValues.length === rightValues.length
    && leftValues.every((leftRow, rowIndex) => (
      leftRow.length === rightValues[rowIndex].length
      && leftRow.every((terminalIndex, columnIndex) => terminalIndex === rightValues[rowIndex][columnIndex])
    ));
}

function updateWorkspaceLocalSettings(settings, workspaceId, nextValues = {}) {
  const nextSettings = { ...(settings || {}) };

  if (!workspaceId) {
    return nextSettings;
  }

  const currentSettings = settings?.[workspaceId] || {};
  const hasRootDirectory = Object.prototype.hasOwnProperty.call(nextValues, "rootDirectory");
  const hasTerminalCount = Object.prototype.hasOwnProperty.call(nextValues, "terminalCount");
  const hasTerminalRoles = Object.prototype.hasOwnProperty.call(nextValues, "terminalRoles");
  const cleanedRootDirectory = cleanWorkspaceRootDirectory(
    hasRootDirectory ? nextValues.rootDirectory : currentSettings.rootDirectory,
  ).slice(0, MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH);
  const rootDirectory = isDisallowedWorkspaceRootDirectory(cleanedRootDirectory)
    ? ""
    : cleanedRootDirectory;
  const terminalCount = normalizeWorkspaceTerminalCount(
    hasTerminalCount ? nextValues.terminalCount : currentSettings.terminalCount,
  );
  const fallbackRole = currentSettings.terminalRoles?.[0] || "codex";
  const terminalRoles = normalizeWorkspaceTerminalRoles(
    hasTerminalRoles ? nextValues.terminalRoles : currentSettings.terminalRoles,
    terminalCount,
    fallbackRole,
  );
  const hasCustomTerminalRoles = terminalRoles.some((role) => role !== "codex");

  if (!rootDirectory && terminalCount === MIN_WORKSPACE_TERMINAL_COUNT && !hasCustomTerminalRoles) {
    delete nextSettings[workspaceId];
    return nextSettings;
  }

  nextSettings[workspaceId] = {
    rootDirectory,
    terminalCount,
    terminalRoles,
  };

  return nextSettings;
}

export default function App() {
  if (window.location.hash === AUDIO_WIDGET_HASH) {
    return <AudioWidgetWindow />;
  }

  const {
    status: authState,
    message: authMessage,
    error: authError,
    user,
  } = useAuthSnapshot();
  const [apiState, setApiState] = useState("checking");
  const [apiMessage, setApiMessage] = useState("Checking connection");
  const [activeView, setActiveView] = useState(DEFAULT_WORKSPACE_VIEW);
  const [visibleView, setVisibleView] = useState(DEFAULT_WORKSPACE_VIEW);
  const [viewMotion, setViewMotion] = useState("entered");
  const [activeAgent, setActiveAgent] = useState("codex");
  const [agentStatuses, setAgentStatuses] = useState(readCachedAgentStatuses);
  const [agentStatusState, setAgentStatusState] = useState("idle");
  const [agentStatusError, setAgentStatusError] = useState("");
  const [startupAgentGateState, setStartupAgentGateState] = useState("idle");
  const [startupAgentUpdateMessage, setStartupAgentUpdateMessage] = useState("");
  const [agentInstallState, setAgentInstallState] = useState({});
  const [agentInstallResults, setAgentInstallResults] = useState({});
  const [agentDisconnectState, setAgentDisconnectState] = useState({});
  const [agentActionResults, setAgentActionResults] = useState({});
  const [audioModelStatus, setAudioModelStatus] = useState(null);
  const [audioStatusState, setAudioStatusState] = useState("idle");
  const [audioActionState, setAudioActionState] = useState("idle");
  const [audioError, setAudioError] = useState("");
  const [audioDownloadProgress, setAudioDownloadProgress] = useState(null);
  const [audioWidgetVisible, setAudioWidgetVisible] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceGraphState, setWorkspaceGraphState] = useState({});
  const [pendingSpecEditIntents, setPendingSpecEditIntents] = useState({});
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [workspaceSyncState, setWorkspaceSyncState] = useState("idle");
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [workspaceTerminalCountDraft, setWorkspaceTerminalCountDraft] = useState("1");
  const [workspaceTerminalRolesDraft, setWorkspaceTerminalRolesDraft] = useState(["codex"]);
  const [workspaceSettings, setWorkspaceSettings] = useState(readWorkspaceSettings);
  const [workspaceThreads, setWorkspaceThreads] = useState(readWorkspaceThreads);
  const [workspaceThreadsHydratedKey, setWorkspaceThreadsHydratedKey] = useState("");
  const [workspaceNotifications, setWorkspaceNotifications] = useState(readWorkspaceNotifications);
  const [workspaceNotificationHighlights, setWorkspaceNotificationHighlights] = useState({});
  const [workspaceLifecycleSettings, setWorkspaceLifecycleSettings] = useState(readWorkspaceLifecycleSettings);
  const [workspaceRailCollapsed, setWorkspaceRailCollapsed] = useState(readWorkspaceRailCollapsed);
  const [appAppearanceSettings, setAppAppearanceSettings] = useState(readAppAppearanceSettings);
  const [workspaceTerminalLogicalIndexes, setWorkspaceTerminalLogicalIndexes] = useState({});
  const [workspaceTerminalDisplayLayouts, setWorkspaceTerminalDisplayLayouts] = useState({});
  const [workspaceRootDraft, setWorkspaceRootDraft] = useState("");
  const [workspaceSettingsState, setWorkspaceSettingsState] = useState("idle");
  const [workspaceSettingsError, setWorkspaceSettingsError] = useState("");
  const [workspaceSettingsMessage, setWorkspaceSettingsMessage] = useState("");
  const [workspaceSettingsModalId, setWorkspaceSettingsModalId] = useState("");
  const [crashRecoveryModal, setCrashRecoveryModal] = useState(null);
  const [activatedWorkspaceId, setActivatedWorkspaceId] = useState("");
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = useState("");
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isLaunchScreenVisible, setLaunchScreenVisible] = useState(true);
  const [workspaceState, setWorkspaceState] = useState("idle");
  const [workspaceAgentLaunchEpoch, setWorkspaceAgentLaunchEpoch] = useState(0);
  const [preparedTerminalVersion, setPreparedTerminalVersion] = useState(0);
  const [workspaceAgentBatchSentKey, setWorkspaceAgentBatchSentKey] = useState("");
  const [windowFrameState, setWindowFrameState] = useState(WINDOW_FRAME_STATE_DEFAULT);
  const [workspaceCloseState, setWorkspaceCloseState] = useState(WORKSPACE_CLOSE_INITIAL_STATE);
  const [workspaceDeactivationState, setWorkspaceDeactivationState] = useState(WORKSPACE_DEACTIVATION_INITIAL_STATE);
  const authStartupFinishedRef = useRef(false);
  const authFlowIdRef = useRef(0);
  const launchStartedAtRef = useRef(Date.now());
  const dashboardShellRef = useRef(null);
  const workspaceRailRef = useRef(null);
  const workspaceRailAnimationFrameRef = useRef(0);
  const viewTransitionTimeoutRef = useRef(null);
  const agentStatusCacheHitRef = useRef(agentStatuses.some((agent) => agent.cached));
  const agentInitialStatusUserRef = useRef("");
  const startupAgentFlowIdRef = useRef(0);
  const startupAgentSettingsPendingRef = useRef(false);
  const audioAutoOpenStartupKeyRef = useRef("");
  const selectedWorkspaceIdRef = useRef("");
  const activatedWorkspaceIdRef = useRef("");
  const workspacesRef = useRef(workspaces);
  const workspaceSettingsRef = useRef(workspaceSettings);
  const defaultWorkingDirectoryRef = useRef(defaultWorkingDirectory);
  const workspaceThreadsRef = useRef(workspaceThreads);
  const workspaceNotificationCueIdsRef = useRef(new Set());
  const workspaceNotificationHighlightTimersRef = useRef(new Map());
  const workspaceNotificationSfxRef = useRef(null);
  const workspaceNotificationSnapshotKeyRef = useRef("");
  const workspaceThreadsHydratedKeyRef = useRef("");
  const workspaceThreadsPersistenceReadyRef = useRef(false);
  const workspaceThreadTranscriptRequestsRef = useRef(new Map());
  const workspacePendingPromptDeliveriesRef = useRef(new Map());
  const workspaceTerminalLogicalIndexesRef = useRef(workspaceTerminalLogicalIndexes);
  const workspaceTerminalDisplayLayoutsRef = useRef(workspaceTerminalDisplayLayouts);
  const workspaceLifecycleSettingsRef = useRef(workspaceLifecycleSettings);
  const workspaceAgentLaunchKeyRef = useRef("");
  const preparedTerminalsRef = useRef(new Map());
  const crashRecoveryScanRef = useRef(false);
  const workspaceAgentBatchInFlightKeyRef = useRef("");
  const workspaceCloseInFlightRef = useRef(false);
  const workspaceCloseExpectedTotalRef = useRef(0);
  const sharedMcpActiveRepoRef = useRef("");
  const workspaceMcpStartupIndexKeysRef = useRef(new Set());
  const workspaceDeactivationInFlightRef = useRef("");
  const workspaceRuntimeDeactivatedRepoRef = useRef("");
  const agentInstallationSyncKeyRef = useRef("");
  const workspaceTerminalRoleOptions = useMemo(
    () => getWorkspaceTerminalRoleOptions(agentStatuses),
    [agentStatuses],
  );
  const workspaceTerminalFallbackRole = getWorkspaceTerminalFallbackRole(
    workspaceTerminalRoleOptions,
    activeAgent,
  );
  const workspaceNotificationRoots = useMemo(() => (
    workspaces
      .map((workspace) => {
        const workspaceId = String(workspace?.id || "").trim();
        if (!workspaceId) {
          return null;
        }
        const rootDirectory = (
          getWorkspaceRootDirectory(workspaceSettings, workspaceId)
          || cleanWorkspaceRootDirectory(defaultWorkingDirectory)
        );
        return rootDirectory ? { rootDirectory, workspaceId } : null;
      })
      .filter(Boolean)
  ), [defaultWorkingDirectory, workspaceSettings, workspaces]);
  const workspaceNotificationSummaries = useMemo(
    () => getWorkspaceNotificationSummaries(workspaceNotifications, workspaceThreads),
    [workspaceNotifications, workspaceThreads],
  );
  const workspaceThreadStoreTargets = useMemo(
    () => getWorkspaceThreadStoreTargets(workspaces, workspaceSettings, defaultWorkingDirectory),
    [defaultWorkingDirectory, workspaceSettings, workspaces],
  );
  const workspaceThreadStoreKey = useMemo(
    () => getWorkspaceThreadStoreKey(workspaceThreadStoreTargets),
    [workspaceThreadStoreTargets],
  );
  const workspaceThreadsHydrated = workspaceThreadsHydratedKey === workspaceThreadStoreKey;
  const workspaceCloseAllowNativeRef = useRef(false);

  const setWorkspaceGraphStatus = useCallback((repoPath, workspaceId, statusPatch) => {
    const key = workspaceGraphStateKey(repoPath, workspaceId);
    if (!key) return;
    setWorkspaceGraphState((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        repoPath,
        workspaceId,
        ...statusPatch,
      },
    }));
  }, []);

  const applyWorkspaceGraphSnapshot = useCallback((kind, repoPath, workspaceId, snapshot) => {
    if (!snapshot || typeof snapshot !== "object") return;
    const snapshotRepoPath = graphSnapshotRepoPath(snapshot);
    const snapshotWorkspaceId = graphSnapshotWorkspaceId(snapshot);
    const key = workspaceGraphStateKey(
      repoPath || snapshotRepoPath,
      workspaceId || snapshotWorkspaceId,
    ) || workspaceGraphSnapshotKey(snapshot);
    if (!key) return;

    const snapshotKey = kind === "knowledge" ? "knowledgeSnapshot" : "specSnapshot";
    const stateKey = kind === "knowledge" ? "knowledgeState" : "specState";
    const errorKey = kind === "knowledge" ? "knowledgeError" : "specError";
    const updatedAtKey = kind === "knowledge" ? "knowledgeUpdatedAt" : "specUpdatedAt";
    const fallbackState = kind === "knowledge" ? "local" : "empty";

    setWorkspaceGraphState((current) => {
      const keysToUpdate = new Set([key]);
      const eventRepoPath = normalizeGraphWorkspacePath(snapshotRepoPath);
      if (!repoPath && !workspaceId && eventRepoPath) {
        Object.entries(current).forEach(([entryKey, entry]) => {
          if (normalizeGraphWorkspacePath(entry?.repoPath) === eventRepoPath) {
            keysToUpdate.add(entryKey);
          }
        });
      }

      const next = { ...current };
      keysToUpdate.forEach((entryKey) => {
        const previous = current[entryKey] || {};
        next[entryKey] = {
          ...previous,
          repoPath: repoPath || previous.repoPath || snapshotRepoPath,
          workspaceId: workspaceId || previous.workspaceId || snapshotWorkspaceId,
          [snapshotKey]: snapshot,
          [stateKey]: graphSnapshotSyncState(snapshot, fallbackState),
          [errorKey]: graphSnapshotSyncError(snapshot),
          [updatedAtKey]: Date.now(),
        };
      });
      return next;
    });
  }, []);

  useEffect(() => {
    clearWorkspaceThreadsBrowserPersistence();
  }, []);

  useEffect(() => {
    let disposed = false;
    const unlisteners = [];

    const attach = (eventName, kind) => {
      listen(eventName, (event) => {
        if (disposed) return;
        applyWorkspaceGraphSnapshot(kind, "", "", event?.payload);
      }).then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      });
    };

    attach(SPEC_GRAPH_CACHE_EVENT, "spec");
    attach(KNOWLEDGE_GRAPH_CACHE_EVENT, "knowledge");

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [applyWorkspaceGraphSnapshot]);

  useEffect(() => {
    const targets = workspaceThreadStoreTargets;
    const storeKey = workspaceThreadStoreKey;

    if (!targets.length) {
      workspaceThreadsHydratedKeyRef.current = storeKey;
      workspaceThreadsPersistenceReadyRef.current = Boolean(workspaces.length === 0);
      setWorkspaceThreadsHydratedKey(storeKey);
      return undefined;
    }

    if (workspaceThreadsHydratedKeyRef.current === storeKey) {
      workspaceThreadsPersistenceReadyRef.current = true;
      setWorkspaceThreadsHydratedKey(storeKey);
      return undefined;
    }

    let disposed = false;
    workspaceThreadsPersistenceReadyRef.current = false;
    setWorkspaceThreadsHydratedKey((currentKey) => (currentKey === storeKey ? currentKey : ""));

    invoke("workspace_threads_read", {
      request: { workspaces: targets },
    })
      .then((result) => {
        if (disposed) {
          return;
        }
        const loadedThreads = normalizeWorkspaceThreads(result?.threads || {}, {
          stripLiveBindings: true,
          stripMessages: true,
        });
        const targetIds = new Set(targets.map((target) => target.workspaceId));
        setWorkspaceThreads((currentThreads) => {
          const normalizedCurrent = normalizeWorkspaceThreads(currentThreads);
          let mergedThreads = Object.fromEntries(
            Object.entries(normalizedCurrent).filter(([workspaceId]) => targetIds.has(workspaceId)),
          );
          targets.forEach((target) => {
            if (loadedThreads[target.workspaceId]) {
              mergedThreads[target.workspaceId] = loadedThreads[target.workspaceId];
            }
          });
          workspaces.forEach((workspace) => {
            if (!targetIds.has(workspace.id)) {
              return;
            }
            const terminalCount = getWorkspaceTerminalCount(workspaceSettings, workspace.id);
            const terminalIndexes = getWorkspaceLogicalTerminalIndexes(
              workspaceTerminalLogicalIndexes,
              workspace.id,
              terminalCount,
            );
            const terminalRoles = getWorkspaceTerminalRoles(
              workspaceSettings,
              workspace.id,
              terminalCount,
              workspaceTerminalFallbackRole,
              workspaceTerminalRoleOptions,
            );
            const rolesByIndex = Object.fromEntries(terminalIndexes.map((terminalIndex, index) => ([
              terminalIndex,
              normalizeWorkspaceTerminalRole(
                terminalRoles[index] || terminalRoles[terminalIndex],
                workspaceTerminalFallbackRole,
                workspaceTerminalRoleOptions,
              ),
            ])));
            mergedThreads = ensureWorkspaceThreadsForTerminalIndexes(mergedThreads, {
              fallbackAgent: workspaceTerminalFallbackRole,
              rolesByIndex,
              terminalIndexes,
              workspaceId: workspace.id,
            });
          });
          return mergedThreads;
        });
        workspaceThreadsHydratedKeyRef.current = storeKey;
        workspaceThreadsPersistenceReadyRef.current = true;
        setWorkspaceThreadsHydratedKey(storeKey);
      })
      .catch((error) => {
        if (disposed) {
          return;
        }
        workspaceThreadsHydratedKeyRef.current = storeKey;
        workspaceThreadsPersistenceReadyRef.current = true;
        setWorkspaceThreadsHydratedKey(storeKey);
        logThreadBridgeDiagnosticEvent("frontend.workspace_threads_sqlite_read.failed", {
          message: getErrorMessage(error, "Unable to load workspace threads from SQLite."),
          workspaceCount: targets.length,
        });
      });

    return () => {
      disposed = true;
    };
  }, [
    workspaceThreadStoreKey,
    workspaceThreadStoreTargets,
    workspaceSettings,
    workspaceTerminalFallbackRole,
    workspaceTerminalLogicalIndexes,
    workspaceTerminalRoleOptions,
    workspaces,
  ]);

  useEffect(() => {
    if (!workspaces.length) {
      return;
    }

    setWorkspaceThreads((currentThreads) => {
      let nextThreads = currentThreads;

      workspaces.forEach((workspace) => {
        const terminalCount = getWorkspaceTerminalCount(workspaceSettings, workspace.id);
        const terminalIndexes = getWorkspaceLogicalTerminalIndexes(
          workspaceTerminalLogicalIndexes,
          workspace.id,
          terminalCount,
        );
        const terminalRoles = getWorkspaceTerminalRoles(
          workspaceSettings,
          workspace.id,
          terminalCount,
          workspaceTerminalFallbackRole,
          workspaceTerminalRoleOptions,
        );
        const rolesByIndex = Object.fromEntries(terminalIndexes.map((terminalIndex, index) => ([
          terminalIndex,
          normalizeWorkspaceTerminalRole(
            terminalRoles[index] || terminalRoles[terminalIndex],
            workspaceTerminalFallbackRole,
            workspaceTerminalRoleOptions,
          ),
        ])));

        nextThreads = ensureWorkspaceThreadsForTerminalIndexes(nextThreads, {
          fallbackAgent: workspaceTerminalFallbackRole,
          rolesByIndex,
          terminalIndexes,
          workspaceId: workspace.id,
        });
      });

      return nextThreads;
    });
  }, [
    workspaceSettings,
    workspaceTerminalFallbackRole,
    workspaceTerminalLogicalIndexes,
    workspaceTerminalRoleOptions,
    workspaces,
  ]);

  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
  }, [selectedWorkspaceId]);

  useEffect(() => {
    activatedWorkspaceIdRef.current = activatedWorkspaceId;
  }, [activatedWorkspaceId]);

  useEffect(() => {
    workspacesRef.current = workspaces;
  }, [workspaces]);

  useEffect(() => {
    workspaceSettingsRef.current = workspaceSettings;
  }, [workspaceSettings]);

  useEffect(() => {
    defaultWorkingDirectoryRef.current = defaultWorkingDirectory;
  }, [defaultWorkingDirectory]);

  useEffect(() => {
    workspaceThreadsRef.current = workspaceThreads;
    if (!workspaceThreadsPersistenceReadyRef.current) {
      return;
    }

    const targets = getWorkspaceThreadStoreTargets(
      workspaces,
      workspaceSettings,
      defaultWorkingDirectory,
    );
    const storeKey = getWorkspaceThreadStoreKey(targets);
    if (!targets.length || workspaceThreadsHydratedKeyRef.current !== storeKey) {
      return;
    }

    const normalizedThreads = persistWorkspaceThreads(workspaceThreads);
    const workspacesToPersist = targets
      .filter((target) => Boolean(normalizedThreads[target.workspaceId]))
      .map((target) => ({
        rootDirectory: target.rootDirectory,
        state: normalizedThreads[target.workspaceId],
        workspaceId: target.workspaceId,
      }));

    if (!workspacesToPersist.length) {
      return;
    }

    invoke("workspace_threads_persist", {
      request: { workspaces: workspacesToPersist },
    }).catch((error) => {
      logThreadBridgeDiagnosticEvent("frontend.workspace_threads_sqlite_persist.failed", {
        message: getErrorMessage(error, "Unable to persist workspace threads to SQLite."),
        workspaceCount: workspacesToPersist.length,
      });
    });
  }, [
    defaultWorkingDirectory,
    workspaceSettings,
    workspaceThreads,
    workspaces,
  ]);

  useEffect(() => {
    persistWorkspaceNotifications(workspaceNotifications);
  }, [workspaceNotifications]);

  useEffect(() => {
    const sfx = createWorkspaceNotificationSfx();
    workspaceNotificationSfxRef.current = sfx;
    const unlock = () => {
      sfx.unlock();
    };

    window.addEventListener("keydown", unlock, { passive: true });
    window.addEventListener("pointerdown", unlock, { passive: true });

    return () => {
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("pointerdown", unlock);
      sfx.dispose();
      if (workspaceNotificationSfxRef.current === sfx) {
        workspaceNotificationSfxRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const cues = Array.isArray(workspaceNotifications.cues) ? workspaceNotifications.cues : [];
    cues.forEach((cue) => {
      if (!cue?.id || workspaceNotificationCueIdsRef.current.has(cue.id)) {
        return;
      }
      workspaceNotificationCueIdsRef.current.add(cue.id);
      workspaceNotificationSfxRef.current?.play(cue.kind);
      const cueWorkspaceId = String(cue.workspaceId || "").trim();
      if (cueWorkspaceId) {
        const existingTimer = workspaceNotificationHighlightTimersRef.current.get(cueWorkspaceId);
        if (existingTimer) {
          window.clearTimeout(existingTimer);
        }
        setWorkspaceNotificationHighlights((current) => ({
          ...current,
          [cueWorkspaceId]: cue.id,
        }));
        const timer = window.setTimeout(() => {
          workspaceNotificationHighlightTimersRef.current.delete(cueWorkspaceId);
          setWorkspaceNotificationHighlights((current) => {
            if (current[cueWorkspaceId] !== cue.id) {
              return current;
            }
            const next = { ...current };
            delete next[cueWorkspaceId];
            return next;
          });
        }, 820);
        workspaceNotificationHighlightTimersRef.current.set(cueWorkspaceId, timer);
      }
    });
    if (workspaceNotificationCueIdsRef.current.size > 200) {
      workspaceNotificationCueIdsRef.current = new Set(
        Array.from(workspaceNotificationCueIdsRef.current).slice(-120),
      );
    }
  }, [workspaceNotifications.cues]);

  useEffect(() => () => {
    workspaceNotificationHighlightTimersRef.current.forEach((timer) => {
      window.clearTimeout(timer);
    });
    workspaceNotificationHighlightTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!selectedWorkspaceId) {
      return;
    }

    setWorkspaceNotifications((current) => markWorkspaceNotificationsSeen(current, selectedWorkspaceId));
  }, [selectedWorkspaceId]);

  useEffect(() => {
    const snapshotTargets = workspaceNotificationRoots.filter((entry) => (
      entry?.workspaceId && entry?.rootDirectory
    ));
    const snapshotKey = JSON.stringify(snapshotTargets.map((entry) => [
      entry.workspaceId,
      normalizeWorkspaceNotificationPath(entry.rootDirectory),
    ]));
    if (!snapshotTargets.length || workspaceNotificationSnapshotKeyRef.current === snapshotKey) {
      return undefined;
    }

    workspaceNotificationSnapshotKeyRef.current = snapshotKey;
    let cancelled = false;

    snapshotTargets.forEach((target) => {
      invoke("coordination_get_snapshot", {
        dbPath: null,
        repoPath: target.rootDirectory,
      }).then((response) => {
        if (cancelled) return;
        const snapshot = response?.data && typeof response.data === "object"
          ? response.data
          : response;
        setWorkspaceNotifications((current) => reconcileWorkspaceNotificationSnapshot(
          current,
          target.workspaceId,
          snapshot,
          {
            selectedWorkspaceId: selectedWorkspaceIdRef.current,
            suppressCue: true,
          },
        ));
      }).catch(() => {
        // Snapshot reconciliation is opportunistic; live events still keep the rail responsive.
      });
    });

    return () => {
      cancelled = true;
    };
  }, [workspaceNotificationRoots]);

  useEffect(() => {
    let unlistenNotification = null;
    let cancelled = false;

    listen(WORKSPACE_NOTIFICATION_EVENT, (notificationEvent) => {
      const payload = notificationEvent?.payload || {};
      const workspaceId = resolveWorkspaceIdForNotificationEvent(
        payload,
        workspaceNotificationRoots,
      );
      if (!workspaceId) {
        return;
      }
      setWorkspaceNotifications((current) => reduceWorkspaceNotificationEvent(
        current,
        {
          ...payload,
          workspaceId,
        },
        {
          selectedWorkspaceId: selectedWorkspaceIdRef.current,
          workspaceId,
        },
      ));
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenNotification = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (typeof unlistenNotification === "function") {
        unlistenNotification();
      }
    };
  }, [workspaceNotificationRoots]);

  useEffect(() => {
    let unlistenParkedPrompt = null;
    let cancelled = false;

    listen(TERMINAL_PARKED_PROMPT_EVENT, (parkedEvent) => {
      const payload = parkedEvent?.payload || {};
      const workspaceId = activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current;
      if (!workspaceId) {
        return;
      }
      setWorkspaceNotifications((current) => reduceTerminalParkedNotificationEvent(
        current,
        {
          ...payload,
          workspaceId,
        },
        {
          selectedWorkspaceId: selectedWorkspaceIdRef.current,
          workspaceId,
        },
      ));
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenParkedPrompt = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (typeof unlistenParkedPrompt === "function") {
        unlistenParkedPrompt();
      }
    };
  }, []);

  useEffect(() => {
    workspaceTerminalLogicalIndexesRef.current = workspaceTerminalLogicalIndexes;
  }, [workspaceTerminalLogicalIndexes]);

  useEffect(() => {
    workspaceTerminalDisplayLayoutsRef.current = workspaceTerminalDisplayLayouts;
  }, [workspaceTerminalDisplayLayouts]);

  useEffect(() => {
    workspaceLifecycleSettingsRef.current = workspaceLifecycleSettings;
  }, [workspaceLifecycleSettings]);

  useEffect(() => {
    applyForgeThemePreference(appAppearanceSettings.theme);
  }, [appAppearanceSettings.theme]);

  useEffect(() => {
    if (!agentStatusCacheHitRef.current) {
      return;
    }

  }, []);

  useEffect(() => {
    let unlistenDownloadProgress = null;
    let cancelled = false;

    listen(AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT, (progressEvent) => {
      setAudioDownloadProgress(progressEvent.payload);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }

      unlistenDownloadProgress = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenDownloadProgress) {
        unlistenDownloadProgress();
      }
    };
  }, []);

  useEffect(() => {
    let unlistenVisibility = null;
    let cancelled = false;

    const syncAudioWidgetVisibility = async () => {
      try {
        const visibility = await invoke("audio_widget_status");
        if (!cancelled) {
          setAudioWidgetVisible(Boolean(visibility?.visible));
        }
      } catch {
        if (!cancelled) {
          setAudioWidgetVisible(false);
        }
      }
    };

    syncAudioWidgetVisibility();
    listen(AUDIO_WIDGET_VISIBILITY_CHANGED_EVENT, (visibilityEvent) => {
      setAudioWidgetVisible(Boolean(visibilityEvent.payload?.visible));
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }

      unlistenVisibility = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenVisibility) {
        unlistenVisibility();
      }
    };
  }, []);
  const selectedWorkspace = findWorkspaceById(workspaces, selectedWorkspaceId);
  const activatedWorkspace = findWorkspaceById(workspaces, activatedWorkspaceId);

  const applyWindowFrameState = useCallback((nextFrameState) => {
    setWindowFrameState((currentFrameState) => (
      currentFrameState.isFullscreen === nextFrameState.isFullscreen
        && currentFrameState.isMaximized === nextFrameState.isMaximized
        ? currentFrameState
        : nextFrameState
    ));
  }, []);

  const refreshWindowFrameState = useCallback(async (appWindow = getSafeCurrentWindow()) => {
    if (!appWindow) {
      return null;
    }

    try {
      const nextFrameState = await readWindowFrameState(appWindow);

      if (!nextFrameState) {
        return null;
      }

      applyWindowFrameState(nextFrameState);
      return nextFrameState;
    } catch {
      return null;
    }
  }, [applyWindowFrameState]);

  const setSignedOut = useCallback((
    message = DEFAULT_AUTH_MESSAGE,
    error = "",
    options = {},
  ) => {
    authStore.setSignedOut({
      message,
      error,
      clearSession: options.clearSession !== false,
      clearPending: options.clearPending === true,
    });
    setActiveView(DEFAULT_WORKSPACE_VIEW);
    setVisibleView(DEFAULT_WORKSPACE_VIEW);
    setViewMotion("entered");
    setWorkspaceState("idle");
    setWorkspaces([]);
    setSelectedWorkspaceId("");
    setActivatedWorkspaceId("");
    setWorkspaceSyncState("idle");
    setWorkspaceName("");
    setWorkspaceNameDraft("");
    setWorkspaceTerminalCountDraft("1");
    setWorkspaceTerminalRolesDraft(["codex"]);
    setWorkspaceRootDraft("");
    setWorkspaceSettingsState("idle");
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
    setWorkspaceSettingsModalId("");
    setWorkspaceTerminalLogicalIndexes({});
    setWorkspaceTerminalDisplayLayouts({});
    agentInitialStatusUserRef.current = "";
    startupAgentFlowIdRef.current += 1;
    startupAgentSettingsPendingRef.current = false;
    setStartupAgentGateState("idle");
    setStartupAgentUpdateMessage("");
    setWorkspaceError("");
  }, []);

  const setAuthenticated = useCallback((sessionUser) => {
    const isPaid = isPaidUser(sessionUser);

    authStore.setAuthenticated(
      sessionUser,
      isPaid ? "Initializing workspace..." : "Upgrade to unlock the desktop workspace.",
    );
    setActiveView(DEFAULT_WORKSPACE_VIEW);
    setVisibleView(DEFAULT_WORKSPACE_VIEW);
    setViewMotion("entered");
    setWorkspaceState(isPaid ? "initializing" : "billingRequired");
    setWorkspaceSyncState("idle");
    setSelectedWorkspaceId("");
    setActivatedWorkspaceId("");
    setWorkspaceNameDraft("");
    setWorkspaceTerminalCountDraft("1");
    setWorkspaceTerminalRolesDraft(["codex"]);
    setWorkspaceSettingsState("idle");
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
    setWorkspaceSettingsModalId("");
    setWorkspaceTerminalLogicalIndexes({});
    setWorkspaceTerminalDisplayLayouts({});
    agentInitialStatusUserRef.current = "";
    startupAgentFlowIdRef.current += 1;
    startupAgentSettingsPendingRef.current = false;
    setStartupAgentGateState(isPaid ? "checking" : "idle");
    setStartupAgentUpdateMessage("");
    setWorkspaceError("");
  }, []);

  const showView = useCallback((nextView, options = {}) => {
    if (nextView === activeView && nextView === visibleView) {
      return;
    }

    const telemetryWorkspaceId = options.telemetryWorkspaceId || selectedWorkspaceIdRef.current;
    const telemetrySource = options.telemetrySource || "view_switch";

    window.clearTimeout(viewTransitionTimeoutRef.current);
    setWorkspaceSettingsModalId("");
    if (nextView === DEFAULT_WORKSPACE_VIEW && telemetryWorkspaceId) {
    }
    setActiveView(nextView);
    setViewMotion("exiting");

    viewTransitionTimeoutRef.current = window.setTimeout(() => {
      setVisibleView(nextView);
      window.requestAnimationFrame(() => {
        setViewMotion("entered");
      });
    }, VIEW_TRANSITION_MS);
  }, [activeView, visibleView]);

  const showSettingsView = useCallback(() => {
    showView("settings");
  }, [showView]);

  const animateWorkspaceRailWidth = useCallback((nextCollapsed) => {
    const shell = dashboardShellRef.current;
    const rail = workspaceRailRef.current;

    if (!shell || !rail || typeof window === "undefined") {
      return;
    }

    window.cancelAnimationFrame(workspaceRailAnimationFrameRef.current);

    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      shell.style.removeProperty("--workspace-rail-current-width");
      return;
    }

    const computedStyle = window.getComputedStyle(shell);
    const targetWidth = parseCssPixelValue(
      computedStyle.getPropertyValue(
        nextCollapsed ? "--workspace-rail-collapsed-width" : "--workspace-rail-width",
      ),
    );
    const currentWidth = rail.getBoundingClientRect?.().width;
    const startWidth = Number.isFinite(currentWidth) ? currentWidth : null;

    if (!Number.isFinite(startWidth) || !Number.isFinite(targetWidth)) {
      shell.style.removeProperty("--workspace-rail-current-width");
      return;
    }

    if (Math.abs(startWidth - targetWidth) < 0.5) {
      shell.style.removeProperty("--workspace-rail-current-width");
      return;
    }

    shell.style.setProperty("--workspace-rail-current-width", `${startWidth}px`);

    const startedAt = performance.now();
    const step = (now) => {
      const progress = (now - startedAt) / WORKSPACE_RAIL_ANIMATION_MS;
      const easedProgress = easeWorkspaceRailProgress(progress);
      const nextWidth = startWidth + ((targetWidth - startWidth) * easedProgress);

      shell.style.setProperty("--workspace-rail-current-width", `${nextWidth.toFixed(2)}px`);

      if (progress < 1) {
        workspaceRailAnimationFrameRef.current = window.requestAnimationFrame(step);
        return;
      }

      shell.style.removeProperty("--workspace-rail-current-width");
      workspaceRailAnimationFrameRef.current = 0;
    };

    workspaceRailAnimationFrameRef.current = window.requestAnimationFrame(step);
  }, []);

  const toggleWorkspaceRailCollapsed = useCallback(() => {
    const nextCollapsed = !workspaceRailCollapsed;
    animateWorkspaceRailWidth(nextCollapsed);
    persistWorkspaceRailCollapsed(nextCollapsed);
    setWorkspaceRailCollapsed(nextCollapsed);
  }, [animateWorkspaceRailWidth, workspaceRailCollapsed]);

  useEffect(() => {
    const platform = getWindowControlPlatform();

    document.documentElement.dataset.windowPlatform = platform;
    document.body.dataset.windowPlatform = platform;

    return () => {
      delete document.documentElement.dataset.windowPlatform;
      delete document.body.dataset.windowPlatform;
    };
  }, []);

  const clearWorkspaceSelectionFromRail = useCallback((event) => {
    const interactiveTarget = event.target.closest?.(
      'a, button, input, select, textarea, [role="button"], [data-rail-interactive="true"]',
    );

    if (interactiveTarget) {
      return;
    }

    setSelectedWorkspaceId("");
    setWorkspaceSettingsModalId("");
  }, []);

  useEffect(() => () => {
    window.cancelAnimationFrame(workspaceRailAnimationFrameRef.current);
  }, []);

  const clearPreparedWorkspaceTerminals = useCallback((workspaceId) => {
    if (!workspaceId) {
      return 0;
    }

    let clearedCount = 0;

    preparedTerminalsRef.current.forEach((session, key) => {
      if (session.workspaceId === workspaceId) {
        preparedTerminalsRef.current.delete(key);
        clearedCount += 1;
      }
    });

    if (clearedCount > 0) {
      setPreparedTerminalVersion((version) => version + 1);
    }

    return clearedCount;
  }, []);

  const updateWorkspaceLifecycleSettings = useCallback((nextValues) => {
    setWorkspaceLifecycleSettings((settings) => {
      const nextSettings = normalizeWorkspaceLifecycleSettings({
        ...settings,
        ...nextValues,
      });

      workspaceLifecycleSettingsRef.current = nextSettings;
      persistWorkspaceLifecycleSettings(nextSettings);
      return nextSettings;
    });
  }, []);

  const setDefaultWorkspace = useCallback((workspaceId, source = "settings") => {
    const nextDefaultWorkspace = workspaceId ? findWorkspaceById(workspaces, workspaceId) : null;
    const nextDefaultWorkspaceId = nextDefaultWorkspace?.id || "";
    const enabledWorkspaceIds = normalizeEnabledWorkspaceIds(
      workspaceLifecycleSettingsRef.current?.enabledWorkspaceIds,
    );

    updateWorkspaceLifecycleSettings({
      defaultWorkspaceId: nextDefaultWorkspaceId,
      enabledWorkspaceIds: nextDefaultWorkspaceId && !enabledWorkspaceIds.includes(nextDefaultWorkspaceId)
        ? [...enabledWorkspaceIds, nextDefaultWorkspaceId]
        : enabledWorkspaceIds,
    });
  }, [updateWorkspaceLifecycleSettings, workspaces]);

  const updateAppTheme = useCallback((theme) => {
    const nextTheme = normalizeAppTheme(theme);

    setAppAppearanceSettings((settings) => {
      const nextSettings = normalizeAppAppearanceSettings({
        ...settings,
        theme: nextTheme,
      });

      persistAppAppearanceSettings(nextSettings);
      applyForgeThemePreference(nextSettings.theme);
      return nextSettings;
    });
  }, []);

  const activateWorkspace = useCallback((workspaceId, source = "manual") => {
    const workspace = findWorkspaceById(workspaces, workspaceId);

    if (workspaceDeactivationInFlightRef.current) {
      return;
    }

    if (!workspace) {
      return;
    }

    const previousActivatedWorkspaceId = activatedWorkspaceIdRef.current;
    const enabledWorkspaceIds = normalizeEnabledWorkspaceIds(
      workspaceLifecycleSettingsRef.current?.enabledWorkspaceIds,
    );

    setSelectedWorkspaceId(workspace.id);
    setActivatedWorkspaceId(workspace.id);
    updateWorkspaceLifecycleSettings({
      enabledWorkspaceIds: enabledWorkspaceIds.includes(workspace.id)
        ? enabledWorkspaceIds
        : [...enabledWorkspaceIds, workspace.id],
    });

    if (previousActivatedWorkspaceId !== workspace.id) {
      workspaceAgentLaunchKeyRef.current = "";
      workspaceAgentBatchInFlightKeyRef.current = "";
      setWorkspaceAgentBatchSentKey("");
    }

  }, [activeView, updateWorkspaceLifecycleSettings, visibleView, workspaces]);

  const activateWorkspaceFromRail = useCallback((workspaceId) => {
    setWorkspaceNotifications((current) => markWorkspaceNotificationsSeen(current, workspaceId));
    activateWorkspace(workspaceId, "workspace_click");
    showView(DEFAULT_WORKSPACE_VIEW, {
      telemetrySource: "workspace_click_terminal_focus",
      telemetryWorkspaceId: workspaceId,
    });
  }, [activateWorkspace, showView]);

  const deactivateWorkspace = useCallback(async (workspaceId, source = "manual") => {
    const targetWorkspaceId = workspaceId || activatedWorkspaceIdRef.current;

    if (!targetWorkspaceId) {
      return;
    }

    if (workspaceDeactivationInFlightRef.current) {
      return;
    }

    const runtimeRepoPath = getWorkspaceRootDirectory(workspaceSettingsRef.current, targetWorkspaceId)
      || defaultWorkingDirectory;
    const targetTerminalCount = getWorkspaceTerminalCount(workspaceSettingsRef.current, targetWorkspaceId);
    const expectedTerminalTotal = normalizeCloseCount(
      getWorkspaceLogicalTerminalIndexes(
        workspaceTerminalLogicalIndexesRef.current,
        targetWorkspaceId,
        targetTerminalCount,
      ).length || targetTerminalCount,
    );
    let unlistenCloseProgress = null;
    let runtimeCleanupCompleted = false;

    workspaceDeactivationInFlightRef.current = targetWorkspaceId;
    setWorkspaceDeactivationState({
      isActive: true,
      workspaceId: targetWorkspaceId,
      source,
      closed: 0,
      total: expectedTerminalTotal,
    });
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");

    clearPreparedWorkspaceTerminals(targetWorkspaceId);

    workspaceAgentLaunchKeyRef.current = "";
    workspaceAgentBatchInFlightKeyRef.current = "";
    setWorkspaceAgentBatchSentKey("");

    try {
      unlistenCloseProgress = await listen(TERMINAL_CLOSE_ALL_PROGRESS_EVENT, (progressEvent) => {
        const nextProgress = normalizeTerminalCloseProgress(progressEvent.payload);

        setWorkspaceDeactivationState((currentState) => {
          if (!currentState.isActive || currentState.workspaceId !== targetWorkspaceId) {
            return currentState;
          }

          const currentProgress = normalizeTerminalCloseProgress(currentState);

          return {
            ...currentState,
            closed: Math.max(currentProgress.closed, nextProgress.closed),
            total: Math.max(currentProgress.total, nextProgress.total),
          };
        });
      });
    } catch {
      // Progress events are a UI nicety; cleanup still belongs to the backend command.
    }

    try {
      await withTimeout(
        invoke("deactivate_workspace_runtime", {
          repoPath: runtimeRepoPath || null,
          reason: "workspace_deactivate",
        }),
        WORKSPACE_DEACTIVATE_RUNTIME_TIMEOUT_MS,
        "Workspace deactivation timed out.",
      );
      runtimeCleanupCompleted = true;
    } catch (error) {
      setWorkspaceSettingsError(getErrorMessage(error, "Unable to deactivate workspace cleanly."));
    } finally {
      if (typeof unlistenCloseProgress === "function") {
        unlistenCloseProgress();
      }

      if (runtimeCleanupCompleted && runtimeRepoPath) {
        workspaceRuntimeDeactivatedRepoRef.current = runtimeRepoPath;
        if (sharedMcpActiveRepoRef.current === runtimeRepoPath) {
          sharedMcpActiveRepoRef.current = "";
        }
      }

      const previousLifecycleSettings = workspaceLifecycleSettingsRef.current || {};
      const nextEnabledWorkspaceIds = normalizeEnabledWorkspaceIds(
        previousLifecycleSettings.enabledWorkspaceIds,
      ).filter((enabledWorkspaceId) => enabledWorkspaceId !== targetWorkspaceId);
      updateWorkspaceLifecycleSettings({
        defaultWorkspaceId: previousLifecycleSettings.defaultWorkspaceId === targetWorkspaceId
          ? ""
          : previousLifecycleSettings.defaultWorkspaceId,
        enabledWorkspaceIds: nextEnabledWorkspaceIds,
      });

      if (activatedWorkspaceIdRef.current === targetWorkspaceId) {
        const nextActivatedWorkspace = nextEnabledWorkspaceIds
          .map((enabledWorkspaceId) => findWorkspaceById(workspacesRef.current, enabledWorkspaceId))
          .find(Boolean);
        const nextActivatedWorkspaceId = nextActivatedWorkspace?.id || "";
        setActivatedWorkspaceId(nextActivatedWorkspaceId);
      }
      if (selectedWorkspaceIdRef.current === targetWorkspaceId) {
        const nextSelectedWorkspace = nextEnabledWorkspaceIds
          .map((enabledWorkspaceId) => findWorkspaceById(workspacesRef.current, enabledWorkspaceId))
          .find(Boolean);
        setSelectedWorkspaceId(nextSelectedWorkspace?.id || "");
      }

      workspaceDeactivationInFlightRef.current = "";
      setWorkspaceDeactivationState(WORKSPACE_DEACTIVATION_INITIAL_STATE);
    }
  }, [clearPreparedWorkspaceTerminals, defaultWorkingDirectory, updateWorkspaceLifecycleSettings]);

  const completeAuthStartup = useCallback(() => {
    if (authStartupFinishedRef.current) {
      return;
    }

    authStartupFinishedRef.current = true;
    setAuthInitialized(true);
  }, []);

  const checkBackend = useCallback(async () => {
    setApiState("checking");
    setApiMessage("Checking connection");

    try {
      await withTimeout(
        invoke("backend_ping"),
        BACKEND_HELLO_TIMEOUT_MS,
        BACKEND_HELLO_TIMEOUT_MESSAGE,
      );
      setApiState("online");
      setApiMessage("Diff Forge API online");
    } catch (error) {
      const errorMessage = getErrorMessage(error, BACKEND_HELLO_TIMEOUT_MESSAGE);
      setApiState("offline");
      setApiMessage(
        errorMessage === BACKEND_HELLO_TIMEOUT_MESSAGE
          ? "Connection check timed out. Check your internet connection."
          : "Unable to reach Diff Forge API. Check your internet connection.",
      );
    }
  }, []);

  const validateStoredSession = useCallback(async () => {
    const token = authStore.getToken();
    const validationFlowId = authFlowIdRef.current;

    if (!isSafeAuthValue(token)) {
      setSignedOut(DEFAULT_AUTH_MESSAGE, "", { clearPending: true });
      return;
    }

    authStore.setChecking("Checking saved desktop session. You can still sign in with the web app.");

    try {
      const session = await withTimeout(
        invoke("validate_desktop_session", { token }),
        SESSION_RESTORE_TIMEOUT_MS,
        SESSION_RESTORE_TIMEOUT_MESSAGE,
      );
      if (validationFlowId !== authFlowIdRef.current) {
        return;
      }

      setAuthenticated(session.user);
    } catch (error) {
      if (validationFlowId !== authFlowIdRef.current) {
        return;
      }

      const restoreError = getErrorMessage(error, "Unable to restore your desktop session.");
      const didTimeout = restoreError === SESSION_RESTORE_TIMEOUT_MESSAGE;
      setSignedOut(
        didTimeout
          ? "Secure session check timed out. Sign in with the web app."
          : "Your desktop session expired. Sign in again with the web app.",
        restoreError,
        { clearPending: true },
      );
    }
  }, [setAuthenticated, setSignedOut]);

  const completeDesktopLogin = useCallback(async (callbackUrl) => {
    const callback = parseAuthCallback(callbackUrl);

    if (!callback) {
      return false;
    }

    authFlowIdRef.current += 1;
    const loginFlowId = authFlowIdRef.current;
    const pendingState = authStore.getPendingState();

    if (!pendingState || callback.state !== pendingState) {
      setSignedOut(
        DEFAULT_AUTH_MESSAGE,
        "Desktop login state did not match. Start again from this app.",
        { clearPending: true },
      );
      return true;
    }

    authStore.setExchanging();

    try {
      const session = await withTimeout(
        invoke("exchange_desktop_auth_code", {
          code: callback.code,
          state: callback.state,
        }),
        AUTH_EXCHANGE_TIMEOUT_MS,
        AUTH_EXCHANGE_TIMEOUT_MESSAGE,
      );

      if (loginFlowId !== authFlowIdRef.current) {
        return true;
      }

      authStore.saveAuthenticatedSession(session);
      authStore.clearPending();
      setAuthenticated(session.user);
    } catch (error) {
      if (loginFlowId !== authFlowIdRef.current) {
        return true;
      }

      setSignedOut(
        DEFAULT_AUTH_MESSAGE,
        getErrorMessage(error, "Desktop login expired. Try again."),
        { clearPending: true },
      );
    }

    return true;
  }, [setAuthenticated, setSignedOut]);

  const startWebLogin = useCallback(async () => {
    authFlowIdRef.current += 1;
    const state = createAuthState();
    authStore.setWaiting(state);

    try {
      const loginUrl = `${WEB_LOGIN_URL}?state=${encodeURIComponent(state)}`;
      await withTimeout(
        openUrl(loginUrl),
        OPEN_BROWSER_TIMEOUT_MS,
        "Unable to open the web login.",
      );
    } catch (error) {
      setSignedOut(
        DEFAULT_AUTH_MESSAGE,
        getErrorMessage(error, "Unable to open the web login."),
        { clearSession: false, clearPending: true },
      );
    }
  }, [setSignedOut]);

  const openPricing = useCallback(async () => {
    try {
      await withTimeout(
        openUrl(PRICING_URL),
        OPEN_BROWSER_TIMEOUT_MS,
        "Unable to open pricing.",
      );
    } catch (error) {
      authStore.setError(getErrorMessage(error, "Unable to open pricing."));
    }
  }, []);

  const refreshSubscriptionStatus = useCallback(async () => {
    const token = authStore.getToken();
    const refreshFlowId = authFlowIdRef.current;

    if (!isSafeAuthValue(token)) {
      setSignedOut(DEFAULT_AUTH_MESSAGE, "", { clearPending: true });
      return;
    }

    authStore.setMessage("Checking plan status...");
    authStore.setError("");

    try {
      const session = await withTimeout(
        invoke("validate_desktop_session", { token }),
        PLAN_REFRESH_TIMEOUT_MS,
        "Plan status check timed out.",
      );
      if (refreshFlowId !== authFlowIdRef.current) {
        return;
      }

      setAuthenticated(session.user);
    } catch (error) {
      if (refreshFlowId !== authFlowIdRef.current) {
        return;
      }

      setSignedOut(
        "Your desktop session expired. Sign in again with the web app.",
        getErrorMessage(error, "Unable to refresh plan status."),
        { clearPending: true },
      );
    }
  }, [setAuthenticated, setSignedOut]);

  const resolveAgentInstallationSyncTarget = useCallback(() => {
    const currentWorkspaces = Array.isArray(workspacesRef.current) ? workspacesRef.current : [];
    const targetWorkspaceId = (
      activatedWorkspaceIdRef.current
      || selectedWorkspaceIdRef.current
      || workspaceLifecycleSettingsRef.current?.defaultWorkspaceId
      || currentWorkspaces[0]?.id
      || ""
    );
    const workspace = targetWorkspaceId
      ? findWorkspaceById(currentWorkspaces, targetWorkspaceId)
      : currentWorkspaces[0] || null;
    const workspaceId = workspace?.id || targetWorkspaceId || "";
    const repoPath = (
      (workspaceId ? getWorkspaceRootDirectory(workspaceSettingsRef.current, workspaceId) : "")
      || cleanWorkspaceRootDirectory(defaultWorkingDirectoryRef.current)
    );

    if (!repoPath) {
      return null;
    }

    return {
      repoPath,
      workspaceId,
      workspaceName: workspace?.name || "",
    };
  }, []);

  const syncAgentInstallationsToCloud = useCallback((statuses, reason = "agent_status_refresh") => {
    const syncStatuses = Array.isArray(statuses)
      ? statuses.filter((status) => status && typeof status === "object")
      : [];
    const hasCheckedStatus = syncStatuses.some((status) => (
      !status.cached && String(status.version || "").trim() !== "Not checked"
    ));
    if (!syncStatuses.length || !hasCheckedStatus || syncStatuses.every((status) => status.cached)) {
      return;
    }

    const target = resolveAgentInstallationSyncTarget();
    if (!target) {
      return;
    }

    const syncKey = JSON.stringify({
      repoPath: target.repoPath,
      workspaceId: target.workspaceId,
      agents: syncStatuses.map((status) => ({
        id: status.id,
        installed: Boolean(status.installed),
        authenticated: Boolean(status.authenticated),
        version: status.version || "",
        npmPackageVersion: status.npmPackageVersion || "",
        npmLatestVersion: status.npmLatestVersion || "",
        npmUpdateAvailable: Boolean(status.npmUpdateAvailable),
        activeModel: status.activeModel || "",
        activeModelSupportsImages: Boolean(status.activeModelSupportsImages),
      })),
    });
    if (agentInstallationSyncKeyRef.current === syncKey) {
      return;
    }
    agentInstallationSyncKeyRef.current = syncKey;

    invoke("cloud_mcp_sync_agent_installations", {
      repoPath: target.repoPath,
      workspaceId: target.workspaceId || null,
      workspaceName: target.workspaceName || null,
      agentStatuses: syncStatuses,
      reason,
    }).catch((error) => {
      agentInstallationSyncKeyRef.current = "";
      logBigViewSyncDiagnosticEvent("cloud_mcp.agent_installations_sync.failed", {
        message: getErrorMessage(error, "Unable to sync installed agent inventory."),
        repoPath: target.repoPath,
        workspaceId: target.workspaceId,
        agentCount: syncStatuses.length,
        reason,
      });
    });
  }, [resolveAgentInstallationSyncTarget]);

  const refreshAgentStatuses = useCallback(async () => {
    const agentStatusStartedAt = performance.now();
    setAgentStatusState("checking");
    setAgentStatusError("");

    try {
      const statuses = await invoke("agent_statuses");
      const statusMap = new Map(statuses.map((status) => [status.id, status]));
      const nextStatuses = AGENT_PROVIDERS.map((provider) => ({
        ...DEFAULT_AGENT_STATUSES.find((status) => status.id === provider.id),
        ...provider,
        ...(statusMap.get(provider.id) || {}),
      }));
      persistAgentStatusCache(nextStatuses);
      setAgentStatuses(nextStatuses);
      syncAgentInstallationsToCloud(nextStatuses, "agent_status_refresh");
      setAgentStatusState("idle");
      return nextStatuses;
    } catch (error) {
      setAgentStatusState("error");
      setAgentStatusError(getErrorMessage(error, "Unable to check terminal CLIs."));
      return null;
    }
  }, [syncAgentInstallationsToCloud]);

  useEffect(() => {
    syncAgentInstallationsToCloud(agentStatuses, "workspace_context_ready");
  }, [
    activatedWorkspaceId,
    agentStatuses,
    defaultWorkingDirectory,
    selectedWorkspaceId,
    syncAgentInstallationsToCloud,
    workspaceLifecycleSettings,
    workspaceSettings,
    workspaces,
  ]);

  const refreshAudioModelStatus = useCallback(async () => {
    setAudioStatusState("checking");
    setAudioError("");

    try {
      const status = await invoke("whisper_model_status");
      setAudioModelStatus(status);
      setAudioStatusState("idle");

      if (status?.installed) {
        setAudioDownloadProgress(null);
      }
    } catch (error) {
      setAudioStatusState("error");
      setAudioError(getErrorMessage(error, "Unable to check local Whisper."));
    }
  }, []);

  const downloadAudioModel = useCallback(async () => {
    setAudioActionState("downloading");
    setAudioError("");

    try {
      const status = await invoke("download_whisper_model");
      setAudioModelStatus(status);
      setAudioActionState("idle");
      if (status?.installed) {
        setAudioDownloadProgress(null);
      }
    } catch (error) {
      try {
        const status = await invoke("whisper_model_status");
        setAudioModelStatus(status);
      } catch (_statusError) {
        // Keep the original install failure visible.
      }
      setAudioActionState("error");
      setAudioError(getErrorMessage(error, "Unable to install Whisper."));
    }
  }, []);

  const uninstallAudioModel = useCallback(async () => {
    setAudioActionState("uninstalling");
    setAudioError("");
    setAudioDownloadProgress(null);

    try {
      const status = await invoke("uninstall_whisper_model");
      setAudioModelStatus(status);
      setAudioWidgetVisible(false);
      setAudioActionState("idle");
      setAudioDownloadProgress(null);
    } catch (error) {
      setAudioActionState("error");
      setAudioError(getErrorMessage(error, "Unable to uninstall Whisper."));
      refreshAudioModelStatus();
    }
  }, [refreshAudioModelStatus]);

  const openAudioWidget = useCallback(async () => {
    setAudioActionState("opening");
    setAudioError("");

    try {
      const visibility = await invoke("show_audio_widget");
      setAudioWidgetVisible(Boolean(visibility?.visible));
      setAudioActionState("idle");
    } catch (error) {
      setAudioActionState("error");
      setAudioError(getErrorMessage(error, "Unable to open the audio widget."));
      refreshAudioModelStatus();
    }
  }, [refreshAudioModelStatus]);

  const closeAudioWidget = useCallback(async () => {
    setAudioActionState("closing");
    setAudioError("");

    try {
      const visibility = await invoke("hide_audio_widget");
      setAudioWidgetVisible(Boolean(visibility?.visible));
      setAudioActionState("idle");
    } catch (error) {
      setAudioActionState("error");
      setAudioError(getErrorMessage(error, "Unable to close the audio widget."));
      refreshAudioModelStatus();
    }
  }, [refreshAudioModelStatus]);

  const connectAgent = useCallback(async (provider) => {
    setAgentStatusState("checking");
    setAgentStatusError("");
    setAgentActionResults((results) => {
      const nextResults = { ...results };
      delete nextResults[provider];
      return nextResults;
    });

    try {
      await invoke("start_agent_login", { provider });
      setAgentStatusState("idle");
      setAgentActionResults((results) => ({
        ...results,
        [provider]: {
          tone: "neutral",
          message: "Opened login in a terminal. Use Recheck after the login completes.",
        },
      }));
    } catch (error) {
      setAgentStatusState("error");
      setAgentStatusError(getErrorMessage(error, "Unable to open terminal CLI login."));
    }
  }, []);

  const disconnectAgent = useCallback(async (provider) => {
    setAgentDisconnectState((state) => ({ ...state, [provider]: "disconnecting" }));
    setAgentStatusError("");
    setAgentActionResults((results) => {
      const nextResults = { ...results };
      delete nextResults[provider];
      return nextResults;
    });

    try {
      const result = await invoke("disconnect_agent", { provider });
      setAgentActionResults((results) => ({
        ...results,
        [provider]: {
          tone: "warning",
          message: result?.message || `${result?.label || "Terminal CLI"} disconnected from this machine.`,
        },
      }));
      const nextStatuses = agentStatuses.map((agent) => (
        agent.id === provider
          ? {
            ...agent,
            authenticated: false,
            authMessage: result?.message || `${agent.label} disconnected from this machine.`,
          }
          : agent
      ));
      setAgentStatuses(nextStatuses);
      persistAgentStatusCache(nextStatuses);
      syncAgentInstallationsToCloud(nextStatuses, "agent_disconnect");
    } catch (error) {
      setAgentActionResults((results) => ({
        ...results,
        [provider]: {
          tone: "warning",
          message: getErrorMessage(error, "Unable to disconnect terminal CLI."),
        },
      }));
    } finally {
      setAgentDisconnectState((state) => ({ ...state, [provider]: "idle" }));
    }
  }, [agentStatuses, syncAgentInstallationsToCloud]);

  const installAgentWithNpm = useCallback(async (provider) => {
    setAgentInstallState((state) => ({ ...state, [provider]: "installing" }));
    setAgentStatusError("");
    setAgentInstallResults((results) => {
      const nextResults = { ...results };
      delete nextResults[provider];
      return nextResults;
    });

    try {
      const result = await invoke("install_agent", { provider });
      setAgentInstallResults((results) => ({ ...results, [provider]: { ...result, source: "npm" } }));

      if (result?.installed) {
        await refreshAgentStatuses();
      }
    } catch (error) {
      setAgentInstallResults((results) => ({
        ...results,
        [provider]: {
          source: "npm",
          installed: false,
          permissionDenied: false,
          message: getErrorMessage(error, "Unable to install terminal CLI."),
        },
      }));
    } finally {
      setAgentInstallState((state) => ({ ...state, [provider]: "idle" }));
    }
  }, [refreshAgentStatuses]);

  const updateAgentWithNpm = useCallback(async (provider) => {
    setAgentInstallState((state) => ({ ...state, [provider]: "updating" }));
    setAgentStatusError("");
    setAgentInstallResults((results) => {
      const nextResults = { ...results };
      delete nextResults[provider];
      return nextResults;
    });

    try {
      const result = await invoke("update_agent", { provider });
      setAgentInstallResults((results) => ({ ...results, [provider]: { ...result, source: "npm-update" } }));

      if (result?.installed) {
        await refreshAgentStatuses();
      }
    } catch (error) {
      setAgentInstallResults((results) => ({
        ...results,
        [provider]: {
          source: "npm-update",
          installed: false,
          permissionDenied: false,
          message: getErrorMessage(error, "Unable to update terminal CLI."),
        },
      }));
    } finally {
      setAgentInstallState((state) => ({ ...state, [provider]: "idle" }));
    }
  }, [refreshAgentStatuses]);

  const finishStartupAgentGate = useCallback((statuses = agentStatuses, reason = "complete") => {
    const nextStatuses = Array.isArray(statuses) && statuses.length ? statuses : agentStatuses;
    const readyCount = nextStatuses.filter((agent) => agent.installed && agent.authenticated).length;
    const updateAvailableCount = getAgentUpdatesAvailable(nextStatuses).length;

    startupAgentSettingsPendingRef.current = readyCount === 0;
    setStartupAgentGateState("complete");
    setStartupAgentUpdateMessage("");
  }, [agentStatuses]);

  const enterWorkspaceAfterAgentCheck = useCallback(() => {
    finishStartupAgentGate(agentStatuses, "enter_without_update");
  }, [agentStatuses, finishStartupAgentGate]);

  const updateStartupAgents = useCallback(async () => {
    const updates = getAgentUpdatesAvailable(agentStatuses);

    if (!updates.length) {
      finishStartupAgentGate(agentStatuses, "no_updates");
      return;
    }

    const updateStartedAt = performance.now();
    setStartupAgentGateState("updating");
    setStartupAgentUpdateMessage(`Updating ${formatAgentList(updates)}...`);

    for (const agent of updates) {
      setStartupAgentUpdateMessage(`Updating ${agent.label}...`);
      setAgentInstallState((state) => ({ ...state, [agent.id]: "updating" }));
      setAgentInstallResults((results) => {
        const nextResults = { ...results };
        delete nextResults[agent.id];
        return nextResults;
      });

      try {
        const result = await invoke("update_agent", { provider: agent.id });
        setAgentInstallResults((results) => ({ ...results, [agent.id]: { ...result, source: "npm-update" } }));
      } catch (error) {
        setAgentInstallResults((results) => ({
          ...results,
          [agent.id]: {
            source: "npm-update",
            installed: false,
            permissionDenied: false,
            message: getErrorMessage(error, "Unable to update terminal CLI."),
          },
        }));
      } finally {
        setAgentInstallState((state) => ({ ...state, [agent.id]: "idle" }));
      }
    }

    setStartupAgentUpdateMessage("Refreshing terminal CLI status...");
    const nextStatuses = await refreshAgentStatuses();
    finishStartupAgentGate(nextStatuses || agentStatuses, "updated");
  }, [agentStatuses, finishStartupAgentGate, refreshAgentStatuses]);

  const openAgentNativeInstaller = useCallback(async (agent) => {
    const guide = AGENT_INSTALL_GUIDES[agent.id] || {};
    const nativeInstallUrl = agent.nativeInstallUrl || guide.nativeInstallUrl;

    if (!nativeInstallUrl) {
      setAgentInstallResults((results) => ({
        ...results,
        [agent.id]: {
          source: "native",
          installed: false,
          permissionDenied: false,
          message: "Native installer page is not configured.",
        },
      }));
      return;
    }

    try {
      await withTimeout(
        openUrl(nativeInstallUrl),
        OPEN_BROWSER_TIMEOUT_MS,
        "Unable to open native installer page.",
      );
      setAgentInstallResults((results) => ({
        ...results,
        [agent.id]: {
          source: "native",
          installed: false,
          permissionDenied: false,
          message: `Opened ${agent.nativeInstallLabel || guide.nativeInstallLabel}. Recheck after install finishes.`,
        },
      }));
    } catch (error) {
      setAgentInstallResults((results) => ({
        ...results,
        [agent.id]: {
          source: "native",
          installed: false,
          permissionDenied: false,
          message: getErrorMessage(error, "Unable to open native installer page."),
        },
      }));
    }
  }, []);

  const expireDesktopSession = useCallback((error) => {
    setSignedOut(
      "Your desktop session expired. Sign in again with the web app.",
      getErrorMessage(error, "Desktop session expired."),
      { clearPending: true },
    );
  }, [setSignedOut]);

  const loadWorkspaces = useCallback(async () => {
    const token = authStore.getToken();
    const loadStartedAt = performance.now();

    if (!isSafeAuthValue(token)) {
      expireDesktopSession("Desktop session required to load workspaces.");
      return;
    }

    setWorkspaceSyncState("loading");
    setWorkspaceError("");

    try {
      const result = await invoke("list_workspaces", { token });
      const nextWorkspaces = Array.isArray(result?.workspaces) ? result.workspaces : [];
      if (!crashRecoveryScanRef.current) {
        crashRecoveryScanRef.current = true;
        const localWorkspaceSettings = readWorkspaceSettings();
        const recoveryRoots = Array.from(new Set(nextWorkspaces
          .map((workspace) => getWorkspaceRootDirectory(localWorkspaceSettings, workspace.id))
          .filter(Boolean)));
        const recoveryStartedAt = performance.now();

        try {
          const recoveryReport = await invoke("terminal_recover_crashed_sessions", {
            roots: recoveryRoots,
          });
          const interruptedTasks = Array.isArray(recoveryReport?.interruptedTasks)
            ? recoveryReport.interruptedTasks
            : [];


          if (interruptedTasks.length > 0) {
            setCrashRecoveryModal({
              interruptedTasks,
              idleSessionsInterrupted: recoveryReport?.idleSessionsInterrupted || 0,
              finishedSessionsInterrupted: recoveryReport?.finishedSessionsInterrupted || 0,
              scannedSessions: recoveryReport?.scannedSessions || 0,
            });
          }
        } catch (error) {
        }
      }
      const currentSelectedId = selectedWorkspaceIdRef.current;
      const currentActivatedId = activatedWorkspaceIdRef.current;
      const currentLifecycleSettings = workspaceLifecycleSettingsRef.current || {};
      const configuredDefaultWorkspaceId = currentLifecycleSettings.defaultWorkspaceId;
      const configuredEnabledWorkspaceIds = normalizeEnabledWorkspaceIds(
        currentLifecycleSettings.enabledWorkspaceIds,
      );
      const defaultWorkspace = findWorkspaceById(nextWorkspaces, configuredDefaultWorkspaceId);
      const nextDefaultWorkspaceId = defaultWorkspace?.id || "";
      const existingEnabledWorkspaceIds = configuredEnabledWorkspaceIds.filter((workspaceId) => (
        Boolean(findWorkspaceById(nextWorkspaces, workspaceId))
      ));
      const firstEnabledWorkspace = existingEnabledWorkspaceIds
        .map((workspaceId) => findWorkspaceById(nextWorkspaces, workspaceId))
        .find(Boolean);
      const nextActivated = findWorkspaceById(nextWorkspaces, currentActivatedId)
        || defaultWorkspace
        || firstEnabledWorkspace
        || null;
      const nextEnabledWorkspaceIds = nextActivated?.id && !existingEnabledWorkspaceIds.includes(nextActivated.id)
        ? [...existingEnabledWorkspaceIds, nextActivated.id]
        : existingEnabledWorkspaceIds;

      if (
        (configuredDefaultWorkspaceId && !nextDefaultWorkspaceId)
        || nextEnabledWorkspaceIds.length !== configuredEnabledWorkspaceIds.length
        || nextEnabledWorkspaceIds.some((workspaceId, index) => workspaceId !== configuredEnabledWorkspaceIds[index])
      ) {
        const nextLifecycleSettings = normalizeWorkspaceLifecycleSettings({
          ...workspaceLifecycleSettingsRef.current,
          defaultWorkspaceId: nextDefaultWorkspaceId,
          enabledWorkspaceIds: nextEnabledWorkspaceIds,
        });

        workspaceLifecycleSettingsRef.current = nextLifecycleSettings;
        persistWorkspaceLifecycleSettings(nextLifecycleSettings);
        setWorkspaceLifecycleSettings(nextLifecycleSettings);
      }


      if (nextActivated) {
      }

      setWorkspaces(nextWorkspaces);
      setSelectedWorkspaceId((currentSelectedId) => {
        const nextSelected = findWorkspaceById(nextWorkspaces, currentSelectedId)
          || nextActivated
          || defaultWorkspace;

        return nextSelected?.id || "";
      });
      setActivatedWorkspaceId(nextActivated?.id || "");

      setWorkspaceSyncState("idle");
    } catch (error) {
      if (isDesktopSessionExpiredError(error)) {
        expireDesktopSession(error);
        return;
      }

      setWorkspaceSyncState("error");
      setWorkspaceError(getErrorMessage(error, "Unable to load workspaces."));
    }
  }, [expireDesktopSession]);

  const createFirstWorkspace = useCallback(async (event) => {
    event.preventDefault();

    const token = authStore.getToken();
    const name = workspaceName.trim();

    if (!isSafeAuthValue(token)) {
      expireDesktopSession("Desktop session required to create a workspace.");
      return;
    }

    if (!name) {
      setWorkspaceError("Name your first workspace.");
      return;
    }

    setWorkspaceSyncState("creating");
    setWorkspaceError("");

    try {
      const result = await invoke("create_workspace", {
        token,
        name,
      });
      const workspace = result?.workspace;

      if (!workspace) {
        throw new Error("Workspace was not returned by the API.");
      }

      setWorkspaces([workspace]);
      setSelectedWorkspaceId(workspace.id);
      setActivatedWorkspaceId(workspace.id);
      updateWorkspaceLifecycleSettings({ defaultWorkspaceId: workspace.id });
      setWorkspaceName("");
      setWorkspaceSyncState("idle");
    } catch (error) {
      if (isDesktopSessionExpiredError(error)) {
        expireDesktopSession(error);
        return;
      }

      setWorkspaceSyncState("error");
      setWorkspaceError(getErrorMessage(error, "Unable to create workspace."));
    }
  }, [expireDesktopSession, updateWorkspaceLifecycleSettings, workspaceName]);

  const openWorkspaceSettings = useCallback((workspaceId) => {
    setSelectedWorkspaceId(workspaceId);
    setWorkspaceSettingsModalId(workspaceId);
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
  }, []);

  const closeWorkspaceSettings = useCallback(() => {
    if (workspaceDeactivationInFlightRef.current) {
      return;
    }

    setWorkspaceSettingsModalId("");
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
  }, []);

  const saveWorkspaceSettings = useCallback(async (event) => {
    event.preventDefault();

    if (workspaceDeactivationInFlightRef.current) {
      return;
    }

    if (!selectedWorkspace) {
      setWorkspaceSettingsError("Select a workspace before changing settings.");
      return;
    }

    const token = authStore.getToken();
    const workspaceNameValue = workspaceNameDraft.replace(/[\u0000-\u001F\u007F]/g, "").trim();
    const terminalCount = normalizeWorkspaceTerminalCount(workspaceTerminalCountDraft);
    const terminalRoles = normalizeWorkspaceTerminalRoles(
      workspaceTerminalRolesDraft,
      terminalCount,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    const cleanedRoot = cleanWorkspaceRootDirectory(workspaceRootDraft);
    const currentRootDirectory = getWorkspaceRootDirectory(workspaceSettings, selectedWorkspace.id);
    const currentTerminalCount = getWorkspaceTerminalCount(workspaceSettings, selectedWorkspace.id);
    const currentTerminalRoles = getWorkspaceTerminalRoles(
      workspaceSettings,
      selectedWorkspace.id,
      currentTerminalCount,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    const terminalRolesChanged = !areWorkspaceTerminalRolesEqual(currentTerminalRoles, terminalRoles);

    if (!isSafeAuthValue(token)) {
      expireDesktopSession("Desktop session required to update workspace settings.");
      return;
    }

    if (!workspaceNameValue) {
      setWorkspaceSettingsError("Workspace name is required.");
      return;
    }

    if (workspaceNameValue.length > 80) {
      setWorkspaceSettingsError("Workspace name must be 80 characters or fewer.");
      return;
    }

    if (cleanedRoot.length > MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH) {
      setWorkspaceSettingsError("Root directory path is too long.");
      return;
    }

    setWorkspaceSettingsState("saving");
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");

    try {
      if (cleanedRoot) {
      }

      const rootValidationPath = cleanedRoot || defaultWorkingDirectory;
      const normalizedRoot = rootValidationPath
        ? await invoke("validate_workspace_root_directory", { path: rootValidationPath })
        : null;
      const rootDirectory = cleanedRoot ? normalizedRoot?.workingDirectory || "" : "";
      const nextTerminalIndexes = getDefaultTerminalIndexes(terminalCount);
      const nextTerminalIndexSet = new Set(nextTerminalIndexes);
      const nextTerminalRoleByIndex = new Map(nextTerminalIndexes.map((terminalIndex, index) => (
        [terminalIndex, terminalRoles[index]]
      )));
      const currentTerminalIndexes = getWorkspaceLogicalTerminalIndexes(
        workspaceTerminalLogicalIndexes,
        selectedWorkspace.id,
        currentTerminalCount,
      );
      const rootChanged = rootDirectory !== currentRootDirectory;
      const previousMcpRepoPath = currentRootDirectory || defaultWorkingDirectory;
      const nextMcpRepoPath = rootDirectory || defaultWorkingDirectory;
      const removedTerminalIndexes = currentTerminalIndexes.filter((terminalIndex) => (
        !nextTerminalIndexSet.has(terminalIndex)
      ));
      const roleChangedTerminalIndexes = currentTerminalIndexes.filter((terminalIndex, index) => (
        nextTerminalIndexSet.has(terminalIndex)
        && currentTerminalRoles[index] !== nextTerminalRoleByIndex.get(terminalIndex)
      ));
      const terminalIndexesToClose = rootChanged
        ? currentTerminalIndexes
        : Array.from(new Set([
          ...removedTerminalIndexes,
          ...roleChangedTerminalIndexes,
        ]));
      let nextWorkspace = selectedWorkspace;


      if (rootChanged) {
        clearPreparedWorkspaceTerminals(selectedWorkspace.id);
        workspaceAgentLaunchKeyRef.current = "";
        workspaceAgentBatchInFlightKeyRef.current = "";
        setWorkspaceAgentBatchSentKey("");

        const cleanupStartedAt = performance.now();


        const cleanupResult = await withTimeout(
          invoke("terminal_close_all"),
          WORKSPACE_SETTINGS_TERMINAL_CLEANUP_TIMEOUT_MS,
          "Terminal cleanup timed out.",
        );


        if (previousMcpRepoPath && previousMcpRepoPath !== nextMcpRepoPath) {
          const mcpCleanupStartedAt = performance.now();


          const mcpCleanupResult = await withTimeout(
            invoke("coordination_deactivate_shared_mcp_daemon", {
              repoPath: previousMcpRepoPath,
              reason: "workspace_root_change",
            }),
            WORKSPACE_SHARED_MCP_TIMEOUT_MS,
            "Shared MCP cleanup timed out.",
          );
          const mcpCleanupData = mcpCleanupResult?.data || mcpCleanupResult || {};

        }
      } else if (terminalIndexesToClose.length) {
        const cleanupStartedAt = performance.now();


        const cleanupResults = await withTimeout(
          Promise.all(terminalIndexesToClose.map((terminalIndex) => {
            const previousIndex = currentTerminalIndexes.indexOf(terminalIndex);

            return closeWorkspaceTerminalPane({
              agentId: getWorkspaceTerminalPaneAgentId(currentTerminalRoles[previousIndex] || activeAgent),
              nextTerminalCount: terminalCount,
              previousTerminalCount: currentTerminalCount,
              reason: removedTerminalIndexes.includes(terminalIndex) ? "settings_save" : "settings_role_change",
              terminalIndex,
              // Windows ConPTY teardown can outlive the settings transaction. The backend
              // removes the pane immediately, then finishes process cleanup in the background.
              waitForCleanup: WORKSPACE_SETTINGS_WAIT_FOR_TERMINAL_CLEANUP,
              workspaceId: selectedWorkspace.id,
            });
          })),
          WORKSPACE_SETTINGS_TERMINAL_CLEANUP_TIMEOUT_MS,
          "Terminal cleanup timed out.",
        );
        const failedCleanup = cleanupResults.filter((result) => !result?.closed);


        if (failedCleanup.length) {
          throw new Error(failedCleanup[0]?.error || "Unable to close workspace terminals.");
        }
      }

      if (workspaceNameValue !== selectedWorkspace.name) {
        const result = await invoke("update_workspace", {
          token,
          workspaceId: selectedWorkspace.id,
          name: workspaceNameValue,
        });

        if (!result?.workspace) {
          throw new Error("Workspace was not returned by the API.");
        }

        nextWorkspace = result.workspace;
        setWorkspaces((items) => items.map((workspace) => (
          workspace.id === nextWorkspace.id ? nextWorkspace : workspace
        )));
      }

      setWorkspaceSettings((settings) => {
        const nextSettings = updateWorkspaceLocalSettings(settings, selectedWorkspace.id, {
          rootDirectory,
          terminalCount,
          terminalRoles,
        });
        workspaceSettingsRef.current = nextSettings;
        persistWorkspaceSettings(nextSettings);
        return nextSettings;
      });

      if (rootChanged || terminalCount !== currentTerminalCount || terminalRolesChanged) {
        const nextLogicalIndexesByWorkspace = {
          ...workspaceTerminalLogicalIndexes,
          [selectedWorkspace.id]: nextTerminalIndexes,
        };
        const nextDisplayLayouts = {
          ...workspaceTerminalDisplayLayoutsRef.current,
          [selectedWorkspace.id]: getDefaultWorkspaceDisplayTerminalRows(nextTerminalIndexes),
        };
        workspaceTerminalLogicalIndexesRef.current = nextLogicalIndexesByWorkspace;
        workspaceTerminalDisplayLayoutsRef.current = nextDisplayLayouts;
        setWorkspaceTerminalLogicalIndexes(nextLogicalIndexesByWorkspace);
        setWorkspaceTerminalDisplayLayouts(nextDisplayLayouts);
      }

      if (rootChanged && selectedWorkspace.id === activatedWorkspaceIdRef.current && nextMcpRepoPath) {
        const mcpActivateStartedAt = performance.now();


        const mcpActivateResult = await withTimeout(
          invoke("coordination_activate_shared_mcp_daemon", {
            repoPath: nextMcpRepoPath,
            workspaceId: selectedWorkspace.id,
            workspaceName: nextWorkspace.name,
          }),
          WORKSPACE_SHARED_MCP_TIMEOUT_MS,
          "Shared MCP restart timed out.",
        );
        const mcpActivateData = mcpActivateResult?.data || mcpActivateResult || {};

      }

      setWorkspaceNameDraft(nextWorkspace.name);
      setWorkspaceRootDraft(rootDirectory);
      setWorkspaceTerminalCountDraft(String(terminalCount));
      setWorkspaceTerminalRolesDraft(terminalRoles);
      setWorkspaceSettingsState("idle");
      setWorkspaceSettingsMessage("Workspace settings saved.");
      closeWorkspaceSettings();
    } catch (error) {
      if (isDesktopSessionExpiredError(error)) {
        expireDesktopSession(error);
        return;
      }

      setWorkspaceSettingsState("error");
      setWorkspaceSettingsError(getErrorMessage(error, "Unable to update workspace settings."));
    }
  }, [
    selectedWorkspace,
    expireDesktopSession,
    workspaceNameDraft,
    workspaceRootDraft,
    workspaceTerminalCountDraft,
    workspaceTerminalRolesDraft,
    workspaceSettings,
    workspaceTerminalLogicalIndexes,
    activeAgent,
    defaultWorkingDirectory,
    workspaceTerminalFallbackRole,
    workspaceTerminalRoleOptions,
    clearPreparedWorkspaceTerminals,
    closeWorkspaceSettings,
  ]);

  const closeWorkspaceTerminal = useCallback(({ threadId, workspaceId, terminalIndex }) => {
    if (!workspaceId) {
      return;
    }

    const currentSettings = workspaceSettingsRef.current;
    const currentLogicalIndexesByWorkspace = workspaceTerminalLogicalIndexesRef.current;
    const currentDisplayLayouts = workspaceTerminalDisplayLayoutsRef.current;
    const terminalCount = getWorkspaceTerminalCount(currentSettings, workspaceId);
    const currentTerminalRoles = getWorkspaceTerminalRoles(
      currentSettings,
      workspaceId,
      terminalCount,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    const currentIndexes = getWorkspaceLogicalTerminalIndexes(
      currentLogicalIndexesByWorkspace,
      workspaceId,
      terminalCount,
    );

    if (currentIndexes.length === 0) {
      return;
    }

    const requestedTerminalIndex = Number.parseInt(terminalIndex, 10);
    const closingTerminalIndex = currentIndexes.includes(requestedTerminalIndex)
      ? requestedTerminalIndex
      : currentIndexes[currentIndexes.length - 1];
    const closingThread = threadId
      ? { id: threadId }
      : getWorkspaceThreadForTerminalIndex(
        workspaceThreadsRef.current,
        workspaceId,
        closingTerminalIndex,
      );
    if (closingThread?.id) {
      setWorkspaceThreads((threads) => markWorkspaceThreadTerminalDetached(threads, {
        rememberTerminalThread: false,
        status: "closed",
        terminalIndex: closingTerminalIndex,
        threadId: closingThread.id,
        workspaceId,
      }));
    }

    const removedTerminalIndex = closingTerminalIndex;
    const nextIndexes = currentIndexes.filter((index) => index !== closingTerminalIndex);

    const nextTerminalCount = Math.max(MIN_WORKSPACE_TERMINAL_COUNT, nextIndexes.length);
    const nextTerminalRoles = nextIndexes.map((index) => {
      const roleIndex = currentIndexes.indexOf(index);
      return currentTerminalRoles[roleIndex] || workspaceTerminalFallbackRole;
    });
    const nextLogicalIndexesByWorkspace = {
      ...currentLogicalIndexesByWorkspace,
      [workspaceId]: nextIndexes,
    };
    const nextDisplayLayouts = {
      ...currentDisplayLayouts,
      [workspaceId]: removeLogicalTerminalFromDisplayRows(
        getWorkspaceDisplayTerminalRows(currentDisplayLayouts, workspaceId, currentIndexes),
        removedTerminalIndex,
      ),
    };
    const nextSettings = updateWorkspaceLocalSettings(currentSettings, workspaceId, {
      terminalCount: nextTerminalCount,
      terminalRoles: nextTerminalRoles,
    });
    let clearedPreparedTerminal = false;

    preparedTerminalsRef.current.forEach((session, key) => {
      if (session.workspaceId === workspaceId && session.terminalIndex === removedTerminalIndex) {
        preparedTerminalsRef.current.delete(key);
        clearedPreparedTerminal = true;
      }
    });

    workspaceTerminalLogicalIndexesRef.current = nextLogicalIndexesByWorkspace;
    workspaceTerminalDisplayLayoutsRef.current = nextDisplayLayouts;
    workspaceSettingsRef.current = nextSettings;
    setWorkspaceTerminalLogicalIndexes(nextLogicalIndexesByWorkspace);
    setWorkspaceTerminalDisplayLayouts(nextDisplayLayouts);
    setWorkspaceSettings(nextSettings);
    persistWorkspaceSettings(nextSettings);

    if (clearedPreparedTerminal) {
      setPreparedTerminalVersion((version) => version + 1);
    }

    if (workspaceSettingsModalId === workspaceId) {
      setWorkspaceTerminalCountDraft(String(nextTerminalCount));
      setWorkspaceTerminalRolesDraft(nextTerminalRoles);
    }
  }, [
    workspaceSettingsModalId,
    workspaceTerminalFallbackRole,
    workspaceTerminalRoleOptions,
  ]);

  const closeTrackedProcessTerminal = useCallback(async (target = {}) => {
    const paneId = String(target.paneId || "").trim();
    if (!paneId) {
      throw new Error("Missing terminal pane for tracked process.");
    }

    await invoke("terminal_close", {
      paneId,
      instanceId: target.instanceId || undefined,
      waitForCleanup: WORKSPACE_SETTINGS_WAIT_FOR_TERMINAL_CLEANUP || undefined,
    });

    const workspaceId = String(target.workspaceId || "").trim();
    const terminalIndex = Number.parseInt(target.terminalIndex, 10);
    if (workspaceId && Number.isInteger(terminalIndex)) {
      closeWorkspaceTerminal({
        threadId: target.threadId || "",
        terminalIndex,
        workspaceId,
      });
    }

    return { closedProcesses: 1, paneId };
  }, [closeWorkspaceTerminal]);

  const splitWorkspaceTerminal = useCallback(({ direction = "vertical", terminalIndex, workspaceId }) => {
    if (!workspaceId) {
      return;
    }

    const currentSettings = workspaceSettingsRef.current;
    const currentLogicalIndexesByWorkspace = workspaceTerminalLogicalIndexesRef.current;
    const currentDisplayLayouts = workspaceTerminalDisplayLayoutsRef.current;
    const terminalCount = getWorkspaceTerminalCount(currentSettings, workspaceId);
    const currentIndexes = getWorkspaceLogicalTerminalIndexes(
      currentLogicalIndexesByWorkspace,
      workspaceId,
      terminalCount,
    );

    if (currentIndexes.length >= MAX_WORKSPACE_TERMINAL_COUNT) {
      return;
    }

    const sourceIndexPosition = currentIndexes.indexOf(terminalIndex);
    if (sourceIndexPosition < 0) {
      return;
    }

    let nextTerminalIndex = -1;
    for (let index = 0; index < MAX_WORKSPACE_TERMINAL_COUNT; index += 1) {
      if (!currentIndexes.includes(index)) {
        nextTerminalIndex = index;
        break;
      }
    }

    if (nextTerminalIndex < 0) {
      return;
    }

    const currentRoles = getWorkspaceTerminalRoles(
      currentSettings,
      workspaceId,
      terminalCount,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    const roleByIndex = Object.fromEntries(currentIndexes.map((index, orderIndex) => [
      index,
      currentRoles[orderIndex] || workspaceTerminalFallbackRole,
    ]));
    const sourceRole = roleByIndex[terminalIndex] || workspaceTerminalFallbackRole;
    const currentRows = getWorkspaceDisplayTerminalRows(currentDisplayLayouts, workspaceId, currentIndexes);
    const nextDisplayRows = insertLogicalTerminalInDisplayRows(
      currentRows,
      terminalIndex,
      nextTerminalIndex,
      direction,
    );
    const nextIndexes = normalizeWorkspaceTerminalSlotIndexes([...currentIndexes, nextTerminalIndex]);
    const nextTerminalCount = Math.min(MAX_WORKSPACE_TERMINAL_COUNT, nextIndexes.length);
    const nextTerminalRoles = nextIndexes.map((index) => (
      index === nextTerminalIndex ? sourceRole : roleByIndex[index] || workspaceTerminalFallbackRole
    ));
    const nextSettings = updateWorkspaceLocalSettings(currentSettings, workspaceId, {
      terminalCount: nextTerminalCount,
      terminalRoles: nextTerminalRoles,
    });
    const nextLogicalIndexesByWorkspace = {
      ...currentLogicalIndexesByWorkspace,
      [workspaceId]: nextIndexes,
    };
    const nextDisplayLayouts = {
      ...currentDisplayLayouts,
      [workspaceId]: nextDisplayRows,
    };

    workspaceSettingsRef.current = nextSettings;
    workspaceTerminalLogicalIndexesRef.current = nextLogicalIndexesByWorkspace;
    workspaceTerminalDisplayLayoutsRef.current = nextDisplayLayouts;
    setWorkspaceSettings(nextSettings);
    setWorkspaceTerminalLogicalIndexes(nextLogicalIndexesByWorkspace);
    setWorkspaceTerminalDisplayLayouts(nextDisplayLayouts);
    persistWorkspaceSettings(nextSettings);

    if (workspaceSettingsModalId === workspaceId) {
      setWorkspaceTerminalCountDraft(String(nextTerminalCount));
      setWorkspaceTerminalRolesDraft(nextTerminalRoles);
    }
  }, [
    workspaceSettingsModalId,
    workspaceTerminalFallbackRole,
    workspaceTerminalRoleOptions,
  ]);

  const rejectWorkspacePromptDeliveriesForThread = useCallback((workspaceId, threadId, message = "") => {
    const safeWorkspaceId = String(workspaceId || "").trim();
    const safeThreadId = String(threadId || "").trim();
    if (!safeWorkspaceId || !safeThreadId) {
      return;
    }

    workspacePendingPromptDeliveriesRef.current.forEach((entry, promptId) => {
      if (entry.workspaceId !== safeWorkspaceId || entry.threadId !== safeThreadId) {
        return;
      }

      window.clearTimeout(entry.timeoutId);
      workspacePendingPromptDeliveriesRef.current.delete(promptId);
      entry.reject(new Error(message || "Terminal closed before sending the pending prompt."));
    });
  }, []);

  const settleWorkspacePromptDelivery = useCallback((promptId, errorMessage = "") => {
    const safePromptId = String(promptId || "").trim();
    if (!safePromptId) {
      return;
    }

    const entry = workspacePendingPromptDeliveriesRef.current.get(safePromptId);
    if (!entry) {
      return;
    }

    window.clearTimeout(entry.timeoutId);
    workspacePendingPromptDeliveriesRef.current.delete(safePromptId);
    if (errorMessage) {
      entry.reject(new Error(errorMessage));
      return;
    }

    entry.resolve({
      pendingPromptId: safePromptId,
      threadId: entry.threadId,
      workspaceId: entry.workspaceId,
    });
  }, []);

  const createWorkspacePromptDelivery = useCallback((pendingPromptId, meta = {}) => {
    const safePromptId = String(pendingPromptId || "").trim();
    if (!safePromptId) {
      return Promise.resolve(null);
    }

    const existing = workspacePendingPromptDeliveriesRef.current.get(safePromptId);
    if (existing?.promise) {
      return existing.promise;
    }

    let resolveDelivery = null;
    let rejectDelivery = null;
    const promise = new Promise((resolve, reject) => {
      resolveDelivery = resolve;
      rejectDelivery = reject;
    });
    const timeoutId = window.setTimeout(() => {
      workspacePendingPromptDeliveriesRef.current.delete(safePromptId);
      rejectDelivery?.(new Error("Timed out waiting for the terminal to send the pending prompt."));
    }, WORKSPACE_PROMPT_DELIVERY_TIMEOUT_MS);

    promise.catch(() => {});
    workspacePendingPromptDeliveriesRef.current.set(safePromptId, {
      promise,
      reject: rejectDelivery,
      resolve: resolveDelivery,
      threadId: String(meta.threadId || "").trim(),
      timeoutId,
      workspaceId: String(meta.workspaceId || "").trim(),
    });
    return promise;
  }, []);

  useEffect(() => () => {
    workspacePendingPromptDeliveriesRef.current.forEach((entry) => {
      window.clearTimeout(entry.timeoutId);
      entry.reject(new Error("Application closed before sending the pending prompt."));
    });
    workspacePendingPromptDeliveriesRef.current.clear();
  }, []);

  const createWorkspaceThreadTerminal = useCallback((request = {}) => {
    const text = String(request.message || "").trim();
    const requestedWorkspaceId = String(
      request.workspace?.id || request.thread?.workspaceId || activatedWorkspace?.id || "",
    ).trim();
    const workspace = workspaces.find((candidate) => candidate.id === requestedWorkspaceId)
      || request.workspace
      || activatedWorkspace
      || null;
    const workspaceId = workspace?.id || requestedWorkspaceId;
    const requestedThreadId = String(request.threadId || request.thread?.id || "").trim();
    const existingThread = requestedThreadId
      ? workspaceThreadsRef.current?.[workspaceId]?.threads?.[requestedThreadId] || request.thread || null
      : null;
    const agentId = normalizeWorkspaceTerminalRole(
      request.agentId || existingThread?.currentAgent,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    const requestedModel = String(request.model || "").trim();

    if (!text) {
      throw new Error("Write a message before starting a chat.");
    }

    if (!["codex", "claude", "opencode"].includes(agentId)) {
      throw new Error("Choose a coding agent before starting a chat.");
    }

    if (!activatedWorkspace?.id || workspaceId !== activatedWorkspace.id) {
      throw new Error("Open the workspace before starting a chat there.");
    }

    const currentSettings = workspaceSettingsRef.current;
    const currentLogicalIndexesByWorkspace = workspaceTerminalLogicalIndexesRef.current;
    const currentDisplayLayouts = workspaceTerminalDisplayLayoutsRef.current;
    const terminalCount = getWorkspaceTerminalCount(currentSettings, workspaceId);
    const currentIndexes = getWorkspaceLogicalTerminalIndexes(
      currentLogicalIndexesByWorkspace,
      workspaceId,
      terminalCount,
    );

    if (currentIndexes.length >= MAX_WORKSPACE_TERMINAL_COUNT) {
      throw new Error("Terminal limit reached.");
    }

    let nextTerminalIndex = -1;
    for (let index = 0; index < MAX_WORKSPACE_TERMINAL_COUNT; index += 1) {
      if (!currentIndexes.includes(index)) {
        nextTerminalIndex = index;
        break;
      }
    }

    if (nextTerminalIndex < 0) {
      throw new Error("Terminal limit reached.");
    }

    const currentRoles = getWorkspaceTerminalRoles(
      currentSettings,
      workspaceId,
      terminalCount,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    const roleByIndex = Object.fromEntries(currentIndexes.map((index, orderIndex) => [
      index,
      currentRoles[orderIndex] || workspaceTerminalFallbackRole,
    ]));
    const nextIndexes = normalizeWorkspaceTerminalSlotIndexes([...currentIndexes, nextTerminalIndex]);
    const nextTerminalCount = Math.min(MAX_WORKSPACE_TERMINAL_COUNT, nextIndexes.length);
    const nextTerminalRoles = nextIndexes.map((index) => (
      index === nextTerminalIndex ? agentId : roleByIndex[index] || workspaceTerminalFallbackRole
    ));
    const sourceTerminalIndex = Number.parseInt(request.sourceTerminalIndex, 10);
    const layoutSourceIndex = currentIndexes.includes(sourceTerminalIndex)
      ? sourceTerminalIndex
      : currentIndexes[currentIndexes.length - 1] ?? nextTerminalIndex;
    const currentRows = getWorkspaceDisplayTerminalRows(currentDisplayLayouts, workspaceId, currentIndexes);
    const nextDisplayRows = insertLogicalTerminalInDisplayRows(
      currentRows,
      layoutSourceIndex,
      nextTerminalIndex,
      "vertical",
    );
    const nextSettings = updateWorkspaceLocalSettings(currentSettings, workspaceId, {
      terminalCount: nextTerminalCount,
      terminalRoles: nextTerminalRoles,
    });
    const nextLogicalIndexesByWorkspace = {
      ...currentLogicalIndexesByWorkspace,
      [workspaceId]: nextIndexes,
    };
    const nextDisplayLayouts = {
      ...currentDisplayLayouts,
      [workspaceId]: nextDisplayRows,
    };
    const threadId = existingThread?.id || createWorkspaceThreadId(workspaceId, nextTerminalIndex);
    const existingProviderBinding = existingThread
      ? getWorkspaceThreadProviderBinding(existingThread, agentId)
      : null;
    const providerSessionId = String(
      request.providerSessionId
        || existingThread?.transcriptSessionId
        || existingProviderBinding?.nativeSessionId
        || "",
    ).trim();
    const existingModel = String(existingProviderBinding?.modelId || "").trim();
    const startupDefaultModel = getWorkspaceAgentStartupModel(agentId, agentStatuses);
    const model = requestedModel || existingModel || startupDefaultModel;
    const modelSource = requestedModel
      ? "new-chat"
      : existingModel
        ? existingProviderBinding?.modelSource || "existing-thread"
        : model
          ? "agent-default"
          : "";
    logBigViewSyncDiagnosticEvent("bigview.model_state.create_thread_model_resolved", {
      agentId,
      existingModel,
      model,
      modelSource,
      providerSessionIdPresent: Boolean(providerSessionId),
      requestedModel,
      threadId,
      workspaceId,
    });
    const pendingPromptId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
    const messageCreatedAt = new Date().toISOString();
    const promptDelivery = createWorkspacePromptDelivery(pendingPromptId, {
      threadId,
      workspaceId,
    });

    workspaceSettingsRef.current = nextSettings;
    workspaceTerminalLogicalIndexesRef.current = nextLogicalIndexesByWorkspace;
    workspaceTerminalDisplayLayoutsRef.current = nextDisplayLayouts;
    setWorkspaceSettings(nextSettings);
    setWorkspaceTerminalLogicalIndexes(nextLogicalIndexesByWorkspace);
    setWorkspaceTerminalDisplayLayouts(nextDisplayLayouts);
    persistWorkspaceSettings(nextSettings);

    if (workspaceSettingsModalId === workspaceId) {
      setWorkspaceTerminalCountDraft(String(nextTerminalCount));
      setWorkspaceTerminalRolesDraft(nextTerminalRoles);
    }

    setWorkspaceThreads((threads) => materializeWorkspaceThreadForTerminal(threads, {
      agentId,
      messageCreatedAt,
      model,
      modelSource: model ? modelSource : "",
      nativeSessionId: providerSessionId,
      pendingPromptDeliveryMode: "terminal-confirmed",
      pendingPromptId,
      pendingPromptText: text,
      providerSessionId,
      repoPath: getWorkspaceRootDirectory(currentSettings, workspaceId) || defaultWorkingDirectory || "",
      slotKey: String(nextTerminalIndex + 1),
      status: "starting",
      terminalIndex: nextTerminalIndex,
      threadId,
      title: existingThread ? existingThread.title || existingThread.sessionName || "" : text,
      type: "thread-starting",
      workspaceId,
      workspaceName: workspace?.name || "",
    }));

    return {
      pendingPromptId,
      promptDelivery,
      providerSessionId,
      terminalIndex: nextTerminalIndex,
      threadId,
      workingDirectory: getWorkspaceRootDirectory(currentSettings, workspaceId) || defaultWorkingDirectory || "",
      workspace,
      workspaceId,
    };
  }, [
    activatedWorkspace,
    agentStatuses,
    createWorkspacePromptDelivery,
    defaultWorkingDirectory,
    workspaceSettingsModalId,
    workspaceTerminalFallbackRole,
    workspaceTerminalRoleOptions,
    workspaces,
  ]);

  const reorderWorkspaceTerminalDisplayLayout = useCallback(({ displayRows, workspaceId }) => {
    if (!workspaceId) {
      return;
    }

    const currentSettings = workspaceSettingsRef.current;
    const currentLogicalIndexesByWorkspace = workspaceTerminalLogicalIndexesRef.current;
    const currentDisplayLayouts = workspaceTerminalDisplayLayoutsRef.current;
    const terminalCount = getWorkspaceTerminalCount(currentSettings, workspaceId);
    const logicalIndexes = getWorkspaceLogicalTerminalIndexes(
      currentLogicalIndexesByWorkspace,
      workspaceId,
      terminalCount,
    );

    if (!logicalIndexes.length) {
      return;
    }

    const nextDisplayRows = getWorkspaceDisplayTerminalRows(
      { [workspaceId]: displayRows },
      workspaceId,
      logicalIndexes,
    ).map((row) => row.terminalIndexes.slice());
    const currentDisplayRows = getWorkspaceDisplayTerminalRows(
      currentDisplayLayouts,
      workspaceId,
      logicalIndexes,
    ).map((row) => row.terminalIndexes.slice());

    if (areWorkspaceDisplayRowsEqual(currentDisplayRows, nextDisplayRows)) {
      return;
    }

    const nextDisplayLayouts = {
      ...currentDisplayLayouts,
      [workspaceId]: nextDisplayRows,
    };

    workspaceTerminalDisplayLayoutsRef.current = nextDisplayLayouts;
    setWorkspaceTerminalDisplayLayouts(nextDisplayLayouts);
  }, []);

  const changeWorkspaceTerminalRole = useCallback(({ role, terminalIndex, threadId, workspaceId, startNewSession = false }) => {
    if (!workspaceId) {
      return;
    }

    const nextRole = normalizeWorkspaceTerminalRole(
      role,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    const currentSettings = workspaceSettingsRef.current;
    const currentLogicalIndexesByWorkspace = workspaceTerminalLogicalIndexesRef.current;
    const currentDisplayLayouts = workspaceTerminalDisplayLayoutsRef.current;
    const terminalCount = getWorkspaceTerminalCount(currentSettings, workspaceId);
    const currentIndexes = getWorkspaceLogicalTerminalIndexes(
      currentLogicalIndexesByWorkspace,
      workspaceId,
      terminalCount,
    );
    let targetTerminalIndex = Number.parseInt(terminalIndex, 10);
    targetTerminalIndex = Number.isInteger(targetTerminalIndex) && targetTerminalIndex >= 0
      ? targetTerminalIndex
      : -1;
    if (targetTerminalIndex < 0) {
      return;
    }

    const currentRoles = getWorkspaceTerminalRoles(
      currentSettings,
      workspaceId,
      terminalCount,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    let nextIndexes = currentIndexes.slice();
    let roleIndex = nextIndexes.indexOf(targetTerminalIndex);
    let nextTerminalCount = terminalCount;
    let nextDisplayLayouts = currentDisplayLayouts;

    if (roleIndex < 0) {
      if (nextIndexes.length >= MAX_WORKSPACE_TERMINAL_COUNT) {
        return;
      }

      nextIndexes = normalizeWorkspaceTerminalSlotIndexes([...nextIndexes, targetTerminalIndex]);
      roleIndex = nextIndexes.indexOf(targetTerminalIndex);
      nextTerminalCount = Math.max(MIN_WORKSPACE_TERMINAL_COUNT, nextIndexes.length);
      const currentRows = getWorkspaceDisplayTerminalRows(
        currentDisplayLayouts,
        workspaceId,
        currentIndexes,
      );
      nextDisplayLayouts = {
        ...currentDisplayLayouts,
        [workspaceId]: currentRows.length
          ? [...currentRows.map((row) => row.terminalIndexes.slice()), [targetTerminalIndex]]
          : [[targetTerminalIndex]],
      };
    }

    if (roleIndex < 0) {
      return;
    }

    const roleByIndex = Object.fromEntries(currentIndexes.map((index, indexOrder) => ([
      index,
      currentRoles[indexOrder] || workspaceTerminalFallbackRole,
    ])));
    const previousRole = roleByIndex[targetTerminalIndex] || workspaceTerminalFallbackRole;
    const roleThread = startNewSession
      ? null
      : threadId
      ? workspaceThreadsRef.current?.[workspaceId]?.threads?.[threadId]
      : getWorkspaceThreadForTerminalIndex(
        workspaceThreadsRef.current,
        workspaceId,
        targetTerminalIndex,
      );

    if (previousRole === nextRole && (!roleThread?.id || roleThread.currentAgent === nextRole)) {
      return;
    }

    const nextRoles = nextIndexes.map((index) => (
      index === targetTerminalIndex ? nextRole : roleByIndex[index] || workspaceTerminalFallbackRole
    ));
    const nextLogicalIndexesByWorkspace = {
      ...currentLogicalIndexesByWorkspace,
      [workspaceId]: nextIndexes,
    };
    const nextSettings = updateWorkspaceLocalSettings(currentSettings, workspaceId, {
      terminalCount: nextTerminalCount,
      terminalRoles: nextRoles,
    });

    workspaceSettingsRef.current = nextSettings;
    workspaceTerminalLogicalIndexesRef.current = nextLogicalIndexesByWorkspace;
    workspaceTerminalDisplayLayoutsRef.current = nextDisplayLayouts;
    setWorkspaceSettings(nextSettings);
    setWorkspaceTerminalLogicalIndexes(nextLogicalIndexesByWorkspace);
    setWorkspaceTerminalDisplayLayouts(nextDisplayLayouts);
    persistWorkspaceSettings(nextSettings);

    if (workspaceSettingsModalId === workspaceId) {
      setWorkspaceTerminalCountDraft(String(nextTerminalCount));
      setWorkspaceTerminalRolesDraft(nextRoles);
    }

    if (roleThread?.id) {
      setWorkspaceThreads((threads) => updateWorkspaceThreadAgent(threads, {
        agentId: nextRole,
        status: "starting",
        terminalIndex: targetTerminalIndex,
        threadId: roleThread.id,
        workspaceId,
      }));
    }

    if (currentIndexes.includes(targetTerminalIndex)) {
      closeWorkspaceTerminalPane({
        agentId: getWorkspaceTerminalPaneAgentId(previousRole),
        nextTerminalCount,
        previousTerminalCount: terminalCount,
        reason: "terminal_role_switch",
        terminalIndex: targetTerminalIndex,
        workspaceId,
      });
    }
  }, [
    workspaceSettingsModalId,
    workspaceTerminalFallbackRole,
    workspaceTerminalRoleOptions,
  ]);

  const manageWorkspaceAgents = useCallback(async (intent = {}) => {
    const action = String(intent.action || "").trim().toLowerCase();
    const requestedWorkspaceId = String(intent.workspaceId || activatedWorkspaceIdRef.current || "").trim();
    const workspace = requestedWorkspaceId
      ? findWorkspaceById(workspacesRef.current, requestedWorkspaceId)
      : null;
    const workspaceId = workspace?.id || requestedWorkspaceId;

    if (!workspaceId || activatedWorkspaceIdRef.current !== workspaceId) {
      throw new Error("Open the workspace before managing coding agents.");
    }

    const currentStatuses = Array.isArray(agentStatuses) ? agentStatuses : [];
    let agentId = normalizeManagedAgentProviderId(intent.agentType || intent.agent_type || intent.provider);
    const currentSettings = workspaceSettingsRef.current;
    const currentLogicalIndexesByWorkspace = workspaceTerminalLogicalIndexesRef.current;
    const currentDisplayLayouts = workspaceTerminalDisplayLayoutsRef.current;
    const terminalCount = getWorkspaceTerminalCount(currentSettings, workspaceId);
    const currentIndexes = getWorkspaceLogicalTerminalIndexes(
      currentLogicalIndexesByWorkspace,
      workspaceId,
      terminalCount,
    );
    const currentRoles = getWorkspaceTerminalRoles(
      currentSettings,
      workspaceId,
      terminalCount,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    const roleByIndex = Object.fromEntries(currentIndexes.map((index, orderIndex) => ([
      index,
      currentRoles[orderIndex] || workspaceTerminalFallbackRole,
    ])));

    if (action === "status") {
      const roleCounts = getWorkspaceTerminalRoleCountMap(currentRoles, workspaceTerminalRoleOptions);
      const readyStatuses = currentStatuses.filter((agent) => agent.installed && agent.authenticated);
      const scopedReadyStatuses = agentId
        ? readyStatuses.filter((agent) => agent.id === agentId)
        : readyStatuses;
      const readyLabels = scopedReadyStatuses.map((agent) => agent.label || getManagedAgentLabel(agent.id));
      const label = agentId ? getManagedAgentLabel(agentId) : "Coding agents";
      return {
        action,
        agentId: agentId || "any",
        agentStatuses: currentStatuses.map((agent) => ({
          authenticated: Boolean(agent.authenticated),
          id: agent.id,
          installed: Boolean(agent.installed),
          label: agent.label || getManagedAgentLabel(agent.id),
          version: agent.version || "",
        })),
        label,
        message: readyLabels.length
          ? `${currentIndexes.length} terminal${currentIndexes.length === 1 ? "" : "s"} open. Ready: ${readyLabels.join(", ")}.`
          : `${currentIndexes.length} terminal${currentIndexes.length === 1 ? "" : "s"} open. No installed and signed-in coding agents are ready.`,
        roleCounts,
        totalTerminals: currentIndexes.length,
      };
    }

    if (!agentId) {
      agentId = getReadyAgent(currentStatuses)?.id || "";
    }
    if (!agentId) {
      throw new Error("No installed and signed-in coding agents are available.");
    }

    const status = currentStatuses.find((agent) => agent.id === agentId);
    const label = status?.label || getManagedAgentLabel(agentId);
    if (!status?.installed) {
      throw new Error(`${label} is not installed on this machine.`);
    }
    if (!status?.authenticated) {
      throw new Error(`${label} is installed but not signed in.`);
    }

    if (!["ensure_count", "spawn_count"].includes(action)) {
      throw new Error("Unsupported coding-agent management action.");
    }

    const requestedCount = Math.max(0, Math.min(
      MAX_WORKSPACE_TERMINAL_COUNT,
      Number.parseInt(intent.count, 10) || 0,
    ));
    if (requestedCount <= 0) {
      throw new Error("Choose at least one coding agent to launch.");
    }

    const existingAgentCount = currentIndexes.filter((index) => roleByIndex[index] === agentId).length;
    const desiredAddCount = action === "spawn_count"
      ? requestedCount
      : Math.max(0, requestedCount - existingAgentCount);
    if (desiredAddCount <= 0) {
      return {
        action,
        addedCount: 0,
        agentId,
        existingCount: existingAgentCount,
        label,
        message: `${label} already has ${existingAgentCount} terminal${existingAgentCount === 1 ? "" : "s"} open.`,
        totalForAgent: existingAgentCount,
      };
    }

    const freeIndexes = [];
    for (let index = 0; index < MAX_WORKSPACE_TERMINAL_COUNT; index += 1) {
      if (!currentIndexes.includes(index)) {
        freeIndexes.push(index);
      }
    }
    const addedIndexes = freeIndexes.slice(0, desiredAddCount);
    if (!addedIndexes.length) {
      throw new Error(`Terminal limit reached. Diff Forge supports up to ${MAX_WORKSPACE_TERMINAL_COUNT} workspace terminals.`);
    }

    const nextIndexes = normalizeWorkspaceTerminalSlotIndexes(currentIndexes.concat(addedIndexes));
    const nextTerminalCount = Math.min(MAX_WORKSPACE_TERMINAL_COUNT, nextIndexes.length);
    const nextRoles = nextIndexes.map((index) => (
      addedIndexes.includes(index) ? agentId : roleByIndex[index] || workspaceTerminalFallbackRole
    ));
    const currentRows = getWorkspaceDisplayTerminalRows(
      currentDisplayLayouts,
      workspaceId,
      currentIndexes,
    );
    const nextRows = currentRows.length
      ? currentRows.map((row) => row.terminalIndexes.slice())
      : currentIndexes.map((index) => [index]);
    addedIndexes.forEach((index) => {
      nextRows.push([index]);
    });
    const nextSettings = updateWorkspaceLocalSettings(currentSettings, workspaceId, {
      terminalCount: nextTerminalCount,
      terminalRoles: nextRoles,
    });
    const nextLogicalIndexesByWorkspace = {
      ...currentLogicalIndexesByWorkspace,
      [workspaceId]: nextIndexes,
    };
    const nextDisplayLayouts = {
      ...currentDisplayLayouts,
      [workspaceId]: nextRows,
    };

    workspaceSettingsRef.current = nextSettings;
    workspaceTerminalLogicalIndexesRef.current = nextLogicalIndexesByWorkspace;
    workspaceTerminalDisplayLayoutsRef.current = nextDisplayLayouts;
    setWorkspaceSettings(nextSettings);
    setWorkspaceTerminalLogicalIndexes(nextLogicalIndexesByWorkspace);
    setWorkspaceTerminalDisplayLayouts(nextDisplayLayouts);
    persistWorkspaceSettings(nextSettings);

    if (workspaceSettingsModalId === workspaceId) {
      setWorkspaceTerminalCountDraft(String(nextTerminalCount));
      setWorkspaceTerminalRolesDraft(nextRoles);
    }

    const addedCount = addedIndexes.length;
    const totalForAgent = existingAgentCount + addedCount;
    return {
      action,
      addedCount,
      agentId,
      capacityReached: addedCount < desiredAddCount,
      existingCount: existingAgentCount,
      label,
      message: `Started ${addedCount} ${label} terminal${addedCount === 1 ? "" : "s"}.`,
      requestedCount,
      terminalIndexes: addedIndexes,
      totalForAgent,
    };
  }, [
    agentStatuses,
    workspaceSettingsModalId,
    workspaceTerminalFallbackRole,
    workspaceTerminalRoleOptions,
  ]);

  const useDefaultWorkspaceRoot = useCallback(() => {
    setWorkspaceRootDraft(defaultWorkingDirectory);
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
  }, [defaultWorkingDirectory]);

  const chooseWorkspaceRootDirectory = useCallback(async () => {
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");

    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose workspace root directory",
      });
      const selectedPath = Array.isArray(selected) ? selected[0] : selected;

      if (typeof selectedPath === "string" && selectedPath.trim()) {
        setWorkspaceRootDraft(selectedPath);
      }
    } catch (error) {
      setWorkspaceSettingsError(getErrorMessage(error, "Unable to choose root directory."));
    }
  }, []);

  const logout = useCallback(async () => {
    authFlowIdRef.current += 1;
    const token = authStore.getToken();

    setSignedOut(DEFAULT_AUTH_MESSAGE, "", { clearPending: true });

    if (isSafeAuthValue(token)) {
      try {
        await withTimeout(
          invoke("logout_desktop_session", { token }),
          LOGOUT_TIMEOUT_MS,
          "Desktop sign out timed out.",
        );
      } catch {
        // Local session cleanup still wins if the remote revoke cannot complete.
      }
    }
  }, [setSignedOut]);

  const toggleWindowSize = useCallback(() => {
    runWindowAction(async () => {
      const appWindow = getSafeCurrentWindow();

      if (!appWindow) {
        return;
      }

      const latestFrameState = await refreshWindowFrameState(appWindow);
      const isFullscreen = latestFrameState?.isFullscreen ?? windowFrameState.isFullscreen;

      if (isFullscreen) {
        await appWindow.setFullscreen(false);
      } else {
        await appWindow.toggleMaximize();
      }

      await refreshWindowFrameState(appWindow);
    });
  }, [refreshWindowFrameState, windowFrameState.isFullscreen]);

  const handleTitleBarMouseDown = useCallback((event) => {
    if (event.button !== 0 || event.target.closest("[data-window-control]")) {
      return;
    }

    event.preventDefault();

    if (event.detail === 2) {
      toggleWindowSize();
      return;
    }

    if (getWindowControlPlatform() === "windows" && (windowFrameState.isFullscreen || windowFrameState.isMaximized)) {
      // Windows can lose a frameless maximized window if startDragging is invoked
      // from a custom titlebar before the user has actually dragged it.
      return;
    }

    runWindowAction(() => getSafeCurrentWindow()?.startDragging());
  }, [toggleWindowSize, windowFrameState.isFullscreen, windowFrameState.isMaximized]);

  const handleWindowResizeEdgeMouseDown = useCallback((event) => {
    if (event.button !== 0) {
      return;
    }

    const direction = event.currentTarget.dataset.resizeDirection;

    if (!direction) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    if (event.detail >= 2) {
      runWindowAction(() => recoverWindowIntoViewport());
      return;
    }

    runWindowAction(() => getSafeCurrentWindow()?.startResizeDragging(direction));
  }, []);

  const handleWindowResizeEdgeDoubleClick = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    runWindowAction(() => recoverWindowIntoViewport());
  }, []);

  const minimizeWindow = useCallback((event) => {
    event.stopPropagation();
    runWindowAction(async () => {
      const appWindow = getSafeCurrentWindow();

      if (!appWindow) {
        return;
      }

      await invoke("note_main_window_minimize_requested").catch(() => {});
      await appWindow.minimize();
    });
  }, []);

  const toggleMaximizeWindow = useCallback((event) => {
    event.stopPropagation();
    toggleWindowSize();
  }, [toggleWindowSize]);

  const closeWindow = useCallback((event) => {
    event?.stopPropagation?.();

    const appWindow = getSafeCurrentWindow();

    if (!appWindow) {
      return;
    }

    if (workspaceCloseInFlightRef.current) {
      logTerminalStatus("frontend.app_close.requested", {
        expectedTerminalTotal: normalizeCloseCount(workspaceCloseExpectedTotalRef.current),
        reason: "app_close_retry",
      });
      workspaceCloseAllowNativeRef.current = true;
      requestWorkspaceWebClose("app_close_retry");
      runWindowAction(() => closeWorkspaceWindowDirectly(appWindow));
      return;
    }

    workspaceCloseInFlightRef.current = true;
    workspaceCloseAllowNativeRef.current = false;
    const expectedTerminalTotal = normalizeCloseCount(workspaceCloseExpectedTotalRef.current);
    logTerminalStatus("frontend.app_close.requested", {
      expectedTerminalTotal,
      reason: "app_close",
    });
    const browserClosePromise = requestWorkspaceWebClose("app_close");
    setWorkspaceCloseState({ isActive: true, closed: 0, total: expectedTerminalTotal });

    runWindowAction(async () => {
      let unlistenCloseProgress = null;
      let releaseCloseProgressListener = false;

      listen(TERMINAL_CLOSE_ALL_PROGRESS_EVENT, (progressEvent) => {
        const nextProgress = normalizeTerminalCloseProgress(progressEvent.payload);

        setWorkspaceCloseState((currentCloseState) => {
          const currentProgress = normalizeTerminalCloseProgress(currentCloseState);

          return {
            isActive: true,
            closed: Math.max(currentProgress.closed, nextProgress.closed),
            total: Math.max(currentProgress.total, nextProgress.total),
          };
        });
      })
        .then((unlisten) => {
          if (releaseCloseProgressListener && typeof unlisten === "function") {
            unlisten();
            return;
          }

          unlistenCloseProgress = unlisten;
        })
        .catch(() => {
          // Missing progress events should not block the close sequence.
        });

      try {
        await withTimeout(
          browserClosePromise,
          WORKSPACE_CLOSE_BROWSER_TIMEOUT_MS,
          "Workspace browser close timed out.",
        ).catch(() => {});

        workspaceCloseAllowNativeRef.current = true;
        await closeWorkspaceWindowAfterTerminalShutdown(appWindow);
      } catch (closeError) {
        logTerminalStatus("frontend.app_close.error", {
          message: closeError?.message || String(closeError || ""),
        });
        workspaceCloseAllowNativeRef.current = false;
        workspaceCloseInFlightRef.current = false;
        setWorkspaceCloseState(WORKSPACE_CLOSE_INITIAL_STATE);
      } finally {
        releaseCloseProgressListener = true;
        if (typeof unlistenCloseProgress === "function") {
          unlistenCloseProgress();
        }
      }
    });
  }, []);

  useEffect(() => {
    let isMounted = true;
    let unlistenCloseRequested = null;
    const appWindow = getSafeCurrentWindow();

    if (!appWindow) {
      return undefined;
    }

    appWindow.onCloseRequested((event) => {
      if (workspaceCloseAllowNativeRef.current) {
        return;
      }

      event.preventDefault();
      closeWindow();
    })
      .then((unlisten) => {
        if (!isMounted && typeof unlisten === "function") {
          unlisten();
          return;
        }

        unlistenCloseRequested = unlisten;
      })
      .catch(() => {});

    return () => {
      isMounted = false;

      if (typeof unlistenCloseRequested === "function") {
        unlistenCloseRequested();
      }
    };
  }, [closeWindow]);

  useEffect(() => {
    checkBackend();
  }, [checkBackend]);

  useEffect(() => {
    let isMounted = true;
    let unlistenResize = null;
    const appWindow = getSafeCurrentWindow();

    if (!appWindow) {
      return undefined;
    }

    const refresh = async () => {
      try {
        const nextFrameState = await readWindowFrameState(appWindow);

        if (isMounted && nextFrameState) {
          applyWindowFrameState(nextFrameState);
        }
      } catch {
        // Window frame state is a visual hint; unavailable APIs should not block the shell.
      }
    };

    refresh();

    appWindow.onResized(refresh)
      .then((unlisten) => {
        if (!isMounted && typeof unlisten === "function") {
          unlisten();
          return;
        }

        unlistenResize = unlisten;
      })
      .catch(() => {});

    return () => {
      isMounted = false;

      if (typeof unlistenResize === "function") {
        unlistenResize();
      }
    };
  }, [applyWindowFrameState]);

  useEffect(() => {
    let isMounted = true;

    invoke("forge_working_directory")
      .then((result) => {
        if (isMounted) {
          setDefaultWorkingDirectory(result?.workingDirectory || "");
        }
      })
      .catch(() => {
        if (isMounted) {
          setDefaultWorkingDirectory("");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => () => {
    window.clearTimeout(viewTransitionTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (authState === "authenticated") {
      return;
    }

    setWorkspaceState("idle");
    setWorkspaces([]);
    setSelectedWorkspaceId("");
    setActivatedWorkspaceId("");
    setWorkspaceSyncState("idle");
    setWorkspaceRootDraft("");
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
    setWorkspaceSettingsModalId("");
    setCrashRecoveryModal(null);
    agentInitialStatusUserRef.current = "";
    startupAgentFlowIdRef.current += 1;
    startupAgentSettingsPendingRef.current = false;
    workspaceAgentLaunchKeyRef.current = "";
    workspaceAgentBatchInFlightKeyRef.current = "";
    crashRecoveryScanRef.current = false;
    preparedTerminalsRef.current.clear();
    setStartupAgentGateState("idle");
    setStartupAgentUpdateMessage("");
    setWorkspaceAgentLaunchEpoch(0);
    setWorkspaceAgentBatchSentKey("");
    setPreparedTerminalVersion((version) => version + 1);
  }, [authState]);

  useEffect(() => {
    if (authInitialized) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      if (authStartupFinishedRef.current) {
        return;
      }

      authFlowIdRef.current += 1;
      setSignedOut(
        "Secure session check timed out. Sign in with the web app.",
        SESSION_RESTORE_TIMEOUT_MESSAGE,
        { clearPending: true },
      );
      completeAuthStartup();
    }, AUTH_STARTUP_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authInitialized, completeAuthStartup, setSignedOut]);

  useEffect(() => {
    let isMounted = true;
    let unlistenDeepLinks = null;

    onOpenUrl(async (urls) => {
      if (!isMounted) {
        return;
      }

      for (const url of urls) {
        const handled = await completeDesktopLogin(url);

        if (!isMounted || handled) {
          break;
        }
      }
    })
      .then((unlisten) => {
        if (!isMounted && typeof unlisten === "function") {
          unlisten();
          return;
        }

        unlistenDeepLinks = unlisten;
      })
      .catch((error) => {
        if (isMounted) {
          authStore.setError(getErrorMessage(error, "Desktop login callback listener is unavailable."));
        }
      });

    async function initializeAuth() {
      try {
        let startUrls = [];
        let handledDeepLink = false;

        try {
          startUrls = await withTimeout(
            getCurrent(),
            DEEP_LINK_STARTUP_TIMEOUT_MS,
            "Desktop startup link check timed out.",
          );
        } catch {
          startUrls = [];
        }

        if (!isMounted) {
          return;
        }

        if (Array.isArray(startUrls)) {
          for (const url of startUrls) {
            const handled = await completeDesktopLogin(url);
            handledDeepLink = handled || handledDeepLink;

            if (!isMounted || handled) {
              break;
            }
          }
        }

        if (!handledDeepLink && isMounted) {
          await validateStoredSession();
        }
      } catch (error) {
        if (isMounted && !authStartupFinishedRef.current) {
          authFlowIdRef.current += 1;
          setSignedOut(
            "Unable to restore your desktop session. Sign in with the web app.",
            getErrorMessage(error, "Desktop sign in is unavailable."),
            { clearPending: true },
          );
        }
      } finally {
        if (isMounted) {
          completeAuthStartup();
        }
      }
    }

    initializeAuth();

    return () => {
      isMounted = false;

      if (typeof unlistenDeepLinks === "function") {
        unlistenDeepLinks();
      }
    };
  }, [completeAuthStartup, completeDesktopLogin, setSignedOut, validateStoredSession]);

  useEffect(() => {
    if (!authInitialized) {
      return undefined;
    }

    const elapsed = Date.now() - launchStartedAtRef.current;
    const remaining = Math.max(350, LAUNCH_MINIMUM_MS - elapsed);
    const timeoutId = window.setTimeout(() => {
      setLaunchScreenVisible(false);
    }, remaining);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [authInitialized]);

  const isStartupAgentGateBlocking = startupAgentGateState === "checking"
    || startupAgentGateState === "choice"
    || startupAgentGateState === "updating";

  useEffect(() => {
    if (
      authState !== "authenticated"
      || workspaceState !== "initializing"
      || isLaunchScreenVisible
      || isStartupAgentGateBlocking
    ) {
      return undefined;
    }

    setWorkspaceState("ready");
    authStore.setMessage("Workspace ready.");

    return undefined;
  }, [authState, isLaunchScreenVisible, isStartupAgentGateBlocking, workspaceState]);

  useEffect(() => {
    if (authState !== "authenticated" || !isPaidUser(user) || workspaceState !== "initializing") {
      return undefined;
    }

    const userKey = user?.id || user?.email || "paid-user";

    if (agentInitialStatusUserRef.current !== userKey) {
      const startupFlowId = startupAgentFlowIdRef.current + 1;

      startupAgentFlowIdRef.current = startupFlowId;
      agentInitialStatusUserRef.current = userKey;
      setStartupAgentGateState("checking");
      setStartupAgentUpdateMessage("");
      refreshAudioModelStatus();
      loadWorkspaces();

      refreshAgentStatuses().then((nextStatuses) => {
        if (startupAgentFlowIdRef.current !== startupFlowId || agentInitialStatusUserRef.current !== userKey) {
          return;
        }

        if (!nextStatuses) {
          finishStartupAgentGate(agentStatuses, "status_error");
          return;
        }

        const updates = getAgentUpdatesAvailable(nextStatuses);

        if (updates.length) {
          setStartupAgentGateState("choice");
          return;
        }

        finishStartupAgentGate(nextStatuses, "no_updates");
      });
    }

    return undefined;
  }, [
    agentStatuses,
    authState,
    finishStartupAgentGate,
    loadWorkspaces,
    refreshAgentStatuses,
    refreshAudioModelStatus,
    user,
    workspaceState,
  ]);

  useEffect(() => {
    if (
      authState !== "authenticated"
      || workspaceState !== "ready"
      || !startupAgentSettingsPendingRef.current
    ) {
      return;
    }

    startupAgentSettingsPendingRef.current = false;
    showView("settings");
  }, [authState, showView, workspaceState]);

  useEffect(() => {
    if (
      authState !== "authenticated"
      || workspaceState !== "ready"
      || !readAutoOpenAudioRecorder()
    ) {
      return;
    }

    const canUseCloudRecorder = readAudioTranscriptionProvider() === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
      && Boolean(readDeepgramApiKey().trim());

    if (!canUseCloudRecorder) {
      if (!audioModelStatus && audioStatusState === "idle") {
        refreshAudioModelStatus();
        return;
      }

      if (!audioModelStatus?.installed) {
        return;
      }
    }

    const startupKey = `${user?.id || user?.email || "user"}:${selectedWorkspaceId || "workspace"}`;

    if (audioAutoOpenStartupKeyRef.current === startupKey) {
      return;
    }

    audioAutoOpenStartupKeyRef.current = startupKey;
    openAudioWidget();
  }, [
    audioModelStatus,
    audioStatusState,
    authState,
    openAudioWidget,
    refreshAudioModelStatus,
    selectedWorkspaceId,
    user,
    workspaceState,
  ]);

  useEffect(() => {
    if (authState === "authenticated" && activeView === "audio") {
      refreshAudioModelStatus();
    }
  }, [activeView, authState, refreshAudioModelStatus]);

  const isAuthBusy = authState === "waiting" || authState === "exchanging";
  const authPanelTitle = {
    waiting: "Waiting for web sign in",
    exchanging: "Finishing desktop sign in",
    signedOut: "Continue in browser",
  }[authState] || "Continue in browser";
  const authButtonLabel = {
    waiting: "Waiting...",
    exchanging: "Finishing...",
  }[authState] || "Sign in with web";
  const authStateLabel = {
    authenticated: "active",
    exchanging: "exchanging",
    signedOut: "ready",
    waiting: "waiting",
  }[authState] || "ready";
  const displayName = user?.name || user?.email || "there";
  const userIsPaid = isPaidUser(user);
  const planLabel = userIsPaid ? "Pro" : "Free";
  const connectedAgentCount = agentStatuses.filter((agent) => agent.installed && agent.authenticated).length;
  const optionalAgentCount = Math.max(0, AGENT_PROVIDERS.length - connectedAgentCount);
  const startupAgentUpdates = getAgentUpdatesAvailable(agentStatuses);
  const startupAgentStatusTitle = startupAgentGateState === "choice"
    ? "Terminal CLI updates available"
    : startupAgentGateState === "updating"
      ? startupAgentUpdateMessage || "Updating terminal CLIs..."
      : startupAgentGateState === "checking"
        ? "Checking terminal CLIs..."
        : "Terminal readiness checked";
  const startupAgentStatusDetail = startupAgentGateState === "choice"
    ? getAgentUpdateSummary(startupAgentUpdates)
    : startupAgentGateState === "updating"
      ? "The workspace will open when the selected updates finish."
      : startupAgentGateState === "checking"
        ? "Terminal CLI readiness is being checked while the workspace loads."
        : connectedAgentCount > 0
          ? `${connectedAgentCount} terminal CLI${connectedAgentCount === 1 ? "" : "s"} ready. ${optionalAgentCount} optional provider${optionalAgentCount === 1 ? "" : "s"} unavailable.`
          : "No ready terminal CLIs found. Settings will open so you can install or connect one.";
  const startupAgentStatusState = startupAgentGateState === "choice"
    ? "update"
    : startupAgentGateState === "updating"
      ? "checking"
      : connectedAgentCount > 0
        ? "ready"
        : "warning";
  const selectedWorkspaceRootDirectory = selectedWorkspace
    ? getWorkspaceRootDirectory(workspaceSettings, selectedWorkspace.id)
    : "";
  const activatedWorkspaceRootDirectory = activatedWorkspace
    ? getWorkspaceRootDirectory(workspaceSettings, activatedWorkspace.id)
    : "";
  const shouldShowWorkspaceSetup = workspaceSyncState !== "loading" && workspaces.length === 0;
  const shouldPrewarmWorkspaceTerminals = false;
  const selectedWorkspaceTerminalCount = selectedWorkspace && !shouldShowWorkspaceSetup
    ? getWorkspaceTerminalCount(workspaceSettings, selectedWorkspace.id)
    : MIN_WORKSPACE_TERMINAL_COUNT;
  const activatedWorkspaceTerminalCount = activatedWorkspace && !shouldShowWorkspaceSetup
    ? getWorkspaceTerminalCount(workspaceSettings, activatedWorkspace.id)
    : MIN_WORKSPACE_TERMINAL_COUNT;
  const selectedWorkspaceTerminalRoles = useMemo(
    () => (
      selectedWorkspace && !shouldShowWorkspaceSetup
        ? getWorkspaceTerminalRoles(
          workspaceSettings,
          selectedWorkspace.id,
          selectedWorkspaceTerminalCount,
          workspaceTerminalFallbackRole,
          workspaceTerminalRoleOptions,
        )
        : normalizeWorkspaceTerminalRoles(
          [],
          MIN_WORKSPACE_TERMINAL_COUNT,
          workspaceTerminalFallbackRole,
          workspaceTerminalRoleOptions,
        )
    ),
    [
      selectedWorkspace?.id,
      selectedWorkspaceTerminalCount,
      shouldShowWorkspaceSetup,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
      workspaceSettings,
    ],
  );
  const activatedWorkspaceTerminalRoles = useMemo(
    () => (
      activatedWorkspace && !shouldShowWorkspaceSetup
        ? getWorkspaceTerminalRoles(
          workspaceSettings,
          activatedWorkspace.id,
          activatedWorkspaceTerminalCount,
          workspaceTerminalFallbackRole,
          workspaceTerminalRoleOptions,
        )
        : normalizeWorkspaceTerminalRoles(
          [],
          MIN_WORKSPACE_TERMINAL_COUNT,
          workspaceTerminalFallbackRole,
          workspaceTerminalRoleOptions,
        )
    ),
    [
      activatedWorkspace?.id,
      activatedWorkspaceTerminalCount,
      shouldShowWorkspaceSetup,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
      workspaceSettings,
    ],
  );
  const activatedWorkspaceLogicalTerminalIndexes = useMemo(
    () => (
      activatedWorkspace && !shouldShowWorkspaceSetup
        ? getWorkspaceLogicalTerminalIndexes(
          workspaceTerminalLogicalIndexes,
          activatedWorkspace.id,
          activatedWorkspaceTerminalCount,
        )
        : getDefaultTerminalIndexes(MIN_WORKSPACE_TERMINAL_COUNT)
    ),
    [
      activatedWorkspace?.id,
      activatedWorkspaceTerminalCount,
      shouldShowWorkspaceSetup,
      workspaceTerminalLogicalIndexes,
    ],
  );
  const activatedWorkspaceLogicalTerminalCount = activatedWorkspaceLogicalTerminalIndexes.length;
  workspaceCloseExpectedTotalRef.current = activatedWorkspaceLogicalTerminalCount;
  const activatedWorkspaceTerminalRoleEntries = useMemo(
    () => activatedWorkspaceLogicalTerminalIndexes.map((terminalIndex, index) => ({
      role: normalizeWorkspaceTerminalRole(
        activatedWorkspaceTerminalRoles[index] || activatedWorkspaceTerminalRoles[terminalIndex],
        workspaceTerminalFallbackRole,
        workspaceTerminalRoleOptions,
      ),
      terminalIndex,
    })),
    [
      activatedWorkspaceLogicalTerminalIndexes,
      activatedWorkspaceTerminalRoles,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    ],
  );
  const activatedWorkspaceTerminalAgentsByIndex = useMemo(() => (
    Object.fromEntries(activatedWorkspaceTerminalRoleEntries.map(({ role, terminalIndex }) => (
      [terminalIndex, getReadyWorkspaceTerminalAgent(agentStatuses, role)]
    )))
  ), [activatedWorkspaceTerminalRoleEntries, agentStatuses]);
  const activatedWorkspaceTerminalRolesByIndex = useMemo(() => (
    Object.fromEntries(activatedWorkspaceTerminalRoleEntries.map(({ role, terminalIndex }) => (
      [terminalIndex, normalizeWorkspaceTerminalRole(
        role,
        workspaceTerminalFallbackRole,
        workspaceTerminalRoleOptions,
      )]
    )))
  ), [
    activatedWorkspaceTerminalRoleEntries,
    workspaceTerminalFallbackRole,
    workspaceTerminalRoleOptions,
  ]);
  const activatedWorkspaceThreadsByIndex = useMemo(() => (
    activatedWorkspace
      ? getWorkspaceThreadsByTerminalIndex(
        workspaceThreads,
        activatedWorkspace.id,
        activatedWorkspaceLogicalTerminalIndexes,
      )
      : {}
  ), [
    activatedWorkspace?.id,
    activatedWorkspaceLogicalTerminalIndexes,
    workspaceThreads,
  ]);
  const activatedWorkspaceAgentTerminalEntries = useMemo(() => (
    activatedWorkspaceTerminalRoleEntries.filter(({ role, terminalIndex }) => (
      normalizeWorkspaceTerminalRole(
        role,
        workspaceTerminalFallbackRole,
        workspaceTerminalRoleOptions,
      ) !== WORKSPACE_TERMINAL_ROLE_GENERIC
      && Boolean(activatedWorkspaceTerminalAgentsByIndex[terminalIndex])
    ))
  ), [
    activatedWorkspaceTerminalAgentsByIndex,
    activatedWorkspaceTerminalRoleEntries,
    workspaceTerminalFallbackRole,
    workspaceTerminalRoleOptions,
  ]);
  const workspaceTerminalRenderAgent = activatedWorkspace
    ? getReadyWorkspaceTerminalAgent(
      agentStatuses,
      activatedWorkspaceTerminalRoles[0] || workspaceTerminalFallbackRole,
    )
    : null;
  const selectedWorkspaceRootDisplay = selectedWorkspaceRootDirectory || defaultWorkingDirectory || "App directory";
  const activatedWorkspaceTerminalWorkingDirectory = activatedWorkspaceRootDirectory || defaultWorkingDirectory;
  const enabledRuntimeWorkspaceIds = useMemo(() => {
    const ids = [];
    const seen = new Set();
    const addWorkspaceId = (workspaceId) => {
      const id = String(workspaceId || "").trim();
      if (!id || seen.has(id) || !findWorkspaceById(workspaces, id)) {
        return;
      }
      seen.add(id);
      ids.push(id);
    };

    normalizeEnabledWorkspaceIds(workspaceLifecycleSettings.enabledWorkspaceIds).forEach(addWorkspaceId);
    addWorkspaceId(activatedWorkspaceId);

    return ids;
  }, [activatedWorkspaceId, workspaceLifecycleSettings.enabledWorkspaceIds, workspaces]);
  const enabledWorkspaceRuntimeDescriptors = useMemo(() => {
    if (shouldShowWorkspaceSetup) {
      return [];
    }

    return enabledRuntimeWorkspaceIds
      .map((workspaceId) => findWorkspaceById(workspaces, workspaceId))
      .filter(Boolean)
      .map((runtimeWorkspace) => {
        const rootDirectory = getWorkspaceRootDirectory(workspaceSettings, runtimeWorkspace.id);
        const terminalCount = getWorkspaceTerminalCount(workspaceSettings, runtimeWorkspace.id);
        const terminalRoles = getWorkspaceTerminalRoles(
          workspaceSettings,
          runtimeWorkspace.id,
          terminalCount,
          workspaceTerminalFallbackRole,
          workspaceTerminalRoleOptions,
        );
        const logicalTerminalIndexes = getWorkspaceLogicalTerminalIndexes(
          workspaceTerminalLogicalIndexes,
          runtimeWorkspace.id,
          terminalCount,
        );
        const terminalRoleEntries = logicalTerminalIndexes.map((terminalIndex, index) => ({
          role: normalizeWorkspaceTerminalRole(
            terminalRoles[index] || terminalRoles[terminalIndex],
            workspaceTerminalFallbackRole,
            workspaceTerminalRoleOptions,
          ),
          terminalIndex,
        }));
        const terminalAgentsByIndex = Object.fromEntries(terminalRoleEntries.map(({ role, terminalIndex }) => (
          [terminalIndex, getReadyWorkspaceTerminalAgent(agentStatuses, role)]
        )));
        const terminalRolesByIndex = Object.fromEntries(terminalRoleEntries.map(({ role, terminalIndex }) => (
          [terminalIndex, normalizeWorkspaceTerminalRole(
            role,
            workspaceTerminalFallbackRole,
            workspaceTerminalRoleOptions,
          )]
        )));
        const threadsByIndex = getWorkspaceThreadsByTerminalIndex(
          workspaceThreads,
          runtimeWorkspace.id,
          logicalTerminalIndexes,
        );
        const agentTerminalEntries = terminalRoleEntries.filter(({ role, terminalIndex }) => (
          normalizeWorkspaceTerminalRole(
            role,
            workspaceTerminalFallbackRole,
            workspaceTerminalRoleOptions,
          ) !== WORKSPACE_TERMINAL_ROLE_GENERIC
          && Boolean(terminalAgentsByIndex[terminalIndex])
        ));

        return {
          agentTerminalEntries,
          displayRows: logicalTerminalIndexes.length
            ? getWorkspaceDisplayTerminalRows(
              workspaceTerminalDisplayLayouts,
              runtimeWorkspace.id,
              logicalTerminalIndexes,
            )
            : [],
          logicalTerminalCount: logicalTerminalIndexes.length,
          logicalTerminalIndexes,
          renderAgent: getReadyWorkspaceTerminalAgent(
            agentStatuses,
            terminalRoles[0] || workspaceTerminalFallbackRole,
          ),
          terminalAgentsByIndex,
          terminalRolesByIndex,
          threadsByIndex,
          workingDirectory: rootDirectory || defaultWorkingDirectory,
          workspace: runtimeWorkspace,
        };
      });
  }, [
    agentStatuses,
    defaultWorkingDirectory,
    enabledRuntimeWorkspaceIds,
    shouldShowWorkspaceSetup,
    workspaceSettings,
    workspaceTerminalDisplayLayouts,
    workspaceTerminalFallbackRole,
    workspaceTerminalLogicalIndexes,
    workspaceTerminalRoleOptions,
    workspaceThreads,
    workspaces,
  ]);

  useEffect(() => {
    if (shouldShowWorkspaceSetup || workspaceSyncState === "loading") {
      return;
    }

    const targets = [];
    const seen = new Set();
    const addTarget = (workspace, repoPath) => {
      const workspaceId = String(workspace?.id || "").trim();
      const workingDirectory = String(repoPath || "").trim();
      if (!workspaceId || !workingDirectory) {
        return;
      }
      const key = `${workspaceId}:${workingDirectory}`;
      if (seen.has(key) || workspaceMcpStartupIndexKeysRef.current.has(key)) {
        return;
      }
      seen.add(key);
      targets.push({
        key,
        repoPath: workingDirectory,
        workspaceId,
        workspaceName: workspace?.name || "",
      });
    };

    addTarget(selectedWorkspace, selectedWorkspaceRootDirectory || defaultWorkingDirectory);
    enabledWorkspaceRuntimeDescriptors.forEach((descriptor) => {
      addTarget(descriptor.workspace, descriptor.workingDirectory);
    });

    targets.forEach((target) => {
      workspaceMcpStartupIndexKeysRef.current.add(target.key);
      invoke("coordination_workspace_mcp_registry", {
        repoPath: target.repoPath,
        workspaceId: target.workspaceId,
        workspaceName: target.workspaceName,
      }).catch(() => {
        workspaceMcpStartupIndexKeysRef.current.delete(target.key);
      });
    });
  }, [
    defaultWorkingDirectory,
    enabledWorkspaceRuntimeDescriptors,
    selectedWorkspace,
    selectedWorkspaceRootDirectory,
    shouldShowWorkspaceSetup,
    workspaceSyncState,
  ]);

  useEffect(() => {
    if (!activatedWorkspace || !activatedWorkspaceTerminalWorkingDirectory) {
      return undefined;
    }

    const repoPath = activatedWorkspaceTerminalWorkingDirectory;
    const workspaceId = activatedWorkspace.id;
    const workspaceName = activatedWorkspace.name || "";
    let disposed = false;
    const activateStartedAt = performance.now();

    sharedMcpActiveRepoRef.current = repoPath;

    withTimeout(
      invoke("coordination_activate_shared_mcp_daemon", {
        repoPath,
        workspaceId,
        workspaceName,
      }),
      WORKSPACE_SHARED_MCP_TIMEOUT_MS,
      "Shared MCP activation timed out.",
    )
      .then((response) => {
        if (disposed) {
          if (sharedMcpActiveRepoRef.current !== repoPath) {
            invoke("coordination_deactivate_shared_mcp_daemon", {
              repoPath,
              reason: "workspace_activation_disposed",
            }).catch(() => {});
          }
          return;
        }

        const data = response?.data || response || {};
      })
      .catch((error) => {
        if (disposed) {
          return;
        }

      });

    return () => {
      disposed = true;

      if (workspaceRuntimeDeactivatedRepoRef.current === repoPath) {
        workspaceRuntimeDeactivatedRepoRef.current = "";
        return;
      }

      if (sharedMcpActiveRepoRef.current === repoPath) {
        sharedMcpActiveRepoRef.current = "";
      }

      const deactivateStartedAt = performance.now();

      withTimeout(
        invoke("coordination_deactivate_shared_mcp_daemon", {
          repoPath,
          reason: "workspace_deactivate",
        }),
        WORKSPACE_SHARED_MCP_TIMEOUT_MS,
        "Shared MCP deactivation timed out.",
      )
        .then((response) => {
          const data = response?.data || response || {};
        })
        .catch((error) => {
        });
    };
  }, [activatedWorkspace?.id, activatedWorkspace?.name, activatedWorkspaceTerminalWorkingDirectory]);
  const isActivatedWorkspaceDeactivating = Boolean(
    workspaceDeactivationState.isActive
      && activatedWorkspace
      && workspaceDeactivationState.workspaceId === activatedWorkspace.id,
  );
  const workspaceTerminalAgentLaunchReady = workspaceState === "ready"
    && Boolean(activatedWorkspace)
    && workspaceThreadsHydrated
    && !isActivatedWorkspaceDeactivating
    && activatedWorkspaceAgentTerminalEntries.length > 0;
  const workspaceAgentLaunchKey = workspaceTerminalAgentLaunchReady && activatedWorkspace
    ? [
      activatedWorkspace.id,
      activatedWorkspaceTerminalWorkingDirectory,
      activatedWorkspaceAgentTerminalEntries.map(({ role, terminalIndex }) => `${terminalIndex}:${role}`).join(","),
    ].join(":")
    : "";
  const activatedWorkspaceDisplayTerminalRows = useMemo(
    () => (
      activatedWorkspaceLogicalTerminalIndexes.length
        ? getWorkspaceDisplayTerminalRows(
          workspaceTerminalDisplayLayouts,
          activatedWorkspace?.id,
          activatedWorkspaceLogicalTerminalIndexes,
        )
        : []
    ),
    [activatedWorkspace?.id, activatedWorkspaceLogicalTerminalIndexes, workspaceTerminalDisplayLayouts],
  );
  const selectedWorkspaceFileRoot = selectedWorkspace
    ? selectedWorkspaceRootDirectory || defaultWorkingDirectory
    : "";
  const processKnownRoots = useMemo(() => {
    const roots = [];
    const seen = new Set();

    const addRoot = (root) => {
      const value = String(root || "").trim();
      const key = value.toLowerCase();
      if (!value || seen.has(key)) {
        return;
      }
      seen.add(key);
      roots.push(value);
    };

    if (activatedWorkspaceRootDirectory || defaultWorkingDirectory) {
      addRoot(activatedWorkspaceRootDirectory || defaultWorkingDirectory);
    }

    workspaces.forEach((workspace) => {
      addRoot(getWorkspaceRootDirectory(workspaceSettings, workspace.id) || defaultWorkingDirectory);
    });

    return roots;
  }, [
    activatedWorkspaceRootDirectory,
    defaultWorkingDirectory,
    workspaceSettings,
    workspaces,
  ]);
  const hasSelectedWorkspace = Boolean(selectedWorkspace);
  const shouldKeepWorkspaceTerminalMounted = Boolean(
    shouldShowWorkspaceSetup || enabledWorkspaceRuntimeDescriptors.length > 0,
  );
  const shouldRevealWorkspaceTerminal = Boolean(
    shouldKeepWorkspaceTerminalMounted
      && (shouldShowWorkspaceSetup || hasSelectedWorkspace),
  );
  const shouldShowDefaultWorkspaceIdle = Boolean(
    !shouldShowWorkspaceSetup
      && (!hasSelectedWorkspace || !activatedWorkspace),
  );
  const defaultWorkspaceIdleDetail = hasSelectedWorkspace
    ? "No active workspace."
    : "No workspace selected.";
  const shouldShowTerminalNav = Boolean(hasSelectedWorkspace || shouldShowWorkspaceSetup);
  const shouldShowWorkspaceDetailNav = hasSelectedWorkspace;
  const isSelectedWorkspaceActivated = Boolean(selectedWorkspace && activatedWorkspace?.id === selectedWorkspace.id);
  const isSelectedWorkspaceDefault = Boolean(
    selectedWorkspace && workspaceLifecycleSettings.defaultWorkspaceId === selectedWorkspace.id,
  );
  const defaultWorkspace = findWorkspaceById(workspaces, workspaceLifecycleSettings.defaultWorkspaceId);
  const activeAppTheme = normalizeAppTheme(appAppearanceSettings.theme);
  const isWorkspaceSettingsOpen = Boolean(workspaceSettingsModalId && selectedWorkspace);
  const isWorkspaceSettingsDeactivating = Boolean(
    workspaceDeactivationState.isActive
      && selectedWorkspace
      && workspaceDeactivationState.workspaceId === selectedWorkspace.id,
  );
  const isWorkspaceSettingsBusy = workspaceSettingsState === "saving" || isWorkspaceSettingsDeactivating;
  const activatedWorkspaceIdForGraphSync = activatedWorkspace?.id || "";
  const activatedWorkspaceNameForGraphSync = activatedWorkspace?.name || "";

  useEffect(() => {
    if (!hasSelectedWorkspace && SELECTED_WORKSPACE_DETAIL_VIEWS.has(activeView)) {
      showView(DEFAULT_WORKSPACE_VIEW, {
        telemetrySource: "workspace_selection_cleared",
        telemetryWorkspaceId: activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current,
      });
    }
  }, [activeView, hasSelectedWorkspace, showView]);

  useEffect(() => {
    const repoPath = activatedWorkspaceTerminalWorkingDirectory;
    if (!repoPath || !activatedWorkspaceIdForGraphSync) {
      return undefined;
    }

    let cancelled = false;
    let specSyncGeneration = null;
    let knowledgeSyncGeneration = null;
    const workspaceId = activatedWorkspaceIdForGraphSync;
    const workspaceName = activatedWorkspaceNameForGraphSync || null;
    const stopSyncs = () => {
      if (specSyncGeneration) {
        invoke("cloud_mcp_stop_spec_graph_sync", {
          repoPath,
          syncGeneration: specSyncGeneration,
        }).catch(() => {});
      }
      if (knowledgeSyncGeneration) {
        invoke("cloud_mcp_stop_knowledge_graph_sync", {
          repoPath,
          syncGeneration: knowledgeSyncGeneration,
        }).catch(() => {});
      }
    };

    setWorkspaceGraphStatus(repoPath, workspaceId, {
      specState: "loading",
      specError: "",
      knowledgeState: "loading",
      knowledgeError: "",
    });

    invoke("cloud_mcp_get_cached_spec_graph", {
      repoPath,
      workspaceId,
      workspaceName,
    })
      .then((result) => {
        if (!cancelled) applyWorkspaceGraphSnapshot("spec", repoPath, workspaceId, result);
      })
      .catch((error) => {
        if (!cancelled) {
          setWorkspaceGraphStatus(repoPath, workspaceId, {
            specState: "error",
            specError: getErrorMessage(error, "Unable to load cached Spec Graph."),
          });
        }
      });

    invoke("cloud_mcp_get_cached_knowledge_graph", {
      repoPath,
      workspaceId,
      workspaceName,
    })
      .then((result) => {
        if (!cancelled) applyWorkspaceGraphSnapshot("knowledge", repoPath, workspaceId, result);
      })
      .catch((error) => {
        if (!cancelled) {
          setWorkspaceGraphStatus(repoPath, workspaceId, {
            knowledgeState: "error",
            knowledgeError: getErrorMessage(error, "Unable to load cached Knowledge Graph."),
          });
        }
      });

    invoke("cloud_mcp_start_spec_graph_sync", {
      repoPath,
      workspaceId,
      workspaceName,
    })
      .then((result) => {
        specSyncGeneration = Number(result?.syncGeneration) || null;
        if (!cancelled) applyWorkspaceGraphSnapshot("spec", repoPath, workspaceId, result);
        if (cancelled) {
          stopSyncs();
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setWorkspaceGraphStatus(repoPath, workspaceId, {
            specState: "error",
            specError: getErrorMessage(error, "Unable to start Spec Graph sync."),
          });
        }
      });

    invoke("cloud_mcp_start_knowledge_graph_sync", {
      repoPath,
      workspaceId,
      workspaceName,
    })
      .then((result) => {
        knowledgeSyncGeneration = Number(result?.syncGeneration) || null;
        if (!cancelled) applyWorkspaceGraphSnapshot("knowledge", repoPath, workspaceId, result);
        if (cancelled) {
          stopSyncs();
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setWorkspaceGraphStatus(repoPath, workspaceId, {
            knowledgeState: "error",
            knowledgeError: getErrorMessage(error, "Unable to start Knowledge Graph sync."),
          });
        }
      });

    return () => {
      cancelled = true;
      stopSyncs();
    };
  }, [
    activatedWorkspaceIdForGraphSync,
    activatedWorkspaceNameForGraphSync,
    activatedWorkspaceTerminalWorkingDirectory,
    applyWorkspaceGraphSnapshot,
    setWorkspaceGraphStatus,
  ]);

  const selectedWorkspaceGraphStateKey = workspaceGraphStateKey(
    selectedWorkspaceFileRoot,
    selectedWorkspace?.id || "",
  );
  const selectedWorkspaceGraphState = selectedWorkspaceGraphStateKey
    ? workspaceGraphState[selectedWorkspaceGraphStateKey] || {}
    : {};
  useEffect(() => {
    setPendingSpecEditIntents((current) => {
      let changed = false;
      const next = { ...current };
      Object.entries(current).forEach(([intentId, intent]) => {
        const graphKey = workspaceGraphStateKey(intent.repoPath || "", intent.workspaceId || "");
        const graphSnapshot = graphKey ? workspaceGraphState[graphKey]?.specSnapshot : null;
        const resolvedByGraph = specEditIntentResolvedByGraph(graphSnapshot, intent);
        const resolvedByAgent = specEditIntentAgentFinished(workspaceThreads, intent);
        if (resolvedByGraph || resolvedByAgent) {
          delete next[intentId];
          changed = true;
        }
      });
      return changed ? next : current;
    });
  }, [pendingSpecEditIntents, workspaceGraphState, workspaceThreads]);
  const selectedWorkspacePendingSpecEdits = useMemo(() => (
    Object.values(pendingSpecEditIntents)
      .filter((intent) => intent?.workspaceId && intent.workspaceId === (selectedWorkspace?.id || ""))
  ), [pendingSpecEditIntents, selectedWorkspace?.id]);
  useEffect(() => {
    const handleSpecEditDispatched = (event) => {
      const detail = event?.detail || {};
      const intentId = String(detail.intentId || detail.intent_id || "").trim();
      if (!intentId) return;
      setPendingSpecEditIntents((current) => {
        const intent = current[intentId];
        if (!intent) return current;
        return {
          ...current,
          [intentId]: {
            ...intent,
            agentId: detail.agentId || detail.agent_id || intent.agentId || "",
            agentLabel: detail.agentLabel || detail.agent_label || detail.agentId || intent.agentLabel || "agent",
            dispatchedAt: detail.dispatchedAt || detail.dispatched_at || new Date().toISOString(),
            terminalId: detail.terminalId || detail.terminal_id || intent.terminalId || "",
            terminalIndex: Number.isInteger(detail.terminalIndex) ? detail.terminalIndex : intent.terminalIndex,
            terminalInstanceId: detail.terminalInstanceId || detail.terminal_instance_id || intent.terminalInstanceId || "",
            threadId: detail.threadId || detail.thread_id || intent.threadId || "",
          },
        };
      });
    };
    const handleSpecEditCancelled = (event) => {
      const detail = event?.detail || {};
      const intentId = String(detail.intentId || detail.intent_id || "").trim();
      if (!intentId) return;
      setPendingSpecEditIntents((current) => {
        if (!current[intentId]) return current;
        const next = { ...current };
        delete next[intentId];
        return next;
      });
    };

    window.addEventListener(SPEC_EDIT_TODO_QUEUE_DISPATCH_EVENT, handleSpecEditDispatched);
    window.addEventListener(SPEC_EDIT_TODO_QUEUE_CANCEL_EVENT, handleSpecEditCancelled);
    return () => {
      window.removeEventListener(SPEC_EDIT_TODO_QUEUE_DISPATCH_EVENT, handleSpecEditDispatched);
      window.removeEventListener(SPEC_EDIT_TODO_QUEUE_CANCEL_EVENT, handleSpecEditCancelled);
    };
  }, []);
  const submitSpecEditIntent = useCallback(async (payload) => {
    if (!selectedWorkspace || !activatedWorkspace || selectedWorkspace.id !== activatedWorkspace.id) {
      throw new Error("Activate this workspace to edit specs.");
    }
    if (workspaceDeactivationState.isActive) {
      throw new Error("Workspace deactivation is in progress.");
    }
    const repoPath = selectedWorkspaceFileRoot || activatedWorkspaceTerminalWorkingDirectory || defaultWorkingDirectory;
    if (!repoPath) {
      throw new Error("Workspace root is not available.");
    }

    const intentId = createSpecEditIntentId();
    const intentPayload = {
      agent_id: "",
      base_graph_hash: payload.baseGraphHash || "",
      base_node_hash: payload.baseNodeHash || "",
      current_statement: payload.currentStatement || "",
      desired_statement: payload.desiredStatement || "",
      event_kind: "spec_edit_requested",
      intent_id: intentId,
      operation: payload.operation || "edit",
      status: "queued",
      target_node_id: payload.targetNodeId || "",
      target_path: payload.targetPath || "",
      target_spec_object_id: payload.targetSpecObjectId || "",
      target_title: payload.targetTitle || "",
      terminal_id: "",
      terminal_index: null,
      terminal_instance_id: "",
      thread_id: "",
      user_instruction: payload.userInstruction || "",
    };

    const prompt = buildSpecEditAgentPrompt(intentId, payload, selectedWorkspace, repoPath);
    const promptSubmittedAt = new Date().toISOString();
    const promptSubmittedAtMs = Date.parse(promptSubmittedAt) || Date.now();
    const requested = await invoke("cloud_mcp_record_spec_edit_intent", {
      intent: intentPayload,
      repoPath,
      workspaceId: selectedWorkspace.id,
      workspaceName: selectedWorkspace.name || "",
    });

    setPendingSpecEditIntents((current) => ({
      ...current,
      [intentId]: {
        agentId: "",
        agentLabel: "the next available agent",
        baseGraphHash: payload.baseGraphHash || "",
        baseNodeHash: payload.baseNodeHash || "",
        createdAt: promptSubmittedAt,
        currentStatement: payload.currentStatement || "",
        desiredStatement: payload.desiredStatement || "",
        intentId,
        operation: payload.operation || "edit",
        promptText: prompt,
        repoPath,
        submittedAt: promptSubmittedAt,
        submittedAtMs: promptSubmittedAtMs,
        targetNodeSignature: specEditNodeChangeSignature(payload.targetNode),
        targetNodeId: payload.targetNodeId || "",
        targetPath: payload.targetPath || "",
        targetSpecObjectId: payload.targetSpecObjectId || "",
        targetTitle: payload.targetTitle || "",
        terminalId: "",
        terminalIndex: null,
        terminalInstanceId: "",
        threadId: "",
        userInstruction: payload.userInstruction || "",
        workspaceId: selectedWorkspace.id,
      },
    }));

    window.dispatchEvent(new CustomEvent(SPEC_EDIT_TODO_QUEUE_EVENT, {
      detail: {
        item: {
          createdAt: promptSubmittedAt,
          id: intentId,
          kind: "spec-edit",
          source: "tui-spec-edit-auto-queue",
          specEdit: {
            baseGraphHash: payload.baseGraphHash || "",
            baseNodeHash: payload.baseNodeHash || "",
            intentId,
            intentPayload,
            operation: payload.operation || "edit",
            promptText: prompt,
            repoPath,
            targetNodeId: payload.targetNodeId || "",
            targetNodeSignature: specEditNodeChangeSignature(payload.targetNode),
            targetPath: payload.targetPath || "",
            targetSpecObjectId: payload.targetSpecObjectId || "",
            targetTitle: payload.targetTitle || "",
            workspaceId: selectedWorkspace.id,
            workspaceName: selectedWorkspace.name || "",
          },
          text: `Spec edit: ${payload.operation || "edit"} ${payload.targetTitle || payload.targetPath || "spec"}`,
          workspaceId: selectedWorkspace.id,
        },
        intentId,
        workspaceId: selectedWorkspace.id,
      },
    }));

    return {
      intentId,
      requested,
    };
  }, [
    activatedWorkspace?.id,
    activatedWorkspaceTerminalWorkingDirectory,
    defaultWorkingDirectory,
    selectedWorkspace,
    selectedWorkspaceFileRoot,
    workspaceDeactivationState.isActive,
  ]);

  const chooseCrashRecoveryPath = useCallback((choice) => {
    const interruptedTasks = Array.isArray(crashRecoveryModal?.interruptedTasks)
      ? crashRecoveryModal.interruptedTasks
      : [];

    setCrashRecoveryModal(null);

    if (choice === "resume") {
      showView(DEFAULT_WORKSPACE_VIEW, {
        telemetrySource: "crash_recovery_resume",
        telemetryWorkspaceId: activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current,
      });
    }
  }, [crashRecoveryModal, showView]);
  const openSelectedWorkspaceSettings = useCallback(() => {
    if (selectedWorkspace) {
      openWorkspaceSettings(selectedWorkspace.id);
      return;
    }

    showView("settings");
  }, [selectedWorkspace, openWorkspaceSettings, showView]);
  const openActivatedWorkspaceSettings = useCallback(() => {
    if (activatedWorkspace) {
      openWorkspaceSettings(activatedWorkspace.id);
      return;
    }

    showView("settings");
  }, [activatedWorkspace, openWorkspaceSettings, showView]);

  const selectWorkspaceThreadInOverlay = useCallback((workspaceId, threadId) => {
    setWorkspaceThreads((threads) => selectWorkspaceThread(threads, workspaceId, threadId));
  }, []);

  const updateWorkspaceThreadsViewStateFromOverlay = useCallback((workspaceId, patch) => {
    setWorkspaceThreads((threads) => updateWorkspaceThreadsViewState(threads, workspaceId, patch));
  }, []);

  const archiveWorkspaceThreadFromOverlay = useCallback((workspaceId, threadId) => {
    const safeWorkspaceId = String(workspaceId || "").trim();
    const safeThreadId = String(threadId || "").trim();
    const thread = workspaceThreadsRef.current?.[safeWorkspaceId]?.threads?.[safeThreadId];
    if (!safeWorkspaceId || !safeThreadId || !thread) {
      return;
    }
    if (!getWorkspaceThreadCanArchive(thread)) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_archive.skip", {
        reason: "no_provider_session",
        threadId: safeThreadId,
        workspaceId: safeWorkspaceId,
      });
      return;
    }

    const agentId = String(thread.currentAgent || "").trim().toLowerCase();
    const providerBinding = getWorkspaceThreadProviderBinding(thread, agentId);
    const terminalBinding = providerBinding?.terminalBinding || thread.terminalBinding || null;
    const terminalIndex = Number.parseInt(
      terminalBinding?.terminalIndex ?? thread.terminalIndex,
      10,
    );
    const shouldResetTerminal = Boolean(
      terminalBinding?.paneId
        && terminalBinding?.instanceId
        && Number.isInteger(terminalIndex)
        && ["active", "starting"].includes(String(thread.status || "").toLowerCase()),
    );
    const nextThreadId = shouldResetTerminal
      ? createWorkspaceThreadId(safeWorkspaceId, terminalIndex)
      : "";
    const freshSessionStartedAt = new Date().toISOString();

    setWorkspaceThreads((threads) => {
      let nextThreads = archiveWorkspaceThread(threads, safeWorkspaceId, safeThreadId);
      if (shouldResetTerminal) {
        nextThreads = materializeWorkspaceThreadForTerminal(nextThreads, {
          agentId: agentId || "codex",
          freshSession: true,
          freshSessionStartedAt,
          instanceId: terminalBinding.instanceId,
          paneId: terminalBinding.paneId,
          repoPath: thread.coordination?.worktreePath || "",
          source: "thread-archive-reset",
          status: "starting",
          terminalIndex,
          threadId: nextThreadId,
          transcriptHydrationMode: "session-only",
          worktreePath: thread.coordination?.worktreePath || "",
          workspaceId: safeWorkspaceId,
        });
      }
      return nextThreads;
    });

    if (shouldResetTerminal) {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(WORKSPACE_THREAD_ARCHIVE_TERMINAL_RESET_EVENT, {
          detail: {
            freshSessionStartedAt,
            instanceId: terminalBinding.instanceId,
            nextThreadId,
            paneId: terminalBinding.paneId,
            terminalIndex,
            threadId: safeThreadId,
            workspaceId: safeWorkspaceId,
          },
        }));
      }, 0);
    }
  }, []);

  const toggleWorkspaceThreadPinnedFromOverlay = useCallback((workspaceId, threadId) => {
    setWorkspaceThreads((threads) => toggleWorkspaceThreadPinned(threads, workspaceId, threadId));
  }, []);

  const requestWorkspaceThreadTranscript = useCallback((event = {}) => {
    const workspaceId = String(event.workspaceId || "").trim();
    const threadId = String(event.threadId || "").trim();
    const agentId = String(event.agentId || event.currentAgent || "codex").trim().toLowerCase();
    if (!workspaceId || !threadId || !["claude", "codex", "opencode"].includes(agentId)) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.invalid_request", {
        agentId,
        hasThreadId: Boolean(threadId),
        hasWorkspaceId: Boolean(workspaceId),
        type: event.type || "",
      });
      return;
    }

    const requestedProviderSessionId = String(
      event.nativeSessionId
        || event.providerSessionId
        || "",
    ).trim();
    const requestedCwd = String(
      event.worktreePath
        || event.cwd
        || "",
    ).trim();
    const requestedRepoPath = String(event.repoPath || "").trim();
    const pollUntilTurnComplete = event.pollUntilTurnComplete === true || event.pollUntilAssistant === true;
    const pollStartedAt = Number.parseFloat(event.pollStartedAt) || Date.now();
    const expectedUserMessage = String(
      event.expectedUserMessage
        || event.userMessage
        || event.message
        || "",
    ).trim();
    const expectedMessageCreatedAt = String(
      event.expectedMessageCreatedAt
        || event.messageCreatedAt
        || event.submittedAt
        || "",
    ).trim();
    const promptEventId = String(event.promptEventId || event.pendingPromptId || "").trim();
    const allowTimestampFallback = event.allowTimestampFallback === true
      || event.allowRecovery === true
      || event.source === "terminal-prompt-submitted";
    const submittedAt = String(
      event.submittedAt
        || event.promptEventSubmittedAt
        || expectedMessageCreatedAt
        || "",
    ).trim();

    if (workspaceThreadIdIsArchived(workspaceThreadsRef.current, workspaceId, threadId)) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
        agentId,
        reason: "thread_archived",
        requestedProviderSessionPresent: Boolean(requestedProviderSessionId),
        threadId,
        workspaceId,
      });
      return;
    }
    if (
      requestedProviderSessionId
      && workspaceThreadSessionIsArchived(
        workspaceThreadsRef.current,
        workspaceId,
        agentId,
        requestedProviderSessionId,
      )
    ) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
        agentId,
        reason: "provider_session_archived",
        requestedProviderSessionPresent: true,
        threadId,
        workspaceId,
      });
      return;
    }

    const lookupKey = requestedProviderSessionId || "session-pending";
    const expectedPromptRequestKey = expectedUserMessage
      ? `${expectedUserMessage.length}:${expectedUserMessage.slice(0, 48)}`
      : "no-prompt";
    const turnRequestKey = pollUntilTurnComplete
      ? String(
        promptEventId
          ? `${promptEventId}:${expectedPromptRequestKey}`
          : expectedMessageCreatedAt || "",
      ).trim()
      : "";
    const requestKey = `${workspaceId}:${threadId}:${lookupKey}${turnRequestKey ? `:turn:${turnRequestKey}` : ""}`;
    const existingRequest = workspaceThreadTranscriptRequestsRef.current.get(requestKey);
    if (existingRequest?.inFlight) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.duplicate_in_flight", {
        agentId,
        requestKey,
        requestedCwdPresent: Boolean(requestedCwd),
        requestedProviderSessionPresent: Boolean(requestedProviderSessionId),
        snapshot: getWorkspaceThreadDiagnosticSnapshot(
          workspaceThreadsRef.current,
          workspaceId,
          threadId,
          agentId,
        ),
        threadId,
        workspaceId,
      });
      return;
    }
    if (existingRequest?.timer) {
      window.clearTimeout(existingRequest.timer);
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.replace_timer", {
        agentId,
        requestKey,
        threadId,
        workspaceId,
      });
    }

    const runRequest = () => {
      workspaceThreadTranscriptRequestsRef.current.set(requestKey, { inFlight: true, timer: 0 });
      const thread = workspaceThreadsRef.current?.[workspaceId]?.threads?.[threadId];
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.start", {
        agentId,
        requestKey,
        requestedCwdPresent: Boolean(requestedCwd),
        requestedProviderSessionPresent: Boolean(requestedProviderSessionId),
        requestedRepoPathPresent: Boolean(requestedRepoPath),
        snapshot: getWorkspaceThreadDiagnosticSnapshot(
          workspaceThreadsRef.current,
          workspaceId,
          threadId,
          agentId,
        ),
        threadId,
        workspaceId,
      });
      if (!thread) {
        logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
          agentId,
          reason: "thread_missing",
          requestKey,
          threadId,
          workspaceId,
        });
        workspaceThreadTranscriptRequestsRef.current.delete(requestKey);
        return;
      }
      if (thread.archivedAt) {
        logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
          agentId,
          reason: "thread_archived",
          requestKey,
          threadId,
          workspaceId,
        });
        workspaceThreadTranscriptRequestsRef.current.delete(requestKey);
        return;
      }

      const providerBinding = getWorkspaceThreadProviderBinding(thread, agentId);
      const providerSessionId = String(
        requestedProviderSessionId
          || thread.transcriptSessionId
          || providerBinding?.nativeSessionId
          || "",
      ).trim();
      const discoveryCwd = String(
        requestedCwd
          || thread.coordination?.worktreePath
          || requestedRepoPath
          || "",
      ).trim();
      const canDiscoverProviderSession = Boolean(
        !providerSessionId
          && (expectedUserMessage || (allowTimestampFallback && discoveryCwd && submittedAt))
          && (pollUntilTurnComplete || promptEventId)
      );
      const threadRequiresSessionHydration = (
        thread.transcriptHydrationMode === "session-only"
        || Boolean(thread.freshSessionStartedAt)
      )
        && !providerSessionId
        && !canDiscoverProviderSession;
      if (threadRequiresSessionHydration) {
        const elapsedMs = Date.now() - pollStartedAt;
        const shouldContinuePolling = pollUntilTurnComplete
          && elapsedMs < WORKSPACE_THREAD_PROJECTION_POLL_TIMEOUT_MS;
        logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
          agentId,
          elapsedMs,
          hasProviderSessionId: Boolean(providerBinding?.nativeSessionId),
          hasRequestedProviderSessionId: Boolean(requestedProviderSessionId),
          hasTranscriptSessionId: Boolean(thread.transcriptSessionId),
          pollUntilTurnComplete,
          promptEventIdPresent: Boolean(promptEventId),
          reason: "session_only_pending_provider_session",
          requestKey,
          snapshot: getWorkspaceThreadDiagnosticSnapshot(
            workspaceThreadsRef.current,
            workspaceId,
            threadId,
            agentId,
          ),
          shouldContinuePolling,
          threadId,
          transcriptHydrationMode: thread.transcriptHydrationMode || "",
          workspaceId,
        });
        workspaceThreadTranscriptRequestsRef.current.delete(requestKey);
        if (shouldContinuePolling) {
          window.setTimeout(() => {
            requestWorkspaceThreadTranscript({
              ...event,
              delayMs: 0,
              expectedMessageCreatedAt,
              expectedUserMessage,
              pollStartedAt,
              pollUntilTurnComplete: true,
              promptEventId,
            });
          }, WORKSPACE_THREAD_PROJECTION_POLL_INTERVAL_MS);
        }
        return;
      }
      if (
        !providerSessionId
        && canDiscoverProviderSession
        && (
          thread.transcriptHydrationMode === "session-only"
          || Boolean(thread.freshSessionStartedAt)
        )
      ) {
        logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.prompt_discovery_allowed", {
          agentId,
          discoveryCwdPresent: Boolean(discoveryCwd),
          expectedUserMessagePresent: Boolean(expectedUserMessage),
          pollUntilTurnComplete,
          promptEventIdPresent: Boolean(promptEventId),
          requestKey,
          threadId,
          transcriptHydrationMode: thread.transcriptHydrationMode || "",
          workspaceId,
        });
      }
      if (
        providerSessionId
        && workspaceThreadSessionIsArchived(
          workspaceThreadsRef.current,
          workspaceId,
          agentId,
          providerSessionId,
        )
      ) {
        logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
          agentId,
          hasProviderSessionId: true,
          reason: "provider_session_archived",
          requestKey,
          threadId,
          workspaceId,
        });
        workspaceThreadTranscriptRequestsRef.current.delete(requestKey);
        return;
      }
      if (!providerSessionId && !canDiscoverProviderSession) {
        const elapsedMs = Date.now() - pollStartedAt;
        const shouldContinuePolling = pollUntilTurnComplete
          && elapsedMs < WORKSPACE_THREAD_PROJECTION_POLL_TIMEOUT_MS;
        logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
          agentId,
          elapsedMs,
          hasProviderSessionId: false,
          pollUntilTurnComplete,
          promptEventIdPresent: Boolean(promptEventId),
          reason: "session_required",
          requestKey,
          snapshot: getWorkspaceThreadDiagnosticSnapshot(
            workspaceThreadsRef.current,
            workspaceId,
            threadId,
            agentId,
          ),
          shouldContinuePolling,
          threadId,
          workspaceId,
        });
        workspaceThreadTranscriptRequestsRef.current.delete(requestKey);
        if (shouldContinuePolling) {
          window.setTimeout(() => {
            requestWorkspaceThreadTranscript({
              ...event,
              delayMs: 0,
              expectedMessageCreatedAt,
              expectedUserMessage,
              pollStartedAt,
              pollUntilTurnComplete: true,
              promptEventId,
            });
          }, WORKSPACE_THREAD_PROJECTION_POLL_INTERVAL_MS);
        }
        return;
      }

      const transcriptCommand = providerSessionId
        ? "agent_thread_transcript"
        : "agent_thread_session_discover";
      const transcriptRequest = providerSessionId
        ? {
          agentId,
          cwd: "",
          maxMessages: 320,
          providerSessionId,
        }
        : {
          allowTimestampFallback,
          agentId,
          cwd: discoveryCwd,
          expectedUserMessage,
          fallbackWindowMs: 90000,
          maxMessages: 320,
          submittedAt,
        };
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.invoke", {
        agentId,
        command: transcriptCommand,
        cwdPresent: Boolean(!providerSessionId && discoveryCwd),
        discoveryMode: !providerSessionId,
        providerSessionPresent: Boolean(providerSessionId),
        requestKey,
        requestedCwdPresent: Boolean(requestedCwd),
        requestedProviderSessionPresent: Boolean(requestedProviderSessionId),
        snapshot: getWorkspaceThreadDiagnosticSnapshot(
          workspaceThreadsRef.current,
          workspaceId,
          threadId,
          agentId,
        ),
        threadId,
        workspaceId,
      });
      invoke(transcriptCommand, {
        request: transcriptRequest,
      })
        .then((result) => {
          const messages = Array.isArray(result?.messages) ? result.messages : [];
          const sessionId = String(result?.sessionId || providerSessionId || "").trim();
          const matchedBy = String(result?.matchedBy || "").trim().toLowerCase();
          const discoveredByPrompt = !providerSessionId
            && ["prompt", "prompt+cwd", "cwd+timestamp-recovery"].includes(matchedBy)
            && Boolean(sessionId);
          const promptAccepted = transcriptHasSubmittedPromptEvidence(messages, {
            allowTimestampFallback,
            expectedUserMessage,
            matchedBy,
            messageCreatedAt: expectedMessageCreatedAt,
            submittedAt,
          });
          const rawTurnCompleteSeen = transcriptHasTurnCompletionForPrompt(messages, {
            agentId,
            expectedUserMessage,
            messageCreatedAt: expectedMessageCreatedAt,
            submittedAt,
          });
          const settledAssistantResponseSeen = transcriptHasSettledAssistantResponseForPrompt(messages, {
            allowTimestampFallback,
            expectedUserMessage,
            matchedBy,
            messageCreatedAt: expectedMessageCreatedAt,
            submittedAt,
          });
          const transcriptRequestCanSettleTurn = Boolean(
            pollUntilTurnComplete
              || event.type === "terminal-prompt-ready"
              || event.inputReady === true
              || event.terminalPromptReady === true
          );
          const terminalReadinessCanSettleTurn = Boolean(
            event.type === "terminal-prompt-ready"
              || event.inputReady === true
              || event.terminalPromptReady === true
          );
          const threadAtTranscriptResult = workspaceThreadsRef.current?.[workspaceId]?.threads?.[threadId];
          const latestTurnAtTranscriptResult = threadAtTranscriptResult?.latestTurn || null;
          const activeRunningTurnAtTranscriptResult = String(
            latestTurnAtTranscriptResult?.state || "",
          ).trim().toLowerCase() === "running";
          const transcriptTargetsLatestRunningTurn = threadLatestRunningTurnMatchesPrompt(
            threadAtTranscriptResult,
            {
              ...event,
              expectedMessageCreatedAt,
              expectedUserMessage,
              promptEventId,
              submittedAt,
            },
          );
          const staleTranscriptCompletionBlocked = Boolean(
            transcriptRequestCanSettleTurn
              && activeRunningTurnAtTranscriptResult
              && rawTurnCompleteSeen
              && !transcriptTargetsLatestRunningTurn,
          );
          const transcriptExplicitCompletionCanSettleTurn = Boolean(
            pollUntilTurnComplete
              && activeRunningTurnAtTranscriptResult
              && rawTurnCompleteSeen
              && promptAccepted
              && transcriptTargetsLatestRunningTurn
          );
          const turnCompleteSeen = Boolean(
            rawTurnCompleteSeen
              && (
                !activeRunningTurnAtTranscriptResult
                || (
                  transcriptTargetsLatestRunningTurn
                  && (
                    terminalReadinessCanSettleTurn
                    || transcriptExplicitCompletionCanSettleTurn
                  )
                )
              ),
          );
          const assistantResponseCompletesTurn = false;
          const allowTranscriptTurnCompletion = turnCompleteSeen;
          logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.result", {
            agentId,
            activeRunningTurnAtTranscriptResult,
            allowTranscriptTurnCompletion,
            assistantResponseCompletesTurn,
            latestTimestampPresent: Boolean(result?.latestTimestamp),
            matchedBy: result?.matchedBy || "",
            messageCount: messages.length,
            pollUntilTurnComplete,
            requestKey,
            rolloutPathPresent: Boolean(result?.rolloutPath),
            sessionIdPresent: Boolean(sessionId),
            sessionTitlePresent: Boolean(result?.sessionTitle),
            snapshot: getWorkspaceThreadDiagnosticSnapshot(
              workspaceThreadsRef.current,
              workspaceId,
              threadId,
              agentId,
            ),
            threadId,
            promptAccepted,
            rawTurnCompleteSeen,
            settledAssistantResponseSeen,
            staleTranscriptCompletionBlocked,
            terminalReadinessCanSettleTurn,
            transcriptExplicitCompletionCanSettleTurn,
            transcriptTargetsLatestRunningTurn,
            transcriptRequestCanSettleTurn,
            turnCompleteSeen,
            workspaceId,
          });
          logTerminalStatus("frontend.terminal_status.transcript_result", {
            agentId,
            activeRunningTurnAtTranscriptResult,
            allowTranscriptTurnCompletion,
            assistantResponseCompletesTurn,
            matchedBy: result?.matchedBy || "",
            messageCount: messages.length,
            pollUntilTurnComplete,
            promptAccepted,
            promptEventId,
            rawTurnCompleteSeen,
            requestKey,
            sessionIdPresent: Boolean(sessionId),
            settledAssistantResponseSeen,
            staleTranscriptCompletionBlocked,
            terminalReadinessCanSettleTurn,
            transcriptExplicitCompletionCanSettleTurn,
            terminalGroundTruthStatus: turnCompleteSeen || assistantResponseCompletesTurn ? "idle_or_done" : "processing_or_unknown",
            threadId,
            transcriptTargetsLatestRunningTurn,
            transcriptRequestCanSettleTurn,
            turnCompleteSeen,
            workspaceId,
          });
          if (expectedUserMessage && !promptAccepted && (agentId === "codex" || promptEventId)) {
            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.prompt_mismatch", {
              agentId,
              diagnostics: getTranscriptPromptMatchDiagnostics(messages, {
                allowTimestampFallback,
                expectedUserMessage,
                matchedBy,
                messageCreatedAt: expectedMessageCreatedAt,
                submittedAt,
              }),
              matchedBy,
              pollUntilTurnComplete,
              promptEventIdPresent: Boolean(promptEventId),
              requestKey,
              sessionIdPresent: Boolean(sessionId),
              threadId,
              workspaceId,
            });
          }
          const sessionMatchedByProviderId = matchedBy === "sessionid";
          const promptDiscoveryAccepted = discoveredByPrompt && promptAccepted;
          const voicePlanPromptEventId = String(promptEventId || "").trim();
          if (!sessionMatchedByProviderId && !promptDiscoveryAccepted) {
            const elapsedMs = Date.now() - pollStartedAt;
            const shouldContinuePolling = pollUntilTurnComplete
              && elapsedMs < WORKSPACE_THREAD_PROJECTION_POLL_TIMEOUT_MS;
            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
              agentId,
              elapsedMs,
              matchedBy,
              messageCount: messages.length,
              pollUntilTurnComplete,
              promptEventIdPresent: Boolean(promptEventId),
              reason: discoveredByPrompt
                ? "prompt_discovery_without_prompt_evidence"
                : "non_session_match_blocked",
              requestKey,
              sessionIdPresent: Boolean(sessionId),
              shouldContinuePolling,
              threadId,
              workspaceId,
            });
            if (shouldContinuePolling) {
              window.setTimeout(() => {
                requestWorkspaceThreadTranscript({
                  ...event,
                  delayMs: 0,
                  expectedMessageCreatedAt,
                  expectedUserMessage,
                  pollStartedAt,
                  pollUntilTurnComplete: true,
                  promptEventId,
                  providerSessionId: sessionId || providerSessionId,
                });
              }, WORKSPACE_THREAD_PROJECTION_POLL_INTERVAL_MS);
            }
            return;
          }
          const staleVoicePlanCompletionWithoutPrompt = Boolean(
            pollUntilTurnComplete
              && turnCompleteSeen
              && sessionMatchedByProviderId
              && voicePlanPromptEventId.startsWith("voice-plan-")
              && !promptAccepted,
          );
          const trustedVoicePlanTerminalFinish = Boolean(
            pollUntilTurnComplete
              && turnCompleteSeen
              && sessionMatchedByProviderId
              && voicePlanPromptEventId.startsWith("voice-plan-")
              && promptAccepted,
          );
          const requiresExactPromptEvidence = (
            pollUntilTurnComplete
            && Boolean(expectedUserMessage)
            && !matchedBy.includes("timestamp")
            && !matchedBy.includes("recovery")
          );
          if (
            (staleVoicePlanCompletionWithoutPrompt || requiresExactPromptEvidence)
            && !promptAccepted
            && !trustedVoicePlanTerminalFinish
          ) {
            const elapsedMs = Date.now() - pollStartedAt;
            const shouldContinuePolling = elapsedMs < WORKSPACE_THREAD_PROJECTION_POLL_TIMEOUT_MS;
            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
              agentId,
              elapsedMs,
              matchedBy,
              messageCount: messages.length,
              pollUntilTurnComplete,
              promptEventIdPresent: Boolean(promptEventId),
              reason: staleVoicePlanCompletionWithoutPrompt
                ? "voice_plan_completion_without_prompt_evidence"
                : "exact_prompt_not_seen_for_session",
              requestKey,
              sessionIdPresent: Boolean(sessionId),
              shouldContinuePolling,
              threadId,
              workspaceId,
            });
            if (staleVoicePlanCompletionWithoutPrompt) {
              logTerminalStatus("frontend.voice_plan.stale_completion_ignored", {
                agentId,
                elapsedMs,
                matchedBy,
                messageCount: messages.length,
                promptAccepted,
                promptEventId: voicePlanPromptEventId,
                reason: "completion_seen_before_submitted_prompt",
                requestKey,
                threadId,
                turnCompleteSeen,
                workspaceId,
              });
            }
            if (shouldContinuePolling) {
              window.setTimeout(() => {
                requestWorkspaceThreadTranscript({
                  ...event,
                  delayMs: 0,
                  expectedMessageCreatedAt,
                  expectedUserMessage,
                  pollStartedAt,
                  pollUntilTurnComplete: true,
                  promptEventId,
                  providerSessionId: sessionId || providerSessionId,
                });
              }, WORKSPACE_THREAD_PROJECTION_POLL_INTERVAL_MS);
            }
            return;
          }
          if (promptAccepted && promptEventId) {
            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.prompt_accepted", {
              agentId,
              matchedBy,
              promptEventId,
              requestKey,
              sessionIdPresent: Boolean(sessionId),
              threadId,
              workspaceId,
            });
            window.dispatchEvent(new CustomEvent(WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT, {
              detail: {
                agentId,
                matchedBy,
                promptEventId,
                sessionId,
                threadId,
                workspaceId,
              },
            }));
          }
          if (!sessionId && messages.length === 0) {
            const elapsedMs = Date.now() - pollStartedAt;
            const shouldContinuePolling = pollUntilTurnComplete
              && elapsedMs < WORKSPACE_THREAD_PROJECTION_POLL_TIMEOUT_MS;
            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
              agentId,
              elapsedMs,
              messageCount: messages.length,
              pollUntilTurnComplete,
              reason: "empty_result",
              requestKey,
              sessionIdPresent: Boolean(sessionId),
              shouldContinuePolling,
              threadId,
              workspaceId,
            });
            if (shouldContinuePolling) {
              window.setTimeout(() => {
                requestWorkspaceThreadTranscript({
                  ...event,
                  delayMs: 0,
                  expectedMessageCreatedAt,
                  expectedUserMessage,
                  pollStartedAt,
                  pollUntilTurnComplete: true,
                  promptEventId,
                });
              }, WORKSPACE_THREAD_PROJECTION_POLL_INTERVAL_MS);
            }
            return;
          }
          if (staleTranscriptCompletionBlocked) {
            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
              activeRunningTurnAtTranscriptResult,
              agentId,
              matchedBy,
              messageCount: messages.length,
              pollUntilTurnComplete,
              promptEventId,
              rawTurnCompleteSeen,
              reason: "stale_completion_not_current_turn",
              requestKey,
              sessionIdPresent: Boolean(sessionId),
              terminalReadinessCanSettleTurn,
              threadId,
              transcriptTargetsLatestRunningTurn,
              workspaceId,
            });
            logTerminalStatus("frontend.terminal_status.stale_transcript_completion_ignored", {
              agentId,
              latestRunningTurnId: latestTurnAtTranscriptResult?.turnId || latestTurnAtTranscriptResult?.id || "",
              latestRunningTurnMessageId: latestTurnAtTranscriptResult?.messageId || "",
              matchedBy,
              promptEventId,
              rawTurnCompleteSeen,
              requestKey,
              terminalReadinessCanSettleTurn,
              threadId,
              workspaceId,
            });
            return;
          }

          setWorkspaceThreads((threads) => {
            const beforeSnapshot = getWorkspaceThreadDiagnosticSnapshot(
              threads,
              workspaceId,
              threadId,
              agentId,
            );
            const nextThreads = hydrateWorkspaceThreadSessionTranscript(threads, {
              agentId,
              expectedMessageCreatedAt,
              expectedUserMessage,
              latestTimestamp: result?.latestTimestamp || "",
              messages,
              matchedBy: result?.matchedBy || "",
              promptEventId,
              promptEventSubmittedAt: event.promptEventSubmittedAt || submittedAt || expectedMessageCreatedAt,
              promptAccepted,
              providerSessionId: sessionId,
              requestedProviderSessionId: sessionId || providerSessionId,
              rolloutPath: result?.rolloutPath || "",
              sessionId,
              sessionTitle: result?.sessionTitle || "",
              source: `${agentId}-session`,
              sourcePath: result?.rolloutPath || "",
              submittedAt,
              allowTranscriptTurnCompletion,
              assistantResponseCompletesTurn,
              transcriptExplicitCompletionCanSettleTurn,
              threadId,
              turnCompleteSeen,
              workspaceId,
            });
            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.apply", {
              after: getWorkspaceThreadDiagnosticSnapshot(
                nextThreads,
                workspaceId,
                threadId,
                agentId,
              ),
              agentId,
              before: beforeSnapshot,
              messageCount: messages.length,
              requestKey,
              stateChanged: nextThreads !== threads,
              threadId,
              workspaceId,
            });
            return nextThreads;
          });
          if (turnCompleteSeen && voicePlanPromptEventId.startsWith("voice-plan-") && promptAccepted) {
            logTerminalStatus("frontend.voice_plan.lifecycle_dispatch", {
              agentId,
              completionSource: trustedVoicePlanTerminalFinish
                ? "transcript_session_terminal_finish"
                : "transcript_turn_complete",
              matchedBy,
              pendingPromptId: voicePlanPromptEventId,
              promptAccepted,
              promptEventId: voicePlanPromptEventId,
              reason: "transcript_turn_complete_seen",
              threadId,
              type: "provider-turn-completed",
              workspaceId,
            });
            window.dispatchEvent(new CustomEvent(VOICE_PLAN_TASK_LIFECYCLE_EVENT, {
              detail: {
                agentId,
                completionSource: trustedVoicePlanTerminalFinish
                  ? "transcript_session_terminal_finish"
                  : "transcript_turn_complete",
                matchedBy,
                pendingPromptId: voicePlanPromptEventId,
                promptAccepted,
                promptEventId: voicePlanPromptEventId,
                threadId,
                turnCompleteSeen: true,
                type: "provider-turn-completed",
                workspaceId,
              },
            }));
          }
          if (pollUntilTurnComplete) {
            const elapsedMs = Date.now() - pollStartedAt;
            const shouldContinuePolling = (
              !(turnCompleteSeen || assistantResponseCompletesTurn)
              || (voicePlanPromptEventId.startsWith("voice-plan-") && !promptAccepted)
            )
              && elapsedMs < WORKSPACE_THREAD_PROJECTION_POLL_TIMEOUT_MS;
            logWorkspaceThreadDiagnosticEvent("frontend.thread_projection.poll", {
              agentId,
              elapsedMs,
              expectedUserMessagePresent: Boolean(expectedUserMessage),
              requestKey,
              shouldContinuePolling,
              threadId,
              turnCompleteSeen,
              workspaceId,
            });
            logTerminalStatus("frontend.terminal_status.transcript_poll_decision", {
              agentId,
              elapsedMs,
              promptEventId,
              requestKey,
              shouldContinuePolling,
              settledAssistantResponseSeen,
              terminalGroundTruthStatus: (turnCompleteSeen || assistantResponseCompletesTurn) && (
                !voicePlanPromptEventId.startsWith("voice-plan-") || promptAccepted
              ) ? "idle_or_done" : "processing_or_unknown",
              threadId,
              turnCompleteSeen,
              workspaceId,
            });
            if (shouldContinuePolling) {
              window.setTimeout(() => {
                requestWorkspaceThreadTranscript({
                  ...event,
                  delayMs: 0,
                  expectedMessageCreatedAt,
                  expectedUserMessage,
                  pollStartedAt,
                  pollUntilTurnComplete: true,
                  providerSessionId: sessionId || providerSessionId,
                });
              }, WORKSPACE_THREAD_PROJECTION_POLL_INTERVAL_MS);
            }
          }
        })
        .catch((error) => {
          const elapsedMs = Date.now() - pollStartedAt;
          const shouldContinuePolling = !providerSessionId
            && pollUntilTurnComplete
            && elapsedMs < WORKSPACE_THREAD_PROJECTION_POLL_TIMEOUT_MS;
          logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.error", {
            agentId,
            command: transcriptCommand,
            elapsedMs,
            expectedPrompt: getBigViewTextDiagnosticFields(expectedUserMessage),
            message: error?.message || String(error || ""),
            providerSessionPresent: Boolean(providerSessionId),
            promptEventIdPresent: Boolean(promptEventId),
            requestKey,
            shouldContinuePolling,
            threadId,
            workspaceId,
          });
          if (shouldContinuePolling) {
            window.setTimeout(() => {
              requestWorkspaceThreadTranscript({
                ...event,
                delayMs: 0,
                expectedMessageCreatedAt,
                expectedUserMessage,
                pollStartedAt,
                pollUntilTurnComplete: true,
                promptEventId,
              });
            }, WORKSPACE_THREAD_PROJECTION_POLL_INTERVAL_MS);
          }
        })
        .finally(() => {
          const current = workspaceThreadTranscriptRequestsRef.current.get(requestKey);
          if (current?.inFlight) {
            workspaceThreadTranscriptRequestsRef.current.delete(requestKey);
          }
        });
    };

    const delayMs = Math.max(0, Number.parseInt(event.delayMs, 10) || 0);
    const timer = window.setTimeout(runRequest, delayMs);
    workspaceThreadTranscriptRequestsRef.current.set(requestKey, { inFlight: false, timer });
    logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.schedule", {
      agentId,
      delayMs,
      requestKey,
      requestedCwdPresent: Boolean(requestedCwd),
      requestedProviderSessionPresent: Boolean(requestedProviderSessionId),
      requestedRepoPathPresent: Boolean(requestedRepoPath),
      snapshot: getWorkspaceThreadDiagnosticSnapshot(
        workspaceThreadsRef.current,
        workspaceId,
        threadId,
        agentId,
      ),
      threadId,
      workspaceId,
    });
  }, []);

  const handleThreadTerminalLifecycle = useCallback((event = {}) => {
    if (!event.workspaceId) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_lifecycle.skip", {
        reason: "missing_workspace",
        threadId: event.threadId || "",
        type: event.type || "",
      });
      return;
    }

    let lifecycleEvent = event;
    if (event.type === "message-submitted") {
      const existingThread = event.threadId
        ? workspaceThreadsRef.current?.[event.workspaceId]?.threads?.[event.threadId]
        : getWorkspaceThreadForTerminalIndex(
          workspaceThreadsRef.current,
          event.workspaceId,
          event.terminalIndex,
        );
      const promptEventId = String(
        event.promptEventId
          || event.pendingPromptId
          || event.promptId
          || "",
      ).trim();
      const messageCreatedAt = event.messageCreatedAt
        || event.promptEventSubmittedAt
        || event.submittedAt
        || new Date().toISOString();
      lifecycleEvent = {
        ...event,
        messageCreatedAt,
        messageId: event.messageId || promptEventId || `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`,
        pendingPromptId: event.pendingPromptId || promptEventId,
        promptEventId: event.promptEventId || promptEventId,
        promptEventSubmittedAt: event.promptEventSubmittedAt || messageCreatedAt,
        threadId: event.threadId
          || existingThread?.id
          || createWorkspaceThreadId(event.workspaceId, event.terminalIndex),
      };
    } else if (!event.threadId && event.terminalIndex != null) {
      const mappedThread = getWorkspaceThreadForTerminalIndex(
        workspaceThreadsRef.current,
        event.workspaceId,
        event.terminalIndex,
      );
      if (mappedThread?.id) {
        lifecycleEvent = {
          ...lifecycleEvent,
          threadId: mappedThread.id,
        };
      }
    }

    const lifecycleAgentId = String(
      lifecycleEvent.agentId || lifecycleEvent.currentAgent || "",
    ).trim().toLowerCase();
    const lifecycleThreadId = String(lifecycleEvent.threadId || "").trim();
    const lifecycleWorkspaceId = String(lifecycleEvent.workspaceId || "").trim();
    const lifecycleNativeSessionId = String(
      lifecycleEvent.nativeSessionId || lifecycleEvent.providerSessionId || "",
    ).trim();
    if (!lifecycleEvent.nativeSessionId && lifecycleEvent.providerSessionId) {
      lifecycleEvent = {
        ...lifecycleEvent,
        nativeSessionId: lifecycleNativeSessionId,
      };
    }
    const lifecycleThreadForGroundTruth = lifecycleThreadId
      ? workspaceThreadsRef.current?.[lifecycleWorkspaceId]?.threads?.[lifecycleThreadId] || null
      : null;
    const lifecycleProviderBindingForGroundTruth = getWorkspaceThreadProviderBinding(
      lifecycleThreadForGroundTruth,
      lifecycleAgentId,
    );
    const lifecycleLiveTerminalForGroundTruth = getLiveTerminalForThread(
      lifecycleThreadForGroundTruth,
      lifecycleProviderBindingForGroundTruth,
      workspaceThreadsRef.current?.[lifecycleWorkspaceId],
    );
    const lifecycleEventTerminal = {
      ...(lifecycleLiveTerminalForGroundTruth || {}),
      inputReady: lifecycleEvent.inputReady === true
        ? true
        : lifecycleEvent.inputReady === false
          ? false
          : lifecycleLiveTerminalForGroundTruth?.inputReady,
      inputReadyAt: lifecycleEvent.inputReadyAt
        || lifecycleEvent.promptReadyAt
        || lifecycleLiveTerminalForGroundTruth?.inputReadyAt
        || "",
      inputReadyConfidence: lifecycleEvent.inputReadyConfidence
        || lifecycleEvent.promptReadyConfidence
        || lifecycleLiveTerminalForGroundTruth?.inputReadyConfidence
        || "",
      instanceId: lifecycleEvent.instanceId || lifecycleLiveTerminalForGroundTruth?.instanceId || "",
      paneId: lifecycleEvent.paneId || lifecycleLiveTerminalForGroundTruth?.paneId || "",
      promptReadyAt: lifecycleEvent.promptReadyAt
        || lifecycleEvent.inputReadyAt
        || lifecycleLiveTerminalForGroundTruth?.promptReadyAt
        || "",
      status: lifecycleEvent.status || lifecycleLiveTerminalForGroundTruth?.status || "active",
      terminalIndex: lifecycleEvent.terminalIndex ?? lifecycleLiveTerminalForGroundTruth?.terminalIndex,
      threadId: lifecycleThreadId || lifecycleLiveTerminalForGroundTruth?.threadId || "",
    };
    const lifecycleGroundTruth = getThreadTerminalGroundTruth({
      lifecycleEvent,
      liveTerminal: lifecycleEventTerminal,
      providerBinding: lifecycleProviderBindingForGroundTruth,
      targetRole: lifecycleAgentId,
      terminalOutputText: lifecycleEvent.promptingUserText
        || lifecycleEvent.outputText
        || lifecycleEvent.terminalText
        || lifecycleEvent.text
        || "",
      thread: lifecycleThreadForGroundTruth,
    });
    const lifecycleStartsWork = (
      lifecycleEvent.type === "message-submitted"
      || lifecycleEvent.type === "provider-turn-started"
      || lifecycleEvent.type === "thread-starting"
      || (
        lifecycleEvent.type === "agent-output"
        && ["thinking", "running"].includes(String(
          lifecycleEvent.activityStatus || lifecycleEvent.status || "",
        ).trim().toLowerCase())
      )
    );
    lifecycleEvent = {
      ...lifecycleEvent,
      promptingUserConfidence: lifecycleGroundTruth.promptingUserConfidence || "",
      promptingUserKind: lifecycleGroundTruth.promptingUserKind || "",
      promptingUserSource: lifecycleGroundTruth.promptingUserSource || "",
      promptingUserText: lifecycleGroundTruth.promptingUserText || "",
      terminalIsComplete: lifecycleStartsWork ? false : lifecycleGroundTruth.terminalIsComplete === true,
      terminalIsPromptingUser: lifecycleStartsWork ? false : lifecycleGroundTruth.terminalIsPromptingUser === true,
      terminalWorkState: lifecycleStartsWork ? "running" : lifecycleGroundTruth.terminalWorkState || "",
    };
    logTerminalStatus("frontend.terminal_status.lifecycle_received", {
      activityStatus: lifecycleEvent.activityStatus || "",
      agentId: lifecycleAgentId,
      hasNativeSessionId: Boolean(lifecycleNativeSessionId),
      hasOutputText: Boolean(lifecycleEvent.outputText || lifecycleEvent.text),
      instanceId: lifecycleEvent.instanceId || "",
      pendingPromptId: lifecycleEvent.pendingPromptId || lifecycleEvent.promptId || "",
      promptEventId: lifecycleEvent.promptEventId || "",
      promptingUserKind: lifecycleEvent.promptingUserKind || "",
      promptingUserSource: lifecycleEvent.promptingUserSource || "",
      source: lifecycleEvent.source || "",
      status: lifecycleEvent.status || "",
      terminalGroundTruthStatus: lifecycleEvent.terminalWorkState
        || lifecycleEvent.activityStatus
        || (lifecycleEvent.type === "terminal-input-ready" || lifecycleEvent.type === "terminal-prompt-ready"
          ? "idle"
          : lifecycleEvent.type === "provider-turn-started" || lifecycleEvent.type === "message-submitted"
            ? "processing"
            : lifecycleEvent.type === "provider-turn-completed"
              ? "idle_or_done"
              : ""),
      terminalIsComplete: lifecycleEvent.terminalIsComplete === true,
      terminalIsPromptingUser: lifecycleEvent.terminalIsPromptingUser === true,
      terminalIndex: lifecycleEvent.terminalIndex ?? "",
      threadId: lifecycleThreadId,
      type: lifecycleEvent.type || "",
      workspaceId: lifecycleWorkspaceId,
    });
    setWorkspaceNotifications((current) => reduceThreadLifecycleNotificationEvent(
      current,
      lifecycleEvent,
      {
        selectedWorkspaceId: selectedWorkspaceIdRef.current,
        workspaceId: lifecycleWorkspaceId,
      },
    ));
    let lifecyclePromptEventId = String(
      lifecycleEvent.promptEventId
        || lifecycleEvent.pendingPromptId
        || lifecycleEvent.promptId
        || "",
    ).trim();
    if (
      !lifecyclePromptEventId
      && (
        lifecycleEvent.type === "terminal-prompt-ready"
        || lifecycleEvent.type === "terminal-input-ready"
      )
    ) {
      const lifecycleThread = workspaceThreadsRef.current?.[lifecycleWorkspaceId]?.threads?.[lifecycleThreadId];
      lifecyclePromptEventId = getPromptEventIdFromRunningThread(lifecycleThread);
      if (lifecyclePromptEventId) {
        lifecycleEvent = {
          ...lifecycleEvent,
          promptEventId: lifecyclePromptEventId,
          pendingPromptId: lifecycleEvent.pendingPromptId || lifecyclePromptEventId,
        };
      }
    }
    if (
      lifecycleEvent.type === "terminal-prompt-ready"
      || lifecycleEvent.type === "terminal-input-ready"
    ) {
      recordThreadTerminalReadiness(lifecycleEvent);
      logTerminalStatus("frontend.terminal_cli.readiness_signal_received", {
        agentId: lifecycleAgentId,
        eventTime: new Date().toISOString(),
        inputReadyAt: lifecycleEvent.inputReadyAt || lifecycleEvent.promptReadyAt || "",
        inputReadyConfidence: lifecycleEvent.inputReadyConfidence || "",
        instanceId: lifecycleEvent.instanceId || "",
        nativeSessionIdPresent: Boolean(lifecycleEvent.nativeSessionId || lifecycleEvent.providerSessionId),
        paneId: lifecycleEvent.paneId || "",
        promptEventId: lifecyclePromptEventId,
        source: lifecycleEvent.source || "",
        terminalIndex: lifecycleEvent.terminalIndex ?? "",
        threadId: lifecycleThreadId,
        type: lifecycleEvent.type || "",
        workspaceId: lifecycleWorkspaceId,
      });
    }
    if (lifecycleEvent.type === "provider-turn-completed" && lifecycleEvent.paneId) {
      invoke("terminal_provider_turn_completed", {
        paneId: lifecycleEvent.paneId,
        instanceId: Number.isFinite(Number(lifecycleEvent.instanceId))
          ? Number(lifecycleEvent.instanceId)
          : null,
        reason: lifecycleEvent.source || lifecycleEvent.completionSource || "provider-turn-completed",
      }).then((result) => {
        logTerminalStatus("frontend.provider_turn_completed.reconcile_result", {
          paneId: lifecycleEvent.paneId || "",
          promptEventId: lifecyclePromptEventId,
          result,
          threadId: lifecycleThreadId,
          workspaceId: lifecycleWorkspaceId,
        });
      }).catch((error) => {
        logTerminalStatus("frontend.provider_turn_completed.reconcile_error", {
          message: error?.message || String(error || ""),
          paneId: lifecycleEvent.paneId || "",
          promptEventId: lifecyclePromptEventId,
          threadId: lifecycleThreadId,
          workspaceId: lifecycleWorkspaceId,
        });
      });
    }
    if (
      lifecyclePromptEventId.startsWith("voice-plan-")
      && (
        lifecycleEvent.type === "provider-turn-completed"
        || lifecycleEvent.type === "provider-turn-error"
      )
    ) {
      logTerminalStatus("frontend.voice_plan.lifecycle_dispatch", {
        completionInferred: lifecycleEvent.completionInferred === true,
        lifecycleType: lifecycleEvent.type,
        promptEventId: lifecyclePromptEventId,
        reason: "thread_terminal_lifecycle",
        terminalGroundTruthStatus: lifecycleEvent.type === "provider-turn-error" ? "error" : "idle_or_done",
        threadId: lifecycleThreadId,
        workspaceId: lifecycleWorkspaceId,
      });
      window.dispatchEvent(new CustomEvent(VOICE_PLAN_TASK_LIFECYCLE_EVENT, {
        detail: {
          ...lifecycleEvent,
          completionInferred: lifecycleEvent.completionInferred === true,
          promptEventId: lifecyclePromptEventId,
          type: lifecycleEvent.type,
        },
      }));
    } else if (
      lifecyclePromptEventId.startsWith("voice-plan-")
      && lifecycleEvent.type === "terminal-prompt-ready"
    ) {
      logTerminalStatus("frontend.voice_plan.lifecycle_not_dispatched", {
        lifecycleType: lifecycleEvent.type,
        promptEventId: lifecyclePromptEventId,
        reason: "terminal_prompt_ready_is_not_provider_turn_complete",
        terminalGroundTruthStatus: "idle_or_prompt_ready",
        threadId: lifecycleThreadId,
        workspaceId: lifecycleWorkspaceId,
      });
    }
    setPendingSpecEditIntents((current) => {
      let changed = false;
      const next = { ...current };
      Object.entries(current).forEach(([intentId, intent]) => {
        if (specEditIntentResolvedByLifecycleEvent(intent, lifecycleEvent)) {
          delete next[intentId];
          changed = true;
        }
      });
      return changed ? next : current;
    });
    logWorkspaceThreadDiagnosticEvent("frontend.thread_lifecycle.event", {
      activityStatus: lifecycleEvent.activityStatus || "",
      agentId: lifecycleAgentId,
      freshSession: Boolean(lifecycleEvent.freshSession),
      hasNativeSessionId: Boolean(lifecycleNativeSessionId),
      hasOutputText: Boolean(lifecycleEvent.outputText || lifecycleEvent.text),
      instanceId: lifecycleEvent.instanceId || "",
      outputTextLength: getThreadDiagnosticTextLength(
        lifecycleEvent.outputText || lifecycleEvent.text || "",
      ),
      paneId: lifecycleEvent.paneId || "",
      source: lifecycleEvent.source || "",
      status: lifecycleEvent.status || "",
      terminalIndex: lifecycleEvent.terminalIndex ?? "",
      threadId: lifecycleThreadId,
      transcriptHydrationMode: lifecycleEvent.transcriptHydrationMode || "",
      type: lifecycleEvent.type || "",
      userMessageLength: getThreadDiagnosticTextLength(lifecycleEvent.userMessage || ""),
      userMessageText: getBigViewTextDiagnosticFields(
        lifecycleEvent.userMessage || lifecycleEvent.message || "",
      ),
      workspaceId: lifecycleWorkspaceId,
      snapshot: getWorkspaceThreadDiagnosticSnapshot(
        workspaceThreadsRef.current,
        lifecycleWorkspaceId,
        lifecycleThreadId,
        lifecycleAgentId,
      ),
    });

    if (lifecycleEvent.type === "provider-session" || lifecycleEvent.type === "opened") {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_session.input", {
        agentId: lifecycleAgentId,
        hasNativeSessionId: Boolean(lifecycleNativeSessionId),
        instanceId: lifecycleEvent.instanceId || "",
        nativeSessionKind: lifecycleEvent.nativeSessionKind || "",
        nativeSessionSource: lifecycleEvent.nativeSessionSource || lifecycleEvent.source || "",
        paneId: lifecycleEvent.paneId || "",
        providerSessionIdPresent: Boolean(lifecycleEvent.providerSessionId),
        snapshot: getWorkspaceThreadDiagnosticSnapshot(
          workspaceThreadsRef.current,
          lifecycleWorkspaceId,
          lifecycleThreadId,
          lifecycleAgentId,
        ),
        terminalIndex: lifecycleEvent.terminalIndex ?? "",
        threadId: lifecycleThreadId,
        type: lifecycleEvent.type || "",
        workspaceId: lifecycleWorkspaceId,
      });
    }

    if (
      lifecycleEvent.type === "message-submitted"
      || lifecycleEvent.type === "provider-turn-started"
      || lifecycleEvent.type === "provider-turn-completed"
      || lifecycleEvent.type === "terminal-prompt-ready"
      || lifecycleEvent.type === "provider-turn-error"
    ) {
      const projectionEvents = Array.isArray(lifecycleEvent.projectionEvents)
        ? lifecycleEvent.projectionEvents
        : Array.isArray(lifecycleEvent.events)
          ? lifecycleEvent.events
          : [];
      const userProjectionEvents = projectionEvents.filter((projectionEvent) => (
        projectionEvent?.type === "thread.message.user"
      ));
      logWorkspaceThreadDiagnosticEvent("frontend.thread_projection.input", {
        agentId: lifecycleAgentId,
        existingSnapshot: getWorkspaceThreadDiagnosticSnapshot(
          workspaceThreadsRef.current,
          lifecycleWorkspaceId,
          lifecycleThreadId,
          lifecycleAgentId,
        ),
        messageId: lifecycleEvent.messageId || "",
        pendingPromptId: lifecycleEvent.pendingPromptId || lifecycleEvent.promptId || "",
        projectionEventCount: projectionEvents.length,
        projectionSources: Array.from(new Set(
          projectionEvents.map((projectionEvent) => projectionEvent?.source || "").filter(Boolean),
        )),
        source: lifecycleEvent.source || "",
        threadId: lifecycleThreadId,
        type: lifecycleEvent.type || "",
        userMessageLength: getThreadDiagnosticTextLength(
          lifecycleEvent.userMessage || lifecycleEvent.message || "",
        ),
        userMessageText: getBigViewTextDiagnosticFields(
          lifecycleEvent.userMessage || lifecycleEvent.message || "",
        ),
        userProjectionEventCount: userProjectionEvents.length,
        userProjectionMessageIds: userProjectionEvents
          .map((projectionEvent) => projectionEvent?.messageId || "")
          .filter(Boolean)
          .slice(0, 8),
        workspaceId: lifecycleWorkspaceId,
      });
    }

    if (
      lifecycleEvent.type === "pending-prompt-sent"
      || lifecycleEvent.type === "provider-turn-completed"
      || lifecycleEvent.type === "terminal-prompt-ready"
    ) {
      settleWorkspacePromptDelivery(lifecycleEvent.pendingPromptId || lifecycleEvent.promptId);
    } else if (lifecycleEvent.type === "pending-prompt-error") {
      settleWorkspacePromptDelivery(
        lifecycleEvent.pendingPromptId || lifecycleEvent.promptId,
        lifecycleEvent.error || "Unable to send pending prompt.",
      );
    } else if (lifecycleEvent.type === "provider-turn-error") {
      settleWorkspacePromptDelivery(
        lifecycleEvent.pendingPromptId || lifecycleEvent.promptId,
        lifecycleEvent.error || "Unable to send pending prompt.",
      );
    } else if (["closed", "exited", "error"].includes(lifecycleEvent.type)) {
      rejectWorkspacePromptDeliveriesForThread(
        lifecycleWorkspaceId,
        lifecycleThreadId,
        lifecycleEvent.error || "Terminal closed before sending the pending prompt.",
      );
    }

    if (
      lifecycleThreadId
      && workspaceThreadIdIsArchived(workspaceThreadsRef.current, lifecycleWorkspaceId, lifecycleThreadId)
    ) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_lifecycle.skip", {
        agentId: lifecycleAgentId,
        reason: "thread_archived",
        threadId: lifecycleThreadId,
        type: lifecycleEvent.type || "",
        workspaceId: lifecycleWorkspaceId,
      });
      return;
    }
    if (
      lifecycleNativeSessionId
      && workspaceThreadSessionIsArchived(
        workspaceThreadsRef.current,
        lifecycleWorkspaceId,
        lifecycleAgentId,
        lifecycleNativeSessionId,
      )
    ) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_lifecycle.skip", {
        agentId: lifecycleAgentId,
        reason: "provider_session_archived",
        threadId: lifecycleThreadId,
        type: lifecycleEvent.type || "",
        workspaceId: lifecycleWorkspaceId,
      });
      return;
    }

    setWorkspaceThreads((threads) => {
      const beforeSnapshot = getWorkspaceThreadDiagnosticSnapshot(
        threads,
        lifecycleWorkspaceId,
        lifecycleThreadId,
        lifecycleAgentId,
      );
      const beforeHasSession = (
        beforeSnapshot.providerSessionIdPresent
        || beforeSnapshot.transcriptSessionIdPresent
      );
      const beforeTerminalBindingActive = Boolean(beforeSnapshot.hasTerminalBinding);
      const shouldApplyProviderSessionFromOpen = (
        lifecycleEvent.type === "opened"
        && lifecycleThreadId
        && lifecycleNativeSessionId
        && Boolean(lifecycleEvent.nativeSessionId || lifecycleEvent.providerSessionId)
      );
      let operation = "update_active_terminal";
      let nextThreads = threads;
      const getReadinessProjectionEvents = (existingThread, event) => {
        if (!existingThread) {
          return [];
        }

        const providerBinding = getWorkspaceThreadProviderBinding(existingThread, lifecycleAgentId);
        const liveTerminal = getLiveTerminalForThread(
          existingThread,
          providerBinding,
          threads?.[lifecycleWorkspaceId],
        );
        const readinessAt = event.inputReadyAt
          || event.promptReadyAt
          || event.completedAt
          || new Date().toISOString();
        const readinessTerminal = {
          ...(liveTerminal || {}),
          inputReady: true,
          inputReadyAt: readinessAt,
          instanceId: event.instanceId || liveTerminal?.instanceId || "",
          paneId: event.paneId || liveTerminal?.paneId || "",
          promptReadyAt: event.promptReadyAt || readinessAt,
          status: event.status || liveTerminal?.status || "active",
          terminalIndex: event.terminalIndex ?? liveTerminal?.terminalIndex,
          threadId: event.threadId || liveTerminal?.threadId || existingThread.id || "",
        };
        const groundTruth = getThreadTerminalGroundTruth({
          liveTerminal: readinessTerminal,
          providerBinding,
          targetRole: lifecycleAgentId,
          thread: existingThread,
        });
        logTerminalStatus("frontend.terminal_status.readiness_projection_decision", {
          agentId: lifecycleAgentId,
          inputReadyAt: readinessAt,
          inputReadyIsFreshForTurn: Boolean(groundTruth.inputReadyIsFreshForTurn),
          latestTurnState: groundTruth.latestTurnState || "",
          orphanRunningLooksIdle: Boolean(groundTruth.orphanRunningLooksIdle),
          runningTurnLooksIdle: Boolean(groundTruth.runningTurnLooksIdle),
          terminalGroundTruthStatus: groundTruth.terminalGroundTruthStatus || "",
          terminalIndex: event.terminalIndex ?? "",
          threadId: lifecycleThreadId,
          type: event.type || "",
          workspaceId: lifecycleWorkspaceId,
        });
        return buildTerminalReadyProjectionEvents(existingThread, event, groundTruth);
      };
      if (lifecycleEvent.type === "provider-session") {
        operation = "provider_session";
        nextThreads = updateWorkspaceThreadProviderSession(threads, lifecycleEvent);
      } else if (lifecycleEvent.type === "model-selected") {
        operation = "model_selected";
        nextThreads = updateWorkspaceThreadProviderModel(threads, lifecycleEvent);
      } else if (lifecycleEvent.type === "pending-prompt-sent") {
        operation = "pending_prompt_sent";
        nextThreads = clearWorkspaceThreadPendingPrompt(threads, lifecycleEvent);
      } else if (lifecycleEvent.type === "pending-prompt-error") {
        operation = "pending_prompt_error";
        nextThreads = threads;
      } else if (lifecycleEvent.type === "provider-turn-started") {
        operation = "provider_turn_started";
        nextThreads = appendWorkspaceThreadProjectionEvents(threads, lifecycleEvent);
      } else if (lifecycleEvent.type === "provider-turn-completed" || lifecycleEvent.type === "provider-turn-error") {
        operation = lifecycleEvent.type === "provider-turn-error"
          ? "provider_turn_error"
          : "provider_turn_completed";
        nextThreads = appendWorkspaceThreadProjectionEvents(threads, lifecycleEvent);
      } else if (lifecycleEvent.type === "terminal-input-ready") {
        const existingThread = threads?.[lifecycleWorkspaceId]?.threads?.[lifecycleThreadId];
        const projectionEvents = getReadinessProjectionEvents(existingThread, lifecycleEvent);
        if (!existingThread && !projectionEvents.length) {
          operation = "terminal_input_ready_active_terminal";
          nextThreads = updateWorkspaceActiveTerminal(threads, {
            ...lifecycleEvent,
            activityStatus: "idle",
            status: lifecycleEvent.status || "active",
          });
        } else {
          operation = projectionEvents.length
            ? "terminal_input_ready_completed"
            : "terminal_input_ready_idle";
          nextThreads = projectionEvents.length
            ? appendWorkspaceThreadProjectionEvents(threads, {
              ...lifecycleEvent,
              clearPendingPrompt: true,
              projectionEvents,
            })
            : markWorkspaceThreadAgentActivity(threads, {
              ...lifecycleEvent,
              activityStatus: "idle",
            });
        }
      } else if (lifecycleEvent.type === "terminal-prompt-ready") {
        const existingThread = threads?.[lifecycleWorkspaceId]?.threads?.[lifecycleThreadId];
        const projectionEvents = getReadinessProjectionEvents(existingThread, lifecycleEvent);
        logTerminalStatus("frontend.terminal_cli.finish_candidate_projection", {
          agentId: lifecycleAgentId,
          eventTime: new Date().toISOString(),
          inputReadyAt: lifecycleEvent.inputReadyAt || lifecycleEvent.promptReadyAt || "",
          projectionEventCount: projectionEvents.length,
          projectedCompletion: projectionEvents.some((projectionEvent) => (
            projectionEvent?.type === "thread.turn.completed"
            || projectionEvent?.type === "thread.turn.error"
          )),
          promptEventId: lifecyclePromptEventId,
          source: lifecycleEvent.source || "",
          terminalIndex: lifecycleEvent.terminalIndex ?? "",
          threadId: lifecycleThreadId,
          type: lifecycleEvent.type || "",
          workspaceId: lifecycleWorkspaceId,
        });
        if (!existingThread && !projectionEvents.length) {
          operation = "terminal_prompt_ready_active_terminal";
          nextThreads = updateWorkspaceActiveTerminal(threads, {
            ...lifecycleEvent,
            activityStatus: "idle",
            status: lifecycleEvent.status || "active",
          });
        } else {
          operation = projectionEvents.length
            ? "terminal_prompt_ready_completed"
            : "terminal_prompt_ready_idle";
          nextThreads = projectionEvents.length
            ? appendWorkspaceThreadProjectionEvents(threads, {
              ...lifecycleEvent,
              clearPendingPrompt: true,
              projectionEvents,
            })
            : markWorkspaceThreadAgentActivity(threads, {
              ...lifecycleEvent,
              activityStatus: "idle",
            });
        }
      } else if (lifecycleEvent.type === "agent-output") {
        operation = "mark_agent_activity";
        nextThreads = markWorkspaceThreadAgentActivity(threads, lifecycleEvent);
      } else if (lifecycleEvent.type === "message-submitted" || lifecycleEvent.type === "thread-starting") {
        operation = lifecycleEvent.type === "message-submitted"
          ? "materialize_message_submitted"
          : "materialize_thread_starting";
        nextThreads = materializeWorkspaceThreadForTerminal(threads, lifecycleEvent);
      } else if (lifecycleEvent.type === "closed" || lifecycleEvent.type === "exited" || lifecycleEvent.type === "error") {
        operation = "terminal_detached";
        nextThreads = markWorkspaceThreadTerminalDetached(threads, {
          agentId: lifecycleEvent.agentId || lifecycleEvent.currentAgent,
          forgetTerminalThread: lifecycleEvent.forgetTerminalThread,
          rememberTerminalThread: lifecycleEvent.rememberTerminalThread,
          status: lifecycleEvent.type === "error" ? "error" : lifecycleEvent.type,
          instanceId: lifecycleEvent.instanceId,
          paneId: lifecycleEvent.paneId,
          terminalIndex: lifecycleEvent.terminalIndex,
          threadId: lifecycleEvent.threadId,
          workspaceId: lifecycleEvent.workspaceId,
        });
      } else if (lifecycleEvent.threadId) {
        operation = "bind_terminal";
        nextThreads = bindWorkspaceThreadTerminal(threads, lifecycleEvent);
      } else {
        nextThreads = updateWorkspaceActiveTerminal(threads, lifecycleEvent);
      }

      if (shouldApplyProviderSessionFromOpen) {
        operation = operation === "update_active_terminal" ? "opened_provider_session" : `${operation}_with_open_provider_session`;
        nextThreads = updateWorkspaceThreadProviderSession(nextThreads, {
          ...lifecycleEvent,
          source: lifecycleEvent.source || "terminal-open",
        });
      }

      const afterSnapshot = getWorkspaceThreadDiagnosticSnapshot(
        nextThreads,
        lifecycleWorkspaceId,
        lifecycleThreadId,
        lifecycleAgentId,
      );
      const afterHasSession = (
        afterSnapshot.providerSessionIdPresent
        || afterSnapshot.transcriptSessionIdPresent
      );
      const sessionTransition = beforeHasSession
        ? (afterHasSession ? "unchanged" : "lost")
        : (afterHasSession ? "acquired" : "unchanged");

      logWorkspaceThreadDiagnosticEvent("frontend.thread_lifecycle.apply", {
        after: afterSnapshot,
        agentId: lifecycleAgentId,
        before: beforeSnapshot,
        beforeHasSession,
        beforeTerminalBindingActive,
        operation,
        outputTextLength: getThreadDiagnosticTextLength(
          lifecycleEvent.outputText || lifecycleEvent.text || "",
        ),
        hasSessionTransition: sessionTransition,
        hasSessionAfter: afterHasSession,
        stateChanged: nextThreads !== threads,
        threadId: lifecycleThreadId,
        type: lifecycleEvent.type || "",
        userMessageLength: getThreadDiagnosticTextLength(lifecycleEvent.userMessage || ""),
        userMessageText: getBigViewTextDiagnosticFields(
          lifecycleEvent.userMessage || lifecycleEvent.message || "",
        ),
        workspaceId: lifecycleWorkspaceId,
      });
      logTerminalStatus("frontend.terminal_status.lifecycle_applied", {
        after: afterSnapshot,
        agentId: lifecycleAgentId,
        before: beforeSnapshot,
        eventActivityStatus: lifecycleEvent.activityStatus || "",
        eventStatus: lifecycleEvent.status || "",
        operation,
        pendingPromptId: lifecycleEvent.pendingPromptId || lifecycleEvent.promptId || "",
        stateChanged: nextThreads !== threads,
        terminalGroundTruthStatus: afterSnapshot.activityStatus
          || lifecycleEvent.activityStatus
          || (lifecycleEvent.type === "terminal-input-ready" || lifecycleEvent.type === "terminal-prompt-ready"
            ? "idle"
            : lifecycleEvent.type === "provider-turn-started" || lifecycleEvent.type === "message-submitted"
              ? "processing"
              : ""),
        terminalIndex: lifecycleEvent.terminalIndex ?? "",
        threadId: lifecycleThreadId,
        type: lifecycleEvent.type || "",
        workspaceId: lifecycleWorkspaceId,
      });
      if (
        lifecycleEvent.type === "model-selected"
        || lifecycleEvent.type === "opened"
        || lifecycleEvent.type === "provider-turn-started"
        || lifecycleEvent.type === "provider-session"
        || lifecycleEvent.model
        || lifecycleEvent.modelId
      ) {
        const beforeThread = threads?.[lifecycleWorkspaceId]?.threads?.[lifecycleThreadId];
        const afterThread = nextThreads?.[lifecycleWorkspaceId]?.threads?.[lifecycleThreadId];
        const beforeProviderBinding = getWorkspaceThreadProviderBinding(beforeThread, lifecycleAgentId);
        const afterProviderBinding = getWorkspaceThreadProviderBinding(afterThread, lifecycleAgentId);
        logBigViewSyncDiagnosticEvent("bigview.model_state.lifecycle_apply", {
          afterModel: afterProviderBinding?.modelId || "",
          afterProviderSessionPresent: Boolean(afterProviderBinding?.nativeSessionId),
          agentId: lifecycleAgentId,
          beforeModel: beforeProviderBinding?.modelId || "",
          beforeProviderSessionPresent: Boolean(beforeProviderBinding?.nativeSessionId),
          eventModel: lifecycleEvent.modelId || lifecycleEvent.model || "",
          eventModelSource: lifecycleEvent.modelSource || "",
          operation,
          stateChanged: nextThreads !== threads,
          terminalIndex: lifecycleEvent.terminalIndex ?? "",
          threadId: lifecycleThreadId,
          type: lifecycleEvent.type || "",
          workspaceId: lifecycleWorkspaceId,
        });
      }
      if (lifecycleEvent.type === "provider-session" || lifecycleEvent.type === "opened") {
        logWorkspaceThreadDiagnosticEvent("frontend.thread_session.apply_delta", {
          afterHasSession,
          afterTerminalBindingActive: Boolean(afterSnapshot.hasTerminalBinding),
          agentId: lifecycleAgentId,
          beforeHasSession,
          beforeTerminalBindingActive,
          hasNativeSessionId: Boolean(lifecycleNativeSessionId),
          operation,
          sessionTransition,
          terminalIndex: lifecycleEvent.terminalIndex ?? "",
          threadId: lifecycleThreadId,
          type: lifecycleEvent.type || "",
          workspaceId: lifecycleWorkspaceId,
        });
      }
      if (
        lifecycleEvent.type === "message-submitted"
        || lifecycleEvent.type === "provider-turn-started"
        || lifecycleEvent.type === "provider-turn-completed"
        || lifecycleEvent.type === "terminal-prompt-ready"
        || lifecycleEvent.type === "provider-turn-error"
      ) {
        logWorkspaceThreadDiagnosticEvent("frontend.thread_projection.apply_delta", {
          afterLastRole: afterSnapshot.lastRole || "",
          afterLastTextLength: afterSnapshot.lastTextLength || 0,
          afterMessageCount: afterSnapshot.messageCount || 0,
          afterProjectionEventCount: afterSnapshot.projectionEventCount || 0,
          agentId: lifecycleAgentId,
          beforeLastRole: beforeSnapshot.lastRole || "",
          beforeLastTextLength: beforeSnapshot.lastTextLength || 0,
          beforeMessageCount: beforeSnapshot.messageCount || 0,
          beforeProjectionEventCount: beforeSnapshot.projectionEventCount || 0,
          messageCountDelta: (afterSnapshot.messageCount || 0) - (beforeSnapshot.messageCount || 0),
          pendingPromptId: lifecycleEvent.pendingPromptId || lifecycleEvent.promptId || "",
          projectionEventCountDelta: (
            (afterSnapshot.projectionEventCount || 0) - (beforeSnapshot.projectionEventCount || 0)
          ),
          threadId: lifecycleThreadId,
          type: lifecycleEvent.type || "",
          workspaceId: lifecycleWorkspaceId,
        });
      }
      return nextThreads;
    });

    const lifecycleHasOutputText = Boolean(lifecycleEvent.outputText || lifecycleEvent.text);
    const lifecycleThreadForTranscript = workspaceThreadsRef.current?.[lifecycleWorkspaceId]?.threads?.[lifecycleThreadId];
    const lifecycleLatestUserMessage = lifecycleEvent.type === "terminal-prompt-ready"
      ? getLatestWorkspaceThreadUserMessage(lifecycleThreadForTranscript)
      : null;
    const lifecycleTranscriptExpectedUserMessage = String(
      lifecycleEvent.expectedUserMessage
        || lifecycleEvent.terminalPrompt
        || lifecycleEvent.terminalMessage
        || lifecycleEvent.terminalText
        || lifecycleEvent.userMessage
        || lifecycleEvent.message
        || lifecycleLatestUserMessage?.text
        || "",
    );
    const lifecycleTranscriptSubmittedAt = String(
      lifecycleEvent.messageCreatedAt
        || lifecycleEvent.promptEventSubmittedAt
        || lifecycleEvent.submittedAt
        || lifecycleLatestUserMessage?.createdAt
        || lifecycleThreadForTranscript?.latestTurn?.startedAt
        || lifecycleThreadForTranscript?.latestTurn?.requestedAt
        || "",
    );
    const shouldRequestTranscript = (
      ["claude", "codex", "opencode"].includes(
        lifecycleAgentId,
      )
      && (
        lifecycleEvent.type === "message-submitted"
        || lifecycleEvent.type === "terminal-prompt-ready"
        || lifecycleEvent.type === "provider-session"
        || (lifecycleEvent.type === "opened" && Boolean(lifecycleNativeSessionId))
      )
    );
    logWorkspaceThreadDiagnosticEvent("frontend.thread_lifecycle.transcript_decision", {
      agentId: lifecycleAgentId,
      hasOutputText: lifecycleHasOutputText,
      shouldRequestTranscript,
      threadId: lifecycleThreadId,
      type: lifecycleEvent.type || "",
      workspaceId: lifecycleWorkspaceId,
    });
    if (shouldRequestTranscript) {
      requestWorkspaceThreadTranscript({
        ...lifecycleEvent,
        allowRecovery: lifecycleEvent.type === "terminal-prompt-ready",
        allowTimestampFallback: lifecycleEvent.type === "terminal-prompt-ready"
          || lifecycleEvent.allowTimestampFallback === true,
        delayMs: lifecycleEvent.type === "message-submitted"
          ? 240
          : lifecycleEvent.type === "terminal-prompt-ready"
            ? WORKSPACE_THREAD_PROMPT_READY_TRANSCRIPT_DELAY_MS
            : 120,
        expectedMessageCreatedAt: lifecycleTranscriptSubmittedAt,
        expectedUserMessage: lifecycleTranscriptExpectedUserMessage,
        pollStartedAt: Date.now(),
        pollUntilTurnComplete: lifecycleEvent.type === "message-submitted",
        submittedAt: lifecycleTranscriptSubmittedAt,
      });
    }
  }, [
    rejectWorkspacePromptDeliveriesForThread,
    requestWorkspaceThreadTranscript,
    settleWorkspacePromptDelivery,
  ]);

  useEffect(() => {
    let unlistenPromptSubmitted = null;
    let cancelled = false;

    listen(TERMINAL_PROMPT_SUBMITTED_EVENT, (promptEvent) => {
      const payload = promptEvent?.payload || {};
      const observedPrompt = String(payload.observedPrompt || payload.prompt || "").trim();
      const expectedPrompt = String(payload.expectedPrompt || "").trim();
      const userMessage = observedPrompt || expectedPrompt || String(payload.prompt || "").trim();
      let workspaceId = String(payload.workspaceId || "").trim();
      if (!workspaceId && payload.threadId) {
        workspaceId = Object.entries(workspaceThreadsRef.current || {})
          .find(([, entry]) => Boolean(entry?.threads?.[payload.threadId]))?.[0] || "";
      }
      if (!workspaceId && payload.terminalIndex != null) {
        workspaceId = Object.entries(workspaceThreadsRef.current || {})
          .find(([candidateWorkspaceId, entry]) => Boolean(getWorkspaceThreadForTerminalIndex(
            { [candidateWorkspaceId]: entry },
            candidateWorkspaceId,
            payload.terminalIndex,
          )))?.[0] || "";
      }
      if (!userMessage || !workspaceId) {
        logWorkspaceThreadDiagnosticEvent("frontend.thread_prompt_submitted_event.skip", {
          hasPrompt: Boolean(userMessage),
          hasWorkspaceId: Boolean(workspaceId),
          instanceId: payload.instanceId || "",
          paneId: payload.paneId || "",
          threadId: payload.threadId || "",
        });
        return;
      }
      if (isTerminalControlHistoryPrompt(userMessage)) {
        logWorkspaceThreadDiagnosticEvent("frontend.thread_prompt_submitted_event.skip", {
          instanceId: payload.instanceId || "",
          paneId: payload.paneId || "",
          promptText: getBigViewTextDiagnosticFields(userMessage),
          reason: "terminal_control_prompt",
          threadId: payload.threadId || "",
          workspaceId,
        });
        return;
      }

      let submittedAgentId = String(payload.agentId || payload.agentKind || "").trim().toLowerCase();
      const submittedThread = payload.threadId
        ? workspaceThreadsRef.current?.[workspaceId]?.threads?.[payload.threadId]
        : getWorkspaceThreadForTerminalIndex(
          workspaceThreadsRef.current,
          workspaceId,
          payload.terminalIndex,
        );
      if (!submittedAgentId) {
        submittedAgentId = String(submittedThread?.currentAgent || "").trim().toLowerCase();
      }
      const submittedProviderBinding = getWorkspaceThreadProviderBinding(
        submittedThread,
        submittedAgentId,
      );
      const submittedProviderSessionId = String(
        payload.nativeSessionId
          || payload.providerSessionId
          || submittedThread?.transcriptSessionId
          || submittedProviderBinding?.nativeSessionId
          || "",
      ).trim();

      logWorkspaceThreadDiagnosticEvent("frontend.thread_prompt_submitted_event", {
        agentId: submittedAgentId,
        instanceId: payload.instanceId || "",
        paneId: payload.paneId || "",
        providerSessionPresent: Boolean(submittedProviderSessionId),
        promptEventIdPresent: Boolean(payload.promptEventId),
        promptLength: userMessage.length,
        promptMatch: payload.promptMatch,
        promptSource: payload.promptSource || "",
        promptText: getBigViewTextDiagnosticFields(userMessage),
        source: "terminal-prompt-submitted",
        terminalIndex: payload.terminalIndex ?? "",
        threadId: payload.threadId || "",
        workspaceId,
      });
      requestWorkspaceThreadTranscript({
        allowTimestampFallback: true,
        agentId: submittedAgentId,
        delayMs: 700,
        expectedMessageCreatedAt: payload.promptEventSubmittedAt || new Date().toISOString(),
        expectedUserMessage: userMessage,
        instanceId: payload.instanceId,
        paneId: payload.paneId || "",
        pollStartedAt: Date.now(),
        pollUntilTurnComplete: true,
        promptEventId: payload.promptEventId || "",
        promptEventSubmittedAt: payload.promptEventSubmittedAt || "",
        providerSessionId: submittedProviderSessionId,
        source: "terminal-prompt-submitted",
        submittedAt: payload.promptEventSubmittedAt || new Date().toISOString(),
        terminalIndex: payload.terminalIndex,
        threadId: payload.threadId || "",
        userMessage,
        workspaceId,
      });
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }

      unlistenPromptSubmitted = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenPromptSubmitted) {
        unlistenPromptSubmitted();
      }
    };
  }, [requestWorkspaceThreadTranscript]);

  useEffect(() => {
    Object.entries(workspaceThreads || {}).forEach(([workspaceId, entry]) => {
      const threads = entry?.threads || {};
      (entry?.threadOrder || Object.keys(threads)).forEach((threadId) => {
        const thread = threads[threadId];
        const agentId = String(thread?.currentAgent || "").toLowerCase();
        if (!thread || !["claude", "codex", "opencode"].includes(agentId)) {
          return;
        }

        const providerBinding = getWorkspaceThreadProviderBinding(thread, agentId);
        const hasVisibleTranscript = Array.isArray(thread.messages) && thread.messages.length > 0;
        const hasNativeSessionTitle = Boolean(providerBinding?.nativeSessionTitle);
        const titleLookupChecked = Boolean(providerBinding?.nativeSessionTitleUpdatedAt);
        const latestTurnState = String(thread?.latestTurn?.state || "").toLowerCase();
        const runningTurn = latestTurnState === "running";
        const runningPromptEventId = runningTurn ? getPromptEventIdFromRunningThread(thread) : "";
        const hasSessionPointer = Boolean(
          thread.transcriptSessionId
            || providerBinding?.nativeSessionId,
        );
        if (!hasSessionPointer) {
          if (runningTurn && thread.latestTurn?.startedAt && thread.coordination?.worktreePath) {
            const lastUserMessage = [...(Array.isArray(thread.messages) ? thread.messages : [])]
              .reverse()
              .find((message) => message?.role === "user");
            requestWorkspaceThreadTranscript({
              agentId,
              allowTimestampFallback: true,
              delayMs: 240,
              expectedMessageCreatedAt: lastUserMessage?.createdAt || thread.latestTurn?.startedAt || "",
              expectedUserMessage: lastUserMessage?.text || "",
              pollStartedAt: Date.parse(thread.latestTurn?.startedAt || thread.latestTurn?.requestedAt || "")
                || Date.now(),
              pollUntilTurnComplete: true,
              promptEventId: runningPromptEventId,
              submittedAt: thread.latestTurn?.startedAt || thread.latestTurn?.requestedAt || "",
              threadId,
              worktreePath: thread.coordination?.worktreePath || "",
              workspaceId,
            });
          }
          return;
        }

        if (runningTurn) {
          const lastUserMessage = [...(Array.isArray(thread.messages) ? thread.messages : [])]
            .reverse()
            .find((message) => message?.role === "user");
          requestWorkspaceThreadTranscript({
            agentId,
            delayMs: 160,
            expectedMessageCreatedAt: lastUserMessage?.createdAt || thread.latestTurn?.startedAt || "",
            expectedUserMessage: lastUserMessage?.text || "",
            pollStartedAt: Date.parse(thread.latestTurn?.startedAt || thread.latestTurn?.requestedAt || "")
              || Date.now(),
            pollUntilTurnComplete: true,
            promptEventId: runningPromptEventId,
            providerSessionId: thread.transcriptSessionId || providerBinding?.nativeSessionId || "",
            threadId,
            workspaceId,
          });
          return;
        }

        if (hasVisibleTranscript && (hasNativeSessionTitle || titleLookupChecked)) {
          return;
        }

        requestWorkspaceThreadTranscript({
          agentId,
          delayMs: 80,
          providerSessionId: thread.transcriptSessionId || providerBinding?.nativeSessionId || "",
          threadId,
          workspaceId,
        });
      });
    });
  }, [requestWorkspaceThreadTranscript, workspaceThreads]);

  const handlePreparedTerminalChange = useCallback((session) => {
    if (!session?.paneId) {
      return;
    }

    const key = `${session.workspaceId || ""}:${session.terminalIndex}:${session.agentId || ""}:${session.paneId}`;

    if (session.ready) {
      preparedTerminalsRef.current.set(key, {
        agentId: session.agentId || "",
        instanceId: session.instanceId,
        paneId: session.paneId,
        threadId: session.threadId || "",
        terminalIndex: session.terminalIndex,
        workspaceId: session.workspaceId || "",
      });
    } else {
      preparedTerminalsRef.current.delete(key);
    }

    setPreparedTerminalVersion((version) => version + 1);
  }, []);

  const preparedWorkspaceTerminalRequests = useMemo(() => {
    if (!activatedWorkspace || activatedWorkspaceAgentTerminalEntries.length === 0) {
      return [];
    }

    const terminalRoleByIndex = new Map(activatedWorkspaceAgentTerminalEntries.map(({ role, terminalIndex }) => (
      [terminalIndex, normalizeWorkspaceTerminalRole(role, activeAgent)]
    )));

    return Array.from(preparedTerminalsRef.current.values())
      .filter((session) => (
        session.workspaceId === activatedWorkspace.id
        && session.agentId === terminalRoleByIndex.get(session.terminalIndex)
      ))
      .sort((left, right) => left.terminalIndex - right.terminalIndex)
      .map((session) => {
        const providerBinding = getWorkspaceThreadProviderBinding(
          workspaceThreadsRef.current?.[activatedWorkspace.id]?.threads?.[session.threadId],
          session.agentId,
        );
        const providerSessionId = String(providerBinding?.nativeSessionId || "").trim();
        const storedModel = String(providerBinding?.modelId || "").trim();
        const model = storedModel || getWorkspaceAgentStartupModel(session.agentId, agentStatuses);

        return {
          instanceId: session.instanceId,
          model,
          paneId: session.paneId,
          provider: session.agentId,
          providerSessionId,
          threadId: session.threadId || "",
          terminalIndex: session.terminalIndex,
          workspaceId: activatedWorkspace.id,
        };
      });
  }, [
    activeAgent,
    activatedWorkspace?.id,
    activatedWorkspaceAgentTerminalEntries,
    agentStatuses,
    preparedTerminalVersion,
    workspaceThreads,
  ]);
  const preparedWorkspaceTerminalCount = preparedWorkspaceTerminalRequests.length;
  const shouldHoldWorkspaceRevealForTerminalBatch = Boolean(
    workspaceAgentLaunchKey
    && preparedWorkspaceTerminalCount > 0
    && workspaceAgentBatchSentKey !== workspaceAgentLaunchKey,
  );

  useEffect(() => {
    if (workspaceDeactivationInFlightRef.current) {
      return;
    }

    if (!workspaceAgentLaunchKey) {
      workspaceAgentLaunchKeyRef.current = "";
      workspaceAgentBatchInFlightKeyRef.current = "";
      setWorkspaceAgentBatchSentKey("");
      return;
    }

    if (
      workspaceAgentBatchSentKey === workspaceAgentLaunchKey
      || workspaceAgentBatchInFlightKeyRef.current === workspaceAgentLaunchKey
      || preparedWorkspaceTerminalCount === 0
      || preparedWorkspaceTerminalCount < activatedWorkspaceAgentTerminalEntries.length
    ) {
      return;
    }

    workspaceAgentLaunchKeyRef.current = workspaceAgentLaunchKey;
    workspaceAgentBatchInFlightKeyRef.current = workspaceAgentLaunchKey;
    const batchStartedAt = performance.now();

    logBigViewSyncDiagnosticEvent("bigview.model_restore.batch_start", {
      launchKey: workspaceAgentLaunchKey,
      requestCount: preparedWorkspaceTerminalRequests.length,
      requests: preparedWorkspaceTerminalRequests.map((request) => ({
        hasProviderSessionId: Boolean(request.providerSessionId),
        instanceId: request.instanceId || "",
        model: request.model || "",
        paneId: request.paneId || "",
        provider: request.provider || "",
        terminalIndex: request.terminalIndex ?? "",
        threadId: request.threadId || "",
        workspaceId: request.workspaceId || "",
      })),
      workspaceId: activatedWorkspace.id,
    });

    invoke("terminal_start_agent_many", { requests: preparedWorkspaceTerminalRequests })
      .then((result) => {
        const results = Array.isArray(result?.results) ? result.results : [];
        logBigViewSyncDiagnosticEvent("bigview.model_restore.batch_result", {
          launchKey: workspaceAgentLaunchKey,
          resultCount: results.length,
          startedCount: results.filter((paneResult) => paneResult?.started).length,
          workspaceId: activatedWorkspace.id,
        });
        results.forEach((paneResult) => {
          if (!paneResult?.started) {
            return;
          }

          const request = preparedWorkspaceTerminalRequests.find((candidate) => (
            candidate.paneId === paneResult.paneId
            && Number(candidate.instanceId || 0) === Number(paneResult.instanceId || 0)
          ));
          if (!request) {
            return;
          }

          logBigViewSyncDiagnosticEvent("bigview.model_restore.batch_pane_started", {
            hasProviderSessionId: Boolean(request.providerSessionId),
            instanceId: paneResult.instanceId || request.instanceId || "",
            model: request.model || "",
            paneId: paneResult.paneId || request.paneId || "",
            provider: request.provider || "",
            terminalIndex: request.terminalIndex ?? "",
            threadId: request.threadId || "",
            workspaceId: request.workspaceId || "",
          });

          const terminalLifecycleEvent = {
            agentId: request.provider,
            instanceId: paneResult.instanceId,
            model: request.model || "",
            modelSource: request.model ? "session-restore" : "",
            paneId: paneResult.paneId,
            status: "active",
            terminalIndex: request.terminalIndex,
            threadId: request.threadId,
            workspaceId: request.workspaceId,
          };

          setWorkspaceThreads((threads) => (
            request.threadId
              ? bindWorkspaceThreadTerminal(threads, terminalLifecycleEvent)
              : updateWorkspaceActiveTerminal(threads, terminalLifecycleEvent)
          ));

          const shouldWriteStartupModelRestore = false;
          if (request.model && request.providerSessionId && shouldWriteStartupModelRestore) {
            const restoreModelCommand = `/model ${request.model}`;
            logBigViewSyncDiagnosticEvent("bigview.model_restore.batch_write_scheduled", {
              commandLength: restoreModelCommand.length,
              delayMs: 650,
              instanceId: paneResult.instanceId || "",
              model: request.model || "",
              paneId: paneResult.paneId || "",
              provider: request.provider || "",
              providerSessionIdPresent: Boolean(request.providerSessionId),
              terminalIndex: request.terminalIndex ?? "",
              threadId: request.threadId || "",
              workspaceId: request.workspaceId || "",
            });
            window.setTimeout(() => {
              logBigViewSyncDiagnosticEvent("bigview.model_restore.batch_write_start", {
                commandLength: restoreModelCommand.length,
                instanceId: paneResult.instanceId || "",
                model: request.model || "",
                paneId: paneResult.paneId || "",
                provider: request.provider || "",
                terminalIndex: request.terminalIndex ?? "",
                threadId: request.threadId || "",
                workspaceId: request.workspaceId || "",
              });
              invoke("terminal_write", {
                data: `${restoreModelCommand}\r`,
                instanceId: paneResult.instanceId,
                paneId: paneResult.paneId,
              }).then(() => {
                logBigViewSyncDiagnosticEvent("bigview.model_restore.batch_write_done", {
                  instanceId: paneResult.instanceId || "",
                  model: request.model || "",
                  paneId: paneResult.paneId || "",
                  provider: request.provider || "",
                  terminalIndex: request.terminalIndex ?? "",
                  threadId: request.threadId || "",
                  workspaceId: request.workspaceId || "",
                });
              }).catch((error) => {
                logBigViewSyncDiagnosticEvent("bigview.model_restore.batch_write_error", {
                  instanceId: paneResult.instanceId || "",
                  message: error?.message || String(error || ""),
                  model: request.model || "",
                  paneId: paneResult.paneId || "",
                  provider: request.provider || "",
                  terminalIndex: request.terminalIndex ?? "",
                  threadId: request.threadId || "",
                  workspaceId: request.workspaceId || "",
                });
              });
            }, 650);
          } else {
            logBigViewSyncDiagnosticEvent("bigview.model_restore.batch_write_skip", {
              hasModel: Boolean(request.model),
              hasProviderSessionId: Boolean(request.providerSessionId),
              instanceId: paneResult.instanceId || request.instanceId || "",
              paneId: paneResult.paneId || request.paneId || "",
              provider: request.provider || "",
              reason: !request.model
                ? "missing_model"
                : !request.providerSessionId
                  ? "missing_provider_session"
                  : "startup_model_restore_disabled",
              terminalIndex: request.terminalIndex ?? "",
              threadId: request.threadId || "",
              workspaceId: request.workspaceId || "",
            });
          }
        });
        workspaceAgentBatchInFlightKeyRef.current = "";
        setWorkspaceAgentBatchSentKey(workspaceAgentLaunchKey);
        setWorkspaceAgentLaunchEpoch((epoch) => epoch + 1);
        preparedTerminalsRef.current.forEach((session, key) => {
          if (preparedWorkspaceTerminalRequests.some((request) => (
            request.paneId === session.paneId && request.instanceId === session.instanceId
          ))) {
            preparedTerminalsRef.current.delete(key);
          }
        });
        setPreparedTerminalVersion((version) => version + 1);
      })
      .catch((error) => {
        logBigViewSyncDiagnosticEvent("bigview.model_restore.batch_error", {
          launchKey: workspaceAgentLaunchKey,
          message: error?.message || String(error || ""),
          requestCount: preparedWorkspaceTerminalRequests.length,
          workspaceId: activatedWorkspace.id,
        });
        workspaceAgentBatchInFlightKeyRef.current = "";
        setWorkspaceAgentBatchSentKey(workspaceAgentLaunchKey);
        setWorkspaceAgentLaunchEpoch((epoch) => epoch + 1);
        preparedTerminalsRef.current.forEach((session, key) => {
          if (preparedWorkspaceTerminalRequests.some((request) => (
            request.paneId === session.paneId && request.instanceId === session.instanceId
          ))) {
            preparedTerminalsRef.current.delete(key);
          }
        });
        setPreparedTerminalVersion((version) => version + 1);
      });
  }, [
    activatedWorkspace?.id,
    activatedWorkspaceAgentTerminalEntries.length,
    activatedWorkspaceLogicalTerminalIndexes,
    activatedWorkspaceLogicalTerminalCount,
    preparedWorkspaceTerminalCount,
    preparedWorkspaceTerminalRequests,
    workspaceAgentBatchSentKey,
    workspaceAgentLaunchKey,
  ]);

  useEffect(() => {
    setWorkspaceNameDraft(selectedWorkspace?.name || "");
    setWorkspaceTerminalCountDraft(String(selectedWorkspace ? selectedWorkspaceTerminalCount : MIN_WORKSPACE_TERMINAL_COUNT));
    setWorkspaceTerminalRolesDraft(selectedWorkspace ? selectedWorkspaceTerminalRoles : normalizeWorkspaceTerminalRoles(
      [],
      MIN_WORKSPACE_TERMINAL_COUNT,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    ));
    setWorkspaceRootDraft(selectedWorkspaceRootDirectory);
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
  }, [
    selectedWorkspace?.id,
    selectedWorkspace?.name,
    selectedWorkspaceRootDirectory,
    selectedWorkspaceTerminalCount,
    selectedWorkspaceTerminalRoles,
    workspaceTerminalFallbackRole,
    workspaceTerminalRoleOptions,
    workspaceSettingsModalId,
  ]);

  useEffect(() => {
    if (
      authState !== "authenticated"
      || !activatedWorkspace
      || shouldShowWorkspaceSetup
    ) {
      return;
    }

  }, [
    activeView,
    activeAgent,
    agentStatusState,
    authState,
    activatedWorkspace,
    activatedWorkspaceAgentTerminalEntries,
    activatedWorkspaceRootDirectory,
    activatedWorkspaceLogicalTerminalIndexes,
    activatedWorkspaceTerminalRoleEntries,
    activatedWorkspaceLogicalTerminalCount,
    shouldShowWorkspaceSetup,
    activatedWorkspaceDisplayTerminalRows.length,
    viewMotion,
    visibleView,
    workspaceState,
    workspaceSyncState,
  ]);

  const isConnectivityBlocked = authState !== "authenticated" && (apiState === "checking" || apiState === "offline");
  const shouldShowLaunchScreen = isLaunchScreenVisible || isConnectivityBlocked;
  const launchState = isConnectivityBlocked && apiState === "offline"
    ? "offline"
    : isConnectivityBlocked && apiState === "checking"
      ? "checking"
      : "loading";
  const launchStatus = launchState === "offline"
    ? "No internet connection"
    : launchState === "checking"
      ? "Checking connection..."
      : !authInitialized
        ? "Checking secure session..."
        : authState === "authenticated"
          ? "Preparing workspace..."
          : "Opening sign in...";
  const launchDetail = launchState === "offline"
    ? apiMessage
    : launchState === "checking"
      ? "Contacting the Diff Forge API before opening sign in."
      : !authInitialized
        ? "Validating this device before showing your workspace."
        : "Finishing the desktop handoff.";
  const windowControlPlatform = getWindowControlPlatform();
  const isWindowExpanded = windowFrameState.isFullscreen || windowFrameState.isMaximized;
  const windowResizeLabel = isWindowExpanded ? "Restore" : windowControlPlatform === "macos" ? "Zoom" : "Maximize";
  const workspaceCloseReportedClosed = normalizeCloseCount(workspaceCloseState.closed);
  const workspaceCloseTotal = Math.max(normalizeCloseCount(workspaceCloseState.total), workspaceCloseReportedClosed);
  const workspaceCloseClosed = Math.min(workspaceCloseReportedClosed, workspaceCloseTotal);
  const workspaceCloseProgress = workspaceCloseTotal > 0
    ? Math.min(100, Math.round((workspaceCloseClosed / workspaceCloseTotal) * 100))
    : 0;
  const workspaceCloseTerminalLabel = workspaceCloseTotal === 1 ? "terminal" : "terminals";
  const workspaceDeactivateReportedClosed = normalizeCloseCount(workspaceDeactivationState.closed);
  const workspaceDeactivateTotal = Math.max(
    normalizeCloseCount(workspaceDeactivationState.total),
    workspaceDeactivateReportedClosed,
  );
  const workspaceDeactivateClosed = Math.min(workspaceDeactivateReportedClosed, workspaceDeactivateTotal);
  const workspaceDeactivateProgress = workspaceDeactivateTotal > 0
    ? Math.min(100, Math.round((workspaceDeactivateClosed / workspaceDeactivateTotal) * 100))
    : 0;
  const workspaceDeactivateTerminalLabel = workspaceDeactivateTotal === 1 ? "terminal" : "terminals";
  const isWorkspaceStartupOverlayVisible = workspaceState !== "ready"
    || shouldHoldWorkspaceRevealForTerminalBatch;

  return (
    <>
      <GlobalStyle />
      <AppFrame data-platform={windowControlPlatform} data-window-expanded={isWindowExpanded}>
        <WindowTitleBar
          data-platform={windowControlPlatform}
          onMouseDown={handleTitleBarMouseDown}
        >
          <WindowTitle>
            <img src="/logo.webp" alt="" />
            <span>{BRAND_NAME}</span>
          </WindowTitle>
          <WindowControls aria-label="Window controls" data-platform={windowControlPlatform}>
            <WindowControlButton
              aria-label="Minimize"
              data-action="minimize"
              data-platform={windowControlPlatform}
              data-window-control
              onClick={minimizeWindow}
              title="Minimize"
              type="button"
            >
              <TitleMinimizeIcon aria-hidden="true" />
            </WindowControlButton>
            <WindowControlButton
              aria-label={windowResizeLabel}
              data-action="maximize"
              data-platform={windowControlPlatform}
              data-window-control
              onClick={toggleMaximizeWindow}
              title={windowResizeLabel}
              type="button"
            >
              {isWindowExpanded ? (
                <TitleRestoreIcon aria-hidden="true" />
              ) : (
                <TitleMaximizeIcon aria-hidden="true" />
              )}
            </WindowControlButton>
            <WindowControlButton
              aria-label="Close"
              data-action="close"
              data-platform={windowControlPlatform}
              data-window-control
              data-variant="close"
              onClick={closeWindow}
              title="Close"
              type="button"
            >
              <TitleCloseIcon aria-hidden="true" />
            </WindowControlButton>
          </WindowControls>
        </WindowTitleBar>

        <WindowResizeEdges aria-hidden="true">
          {WINDOW_RESIZE_EDGES.map(({ placement, direction }) => (
            <WindowResizeHandle
              data-placement={placement}
              data-resize-direction={direction}
              key={placement}
              onDoubleClick={handleWindowResizeEdgeDoubleClick}
              onMouseDown={handleWindowResizeEdgeMouseDown}
            />
          ))}
        </WindowResizeEdges>

        <AppContent>
          {shouldShowLaunchScreen ? (
            <SplashScreen aria-label={`${BRAND_NAME} is launching`} data-state={launchState}>
              <AmbientPanel data-position="left">
                <span>&gt; codex</span>
                <p>Analyzing codebase...</p>
                <p>Generating changes...</p>
              </AmbientPanel>
              <AmbientPanel data-position="right">
                <span>src/engine/runner.ts</span>
                <p>+ return output</p>
                <p>- return result</p>
              </AmbientPanel>
              <SplashCenter>
                <SplashLogo src="/logo.webp" alt="" />
                <SplashTitle>{BRAND_NAME}</SplashTitle>
                <SplashTagline>Manage Codex & Claude Code. Build faster.</SplashTagline>
                <LoadingTrack aria-hidden="true" data-state={launchState}>
                  {launchState !== "offline" && <LoadingFill />}
                </LoadingTrack>
                <LaunchStatusPanel data-state={launchState}>
                  <LaunchStatusIcon aria-hidden="true" data-state={launchState}>
                    {launchState === "offline" ? (
                      <ErrorIcon />
                    ) : launchState === "checking" ? (
                      <PendingIcon />
                    ) : (
                      <ConnectedIcon />
                    )}
                  </LaunchStatusIcon>
                  <LaunchStatusCopy>
                    <LoadingText>{launchStatus}</LoadingText>
                    <LoadingDetail>{launchDetail}</LoadingDetail>
                  </LaunchStatusCopy>
                </LaunchStatusPanel>
                {launchState === "offline" && (
                  <LaunchActions>
                    <SecondaryButton disabled={apiState === "checking"} onClick={checkBackend} type="button">
                      <ButtonRefreshIcon aria-hidden="true" />
                      <span>Retry connection</span>
                    </SecondaryButton>
                  </LaunchActions>
                )}
              </SplashCenter>
            </SplashScreen>
          ) : authState === "authenticated" && !userIsPaid ? (
            <PricingScreen aria-label="Desktop pricing">
              <PricingHero>
                <BrandMark as="div" aria-label="Diffforge">
                  <img src="/logo.webp" alt="" />
                  <strong>Diffforge</strong>
                </BrandMark>
                <PricingCopy>
                  <Kicker>Plan required</Kicker>
                  <PricingTitle>Upgrade to unlock the desktop workspace</PricingTitle>
                  <PricingText>
                    You are signed in as {displayName}. Free accounts can review pricing here,
                    but the desktop dashboard stays locked until your plan is paid.
                  </PricingText>
                </PricingCopy>
                <PricingActions>
                  <PrimaryButton onClick={openPricing} type="button">
                    <ButtonBrowserIcon aria-hidden="true" />
                    <span>Open pricing</span>
                  </PrimaryButton>
                  <SecondaryButton onClick={refreshSubscriptionStatus} type="button">
                    <ButtonRefreshIcon aria-hidden="true" />
                    <span>Check status</span>
                  </SecondaryButton>
                  <SecondaryButton onClick={logout} type="button">
                    <ButtonLogoutIcon aria-hidden="true" />
                    <span>Sign out</span>
                  </SecondaryButton>
                </PricingActions>
                {authError && <FormMessage $state="error">{authError}</FormMessage>}
              </PricingHero>

              <PricingPlans aria-label="Plans">
                <PricingPlanCard>
                  <PlanEyebrow>{planLabel}</PlanEyebrow>
                  <PlanPrice>$0</PlanPrice>
                  <PlanDescription>Browser login, pricing access, and account setup.</PlanDescription>
                  <PlanFeatureList>
                    <li>Web account login</li>
                    <li>Pricing and billing status</li>
                    <li>Desktop dashboard locked</li>
                  </PlanFeatureList>
                </PricingPlanCard>

                <PricingPlanCard data-featured="true">
                  <PlanEyebrow>Pro</PlanEyebrow>
                  <PlanPrice>
                    $25<span>/mo</span>
                  </PlanPrice>
                  <PlanDescription>Paid status unlocks the native dashboard shell.</PlanDescription>
                  <PlanFeatureList>
                    <li>Desktop workspace dashboard</li>
                    <li>Blank desktop workspace shell</li>
                    <li>Priority native app access</li>
                  </PlanFeatureList>
                </PricingPlanCard>
              </PricingPlans>
            </PricingScreen>
          ) : authState === "authenticated" ? (
            <AuthenticatedWorkspaceFrame>
              <DashboardShell
                aria-hidden={isWorkspaceStartupOverlayVisible}
                data-rail-collapsed={workspaceRailCollapsed}
                data-startup={isWorkspaceStartupOverlayVisible}
                ref={dashboardShellRef}
              >
              <WorkspaceRail
                aria-label="Workspace navigation"
                data-collapsed={workspaceRailCollapsed}
                onClick={clearWorkspaceSelectionFromRail}
                ref={workspaceRailRef}
              >
                <RailTop>
                  <RailHeader>
                    <RailSectionTitle>Workspaces</RailSectionTitle>
                    <RailCollapseButton
                      aria-label={workspaceRailCollapsed ? "Expand workspace drawer" : "Collapse workspace drawer"}
                      aria-pressed={workspaceRailCollapsed}
                      onClick={toggleWorkspaceRailCollapsed}
                      title={workspaceRailCollapsed ? "Expand drawer" : "Drawer smaller"}
                      type="button"
                    >
                      {workspaceRailCollapsed ? (
                        <ButtonRailExpandIcon aria-hidden="true" />
                      ) : (
                        <ButtonRailCollapseIcon aria-hidden="true" />
                      )}
                    </RailCollapseButton>
                  </RailHeader>
                  <WorkspaceList>
                    {workspaces.map((workspace) => {
                      const workspaceRoot = getWorkspaceRootDirectory(workspaceSettings, workspace.id);
                      const workspaceRuntimeState = workspace.id === activatedWorkspaceId
                        ? workspaceState === "ready"
                          ? "activated"
                          : "activating"
                        : "closed";
                      const notificationSummary = workspaceNotificationSummaries[workspace.id] || {};
                      const notificationBadgeText = formatWorkspaceNotificationBadgeCount(
                        notificationSummary.badgeCount,
                      );
                      const hasNotificationBadge = Boolean(notificationBadgeText);
                      const notificationLabel = notificationSummary.pendingActionCount
                        ? `${notificationSummary.pendingActionCount} action${notificationSummary.pendingActionCount === 1 ? "" : "s"} required`
                        : notificationSummary.unreadCount
                          ? `${notificationSummary.unreadCount} unread notification${notificationSummary.unreadCount === 1 ? "" : "s"}`
                          : "";
                      const workspaceButtonLabel = notificationLabel
                        ? `${workspace.name}, ${notificationLabel}`
                        : workspace.name;

                      return (
                        <WorkspaceRow
                          data-notification-highlight={workspaceNotificationHighlights[workspace.id] ? "true" : undefined}
                          data-runtime={workspaceRuntimeState}
                          data-selected={workspace.id === selectedWorkspaceId}
                          key={workspace.id}
                        >
                          <WorkspaceButton
                            aria-label={workspaceButtonLabel}
                            data-runtime={workspaceRuntimeState}
                            data-selected={workspace.id === selectedWorkspaceId}
                            onClick={() => {
                              activateWorkspaceFromRail(workspace.id);
                            }}
                            title={notificationLabel ? `${workspace.name} - ${notificationLabel}` : workspace.name}
                            type="button"
                          >
                            <WorkspaceAccent aria-hidden="true" />
                            <WorkspaceLabel>
                              <WorkspaceCompactGlyph aria-hidden="true">
                                {getWorkspaceRailInitials(workspace.name)}
                              </WorkspaceCompactGlyph>
                              <strong>{workspace.name}</strong>
                              <span>{getDirectoryName(workspaceRoot || defaultWorkingDirectory)}</span>
                            </WorkspaceLabel>
                            {hasNotificationBadge && (
                              <WorkspaceNotificationBadge
                                aria-hidden="true"
                                data-variant={notificationSummary.badgeVariant}
                              >
                                {notificationBadgeText}
                              </WorkspaceNotificationBadge>
                            )}
                          </WorkspaceButton>
                          <WorkspaceSettingsButton
                            aria-label={`Open settings for ${workspace.name}`}
                            onClick={() => openWorkspaceSettings(workspace.id)}
                            title="Workspace settings"
                            type="button"
                          >
                            <ButtonSettingsIcon aria-hidden="true" />
                          </WorkspaceSettingsButton>
                        </WorkspaceRow>
                      );
                    })}
                    {workspaceSyncState === "loading" && (
                      <WorkspaceMuted>Loading...</WorkspaceMuted>
                    )}
                  </WorkspaceList>
                </RailTop>

                <RailFooter>
                  {shouldShowTerminalNav && (
                    <RailActionButton
                      aria-label="Terminals"
                      data-active={activeView === DEFAULT_WORKSPACE_VIEW}
                      onClick={() => showView(DEFAULT_WORKSPACE_VIEW)}
                      title="Terminals"
                      type="button"
                    >
                      <ButtonTerminalIcon aria-hidden="true" />
                      <span>Terminals</span>
                    </RailActionButton>
                  )}
                  {shouldShowWorkspaceDetailNav && (
                    <>
                      <RailActionButton
                        aria-label="Files"
                        data-active={activeView === "files"}
                        onClick={() => showView("files")}
                        title="Files"
                        type="button"
                      >
                        <ButtonFolderIcon aria-hidden="true" />
                        <span>Files</span>
                      </RailActionButton>
                      <RailActionButton
                        aria-label="Spec Graph"
                        data-active={activeView === "specGraph"}
                        onClick={() => showView("specGraph")}
                        title="Spec Graph"
                        type="button"
                      >
                        <ButtonForgeIcon aria-hidden="true" />
                        <span>Spec Graph</span>
                      </RailActionButton>
                      <RailActionButton
                        aria-label="Web"
                        data-active={activeView === "web"}
                        onClick={() => showView("web")}
                        title="Web"
                        type="button"
                      >
                        <ButtonBrowserIcon aria-hidden="true" />
                        <span>Web</span>
                      </RailActionButton>
                      <RailActionButton
                        aria-label="MCPs"
                        data-active={activeView === "mcps"}
                        onClick={() => showView("mcps")}
                        title="MCPs"
                        type="button"
                      >
                        <ButtonHubIcon aria-hidden="true" />
                        <span>MCPs</span>
                      </RailActionButton>
                    </>
                  )}
                  <RailGlobalActions aria-label="Global controls">
                    <RailActionButton
                      aria-label="Processes"
                      data-active={activeView === "processes"}
                      data-scope="global"
                      onClick={() => showView("processes")}
                      title="Processes"
                      type="button"
                    >
                      <ButtonProcessIcon aria-hidden="true" />
                      <span>Processes</span>
                    </RailActionButton>
                    <RailActionButton
                      aria-label="Audio"
                      data-active={activeView === "audio"}
                      data-scope="global"
                      onClick={() => showView("audio")}
                      title="Audio"
                      type="button"
                    >
                      <ButtonMicIcon aria-hidden="true" />
                      <span>Audio</span>
                    </RailActionButton>
                    <RailActionButton
                      aria-label="Settings"
                      data-active={activeView === "settings"}
                      data-scope="global"
                      onClick={() => showView("settings")}
                      title="Settings"
                      type="button"
                    >
                      <ButtonSettingsIcon aria-hidden="true" />
                      <span>Settings</span>
                    </RailActionButton>
                    <RailActionButton
                      aria-label="Sign out"
                      data-scope="global"
                      data-variant="signout"
                      onClick={logout}
                      title="Sign out"
                      type="button"
                    >
                      <ButtonLogoutIcon aria-hidden="true" />
                      <span>Sign out</span>
                    </RailActionButton>
                  </RailGlobalActions>
                </RailFooter>
              </WorkspaceRail>

              <WorkspaceViewStack>
                <WorkspaceViewPane
                  aria-hidden={visibleView !== DEFAULT_WORKSPACE_VIEW}
                  data-visible={visibleView === DEFAULT_WORKSPACE_VIEW}
                >
                  {shouldKeepWorkspaceTerminalMounted && (
                    shouldShowWorkspaceSetup ? (
                      <WorkspaceRuntimeLayer
                        aria-hidden={visibleView !== DEFAULT_WORKSPACE_VIEW || !shouldRevealWorkspaceTerminal}
                        data-visible={visibleView === DEFAULT_WORKSPACE_VIEW && shouldRevealWorkspaceTerminal}
                      >
                        <TerminalView
                          defaultWorkingDirectory={defaultWorkingDirectory}
                          terminalWorkspace={activatedWorkspace}
                          terminalAgentsByIndex={activatedWorkspaceTerminalAgentsByIndex}
                          terminalRolesByIndex={activatedWorkspaceTerminalRolesByIndex}
                          terminalWorkspaceWorkingDirectory={activatedWorkspaceTerminalWorkingDirectory}
                          terminalWorkspaceLogicalIndexes={activatedWorkspaceLogicalTerminalIndexes}
                          terminalWorkspaceLogicalTerminalCount={activatedWorkspaceLogicalTerminalCount}
                          agentStatusError={agentStatusError}
                          agentStatuses={agentStatuses}
                          agentStatusState={agentStatusState}
                          closeWorkspaceTerminal={closeWorkspaceTerminal}
                          changeWorkspaceTerminalRole={changeWorkspaceTerminalRole}
                          createWorkspaceThreadTerminal={createWorkspaceThreadTerminal}
                          createFirstWorkspace={createFirstWorkspace}
                          handlePreparedTerminalChange={handlePreparedTerminalChange}
                          isAppClosing={workspaceCloseState.isActive}
                          isWorkspaceRuntimeDeactivating={Boolean(
                            workspaceDeactivationState.isActive
                              && workspaceDeactivationState.workspaceId === activatedWorkspace?.id,
                          )}
                          manageWorkspaceAgents={manageWorkspaceAgents}
                          onArchiveWorkspaceThread={archiveWorkspaceThreadFromOverlay}
                          onOpenWorkspaceSettings={openActivatedWorkspaceSettings}
                          onSelectWorkspaceThread={selectWorkspaceThreadInOverlay}
                          onToggleWorkspaceThreadPinned={toggleWorkspaceThreadPinnedFromOverlay}
                          onWorkspaceThreadsViewStateChange={updateWorkspaceThreadsViewStateFromOverlay}
                          onThreadTerminalLifecycle={handleThreadTerminalLifecycle}
                          refreshAgentStatuses={refreshAgentStatuses}
                          reorderWorkspaceTerminalDisplayLayout={reorderWorkspaceTerminalDisplayLayout}
                          setWorkspaceName={setWorkspaceName}
                          shouldPrewarmWorkspaceTerminals={shouldPrewarmWorkspaceTerminals}
                          shouldShowWorkspaceSetup={shouldShowWorkspaceSetup}
                          showSettingsView={showSettingsView}
                          splitWorkspaceTerminal={splitWorkspaceTerminal}
                          terminalDisplayRows={activatedWorkspaceDisplayTerminalRows}
                          terminalThreadsByIndex={activatedWorkspaceThreadsByIndex}
                          viewMotion={viewMotion}
                          workspaceAgentLaunchEpoch={workspaceAgentLaunchEpoch}
                          workspaceError={workspaceError}
                          workspaceName={workspaceName}
                          workspaceSyncState={workspaceSyncState}
                          workspaceThreadRestoreReady={workspaceThreadsHydrated}
                          workspaceTerminalAgentLaunchReady={workspaceTerminalAgentLaunchReady}
                          workspaceTerminalRenderAgent={workspaceTerminalRenderAgent}
                          workspaceThreads={workspaceThreads}
                          workspaces={workspaces}
                        />
                      </WorkspaceRuntimeLayer>
                    ) : enabledWorkspaceRuntimeDescriptors.map((runtimeDescriptor) => {
                      const runtimeWorkspace = runtimeDescriptor.workspace;
                      const runtimeVisible = Boolean(
                        runtimeWorkspace?.id
                          && runtimeWorkspace.id === activatedWorkspace?.id
                          && shouldRevealWorkspaceTerminal,
                      );
                      const runtimeIsDeactivating = Boolean(
                        workspaceDeactivationState.isActive
                          && workspaceDeactivationState.workspaceId === runtimeWorkspace?.id,
                      );
                      const runtimeAgentLaunchReady = Boolean(
                        workspaceState === "ready"
                          && workspaceThreadsHydrated
                          && !runtimeIsDeactivating
                          && runtimeDescriptor.agentTerminalEntries.length > 0,
                      );

                      return (
                        <WorkspaceRuntimeLayer
                          aria-hidden={visibleView !== DEFAULT_WORKSPACE_VIEW || !runtimeVisible}
                          data-visible={visibleView === DEFAULT_WORKSPACE_VIEW && runtimeVisible}
                          key={runtimeWorkspace.id}
                        >
                          <TerminalView
                            defaultWorkingDirectory={defaultWorkingDirectory}
                            terminalWorkspace={runtimeWorkspace}
                            terminalAgentsByIndex={runtimeDescriptor.terminalAgentsByIndex}
                            terminalRolesByIndex={runtimeDescriptor.terminalRolesByIndex}
                            terminalWorkspaceWorkingDirectory={runtimeDescriptor.workingDirectory}
                            terminalWorkspaceLogicalIndexes={runtimeDescriptor.logicalTerminalIndexes}
                            terminalWorkspaceLogicalTerminalCount={runtimeDescriptor.logicalTerminalCount}
                            agentStatusError={agentStatusError}
                            agentStatuses={agentStatuses}
                            agentStatusState={agentStatusState}
                            closeWorkspaceTerminal={closeWorkspaceTerminal}
                            changeWorkspaceTerminalRole={changeWorkspaceTerminalRole}
                            createWorkspaceThreadTerminal={createWorkspaceThreadTerminal}
                            createFirstWorkspace={createFirstWorkspace}
                            handlePreparedTerminalChange={handlePreparedTerminalChange}
                            isAppClosing={workspaceCloseState.isActive}
                            isWorkspaceRuntimeDeactivating={runtimeIsDeactivating}
                            manageWorkspaceAgents={manageWorkspaceAgents}
                            onArchiveWorkspaceThread={archiveWorkspaceThreadFromOverlay}
                            onOpenWorkspaceSettings={openActivatedWorkspaceSettings}
                            onSelectWorkspaceThread={selectWorkspaceThreadInOverlay}
                            onToggleWorkspaceThreadPinned={toggleWorkspaceThreadPinnedFromOverlay}
                            onWorkspaceThreadsViewStateChange={updateWorkspaceThreadsViewStateFromOverlay}
                            onThreadTerminalLifecycle={handleThreadTerminalLifecycle}
                            refreshAgentStatuses={refreshAgentStatuses}
                            reorderWorkspaceTerminalDisplayLayout={reorderWorkspaceTerminalDisplayLayout}
                            setWorkspaceName={setWorkspaceName}
                            shouldPrewarmWorkspaceTerminals={shouldPrewarmWorkspaceTerminals}
                            shouldShowWorkspaceSetup={false}
                            showSettingsView={showSettingsView}
                            splitWorkspaceTerminal={splitWorkspaceTerminal}
                            terminalDisplayRows={runtimeDescriptor.displayRows}
                            terminalThreadsByIndex={runtimeDescriptor.threadsByIndex}
                            viewMotion={viewMotion}
                            workspaceAgentLaunchEpoch={runtimeVisible ? workspaceAgentLaunchEpoch : 0}
                            workspaceError={workspaceError}
                            workspaceName={runtimeWorkspace.name || workspaceName}
                            workspaceSyncState={workspaceSyncState}
                            workspaceThreadRestoreReady={workspaceThreadsHydrated}
                            workspaceTerminalAgentLaunchReady={runtimeAgentLaunchReady}
                            workspaceTerminalRenderAgent={runtimeDescriptor.renderAgent}
                            workspaceThreads={workspaceThreads}
                            workspaces={workspaces}
                          />
                        </WorkspaceRuntimeLayer>
                      );
                    })
                  )}
                  {shouldShowDefaultWorkspaceIdle && (
                    <WorkspaceRuntimeLayer
                      aria-hidden={visibleView !== DEFAULT_WORKSPACE_VIEW}
                      data-visible={visibleView === DEFAULT_WORKSPACE_VIEW}
                    >
                      <WorkspaceIdleState detail={defaultWorkspaceIdleDetail} viewMotion={viewMotion} />
                    </WorkspaceRuntimeLayer>
                  )}
                </WorkspaceViewPane>

                <WorkspaceViewPane
                  aria-hidden={visibleView === DEFAULT_WORKSPACE_VIEW}
                  data-visible={visibleView !== DEFAULT_WORKSPACE_VIEW}
                >
              {visibleView === "settings" ? (
                <SettingsPage data-motion={viewMotion}>
                  <PageHeader>
                    <div>
                      <Kicker>Settings</Kicker>
                      <DashboardTitle>Desktop settings</DashboardTitle>
                      <PageSubline>Terminal providers and verified account state for this device.</PageSubline>
                    </div>
                    <SecondaryButton data-padding="wide" onClick={() => showView(DEFAULT_WORKSPACE_VIEW)} type="button">
                      <ConnectedIcon aria-hidden="true" />
                      <span>Back</span>
                    </SecondaryButton>
                  </PageHeader>

                  <AccountSettingsPanel>
                    <PanelHeaderRow>
                      <div>
                        <PanelKicker>Appearance</PanelKicker>
                        <PanelHeading>Theme preset</PanelHeading>
                      </div>
                      <AgentReadyPill data-tone="blue">
                        {activeAppTheme === APP_THEME_LIGHT ? (
                          <ButtonLightModeIcon aria-hidden="true" />
                        ) : (
                          <ButtonDarkModeIcon aria-hidden="true" />
                        )}
                        <span>{activeAppTheme === APP_THEME_LIGHT ? "Light" : "Dark"}</span>
                      </AgentReadyPill>
                    </PanelHeaderRow>

                    <AccountCard data-tone="blue">
                      <AppearanceThemeGrid aria-label="App theme" role="radiogroup">
                        {APP_THEME_OPTIONS.map((option) => {
                          const selected = activeAppTheme === option.id;

                          return (
                            <AppearanceThemeButton
                              aria-checked={selected}
                              aria-label={`${option.label} theme`}
                              data-selected={selected ? "true" : undefined}
                              key={option.id}
                              onClick={() => updateAppTheme(option.id)}
                              role="radio"
                              type="button"
                            >
                              <span aria-hidden="true">
                                {option.icon === "light" ? (
                                  <ButtonLightModeIcon />
                                ) : (
                                  <ButtonDarkModeIcon />
                                )}
                              </span>
                              <div>
                                <strong>{option.label}</strong>
                                <small>{option.detail}</small>
                              </div>
                            </AppearanceThemeButton>
                          );
                        })}
                      </AppearanceThemeGrid>
                    </AccountCard>
                  </AccountSettingsPanel>

                  <AgentSettingsPanel>
                    <PanelHeaderRow>
                      <div>
                        <PanelKicker>Terminal providers</PanelKicker>
                        <PanelHeading>Codex, Claude Code, and OpenCode</PanelHeading>
                      </div>
                      <AgentPanelActions>
                        <AgentReadyPill data-tone={connectedAgentCount > 0 ? "blue" : "orange"}>
                          <ButtonBotIcon aria-hidden="true" />
                          <span>{connectedAgentCount}/{AGENT_PROVIDERS.length} ready</span>
                        </AgentReadyPill>
                        <SecondaryButton disabled={agentStatusState === "checking"} onClick={refreshAgentStatuses} type="button">
                          <ButtonRefreshIcon aria-hidden="true" />
                          <span>{agentStatusState === "checking" ? "Checking..." : "Recheck"}</span>
                        </SecondaryButton>
                      </AgentPanelActions>
                    </PanelHeaderRow>

                    {agentStatusError && <FormMessage $state="error">{agentStatusError}</FormMessage>}

                    <AgentCardGrid>
                      {agentStatuses.map((agent) => {
                        const installResult = agentInstallResults[agent.id];
                        const actionResult = agentActionResults[agent.id];
                        const isInstallingAgent = agentInstallState[agent.id] === "installing";
                        const isUpdatingAgent = agentInstallState[agent.id] === "updating";
                        const isPackageActionBusy = isInstallingAgent || isUpdatingAgent;
                        const isDisconnectingAgent = agentDisconnectState[agent.id] === "disconnecting";
                        const needsInstallMessage = `${agent.label} needs to be installed before this action.`;
                        const authActionDisabled = !agent.installed || agentStatusState === "checking" || isDisconnectingAgent;
                        const useDisabled = !agent.installed;
                        const authActionTitle = !agent.installed
                          ? needsInstallMessage
                          : isDisconnectingAgent
                            ? `Disconnecting ${agent.label}.`
                          : agentStatusState === "checking"
                            ? "Checking terminal CLI status."
                            : agent.authenticated
                              ? `Disconnect ${agent.label} from this machine.`
                              : `Connect ${agent.label}`;
                        const useTitle = !agent.installed ? needsInstallMessage : `Use ${agent.label}`;
                        const npmInstallLabel = isInstallingAgent
                          ? "Installing..."
                          : installResult?.source === "npm" && !installResult.installed
                            ? "Retry npm install"
                            : agent.installed
                              ? "Update with npm"
                              : "Install with npm";
                        const npmUpdateLabel = isUpdatingAgent
                          ? "Updating..."
                          : installResult?.source === "npm-update" && installResult.permissionDenied
                            ? "Retry update"
                            : "Update with npm";
                        const installMessageTone = installResult?.installed
                          ? "success"
                          : installResult?.permissionDenied
                            ? "warning"
                            : "neutral";

                        return (
                          <AgentCard data-tone={getAgentTone(agent)} key={agent.id}>
                            <AgentCardHeader>
                              <AgentIcon data-tone={getAgentTone(agent)}>
                                {agent.id === "codex" || agent.id === "opencode" ? (
                                  <ButtonCodeIcon aria-hidden="true" />
                                ) : (
                                  <ButtonBotIcon aria-hidden="true" />
                                )}
                              </AgentIcon>
                              <div>
                                <AgentName>{agent.label}</AgentName>
                                <AgentMeta>{agent.version}</AgentMeta>
                              </div>
                            </AgentCardHeader>
                            <AgentStatusText>{agent.authMessage}</AgentStatusText>

                            {!agent.installed && (
                              <AgentInstallPanel>
                                <AgentInstallTopline>
                                  <span>{agent.nativeInstallLabel}</span>
                                  <AgentInstallBadge>Recommended</AgentInstallBadge>
                                </AgentInstallTopline>
                                <AgentInstallHint>
                                  {agent.npmAvailable
                                    ? `npm ${agent.npmVersion} detected. Native install is still preferred.`
                                    : "npm was not detected. Use the native installer path."}
                                </AgentInstallHint>
                                <AgentInstallActions>
                                  <PrimaryButton onClick={() => openAgentNativeInstaller(agent)} type="button">
                                    <ButtonBrowserIcon aria-hidden="true" />
                                    <span>Native installer</span>
                                  </PrimaryButton>
                                  {agent.npmAvailable && (
                                    <SecondaryButton
                                      disabled={isPackageActionBusy}
                                      onClick={() => installAgentWithNpm(agent.id)}
                                      type="button"
                                    >
                                      {isInstallingAgent ? <PendingIcon aria-hidden="true" /> : <ButtonTerminalIcon aria-hidden="true" />}
                                      <span>{npmInstallLabel}</span>
                                    </SecondaryButton>
                                  )}
                                </AgentInstallActions>
                                {agent.npmAvailable && <AgentInstallCommand>{agent.installCommand}</AgentInstallCommand>}
                                {installResult?.permissionDenied && (
                                  <AgentPermissionHint>
                                    Close running terminals, then retry from an elevated app/terminal or move npm global packages to a user-writable prefix.
                                  </AgentPermissionHint>
                                )}
                                {installResult?.message && (
                                  <AgentInstallMessage data-tone={installMessageTone}>
                                    {installResult.message}
                                  </AgentInstallMessage>
                                )}
                              </AgentInstallPanel>
                            )}

                            {agent.installed && agent.npmAvailable && (
                              <AgentInstallPanel>
                                <AgentInstallTopline>
                                  <span>npm package</span>
                                  <AgentInstallBadge>Update</AgentInstallBadge>
                                </AgentInstallTopline>
                                <AgentInstallHint>
                                  Updates use your global npm prefix. Permission errors usually mean old package folders were created by an elevated process or are still locked.
                                </AgentInstallHint>
                                <AgentInstallActions>
                                  <SecondaryButton
                                    disabled={isPackageActionBusy}
                                    onClick={() => updateAgentWithNpm(agent.id)}
                                    type="button"
                                  >
                                    {isUpdatingAgent ? <PendingIcon aria-hidden="true" /> : <ButtonRefreshIcon aria-hidden="true" />}
                                    <span>{npmUpdateLabel}</span>
                                  </SecondaryButton>
                                </AgentInstallActions>
                                <AgentInstallCommand>{agent.installCommand}</AgentInstallCommand>
                                {installResult?.permissionDenied && (
                                  <AgentPermissionHint>
                                    Close running terminals, then retry from an elevated app/terminal or move npm global packages to a user-writable prefix.
                                  </AgentPermissionHint>
                                )}
                                {installResult?.message && (
                                  <AgentInstallMessage data-tone={installMessageTone}>
                                    {installResult.message}
                                  </AgentInstallMessage>
                                )}
                              </AgentInstallPanel>
                            )}

                            <AgentActions>
                              {agent.authenticated ? (
                                <AgentActionTooltip title={authActionTitle}>
                                  <PrimaryDangerButton
                                    disabled={authActionDisabled}
                                    onClick={() => disconnectAgent(agent.id)}
                                    title={authActionTitle}
                                    type="button"
                                  >
                                    {isDisconnectingAgent ? <PendingIcon aria-hidden="true" /> : <ButtonLogoutIcon aria-hidden="true" />}
                                    <span>{isDisconnectingAgent ? "Disconnecting..." : "Disconnect"}</span>
                                  </PrimaryDangerButton>
                                </AgentActionTooltip>
                              ) : (
                                <AgentActionTooltip title={authActionTitle}>
                                  <SecondaryButton
                                    disabled={authActionDisabled}
                                    onClick={() => connectAgent(agent.id)}
                                    title={authActionTitle}
                                    type="button"
                                  >
                                    <ButtonKeyIcon aria-hidden="true" />
                                    <span>Connect</span>
                                  </SecondaryButton>
                                </AgentActionTooltip>
                              )}
                              <AgentActionTooltip title={useTitle}>
                                <SecondaryButton
                                  disabled={useDisabled}
                                  onClick={() => {
                                    setActiveAgent(agent.id);
                                    showView(DEFAULT_WORKSPACE_VIEW);
                                  }}
                                  title={useTitle}
                                  type="button"
                                >
                                  <ButtonTerminalIcon aria-hidden="true" />
                                  <span>Use</span>
                                </SecondaryButton>
                              </AgentActionTooltip>
                            </AgentActions>
                            {actionResult?.message && (
                              <AgentInstallMessage data-tone={actionResult.tone || "neutral"}>
                                {actionResult.message}
                              </AgentInstallMessage>
                            )}
                          </AgentCard>
                        );
                      })}
                    </AgentCardGrid>
                  </AgentSettingsPanel>

                  <AccountSettingsPanel>
                    <PanelHeaderRow>
                      <div>
                        <PanelKicker>Workspaces</PanelKicker>
                        <PanelHeading>Auto-activate workspace</PanelHeading>
                      </div>
                    </PanelHeaderRow>

                    <AccountCard data-tone={activatedWorkspace ? "blue" : "orange"}>
                      <AccountCardHeader>
                        <div>
                          <SetupField>
                            <SettingsLabel>Auto-activate</SettingsLabel>
                            <WorkspaceSettingsSelectShell>
                              <WorkspaceSettingsSelect
                                onChange={(event) => setDefaultWorkspace(event.target.value, "settings_page")}
                                value={workspaceLifecycleSettings.defaultWorkspaceId}
                              >
                                <option value="">No auto-activate workspace</option>
                                {workspaces.map((workspace) => (
                                  <option key={workspace.id} value={workspace.id}>
                                    {workspace.name}
                                  </option>
                                ))}
                              </WorkspaceSettingsSelect>
                              <WorkspaceSettingsSelectIcon aria-hidden="true" />
                            </WorkspaceSettingsSelectShell>
                            <SettingsHint>
                              {defaultWorkspace
                                ? `${defaultWorkspace.name} activates when the desktop workspace opens.`
                                : "The app opens without starting terminals."}
                            </SettingsHint>
                          </SetupField>
                        </div>
                        <AgentReadyPill data-tone={activatedWorkspace ? "blue" : "orange"}>
                          <ButtonTerminalIcon aria-hidden="true" />
                          <span>{activatedWorkspace ? "Active" : "Idle"}</span>
                        </AgentReadyPill>
                      </AccountCardHeader>

                      <SettingsIdentityGrid>
                        <SettingsIdentityItem>
                          <span>Runtime</span>
                          <strong>{activatedWorkspace?.name || "No workspace"}</strong>
                        </SettingsIdentityItem>
                        <SettingsIdentityItem>
                          <span>Selected</span>
                          <strong>{selectedWorkspace?.name || "None"}</strong>
                        </SettingsIdentityItem>
                        <SettingsIdentityItem>
                          <span>Default</span>
                          <strong>{defaultWorkspace?.name || "None"}</strong>
                        </SettingsIdentityItem>
                      </SettingsIdentityGrid>

                      <AccountCardFooter>
                        <SettingsHint>
                          {activatedWorkspace
                            ? "Terminal panes remain active while you move through dashboard tabs."
                            : "No terminal runtime is currently active."}
                        </SettingsHint>
                        {activatedWorkspace ? (
                          <PrimaryDangerButton
                            disabled={workspaceDeactivationState.isActive}
                            onClick={() => deactivateWorkspace(activatedWorkspace.id, "settings_page")}
                            type="button"
                          >
                            <ButtonCloseIcon aria-hidden="true" />
                            <span>{isActivatedWorkspaceDeactivating ? "Deactivating..." : "Deactivate workspace"}</span>
                          </PrimaryDangerButton>
                        ) : (
                          <PrimaryButton
                            disabled={!selectedWorkspace || workspaceDeactivationState.isActive}
                            onClick={() => selectedWorkspace && activateWorkspace(selectedWorkspace.id, "settings_page")}
                            type="button"
                          >
                            <ButtonTerminalIcon aria-hidden="true" />
                            <span>Activate selected</span>
                          </PrimaryButton>
                        )}
                      </AccountCardFooter>
                    </AccountCard>
                  </AccountSettingsPanel>

                  <AccountSettingsPanel>
                    <PanelHeaderRow>
                      <div>
                        <PanelKicker>Account info</PanelKicker>
                        <PanelHeading>Signed-in desktop account</PanelHeading>
                      </div>
                    </PanelHeaderRow>

                    <AccountCard data-tone="blue">
                      <AccountCardHeader>
                        <div>
                          <SettingsLabel>Account</SettingsLabel>
                          <SettingsValue>{displayName}</SettingsValue>
                          <SettingsHint>Server-returned desktop session user.</SettingsHint>
                        </div>
                        <AgentReadyPill data-tone={userIsPaid ? "blue" : "orange"}>
                          <ButtonCheckIcon aria-hidden="true" />
                          <span>{planLabel} plan</span>
                        </AgentReadyPill>
                      </AccountCardHeader>

                      <SettingsIdentityGrid>
                        <SettingsIdentityItem>
                          <span>Email</span>
                          <strong>{user?.email || "Not returned"}</strong>
                        </SettingsIdentityItem>
                        <SettingsIdentityItem>
                          <span>Plan</span>
                          <strong>{planLabel}</strong>
                        </SettingsIdentityItem>
                        <SettingsIdentityItem>
                          <span>Session</span>
                          <strong>Device active</strong>
                        </SettingsIdentityItem>
                      </SettingsIdentityGrid>

                      <AccountCardFooter>
                        <SettingsHint>Signing out clears this device session.</SettingsHint>
                        <PrimaryDangerButton onClick={logout} type="button">
                          <ButtonLogoutIcon aria-hidden="true" />
                          <span>Sign out</span>
                        </PrimaryDangerButton>
                      </AccountCardFooter>
                    </AccountCard>
                  </AccountSettingsPanel>
                </SettingsPage>
              ) : visibleView === "files" ? (
                <ForgeWorkspace aria-label="Workspace files" data-motion={viewMotion} data-surface="files">
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
                  ) : selectedWorkspace ? (
                    <FilesWorkspaceView
                      defaultWorkingDirectory={defaultWorkingDirectory}
                      onOpenWorkspaceSettings={openSelectedWorkspaceSettings}
                      rootDirectory={selectedWorkspaceFileRoot}
                      workspace={selectedWorkspace}
                      workspaceError={workspaceError}
                    />
                  ) : (
                    <WorkspaceIdleState detail="Select a workspace to browse files." viewMotion={viewMotion} />
                  )}
                </ForgeWorkspace>
              ) : visibleView === "specGraph" ? (
                <ForgeWorkspace aria-label="Workspace Spec Graph" data-motion={viewMotion}>
                  {selectedWorkspace ? (
                    <SpecGraphWorkspaceView
                      defaultWorkingDirectory={defaultWorkingDirectory}
                      knowledgeGraphError={selectedWorkspaceGraphState.knowledgeError || ""}
                      knowledgeGraphSnapshot={selectedWorkspaceGraphState.knowledgeSnapshot || null}
                      knowledgeGraphState={selectedWorkspaceGraphState.knowledgeState || "idle"}
                      isWorkspaceActive={Boolean(
                        isSelectedWorkspaceActivated
                        && !workspaceDeactivationState.isActive,
                      )}
                      onSubmitSpecEditIntent={submitSpecEditIntent}
                      pendingSpecEdits={selectedWorkspacePendingSpecEdits}
                      rootDirectory={selectedWorkspaceFileRoot}
                      specGraphError={selectedWorkspaceGraphState.specError || ""}
                      specGraphSnapshot={selectedWorkspaceGraphState.specSnapshot || null}
                      specGraphState={selectedWorkspaceGraphState.specState || "idle"}
                      workspace={selectedWorkspace}
                    />
                  ) : (
                    <WorkspaceIdleState detail="Select a workspace to view the spec graph." viewMotion={viewMotion} />
                  )}
                </ForgeWorkspace>
              ) : visibleView === "web" ? (
                <ForgeWorkspace aria-label="Workspace web" data-motion={viewMotion}>
                  {selectedWorkspace ? (
                    <WebWorkspaceView
                      defaultWorkingDirectory={defaultWorkingDirectory}
                      rootDirectory={selectedWorkspaceFileRoot}
                      workspace={selectedWorkspace}
                    />
                  ) : (
                    <WorkspaceIdleState detail="Select a workspace to open a web view." viewMotion={viewMotion} />
                  )}
                </ForgeWorkspace>
              ) : visibleView === "processes" ? (
                <ForgeWorkspace aria-label="Processes" data-motion={viewMotion}>
                  <ProcessesView
                    onCloseTrackedTerminal={closeTrackedProcessTerminal}
                    workspaceRoots={processKnownRoots}
                  />
                </ForgeWorkspace>
              ) : visibleView === "audio" ? (
                <ForgeWorkspace aria-label="Workspace audio" data-motion={viewMotion}>
                  <AudioWorkspaceView
                    audioActionState={audioActionState}
                    audioDownloadProgress={audioDownloadProgress}
                    audioError={audioError}
                    audioModelStatus={audioModelStatus}
                    audioStatusState={audioStatusState}
                    audioWidgetVisible={audioWidgetVisible}
                    onDownloadModel={downloadAudioModel}
                    onCloseWidget={closeAudioWidget}
                    onOpenWidget={openAudioWidget}
                    onRefreshStatus={refreshAudioModelStatus}
                    onUninstallModel={uninstallAudioModel}
                    workspace={selectedWorkspace}
                  />
                </ForgeWorkspace>
              ) : visibleView === "mcps" ? (
                <ForgeWorkspace aria-label="Workspace MCPs" data-motion={viewMotion}>
                  {selectedWorkspace ? (
                    <McpsWorkspaceView
                      defaultWorkingDirectory={defaultWorkingDirectory}
                      onOpenSettings={() => showView("settings")}
                      rootDirectory={selectedWorkspaceFileRoot}
                      workspace={selectedWorkspace}
                    />
                  ) : (
                    <WorkspaceIdleState detail="Select a workspace to inspect MCPs." viewMotion={viewMotion} />
                  )}
                </ForgeWorkspace>
              ) : (
                null
              )}
                </WorkspaceViewPane>
              </WorkspaceViewStack>
              {isWorkspaceSettingsOpen && (
                <WorkspaceSettingsOverlay
                  aria-label="Workspace settings modal"
                  onMouseDown={(event) => {
                    if (isWorkspaceSettingsDeactivating) {
                      return;
                    }

                    if (event.target === event.currentTarget) {
                      closeWorkspaceSettings();
                    }
                  }}
                >
                  <WorkspaceSettingsDialog
                    aria-busy={isWorkspaceSettingsBusy}
                    aria-labelledby="workspace-settings-title"
                    aria-modal="true"
                    role="dialog"
                    >
                      <WorkspaceSettingsDialogHeader>
                        <WorkspaceSettingsHeaderMain>
                          <div>
                            <PanelKicker>Workspace settings</PanelKicker>
                            <PanelHeading id="workspace-settings-title">{selectedWorkspace.name}</PanelHeading>
                          </div>
                          <WorkspaceSettingsHeaderMeta aria-label="Workspace summary">
                            <WorkspaceSettingsMetaPill>
                              <span>Runtime</span>
                              <strong>{isSelectedWorkspaceActivated ? "Active" : "Idle"}</strong>
                            </WorkspaceSettingsMetaPill>
                            <WorkspaceSettingsMetaPill>
                              <span>Terminals</span>
                              <strong>
                                {normalizeWorkspaceTerminalCount(workspaceTerminalCountDraft)}
                                {" "}
                                {getWorkspaceTerminalRoleSummaryText(
                                  normalizeWorkspaceTerminalRoles(
                                    workspaceTerminalRolesDraft,
                                    normalizeWorkspaceTerminalCount(workspaceTerminalCountDraft),
                                    workspaceTerminalFallbackRole,
                                    workspaceTerminalRoleOptions,
                                  ),
                                  workspaceTerminalRoleOptions,
                                )}
                              </strong>
                            </WorkspaceSettingsMetaPill>
                            <WorkspaceSettingsMetaPill>
                              <span>Default</span>
                              <strong>{isSelectedWorkspaceDefault ? "On" : "Off"}</strong>
                            </WorkspaceSettingsMetaPill>
                          </WorkspaceSettingsHeaderMeta>
                        </WorkspaceSettingsHeaderMain>
                        <WorkspaceSettingsHeaderActions>
                          {isSelectedWorkspaceActivated ? (
                            <PrimaryDangerButton
                              disabled={isWorkspaceSettingsBusy}
                              onClick={() => deactivateWorkspace(selectedWorkspace.id, "workspace_settings")}
                              type="button"
                            >
                              <ButtonCloseIcon aria-hidden="true" />
                              <span>{isWorkspaceSettingsDeactivating ? "Deactivating..." : "Deactivate"}</span>
                            </PrimaryDangerButton>
                          ) : (
                            <SecondaryButton
                              disabled={isWorkspaceSettingsBusy}
                              onClick={() => activateWorkspace(selectedWorkspace.id, "workspace_settings")}
                              type="button"
                            >
                              <ButtonTerminalIcon aria-hidden="true" />
                              <span>Activate</span>
                            </SecondaryButton>
                          )}
                          {isSelectedWorkspaceDefault ? (
                            <SecondaryButton
                              disabled={isWorkspaceSettingsBusy}
                              onClick={() => setDefaultWorkspace("", "workspace_settings")}
                              type="button"
                            >
                              <ButtonCloseIcon aria-hidden="true" />
                              <span>No default</span>
                            </SecondaryButton>
                          ) : (
                            <SecondaryButton
                              disabled={isWorkspaceSettingsBusy}
                              onClick={() => setDefaultWorkspace(selectedWorkspace.id, "workspace_settings")}
                              type="button"
                            >
                              <ButtonCheckIcon aria-hidden="true" />
                              <span>Set default</span>
                            </SecondaryButton>
                          )}
                          <WorkspaceModalCloseButton
                            aria-label="Close workspace settings"
                            disabled={isWorkspaceSettingsBusy}
                            onClick={closeWorkspaceSettings}
                            title="Close"
                            type="button"
                          >
                            <ButtonCloseIcon aria-hidden="true" />
                          </WorkspaceModalCloseButton>
                        </WorkspaceSettingsHeaderActions>
                      </WorkspaceSettingsDialogHeader>

                    <WorkspaceSettingsForm onSubmit={saveWorkspaceSettings}>
                      <WorkspaceSettingsSection>
                        <div>
                          <PanelKicker>Workspace</PanelKicker>
                          <SettingsHint>Name on the left, project root chooser on the right.</SettingsHint>
                        </div>
                        <WorkspaceSettingsTopGrid>
                          <SetupField>
                            <SettingsLabel>Name</SettingsLabel>
                            <WorkspaceSettingsInput
                              disabled={isWorkspaceSettingsBusy}
                              maxLength={80}
                              onChange={(event) => {
                                setWorkspaceNameDraft(event.target.value);
                                setWorkspaceSettingsError("");
                                setWorkspaceSettingsMessage("");
                              }}
                              value={workspaceNameDraft}
                            />
                          </SetupField>
                          <WorkspaceRootChooser>
                            <SettingsLabel>Root directory</SettingsLabel>
                            <RootDirectoryInput
                              disabled={isWorkspaceSettingsBusy}
                              maxLength={MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH}
                              placeholder={defaultWorkingDirectory || "Choose project root"}
                              readOnly
                              title={workspaceRootDraft || selectedWorkspaceRootDisplay}
                              value={workspaceRootDraft}
                            />
                            <WorkspaceRootActions>
                              <SecondaryButton
                                disabled={isWorkspaceSettingsBusy}
                                onClick={chooseWorkspaceRootDirectory}
                                type="button"
                              >
                                <ButtonFolderIcon aria-hidden="true" />
                                <span>Choose directory</span>
                              </SecondaryButton>
                              <SecondaryButton
                                disabled={!defaultWorkingDirectory || isWorkspaceSettingsBusy}
                                onClick={useDefaultWorkspaceRoot}
                                type="button"
                              >
                                <ButtonFolderIcon aria-hidden="true" />
                                <span>Use app dir</span>
                              </SecondaryButton>
                            </WorkspaceRootActions>
                          </WorkspaceRootChooser>
                        </WorkspaceSettingsTopGrid>
                      </WorkspaceSettingsSection>

                      <WorkspaceSettingsSection>
                        <div>
                          <PanelKicker>Terminal layout</PanelKicker>
                          <SettingsHint>Choose the total, then distribute panes across installed agent CLIs and plain terminals.</SettingsHint>
                        </div>
                        <WorkspaceTerminalCountPicker
                          disabled={isWorkspaceSettingsBusy}
                          onChange={(count) => {
                            const nextCount = normalizeWorkspaceTerminalCount(count);
                            setWorkspaceTerminalCountDraft(count);
                            setWorkspaceTerminalRolesDraft((roles) => (
                              normalizeWorkspaceTerminalRoles(
                                roles,
                                nextCount,
                                workspaceTerminalFallbackRole,
                                workspaceTerminalRoleOptions,
                              )
                            ));
                            setWorkspaceSettingsError("");
                            setWorkspaceSettingsMessage("");
                          }}
                          roleOptions={workspaceTerminalRoleOptions}
                          roles={workspaceTerminalRolesDraft}
                          value={workspaceTerminalCountDraft}
                        />
                        <WorkspaceTerminalRolePicker
                          count={workspaceTerminalCountDraft}
                          disabled={isWorkspaceSettingsBusy}
                          onChange={(roles) => {
                            setWorkspaceTerminalRolesDraft(roles);
                            setWorkspaceSettingsError("");
                            setWorkspaceSettingsMessage("");
                          }}
                          roleOptions={workspaceTerminalRoleOptions}
                          value={workspaceTerminalRolesDraft}
                        />
                      </WorkspaceSettingsSection>

                      <WorkspaceSettingsActions>
                        <PrimaryButton disabled={isWorkspaceSettingsBusy} type="submit">
                          <ButtonCheckIcon aria-hidden="true" />
                          <span>{workspaceSettingsState === "saving" ? "Saving..." : "Save"}</span>
                        </PrimaryButton>
                      </WorkspaceSettingsActions>
                    </WorkspaceSettingsForm>

                    {workspaceSettingsError && <FormMessage $state="error">{workspaceSettingsError}</FormMessage>}
                    {workspaceSettingsMessage && <AgentInstallMessage data-tone="success">{workspaceSettingsMessage}</AgentInstallMessage>}
                  </WorkspaceSettingsDialog>
                  {isWorkspaceSettingsDeactivating && (
                    <WorkspaceSettingsBusyOverlay aria-live="polite" role="status">
                      <WorkspaceSettingsBusyPanel aria-label="Deactivating workspace">
                        <WorkspaceCloseSpinner aria-hidden="true" />
                        <WorkspaceCloseTitle>Deactivating workspace</WorkspaceCloseTitle>
                        <WorkspaceCloseDetail>
                          Stopping file watchers, terminals, and workspace services before the runtime is released.
                        </WorkspaceCloseDetail>
                        <WorkspaceCloseCounter>
                          {workspaceDeactivateTotal > 0
                            ? `${workspaceDeactivateClosed}/${workspaceDeactivateTotal} ${workspaceDeactivateTerminalLabel}`
                            : "Stopping workspace runtime"}
                        </WorkspaceCloseCounter>
                        <WorkspaceCloseProgressTrack aria-hidden="true">
                          <WorkspaceCloseProgressBar $progress={workspaceDeactivateProgress} />
                        </WorkspaceCloseProgressTrack>
                      </WorkspaceSettingsBusyPanel>
                    </WorkspaceSettingsBusyOverlay>
                  )}
                </WorkspaceSettingsOverlay>
              )}
              {crashRecoveryModal?.interruptedTasks?.length > 0 && (
                <CrashRecoveryOverlay aria-label="Crash recovery modal">
                  <CrashRecoveryDialog
                    aria-labelledby="crash-recovery-title"
                    aria-modal="true"
                    role="dialog"
                  >
                    <WorkspaceSettingsDialogHeader>
                      <WorkspaceSettingsHeaderMain>
                        <div>
                          <PanelKicker>Crash recovery</PanelKicker>
                          <PanelHeading id="crash-recovery-title">Some agents were interrupted</PanelHeading>
                        </div>
                        <CrashRecoveryIntro>
                          <p>
                            Diff Forge found agent work that was still active when the desktop app stopped unexpectedly.
                            Those sessions were marked <strong>interrupted</strong> so stale leases and protected sessions do not block new work.
                          </p>
                          <p>
                            Choose <strong>Resume agents</strong> to open the terminal workspace and continue manually.
                            Nothing will be typed or submitted to an agent automatically.
                          </p>
                        </CrashRecoveryIntro>
                      </WorkspaceSettingsHeaderMain>
                    </WorkspaceSettingsDialogHeader>

                    <CrashRecoveryList>
                      {crashRecoveryModal.interruptedTasks.map((task) => {
                        const taskBody = String(task.body || "");

                        return (
                          <CrashRecoveryItem key={`${task.sessionId || "session"}-${task.taskId || "task"}`}>
                            <CrashRecoveryItemTitle>
                              {task.title || "Interrupted agent task"}
                            </CrashRecoveryItemTitle>
                            {taskBody && (
                              <CrashRecoveryItemBody>
                                {taskBody.slice(0, 220)}
                                {taskBody.length > 220 ? "..." : ""}
                              </CrashRecoveryItemBody>
                            )}
                            <CrashRecoveryMeta>
                              <span>{task.agentName || task.agentKind || "Agent"}</span>
                              {task.slotKey && <span>{task.slotKey}</span>}
                              {task.repoPath && <span>{task.repoPath}</span>}
                              {task.previousTaskStatus && <span>was {task.previousTaskStatus}</span>}
                            </CrashRecoveryMeta>
                          </CrashRecoveryItem>
                        );
                      })}
                    </CrashRecoveryList>

                    <CrashRecoveryActions>
                      <SecondaryButton onClick={() => chooseCrashRecoveryPath("fresh")} type="button">
                        <span>Start fresh</span>
                      </SecondaryButton>
                      <PrimaryButton onClick={() => chooseCrashRecoveryPath("resume")} type="button">
                        <ButtonTerminalIcon aria-hidden="true" />
                        <span>Resume agents</span>
                      </PrimaryButton>
                    </CrashRecoveryActions>
                  </CrashRecoveryDialog>
                </CrashRecoveryOverlay>
              )}
              </DashboardShell>
              {isWorkspaceStartupOverlayVisible && (
                <WorkspaceStartupOverlay aria-label={`${BRAND_NAME} is initializing workspace`}>
                  <AmbientPanel data-position="left">
                    <span>&gt; workspace</span>
                    <p>Syncing session...</p>
                    <p>Preparing workspace...</p>
                  </AmbientPanel>
                  <AmbientPanel data-position="right">
                    <span>{displayName}</span>
                    <p>Terminals ready</p>
                    <p>Workspace ready</p>
                  </AmbientPanel>
                  <SplashCenter>
                    <SplashLogo src="/logo.webp" alt="" />
                    <SplashTitle>Welcome back</SplashTitle>
                    <SplashTagline>{displayName}</SplashTagline>
                    <LoadingTrack aria-hidden="true">
                      <LoadingFill />
                    </LoadingTrack>
                    <LaunchStatusPanel data-state={startupAgentStatusState}>
                      <LaunchStatusIcon aria-hidden="true" data-state={startupAgentStatusState}>
                        {startupAgentGateState === "choice" ? (
                          <ButtonRefreshIcon />
                        ) : startupAgentGateState === "checking" || startupAgentGateState === "updating" ? (
                          <PendingIcon />
                        ) : connectedAgentCount > 0 ? (
                          <ConnectedIcon />
                        ) : (
                          <ErrorIcon />
                        )}
                      </LaunchStatusIcon>
                      <LaunchStatusCopy>
                        <LoadingText>{startupAgentStatusTitle}</LoadingText>
                        <LoadingDetail>{startupAgentStatusDetail}</LoadingDetail>
                      </LaunchStatusCopy>
                    </LaunchStatusPanel>
                    {startupAgentGateState === "choice" && (
                      <LaunchActions data-layout="split">
                        <PrimaryButton onClick={updateStartupAgents} type="button">
                          <ButtonRefreshIcon aria-hidden="true" />
                          <span>Update first</span>
                        </PrimaryButton>
                        <SecondaryButton onClick={enterWorkspaceAfterAgentCheck} type="button">
                          <ConnectedIcon aria-hidden="true" />
                          <span>Enter workspace</span>
                        </SecondaryButton>
                      </LaunchActions>
                    )}
                  </SplashCenter>
                </WorkspaceStartupOverlay>
              )}
            </AuthenticatedWorkspaceFrame>
          ) : (
            <LoginScreen>
              <AuthSquareBackdrop />
              <LoginLayout>
                <BrandPanel aria-labelledby="desktop-title">
                  <BrandMark href="#" aria-label={BRAND_NAME}>
                    <img src="/logo.webp" alt="" />
                    <strong>{BRAND_NAME}</strong>
                  </BrandMark>

                  <IntroCopy>
                    <Kicker>Web sign in</Kicker>
                    <Headline id="desktop-title">Sign in to {BRAND_NAME}</Headline>
                    <Lede>
                      Use your browser for secure {BRAND_NAME} authentication, then return to this native app.
                    </Lede>
                    <IntroFeatureList aria-label="Desktop auth status">
                      <IntroFeature data-tone="blue">
                        <span />
                        Browser handoff
                      </IntroFeature>
                      <IntroFeature data-tone="orange">
                        <span />
                        Deep-link callback
                      </IntroFeature>
                      <IntroFeature>
                        <span />
                        Server session check
                      </IntroFeature>
                    </IntroFeatureList>
                  </IntroCopy>
                </BrandPanel>

                <LoginCard aria-label="Desktop sign in">
                  <LoginPanel>
                    <LoginCardTop>
                      <PanelKicker>Native app access</PanelKicker>
                      <LoginCardBadge data-state={authState}>{authStateLabel}</LoginCardBadge>
                    </LoginCardTop>
                    <LoginIconWrap aria-hidden="true">
                      {isAuthBusy ? <PendingIcon /> : <ButtonLoginIcon />}
                    </LoginIconWrap>
                    <SessionTitle>{authPanelTitle}</SessionTitle>
                    <SessionText>{authMessage}</SessionText>
                    {authError && <FormMessage $state="error">{authError}</FormMessage>}
                    <AuthStepRail aria-label="Desktop sign in checkpoints">
                      {AUTH_STEPS.map((step, index) => (
                        <AuthStep data-active={index === 0 || isAuthBusy} key={step}>
                          <span>{index + 1}</span>
                          <strong>{step}</strong>
                        </AuthStep>
                      ))}
                    </AuthStepRail>
                    <PrimaryButton disabled={isAuthBusy} onClick={startWebLogin} type="button">
                      <ButtonBrowserIcon aria-hidden="true" />
                      <span>{authButtonLabel}</span>
                    </PrimaryButton>
                  </LoginPanel>
                </LoginCard>
              </LoginLayout>
            </LoginScreen>
          )}
        </AppContent>

        {workspaceCloseState.isActive && (
          <WorkspaceCloseOverlay aria-live="polite" role="status">
            <WorkspaceClosePanel aria-label="Closing workspace">
              <WorkspaceCloseSpinner aria-hidden="true" />
              <WorkspaceCloseTitle>Closing workspace</WorkspaceCloseTitle>
              <WorkspaceCloseDetail>
                Shutting down terminals before closing {BRAND_NAME}.
              </WorkspaceCloseDetail>
              <WorkspaceCloseCounter>
                {workspaceCloseClosed} / {workspaceCloseTotal} {workspaceCloseTerminalLabel} closed
              </WorkspaceCloseCounter>
              <WorkspaceCloseProgressTrack aria-hidden="true">
                <WorkspaceCloseProgressBar $progress={workspaceCloseProgress} />
              </WorkspaceCloseProgressTrack>
            </WorkspaceClosePanel>
          </WorkspaceCloseOverlay>
        )}
      </AppFrame>
    </>
  );
}

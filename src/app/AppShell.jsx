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
  TERMINAL_AGENT_COLOR_HEX_BY_SLOT,
  normalizeTerminalColorSlot,
  sanitizeTerminalColor,
} from "../terminals/terminalColors.js";
import {
  closeWorkspaceTerminalPane,
  getDefaultTerminalIndexes,
  getTerminalAgentColorSlot,
  getTerminalPanelRows,
  getWorkspaceTerminalPaneId,
  normalizeWorkspaceTerminalIndexes,
  TERMINAL_INPUT_HOT_EVENT,
  WORKSPACE_THREAD_ARCHIVE_TERMINAL_RESET_EVENT,
} from "../terminals/WorkspaceTerminal.jsx";
import {
  terminalPromptSubmittedPayloadIsAuthoritative,
} from "../terminals/terminalPromptSubmission.js";
import {
  TERMINAL_ACTIVITY_HOOK_EVENT,
  TERMINAL_ARCHITECTURE_ACTIVITY_EVENT,
} from "../terminals/WorkspaceTerminal/terminalCore.js";
import {
  getProviderTurnCompletionIntent,
  shouldReconcileProviderTurnCompletion,
} from "../terminals/providerTurnIntent.js";
import {
  THREAD_BRIDGE_DIAGNOSTIC_LOGGING_ENABLED,
  logThreadBridgeDiagnosticEvent,
} from "../terminals/terminalDiagnostics";
import {
  terminalCommandPhaseFromLifecycleEvent,
  terminalActivityStatusIsBusy,
  terminalActivityStatusIsPaused,
  terminalActivityStatusIsSendable,
  terminalAgentUsesActivityHooks,
  terminalExecutionPhaseFromState,
  terminalPresenceStatusFromActivityStatus,
  terminalRailStateFromExecutionPhase,
  terminalRailStateFromActivityStatus,
  terminalReadinessFromPresenceStatus,
  terminalTurnStatusFromActivityStatus,
} from "../terminals/terminalActivityState.js";
import { logTerminalStatus } from "../terminals/terminalStatusLog";
import {
  getBigViewTextDiagnosticFields,
  logBigViewSyncDiagnosticEvent,
} from "../threads/bigViewSyncDiagnostics";
import {
  getWorkspaceActivationDiagnosticNowMs,
  logWorkspaceActivationDiagnosticEvent,
} from "../diagnostics/workspaceActivationDiagnostics.js";
import {
  getLiveTerminalForThread,
  getThreadTerminalGroundTruth,
  terminalPromptingUserBlocksShutdown,
} from "../threads/threadTerminalGroundTruth.js";
import {
  transcriptHasTurnCompletionForPrompt as transcriptHasTurnCompletionForPromptEvidence,
} from "../threads/workspaceThreadTranscriptEvidence.js";
import {
  isTerminalControlHistoryPrompt,
} from "../threads/terminalControlPrompts.js";
import { TERMINAL_IS_WINDOWS_HOST } from "../terminals/terminalScrollStabilityStrategies.jsx";
import TerminalView from "../terminals/TerminalView.jsx";
import {
  disposeSharedNotificationSfx,
  getSharedNotificationSfx,
  playNotificationSfx,
} from "../notifications/notificationSfx";
import { sendNativeNotification } from "../notifications/nativeNotifications";
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
  reduceTodoCompletedNotificationEvent,
  reduceWorkspaceNotificationEvent,
  resolveWorkspaceIdForNotificationEvent,
  TERMINAL_PARKED_PROMPT_EVENT,
  TODO_COMPLETED_NOTIFICATION_EVENT,
  WORKSPACE_NOTIFICATION_EVENT,
} from "../notifications/workspaceNotifications";
import {
  archiveWorkspaceThread,
  appendWorkspaceThreadProjectionEvents,
  bindWorkspaceThreadTerminal,
  buildWorkspaceThreadsPersistDelta,
  clearWorkspaceThreadsBrowserPersistence,
  clearWorkspaceThreadPendingPrompt,
  createWorkspaceThreadId,
  diagnoseWorkspaceThreadSessionTranscriptHydration,
  ensureWorkspaceThreadsForTerminalIndexes,
  getWorkspaceThreadForTerminalIndex,
  getWorkspaceThreadCanArchive,
  getWorkspaceThreadDetailVisibilityKey,
  getWorkspaceThreadProviderBinding,
  getWorkspaceThreadTerminalNickname,
  getWorkspaceThreadsByTerminalIndex,
  hydrateWorkspaceThreadSessionTranscript,
  invalidateWorkspaceThreadProviderSession,
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
  WORKSPACE_THREAD_DETAIL_VISIBILITY_EVENT,
  workspaceThreadIdIsArchived,
  workspaceThreadDetailIsVisible,
  workspaceThreadSessionIsArchived,
} from "../threads/workspaceThreads";
import {
  AUDIO_TRANSCRIPTION_PROVIDER_CLOUD,
  AUDIO_TRANSCRIPTION_PROVIDER_FORGE,
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
  WorkspaceCloseSteps,
  WorkspaceCloseStep,
  WorkspaceCloseStepDot,
  WorkspaceCloseStepCopy,
  WorkspaceCloseStepLabel,
  WorkspaceCloseStepMeta,
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
  WorkspaceStartupDetails,
  DashboardShell,
  WorkspaceRail,
  RailHeader,
  RailTop,
  RailSectionTitle,
  RailCollapseButton,
  RailCreateWorkspaceButton,
  RailAccountScopeShell,
  RailAccountScopeSelect,
  RailAccountScopeIcon,
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
  AgentSafetyModeGroup,
  AgentSafetyModeButton,
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
  WorkspaceSettingsBusyOverlay,
  WorkspaceSettingsBusyPanel,
  WorkspaceGitPullOverlay,
  WorkspaceGitPullDialog,
  WorkspaceGitPullHeader,
  WorkspaceGitPullSummary,
  WorkspaceGitPullList,
  WorkspaceGitPullRow,
  WorkspaceGitPullRepoMeta,
  WorkspaceGitPullActions,
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
  WorkspaceSettingsInput,
  WorkspaceSettingsSelect,
  WorkspaceSettingsSelectIcon,
  WorkspaceSettingsSelectShell,
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
  SettingsRepoCard,
  SettingsRepoGrid,
  CreditUsageTrack,
  CreditUsageFill,
  LowCreditWarningToast,
  LowCreditWarningCopy,
  LowCreditWarningActions,
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
  TitleBackgroundIcon,
  TitleMinimizeIcon,
  WindowBackgroundPill,
  WindowSyncPill,
  WindowSyncPillDot,
  WindowSyncPillSpinner,
  TitleMaximizeIcon,
  TitleRestoreIcon,
  TitleCloseIcon,
  ButtonRefreshIcon,
  ButtonAddIcon,
  ButtonLoginIcon,
  ButtonBrowserIcon,
  ButtonAssetsIcon,
  ButtonCloseIcon,
  ButtonDarkModeIcon,
  ButtonDeleteIcon,
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
  ButtonSnippingIcon,
  ButtonHubIcon,
  ButtonCheckIcon,
  ButtonRailCollapseIcon,
  ButtonRailExpandIcon,
  FileChevronIcon,
  FileExpandIcon,
  FileFolderTreeIcon,
  FileDocumentIcon,
  WorkspaceCreateLayer,
  WorkspaceCreateSurface,
  WorkspaceCreateCard,
  WorkspaceCreateHeader,
  WorkspaceCreateSection,
  WorkspaceCreatePathBar,
  WorkspaceCreatePathText,
  WorkspaceCreatePathBadge,
  WorkspaceCreateCdForm,
  WorkspaceCreateCdPrompt,
  WorkspaceCreateCdInput,
  WorkspaceCreateDirGrid,
  WorkspaceCreateDirChip,
  WorkspaceCreateAgentGrid,
  WorkspaceCreateAgentCard,
  WorkspaceCreateAgentLabel,
  WorkspaceCreateAgentStepper,
  WorkspaceCreateAgentStepButton,
  WorkspaceCreatePreviewRow,
  WorkspaceCreatePreviewDot,
  WorkspaceCreateFooter,
  VIEW_TRANSITION_MS
} from "./appStyles";
import ToolsWorkspaceView from "../tools/ToolsWorkspaceView.jsx";
import FilesWorkspaceView, { getDirectoryName } from "../files/FilesWorkspaceView.jsx";
import ArchitectureWorkspaceView from "../architecture/ArchitectureWorkspaceView.jsx";
import AccountAssetsView from "../assets/AccountAssetsView.jsx";
import BackgroundMonitorWindow from "../background/BackgroundMonitorWindow.jsx";
import { useAccountAssetsLibrary } from "../assets/useAccountAssetsLibrary.js";
import { useUntrackedAssetsLibrary } from "../assets/useUntrackedAssetsLibrary.js";
import ActivityOverlayWindow, {
  ACTIVITY_OVERLAY_CONTEXT_STORAGE_KEY,
  ACTIVITY_OVERLAY_HASH,
} from "../activity/ActivityOverlay.jsx";
import AudioWorkspaceView, { AudioWidgetWindow, AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT, AUDIO_WIDGET_HASH, AUDIO_WIDGET_VISIBILITY_CHANGED_EVENT } from "../audio/AudioWorkspaceView.jsx";
import TerminalWindowHost, { TERMINAL_WINDOW_HASH } from "../terminals/TerminalWindowHost.jsx";
import SnippingWorkspaceView, { SnippingOverlayWindow, SNIPPING_OVERLAY_HASH } from "../snipping/SnippingWorkspaceView.jsx";
import SnippingQuickAccess, {
  SnippingAnnotationEditorWindow,
  SnippingFloatWindow,
  SNIPPING_EDITOR_HASH,
  SNIPPING_FLOAT_HASH,
  SNIPPING_TOAST_HASH,
} from "../snipping/SnippingQuickAccess.jsx";
import ProcessesView from "../processes/ProcessesView.jsx";
import AccountTokenomicsView, { startAccountTokenomicsStartupScan } from "../tokenomics/AccountTokenomicsView.jsx";


const WEB_LOGIN_URL = "https://diffforge.ai/desktop/login";
const PRICING_URL = "https://diffforge.ai/pricing";
const BRAND_NAME = "Diff Forge AI";
const LAUNCH_MINIMUM_MS = 1400;
const AUTH_STARTUP_TIMEOUT_MS = 30000;
const DEEP_LINK_STARTUP_TIMEOUT_MS = 3000;
const SESSION_RESTORE_TIMEOUT_MS = 5000;
const SESSION_RESTORE_TIMEOUT_MESSAGE = "Secure session check timed out after 5 seconds.";
const AUTH_EXCHANGE_TIMEOUT_MS = 10000;
const AUTH_EXCHANGE_TIMEOUT_MESSAGE = "Desktop sign in timed out. Try again.";
const CLOUD_MCP_AUTH_CONNECT_TIMEOUT_MS = 25000;
const CLOUD_MCP_AUTH_CONNECT_TIMEOUT_MESSAGE = "Cloud workspace connection timed out. Try again.";
const CLOUD_MCP_SIGNIN_DIAGNOSTICS_ENABLED = false;
const CLOUD_MCP_CONNECTION_DIAGNOSTICS_ENABLED = false;
const OPEN_BROWSER_TIMEOUT_MS = 5000;
const BACKEND_HELLO_TIMEOUT_MS = 5000;
const BACKEND_HELLO_TIMEOUT_MESSAGE = "Diff Forge API check timed out.";
const PLAN_REFRESH_TIMEOUT_MS = 5000;
const BILLING_STATUS_REFRESH_MS = 60000;
const LOW_CREDIT_WARNING_STORAGE_KEY = "diffforge.lowCreditWarning.dismissed.v1";
const LOW_CREDIT_WARNING_THRESHOLD = 1000;
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
const SELECTED_WORKSPACE_DETAIL_VIEWS = new Set(["files", "architecture"]);
const GLOBAL_TOOLS_VIEWS = new Set(["tools", "architectures", "mcps"]);
const WORKSPACE_GIT_PULL_PROMPT_INITIAL_STATE = Object.freeze({
  state: "idle",
  workspaceId: "",
  rootDirectory: "",
  checkKey: "",
  repositories: [],
  selected: {},
  blockedCount: 0,
  error: "",
  message: "",
});

function workspaceGitPullPromptCheckKey(workspaceId, rootDirectory) {
  if (!workspaceId || !rootDirectory) {
    return "";
  }
  return `${workspaceId}:${getWorkspaceRootIdentity(rootDirectory)}`;
}

function normalizeWorkspaceGitPullRepository(repository) {
  const path = String(repository?.path || "").trim();
  const name = String(repository?.name || "").trim() || getDirectoryName(path) || "repository";
  const relativePath = String(repository?.relativePath || "").trim();
  const statusCounts = repository?.statusCounts && typeof repository.statusCounts === "object"
    ? repository.statusCounts
    : {};
  return {
    path,
    name,
    relativePath,
    branch: String(repository?.branch || "").trim(),
    headSha: String(repository?.headSha || "").trim(),
    upstream: String(repository?.upstream || "").trim(),
    ahead: Number(repository?.ahead) || 0,
    behind: Number(repository?.behind) || 0,
    dirty: Boolean(repository?.dirty),
    statusCounts,
    operationState: repository?.operationState || null,
    fetchOk: Boolean(repository?.fetchOk),
    fetchError: String(repository?.fetchError || "").trim(),
    reason: String(repository?.reason || "").trim(),
    pullable: Boolean(repository?.pullable),
  };
}

function readDismissedLowCreditWarningKey() {
  try {
    return window.localStorage.getItem(LOW_CREDIT_WARNING_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeDismissedLowCreditWarningKey(value) {
  try {
    if (value) {
      window.localStorage.setItem(LOW_CREDIT_WARNING_STORAGE_KEY, value);
    } else {
      window.localStorage.removeItem(LOW_CREDIT_WARNING_STORAGE_KEY);
    }
  } catch {
    // Dismissal is a convenience only.
  }
}

function formatCreditCount(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "-";
  }

  return Math.max(0, Math.round(numericValue)).toLocaleString();
}

function creditResetLabel(resetAt) {
  if (!resetAt) {
    return "No reset date";
  }

  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(new Date(resetAt));
  } catch {
    return "No reset date";
  }
}

function creditUsagePercent(credits) {
  const total = Number(credits?.termTotalCredits || 0);
  const remaining = Number(credits?.termRemainingCredits || 0);

  if (!Number.isFinite(total) || total <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round((remaining / total) * 100)));
}

function liveCreditNumber(value, fallback = null) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
}

function liveCreditText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeLiveCreditWallet(wallet, previous = {}) {
  const credits = wallet?.credits || wallet?.wallet || wallet || {};
  const total = credits.total || credits.totalCredits || {};
  const term = credits.term || {};
  const termEnd = liveCreditText(term.term_end || term.termEnd, previous.resetAt || "");
  return {
    ...(previous || {}),
    known: credits.known ?? previous?.known ?? true,
    live: credits.live ?? previous?.live ?? true,
    source: liveCreditText(credits.source, previous?.source || "diff_forge_hot_credit_wallet"),
    walletVersion: liveCreditNumber(credits.wallet_version ?? credits.walletVersion, previous?.walletVersion || 0),
    pendingEventCount: liveCreditNumber(credits.pending_event_count ?? credits.pendingEventCount, previous?.pendingEventCount || 0),
    planName: liveCreditText(term.plan_name || term.planName, previous?.planName || ""),
    resetAt: termEnd || null,
    termEnd: termEnd || null,
    termId: liveCreditText(term.id, previous?.termId || ""),
    termRemainingCredits: liveCreditNumber(total.remaining_credits ?? total.remainingCredits, previous?.termRemainingCredits || 0),
    termReservedCredits: liveCreditNumber(total.reserved_credits ?? total.reservedCredits, previous?.termReservedCredits || 0),
    termTotalCredits: liveCreditNumber(total.total_credits ?? total.totalCredits, previous?.termTotalCredits || 0),
    termUsedCredits: liveCreditNumber(total.used_credits ?? total.usedCredits, previous?.termUsedCredits || 0),
    providerCostMicrousd: liveCreditNumber(total.provider_cost_microusd ?? total.providerCostMicrousd, previous?.providerCostMicrousd || 0),
    inputTokens: liveCreditNumber(total.input_tokens ?? total.inputTokens, previous?.inputTokens || 0),
    cachedInputTokens: liveCreditNumber(total.cached_input_tokens ?? total.cachedInputTokens, previous?.cachedInputTokens || 0),
    outputTokens: liveCreditNumber(total.output_tokens ?? total.outputTokens, previous?.outputTokens || 0),
    audioSeconds: liveCreditNumber(total.audio_seconds ?? total.audioSeconds, previous?.audioSeconds || 0),
    ttsCharacters: liveCreditNumber(total.tts_characters ?? total.ttsCharacters, previous?.ttsCharacters || 0),
    webSearchCalls: liveCreditNumber(total.web_search_calls ?? total.webSearchCalls, previous?.webSearchCalls || 0),
    eventCount: liveCreditNumber(total.event_count ?? total.eventCount, previous?.eventCount || 0),
    updatedAt: liveCreditText(credits.updated_at || credits.updatedAt, new Date().toISOString()),
  };
}

function lowCreditWarningKey(credits) {
  if (!credits) {
    return "";
  }

  return [
    credits.termId || credits.resetAt || "current",
    credits.lowCreditState || "unknown",
    credits.termRemainingCredits ?? "unknown",
  ].join(":");
}

function shouldShowLowCreditWarning(credits, dismissedKey) {
  if (!credits) {
    return false;
  }

  const state = String(credits.lowCreditState || "").toLowerCase();
  const remaining = Number(credits.termRemainingCredits || 0);
  const isLow = ["low", "critical", "exhausted", "missing_term"].includes(state)
    || (Number.isFinite(remaining) && remaining <= LOW_CREDIT_WARNING_THRESHOLD);
  const warningKey = lowCreditWarningKey(credits);

  return Boolean(isLow && warningKey && warningKey !== dismissedKey);
}

function safeDiagnosticDetails(details) {
  if (!details || typeof details !== "object") {
    return {};
  }

  try {
    return JSON.parse(JSON.stringify(details));
  } catch {
    return {};
  }
}

async function recordCloudSigninDiagnostic(token, event) {
  if (!CLOUD_MCP_SIGNIN_DIAGNOSTICS_ENABLED || !isSafeAuthValue(token)) {
    return;
  }

  try {
    await invoke("record_desktop_signin_diagnostic", {
      token,
      flowId: event.flowId || "desktop-cloud-connect",
      source: event.source || "rust-diffforge-ui",
      step: event.step,
      status: event.status || "ok",
      message: event.message || "",
      details: safeDiagnosticDetails(event.details),
    });
  } catch {
    // Diagnostic logging must never block sign-in.
  }
}

async function recordCloudConnectionDiagnostic(token, event) {
  if (!CLOUD_MCP_CONNECTION_DIAGNOSTICS_ENABLED || !isSafeAuthValue(token)) {
    return;
  }
  const status = String(event?.status || "").trim().toLowerCase();
  const terminalInputHotUntil = typeof window === "undefined"
    ? 0
    : Number(window.__diffforgeTerminalInputHotUntil || 0);
  if (status !== "error" && terminalInputHotUntil > Date.now()) {
    return;
  }

  try {
    await invoke("record_desktop_connection_diagnostic", {
      token,
      channel: event.channel || "rust-client",
      details: safeDiagnosticDetails(event.details),
      flowId: event.flowId || "desktop-cloud-runtime",
      message: event.message || "",
      repoId: event.repoId || event.repo_id || "",
      source: event.source || "rust-diffforge-ui",
      status: event.status || "ok",
      step: event.step,
      workspaceId: event.workspaceId || event.workspace_id || "",
    });
  } catch {
    // Connection diagnostics must never block app runtime behavior.
  }
}

async function syncCloudMcpDesktopSessionToken(token, options = {}) {
  const emitProgress = (progress) => {
    if (typeof options.onProgress !== "function") {
      return;
    }

    try {
      options.onProgress(progress);
    } catch {
      // Progress callbacks are visual only.
    }
  };

  try {
    const safeToken = isSafeAuthValue(token) ? token : null;
    const flowId = options.flowId || "desktop-cloud-connect";
    if (safeToken) {
      emitProgress({
        detail: "Passing your web session into the native cloud runtime.",
        stage: "desktop_session",
        status: "active",
        title: "Securing desktop session",
      });
    }
    await recordCloudConnectionDiagnostic(safeToken, {
      channel: "rust-client-auth",
      flowId,
      step: "rust.cloud_mcp.desktop_token.set",
      status: "start",
      message: "Rust client is sending desktop session token to Cloud MCP runtime.",
      details: {
        hasToken: Boolean(safeToken),
        requireConnected: Boolean(options.requireConnected),
      },
    });
    await recordCloudSigninDiagnostic(safeToken, {
      flowId,
      step: "cloud_mcp.desktop_token.set",
      status: "start",
      message: "sending desktop session token to Cloud MCP runtime",
      details: {
        requireConnected: Boolean(options.requireConnected),
        hasToken: Boolean(safeToken),
      },
    });
    const accountScope = options.accountScope || authStore.getActiveScope?.() || null;
    const scopePayload = accountScopeInvokePayload(accountScope);
    const entitlementPayload = {
      planName: options.planName || "plus",
      deviceLimit: Number.isInteger(options.deviceLimit) ? options.deviceLimit : 3,
    };
    const status = await invoke("cloud_mcp_set_desktop_session_token", {
      token: safeToken,
      scopeType: scopePayload.scopeType,
      teamId: scopePayload.teamId,
      planName: entitlementPayload.planName,
      deviceLimit: entitlementPayload.deviceLimit,
    });
    await recordCloudConnectionDiagnostic(safeToken, {
      channel: "rust-client-auth",
      flowId,
      step: "rust.cloud_mcp.desktop_token.set",
      status: "ok",
      message: "Cloud MCP runtime accepted desktop session token.",
      details: status,
    });
    await recordCloudSigninDiagnostic(safeToken, {
      flowId,
      step: "cloud_mcp.desktop_token.set",
      status: "ok",
      message: "Cloud MCP runtime accepted desktop session token",
      details: status,
    });

    if (safeToken) {
      emitProgress({
        detail: "The native runtime accepted your signed-in desktop session.",
        stage: "desktop_session",
        status: "complete",
        title: "Desktop session accepted",
      });
    }

    if (!options.requireConnected || !safeToken) {
      return status;
    }

    const connectAttempts = Math.max(1, Math.floor(Number(options.connectAttempts || 1)));
    const retryDelayMs = Math.max(0, Number(options.connectRetryDelayMs || 0));
    let lastConnectError = null;

    for (let attempt = 1; attempt <= connectAttempts; attempt += 1) {
      emitProgress({
        attempt,
        detail: attempt === 1
          ? "Preparing short-lived cloud auth and requesting the assigned workspace route."
          : `The workspace is still coming online. Retrying connection ${attempt} of ${connectAttempts}.`,
        stage: attempt === 1 ? "cloud_auth" : "cloud_instance",
        status: "active",
        title: attempt === 1 ? "Preparing cloud auth" : "Still setting up your instance",
      });
      await recordCloudSigninDiagnostic(safeToken, {
        flowId,
        step: "cloud_mcp.connect.invoke",
        status: "start",
        message: "requesting Cloud MCP websocket connection",
        details: {
          attempt,
          attempts: connectAttempts,
          timeoutMs: CLOUD_MCP_AUTH_CONNECT_TIMEOUT_MS,
        },
      });

      const stopStatusPolling = startCloudWorkspaceStatusPolling(emitProgress);
      try {
        const connectedStatus = await withTimeout(
          invoke("cloud_mcp_connect"),
          CLOUD_MCP_AUTH_CONNECT_TIMEOUT_MS,
          CLOUD_MCP_AUTH_CONNECT_TIMEOUT_MESSAGE,
        );
        stopStatusPolling();
        await recordCloudConnectionDiagnostic(safeToken, {
          channel: "rust-client-auth",
          flowId,
          step: "rust.cloud_mcp.connect",
          status: connectedStatus?.connected && connectedStatus?.globalWsConnected ? "ok" : "warn",
          message: "Rust client Cloud MCP websocket connect command returned.",
          details: connectedStatus,
        });
        await recordCloudSigninDiagnostic(safeToken, {
          flowId,
          step: "cloud_mcp.connect.invoke",
          status: "ok",
          message: "Cloud MCP websocket connect command returned",
          details: connectedStatus,
        });

        if (!connectedStatus?.connected || !connectedStatus?.globalWsConnected) {
          throw new Error("Cloud workspace websocket is not connected yet.");
        }

        emitProgress({
          ...cloudWorkspaceProgressFromRuntimeStatus(connectedStatus),
          attempt,
          detail: "Your assigned cloud workspace is live and ready.",
          status: "connected",
          title: "Cloud workspace ready",
        });

        return connectedStatus;
      } catch (connectError) {
        stopStatusPolling();
        lastConnectError = connectError;

        if (attempt < connectAttempts) {
          emitProgress({
            attempt,
            detail: "The cloud route is still warming. The desktop app will keep waiting automatically.",
            stage: "cloud_instance",
            status: "active",
            title: "Still setting up your instance",
          });

          if (retryDelayMs > 0) {
            await waitMs(retryDelayMs);
          }
          continue;
        }

        throw connectError;
      }
    }

    throw lastConnectError || new Error("Cloud workspace websocket is not connected yet.");
  } catch (error) {
    if (options.requireConnected) {
      emitProgress({
        detail: getErrorMessage(error, "The cloud workspace did not finish connecting."),
        stage: "workspace_socket",
        status: "error",
        title: "Cloud workspace still unavailable",
      });
      await recordCloudConnectionDiagnostic(token, {
        channel: "rust-client-auth",
        flowId: options.flowId || "desktop-cloud-connect",
        step: "rust.cloud_mcp.connect",
        status: "error",
        message: getErrorMessage(error, "Cloud MCP connection failed."),
        details: { requireConnected: true },
      });
      await recordCloudSigninDiagnostic(token, {
        flowId: options.flowId || "desktop-cloud-connect",
        step: "cloud_mcp.connect.invoke",
        status: "error",
        message: getErrorMessage(error, "Cloud MCP connection failed."),
        details: { requireConnected: true },
      });
      throw error;
    }

    // Cloud MCP retries after the next auth transition.
    return null;
  }
}

function readMainWindowFocusedFallback() {
  if (typeof document === "undefined") {
    return true;
  }
  return document.visibilityState !== "hidden" && document.hasFocus();
}

const WORKSPACE_TERMINAL_PANE_PREFIX = "workspace-terminal";
const APP_SHUTDOWN_PROGRESS_EVENT = "forge-app-shutdown-progress";
const APP_CLOSE_REQUESTED_EVENT = "forge-app-close-requested";
const TERMINAL_CLOSE_ALL_PROGRESS_EVENT = "forge-terminal-close-all-progress";
const TERMINAL_PROMPT_SUBMITTED_EVENT = "forge-terminal-prompt-submitted";
const AGENT_THREAD_TRANSCRIPT_UPDATED_EVENT = "forge-agent-thread-transcript-updated";
const AGENT_STATUS_CACHE_KEY = "diffforge.agentStatuses.v1";
const AGENT_STATUS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const WORKSPACE_SETTINGS_STORAGE_KEY = "diffforge.workspaceSettings.v1";
const WORKSPACE_LIFECYCLE_STORAGE_KEY = "diffforge.workspaceLifecycle.v1";
const WORKSPACE_RAIL_STORAGE_KEY = "diffforge.workspaceRail.v1";
const WORKSPACE_COORDINATION_TARGETS_STORAGE_KEY = "diffforge.workspaceCoordinationTargets.v1";
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
const WORKSPACE_ACTIVE_SWITCH_OPENING_MS = 90;
const WORKSPACE_APP_STARTUP_SCAN_IDLE_DELAY_MS = 700;
const WORKSPACE_APP_STARTUP_SHARED_MCP_IDLE_DELAY_MS = 450;
const WORKSPACE_APP_STARTUP_MCP_INDEX_IDLE_DELAY_MS = 1600;
const WORKSPACE_APP_STARTUP_WARMUP_STAGGER_MS = 350;
const WORKSPACE_APP_STARTUP_IDLE_TIMEOUT_MS = 5000;
const WORKSPACE_ARCHITECTURE_GRAPH_LIST_REFRESH_MS = 900;
const WORKSPACE_ARCHITECTURE_GRAPH_LIST_PRELOAD_STAGGER_MS = 90;
const FILE_EXPLORER_LAYOUT_STORAGE_KEY = "diffforge.fileExplorerLayout.v1";
const FILE_EXPLORER_DEFAULT_SIZE = 28;
const FILE_EXPLORER_MIN_SIZE = 16;
const FILE_EXPLORER_MAX_SIZE = 76;
const FILE_PREVIEW_DEFAULT_SIZE = 72;
const FILE_PREVIEW_MIN_SIZE = 24;
const FILE_PREVIEW_MAX_SIZE = 84;
const WORKSPACE_THREAD_PROJECTION_POLL_INTERVAL_MS = 1500;
const WORKSPACE_THREAD_TRANSCRIPT_WATCH_FALLBACK_INTERVAL_MS = 12_000;
const WORKSPACE_THREAD_PROJECTION_POLL_TIMEOUT_MS = 30 * 60 * 1000;
const WORKSPACE_THREAD_TERMINAL_SUBMIT_TRANSCRIPT_POLL_TIMEOUT_MS = 4_000;
const WORKSPACE_THREAD_UNACCEPTED_PROMPT_TRANSCRIPT_POLL_TIMEOUT_MS = 6_000;
const WORKSPACE_THREAD_PROMPT_ACCEPTED_CACHE_TTL_MS = 2 * 60 * 1000;
const WORKSPACE_THREAD_PROMPT_ACCEPTED_CACHE_MAX = 512;
const WORKSPACE_THREAD_PROMPT_READY_TRANSCRIPT_DELAY_MS = 120;
const WORKSPACE_THREAD_DETAIL_VISIBILITY_TRANSCRIPT_REQUEST_DEDUP_MS = 3000;
const TERMINAL_INPUT_HOT_BACKGROUND_GRACE_MS = 700;
const TERMINAL_INPUT_HOT_FALLBACK_MS = 2500;
const WORKSPACE_PROMPT_DELIVERY_TIMEOUT_MS = 31 * 60 * 1000;
const WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT = "diffforge:workspace-thread-prompt-accepted";
const REMOTE_TODO_QUEUE_EVENT = "diffforge:remote-todo-queue";
const REMOTE_TODO_DELETE_EVENT = "diffforge:remote-todo-delete";
const SNIPPING_ANNOTATION_TODO_EVENT = "diffforge:snipping-annotation-todo";
const CLOUD_MCP_REMOTE_COMMAND_EVENT = "cloud-mcp-remote-command";
const CLOUD_MCP_DEVICE_DELETED_EVENT = "cloud-mcp-device-deleted";
const CLOUD_MCP_WORKSPACE_CATALOG_CHANGED_EVENT = "cloud-mcp-workspace-catalog-changed";
const CLOUD_MCP_CREDIT_WALLET_EVENT = "cloud-mcp-credit-wallet";
const CLOUD_MCP_TOKENOMICS_REFRESH_EVENT = "cloud-mcp-tokenomics-refresh";
const CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT = "cloud-mcp-workspace-todos-updated";
const CLOUD_MCP_REMOTE_COMMAND_RECEIPT_TTL_MS = 10 * 60 * 1000;
const CLOUD_MCP_REMOTE_COMMAND_RECEIPT_MAX = 512;
const TODO_QUEUE_WORKSPACE_STORAGE_PREFIX = "diffforge.todoQueue.";

function purgeWorkspaceTodoQueueLocalStorage(workspaceId) {
  const safeWorkspaceId = String(workspaceId || "")
    .replace(/[^\w.-]/g, "_")
    .slice(0, 120);
  if (!safeWorkspaceId || typeof window === "undefined" || !window.localStorage) {
    return;
  }
  try {
    const doomedKeys = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index) || "";
      if (
        key.startsWith(TODO_QUEUE_WORKSPACE_STORAGE_PREFIX)
        && key.endsWith(`.${safeWorkspaceId}`)
      ) {
        doomedKeys.push(key);
      }
    }
    doomedKeys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Workspace deletion should not fail on storage cleanup.
  }
}

function normalizeWorkspaceThreadPromptAcceptanceText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getWorkspaceThreadPromptAcceptanceKeys({
  agentId = "",
  expectedUserMessage = "",
  promptEventId = "",
  promptText = "",
  threadId = "",
  userMessage = "",
  workspaceId = "",
} = {}) {
  const safeWorkspaceId = String(workspaceId || "").trim();
  const safeThreadId = String(threadId || "").trim();
  if (!safeWorkspaceId || !safeThreadId) {
    return [];
  }

  const safePromptEventId = String(promptEventId || "").trim();
  const normalizedPromptText = normalizeWorkspaceThreadPromptAcceptanceText(
    promptText || expectedUserMessage || userMessage,
  );
  const agentKeys = String(agentId || "").trim().toLowerCase()
    ? [String(agentId || "").trim().toLowerCase(), "*"]
    : ["*"];
  const keys = [];

  agentKeys.forEach((agentKey) => {
    const baseKey = `${safeWorkspaceId}:${safeThreadId}:${agentKey}`;
    if (safePromptEventId) {
      keys.push(`${baseKey}:id:${safePromptEventId}`);
    }
    if (normalizedPromptText) {
      keys.push(`${baseKey}:text:${normalizedPromptText.length}:${normalizedPromptText.slice(0, 160)}`);
    }
  });

  return keys;
}

function workspaceThreadTranscriptWatchKey({
  agentId = "",
  promptEventId = "",
  providerSessionId = "",
  threadId = "",
  workspaceId = "",
} = {}) {
  const safeProviderSessionId = String(providerSessionId || "").trim();
  if (!safeProviderSessionId) {
    return "";
  }
  return [
    String(workspaceId || "").trim(),
    String(threadId || "").trim(),
    String(agentId || "").trim().toLowerCase(),
    safeProviderSessionId,
    String(promptEventId || "").trim(),
  ].join("|");
}

function pruneWorkspaceThreadPromptAcceptanceCache(cache, now = Date.now()) {
  if (!cache || typeof cache.forEach !== "function") {
    return;
  }
  cache.forEach((entry, key) => {
    if (now - Number(entry?.acceptedAt || 0) > WORKSPACE_THREAD_PROMPT_ACCEPTED_CACHE_TTL_MS) {
      cache.delete(key);
    }
  });
  while (cache.size > WORKSPACE_THREAD_PROMPT_ACCEPTED_CACHE_MAX) {
    const firstKey = cache.keys().next().value;
    if (!firstKey) {
      break;
    }
    cache.delete(firstKey);
  }
}

function rememberWorkspaceThreadPromptAcceptance(cache, detail = {}) {
  const now = Date.now();
  const keys = getWorkspaceThreadPromptAcceptanceKeys(detail);
  if (!cache || typeof cache.set !== "function" || !keys.length) {
    return null;
  }
  const accepted = {
    acceptedAt: now,
    agentId: String(detail.agentId || "").trim().toLowerCase(),
    matchedBy: detail.matchedBy || "terminal-submit",
    promptEventId: String(detail.promptEventId || "").trim(),
    promptText: String(detail.promptText || detail.expectedUserMessage || detail.userMessage || "").trim(),
    sessionId: String(detail.sessionId || "").trim(),
    threadId: String(detail.threadId || "").trim(),
    workspaceId: String(detail.workspaceId || "").trim(),
  };
  keys.forEach((key) => cache.set(key, accepted));
  pruneWorkspaceThreadPromptAcceptanceCache(cache, now);
  return accepted;
}

function getWorkspaceThreadPromptAcceptance(cache, detail = {}) {
  if (!cache || typeof cache.get !== "function") {
    return null;
  }
  const now = Date.now();
  const keys = getWorkspaceThreadPromptAcceptanceKeys(detail);
  for (const key of keys) {
    const accepted = cache.get(key);
    if (!accepted) {
      continue;
    }
    if (now - Number(accepted.acceptedAt || 0) > WORKSPACE_THREAD_PROMPT_ACCEPTED_CACHE_TTL_MS) {
      cache.delete(key);
      continue;
    }
    return accepted;
  }
  return null;
}

const VOICE_PLAN_TASK_LIFECYCLE_EVENT = "diffforge:voice-plan-task-lifecycle";
const TERMINAL_IDLE_STATUS_EVENT_TYPES = new Set([
  "provider-turn-completed",
  "provider-turn-interrupted",
]);

function terminalStatusEventForcesIdle(eventType) {
  return TERMINAL_IDLE_STATUS_EVENT_TYPES.has(String(eventType || "").trim().toLowerCase());
}

function terminalStatusEventIndicatesParked(event = {}, options = {}) {
  const sourceEvent = event && typeof event === "object" ? event : {};
  const sourceOptions = options && typeof options === "object" ? options : {};
  return Boolean(
    sourceEvent.terminalIsParked === true
      || sourceEvent.terminal_is_parked === true
      || sourceEvent.parked === true
      || sourceOptions.terminalIsParked === true
      || sourceOptions.terminal_is_parked === true
      || sourceOptions.parked === true
  );
}

function normalizeTerminalPromptSource(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-");
}

const TERMINAL_HOOK_MANUAL_PROMPT_TYPES = new Set([
  "provider-manual-approval-required",
  "provider-user-input-required",
  "provider-user-prompt-started",
]);

const TERMINAL_HOOK_MANUAL_PROMPT_SOURCE_PARTS = [
  "cli-hook:manual-prompt",
  "cli-hook:provider-user-input-required",
  "cli-hook:provider-user-prompt-started",
  "hook-manual-prompt",
  "manual-prompt-hook",
  "provider-hook:manual-prompt",
];

const TERMINAL_RESOLVED_MANUAL_PROMPT_DECISIONS = new Set([
  "allow",
  "allowed",
  "approve",
  "approved",
  "auto",
  "auto-allow",
  "auto-allowed",
  "auto-approve",
  "auto-approved",
  "auto-denied",
  "auto-deny",
  "autoallow",
  "autoallowed",
  "autoapprove",
  "autoapproved",
  "autodenied",
  "autodeny",
  "deny",
  "denied",
  "reject",
  "rejected",
  "resolved",
]);

function terminalPromptSourceLooksExplicitPermission(source) {
  const normalized = normalizeTerminalPromptSource(source);
  return Boolean(
    normalized
      && TERMINAL_HOOK_MANUAL_PROMPT_SOURCE_PARTS.some((part) => normalized.includes(part))
      && !normalized.includes("terminal-output")
  );
}

function terminalStatusEventHasExplicitPermissionPrompt(event = {}, options = {}) {
  const sourceEvent = event && typeof event === "object" ? event : {};
  const sourceOptions = options && typeof options === "object" ? options : {};
  const eventType = normalizeTerminalPromptSource(
    sourceOptions.type
      || sourceOptions.eventType
      || sourceOptions.event_type
      || sourceEvent.type
      || sourceEvent.eventType
      || sourceEvent.event_type,
  );
  const source = sourceOptions.promptingUserSource
    || sourceOptions.prompting_user_source
    || sourceOptions.promptingSource
    || sourceOptions.prompting_source
    || sourceOptions.manualPromptSource
    || sourceOptions.manual_prompt_source
    || sourceOptions.source
    || sourceOptions.type
    || sourceEvent.promptingUserSource
    || sourceEvent.prompting_user_source
    || sourceEvent.promptingSource
    || sourceEvent.prompting_source
    || sourceEvent.manualPromptSource
    || sourceEvent.manual_prompt_source
    || sourceEvent.source
    || sourceEvent.type;
  const hookOwned = terminalPromptSourceLooksExplicitPermission(source)
    || normalizeTerminalPromptSource(sourceOptions.manualPromptSource || sourceOptions.manual_prompt_source) === "hook"
    || normalizeTerminalPromptSource(sourceEvent.manualPromptSource || sourceEvent.manual_prompt_source) === "hook";
  if (!hookOwned) {
    return false;
  }
  const resolvedDecision = [
    sourceOptions.permissionDecision,
    sourceOptions.permission_decision,
    sourceOptions.decision,
    sourceOptions.approvalDecision,
    sourceOptions.approval_decision,
    sourceOptions.permissionStatus,
    sourceOptions.permission_status,
    sourceOptions.approvalStatus,
    sourceOptions.approval_status,
    sourceEvent.permissionDecision,
    sourceEvent.permission_decision,
    sourceEvent.decision,
    sourceEvent.approvalDecision,
    sourceEvent.approval_decision,
    sourceEvent.permissionStatus,
    sourceEvent.permission_status,
    sourceEvent.approvalStatus,
    sourceEvent.approval_status,
  ].some((value) => TERMINAL_RESOLVED_MANUAL_PROMPT_DECISIONS.has(normalizeTerminalPromptSource(value)));
  if (resolvedDecision) {
    return false;
  }

  const hookManualPromptType = TERMINAL_HOOK_MANUAL_PROMPT_TYPES.has(eventType);
  const active = hookManualPromptType
    || sourceEvent.manualApprovalRequired === true
    || sourceEvent.manual_approval_required === true
    || sourceEvent.providerBlockedForUser === true
    || sourceEvent.provider_blocked_for_user === true
    || sourceOptions.manualApprovalRequired === true
    || sourceOptions.manual_approval_required === true
    || sourceOptions.providerBlockedForUser === true
    || sourceOptions.provider_blocked_for_user === true
    || sourceEvent.terminalIsPromptingUser === true
    || sourceEvent.terminal_is_prompting_user === true
    || sourceEvent.promptingUser === true
    || sourceEvent.prompting_user === true
    || sourceEvent.requiresUserInput === true
    || sourceEvent.requires_user_input === true
    || sourceOptions.terminalIsPromptingUser === true
    || sourceOptions.terminal_is_prompting_user === true
    || sourceOptions.promptingUser === true
    || sourceOptions.prompting_user === true
    || sourceOptions.requiresUserInput === true
    || sourceOptions.requires_user_input === true;
  if (!active) {
    return false;
  }

  const kind = String(
    sourceOptions.promptingUserKind
      || sourceOptions.prompting_user_kind
      || sourceEvent.promptingUserKind
      || sourceEvent.prompting_user_kind
      || sourceEvent.promptingKind
      || sourceEvent.prompting_kind
      || "",
  ).trim().toLowerCase().replace(/[_\s]+/g, "-");
  return Boolean(
    hookManualPromptType
      || (
        kind === "approval"
        || kind === "permission"
        || sourceEvent.manualApprovalRequired === true
        || sourceEvent.manual_approval_required === true
        || sourceEvent.providerBlockedForUser === true
        || sourceEvent.provider_blocked_for_user === true
        || sourceOptions.manualApprovalRequired === true
        || sourceOptions.manual_approval_required === true
        || sourceOptions.providerBlockedForUser === true
        || sourceOptions.provider_blocked_for_user === true
        || sourceEvent.requiresUserInput === true
        || sourceEvent.requires_user_input === true
        || sourceOptions.requiresUserInput === true
        || sourceOptions.requires_user_input === true
      )
  );
}

function terminalStatusEventIndicatesPaused(event = {}, options = {}) {
  const sourceEvent = event && typeof event === "object" ? event : {};
  const sourceOptions = options && typeof options === "object" ? options : {};
  if (terminalStatusEventIndicatesParked(sourceEvent, sourceOptions)) {
    return true;
  }

  return [
    sourceOptions.activityStatus,
    sourceOptions.activity_status,
    sourceOptions.displayStatus,
    sourceOptions.display_status,
    sourceOptions.executionPhase,
    sourceOptions.execution_phase,
    sourceOptions.nativeRailState,
    sourceOptions.native_rail_state,
    sourceOptions.readiness,
    sourceOptions.status,
    sourceOptions.statusAfter,
    sourceEvent.activityStatus,
    sourceEvent.activity_status,
    sourceEvent.displayStatus,
    sourceEvent.display_status,
    sourceEvent.executionPhase,
    sourceEvent.execution_phase,
    sourceEvent.nativeRailState,
    sourceEvent.native_rail_state,
    sourceEvent.readiness,
    sourceEvent.status,
    sourceEvent.statusAfter,
  ].some((value) => terminalActivityStatusIsPaused(value));
}

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

function transcriptLatestPostPromptMessage(messages, event = {}) {
  const userIndex = transcriptSubmittedPromptIndex(messages, event);
  if (userIndex < 0) {
    return null;
  }

  const transcriptMessages = Array.isArray(messages) ? messages : [];
  const nextUserIndex = transcriptMessages.findIndex((message, index) => (
    index > userIndex
      && String(message?.role || "").trim().toLowerCase() === "user"
      && !isTerminalControlHistoryPrompt(message?.text || message?.message)
  ));
  const searchEndIndex = nextUserIndex >= 0 ? nextUserIndex : transcriptMessages.length;
  for (let index = searchEndIndex - 1; index > userIndex; index -= 1) {
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
  const kind = String(message?.kind || "").trim().toLowerCase();
  const status = String(message?.status || "").trim().toLowerCase();
  const responseLooksSettled = ![
    "in_progress",
    "pending",
    "running",
    "streaming",
  ].includes(status || kind);
  return Boolean(
    role === "assistant"
      && (
        (text && responseLooksSettled)
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
  const pendingPromptId = String(thread?.pendingPrompt?.id || "").trim();
  if (pendingPromptId) {
    return pendingPromptId;
  }

  const latestTurn = thread?.latestTurn || null;
  const messageId = String(latestTurn?.messageId || "").trim();
  if (messageId) {
    return messageId;
  }

  const turnId = String(latestTurn?.turnId || "").trim();
  if (turnId.startsWith("turn-")) {
    return turnId.slice(5);
  }

  const latestUserMessage = getLatestWorkspaceThreadUserMessage(thread);
  const latestUserMessageId = String(latestUserMessage?.id || "").trim();
  if (!latestUserMessageId) {
    return "";
  }
  const latestTurnStartedAtMs = workspaceThreadMessageTimestampMs({
    createdAt: latestTurn?.startedAt || latestTurn?.requestedAt || latestTurn?.updatedAt,
  });
  const latestUserMessageAtMs = workspaceThreadMessageTimestampMs(latestUserMessage);
  if (
    latestTurnStartedAtMs
    && latestUserMessageAtMs
    && latestUserMessageAtMs < latestTurnStartedAtMs - 2500
  ) {
    return "";
  }
  return latestUserMessageId;
}

function getVoicePlanPromptEventIdCandidate(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (text.startsWith("voice-plan-")) {
    return text;
  }
  return text.match(/voice-plan-[^\s/]+-s\d+-(?:execution|revision)-t\d+/)?.[0] || "";
}

function resolveVoicePlanPromptEventIdFromThreadLifecycle(event = {}, thread = null) {
  const latestTurn = thread?.latestTurn || null;
  const latestUserMessage = getLatestWorkspaceThreadUserMessage(thread);
  const candidates = [
    event.promptEventId,
    event.pendingPromptId,
    event.promptId,
    event.messageId,
    event.turnId,
    event.providerTurnId,
    thread?.pendingPrompt?.id,
    thread?.pendingPrompt?.promptEventId,
    latestTurn?.messageId,
    latestTurn?.turnId,
    latestTurn?.id,
    getPromptEventIdFromRunningThread(thread),
    latestUserMessage?.id,
  ];

  for (const candidate of candidates) {
    const promptEventId = getVoicePlanPromptEventIdCandidate(candidate);
    if (promptEventId) {
      return promptEventId;
    }
  }

  return "";
}

function getWorkspaceThreadRunningPromptMessage(thread, promptEventId = "") {
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  const latestTurn = thread?.latestTurn || null;
  const safePromptEventId = String(promptEventId || "").trim();
  const latestTurnId = String(latestTurn?.turnId || latestTurn?.id || "").trim();
  const latestMessageId = String(latestTurn?.messageId || "").trim();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (String(message?.role || "").trim().toLowerCase() !== "user") {
      continue;
    }
    const messageId = String(message?.id || message?.messageId || message?.message_id || "").trim();
    const messageTurnId = String(message?.turnId || message?.turn_id || "").trim();
    const messagePromptEventId = String(message?.promptEventId || message?.prompt_event_id || "").trim();
    if (
      safePromptEventId
        && (
          messageId === safePromptEventId
          || messagePromptEventId === safePromptEventId
          || messageTurnId === safePromptEventId
          || messageTurnId.includes(safePromptEventId)
        )
    ) {
      return message;
    }
    if (
      latestMessageId
        && (
          messageId === latestMessageId
          || messagePromptEventId === latestMessageId
        )
    ) {
      return message;
    }
    if (
      latestTurnId
        && (
          messageTurnId === latestTurnId
          || (messageId && latestTurnId.includes(messageId))
        )
    ) {
      return message;
    }
  }
  return null;
}

function getWorkspaceThreadRunningPromptInfo(thread, promptEventId = "") {
  const matchedMessage = getWorkspaceThreadRunningPromptMessage(thread, promptEventId);
  const latestTurn = thread?.latestTurn || null;
  const pendingPrompt = thread?.pendingPrompt || null;
  const safePromptEventId = String(promptEventId || "").trim();
  const pendingPromptId = String(pendingPrompt?.id || pendingPrompt?.promptEventId || "").trim();
  const pendingPromptMatches = Boolean(
    pendingPrompt
      && (
        !safePromptEventId
        || !pendingPromptId
        || pendingPromptId === safePromptEventId
      )
  );
  const messageText = matchedMessage?.text || matchedMessage?.message || "";
  const pendingPromptText = pendingPromptMatches
    ? String(pendingPrompt?.text || pendingPrompt?.message || pendingPrompt?.promptText || "").trim()
    : "";
  const latestTurnPromptText = String(
    latestTurn?.promptText
      || latestTurn?.userMessage
      || latestTurn?.terminalPrompt
      || "",
  ).trim();
  return {
    createdAt: matchedMessage?.createdAt
      || matchedMessage?.created_at
      || pendingPrompt?.createdAt
      || pendingPrompt?.submittedAt
      || latestTurn?.startedAt
      || latestTurn?.requestedAt
      || "",
    message: matchedMessage || null,
    text: String(messageText || pendingPromptText || latestTurnPromptText || "").trim(),
  };
}

function getWorkspaceThreadPromptEventId(event = {}) {
  return String(event.promptEventId || event.pendingPromptId || event.promptId || "").trim();
}

function getWorkspaceThreadPromptEpoch(event = {}) {
  const numericValue = Number(event.promptEpoch ?? event.prompt_epoch ?? 0);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }
  return Math.floor(numericValue);
}

function threadLatestTurnMatchesPrompt(thread, event = {}) {
  const latestTurn = thread?.latestTurn || null;
  const promptEventId = getWorkspaceThreadPromptEventId(event);
  if (!latestTurn) {
    return false;
  }

  const latestTurnId = String(latestTurn?.turnId || latestTurn?.id || "").trim();
  const latestMessageId = String(latestTurn?.messageId || "").trim();
  const latestUserMessageId = String(getLatestWorkspaceThreadUserMessage(thread)?.id || "").trim();
  const promptEpoch = getWorkspaceThreadPromptEpoch(event);
  const latestPromptEpoch = getWorkspaceThreadPromptEpoch(latestTurn);
  const promptEpochMatches = Boolean(
    promptEpoch > 0
      && latestPromptEpoch > 0
      && promptEpoch === latestPromptEpoch
  );
  if (!promptEventId) {
    return promptEpochMatches;
  }

  const promptIdMatches = Boolean(
    latestTurnId.includes(promptEventId)
      || latestMessageId === promptEventId
      || latestUserMessageId === promptEventId
  );
  return Boolean(
    promptIdMatches
      && (
        promptEpoch <= 0
          || latestPromptEpoch <= 0
          || promptEpochMatches
      )
  );
}

function threadLatestRunningTurnMatchesPrompt(thread, event = {}) {
  const latestTurn = thread?.latestTurn || null;
  const latestTurnState = String(latestTurn?.state || "").trim().toLowerCase();
  if (latestTurnState !== "running") {
    return false;
  }

  if (threadLatestTurnMatchesPrompt(thread, event)) {
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
  if (String(event.matchedBy || "").trim().toLowerCase() === "sessionid") {
    return true;
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

function buildTerminalCompletedProjectionEvents(thread, event = {}) {
  const latestTurn = thread?.latestTurn || null;
  const latestTurnState = String(latestTurn?.state || "").trim().toLowerCase();
  const turnId = String(latestTurn?.turnId || latestTurn?.id || "").trim();
  if (latestTurnState !== "running" || !turnId) {
    return [];
  }

  const completedAt = String(
    event.completedAt
      || event.inputReadyAt
      || new Date().toISOString(),
  ).trim();
  const eventKey = workspaceThreadProjectionIdPart(
    event.promptEventId || event.pendingPromptId || turnId,
    "provider-turn-completed",
  );
  const promptEpoch = getWorkspaceThreadPromptEpoch(event);
  return [{
    agentId: event.agentId || event.currentAgent || thread?.currentAgent || "",
    assistantMessageId: latestTurn.assistantMessageId || "",
    completedAt,
    createdAt: completedAt,
    id: `projection-provider-turn-completed-${workspaceThreadProjectionIdPart(turnId, "turn")}-${eventKey}`,
    messageId: latestTurn.messageId || "",
    promptEpoch: promptEpoch || latestTurn.promptEpoch || 0,
    prompt_epoch: promptEpoch || latestTurn.promptEpoch || 0,
    source: event.source || event.type || "provider-turn-completed",
    status: "completed",
    turnId,
    type: "thread.turn.completed",
  }];
}

function buildTerminalErroredProjectionEvents(thread, event = {}) {
  const latestTurn = thread?.latestTurn || null;
  const latestTurnState = String(latestTurn?.state || "").trim().toLowerCase();
  const turnId = String(latestTurn?.turnId || latestTurn?.id || "").trim();
  if (latestTurnState !== "running" || !turnId) {
    return [];
  }

  const completedAt = String(
    event.completedAt
      || event.inputReadyAt
      || new Date().toISOString(),
  ).trim();
  const eventKey = workspaceThreadProjectionIdPart(
    event.promptEventId || event.pendingPromptId || turnId,
    "provider-turn-error",
  );
  const promptEpoch = getWorkspaceThreadPromptEpoch(event);
  return [{
    agentId: event.agentId || event.currentAgent || thread?.currentAgent || "",
    completedAt,
    createdAt: completedAt,
    id: `projection-provider-turn-error-${workspaceThreadProjectionIdPart(turnId, "turn")}-${eventKey}`,
    messageId: latestTurn.messageId || "",
    promptEpoch: promptEpoch || latestTurn.promptEpoch || 0,
    prompt_epoch: promptEpoch || latestTurn.promptEpoch || 0,
    source: event.source || event.type || "provider-turn-error",
    status: "error",
    text: event.error || event.message || "Provider turn failed.",
    turnId,
    type: "thread.turn.error",
  }];
}

function buildTerminalStartedProjectionEvents(event = {}) {
  const text = String(
    event.userMessage
      || event.message
      || event.expectedUserMessage
      || event.prompt
      || "",
  ).trim();
  if (!text || isTerminalControlHistoryPrompt(text)) {
    return [];
  }

  const createdAt = String(
    event.submittedAt
      || event.promptEventSubmittedAt
      || event.startedAt
      || event.hookObservedAt
      || new Date().toISOString(),
  ).trim();
  const eventKey = workspaceThreadProjectionIdPart(
    event.promptEventId
      || event.pendingPromptId
      || event.providerTurnId
      || event.turnId
      || event.hookTimestampMs
      || event.observedAtMs
      || createdAt,
    "hook-start",
  );
  const messageId = String(
    event.messageId
      || event.promptEventId
      || event.pendingPromptId
      || `message-hook-${eventKey}`,
  ).trim();
  const turnId = String(
    event.turnId
      || event.providerTurnId
      || `turn-${messageId}`,
  ).trim();
  const agentId = event.agentId || event.currentAgent || "";
  const source = event.source || event.type || "provider-turn-started";
  const promptEpoch = getWorkspaceThreadPromptEpoch(event);

  return [{
    agentId,
    createdAt,
    id: `projection-provider-turn-started-${workspaceThreadProjectionIdPart(turnId, "turn")}`,
    messageId,
    promptEpoch,
    prompt_epoch: promptEpoch,
    source,
    status: "running",
    turnId,
    type: "thread.turn.started",
  }, {
    agentId,
    createdAt,
    id: `projection-provider-user-${workspaceThreadProjectionIdPart(messageId, "message")}`,
    messageId,
    promptEpoch,
    prompt_epoch: promptEpoch,
    role: "user",
    source,
    status: "submitted",
    text,
    turnId,
    type: "thread.message.user",
  }];
}

function buildTerminalInterruptedProjectionEvents(thread, event = {}) {
  const latestTurn = thread?.latestTurn || null;
  const latestTurnState = String(latestTurn?.state || "").trim().toLowerCase();
  const turnId = String(latestTurn?.turnId || latestTurn?.id || "").trim();
  if (latestTurnState !== "running" || !turnId) {
    return [];
  }

  const interruptedAt = String(
    event.interruptedAt
      || event.inputReadyAt
      || event.completedAt
      || new Date().toISOString(),
  ).trim();
  const eventKey = workspaceThreadProjectionIdPart(
    event.promptEventId || event.pendingPromptId || turnId,
    "terminal-interrupted",
  );
  const promptEpoch = getWorkspaceThreadPromptEpoch(event);
  return [{
    agentId: event.agentId || event.currentAgent || thread?.currentAgent || "",
    assistantMessageId: latestTurn.assistantMessageId || "",
    completedAt: interruptedAt,
    createdAt: interruptedAt,
    id: `projection-terminal-interrupted-${workspaceThreadProjectionIdPart(turnId, "turn")}-${eventKey}`,
    messageId: latestTurn.messageId || "",
    promptEpoch: promptEpoch || latestTurn.promptEpoch || 0,
    prompt_epoch: promptEpoch || latestTurn.promptEpoch || 0,
    source: event.source || event.type || "terminal-interrupted",
    status: "interrupted",
    turnId,
    type: "thread.turn.interrupted",
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
      if (
        submittedAtMs
        && messageTimestampMs
        && messageTimestampMs < submittedAtMs - 30000
      ) {
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

function getWorkspaceThreadDiagnosticSnapshotForLog(workspaceThreads, workspaceId, threadId, agentId = "") {
  return THREAD_BRIDGE_DIAGNOSTIC_LOGGING_ENABLED
    ? getWorkspaceThreadDiagnosticSnapshot(workspaceThreads, workspaceId, threadId, agentId)
    : null;
}

function getWorkspaceThreadHydrationDiagnosticsForLog(workspaceThreads, event) {
  return THREAD_BRIDGE_DIAGNOSTIC_LOGGING_ENABLED
    ? diagnoseWorkspaceThreadSessionTranscriptHydration(workspaceThreads, event)
    : null;
}

function getTranscriptPromptMatchDiagnosticsForLog(messages, event = {}) {
  return THREAD_BRIDGE_DIAGNOSTIC_LOGGING_ENABLED
    ? getTranscriptPromptMatchDiagnostics(messages, event)
    : null;
}

function logWorkspaceThreadDiagnosticEvent(phase, fields = {}) {
  if (!THREAD_BRIDGE_DIAGNOSTIC_LOGGING_ENABLED) {
    return;
  }
  logThreadBridgeDiagnosticEvent(
    phase,
    typeof fields === "function" ? fields() : fields,
  );
}
const MCP_REGISTRY_STORAGE_KEY = "diffforge.mcpRegistry.v1";
const MCP_TEXT_LIMIT = 12000;
const MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH = 2048;
const MIN_WORKSPACE_TERMINAL_COUNT = 1;
const MAX_WORKSPACE_TERMINAL_COUNT = 24;
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
const WORKSPACE_MCP_SYNC_INTERVAL_MS = 120000;
const WORKSPACE_MCP_SYNC_TOOL_NAME_LIMIT = 32;
const WORKSPACE_MCP_SYNC_TEXT_LIMIT = 96;
const WORKSPACE_MCP_BACKGROUND_JOB_EVENT = "workspace-mcp-background-job";
const WORKSPACE_MCP_REGISTRY_UPDATED_EVENT = "diffforge:workspace-mcp-registry-updated";
function unwrapCloudCommandData(response, fallback = {}) {
  if (!response || typeof response !== "object") {
    return fallback;
  }
  return response.data || response;
}

function safeCloudMcpText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, 500) : fallback;
}

function safeCloudMcpArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeCloudMcpBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeCloudDeviceText(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function cloudDevicePlatformLabel(platform) {
  const normalized = normalizeCloudDeviceText(platform);
  if (normalized.includes("mac") || normalized.includes("darwin")) return "macOS";
  if (normalized.includes("win")) return "Windows";
  if (normalized.includes("linux")) return "Linux";
  if (normalized.includes("ios")) return "iOS";
  if (normalized.includes("android")) return "Android";
  return "Unknown OS";
}

function cloudDeviceFormFactorLabel(formFactor, platform) {
  const type = normalizeCloudDeviceText(formFactor);
  const normalizedPlatform = normalizeCloudDeviceText(platform);
  if (
    ["mobile", "phone", "tablet", "ios", "android"].some((item) => (
      type.includes(item) || normalizedPlatform.includes(item)
    ))
  ) {
    return "Mobile";
  }
  if (["web", "browser"].some((item) => type.includes(item))) return "Web";
  if (["pc", "desktop", "laptop", "macbook", "computer"].some((item) => type.includes(item))) return "PC";
  return "Device";
}

function cloudDevicePlatformIcon(device) {
  const explicit = normalizeCloudDeviceText(
    device?.platform_icon || device?.platformIcon || device?.device_icon || device?.deviceIcon,
  );
  if (["apple", "windows", "linux", "mobile", "web", "desktop", "device"].includes(explicit)) {
    return explicit;
  }
  const platform = normalizeCloudDeviceText(device?.platform || device?.os || device?.system);
  const formFactor = normalizeCloudDeviceText(
    device?.form_factor || device?.formFactor || device?.device_type || device?.deviceType,
  );
  const source = normalizeCloudDeviceText(
    device?.connection_source
      || device?.connectionSource
      || device?.client_kind
      || device?.clientKind
      || device?.source,
  );
  if (
    ["mobile", "phone", "tablet", "ios", "android"].some((item) => (
      formFactor.includes(item) || platform.includes(item)
    ))
  ) {
    return "mobile";
  }
  if (platform.includes("mac") || platform.includes("darwin")) return "apple";
  if (platform.includes("win")) return "windows";
  if (platform.includes("linux")) return "linux";
  if (
    ["web", "browser", "next", "dashboard"].some((item) => (
      formFactor.includes(item) || source.includes(item)
    ))
  ) {
    return "web";
  }
  if (["pc", "desktop", "laptop", "macbook", "computer"].some((item) => formFactor.includes(item))) return "desktop";
  return "device";
}

function normalizeCloudConnectedDevice(device, index = 0, options = {}) {
  if (!device || typeof device !== "object") {
    return null;
  }
  const includeOffline = Boolean(options.includeOffline);
  const deviceId = safeCloudMcpText(
    device.device_id || device.deviceId || device.machine_id || device.machineId || device.id,
    "",
  ).toLowerCase();
  const displayName = safeCloudMcpText(
    device.display_name
      || device.displayName
      || device.label
      || device.device_name
      || device.deviceName
      || device.machine_name
      || device.machineName
      || device.hostname
      || device.name
      || device.device_model
      || device.deviceModel,
    index === 0 ? "Diff Forge client" : `Device ${index + 1}`,
  );
  const statusText = normalizeCloudDeviceText(
    device.status
      || device.state
      || device.connection_status
      || device.connectionStatus,
  );
  const statusConnected = statusText
    ? ["connected", "online", "open", "active", "ready"].includes(statusText)
    : true;
  const connected = safeCloudMcpBool(
    device.connected
      ?? device.online
      ?? device.native_connected
      ?? device.nativeConnected
      ?? device.web_connected
      ?? device.webConnected,
    statusConnected,
  );
  if (!connected && !includeOffline) {
    return null;
  }
  const platform = safeCloudMcpText(device.platform || device.os || device.system, "");
  const formFactor = safeCloudMcpText(
    device.form_factor || device.formFactor || device.device_type || device.deviceType,
    "",
  );
  const icon = cloudDevicePlatformIcon(device);
  return {
    connected,
    deviceId: deviceId || `${normalizeCloudDeviceText(displayName) || "device"}:${index}`,
    displayName,
    formFactor,
    formFactorLabel: safeCloudMcpText(
      device.form_factor_label || device.formFactorLabel,
      "",
    ) || cloudDeviceFormFactorLabel(formFactor, platform),
    icon,
    platform,
    platformIcon: icon,
    platformLabel: safeCloudMcpText(
      device.platform_label || device.platformLabel,
      "",
    ) || cloudDevicePlatformLabel(platform),
    status: connected ? "connected" : "offline",
  };
}

function cloudDeviceCandidatesFromRuntimeStatus(status) {
  const liveRuntime = status?.liveRuntimeStatus || status?.live_runtime_status || {};
  const clientConnection = liveRuntime?.client_connection || liveRuntime?.clientConnection || {};
  const machineSource = liveRuntime?.machines?.items
    || liveRuntime?.machines?.devices
    || liveRuntime?.machines
    || [];
  return [
    ...safeCloudMcpArray(liveRuntime?.devices),
    ...safeCloudMcpArray(machineSource),
    ...safeCloudMcpArray(
      clientConnection?.active_desktop_devices || clientConnection?.activeDesktopDevices,
    ),
  ];
}

function cloudConnectedDevicesFromRuntimeStatus(status) {
  const candidates = cloudDeviceCandidatesFromRuntimeStatus(status);
  const byId = new Map();
  candidates.forEach((candidate, index) => {
    const device = normalizeCloudConnectedDevice(candidate, index);
    if (!device) {
      return;
    }
    byId.set(device.deviceId, { ...(byId.get(device.deviceId) || {}), ...device });
  });
  return Array.from(byId.values()).slice(0, 12);
}

function cloudKnownDevicesFromRuntimeStatus(status) {
  const candidates = cloudDeviceCandidatesFromRuntimeStatus(status);
  const byId = new Map();
  candidates.forEach((candidate, index) => {
    const device = normalizeCloudConnectedDevice(candidate, index, { includeOffline: true });
    if (!device) {
      return;
    }
    byId.set(device.deviceId, { ...(byId.get(device.deviceId) || {}), ...device });
  });
  return Array.from(byId.values()).slice(0, 48);
}

function cloudWorkspaceTodosFromRuntimeStatus(status) {
  const liveRuntime = status?.liveRuntimeStatus || status?.live_runtime_status || {};
  const workspaceTodos = status?.workspaceTodos
    || status?.workspace_todos
    || liveRuntime?.workspaceTodos
    || liveRuntime?.workspace_todos
    || null;
  return workspaceTodos && typeof workspaceTodos === "object" ? workspaceTodos : null;
}

function cloudStorageUsageFromRuntimeStatus(status) {
  const liveRuntime = status?.liveRuntimeStatus || status?.live_runtime_status || {};
  const storageUsage = status?.storageUsage
    || status?.storage_usage
    || liveRuntime?.storageUsage
    || liveRuntime?.storage_usage
    || liveRuntime?.tokenomics?.storageUsage
    || liveRuntime?.tokenomics?.storage_usage
    || null;
  return storageUsage && typeof storageUsage === "object" ? storageUsage : null;
}

function sanitizeWorkspaceMcpServerForCloud(server) {
  if (!server || typeof server !== "object") {
    return null;
  }

  const serverKey = safeCloudMcpText(
    server.server_key || server.serverKey || server.id || server.name,
    "",
  );
  if (!serverKey) {
    return null;
  }

  const tools = safeCloudMcpArray(server.tools_json || server.tools || server.toolsJson)
    .slice(0, WORKSPACE_MCP_SYNC_TOOL_NAME_LIMIT)
    .map((tool) => safeCloudMcpText(
      typeof tool === "string" ? tool : tool?.name || tool?.id,
      "",
    ).slice(0, WORKSPACE_MCP_SYNC_TEXT_LIMIT))
    .filter(Boolean);

  return {
    server_key: serverKey,
    name: safeCloudMcpText(server.name, serverKey).slice(0, WORKSPACE_MCP_SYNC_TEXT_LIMIT),
    workspace_enabled: safeCloudMcpBool(server.workspace_enabled ?? server.workspaceEnabled, true),
    tools,
    tool_count: tools.length,
  };
}

function sanitizeWorkspaceMcpRegistryForCloud(registry, target) {
  const data = unwrapCloudCommandData(registry, {});
  return {
    repoPath: target.repoPath,
    workspaceActive: Boolean(target.workspaceActive),
    workspaceId: target.workspaceId,
    workspaceIndex: target.workspaceIndex,
    workspaceName: target.workspaceName,
    workspaceOrder: target.workspaceOrder,
    workspaceStatus: target.workspaceStatus || (target.workspaceActive ? "active" : "deactivated"),
    servers: safeCloudMcpArray(data.servers)
      .map(sanitizeWorkspaceMcpServerForCloud)
      .filter(Boolean),
  };
}
const WORKSPACE_SHUTDOWN_STEPS = [
  {
    detail: "Detaching embedded workspace browser views.",
    id: "closing_webviews",
    label: "Closing web views",
  },
  {
    detail: "Stopping file watchers and workspace listeners.",
    id: "stopping_watchers",
    label: "Stopping watchers",
  },
  {
    detail: "Stopping graph sync tasks.",
    id: "stopping_syncs",
    label: "Stopping syncs",
  },
  {
    detail: "Stopping terminal processes and cleaning PTYs.",
    id: "closing_terminals",
    label: "Closing terminals",
  },
  {
    detail: "Stopping shared MCP daemons for this session.",
    id: "stopping_daemons",
    label: "Stopping MCP daemons",
  },
  {
    detail: "Finalizing shutdown.",
    id: "exiting",
    label: "Exiting",
  },
];
const WORKSPACE_SHUTDOWN_STEP_BY_ID = new Map(WORKSPACE_SHUTDOWN_STEPS.map((step, index) => [
  step.id,
  { ...step, index },
]));
const WORKSPACE_CLOSE_INITIAL_STATE = {
  isActive: false,
  closed: 0,
  total: 0,
  phase: "idle",
  phaseDetail: "",
  phaseLabel: "",
  step: 0,
  terminalTotalKnown: false,
  totalSteps: WORKSPACE_SHUTDOWN_STEPS.length,
};
const APP_CLOSE_CONFIRM_INITIAL_STATE = {
  isOpen: false,
  isLoading: false,
  source: "",
  error: "",
  generatedAtMs: 0,
  blockingCount: 0,
  terminalCount: 0,
  workspaces: [],
};
const WORKSPACE_DEACTIVATION_INITIAL_STATE = {
  isActive: false,
  workspaceId: "",
  source: "",
  closed: 0,
  total: 0,
};
const AUTH_STEPS = [
  {
    detail: "Opening secure web sign-in.",
    id: "browser_handoff",
    label: "Browser sign in",
  },
  {
    detail: "Matching the signed callback.",
    id: "deep_link",
    label: "Deep-link callback",
  },
  {
    detail: "Creating the native session.",
    id: "session_exchange",
    label: "Desktop session",
  },
];
const CLOUD_WORKSPACE_STEPS = [
  {
    detail: "Passing your web session into the native runtime.",
    id: "desktop_session",
    label: "Desktop session",
  },
  {
    detail: "Preparing short-lived cloud auth.",
    id: "cloud_auth",
    label: "Cloud auth",
  },
  {
    detail: "Finding the assigned backend for this account.",
    id: "cloud_route",
    label: "Cloud route",
  },
  {
    detail: "Starting the backend or container if needed.",
    id: "cloud_instance",
    label: "Instance setup",
  },
  {
    detail: "Completing the live websocket handshake.",
    id: "workspace_socket",
    label: "Live socket",
  },
];
const CLOUD_WORKSPACE_PROGRESS_INITIAL_STATE = Object.freeze({
  attempt: 0,
  connectedDevices: [],
  detail: "Waiting for web sign-in.",
  knownDevices: [],
  stage: "idle",
  status: "idle",
  storageUsage: null,
  title: "Cloud workspace",
  updatedAt: 0,
  workspaceTodos: null,
});
const CLOUD_WORKSPACE_CONNECT_ATTEMPTS = 8;
const ARCHITECTURE_GRAPH_LIST_ERROR_RETRY_MS = 30_000;
const CLOUD_WORKSPACE_CONNECT_RETRY_DELAY_MS = 2200;
const CLOUD_WORKSPACE_STATUS_POLL_MS = 650;
const CLOUD_WORKSPACE_STAGE_ORDER = Object.freeze({
  idle: 0,
  desktop_session: 1,
  cloud_auth: 2,
  cloud_route: 3,
  cloud_instance: 4,
  workspace_socket: 5,
});
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

function canonicalCodingAgentId(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (normalized === "codex" || normalized === "openai-codex") {
    return "codex";
  }
  if (normalized === "claude" || normalized === "claude-code" || normalized === "claudecode") {
    return "claude";
  }
  if (normalized === "opencode" || normalized === "open-code" || normalized === "open-code-ai" || normalized === "opencode-ai") {
    return "opencode";
  }
  return "";
}

function sanitizeCodingAgentStatusForCloud(status) {
  if (!status || typeof status !== "object") {
    return null;
  }
  const id = canonicalCodingAgentId(status.id || status.agent_id || status.agentId);
  const provider = AGENT_PROVIDERS.find((item) => item.id === id);
  if (!provider) {
    return null;
  }
  const installed = Boolean(status.installed);
  const authenticated = Boolean(status.authenticated);
  const npmAvailable = Boolean(status.npmAvailable);
  const npmInstalled = Boolean(status.npmInstalled);
  const npmPackageVersion = safeCloudMcpText(status.npmPackageVersion, "").slice(0, 120);
  const npmLatestVersion = safeCloudMcpText(status.npmLatestVersion, "").slice(0, 120);
  const npmUpdateAvailable = Boolean(installed && npmInstalled && status.npmUpdateAvailable);
  const npmPackageVersionKnown = Boolean(
    npmPackageVersion
      && npmPackageVersion !== "Not checked"
      && npmPackageVersion !== "Detected",
  );
  const npmLatestVersionKnown = Boolean(npmLatestVersion && npmLatestVersion !== "Not checked");
  const updateKnown = Boolean(installed && npmInstalled && npmPackageVersionKnown && npmLatestVersionKnown);
  const upToDate = Boolean(updateKnown && !npmUpdateAvailable);
  const operation = safeCloudMcpText(status.packageOperation || status.operation, "").slice(0, 40);
  const installing = operation === "installing" || Boolean(status.installing);
  const updating = operation === "updating" || Boolean(status.updating);
  const packageStatus = installing
    ? "installing"
    : updating
      ? "updating"
      : npmUpdateAvailable
        ? "update_available"
        : upToDate
          ? "up_to_date"
          : installed
            ? "installed"
            : "missing";
  return {
    id,
    label: safeCloudMcpText(status.label || status.agent_label || status.agentLabel, provider.label).slice(0, 80),
    installed,
    authenticated,
    version: safeCloudMcpText(status.version, "").slice(0, 120),
    npmAvailable,
    npmInstalled,
    npmPackageVersion,
    npmLatestVersion,
    npmUpdateAvailable,
    updateAvailable: npmUpdateAvailable,
    updateKnown,
    upToDate,
    installing,
    updating,
    operation: installing ? "installing" : updating ? "updating" : operation,
    packageStatus,
  };
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

function normalizeTerminalNativeRailState(value, fallback = "") {
  const text = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return text || fallback;
}

function formatTerminalNativeRailLabel(value) {
  return normalizeTerminalNativeRailState(value, "unknown").replace(/[_-]+/g, " ");
}

function getTerminalNativeRailStateFields(state, label = "") {
  const nativeRailState = normalizeTerminalNativeRailState(state, "unknown");
  const nativeRailLabel = String(label || "").trim()
    || formatTerminalNativeRailLabel(nativeRailState);
  return {
    nativeRailLabel,
    nativeRailState,
    native_rail_label: nativeRailLabel,
    native_rail_state: nativeRailState,
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


const WORKSPACE_CREATE_AGENT_ROLE_CAP = 8;

function expandWorkspaceCreateAgentCounts(roleOptions, agentCounts) {
  return roleOptions.flatMap((option) => (
    Array.from({ length: Math.max(0, Number(agentCounts[option.id]) || 0) }, () => option.id)
  ));
}

/**
 * Inline create-workspace panel rendered in the main area right of the
 * workspace rail. The directory is navigated like a shell: a cd input plus a
 * browsable listing of subdirectories, and coding agents are picked with
 * per-agent steppers instead of count + per-terminal dropdowns.
 */
function WorkspaceCreatePanel({
  agentStatuses,
  chooseNativeDirectory,
  defaultWorkingDirectory,
  fallbackRole,
  onClose,
  onSubmit,
  roleOptions,
  rootDraft,
  setRootDraft,
  setWorkspaceName,
  visible,
  workspaceError,
  workspaceName,
  workspaceSyncState,
}) {
  const [browse, setBrowse] = useState(null);
  const [browseError, setBrowseError] = useState("");
  const [cdDraft, setCdDraft] = useState("");
  const [agentCounts, setAgentCounts] = useState({});
  const browseSeqRef = useRef(0);
  const browseRef = useRef(null);
  const creating = workspaceSyncState === "creating";

  const browseTo = useCallback(async (path) => {
    const seq = browseSeqRef.current + 1;
    browseSeqRef.current = seq;
    setBrowseError("");
    try {
      const result = await invoke("browse_workspace_root_directory", {
        path: String(path || "").trim() || null,
      });
      if (browseSeqRef.current !== seq) {
        return;
      }
      browseRef.current = result;
      setBrowse(result);
      if (result?.workingDirectory) {
        setRootDraft(result.workingDirectory);
      }
    } catch (error) {
      if (browseSeqRef.current !== seq) {
        return;
      }
      setBrowseError(getErrorMessage(error, "Unable to open that directory."));
    }
  }, [setRootDraft]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    setCdDraft("");
    setBrowseError("");
    setAgentCounts(fallbackRole ? { [fallbackRole]: 1 } : {});
    void browseTo(rootDraft || defaultWorkingDirectory || "");
    // Reset only when the panel opens; rootDraft changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => {
    if (!visible || !rootDraft) {
      return;
    }
    if (browseRef.current?.workingDirectory === rootDraft) {
      return;
    }
    void browseTo(rootDraft);
  }, [browseTo, rootDraft, visible]);

  const submitCd = useCallback(() => {
    const raw = cdDraft.trim();
    if (!raw) {
      return;
    }
    const command = raw.replace(/^cd\s+/i, "").trim() || "~";
    const currentDirectory = browseRef.current?.workingDirectory
      || rootDraft
      || defaultWorkingDirectory
      || "";
    const isAbsolute = command === "~"
      || command.startsWith("~/")
      || command.startsWith("/")
      || /^[A-Za-z]:[\\/]/.test(command);
    const target = isAbsolute ? command : `${currentDirectory}/${command}`;
    setCdDraft("");
    void browseTo(target);
  }, [browseTo, cdDraft, defaultWorkingDirectory, rootDraft]);

  const adjustAgentCount = useCallback((roleId, delta) => {
    setAgentCounts((current) => {
      const totalOther = roleOptions.reduce((sum, option) => (
        option.id === roleId ? sum : sum + Math.max(0, Number(current[option.id]) || 0)
      ), 0);
      const currentValue = Math.max(0, Number(current[roleId]) || 0);
      const maxForRole = Math.min(
        WORKSPACE_CREATE_AGENT_ROLE_CAP,
        MAX_WORKSPACE_TERMINAL_COUNT - totalOther,
      );
      const nextValue = Math.max(0, Math.min(maxForRole, currentValue + delta));
      if (nextValue === currentValue) {
        return current;
      }
      return { ...current, [roleId]: nextValue };
    });
  }, [roleOptions]);

  const terminalRoles = useMemo(
    () => expandWorkspaceCreateAgentCounts(roleOptions, agentCounts),
    [agentCounts, roleOptions],
  );
  const installedAgentById = useMemo(() => {
    const byId = new Map();
    (Array.isArray(agentStatuses) ? agentStatuses : []).forEach((agent) => {
      if (agent?.id) {
        byId.set(agent.id, agent);
      }
    });
    return byId;
  }, [agentStatuses]);
  const roleLabelById = useMemo(() => {
    const byId = new Map();
    roleOptions.forEach((option) => byId.set(option.id, option));
    return byId;
  }, [roleOptions]);

  const currentDirectory = browse?.workingDirectory || rootDraft || defaultWorkingDirectory || "";
  const rootEligible = browse ? browse.rootEligible !== false : true;
  const canCreate = Boolean(
    !creating
      && workspaceName.trim()
      && currentDirectory
      && rootEligible
      && terminalRoles.length > 0,
  );

  return (
    <WorkspaceCreateSurface>
      <WorkspaceCreateCard
        aria-busy={creating}
        aria-label="Create workspace"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canCreate) {
            return;
          }
          onSubmit(event, terminalRoles);
        }}
      >
        <WorkspaceCreateHeader>
          <div>
            <PanelKicker>{onClose ? "New workspace" : "First workspace"}</PanelKicker>
            <PanelHeading>Create workspace</PanelHeading>
          </div>
          {onClose && (
            <WorkspaceModalCloseButton
              aria-label="Close create workspace"
              disabled={creating}
              onClick={onClose}
              title="Close"
              type="button"
            >
              <ButtonCloseIcon aria-hidden="true" />
            </WorkspaceModalCloseButton>
          )}
        </WorkspaceCreateHeader>

        <WorkspaceCreateSection>
          <SettingsLabel>Name</SettingsLabel>
          <WorkspaceSettingsInput
            autoFocus
            disabled={creating}
            maxLength={80}
            onChange={(event) => setWorkspaceName(event.target.value)}
            placeholder="My workspace"
            value={workspaceName}
          />
        </WorkspaceCreateSection>

        <WorkspaceCreateSection>
          <SettingsLabel>Project root</SettingsLabel>
          <WorkspaceCreatePathBar>
            <WorkspaceCreatePathText title={currentDirectory}>
              {currentDirectory || "Choose a directory"}
            </WorkspaceCreatePathText>
            {browse?.gitRepository && (
              <WorkspaceCreatePathBadge $tone="good">git</WorkspaceCreatePathBadge>
            )}
            {browse && !rootEligible && (
              <WorkspaceCreatePathBadge $tone="warn">not usable</WorkspaceCreatePathBadge>
            )}
            {browse?.emptyDirectory && rootEligible && (
              <WorkspaceCreatePathBadge>empty</WorkspaceCreatePathBadge>
            )}
          </WorkspaceCreatePathBar>
          <WorkspaceCreateCdForm>
            <WorkspaceCreateCdPrompt aria-hidden="true">cd</WorkspaceCreateCdPrompt>
            <WorkspaceCreateCdInput
              aria-label="Change directory"
              disabled={creating}
              maxLength={MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH}
              onChange={(event) => setCdDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitCd();
                }
              }}
              placeholder="../sibling, ~/projects/app, or a subfolder below"
              spellCheck={false}
              value={cdDraft}
            />
          </WorkspaceCreateCdForm>
          <WorkspaceCreateDirGrid aria-label="Subdirectories">
            {browse?.parentDirectory && (
              <WorkspaceCreateDirChip
                data-up="true"
                disabled={creating}
                onClick={() => browseTo(browse.parentDirectory)}
                title={browse.parentDirectory}
                type="button"
              >
                <span>..</span>
              </WorkspaceCreateDirChip>
            )}
            {(browse?.directories || []).map((name) => (
              <WorkspaceCreateDirChip
                disabled={creating}
                key={name}
                onClick={() => browseTo(`${currentDirectory}/${name}`)}
                title={name}
                type="button"
              >
                <FileFolderTreeIcon aria-hidden="true" />
                <span>{name}</span>
              </WorkspaceCreateDirChip>
            ))}
            {browse && !browse.directories?.length && !browse.parentDirectory && (
              <SettingsHint>No subfolders here.</SettingsHint>
            )}
          </WorkspaceCreateDirGrid>
          {browse?.truncated && (
            <SettingsHint>Showing the first 200 folders; use cd to go deeper.</SettingsHint>
          )}
          {browse && !rootEligible && (
            <FormMessage $state="error">
              {browse.rootRejectionReason || "This directory cannot be a workspace root. Pick a project folder inside it."}
            </FormMessage>
          )}
          {browseError && <FormMessage $state="error">{browseError}</FormMessage>}
          <WorkspaceCreateFooter>
            <SecondaryButton disabled={creating} onClick={chooseNativeDirectory} type="button">
              <ButtonFolderIcon aria-hidden="true" />
              <span>Browse...</span>
            </SecondaryButton>
            <SecondaryButton
              disabled={!defaultWorkingDirectory || creating}
              onClick={() => browseTo(defaultWorkingDirectory)}
              type="button"
            >
              <ButtonFolderIcon aria-hidden="true" />
              <span>App directory</span>
            </SecondaryButton>
          </WorkspaceCreateFooter>
        </WorkspaceCreateSection>

        <WorkspaceCreateSection>
          <SettingsLabel>Coding agents</SettingsLabel>
          <SettingsHint>
            Pick how many of each agent open with this workspace. Drag the
            counts up for parallel agents of the same kind.
          </SettingsHint>
          <WorkspaceCreateAgentGrid>
            {roleOptions.map((option) => {
              const count = Math.max(0, Number(agentCounts[option.id]) || 0);
              const agent = installedAgentById.get(option.id);
              const unavailable = option.id !== WORKSPACE_TERMINAL_ROLE_GENERIC
                && agent
                && !agent.installed;
              return (
                <WorkspaceCreateAgentCard
                  $active={count > 0}
                  data-unavailable={unavailable ? "true" : undefined}
                  key={option.id}
                >
                  <WorkspaceCreateAgentLabel>
                    <strong>{option.label}</strong>
                    <span>
                      {option.id === WORKSPACE_TERMINAL_ROLE_GENERIC
                        ? "shell"
                        : agent?.installed
                          ? agent?.authenticated ? "ready" : "installed"
                          : "agent"}
                    </span>
                  </WorkspaceCreateAgentLabel>
                  <WorkspaceCreateAgentStepper>
                    <WorkspaceCreateAgentStepButton
                      aria-label={`Remove one ${option.label} terminal`}
                      disabled={creating || count === 0}
                      onClick={() => adjustAgentCount(option.id, -1)}
                      type="button"
                    >
                      -
                    </WorkspaceCreateAgentStepButton>
                    <strong>{count}</strong>
                    <WorkspaceCreateAgentStepButton
                      aria-label={`Add one ${option.label} terminal`}
                      disabled={creating}
                      onClick={() => adjustAgentCount(option.id, 1)}
                      type="button"
                    >
                      +
                    </WorkspaceCreateAgentStepButton>
                  </WorkspaceCreateAgentStepper>
                </WorkspaceCreateAgentCard>
              );
            })}
          </WorkspaceCreateAgentGrid>
          <WorkspaceCreatePreviewRow aria-label="Terminals that will open">
            {terminalRoles.length ? (
              terminalRoles.map((roleId, index) => (
                <WorkspaceCreatePreviewDot
                  $color={TERMINAL_AGENT_COLOR_HEX_BY_SLOT[index % TERMINAL_AGENT_COLOR_HEX_BY_SLOT.length]}
                  key={`${roleId}-${index}`}
                >
                  {roleLabelById.get(roleId)?.shortLabel || roleId}
                </WorkspaceCreatePreviewDot>
              ))
            ) : (
              <SettingsHint>Add at least one terminal to open with the workspace.</SettingsHint>
            )}
          </WorkspaceCreatePreviewRow>
        </WorkspaceCreateSection>

        {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}

        <WorkspaceCreateFooter>
          <SettingsHint>
            {terminalRoles.length} terminal{terminalRoles.length === 1 ? "" : "s"} will open in {getDirectoryName(currentDirectory) || "the chosen folder"}.
          </SettingsHint>
          <PrimaryButton disabled={!canCreate} type="submit">
            <ButtonAddIcon aria-hidden="true" />
            <span>{creating ? "Creating..." : "Create workspace"}</span>
          </PrimaryButton>
        </WorkspaceCreateFooter>
      </WorkspaceCreateCard>
    </WorkspaceCreateSurface>
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

async function desktopLoginUrlWithDevice(state) {
  const url = new URL(WEB_LOGIN_URL);
  url.searchParams.set("state", state);
  try {
    const profile = await invoke("cloud_mcp_get_desktop_device_profile");
    const deviceId = safeCloudMcpText(profile?.device_id || profile?.deviceId, "");
    if (deviceId) url.searchParams.set("desktopDeviceId", deviceId);
    const deviceName = safeCloudMcpText(profile?.device_name || profile?.deviceName || profile?.machine_name || profile?.machineName, "");
    if (deviceName) url.searchParams.set("desktopDeviceName", deviceName);
    const platform = safeCloudMcpText(profile?.platform || profile?.os, "");
    if (platform) url.searchParams.set("desktopPlatform", platform);
    const formFactor = safeCloudMcpText(profile?.form_factor || profile?.formFactor || profile?.device_type || profile?.deviceType, "");
    if (formFactor) url.searchParams.set("desktopFormFactor", formFactor);
  } catch {
    // Desktop login can continue without the optional web-presence handoff.
  }
  return url.toString();
}

function isPaidUser(sessionUser) {
  return sessionUser?.planStatus === "paid";
}

function accountScopeOptionsFromUser(sessionUser) {
  const scopes = Array.isArray(sessionUser?.accountScopes)
    ? sessionUser.accountScopes
    : Array.isArray(sessionUser?.scopes)
      ? sessionUser.scopes
    : [];
  const normalized = scopes
    .map((scope) => {
      const type = String(scope?.type || scope?.scopeType || "personal").trim().toLowerCase();
      const teamId = String(scope?.teamId || "").trim();

      if (type === "team" && teamId) {
        return {
          id: `team:${teamId}`,
          type: "team",
          label: String(scope?.label || scope?.team?.name || "Team").trim() || "Team",
          teamId,
        };
      }

      return {
        id: "personal",
        type: "personal",
        label: "Personal",
        teamId: null,
      };
    });
  const byId = new Map();

  [
    {
      id: "personal",
      type: "personal",
      label: "Personal",
      teamId: null,
    },
    ...normalized,
  ].forEach((scope) => {
    byId.set(scope.id, scope);
  });

  return Array.from(byId.values());
}

function accountScopeInvokePayload(scope) {
  const type = String(scope?.type || "personal").trim().toLowerCase();
  const teamId = String(scope?.teamId || "").trim();

  if (type === "team" && teamId) {
    return {
      scopeType: "team",
      teamId,
    };
  }

  return {
    scopeType: "personal",
    teamId: null,
  };
}

function accountScopeKey(scope) {
  const payload = accountScopeInvokePayload(scope);
  return payload.scopeType === "team" ? `team:${payload.teamId}` : "personal";
}

function billingPlanNameFromStatus(billingStatus, sessionUser) {
  const paid = isPaidUser(sessionUser) || billingStatus?.planStatus === "paid";
  const rawPlan = String(
    billingStatus?.planName
      || billingStatus?.credits?.planName
      || sessionUser?.planName
      || sessionUser?.plan_name
      || "",
  ).trim().toLowerCase();

  if (!paid && rawPlan !== "free") {
    return "free";
  }
  if (["free", "plus", "pro", "ultra"].includes(rawPlan)) {
    return rawPlan;
  }
  return paid ? "plus" : "free";
}

function billingPlanDeviceLimitFromStatus(billingStatus, sessionUser) {
  const explicitLimit = Number(
    billingStatus?.entitlements?.deviceLimit
      ?? billingStatus?.limits?.deviceLimit
      ?? billingStatus?.user?.entitlements?.deviceLimit
      ?? sessionUser?.deviceLimit
      ?? sessionUser?.device_limit,
  );
  if (Number.isInteger(explicitLimit) && explicitLimit >= 0) {
    return explicitLimit;
  }
  const planName = billingPlanNameFromStatus(billingStatus, sessionUser);
  if (planName === "free") return 0;
  if (planName === "pro") return 7;
  if (planName === "ultra") return 20;
  return 3;
}

function cloudMcpBillingEntitlementPayload(billingStatus, sessionUser) {
  const planName = billingPlanNameFromStatus(billingStatus, sessionUser);
  return {
    planName,
    deviceLimit: billingPlanDeviceLimitFromStatus(billingStatus, sessionUser),
  };
}

function billingPlanLabelFromStatus(billingStatus, sessionUser) {
  const paid = isPaidUser(sessionUser) || billingStatus?.planStatus === "paid";

  if (!paid) {
    return "Free";
  }

  const rawPlan = String(
    billingStatus?.planName
    || billingStatus?.credits?.planName
    || sessionUser?.planName
    || "",
  ).trim().toLowerCase();

  if (rawPlan === "ultra") {
    return "Ultra";
  }

  if (rawPlan === "pro") {
    return "Pro";
  }

  if (rawPlan === "plus") {
    return "Plus";
  }

  return "Paid";
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

function waitMs(delayMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, Math.max(0, Number(delayMs) || 0));
  });
}

function stepStateFor(steps, currentStage, status, index) {
  const currentIndex = Math.max(0, steps.findIndex((step) => step.id === currentStage));
  const normalizedStatus = String(status || "").toLowerCase();

  if (normalizedStatus === "error" && index === currentIndex) {
    return "error";
  }

  if (normalizedStatus === "warn" && index === currentIndex) {
    return "warning";
  }

  if (normalizedStatus === "connected" || normalizedStatus === "complete") {
    return index <= currentIndex ? "complete" : "pending";
  }

  if (index < currentIndex) {
    return "complete";
  }

  return index === currentIndex ? "active" : "pending";
}

function cloudWorkspaceStageRank(stage) {
  return CLOUD_WORKSPACE_STAGE_ORDER[String(stage || "").trim()] ?? 0;
}

function cloudWorkspaceProgressFromRuntimeStatus(status) {
  const globalStatus = String(status?.globalWsStatus || status?.global_ws_status || "").toLowerCase();
  const runtimeStatus = String(status?.status || "").toLowerCase();
  const connected = Boolean(status?.connected && (status?.globalWsConnected || status?.global_ws_connected));
  const statusKey = globalStatus || runtimeStatus;
  const connectedDevices = cloudConnectedDevicesFromRuntimeStatus(status);
  const knownDevices = cloudKnownDevicesFromRuntimeStatus(status);
  const workspaceTodos = cloudWorkspaceTodosFromRuntimeStatus(status);
  const storageUsage = cloudStorageUsageFromRuntimeStatus(status);

  if (connected || statusKey === "connected") {
    return {
      connectedDevices,
      detail: "Your cloud workspace is connected and ready for live work.",
      knownDevices,
      stage: "workspace_socket",
      status: "connected",
      storageUsage,
      title: "Cloud workspace ready",
      workspaceTodos,
    };
  }

  if (statusKey === "authenticating") {
    return {
      connectedDevices,
      detail: "Minting a short-lived Appwrite token for the desktop runtime.",
      knownDevices,
      stage: "cloud_auth",
      status: "active",
      storageUsage,
      title: "Preparing cloud auth",
      workspaceTodos,
    };
  }

  if (statusKey === "resolving_route") {
    return {
      connectedDevices,
      detail: "Finding the personal or team backend assigned to this account.",
      knownDevices,
      stage: "cloud_route",
      status: "active",
      storageUsage,
      title: "Finding your cloud route",
      workspaceTodos,
    };
  }

  if (["connecting", "opening_websocket", "websocket_retrying", "retrying"].includes(statusKey)) {
    return {
      connectedDevices,
      detail: "The backend is reachable; waiting for the workspace process to accept the live connection.",
      knownDevices,
      stage: "cloud_instance",
      status: "active",
      storageUsage,
      title: "Setting up your instance",
      workspaceTodos,
    };
  }

  if (["handshaking", "websocket_handshaking"].includes(statusKey)) {
    return {
      connectedDevices,
      detail: "The websocket is open; waiting for the cloud workspace ready frame.",
      knownDevices,
      stage: "workspace_socket",
      status: "active",
      storageUsage,
      title: "Linking the live workspace",
      workspaceTodos,
    };
  }

  if (["device_limit_reached", "device_limit_exceeded"].includes(statusKey)) {
    return {
      connectedDevices,
      detail: String(
        status?.globalWsLastError
          || status?.global_ws_last_error
          || status?.lastError
          || status?.last_error
          || "Open the Diff Forge dashboard and remove a registered device, then reconnect this desktop.",
      ),
      knownDevices,
      stage: "workspace_socket",
      status: "error",
      storageUsage,
      title: "Device limit reached",
      workspaceTodos,
    };
  }

  if (["blocked", "auth_missing", "websocket_auth_missing"].includes(statusKey)) {
    return {
      connectedDevices,
      detail: "The live workspace connection is being re-established.",
      knownDevices,
      stage: "workspace_socket",
      status: "active",
      storageUsage,
      title: "Linking the live workspace",
      workspaceTodos,
    };
  }

  return {
    connectedDevices,
    detail: "Requesting the assigned cloud workspace and waiting for it to become ready.",
    knownDevices,
    stage: "cloud_route",
    status: "active",
    storageUsage,
    title: "Preparing your cloud workspace",
    workspaceTodos,
  };
}

function normalizeCloudWorkspaceProgress(progress, previous = CLOUD_WORKSPACE_PROGRESS_INITIAL_STATE) {
  const nextStage = String(progress?.stage || previous.stage || "idle");
  const nextStatus = String(progress?.status || previous.status || "idle");
  const previousStatus = String(previous?.status || "idle").toLowerCase();
  const previousRank = cloudWorkspaceStageRank(previous?.stage);
  const nextRank = cloudWorkspaceStageRank(nextStage);
  const connectedDevices = Array.isArray(progress?.connectedDevices)
    ? progress.connectedDevices
    : Array.isArray(previous?.connectedDevices)
      ? previous.connectedDevices
      : [];
  const knownDevices = Array.isArray(progress?.knownDevices)
    ? progress.knownDevices
    : Array.isArray(previous?.knownDevices)
      ? previous.knownDevices
      : connectedDevices;
  const workspaceTodos = progress?.workspaceTodos && typeof progress.workspaceTodos === "object"
    ? progress.workspaceTodos
    : previous?.workspaceTodos && typeof previous.workspaceTodos === "object"
      ? previous.workspaceTodos
      : null;
  const storageUsage = progress?.storageUsage && typeof progress.storageUsage === "object"
    ? progress.storageUsage
    : previous?.storageUsage && typeof previous.storageUsage === "object"
      ? previous.storageUsage
      : null;

  if (previousStatus === "connected" && nextStatus !== "error") {
    return {
      ...previous,
      connectedDevices,
      knownDevices,
      storageUsage,
      updatedAt: Date.now(),
      workspaceTodos,
    };
  }

  if (!["connected", "error"].includes(nextStatus) && nextRank < previousRank) {
    return {
      ...previous,
      attempt: Math.max(
        Number(progress?.attempt ?? 0) || 0,
        Number(previous?.attempt ?? 0) || 0,
      ),
      connectedDevices,
      knownDevices,
      storageUsage,
      updatedAt: Date.now(),
      workspaceTodos,
    };
  }

  return {
    attempt: Number(progress?.attempt ?? previous.attempt ?? 0) || 0,
    connectedDevices,
    detail: String(progress?.detail || previous.detail || ""),
    knownDevices,
    stage: nextStage,
    status: nextStatus,
    storageUsage,
    title: String(progress?.title || previous.title || "Cloud workspace"),
    updatedAt: Date.now(),
    workspaceTodos,
  };
}

function isCloudWorkspaceProgressReady(progress) {
  return String(progress?.status || "").toLowerCase() === "connected";
}

const CLOUD_SYNC_BLOCKED_STATUSES = [
  "device_limit_reached",
  "device_limit_exceeded",
  "blocked",
  "websocket_auth_missing",
];

function cloudSyncStatusFromRuntimeStatus(status) {
  if (!status || typeof status !== "object") {
    return null;
  }
  const connected = Boolean(
    status.connected && (status.globalWsConnected ?? status.global_ws_connected),
  );
  const rawStatus = String(status.status || "").toLowerCase();
  const pendingCount = Number(status.outboxPendingCount ?? status.outbox_pending_count ?? 0) || 0;
  return {
    connection: connected
      ? "connected"
      : CLOUD_SYNC_BLOCKED_STATUSES.includes(rawStatus)
        ? "blocked"
        : "connecting",
    pendingCount,
    syncing: connected && pendingCount > 0,
    updatedAtMs: Date.now(),
  };
}

function normalizeCloudSyncStatusEvent(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const connection = String(payload.connection || "connecting");
  const pendingCount = Number(payload.pendingCount ?? payload.pending_count ?? 0) || 0;
  return {
    connection,
    pendingCount,
    syncing: Boolean(payload.syncing),
    updatedAtMs: Number(payload.updatedAtMs ?? payload.updated_at_ms) || Date.now(),
  };
}

function cloudWorkspaceLaunchState(progress) {
  const status = String(progress?.status || "").toLowerCase();

  if (status === "connected") {
    return "ready";
  }

  if (status === "error" || status === "warn") {
    return "warning";
  }

  return "checking";
}

function startCloudWorkspaceStatusPolling(onProgress) {
  if (typeof onProgress !== "function" || typeof window === "undefined") {
    return () => {};
  }

  let stopped = false;
  let timerId = null;
  const poll = async () => {
    try {
      const status = await invoke("cloud_mcp_get_status");
      if (!stopped) {
        onProgress(cloudWorkspaceProgressFromRuntimeStatus(status));
      }
    } catch {
      // The connect command is authoritative; polling only improves UI copy.
    }

    if (!stopped) {
      timerId = window.setTimeout(poll, CLOUD_WORKSPACE_STATUS_POLL_MS);
    }
  };

  void poll();

  return () => {
    stopped = true;
    if (timerId != null) {
      window.clearTimeout(timerId);
    }
  };
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
  const workspaceId = String(payload?.workspaceId || payload?.workspace_id || "").trim();

  return {
    closed: Math.min(closed, total || closed),
    total,
    workspaceId,
  };
}

function normalizeShutdownProgress(payload) {
  const rawPhase = String(payload?.phase || "").trim();
  const fallbackStep = WORKSPACE_SHUTDOWN_STEP_BY_ID.get(rawPhase)
    || WORKSPACE_SHUTDOWN_STEPS[0];
  const rawStep = Number(payload?.step);
  const rawTotalSteps = Number(payload?.totalSteps);

  return {
    closed: normalizeCloseCount(payload?.terminalClosed),
    detail: String(payload?.detail || fallbackStep?.detail || "").trim(),
    label: String(payload?.label || fallbackStep?.label || "Closing workspace").trim(),
    phase: fallbackStep?.id || rawPhase || "closing_webviews",
    step: Number.isFinite(rawStep) && rawStep > 0
      ? Math.floor(rawStep)
      : (fallbackStep?.index ?? 0) + 1,
    terminalTotalKnown: payload?.terminalTotal !== undefined && payload?.terminalTotal !== null,
    total: normalizeCloseCount(payload?.terminalTotal),
    totalSteps: Number.isFinite(rawTotalSteps) && rawTotalSteps > 0
      ? Math.floor(rawTotalSteps)
      : WORKSPACE_SHUTDOWN_STEPS.length,
  };
}

function cleanAppCloseText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeAppCloseTerminalIndex(value) {
  const terminalIndex = Number.parseInt(value, 10);
  return Number.isInteger(terminalIndex) && terminalIndex >= 0 ? terminalIndex : null;
}

function normalizeAppCloseLiveTask(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const taskId = cleanAppCloseText(value.taskId || value.task_id);
  const title = cleanAppCloseText(value.title, taskId || "Active task");
  return taskId || title ? { taskId, title } : null;
}

function normalizeAppCloseParkedPrompt(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const taskId = cleanAppCloseText(value.taskId || value.task_id);
  const title = cleanAppCloseText(value.title, taskId || "Waiting for input");
  return {
    instanceId: normalizeCloseCount(value.instanceId || value.instance_id),
    paneId: cleanAppCloseText(value.paneId || value.pane_id),
    promptPreview: cleanAppCloseText(value.promptPreview || value.prompt_preview),
    resumeClaimed: value.resumeClaimed === true || value.resume_claimed === true,
    taskId,
    title,
    waitingOn: Array.isArray(value.waitingOn || value.waiting_on)
      ? (value.waitingOn || value.waiting_on)
      : [],
  };
}

function normalizeTerminalLiveSessionsPayload(payload) {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
  return {
    generatedAtMs: normalizeCloseCount(data?.generatedAtMs || data?.generated_at_ms),
    parkedPrompts: Array.isArray(data?.parkedPrompts || data?.parked_prompts)
      ? (data.parkedPrompts || data.parked_prompts).map(normalizeAppCloseParkedPrompt).filter(Boolean)
      : [],
    sessions: sessions
      .map((session) => {
        if (!session || typeof session !== "object") {
          return null;
        }
        const paneId = cleanAppCloseText(session.paneId || session.pane_id);
        const instanceId = normalizeCloseCount(session.instanceId || session.instance_id);
        if (!paneId || !instanceId) {
          return null;
        }
        const coordination = session.coordination && typeof session.coordination === "object"
          ? {
              agentId: cleanAppCloseText(session.coordination.agentId || session.coordination.agent_id),
              agentKind: cleanAppCloseText(session.coordination.agentKind || session.coordination.agent_kind),
              repoPath: cleanAppCloseText(session.coordination.repoPath || session.coordination.repo_path),
              sessionId: cleanAppCloseText(session.coordination.sessionId || session.coordination.session_id),
              terminalLaunchEpoch: cleanAppCloseText(
                session.coordination.terminalLaunchEpoch || session.coordination.terminal_launch_epoch,
              ),
            }
          : null;
        const activeTask = normalizeAppCloseLiveTask(session.activeTask || session.active_task);
        const parkedPrompt = normalizeAppCloseParkedPrompt(session.parkedPrompt || session.parked_prompt);
        return {
          activeTask,
          agentId: cleanAppCloseText(session.agentId || session.agent_id),
          agentKind: cleanAppCloseText(session.agentKind || session.agent_kind),
          coordination,
          fileAuthority: cleanAppCloseText(session.fileAuthority || session.file_authority),
          hasActiveTask: session.hasActiveTask === true || session.has_active_task === true || Boolean(activeTask),
          instanceId,
          paneId,
          parked: session.parked === true || Boolean(parkedPrompt),
          parkedPrompt,
          sessionMode: cleanAppCloseText(session.sessionMode || session.session_mode),
          terminalIndex: normalizeAppCloseTerminalIndex(session.terminalIndex ?? session.terminal_index),
          threadId: cleanAppCloseText(session.threadId || session.thread_id),
          workingDirectory: cleanAppCloseText(session.workingDirectory || session.working_directory),
          workspaceId: cleanAppCloseText(session.workspaceId || session.workspace_id),
          workspaceName: cleanAppCloseText(session.workspaceName || session.workspace_name),
        };
      })
      .filter(Boolean),
  };
}

function appCloseTerminalRiskLabel(risk) {
  if (risk === "working") return "Working";
  if (risk === "needs_input") return "Needs input";
  if (risk === "error") return "Error";
  return "Idle";
}

async function closeWorkspaceWindowAfterTerminalShutdown() {
  await withTimeout(
    invoke("close_app_after_terminal_shutdown"),
    WORKSPACE_CLOSE_NATIVE_EXIT_TIMEOUT_MS,
    "Native app exit timed out.",
  );
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
  const providerId = String(value || "").trim().toLowerCase();
  if (providerId === "claude-code" || providerId === "claude_code") {
    return "claude";
  }
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

function getWorkspaceRootIdentity(value) {
  const cleaned = cleanWorkspaceRootDirectory(value).replace(/\\/g, "/");

  if (!cleaned) {
    return "";
  }

  const withoutTrailingSlash = cleaned === "/"
    ? cleaned
    : cleaned.replace(/\/+$/g, "");

  return withoutTrailingSlash.toLowerCase();
}

function normalizeWorkspaceCoordinationTarget(value, fallbackRoot = "") {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const repoPath = cleanWorkspaceRootDirectory(
    source.repoPath || source.repo_path || fallbackRoot,
  );
  if (!repoPath) {
    return null;
  }

  return {
    repoPath,
    dbPath: cleanWorkspaceRootDirectory(source.dbPath || source.db_path),
    mountId: String(source.mountId || source.mount_id || "").trim(),
    projectName: String(source.projectName || source.project_name || "").trim(),
    projectKind: String(source.projectKind || source.project_kind || "").trim(),
    workspaceRelativePath: String(
      source.workspaceRelativePath || source.workspace_relative_path || "",
    ).trim(),
    isWorkspaceRoot: Boolean(source.isWorkspaceRoot || source.is_workspace_root),
    hasGit: Boolean(source.hasGit || source.has_git),
    hasAgents: Boolean(source.hasAgents || source.has_agents),
    hasKernelDb: Boolean(source.hasKernelDb || source.has_kernel_db),
  };
}

function normalizeWorkspaceCoordinationTargetResponse(response, fallbackRoot = "") {
  const data = unwrapCloudCommandData(response, {});
  const rootDirectory = cleanWorkspaceRootDirectory(
    data.repoPath || data.repo_path || fallbackRoot,
  );
  const targets = (Array.isArray(data.targets) ? data.targets : [])
    .map((target) => normalizeWorkspaceCoordinationTarget(target))
    .filter(Boolean);

  if (!targets.length && rootDirectory) {
    targets.push(normalizeWorkspaceCoordinationTarget({
      repoPath: rootDirectory,
      isWorkspaceRoot: true,
      projectKind: "workspace_root",
    }));
  }

  return {
    container: Boolean(data.container),
    rootDirectory,
    targets,
    workspaceKind: String(data.workspaceKind || data.workspace_kind || "").trim(),
  };
}

function workspaceCoordinationTargetFromScanEntry(value, fallbackRoot = "") {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const repoPath = cleanWorkspaceRootDirectory(
    source.repoPath
      || source.repo_path
      || source.projectRoot
      || source.project_root
      || source.rootDirectory
      || source.root_directory
      || source.path
      || fallbackRoot,
  );
  if (!repoPath) {
    return null;
  }

  const projectKind = String(
    source.projectKind
      || source.project_kind
      || source.kind
      || (
        source.hasGit === true || source.has_git === true
          ? "git_repo"
          : getWorkspaceRootIdentity(repoPath) === getWorkspaceRootIdentity(fallbackRoot)
            ? "workspace_root"
            : "project_folder"
      ),
  ).trim();

  return normalizeWorkspaceCoordinationTarget({
    dbPath: source.dbPath || source.db_path,
    hasAgents: source.hasAgents || source.has_agents,
    hasGit: source.hasGit || source.has_git || projectKind === "git_repo",
    hasKernelDb: source.hasKernelDb || source.has_kernel_db,
    isWorkspaceRoot: source.isWorkspaceRoot
      || source.is_workspace_root
      || getWorkspaceRootIdentity(repoPath) === getWorkspaceRootIdentity(fallbackRoot),
    mountId: source.mountId || source.mount_id,
    projectKind,
    projectName: source.projectName
      || source.project_name
      || source.name
      || getDirectoryName(repoPath),
    repoPath,
    workspaceRelativePath: source.workspaceRelativePath
      || source.workspace_relative_path
      || source.relativePath
      || source.relative_path,
  }, fallbackRoot);
}

function workspaceCoordinationTargetResponseFromScanSnapshot(snapshot, fallbackRoot = "") {
  const body = snapshot && typeof snapshot === "object" ? snapshot : {};
  const raw = body.raw && typeof body.raw === "object" ? body.raw : {};
  const rootDirectory = cleanWorkspaceRootDirectory(
    body.root
      || body.rootDirectory
      || body.root_directory
      || body.requestedRepoPath
      || body.requested_repo_path
      || raw.root
      || raw.rootDirectory
      || raw.root_directory
      || raw.requestedRepoPath
      || raw.requested_repo_path
      || fallbackRoot,
  );
  if (!rootDirectory) {
    return null;
  }

  const candidateLists = [
    body.workspaceMounts,
    body.workspace_mounts,
    body.projectMounts,
    body.project_mounts,
    body.repositories,
    body.mounts,
    raw.workspaceMounts,
    raw.workspace_mounts,
    raw.projectMounts,
    raw.project_mounts,
    raw.repositories,
    raw.mounts,
  ].filter(Array.isArray);

  const targets = dedupeWorkspaceCoordinationTargets(candidateLists.flatMap((list) => (
    list.map((entry) => workspaceCoordinationTargetFromScanEntry(entry, rootDirectory))
  )));
  const rootTarget = workspaceCoordinationTargetFromScanEntry(
    body.selectedRoot || body.selected_root || raw.selectedRoot || raw.selected_root || {
      isWorkspaceRoot: true,
      projectKind: "workspace_root",
      projectName: getDirectoryName(rootDirectory),
      repoPath: rootDirectory,
    },
    rootDirectory,
  );
  const completeTargets = dedupeWorkspaceCoordinationTargets([
    rootTarget,
    ...targets,
  ]);

  return {
    container: Boolean(body.container || raw.container),
    rootDirectory,
    targets: completeTargets,
    workspaceKind: String(
      body.workspaceKind
        || body.workspace_kind
        || raw.workspaceKind
        || raw.workspace_kind
        || "",
    ).trim(),
  };
}

function getWorkspaceCoordinationTargetsForRoot(targetsByRoot, rootDirectory) {
  const safeRoot = cleanWorkspaceRootDirectory(rootDirectory);
  if (!safeRoot) {
    return [];
  }

  const record = targetsByRoot?.[getWorkspaceRootIdentity(safeRoot)];
  if (record?.targets?.length) {
    return record.targets;
  }

  return [
    normalizeWorkspaceCoordinationTarget({
      repoPath: safeRoot,
      isWorkspaceRoot: true,
      projectKind: "workspace_root",
    }),
  ].filter(Boolean);
}

function workspaceCoordinationTargetRepoLabel(target) {
  const relativePath = String(target?.workspaceRelativePath || "").trim();
  const projectName = String(target?.projectName || "").trim();
  const repoPath = cleanWorkspaceRootDirectory(target?.repoPath || "");
  return relativePath || projectName || getDirectoryName(repoPath) || repoPath || "Repository";
}

function workspaceCoordinationTargetIsGitRepo(target) {
  return Boolean(target?.hasGit || target?.projectKind === "git_repo");
}

function dedupeWorkspaceCoordinationTargets(targets) {
  const seen = new Set();
  return (Array.isArray(targets) ? targets : [])
    .map((target) => normalizeWorkspaceCoordinationTarget(target))
    .filter(Boolean)
    .filter((target) => {
      const key = getWorkspaceRootIdentity(target.repoPath);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function normalizeWorkspaceCoordinationTargetsCacheRecord(value, fallbackRoot = "") {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const rootDirectory = cleanWorkspaceRootDirectory(
    source.rootDirectory
      || source.root_directory
      || source.repoPath
      || source.repo_path
      || fallbackRoot,
  );
  if (!rootDirectory) {
    return null;
  }

  const targets = dedupeWorkspaceCoordinationTargets(
    Array.isArray(source.targets) ? source.targets : [],
  );
  if (!targets.length) {
    return null;
  }

  return {
    container: Boolean(source.container),
    rootDirectory,
    targets,
    workspaceKind: String(source.workspaceKind || source.workspace_kind || "").trim(),
  };
}

function readWorkspaceCoordinationTargetsCache() {
  const cache = new Map();
  try {
    const rawStorage = window.localStorage.getItem(WORKSPACE_COORDINATION_TARGETS_STORAGE_KEY);
    if (!rawStorage) {
      return cache;
    }

    const parsed = JSON.parse(rawStorage);
    const records = parsed?.records && typeof parsed.records === "object" && !Array.isArray(parsed.records)
      ? parsed.records
      : parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};

    Object.entries(records).forEach(([rootKey, record]) => {
      if (rootKey === "version") {
        return;
      }
      const normalized = normalizeWorkspaceCoordinationTargetsCacheRecord(record);
      const normalizedRootKey = getWorkspaceRootIdentity(normalized?.rootDirectory || "");
      if (normalizedRootKey) {
        cache.set(normalizedRootKey, normalized);
      }
    });
  } catch {
    // Cached scan data is an optimization; workspace-open scans can rebuild it.
  }
  return cache;
}

function persistWorkspaceCoordinationTargetsCache(cache) {
  try {
    const records = {};
    cache.forEach((record) => {
      const normalized = normalizeWorkspaceCoordinationTargetsCacheRecord(record);
      const rootKey = getWorkspaceRootIdentity(normalized?.rootDirectory || "");
      if (!rootKey) {
        return;
      }
      records[rootKey] = {
        container: normalized.container,
        rootDirectory: normalized.rootDirectory,
        savedAtMs: Date.now(),
        targets: normalized.targets,
        workspaceKind: normalized.workspaceKind,
      };
    });
    window.localStorage.setItem(
      WORKSPACE_COORDINATION_TARGETS_STORAGE_KEY,
      JSON.stringify({ version: 1, records }),
    );
  } catch {
    // The app can still discover repositories during workspace open without cache writes.
  }
}

function getCloudSqliteResetCheckpointMessage(data) {
  const backups = Array.isArray(data?.backups) ? data.backups : [];
  const updatedBackupCount = backups.filter((backup) => backup?.ok && !backup?.skipped).length;
  const backgroundCheckpoint = data?.background_checkpoint || data?.backgroundCheckpoint || {};
  if (backgroundCheckpoint?.queued) {
    return "queued cloud checkpoint refresh";
  }
  if (backgroundCheckpoint?.error) {
    return "could not queue cloud checkpoint refresh";
  }
  if (updatedBackupCount > 0) {
    return "refreshed cloud checkpoint";
  }
  return "cloud checkpoint refresh skipped";
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
  const cleaned = cleanWorkspaceRootDirectory(value)
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "");

  return cleaned === "/" || /^[a-z]:$/i.test(cleaned) || /^\/\/[^/]+\/[^/]+$/i.test(cleaned);
}

function normalizeWorkspacePolicyPath(value) {
  return cleanWorkspaceRootDirectory(value)
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function pathMatchesPolicyLiteral(path, literal, includeChildren = false) {
  const normalizedPath = normalizeWorkspacePolicyPath(path);
  const normalizedLiteral = normalizeWorkspacePolicyPath(literal);

  if (!normalizedLiteral) return false;
  if (normalizedPath === normalizedLiteral) return true;
  return includeChildren && normalizedPath.startsWith(`${normalizedLiteral}/`);
}

function isUserCollectionOrProfileRoot(value) {
  const cleaned = normalizeWorkspacePolicyPath(value);
  const parts = cleaned.split("/").filter(Boolean);

  if (cleaned === "/users" || cleaned === "/home") return true;
  if (parts.length === 2 && (parts[0] === "users" || parts[0] === "home")) return true;
  if (parts.length === 2 && /^[a-z]:$/.test(parts[0]) && parts[1] === "users") return true;
  if (parts.length === 3 && /^[a-z]:$/.test(parts[0]) && parts[1] === "users") return true;

  return false;
}

function isBroadUserFolderRoot(value) {
  const cleaned = normalizeWorkspacePolicyPath(value);

  return /^\/(?:users|home)\/[^/]+\/(?:desktop|documents|downloads|pictures|music|movies|videos)$/i
    .test(cleaned)
    || /^[a-z]:\/users\/[^/]+\/(?:desktop|documents|downloads|pictures|music|movies|videos)$/i
      .test(cleaned);
}

function isCloudStorageRoot(value) {
  const cleaned = normalizeWorkspacePolicyPath(value);

  return /^\/(?:users|home)\/[^/]+\/(?:dropbox|google drive|icloud drive|onedrive(?: - [^/]+)?)$/i
    .test(cleaned)
    || /^[a-z]:\/users\/[^/]+\/(?:dropbox|google drive|icloud drive|onedrive(?: - [^/]+)?)$/i
      .test(cleaned);
}

function isUserStateDirectory(value) {
  const cleaned = normalizeWorkspacePolicyPath(value);

  return /^\/(?:users|home)\/[^/]+\/(?:library|\.cache|\.config|\.local(?:\/share)?|\.npm|\.cargo|\.rustup|\.pyenv|\.nvm|\.bun)(?:\/.*)?$/i
    .test(cleaned)
    || /^[a-z]:\/users\/[^/]+\/appdata(?:\/.*)?$/i.test(cleaned);
}

function isSystemOrAppWorkspaceRoot(value) {
  const cleaned = normalizeWorkspacePolicyPath(value);

  if ([
    "/users",
    "/home",
    "/volumes",
    "/media",
    "/mnt",
    "/opt",
    "/srv",
    "/tmp",
    "/var",
    "/var/tmp",
    "/private",
    "/private/tmp",
    "/private/var",
    "/lost+found",
  ].includes(cleaned)) {
    return true;
  }

  return [
    "/applications",
    "/system",
    "/library",
    "/network",
    "/bin",
    "/boot",
    "/dev",
    "/etc",
    "/lib",
    "/lib64",
    "/proc",
    "/root",
    "/run",
    "/sbin",
    "/sys",
    "/usr",
    "c:/windows",
    "c:/program files",
    "c:/program files (x86)",
    "c:/programdata",
  ].some((literal) => pathMatchesPolicyLiteral(cleaned, literal, true))
    || /^[a-z]:\/(?:windows|program files|program files \(x86\)|programdata|system volume information|\$recycle\.bin|recovery|perflogs|windows\.old)(?:\/.*)?$/i
      .test(cleaned);
}

function isDisallowedWorkspaceRootDirectory(value) {
  return isFilesystemRootDirectory(value)
    || isWindowsSystemRootDirectory(value)
    || isSystemOrAppWorkspaceRoot(value)
    || isUserCollectionOrProfileRoot(value)
    || isUserStateDirectory(value)
    || isCloudStorageRoot(value)
    || isBroadUserFolderRoot(value);
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
        const rootWasEmptyAtSelection = Boolean(settings?.rootWasEmptyAtSelection);
        const agentSessionMode = normalizeAgentSessionMode(
          settings?.agentSessionMode,
          Boolean(settings?.gitWorktreesEnabled),
        );
        const gitWorktreesEnabled = agentSessionMode === AGENT_SESSION_MODE_WORKTREE;

        if (
          !workspaceId
          || (
            !rootDirectory
            && terminalCount === MIN_WORKSPACE_TERMINAL_COUNT
            && !hasCustomTerminalRoles
            && agentSessionMode === AGENT_SESSION_MODE_COORDINATED
          )
        ) {
          return null;
        }

        return [
          workspaceId,
          {
            rootDirectory: rootDirectory.slice(0, MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH),
            rootWasEmptyAtSelection: rootDirectory ? rootWasEmptyAtSelection : false,
            agentSessionMode,
            gitWorktreesEnabled,
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
  const normalized = normalizeWorkspaceSettings(settings);
  try {
    window.localStorage.setItem(
      WORKSPACE_SETTINGS_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch {
    // Workspace root settings are convenience state; the app can still run without persistence.
  }
  // Write-through to the Rust app-state store so headless flows (background
  // architecture watcher, remote workspace levers) can read workspace roots
  // and terminal layouts without the webview.
  void invoke("app_local_state_store", {
    key: "workspace-settings",
    value: normalized,
  }).catch(() => {});
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
    const settings = normalizeWorkspaceLifecycleSettings(
      JSON.parse(window.localStorage.getItem(WORKSPACE_LIFECYCLE_STORAGE_KEY) || "{}"),
    );
    return {
      defaultWorkspaceId: settings.defaultWorkspaceId,
      enabledWorkspaceIds: [],
    };
  } catch {
    return { defaultWorkspaceId: "", enabledWorkspaceIds: [] };
  }
}

function persistWorkspaceLifecycleSettings(settings) {
  const normalizedSettings = normalizeWorkspaceLifecycleSettings(settings);
  try {
    window.localStorage.setItem(
      WORKSPACE_LIFECYCLE_STORAGE_KEY,
      JSON.stringify({
        defaultWorkspaceId: normalizedSettings.defaultWorkspaceId,
        enabledWorkspaceIds: [],
      }),
    );
  } catch {
    // Runtime activation is session-only; only the explicit startup default is persisted.
  }
  void invoke("app_local_state_store", {
    key: "workspace-lifecycle",
    value: {
      defaultWorkspaceId: normalizedSettings.defaultWorkspaceId,
      enabledWorkspaceIds: [],
    },
  }).catch(() => {});
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

function mintLocalWorkspaceId() {
  const uuid = (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function")
    ? crypto.randomUUID()
    : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
  return `ws-${uuid}`;
}

function normalizeCatalogWorkspaceEntry(entry) {
  const id = String(entry?.id || entry?.workspace_id || entry?.workspaceId || "").trim();
  if (!id) {
    return null;
  }
  const name = String(entry?.name || entry?.workspace_name || entry?.workspaceName || id).trim() || id;
  const deviceIds = entry?.device_ids || entry?.deviceIds;
  return {
    id,
    name,
    createdAt: String(entry?.createdAt || entry?.created_at || ""),
    updatedAt: String(entry?.updatedAt || entry?.updated_at || ""),
    originDeviceId: String(entry?.originDeviceId || entry?.origin_device_id || entry?.device_id || ""),
    deviceIds: Array.isArray(deviceIds) ? deviceIds.map((value) => String(value)).filter(Boolean) : [],
    deletedAt: String(entry?.deletedAt || entry?.deleted_at || ""),
    pendingDelete: Boolean(entry?.pendingDelete),
    syncState: entry?.syncState === "pending" || entry?.syncState === "error" ? entry.syncState : "synced",
  };
}

// Server-authoritative reconcile: the cloud catalog is the full set of live
// workspaces. Local rows that the cloud acked before but no longer lists were
// deleted from another device; local "pending" rows survive offline creation
// and are re-pushed.
function reconcileWorkspaceCatalog(localItems, cloudItems) {
  const cloudById = new Map();
  cloudItems.forEach((entry) => {
    if (entry?.id) {
      cloudById.set(entry.id, entry);
    }
  });
  const workspaces = [];
  const pendingUpserts = [];
  const pendingDeletes = [];
  const seen = new Set();
  (Array.isArray(localItems) ? localItems : []).forEach((rawLocal) => {
    const local = normalizeCatalogWorkspaceEntry(rawLocal);
    if (!local || seen.has(local.id)) {
      return;
    }
    seen.add(local.id);
    const cloud = cloudById.get(local.id);
    if (local.pendingDelete) {
      pendingDeletes.push(local.id);
      return;
    }
    if (!cloud) {
      if (local.syncState === "pending" || local.syncState === "error") {
        workspaces.push({ ...local, syncState: "pending" });
        pendingUpserts.push(local);
      }
      return;
    }
    cloudById.delete(local.id);
    const localNewer = local.syncState !== "synced"
      && String(local.updatedAt || "") > String(cloud.updatedAt || "");
    if (localNewer) {
      workspaces.push({ ...local, syncState: "pending" });
      pendingUpserts.push(local);
    } else {
      workspaces.push(cloud);
    }
  });
  cloudById.forEach((cloud) => {
    workspaces.push(cloud);
  });
  return { workspaces, pendingUpserts, pendingDeletes };
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
  return snapshot?.raw || {};
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

function workspaceArchitectureRepoKey(repoPath) {
  return normalizeGraphWorkspacePath(repoPath);
}

function workspaceArchitectureRepositoriesFromScan(scan) {
  return Array.isArray(scan?.repositories) ? scan.repositories : [];
}

function workspaceArchitectureRepoPath(repo) {
  return graphText(repo?.path || repo?.projectRoot || repo?.project_root);
}

function workspaceArchitectureGraphListEntry(repoPath, patch = {}) {
  const safeRepoPath = graphText(patch.repoPath || patch.repo_path || repoPath);
  const graphs = Array.isArray(patch.graphs) ? patch.graphs : [];
  return {
    architectureRoot: graphText(patch.architectureRoot || patch.architecture_root),
    error: graphText(patch.error),
    graphs,
    navTree: Array.isArray(patch.navTree) ? patch.navTree : graphs,
    repoPath: safeRepoPath,
    requestedAt: Number(patch.requestedAt || 0),
    state: graphText(patch.state, graphs.length ? "ready" : "idle"),
    updatedAt: Number(patch.updatedAt || 0),
  };
}

function workspaceArchitectureGraphId(graph) {
  return graphText(graph?.id || graph?.architectureId || graph?.architecture_id || graph?.graphId || graph?.graph_id);
}

function workspaceArchitectureCloudSyncSignature(graphs) {
  return JSON.stringify((Array.isArray(graphs) ? graphs : []).map((graph) => [
    workspaceArchitectureGraphId(graph),
    graphText(graph?.updatedAt || graph?.updated_at),
    graphText(graph?.contentHash || graph?.content_hash),
  ]));
}

function workspaceArchitectureGraphFilePath(graph) {
  return graphText(
    graph?.filePath
      || graph?.file_path
      || graph?.path
      || graph?.graphFilePath
      || graph?.graph_file_path,
  );
}

function workspaceArchitectureGraphFileStem(path) {
  return graphText(path)
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/\.[^.]+$/, "")
    || "";
}

function normalizeTerminalArchitectureActivity(payload) {
  if (!payload || typeof payload !== "object") return null;
  const workspaceId = graphText(payload.workspaceId || payload.workspace_id);
  const repoPath = cleanWorkspaceRootDirectory(payload.repoPath || payload.repo_path || payload.cwd);
  const graphFilePath = graphText(
    payload.graphFilePath
      || payload.graph_file_path
      || payload.filePath
      || payload.file_path,
  );
  const graphId = graphText(
    payload.graphId
      || payload.graph_id
      || payload.architectureGraphId
      || payload.architecture_graph_id
      || workspaceArchitectureGraphFileStem(graphFilePath),
  );
  const paneId = graphText(payload.paneId || payload.pane_id);
  const terminalIndex = Number(payload.terminalIndex ?? payload.terminal_index);
  if (!workspaceId && !repoPath) return null;
  return {
    agentId: graphText(payload.agentId || payload.agent_id),
    agentKind: graphText(payload.agentKind || payload.agent_kind),
    graphFilePath,
    graphId,
    graphTitle: graphText(payload.graphTitle || payload.graph_title),
    hookEventName: graphText(payload.hookEventName || payload.hook_event_name),
    instanceId: Number(payload.instanceId ?? payload.instance_id ?? 0) || 0,
    observedAtMs: Number(payload.observedAtMs ?? payload.observed_at_ms ?? Date.now()) || Date.now(),
    paneId,
    phase: graphText(payload.phase, graphFilePath ? "graph_editing" : "context"),
    provider: graphText(payload.provider),
    repoPath,
    source: graphText(payload.source, "terminal-hook"),
    terminalIndex: Number.isInteger(terminalIndex) ? terminalIndex : null,
    threadId: graphText(payload.threadId || payload.thread_id),
    toolName: graphText(payload.toolName || payload.tool_name),
    workspaceId,
    workspaceName: graphText(payload.workspaceName || payload.workspace_name),
  };
}

function workspaceArchitectureGraphMatchesActivity(graph, activity) {
  if (!graph || !activity) return false;
  const graphId = workspaceArchitectureGraphId(graph);
  if (activity.graphId && graphId && activity.graphId === graphId) return true;
  const graphFilePath = normalizeGraphWorkspacePath(workspaceArchitectureGraphFilePath(graph));
  const activityFilePath = normalizeGraphWorkspacePath(activity.graphFilePath);
  if (graphFilePath && activityFilePath && graphFilePath === activityFilePath) return true;
  const graphStem = workspaceArchitectureGraphFileStem(workspaceArchitectureGraphFilePath(graph));
  return Boolean(activity.graphId && graphStem && activity.graphId === graphStem);
}

function workspaceArchitectureGraphUpdatedMs(graph) {
  const raw = graph?.updatedAt || graph?.updated_at || graph?.createdAt || graph?.created_at || 0;
  const number = Number(raw);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function workspaceArchitectureGraphContentHash(graph) {
  return graphText(graph?.contentHash || graph?.content_hash || graph?.hash);
}

function workspaceArchitectureMergeGraphLists(localGraphs, cloudGraphs) {
  const merged = new Map();
  jsonArray(localGraphs).forEach((graph) => {
    const graphId = workspaceArchitectureGraphId(graph);
    if (!graphId) return;
    merged.set(graphId, {
      ...graph,
      id: graphId,
      cloudAvailable: false,
      cloudNeedsHydration: false,
      hydrated: true,
      localAvailable: true,
    });
  });

  jsonArray(cloudGraphs).forEach((cloudGraph) => {
    const graphId = workspaceArchitectureGraphId(cloudGraph);
    if (!graphId) return;
    const existing = merged.get(graphId);
    const cloudHash = workspaceArchitectureGraphContentHash(cloudGraph);
    const localHash = workspaceArchitectureGraphContentHash(existing);
    const cloudUpdatedMs = workspaceArchitectureGraphUpdatedMs(cloudGraph);
    const localUpdatedMs = workspaceArchitectureGraphUpdatedMs(existing);
    const cloudNewer = !existing
      || (cloudUpdatedMs && localUpdatedMs && cloudUpdatedMs > localUpdatedMs)
      || (cloudHash && localHash && cloudHash !== localHash);
    if (!existing) {
      merged.set(graphId, {
        ...cloudGraph,
        id: graphId,
        cloudAvailable: true,
        cloudGraph,
        cloudNeedsHydration: true,
        cloudOnly: true,
        hydrated: false,
        localAvailable: false,
      });
      return;
    }
    merged.set(graphId, {
      ...existing,
      ...(cloudNewer ? {
        title: graphText(cloudGraph.title, existing.title),
        updatedAt: cloudGraph.updatedAt || cloudGraph.updated_at || existing.updatedAt,
        updated_at: cloudGraph.updated_at || cloudGraph.updatedAt || existing.updated_at,
      } : {}),
      cloudAvailable: true,
      cloudContentHash: cloudHash,
      cloudGraph,
      cloudNeedsHydration: cloudNewer,
      cloudUpdatedAt: cloudGraph.updatedAt || cloudGraph.updated_at || "",
      hydrated: !cloudNewer,
      localAvailable: true,
    });
  });

  return Array.from(merged.values()).sort((left, right) => (
    workspaceArchitectureGraphUpdatedMs(right) - workspaceArchitectureGraphUpdatedMs(left)
  ) || graphText(left.title).localeCompare(graphText(right.title)));
}

function workspaceArchitectureScanWithGraphCount(scan, repoPath, graphCount) {
  if (!scan || typeof scan !== "object") return scan;
  const repoKey = workspaceArchitectureRepoKey(repoPath);
  if (!repoKey) return scan;
  const repositories = workspaceArchitectureRepositoriesFromScan(scan);
  if (!repositories.length) return scan;
  let changed = false;
  const nextRepositories = repositories.map((repo) => {
    if (workspaceArchitectureRepoKey(repo?.path || repo?.projectRoot || repo?.project_root) !== repoKey) {
      return repo;
    }
    if (Number(repo?.graphCount ?? repo?.graph_count ?? 0) === graphCount) {
      return repo;
    }
    changed = true;
    return {
      ...repo,
      graphCount,
      graph_count: graphCount,
    };
  });
  return changed ? { ...scan, repositories: nextRepositories } : scan;
}

function workspaceGraphSnapshotKey(snapshot) {
  return workspaceGraphStateKey(
    graphSnapshotRepoPath(snapshot),
    graphSnapshotWorkspaceId(snapshot),
  );
}

function getWorkspaceGraphScanSnapshotForRoot(graphState, repoPath, workspaceId) {
  const key = workspaceGraphStateKey(repoPath, workspaceId);
  if (!key) {
    return null;
  }

  return graphState?.[key]?.architectureRepositoryScanSnapshot || null;
}

function getPreparedWorkspaceTerminalRequestKey(request, launchKey = "") {
  if (!request || typeof request !== "object") {
    return "";
  }

  return [
    String(launchKey || ""),
    String(request.workspaceId || ""),
    String(request.paneId || ""),
    String(request.instanceId || ""),
    String(request.terminalIndex ?? ""),
    String(request.threadId || ""),
  ].join(":");
}

function scheduleWorkspaceStartupIdleTask(callback, options = {}) {
  if (typeof callback !== "function") {
    return () => {};
  }

  if (typeof window === "undefined") {
    callback();
    return () => {};
  }

  const delayMs = Math.max(0, Number(options.delayMs || 0));
  const timeoutMs = Math.max(1, Number(options.timeoutMs || WORKSPACE_APP_STARTUP_IDLE_TIMEOUT_MS));
  let idleId = 0;
  let timeoutId = 0;
  let cancelled = false;

  const run = () => {
    if (cancelled) {
      return;
    }
    callback();
  };

  timeoutId = window.setTimeout(() => {
    timeoutId = 0;
    if (typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(run, { timeout: timeoutMs });
      return;
    }
    run();
  }, delayMs);

  return () => {
    cancelled = true;
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      timeoutId = 0;
    }
    if (idleId && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleId);
      idleId = 0;
    }
  };
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

function getWorkspaceRootWasEmptyAtSelection(workspaceSettings, workspaceId) {
  return Boolean(workspaceSettings?.[workspaceId]?.rootWasEmptyAtSelection);
}

const AGENT_SESSION_MODE_WORKTREE = "worktree_coordination";
const AGENT_SESSION_MODE_COORDINATED = "direct_coordination";
const AGENT_SESSION_MODE_DIRECT = "direct_unmanaged";
const AGENT_SESSION_MODE_OPTIONS = [
  {
    description: "Isolated worktrees + coordination",
    label: "Safe",
    tone: "safe",
    value: AGENT_SESSION_MODE_WORKTREE,
  },
  {
    description: "Direct edits with locking + pause/resume",
    label: "Coordinated",
    tone: "balanced",
    value: AGENT_SESSION_MODE_COORDINATED,
  },
  {
    description: "Direct edits, no safety rails",
    label: "Direct",
    tone: "unsafe",
    value: AGENT_SESSION_MODE_DIRECT,
  },
];

function normalizeAgentSessionMode(value, gitWorktreesEnabled = false) {
  const mode = String(value || "").trim().toLowerCase();
  if (
    mode === AGENT_SESSION_MODE_WORKTREE
    || mode === AGENT_SESSION_MODE_COORDINATED
    || mode === AGENT_SESSION_MODE_DIRECT
  ) {
    return mode;
  }
  return gitWorktreesEnabled ? AGENT_SESSION_MODE_WORKTREE : AGENT_SESSION_MODE_COORDINATED;
}

function getWorkspaceAgentSessionMode(workspaceSettings, workspaceId) {
  const settings = workspaceSettings?.[workspaceId] || {};
  return normalizeAgentSessionMode(settings.agentSessionMode, settings.gitWorktreesEnabled);
}

function getWorkspaceGitWorktreesEnabled(workspaceSettings, workspaceId) {
  return getWorkspaceAgentSessionMode(workspaceSettings, workspaceId) === AGENT_SESSION_MODE_WORKTREE;
}

function workspaceRuntimeActivationKey(workspaceId, repoPath) {
  const safeWorkspaceId = String(workspaceId || "").trim();
  const safeRepoPath = cleanWorkspaceRootDirectory(repoPath);

  return safeWorkspaceId && safeRepoPath ? `${safeWorkspaceId}:${safeRepoPath}` : "";
}

function findWorkspaceByEffectiveRoot(
  workspaces,
  workspaceSettings,
  rootDirectory,
  defaultWorkingDirectory,
  exceptWorkspaceId = "",
) {
  const targetIdentity = getWorkspaceRootIdentity(rootDirectory);

  if (!targetIdentity || !Array.isArray(workspaces)) {
    return null;
  }

  return workspaces.find((workspace) => {
    const workspaceId = String(workspace?.id || "").trim();

    if (!workspaceId || workspaceId === exceptWorkspaceId) {
      return false;
    }

    const candidateRoot = getWorkspaceRootDirectory(workspaceSettings, workspaceId)
      || cleanWorkspaceRootDirectory(defaultWorkingDirectory);

    return getWorkspaceRootIdentity(candidateRoot) === targetIdentity;
  }) || null;
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

function reconcileWorkspaceTerminalSlotIndexes(indexes, count) {
  const terminalCount = normalizeWorkspaceTerminalCount(count);
  const normalizedIndexes = normalizeWorkspaceTerminalSlotIndexes(indexes);
  const usedIndexes = new Set(normalizedIndexes);
  const nextIndexes = normalizedIndexes.slice(0, terminalCount);

  let nextIndex = 0;
  while (nextIndexes.length < terminalCount) {
    if (!usedIndexes.has(nextIndex)) {
      usedIndexes.add(nextIndex);
      nextIndexes.push(nextIndex);
    }
    nextIndex += 1;
  }

  return nextIndexes;
}

function getWorkspaceLogicalTerminalIndexes(workspaceTerminalLogicalIndexes, workspaceId, terminalCount) {
  if (Object.prototype.hasOwnProperty.call(workspaceTerminalLogicalIndexes || {}, workspaceId)) {
    return reconcileWorkspaceTerminalSlotIndexes(workspaceTerminalLogicalIndexes[workspaceId], terminalCount);
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
  const hasRootWasEmptyAtSelection = Object.prototype.hasOwnProperty.call(nextValues, "rootWasEmptyAtSelection");
  const hasGitWorktreesEnabled = Object.prototype.hasOwnProperty.call(nextValues, "gitWorktreesEnabled");
  const hasAgentSessionMode = Object.prototype.hasOwnProperty.call(nextValues, "agentSessionMode");
  const hasTerminalCount = Object.prototype.hasOwnProperty.call(nextValues, "terminalCount");
  const hasTerminalRoles = Object.prototype.hasOwnProperty.call(nextValues, "terminalRoles");
  const cleanedRootDirectory = cleanWorkspaceRootDirectory(
    hasRootDirectory ? nextValues.rootDirectory : currentSettings.rootDirectory,
  ).slice(0, MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH);
  const rootDirectory = isDisallowedWorkspaceRootDirectory(cleanedRootDirectory)
    ? ""
    : cleanedRootDirectory;
  const rootWasEmptyAtSelection = rootDirectory
    ? Boolean(hasRootWasEmptyAtSelection
      ? nextValues.rootWasEmptyAtSelection
      : currentSettings.rootWasEmptyAtSelection)
    : false;
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
  const agentSessionMode = hasAgentSessionMode
    ? normalizeAgentSessionMode(
      nextValues.agentSessionMode,
      Boolean(currentSettings.gitWorktreesEnabled),
    )
    : hasGitWorktreesEnabled
      ? normalizeAgentSessionMode("", Boolean(nextValues.gitWorktreesEnabled))
      : normalizeAgentSessionMode(
        currentSettings.agentSessionMode,
        Boolean(currentSettings.gitWorktreesEnabled),
      );
  const gitWorktreesEnabled = agentSessionMode === AGENT_SESSION_MODE_WORKTREE;

  if (
    !rootDirectory
    && terminalCount === MIN_WORKSPACE_TERMINAL_COUNT
    && !hasCustomTerminalRoles
    && agentSessionMode === AGENT_SESSION_MODE_COORDINATED
  ) {
    delete nextSettings[workspaceId];
    return nextSettings;
  }

  nextSettings[workspaceId] = {
    rootDirectory,
    rootWasEmptyAtSelection,
    agentSessionMode,
    gitWorktreesEnabled,
    terminalCount,
    terminalRoles,
  };

  return nextSettings;
}

export default function App() {
  if (window.location.hash === "#/background-monitor") {
    return <BackgroundMonitorWindow />;
  }

  if (window.location.hash === SNIPPING_OVERLAY_HASH) {
    return <SnippingOverlayWindow />;
  }

  if (window.location.hash.startsWith(SNIPPING_EDITOR_HASH)) {
    return <SnippingAnnotationEditorWindow />;
  }

  if (window.location.hash.startsWith(SNIPPING_FLOAT_HASH)) {
    return <SnippingFloatWindow />;
  }

  if (window.location.hash === SNIPPING_TOAST_HASH) {
    return <SnippingQuickAccess />;
  }

  if (window.location.hash === ACTIVITY_OVERLAY_HASH) {
    return <ActivityOverlayWindow />;
  }

  if (window.location.hash === AUDIO_WIDGET_HASH) {
    return <AudioWidgetWindow />;
  }

  if (window.location.hash.startsWith(TERMINAL_WINDOW_HASH)) {
    return <TerminalWindowHost />;
  }

  const {
    status: authState,
    stage: authStage,
    message: authMessage,
    error: authError,
    user,
    activeScope,
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
  const [workspaceArchitectureTerminalActivity, setWorkspaceArchitectureTerminalActivity] = useState({});
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [workspaceSyncState, setWorkspaceSyncState] = useState("idle");
  const [workspaceListHydrated, setWorkspaceListHydrated] = useState(false);
  const [workspaceHydrationReady, setWorkspaceHydrationReady] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [newWorkspaceRootDraft, setNewWorkspaceRootDraft] = useState("");
  const [workspaceCreateModalOpen, setWorkspaceCreateModalOpen] = useState(false);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [workspaceTerminalCountDraft, setWorkspaceTerminalCountDraft] = useState("1");
  const [workspaceTerminalRolesDraft, setWorkspaceTerminalRolesDraft] = useState(["codex"]);
  const [workspaceAgentSessionModeDraft, setWorkspaceAgentSessionModeDraft] = useState(AGENT_SESSION_MODE_COORDINATED);
  const [workspaceUnsafeModeArmed, setWorkspaceUnsafeModeArmed] = useState(false);
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
  const [workspaceDeleteConfirmId, setWorkspaceDeleteConfirmId] = useState("");
  const [workspaceGitPullPrompt, setWorkspaceGitPullPrompt] = useState(WORKSPACE_GIT_PULL_PROMPT_INITIAL_STATE);
  const [workspaceGitRepositoryPreloads, setWorkspaceGitRepositoryPreloads] = useState({});
  const [workspaceGitSnapshotPreloads, setWorkspaceGitSnapshotPreloads] = useState({});
  const [activatedWorkspaceId, setActivatedWorkspaceId] = useState("");
  const [workspacePendingActivationId, setWorkspacePendingActivationId] = useState("");
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = useState("");
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isLaunchScreenVisible, setLaunchScreenVisible] = useState(true);
  const [workspaceState, setWorkspaceState] = useState("idle");
  const [workspaceAgentLaunchEpoch, setWorkspaceAgentLaunchEpoch] = useState(0);
  const [preparedTerminalVersion, setPreparedTerminalVersion] = useState(0);
  const [workspaceAgentBatchSentKey, setWorkspaceAgentBatchSentKey] = useState("");
  const setWorkspaceAgentBatchSentLaunchKey = useCallback((nextKey) => {
    const safeKey = String(nextKey || "");
    workspaceAgentBatchSentKeyRef.current = safeKey;
    setWorkspaceAgentBatchSentKey(safeKey);
  }, []);
  const [windowFrameState, setWindowFrameState] = useState(WINDOW_FRAME_STATE_DEFAULT);
  const [mainWindowFocused, setMainWindowFocused] = useState(readMainWindowFocusedFallback);
  const [workspaceCloseState, setWorkspaceCloseState] = useState(WORKSPACE_CLOSE_INITIAL_STATE);
  const [appCloseConfirmState, setAppCloseConfirmState] = useState(APP_CLOSE_CONFIRM_INITIAL_STATE);
  const [workspaceDeactivationState, setWorkspaceDeactivationState] = useState(WORKSPACE_DEACTIVATION_INITIAL_STATE);
  const [billingStatus, setBillingStatus] = useState(null);
  const [billingStatusState, setBillingStatusState] = useState("idle");
  const [billingStatusError, setBillingStatusError] = useState("");
  // Auth-flow callbacks read billing through this ref so their identities
  // stay stable: putting billingStatus in their dep arrays re-armed the auth
  // startup effect on every billing refresh, which re-ran session validation
  // and flickered the app between login and dashboard.
  const billingStatusRef = useRef(null);
  billingStatusRef.current = billingStatus;
  const [cloudSqliteResetState, setCloudSqliteResetState] = useState("idle");
  const [cloudSqliteResetMessage, setCloudSqliteResetMessage] = useState("");
  const [cloudSqliteResetError, setCloudSqliteResetError] = useState("");
  const [cloudSqliteResetSelectedWorkspaceId, setCloudSqliteResetSelectedWorkspaceId] = useState("");
  const [cloudSqliteResetSelectedRepoKeys, setCloudSqliteResetSelectedRepoKeys] = useState({});
  const [cloudRepoCatalogState, setCloudRepoCatalogState] = useState("idle");
  const [cloudRepoCatalog, setCloudRepoCatalog] = useState(null);
  const [cloudRepoCatalogError, setCloudRepoCatalogError] = useState("");
  const [cloudRepoCatalogBusyRepoId, setCloudRepoCatalogBusyRepoId] = useState("");
  const [cloudRepoCatalogDismissedIds, setCloudRepoCatalogDismissedIds] = useState({});
  const [tokenomicsCloudResetState, setTokenomicsCloudResetState] = useState("idle");
  const [tokenomicsCloudResetMessage, setTokenomicsCloudResetMessage] = useState("");
  const [tokenomicsCloudResetError, setTokenomicsCloudResetError] = useState("");
  const [cloudAccountResetState, setCloudAccountResetState] = useState("idle");
  const [cloudAccountResetMessage, setCloudAccountResetMessage] = useState("");
  const [cloudAccountResetError, setCloudAccountResetError] = useState("");
  const [cloudWorkspaceProgress, setCloudWorkspaceProgress] = useState(CLOUD_WORKSPACE_PROGRESS_INITIAL_STATE);
  const [dismissedLowCreditWarningKey, setDismissedLowCreditWarningKey] = useState(
    readDismissedLowCreditWarningKey,
  );
  const authStartupFinishedRef = useRef(false);
  const authFlowIdRef = useRef(0);
  const authCallbackInFlightStateRef = useRef("");
  const authCallbackCompletedStateRef = useRef("");
  // True while the app is running on a saved session that could not be
  // re-validated because the API was unreachable (offline grace). Cleared by
  // the quiet re-validation that runs when the cloud connection returns.
  const offlineSessionGraceRef = useRef(false);
  const [cloudSyncStatus, setCloudSyncStatus] = useState(null);
  const cloudSyncConnectionRef = useRef("");
  const launchStartedAtRef = useRef(Date.now());
  const dashboardShellRef = useRef(null);
  const workspaceRailRef = useRef(null);
  const workspaceRailAnimationFrameRef = useRef(0);
  const workspaceGitPullPromptCheckRef = useRef("");
  const workspaceGitPullPromptSkippedRef = useRef(new Set());
  const viewTransitionTimeoutRef = useRef(null);
  const agentStatusCacheHitRef = useRef(agentStatuses.some((agent) => agent.cached));
  const agentInitialStatusUserRef = useRef("");
  const previousAccountScopeKeyRef = useRef("");
  const startupAgentFlowIdRef = useRef(0);
  const startupAgentSettingsPendingRef = useRef(false);
  const audioAutoOpenStartupKeyRef = useRef("");
  const selectedWorkspaceIdRef = useRef("");
  const activatedWorkspaceIdRef = useRef("");
  const workspacePendingActivationIdRef = useRef("");
  const workspaceGraphStateRef = useRef(workspaceGraphState);
  const workspaceArchitectureScanInFlightRef = useRef(new Set());
  const workspaceArchitectureGraphListInFlightRef = useRef(new Set());
  // repoKey -> signature of the last graph list pushed to cloud. Prevents
  // re-pushing identical snapshots on every list refresh, which the server
  // would echo back as wake events and create a refresh/flicker loop.
  const architectureCloudSyncSignatureRef = useRef({});
  const activeViewRef = useRef(activeView);
  const visibleViewRef = useRef(visibleView);
  const mainWindowFocusedRef = useRef(mainWindowFocused);
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
  const workspaceThreadsPersistTimerRef = useRef(0);
  const workspaceThreadsPersistInFlightRef = useRef(false);
  const workspaceThreadsPersistPendingRef = useRef(null);
  const workspaceThreadsLastPersistedRef = useRef({});
  const terminalInputHotUntilRef = useRef(0);
  const workspaceThreadTranscriptRequestsRef = useRef(new Map());
  const workspaceThreadTranscriptWatchKeysRef = useRef(new Set());
  const workspaceThreadAcceptedPromptsRef = useRef(new Map());
  const workspaceThreadDetailVisibilityRequestKeysRef = useRef(new Map());
  const workspaceThreadTranscriptEventHandlerRef = useRef(null);
  const terminalPromptSubmittedHandlerRef = useRef(null);
  const terminalActivityHookHandlerRef = useRef(null);
  const workspacePendingPromptDeliveriesRef = useRef(new Map());
  const workspaceTerminalLogicalIndexesRef = useRef(workspaceTerminalLogicalIndexes);
  const workspaceTerminalDisplayLayoutsRef = useRef(workspaceTerminalDisplayLayouts);
  const workspaceLifecycleSettingsRef = useRef(workspaceLifecycleSettings);
  const workspaceAgentLaunchKeyRef = useRef("");
  const workspaceActivationSequenceRef = useRef(0);
  const workspaceActivationStartedAtRef = useRef(new Map());
  const workspaceActivationStateLogKeyRef = useRef("");
  const workspaceRuntimeSelectionLogKeyRef = useRef("");
  const workspaceRuntimeDescriptorLogKeyRef = useRef("");
  const workspaceRuntimeDescriptorBuildRef = useRef(null);
  const deferredWorkspaceActivationRef = useRef({
    frame: 0,
    idle: 0,
    secondFrame: 0,
    timeout: 0,
    token: 0,
    workspaceId: "",
  });
  const preparedTerminalsRef = useRef(new Map());
  const workspaceAgentBatchInFlightKeyRef = useRef("");
  const workspaceAgentBatchWaitLogKeyRef = useRef("");
  const workspaceAgentBatchSentKeyRef = useRef("");
  const workspaceAgentBatchStartedSessionKeysRef = useRef(new Set());
  const workspaceAgentBatchInFlightSessionKeysRef = useRef(new Set());
  const workspaceCloseInFlightRef = useRef(false);
  const workspaceCloseExpectedTotalRef = useRef(0);
  const appCloseConfirmStateRef = useRef(APP_CLOSE_CONFIRM_INITIAL_STATE);
  const sharedMcpActiveRuntimeTargetsRef = useRef(new Map());
  const sharedMcpBackgroundJobsRef = useRef(new Map());
  const workspaceMcpStartupIndexKeysRef = useRef(new Set());
  const workspaceMcpStartupIndexJobsRef = useRef(new Map());
  const workspaceMcpStartupIndexEmptyKeyRef = useRef("");
  const workspaceDeactivationInFlightRef = useRef("");
  const agentInstallationSyncKeyRef = useRef("");
  const terminalPresenceSyncKeyRef = useRef("");
  const terminalPresenceSyncTimerRef = useRef(0);
  const terminalPresenceSyncInFlightRef = useRef(false);
  const terminalPresenceSyncPendingRef = useRef(null);
  const terminalPresenceWorkspacesRef = useRef([]);
  const terminalStatusEventSeqRef = useRef(new Map());
  const terminalStatusEventDedupRef = useRef(new Map());
  const terminalStatusEventEmitterRef = useRef(null);
  const terminalStatusEventSyncQueueRef = useRef(new Map());
  const terminalStatusEventSyncTimersRef = useRef(new Map());
  const terminalStatusEventSyncInFlightRef = useRef(new Set());
  const remoteCommandReceiptsRef = useRef(new Map());
  const workspaceMcpSyncKeyRef = useRef("");
  const workspaceCatalogSyncKeyRef = useRef("");
  const workspaceCloudSyncKeyRef = useRef("");
  // Workspace ids deleted on this device this session, mapped to the delete
  // timestamp. Catalog broadcasts and list responses must not re-add these
  // unless the cloud entry is newer than the delete (an intentional revive);
  // stale ghosts are filtered out and the tombstone is re-sent to the cloud.
  const tokenomicsSyncCursorRef = useRef("");
  const tokenomicsSyncInFlightRef = useRef(false);
  const tokenomicsSyncPendingRefreshRef = useRef(false);
  const tokenomicsForceResyncRef = useRef(null);
  const cloudMcpStartupWarmupKeyRef = useRef("");
  const workspaceCoordinationTargetsCacheRef = useRef(readWorkspaceCoordinationTargetsCache());
  const workspaceCoordinationTargetsStateKeyRef = useRef("");
  const [workspaceCoordinationTargetsByRoot, setWorkspaceCoordinationTargetsByRoot] = useState({});
  const workspaceTerminalRoleOptions = useMemo(
    () => getWorkspaceTerminalRoleOptions(agentStatuses),
    [agentStatuses],
  );
  const workspaceTerminalFallbackRole = getWorkspaceTerminalFallbackRole(
    workspaceTerminalRoleOptions,
    activeAgent,
  );
  const accountScopes = useMemo(() => accountScopeOptionsFromUser(user), [user]);
  const getTerminalInputHotDelayMs = useCallback((extraMs = TERMINAL_INPUT_HOT_BACKGROUND_GRACE_MS) => {
    const globalHotUntil = typeof window === "undefined"
      ? 0
      : Number(window.__diffforgeTerminalInputHotUntil || 0);
    const hotUntil = Math.max(Number(terminalInputHotUntilRef.current || 0), globalHotUntil);
    return Math.max(0, hotUntil + Math.max(0, Number(extraMs) || 0) - Date.now());
  }, []);

  const workspaceThreadTranscriptHydrationIsVisible = useCallback((event = {}) => {
    const workspaceId = String(event.workspaceId || event.workspace_id || "").trim();
    const threadId = String(event.threadId || event.thread_id || "").trim();
    return Boolean(
      getWorkspaceThreadDetailVisibilityKey({ workspaceId, threadId })
        && workspaceThreadDetailIsVisible({ workspaceId, threadId }),
    );
  }, []);

  useEffect(() => {
    const handleTerminalInputHot = (event) => {
      const detail = event?.detail || {};
      const hotUntil = Math.max(
        Date.now() + TERMINAL_INPUT_HOT_FALLBACK_MS,
        Number(detail.hotUntil || 0),
      );
      terminalInputHotUntilRef.current = Math.max(terminalInputHotUntilRef.current, hotUntil);
      if (typeof window !== "undefined") {
        window.__diffforgeTerminalInputHotUntil = Math.max(
          Number(window.__diffforgeTerminalInputHotUntil || 0),
          hotUntil,
        );
      }
    };
    window.addEventListener(TERMINAL_INPUT_HOT_EVENT, handleTerminalInputHot);
    return () => {
      window.removeEventListener(TERMINAL_INPUT_HOT_EVENT, handleTerminalInputHot);
    };
  }, []);

  const beginWorkspaceActivationTrace = useCallback((workspaceId, source = "manual") => {
    const safeWorkspaceId = String(workspaceId || "").trim();
    if (!safeWorkspaceId) {
      return { activationSeq: 0, activationSource: source, startedAtMs: 0 };
    }

    const activationSeq = workspaceActivationSequenceRef.current + 1;
    const startedAtMs = getWorkspaceActivationDiagnosticNowMs();
    workspaceActivationSequenceRef.current = activationSeq;
    workspaceActivationStartedAtRef.current.set(safeWorkspaceId, {
      activationSeq,
      source,
      startedAtMs,
    });

    return { activationSeq, activationSource: source, startedAtMs };
  }, []);

  const workspaceActivationTraceFields = useCallback((workspaceId, fallback = {}) => {
    const safeWorkspaceId = String(workspaceId || "").trim();
    const trace = safeWorkspaceId
      ? workspaceActivationStartedAtRef.current.get(safeWorkspaceId)
      : null;
    const startedAtMs = Number(trace?.startedAtMs || fallback.startedAtMs || 0);
    const fields = {
      activationSeq: Number(trace?.activationSeq || fallback.activationSeq || 0),
      activationSource: trace?.source || fallback.activationSource || fallback.source || "",
    };

    if (startedAtMs > 0) {
      fields.activationElapsedMs = Math.max(
        0,
        getWorkspaceActivationDiagnosticNowMs() - startedAtMs,
      );
    }

    return fields;
  }, []);

  const logWorkspaceActivationTrace = useCallback((phase, workspaceId, fields = {}, options = {}) => {
    logWorkspaceActivationDiagnosticEvent(phase, {
      ...workspaceActivationTraceFields(workspaceId, options.trace || {}),
      ...fields,
      workspaceId: String(workspaceId || fields.workspaceId || "").trim(),
    }, options);
  }, [workspaceActivationTraceFields]);

  useEffect(() => {
    let disposed = false;
    let unlisten = null;

    const emitWorkspaceMcpRegistryUpdated = (detail) => {
      if (typeof window === "undefined") {
        return;
      }
      window.dispatchEvent(new CustomEvent(WORKSPACE_MCP_REGISTRY_UPDATED_EVENT, {
        detail,
      }));
    };

    listen(WORKSPACE_MCP_BACKGROUND_JOB_EVENT, (event) => {
      if (disposed) {
        return;
      }

      const payload = event?.payload || {};
      const jobType = String(payload.jobType || payload.job_type || "").trim();
      const status = String(payload.status || "").trim();
      const jobKey = String(payload.jobKey || payload.job_key || "").trim();
      const repoPath = String(payload.repoPath || payload.repo_path || "").trim();
      const workspaceId = String(payload.workspaceId || payload.workspace_id || "").trim();
      const workspaceName = String(payload.workspaceName || payload.workspace_name || "").trim();
      const error = payload?.extra?.error || payload?.error || "";

      if (jobType === "workspace_mcp_registry") {
        const job = workspaceMcpStartupIndexJobsRef.current.get(jobKey) || null;
        if (status === "completed") {
          logWorkspaceActivationTrace("workspace.open.workspace_mcp_index.done", workspaceId, {
            elapsedMs: job?.startedAtMs
              ? Math.max(0, getWorkspaceActivationDiagnosticNowMs() - job.startedAtMs)
              : 0,
            mode: "background",
            repoPath,
            workspaceName,
          });
          workspaceMcpStartupIndexJobsRef.current.delete(jobKey);
          emitWorkspaceMcpRegistryUpdated({
            jobKey,
            jobType,
            repoPath,
            status,
            workspaceId,
            workspaceName,
          });
        } else if (status === "failed") {
          logWorkspaceActivationTrace("workspace.open.workspace_mcp_index.error", workspaceId, {
            elapsedMs: job?.startedAtMs
              ? Math.max(0, getWorkspaceActivationDiagnosticNowMs() - job.startedAtMs)
              : 0,
            message: error || "Unable to index workspace MCP registry.",
            mode: "background",
            repoPath,
            workspaceName,
          });
          if (job?.targetKey) {
            workspaceMcpStartupIndexKeysRef.current.delete(job.targetKey);
          }
          workspaceMcpStartupIndexJobsRef.current.delete(jobKey);
        }
        return;
      }

      if (jobType !== "activate_shared_mcp_daemon") {
        return;
      }

      const job = sharedMcpBackgroundJobsRef.current.get(jobKey) || null;
      const runtimeKey = job?.runtimeKey || workspaceRuntimeActivationKey(workspaceId, repoPath);

      if (status === "completed") {
        const stillDesired = Boolean(runtimeKey && sharedMcpActiveRuntimeTargetsRef.current.has(runtimeKey));
        logWorkspaceActivationTrace("workspace.open.shared_mcp.activate_done", workspaceId, {
          elapsedMs: job?.startedAtMs
            ? Math.max(0, getWorkspaceActivationDiagnosticNowMs() - job.startedAtMs)
            : 0,
          mode: "background",
          repoPath,
          runtimeKey,
          stale: !stillDesired,
          workspaceName,
        });
        sharedMcpBackgroundJobsRef.current.delete(jobKey);
        emitWorkspaceMcpRegistryUpdated({
          jobKey,
          jobType,
          repoPath,
          status,
          workspaceId,
          workspaceName,
        });

        if (!stillDesired && repoPath) {
          invoke("coordination_deactivate_shared_mcp_daemon", {
            repoPath,
            reason: "workspace_activation_disposed",
          }).catch(() => {});
        }
        return;
      }

      if (status === "failed") {
        logWorkspaceActivationTrace("workspace.open.shared_mcp.activate_error", workspaceId, {
          elapsedMs: job?.startedAtMs
            ? Math.max(0, getWorkspaceActivationDiagnosticNowMs() - job.startedAtMs)
            : 0,
          message: error || "Unable to activate shared MCP daemon.",
          mode: "background",
          repoPath,
          runtimeKey,
          workspaceName,
        });
        if (runtimeKey && sharedMcpActiveRuntimeTargetsRef.current.get(runtimeKey) === job?.target) {
          sharedMcpActiveRuntimeTargetsRef.current.delete(runtimeKey);
        }
        sharedMcpBackgroundJobsRef.current.delete(jobKey);
      }
    })
      .then((handler) => {
        if (disposed) {
          handler();
        } else {
          unlisten = handler;
        }
      })
      .catch((error) => {
        logBigViewSyncDiagnosticEvent("workspace_mcp.background_listener.failed", {
          message: getErrorMessage(error, "Unable to listen for workspace MCP background jobs."),
        });
      });

    return () => {
      disposed = true;
      if (typeof unlisten === "function") {
        unlisten();
      }
    };
  }, [logWorkspaceActivationTrace]);

  const activeAccountScope = useMemo(() => {
    const requestedKey = accountScopeKey(activeScope);
    return accountScopes.find((scope) => accountScopeKey(scope) === requestedKey)
      || accountScopes[0]
      || {
        id: "personal",
        type: "personal",
        label: "Personal",
        teamId: null,
      };
  }, [accountScopes, activeScope]);
  const activeAccountScopeKey = accountScopeKey(activeAccountScope);
  const activeWorkspaceScopePayload = useMemo(
    () => accountScopeInvokePayload(activeAccountScope),
    [activeAccountScope],
  );
  const shouldShowAccountScopePicker = accountScopes.some((scope) => scope.type === "team");
  useEffect(() => {
    if (authState !== "authenticated") {
      return;
    }

    if (accountScopeKey(activeScope) !== activeAccountScopeKey) {
      authStore.setActiveScope(activeAccountScope);
    }
  }, [activeAccountScope, activeAccountScopeKey, activeScope, authState]);
  useEffect(() => {
    if (authState !== "authenticated") {
      return;
    }

    const token = authStore.getToken();
    if (!isSafeAuthValue(token)) {
      return;
    }

    terminalPresenceSyncKeyRef.current = "";
    workspaceMcpSyncKeyRef.current = "";
    workspaceCatalogSyncKeyRef.current = "";
    workspaceCloudSyncKeyRef.current = "";
    tokenomicsSyncCursorRef.current = "";
    tokenomicsSyncInFlightRef.current = false;
    tokenomicsSyncPendingRefreshRef.current = false;
    void syncCloudMcpDesktopSessionToken(token, {
      accountScope: activeAccountScope,
      ...cloudMcpBillingEntitlementPayload(billingStatus, user),
      flowId: `scope-${activeAccountScopeKey}`,
    });
  }, [activeAccountScope, activeAccountScopeKey, authState, billingStatus, user]);
  useEffect(() => {
    if (authState !== "authenticated") {
      cloudMcpStartupWarmupKeyRef.current = "";
      return undefined;
    }

    const token = authStore.getToken();
    if (!isSafeAuthValue(token)) {
      cloudMcpStartupWarmupKeyRef.current = "";
      return undefined;
    }

    const warmupKey = `${activeAccountScopeKey}:${token}`;
    if (cloudMcpStartupWarmupKeyRef.current === warmupKey) {
      return undefined;
    }
    cloudMcpStartupWarmupKeyRef.current = warmupKey;

    let disposed = false;
    const cancelWarmup = scheduleWorkspaceStartupIdleTask(() => {
      if (disposed) {
        return;
      }

      void syncCloudMcpDesktopSessionToken(token, {
        accountScope: activeAccountScope,
        connectAttempts: CLOUD_WORKSPACE_CONNECT_ATTEMPTS,
        connectRetryDelayMs: CLOUD_WORKSPACE_CONNECT_RETRY_DELAY_MS,
        ...cloudMcpBillingEntitlementPayload(billingStatus, user),
        flowId: `startup-cloud-mcp-${activeAccountScopeKey}`,
        requireConnected: true,
      }).catch((error) => {
        if (disposed) {
          return;
        }
        logBigViewSyncDiagnosticEvent("cloud_mcp.startup_warmup.failed", {
          message: getErrorMessage(error, "Unable to warm Cloud MCP connection."),
          scope: activeAccountScopeKey,
        });
      });
    }, {
      delayMs: WORKSPACE_APP_STARTUP_SHARED_MCP_IDLE_DELAY_MS,
      timeoutMs: WORKSPACE_APP_STARTUP_IDLE_TIMEOUT_MS,
    });

    return () => {
      disposed = true;
      cancelWarmup();
    };
  }, [
    activeAccountScope,
    activeAccountScopeKey,
    authState,
    billingStatus,
    user,
  ]);
  const activeWorkspaceHydrationRoot = activatedWorkspaceId
    ? getWorkspaceRootDirectory(workspaceSettings, activatedWorkspaceId) || defaultWorkingDirectory
    : "";
  const workspaceActivationDeferred = Boolean(workspacePendingActivationId);
  const workspaceHydrationKey = authState === "authenticated" && workspaceState === "ready"
    ? [
      activeAccountScopeKey,
      selectedWorkspaceId || "none",
      activatedWorkspaceId || "none",
      getWorkspaceRootIdentity(activeWorkspaceHydrationRoot),
    ].join(":")
    : "";
  const workspaceCoordinationRootEntries = useMemo(() => {
    const entries = [];
    const seen = new Set();

    workspaces.forEach((workspace) => {
      const workspaceId = String(workspace?.id || "").trim();
      if (!workspaceId) {
        return;
      }
      const rootDirectory = (
        getWorkspaceRootDirectory(workspaceSettings, workspaceId)
        || cleanWorkspaceRootDirectory(defaultWorkingDirectory)
      );
      const key = `${workspaceId}:${getWorkspaceRootIdentity(rootDirectory)}`;
      if (!rootDirectory || seen.has(key)) {
        return;
      }
      seen.add(key);
      entries.push({
        rootDirectory,
        workspaceId,
      });
    });

    return entries;
  }, [defaultWorkingDirectory, workspaceSettings, workspaces]);
  const workspaceCoordinationRootKey = useMemo(
    () => JSON.stringify(workspaceCoordinationRootEntries.map((entry) => [
      entry.workspaceId,
      getWorkspaceRootIdentity(entry.rootDirectory),
    ])),
    [workspaceCoordinationRootEntries],
  );

  useEffect(() => {
    const ready = Boolean(workspaceHydrationKey);
    setWorkspaceHydrationReady(ready);
    logWorkspaceActivationTrace("workspace.open.hydration_key", activatedWorkspaceId || selectedWorkspaceId, {
      activatedWorkspaceId,
      activeAccountScopeKey,
      ready,
      rootDirectory: activeWorkspaceHydrationRoot,
      rootIdentity: getWorkspaceRootIdentity(activeWorkspaceHydrationRoot),
      selectedWorkspaceId,
      workspaceActivationDeferred,
      workspaceState,
    });
  }, [
    activatedWorkspaceId,
    activeAccountScopeKey,
    activeWorkspaceHydrationRoot,
    logWorkspaceActivationTrace,
    selectedWorkspaceId,
    workspaceActivationDeferred,
    workspaceHydrationKey,
    workspaceState,
  ]);

  useEffect(() => {
    if (!workspaceHydrationReady || workspaceActivationDeferred) {
      logWorkspaceActivationTrace("workspace.open.coordination_targets.skip", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
        reason: !workspaceHydrationReady ? "hydration_not_ready" : "activation_deferred",
        workspaceActivationDeferred,
        workspaceHydrationReady,
      });
      return undefined;
    }

    if (!workspaceCoordinationRootEntries.length) {
      logWorkspaceActivationTrace("workspace.open.coordination_targets.empty", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
        workspaceHydrationReady,
      });
      workspaceCoordinationTargetsStateKeyRef.current = "";
      setWorkspaceCoordinationTargetsByRoot({});
      return undefined;
    }

    const startedAtMs = getWorkspaceActivationDiagnosticNowMs();
    const nextTargetsByRoot = {};
    let cacheHitCount = 0;
    let cacheUpdated = false;
    let fallbackCount = 0;
    let scanSnapshotCount = 0;

    workspaceCoordinationRootEntries.forEach((entry) => {
      const rootKey = getWorkspaceRootIdentity(entry.rootDirectory);
      if (!rootKey) {
        return;
      }

      const scanSnapshot = getWorkspaceGraphScanSnapshotForRoot(
        workspaceGraphState,
        entry.rootDirectory,
        entry.workspaceId,
      );
      const scanResponse = scanSnapshot
        ? workspaceCoordinationTargetResponseFromScanSnapshot(scanSnapshot, entry.rootDirectory)
        : null;
      if (scanResponse?.targets?.length) {
        const normalizedScanResponse = normalizeWorkspaceCoordinationTargetsCacheRecord(
          scanResponse,
          entry.rootDirectory,
        );
        if (normalizedScanResponse) {
          workspaceCoordinationTargetsCacheRef.current.set(rootKey, normalizedScanResponse);
          nextTargetsByRoot[rootKey] = normalizedScanResponse;
          cacheUpdated = true;
        } else {
          nextTargetsByRoot[rootKey] = scanResponse;
        }
        scanSnapshotCount += 1;
        return;
      }

      const cachedResponse = workspaceCoordinationTargetsCacheRef.current.get(rootKey);
      if (cachedResponse?.targets?.length) {
        nextTargetsByRoot[rootKey] = cachedResponse;
        cacheHitCount += 1;
        return;
      }

      const fallbackResponse = normalizeWorkspaceCoordinationTargetResponse(
        null,
        entry.rootDirectory,
      );
      nextTargetsByRoot[rootKey] = fallbackResponse;
      fallbackCount += 1;
    });

    if (cacheUpdated) {
      persistWorkspaceCoordinationTargetsCache(workspaceCoordinationTargetsCacheRef.current);
    }

    const nextTargetsStateKey = JSON.stringify(
      Object.entries(nextTargetsByRoot)
        .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
        .map(([rootKey, record]) => [
          rootKey,
          String(record?.workspaceKind || ""),
          (Array.isArray(record?.targets) ? record.targets : [])
            .map((target) => [
              getWorkspaceRootIdentity(target?.repoPath || ""),
              String(target?.projectKind || ""),
              String(target?.mountKind || ""),
              String(target?.mountId || ""),
              String(target?.workspaceRelativePath || ""),
              Boolean(target?.hasGit),
              Boolean(target?.hasAgents),
              Boolean(target?.hasKernelDb),
            ])
            .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
        ]),
    );
    if (workspaceCoordinationTargetsStateKeyRef.current === nextTargetsStateKey) {
      return undefined;
    }
    workspaceCoordinationTargetsStateKeyRef.current = nextTargetsStateKey;

    logWorkspaceActivationTrace("workspace.open.coordination_targets.resolved", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
      cacheHitCount,
      elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - startedAtMs),
      fallbackCount,
      rootCount: workspaceCoordinationRootEntries.length,
      scanSnapshotCount,
      targetCount: Object.values(nextTargetsByRoot).reduce((sum, record) => (
        sum + (Array.isArray(record?.targets) ? record.targets.length : 0)
      ), 0),
    });
    setWorkspaceCoordinationTargetsByRoot(nextTargetsByRoot);

    return undefined;
  }, [
    workspaceActivationDeferred,
    logWorkspaceActivationTrace,
    workspaceCoordinationRootEntries,
    workspaceCoordinationRootKey,
    workspaceGraphState,
    workspaceHydrationReady,
  ]);

  const workspaceNotificationRoots = useMemo(() => (
    workspaceCoordinationRootEntries.flatMap((entry) => (
      getWorkspaceCoordinationTargetsForRoot(
        workspaceCoordinationTargetsByRoot,
        entry.rootDirectory,
      ).map((target) => ({
        mountId: target.mountId || "",
        rootDirectory: target.repoPath,
        workspaceId: entry.workspaceId,
        workspaceRootDirectory: entry.rootDirectory,
      }))
    ))
  ), [
    workspaceCoordinationRootEntries,
    workspaceCoordinationTargetsByRoot,
  ]);
  const workspaceNotificationSummaries = useMemo(
    () => getWorkspaceNotificationSummaries(workspaceNotifications, workspaceThreads),
    [workspaceNotifications, workspaceThreads],
  );
  const workspaceNotificationSurfaceVisible = useCallback((workspaceId) => {
    const safeWorkspaceId = String(workspaceId || "").trim();
    return Boolean(
      safeWorkspaceId
        && selectedWorkspaceIdRef.current === safeWorkspaceId
        && activeViewRef.current === DEFAULT_WORKSPACE_VIEW
        && visibleViewRef.current === DEFAULT_WORKSPACE_VIEW
        && mainWindowFocusedRef.current,
    );
  }, []);
  const workspaceNotificationReducerOptions = useCallback((workspaceId, options = {}) => {
    const safeWorkspaceId = String(workspaceId || "").trim();
    return {
      selectedWorkspaceId: selectedWorkspaceIdRef.current,
      workspaceId: safeWorkspaceId,
      workspaceVisibleAndFocused: workspaceNotificationSurfaceVisible(safeWorkspaceId),
      ...options,
    };
  }, [workspaceNotificationSurfaceVisible]);
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
  useEffect(() => {
    appCloseConfirmStateRef.current = appCloseConfirmState;
  }, [appCloseConfirmState]);

  const setWorkspaceGraphStatus = useCallback((repoPath, workspaceId, statusPatch) => {
    const key = workspaceGraphStateKey(repoPath, workspaceId);
    if (!key) return;
    setWorkspaceGraphState((current) => {
      const next = {
        ...current,
        [key]: {
          ...(current[key] || {}),
          repoPath,
          workspaceId,
          ...statusPatch,
        },
      };
      workspaceGraphStateRef.current = next;
      return next;
    });
  }, []);

  const startWorkspaceArchitectureScan = useCallback((workspaceId, options = {}) => {
    const safeWorkspaceId = graphText(workspaceId);
    if (!safeWorkspaceId) return false;

    const repoPath = cleanWorkspaceRootDirectory(
      options.rootDirectory
        || getWorkspaceRootDirectory(workspaceSettingsRef.current, safeWorkspaceId)
        || defaultWorkingDirectoryRef.current,
    );
    const key = workspaceGraphStateKey(repoPath, safeWorkspaceId);
    if (!repoPath || !key) return false;

    const existing = workspaceGraphStateRef.current[key] || {};
    const existingScanState = existing.architectureRepositoryScanState || "idle";
    if (
      !options.refresh
        && (
          existing.architectureRepositoryScanSnapshot
          || existingScanState === "loading"
          || existingScanState === "ready"
        )
    ) {
      logWorkspaceActivationTrace("workspace.open.architecture_scan.cache_hit", safeWorkspaceId, {
        reason: options.reason || "workspace_activation",
        repoPath,
        scanState: existingScanState,
      });
      return false;
    }

    if (workspaceArchitectureScanInFlightRef.current.has(key)) {
      logWorkspaceActivationTrace("workspace.open.architecture_scan.in_flight", safeWorkspaceId, {
        reason: options.reason || "workspace_activation",
        repoPath,
      });
      return false;
    }

    const requestedAt = Date.now();
    workspaceArchitectureScanInFlightRef.current.add(key);
    setWorkspaceGraphStatus(repoPath, safeWorkspaceId, {
      architectureRepositoryScanCacheKey: key,
      architectureRepositoryScanError: "",
      architectureRepositoryScanReason: options.reason || "workspace_activation",
      architectureRepositoryScanRequestedAt: requestedAt,
      architectureRepositoryScanSource: "backend_workspace_topology_cache",
      architectureRepositoryScanState: "loading",
    });
    logWorkspaceActivationTrace("workspace.open.architecture_scan.start", safeWorkspaceId, {
      reason: options.reason || "workspace_activation",
      repoPath,
    });

    invoke("architecture_scanned_result", { rootDirectory: repoPath || null })
      .then((result) => {
        const completedAt = Date.now();
        const resultCache = result?.cache && typeof result.cache === "object" ? result.cache : {};
        setWorkspaceGraphStatus(repoPath, safeWorkspaceId, {
          architectureRepositoryScanCacheKey: resultCache.key || key,
          architectureRepositoryScanError: "",
          architectureRepositoryScanSnapshot: result,
          architectureRepositoryScanSource: resultCache.source || "backend_workspace_topology_cache",
          architectureRepositoryScanState: "ready",
          architectureRepositoryScanUpdatedAt: completedAt,
        });
        const repositories = Array.isArray(result?.repositories) ? result.repositories : [];
        const gitCount = repositories.filter((repo) => repo?.hasGit === true || repo?.has_git === true).length;
        logWorkspaceActivationTrace("workspace.open.architecture_scan.done", safeWorkspaceId, {
          folderCount: Math.max(0, repositories.length - gitCount),
          gitCount,
          mountCount: Array.isArray(result?.mounts) ? result.mounts.length : 0,
          repoPath,
          repositoryCount: repositories.length,
          workspaceMountCount: Array.isArray(result?.workspaceMounts) ? result.workspaceMounts.length : 0,
        });
      })
      .catch((error) => {
        setWorkspaceGraphStatus(repoPath, safeWorkspaceId, {
          architectureRepositoryScanCacheKey: key,
          architectureRepositoryScanError: getErrorMessage(error, "Unable to scan workspace architecture."),
          architectureRepositoryScanSource: "backend_workspace_topology_cache",
          architectureRepositoryScanState: "error",
          architectureRepositoryScanUpdatedAt: Date.now(),
        });
        logWorkspaceActivationTrace("workspace.open.architecture_scan.error", safeWorkspaceId, {
          error: getErrorMessage(error, "Unable to scan workspace architecture."),
          repoPath,
        });
      })
      .finally(() => {
        workspaceArchitectureScanInFlightRef.current.delete(key);
      });

    return true;
  }, [
    logWorkspaceActivationTrace,
    setWorkspaceGraphStatus,
  ]);

  const refreshWorkspaceArchitectureGraphList = useCallback((workspaceId, repoPath, options = {}) => {
    const safeWorkspaceId = graphText(workspaceId);
    const safeRepoPath = cleanWorkspaceRootDirectory(repoPath);
    if (!safeWorkspaceId || !safeRepoPath) {
      return Promise.resolve([]);
    }

    const workspaceRootPath = cleanWorkspaceRootDirectory(
      options.workspaceRootDirectory
        || getWorkspaceRootDirectory(workspaceSettingsRef.current, safeWorkspaceId)
        || defaultWorkingDirectoryRef.current
        || safeRepoPath,
    );
    const stateKey = workspaceGraphStateKey(workspaceRootPath, safeWorkspaceId);
    const repoKey = workspaceArchitectureRepoKey(safeRepoPath);
    if (!stateKey || !repoKey) {
      return Promise.resolve([]);
    }

    const existingState = workspaceGraphStateRef.current[stateKey] || {};
    const existingLists = existingState.architectureGraphLists || {};
    const existingEntry = existingLists[repoKey] || null;
    const existingGraphs = Array.isArray(existingEntry?.graphs) ? existingEntry.graphs : [];
    if (!options.refresh && existingEntry?.state === "ready") {
      return Promise.resolve(existingGraphs);
    }
    if (
      !options.refresh
      && existingEntry?.state === "error"
      && Date.now() - Number(existingEntry.updatedAt || 0) < ARCHITECTURE_GRAPH_LIST_ERROR_RETRY_MS
    ) {
      return Promise.resolve(existingGraphs);
    }

    const requestKey = `${stateKey}::${repoKey}`;
    if (workspaceArchitectureGraphListInFlightRef.current.has(requestKey)) {
      return Promise.resolve(existingGraphs);
    }

    const requestedAt = Date.now();
    workspaceArchitectureGraphListInFlightRef.current.add(requestKey);
    setWorkspaceGraphState((current) => {
      const previous = current[stateKey] || {};
      const previousLists = previous.architectureGraphLists || {};
      const previousEntry = previousLists[repoKey] || {};
      const nextEntry = workspaceArchitectureGraphListEntry(safeRepoPath, {
        ...previousEntry,
        requestedAt,
        state: options.silent && previousEntry.state ? previousEntry.state : "loading",
      });
      const next = {
        ...current,
        [stateKey]: {
          ...previous,
          repoPath: workspaceRootPath,
          workspaceId: safeWorkspaceId,
          architectureGraphLists: {
            ...previousLists,
            [repoKey]: nextEntry,
          },
          architectureGraphListsUpdatedAt: requestedAt,
        },
      };
      workspaceGraphStateRef.current = next;
      return next;
    });

    const workspaceName = graphText(options.workspaceName || options.workspace_name);
    const localListPromise = invoke("architecture_graphs_list", { repoPath: safeRepoPath });
    const cloudListPromise = invoke("cloud_mcp_get_workspace_architectures", {
      repoPath: safeRepoPath,
      workspaceId: safeWorkspaceId,
      workspaceName,
    }).catch(() => null);

    return Promise.all([localListPromise, cloudListPromise])
      .then(([result, cloudResult]) => {
        const localGraphs = Array.isArray(result?.graphs) ? result.graphs : [];
        const cloudGraphs = jsonArray(cloudResult?.graphs || cloudResult?.architectures);
        const graphs = workspaceArchitectureMergeGraphLists(localGraphs, cloudGraphs);
        const completedAt = Date.now();
        if (localGraphs.length) {
          const syncSignature = workspaceArchitectureCloudSyncSignature(localGraphs);
          if (architectureCloudSyncSignatureRef.current[repoKey] !== syncSignature) {
            architectureCloudSyncSignatureRef.current[repoKey] = syncSignature;
            invoke("cloud_mcp_sync_workspace_architectures", {
              graphs: localGraphs,
              reason: options.reason || "workspace_architecture_graph_list_sync",
              repoPath: safeRepoPath,
              workspaceId: safeWorkspaceId,
              workspaceName,
            }).catch(() => {});
          }
        }
        setWorkspaceGraphState((current) => {
          const previous = current[stateKey] || {};
          const previousLists = previous.architectureGraphLists || {};
          const selectedRepoKey = workspaceArchitectureRepoKey(previous.architectureSelectedRepoPath);
          const selectedRepoPath = previous.architectureSelectedRepoPath || safeRepoPath;
          const shouldSelectGraph = !selectedRepoKey || selectedRepoKey === repoKey;
          let selectedGraphId = previous.architectureSelectedGraphId || "";
          if (shouldSelectGraph && selectedGraphId && !graphs.some((graph) => graph?.id === selectedGraphId)) {
            selectedGraphId = "";
          }
          if (shouldSelectGraph && !selectedGraphId) {
            selectedGraphId = graphs[0]?.id || "";
          }

          const nextScan = workspaceArchitectureScanWithGraphCount(
            previous.architectureRepositoryScanSnapshot,
            safeRepoPath,
            graphs.length,
          );
          const next = {
            ...current,
            [stateKey]: {
              ...previous,
              repoPath: workspaceRootPath,
              workspaceId: safeWorkspaceId,
              architectureGraphLists: {
                ...previousLists,
                [repoKey]: workspaceArchitectureGraphListEntry(safeRepoPath, {
                  architectureRoot: result?.architectureRoot || result?.architecture_root,
                  graphs,
                  navTree: graphs,
                  repoPath: result?.repoPath || result?.repo_path || safeRepoPath,
                  requestedAt,
                  state: "ready",
                  updatedAt: completedAt,
                }),
              },
              architectureGraphListsUpdatedAt: completedAt,
              architectureRepositoryScanSnapshot: nextScan,
              architectureSelectedRepoPath: selectedRepoPath,
              architectureSelectedGraphId: selectedGraphId,
            },
          };
          workspaceGraphStateRef.current = next;
          return next;
        });
        return graphs;
      })
      .catch((error) => {
        const message = getErrorMessage(error, "Unable to load architecture graphs.");
        setWorkspaceGraphState((current) => {
          const previous = current[stateKey] || {};
          const previousLists = previous.architectureGraphLists || {};
          const previousEntry = previousLists[repoKey] || {};
          const next = {
            ...current,
            [stateKey]: {
              ...previous,
              repoPath: workspaceRootPath,
              workspaceId: safeWorkspaceId,
              architectureGraphLists: {
                ...previousLists,
                [repoKey]: workspaceArchitectureGraphListEntry(safeRepoPath, {
                  ...previousEntry,
                  error: message,
                  requestedAt,
                  state: "error",
                  updatedAt: Date.now(),
                }),
              },
            },
          };
          workspaceGraphStateRef.current = next;
          return next;
        });
        if (!options.silent) {
          throw error;
        }
        return existingGraphs;
      })
      .finally(() => {
        workspaceArchitectureGraphListInFlightRef.current.delete(requestKey);
      });
  }, []);

  const setWorkspaceArchitectureSelection = useCallback((workspaceId, options = {}) => {
    const safeWorkspaceId = graphText(workspaceId);
    if (!safeWorkspaceId) return;
    const workspaceRootPath = cleanWorkspaceRootDirectory(
      options.workspaceRootDirectory
        || getWorkspaceRootDirectory(workspaceSettingsRef.current, safeWorkspaceId)
        || defaultWorkingDirectoryRef.current,
    );
    const stateKey = workspaceGraphStateKey(workspaceRootPath, safeWorkspaceId);
    if (!stateKey) return;
    const selectedRepoPath = graphText(options.repoPath);
    const selectedGraphId = graphText(options.graphId);
    setWorkspaceGraphState((current) => {
      const previous = current[stateKey] || {};
      const nextSelectedRepoPath = selectedRepoPath || previous.architectureSelectedRepoPath || "";
      if (
        previous.architectureSelectedRepoPath === nextSelectedRepoPath
        && previous.architectureSelectedGraphId === selectedGraphId
      ) {
        return current;
      }
      const next = {
        ...current,
        [stateKey]: {
          ...previous,
          repoPath: workspaceRootPath || previous.repoPath,
          workspaceId: safeWorkspaceId,
          architectureSelectedRepoPath: nextSelectedRepoPath,
          architectureSelectedGraphId: selectedGraphId,
        },
      };
      workspaceGraphStateRef.current = next;
      return next;
    });
  }, []);

  const [architectureHub, setArchitectureHub] = useState({
    catalog: null,
    error: "",
    refreshing: false,
    state: "idle",
    updatedAt: 0,
  });
  const [architectureHubGraphState, setArchitectureHubGraphState] = useState({
    architectureGraphLists: {},
    architectureSelectedGraphId: "",
    architectureSelectedRepoPath: "",
  });
  const architectureHubRef = useRef(architectureHub);
  architectureHubRef.current = architectureHub;
  const architectureHubCatalogInFlightRef = useRef(false);
  const architectureHubGraphListInFlightRef = useRef(new Set());
  const architectureHubGraphStateRef = useRef(architectureHubGraphState);
  architectureHubGraphStateRef.current = architectureHubGraphState;

  const architectureHubEntries = useMemo(() => {
    const catalog = architectureHub.catalog;
    if (!catalog || typeof catalog !== "object") return [];
    const entries = [];
    if (catalog.global && typeof catalog.global === "object") {
      entries.push(catalog.global);
    }
    (Array.isArray(catalog.workspaces) ? catalog.workspaces : []).forEach((group) => {
      (Array.isArray(group?.repositories) ? group.repositories : []).forEach((repo) => {
        if (repo && typeof repo === "object") entries.push(repo);
      });
    });
    (Array.isArray(catalog.folderRepositories) ? catalog.folderRepositories : []).forEach((repo) => {
      if (repo && typeof repo === "object") entries.push(repo);
    });
    (Array.isArray(catalog.orphanRepositories) ? catalog.orphanRepositories : []).forEach((repo) => {
      if (repo && typeof repo === "object") entries.push(repo);
    });
    return entries;
  }, [architectureHub.catalog]);

  const findArchitectureHubEntry = useCallback((repoPath) => {
    const key = workspaceArchitectureRepoKey(repoPath);
    if (!key) return null;
    return architectureHubEntries.find((entry) => (
      workspaceArchitectureRepoKey(entry?.path || entry?.rootDirectory || entry?.root_directory) === key
    )) || null;
  }, [architectureHubEntries]);

  const refreshArchitectureHubCatalog = useCallback((options = {}) => {
    if (architectureHubCatalogInFlightRef.current) {
      return Promise.resolve(architectureHubRef.current.catalog);
    }
    if (!options.refresh && architectureHubRef.current.catalog) {
      return Promise.resolve(architectureHubRef.current.catalog);
    }
    architectureHubCatalogInFlightRef.current = true;
    // Background refreshes never drop back to "loading" once a catalog is
    // cached; that state flip is what made the hub visibly flicker.
    setArchitectureHub((current) => ({
      ...current,
      error: "",
      refreshing: true,
      state: current.catalog ? current.state : "loading",
    }));
    const workspaceList = (Array.isArray(workspacesRef.current) ? workspacesRef.current : [])
      .map((workspace) => ({
        workspaceId: graphText(workspace?.id),
        workspaceName: graphText(workspace?.name),
        rootDirectory: cleanWorkspaceRootDirectory(
          getWorkspaceRootDirectory(workspaceSettingsRef.current, workspace?.id)
            || defaultWorkingDirectoryRef.current,
        ),
      }))
      .filter((workspace) => workspace.workspaceId && workspace.rootDirectory);
    return invoke("cloud_mcp_architecture_hub_catalog", { workspaces: workspaceList })
      .then((catalog) => {
        setArchitectureHub({
          catalog,
          error: graphText(catalog?.cloudError),
          refreshing: false,
          state: "ready",
          updatedAt: Date.now(),
        });
        return catalog;
      })
      .catch((error) => {
        setArchitectureHub((current) => ({
          ...current,
          error: getErrorMessage(error, "Unable to load the architecture catalog."),
          refreshing: false,
          state: current.catalog ? "ready" : "error",
        }));
        return null;
      })
      .finally(() => {
        architectureHubCatalogInFlightRef.current = false;
      });
  }, []);

  const resolveArchitectureHubSyncContext = useCallback((repoPath) => {
    const entry = findArchitectureHubEntry(repoPath);
    if (!entry) return null;
    if (graphText(entry.scopeKind) === "workspace") {
      return {
        workspaceId: graphText(entry.workspaceId),
        workspaceName: graphText(entry.workspaceName),
        queueWorkspaceId: graphText(entry.workspaceId),
        queueWorkspaceName: graphText(entry.workspaceName),
      };
    }
    return {
      workspaceId: graphText(entry.workspaceId)
        || graphText(architectureHubRef.current.catalog?.globalWorkspaceId)
        || "account-global",
      workspaceName: graphText(entry.workspaceName) || graphText(entry.name),
      queueWorkspaceId: "",
      queueWorkspaceName: "",
      scopeRepoId: graphText(entry.repoId),
      scopeGitRepoIdentityId: graphText(entry.gitRepoIdentityId),
    };
  }, [findArchitectureHubEntry]);

  const refreshArchitectureHubGraphList = useCallback((repoPath, options = {}) => {
    const safeRepoPath = cleanWorkspaceRootDirectory(repoPath);
    if (!safeRepoPath) return Promise.resolve([]);
    const entry = findArchitectureHubEntry(safeRepoPath);
    if (entry && graphText(entry.scopeKind) === "workspace") {
      const catalogGroups = architectureHubRef.current.catalog?.workspaces;
      const group = (Array.isArray(catalogGroups) ? catalogGroups : []).find((candidate) => (
        graphText(candidate?.workspaceId) === graphText(entry.workspaceId)
      ));
      return refreshWorkspaceArchitectureGraphList(entry.workspaceId, safeRepoPath, {
        ...options,
        workspaceName: graphText(entry.workspaceName),
        workspaceRootDirectory: graphText(group?.rootDirectory),
      });
    }

    const repoKey = workspaceArchitectureRepoKey(safeRepoPath);
    const existingEntry = (architectureHubGraphStateRef.current.architectureGraphLists || {})[repoKey] || null;
    const existingGraphs = Array.isArray(existingEntry?.graphs) ? existingEntry.graphs : [];
    if (!options.refresh && existingEntry?.state === "ready") {
      return Promise.resolve(existingGraphs);
    }
    // Error entries are cached too: without a retry-after window, every
    // cache write re-armed the view's auto-load effect and a failing repo
    // hot-looped loading→error forever.
    if (
      !options.refresh
      && existingEntry?.state === "error"
      && Date.now() - Number(existingEntry.updatedAt || 0) < ARCHITECTURE_GRAPH_LIST_ERROR_RETRY_MS
    ) {
      return Promise.resolve(existingGraphs);
    }
    if (architectureHubGraphListInFlightRef.current.has(repoKey)) {
      return Promise.resolve(existingGraphs);
    }
    architectureHubGraphListInFlightRef.current.add(repoKey);
    const requestedAt = Date.now();
    setArchitectureHubGraphState((current) => ({
      ...current,
      architectureGraphLists: {
        ...(current.architectureGraphLists || {}),
        [repoKey]: workspaceArchitectureGraphListEntry(safeRepoPath, {
          ...(current.architectureGraphLists?.[repoKey] || {}),
          requestedAt,
          state: options.silent && current.architectureGraphLists?.[repoKey]?.state
            ? current.architectureGraphLists[repoKey].state
            : "loading",
        }),
      },
    }));
    const context = resolveArchitectureHubSyncContext(safeRepoPath) || {
      workspaceId: "account-global",
      workspaceName: "",
      scopeRepoId: "",
      scopeGitRepoIdentityId: "",
    };
    const localListPromise = invoke("architecture_graphs_list", { repoPath: safeRepoPath });
    const cloudListPromise = invoke("cloud_mcp_get_workspace_architectures", {
      repoPath: safeRepoPath,
      workspaceId: context.workspaceId,
      workspaceName: context.workspaceName,
      ...(context.scopeRepoId ? {
        scopeRepoId: context.scopeRepoId,
        scopeGitRepoIdentityId: context.scopeGitRepoIdentityId,
      } : {}),
    }).catch(() => null);
    return Promise.all([localListPromise, cloudListPromise])
      .then(([result, cloudResult]) => {
        const localGraphs = jsonArray(result?.graphs);
        const cloudGraphs = jsonArray(cloudResult?.graphs || cloudResult?.architectures);
        const graphs = workspaceArchitectureMergeGraphLists(localGraphs, cloudGraphs);
        if (localGraphs.length && context.workspaceId) {
          const syncSignature = workspaceArchitectureCloudSyncSignature(localGraphs);
          if (architectureCloudSyncSignatureRef.current[repoKey] !== syncSignature) {
            architectureCloudSyncSignatureRef.current[repoKey] = syncSignature;
            invoke("cloud_mcp_sync_workspace_architectures", {
              graphs: localGraphs,
              reason: options.reason || "architecture_hub_graph_list_sync",
              repoPath: safeRepoPath,
              workspaceId: context.workspaceId,
              workspaceName: context.workspaceName,
              ...(context.scopeRepoId ? {
                scopeRepoId: context.scopeRepoId,
                scopeGitRepoIdentityId: context.scopeGitRepoIdentityId,
              } : {}),
            }).catch(() => {});
          }
        }
        setArchitectureHubGraphState((current) => ({
          ...current,
          architectureGraphLists: {
            ...(current.architectureGraphLists || {}),
            [repoKey]: workspaceArchitectureGraphListEntry(safeRepoPath, {
              architectureRoot: result?.architectureRoot || result?.architecture_root,
              graphs,
              navTree: graphs,
              repoPath: safeRepoPath,
              requestedAt,
              state: "ready",
              updatedAt: Date.now(),
            }),
          },
        }));
        return graphs;
      })
      .catch((error) => {
        const message = getErrorMessage(error, "Unable to load architecture graphs.");
        setArchitectureHubGraphState((current) => ({
          ...current,
          architectureGraphLists: {
            ...(current.architectureGraphLists || {}),
            [repoKey]: workspaceArchitectureGraphListEntry(safeRepoPath, {
              ...(current.architectureGraphLists?.[repoKey] || {}),
              error: message,
              requestedAt,
              state: "error",
              updatedAt: Date.now(),
            }),
          },
        }));
        if (!options.silent) throw error;
        return existingGraphs;
      })
      .finally(() => {
        architectureHubGraphListInFlightRef.current.delete(repoKey);
      });
  }, [
    findArchitectureHubEntry,
    refreshWorkspaceArchitectureGraphList,
    resolveArchitectureHubSyncContext,
  ]);

  const architectureHubGraphLists = useMemo(() => {
    const merged = {};
    Object.values(workspaceGraphState || {}).forEach((stateEntry) => {
      Object.assign(merged, stateEntry?.architectureGraphLists || {});
    });
    Object.assign(merged, architectureHubGraphState.architectureGraphLists || {});
    return merged;
  }, [architectureHubGraphState.architectureGraphLists, workspaceGraphState]);

  const updateArchitectureHubSelection = useCallback(({ graphId, repoPath } = {}) => {
    setArchitectureHubGraphState((current) => {
      const nextRepoPath = graphText(repoPath) || current.architectureSelectedRepoPath;
      const nextGraphId = graphText(graphId);
      if (
        current.architectureSelectedRepoPath === nextRepoPath
        && current.architectureSelectedGraphId === nextGraphId
      ) {
        return current;
      }
      return {
        ...current,
        architectureSelectedGraphId: nextGraphId,
        architectureSelectedRepoPath: nextRepoPath,
      };
    });
  }, []);

  const copyArchitectureHubGraph = useCallback(({ graphId, sourceRepoPath, targetRepoPath } = {}) => {
    const safeGraphId = graphText(graphId);
    const safeSource = cleanWorkspaceRootDirectory(sourceRepoPath);
    const safeTarget = cleanWorkspaceRootDirectory(targetRepoPath);
    if (!safeGraphId || !safeSource || !safeTarget) {
      return Promise.reject(new Error("Architecture graph copy requires a graph and target."));
    }
    return invoke("architecture_graph_copy", {
      graphId: safeGraphId,
      sourceRepoPath: safeSource,
      targetRepoPath: safeTarget,
    }).then((result) => {
      const context = resolveArchitectureHubSyncContext(safeTarget);
      if (context?.workspaceId && result?.graph) {
        void invoke("cloud_mcp_sync_workspace_architecture", {
          graph: result.graph,
          reason: "architecture_graph_copy",
          repoPath: safeTarget,
          workspaceId: context.workspaceId,
          workspaceName: context.workspaceName || "",
          ...(context.scopeRepoId ? {
            scopeRepoId: context.scopeRepoId,
            scopeGitRepoIdentityId: context.scopeGitRepoIdentityId,
          } : {}),
        }).catch(() => {});
      }
      void refreshArchitectureHubGraphList(safeTarget, { refresh: true, silent: true });
      return result;
    });
  }, [refreshArchitectureHubGraphList, resolveArchitectureHubSyncContext]);

  // Architecture auto-sync: the Rust store watcher reports graph-source
  // changes (in-app saves, agent edits in terminals, direct file edits) and
  // the cloud broadcasts report other devices' pushes. Both funnel into one
  // debounced pass that rebuilds the catalog and silently re-lists every
  // cached graph list, so the tab stays current without the refresh button.
  useEffect(() => {
    if (authState !== "authenticated") {
      return undefined;
    }
    let disposed = false;
    let debounceTimer = 0;
    const staggerTimers = new Set();
    const unlisteners = [];

    const runAutoRefresh = () => {
      debounceTimer = 0;
      if (disposed) {
        return;
      }
      void refreshArchitectureHubCatalog({ refresh: true });
      const cachedLists = {};
      Object.values(workspaceGraphStateRef.current || {}).forEach((stateEntry) => {
        Object.assign(cachedLists, stateEntry?.architectureGraphLists || {});
      });
      Object.assign(cachedLists, architectureHubGraphStateRef.current.architectureGraphLists || {});
      Object.values(cachedLists).slice(0, 40).forEach((entry, index) => {
        const repoPath = graphText(entry?.repoPath);
        if (!repoPath) {
          return;
        }
        const timer = window.setTimeout(() => {
          staggerTimers.delete(timer);
          if (!disposed) {
            void refreshArchitectureHubGraphList(repoPath, { refresh: true, silent: true });
          }
        }, 120 * index);
        staggerTimers.add(timer);
      });
    };

    const scheduleAutoRefresh = () => {
      if (disposed) {
        return;
      }
      if (debounceTimer) {
        window.clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(runAutoRefresh, 800);
    };

    ["architecture-store-changed", "cloud-mcp-workspace-architectures-updated"].forEach((eventName) => {
      void listen(eventName, scheduleAutoRefresh).then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      }).catch(() => {});
    });

    return () => {
      disposed = true;
      if (debounceTimer) {
        window.clearTimeout(debounceTimer);
      }
      staggerTimers.forEach((timer) => window.clearTimeout(timer));
      staggerTimers.clear();
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [authState, refreshArchitectureHubCatalog, refreshArchitectureHubGraphList]);

  // Account-level data loads at app startup, not on first tab visit: the
  // architecture hub catalog plus a background prefetch of every repo's graph
  // list, so opening the Architectures tab never shows a loading flash.
  useEffect(() => {
    if (authState !== "authenticated") return undefined;

    let cancelled = false;
    const prefetchTimers = new Set();

    void refreshArchitectureHubCatalog().then((catalog) => {
      if (cancelled || !catalog || typeof catalog !== "object") return;
      const entries = [];
      if (catalog.global && typeof catalog.global === "object") entries.push(catalog.global);
      (Array.isArray(catalog.workspaces) ? catalog.workspaces : []).forEach((group) => {
        (Array.isArray(group?.repositories) ? group.repositories : []).forEach((repo) => {
          if (repo && typeof repo === "object") entries.push(repo);
        });
      });
      (Array.isArray(catalog.folderRepositories) ? catalog.folderRepositories : []).forEach((repo) => {
        if (repo && typeof repo === "object") entries.push(repo);
      });
      (Array.isArray(catalog.orphanRepositories) ? catalog.orphanRepositories : []).forEach((repo) => {
        if (repo && typeof repo === "object") entries.push(repo);
      });

      entries.slice(0, 32).forEach((entry, index) => {
        const repoPath = graphText(entry?.path || entry?.rootDirectory || entry?.root_directory);
        if (!repoPath) return;
        const timer = window.setTimeout(() => {
          prefetchTimers.delete(timer);
          if (!cancelled) {
            void refreshArchitectureHubGraphList(repoPath, { silent: true });
          }
        }, 150 * index);
        prefetchTimers.add(timer);
      });
    });

    return () => {
      cancelled = true;
      prefetchTimers.forEach((timer) => window.clearTimeout(timer));
      prefetchTimers.clear();
    };
  }, [authState, refreshArchitectureHubCatalog, refreshArchitectureHubGraphList]);

  const applyWorkspaceGraphSnapshot = useCallback((repoPath, workspaceId, snapshot) => {
    if (!snapshot || typeof snapshot !== "object") return;
    const snapshotRepoPath = graphSnapshotRepoPath(snapshot);
    const snapshotWorkspaceId = graphSnapshotWorkspaceId(snapshot);
    const key = workspaceGraphStateKey(
      repoPath || snapshotRepoPath,
      workspaceId || snapshotWorkspaceId,
    ) || workspaceGraphSnapshotKey(snapshot);
    if (!key) return;

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
          architectureSnapshot: snapshot,
          architectureState: graphSnapshotSyncState(snapshot, "empty"),
          architectureError: graphSnapshotSyncError(snapshot),
          architectureUpdatedAt: Date.now(),
        };
      });
      workspaceGraphStateRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    clearWorkspaceThreadsBrowserPersistence();
  }, []);

  useEffect(() => {
    // Dispatcher ownership lease: while the webview heartbeats it owns todo
    // dispatch; when the heartbeat stops (hidden/destroyed window in
    // background mode), the Rust background dispatcher takes over.
    const beat = () => {
      void invoke("todo_dispatch_dispatcher_heartbeat").catch(() => {});
    };
    beat();
    const intervalId = window.setInterval(beat, 5000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  useEffect(() => {
    const targets = workspaceThreadStoreTargets;
    const storeKey = workspaceThreadStoreKey;

    if (workspaceActivationDeferred) {
      logWorkspaceActivationTrace("workspace.open.threads_hydration.skip", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
        reason: "activation_deferred",
        targetCount: targets.length,
        workspaceActivationDeferred,
      });
      return undefined;
    }

    if (!workspaceHydrationReady) {
      logWorkspaceActivationTrace("workspace.open.threads_hydration.skip", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
        reason: "hydration_not_ready",
        targetCount: targets.length,
        workspaceHydrationReady,
      });
      workspaceThreadsHydratedKeyRef.current = "";
      workspaceThreadsPersistenceReadyRef.current = false;
      workspaceThreadsLastPersistedRef.current = {};
      setWorkspaceThreadsHydratedKey("");
      return undefined;
    }

    if (!targets.length) {
      logWorkspaceActivationTrace("workspace.open.threads_hydration.empty", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
        storeKey,
      });
      workspaceThreadsHydratedKeyRef.current = storeKey;
      workspaceThreadsPersistenceReadyRef.current = Boolean(workspaces.length === 0);
      workspaceThreadsLastPersistedRef.current = {};
      setWorkspaceThreadsHydratedKey(storeKey);
      return undefined;
    }

    if (workspaceThreadsHydratedKeyRef.current === storeKey) {
      logWorkspaceActivationTrace("workspace.open.threads_hydration.cached", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
        storeKey,
        targetCount: targets.length,
      });
      workspaceThreadsPersistenceReadyRef.current = true;
      setWorkspaceThreadsHydratedKey(storeKey);
      return undefined;
    }

    let disposed = false;
    const startedAtMs = getWorkspaceActivationDiagnosticNowMs();
    workspaceThreadsPersistenceReadyRef.current = false;
    setWorkspaceThreadsHydratedKey((currentKey) => (currentKey === storeKey ? currentKey : ""));
    logWorkspaceActivationTrace("workspace.open.threads_hydration.start", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
      storeKey,
      targetCount: targets.length,
      targets: targets.map((target) => ({
        rootDirectory: target.rootDirectory,
        terminalCount: target.terminalCount,
        workspaceId: target.workspaceId,
      })),
    });

    invoke("workspace_threads_read", {
      request: { workspaces: targets },
    })
      .then((result) => {
        if (disposed) {
          return;
        }
        const loadedThreads = normalizeWorkspaceThreads(result?.threads || {}, {
          stripLiveBindings: true,
        });
        workspaceThreadsLastPersistedRef.current = persistWorkspaceThreads(loadedThreads);
        logWorkspaceActivationTrace("workspace.open.threads_hydration.done", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
          elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - startedAtMs),
          loadedWorkspaceCount: Object.keys(loadedThreads).length,
          storeKey,
          targetCount: targets.length,
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
        workspaceThreadsLastPersistedRef.current = {};
        workspaceThreadsHydratedKeyRef.current = storeKey;
        workspaceThreadsPersistenceReadyRef.current = true;
        setWorkspaceThreadsHydratedKey(storeKey);
        logWorkspaceActivationTrace("workspace.open.threads_hydration.error", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
          elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - startedAtMs),
          message: getErrorMessage(error, "Unable to load workspace threads from SQLite."),
          storeKey,
          targetCount: targets.length,
        });
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
    workspaceHydrationReady,
    workspaceActivationDeferred,
    logWorkspaceActivationTrace,
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
    workspaceGraphStateRef.current = workspaceGraphState;
  }, [workspaceGraphState]);

  useEffect(() => {
    activatedWorkspaceIdRef.current = activatedWorkspaceId;
  }, [activatedWorkspaceId]);

  useEffect(() => {
    workspacePendingActivationIdRef.current = workspacePendingActivationId;
  }, [workspacePendingActivationId]);

  useEffect(() => {
    activeViewRef.current = activeView;
  }, [activeView]);

  useEffect(() => {
    visibleViewRef.current = visibleView;
  }, [visibleView]);

  useEffect(() => {
    mainWindowFocusedRef.current = mainWindowFocused;
  }, [mainWindowFocused]);

  useEffect(() => {
    let cancelled = false;
    let unlistenFocusChanged = null;
    const currentWindow = getCurrentWindow();

    const applyFocused = (focused) => {
      const nextFocused = Boolean(focused)
        && (typeof document === "undefined" || document.visibilityState !== "hidden");
      mainWindowFocusedRef.current = nextFocused;
      if (!cancelled) {
        setMainWindowFocused(nextFocused);
      }
    };

    const refreshFocusedFromDocument = () => {
      applyFocused(readMainWindowFocusedFallback());
    };

    const handleWindowFocus = () => {
      applyFocused(true);
    };
    const handleWindowBlur = () => {
      applyFocused(false);
    };

    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", refreshFocusedFromDocument);
    refreshFocusedFromDocument();

    currentWindow
      .onFocusChanged((event) => {
        applyFocused(event?.payload === true);
      })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenFocusChanged = unlisten;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", refreshFocusedFromDocument);
      if (typeof unlistenFocusChanged === "function") {
        unlistenFocusChanged();
      }
    };
  }, []);

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

    workspaceThreadsPersistPendingRef.current = {
      targets,
      workspaceThreads,
    };

    let disposed = false;
    const flushPersist = () => {
      workspaceThreadsPersistTimerRef.current = 0;
      if (disposed) {
        return;
      }
      const hotDelayMs = getTerminalInputHotDelayMs(1200);
      if (hotDelayMs > 0) {
        workspaceThreadsPersistTimerRef.current = window.setTimeout(flushPersist, hotDelayMs);
        return;
      }
      if (workspaceThreadsPersistInFlightRef.current) {
        workspaceThreadsPersistTimerRef.current = window.setTimeout(flushPersist, 1000);
        return;
      }
      const pending = workspaceThreadsPersistPendingRef.current;
      if (!pending) {
        return;
      }
      workspaceThreadsPersistPendingRef.current = null;
      const { normalizedThreads, request } = buildWorkspaceThreadsPersistDelta(
        pending.workspaceThreads,
        workspaceThreadsLastPersistedRef.current,
        pending.targets,
      );
      if (!request.workspaces.length) {
        return;
      }
      workspaceThreadsPersistInFlightRef.current = true;
      invoke("workspace_threads_persist_delta", {
        request,
      }).then(() => {
        workspaceThreadsLastPersistedRef.current = normalizedThreads;
      }).catch((error) => {
        logThreadBridgeDiagnosticEvent("frontend.workspace_threads_sqlite_persist.failed", {
          message: getErrorMessage(error, "Unable to persist workspace threads to SQLite."),
          workspaceCount: request.workspaces.length,
        });
      }).finally(() => {
        workspaceThreadsPersistInFlightRef.current = false;
        if (workspaceThreadsPersistPendingRef.current && !disposed) {
          workspaceThreadsPersistTimerRef.current = window.setTimeout(flushPersist, 1000);
        }
      });
    };

    if (workspaceThreadsPersistTimerRef.current) {
      window.clearTimeout(workspaceThreadsPersistTimerRef.current);
    }
    workspaceThreadsPersistTimerRef.current = window.setTimeout(flushPersist, 1200);

    return () => {
      disposed = true;
      if (workspaceThreadsPersistTimerRef.current) {
        window.clearTimeout(workspaceThreadsPersistTimerRef.current);
        workspaceThreadsPersistTimerRef.current = 0;
      }
    };
  }, [
    defaultWorkingDirectory,
    getTerminalInputHotDelayMs,
    workspaceSettings,
    workspaceThreads,
    workspaces,
  ]);

  useEffect(() => {
    persistWorkspaceNotifications(workspaceNotifications);
  }, [workspaceNotifications]);

  useEffect(() => {
    const sfx = getSharedNotificationSfx();
    workspaceNotificationSfxRef.current = sfx;
    const unlock = () => {
      sfx.unlock();
    };

    window.addEventListener("keydown", unlock, { passive: true });
    window.addEventListener("pointerdown", unlock, { passive: true });

    return () => {
      window.removeEventListener("keydown", unlock);
      window.removeEventListener("pointerdown", unlock);
      disposeSharedNotificationSfx();
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
      // Approval/user-input native notifications are sent from Rust at the
      // activity-hook source (todo_dispatch_observe_activity_hook), so they
      // also fire with no visible window; the webview keeps only the SFX cue.
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
    let disposed = false;
    let unlistenCaptureSaved = null;
    listen("forge-snipping-capture-saved", () => {
      playNotificationSfx("snip.captured");
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
      } else {
        unlistenCaptureSaved = unlisten;
      }
    }).catch(() => {});
    return () => {
      disposed = true;
      unlistenCaptureSaved?.();
    };
  }, []);

  useEffect(() => {
    if (
      !selectedWorkspaceId
      || activeView !== DEFAULT_WORKSPACE_VIEW
      || visibleView !== DEFAULT_WORKSPACE_VIEW
      || !mainWindowFocused
    ) {
      return;
    }

    setWorkspaceNotifications((current) => markWorkspaceNotificationsSeen(current, selectedWorkspaceId));
  }, [activeView, mainWindowFocused, selectedWorkspaceId, visibleView]);

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
          workspaceNotificationReducerOptions(target.workspaceId, {
            suppressCue: true,
          }),
        ));
      }).catch(() => {
        // Snapshot reconciliation is opportunistic; live events still keep the rail responsive.
      });
    });

    return () => {
      cancelled = true;
    };
  }, [workspaceNotificationReducerOptions, workspaceNotificationRoots]);

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
        workspaceNotificationReducerOptions(workspaceId),
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
  }, [workspaceNotificationReducerOptions, workspaceNotificationRoots]);

  useEffect(() => {
    let unlistenParkedPrompt = null;
    let cancelled = false;

    listen(TERMINAL_PARKED_PROMPT_EVENT, (parkedEvent) => {
      const payload = parkedEvent?.payload || {};
      const workspaceId = String(
        payload.workspaceId
          || payload.workspace_id
          || activatedWorkspaceIdRef.current
          || selectedWorkspaceIdRef.current
          || "",
      ).trim();
      if (!workspaceId) {
        return;
      }
      const parkedStatus = String(payload.status || payload.activityStatus || payload.activity_status || "").trim().toLowerCase();
      const terminalIndex = Number.parseInt(payload.terminalIndex ?? payload.terminal_index ?? 0, 10);
      const terminalPaused = ["parked", "resume_ready"].includes(parkedStatus);
      const terminalResuming = ["resume_requested", "resumed"].includes(parkedStatus);
      const terminalStopped = ["cancelled", "canceled", "interrupted"].includes(parkedStatus);
      if (terminalPaused || terminalResuming || terminalStopped) {
        terminalStatusEventEmitterRef.current?.({
          activityStatus: terminalPaused ? "paused" : terminalResuming ? "thinking" : "idle",
          commandPhase: terminalPaused ? parkedStatus : terminalResuming ? "running" : parkedStatus,
          executionPhase: terminalPaused ? parkedStatus : terminalResuming ? "running" : parkedStatus,
          inputReady: terminalStopped,
          instanceId: payload.instanceId || payload.instance_id || undefined,
          nativeRailLabel: terminalPaused ? "paused" : terminalResuming ? "thinking" : "idle",
          nativeRailState: terminalPaused ? "paused" : terminalResuming ? "thinking" : "idle",
          paneId: payload.paneId || payload.pane_id || "",
          parked: terminalPaused,
          clearsParked: terminalResuming || terminalStopped,
          parkedPromptTitle: payload.title || "",
          readiness: terminalPaused ? "needs_input" : terminalResuming ? "busy" : "ready",
          source: `terminal-parked-${parkedStatus || "status"}`,
          status: terminalPaused ? "paused" : terminalResuming ? "active" : "active",
          terminalIndex: Number.isInteger(terminalIndex) && terminalIndex >= 0 ? terminalIndex : 0,
          terminalIsParked: terminalPaused,
          threadId: payload.threadId || payload.thread_id || "",
          turnStatus: terminalPaused ? "pending" : terminalResuming ? "running" : parkedStatus,
          type: "agent-output",
          waitingOn: Array.isArray(payload.waitingOn || payload.waiting_on)
            ? (payload.waitingOn || payload.waiting_on)
            : [],
          workspaceId,
          workspaceName: payload.workspaceName || payload.workspace_name || "",
        }, {
          activityStatus: terminalPaused ? "paused" : terminalResuming ? "thinking" : "idle",
          commandPhase: terminalPaused ? parkedStatus : terminalResuming ? "running" : parkedStatus,
          executionPhase: terminalPaused ? parkedStatus : terminalResuming ? "running" : parkedStatus,
          reason: `terminal-parked-${parkedStatus || "status"}`,
          readiness: terminalPaused ? "needs_input" : terminalResuming ? "busy" : "ready",
          status: terminalPaused ? "paused" : terminalResuming ? "thinking" : "idle",
          terminalIndex: Number.isInteger(terminalIndex) && terminalIndex >= 0 ? terminalIndex : 0,
          turnStatus: terminalPaused ? "pending" : terminalResuming ? "running" : parkedStatus,
        });
      }
      setWorkspaceNotifications((current) => reduceTerminalParkedNotificationEvent(
        current,
        {
          ...payload,
          workspaceId,
        },
        workspaceNotificationReducerOptions(workspaceId),
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
  }, [workspaceNotificationReducerOptions]);

  useEffect(() => {
    // TerminalView dispatches this only when a todo finished on a terminal the
    // user is not watching; the cue plays the SFX and flashes the workspace
    // rail row, and the unread notification keeps the rail badge lit.
    const handleTodoCompleted = (event) => {
      const detail = event?.detail || {};
      const workspaceId = String(detail.workspaceId || "").trim();
      if (!workspaceId) {
        return;
      }
      setWorkspaceNotifications((current) => reduceTodoCompletedNotificationEvent(
        current,
        detail,
        workspaceNotificationReducerOptions(workspaceId),
      ));
    };
    window.addEventListener(TODO_COMPLETED_NOTIFICATION_EVENT, handleTodoCompleted);
    return () => {
      window.removeEventListener(TODO_COMPLETED_NOTIFICATION_EVENT, handleTodoCompleted);
    };
  }, [workspaceNotificationReducerOptions]);

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

  const updateCloudWorkspaceProgress = useCallback((progress) => {
    setCloudWorkspaceProgress((current) => normalizeCloudWorkspaceProgress(progress, current));
  }, []);

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
    if (options.clearSession !== false) {
      void syncCloudMcpDesktopSessionToken("");
    }
    setActiveView(DEFAULT_WORKSPACE_VIEW);
    setVisibleView(DEFAULT_WORKSPACE_VIEW);
    setViewMotion("entered");
    setWorkspaceState("idle");
    setWorkspaces([]);
    setSelectedWorkspaceId("");
    setActivatedWorkspaceId("");
    setWorkspaceSyncState("idle");
    setWorkspaceListHydrated(false);
    setWorkspaceHydrationReady(false);
    setWorkspaceName("");
    setWorkspaceNameDraft("");
    setWorkspaceTerminalCountDraft("1");
    setWorkspaceTerminalRolesDraft(["codex"]);
    setWorkspaceAgentSessionModeDraft(AGENT_SESSION_MODE_COORDINATED);
    setWorkspaceUnsafeModeArmed(false);
    setWorkspaceRootDraft("");
    setWorkspaceSettingsState("idle");
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
    setWorkspaceSettingsModalId("");
    setWorkspaceTerminalLogicalIndexes({});
    setWorkspaceTerminalDisplayLayouts({});
    setCloudWorkspaceProgress(CLOUD_WORKSPACE_PROGRESS_INITIAL_STATE);
    agentInitialStatusUserRef.current = "";
    terminalPresenceSyncKeyRef.current = "";
    workspaceMcpSyncKeyRef.current = "";
    workspaceCatalogSyncKeyRef.current = "";
    workspaceCloudSyncKeyRef.current = "";
    tokenomicsSyncCursorRef.current = "";
    tokenomicsSyncInFlightRef.current = false;
    tokenomicsSyncPendingRefreshRef.current = false;
    tokenomicsForceResyncRef.current = null;
    startupAgentFlowIdRef.current += 1;
    startupAgentSettingsPendingRef.current = false;
    setStartupAgentGateState("idle");
    setStartupAgentUpdateMessage("");
    setWorkspaceError("");
  }, []);

  const expireDesktopSession = useCallback((error) => {
    setSignedOut(
      "Your desktop session expired. Sign in again with the web app.",
      getErrorMessage(error, "Desktop session expired."),
      { clearPending: true },
    );
  }, [setSignedOut]);

  const setAuthenticated = useCallback((sessionUser, options = {}) => {
    const isPaid = isPaidUser(sessionUser);

    authStore.setAuthenticated(
      sessionUser,
      isPaid ? "Initializing workspace..." : "Upgrade to unlock the desktop workspace.",
    );
    if (isPaid) {
      updateCloudWorkspaceProgress({
        detail: "Passing your signed-in session to the cloud runtime.",
        stage: "desktop_session",
        status: "active",
        title: "Preparing cloud workspace",
      });
    } else {
      setCloudWorkspaceProgress(CLOUD_WORKSPACE_PROGRESS_INITIAL_STATE);
    }
    if (options.syncCloud !== false) {
      void syncCloudMcpDesktopSessionToken(authStore.getToken(), {
        ...cloudMcpBillingEntitlementPayload(billingStatusRef.current, sessionUser),
        onProgress: isPaid ? updateCloudWorkspaceProgress : undefined,
      });
    }
    terminalPresenceSyncKeyRef.current = "";
    workspaceMcpSyncKeyRef.current = "";
    workspaceCatalogSyncKeyRef.current = "";
    workspaceCloudSyncKeyRef.current = "";
    tokenomicsSyncCursorRef.current = "";
    tokenomicsSyncInFlightRef.current = false;
    tokenomicsSyncPendingRefreshRef.current = false;
    tokenomicsForceResyncRef.current = null;
    setActiveView(DEFAULT_WORKSPACE_VIEW);
    setVisibleView(DEFAULT_WORKSPACE_VIEW);
    setViewMotion("entered");
    setWorkspaceState(isPaid ? "initializing" : "billingRequired");
    setWorkspaceSyncState("idle");
    setWorkspaceListHydrated(!isPaid);
    setWorkspaceHydrationReady(false);
    setSelectedWorkspaceId("");
    setActivatedWorkspaceId("");
    setWorkspacePendingActivationId("");
    workspacePendingActivationIdRef.current = "";
    setWorkspaceNameDraft("");
    setWorkspaceTerminalCountDraft("1");
    setWorkspaceTerminalRolesDraft(["codex"]);
    setWorkspaceAgentSessionModeDraft(AGENT_SESSION_MODE_COORDINATED);
    setWorkspaceUnsafeModeArmed(false);
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
  }, [updateCloudWorkspaceProgress]);

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
    activeViewRef.current = nextView;

    if (options.immediate || options.skipTransition || options.transitionMs === 0) {
      setVisibleView(nextView);
      visibleViewRef.current = nextView;
      setViewMotion("entered");
      return;
    }

    setViewMotion("exiting");
    viewTransitionTimeoutRef.current = window.setTimeout(() => {
      setVisibleView(nextView);
      visibleViewRef.current = nextView;
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

  const handleAccountScopeChange = useCallback((event) => {
    const nextKey = event.target.value;
    const nextScope = accountScopes.find((scope) => accountScopeKey(scope) === nextKey);

    if (!nextScope || accountScopeKey(nextScope) === activeAccountScopeKey) {
      return;
    }

    authStore.setActiveScope(nextScope);
  }, [accountScopes, activeAccountScopeKey]);

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
      'a, button, input, select, textarea, [role="button"], [data-rail-interactive="true"], [data-rail-selection-preserve="true"]',
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

  const cancelDeferredWorkspaceActivation = useCallback(() => {
    const pending = deferredWorkspaceActivationRef.current;

    if (pending.workspaceId) {
      logWorkspaceActivationTrace("workspace.open.deferred_cancel", pending.workspaceId, {
        hasFrame: Boolean(pending.frame),
        hasIdle: Boolean(pending.idle),
        hasSecondFrame: Boolean(pending.secondFrame),
        hasTimeout: Boolean(pending.timeout),
        token: pending.token,
      });
    }

    if (pending.frame) {
      window.cancelAnimationFrame(pending.frame);
    }
    if (pending.secondFrame) {
      window.cancelAnimationFrame(pending.secondFrame);
    }
    if (pending.idle && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(pending.idle);
    }
    if (pending.timeout) {
      window.clearTimeout(pending.timeout);
    }

    deferredWorkspaceActivationRef.current = {
      frame: 0,
      idle: 0,
      secondFrame: 0,
      timeout: 0,
      token: pending.token,
      workspaceId: "",
    };
  }, [logWorkspaceActivationTrace]);

  const activateWorkspace = useCallback((workspaceId, source = "manual", trace = null) => {
    const workspace = findWorkspaceById(workspaces, workspaceId);
    const safeWorkspaceId = String(workspaceId || "").trim();

    if (workspaceDeactivationInFlightRef.current) {
      logWorkspaceActivationTrace("workspace.open.activate.blocked", safeWorkspaceId, {
        reason: "workspace_deactivation_in_flight",
        source,
        workspaceDeactivationInFlight: workspaceDeactivationInFlightRef.current,
      }, { trace });
      return false;
    }

    if (!workspace) {
      logWorkspaceActivationTrace("workspace.open.activate.blocked", safeWorkspaceId, {
        availableWorkspaceCount: workspaces.length,
        reason: "workspace_not_found",
        source,
      }, { trace });
      return false;
    }

    const activeTrace = workspaceActivationStartedAtRef.current.get(workspace.id)
      ? null
      : beginWorkspaceActivationTrace(workspace.id, source);
    const startedAtMs = getWorkspaceActivationDiagnosticNowMs();
    const previousActivatedWorkspaceId = activatedWorkspaceIdRef.current;
    const enabledWorkspaceIds = normalizeEnabledWorkspaceIds(
      workspaceLifecycleSettingsRef.current?.enabledWorkspaceIds,
    );

    logWorkspaceActivationTrace("workspace.open.activate.begin", workspace.id, {
      enabledWorkspaceCount: enabledWorkspaceIds.length,
      previousActivatedWorkspaceId,
      source,
      workspaceName: workspace.name || "",
    }, { trace: trace || activeTrace });

    setSelectedWorkspaceId(workspace.id);
    selectedWorkspaceIdRef.current = workspace.id;
    setActivatedWorkspaceId(workspace.id);
    activatedWorkspaceIdRef.current = workspace.id;
    setWorkspacePendingActivationId("");
    workspacePendingActivationIdRef.current = "";
    updateWorkspaceLifecycleSettings({
      enabledWorkspaceIds: enabledWorkspaceIds.includes(workspace.id)
        ? enabledWorkspaceIds
        : [...enabledWorkspaceIds, workspace.id],
    });

    if (previousActivatedWorkspaceId !== workspace.id) {
      workspaceAgentLaunchKeyRef.current = "";
      workspaceAgentBatchInFlightKeyRef.current = "";
      workspaceAgentBatchStartedSessionKeysRef.current.clear();
      workspaceAgentBatchInFlightSessionKeysRef.current.clear();
      setWorkspaceAgentBatchSentLaunchKey("");
    }

    logWorkspaceActivationTrace("workspace.open.activate.committed", workspace.id, {
      elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - startedAtMs),
      enabledWorkspaceCountAfter: enabledWorkspaceIds.includes(workspace.id)
        ? enabledWorkspaceIds.length
        : enabledWorkspaceIds.length + 1,
      previousActivatedWorkspaceId,
      source,
      workspaceName: workspace.name || "",
    }, { trace: trace || activeTrace });

    return true;
  }, [
    beginWorkspaceActivationTrace,
    logWorkspaceActivationTrace,
    setWorkspaceAgentBatchSentLaunchKey,
    updateWorkspaceLifecycleSettings,
    workspaces,
  ]);

  const scheduleWorkspaceActivationAfterPaint = useCallback((workspaceId, source = "workspace_activation", trace = null) => {
    const safeWorkspaceId = String(workspaceId || "").trim();
    if (!safeWorkspaceId) {
      return;
    }

    cancelDeferredWorkspaceActivation();

    const token = deferredWorkspaceActivationRef.current.token + 1;
    const scheduledAtMs = getWorkspaceActivationDiagnosticNowMs();
    deferredWorkspaceActivationRef.current = {
      frame: 0,
      idle: 0,
      secondFrame: 0,
      timeout: 0,
      token,
      workspaceId: safeWorkspaceId,
    };
    logWorkspaceActivationTrace("workspace.open.deferred_schedule", safeWorkspaceId, {
      source,
      token,
    }, { trace });

    const runActivation = () => {
      const current = deferredWorkspaceActivationRef.current;
      if (current.token !== token || current.workspaceId !== safeWorkspaceId) {
        logWorkspaceActivationTrace("workspace.open.deferred_stale", safeWorkspaceId, {
          currentToken: current.token,
          currentWorkspaceId: current.workspaceId,
          expectedToken: token,
          source,
        }, { trace });
        return;
      }
      deferredWorkspaceActivationRef.current = {
        frame: 0,
        idle: 0,
        secondFrame: 0,
        timeout: 0,
        token,
        workspaceId: "",
      };

      setWorkspacePendingActivationId((currentPendingId) => (
        currentPendingId === safeWorkspaceId ? "" : currentPendingId
      ));
      if (workspacePendingActivationIdRef.current === safeWorkspaceId) {
        workspacePendingActivationIdRef.current = "";
      }

      if (selectedWorkspaceIdRef.current !== safeWorkspaceId) {
        logWorkspaceActivationTrace("workspace.open.deferred_selection_changed", safeWorkspaceId, {
          elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - scheduledAtMs),
          selectedWorkspaceId: selectedWorkspaceIdRef.current,
          source,
          token,
        }, { trace });
        return;
      }

      logWorkspaceActivationTrace("workspace.open.deferred_run", safeWorkspaceId, {
        elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - scheduledAtMs),
        source,
        token,
      }, { trace });
      activateWorkspace(safeWorkspaceId, source, trace);
    };

    const scheduleIdleActivation = () => {
      const current = deferredWorkspaceActivationRef.current;
      if (current.token !== token || current.workspaceId !== safeWorkspaceId) {
        logWorkspaceActivationTrace("workspace.open.deferred_idle_stale", safeWorkspaceId, {
          currentToken: current.token,
          currentWorkspaceId: current.workspaceId,
          expectedToken: token,
          source,
        }, { trace });
        return;
      }

      if (typeof window.requestIdleCallback === "function") {
        const idle = window.requestIdleCallback(runActivation, { timeout: 80 });
        deferredWorkspaceActivationRef.current = {
          ...current,
          idle,
          secondFrame: 0,
        };
        logWorkspaceActivationTrace("workspace.open.deferred_idle_scheduled", safeWorkspaceId, {
          elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - scheduledAtMs),
          source,
          strategy: "requestIdleCallback",
          token,
        }, { trace });
        return;
      }

      const timeout = window.setTimeout(runActivation, 0);
      deferredWorkspaceActivationRef.current = {
        ...current,
        secondFrame: 0,
        timeout,
      };
      logWorkspaceActivationTrace("workspace.open.deferred_idle_scheduled", safeWorkspaceId, {
        elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - scheduledAtMs),
        source,
        strategy: "setTimeout",
        token,
      }, { trace });
    };

    const frame = window.requestAnimationFrame(() => {
      const current = deferredWorkspaceActivationRef.current;
      if (current.token !== token || current.workspaceId !== safeWorkspaceId) {
        logWorkspaceActivationTrace("workspace.open.deferred_frame_stale", safeWorkspaceId, {
          currentToken: current.token,
          currentWorkspaceId: current.workspaceId,
          expectedToken: token,
          source,
        }, { trace });
        return;
      }

      logWorkspaceActivationTrace("workspace.open.deferred_first_frame", safeWorkspaceId, {
        elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - scheduledAtMs),
        source,
        token,
      }, { trace });
      const secondFrame = window.requestAnimationFrame(scheduleIdleActivation);
      deferredWorkspaceActivationRef.current = {
        ...current,
        frame: 0,
        secondFrame,
      };
    });

    deferredWorkspaceActivationRef.current = {
      ...deferredWorkspaceActivationRef.current,
      frame,
    };
  }, [activateWorkspace, cancelDeferredWorkspaceActivation, logWorkspaceActivationTrace]);

  const scheduleWorkspaceActiveSwitchAfterPaint = useCallback((workspaceId, source = "workspace_switch", trace = null, fields = {}) => {
    const safeWorkspaceId = String(workspaceId || "").trim();
    if (!safeWorkspaceId) {
      return;
    }

    cancelDeferredWorkspaceActivation();

    const token = deferredWorkspaceActivationRef.current.token + 1;
    const scheduledAtMs = getWorkspaceActivationDiagnosticNowMs();
    deferredWorkspaceActivationRef.current = {
      frame: 0,
      idle: 0,
      secondFrame: 0,
      timeout: 0,
      token,
      workspaceId: safeWorkspaceId,
    };
    setWorkspacePendingActivationId(safeWorkspaceId);
    workspacePendingActivationIdRef.current = safeWorkspaceId;
    logWorkspaceActivationTrace("workspace.open.active_runtime_switch_pending_set", safeWorkspaceId, {
      ...fields,
      source,
      token,
    }, { trace });

    const finishSwitch = () => {
      const current = deferredWorkspaceActivationRef.current;
      if (current.token !== token || current.workspaceId !== safeWorkspaceId) {
        logWorkspaceActivationTrace("workspace.open.active_runtime_switch_stale", safeWorkspaceId, {
          ...fields,
          currentToken: current.token,
          currentWorkspaceId: current.workspaceId,
          expectedToken: token,
          source,
        }, { trace });
        return;
      }

      deferredWorkspaceActivationRef.current = {
        frame: 0,
        idle: 0,
        secondFrame: 0,
        timeout: 0,
        token,
        workspaceId: "",
      };
      setWorkspacePendingActivationId((currentPendingId) => (
        currentPendingId === safeWorkspaceId ? "" : currentPendingId
      ));
      if (workspacePendingActivationIdRef.current === safeWorkspaceId) {
        workspacePendingActivationIdRef.current = "";
      }

      logWorkspaceActivationTrace("workspace.open.active_runtime_switch_done", safeWorkspaceId, {
        ...fields,
        elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - scheduledAtMs),
        source,
        token,
      }, { trace, force: true });
    };

    const frame = window.requestAnimationFrame(() => {
      const current = deferredWorkspaceActivationRef.current;
      if (current.token !== token || current.workspaceId !== safeWorkspaceId) {
        logWorkspaceActivationTrace("workspace.open.active_runtime_switch_frame_stale", safeWorkspaceId, {
          ...fields,
          currentToken: current.token,
          currentWorkspaceId: current.workspaceId,
          expectedToken: token,
          source,
        }, { trace });
        return;
      }

      logWorkspaceActivationTrace("workspace.open.active_runtime_switch_first_frame", safeWorkspaceId, {
        ...fields,
        elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - scheduledAtMs),
        openingMs: WORKSPACE_ACTIVE_SWITCH_OPENING_MS,
        source,
        token,
      }, { trace });
      const timeout = window.setTimeout(finishSwitch, WORKSPACE_ACTIVE_SWITCH_OPENING_MS);
      deferredWorkspaceActivationRef.current = {
        ...current,
        frame: 0,
        timeout,
      };
    });

    deferredWorkspaceActivationRef.current = {
      ...deferredWorkspaceActivationRef.current,
      frame,
    };
  }, [cancelDeferredWorkspaceActivation, logWorkspaceActivationTrace]);

  const requestWorkspaceActivation = useCallback((workspaceId, source = "manual") => {
    const workspace = findWorkspaceById(workspaces, workspaceId);
    const safeWorkspaceId = String(workspaceId || "").trim();

    if (workspaceDeactivationInFlightRef.current) {
      logWorkspaceActivationTrace("workspace.open.activation_request_blocked", safeWorkspaceId, {
        reason: "workspace_deactivation_in_flight",
        source,
        workspaceDeactivationInFlight: workspaceDeactivationInFlightRef.current,
      });
      return false;
    }

    if (!workspace) {
      logWorkspaceActivationTrace("workspace.open.activation_request_blocked", safeWorkspaceId, {
        availableWorkspaceCount: workspaces.length,
        reason: "workspace_not_found",
        source,
      });
      return false;
    }

    const trace = beginWorkspaceActivationTrace(workspace.id, source);
    const previousSelectedWorkspaceId = selectedWorkspaceIdRef.current;
    const previousActivatedWorkspaceId = activatedWorkspaceIdRef.current;
    const previousPendingActivationId = workspacePendingActivationIdRef.current;
    const activeWorkspaceIds = normalizeEnabledWorkspaceIds(
      workspaceLifecycleSettingsRef.current?.enabledWorkspaceIds,
    );
    const activeRuntimeWorkspaceIds = normalizeEnabledWorkspaceIds([
      ...activeWorkspaceIds,
      previousActivatedWorkspaceId,
    ]);
    const workspaceAlreadyActive = activeWorkspaceIds.includes(workspace.id)
      || previousActivatedWorkspaceId === workspace.id;
    const transitionKind = workspaceAlreadyActive
      ? previousSelectedWorkspaceId === workspace.id
        ? "reselect_active_runtime"
        : "switch_active_runtime"
      : "activate_inactive_runtime";
    logWorkspaceActivationTrace("workspace.open.activation_requested", workspace.id, {
      alreadyActive: workspaceAlreadyActive,
      activeRuntimeWorkspaceCount: activeRuntimeWorkspaceIds.length,
      activeRuntimeWorkspaceIds,
      previousActivatedWorkspaceId,
      previousPendingActivationId,
      previousSelectedWorkspaceId,
      selectedWorkspaceId: previousSelectedWorkspaceId,
      source,
      transitionKind,
      workspaceName: workspace.name || "",
    }, { trace });

    setSelectedWorkspaceId(workspace.id);
    selectedWorkspaceIdRef.current = workspace.id;
    setWorkspaceSettingsModalId("");
    showView(DEFAULT_WORKSPACE_VIEW, {
      immediate: true,
      telemetrySource: `${source}_workspace_activation`,
      telemetryWorkspaceId: workspace.id,
    });

    if (workspaceAlreadyActive) {
      const clearedPendingActivationId = workspacePendingActivationIdRef.current;
      const activeSwitchFields = {
        activeRuntimeWorkspaceCount: activeRuntimeWorkspaceIds.length,
        activeRuntimeWorkspaceIds,
        clearedPendingActivationId,
        previousActivatedWorkspaceId,
        previousSelectedWorkspaceId,
        transitionKind,
        workspaceName: workspace.name || "",
      };
      if (transitionKind === "switch_active_runtime") {
        scheduleWorkspaceActiveSwitchAfterPaint(workspace.id, source, trace, activeSwitchFields);
        return true;
      }

      cancelDeferredWorkspaceActivation();
      setWorkspacePendingActivationId("");
      workspacePendingActivationIdRef.current = "";
      logWorkspaceActivationTrace("workspace.open.active_runtime_switch_done", workspace.id, {
        ...activeSwitchFields,
        elapsedMs: 0,
        source,
      }, { trace, force: true });
      return true;
    }

    setWorkspacePendingActivationId(workspace.id);
    workspacePendingActivationIdRef.current = workspace.id;
    logWorkspaceActivationTrace("workspace.open.pending_activation_set", workspace.id, {
      source,
      transitionKind,
    }, { trace });
    scheduleWorkspaceActivationAfterPaint(workspace.id, source, trace);
    return true;
  }, [
    beginWorkspaceActivationTrace,
    cancelDeferredWorkspaceActivation,
    logWorkspaceActivationTrace,
    scheduleWorkspaceActivationAfterPaint,
    scheduleWorkspaceActiveSwitchAfterPaint,
    showView,
    workspaces,
  ]);

  const selectWorkspaceFromRail = useCallback((workspaceId) => {
    const workspace = findWorkspaceById(workspaces, workspaceId);
    if (!workspace) {
      logWorkspaceActivationTrace("workspace.open.rail_select_missing", workspaceId, {
        availableWorkspaceCount: workspaces.length,
      });
      return;
    }

    const workspaceRoot = getWorkspaceRootDirectory(workspaceSettingsRef.current, workspace.id)
      || defaultWorkingDirectoryRef.current
      || "";
    const activeWorkspaceIds = normalizeEnabledWorkspaceIds(
      workspaceLifecycleSettingsRef.current?.enabledWorkspaceIds,
    );
    const activeRuntimeWorkspaceIds = normalizeEnabledWorkspaceIds([
      ...activeWorkspaceIds,
      activatedWorkspaceIdRef.current,
    ]);
    const workspaceAlreadyActive = activeRuntimeWorkspaceIds.includes(workspace.id);
    const transitionKind = workspaceAlreadyActive
      ? selectedWorkspaceIdRef.current === workspace.id
        ? "reselect_active_runtime"
        : "switch_active_runtime"
      : "activate_inactive_runtime";
    logWorkspaceActivationTrace("workspace.open.rail_select", workspace.id, {
      activeRuntimeWorkspaceCount: activeRuntimeWorkspaceIds.length,
      activeRuntimeWorkspaceIds,
      alreadyActive: workspaceAlreadyActive,
      pendingActivationId: workspacePendingActivationIdRef.current,
      previousSelectedWorkspaceId: selectedWorkspaceIdRef.current,
      rootDirectory: workspaceRoot,
      selectedWorkspaceId: selectedWorkspaceIdRef.current,
      transitionKind,
      workspaceName: workspace.name || "",
    });
    setWorkspaceNotifications((current) => markWorkspaceNotificationsSeen(current, workspaceId));
    requestWorkspaceActivation(workspace.id, "workspace_rail");
  }, [
    logWorkspaceActivationTrace,
    requestWorkspaceActivation,
    workspaces,
  ]);

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
    workspaceAgentBatchStartedSessionKeysRef.current.clear();
    workspaceAgentBatchInFlightSessionKeysRef.current.clear();
    setWorkspaceAgentBatchSentLaunchKey("");

    try {
      unlistenCloseProgress = await listen(TERMINAL_CLOSE_ALL_PROGRESS_EVENT, (progressEvent) => {
        const nextProgress = normalizeTerminalCloseProgress(progressEvent.payload);

        setWorkspaceDeactivationState((currentState) => {
          if (!currentState.isActive || currentState.workspaceId !== targetWorkspaceId) {
            return currentState;
          }
          if (nextProgress.workspaceId && nextProgress.workspaceId !== targetWorkspaceId) {
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
          workspaceId: targetWorkspaceId,
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
        const runtimeKey = workspaceRuntimeActivationKey(targetWorkspaceId, runtimeRepoPath);
        if (runtimeKey) {
          sharedMcpActiveRuntimeTargetsRef.current.delete(runtimeKey);
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
        setSelectedWorkspaceId("");
      }
      setWorkspaceSettingsModalId((currentModalId) => (
        currentModalId === targetWorkspaceId ? "" : currentModalId
      ));

      workspaceDeactivationInFlightRef.current = "";
      setWorkspaceDeactivationState(WORKSPACE_DEACTIVATION_INITIAL_STATE);
    }
  }, [
    clearPreparedWorkspaceTerminals,
    defaultWorkingDirectory,
    setWorkspaceAgentBatchSentLaunchKey,
    updateWorkspaceLifecycleSettings,
  ]);

  const deleteWorkspaceFromForge = useCallback(async (workspaceId) => {
    const targetWorkspaceId = String(workspaceId || "").trim();
    const targetWorkspace = findWorkspaceById(workspacesRef.current, targetWorkspaceId);

    if (!targetWorkspaceId || !targetWorkspace) {
      setWorkspaceSettingsError("Choose a workspace before deleting it.");
      return;
    }

    if (workspaceDeactivationInFlightRef.current || workspaceSettingsState === "deleting") {
      setWorkspaceSettingsError("Workspace delete is already running.");
      return;
    }

    const workspaceName = String(targetWorkspace.name || targetWorkspaceId).trim();
    const repoPath = getWorkspaceRootDirectory(workspaceSettingsRef.current, targetWorkspaceId)
      || defaultWorkingDirectoryRef.current;
    if (!repoPath) {
      setWorkspaceSettingsError("Workspace root is missing. Choose a root before deleting this workspace.");
      return;
    }

    if (workspaceDeleteConfirmId !== targetWorkspaceId) {
      setWorkspaceDeleteConfirmId(targetWorkspaceId);
      setWorkspaceSettingsError("");
      setWorkspaceSettingsMessage(`Click "Confirm delete" to remove "${workspaceName}" from Diff Forge. Project files stay on disk.`);
      return;
    }

    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
    setWorkspaceDeleteConfirmId("");
    clearPreparedWorkspaceTerminals(targetWorkspaceId);
    workspaceAgentLaunchKeyRef.current = "";
    workspaceAgentBatchInFlightKeyRef.current = "";
    workspaceAgentBatchStartedSessionKeysRef.current.clear();
    workspaceAgentBatchInFlightSessionKeysRef.current.clear();
    setWorkspaceAgentBatchSentLaunchKey("");

    // Pure local delete: the workspace leaves the UI and the local store
    // immediately — never a tombstone row. The cloud delete rides the durable
    // sync outbox, so it survives offline stretches and background mode, and
    // the Rust side filters the id out of stale lists/broadcasts until the
    // delete drains.
    const nextWorkspaces = (Array.isArray(workspacesRef.current) ? workspacesRef.current : [])
      .filter((workspace) => workspace.id !== targetWorkspaceId);
    workspacesRef.current = nextWorkspaces;
    setWorkspaces(nextWorkspaces);

    const deleteScopeKey = activeAccountScopeKey;
    void invoke("local_workspaces_store", {
      scopeKey: deleteScopeKey,
      workspaces: nextWorkspaces,
    }).catch(() => {});

    const nextSettings = { ...(workspaceSettingsRef.current || {}) };
    delete nextSettings[targetWorkspaceId];
    workspaceSettingsRef.current = nextSettings;
    persistWorkspaceSettings(nextSettings);
    setWorkspaceSettings(nextSettings);

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

    setWorkspaceThreads((current) => {
      const next = { ...(current || {}) };
      delete next[targetWorkspaceId];
      workspaceThreadsRef.current = next;
      return next;
    });
    setWorkspaceNotifications((current) => {
      const next = { ...(current || {}) };
      delete next[targetWorkspaceId];
      return next;
    });
    setWorkspaceTerminalLogicalIndexes((current) => {
      const next = { ...(current || {}) };
      delete next[targetWorkspaceId];
      workspaceTerminalLogicalIndexesRef.current = next;
      return next;
    });
    setWorkspaceTerminalDisplayLayouts((current) => {
      const next = { ...(current || {}) };
      delete next[targetWorkspaceId];
      workspaceTerminalDisplayLayoutsRef.current = next;
      return next;
    });
    setWorkspaceGraphState((current) => Object.fromEntries(
      Object.entries(current || {}).filter(([key]) => !key.startsWith(`${targetWorkspaceId}::`)),
    ));
    purgeWorkspaceTodoQueueLocalStorage(targetWorkspaceId);
    terminalPresenceSyncKeyRef.current = "";
    workspaceMcpSyncKeyRef.current = "";
    workspaceCatalogSyncKeyRef.current = "";
    workspaceCloudSyncKeyRef.current = "";

    if (activatedWorkspaceIdRef.current === targetWorkspaceId) {
      const nextActivatedWorkspace = nextEnabledWorkspaceIds
        .map((enabledWorkspaceId) => findWorkspaceById(nextWorkspaces, enabledWorkspaceId))
        .find(Boolean)
        || nextWorkspaces[0]
        || null;
      setActivatedWorkspaceId(nextActivatedWorkspace?.id || "");
    }
    if (selectedWorkspaceIdRef.current === targetWorkspaceId) {
      setSelectedWorkspaceId(nextWorkspaces[0]?.id || "");
    }

    setWorkspaceSettingsModalId("");
    showView(DEFAULT_WORKSPACE_VIEW, {
      telemetrySource: "workspace_deleted",
      telemetryWorkspaceId: targetWorkspaceId,
    });

    void (async () => {
      const warnings = [];

      try {
        // Durable cloud delete: hard-deletes the catalog rows, writes the
        // deleted-ids ledger, and broadcasts workspace_catalog_changed to
        // every device. Offline it queues on the outbox and drains later.
        await invoke("cloud_mcp_workspace_catalog_delete", {
          workspaceId: targetWorkspaceId,
          reason: "workspace_deleted",
          scopeKey: deleteScopeKey,
        });
      } catch (error) {
        warnings.push(`Cloud catalog cleanup warning: ${getErrorMessage(error, "Unable to delete cloud workspace.")}`);
      }

      try {
        await withTimeout(
          invoke("deactivate_workspace_runtime", {
            repoPath,
            reason: "workspace_delete",
            workspaceId: targetWorkspaceId,
          }),
          WORKSPACE_DEACTIVATE_RUNTIME_TIMEOUT_MS,
          "Workspace runtime cleanup timed out.",
        );
      } catch (error) {
        warnings.push(`Runtime cleanup warning: ${getErrorMessage(error, "Unable to stop workspace runtime cleanly.")}`);
      }

      try {
        await invoke("cloud_mcp_delete_workspace", {
          repoPath,
          workspaceId: targetWorkspaceId,
          workspaceName,
          includeChildProjects: false,
        });
      } catch (error) {
        warnings.push(`Live-state cleanup warning: ${getErrorMessage(error, "Unable to notify cloud live state.")}`);
      }

      try {
        // Local todo state is removed with the workspace; the cloud keeps
        // tombstoned rows so a recreated workspace with the same name or
        // identity never re-imports ghost todos.
        await invoke("cloud_mcp_archive_workspace_todos", {
          workspaceId: targetWorkspaceId,
          workspaceName,
          reason: "workspace_removed",
        });
      } catch (error) {
        warnings.push(`Todo cleanup warning: ${getErrorMessage(error, "Unable to archive workspace todos.")}`);
      }

      try {
        await invoke("delete_workspace_local_metadata", {
          repoPath,
          discardDirtyWorktrees: true,
        });
      } catch (error) {
        warnings.push(`Local metadata cleanup warning: ${getErrorMessage(error, "Unable to remove local workspace metadata.")}`);
      }

      setWorkspaceError(warnings.length
        ? `Workspace deleted. ${warnings.join(" ")}`
        : "");
    })();

    setWorkspaceSettingsState("idle");
  }, [
    activeAccountScopeKey,
    clearPreparedWorkspaceTerminals,
    setWorkspaceAgentBatchSentLaunchKey,
    showView,
    updateWorkspaceLifecycleSettings,
    workspaceDeleteConfirmId,
    workspaceSettingsState,
  ]);

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

  const connectCloudWorkspaceForAuthenticatedSession = useCallback(async ({
    accountScope,
    flowId,
    sessionUser,
    step,
    successMessage,
    token,
  }) => {
    if (!isPaidUser(sessionUser)) {
      return null;
    }

    await recordCloudSigninDiagnostic(token, {
      flowId,
      step,
      status: "start",
      message: "starting Cloud MCP connection before desktop auth is accepted",
      details: {},
    });

    try {
      const status = await syncCloudMcpDesktopSessionToken(token, {
        accountScope,
        connectAttempts: CLOUD_WORKSPACE_CONNECT_ATTEMPTS,
        connectRetryDelayMs: CLOUD_WORKSPACE_CONNECT_RETRY_DELAY_MS,
        flowId,
        ...cloudMcpBillingEntitlementPayload(billingStatusRef.current, sessionUser),
        onProgress: updateCloudWorkspaceProgress,
        requireConnected: true,
      });

      await recordCloudSigninDiagnostic(token, {
        flowId,
        step,
        status: "ok",
        message: successMessage,
        details: status || {},
      });

      return status;
    } catch (cloudError) {
      await recordCloudSigninDiagnostic(token, {
        flowId,
        step,
        status: "error",
        message: getErrorMessage(cloudError, "Cloud workspace connection failed."),
        details: { requireConnected: true },
      });
      throw cloudError;
    }
  }, [updateCloudWorkspaceProgress]);

  const validateStoredSession = useCallback(async () => {
    const token = authStore.getToken();
    const validationFlowId = authFlowIdRef.current;
    let cloudWorkspaceRestoreFailed = false;

    if (!isSafeAuthValue(token)) {
      setSignedOut(DEFAULT_AUTH_MESSAGE, "", { clearPending: true });
      return;
    }

    // Auth state is monotonic for a session: once the user is authenticated,
    // restore validation must never demote them back to the sign-in screen
    // (setChecking flips status to signedOut, which reads as login/dashboard
    // flicker). Re-validation of a live session goes through the quiet path.
    if (authStore.getSnapshot().status === "authenticated") {
      return;
    }

    authStore.setChecking("Checking saved desktop session. You can still sign in with the web app.");

    try {
      const session = await withTimeout(
        invoke("validate_desktop_session", { token }),
        SESSION_RESTORE_TIMEOUT_MS,
        SESSION_RESTORE_TIMEOUT_MESSAGE,
      );
      await recordCloudSigninDiagnostic(token, {
        flowId: `restore-${validationFlowId}`,
        step: "desktop_session.restore",
        status: "ok",
        message: "saved desktop session validated",
        details: {
          hasUser: Boolean(session?.user),
          email: session?.user?.email || "",
          planStatus: session?.user?.planStatus || "",
        },
      });
      if (validationFlowId !== authFlowIdRef.current) {
        return;
      }

      const sessionNeedsCloudWorkspace = isPaidUser(session.user);

      if (sessionNeedsCloudWorkspace) {
        authStore.setChecking("Checking saved desktop session. Connecting your cloud workspace...");
        cloudWorkspaceRestoreFailed = true;
        await connectCloudWorkspaceForAuthenticatedSession({
          flowId: `restore-${validationFlowId}`,
          sessionUser: session.user,
          step: "desktop_restore.cloud_workspace",
          successMessage: "Cloud MCP connection completed from saved desktop session",
          token,
        });
        cloudWorkspaceRestoreFailed = false;

        if (validationFlowId !== authFlowIdRef.current) {
          return;
        }
      }

      setAuthenticated(session.user, { syncCloud: !sessionNeedsCloudWorkspace });
    } catch (error) {
      if (validationFlowId !== authFlowIdRef.current) {
        return;
      }

      const restoreError = getErrorMessage(error, "Unable to restore your desktop session.");
      const didTimeout = restoreError === SESSION_RESTORE_TIMEOUT_MESSAGE;
      const didCloudWorkspaceFail = cloudWorkspaceRestoreFailed;
      const isNetworkRestoreError = didTimeout
        || /unable to validate desktop session/i.test(restoreError)
        || /unable to read diff forge ai api response/i.test(restoreError)
        || /returned 5\d\d/i.test(restoreError)
        || /unable to prepare backend request/i.test(restoreError);
      const storedUser = authStore.getSnapshot().user;

      if (isNetworkRestoreError && storedUser && !isPaidUser(storedUser)) {
        // Free accounts do not open a cloud workspace, so a saved pricing-screen
        // session can survive a temporary API outage without entering sync limbo.
        offlineSessionGraceRef.current = true;
        await recordCloudSigninDiagnostic(token, {
          flowId: `restore-${validationFlowId}`,
          step: "desktop_session.restore",
          status: "warn",
          message: "offline session grace: network failure during session restore",
          details: { didTimeout, restoreError },
        });
        setAuthenticated(storedUser);
        return;
      }

      const signedOutMessage = didCloudWorkspaceFail
        ? "Cloud workspace did not finish connecting. Sign in again to retry."
        : (
          didTimeout || isNetworkRestoreError
            ? "Secure session could not be verified. Sign in again with the web app."
            : "Your desktop session expired. Sign in again with the web app."
        );
      await recordCloudSigninDiagnostic(token, {
        flowId: `restore-${validationFlowId}`,
        step: "desktop_session.restore",
        status: "error",
        message: restoreError,
        details: { didCloudWorkspaceFail, didTimeout },
      });

      setSignedOut(signedOutMessage, restoreError, {
        clearPending: true,
        clearSession: true,
      });
    }
  }, [connectCloudWorkspaceForAuthenticatedSession, setAuthenticated, setSignedOut]);

  const revalidateOfflineSessionQuietly = useCallback(async () => {
    if (!offlineSessionGraceRef.current) {
      return;
    }
    const token = authStore.getToken();
    if (!isSafeAuthValue(token)) {
      offlineSessionGraceRef.current = false;
      return;
    }
    try {
      const session = await invoke("validate_desktop_session", { token });
      offlineSessionGraceRef.current = false;
      if (session?.user) {
        // Quiet refresh: update the stored user without resetting workspace
        // state the user is already working in.
        authStore.setAuthenticated(session.user);
      }
    } catch (error) {
      const message = getErrorMessage(error, "");
      const isNetworkError = /unable to validate desktop session/i.test(message)
        || /unable to read diff forge ai api response/i.test(message)
        || /returned 5\d\d/i.test(message)
        || /unable to prepare backend request/i.test(message);
      if (isNetworkError) {
        return;
      }
      offlineSessionGraceRef.current = false;
      expireDesktopSession(error);
    }
  }, [expireDesktopSession]);

  const completeDesktopLogin = useCallback(async (callbackUrl) => {
    const callback = parseAuthCallback(callbackUrl);

    if (!callback) {
      return false;
    }

    const pendingState = authStore.getPendingState();

    if (
      callback.state === authCallbackInFlightStateRef.current
      || callback.state === authCallbackCompletedStateRef.current
    ) {
      return true;
    }

    if (!pendingState || callback.state !== pendingState) {
      if (!pendingState && authStore.getSnapshot().status === "authenticated") {
        return true;
      }

      authFlowIdRef.current += 1;
      setSignedOut(
        DEFAULT_AUTH_MESSAGE,
        "Desktop login state did not match. Start again from this app.",
        { clearPending: true },
      );
      return true;
    }

    authFlowIdRef.current += 1;
    const loginFlowId = authFlowIdRef.current;
    authCallbackInFlightStateRef.current = callback.state;
    authStore.setExchanging("Browser callback matched. Creating your desktop session...");
    let diagnosticToken = "";
    let failureStep = "desktop_session.exchange";

    try {
      const session = await withTimeout(
        invoke("exchange_desktop_auth_code", {
          code: callback.code,
          state: callback.state,
        }),
        AUTH_EXCHANGE_TIMEOUT_MS,
        AUTH_EXCHANGE_TIMEOUT_MESSAGE,
      );
      diagnosticToken = session?.token || "";
      await recordCloudSigninDiagnostic(diagnosticToken, {
        flowId: callback.state,
        step: "desktop_session.exchange",
        status: "ok",
        message: "desktop auth code exchanged for desktop session",
        details: {
          hasUser: Boolean(session?.user),
          email: session?.user?.email || "",
          planStatus: session?.user?.planStatus || "",
        },
      });

      if (loginFlowId !== authFlowIdRef.current) {
        return true;
      }

      const sessionNeedsCloudWorkspace = isPaidUser(session.user);

      if (sessionNeedsCloudWorkspace) {
        authStore.setExchanging("Browser callback matched. Connecting your cloud workspace...");
        failureStep = "desktop_signin.cloud_workspace";
        await connectCloudWorkspaceForAuthenticatedSession({
          accountScope: {
            id: "personal",
            type: "personal",
            label: "Personal",
            teamId: null,
          },
          flowId: callback.state,
          sessionUser: session.user,
          step: "desktop_signin.cloud_workspace",
          successMessage: "Cloud MCP connection completed after deeplink",
          token: session.token,
        });

        if (loginFlowId !== authFlowIdRef.current) {
          return true;
        }
      }

      authStore.persistAuthenticatedSession(session);
      authStore.clearPending();
      setAuthenticated(session.user, { syncCloud: !sessionNeedsCloudWorkspace });
      authCallbackCompletedStateRef.current = callback.state;
    } catch (error) {
      if (loginFlowId !== authFlowIdRef.current) {
        return true;
      }

      await recordCloudSigninDiagnostic(diagnosticToken, {
        flowId: callback?.state,
        step: failureStep,
        status: "error",
        message: getErrorMessage(error, "Desktop login expired. Try again."),
        details: {},
      });
      setSignedOut(
        DEFAULT_AUTH_MESSAGE,
        getErrorMessage(error, "Desktop login expired. Try again."),
        { clearPending: true },
      );
    } finally {
      if (authCallbackInFlightStateRef.current === callback.state) {
        authCallbackInFlightStateRef.current = "";
      }
    }

    return true;
  }, [connectCloudWorkspaceForAuthenticatedSession, setAuthenticated, setSignedOut]);

  const startWebLogin = useCallback(async () => {
    authFlowIdRef.current += 1;
    authCallbackInFlightStateRef.current = "";
    authCallbackCompletedStateRef.current = "";
    const state = createAuthState();
    authStore.setWaiting(state, "Opening secure web sign-in in your browser...");

    try {
      const loginUrl = await desktopLoginUrlWithDevice(state);
      await withTimeout(
        openUrl(loginUrl),
        OPEN_BROWSER_TIMEOUT_MS,
        "Unable to open the web login.",
      );
      authStore.setStage(
        "deep_link",
        "Finish sign-in in your browser. This app is waiting for the secure callback.",
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

  const refreshBillingStatus = useCallback(async ({ quiet = false } = {}) => {
    if (authState !== "authenticated") {
      setBillingStatus(null);
      setBillingStatusState("idle");
      setBillingStatusError("");
      return null;
    }

    if (!quiet) {
      setBillingStatusState("loading");
    } else {
      setBillingStatusState((current) => (current === "idle" ? "loading" : current));
    }

    try {
      const nextBillingStatus = await invoke("cloud_mcp_get_billing_status");
      setBillingStatus(nextBillingStatus);
      setBillingStatusState("ready");
      setBillingStatusError("");
      return nextBillingStatus;
    } catch (error) {
      const message = getErrorMessage(error, "Unable to load credit status.");
      setBillingStatusState("error");
      setBillingStatusError(message);
      return null;
    }
  }, [authState]);

  const resolveAgentInstallationSyncTarget = useCallback(() => {
    const currentWorkspaces = Array.isArray(workspacesRef.current) ? workspacesRef.current : [];
    const targetWorkspaceId = (
      activatedWorkspaceIdRef.current
      || selectedWorkspaceIdRef.current
      || workspaceLifecycleSettingsRef.current?.defaultWorkspaceId
      || ""
    );
    const workspace = targetWorkspaceId
      ? findWorkspaceById(currentWorkspaces, targetWorkspaceId)
      : null;
    const workspaceId = workspace?.id || targetWorkspaceId || "";
    const repoPath = (
      (workspaceId ? getWorkspaceRootDirectory(workspaceSettingsRef.current, workspaceId) : "")
      || cleanWorkspaceRootDirectory(defaultWorkingDirectoryRef.current)
    );

    return {
      repoPath,
      workspaceId,
      workspaceName: workspace?.name || "",
    };
  }, []);

  const syncAgentInstallationsToCloud = useCallback((statuses, reason = "agent_status_refresh", packageState = {}) => {
    const syncStatuses = Array.isArray(statuses)
      ? statuses.filter((status) => status && typeof status === "object")
      : [];
    const codingAgents = syncStatuses
      .map((status) => sanitizeCodingAgentStatusForCloud({
        ...status,
        packageOperation: packageState[status.id] || "",
      }))
      .filter(Boolean);
    const hasCheckedStatus = syncStatuses.some((status) => (
      !status.cached && String(status.version || "").trim() !== "Not checked"
    ));
    if (!codingAgents.length || !hasCheckedStatus || syncStatuses.every((status) => status.cached)) {
      return;
    }

    const target = resolveAgentInstallationSyncTarget();
    if (!target) {
      return;
    }

    const syncKey = JSON.stringify({
      scope: "connected-device-agent-installations",
      agents: codingAgents,
    });
    if (agentInstallationSyncKeyRef.current === syncKey) {
      return;
    }
    agentInstallationSyncKeyRef.current = syncKey;

    invoke("cloud_mcp_sync_agent_installations", {
      repoPath: target.repoPath,
      workspaceId: target.workspaceId || null,
      workspaceName: target.workspaceName || null,
      agentStatuses: codingAgents,
      reason,
    }).catch((error) => {
      agentInstallationSyncKeyRef.current = "";
      logBigViewSyncDiagnosticEvent("cloud_mcp.agent_installations_sync.failed", {
        message: getErrorMessage(error, "Unable to sync installed agent inventory."),
        repoPath: target.repoPath,
        workspaceId: target.workspaceId,
        agentCount: codingAgents.length,
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

  // Headless agent inventory: the Rust watcher probes CLI installs/updates
  // (including ones made in terminals while this window never looked) and
  // emits the fresh statuses; apply them like a local refresh so the agent
  // gates and Tools tab stay current without polling.
  useEffect(() => {
    let disposed = false;
    let unlisten = null;
    void listen("agent-inventory-changed", (event) => {
      if (disposed) {
        return;
      }
      const statuses = Array.isArray(event?.payload?.statuses) ? event.payload.statuses : [];
      if (!statuses.length) {
        return;
      }
      const statusMap = new Map(statuses.map((status) => [status.id, status]));
      const nextStatuses = AGENT_PROVIDERS.map((provider) => ({
        ...DEFAULT_AGENT_STATUSES.find((status) => status.id === provider.id),
        ...provider,
        ...(statusMap.get(provider.id) || {}),
      }));
      persistAgentStatusCache(nextStatuses);
      setAgentStatuses(nextStatuses);
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        unlisten = dispose;
      }
    }).catch(() => {});
    return () => {
      disposed = true;
      if (typeof unlisten === "function") {
        unlisten();
      }
    };
  }, []);

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
    syncAgentInstallationsToCloud(agentStatuses, "agent_install_start", { [provider]: "installing" });
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
      syncAgentInstallationsToCloud(agentStatuses, "agent_install_idle", { [provider]: "idle" });
    }
  }, [agentStatuses, refreshAgentStatuses, syncAgentInstallationsToCloud]);

  const updateAgentWithNpm = useCallback(async (provider) => {
    setAgentInstallState((state) => ({ ...state, [provider]: "updating" }));
    syncAgentInstallationsToCloud(agentStatuses, "agent_update_start", { [provider]: "updating" });
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
      syncAgentInstallationsToCloud(agentStatuses, "agent_update_idle", { [provider]: "idle" });
    }
  }, [agentStatuses, refreshAgentStatuses, syncAgentInstallationsToCloud]);

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
      syncAgentInstallationsToCloud(agentStatuses, "startup_agent_update_start", { [agent.id]: "updating" });
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
        syncAgentInstallationsToCloud(agentStatuses, "startup_agent_update_idle", { [agent.id]: "idle" });
      }
    }

    setStartupAgentUpdateMessage("Refreshing terminal CLI status...");
    const nextStatuses = await refreshAgentStatuses();
    finishStartupAgentGate(nextStatuses || agentStatuses, "updated");
  }, [agentStatuses, finishStartupAgentGate, refreshAgentStatuses, syncAgentInstallationsToCloud]);

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

  const loadWorkspaces = useCallback(async () => {
    setWorkspaceSyncState("loading");
    setWorkspaceError("");

    const scopeKey = activeAccountScopeKey;
    const applyLoadedWorkspaces = (nextWorkspaces) => {
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
      const nextActivated = findWorkspaceById(nextWorkspaces, currentActivatedId)
        || defaultWorkspace
        || null;
      const nextEnabledWorkspaceIds = (() => {
        if (nextActivated?.id) {
          return existingEnabledWorkspaceIds.includes(nextActivated.id)
            ? existingEnabledWorkspaceIds
            : [...existingEnabledWorkspaceIds, nextActivated.id];
        }
        return [];
      })();

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

      workspacesRef.current = nextWorkspaces;
      setWorkspaces(nextWorkspaces);
      setSelectedWorkspaceId((currentSelectedId) => {
        const nextSelected = findWorkspaceById(nextWorkspaces, currentSelectedId)
          || nextActivated;

        return nextSelected?.id || "";
      });
      setActivatedWorkspaceId(nextActivated?.id || "");
    };

    // Local-first: the on-disk catalog renders immediately; the cloud catalog
    // reconciles in the background and pushes any offline edits back up.
    let localItems = [];
    try {
      const local = await invoke("local_workspaces_load", { scopeKey });
      localItems = Array.isArray(local?.workspaces) ? local.workspaces : [];
    } catch {
      localItems = Array.isArray(workspacesRef.current) ? workspacesRef.current : [];
    }
    // Legacy stores may still hold pendingDelete tombstone rows from before
    // catalog deletes became Rust-owned and durable. Migrate them: the durable
    // delete removes the row from the store and queues the cloud delete on
    // the outbox, so no tombstone bookkeeping survives.
    localItems.forEach((rawItem) => {
      const normalized = normalizeCatalogWorkspaceEntry(rawItem);
      if (normalized?.pendingDelete && normalized.id) {
        void invoke("cloud_mcp_workspace_catalog_delete", {
          workspaceId: normalized.id,
          reason: "workspace_deleted_offline",
          scopeKey,
        }).catch(() => {});
      }
    });
    localItems = localItems
      .map(normalizeCatalogWorkspaceEntry)
      .filter((workspace) => workspace && !workspace.pendingDelete);
    applyLoadedWorkspaces(localItems);
    setWorkspaceSyncState("idle");
    setWorkspaceListHydrated(true);

    void (async () => {
      try {
        // The Rust list command already filters out workspaces whose catalog
        // delete is still queued in the outbox.
        const result = await invoke("cloud_mcp_workspace_catalog_list");
        if (activeAccountScopeKey !== scopeKey) {
          return;
        }
        const cloudItems = (Array.isArray(result?.workspaces) ? result.workspaces : [])
          .map(normalizeCatalogWorkspaceEntry)
          .filter(Boolean);
        const { workspaces: merged, pendingUpserts } = reconcileWorkspaceCatalog(
          localItems,
          cloudItems,
        );
        applyLoadedWorkspaces(merged);
        try {
          await invoke("local_workspaces_store", { scopeKey, workspaces: merged });
        } catch {
          // Local persistence is best effort; cloud remains authoritative.
        }
        for (const pending of pendingUpserts) {
          try {
            await invoke("cloud_mcp_workspace_catalog_upsert", {
              scopeKey,
              workspace: {
                workspace_id: pending.id,
                workspace_name: pending.name,
                created_at: pending.createdAt,
                updated_at: pending.updatedAt,
              },
            });
          } catch {
            // Retried on the next reconcile pass.
          }
        }
      } catch {
        // Offline or cloud unavailable: the local list stands until the
        // websocket reconnects and the catalog broadcast refreshes us.
      }
    })();
  }, [activeAccountScopeKey, expireDesktopSession]);

  useEffect(() => {
    if (!previousAccountScopeKeyRef.current) {
      previousAccountScopeKeyRef.current = activeAccountScopeKey;
      return;
    }

    if (previousAccountScopeKeyRef.current === activeAccountScopeKey) {
      return;
    }

    previousAccountScopeKeyRef.current = activeAccountScopeKey;

    if (authState !== "authenticated" || !isPaidUser(user)) {
      return;
    }

    setWorkspaces([]);
    setSelectedWorkspaceId("");
    setActivatedWorkspaceId("");
    setWorkspaceSyncState("loading");
    setWorkspaceListHydrated(false);
    setWorkspaceHydrationReady(false);
    loadWorkspaces();
  }, [activeAccountScopeKey, authState, loadWorkspaces, user]);

  // Cross-device workspace sync: cloud-diffforge broadcasts the full active
  // catalog whenever any device creates, renames, or deletes a workspace.
  useEffect(() => {
    if (authState !== "authenticated" || !isPaidUser(user)) {
      return undefined;
    }

    let disposed = false;
    let unlisten = null;
    const scopeKey = activeAccountScopeKey;

    void listen(CLOUD_MCP_WORKSPACE_CATALOG_CHANGED_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      if (!Array.isArray(payload.workspaces)) {
        return;
      }
      // The Rust event forwarder already drops workspaces whose catalog
      // delete is still queued in the outbox.
      const cloudItems = payload.workspaces
        .map(normalizeCatalogWorkspaceEntry)
        .filter(Boolean);
      const localItems = Array.isArray(workspacesRef.current) ? workspacesRef.current : [];
      const { workspaces: merged } = reconcileWorkspaceCatalog(localItems, cloudItems);
      workspacesRef.current = merged;
      setWorkspaces(merged);
      if (activatedWorkspaceIdRef.current
        && !findWorkspaceById(merged, activatedWorkspaceIdRef.current)) {
        setActivatedWorkspaceId(merged[0]?.id || "");
      }
      setSelectedWorkspaceId((currentSelectedId) => (
        findWorkspaceById(merged, currentSelectedId) ? currentSelectedId : (merged[0]?.id || "")
      ));
      void invoke("local_workspaces_store", { scopeKey, workspaces: merged }).catch(() => {});
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        unlisten = dispose;
      }
    }).catch(() => {});

    return () => {
      disposed = true;
      if (typeof unlisten === "function") {
        unlisten();
      }
    };
  }, [activeAccountScopeKey, authState, user]);

  const openCreateWorkspaceModal = useCallback(() => {
    setWorkspaceName("");
    setNewWorkspaceRootDraft(defaultWorkingDirectory || "");
    setWorkspaceError("");
    setWorkspaceSettingsModalId("");
    setWorkspaceCreateModalOpen(true);
    // The create panel lives in the main workspace view, not a modal.
    showView(DEFAULT_WORKSPACE_VIEW, {
      telemetrySource: "workspace_create_panel",
    });
  }, [defaultWorkingDirectory, showView]);

  const closeCreateWorkspaceModal = useCallback(() => {
    if (workspaceSyncState === "creating") {
      return;
    }

    setWorkspaceCreateModalOpen(false);
    setWorkspaceError("");
    // Closing the create panel lands on the neutral no-workspace-selected
    // view instead of jumping back into the previously selected workspace.
    setSelectedWorkspaceId("");
  }, [workspaceSyncState]);

  const createFirstWorkspace = useCallback(async (event, requestedTerminalRoles = null) => {
    event.preventDefault();

    const token = authStore.getToken();
    const name = workspaceName;
    const requestedRoot = cleanWorkspaceRootDirectory(newWorkspaceRootDraft)
      || cleanWorkspaceRootDirectory(defaultWorkingDirectory);

    if (!isSafeAuthValue(token)) {
      expireDesktopSession("Desktop session required to create a workspace.");
      return;
    }

    if (!name) {
      setWorkspaceError("Workspace name is required.");
      return;
    }

    if (!requestedRoot) {
      setWorkspaceError("Choose a workspace root directory.");
      return;
    }

    if (requestedRoot.length > MAX_WORKSPACE_ROOT_DIRECTORY_LENGTH) {
      setWorkspaceError("Root directory path is too long.");
      return;
    }

    setWorkspaceSyncState("creating");
    setWorkspaceError("");

    try {
      const normalizedRoot = await invoke("validate_workspace_root_directory", { path: requestedRoot });
      const rootDirectory = normalizedRoot?.workingDirectory || "";
      const rootWasEmptyAtSelection = Boolean(normalizedRoot?.emptyDirectory);

      if (!rootDirectory) {
        throw new Error("Workspace root directory was not returned by validation.");
      }

      const duplicateWorkspace = findWorkspaceByEffectiveRoot(
        workspacesRef.current,
        workspaceSettingsRef.current,
        rootDirectory,
        defaultWorkingDirectoryRef.current,
      );

      if (duplicateWorkspace) {
        throw new Error(`That folder is already attached to ${duplicateWorkspace.name || "another workspace"}.`);
      }

      // Local-first create: mint the id here, commit the row instantly, and
      // let the cloud workspace catalog ack + registration run in background.
      const nowIso = new Date().toISOString();
      const workspace = {
        id: mintLocalWorkspaceId(),
        name,
        createdAt: nowIso,
        updatedAt: nowIso,
        syncState: "pending",
      };

      const existingWorkspaces = Array.isArray(workspacesRef.current) ? workspacesRef.current : [];
      const nextWorkspaces = [
        ...existingWorkspaces.filter((item) => item.id !== workspace.id),
        workspace,
      ];
      const terminalRoles = Array.isArray(requestedTerminalRoles) && requestedTerminalRoles.length
        ? requestedTerminalRoles.slice(0, MAX_WORKSPACE_TERMINAL_COUNT)
        : null;
      const nextWorkspaceSettings = updateWorkspaceLocalSettings(workspaceSettingsRef.current, workspace.id, {
        rootDirectory,
        rootWasEmptyAtSelection,
        ...(terminalRoles
          ? { terminalCount: terminalRoles.length, terminalRoles }
          : {}),
      });
      const currentLifecycleSettings = workspaceLifecycleSettingsRef.current || {};
      const enabledWorkspaceIds = normalizeEnabledWorkspaceIds(currentLifecycleSettings.enabledWorkspaceIds);
      const nextEnabledWorkspaceIds = enabledWorkspaceIds.includes(workspace.id)
        ? enabledWorkspaceIds
        : [...enabledWorkspaceIds, workspace.id];

      workspaceSettingsRef.current = nextWorkspaceSettings;
      persistWorkspaceSettings(nextWorkspaceSettings);
      setWorkspaceSettings(nextWorkspaceSettings);
      workspacesRef.current = nextWorkspaces;
      setWorkspaces(nextWorkspaces);
      setSelectedWorkspaceId(workspace.id);
      setActivatedWorkspaceId(workspace.id);
      updateWorkspaceLifecycleSettings({
        defaultWorkspaceId: currentLifecycleSettings.defaultWorkspaceId || "",
        enabledWorkspaceIds: nextEnabledWorkspaceIds,
      });
      setWorkspaceName("");
      setNewWorkspaceRootDraft(rootDirectory);
      setWorkspaceCreateModalOpen(false);
      setWorkspaceSyncState("idle");

      const scopeKey = activeAccountScopeKey;
      void invoke("local_workspaces_store", { scopeKey, workspaces: nextWorkspaces }).catch(() => {});

      void (async () => {
        let catalogSynced = false;
        try {
          const catalogResponse = await invoke("cloud_mcp_workspace_catalog_upsert", {
            scopeKey,
            workspace: {
              workspace_id: workspace.id,
              workspace_name: workspace.name,
              workspace_root: rootDirectory,
              created_at: workspace.createdAt,
              updated_at: workspace.updatedAt,
            },
          });
          // queued means the durable outbox holds it (offline); the row stays
          // pending until the cloud list or broadcast confirms it.
          catalogSynced = !catalogResponse?.queued;
        } catch (catalogError) {
          setWorkspaceError(
            `Workspace created locally; cloud sync is pending: ${getErrorMessage(
              catalogError,
              "Unable to sync workspace to cloud.",
            )}`,
          );
        }
        if (catalogSynced) {
          const syncedWorkspaces = (Array.isArray(workspacesRef.current) ? workspacesRef.current : [])
            .map((item) => (item.id === workspace.id ? { ...item, syncState: "synced" } : item));
          workspacesRef.current = syncedWorkspaces;
          setWorkspaces(syncedWorkspaces);
          void invoke("local_workspaces_store", { scopeKey, workspaces: syncedWorkspaces }).catch(() => {});
        }
        try {
          await invoke("cloud_mcp_register_workspace", {
            repoPath: rootDirectory,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
          });
        } catch (registrationError) {
          setWorkspaceError(
            `Workspace created, but Cloud MCP registration failed: ${getErrorMessage(
              registrationError,
              "Unable to register workspace.",
            )}`,
          );
        }
      })();
    } catch (error) {
      if (isDesktopSessionExpiredError(error)) {
        expireDesktopSession(error);
        return;
      }

      setWorkspaceSyncState("error");
      setWorkspaceError(getErrorMessage(error, "Unable to create workspace."));
    }
  }, [
    activeAccountScopeKey,
    defaultWorkingDirectory,
    expireDesktopSession,
    newWorkspaceRootDraft,
    updateWorkspaceLifecycleSettings,
    workspaceName,
  ]);

  const openWorkspaceSettings = useCallback((workspaceId) => {
    setSelectedWorkspaceId(workspaceId);
    setWorkspaceSettingsModalId(workspaceId);
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
    setWorkspaceDeleteConfirmId("");
    // Settings render inline in the main workspace pane, like the create
    // panel, so make that pane visible and close the create panel if open.
    setWorkspaceCreateModalOpen(false);
    showView(DEFAULT_WORKSPACE_VIEW, {
      telemetrySource: "workspace_settings_panel",
    });
  }, [showView]);

  const closeWorkspaceSettings = useCallback(() => {
    if (workspaceDeactivationInFlightRef.current) {
      return;
    }

    setWorkspaceSettingsModalId("");
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
    setWorkspaceDeleteConfirmId("");
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
    const workspaceNameValue = workspaceNameDraft;
    const terminalCount = normalizeWorkspaceTerminalCount(workspaceTerminalCountDraft);
    const terminalRoles = normalizeWorkspaceTerminalRoles(
      workspaceTerminalRolesDraft,
      terminalCount,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    const cleanedRoot = cleanWorkspaceRootDirectory(workspaceRootDraft);
    const currentRootDirectory = getWorkspaceRootDirectory(workspaceSettings, selectedWorkspace.id);
    const currentAgentSessionMode = getWorkspaceAgentSessionMode(workspaceSettings, selectedWorkspace.id);
    const agentSessionMode = normalizeAgentSessionMode(workspaceAgentSessionModeDraft);
    const gitWorktreesEnabled = agentSessionMode === AGENT_SESSION_MODE_WORKTREE;
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
      const effectiveRootDirectory = rootDirectory || cleanWorkspaceRootDirectory(defaultWorkingDirectory);
      const duplicateWorkspace = findWorkspaceByEffectiveRoot(
        workspacesRef.current,
        workspaceSettingsRef.current,
        effectiveRootDirectory,
        defaultWorkingDirectoryRef.current,
        selectedWorkspace.id,
      );

      if (duplicateWorkspace) {
        throw new Error(`That folder is already attached to ${duplicateWorkspace.name || "another workspace"}.`);
      }

      const currentTerminalIndexes = getWorkspaceLogicalTerminalIndexes(
        workspaceTerminalLogicalIndexes,
        selectedWorkspace.id,
        currentTerminalCount,
      );
      const nextTerminalIndexes = rootDirectory !== currentRootDirectory
        ? getDefaultTerminalIndexes(terminalCount)
        : reconcileWorkspaceTerminalSlotIndexes(currentTerminalIndexes, terminalCount);
      const nextTerminalIndexSet = new Set(nextTerminalIndexes);
      const nextTerminalRoleByIndex = new Map(nextTerminalIndexes.map((terminalIndex, index) => (
        [terminalIndex, terminalRoles[index]]
      )));
      const rootChanged = rootDirectory !== currentRootDirectory;
      const gitWorktreesChanged = agentSessionMode !== currentAgentSessionMode;
      const rootWasEmptyAtSelection = rootDirectory
        ? rootChanged
          ? Boolean(normalizedRoot?.emptyDirectory)
          : getWorkspaceRootWasEmptyAtSelection(workspaceSettings, selectedWorkspace.id)
        : false;
      const previousMcpRepoPath = currentRootDirectory || defaultWorkingDirectory;
      const nextMcpRepoPath = rootDirectory || defaultWorkingDirectory;
      const removedTerminalIndexes = currentTerminalIndexes.filter((terminalIndex) => (
        !nextTerminalIndexSet.has(terminalIndex)
      ));
      const roleChangedTerminalIndexes = currentTerminalIndexes.filter((terminalIndex, index) => (
        nextTerminalIndexSet.has(terminalIndex)
        && currentTerminalRoles[index] !== nextTerminalRoleByIndex.get(terminalIndex)
      ));
      const terminalIndexesToClose = rootChanged || gitWorktreesChanged
        ? currentTerminalIndexes
        : Array.from(new Set([
          ...removedTerminalIndexes,
          ...roleChangedTerminalIndexes,
        ]));
      let nextWorkspace = selectedWorkspace;


      if (rootChanged || gitWorktreesChanged) {
        clearPreparedWorkspaceTerminals(selectedWorkspace.id);
        workspaceAgentLaunchKeyRef.current = "";
        workspaceAgentBatchInFlightKeyRef.current = "";
        workspaceAgentBatchStartedSessionKeysRef.current.clear();
        workspaceAgentBatchInFlightSessionKeysRef.current.clear();
        setWorkspaceAgentBatchSentLaunchKey("");

        const cleanupStartedAt = performance.now();


        const cleanupResults = await withTimeout(
          Promise.all(terminalIndexesToClose.map((terminalIndex) => {
            const previousIndex = currentTerminalIndexes.indexOf(terminalIndex);

            return closeWorkspaceTerminalPane({
              agentId: getWorkspaceTerminalPaneAgentId(currentTerminalRoles[previousIndex] || activeAgent),
              nextTerminalCount: terminalCount,
              previousTerminalCount: currentTerminalCount,
              reason: rootChanged ? "settings_root_change" : "settings_worktree_policy_change",
              terminalIndex,
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
          const previousRuntimeKey = workspaceRuntimeActivationKey(selectedWorkspace.id, previousMcpRepoPath);
          if (previousRuntimeKey) {
            sharedMcpActiveRuntimeTargetsRef.current.delete(previousRuntimeKey);
          }

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

      if (nextMcpRepoPath && (rootChanged || gitWorktreesChanged)) {
        await invoke("coordination_update_repo_policy", {
          repoPath: nextMcpRepoPath,
          input: {
            agent_session_mode: agentSessionMode,
          },
        });
      }

      if (workspaceNameValue !== selectedWorkspace.name) {
        // Local-first rename: commit instantly; the cloud catalog upsert acks
        // in the background and broadcasts the change to other devices.
        const renamedAtIso = new Date().toISOString();
        nextWorkspace = {
          ...selectedWorkspace,
          name: workspaceNameValue,
          updatedAt: renamedAtIso,
          syncState: "pending",
        };
        const renamedWorkspaces = (Array.isArray(workspacesRef.current) ? workspacesRef.current : [])
          .map((workspace) => (workspace.id === nextWorkspace.id ? nextWorkspace : workspace));
        workspacesRef.current = renamedWorkspaces;
        setWorkspaces(renamedWorkspaces);
        const renameScopeKey = activeAccountScopeKey;
        void invoke("local_workspaces_store", {
          scopeKey: renameScopeKey,
          workspaces: renamedWorkspaces,
        }).catch(() => {});
        void invoke("cloud_mcp_workspace_catalog_upsert", {
          scopeKey: renameScopeKey,
          workspace: {
            workspace_id: nextWorkspace.id,
            workspace_name: nextWorkspace.name,
            updated_at: renamedAtIso,
          },
        }).then((response) => {
          if (response?.queued) {
            // Offline: the rename rides the durable outbox; it stays pending
            // until the cloud confirms via list or broadcast.
            return;
          }
          const syncedWorkspaces = (Array.isArray(workspacesRef.current) ? workspacesRef.current : [])
            .map((workspace) => (
              workspace.id === nextWorkspace.id ? { ...workspace, syncState: "synced" } : workspace
            ));
          workspacesRef.current = syncedWorkspaces;
          setWorkspaces(syncedWorkspaces);
          void invoke("local_workspaces_store", {
            scopeKey: renameScopeKey,
            workspaces: syncedWorkspaces,
          }).catch(() => {});
        }).catch(() => {
          // The next catalog reconcile re-pushes pending renames.
        });
      }

      setWorkspaceSettings((settings) => {
        const nextSettings = updateWorkspaceLocalSettings(settings, selectedWorkspace.id, {
          rootDirectory,
          rootWasEmptyAtSelection,
          agentSessionMode,
          gitWorktreesEnabled,
          terminalCount,
          terminalRoles,
        });
        workspaceSettingsRef.current = nextSettings;
        persistWorkspaceSettings(nextSettings);
        return nextSettings;
      });

      if (rootChanged || gitWorktreesChanged || terminalCount !== currentTerminalCount || terminalRolesChanged) {
        const nextDisplayRows = getWorkspaceDisplayTerminalRows(
          workspaceTerminalDisplayLayoutsRef.current,
          selectedWorkspace.id,
          nextTerminalIndexes,
        ).map((row) => row.terminalIndexes.slice());
        const nextLogicalIndexesByWorkspace = {
          ...workspaceTerminalLogicalIndexes,
          [selectedWorkspace.id]: nextTerminalIndexes,
        };
        const nextDisplayLayouts = {
          ...workspaceTerminalDisplayLayoutsRef.current,
          [selectedWorkspace.id]: nextDisplayRows.length
            ? nextDisplayRows
            : getDefaultWorkspaceDisplayTerminalRows(nextTerminalIndexes),
        };
        workspaceTerminalLogicalIndexesRef.current = nextLogicalIndexesByWorkspace;
        workspaceTerminalDisplayLayoutsRef.current = nextDisplayLayouts;
        setWorkspaceTerminalLogicalIndexes(nextLogicalIndexesByWorkspace);
        setWorkspaceTerminalDisplayLayouts(nextDisplayLayouts);
      }

      setWorkspaceNameDraft(nextWorkspace.name);
      setWorkspaceRootDraft(rootDirectory);
      setWorkspaceTerminalCountDraft(String(terminalCount));
      setWorkspaceTerminalRolesDraft(terminalRoles);
      setWorkspaceAgentSessionModeDraft(agentSessionMode);
      setWorkspaceUnsafeModeArmed(false);
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
    activeAccountScopeKey,
    expireDesktopSession,
    workspaceNameDraft,
    workspaceRootDraft,
    workspaceAgentSessionModeDraft,
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
    setWorkspaceAgentBatchSentLaunchKey,
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

  const addWorkspaceTerminal = useCallback(({ role = "", workspaceId } = {}) => {
    if (!workspaceId) {
      return null;
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
      return null;
    }

    let nextTerminalIndex = -1;
    for (let index = 0; index < MAX_WORKSPACE_TERMINAL_COUNT; index += 1) {
      if (!currentIndexes.includes(index)) {
        nextTerminalIndex = index;
        break;
      }
    }

    if (nextTerminalIndex < 0) {
      return null;
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
    const nextRole = normalizeWorkspaceTerminalRole(
      role || workspaceTerminalFallbackRole,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    const nextIndexes = normalizeWorkspaceTerminalSlotIndexes([...currentIndexes, nextTerminalIndex]);
    const nextTerminalCount = Math.min(MAX_WORKSPACE_TERMINAL_COUNT, nextIndexes.length);
    const nextTerminalRoles = nextIndexes.map((index) => (
      index === nextTerminalIndex ? nextRole : roleByIndex[index] || workspaceTerminalFallbackRole
    ));
    const currentRows = getWorkspaceDisplayTerminalRows(currentDisplayLayouts, workspaceId, currentIndexes);
    const nextDisplayRows = currentRows.length
      ? [...currentRows.map((row) => row.terminalIndexes.slice()), [nextTerminalIndex]]
      : [[nextTerminalIndex]];
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

    return {
      terminalIndex: nextTerminalIndex,
      terminalRole: nextRole,
      workspaceId,
    };
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

  const useDefaultNewWorkspaceRoot = useCallback(() => {
    setNewWorkspaceRootDraft(defaultWorkingDirectory);
    setWorkspaceError("");
  }, [defaultWorkingDirectory]);

  const chooseNewWorkspaceRootDirectory = useCallback(async () => {
    setWorkspaceError("");

    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose workspace root directory",
      });
      const selectedPath = Array.isArray(selected) ? selected[0] : selected;

      if (typeof selectedPath === "string" && selectedPath.trim()) {
        setNewWorkspaceRootDraft(selectedPath);
      }
    } catch (error) {
      setWorkspaceError(getErrorMessage(error, "Unable to choose root directory."));
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

  const enterBackgroundMode = useCallback((event) => {
    event?.stopPropagation?.();
    void invoke("app_enter_background").catch(() => {});
  }, []);

  const buildAppCloseActiveTerminalSnapshot = useCallback((livePayload, source = "app_close") => {
    const liveSnapshot = normalizeTerminalLiveSessionsPayload(livePayload);
    const presenceWorkspaces = terminalPresenceWorkspacesRef.current || [];
    const threadsSnapshot = workspaceThreadsRef.current || {};
    const workspaceList = workspacesRef.current || [];
    const workspaceSettingsSnapshot = workspaceSettingsRef.current || {};
    const grouped = new Map();

    const findPresenceWorkspace = (session) => presenceWorkspaces.find((workspace) => (
      (session.workspaceId && workspace.workspaceId === session.workspaceId)
      || (
        session.workingDirectory
        && workspace.repoPath
        && cleanWorkspaceRootDirectory(workspace.repoPath) === cleanWorkspaceRootDirectory(session.workingDirectory)
      )
    )) || null;

    const findPresenceTerminal = (presenceWorkspace, session) => {
      if (!presenceWorkspace?.terminals?.length) {
        return null;
      }
      return presenceWorkspace.terminals.find((terminal) => (
        (terminal.paneId && terminal.paneId === session.paneId)
        || (
          terminal.terminalInstanceId
          && Number(terminal.terminalInstanceId) === Number(session.instanceId)
        )
        || (
          session.terminalIndex != null
          && Number(terminal.terminalIndex) === Number(session.terminalIndex)
        )
      )) || null;
    };

    const ensureWorkspace = (session, presenceWorkspace) => {
      const workspaceId = session.workspaceId || presenceWorkspace?.workspaceId || "";
      const workspace = workspaceId ? findWorkspaceById(workspaceList, workspaceId) : null;
      const repoPath = session.workingDirectory
        || presenceWorkspace?.repoPath
        || getWorkspaceRootDirectory(workspaceSettingsSnapshot, workspaceId)
        || defaultWorkingDirectoryRef.current
        || "";
      const workspaceName = session.workspaceName
        || presenceWorkspace?.workspaceName
        || workspace?.name
        || (repoPath ? getDirectoryName(repoPath) : "Workspace");
      const key = workspaceId || repoPath || workspaceName;

      if (!grouped.has(key)) {
        grouped.set(key, {
          repoPath,
          workspaceId,
          workspaceName,
          terminals: [],
        });
      }

      return grouped.get(key);
    };

    liveSnapshot.sessions.forEach((session) => {
      const presenceWorkspace = findPresenceWorkspace(session);
      const presenceTerminal = findPresenceTerminal(presenceWorkspace, session);
      const workspaceId = session.workspaceId || presenceWorkspace?.workspaceId || "";
      const terminalIndex = session.terminalIndex ?? presenceTerminal?.terminalIndex ?? null;
      const agentId = normalizeWorkspaceTerminalRole(
        session.agentId || session.agentKind || presenceTerminal?.agentId || WORKSPACE_TERMINAL_ROLE_GENERIC,
        workspaceTerminalFallbackRole,
        workspaceTerminalRoleOptions,
      );
      const workspaceEntry = workspaceId ? threadsSnapshot?.[workspaceId] : null;
      let thread = session.threadId && workspaceEntry?.threads
        ? workspaceEntry.threads[session.threadId]
        : null;
      if (!thread && workspaceId && terminalIndex != null) {
        thread = getWorkspaceThreadForTerminalIndex(threadsSnapshot, workspaceId, terminalIndex);
      }
      const providerBinding = getWorkspaceThreadProviderBinding(thread, agentId);
      const liveTerminal = {
        ...(presenceTerminal || {}),
        agentId,
        inputReady: presenceTerminal?.inputReady,
        instanceId: session.instanceId,
        paneId: session.paneId,
        status: presenceTerminal?.status || "active",
        terminalIndex,
        threadId: session.threadId || presenceTerminal?.threadId || thread?.id || "",
      };
      const groundTruth = getThreadTerminalGroundTruth({
        liveTerminal,
        providerBinding,
        targetRole: agentId,
        thread,
      });
      const presenceRailState = String(
        presenceTerminal?.nativeRailState
          || presenceTerminal?.native_rail_state
          || presenceTerminal?.activityStatus
          || presenceTerminal?.activity_status
          || presenceTerminal?.status
          || "",
      ).trim().toLowerCase();
      const presenceExecutionPhase = String(
        presenceTerminal?.executionPhase
          || presenceTerminal?.execution_phase
          || "",
      ).trim().toLowerCase();
      const presenceTurnStatus = String(
        presenceTerminal?.turnStatus
          || presenceTerminal?.turn_status
          || "",
      ).trim().toLowerCase();
      const presenceReadiness = String(
        presenceTerminal?.readiness
          || presenceTerminal?.terminalReadiness
          || presenceTerminal?.terminal_readiness
          || "",
      ).trim().toLowerCase();
      const presenceStatuses = [
        presenceRailState,
        presenceExecutionPhase,
        presenceTurnStatus,
        presenceReadiness,
      ].filter(Boolean);
      const presenceIdleStatus = presenceStatuses.find((status) => (
        terminalActivityStatusIsSendable(status)
          || ["cancelled", "canceled", "complete", "completed", "done", "idle", "input_ready", "interrupted", "ready"].includes(status)
      ));
      const presenceSaysIdle = Boolean(
        presenceTerminal
          && presenceIdleStatus
      );
      const activityStatus = String(
        presenceSaysIdle
          ? "idle"
          : groundTruth.effectiveActivityStatus
            || thread?.activityStatus
            || providerBinding?.activityStatus
            || "",
      ).trim().toLowerCase();
      const terminalWorkState = String(groundTruth.terminalWorkState || "").trim().toLowerCase();
      const presenceStatus = String(presenceTerminal?.status || "").trim().toLowerCase();
      const visibleStatus = terminalPresenceStatusFromActivityStatus(
        activityStatus
          || presenceTerminal?.nativeRailState
          || presenceTerminal?.native_rail_state
          || presenceStatus
          || "",
        {
          fallbackStatus: presenceStatus || "idle",
          liveStatus: ["closed", "closing", "exited", "offline"].includes(presenceStatus)
            ? presenceStatus
            : "",
          terminalIsParked: groundTruth.terminalIsParked || session.parked,
          terminalIsPromptingUser: groundTruth.terminalIsPromptingUser,
          terminalLifecycle: "open",
        },
      );
      const readiness = terminalReadinessFromPresenceStatus(visibleStatus);
      const nativeRailLabel = formatTerminalNativeRailLabel(
        terminalRailStateFromActivityStatus(activityStatus || visibleStatus, visibleStatus),
      );
      const isReady = Boolean(
        groundTruth.agentInputReady
          || groundTruth.terminalIsComplete
          || readiness === "ready"
          || ["idle", "ready"].includes(visibleStatus)
      );
      const isWorking = !presenceSaysIdle && Boolean(
        ["thinking", "working", "running", "busy"].includes(visibleStatus)
          || readiness === "busy"
          || (
            Boolean(session.hasActiveTask || session.activeTask)
            && (!presenceTerminal || !isReady)
          )
      );
      const promptingUserBlocksShutdown = terminalPromptingUserBlocksShutdown(groundTruth);
      const needsInput = Boolean(
        session.parked
          || session.parkedPrompt
          || groundTruth.terminalIsParked
          || promptingUserBlocksShutdown
          || terminalWorkState === "parked"
          || (terminalWorkState === "prompting_user" && promptingUserBlocksShutdown)
          || (!presenceSaysIdle && visibleStatus === "paused" && (groundTruth.terminalIsParked || promptingUserBlocksShutdown))
      );
      const hasError = Boolean(
        visibleStatus === "error"
          || terminalWorkState === "error"
          || readiness === "error"
      );
      const risk = needsInput
        ? "needs_input"
        : isWorking
          ? "working"
          : hasError
            ? "error"
            : "idle";

      if (risk === "idle") {
        return;
      }

      const group = ensureWorkspace(session, presenceWorkspace);
      const terminalNumber = terminalIndex == null ? "" : String(Number(terminalIndex) + 1);
      group.terminals.push({
        activeTaskTitle: session.activeTask?.title || "",
        agentId,
        agentLabel: presenceTerminal?.agentLabel
          || (agentId === WORKSPACE_TERMINAL_ROLE_GENERIC ? "Terminal" : getManagedAgentLabel(agentId)),
        color: presenceTerminal?.color || TERMINAL_AGENT_COLOR_HEX_BY_SLOT[Number(getTerminalAgentColorSlot(terminalIndex || 0))] || "",
        instanceId: session.instanceId,
        nativeRailLabel,
        paneId: session.paneId,
        parkedPromptTitle: session.parkedPrompt?.title || "",
        readiness,
        risk,
        riskLabel: appCloseTerminalRiskLabel(risk),
        sessionMode: session.sessionMode,
        terminalIndex,
        terminalLabel: terminalNumber ? `Terminal ${terminalNumber}` : "Terminal",
        terminalWorkState,
        threadId: session.threadId || thread?.id || "",
      });
    });

    const workspaces = [...grouped.values()]
      .map((workspace) => ({
        ...workspace,
        terminals: workspace.terminals.sort((left, right) => (
          Number(left.terminalIndex ?? 9999) - Number(right.terminalIndex ?? 9999)
        )),
      }))
      .filter((workspace) => workspace.terminals.length > 0)
      .sort((left, right) => left.workspaceName.localeCompare(right.workspaceName));
    const blockingCount = workspaces.reduce((total, workspace) => total + workspace.terminals.length, 0);

    return {
      ...APP_CLOSE_CONFIRM_INITIAL_STATE,
      blockingCount,
      generatedAtMs: liveSnapshot.generatedAtMs || Date.now(),
      isOpen: blockingCount > 0,
      source,
      terminalCount: liveSnapshot.sessions.length,
      workspaces,
    };
  }, [workspaceTerminalFallbackRole, workspaceTerminalRoleOptions]);

  const readAppCloseActiveTerminalSnapshot = useCallback(async (source = "app_close") => {
    const liveSessions = await invoke("terminal_live_sessions");
    return buildAppCloseActiveTerminalSnapshot(liveSessions, source);
  }, [buildAppCloseActiveTerminalSnapshot]);

  const performCloseWindow = useCallback((eventOrOptions = null, maybeOptions = {}) => {
    const options = eventOrOptions && typeof eventOrOptions === "object" && typeof eventOrOptions.stopPropagation !== "function"
      ? eventOrOptions
      : maybeOptions;
    const event = eventOrOptions && typeof eventOrOptions.stopPropagation === "function"
      ? eventOrOptions
      : null;
    event?.stopPropagation?.();

    const appWindow = getSafeCurrentWindow();

    if (!appWindow) {
      return;
    }

    if (workspaceCloseInFlightRef.current) {
      logTerminalStatus("frontend.app_close.requested", {
        expectedTerminalTotal: normalizeCloseCount(workspaceCloseExpectedTotalRef.current),
        reason: `${options.reason || "app_close"}_retry`,
      });
      return;
    }

    workspaceCloseInFlightRef.current = true;
    workspaceCloseAllowNativeRef.current = false;
    const expectedTerminalTotal = normalizeCloseCount(
      options.expectedTerminalTotal ?? workspaceCloseExpectedTotalRef.current,
    );
    logTerminalStatus("frontend.app_close.requested", {
      expectedTerminalTotal,
      reason: options.reason || "app_close",
    });
    setWorkspaceCloseState({
      ...WORKSPACE_CLOSE_INITIAL_STATE,
      isActive: true,
      closed: 0,
      total: expectedTerminalTotal,
      phase: "closing_webviews",
      phaseDetail: WORKSPACE_SHUTDOWN_STEPS[0].detail,
      phaseLabel: WORKSPACE_SHUTDOWN_STEPS[0].label,
      step: 1,
      terminalTotalKnown: false,
    });

    runWindowAction(async () => {
      let unlistenCloseProgress = null;
      let unlistenShutdownProgress = null;
      let releaseCloseProgressListener = false;

      listen(TERMINAL_CLOSE_ALL_PROGRESS_EVENT, (progressEvent) => {
        const nextProgress = normalizeTerminalCloseProgress(progressEvent.payload);

        setWorkspaceCloseState((currentCloseState) => {
          const currentProgress = normalizeTerminalCloseProgress(currentCloseState);
          const terminalStep = WORKSPACE_SHUTDOWN_STEP_BY_ID.get("closing_terminals");
          const terminalStepIndex = terminalStep?.index ?? 3;
          const currentStepIndex = WORKSPACE_SHUTDOWN_STEP_BY_ID.get(currentCloseState.phase)?.index ?? 0;
          const shouldActivateTerminalPhase = currentStepIndex <= terminalStepIndex;

          return {
            isActive: true,
            phase: shouldActivateTerminalPhase ? "closing_terminals" : currentCloseState.phase,
            phaseDetail: shouldActivateTerminalPhase
              ? terminalStep?.detail || ""
              : currentCloseState.phaseDetail,
            phaseLabel: shouldActivateTerminalPhase
              ? terminalStep?.label || "Closing terminals"
              : currentCloseState.phaseLabel,
            step: shouldActivateTerminalPhase
              ? terminalStepIndex + 1
              : currentCloseState.step,
            terminalTotalKnown: true,
            closed: Math.max(currentProgress.closed, nextProgress.closed),
            total: nextProgress.total,
            totalSteps: currentCloseState.totalSteps || WORKSPACE_SHUTDOWN_STEPS.length,
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
      listen(APP_SHUTDOWN_PROGRESS_EVENT, (progressEvent) => {
        const nextProgress = normalizeShutdownProgress(progressEvent.payload);

        setWorkspaceCloseState((currentCloseState) => {
          const currentProgress = normalizeTerminalCloseProgress(currentCloseState);
          const nextStep = WORKSPACE_SHUTDOWN_STEP_BY_ID.get(nextProgress.phase);
          const currentStepIndex = WORKSPACE_SHUTDOWN_STEP_BY_ID.get(currentCloseState.phase)?.index ?? 0;
          const nextStepIndex = nextStep?.index ?? currentStepIndex;
          const shouldKeepTerminalProgress = nextProgress.phase !== "closing_terminals";

          return {
            isActive: true,
            closed: shouldKeepTerminalProgress
              ? currentProgress.closed
              : Math.max(currentProgress.closed, nextProgress.closed),
            phase: nextProgress.phase,
            phaseDetail: nextProgress.detail,
            phaseLabel: nextProgress.label,
            step: Math.max(currentCloseState.step || 0, nextProgress.step, nextStepIndex + 1),
            terminalTotalKnown: currentCloseState.terminalTotalKnown || nextProgress.terminalTotalKnown,
            total: shouldKeepTerminalProgress
              ? currentProgress.total
              : nextProgress.total,
            totalSteps: Math.max(
              currentCloseState.totalSteps || 0,
              nextProgress.totalSteps,
              WORKSPACE_SHUTDOWN_STEPS.length,
            ),
          };
        });
      })
        .then((unlisten) => {
          if (releaseCloseProgressListener && typeof unlisten === "function") {
            unlisten();
            return;
          }

          unlistenShutdownProgress = unlisten;
        })
        .catch(() => {
          // Phase events are UI-only; backend shutdown is still authoritative.
      });

      try {
        await closeWorkspaceWindowAfterTerminalShutdown();
        workspaceCloseAllowNativeRef.current = true;
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
        if (typeof unlistenShutdownProgress === "function") {
          unlistenShutdownProgress();
        }
      }
    });
  }, []);

  const closeWindow = useCallback((eventOrOptions = null, maybeOptions = {}) => {
    const options = eventOrOptions && typeof eventOrOptions === "object" && typeof eventOrOptions.stopPropagation !== "function"
      ? eventOrOptions
      : maybeOptions;
    const event = eventOrOptions && typeof eventOrOptions.stopPropagation === "function"
      ? eventOrOptions
      : null;
    const reason = options.reason || "app_close";

    event?.preventDefault?.();
    event?.stopPropagation?.();

    if (workspaceCloseInFlightRef.current) {
      performCloseWindow({ reason: `${reason}_retry` });
      return;
    }

    if (appCloseConfirmStateRef.current.isOpen || appCloseConfirmStateRef.current.isLoading) {
      return;
    }

    const loadingConfirmation = {
      ...APP_CLOSE_CONFIRM_INITIAL_STATE,
      isLoading: true,
      source: reason,
    };
    appCloseConfirmStateRef.current = loadingConfirmation;
    setAppCloseConfirmState(loadingConfirmation);

    runWindowAction(async () => {
      try {
        const snapshot = await readAppCloseActiveTerminalSnapshot(reason);
        if (snapshot.blockingCount > 0) {
          appCloseConfirmStateRef.current = snapshot;
          setAppCloseConfirmState(snapshot);
          return;
        }

        appCloseConfirmStateRef.current = APP_CLOSE_CONFIRM_INITIAL_STATE;
        setAppCloseConfirmState(APP_CLOSE_CONFIRM_INITIAL_STATE);
        performCloseWindow({
          expectedTerminalTotal: snapshot.terminalCount,
          reason,
        });
      } catch (error) {
        const errorConfirmation = {
          ...APP_CLOSE_CONFIRM_INITIAL_STATE,
          error: getErrorMessage(error, "Unable to inspect running terminals before shutdown."),
          isOpen: true,
          source: reason,
        };
        appCloseConfirmStateRef.current = errorConfirmation;
        setAppCloseConfirmState(errorConfirmation);
      }
    });
  }, [performCloseWindow, readAppCloseActiveTerminalSnapshot]);

  const cancelAppCloseConfirmation = useCallback(() => {
    const currentConfirmation = appCloseConfirmStateRef.current;
    appCloseConfirmStateRef.current = APP_CLOSE_CONFIRM_INITIAL_STATE;
    setAppCloseConfirmState(APP_CLOSE_CONFIRM_INITIAL_STATE);
    logTerminalStatus("frontend.app_close.cancelled", {
      reason: currentConfirmation.source || "app_close",
    });
  }, []);

  const continueAppCloseAfterConfirmation = useCallback(() => {
    const currentConfirmation = appCloseConfirmStateRef.current;
    appCloseConfirmStateRef.current = APP_CLOSE_CONFIRM_INITIAL_STATE;
    setAppCloseConfirmState(APP_CLOSE_CONFIRM_INITIAL_STATE);
    performCloseWindow({
      expectedTerminalTotal: currentConfirmation.terminalCount,
      reason: `${currentConfirmation.source || "app_close"}_confirmed`,
    });
  }, [performCloseWindow]);

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
      closeWindow({ reason: "native_window_close" });
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
    let isMounted = true;
    let unlistenAppCloseRequested = null;

    listen(APP_CLOSE_REQUESTED_EVENT, (event) => {
      const payload = event.payload || {};
      closeWindow({
        reason: payload.reason || payload.source || "app_exit_requested",
      });
    })
      .then((unlisten) => {
        if (!isMounted && typeof unlisten === "function") {
          unlisten();
          return;
        }

        unlistenAppCloseRequested = unlisten;
      })
      .catch(() => {});

    return () => {
      isMounted = false;

      if (typeof unlistenAppCloseRequested === "function") {
        unlistenAppCloseRequested();
      }
    };
  }, [closeWindow]);

  useEffect(() => {
    checkBackend();
  }, [checkBackend]);

  useEffect(() => {
    let cancelled = false;
    let unlistenSyncStatus = null;

    invoke("cloud_mcp_get_status").then((status) => {
      if (cancelled) {
        return;
      }
      const normalized = cloudSyncStatusFromRuntimeStatus(status);
      if (normalized) {
        setCloudSyncStatus((current) => (current ? current : normalized));
      }
    }).catch(() => {});

    listen("cloud-mcp-sync-status", (event) => {
      if (cancelled) {
        return;
      }
      const normalized = normalizeCloudSyncStatusEvent(event?.payload);
      if (!normalized) {
        return;
      }
      setCloudSyncStatus(normalized);
      if (normalized.connection === "connected") {
        void revalidateOfflineSessionQuietly();
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenSyncStatus = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenSyncStatus) {
        unlistenSyncStatus();
      }
    };
  }, [revalidateOfflineSessionQuietly]);

  useEffect(() => {
    // Remote workspace activation that arrived while the window was closed:
    // the Rust remote-command listener records the intent headless; the next
    // foreground session consumes it here (terminal launch needs the webview).
    if (authState !== "authenticated" || workspaceState !== "ready") {
      return undefined;
    }
    let cancelled = false;
    invoke("app_local_state_load", { key: "remote-intents" }).then((intents) => {
      if (cancelled) {
        return;
      }
      const pendingWorkspaceId = String(intents?.pendingActivationWorkspaceId || "").trim();
      if (!pendingWorkspaceId) {
        return;
      }
      void invoke("app_local_state_merge_command", {
        key: "remote-intents",
        patch: {
          pendingActivationWorkspaceId: null,
          pendingActivationReason: null,
          pendingActivationAtMs: null,
        },
      }).catch(() => {});
      activateWorkspace(pendingWorkspaceId, "remote_control_resume");
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activateWorkspace, authState, workspaceState]);

  useEffect(() => {
    const connection = cloudSyncStatus?.connection || "";
    const previous = cloudSyncConnectionRef.current;
    cloudSyncConnectionRef.current = connection;
    if (connection !== "connected" || previous === "connected" || !previous) {
      return;
    }
    if (authState !== "authenticated" || !isPaidUser(user)) {
      return;
    }
    // Reconnect after an offline stretch: reconcile the catalog right away so
    // pending upserts/deletes captured offline re-push instead of waiting for
    // the next app start. (The Rust outbox backlog drains on its own.)
    loadWorkspaces();
  }, [authState, cloudSyncStatus, loadWorkspaces, user]);

  useEffect(() => {
    if (authState !== "authenticated") {
      setBillingStatus(null);
      setBillingStatusState("idle");
      setBillingStatusError("");
      return undefined;
    }

    let cancelled = false;
    const refresh = async (quiet = false) => {
      if (!cancelled) {
        await refreshBillingStatus({ quiet });
      }
    };

    refresh(false);
    const intervalId = window.setInterval(() => {
      refresh(true);
    }, BILLING_STATUS_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [authState, refreshBillingStatus]);

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

  useEffect(() => {
    if (!newWorkspaceRootDraft && defaultWorkingDirectory) {
      setNewWorkspaceRootDraft(defaultWorkingDirectory);
    }
  }, [defaultWorkingDirectory, newWorkspaceRootDraft]);

  useEffect(() => () => {
    window.clearTimeout(viewTransitionTimeoutRef.current);
    cancelDeferredWorkspaceActivation();
  }, [cancelDeferredWorkspaceActivation]);

  useEffect(() => {
    if (authState === "authenticated") {
      return;
    }

    setWorkspaceState("idle");
    setWorkspaces([]);
    setSelectedWorkspaceId("");
    setActivatedWorkspaceId("");
    setWorkspacePendingActivationId("");
    setWorkspaceSyncState("idle");
    setWorkspaceListHydrated(false);
    setWorkspaceHydrationReady(false);
    setWorkspaceRootDraft("");
    setNewWorkspaceRootDraft("");
    setWorkspaceCreateModalOpen(false);
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
    setWorkspaceSettingsModalId("");
    agentInitialStatusUserRef.current = "";
    startupAgentFlowIdRef.current += 1;
    startupAgentSettingsPendingRef.current = false;
    workspaceAgentLaunchKeyRef.current = "";
    workspaceAgentBatchInFlightKeyRef.current = "";
    workspaceAgentBatchStartedSessionKeysRef.current.clear();
    workspaceAgentBatchInFlightSessionKeysRef.current.clear();
    workspacePendingActivationIdRef.current = "";
    workspaceRuntimeDescriptorLogKeyRef.current = "";
    workspaceRuntimeSelectionLogKeyRef.current = "";
    workspaceMcpStartupIndexEmptyKeyRef.current = "";
    workspaceCoordinationTargetsStateKeyRef.current = "";
    preparedTerminalsRef.current.clear();
    setStartupAgentGateState("idle");
    setStartupAgentUpdateMessage("");
    setWorkspaceAgentLaunchEpoch(0);
    setWorkspaceAgentBatchSentLaunchKey("");
    setPreparedTerminalVersion((version) => version + 1);
    setCloudWorkspaceProgress(CLOUD_WORKSPACE_PROGRESS_INITIAL_STATE);
  }, [authState, setWorkspaceAgentBatchSentLaunchKey]);

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
      // Startup auth resolution happens exactly once per process. The effect
      // re-arms whenever a dependency callback changes identity (billing
      // refreshes used to do this), and re-running validation after the user
      // is in the app flickered login/dashboard.
      if (authStartupFinishedRef.current) {
        return;
      }
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

  useEffect(() => {
    if (
      authState !== "authenticated"
      || workspaceState !== "initializing"
      || isLaunchScreenVisible
      || !workspaceListHydrated
    ) {
      return undefined;
    }

    // The cloud websocket is not a gate: workspaces are local-first and the
    // title-bar sync pill reports Connecting/Syncing/Live Sync while the
    // connection and outbox catch-up continue in the background.
    setWorkspaceState("ready");
    authStore.setMessage("Workspace ready.");

    return undefined;
  }, [
    authState,
    isLaunchScreenVisible,
    user,
    workspaceListHydrated,
    workspaceState,
  ]);

  useEffect(() => {
    if (
      authState !== "authenticated"
      || !isPaidUser(user)
      || !["initializing", "ready"].includes(workspaceState)
    ) {
      return undefined;
    }

    const userKey = `${user?.id || user?.email || "paid-user"}:${activeAccountScopeKey}`;

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
    activeAccountScopeKey,
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

    const selectedAudioProvider = readAudioTranscriptionProvider();
    const canUseCloudRecorder = selectedAudioProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
      || (
        selectedAudioProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
        && Boolean(readDeepgramApiKey().trim())
      );

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
  const authCurrentStage = isAuthBusy && authStage !== "idle"
    ? authStage
    : "browser_handoff";
  const authPanelTitle = {
    deep_link: "Waiting for browser callback",
    session_exchange: "Creating desktop session",
  }[authCurrentStage] || {
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
  const cloudWorkspaceReady = isCloudWorkspaceProgressReady(cloudWorkspaceProgress);
  const cloudWorkspaceStatusState = cloudWorkspaceLaunchState(cloudWorkspaceProgress);
  const cloudWorkspaceTitle = cloudWorkspaceProgress.title || "Preparing cloud workspace";
  const cloudWorkspaceDetail = cloudWorkspaceProgress.detail || "Waiting for the assigned cloud workspace.";
  const shouldShowCloudWorkspaceSetup = userIsPaid && !cloudWorkspaceReady;
  const shouldShowStartupAgentSetup = userIsPaid && cloudWorkspaceReady;
  const planLabel = billingPlanLabelFromStatus(billingStatus, user);
  const billingCredits = billingStatus?.credits || null;
  const billingRemainingCredits = Number(billingCredits?.termRemainingCredits || 0);
  const billingCreditPercent = creditUsagePercent(billingCredits);
  const billingResetLabel = creditResetLabel(billingCredits?.resetAt);
  const billingLowCreditState = String(billingCredits?.lowCreditState || "pending");
  const lowCreditToastVisible = userIsPaid
    && shouldShowLowCreditWarning(billingCredits, dismissedLowCreditWarningKey);
  const dismissLowCreditWarning = useCallback(() => {
    const nextDismissedKey = lowCreditWarningKey(billingStatus?.credits);

    if (!nextDismissedKey) {
      return;
    }

    writeDismissedLowCreditWarningKey(nextDismissedKey);
    setDismissedLowCreditWarningKey(nextDismissedKey);
  }, [billingStatus]);
  const connectedAgentCount = agentStatuses.filter((agent) => agent.installed && agent.authenticated).length;
  const optionalAgentCount = Math.max(0, AGENT_PROVIDERS.length - connectedAgentCount);
  const startupAgentUpdates = getAgentUpdatesAvailable(agentStatuses);
  const startupAgentStatusTitle = startupAgentGateState === "choice"
    ? "Terminal CLI updates available"
    : startupAgentGateState === "updating"
      ? startupAgentUpdateMessage || "Updating terminal CLIs..."
      : startupAgentGateState === "checking"
        ? "Checking terminal CLIs..."
        : startupAgentGateState === "complete"
          ? "Terminal readiness checked"
          : "Preparing terminal CLI check...";
  const startupAgentStatusDetail = startupAgentGateState === "choice"
    ? `${getAgentUpdateSummary(startupAgentUpdates)} Choose whether to update now or enter the workspace without updating.`
    : startupAgentGateState === "updating"
      ? "The workspace will open when the selected updates finish."
      : startupAgentGateState === "checking"
        ? "Terminal CLI readiness is being checked while the workspace loads."
        : startupAgentGateState === "complete"
          ? connectedAgentCount > 0
            ? `${connectedAgentCount} terminal CLI${connectedAgentCount === 1 ? "" : "s"} ready. ${optionalAgentCount} optional provider${optionalAgentCount === 1 ? "" : "s"} unavailable.`
            : "No ready terminal CLIs found. Settings will open so you can install or connect one."
          : "Waiting for the live workspace connection to finish first.";
  const startupAgentStatusState = startupAgentGateState === "choice"
    ? "update"
    : startupAgentGateState === "updating"
      ? "checking"
      : startupAgentGateState !== "complete"
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
  const activatedWorkspaceRootWasEmptyAtSelection = activatedWorkspace
    ? getWorkspaceRootWasEmptyAtSelection(workspaceSettings, activatedWorkspace.id)
    : false;
  const shouldShowWorkspaceSetup = workspaceSyncState !== "loading" && workspaces.length === 0;
  const shouldPrewarmWorkspaceTerminals = true;
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
  const selectedWorkspaceAgentSessionMode = selectedWorkspace && !shouldShowWorkspaceSetup
    ? getWorkspaceAgentSessionMode(workspaceSettings, selectedWorkspace.id)
    : AGENT_SESSION_MODE_COORDINATED;
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
  const workspaceRuntimeThreadSignature = useMemo(() => (
    enabledRuntimeWorkspaceIds.map((workspaceId) => {
      const workspaceThreadState = workspaceThreads?.[workspaceId] || {};
      const terminalSignature = Object.values(workspaceThreadState.terminals || {})
        .map((terminal) => [
          Number(terminal?.terminalIndex ?? -1),
          terminal?.threadId || terminal?.id || "",
          terminal?.status || "",
          terminal?.activityStatus || "",
          terminal?.paneId || "",
        ].join(":"))
        .sort()
        .join(",");
      const threadSignature = Object.values(workspaceThreadState.threads || {})
        .map((thread) => [
          thread?.id || "",
          thread?.terminalIndex ?? "",
          thread?.activityStatus || "",
          thread?.currentAgent || "",
          thread?.transcriptSessionId || "",
          thread?.latestTurn?.state || "",
          thread?.updatedAt || "",
        ].join(":"))
        .sort()
        .join(",");

      return `${workspaceId}[${terminalSignature}][${threadSignature}]`;
    }).join("|")
  ), [enabledRuntimeWorkspaceIds, workspaceThreads]);
  const enabledWorkspaceRuntimeDescriptors = useMemo(() => {
    const startedAtMs = getWorkspaceActivationDiagnosticNowMs();
    if (shouldShowWorkspaceSetup) {
      workspaceRuntimeDescriptorBuildRef.current = {
        descriptorCount: 0,
        elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - startedAtMs),
        enabledRuntimeWorkspaceIds,
        logicalTerminalCount: 0,
        reason: "workspace_setup",
      };
      return [];
    }

    const descriptors = enabledRuntimeWorkspaceIds
      .map((workspaceId) => findWorkspaceById(workspaces, workspaceId))
      .filter(Boolean)
      .map((runtimeWorkspace) => {
        const rootDirectory = getWorkspaceRootDirectory(workspaceSettings, runtimeWorkspace.id);
        const workingDirectory = rootDirectory || defaultWorkingDirectory;
        const rootWasEmptyAtSelection = getWorkspaceRootWasEmptyAtSelection(
          workspaceSettings,
          runtimeWorkspace.id,
        );
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
        const terminalsByIndex = Object.fromEntries(
          Object.values(workspaceThreads?.[runtimeWorkspace.id]?.terminals || {})
            .map((terminal) => [Number(terminal?.terminalIndex), terminal])
            .filter(([terminalIndex]) => Number.isInteger(terminalIndex)),
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
          terminalsByIndex,
          terminalRolesByIndex,
          threadsByIndex,
          rootWasEmptyAtSelection,
          workingDirectory,
          workspace: runtimeWorkspace,
        };
      });

    workspaceRuntimeDescriptorBuildRef.current = {
      descriptorCount: descriptors.length,
      descriptors: descriptors.map((descriptor) => ({
        agentTerminalCount: descriptor.agentTerminalEntries.length,
        logicalTerminalCount: descriptor.logicalTerminalCount,
        rootWasEmptyAtSelection: descriptor.rootWasEmptyAtSelection,
        terminalIndexes: descriptor.logicalTerminalIndexes,
        workingDirectory: descriptor.workingDirectory,
        workspaceId: descriptor.workspace?.id || "",
        workspaceName: descriptor.workspace?.name || "",
      })),
      elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - startedAtMs),
      enabledRuntimeWorkspaceIds,
      logicalTerminalCount: descriptors.reduce((sum, descriptor) => (
        sum + Number(descriptor.logicalTerminalCount || 0)
      ), 0),
      reason: "built",
    };

    return descriptors;
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
    workspaceRuntimeThreadSignature,
    workspaces,
  ]);
  const workspaceStartupWarmupTargets = useMemo(() => {
    const targets = [];
    const seen = new Set();

    enabledWorkspaceRuntimeDescriptors.forEach((descriptor) => {
      const workspaceId = String(descriptor.workspace?.id || "").trim();
      const repoPath = cleanWorkspaceRootDirectory(descriptor.workingDirectory || "");
      const key = `${workspaceId}:${getWorkspaceRootIdentity(repoPath)}`;
      if (!workspaceId || !repoPath || seen.has(key)) {
        return;
      }

      seen.add(key);
      targets.push({
        key,
        repoPath,
        workspaceId,
        workspaceName: descriptor.workspace?.name || "",
      });
    });

    return targets;
  }, [enabledWorkspaceRuntimeDescriptors]);
  const workspaceStartupWarmupTargetKey = useMemo(
    () => JSON.stringify(workspaceStartupWarmupTargets.map((target) => [
      target.workspaceId,
      getWorkspaceRootIdentity(target.repoPath),
      target.workspaceName,
    ])),
    [workspaceStartupWarmupTargets],
  );
  useEffect(() => {
    if (
      authState !== "authenticated"
      || shouldShowWorkspaceSetup
      || !workspaceStartupWarmupTargets.length
    ) {
      return undefined;
    }

    let disposed = false;
    const cancelTasks = workspaceStartupWarmupTargets.map((target, index) => (
      scheduleWorkspaceStartupIdleTask(() => {
        if (disposed) {
          return;
        }

        startWorkspaceArchitectureScan(target.workspaceId, {
          reason: "app_startup_idle",
          rootDirectory: target.repoPath,
        });
      }, {
        delayMs: WORKSPACE_APP_STARTUP_SCAN_IDLE_DELAY_MS
          + (index * WORKSPACE_APP_STARTUP_WARMUP_STAGGER_MS),
        timeoutMs: WORKSPACE_APP_STARTUP_IDLE_TIMEOUT_MS,
      })
    ));

    logWorkspaceActivationTrace("workspace.open.architecture_scan.startup_scheduled", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
      targetCount: workspaceStartupWarmupTargets.length,
      targets: workspaceStartupWarmupTargets.map((target) => ({
        repoPath: target.repoPath,
        workspaceId: target.workspaceId,
        workspaceName: target.workspaceName,
      })),
    });

    return () => {
      disposed = true;
      cancelTasks.forEach((cancelTask) => cancelTask());
    };
  }, [
    authState,
    logWorkspaceActivationTrace,
    shouldShowWorkspaceSetup,
    startWorkspaceArchitectureScan,
    workspaceStartupWarmupTargetKey,
    workspaceStartupWarmupTargets,
  ]);
  useEffect(() => {
    const snapshot = workspaceRuntimeDescriptorBuildRef.current;
    if (!snapshot) {
      return;
    }

    const logFields = {
      ...snapshot,
      activatedWorkspaceId,
      selectedWorkspaceId,
      workspaceActivationDeferred,
      workspaceHydrationReady,
    };
    const logKey = JSON.stringify(logFields);
    if (workspaceRuntimeDescriptorLogKeyRef.current === logKey) {
      return;
    }

    workspaceRuntimeDescriptorLogKeyRef.current = logKey;
    logWorkspaceActivationTrace("workspace.open.runtime_descriptors", activatedWorkspaceId || selectedWorkspaceId, logFields);
  }, [
    activatedWorkspaceId,
    enabledWorkspaceRuntimeDescriptors,
    logWorkspaceActivationTrace,
    selectedWorkspaceId,
    workspaceActivationDeferred,
    workspaceHydrationReady,
  ]);
  const selectedWorkspaceRuntimeDescriptor = useMemo(() => (
    selectedWorkspace?.id
      ? enabledWorkspaceRuntimeDescriptors.find((descriptor) => (
        descriptor.workspace?.id === selectedWorkspace.id
      )) || null
      : null
  ), [enabledWorkspaceRuntimeDescriptors, selectedWorkspace?.id]);
  const workspaceSidebarOrderById = useMemo(() => {
    const order = new Map();
    (workspaces || []).forEach((workspace, index) => {
      const workspaceId = String(workspace?.id || "").trim();
      if (workspaceId && !order.has(workspaceId)) {
        order.set(workspaceId, index);
      }
    });
    return order;
  }, [workspaces]);
  const terminalPresenceWorkspaces = useMemo(() => (
    enabledWorkspaceRuntimeDescriptors
      .map((descriptor) => {
        const repoPath = String(descriptor.workingDirectory || "").trim();
        const workspaceId = String(descriptor.workspace?.id || "").trim();
        if (!repoPath || !workspaceId) {
          return null;
        }

        const displayedTerminalIndexes = normalizeWorkspaceTerminalSlotIndexes(
          flattenWorkspaceDisplayRows(descriptor.displayRows),
        ).filter((terminalIndex) => descriptor.logicalTerminalIndexes.includes(terminalIndex));
        const presenceTerminalIndexes = displayedTerminalIndexes.length
          ? displayedTerminalIndexes
          : descriptor.logicalTerminalIndexes;
        const terminals = presenceTerminalIndexes
          .map((terminalIndex) => {
            const normalizedRole = normalizeWorkspaceTerminalRole(
              descriptor.terminalRolesByIndex?.[terminalIndex],
              workspaceTerminalFallbackRole,
              workspaceTerminalRoleOptions,
            );
            const thread = descriptor.threadsByIndex?.[terminalIndex] || null;
            const providerBinding = getWorkspaceThreadProviderBinding(thread, normalizedRole);
            const terminalBinding = providerBinding?.terminalBinding || thread?.terminalBinding || null;
            const liveTerminalCandidate = descriptor.terminalsByIndex?.[terminalIndex] || null;
            const liveTerminalAgent = normalizeWorkspaceTerminalRole(
              liveTerminalCandidate?.agentId || normalizedRole,
              workspaceTerminalFallbackRole,
              workspaceTerminalRoleOptions,
            );
            const liveTerminal = (
              liveTerminalCandidate
              && liveTerminalAgent === normalizedRole
            )
              ? liveTerminalCandidate
              : null;
            const terminalGroundTruth = getThreadTerminalGroundTruth({
              liveTerminal,
              providerBinding,
              targetRole: normalizedRole,
              thread,
            });
            const colorSlot = getTerminalAgentColorSlot(terminalIndex);
            const color = TERMINAL_AGENT_COLOR_HEX_BY_SLOT[Number(colorSlot)] || "";
            const hasSession = Boolean(
              thread?.transcriptSessionId
                || providerBinding?.nativeSessionId
                || providerBinding?.nativeSessionTitle,
            );
            const latestTurn = thread?.latestTurn && typeof thread.latestTurn === "object"
              ? thread.latestTurn
              : {};
            const liveStatus = String(liveTerminal?.status || "").trim().toLowerCase();
            const terminalLifecycle = liveTerminal || hasSession ? "open" : "closed";
            const liveRailActivity = String(
              liveTerminal?.activityStatus
                || liveTerminal?.activity_status
                || "",
            ).trim().toLowerCase();
            const rawActivity = String(
              liveRailActivity
                || terminalGroundTruth.effectiveActivityStatus
                || thread?.activityStatus
                || providerBinding?.activityStatus
                || "",
            ).trim().toLowerCase();
            const statusActivity = rawActivity
              || (liveStatus === "error" ? "error" : "")
              || (liveStatus === "starting" ? "starting" : "");
            const status = terminalPresenceStatusFromActivityStatus(statusActivity, {
              fallbackStatus: "idle",
              liveStatus: ["closed", "closing", "exited", "offline"].includes(liveStatus)
                ? liveStatus
                : "",
              terminalIsParked: terminalGroundTruth.terminalIsParked,
              terminalIsPromptingUser: terminalGroundTruth.terminalIsPromptingUser,
              terminalLifecycle,
            });
            const readiness = terminalReadinessFromPresenceStatus(status);
            const turnStatus = terminalTurnStatusFromActivityStatus(statusActivity || status, status);
            const nativeRailState = ["closed", "closing", "exited", "offline"].includes(status)
              ? status
              : terminalRailStateFromActivityStatus(statusActivity || status, status);
            const nativeRailFields = getTerminalNativeRailStateFields(nativeRailState);
            const agentLabel = normalizedRole === WORKSPACE_TERMINAL_ROLE_GENERIC
              ? "Terminal"
              : getManagedAgentLabel(normalizedRole);
            const agentType = String(
              providerBinding?.agentType
                || providerBinding?.agent_type
                || liveTerminal?.agentType
                || liveTerminal?.agent_type
                || "",
            ).trim();
            const agentDisplayName = String(
              providerBinding?.agentDisplayName
                || providerBinding?.agent_display_name
                || liveTerminal?.agentDisplayName
                || liveTerminal?.agent_display_name
                || agentType
                || "",
            ).trim();
            const terminalNickname = getWorkspaceThreadTerminalNickname(thread, providerBinding, liveTerminal);
            const terminalName = String(
              terminalNickname
                || liveTerminal?.terminalName
                || liveTerminal?.terminal_name
                || liveTerminal?.displayName
                || liveTerminal?.display_name
                || providerBinding?.terminalName
                || providerBinding?.terminal_name
                || agentDisplayName
                || agentLabel,
            ).trim();
            const terminalInstanceId = terminalBinding?.instanceId || liveTerminal?.instanceId || "";
            const paneId = terminalBinding?.paneId
              || getWorkspaceTerminalPaneId(workspaceId, terminalIndex, normalizedRole);
            const statusSeq = Number(
              thread?.projectionEventCount
                || thread?.revision
                || latestTurn?.sequence
                || latestTurn?.seq
                || 0,
            ) || Date.parse(
              thread?.updatedAt
                || latestTurn?.updatedAt
                || latestTurn?.completedAt
                || latestTurn?.createdAt
                || "",
            ) || 0;
            return {
              agentId: normalizedRole,
              agentKind: normalizedRole,
              agentLabel,
              agentDisplayName,
              agent_display_name: agentDisplayName,
              agentType,
              agent_type: agentType,
              activityStatus: nativeRailState,
              activity_status: nativeRailState,
              color,
              colorSlot,
              inputReady: Boolean(terminalLifecycle === "open" && readiness === "ready"),
              ...nativeRailFields,
              paneId,
              readiness,
              sessionState: terminalLifecycle === "open" ? "session_attached" : "no_session",
              status,
              statusSeq,
              terminalEpoch: `${paneId}:${terminalInstanceId || "0"}`,
              terminalIndex,
              terminalInstanceId,
              terminalLifecycle,
              displayName: terminalName,
              terminalName,
              terminal_name: terminalName,
              terminalNickname,
              terminal_nickname: terminalNickname,
              threadId: thread?.id || createWorkspaceThreadId(workspaceId, terminalIndex),
              turnId: latestTurn?.id || latestTurn?.turnId || "",
              turnStatus,
            };
          })
          .filter(Boolean);

        return {
          repoPath,
          workspaceActive: true,
          workspaceId,
          workspaceIndex: workspaceSidebarOrderById.get(workspaceId) ?? 0,
          workspaceName: descriptor.workspace?.name || workspaceId,
          workspaceOrder: workspaceSidebarOrderById.get(workspaceId) ?? 0,
          workspaceStatus: "active",
          terminals,
        };
      })
      .filter(Boolean)
  ), [
    enabledWorkspaceRuntimeDescriptors,
    workspaceSidebarOrderById,
    workspaceTerminalFallbackRole,
    workspaceTerminalRoleOptions,
  ]);
  const terminalPresenceSyncKey = useMemo(
    () => JSON.stringify(terminalPresenceWorkspaces),
    [terminalPresenceWorkspaces],
  );
  const selectedWorkspaceTerminalOptions = useMemo(() => {
    const presenceWorkspace = terminalPresenceWorkspaces.find((candidate) => (
      String(candidate?.workspaceId || "").trim() === String(selectedWorkspaceId || "").trim()
    ));
    return (Array.isArray(presenceWorkspace?.terminals) ? presenceWorkspace.terminals : [])
      .map((terminal) => {
        const terminalIndex = Number(terminal?.terminalIndex ?? terminal?.terminal_index);
        if (!Number.isInteger(terminalIndex)) return null;
        return {
          agentId: String(terminal?.agentId || terminal?.agent_id || "").trim(),
          agentLabel: String(terminal?.agentLabel || terminal?.agentDisplayName || "").trim(),
          color: String(terminal?.color || "").trim(),
          label: String(
            terminal?.terminalNickname
              || terminal?.terminalName
              || terminal?.displayName
              || terminal?.agentDisplayName
              || "",
          ).trim() || `Terminal ${terminalIndex + 1}`,
          paneId: String(terminal?.paneId || terminal?.pane_id || "").trim(),
          terminalIndex,
          threadId: String(terminal?.threadId || terminal?.thread_id || "").trim(),
        };
      })
      .filter(Boolean);
  }, [selectedWorkspaceId, terminalPresenceWorkspaces]);
  useEffect(() => {
    terminalPresenceWorkspacesRef.current = terminalPresenceWorkspaces;
  }, [terminalPresenceWorkspaces]);
  const nextTerminalStatusEventSeq = useCallback((terminalKey, candidateSeq = 0) => {
    const key = String(terminalKey || "terminal").trim() || "terminal";
    const previousSeq = Number(terminalStatusEventSeqRef.current.get(key) || 0);
    const candidate = Number(candidateSeq || 0);
    const wallClock = Date.now();
    const nextSeq = Math.max(previousSeq + 1, candidate + 1, wallClock);
    terminalStatusEventSeqRef.current.set(key, nextSeq);
    return nextSeq;
  }, []);

  function scheduleTerminalStatusEventSyncFlush(syncKey, delayMs = 0) {
    const key = String(syncKey || "").trim();
    if (!key || typeof window === "undefined") {
      return;
    }
    const timers = terminalStatusEventSyncTimersRef.current;
    const existingTimer = timers.get(key);
    if (existingTimer) {
      window.clearTimeout(existingTimer);
    }
    const timer = window.setTimeout(() => {
      timers.delete(key);
      flushTerminalStatusEventSync(key);
    }, Math.max(0, Number(delayMs) || 0));
    timers.set(key, timer);
  }

  function sendTerminalStatusEventSync(item = {}) {
    const syncKey = String(item.syncKey || "").trim();
    if (syncKey) {
      terminalStatusEventSyncInFlightRef.current.add(syncKey);
    }
    logTerminalStatus("frontend.terminal_status.event_sync.send", {
      agentId: item.agentId,
      coalesced: item.coalesced === true,
      eventType: item.eventType,
      commandPhase: item.commandPhase,
      executionPhase: item.executionPhase,
      paneId: item.paneId,
      readinessAfter: item.readinessAfter,
      reason: item.reason,
      statusAfter: item.statusAfter,
      statusSeq: item.statusSeq,
      terminalIndex: item.terminalIndex,
      threadId: item.threadId,
      workspaceId: item.workspaceId,
    });
    const releaseStatusSyncGate = () => {
      if (!syncKey) {
        return;
      }
      terminalStatusEventSyncInFlightRef.current.delete(syncKey);
      if (terminalStatusEventSyncQueueRef.current.has(syncKey)) {
        scheduleTerminalStatusEventSyncFlush(syncKey, 1000);
      }
    };
    void invoke("cloud_mcp_sync_terminal_status_event", {
      workspace: item.workspacePayload,
      terminal: item.terminalPayload,
      reason: item.reason,
    }).catch((error) => {
      logTerminalStatus("frontend.terminal_status.event_sync.error", {
        agentId: item.agentId,
        eventType: item.eventType,
        message: getErrorMessage(error, "Unable to sync terminal status event."),
        paneId: item.paneId,
        statusAfter: item.statusAfter,
        statusSeq: item.statusSeq,
        terminalIndex: item.terminalIndex,
        threadId: item.threadId,
        workspaceId: item.workspaceId,
      });
      void recordCloudConnectionDiagnostic(item.diagnosticToken, {
        channel: "rust-client-sync",
        step: "rust.sync.terminal_status_event",
        status: "error",
        message: getErrorMessage(error, "Unable to sync terminal status event."),
        details: {
          eventType: item.eventType,
          statusAfter: item.statusAfter,
          statusSeq: item.statusSeq,
          terminalIndex: item.terminalIndex,
          workspaceId: item.workspaceId,
        },
      });
    }).finally(() => {
      releaseStatusSyncGate();
    });
    return Promise.resolve({ queued: true });
  }

  function flushTerminalStatusEventSync(syncKey) {
    const key = String(syncKey || "").trim();
    if (!key) {
      return;
    }
    if (terminalStatusEventSyncInFlightRef.current.has(key)) {
      scheduleTerminalStatusEventSyncFlush(key, 1000);
      return;
    }
    const item = terminalStatusEventSyncQueueRef.current.get(key);
    if (!item) {
      return;
    }
    const hotDelayMs = getTerminalInputHotDelayMs(900);
    if (
      hotDelayMs > 0
      && !["closed", "closing", "exited", "provider-turn-error"].includes(item.eventType)
    ) {
      scheduleTerminalStatusEventSyncFlush(key, hotDelayMs);
      return;
    }
    terminalStatusEventSyncQueueRef.current.delete(key);
    void sendTerminalStatusEventSync({
      ...item,
      coalesced: true,
    });
  }

  useEffect(() => () => {
    terminalStatusEventSyncTimersRef.current.forEach((timer) => {
      window.clearTimeout(timer);
    });
    terminalStatusEventSyncTimersRef.current.clear();
    terminalStatusEventSyncQueueRef.current.clear();
    terminalStatusEventSyncInFlightRef.current.clear();
  }, []);

  const emitTerminalStatusEvent = useCallback((event = {}, options = {}) => {
    const earlyEventType = String(options.eventType || event.eventType || event.type || "terminal.status").trim();
    if (
      authState !== "authenticated"
      || !isPaidUser(user)
      || !workspaceHydrationReady
      || shouldShowWorkspaceSetup
      || workspaceSyncState === "loading"
    ) {
      if (earlyEventType === "provider-turn-completed") {
        logTerminalStatus("frontend.terminal_status.event_sync.skip", {
          authState,
          eventType: earlyEventType,
          isPaidUser: isPaidUser(user),
          paneId: options.paneId || event.paneId || "",
          reason: "app_not_ready_for_status_sync",
          shouldShowWorkspaceSetup,
          threadId: options.threadId || event.threadId || "",
          workspaceHydrationReady,
          workspaceId: options.workspaceId || event.workspaceId || "",
          workspaceSyncState,
        });
      }
      return;
    }
    const workspaceId = String(options.workspaceId || event.workspaceId || "").trim();
    if (!workspaceId) {
      return;
    }
    const eventType = String(options.eventType || event.eventType || event.type || "terminal.status").trim();
    const statusSyncReason = options.reason || event.source || eventType;
    const hookStatusSyncedByRust = Boolean(
      options.cloudStatusSyncedByRust === true
        || event.cloudStatusSyncedByRust === true
        || String(statusSyncReason || "").trim().startsWith("cli-hook:")
    );
    if (hookStatusSyncedByRust) {
      logTerminalStatus("frontend.terminal_status.event_sync.skip", {
        eventType,
        paneId: options.paneId || event.paneId || "",
        reason: "hook_lifecycle_synced_by_rust",
        source: statusSyncReason,
        threadId: options.threadId || event.threadId || "",
        workspaceId,
      });
      return;
    }

    const requestedTerminalIndex = Number.parseInt(
      options.terminalIndex ?? event.terminalIndex ?? "",
      10,
    );
    const hasRequestedTerminalIndex = Number.isInteger(requestedTerminalIndex) && requestedTerminalIndex >= 0;
    const presenceWorkspace = terminalPresenceWorkspacesRef.current.find((workspace) => (
      String(workspace?.workspaceId || workspace?.workspace_id || "").trim() === workspaceId
    ));
    const eventPaneId = String(options.paneId || event.paneId || event.pane_id || "").trim();
    const eventThreadId = String(options.threadId || event.threadId || event.thread_id || "").trim();
    let presenceTerminal = null;
    if (eventPaneId || eventThreadId) {
      presenceTerminal = (presenceWorkspace?.terminals || []).find((terminal) => (
        (eventPaneId && String(terminal?.paneId || terminal?.pane_id || "").trim() === eventPaneId)
          || (eventThreadId && String(terminal?.threadId || terminal?.thread_id || "").trim() === eventThreadId)
      )) || null;
    }
    if (!presenceTerminal && hasRequestedTerminalIndex) {
      presenceTerminal = (presenceWorkspace?.terminals || []).find((terminal) => (
        Number(terminal?.terminalIndex ?? terminal?.terminal_index ?? -1) === requestedTerminalIndex
      )) || null;
    }
    const presenceTerminalIndex = Number(presenceTerminal?.terminalIndex ?? presenceTerminal?.terminal_index);
    const safeTerminalIndex = hasRequestedTerminalIndex
      ? requestedTerminalIndex
      : Number.isInteger(presenceTerminalIndex) && presenceTerminalIndex >= 0
        ? presenceTerminalIndex
        : 0;
    const workspaceRecord = workspaces.find((workspace) => String(workspace?.id || "").trim() === workspaceId);
    const repoPath = String(
      presenceWorkspace?.repoPath
        || presenceWorkspace?.repo_path
        || getWorkspaceRootDirectory(workspaceSettings, workspaceId)
        || selectedWorkspaceRootDirectory
        || defaultWorkingDirectory
        || "",
    ).trim();
    if (!repoPath) {
      return;
    }

    const rawStatus = String(options.status || options.statusAfter || event.status || event.activityStatus || "").trim().toLowerCase();
    const parkedStatusEvent = terminalStatusEventIndicatesParked(event, options);
    const permissionPromptStatusEvent = terminalStatusEventHasExplicitPermissionPrompt(event, options);
    const pausedStatusEvent = Boolean(
      terminalStatusEventIndicatesPaused(event, options)
        && (parkedStatusEvent || permissionPromptStatusEvent)
    );
    const idleStatusEvent = terminalStatusEventForcesIdle(eventType) && !pausedStatusEvent;
    const eventActivityStatus = idleStatusEvent
      ? ""
      : String(options.activityStatus || event.activityStatus || "").trim().toLowerCase();
    const statusLifecycleHint = (
      ["closed", "exited"].includes(eventType)
        ? "closed"
        : eventType === "closing" || rawStatus === "closing"
          ? "closing"
          : "open"
    );
    const statusActivity = (idleStatusEvent ? "idle" : eventActivityStatus)
      || (
        eventType === "provider-turn-completed"
        || eventType === "provider-turn-interrupted"
          ? "idle"
          : ""
      )
      || (
        eventType === "message-submitted"
        || eventType === "provider-turn-started"
        || eventType === "thread-starting"
        || eventType === "agent-output"
          ? "thinking"
          : ""
      )
      || rawStatus
      || "";
    const statusAfter = (() => {
      if (["closed", "exited"].includes(eventType)) return "closed";
      if (eventType === "closing" || rawStatus === "closing") return "closing";
      if (eventType === "provider-turn-error" || rawStatus === "error" || rawStatus === "failed") return "error";
      return terminalPresenceStatusFromActivityStatus(statusActivity, {
        fallbackStatus: "idle",
        liveStatus: ["closed", "closing", "exited", "offline"].includes(rawStatus)
          ? rawStatus
          : "",
        terminalIsParked: parkedStatusEvent,
        terminalIsPromptingUser: permissionPromptStatusEvent,
        terminalLifecycle: statusLifecycleHint,
      });
    })();
    const rawReadinessAfter = String(options.readiness || options.readinessAfter || "").trim().toLowerCase();
    const readinessAfter = (rawReadinessAfter === "needs_input" && !pausedStatusEvent ? "" : rawReadinessAfter) || (() => {
      return terminalReadinessFromPresenceStatus(statusAfter);
    })();
    const turnStatus = String(options.turnStatus || event.turnStatus || "").trim().toLowerCase() || (() => {
      if (eventType === "provider-turn-interrupted") return "interrupted";
      return terminalTurnStatusFromActivityStatus(statusActivity || statusAfter, statusAfter);
    })();
    const commandPhase = terminalCommandPhaseFromLifecycleEvent(eventType, {
      commandPhase: options.commandPhase || options.command_phase || event.commandPhase || event.command_phase,
      readiness: readinessAfter,
      status: statusAfter,
      turnStatus,
    });
    const executionPhase = terminalExecutionPhaseFromState({
      activityStatus: statusActivity,
      commandPhase,
      eventType,
      readiness: readinessAfter,
      status: statusAfter,
      terminalLifecycle: statusLifecycleHint,
      turnStatus,
    });
    const canonicalRailState = terminalRailStateFromExecutionPhase(
      executionPhase,
      statusActivity || statusAfter || "idle",
    );
    const agentId = String(
      options.agentId
        || event.agentId
        || presenceTerminal?.agentId
        || presenceTerminal?.agentKind
        || presenceTerminal?.agent_kind
        || "",
    ).trim().toLowerCase() || "terminal";
    const agentLabel = String(
      options.agentLabel
        || options.agent_label
        || event.agentLabel
        || event.agent_label
        || presenceTerminal?.agentLabel
        || presenceTerminal?.agent_label
        || getManagedAgentLabel(agentId),
    ).trim() || getManagedAgentLabel(agentId);
    const agentType = String(
      options.agentType
        || options.agent_type
        || event.agentType
        || event.agent_type
        || presenceTerminal?.agentType
        || presenceTerminal?.agent_type
        || "",
    ).trim();
    const agentDisplayName = String(
      options.agentDisplayName
        || options.agent_display_name
        || event.agentDisplayName
        || event.agent_display_name
        || presenceTerminal?.agentDisplayName
        || presenceTerminal?.agent_display_name
        || agentType
        || "",
    ).trim();
    const terminalNickname = String(
      options.terminalNickname
        || options.terminal_nickname
        || event.terminalNickname
        || event.terminal_nickname
        || presenceTerminal?.terminalNickname
        || presenceTerminal?.terminal_nickname
        || "",
    ).trim();
    const terminalName = String(
      terminalNickname
        || options.terminalName
        || options.terminal_name
        || options.displayName
        || options.display_name
        || event.terminalName
        || event.terminal_name
        || event.displayName
        || event.display_name
        || presenceTerminal?.terminalName
        || presenceTerminal?.terminal_name
        || presenceTerminal?.displayName
        || presenceTerminal?.display_name
        || agentDisplayName
        || agentLabel,
    ).trim();
    const paneId = String(
      options.paneId
        || event.paneId
        || presenceTerminal?.paneId
        || presenceTerminal?.pane_id
        || getWorkspaceTerminalPaneId(workspaceId, safeTerminalIndex, agentId),
    ).trim();
    const terminalInstanceId = event.instanceId
      || event.terminalInstanceId
      || presenceTerminal?.terminalInstanceId
      || presenceTerminal?.terminal_instance_id
      || "";
    const threadId = String(
      options.threadId
        || event.threadId
        || presenceTerminal?.threadId
        || presenceTerminal?.thread_id
        || createWorkspaceThreadId(workspaceId, safeTerminalIndex),
    ).trim();
    const terminalKey = [
      workspaceId,
      paneId,
      terminalInstanceId || "0",
      threadId,
      safeTerminalIndex,
    ].join(":");
    const statusSeq = nextTerminalStatusEventSeq(
      terminalKey,
      Number(options.statusSeq || event.statusSeq || presenceTerminal?.statusSeq || presenceTerminal?.status_seq || 0),
    );
    const dedupKey = [
      workspaceId,
      paneId,
      threadId,
      eventType,
      statusAfter,
      readinessAfter,
      turnStatus,
    ].join(":");
    const previousDedup = terminalStatusEventDedupRef.current.get(dedupKey) || 0;
    const observedAtMs = Date.now();
    if (observedAtMs - previousDedup < 120) {
      return;
    }
    terminalStatusEventDedupRef.current.set(dedupKey, observedAtMs);

    const workspacePayload = {
      repoPath,
      workspaceActive: true,
      workspaceId,
      workspaceName: presenceWorkspace?.workspaceName
        || presenceWorkspace?.workspace_name
        || workspaceRecord?.name
        || workspaceId,
      workspaceStatus: "active",
    };
    const terminalLifecycle = statusAfter === "closed"
      ? "closed"
      : statusAfter === "closing"
        ? "closing"
        : "open";
    const explicitNativeRailState = String(
      options.nativeRailState
        || options.native_rail_state
        || event.nativeRailState
        || event.native_rail_state
        || "",
    ).trim().toLowerCase();
    const safeExplicitNativeRailState = idleStatusEvent && terminalActivityStatusIsBusy(explicitNativeRailState)
      ? ""
      : explicitNativeRailState;
    const nativeRailState = safeExplicitNativeRailState || (
      ["closed", "closing", "exited", "offline"].includes(statusAfter)
        ? statusAfter
        : canonicalRailState || terminalRailStateFromActivityStatus(statusActivity || statusAfter, statusAfter)
    );
    const visibleActivityStatus = canonicalRailState || terminalRailStateFromActivityStatus(statusActivity || statusAfter, statusAfter);
    const explicitNativeRailLabel = String(
      options.nativeRailLabel
        || options.native_rail_label
        || event.nativeRailLabel
        || event.native_rail_label
        || "",
    ).trim();
    const safeExplicitNativeRailLabel = idleStatusEvent && terminalActivityStatusIsBusy(explicitNativeRailLabel)
      ? ""
      : explicitNativeRailLabel;
    const nativeRailFields = getTerminalNativeRailStateFields(
      nativeRailState,
      safeExplicitNativeRailLabel,
    );
    const parkedPromptTitle = String(
      options.parkedPromptTitle
        || options.parked_prompt_title
        || options.parkedTitle
        || options.parked_title
        || event.parkedPromptTitle
        || event.parked_prompt_title
        || event.parkedTitle
        || event.parked_title
        || event.title
        || "",
    ).trim();
    const waitingOn = Array.isArray(options.waitingOn || options.waiting_on)
      ? (options.waitingOn || options.waiting_on)
      : Array.isArray(event.waitingOn || event.waiting_on)
        ? (event.waitingOn || event.waiting_on)
        : [];
    const explicitlyClearsParked = Boolean(
      options.clearsParked === true
        || options.clears_parked === true
        || options.clearParked === true
        || options.clear_parked === true
        || event.clearsParked === true
        || event.clears_parked === true
        || event.clearParked === true
        || event.clear_parked === true,
    );
    const terminalPayload = {
      agentId,
      agentKind: agentId,
      agentLabel,
      agentDisplayName,
      agent_display_name: agentDisplayName,
      agentType,
      agent_type: agentType,
      activityStatus: visibleActivityStatus,
      activity_status: visibleActivityStatus,
      color: presenceTerminal?.color || "",
      colorSlot: presenceTerminal?.colorSlot ?? presenceTerminal?.color_slot ?? getTerminalAgentColorSlot(safeTerminalIndex),
      eventId: `${terminalKey}:${statusSeq}`,
      eventType,
      commandPhase,
      command_phase: commandPhase,
      displayStatus: visibleActivityStatus,
      display_status: visibleActivityStatus,
      executionPhase,
      execution_phase: executionPhase,
      inputReady: readinessAfter === "ready",
      ...nativeRailFields,
      observedAtMs,
      paneId,
      parked: pausedStatusEvent ? true : explicitlyClearsParked ? false : undefined,
      parkedPromptTitle: parkedPromptTitle || undefined,
      parked_prompt_title: parkedPromptTitle || undefined,
      readiness: readinessAfter,
      readinessAfter,
      sessionState: statusAfter === "closed" ? "no_session" : "session_attached",
      status: statusAfter,
      statusAfter,
      statusSeq,
      terminalEpoch: `${paneId}:${terminalInstanceId || "0"}`,
      terminalId: paneId,
      terminalIndex: safeTerminalIndex,
      terminalInstanceId,
      terminalLifecycle,
      displayName: terminalName,
      terminalName,
      terminal_name: terminalName,
      terminalNickname,
      terminal_nickname: terminalNickname,
      threadId,
      turnId: event.turnId || event.activeTurnId || presenceTerminal?.turnId || presenceTerminal?.turn_id || "",
      turnStatus,
      waitingOn,
      waiting_on: waitingOn,
    };

    const diagnosticToken = authStore.getToken();
    const statusSyncKey = terminalKey;
    if (eventType === "provider-turn-completed") {
      logTerminalStatus("frontend.terminal_status.event_sync.completion_decision", {
        activityStatus: statusActivity,
        agentId,
        commandPhase,
        eventType,
        executionPhase,
        nativeRailState,
        paneId,
        readinessAfter,
        reason: statusSyncReason,
        statusAfter,
        terminalIndex: safeTerminalIndex,
        threadId,
        turnStatus,
        visibleActivityStatus,
        workspaceId,
      });
    }
    const terminalStatusSyncItem = {
      agentId,
      commandPhase,
      diagnosticToken,
      eventType,
      executionPhase,
      paneId,
      readinessAfter,
      reason: statusSyncReason,
      statusAfter,
      statusSeq,
      syncKey: statusSyncKey,
      terminalIndex: safeTerminalIndex,
      terminalPayload,
      threadId,
      workspacePayload,
      workspaceId,
    };
    const statusSyncDelayMs = (() => {
      if (["closed", "closing", "exited", "provider-turn-error"].includes(eventType)) {
        return 250;
      }
      if (eventType === "message-submitted") {
        return 900;
      }
      if (eventType === "agent-output") {
        return 1400;
      }
      return 1100;
    })();
    terminalStatusEventSyncQueueRef.current.set(statusSyncKey, terminalStatusSyncItem);
    scheduleTerminalStatusEventSyncFlush(statusSyncKey, statusSyncDelayMs);
    logTerminalStatus("frontend.terminal_status.event_sync.coalesced", {
      agentId,
      eventType,
      paneId,
      reason: statusSyncReason,
      statusAfter,
      statusSeq,
      terminalIndex: safeTerminalIndex,
      threadId,
      workspaceId,
    });
  }, [
    authState,
    defaultWorkingDirectory,
    nextTerminalStatusEventSeq,
    selectedWorkspaceRootDirectory,
    shouldShowWorkspaceSetup,
    user,
    workspaceHydrationReady,
    workspaceSettings,
    workspaceSyncState,
    workspaces,
  ]);
  useEffect(() => {
    terminalStatusEventEmitterRef.current = emitTerminalStatusEvent;
  }, [emitTerminalStatusEvent]);
  const workspaceCatalogSyncTargets = useMemo(() => {
    if (shouldShowWorkspaceSetup) {
      return [];
    }

    const targets = [];
    const seen = new Set();
    const activeWorkspaceIds = new Set(enabledRuntimeWorkspaceIds.map((workspaceId) => String(workspaceId || "").trim()));
    // Stable terminal identity (names/colors/agents — not volatile statuses)
    // rides along with the catalog so other devices and the web dashboard keep
    // last-known terminal labels even after this device disconnects.
    const presenceTerminalsByWorkspaceId = new Map();
    terminalPresenceWorkspaces.forEach((presenceWorkspace) => {
      const presenceWorkspaceId = String(presenceWorkspace?.workspaceId || "").trim();
      if (!presenceWorkspaceId || !Array.isArray(presenceWorkspace?.terminals)) {
        return;
      }
      presenceTerminalsByWorkspaceId.set(
        presenceWorkspaceId,
        presenceWorkspace.terminals.slice(0, 32).map((terminal) => ({
          agentKind: String(terminal?.agentKind || terminal?.agentId || ""),
          agentLabel: String(terminal?.agentLabel || ""),
          color: String(terminal?.color || ""),
          colorSlot: Number(terminal?.colorSlot ?? 0),
          terminalIndex: Number(terminal?.terminalIndex ?? 0),
          terminalName: String(terminal?.terminalName || terminal?.displayName || ""),
        })),
      );
    });
    const addTarget = (workspace, activeOverride = null, workspaceIndex = 0) => {
      const workspaceId = String(workspace?.id || "").trim();
      if (!workspaceId) {
        return;
      }
      const key = workspaceId;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      let rootDirectory = getWorkspaceRootDirectory(workspaceSettings, workspaceId);
      if (!rootDirectory && String(selectedWorkspace?.id || "").trim() === workspaceId) {
        rootDirectory = selectedWorkspaceRootDirectory || defaultWorkingDirectory;
      }
      rootDirectory = cleanWorkspaceRootDirectory(rootDirectory || "");
      const workspaceActive = activeOverride === null
        ? activeWorkspaceIds.has(workspaceId)
        : Boolean(activeOverride);
      targets.push({
        dashboardWorkspace: true,
        displaySurface: "dashboard_workspace",
        logicalTerminalCount: getWorkspaceTerminalCount(workspaceSettings, workspaceId),
        mountId: "",
        projectName: "",
        repoPath: rootDirectory,
        terminals: presenceTerminalsByWorkspaceId.get(workspaceId) || [],
        workspaceActive,
        workspaceId,
        workspaceIndex,
        workspaceName: workspace?.name || workspaceId,
        workspaceOrder: workspaceIndex,
        workspaceRole: "desktop_workspace",
        workspaceRoot: rootDirectory,
        workspaceStatus: workspaceActive ? "active" : "deactivated",
      });
    };

    workspaces.forEach((workspace, workspaceIndex) => {
      addTarget(
        workspace,
        activeWorkspaceIds.has(String(workspace?.id || "").trim()),
        workspaceIndex,
      );
    });

    return targets;
  }, [
    defaultWorkingDirectory,
    enabledRuntimeWorkspaceIds,
    selectedWorkspace,
    selectedWorkspaceRootDirectory,
    shouldShowWorkspaceSetup,
    terminalPresenceWorkspaces,
    workspaceSettings,
    workspaces,
  ]);
  const workspaceCatalogSyncKey = useMemo(
    () => JSON.stringify(workspaceCatalogSyncTargets),
    [workspaceCatalogSyncTargets],
  );
  const workspaceMcpSyncTargets = useMemo(
    () => workspaceCatalogSyncTargets.filter((target) => String(target?.repoPath || "").trim()),
    [workspaceCatalogSyncTargets],
  );
  const workspaceMcpSyncTargetKey = useMemo(
    () => JSON.stringify(workspaceMcpSyncTargets),
    [workspaceMcpSyncTargets],
  );

  useEffect(() => {
    if (
      authState !== "authenticated"
      || !isPaidUser(user)
      || !workspaceHydrationReady
      || workspaceActivationDeferred
      || shouldShowWorkspaceSetup
      || workspaceSyncState === "loading"
      || workspaceSyncState === "creating"
    ) {
      return undefined;
    }

    const targets = workspaceCatalogSyncTargets.filter((target) => target?.workspaceId);
    if (targets.length === 0) {
      return undefined;
    }

    const accountKey = user?.id || user?.email || "paid-user";
    const syncKey = JSON.stringify({
      accountKey,
      targets: targets.map((target) => ({
        active: Boolean(target.workspaceActive),
        repoPath: getWorkspaceRootIdentity(target.repoPath || ""),
        terminalCount: Number(target.logicalTerminalCount || 0),
        terminals: Array.isArray(target.terminals) ? target.terminals : [],
        workspaceId: target.workspaceId,
        workspaceName: target.workspaceName || "",
      })),
    });

    if (workspaceCatalogSyncKeyRef.current === syncKey) {
      return undefined;
    }

    let disposed = false;
    let syncTimer = 0;
    const diagnosticToken = authStore.getToken();

    const syncWorkspaceCatalog = async () => {
      const hotDelayMs = getTerminalInputHotDelayMs(1000);
      if (hotDelayMs > 0) {
        syncTimer = window.setTimeout(() => {
          syncTimer = 0;
          void syncWorkspaceCatalog().catch((error) => {
            if (!disposed) {
              workspaceCatalogSyncKeyRef.current = "";
              logBigViewSyncDiagnosticEvent("cloud_mcp.workspace_catalog_sync.failed", {
                message: getErrorMessage(error, "Unable to sync workspace catalog."),
                workspaceCount: targets.length,
              });
            }
          });
        }, hotDelayMs);
        return;
      }

      workspaceCatalogSyncKeyRef.current = syncKey;
      void recordCloudConnectionDiagnostic(diagnosticToken, {
        channel: "rust-client-sync",
        step: "rust.sync.workspace_catalog",
        status: "start",
        message: "Rust client is syncing the desktop workspace catalog to cloud.",
        details: {
          workspaceCount: targets.length,
        },
      });

      try {
        await invoke("cloud_mcp_sync_device_workspace_catalog", {
          reason: "desktop_workspace_catalog",
          workspaces: targets,
        });
        if (disposed) {
          return;
        }
        await recordCloudConnectionDiagnostic(diagnosticToken, {
          channel: "rust-client-sync",
          step: "rust.sync.workspace_catalog",
          status: "ok",
          message: "Rust client workspace catalog sync completed.",
          details: {
            workspaceCount: targets.length,
          },
        });
      } catch (error) {
        if (!disposed) {
          workspaceCatalogSyncKeyRef.current = "";
          logBigViewSyncDiagnosticEvent("cloud_mcp.workspace_catalog_sync.failed", {
            message: getErrorMessage(error, "Unable to sync workspace catalog."),
            workspaceCount: targets.length,
          });
          await recordCloudConnectionDiagnostic(diagnosticToken, {
            channel: "rust-client-sync",
            step: "rust.sync.workspace_catalog",
            status: "error",
            message: getErrorMessage(error, "Unable to sync workspace catalog."),
            details: {
              workspaceCount: targets.length,
            },
          });
        }
      }
    };

    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      void syncWorkspaceCatalog();
    }, 500);

    return () => {
      disposed = true;
      if (syncTimer) {
        window.clearTimeout(syncTimer);
      }
    };
  }, [
    authState,
    getTerminalInputHotDelayMs,
    shouldShowWorkspaceSetup,
    user,
    workspaceCatalogSyncKey,
    workspaceCatalogSyncTargets,
    workspaceHydrationReady,
    workspaceActivationDeferred,
    workspaceSyncState,
  ]);

  useEffect(() => {
    if (
      authState !== "authenticated"
      || !isPaidUser(user)
      || !workspaceHydrationReady
      || workspaceActivationDeferred
      || shouldShowWorkspaceSetup
      || workspaceSyncState === "loading"
      || workspaceSyncState === "creating"
    ) {
      return undefined;
    }

    const eligibleTargets = workspaceMcpSyncTargets.filter((target) => (
      target?.workspaceId && target?.repoPath
    ));
    const targets = eligibleTargets;

    if (targets.length === 0) {
      return undefined;
    }

    const accountKey = user?.id || user?.email || "paid-user";
    const syncKey = JSON.stringify({
      accountKey,
      targets: targets.map((target) => ({
        repoPath: getWorkspaceRootIdentity(target.repoPath),
        workspaceId: target.workspaceId,
        workspaceName: target.workspaceName || "",
      })),
    });

    if (workspaceCloudSyncKeyRef.current === syncKey) {
      return undefined;
    }

    let disposed = false;
    let syncTimer = 0;
    const diagnosticToken = authStore.getToken();

    const syncHydratedWorkspaces = async () => {
      const hotDelayMs = getTerminalInputHotDelayMs(1600);
      if (hotDelayMs > 0) {
        syncTimer = window.setTimeout(() => {
          syncTimer = 0;
          void syncHydratedWorkspaces().catch((error) => {
            if (!disposed) {
              workspaceCloudSyncKeyRef.current = "";
              logBigViewSyncDiagnosticEvent("cloud_mcp.workspace_sync.failed", {
                message: getErrorMessage(error, "Unable to sync hydrated workspaces."),
                workspaceCount: targets.length,
              });
            }
          });
        }, hotDelayMs);
        return;
      }

      workspaceCloudSyncKeyRef.current = syncKey;
      void recordCloudConnectionDiagnostic(diagnosticToken, {
        channel: "rust-client-sync",
        step: "rust.sync.workspace_state",
        status: "start",
        message: "Rust client is syncing hydrated workspaces to cloud.",
        details: {
          workspaceCount: targets.length,
        },
      });
      const results = [];

      for (const target of targets) {
        if (disposed) {
          return;
        }

        try {
          await invoke("cloud_mcp_sync_workspace", {
            repoPath: target.repoPath,
            workspaceId: target.workspaceId,
            workspaceName: target.workspaceName || target.workspaceId,
          });
          results.push({ ok: true, workspaceId: target.workspaceId });
        } catch (error) {
          results.push({
            ok: false,
            message: getErrorMessage(error, "Unable to sync workspace."),
            workspaceId: target.workspaceId,
          });
        }
      }

      if (disposed) {
        return;
      }

      const failed = results.filter((result) => !result.ok);
      if (failed.length === results.length) {
        workspaceCloudSyncKeyRef.current = "";
      }

      await recordCloudConnectionDiagnostic(diagnosticToken, {
        channel: "rust-client-sync",
        step: "rust.sync.workspace_state",
        status: failed.length === 0 ? "ok" : failed.length === results.length ? "error" : "warn",
        message: failed.length === 0
          ? "Rust client hydrated workspace sync completed."
          : "Rust client hydrated workspace sync completed with failures.",
        details: {
          failedWorkspaceIds: failed.map((result) => result.workspaceId),
          workspaceCount: results.length,
        },
      });
    };

    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      void syncHydratedWorkspaces().catch((error) => {
        if (!disposed) {
          workspaceCloudSyncKeyRef.current = "";
          logBigViewSyncDiagnosticEvent("cloud_mcp.workspace_sync.failed", {
            message: getErrorMessage(error, "Unable to sync hydrated workspaces."),
            workspaceCount: targets.length,
          });
        }
      });
    }, 900);

    return () => {
      disposed = true;
      if (syncTimer) {
        window.clearTimeout(syncTimer);
      }
    };
  }, [
    authState,
    getTerminalInputHotDelayMs,
    shouldShowWorkspaceSetup,
    user,
    workspaceHydrationReady,
    workspaceActivationDeferred,
    workspaceMcpSyncTargetKey,
    workspaceMcpSyncTargets,
    workspaceSyncState,
  ]);

  useEffect(() => {
    if (
      authState !== "authenticated"
      || !isPaidUser(user)
      || !workspaceHydrationReady
      || workspaceActivationDeferred
      || shouldShowWorkspaceSetup
      || workspaceSyncState === "loading"
      || workspaceSyncState === "creating"
    ) {
      return undefined;
    }

    let disposed = false;
    const reason = "terminal_presence_snapshot";
    const syncKey = `${terminalPresenceSyncKey}:${reason}`;
    if (terminalPresenceSyncKeyRef.current === syncKey) {
      return undefined;
    }

    terminalPresenceSyncPendingRef.current = {
      diagnosticToken: authStore.getToken(),
      reason,
      syncKey,
      terminalCount: terminalPresenceWorkspaces.reduce(
        (sum, workspace) => sum + (Array.isArray(workspace?.terminals) ? workspace.terminals.length : 0),
        0,
      ),
      workspaces: terminalPresenceWorkspaces,
      workspaceCount: terminalPresenceWorkspaces.length,
    };

    const flushPresence = () => {
      terminalPresenceSyncTimerRef.current = 0;
      if (disposed) {
        return;
      }
      const pending = terminalPresenceSyncPendingRef.current;
      if (!pending || terminalPresenceSyncKeyRef.current === pending.syncKey) {
        terminalPresenceSyncPendingRef.current = null;
        return;
      }
      const hotDelayMs = getTerminalInputHotDelayMs(1200);
      if (hotDelayMs > 0) {
        terminalPresenceSyncTimerRef.current = window.setTimeout(flushPresence, hotDelayMs);
        return;
      }
      if (terminalPresenceSyncInFlightRef.current) {
        terminalPresenceSyncTimerRef.current = window.setTimeout(flushPresence, 1000);
        return;
      }

      terminalPresenceSyncPendingRef.current = null;
      terminalPresenceSyncInFlightRef.current = true;
      if (!disposed) {
        terminalPresenceSyncKeyRef.current = pending.syncKey;
      }
      const releasePresenceSyncGate = () => {
        terminalPresenceSyncInFlightRef.current = false;
        if (
          terminalPresenceSyncPendingRef.current
          && terminalPresenceSyncPendingRef.current.syncKey !== terminalPresenceSyncKeyRef.current
          && !disposed
          && !terminalPresenceSyncTimerRef.current
        ) {
          terminalPresenceSyncTimerRef.current = window.setTimeout(flushPresence, 1000);
        }
      };
      window.setTimeout(releasePresenceSyncGate, 0);
      invoke("cloud_mcp_sync_terminal_presence", {
        workspaces: pending.workspaces,
        reason: pending.reason,
      })
        .then((response) => {
          const responseData = unwrapCloudCommandData(response, {});
          const stored = responseData?.stored && typeof responseData.stored === "object"
            ? responseData.stored
            : responseData;
          const storedCount = Number(stored?.stored_count ?? responseData?.stored_count ?? 0);
          if (storedCount >= pending.terminalCount) {
            return;
          }
          const closedCount = Number(stored?.closed_count ?? responseData?.closed_count ?? 0);
          const inputTerminalCount = Number(stored?.input_terminal_count ?? responseData?.input_terminal_count ?? 0);
          const fallbackTerminalCount = Number(stored?.fallback_terminal_count ?? responseData?.fallback_terminal_count ?? 0);
          const responseWorkspaceCount = Number(stored?.workspace_count ?? responseData?.workspace_count ?? 0);
          logBigViewSyncDiagnosticEvent("cloud_mcp.terminal_presence_sync.partial", {
            closedCount,
            fallbackTerminalCount,
            inputTerminalCount,
            reason: pending.reason,
            responseWorkspaceCount,
            storedCount,
            terminalCount: pending.terminalCount,
            workspaceCount: pending.workspaceCount,
          });
        })
        .catch((error) => {
          if (!disposed) {
            logBigViewSyncDiagnosticEvent("cloud_mcp.terminal_presence_sync.failed", {
              message: getErrorMessage(error, "Unable to sync terminal presence."),
              reason: pending.reason,
              workspaceCount: pending.workspaceCount,
            });
          }
          void recordCloudConnectionDiagnostic(pending.diagnosticToken, {
            channel: "rust-client-sync",
            step: "rust.sync.terminal_presence",
            status: "error",
            message: getErrorMessage(error, "Unable to sync terminal presence."),
            details: {
              reason: pending.reason,
              terminalCount: pending.terminalCount,
              workspaceCount: pending.workspaceCount,
            },
          });
        })
        .finally(() => {
          releasePresenceSyncGate();
        });
    };

    if (terminalPresenceSyncTimerRef.current) {
      window.clearTimeout(terminalPresenceSyncTimerRef.current);
    }
    terminalPresenceSyncTimerRef.current = window.setTimeout(flushPresence, 900);

    return () => {
      disposed = true;
      if (terminalPresenceSyncTimerRef.current) {
        window.clearTimeout(terminalPresenceSyncTimerRef.current);
        terminalPresenceSyncTimerRef.current = 0;
      }
    };
  }, [
    authState,
    getTerminalInputHotDelayMs,
    shouldShowWorkspaceSetup,
    terminalPresenceSyncKey,
    terminalPresenceWorkspaces,
    user,
    workspaceHydrationReady,
    workspaceActivationDeferred,
    workspaceSyncState,
  ]);

  useEffect(() => {
    if (
      authState !== "authenticated"
      || !isPaidUser(user)
      || !workspaceHydrationReady
      || workspaceActivationDeferred
      || shouldShowWorkspaceSetup
      || workspaceSyncState === "loading"
      || workspaceSyncState === "creating"
    ) {
      return undefined;
    }

    let disposed = false;
    let syncTimer = 0;
    const scheduleWorkspaceMcpSync = (reason, delayMs = 0) => {
      if (disposed) {
        return;
      }
      if (syncTimer) {
        window.clearTimeout(syncTimer);
      }
      syncTimer = window.setTimeout(() => {
        syncTimer = 0;
        void syncWorkspaceMcps(reason);
      }, Math.max(0, Number(delayMs) || 0));
    };
    const syncWorkspaceMcps = async (reason) => {
      if (disposed) {
        return;
      }
      const syncKey = `${workspaceMcpSyncTargetKey}:${reason}`;
      if (reason === "workspace_mcp_snapshot" && workspaceMcpSyncKeyRef.current === syncKey) {
        return;
      }
      const hotDelayMs = getTerminalInputHotDelayMs(1600);
      if (hotDelayMs > 0) {
        scheduleWorkspaceMcpSync(reason, hotDelayMs);
        return;
      }

      const diagnosticToken = authStore.getToken();
      try {
        await recordCloudConnectionDiagnostic(diagnosticToken, {
          channel: "rust-client-sync",
          step: "rust.sync.workspace_mcps",
          status: "start",
          message: "Rust client is collecting workspace MCP settings for cloud sync.",
          details: {
            reason,
            workspaceCount: workspaceMcpSyncTargets.length,
          },
        });
        const workspacesForCloud = await Promise.all(
          workspaceMcpSyncTargets.map(async (target) => {
            const response = await invoke("coordination_workspace_mcp_registry", {
              repoPath: target.repoPath,
              workspaceId: target.workspaceId,
              workspaceName: target.workspaceName,
            });
            return sanitizeWorkspaceMcpRegistryForCloud(response, target);
          }),
        );
        const syncResponse = await invoke("cloud_mcp_sync_workspace_mcp_snapshot", {
          workspaces: workspacesForCloud,
          reason,
        });
        const responseData = unwrapCloudCommandData(syncResponse, {});
        const stored = responseData?.stored && typeof responseData.stored === "object"
          ? responseData.stored
          : responseData;
        const storedCount = Number(stored?.stored_count ?? responseData?.stored_count ?? 0);
        const enabledCount = Number(stored?.enabled_count ?? responseData?.enabled_count ?? 0);
        const declaredServerCount = Number(stored?.declared_server_count ?? responseData?.declared_server_count ?? 0);
        const responseWorkspaceCount = Number(stored?.workspace_count ?? responseData?.workspace_count ?? 0);
        const serverCount = workspacesForCloud.reduce(
          (sum, workspace) => sum + (Array.isArray(workspace?.servers) ? workspace.servers.length : 0),
          0,
        );
        await recordCloudConnectionDiagnostic(diagnosticToken, {
          channel: "rust-client-sync",
          step: "rust.sync.workspace_mcps",
          status: storedCount < serverCount ? "warn" : "ok",
          message: storedCount < serverCount
            ? "Rust client workspace MCP sync stored fewer servers than expected."
            : "Rust client workspace MCP sync completed.",
          details: {
            declaredServerCount,
            enabledCount,
            reason,
            responseWorkspaceCount,
            serverCount,
            storedCount,
            workspaceCount: workspacesForCloud.length,
          },
        });
        if (!disposed) {
          workspaceMcpSyncKeyRef.current = syncKey;
        }
      } catch (error) {
        if (!disposed) {
          logBigViewSyncDiagnosticEvent("cloud_mcp.workspace_mcp_sync.failed", {
            message: getErrorMessage(error, "Unable to sync workspace MCP settings."),
            reason,
            workspaceCount: workspaceMcpSyncTargets.length,
          });
        }
        await recordCloudConnectionDiagnostic(diagnosticToken, {
          channel: "rust-client-sync",
          step: "rust.sync.workspace_mcps",
          status: "error",
          message: getErrorMessage(error, "Unable to sync workspace MCP settings."),
          details: {
            reason,
            workspaceCount: workspaceMcpSyncTargets.length,
          },
        });
      }
    };

    scheduleWorkspaceMcpSync("workspace_mcp_snapshot", 900);
    const handleWorkspaceMcpRegistryUpdated = () => {
      scheduleWorkspaceMcpSync("workspace_mcp_registry_updated", 250);
    };
    window.addEventListener(
      WORKSPACE_MCP_REGISTRY_UPDATED_EVENT,
      handleWorkspaceMcpRegistryUpdated,
    );
    const intervalId = window.setInterval(
      () => scheduleWorkspaceMcpSync("workspace_mcp_heartbeat"),
      WORKSPACE_MCP_SYNC_INTERVAL_MS,
    );

    return () => {
      disposed = true;
      if (syncTimer) {
        window.clearTimeout(syncTimer);
      }
      window.removeEventListener(
        WORKSPACE_MCP_REGISTRY_UPDATED_EVENT,
        handleWorkspaceMcpRegistryUpdated,
      );
      window.clearInterval(intervalId);
    };
  }, [
    authState,
    getTerminalInputHotDelayMs,
    shouldShowWorkspaceSetup,
    user,
    workspaceMcpSyncTargetKey,
    workspaceMcpSyncTargets,
    workspaceHydrationReady,
    workspaceActivationDeferred,
    workspaceSyncState,
  ]);

  useEffect(() => {
    if (authState !== "authenticated" || !isPaidUser(user)) {
      return undefined;
    }

    // Tokenomics sync scheduling (startup scan, 60s heartbeat, server-refresh
    // triggers) now runs in Rust (cloud_mcp_start_tokenomics_scheduler), so it
    // keeps syncing with no visible window. The webview keeps only the manual
    // force-resync hook used by the Tokenomics settings actions.
    tokenomicsForceResyncRef.current = () => {
      void invoke("cloud_mcp_schedule_tokenomics_sync", {
        full: true,
        reason: "tokenomics_server_refresh",
        resyncLast30Days: true,
      }).catch((error) => {
        logBigViewSyncDiagnosticEvent("cloud_mcp.tokenomics_sync.failed", {
          message: getErrorMessage(error, "Unable to sync Tokenomics."),
          reason: "tokenomics_server_refresh",
        });
      });
    };

    return () => {
      tokenomicsForceResyncRef.current = null;
    };
  }, [activeAccountScopeKey, authState, user]);

  useEffect(() => {
    if (
      authState !== "authenticated"
      || !isPaidUser(user)
      || shouldShowWorkspaceSetup
      || workspaceSyncState === "loading"
    ) {
      logWorkspaceActivationTrace("workspace.open.workspace_mcp_index.skip", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
        authState,
        isPaidUser: isPaidUser(user),
        reason: "gate_not_ready",
        shouldShowWorkspaceSetup,
        workspaceSyncState,
      });
      return;
    }

    const targets = workspaceStartupWarmupTargets.filter((target) => (
      !workspaceMcpStartupIndexKeysRef.current.has(target.key)
    ));

    if (!targets.length) {
      const emptyKey = workspaceStartupWarmupTargetKey;
      if (workspaceMcpStartupIndexEmptyKeyRef.current !== emptyKey) {
        workspaceMcpStartupIndexEmptyKeyRef.current = emptyKey;
        logWorkspaceActivationTrace("workspace.open.workspace_mcp_index.empty", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
          reason: workspaceStartupWarmupTargets.length
            ? "already_indexed_or_in_flight"
            : "no_startup_warmup_targets",
          targetCount: workspaceStartupWarmupTargets.length,
        });
      }
      return undefined;
    }
    workspaceMcpStartupIndexEmptyKeyRef.current = "";

    let disposed = false;
    const indexTargets = () => {
      if (disposed) {
        return;
      }
      targets.forEach((target) => {
        workspaceMcpStartupIndexKeysRef.current.add(target.key);
        const startedAtMs = getWorkspaceActivationDiagnosticNowMs();
        logWorkspaceActivationTrace("workspace.open.workspace_mcp_index.start", target.workspaceId, {
          repoPath: target.repoPath,
          targetCount: targets.length,
          workspaceName: target.workspaceName,
        });
        invoke("coordination_workspace_mcp_registry_background", {
          repoPath: target.repoPath,
          workspaceId: target.workspaceId,
          workspaceName: target.workspaceName,
        }).then((response) => {
          const responseData = response?.data || response || {};
          const jobKey = String(responseData.jobKey || responseData.job_key || target.key).trim();
          if (jobKey) {
            workspaceMcpStartupIndexJobsRef.current.set(jobKey, {
              startedAtMs,
              targetKey: target.key,
            });
          }
          logWorkspaceActivationTrace("workspace.open.workspace_mcp_index.queued", target.workspaceId, {
            inFlight: responseData.inFlight ?? responseData.in_flight ?? false,
            jobKey,
            mode: "background",
            queued: responseData.queued !== false,
            repoPath: target.repoPath,
            targetCount: targets.length,
            workspaceName: target.workspaceName,
          });
        }).catch((error) => {
          logWorkspaceActivationTrace("workspace.open.workspace_mcp_index.error", target.workspaceId, {
            elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - startedAtMs),
            message: getErrorMessage(error, "Unable to index workspace MCP registry."),
            repoPath: target.repoPath,
            targetCount: targets.length,
            workspaceName: target.workspaceName,
          });
          workspaceMcpStartupIndexKeysRef.current.delete(target.key);
        });
      });
    };
    const hotDelayMs = getTerminalInputHotDelayMs(1000);
    const delayMs = Math.max(
      WORKSPACE_APP_STARTUP_MCP_INDEX_IDLE_DELAY_MS,
      hotDelayMs,
    );
    logWorkspaceActivationTrace("workspace.open.workspace_mcp_index.scheduled", activatedWorkspaceIdRef.current || selectedWorkspaceIdRef.current, {
      delayMs,
      hotDelayMs,
      mode: "app_startup_idle",
      targetCount: targets.length,
    });
    const cancelIndexTargets = scheduleWorkspaceStartupIdleTask(indexTargets, {
      delayMs,
      timeoutMs: WORKSPACE_APP_STARTUP_IDLE_TIMEOUT_MS,
    });
    return () => {
      disposed = true;
      cancelIndexTargets();
    };
  }, [
    authState,
    getTerminalInputHotDelayMs,
    logWorkspaceActivationTrace,
    shouldShowWorkspaceSetup,
    user,
    workspaceStartupWarmupTargetKey,
    workspaceStartupWarmupTargets,
    workspaceSyncState,
  ]);

  useEffect(() => {
    if (authState !== "authenticated" || shouldShowWorkspaceSetup) {
      logWorkspaceActivationTrace("workspace.open.shared_mcp.skip", activatedWorkspaceId || selectedWorkspaceId, {
        authState,
        reason: authState !== "authenticated" ? "auth_not_ready" : "workspace_setup",
        shouldShowWorkspaceSetup,
      });
      return;
    }

    const desiredTargets = new Map();

    workspaceStartupWarmupTargets.forEach((target) => {
      const workspaceId = target.workspaceId || "";
      const repoPath = target.repoPath || "";
      const runtimeKey = workspaceRuntimeActivationKey(workspaceId, repoPath);

      if (!runtimeKey) {
        return;
      }

      desiredTargets.set(runtimeKey, {
        repoPath,
        workspaceId,
        workspaceName: target.workspaceName || "",
      });
    });

    desiredTargets.forEach((target, runtimeKey) => {
      if (sharedMcpActiveRuntimeTargetsRef.current.has(runtimeKey)) {
        return;
      }

      sharedMcpActiveRuntimeTargetsRef.current.set(runtimeKey, target);

      const startedAtMs = getWorkspaceActivationDiagnosticNowMs();
      logWorkspaceActivationTrace("workspace.open.shared_mcp.activate_start", target.workspaceId, {
        repoPath: target.repoPath,
        runtimeKey,
        workspaceName: target.workspaceName,
      });

      withTimeout(
        invoke("coordination_activate_shared_mcp_daemon_background", {
          repoPath: target.repoPath,
          workspaceId: target.workspaceId,
          workspaceName: target.workspaceName,
        }),
        WORKSPACE_SHARED_MCP_TIMEOUT_MS,
        "Shared MCP activation queue timed out.",
      )
        .then((response) => {
          const responseData = response?.data || response || {};
          const jobKey = String(responseData.jobKey || responseData.job_key || runtimeKey).trim();
          if (jobKey) {
            sharedMcpBackgroundJobsRef.current.set(jobKey, {
              runtimeKey,
              startedAtMs,
              target,
            });
          }
          logWorkspaceActivationTrace("workspace.open.shared_mcp.queued", target.workspaceId, {
            inFlight: responseData.inFlight ?? responseData.in_flight ?? false,
            jobKey,
            mode: "background",
            queued: responseData.queued !== false,
            repoPath: target.repoPath,
            runtimeKey,
            workspaceName: target.workspaceName,
          });
        })
        .catch((error) => {
          logWorkspaceActivationTrace("workspace.open.shared_mcp.activate_error", target.workspaceId, {
            elapsedMs: Math.max(0, getWorkspaceActivationDiagnosticNowMs() - startedAtMs),
            message: getErrorMessage(error, "Unable to queue shared MCP activation."),
            mode: "background",
            repoPath: target.repoPath,
            runtimeKey,
            workspaceName: target.workspaceName,
          });
          if (sharedMcpActiveRuntimeTargetsRef.current.get(runtimeKey) === target) {
            sharedMcpActiveRuntimeTargetsRef.current.delete(runtimeKey);
          }
        });
    });

    Array.from(sharedMcpActiveRuntimeTargetsRef.current.entries()).forEach(([runtimeKey, target]) => {
      if (desiredTargets.has(runtimeKey)) {
        return;
      }

      sharedMcpActiveRuntimeTargetsRef.current.delete(runtimeKey);

      logWorkspaceActivationTrace("workspace.open.shared_mcp.deactivate_start", target.workspaceId, {
        repoPath: target.repoPath,
        runtimeKey,
        workspaceName: target.workspaceName,
      });
      withTimeout(
        invoke("coordination_deactivate_shared_mcp_daemon", {
          repoPath: target.repoPath,
          reason: "workspace_deactivate",
        }),
        WORKSPACE_SHARED_MCP_TIMEOUT_MS,
        "Shared MCP deactivation timed out.",
      )
        .then(() => {
          logWorkspaceActivationTrace("workspace.open.shared_mcp.deactivate_done", target.workspaceId, {
            repoPath: target.repoPath,
            runtimeKey,
            workspaceName: target.workspaceName,
          });
        })
        .catch(() => {
          logWorkspaceActivationTrace("workspace.open.shared_mcp.deactivate_error", target.workspaceId, {
            repoPath: target.repoPath,
            runtimeKey,
            workspaceName: target.workspaceName,
          });
        });
    });
  }, [
    activatedWorkspaceId,
    authState,
    logWorkspaceActivationTrace,
    selectedWorkspaceId,
    shouldShowWorkspaceSetup,
    workspaceStartupWarmupTargetKey,
    workspaceStartupWarmupTargets,
  ]);
  const isActivatedWorkspaceDeactivating = Boolean(
    workspaceDeactivationState.isActive
      && activatedWorkspace
      && workspaceDeactivationState.workspaceId === activatedWorkspace.id,
  );
  const workspaceTerminalAgentLaunchReady = workspaceState === "ready"
    && workspaceHydrationReady
    && !workspaceActivationDeferred
    && Boolean(activatedWorkspace)
    && selectedWorkspace?.id === activatedWorkspace?.id
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
  useEffect(() => {
    const readinessSnapshot = {
      activatedWorkspaceId: activatedWorkspace?.id || "",
      agentTerminalCount: activatedWorkspaceAgentTerminalEntries.length,
      isActivatedWorkspaceDeactivating,
      selectedMatchesActivated: Boolean(selectedWorkspace?.id && selectedWorkspace.id === activatedWorkspace?.id),
      selectedWorkspaceId: selectedWorkspace?.id || "",
      workspaceActivationDeferred,
      workspaceAgentLaunchKey,
      workspaceHydrationReady,
      workspaceState,
      workspaceTerminalAgentLaunchReady,
      workspaceThreadsHydrated,
    };
    const snapshotKey = JSON.stringify(readinessSnapshot);
    if (workspaceActivationStateLogKeyRef.current === snapshotKey) {
      return;
    }

    workspaceActivationStateLogKeyRef.current = snapshotKey;
    logWorkspaceActivationTrace(
      "workspace.open.terminal_launch_readiness",
      activatedWorkspace?.id || selectedWorkspace?.id || "",
      readinessSnapshot,
    );
  }, [
    activatedWorkspace?.id,
    activatedWorkspaceAgentTerminalEntries.length,
    isActivatedWorkspaceDeactivating,
    logWorkspaceActivationTrace,
    selectedWorkspace?.id,
    workspaceActivationDeferred,
    workspaceAgentLaunchKey,
    workspaceHydrationReady,
    workspaceState,
    workspaceTerminalAgentLaunchReady,
    workspaceThreadsHydrated,
  ]);
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
  const activityOverlayContext = useMemo(() => ({
    repoPath: selectedWorkspaceFileRoot || "",
    workspaceId: selectedWorkspace?.id || "",
    workspaceName: selectedWorkspace?.name || "",
  }), [
    selectedWorkspace?.id,
    selectedWorkspace?.name,
    selectedWorkspaceFileRoot,
  ]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(ACTIVITY_OVERLAY_CONTEXT_STORAGE_KEY, JSON.stringify({
        ...activityOverlayContext,
        updatedAt: Date.now(),
      }));
    } catch {
      // The activity overlay falls back to account-level assets if context cannot be shared.
    }
  }, [
    activityOverlayContext.repoPath,
    activityOverlayContext.workspaceId,
    activityOverlayContext.workspaceName,
  ]);
  const assetWorkspaceOptions = useMemo(() => (
    workspaces.map((workspace) => {
      const workspaceId = String(workspace?.id || "").trim();
      const savedRoot = workspaceId ? getWorkspaceRootDirectory(workspaceSettings, workspaceId) : "";
      return {
        id: workspaceId,
        name: workspace?.name || workspaceId || "Workspace",
        rootDirectory: savedRoot || defaultWorkingDirectory,
      };
    }).filter((workspace) => workspace.id || workspace.name)
  ), [
    defaultWorkingDirectory,
    workspaceSettings,
    workspaces,
  ]);
  const snippingAssetTarget = useMemo(() => ({
    repoPath: selectedWorkspaceRootDirectory || defaultWorkingDirectory || "",
    workspaceId: selectedWorkspace?.id || "",
    workspaceName: selectedWorkspace?.name || "",
  }), [
    defaultWorkingDirectory,
    selectedWorkspace?.id,
    selectedWorkspace?.name,
    selectedWorkspaceRootDirectory,
  ]);
  useEffect(() => {
    invoke("snipping_set_asset_target", {
      request: snippingAssetTarget,
    }).catch(() => {});
  }, [
    snippingAssetTarget.repoPath,
    snippingAssetTarget.workspaceId,
    snippingAssetTarget.workspaceName,
  ]);
  useEffect(() => {
    // Publish workspace + terminal targets so the annotation editor window
    // can queue todos at a chosen workspace/terminal.
    const targets = (Array.isArray(workspaces) ? workspaces : [])
      .map((workspace) => {
        const workspaceId = String(workspace?.id || "").trim();
        if (!workspaceId) return null;
        const entry = workspaceThreads?.[workspaceId] || {};
        const threads = Object.entries(entry.threads || {})
          .map(([threadId, thread]) => {
            if (!thread || thread.archivedAt) return null;
            const bindings = thread.providerBindings || {};
            const binding = bindings[thread.currentAgent] || Object.values(bindings)[0] || {};
            const label = String(
              binding.terminalNickname
                || binding.displayName
                || thread.sessionName
                || thread.title
                || "",
            ).trim();
            if (!label) return null;
            return { threadId, label };
          })
          .filter(Boolean)
          .slice(0, 24);
        return {
          workspaceId,
          workspaceName: String(workspace?.name || workspaceId).trim(),
          threads,
        };
      })
      .filter(Boolean);
    invoke("snipping_set_dispatch_targets", { targets }).catch(() => {});
  }, [workspaceThreads, workspaces]);
  useEffect(() => {
    let disposed = false;
    let unlistenAnnotationTodo = null;

    listen(SNIPPING_ANNOTATION_TODO_EVENT, (annotationEvent) => {
      if (disposed) return;
      const payload = annotationEvent?.payload && typeof annotationEvent.payload === "object"
        ? annotationEvent.payload
        : {};
      const workspaceId = String(
        payload.workspaceId
          || payload.workspace_id
          || snippingAssetTarget.workspaceId
          || "",
      ).trim();
      if (!workspaceId) {
        logBigViewSyncDiagnosticEvent("snipping.annotation_todo.skip", {
          reason: "missing_workspace",
          surface: "app_shell",
        });
        return;
      }
      const text = String(payload.text || payload.todo || payload.prompt || "").trim();
      const payloadImage = payload.image && typeof payload.image === "object" ? payload.image : {};
      const payloadImages = (Array.isArray(payload.images) ? payload.images : [])
        .concat(payloadImage && Object.keys(payloadImage).length ? [payloadImage] : [])
        .map((image, index) => {
          const src = String(
            image?.src
              || image?.imageDataUrl
              || image?.image_data_url
              || image?.imageSrc
              || "",
          ).trim();
          if (!src) return null;
          return {
            name: String(image?.name || payload.name || `annotated-snip-${index + 1}.png`).slice(0, 160),
            size: Number(image?.size || 0),
            src,
            type: String(image?.type || "image/png").slice(0, 80),
          };
        })
        .filter(Boolean);
      if (!text && !payloadImages.length) {
        return;
      }
      const baseCommandId = String(payload.commandId || payload.command_id || "").trim()
        || `snip-todo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const createdAt = String(payload.createdAt || payload.created_at || "").trim()
        || new Date().toISOString();
      const sourcePaths = Array.isArray(payload.sourcePaths)
        ? payload.sourcePaths
        : Array.isArray(payload.source_paths)
          ? payload.source_paths
          : undefined;

      window.dispatchEvent(new CustomEvent(REMOTE_TODO_QUEUE_EVENT, {
        detail: {
          commandId: baseCommandId,
          item: {
            createdAt,
            id: baseCommandId,
            kind: "todo",
            ...(payloadImages[0] ? { image: payloadImages[0] } : {}),
            ...(payloadImages.length > 1 ? { images: payloadImages } : {}),
            remoteCommand: {
              commandId: baseCommandId,
              imageTotal: payloadImages.length || undefined,
              source: "snipping-annotation",
              sourceName: String(payload.name || payload.sourceName || "").trim(),
              sourcePath: String(payload.sourcePath || payload.source_path || "").trim(),
              sourcePaths,
            },
            source: "snipping-annotation",
            ...(String(payload.targetThreadId || payload.target_thread_id || "").trim()
              ? { targetThreadId: String(payload.targetThreadId || payload.target_thread_id).trim() }
              : {}),
            text,
            workspaceId,
          },
          source: "snipping-annotation",
          workspaceId,
          workspaceName: String(payload.workspaceName || payload.workspace_name || snippingAssetTarget.workspaceName || "").trim(),
        },
      }));
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlistenAnnotationTodo = unlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (typeof unlistenAnnotationTodo === "function") {
        unlistenAnnotationTodo();
      }
    };
  }, [
    snippingAssetTarget.workspaceId,
    snippingAssetTarget.workspaceName,
  ]);
  const accountAssetsLibrary = useAccountAssetsLibrary({
    repoPath: defaultWorkingDirectory,
  });
  const untrackedAssetsLibrary = useUntrackedAssetsLibrary();
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
    enabledWorkspaceRuntimeDescriptors.length > 0,
  );
  const selectedWorkspaceIsActivated = Boolean(
    selectedWorkspace?.id
      && enabledRuntimeWorkspaceIds.includes(selectedWorkspace.id)
      && !workspaceActivationDeferred,
  );
  const shouldShowWorkspacePendingActivation = Boolean(
    selectedWorkspace?.id
      && workspacePendingActivationId === selectedWorkspace.id,
  );
  const shouldRevealWorkspaceTerminal = Boolean(
    shouldKeepWorkspaceTerminalMounted
      && selectedWorkspaceIsActivated,
  );
  const shouldShowDefaultWorkspaceIdle = Boolean(
    !shouldShowWorkspaceSetup
      && (shouldShowWorkspacePendingActivation || !hasSelectedWorkspace || !selectedWorkspaceIsActivated),
  );
  const defaultWorkspaceIdleDetail = shouldShowWorkspacePendingActivation
    ? `Opening ${selectedWorkspace?.name || "workspace"}...`
    : hasSelectedWorkspace
      ? "No active workspace."
      : "No workspace selected.";
  useEffect(() => {
    const selectedWorkspaceId = selectedWorkspace?.id || "";
    const selectedRuntimeActive = Boolean(selectedWorkspaceRuntimeDescriptor);
    const selectedRuntimeVisible = Boolean(
      selectedRuntimeActive
        && shouldRevealWorkspaceTerminal
        && visibleView === DEFAULT_WORKSPACE_VIEW,
    );
    const transitionKind = selectedWorkspaceId
      ? selectedRuntimeActive
        ? selectedWorkspaceId === activatedWorkspaceId
          ? "selected_activated_runtime"
          : "selected_mounted_runtime"
        : shouldShowWorkspacePendingActivation
          ? "selected_pending_activation"
          : "selected_inactive_runtime"
      : "no_workspace_selected";
    const snapshot = {
      activeRuntimeWorkspaceCount: enabledRuntimeWorkspaceIds.length,
      activeRuntimeWorkspaceIds: enabledRuntimeWorkspaceIds,
      activeView,
      activatedWorkspaceId,
      descriptorAgentTerminalCount: selectedWorkspaceRuntimeDescriptor?.agentTerminalEntries?.length || 0,
      descriptorLogicalTerminalCount: selectedWorkspaceRuntimeDescriptor?.logicalTerminalCount || 0,
      pendingActivationId: workspacePendingActivationId,
      selectedRuntimeActive,
      selectedRuntimeVisible,
      selectedWorkspaceId,
      selectedWorkspaceName: selectedWorkspace?.name || "",
      transitionKind,
      visibleView,
      workspaceActivationDeferred,
      workspaceHydrationReady,
      workspaceState,
    };
    const snapshotKey = JSON.stringify(snapshot);
    if (workspaceRuntimeSelectionLogKeyRef.current === snapshotKey) {
      return;
    }

    workspaceRuntimeSelectionLogKeyRef.current = snapshotKey;
    logWorkspaceActivationTrace(
      "workspace.open.runtime_selection_state",
      selectedWorkspaceId || activatedWorkspaceId,
      snapshot,
      { force: selectedRuntimeVisible },
    );
  }, [
    activeView,
    activatedWorkspaceId,
    enabledRuntimeWorkspaceIds,
    logWorkspaceActivationTrace,
    selectedWorkspace?.id,
    selectedWorkspace?.name,
    selectedWorkspaceRuntimeDescriptor,
    shouldRevealWorkspaceTerminal,
    shouldShowWorkspacePendingActivation,
    visibleView,
    workspaceActivationDeferred,
    workspaceHydrationReady,
    workspacePendingActivationId,
    workspaceState,
  ]);
  const shouldShowTerminalNav = hasSelectedWorkspace;
  const shouldShowWorkspaceDetailNav = hasSelectedWorkspace;
  const isSelectedWorkspaceActivated = Boolean(
    selectedWorkspace && enabledRuntimeWorkspaceIds.includes(selectedWorkspace.id),
  );
  const isSelectedWorkspaceDefault = Boolean(
    selectedWorkspace && workspaceLifecycleSettings.defaultWorkspaceId === selectedWorkspace.id,
  );
  const defaultWorkspace = findWorkspaceById(workspaces, workspaceLifecycleSettings.defaultWorkspaceId);
  const cloudSqliteResetWorkspaces = useMemo(() => {
    const resetWorkspaces = [];
    const seen = new Set();
    workspaces.forEach((workspace) => {
      const workspaceId = String(workspace?.id || "").trim();
      if (!workspaceId) {
        return;
      }
      if (seen.has(workspaceId)) {
        return;
      }
      seen.add(workspaceId);
      const workspaceRoot = (
        getWorkspaceRootDirectory(workspaceSettings, workspaceId)
        || defaultWorkingDirectory
        || ""
      );
      resetWorkspaces.push({
        workspaceId,
        workspaceName: String(workspace?.name || workspaceId).trim(),
        workspaceRoot: cleanWorkspaceRootDirectory(workspaceRoot),
      });
    });
    return resetWorkspaces;
  }, [
    defaultWorkingDirectory,
    workspaceSettings,
    workspaces,
  ]);
  const cloudSqliteResetWorkspace = useMemo(() => {
    const selectedResetWorkspaceId = String(cloudSqliteResetSelectedWorkspaceId || "").trim();
    return (
      cloudSqliteResetWorkspaces.find((workspace) => workspace.workspaceId === selectedResetWorkspaceId)
      || cloudSqliteResetWorkspaces.find((workspace) => workspace.workspaceId === selectedWorkspace?.id)
      || cloudSqliteResetWorkspaces.find((workspace) => workspace.workspaceId === activatedWorkspace?.id)
      || cloudSqliteResetWorkspaces.find((workspace) => workspace.workspaceId === defaultWorkspace?.id)
      || cloudSqliteResetWorkspaces[0]
      || null
    );
  }, [
    activatedWorkspace?.id,
    cloudSqliteResetSelectedWorkspaceId,
    cloudSqliteResetWorkspaces,
    defaultWorkspace?.id,
    selectedWorkspace?.id,
  ]);
  const cloudSqliteResetWorkspaceId = String(cloudSqliteResetWorkspace?.workspaceId || "").trim();
  const cloudSqliteResetWorkspaceName = String(cloudSqliteResetWorkspace?.workspaceName || "").trim();
  const cloudSqliteResetWorkspaceRoot = cleanWorkspaceRootDirectory(
    cloudSqliteResetWorkspace?.workspaceRoot || "",
  );
  const cloudSqliteResetRepoCards = useMemo(() => {
    if (!cloudSqliteResetWorkspaceId || !cloudSqliteResetWorkspaceRoot) {
      return [];
    }
    const discoveredTargets = dedupeWorkspaceCoordinationTargets(
      getWorkspaceCoordinationTargetsForRoot(
        workspaceCoordinationTargetsByRoot,
        cloudSqliteResetWorkspaceRoot,
      ),
    );
    const gitTargets = discoveredTargets.filter(workspaceCoordinationTargetIsGitRepo);
    const seen = new Set();
    return gitTargets
      .map((target) => {
        const repoPath = cleanWorkspaceRootDirectory(target?.repoPath || "");
        const repoIdentity = getWorkspaceRootIdentity(repoPath);
        if (!repoPath || !repoIdentity || seen.has(repoIdentity)) {
          return null;
        }
        seen.add(repoIdentity);
        const repoLabel = workspaceCoordinationTargetRepoLabel(target);
        const relativePath = String(target?.workspaceRelativePath || "").trim();
        return {
          key: `${cloudSqliteResetWorkspaceId}:${repoIdentity}`,
          repoIdentity,
          repoLabel,
          repoPath,
          relativePath,
          target,
        };
      })
      .filter(Boolean);
  }, [
    cloudSqliteResetWorkspaceId,
    cloudSqliteResetWorkspaceRoot,
    workspaceCoordinationTargetsByRoot,
  ]);
  const cloudSqliteResetSelectedRepoCards = useMemo(() => (
    cloudSqliteResetRepoCards.filter((card) => Boolean(cloudSqliteResetSelectedRepoKeys?.[card.key]))
  ), [cloudSqliteResetRepoCards, cloudSqliteResetSelectedRepoKeys]);
  const cloudSqliteResetSelectedRepoCount = cloudSqliteResetSelectedRepoCards.length;
  const cloudOrphanRepos = useMemo(() => {
    const repos = Array.isArray(cloudRepoCatalog?.repos) ? cloudRepoCatalog.repos : [];
    return repos.filter((repo) => {
      const repoId = String(repo?.repo_id || repo?.repoId || "").trim();
      if (!repoId || cloudRepoCatalogDismissedIds?.[repoId]) {
        return false;
      }
      return Boolean(repo?.orphan);
    });
  }, [cloudRepoCatalog, cloudRepoCatalogDismissedIds]);
  const isCloudSqliteResetting = cloudSqliteResetState.endsWith("_resetting")
    || cloudSqliteResetState === "resetting";
  const isCloudSqliteRepoResetting = cloudSqliteResetState === "repo_resetting"
    || cloudSqliteResetState === "resetting";
  const isCloudSqliteWorkspaceResetting = cloudSqliteResetState === "workspace_resetting";
  const cloudSqliteRepoResetDisabled = isCloudSqliteResetting
    || !cloudSqliteResetWorkspaceId
    || cloudSqliteResetSelectedRepoCount === 0;
  const cloudSqliteWorkspaceResetDisabled = isCloudSqliteResetting
    || !cloudSqliteResetWorkspaceId
    || !cloudSqliteResetWorkspaceRoot;
  const isTokenomicsCloudResetting = tokenomicsCloudResetState === "resetting";
  const tokenomicsCloudResetDisabled = isTokenomicsCloudResetting
    || authState !== "authenticated"
    || !isPaidUser(user);
  useEffect(() => {
    const nextWorkspaceId = cloudSqliteResetWorkspace?.workspaceId || "";
    if (nextWorkspaceId !== cloudSqliteResetSelectedWorkspaceId) {
      setCloudSqliteResetSelectedWorkspaceId(nextWorkspaceId);
    }
  }, [cloudSqliteResetSelectedWorkspaceId, cloudSqliteResetWorkspace?.workspaceId]);
  useEffect(() => {
    const validKeys = new Set(cloudSqliteResetRepoCards.map((card) => card.key));
    setCloudSqliteResetSelectedRepoKeys((current) => {
      const next = {};
      Object.keys(current || {}).forEach((key) => {
        if (validKeys.has(key)) {
          next[key] = true;
        }
      });
      const currentKeys = Object.keys(current || {}).sort();
      const nextKeys = Object.keys(next).sort();
      if (
        currentKeys.length === nextKeys.length
        && currentKeys.every((key, index) => key === nextKeys[index])
      ) {
        return current;
      }
      return next;
    });
  }, [cloudSqliteResetRepoCards]);
  const toggleCloudSqliteResetRepoCard = useCallback((repoKey) => {
    if (isCloudSqliteResetting) {
      return;
    }
    const key = String(repoKey || "").trim();
    if (!key) {
      return;
    }
    setCloudSqliteResetSelectedRepoKeys((current) => {
      const next = { ...(current || {}) };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = true;
      }
      return next;
    });
  }, [isCloudSqliteResetting]);
  const activeAppTheme = normalizeAppTheme(appAppearanceSettings.theme);
  const isWorkspaceSettingsOpen = Boolean(workspaceSettingsModalId && selectedWorkspace);
  const workspaceGitPullSelectedPaths = useMemo(
    () => workspaceGitPullPrompt.repositories
      .filter((repository) => workspaceGitPullPrompt.selected?.[repository.path])
      .map((repository) => repository.path),
    [workspaceGitPullPrompt.repositories, workspaceGitPullPrompt.selected],
  );
  const workspaceGitPullSelectedCount = workspaceGitPullSelectedPaths.length;
  const isWorkspaceGitPullPromptBusy = workspaceGitPullPrompt.state === "pulling";
  const shouldShowWorkspaceGitPullPrompt = Boolean(
    !isWorkspaceSettingsOpen
      && workspaceGitPullPrompt.repositories.length > 0
      && (workspaceGitPullPrompt.state === "ready" || workspaceGitPullPrompt.state === "pulling"),
  );
  const toggleWorkspaceGitPullRepository = useCallback((repoPath) => {
    setWorkspaceGitPullPrompt((current) => {
      if (current.state === "pulling") {
        return current;
      }
      return {
        ...current,
        selected: {
          ...current.selected,
          [repoPath]: !current.selected?.[repoPath],
        },
        error: "",
      };
    });
  }, []);
  const skipWorkspaceGitPullPrompt = useCallback(() => {
    if (workspaceGitPullPrompt.checkKey) {
      workspaceGitPullPromptSkippedRef.current.add(workspaceGitPullPrompt.checkKey);
    }
    setWorkspaceGitPullPrompt(WORKSPACE_GIT_PULL_PROMPT_INITIAL_STATE);
  }, [workspaceGitPullPrompt.checkKey]);
  const refreshWorkspaceGitRepositoryPreload = useCallback(async ({
    refresh = false,
    rootDirectory = "",
    workspaceId = "",
    workspaceName = "",
  } = {}) => {
    const checkKey = workspaceGitPullPromptCheckKey(workspaceId, rootDirectory);

    if (!checkKey) {
      return {
        allRepositories: [],
        checkKey: "",
        pullableRepositories: [],
        response: null,
      };
    }

    setWorkspaceGitRepositoryPreloads((current) => ({
      ...current,
      [checkKey]: {
        ...(current[checkKey] || {}),
        state: "loading",
        workspaceId,
        workspaceName,
        rootDirectory,
        checkKey,
        repositories: current[checkKey]?.repositories || [],
        error: "",
      },
    }));

    try {
      const response = await invoke("workspace_git_pull_candidates", {
        repoPath: rootDirectory,
        workspaceId,
        workspaceName,
        refresh,
      });
      const allRepositories = Array.isArray(response?.repositories)
        ? response.repositories
          .map(normalizeWorkspaceGitPullRepository)
          .filter((repository) => repository.path)
        : [];
      const pullableRepositories = allRepositories.filter((repository) => repository.pullable);

      setWorkspaceGitRepositoryPreloads((current) => ({
        ...current,
        [checkKey]: {
          state: "ready",
          workspaceId,
          workspaceName,
          rootDirectory,
          checkKey,
          repositories: allRepositories,
          cache: response?.cache || null,
          generatedAtMs: Number(response?.generatedAtMs) || Date.now(),
          error: "",
        },
      }));

      return {
        allRepositories,
        checkKey,
        pullableRepositories,
        response,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error, "Unable to check Git repositories.");
      setWorkspaceGitRepositoryPreloads((current) => ({
        ...current,
        [checkKey]: {
          ...(current[checkKey] || {}),
          state: "error",
          workspaceId,
          workspaceName,
          rootDirectory,
          checkKey,
          repositories: current[checkKey]?.repositories || [],
          error: errorMessage,
        },
      }));
      throw error;
    }
  }, []);
  const refreshWorkspaceGitSnapshotPreload = useCallback(async ({
    repoPath = "",
    rootDirectory = "",
    snapshot = null,
    repositoryGeneratedAtMs = 0,
    workspaceId = "",
    workspaceName = "",
  } = {}) => {
    const checkKey = workspaceGitPullPromptCheckKey(workspaceId, rootDirectory);
    const normalizedRepoPath = String(repoPath || "").trim();

    if (!checkKey || !normalizedRepoPath) {
      return {
        checkKey,
        snapshot: null,
      };
    }

    if (snapshot && typeof snapshot === "object") {
      setWorkspaceGitSnapshotPreloads((current) => ({
        ...current,
        [checkKey]: {
          ...(current[checkKey] || {}),
          state: "ready",
          workspaceId,
          workspaceName,
          rootDirectory,
          checkKey,
          snapshots: {
            ...(current[checkKey]?.snapshots || {}),
            [normalizedRepoPath]: {
              state: "ready",
              repoPath: normalizedRepoPath,
              snapshot,
              repositoryGeneratedAtMs: Number(repositoryGeneratedAtMs) || 0,
              generatedAtMs: Number(snapshot?.generatedAtMs) || Date.now(),
              error: "",
            },
          },
          error: "",
        },
      }));
      return {
        checkKey,
        snapshot,
      };
    }

    setWorkspaceGitSnapshotPreloads((current) => ({
      ...current,
      [checkKey]: {
        ...(current[checkKey] || {}),
        state: "loading",
        workspaceId,
        workspaceName,
        rootDirectory,
        checkKey,
        snapshots: {
          ...(current[checkKey]?.snapshots || {}),
          [normalizedRepoPath]: {
            ...(current[checkKey]?.snapshots?.[normalizedRepoPath] || {}),
            state: "loading",
            repoPath: normalizedRepoPath,
            repositoryGeneratedAtMs: Number(repositoryGeneratedAtMs) || 0,
            error: "",
          },
        },
        error: "",
      },
    }));

    try {
      const nextSnapshot = await invoke("workspace_git_snapshot", {
        repoPath: normalizedRepoPath,
      });
      setWorkspaceGitSnapshotPreloads((current) => ({
        ...current,
        [checkKey]: {
          ...(current[checkKey] || {}),
          state: "ready",
          workspaceId,
          workspaceName,
          rootDirectory,
          checkKey,
          snapshots: {
            ...(current[checkKey]?.snapshots || {}),
            [normalizedRepoPath]: {
              state: "ready",
              repoPath: normalizedRepoPath,
              snapshot: nextSnapshot,
              repositoryGeneratedAtMs: Number(repositoryGeneratedAtMs) || 0,
              generatedAtMs: Number(nextSnapshot?.generatedAtMs) || Date.now(),
              error: "",
            },
          },
          error: "",
        },
      }));
      return {
        checkKey,
        snapshot: nextSnapshot,
      };
    } catch (error) {
      const errorMessage = getErrorMessage(error, "Unable to load Git history.");
      setWorkspaceGitSnapshotPreloads((current) => ({
        ...current,
        [checkKey]: {
          ...(current[checkKey] || {}),
          state: "error",
          workspaceId,
          workspaceName,
          rootDirectory,
          checkKey,
          snapshots: {
            ...(current[checkKey]?.snapshots || {}),
            [normalizedRepoPath]: {
              ...(current[checkKey]?.snapshots?.[normalizedRepoPath] || {}),
              state: "error",
              repoPath: normalizedRepoPath,
              repositoryGeneratedAtMs: Number(repositoryGeneratedAtMs) || 0,
              error: errorMessage,
            },
          },
          error: errorMessage,
        },
      }));
      throw error;
    }
  }, []);
  const pullSelectedWorkspaceGitRepositories = useCallback(async () => {
    if (!workspaceGitPullSelectedPaths.length) {
      setWorkspaceGitPullPrompt((current) => ({
        ...current,
        error: "Select at least one repository to pull.",
      }));
      return;
    }
    const checkKey = workspaceGitPullPrompt.checkKey;
    setWorkspaceGitPullPrompt((current) => ({
      ...current,
      state: "pulling",
      error: "",
      message: "Pulling selected repositories...",
    }));
    try {
      const response = await invoke("workspace_git_pull_repositories", {
        repoPaths: workspaceGitPullSelectedPaths,
      });
      if (workspaceGitPullPromptCheckRef.current !== checkKey) {
        return;
      }
      const failedCount = Number(response?.failedCount) || 0;
      const pulledCount = Number(response?.pulledCount) || 0;
      if (failedCount > 0) {
        const firstFailure = Array.isArray(response?.results)
          ? response.results.find((result) => !result?.ok)
          : null;
        setWorkspaceGitPullPrompt((current) => ({
          ...current,
          state: "ready",
          error: firstFailure?.error
            ? `${firstFailure.name || "Repository"}: ${firstFailure.error}`
            : `${failedCount} repository${failedCount === 1 ? "" : "ies"} could not be pulled.`,
          message: "",
        }));
        return;
      }
      if (checkKey) {
        workspaceGitPullPromptSkippedRef.current.add(checkKey);
      }
      setWorkspaceGitPullPrompt({
        ...WORKSPACE_GIT_PULL_PROMPT_INITIAL_STATE,
        message: pulledCount > 0
          ? `Pulled ${pulledCount} repository${pulledCount === 1 ? "" : "ies"}.`
          : "Repositories were already current.",
      });
      void refreshWorkspaceGitRepositoryPreload({
        refresh: true,
        rootDirectory: workspaceGitPullPrompt.rootDirectory,
        workspaceId: workspaceGitPullPrompt.workspaceId,
        workspaceName: selectedWorkspace?.name || "",
      });
    } catch (error) {
      if (workspaceGitPullPromptCheckRef.current !== checkKey) {
        return;
      }
      setWorkspaceGitPullPrompt((current) => ({
        ...current,
        state: "ready",
        error: getErrorMessage(error, "Unable to pull selected repositories."),
        message: "",
      }));
    }
  }, [
    refreshWorkspaceGitRepositoryPreload,
    selectedWorkspace?.name,
    workspaceGitPullPrompt.checkKey,
    workspaceGitPullPrompt.rootDirectory,
    workspaceGitPullPrompt.workspaceId,
    workspaceGitPullSelectedPaths,
  ]);

  useEffect(() => {
    const workspaceId = selectedWorkspace?.id || "";
    const workspaceNameForCheck = selectedWorkspace?.name || "";
    const rootDirectory = selectedWorkspaceFileRoot || "";
    const checkKey = workspaceGitPullPromptCheckKey(workspaceId, rootDirectory);
    const existingPreload = checkKey ? workspaceGitRepositoryPreloads[checkKey] : null;

    if (
      authState !== "authenticated"
      || shouldShowWorkspaceSetup
      || workspaceActivationDeferred
      || !workspaceId
      || !rootDirectory
    ) {
      workspaceGitPullPromptCheckRef.current = "";
      setWorkspaceGitPullPrompt(WORKSPACE_GIT_PULL_PROMPT_INITIAL_STATE);
      return undefined;
    }

    if (
      !checkKey
        || workspaceGitPullPromptCheckRef.current === checkKey
        || existingPreload?.state === "loading"
        || existingPreload?.state === "ready"
    ) {
      return undefined;
    }

    workspaceGitPullPromptCheckRef.current = checkKey;
    let cancelled = false;
    setWorkspaceGitPullPrompt({
      ...WORKSPACE_GIT_PULL_PROMPT_INITIAL_STATE,
      state: "checking",
      workspaceId,
      rootDirectory,
      checkKey,
    });

    refreshWorkspaceGitRepositoryPreload({
      refresh: false,
      rootDirectory,
      workspaceId,
      workspaceName: workspaceNameForCheck,
    })
      .then(({ response, pullableRepositories }) => {
        if (cancelled || workspaceGitPullPromptCheckRef.current !== checkKey) {
          return;
        }
        if (workspaceGitPullPromptSkippedRef.current.has(checkKey) || !pullableRepositories.length) {
          setWorkspaceGitPullPrompt({
            ...WORKSPACE_GIT_PULL_PROMPT_INITIAL_STATE,
            workspaceId,
            rootDirectory,
            checkKey,
          });
          return;
        }
        setWorkspaceGitPullPrompt({
          ...WORKSPACE_GIT_PULL_PROMPT_INITIAL_STATE,
          state: "ready",
          workspaceId,
          rootDirectory,
          checkKey,
          repositories: pullableRepositories,
          selected: Object.fromEntries(pullableRepositories.map((repository) => [repository.path, true])),
          blockedCount: Number(response?.blockedCount) || 0,
        });
      })
      .catch((error) => {
        if (cancelled || workspaceGitPullPromptCheckRef.current !== checkKey) {
          return;
        }
        setWorkspaceGitPullPrompt({
          ...WORKSPACE_GIT_PULL_PROMPT_INITIAL_STATE,
          workspaceId,
          rootDirectory,
          checkKey,
          error: getErrorMessage(error, "Unable to check Git repositories."),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [
    authState,
    selectedWorkspace?.id,
    selectedWorkspace?.name,
    selectedWorkspaceFileRoot,
    shouldShowWorkspaceSetup,
    workspaceActivationDeferred,
    refreshWorkspaceGitRepositoryPreload,
    workspaceGitRepositoryPreloads,
  ]);

  useEffect(() => {
    Object.values(workspaceGitRepositoryPreloads).forEach((preload) => {
      if (!preload || preload.state !== "ready" || !preload.checkKey) {
        return;
      }

      const repositories = Array.isArray(preload.repositories)
        ? preload.repositories
        : [];
      if (!repositories.length) {
        return;
      }

      const snapshotPreload = workspaceGitSnapshotPreloads[preload.checkKey] || null;
      const repositoryGeneratedAtMs = Number(preload.generatedAtMs) || 0;

      repositories.forEach((repository) => {
        const repoPath = String(repository?.path || "").trim();
        if (!repoPath) {
          return;
        }

        const entry = snapshotPreload?.snapshots?.[repoPath] || null;
        const entryMatchesRepositoryGeneration = Number(entry?.repositoryGeneratedAtMs) === repositoryGeneratedAtMs;
        if (
          entryMatchesRepositoryGeneration
            && (entry?.state === "loading" || entry?.state === "ready" || entry?.state === "error")
        ) {
          return;
        }

        void refreshWorkspaceGitSnapshotPreload({
          repoPath,
          rootDirectory: preload.rootDirectory,
          repositoryGeneratedAtMs,
          workspaceId: preload.workspaceId,
          workspaceName: preload.workspaceName || "",
        }).catch(() => {});
      });
    });
  }, [
    refreshWorkspaceGitSnapshotPreload,
    workspaceGitRepositoryPreloads,
    workspaceGitSnapshotPreloads,
  ]);
  const isWorkspaceSettingsDeactivating = Boolean(
    workspaceDeactivationState.isActive
      && selectedWorkspace
      && workspaceDeactivationState.workspaceId === selectedWorkspace.id,
  );
  const isWorkspaceSettingsDeleting = workspaceSettingsState === "deleting";
  const isWorkspaceSettingsBusy = workspaceSettingsState === "saving"
    || isWorkspaceSettingsDeactivating
    || isWorkspaceSettingsDeleting;
  const isWorkspaceDeleteConfirming = Boolean(
    selectedWorkspace && workspaceDeleteConfirmId === selectedWorkspace.id,
  );
  const activatedWorkspaceIdForGraphSync = activatedWorkspace?.id || "";
  const activatedWorkspaceNameForGraphSync = activatedWorkspace?.name || "";
  const activatedWorkspaceGraphStateKey = workspaceGraphStateKey(
    activatedWorkspaceTerminalWorkingDirectory,
    activatedWorkspaceIdForGraphSync,
  );
  const activatedWorkspaceGraphState = activatedWorkspaceGraphStateKey
    ? workspaceGraphState[activatedWorkspaceGraphStateKey] || {}
    : {};
  const activatedArchitectureRepositoryScanState = activatedWorkspaceGraphState.architectureRepositoryScanState || "idle";
  const activatedArchitectureRepositoryScanSnapshot = activatedWorkspaceGraphState.architectureRepositoryScanSnapshot || null;

  const resetSelectedRepoServerStates = useCallback(async () => {
    setCloudSqliteResetMessage("");
    setCloudSqliteResetError("");

    if (!cloudSqliteResetWorkspaceId || cloudSqliteResetSelectedRepoCards.length === 0) {
      setCloudSqliteResetError("Select at least one repository before resetting server state.");
      return;
    }

    const repoCount = cloudSqliteResetSelectedRepoCards.length;
    const confirmed = window.confirm(
      `Reset server state for ${repoCount} selected repositor${repoCount === 1 ? "y" : "ies"} in ${cloudSqliteResetWorkspaceName || "this workspace"}? Devices, billing history, and tokenomics are preserved.`,
    );
    if (!confirmed) {
      return;
    }

    setCloudSqliteResetState("repo_resetting");
    try {
      const checkpointMessages = [];
      const failures = [];
      let completedCount = 0;
      for (const [repoIndex, repoCard] of cloudSqliteResetSelectedRepoCards.entries()) {
        setCloudSqliteResetMessage(
          `Resetting ${repoCard.repoLabel} (${repoIndex + 1}/${repoCount})...`,
        );
        try {
          const response = await invoke("cloud_mcp_reset_server_state", {
            repoPath: repoCard.repoPath,
            workspaceId: cloudSqliteResetWorkspaceId,
            workspaceName: cloudSqliteResetWorkspaceName || null,
            resetScope: "repo",
          });
          checkpointMessages.push(getCloudSqliteResetCheckpointMessage(unwrapCloudCommandData(response, {})));
          completedCount += 1;
        } catch (error) {
          failures.push(`${repoCard.repoLabel}: ${getErrorMessage(error, "reset failed")}`);
        }
      }
      const checkpointMessage = checkpointMessages.find((message) => message === "queued cloud checkpoint refresh")
        || checkpointMessages.find((message) => message === "refreshed cloud checkpoint")
        || checkpointMessages[0]
        || "cloud checkpoint refresh skipped";
      if (completedCount > 0) {
        setCloudSqliteResetMessage(
          `Server state reset complete for ${completedCount}/${repoCount} repositor${repoCount === 1 ? "y" : "ies"}; ${checkpointMessage}. Devices, billing, and tokenomics were preserved.`,
        );
      } else {
        setCloudSqliteResetMessage("");
      }
      if (failures.length > 0) {
        setCloudSqliteResetError(`Some repositories failed to reset — ${failures.join("; ")}`);
      }
    } catch (error) {
      setCloudSqliteResetError(getErrorMessage(error, "Unable to reset selected repositories."));
    } finally {
      setCloudSqliteResetState("idle");
    }
  }, [
    cloudSqliteResetSelectedRepoCards,
    cloudSqliteResetWorkspaceId,
    cloudSqliteResetWorkspaceName,
  ]);

  const loadCloudRepoCatalog = useCallback(async () => {
    setCloudRepoCatalogState("loading");
    setCloudRepoCatalogError("");
    try {
      const response = await invoke("cloud_mcp_account_repo_catalog");
      const data = unwrapCloudCommandData(response, {});
      setCloudRepoCatalog(data && typeof data === "object" ? data : {});
      setCloudRepoCatalogState("ready");
    } catch (error) {
      setCloudRepoCatalogError(getErrorMessage(error, "Unable to load the cloud repo catalog."));
      setCloudRepoCatalogState("error");
    }
  }, []);

  const deleteOrphanCloudRepo = useCallback(async (repo) => {
    const repoId = String(repo?.repo_id || repo?.repoId || "").trim();
    if (!repoId) {
      return;
    }
    const repoLabel = String(
      repo?.git_repo_display_name || repo?.gitRepoDisplayName || repoId,
    ).trim();
    const stateTotal = Number(repo?.state_total ?? repo?.stateTotal ?? 0) || 0;
    const confirmed = window.confirm(
      `Delete "${repoLabel}" from the cloud? ${stateTotal} stored row${stateTotal === 1 ? "" : "s"} of repo state and its registration will be removed. Devices, billing, and tokenomics are preserved. Local files are not touched.`,
    );
    if (!confirmed) {
      return;
    }
    // Cloud artifacts are keyed by workspace, so target the workspace this
    // repo was last recorded under rather than the currently selected one.
    const recordedWorkspaceId = (Array.isArray(repo?.workspaces) ? repo.workspaces : [])
      .map((workspace) => String(workspace?.workspace_id || workspace?.workspaceId || "").trim())
      .find(Boolean)
      || cloudSqliteResetWorkspaceId;
    setCloudRepoCatalogBusyRepoId(repoId);
    setCloudRepoCatalogError("");
    try {
      await invoke("cloud_mcp_reset_server_state", {
        repoPath: cloudSqliteResetWorkspaceRoot || defaultWorkingDirectoryRef.current || "",
        workspaceId: recordedWorkspaceId || cloudSqliteResetWorkspaceId,
        workspaceName: null,
        resetScope: "repo_delete",
        repoIdOverride: repoId,
      });
      setCloudRepoCatalog((current) => {
        if (!current || !Array.isArray(current.repos)) {
          return current;
        }
        return {
          ...current,
          repos: current.repos.filter((entry) => (
            String(entry?.repo_id || entry?.repoId || "").trim() !== repoId
          )),
        };
      });
    } catch (error) {
      setCloudRepoCatalogError(getErrorMessage(error, `Unable to delete ${repoLabel} from the cloud.`));
    } finally {
      setCloudRepoCatalogBusyRepoId("");
    }
  }, [
    cloudSqliteResetWorkspaceId,
    cloudSqliteResetWorkspaceRoot,
  ]);

  const dismissOrphanCloudRepo = useCallback((repoId) => {
    const key = String(repoId || "").trim();
    if (!key) {
      return;
    }
    setCloudRepoCatalogDismissedIds((current) => ({ ...(current || {}), [key]: true }));
  }, []);

  const resetWorkspaceServerState = useCallback(async () => {
    setCloudSqliteResetMessage("");
    setCloudSqliteResetError("");

    if (!cloudSqliteResetWorkspaceId || !cloudSqliteResetWorkspaceRoot) {
      setCloudSqliteResetError("Choose a workspace before resetting workspace server state.");
      return;
    }

    const confirmed = window.confirm(
      `Reset workspace server state for ${cloudSqliteResetWorkspaceName || "this workspace"}? Workspace todos and plans are cleared. Devices, billing history, and tokenomics are preserved.`,
    );
    if (!confirmed) {
      return;
    }

    setCloudSqliteResetState("workspace_resetting");
    try {
      const response = await invoke("cloud_mcp_reset_server_state", {
        repoPath: cloudSqliteResetWorkspaceRoot,
        workspaceId: cloudSqliteResetWorkspaceId,
        workspaceName: cloudSqliteResetWorkspaceName || null,
        resetScope: "workspace",
      });
      const data = unwrapCloudCommandData(response, {});
      const checkpointMessage = getCloudSqliteResetCheckpointMessage(data);
      setCloudSqliteResetMessage(
        `Workspace server state reset complete for ${cloudSqliteResetWorkspaceName || "workspace"}; ${checkpointMessage}. Devices, billing, and tokenomics were preserved.`,
      );
    } catch (error) {
      setCloudSqliteResetError(getErrorMessage(error, "Unable to reset workspace server state."));
    } finally {
      setCloudSqliteResetState("idle");
    }
  }, [
    cloudSqliteResetWorkspaceId,
    cloudSqliteResetWorkspaceName,
    cloudSqliteResetWorkspaceRoot,
  ]);

  const resetCurrentDeviceTokenomicsCloud = useCallback(async () => {
    setTokenomicsCloudResetMessage("");
    setTokenomicsCloudResetError("");

    if (authState !== "authenticated" || !isPaidUser(user)) {
      setTokenomicsCloudResetError("Sign in with an active paid account before resetting cloud Tokenomics.");
      return;
    }

    const confirmed = window.confirm("Reset cloud Tokenomics for this device only and resync?");
    if (!confirmed) {
      return;
    }

    setTokenomicsCloudResetState("resetting");
    try {
      await invoke("cloud_mcp_reset_device_tokenomics");
      tokenomicsSyncCursorRef.current = "";
      setTokenomicsCloudResetMessage("Device Tokenomics reset; full resync queued.");
    } catch (error) {
      setTokenomicsCloudResetError(getErrorMessage(error, "Unable to reset this device's cloud Tokenomics."));
    } finally {
      setTokenomicsCloudResetState("idle");
    }
  }, [authState, user]);

  const resetCloudAccountData = useCallback(async () => {
    setCloudAccountResetMessage("");
    setCloudAccountResetError("");

    if (authState !== "authenticated" || !isPaidUser(user)) {
      setCloudAccountResetError("Sign in with an active paid account before cleaning up cloud data.");
      return;
    }

    const confirmed = window.confirm(
      "Delete ALL cloud-diffforge data for this account? Local data stays on this device and will fully resync to the cloud afterwards.",
    );
    if (!confirmed) {
      return;
    }

    setCloudAccountResetState("resetting");
    try {
      await invoke("cloud_mcp_hard_reset_cloud_sqlite", {
        repoPath: selectedWorkspaceRootDirectory || defaultWorkingDirectoryRef.current || "",
        workspaceId: selectedWorkspaceIdRef.current || "account",
        workspaceName: "",
        resetScope: "account",
      });

      // Fresh-slate resync: every sync signature/cursor clears so this
      // client re-pushes everything as the authoritative copy.
      workspaceCatalogSyncKeyRef.current = "";
      terminalPresenceSyncKeyRef.current = "";
      workspaceMcpSyncKeyRef.current = "";
      workspaceCloudSyncKeyRef.current = "";
      architectureCloudSyncSignatureRef.current = {};
      tokenomicsSyncCursorRef.current = "";

      const pendingWorkspaces = (Array.isArray(workspacesRef.current) ? workspacesRef.current : [])
        .map((workspace) => ({ ...workspace, syncState: "pending" }));
      workspacesRef.current = pendingWorkspaces;
      setWorkspaces(pendingWorkspaces);
      await invoke("local_workspaces_store", {
        scopeKey: activeAccountScopeKey,
        workspaces: pendingWorkspaces,
      }).catch(() => {});

      window.dispatchEvent(new CustomEvent("diffforge:cloud-resync-requested"));
      tokenomicsForceResyncRef.current?.();
      await loadWorkspaces();
      setCloudAccountResetMessage("Cloud account data deleted; this device is resyncing everything.");
    } catch (error) {
      setCloudAccountResetError(getErrorMessage(error, "Unable to clean up cloud account data."));
    } finally {
      setCloudAccountResetState("idle");
    }
  }, [
    activeAccountScopeKey,
    authState,
    loadWorkspaces,
    selectedWorkspaceRootDirectory,
    user,
  ]);

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
    const workspaceId = activatedWorkspaceIdForGraphSync;
    if (!repoPath || !workspaceId) {
      return undefined;
    }

    if (
      activatedArchitectureRepositoryScanSnapshot
      || activatedArchitectureRepositoryScanState === "loading"
      || activatedArchitectureRepositoryScanState === "ready"
      || activatedArchitectureRepositoryScanState === "error"
    ) {
      return undefined;
    }

    startWorkspaceArchitectureScan(workspaceId, {
      reason: "workspace_activation",
      rootDirectory: repoPath,
    });
    return undefined;
  }, [
    activatedArchitectureRepositoryScanSnapshot,
    activatedArchitectureRepositoryScanState,
    activatedWorkspaceIdForGraphSync,
    activatedWorkspaceTerminalWorkingDirectory,
    startWorkspaceArchitectureScan,
  ]);

  useEffect(() => {
    const repoPath = activatedWorkspaceTerminalWorkingDirectory;
    const workspaceId = activatedWorkspaceIdForGraphSync;
    const repositories = workspaceArchitectureRepositoriesFromScan(activatedArchitectureRepositoryScanSnapshot);
    if (
      !repoPath
      || !workspaceId
      || activatedArchitectureRepositoryScanState !== "ready"
      || !repositories.length
    ) {
      return undefined;
    }

    const architectureRepoPaths = repositories
      .map(workspaceArchitectureRepoPath)
      .filter(Boolean);
    if (!architectureRepoPaths.length) {
      return undefined;
    }
    const currentState = workspaceGraphStateRef.current[workspaceGraphStateKey(repoPath, workspaceId)] || {};
    if (!currentState.architectureSelectedRepoPath) {
      setWorkspaceArchitectureSelection(workspaceId, {
        repoPath: architectureRepoPaths[0],
        workspaceRootDirectory: repoPath,
      });
    }

    const timers = architectureRepoPaths
      .filter(Boolean)
      .map((architectureRepoPath, index) => window.setTimeout(() => {
        refreshWorkspaceArchitectureGraphList(workspaceId, architectureRepoPath, {
          reason: "workspace_architecture_graph_list_preload",
          workspaceName: activatedWorkspaceNameForGraphSync,
          workspaceRootDirectory: repoPath,
        }).catch(() => {});
      }, index * WORKSPACE_ARCHITECTURE_GRAPH_LIST_PRELOAD_STAGGER_MS));

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    activatedArchitectureRepositoryScanSnapshot,
    activatedArchitectureRepositoryScanState,
    activatedWorkspaceIdForGraphSync,
    activatedWorkspaceNameForGraphSync,
    activatedWorkspaceTerminalWorkingDirectory,
    refreshWorkspaceArchitectureGraphList,
    setWorkspaceArchitectureSelection,
  ]);

  useEffect(() => {
    const repoPath = activatedWorkspaceTerminalWorkingDirectory;
    const workspaceId = activatedWorkspaceIdForGraphSync;
    const repositories = workspaceArchitectureRepositoriesFromScan(activatedArchitectureRepositoryScanSnapshot);
    if (
      !repoPath
      || !workspaceId
      || activatedArchitectureRepositoryScanState !== "ready"
      || !repositories.length
    ) {
      return undefined;
    }

    const initialRepoPath = graphText(
      activatedWorkspaceGraphState.architectureSelectedRepoPath
        || workspaceArchitectureRepoPath(repositories[0]),
    );
    if (!initialRepoPath) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      const stateKey = workspaceGraphStateKey(repoPath, workspaceId);
      const currentState = workspaceGraphStateRef.current[stateKey] || {};
      const currentScan = currentState.architectureRepositoryScanSnapshot || activatedArchitectureRepositoryScanSnapshot;
      const currentRepositories = workspaceArchitectureRepositoriesFromScan(currentScan);
      const selectedRepoPath = graphText(
        currentState.architectureSelectedRepoPath
          || initialRepoPath,
      );
      const selectedRepoKey = workspaceArchitectureRepoKey(selectedRepoPath);
      const selectedRepo = currentRepositories.find((repo) => (
        workspaceArchitectureRepoKey(workspaceArchitectureRepoPath(repo)) === selectedRepoKey
      ));
      refreshWorkspaceArchitectureGraphList(workspaceId, workspaceArchitectureRepoPath(selectedRepo) || selectedRepoPath, {
        refresh: true,
        reason: "workspace_architecture_graph_list_background_refresh",
        silent: true,
        workspaceName: activatedWorkspaceNameForGraphSync,
        workspaceRootDirectory: repoPath,
      }).catch(() => {});
    }, WORKSPACE_ARCHITECTURE_GRAPH_LIST_REFRESH_MS);

    return () => window.clearInterval(interval);
  }, [
    activatedArchitectureRepositoryScanSnapshot,
    activatedArchitectureRepositoryScanState,
    activatedWorkspaceGraphState.architectureSelectedRepoPath,
    activatedWorkspaceIdForGraphSync,
    activatedWorkspaceNameForGraphSync,
    activatedWorkspaceTerminalWorkingDirectory,
    refreshWorkspaceArchitectureGraphList,
  ]);

  useEffect(() => {
    const repoPath = activatedWorkspaceTerminalWorkingDirectory;
    if (!workspaceHydrationReady || !repoPath || !activatedWorkspaceIdForGraphSync) {
      return undefined;
    }

    let cancelled = false;
    const workspaceId = activatedWorkspaceIdForGraphSync;
    const workspaceName = activatedWorkspaceNameForGraphSync || null;

    setWorkspaceGraphStatus(repoPath, workspaceId, {
      architectureState: "loading",
      architectureError: "",
    });

    invoke("cloud_mcp_get_task_history", {
      repoPath,
      workspaceId,
      workspaceName,
    })
      .then((result) => {
        if (!cancelled) applyWorkspaceGraphSnapshot(repoPath, workspaceId, result);
      })
      .catch((error) => {
        if (!cancelled) {
          setWorkspaceGraphStatus(repoPath, workspaceId, {
            architectureState: "error",
            architectureError: getErrorMessage(error, "Unable to load Task History."),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    activatedWorkspaceIdForGraphSync,
    activatedWorkspaceNameForGraphSync,
    activatedWorkspaceTerminalWorkingDirectory,
    applyWorkspaceGraphSnapshot,
    setWorkspaceGraphStatus,
    workspaceHydrationReady,
  ]);

  const selectedWorkspaceGraphStateKey = workspaceGraphStateKey(
    selectedWorkspaceFileRoot,
    selectedWorkspace?.id || "",
  );
  const selectedWorkspaceGraphState = selectedWorkspaceGraphStateKey
    ? workspaceGraphState[selectedWorkspaceGraphStateKey] || {}
    : {};
  const refreshSelectedWorkspaceArchitectureGraphList = useCallback((architectureRepoPath, options = {}) => {
    if (!selectedWorkspace?.id) {
      return Promise.resolve([]);
    }
    return refreshWorkspaceArchitectureGraphList(selectedWorkspace.id, architectureRepoPath, {
      ...options,
      workspaceName: selectedWorkspace.name || "",
      workspaceRootDirectory: selectedWorkspaceFileRoot,
    });
  }, [
    refreshWorkspaceArchitectureGraphList,
    selectedWorkspace?.id,
    selectedWorkspace?.name,
    selectedWorkspaceFileRoot,
  ]);
  const updateSelectedWorkspaceArchitectureSelection = useCallback((selection = {}) => {
    if (!selectedWorkspace?.id) return;
    setWorkspaceArchitectureSelection(selectedWorkspace.id, {
      ...selection,
      workspaceRootDirectory: selectedWorkspaceFileRoot,
    });
  }, [
    selectedWorkspace?.id,
    selectedWorkspaceFileRoot,
    setWorkspaceArchitectureSelection,
  ]);

  useEffect(() => {
    let cancelled = false;
    let unlistenArchitectureActivity = null;
    const refreshTimers = new Set();

    const handleArchitectureActivity = (event) => {
      if (cancelled) return;
      const normalizedActivity = normalizeTerminalArchitectureActivity(event?.payload);
      if (!normalizedActivity) return;
      const workspaceId = normalizedActivity.workspaceId;
      const workspace = workspaceId ? findWorkspaceById(workspacesRef.current, workspaceId) : null;
      const workspaceName = normalizedActivity.workspaceName || workspace?.name || "";
      const workspaceRootDirectory = cleanWorkspaceRootDirectory(
        getWorkspaceRootDirectory(workspaceSettingsRef.current, workspaceId)
          || normalizedActivity.repoPath
          || defaultWorkingDirectoryRef.current,
      );
      const repoPath = cleanWorkspaceRootDirectory(
        normalizedActivity.repoPath
          || workspaceRootDirectory
          || defaultWorkingDirectoryRef.current,
      );
      if (!workspaceId || !repoPath) return;
      const activity = {
        ...normalizedActivity,
        repoPath,
        workspaceName,
        workspaceRootDirectory,
      };
      const itemKey = activity.paneId
        || (Number.isInteger(activity.terminalIndex) ? `terminal:${activity.terminalIndex}` : "")
        || `${activity.agentId || activity.agentKind || "agent"}:${activity.instanceId || activity.observedAtMs}`;

      setWorkspaceArchitectureTerminalActivity((current) => {
        const previous = current[workspaceId] || {};
        const previousItems = previous.items && typeof previous.items === "object"
          ? previous.items
          : {};
        const entries = Object.entries({
          ...previousItems,
          [itemKey]: activity,
        })
          .sort(([, left], [, right]) => Number(right?.observedAtMs || 0) - Number(left?.observedAtMs || 0))
          .slice(0, 16);
        return {
          ...current,
          [workspaceId]: {
            items: Object.fromEntries(entries),
            latest: activity,
            updatedAt: activity.observedAtMs || Date.now(),
          },
        };
      });

      const refresh = () => {
        if (cancelled) return;
        void refreshWorkspaceArchitectureGraphList(workspaceId, repoPath, {
          refresh: true,
          reason: "terminal_architecture_activity",
          silent: true,
          workspaceName,
          workspaceRootDirectory,
        }).then((graphs) => {
          if (cancelled) return;
          const matchedGraph = jsonArray(graphs).find((graph) => (
            workspaceArchitectureGraphMatchesActivity(graph, activity)
          ));
          const graphId = workspaceArchitectureGraphId(matchedGraph) || activity.graphId;
          if (!graphId && !activity.graphFilePath) return;
          setWorkspaceArchitectureSelection(workspaceId, {
            graphId,
            repoPath,
            workspaceRootDirectory,
          });
        }).catch(() => {});
      };
      const delayMs = activity.graphFilePath ? 180 : 0;
      const timer = window.setTimeout(() => {
        refreshTimers.delete(timer);
        refresh();
      }, delayMs);
      refreshTimers.add(timer);
    };

    listen(TERMINAL_ARCHITECTURE_ACTIVITY_EVENT, handleArchitectureActivity)
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenArchitectureActivity = unlisten;
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenArchitectureActivity) {
        unlistenArchitectureActivity();
      }
      refreshTimers.forEach((timer) => window.clearTimeout(timer));
      refreshTimers.clear();
    };
  }, [
    refreshWorkspaceArchitectureGraphList,
    setWorkspaceArchitectureSelection,
  ]);

  useEffect(() => {
    let cancelled = false;
    let unlistenTaskHistory = null;
    let unlistenWorkspaceTodos = null;
    let workspaceTodoRefreshTimer = 0;

    const refreshCloudWorkspaceTodos = () => {
      if (cancelled || workspaceTodoRefreshTimer) {
        return;
      }
      workspaceTodoRefreshTimer = window.setTimeout(() => {
        workspaceTodoRefreshTimer = 0;
        if (cancelled) {
          return;
        }
        invoke("cloud_mcp_get_status").then((status) => {
          if (cancelled) return;
          setCloudWorkspaceProgress((current) => normalizeCloudWorkspaceProgress(
            cloudWorkspaceProgressFromRuntimeStatus(status),
            current,
          ));
        }).catch(() => {});
      }, 80);
    };

    listen("cloud-mcp-task-history-updated", (event) => {
      if (cancelled) return;
      const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
      const repoPath = String(payload.repoPath || payload.repo_path || "").trim();
      const workspaceId = String(payload.workspaceId || payload.workspace_id || "").trim();
      const taskHistory = payload.taskHistory || payload.task_history || payload.data || null;
      if (payload.error) {
        setWorkspaceGraphStatus(repoPath, workspaceId, {
          architectureError: getErrorMessage(payload.error, "Unable to load Task History."),
          architectureState: "error",
        });
        return;
      }
      if (!taskHistory || typeof taskHistory !== "object") {
        return;
      }
      applyWorkspaceGraphSnapshot(repoPath, workspaceId, taskHistory);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenTaskHistory = unlisten;
    }).catch(() => {});

    listen(CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT, () => {
      refreshCloudWorkspaceTodos();
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenWorkspaceTodos = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (workspaceTodoRefreshTimer) {
        window.clearTimeout(workspaceTodoRefreshTimer);
        workspaceTodoRefreshTimer = 0;
      }
      if (unlistenTaskHistory) {
        unlistenTaskHistory();
      }
      if (unlistenWorkspaceTodos) {
        unlistenWorkspaceTodos();
      }
    };
  }, [applyWorkspaceGraphSnapshot, setWorkspaceGraphStatus]);

  useEffect(() => {
    const repoPath = selectedWorkspaceFileRoot || activatedWorkspaceTerminalWorkingDirectory;
    const workspaceId = selectedWorkspace?.id || "";
    const workspaceName = selectedWorkspace?.name || null;
    if (
      visibleView !== "architecture"
      || !workspaceHydrationReady
      || !repoPath
      || !workspaceId
    ) {
      return undefined;
    }

    let cancelled = false;
    const refreshTaskHistory = () => {
      invoke("cloud_mcp_get_task_history", {
        repoPath,
        workspaceId,
        workspaceName,
      })
        .then((result) => {
          if (!cancelled) applyWorkspaceGraphSnapshot(repoPath, workspaceId, result);
        })
        .catch((error) => {
          if (!cancelled) {
            setWorkspaceGraphStatus(repoPath, workspaceId, {
              architectureState: "error",
              architectureError: getErrorMessage(error, "Unable to load Task History."),
            });
          }
        });
    };

    refreshTaskHistory();
    const intervalId = window.setInterval(refreshTaskHistory, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    activatedWorkspaceTerminalWorkingDirectory,
    applyWorkspaceGraphSnapshot,
    selectedWorkspace?.id,
    selectedWorkspace?.name,
    selectedWorkspaceFileRoot,
    setWorkspaceGraphStatus,
    visibleView,
    workspaceHydrationReady,
  ]);

  useEffect(() => {
    let disposed = false;
    let unlistenRemoteCommand = null;
    let unlistenCreditWallet = null;
    let unlistenDeviceDeleted = null;

    const remoteCommandText = (event) => {
      const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
      return String(
        event?.body
          || event?.message
          || event?.prompt
          || event?.text
          || payload.body
          || payload.message
          || payload.prompt
          || payload.text
          || "",
      ).trim();
    };
    const remoteCommandStringField = (event, keys) => {
      const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
      for (const key of keys) {
        const value = event?.[key] ?? payload?.[key];
        const text = String(value || "").trim();
        if (text) {
          return text;
        }
      }
      return "";
    };
    const remoteCommandObjectField = (event, keys) => {
      const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
      for (const key of keys) {
        const value = event?.[key] ?? payload?.[key];
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return value;
        }
      }
      return null;
    };
    const hydrateRemoteCommandTodoText = async (event, workspaceId, currentText = "") => {
      const existingText = String(currentText || "").trim();
      if (existingText) {
        return existingText;
      }
      const todoId = remoteCommandStringField(event, ["todo_id", "todoId"]);
      const todoDeviceId = remoteCommandStringField(event, [
        "todo_device_id",
        "todoDeviceId",
        "origin_device_id",
        "originDeviceId",
      ]);
      const todoWorkspaceId = remoteCommandStringField(event, [
        "todo_workspace_id",
        "todoWorkspaceId",
        "origin_workspace_id",
        "originWorkspaceId",
      ]);
      const todoRevision = remoteCommandStringField(event, [
        "todo_revision",
        "todoRevision",
        "body_revision",
        "bodyRevision",
        "revision",
      ]);
      const todoBodyHash = remoteCommandStringField(event, [
        "todo_body_hash",
        "todoBodyHash",
        "body_hash",
        "bodyHash",
        "hash",
      ]);
      if (!todoId || !todoDeviceId || !todoWorkspaceId || (!todoRevision && !todoBodyHash)) {
        return "";
      }
      const targetWorkspace = findWorkspaceById(workspacesRef.current, workspaceId);
      const repoPath = cleanWorkspaceRootDirectory(
        targetWorkspace?.repoPath
          || targetWorkspace?.rootDirectory
          || getWorkspaceRootDirectory(workspaceSettingsRef.current, workspaceId)
          || "",
      );
      if (!repoPath) {
        return "";
      }
      try {
        const hydration = await invoke("cloud_mcp_hydrate_workspace_todos", {
          refs: [{
            todoId,
            todoDeviceId,
            todoWorkspaceId,
            ...(todoRevision ? { todoRevision } : {}),
            ...(todoBodyHash ? { todoBodyHash } : {}),
          }],
          repoPath,
          workspaceId,
          workspaceName: targetWorkspace?.name || "",
        });
        const item = Array.isArray(hydration?.items) ? hydration.items[0] : null;
        return String(item?.body || item?.text || "").trim();
      } catch (error) {
        logBigViewSyncDiagnosticEvent("remote_control.todo_hydration_failed", {
          commandId: remoteCommandStringField(event, ["command_id", "commandId"]),
          message: getErrorMessage(error, "Unable to hydrate remote todo body."),
          todoBodyHash,
          todoId,
          workspaceId,
        });
        return "";
      }
    };
    const remoteCommandIntegerField = (event, keys) => {
      const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
      for (const key of keys) {
        const value = event?.[key] ?? payload?.[key];
        const number = Number.parseInt(value, 10);
        if (Number.isInteger(number) && number >= 0) {
          return number;
        }
      }
      return null;
    };
    const remoteCommandWorkspaceId = (event) => {
      const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
      const requestedWorkspaceId = String(
        event?.workspace_id
          || event?.workspaceId
          || payload.workspace_id
          || payload.workspaceId
          || "",
      ).trim();
      if (requestedWorkspaceId && findWorkspaceById(workspaces, requestedWorkspaceId)) {
        return requestedWorkspaceId;
      }
      return activatedWorkspaceIdRef.current
        || selectedWorkspaceIdRef.current
        || "";
    };
    const remoteCommandReceiptKey = (event, commandId, workspaceId) => [
      remoteCommandStringField(event, ["client_id", "clientId"]),
      workspaceId,
      commandId,
    ].map((value) => String(value || "").trim()).join("::");
    const claimRemoteCommandReceipt = (event, commandId, workspaceId) => {
      const receiptKey = remoteCommandReceiptKey(event, commandId, workspaceId);
      if (!commandId || !receiptKey.endsWith(`::${commandId}`)) {
        return true;
      }
      const now = Date.now();
      const receipts = remoteCommandReceiptsRef.current;
      for (const [key, receivedAtMs] of receipts.entries()) {
        if (now - Number(receivedAtMs || 0) > CLOUD_MCP_REMOTE_COMMAND_RECEIPT_TTL_MS) {
          receipts.delete(key);
        }
      }
      if (receipts.has(receiptKey)) {
        return false;
      }
      if (receipts.size >= CLOUD_MCP_REMOTE_COMMAND_RECEIPT_MAX) {
        let oldestKey = "";
        let oldestMs = Number.POSITIVE_INFINITY;
        for (const [key, receivedAtMs] of receipts.entries()) {
          const receiptMs = Number(receivedAtMs || 0);
          if (receiptMs < oldestMs) {
            oldestMs = receiptMs;
            oldestKey = key;
          }
        }
        if (oldestKey) {
          receipts.delete(oldestKey);
        }
      }
      receipts.set(receiptKey, now);
      return true;
    };
    const remoteCommandKind = (event) => {
      const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
      return String(
        event?.command_kind
          || event?.commandKind
          || event?.action
          || event?.command
          || payload.command_kind
          || payload.commandKind
          || payload.action
          || payload.command
          || "create_task",
      ).trim().toLowerCase().replace(/[.\s-]+/g, "_");
    };
    const remoteCommandIsCreateTask = (commandKind) => (
      !commandKind
      || commandKind === "create_task"
      || commandKind === "remote.command.create_task"
      || commandKind === "remote_command.create_task"
      || commandKind === "remote_command_create_task"
      || commandKind === "task.create"
      || commandKind === "task_create"
      || commandKind === "todo.create"
      || commandKind === "todo_create"
    );
    const remoteCommandIsAgentPackageAction = (commandKind) => (
      [
        "agent_install",
        "install_agent",
        "agent_update",
        "update_agent",
      ].includes(String(commandKind || "").trim().toLowerCase().replace(/[.\s-]+/g, "_"))
    );
    const recordRemoteCommandStatus = (event, status, message, details = null) => (
      invoke("cloud_mcp_record_remote_command_status", {
        event,
        status,
        message,
        ...(details && typeof details === "object" ? { details } : {}),
      }).catch(() => {})
    );
    const remoteControlWorkspaceCatalogTargets = (lifecycleOverride = null) => {
      const overrideWorkspaceId = String(lifecycleOverride?.workspaceId || "").trim();
      const activeWorkspaceIds = new Set(normalizeEnabledWorkspaceIds([
        ...normalizeEnabledWorkspaceIds(workspaceLifecycleSettingsRef.current?.enabledWorkspaceIds),
        activatedWorkspaceIdRef.current,
      ]));
      if (overrideWorkspaceId) {
        if (lifecycleOverride?.active) {
          activeWorkspaceIds.add(overrideWorkspaceId);
        } else {
          activeWorkspaceIds.delete(overrideWorkspaceId);
        }
      }
      return (Array.isArray(workspacesRef.current) ? workspacesRef.current : [])
        .map((workspace) => {
          const workspaceId = String(workspace?.id || "").trim();
          if (!workspaceId) {
            return null;
          }
          const rootDirectory = cleanWorkspaceRootDirectory(
            getWorkspaceRootDirectory(workspaceSettingsRef.current, workspaceId)
              || defaultWorkingDirectoryRef.current
              || "",
          );
          const workspaceActive = activeWorkspaceIds.has(workspaceId);
          return {
            dashboardWorkspace: true,
            displaySurface: "dashboard_workspace",
            logicalTerminalCount: getWorkspaceTerminalCount(workspaceSettingsRef.current, workspaceId),
            mountId: "",
            projectName: "",
            repoPath: rootDirectory,
            workspaceActive,
            workspaceId,
            workspaceName: workspace?.name || workspaceId,
            workspaceRole: "desktop_workspace",
            workspaceRoot: rootDirectory,
            workspaceStatus: workspaceActive ? "active" : "deactivated",
          };
        })
        .filter(Boolean);
    };
    const applyRemoteControlWorkspaceOverride = (workspacesSnapshot, lifecycleOverride = null) => {
      const overrideWorkspaceId = String(lifecycleOverride?.workspaceId || "").trim();
      if (!overrideWorkspaceId) {
        return workspacesSnapshot;
      }
      const catalogTarget = remoteControlWorkspaceCatalogTargets(lifecycleOverride)
        .find((workspace) => String(workspace?.workspaceId || "").trim() === overrideWorkspaceId);
      if (!catalogTarget) {
        return workspacesSnapshot;
      }
      let matched = false;
      const adjusted = workspacesSnapshot.map((workspace) => {
        const workspaceId = String(workspace?.workspaceId || workspace?.workspace_id || "").trim();
        if (workspaceId !== overrideWorkspaceId) {
          return workspace;
        }
        matched = true;
        return {
          ...workspace,
          repoPath: workspace?.repoPath || workspace?.repo_path || catalogTarget.repoPath,
          workspaceActive: Boolean(lifecycleOverride.active),
          workspaceId: overrideWorkspaceId,
          workspaceName: workspace?.workspaceName || workspace?.workspace_name || catalogTarget.workspaceName,
          workspaceStatus: lifecycleOverride.active ? "active" : "deactivated",
          ...(lifecycleOverride.active ? {} : { terminals: [] }),
        };
      });
      if (matched) {
        return adjusted;
      }
      return [
        ...adjusted,
        {
          ...catalogTarget,
          terminals: [],
        },
      ];
    };
    const syncRemoteControlState = async (reason, lifecycleOverride = null) => {
      await new Promise((resolve) => window.setTimeout(resolve, lifecycleOverride ? 40 : 180));
      const workspacesSnapshot = Array.isArray(terminalPresenceWorkspacesRef.current)
        ? terminalPresenceWorkspacesRef.current
        : [];
      const catalogTargets = remoteControlWorkspaceCatalogTargets(lifecycleOverride);
      if (catalogTargets.length > 0) {
        await invoke("cloud_mcp_sync_device_workspace_catalog", {
          reason,
          workspaces: catalogTargets,
        }).catch(() => {});
      }
      const adjustedWorkspaces = applyRemoteControlWorkspaceOverride(workspacesSnapshot, lifecycleOverride);
      if (adjustedWorkspaces.length > 0) {
        await invoke("cloud_mcp_sync_terminal_presence", {
          reason,
          workspaces: adjustedWorkspaces,
        }).catch(() => {});
      }
      if (!lifecycleOverride) {
        await invoke("cloud_mcp_sync_device_workspace_snapshot", {
          reason,
        }).catch(() => {});
      }
    };
    const remoteControlTerminalText = (terminal, keys) => {
      for (const key of keys) {
        const value = terminal?.[key];
        const text = String(value || "").trim();
        if (text) return text;
      }
      return "";
    };
    const remoteControlTerminalNameKey = (value) => String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
    const remoteControlTerminalNameCandidates = (terminal) => [
      terminal?.terminalNickname,
      terminal?.terminal_nickname,
      terminal?.terminalName,
      terminal?.terminal_name,
      terminal?.displayName,
      terminal?.display_name,
      terminal?.agentDisplayName,
      terminal?.agent_display_name,
      terminal?.agentType,
      terminal?.agent_type,
    ].map((value) => String(value || "").trim()).filter(Boolean);
    const remoteControlTerminalNumber = (terminal, keys) => {
      for (const key of keys) {
        const number = Number.parseInt(terminal?.[key], 10);
        if (Number.isInteger(number) && number >= 0) return number;
      }
      return null;
    };
    const remoteControlTerminalStatusValues = (terminal) => [
      terminal?.nativeRailState,
      terminal?.native_rail_state,
      terminal?.activityStatus,
      terminal?.activity_status,
      terminal?.executionPhase,
      terminal?.execution_phase,
      terminal?.turnStatus,
      terminal?.turn_status,
      terminal?.readiness,
      terminal?.terminalReadiness,
      terminal?.terminal_readiness,
      terminal?.status,
      terminal?.statusAfter,
      terminal?.terminalLifecycle,
      terminal?.terminal_lifecycle,
      terminal?.sessionState,
      terminal?.session_state,
    ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
    const remoteControlTerminalLooksClosed = (terminal) => (
      remoteControlTerminalStatusValues(terminal).some((status) => (
        ["closed", "closing", "deactivated", "disabled", "exited", "no_session", "offline", "terminated"].includes(status)
      ))
    );
    const assessRemoteControlTerminalIdle = (terminal) => {
      if (!terminal) {
        return { idle: false, reason: "unknown" };
      }
      if (remoteControlTerminalLooksClosed(terminal)) {
        return { idle: false, reason: "already_closed" };
      }
      const statuses = remoteControlTerminalStatusValues(terminal);
      const idleStatus = statuses.find((status) => (
        terminalActivityStatusIsSendable(status)
          || ["complete", "completed", "done", "idle", "input_ready", "interrupted", "ready"].includes(status)
      ));
      if (idleStatus) {
        return { idle: true, reason: idleStatus };
      }
      const busyStatus = statuses.find((status) => (
        terminalActivityStatusIsBusy(status)
          || terminalActivityStatusIsPaused(status)
          || ["busy", "needs_input", "parked", "paused", "queued", "resume_ready", "resume_requested", "running", "submitted", "thinking", "working"].includes(status)
      ));
      if (busyStatus) {
        return { idle: false, reason: busyStatus };
      }
      const errorStatus = statuses.find((status) => ["error", "failed", "timeout"].includes(status));
      if (errorStatus) {
        return { idle: false, reason: errorStatus };
      }
      return { idle: false, reason: "unknown" };
    };
    const findRemoteControlPresenceWorkspace = (workspaceId) => (
      (terminalPresenceWorkspacesRef.current || []).find((workspace) => (
        String(workspace?.workspaceId || workspace?.workspace_id || "").trim() === workspaceId
      )) || null
    );
    const findRemoteControlTerminal = (workspaceId, target = {}) => {
      const presenceWorkspace = findRemoteControlPresenceWorkspace(workspaceId);
      const terminals = Array.isArray(presenceWorkspace?.terminals) ? presenceWorkspace.terminals : [];
      const targetTerminalId = String(target.targetTerminalId || "").trim();
      const targetThreadId = String(target.targetThreadId || "").trim();
      const targetTerminalName = String(target.targetTerminalName || "").trim();
      const targetTerminalNameKey = remoteControlTerminalNameKey(targetTerminalName);
      const targetTerminalIndex = Number.isInteger(target.targetTerminalIndex)
        ? target.targetTerminalIndex
        : null;
      const terminal = terminals.find((candidate) => (
        targetTerminalId
          && [
            candidate?.paneId,
            candidate?.pane_id,
            candidate?.terminalId,
            candidate?.terminal_id,
          ].map((value) => String(value || "").trim()).includes(targetTerminalId)
      )) || terminals.find((candidate) => (
        targetThreadId
          && [
            candidate?.threadId,
            candidate?.thread_id,
          ].map((value) => String(value || "").trim()).includes(targetThreadId)
      )) || terminals.find((candidate) => (
        Number.isInteger(targetTerminalIndex)
          && remoteControlTerminalNumber(candidate, ["terminalIndex", "terminal_index"]) === targetTerminalIndex
      )) || terminals.find((candidate) => (
        targetTerminalNameKey
          && remoteControlTerminalNameCandidates(candidate)
            .some((name) => remoteControlTerminalNameKey(name) === targetTerminalNameKey)
      )) || null;
      return {
        presenceWorkspace,
        terminal,
        terminals,
      };
    };
    const remoteControlTerminalSummary = (terminal, fallback = {}) => ({
      agentId: remoteControlTerminalText(terminal, ["agentId", "agent_id", "agentKind", "agent_kind"]) || fallback.agentId || "",
      paneId: remoteControlTerminalText(terminal, ["paneId", "pane_id", "terminalId", "terminal_id"]) || fallback.targetTerminalId || "",
      reason: fallback.reason || "",
      terminalName: remoteControlTerminalText(terminal, ["terminalNickname", "terminal_nickname", "terminalName", "terminal_name", "displayName", "display_name", "agentDisplayName", "agent_display_name"]) || fallback.targetTerminalName || "",
      terminalIndex: remoteControlTerminalNumber(terminal, ["terminalIndex", "terminal_index"]) ?? fallback.targetTerminalIndex ?? null,
      threadId: remoteControlTerminalText(terminal, ["threadId", "thread_id"]) || fallback.targetThreadId || "",
    });
    const closeRemoteControlTerminal = async (workspaceId, terminal, target = {}) => {
      const paneId = remoteControlTerminalText(terminal, ["paneId", "pane_id", "terminalId", "terminal_id"]);
      const terminalIndex = remoteControlTerminalNumber(terminal, ["terminalIndex", "terminal_index"]);
      const threadId = remoteControlTerminalText(terminal, ["threadId", "thread_id"]);
      const instanceId = remoteControlTerminalText(terminal, ["terminalInstanceId", "terminal_instance_id", "instanceId", "instance_id"]);
      if (!paneId) {
        return {
          closed: false,
          reason: "missing_pane_id",
          terminal: remoteControlTerminalSummary(terminal, target),
        };
      }
      await invoke("terminal_close", {
        paneId,
        instanceId: instanceId || undefined,
        waitForCleanup: WORKSPACE_SETTINGS_WAIT_FOR_TERMINAL_CLEANUP || undefined,
      });
      if (Number.isInteger(terminalIndex)) {
        closeWorkspaceTerminal({
          threadId,
          terminalIndex,
          workspaceId,
        });
      }
      terminalStatusEventEmitterRef.current?.({
        activityStatus: "closed",
        commandPhase: "completed",
        executionPhase: "completed",
        paneId,
        readiness: "closed",
        source: "remote-control-close",
        status: "closed",
        terminalIndex: Number.isInteger(terminalIndex) ? terminalIndex : 0,
        threadId,
        type: "remote-control-close",
        workspaceId,
      }, {
        commandPhase: "completed",
        executionPhase: "completed",
        reason: "remote-control-close",
        status: "closed",
      });
      return {
        closed: true,
        terminal: remoteControlTerminalSummary(terminal, target),
      };
    };
    const collectRemoteControlWorkspaceBlockers = (workspaceId) => {
      const presenceWorkspace = findRemoteControlPresenceWorkspace(workspaceId);
      const terminals = Array.isArray(presenceWorkspace?.terminals) ? presenceWorkspace.terminals : [];
      const activeWorkspaceIds = normalizeEnabledWorkspaceIds(
        workspaceLifecycleSettingsRef.current?.enabledWorkspaceIds,
      );
      const workspaceIsActive = activeWorkspaceIds.includes(workspaceId)
        || activatedWorkspaceIdRef.current === workspaceId;
      if (!presenceWorkspace && workspaceIsActive) {
        const expectedTerminalCount = getWorkspaceTerminalCount(workspaceSettingsRef.current, workspaceId);
        if (expectedTerminalCount > 0) {
          return {
            blockers: [{
              paneId: "",
              reason: "missing_presence_snapshot",
              terminalIndex: null,
              threadId: "",
            }],
            presenceWorkspace,
            terminals,
          };
        }
      }
      const blockers = terminals
        .map((terminal) => ({
          assessment: assessRemoteControlTerminalIdle(terminal),
          terminal,
        }))
        .filter(({ assessment }) => !assessment.idle && assessment.reason !== "already_closed")
        .map(({ assessment, terminal }) => remoteControlTerminalSummary(terminal, {
          reason: assessment.reason,
        }));
      return {
        blockers,
        presenceWorkspace,
        terminals,
      };
    };
    const handleRemoteAgentPackageControl = async ({
      agentId,
      commandId,
      commandKind,
      event,
    }) => {
      const normalizedKind = String(commandKind || "").trim().toLowerCase().replace(/[.\s-]+/g, "_");
      const provider = normalizeManagedAgentProviderId(
        agentId
          || remoteCommandStringField(event, [
            "provider",
            "agent_provider",
            "agentProvider",
            "agent_id",
            "agentId",
            "target_agent_id",
            "targetAgentId",
          ]),
      );
      const updating = normalizedKind === "agent_update" || normalizedKind === "update_agent";
      const source = updating ? "npm-update" : "npm";
      const label = provider ? getManagedAgentLabel(provider) : "coding agent";

      if (!provider) {
        await recordRemoteCommandStatus(event, "failed", "Remote agent package command did not include a supported provider.", {
          commandId,
          commandKind,
        });
        return;
      }

      setAgentInstallState((state) => ({ ...state, [provider]: updating ? "updating" : "installing" }));
      syncAgentInstallationsToCloud(agentStatuses, updating ? "remote_agent_update_start" : "remote_agent_install_start", {
        [provider]: updating ? "updating" : "installing",
      });
      setAgentInstallResults((results) => {
        const nextResults = { ...results };
        delete nextResults[provider];
        return nextResults;
      });

      const runningVerb = updating ? "Updating" : "Installing";
      await recordRemoteCommandStatus(event, "running", `${runningVerb} ${label} on this desktop.`, {
        agentId: provider,
        commandId,
        commandKind,
        source,
      });

      try {
        const result = await invoke(updating ? "update_agent" : "install_agent", { provider });
        setAgentInstallResults((results) => ({ ...results, [provider]: { ...result, source, remote: true } }));
        const nextStatuses = await refreshAgentStatuses();
        const completed = Boolean(result?.installed);
        await recordRemoteCommandStatus(
          event,
          completed ? "completed" : "failed",
          result?.message || (completed
            ? `${label} ${updating ? "updated" : "installed"} on this desktop.`
            : `${label} ${updating ? "update" : "install"} did not complete.`),
          {
            agentId: provider,
            commandId,
            commandKind,
            result,
            status: Array.isArray(nextStatuses)
              ? nextStatuses.find((status) => status.id === provider) || null
              : null,
          },
        );
      } catch (error) {
        const message = getErrorMessage(error, `Unable to ${updating ? "update" : "install"} terminal CLI.`);
        setAgentInstallResults((results) => ({
          ...results,
          [provider]: {
            source,
            remote: true,
            installed: false,
            permissionDenied: false,
            message,
          },
        }));
        await recordRemoteCommandStatus(event, "failed", message, {
          agentId: provider,
          commandId,
          commandKind,
          source,
        });
      } finally {
        setAgentInstallState((state) => ({ ...state, [provider]: "idle" }));
        syncAgentInstallationsToCloud(agentStatuses, updating ? "remote_agent_update_idle" : "remote_agent_install_idle", {
          [provider]: "idle",
        });
      }
    };
    const handleRemoteLifecycleControl = async ({
      agentId,
      commandId,
      commandKind,
      event,
      targetTerminalId,
      targetTerminalIndex,
      targetTerminalName,
      targetThreadId,
      workspaceId,
    }) => {
      const normalizedKind = commandKind.replace(/\./g, "_");
      const targetWorkspace = findWorkspaceById(workspacesRef.current, workspaceId);
      const target = { targetTerminalId, targetTerminalIndex, targetTerminalName, targetThreadId };
      await recordRemoteCommandStatus(event, "validating", "Desktop is validating the remote control command.");
      if (!targetWorkspace) {
        await recordRemoteCommandStatus(event, "failed", "Workspace is not available on this desktop.", {
          commandId,
          commandKind,
          workspaceId,
        });
        return;
      }
      if (workspaceDeactivationInFlightRef.current) {
        await recordRemoteCommandStatus(event, "blocked", "Workspace lifecycle is already changing on this desktop.", {
          commandId,
          commandKind,
          inFlightWorkspaceId: workspaceDeactivationInFlightRef.current,
          workspaceId,
        });
        return;
      }
      if (normalizedKind === "workspace_activate" || normalizedKind === "activate_workspace") {
        const activated = activateWorkspace(workspaceId, "remote_control");
        if (!activated) {
          await recordRemoteCommandStatus(event, "blocked", "Workspace could not be activated on this desktop.", {
            commandId,
            commandKind,
            workspaceId,
          });
          return;
        }
        await syncRemoteControlState("remote_workspace_activate", {
          active: true,
          workspaceId,
        });
        await recordRemoteCommandStatus(event, "completed", "Workspace activated from the web dashboard.", {
          commandId,
          commandKind,
          workspaceId,
        });
        return;
      }
      if (normalizedKind === "terminal_close_idle" || normalizedKind === "close_idle_terminal") {
        const { terminal } = findRemoteControlTerminal(workspaceId, target);
        const assessment = assessRemoteControlTerminalIdle(terminal);
        if (!terminal || !assessment.idle) {
          await recordRemoteCommandStatus(event, "blocked", "Terminal is not idle, so it was not closed.", {
            assessment,
            commandId,
            commandKind,
            terminal: remoteControlTerminalSummary(terminal, {
              reason: assessment.reason,
              ...target,
            }),
            workspaceId,
          });
          return;
        }
        const result = await closeRemoteControlTerminal(workspaceId, terminal, target);
        await syncRemoteControlState("remote_terminal_close_idle");
        await recordRemoteCommandStatus(event, result.closed ? "completed" : "blocked", result.closed
          ? "Idle terminal closed from the web dashboard."
          : "Terminal could not be closed.", {
            commandId,
            commandKind,
            result,
            workspaceId,
          });
        return;
      }
      if (normalizedKind === "workspace_close_idle_terminals" || normalizedKind === "close_idle_terminals") {
        const { terminals } = findRemoteControlTerminal(workspaceId, target);
        const closeResults = [];
        const skipped = [];
        for (const terminal of terminals) {
          const assessment = assessRemoteControlTerminalIdle(terminal);
          if (!assessment.idle) {
            if (assessment.reason !== "already_closed") {
              skipped.push(remoteControlTerminalSummary(terminal, { reason: assessment.reason }));
            }
            continue;
          }
          closeResults.push(await closeRemoteControlTerminal(workspaceId, terminal, target));
        }
        await syncRemoteControlState("remote_workspace_close_idle_terminals");
        await recordRemoteCommandStatus(event, "completed", `Closed ${closeResults.filter((item) => item.closed).length} idle terminal(s).`, {
          closed: closeResults,
          closedCount: closeResults.filter((item) => item.closed).length,
          commandId,
          commandKind,
          skipped,
          workspaceId,
        });
        return;
      }
      if (normalizedKind === "workspace_deactivate_if_idle" || normalizedKind === "deactivate_workspace_if_idle") {
        const { blockers, terminals } = collectRemoteControlWorkspaceBlockers(workspaceId);
        if (blockers.length > 0) {
          await recordRemoteCommandStatus(event, "blocked", "Workspace still has non-idle terminals, so it was not deactivated.", {
            blockers,
            commandId,
            commandKind,
            terminalCount: terminals.length,
            workspaceId,
          });
          return;
        }
        await deactivateWorkspace(workspaceId, "remote_control");
        await syncRemoteControlState("remote_workspace_deactivate_if_idle", {
          active: false,
          workspaceId,
        });
        await recordRemoteCommandStatus(event, "completed", "Workspace deactivated from the web dashboard.", {
          commandId,
          commandKind,
          terminalCount: terminals.length,
          workspaceId,
        });
        return;
      }
      if ([
        "terminal_relaunch_agent",
        "relaunch_terminal_agent",
        "relaunch_terminal",
        "terminal_relaunch",
        "terminal_switch_agent",
        "switch_terminal_agent",
      ].includes(normalizedKind)) {
        const nextAgentId = normalizeManagedAgentProviderId(
          agentId
            || remoteCommandStringField(event, [
              "target_agent_id",
              "targetAgentId",
              "agent_id",
              "agentId",
              "provider",
            ]),
        );
        if (!nextAgentId) {
          await recordRemoteCommandStatus(event, "failed", "Relaunch command did not include a supported agent (claude, codex, or opencode).", {
            commandId,
            commandKind,
            workspaceId,
          });
          return;
        }
        const { terminal } = findRemoteControlTerminal(workspaceId, target);
        const terminalIndex = remoteControlTerminalNumber(terminal, ["terminalIndex", "terminal_index"])
          ?? (Number.isInteger(targetTerminalIndex) ? targetTerminalIndex : null);
        if (!Number.isInteger(terminalIndex)) {
          await recordRemoteCommandStatus(event, "failed", "Target terminal was not found on this desktop.", {
            commandId,
            commandKind,
            target,
            workspaceId,
          });
          return;
        }
        const assessment = assessRemoteControlTerminalIdle(terminal);
        const terminalBusy = Boolean(terminal)
          && !assessment.idle
          && !["already_closed", "unknown", "error", "failed", "timeout"].includes(assessment.reason);
        if (terminalBusy) {
          await recordRemoteCommandStatus(event, "blocked", "Terminal is busy; relaunch it after the current turn finishes.", {
            assessment,
            commandId,
            commandKind,
            terminal: remoteControlTerminalSummary(terminal, { reason: assessment.reason, ...target }),
            workspaceId,
          });
          return;
        }
        const previousAgentId = remoteControlTerminalText(terminal, ["agentId", "agent_id", "agentKind", "agent_kind"]);
        const terminalLooksOpen = Boolean(terminal) && !remoteControlTerminalLooksClosed(terminal);
        if (previousAgentId && previousAgentId === nextAgentId && terminalLooksOpen) {
          await recordRemoteCommandStatus(event, "completed", `Terminal is already running ${getManagedAgentLabel(nextAgentId)}.`, {
            agentId: nextAgentId,
            commandId,
            commandKind,
            terminalIndex,
            workspaceId,
          });
          return;
        }
        const threadId = remoteControlTerminalText(terminal, ["threadId", "thread_id"]) || targetThreadId;
        await recordRemoteCommandStatus(event, "running", `Relaunching terminal as ${getManagedAgentLabel(nextAgentId)}.`, {
          agentId: nextAgentId,
          commandId,
          commandKind,
          previousAgentId,
          terminalIndex,
          workspaceId,
        });
        // Same path as the desktop's own agent switcher: the role change
        // closes the pane and the runtime relaunches it with the new CLI.
        changeWorkspaceTerminalRole({
          role: nextAgentId,
          source: "remote_control_relaunch",
          terminalIndex,
          threadId,
          workspaceId,
        });
        await syncRemoteControlState("remote_terminal_relaunch_agent");
        await recordRemoteCommandStatus(event, "completed", `Terminal relaunched as ${getManagedAgentLabel(nextAgentId)} from the web dashboard.`, {
          agentId: nextAgentId,
          commandId,
          commandKind,
          previousAgentId,
          terminal: remoteControlTerminalSummary(terminal, target),
          terminalIndex,
          workspaceId,
        });
        return;
      }
      if (
        normalizedKind === "workspace_todo_delete"
        || normalizedKind === "todo_delete"
        || normalizedKind === "delete_todo"
      ) {
        const todoId = remoteCommandStringField(event, [
          "todo_id",
          "todoId",
          "item_id",
          "itemId",
          "target_todo_id",
          "targetTodoId",
        ]);
        if (!todoId) {
          await recordRemoteCommandStatus(event, "failed", "Todo delete command did not include a todo id.", {
            commandId,
            commandKind,
            workspaceId,
          });
          return;
        }
        // The desktop stays authoritative: the queue panel removes the todo
        // from its local state, records the deleted receipt, and pushes the
        // removal to cloud via the normal todo state sync.
        window.dispatchEvent(new CustomEvent(REMOTE_TODO_DELETE_EVENT, {
          detail: {
            commandId,
            todoId,
            workspaceId,
          },
        }));
        await recordRemoteCommandStatus(event, "completed", "Todo removed from the desktop queue.", {
          commandId,
          commandKind,
          todoId,
          workspaceId,
        });
        return;
      }
      await recordRemoteCommandStatus(event, "failed", `Unsupported remote control command: ${commandKind}.`, {
        commandId,
        commandKind,
        workspaceId,
      });
    };

    const startRemoteCommandListener = async () => {
      try {
        await invoke("cloud_mcp_start_remote_command_listener");
        unlistenCreditWallet = await listen(CLOUD_MCP_CREDIT_WALLET_EVENT, (creditEvent) => {
          if (disposed) return;
          const event = creditEvent?.payload || {};
          const payload = event.payload && typeof event.payload === "object" ? event.payload : event;
          const wallet = payload.credits || payload.wallet || payload;
          setBillingStatus((current) => ({
            ...(current || {}),
            credits: normalizeLiveCreditWallet(wallet, current?.credits),
          }));
          setBillingStatusState("ready");
          setBillingStatusError("");
        });
        unlistenDeviceDeleted = await listen(CLOUD_MCP_DEVICE_DELETED_EVENT, async () => {
          if (disposed) return;
          await logout();
        });
        unlistenRemoteCommand = await listen(CLOUD_MCP_REMOTE_COMMAND_EVENT, async (remoteEvent) => {
          if (disposed) return;
          const event = remoteEvent?.payload || {};
          const commandId = String(event.command_id || event.commandId || event.payload?.command_id || event.payload?.commandId || "").trim()
            || `remote-command-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          const commandKind = remoteCommandKind(event);
          let text = remoteCommandText(event);
          const workspaceId = remoteCommandWorkspaceId(event);
          const todoDispatchId = remoteCommandStringField(event, [
            "todo_dispatch_id",
            "todoDispatchId",
          ]);
          const todoId = remoteCommandStringField(event, [
            "todo_id",
            "todoId",
          ]);
          const todoDeviceId = remoteCommandStringField(event, [
            "todo_device_id",
            "todoDeviceId",
            "origin_device_id",
            "originDeviceId",
          ]);
          const todoWorkspaceId = remoteCommandStringField(event, [
            "todo_workspace_id",
            "todoWorkspaceId",
            "origin_workspace_id",
            "originWorkspaceId",
          ]);
          const dispatchSource = remoteCommandObjectField(event, [
            "dispatch_source",
            "dispatchSource",
            "source_context",
            "sourceContext",
          ]);
          const dispatchTarget = remoteCommandObjectField(event, [
            "dispatch_target",
            "dispatchTarget",
            "target_context",
            "targetContext",
          ]);
          const agentId = normalizeManagedAgentProviderId(
            event.target_agent_id
              || event.targetAgentId
              || event.payload?.target_agent_id
              || event.payload?.targetAgentId
              || "",
          );
          let targetTerminalId = remoteCommandStringField(event, [
            "target_terminal_id",
            "targetTerminalId",
            "terminal_id",
            "terminalId",
            "pane_id",
            "paneId",
          ]);
          let targetTerminalIndex = remoteCommandIntegerField(event, [
            "target_terminal_index",
            "targetTerminalIndex",
            "terminal_index",
            "terminalIndex",
          ]);
          let targetThreadId = remoteCommandStringField(event, [
            "target_thread_id",
            "targetThreadId",
            "thread_id",
            "threadId",
          ]);
          let targetTerminalName = remoteCommandStringField(event, [
            "target_terminal_nickname",
            "targetTerminalNickname",
            "terminal_nickname",
            "terminalNickname",
            "target_terminal_name",
            "targetTerminalName",
            "terminal_name",
            "terminalName",
            "target_name",
            "targetName",
            "name",
          ]);
          const resolvedRemoteTarget = workspaceId
            ? findRemoteControlTerminal(workspaceId, {
              targetTerminalId,
              targetTerminalIndex,
              targetTerminalName,
              targetThreadId,
            }).terminal
            : null;
          if (resolvedRemoteTarget) {
            targetTerminalId = targetTerminalId || remoteControlTerminalText(
              resolvedRemoteTarget,
              ["paneId", "pane_id", "terminalId", "terminal_id"],
            );
            targetThreadId = targetThreadId || remoteControlTerminalText(
              resolvedRemoteTarget,
              ["threadId", "thread_id"],
            );
            targetTerminalName = targetTerminalName || remoteControlTerminalText(
              resolvedRemoteTarget,
              ["terminalNickname", "terminal_nickname", "terminalName", "terminal_name", "displayName", "display_name", "agentDisplayName", "agent_display_name"],
            );
            if (!Number.isInteger(targetTerminalIndex)) {
              targetTerminalIndex = remoteControlTerminalNumber(
                resolvedRemoteTarget,
                ["terminalIndex", "terminal_index"],
              );
            }
          }
          const targetColorSlot = normalizeTerminalColorSlot(remoteCommandIntegerField(event, [
            "target_color_slot",
            "targetColorSlot",
            "color_slot",
            "colorSlot",
            "terminal_color_slot",
            "terminalColorSlot",
          ]) ?? targetTerminalIndex);
          const rawTargetTerminalColor = remoteCommandStringField(event, [
            "target_terminal_color",
            "targetTerminalColor",
            "terminal_color",
            "terminalColor",
            "color",
          ]);
          const hasTerminalTarget = Boolean(
            targetTerminalId
              || targetThreadId
              || Number.isInteger(targetTerminalIndex)
              || targetTerminalName,
          );
          const hasResolvedTerminalTarget = Boolean(
            targetTerminalId
              || targetThreadId
              || Number.isInteger(targetTerminalIndex),
          );
          const targetTerminalColor = hasTerminalTarget
            ? sanitizeTerminalColor(rawTargetTerminalColor, targetColorSlot ?? targetTerminalIndex ?? 0)
            : "";
          const agentPackageAction = remoteCommandIsAgentPackageAction(commandKind);
          // Agent uninstall has no webview UI path; the Rust lever always
          // owns it (and replies), so the webview stays silent here.
          if (["agent_uninstall", "uninstall_agent", "cli_uninstall"]
            .includes(String(commandKind || "").trim().toLowerCase().replace(/[.\s-]+/g, "_"))) {
            return;
          }
          const receiptWorkspaceId = workspaceId || (agentPackageAction ? "device" : "");
          if (!workspaceId && !agentPackageAction) {
            await recordRemoteCommandStatus(
              event,
              "failed",
              "No local workspace is available for the remote command.",
              { commandId, commandKind },
            );
            return;
          }
          if (!claimRemoteCommandReceipt(event, commandId, receiptWorkspaceId)) {
            logBigViewSyncDiagnosticEvent("remote_control.duplicate_ignored", {
              commandId,
              source: "app_shell",
              surface: "remote_command_listener",
              workspaceId: receiptWorkspaceId,
            });
            await recordRemoteCommandStatus(event, "duplicate_ignored", "Duplicate remote command ignored by desktop UI.", {
              commandId,
              commandKind,
              workspaceId: receiptWorkspaceId,
            });
            return;
          }
          if (agentPackageAction) {
            try {
              await handleRemoteAgentPackageControl({
                agentId,
                commandId,
                commandKind,
                event,
              });
            } catch (error) {
              await recordRemoteCommandStatus(event, "failed", getErrorMessage(error, "Remote agent package command failed."), {
                agentId,
                commandId,
                commandKind,
              });
            }
            return;
          }
          if (!remoteCommandIsCreateTask(commandKind)) {
            try {
              await handleRemoteLifecycleControl({
                agentId,
                commandId,
                commandKind,
                event,
                targetTerminalId,
                targetTerminalIndex,
                targetTerminalName,
                targetThreadId,
                workspaceId,
              });
            } catch (error) {
              await recordRemoteCommandStatus(event, "failed", getErrorMessage(error, "Remote control command failed."), {
                commandId,
                commandKind,
                workspaceId,
              });
            }
            return;
          }
          const targetWorkspace = findWorkspaceById(workspaces, workspaceId);
          text = await hydrateRemoteCommandTodoText(event, workspaceId, text);
          if (!text) {
            await recordRemoteCommandStatus(event, "failed", "Remote command did not include a task message.", {
              commandId,
              commandKind,
              workspaceId,
            });
            return;
          }
          window.dispatchEvent(new CustomEvent(REMOTE_TODO_QUEUE_EVENT, {
            detail: {
              item: {
                createdAt: event.created_at || event.createdAt || new Date().toISOString(),
                id: commandId,
                kind: "todo",
                remoteCommand: {
                  commandId,
                  ...(dispatchSource ? { dispatchSource } : {}),
                  ...(dispatchTarget ? { dispatchTarget } : {}),
                  source: event.source || "next-diffforge",
                  todoDispatchId,
                  todoId,
                  todoDeviceId,
                  todoWorkspaceId,
                  targetTerminalId,
                  targetTerminalIndex,
                  targetTerminalName,
                  targetThreadId,
                  ...(targetTerminalColor ? { targetTerminalColor } : {}),
                  ...(Number.isInteger(targetColorSlot) ? { targetColorSlot } : {}),
                },
                source: "next-remote-control",
                targetAgentId: agentId || "",
                targetAgentLabel: agentId ? getManagedAgentLabel(agentId) : "",
                ...(targetTerminalColor ? { targetTerminalColor } : {}),
                ...(Number.isInteger(targetColorSlot) ? { targetColorSlot } : {}),
                targetTerminalId,
                targetTerminalIndex,
                targetTerminalName,
                targetThreadId,
                text,
                workspaceId,
              },
              commandId,
              source: "next-diffforge",
              workspaceId,
              workspaceName: targetWorkspace?.name || "",
            },
          }));
          playNotificationSfx("todo.arrived");
          // The arrival native notification is sent from Rust at remote
          // intake (todo_dispatch_record_remote_intake), before the webview
          // ever sees the command.
          if (hasResolvedTerminalTarget) {
            terminalStatusEventEmitterRef.current?.({
              activityStatus: "queued",
              agentId: agentId || "",
              commandId,
              commandPhase: "queued",
              executionPhase: "queued",
              inputReady: false,
              messageSource: "next-remote-control",
              paneId: targetTerminalId,
              readiness: "busy",
              source: "remote-command-queued",
              status: "active",
              terminalIndex: Number.isInteger(targetTerminalIndex) ? targetTerminalIndex : 0,
              threadId: targetThreadId,
              turnId: commandId,
              turnStatus: "queued",
              type: "remote-command-queued",
              workspaceId,
              workspaceName: targetWorkspace?.name || "",
            }, {
              commandPhase: "queued",
              executionPhase: "queued",
              reason: "remote-command-queued",
              status: "queued",
            });
          }
          await recordRemoteCommandStatus(
            event,
            "queued",
            Number.isInteger(targetTerminalIndex)
              ? `Queued for terminal ${targetTerminalIndex + 1}.`
              : targetTerminalName
                ? `Queued for ${targetTerminalName}.`
                : agentId
                ? `Queued for ${getManagedAgentLabel(agentId)}.`
                : "Queued for the next available terminal.",
            { commandId, commandKind, targetTerminalName, workspaceId },
          );
        });
      } catch (error) {
        logBigViewSyncDiagnosticEvent("remote_control.listener_error", {
          message: getErrorMessage(error, "Remote command listener failed."),
          surface: "app_shell",
        });
      }
    };

    startRemoteCommandListener();
    return () => {
      disposed = true;
      if (typeof unlistenRemoteCommand === "function") {
        unlistenRemoteCommand();
      }
      if (typeof unlistenCreditWallet === "function") {
        unlistenCreditWallet();
      }
      if (typeof unlistenDeviceDeleted === "function") {
        unlistenDeviceDeleted();
      }
    };
  }, [activateWorkspace, agentStatuses, changeWorkspaceTerminalRole, closeWorkspaceTerminal, deactivateWorkspace, logout, refreshAgentStatuses, syncAgentInstallationsToCloud, workspaces]);

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

  const applyWorkspaceThreadTranscriptEvent = useCallback((event = {}) => {
    const result = event?.result || event?.transcript || event || {};
    const workspaceId = String(event.workspaceId || result.workspaceId || "").trim();
    const threadId = String(event.threadId || result.threadId || "").trim();
    const agentId = String(
      event.agentId || event.currentAgent || result.agentId || "codex",
    ).trim().toLowerCase();
    if (!workspaceId || !threadId || !["claude", "codex", "opencode"].includes(agentId)) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.event_skip", {
        agentId,
        hasThreadId: Boolean(threadId),
        hasWorkspaceId: Boolean(workspaceId),
        reason: "invalid_target",
      });
      return;
    }
    const thread = workspaceThreadsRef.current?.[workspaceId]?.threads?.[threadId];
    if (!thread || thread.archivedAt) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.event_skip", {
        agentId,
        reason: thread?.archivedAt ? "thread_archived" : "thread_missing",
        threadId,
        workspaceId,
      });
      return;
    }
    if (!workspaceThreadTranscriptHydrationIsVisible({ threadId, workspaceId })) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.event_skip", {
        agentId,
        reason: "thread_detail_not_visible",
        threadId,
        workspaceId,
      });
      return;
    }

    const providerBinding = getWorkspaceThreadProviderBinding(thread, agentId);
    const sessionId = String(
      result.sessionId
        || event.providerSessionId
        || event.nativeSessionId
        || thread.transcriptSessionId
        || providerBinding?.nativeSessionId
        || "",
    ).trim();
    if (
      sessionId
      && workspaceThreadSessionIsArchived(
        workspaceThreadsRef.current,
        workspaceId,
        agentId,
        sessionId,
      )
    ) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.event_skip", {
        agentId,
        reason: "provider_session_archived",
        sessionIdPresent: true,
        threadId,
        workspaceId,
      });
      return;
    }

    const messages = Array.isArray(result.messages) ? result.messages : [];
    const latestUserMessage = getLatestWorkspaceThreadUserMessage(thread);
    const expectedUserMessage = String(
      event.expectedUserMessage
        || event.userMessage
        || event.message
        || latestUserMessage?.text
        || "",
    ).trim();
    const expectedMessageCreatedAt = String(
      event.expectedMessageCreatedAt
        || event.messageCreatedAt
        || event.submittedAt
        || latestUserMessage?.createdAt
        || thread.latestTurn?.startedAt
        || thread.latestTurn?.requestedAt
        || "",
    ).trim();
    const submittedAt = String(
      event.submittedAt
        || event.promptEventSubmittedAt
        || expectedMessageCreatedAt
        || "",
    ).trim();
    const promptEventId = String(
      event.promptEventId
        || event.pendingPromptId
        || getPromptEventIdFromRunningThread(thread)
        || "",
    ).trim();
    const transcriptLifecycleUsesActivityHooks = terminalAgentUsesActivityHooks(agentId);
    const matchedBy = String(result.matchedBy || event.matchedBy || "sessionid").trim().toLowerCase();
    const allowTimestampFallback = event.allowTimestampFallback === true
      || matchedBy.includes("timestamp")
      || matchedBy.includes("recovery");
    const transcriptPromptAccepted = transcriptHasSubmittedPromptEvidence(messages, {
      allowTimestampFallback,
      expectedUserMessage,
      matchedBy,
      messageCreatedAt: expectedMessageCreatedAt,
      submittedAt,
    });
    const latestTerminalSubmitAcceptance = getWorkspaceThreadPromptAcceptance(
      workspaceThreadAcceptedPromptsRef.current,
      {
        agentId,
        expectedUserMessage,
        promptEventId,
        promptText: expectedUserMessage,
        sessionId,
        threadId,
        workspaceId,
      },
    );
	    const terminalSubmitPromptAccepted = event.terminalPromptAccepted === true
	      || Boolean(latestTerminalSubmitAcceptance);
    const currentReadinessCanSettleTurn = false;
	    const terminalReadinessCanSettleTurn = false;
	    const terminalLifecycleCanSettleTurn = false;
	    const promptAccepted = transcriptLifecycleUsesActivityHooks
        ? terminalSubmitPromptAccepted
        : transcriptPromptAccepted || terminalSubmitPromptAccepted;
    const rawTurnCompleteSeen = transcriptHasTurnCompletionForPromptEvidence(messages, {
      agentId,
      allowTimestampFallback,
      expectedUserMessage,
      matchedBy,
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
	    const activeRunningTurn = String(thread.latestTurn?.state || "").trim().toLowerCase() === "running";
	    const transcriptTargetsLatestTurn = threadLatestTurnMatchesPrompt(thread, {
	      ...event,
	      promptEventId,
	    });
	    const transcriptTargetsLatestRunningTurn = threadLatestRunningTurnMatchesPrompt(thread, {
	      ...event,
	      expectedMessageCreatedAt,
      expectedUserMessage,
      matchedBy,
	      promptEventId,
	      submittedAt,
	    });
	    const promptTurnIdentityRequired = Boolean(promptEventId);
	    const transcriptTargetsRequestedTurn = Boolean(
	      !promptTurnIdentityRequired || transcriptTargetsLatestTurn,
	    );
    const expectedUserMessageIsControlPrompt = Boolean(
      expectedUserMessage && isTerminalControlHistoryPrompt(expectedUserMessage),
    );
    const transcriptCompletionHasPromptEvidence = Boolean(
      !expectedUserMessage
        || expectedUserMessageIsControlPrompt
        || transcriptPromptAccepted
    );
		    const transcriptCompletionTargetsTurn = Boolean(
		      transcriptTargetsRequestedTurn
		        && (
		          !activeRunningTurn
		          || transcriptTargetsLatestRunningTurn
		          || !promptTurnIdentityRequired
		        ),
		    );
		    const transcriptCompletionCanSettleTurn = Boolean(
		      rawTurnCompleteSeen
		        && transcriptCompletionHasPromptEvidence
		        && transcriptCompletionTargetsTurn
		    );
		    const turnCompleteSeen = Boolean(rawTurnCompleteSeen && transcriptCompletionCanSettleTurn);
		    const assistantResponseCompletesTurn = Boolean(
		      settledAssistantResponseSeen && transcriptCompletionCanSettleTurn,
		    );
			    const terminalFinishSignal = transcriptCompletionCanSettleTurn;
		    const transcriptCompletionBlockers = [
			      rawTurnCompleteSeen ? "" : "no_task_complete_evidence",
			      transcriptCompletionHasPromptEvidence ? "" : "missing_prompt_acceptance_evidence",
			      promptTurnIdentityRequired && !transcriptTargetsLatestTurn ? "completion_not_latest_prompt_turn" : "",
			      activeRunningTurn && !transcriptTargetsLatestRunningTurn ? "completion_not_latest_running_turn" : "",
				      settledAssistantResponseSeen && !promptAccepted && !transcriptPromptAccepted ? "assistant_seen_without_prompt_acceptance" : "",
			    ].filter(Boolean);

    logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.event_result", {
      agentId,
      activeRunningTurn,
      assistantResponseCompletesTurn,
      completionBlockers: transcriptCompletionBlockers,
      expectedMessageCreatedAtPresent: Boolean(expectedMessageCreatedAt),
      expectedUserMessageLength: getThreadDiagnosticTextLength(expectedUserMessage),
      latestTimestampPresent: Boolean(result.latestTimestamp),
      latestTurnId: thread.latestTurn?.turnId || thread.latestTurn?.id || "",
      latestTurnMessageId: thread.latestTurn?.messageId || "",
      latestTurnState: thread.latestTurn?.state || thread.latestTurn?.status || "",
      matchedBy,
      messageCount: messages.length,
      promptAccepted,
      promptEventIdPresent: Boolean(promptEventId),
      rawTurnCompleteSeen,
      sessionIdPresent: Boolean(sessionId),
	      settledAssistantResponseSeen,
	      submittedAtPresent: Boolean(submittedAt),
			      terminalLifecycleCanSettleTurn,
			      terminalFinishSignal,
			      terminalReadinessCanSettleTurn,
	      terminalSubmitPromptAccepted,
	      transcriptCompletionCanSettleTurn,
	      transcriptLifecycleUsesActivityHooks,
	      threadId,
	      transcriptPromptAccepted,
	      transcriptTargetsLatestTurn,
	      transcriptTargetsLatestRunningTurn,
	      transcriptTargetsRequestedTurn,
	      turnCompleteSeen,
      workspaceId,
    });

    if (promptAccepted && promptEventId) {
      rememberWorkspaceThreadPromptAcceptance(workspaceThreadAcceptedPromptsRef.current, {
        agentId,
        matchedBy: transcriptPromptAccepted && !transcriptLifecycleUsesActivityHooks
          ? matchedBy
          : "terminal-submit",
        promptEventId,
        promptText: expectedUserMessage,
        sessionId,
        threadId,
        workspaceId,
      });
      window.dispatchEvent(new CustomEvent(WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT, {
        detail: {
          agentId,
          matchedBy: transcriptPromptAccepted && !transcriptLifecycleUsesActivityHooks
            ? matchedBy
            : "terminal-submit",
          promptEventId,
          promptText: expectedUserMessage,
          sessionId,
          threadId,
          workspaceId,
        },
      }));
    }

	    if (
	      !transcriptLifecycleUsesActivityHooks
	      && rawTurnCompleteSeen
	      && promptTurnIdentityRequired
	      && !transcriptTargetsLatestTurn
	    ) {
	      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.event_skip", {
	        agentId,
	        matchedBy,
	        messageCount: messages.length,
	        promptEventId,
	        reason: "stale_completion_not_current_prompt_turn",
	        threadId,
	        transcriptTargetsLatestRunningTurn,
	        transcriptTargetsLatestTurn,
	        workspaceId,
	            });
	            return;
	          }
	          setWorkspaceThreads((threads) => {
	            const beforeSnapshot = getWorkspaceThreadDiagnosticSnapshotForLog(
        threads,
        workspaceId,
        threadId,
        agentId,
      );
      const hydrateEvent = {
	        agentId,
		        allowTranscriptTurnCompletion: transcriptCompletionCanSettleTurn,
        assistantResponseCompletesTurn,
        expectedMessageCreatedAt,
        expectedUserMessage,
        latestTimestamp: result.latestTimestamp || "",
        messages,
        matchedBy: result.matchedBy || matchedBy,
        promptAccepted,
        promptEpoch: getWorkspaceThreadPromptEpoch(event),
        promptEventId,
        promptEventSubmittedAt: event.promptEventSubmittedAt || submittedAt || expectedMessageCreatedAt,
        providerSessionId: sessionId,
        requestedProviderSessionId: sessionId,
        rolloutPath: result.rolloutPath || "",
        sessionId,
        sessionTitle: result.sessionTitle || "",
        source: `${agentId}-session-watch`,
        sourcePath: result.rolloutPath || "",
        submittedAt,
		        transcriptCompletionCanSettleTurn,
		        transcriptExplicitCompletionCanSettleTurn: transcriptCompletionCanSettleTurn,
	        threadId,
	        turnCompleteSeen,
	        workspaceId,
	      };
      const hydrationDiagnostics = getWorkspaceThreadHydrationDiagnosticsForLog(
        threads,
        hydrateEvent,
      );
      const nextThreads = hydrateWorkspaceThreadSessionTranscript(threads, hydrateEvent);
      const stateChanged = nextThreads !== threads;
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.event_apply", {
        after: getWorkspaceThreadDiagnosticSnapshotForLog(nextThreads, workspaceId, threadId, agentId),
        agentId,
        before: beforeSnapshot,
        completionFallbackApplied: false,
        completionFallbackProjectionEvents: 0,
        hydrationDiagnostics,
        messageCount: messages.length,
        stateChanged,
        threadId,
        workspaceId,
      });
      return nextThreads;
    });

  }, [workspaceThreadTranscriptHydrationIsVisible]);

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
    if (!workspaceThreadTranscriptHydrationIsVisible({ threadId, workspaceId })) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.request_skip", {
        agentId,
        reason: "thread_detail_not_visible",
        threadId,
        workspaceId,
      });
      return;
    }

    const requestUsesActivityHooks = terminalAgentUsesActivityHooks(agentId);
    const requestedProviderSessionId = String(
      event.nativeSessionId
        || event.providerSessionId
        || "",
    ).trim();
    const requestedWorktreePath = String(
      event.worktreePath
        || event.coordination?.worktreePath
        || "",
    ).trim();
    const requestedCwd = String(
      event.cwd
        || event.workingDirectory
        || "",
    ).trim();
    const requestedRepoPath = String(event.repoPath || "").trim();
    const requestedPollUntilTurnComplete = event.pollUntilTurnComplete === true || event.pollUntilAssistant === true;
    const pollUntilTurnComplete = requestedPollUntilTurnComplete && !requestUsesActivityHooks;
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
    const promptAcceptanceLookup = {
      agentId,
      expectedUserMessage,
      promptEventId,
      promptText: expectedUserMessage,
      threadId,
      workspaceId,
    };
    const cachedTerminalSubmitAcceptance = getWorkspaceThreadPromptAcceptance(
      workspaceThreadAcceptedPromptsRef.current,
      promptAcceptanceLookup,
    );
    const terminalSubmitPromptAccepted = event.terminalPromptAccepted === true
      || (
        event.source === "terminal-prompt-submitted"
        && event.promptAccepted === true
      )
      || Boolean(cachedTerminalSubmitAcceptance);
    const expectedUserMessageIsControlPrompt = Boolean(
      expectedUserMessage && isTerminalControlHistoryPrompt(expectedUserMessage),
    );
    const promptAcceptanceTimeoutApplies = Boolean(
      pollUntilTurnComplete
        && expectedUserMessage
        && !expectedUserMessageIsControlPrompt
        && (
          promptEventId
          || event.type === "message-submitted"
          || event.source === "terminal-prompt-submitted"
        )
    );
    const transcriptPollTimeoutMs = terminalSubmitPromptAccepted
      ? WORKSPACE_THREAD_TERMINAL_SUBMIT_TRANSCRIPT_POLL_TIMEOUT_MS
      : promptAcceptanceTimeoutApplies
        ? WORKSPACE_THREAD_UNACCEPTED_PROMPT_TRANSCRIPT_POLL_TIMEOUT_MS
        : WORKSPACE_THREAD_PROJECTION_POLL_TIMEOUT_MS;

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
    const requestAcceptanceKeys = getWorkspaceThreadPromptAcceptanceKeys(promptAcceptanceLookup);
    const existingRequest = workspaceThreadTranscriptRequestsRef.current.get(requestKey);
    if (existingRequest?.inFlight) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.duplicate_in_flight", {
        agentId,
        requestKey,
        requestedCwdPresent: Boolean(requestedCwd),
        requestedProviderSessionPresent: Boolean(requestedProviderSessionId),
        snapshot: getWorkspaceThreadDiagnosticSnapshotForLog(
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
      workspaceThreadTranscriptRequestsRef.current.set(requestKey, {
        acceptanceKeys: requestAcceptanceKeys,
        agentId,
        expectedUserMessage,
        inFlight: true,
        promptEventId,
        terminalPromptAccepted: terminalSubmitPromptAccepted,
        threadId,
        timer: 0,
        workspaceId,
      });
      const thread = workspaceThreadsRef.current?.[workspaceId]?.threads?.[threadId];
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.start", {
        agentId,
        requestKey,
        requestedCwdPresent: Boolean(requestedCwd),
        requestedProviderSessionPresent: Boolean(requestedProviderSessionId),
        requestedRepoPathPresent: Boolean(requestedRepoPath),
        snapshot: getWorkspaceThreadDiagnosticSnapshotForLog(
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
      if (!workspaceThreadTranscriptHydrationIsVisible({ threadId, workspaceId })) {
        logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
          agentId,
          reason: "thread_detail_not_visible",
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
      const threadWorktreePath = String(
        thread.coordination?.worktreePath
          || providerBinding?.coordination?.worktreePath
          || "",
      ).trim();
      const homeSearchCwd = String(
        event.homeSearchCwd
          || event.home_search_cwd
          || requestedWorktreePath
          || threadWorktreePath
          || requestedCwd
          || requestedRepoPath
          || "",
      ).trim();
      const discoveryCwd = cleanWorkspaceRootDirectory(
        requestedCwd
          || requestedRepoPath
          || threadWorktreePath
          || homeSearchCwd
          || "",
      );
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
          && elapsedMs < transcriptPollTimeoutMs;
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
          snapshot: getWorkspaceThreadDiagnosticSnapshotForLog(
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
          && elapsedMs < transcriptPollTimeoutMs;
        logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
          agentId,
          elapsedMs,
          hasProviderSessionId: false,
          pollUntilTurnComplete,
          promptEventIdPresent: Boolean(promptEventId),
          reason: "session_required",
          requestKey,
          snapshot: getWorkspaceThreadDiagnosticSnapshotForLog(
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

      const providerTranscriptWatchKey = workspaceThreadTranscriptWatchKey({
        agentId,
        promptEventId,
        providerSessionId,
        threadId,
        workspaceId,
      });
      let providerTranscriptWatchKeyRegisteredByRequest = false;
      if (providerTranscriptWatchKey) {
        const providerTranscriptWatchAlreadyActive = workspaceThreadTranscriptWatchKeysRef.current.has(providerTranscriptWatchKey);
        const shouldRefreshActiveTranscriptWatch = Boolean(
          providerTranscriptWatchAlreadyActive
            && pollUntilTurnComplete
            && (promptEventId || expectedUserMessage)
        );
        if (providerTranscriptWatchAlreadyActive && !shouldRefreshActiveTranscriptWatch) {
          logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
            agentId,
            pollUntilTurnComplete,
            promptEventIdPresent: Boolean(promptEventId),
            providerSessionPresent: Boolean(providerSessionId),
            reason: "transcript_watch_already_active",
            requestKey,
            threadId,
            workspaceId,
          });
          workspaceThreadTranscriptRequestsRef.current.delete(requestKey);
          return;
        }
        if (providerTranscriptWatchAlreadyActive) {
          logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.watch_refresh", {
            agentId,
            expectedUserMessageLength: getThreadDiagnosticTextLength(expectedUserMessage),
            pollUntilTurnComplete,
            promptEventIdPresent: Boolean(promptEventId),
            providerSessionPresent: Boolean(providerSessionId),
            reason: "turn_completion_refresh",
            requestKey,
            threadId,
            workspaceId,
          });
        } else {
          workspaceThreadTranscriptWatchKeysRef.current.add(providerTranscriptWatchKey);
          providerTranscriptWatchKeyRegisteredByRequest = true;
        }
      }

      const transcriptCommand = providerSessionId
        ? "agent_thread_transcript_watch"
        : "agent_thread_session_discover";
      const transcriptRequest = providerSessionId
        ? {
          agentId,
          allowTimestampFallback,
          cwd: discoveryCwd,
          expectedMessageCreatedAt,
          expectedUserMessage,
          instanceId: event.instanceId,
          maxMessages: 320,
          paneId: event.paneId || "",
          pollUntilTurnComplete,
          promptEventId,
          promptEventSubmittedAt: event.promptEventSubmittedAt || submittedAt || expectedMessageCreatedAt,
          providerSessionId,
          source: event.source || event.type || "",
          submittedAt,
          terminalIndex: Number.isFinite(Number(event.terminalIndex)) ? Number(event.terminalIndex) : null,
          terminalPromptAccepted: terminalSubmitPromptAccepted,
          threadId,
          workspaceId,
        }
        : {
          allowTimestampFallback,
          agentId,
          cwd: discoveryCwd,
          expectedUserMessage,
          fallbackWindowMs: 90000,
          homeSearchCwd,
          maxMessages: 320,
          submittedAt,
          workspaceId,
        };
      const transcriptWatchRequested = Boolean(providerSessionId);
      const transcriptContinueDelayMs = transcriptWatchRequested
        ? WORKSPACE_THREAD_TRANSCRIPT_WATCH_FALLBACK_INTERVAL_MS
        : WORKSPACE_THREAD_PROJECTION_POLL_INTERVAL_MS;
      logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.invoke", {
        agentId,
        command: transcriptCommand,
        cwdPresent: Boolean(!providerSessionId && discoveryCwd),
        discoveryMode: !providerSessionId,
        providerSessionPresent: Boolean(providerSessionId),
        requestKey,
        requestedCwdPresent: Boolean(requestedCwd),
        requestedProviderSessionPresent: Boolean(requestedProviderSessionId),
        snapshot: getWorkspaceThreadDiagnosticSnapshotForLog(
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
          const transcriptPromptAccepted = transcriptHasSubmittedPromptEvidence(messages, {
            allowTimestampFallback,
            expectedUserMessage,
            matchedBy,
            messageCreatedAt: expectedMessageCreatedAt,
            submittedAt,
          });
          const latestTerminalSubmitAcceptance = getWorkspaceThreadPromptAcceptance(
            workspaceThreadAcceptedPromptsRef.current,
            {
              ...promptAcceptanceLookup,
              sessionId,
            },
          );
          const terminalSubmitPromptAcceptedForResult = terminalSubmitPromptAccepted
            || Boolean(latestTerminalSubmitAcceptance);
          const promptAccepted = requestUsesActivityHooks
            ? terminalSubmitPromptAcceptedForResult
            : transcriptPromptAccepted || terminalSubmitPromptAcceptedForResult;
          const promptAcceptedBy = transcriptPromptAccepted && !requestUsesActivityHooks
            ? "transcript"
            : terminalSubmitPromptAcceptedForResult
              ? "terminal-submit"
              : "";
          const rawTurnCompleteSeen = transcriptHasTurnCompletionForPromptEvidence(messages, {
            agentId,
            allowTimestampFallback,
            expectedUserMessage,
            matchedBy,
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
	              || workspaceThreadTranscriptHydrationIsVisible({ threadId, workspaceId }),
	          );
          const threadAtTranscriptResult = workspaceThreadsRef.current?.[workspaceId]?.threads?.[threadId];
          const currentReadinessCanSettleTurn = false;
          const terminalReadinessCanSettleTurn = false;
          const terminalDetachedCanSettleTurn = false;
          const terminalLifecycleCanSettleTurn = false;
          const expectedUserMessageIsControlPrompt = Boolean(
            expectedUserMessage && isTerminalControlHistoryPrompt(expectedUserMessage),
          );
          const transcriptCompletionHasPromptEvidence = Boolean(
            !pollUntilTurnComplete
              || !expectedUserMessage
              || expectedUserMessageIsControlPrompt
              || transcriptPromptAccepted
          );
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
              matchedBy,
              submittedAt,
	            },
	          );
	          const transcriptTargetsLatestTurn = threadLatestTurnMatchesPrompt(
	            threadAtTranscriptResult,
	            {
	              ...event,
	              promptEventId,
	            },
	          );
	          const promptTurnIdentityRequired = Boolean(promptEventId);
	          const transcriptTargetsRequestedTurn = Boolean(
	            !promptTurnIdentityRequired || transcriptTargetsLatestTurn,
	          );
		          const terminalFinishSignal = rawTurnCompleteSeen;
		          const staleTranscriptCompletionBlocked = Boolean(
		            rawTurnCompleteSeen
		              && promptTurnIdentityRequired
		              && !transcriptTargetsLatestTurn
		          );
		          const matchedTranscriptCompletionCanSettleTurn = Boolean(
		            transcriptRequestCanSettleTurn
		              && rawTurnCompleteSeen
		              && transcriptCompletionHasPromptEvidence
		              && transcriptTargetsRequestedTurn
		              && (
		                !activeRunningTurnAtTranscriptResult
		                || transcriptTargetsLatestRunningTurn
		                || !promptTurnIdentityRequired
		              )
		          );
		          const authoritativeTranscriptCompletionCanSettleTurn = Boolean(
		            matchedTranscriptCompletionCanSettleTurn
		              && (promptAccepted || transcriptPromptAccepted)
		          );
		          const sessionTranscriptCanSettleTurn = Boolean(
		            authoritativeTranscriptCompletionCanSettleTurn
		              && (matchedBy === "sessionid" || !providerSessionId)
		          );
	          const transcriptExplicitCompletionCanSettleTurn = authoritativeTranscriptCompletionCanSettleTurn;
		          const assistantResponseCompletesTurn = Boolean(
		            settledAssistantResponseSeen && authoritativeTranscriptCompletionCanSettleTurn,
		          );
	          const turnCompleteSeen = Boolean(
	            rawTurnCompleteSeen && authoritativeTranscriptCompletionCanSettleTurn,
	          );
			          const allowTranscriptTurnCompletion = authoritativeTranscriptCompletionCanSettleTurn;
			          const transcriptCompletionCanSettleTurn = authoritativeTranscriptCompletionCanSettleTurn;
	          const transcriptCompletionBlockers = [
		            transcriptRequestCanSettleTurn ? "" : "request_not_allowed_to_settle_turn",
		            rawTurnCompleteSeen ? "" : "no_task_complete_evidence",
		            transcriptCompletionHasPromptEvidence ? "" : "missing_prompt_acceptance_evidence",
		            promptTurnIdentityRequired && !transcriptTargetsLatestTurn ? "completion_not_latest_prompt_turn" : "",
		            activeRunningTurnAtTranscriptResult && !transcriptTargetsLatestRunningTurn ? "completion_not_latest_running_turn" : "",
		            settledAssistantResponseSeen && !promptAccepted && !transcriptPromptAccepted ? "assistant_seen_without_prompt_acceptance" : "",
		          ].filter(Boolean);
          const transcriptMessageDiagnostics = THREAD_BRIDGE_DIAGNOSTIC_LOGGING_ENABLED
            ? messages.slice(-4).map((message) => ({
              createdAtPresent: Boolean(String(message?.createdAt || message?.created_at || "").trim()),
              idPresent: Boolean(String(message?.id || "").trim()),
              kind: String(message?.kind || "").trim(),
              role: String(message?.role || "").trim(),
              source: String(message?.source || "").trim(),
              status: String(message?.status || "").trim(),
              textLength: String(message?.text || message?.message || "").length,
              turnIdPresent: Boolean(String(message?.turnId || message?.turn_id || "").trim()),
            }))
            : null;
          logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.result", {
            agentId,
            activeRunningTurnAtTranscriptResult,
            allowTranscriptTurnCompletion,
            authoritativeTranscriptCompletionCanSettleTurn,
            assistantResponseCompletesTurn,
            completionBlockers: transcriptCompletionBlockers,
            latestTimestampPresent: Boolean(result?.latestTimestamp),
            latestTurnId: latestTurnAtTranscriptResult?.turnId || latestTurnAtTranscriptResult?.id || "",
            latestTurnMessageId: latestTurnAtTranscriptResult?.messageId || "",
            latestTurnState: latestTurnAtTranscriptResult?.state || latestTurnAtTranscriptResult?.status || "",
            matchedBy: result?.matchedBy || "",
            matchedTranscriptCompletionCanSettleTurn,
            messageCount: messages.length,
            messageDiagnostics: transcriptMessageDiagnostics,
            pollUntilTurnComplete,
            requestKey,
            rolloutPathPresent: Boolean(result?.rolloutPath),
            sessionIdPresent: Boolean(sessionId),
            sessionTitlePresent: Boolean(result?.sessionTitle),
            snapshot: getWorkspaceThreadDiagnosticSnapshotForLog(
              workspaceThreadsRef.current,
              workspaceId,
              threadId,
              agentId,
            ),
            threadId,
            promptAccepted,
            promptAcceptedBy,
            rawTurnCompleteSeen,
            settledAssistantResponseSeen,
		            sessionTranscriptCanSettleTurn,
		            staleTranscriptCompletionBlocked,
		            terminalFinishSignal,
		            terminalLifecycleCanSettleTurn,
	            terminalSubmitPromptAccepted: terminalSubmitPromptAcceptedForResult,
	            terminalReadinessCanSettleTurn,
		            transcriptCompletionCanSettleTurn,
		            transcriptPromptAccepted,
	            transcriptExplicitCompletionCanSettleTurn,
	            transcriptTargetsLatestTurn,
	            transcriptTargetsLatestRunningTurn,
	            transcriptTargetsRequestedTurn,
	            transcriptRequestCanSettleTurn,
            turnCompleteSeen,
            workspaceId,
          });
          logTerminalStatus("frontend.terminal_status.transcript_result", {
            agentId,
            activeRunningTurnAtTranscriptResult,
            allowTranscriptTurnCompletion,
            authoritativeTranscriptCompletionCanSettleTurn,
            assistantResponseCompletesTurn,
            completionBlockers: transcriptCompletionBlockers,
            latestTurnId: latestTurnAtTranscriptResult?.turnId || latestTurnAtTranscriptResult?.id || "",
            latestTurnMessageId: latestTurnAtTranscriptResult?.messageId || "",
            latestTurnState: latestTurnAtTranscriptResult?.state || latestTurnAtTranscriptResult?.status || "",
            matchedBy: result?.matchedBy || "",
            matchedTranscriptCompletionCanSettleTurn,
            messageCount: messages.length,
            pollUntilTurnComplete,
            promptAccepted,
            promptAcceptedBy,
            promptEventId,
            rawTurnCompleteSeen,
            requestKey,
            sessionIdPresent: Boolean(sessionId),
            settledAssistantResponseSeen,
		            sessionTranscriptCanSettleTurn,
		            staleTranscriptCompletionBlocked,
		            terminalFinishSignal,
		            terminalLifecycleCanSettleTurn,
	            terminalSubmitPromptAccepted: terminalSubmitPromptAcceptedForResult,
	            terminalReadinessCanSettleTurn,
		            transcriptCompletionCanSettleTurn,
		            transcriptPromptAccepted,
		            transcriptExplicitCompletionCanSettleTurn,
		            terminalGroundTruthStatus: transcriptCompletionCanSettleTurn ? "idle_or_done" : "processing_or_unknown",
	            threadId,
	            transcriptTargetsLatestTurn,
	            transcriptTargetsLatestRunningTurn,
	            transcriptTargetsRequestedTurn,
	            transcriptRequestCanSettleTurn,
            turnCompleteSeen,
            workspaceId,
          });
          if (expectedUserMessage && !promptAccepted && (agentId === "codex" || promptEventId)) {
            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.prompt_mismatch", {
              agentId,
              diagnostics: getTranscriptPromptMatchDiagnosticsForLog(messages, {
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
          const promptDiscoveryAccepted = discoveredByPrompt && transcriptPromptAccepted;
          if (!providerSessionId && sessionId && promptDiscoveryAccepted) {
            const discoveredWatchKey = workspaceThreadTranscriptWatchKey({
              agentId,
              promptEventId,
              providerSessionId: sessionId,
              threadId,
              workspaceId,
            });
            if (discoveredWatchKey && workspaceThreadTranscriptWatchKeysRef.current.has(discoveredWatchKey)) {
              logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.watch_start_skip", {
                agentId,
                reason: "discovered_watch_already_active",
                requestKey,
                sessionIdPresent: true,
                threadId,
                workspaceId,
              });
            } else {
              if (discoveredWatchKey) {
                workspaceThreadTranscriptWatchKeysRef.current.add(discoveredWatchKey);
              }
              invoke("agent_thread_transcript_watch", {
                request: {
                  agentId,
                  allowTimestampFallback,
                  cwd: discoveryCwd,
                  expectedMessageCreatedAt,
                  expectedUserMessage,
                  instanceId: event.instanceId,
                  maxMessages: 320,
                  paneId: event.paneId || "",
                  pollUntilTurnComplete,
                  promptEventId,
                  promptEventSubmittedAt: event.promptEventSubmittedAt || submittedAt || expectedMessageCreatedAt,
                  providerSessionId: sessionId,
                  source: event.source || event.type || "session-discovery",
                  submittedAt,
                  terminalIndex: Number.isFinite(Number(event.terminalIndex)) ? Number(event.terminalIndex) : null,
                  terminalPromptAccepted: terminalSubmitPromptAcceptedForResult,
                  threadId,
                  workspaceId,
                },
              }).catch((error) => {
                if (discoveredWatchKey) {
                  workspaceThreadTranscriptWatchKeysRef.current.delete(discoveredWatchKey);
                }
                logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.watch_start_error", {
                  agentId,
                  message: error?.message || String(error || ""),
                  requestKey,
                  sessionIdPresent: true,
                  threadId,
                  workspaceId,
                });
              });
            }
          }
          const transcriptResultContinueDelayMs = (transcriptWatchRequested || (sessionId && promptDiscoveryAccepted))
            ? WORKSPACE_THREAD_TRANSCRIPT_WATCH_FALLBACK_INTERVAL_MS
            : transcriptContinueDelayMs;
          const voicePlanPromptEventId = String(promptEventId || "").trim();
          if (!sessionMatchedByProviderId && !promptDiscoveryAccepted) {
            const elapsedMs = Date.now() - pollStartedAt;
            const shouldContinuePolling = pollUntilTurnComplete
              && elapsedMs < transcriptPollTimeoutMs;
            if (discoveredByPrompt && sessionId) {
              setWorkspaceThreads((threads) => {
                  const beforeSnapshot = getWorkspaceThreadDiagnosticSnapshotForLog(
                  threads,
                  workspaceId,
                  threadId,
                  agentId,
                );
                const nextThreads = invalidateWorkspaceThreadProviderSession(threads, {
                  agentId,
                  nativeSessionId: sessionId,
                  providerSessionId: sessionId,
                  sessionId,
                  threadId,
                  workspaceId,
                });
                const stateChanged = nextThreads !== threads;
                if (stateChanged) {
                  logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.rejected_discovery_invalidated", {
                    after: getWorkspaceThreadDiagnosticSnapshotForLog(
                      nextThreads,
                      workspaceId,
                      threadId,
                      agentId,
                    ),
                    agentId,
                    before: beforeSnapshot,
                    matchedBy,
                    reason: "prompt_discovery_without_prompt_evidence",
                    requestKey,
                    threadId,
                    workspaceId,
                  });
                }
                return nextThreads;
              });
            }
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
                });
              }, transcriptResultContinueDelayMs);
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
            && !expectedUserMessageIsControlPrompt
            && activeRunningTurnAtTranscriptResult
            && !terminalReadinessCanSettleTurn
            && !matchedBy.includes("timestamp")
            && !matchedBy.includes("recovery")
          );
          if (
            (staleVoicePlanCompletionWithoutPrompt || requiresExactPromptEvidence)
	            && !promptAccepted
	            && !transcriptPromptAccepted
	            && !trustedVoicePlanTerminalFinish
	          ) {
            const elapsedMs = Date.now() - pollStartedAt;
            const shouldContinuePolling = elapsedMs < transcriptPollTimeoutMs;
            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
              agentId,
              elapsedMs,
              matchedBy,
              messageCount: messages.length,
              expectedUserMessageIsControlPrompt,
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
                  providerSessionId: sessionMatchedByProviderId ? (sessionId || providerSessionId) : providerSessionId,
                });
              }, transcriptResultContinueDelayMs);
            }
            return;
          }
          const expectedPromptAcceptancePending = Boolean(
            pollUntilTurnComplete
              && expectedUserMessage
              && !expectedUserMessageIsControlPrompt
	              && !promptAccepted
	              && !transcriptPromptAccepted
	          );
          if (expectedPromptAcceptancePending) {
            const elapsedMs = Date.now() - pollStartedAt;
            const shouldContinuePolling = elapsedMs < transcriptPollTimeoutMs;
            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
              agentId,
              elapsedMs,
              matchedBy,
              messageCount: messages.length,
              pollUntilTurnComplete,
              promptEventIdPresent: Boolean(promptEventId),
              reason: "prompt_acceptance_pending",
              requestKey,
              sessionIdPresent: Boolean(sessionId),
              shouldContinuePolling,
              threadId,
              workspaceId,
            });
            logTerminalStatus("frontend.terminal_status.transcript_prompt_acceptance_pending", {
              agentId,
              elapsedMs,
              matchedBy,
              messageCount: messages.length,
              promptAccepted,
              promptEventId,
              requestKey,
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
              }, transcriptResultContinueDelayMs);
            }
            return;
          }
          if (promptAccepted && promptEventId && (!terminalSubmitPromptAcceptedForResult || transcriptPromptAccepted)) {
            rememberWorkspaceThreadPromptAcceptance(workspaceThreadAcceptedPromptsRef.current, {
              agentId,
              matchedBy: transcriptPromptAccepted ? matchedBy : "terminal-submit",
              promptEventId,
              promptText: expectedUserMessage,
              sessionId,
              threadId,
              workspaceId,
            });
            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.prompt_accepted", {
              agentId,
              matchedBy,
              promptAcceptedBy,
              promptEventId,
              requestKey,
              sessionIdPresent: Boolean(sessionId),
              terminalSubmitPromptAccepted: terminalSubmitPromptAcceptedForResult,
              threadId,
              transcriptPromptAccepted,
              workspaceId,
            });
            window.dispatchEvent(new CustomEvent(WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT, {
              detail: {
                agentId,
                matchedBy: transcriptPromptAccepted ? matchedBy : "terminal-submit",
                promptEventId,
                promptText: expectedUserMessage,
                sessionId,
                threadId,
                workspaceId,
              },
            }));
          }
          if (!sessionId && messages.length === 0) {
            const elapsedMs = Date.now() - pollStartedAt;
            const shouldContinuePolling = pollUntilTurnComplete
              && elapsedMs < transcriptPollTimeoutMs;
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
              }, transcriptResultContinueDelayMs);
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
	              reason: "stale_completion_not_current_prompt_turn",
	              requestKey,
	              sessionIdPresent: Boolean(sessionId),
	              terminalFinishSignal,
	              terminalReadinessCanSettleTurn,
	              threadId,
	              transcriptTargetsLatestTurn,
	              transcriptTargetsLatestRunningTurn,
	              transcriptTargetsRequestedTurn,
	              workspaceId,
	            });
	            logTerminalStatus("frontend.terminal_status.stale_transcript_completion_ignored", {
	              agentId,
	              latestTurnId: latestTurnAtTranscriptResult?.turnId || latestTurnAtTranscriptResult?.id || "",
	              latestTurnMessageId: latestTurnAtTranscriptResult?.messageId || "",
	              latestTurnState: latestTurnAtTranscriptResult?.state || latestTurnAtTranscriptResult?.status || "",
	              matchedBy,
	              promptEventId,
	              rawTurnCompleteSeen,
	              requestKey,
	              terminalFinishSignal,
	              terminalReadinessCanSettleTurn,
	              threadId,
	              transcriptTargetsLatestTurn,
	              transcriptTargetsLatestRunningTurn,
	              workspaceId,
	            });
	            return;
	          }
	          if (!workspaceThreadTranscriptHydrationIsVisible({ threadId, workspaceId })) {
	            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.skip", {
	              agentId,
	              matchedBy,
	              messageCount: messages.length,
	              reason: "thread_detail_not_visible",
	              requestKey,
	              sessionIdPresent: Boolean(sessionId),
	              threadId,
	              workspaceId,
	            });
	            return;
	          }

	          setWorkspaceThreads((threads) => {
            const beforeSnapshot = getWorkspaceThreadDiagnosticSnapshotForLog(
              threads,
              workspaceId,
              threadId,
              agentId,
            );
            const hydrateEvent = {
              agentId,
              expectedMessageCreatedAt,
              expectedUserMessage,
              latestTimestamp: result?.latestTimestamp || "",
              messages,
              matchedBy: result?.matchedBy || "",
              promptEpoch: getWorkspaceThreadPromptEpoch(event),
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
		              transcriptCompletionCanSettleTurn,
		              transcriptExplicitCompletionCanSettleTurn,
		              threadId,
		              turnCompleteSeen,
              workspaceId,
            };
            const hydrationDiagnostics = getWorkspaceThreadHydrationDiagnosticsForLog(
              threads,
              hydrateEvent,
            );
            const nextThreads = hydrateWorkspaceThreadSessionTranscript(threads, hydrateEvent);
            const afterSnapshot = getWorkspaceThreadDiagnosticSnapshotForLog(
              nextThreads,
              workspaceId,
              threadId,
              agentId,
            );
            const stateChanged = nextThreads !== threads;
            logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.apply", {
              after: afterSnapshot,
              agentId,
              before: beforeSnapshot,
              completionFallbackApplied: false,
              completionFallbackProjectionEvents: 0,
              hydrationDiagnostics,
              messageCount: messages.length,
              requestKey,
              stateChanged,
              threadId,
              workspaceId,
            });
            if (!stateChanged) {
              logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.apply_noop", {
                after: afterSnapshot,
                agentId,
                before: beforeSnapshot,
                completionFallbackApplied: false,
                completionFallbackProjectionEvents: 0,
                hydrationDiagnostics,
                messageCount: messages.length,
                requestKey,
                threadId,
                workspaceId,
              });
	            }
	            return nextThreads;
	          });
          if (pollUntilTurnComplete) {
            const elapsedMs = Date.now() - pollStartedAt;
            const waitingForPromptAcceptance = Boolean(
              expectedUserMessage
                && !expectedUserMessageIsControlPrompt
                && !promptAccepted
            );
            const shouldContinuePolling = (
              waitingForPromptAcceptance
              || (
	                activeRunningTurnAtTranscriptResult
	                && (
	                  !transcriptCompletionCanSettleTurn
	                  || (voicePlanPromptEventId.startsWith("voice-plan-") && !promptAccepted)
	                )
	              )
            )
              && elapsedMs < transcriptPollTimeoutMs;
            logWorkspaceThreadDiagnosticEvent("frontend.thread_projection.poll", {
              activeRunningTurnAtTranscriptResult,
              agentId,
              elapsedMs,
              expectedUserMessagePresent: Boolean(expectedUserMessage),
              promptAccepted,
              promptAcceptedBy,
              requestKey,
	              shouldContinuePolling,
	              timeoutMs: transcriptPollTimeoutMs,
	              threadId,
	              transcriptCompletionCanSettleTurn,
	              turnCompleteSeen,
	              waitingForPromptAcceptance,
              workspaceId,
            });
            logTerminalStatus("frontend.terminal_status.transcript_poll_decision", {
              activeRunningTurnAtTranscriptResult,
              agentId,
              elapsedMs,
              promptAccepted,
              promptAcceptedBy,
              promptEventId,
              requestKey,
              shouldContinuePolling,
	              settledAssistantResponseSeen,
	              timeoutMs: transcriptPollTimeoutMs,
	              terminalGroundTruthStatus: transcriptCompletionCanSettleTurn && (
	                !voicePlanPromptEventId.startsWith("voice-plan-") || promptAccepted
	              ) ? "idle_or_done" : "processing_or_unknown",
	              threadId,
	              transcriptCompletionCanSettleTurn,
	              turnCompleteSeen,
              waitingForPromptAcceptance,
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
              }, transcriptResultContinueDelayMs);
            }
          }
        })
        .catch((error) => {
          if (providerTranscriptWatchKeyRegisteredByRequest) {
            workspaceThreadTranscriptWatchKeysRef.current.delete(providerTranscriptWatchKey);
          }
          const elapsedMs = Date.now() - pollStartedAt;
          const shouldContinuePolling = !providerSessionId
            && pollUntilTurnComplete
            && elapsedMs < transcriptPollTimeoutMs;
          logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.error", {
            agentId,
            command: transcriptCommand,
            elapsedMs,
            expectedPrompt: getBigViewTextDiagnosticFields(expectedUserMessage),
            message: error?.message || String(error || ""),
            providerSessionPresent: Boolean(providerSessionId),
            promptEventIdPresent: Boolean(promptEventId),
            requestKey,
            requestedCwdPresent: Boolean(requestedCwd),
            requestedProviderSessionPresent: Boolean(requestedProviderSessionId),
            snapshot: getWorkspaceThreadDiagnosticSnapshotForLog(
              workspaceThreadsRef.current,
              workspaceId,
              threadId,
              agentId,
            ),
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
            }, transcriptResultContinueDelayMs);
          }
        })
        .finally(() => {
          const current = workspaceThreadTranscriptRequestsRef.current.get(requestKey);
          if (current?.inFlight) {
            workspaceThreadTranscriptRequestsRef.current.delete(requestKey);
          }
        });
    };

    const inputReadyTranscriptEvent = event.inputReady === true;
    const requestedDelayMs = Math.max(0, Number.parseInt(event.delayMs, 10) || 0);
    const minimumDelayMs = pollUntilTurnComplete && !inputReadyTranscriptEvent
      ? (terminalSubmitPromptAccepted ? 1100 : 1500)
      : 250;
    const hotDelayMs = inputReadyTranscriptEvent ? 0 : getTerminalInputHotDelayMs(900);
    const delayMs = Math.max(requestedDelayMs, minimumDelayMs, hotDelayMs);
    const timer = window.setTimeout(runRequest, delayMs);
    workspaceThreadTranscriptRequestsRef.current.set(requestKey, {
      acceptanceKeys: requestAcceptanceKeys,
      agentId,
      expectedUserMessage,
      inFlight: false,
      promptEventId,
      terminalPromptAccepted: terminalSubmitPromptAccepted,
      threadId,
      timer,
      workspaceId,
    });
    logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.schedule", {
      agentId,
      delayMs,
      requestKey,
      requestedCwdPresent: Boolean(requestedCwd),
      requestedProviderSessionPresent: Boolean(requestedProviderSessionId),
      requestedRepoPathPresent: Boolean(requestedRepoPath),
      snapshot: getWorkspaceThreadDiagnosticSnapshotForLog(
        workspaceThreadsRef.current,
        workspaceId,
        threadId,
        agentId,
      ),
      threadId,
      workspaceId,
    });
  }, []);

  useEffect(() => {
    const handleWorkspaceThreadDetailVisibility = (visibilityEvent) => {
      const detail = visibilityEvent?.detail || {};
      if (detail.visible !== true) {
        return;
      }

      const workspaceId = String(detail.workspaceId || detail.workspace_id || "").trim();
      const threadId = String(detail.threadId || detail.thread_id || "").trim();
      if (!workspaceId || !threadId) {
        return;
      }

      const thread = workspaceThreadsRef.current?.[workspaceId]?.threads?.[threadId] || null;
      if (!thread || thread.archivedAt) {
        return;
      }

      const agentId = String(
        detail.agentId
          || detail.agent_id
          || thread.currentAgent
          || "codex",
      ).trim().toLowerCase();
      if (!["claude", "codex", "opencode"].includes(agentId)) {
        return;
      }

      const providerBinding = getWorkspaceThreadProviderBinding(thread, agentId);
      const terminalBinding = providerBinding?.terminalBinding || thread.terminalBinding || {};
      const sessionId = String(
        detail.providerSessionId
          || detail.provider_session_id
          || detail.nativeSessionId
          || detail.native_session_id
          || thread.transcriptSessionId
          || providerBinding?.nativeSessionId
          || "",
      ).trim();
      const visibilityKey = getWorkspaceThreadDetailVisibilityKey({ threadId, workspaceId });
      const requestKey = [
        visibilityKey,
        agentId,
        sessionId,
        detail.paneId || terminalBinding?.paneId || "",
        detail.instanceId || terminalBinding?.instanceId || "",
      ].join("::");
      const now = Date.now();
      const previousRequestAt = Number(
        workspaceThreadDetailVisibilityRequestKeysRef.current.get(requestKey) || 0,
      );
      if (previousRequestAt && now - previousRequestAt < WORKSPACE_THREAD_DETAIL_VISIBILITY_TRANSCRIPT_REQUEST_DEDUP_MS) {
        return;
      }
      workspaceThreadDetailVisibilityRequestKeysRef.current.set(requestKey, now);

      requestWorkspaceThreadTranscript({
        agentId,
        delayMs: 0,
        instanceId: detail.instanceId || terminalBinding?.instanceId || "",
        nativeSessionId: sessionId,
        paneId: detail.paneId || terminalBinding?.paneId || "",
        providerSessionId: sessionId,
        source: "thread-detail-visible",
        terminalIndex: detail.terminalIndex ?? terminalBinding?.terminalIndex ?? thread.terminalIndex,
        threadId,
        workspaceId,
      });
    };

    window.addEventListener(WORKSPACE_THREAD_DETAIL_VISIBILITY_EVENT, handleWorkspaceThreadDetailVisibility);
    return () => {
      window.removeEventListener(WORKSPACE_THREAD_DETAIL_VISIBILITY_EVENT, handleWorkspaceThreadDetailVisibility);
    };
  }, [requestWorkspaceThreadTranscript]);

  useEffect(() => {
    workspaceThreadTranscriptEventHandlerRef.current = (transcriptEvent) => {
      const payload = transcriptEvent?.payload || {};
      applyWorkspaceThreadTranscriptEvent(payload);
    };
  }, [applyWorkspaceThreadTranscriptEvent]);

  useEffect(() => {
    let cancelled = false;
    let unlistenTranscriptUpdated = null;

    listen(AGENT_THREAD_TRANSCRIPT_UPDATED_EVENT, (transcriptEvent) => {
      if (cancelled) {
        return;
      }
      workspaceThreadTranscriptEventHandlerRef.current?.(transcriptEvent);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenTranscriptUpdated = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenTranscriptUpdated) {
        unlistenTranscriptUpdated();
      }
    };
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
    const lifecycleUsesActivityHooks = terminalAgentUsesActivityHooks(lifecycleAgentId);
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
        || lifecycleLiveTerminalForGroundTruth?.inputReadyAt
        || "",
      inputReadyConfidence: lifecycleEvent.inputReadyConfidence
        || lifecycleLiveTerminalForGroundTruth?.inputReadyConfidence
        || "",
      instanceId: lifecycleEvent.instanceId || lifecycleLiveTerminalForGroundTruth?.instanceId || "",
      paneId: lifecycleEvent.paneId || lifecycleLiveTerminalForGroundTruth?.paneId || "",
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
      || lifecycleEvent.type === "provider-tool-started"
      || lifecycleEvent.type === "provider-subagent-started"
      || lifecycleEvent.type === "thread-starting"
      || (
        lifecycleEvent.type === "agent-output"
        && ["delegating", "subagent", "subagent_running", "thinking", "tool", "tool_running", "running"].includes(String(
          lifecycleEvent.activityStatus || lifecycleEvent.status || "",
        ).trim().toLowerCase())
      )
    );
    const lifecycleHasHookManualPrompt = terminalStatusEventHasExplicitPermissionPrompt(lifecycleEvent);
    const lifecycleGroundTruthWorkState = String(
      lifecycleGroundTruth.terminalWorkState || "",
    ).trim().toLowerCase();
    const lifecycleWorkState = lifecycleHasHookManualPrompt
      ? "prompting_user"
      : lifecycleStartsWork
        ? "running"
        : lifecycleGroundTruthWorkState === "prompting_user" || lifecycleGroundTruthWorkState === "prompting-user"
          ? ""
          : lifecycleGroundTruth.terminalWorkState || "";
    lifecycleEvent = {
      ...lifecycleEvent,
      promptingUserConfidence: lifecycleHasHookManualPrompt
        ? lifecycleEvent.promptingUserConfidence
          || lifecycleEvent.prompting_user_confidence
          || lifecycleEvent.completionEvidence
          || "cli_hook_manual_prompt"
        : "",
      promptingUserKind: lifecycleHasHookManualPrompt
        ? lifecycleEvent.promptingUserKind
          || lifecycleEvent.prompting_user_kind
          || "approval"
        : "",
      promptingUserSource: lifecycleHasHookManualPrompt
        ? lifecycleEvent.promptingUserSource
          || lifecycleEvent.prompting_user_source
          || lifecycleEvent.source
          || "cli-hook:manual-prompt"
        : "",
      promptingUserText: lifecycleHasHookManualPrompt
        ? lifecycleEvent.promptingUserText
          || lifecycleEvent.prompting_user_text
          || lifecycleEvent.message
          || lifecycleEvent.description
          || ""
        : "",
      terminalIsComplete: lifecycleStartsWork ? false : lifecycleGroundTruth.terminalIsComplete === true,
      terminalIsPromptingUser: lifecycleHasHookManualPrompt,
      terminalWorkState: lifecycleWorkState,
    };
    let lifecyclePromptEventId = String(
      lifecycleEvent.promptEventId
        || lifecycleEvent.pendingPromptId
        || lifecycleEvent.promptId
        || "",
    ).trim();
    const lifecyclePromptEpoch = getWorkspaceThreadPromptEpoch(lifecycleEvent);
    const lifecycleVoicePlanCompletionEvent = Boolean(
      lifecycleEvent.type === "provider-turn-completed"
        || lifecycleEvent.type === "provider-turn-error"
        || lifecycleEvent.type === "provider-turn-interrupted"
    );
    if (
      lifecycleVoicePlanCompletionEvent
      && !getVoicePlanPromptEventIdCandidate(lifecyclePromptEventId)
      && lifecycleWorkspaceId
      && lifecycleThreadId
    ) {
      const lifecycleThreadForVoicePlan =
        workspaceThreadsRef.current?.[lifecycleWorkspaceId]?.threads?.[lifecycleThreadId] || null;
      const resolvedVoicePlanPromptEventId = resolveVoicePlanPromptEventIdFromThreadLifecycle(
        lifecycleEvent,
        lifecycleThreadForVoicePlan,
      );
      if (resolvedVoicePlanPromptEventId) {
        lifecyclePromptEventId = resolvedVoicePlanPromptEventId;
        lifecycleEvent = {
          ...lifecycleEvent,
          pendingPromptId: lifecycleEvent.pendingPromptId || resolvedVoicePlanPromptEventId,
          promptEventId: resolvedVoicePlanPromptEventId,
        };
        logTerminalStatus("frontend.voice_plan.lifecycle_prompt_resolved", {
          lifecycleType: lifecycleEvent.type || "",
          promptEventId: lifecyclePromptEventId,
          reason: "provider_hook_completion_thread_latest_turn",
          source: lifecycleEvent.source || "",
          terminalIndex: lifecycleEvent.terminalIndex ?? "",
          threadId: lifecycleThreadId,
          workspaceId: lifecycleWorkspaceId,
        });
      }
    }
    const lifecycleReadinessEvent = Boolean(
      lifecycleEvent.type === "terminal-prompt-ready"
        || lifecycleEvent.type === "terminal-input-ready"
    );
    if (lifecycleReadinessEvent) {
      logTerminalStatus("frontend.terminal_cli.readiness_lifecycle_disabled", {
        agentId: lifecycleAgentId,
        inputReadyAt: lifecycleEvent.inputReadyAt || "",
        paneId: lifecycleEvent.paneId || "",
        reason: "provider_hooks_own_readiness",
        source: lifecycleEvent.source || "",
        terminalIndex: lifecycleEvent.terminalIndex ?? "",
        threadId: lifecycleThreadId,
        type: lifecycleEvent.type || "",
        workspaceId: lifecycleWorkspaceId,
      });
      return;
    }
    logTerminalStatus("frontend.terminal_status.lifecycle_received", {
      activityStatus: lifecycleEvent.activityStatus || "",
      agentId: lifecycleAgentId,
      hasNativeSessionId: Boolean(lifecycleNativeSessionId),
      hasOutputText: Boolean(lifecycleEvent.outputText || lifecycleEvent.text),
      instanceId: lifecycleEvent.instanceId || "",
      pendingPromptId: lifecycleEvent.pendingPromptId || lifecycleEvent.promptId || "",
      promptEpoch: lifecyclePromptEpoch,
      promptEventId: lifecycleEvent.promptEventId || "",
      promptingUserKind: lifecycleEvent.promptingUserKind || "",
      promptingUserSource: lifecycleEvent.promptingUserSource || "",
      restoredPromptReady: lifecycleEvent.restoredPromptReady === true,
      source: lifecycleEvent.source || "",
      status: lifecycleEvent.status || "",
      terminalGroundTruthStatus: lifecycleEvent.terminalWorkState
        || lifecycleEvent.activityStatus
        || (lifecycleEvent.type === "provider-turn-started" || lifecycleEvent.type === "message-submitted"
          ? "processing"
          : lifecycleEvent.type === "provider-turn-completed"
            ? "idle_or_done"
            : ""),
      terminalIsComplete: lifecycleEvent.terminalIsComplete === true,
      terminalIsPromptingUser: lifecycleEvent.terminalIsPromptingUser === true,
      terminalIndex: lifecycleEvent.terminalIndex ?? "",
      threadId: lifecycleThreadId,
      type: lifecycleEvent.type || "",
      unidentifiedPromptReady: lifecycleEvent.unidentifiedPromptReady === true,
      workspaceId: lifecycleWorkspaceId,
    });
    terminalStatusEventEmitterRef.current?.(lifecycleEvent, {
      reason: lifecycleEvent.source || `lifecycle:${lifecycleEvent.type || "terminal-status"}`,
    });
    setWorkspaceNotifications((current) => reduceThreadLifecycleNotificationEvent(
      current,
      lifecycleEvent,
      workspaceNotificationReducerOptions(lifecycleWorkspaceId),
    ));
    if (lifecycleEvent.type === "provider-turn-completed" && lifecycleEvent.paneId) {
      const shouldReconcileCoordination = shouldReconcileProviderTurnCompletion(lifecycleEvent);
      if (!shouldReconcileCoordination) {
        logTerminalStatus("frontend.provider_turn_completed.reconcile_skip", {
          paneId: lifecycleEvent.paneId || "",
          promptEventId: lifecyclePromptEventId,
          providerTurnIntent: getProviderTurnCompletionIntent(lifecycleEvent),
          reason: "provider_turn_not_coordination_scoped",
          threadId: lifecycleThreadId,
          workspaceId: lifecycleWorkspaceId,
        });
      } else {
        invoke("terminal_provider_turn_completed", {
          paneId: lifecycleEvent.paneId,
          instanceId: Number.isFinite(Number(lifecycleEvent.instanceId))
            ? Number(lifecycleEvent.instanceId)
            : null,
          reason: lifecycleEvent.source || lifecycleEvent.completionSource || "provider-turn-completed",
          reconcileCoordination: true,
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
    }
    if (
      getVoicePlanPromptEventIdCandidate(lifecyclePromptEventId)
      && (
        lifecycleEvent.type === "provider-turn-completed"
        || lifecycleEvent.type === "provider-turn-error"
        || lifecycleEvent.type === "provider-turn-interrupted"
      )
    ) {
      const voicePlanPromptEventId = getVoicePlanPromptEventIdCandidate(lifecyclePromptEventId);
      logTerminalStatus("frontend.voice_plan.lifecycle_dispatch", {
        completionInferred: lifecycleEvent.completionInferred === true,
        lifecycleType: lifecycleEvent.type,
        promptEventId: voicePlanPromptEventId,
        reason: "thread_terminal_lifecycle",
        terminalGroundTruthStatus: lifecycleEvent.type === "provider-turn-error"
          ? "error"
          : lifecycleEvent.type === "provider-turn-interrupted"
            ? "interrupted"
            : "idle_or_done",
        threadId: lifecycleThreadId,
        workspaceId: lifecycleWorkspaceId,
      });
      window.dispatchEvent(new CustomEvent(VOICE_PLAN_TASK_LIFECYCLE_EVENT, {
        detail: {
          ...lifecycleEvent,
          completionInferred: lifecycleEvent.completionInferred === true,
          promptEventId: voicePlanPromptEventId,
          type: lifecycleEvent.type,
        },
      }));
    }
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
      promptEpoch: lifecyclePromptEpoch,
      promptEventId: lifecyclePromptEventId,
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
      snapshot: getWorkspaceThreadDiagnosticSnapshotForLog(
        workspaceThreadsRef.current,
        lifecycleWorkspaceId,
        lifecycleThreadId,
        lifecycleAgentId,
      ),
    });

    if (
      lifecycleEvent.type === "provider-session"
      || lifecycleEvent.type === "provider-session-invalid"
      || lifecycleEvent.type === "opened"
    ) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_session.input", {
        agentId: lifecycleAgentId,
        hasNativeSessionId: Boolean(lifecycleNativeSessionId),
        instanceId: lifecycleEvent.instanceId || "",
        nativeSessionKind: lifecycleEvent.nativeSessionKind || "",
        nativeSessionSource: lifecycleEvent.nativeSessionSource || lifecycleEvent.source || "",
        paneId: lifecycleEvent.paneId || "",
        providerSessionIdPresent: Boolean(lifecycleEvent.providerSessionId),
        snapshot: getWorkspaceThreadDiagnosticSnapshotForLog(
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
      || lifecycleEvent.type === "provider-turn-error"
      || lifecycleEvent.type === "provider-turn-interrupted"
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
        existingSnapshot: getWorkspaceThreadDiagnosticSnapshotForLog(
          workspaceThreadsRef.current,
          lifecycleWorkspaceId,
          lifecycleThreadId,
          lifecycleAgentId,
        ),
        messageId: lifecycleEvent.messageId || "",
        pendingPromptId: lifecycleEvent.pendingPromptId || lifecycleEvent.promptId || "",
        promptEpoch: lifecyclePromptEpoch,
        promptEventId: lifecyclePromptEventId,
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
      || lifecycleEvent.type === "provider-turn-interrupted"
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
      if (lifecycleEvent.type === "provider-session-invalid") {
        operation = "provider_session_invalid";
        nextThreads = invalidateWorkspaceThreadProviderSession(threads, lifecycleEvent);
      } else if (lifecycleEvent.type === "provider-session") {
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
      } else if (lifecycleEvent.type === "provider-turn-interrupted") {
        operation = "provider_turn_interrupted";
        const existingThread = threads?.[lifecycleWorkspaceId]?.threads?.[lifecycleThreadId];
        const projectionEvents = buildTerminalInterruptedProjectionEvents(existingThread, lifecycleEvent);
        nextThreads = projectionEvents.length
          ? appendWorkspaceThreadProjectionEvents(threads, {
            ...lifecycleEvent,
            activityStatus: "idle",
            clearPendingPrompt: true,
            inputReady: true,
            projectionEvents,
          })
          : markWorkspaceThreadAgentActivity(threads, {
            ...lifecycleEvent,
            activityStatus: "idle",
            inputReady: true,
            status: lifecycleEvent.status || "active",
          });
      } else if (lifecycleEvent.type === "provider-turn-completed" || lifecycleEvent.type === "provider-turn-error") {
        operation = lifecycleEvent.type === "provider-turn-error"
          ? "provider_turn_error"
          : "provider_turn_completed";
        if (lifecycleEvent.type === "provider-turn-completed") {
          const existingThread = threads?.[lifecycleWorkspaceId]?.threads?.[lifecycleThreadId];
          const existingProjectionEvents = Array.isArray(lifecycleEvent.projectionEvents)
            ? lifecycleEvent.projectionEvents
            : Array.isArray(lifecycleEvent.events)
              ? lifecycleEvent.events
              : [];
          const projectionEvents = existingProjectionEvents.length
            ? existingProjectionEvents
            : buildTerminalCompletedProjectionEvents(existingThread, lifecycleEvent);
          logWorkspaceThreadDiagnosticEvent("frontend.thread_lifecycle.provider_turn_completed_decision", {
            agentId: lifecycleAgentId,
            existingLatestTurnId: existingThread?.latestTurn?.turnId || existingThread?.latestTurn?.id || "",
            existingLatestTurnMessageId: existingThread?.latestTurn?.messageId || "",
            existingLatestTurnState: existingThread?.latestTurn?.state || existingThread?.latestTurn?.status || "",
            existingProjectionEventCount: existingProjectionEvents.length,
            hasExistingThread: Boolean(existingThread),
            inputProjectionEventCount: existingProjectionEvents.length,
            pendingPromptId: lifecycleEvent.pendingPromptId || lifecycleEvent.promptId || "",
            promptEpoch: lifecyclePromptEpoch,
            promptEventId: lifecyclePromptEventId,
            projectionEventCount: projectionEvents.length,
            projectionEventTypes: projectionEvents
              .map((projectionEvent) => projectionEvent?.type || "")
              .filter(Boolean)
              .slice(0, 8),
            source: lifecycleEvent.source || "",
            terminalIndex: lifecycleEvent.terminalIndex ?? "",
            threadId: lifecycleThreadId,
            workspaceId: lifecycleWorkspaceId,
          });
          nextThreads = appendWorkspaceThreadProjectionEvents(threads, {
            ...lifecycleEvent,
            activityStatus: "idle",
            clearPendingPrompt: true,
            inputReady: true,
            projectionEvents,
            status: lifecycleEvent.status || "active",
          });
        } else {
          const existingThread = threads?.[lifecycleWorkspaceId]?.threads?.[lifecycleThreadId];
          const existingProjectionEvents = Array.isArray(lifecycleEvent.projectionEvents)
            ? lifecycleEvent.projectionEvents
            : Array.isArray(lifecycleEvent.events)
              ? lifecycleEvent.events
              : [];
          const projectionEvents = existingProjectionEvents.length
            ? existingProjectionEvents
            : buildTerminalErroredProjectionEvents(existingThread, lifecycleEvent);
          nextThreads = appendWorkspaceThreadProjectionEvents(threads, {
            ...lifecycleEvent,
            activityStatus: "error",
            clearPendingPrompt: true,
            inputReady: true,
            projectionEvents,
            status: lifecycleEvent.status || "error",
          });
        }
      } else if (
        lifecycleEvent.type === "agent-output"
        || lifecycleEvent.type === "provider-user-prompt-started"
        || lifecycleEvent.type === "provider-tool-started"
        || lifecycleEvent.type === "provider-tool-completed"
        || lifecycleEvent.type === "provider-subagent-started"
        || lifecycleEvent.type === "provider-subagent-completed"
      ) {
        operation = "mark_agent_activity";
        nextThreads = markWorkspaceThreadAgentActivity(threads, lifecycleEvent);
      } else if (lifecycleEvent.type === "message-submitted" || lifecycleEvent.type === "thread-starting") {
        operation = lifecycleEvent.type === "message-submitted"
          ? "materialize_message_submitted"
          : "materialize_thread_starting";
        nextThreads = materializeWorkspaceThreadForTerminal(threads, lifecycleEvent);
      } else if (lifecycleEvent.type === "closed" || lifecycleEvent.type === "exited" || lifecycleEvent.type === "error") {
        operation = "terminal_detached";
        const existingThread = threads?.[lifecycleWorkspaceId]?.threads?.[lifecycleThreadId];
        const existingProviderBinding = getWorkspaceThreadProviderBinding(existingThread, lifecycleAgentId);
        const shouldDeferSessionBackedRunningTurnInterruption = Boolean(
          lifecycleEvent.type !== "error"
            && String(existingThread?.latestTurn?.state || "").trim().toLowerCase() === "running"
            && (existingThread?.transcriptSessionId || existingProviderBinding?.nativeSessionId),
        );
        nextThreads = markWorkspaceThreadTerminalDetached(threads, {
          agentId: lifecycleEvent.agentId || lifecycleEvent.currentAgent,
          deferSessionBackedRunningTurnInterruption: shouldDeferSessionBackedRunningTurnInterruption,
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
          || (lifecycleEvent.type === "provider-turn-started" || lifecycleEvent.type === "message-submitted"
            ? "processing"
            : ""),
        terminalIndex: lifecycleEvent.terminalIndex ?? "",
        threadId: lifecycleThreadId,
        type: lifecycleEvent.type || "",
        workspaceId: lifecycleWorkspaceId,
      });
      if (lifecycleEvent.type === "provider-turn-completed") {
        logTerminalStatus("frontend.terminal_status.provider_turn_completed_apply", {
          afterActivityStatus: afterSnapshot.activityStatus || "",
          afterLatestTurnIdPresent: Boolean(afterSnapshot.latestTurnIdPresent),
          afterLatestTurnState: afterSnapshot.latestTurnState || "",
          afterMessageCount: afterSnapshot.messageCount || 0,
          afterProjectionEventCount: afterSnapshot.projectionEventCount || 0,
          agentId: lifecycleAgentId,
          beforeActivityStatus: beforeSnapshot.activityStatus || "",
          beforeLatestTurnIdPresent: Boolean(beforeSnapshot.latestTurnIdPresent),
          beforeLatestTurnState: beforeSnapshot.latestTurnState || "",
          beforeMessageCount: beforeSnapshot.messageCount || 0,
          beforeProjectionEventCount: beforeSnapshot.projectionEventCount || 0,
          operation,
          pendingPromptId: lifecycleEvent.pendingPromptId || lifecycleEvent.promptId || "",
          source: lifecycleEvent.source || "",
          stateChanged: nextThreads !== threads,
          terminalIndex: lifecycleEvent.terminalIndex ?? "",
          threadId: lifecycleThreadId,
          workspaceId: lifecycleWorkspaceId,
        });
      }
      if (
        lifecycleEvent.type === "model-selected"
        || lifecycleEvent.type === "opened"
        || lifecycleEvent.type === "provider-turn-started"
        || lifecycleEvent.type === "provider-session"
        || lifecycleEvent.type === "provider-session-invalid"
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
      if (
        lifecycleEvent.type === "provider-session"
        || lifecycleEvent.type === "provider-session-invalid"
        || lifecycleEvent.type === "opened"
      ) {
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
    const lifecycleLatestUserMessage = (
      lifecycleEvent.type === "closed"
      || lifecycleEvent.type === "exited"
    )
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
    const lifecycleProviderBindingForTranscript = getWorkspaceThreadProviderBinding(
      lifecycleThreadForTranscript,
      lifecycleAgentId,
    );
    const lifecycleTranscriptProviderSessionId = String(
      lifecycleThreadForTranscript?.transcriptSessionId
        || lifecycleProviderBindingForTranscript?.nativeSessionId
        || lifecycleNativeSessionId
        || "",
    ).trim();
    const lifecycleDetachedNeedsTranscriptReconcile = Boolean(
      ["closed", "exited"].includes(lifecycleEvent.type)
        && lifecycleTranscriptProviderSessionId
        && String(lifecycleThreadForTranscript?.latestTurn?.state || "").trim().toLowerCase() === "running",
    );
    const shouldRequestTranscript = (
      ["claude", "codex", "opencode"].includes(
        lifecycleAgentId,
      )
      && (
        (!lifecycleUsesActivityHooks && lifecycleEvent.type === "message-submitted")
        || lifecycleEvent.type === "provider-turn-completed"
        || lifecycleEvent.type === "provider-session"
        || (lifecycleEvent.type === "opened" && Boolean(lifecycleNativeSessionId))
		        || (!lifecycleUsesActivityHooks && lifecycleDetachedNeedsTranscriptReconcile)
	      )
	    );
    logWorkspaceThreadDiagnosticEvent("frontend.thread_lifecycle.transcript_decision", {
      agentId: lifecycleAgentId,
      hasOutputText: lifecycleHasOutputText,
      lifecycleUsesActivityHooks,
      shouldRequestTranscript,
      threadId: lifecycleThreadId,
      type: lifecycleEvent.type || "",
      workspaceId: lifecycleWorkspaceId,
    });
    if (shouldRequestTranscript) {
      requestWorkspaceThreadTranscript({
        ...lifecycleEvent,
        allowRecovery: false,
        allowTimestampFallback: lifecycleDetachedNeedsTranscriptReconcile
          || lifecycleEvent.allowTimestampFallback === true,
        delayMs: lifecycleEvent.type === "message-submitted"
          ? 240
          : lifecycleEvent.type === "provider-turn-completed"
            ? 80
            : lifecycleDetachedNeedsTranscriptReconcile
              ? 0
              : 120,
        expectedMessageCreatedAt: lifecycleTranscriptSubmittedAt,
        expectedUserMessage: lifecycleTranscriptExpectedUserMessage,
        pollStartedAt: Date.now(),
        pollUntilTurnComplete: lifecycleEvent.type === "message-submitted"
          || lifecycleDetachedNeedsTranscriptReconcile,
        providerSessionId: lifecycleTranscriptProviderSessionId,
        submittedAt: lifecycleTranscriptSubmittedAt,
      });
    }
  }, [
    rejectWorkspacePromptDeliveriesForThread,
    requestWorkspaceThreadTranscript,
    settleWorkspacePromptDelivery,
    workspaceNotificationReducerOptions,
  ]);

  const acceptWorkspaceThreadPromptFromActivityHook = useCallback((event = {}) => {
    const type = String(event.type || event.eventType || "").trim();
    const hookEventName = String(event.hookEventName || event.hook_event_name || "").trim();
    const source = String(event.source || "").trim();
    const agentId = String(event.agentId || event.agentKind || "").trim().toLowerCase();
    if (
      type !== "provider-turn-started"
      || !terminalAgentUsesActivityHooks(agentId)
      || !(source.startsWith("cli-hook:") || hookEventName === "UserPromptSubmit")
    ) {
      return null;
    }

    const workspaceId = String(event.workspaceId || "").trim();
    if (!workspaceId) {
      return null;
    }
    let threadId = String(event.threadId || "").trim();
    let thread = threadId
      ? workspaceThreadsRef.current?.[workspaceId]?.threads?.[threadId] || null
      : null;
    if (!thread && event.terminalIndex != null) {
      thread = getWorkspaceThreadForTerminalIndex(
        workspaceThreadsRef.current,
        workspaceId,
        event.terminalIndex,
      );
      threadId = String(thread?.id || "").trim();
    }
    if (!thread || !threadId) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_prompt_activity_hook.skip", {
        agentId,
        hookEventName,
        reason: "thread_missing",
        source,
        terminalIndex: event.terminalIndex ?? "",
        workspaceId,
      });
      return null;
    }

    const hookPromptText = String(
      event.userMessage
        || event.message
        || event.prompt
        || event.description
        || "",
    ).trim();
    if (!hookPromptText || isTerminalControlHistoryPrompt(hookPromptText)) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_prompt_activity_hook.skip", {
        agentId,
        hookEventName,
        hasPrompt: Boolean(hookPromptText),
        reason: hookPromptText ? "terminal_control_prompt" : "missing_prompt",
        source,
        threadId,
        workspaceId,
      });
      return null;
    }

    const normalizedHookPrompt = normalizeWorkspaceThreadPromptAcceptanceText(hookPromptText);
    const pendingPrompt = thread.pendingPrompt || null;
    const pendingPromptId = String(
      pendingPrompt?.id || pendingPrompt?.promptEventId || "",
    ).trim();
    const pendingPromptText = String(
      pendingPrompt?.text || pendingPrompt?.message || pendingPrompt?.promptText || "",
    ).trim();
    const pendingPromptMatches = Boolean(
      pendingPrompt
        && pendingPromptText
        && normalizeWorkspaceThreadPromptAcceptanceText(pendingPromptText) === normalizedHookPrompt
    );
    const runningPromptId = getPromptEventIdFromRunningThread(thread);
    const runningPromptInfo = getWorkspaceThreadRunningPromptInfo(thread, runningPromptId);
    const runningPromptMatches = Boolean(
      runningPromptInfo.text
        && normalizeWorkspaceThreadPromptAcceptanceText(runningPromptInfo.text) === normalizedHookPrompt
    );
    const promptEventId = String(
      event.promptEventId
        || event.pendingPromptId
        || event.promptId
        || (pendingPromptMatches ? pendingPromptId : "")
        || (runningPromptMatches ? runningPromptId : "")
        || "",
    ).trim();
    if (!promptEventId) {
      logWorkspaceThreadDiagnosticEvent("frontend.thread_prompt_activity_hook.skip", {
        agentId,
        hookEventName,
        pendingPromptPresent: Boolean(pendingPrompt),
        reason: "prompt_event_id_unmatched",
        source,
        threadId,
        workspaceId,
      });
      return null;
    }

    const providerSessionId = String(event.nativeSessionId || event.providerSessionId || "").trim();
    const acceptedPromptDetail = {
      agentId,
      matchedBy: "activity-hook-user-prompt-submit",
      promptEventId,
      promptText: hookPromptText,
      sessionId: providerSessionId,
      threadId,
      workspaceId,
    };
    rememberWorkspaceThreadPromptAcceptance(
      workspaceThreadAcceptedPromptsRef.current,
      acceptedPromptDetail,
    );
    setWorkspaceThreads((threads) => clearWorkspaceThreadPendingPrompt(threads, {
      promptEventId,
      threadId,
      workspaceId,
    }));
    window.dispatchEvent(new CustomEvent(WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT, {
      detail: acceptedPromptDetail,
    }));
    logWorkspaceThreadDiagnosticEvent("frontend.thread_prompt_activity_hook.accepted", {
      agentId,
      hookEventName,
      matchedBy: acceptedPromptDetail.matchedBy,
      pendingPromptMatched: pendingPromptMatches,
      promptEventId,
      providerSessionPresent: Boolean(providerSessionId),
      runningPromptMatched: runningPromptMatches,
      source,
      threadId,
      workspaceId,
    });
    return acceptedPromptDetail;
  }, []);

  useEffect(() => {
    terminalActivityHookHandlerRef.current = (hookEvent) => {
      const payload = hookEvent?.payload || {};
      const type = String(payload.eventType || payload.type || "").trim();
      const workspaceId = String(payload.workspaceId || "").trim();
      if (!type || !workspaceId) {
        logTerminalStatus("frontend.terminal_activity_hook.skip", {
          hasType: Boolean(type),
          hasWorkspaceId: Boolean(workspaceId),
          hookEventName: payload.hookEventName || "",
          paneId: payload.paneId || "",
          threadId: payload.threadId || "",
        });
        return;
      }
      const inputReady = payload.inputReady === true
        || type === "provider-turn-completed"
        || type === "provider-turn-error"
        || type === "provider-turn-interrupted";
      const activityStatus = payload.activityStatus
        || (inputReady ? "idle" : "thinking");
      const hookAgentId = payload.agentId || payload.agentKind || "";
      const hookAgentType = payload.agentType || payload.agent_type || "";
      const hookAgentDisplayName = payload.agentDisplayName
        || payload.agent_display_name
        || hookAgentType
        || payload.provider
        || payload.agentKind
        || "";
      let lifecycleEvent = {
        ...payload,
        activityStatus,
        agentId: hookAgentId,
        agentDisplayName: hookAgentDisplayName,
        agentType: hookAgentType,
        commandPhase: payload.commandPhase || (inputReady ? "completed" : "running"),
        completionEvidence: payload.completionEvidence || "cli-hook",
        completedAt: payload.completedAt || (inputReady ? new Date().toISOString() : ""),
        inputReady,
        inputReadyAt: payload.inputReadyAt || (inputReady ? new Date().toISOString() : ""),
        inputReadyConfidence: payload.inputReadyConfidence || payload.completionEvidence || "cli-hook",
        nativeSessionId: payload.nativeSessionId || payload.providerSessionId || "",
        nativeSessionKind: payload.nativeSessionId || payload.providerSessionId ? "session" : "",
        nativeSessionSource: payload.nativeSessionId || payload.providerSessionId ? "cli-hook" : "",
        providerSessionId: payload.providerSessionId || payload.nativeSessionId || "",
        source: payload.source || `cli-hook:${type}`,
        status: payload.status || "active",
        terminalIndex: payload.terminalIndex,
        threadId: payload.threadId || "",
        type,
        userMessage: payload.userMessage || payload.message || "",
        workspaceId,
      };
      const acceptedPromptDetail = acceptWorkspaceThreadPromptFromActivityHook(lifecycleEvent);
      if (acceptedPromptDetail?.promptEventId && !lifecycleEvent.promptEventId) {
        lifecycleEvent = {
          ...lifecycleEvent,
          pendingPromptId: acceptedPromptDetail.promptEventId,
          promptEventId: acceptedPromptDetail.promptEventId,
        };
      }
      const hookProjectionEvents = type === "provider-turn-started"
        ? buildTerminalStartedProjectionEvents({
          ...lifecycleEvent,
          agentId: hookAgentId,
          source: payload.source || `cli-hook:${type}`,
          type,
        })
        : [];
      if (hookProjectionEvents.length > 0) {
        lifecycleEvent = {
          ...lifecycleEvent,
          projectionEvents: hookProjectionEvents,
        };
      }
      logTerminalStatus("frontend.terminal_activity_hook.lifecycle", {
        activityStatus,
        acceptedPromptMatched: Boolean(acceptedPromptDetail),
        hookEventName: payload.hookEventName || "",
        hookHealthStatus: payload.hookHealthStatus || "",
        agentDisplayNamePresent: Boolean(hookAgentDisplayName),
        agentTypePresent: Boolean(hookAgentType),
        instanceId: payload.instanceId || "",
        inputReady,
        paneId: payload.paneId || "",
        providerSessionPresent: Boolean(lifecycleEvent.providerSessionId),
        terminalIndex: payload.terminalIndex ?? "",
        threadId: lifecycleEvent.threadId,
        type,
        workspaceId,
      });
      handleThreadTerminalLifecycle(lifecycleEvent);
    };
  }, [acceptWorkspaceThreadPromptFromActivityHook, handleThreadTerminalLifecycle]);

  useEffect(() => {
    let unlistenActivityHook = null;
    let cancelled = false;

    listen(TERMINAL_ACTIVITY_HOOK_EVENT, (hookEvent) => {
      if (cancelled) {
        return;
      }
      terminalActivityHookHandlerRef.current?.(hookEvent);
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenActivityHook = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenActivityHook) {
        unlistenActivityHook();
      }
    };
  }, []);

	  useEffect(() => {
	    terminalPromptSubmittedHandlerRef.current = (promptEvent) => {
      const payload = promptEvent?.payload || {};
      if (!terminalPromptSubmittedPayloadIsAuthoritative(payload)) {
        logWorkspaceThreadDiagnosticEvent("frontend.thread_prompt_submitted_event.skip", {
          instanceId: payload.instanceId || "",
          paneId: payload.paneId || "",
          promptEventIdPresent: Boolean(payload.promptEventId),
          promptMatch: payload.promptMatch,
          promptSource: payload.promptSource || "",
          reason: "prompt_not_authoritative",
          threadId: payload.threadId || "",
          workspaceId: payload.workspaceId || "",
        });
        return;
      }
      const observedPrompt = String(payload.observedPrompt || "").trim();
      const expectedPrompt = String(payload.expectedPrompt || "").trim();
      const fallbackPrompt = String(payload.prompt || "").trim();
      const userMessage = observedPrompt || expectedPrompt || fallbackPrompt;
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
      if (payload.promptMatch === false && !observedPrompt) {
        logWorkspaceThreadDiagnosticEvent("frontend.thread_prompt_submitted_event.skip", {
          expectedPromptLength: expectedPrompt.length,
          instanceId: payload.instanceId || "",
          paneId: payload.paneId || "",
          promptEventIdPresent: Boolean(payload.promptEventId),
          promptSource: payload.promptSource || "",
          reason: "prompt_not_observed",
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
      const submittedPromptSource = String(payload.promptSource || payload.prompt_source || "").trim();
      const submittedByActivityHook = submittedPromptSource === "activity_hook_user_prompt_submit"
        || submittedPromptSource === "cli_hook_user_prompt_submit";
      if (terminalAgentUsesActivityHooks(submittedAgentId) && !submittedByActivityHook) {
        logWorkspaceThreadDiagnosticEvent("frontend.thread_prompt_submitted_event.skip", {
          agentId: submittedAgentId,
          instanceId: payload.instanceId || "",
          paneId: payload.paneId || "",
          promptEventIdPresent: Boolean(payload.promptEventId),
          promptMatch: payload.promptMatch,
          promptSource: submittedPromptSource,
          reason: "activity_hook_owns_prompt_acceptance",
          threadId: payload.threadId || "",
          workspaceId,
        });
        return;
      }
      const submittedProviderBinding = getWorkspaceThreadProviderBinding(
        submittedThread,
        submittedAgentId,
      );
      const submittedThreadId = String(payload.threadId || submittedThread?.id || "").trim();
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
        promptSource: submittedPromptSource,
        promptText: getBigViewTextDiagnosticFields(userMessage),
        source: "terminal-prompt-submitted",
        terminalIndex: payload.terminalIndex ?? "",
        threadId: submittedThreadId,
        workspaceId,
      });
      if (submittedThreadId && userMessage) {
        let acceptedPromptEventId = String(payload.promptEventId || "").trim();
        const acceptedMatchedBy = submittedByActivityHook
          ? "activity-hook-user-prompt-submit"
          : "terminal-submit";
        const acceptedPromptDetail = {
          agentId: submittedAgentId,
          matchedBy: acceptedMatchedBy,
          promptEventId: acceptedPromptEventId,
          promptText: userMessage,
          sessionId: submittedProviderSessionId,
          threadId: submittedThreadId,
          workspaceId,
        };
        rememberWorkspaceThreadPromptAcceptance(
          workspaceThreadAcceptedPromptsRef.current,
          acceptedPromptDetail,
        );
        const acceptedPromptKeys = new Set(getWorkspaceThreadPromptAcceptanceKeys(acceptedPromptDetail));
        workspaceThreadTranscriptRequestsRef.current.forEach((request, requestKey) => {
          const requestKeys = Array.isArray(request?.acceptanceKeys)
            ? request.acceptanceKeys
            : [];
          const matchesAcceptedPrompt = requestKeys.some((key) => acceptedPromptKeys.has(key));
          if (!matchesAcceptedPrompt) {
            return;
          }
          if (!acceptedPromptEventId && request?.promptEventId) {
            acceptedPromptEventId = String(request.promptEventId || "").trim();
          }
          if (request?.inFlight) {
            workspaceThreadTranscriptRequestsRef.current.set(requestKey, {
              ...request,
              terminalPromptAccepted: true,
            });
            return;
          }
          if (request?.timer) {
            window.clearTimeout(request.timer);
          }
          workspaceThreadTranscriptRequestsRef.current.delete(requestKey);
          logWorkspaceThreadDiagnosticEvent("frontend.thread_transcript.accepted_timer_cancelled", {
            agentId: submittedAgentId,
            promptEventId: acceptedPromptEventId,
            requestKey,
            threadId: submittedThreadId,
            workspaceId,
          });
        });
        if (acceptedPromptEventId) {
          setWorkspaceThreads((threads) => clearWorkspaceThreadPendingPrompt(threads, {
            promptEventId: acceptedPromptEventId,
            threadId: submittedThreadId,
            workspaceId,
          }));
          rememberWorkspaceThreadPromptAcceptance(
            workspaceThreadAcceptedPromptsRef.current,
            {
              ...acceptedPromptDetail,
              promptEventId: acceptedPromptEventId,
            },
          );
        }
        logWorkspaceThreadDiagnosticEvent("frontend.thread_prompt_submitted_event.accepted", {
          agentId: submittedAgentId,
          instanceId: payload.instanceId || "",
          matchedBy: acceptedMatchedBy,
          paneId: payload.paneId || "",
          promptEventId: acceptedPromptEventId,
          providerSessionPresent: Boolean(submittedProviderSessionId),
          threadId: submittedThreadId,
          workspaceId,
        });
        if (acceptedPromptEventId) {
          window.dispatchEvent(new CustomEvent(WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT, {
            detail: {
              agentId: submittedAgentId,
              matchedBy: acceptedMatchedBy,
              promptEventId: acceptedPromptEventId,
              promptText: userMessage,
              sessionId: submittedProviderSessionId,
              threadId: submittedThreadId,
              workspaceId,
            },
          }));
        }
      }
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
        promptAccepted: true,
        promptEventId: payload.promptEventId || "",
        promptEventSubmittedAt: payload.promptEventSubmittedAt || "",
        providerSessionId: submittedProviderSessionId,
        source: "terminal-prompt-submitted",
        submittedAt: payload.promptEventSubmittedAt || new Date().toISOString(),
        terminalIndex: payload.terminalIndex,
        terminalPromptAccepted: true,
        threadId: submittedThreadId,
        userMessage,
        workspaceId,
      });
    };
  }, [requestWorkspaceThreadTranscript]);

  useEffect(() => {
    let unlistenPromptSubmitted = null;
    let cancelled = false;

    listen(TERMINAL_PROMPT_SUBMITTED_EVENT, (promptEvent) => {
      terminalPromptSubmittedHandlerRef.current?.(promptEvent);
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
  }, []);

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
        const providerSessionId = thread.transcriptSessionId || providerBinding?.nativeSessionId || "";
        const hasSessionPointer = Boolean(
          providerSessionId,
        );
        if (!hasSessionPointer) {
          if (runningTurn && thread.latestTurn?.startedAt && thread.coordination?.worktreePath) {
            const runningPromptInfo = getWorkspaceThreadRunningPromptInfo(thread, runningPromptEventId);
            requestWorkspaceThreadTranscript({
              agentId,
              allowTimestampFallback: true,
              delayMs: 240,
              expectedMessageCreatedAt: runningPromptInfo.createdAt || thread.latestTurn?.startedAt || "",
              expectedUserMessage: runningPromptInfo.text || "",
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
          const runningWatchKey = workspaceThreadTranscriptWatchKey({
            agentId,
            promptEventId: runningPromptEventId,
            providerSessionId,
            threadId,
            workspaceId,
          });
          if (runningWatchKey && workspaceThreadTranscriptWatchKeysRef.current.has(runningWatchKey)) {
            return;
          }
          const runningPromptInfo = getWorkspaceThreadRunningPromptInfo(thread, runningPromptEventId);
          requestWorkspaceThreadTranscript({
            agentId,
            delayMs: 160,
            expectedMessageCreatedAt: runningPromptInfo.createdAt || thread.latestTurn?.startedAt || "",
            expectedUserMessage: runningPromptInfo.text || "",
            pollStartedAt: Date.parse(thread.latestTurn?.startedAt || thread.latestTurn?.requestedAt || "")
              || Date.now(),
            pollUntilTurnComplete: true,
            promptEventId: runningPromptEventId,
            providerSessionId,
            threadId,
            workspaceId,
          });
          return;
        }

        if (hasVisibleTranscript && (hasNativeSessionTitle || titleLookupChecked)) {
          return;
        }

        const titleWatchKey = workspaceThreadTranscriptWatchKey({
          agentId,
          providerSessionId,
          threadId,
          workspaceId,
        });
        if (titleWatchKey && workspaceThreadTranscriptWatchKeysRef.current.has(titleWatchKey)) {
          return;
        }
        requestWorkspaceThreadTranscript({
          agentId,
          delayMs: 80,
          providerSessionId,
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
        agentStarted: session.agentStarted === true,
        instanceId: session.instanceId,
        needsAgentStart: session.needsAgentStart === true,
        paneId: session.paneId,
        threadId: session.threadId || "",
        terminalIndex: session.terminalIndex,
        workspaceId: session.workspaceId || "",
      });
      logWorkspaceActivationTrace("workspace.open.prepared_terminal.ready", session.workspaceId || "", {
        agentId: session.agentId || "",
        agentStarted: session.agentStarted === true,
        instanceId: session.instanceId || "",
        needsAgentStart: session.needsAgentStart === true,
        paneId: session.paneId || "",
        preparedCount: preparedTerminalsRef.current.size,
        terminalIndex: session.terminalIndex,
        threadId: session.threadId || "",
      });
    } else {
      preparedTerminalsRef.current.delete(key);
      logWorkspaceActivationTrace("workspace.open.prepared_terminal.removed", session.workspaceId || "", {
        agentId: session.agentId || "",
        instanceId: session.instanceId || "",
        paneId: session.paneId || "",
        preparedCount: preparedTerminalsRef.current.size,
        terminalIndex: session.terminalIndex,
        threadId: session.threadId || "",
      });
    }

    setPreparedTerminalVersion((version) => version + 1);
  }, [logWorkspaceActivationTrace]);

  const preparedWorkspaceTerminalSessions = useMemo(() => {
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
          agentStarted: session.agentStarted === true,
          model,
          needsAgentStart: session.needsAgentStart === true,
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
  const preparedWorkspaceTerminalRequests = useMemo(
    () => preparedWorkspaceTerminalSessions.filter((session) => session.needsAgentStart),
    [preparedWorkspaceTerminalSessions],
  );
  const preparedWorkspaceTerminalCount = preparedWorkspaceTerminalSessions.length;
  const preparedWorkspaceTerminalAgentStartCount = preparedWorkspaceTerminalRequests.length;

  useEffect(() => {
    if (workspaceDeactivationInFlightRef.current) {
      logWorkspaceActivationTrace("workspace.open.agent_batch.skip", activatedWorkspace?.id || "", {
        reason: "workspace_deactivation_in_flight",
        workspaceDeactivationInFlight: workspaceDeactivationInFlightRef.current,
      });
      return;
    }

    if (!workspaceAgentLaunchKey) {
      logWorkspaceActivationTrace("workspace.open.agent_batch.reset", activatedWorkspace?.id || selectedWorkspaceIdRef.current, {
        agentTerminalCount: activatedWorkspaceAgentTerminalEntries.length,
        preparedWorkspaceTerminalCount,
        reason: "launch_key_empty",
        preparedWorkspaceTerminalAgentStartCount,
        workspaceTerminalAgentLaunchReady,
      });
      workspaceAgentLaunchKeyRef.current = "";
      workspaceAgentBatchInFlightKeyRef.current = "";
      workspaceAgentBatchWaitLogKeyRef.current = "";
      workspaceAgentBatchStartedSessionKeysRef.current.clear();
      workspaceAgentBatchInFlightSessionKeysRef.current.clear();
      setWorkspaceAgentBatchSentLaunchKey("");
      return;
    }

    if (workspaceAgentLaunchKeyRef.current !== workspaceAgentLaunchKey) {
      workspaceAgentLaunchKeyRef.current = workspaceAgentLaunchKey;
      workspaceAgentBatchInFlightKeyRef.current = "";
      workspaceAgentBatchWaitLogKeyRef.current = "";
      workspaceAgentBatchStartedSessionKeysRef.current.clear();
      workspaceAgentBatchInFlightSessionKeysRef.current.clear();
      setWorkspaceAgentBatchSentLaunchKey("");
    }

    const pendingPreparedWorkspaceTerminalRequests = preparedWorkspaceTerminalRequests.filter((request) => {
      const requestKey = getPreparedWorkspaceTerminalRequestKey(request, workspaceAgentLaunchKey);
      return requestKey
        && !workspaceAgentBatchStartedSessionKeysRef.current.has(requestKey)
        && !workspaceAgentBatchInFlightSessionKeysRef.current.has(requestKey);
    });
    const inFlightPreparedWorkspaceTerminalCount = preparedWorkspaceTerminalRequests.reduce((count, request) => {
      const requestKey = getPreparedWorkspaceTerminalRequestKey(request, workspaceAgentLaunchKey);
      return requestKey && workspaceAgentBatchInFlightSessionKeysRef.current.has(requestKey)
        ? count + 1
        : count;
    }, 0);
    const startedPreparedWorkspaceTerminalCount = preparedWorkspaceTerminalRequests.reduce((count, request) => {
      const requestKey = getPreparedWorkspaceTerminalRequestKey(request, workspaceAgentLaunchKey);
      return requestKey && workspaceAgentBatchStartedSessionKeysRef.current.has(requestKey)
        ? count + 1
        : count;
    }, 0);
    const pendingRequestKeys = pendingPreparedWorkspaceTerminalRequests
      .map((request) => getPreparedWorkspaceTerminalRequestKey(request, workspaceAgentLaunchKey))
      .filter(Boolean);

    if (preparedWorkspaceTerminalCount === 0 || pendingPreparedWorkspaceTerminalRequests.length === 0) {
      const allExpectedPrepared = preparedWorkspaceTerminalCount >= activatedWorkspaceAgentTerminalEntries.length;
      const waitReason = preparedWorkspaceTerminalCount === 0
        ? "no_prepared_terminals"
        : inFlightPreparedWorkspaceTerminalCount > 0
          ? "already_in_flight"
          : preparedWorkspaceTerminalAgentStartCount === 0 && allExpectedPrepared
            ? "all_prepared_terminals_ready"
            : pendingPreparedWorkspaceTerminalRequests.length === 0 && preparedWorkspaceTerminalAgentStartCount > 0
              ? "already_sent"
              : "waiting_for_more_prepared_terminals";
      const waitLogKey = [
        workspaceAgentLaunchKey,
        waitReason,
        preparedWorkspaceTerminalCount,
        preparedWorkspaceTerminalAgentStartCount,
        pendingPreparedWorkspaceTerminalRequests.length,
        inFlightPreparedWorkspaceTerminalCount,
        startedPreparedWorkspaceTerminalCount,
      ].join(":");
      if (workspaceAgentBatchWaitLogKeyRef.current !== waitLogKey) {
        workspaceAgentBatchWaitLogKeyRef.current = waitLogKey;
        logWorkspaceActivationTrace("workspace.open.agent_batch.wait", activatedWorkspace?.id || "", {
          agentTerminalCount: activatedWorkspaceAgentTerminalEntries.length,
          inFlightLaunchKey: workspaceAgentBatchInFlightKeyRef.current,
          inFlightPreparedWorkspaceTerminalCount,
          launchKey: workspaceAgentLaunchKey,
          pendingPreparedWorkspaceTerminalCount: pendingPreparedWorkspaceTerminalRequests.length,
          preparedWorkspaceTerminalAgentStartCount,
          preparedWorkspaceTerminalCount,
          reason: waitReason,
          sentLaunchKey: workspaceAgentBatchSentKeyRef.current || workspaceAgentBatchSentKey,
          startedPreparedWorkspaceTerminalCount,
        });
      }

      if (
        waitReason === "all_prepared_terminals_ready"
        && workspaceAgentBatchSentKeyRef.current !== workspaceAgentLaunchKey
      ) {
        workspaceAgentBatchWaitLogKeyRef.current = "";
        setWorkspaceAgentBatchSentLaunchKey(workspaceAgentLaunchKey);
        setWorkspaceAgentLaunchEpoch((epoch) => epoch + 1);
        logWorkspaceActivationTrace("workspace.open.agent_batch.direct_ready", activatedWorkspace.id, {
          agentTerminalCount: activatedWorkspaceAgentTerminalEntries.length,
          launchKey: workspaceAgentLaunchKey,
          preparedWorkspaceTerminalAgentStartCount,
          preparedWorkspaceTerminalCount,
          sessions: preparedWorkspaceTerminalSessions.map((session) => ({
            agentStarted: session.agentStarted === true,
            instanceId: session.instanceId || "",
            needsAgentStart: session.needsAgentStart === true,
            paneId: session.paneId || "",
            provider: session.provider || "",
            terminalIndex: session.terminalIndex ?? "",
            threadId: session.threadId || "",
            workspaceId: session.workspaceId || "",
          })),
        });
      }
      return;
    }

    workspaceAgentBatchInFlightKeyRef.current = workspaceAgentLaunchKey;
    workspaceAgentBatchWaitLogKeyRef.current = "";
    pendingRequestKeys.forEach((requestKey) => {
      workspaceAgentBatchInFlightSessionKeysRef.current.add(requestKey);
    });
    const batchStartedAt = performance.now();

    logWorkspaceActivationTrace("workspace.open.agent_batch.start", activatedWorkspace.id, {
      inFlightPreparedWorkspaceTerminalCount,
      launchKey: workspaceAgentLaunchKey,
      pendingPreparedWorkspaceTerminalCount: pendingPreparedWorkspaceTerminalRequests.length,
      preparedWorkspaceTerminalAgentStartCount,
      preparedWorkspaceTerminalCount,
      requestCount: pendingPreparedWorkspaceTerminalRequests.length,
      requests: pendingPreparedWorkspaceTerminalRequests.map((request) => ({
        hasProviderSessionId: Boolean(request.providerSessionId),
        instanceId: request.instanceId || "",
        model: request.model || "",
        paneId: request.paneId || "",
        provider: request.provider || "",
        terminalIndex: request.terminalIndex ?? "",
        threadId: request.threadId || "",
        workspaceId: request.workspaceId || "",
      })),
    });
    logBigViewSyncDiagnosticEvent("bigview.model_restore.batch_start", {
      launchKey: workspaceAgentLaunchKey,
      requestCount: pendingPreparedWorkspaceTerminalRequests.length,
      requests: pendingPreparedWorkspaceTerminalRequests.map((request) => ({
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

    invoke("terminal_start_agent_many", { requests: pendingPreparedWorkspaceTerminalRequests })
      .then((result) => {
        const results = Array.isArray(result?.results) ? result.results : [];
        logWorkspaceActivationTrace("workspace.open.agent_batch.done", activatedWorkspace.id, {
          elapsedMs: Math.max(0, performance.now() - batchStartedAt),
          launchKey: workspaceAgentLaunchKey,
          requestCount: pendingPreparedWorkspaceTerminalRequests.length,
          resultCount: results.length,
          startedCount: results.filter((paneResult) => paneResult?.started).length,
        });
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

          const request = pendingPreparedWorkspaceTerminalRequests.find((candidate) => (
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
          logWorkspaceActivationTrace("workspace.open.agent_batch.pane_started", request.workspaceId || activatedWorkspace.id, {
            hasProviderSessionId: Boolean(request.providerSessionId),
            instanceId: paneResult.instanceId || request.instanceId || "",
            launchKey: workspaceAgentLaunchKey,
            model: request.model || "",
            paneId: paneResult.paneId || request.paneId || "",
            provider: request.provider || "",
            terminalIndex: request.terminalIndex ?? "",
            threadId: request.threadId || "",
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
        pendingRequestKeys.forEach((requestKey) => {
          workspaceAgentBatchInFlightSessionKeysRef.current.delete(requestKey);
          workspaceAgentBatchStartedSessionKeysRef.current.add(requestKey);
        });
        if (workspaceAgentBatchInFlightSessionKeysRef.current.size === 0) {
          workspaceAgentBatchInFlightKeyRef.current = "";
        }
        setWorkspaceAgentBatchSentLaunchKey(workspaceAgentLaunchKey);
        setWorkspaceAgentLaunchEpoch((epoch) => epoch + 1);
        preparedTerminalsRef.current.forEach((session, key) => {
          if (pendingPreparedWorkspaceTerminalRequests.some((request) => (
            request.paneId === session.paneId && request.instanceId === session.instanceId
          ))) {
            preparedTerminalsRef.current.delete(key);
          }
        });
        setPreparedTerminalVersion((version) => version + 1);
      })
      .catch((error) => {
        logWorkspaceActivationTrace("workspace.open.agent_batch.error", activatedWorkspace.id, {
          elapsedMs: Math.max(0, performance.now() - batchStartedAt),
          launchKey: workspaceAgentLaunchKey,
          message: error?.message || String(error || ""),
          requestCount: pendingPreparedWorkspaceTerminalRequests.length,
        });
        logBigViewSyncDiagnosticEvent("bigview.model_restore.batch_error", {
          launchKey: workspaceAgentLaunchKey,
          message: error?.message || String(error || ""),
          requestCount: pendingPreparedWorkspaceTerminalRequests.length,
          workspaceId: activatedWorkspace.id,
        });
        pendingRequestKeys.forEach((requestKey) => {
          workspaceAgentBatchInFlightSessionKeysRef.current.delete(requestKey);
          workspaceAgentBatchStartedSessionKeysRef.current.add(requestKey);
        });
        if (workspaceAgentBatchInFlightSessionKeysRef.current.size === 0) {
          workspaceAgentBatchInFlightKeyRef.current = "";
        }
        setWorkspaceAgentBatchSentLaunchKey(workspaceAgentLaunchKey);
        setWorkspaceAgentLaunchEpoch((epoch) => epoch + 1);
        preparedTerminalsRef.current.forEach((session, key) => {
          if (pendingPreparedWorkspaceTerminalRequests.some((request) => (
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
    preparedWorkspaceTerminalAgentStartCount,
    preparedWorkspaceTerminalCount,
    preparedWorkspaceTerminalRequests,
    preparedWorkspaceTerminalSessions,
    setWorkspaceAgentBatchSentLaunchKey,
    workspaceAgentBatchSentKey,
    workspaceAgentLaunchKey,
    workspaceTerminalAgentLaunchReady,
    logWorkspaceActivationTrace,
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
    setWorkspaceAgentSessionModeDraft(normalizeAgentSessionMode(selectedWorkspaceAgentSessionMode));
    setWorkspaceUnsafeModeArmed(false);
    setWorkspaceRootDraft(selectedWorkspaceRootDirectory);
    setWorkspaceSettingsError("");
    setWorkspaceSettingsMessage("");
    setWorkspaceDeleteConfirmId("");
  }, [
    selectedWorkspace?.id,
    selectedWorkspace?.name,
    selectedWorkspaceRootDirectory,
    selectedWorkspaceAgentSessionMode,
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
  const isPaidPlanUser = isPaidUser(user) || billingStatus?.planStatus === "paid";
  const cloudSyncPillState = authState !== "authenticated"
    ? null
    : !isPaidPlanUser
      ? "upgrade"
      : (cloudSyncStatus?.connection || "connecting") !== "connected"
        ? "connecting"
        : cloudSyncStatus?.syncing || (cloudSyncStatus?.pendingCount || 0) > 0
          ? "syncing"
          : "live";
  const cloudSyncPendingCount = Number(cloudSyncStatus?.pendingCount || 0);
  const cloudSyncPillLabel = {
    connecting: "Connecting",
    live: "Live Sync",
    syncing: "Syncing",
    upgrade: "Upgrade",
  }[cloudSyncPillState] || "";
  const cloudSyncPillTitle = {
    connecting: "Establishing the live cloud connection. Changes are saved locally and sync once connected.",
    live: "Connected. Changes sync live to your account.",
    syncing: cloudSyncPendingCount > 0
      ? `Syncing ${cloudSyncPendingCount} queued change${cloudSyncPendingCount === 1 ? "" : "s"} to the cloud.`
      : "Syncing queued changes to the cloud.",
    upgrade: "Upgrade to unlock live cloud sync across your devices.",
  }[cloudSyncPillState] || "";
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
  const workspaceCloseTotalKnown = workspaceCloseState.terminalTotalKnown === true;
  const workspaceCloseTotal = Math.max(normalizeCloseCount(workspaceCloseState.total), workspaceCloseReportedClosed);
  const workspaceCloseClosed = Math.min(workspaceCloseReportedClosed, workspaceCloseTotal);
  const workspaceClosePhaseId = String(workspaceCloseState.phase || "closing_webviews");
  const workspaceClosePhaseStep = WORKSPACE_SHUTDOWN_STEP_BY_ID.get(workspaceClosePhaseId)
    || WORKSPACE_SHUTDOWN_STEPS[0];
  const workspaceClosePhaseIndex = Math.max(0, workspaceClosePhaseStep.index || 0);
  const workspaceCloseTotalSteps = Math.max(
    WORKSPACE_SHUTDOWN_STEPS.length,
    normalizeCloseCount(workspaceCloseState.totalSteps),
  );
  const workspaceCloseTerminalFraction = workspaceCloseTotal > 0
    ? workspaceCloseClosed / workspaceCloseTotal
    : workspaceCloseTotalKnown && workspaceClosePhaseId === "closing_terminals"
      ? 1
      : 0;
  const workspaceClosePhaseFraction = workspaceClosePhaseId === "exiting"
    ? 1
    : workspaceClosePhaseId === "closing_terminals"
      ? (workspaceClosePhaseIndex + workspaceCloseTerminalFraction) / workspaceCloseTotalSteps
      : (workspaceClosePhaseIndex + 0.35) / workspaceCloseTotalSteps;
  const workspaceCloseProgress = Math.min(100, Math.max(0, Math.round(workspaceClosePhaseFraction * 100)));
  const workspaceCloseTerminalLabel = workspaceCloseTotal === 1 ? "terminal" : "terminals";
  const workspaceClosePhaseLabel = workspaceCloseState.phaseLabel
    || workspaceClosePhaseStep.label
    || "Closing workspace";
  const workspaceClosePhaseDetail = workspaceCloseState.phaseDetail
    || workspaceClosePhaseStep.detail
    || "Shutting down workspace runtime.";
  const workspaceCloseCounterText = workspaceClosePhaseId === "closing_terminals"
    ? workspaceCloseTotalKnown
      ? workspaceCloseTotal > 0
        ? `${workspaceCloseClosed} / ${workspaceCloseTotal} ${workspaceCloseTerminalLabel} closed`
        : "No live terminals to close"
      : "Counting live terminals"
    : `Step ${Math.min(workspaceClosePhaseIndex + 1, workspaceCloseTotalSteps)} / ${workspaceCloseTotalSteps}`;
  const appCloseConfirmTerminalLabel = appCloseConfirmState.blockingCount === 1 ? "terminal" : "terminals";
  const appCloseConfirmWorkspaceLabel = appCloseConfirmState.workspaces.length === 1 ? "workspace" : "workspaces";
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
  const isWorkspaceStartupOverlayVisible = workspaceState !== "ready";

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
            <WindowBackgroundPill
              aria-label="Run in background"
              data-platform={windowControlPlatform}
              data-window-control
              onClick={enterBackgroundMode}
              title="Run Diff Forge in the background (terminals, sync, and hotkeys keep working)"
              type="button"
            >
              <TitleBackgroundIcon aria-hidden="true" />
              <span>Background</span>
            </WindowBackgroundPill>
            {cloudSyncPillState ? (
              <WindowSyncPill
                aria-label={cloudSyncPillTitle}
                data-platform={windowControlPlatform}
                data-state={cloudSyncPillState}
                data-window-control
                onClick={cloudSyncPillState === "upgrade" ? openPricing : undefined}
                title={cloudSyncPillTitle}
                type="button"
              >
                {["syncing", "connecting"].includes(cloudSyncPillState) ? (
                  <WindowSyncPillSpinner aria-hidden="true" />
                ) : (
                  <WindowSyncPillDot aria-hidden="true" />
                )}
                <span>{cloudSyncPillLabel}</span>
              </WindowSyncPill>
            ) : null}
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
                  <PlanEyebrow>Plus</PlanEyebrow>
                  <PlanPrice>
                    $40<span>/mo</span>
                  </PlanPrice>
                  <PlanDescription>Paid status unlocks the native dashboard shell with 5,000 monthly credits.</PlanDescription>
                  <PlanFeatureList>
                    <li>Desktop workspace dashboard</li>
                    <li>Cloud workspace sync</li>
                    <li>5,000 included credits</li>
                  </PlanFeatureList>
                </PricingPlanCard>

                <PricingPlanCard data-featured="true">
                  <PlanEyebrow>Pro</PlanEyebrow>
                  <PlanPrice>
                    $100<span>/mo</span>
                  </PlanPrice>
                  <PlanDescription>Higher allowance for heavier cloud AI, voice, and orchestration work.</PlanDescription>
                  <PlanFeatureList>
                    <li>Everything in Plus</li>
                    <li>20,000 included credits</li>
                    <li>Priority native app access</li>
                  </PlanFeatureList>
                </PricingPlanCard>

                <PricingPlanCard data-featured="true">
                  <PlanEyebrow>Ultra</PlanEyebrow>
                  <PlanPrice>
                    $200<span>/mo</span>
                  </PlanPrice>
                  <PlanDescription>Largest monthly allowance for intensive cloud AI and orchestration work.</PlanDescription>
                  <PlanFeatureList>
                    <li>Everything in Pro</li>
                    <li>50,000 included credits</li>
                    <li>Maximum monthly AI allowance</li>
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
                    <RailCreateWorkspaceButton
                      aria-label="Create workspace"
                      onClick={(event) => {
                        event.stopPropagation();
                        openCreateWorkspaceModal();
                      }}
                      title="Create workspace"
                      type="button"
                    >
                      <ButtonAddIcon aria-hidden="true" />
                    </RailCreateWorkspaceButton>
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
                  {shouldShowAccountScopePicker && !workspaceRailCollapsed && (
                    <RailAccountScopeShell data-rail-selection-preserve="true">
                      <RailAccountScopeSelect
                        aria-label="Account scope"
                        onChange={handleAccountScopeChange}
                        value={activeAccountScopeKey}
                      >
                        {accountScopes.map((scope) => (
                          <option key={accountScopeKey(scope)} value={accountScopeKey(scope)}>
                            {scope.label}
                          </option>
                        ))}
                      </RailAccountScopeSelect>
                      <RailAccountScopeIcon aria-hidden="true" />
                    </RailAccountScopeShell>
                  )}
                  <WorkspaceList>
                    {workspaces.map((workspace) => {
                      const workspaceRoot = getWorkspaceRootDirectory(workspaceSettings, workspace.id);
                      const workspaceIsRuntimeEnabled = enabledRuntimeWorkspaceIds.includes(workspace.id);
                      const workspaceRuntimeState = workspace.id === activatedWorkspaceId
                        ? workspaceState === "ready"
                          ? "activated"
                          : "activating"
                        : workspaceIsRuntimeEnabled
                          ? "activated"
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
                              selectWorkspaceFromRail(workspace.id);
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

                <RailFooter data-rail-selection-preserve="true">
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
                        aria-label="History"
                        data-active={activeView === "architecture"}
                        onClick={() => showView("architecture")}
                        title="Todo, task, and scan history"
                        type="button"
                      >
                        <ButtonForgeIcon aria-hidden="true" />
                        <span>History</span>
                      </RailActionButton>
                    </>
                  )}
                  <RailGlobalActions aria-label="Global controls">
                    <RailActionButton
                      aria-label="Tools"
                      data-active={GLOBAL_TOOLS_VIEWS.has(activeView)}
                      data-scope="global"
                      onClick={() => showView("tools")}
                      title="Architectures, MCPs, Skills & CLIs"
                      type="button"
                    >
                      <ButtonHubIcon aria-hidden="true" />
                      <span>Tools</span>
                    </RailActionButton>
                    <RailActionButton
                      aria-label="Assets"
                      data-active={activeView === "assets"}
                      data-scope="global"
                      onClick={() => showView("assets")}
                      title="Assets"
                      type="button"
                    >
                      <ButtonAssetsIcon aria-hidden="true" />
                      <span>Assets</span>
                    </RailActionButton>
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
                      aria-label="Snipping"
                      data-active={activeView === "snipping"}
                      data-scope="global"
                      onClick={() => showView("snipping")}
                      title="Snipping"
                      type="button"
                    >
                      <ButtonSnippingIcon aria-hidden="true" />
                      <span>Snipping</span>
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
                      aria-label="Tokenomics"
                      data-active={activeView === "tokenomics"}
                      data-scope="global"
                      onClick={() => showView("tokenomics")}
                      title="Tokenomics"
                      type="button"
                    >
                      <ButtonBrowserIcon aria-hidden="true" />
                      <span>Tokenomics</span>
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
                  {shouldShowWorkspaceSetup ? (
                    <WorkspaceRuntimeLayer
                      aria-hidden={visibleView !== DEFAULT_WORKSPACE_VIEW}
                      data-visible={visibleView === DEFAULT_WORKSPACE_VIEW}
                    >
                      <WorkspaceCreatePanel
                        agentStatuses={agentStatuses}
                        chooseNativeDirectory={chooseNewWorkspaceRootDirectory}
                        defaultWorkingDirectory={defaultWorkingDirectory}
                        fallbackRole={workspaceTerminalFallbackRole}
                        onClose={null}
                        onSubmit={(event, terminalRoles) => createFirstWorkspace(event, terminalRoles)}
                        roleOptions={workspaceTerminalRoleOptions}
                        rootDraft={newWorkspaceRootDraft}
                        setRootDraft={setNewWorkspaceRootDraft}
                        setWorkspaceName={setWorkspaceName}
                        visible={visibleView === DEFAULT_WORKSPACE_VIEW}
                        workspaceError={workspaceError}
                        workspaceName={workspaceName}
                        workspaceSyncState={workspaceSyncState}
                      />
                    </WorkspaceRuntimeLayer>
                  ) : shouldKeepWorkspaceTerminalMounted && (
                    enabledWorkspaceRuntimeDescriptors.map((runtimeDescriptor) => {
                      const runtimeWorkspace = runtimeDescriptor.workspace;
                      const runtimeVisible = Boolean(
                        runtimeWorkspace?.id
                          && runtimeWorkspace.id === selectedWorkspace?.id
                          && shouldRevealWorkspaceTerminal,
                      );
                      const runtimeIsDeactivating = Boolean(
                        workspaceDeactivationState.isActive
                          && workspaceDeactivationState.workspaceId === runtimeWorkspace?.id,
                      );
                      const runtimeAgentLaunchReady = Boolean(
                        runtimeVisible
                          && workspaceState === "ready"
                          && workspaceHydrationReady
                          && !workspaceActivationDeferred
                          && workspaceThreadsHydrated
                          && !runtimeIsDeactivating
                          && runtimeDescriptor.agentTerminalEntries.length > 0,
                      );
                      const runtimeArchitectureGraphStateKey = workspaceGraphStateKey(
                        runtimeDescriptor.workingDirectory,
                        runtimeWorkspace.id,
                      );
                      const runtimeArchitectureGraphState = runtimeArchitectureGraphStateKey
                        ? workspaceGraphState[runtimeArchitectureGraphStateKey] || {}
                        : {};

                      return (
                        <WorkspaceRuntimeLayer
                          aria-hidden={visibleView !== DEFAULT_WORKSPACE_VIEW || !runtimeVisible}
                          data-visible={visibleView === DEFAULT_WORKSPACE_VIEW && runtimeVisible}
                          key={runtimeWorkspace.id}
                        >
                          <TerminalView
                            accountKey={user?.id || user?.email || ""}
                            architectureTerminalActivity={workspaceArchitectureTerminalActivity[runtimeWorkspace.id]?.latest || null}
                            architectureWorkspaceRoot={runtimeDescriptor.workingDirectory}
                            architectureWorkspaceState={runtimeArchitectureGraphState}
                            billingStatus={billingStatus}
                            connectedDevices={cloudWorkspaceProgress.connectedDevices}
                            defaultWorkingDirectory={defaultWorkingDirectory}
                            knownDevices={cloudWorkspaceProgress.knownDevices}
                            storageUsage={cloudWorkspaceProgress.storageUsage}
                            workspaceTodos={cloudWorkspaceProgress.workspaceTodos}
                            terminalWorkspace={runtimeWorkspace}
                            terminalAgentsByIndex={runtimeDescriptor.terminalAgentsByIndex}
                            terminalRolesByIndex={runtimeDescriptor.terminalRolesByIndex}
	                            terminalWorkspaceRootWasEmptyAtSelection={runtimeDescriptor.rootWasEmptyAtSelection}
	                            terminalWorkspaceWorkingDirectory={runtimeDescriptor.workingDirectory}
	                            terminalWorkspaceCoordinationTargets={getWorkspaceCoordinationTargetsForRoot(
	                              workspaceCoordinationTargetsByRoot,
	                              runtimeDescriptor.workingDirectory,
	                            )}
	                            terminalWorkspaceLogicalIndexes={runtimeDescriptor.logicalTerminalIndexes}
                            terminalWorkspaceLogicalTerminalCount={runtimeDescriptor.logicalTerminalCount}
                            agentStatusError={agentStatusError}
                            agentStatuses={agentStatuses}
                            agentStatusState={agentStatusState}
                            addWorkspaceTerminal={addWorkspaceTerminal}
                            closeWorkspaceTerminal={closeWorkspaceTerminal}
                            changeWorkspaceTerminalRole={changeWorkspaceTerminalRole}
                            createWorkspaceThreadTerminal={createWorkspaceThreadTerminal}
                            createFirstWorkspace={createFirstWorkspace}
                            chooseNewWorkspaceRootDirectory={chooseNewWorkspaceRootDirectory}
                            gitRepositoriesPreload={workspaceGitRepositoryPreloads[
                              workspaceGitPullPromptCheckKey(runtimeWorkspace.id, runtimeDescriptor.workingDirectory)
                            ] || null}
                            gitSnapshotsPreload={workspaceGitSnapshotPreloads[
                              workspaceGitPullPromptCheckKey(runtimeWorkspace.id, runtimeDescriptor.workingDirectory)
                            ] || null}
                            handlePreparedTerminalChange={handlePreparedTerminalChange}
                            isAppClosing={workspaceCloseState.isActive}
                            isWorkspaceRuntimeVisible={runtimeVisible}
                            isWorkspaceSurfaceVisible={visibleView === DEFAULT_WORKSPACE_VIEW && runtimeVisible}
                            isWorkspaceRuntimeDeactivating={runtimeIsDeactivating}
                            manageWorkspaceAgents={manageWorkspaceAgents}
                            onArchiveWorkspaceThread={archiveWorkspaceThreadFromOverlay}
                            onOpenWorkspaceSettings={openActivatedWorkspaceSettings}
                            onSelectWorkspaceThread={selectWorkspaceThreadInOverlay}
                            onToggleWorkspaceThreadPinned={toggleWorkspaceThreadPinnedFromOverlay}
                            onRefreshGitRepositories={refreshWorkspaceGitRepositoryPreload}
                            onRefreshGitSnapshot={refreshWorkspaceGitSnapshotPreload}
                            onWorkspaceThreadsViewStateChange={updateWorkspaceThreadsViewStateFromOverlay}
                            onThreadTerminalLifecycle={handleThreadTerminalLifecycle}
                            refreshAgentStatuses={refreshAgentStatuses}
                            reorderWorkspaceTerminalDisplayLayout={reorderWorkspaceTerminalDisplayLayout}
                            setWorkspaceName={setWorkspaceName}
                            newWorkspaceRootDraft={newWorkspaceRootDraft}
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
                            useDefaultNewWorkspaceRoot={useDefaultNewWorkspaceRoot}
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
                  <WorkspaceCreateLayer
                    aria-hidden={visibleView !== DEFAULT_WORKSPACE_VIEW || !workspaceCreateModalOpen}
                    data-visible={visibleView === DEFAULT_WORKSPACE_VIEW && workspaceCreateModalOpen}
                  >
                    {workspaceCreateModalOpen && (
                      <WorkspaceCreatePanel
                        agentStatuses={agentStatuses}
                        chooseNativeDirectory={chooseNewWorkspaceRootDirectory}
                        defaultWorkingDirectory={defaultWorkingDirectory}
                        fallbackRole={workspaceTerminalFallbackRole}
                        onClose={closeCreateWorkspaceModal}
                        onSubmit={(event, terminalRoles) => createFirstWorkspace(event, terminalRoles)}
                        roleOptions={workspaceTerminalRoleOptions}
                        rootDraft={newWorkspaceRootDraft}
                        setRootDraft={setNewWorkspaceRootDraft}
                        setWorkspaceName={setWorkspaceName}
                        visible={workspaceCreateModalOpen}
                        workspaceError={workspaceError}
                        workspaceName={workspaceName}
                        workspaceSyncState={workspaceSyncState}
                      />
                    )}
                  </WorkspaceCreateLayer>
                  <WorkspaceCreateLayer
                    aria-hidden={visibleView !== DEFAULT_WORKSPACE_VIEW || !isWorkspaceSettingsOpen}
                    data-visible={visibleView === DEFAULT_WORKSPACE_VIEW && isWorkspaceSettingsOpen}
                  >
                    {isWorkspaceSettingsOpen && (
                      <WorkspaceCreateSurface>
                        <WorkspaceCreateCard
                          aria-busy={isWorkspaceSettingsBusy}
                          aria-label="Workspace settings"
                          onSubmit={saveWorkspaceSettings}
                        >
                          <WorkspaceCreateHeader>
                            <div>
                              <PanelKicker>Workspace settings</PanelKicker>
                              <PanelHeading>{selectedWorkspace.name}</PanelHeading>
                            </div>
                            <WorkspaceModalCloseButton
                              aria-label="Close workspace settings"
                              disabled={isWorkspaceSettingsBusy}
                              onClick={closeWorkspaceSettings}
                              title="Close"
                              type="button"
                            >
                              <ButtonCloseIcon aria-hidden="true" />
                            </WorkspaceModalCloseButton>
                          </WorkspaceCreateHeader>

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

                          <WorkspaceCreateSection>
                            <SettingsLabel>Name</SettingsLabel>
                            <WorkspaceSettingsInput
                              disabled={isWorkspaceSettingsBusy}
                              maxLength={80}
                              minLength={1}
                              onChange={(event) => {
                                setWorkspaceNameDraft(event.target.value);
                                setWorkspaceSettingsError("");
                                setWorkspaceSettingsMessage("");
                              }}
                              value={workspaceNameDraft}
                            />
                          </WorkspaceCreateSection>

                          <WorkspaceCreateSection>
                            <SettingsLabel>Project root</SettingsLabel>
                            <WorkspaceCreatePathBar>
                              <WorkspaceCreatePathText title={workspaceRootDraft || selectedWorkspaceRootDisplay}>
                                {workspaceRootDraft || selectedWorkspaceRootDisplay || defaultWorkingDirectory || "Choose project root"}
                              </WorkspaceCreatePathText>
                            </WorkspaceCreatePathBar>
                            <WorkspaceCreateFooter>
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
                            </WorkspaceCreateFooter>
                          </WorkspaceCreateSection>

                          <WorkspaceCreateSection>
                            <SettingsLabel>Terminal layout</SettingsLabel>
                            <SettingsHint>Choose the total, then distribute panes across installed agent CLIs and plain terminals.</SettingsHint>
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
                          </WorkspaceCreateSection>

                          <WorkspaceCreateSection>
                            <SettingsLabel>Agent safety mode</SettingsLabel>
                            <SettingsHint>
                              Coordinated is the default: agents edit the repo directly with file locking and terminal pause/resume.
                              Safe adds isolated worktrees with patch submission. Direct removes every rail: agents edit immediately,
                              can conflict, and cannot pause or resume.
                            </SettingsHint>
                            <AgentSafetyModeGroup aria-label="Agent safety mode" role="radiogroup">
                              {AGENT_SESSION_MODE_OPTIONS.map((option) => {
                                const active = workspaceAgentSessionModeDraft === option.value;
                                const needsConfirm = option.value === AGENT_SESSION_MODE_DIRECT && !active;
                                return (
                                  <AgentSafetyModeButton
                                    aria-checked={active}
                                    data-active={active ? "true" : "false"}
                                    data-tone={option.tone}
                                    disabled={isWorkspaceSettingsBusy}
                                    key={option.value}
                                    onClick={() => {
                                      setWorkspaceSettingsError("");
                                      setWorkspaceSettingsMessage("");
                                      if (needsConfirm && !workspaceUnsafeModeArmed) {
                                        setWorkspaceUnsafeModeArmed(true);
                                        setWorkspaceSettingsMessage(
                                          "Direct mode disables worktrees, locking, and pause/resume. Click Direct again to confirm.",
                                        );
                                        return;
                                      }
                                      setWorkspaceUnsafeModeArmed(false);
                                      setWorkspaceAgentSessionModeDraft(option.value);
                                    }}
                                    role="radio"
                                    type="button"
                                  >
                                    <strong>
                                      {option.value === AGENT_SESSION_MODE_DIRECT && workspaceUnsafeModeArmed && !active
                                        ? "Confirm Direct"
                                        : option.label}
                                    </strong>
                                    <em>{option.description}</em>
                                  </AgentSafetyModeButton>
                                );
                              })}
                            </AgentSafetyModeGroup>
                          </WorkspaceCreateSection>

                          <WorkspaceCreateSection>
                            <SettingsLabel>Workspace state</SettingsLabel>
                            <WorkspaceCreateFooter>
                              {isSelectedWorkspaceActivated ? (
                                <SecondaryButton
                                  disabled={isWorkspaceSettingsBusy}
                                  onClick={() => deactivateWorkspace(selectedWorkspace.id, "workspace_settings")}
                                  type="button"
                                >
                                  <ButtonCloseIcon aria-hidden="true" />
                                  <span>{isWorkspaceSettingsDeactivating ? "Deactivating..." : "Deactivate"}</span>
                                </SecondaryButton>
                              ) : (
                                <SecondaryButton
                                  disabled={isWorkspaceSettingsBusy}
                                  onClick={() => requestWorkspaceActivation(selectedWorkspace.id, "workspace_settings")}
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
                            </WorkspaceCreateFooter>
                          </WorkspaceCreateSection>

                          {workspaceSettingsError && <FormMessage $state="error">{workspaceSettingsError}</FormMessage>}
                          {workspaceSettingsMessage && <AgentInstallMessage data-tone="success">{workspaceSettingsMessage}</AgentInstallMessage>}

                          <WorkspaceCreateFooter>
                            <PrimaryDangerButton
                              disabled={isWorkspaceSettingsBusy}
                              onClick={() => deleteWorkspaceFromForge(selectedWorkspace.id)}
                              type="button"
                            >
                              <ButtonDeleteIcon aria-hidden="true" />
                              <span>
                                {isWorkspaceSettingsDeleting
                                  ? "Deleting..."
                                  : isWorkspaceDeleteConfirming
                                    ? "Confirm delete"
                                    : "Delete from Diff Forge"}
                              </span>
                            </PrimaryDangerButton>
                            <PrimaryButton disabled={isWorkspaceSettingsBusy} type="submit">
                              <ButtonCheckIcon aria-hidden="true" />
                              <span>{workspaceSettingsState === "saving" ? "Saving..." : "Save"}</span>
                            </PrimaryButton>
                          </WorkspaceCreateFooter>
                        </WorkspaceCreateCard>
                      </WorkspaceCreateSurface>
                    )}
                    {isWorkspaceSettingsOpen && (isWorkspaceSettingsDeactivating || isWorkspaceSettingsDeleting) && (
                      <WorkspaceSettingsBusyOverlay aria-live="polite" role="status">
                        <WorkspaceSettingsBusyPanel aria-label={isWorkspaceSettingsDeleting ? "Deleting workspace" : "Deactivating workspace"}>
                          <WorkspaceCloseSpinner aria-hidden="true" />
                          <WorkspaceCloseTitle>
                            {isWorkspaceSettingsDeleting ? "Deleting workspace" : "Deactivating workspace"}
                          </WorkspaceCloseTitle>
                          <WorkspaceCloseDetail>
                            {isWorkspaceSettingsDeleting
                              ? "Stopping workspace services, removing cloud live state, and cleaning Diff Forge metadata."
                              : "Stopping file watchers, terminals, and workspace services before the runtime is released."}
                          </WorkspaceCloseDetail>
                          <WorkspaceCloseCounter>
                            {isWorkspaceSettingsDeleting
                              ? "Project files stay on disk"
                              : workspaceDeactivateTotal > 0
                              ? `${workspaceDeactivateClosed}/${workspaceDeactivateTotal} ${workspaceDeactivateTerminalLabel}`
                              : "Stopping workspace runtime"}
                          </WorkspaceCloseCounter>
                          <WorkspaceCloseProgressTrack aria-hidden="true">
                            <WorkspaceCloseProgressBar $progress={workspaceDeactivateProgress} />
                          </WorkspaceCloseProgressTrack>
                        </WorkspaceSettingsBusyPanel>
                      </WorkspaceSettingsBusyOverlay>
                    )}
                  </WorkspaceCreateLayer>
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
                            onClick={() => selectedWorkspace && requestWorkspaceActivation(selectedWorkspace.id, "settings_page")}
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
                        <PanelKicker>Cloud maintenance</PanelKicker>
                        <PanelHeading>Server state reset</PanelHeading>
                      </div>
                    </PanelHeaderRow>

                    <AccountCard data-tone="orange">
                      <AccountCardHeader>
                        <div>
                          <SettingsLabel>Reset</SettingsLabel>
                          <SettingsValue>Reset server state</SettingsValue>
                          <SettingsHint>
                            Clear cloud runtime state for a repository or workspace while preserving devices, billing, and tokenomics.
                          </SettingsHint>
                        </div>
                        <AgentReadyPill data-tone="orange">
                          {isCloudSqliteResetting ? (
                            <PendingIcon aria-hidden="true" />
                          ) : (
                            <ButtonRefreshIcon aria-hidden="true" />
                          )}
                          <span>{isCloudSqliteResetting ? "Resetting" : "Preserved"}</span>
                        </AgentReadyPill>
                      </AccountCardHeader>

                      <SetupField>
                        <SettingsLabel>Workspace</SettingsLabel>
                        <WorkspaceSettingsSelectShell>
                          <WorkspaceSettingsSelect
                            disabled={isCloudSqliteResetting || cloudSqliteResetWorkspaces.length === 0}
                            onChange={(event) => {
                              setCloudSqliteResetSelectedWorkspaceId(event.target.value);
                              setCloudSqliteResetSelectedRepoKeys({});
                            }}
                            value={cloudSqliteResetWorkspaceId}
                          >
                            {cloudSqliteResetWorkspaces.length === 0 ? (
                              <option value="">No workspaces found</option>
                            ) : cloudSqliteResetWorkspaces.map((workspace) => (
                              <option key={workspace.workspaceId} value={workspace.workspaceId}>
                                {workspace.workspaceName}
                              </option>
                            ))}
                          </WorkspaceSettingsSelect>
                          <WorkspaceSettingsSelectIcon aria-hidden="true" />
                        </WorkspaceSettingsSelectShell>
                        <SettingsHint>
                          {cloudSqliteResetWorkspaceRoot || "Add or sync a workspace to reset its server state."}
                        </SettingsHint>
                      </SetupField>

                      <SetupField>
                        <SettingsLabel>Repositories</SettingsLabel>
                        {cloudSqliteResetRepoCards.length > 0 ? (
                          <SettingsRepoGrid>
                            {cloudSqliteResetRepoCards.map((repoCard) => {
                              const selected = Boolean(cloudSqliteResetSelectedRepoKeys?.[repoCard.key]);
                              return (
                                <SettingsRepoCard
                                  data-selected={selected ? "true" : "false"}
                                  disabled={isCloudSqliteResetting}
                                  key={repoCard.key}
                                  onClick={() => toggleCloudSqliteResetRepoCard(repoCard.key)}
                                  type="button"
                                >
                                  {selected ? <ButtonCheckIcon aria-hidden="true" /> : <ButtonCodeIcon aria-hidden="true" />}
                                  <strong>{repoCard.repoLabel}</strong>
                                  <span>{repoCard.relativePath || repoCard.repoPath}</span>
                                </SettingsRepoCard>
                              );
                            })}
                          </SettingsRepoGrid>
                        ) : (
                          <SettingsHint>
                            No repositories cached for this workspace yet. Open the workspace to refresh the scan.
                          </SettingsHint>
                        )}
                      </SetupField>

                      {cloudSqliteResetError && <FormMessage $state="error">{cloudSqliteResetError}</FormMessage>}
                      {cloudSqliteResetMessage && (
                        <AgentInstallMessage data-tone="success">
                          {cloudSqliteResetMessage}
                        </AgentInstallMessage>
                      )}

                      <AccountCardFooter>
                        <SettingsHint>
                          {cloudSqliteResetSelectedRepoCount > 0
                            ? `${cloudSqliteResetSelectedRepoCount} repositor${cloudSqliteResetSelectedRepoCount === 1 ? "y" : "ies"} selected.`
                            : "Select repository cards to reset repo server state."}
                        </SettingsHint>
                        <PrimaryDangerButton
                          disabled={cloudSqliteRepoResetDisabled}
                          onClick={resetSelectedRepoServerStates}
                          type="button"
                        >
                          {isCloudSqliteRepoResetting ? <PendingIcon aria-hidden="true" /> : <ButtonRefreshIcon aria-hidden="true" />}
                          <span>{isCloudSqliteRepoResetting ? "Resetting..." : "Reset selected repos"}</span>
                        </PrimaryDangerButton>
                      </AccountCardFooter>
                      <AccountCardFooter>
                        <SettingsHint>
                          Workspace reset clears workspace todos and plans; devices, billing, and tokenomics stay preserved.
                        </SettingsHint>
                        <PrimaryDangerButton
                          disabled={cloudSqliteWorkspaceResetDisabled}
                          onClick={resetWorkspaceServerState}
                          type="button"
                        >
                          {isCloudSqliteWorkspaceResetting ? <PendingIcon aria-hidden="true" /> : <ButtonRefreshIcon aria-hidden="true" />}
                          <span>{isCloudSqliteWorkspaceResetting ? "Resetting..." : "Reset workspace state"}</span>
                        </PrimaryDangerButton>
                      </AccountCardFooter>
                      <SetupField>
                        <SettingsLabel>Cloud repos without a workspace</SettingsLabel>
                        {cloudRepoCatalogState === "idle" ? (
                          <SettingsHint>
                            Load the account repo catalog to find cloud repo state that no
                            workspace references, then keep or delete each repo.
                          </SettingsHint>
                        ) : null}
                        {cloudRepoCatalogState === "ready" && cloudOrphanRepos.length === 0 ? (
                          <SettingsHint>
                            All cloud repo state is attached to a workspace.
                          </SettingsHint>
                        ) : null}
                        {cloudOrphanRepos.map((repo) => {
                          const repoId = String(repo?.repo_id || repo?.repoId || "").trim();
                          const repoLabel = String(
                            repo?.git_repo_display_name || repo?.gitRepoDisplayName || repoId,
                          ).trim();
                          const stateTotal = Number(repo?.state_total ?? repo?.stateTotal ?? 0) || 0;
                          const lastWorkspaceName = (Array.isArray(repo?.workspaces) ? repo.workspaces : [])
                            .map((workspace) => String(workspace?.workspace_name || workspace?.workspaceName || "").trim())
                            .find(Boolean);
                          const isBusy = cloudRepoCatalogBusyRepoId === repoId;
                          return (
                            <AccountCardFooter key={repoId}>
                              <SettingsHint>
                                {repoLabel}
                                {lastWorkspaceName ? ` — last seen in "${lastWorkspaceName}"` : ""}
                                {` · ${stateTotal} stored row${stateTotal === 1 ? "" : "s"}`}
                              </SettingsHint>
                              <SecondaryButton
                                disabled={isBusy}
                                onClick={() => dismissOrphanCloudRepo(repoId)}
                                type="button"
                              >
                                <span>Keep</span>
                              </SecondaryButton>
                              <PrimaryDangerButton
                                disabled={Boolean(cloudRepoCatalogBusyRepoId)}
                                onClick={() => deleteOrphanCloudRepo(repo)}
                                type="button"
                              >
                                {isBusy ? <PendingIcon aria-hidden="true" /> : <ButtonRefreshIcon aria-hidden="true" />}
                                <span>{isBusy ? "Deleting..." : "Delete from cloud"}</span>
                              </PrimaryDangerButton>
                            </AccountCardFooter>
                          );
                        })}
                        {cloudRepoCatalogError && <FormMessage $state="error">{cloudRepoCatalogError}</FormMessage>}
                        <AccountCardFooter>
                          <SettingsHint>
                            {cloudRepoCatalogState === "ready"
                              ? `${cloudOrphanRepos.length} unattached repo${cloudOrphanRepos.length === 1 ? "" : "s"} in the cloud.`
                              : "Repos synced to the cloud but missing from every workspace."}
                          </SettingsHint>
                          <SecondaryButton
                            disabled={cloudRepoCatalogState === "loading"}
                            onClick={loadCloudRepoCatalog}
                            type="button"
                          >
                            {cloudRepoCatalogState === "loading" ? <PendingIcon aria-hidden="true" /> : <ButtonRefreshIcon aria-hidden="true" />}
                            <span>{cloudRepoCatalogState === "loading" ? "Loading..." : cloudRepoCatalogState === "ready" ? "Refresh cloud repos" : "Load cloud repos"}</span>
                          </SecondaryButton>
                        </AccountCardFooter>
                      </SetupField>

                      <AccountCardFooter>
                        <SettingsHint>
                          Tokenomics: reset this device only, then resync.
                        </SettingsHint>
                        <PrimaryDangerButton
                          disabled={tokenomicsCloudResetDisabled}
                          onClick={resetCurrentDeviceTokenomicsCloud}
                          type="button"
                        >
                          {isTokenomicsCloudResetting ? <PendingIcon aria-hidden="true" /> : <ButtonRefreshIcon aria-hidden="true" />}
                          <span>{isTokenomicsCloudResetting ? "Resetting..." : "Reset Tokenomics"}</span>
                        </PrimaryDangerButton>
                      </AccountCardFooter>
                      {tokenomicsCloudResetError && <FormMessage $state="error">{tokenomicsCloudResetError}</FormMessage>}
                      {tokenomicsCloudResetMessage && (
                        <AgentInstallMessage data-tone="success">
                          {tokenomicsCloudResetMessage}
                        </AgentInstallMessage>
                      )}
                      <AccountCardFooter>
                        <SettingsHint>
                          Cloud cleanup: delete everything cloud-diffforge stores for this
                          account, then resync it all from this device (local data stays).
                        </SettingsHint>
                        <PrimaryDangerButton
                          disabled={cloudAccountResetState === "resetting"}
                          onClick={resetCloudAccountData}
                          type="button"
                        >
                          {cloudAccountResetState === "resetting" ? <PendingIcon aria-hidden="true" /> : <ButtonRefreshIcon aria-hidden="true" />}
                          <span>{cloudAccountResetState === "resetting" ? "Cleaning up..." : "Clean up cloud account"}</span>
                        </PrimaryDangerButton>
                      </AccountCardFooter>
                      {cloudAccountResetError && <FormMessage $state="error">{cloudAccountResetError}</FormMessage>}
                      {cloudAccountResetMessage && (
                        <AgentInstallMessage data-tone="success">
                          {cloudAccountResetMessage}
                        </AgentInstallMessage>
                      )}
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

                    <AccountCard data-tone={billingLowCreditState === "ok" ? "blue" : "orange"}>
                      <AccountCardHeader>
                        <div>
                          <SettingsLabel>Credits</SettingsLabel>
                          <SettingsValue>
                            {billingCredits ? `${formatCreditCount(billingRemainingCredits)} remaining` : "Checking credits"}
                          </SettingsValue>
                          <SettingsHint>
                            {billingStatusState === "loading"
                              ? "Refreshing current billing term."
                              : billingCredits
                                ? `Current term resets ${billingResetLabel}.`
                                : "Credit status will appear after the account check returns."}
                          </SettingsHint>
                        </div>
                        <AgentReadyPill data-tone={billingLowCreditState === "ok" ? "blue" : "orange"}>
                          {billingStatusState === "loading" ? (
                            <PendingIcon aria-hidden="true" />
                          ) : billingCredits ? (
                            <ButtonCheckIcon aria-hidden="true" />
                          ) : (
                            <ButtonRefreshIcon aria-hidden="true" />
                          )}
                          <span>{billingCredits ? billingLowCreditState : billingStatusState}</span>
                        </AgentReadyPill>
                      </AccountCardHeader>

                      <CreditUsageTrack aria-hidden="true">
                        <CreditUsageFill style={{ width: `${billingCreditPercent}%` }} />
                      </CreditUsageTrack>

                      {billingStatusError && <FormMessage $state="error">{billingStatusError}</FormMessage>}

                      <AccountCardFooter>
                        <SettingsHint>
                          Active and queued cloud AI work uses the same term balance.
                        </SettingsHint>
                        <SecondaryButton
                          disabled={billingStatusState === "loading"}
                          onClick={() => refreshBillingStatus()}
                          type="button"
                        >
                          <ButtonRefreshIcon aria-hidden="true" />
                          <span>{billingStatusState === "loading" ? "Refreshing..." : "Refresh credits"}</span>
                        </SecondaryButton>
                      </AccountCardFooter>
                    </AccountCard>
                  </AccountSettingsPanel>
                </SettingsPage>
              ) : visibleView === "files" ? (
                <ForgeWorkspace aria-label="Workspace files" data-motion={viewMotion} data-surface="files">
                  {shouldShowWorkspaceSetup ? (
                    <WorkspaceCreatePanel
                      agentStatuses={agentStatuses}
                      chooseNativeDirectory={chooseNewWorkspaceRootDirectory}
                      defaultWorkingDirectory={defaultWorkingDirectory}
                      fallbackRole={workspaceTerminalFallbackRole}
                      onClose={null}
                      onSubmit={(event, terminalRoles) => createFirstWorkspace(event, terminalRoles)}
                      roleOptions={workspaceTerminalRoleOptions}
                      rootDraft={newWorkspaceRootDraft}
                      setRootDraft={setNewWorkspaceRootDraft}
                      setWorkspaceName={setWorkspaceName}
                      visible={visibleView === "files"}
                      workspaceError={workspaceError}
                      workspaceName={workspaceName}
                      workspaceSyncState={workspaceSyncState}
                    />
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
              ) : visibleView === "architecture" ? (
                <ForgeWorkspace aria-label="Workspace Architecture" data-motion={viewMotion}>
                  {selectedWorkspace ? (
                    <ArchitectureWorkspaceView
                      defaultWorkingDirectory={defaultWorkingDirectory}
                      rootDirectory={selectedWorkspaceFileRoot}
                      architectureError={selectedWorkspaceGraphState.architectureError || ""}
                      architectureRepositoryScanError={selectedWorkspaceGraphState.architectureRepositoryScanError || ""}
                      architectureRepositoryScanSnapshot={selectedWorkspaceGraphState.architectureRepositoryScanSnapshot || null}
                      architectureRepositoryScanState={selectedWorkspaceGraphState.architectureRepositoryScanState || "idle"}
                      architectureGraphLists={selectedWorkspaceGraphState.architectureGraphLists || {}}
                      architectureSelectedGraphId={selectedWorkspaceGraphState.architectureSelectedGraphId || ""}
                      architectureSelectedRepoPath={selectedWorkspaceGraphState.architectureSelectedRepoPath || ""}
                      architectureSnapshot={selectedWorkspaceGraphState.architectureSnapshot || null}
                      architectureState={selectedWorkspaceGraphState.architectureState || "idle"}
                      onArchitectureGraphListRefresh={refreshSelectedWorkspaceArchitectureGraphList}
                      onArchitectureSelectionChange={updateSelectedWorkspaceArchitectureSelection}
                      workspace={selectedWorkspace}
                      workspaceTerminalOptions={selectedWorkspaceTerminalOptions}
                      workspaceTodos={cloudWorkspaceProgress.workspaceTodos}
                    />
                  ) : (
                    <WorkspaceIdleState detail="Select a workspace to view task history." viewMotion={viewMotion} />
                  )}
                </ForgeWorkspace>
              ) : GLOBAL_TOOLS_VIEWS.has(visibleView) ? (
                <ForgeWorkspace aria-label="Global toolkit" data-motion={viewMotion}>
                  <ToolsWorkspaceView
                    architectures={{
                      catalog: architectureHub.catalog,
                      catalogError: architectureHub.error,
                      catalogState: architectureHub.state,
                      graphLists: architectureHubGraphLists,
                      onCopyGraph: copyArchitectureHubGraph,
                      onGraphListRefresh: refreshArchitectureHubGraphList,
                      onRefreshCatalog: refreshArchitectureHubCatalog,
                      onSelectionChange: updateArchitectureHubSelection,
                      resolveRepoSyncContext: resolveArchitectureHubSyncContext,
                      selectedGraphId: architectureHubGraphState.architectureSelectedGraphId,
                      selectedRepoPath: architectureHubGraphState.architectureSelectedRepoPath,
                    }}
                    defaultWorkingDirectory={defaultWorkingDirectory}
                    initialSection={visibleView === "mcps" ? "mcps" : "architectures"}
                    workspaces={assetWorkspaceOptions}
                  />
                </ForgeWorkspace>
              ) : visibleView === "assets" ? (
                <ForgeWorkspace aria-label="Account Assets" data-motion={viewMotion}>
                  <AccountAssetsView
                    assetWorkspaces={assetWorkspaceOptions}
                    defaultWorkingDirectory={defaultWorkingDirectory}
                    error={accountAssetsLibrary.error}
                    library={accountAssetsLibrary.library}
                    loading={accountAssetsLibrary.loading}
                    onLoadCached={accountAssetsLibrary.loadCached}
                    onRefresh={accountAssetsLibrary.refresh}
                    syncing={accountAssetsLibrary.syncing}
                    untrackedError={untrackedAssetsLibrary.error}
                    untrackedLibrary={untrackedAssetsLibrary.library}
                    untrackedLoading={untrackedAssetsLibrary.loading}
                    untrackedSyncing={untrackedAssetsLibrary.syncing}
                    onUntrackedDelete={untrackedAssetsLibrary.deleteAsset}
                    onUntrackedPromote={untrackedAssetsLibrary.promoteAsset}
                    onUntrackedRefresh={untrackedAssetsLibrary.refresh}
                    onUntrackedRename={untrackedAssetsLibrary.renameAsset}
                  />
                </ForgeWorkspace>
              ) : visibleView === "tokenomics" ? (
                <ForgeWorkspace aria-label="Account Tokenomics" data-motion={viewMotion}>
                  <AccountTokenomicsView
                    accountKey={user?.id || user?.email || ""}
                    billingStatus={billingStatus}
                    storageUsage={cloudWorkspaceProgress.storageUsage}
                  />
                </ForgeWorkspace>
              ) : visibleView === "processes" ? (
                <ForgeWorkspace aria-label="Processes" data-motion={viewMotion}>
                  <ProcessesView
                    onCloseTrackedTerminal={closeTrackedProcessTerminal}
                    workspaceRoots={processKnownRoots}
                  />
                </ForgeWorkspace>
              ) : visibleView === "snipping" ? (
                <ForgeWorkspace aria-label="Snipping" data-motion={viewMotion}>
                  <SnippingWorkspaceView
                    untrackedLibrary={untrackedAssetsLibrary.library}
                    untrackedLoading={untrackedAssetsLibrary.loading || untrackedAssetsLibrary.syncing}
                    onUntrackedRefresh={untrackedAssetsLibrary.refresh}
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
              ) : (
                null
              )}
                </WorkspaceViewPane>
                {shouldShowWorkspaceGitPullPrompt && (
                  <WorkspaceGitPullOverlay aria-label="Git pull prompt">
                    <WorkspaceGitPullDialog
                      aria-busy={isWorkspaceGitPullPromptBusy}
                      aria-labelledby="workspace-git-pull-title"
                      aria-modal="true"
                      role="dialog"
                    >
                      <WorkspaceGitPullHeader>
                        <div>
                          <PanelKicker>Git updates</PanelKicker>
                          <PanelHeading id="workspace-git-pull-title">Pull latest changes?</PanelHeading>
                        </div>
                        <AgentReadyPill data-tone="blue">
                          {isWorkspaceGitPullPromptBusy ? (
                            <PendingIcon aria-hidden="true" />
                          ) : (
                            <ButtonRefreshIcon aria-hidden="true" />
                          )}
                          <span>
                            {workspaceGitPullPrompt.repositories.length} repo{workspaceGitPullPrompt.repositories.length === 1 ? "" : "s"}
                          </span>
                        </AgentReadyPill>
                      </WorkspaceGitPullHeader>

                      <WorkspaceGitPullSummary>
                        <span>
                          {workspaceGitPullSelectedCount} selected for fast-forward pull.
                        </span>
                        {workspaceGitPullPrompt.blockedCount > 0 && (
                          <span>
                            {workspaceGitPullPrompt.blockedCount} repo{workspaceGitPullPrompt.blockedCount === 1 ? "" : "s"} need manual review.
                          </span>
                        )}
                      </WorkspaceGitPullSummary>

                      {workspaceGitPullPrompt.error && (
                        <FormMessage $state="error">{workspaceGitPullPrompt.error}</FormMessage>
                      )}

                      <WorkspaceGitPullList aria-label="Repositories available to pull">
                        {workspaceGitPullPrompt.repositories.map((repository) => {
                          const selected = Boolean(workspaceGitPullPrompt.selected?.[repository.path]);
                          const label = repository.relativePath || repository.name;

                          return (
                            <WorkspaceGitPullRow data-selected={selected ? "true" : undefined} key={repository.path}>
                              <input
                                checked={selected}
                                disabled={isWorkspaceGitPullPromptBusy}
                                onChange={() => toggleWorkspaceGitPullRepository(repository.path)}
                                type="checkbox"
                              />
                              <div>
                                <strong>{label}</strong>
                                <WorkspaceGitPullRepoMeta>
                                  <span>{repository.branch || "branch"}</span>
                                  {repository.upstream && <span>{repository.upstream}</span>}
                                  <span>{repository.behind} behind</span>
                                </WorkspaceGitPullRepoMeta>
                                {repository.reason && <small>{repository.reason}</small>}
                              </div>
                            </WorkspaceGitPullRow>
                          );
                        })}
                      </WorkspaceGitPullList>

                      <WorkspaceGitPullActions>
                        <SecondaryButton
                          disabled={isWorkspaceGitPullPromptBusy}
                          onClick={skipWorkspaceGitPullPrompt}
                          type="button"
                        >
                          <ButtonCloseIcon aria-hidden="true" />
                          <span>Skip</span>
                        </SecondaryButton>
                        <PrimaryButton
                          disabled={isWorkspaceGitPullPromptBusy || workspaceGitPullSelectedCount === 0}
                          onClick={pullSelectedWorkspaceGitRepositories}
                          type="button"
                        >
                          {isWorkspaceGitPullPromptBusy ? (
                            <PendingIcon aria-hidden="true" />
                          ) : (
                            <ButtonRefreshIcon aria-hidden="true" />
                          )}
                          <span>
                            {isWorkspaceGitPullPromptBusy
                              ? "Pulling..."
                              : `Pull selected (${workspaceGitPullSelectedCount})`}
                          </span>
                        </PrimaryButton>
                      </WorkspaceGitPullActions>
                    </WorkspaceGitPullDialog>
                  </WorkspaceGitPullOverlay>
                )}
              </WorkspaceViewStack>
              </DashboardShell>
              {lowCreditToastVisible && (
                <LowCreditWarningToast role="status" aria-live="polite">
                  <LowCreditWarningCopy>
                    <SettingsLabel>Credits</SettingsLabel>
                    <SettingsValue>
                      {billingLowCreditState === "exhausted"
                        ? "Cloud credits exhausted"
                        : "Cloud credits running low"}
                    </SettingsValue>
                    <SettingsHint>
                      {formatCreditCount(billingRemainingCredits)} credits remain this term.
                    </SettingsHint>
                  </LowCreditWarningCopy>
                  <LowCreditWarningActions>
                    <SecondaryButton onClick={() => refreshBillingStatus({ quiet: true })} type="button">
                      <ButtonRefreshIcon aria-hidden="true" />
                      <span>Refresh</span>
                    </SecondaryButton>
                    <SecondaryButton onClick={dismissLowCreditWarning} type="button">
                      <ButtonCloseIcon aria-hidden="true" />
                      <span>Close</span>
                    </SecondaryButton>
                  </LowCreditWarningActions>
                </LowCreditWarningToast>
              )}
              {isWorkspaceStartupOverlayVisible && (
                <WorkspaceStartupOverlay aria-label={`${BRAND_NAME} is initializing workspace`}>
                  <AmbientPanel data-position="left">
                    <span>&gt; workspace</span>
                    <p>{cloudWorkspaceTitle}</p>
                    <p>{cloudWorkspaceReady ? "Cloud connected" : "Waiting for live workspace"}</p>
                  </AmbientPanel>
                  <AmbientPanel data-position="right">
                    <span>{displayName}</span>
                    <p>{cloudWorkspaceReady ? "Cloud connected" : "Cloud connecting"}</p>
                    <p>{startupAgentGateState === "complete" ? "Terminals checked" : "Checking terminals"}</p>
                  </AmbientPanel>
                  <SplashCenter>
                    <SplashLogo src="/logo.webp" alt="" />
                    <SplashTitle>Welcome back</SplashTitle>
                    <SplashTagline>{displayName}</SplashTagline>
                    <LoadingTrack aria-hidden="true">
                      <LoadingFill />
                    </LoadingTrack>
                    {(shouldShowCloudWorkspaceSetup || shouldShowStartupAgentSetup) && (
                      <WorkspaceStartupDetails data-phase={shouldShowStartupAgentSetup ? "agents" : "cloud"}>
                        {shouldShowCloudWorkspaceSetup && (
                          <>
                            <LaunchStatusPanel data-state={cloudWorkspaceStatusState}>
                              <LaunchStatusIcon aria-hidden="true" data-state={cloudWorkspaceStatusState}>
                                {cloudWorkspaceReady ? (
                                  <ConnectedIcon />
                                ) : cloudWorkspaceStatusState === "warning" ? (
                                  <ErrorIcon />
                                ) : (
                                  <PendingIcon />
                                )}
                              </LaunchStatusIcon>
                              <LaunchStatusCopy>
                                <LoadingText>{cloudWorkspaceTitle}</LoadingText>
                                <LoadingDetail>{cloudWorkspaceDetail}</LoadingDetail>
                              </LaunchStatusCopy>
                            </LaunchStatusPanel>
                            <AuthStepRail aria-label="Cloud workspace setup checkpoints" data-compact="true">
                              {CLOUD_WORKSPACE_STEPS.map((step, index) => {
                                const stepState = stepStateFor(
                                  CLOUD_WORKSPACE_STEPS,
                                  cloudWorkspaceProgress.stage,
                                  cloudWorkspaceProgress.status,
                                  index,
                                );

                                return (
                                  <AuthStep data-state={stepState} key={step.id}>
                                    <span>{stepState === "complete" ? <ButtonCheckIcon aria-hidden="true" /> : index + 1}</span>
                                    <strong>{step.label}</strong>
                                    <small>
                                      {step.id === cloudWorkspaceProgress.stage ? cloudWorkspaceDetail : step.detail}
                                    </small>
                                  </AuthStep>
                                );
                              })}
                            </AuthStepRail>
                          </>
                        )}
                        {shouldShowStartupAgentSetup && (
                          <>
                            <LaunchStatusPanel data-state={startupAgentStatusState}>
                              <LaunchStatusIcon aria-hidden="true" data-state={startupAgentStatusState}>
                                {startupAgentGateState === "choice" ? (
                                  <ButtonRefreshIcon />
                                ) : startupAgentGateState === "checking" || startupAgentGateState === "updating" || startupAgentGateState === "idle" ? (
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
                          </>
                        )}
                      </WorkspaceStartupDetails>
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
                      {AUTH_STEPS.map((step, index) => {
                        const stepState = stepStateFor(
                          AUTH_STEPS,
                          authCurrentStage,
                          authError ? "error" : "active",
                          index,
                        );

                        return (
                          <AuthStep data-state={stepState} key={step.id}>
                            <span>{stepState === "complete" ? <ButtonCheckIcon aria-hidden="true" /> : index + 1}</span>
                            <strong>{step.label}</strong>
                            <small>{step.id === authCurrentStage ? authMessage : step.detail}</small>
                          </AuthStep>
                        );
                      })}
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

        {appCloseConfirmState.isOpen && (
          <CrashRecoveryOverlay>
            <CrashRecoveryDialog
              aria-labelledby="app-close-confirm-title"
              aria-modal="true"
              role="dialog"
            >
              <WorkspaceSettingsDialogHeader>
                <WorkspaceSettingsHeaderMain>
                  <PanelKicker>Shutdown check</PanelKicker>
                  <PanelHeading id="app-close-confirm-title">
                    {appCloseConfirmState.error ? "Confirm shutdown" : "Terminals still active"}
                  </PanelHeading>
                </WorkspaceSettingsHeaderMain>
                <WorkspaceSettingsHeaderActions>
                  <WorkspaceModalCloseButton
                    aria-label="Cancel shutdown"
                    onClick={cancelAppCloseConfirmation}
                    type="button"
                  >
                    <ButtonCloseIcon aria-hidden="true" />
                  </WorkspaceModalCloseButton>
                </WorkspaceSettingsHeaderActions>
              </WorkspaceSettingsDialogHeader>

              <CrashRecoveryIntro>
                {appCloseConfirmState.error ? (
                  <p>{appCloseConfirmState.error}</p>
                ) : (
                  <p>
                    {appCloseConfirmState.blockingCount} {appCloseConfirmTerminalLabel} across{" "}
                    {appCloseConfirmState.workspaces.length} {appCloseConfirmWorkspaceLabel} are not idle.
                  </p>
                )}
                <p>Shutting down now will stop those terminal processes.</p>
              </CrashRecoveryIntro>

              {!appCloseConfirmState.error && (
                <CrashRecoveryList>
                  {appCloseConfirmState.workspaces.map((workspace) => (
                    <CrashRecoveryItem key={workspace.workspaceId || workspace.repoPath || workspace.workspaceName}>
                      <CrashRecoveryItemTitle>
                        {workspace.workspaceName}
                      </CrashRecoveryItemTitle>
                      <CrashRecoveryItemBody>
                        {workspace.terminals.length} non-idle {workspace.terminals.length === 1 ? "terminal" : "terminals"}
                      </CrashRecoveryItemBody>
                      {workspace.terminals.map((terminal) => (
                        <CrashRecoveryMeta key={`${terminal.paneId}:${terminal.instanceId}`}>
                          <span>{terminal.terminalLabel}</span>
                          <span>{terminal.agentLabel}</span>
                          <span>{terminal.riskLabel}</span>
                          {(terminal.activeTaskTitle || terminal.parkedPromptTitle || terminal.nativeRailLabel) && (
                            <span>
                              {terminal.activeTaskTitle
                                || terminal.parkedPromptTitle
                                || terminal.nativeRailLabel}
                            </span>
                          )}
                        </CrashRecoveryMeta>
                      ))}
                    </CrashRecoveryItem>
                  ))}
                </CrashRecoveryList>
              )}

              <CrashRecoveryActions>
                <SecondaryButton onClick={cancelAppCloseConfirmation} type="button">
                  <ButtonCloseIcon aria-hidden="true" />
                  <span>Cancel</span>
                </SecondaryButton>
                <PrimaryDangerButton onClick={continueAppCloseAfterConfirmation} type="button">
                  <ButtonCheckIcon aria-hidden="true" />
                  <span>Shut down anyway</span>
                </PrimaryDangerButton>
              </CrashRecoveryActions>
            </CrashRecoveryDialog>
          </CrashRecoveryOverlay>
        )}

        {workspaceCloseState.isActive && (
          <WorkspaceCloseOverlay aria-live="polite" role="status">
            <WorkspaceClosePanel aria-label="Closing workspace">
              <WorkspaceCloseSpinner aria-hidden="true" />
              <WorkspaceCloseTitle>{workspaceClosePhaseLabel}</WorkspaceCloseTitle>
              <WorkspaceCloseDetail>
                {workspaceClosePhaseDetail}
              </WorkspaceCloseDetail>
              <WorkspaceCloseCounter>
                {workspaceCloseCounterText}
              </WorkspaceCloseCounter>
              <WorkspaceCloseSteps aria-label="Shutdown sequence">
                {WORKSPACE_SHUTDOWN_STEPS.map((step, index) => {
                  const isComplete = index < workspaceClosePhaseIndex || workspaceClosePhaseId === "exiting";
                  const isActive = step.id === workspaceClosePhaseId && !isComplete;
                  const state = isComplete ? "complete" : isActive ? "active" : "pending";
                  const meta = isComplete
                    ? "Done"
                    : isActive
                      ? step.id === "closing_terminals" && workspaceCloseTotalKnown
                        ? workspaceCloseTotal > 0
                          ? `${workspaceCloseClosed}/${workspaceCloseTotal}`
                          : "None"
                        : "Now"
                      : "Next";

                  return (
                    <WorkspaceCloseStep data-state={state} key={step.id}>
                      <WorkspaceCloseStepDot aria-hidden="true" />
                      <WorkspaceCloseStepCopy>
                        <WorkspaceCloseStepLabel>{step.label}</WorkspaceCloseStepLabel>
                        <WorkspaceCloseStepMeta>{meta}</WorkspaceCloseStepMeta>
                      </WorkspaceCloseStepCopy>
                    </WorkspaceCloseStep>
                  );
                })}
              </WorkspaceCloseSteps>
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

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
import { closeWorkspaceTerminalPane, getDefaultTerminalIndexes, getTerminalPanelRows, normalizeWorkspaceTerminalIndexes } from "../terminals/WorkspaceTerminal.jsx";
import {
  persistTerminalStabilityRuntimeEnabled,
  readTerminalStabilityRuntimeEnabled,
} from "../terminals/terminalStabilityRecovery.jsx";
import TerminalView from "../terminals/TerminalView.jsx";
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
  RailGlobalActions,
  RailActionButton,
  WorkspaceViewStack,
  WorkspaceViewPane,
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
  FileDocumentIcon,
  VIEW_TRANSITION_MS
} from "./appStyles";
import McpsWorkspaceView from "../mcps/McpsWorkspaceView.jsx";
import FilesWorkspaceView, { getDirectoryName } from "../files/FilesWorkspaceView.jsx";
import SpecGraphWorkspaceView from "../specGraph/SpecGraphWorkspaceView.jsx";
import AudioWorkspaceView, { AudioWidgetWindow, AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT, AUDIO_WIDGET_HASH, AUDIO_WIDGET_VISIBILITY_CHANGED_EVENT } from "../audio/AudioWorkspaceView.jsx";


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
const WORKSPACE_TERMINAL_PANE_PREFIX = "workspace-terminal";
const TERMINAL_CLOSE_ALL_PROGRESS_EVENT = "forge-terminal-close-all-progress";
const AGENT_STATUS_CACHE_KEY = "diffforge.agentStatuses.v1";
const AGENT_STATUS_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const WORKSPACE_SETTINGS_STORAGE_KEY = "diffforge.workspaceSettings.v1";
const WORKSPACE_LIFECYCLE_STORAGE_KEY = "diffforge.workspaceLifecycle.v1";
const FILE_EXPLORER_LAYOUT_STORAGE_KEY = "diffforge.fileExplorerLayout.v1";
const FILE_EXPLORER_DEFAULT_SIZE = 28;
const FILE_EXPLORER_MIN_SIZE = 16;
const FILE_EXPLORER_MAX_SIZE = 76;
const FILE_PREVIEW_DEFAULT_SIZE = 72;
const FILE_PREVIEW_MIN_SIZE = 24;
const FILE_PREVIEW_MAX_SIZE = 84;
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
const WORKSPACE_CLOSE_NATIVE_EXIT_TIMEOUT_MS = 18000;
const WORKSPACE_DEACTIVATE_RUNTIME_TIMEOUT_MS = 30000;
const WORKSPACE_SETTINGS_TERMINAL_CLEANUP_TIMEOUT_MS = 18000;
const WORKSPACE_SHARED_MCP_TIMEOUT_MS = 8000;
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
}));

function getDefaultAgentStatus(providerId) {
  return DEFAULT_AGENT_STATUSES.find((status) => status.id === providerId);
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

function AuthSquareBackdrop() {
  return (
    <SquareField aria-hidden="true">
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

async function closeWorkspaceWindowAfterTerminalShutdown(appWindow) {
  try {
    await withTimeout(
      invoke("close_app_after_terminal_shutdown"),
      WORKSPACE_CLOSE_NATIVE_EXIT_TIMEOUT_MS,
      "Native app exit timed out.",
    );
    return;
  } catch {
  }

  let closeSucceeded = false;

  try {
    await withTimeout(
      appWindow.close(),
      WORKSPACE_CLOSE_WINDOW_TIMEOUT_MS,
      "Window close timed out.",
    );
    closeSucceeded = true;
  } catch (closeError) {

    if (typeof appWindow.destroy !== "function") {
      throw closeError;
    }
  }

  if (typeof appWindow.destroy !== "function") {
    if (closeSucceeded) {
      return;
    }

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

function normalizeWorkspaceLifecycleSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { defaultWorkspaceId: "" };
  }

  return {
    defaultWorkspaceId: typeof value.defaultWorkspaceId === "string"
      ? value.defaultWorkspaceId.trim()
      : "",
  };
}

function readWorkspaceLifecycleSettings() {
  try {
    return normalizeWorkspaceLifecycleSettings(
      JSON.parse(window.localStorage.getItem(WORKSPACE_LIFECYCLE_STORAGE_KEY) || "{}"),
    );
  } catch {
    return { defaultWorkspaceId: "" };
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

function findWorkspaceById(workspaces, workspaceId) {
  return workspaces.find((workspace) => workspace.id === workspaceId) || null;
}

function getWorkspaceRootDirectory(workspaceSettings, workspaceId) {
  return cleanWorkspaceRootDirectory(workspaceSettings?.[workspaceId]?.rootDirectory);
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
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [workspaceSyncState, setWorkspaceSyncState] = useState("idle");
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState("");
  const [workspaceTerminalCountDraft, setWorkspaceTerminalCountDraft] = useState("1");
  const [workspaceTerminalRolesDraft, setWorkspaceTerminalRolesDraft] = useState(["codex"]);
  const [workspaceSettings, setWorkspaceSettings] = useState(readWorkspaceSettings);
  const [workspaceLifecycleSettings, setWorkspaceLifecycleSettings] = useState(readWorkspaceLifecycleSettings);
  const [terminalStabilityRuntimeEnabled, setTerminalStabilityRuntimeEnabled] =
    useState(readTerminalStabilityRuntimeEnabled);
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
  const viewTransitionTimeoutRef = useRef(null);
  const agentStatusCacheHitRef = useRef(agentStatuses.some((agent) => agent.cached));
  const agentInitialStatusUserRef = useRef("");
  const startupAgentFlowIdRef = useRef(0);
  const startupAgentSettingsPendingRef = useRef(false);
  const audioAutoOpenStartupKeyRef = useRef("");
  const selectedWorkspaceIdRef = useRef("");
  const activatedWorkspaceIdRef = useRef("");
  const workspaceSettingsRef = useRef(workspaceSettings);
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
  const workspaceDeactivationInFlightRef = useRef("");
  const workspaceRuntimeDeactivatedRepoRef = useRef("");
  const workspaceTerminalRoleOptions = useMemo(
    () => getWorkspaceTerminalRoleOptions(agentStatuses),
    [agentStatuses],
  );
  const workspaceTerminalFallbackRole = getWorkspaceTerminalFallbackRole(
    workspaceTerminalRoleOptions,
    activeAgent,
  );
  const workspaceCloseAllowNativeRef = useRef(false);

  useEffect(() => {
    selectedWorkspaceIdRef.current = selectedWorkspaceId;
  }, [selectedWorkspaceId]);

  useEffect(() => {
    activatedWorkspaceIdRef.current = activatedWorkspaceId;
  }, [activatedWorkspaceId]);

  useEffect(() => {
    workspaceSettingsRef.current = workspaceSettings;
  }, [workspaceSettings]);

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

    updateWorkspaceLifecycleSettings({ defaultWorkspaceId: nextDefaultWorkspaceId });
  }, [updateWorkspaceLifecycleSettings, workspaces]);

  const toggleTerminalStabilityRuntime = useCallback(() => {
    setTerminalStabilityRuntimeEnabled((currentEnabled) => (
      persistTerminalStabilityRuntimeEnabled(!currentEnabled)
    ));
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

    setSelectedWorkspaceId(workspace.id);
    setActivatedWorkspaceId(workspace.id);

    if (previousActivatedWorkspaceId && previousActivatedWorkspaceId !== workspace.id) {
      clearPreparedWorkspaceTerminals(previousActivatedWorkspaceId);
    }

    if (previousActivatedWorkspaceId !== workspace.id) {
      workspaceAgentLaunchKeyRef.current = "";
      workspaceAgentBatchInFlightKeyRef.current = "";
      setWorkspaceAgentBatchSentKey("");
    }

  }, [activeView, clearPreparedWorkspaceTerminals, visibleView, workspaces]);

  const activateWorkspaceFromRail = useCallback((workspaceId) => {
    activateWorkspace(workspaceId, "workspace_click");
    showView(DEFAULT_WORKSPACE_VIEW, {
      telemetrySource: "workspace_click_terminal_focus",
      telemetryWorkspaceId: workspaceId,
    });
  }, [activateWorkspace, showView]);

  const deactivateWorkspace = useCallback(async (workspaceId, source = "manual") => {
    const targetWorkspaceId = workspaceId || activatedWorkspaceIdRef.current;

    if (!targetWorkspaceId || activatedWorkspaceIdRef.current !== targetWorkspaceId) {
      return;
    }

    if (workspaceDeactivationInFlightRef.current) {
      return;
    }

    const runtimeRepoPath = getWorkspaceRootDirectory(workspaceSettingsRef.current, targetWorkspaceId)
      || defaultWorkingDirectory;
    const expectedTerminalTotal = normalizeCloseCount(workspaceCloseExpectedTotalRef.current);
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

      if (activatedWorkspaceIdRef.current === targetWorkspaceId) {
        setActivatedWorkspaceId("");
      }

      workspaceDeactivationInFlightRef.current = "";
      setWorkspaceDeactivationState(WORKSPACE_DEACTIVATION_INITIAL_STATE);
    }
  }, [clearPreparedWorkspaceTerminals, defaultWorkingDirectory]);

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
      setAgentStatusState("idle");
      return nextStatuses;
    } catch (error) {
      setAgentStatusState("error");
      setAgentStatusError(getErrorMessage(error, "Unable to check terminal CLIs."));
      return null;
    }
  }, []);

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
      setAgentStatuses((statuses) => statuses.map((agent) => (
        agent.id === provider
          ? {
            ...agent,
            authenticated: false,
            authMessage: result?.message || `${agent.label} disconnected from this machine.`,
          }
          : agent
      )));
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
  }, []);

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
      const configuredDefaultWorkspaceId = workspaceLifecycleSettingsRef.current.defaultWorkspaceId;
      const defaultWorkspace = findWorkspaceById(nextWorkspaces, configuredDefaultWorkspaceId);
      const nextDefaultWorkspaceId = defaultWorkspace?.id || "";
      const nextSelected = findWorkspaceById(nextWorkspaces, currentSelectedId) || defaultWorkspace;
      const nextActivated = findWorkspaceById(nextWorkspaces, currentActivatedId) || defaultWorkspace;

      if (configuredDefaultWorkspaceId && !nextDefaultWorkspaceId) {
        const nextLifecycleSettings = normalizeWorkspaceLifecycleSettings({
          ...workspaceLifecycleSettingsRef.current,
          defaultWorkspaceId: "",
        });

        workspaceLifecycleSettingsRef.current = nextLifecycleSettings;
        persistWorkspaceLifecycleSettings(nextLifecycleSettings);
        setWorkspaceLifecycleSettings(nextLifecycleSettings);
      }


      if (nextActivated) {
      }

      setWorkspaces(nextWorkspaces);
      setSelectedWorkspaceId((currentSelectedId) => {
        const nextSelected = findWorkspaceById(nextWorkspaces, currentSelectedId) || defaultWorkspace;

        return nextSelected?.id || "";
      });
      setActivatedWorkspaceId((currentActivatedId) => {
        const nextActivated = findWorkspaceById(nextWorkspaces, currentActivatedId) || defaultWorkspace;

        return nextActivated?.id || "";
      });

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
              waitForCleanup: true,
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

  const closeWorkspaceTerminal = useCallback(({ workspaceId, terminalIndex }) => {
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

    let removedTerminalIndex = terminalIndex;
    let nextIndexes = currentIndexes.filter((index) => index !== terminalIndex);

    if (nextIndexes.length === currentIndexes.length) {
      removedTerminalIndex = currentIndexes[currentIndexes.length - 1];
      nextIndexes = currentIndexes.slice(0, -1);
    }

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

  const changeWorkspaceTerminalRole = useCallback(({ role, terminalIndex, workspaceId }) => {
    if (!workspaceId) {
      return;
    }

    const nextRole = normalizeWorkspaceTerminalRole(
      role,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    const terminalCount = getWorkspaceTerminalCount(workspaceSettings, workspaceId);
    const currentIndexes = getWorkspaceLogicalTerminalIndexes(
      workspaceTerminalLogicalIndexes,
      workspaceId,
      terminalCount,
    );
    const roleIndex = currentIndexes.indexOf(terminalIndex);

    if (roleIndex < 0) {
      return;
    }

    const currentRoles = getWorkspaceTerminalRoles(
      workspaceSettings,
      workspaceId,
      terminalCount,
      workspaceTerminalFallbackRole,
      workspaceTerminalRoleOptions,
    );
    const previousRole = currentRoles[roleIndex] || workspaceTerminalFallbackRole;

    if (previousRole === nextRole) {
      return;
    }

    const nextRoles = currentRoles.slice();
    nextRoles[roleIndex] = nextRole;

    setWorkspaceSettings((settings) => {
      const nextSettings = updateWorkspaceLocalSettings(settings, workspaceId, {
        terminalRoles: nextRoles,
      });

      persistWorkspaceSettings(nextSettings);
      return nextSettings;
    });

    if (workspaceSettingsModalId === workspaceId) {
      setWorkspaceTerminalRolesDraft(nextRoles);
    }

    closeWorkspaceTerminalPane({
      agentId: getWorkspaceTerminalPaneAgentId(previousRole),
      nextTerminalCount: terminalCount,
      previousTerminalCount: terminalCount,
      reason: "terminal_role_switch",
      terminalIndex,
      workspaceId,
    });
  }, [
    workspaceSettings,
    workspaceSettingsModalId,
    workspaceTerminalFallbackRole,
    workspaceTerminalRoleOptions,
    workspaceTerminalLogicalIndexes,
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

    if (event.detail === 2) {
      toggleWindowSize();
      return;
    }

    runWindowAction(() => getSafeCurrentWindow()?.startDragging());
  }, [toggleWindowSize]);

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

    if (workspaceCloseInFlightRef.current) {
      return;
    }

    const appWindow = getSafeCurrentWindow();

    if (!appWindow) {
      return;
    }

    workspaceCloseInFlightRef.current = true;
    workspaceCloseAllowNativeRef.current = false;
    const expectedTerminalTotal = normalizeCloseCount(workspaceCloseExpectedTotalRef.current);
    setWorkspaceCloseState({ isActive: true, closed: 0, total: expectedTerminalTotal });

    runWindowAction(async () => {
      let unlistenCloseProgress = null;

      try {
        unlistenCloseProgress = await listen(TERMINAL_CLOSE_ALL_PROGRESS_EVENT, (progressEvent) => {
          const nextProgress = normalizeTerminalCloseProgress(progressEvent.payload);

          setWorkspaceCloseState((currentCloseState) => {
            const currentProgress = normalizeTerminalCloseProgress(currentCloseState);

            return {
              isActive: true,
              closed: Math.max(currentProgress.closed, nextProgress.closed),
              total: Math.max(currentProgress.total, nextProgress.total),
            };
          });
        });
      } catch {
        // Missing progress events should not block the close sequence.
      }

      try {
        workspaceCloseAllowNativeRef.current = true;
        await closeWorkspaceWindowAfterTerminalShutdown(appWindow);
      } catch (closeError) {
        workspaceCloseAllowNativeRef.current = false;
        workspaceCloseInFlightRef.current = false;
        setWorkspaceCloseState(WORKSPACE_CLOSE_INITIAL_STATE);
      } finally {
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
  const hasSelectedWorkspace = Boolean(selectedWorkspace);
  const isSelectedWorkspaceActivated = Boolean(selectedWorkspace && activatedWorkspace?.id === selectedWorkspace.id);
  const isSelectedWorkspaceDefault = Boolean(
    selectedWorkspace && workspaceLifecycleSettings.defaultWorkspaceId === selectedWorkspace.id,
  );
  const defaultWorkspace = findWorkspaceById(workspaces, workspaceLifecycleSettings.defaultWorkspaceId);
  const isWorkspaceSettingsOpen = Boolean(workspaceSettingsModalId && selectedWorkspace);
  const isWorkspaceSettingsDeactivating = Boolean(
    workspaceDeactivationState.isActive
      && selectedWorkspace
      && workspaceDeactivationState.workspaceId === selectedWorkspace.id,
  );
  const isWorkspaceSettingsBusy = workspaceSettingsState === "saving" || isWorkspaceSettingsDeactivating;
  const selectedWorkspaceIdForSpecSync = selectedWorkspace?.id || "";
  const selectedWorkspaceNameForSpecSync = selectedWorkspace?.name || "";

  useEffect(() => {
    const repoPath = selectedWorkspaceFileRoot;
    if (!repoPath || !selectedWorkspaceIdForSpecSync) {
      return undefined;
    }

    let cancelled = false;
    let syncGeneration = null;
    const stopSync = () => {
      if (!syncGeneration) return;
      invoke("cloud_mcp_stop_spec_graph_sync", { repoPath, syncGeneration }).catch(() => {});
    };

    invoke("cloud_mcp_start_spec_graph_sync", {
      repoPath,
      workspaceId: selectedWorkspaceIdForSpecSync || null,
      workspaceName: selectedWorkspaceNameForSpecSync || null,
    })
      .then((result) => {
        syncGeneration = Number(result?.syncGeneration) || null;
        if (cancelled) {
          stopSync();
        }
      })
      .catch((error) => {
      });

    return () => {
      cancelled = true;
      stopSync();
    };
  }, [
    selectedWorkspaceFileRoot,
    selectedWorkspaceIdForSpecSync,
    selectedWorkspaceNameForSpecSync,
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
      .map((session) => ({
        instanceId: session.instanceId,
        model: "",
        paneId: session.paneId,
        provider: session.agentId,
        workspaceId: activatedWorkspace.id,
      }));
  }, [
    activeAgent,
    activatedWorkspace?.id,
    activatedWorkspaceAgentTerminalEntries,
    preparedTerminalVersion,
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

    invoke("terminal_start_agent_many", { requests: preparedWorkspaceTerminalRequests })
      .then((result) => {
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
  const isWindowExpanded = windowFrameState.isFullscreen || windowFrameState.isMaximized;
  const windowResizeLabel = isWindowExpanded ? "Restore" : "Maximize";
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
      <AppFrame>
        <WindowTitleBar data-tauri-drag-region onMouseDown={handleTitleBarMouseDown}>
          <WindowTitle data-tauri-drag-region>
            <img src="/logo.webp" alt="" />
            <span>{BRAND_NAME}</span>
          </WindowTitle>
          <WindowControls aria-label="Window controls">
            <WindowControlButton
              aria-label="Minimize"
              data-window-control
              onClick={minimizeWindow}
              title="Minimize"
              type="button"
            >
              <TitleMinimizeIcon aria-hidden="true" />
            </WindowControlButton>
            <WindowControlButton
              aria-label={windowResizeLabel}
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
                data-startup={isWorkspaceStartupOverlayVisible}
              >
              <WorkspaceRail aria-label="Workspace navigation">
                <RailTop>
                  <RailSectionTitle>Workspaces</RailSectionTitle>
                  <WorkspaceList>
                    {workspaces.map((workspace) => {
                      const workspaceRoot = getWorkspaceRootDirectory(workspaceSettings, workspace.id);
                      const workspaceRuntimeState = workspace.id === activatedWorkspaceId
                        ? workspaceState === "ready"
                          ? "activated"
                          : "activating"
                        : "closed";

                      return (
                        <WorkspaceRow
                          data-runtime={workspaceRuntimeState}
                          data-selected={workspace.id === selectedWorkspaceId}
                          key={workspace.id}
                        >
                          <WorkspaceButton
                            data-runtime={workspaceRuntimeState}
                            data-selected={workspace.id === selectedWorkspaceId}
                            onClick={() => {
                              activateWorkspaceFromRail(workspace.id);
                            }}
                            title={workspace.name}
                            type="button"
                          >
                            <WorkspaceAccent aria-hidden="true" />
                            <WorkspaceLabel>
                              <strong>{workspace.name}</strong>
                              <span>{getDirectoryName(workspaceRoot || defaultWorkingDirectory)}</span>
                            </WorkspaceLabel>
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
                  {hasSelectedWorkspace && (
                    <>
                      <RailActionButton
                        data-active={activeView === DEFAULT_WORKSPACE_VIEW}
                        onClick={() => showView(DEFAULT_WORKSPACE_VIEW)}
                        type="button"
                      >
                        <ButtonTerminalIcon aria-hidden="true" />
                        <span>Terminals</span>
                      </RailActionButton>
                      <RailActionButton
                        data-active={activeView === "files"}
                        onClick={() => showView("files")}
                        type="button"
                      >
                        <ButtonFolderIcon aria-hidden="true" />
                        <span>Files</span>
                      </RailActionButton>
                      <RailActionButton
                        data-active={activeView === "specGraph"}
                        onClick={() => showView("specGraph")}
                        type="button"
                      >
                        <ButtonForgeIcon aria-hidden="true" />
                        <span>Spec Graph</span>
                      </RailActionButton>
                      <RailActionButton
                        data-active={activeView === "mcps"}
                        onClick={() => showView("mcps")}
                        type="button"
                      >
                        <ButtonHubIcon aria-hidden="true" />
                        <span>MCPs</span>
                      </RailActionButton>
                    </>
                  )}
                  <RailGlobalActions aria-label="Global controls">
                    <RailActionButton
                      data-active={activeView === "audio"}
                      data-scope="global"
                      onClick={() => showView("audio")}
                      type="button"
                    >
                      <ButtonMicIcon aria-hidden="true" />
                      <span>Audio</span>
                    </RailActionButton>
                    <RailActionButton
                      data-active={activeView === "settings"}
                      data-scope="global"
                      onClick={() => showView("settings")}
                      type="button"
                    >
                      <ButtonSettingsIcon aria-hidden="true" />
                      <span>Settings</span>
                    </RailActionButton>
                    <RailActionButton data-scope="global" data-variant="signout" onClick={logout} type="button">
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
                  {shouldShowWorkspaceSetup || activatedWorkspace ? (
                    <TerminalView
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
                      createFirstWorkspace={createFirstWorkspace}
                      handlePreparedTerminalChange={handlePreparedTerminalChange}
                      refreshAgentStatuses={refreshAgentStatuses}
                      reorderWorkspaceTerminalDisplayLayout={reorderWorkspaceTerminalDisplayLayout}
                      setWorkspaceName={setWorkspaceName}
                      shouldPrewarmWorkspaceTerminals={shouldPrewarmWorkspaceTerminals}
                      shouldShowWorkspaceSetup={shouldShowWorkspaceSetup}
                      showSettingsView={showSettingsView}
                      splitWorkspaceTerminal={splitWorkspaceTerminal}
                      terminalDisplayRows={activatedWorkspaceDisplayTerminalRows}
                      viewMotion={viewMotion}
                      workspaceAgentLaunchEpoch={workspaceAgentLaunchEpoch}
                      workspaceError={workspaceError}
                      workspaceName={workspaceName}
                      workspaceSyncState={workspaceSyncState}
                      workspaceTerminalAgentLaunchReady={workspaceTerminalAgentLaunchReady}
                      workspaceTerminalRenderAgent={workspaceTerminalRenderAgent}
                    />
                  ) : (
                    <WorkspaceIdleState detail="No active workspace." viewMotion={viewMotion} />
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
                    <SecondaryButton onClick={() => showView(DEFAULT_WORKSPACE_VIEW)} type="button">
                      <ConnectedIcon aria-hidden="true" />
                      <span>Back</span>
                    </SecondaryButton>
                  </PageHeader>

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
                            <WorkspaceSettingsInput
                              as="select"
                              onChange={(event) => setDefaultWorkspace(event.target.value, "settings_page")}
                              value={workspaceLifecycleSettings.defaultWorkspaceId}
                            >
                              <option value="">No auto-activate workspace</option>
                              {workspaces.map((workspace) => (
                                <option key={workspace.id} value={workspace.id}>
                                  {workspace.name}
                                </option>
                              ))}
                            </WorkspaceSettingsInput>
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
                        <PanelKicker>Terminal rendering</PanelKicker>
                        <PanelHeading>Stability recovery</PanelHeading>
                      </div>
                    </PanelHeaderRow>

                    <AccountCard data-tone={terminalStabilityRuntimeEnabled ? "blue" : "orange"}>
                      <AccountCardHeader>
                        <div>
                          <SettingsLabel>Runtime mode</SettingsLabel>
                          <SettingsValue>
                            {terminalStabilityRuntimeEnabled ? "Recovery enabled" : "Native terminal mode"}
                          </SettingsValue>
                          <SettingsHint>Applies to active Codex and Claude terminal panes immediately.</SettingsHint>
                        </div>
                        <AgentReadyPill data-tone={terminalStabilityRuntimeEnabled ? "blue" : "orange"}>
                          <ButtonTerminalIcon aria-hidden="true" />
                          <span>{terminalStabilityRuntimeEnabled ? "Enabled" : "Disabled"}</span>
                        </AgentReadyPill>
                      </AccountCardHeader>

                      <AccountCardFooter>
                        <SettingsHint>
                          {terminalStabilityRuntimeEnabled
                            ? "Scrollback recovery and resize cleanup are active."
                            : "Terminal output passes through without recovery transforms."}
                        </SettingsHint>
                        <SecondaryButton onClick={toggleTerminalStabilityRuntime} type="button">
                          <ButtonSettingsIcon aria-hidden="true" />
                          <span>{terminalStabilityRuntimeEnabled ? "Disable" : "Enable"}</span>
                        </SecondaryButton>
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
                        <AgentReadyPill data-tone={connectedAgentCount > 0 ? "blue" : "orange"}>
                          <ButtonBotIcon aria-hidden="true" />
                          <span>{connectedAgentCount}/2 ready</span>
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
                <ForgeWorkspace aria-label="Workspace files" data-motion={viewMotion}>
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
                      rootDirectory={selectedWorkspaceFileRoot}
                      workspace={selectedWorkspace}
                    />
                  ) : (
                    <WorkspaceIdleState detail="Select a workspace to view the spec graph." viewMotion={viewMotion} />
                  )}
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

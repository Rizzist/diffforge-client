import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AUDIO_TRANSCRIPTION_RESULT_EVENT,
  AUDIO_ORCHESTRATOR_SUBMISSION_MODE_AUTO,
  AUDIO_ORCHESTRATOR_SUBMISSION_MODE_EVENT,
  AUDIO_ORCHESTRATOR_SUBMISSION_MODE_MANUAL,
  AUDIO_RECORDER_MODE_PUSH_TO_TALK,
  AUDIO_RECORDER_MODE_TOGGLE_TO_TALK,
  AUDIO_TRANSCRIPTION_PROVIDER_CLOUD,
  AUDIO_TRANSCRIPTION_PROVIDER_LOCAL,
  AUDIO_WIDGET_THEME_DARK,
  AUDIO_WIDGET_THEME_LIGHT,
  AUDIO_WIDGET_THEME_STORAGE_KEY,
  arrayBufferToBase64,
  formatAudioPercent,
  getAudioInputErrorMessage,
  hasAudioInputSetup,
  listAudioInputDevices,
  markAudioInputSetupReady,
  normalizeAudioWidgetTheme,
  prepareWhisperModel,
  publishAudioTranscriptionResult,
  readAudioRecorderMode,
  readOrchestratorVoiceSubmissionMode,
  readAudioTranscriptionHistory,
  readAudioTranscriptionProvider,
  readAutoOpenAudioRecorder,
  readAudioWidgetTheme,
  readDeepgramApiKey,
  readDeepgramLanguage,
  readSelectedAudioInputDeviceId,
  startLowPowerAudioBuffer,
  writeAudioRecorderMode,
  writeOrchestratorVoiceSubmissionMode,
  writeAudioTranscriptionProvider,
  writeAutoOpenAudioRecorder,
  writeAudioWidgetTheme,
  writeDeepgramApiKey,
  writeDeepgramLanguage,
  writeSelectedAudioInputDeviceId,
} from "./audioCapture";
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
  VaultWorkspaceSurface,
  VaultPlaceholderPanel,
  VaultPlaceholderIcon,
  VaultStatusGrid,
  AudioWorkspaceSurface,
  AudioSetupPanel,
  AudioHeroRow,
  AudioStatePill,
  AudioModeGrid,
  AudioModeButton,
  AudioGeneralToolbar,
  AudioProviderPanel,
  AudioRecorderPanel,
  AudioRecorderActions,
  AudioDevicePanel,
  AudioDeviceHeader,
  AudioDeviceControls,
  AudioDeviceSelect,
  AudioCloudGrid,
  AudioCloudField,
  AudioCloudInput,
  AudioInputMeter,
  AudioInputMeta,
  AudioRecorderOptionRow,
  AudioShortcutGrid,
  AudioShortcutCard,
  AudioShortcutKey,
  AudioShortcutActions,
  AudioTabBar,
  AudioTabButton,
  AudioTabPanel,
  AudioDictionaryPanel,
  AudioHistoryPanel,
  AudioHistoryStats,
  AudioHistoryStatChip,
  AudioHistoryVirtualList,
  AudioHistoryListSpacer,
  AudioHistoryRow,
  AudioHistoryRowTopline,
  AudioHistoryRowActions,
  AudioHistoryProvider,
  AudioHistoryCopyButton,
  AudioHistoryMeta,
  AudioRuntimeHint,
  AudioProgressPanel,
  AudioProgressTopline,
  AudioProgressTrack,
  AudioProgressBar,
  AudioProgressMeta,
  AudioActionRow,
  AudioWidgetShell,
  AudioWidgetFocusStage,
  AudioWidgetLogo,
  AudioWidgetMeter,
  AudioWidgetLoader,
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
  ButtonCopyIcon,
  ButtonDeleteIcon,
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
  ButtonHubIcon,
  ButtonCheckIcon,
  FileChevronIcon,
  FileExpandIcon,
  FileFolderTreeIcon,
  FileDocumentIcon
} from "../app/appStyles";

export const AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT = "forge-audio-model-download-progress";
export const AUDIO_WIDGET_HASH = "#/audio-widget";
export const AUDIO_WIDGET_VISIBILITY_CHANGED_EVENT = "forge-audio-widget-visibility-changed";
const AUDIO_PUSH_TO_TALK_EVENT = "forge-audio-push-to-talk";
const AUDIO_CANCEL_EVENT = "forge-audio-cancel";
const AUDIO_SHORTCUTS_CHANGED_EVENT = "forge-audio-shortcuts-changed";
const AUDIO_SETTINGS_CHANGED_EVENT = "forge-audio-settings-changed";
const AUDIO_REALTIME_TRANSCRIPT_EVENT = "forge-audio-realtime-transcript";
const AUDIO_RECORDING_MAX_SECONDS = 90;
const AUDIO_RECORDING_TIMER_MS = 250;
const DEEPGRAM_RELEASE_POST_BUFFER_MS = 500;
const AUDIO_WIDGET_PREROLL_READY_MS = 500;
const AUDIO_INPUT_METER_BARS = 32;
const AUDIO_WIDGET_METER_BARS = 26;
const AUDIO_WIDGET_COMPACT_SIZE = { width: 64, height: 64 };
const AUDIO_WIDGET_FOCUS_SIZE = { width: 292, height: 64 };
const AUDIO_WIDGET_CLOSE_ANIMATION_MS = 240;
const EMPTY_AUDIO_INPUT_STATS = { bufferMs: 0, peak: 0, rms: 0 };
const AUDIO_SHORTCUT_ACTION_PUSH_TO_TALK = "push-to-talk";
const AUDIO_SHORTCUT_ACTION_CANCEL = "cancel";
const AUDIO_MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);
const AUDIO_SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "dictionary", label: "Dictionary" },
  { id: "history", label: "History" },
];
const AUDIO_WIDGET_THEME_META_COLORS = {
  [AUDIO_WIDGET_THEME_DARK]: "#030508",
  [AUDIO_WIDGET_THEME_LIGHT]: "#f5f5f7",
};
const AUDIO_WIDGET_THEME_OPTIONS = [
  {
    detail: "Dark floating recorder",
    icon: "dark",
    id: AUDIO_WIDGET_THEME_DARK,
    label: "Dark",
  },
  {
    detail: "Light floating recorder",
    icon: "light",
    id: AUDIO_WIDGET_THEME_LIGHT,
    label: "Light",
  },
];
const AUDIO_HISTORY_ROW_HEIGHT = 124;
const AUDIO_HISTORY_VIEWPORT_HEIGHT = 420;
const AUDIO_HISTORY_OVERSCAN = 5;

function isMacPlatform() {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");
}

function isWindowsPlatform() {
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform || "");
}

const isFocusedAudioWidgetState = (state) => state === "arming"
  || state === "recording"
  || state === "transcribing";
const isBusyAudioWidgetState = (state) => state === "arming"
  || state === "recording"
  || state === "transcribing"
  || state === "checking"
  || state === "warming";
const DEEPGRAM_LANGUAGE_OPTIONS = [
  { value: "en", label: "English" },
  { value: "multi", label: "Multilingual" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "hi", label: "Hindi" },
  { value: "pt", label: "Portuguese" },
  { value: "ja", label: "Japanese" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "zh", label: "Chinese" },
  { value: "ko", label: "Korean" },
  { value: "ar", label: "Arabic" },
  { value: "ru", label: "Russian" },
];

function getErrorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

function formatFileSize(size) {
  if (!Number.isFinite(size) || size < 0) {
    return "";
  }

  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatAudioLevel(value) {
  const level = Math.round(clampAudioLevel(value));
  return `${level}%`;
}

function clampAudioLevel(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function buildInputMeterBarStyle(index, level, active) {
  const normalizedLevel = clampAudioLevel(level) / 100;
  const hasSignal = normalizedLevel >= 0.06;
  const midpoint = (AUDIO_INPUT_METER_BARS - 1) / 2;
  const centerLift = 1 - (Math.abs(index - midpoint) / midpoint);
  const scatter = ((index * 7) % 19) / 18;
  const ripple = Math.abs(Math.sin(index * 0.82));
  const quietHeight = active
    ? 10
      + (centerLift * (hasSignal ? 18 : 8))
      + (scatter * (hasSignal ? 12 : 4))
      + (ripple * (hasSignal ? 8 : 3))
    : 8;
  const signalHeight = active
    ? normalizedLevel * (44 + (centerLift * 24) + (scatter * 16))
    : 0;
  const height = Math.max(8, Math.min(96, quietHeight + signalHeight));

  return {
    "--bar-hue": `${184 + ((index * 11) % 68)}`,
    "--delay": `${-1 * ((index * 53) % 920)}ms`,
    "--duration": `${(hasSignal ? 760 : 1280) + ((index * 37) % (hasSignal ? 360 : 520))}ms`,
    "--height": `${height.toFixed(1)}%`,
    "--motion-high": hasSignal ? "1.12" : "1.035",
    "--motion-low": hasSignal ? "0.78" : "0.94",
    "--motion-mid": hasSignal ? "0.92" : "0.985",
  };
}

function buildWidgetMeterBarStyle(index, level, processing) {
  const normalizedLevel = clampAudioLevel(level) / 100;
  const signalEnergy = processing ? 0.75 : Math.min(1, normalizedLevel * 8);
  const midpoint = (AUDIO_WIDGET_METER_BARS - 1) / 2;
  const centerLift = 1 - (Math.abs(index - midpoint) / midpoint);
  const scatter = ((index * 11) % 23) / 22;
  const ripple = Math.abs(Math.sin((index * 1.17) + (processing ? 0.9 : 0)));
  const baseScale = (processing ? 0.24 : 0.14)
    + (centerLift * (0.08 + (signalEnergy * 0.12)))
    + (scatter * (0.04 + (signalEnergy * 0.1)))
    + (ripple * (0.03 + (signalEnergy * 0.05)));
  const signalScale = normalizedLevel * (0.34 + (centerLift * 0.32) + (scatter * 0.16));
  const scale = Math.min(0.92, baseScale + signalScale);
  const scaleLow = Math.max(0.12, scale - (processing ? 0.12 : 0.06 + (signalEnergy * 0.1)) - (scatter * 0.03));
  const scaleHigh = Math.min(0.98, scale + (processing ? 0.17 : 0.08 + (signalEnergy * 0.16)) + (centerLift * 0.07));

  return {
    "--bar-hue": `${processing ? 192 + ((index * 9) % 46) : 198 + ((index * 13) % 66)}`,
    "--delay": `${-1 * ((index * (processing ? 41 : 57)) % (processing ? 1100 : signalEnergy > 0.2 ? 1100 : 1700))}ms`,
    "--duration": `${(processing ? 760 : signalEnergy > 0.2 ? 620 : 1320) + ((index * (processing ? 29 : 47)) % (processing ? 260 : signalEnergy > 0.2 ? 430 : 560))}ms`,
    "--scale": scale.toFixed(2),
    "--scale-high": scaleHigh.toFixed(2),
    "--scale-low": scaleLow.toFixed(2),
  };
}

function waitForAudioPostBuffer(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function notifyAudioSettingsChanged(reason) {
  emit(AUDIO_SETTINGS_CHANGED_EVENT, {
    reason,
    createdAt: new Date().toISOString(),
  }).catch(() => {});
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) {
    return false;
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall through to the DOM copy path for webviews that block Clipboard API writes.
    }
  }

  if (typeof document === "undefined" || !document.body) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return Boolean(document.execCommand("copy"));
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function applyAudioWidgetThemePreference(theme) {
  if (typeof document === "undefined") {
    return normalizeAudioWidgetTheme(theme);
  }

  const normalizedTheme = normalizeAudioWidgetTheme(theme);
  document.documentElement.dataset.forgeTheme = normalizedTheme;
  document.documentElement.dataset.audioWidgetTheme = normalizedTheme;
  if (document.body) {
    document.body.dataset.forgeTheme = normalizedTheme;
    document.body.dataset.audioWidgetTheme = normalizedTheme;
  }

  const themeColor = AUDIO_WIDGET_THEME_META_COLORS[normalizedTheme]
    || AUDIO_WIDGET_THEME_META_COLORS[AUDIO_WIDGET_THEME_DARK];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);

  return normalizedTheme;
}

function defaultPushToTalkShortcut() {
  if (isMacPlatform()) {
    return "Alt+KeyP";
  }

  if (isWindowsPlatform()) {
    return "ContextMenu";
  }

  return "Alt+KeyP";
}

function normalizeShortcutTokenForCompare(token) {
  const compact = String(token || "").trim().replace(/[\s_-]+/g, "").toLowerCase();

  if (["apps", "appkey", "application", "contextmenu", "menu"].includes(compact)) {
    return "contextmenu";
  }

  return compact;
}

function normalizeKeyboardShortcutCode(value) {
  const compact = String(value || "").trim().replace(/[\s_-]+/g, "").toLowerCase();

  if (["apps", "appkey", "application", "contextmenu", "menu"].includes(compact)) {
    return "ContextMenu";
  }

  return value;
}

function fallbackShortcutPermissions() {
  return {
    platform: isMacPlatform() ? "macos" : "other",
    accessibilityRequired: isMacPlatform(),
    accessibilityGranted: !isMacPlatform(),
    accessibilitySettingsUrl: isMacPlatform()
      ? "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
      : "",
    quarantineDetected: false,
    quarantinePath: "",
    quarantineFixCommand: "",
    message: "",
  };
}

function fallbackShortcutStatus() {
  const pushToTalk = defaultPushToTalkShortcut();

  return {
    pushToTalk: {
      shortcut: pushToTalk,
      defaultShortcut: pushToTalk,
      registered: false,
      error: "",
    },
    cancel: {
      shortcut: "Escape",
      defaultShortcut: "Escape",
      registered: false,
      error: "",
    },
    permissions: fallbackShortcutPermissions(),
  };
}

function normalizeShortcutForCompare(value) {
  return String(value || "")
    .split("+")
    .map(normalizeShortcutTokenForCompare)
    .filter(Boolean)
    .join("+");
}

function shortcutFromKeyboardEvent(event) {
  const code = normalizeKeyboardShortcutCode(event.code || event.key || "");

  if (!code) {
    return "";
  }

  if (AUDIO_MODIFIER_CODES.has(code)) {
    return code;
  }

  const modifiers = [];

  if (event.ctrlKey) {
    modifiers.push("Control");
  }
  if (event.altKey) {
    modifiers.push("Alt");
  }
  if (event.shiftKey) {
    modifiers.push("Shift");
  }
  if (event.metaKey) {
    modifiers.push("Super");
  }

  return [...modifiers, code].join("+");
}

function shortcutMatchesEvent(shortcut, event) {
  const eventShortcut = shortcutFromKeyboardEvent(event);

  return Boolean(eventShortcut)
    && normalizeShortcutForCompare(eventShortcut) === normalizeShortcutForCompare(shortcut);
}

function formatShortcutToken(token) {
  const compact = String(token || "").trim().replace(/[\s_-]+/g, "");
  const lower = compact.toLowerCase();

  if (lower === "control" || lower === "ctrl") {
    return "Ctrl";
  }
  if (lower === "alt" || lower === "option") {
    return isMacPlatform() ? "Option" : "Alt";
  }
  if (lower === "shift") {
    return "Shift";
  }
  if (lower === "super" || lower === "command" || lower === "cmd" || lower === "meta") {
    return "Cmd/Win";
  }
  if (lower === "apps" || lower === "appkey" || lower === "application" || lower === "contextmenu" || lower === "menu") {
    return "Menu";
  }
  if (lower === "metaright" || lower === "osright") {
    return "Right Cmd";
  }
  if (lower === "metaleft" || lower === "osleft") {
    return "Left Cmd";
  }
  if (lower === "controlright") {
    return "Right Ctrl";
  }
  if (lower === "controlleft") {
    return "Left Ctrl";
  }
  if (lower === "altright") {
    return "Right Alt";
  }
  if (lower === "altleft") {
    return "Left Alt";
  }
  if (lower === "shiftright") {
    return "Right Shift";
  }
  if (lower === "shiftleft") {
    return "Left Shift";
  }
  if (lower === "escape" || lower === "esc") {
    return "Esc";
  }
  if (lower === "space") {
    return "Space";
  }
  if (/^key[a-z]$/i.test(compact)) {
    return compact.slice(3).toUpperCase();
  }
  if (/^digit[0-9]$/i.test(compact)) {
    return compact.slice(5);
  }

  return compact || "Unset";
}

function formatShortcutLabel(value) {
  return String(value || "")
    .split("+")
    .map(formatShortcutToken)
    .filter(Boolean)
    .join(" + ") || "Unset";
}

function formatHistoryTimestamp(value) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  const currentYear = new Date().getFullYear();

  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() === currentYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatHistoryDuration(audioMs) {
  const duration = Number(audioMs || 0);

  if (!Number.isFinite(duration) || duration <= 0) {
    return "";
  }

  if (duration < 1000) {
    return `${Math.round(duration)}ms`;
  }

  const seconds = duration / 1000;
  return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
}

function formatAudioHistoryTotalDuration(audioMs) {
  const duration = Number(audioMs || 0);

  if (!Number.isFinite(duration) || duration <= 0) {
    return "0m";
  }

  const totalSeconds = Math.round(duration / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

function formatInteger(value) {
  return new Intl.NumberFormat().format(Number(value) || 0);
}

function formatAudioProviderLabel(provider) {
  return provider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD ? "Deepgram" : "Whisper";
}

function formatAudioHistoryMeta(entry) {
  const pieces = [];
  const source = String(entry?.source || "").trim();
  const duration = formatHistoryDuration(entry?.audioMs);
  const wordCount = Number(entry?.wordCount || 0);
  const language = String(entry?.language || "").trim();

  if (source) {
    pieces.push(source);
  }
  if (duration) {
    pieces.push(duration);
  }
  if (wordCount > 0) {
    pieces.push(`${formatInteger(wordCount)} ${wordCount === 1 ? "word" : "words"}`);
  }
  if (language) {
    pieces.push(language);
  }

  return pieces.join(" / ");
}

function getAudioHistoryEntryKey(entry, index = 0) {
  return entry?.id || `${entry?.createdAt || "audio-history"}-${index}`;
}

function buildAudioHistoryStats(history) {
  const entries = Array.isArray(history) ? history : [];
  const total = entries.length;
  const timedEntries = entries.filter((entry) => Number(entry?.audioMs || 0) > 0);
  const audioMs = timedEntries.reduce((sum, entry) => sum + Number(entry.audioMs || 0), 0);
  const timedWords = timedEntries.reduce((sum, entry) => {
    const entryWordCount = Number(entry?.wordCount || 0);

    if (Number.isFinite(entryWordCount) && entryWordCount > 0) {
      return sum + entryWordCount;
    }

    return sum + String(entry?.text || "").split(/\s+/).filter(Boolean).length;
  }, 0);
  const averageWpm = audioMs > 0 ? Math.round(timedWords / (audioMs / 60000)) : 0;

  return [
    { label: "Dictations", value: formatInteger(total) },
    { label: "Audio time", value: formatAudioHistoryTotalDuration(audioMs) },
    { label: "Avg WPM", value: averageWpm > 0 ? `${formatInteger(averageWpm)}` : "--" },
  ];
}

function buildVisibleAudioHistoryItems(history, scrollTop) {
  const entries = Array.isArray(history) ? history : [];
  const startIndex = Math.max(0, Math.floor((Number(scrollTop) || 0) / AUDIO_HISTORY_ROW_HEIGHT) - AUDIO_HISTORY_OVERSCAN);
  const visibleCount = Math.ceil(AUDIO_HISTORY_VIEWPORT_HEIGHT / AUDIO_HISTORY_ROW_HEIGHT) + (AUDIO_HISTORY_OVERSCAN * 2);

  return entries
    .slice(startIndex, startIndex + visibleCount)
    .map((entry, offset) => ({
      entry,
      index: startIndex + offset,
    }));
}

export default function AudioWorkspaceView({
  audioActionState,
  audioDownloadProgress,
  audioError,
  audioModelStatus,
  audioStatusState,
  audioWidgetVisible,
  onDownloadModel,
  onCloseWidget,
  onOpenWidget,
  onRefreshStatus,
  onUninstallModel,
  workspace,
}) {
  const [isUninstallModalOpen, setUninstallModalOpen] = useState(false);
  const [activeAudioTab, setActiveAudioTab] = useState("general");
  const [audioInputDevices, setAudioInputDevices] = useState([]);
  const [audioInputDeviceId, setAudioInputDeviceId] = useState(readSelectedAudioInputDeviceId);
  const [audioInputState, setAudioInputState] = useState(hasAudioInputSetup() ? "ready" : "needs-access");
  const [audioInputMessage, setAudioInputMessage] = useState("Choose an input source, then enable it for local dictation.");
  const [audioInputStats, setAudioInputStats] = useState(EMPTY_AUDIO_INPUT_STATS);
  const [audioMode, setAudioMode] = useState(readAudioTranscriptionProvider);
  const [deepgramApiKey, setDeepgramApiKey] = useState(readDeepgramApiKey);
  const [deepgramLanguage, setDeepgramLanguage] = useState(readDeepgramLanguage);
  const [autoOpenRecorder, setAutoOpenRecorder] = useState(readAutoOpenAudioRecorder);
  const [recorderMode, setRecorderMode] = useState(readAudioRecorderMode);
  const [orchestratorSubmissionMode, setOrchestratorSubmissionMode] = useState(readOrchestratorVoiceSubmissionMode);
  const [audioWidgetTheme, setAudioWidgetTheme] = useState(readAudioWidgetTheme);
  const [audioHistory, setAudioHistory] = useState(readAudioTranscriptionHistory);
  const [historyScrollTop, setHistoryScrollTop] = useState(0);
  const [copiedAudioHistoryId, setCopiedAudioHistoryId] = useState("");
  const [audioShortcutStatus, setAudioShortcutStatus] = useState(() => audioModelStatus?.shortcuts || fallbackShortcutStatus());
  const [audioShortcutError, setAudioShortcutError] = useState("");
  const [audioShortcutActionState, setAudioShortcutActionState] = useState("idle");
  const [capturingAudioShortcut, setCapturingAudioShortcut] = useState("");
  const audioInputPreviewRef = useRef(null);
  const audioInputRunRef = useRef(0);
  const audioInputAutoWarmAttemptedRef = useRef(false);
  const audioInputAutoWarmSuppressedRef = useRef(false);
  const audioInputDeviceIdRef = useRef(audioInputDeviceId);
  const audioInputStateRef = useRef(audioInputState);
  const copiedAudioHistoryTimerRef = useRef(0);
  const isCloudMode = audioMode === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD;
  const deepgramReady = Boolean(deepgramApiKey.trim());
  const installed = Boolean(audioModelStatus?.installed);
  const recorderOpen = Boolean(audioWidgetVisible);
  const recorderReady = isCloudMode ? deepgramReady : installed;
  const isBusy = audioActionState === "downloading"
    || audioActionState === "closing"
    || audioActionState === "opening"
    || audioActionState === "uninstalling"
    || (!isCloudMode && audioStatusState === "checking");
  const RecorderOpenButton = recorderOpen ? SecondaryButton : PrimaryButton;
  const recorderButtonLabel = recorderOpen
    ? audioActionState === "closing"
      ? "Closing..."
      : "Close"
    : audioActionState === "opening"
      ? "Opening..."
      : "Open recorder";
  const recorderActionDisabled = recorderOpen
    ? isBusy
    : isBusy || (isCloudMode ? !deepgramReady : !installed);
  const recorderAction = recorderOpen ? onCloseWidget : onOpenWidget;
  const isToggleRecorderMode = recorderMode === AUDIO_RECORDER_MODE_TOGGLE_TO_TALK;
  const isManualOrchestratorMode = orchestratorSubmissionMode === AUDIO_ORCHESTRATOR_SUBMISSION_MODE_MANUAL;
  const recorderHint = recorderOpen
    ? "Floating recorder is open."
    : isToggleRecorderMode
      ? "Press the recorder shortcut to start, then press again to submit."
      : "Hold the recorder shortcut to record, then release to submit.";
  const audioWidgetThemeLabel = audioWidgetTheme === AUDIO_WIDGET_THEME_LIGHT ? "Light" : "Dark";
  const canUninstall = Boolean(audioModelStatus?.managedAssetsInstalled || audioModelStatus?.modelInstalled);
  const downloadPercent = audioDownloadProgress?.percent;
  const installLabel = audioModelStatus?.runtimeInstallable === false ? "Install model" : "Install Whisper";
  const missingLabel = audioModelStatus?.modelInstalled
    ? "Runtime missing"
    : audioModelStatus?.runtimeInstalled
      ? "Model missing"
      : "Not installed";
  const audioModeStatusLabel = isCloudMode
    ? (deepgramReady ? "Cloud ready" : "API key needed")
    : (installed ? "Local ready" : audioActionState === "downloading" ? "Downloading" : missingLabel);
  const isUninstalling = audioActionState === "uninstalling";
  const selectedAudioInput = audioInputDevices.find((device) => device.deviceId === audioInputDeviceId);
  const selectedAudioInputLabel = selectedAudioInput?.label || "Default microphone";
  const audioInputLevel = Math.round(clampAudioLevel(Math.max(audioInputStats.rms * 2600, audioInputStats.peak * 120)));
  const audioInputHasSignal = audioInputLevel >= 6;
  const audioInputStatusLabel = {
    checking: "Checking",
    "needs-access": "Setup needed",
    ready: "Ready",
    starting: "Opening",
    previewing: "Monitoring",
    error: "Input issue",
  }[audioInputState] || "Input";
  const effectiveShortcutStatus = audioShortcutStatus || audioModelStatus?.shortcuts || fallbackShortcutStatus();
  const pushToTalkShortcut = effectiveShortcutStatus.pushToTalk?.shortcut
    || audioModelStatus?.shortcut
    || defaultPushToTalkShortcut();
  const cancelShortcut = effectiveShortcutStatus.cancel?.shortcut || "Escape";
  const pushToTalkShortcutError = effectiveShortcutStatus.pushToTalk?.error || "";
  const cancelShortcutError = effectiveShortcutStatus.cancel?.error || "";
  const shortcutPermissions = effectiveShortcutStatus.permissions || fallbackShortcutPermissions();
  const shortcutPermissionMissing = Boolean(
    shortcutPermissions.accessibilityRequired && !shortcutPermissions.accessibilityGranted,
  );
  const shortcutQuarantineDetected = Boolean(shortcutPermissions.quarantineDetected);
  const isSavingShortcut = audioShortcutActionState === "saving";
  const isOpeningShortcutPermissions = audioShortcutActionState === "opening-permissions";
  const shortcutReady = !pushToTalkShortcutError
    && !cancelShortcutError
    && !shortcutPermissionMissing
    && !shortcutQuarantineDetected;
  const audioHistoryStats = useMemo(() => buildAudioHistoryStats(audioHistory), [audioHistory]);
  const visibleAudioHistory = useMemo(
    () => buildVisibleAudioHistoryItems(audioHistory, historyScrollTop),
    [audioHistory, historyScrollTop],
  );
  const audioHistoryListHeight = audioHistory.length * AUDIO_HISTORY_ROW_HEIGHT;

  const stopAudioInputPreview = useCallback(async () => {
    audioInputRunRef.current += 1;
    const audioInputPreview = audioInputPreviewRef.current;
    audioInputPreviewRef.current = null;

    if (audioInputPreview) {
      await audioInputPreview.close().catch(() => {});
    }
  }, []);

  useEffect(() => {
    audioInputDeviceIdRef.current = audioInputDeviceId;
  }, [audioInputDeviceId]);

  useEffect(() => {
    audioInputStateRef.current = audioInputState;
  }, [audioInputState]);

  const loadAudioInputDevices = useCallback(async () => {
    const currentState = audioInputStateRef.current;

    if (currentState !== "previewing") {
      audioInputStateRef.current = "checking";
      setAudioInputState("checking");
    }

    try {
      const devices = await listAudioInputDevices();
      setAudioInputDevices(devices);

      const currentDeviceId = audioInputDeviceIdRef.current;
      const hasSelectedDevice = devices.some((device) => device.deviceId === currentDeviceId);
      if (!hasSelectedDevice) {
        const nextDeviceId = devices.find((device) => device.isDefault)?.deviceId || devices[0]?.deviceId || "default";
        audioInputDeviceIdRef.current = nextDeviceId;
        setAudioInputDeviceId(nextDeviceId);
        writeSelectedAudioInputDeviceId(nextDeviceId);
        notifyAudioSettingsChanged("input-device");
      }

      if (!devices.length) {
        audioInputStateRef.current = "error";
        setAudioInputState("error");
        setAudioInputMessage("No audio input sources were detected.");
        return;
      }

      if (currentState !== "previewing") {
        const inputSetupReady = hasAudioInputSetup();
        const canAutoStartInput = !isMacPlatform() || inputSetupReady;
        const nextState = canAutoStartInput ? "ready" : "needs-access";
        audioInputStateRef.current = nextState;
        setAudioInputState(nextState);
        setAudioInputMessage(canAutoStartInput
          ? "Start monitoring to preview levels from the selected source."
          : "Enable input to open a native stream from the selected source.");
      }
    } catch (deviceError) {
      audioInputStateRef.current = "error";
      setAudioInputState("error");
      setAudioInputMessage(getAudioInputErrorMessage(deviceError, "Unable to list audio input sources."));
    }
  }, []);

  const startAudioInputPreview = useCallback(async (nextDeviceId) => {
    const deviceId = nextDeviceId || audioInputDeviceIdRef.current || "default";
    const runId = audioInputRunRef.current + 1;
    audioInputRunRef.current = runId;

    const existingPreview = audioInputPreviewRef.current;
    audioInputPreviewRef.current = null;
    if (existingPreview) {
      await existingPreview.close().catch(() => {});
    }

    audioInputDeviceIdRef.current = deviceId;
    setAudioInputDeviceId(deviceId);
    writeSelectedAudioInputDeviceId(deviceId);
    setAudioInputStats(EMPTY_AUDIO_INPUT_STATS);
    audioInputStateRef.current = "starting";
    setAudioInputState("starting");
    setAudioInputMessage("Opening selected input stream.");

    try {
      const audioInputPreview = await startLowPowerAudioBuffer({
        deviceId,
        owner: "audio-tab",
        onStats: (stats) => {
          if (audioInputRunRef.current === runId) {
            setAudioInputStats(stats);
          }
        },
      });

      if (audioInputRunRef.current !== runId) {
        await audioInputPreview.close().catch(() => {});
        return;
      }

      audioInputPreviewRef.current = audioInputPreview;
      markAudioInputSetupReady();
      notifyAudioSettingsChanged("input-ready");
      audioInputStateRef.current = "previewing";
      setAudioInputState("previewing");
      setAudioInputMessage("Live input stream is active for the selected source.");

      listAudioInputDevices()
        .then(setAudioInputDevices)
        .catch(() => {});
    } catch (inputError) {
      if (audioInputRunRef.current !== runId) {
        return;
      }

      setAudioInputStats(EMPTY_AUDIO_INPUT_STATS);
      audioInputStateRef.current = "error";
      setAudioInputState("error");
      setAudioInputMessage(getAudioInputErrorMessage(inputError, "Unable to open the selected input source."));
    }
  }, []);

  const selectAudioInputDevice = useCallback((event) => {
    const nextDeviceId = event.target.value || "default";
    audioInputDeviceIdRef.current = nextDeviceId;
    setAudioInputDeviceId(nextDeviceId);
    writeSelectedAudioInputDeviceId(nextDeviceId);
    notifyAudioSettingsChanged("input-device");
    setAudioInputStats(EMPTY_AUDIO_INPUT_STATS);

    const currentState = audioInputStateRef.current;
    if (currentState === "previewing" || currentState === "starting") {
      startAudioInputPreview(nextDeviceId);
      return;
    }

    setAudioInputMessage(hasAudioInputSetup()
      ? "Start monitoring to preview levels from the selected source."
      : "Enable input to open a native stream from the selected source.");
  }, [startAudioInputPreview]);

  const toggleAudioInputPreview = useCallback(() => {
    if (audioInputStateRef.current === "previewing") {
      audioInputAutoWarmSuppressedRef.current = true;
      stopAudioInputPreview();
      audioInputStateRef.current = "ready";
      setAudioInputState("ready");
      setAudioInputStats(EMPTY_AUDIO_INPUT_STATS);
      setAudioInputMessage("Monitoring paused. Start monitoring to preview input levels.");
      return;
    }

    audioInputAutoWarmSuppressedRef.current = false;
    audioInputAutoWarmAttemptedRef.current = true;
    startAudioInputPreview();
  }, [startAudioInputPreview, stopAudioInputPreview]);

  const toggleAutoOpenRecorder = useCallback(() => {
    setAutoOpenRecorder((currentValue) => {
      const nextValue = !currentValue;
      writeAutoOpenAudioRecorder(nextValue);
      return nextValue;
    });
  }, []);

  const updateRecorderMode = useCallback((nextMode) => {
    setRecorderMode(nextMode);
    writeAudioRecorderMode(nextMode);
    notifyAudioSettingsChanged("recorder-mode");
  }, []);

  const updateOrchestratorSubmissionMode = useCallback((nextMode) => {
    setOrchestratorSubmissionMode(nextMode);
    writeOrchestratorVoiceSubmissionMode(nextMode);
    notifyAudioSettingsChanged("orchestrator-submission-mode");
  }, []);

  const updateAudioWidgetTheme = useCallback((nextTheme) => {
    const normalizedTheme = normalizeAudioWidgetTheme(nextTheme);
    setAudioWidgetTheme(normalizedTheme);
    writeAudioWidgetTheme(normalizedTheme);
    notifyAudioSettingsChanged("widget-theme");
  }, []);

  const handleAudioHistoryScroll = useCallback((event) => {
    setHistoryScrollTop(event.currentTarget.scrollTop || 0);
  }, []);

  const copyAudioHistoryPrompt = useCallback(async (entry, index) => {
    const text = String(entry?.text || "").trim();
    if (!text) {
      return;
    }

    const copied = await copyTextToClipboard(text);
    if (!copied) {
      return;
    }

    const entryKey = getAudioHistoryEntryKey(entry, index);
    setCopiedAudioHistoryId(entryKey);

    if (copiedAudioHistoryTimerRef.current) {
      window.clearTimeout(copiedAudioHistoryTimerRef.current);
    }

    copiedAudioHistoryTimerRef.current = window.setTimeout(() => {
      copiedAudioHistoryTimerRef.current = 0;
      setCopiedAudioHistoryId((currentId) => (currentId === entryKey ? "" : currentId));
    }, 1600);
  }, []);

  const selectAudioMode = useCallback((nextMode) => {
    setAudioMode(nextMode);
    writeAudioTranscriptionProvider(nextMode);
    notifyAudioSettingsChanged("provider");
  }, []);

  const updateDeepgramApiKey = useCallback((event) => {
    const nextApiKey = event.target.value;
    setDeepgramApiKey(nextApiKey);
    writeDeepgramApiKey(nextApiKey);
    notifyAudioSettingsChanged("deepgram-key");
  }, []);

  const updateDeepgramLanguage = useCallback((event) => {
    const nextLanguage = event.target.value;
    setDeepgramLanguage(nextLanguage);
    writeDeepgramLanguage(nextLanguage);
    notifyAudioSettingsChanged("deepgram-language");
  }, []);

  const loadAudioShortcutStatus = useCallback(async () => {
    try {
      const status = await invoke("audio_shortcuts_status");
      setAudioShortcutStatus(status || fallbackShortcutStatus());
      setAudioShortcutError("");
    } catch (shortcutError) {
      setAudioShortcutError(getErrorMessage(shortcutError, "Unable to load audio shortcuts."));
    }
  }, []);

  const applyAudioShortcut = useCallback(async (action, shortcut) => {
    if (!shortcut) {
      return;
    }

    setAudioShortcutActionState("saving");
    setAudioShortcutError("");

    try {
      const status = await invoke("set_audio_shortcut", {
        request: {
          action,
          shortcut,
        },
      });
      setAudioShortcutStatus(status || fallbackShortcutStatus());
      setCapturingAudioShortcut("");
      await onRefreshStatus?.();
    } catch (shortcutError) {
      setAudioShortcutError(getErrorMessage(shortcutError, "Unable to save that audio shortcut."));
    } finally {
      setAudioShortcutActionState("idle");
    }
  }, [onRefreshStatus]);

  const resetAudioShortcuts = useCallback(async () => {
    setAudioShortcutActionState("saving");
    setAudioShortcutError("");

    try {
      const status = await invoke("reset_audio_shortcuts");
      setAudioShortcutStatus(status || fallbackShortcutStatus());
      setCapturingAudioShortcut("");
      await onRefreshStatus?.();
    } catch (shortcutError) {
      setAudioShortcutError(getErrorMessage(shortcutError, "Unable to reset audio shortcuts."));
    } finally {
      setAudioShortcutActionState("idle");
    }
  }, [onRefreshStatus]);

  const openAudioShortcutPermissions = useCallback(async () => {
    setAudioShortcutActionState("opening-permissions");
    setAudioShortcutError("");

    try {
      const status = await invoke("open_audio_shortcut_permissions");
      setAudioShortcutStatus(status || fallbackShortcutStatus());
    } catch (shortcutError) {
      setAudioShortcutError(getErrorMessage(shortcutError, "Unable to open macOS shortcut permissions."));
    } finally {
      setAudioShortcutActionState("idle");
    }
  }, []);

  useEffect(() => {
    if (audioModelStatus?.shortcuts) {
      setAudioShortcutStatus(audioModelStatus.shortcuts);
    }
  }, [audioModelStatus?.shortcuts]);

  useEffect(() => {
    loadAudioShortcutStatus();
  }, [loadAudioShortcutStatus]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(AUDIO_SHORTCUTS_CHANGED_EVENT, (event) => {
      if (!disposed) {
        setAudioShortcutStatus(event.payload || fallbackShortcutStatus());
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
  }, []);

  useEffect(() => {
    if (!capturingAudioShortcut) {
      return undefined;
    }

    const onKeyDown = (event) => {
      if (event.repeat) {
        return;
      }

      const shortcut = shortcutFromKeyboardEvent(event);

      if (!shortcut) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      applyAudioShortcut(capturingAudioShortcut, shortcut);
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [applyAudioShortcut, capturingAudioShortcut]);

  useEffect(() => {
    loadAudioInputDevices();

    const handleRefresh = () => {
      loadAudioInputDevices();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadAudioInputDevices();
      }
    };

    window.addEventListener("focus", handleRefresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadAudioInputDevices]);

  useEffect(() => {
    const inputSetupReady = hasAudioInputSetup();
    const needsManualMacInputEnable = isMacPlatform() && !inputSetupReady;

    if (
      audioInputAutoWarmAttemptedRef.current
      || audioInputAutoWarmSuppressedRef.current
      || needsManualMacInputEnable
      || audioInputState !== "ready"
      || audioInputDevices.length === 0
    ) {
      return;
    }

    audioInputAutoWarmAttemptedRef.current = true;
    startAudioInputPreview();
  }, [audioInputDevices.length, audioInputState, startAudioInputPreview]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(AUDIO_TRANSCRIPTION_RESULT_EVENT, (event) => {
      if (!disposed && event.payload?.text) {
        setAudioHistory(readAudioTranscriptionHistory());
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

    const handleStorage = (event) => {
      if (event.key?.startsWith?.("diffforge.audio.")) {
        setAudioHistory(readAudioTranscriptionHistory());
        setRecorderMode(readAudioRecorderMode());
        setAudioWidgetTheme(readAudioWidgetTheme());
        setOrchestratorSubmissionMode(readOrchestratorVoiceSubmissionMode());
        setAudioMode(readAudioTranscriptionProvider());
        setDeepgramApiKey(readDeepgramApiKey());
        setDeepgramLanguage(readDeepgramLanguage());
      }
    };

    const handleOrchestratorModeChanged = (event) => {
      setOrchestratorSubmissionMode(event?.detail?.mode || readOrchestratorVoiceSubmissionMode());
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener(AUDIO_ORCHESTRATOR_SUBMISSION_MODE_EVENT, handleOrchestratorModeChanged);

    return () => {
      disposed = true;
      unlisten();
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(AUDIO_ORCHESTRATOR_SUBMISSION_MODE_EVENT, handleOrchestratorModeChanged);
    };
  }, []);

  useEffect(() => () => {
    if (copiedAudioHistoryTimerRef.current) {
      window.clearTimeout(copiedAudioHistoryTimerRef.current);
      copiedAudioHistoryTimerRef.current = 0;
    }
    audioInputRunRef.current += 1;
    const audioInputPreview = audioInputPreviewRef.current;
    audioInputPreviewRef.current = null;
    if (audioInputPreview) {
      audioInputPreview.close().catch(() => {});
    }
  }, []);

  const closeUninstallModal = useCallback(() => {
    if (!isUninstalling) {
      setUninstallModalOpen(false);
    }
  }, [isUninstalling]);

  const confirmUninstall = useCallback(async () => {
    await onUninstallModel?.();
    setUninstallModalOpen(false);
  }, [onUninstallModel]);

  return (
    <AudioWorkspaceSurface aria-label="Workspace audio">
      <AudioTabBar role="tablist" aria-label="Audio settings sections">
        {AUDIO_SETTINGS_TABS.map((tab) => (
          <AudioTabButton
            aria-controls={`audio-tabpanel-${tab.id}`}
            aria-selected={activeAudioTab === tab.id}
            id={`audio-tab-${tab.id}`}
            key={tab.id}
            onClick={() => setActiveAudioTab(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </AudioTabButton>
        ))}
      </AudioTabBar>

      <AudioSetupPanel>
        <AudioHeroRow>
          <VaultPlaceholderIcon aria-hidden="true">
            <ButtonMicIcon />
          </VaultPlaceholderIcon>
          <div>
            <PanelKicker>Audio</PanelKicker>
            <PanelHeading>{workspace?.name || "Workspace"} dictation</PanelHeading>
            <PageSubline>{isCloudMode ? "Deepgram Nova-3 realtime dictation." : "Local Whisper dictation setup."}</PageSubline>
          </div>
          <AudioStatePill data-installed={recorderReady}>
            {audioModeStatusLabel}
          </AudioStatePill>
        </AudioHeroRow>

        {activeAudioTab === "general" && (
          <AudioTabPanel
            aria-labelledby="audio-tab-general"
            id="audio-tabpanel-general"
            role="tabpanel"
          >
        <AudioGeneralToolbar>
          <AudioProviderPanel aria-label="Transcription provider">
            <AudioDeviceHeader>
              <div>
                <SettingsLabel>Provider</SettingsLabel>
                <SettingsHint>{isCloudMode ? "Deepgram Nova-3" : "Local Whisper"}</SettingsHint>
              </div>
              <AudioStatePill data-installed={recorderReady}>
                {audioModeStatusLabel}
              </AudioStatePill>
            </AudioDeviceHeader>
            <AudioModeGrid role="group" aria-label="Transcription mode">
              <AudioModeButton
                aria-pressed={!isCloudMode}
                onClick={() => selectAudioMode(AUDIO_TRANSCRIPTION_PROVIDER_LOCAL)}
                type="button"
              >
                <ButtonMicIcon aria-hidden="true" />
                <span>
                  <strong>Local</strong>
                  <span>Whisper on this device</span>
                </span>
              </AudioModeButton>
              <AudioModeButton
                aria-pressed={isCloudMode}
                onClick={() => selectAudioMode(AUDIO_TRANSCRIPTION_PROVIDER_CLOUD)}
                type="button"
              >
                <ButtonHubIcon aria-hidden="true" />
                <span>
                  <strong>Cloud</strong>
                  <span>Deepgram Nova-3</span>
                </span>
              </AudioModeButton>
            </AudioModeGrid>
          </AudioProviderPanel>

          <AudioRecorderPanel aria-label="Recorder controls">
            <AudioDeviceHeader>
              <div>
                <SettingsLabel>Recorder</SettingsLabel>
                <SettingsHint>{recorderHint}</SettingsHint>
              </div>
              <AudioStatePill data-installed="true">
                {audioWidgetThemeLabel}
              </AudioStatePill>
            </AudioDeviceHeader>
            <AudioRecorderActions>
              <McpSwitchButton aria-pressed={autoOpenRecorder} onClick={toggleAutoOpenRecorder} type="button">
                <span aria-hidden="true" />
                Auto-open
              </McpSwitchButton>
              <RecorderOpenButton disabled={recorderActionDisabled} onClick={recorderAction} type="button">
                {recorderOpen ? (
                  <ButtonCloseIcon aria-hidden="true" />
                ) : (
                  <ButtonMicIcon aria-hidden="true" />
                )}
                <span>{recorderButtonLabel}</span>
              </RecorderOpenButton>
            </AudioRecorderActions>
            <AudioCloudField as="div">
              Widget theme
              <AudioModeGrid role="group" aria-label="Floating recorder theme">
                {AUDIO_WIDGET_THEME_OPTIONS.map((option) => (
                  <AudioModeButton
                    aria-pressed={audioWidgetTheme === option.id}
                    key={option.id}
                    onClick={() => updateAudioWidgetTheme(option.id)}
                    type="button"
                  >
                    {option.icon === "light" ? (
                      <ButtonLightModeIcon aria-hidden="true" />
                    ) : (
                      <ButtonDarkModeIcon aria-hidden="true" />
                    )}
                    <span>
                      <strong>{option.label}</strong>
                      <span>{option.detail}</span>
                    </span>
                  </AudioModeButton>
                ))}
              </AudioModeGrid>
            </AudioCloudField>
          </AudioRecorderPanel>

          <AudioRecorderPanel aria-label="Orchestrator voice controls">
            <AudioDeviceHeader>
              <div>
                <SettingsLabel>Orchestrator</SettingsLabel>
                <SettingsHint>{isManualOrchestratorMode ? "Manual submit" : "Auto submit"}</SettingsHint>
              </div>
              <AudioStatePill data-installed="true">
                {isManualOrchestratorMode ? "Manual" : "Auto"}
              </AudioStatePill>
            </AudioDeviceHeader>
            <AudioModeGrid role="group" aria-label="Orchestrator voice submission mode">
              <AudioModeButton
                aria-pressed={orchestratorSubmissionMode === AUDIO_ORCHESTRATOR_SUBMISSION_MODE_AUTO}
                onClick={() => updateOrchestratorSubmissionMode(AUDIO_ORCHESTRATOR_SUBMISSION_MODE_AUTO)}
                type="button"
              >
                <ButtonMicIcon aria-hidden="true" />
                <span>
                  <strong>Auto</strong>
                  <span>Submit on pause</span>
                </span>
              </AudioModeButton>
              <AudioModeButton
                aria-pressed={orchestratorSubmissionMode === AUDIO_ORCHESTRATOR_SUBMISSION_MODE_MANUAL}
                onClick={() => updateOrchestratorSubmissionMode(AUDIO_ORCHESTRATOR_SUBMISSION_MODE_MANUAL)}
                type="button"
              >
                <ButtonKeyIcon aria-hidden="true" />
                <span>
                  <strong>Manual</strong>
                  <span>Press to submit</span>
                </span>
              </AudioModeButton>
            </AudioModeGrid>
          </AudioRecorderPanel>
        </AudioGeneralToolbar>

        {isCloudMode && (
          <AudioDevicePanel aria-label="Deepgram cloud settings">
            <AudioDeviceHeader>
              <div>
                <SettingsLabel>Cloud transcription</SettingsLabel>
                <SettingsHint>Deepgram Nova-3 streams push-to-talk audio over a live WebSocket.</SettingsHint>
              </div>
              <AudioStatePill data-installed={deepgramReady}>
                {deepgramReady ? "Key saved" : "Key required"}
              </AudioStatePill>
            </AudioDeviceHeader>
            <AudioCloudGrid>
              <AudioCloudField>
                API key
                <AudioCloudInput
                  autoComplete="off"
                  onChange={updateDeepgramApiKey}
                  placeholder="Deepgram API key"
                  type="password"
                  value={deepgramApiKey}
                />
              </AudioCloudField>
              <AudioCloudField>
                Language
                <AudioDeviceSelect
                  aria-label="Deepgram language"
                  onChange={updateDeepgramLanguage}
                  value={deepgramLanguage}
                >
                  {DEEPGRAM_LANGUAGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </AudioDeviceSelect>
              </AudioCloudField>
            </AudioCloudGrid>
          </AudioDevicePanel>
        )}

        <AudioDevicePanel aria-label="Audio input settings">
          <AudioDeviceHeader>
            <div>
              <SettingsLabel>Input source</SettingsLabel>
              <SettingsHint>{audioInputMessage}</SettingsHint>
            </div>
            <AudioStatePill data-installed={audioInputState === "previewing"}>
              {audioInputStatusLabel}
            </AudioStatePill>
          </AudioDeviceHeader>

          <AudioDeviceControls>
            <AudioDeviceSelect
              aria-label="Microphone input source"
              disabled={audioInputState === "checking" || audioInputState === "starting"}
              onChange={selectAudioInputDevice}
              value={audioInputDeviceId}
            >
              {audioInputDevices.length ? (
                audioInputDevices.map((device, index) => (
                  <option key={`${device.deviceId || "default"}-${index}`} value={device.deviceId}>
                    {device.label}
                  </option>
                ))
              ) : (
                <option value="default">Default microphone</option>
              )}
            </AudioDeviceSelect>
            <SecondaryButton disabled={audioInputState === "checking" || audioInputState === "starting"} onClick={loadAudioInputDevices} type="button">
              <ButtonRefreshIcon aria-hidden="true" />
              <span>Refresh sources</span>
            </SecondaryButton>
            <PrimaryButton disabled={audioInputState === "checking" || audioInputState === "starting"} onClick={toggleAudioInputPreview} type="button">
              <ButtonMicIcon aria-hidden="true" />
              <span>{audioInputState === "previewing" ? "Stop monitor" : "Enable input"}</span>
            </PrimaryButton>
          </AudioDeviceControls>

          <AudioInputMeter
            aria-hidden="true"
            data-active={audioInputState === "previewing"}
            data-signal={audioInputState === "previewing" && audioInputHasSignal ? "live" : "quiet"}
          >
            {Array.from({ length: AUDIO_INPUT_METER_BARS }, (_, index) => (
              <span
                key={index}
                style={buildInputMeterBarStyle(index, audioInputLevel, audioInputState === "previewing")}
              />
            ))}
          </AudioInputMeter>
          <AudioInputMeta>
            {selectedAudioInputLabel} / level {formatAudioLevel(audioInputLevel)} / buffer {Math.round((audioInputStats.bufferMs || 0) / 1000)}s
          </AudioInputMeta>
        </AudioDevicePanel>

        <AudioDevicePanel aria-label="Audio shortcut settings">
          <AudioDeviceHeader>
            <div>
              <SettingsLabel>Bindings</SettingsLabel>
              <SettingsHint>{isToggleRecorderMode
                ? "Recorder shortcut toggles start and submit."
                : "Recorder shortcut records while held."}</SettingsHint>
            </div>
            <AudioStatePill data-installed={shortcutReady}>
              {isSavingShortcut || isOpeningShortcutPermissions
                ? "Checking"
                : shortcutPermissionMissing || shortcutQuarantineDetected
                  ? "Needs access"
                  : pushToTalkShortcutError || cancelShortcutError
                    ? "Conflict"
                    : "Ready"}
            </AudioStatePill>
          </AudioDeviceHeader>

          <AudioCloudField as="div">
            Mode
            <AudioModeGrid role="group" aria-label="Recorder mode">
              <AudioModeButton
                aria-pressed={recorderMode === AUDIO_RECORDER_MODE_PUSH_TO_TALK}
                onClick={() => updateRecorderMode(AUDIO_RECORDER_MODE_PUSH_TO_TALK)}
                type="button"
              >
                <ButtonKeyIcon aria-hidden="true" />
                <span>
                  <strong>Push to Talk</strong>
                  <span>Hold shortcut</span>
                </span>
              </AudioModeButton>
              <AudioModeButton
                aria-pressed={recorderMode === AUDIO_RECORDER_MODE_TOGGLE_TO_TALK}
                onClick={() => updateRecorderMode(AUDIO_RECORDER_MODE_TOGGLE_TO_TALK)}
                type="button"
              >
                <ButtonMicIcon aria-hidden="true" />
                <span>
                  <strong>Toggle to Talk</strong>
                  <span>Press start / stop</span>
                </span>
              </AudioModeButton>
            </AudioModeGrid>
          </AudioCloudField>

          <AudioShortcutGrid>
            <AudioShortcutCard data-error={Boolean(pushToTalkShortcutError)}>
              <span>Record shortcut</span>
              <AudioShortcutKey data-capturing={capturingAudioShortcut === AUDIO_SHORTCUT_ACTION_PUSH_TO_TALK}>
                {capturingAudioShortcut === AUDIO_SHORTCUT_ACTION_PUSH_TO_TALK
                  ? "Press key"
                  : formatShortcutLabel(pushToTalkShortcut)}
              </AudioShortcutKey>
              <AudioShortcutActions>
                <SecondaryButton
                  disabled={isSavingShortcut}
                  onClick={() => setCapturingAudioShortcut(AUDIO_SHORTCUT_ACTION_PUSH_TO_TALK)}
                  type="button"
                >
                  <ButtonKeyIcon aria-hidden="true" />
                  <span>{capturingAudioShortcut === AUDIO_SHORTCUT_ACTION_PUSH_TO_TALK ? "Listening..." : "Change"}</span>
                </SecondaryButton>
              </AudioShortcutActions>
              {pushToTalkShortcutError && <AudioInputMeta>{pushToTalkShortcutError}</AudioInputMeta>}
            </AudioShortcutCard>

            <AudioShortcutCard data-error={Boolean(cancelShortcutError)}>
              <span>Cancel</span>
              <AudioShortcutKey data-capturing={capturingAudioShortcut === AUDIO_SHORTCUT_ACTION_CANCEL}>
                {capturingAudioShortcut === AUDIO_SHORTCUT_ACTION_CANCEL
                  ? "Press key"
                  : formatShortcutLabel(cancelShortcut)}
              </AudioShortcutKey>
              <AudioShortcutActions>
                <SecondaryButton
                  disabled={isSavingShortcut}
                  onClick={() => setCapturingAudioShortcut(AUDIO_SHORTCUT_ACTION_CANCEL)}
                  type="button"
                >
                  <ButtonKeyIcon aria-hidden="true" />
                  <span>{capturingAudioShortcut === AUDIO_SHORTCUT_ACTION_CANCEL ? "Listening..." : "Change"}</span>
                </SecondaryButton>
              </AudioShortcutActions>
              {cancelShortcutError && <AudioInputMeta>{cancelShortcutError}</AudioInputMeta>}
            </AudioShortcutCard>
          </AudioShortcutGrid>

          <AudioRecorderOptionRow>
            <SettingsHint>Default: {formatShortcutLabel(effectiveShortcutStatus.pushToTalk?.defaultShortcut || defaultPushToTalkShortcut())} / {formatShortcutLabel(effectiveShortcutStatus.cancel?.defaultShortcut || "Escape")}</SettingsHint>
            <SecondaryButton disabled={isSavingShortcut} onClick={resetAudioShortcuts} type="button">
              <ButtonRefreshIcon aria-hidden="true" />
              <span>Reset defaults</span>
            </SecondaryButton>
          </AudioRecorderOptionRow>

          {shortcutPermissionMissing && (
            <>
              <AudioRuntimeHint>{shortcutPermissions.message || "Enable Accessibility for Diff Forge AI, then restart the app."}</AudioRuntimeHint>
              <AudioRecorderOptionRow>
                <SettingsHint>System Settings / Privacy & Security / Accessibility</SettingsHint>
                <SecondaryButton disabled={isOpeningShortcutPermissions} onClick={openAudioShortcutPermissions} type="button">
                  <ButtonKeyIcon aria-hidden="true" />
                  <span>{isOpeningShortcutPermissions ? "Opening..." : "Open Settings"}</span>
                </SecondaryButton>
              </AudioRecorderOptionRow>
            </>
          )}

          {shortcutQuarantineDetected && (
            <>
              <AudioRuntimeHint>
                {shortcutPermissions.message || "Remove the macOS quarantine attribute, then restart the app."}
              </AudioRuntimeHint>
              {shortcutPermissions.quarantineFixCommand && (
                <AudioShortcutKey>{shortcutPermissions.quarantineFixCommand}</AudioShortcutKey>
              )}
            </>
          )}

          {audioShortcutError && <FormMessage $state="error">{audioShortcutError}</FormMessage>}
        </AudioDevicePanel>

        {!isCloudMode && audioModelStatus && !audioModelStatus.runtimeInstalled && (
          <AudioRuntimeHint>{audioModelStatus.runtimeInstallHint}</AudioRuntimeHint>
        )}

        {!isCloudMode && audioDownloadProgress && (
          <AudioProgressPanel>
            <AudioProgressTopline>
              <strong>{audioDownloadProgress.message || "Downloading local Whisper weights."}</strong>
              <span>{formatAudioPercent(downloadPercent)}</span>
            </AudioProgressTopline>
            <AudioProgressTrack aria-hidden="true">
              <AudioProgressBar $progress={Number(downloadPercent) || 0} />
            </AudioProgressTrack>
            <AudioProgressMeta>
              {formatFileSize(audioDownloadProgress.downloadedBytes || 0)}
              {audioDownloadProgress.totalBytes ? ` / ${formatFileSize(audioDownloadProgress.totalBytes)}` : ""}
            </AudioProgressMeta>
          </AudioProgressPanel>
        )}

        {audioError && <FormMessage $state="error">{audioError}</FormMessage>}

        {!isCloudMode && (
          <AudioActionRow>
            {!installed && (
              <PrimaryButton disabled={isBusy} onClick={onDownloadModel} type="button">
                <ButtonMicIcon aria-hidden="true" />
                <span>{audioActionState === "downloading" ? "Downloading..." : installLabel}</span>
              </PrimaryButton>
            )}
            <SecondaryButton disabled={isBusy} onClick={onRefreshStatus} type="button">
              <ButtonRefreshIcon aria-hidden="true" />
              <span>{audioStatusState === "checking" ? "Checking..." : "Recheck"}</span>
            </SecondaryButton>
            {canUninstall && (
              <PrimaryDangerButton disabled={isBusy} onClick={() => setUninstallModalOpen(true)} type="button">
                <ButtonDeleteIcon aria-hidden="true" />
                <span>{audioActionState === "uninstalling" ? "Uninstalling..." : "Uninstall Whisper"}</span>
              </PrimaryDangerButton>
            )}
          </AudioActionRow>
        )}
          </AudioTabPanel>
        )}

        {activeAudioTab === "dictionary" && (
          <AudioDictionaryPanel
            aria-labelledby="audio-tab-dictionary"
            id="audio-tabpanel-dictionary"
            role="tabpanel"
          />
        )}

        {activeAudioTab === "history" && (
          <AudioHistoryPanel
            aria-labelledby="audio-tab-history"
            id="audio-tabpanel-history"
            role="tabpanel"
          >
            <AudioHistoryStats aria-label="Speech to text statistics">
              {audioHistoryStats.map((stat) => (
                <AudioHistoryStatChip key={stat.label}>
                  <span>{stat.label}</span>
                  <strong>{stat.value}</strong>
                </AudioHistoryStatChip>
              ))}
            </AudioHistoryStats>

            {audioHistory.length ? (
              <AudioHistoryVirtualList
                aria-label="Speech to text history"
                onScroll={handleAudioHistoryScroll}
                role="list"
              >
                <AudioHistoryListSpacer style={{ height: audioHistoryListHeight }}>
                  {visibleAudioHistory.map(({ entry, index }) => {
                    const entryKey = getAudioHistoryEntryKey(entry, index);
                    const copied = copiedAudioHistoryId === entryKey;

                    return (
                      <AudioHistoryRow
                        key={entryKey}
                        role="listitem"
                        style={{
                          height: AUDIO_HISTORY_ROW_HEIGHT - 8,
                          transform: `translateY(${index * AUDIO_HISTORY_ROW_HEIGHT}px)`,
                        }}
                      >
                        <AudioHistoryRowTopline>
                          <span>{formatHistoryTimestamp(entry.createdAt)}</span>
                          <AudioHistoryRowActions>
                            <AudioHistoryProvider data-provider={entry.provider}>
                              {formatAudioProviderLabel(entry.provider)}
                            </AudioHistoryProvider>
                            <AudioHistoryCopyButton
                              aria-label="Copy previous prompt"
                              data-copied={copied ? "true" : undefined}
                              onClick={() => copyAudioHistoryPrompt(entry, index)}
                              title="Copy previous prompt"
                              type="button"
                            >
                              {copied ? (
                                <ButtonCheckIcon aria-hidden="true" />
                              ) : (
                                <ButtonCopyIcon aria-hidden="true" />
                              )}
                              <span>{copied ? "Copied" : "Copy"}</span>
                            </AudioHistoryCopyButton>
                          </AudioHistoryRowActions>
                        </AudioHistoryRowTopline>
                        <strong title={entry.text}>{entry.text}</strong>
                        <AudioHistoryMeta>{formatAudioHistoryMeta(entry)}</AudioHistoryMeta>
                      </AudioHistoryRow>
                    );
                  })}
                </AudioHistoryListSpacer>
              </AudioHistoryVirtualList>
            ) : (
              <SettingsHint>No speech to text history yet.</SettingsHint>
            )}
          </AudioHistoryPanel>
        )}
      </AudioSetupPanel>

      {isUninstallModalOpen && (
        <WorkspaceSettingsOverlay
          aria-label="Uninstall Whisper confirmation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeUninstallModal();
            }
          }}
        >
          <WorkspaceSettingsDialog
            aria-labelledby="audio-uninstall-title"
            aria-modal="true"
            role="dialog"
          >
            <WorkspaceSettingsDialogHeader>
              <div>
                <PanelKicker>Audio</PanelKicker>
                <PanelHeading id="audio-uninstall-title">Uninstall Whisper?</PanelHeading>
              </div>
              <WorkspaceModalCloseButton
                aria-label="Close uninstall confirmation"
                disabled={isUninstalling}
                onClick={closeUninstallModal}
                title="Close"
                type="button"
              >
                <ButtonCloseIcon aria-hidden="true" />
              </WorkspaceModalCloseButton>
            </WorkspaceSettingsDialogHeader>

            <AgentInstallMessage data-tone="warning">
              Remove the local Whisper model and (Diff Forge-installed) Whisper runtime from this device. External whisper.cpp runtimes on PATH stay installed.
            </AgentInstallMessage>

            <WorkspaceSettingsActions>
              <SecondaryButton disabled={isUninstalling} onClick={closeUninstallModal} type="button">
                <ButtonCloseIcon aria-hidden="true" />
                <span>Cancel</span>
              </SecondaryButton>
              <PrimaryDangerButton disabled={isUninstalling} onClick={confirmUninstall} type="button">
                <ButtonDeleteIcon aria-hidden="true" />
                <span>{isUninstalling ? "Uninstalling..." : "Uninstall"}</span>
              </PrimaryDangerButton>
            </WorkspaceSettingsActions>
          </WorkspaceSettingsDialog>
        </WorkspaceSettingsOverlay>
      )}
    </AudioWorkspaceSurface>
  );
}

export function AudioWidgetWindow() {
  const [modelStatus, setModelStatus] = useState(null);
  const [transcriptionProvider, setTranscriptionProvider] = useState(readAudioTranscriptionProvider);
  const [deepgramApiKey, setDeepgramApiKey] = useState(readDeepgramApiKey);
  const [deepgramLanguage, setDeepgramLanguage] = useState(readDeepgramLanguage);
  const [widgetState, setWidgetState] = useState("checking");
  const [message, setMessage] = useState("Checking audio");
  const [error, setError] = useState("");
  const [recordingStartedAt, setRecordingStartedAt] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [widgetAudioStats, setWidgetAudioStats] = useState(EMPTY_AUDIO_INPUT_STATS);
  const [widgetChromeReady, setWidgetChromeReady] = useState(false);
  const [widgetFrameMode, setWidgetFrameModeState] = useState("compact");
  const [shortcutStatus, setShortcutStatus] = useState(fallbackShortcutStatus);
  const [realtimeTranscript, setRealtimeTranscript] = useState("");
  const [recorderMode, setRecorderMode] = useState(readAudioRecorderMode);
  const [audioWidgetTheme, setAudioWidgetTheme] = useState(readAudioWidgetTheme);
  const audioBufferRef = useRef(null);
  const audioBufferGenerationRef = useRef(0);
  const audioBufferReadyAtRef = useRef(0);
  const audioBufferStartRef = useRef(null);
  const pushToTalkDownRef = useRef(false);
  const recordingRunRef = useRef(0);
  const stopAfterStartRef = useRef(false);
  const stopRecordingRef = useRef(null);
  const recorderModeRef = useRef(recorderMode);
  const widgetFrameModeRef = useRef(widgetFrameMode);
  const widgetStateRef = useRef(widgetState);

  useEffect(() => {
    widgetStateRef.current = widgetState;
  }, [widgetState]);

  useEffect(() => {
    recorderModeRef.current = recorderMode;
  }, [recorderMode]);

  useEffect(() => {
    applyAudioWidgetThemePreference(audioWidgetTheme);
  }, [audioWidgetTheme]);

  const setWidgetFrameMode = useCallback((nextMode) => {
    widgetFrameModeRef.current = nextMode;
    setWidgetFrameModeState(nextMode);
  }, []);

  const resetWidgetToStartState = useCallback(() => {
    const currentProvider = readAudioTranscriptionProvider();
    const currentRecorderMode = readAudioRecorderMode();
    const currentApiKey = readDeepgramApiKey();
    const currentLanguage = readDeepgramLanguage();
    const currentWidgetTheme = readAudioWidgetTheme();
    const hasSetup = hasAudioInputSetup();

    setTranscriptionProvider(currentProvider);
    setRecorderMode(currentRecorderMode);
    setAudioWidgetTheme(currentWidgetTheme);
    setDeepgramApiKey(currentApiKey);
    setDeepgramLanguage(currentLanguage);
    setWidgetAudioStats(EMPTY_AUDIO_INPUT_STATS);
    setRealtimeTranscript("");
    setRecordingStartedAt(0);
    setElapsedMs(0);
    setError("");

    if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
      const hasApiKey = Boolean(currentApiKey.trim());
      const nextState = hasApiKey ? (hasSetup ? "ready" : "setup") : "missing";
      widgetStateRef.current = nextState;
      setWidgetState(nextState);
      setModelStatus(null);
      setMessage(hasApiKey
        ? (hasSetup ? "Deepgram ready" : "Audio setup needed")
        : "Add Deepgram key");
      return;
    }

    if (!modelStatus?.installed) {
      widgetStateRef.current = "missing";
      setWidgetState("missing");
      setMessage("Install Whisper from the Audio tab.");
      return;
    }

    widgetStateRef.current = hasSetup ? "ready" : "setup";
    setWidgetState(hasSetup ? "ready" : "setup");
    setMessage(hasSetup ? "Model ready" : "Audio setup needed");
  }, [modelStatus?.installed]);

  const startWarmBuffer = useCallback(async () => {
    if (audioBufferRef.current) {
      return audioBufferRef.current;
    }

    if (audioBufferStartRef.current) {
      return audioBufferStartRef.current;
    }

    if (!hasAudioInputSetup()) {
      throw new Error("Choose and enable a microphone in the Audio tab before recording.");
    }

    const bufferGeneration = audioBufferGenerationRef.current;
    setMessage("Buffering input");
    const startPromise = (async () => {
      const audioBuffer = await startLowPowerAudioBuffer({
        deviceId: readSelectedAudioInputDeviceId(),
        owner: "audio-widget",
        onStats: setWidgetAudioStats,
      });

      if (audioBufferGenerationRef.current !== bufferGeneration) {
        await audioBuffer.close().catch(() => {});
        throw new Error("Audio input buffering was canceled.");
      }

      audioBufferRef.current = audioBuffer;
      audioBufferReadyAtRef.current = Date.now();
      setMessage("Input buffered");

      return audioBuffer;
    })();

    audioBufferStartRef.current = startPromise;

    try {
      return await startPromise;
    } finally {
      if (audioBufferStartRef.current === startPromise) {
        audioBufferStartRef.current = null;
      }
    }
  }, []);

  const closeWarmBuffer = useCallback(async () => {
    audioBufferGenerationRef.current += 1;
    audioBufferStartRef.current = null;
    audioBufferReadyAtRef.current = 0;
    const audioBuffer = audioBufferRef.current;
    audioBufferRef.current = null;
    await audioBuffer?.close?.().catch(() => {});
  }, []);

  const waitForWarmPrerollBuffer = useCallback(async () => {
    const audioBuffer = await startWarmBuffer();
    const bufferedMs = Date.now() - audioBufferReadyAtRef.current;

    if (bufferedMs < AUDIO_WIDGET_PREROLL_READY_MS) {
      await waitForAudioPostBuffer(AUDIO_WIDGET_PREROLL_READY_MS - bufferedMs);
    }

    return audioBuffer;
  }, [startWarmBuffer]);

  const startRecording = useCallback(async ({ skipPrerollWait = false } = {}) => {
    const currentState = widgetStateRef.current;
    const currentProvider = readAudioTranscriptionProvider();

    if (currentState === "recording" || currentState === "transcribing") {
      return;
    }

    if (currentState === "setup") {
      setError("Choose and enable a microphone in the Audio tab before recording.");
      return;
    }

    if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
      if (!readDeepgramApiKey().trim()) {
        setError("Add a Deepgram API key in the Audio tab before recording.");
        return;
      }
    } else if (!modelStatus?.installed) {
      setError("Install Whisper from the Audio tab before recording.");
      return;
    }

    if (currentState === "checking" || currentState === "warming") {
      return;
    }

    const recordingRunId = recordingRunRef.current + 1;
    recordingRunRef.current = recordingRunId;
    setError("");
    setMessage("Arming buffer");
    setRealtimeTranscript("");
    setWidgetAudioStats(EMPTY_AUDIO_INPUT_STATS);
    widgetStateRef.current = "arming";
    setWidgetState("arming");

    let audioBuffer = null;
    let captureBegan = false;

    try {
      audioBuffer = skipPrerollWait ? await startWarmBuffer() : await waitForWarmPrerollBuffer();
      if (recordingRunRef.current !== recordingRunId) {
        if (audioBufferRef.current === audioBuffer) {
          await closeWarmBuffer();
        } else {
          await audioBuffer.close().catch(() => {});
        }
        return;
      }
      await audioBuffer.beginCapture();
      captureBegan = true;
      if (recordingRunRef.current !== recordingRunId) {
        await audioBuffer.finishCapture().catch(() => null);
        if (audioBufferRef.current === audioBuffer) {
          await closeWarmBuffer();
        } else {
          await audioBuffer.close().catch(() => {});
        }
        return;
      }
      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
        setMessage("Opening Deepgram stream");
        await invoke("start_deepgram_realtime_transcription", {
          request: {
            apiKey: readDeepgramApiKey(),
            language: readDeepgramLanguage(),
          },
        });
      }
      if (recordingRunRef.current !== recordingRunId) {
        if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
          await invoke("stop_deepgram_realtime_transcription").catch(() => {});
        }
        await audioBuffer.finishCapture().catch(() => null);
        if (audioBufferRef.current === audioBuffer) {
          await closeWarmBuffer();
        } else {
          await audioBuffer.close().catch(() => {});
        }
        return;
      }
      setRecordingStartedAt(Date.now());
      setElapsedMs(0);
      widgetStateRef.current = "recording";
      setWidgetState("recording");
      setMessage(currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD ? "Deepgram listening" : "Recording");

      if (stopAfterStartRef.current || !pushToTalkDownRef.current) {
        stopAfterStartRef.current = false;
        window.setTimeout(() => stopRecordingRef.current?.(), 0);
      }
    } catch (recordingError) {
      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
        await invoke("stop_deepgram_realtime_transcription").catch(() => {});
      }
      const failedAudioBuffer = audioBufferRef.current || audioBuffer;
      if (captureBegan) {
        await failedAudioBuffer?.finishCapture?.().catch(() => null);
      }
      if (failedAudioBuffer && audioBufferRef.current === failedAudioBuffer) {
        await closeWarmBuffer();
      } else {
        audioBufferRef.current = null;
        await failedAudioBuffer?.close?.().catch(() => {});
      }
      if (recordingRunRef.current !== recordingRunId) {
        return;
      }
      pushToTalkDownRef.current = false;
      stopAfterStartRef.current = false;
      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(getAudioInputErrorMessage(recordingError, "Choose and enable a microphone in the Audio tab before recording."));
    }
  }, [closeWarmBuffer, modelStatus?.installed, startWarmBuffer, waitForWarmPrerollBuffer]);

  const refreshStatus = useCallback(async () => {
    const currentProvider = readAudioTranscriptionProvider();
    const currentRecorderMode = readAudioRecorderMode();
    const currentApiKey = readDeepgramApiKey();
    const currentLanguage = readDeepgramLanguage();
    const currentWidgetTheme = readAudioWidgetTheme();
    setTranscriptionProvider(currentProvider);
    setRecorderMode(currentRecorderMode);
    setAudioWidgetTheme(currentWidgetTheme);
    setDeepgramApiKey(currentApiKey);
    setDeepgramLanguage(currentLanguage);
    widgetStateRef.current = "checking";
    setWidgetState("checking");
    setError("");
    setRealtimeTranscript("");

    if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
      const hasSetup = hasAudioInputSetup();
      const hasApiKey = Boolean(currentApiKey.trim());
      const nextState = hasApiKey ? (hasSetup ? "ready" : "setup") : "missing";
      widgetStateRef.current = nextState;
      setWidgetState(nextState);
      setModelStatus(null);
      setMessage(hasApiKey
        ? (hasSetup ? "Deepgram ready" : "Audio setup needed")
        : "Add Deepgram key");
      return;
    }

    try {
      const status = await invoke("whisper_model_status");
      setModelStatus(status);
      if (status.installed) {
        widgetStateRef.current = "warming";
        setWidgetState("warming");
        try {
          setMessage("Preparing model");
          await prepareWhisperModel();
          const hasSetup = hasAudioInputSetup();
          widgetStateRef.current = hasSetup ? "ready" : "setup";
          setWidgetState(hasSetup ? "ready" : "setup");
          setMessage(hasSetup ? "Model ready" : "Audio setup needed");
        } catch (inputError) {
          widgetStateRef.current = "error";
          setWidgetState("error");
          setMessage("Model unavailable");
          setError(getErrorMessage(inputError, "Unable to prepare local Whisper."));
          return;
        }
      } else {
        widgetStateRef.current = "missing";
        setWidgetState("missing");
      }
      if (!status.installed) {
        setMessage("Install Whisper from the Audio tab.");
      }
    } catch (statusError) {
      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(getErrorMessage(statusError, "Unable to check Whisper."));
    }
  }, []);

  const refreshShortcutStatus = useCallback(async () => {
    try {
      const status = await invoke("audio_shortcuts_status");
      setShortcutStatus(status || fallbackShortcutStatus());
    } catch {
      setShortcutStatus(fallbackShortcutStatus());
    }
  }, []);

  const runWidgetWindowAction = useCallback((action) => {
    try {
      Promise.resolve(action(getCurrentWindow())).catch(() => {});
    } catch {
      // Native widget chrome is best-effort.
    }
  }, []);

  const widgetTargetMode = isFocusedAudioWidgetState(widgetState) ? "focus" : "compact";

  useEffect(() => {
    const wantsFocus = widgetTargetMode === "focus";
    let firstFrame = 0;
    let secondFrame = 0;
    let closeTimer = 0;
    let handoffFrame = 0;
    let resizeFrame = 0;
    let compactFrame = 0;

    setWidgetChromeReady(false);

    if (wantsFocus) {
      setWidgetFrameMode("opening");
      runWidgetWindowAction((windowHandle) => (
        windowHandle.setSize(new LogicalSize(AUDIO_WIDGET_FOCUS_SIZE.width, AUDIO_WIDGET_FOCUS_SIZE.height))
      ));
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          if (!isFocusedAudioWidgetState(widgetStateRef.current)) {
            return;
          }

          setWidgetFrameMode("focus");
          setWidgetChromeReady(true);
        });
      });
    } else if (widgetFrameModeRef.current === "focus" || widgetFrameModeRef.current === "opening") {
      setWidgetFrameMode("closing");
      closeTimer = window.setTimeout(() => {
        if (isFocusedAudioWidgetState(widgetStateRef.current)) {
          return;
        }

        setWidgetFrameMode("compact-handoff");
        setWidgetAudioStats(EMPTY_AUDIO_INPUT_STATS);

        handoffFrame = window.requestAnimationFrame(() => {
          if (isFocusedAudioWidgetState(widgetStateRef.current)) {
            return;
          }

          runWidgetWindowAction((windowHandle) => (
            windowHandle.setSize(new LogicalSize(AUDIO_WIDGET_COMPACT_SIZE.width, AUDIO_WIDGET_COMPACT_SIZE.height))
          ));

          resizeFrame = window.requestAnimationFrame(() => {
            if (isFocusedAudioWidgetState(widgetStateRef.current)) {
              return;
            }

            compactFrame = window.requestAnimationFrame(() => {
              if (isFocusedAudioWidgetState(widgetStateRef.current)) {
                return;
              }

              setWidgetFrameMode("compact");
            });
          });
        });
      }, AUDIO_WIDGET_CLOSE_ANIMATION_MS);
    } else if (widgetFrameModeRef.current !== "closing" && widgetFrameModeRef.current !== "compact-handoff") {
      setWidgetFrameMode("compact");
      runWidgetWindowAction((windowHandle) => (
        windowHandle.setSize(new LogicalSize(AUDIO_WIDGET_COMPACT_SIZE.width, AUDIO_WIDGET_COMPACT_SIZE.height))
      ));
    }

    return () => {
      if (firstFrame) {
        window.cancelAnimationFrame(firstFrame);
      }
      if (secondFrame) {
        window.cancelAnimationFrame(secondFrame);
      }
      if (closeTimer) {
        window.clearTimeout(closeTimer);
      }
      if (handoffFrame) {
        window.cancelAnimationFrame(handoffFrame);
      }
      if (resizeFrame) {
        window.cancelAnimationFrame(resizeFrame);
      }
      if (compactFrame) {
        window.cancelAnimationFrame(compactFrame);
      }
    };
  }, [runWidgetWindowAction, setWidgetFrameMode, widgetTargetMode]);

  const dragWidget = useCallback((event) => {
    if (event.button !== 0) {
      return;
    }

    runWidgetWindowAction((windowHandle) => windowHandle.startDragging());
  }, [runWidgetWindowAction]);

  const minimizeWidget = useCallback(() => {
    runWidgetWindowAction((windowHandle) => windowHandle.minimize());
  }, [runWidgetWindowAction]);

  const closeWidget = useCallback(() => {
    runWidgetWindowAction((windowHandle) => windowHandle.close());
  }, [runWidgetWindowAction]);

  const pressPushToTalk = useCallback(() => {
    if (pushToTalkDownRef.current) {
      return;
    }

    if (isBusyAudioWidgetState(widgetStateRef.current)) {
      pushToTalkDownRef.current = false;
      stopAfterStartRef.current = false;
      return;
    }

    pushToTalkDownRef.current = true;
    stopAfterStartRef.current = false;
    startRecording();
  }, [startRecording]);

  const releasePushToTalk = useCallback(() => {
    pushToTalkDownRef.current = false;

    if (widgetStateRef.current === "recording") {
      stopRecordingRef.current?.();
    } else if (widgetStateRef.current === "arming") {
      stopAfterStartRef.current = true;
    }
  }, []);

  const toggleTalk = useCallback(() => {
    const currentState = widgetStateRef.current;

    if (currentState === "recording") {
      pushToTalkDownRef.current = false;
      stopAfterStartRef.current = false;
      stopRecordingRef.current?.();
      return;
    }

    if (currentState === "arming") {
      pushToTalkDownRef.current = false;
      stopAfterStartRef.current = true;
      return;
    }

    if (currentState === "transcribing" || currentState === "checking" || currentState === "warming") {
      return;
    }

    const shouldKeepRecordingAfterStart = currentState !== "setup" && currentState !== "missing";
    pushToTalkDownRef.current = shouldKeepRecordingAfterStart;
    stopAfterStartRef.current = false;
    startRecording();
  }, [startRecording]);

  const handleRecorderShortcutPressed = useCallback(() => {
    if (recorderModeRef.current === AUDIO_RECORDER_MODE_TOGGLE_TO_TALK) {
      toggleTalk();
      return;
    }

    pressPushToTalk();
  }, [pressPushToTalk, toggleTalk]);

  const handleRecorderShortcutReleased = useCallback(() => {
    if (recorderModeRef.current === AUDIO_RECORDER_MODE_TOGGLE_TO_TALK) {
      return;
    }

    releasePushToTalk();
  }, [releasePushToTalk]);

  const stopRecording = useCallback(async () => {
    const audioBuffer = audioBufferRef.current;
    const recordingRunId = recordingRunRef.current;

    if (!audioBuffer || widgetStateRef.current !== "recording") {
      return;
    }

    pushToTalkDownRef.current = false;
    stopAfterStartRef.current = false;
    widgetStateRef.current = "transcribing";
    setWidgetState("transcribing");
    setMessage("Preparing audio");
    setError("");

    try {
      const currentProvider = readAudioTranscriptionProvider();
    const result = currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
      ? await (async () => {
          setMessage("Capturing final audio");
          await waitForAudioPostBuffer(DEEPGRAM_RELEASE_POST_BUFFER_MS);
          if (recordingRunRef.current !== recordingRunId) {
            throw new Error("Deepgram transcription canceled.");
          }
          setMessage("Closing Deepgram stream");
          const realtimeResult = await invoke("stop_deepgram_realtime_transcription");
          const captureResult = await audioBuffer.finishCapture().catch(() => null);
          return {
            ...(realtimeResult || {}),
            audioMs: Number(captureResult?.audioMs || realtimeResult?.audioMs || 0),
          };
        })()
        : await (async () => {
          const { wavBuffer, audioMs } = await audioBuffer.finishCapture();
          const { peak, rms } = audioBuffer.getCaptureStats();
          const audioBase64 = arrayBufferToBase64(wavBuffer);
          setMessage("Transcribing locally");
          const transcriptionResult = await invoke("transcribe_whisper_audio", {
            request: {
              audioBase64,
              audioMs,
              capturePeak: peak,
              captureRms: rms,
            },
          });
          return {
            ...(transcriptionResult || {}),
            audioMs,
          };
      })();
      if (recordingRunRef.current !== recordingRunId) {
        return;
      }
      setMessage(currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
        ? "Deepgram final"
        : "Transcribed locally");
      const nextTranscript = (result?.text || "").trim();

      if (!nextTranscript) {
        if (recordingRunRef.current !== recordingRunId) {
          return;
        }
        widgetStateRef.current = "ready";
        setWidgetState("ready");
        setMessage("No transcript returned");
        return;
      }

      await publishAudioTranscriptionResult({
        audioMs: Number(result?.audioMs || 0),
        createdAt: new Date().toISOString(),
        id: `${Date.now()}`,
        language: currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD ? readDeepgramLanguage() : "",
        provider: currentProvider,
        source: currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD ? "deepgram-nova-3-live" : "whisper-local",
        text: nextTranscript,
      });

      if (recordingRunRef.current !== recordingRunId) {
        return;
      }

      try {
        setMessage("Inserting into target");
        await invoke("insert_handsfree_transcribed_text", {
          text: nextTranscript,
        });
        if (recordingRunRef.current !== recordingRunId) {
          return;
        }
        setMessage("Inserted into target");
      } catch (insertError) {
        if (recordingRunRef.current !== recordingRunId) {
          return;
        }
        setMessage("Sent to Audio tab");
        setError(getErrorMessage(insertError, "Transcript saved, but focused insertion failed."));
      }

      if (recordingRunRef.current !== recordingRunId) {
        return;
      }
      widgetStateRef.current = "ready";
      setWidgetState("ready");
    } catch (recordingError) {
      if (audioBufferRef.current === audioBuffer) {
        await closeWarmBuffer();
      } else {
        await audioBuffer.close().catch(() => {});
      }
      if (recordingRunRef.current !== recordingRunId) {
        return;
      }
      setWidgetAudioStats(EMPTY_AUDIO_INPUT_STATS);
      const messageText = getErrorMessage(recordingError, "Unable to transcribe audio.");

      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(messageText);
    }
  }, [closeWarmBuffer]);

  const cancelRecording = useCallback(async () => {
    recordingRunRef.current += 1;
    pushToTalkDownRef.current = false;
    stopAfterStartRef.current = false;

    const currentProvider = readAudioTranscriptionProvider();

    if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
      await invoke("stop_deepgram_realtime_transcription").catch(() => {});
    } else {
      await invoke("cancel_whisper_transcription").catch(() => {});
    }

    await closeWarmBuffer();
    resetWidgetToStartState();
  }, [closeWarmBuffer, resetWidgetToStartState]);

  const forwardEscapeToActiveTerminal = useCallback((fields = {}) => {
    invoke("terminal_write_to_audio_input_target", { data: "\x1b" })
      .then((wrote) => {
      })
      .catch((error) => {
      });
  }, []);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  useEffect(() => {
    refreshStatus();
    refreshShortcutStatus();

    return () => {
      closeWarmBuffer();
    };
  }, [closeWarmBuffer, refreshShortcutStatus, refreshStatus]);

  useEffect(() => {
    if (widgetState !== "ready" || !hasAudioInputSetup()) {
      return undefined;
    }

    const providerReady = transcriptionProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
      ? Boolean(deepgramApiKey.trim())
      : Boolean(modelStatus?.installed);

    if (!providerReady) {
      return undefined;
    }

    let disposed = false;

    startWarmBuffer().catch((bufferError) => {
      if (disposed || widgetStateRef.current !== "ready") {
        return;
      }

      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(getAudioInputErrorMessage(bufferError, "Unable to keep microphone input ready."));
    });

    return () => {
      disposed = true;
    };
  }, [deepgramApiKey, modelStatus?.installed, startWarmBuffer, transcriptionProvider, widgetState]);

  useEffect(() => {
    if (widgetState === "setup" || widgetState === "missing" || widgetState === "error") {
      closeWarmBuffer();
    }
  }, [closeWarmBuffer, widgetState]);

  useEffect(() => {
    let disposed = false;
    let refreshTimer = 0;
    let unlistenSettingsChanged = () => {};

    const refreshAudioSettings = () => {
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }

      refreshTimer = window.setTimeout(() => {
        refreshTimer = 0;

        if (disposed || isBusyAudioWidgetState(widgetStateRef.current)) {
          return;
        }

        refreshStatus();
        refreshShortcutStatus();
      }, 0);
    };

    const syncAudioSettings = (event) => {
      const reason = event?.payload?.reason || "";
      setRecorderMode(readAudioRecorderMode());
      setAudioWidgetTheme(readAudioWidgetTheme());
      setTranscriptionProvider(readAudioTranscriptionProvider());
      setDeepgramApiKey(readDeepgramApiKey());
      setDeepgramLanguage(readDeepgramLanguage());

      if (reason !== "widget-theme") {
        refreshAudioSettings();
      }
    };

    const handleStorage = (event) => {
      if (event.key === AUDIO_WIDGET_THEME_STORAGE_KEY) {
        setAudioWidgetTheme(readAudioWidgetTheme());
        return;
      }

      if (event.key?.startsWith?.("diffforge.audio.")) {
        syncAudioSettings();
      }
    };

    window.addEventListener("storage", handleStorage);
    listen(AUDIO_SETTINGS_CHANGED_EVENT, syncAudioSettings)
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlistenSettingsChanged = nextUnlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (refreshTimer) {
        window.clearTimeout(refreshTimer);
      }
      unlistenSettingsChanged();
      window.removeEventListener("storage", handleStorage);
    };
  }, [refreshShortcutStatus, refreshStatus]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(AUDIO_SHORTCUTS_CHANGED_EVENT, (event) => {
      if (!disposed) {
        setShortcutStatus(event.payload || fallbackShortcutStatus());
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
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(AUDIO_REALTIME_TRANSCRIPT_EVENT, (event) => {
      if (disposed) {
        return;
      }

      const text = String(event.payload?.text || "").trim();
      if (!text) {
        return;
      }

      setRealtimeTranscript(text);
      setMessage(event.payload?.isFinal ? "Deepgram finalizing" : "Deepgram live");
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
  }, []);

  useEffect(() => {
    if (widgetState !== "recording") {
      return undefined;
    }

    const timer = window.setInterval(() => {
      const nextElapsedMs = Date.now() - recordingStartedAt;
      setElapsedMs(nextElapsedMs);

      if (nextElapsedMs >= AUDIO_RECORDING_MAX_SECONDS * 1000) {
        stopRecording();
        return;
      }
    }, AUDIO_RECORDING_TIMER_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [recordingStartedAt, stopRecording, widgetState]);

  useEffect(() => {
    if (widgetState === "ready" && pushToTalkDownRef.current) {
      startRecording();
    }
  }, [startRecording, widgetState]);

  const applyPushToTalkPayload = useCallback((payload) => {
    if (payload?.pressed || payload?.phase === "pressed") {
      handleRecorderShortcutPressed();
      return;
    }

    handleRecorderShortcutReleased();
  }, [handleRecorderShortcutPressed, handleRecorderShortcutReleased]);

  useEffect(() => {
    document.documentElement.dataset.audioWidget = "true";
    document.documentElement.dataset.audioWidgetTheme = normalizeAudioWidgetTheme(audioWidgetTheme);
    document.body.dataset.audioWidget = "true";
    document.body.dataset.audioWidgetTheme = normalizeAudioWidgetTheme(audioWidgetTheme);

    return () => {
      delete document.documentElement.dataset.audioWidget;
      delete document.documentElement.dataset.audioWidgetTheme;
      delete document.body.dataset.audioWidget;
      delete document.body.dataset.audioWidgetTheme;
    };
  }, [audioWidgetTheme]);

  const widgetPushToTalkShortcut = shortcutStatus?.pushToTalk?.shortcut || defaultPushToTalkShortcut();
  const widgetCancelShortcut = shortcutStatus?.cancel?.shortcut || "Escape";

  useEffect(() => {
    const onKeyDown = (event) => {
      if (shortcutMatchesEvent(widgetCancelShortcut, event)) {
        const widgetStateValue = widgetStateRef.current;
        const canCancelAudioRequest = pushToTalkDownRef.current
          || widgetStateValue === "arming"
          || widgetStateValue === "processing"
          || widgetStateValue === "recording"
          || widgetStateValue === "transcribing";
        if (!canCancelAudioRequest) {
          return;
        }

        const action = canCancelAudioRequest
          ? "cancel_audio_and_forward_terminal"
          : "forward_terminal";
        const fields = {
          action,
          canCancelAudioRequest,
          eventRepeat: Boolean(event.repeat),
          pushToTalkDown: Boolean(pushToTalkDownRef.current),
          shortcut: widgetCancelShortcut,
          widgetState: widgetStateValue || "",
        };

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        forwardEscapeToActiveTerminal(fields);
        if (canCancelAudioRequest) {
          cancelRecording();
        }
        return;
      }

      if (event.repeat || !shortcutMatchesEvent(widgetPushToTalkShortcut, event)) {
        return;
      }

      event.preventDefault();
      handleRecorderShortcutPressed();
    };

    const onKeyUp = (event) => {
      if (!shortcutMatchesEvent(widgetPushToTalkShortcut, event)) {
        return;
      }

      event.preventDefault();
      handleRecorderShortcutReleased();
    };

    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [cancelRecording, forwardEscapeToActiveTerminal, handleRecorderShortcutPressed, handleRecorderShortcutReleased, widgetCancelShortcut, widgetPushToTalkShortcut]);

  useEffect(() => {
    const onContextMenu = (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();

      if (
        recorderModeRef.current !== AUDIO_RECORDER_MODE_TOGGLE_TO_TALK
        && pushToTalkDownRef.current
      ) {
        releasePushToTalk();
      }
    };

    window.addEventListener("contextmenu", onContextMenu, true);
    return () => {
      window.removeEventListener("contextmenu", onContextMenu, true);
    };
  }, [releasePushToTalk]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(AUDIO_PUSH_TO_TALK_EVENT, (event) => {
      if (disposed) {
        return;
      }

      applyPushToTalkPayload(event.payload);
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return null;
        }

        unlisten = nextUnlisten;
        return invoke("audio_push_to_talk_status");
      })
      .then((status) => {
        if (!status || disposed) {
          return;
        }

        if (status.pressed || status.phase === "pressed") {
          handleRecorderShortcutPressed();
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten();
    };
  }, [applyPushToTalkPayload, handleRecorderShortcutPressed]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(AUDIO_CANCEL_EVENT, () => {
      if (!disposed) {
        cancelRecording();
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
  }, [cancelRecording]);

  const isCloudWidget = transcriptionProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD;
  const installed = isCloudWidget ? Boolean(deepgramApiKey.trim()) : Boolean(modelStatus?.installed);
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const widgetLevel = Math.round(clampAudioLevel(Math.max((widgetAudioStats.rms || 0) * 2100, (widgetAudioStats.peak || 0) * 120)));
  const compactLabel = error
    || message
    || (installed ? "Audio recorder ready" : "Audio recorder setup needed");
  const isRecordingFocus = widgetState === "recording";
  const isProcessingFocus = widgetState === "transcribing";
  const widgetHasSignal = isProcessingFocus || (isRecordingFocus && widgetLevel >= 6);
  const isOpeningFocus = widgetFrameMode === "opening";
  const isClosingFocus = widgetFrameMode === "closing";
  const isCompactHandoff = widgetFrameMode === "compact-handoff";
  const isFocusedWidget = widgetFrameMode !== "compact" && !isCompactHandoff;
  const widgetVisualMode = isClosingFocus
    ? "closing"
    : isOpeningFocus
      ? "opening"
      : isProcessingFocus
        ? "processing"
        : isRecordingFocus
          ? "recording"
          : "compact";
  const widgetLogoSize = isFocusedWidget && !isOpeningFocus && !isClosingFocus ? "focus" : "compact";
  const expandedLabel = isProcessingFocus
    ? (message || "Transcribing audio")
    : `Recording audio ${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const widgetLabel = isFocusedWidget && !isClosingFocus ? expandedLabel : compactLabel;

  return (
    <>
      <GlobalStyle />
      <AudioWidgetShell
        aria-label={widgetLabel}
        data-tauri-drag-region
        data-closing={isClosingFocus ? "true" : undefined}
        data-focus={isFocusedWidget ? "true" : undefined}
        data-handoff={isCompactHandoff ? "true" : undefined}
        data-opening={isOpeningFocus ? "true" : undefined}
        data-state={widgetState}
        data-theme={audioWidgetTheme}
        onMouseDown={dragWidget}
      >
        <AudioWidgetFocusStage
          aria-label={widgetLabel}
          data-tauri-drag-region
          data-mode={widgetVisualMode}
          role="status"
        >
          <AudioWidgetLogo
            aria-hidden="true"
            data-hidden={isProcessingFocus && !isClosingFocus ? "true" : undefined}
            data-size={widgetLogoSize}
            src="/logo.webp"
            alt=""
          />
          <AudioWidgetLoader
            aria-hidden="true"
            data-visible={isProcessingFocus && !isClosingFocus ? "true" : undefined}
          />
          <AudioWidgetMeter
            data-active="true"
            data-processing={isProcessingFocus ? "true" : undefined}
            data-prominent="true"
            data-ready={widgetChromeReady && !isClosingFocus ? "true" : "false"}
            data-signal={widgetHasSignal ? "live" : "quiet"}
            aria-hidden="true"
          >
            {Array.from({ length: AUDIO_WIDGET_METER_BARS }, (_, index) => (
              <span
                key={index}
                style={buildWidgetMeterBarStyle(index, widgetLevel, isProcessingFocus)}
              />
            ))}
          </AudioWidgetMeter>
        </AudioWidgetFocusStage>
      </AudioWidgetShell>
    </>
  );
}

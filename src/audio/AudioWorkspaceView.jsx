import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  AUDIO_TRANSCRIPTION_RESULT_EVENT,
  AUDIO_ORCHESTRATOR_SUBMISSION_MODE_AUTO,
  AUDIO_ORCHESTRATOR_SUBMISSION_MODE_EVENT,
  AUDIO_ORCHESTRATOR_SUBMISSION_MODE_MANUAL,
  AUDIO_RECORDER_MODE_HYBRID,
  AUDIO_RECORDER_MODE_PUSH_TO_TALK,
  AUDIO_RECORDER_MODE_TOGGLE_TO_TALK,
  AUDIO_TRANSCRIPTION_PROVIDER_CLOUD,
  AUDIO_TRANSCRIPTION_PROVIDER_FORGE,
  AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT,
  AUDIO_TRANSCRIPTION_PROVIDER_LOCAL,
  AUDIO_TRANSCRIPTION_STATUS_CANCELLED,
  AUDIO_TRANSCRIPTION_STATUS_INSERTED,
  AUDIO_WIDGET_STYLE_BAR,
  AUDIO_WIDGET_STYLE_BUBBLE,
  AUDIO_WIDGET_STYLE_HIDDEN,
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
  readAudioWidgetStyle,
  writeAudioWidgetStyle,
  readOrchestratorRealtimeEnabled,
  readOrchestratorVoiceSubmissionMode,
  readAudioTranscriptionHistory,
  readAudioTranscriptionProvider,
  readAutoOpenAudioRecorder,
  readAudioWidgetTheme,
  readDeepgramApiKey,
  readDeepgramLanguage,
  readForgeLlmCleanup,
  writeForgeLlmCleanup,
  readSelectedAudioInputDeviceId,
  startLowPowerAudioBuffer,
  writeAudioRecorderMode,
  writeOrchestratorRealtimeEnabled,
  writeOrchestratorVoiceSubmissionMode,
  writeAudioTranscriptionProvider,
  writeAutoOpenAudioRecorder,
  writeAudioWidgetTheme,
  writeDeepgramApiKey,
  writeDeepgramLanguage,
  writeSelectedAudioInputDeviceId,
} from "./audioCapture";
import {
  cloudVoiceAgentEventKind,
  createCloudVoiceAgentTtsPlayer,
  finishCloudVoiceAgentInput,
  startCloudVoiceAgentStream,
  stopCloudVoiceAgentStream,
  subscribeCloudVoiceAgentEvents,
} from "./cloudVoiceAgentClient.js";
import { applyVoiceTextPipeline } from "./voicePipeline.js";
import {
  loadVoiceTextRules,
  peekVoiceTextRules,
  saveVoiceTextRules,
  subscribeVoiceTextRules,
} from "./voiceRulesStore.js";
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
  AudioModeList,
  AudioModeButton,
  AudioGeneralToolbar,
  AudioGeneralColumn,
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
  AudioRulesTabs,
  AudioRulesTab,
  AudioRulesHint,
  AudioRulesList,
  AudioRuleRow,
  AudioRuleFields,
  AudioRuleFieldRow,
  AudioRuleTextarea,
  AudioRuleToggle,
  AudioRuleIconButton,
  AudioRulesActionsRow,
  AudioRulesPreview,
  AudioRulesPreviewResult,
  AudioHistoryStatusBadge,
  AudioHistoryPanel,
  AudioHistoryStats,
  AudioHistoryStatChip,
  AudioHistoryVirtualList,
  AudioHistoryList,
  AudioHistoryRow,
  AudioHistoryRowTopline,
  AudioHistoryRowActions,
  AudioHistoryRowFootline,
  AudioHistoryExpandButton,
  AudioHistoryProvider,
  AudioHistoryCopyButton,
  AudioHistoryMeta,
  AudioInsightCard,
  AudioInsightCardTopline,
  AudioInsightLabel,
  AudioInsightSubValue,
  AudioInsightValue,
  AudioWpmGauge,
  AudioHeatmapGrid,
  AudioHeatmapColumn,
  AudioHeatmapCell,
  AudioRuntimeHint,
  AudioProgressPanel,
  AudioProgressTopline,
  AudioProgressTrack,
  AudioProgressBar,
  AudioProgressMeta,
  AudioActionRow,
  AudioWidgetShell,
  AudioWidgetCancelButton,
  AudioWidgetErrorPopover,
  AudioWidgetLockBadge,
  AudioBarShell,
  AudioBarSurface,
  AudioBarCancelButton,
  AudioBarMeter,
  AudioBarSpinner,
  AudioBarStopButton,
  AudioBarStatusText,
  AudioBarUndoButton,
  AudioBarCopyButton,
  AudioBarHistoryButton,
  AudioBarNoticeProgress,
  AudioBarIdleShell,
  AudioBarIdleReveal,
  AudioBarIdleLine,
  AudioBarRecordButton,
  AudioBarShortcutHint,
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
import { playNotificationSfx } from "../notifications/notificationSfx";

export const AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT = "forge-audio-model-download-progress";
export const AUDIO_WIDGET_HASH = "#/audio-widget";
export const AUDIO_WIDGET_VISIBILITY_CHANGED_EVENT = "forge-audio-widget-visibility-changed";
const AUDIO_PUSH_TO_TALK_EVENT = "forge-audio-push-to-talk";
const AUDIO_CANCEL_EVENT = "forge-audio-cancel";
const AUDIO_SHORTCUTS_CHANGED_EVENT = "forge-audio-shortcuts-changed";
const AUDIO_SETTINGS_CHANGED_EVENT = "forge-audio-settings-changed";
const AUDIO_REALTIME_TRANSCRIPT_EVENT = "forge-audio-realtime-transcript";
// App-wide live dictation mirror: the Activity widget renders the incoming
// stream (phase + interim text) from these broadcasts while a take is live.
const AUDIO_DICTATION_STREAM_EVENT = "forge-audio-dictation-stream";
const AUDIO_RECORDING_MAX_SECONDS = 90;
const AUDIO_RECORDING_LOCKED_MAX_SECONDS = 900;
const AUDIO_RECORDING_TIMER_MS = 250;
const AUDIO_HYBRID_TAP_MAX_MS = 280;
const AUDIO_HYBRID_DOUBLE_TAP_MS = 360;
const AUDIO_CANCEL_SALVAGE_MIN_AUDIO_MS = 600;
const DEEPGRAM_RELEASE_POST_BUFFER_MS = 500;
// Forge cloud dictation streams audio continuously through the native
// worker, so only a short tail is needed to flush in-flight chunks before
// the finish frame; this keeps release-to-transcript latency low.
const FORGE_RELEASE_POST_BUFFER_MS = 350;
// Last successful billing snapshot, module-wide: provider switches and
// remounts render the known state instantly (stale-while-revalidate) instead
// of flashing "Checking credits" while the network refresh runs.
let lastKnownForgeBilling = null;
const AUDIO_WIDGET_PREROLL_READY_MS = 500;
const AUDIO_INPUT_METER_BARS = 32;
const AUDIO_WIDGET_METER_BARS = 26;
const AUDIO_WIDGET_COMPACT_SIZE = { width: 64, height: 64 };
const AUDIO_WIDGET_FOCUS_SIZE = { width: 292, height: 64 };
// Recording: a slim Wispr-style pill bottom-center (X to cancel + waveform +
// stop/spinner on the right), hovering just above the Dock/taskbar edge.
const AUDIO_WIDGET_BAR_SIZE = { width: 124, height: 44 };
// The cancel notice needs room for its label plus close/copy/undo/history
// controls, so the pill widens while it is showing. The bubble style reuses
// the same pill (the window morphs to it in place, then morphs back).
const AUDIO_WIDGET_BAR_NOTICE_SIZE = { width: 392, height: 52 };
const AUDIO_WIDGET_BAR_BOTTOM_MARGIN = 6;
// Idle: a thin line hugging the bottom; the window stays this small dock
// zone so hovering it can reveal the round record button + shortcut hint.
const AUDIO_WIDGET_BAR_IDLE_SIZE = { width: 200, height: 96 };
const AUDIO_WIDGET_BAR_IDLE_BOTTOM_MARGIN = 0;
// Extra window height for the small error card shown above the bubble; the
// window shifts up by the same amount so the pill stays put on screen.
const AUDIO_WIDGET_ERROR_POPOVER_HEIGHT = 62;
const AUDIO_WIDGET_ERROR_AUTO_DISMISS_MS = 6500;
// Compact bar: 8 bars fill the ~38px of meter room left between the cancel
// and stop controls at the 124px bar width.
const AUDIO_BAR_METER_BARS = 8;
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
const AUDIO_WIDGET_STYLE_OPTIONS = [
  {
    detail: "Always-visible bubble",
    id: AUDIO_WIDGET_STYLE_BUBBLE,
    label: "Bubble",
  },
  {
    detail: "Appears while speaking",
    id: AUDIO_WIDGET_STYLE_HIDDEN,
    label: "Hidden",
  },
  {
    detail: "Thin line; hover to record",
    id: AUDIO_WIDGET_STYLE_BAR,
    label: "Bottom bar",
  },
];
// Transcripts longer than this get the 3-line clamp + "Show more" toggle.
const AUDIO_HISTORY_CLAMP_THRESHOLD_CHARS = 220;

function isMacPlatform() {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");
}

function isWindowsPlatform() {
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform || "");
}

const isFocusedAudioWidgetState = (state) => state === "arming"
  || state === "recording"
  || state === "transcribing"
  || state === "error";
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

function buildWidgetMeterBarStyle(index, level, processing, barCount = AUDIO_WIDGET_METER_BARS) {
  const normalizedLevel = clampAudioLevel(level) / 100;
  const signalEnergy = processing ? 0.75 : Math.min(1, normalizedLevel * 8);
  const midpoint = (barCount - 1) / 2;
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
  if (lower === "fn" || lower === "fnkey" || lower === "globe" || lower === "globekey" || lower === "fnglobe") {
    return "Fn (Globe)";
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
  if (provider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
    return "Deepgram";
  }
  if (provider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
    return "Forge Voice";
  }
  if (provider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE) {
    return "Forge";
  }
  return "Whisper";
}

function findNumberByKeys(value, keys, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) {
    return null;
  }

  for (const key of keys) {
    const candidate = Number(value[key]);
    if (Number.isFinite(candidate)) {
      return candidate;
    }
  }

  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const found = findNumberByKeys(nested, keys, depth + 1);
      if (found !== null) {
        return found;
      }
    }
  }

  return null;
}

/**
 * Best-effort remaining-credit extraction from the billing status payload.
 * Returns null when the shape is unknown; the cloud reservation is the hard
 * gate either way, this only powers the early UI block and hint.
 */
function extractRemainingForgeCredits(billing) {
  const remaining = findNumberByKeys(billing, [
    "remainingCredits",
    "remaining_credits",
    "creditsRemaining",
    "credits_remaining",
  ]);
  if (remaining !== null) {
    return remaining;
  }

  const total = findNumberByKeys(billing, ["totalCredits", "total_credits"]);
  const used = findNumberByKeys(billing, ["usedCredits", "used_credits"]);
  if (total !== null && used !== null) {
    return total - used;
  }

  return null;
}

function formatAudioHistoryMeta(entry) {
  const pieces = [];
  const source = String(entry?.source || "").trim();
  // Time shown = turnaround since releasing the record button (request
  // submitted) to the transcript landing. Older entries only stored the
  // audio length, so they fall back to it.
  const duration = formatHistoryDuration(
    Number(entry?.latencyMs || 0) > 0 ? entry.latencyMs : entry?.audioMs,
  );
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

function audioHistoryEntryWords(entry) {
  const entryWordCount = Number(entry?.wordCount || 0);
  if (Number.isFinite(entryWordCount) && entryWordCount > 0) {
    return entryWordCount;
  }
  return String(entry?.text || "").split(/\s+/).filter(Boolean).length;
}

// A casual talking pace tops out well under this; it just anchors the gauge.
const AUDIO_WPM_GAUGE_MAX = 200;
const AUDIO_HEATMAP_WEEKS = 14;

/// Everything the history header visualizes in one pass: the average-WPM
/// gauge value, the totals chips, and a GitHub-style words-per-day heatmap
/// (columns = weeks, rows = weekdays, most recent week last).
function buildAudioHistoryInsights(history) {
  const entries = Array.isArray(history) ? history : [];
  const total = entries.length;
  const timedEntries = entries.filter((entry) => Number(entry?.audioMs || 0) > 0);
  const audioMs = timedEntries.reduce((sum, entry) => sum + Number(entry.audioMs || 0), 0);
  const timedWords = timedEntries.reduce((sum, entry) => sum + audioHistoryEntryWords(entry), 0);
  const averageWpm = audioMs > 0 ? Math.round(timedWords / (audioMs / 60000)) : 0;
  const totalWords = entries.reduce((sum, entry) => sum + audioHistoryEntryWords(entry), 0);

  const wordsByDay = new Map();
  entries.forEach((entry) => {
    const created = entry?.createdAt ? new Date(entry.createdAt) : null;
    if (!created || Number.isNaN(created.getTime())) return;
    const key = `${created.getFullYear()}-${created.getMonth()}-${created.getDate()}`;
    wordsByDay.set(key, (wordsByDay.get(key) || 0) + audioHistoryEntryWords(entry));
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  // First cell is the Sunday that starts the oldest displayed week.
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay() - (AUDIO_HEATMAP_WEEKS - 1) * 7);
  let maxDayWords = 0;
  wordsByDay.forEach((words) => {
    maxDayWords = Math.max(maxDayWords, words);
  });

  const weeks = [];
  for (let week = 0; week < AUDIO_HEATMAP_WEEKS; week += 1) {
    const column = [];
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const day = new Date(start);
      day.setDate(start.getDate() + week * 7 + weekday);
      if (day > today) {
        column.push(null);
        continue;
      }
      const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
      const words = wordsByDay.get(key) || 0;
      const level = words <= 0 || maxDayWords <= 0
        ? 0
        : Math.max(1, Math.min(4, Math.ceil((words / maxDayWords) * 4)));
      column.push({
        key,
        label: `${day.toLocaleDateString([], { month: "short", day: "numeric" })} — ${formatInteger(words)} word${words === 1 ? "" : "s"}`,
        level,
        words,
      });
    }
    weeks.push(column);
  }

  return {
    audioMs,
    averageWpm,
    totalDictations: total,
    totalWords,
    weeks,
  };
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
  const [orchestratorRealtimeEnabled, setOrchestratorRealtimeEnabled] = useState(readOrchestratorRealtimeEnabled);
  const [audioWidgetTheme, setAudioWidgetTheme] = useState(readAudioWidgetTheme);
  const [audioHistory, setAudioHistory] = useState(readAudioTranscriptionHistory);
  const [expandedAudioHistoryIds, setExpandedAudioHistoryIds] = useState(() => new Set());
  const [copiedAudioHistoryId, setCopiedAudioHistoryId] = useState("");
  const [voiceRules, setVoiceRules] = useState(peekVoiceTextRules);
  const [forgeLlmCleanup, setForgeLlmCleanup] = useState(readForgeLlmCleanup);
  const [forgeBilling, setForgeBilling] = useState(
    () => lastKnownForgeBilling || { state: "idle", remaining: null, error: "" },
  );
  const [audioWidgetStyleSetting, setAudioWidgetStyleSetting] = useState(readAudioWidgetStyle);
  const [voiceRulesTab, setVoiceRulesTab] = useState("dictionary");
  const [voiceRulesPreviewInput, setVoiceRulesPreviewInput] = useState("");
  const [voiceRulesError, setVoiceRulesError] = useState("");
  const voiceRulesSaveTimerRef = useRef(0);
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
  const isForgeMode = audioMode === AUDIO_TRANSCRIPTION_PROVIDER_FORGE;
  const isForgeAgentMode = audioMode === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT;
  const deepgramReady = Boolean(deepgramApiKey.trim());
  const installed = Boolean(audioModelStatus?.installed);
  const forgeCreditsExhausted = forgeBilling.state === "ready"
    && forgeBilling.remaining !== null
    && forgeBilling.remaining <= 0;
  const forgeReady = forgeBilling.state !== "error" && !forgeCreditsExhausted;
  const recorderOpen = Boolean(audioWidgetVisible);
  const recorderReady = (isForgeMode || isForgeAgentMode) ? forgeReady : isCloudMode ? deepgramReady : installed;
  const isBusy = audioActionState === "downloading"
    || audioActionState === "closing"
    || audioActionState === "opening"
    || audioActionState === "uninstalling"
    || (!isCloudMode && !isForgeMode && !isForgeAgentMode && audioStatusState === "checking");
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
    : isBusy || ((isForgeMode || isForgeAgentMode) ? !forgeReady : isCloudMode ? !deepgramReady : !installed);
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
  const audioModeStatusLabel = isForgeMode
    ? (forgeBilling.state === "loading"
      ? "Checking credits"
      : forgeBilling.state === "error"
        ? "Sign in needed"
        : forgeCreditsExhausted
          ? "No credits"
          : "Forge ready")
    : isForgeAgentMode
      ? (forgeBilling.state === "loading"
        ? "Checking credits"
        : forgeBilling.state === "error"
          ? "Sign in needed"
          : forgeCreditsExhausted
            ? "No credits"
            : "Voice ready")
    : isCloudMode
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
  const audioHistoryInsights = useMemo(() => buildAudioHistoryInsights(audioHistory), [audioHistory]);
  const voiceRulesPreview = useMemo(() => (
    voiceRulesPreviewInput.trim()
      ? applyVoiceTextPipeline(voiceRulesPreviewInput, voiceRules)
      : null
  ), [voiceRulesPreviewInput, voiceRules]);
  const toggleAudioHistoryExpanded = useCallback((entryKey) => {
    setExpandedAudioHistoryIds((current) => {
      const next = new Set(current);
      if (next.has(entryKey)) {
        next.delete(entryKey);
      } else {
        next.add(entryKey);
      }
      return next;
    });
  }, []);

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

  const scheduleVoiceRulesSave = useCallback((nextRules) => {
    if (voiceRulesSaveTimerRef.current) {
      window.clearTimeout(voiceRulesSaveTimerRef.current);
    }

    voiceRulesSaveTimerRef.current = window.setTimeout(() => {
      voiceRulesSaveTimerRef.current = 0;
      saveVoiceTextRules(nextRules)
        .then(() => setVoiceRulesError(""))
        .catch((rulesError) => {
          setVoiceRulesError(getErrorMessage(rulesError, "Unable to save voice rules."));
        });
    }, 700);
  }, []);

  const updateVoiceRulesList = useCallback((kind, updater) => {
    setVoiceRules((currentRules) => {
      const nextRules = {
        ...currentRules,
        [kind]: updater(Array.isArray(currentRules[kind]) ? currentRules[kind] : []),
      };
      scheduleVoiceRulesSave(nextRules);
      return nextRules;
    });
  }, [scheduleVoiceRulesSave]);

  const updateVoiceRuleEntry = useCallback((kind, entryId, patch) => {
    updateVoiceRulesList(kind, (entries) => entries.map((entry) => (
      entry.id === entryId ? { ...entry, ...patch } : entry
    )));
  }, [updateVoiceRulesList]);

  const removeVoiceRuleEntry = useCallback((kind, entryId) => {
    updateVoiceRulesList(kind, (entries) => entries.filter((entry) => entry.id !== entryId));
  }, [updateVoiceRulesList]);

  const addVoiceRuleEntry = useCallback((kind) => {
    const id = `${kind}-${Date.now()}`;
    const blankEntry = kind === "dictionary"
      ? { id, phrase: "", soundsLike: [], soundsLikeText: "", enabled: true }
      : kind === "snippets"
        ? { id, trigger: "", expansion: "", enabled: true }
        : { id, match: "", replacement: "", isRegex: false, enabled: true };
    updateVoiceRulesList(kind, (entries) => [...entries, blankEntry]);
  }, [updateVoiceRulesList]);

  const updateOrchestratorRealtimeEnabled = useCallback((enabled) => {
    setOrchestratorRealtimeEnabled(Boolean(enabled));
    writeOrchestratorRealtimeEnabled(Boolean(enabled));
    notifyAudioSettingsChanged("orchestrator-voice-engine");
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

  const updateAudioWidgetStyle = useCallback((nextStyle) => {
    setAudioWidgetStyleSetting(nextStyle);
    writeAudioWidgetStyle(nextStyle);
    notifyAudioSettingsChanged("widget-style");
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

  const refreshForgeBilling = useCallback(async () => {
    // Stale-while-revalidate: keep showing the last known billing state while
    // the refresh runs; "Checking credits" only appears on the first load.
    setForgeBilling((current) => (
      current.state === "ready"
        ? current
        : lastKnownForgeBilling || { state: "loading", remaining: null, error: "" }
    ));

    try {
      const billing = await invoke("cloud_mcp_get_billing_status");
      const nextBilling = {
        state: "ready",
        remaining: extractRemainingForgeCredits(billing),
        error: "",
      };
      lastKnownForgeBilling = nextBilling;
      setForgeBilling(nextBilling);
    } catch (billingError) {
      lastKnownForgeBilling = null;
      setForgeBilling({
        state: "error",
        remaining: null,
        error: getErrorMessage(
          billingError,
          "Sign in to Diff Forge AI to use cloud dictation.",
        ),
      });
    }
  }, []);

  useEffect(() => {
    if (isForgeMode || isForgeAgentMode) {
      refreshForgeBilling();
    }
  }, [isForgeAgentMode, isForgeMode, refreshForgeBilling]);

  useEffect(() => {
    // Keep a pre-authenticated cloud dictation websocket parked whenever
    // Diff Forge Cloud dictation is the selected provider so press-to-talk
    // starts instantly instead of paying the connect handshake.
    invoke("prewarm_forge_dictation_transcription", {
      request: { enabled: isForgeMode },
    }).catch(() => {});
  }, [isForgeMode]);

  const toggleForgeLlmCleanup = useCallback(() => {
    setForgeLlmCleanup((currentValue) => {
      const nextValue = !currentValue;
      writeForgeLlmCleanup(nextValue);
      notifyAudioSettingsChanged("forge-llm-cleanup");
      return nextValue;
    });
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

  const openMacFnKeySettings = useCallback(async () => {
    setAudioShortcutError("");

    try {
      const status = await invoke("open_macos_fn_key_settings");
      setAudioShortcutStatus(status || fallbackShortcutStatus());
    } catch (shortcutError) {
      setAudioShortcutError(getErrorMessage(shortcutError, "Unable to open macOS keyboard settings."));
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
    loadVoiceTextRules().then(setVoiceRules).catch(() => {});

    return () => {
      if (voiceRulesSaveTimerRef.current) {
        window.clearTimeout(voiceRulesSaveTimerRef.current);
      }
    };
  }, []);

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
            <PageSubline>{isForgeAgentMode
              ? "Diff Forge Cloud voice agent with streamed speech."
              : isForgeMode
                ? "Diff Forge Cloud Nova-3 dictation with cleanup."
                : isCloudMode
                  ? "Deepgram Nova-3 realtime dictation."
                  : "Local Whisper dictation setup."}</PageSubline>
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
          <AudioGeneralColumn>
          <AudioProviderPanel aria-label="Transcription provider">
            <AudioDeviceHeader>
              <div>
                <SettingsLabel>Provider</SettingsLabel>
                <SettingsHint>{isForgeMode
                  ? "Diff Forge AI cloud"
                  : isForgeAgentMode
                    ? "Diff Forge AI voice"
                    : isCloudMode
                      ? "Deepgram Nova-3"
                      : "Local Whisper"}</SettingsHint>
              </div>
              <AudioStatePill data-installed={recorderReady}>
                {audioModeStatusLabel}
              </AudioStatePill>
            </AudioDeviceHeader>
            <AudioModeList role="group" aria-label="Transcription mode">
              <AudioModeButton
                aria-pressed={!isCloudMode && !isForgeMode && !isForgeAgentMode}
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
                  <span>Your Deepgram key</span>
                </span>
              </AudioModeButton>
              <AudioModeButton
                aria-pressed={isForgeMode}
                onClick={() => selectAudioMode(AUDIO_TRANSCRIPTION_PROVIDER_FORGE)}
                type="button"
              >
                <ButtonHubIcon aria-hidden="true" />
                <span>
                  <strong>Diff Forge AI</strong>
                  <span>Nova-3 + LLM cleanup</span>
                </span>
              </AudioModeButton>
            </AudioModeList>
            {(isForgeMode || isForgeAgentMode) && (
              <>
                <AudioRecorderOptionRow>
                  <SettingsHint>
                    {forgeBilling.state === "loading"
                      ? "Checking Diff Forge AI credits..."
                      : forgeBilling.state === "error"
                        ? forgeBilling.error
                        : forgeCreditsExhausted
                          ? "No Diff Forge AI credits remaining. Top up to use cloud audio."
                          : isForgeAgentMode
                            ? "Streams mic audio to Diff Forge Cloud, runs the voice agent, and plays the response back here."
                            : "Realtime Nova-3 in Diff Forge Cloud. Billed from your credits: audio input, LLM cleanup, and transfer per MB."}
                  </SettingsHint>
                  <SecondaryButton onClick={refreshForgeBilling} type="button">
                    <ButtonRefreshIcon aria-hidden="true" />
                    <span>{forgeBilling.state === "loading" ? "Checking..." : "Recheck credits"}</span>
                  </SecondaryButton>
                </AudioRecorderOptionRow>
                {isForgeMode && (
                  <AudioRecorderOptionRow>
                  <SettingsHint>
                    {forgeLlmCleanup
                      ? "A cheap LLM polishes the final transcript (punctuation, fillers, false starts)."
                      : "Raw Nova-3 transcript is returned without the LLM pass."}
                  </SettingsHint>
                  <McpSwitchButton
                    aria-pressed={forgeLlmCleanup}
                    onClick={toggleForgeLlmCleanup}
                    type="button"
                  >
                    <span aria-hidden="true" />
                    LLM cleanup
                  </McpSwitchButton>
                  </AudioRecorderOptionRow>
                )}
              </>
            )}
          </AudioProviderPanel>

          <AudioRecorderPanel aria-label="Orchestrator voice controls">
            <AudioDeviceHeader>
              <div>
                <SettingsLabel>Orchestrator</SettingsLabel>
                <SettingsHint>
                  {`${orchestratorRealtimeEnabled ? "GPT-Realtime" : "Pipeline"} engine · ${isManualOrchestratorMode ? "manual submit" : "auto submit"}`}
                </SettingsHint>
              </div>
              <AudioStatePill data-installed="true">
                {isManualOrchestratorMode ? "Manual" : "Auto"}
              </AudioStatePill>
            </AudioDeviceHeader>
            <AudioCloudField as="div">
              Submission
              <AudioModeGrid role="group" aria-label="Orchestrator voice submission mode">
                <AudioModeButton
                  aria-pressed={orchestratorSubmissionMode === AUDIO_ORCHESTRATOR_SUBMISSION_MODE_AUTO}
                  onClick={() => updateOrchestratorSubmissionMode(AUDIO_ORCHESTRATOR_SUBMISSION_MODE_AUTO)}
                  type="button"
                >
                  <ButtonCheckIcon aria-hidden="true" />
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
            </AudioCloudField>
            <AudioCloudField as="div">
              Engine
              <AudioModeGrid role="group" aria-label="Orchestrator voice engine">
                <AudioModeButton
                  aria-pressed={orchestratorRealtimeEnabled}
                  onClick={() => updateOrchestratorRealtimeEnabled(true)}
                  title="One native speech-to-speech GPT-Realtime session: faster, more natural, with the same orchestrator tools."
                  type="button"
                >
                  <ButtonBotIcon aria-hidden="true" />
                  <span>
                    <strong>GPT-Realtime 2.0</strong>
                    <span>Native speech-to-speech</span>
                  </span>
                </AudioModeButton>
                <AudioModeButton
                  aria-pressed={!orchestratorRealtimeEnabled}
                  onClick={() => updateOrchestratorRealtimeEnabled(false)}
                  title="Classic pipeline: Deepgram transcription, LLM orchestration, Aura speech."
                  type="button"
                >
                  <ButtonHubIcon aria-hidden="true" />
                  <span>
                    <strong>Pipeline</strong>
                    <span>STT → LLM → TTS</span>
                  </span>
                </AudioModeButton>
              </AudioModeGrid>
            </AudioCloudField>
          </AudioRecorderPanel>
          </AudioGeneralColumn>

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
            <AudioCloudField as="div">
              Widget style
              <AudioModeGrid role="group" aria-label="Floating recorder style">
                {AUDIO_WIDGET_STYLE_OPTIONS.map((option) => (
                  <AudioModeButton
                    aria-pressed={audioWidgetStyleSetting === option.id}
                    key={option.id}
                    onClick={() => updateAudioWidgetStyle(option.id)}
                    type="button"
                  >
                    {option.id === AUDIO_WIDGET_STYLE_BAR ? (
                      <ButtonCheckIcon aria-hidden="true" />
                    ) : option.id === AUDIO_WIDGET_STYLE_HIDDEN ? (
                      <ButtonDarkModeIcon aria-hidden="true" />
                    ) : (
                      <ButtonMicIcon aria-hidden="true" />
                    )}
                    <span>
                      <strong>{option.label}</strong>
                      <span>{option.detail}</span>
                    </span>
                  </AudioModeButton>
                ))}
              </AudioModeGrid>
            </AudioCloudField>
            <SettingsHint>
              {audioWidgetStyleSetting === AUDIO_WIDGET_STYLE_BAR
                ? "A thin line sits at the bottom of the screen. Hover it for the record button (the orange hint is the shortcut); while recording it becomes a slim bar with an X to cancel."
                : audioWidgetStyleSetting === AUDIO_WIDGET_STYLE_HIDDEN
                  ? "The bubble stays invisible until you start speaking."
                  : "The bubble stays visible and draggable at all times."}
            </SettingsHint>
          </AudioRecorderPanel>

        </AudioGeneralToolbar>

        {(isCloudMode || isForgeMode) && (
          <AudioDevicePanel aria-label="Cloud transcription settings">
            <AudioDeviceHeader>
              <div>
                <SettingsLabel>Cloud transcription</SettingsLabel>
                <SettingsHint>
                  {isForgeMode
                    ? "Diff Forge Cloud streams Nova-3 over a live WebSocket; the language applies to the realtime transcript."
                    : "Deepgram Nova-3 streams push-to-talk audio over a live WebSocket."}
                </SettingsHint>
              </div>
              {isCloudMode && (
                <AudioStatePill data-installed={deepgramReady}>
                  {deepgramReady ? "Key saved" : "Key required"}
                </AudioStatePill>
              )}
            </AudioDeviceHeader>
            <AudioCloudGrid>
              {isCloudMode && (
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
              )}
              <AudioCloudField>
                Language
                <AudioDeviceSelect
                  aria-label="Transcription language"
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
              <SettingsHint>{recorderMode === AUDIO_RECORDER_MODE_HYBRID
                ? "Hold to record, double-tap to lock, tap to stop."
                : isToggleRecorderMode
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
              <AudioModeButton
                aria-pressed={recorderMode === AUDIO_RECORDER_MODE_HYBRID}
                onClick={() => updateRecorderMode(AUDIO_RECORDER_MODE_HYBRID)}
                type="button"
              >
                <ButtonKeyIcon aria-hidden="true" />
                <span>
                  <strong>Hybrid</strong>
                  <span>Hold / 2x tap locks</span>
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
                {isMacPlatform() && pushToTalkShortcut !== "Fn" && (
                  <SecondaryButton
                    disabled={isSavingShortcut}
                    onClick={() => applyAudioShortcut(AUDIO_SHORTCUT_ACTION_PUSH_TO_TALK, "Fn")}
                    title="Bind the Fn (Globe) key: hold to record, double-tap to lock"
                    type="button"
                  >
                    <ButtonKeyIcon aria-hidden="true" />
                    <span>Use Fn</span>
                  </SecondaryButton>
                )}
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

          {pushToTalkShortcut === "Fn" && (
            <AudioRecorderOptionRow>
              <SettingsHint>
                Set the macOS Globe/Fn key to &quot;Do Nothing&quot; in Keyboard settings so it
                doesn&apos;t also trigger Dictation or input switching.
              </SettingsHint>
              <SecondaryButton onClick={openMacFnKeySettings} type="button">
                <ButtonKeyIcon aria-hidden="true" />
                <span>Keyboard Settings</span>
              </SecondaryButton>
            </AudioRecorderOptionRow>
          )}

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
          >
            <AudioRulesTabs aria-label="Voice rule type" role="group">
              {[
                { id: "dictionary", label: "Dictionary" },
                { id: "snippets", label: "Snippets" },
                { id: "transforms", label: "Transforms" },
              ].map((tab) => (
                <AudioRulesTab
                  aria-pressed={voiceRulesTab === tab.id}
                  key={tab.id}
                  onClick={() => setVoiceRulesTab(tab.id)}
                  type="button"
                >
                  {tab.label}
                </AudioRulesTab>
              ))}
            </AudioRulesTabs>

            <AudioRulesHint>
              {voiceRulesTab === "dictionary"
                ? "Teach transcription your vocabulary. The phrase biases recognition (local Whisper and Deepgram) and “sounds like” aliases are auto-corrected to it."
                : voiceRulesTab === "snippets"
                  ? "Say a trigger word and it expands into the full text, like saying “gstack” to insert an entire prompt."
                  : "Find-and-replace rules applied last, in order. Use them for spoken commands like “new line” or regex cleanups."}
            </AudioRulesHint>

            <AudioRulesList>
              {voiceRulesTab === "dictionary" && (voiceRules.dictionary || []).map((entry) => (
                <AudioRuleRow data-disabled={entry.enabled === false ? "true" : undefined} key={entry.id}>
                  <AudioRuleToggle
                    aria-label={entry.enabled === false ? "Enable dictionary entry" : "Disable dictionary entry"}
                    aria-pressed={entry.enabled !== false}
                    onClick={() => updateVoiceRuleEntry("dictionary", entry.id, { enabled: entry.enabled === false })}
                    type="button"
                  />
                  <AudioRuleFields>
                    <AudioRuleFieldRow>
                      <AudioCloudInput
                        aria-label="Phrase"
                        onChange={(event) => updateVoiceRuleEntry("dictionary", entry.id, { phrase: event.target.value })}
                        placeholder="Phrase, e.g. Tauri"
                        value={entry.phrase || ""}
                      />
                      <AudioCloudInput
                        aria-label="Sounds like"
                        onChange={(event) => updateVoiceRuleEntry("dictionary", entry.id, {
                          soundsLikeText: event.target.value,
                          soundsLike: event.target.value.split(",").map((alias) => alias.trim()).filter(Boolean),
                        })}
                        placeholder="Sounds like (comma separated), e.g. towery, tory"
                        value={entry.soundsLikeText ?? (entry.soundsLike || []).join(", ")}
                      />
                    </AudioRuleFieldRow>
                  </AudioRuleFields>
                  <AudioRuleIconButton
                    aria-label="Delete dictionary entry"
                    onClick={() => removeVoiceRuleEntry("dictionary", entry.id)}
                    type="button"
                  >
                    <ButtonDeleteIcon aria-hidden="true" />
                  </AudioRuleIconButton>
                </AudioRuleRow>
              ))}

              {voiceRulesTab === "snippets" && (voiceRules.snippets || []).map((entry) => (
                <AudioRuleRow data-disabled={entry.enabled === false ? "true" : undefined} key={entry.id}>
                  <AudioRuleToggle
                    aria-label={entry.enabled === false ? "Enable snippet" : "Disable snippet"}
                    aria-pressed={entry.enabled !== false}
                    onClick={() => updateVoiceRuleEntry("snippets", entry.id, { enabled: entry.enabled === false })}
                    type="button"
                  />
                  <AudioRuleFields>
                    <AudioRuleFieldRow data-single="true">
                      <AudioCloudInput
                        aria-label="Trigger"
                        onChange={(event) => updateVoiceRuleEntry("snippets", entry.id, { trigger: event.target.value })}
                        placeholder="Trigger, e.g. gstack"
                        value={entry.trigger || ""}
                      />
                    </AudioRuleFieldRow>
                    <AudioRuleFieldRow data-single="true">
                      <AudioRuleTextarea
                        aria-label="Expansion"
                        onChange={(event) => updateVoiceRuleEntry("snippets", entry.id, { expansion: event.target.value })}
                        placeholder="Expands into this full text..."
                        value={entry.expansion || ""}
                      />
                    </AudioRuleFieldRow>
                  </AudioRuleFields>
                  <AudioRuleIconButton
                    aria-label="Delete snippet"
                    onClick={() => removeVoiceRuleEntry("snippets", entry.id)}
                    type="button"
                  >
                    <ButtonDeleteIcon aria-hidden="true" />
                  </AudioRuleIconButton>
                </AudioRuleRow>
              ))}

              {voiceRulesTab === "transforms" && (voiceRules.transforms || []).map((entry) => (
                <AudioRuleRow data-disabled={entry.enabled === false ? "true" : undefined} key={entry.id}>
                  <AudioRuleToggle
                    aria-label={entry.enabled === false ? "Enable transform" : "Disable transform"}
                    aria-pressed={entry.enabled !== false}
                    onClick={() => updateVoiceRuleEntry("transforms", entry.id, { enabled: entry.enabled === false })}
                    type="button"
                  />
                  <AudioRuleFields>
                    <AudioRuleFieldRow>
                      <AudioCloudInput
                        aria-label="Match"
                        onChange={(event) => updateVoiceRuleEntry("transforms", entry.id, { match: event.target.value })}
                        placeholder={entry.isRegex ? "Pattern, e.g. bug (\\d+)" : "Match, e.g. new line"}
                        value={entry.match || ""}
                      />
                      <AudioRuleTextarea
                        aria-label="Replacement"
                        onChange={(event) => updateVoiceRuleEntry("transforms", entry.id, { replacement: event.target.value })}
                        placeholder={entry.isRegex ? "Replacement, e.g. BUG-$1" : "Replacement (newlines allowed)"}
                        style={{ minHeight: 36 }}
                        value={entry.replacement || ""}
                      />
                    </AudioRuleFieldRow>
                    <AudioRulesActionsRow>
                      <SecondaryButton
                        aria-pressed={entry.isRegex === true}
                        onClick={() => updateVoiceRuleEntry("transforms", entry.id, { isRegex: entry.isRegex !== true })}
                        type="button"
                      >
                        <ButtonKeyIcon aria-hidden="true" />
                        <span>{entry.isRegex ? "Regex: on" : "Regex: off"}</span>
                      </SecondaryButton>
                    </AudioRulesActionsRow>
                  </AudioRuleFields>
                  <AudioRuleIconButton
                    aria-label="Delete transform"
                    onClick={() => removeVoiceRuleEntry("transforms", entry.id)}
                    type="button"
                  >
                    <ButtonDeleteIcon aria-hidden="true" />
                  </AudioRuleIconButton>
                </AudioRuleRow>
              ))}

              {!(voiceRules[voiceRulesTab] || []).length && (
                <AudioRulesHint>
                  {voiceRulesTab === "dictionary"
                    ? "No vocabulary yet. Add product names, APIs, or people the model mishears."
                    : voiceRulesTab === "snippets"
                      ? "No snippets yet. Map a short spoken trigger to a long prompt."
                      : "No transforms yet. Try “new line” → a line break."}
                </AudioRulesHint>
              )}
            </AudioRulesList>

            <AudioRulesActionsRow>
              <SecondaryButton onClick={() => addVoiceRuleEntry(voiceRulesTab)} type="button">
                <ButtonMicIcon aria-hidden="true" />
                <span>
                  {voiceRulesTab === "dictionary"
                    ? "Add phrase"
                    : voiceRulesTab === "snippets"
                      ? "Add snippet"
                      : "Add transform"}
                </span>
              </SecondaryButton>
              <SettingsHint>Synced to dictation instantly. Saves automatically.</SettingsHint>
            </AudioRulesActionsRow>

            {voiceRulesError && <FormMessage $state="error">{voiceRulesError}</FormMessage>}

            <AudioRulesPreview>
              <strong>Try it</strong>
              <AudioCloudInput
                aria-label="Preview input"
                onChange={(event) => setVoiceRulesPreviewInput(event.target.value)}
                placeholder="Type what you'd say, e.g. run gstack with towery new line done"
                value={voiceRulesPreviewInput}
              />
              {voiceRulesPreview && (
                <AudioRulesPreviewResult>{voiceRulesPreview.text}</AudioRulesPreviewResult>
              )}
            </AudioRulesPreview>
          </AudioDictionaryPanel>
        )}

        {activeAudioTab === "history" && (
          <AudioHistoryPanel
            aria-labelledby="audio-tab-history"
            id="audio-tabpanel-history"
            role="tabpanel"
          >
            <AudioHistoryStats aria-label="Speech to text statistics">
              <AudioInsightCard aria-label="Average words per minute">
                <AudioInsightValue>
                  {audioHistoryInsights.averageWpm > 0
                    ? formatInteger(audioHistoryInsights.averageWpm)
                    : "0"}
                </AudioInsightValue>
                <AudioInsightLabel>Words per minute</AudioInsightLabel>
                <AudioWpmGauge aria-hidden="true" viewBox="0 0 100 56">
                  <path
                    className="track"
                    d="M 8 50 A 42 42 0 0 1 92 50"
                  />
                  <path
                    className="fill"
                    d="M 8 50 A 42 42 0 0 1 92 50"
                    style={{
                      strokeDasharray: 131.95,
                      strokeDashoffset: 131.95 * (1 - Math.min(
                        Math.max(audioHistoryInsights.averageWpm, 0) / AUDIO_WPM_GAUGE_MAX,
                        1,
                      )),
                    }}
                  />
                </AudioWpmGauge>
              </AudioInsightCard>
              <AudioInsightCard aria-label="Words spoken per day">
                <AudioInsightCardTopline>
                  <AudioInsightLabel>Daily speaking</AudioInsightLabel>
                  <AudioInsightSubValue>
                    {formatInteger(audioHistoryInsights.totalWords)} words
                  </AudioInsightSubValue>
                </AudioInsightCardTopline>
                <AudioHeatmapGrid role="img" aria-label="Words spoken per day, recent weeks">
                  {audioHistoryInsights.weeks.map((week, weekIndex) => (
                    <AudioHeatmapColumn key={`week-${weekIndex}`}>
                      {week.map((cell, dayIndex) => (
                        cell ? (
                          <AudioHeatmapCell
                            data-level={cell.level}
                            key={cell.key}
                            title={cell.label}
                          />
                        ) : (
                          <AudioHeatmapCell data-empty="true" key={`pad-${weekIndex}-${dayIndex}`} />
                        )
                      ))}
                    </AudioHeatmapColumn>
                  ))}
                </AudioHeatmapGrid>
              </AudioInsightCard>
              <AudioInsightCard data-kind="totals">
                <AudioHistoryStatChip>
                  <span>Dictations</span>
                  <strong>{formatInteger(audioHistoryInsights.totalDictations)}</strong>
                </AudioHistoryStatChip>
                <AudioHistoryStatChip>
                  <span>Audio time</span>
                  <strong>{formatAudioHistoryTotalDuration(audioHistoryInsights.audioMs)}</strong>
                </AudioHistoryStatChip>
              </AudioInsightCard>
            </AudioHistoryStats>

            {audioHistory.length ? (
              <AudioHistoryVirtualList
                aria-label="Speech to text history"
                role="list"
              >
                <AudioHistoryList>
                  {audioHistory.map((entry, index) => {
                    const entryKey = getAudioHistoryEntryKey(entry, index);
                    const copied = copiedAudioHistoryId === entryKey;
                    const entryText = String(entry.text || "");
                    const clampable = entryText.length > AUDIO_HISTORY_CLAMP_THRESHOLD_CHARS
                      || entryText.split("\n").length > 3;
                    const expanded = expandedAudioHistoryIds.has(entryKey);

                    return (
                      <AudioHistoryRow
                        data-expanded={expanded ? "true" : "false"}
                        key={entryKey}
                        role="listitem"
                      >
                        <AudioHistoryRowTopline>
                          <span>{formatHistoryTimestamp(entry.createdAt)}</span>
                          <AudioHistoryRowActions>
                            {entry.status === AUDIO_TRANSCRIPTION_STATUS_CANCELLED && (
                              <AudioHistoryStatusBadge>Cancelled</AudioHistoryStatusBadge>
                            )}
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
                        <strong>{entryText}</strong>
                        <AudioHistoryRowFootline>
                          <AudioHistoryMeta>{formatAudioHistoryMeta(entry)}</AudioHistoryMeta>
                          {clampable && (
                            <AudioHistoryExpandButton
                              aria-expanded={expanded}
                              onClick={() => toggleAudioHistoryExpanded(entryKey)}
                              type="button"
                            >
                              {expanded ? "Show less" : "Show more"}
                            </AudioHistoryExpandButton>
                          )}
                        </AudioHistoryRowFootline>
                      </AudioHistoryRow>
                    );
                  })}
                </AudioHistoryList>
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
  const [widgetStyle, setWidgetStyle] = useState(readAudioWidgetStyle);
  const [recordingLocked, setRecordingLocked] = useState(false);
  // True the instant the user finishes speaking (released hold, second tap,
  // finish button): the widget shows the loading phase immediately, even
  // while the pipeline is still arming or draining the final audio.
  const [finishPending, setFinishPending] = useState(false);
  const [cancelNotice, setCancelNotice] = useState(null);
  const [cancelNoticePaused, setCancelNoticePaused] = useState(false);
  const audioBufferRef = useRef(null);
  const audioBufferGenerationRef = useRef(0);
  const audioBufferReadyAtRef = useRef(0);
  const audioBufferStartRef = useRef(null);
  const pushToTalkDownRef = useRef(false);
  const recordingRunRef = useRef(0);
  const stopAfterStartRef = useRef(false);
  const stopRecordingRef = useRef(null);
  const cancelRecordingRef = useRef(null);
  const cancelSalvageRunRef = useRef(0);
  const recordingLockedRef = useRef(false);
  const hybridDownAtRef = useRef(0);
  const hybridLastTapAtRef = useRef(0);
  const hybridPendingDiscardTimerRef = useRef(0);
  const recorderModeRef = useRef(recorderMode);
  const widgetStyleRef = useRef(widgetStyle);
  const cancelNoticeIdRef = useRef(0);
  const undoRequestedIdRef = useRef(0);
  const lastCancelledRef = useRef(null);
  const barSavedPlacementRef = useRef(null);
  const widgetFrameModeRef = useRef(widgetFrameMode);
  const widgetStateRef = useRef(widgetState);
  const forgeVoiceEventsActiveRef = useRef(false);
  const forgeVoiceTtsPlayerRef = useRef(null);
  // GPT-Realtime interim transcripts are token deltas, not cumulative
  // phrases; the live line accumulates them here between turn boundaries.
  const forgeVoiceRealtimeDraftRef = useRef("");

  useEffect(() => {
    widgetStateRef.current = widgetState;
  }, [widgetState]);

  useEffect(() => {
    recorderModeRef.current = recorderMode;
  }, [recorderMode]);

  useEffect(() => {
    widgetStyleRef.current = widgetStyle;
  }, [widgetStyle]);

  useEffect(() => {
    applyAudioWidgetThemePreference(audioWidgetTheme);
  }, [audioWidgetTheme]);

  useEffect(() => {
    // Keep the warm cloud dictation websocket parked while Diff Forge Cloud
    // dictation is selected so push-to-talk in the widget starts instantly.
    invoke("prewarm_forge_dictation_transcription", {
      request: { enabled: transcriptionProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE },
    }).catch(() => {});
  }, [transcriptionProvider]);

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

    recordingLockedRef.current = false;
    setRecordingLocked(false);

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

    if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE) {
      const nextState = hasSetup ? "ready" : "setup";
      widgetStateRef.current = nextState;
      setWidgetState(nextState);
      setModelStatus(null);
      setMessage(hasSetup ? "Forge cloud ready" : "Audio setup needed");
      return;
    }

    if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
      const nextState = hasSetup ? "ready" : "setup";
      widgetStateRef.current = nextState;
      setWidgetState(nextState);
      setModelStatus(null);
      setMessage(hasSetup ? "Forge voice ready" : "Audio setup needed");
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

  const resetForgeVoiceTtsPlayer = useCallback(async () => {
    const previousPlayer = forgeVoiceTtsPlayerRef.current;
    const nextPlayer = createCloudVoiceAgentTtsPlayer({
      onError: (playbackError) => {
        if (!forgeVoiceEventsActiveRef.current) {
          return;
        }
        setError(getAudioInputErrorMessage(playbackError, "Unable to play the Diff Forge Cloud voice response."));
      },
    });
    forgeVoiceTtsPlayerRef.current = nextPlayer;
    await previousPlayer?.close?.().catch(() => {});
    await nextPlayer.prime?.();
    return nextPlayer;
  }, []);

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
    } else if (
      currentProvider !== AUDIO_TRANSCRIPTION_PROVIDER_FORGE
      && currentProvider !== AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
      && !modelStatus?.installed
    ) {
      setError("Install Whisper from the Audio tab before recording.");
      return;
    }

    if (currentState === "checking" || currentState === "warming") {
      return;
    }

    const recordingRunId = recordingRunRef.current + 1;
    recordingRunRef.current = recordingRunId;
    setError("");
    setFinishPending(false);
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
      setRecordingStartedAt(Date.now());
      setElapsedMs(0);
      const waitsForCloudStart = currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
        || currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
        || currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT;
      if (!waitsForCloudStart) {
        widgetStateRef.current = "recording";
        setWidgetState("recording");
      }
      playNotificationSfx("voice.on");
      setMessage(currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
        ? "Opening Deepgram stream"
        : currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
          ? "Connecting Diff Forge Cloud"
          : currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
            ? "Connecting Forge voice"
            : "Recording");
      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
        setMessage("Opening Deepgram stream");
        await invoke("start_deepgram_realtime_transcription", {
          request: {
            apiKey: readDeepgramApiKey(),
            language: readDeepgramLanguage(),
          },
        });
      } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE) {
        setMessage("Connecting Diff Forge Cloud");
        await invoke("start_forge_dictation_transcription", {
          request: {
            llmCleanup: readForgeLlmCleanup(),
            language: readDeepgramLanguage(),
          },
        });
      } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
        await resetForgeVoiceTtsPlayer();
        forgeVoiceEventsActiveRef.current = true;
        await startCloudVoiceAgentStream({
          realtime: readOrchestratorRealtimeEnabled(),
          submissionMode: readOrchestratorVoiceSubmissionMode(),
        });
      }
      if (recordingRunRef.current !== recordingRunId) {
        if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
          await invoke("stop_deepgram_realtime_transcription").catch(() => {});
        } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE) {
          await invoke("stop_forge_dictation_transcription", { request: { cancel: true } }).catch(() => {});
        } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
          forgeVoiceEventsActiveRef.current = false;
          await stopCloudVoiceAgentStream().catch(() => {});
        }
        await audioBuffer.finishCapture().catch(() => null);
        if (audioBufferRef.current === audioBuffer) {
          await closeWarmBuffer();
        } else {
          await audioBuffer.close().catch(() => {});
        }
        return;
      }
      widgetStateRef.current = "recording";
      setWidgetState("recording");
      setMessage(currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
        ? "Deepgram listening"
        : currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
          ? "Forge cloud listening"
          : currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
            ? "Forge voice listening"
          : "Recording");

      if (stopAfterStartRef.current || !pushToTalkDownRef.current) {
        stopAfterStartRef.current = false;
        window.setTimeout(() => stopRecordingRef.current?.(), 0);
      }
    } catch (recordingError) {
      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
        await invoke("stop_deepgram_realtime_transcription").catch(() => {});
      } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE) {
        await invoke("stop_forge_dictation_transcription", { request: { cancel: true } }).catch(() => {});
      } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
        forgeVoiceEventsActiveRef.current = false;
        await stopCloudVoiceAgentStream().catch(() => {});
      }
      const failedAudioBuffer = audioBufferRef.current || audioBuffer;
      if (captureBegan) {
        await failedAudioBuffer?.finishCapture?.().catch(() => null);
        playNotificationSfx("voice.off");
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
  }, [closeWarmBuffer, modelStatus?.installed, resetForgeVoiceTtsPlayer, startWarmBuffer, waitForWarmPrerollBuffer]);

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

    if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE) {
      const hasSetup = hasAudioInputSetup();
      const nextState = hasSetup ? "ready" : "setup";
      widgetStateRef.current = nextState;
      setWidgetState(nextState);
      setModelStatus(null);
      setMessage(hasSetup ? "Forge cloud ready" : "Audio setup needed");
      return;
    }

    if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
      const hasSetup = hasAudioInputSetup();
      const nextState = hasSetup ? "ready" : "setup";
      widgetStateRef.current = nextState;
      setWidgetState(nextState);
      setModelStatus(null);
      setMessage(hasSetup ? "Forge voice ready" : "Audio setup needed");
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
  const widgetActive = widgetState === "arming"
    || widgetState === "recording"
    || widgetState === "transcribing"
    || widgetState === "error";
  const usesBottomAnchoredStyle = widgetStyle === AUDIO_WIDGET_STYLE_BAR;
  const cancelNoticeActive = Boolean(cancelNotice);
  const barVisible = usesBottomAnchoredStyle
    && (widgetActive || cancelNoticeActive);
  // Bubble style shows the same cancel notice pill as the bar: the window
  // morphs to the pill in place while it shows, then morphs back.
  const bubbleCancelNoticeActive = cancelNoticeActive
    && !usesBottomAnchoredStyle
    && widgetStyle !== AUDIO_WIDGET_STYLE_HIDDEN;
  const bubbleCancelNoticeActiveRef = useRef(bubbleCancelNoticeActive);
  bubbleCancelNoticeActiveRef.current = bubbleCancelNoticeActive;

  // The hidden style keeps the window "visible" to the OS (global shortcuts
  // require it) but inert and invisible while idle. The bar style is always
  // interactive: its idle line must respond to hover.
  useEffect(() => {
    const ignoreCursor = widgetStyle === AUDIO_WIDGET_STYLE_HIDDEN && !widgetActive;
    runWidgetWindowAction((windowHandle) => windowHandle.setIgnoreCursorEvents(ignoreCursor));
  }, [runWidgetWindowAction, widgetActive, widgetStyle]);

  // The bar style docks the window bottom-center of the active monitor; the
  // user's bubble placement is restored on exit. The monitor work area keeps
  // the line above the macOS Dock / Windows taskbar on whichever screen it is
  // on, and in fullscreen (no dock/taskbar) the same math hugs the bare edge.
  useEffect(() => {
    if (!usesBottomAnchoredStyle) {
      const saved = barSavedPlacementRef.current;
      if (saved) {
        barSavedPlacementRef.current = null;
        runWidgetWindowAction(async (windowHandle) => {
          await windowHandle.setSize(
            new LogicalSize(AUDIO_WIDGET_COMPACT_SIZE.width, AUDIO_WIDGET_COMPACT_SIZE.height),
          );
          await windowHandle.setPosition(saved.position);
        });
      }
      return;
    }

    const target = cancelNoticeActive
      ? AUDIO_WIDGET_BAR_NOTICE_SIZE
      : barVisible
        ? AUDIO_WIDGET_BAR_SIZE
        : AUDIO_WIDGET_BAR_IDLE_SIZE;
    const margin = barVisible
      ? AUDIO_WIDGET_BAR_BOTTOM_MARGIN
      : AUDIO_WIDGET_BAR_IDLE_BOTTOM_MARGIN;

    runWidgetWindowAction(async (windowHandle) => {
      if (!barSavedPlacementRef.current) {
        barSavedPlacementRef.current = {
          position: await windowHandle.outerPosition(),
        };
      }
      await windowHandle.setSize(new LogicalSize(target.width, target.height));
      const monitor = await currentMonitor();
      if (monitor) {
        const scale = monitor.scaleFactor || 1;
        const area = monitor.workArea?.size?.height
          ? monitor.workArea
          : { position: monitor.position, size: monitor.size };
        const x = area.position.x
          + Math.round((area.size.width - (target.width * scale)) / 2);
        const y = area.position.y
          + area.size.height
          - Math.round((target.height + margin) * scale);
        await windowHandle.setPosition(new PhysicalPosition(x, y));
      }
    });
  }, [barVisible, cancelNoticeActive, runWidgetWindowAction, usesBottomAnchoredStyle, widgetStyle]);

  // Bubble-style errors get a small card above the widget: the window grows
  // upward by the card height while the error shows, and the pill stays at
  // its original spot on screen. (The resize effect itself is declared after
  // the frame-mode effect below so its size wins within the same commit.)
  const errorFrameActive = widgetState === "error"
    && Boolean(error)
    && !usesBottomAnchoredStyle;

  useEffect(() => {
    if (widgetStyle === AUDIO_WIDGET_STYLE_BAR) {
      return undefined;
    }
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

          // The cancel notice owns the window size while it shows; its
          // dismissal effect restores the compact bubble itself.
          if (!bubbleCancelNoticeActiveRef.current) {
            runWidgetWindowAction((windowHandle) => (
              windowHandle.setSize(new LogicalSize(AUDIO_WIDGET_COMPACT_SIZE.width, AUDIO_WIDGET_COMPACT_SIZE.height))
            ));
          }

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
      if (!bubbleCancelNoticeActiveRef.current) {
        runWidgetWindowAction((windowHandle) => (
          windowHandle.setSize(new LogicalSize(AUDIO_WIDGET_COMPACT_SIZE.width, AUDIO_WIDGET_COMPACT_SIZE.height))
        ));
      }
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
  }, [runWidgetWindowAction, setWidgetFrameMode, widgetStyle, widgetTargetMode]);

  useEffect(() => {
    if (!errorFrameActive) {
      return undefined;
    }
    let savedPosition = null;
    runWidgetWindowAction(async (windowHandle) => {
      const scale = await windowHandle.scaleFactor().catch(() => 1);
      savedPosition = await windowHandle.outerPosition();
      await windowHandle.setSize(new LogicalSize(
        AUDIO_WIDGET_FOCUS_SIZE.width,
        AUDIO_WIDGET_FOCUS_SIZE.height + AUDIO_WIDGET_ERROR_POPOVER_HEIGHT,
      ));
      await windowHandle.setPosition(new PhysicalPosition(
        savedPosition.x,
        savedPosition.y - Math.round(AUDIO_WIDGET_ERROR_POPOVER_HEIGHT * (scale || 1)),
      ));
    });
    return () => {
      runWidgetWindowAction(async (windowHandle) => {
        await windowHandle.setSize(new LogicalSize(
          AUDIO_WIDGET_FOCUS_SIZE.width,
          AUDIO_WIDGET_FOCUS_SIZE.height,
        ));
        if (savedPosition) {
          await windowHandle.setPosition(savedPosition);
        }
      });
    };
  }, [errorFrameActive, runWidgetWindowAction]);

  // Bubble-style cancel notice: morph the window into the notice pill at the
  // bubble's spot (nudged left if it would run off-screen), then restore the
  // compact bubble exactly where it was once the notice dismisses.
  useEffect(() => {
    if (!bubbleCancelNoticeActive) {
      return undefined;
    }
    let savedPosition = null;
    runWidgetWindowAction(async (windowHandle) => {
      const scale = (await windowHandle.scaleFactor().catch(() => 1)) || 1;
      savedPosition = await windowHandle.outerPosition();
      await windowHandle.setSize(new LogicalSize(
        AUDIO_WIDGET_BAR_NOTICE_SIZE.width,
        AUDIO_WIDGET_BAR_NOTICE_SIZE.height,
      ));
      const monitor = await currentMonitor().catch(() => null);
      if (monitor) {
        const area = monitor.workArea?.size?.width
          ? monitor.workArea
          : { position: monitor.position, size: monitor.size };
        const maxX = area.position.x
          + area.size.width
          - Math.round(AUDIO_WIDGET_BAR_NOTICE_SIZE.width * scale);
        const x = Math.max(area.position.x, Math.min(savedPosition.x, maxX));
        await windowHandle.setPosition(new PhysicalPosition(x, savedPosition.y));
      }
    });
    return () => {
      runWidgetWindowAction(async (windowHandle) => {
        await windowHandle.setSize(new LogicalSize(
          AUDIO_WIDGET_COMPACT_SIZE.width,
          AUDIO_WIDGET_COMPACT_SIZE.height,
        ));
        if (savedPosition) {
          await windowHandle.setPosition(savedPosition);
        }
      });
    };
  }, [bubbleCancelNoticeActive, runWidgetWindowAction]);

  const dragWidget = useCallback((event) => {
    if (event.button !== 0) {
      return;
    }

    if (widgetStyleRef.current === AUDIO_WIDGET_STYLE_BAR) {
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
      setFinishPending(true);
      stopRecordingRef.current?.();
    } else if (widgetStateRef.current === "arming") {
      setFinishPending(true);
      stopAfterStartRef.current = true;
    }
  }, []);

  const toggleTalk = useCallback(() => {
    const currentState = widgetStateRef.current;

    if (currentState === "recording") {
      pushToTalkDownRef.current = false;
      stopAfterStartRef.current = false;
      setFinishPending(true);
      stopRecordingRef.current?.();
      return;
    }

    if (currentState === "arming") {
      pushToTalkDownRef.current = false;
      stopAfterStartRef.current = true;
      setFinishPending(true);
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

  const clearHybridPendingDiscard = useCallback(() => {
    if (hybridPendingDiscardTimerRef.current) {
      window.clearTimeout(hybridPendingDiscardTimerRef.current);
      hybridPendingDiscardTimerRef.current = 0;
    }
  }, []);

  const handleHybridShortcutPressed = useCallback(() => {
    hybridDownAtRef.current = Date.now();
    clearHybridPendingDiscard();

    if (recordingLockedRef.current) {
      // Locked: the upcoming release stops the recording.
      return;
    }

    // Start capturing immediately. This covers both a hold (push-to-talk)
    // and the first tap of a double-tap lock, so locked recordings include
    // audio from the very first tap.
    pressPushToTalk();
  }, [clearHybridPendingDiscard, pressPushToTalk]);

  const handleHybridShortcutReleased = useCallback(() => {
    const heldMs = Date.now() - (hybridDownAtRef.current || Date.now());
    hybridDownAtRef.current = 0;

    if (recordingLockedRef.current) {
      // Any press while locked stops and transcribes.
      recordingLockedRef.current = false;
      setRecordingLocked(false);
      hybridLastTapAtRef.current = 0;
      pushToTalkDownRef.current = false;
      if (widgetStateRef.current === "recording") {
        stopAfterStartRef.current = false;
        setFinishPending(true);
        stopRecordingRef.current?.();
      } else if (widgetStateRef.current === "arming") {
        stopAfterStartRef.current = true;
        setFinishPending(true);
      }
      return;
    }

    if (heldMs >= AUDIO_HYBRID_TAP_MAX_MS) {
      // Hold gesture: classic push-to-talk release.
      hybridLastTapAtRef.current = 0;
      releasePushToTalk();
      return;
    }

    const now = Date.now();

    if (now - (hybridLastTapAtRef.current || 0) <= AUDIO_HYBRID_DOUBLE_TAP_MS) {
      // Double tap: lock continuous recording.
      hybridLastTapAtRef.current = 0;
      clearHybridPendingDiscard();
      recordingLockedRef.current = true;
      setRecordingLocked(true);
      return;
    }

    // First tap: keep capturing quietly through the double-tap window, then
    // discard if no second tap lands (no history row, no transcription run).
    hybridLastTapAtRef.current = now;
    clearHybridPendingDiscard();
    hybridPendingDiscardTimerRef.current = window.setTimeout(() => {
      hybridPendingDiscardTimerRef.current = 0;

      if (recordingLockedRef.current || hybridDownAtRef.current) {
        return;
      }

      hybridLastTapAtRef.current = 0;
      cancelRecordingRef.current?.({ salvage: false });
    }, AUDIO_HYBRID_DOUBLE_TAP_MS + 40);
  }, [clearHybridPendingDiscard, releasePushToTalk]);

  const handleRecorderShortcutPressed = useCallback(() => {
    if (recorderModeRef.current === AUDIO_RECORDER_MODE_HYBRID) {
      handleHybridShortcutPressed();
      return;
    }

    if (recorderModeRef.current === AUDIO_RECORDER_MODE_TOGGLE_TO_TALK) {
      toggleTalk();
      return;
    }

    pressPushToTalk();
  }, [handleHybridShortcutPressed, pressPushToTalk, toggleTalk]);

  const handleRecorderShortcutReleased = useCallback(() => {
    if (recorderModeRef.current === AUDIO_RECORDER_MODE_HYBRID) {
      handleHybridShortcutReleased();
      return;
    }

    if (recorderModeRef.current === AUDIO_RECORDER_MODE_TOGGLE_TO_TALK) {
      return;
    }

    releasePushToTalk();
  }, [handleHybridShortcutReleased, releasePushToTalk]);

  const publishCancelledTranscript = useCallback(async (result, provider) => {
    const rawText = String(result?.text || "").trim();
    const audioMs = Number(result?.audioMs || 0);

    if (!rawText || (audioMs > 0 && audioMs < AUDIO_CANCEL_SALVAGE_MIN_AUDIO_MS)) {
      return;
    }

    const pipeline = applyVoiceTextPipeline(rawText, peekVoiceTextRules());
    const text = (pipeline.text || "").trim() || rawText;
    const entry = {
      audioMs,
      createdAt: new Date().toISOString(),
      id: `${Date.now()}`,
      latencyMs: Number(result?.latencyMs || 0),
      language: provider === AUDIO_TRANSCRIPTION_PROVIDER_LOCAL ? "" : readDeepgramLanguage(),
      provider,
      source: provider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
        ? "deepgram-nova-3-live"
        : provider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
          ? "forge-voice-agent"
        : provider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
          ? "forge-nova3-dictation"
          : "whisper-local",
      sourceText: pipeline.changed ? rawText : "",
      text,
    };

    const noticeId = cancelNoticeIdRef.current;
    lastCancelledRef.current = { noticeId, entry };

    if (noticeId !== 0 && undoRequestedIdRef.current === noticeId) {
      // The user pressed Undo before this salvage finished: paste instead.
      await publishAudioTranscriptionResult({
        ...entry,
        status: AUDIO_TRANSCRIPTION_STATUS_INSERTED,
      }).catch(() => {});
      await invoke("insert_handsfree_transcribed_text", { text }).catch(() => {});
      return;
    }

    await publishAudioTranscriptionResult({
      ...entry,
      status: AUDIO_TRANSCRIPTION_STATUS_CANCELLED,
    }).catch(() => {});
  }, []);

  const dismissCancelNotice = useCallback(() => {
    setCancelNotice(null);
    setCancelNoticePaused(false);
  }, []);

  // Live-stream mirror for the Activity widget: while a take is in flight,
  // broadcast the phase and the interim transcript so other windows can show
  // the audio coming in; one inactive frame closes the stream when it ends.
  const dictationStreamActiveRef = useRef(false);
  useEffect(() => {
    const phase = widgetState === "transcribing" || finishPending
      ? "transcribing"
      : widgetState === "recording" || widgetState === "arming"
        ? "listening"
        : "";
    if (!phase) {
      if (dictationStreamActiveRef.current) {
        dictationStreamActiveRef.current = false;
        emit(AUDIO_DICTATION_STREAM_EVENT, { active: false }).catch(() => {});
      }
      return;
    }
    dictationStreamActiveRef.current = true;
    emit(AUDIO_DICTATION_STREAM_EVENT, {
      active: true,
      atMs: Date.now(),
      phase,
      text: realtimeTranscript,
    }).catch(() => {});
  }, [finishPending, realtimeTranscript, widgetState]);

  useEffect(() => () => {
    if (dictationStreamActiveRef.current) {
      emit(AUDIO_DICTATION_STREAM_EVENT, { active: false }).catch(() => {});
    }
  }, []);

  const openDictationHistory = useCallback(async () => {
    dismissCancelNotice();
    try {
      // A freshly created monitor popover reads its tab from storage at
      // mount; the Rust command's event covers an already-open popover.
      // Both paths land on the Activity tab.
      window.localStorage.setItem("diffforge.backgroundMonitor.lastTab.v1", "activity");
    } catch {
      // Tab preference is convenience state only.
    }
    await invoke("background_monitor_open_activity").catch(() => {});
  }, [dismissCancelNotice]);

  const copyCancelledTranscript = useCallback(async () => {
    // The salvage transcription may still be running when the notice shows;
    // fall back to the newest cancelled history entry once it lands.
    let transcript = String(lastCancelledRef.current?.entry?.text || "").trim();
    if (!transcript) {
      transcript = String(
        readAudioTranscriptionHistory()
          .find((entry) => entry?.status === AUDIO_TRANSCRIPTION_STATUS_CANCELLED)?.text || "",
      ).trim();
    }
    if (!transcript) {
      setMessage("Transcript still processing");
      return;
    }
    try {
      await navigator.clipboard.writeText(transcript);
      setMessage("Transcript copied");
    } catch {
      setMessage("Unable to copy the transcript");
    }
  }, []);

  const showCancelNotice = useCallback(() => {
    cancelNoticeIdRef.current += 1;
    setCancelNoticePaused(false);
    setCancelNotice({ id: cancelNoticeIdRef.current });
  }, []);

  const undoCancelledTranscript = useCallback(async () => {
    const noticeId = cancelNoticeIdRef.current;
    undoRequestedIdRef.current = noticeId;
    setCancelNotice(null);
    setCancelNoticePaused(false);

    const pending = lastCancelledRef.current;
    if (pending?.noticeId !== noticeId || !pending?.entry?.text) {
      // Salvage transcription is still running; it pastes when it lands.
      setMessage("Undo queued, transcribing");
      return;
    }

    setMessage("Inserting into target");
    await publishAudioTranscriptionResult({
      ...pending.entry,
      status: AUDIO_TRANSCRIPTION_STATUS_INSERTED,
    }).catch(() => {});
    try {
      await invoke("insert_handsfree_transcribed_text", { text: pending.entry.text });
      setMessage("Inserted into target");
    } catch (insertError) {
      setMessage("Sent to Audio tab");
      setError(getErrorMessage(insertError, "Transcript saved, but focused insertion failed."));
    }
  }, []);

  const stopRecording = useCallback(async () => {
    const audioBuffer = audioBufferRef.current;
    const recordingRunId = recordingRunRef.current;

    if (!audioBuffer || widgetStateRef.current !== "recording") {
      return;
    }

    pushToTalkDownRef.current = false;
    stopAfterStartRef.current = false;
    recordingLockedRef.current = false;
    setRecordingLocked(false);
    hybridLastTapAtRef.current = 0;
    // History shows turnaround from this moment (record button released /
    // request submitted) until the transcript lands.
    const submittedAt = Date.now();
    widgetStateRef.current = "transcribing";
    setWidgetState("transcribing");
    playNotificationSfx("voice.off");
    setMessage("Preparing audio");
    setError("");

    try {
      const currentProvider = readAudioTranscriptionProvider();
      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
        setMessage("Capturing final audio");
        await waitForAudioPostBuffer(DEEPGRAM_RELEASE_POST_BUFFER_MS);
        if (recordingRunRef.current !== recordingRunId) {
          throw new Error("Diff Forge Cloud voice canceled.");
        }
        setMessage("Finishing voice input");
        await finishCloudVoiceAgentInput();
        await audioBuffer.finishCapture().catch(() => null);
        if (recordingRunRef.current !== recordingRunId) {
          return;
        }
        setMessage("Forge voice responding");
        return;
      }

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
      : currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
        ? await (async () => {
          setMessage("Capturing final audio");
          await waitForAudioPostBuffer(FORGE_RELEASE_POST_BUFFER_MS);
          if (recordingRunRef.current !== recordingRunId) {
            throw new Error("Diff Forge Cloud dictation canceled.");
          }
          setMessage("Finishing in Diff Forge Cloud");
          const dictationResult = await invoke("stop_forge_dictation_transcription", {
            request: { cancel: false },
          });
          const captureResult = await audioBuffer.finishCapture().catch(() => null);
          return {
            ...(dictationResult || {}),
            audioMs: Number(
              captureResult?.audioMs
              || Number(dictationResult?.audioSeconds || 0) * 1000
              || 0,
            ),
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
        if (cancelSalvageRunRef.current === recordingRunId) {
          cancelSalvageRunRef.current = 0;
          publishCancelledTranscript(
            { ...result, latencyMs: Math.max(0, Date.now() - submittedAt) },
            currentProvider,
          );
        }
        return;
      }
      setMessage(currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
        ? "Deepgram final"
        : currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
          ? (result?.llmCleaned ? "Forge cloud cleaned" : "Forge cloud final")
          : "Transcribed locally");
      const rawTranscript = (result?.text || "").trim();

      if (!rawTranscript) {
        if (recordingRunRef.current !== recordingRunId) {
          return;
        }
        widgetStateRef.current = "ready";
        setWidgetState("ready");
        setMessage("No transcript returned");
        return;
      }

      const pipeline = applyVoiceTextPipeline(rawTranscript, peekVoiceTextRules());
      const nextTranscript = (pipeline.text || "").trim() || rawTranscript;

      await publishAudioTranscriptionResult({
        audioMs: Number(result?.audioMs || 0),
        createdAt: new Date().toISOString(),
        id: `${Date.now()}`,
        latencyMs: Math.max(0, Date.now() - submittedAt),
        language: currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_LOCAL ? "" : readDeepgramLanguage(),
        provider: currentProvider,
        source: currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
          ? "deepgram-nova-3-live"
          : currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
            ? "forge-voice-agent"
          : currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
            ? (result?.llmCleaned ? "forge-nova3-llm-cleaned" : "forge-nova3-dictation")
            : "whisper-local",
        sourceText: pipeline.changed ? rawTranscript : "",
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
      if (readAudioTranscriptionProvider() === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
        forgeVoiceEventsActiveRef.current = false;
        await stopCloudVoiceAgentStream().catch(() => {});
      }
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
  }, [closeWarmBuffer, publishCancelledTranscript]);

  /**
   * Salvages a locally captured recording that was cancelled mid-flight: the
   * transcription runs detached in the background and lands in history tagged
   * cancelled, never inserted into a target.
   */
  const salvageLocalCancelledCapture = useCallback((captureResult, captureStats) => {
    const audioMs = Number(captureResult?.audioMs || 0);

    if (!captureResult?.wavBuffer || audioMs < AUDIO_CANCEL_SALVAGE_MIN_AUDIO_MS) {
      return;
    }

    const audioBase64 = arrayBufferToBase64(captureResult.wavBuffer);
    const submittedAt = Date.now();

    invoke("transcribe_whisper_audio", {
      request: {
        audioBase64,
        audioMs,
        capturePeak: Number(captureStats?.peak || 0),
        captureRms: Number(captureStats?.rms || 0),
      },
    })
      .then((transcriptionResult) => publishCancelledTranscript(
        {
          ...(transcriptionResult || {}),
          audioMs,
          latencyMs: Math.max(0, Date.now() - submittedAt),
        },
        AUDIO_TRANSCRIPTION_PROVIDER_LOCAL,
      ))
      .catch(() => {});
  }, [publishCancelledTranscript]);

  const cancelRecording = useCallback(async ({ salvage = true } = {}) => {
    const currentState = widgetStateRef.current;
    const audioBuffer = audioBufferRef.current;
    const recordingRunId = recordingRunRef.current;
    recordingRunRef.current += 1;
    pushToTalkDownRef.current = false;
    stopAfterStartRef.current = false;
    hybridDownAtRef.current = 0;
    hybridLastTapAtRef.current = 0;
    if (hybridPendingDiscardTimerRef.current) {
      window.clearTimeout(hybridPendingDiscardTimerRef.current);
      hybridPendingDiscardTimerRef.current = 0;
    }

    const currentProvider = readAudioTranscriptionProvider();
    const salvageable = currentState === "transcribing"
      || (currentState === "recording" && Boolean(audioBuffer));

    // Bar and bubble styles share the same cancel notice (copy / undo /
    // history / drain-to-zero); only the invisible-while-idle hidden style
    // skips it, since it has no surface to host the card.
    if (salvage && salvageable && widgetStyleRef.current !== AUDIO_WIDGET_STYLE_HIDDEN) {
      showCancelNotice();
    }

    // Cancel must feel instant: the widget resets to its start state right
    // away (ready for the next take) and every provider stop / capture
    // teardown / history salvage runs detached in the background.
    if (currentState === "transcribing") {
      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
        forgeVoiceEventsActiveRef.current = false;
        resetWidgetToStartState();
        setMessage("Cancelled");
        void (async () => {
          await stopCloudVoiceAgentStream().catch(() => {});
          await forgeVoiceTtsPlayerRef.current?.close?.().catch(() => {});
          forgeVoiceTtsPlayerRef.current = null;
        })();
        return;
      }

      if (salvage) {
        // Let the in-flight transcription finish detached; the invalidated
        // stopRecording run publishes it as cancelled instead of inserting.
        cancelSalvageRunRef.current = recordingRunId;
      } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_LOCAL) {
        void invoke("cancel_whisper_transcription").catch(() => {});
      }

      resetWidgetToStartState();
      setMessage(salvage ? "Cancelled, saving to history" : "Cancelled");
      return;
    }

    if (currentState === "recording" && salvage && audioBuffer) {
      const captureStats = audioBuffer.getCaptureStats?.() || null;
      const submittedAt = Date.now();
      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
        forgeVoiceEventsActiveRef.current = false;
      }
      // Detach the buffer from the widget synchronously so an immediate new
      // take warms a fresh one; the detached task below finishes and closes
      // this captured buffer itself.
      if (audioBufferRef.current === audioBuffer) {
        audioBufferGenerationRef.current += 1;
        audioBufferStartRef.current = null;
        audioBufferReadyAtRef.current = 0;
        audioBufferRef.current = null;
      }
      resetWidgetToStartState();
      setMessage(currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
        ? "Cancelled"
        : "Cancelled, saving to history");

      void (async () => {
        if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
          const realtimeResult = await invoke("stop_deepgram_realtime_transcription").catch(() => null);
          const captureResult = await audioBuffer.finishCapture().catch(() => null);
          publishCancelledTranscript(
            {
              ...(realtimeResult || {}),
              audioMs: Number(captureResult?.audioMs || realtimeResult?.audioMs || 0),
              latencyMs: Math.max(0, Date.now() - submittedAt),
            },
            AUDIO_TRANSCRIPTION_PROVIDER_CLOUD,
          );
        } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE) {
          // Cancelled cloud dictation still returns the transcript so far.
          const dictationResult = await invoke("stop_forge_dictation_transcription", {
            request: { cancel: true },
          }).catch(() => null);
          const captureResult = await audioBuffer.finishCapture().catch(() => null);
          publishCancelledTranscript(
            {
              ...(dictationResult || {}),
              audioMs: Number(
                captureResult?.audioMs
                || Number(dictationResult?.audioSeconds || 0) * 1000
                || 0,
              ),
              latencyMs: Math.max(0, Date.now() - submittedAt),
            },
            AUDIO_TRANSCRIPTION_PROVIDER_FORGE,
          );
        } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
          await stopCloudVoiceAgentStream().catch(() => {});
          await audioBuffer.finishCapture().catch(() => null);
          await forgeVoiceTtsPlayerRef.current?.close?.().catch(() => {});
          forgeVoiceTtsPlayerRef.current = null;
        } else {
          const captureResult = await audioBuffer.finishCapture().catch(() => null);
          salvageLocalCancelledCapture(captureResult, captureStats);
        }

        await audioBuffer?.close?.().catch(() => {});
      })();
      return;
    }

    if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
      forgeVoiceEventsActiveRef.current = false;
    }
    // closeWarmBuffer detaches the buffer ref synchronously, so an immediate
    // new take never races the close running in the background.
    void closeWarmBuffer().catch(() => {});
    resetWidgetToStartState();
    void (async () => {
      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
        await invoke("stop_deepgram_realtime_transcription").catch(() => {});
      } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE) {
        await invoke("stop_forge_dictation_transcription", { request: { cancel: true } }).catch(() => {});
      } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
        await stopCloudVoiceAgentStream().catch(() => {});
        await forgeVoiceTtsPlayerRef.current?.close?.().catch(() => {});
        forgeVoiceTtsPlayerRef.current = null;
      } else {
        await invoke("cancel_whisper_transcription").catch(() => {});
      }
    })();
  }, [closeWarmBuffer, publishCancelledTranscript, resetWidgetToStartState, salvageLocalCancelledCapture, showCancelNotice]);

  // "Finish and paste" from the bottom bar: stop the active take (locked or
  // held) and run the normal transcribe-and-insert flow.
  const finishFromBar = useCallback(() => {
    recordingLockedRef.current = false;
    setRecordingLocked(false);
    hybridLastTapAtRef.current = 0;
    pushToTalkDownRef.current = false;

    if (widgetStateRef.current === "recording") {
      stopAfterStartRef.current = false;
      setFinishPending(true);
      stopRecordingRef.current?.();
    } else if (widgetStateRef.current === "arming") {
      stopAfterStartRef.current = true;
      setFinishPending(true);
    }
  }, []);

  const forwardEscapeToActiveTerminal = useCallback((fields = {}) => {
    invoke("terminal_write_to_audio_input_target", { data: "\x1b" })
      .then((wrote) => {
      })
      .catch((error) => {
      });
  }, []);

  // The finish-pending loading phase only spans the live pipeline states;
  // once the run settles (ready, error, reset) the flag clears itself.
  useEffect(() => {
    if (
      widgetState !== "arming"
      && widgetState !== "recording"
      && widgetState !== "transcribing"
    ) {
      setFinishPending(false);
    }
  }, [widgetState]);

  // Errors (cloud dictation failures included) show in the small card above
  // the widget, then the widget returns to its resting state on its own.
  useEffect(() => {
    if (widgetState !== "error") {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      if (widgetStateRef.current === "error") {
        resetWidgetToStartState();
      }
    }, AUDIO_WIDGET_ERROR_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [resetWidgetToStartState, widgetState]);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  useEffect(() => {
    cancelRecordingRef.current = cancelRecording;
  }, [cancelRecording]);

  useEffect(() => {
    loadVoiceTextRules();
    return subscribeVoiceTextRules();
  }, []);

  useEffect(() => {
    refreshStatus();
    refreshShortcutStatus();

    return () => {
      const hadForgeVoice = forgeVoiceEventsActiveRef.current;
      forgeVoiceEventsActiveRef.current = false;
      if (hadForgeVoice) {
        stopCloudVoiceAgentStream().catch(() => {});
        forgeVoiceTtsPlayerRef.current?.close?.().catch(() => {});
        forgeVoiceTtsPlayerRef.current = null;
      }
      closeWarmBuffer();
    };
  }, [closeWarmBuffer, refreshShortcutStatus, refreshStatus]);

  useEffect(() => {
    if (widgetState !== "ready" || !hasAudioInputSetup()) {
      return undefined;
    }

    const providerReady = transcriptionProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
      ? Boolean(deepgramApiKey.trim())
      : transcriptionProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
        ? true
      : transcriptionProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
        ? true
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
      setWidgetStyle(readAudioWidgetStyle());
      setTranscriptionProvider(readAudioTranscriptionProvider());
      setDeepgramApiKey(readDeepgramApiKey());
      setDeepgramLanguage(readDeepgramLanguage());

      if (reason !== "widget-theme" && reason !== "widget-style") {
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
      const liveLabel = readAudioTranscriptionProvider() === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
        ? "Forge cloud"
        : "Deepgram";
      setMessage(event.payload?.isFinal ? `${liveLabel} finalizing` : `${liveLabel} live`);
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

    subscribeCloudVoiceAgentEvents((event) => {
      if (disposed || !forgeVoiceEventsActiveRef.current) {
        return;
      }

      const kind = cloudVoiceAgentEventKind(event);
      if (kind === "voice_agent_stream_started") {
        setError("");
        setMessage("Forge voice listening");
        return;
      }

      if (kind === "voice_agent_transcript") {
        const isRealtimeEngine = String(event?.provider || "").trim() === "openai_realtime";
        const isFinal = Boolean(event?.final) || String(event?.event || "").trim() === "EndOfTurn";
        const rawTranscript = String(event?.transcript || event?.text || "");
        if (isRealtimeEngine && !isFinal) {
          forgeVoiceRealtimeDraftRef.current += rawTranscript;
          const draft = forgeVoiceRealtimeDraftRef.current.trim();
          if (draft) {
            setRealtimeTranscript(draft);
            setMessage("Forge voice live");
          }
          return;
        }
        forgeVoiceRealtimeDraftRef.current = "";
        const transcript = rawTranscript.trim();
        if (transcript) {
          setRealtimeTranscript(transcript);
          setMessage(isFinal ? "Forge voice heard" : "Forge voice live");
        }
        return;
      }

      if (
        kind === "voice_agent_llm_feedback"
        || kind === "voice_agent_fast_llm_feedback"
        || kind === "voice_agent_initial_llm_feedback"
      ) {
        const feedback = String(event?.feedback || event?.text || "").trim();
        setMessage(feedback ? "Forge voice responding" : "Forge voice thinking");
        return;
      }

      if (
        kind === "voice_agent_tts_start"
        || kind === "voice_agent_tts_audio"
        || kind === "voice_agent_tts_end"
      ) {
        if (kind === "voice_agent_tts_start") {
          setMessage("Forge voice speaking");
        }
        void forgeVoiceTtsPlayerRef.current?.handleEvent?.(event);
        return;
      }

      if (kind === "voice_agent_tts_error") {
        setError(String(event?.error?.message || event?.message || "Diff Forge Cloud could not play the voice response."));
        return;
      }

      if (kind === "voice_agent_error") {
        const messageText = String(event?.error?.message || event?.message || "Diff Forge Cloud voice stopped.");
        forgeVoiceEventsActiveRef.current = false;
        widgetStateRef.current = "error";
        setWidgetState("error");
        setMessage("Forge voice error");
        setError(messageText);
        void stopCloudVoiceAgentStream().catch(() => {});
        void forgeVoiceTtsPlayerRef.current?.close?.().catch(() => {});
        forgeVoiceTtsPlayerRef.current = null;
        return;
      }

      if (kind === "voice_agent_finished") {
        forgeVoiceEventsActiveRef.current = false;
        void (async () => {
          await stopCloudVoiceAgentStream().catch(() => {});
          await forgeVoiceTtsPlayerRef.current?.close?.().catch(() => {});
          forgeVoiceTtsPlayerRef.current = null;
        })();
        widgetStateRef.current = "ready";
        setWidgetState("ready");
        setWidgetAudioStats(EMPTY_AUDIO_INPUT_STATS);
        setMessage("Forge voice ready");
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten?.();
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

    const maxSeconds = recordingLocked
      ? AUDIO_RECORDING_LOCKED_MAX_SECONDS
      : AUDIO_RECORDING_MAX_SECONDS;
    const timer = window.setInterval(() => {
      const nextElapsedMs = Date.now() - recordingStartedAt;
      setElapsedMs(nextElapsedMs);

      if (nextElapsedMs >= maxSeconds * 1000) {
        stopRecording();
        return;
      }
    }, AUDIO_RECORDING_TIMER_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [recordingLocked, recordingStartedAt, stopRecording, widgetState]);

  useEffect(() => {
    if (widgetState === "ready" && pushToTalkDownRef.current) {
      startRecording();
    }
  }, [startRecording, widgetState]);

  const applyPushToTalkPayload = useCallback((payload) => {
    if (payload?.phase === "aborted") {
      // An OS combo key landed while the record key was held (Fn+arrow and
      // friends): discard the gesture quietly, never save it.
      hybridDownAtRef.current = 0;
      hybridLastTapAtRef.current = 0;
      clearHybridPendingDiscard();
      recordingLockedRef.current = false;
      setRecordingLocked(false);

      const widgetStateValue = widgetStateRef.current;
      if (
        pushToTalkDownRef.current
        || widgetStateValue === "arming"
        || widgetStateValue === "recording"
      ) {
        cancelRecordingRef.current?.({ salvage: false });
      }
      return;
    }

    if (payload?.pressed || payload?.phase === "pressed") {
      handleRecorderShortcutPressed();
      return;
    }

    handleRecorderShortcutReleased();
  }, [clearHybridPendingDiscard, handleRecorderShortcutPressed, handleRecorderShortcutReleased]);

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

      if (recorderModeRef.current === AUDIO_RECORDER_MODE_HYBRID) {
        if (hybridDownAtRef.current) {
          handleHybridShortcutReleased();
        }
        return;
      }

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
  }, [handleHybridShortcutReleased, releasePushToTalk]);

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
        // Parity with the focused-widget Escape path: the consumed key still
        // clears the partially-dictated text from the target terminal's
        // composer before the take is cancelled.
        forwardEscapeToActiveTerminal({
          action: "cancel_audio_and_forward_terminal",
          source: "global_cancel_shortcut",
        });
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
  }, [cancelRecording, forwardEscapeToActiveTerminal]);

  // Bare-key cancel shortcuts (plain Escape by default) are only registered
  // globally while a take is active: tell Rust when the widget enters and
  // leaves an active phase so ESC cancels even when another app or a
  // terminal pane has keyboard focus.
  const cancelScopeActive = ["arming", "processing", "recording", "transcribing"].includes(widgetState);
  useEffect(() => {
    invoke("audio_cancel_shortcut_scope", { active: cancelScopeActive }).catch(() => {});
    if (!cancelScopeActive) {
      return undefined;
    }
    return () => {
      invoke("audio_cancel_shortcut_scope", { active: false }).catch(() => {});
    };
  }, [cancelScopeActive]);

  const isCloudWidget = transcriptionProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD;
  const isForgeWidget = transcriptionProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE;
  const isForgeVoiceWidget = transcriptionProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT;
  const installed = isCloudWidget
    ? Boolean(deepgramApiKey.trim())
    : (isForgeWidget || isForgeVoiceWidget)
      ? true
      : Boolean(modelStatus?.installed);
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const widgetLevel = Math.round(clampAudioLevel(Math.max((widgetAudioStats.rms || 0) * 2100, (widgetAudioStats.peak || 0) * 120)));
  const compactLabel = error
    || message
    || (installed ? "Audio recorder ready" : "Audio recorder setup needed");
  // finishPending flips the visual to the loading phase the moment the user
  // finishes speaking, even while the run is still arming or draining audio.
  const isProcessingFocus = widgetState === "transcribing"
    || (finishPending && (widgetState === "arming" || widgetState === "recording"));
  const isRecordingFocus = widgetState === "recording" && !isProcessingFocus;
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
    : `${recordingLocked ? "Recording locked" : "Recording audio"} ${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;
  const widgetLabel = isFocusedWidget && !isClosingFocus ? expandedLabel : compactLabel;
  const showWidgetCancelButton = (isRecordingFocus || isProcessingFocus) && !isClosingFocus;

  // One cancel-notice surface for both widget styles: X to dismiss now, copy,
  // undo (paste into target), open history, and the drain-to-zero auto-close.
  const cancelNoticeSurface = cancelNotice ? (
    <AudioBarSurface
      data-paused={cancelNoticePaused ? "true" : undefined}
      onMouseEnter={() => setCancelNoticePaused(true)}
      onMouseLeave={() => setCancelNoticePaused(false)}
      role="status"
    >
      <AudioBarCancelButton
        aria-label="Dismiss"
        onClick={dismissCancelNotice}
        title="Dismiss now"
        type="button"
      >
        ×
      </AudioBarCancelButton>
      <AudioBarStatusText style={{ flex: 1 }}>Transcript cancelled</AudioBarStatusText>
      <AudioBarCopyButton
        aria-label="Copy transcript"
        onClick={copyCancelledTranscript}
        title="Copy the cancelled transcript"
        type="button"
      >
        <svg
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.3"
          viewBox="0 0 16 16"
        >
          <rect height="8.2" rx="1.5" width="8.2" x="5.6" y="5.6" />
          <path d="M10.6 3H4.4A1.7 1.7 0 0 0 2.7 4.7V11" />
        </svg>
      </AudioBarCopyButton>
      <AudioBarUndoButton
        onClick={undoCancelledTranscript}
        title="Undo the cancel: paste the transcript into the focused app"
        type="button"
      >
        Undo
      </AudioBarUndoButton>
      <AudioBarHistoryButton
        onClick={openDictationHistory}
        title="Open dictation history in the Activity widget"
        type="button"
      >
        History
      </AudioBarHistoryButton>
      <AudioBarNoticeProgress
        aria-hidden="true"
        key={cancelNotice.id}
        onAnimationEnd={dismissCancelNotice}
      />
    </AudioBarSurface>
  ) : null;

  if (widgetStyle === AUDIO_WIDGET_STYLE_BAR) {
    if (!barVisible) {
      const dictateShortcutLabel = formatShortcutLabel(widgetPushToTalkShortcut);
      return (
        <>
          <GlobalStyle />
          <AudioBarIdleShell aria-label="Dictation bar" data-theme={audioWidgetTheme}>
            <AudioBarIdleReveal>
              <AudioBarRecordButton
                aria-label={`Start dictation (${dictateShortcutLabel})`}
                onClick={toggleTalk}
                title={`Start dictation (${dictateShortcutLabel})`}
                type="button"
              />
              <AudioBarShortcutHint aria-hidden="true">
                {dictateShortcutLabel}
              </AudioBarShortcutHint>
            </AudioBarIdleReveal>
            <AudioBarIdleLine aria-hidden="true" />
          </AudioBarIdleShell>
        </>
      );
    }

    return (
      <>
        <GlobalStyle />
        <AudioBarShell
          aria-label={widgetLabel}
          data-theme={audioWidgetTheme}
          data-visible={barVisible ? "true" : "false"}
        >
          {cancelNotice ? cancelNoticeSurface : (
            <AudioBarSurface
              onClick={isRecordingFocus || widgetState === "arming" ? finishFromBar : undefined}
              role="status"
              style={isRecordingFocus || widgetState === "arming" ? { cursor: "pointer" } : undefined}
              title={isRecordingFocus || widgetState === "arming"
                ? "Click to finish and paste, or press the shortcut again. X cancels."
                : undefined}
            >
              <AudioBarCancelButton
                aria-label="Cancel dictation"
                onClick={(event) => {
                  event.stopPropagation();
                  cancelRecording();
                }}
                title="Cancel: stop without pasting. The transcript is still saved to History."
                type="button"
              >
                ×
              </AudioBarCancelButton>
              {widgetState === "error" ? (
                <AudioBarStatusText title={error || message}>
                  {error || message || "Audio error"}
                </AudioBarStatusText>
              ) : (
                <AudioBarMeter aria-hidden="true">
                  {Array.from({ length: AUDIO_BAR_METER_BARS }, (_, index) => (
                    <span
                      key={index}
                      style={buildWidgetMeterBarStyle(index, widgetLevel, isProcessingFocus, AUDIO_BAR_METER_BARS)}
                    />
                  ))}
                </AudioBarMeter>
              )}
              {isProcessingFocus ? (
                <AudioBarSpinner aria-label="Transcribing" role="status" />
              ) : (isRecordingFocus || widgetState === "arming") && (
                <AudioBarStopButton
                  aria-label="Finish and paste"
                  onClick={(event) => {
                    event.stopPropagation();
                    finishFromBar();
                  }}
                  title="Finish recording and paste the transcript"
                  type="button"
                />
              )}
            </AudioBarSurface>
          )}
        </AudioBarShell>
      </>
    );
  }

  // Bubble style: the cancel notice replaces the bubble while it shows (the
  // window has already morphed to the pill size; dismissal morphs it back).
  if (bubbleCancelNoticeActive && cancelNoticeSurface) {
    return (
      <>
        <GlobalStyle />
        <AudioBarShell
          aria-label="Transcript cancelled"
          data-theme={audioWidgetTheme}
          data-visible="true"
        >
          {cancelNoticeSurface}
        </AudioBarShell>
      </>
    );
  }

  return (
    <>
      <GlobalStyle />
      {errorFrameActive && (
        <AudioWidgetErrorPopover data-theme={audioWidgetTheme} role="alert" title={error}>
          {error}
        </AudioWidgetErrorPopover>
      )}
      <AudioWidgetShell
        aria-label={widgetLabel}
        data-tauri-drag-region
        data-closing={isClosingFocus ? "true" : undefined}
        data-concealed={widgetStyle === AUDIO_WIDGET_STYLE_HIDDEN && !widgetActive ? "true" : undefined}
        data-error-frame={errorFrameActive ? "true" : undefined}
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
        {isRecordingFocus && recordingLocked && (
          <AudioWidgetLockBadge aria-hidden="true">Live</AudioWidgetLockBadge>
        )}
        {showWidgetCancelButton && (
          <AudioWidgetCancelButton
            aria-label="Cancel and save transcript to history"
            onClick={(event) => {
              event.stopPropagation();
              cancelRecording();
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            title="Cancel (transcript is saved to history)"
            type="button"
          >
            ×
          </AudioWidgetCancelButton>
        )}
      </AudioWidgetShell>
    </>
  );
}

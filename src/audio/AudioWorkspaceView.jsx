import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { availableMonitors, currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

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
  AUDIO_TRANSCRIPTION_VARIANT_CLEANED,
  AUDIO_TRANSCRIPTION_VARIANT_POLISHED,
  AUDIO_TRANSCRIPTION_VARIANT_RAW,
  AUDIO_LLM_CLEANUP_ENGINE_OPTIONS,
  AUDIO_LLM_CLEANUP_ENGINE_OPENAI_GPT_5_NANO,
  AUDIO_WIDGET_STYLE_BAR,
  AUDIO_WIDGET_STYLE_BUBBLE,
  AUDIO_WIDGET_STYLE_HIDDEN,
  AUDIO_WIDGET_THEME_DARK,
  AUDIO_WIDGET_THEME_LIGHT,
  AUDIO_WIDGET_THEME_STORAGE_KEY,
  AUDIO_PREFERENCES_CHANGED_EVENT,
  DEFAULT_AUDIO_POLISHING_SYSTEM_PROMPT,
  MAX_AUDIO_POLISHING_SYSTEM_PROMPT_CHARS,
  applySyncedAudioPolishingPreferences,
  audioLlmCleanupEngineOption,
  audioInputPermissionNeedsAttention,
  clearAudioInputSetupReady,
  formatAudioPercent,
  getAudioInputErrorMessage,
  getAudioInputPermissionStatus,
  hasAudioInputSetup,
  listAudioInputDevices,
  markAudioInputSetupReady,
  normalizeAudioWidgetTheme,
  openAudioInputPermissions,
  prepareWhisperModel,
  publishAudioTranscriptionResult,
  readAudioManualPolishingEnabled,
  readAudioLlmCleanupEngine,
  readAudioLlmCleanupRequestOptions,
  readAudioPolishingPreferences,
  readAudioPolishingSystemPrompt,
  readAudioRecorderMode,
  readAudioWidgetStyle,
  readAutomaticCleanupPolishingPrompt,
  readManualPolishingPrompt,
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
  writeAudioLlmCleanupEngine,
  readSelectedAudioInputDeviceId,
  cancelLocalWhisperPartialTranscription,
  startLowPowerAudioBuffer,
  startLocalWhisperPartialTranscription,
  stopLocalWhisperPartialTranscription,
  normalizeAudioPolishingSystemPrompt,
  writeAudioPolishingSystemPrompt,
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
  AUDIO_HISTORY_APPENDED_EVENT,
  AUDIO_HISTORY_CHANGED_EVENT,
  audioHistoryFetchPage,
  audioHistoryFetchSummary,
  migrateLocalAudioHistoryToBackend,
} from "./audioHistoryStore";
import {
  cloudVoiceAgentEventKind,
  createCloudVoiceAgentTtsPlayer,
  finishCloudVoiceAgentInput,
  prewarmCloudVoiceAgentStream,
  startCloudVoiceAgentStream,
  stopCloudVoiceAgentStream,
  subscribeCloudVoiceAgentEvents,
} from "./cloudVoiceAgentClient.js";
import { applyVoiceTextPipeline, parseDictionaryTerms } from "./voicePipeline.js";
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
  AudioLocalModelList,
  AudioLocalModelRow,
  AudioLocalModelCopy,
  AudioLocalModelMeta,
  AudioLocalModelPill,
  AudioLocalModelActions,
  AudioGeneralToolbar,
  AudioGeneralColumn,
  AudioProviderPanel,
  AudioRecorderPanel,
  AudioRecorderActions,
  AudioDevicePanel,
  AudioDeviceHeader,
  AudioCloudField,
  AudioCloudInput,
  AudioInputHeaderControls,
  AudioInputMeter,
  AudioInputMeta,
  AudioInputMicButton,
  AudioInputMuteButton,
  AudioInputPill,
  AudioInputPillIconButton,
  AudioRecorderOptionRow,
  AudioShortcutGrid,
  AudioShortcutCard,
  AudioShortcutKey,
  AudioShortcutActions,
  AudioTabBar,
  AudioTabList,
  AudioTabButton,
  AudioTabPanel,
  AudioDictionaryPanel,
  AudioDictionaryWordDeleteButton,
  AudioDictionaryWordEmpty,
  AudioDictionaryWordList,
  AudioDictionaryWordRow,
  AudioDictionaryWordText,
  AudioDictionaryList,
  AudioDictionaryMetaPill,
  AudioDictionaryEmpty,
  AudioRuleTextarea,
  AudioRuleToggle,
  AudioRuleIconButton,
  AudioRulePanelHeader,
  AudioRulePanelTitle,
  AudioRuleListItem,
  AudioRuleListText,
  AudioRuleListTitle,
  AudioRuleListMeta,
  AudioRuleListActions,
  AudioRuleEditorPanel,
  AudioRuleEditorHeader,
  AudioRuleEditorTitle,
  AudioRuleEditorBody,
  AudioRuleFieldLabel,
  AudioRuleFieldCaption,
  AudioRuleStatusLine,
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
  AudioHistoryVariantButton,
  AudioHistoryVariantControl,
  AudioHistoryVariantLabel,
  AudioHistoryMeta,
  AudioHistorySnippetChangeBadge,
  AudioHistorySnippetChangeRow,
  AudioHistorySnippetChangeText,
  AudioHistorySnippetChanges,
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
  AudioWidgetErrorOverlayCard,
  AudioWidgetErrorOverlayShell,
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
  AudioBarRecordCluster,
  AudioBarShortcutHint,
  AudioBarHistoryActions,
  AudioWidgetFocusStage,
  AudioWidgetLogo,
  AudioWidgetMeter,
  AudioWidgetLoader,
  AudioWidgetHistoryTray,
  AudioHistoryQuickButton,
  AudioPolishQuickSpinner,
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
  ButtonBackIcon,
  ButtonForwardIcon,
  ButtonMicIcon,
  ButtonMicOffIcon,
  ButtonHubIcon,
  ButtonCheckIcon,
  ButtonPolishIcon,
  FileChevronIcon,
  FileExpandIcon,
  FileFolderTreeIcon,
  FileDocumentIcon
} from "../app/appStyles";
import AppSelect from "../app/AppSelect.jsx";
import { playNotificationSfx } from "../notifications/notificationSfx";

export const AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT = "forge-audio-model-download-progress";
export const AUDIO_WIDGET_HASH = "#/audio-widget";
export const AUDIO_WIDGET_ERROR_HASH = "#/audio-widget-error";
export const AUDIO_WIDGET_VISIBILITY_CHANGED_EVENT = "forge-audio-widget-visibility-changed";
export const AUDIO_HOTKEY_ATTENTION_EVENT = "forge-audio-hotkey-attention";
const AUDIO_WIDGET_ERROR_OVERLAY_EVENT = "forge-audio-widget-error-overlay";
const AUDIO_WIDGET_ERROR_OVERLAY_STORAGE_KEY = "diffforge.audio.widgetErrorOverlay.v1";
const AUDIO_PUSH_TO_TALK_EVENT = "forge-audio-push-to-talk";
const AUDIO_CANCEL_EVENT = "forge-audio-cancel";
const AUDIO_FORGE_DICTATION_RAW_RESULT_EVENT = "forge-audio-dictation-raw-result";
const AUDIO_FORGE_DICTATION_CLEANED_RESULT_EVENT = "forge-audio-dictation-cleaned-result";
const AUDIO_WIDGET_VOICE_OWNER = "audio-widget-voice-agent";
const AUDIO_WIDGET_BAR_HOVER_CHANGED_EVENT = "forge-audio-widget-bar-hover-changed";
const AUDIO_WIDGET_BUBBLE_HOVER_CHANGED_EVENT = "forge-audio-widget-bubble-hover-changed";
const FLOATING_SURFACE_LAYOUT_CHANGED_EVENT = "forge-floating-layout-changed";
const CLOUD_MCP_SYNC_STATUS_EVENT = "cloud-mcp-sync-status";
const AUDIO_WIDGET_BUBBLE_PLACEMENT_STORAGE_KEY = "diffforge.audio.widgetBubblePlacement.v1";
const AUDIO_SHORTCUTS_CHANGED_EVENT = "forge-audio-shortcuts-changed";
const AUDIO_SETTINGS_CHANGED_EVENT = "forge-audio-settings-changed";
const AUDIO_REALTIME_TRANSCRIPT_EVENT = "forge-audio-realtime-transcript";
// App-wide live dictation mirror: the Activity widget renders the incoming
// stream (phase + interim text) from these broadcasts while a take is live.
const AUDIO_DICTATION_STREAM_EVENT = "forge-audio-dictation-stream";
const AUDIO_RECORDING_MAX_SECONDS = 150;
const AUDIO_RECORDING_LOCKED_MAX_SECONDS = 900;
const AUDIO_RECORDING_TIMER_MS = 250;
const AUDIO_HYBRID_TAP_MAX_MS = 280;
const AUDIO_HYBRID_DOUBLE_TAP_MS = 360;
const AUDIO_CANCEL_SALVAGE_MIN_AUDIO_MS = 600;
const DEEPGRAM_RELEASE_POST_BUFFER_MS = 500;
const AUDIO_HOTKEY_ATTENTION_HIGHLIGHT_MS = 4200;
const AUDIO_HOTKEY_ATTENTION_TARGETS = new Set(["permissions", "recorder", "input", "microphone"]);
// Forge cloud dictation streams audio continuously through the native
// worker, so only a short tail is needed to flush in-flight chunks before
// the finish frame; this keeps release-to-transcript latency low.
const FORGE_RELEASE_POST_BUFFER_MS = 350;
// Last successful billing snapshot, module-wide: provider switches and
// remounts render the known state instantly (stale-while-revalidate) instead
// of flashing startup text while the network refresh runs.
let lastKnownForgeBilling = null;
const AUDIO_WIDGET_PREROLL_READY_MS = 500;
// Matches the 18-column track inside the input-source capsule meter.
const AUDIO_INPUT_METER_BARS = 18;
const AUDIO_WIDGET_METER_BARS = 26;
const AUDIO_WIDGET_COMPACT_SIZE = { width: 64, height: 64 };
const AUDIO_WIDGET_FOCUS_SIZE = { width: 292, height: 64 };
const AUDIO_WIDGET_HISTORY_TRAY_SIZE = { width: 64, height: 98 };
const AUDIO_WIDGET_HISTORY_TRAY_EXIT_ANIMATION_MS = 210;
const AUDIO_WIDGET_BUBBLE_DRAG_DEBUG_SAMPLE_MS = 160;
const AUDIO_WIDGET_BUBBLE_DRAG_SETTLE_SAMPLE_MS = 90;
const AUDIO_WIDGET_BUBBLE_DRAG_SETTLE_STABLE_SAMPLES = 3;
const AUDIO_WIDGET_BUBBLE_DRAG_SETTLE_MAX_MS = 1400;
const AUDIO_WIDGET_BUBBLE_VISIBLE_MARGIN = 8;
const SHOW_OWN_KEY_DEEPGRAM_PROVIDER = false;
// Recording: a slim Wispr-style pill bottom-center (X to cancel + waveform +
// stop/spinner on the right), hovering just above the Dock/taskbar edge.
const AUDIO_WIDGET_BAR_SIZE = { width: 124, height: 44 };
// The cancel notice needs room for its label plus close/copy/undo/history
// controls, so the pill widens while it is showing. The bubble style reuses
// the same pill (the window morphs to it in place, then morphs back).
const AUDIO_WIDGET_BAR_NOTICE_SIZE = { width: 392, height: 52 };
const AUDIO_WIDGET_BAR_BOTTOM_MARGIN = 6;
// Idle: keep the native hover target close to the visible line. It grows to
// the reveal size only after the pointer is actually on that collapsed line.
const AUDIO_WIDGET_BAR_IDLE_SIZE = { width: 84, height: 18 };
const AUDIO_WIDGET_BAR_IDLE_HOVER_SIZE = { width: 200, height: 96 };
const AUDIO_WIDGET_BAR_IDLE_BOTTOM_MARGIN = 0;
const AUDIO_WIDGET_BAR_ANCHOR_ANIMATION_MS = 180;
const AUDIO_WIDGET_BAR_ANCHOR_RECHECK_MS = 700;
const AUDIO_WIDGET_CLOUD_STATUS_POLL_MS = 5000;
// Hover transitions arrive instantly via AUDIO_WIDGET_*_HOVER_CHANGED_EVENT; this
// poll is only a reconciliation fallback, so it can idle slowly (was 140ms ~7Hz).
const AUDIO_WIDGET_BAR_HOVER_IDLE_RECHECK_MS = 600;
const AUDIO_WIDGET_BAR_HOVER_ACTIVE_RECHECK_MS = 80;
const AUDIO_WIDGET_BAR_IDLE_ACTIVATE_HIT_HEIGHT = 18;
const AUDIO_WIDGET_BAR_IDLE_ACTIVE_HIT_TOP = 0;
const AUDIO_WIDGET_ERROR_OVERLAY_SIZE = { width: 432, height: 64 };
const AUDIO_WIDGET_ERROR_OVERLAY_GAP = 6;
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
  { id: "snippets", label: "Snippets" },
  { id: "transforms", label: "Transforms" },
  { id: "polishing", label: "Polishing" },
  { id: "history", label: "History" },
];
const VOICE_RULE_TAB_IDS = new Set(["dictionary", "snippets", "transforms"]);
const AUDIO_WIDGET_THEME_META_COLORS = {
  [AUDIO_WIDGET_THEME_DARK]: "#030508",
  [AUDIO_WIDGET_THEME_LIGHT]: "#f5f5f7",
};
const AUDIO_WIDGET_LOOPSPACE_THEME_META_COLORS = {
  [AUDIO_WIDGET_THEME_DARK]: "#120b02",
  [AUDIO_WIDGET_THEME_LIGHT]: "#fff8ea",
};
const FORGE_SPACE_MODE_STORAGE_KEY = "diffforge.app.spaceMode";
const FORGE_SPACE_MODE_LOOPSPACES = "loopspaces";
const FORGE_SPACE_MODE_WORKSPACES = "workspaces";
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

function normalizeAudioHotkeyAttentionTargets(payload) {
  const rawTargets = Array.isArray(payload?.targets)
    ? payload.targets
    : [payload?.target || payload?.reason || "input"];
  const targets = rawTargets
    .map((target) => String(target || "").trim().toLowerCase())
    .filter((target) => AUDIO_HOTKEY_ATTENTION_TARGETS.has(target));
  return targets.length ? Array.from(new Set(targets)) : ["input"];
}

function emitAudioHotkeyAttention(reason, targets, message = "") {
  emit(AUDIO_HOTKEY_ATTENTION_EVENT, {
    id: Date.now(),
    reason,
    targets: Array.isArray(targets) ? targets : [targets],
    message,
  }).catch(() => {});
}

const audioHotkeyAttentionPulse = keyframes`
  0% { opacity: 0; }
  8% { opacity: 1; }
  42% { opacity: 0.66; }
  62% { opacity: 1; }
  100% { opacity: 0; }
`;

const AudioInputSourcePanel = styled(AudioDevicePanel)`
  position: relative;
  align-self: start;
  overflow: visible;
`;

const AudioShortcutSettingsPanel = styled(AudioDevicePanel)`
  position: relative;
  overflow: visible;
`;

const AudioRecorderAttentionPanel = styled(AudioRecorderPanel)`
  position: relative;
  overflow: visible;
`;

const AudioAttentionFlash = styled.span`
  position: absolute;
  inset: 0;
  z-index: 3;
  pointer-events: none;
  border: 2px solid rgba(250, 204, 21, 0.98);
  border-radius: inherit;
  box-shadow:
    0 0 15px 4px rgba(250, 204, 21, 0.62),
    0 0 38px 10px rgba(250, 204, 21, 0.34),
    inset 0 0 20px rgba(250, 204, 21, 0.26);
  opacity: 0;
  animation: ${audioHotkeyAttentionPulse} 2s ease-in-out infinite;

  html[data-forge-theme="light"] & {
    border-color: rgba(202, 138, 4, 0.92);
    box-shadow:
      0 0 15px 4px rgba(202, 138, 4, 0.42),
      0 0 34px 9px rgba(202, 138, 4, 0.24),
      inset 0 0 18px rgba(202, 138, 4, 0.16);
  }
`;

const AudioButtonAttentionFlash = styled(AudioAttentionFlash)`
  inset: -4px;
  border-radius: 10px;
`;

const AudioInputInitializeButton = styled(AudioInputMuteButton)`
  position: relative;
  display: inline-flex;
  width: auto;
  min-width: 92px;
  height: 28px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  overflow: visible;
  font-size: 11px;
  font-weight: 780;
  line-height: 1;
  white-space: nowrap;

  > span {
    line-height: 1;
  }
`;

const AudioDictionaryNameSearchRow = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(220px, 1fr) minmax(180px, 0.58fr);
  align-items: end;
  gap: 10px;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const AudioDictionaryWordListFrame = styled.div`
  position: relative;
  min-width: 0;
`;

const AudioDictionaryWordComposerRow = styled(AudioDictionaryWordRow)`
  min-height: 38px;
`;

const AudioDictionaryWordInput = styled.input`
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  font: 12px/var(--audio-word-text-line-height) "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
  letter-spacing: 0;
  outline: none;

  &::placeholder {
    color: var(--forge-text-muted);
    opacity: 0.88;
  }
`;

const AudioDictionaryBottomJumpButton = styled.button`
  position: absolute;
  right: 50%;
  bottom: 10px;
  z-index: 4;
  display: grid;
  width: 34px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 1px solid var(--audio-border-strong, rgba(125, 160, 205, 0.28));
  border-radius: 999px;
  color: var(--audio-accent-text, #d9e7ff);
  background: var(--audio-control-bg, rgba(11, 15, 21, 0.88));
  box-shadow:
    0 8px 22px rgba(0, 0, 0, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  cursor: pointer;
  transform: translateX(50%);
  transition:
    background 140ms ease,
    border-color 140ms ease,
    color 140ms ease,
    transform 140ms ease;

  &:hover {
    border-color: rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.46);
    color: #ffffff;
    background: rgba(var(--audio-accent-rgb, var(--forge-tint-rgb)), 0.22);
    transform: translateX(50%) translateY(-1px);
  }

  &:focus-visible {
    outline: 2px solid rgba(var(--audio-accent-soft-rgb, var(--forge-tint-soft-rgb)), 0.58);
    outline-offset: 2px;
  }

  html[data-forge-theme="light"] & {
    color: #0056b3;
    background: rgba(255, 255, 255, 0.94);
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.12);
  }

  html[data-forge-theme="light"] &:hover {
    color: #003f82;
    background: rgba(0, 102, 204, 0.1);
  }
`;

function getAudioWidgetBarGeometry(cancelNoticeActive, barVisible, barIdleHover) {
  if (cancelNoticeActive) {
    return {
      key: "notice",
      margin: AUDIO_WIDGET_BAR_BOTTOM_MARGIN,
      size: AUDIO_WIDGET_BAR_NOTICE_SIZE,
    };
  }

  if (barVisible) {
    return {
      key: "active",
      margin: AUDIO_WIDGET_BAR_BOTTOM_MARGIN,
      size: AUDIO_WIDGET_BAR_SIZE,
    };
  }

  return {
    key: barIdleHover ? "idle-hover" : "idle",
    margin: AUDIO_WIDGET_BAR_IDLE_BOTTOM_MARGIN,
    size: barIdleHover ? AUDIO_WIDGET_BAR_IDLE_HOVER_SIZE : AUDIO_WIDGET_BAR_IDLE_SIZE,
  };
}

// Transcripts longer than this get the 3-line clamp + "Show more" toggle.
const AUDIO_HISTORY_CLAMP_THRESHOLD_CHARS = 220;
const AUDIO_HISTORY_ESTIMATED_ROW_HEIGHT = 140;
const AUDIO_HISTORY_ROW_GAP = 8;
const AUDIO_HISTORY_VIRTUAL_OVERSCAN_ROWS = 4;
const AUDIO_HISTORY_VIEWPORT_FALLBACK_HEIGHT = 420;
// Slightly longer than the row enter animation (260ms in appStyles) so the
// `data-entering` flag is cleared only after the fade-in has finished, and a
// row scrolled out and back in does not replay the animation.
const AUDIO_HISTORY_ROW_ENTER_CLEAR_MS = 420;
// Pagination: the History tab pulls only the visible window from the backend in
// fixed-size pages, so the IPC payload stays tiny no matter how large the store
// grows. The virtual layout maps scroll position with a uniform row stride
// (O(1)) and uses measured heights only to stack rows within the window, which
// scales to hundreds of thousands of rows.
const AUDIO_HISTORY_PAGE_SIZE = 60;
const AUDIO_HISTORY_ROW_STRIDE = AUDIO_HISTORY_ESTIMATED_ROW_HEIGHT + AUDIO_HISTORY_ROW_GAP;
const AUDIO_HISTORY_MAX_CACHED_PAGES = 16;

function isMacPlatform() {
  return typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");
}

function isWindowsPlatform() {
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform || "");
}

function forgeCloudStatusIsConnected(status) {
  if (!status || typeof status !== "object") {
    return false;
  }

  const connection = String(status.connection || "").trim().toLowerCase();
  if (connection === "connected") {
    return true;
  }

  return Boolean(status.connected && (status.globalWsConnected ?? status.global_ws_connected));
}

function audioWidgetBubblePositionPoint(value) {
  if (!value) {
    return null;
  }

  const x = Number(value.x);
  const y = Number(value.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x: Math.round(x), y: Math.round(y) };
}

function audioWidgetBubblePositionSize(value) {
  if (!value) {
    return null;
  }

  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  return { width: Math.round(width), height: Math.round(height) };
}

function audioWidgetBubblePositionRect(value) {
  if (!value) {
    return null;
  }

  return {
    position: audioWidgetBubblePositionPoint(value.position),
    size: audioWidgetBubblePositionSize(value.size),
  };
}

function audioWidgetBubblePositionMonitorPayload(monitor) {
  if (!monitor) {
    return null;
  }

  return {
    name: monitor.name || "",
    position: audioWidgetBubblePositionPoint(monitor.position),
    scaleFactor: Number(monitor.scaleFactor || 1) || 1,
    size: audioWidgetBubblePositionSize(monitor.size),
    workArea: audioWidgetBubblePositionRect(monitor.workArea),
  };
}

function logAudioWidgetBubblePosition(phase, fields = {}) {
  invoke("audio_widget_log_bubble_position", {
    request: {
      fields,
      phase,
    },
  }).catch(() => {});
}

async function logAudioWidgetBubbleWindowSnapshot(windowHandle, phase, fields = {}) {
  const [position, size, monitor] = await Promise.all([
    windowHandle?.outerPosition?.().catch(() => null),
    windowHandle?.outerSize?.().catch(() => null),
    currentMonitor().catch(() => null),
  ]);

  logAudioWidgetBubblePosition(phase, {
    ...fields,
    monitor: audioWidgetBubblePositionMonitorPayload(monitor),
    nativePosition: audioWidgetBubblePositionPoint(position),
    nativeSize: audioWidgetBubblePositionSize(size),
  });
}

function normalizeAudioWidgetBubblePlacement(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

function normalizeAudioWidgetErrorOverlayPayload(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const message = String(value.message || "").trim();
  if (!message) {
    return null;
  }

  return {
    id: String(value.id || `${Date.now()}`),
    message,
    theme: normalizeAudioWidgetTheme(value.theme),
    visible: value.visible !== false,
  };
}

function readAudioWidgetErrorOverlayPayload() {
  if (typeof window === "undefined" || !window.localStorage) {
    return null;
  }

  try {
    return normalizeAudioWidgetErrorOverlayPayload(JSON.parse(
      window.localStorage.getItem(AUDIO_WIDGET_ERROR_OVERLAY_STORAGE_KEY) || "null",
    ));
  } catch {
    return null;
  }
}

function writeAudioWidgetErrorOverlayPayload(payload) {
  if (typeof window === "undefined" || !window.localStorage) {
    return;
  }

  try {
    if (!payload) {
      window.localStorage.removeItem(AUDIO_WIDGET_ERROR_OVERLAY_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(AUDIO_WIDGET_ERROR_OVERLAY_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Best effort only; the Tauri event still carries the live payload.
  }
}

function publishAudioWidgetErrorOverlay(payload) {
  writeAudioWidgetErrorOverlayPayload(payload);
  emit(AUDIO_WIDGET_ERROR_OVERLAY_EVENT, payload || { visible: false }).catch(() => {});
}

function audioWidgetBubblePhysicalSizeFromLogical(size, scale = 1) {
  const width = Number(size?.width);
  const height = Number(size?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }

  const normalizedScale = Number(scale || 1) || 1;
  return {
    width: Math.max(1, Math.round(width * normalizedScale)),
    height: Math.max(1, Math.round(height * normalizedScale)),
  };
}

function audioWidgetBubbleMonitorArea(monitor) {
  if (!monitor) {
    return null;
  }

  const area = monitor.workArea?.size?.width && monitor.workArea?.size?.height
    ? monitor.workArea
    : { position: monitor.position, size: monitor.size };
  const position = audioWidgetBubblePositionPoint(area?.position);
  const size = audioWidgetBubblePositionSize(area?.size);
  if (!position || !size) {
    return null;
  }

  return { position, size };
}

function clampAudioWidgetBubblePlacementToMonitor(
  position,
  monitor,
  size,
  fallbackLogicalSize = AUDIO_WIDGET_COMPACT_SIZE,
) {
  const normalized = normalizeAudioWidgetBubblePlacement(position);
  const area = audioWidgetBubbleMonitorArea(monitor);
  if (!normalized || !area) {
    return normalized;
  }

  const scale = Number(monitor?.scaleFactor || 1) || 1;
  const physicalSize = audioWidgetBubblePositionSize(size)
    || audioWidgetBubblePhysicalSizeFromLogical(fallbackLogicalSize, scale)
    || audioWidgetBubblePhysicalSizeFromLogical(AUDIO_WIDGET_COMPACT_SIZE, scale);
  if (!physicalSize) {
    return normalized;
  }

  const margin = Math.max(0, Math.round(AUDIO_WIDGET_BUBBLE_VISIBLE_MARGIN * scale));
  const minX = area.position.x + margin;
  const minY = area.position.y + margin;
  const maxX = area.position.x + area.size.width - physicalSize.width - margin;
  const maxY = area.position.y + area.size.height - physicalSize.height - margin;
  const fallbackX = area.position.x + Math.max(0, Math.round((area.size.width - physicalSize.width) / 2));
  const fallbackY = area.position.y + Math.max(0, Math.round((area.size.height - physicalSize.height) / 2));

  return {
    x: Math.round(maxX < minX ? fallbackX : Math.min(Math.max(normalized.x, minX), maxX)),
    y: Math.round(maxY < minY ? fallbackY : Math.min(Math.max(normalized.y, minY), maxY)),
  };
}

function audioWidgetBubblePlacementChanged(first, second) {
  const left = normalizeAudioWidgetBubblePlacement(first);
  const right = normalizeAudioWidgetBubblePlacement(second);
  return Boolean(left && right && (left.x !== right.x || left.y !== right.y));
}

function audioWidgetBubbleMonitorDistance(position, monitor) {
  const normalized = normalizeAudioWidgetBubblePlacement(position);
  const area = audioWidgetBubbleMonitorArea(monitor);
  if (!normalized || !area) {
    return Number.POSITIVE_INFINITY;
  }

  const maxX = area.position.x + area.size.width;
  const maxY = area.position.y + area.size.height;
  const dx = normalized.x < area.position.x
    ? area.position.x - normalized.x
    : Math.max(0, normalized.x - maxX);
  const dy = normalized.y < area.position.y
    ? area.position.y - normalized.y
    : Math.max(0, normalized.y - maxY);
  return Math.hypot(dx, dy);
}

async function resolveAudioWidgetBubbleClampMonitor(position) {
  const monitor = await currentMonitor().catch(() => null);
  if (monitor) {
    return monitor;
  }

  const monitors = await availableMonitors().catch(() => []);
  if (!Array.isArray(monitors) || monitors.length === 0) {
    return null;
  }

  const normalized = normalizeAudioWidgetBubblePlacement(position);
  if (!normalized) {
    return monitors[0];
  }

  return monitors.reduce((best, candidate) => (
    audioWidgetBubbleMonitorDistance(normalized, candidate)
      < audioWidgetBubbleMonitorDistance(normalized, best)
      ? candidate
      : best
  ), monitors[0]);
}

function readAudioWidgetBubblePlacement() {
  if (typeof window === "undefined" || !window.localStorage) {
    logAudioWidgetBubblePosition("audio.widget.bubble.placement.read.unavailable", {});
    return null;
  }

  try {
    const raw = window.localStorage.getItem(AUDIO_WIDGET_BUBBLE_PLACEMENT_STORAGE_KEY) || "null";
    const normalized = normalizeAudioWidgetBubblePlacement(JSON.parse(raw));
    logAudioWidgetBubblePosition("audio.widget.bubble.placement.read", {
      hasValue: raw !== "null",
      placement: normalized,
    });
    return normalized;
  } catch (error) {
    logAudioWidgetBubblePosition("audio.widget.bubble.placement.read.error", {
      error: String(error?.message || error || "Unable to read bubble placement"),
    });
    return null;
  }
}

function writeAudioWidgetBubblePlacement(position) {
  const normalized = normalizeAudioWidgetBubblePlacement(position);
  if (!normalized || typeof window === "undefined" || !window.localStorage) {
    logAudioWidgetBubblePosition("audio.widget.bubble.placement.write.skipped", {
      input: audioWidgetBubblePositionPoint(position),
      storageAvailable: Boolean(typeof window !== "undefined" && window.localStorage),
    });
    return null;
  }

  try {
    window.localStorage.setItem(AUDIO_WIDGET_BUBBLE_PLACEMENT_STORAGE_KEY, JSON.stringify(normalized));
    logAudioWidgetBubblePosition("audio.widget.bubble.placement.write", {
      placement: normalized,
    });
  } catch (error) {
    logAudioWidgetBubblePosition("audio.widget.bubble.placement.write.error", {
      error: String(error?.message || error || "Unable to write bubble placement"),
      placement: normalized,
    });
    // Placement persistence is best-effort.
  }

  return normalized;
}

function audioBarIdlePointerEventIsHovering(event, active) {
  const viewportHeight = Number(window.innerHeight || AUDIO_WIDGET_BAR_IDLE_SIZE.height);
  const viewportWidth = Number(window.innerWidth || AUDIO_WIDGET_BAR_IDLE_SIZE.width);
  const x = Number(event?.clientX ?? -1);
  const y = Number(event?.clientY ?? -1);

  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || x < 0
    || y < 0
    || x > viewportWidth
    || y > viewportHeight
  ) {
    return false;
  }

  if (active) {
    return y >= AUDIO_WIDGET_BAR_IDLE_ACTIVE_HIT_TOP;
  }

  return y >= Math.max(0, viewportHeight - AUDIO_WIDGET_BAR_IDLE_ACTIVATE_HIT_HEIGHT);
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

function audioInputErrorRequiresFreshWarmBuffer(error) {
  const message = getErrorMessage(error, "").toLowerCase();
  return message.includes("audio input engine timed out")
    || message.includes("native audio worker")
    || message.includes("audio input buffering was canceled");
}

function releaseAudioWidgetKeyboardFocus() {
  invoke("audio_widget_release_keyboard_focus").catch(() => {});
}

function formatDictionaryTermsDraftText(terms) {
  const value = Array.isArray(terms) ? terms.join("\n") : String(terms ?? "");
  return parseDictionaryTerms(value).join("\n");
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
  const loopspaceActive = readAudioWidgetSpaceMode() === FORGE_SPACE_MODE_LOOPSPACES;
  let barHueBase = processing ? 192 : 198;
  let barHueRange = processing ? 46 : 66;
  if (loopspaceActive) {
    barHueBase = processing ? 34 : 38;
    barHueRange = processing ? 22 : 28;
  }
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
    "--bar-hue": `${barHueBase + ((index * (processing ? 9 : 13)) % barHueRange)}`,
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
  textarea.style.userSelect = "text";
  textarea.style.webkitUserSelect = "text";
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
  const normalizedSpaceMode = readAudioWidgetSpaceMode();
  document.documentElement.dataset.forgeTheme = normalizedTheme;
  document.documentElement.dataset.forgeSpace = normalizedSpaceMode;
  document.documentElement.dataset.audioWidgetTheme = normalizedTheme;
  if (document.body) {
    document.body.dataset.forgeTheme = normalizedTheme;
    document.body.dataset.forgeSpace = normalizedSpaceMode;
    document.body.dataset.audioWidgetTheme = normalizedTheme;
  }

  const themeColors = normalizedSpaceMode === FORGE_SPACE_MODE_LOOPSPACES
    ? AUDIO_WIDGET_LOOPSPACE_THEME_META_COLORS
    : AUDIO_WIDGET_THEME_META_COLORS;
  const themeColor = themeColors[normalizedTheme] || themeColors[AUDIO_WIDGET_THEME_DARK];
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", themeColor);

  return normalizedTheme;
}

function normalizeAudioWidgetSpaceMode(value) {
  return String(value || "").trim().toLowerCase() === FORGE_SPACE_MODE_LOOPSPACES
    ? FORGE_SPACE_MODE_LOOPSPACES
    : FORGE_SPACE_MODE_WORKSPACES;
}

function readAudioWidgetSpaceMode() {
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage.getItem(FORGE_SPACE_MODE_STORAGE_KEY);
      if (stored) {
        return normalizeAudioWidgetSpaceMode(stored);
      }
    } catch {
      // The widget can still inherit from the document dataset.
    }
  }
  if (typeof document !== "undefined") {
    return normalizeAudioWidgetSpaceMode(document.documentElement.dataset.forgeSpace);
  }
  return FORGE_SPACE_MODE_WORKSPACES;
}

function applyAudioWidgetSpacePreference(spaceMode = readAudioWidgetSpaceMode()) {
  if (typeof document === "undefined") {
    return normalizeAudioWidgetSpaceMode(spaceMode);
  }
  const normalizedSpaceMode = normalizeAudioWidgetSpaceMode(spaceMode);
  document.documentElement.dataset.forgeSpace = normalizedSpaceMode;
  if (document.body) {
    document.body.dataset.forgeSpace = normalizedSpaceMode;
  }
  return normalizedSpaceMode;
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

function normalizeShortcutModifierForCancel(token) {
  const compact = normalizeShortcutTokenForCompare(token);

  if (compact === "option") return "alt";
  if (compact === "ctrl") return "control";
  if (compact === "command" || compact === "cmd" || compact === "meta") return "super";
  if (compact === "commandorcontrol" || compact === "commandorctrl" || compact === "cmdorcontrol" || compact === "cmdorctrl") {
    return isMacPlatform() ? "super" : "control";
  }

  if (compact === "alt" || compact === "control" || compact === "shift" || compact === "super") {
    return compact;
  }

  return "";
}

function shortcutModifierSetForCancel(shortcut) {
  const modifiers = new Set();
  String(shortcut || "")
    .split("+")
    .forEach((token) => {
      const modifier = normalizeShortcutModifierForCancel(token);
      if (modifier) {
        modifiers.add(modifier);
      }
    });
  return modifiers;
}

function eventModifierSetForCancel(event) {
  const modifiers = new Set();
  if (event.ctrlKey) modifiers.add("control");
  if (event.altKey) modifiers.add("alt");
  if (event.shiftKey) modifiers.add("shift");
  if (event.metaKey) modifiers.add("super");
  return modifiers;
}

function shortcutIsBareEscape(shortcut) {
  const normalized = normalizeShortcutForCompare(shortcut);
  return normalized === "escape" || normalized === "esc";
}

function keyboardEventIsEscape(event) {
  const code = normalizeShortcutTokenForCompare(normalizeKeyboardShortcutCode(event.code || event.key || ""));
  const key = normalizeShortcutTokenForCompare(event.key || "");
  return code === "escape" || code === "esc" || key === "escape" || key === "esc";
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

function cancelShortcutMatchesEvent(shortcut, event, pushToTalkShortcut, pushToTalkDown) {
  if (shortcutMatchesEvent(shortcut, event)) {
    return true;
  }

  if (!pushToTalkDown || !shortcutIsBareEscape(shortcut) || !keyboardEventIsEscape(event)) {
    return false;
  }

  const eventModifiers = eventModifierSetForCancel(event);
  if (!eventModifiers.size) {
    return true;
  }

  const pushToTalkModifiers = shortcutModifierSetForCancel(pushToTalkShortcut);
  if (!pushToTalkModifiers.size) {
    return false;
  }

  return [...eventModifiers].every((modifier) => pushToTalkModifiers.has(modifier));
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

function countAudioHistoryCharacters(text) {
  return Array.from(String(text || "")).length;
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

function normalizeHistoryTimingMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function readHistoryTimingMs(value, keys) {
  if (!value || typeof value !== "object") {
    return 0;
  }

  return keys
    .map((key) => normalizeHistoryTimingMs(value[key]))
    .find((duration) => duration > 0) || 0;
}

function normalizeAudioHistoryTimings(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const timings = value.timings && typeof value.timings === "object" ? value.timings : {};
  const sttMs = readHistoryTimingMs(value, ["sttMs", "stt_ms", "finishToRawMs", "finish_to_raw_ms"])
    || readHistoryTimingMs(timings, ["sttMs", "stt_ms", "finishToRawMs", "finish_to_raw_ms"]);
  const cleanupMs = readHistoryTimingMs(value, ["cleanupMs", "cleanup_ms"])
    || readHistoryTimingMs(timings, ["cleanupMs", "cleanup_ms"]);
  const llmMs = readHistoryTimingMs(value, ["llmMs", "llm_ms"])
    || readHistoryTimingMs(timings, ["llmMs", "llm_ms"])
    || cleanupMs;
  const totalMs = readHistoryTimingMs(value, ["totalMs", "total_ms"])
    || readHistoryTimingMs(timings, ["totalMs", "total_ms"])
    || (sttMs || llmMs ? sttMs + llmMs : 0);

  const result = {};
  if (sttMs > 0) result.sttMs = sttMs;
  if (llmMs > 0) result.llmMs = llmMs;
  if (totalMs > 0) result.totalMs = totalMs;
  if (cleanupMs > 0) result.cleanupMs = cleanupMs;
  return Object.keys(result).length ? result : null;
}

function mergeAudioHistoryTimings(primary, fallback) {
  if (!primary && !fallback) {
    return null;
  }

  return {
    ...(fallback || {}),
    ...(primary || {}),
  };
}

function formatAudioHistoryTimingBreakdown(timings) {
  if (!timings) {
    return "";
  }

  const stt = timings.sttMs > 0 ? formatHistoryDuration(timings.sttMs) : "--";
  const llm = timings.llmMs > 0 ? formatHistoryDuration(timings.llmMs) : "--";
  const total = timings.totalMs > 0 ? formatHistoryDuration(timings.totalMs) : "--";
  return `STT Time ${stt} / LLM Time ${llm} / Total Time ${total}`;
}

function cleanAudioHistoryPolishMetadata(value, { allowLabel = true } = {}) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const provider = String(value.provider || value.cleanupProvider || value.cleanup_provider || "").trim();
  const model = String(value.model || value.cleanupModel || value.cleanup_model || "").trim();
  const engine = String(value.engine || value.cleanupEngine || value.cleanup_engine || "").trim();
  const label = String((allowLabel ? value.label : "") || value.modelLabel || value.polishLabel || "").trim();
  const polishedAt = String(value.polishedAt || value.updatedAt || "").trim();
  const timings = normalizeAudioHistoryTimings(value);
  const result = {};
  if (provider) result.provider = provider;
  if (model) result.model = model;
  if (engine) result.engine = engine;
  if (label) result.label = label;
  if (polishedAt) result.polishedAt = polishedAt;
  if (timings) result.timings = timings;
  return Object.keys(result).length ? result : null;
}

function formatAudioCleanupModelLabel(provider, model, fallback = "") {
  const normalizedProvider = String(provider || "").trim().toLowerCase();
  const normalizedModel = String(model || "").trim().toLowerCase();
  const option = AUDIO_LLM_CLEANUP_ENGINE_OPTIONS.find((candidate) => (
    candidate.provider === normalizedProvider
    && candidate.model.toLowerCase() === normalizedModel
  )) || AUDIO_LLM_CLEANUP_ENGINE_OPTIONS.find((candidate) => (
    candidate.model.toLowerCase() === normalizedModel
  ));

  if (option?.label) {
    return option.label;
  }

  if (model) {
    return String(model)
      .replace(/-/g, " ")
      .replace(/\bgpt\b/i, "GPT")
      .replace(/\bllama\b/i, "Llama")
      .replace(/\bnano\b/i, "nano")
      .trim();
  }

  return fallback;
}

function legacyAudioPolishModelLabel() {
  return audioLlmCleanupEngineOption(AUDIO_LLM_CLEANUP_ENGINE_OPENAI_GPT_5_NANO).label;
}

function audioHistoryVariantModelLabel(variant) {
  const polish = cleanAudioHistoryPolishMetadata(variant?.polish);
  if (polish?.label) {
    return polish.label;
  }

  const label = formatAudioCleanupModelLabel(polish?.provider, polish?.model);
  if (label) {
    return label;
  }

  return variant?.id === AUDIO_TRANSCRIPTION_VARIANT_POLISHED ? legacyAudioPolishModelLabel() : "";
}

function audioHistoryVariantDisplayLabel(variant) {
  const label = audioHistoryVariantLabel(variant?.id, String(variant?.label || "").trim());
  const modelLabel = audioHistoryVariantModelLabel(variant);
  if (
    modelLabel
    && (
      variant?.id === AUDIO_TRANSCRIPTION_VARIANT_CLEANED
      || variant?.id === AUDIO_TRANSCRIPTION_VARIANT_POLISHED
    )
  ) {
    return `${label} · ${modelLabel}`;
  }
  return label;
}

function audioHistoryTimingBreakdown(entry, variant) {
  const entryTimings = normalizeAudioHistoryTimings(entry?.timings)
    || normalizeAudioHistoryTimings(entry);
  const polish = cleanAudioHistoryPolishMetadata(variant?.polish);
  const variantTimings = normalizeAudioHistoryTimings(polish?.timings)
    || normalizeAudioHistoryTimings(polish)
    || normalizeAudioHistoryTimings(variant);
  const hasLlmTiming = Boolean(
    polish
    || entry?.llmCleaned
    || entry?.llm_cleaned
    || entry?.cleanupProvider
    || entry?.cleanupModel,
  );

  if (!hasLlmTiming) {
    return null;
  }

  return mergeAudioHistoryTimings(variantTimings, entryTimings);
}

const LOCAL_WHISPER_MODEL_FALLBACKS = [
  {
    modelId: "tiny.en",
    modelName: "Whisper tiny.en",
    approximateDiskMb: 74,
    approximateMemoryMb: 260,
    bytes: 0,
    description: "Lowest footprint",
    installed: false,
    selected: false,
    tier: "Fastest",
  },
  {
    modelId: "base.en",
    modelName: "Whisper base.en",
    approximateDiskMb: 142,
    approximateMemoryMb: 500,
    bytes: 0,
    description: "Current default",
    installed: false,
    selected: true,
    tier: "Balanced",
  },
  {
    modelId: "small.en",
    modelName: "Whisper small.en",
    approximateDiskMb: 465,
    approximateMemoryMb: 1100,
    bytes: 0,
    description: "Larger local model",
    installed: false,
    selected: false,
    tier: "Higher accuracy",
  },
];

function formatWhisperModelTitle(model) {
  return String(model?.modelName || model?.modelId || "Whisper").replace(/^Whisper\s+/i, "");
}

function formatWhisperModelMeta(model) {
  const diskMb = Number(model?.approximateDiskMb || 0);
  const memoryMb = Number(model?.approximateMemoryMb || 0);
  const parts = [];
  if (model?.tier) {
    parts.push(model.tier);
  }
  if (diskMb > 0) {
    parts.push(`${formatInteger(diskMb)} MB`);
  }
  if (memoryMb > 0) {
    parts.push(`${formatInteger(memoryMb)} MB RAM`);
  }
  return parts.join(" / ");
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

function formatAudioHistoryMeta(entry, variant, entryText) {
  const pieces = [];
  const source = String(entry?.source || "").trim();
  const timingBreakdown = formatAudioHistoryTimingBreakdown(
    audioHistoryTimingBreakdown(entry, variant),
  );
  // Fallback for older entries: turnaround since releasing the record button
  // to transcript landing, or audio length if that was all the entry stored.
  const duration = timingBreakdown || formatHistoryDuration(
    Number(entry?.latencyMs || 0) > 0 ? entry.latencyMs : entry?.audioMs,
  );
  const wordCount = Number(entry?.wordCount || 0);
  const characterCount = countAudioHistoryCharacters(entryText);
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
  if (characterCount > 0) {
    pieces.push(`${formatInteger(characterCount)} ${characterCount === 1 ? "char" : "chars"}`);
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

// Rounded population benchmarks for sustained dictation pace (conversational
// speech sits around 110-150 WPM); first matching tier wins, below the ladder
// no badge shows.
const AUDIO_WPM_PERCENTILE_TIERS = [
  { label: "Top 0.01%", minWpm: 205 },
  { label: "Top 0.1%", minWpm: 185 },
  { label: "Top 1%", minWpm: 165 },
  { label: "Top 10%", minWpm: 145 },
  { label: "Top 20%", minWpm: 125 },
];

function audioWpmPercentileLabel(wpm) {
  const value = Number(wpm) || 0;
  const tier = AUDIO_WPM_PERCENTILE_TIERS.find((entry) => value >= entry.minWpm);
  return tier ? tier.label : "";
}

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

function isAudioHistoryClampable(entryText) {
  const text = String(entryText || "");
  if (text.length > AUDIO_HISTORY_CLAMP_THRESHOLD_CHARS) {
    return true;
  }

  let lineBreaks = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lineBreaks += 1;
      if (lineBreaks >= 3) {
        return true;
      }
    }
  }

  return false;
}

function audioHistorySnippetChanges(entry) {
  const changes = Array.isArray(entry?.snippetChanges)
    ? entry.snippetChanges
    : Array.isArray(entry?.changes?.snippets)
      ? entry.changes.snippets
      : [];

  return changes
    .map((change) => {
      const original = String(change?.original || change?.trigger || "").trim();
      const replacement = String(change?.replacement || "").trim();
      const trigger = String(change?.trigger || original).trim();

      if (!original || !replacement) {
        return null;
      }

      return { original, replacement, trigger };
    })
    .filter(Boolean);
}

function audioHistoryEntryDisplayText(entry, snippetChanges) {
  const sourceText = String(entry?.sourceText || "").trim();
  if (snippetChanges.length && sourceText) {
    return sourceText;
  }

  return String(entry?.text || "");
}

function audioHistoryVariantLabel(id, fallback = "") {
  if (fallback) {
    return fallback;
  }
  if (id === AUDIO_TRANSCRIPTION_VARIANT_RAW) {
    return "Raw";
  }
  if (id === AUDIO_TRANSCRIPTION_VARIANT_POLISHED) {
    return "Polished";
  }
  return "Cleaned";
}

function audioHistoryVariants(entry) {
  const variants = Array.isArray(entry?.variants) ? entry.variants : [];
  return variants
    .map((variant) => {
      const id = String(variant?.id || "").trim();
      const text = String(variant?.text || "").trim();
      if (!id || !text) {
        return null;
      }
      const polish = cleanAudioHistoryPolishMetadata(variant?.polish)
        || cleanAudioHistoryPolishMetadata(variant, { allowLabel: false });
      return {
        id,
        label: audioHistoryVariantLabel(id, String(variant?.label || "").trim()),
        text,
        ...(polish ? { polish } : {}),
      };
    })
    .filter(Boolean);
}

function audioHistorySelectedVariant(entry, variants, entryKey, selectedVariantIds) {
  if (!variants.length) {
    return null;
  }

  const selectedId = selectedVariantIds?.get?.(entryKey)
    || String(entry?.defaultVariantId || "").trim()
    || variants[variants.length - 1]?.id;
  return variants.find((variant) => variant.id === selectedId) || variants[variants.length - 1];
}

function buildAudioHistoryRows(history, selectedVariantIds) {
  return (Array.isArray(history) ? history : []).map((entry, index) => {
    const entryKey = getAudioHistoryEntryKey(entry, index);
    const variants = audioHistoryVariants(entry);
    const variant = audioHistorySelectedVariant(entry, variants, entryKey, selectedVariantIds);
    const isRawVariant = variant?.id === AUDIO_TRANSCRIPTION_VARIANT_RAW;
    const snippetChanges = isRawVariant ? [] : audioHistorySnippetChanges(entry);
    const entryText = variant?.text || audioHistoryEntryDisplayText(entry, snippetChanges);
    const variantIndex = variant ? variants.findIndex((candidate) => candidate.id === variant.id) : -1;
    return {
      clampable: isAudioHistoryClampable(entryText),
      entry,
      entryKey,
      entryText,
      index,
      meta: formatAudioHistoryMeta(entry, variant, entryText),
      providerLabel: formatAudioProviderLabel(entry?.provider),
      snippetChanges,
      timestamp: formatHistoryTimestamp(entry?.createdAt),
      variant,
      variantIndex,
      variants,
    };
  });
}

function audioHistoryEntryPolishText(entry) {
  const text = String(entry?.text || "").trim();
  if (text) {
    return text;
  }
  const variants = audioHistoryVariants(entry);
  const preferred = variants.find((variant) => variant.id === AUDIO_TRANSCRIPTION_VARIANT_CLEANED)
    || variants.find((variant) => variant.id === AUDIO_TRANSCRIPTION_VARIANT_RAW)
    || variants[0];
  return String(preferred?.text || "").trim();
}

function buildAudioPolishMetadata(result = {}, overrides = {}) {
  const timingSource = {
    ...(result || {}),
    ...(overrides || {}),
    timings: {
      ...((result && typeof result.timings === "object" && result.timings) || {}),
      ...((overrides && typeof overrides.timings === "object" && overrides.timings) || {}),
    },
  };
  const provider = String(
    result?.provider
    || result?.cleanupProvider
    || result?.cleanup_provider
    || overrides?.provider
    || overrides?.cleanupProvider
    || "",
  ).trim();
  const model = String(
    result?.model
    || result?.cleanupModel
    || result?.cleanup_model
    || overrides?.model
    || overrides?.cleanupModel
    || "",
  ).trim();
  const engine = String(
    result?.engine
    || result?.cleanupEngine
    || result?.cleanup_engine
    || overrides?.engine
    || overrides?.cleanupEngine
    || "",
  ).trim();
  const timings = normalizeAudioHistoryTimings(timingSource);
  const label = formatAudioCleanupModelLabel(provider, model);
  const metadata = {};

  if (provider) metadata.provider = provider;
  if (model) metadata.model = model;
  if (engine) metadata.engine = engine;
  if (label) metadata.label = label;
  if (timings) metadata.timings = timings;
  metadata.polishedAt = new Date().toISOString();

  return cleanAudioHistoryPolishMetadata(metadata);
}

function buildPolishedAudioHistoryVariants(entry, sourceText, polishedText, polishMetadata = null) {
  const nextVariants = [];
  const seen = new Set();
  const pushVariant = (variant) => {
    const id = String(variant?.id || "").trim();
    const text = String(variant?.text || "").trim();
    if (!id || !text || seen.has(id)) {
      return;
    }
    seen.add(id);
    const polish = cleanAudioHistoryPolishMetadata(variant?.polish)
      || cleanAudioHistoryPolishMetadata(variant, { allowLabel: false });
    nextVariants.push({
      id,
      label: audioHistoryVariantLabel(id, String(variant?.label || "").trim()),
      text,
      ...(polish ? { polish } : {}),
    });
  };

  audioHistoryVariants(entry)
    .filter((variant) => variant.id !== AUDIO_TRANSCRIPTION_VARIANT_POLISHED)
    .forEach(pushVariant);

  if (!seen.has(AUDIO_TRANSCRIPTION_VARIANT_RAW)) {
    pushVariant({
      id: AUDIO_TRANSCRIPTION_VARIANT_RAW,
      label: "Original",
      text: sourceText,
    });
  }

  pushVariant({
    id: AUDIO_TRANSCRIPTION_VARIANT_POLISHED,
    label: "Polished",
    polish: polishMetadata,
    text: polishedText,
  });

  return nextVariants;
}

function findAudioHistoryEntryForPolish(history, sourceText) {
  const needle = String(sourceText || "").trim();
  if (!needle) {
    return null;
  }

  return (Array.isArray(history) ? history : []).find((entry) => {
    const candidates = [
      entry?.text,
      entry?.sourceText,
      entry?.rawText,
      ...audioHistoryVariants(entry).map((variant) => variant.text),
    ];
    return candidates.some((candidate) => String(candidate || "").trim() === needle);
  }) || null;
}

function buildAudioHistoryModel(history, selectedVariantIds) {
  return {
    insights: buildAudioHistoryInsights(history),
    rows: buildAudioHistoryRows(history, selectedVariantIds),
  };
}

function estimateAudioHistoryRowHeight(row) {
  const text = String(row?.entryText || "");
  const hardBreaks = text.split("\n").length;
  const wrappedLines = Math.ceil(text.length / 92);
  const visibleTextLines = row?.clampable
    ? Math.min(3, Math.max(1, hardBreaks, wrappedLines))
    : Math.max(1, Math.min(6, hardBreaks, wrappedLines));
  const snippetRows = Array.isArray(row?.snippetChanges) ? row.snippetChanges.length : 0;
  const variantControlAllowance = Array.isArray(row?.variants) && row.variants.length > 1 ? 8 : 0;
  const meta = String(row?.meta || "");
  const metaLines = Math.max(1, Math.min(3, Math.ceil(meta.length / 74)));

  return Math.max(
    AUDIO_HISTORY_ESTIMATED_ROW_HEIGHT,
    62 + (visibleTextLines * 19) + (metaLines * 15) + (snippetRows * 28) + variantControlAllowance,
  );
}

function seedAudioHistoryEstimatedRowHeights(rows, rowHeights) {
  if (!Array.isArray(rows) || !rowHeights) {
    return false;
  }

  let changed = false;
  rows.forEach((row) => {
    if (!row?.entryKey || rowHeights.has(row.entryKey)) {
      return;
    }
    rowHeights.set(row.entryKey, estimateAudioHistoryRowHeight(row));
    changed = true;
  });
  return changed;
}

function scheduleAudioHistoryIdleTask(callback, { delayMs = 0, timeout = 900 } = {}) {
  if (typeof window === "undefined") {
    callback();
    return () => {};
  }

  let cancelled = false;
  let frame = 0;
  let idle = 0;
  let timer = 0;

  const run = () => {
    if (!cancelled) {
      callback();
    }
  };

  const scheduleIdle = () => {
    if (cancelled) {
      return;
    }
    if (typeof window.requestIdleCallback === "function") {
      idle = window.requestIdleCallback(run, { timeout });
      return;
    }
    timer = window.setTimeout(run, delayMs);
  };

  if (typeof window.requestAnimationFrame === "function") {
    frame = window.requestAnimationFrame(scheduleIdle);
  } else {
    timer = window.setTimeout(scheduleIdle, delayMs);
  }

  return () => {
    cancelled = true;
    if (frame && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(frame);
    }
    if (idle && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idle);
    }
    if (timer) {
      window.clearTimeout(timer);
    }
  };
}

function formatLocalDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const EMPTY_AUDIO_HISTORY_INSIGHTS = {
  audioMs: 0,
  averageWpm: 0,
  totalDictations: 0,
  totalWords: 0,
  weeks: [],
};

// Insights come from SQL aggregates (totals + a words-per-day map for the
// heatmap window), so the frontend never scans the full history to render the
// stat chips and grid. The heatmap grid itself is cheap to build from the map.
function buildAudioHistoryInsightsFromSummary(summary) {
  const safe = summary && typeof summary === "object" ? summary : {};
  const wordsByDay = safe.wordsByDay && typeof safe.wordsByDay === "object" ? safe.wordsByDay : {};

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - start.getDay() - (AUDIO_HEATMAP_WEEKS - 1) * 7);

  let maxDayWords = 0;
  Object.values(wordsByDay).forEach((value) => {
    maxDayWords = Math.max(maxDayWords, Number(value) || 0);
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
      const key = formatLocalDateKey(day);
      const words = Number(wordsByDay[key]) || 0;
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
    audioMs: Math.max(0, Number(safe.audioMs) || 0),
    averageWpm: Math.max(0, Number(safe.averageWpm) || 0),
    totalDictations: Math.max(0, Number(safe.totalDictations) || 0),
    totalWords: Math.max(0, Number(safe.totalWords) || 0),
    weeks,
  };
}

// Builds the visible window for the paginated list. Scroll position maps to a
// row index via a uniform stride (O(1)); loaded entries render as rows (stacked
// by their measured height for accuracy within the window) and not-yet-loaded
// indices render as skeletons until their page arrives.
function buildAudioHistoryPaginatedWindow(total, viewport, getEntry, rowHeights, variantIds) {
  const safeTotal = Math.max(0, Number(total) || 0);
  if (safeTotal === 0) {
    return { items: [], totalHeight: 0, startIndex: 0, endIndex: 0 };
  }

  const totalHeight = Math.max(1, safeTotal * AUDIO_HISTORY_ROW_STRIDE - AUDIO_HISTORY_ROW_GAP);
  const viewportHeight = Math.max(
    1,
    Number(viewport?.height || AUDIO_HISTORY_VIEWPORT_FALLBACK_HEIGHT),
  );
  const scrollTop = Math.max(0, Number(viewport?.scrollTop || 0));
  const overscanRows = AUDIO_HISTORY_VIRTUAL_OVERSCAN_ROWS;
  const firstVisible = Math.floor(scrollTop / AUDIO_HISTORY_ROW_STRIDE);
  const visibleRows = Math.ceil(viewportHeight / AUDIO_HISTORY_ROW_STRIDE);
  const startIndex = Math.max(0, firstVisible - overscanRows);
  const endIndex = Math.min(safeTotal, firstVisible + visibleRows + overscanRows + 1);

  const items = [];
  let top = startIndex * AUDIO_HISTORY_ROW_STRIDE;
  for (let index = startIndex; index < endIndex; index += 1) {
    const entry = typeof getEntry === "function" ? getEntry(index) : null;
    const row = entry ? buildAudioHistoryRows([entry], variantIds)[0] : null;
    if (row) {
      row.index = index;
      const measured = Number(rowHeights?.get?.(row.entryKey) || 0);
      const height = measured > 0 ? measured : estimateAudioHistoryRowHeight(row);
      items.push({ kind: "row", key: row.entryKey, row, top });
      top += height + AUDIO_HISTORY_ROW_GAP;
    } else {
      items.push({ kind: "placeholder", key: `audio-history-skeleton-${index}`, index, top });
      top += AUDIO_HISTORY_ROW_STRIDE;
    }
  }

  return { items, totalHeight, startIndex, endIndex };
}

function buildAudioHistoryVirtualWindow(rows, viewport, rowHeights) {
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) {
    return { items: [], totalHeight: 0 };
  }

  const viewportHeight = Math.max(
    1,
    Number(viewport?.height || AUDIO_HISTORY_VIEWPORT_FALLBACK_HEIGHT),
  );
  const scrollTop = Math.max(0, Number(viewport?.scrollTop || 0));
  const overscanPx = AUDIO_HISTORY_ESTIMATED_ROW_HEIGHT * AUDIO_HISTORY_VIRTUAL_OVERSCAN_ROWS;
  const startBoundary = Math.max(0, scrollTop - overscanPx);
  const endBoundary = scrollTop + viewportHeight + overscanPx;
  const offsets = [];
  const heights = [];
  let totalHeight = 0;

  items.forEach((row, index) => {
    const measuredHeight = Number(rowHeights?.get?.(row.entryKey) || 0);
    const height = measuredHeight > 0 ? measuredHeight : AUDIO_HISTORY_ESTIMATED_ROW_HEIGHT;
    offsets[index] = totalHeight;
    heights[index] = height;
    totalHeight += height + (index === items.length - 1 ? 0 : AUDIO_HISTORY_ROW_GAP);
  });

  let startIndex = 0;
  while (
    startIndex < items.length - 1
    && offsets[startIndex] + heights[startIndex] < startBoundary
  ) {
    startIndex += 1;
  }

  let endIndex = startIndex;
  while (endIndex < items.length && offsets[endIndex] <= endBoundary) {
    endIndex += 1;
  }

  if (endIndex <= startIndex) {
    endIndex = Math.min(items.length, startIndex + 1);
  }

  return {
    items: items.slice(startIndex, endIndex).map((row, sliceIndex) => {
      const index = startIndex + sliceIndex;
      return {
        row,
        top: offsets[index],
      };
    }),
    totalHeight,
  };
}

function AudioHistoryVirtualRow({
  copied,
  entering,
  expanded,
  onCopy,
  onMeasure,
  onToggle,
  onVariantStep,
  row,
  top,
  totalCount,
}) {
  const rowRef = useRef(null);

  useEffect(() => {
    const node = rowRef.current;
    if (!node) {
      return undefined;
    }

    let frame = 0;
    let observer = null;
    const measure = () => {
      const commitMeasure = () => {
        frame = 0;
        onMeasure(row.entryKey, node.getBoundingClientRect().height);
      };

      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        if (frame) {
          window.cancelAnimationFrame(frame);
        }
        frame = window.requestAnimationFrame(commitMeasure);
      } else {
        commitMeasure();
      }
    };

    measure();

    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(measure);
      observer.observe(node);
    } else if (typeof window !== "undefined") {
      window.addEventListener("resize", measure);
    }

    return () => {
      if (frame && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frame);
      }
      observer?.disconnect?.();
      if (typeof ResizeObserver === "undefined" && typeof window !== "undefined") {
        window.removeEventListener("resize", measure);
      }
    };
  }, [expanded, onMeasure, row.entryKey, row.entryText, row.snippetChanges, row.variant?.id]);

  return (
    <AudioHistoryRow
      aria-posinset={row.index + 1}
      aria-setsize={totalCount}
      data-entering={entering ? "true" : undefined}
      data-expanded={expanded ? "true" : "false"}
      ref={rowRef}
      role="listitem"
      style={{
        left: 0,
        position: "absolute",
        right: 0,
        top: 0,
        transform: `translateY(${top}px)`,
      }}
    >
      <AudioHistoryRowTopline>
        <span>{row.timestamp}</span>
        <AudioHistoryRowActions>
          {row.variants.length > 1 && (
            <AudioHistoryVariantControl aria-label="Compare transcript versions">
              <AudioHistoryVariantButton
                aria-label="Show previous transcript version"
                onClick={() => onVariantStep(row, -1)}
                title="Show previous transcript version"
                type="button"
              >
                <ButtonBackIcon aria-hidden="true" />
              </AudioHistoryVariantButton>
              <AudioHistoryVariantLabel title={audioHistoryVariantDisplayLabel(row.variant)}>
                {audioHistoryVariantDisplayLabel(row.variant) || "Version"}
              </AudioHistoryVariantLabel>
              <AudioHistoryVariantButton
                aria-label="Show next transcript version"
                onClick={() => onVariantStep(row, 1)}
                title="Show next transcript version"
                type="button"
              >
                <ButtonForwardIcon aria-hidden="true" />
              </AudioHistoryVariantButton>
            </AudioHistoryVariantControl>
          )}
          {row.entry.status === AUDIO_TRANSCRIPTION_STATUS_CANCELLED && (
            <AudioHistoryStatusBadge>Cancelled</AudioHistoryStatusBadge>
          )}
          <AudioHistoryProvider data-provider={row.entry.provider}>
            {row.providerLabel}
          </AudioHistoryProvider>
          <AudioHistoryCopyButton
            aria-label="Copy previous prompt"
            data-copied={copied ? "true" : undefined}
            onClick={() => onCopy(row.entry, row.index, row.variant)}
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
      <strong>{row.entryText}</strong>
      {row.snippetChanges.length > 0 && (
        <AudioHistorySnippetChanges aria-label="Snippet replacements">
          {row.snippetChanges.map((change, index) => (
            <AudioHistorySnippetChangeRow
              key={`${change.trigger}-${index}`}
              title={`${change.original} to ${change.replacement}`}
            >
              <AudioHistorySnippetChangeBadge>Snippet</AudioHistorySnippetChangeBadge>
              <AudioHistorySnippetChangeText>
                <span>{change.original}</span>
                <small>to</small>
                <span>{change.replacement}</span>
              </AudioHistorySnippetChangeText>
            </AudioHistorySnippetChangeRow>
          ))}
        </AudioHistorySnippetChanges>
      )}
      <AudioHistoryRowFootline>
        <AudioHistoryMeta>{row.meta}</AudioHistoryMeta>
        {row.clampable && (
          <AudioHistoryExpandButton
            aria-expanded={expanded}
            onClick={() => onToggle(row.entryKey)}
            type="button"
          >
            {expanded ? "Show less" : "Show more"}
          </AudioHistoryExpandButton>
        )}
      </AudioHistoryRowFootline>
    </AudioHistoryRow>
  );
}

export default function AudioWorkspaceView({
  audioActionState,
  audioDownloadProgress,
  audioError,
  audioHotkeyAttention = null,
  audioModelStatus,
  audioStatusState,
  audioWidgetVisible,
  authState = "signedOut",
  billingStatus = null,
  billingStatusError = "",
  billingStatusState = "idle",
  onDownloadModel,
  onCloseWidget,
  onOpenWidget,
  onRefreshBillingStatus,
  onRefreshStatus,
  onSelectModel,
  onUninstallModel,
  workspace,
}) {
  const [isUninstallModalOpen, setUninstallModalOpen] = useState(false);
  const [activeAudioTab, setActiveAudioTab] = useState("general");
  const [audioInputDevices, setAudioInputDevices] = useState([]);
  const [audioInputDeviceId, setAudioInputDeviceId] = useState(readSelectedAudioInputDeviceId);
  const [audioInputState, setAudioInputState] = useState("checking");
  const [audioInputPermissionStatus, setAudioInputPermissionStatus] = useState(null);
  const [audioInputPermissionActionState, setAudioInputPermissionActionState] = useState("idle");
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
  const [expandedAudioHistoryIds, setExpandedAudioHistoryIds] = useState(() => new Set());
  const [audioHistoryVariantIds, setAudioHistoryVariantIds] = useState(() => new Map());
  // Paginated, SQLite-backed history: hold only the loaded window of entries
  // (keyed by absolute index) plus the total count and SQL-derived insights,
  // never the full list.
  const [audioHistoryTotal, setAudioHistoryTotal] = useState(0);
  const [audioHistoryReady, setAudioHistoryReady] = useState(false);
  const [audioHistoryInsights, setAudioHistoryInsights] = useState(EMPTY_AUDIO_HISTORY_INSIGHTS);
  const [audioHistoryCacheVersion, setAudioHistoryCacheVersion] = useState(0);
  const audioHistoryEntriesRef = useRef(new Map());
  const audioHistoryInflightPagesRef = useRef(new Set());
  const [copiedAudioHistoryId, setCopiedAudioHistoryId] = useState("");
  const [voiceRules, setVoiceRules] = useState(peekVoiceTextRules);
  const [forgeLlmCleanup, setForgeLlmCleanup] = useState(readForgeLlmCleanup);
  const [llmCleanupEngine, setLlmCleanupEngine] = useState(readAudioLlmCleanupEngine);
  const manualPolishingEnabled = readAudioManualPolishingEnabled();
  const [polishingSystemPrompt, setPolishingSystemPrompt] = useState(readAudioPolishingSystemPrompt);
  const defaultPolishingSystemPrompt = useMemo(
    () => normalizeAudioPolishingSystemPrompt(DEFAULT_AUDIO_POLISHING_SYSTEM_PROMPT),
    [],
  );
  const polishingSystemPromptIsDefault = polishingSystemPrompt === defaultPolishingSystemPrompt;
  const [audioWidgetStyleSetting, setAudioWidgetStyleSetting] = useState(readAudioWidgetStyle);
  const [voiceRulesError, setVoiceRulesError] = useState("");
  const [voiceRuleEditor, setVoiceRuleEditor] = useState(null);
  const [voiceRuleSaveState, setVoiceRuleSaveState] = useState("idle");
  const [dictionaryWordListNeedsBottomJump, setDictionaryWordListNeedsBottomJump] = useState(false);
  const voiceRulesSaveTimerRef = useRef(0);
  const [audioShortcutStatus, setAudioShortcutStatus] = useState(() => audioModelStatus?.shortcuts || fallbackShortcutStatus());
  const [audioShortcutError, setAudioShortcutError] = useState("");
  const [audioShortcutActionState, setAudioShortcutActionState] = useState("idle");
  const [capturingAudioShortcut, setCapturingAudioShortcut] = useState("");
  const [audioHotkeyHighlight, setAudioHotkeyHighlight] = useState({ id: 0, targets: [] });
  const audioInputPreviewRef = useRef(null);
  const audioInputRunRef = useRef(0);
  const audioInputLoadRunRef = useRef(0);
  const audioInputLoadPromiseRef = useRef(null);
  const audioInputDeviceIdRef = useRef(audioInputDeviceId);
  const audioInputStateRef = useRef(audioInputState);
  const audioInputSourcePanelRef = useRef(null);
  const audioRecorderPanelRef = useRef(null);
  const audioShortcutSettingsPanelRef = useRef(null);
  const dictionaryWordListRef = useRef(null);
  const copiedAudioHistoryTimerRef = useRef(0);
  const audioHistorySummaryRunRef = useRef(0);
  // Set when an append/changed event arrives while the History tab is not the
  // active/visible view, so we refresh once on the next open instead of doing
  // work in the background.
  const audioHistoryRefreshPendingRef = useRef(false);
  const audioHistoryViewportRef = useRef(null);
  const audioHistoryScrollFrameRef = useRef(0);
  const audioHistoryRowHeightsRef = useRef(new Map());
  const audioHistoryEnteringTimersRef = useRef(new Map());
  const [enteringAudioHistoryKeys, setEnteringAudioHistoryKeys] = useState(() => new Set());
  const [audioHistoryViewport, setAudioHistoryViewport] = useState({
    height: AUDIO_HISTORY_VIEWPORT_FALLBACK_HEIGHT,
    scrollTop: 0,
  });
  const [audioHistoryMeasureVersion, setAudioHistoryMeasureVersion] = useState(0);
  const isCloudMode = audioMode === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD;
  const isForgeMode = audioMode === AUDIO_TRANSCRIPTION_PROVIDER_FORGE;
  const isForgeAgentMode = audioMode === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT;
  const deepgramReady = Boolean(deepgramApiKey.trim());
  const installed = Boolean(audioModelStatus?.installed);
  const localWhisperModels = Array.isArray(audioModelStatus?.models) && audioModelStatus.models.length
    ? audioModelStatus.models
    : LOCAL_WHISPER_MODEL_FALLBACKS;
  const selectedWhisperModelId = audioModelStatus?.selectedModelId
    || audioModelStatus?.modelId
    || LOCAL_WHISPER_MODEL_FALLBACKS.find((model) => model.selected)?.modelId
    || "base.en";
  const selectedWhisperModel = localWhisperModels.find((model) => model.modelId === selectedWhisperModelId)
    || localWhisperModels[0]
    || null;
  const selectedWhisperModelTitle = selectedWhisperModel
    ? formatWhisperModelTitle(selectedWhisperModel)
    : "Whisper";
  const downloadingModelId = audioDownloadProgress?.modelId || "";
  const forgeBilling = useMemo(() => {
    if (authState !== "authenticated") {
      return {
        state: "auth_required",
        remaining: null,
        error: "Sign in to Diff Forge AI to use cloud dictation.",
      };
    }
    if (billingStatusState === "loading") {
      return lastKnownForgeBilling || { state: "loading", remaining: null, error: "" };
    }
    if (billingStatusState === "error") {
      return {
        state: "billing_error",
        remaining: null,
        error: billingStatusError || "Unable to load billing status.",
      };
    }
    if (billingStatus) {
      const nextBilling = {
        state: "ready",
        remaining: extractRemainingForgeCredits(billingStatus),
        error: "",
      };
      lastKnownForgeBilling = nextBilling;
      return nextBilling;
    }
    return lastKnownForgeBilling || { state: "loading", remaining: null, error: "" };
  }, [authState, billingStatus, billingStatusError, billingStatusState]);
  const forgeCreditsExhausted = forgeBilling.state === "ready"
    && forgeBilling.remaining !== null
    && forgeBilling.remaining <= 0;
  const forgeReady = !["auth_required", "billing_error"].includes(forgeBilling.state) && !forgeCreditsExhausted;
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
  const missingLabel = audioModelStatus?.modelInstalled
    ? "Runtime missing"
    : audioModelStatus?.runtimeInstalled
      ? "Model missing"
      : "Not installed";
  const audioModeStatusLabel = isForgeMode
    ? (forgeBilling.state === "loading"
      ? "Checking credits"
      : forgeBilling.state === "auth_required"
        ? "Sign in needed"
        : forgeBilling.state === "billing_error"
          ? "Billing unavailable"
        : forgeCreditsExhausted
          ? "No credits"
          : "Diff Forge ready")
    : isForgeAgentMode
      ? (forgeBilling.state === "loading"
        ? "Starting.."
        : forgeBilling.state === "auth_required"
          ? "Sign in needed"
          : forgeBilling.state === "billing_error"
            ? "Billing unavailable"
          : forgeCreditsExhausted
            ? "No credits"
            : "Voice ready")
    : isCloudMode
      ? (deepgramReady ? "Cloud ready" : "API key needed")
    : (installed ? `${selectedWhisperModelTitle} ready` : audioActionState === "downloading" ? "Downloading" : missingLabel);
  const isUninstalling = audioActionState === "uninstalling";
  const selectedAudioInput = audioInputDevices.find((device) => device.deviceId === audioInputDeviceId);
  const selectedAudioInputLabel = selectedAudioInput?.label || "Default microphone";
  const audioInputLevel = Math.round(clampAudioLevel(Math.max(audioInputStats.rms * 2600, audioInputStats.peak * 120)));
  const audioInputHasSignal = audioInputLevel >= 6;
  const audioInputPermissionMissing = audioInputPermissionNeedsAttention(audioInputPermissionStatus);
  const audioInputPermissionPromptable = Boolean(audioInputPermissionStatus?.microphonePromptable);
  const isOpeningAudioInputPermissions = audioInputPermissionActionState === "opening";
  const audioInputStatusLabel = {
    checking: "Checking",
    "needs-access": "Setup needed",
    ready: "Ready",
    starting: "Opening",
    previewing: "Monitoring",
    error: "Input issue",
  }[audioInputState] || "Input";
  const audioInputDisplayStatusLabel = audioInputPermissionMissing
    ? "Needs access"
    : audioInputStatusLabel;
  const audioInputPrimaryActionLabel = audioInputPermissionMissing
    ? isOpeningAudioInputPermissions
      ? (audioInputPermissionPromptable ? "Requesting..." : "Opening...")
      : audioInputPermissionPromptable
        ? "Allow Mic"
        : "Open Settings"
    : audioInputState === "previewing"
      ? "Mute"
      : "Initialize";
  const audioInputPrimaryActionTitle = audioInputPermissionMissing
    ? audioInputPermissionStatus?.message || "Enable Microphone access for Diff Forge AI in System Settings."
    : audioInputState === "previewing"
      ? "Mute (stop monitoring)"
      : "Initialize input";
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
  const audioHotkeyHighlightTargets = useMemo(
    () => new Set(audioHotkeyHighlight.targets || []),
    [audioHotkeyHighlight],
  );
  const shouldHighlightAudioPermissions = audioHotkeyHighlightTargets.has("permissions");
  const shouldHighlightAudioRecorder = audioHotkeyHighlightTargets.has("recorder");
  const shouldHighlightAudioInput = audioHotkeyHighlightTargets.has("input")
    || audioHotkeyHighlightTargets.has("microphone");
  const audioHistoryWindow = useMemo(() => (
    buildAudioHistoryPaginatedWindow(
      audioHistoryTotal,
      audioHistoryViewport,
      (index) => audioHistoryEntriesRef.current.get(index) || null,
      audioHistoryRowHeightsRef.current,
      audioHistoryVariantIds,
    )
  ), [
    audioHistoryTotal,
    audioHistoryViewport,
    audioHistoryMeasureVersion,
    audioHistoryCacheVersion,
    audioHistoryVariantIds,
  ]);
  const dictionaryLists = useMemo(() => (
    Array.isArray(voiceRules.dictionary) ? voiceRules.dictionary : []
  ), [voiceRules.dictionary]);
  const snippetRules = useMemo(() => (
    Array.isArray(voiceRules.snippets) ? voiceRules.snippets : []
  ), [voiceRules.snippets]);
  const transformRules = useMemo(() => (
    Array.isArray(voiceRules.transforms) ? voiceRules.transforms : []
  ), [voiceRules.transforms]);
  const voiceRuleEditorTerms = useMemo(() => (
    voiceRuleEditor?.kind === "dictionary"
      ? parseDictionaryTerms(voiceRuleEditor.draft?.termsText || "")
      : []
  ), [voiceRuleEditor]);
  const voiceRuleEditorTermSearch = voiceRuleEditor?.kind === "dictionary"
    ? String(voiceRuleEditor.draft?.termSearch || "").trim()
    : "";
  const visibleVoiceRuleEditorTerms = useMemo(() => {
    if (!voiceRuleEditorTermSearch) {
      return voiceRuleEditorTerms;
    }

    const needle = voiceRuleEditorTermSearch.toLowerCase();
    return voiceRuleEditorTerms.filter((term) => term.toLowerCase().includes(needle));
  }, [voiceRuleEditorTermSearch, voiceRuleEditorTerms]);
  const voiceRuleEditorCanSave = useMemo(() => {
    const draft = voiceRuleEditor?.draft || {};

    if (voiceRuleEditor?.kind === "dictionary") {
      return Boolean(String(draft.name || "").trim() || voiceRuleEditorTerms.length);
    }

    if (voiceRuleEditor?.kind === "snippets") {
      return Boolean(String(draft.trigger || "").trim() && String(draft.expansion || "").trim());
    }

    if (voiceRuleEditor?.kind === "transforms") {
      return Boolean(String(draft.match || "").trim());
    }

    return false;
  }, [voiceRuleEditor, voiceRuleEditorTerms]);
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

  const syncAudioHistoryViewport = useCallback((node) => {
    if (!node) {
      return;
    }

    const nextViewport = {
      height: node.clientHeight || AUDIO_HISTORY_VIEWPORT_FALLBACK_HEIGHT,
      scrollTop: node.scrollTop || 0,
    };

    setAudioHistoryViewport((current) => (
      current.height === nextViewport.height && current.scrollTop === nextViewport.scrollTop
        ? current
        : nextViewport
    ));
  }, []);

  const handleAudioHistoryScroll = useCallback((event) => {
    const node = event.currentTarget;
    if (!node) {
      return;
    }

    if (
      audioHistoryScrollFrameRef.current
      && typeof window !== "undefined"
      && typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(audioHistoryScrollFrameRef.current);
    }

    const update = () => {
      audioHistoryScrollFrameRef.current = 0;
      syncAudioHistoryViewport(node);
    };

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      audioHistoryScrollFrameRef.current = window.requestAnimationFrame(update);
    } else {
      update();
    }
  }, [syncAudioHistoryViewport]);

  const measureAudioHistoryRow = useCallback((entryKey, height) => {
    const roundedHeight = Math.ceil(Number(height || 0));
    if (!entryKey || roundedHeight <= 0) {
      return;
    }

    const currentHeight = audioHistoryRowHeightsRef.current.get(entryKey) || 0;
    if (Math.abs(currentHeight - roundedHeight) <= 1) {
      return;
    }

    audioHistoryRowHeightsRef.current.set(entryKey, roundedHeight);
    setAudioHistoryMeasureVersion((version) => version + 1);
  }, []);

  const activeAudioTabRef = useRef(activeAudioTab);
  useEffect(() => {
    activeAudioTabRef.current = activeAudioTab;
  }, [activeAudioTab]);

  // Mark a single newly-appended entry as entering so it fades in. Driven by the
  // backend append event (not an array diff), so it is O(1) and only the genuine
  // new item animates. Auto-cleared after the fade so a row scrolled out and
  // back in does not replay it.
  const markAudioHistoryEntering = useCallback((entryKey) => {
    if (!entryKey) {
      return;
    }
    setEnteringAudioHistoryKeys((current) => {
      if (current.has(entryKey)) {
        return current;
      }
      const next = new Set(current);
      next.add(entryKey);
      return next;
    });
    const timers = audioHistoryEnteringTimersRef.current;
    if (timers.has(entryKey)) {
      window.clearTimeout(timers.get(entryKey));
    }
    timers.set(entryKey, window.setTimeout(() => {
      timers.delete(entryKey);
      setEnteringAudioHistoryKeys((current) => {
        if (!current.has(entryKey)) {
          return current;
        }
        const next = new Set(current);
        next.delete(entryKey);
        return next;
      });
    }, AUDIO_HISTORY_ROW_ENTER_CLEAR_MS));
  }, []);

  const resetAudioHistoryPageCache = useCallback(() => {
    audioHistoryEntriesRef.current.clear();
    audioHistoryInflightPagesRef.current.clear();
    setAudioHistoryCacheVersion((version) => version + 1);
  }, []);

  // Optimistically place a freshly-appended entry at the top instead of clearing
  // and refetching, so existing rows stay mounted (their keys are unchanged) and
  // simply glide down via the transform transition while the new row fades in --
  // no skeleton flash. Returns false if the entry is already cached (deduped).
  const prependAudioHistoryEntry = useCallback((entry) => {
    const entryId = entry?.id ? String(entry.id) : "";
    const entries = audioHistoryEntriesRef.current;
    if (entryId) {
      for (const value of entries.values()) {
        if (value?.id && String(value.id) === entryId) {
          return false;
        }
      }
    }
    const shifted = new Map();
    entries.forEach((value, index) => {
      shifted.set(index + 1, value);
    });
    shifted.set(0, entry);
    audioHistoryEntriesRef.current = shifted;
    // Page offsets no longer align to the shifted cache; let the fetch effect
    // refill any gap the user scrolls into (backend stays consistent post-insert).
    audioHistoryInflightPagesRef.current.clear();
    setAudioHistoryTotal((current) => current + 1);
    setAudioHistoryCacheVersion((version) => version + 1);
    return true;
  }, []);

  const refreshAudioHistorySummary = useCallback(async () => {
    const run = audioHistorySummaryRunRef.current + 1;
    audioHistorySummaryRunRef.current = run;
    try {
      const summary = await audioHistoryFetchSummary();
      if (audioHistorySummaryRunRef.current !== run) {
        return;
      }
      setAudioHistoryTotal(Math.max(0, Number(summary?.totalDictations) || 0));
      setAudioHistoryInsights(buildAudioHistoryInsightsFromSummary(summary));
      setAudioHistoryReady(true);
    } catch {
      if (audioHistorySummaryRunRef.current === run) {
        setAudioHistoryReady(true);
      }
    }
  }, []);

  // One-time import of any pre-existing localStorage history into the backend.
  // After the first launch this is a no-op (flagged), and it never fetches the
  // summary unless the History tab is already open -- all history IPC stays
  // bound to the tab being up.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateLocalAudioHistoryToBackend(readAudioTranscriptionHistory());
      if (!cancelled && activeAudioTabRef.current === "history") {
        resetAudioHistoryPageCache();
        refreshAudioHistorySummary();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAudioHistorySummary, resetAudioHistoryPageCache]);

  // Energy gating: only do summary/window work while the History tab is the
  // active view. Opening it (or returning after background appends) refreshes
  // the count/insights and reloads the visible window from the durable store.
  useEffect(() => {
    if (activeAudioTab !== "history") {
      return;
    }
    if (audioHistoryRefreshPendingRef.current) {
      audioHistoryRefreshPendingRef.current = false;
      resetAudioHistoryPageCache();
    }
    refreshAudioHistorySummary();
  }, [activeAudioTab, refreshAudioHistorySummary, resetAudioHistoryPageCache]);

  // Fetch only the pages covering the visible window, in fixed-size pages, so
  // the IPC payload stays tiny. Loaded entries are cached by absolute index and
  // far pages are evicted to bound memory.
  useEffect(() => {
    if (activeAudioTab !== "history" || audioHistoryTotal <= 0) {
      return;
    }
    const { startIndex, endIndex } = audioHistoryWindow;
    if (endIndex <= startIndex) {
      return;
    }
    const entries = audioHistoryEntriesRef.current;
    const inflight = audioHistoryInflightPagesRef.current;

    // Fetch is keyed on per-index presence (not a "page loaded" flag) so that a
    // head insertion, which shifts every cached index, never leaves stale page
    // bookkeeping or gaps: any missing index in the window pulls its aligned page.
    const neededOffsets = new Set();
    for (let index = startIndex; index < endIndex; index += 1) {
      if (!entries.has(index)) {
        neededOffsets.add(Math.floor(index / AUDIO_HISTORY_PAGE_SIZE) * AUDIO_HISTORY_PAGE_SIZE);
      }
    }

    neededOffsets.forEach((offset) => {
      if (inflight.has(offset)) {
        return;
      }
      inflight.add(offset);
      audioHistoryFetchPage({ offset, limit: AUDIO_HISTORY_PAGE_SIZE })
        .then((result) => {
          const items = Array.isArray(result?.items) ? result.items : [];
          items.forEach((item, itemIndex) => {
            entries.set(offset + itemIndex, item);
          });
          inflight.delete(offset);
          // Bound memory: drop entries far from the page we just loaded.
          const keepRadius = AUDIO_HISTORY_MAX_CACHED_PAGES * AUDIO_HISTORY_PAGE_SIZE;
          if (entries.size > keepRadius) {
            Array.from(entries.keys()).forEach((cachedIndex) => {
              if (Math.abs(cachedIndex - offset) > keepRadius) {
                entries.delete(cachedIndex);
              }
            });
          }
          setAudioHistoryCacheVersion((version) => version + 1);
        })
        .catch(() => {
          inflight.delete(offset);
        });
    });
  }, [activeAudioTab, audioHistoryTotal, audioHistoryWindow]);

  // New/changed entries arrive via backend events. Handle them only while the
  // History tab is active; otherwise note a pending refresh for the next open.
  useEffect(() => {
    let disposed = false;
    const unlisteners = [];

    const handleAppended = (event) => {
      if (activeAudioTabRef.current !== "history") {
        audioHistoryRefreshPendingRef.current = true;
        return;
      }
      const entry = event?.payload && typeof event.payload === "object" ? event.payload : null;
      if (!entry) {
        resetAudioHistoryPageCache();
        refreshAudioHistorySummary();
        return;
      }
      const entryKey = entry.id ? String(entry.id) : "";
      if (entryKey) {
        markAudioHistoryEntering(entryKey);
      }
      // Optimistic prepend keeps existing rows mounted (smooth slide + fade);
      // the summary refresh reconciles the total/insights with the store.
      prependAudioHistoryEntry(entry);
      refreshAudioHistorySummary();
    };

    const handleChanged = () => {
      if (activeAudioTabRef.current !== "history") {
        audioHistoryRefreshPendingRef.current = true;
        return;
      }
      resetAudioHistoryPageCache();
      refreshAudioHistorySummary();
    };

    listen(AUDIO_HISTORY_APPENDED_EVENT, (event) => {
      if (!disposed) {
        handleAppended(event);
      }
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlisteners.push(unlisten);
        }
      })
      .catch(() => {});

    listen(AUDIO_HISTORY_CHANGED_EVENT, () => {
      if (!disposed) {
        handleChanged();
      }
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlisteners.push(unlisten);
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => {
        try {
          unlisten();
        } catch {
          // ignore
        }
      });
    };
  }, [
    markAudioHistoryEntering,
    prependAudioHistoryEntry,
    refreshAudioHistorySummary,
    resetAudioHistoryPageCache,
  ]);

  useEffect(() => () => {
    audioHistoryEnteringTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    audioHistoryEnteringTimersRef.current.clear();
  }, []);

  // Drop measured heights for entries that have been evicted from the page cache
  // so the heights map stays bounded as the user scrolls through a huge history.
  useEffect(() => {
    const validKeys = new Set();
    audioHistoryEntriesRef.current.forEach((entry) => {
      const key = entry?.id ? String(entry.id) : "";
      if (key) {
        validKeys.add(key);
      }
    });
    audioHistoryRowHeightsRef.current.forEach((_height, entryKey) => {
      if (!validKeys.has(entryKey)) {
        audioHistoryRowHeightsRef.current.delete(entryKey);
      }
    });
  }, [audioHistoryCacheVersion]);

  useEffect(() => {
    if (activeAudioTab !== "history") {
      return undefined;
    }

    const node = audioHistoryViewportRef.current;
    if (!node) {
      return undefined;
    }

    const sync = () => syncAudioHistoryViewport(node);
    sync();

    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(sync);
      observer.observe(node);
    } else if (typeof window !== "undefined") {
      window.addEventListener("resize", sync);
    }

    return () => {
      observer?.disconnect?.();
      if (typeof ResizeObserver === "undefined" && typeof window !== "undefined") {
        window.removeEventListener("resize", sync);
      }
    };
  }, [activeAudioTab, syncAudioHistoryViewport]);

  useEffect(() => () => {
    if (
      audioHistoryScrollFrameRef.current
      && typeof window !== "undefined"
      && typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(audioHistoryScrollFrameRef.current);
      audioHistoryScrollFrameRef.current = 0;
    }
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
    if (audioInputLoadPromiseRef.current) {
      return audioInputLoadPromiseRef.current;
    }

    const loadRunId = audioInputLoadRunRef.current + 1;
    audioInputLoadRunRef.current = loadRunId;
    const currentState = audioInputStateRef.current;

    if (currentState !== "previewing") {
      audioInputStateRef.current = "checking";
      setAudioInputState("checking");
    }

    const loadPromise = (async () => {
      const permissionStatus = await getAudioInputPermissionStatus().catch(() => null);
      if (audioInputLoadRunRef.current !== loadRunId) {
        return;
      }
      if (permissionStatus) {
        setAudioInputPermissionStatus(permissionStatus);
        if (audioInputPermissionNeedsAttention(permissionStatus)) {
          clearAudioInputSetupReady();
          audioInputRunRef.current += 1;
          const existingPreview = audioInputPreviewRef.current;
          audioInputPreviewRef.current = null;
          if (existingPreview) {
            await existingPreview.close().catch(() => {});
          }
          setAudioInputStats(EMPTY_AUDIO_INPUT_STATS);
          audioInputStateRef.current = "needs-access";
          setAudioInputState("needs-access");
          setAudioInputMessage(permissionStatus.message || "Enable Microphone access for Diff Forge AI in System Settings.");
          return;
        }
      }

      const devices = await listAudioInputDevices();
      if (audioInputLoadRunRef.current !== loadRunId) {
        return;
      }
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
        const permissionMissing = audioInputPermissionNeedsAttention(permissionStatus);
        const inputSetupReady = hasAudioInputSetup() && !permissionMissing;
        const canAutoStartInput = !isMacPlatform() || inputSetupReady;
        const nextState = permissionMissing ? "needs-access" : canAutoStartInput ? "ready" : "needs-access";
        audioInputStateRef.current = nextState;
        setAudioInputState(nextState);
        setAudioInputMessage(permissionMissing
          ? (permissionStatus?.message || "Enable Microphone access for Diff Forge AI in System Settings.")
          : canAutoStartInput
            ? "Start monitoring to preview levels from the selected source."
            : "Enable input to open a native stream from the selected source.");
      }
    })();

    audioInputLoadPromiseRef.current = loadPromise;

    try {
      return await loadPromise;
    } catch (deviceError) {
      if (audioInputLoadRunRef.current === loadRunId) {
        audioInputStateRef.current = "error";
        setAudioInputState("error");
        setAudioInputMessage(getAudioInputErrorMessage(deviceError, "Unable to list audio input sources."));
      }
      return undefined;
    } finally {
      if (audioInputLoadPromiseRef.current === loadPromise) {
        audioInputLoadPromiseRef.current = null;
      }
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
      const permissionStatus = await getAudioInputPermissionStatus().catch(() => null);
      if (audioInputRunRef.current !== runId) {
        return;
      }
      if (permissionStatus) {
        setAudioInputPermissionStatus(permissionStatus);
        if (audioInputPermissionNeedsAttention(permissionStatus)) {
          clearAudioInputSetupReady();
          audioInputStateRef.current = "needs-access";
          setAudioInputState("needs-access");
          setAudioInputMessage(permissionStatus.message || "Enable Microphone access for Diff Forge AI in System Settings.");
          return;
        }
      }

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

      loadAudioInputDevices();
    } catch (inputError) {
      if (audioInputRunRef.current !== runId) {
        return;
      }

      setAudioInputStats(EMPTY_AUDIO_INPUT_STATS);
      if (String(inputError?.message || inputError || "").toLowerCase().includes("permission")
        || String(inputError?.message || inputError || "").toLowerCase().includes("denied")) {
        clearAudioInputSetupReady();
      }
      audioInputStateRef.current = "error";
      setAudioInputState("error");
      setAudioInputMessage(getAudioInputErrorMessage(inputError, "Unable to open the selected input source."));
    }
  }, [loadAudioInputDevices]);

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

    setAudioInputMessage(audioInputPermissionMissing
      ? (audioInputPermissionStatus?.message || "Enable Microphone access for Diff Forge AI in System Settings.")
      : hasAudioInputSetup()
        ? "Start monitoring to preview levels from the selected source."
        : "Enable input to open a native stream from the selected source.");
  }, [audioInputPermissionMissing, audioInputPermissionStatus, startAudioInputPreview]);

  const openAudioInputPermissionSettings = useCallback(async () => {
    setAudioInputPermissionActionState("opening");
    setAudioInputMessage(audioInputPermissionPromptable
      ? "Requesting microphone access."
      : "Opening macOS Microphone settings.");
    try {
      const permissionStatus = await openAudioInputPermissions();
      setAudioInputPermissionStatus(permissionStatus);
      if (audioInputPermissionNeedsAttention(permissionStatus)) {
        clearAudioInputSetupReady();
        audioInputStateRef.current = "needs-access";
        setAudioInputState("needs-access");
        setAudioInputMessage(permissionStatus?.message || "Enable Microphone access for Diff Forge AI in System Settings.");
      } else {
        setAudioInputMessage("Microphone access is enabled. Initialize input to preview levels.");
        loadAudioInputDevices();
      }
    } catch (permissionError) {
      audioInputStateRef.current = "error";
      setAudioInputState("error");
      setAudioInputMessage(getErrorMessage(permissionError, "Unable to open microphone permission settings."));
    } finally {
      setAudioInputPermissionActionState("idle");
    }
  }, [audioInputPermissionPromptable, loadAudioInputDevices]);

  const toggleAudioInputPreview = useCallback(() => {
    if (audioInputPermissionMissing) {
      openAudioInputPermissionSettings();
      return;
    }

    if (audioInputStateRef.current === "previewing") {
      stopAudioInputPreview();
      audioInputStateRef.current = "ready";
      setAudioInputState("ready");
      setAudioInputStats(EMPTY_AUDIO_INPUT_STATS);
      setAudioInputMessage("Monitoring paused. Start monitoring to preview input levels.");
      return;
    }

    startAudioInputPreview();
  }, [audioInputPermissionMissing, openAudioInputPermissionSettings, startAudioInputPreview, stopAudioInputPreview]);

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

  const saveVoiceRulesImmediately = useCallback(async (nextRules) => {
    if (voiceRulesSaveTimerRef.current) {
      window.clearTimeout(voiceRulesSaveTimerRef.current);
      voiceRulesSaveTimerRef.current = 0;
    }

    setVoiceRuleSaveState("saving");

    try {
      const savedRules = await saveVoiceTextRules(nextRules);
      setVoiceRules(savedRules);
      setVoiceRulesError("");
      setVoiceRuleSaveState("saved");
      return savedRules;
    } catch (rulesError) {
      setVoiceRulesError(getErrorMessage(rulesError, "Unable to save voice rules."));
      setVoiceRuleSaveState("error");
      throw rulesError;
    }
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
    setVoiceRuleEditor((currentEditor) => (
      currentEditor?.kind === kind && currentEditor?.id === entryId ? null : currentEditor
    ));
    updateVoiceRulesList(kind, (entries) => entries.filter((entry) => entry.id !== entryId));
  }, [updateVoiceRulesList]);

  const openVoiceRuleEditor = useCallback((kind, entry = null) => {
    if (!VOICE_RULE_TAB_IDS.has(kind)) {
      return;
    }

    const draft = kind === "dictionary"
      ? {
        name: entry?.name || "",
        selected: entry?.selected !== false,
        termInput: "",
        termSearch: "",
        termsText: formatDictionaryTermsDraftText(entry?.termsText ?? (entry?.terms || []).join("\n")),
      }
      : kind === "snippets"
        ? {
          enabled: entry?.enabled !== false,
          expansion: entry?.expansion || "",
          trigger: entry?.trigger || "",
        }
        : {
          enabled: entry?.enabled !== false,
          isRegex: entry?.isRegex === true,
          match: entry?.match || "",
          replacement: entry?.replacement || "",
        };

    setVoiceRuleSaveState("idle");
    setVoiceRuleEditor({
      draft,
      id: entry?.id || "",
      kind,
      mode: entry?.id ? "edit" : "new",
    });
  }, []);

  const closeVoiceRuleEditor = useCallback(() => {
    setVoiceRuleEditor(null);
    setVoiceRuleSaveState("idle");
  }, []);

  const updateVoiceRuleEditorDraft = useCallback((patch) => {
    setVoiceRuleSaveState("idle");
    setVoiceRuleEditor((currentEditor) => (
      currentEditor
        ? {
          ...currentEditor,
          draft: {
            ...currentEditor.draft,
            ...patch,
          },
        }
        : currentEditor
    ));
  }, []);

  const updateDictionaryEditorTerms = useCallback((terms, patch = {}) => {
    updateVoiceRuleEditorDraft({
      ...patch,
      termsText: formatDictionaryTermsDraftText(terms),
    });
  }, [updateVoiceRuleEditorDraft]);

  const updateDictionaryWordListBottomState = useCallback(() => {
    const node = dictionaryWordListRef.current;
    if (!node) {
      setDictionaryWordListNeedsBottomJump(false);
      return;
    }

    const overflow = node.scrollHeight > node.clientHeight + 12;
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight <= 12;
    setDictionaryWordListNeedsBottomJump(overflow && !atBottom);
  }, []);

  const scrollDictionaryWordListToBottom = useCallback((behavior = "smooth") => {
    const node = dictionaryWordListRef.current;
    if (!node) {
      return;
    }

    node.scrollTo({
      behavior,
      top: node.scrollHeight,
    });
    if (typeof window !== "undefined") {
      window.setTimeout(updateDictionaryWordListBottomState, 180);
    }
  }, [updateDictionaryWordListBottomState]);

  const addDictionaryEditorTerms = useCallback(() => {
    if (voiceRuleEditor?.kind !== "dictionary") {
      return;
    }

    const draft = voiceRuleEditor.draft || {};
    const incomingTerms = parseDictionaryTerms(draft.termInput || "");
    if (!incomingTerms.length) {
      return;
    }

    updateDictionaryEditorTerms([...voiceRuleEditorTerms, ...incomingTerms], { termInput: "" });
    if (typeof window !== "undefined") {
      window.setTimeout(() => scrollDictionaryWordListToBottom("smooth"), 0);
    }
  }, [scrollDictionaryWordListToBottom, updateDictionaryEditorTerms, voiceRuleEditor, voiceRuleEditorTerms]);

  const removeDictionaryEditorTerm = useCallback((termToRemove) => {
    updateDictionaryEditorTerms(
      voiceRuleEditorTerms.filter((term) => term.toLowerCase() !== String(termToRemove || "").toLowerCase()),
    );
  }, [updateDictionaryEditorTerms, voiceRuleEditorTerms]);

  const handleDictionaryTermInputKeyDown = useCallback((event) => {
    if (event.key !== "Enter" || event.nativeEvent?.isComposing) {
      return;
    }

    event.preventDefault();
    addDictionaryEditorTerms();
  }, [addDictionaryEditorTerms]);

  useEffect(() => {
    if (activeAudioTab !== "dictionary" || voiceRuleEditor?.kind !== "dictionary") {
      setDictionaryWordListNeedsBottomJump(false);
      return undefined;
    }

    const frame = window.requestAnimationFrame(updateDictionaryWordListBottomState);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [
    activeAudioTab,
    updateDictionaryWordListBottomState,
    visibleVoiceRuleEditorTerms.length,
    voiceRuleEditor?.kind,
    voiceRuleEditorTermSearch,
    voiceRuleEditorTerms.length,
  ]);

  const saveVoiceRuleEditor = useCallback(async (event) => {
    event?.preventDefault?.();

    if (!voiceRuleEditor || voiceRuleSaveState === "saving") {
      return;
    }

    const { draft, id, kind, mode } = voiceRuleEditor;
    const currentEntries = Array.isArray(voiceRules[kind]) ? voiceRules[kind] : [];
    const nextId = id || `${kind}-${Date.now()}`;
    let nextEntry = null;

    if (kind === "dictionary") {
      const name = String(draft?.name || "").trim();
      const termsText = String(draft?.termsText || "");
      const terms = parseDictionaryTerms(termsText);

      if (!name && !terms.length) {
        return;
      }

      nextEntry = {
        id: nextId,
        name: name || `List ${currentEntries.length + 1}`,
        selected: draft?.selected !== false,
        terms,
      };
    } else if (kind === "snippets") {
      const trigger = String(draft?.trigger || "").trim();
      const expansion = String(draft?.expansion || "").trim();

      if (!trigger || !expansion) {
        return;
      }

      nextEntry = {
        id: nextId,
        enabled: draft?.enabled !== false,
        expansion,
        trigger,
      };
    } else if (kind === "transforms") {
      const match = String(draft?.match || "").trim();

      if (!match) {
        return;
      }

      nextEntry = {
        id: nextId,
        enabled: draft?.enabled !== false,
        isRegex: draft?.isRegex === true,
        match,
        replacement: String(draft?.replacement || ""),
      };
    }

    if (!nextEntry) {
      return;
    }

    const existingIndex = currentEntries.findIndex((entry) => entry.id === nextId);
    const nextEntries = mode === "edit" && existingIndex >= 0
      ? currentEntries.map((entry) => (entry.id === nextId ? nextEntry : entry))
      : [...currentEntries, nextEntry];
    const nextRules = { ...voiceRules, [kind]: nextEntries };

    setVoiceRules(nextRules);

    try {
      await saveVoiceRulesImmediately(nextRules);
      setVoiceRuleEditor(null);
    } catch {
      // Keep the editor open so the user can retry.
    }
  }, [saveVoiceRulesImmediately, voiceRuleEditor, voiceRuleSaveState, voiceRules]);

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

  const copyAudioHistoryPrompt = useCallback(async (entry, index, variant = null) => {
    const text = String(variant?.text || entry?.text || "").trim();
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

  const stepAudioHistoryVariant = useCallback((row, direction) => {
    if (!row?.entryKey || !Array.isArray(row.variants) || row.variants.length < 2) {
      return;
    }

    setAudioHistoryVariantIds((current) => {
      const next = new Map(current);
      const currentIndex = Math.max(0, row.variantIndex);
      const nextIndex = (currentIndex + direction + row.variants.length) % row.variants.length;
      next.set(row.entryKey, row.variants[nextIndex].id);
      return next;
    });
  }, []);

  const selectAudioMode = useCallback((nextMode) => {
    setAudioMode(nextMode);
    writeAudioTranscriptionProvider(nextMode);
    notifyAudioSettingsChanged("provider");
  }, []);

  const installLocalWhisperModel = useCallback((modelId) => {
    onDownloadModel?.(modelId);
  }, [onDownloadModel]);

  const selectLocalWhisperModel = useCallback((modelId) => {
    onSelectModel?.(modelId);
  }, [onSelectModel]);

  const refreshForgeBilling = useCallback(async () => {
    await onRefreshBillingStatus?.({ quiet: false });
  }, [onRefreshBillingStatus]);

  useEffect(() => {
    if (
      (isForgeMode || isForgeAgentMode)
      && authState === "authenticated"
      && billingStatusState === "idle"
    ) {
      refreshForgeBilling();
    }
  }, [authState, billingStatusState, isForgeAgentMode, isForgeMode, refreshForgeBilling]);

  useEffect(() => {
    // Keep a pre-authenticated cloud dictation websocket parked whenever
    // Diff Forge Cloud dictation is the selected provider so press-to-talk
    // starts instantly instead of paying the connect handshake.
    invoke("prewarm_forge_dictation_transcription", {
      request: { enabled: isForgeMode },
    }).catch(() => {});
    if (isForgeAgentMode) {
      prewarmCloudVoiceAgentStream().catch(() => {});
    }
  }, [isForgeAgentMode, isForgeMode]);

  const toggleForgeLlmCleanup = useCallback(() => {
    setForgeLlmCleanup((currentValue) => {
      const nextValue = !currentValue;
      writeForgeLlmCleanup(nextValue);
      notifyAudioSettingsChanged("forge-llm-cleanup");
      return nextValue;
    });
  }, []);

  const selectLlmCleanupEngine = useCallback((engine) => {
    setLlmCleanupEngine(engine);
    writeAudioLlmCleanupEngine(engine);
    notifyAudioSettingsChanged("forge-llm-cleanup-engine");
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlistenPreferences = null;

    const applyPreferences = (payload, reason) => {
      if (cancelled) {
        return null;
      }
      const preferences = applySyncedAudioPolishingPreferences(payload);
      if (!preferences) {
        return null;
      }
      setPolishingSystemPrompt(preferences.polishingSystemPrompt);
      notifyAudioSettingsChanged(reason);
      return preferences;
    };

    invoke("cloud_mcp_get_audio_preferences")
      .then((preferences) => {
        if (cancelled) {
          return;
        }
        const applied = applyPreferences(preferences, "polishing-prompt-sync");
        const localPreferences = readAudioPolishingPreferences();
        if (!applied && localPreferences.polishingSystemPrompt) {
          writeAudioPolishingSystemPrompt(localPreferences.polishingSystemPrompt, {
            reason: "polishing_prompt_migrated",
            updatedAtMs: localPreferences.updatedAtMs || Date.now(),
          });
        }
      })
      .catch(() => {
        const localPreferences = readAudioPolishingPreferences();
        if (localPreferences.polishingSystemPrompt && !localPreferences.updatedAtMs) {
          writeAudioPolishingSystemPrompt(localPreferences.polishingSystemPrompt, {
            reason: "polishing_prompt_migrated",
          });
        }
      });

    listen(AUDIO_PREFERENCES_CHANGED_EVENT, (event) => {
      applyPreferences(event?.payload?.preferences || event?.payload, "polishing-prompt-sync");
    }).then((nextUnlisten) => {
      if (cancelled) {
        nextUnlisten();
        return;
      }
      unlistenPreferences = nextUnlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenPreferences) {
        unlistenPreferences();
      }
    };
  }, []);

  const updatePolishingSystemPrompt = useCallback((event) => {
    const nextPrompt = normalizeAudioPolishingSystemPrompt(event.target.value);
    setPolishingSystemPrompt(nextPrompt);
    writeAudioPolishingSystemPrompt(nextPrompt);
    notifyAudioSettingsChanged("polishing-prompt");
  }, []);

  const restoreDefaultPolishingSystemPrompt = useCallback(() => {
    setPolishingSystemPrompt(defaultPolishingSystemPrompt);
    writeAudioPolishingSystemPrompt(defaultPolishingSystemPrompt, {
      reason: "polishing_prompt_restore_default",
    });
    notifyAudioSettingsChanged("polishing-prompt");
  }, [defaultPolishingSystemPrompt]);

  const updateDeepgramApiKey = useCallback((event) => {
    const nextApiKey = event.target.value;
    setDeepgramApiKey(nextApiKey);
    writeDeepgramApiKey(nextApiKey);
    notifyAudioSettingsChanged("deepgram-key");
  }, []);

  const updateDeepgramLanguage = useCallback((nextLanguage) => {
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
    const attentionId = Number(audioHotkeyAttention?.id || 0);
    if (!attentionId) {
      return undefined;
    }

    const targets = normalizeAudioHotkeyAttentionTargets(audioHotkeyAttention);
    setActiveAudioTab("general");
    setAudioHotkeyHighlight({ id: attentionId, targets });
    loadAudioInputDevices();
    loadAudioShortcutStatus();

    const primaryRef = targets.includes("input") || targets.includes("microphone")
      ? audioInputSourcePanelRef
      : targets.includes("recorder")
        ? audioRecorderPanelRef
        : targets.includes("permissions")
          ? audioShortcutSettingsPanelRef
          : audioInputSourcePanelRef;
    const scrollFrame = window.requestAnimationFrame(() => {
      primaryRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    });
    const clearTimer = window.setTimeout(() => {
      setAudioHotkeyHighlight((current) => (
        current.id === attentionId ? { id: 0, targets: [] } : current
      ));
    }, AUDIO_HOTKEY_ATTENTION_HIGHLIGHT_MS);

    return () => {
      window.cancelAnimationFrame(scrollFrame);
      window.clearTimeout(clearTimer);
    };
  }, [audioHotkeyAttention, loadAudioInputDevices, loadAudioShortcutStatus]);

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
    let disposed = false;
    let unlisten = () => {};

    listen(AUDIO_TRANSCRIPTION_RESULT_EVENT, (event) => {
      // The durable backend append drives the History tab via
      // AUDIO_HISTORY_APPENDED_EVENT; flag a fallback refresh in case that write
      // lagged behind this UI event so the tab self-corrects on next open.
      if (!disposed && event.payload?.text) {
        audioHistoryRefreshPendingRef.current = true;
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

  const selectAudioTab = useCallback((tabId) => {
    setActiveAudioTab(tabId);
    setVoiceRuleEditor(null);
    setVoiceRuleSaveState("idle");
  }, []);

  const handleAudioTabKeyDown = useCallback((event) => {
    const currentIndex = AUDIO_SETTINGS_TABS.findIndex((tab) => tab.id === activeAudioTab);
    if (currentIndex < 0) {
      return;
    }

    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % AUDIO_SETTINGS_TABS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + AUDIO_SETTINGS_TABS.length) % AUDIO_SETTINGS_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = AUDIO_SETTINGS_TABS.length - 1;
    } else {
      return;
    }

    event.preventDefault();
    const nextTab = AUDIO_SETTINGS_TABS[nextIndex];
    selectAudioTab(nextTab.id);
    window.requestAnimationFrame(() => {
      document.getElementById(`audio-tab-${nextTab.id}`)?.focus();
    });
  }, [activeAudioTab, selectAudioTab]);

  const isVoiceRuleTab = VOICE_RULE_TAB_IDS.has(activeAudioTab);
  const activeVoiceRuleTitle = activeAudioTab === "dictionary"
    ? "Dictionary"
    : activeAudioTab === "snippets"
      ? "Snippets"
      : "Transforms";
  const activeVoiceRuleEntries = activeAudioTab === "dictionary"
    ? dictionaryLists
    : activeAudioTab === "snippets"
      ? snippetRules
      : activeAudioTab === "transforms"
        ? transformRules
        : [];
  const activeVoiceRuleAddLabel = activeAudioTab === "dictionary"
    ? "Add dictionary list"
    : activeAudioTab === "snippets"
      ? "Add snippet"
      : "Add transform";
  const activeVoiceRuleEmptyTitle = activeAudioTab === "dictionary"
    ? "No lists yet"
    : activeAudioTab === "snippets"
      ? "No snippets yet"
      : "No transforms yet";
  const editorDraft = voiceRuleEditor?.draft || {};
  const editorTitle = voiceRuleEditor?.kind === "dictionary"
    ? (voiceRuleEditor.mode === "new" ? "New list" : (editorDraft.name || "Edit list"))
    : voiceRuleEditor?.kind === "snippets"
      ? (voiceRuleEditor.mode === "new" ? "New snippet" : (editorDraft.trigger || "Edit snippet"))
      : (voiceRuleEditor?.mode === "new" ? "New transform" : (editorDraft.match || "Edit transform"));
  const editorStatus = voiceRuleSaveState === "saving"
    ? "Saving"
    : voiceRuleSaveState === "error"
      ? "Save failed"
      : "Ready";

  return (
    <AudioWorkspaceSurface aria-label="Workspace audio">
      <AudioTabBar aria-label="Audio settings">
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

        <AudioTabList onKeyDown={handleAudioTabKeyDown} role="tablist" aria-label="Audio settings sections">
          {AUDIO_SETTINGS_TABS.map((tab) => (
            <AudioTabButton
              aria-controls={`audio-tabpanel-${tab.id}`}
              aria-selected={activeAudioTab === tab.id}
              id={`audio-tab-${tab.id}`}
              key={tab.id}
              onClick={() => selectAudioTab(tab.id)}
              role="tab"
              tabIndex={activeAudioTab === tab.id ? 0 : -1}
              type="button"
            >
              {tab.label}
            </AudioTabButton>
          ))}
        </AudioTabList>
      </AudioTabBar>

      <AudioSetupPanel>
        {activeAudioTab === "general" && (
          <AudioTabPanel
            aria-labelledby="audio-tab-general"
            id="audio-tabpanel-general"
            role="tabpanel"
          >
        <AudioInputSourcePanel aria-label="Audio input settings" ref={audioInputSourcePanelRef}>
          {shouldHighlightAudioInput && (
            <AudioAttentionFlash
              aria-hidden="true"
              key={`audio-input-highlight-${audioHotkeyHighlight.id}`}
            />
          )}
          <AudioDeviceHeader>
            <div>
              <SettingsLabel>Input source</SettingsLabel>
              <SettingsHint>{audioInputMessage}</SettingsHint>
            </div>
            <AudioInputHeaderControls>
              <AudioInputInitializeButton
                aria-label={audioInputPermissionMissing
                  ? audioInputPrimaryActionLabel
                  : audioInputState === "previewing"
                    ? "Mute input monitor"
                    : "Initialize input source"}
                aria-pressed={audioInputState === "previewing"}
                data-active={audioInputState === "previewing" ? "true" : "false"}
                disabled={audioInputState === "checking" || audioInputState === "starting" || isOpeningAudioInputPermissions}
                onClick={toggleAudioInputPreview}
                title={audioInputPrimaryActionTitle}
                type="button"
              >
                {audioInputState === "previewing" ? (
                  <ButtonMicOffIcon aria-hidden="true" />
                ) : (
                  <ButtonMicIcon aria-hidden="true" />
                )}
                <span>{audioInputPrimaryActionLabel}</span>
                {shouldHighlightAudioInput && (
                  <AudioButtonAttentionFlash
                    aria-hidden="true"
                    key={`audio-input-button-highlight-${audioHotkeyHighlight.id}`}
                  />
                )}
              </AudioInputInitializeButton>
              <AudioStatePill data-installed={audioInputState === "previewing"}>
                {audioInputDisplayStatusLabel}
              </AudioStatePill>
            </AudioInputHeaderControls>
          </AudioDeviceHeader>

          <AudioInputPill data-live={audioInputState === "previewing" ? "true" : "false"}>
            <AudioInputMicButton
              aria-label={audioInputPermissionMissing
                ? audioInputPrimaryActionLabel
                : audioInputState === "previewing" ? "Stop monitor" : "Enable input"}
              data-live={audioInputState === "previewing" ? "true" : "false"}
              disabled={audioInputState === "checking" || audioInputState === "starting" || isOpeningAudioInputPermissions}
              onClick={toggleAudioInputPreview}
              title={audioInputPrimaryActionTitle}
              type="button"
            >
              <ButtonMicIcon aria-hidden="true" />
            </AudioInputMicButton>
            <div style={{ flex: "1 1 auto", minWidth: 0 }}>
              <AppSelect
                aria-label="Microphone input source"
                isDisabled={audioInputState === "checking" || audioInputState === "starting"}
                onChange={(value) => selectAudioInputDevice({ target: { value } })}
                options={audioInputDevices.length
                  ? audioInputDevices.map((device) => ({ value: device.deviceId, label: device.label }))
                  : [{ value: "default", label: "Default microphone" }]}
                value={audioInputDeviceId}
              />
            </div>
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
            <AudioInputPillIconButton
              aria-label="Refresh input sources"
              disabled={audioInputState === "checking" || audioInputState === "starting"}
              onClick={loadAudioInputDevices}
              title="Refresh input sources"
              type="button"
            >
              <ButtonRefreshIcon aria-hidden="true" />
            </AudioInputPillIconButton>
          </AudioInputPill>
          <AudioInputMeta>
            {selectedAudioInputLabel} / level {formatAudioLevel(audioInputLevel)} / buffer {Math.round((audioInputStats.bufferMs || 0) / 1000)}s
          </AudioInputMeta>
          {audioInputPermissionMissing && (
            <AudioRecorderOptionRow>
              <SettingsHint>System Settings / Privacy & Security / Microphone</SettingsHint>
              <SecondaryButton
                disabled={isOpeningAudioInputPermissions}
                onClick={openAudioInputPermissionSettings}
                type="button"
              >
                <ButtonMicIcon aria-hidden="true" />
                <span>{audioInputPrimaryActionLabel}</span>
              </SecondaryButton>
            </AudioRecorderOptionRow>
          )}
        </AudioInputSourcePanel>

        <AudioGeneralToolbar>
          <AudioGeneralColumn>
          <AudioProviderPanel aria-label="Transcription provider">
            <AudioDeviceHeader>
              <div>
                <SettingsLabel>Provider</SettingsLabel>
                <SettingsHint>{isForgeMode
                  ? "Diff Forge Cloud"
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
                aria-pressed={isForgeMode}
                onClick={() => selectAudioMode(AUDIO_TRANSCRIPTION_PROVIDER_FORGE)}
                type="button"
              >
                <ButtonHubIcon aria-hidden="true" />
                <span>
                  <strong>Diff Forge Cloud</strong>
                  <span>Nova-3 + LLM cleanup</span>
                </span>
              </AudioModeButton>
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
              {SHOW_OWN_KEY_DEEPGRAM_PROVIDER && (
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
              )}
            </AudioModeList>
            {!isCloudMode && !isForgeMode && !isForgeAgentMode && (
              <AudioLocalModelList aria-label="Local Whisper model">
                {localWhisperModels.map((model) => {
                  const modelId = model.modelId || model.model_id || "";
                  const modelInstalled = Boolean(model.installed);
                  const modelSelected = model.selected || modelId === selectedWhisperModelId;
                  const modelDownloading = audioActionState === "downloading"
                    && (!downloadingModelId || downloadingModelId === modelId);
                  const otherModelDownloading = audioActionState === "downloading"
                    && downloadingModelId
                    && downloadingModelId !== modelId;
                  const modelActionDisabled = audioActionState === "uninstalling"
                    || audioActionState === "opening"
                    || audioActionState === "closing"
                    || modelDownloading
                    || otherModelDownloading
                    || (modelInstalled && modelSelected);
                  const ModelActionButton = modelInstalled ? SecondaryButton : PrimaryButton;

                  return (
                    <AudioLocalModelRow
                      data-installed={modelInstalled ? "true" : "false"}
                      data-selected={modelSelected ? "true" : "false"}
                      key={modelId || model.modelName}
                    >
                      <AudioLocalModelCopy>
                        <strong>{formatWhisperModelTitle(model)}</strong>
                        <span>{model.description || formatWhisperModelMeta(model)}</span>
                        <AudioLocalModelMeta>
                          <AudioLocalModelPill>{formatWhisperModelMeta(model)}</AudioLocalModelPill>
                          <AudioLocalModelPill data-tone={modelInstalled ? "ready" : undefined}>
                            {modelInstalled ? (modelSelected ? "Selected" : "Downloaded") : "Not installed"}
                          </AudioLocalModelPill>
                        </AudioLocalModelMeta>
                      </AudioLocalModelCopy>
                      <AudioLocalModelActions>
                        <ModelActionButton
                          disabled={modelActionDisabled}
                          onClick={() => {
                            if (!modelId) {
                              return;
                            }
                            if (modelInstalled) {
                              selectLocalWhisperModel(modelId);
                            } else {
                              installLocalWhisperModel(modelId);
                            }
                          }}
                          type="button"
                        >
                          {modelInstalled && modelSelected ? (
                            <ButtonCheckIcon aria-hidden="true" />
                          ) : (
                            <ButtonMicIcon aria-hidden="true" />
                          )}
                          <span>
                            {modelDownloading
                              ? "Downloading..."
                              : modelInstalled
                                ? (modelSelected ? "Selected" : "Use")
                                : "Install"}
                          </span>
                        </ModelActionButton>
                      </AudioLocalModelActions>
                    </AudioLocalModelRow>
                  );
                })}
              </AudioLocalModelList>
            )}
            {(isCloudMode || isForgeMode) && (
              <AudioCloudField>
                Language
                <div style={{ width: "100%" }}>
                  <AppSelect
                    aria-label="Transcription language"
                    onChange={updateDeepgramLanguage}
                    options={DEEPGRAM_LANGUAGE_OPTIONS}
                    placeholder="English"
                    value={deepgramLanguage}
                  />
                </div>
              </AudioCloudField>
            )}
            {isCloudMode && (
              <>
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
                <AudioRecorderOptionRow>
                  <SettingsHint>
                    Deepgram Nova-3 streams push-to-talk audio over a live WebSocket.
                  </SettingsHint>
                  <AudioStatePill data-installed={deepgramReady}>
                    {deepgramReady ? "Key saved" : "Key required"}
                  </AudioStatePill>
                </AudioRecorderOptionRow>
              </>
            )}
            {(isForgeMode || isForgeAgentMode) && (
              <>
                <AudioRecorderOptionRow>
                  <SettingsHint>
                    {forgeBilling.state === "loading"
                      ? (isForgeAgentMode ? "Working.." : "Checking Diff Forge Cloud credits...")
                      : forgeBilling.state === "auth_required" || forgeBilling.state === "billing_error"
                        ? forgeBilling.error
                        : forgeCreditsExhausted
                          ? "No Diff Forge Cloud credits remaining. Top up to use cloud audio."
                          : isForgeAgentMode
                            ? "Streams mic audio to Diff Forge Cloud, runs the voice agent, and plays the response back here."
                            : "Realtime Nova-3 in Diff Forge Cloud. Billed from your credits: audio input, LLM cleanup, and transfer per MB."}
                  </SettingsHint>
                  {isForgeAgentMode && (
                    <SecondaryButton onClick={refreshForgeBilling} type="button">
                      <ButtonRefreshIcon aria-hidden="true" />
                      <span>{forgeBilling.state === "loading" ? "Working.." : "Recheck credits"}</span>
                    </SecondaryButton>
                  )}
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

          <AudioRecorderAttentionPanel aria-label="Recorder controls" ref={audioRecorderPanelRef}>
            {shouldHighlightAudioRecorder && (
              <AudioAttentionFlash
                aria-hidden="true"
                key={`audio-recorder-highlight-${audioHotkeyHighlight.id}`}
              />
            )}
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
          </AudioRecorderAttentionPanel>

        </AudioGeneralToolbar>

        <AudioShortcutSettingsPanel aria-label="Audio shortcut settings" ref={audioShortcutSettingsPanelRef}>
          {shouldHighlightAudioPermissions && (
            <AudioAttentionFlash
              aria-hidden="true"
              key={`audio-permissions-highlight-${audioHotkeyHighlight.id}`}
            />
          )}
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
        </AudioShortcutSettingsPanel>

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

        {activeAudioTab === "polishing" && (
          <AudioDictionaryPanel
            aria-labelledby="audio-tab-polishing"
            id="audio-tabpanel-polishing"
            role="tabpanel"
          >
            <AudioRulePanelHeader>
              <AudioRulePanelTitle>
                <strong>Polishing</strong>
              </AudioRulePanelTitle>
              <AudioRuleListActions>
                <SecondaryButton
                  disabled={polishingSystemPromptIsDefault}
                  onClick={restoreDefaultPolishingSystemPrompt}
                  title="Restore default polishing prompt"
                  type="button"
                >
                  <ButtonRefreshIcon aria-hidden="true" />
                  <span>Restore default</span>
                </SecondaryButton>
                <AudioStatePill data-installed={polishingSystemPrompt.trim() ? "true" : undefined}>
                  {Array.from(polishingSystemPrompt).length}/{MAX_AUDIO_POLISHING_SYSTEM_PROMPT_CHARS}
                </AudioStatePill>
              </AudioRuleListActions>
            </AudioRulePanelHeader>

            <AudioRuleEditorPanel as="section">
              <AudioRuleEditorBody>
                <AudioRuleFieldLabel>
                  <span>System prompt</span>
                  <AudioRuleTextarea
                    aria-label="Polishing system prompt"
                    maxLength={MAX_AUDIO_POLISHING_SYSTEM_PROMPT_CHARS}
                    onChange={updatePolishingSystemPrompt}
                    placeholder="Clean up dictated text while preserving the speaker's intent."
                    value={polishingSystemPrompt}
                  />
                  <AudioRuleFieldCaption>
                    {MAX_AUDIO_POLISHING_SYSTEM_PROMPT_CHARS - Array.from(polishingSystemPrompt).length} characters remaining
                  </AudioRuleFieldCaption>
                </AudioRuleFieldLabel>

                <AudioRuleFieldLabel>
                  <span>Cleanup model</span>
                  <McpTransportTabs aria-label="LLM cleanup model" data-columns="2" role="radiogroup">
                    {AUDIO_LLM_CLEANUP_ENGINE_OPTIONS.map((option) => (
                      <McpTransportButton
                        aria-checked={llmCleanupEngine === option.id}
                        data-active={llmCleanupEngine === option.id ? "true" : undefined}
                        key={option.id}
                        onClick={() => selectLlmCleanupEngine(option.id)}
                        role="radio"
                        type="button"
                      >
                        {option.label}
                      </McpTransportButton>
                    ))}
                  </McpTransportTabs>
                </AudioRuleFieldLabel>

                <AudioRuleStatusLine>
                  <McpSwitchButton
                    aria-checked={forgeLlmCleanup}
                    aria-pressed={forgeLlmCleanup}
                    onClick={toggleForgeLlmCleanup}
                    role="switch"
                    type="button"
                  >
                    <span aria-hidden="true" />
                    LLM cleanup
                  </McpSwitchButton>
                  <McpSwitchButton
                    aria-checked={manualPolishingEnabled}
                    aria-pressed={manualPolishingEnabled}
                    disabled
                    role="switch"
                    title="Manual polish is always enabled"
                    type="button"
                  >
                    <span aria-hidden="true" />
                    Manual polish
                  </McpSwitchButton>
                </AudioRuleStatusLine>
              </AudioRuleEditorBody>
            </AudioRuleEditorPanel>
          </AudioDictionaryPanel>
        )}

        {isVoiceRuleTab && (
          <AudioDictionaryPanel
            aria-labelledby={`audio-tab-${activeAudioTab}`}
            id={`audio-tabpanel-${activeAudioTab}`}
            role="tabpanel"
          >
            {voiceRuleEditor?.kind === activeAudioTab ? (
              <AudioRuleEditorPanel as="form" onSubmit={saveVoiceRuleEditor}>
                <AudioRuleEditorHeader>
                  <SecondaryButton onClick={closeVoiceRuleEditor} type="button">
                    <ButtonBackIcon aria-hidden="true" />
                    <span>Back</span>
                  </SecondaryButton>
                  <AudioRuleEditorTitle>
                    <strong>{editorTitle}</strong>
                    <span aria-live="polite">{editorStatus}</span>
                  </AudioRuleEditorTitle>
                  <PrimaryButton
                    disabled={!voiceRuleEditorCanSave || voiceRuleSaveState === "saving"}
                    type="submit"
                  >
                    <ButtonCheckIcon aria-hidden="true" />
                    <span>{voiceRuleSaveState === "saving" ? "Saving..." : "Save"}</span>
                  </PrimaryButton>
                </AudioRuleEditorHeader>

                <AudioRuleEditorBody>
                  {voiceRuleEditor.kind === "dictionary" && (
                    <>
                      <AudioDictionaryNameSearchRow>
                        <AudioRuleFieldLabel>
                          <span>List name</span>
                          <AudioCloudInput
                            aria-label="Word list name"
                            onChange={(event) => updateVoiceRuleEditorDraft({ name: event.target.value })}
                            placeholder="List name"
                            value={editorDraft.name || ""}
                          />
                        </AudioRuleFieldLabel>
                        <AudioRuleFieldLabel>
                          <span>Search words</span>
                          <AudioCloudInput
                            aria-label="Search words"
                            onChange={(event) => updateVoiceRuleEditorDraft({ termSearch: event.target.value })}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                              }
                            }}
                            placeholder="Search words"
                            value={editorDraft.termSearch || ""}
                          />
                        </AudioRuleFieldLabel>
                      </AudioDictionaryNameSearchRow>
                      <AudioRuleFieldLabel as="div">
                        <span>Words</span>
                        <AudioDictionaryWordListFrame>
                          <AudioDictionaryWordList
                            aria-label="Word list terms"
                            onScroll={updateDictionaryWordListBottomState}
                            ref={dictionaryWordListRef}
                            role="list"
                          >
                            {visibleVoiceRuleEditorTerms.length ? (
                              visibleVoiceRuleEditorTerms.map((term) => (
                                <AudioDictionaryWordRow key={term} role="listitem">
                                  <AudioDictionaryWordText title={term}>{term}</AudioDictionaryWordText>
                                  <AudioDictionaryWordDeleteButton
                                    aria-label={`Delete word ${term}`}
                                    onClick={() => removeDictionaryEditorTerm(term)}
                                    type="button"
                                  >
                                    <ButtonDeleteIcon aria-hidden="true" />
                                  </AudioDictionaryWordDeleteButton>
                                </AudioDictionaryWordRow>
                              ))
                            ) : (
                              <AudioDictionaryWordEmpty>
                                {voiceRuleEditorTerms.length
                                  ? "No words match your search."
                                  : "Type below, then press Enter."}
                              </AudioDictionaryWordEmpty>
                            )}
                            <AudioDictionaryWordComposerRow role="listitem">
                              <AudioDictionaryWordInput
                                aria-label="Type a word and press Enter"
                                onChange={(event) => updateVoiceRuleEditorDraft({ termInput: event.target.value })}
                                onKeyDown={handleDictionaryTermInputKeyDown}
                                placeholder="Type word and press Enter"
                                spellCheck="true"
                                type="text"
                                value={editorDraft.termInput || ""}
                              />
                            </AudioDictionaryWordComposerRow>
                          </AudioDictionaryWordList>
                          {dictionaryWordListNeedsBottomJump && (
                            <AudioDictionaryBottomJumpButton
                              aria-label="Jump to bottom of word list"
                              onClick={() => scrollDictionaryWordListToBottom("smooth")}
                              title="Jump to bottom"
                              type="button"
                            >
                              <FileExpandIcon aria-hidden="true" />
                            </AudioDictionaryBottomJumpButton>
                          )}
                        </AudioDictionaryWordListFrame>
                        <AudioRuleFieldCaption>
                          {voiceRuleEditorTermSearch
                            ? `${visibleVoiceRuleEditorTerms.length} of ${voiceRuleEditorTerms.length}`
                            : voiceRuleEditorTerms.length} {voiceRuleEditorTerms.length === 1 ? "word" : "words"}
                        </AudioRuleFieldCaption>
                      </AudioRuleFieldLabel>
                      <AudioRuleStatusLine>
                        <McpSwitchButton
                          aria-checked={editorDraft.selected !== false}
                          aria-pressed={editorDraft.selected !== false}
                          onClick={() => updateVoiceRuleEditorDraft({ selected: editorDraft.selected === false })}
                          role="switch"
                          type="button"
                        >
                          <span aria-hidden="true" />
                          Active
                        </McpSwitchButton>
                      </AudioRuleStatusLine>
                    </>
                  )}

                  {voiceRuleEditor.kind === "snippets" && (
                    <>
                      <AudioRuleFieldLabel>
                        <span>Trigger</span>
                        <AudioCloudInput
                          aria-label="Snippet trigger"
                          onChange={(event) => updateVoiceRuleEditorDraft({ trigger: event.target.value })}
                          placeholder="gstack"
                          value={editorDraft.trigger || ""}
                        />
                      </AudioRuleFieldLabel>
                      <AudioRuleFieldLabel>
                        <span>Expansion</span>
                        <AudioRuleTextarea
                          aria-label="Snippet expansion"
                          onChange={(event) => updateVoiceRuleEditorDraft({ expansion: event.target.value })}
                          placeholder="Full text"
                          value={editorDraft.expansion || ""}
                        />
                      </AudioRuleFieldLabel>
                      <AudioRuleStatusLine>
                        <McpSwitchButton
                          aria-checked={editorDraft.enabled !== false}
                          aria-pressed={editorDraft.enabled !== false}
                          onClick={() => updateVoiceRuleEditorDraft({ enabled: editorDraft.enabled === false })}
                          role="switch"
                          type="button"
                        >
                          <span aria-hidden="true" />
                          Active
                        </McpSwitchButton>
                      </AudioRuleStatusLine>
                    </>
                  )}

                  {voiceRuleEditor.kind === "transforms" && (
                    <>
                      <AudioRuleFieldLabel>
                        <span>Match</span>
                        <AudioCloudInput
                          aria-label="Transform match"
                          onChange={(event) => updateVoiceRuleEditorDraft({ match: event.target.value })}
                          placeholder={editorDraft.isRegex ? "bug (\\d+)" : "new line"}
                          value={editorDraft.match || ""}
                        />
                      </AudioRuleFieldLabel>
                      <AudioRuleFieldLabel>
                        <span>Replacement</span>
                        <AudioRuleTextarea
                          aria-label="Transform replacement"
                          onChange={(event) => updateVoiceRuleEditorDraft({ replacement: event.target.value })}
                          placeholder={editorDraft.isRegex ? "BUG-$1" : "Replacement"}
                          value={editorDraft.replacement || ""}
                        />
                      </AudioRuleFieldLabel>
                      <AudioRuleStatusLine>
                        <McpSwitchButton
                          aria-checked={editorDraft.enabled !== false}
                          aria-pressed={editorDraft.enabled !== false}
                          onClick={() => updateVoiceRuleEditorDraft({ enabled: editorDraft.enabled === false })}
                          role="switch"
                          type="button"
                        >
                          <span aria-hidden="true" />
                          Active
                        </McpSwitchButton>
                        <McpSwitchButton
                          aria-checked={editorDraft.isRegex === true}
                          aria-pressed={editorDraft.isRegex === true}
                          onClick={() => updateVoiceRuleEditorDraft({ isRegex: editorDraft.isRegex !== true })}
                          role="switch"
                          type="button"
                        >
                          <span aria-hidden="true" />
                          Regex
                        </McpSwitchButton>
                      </AudioRuleStatusLine>
                    </>
                  )}
                </AudioRuleEditorBody>
              </AudioRuleEditorPanel>
            ) : (
              <>
                <AudioRulePanelHeader>
                  <AudioRulePanelTitle>
                    <strong>{activeVoiceRuleTitle}</strong>
                  </AudioRulePanelTitle>
                  <SecondaryButton
                    aria-label={activeVoiceRuleAddLabel}
                    onClick={() => openVoiceRuleEditor(activeAudioTab)}
                    title={activeVoiceRuleAddLabel}
                    type="button"
                  >
                    <ButtonAddIcon aria-hidden="true" />
                  </SecondaryButton>
                </AudioRulePanelHeader>

                {activeVoiceRuleEntries.length ? (
                  <AudioDictionaryList>
                    {activeVoiceRuleEntries.map((entry) => {
                      const isDictionaryEntry = activeAudioTab === "dictionary";
                      const isSnippetEntry = activeAudioTab === "snippets";
                      const isTransformEntry = activeAudioTab === "transforms";
                      const enabled = isDictionaryEntry ? entry.selected !== false : entry.enabled !== false;
                      const entryTitle = isDictionaryEntry
                        ? (entry.name || "Untitled list")
                        : isSnippetEntry
                          ? (entry.trigger || "Untitled snippet")
                          : (entry.match || "Untitled transform");
                      const transformReplacementPreview = isTransformEntry
                        ? String(entry.replacement || "")
                          .replace(/\n/g, "\\n")
                          .replace(/\t/g, "\\t")
                        : "";
                      const entryMeta = isDictionaryEntry
                        ? `${(entry.terms || []).length} ${(entry.terms || []).length === 1 ? "word" : "words"}`
                        : isSnippetEntry
                          ? (entry.expansion || "No expansion")
                          : transformReplacementPreview
                            ? `-> ${transformReplacementPreview}`
                            : "Removes matching text";
                      const togglePatch = isDictionaryEntry
                        ? { selected: entry.selected === false }
                        : { enabled: entry.enabled === false };
                      const toggleLabel = enabled
                        ? `Pause ${entryTitle}`
                        : `Activate ${entryTitle}`;
                      const deleteLabel = isDictionaryEntry
                        ? `Delete word list ${entryTitle}`
                        : isSnippetEntry
                          ? `Delete snippet ${entryTitle}`
                          : `Delete transform ${entryTitle}`;

                      return (
                        <AudioRuleListItem
                          data-disabled={!enabled ? "true" : undefined}
                          key={entry.id}
                          onClick={() => openVoiceRuleEditor(activeAudioTab, entry)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openVoiceRuleEditor(activeAudioTab, entry);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <AudioRuleToggle
                            aria-checked={enabled}
                            aria-label={toggleLabel}
                            aria-pressed={enabled}
                            onClick={(event) => {
                              event.stopPropagation();
                              updateVoiceRuleEntry(activeAudioTab, entry.id, togglePatch);
                            }}
                            onKeyDown={(event) => event.stopPropagation()}
                            role="switch"
                            type="button"
                          />
                          <AudioRuleListText>
                            <AudioRuleListTitle>{entryTitle}</AudioRuleListTitle>
                            <AudioRuleListMeta>{entryMeta}</AudioRuleListMeta>
                          </AudioRuleListText>
                          <AudioRuleListActions onClick={(event) => event.stopPropagation()}>
                            {isTransformEntry && entry.isRegex === true && (
                              <AudioDictionaryMetaPill>Regex</AudioDictionaryMetaPill>
                            )}
                            <AudioDictionaryMetaPill data-active={enabled ? "true" : "false"}>
                              {enabled ? "Active" : "Paused"}
                            </AudioDictionaryMetaPill>
                            <AudioRuleIconButton
                              aria-label={deleteLabel}
                              onClick={() => removeVoiceRuleEntry(activeAudioTab, entry.id)}
                              onKeyDown={(event) => event.stopPropagation()}
                              type="button"
                            >
                              <ButtonDeleteIcon aria-hidden="true" />
                            </AudioRuleIconButton>
                          </AudioRuleListActions>
                        </AudioRuleListItem>
                      );
                    })}
                  </AudioDictionaryList>
                ) : (
                  <AudioDictionaryEmpty>
                    <strong>{activeVoiceRuleEmptyTitle}</strong>
                    <SecondaryButton
                      aria-label={activeVoiceRuleAddLabel}
                      onClick={() => openVoiceRuleEditor(activeAudioTab)}
                      type="button"
                    >
                      <ButtonAddIcon aria-hidden="true" />
                      <span>{activeVoiceRuleAddLabel}</span>
                    </SecondaryButton>
                  </AudioDictionaryEmpty>
                  )}
              </>
            )}

            {voiceRulesError && <FormMessage $state="error">{voiceRulesError}</FormMessage>}
          </AudioDictionaryPanel>
        )}

        {activeAudioTab === "history" && (
          <AudioHistoryPanel
            aria-labelledby="audio-tab-history"
            id="audio-tabpanel-history"
            role="tabpanel"
          >
            <AudioHistoryStats aria-label="Speech to text statistics">
              <AudioInsightCard
                aria-label={`Average words per minute${
                  audioWpmPercentileLabel(audioHistoryInsights.averageWpm)
                    ? `, ${audioWpmPercentileLabel(audioHistoryInsights.averageWpm)} of speakers`
                    : ""
                }`}
              >
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
                  {audioWpmPercentileLabel(audioHistoryInsights.averageWpm) && (
                    <text className="tier" textAnchor="middle" x="50" y="49">
                      {audioWpmPercentileLabel(audioHistoryInsights.averageWpm).toUpperCase()}
                    </text>
                  )}
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

            {!audioHistoryReady ? (
              <SettingsHint>Loading speech to text history…</SettingsHint>
            ) : audioHistoryTotal > 0 ? (
              <AudioHistoryVirtualList
                aria-label="Speech to text history"
                onScroll={handleAudioHistoryScroll}
                ref={audioHistoryViewportRef}
                role="list"
              >
                <AudioHistoryList
                  style={{
                    height: `${Math.max(audioHistoryWindow.totalHeight, 1)}px`,
                  }}
                >
                  {audioHistoryWindow.items.map((item) => {
                    if (item.kind === "placeholder") {
                      return (
                        <AudioHistoryRow
                          aria-hidden="true"
                          data-skeleton="true"
                          key={item.key}
                          role="presentation"
                          style={{
                            height: `${AUDIO_HISTORY_ESTIMATED_ROW_HEIGHT}px`,
                            left: 0,
                            position: "absolute",
                            right: 0,
                            top: 0,
                            transform: `translateY(${item.top}px)`,
                          }}
                        />
                      );
                    }

                    const { row, top } = item;
                    const copied = copiedAudioHistoryId === row.entryKey;
                    const expanded = expandedAudioHistoryIds.has(row.entryKey);
                    const entering = enteringAudioHistoryKeys.has(row.entryKey);

                    return (
                      <AudioHistoryVirtualRow
                        copied={copied}
                        entering={entering}
                        expanded={expanded}
                        key={row.entryKey}
                        onCopy={copyAudioHistoryPrompt}
                        onMeasure={measureAudioHistoryRow}
                        onToggle={toggleAudioHistoryExpanded}
                        onVariantStep={stepAudioHistoryVariant}
                        row={row}
                        top={top}
                        totalCount={audioHistoryTotal}
                      />
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
  const [widgetHistory, setWidgetHistory] = useState(readAudioTranscriptionHistory);
  const [historyTrayOpen, setHistoryTrayOpen] = useState(false);
  const [historyTrayClosing, setHistoryTrayClosing] = useState(false);
  const [widgetDragging, setWidgetDragging] = useState(false);
  const [copiedWidgetHistorySlot, setCopiedWidgetHistorySlot] = useState("");
  const [polishStatus, setPolishStatus] = useState({ state: "idle", error: "" });
  const widgetManualPolishingEnabled = readAudioManualPolishingEnabled();
  const [forgeCloudConnected, setForgeCloudConnected] = useState(false);
  const [barIdleHover, setBarIdleHover] = useState(false);
  const [bubbleHover, setBubbleHover] = useState(false);
  const [barPlacementReadyKey, setBarPlacementReadyKey] = useState("");
  const audioBufferRef = useRef(null);
  const audioBufferGenerationRef = useRef(0);
  const audioBufferReadyAtRef = useRef(0);
  const audioBufferStartRef = useRef(null);
  const audioCaptureTeardownRef = useRef(null);
  const pushToTalkDownRef = useRef(false);
  const suppressPushToTalkUntilReleaseRef = useRef(false);
  const recordingRunRef = useRef(0);
  const stopAfterStartRef = useRef(false);
  const forgeVoiceStartPendingRunRef = useRef(0);
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
  const barPositionAnimationRef = useRef({ frame: 0, token: 0 });
  const barPlacementGenerationRef = useRef(0);
  const barPlacementReadyKeyRef = useRef("");
  const barNativePlacementPendingRef = useRef(null);
  const barNativePlacementFallbackTimerRef = useRef(0);
  const widgetFrameModeRef = useRef(widgetFrameMode);
  const widgetStateRef = useRef(widgetState);
  const historyTrayCloseTimerRef = useRef(0);
  const historyTrayExitTimerRef = useRef(0);
  const historyTrayOpenRef = useRef(false);
  const historyTrayClosingRef = useRef(false);
  const bubbleHistoryTrayActiveRef = useRef(false);
  const bubbleHistoryTrayHoverRef = useRef(false);
  const bubbleHistoryTrayPolishPinnedRef = useRef(false);
  const bubbleHistoryTrayCloseDeferredRef = useRef(false);
  const widgetDraggingRef = useRef(false);
  const barIdleHoverRef = useRef(false);
  const bubbleHoverRef = useRef(false);
  const barIdleModeRef = useRef(false);
  const canUseBubbleHistoryTrayRef = useRef(false);
  const widgetDragSettleTimerRef = useRef(0);
  const widgetDragSettleRunRef = useRef(0);
  const widgetDragPositionSampleTimerRef = useRef(0);
  const widgetDragReleaseSeenRef = useRef(false);
  const historyTrayCloseAfterDragRef = useRef(false);
  const copiedWidgetHistoryTimerRef = useRef(0);
  const polishStatusTimerRef = useRef(0);
  const forgeCloudConnectedRef = useRef(false);
  const forgeVoiceClientSessionIdRef = useRef("");
  const forgeVoiceEventsActiveRef = useRef(false);
  const forgeVoiceServerSessionIdRef = useRef("");
  const forgeVoiceTtsPlayerRef = useRef(null);
  const localWhisperPartialSessionIdRef = useRef("");
  const localWhisperPartialHistoryIdRef = useRef("");
  const localWhisperPartialFailedRef = useRef(false);
  const localWhisperPartialTextRef = useRef("");
  // GPT-Realtime interim transcripts are token deltas, not cumulative
  // phrases; the live line accumulates them here between turn boundaries.
  const forgeVoiceRealtimeDraftRef = useRef("");
  const forgeDictationHistoryRef = useRef(null);
  widgetStyleRef.current = widgetStyle;

  const setBarIdleHoverState = useCallback((nextHovering) => {
    const hovering = Boolean(nextHovering);
    barIdleHoverRef.current = hovering;
    setBarIdleHover((current) => (current === hovering ? current : hovering));
  }, []);

  const setBubbleHoverState = useCallback((nextHovering) => {
    const hovering = Boolean(nextHovering);
    bubbleHoverRef.current = hovering;
    setBubbleHover((current) => (current === hovering ? current : hovering));
  }, []);

  const setForgeCloudConnectionState = useCallback((connected) => {
    const nextConnected = Boolean(connected);
    forgeCloudConnectedRef.current = nextConnected;
    setForgeCloudConnected((current) => (
      current === nextConnected ? current : nextConnected
    ));
  }, []);

  const getForgeVoiceControlRequest = useCallback(() => ({
    clientSessionId: forgeVoiceClientSessionIdRef.current,
    ownerId: AUDIO_WIDGET_VOICE_OWNER,
    voiceSessionId: forgeVoiceServerSessionIdRef.current,
  }), []);

  useEffect(() => {
    widgetStateRef.current = widgetState;
  }, [widgetState]);

  useEffect(() => {
    forgeCloudConnectedRef.current = forgeCloudConnected;
  }, [forgeCloudConnected]);

  useEffect(() => {
    barIdleHoverRef.current = barIdleHover;
  }, [barIdleHover]);

  useEffect(() => {
    bubbleHoverRef.current = bubbleHover;
  }, [bubbleHover]);

  useEffect(() => {
    recorderModeRef.current = recorderMode;
  }, [recorderMode]);

  useEffect(() => {
    widgetStyleRef.current = widgetStyle;
  }, [widgetStyle]);

  useEffect(() => {
    widgetDraggingRef.current = widgetDragging;
  }, [widgetDragging]);

  useEffect(() => {
    applyAudioWidgetThemePreference(audioWidgetTheme);
  }, [audioWidgetTheme]);

  useEffect(() => {
    let disposed = false;
    let unlistenSyncStatus = () => {};

    const applyStatus = (status) => {
      if (!disposed) {
        setForgeCloudConnectionState(forgeCloudStatusIsConnected(status));
      }
    };

    const refresh = () => {
      invoke("cloud_mcp_get_status")
        .then(applyStatus)
        .catch(() => {
          if (!disposed) {
            setForgeCloudConnectionState(false);
          }
        });
    };

    refresh();
    const timer = window.setInterval(() => {
      // The sync-status event below updates this on real changes, so skip the
      // poll while the widget window is hidden or unfocused (idle energy).
      if (typeof document !== "undefined"
        && (document.visibilityState === "hidden"
          || (typeof document.hasFocus === "function" && !document.hasFocus()))) {
        return;
      }
      refresh();
    }, AUDIO_WIDGET_CLOUD_STATUS_POLL_MS);
    listen(CLOUD_MCP_SYNC_STATUS_EVENT, (event) => {
      applyStatus(event?.payload);
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlistenSyncStatus = nextUnlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      window.clearInterval(timer);
      unlistenSyncStatus();
    };
  }, [setForgeCloudConnectionState]);

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
    localWhisperPartialSessionIdRef.current = "";
    localWhisperPartialHistoryIdRef.current = "";
    localWhisperPartialFailedRef.current = false;
    localWhisperPartialTextRef.current = "";

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
      setMessage("Install a local Whisper model from the Audio tab.");
      return;
    }

    widgetStateRef.current = hasSetup ? "ready" : "setup";
    setWidgetState(hasSetup ? "ready" : "setup");
    setMessage(hasSetup ? "Model ready" : "Audio setup needed");
  }, [modelStatus?.installed]);

  const startWarmBuffer = useCallback(async ({ notifyOnPermissionError = true } = {}) => {
    if (audioBufferRef.current) {
      return audioBufferRef.current;
    }

    if (audioBufferStartRef.current) {
      return audioBufferStartRef.current;
    }

    const permissionStatus = await getAudioInputPermissionStatus().catch(() => null);
    if (audioInputPermissionNeedsAttention(permissionStatus)) {
      clearAudioInputSetupReady();
      const message = permissionStatus?.message || "Enable Microphone access for Diff Forge AI in System Settings.";
      if (notifyOnPermissionError) {
        emitAudioHotkeyAttention(
          "microphone-permission",
          ["input", "microphone"],
          message,
        );
      }
      throw new Error(message);
    }

    if (!hasAudioInputSetup()) {
      emitAudioHotkeyAttention(
        "input",
        ["input"],
        "Initialize a microphone in the Audio tab before recording.",
      );
      throw new Error("Choose and enable a microphone in the Audio tab before recording.");
    }

    const bufferGeneration = audioBufferGenerationRef.current;
    setMessage("Buffering input");
    const startPromise = (async () => {
      const audioBuffer = await startLowPowerAudioBuffer({
        deviceId: readSelectedAudioInputDeviceId(),
        owner: "audio-widget",
        // The idle widget never displays the live level (widgetLevel is only
        // read while recording), so applying every stats event just re-renders
        // the widget for nothing. Only feed the meter while actually recording.
        onStats: (stats) => {
          if (widgetStateRef.current === "recording") {
            setWidgetAudioStats(stats);
          }
        },
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

  const trackAudioCaptureTeardown = useCallback((teardownPromise) => {
    const trackedPromise = Promise.resolve(teardownPromise).catch(() => null);
    audioCaptureTeardownRef.current = trackedPromise;
    trackedPromise.finally(() => {
      if (audioCaptureTeardownRef.current === trackedPromise) {
        audioCaptureTeardownRef.current = null;
      }
    });
    return trackedPromise;
  }, []);

  const waitForAudioCaptureTeardown = useCallback(async () => {
    const teardownPromise = audioCaptureTeardownRef.current;
    if (teardownPromise) {
      await teardownPromise.catch(() => null);
    }
  }, []);

  const releaseOrPreserveFailedAudioBuffer = useCallback(async (failedAudioBuffer, failure) => {
    if (!failedAudioBuffer) {
      return false;
    }

    const isCurrentWarmBuffer = audioBufferRef.current === failedAudioBuffer;
    if (isCurrentWarmBuffer && !audioInputErrorRequiresFreshWarmBuffer(failure)) {
      audioBufferReadyAtRef.current = Date.now();
      return true;
    }

    if (isCurrentWarmBuffer) {
      await closeWarmBuffer();
    } else {
      await failedAudioBuffer.close?.().catch(() => {});
    }

    return false;
  }, [closeWarmBuffer]);

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
      emitAudioHotkeyAttention(
        "input",
        ["input"],
        "Initialize a microphone in the Audio tab before recording.",
      );
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
      setError("Install a local Whisper model from the Audio tab before recording.");
      return;
    }

    if (currentState === "checking" || currentState === "warming") {
      return;
    }

    const recordingRunId = recordingRunRef.current + 1;
    recordingRunRef.current = recordingRunId;
    forgeDictationHistoryRef.current = currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
      ? {
        createdAt: new Date().toISOString(),
        id: `forge-dictation-${Date.now()}-${recordingRunId}`,
      }
      : null;
    localWhisperPartialSessionIdRef.current = "";
    localWhisperPartialHistoryIdRef.current = "";
    localWhisperPartialFailedRef.current = false;
    localWhisperPartialTextRef.current = "";
    setError("");
    setFinishPending(false);
    setMessage(currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT ? "Starting.." : "Arming buffer");
    setRealtimeTranscript("");
    setWidgetAudioStats(EMPTY_AUDIO_INPUT_STATS);
    widgetStateRef.current = "arming";
    setWidgetState("arming");

    let audioBuffer = null;
    let captureBegan = false;

    try {
      await waitForAudioCaptureTeardown();
      if (recordingRunRef.current !== recordingRunId) {
        return;
      }
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
      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_LOCAL) {
        const partialSessionId = `local-whisper-${Date.now()}-${recordingRunId}`;
        const partialHistoryId = `local-whisper-history-${Date.now()}-${recordingRunId}`;
        try {
          await startLocalWhisperPartialTranscription({
            historyId: partialHistoryId,
            maxChunkMs: 35000,
            minChunkMs: 10000,
            sessionId: partialSessionId,
            silenceMs: 750,
          });
          localWhisperPartialSessionIdRef.current = partialSessionId;
          localWhisperPartialHistoryIdRef.current = partialHistoryId;
        } catch {
          localWhisperPartialFailedRef.current = true;
          localWhisperPartialSessionIdRef.current = "";
          localWhisperPartialHistoryIdRef.current = "";
        }
      }
      if (recordingRunRef.current !== recordingRunId) {
        await audioBuffer.finishCapture({ decode: false }).catch(() => null);
        if (localWhisperPartialSessionIdRef.current) {
          await cancelLocalWhisperPartialTranscription({
            sessionId: localWhisperPartialSessionIdRef.current,
          }).catch(() => {});
          localWhisperPartialSessionIdRef.current = "";
        }
        if (audioBufferRef.current === audioBuffer) {
          await closeWarmBuffer();
        } else {
          await audioBuffer.close().catch(() => {});
        }
        return;
      }
      setRecordingStartedAt(Date.now());
      setElapsedMs(0);
      const waitsForCloudStart = currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD;
      if (!waitsForCloudStart) {
        widgetStateRef.current = "recording";
        setWidgetState("recording");
      }
      playNotificationSfx("voice.on");
      setMessage(currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
        ? "Opening Deepgram stream"
        : currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
          ? "Recording"
          : currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
            ? "Forge voice listening"
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
        setMessage("Recording");
        const forgeHistory = forgeDictationHistoryRef.current;
        await invoke("start_forge_dictation_transcription", {
          request: {
            historyCreatedAt: forgeHistory?.createdAt || "",
            historyId: forgeHistory?.id || "",
            llmCleanup: readForgeLlmCleanup(),
            language: readDeepgramLanguage(),
            polishingPrompt: readAutomaticCleanupPolishingPrompt(),
            ...readAudioLlmCleanupRequestOptions(),
          },
        });
      } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
        await resetForgeVoiceTtsPlayer();
        const clientSessionId = `audio-widget-${Date.now()}-${recordingRunId}`;
        forgeVoiceClientSessionIdRef.current = clientSessionId;
        forgeVoiceServerSessionIdRef.current = "";
        forgeVoiceEventsActiveRef.current = true;
        forgeVoiceStartPendingRunRef.current = recordingRunId;
        try {
          const startResult = await startCloudVoiceAgentStream({
            clientSessionId,
            ownerId: AUDIO_WIDGET_VOICE_OWNER,
            realtime: readOrchestratorRealtimeEnabled(),
            submissionMode: readOrchestratorVoiceSubmissionMode(),
          });
          forgeVoiceServerSessionIdRef.current = String(
            startResult?.voiceSessionId
              || startResult?.voice_session_id
              || "",
          ).trim();
        } finally {
          if (forgeVoiceStartPendingRunRef.current === recordingRunId) {
            forgeVoiceStartPendingRunRef.current = 0;
          }
        }
      }
      if (recordingRunRef.current !== recordingRunId) {
        if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
          await invoke("stop_deepgram_realtime_transcription").catch(() => {});
        } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE) {
          await invoke("stop_forge_dictation_transcription", { request: { cancel: true } }).catch(() => {});
        } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
          if (forgeVoiceStartPendingRunRef.current === recordingRunId) {
            forgeVoiceStartPendingRunRef.current = 0;
          }
          forgeVoiceEventsActiveRef.current = false;
          await stopCloudVoiceAgentStream(getForgeVoiceControlRequest()).catch(() => {});
        }
        await audioBuffer.finishCapture({ decode: false }).catch(() => null);
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
          ? "Recording"
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
        if (forgeVoiceStartPendingRunRef.current === recordingRunId) {
          forgeVoiceStartPendingRunRef.current = 0;
        }
        forgeVoiceEventsActiveRef.current = false;
        await stopCloudVoiceAgentStream(getForgeVoiceControlRequest()).catch(() => {});
      }
      const failedAudioBuffer = audioBuffer;
      if (localWhisperPartialSessionIdRef.current) {
        await cancelLocalWhisperPartialTranscription({
          sessionId: localWhisperPartialSessionIdRef.current,
        }).catch(() => {});
        localWhisperPartialSessionIdRef.current = "";
      }
      if (captureBegan) {
        await failedAudioBuffer?.finishCapture?.({ decode: false }).catch(() => null);
        playNotificationSfx("voice.off");
      }
      await releaseOrPreserveFailedAudioBuffer(failedAudioBuffer, recordingError);
      if (recordingRunRef.current !== recordingRunId) {
        return;
      }
      pushToTalkDownRef.current = false;
      stopAfterStartRef.current = false;
      const recordingErrorText = String(recordingError?.message || recordingError || "").toLowerCase();
      if (recordingErrorText.includes("permission") || recordingErrorText.includes("denied")) {
        clearAudioInputSetupReady();
        emitAudioHotkeyAttention(
          "microphone-permission",
          ["input", "microphone"],
          getAudioInputErrorMessage(recordingError, "Enable Microphone access for Diff Forge AI in System Settings."),
        );
      }
      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(getAudioInputErrorMessage(recordingError, "Choose and enable a microphone in the Audio tab before recording."));
    }
  }, [modelStatus?.installed, releaseOrPreserveFailedAudioBuffer, resetForgeVoiceTtsPlayer, startWarmBuffer, waitForAudioCaptureTeardown, waitForWarmPrerollBuffer]);

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
        setMessage("Install a local Whisper model from the Audio tab.");
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

  const saveBubblePlacementFromWindow = useCallback(async (windowHandle) => {
    if (widgetStyleRef.current === AUDIO_WIDGET_STYLE_BAR) {
      logAudioWidgetBubblePosition("audio.widget.bubble.placement.save.skipped_bar", {});
      return null;
    }

    const [position, size] = await Promise.all([
      windowHandle.outerPosition().catch(() => null),
      windowHandle.outerSize?.().catch(() => null),
    ]);
    const monitor = await resolveAudioWidgetBubbleClampMonitor(position);
    const clamped = clampAudioWidgetBubblePlacementToMonitor(position, monitor, size);
    if (audioWidgetBubblePlacementChanged(position, clamped)) {
      await windowHandle.setPosition(new PhysicalPosition(clamped.x, clamped.y)).catch(() => {});
    }
    const saved = writeAudioWidgetBubblePlacement(clamped);
    logAudioWidgetBubblePosition("audio.widget.bubble.placement.save_from_window", {
      clamped,
      monitor: audioWidgetBubblePositionMonitorPayload(monitor),
      nativePosition: audioWidgetBubblePositionPoint(position),
      nativeSize: audioWidgetBubblePositionSize(size),
      saved,
      wasClamped: audioWidgetBubblePlacementChanged(position, clamped),
      widgetState: widgetStateRef.current,
    });
    return saved;
  }, []);

  const cancelBarPositionAnimation = useCallback(() => {
    const animation = barPositionAnimationRef.current;
    animation.token += 1;
    if (
      animation.frame
      && typeof window !== "undefined"
      && typeof window.cancelAnimationFrame === "function"
    ) {
      window.cancelAnimationFrame(animation.frame);
    }
    animation.frame = 0;
  }, []);

  const clearWidgetDragPositionSample = useCallback(() => {
    if (
      widgetDragPositionSampleTimerRef.current
      && typeof window !== "undefined"
      && typeof window.clearTimeout === "function"
    ) {
      window.clearTimeout(widgetDragPositionSampleTimerRef.current);
    }
    widgetDragPositionSampleTimerRef.current = 0;
  }, []);

  const startWidgetDragPositionSample = useCallback((windowHandle, pointer) => {
    clearWidgetDragPositionSample();
    let sampleIndex = 0;

    const sample = async () => {
      if (!widgetDraggingRef.current || widgetStyleRef.current === AUDIO_WIDGET_STYLE_BAR) {
        widgetDragPositionSampleTimerRef.current = 0;
        return;
      }

      const position = await windowHandle.outerPosition().catch(() => null);
      const size = await windowHandle.outerSize?.().catch(() => null);
      logAudioWidgetBubblePosition("audio.widget.bubble.drag.position_sample", {
        nativePosition: audioWidgetBubblePositionPoint(position),
        nativeSize: audioWidgetBubblePositionSize(size),
        pointer,
        sampleIndex,
        widgetState: widgetStateRef.current,
      });
      sampleIndex += 1;

      if (
        widgetDraggingRef.current
        && typeof window !== "undefined"
        && typeof window.setTimeout === "function"
      ) {
        widgetDragPositionSampleTimerRef.current = window.setTimeout(
          sample,
          AUDIO_WIDGET_BUBBLE_DRAG_DEBUG_SAMPLE_MS,
        );
      }
    };

    sample();
  }, [clearWidgetDragPositionSample]);

  const waitForWidgetDragStablePosition = useCallback(async (windowHandle, settleRun) => {
    const startedAt = typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
    let previousPosition = null;
    let stableSamples = 0;
    let sampleIndex = 0;
    let lastPosition = null;
    let lastSize = null;

    const now = () => (
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now()
    );
    const wait = (delayMs) => new Promise((resolve) => {
      window.setTimeout(resolve, delayMs);
    });

    while (widgetDragSettleRunRef.current === settleRun) {
      const [position, size] = await Promise.all([
        windowHandle.outerPosition().catch(() => null),
        windowHandle.outerSize?.().catch(() => null),
      ]);
      const normalizedPosition = audioWidgetBubblePositionPoint(position);
      lastPosition = position;
      lastSize = size;

      if (
        normalizedPosition
        && previousPosition
        && normalizedPosition.x === previousPosition.x
        && normalizedPosition.y === previousPosition.y
      ) {
        stableSamples += 1;
      } else {
        stableSamples = normalizedPosition ? 1 : 0;
      }

      logAudioWidgetBubblePosition("audio.widget.bubble.drag.settle_sample", {
        nativePosition: normalizedPosition,
        nativeSize: audioWidgetBubblePositionSize(size),
        sampleIndex,
        settleRun,
        stableSamples,
      });

      if (normalizedPosition && stableSamples >= AUDIO_WIDGET_BUBBLE_DRAG_SETTLE_STABLE_SAMPLES) {
        return {
          position: lastPosition,
          sampleIndex,
          size: lastSize,
          stable: true,
        };
      }

      if (now() - startedAt >= AUDIO_WIDGET_BUBBLE_DRAG_SETTLE_MAX_MS) {
        return {
          position: lastPosition,
          sampleIndex,
          size: lastSize,
          stable: false,
        };
      }

      previousPosition = normalizedPosition;
      sampleIndex += 1;
      await wait(AUDIO_WIDGET_BUBBLE_DRAG_SETTLE_SAMPLE_MS);
    }

    return null;
  }, []);

  const setAudioBarWindowPosition = useCallback(async (windowHandle, target, animate = true) => {
    const targetX = Math.round(target.x);
    const targetY = Math.round(target.y);
    const currentPosition = await windowHandle.outerPosition().catch(() => null);
    const distance = currentPosition
      ? Math.hypot(targetX - currentPosition.x, targetY - currentPosition.y)
      : 0;
    const canAnimate = animate
      && currentPosition
      && distance >= 2
      && typeof window !== "undefined"
      && typeof window.requestAnimationFrame === "function"
      && typeof performance !== "undefined"
      && typeof performance.now === "function";

    if (!canAnimate) {
      cancelBarPositionAnimation();
      await windowHandle.setPosition(new PhysicalPosition(targetX, targetY));
      return;
    }

    cancelBarPositionAnimation();
    const animation = barPositionAnimationRef.current;
    const token = animation.token;
    const startX = currentPosition.x;
    const startY = currentPosition.y;
    const startedAt = performance.now();

    await new Promise((resolve) => {
      const step = async (now) => {
        if (barPositionAnimationRef.current.token !== token) {
          resolve();
          return;
        }

        const progress = Math.min(1, (now - startedAt) / AUDIO_WIDGET_BAR_ANCHOR_ANIMATION_MS);
        const eased = 1 - ((1 - progress) ** 3);
        const nextX = Math.round(startX + ((targetX - startX) * eased));
        const nextY = Math.round(startY + ((targetY - startY) * eased));

        await windowHandle.setPosition(new PhysicalPosition(nextX, nextY)).catch(() => {});
        if (barPositionAnimationRef.current.token !== token) {
          resolve();
          return;
        }
        if (progress >= 1) {
          barPositionAnimationRef.current.frame = 0;
          resolve();
          return;
        }

        barPositionAnimationRef.current.frame = window.requestAnimationFrame(step);
      };

      animation.frame = window.requestAnimationFrame(step);
    });
  }, [cancelBarPositionAnimation]);

  const positionAudioBarWindowNatively = useCallback(async (request) => {
    if (!isMacPlatform()) {
      return null;
    }

    cancelBarPositionAnimation();
    try {
      await invoke("audio_widget_position_bottom_bar", { request });
      return { queued: true };
    } catch {
      return null;
    }
  }, [cancelBarPositionAnimation]);

  useEffect(() => () => {
    cancelBarPositionAnimation();
  }, [cancelBarPositionAnimation]);

  const clearBarNativePlacementFallback = useCallback(() => {
    if (barNativePlacementFallbackTimerRef.current) {
      window.clearTimeout(barNativePlacementFallbackTimerRef.current);
      barNativePlacementFallbackTimerRef.current = 0;
    }
  }, []);

  const markBarPlacementReady = useCallback((targetKey) => {
    barPlacementReadyKeyRef.current = targetKey;
    setBarPlacementReadyKey((currentKey) => (
      currentKey === targetKey ? currentKey : targetKey
    ));
  }, []);

  const scheduleWidgetDragFinish = useCallback((delayMs = 240) => {
    if (widgetDragSettleTimerRef.current) {
      window.clearTimeout(widgetDragSettleTimerRef.current);
    }

    const settleRun = widgetDragSettleRunRef.current + 1;
    widgetDragSettleRunRef.current = settleRun;
    logAudioWidgetBubblePosition("audio.widget.bubble.drag.finish_scheduled", {
      delayMs,
      releaseSeen: widgetDragReleaseSeenRef.current,
      settleRun,
      widgetState: widgetStateRef.current,
      widgetStyle: widgetStyleRef.current,
    });
    widgetDragSettleTimerRef.current = window.setTimeout(() => {
      widgetDragSettleTimerRef.current = 0;
      runWidgetWindowAction(async (windowHandle) => {
        const settle = await waitForWidgetDragStablePosition(windowHandle, settleRun);
        if (widgetDragSettleRunRef.current !== settleRun) {
          return;
        }

        const closeHistoryTray = historyTrayCloseAfterDragRef.current;
        historyTrayCloseAfterDragRef.current = false;
        widgetDragReleaseSeenRef.current = false;

        if (closeHistoryTray) {
          bubbleHistoryTrayHoverRef.current = false;
          bubbleHistoryTrayActiveRef.current = false;
          historyTrayOpenRef.current = false;
          historyTrayClosingRef.current = false;
          if (historyTrayExitTimerRef.current) {
            window.clearTimeout(historyTrayExitTimerRef.current);
            historyTrayExitTimerRef.current = 0;
          }
          setHistoryTrayClosing(false);
          setHistoryTrayOpen(false);
          await windowHandle.setSize(new LogicalSize(
            AUDIO_WIDGET_COMPACT_SIZE.width,
            AUDIO_WIDGET_COMPACT_SIZE.height,
          )).catch(() => {});
        }

        const saved = widgetStyleRef.current !== AUDIO_WIDGET_STYLE_BAR
          ? await saveBubblePlacementFromWindow(windowHandle)
          : null;

        widgetDraggingRef.current = false;
        setWidgetDragging(false);
        clearWidgetDragPositionSample();
        logAudioWidgetBubblePosition("audio.widget.bubble.drag.finish_settled", {
          closeHistoryTray,
          nativePosition: audioWidgetBubblePositionPoint(settle?.position),
          nativeSize: audioWidgetBubblePositionSize(settle?.size),
          saved,
          settleRun,
          stable: Boolean(settle?.stable),
          widgetState: widgetStateRef.current,
          widgetStyle: widgetStyleRef.current,
        });
      });
    }, delayMs);
  }, [
    clearWidgetDragPositionSample,
    runWidgetWindowAction,
    saveBubblePlacementFromWindow,
    waitForWidgetDragStablePosition,
  ]);

  const widgetTargetMode = isFocusedAudioWidgetState(widgetState) ? "focus" : "compact";
  const widgetActive = widgetState === "arming"
    || widgetState === "recording"
    || widgetState === "transcribing"
    || widgetState === "error";
  const usesBottomAnchoredStyle = widgetStyle === AUDIO_WIDGET_STYLE_BAR;
  const cancelNoticeActive = Boolean(cancelNotice);
  const polishErrorFrameActive = polishStatus.state === "error" && Boolean(polishStatus.error);
  const errorFrameText = polishErrorFrameActive ? polishStatus.error : error;
  const sharedErrorFrameActive = Boolean(errorFrameText);
  const errorFrameActive = sharedErrorFrameActive && !usesBottomAnchoredStyle;
  const barErrorFrameActive = sharedErrorFrameActive && usesBottomAnchoredStyle;
  const barVisible = usesBottomAnchoredStyle
    && (widgetActive || cancelNoticeActive);
  const barIdleMode = usesBottomAnchoredStyle && !barVisible;
  const {
    key: barGeometryKey,
    margin: barGeometryMargin,
    size: barGeometrySize,
  } = getAudioWidgetBarGeometry(cancelNoticeActive, barVisible, barIdleHover);
  const barGeometryReady = !usesBottomAnchoredStyle || barPlacementReadyKey === barGeometryKey;
  // Bubble style shows the same cancel notice pill as the bar: the window
  // morphs to the pill in place while it shows, then morphs back.
  const bubbleCancelNoticeActive = cancelNoticeActive
    && !usesBottomAnchoredStyle
    && widgetStyle !== AUDIO_WIDGET_STYLE_HIDDEN;
  const canUseBubbleHistoryTray = widgetStyle === AUDIO_WIDGET_STYLE_BUBBLE
    && !widgetActive
    && !cancelNoticeActive;
  const bubbleHistoryTrayActive = canUseBubbleHistoryTray && historyTrayOpen;
  const bubbleHistoryTrayClosing = canUseBubbleHistoryTray && historyTrayClosing;
  const bubbleHistoryTrayFrameActive = bubbleHistoryTrayActive || bubbleHistoryTrayClosing;
  const bubbleHistoryTrayVisible = bubbleHistoryTrayActive && !widgetDragging;
  const bubbleCancelNoticeActiveRef = useRef(bubbleCancelNoticeActive);
  bubbleCancelNoticeActiveRef.current = bubbleCancelNoticeActive;
  historyTrayOpenRef.current = historyTrayOpen;
  historyTrayClosingRef.current = historyTrayClosing;
  canUseBubbleHistoryTrayRef.current = canUseBubbleHistoryTray;
  bubbleHistoryTrayActiveRef.current = bubbleHistoryTrayFrameActive;

  const refreshWidgetHistory = useCallback(() => {
    setWidgetHistory(readAudioTranscriptionHistory());
  }, []);

  const copyWidgetHistorySlot = useCallback(async (slot) => {
    const history = readAudioTranscriptionHistory();
    setWidgetHistory(history);
    const offset = slot === "previous" ? 1 : 0;
    const transcript = String(history[offset]?.text || "").trim();

    if (!transcript) {
      setMessage(offset === 0 ? "No transcript yet" : "No previous transcript");
      return;
    }

    const copied = await copyTextToClipboard(transcript);
    if (!copied) {
      setMessage("Unable to copy transcript");
      return;
    }

    setCopiedWidgetHistorySlot(slot);
    setMessage(offset === 0 ? "Latest transcript copied" : "Previous transcript copied");

    if (copiedWidgetHistoryTimerRef.current) {
      window.clearTimeout(copiedWidgetHistoryTimerRef.current);
    }

    copiedWidgetHistoryTimerRef.current = window.setTimeout(() => {
      copiedWidgetHistoryTimerRef.current = 0;
      setCopiedWidgetHistorySlot((currentSlot) => (currentSlot === slot ? "" : currentSlot));
    }, 1300);
  }, []);

  const clearBubbleHistoryTrayCloseTimer = useCallback(() => {
    if (historyTrayCloseTimerRef.current) {
      window.clearTimeout(historyTrayCloseTimerRef.current);
      historyTrayCloseTimerRef.current = 0;
    }
  }, []);

  const clearBubbleHistoryTrayExitTimer = useCallback(() => {
    if (historyTrayExitTimerRef.current) {
      window.clearTimeout(historyTrayExitTimerRef.current);
      historyTrayExitTimerRef.current = 0;
    }
  }, []);

  const scheduleBubbleHistoryTrayClose = useCallback((delayMs = 140) => {
    if (
      historyTrayCloseTimerRef.current
      || historyTrayClosingRef.current
      || !historyTrayOpenRef.current
    ) {
      return;
    }

    historyTrayCloseTimerRef.current = window.setTimeout(() => {
      historyTrayCloseTimerRef.current = 0;
      clearBubbleHistoryTrayExitTimer();
      historyTrayOpenRef.current = false;
      historyTrayClosingRef.current = true;
      setHistoryTrayClosing(true);
      setHistoryTrayOpen(false);
      historyTrayExitTimerRef.current = window.setTimeout(() => {
        historyTrayExitTimerRef.current = 0;
        historyTrayClosingRef.current = false;
        setHistoryTrayClosing(false);
      }, AUDIO_WIDGET_HISTORY_TRAY_EXIT_ANIMATION_MS);
    }, delayMs);
  }, [clearBubbleHistoryTrayExitTimer]);

  const releaseBubbleHistoryTrayPolishPin = useCallback(() => {
    bubbleHistoryTrayPolishPinnedRef.current = false;

    if (bubbleHistoryTrayCloseDeferredRef.current || !bubbleHistoryTrayHoverRef.current) {
      bubbleHistoryTrayCloseDeferredRef.current = false;
      scheduleBubbleHistoryTrayClose();
      return;
    }

    bubbleHistoryTrayCloseDeferredRef.current = false;
  }, [scheduleBubbleHistoryTrayClose]);

  const pinBubbleHistoryTrayForPolish = useCallback(() => {
    if (!canUseBubbleHistoryTrayRef.current || widgetDraggingRef.current) {
      return;
    }

    bubbleHistoryTrayPolishPinnedRef.current = true;
    bubbleHistoryTrayCloseDeferredRef.current = false;
    clearBubbleHistoryTrayCloseTimer();
    clearBubbleHistoryTrayExitTimer();
    historyTrayOpenRef.current = true;
    historyTrayClosingRef.current = false;
    setHistoryTrayClosing(false);
    setHistoryTrayOpen(true);
  }, [clearBubbleHistoryTrayCloseTimer, clearBubbleHistoryTrayExitTimer]);

  const resetPolishStatusSoon = useCallback((delayMs = 1500) => {
    if (polishStatusTimerRef.current) {
      window.clearTimeout(polishStatusTimerRef.current);
    }
    polishStatusTimerRef.current = window.setTimeout(() => {
      polishStatusTimerRef.current = 0;
      setPolishStatus({ state: "idle", error: "" });
      releaseBubbleHistoryTrayPolishPin();
    }, delayMs);
  }, [releaseBubbleHistoryTrayPolishPin]);

  const polishLatestTranscript = useCallback(async () => {
    if (polishStatus.state === "loading") {
      return;
    }
    if (!forgeCloudConnectedRef.current) {
      const messageText = "Connect to Diff Forge Cloud to polish text.";
      setPolishStatus({ state: "error", error: messageText });
      setMessage("Cloud disconnected");
      resetPolishStatusSoon(2200);
      return;
    }
    if (!readAudioManualPolishingEnabled()) {
      const messageText = "Manual polish is disabled in the Audio tab.";
      setPolishStatus({ state: "error", error: messageText });
      setMessage("Polish disabled");
      resetPolishStatusSoon(2200);
      return;
    }

    const history = readAudioTranscriptionHistory();
    setWidgetHistory(history);
    const fallbackText = audioHistoryEntryPolishText(history[0]);

    if (polishStatusTimerRef.current) {
      window.clearTimeout(polishStatusTimerRef.current);
      polishStatusTimerRef.current = 0;
    }
    pinBubbleHistoryTrayForPolish();
    setError("");
    setPolishStatus({ state: "loading", error: "" });
    setMessage("Polishing text");

    try {
      const polishStartedAt = Date.now();
      const result = await invoke("polish_audio_transcription", {
        request: {
          fallbackText,
          polishingPrompt: readManualPolishingPrompt(),
          ...readAudioLlmCleanupRequestOptions(),
        },
      });
      const polishedText = String(result?.text || "").trim();
      if (!polishedText) {
        throw new Error("Polish returned empty text.");
      }
      const sourceText = String(result?.rawText || result?.raw_text || polishedText).trim();
      const entry = findAudioHistoryEntryForPolish(history, sourceText);
      const polishTotalMs = Math.max(0, Date.now() - polishStartedAt);
      const polishMetadata = buildAudioPolishMetadata(result, {
        totalMs: polishTotalMs,
      });

      const nextVariants = buildPolishedAudioHistoryVariants(
        entry,
        sourceText,
        polishedText,
        polishMetadata,
      );
      await publishAudioTranscriptionResult({
        ...(entry || {}),
        cleanupEngine: result?.cleanupEngine || result?.cleanup_engine || entry?.cleanupEngine || "",
        cleanupModel: result?.model || result?.cleanupModel || result?.cleanup_model || entry?.cleanupModel || "",
        cleanupProvider: result?.provider || result?.cleanupProvider || result?.cleanup_provider || entry?.cleanupProvider || "",
        defaultVariantId: AUDIO_TRANSCRIPTION_VARIANT_POLISHED,
        id: entry?.id || `polish-${Date.now()}`,
        latencyMs: Number(entry?.latencyMs || 0) > 0 ? entry.latencyMs : polishTotalMs,
        llmCleaned: Boolean(result?.llmCleaned ?? result?.llm_cleaned ?? true),
        provider: entry?.provider || readAudioTranscriptionProvider(),
        rawText: sourceText,
        source: entry?.source || "audio-llm-polished-clipboard",
        sourceText: sourceText !== polishedText ? sourceText : String(entry?.sourceText || ""),
        status: entry?.status || AUDIO_TRANSCRIPTION_STATUS_INSERTED,
        text: polishedText,
        timings: entry?.timings || polishMetadata?.timings || null,
        variants: nextVariants,
      });
      refreshWidgetHistory();
      setPolishStatus({ state: "success", error: "" });
      setMessage("Text polished");
      resetPolishStatusSoon(1500);
    } catch (polishError) {
      const messageText = getErrorMessage(polishError, "Unable to polish transcript.");
      setPolishStatus({ state: "error", error: messageText });
      setMessage("Polish failed");
      setError(messageText);
      if (widgetStyleRef.current === AUDIO_WIDGET_STYLE_BAR) {
        widgetStateRef.current = "error";
        setWidgetState("error");
      }
      resetPolishStatusSoon(2600);
    }
  }, [pinBubbleHistoryTrayForPolish, polishStatus.state, refreshWidgetHistory, resetPolishStatusSoon]);

  const openBubbleHistoryTray = useCallback(() => {
    if (!canUseBubbleHistoryTray || widgetDraggingRef.current) {
      return;
    }

    bubbleHistoryTrayHoverRef.current = true;
    bubbleHistoryTrayCloseDeferredRef.current = false;
    clearBubbleHistoryTrayCloseTimer();
    clearBubbleHistoryTrayExitTimer();

    historyTrayOpenRef.current = true;
    historyTrayClosingRef.current = false;
    setHistoryTrayClosing(false);
    setHistoryTrayOpen(true);
  }, [canUseBubbleHistoryTray, clearBubbleHistoryTrayCloseTimer, clearBubbleHistoryTrayExitTimer]);

  const closeBubbleHistoryTray = useCallback(() => {
    bubbleHistoryTrayHoverRef.current = false;

    if (widgetDraggingRef.current) {
      clearBubbleHistoryTrayCloseTimer();
      if (bubbleHistoryTrayActiveRef.current) {
        historyTrayCloseAfterDragRef.current = true;
      }
      return;
    }

    if (bubbleHistoryTrayPolishPinnedRef.current) {
      bubbleHistoryTrayCloseDeferredRef.current = true;
      return;
    }

    scheduleBubbleHistoryTrayClose();
  }, [clearBubbleHistoryTrayCloseTimer, scheduleBubbleHistoryTrayClose]);

  const handleBubbleHoverEnter = useCallback(() => {
    setBubbleHoverState(true);
    openBubbleHistoryTray();
  }, [openBubbleHistoryTray, setBubbleHoverState]);

  const handleBubbleHoverLeave = useCallback(() => {
    setBubbleHoverState(false);
    closeBubbleHistoryTray();
  }, [closeBubbleHistoryTray, setBubbleHoverState]);

  const updateBarIdleHoverFromPointer = useCallback((event) => {
    setBarIdleHoverState(audioBarIdlePointerEventIsHovering(event, barIdleHoverRef.current));
  }, [setBarIdleHoverState]);

  const clearBarIdleHover = useCallback(() => {
    setBarIdleHoverState(false);
  }, [setBarIdleHoverState]);

  // The hidden style keeps the window "visible" to the OS (global shortcuts
  // require it) but inert and invisible while idle. The bar style is always
  // interactive: its idle line must respond to hover.
  useEffect(() => {
    const ignoreCursor = widgetStyle === AUDIO_WIDGET_STYLE_HIDDEN && !widgetActive;
    runWidgetWindowAction((windowHandle) => windowHandle.setIgnoreCursorEvents(ignoreCursor));
  }, [runWidgetWindowAction, widgetActive, widgetStyle]);

  useEffect(() => {
    if (isBusyAudioWidgetState(widgetState)) {
      return;
    }
    releaseAudioWidgetKeyboardFocus();
  }, [widgetState]);

  useEffect(() => {
    if (canUseBubbleHistoryTray) {
      return undefined;
    }

    if (historyTrayCloseTimerRef.current) {
      window.clearTimeout(historyTrayCloseTimerRef.current);
      historyTrayCloseTimerRef.current = 0;
    }
    bubbleHistoryTrayHoverRef.current = false;
    bubbleHistoryTrayPolishPinnedRef.current = false;
    bubbleHistoryTrayCloseDeferredRef.current = false;
    setBubbleHoverState(false);
    clearBubbleHistoryTrayExitTimer();

    historyTrayOpenRef.current = false;
    historyTrayClosingRef.current = false;
    setHistoryTrayClosing(false);
    setHistoryTrayOpen(false);
    return undefined;
  }, [canUseBubbleHistoryTray, clearBubbleHistoryTrayExitTimer, setBubbleHoverState]);

  useEffect(() => {
    if (bubbleHistoryTrayFrameActive) {
      document.documentElement.dataset.audioWidgetHistoryTray = "true";
      document.body.dataset.audioWidgetHistoryTray = "true";
    } else {
      delete document.documentElement.dataset.audioWidgetHistoryTray;
      delete document.body.dataset.audioWidgetHistoryTray;
    }

    return () => {
      delete document.documentElement.dataset.audioWidgetHistoryTray;
      delete document.body.dataset.audioWidgetHistoryTray;
    };
  }, [bubbleHistoryTrayFrameActive]);

  useEffect(() => {
    let disposed = false;
    let unlistenHistory = () => {};

    const refresh = () => {
      if (!disposed) {
        refreshWidgetHistory();
      }
    };

    const handleStorage = (event) => {
      if (event.key === "diffforge.audio.transcriptionHistory" || event.key === "diffforge.audio.lastTranscriptionResult") {
        refresh();
      }
    };

    window.addEventListener("storage", handleStorage);
    listen(AUDIO_TRANSCRIPTION_RESULT_EVENT, refresh)
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlistenHistory = nextUnlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlistenHistory();
      window.removeEventListener("storage", handleStorage);
    };
  }, [refreshWidgetHistory]);

  useEffect(() => () => {
    if (historyTrayCloseTimerRef.current) {
      window.clearTimeout(historyTrayCloseTimerRef.current);
      historyTrayCloseTimerRef.current = 0;
    }
    if (historyTrayExitTimerRef.current) {
      window.clearTimeout(historyTrayExitTimerRef.current);
      historyTrayExitTimerRef.current = 0;
    }
    bubbleHistoryTrayHoverRef.current = false;
    bubbleHistoryTrayPolishPinnedRef.current = false;
    bubbleHistoryTrayCloseDeferredRef.current = false;

    if (widgetDragSettleTimerRef.current) {
      window.clearTimeout(widgetDragSettleTimerRef.current);
      widgetDragSettleTimerRef.current = 0;
    }
    widgetDragSettleRunRef.current += 1;
    widgetDragReleaseSeenRef.current = false;
    if (widgetDragPositionSampleTimerRef.current) {
      window.clearTimeout(widgetDragPositionSampleTimerRef.current);
      widgetDragPositionSampleTimerRef.current = 0;
    }
    historyTrayCloseAfterDragRef.current = false;

    if (copiedWidgetHistoryTimerRef.current) {
      window.clearTimeout(copiedWidgetHistoryTimerRef.current);
      copiedWidgetHistoryTimerRef.current = 0;
    }

    if (polishStatusTimerRef.current) {
      window.clearTimeout(polishStatusTimerRef.current);
      polishStatusTimerRef.current = 0;
    }
  }, []);

  useEffect(() => {
    const finishAfterRelease = () => {
      if (widgetDraggingRef.current) {
        widgetDragReleaseSeenRef.current = true;
        scheduleWidgetDragFinish(60);
      }
    };

    let disposed = false;
    let unlistenMoved = () => {};

    window.addEventListener("mouseup", finishAfterRelease, true);
    window.addEventListener("pointerup", finishAfterRelease, true);
    window.addEventListener("pointercancel", finishAfterRelease, true);
    window.addEventListener("blur", finishAfterRelease);

    try {
      getCurrentWindow().onMoved(() => {
        if (widgetDraggingRef.current) {
          scheduleWidgetDragFinish(widgetDragReleaseSeenRef.current ? 700 : 5000);
        }
      })
        .then((nextUnlisten) => {
          if (disposed) {
            nextUnlisten();
            return;
          }

          unlistenMoved = nextUnlisten;
        })
        .catch(() => {});
    } catch {
      // In non-Tauri web previews the native move listener is unavailable.
    }

    return () => {
      disposed = true;
      unlistenMoved();
      window.removeEventListener("mouseup", finishAfterRelease, true);
      window.removeEventListener("pointerup", finishAfterRelease, true);
      window.removeEventListener("pointercancel", finishAfterRelease, true);
      window.removeEventListener("blur", finishAfterRelease);
    };
  }, [scheduleWidgetDragFinish]);

  const positionBottomAnchoredWidget = useCallback((options = {}) => {
    if (!usesBottomAnchoredStyle) {
      return;
    }

    const placementGeneration = barPlacementGenerationRef.current + 1;
    barPlacementGenerationRef.current = placementGeneration;
    const isCurrentPlacement = () => (
      barPlacementGenerationRef.current === placementGeneration
      && widgetStyleRef.current === AUDIO_WIDGET_STYLE_BAR
    );

    const target = barGeometrySize;
    const targetKey = barGeometryKey;
    const margin = barGeometryMargin;

    runWidgetWindowAction(async (windowHandle) => {
      if (!isCurrentPlacement()) {
        return;
      }
      if (!barSavedPlacementRef.current) {
        const persistedBubblePosition = readAudioWidgetBubblePlacement();
        const currentPosition = await windowHandle.outerPosition().catch(() => null);
        const savedPosition = persistedBubblePosition || currentPosition;
        barSavedPlacementRef.current = {
          position: savedPosition,
        };
      }
      if (!isCurrentPlacement()) {
        return;
      }
      const previousReadyKey = barPlacementReadyKeyRef.current;
      const modeGeometryChanged = previousReadyKey !== targetKey;
      const noticeGeometryChanged = modeGeometryChanged
        && (previousReadyKey === "notice" || targetKey === "notice");
      // The bottom-bar cancel notice can be shown while the click that cancels
      // recording is still unwinding. Avoid AppKit's animated setFrame path for
      // that notice resize; the non-animated placement keeps the notice behavior
      // without freezing the host event loop.
      const shouldAnimatePlacement = options.animate !== false
        && !modeGeometryChanged
        && !noticeGeometryChanged;
      const nativeOwnsBarPlacement = isMacPlatform();
      if (nativeOwnsBarPlacement) {
        clearBarNativePlacementFallback();
        barNativePlacementPendingRef.current = {
          generation: placementGeneration,
          key: targetKey,
        };
      }
      const nativePlacement = await positionAudioBarWindowNatively({
        width: target.width,
        height: target.height,
        margin,
        animate: shouldAnimatePlacement,
      });
      if (!isCurrentPlacement()) {
        const pending = barNativePlacementPendingRef.current;
        if (pending?.generation === placementGeneration) {
          barNativePlacementPendingRef.current = null;
          clearBarNativePlacementFallback();
        }
        return;
      }
      if (nativePlacement) {
        const pending = barNativePlacementPendingRef.current;
        if (!pending || pending.generation !== placementGeneration || pending.key !== targetKey) {
          return;
        }
        barNativePlacementFallbackTimerRef.current = window.setTimeout(() => {
          const fallbackPending = barNativePlacementPendingRef.current;
          if (
            !fallbackPending
            || fallbackPending.generation !== placementGeneration
            || fallbackPending.key !== targetKey
            || !isCurrentPlacement()
          ) {
            return;
          }
          barNativePlacementPendingRef.current = null;
          barNativePlacementFallbackTimerRef.current = 0;
          markBarPlacementReady(targetKey);
        }, 180);
        return;
      }
      if (nativeOwnsBarPlacement) {
        barNativePlacementPendingRef.current = null;
        clearBarNativePlacementFallback();
        markBarPlacementReady(targetKey);
        return;
      }

      await windowHandle.setSize(new LogicalSize(target.width, target.height));
      if (!isCurrentPlacement()) {
        return;
      }
      const monitor = await currentMonitor().catch(() => null);
      if (!isCurrentPlacement()) {
        return;
      }
      if (monitor) {
        const area = monitor.workArea?.size?.height
          ? monitor.workArea
          : { position: monitor.position, size: monitor.size };
        const scale = Number(monitor.scaleFactor || 1) || 1;
        const x = area.position.x
          + Math.round((area.size.width - (target.width * scale)) / 2);
        const y = area.position.y
          + area.size.height
          - Math.round((target.height + margin) * scale);
        if (!isCurrentPlacement()) {
          return;
        }
        await setAudioBarWindowPosition(
          windowHandle,
          { x, y },
          shouldAnimatePlacement,
        );
        if (!isCurrentPlacement()) {
          return;
        }
        markBarPlacementReady(targetKey);
      } else {
        markBarPlacementReady(targetKey);
      }
    });
  }, [
    barGeometryKey,
    barGeometryMargin,
    barGeometrySize,
    clearBarNativePlacementFallback,
    markBarPlacementReady,
    positionAudioBarWindowNatively,
    runWidgetWindowAction,
    setAudioBarWindowPosition,
    usesBottomAnchoredStyle,
  ]);

  useEffect(() => {
    let disposed = false;
    let unlistenLayout = () => {};

    listen(FLOATING_SURFACE_LAYOUT_CHANGED_EVENT, (event) => {
      if (disposed) {
        return;
      }

      const payload = event?.payload || {};
      if (
        payload.source !== "audio_widget_bottom_bar"
        || payload.surface !== "audio-widget"
        || payload.layout !== "bottom-bar"
      ) {
        return;
      }

      const pending = barNativePlacementPendingRef.current;
      if (
        !pending
        || barPlacementGenerationRef.current !== pending.generation
        || widgetStyleRef.current !== AUDIO_WIDGET_STYLE_BAR
      ) {
        return;
      }

      barNativePlacementPendingRef.current = null;
      clearBarNativePlacementFallback();
      markBarPlacementReady(pending.key);
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlistenLayout = nextUnlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlistenLayout();
      barNativePlacementPendingRef.current = null;
      clearBarNativePlacementFallback();
    };
  }, [clearBarNativePlacementFallback, markBarPlacementReady]);

  // The bar style reports its geometry to native code on macOS; Rust owns the
  // actual HUD frame so browser timers cannot fight AppKit during Space swaps.
  // Non-macOS builds keep the previous Tauri work-area fallback.
  useEffect(() => {
    if (!usesBottomAnchoredStyle) {
      barPlacementReadyKeyRef.current = "";
      barNativePlacementPendingRef.current = null;
      clearBarNativePlacementFallback();
      setBarPlacementReadyKey("");
      invoke("audio_widget_clear_bottom_bar_position").catch(() => {});
      publishAudioWidgetErrorOverlay(null);
      invoke("audio_widget_hide_error_overlay").catch(() => {});
      const saved = barSavedPlacementRef.current;
      const restoredPosition = readAudioWidgetBubblePlacement() || saved?.position || null;
      logAudioWidgetBubblePosition("audio.widget.bubble.restore_from_bar.request", {
        hasSavedBarPlacement: Boolean(saved?.position),
        restoredPosition: audioWidgetBubblePositionPoint(restoredPosition),
      });
      if (saved || restoredPosition) {
        barSavedPlacementRef.current = null;
        barPlacementGenerationRef.current += 1;
        cancelBarPositionAnimation();
        runWidgetWindowAction(async (windowHandle) => {
          await windowHandle.setSize(
            new LogicalSize(AUDIO_WIDGET_COMPACT_SIZE.width, AUDIO_WIDGET_COMPACT_SIZE.height),
          );
          if (restoredPosition) {
            const size = await windowHandle.outerSize?.().catch(() => null);
            const monitor = await resolveAudioWidgetBubbleClampMonitor(restoredPosition);
            const clampedPosition = clampAudioWidgetBubblePlacementToMonitor(
              restoredPosition,
              monitor,
              size,
            );
            if (clampedPosition) {
              await windowHandle.setPosition(new PhysicalPosition(clampedPosition.x, clampedPosition.y));
              writeAudioWidgetBubblePlacement(clampedPosition);
            }
            await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.restore_from_bar.done", {
              clampedPosition: audioWidgetBubblePositionPoint(clampedPosition),
              restoredPosition: audioWidgetBubblePositionPoint(restoredPosition),
              wasClamped: audioWidgetBubblePlacementChanged(restoredPosition, clampedPosition),
            });
          }
        });
      }
      return;
    }

    positionBottomAnchoredWidget();
  }, [
    cancelBarPositionAnimation,
    clearBarNativePlacementFallback,
    positionBottomAnchoredWidget,
    runWidgetWindowAction,
    usesBottomAnchoredStyle,
  ]);

  useEffect(() => {
    if (!barErrorFrameActive) {
      publishAudioWidgetErrorOverlay(null);
      invoke("audio_widget_hide_error_overlay").catch(() => {});
      return undefined;
    }

    publishAudioWidgetErrorOverlay({
      id: `bottom-bar-error:${errorFrameText}`,
      message: errorFrameText,
      theme: audioWidgetTheme,
      visible: true,
    });
    invoke("audio_widget_show_error_overlay", {
      request: {
        animate: true,
        gap: AUDIO_WIDGET_ERROR_OVERLAY_GAP,
        height: AUDIO_WIDGET_ERROR_OVERLAY_SIZE.height,
        width: AUDIO_WIDGET_ERROR_OVERLAY_SIZE.width,
      },
    }).catch(() => {});
    return undefined;
  }, [audioWidgetTheme, barErrorFrameActive, errorFrameText]);

  useEffect(() => {
    if (!usesBottomAnchoredStyle || isMacPlatform()) {
      return undefined;
    }

    const timer = window.setInterval(
      () => positionBottomAnchoredWidget({ animate: true }),
      AUDIO_WIDGET_BAR_ANCHOR_RECHECK_MS,
    );
    return () => window.clearInterval(timer);
  }, [positionBottomAnchoredWidget, usesBottomAnchoredStyle]);

  useEffect(() => {
    barIdleModeRef.current = barIdleMode;
    if (!barIdleMode) {
      setBarIdleHoverState(false);
    }
  }, [barIdleMode, setBarIdleHoverState]);

  useEffect(() => {
    let disposed = false;
    let unlistenHover = () => {};

    listen(AUDIO_WIDGET_BAR_HOVER_CHANGED_EVENT, (event) => {
      if (disposed) {
        return;
      }

      const hovering = Boolean(event?.payload?.hovering);
      if (barIdleModeRef.current) {
        setBarIdleHoverState(hovering);
      } else if (!hovering) {
        setBarIdleHoverState(false);
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlistenHover = nextUnlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlistenHover();
    };
  }, [setBarIdleHoverState]);

  useEffect(() => {
    if (!usesBottomAnchoredStyle) {
      return undefined;
    }

    let disposed = false;
    let timer = 0;
    const poll = async () => {
      try {
        const snapshot = await invoke("audio_widget_bar_hover_snapshot", {
          request: {
            active: barIdleHoverRef.current,
            focus: true,
          },
        });
        if (!disposed) {
          if (barIdleModeRef.current) {
            setBarIdleHoverState(Boolean(snapshot?.hovering));
          } else if (!snapshot?.hovering) {
            setBarIdleHoverState(false);
          }
        }
      } catch {
        // Web previews and older native builds do not expose this helper.
      }

      if (!disposed) {
        const hoveringIdleBar = barIdleModeRef.current && barIdleHoverRef.current;
        timer = window.setTimeout(
          poll,
          hoveringIdleBar
            ? AUDIO_WIDGET_BAR_HOVER_ACTIVE_RECHECK_MS
            : AUDIO_WIDGET_BAR_HOVER_IDLE_RECHECK_MS,
        );
      }
    };

    poll();
    return () => {
      disposed = true;
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, [setBarIdleHoverState, usesBottomAnchoredStyle]);

  useEffect(() => {
    let disposed = false;
    let unlistenHover = () => {};

    listen(AUDIO_WIDGET_BUBBLE_HOVER_CHANGED_EVENT, (event) => {
      if (disposed || !canUseBubbleHistoryTrayRef.current) {
        return;
      }

      const hovering = Boolean(event?.payload?.hovering);
      setBubbleHoverState(hovering);
      if (hovering) {
        openBubbleHistoryTray();
      } else {
        closeBubbleHistoryTray();
      }
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }

        unlistenHover = nextUnlisten;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlistenHover();
    };
  }, [closeBubbleHistoryTray, openBubbleHistoryTray, setBubbleHoverState]);

  useEffect(() => {
    if (!canUseBubbleHistoryTray) {
      invoke("audio_widget_bar_hover_snapshot", {
        request: {
          bubble: true,
          enabled: false,
          focus: false,
        },
      }).catch(() => {});
      return undefined;
    }

    let disposed = false;
    let timer = 0;
    const poll = async () => {
      try {
        const snapshot = await invoke("audio_widget_bar_hover_snapshot", {
          request: {
            active: bubbleHistoryTrayActiveRef.current,
            bubble: true,
            enabled: true,
            focus: true,
          },
        });
        if (!disposed) {
          const hovering = Boolean(snapshot?.hovering);
          setBubbleHoverState(hovering);
          if (hovering) {
            openBubbleHistoryTray();
          } else {
            closeBubbleHistoryTray();
          }
        }
      } catch {
        // Web previews and older native builds do not expose this helper.
      }

      if (!disposed) {
        const hoveringBubbleTray = bubbleHistoryTrayActiveRef.current;
        timer = window.setTimeout(
          poll,
          hoveringBubbleTray
            ? AUDIO_WIDGET_BAR_HOVER_ACTIVE_RECHECK_MS
            : AUDIO_WIDGET_BAR_HOVER_IDLE_RECHECK_MS,
        );
      }
    };

    poll();
    return () => {
      disposed = true;
      if (timer) {
        window.clearTimeout(timer);
      }
      invoke("audio_widget_bar_hover_snapshot", {
        request: {
          bubble: true,
          enabled: false,
          focus: false,
        },
      }).catch(() => {});
    };
  }, [canUseBubbleHistoryTray, closeBubbleHistoryTray, openBubbleHistoryTray, setBubbleHoverState]);

  // Bubble history controls use the same stable-anchor idea as the error
  // popover: resize the native frame in one direction while leaving the
  // bubble's screen position alone. No tray open/close path should setPosition,
  // otherwise hover close can undo a native drag that happened while expanded.
  useEffect(() => {
    if (!bubbleHistoryTrayFrameActive || widgetDragging) {
      return undefined;
    }

    let disposed = false;
    runWidgetWindowAction(async (windowHandle) => {
      if (disposed || widgetDraggingRef.current) {
        return undefined;
      }

      await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.history_tray.expand_before", {
        targetSize: AUDIO_WIDGET_HISTORY_TRAY_SIZE,
      });
      await windowHandle.setSize(new LogicalSize(
        AUDIO_WIDGET_HISTORY_TRAY_SIZE.width,
        AUDIO_WIDGET_HISTORY_TRAY_SIZE.height,
      ));
      await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.history_tray.expand_after", {
        targetSize: AUDIO_WIDGET_HISTORY_TRAY_SIZE,
      });
    });

    return () => {
      disposed = true;
      if (widgetDraggingRef.current) {
        return;
      }

      runWidgetWindowAction(async (windowHandle) => {
        await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.history_tray.restore_before", {
          targetSize: AUDIO_WIDGET_COMPACT_SIZE,
        });
        await windowHandle.setSize(new LogicalSize(
          AUDIO_WIDGET_COMPACT_SIZE.width,
          AUDIO_WIDGET_COMPACT_SIZE.height,
        ));
        await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.history_tray.restore_after", {
          targetSize: AUDIO_WIDGET_COMPACT_SIZE,
        });
      });
    };
  }, [bubbleHistoryTrayFrameActive, runWidgetWindowAction, widgetDragging]);

  // Bubble-style errors get a small card above the widget: the window grows
  // upward by the card height while the error shows, and the pill stays at
  // its original spot on screen. (The resize effect itself is declared after
  // the frame-mode effect below so its size wins within the same commit.)
  useEffect(() => {
    if (widgetStyle === AUDIO_WIDGET_STYLE_BAR || widgetDragging) {
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
  }, [runWidgetWindowAction, setWidgetFrameMode, widgetDragging, widgetStyle, widgetTargetMode]);

  useEffect(() => {
    if (!errorFrameActive || widgetDragging) {
      return undefined;
    }
    let savedPosition = null;
    runWidgetWindowAction(async (windowHandle) => {
      if (widgetDraggingRef.current) {
        return;
      }
      const scale = await windowHandle.scaleFactor().catch(() => 1);
      savedPosition = await windowHandle.outerPosition();
      if (widgetDraggingRef.current) {
        return;
      }
      logAudioWidgetBubblePosition("audio.widget.bubble.error_frame.expand", {
        savedPosition: audioWidgetBubblePositionPoint(savedPosition),
        scale: Number(scale || 1) || 1,
      });
      await windowHandle.setSize(new LogicalSize(
        AUDIO_WIDGET_FOCUS_SIZE.width,
        AUDIO_WIDGET_FOCUS_SIZE.height + AUDIO_WIDGET_ERROR_POPOVER_HEIGHT,
      ));
      await windowHandle.setPosition(new PhysicalPosition(
        savedPosition.x,
        savedPosition.y - Math.round(AUDIO_WIDGET_ERROR_POPOVER_HEIGHT * (scale || 1)),
      ));
      await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.error_frame.expanded", {
        savedPosition: audioWidgetBubblePositionPoint(savedPosition),
      });
    });
    return () => {
      runWidgetWindowAction(async (windowHandle) => {
        if (widgetDraggingRef.current) {
          return;
        }
        await windowHandle.setSize(new LogicalSize(
          AUDIO_WIDGET_FOCUS_SIZE.width,
          AUDIO_WIDGET_FOCUS_SIZE.height,
        ));
        if (savedPosition && !widgetDraggingRef.current) {
          await windowHandle.setPosition(savedPosition);
          await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.error_frame.restored", {
            restoredPosition: audioWidgetBubblePositionPoint(savedPosition),
          });
        }
      });
    };
  }, [errorFrameActive, runWidgetWindowAction, widgetDragging]);

  // Bubble-style cancel notice: morph the window into the notice pill at the
  // bubble's spot (nudged left if it would run off-screen), then restore the
  // compact bubble exactly where it was once the notice dismisses.
  useEffect(() => {
    if (!bubbleCancelNoticeActive || widgetDragging) {
      return undefined;
    }
    let savedPosition = null;
    runWidgetWindowAction(async (windowHandle) => {
      if (widgetDraggingRef.current) {
        return;
      }
      const scale = (await windowHandle.scaleFactor().catch(() => 1)) || 1;
      savedPosition = await windowHandle.outerPosition();
      if (widgetDraggingRef.current) {
        return;
      }
      logAudioWidgetBubblePosition("audio.widget.bubble.cancel_notice.expand", {
        savedPosition: audioWidgetBubblePositionPoint(savedPosition),
        scale: Number(scale || 1) || 1,
      });
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
        await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.cancel_notice.nudged", {
          clampedX: Math.round(x),
          maxX: Math.round(maxX),
          savedPosition: audioWidgetBubblePositionPoint(savedPosition),
        });
      }
    });
    return () => {
      runWidgetWindowAction(async (windowHandle) => {
        if (widgetDraggingRef.current) {
          return;
        }
        await windowHandle.setSize(new LogicalSize(
          AUDIO_WIDGET_COMPACT_SIZE.width,
          AUDIO_WIDGET_COMPACT_SIZE.height,
        ));
        if (savedPosition && !widgetDraggingRef.current) {
          await windowHandle.setPosition(savedPosition);
          await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.cancel_notice.restored", {
            restoredPosition: audioWidgetBubblePositionPoint(savedPosition),
          });
        }
      });
    };
  }, [bubbleCancelNoticeActive, runWidgetWindowAction, widgetDragging]);

  const dragWidget = useCallback((event) => {
    if (event.button !== 0) {
      return;
    }

    if (widgetStyleRef.current === AUDIO_WIDGET_STYLE_BAR) {
      return;
    }

    if (event.target?.closest?.("button, a, input, textarea, select, [data-audio-widget-no-drag='true']")) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const trayWasActive = bubbleHistoryTrayActiveRef.current;
    const pointer = {
      clientX: Math.round(Number(event.clientX || 0)),
      clientY: Math.round(Number(event.clientY || 0)),
      screenX: Math.round(Number(event.screenX || 0)),
      screenY: Math.round(Number(event.screenY || 0)),
    };

    if (historyTrayCloseTimerRef.current) {
      window.clearTimeout(historyTrayCloseTimerRef.current);
      historyTrayCloseTimerRef.current = 0;
    }
    if (historyTrayExitTimerRef.current) {
      window.clearTimeout(historyTrayExitTimerRef.current);
      historyTrayExitTimerRef.current = 0;
    }

    historyTrayCloseAfterDragRef.current = trayWasActive;
    widgetDragReleaseSeenRef.current = false;
    widgetDraggingRef.current = true;
    setWidgetDragging(true);
    setBubbleHoverState(false);
    bubbleHistoryTrayHoverRef.current = false;
    bubbleHistoryTrayCloseDeferredRef.current = false;
    bubbleHistoryTrayActiveRef.current = false;
    historyTrayOpenRef.current = false;
    historyTrayClosingRef.current = false;
    setHistoryTrayClosing(false);
    setHistoryTrayOpen(false);
    scheduleWidgetDragFinish(5000);

    runWidgetWindowAction(async (windowHandle) => {
      if (trayWasActive) {
        await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.drag.collapse_tray_before", {
          pointer,
          widgetState: widgetStateRef.current,
        });
        await windowHandle.setSize(new LogicalSize(
          AUDIO_WIDGET_COMPACT_SIZE.width,
          AUDIO_WIDGET_COMPACT_SIZE.height,
        )).catch(() => {});
        await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.drag.collapse_tray_after", {
          pointer,
          widgetState: widgetStateRef.current,
        });
      }
      await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.drag.start", {
        pointer,
        trayWasActive,
        widgetState: widgetStateRef.current,
      });
      startWidgetDragPositionSample(windowHandle, pointer);
      try {
        await windowHandle.startDragging();
        await logAudioWidgetBubbleWindowSnapshot(windowHandle, "audio.widget.bubble.drag.start_done", {
          pointer,
          trayWasActive,
          widgetState: widgetStateRef.current,
        });
      } catch (error) {
        logAudioWidgetBubblePosition("audio.widget.bubble.drag.start_error", {
          error: String(error?.message || error || "Unable to start dragging bubble"),
          pointer,
          trayWasActive,
          widgetState: widgetStateRef.current,
        });
      }
    });
  }, [runWidgetWindowAction, scheduleWidgetDragFinish, setBubbleHoverState, startWidgetDragPositionSample]);

  const minimizeWidget = useCallback(() => {
    runWidgetWindowAction((windowHandle) => windowHandle.minimize());
  }, [runWidgetWindowAction]);

  const closeWidget = useCallback(() => {
    invoke("hide_audio_widget").catch(() => {});
  }, []);

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
      return false;
    }

    const pipeline = applyVoiceTextPipeline(rawText, peekVoiceTextRules());
    const text = (pipeline.text || "").trim() || rawText;
    const forgeHistory = provider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
      ? forgeDictationHistoryRef.current
      : null;
    const entry = {
      audioMs,
      createdAt: result?.createdAt || forgeHistory?.createdAt || new Date().toISOString(),
      id: String(result?.id || result?.historyId || forgeHistory?.id || Date.now()),
      latencyMs: Number(result?.latencyMs || 0),
      language: provider === AUDIO_TRANSCRIPTION_PROVIDER_LOCAL ? "" : readDeepgramLanguage(),
      provider,
      snippetChanges: pipeline.changes?.snippets || [],
      source: provider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
        ? "deepgram-nova-3-live"
        : provider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
          ? "forge-voice-agent"
        : provider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
          ? "forge-nova3-dictation"
          : result?.partial
            ? "whisper-local-partial"
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
      refreshWidgetHistory();
      await invoke("insert_handsfree_transcribed_text", { text }).catch(() => {});
      return true;
    }

    await publishAudioTranscriptionResult({
      ...entry,
      status: AUDIO_TRANSCRIPTION_STATUS_CANCELLED,
    }).catch(() => {});
    refreshWidgetHistory();
    return true;
  }, [refreshWidgetHistory]);

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
      const copied = await copyTextToClipboard(transcript);
      if (!copied) {
        throw new Error("Clipboard unavailable");
      }
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
    const currentProvider = readAudioTranscriptionProvider();

    if (!audioBuffer || widgetStateRef.current !== "recording") {
      return;
    }

    if (
      currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
      && forgeVoiceStartPendingRunRef.current === recordingRunId
    ) {
      stopAfterStartRef.current = true;
      setFinishPending(true);
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
      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
        setMessage("Capturing final audio");
        await waitForAudioPostBuffer(DEEPGRAM_RELEASE_POST_BUFFER_MS);
        if (recordingRunRef.current !== recordingRunId) {
          throw new Error("Diff Forge Cloud voice canceled.");
        }
        setMessage("Finishing voice input");
        await finishCloudVoiceAgentInput(getForgeVoiceControlRequest());
        if (recordingRunRef.current !== recordingRunId) {
          return;
        }
        await audioBuffer.finishCapture({ decode: false }).catch(() => null);
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
            const realtimeResult = await invoke("stop_deepgram_realtime_transcription").catch(() => null);
            const captureResult = await audioBuffer.finishCapture({ decode: false }).catch(() => null);
            return {
              ...(realtimeResult || {}),
              audioMs: Number(captureResult?.audioMs || realtimeResult?.audioMs || 0),
            };
          }
          setMessage("Closing Deepgram stream");
          const realtimeResult = await invoke("stop_deepgram_realtime_transcription");
          if (recordingRunRef.current !== recordingRunId) {
            return {
              ...(realtimeResult || {}),
              audioMs: Number(realtimeResult?.audioMs || 0),
            };
          }
          const captureResult = await audioBuffer.finishCapture({ decode: false }).catch(() => null);
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
            const dictationResult = await invoke("stop_forge_dictation_transcription", {
              request: { cancel: true },
            }).catch(() => null);
            const captureResult = await audioBuffer.finishCapture({ decode: false }).catch(() => null);
            return {
              ...(dictationResult || {}),
              audioMs: Number(
                captureResult?.audioMs
                || Number(dictationResult?.audioSeconds || 0) * 1000
                || 0,
              ),
            };
          }
          setMessage("Finishing in Diff Forge Cloud");
          const dictationResult = await invoke("stop_forge_dictation_transcription", {
            request: { cancel: false },
          });
          if (recordingRunRef.current !== recordingRunId) {
            return {
              ...(dictationResult || {}),
              audioMs: Number(dictationResult?.audioSeconds || 0) * 1000,
            };
          }
          const captureResult = await audioBuffer.finishCapture({ decode: false }).catch(() => null);
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
          const partialSessionId = localWhisperPartialSessionIdRef.current;
          if (partialSessionId && !localWhisperPartialFailedRef.current) {
            setMessage("Finishing local transcript");
            try {
              const partialResult = await stopLocalWhisperPartialTranscription({
                sessionId: partialSessionId,
              });
              localWhisperPartialSessionIdRef.current = "";
              return {
                ...(partialResult || {}),
                audioMs: Number(partialResult?.audioMs || 0),
              };
            } catch (partialError) {
              localWhisperPartialFailedRef.current = true;
              localWhisperPartialSessionIdRef.current = "";
              try {
                const { audioBase64, audioMs } = await audioBuffer.finishCapture({ decode: false });
                const { peak, rms } = audioBuffer.getCaptureStats();
                await cancelLocalWhisperPartialTranscription({ sessionId: partialSessionId }).catch(() => {});
                if (recordingRunRef.current !== recordingRunId) {
                  return { audioMs };
                }
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
              } catch {
                await cancelLocalWhisperPartialTranscription({ sessionId: partialSessionId }).catch(() => {});
              }
              throw partialError;
            }
          }

          const { audioBase64, audioMs } = await audioBuffer.finishCapture({ decode: false });
          const { peak, rms } = audioBuffer.getCaptureStats();
          if (recordingRunRef.current !== recordingRunId) {
            return { audioMs };
          }
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
        try {
          if (cancelSalvageRunRef.current === recordingRunId) {
            const published = await publishCancelledTranscript(
              { ...result, latencyMs: Math.max(0, Date.now() - submittedAt) },
              currentProvider,
            );
            if (published && cancelSalvageRunRef.current === recordingRunId) {
              cancelSalvageRunRef.current = 0;
            }
          }
        } finally {
          await audioBuffer?.close?.().catch(() => {});
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
      const resultLatencyMs = Math.max(0, Date.now() - submittedAt);
      const forgeHistory = currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
        ? forgeDictationHistoryRef.current
        : null;
      const forgeRawTranscript = currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
        ? String(result?.rawText || "").trim()
        : "";
      const forgeCleanupMetadata = currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
        && result?.llmCleaned
        ? buildAudioPolishMetadata(result, {
          totalMs: resultLatencyMs,
        })
        : null;
      const forgeHistoryVariants = currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
        && result?.llmCleaned
        && forgeRawTranscript
        ? [
          {
            id: AUDIO_TRANSCRIPTION_VARIANT_RAW,
            label: "Raw",
            text: forgeRawTranscript,
          },
          {
            id: AUDIO_TRANSCRIPTION_VARIANT_CLEANED,
            label: "Cleaned",
            polish: forgeCleanupMetadata,
            text: nextTranscript,
          },
        ]
        : [];

      await publishAudioTranscriptionResult({
        audioMs: Number(result?.audioMs || 0),
        cleanupModel: result?.cleanupModel || "",
        cleanupProvider: result?.cleanupProvider || "",
        createdAt: forgeHistory?.createdAt || new Date().toISOString(),
        defaultVariantId: forgeHistoryVariants.length > 1 ? AUDIO_TRANSCRIPTION_VARIANT_CLEANED : "",
        id: forgeHistory?.id || `${Date.now()}`,
        latencyMs: resultLatencyMs,
        language: currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_LOCAL ? "" : readDeepgramLanguage(),
        llmCleaned: Boolean(result?.llmCleaned),
        provider: currentProvider,
        rawText: forgeHistoryVariants.length > 1 ? forgeRawTranscript : "",
        snippetChanges: pipeline.changes?.snippets || [],
        source: currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
          ? "deepgram-nova-3-live"
          : currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
            ? "forge-voice-agent"
          : currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
            ? (result?.llmCleaned ? "forge-nova3-llm-cleaned" : "forge-nova3-dictation")
            : result?.partial
              ? "whisper-local-partial"
              : "whisper-local",
        sourceText: pipeline.changed ? rawTranscript : "",
        text: nextTranscript,
        timings: forgeCleanupMetadata?.timings
          || normalizeAudioHistoryTimings({ ...result, totalMs: resultLatencyMs })
          || null,
        variants: forgeHistoryVariants,
      });
      refreshWidgetHistory();

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
        await stopCloudVoiceAgentStream(getForgeVoiceControlRequest()).catch(() => {});
      }
      const preservedWarmBuffer = await releaseOrPreserveFailedAudioBuffer(audioBuffer, recordingError);
      if (recordingRunRef.current !== recordingRunId) {
        return;
      }
      if (!preservedWarmBuffer) {
        setWidgetAudioStats(EMPTY_AUDIO_INPUT_STATS);
      }
      const messageText = getErrorMessage(recordingError, "Unable to transcribe audio.");

      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(messageText);
    }
  }, [getForgeVoiceControlRequest, publishCancelledTranscript, refreshWidgetHistory, releaseOrPreserveFailedAudioBuffer]);

  /**
   * Salvages a locally captured recording that was cancelled mid-flight: the
   * transcription runs detached in the background and lands in history tagged
   * cancelled, never inserted into a target.
   */
  const salvageLocalCancelledCapture = useCallback((captureResult, captureStats) => {
    const audioMs = Number(captureResult?.audioMs || 0);
    const audioBase64 = String(captureResult?.audioBase64 || "");

    if (!audioBase64 || audioMs < AUDIO_CANCEL_SALVAGE_MIN_AUDIO_MS) {
      return;
    }

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
    if (pushToTalkDownRef.current) {
      suppressPushToTalkUntilReleaseRef.current = true;
    }
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
    if (
      currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
      && forgeVoiceStartPendingRunRef.current === recordingRunId
    ) {
      forgeVoiceStartPendingRunRef.current = 0;
    }
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
        if (audioBufferRef.current === audioBuffer) {
          audioBufferGenerationRef.current += 1;
          audioBufferStartRef.current = null;
          audioBufferReadyAtRef.current = 0;
          audioBufferRef.current = null;
        }
        const captureTeardown = audioBuffer
          ? trackAudioCaptureTeardown((async () => {
            await audioBuffer.finishCapture({ decode: false }).catch(() => null);
            await audioBuffer?.close?.().catch(() => {});
          })())
          : Promise.resolve(null);
        resetWidgetToStartState();
        setMessage("Cancelled");
        void (async () => {
          await Promise.all([
            stopCloudVoiceAgentStream(getForgeVoiceControlRequest()).catch(() => {}),
            captureTeardown,
          ]);
          await forgeVoiceTtsPlayerRef.current?.close?.().catch(() => {});
          forgeVoiceTtsPlayerRef.current = null;
        })();
        return;
      }

      const cancelledAt = Date.now();
      if (salvage) {
        // Let the in-flight transcription finish detached; the invalidated
        // stopRecording run publishes it as cancelled instead of inserting.
        cancelSalvageRunRef.current = recordingRunId;
      }

      // The in-flight stopRecording task owns this buffer from here. Detach the
      // widget ref synchronously so the next hotkey warms a fresh capture window
      // instead of reusing a buffer whose finishCapture is still pending.
      if (audioBufferRef.current === audioBuffer) {
        audioBufferGenerationRef.current += 1;
        audioBufferStartRef.current = null;
        audioBufferReadyAtRef.current = 0;
        audioBufferRef.current = null;
      }

      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_LOCAL) {
        const partialSessionId = localWhisperPartialSessionIdRef.current;
        const partialText = localWhisperPartialTextRef.current.trim();
        if (cancelSalvageRunRef.current === recordingRunId) {
          cancelSalvageRunRef.current = 0;
        }
        localWhisperPartialSessionIdRef.current = "";
        localWhisperPartialHistoryIdRef.current = "";
        localWhisperPartialFailedRef.current = false;
        localWhisperPartialTextRef.current = "";
        if (partialText && salvage) {
          void publishCancelledTranscript(
            {
              audioMs: recordingStartedAt > 0 ? Math.max(0, Date.now() - recordingStartedAt) : 0,
              partial: true,
              text: partialText,
            },
            AUDIO_TRANSCRIPTION_PROVIDER_LOCAL,
          );
        }
        trackAudioCaptureTeardown((async () => {
          await Promise.all([
            invoke("cancel_whisper_transcription").catch(() => {}),
            partialSessionId
              ? cancelLocalWhisperPartialTranscription({ sessionId: partialSessionId }).catch(() => {})
              : Promise.resolve(),
          ]);
          await audioBuffer?.finishCapture({ decode: false }).catch(() => null);
          await audioBuffer?.close?.().catch(() => {});
        })());
        resetWidgetToStartState();
        setMessage(partialText && salvage ? "Cancelled, saving to history" : "Cancelled");
        return;
      }

      if (
        currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
        || currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE
      ) {
        const providerStop = currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
          ? invoke("stop_deepgram_realtime_transcription").catch(() => null)
          : invoke("stop_forge_dictation_transcription", {
            request: { cancel: true },
          }).catch(() => null);
        const captureFinish = audioBuffer
          ? (async () => {
            const captureResult = await audioBuffer.finishCapture({ decode: false }).catch(() => null);
            await audioBuffer?.close?.().catch(() => {});
            return captureResult;
          })()
          : Promise.resolve(null);
        const cancelTeardown = trackAudioCaptureTeardown((async () => {
          const [providerResult, captureResult] = await Promise.all([providerStop, captureFinish]);
          if (salvage && cancelSalvageRunRef.current === recordingRunId) {
            const published = await publishCancelledTranscript(
              {
                ...(providerResult || {}),
                audioMs: Number(
                  captureResult?.audioMs
                  || providerResult?.audioMs
                  || Number(providerResult?.audioSeconds || 0) * 1000
                  || 0,
                ),
                latencyMs: Math.max(0, Date.now() - cancelledAt),
              },
              currentProvider,
            );
            if (published && cancelSalvageRunRef.current === recordingRunId) {
              cancelSalvageRunRef.current = 0;
            }
          }
          return captureResult;
        })());
        void cancelTeardown;
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
      if (
        currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_LOCAL
        && localWhisperPartialSessionIdRef.current
        && !localWhisperPartialFailedRef.current
      ) {
        const partialSessionId = localWhisperPartialSessionIdRef.current;
        const partialText = localWhisperPartialTextRef.current.trim();
        const audioMs = recordingStartedAt > 0 ? Math.max(0, Date.now() - recordingStartedAt) : 0;
        localWhisperPartialSessionIdRef.current = "";
        localWhisperPartialHistoryIdRef.current = "";
        localWhisperPartialFailedRef.current = false;
        localWhisperPartialTextRef.current = "";
        if (partialText) {
          void publishCancelledTranscript(
            {
              audioMs,
              latencyMs: Math.max(0, Date.now() - submittedAt),
              partial: true,
              text: partialText,
            },
            AUDIO_TRANSCRIPTION_PROVIDER_LOCAL,
          );
        }
        trackAudioCaptureTeardown((async () => {
          await Promise.all([
            invoke("cancel_whisper_transcription").catch(() => {}),
            cancelLocalWhisperPartialTranscription({ sessionId: partialSessionId }).catch(() => {}),
          ]);
          await audioBuffer.finishCapture({ decode: false }).catch(() => null);
          await audioBuffer?.close?.().catch(() => {});
        })());
        resetWidgetToStartState();
        setMessage(partialText ? "Cancelled, saving to history" : "Cancelled");
        return;
      }
      const captureTeardown = trackAudioCaptureTeardown((async () => {
        const captureResult = await audioBuffer.finishCapture({ decode: false }).catch(() => null);
        await audioBuffer?.close?.().catch(() => {});
        return captureResult;
      })());
      resetWidgetToStartState();
      setMessage(currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
        ? "Cancelled"
        : "Cancelled, saving to history");

      void (async () => {
        if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
          void trackAudioCaptureTeardown((async () => {
            const [realtimeResult, captureResult] = await Promise.all([
              invoke("stop_deepgram_realtime_transcription").catch(() => null),
              captureTeardown,
            ]);
            await publishCancelledTranscript(
              {
                ...(realtimeResult || {}),
                audioMs: Number(captureResult?.audioMs || realtimeResult?.audioMs || 0),
                latencyMs: Math.max(0, Date.now() - submittedAt),
              },
              AUDIO_TRANSCRIPTION_PROVIDER_CLOUD,
            );
            return captureResult;
          })());
        } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE) {
          // Cancelled cloud dictation still returns the transcript so far.
          void trackAudioCaptureTeardown((async () => {
            const [dictationResult, captureResult] = await Promise.all([
              invoke("stop_forge_dictation_transcription", {
                request: { cancel: true },
              }).catch(() => null),
              captureTeardown,
            ]);
            await publishCancelledTranscript(
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
            return captureResult;
          })());
        } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
          void trackAudioCaptureTeardown((async () => {
            const [, captureResult] = await Promise.all([
              stopCloudVoiceAgentStream(getForgeVoiceControlRequest()).catch(() => {}),
              captureTeardown,
            ]);
            await forgeVoiceTtsPlayerRef.current?.close?.().catch(() => {});
            forgeVoiceTtsPlayerRef.current = null;
            return captureResult;
          })());
        } else {
          const captureResult = await captureTeardown;
          salvageLocalCancelledCapture(captureResult, captureStats);
        }
      })();
      return;
    }

    if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
      forgeVoiceEventsActiveRef.current = false;
    }
    const localPartialSessionIdForCancel = currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_LOCAL
      ? localWhisperPartialSessionIdRef.current
      : "";
    if (localPartialSessionIdForCancel) {
      localWhisperPartialSessionIdRef.current = "";
    }
    localWhisperPartialHistoryIdRef.current = "";
    localWhisperPartialFailedRef.current = false;
    localWhisperPartialTextRef.current = "";
    resetWidgetToStartState();
    trackAudioCaptureTeardown((async () => {
      await closeWarmBuffer().catch(() => {});
      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
        await invoke("stop_deepgram_realtime_transcription").catch(() => {});
      } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE) {
        await invoke("stop_forge_dictation_transcription", { request: { cancel: true } }).catch(() => {});
      } else if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT) {
        await stopCloudVoiceAgentStream(getForgeVoiceControlRequest()).catch(() => {});
        await forgeVoiceTtsPlayerRef.current?.close?.().catch(() => {});
        forgeVoiceTtsPlayerRef.current = null;
      } else {
        if (localPartialSessionIdForCancel) {
          await cancelLocalWhisperPartialTranscription({
            sessionId: localPartialSessionIdForCancel,
          }).catch(() => {});
        }
        await invoke("cancel_whisper_transcription").catch(() => {});
      }
    })());
  }, [closeWarmBuffer, getForgeVoiceControlRequest, publishCancelledTranscript, recordingStartedAt, resetWidgetToStartState, salvageLocalCancelledCapture, showCancelNotice, trackAudioCaptureTeardown]);

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

  // Errors (cloud dictation failures included) show briefly in the widget
  // surface, then the widget returns to its resting state on its own.
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
    if (!error || widgetState === "error") {
      return undefined;
    }
    const errorText = error;
    const timer = window.setTimeout(() => {
      if (widgetStateRef.current !== "error") {
        setError((currentError) => (currentError === errorText ? "" : currentError));
      }
    }, AUDIO_WIDGET_ERROR_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [error, widgetState]);

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
      forgeVoiceStartPendingRunRef.current = 0;
      forgeVoiceEventsActiveRef.current = false;
      if (hadForgeVoice) {
        stopCloudVoiceAgentStream(getForgeVoiceControlRequest()).catch(() => {});
        forgeVoiceTtsPlayerRef.current?.close?.().catch(() => {});
        forgeVoiceTtsPlayerRef.current = null;
      }
      if (localWhisperPartialSessionIdRef.current) {
        cancelLocalWhisperPartialTranscription({
          sessionId: localWhisperPartialSessionIdRef.current,
        }).catch(() => {});
        localWhisperPartialSessionIdRef.current = "";
      }
      closeWarmBuffer();
    };
  }, [closeWarmBuffer, getForgeVoiceControlRequest, refreshShortcutStatus, refreshStatus]);

  useEffect(() => {
    if (widgetState === "setup" || widgetState === "missing") {
      closeWarmBuffer();
    }
  }, [closeWarmBuffer, widgetState]);

  useEffect(() => {
    if ((widgetState !== "ready" && widgetState !== "error") || !hasAudioInputSetup()) {
      return undefined;
    }

    let disposed = false;
    startWarmBuffer({ notifyOnPermissionError: false }).catch(() => {
      if (!disposed && (widgetStateRef.current === "ready" || widgetStateRef.current === "error")) {
        setMessage("Audio input standby");
      }
    });

    return () => {
      disposed = true;
    };
  }, [startWarmBuffer, widgetState]);

  useEffect(() => {
    if (
      transcriptionProvider !== AUDIO_TRANSCRIPTION_PROVIDER_FORGE_AGENT
      || widgetState !== "ready"
    ) {
      return;
    }

    prewarmCloudVoiceAgentStream().catch(() => {});
  }, [transcriptionProvider, widgetState]);

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
      const nextWidgetStyle = readAudioWidgetStyle();
      if (
        nextWidgetStyle === AUDIO_WIDGET_STYLE_BAR
        && widgetStyleRef.current !== AUDIO_WIDGET_STYLE_BAR
      ) {
        runWidgetWindowAction(saveBubblePlacementFromWindow);
      }
      setRecorderMode(readAudioRecorderMode());
      setAudioWidgetTheme(readAudioWidgetTheme());
      setWidgetStyle(nextWidgetStyle);
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
  }, [refreshShortcutStatus, refreshStatus, runWidgetWindowAction, saveBubblePlacementFromWindow]);

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

    listen(AUDIO_FORGE_DICTATION_RAW_RESULT_EVENT, async (event) => {
      if (disposed) {
        return;
      }

      const rawText = String(event.payload?.rawText || event.payload?.text || "").trim();
      const historyId = String(event.payload?.historyId || "").trim();
      if (!rawText || !historyId) {
        return;
      }

      const createdAt = String(event.payload?.createdAt || "").trim() || new Date().toISOString();
      const timings = normalizeAudioHistoryTimings(event.payload);
      await publishAudioTranscriptionResult({
        audioMs: Math.max(0, Number(event.payload?.audioSeconds || 0) * 1000),
        cleanupModel: event.payload?.cleanupModel || "",
        cleanupProvider: event.payload?.cleanupProvider || "",
        createdAt,
        defaultVariantId: AUDIO_TRANSCRIPTION_VARIANT_RAW,
        id: historyId,
        language: readDeepgramLanguage(),
        latencyMs: Math.max(0, Date.now() - new Date(createdAt).getTime()),
        llmCleaned: false,
        provider: AUDIO_TRANSCRIPTION_PROVIDER_FORGE,
        rawText,
        source: "forge-nova3-dictation-raw",
        text: rawText,
        timings,
        variants: [
          {
            id: AUDIO_TRANSCRIPTION_VARIANT_RAW,
            label: "Raw",
            text: rawText,
          },
        ],
      });
      refreshWidgetHistory();
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
  }, [refreshWidgetHistory]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(AUDIO_FORGE_DICTATION_CLEANED_RESULT_EVENT, async (event) => {
      if (disposed) {
        return;
      }

      const cleanedText = String(event.payload?.text || "").trim();
      const historyId = String(event.payload?.historyId || "").trim();
      if (!cleanedText || !historyId) {
        return;
      }

      const history = readAudioTranscriptionHistory();
      const existing = history.find((entry) => entry?.id === historyId) || null;
      if (!existing || existing.status === AUDIO_TRANSCRIPTION_STATUS_CANCELLED) {
        return;
      }
      const createdAt = String(event.payload?.createdAt || existing?.createdAt || "").trim()
        || new Date().toISOString();
      const rawText = String(
        event.payload?.rawText
        || event.payload?.raw_text
        || existing?.rawText
        || existing?.text
        || "",
      ).trim();
      const polishMetadata = buildAudioPolishMetadata(event.payload);
      const timings = polishMetadata?.timings
        || normalizeAudioHistoryTimings(event.payload)
        || normalizeAudioHistoryTimings(existing)
        || null;
      const audioMs = Number(existing?.audioMs || 0) > 0
        ? Number(existing.audioMs)
        : Math.max(0, Number(event.payload?.audioSeconds || 0) * 1000);
      const latencyMs = Number(existing?.latencyMs || 0) > 0
        ? Number(existing.latencyMs)
        : Math.max(0, Date.now() - new Date(createdAt).getTime());
      const variants = [
        ...(rawText ? [{
          id: AUDIO_TRANSCRIPTION_VARIANT_RAW,
          label: "Raw",
          text: rawText,
        }] : []),
        {
          id: AUDIO_TRANSCRIPTION_VARIANT_CLEANED,
          label: "Cleaned",
          ...(polishMetadata ? { polish: polishMetadata } : {}),
          text: cleanedText,
        },
      ];

      await publishAudioTranscriptionResult({
        ...(existing || {}),
        audioMs,
        cleanupModel: event.payload?.cleanupModel || existing?.cleanupModel || "",
        cleanupProvider: event.payload?.cleanupProvider || existing?.cleanupProvider || "",
        createdAt,
        defaultVariantId: AUDIO_TRANSCRIPTION_VARIANT_CLEANED,
        id: historyId,
        language: existing?.language || readDeepgramLanguage(),
        latencyMs,
        llmCleaned: Boolean(event.payload?.llmCleaned ?? true),
        provider: AUDIO_TRANSCRIPTION_PROVIDER_FORGE,
        rawText,
        source: "forge-nova3-llm-cleaned",
        status: existing?.status || AUDIO_TRANSCRIPTION_STATUS_INSERTED,
        text: cleanedText,
        timings,
        variants,
      });
      refreshWidgetHistory();
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
  }, [refreshWidgetHistory]);

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
      const currentState = widgetStateRef.current;
      if (currentState !== "recording" && currentState !== "transcribing") {
        return;
      }
      const activeProvider = readAudioTranscriptionProvider();
      const eventProvider = String(event.payload?.provider || "").trim();
      if (eventProvider === "forge") {
        const eventHistoryId = String(event.payload?.historyId || "").trim();
        const activeHistoryId = String(forgeDictationHistoryRef.current?.id || "").trim();
        if (
          activeProvider !== AUDIO_TRANSCRIPTION_PROVIDER_FORGE
          || !eventHistoryId
          || eventHistoryId !== activeHistoryId
        ) {
          return;
        }
      } else if (eventProvider === "deepgram") {
        if (activeProvider !== AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
          return;
        }
      } else if (eventProvider === "whisper-local") {
        const eventSessionId = String(event.payload?.sessionId || "").trim();
        if (
          activeProvider !== AUDIO_TRANSCRIPTION_PROVIDER_LOCAL
          || !eventSessionId
          || eventSessionId !== localWhisperPartialSessionIdRef.current
        ) {
          return;
        }
      } else {
        return;
      }

      if (eventProvider === "whisper-local") {
        localWhisperPartialTextRef.current = text;
      }
      setRealtimeTranscript(text);
      const liveLabel = eventProvider === "forge"
        ? "Forge cloud"
        : eventProvider === "whisper-local"
          ? "Local Whisper"
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
        void stopCloudVoiceAgentStream(getForgeVoiceControlRequest()).catch(() => {});
        void forgeVoiceTtsPlayerRef.current?.close?.().catch(() => {});
        forgeVoiceTtsPlayerRef.current = null;
        return;
      }

      if (kind === "voice_agent_turn_finished" || kind === "voice_agent_finished") {
        forgeVoiceEventsActiveRef.current = false;
        void (async () => {
          await stopCloudVoiceAgentStream(getForgeVoiceControlRequest()).catch(() => {});
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
      if (suppressPushToTalkUntilReleaseRef.current) {
        return;
      }
      handleRecorderShortcutPressed();
      return;
    }

    if (suppressPushToTalkUntilReleaseRef.current) {
      suppressPushToTalkUntilReleaseRef.current = false;
      pushToTalkDownRef.current = false;
      stopAfterStartRef.current = false;
      return;
    }
    handleRecorderShortcutReleased();
  }, [clearHybridPendingDiscard, handleRecorderShortcutPressed, handleRecorderShortcutReleased]);

  useEffect(() => {
    document.documentElement.dataset.audioWidget = "true";
    applyAudioWidgetSpacePreference();
    document.documentElement.dataset.audioWidgetTheme = normalizeAudioWidgetTheme(audioWidgetTheme);
    document.body.dataset.audioWidget = "true";
    document.body.dataset.forgeSpace = readAudioWidgetSpaceMode();
    document.body.dataset.audioWidgetTheme = normalizeAudioWidgetTheme(audioWidgetTheme);

    const handleSpaceStorage = (event) => {
      if (event.key === FORGE_SPACE_MODE_STORAGE_KEY) {
        applyAudioWidgetSpacePreference(event.newValue);
      }
    };
    window.addEventListener("storage", handleSpaceStorage);

    return () => {
      window.removeEventListener("storage", handleSpaceStorage);
      delete document.documentElement.dataset.audioWidget;
      delete document.documentElement.dataset.audioWidgetTheme;
      delete document.documentElement.dataset.forgeSpace;
      delete document.body.dataset.audioWidget;
      delete document.body.dataset.audioWidgetTheme;
      delete document.body.dataset.forgeSpace;
    };
  }, [audioWidgetTheme]);

  const widgetPushToTalkShortcut = shortcutStatus?.pushToTalk?.shortcut || defaultPushToTalkShortcut();
  const widgetCancelShortcut = shortcutStatus?.cancel?.shortcut || "Escape";

  useEffect(() => {
    const onKeyDown = (event) => {
      if (cancelShortcutMatchesEvent(
        widgetCancelShortcut,
        event,
        widgetPushToTalkShortcut,
        pushToTalkDownRef.current,
      )) {
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
      if (suppressPushToTalkUntilReleaseRef.current) {
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        return;
      }
      handleRecorderShortcutPressed();
    };

    const onKeyUp = (event) => {
      if (!shortcutMatchesEvent(widgetPushToTalkShortcut, event)) {
        return;
      }

      event.preventDefault();
      if (suppressPushToTalkUntilReleaseRef.current) {
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        suppressPushToTalkUntilReleaseRef.current = false;
        pushToTalkDownRef.current = false;
        stopAfterStartRef.current = false;
        return;
      }
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

        if (
          (status.pressed || status.phase === "pressed")
          && !suppressPushToTalkUntilReleaseRef.current
        ) {
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
  const latestHistoryText = String(widgetHistory[0]?.text || "").trim();
  const polishState = polishStatus.state || "idle";
  const polishLoading = polishState === "loading";
  const polishCloudUnavailable = !forgeCloudConnected;
  const polishDisabled = polishLoading || polishCloudUnavailable || !widgetManualPolishingEnabled;
  const renderHistoryQuickButton = (slot, label, available, focusable = true) => {
    const copied = copiedWidgetHistorySlot === slot;
    return (
      <AudioHistoryQuickButton
        aria-label={label}
        data-copied={copied ? "true" : undefined}
        data-slot={slot}
        disabled={!available}
        onClick={(event) => {
          event.stopPropagation();
          copyWidgetHistorySlot(slot);
        }}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        tabIndex={available && focusable ? 0 : -1}
        title={available ? label : (slot === "latest" ? "No transcript yet" : "No previous transcript")}
        type="button"
      >
        {copied ? <ButtonCheckIcon aria-hidden="true" /> : <ButtonCopyIcon aria-hidden="true" />}
      </AudioHistoryQuickButton>
    );
  };
  const renderPolishQuickButton = (focusable = true) => {
    const title = !widgetManualPolishingEnabled
      ? "Manual polish is disabled in the Audio tab"
      : polishCloudUnavailable
      ? "Connect to Diff Forge Cloud to polish text"
      : polishState === "error" && polishStatus.error
        ? polishStatus.error
        : "Polish clipboard or latest transcription";
    return (
      <AudioHistoryQuickButton
        aria-label={!widgetManualPolishingEnabled
          ? "Polish unavailable: manual polish disabled"
          : polishCloudUnavailable
            ? "Polish unavailable: Diff Forge Cloud disconnected"
            : "Polish clipboard or latest transcription"}
        data-polish-state={polishState !== "idle" ? polishState : undefined}
        data-slot="polish"
        disabled={polishDisabled}
        onClick={(event) => {
          event.stopPropagation();
          if (polishDisabled) {
            return;
          }
          polishLatestTranscript();
        }}
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.stopPropagation();
        }}
        tabIndex={!polishDisabled && focusable ? 0 : -1}
        title={title}
        type="button"
      >
        {polishLoading ? (
          <AudioPolishQuickSpinner aria-hidden="true" />
        ) : polishState === "success" ? (
          <ButtonCheckIcon aria-hidden="true" />
        ) : polishState === "error" ? (
          <ButtonCloseIcon aria-hidden="true" />
        ) : (
          <ButtonPolishIcon aria-hidden="true" />
        )}
      </AudioHistoryQuickButton>
    );
  };

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
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (event.detail === 0) {
            dismissCancelNotice();
          }
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dismissCancelNotice();
        }}
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
          <AudioBarIdleShell
            aria-label="Dictation bar"
            data-geometry-ready={barGeometryReady ? "true" : "false"}
            data-hover={barIdleHover ? "true" : "false"}
            data-theme={audioWidgetTheme}
            onMouseLeave={clearBarIdleHover}
            onMouseMove={updateBarIdleHoverFromPointer}
            onPointerCancel={clearBarIdleHover}
            onPointerEnter={updateBarIdleHoverFromPointer}
            onPointerLeave={clearBarIdleHover}
            onPointerMove={updateBarIdleHoverFromPointer}
          >
            <AudioBarIdleReveal>
              <AudioBarHistoryActions aria-label="Dictation copy shortcut" data-side="left">
                {renderHistoryQuickButton("latest", "Copy latest transcription", Boolean(latestHistoryText))}
              </AudioBarHistoryActions>
              <AudioBarRecordCluster>
                <AudioBarRecordButton
                  aria-label={`Start dictation (${dictateShortcutLabel})`}
                  onClick={toggleTalk}
                  title={`Start dictation (${dictateShortcutLabel})`}
                  type="button"
                />
                <AudioBarShortcutHint aria-hidden="true">
                  {dictateShortcutLabel}
                </AudioBarShortcutHint>
              </AudioBarRecordCluster>
              <AudioBarHistoryActions aria-label="Transcript polish shortcut" data-side="right">
                {renderPolishQuickButton()}
              </AudioBarHistoryActions>
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
          data-geometry-ready={barGeometryReady ? "true" : "false"}
          data-mode={cancelNotice ? "notice" : "active"}
          data-theme={audioWidgetTheme}
          data-visible={barVisible && barGeometryReady ? "true" : "false"}
        >
          {cancelNotice ? cancelNoticeSurface : (
            <AudioBarSurface
              key={barGeometryReady ? `${barGeometryKey}-ready` : `${barGeometryKey}-pending`}
              role="status"
              title={isRecordingFocus || widgetState === "arming"
                ? "Use the stop button or shortcut to finish. X cancels."
                : undefined}
            >
              <AudioBarCancelButton
                aria-label="Cancel dictation"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.detail === 0) {
                    cancelRecording();
                  }
                }}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelRecording();
                }}
                title="Cancel: stop without pasting. The transcript is still saved to History."
                type="button"
              >
                ×
              </AudioBarCancelButton>
              <AudioBarMeter aria-hidden="true">
                {Array.from({ length: AUDIO_BAR_METER_BARS }, (_, index) => (
                  <span
                    key={index}
                    style={buildWidgetMeterBarStyle(index, widgetLevel, isProcessingFocus, AUDIO_BAR_METER_BARS)}
                  />
                ))}
              </AudioBarMeter>
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
          data-mode="notice"
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
        <AudioWidgetErrorPopover data-theme={audioWidgetTheme} role="alert" title={errorFrameText}>
          {errorFrameText}
        </AudioWidgetErrorPopover>
      )}
      <AudioWidgetShell
        aria-label={widgetLabel}
        data-closing={isClosingFocus ? "true" : undefined}
        data-concealed={widgetStyle === AUDIO_WIDGET_STYLE_HIDDEN && !widgetActive ? "true" : undefined}
        data-dragging={widgetDragging ? "true" : undefined}
        data-error-frame={errorFrameActive ? "true" : undefined}
        data-focus={isFocusedWidget ? "true" : undefined}
        data-handoff={isCompactHandoff ? "true" : undefined}
        data-hover={bubbleHover && !widgetDragging ? "true" : undefined}
        data-opening={isOpeningFocus ? "true" : undefined}
        data-state={widgetState}
        data-theme={audioWidgetTheme}
        data-history-tray={bubbleHistoryTrayActive ? "true" : undefined}
        data-history-tray-frame={bubbleHistoryTrayFrameActive ? "true" : undefined}
        onMouseEnter={handleBubbleHoverEnter}
        onMouseLeave={handleBubbleHoverLeave}
        onPointerCancel={handleBubbleHoverLeave}
        onPointerDown={dragWidget}
        onPointerEnter={handleBubbleHoverEnter}
        onPointerLeave={handleBubbleHoverLeave}
      >
        <AudioWidgetFocusStage
          aria-label={widgetLabel}
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
            data-animate={
              isRecordingFocus || isProcessingFocus || widgetState === "arming"
                ? "true"
                : undefined
            }
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
              event.preventDefault();
              event.stopPropagation();
              if (event.detail === 0) {
                cancelRecording();
              }
            }}
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              cancelRecording();
            }}
            title="Cancel (transcript is saved to history)"
            type="button"
          >
            ×
          </AudioWidgetCancelButton>
        )}
        <AudioWidgetHistoryTray
          aria-hidden={!bubbleHistoryTrayVisible}
          aria-label="Dictation quick actions"
        >
          {renderHistoryQuickButton("latest", "Copy latest transcription", Boolean(latestHistoryText), bubbleHistoryTrayVisible)}
          {renderPolishQuickButton(bubbleHistoryTrayVisible)}
        </AudioWidgetHistoryTray>
      </AudioWidgetShell>
    </>
  );
}

export function AudioWidgetErrorOverlayWindow() {
  const [payload, setPayload] = useState(readAudioWidgetErrorOverlayPayload);

  useEffect(() => {
    if (typeof document === "undefined") {
      return undefined;
    }
    document.documentElement.dataset.audioWidgetError = "true";
    document.body.dataset.audioWidgetError = "true";
    applyAudioWidgetSpacePreference();
    document.documentElement.dataset.audioWidgetTheme = normalizeAudioWidgetTheme(
      payload?.theme || AUDIO_WIDGET_THEME_DARK,
    );
    document.documentElement.dataset.forgeTheme = normalizeAudioWidgetTheme(
      payload?.theme || AUDIO_WIDGET_THEME_DARK,
    );
    document.body.dataset.audioWidgetTheme = normalizeAudioWidgetTheme(
      payload?.theme || AUDIO_WIDGET_THEME_DARK,
    );
    document.body.dataset.forgeTheme = normalizeAudioWidgetTheme(
      payload?.theme || AUDIO_WIDGET_THEME_DARK,
    );

    const handleSpaceStorage = (event) => {
      if (event.key === FORGE_SPACE_MODE_STORAGE_KEY) {
        applyAudioWidgetSpacePreference(event.newValue);
      }
    };
    window.addEventListener("storage", handleSpaceStorage);

    return () => {
      window.removeEventListener("storage", handleSpaceStorage);
      delete document.documentElement.dataset.audioWidgetError;
      delete document.body.dataset.audioWidgetError;
      delete document.documentElement.dataset.audioWidgetTheme;
      delete document.documentElement.dataset.forgeTheme;
      delete document.documentElement.dataset.forgeSpace;
      delete document.body.dataset.audioWidgetTheme;
      delete document.body.dataset.forgeTheme;
      delete document.body.dataset.forgeSpace;
    };
  }, [payload?.theme]);

  useEffect(() => {
    let disposed = false;
    let unlistenOverlay = () => {};

    const applyPayload = (value) => {
      if (disposed) {
        return;
      }
      setPayload(normalizeAudioWidgetErrorOverlayPayload(value));
    };

    const handleStorage = (event) => {
      if (event.key === AUDIO_WIDGET_ERROR_OVERLAY_STORAGE_KEY) {
        applyPayload(readAudioWidgetErrorOverlayPayload());
      }
    };

    window.addEventListener("storage", handleStorage);
    listen(AUDIO_WIDGET_ERROR_OVERLAY_EVENT, (event) => {
      applyPayload(event?.payload);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten();
        return;
      }
      unlistenOverlay = nextUnlisten;
    }).catch(() => {});

    return () => {
      disposed = true;
      unlistenOverlay();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const activePayload = payload?.visible && payload.message ? payload : null;

  return (
    <>
      <GlobalStyle />
      <AudioWidgetErrorOverlayShell
        aria-hidden={activePayload ? undefined : "true"}
        data-theme={activePayload?.theme || AUDIO_WIDGET_THEME_DARK}
        data-visible={activePayload ? "true" : "false"}
      >
        {activePayload ? (
          <AudioWidgetErrorOverlayCard
            key={activePayload.id}
            role="alert"
            title={activePayload.message}
          >
            {activePayload.message}
          </AudioWidgetErrorOverlayCard>
        ) : null}
      </AudioWidgetErrorOverlayShell>
    </>
  );
}

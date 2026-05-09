import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AUDIO_TRANSCRIPTION_RESULT_EVENT,
  AUDIO_TRANSCRIPTION_PROVIDER_CLOUD,
  AUDIO_TRANSCRIPTION_PROVIDER_LOCAL,
  arrayBufferToBase64,
  formatAudioPercent,
  getAudioInputErrorMessage,
  hasAudioInputSetup,
  listAudioInputDevices,
  markAudioInputSetupReady,
  prepareWhisperModel,
  publishAudioTranscriptionResult,
  readAudioTranscriptionProvider,
  readAutoOpenAudioRecorder,
  readDeepgramApiKey,
  readDeepgramLanguage,
  readLastAudioTranscriptionResult,
  readSelectedAudioInputDeviceId,
  startLowPowerAudioBuffer,
  writeAudioTranscriptionProvider,
  writeAutoOpenAudioRecorder,
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
  AudioStatusGrid,
  AudioModeGrid,
  AudioModeButton,
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
  AudioResultsPanel,
  AudioResultLine,
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
  AudioWidgetFocusStage,
  AudioWidgetHeader,
  AudioWidgetTitle,
  AudioWidgetLogo,
  AudioWidgetMeter,
  AudioWidgetLoader,
  AudioWidgetProcessingText,
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
  ButtonDeleteIcon,
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

export const AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT = "forge-audio-model-download-progress";
export const AUDIO_WIDGET_HASH = "#/audio-widget";
const AUDIO_PUSH_TO_TALK_EVENT = "forge-audio-push-to-talk";
const AUDIO_REALTIME_TRANSCRIPT_EVENT = "forge-audio-realtime-transcript";
const AUDIO_RECORDING_MAX_SECONDS = 90;
const AUDIO_RECORDING_TIMER_MS = 250;
const AUDIO_INPUT_METER_BARS = 24;
const AUDIO_WIDGET_COMPACT_SIZE = { width: 64, height: 64 };
const AUDIO_WIDGET_FOCUS_SIZE = { width: 292, height: 64 };
const EMPTY_AUDIO_INPUT_STATS = { bufferMs: 0, peak: 0, rms: 0 };
const isFocusedAudioWidgetState = (state) => state === "arming"
  || state === "recording"
  || state === "transcribing";
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
  const level = Math.round(Math.max(0, Math.min(100, Number(value) || 0)));
  return `${level}%`;
}

function formatResultTime(value) {
  const date = value ? new Date(value) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AudioWorkspaceView({
  audioActionState,
  audioDownloadProgress,
  audioError,
  audioModelStatus,
  audioStatusState,
  onDownloadModel,
  onOpenWidget,
  onRefreshStatus,
  onUninstallModel,
  workspace,
}) {
  const [isUninstallModalOpen, setUninstallModalOpen] = useState(false);
  const [audioInputDevices, setAudioInputDevices] = useState([]);
  const [audioInputDeviceId, setAudioInputDeviceId] = useState(readSelectedAudioInputDeviceId);
  const [audioInputState, setAudioInputState] = useState(hasAudioInputSetup() ? "ready" : "needs-access");
  const [audioInputMessage, setAudioInputMessage] = useState("Choose an input source, then enable it for local dictation.");
  const [audioInputStats, setAudioInputStats] = useState(EMPTY_AUDIO_INPUT_STATS);
  const [audioMode, setAudioMode] = useState(readAudioTranscriptionProvider);
  const [deepgramApiKey, setDeepgramApiKey] = useState(readDeepgramApiKey);
  const [deepgramLanguage, setDeepgramLanguage] = useState(readDeepgramLanguage);
  const [autoOpenRecorder, setAutoOpenRecorder] = useState(readAutoOpenAudioRecorder);
  const [latestAudioResult, setLatestAudioResult] = useState(readLastAudioTranscriptionResult);
  const audioInputPreviewRef = useRef(null);
  const audioInputRunRef = useRef(0);
  const audioInputDeviceIdRef = useRef(audioInputDeviceId);
  const audioInputStateRef = useRef(audioInputState);
  const isCloudMode = audioMode === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD;
  const deepgramReady = Boolean(deepgramApiKey.trim());
  const installed = Boolean(audioModelStatus?.installed);
  const recorderReady = isCloudMode ? deepgramReady : installed;
  const isBusy = audioActionState === "downloading"
    || audioActionState === "opening"
    || audioActionState === "uninstalling"
    || (!isCloudMode && audioStatusState === "checking");
  const canUninstall = Boolean(audioModelStatus?.managedAssetsInstalled || audioModelStatus?.modelInstalled);
  const downloadPercent = audioDownloadProgress?.percent;
  const modelBytes = Number(audioModelStatus?.bytes || 0);
  const modelPath = audioModelStatus?.modelPath || "App data";
  const runtimePath = audioModelStatus?.runtimePath || "";
  const modelLabel = audioModelStatus?.modelName || "Whisper base.en";
  const runtimeLabel = audioModelStatus?.runtimePackageName || audioModelStatus?.runtimeName || "whisper.cpp CLI";
  const diskLabel = audioModelStatus?.approximateDiskMb
    ? `${audioModelStatus.approximateDiskMb} MB`
    : formatFileSize(modelBytes);
  const memoryLabel = audioModelStatus?.approximateMemoryMb
    ? `~${audioModelStatus.approximateMemoryMb} MB`
    : "Local CPU";
  const installLabel = audioModelStatus?.runtimeInstallable === false ? "Install model" : "Install Whisper";
  const missingLabel = audioModelStatus?.modelInstalled
    ? "Runtime missing"
    : audioModelStatus?.runtimeInstalled
      ? "Model missing"
      : "Not installed";
  const cloudLanguageLabel = DEEPGRAM_LANGUAGE_OPTIONS.find((option) => option.value === deepgramLanguage)?.label || deepgramLanguage || "English";
  const audioModeStatusLabel = isCloudMode
    ? (deepgramReady ? "Cloud ready" : "API key needed")
    : (installed ? "Local ready" : audioActionState === "downloading" ? "Downloading" : missingLabel);
  const isUninstalling = audioActionState === "uninstalling";
  const selectedAudioInput = audioInputDevices.find((device) => device.deviceId === audioInputDeviceId);
  const selectedAudioInputLabel = selectedAudioInput?.label || "Default microphone";
  const audioInputLevel = Math.min(100, Math.round(Math.max(audioInputStats.rms * 2400, audioInputStats.peak * 100)));
  const audioInputStatusLabel = {
    checking: "Checking",
    "needs-access": "Setup needed",
    ready: "Ready",
    starting: "Opening",
    previewing: "Monitoring",
    error: "Input issue",
  }[audioInputState] || "Input";

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
      }

      if (!devices.length) {
        audioInputStateRef.current = "error";
        setAudioInputState("error");
        setAudioInputMessage("No audio input sources were detected.");
        return;
      }

      if (currentState !== "previewing") {
        const nextState = hasAudioInputSetup() ? "ready" : "needs-access";
        audioInputStateRef.current = nextState;
        setAudioInputState(nextState);
        setAudioInputMessage(hasAudioInputSetup()
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
      stopAudioInputPreview();
      audioInputStateRef.current = "ready";
      setAudioInputState("ready");
      setAudioInputStats(EMPTY_AUDIO_INPUT_STATS);
      setAudioInputMessage("Monitoring paused. Start monitoring to preview input levels.");
      return;
    }

    startAudioInputPreview();
  }, [startAudioInputPreview, stopAudioInputPreview]);

  const toggleAutoOpenRecorder = useCallback(() => {
    setAutoOpenRecorder((currentValue) => {
      const nextValue = !currentValue;
      writeAutoOpenAudioRecorder(nextValue);
      return nextValue;
    });
  }, []);

  const selectAudioMode = useCallback((nextMode) => {
    setAudioMode(nextMode);
    writeAudioTranscriptionProvider(nextMode);
  }, []);

  const updateDeepgramApiKey = useCallback((event) => {
    const nextApiKey = event.target.value;
    setDeepgramApiKey(nextApiKey);
    writeDeepgramApiKey(nextApiKey);
  }, []);

  const updateDeepgramLanguage = useCallback((event) => {
    const nextLanguage = event.target.value;
    setDeepgramLanguage(nextLanguage);
    writeDeepgramLanguage(nextLanguage);
  }, []);

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
      if (!disposed && event.payload?.text) {
        setLatestAudioResult(event.payload);
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
        setLatestAudioResult(readLastAudioTranscriptionResult());
        setAudioMode(readAudioTranscriptionProvider());
        setDeepgramApiKey(readDeepgramApiKey());
        setDeepgramLanguage(readDeepgramLanguage());
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      disposed = true;
      unlisten();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useEffect(() => () => {
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
      <AudioSetupPanel data-installed={installed}>
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

        <AudioStatusGrid>
          {isCloudMode ? (
            <>
              <SettingsIdentityItem>
                <span>Provider</span>
                <strong>Deepgram</strong>
              </SettingsIdentityItem>
              <SettingsIdentityItem>
                <span>Model</span>
                <strong>Nova-3</strong>
              </SettingsIdentityItem>
              <SettingsIdentityItem>
                <span>Language</span>
                <strong>{cloudLanguageLabel}</strong>
              </SettingsIdentityItem>
            </>
          ) : (
            <>
              <SettingsIdentityItem>
                <span>Model</span>
                <strong>{modelLabel}</strong>
              </SettingsIdentityItem>
              <SettingsIdentityItem>
                <span>Runtime</span>
                <strong>{audioModelStatus?.runtimeInstalled ? runtimeLabel : "Not detected"}</strong>
              </SettingsIdentityItem>
              <SettingsIdentityItem>
                <span>Shortcut</span>
                <strong>{audioModelStatus?.shortcut || "CommandOrControl+Shift+Space"}</strong>
              </SettingsIdentityItem>
            </>
          )}
        </AudioStatusGrid>

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
          >
            {Array.from({ length: AUDIO_INPUT_METER_BARS }, (_, index) => (
              <span
                key={index}
                style={{
                  "--height": `${audioInputState === "previewing"
                    ? Math.max(8, Math.min(94, 10 + audioInputLevel + ((index * 5) % 16)))
                    : 10}%`,
                }}
              />
            ))}
          </AudioInputMeter>
          <AudioInputMeta>
            {selectedAudioInputLabel} / level {formatAudioLevel(audioInputLevel)} / buffer {Math.round((audioInputStats.bufferMs || 0) / 1000)}s
          </AudioInputMeta>
          <AudioRecorderOptionRow>
            <SettingsHint>Recorder window</SettingsHint>
            <McpSwitchButton aria-pressed={autoOpenRecorder} onClick={toggleAutoOpenRecorder} type="button">
              <span aria-hidden="true" />
              Auto-open after startup
            </McpSwitchButton>
          </AudioRecorderOptionRow>
        </AudioDevicePanel>

        <AudioResultsPanel aria-label="Audio results">
          <AudioDeviceHeader>
            <div>
              <PanelKicker>Results</PanelKicker>
              <SettingsHint>Latest {isCloudMode ? "cloud" : "local"} dictation output</SettingsHint>
            </div>
          </AudioDeviceHeader>
          {latestAudioResult?.text ? (
            <AudioResultLine>
              <span>{formatResultTime(latestAudioResult.createdAt)}</span>
              <strong>{latestAudioResult.text}</strong>
            </AudioResultLine>
          ) : (
            <SettingsHint>No recorder output yet.</SettingsHint>
          )}
        </AudioResultsPanel>

        {!isCloudMode && (
          <>
            <AudioPathBlock>
              <span>Local model path</span>
              <AudioCodePath>{modelPath}</AudioCodePath>
              <span>Runtime path</span>
              <AudioCodePath>{runtimePath || audioModelStatus?.runtimeInstallHint || "Not detected"}</AudioCodePath>
            </AudioPathBlock>

            <AudioStatusGrid>
              <SettingsIdentityItem>
                <span>Model file</span>
                <strong>{audioModelStatus?.modelInstalled ? formatFileSize(modelBytes) || diskLabel || "Ready" : diskLabel || "142 MB"}</strong>
              </SettingsIdentityItem>
              <SettingsIdentityItem>
                <span>Memory</span>
                <strong>{memoryLabel}</strong>
              </SettingsIdentityItem>
              <SettingsIdentityItem>
                <span>Mode</span>
                <strong>Push to talk</strong>
              </SettingsIdentityItem>
            </AudioStatusGrid>

            {audioModelStatus && !audioModelStatus.runtimeInstalled && (
              <AudioRuntimeHint>{audioModelStatus.runtimeInstallHint}</AudioRuntimeHint>
            )}

            {audioDownloadProgress && (
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
          </>
        )}

        {audioError && <FormMessage $state="error">{audioError}</FormMessage>}

        <AudioActionRow>
          {isCloudMode ? (
            <PrimaryButton disabled={isBusy || !deepgramReady} onClick={onOpenWidget} type="button">
              <ButtonMicIcon aria-hidden="true" />
              <span>{audioActionState === "opening" ? "Opening..." : "Open recorder"}</span>
            </PrimaryButton>
          ) : installed ? (
            <PrimaryButton disabled={isBusy} onClick={onOpenWidget} type="button">
              <ButtonMicIcon aria-hidden="true" />
              <span>{audioActionState === "opening" ? "Opening..." : "Open recorder"}</span>
            </PrimaryButton>
          ) : (
            <PrimaryButton disabled={isBusy} onClick={onDownloadModel} type="button">
              <ButtonMicIcon aria-hidden="true" />
              <span>{audioActionState === "downloading" ? "Downloading..." : installLabel}</span>
            </PrimaryButton>
          )}
          {!isCloudMode && (
            <>
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
            </>
          )}
        </AudioActionRow>
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
  const [realtimeTranscript, setRealtimeTranscript] = useState("");
  const audioBufferRef = useRef(null);
  const pushToTalkDownRef = useRef(false);
  const stopAfterStartRef = useRef(false);
  const stopRecordingRef = useRef(null);
  const widgetStateRef = useRef(widgetState);

  useEffect(() => {
    widgetStateRef.current = widgetState;
  }, [widgetState]);

  const startWarmBuffer = useCallback(async () => {
    if (audioBufferRef.current) {
      return audioBufferRef.current;
    }

    if (!hasAudioInputSetup()) {
      throw new Error("Choose and enable a microphone in the Audio tab before recording.");
    }

    setMessage("Starting input");
    const audioBuffer = await startLowPowerAudioBuffer({
      deviceId: readSelectedAudioInputDeviceId(),
      owner: "audio-widget",
      onStats: setWidgetAudioStats,
    });
    audioBufferRef.current = audioBuffer;
    setMessage("Input ready");

    return audioBuffer;
  }, []);

  const startRecording = useCallback(async () => {
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

    setError("");
    setMessage("Arming buffer");
    setRealtimeTranscript("");
    setWidgetAudioStats(EMPTY_AUDIO_INPUT_STATS);
    widgetStateRef.current = "arming";
    setWidgetState("arming");

    try {
      const audioBuffer = await startWarmBuffer();
      if (currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD) {
        setMessage("Opening Deepgram stream");
        await invoke("start_deepgram_realtime_transcription", {
          request: {
            apiKey: readDeepgramApiKey(),
            language: readDeepgramLanguage(),
          },
        });
      }
      await audioBuffer.beginCapture();
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
      const failedAudioBuffer = audioBufferRef.current;
      audioBufferRef.current = null;
      await failedAudioBuffer?.close?.().catch(() => {});
      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(getAudioInputErrorMessage(recordingError, "Choose and enable a microphone in the Audio tab before recording."));
    }
  }, [modelStatus?.installed, startWarmBuffer]);

  const refreshStatus = useCallback(async () => {
    const currentProvider = readAudioTranscriptionProvider();
    const currentApiKey = readDeepgramApiKey();
    const currentLanguage = readDeepgramLanguage();
    setTranscriptionProvider(currentProvider);
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

  const runWidgetWindowAction = useCallback((action) => {
    try {
      Promise.resolve(action(getCurrentWindow())).catch(() => {});
    } catch {
      // Native widget chrome is best-effort.
    }
  }, []);

  const widgetSizeMode = isFocusedAudioWidgetState(widgetState) ? "focus" : "compact";

  useEffect(() => {
    const wantsFocus = widgetSizeMode === "focus";
    const nextSize = wantsFocus
      ? AUDIO_WIDGET_FOCUS_SIZE
      : AUDIO_WIDGET_COMPACT_SIZE;
    let firstFrame = 0;
    let secondFrame = 0;

    setWidgetChromeReady(false);

    runWidgetWindowAction((windowHandle) => (
      windowHandle.setSize(new LogicalSize(nextSize.width, nextSize.height))
    ));

    if (wantsFocus) {
      firstFrame = window.requestAnimationFrame(() => {
        secondFrame = window.requestAnimationFrame(() => {
          setWidgetChromeReady(true);
        });
      });
    }

    return () => {
      if (firstFrame) {
        window.cancelAnimationFrame(firstFrame);
      }
      if (secondFrame) {
        window.cancelAnimationFrame(secondFrame);
      }
    };
  }, [runWidgetWindowAction, widgetSizeMode]);

  const dragWidget = useCallback((event) => {
    event.preventDefault();
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

  const stopRecording = useCallback(async () => {
    const audioBuffer = audioBufferRef.current;

    if (!audioBuffer || widgetStateRef.current !== "recording") {
      return;
    }

    widgetStateRef.current = "transcribing";
    setWidgetState("transcribing");
    setMessage("Preparing audio");
    setError("");

    try {
      const currentProvider = readAudioTranscriptionProvider();
      const result = currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
        ? await (async () => {
          setMessage("Closing Deepgram stream");
          const realtimeResult = await invoke("stop_deepgram_realtime_transcription");
          await audioBuffer.finishCapture().catch(() => null);
          return realtimeResult;
        })()
        : await (async () => {
          const { wavBuffer } = await audioBuffer.finishCapture();
          const audioBase64 = arrayBufferToBase64(wavBuffer);
          setMessage("Transcribing locally");
          return invoke("transcribe_whisper_audio", {
            request: {
              audioBase64,
            },
          });
      })();
      audioBufferRef.current = null;
      await audioBuffer.close().catch(() => {});
      setMessage(currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD
        ? "Deepgram final"
        : "Transcribed locally");
      const nextTranscript = (result?.text || "").trim();

      if (!nextTranscript) {
        widgetStateRef.current = "ready";
        setWidgetState("ready");
        setWidgetAudioStats(EMPTY_AUDIO_INPUT_STATS);
        setMessage("No transcript returned");
        return;
      }

      await publishAudioTranscriptionResult({
        createdAt: new Date().toISOString(),
        id: `${Date.now()}`,
        source: currentProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD ? "deepgram-nova-3-live" : "audio-widget",
        text: nextTranscript,
      });

      try {
        setMessage("Inserting into target");
        await invoke("insert_handsfree_transcribed_text", {
          text: nextTranscript,
        });
        setMessage("Inserted into target");
      } catch (insertError) {
        setMessage("Sent to Audio tab");
        setError(getErrorMessage(insertError, "Transcript saved, but focused insertion failed."));
      }

      widgetStateRef.current = "ready";
      setWidgetState("ready");
      setWidgetAudioStats(EMPTY_AUDIO_INPUT_STATS);
    } catch (recordingError) {
      audioBufferRef.current = null;
      await audioBuffer.close().catch(() => {});
      setWidgetAudioStats(EMPTY_AUDIO_INPUT_STATS);
      const messageText = getErrorMessage(recordingError, "Unable to transcribe audio.");

      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(messageText);
    }
  }, []);

  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);

  useEffect(() => {
    refreshStatus();

    return () => {
      const audioBuffer = audioBufferRef.current;
      audioBufferRef.current = null;
      if (audioBuffer) {
        audioBuffer.close().catch(() => {});
      }
    };
  }, [refreshStatus]);

  useEffect(() => {
    const syncAudioSettings = () => {
      setTranscriptionProvider(readAudioTranscriptionProvider());
      setDeepgramApiKey(readDeepgramApiKey());
      setDeepgramLanguage(readDeepgramLanguage());
    };

    const handleStorage = (event) => {
      if (event.key?.startsWith?.("diffforge.audio.")) {
        syncAudioSettings();
      }
    };

    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
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

  useEffect(() => {
    document.documentElement.dataset.audioWidget = "true";
    document.body.dataset.audioWidget = "true";

    return () => {
      delete document.documentElement.dataset.audioWidget;
      delete document.body.dataset.audioWidget;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        minimizeWidget();
        return;
      }

      if (event.key.toLowerCase() !== "p" || event.repeat) {
        return;
      }

      event.preventDefault();
      pressPushToTalk();
    };

    const onKeyUp = (event) => {
      if (event.key.toLowerCase() !== "p") {
        return;
      }

      event.preventDefault();
      releasePushToTalk();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [minimizeWidget, pressPushToTalk, releasePushToTalk]);

  useEffect(() => {
    let disposed = false;
    let unlisten = () => {};

    listen(AUDIO_PUSH_TO_TALK_EVENT, (event) => {
      if (disposed) {
        return;
      }

      if (event.payload?.pressed || event.payload?.phase === "pressed") {
        pressPushToTalk();
      } else {
        releasePushToTalk();
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
  }, [pressPushToTalk, releasePushToTalk]);

  const isCloudWidget = transcriptionProvider === AUDIO_TRANSCRIPTION_PROVIDER_CLOUD;
  const installed = isCloudWidget ? Boolean(deepgramApiKey.trim()) : Boolean(modelStatus?.installed);
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const widgetLevel = Math.min(100, Math.round((widgetAudioStats.rms || 0) * 1800));
  const compactLabel = error
    || message
    || (installed ? "Audio recorder ready" : "Audio recorder setup needed");
  const isRecordingFocus = widgetState === "recording";
  const isProcessingFocus = widgetState === "transcribing";
  const isFocusedWidget = widgetSizeMode === "focus";
  const widgetMeterBars = 18;
  const expandedLabel = isProcessingFocus
    ? (message || "Transcribing audio")
    : `Recording audio ${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

  return (
    <>
      <GlobalStyle />
      <AudioWidgetShell aria-label={isFocusedWidget ? expandedLabel : compactLabel} data-focus={isFocusedWidget} data-state={widgetState}>
        {isFocusedWidget ? (
          <AudioWidgetFocusStage aria-label={expandedLabel} data-mode={isProcessingFocus ? "processing" : "recording"} role="status">
            {isProcessingFocus ? (
              <AudioWidgetLoader aria-hidden="true" />
            ) : (
              <AudioWidgetLogo aria-hidden="true" data-size="focus" src="/logo.webp" alt="" />
            )}
            <AudioWidgetMeter
              data-active="true"
              data-processing={isProcessingFocus ? "true" : undefined}
              data-prominent="true"
              data-ready={widgetChromeReady ? "true" : "false"}
              aria-hidden="true"
            >
              {Array.from({ length: widgetMeterBars }, (_, index) => (
                <span
                  key={index}
                  style={{
                    "--scale": `${(Math.max(14, Math.min(92, 18 + widgetLevel + ((index * 9) % 24))) / 100).toFixed(2)}`,
                  }}
                />
              ))}
            </AudioWidgetMeter>
          </AudioWidgetFocusStage>
        ) : (
          <AudioWidgetHeader aria-label={compactLabel} role="status">
            <AudioWidgetLogo aria-hidden="true" data-size="compact" src="/logo.webp" alt="" />
          </AudioWidgetHeader>
        )}
      </AudioWidgetShell>
    </>
  );
}

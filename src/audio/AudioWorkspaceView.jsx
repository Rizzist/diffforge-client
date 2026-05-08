import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { arrayBufferToBase64, formatAudioPercent, startLowPowerAudioBuffer } from "./audioCapture";
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
  FileDocumentIcon
} from "../app/appStyles";

export const AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT = "forge-audio-model-download-progress";
const AUDIO_WIDGET_ARM_EVENT = "forge-audio-widget-arm";
export const AUDIO_WIDGET_HASH = "#/audio-widget";
const AUDIO_RECORDING_MAX_SECONDS = 90;
const AUDIO_RECORDING_TIMER_MS = 250;
const AUDIO_AUTO_STOP_SILENCE_MS = 1250;

function getErrorMessage(error, fallback) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  return fallback;
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
  workspace,
}) {
  const installed = Boolean(audioModelStatus?.installed);
  const isBusy = audioActionState === "downloading" || audioActionState === "opening" || audioStatusState === "checking";
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
            <PageSubline>Local Whisper recording for focused text entry.</PageSubline>
          </div>
          <AudioStatePill data-installed={installed}>
            {installed ? "Ready" : audioActionState === "downloading" ? "Downloading" : missingLabel}
          </AudioStatePill>
        </AudioHeroRow>

        <AudioStatusGrid>
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
        </AudioStatusGrid>

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
            <strong>VAD gated</strong>
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

        {audioError && <FormMessage $state="error">{audioError}</FormMessage>}

        <AudioActionRow>
          {installed ? (
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
          <SecondaryButton disabled={isBusy} onClick={onRefreshStatus} type="button">
            <ButtonRefreshIcon aria-hidden="true" />
            <span>{audioStatusState === "checking" ? "Checking..." : "Recheck"}</span>
          </SecondaryButton>
        </AudioActionRow>
      </AudioSetupPanel>
    </AudioWorkspaceSurface>
  );
}

export function AudioWidgetWindow() {
  const [modelStatus, setModelStatus] = useState(null);
  const [widgetState, setWidgetState] = useState("checking");
  const [message, setMessage] = useState("Checking Whisper");
  const [error, setError] = useState("");
  const [transcript, setTranscript] = useState("");
  const [recordingStartedAt, setRecordingStartedAt] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [vadStats, setVadStats] = useState({ bufferMs: 0, rms: 0, speech: false });
  const audioBufferRef = useRef(null);
  const pendingArmRef = useRef(true);
  const widgetStateRef = useRef(widgetState);

  useEffect(() => {
    widgetStateRef.current = widgetState;
  }, [widgetState]);

  const startWarmBuffer = useCallback(async () => {
    if (audioBufferRef.current) {
      return audioBufferRef.current;
    }

    setMessage("Warming microphone");
    const audioBuffer = await startLowPowerAudioBuffer({
      onStats: setVadStats,
    });
    audioBufferRef.current = audioBuffer;
    setMessage("Buffer ready");

    return audioBuffer;
  }, []);

  const startRecording = useCallback(async () => {
    const currentState = widgetStateRef.current;

    if (currentState === "recording" || currentState === "transcribing" || currentState === "inserting") {
      return;
    }

    if (currentState === "checking" || currentState === "warming") {
      pendingArmRef.current = true;
      return;
    }

    setError("");
    setTranscript("");
    setMessage("Arming buffer");

    try {
      const audioBuffer = await startWarmBuffer();
      audioBuffer.beginCapture();
      setRecordingStartedAt(Date.now());
      setElapsedMs(0);
      widgetStateRef.current = "recording";
      setWidgetState("recording");
      setMessage("Recording");
    } catch (recordingError) {
      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(getErrorMessage(recordingError, "Unable to start microphone."));
    }
  }, [startWarmBuffer]);

  const refreshStatus = useCallback(async () => {
    let shouldArm = false;
    widgetStateRef.current = "checking";
    setWidgetState("checking");
    setError("");

    try {
      const status = await invoke("whisper_model_status");
      setModelStatus(status);
      if (status.installed) {
        widgetStateRef.current = "warming";
        setWidgetState("warming");
        await startWarmBuffer();
        shouldArm = pendingArmRef.current;
        pendingArmRef.current = false;
        widgetStateRef.current = "ready";
        setWidgetState("ready");
      } else {
        widgetStateRef.current = "missing";
        setWidgetState("missing");
      }
      setMessage(status.installed ? "Buffer ready" : "Install Whisper from the Audio tab.");
      if (shouldArm) {
        window.setTimeout(() => startRecording(), 60);
      }
    } catch (statusError) {
      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(getErrorMessage(statusError, "Unable to check Whisper."));
    }
  }, [startRecording, startWarmBuffer]);

  const hideWidget = useCallback(() => {
    invoke("hide_audio_widget").catch(() => {});
  }, []);

  const stopRecording = useCallback(async () => {
    const audioBuffer = audioBufferRef.current;

    if (!audioBuffer) {
      return;
    }

    widgetStateRef.current = "transcribing";
    setWidgetState("transcribing");
    setMessage("Checking speech");
    setError("");

    try {
      const { wavBuffer } = audioBuffer.finishCapture();
      setMessage("Transcribing locally");
      const result = await invoke("transcribe_whisper_audio", {
        request: {
          audioBase64: arrayBufferToBase64(wavBuffer),
        },
      });
      const nextTranscript = (result?.text || "").trim();
      setTranscript(nextTranscript);

      if (!nextTranscript) {
        widgetStateRef.current = "ready";
        setWidgetState("ready");
        setMessage("No speech detected");
        return;
      }

      widgetStateRef.current = "inserting";
      setWidgetState("inserting");
      setMessage("Inserting transcript");
      await invoke("insert_transcribed_text", { text: nextTranscript });
      widgetStateRef.current = "inserted";
      setWidgetState("inserted");
      setMessage("Inserted");
      window.setTimeout(() => {
        widgetStateRef.current = "ready";
        setWidgetState("ready");
        setMessage("Buffer ready");
        setTranscript("");
      }, 900);
    } catch (recordingError) {
      const messageText = getErrorMessage(recordingError, "Unable to transcribe audio.");

      if (messageText.toLowerCase().includes("no speech detected")) {
        widgetStateRef.current = "ready";
        setWidgetState("ready");
        setMessage("No speech detected");
        return;
      }

      widgetStateRef.current = "error";
      setWidgetState("error");
      setError(messageText);
    }
  }, []);

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
    let disposed = false;
    let unlisten = () => {};

    listen(AUDIO_WIDGET_ARM_EVENT, () => {
      startRecording();
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
  }, [startRecording]);

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

      const captureStats = audioBufferRef.current?.getCaptureStats?.();
      if (
        captureStats?.speechDetected
        && nextElapsedMs > 850
        && captureStats.lastSpeechAgoMs > AUDIO_AUTO_STOP_SILENCE_MS
      ) {
        stopRecording();
      }
    }, AUDIO_RECORDING_TIMER_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [recordingStartedAt, stopRecording, widgetState]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        hideWidget();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hideWidget]);

  const installed = Boolean(modelStatus?.installed);
  const elapsedSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const isWorking = widgetState === "checking"
    || widgetState === "warming"
    || widgetState === "transcribing"
    || widgetState === "inserting";
  const vadLevel = Math.min(100, Math.round((vadStats.rms || 0) * 1800));

  return (
    <AudioWidgetShell>
      <AudioWidgetHeader>
        <AudioWidgetTitle>
          <span aria-hidden="true"><ButtonMicIcon /></span>
          <strong>Dictation</strong>
        </AudioWidgetTitle>
        <WorkspaceModalCloseButton aria-label="Hide recorder" onClick={hideWidget} type="button">
          <ButtonCloseIcon aria-hidden="true" />
        </WorkspaceModalCloseButton>
      </AudioWidgetHeader>

      <AudioWidgetMeter data-active={widgetState === "recording" || vadStats.speech} aria-hidden="true">
        {Array.from({ length: 18 }, (_, index) => (
          <span
            key={index}
            style={{
              "--height": `${Math.max(12, Math.min(86, 16 + vadLevel + ((index * 7) % 18)))}%`,
            }}
          />
        ))}
      </AudioWidgetMeter>

      <AudioWidgetStatus>
        <strong>{message}</strong>
        <span>
          {installed
            ? `${modelStatus?.modelName || "Whisper base.en"} / ${Math.round((vadStats.bufferMs || 0) / 1000)}s buffer`
            : "Whisper missing"}
        </span>
      </AudioWidgetStatus>

      {widgetState === "recording" && (
        <AudioRecordingTimer>{String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:{String(elapsedSeconds % 60).padStart(2, "0")}</AudioRecordingTimer>
      )}

      {transcript && <AudioWidgetTranscript>{transcript}</AudioWidgetTranscript>}
      {error && <FormMessage $state="error">{error}</FormMessage>}

      <AudioWidgetActions>
        {widgetState === "recording" ? (
          <PrimaryButton onClick={stopRecording} type="button">
            <ButtonCheckIcon aria-hidden="true" />
            <span>Finish</span>
          </PrimaryButton>
        ) : (
          <PrimaryButton disabled={!installed || isWorking} onClick={startRecording} type="button">
            <ButtonMicIcon aria-hidden="true" />
            <span>{isWorking ? "Working..." : "Record"}</span>
          </PrimaryButton>
        )}
        <SecondaryButton onClick={hideWidget} type="button">
          <ButtonCloseIcon aria-hidden="true" />
          <span>Hide</span>
        </SecondaryButton>
      </AudioWidgetActions>
    </AudioWidgetShell>
  );
}

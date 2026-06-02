import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AddToQueue } from "@styled-icons/material-rounded/AddToQueue";
import { Check } from "@styled-icons/material-rounded/Check";
import { Close } from "@styled-icons/material-rounded/Close";
import { ContentCopy } from "@styled-icons/material-rounded/ContentCopy";
import { ZoomIn } from "@styled-icons/material-rounded/ZoomIn";
import { ZoomOut } from "@styled-icons/material-rounded/ZoomOut";
import { North } from "@styled-icons/material-rounded/North";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

import {
  ButtonAddIcon,
  ButtonForgeIcon,
  ButtonFolderIcon,
  ButtonFullscreenExitIcon,
  ButtonFullscreenIcon,
  ButtonHubIcon,
  ButtonRefreshIcon,
  DashboardTitle,
  ForgeWorkspace,
  FormMessage,
  Kicker,
  PageSubline,
  PrimaryButton,
  RootDirectoryInput,
  ResizeHandle,
  ResizePanel,
  ResizePanelGroup,
  SecondaryButton,
  SettingsLabel,
  SetupField,
  SetupHeader,
  SetupInput,
  TitleMinimizeIcon,
  TitleRestoreIcon,
  WorkspaceRootActions,
  WorkspaceRootChooser,
  WorkspaceSetupPanel,
  WorkspaceTerminalPanels,
} from "../app/appStyles";
import {
  AUDIO_ORCHESTRATOR_SUBMISSION_MODE_EVENT,
  AUDIO_ORCHESTRATOR_SUBMISSION_MODE_MANUAL,
  getAudioInputErrorMessage,
  readOrchestratorVoiceSubmissionMode,
  readSelectedAudioInputDeviceId,
  startLowPowerAudioBuffer,
} from "../audio/audioCapture";
import {
  cloudVoiceAgentEventKind,
  createCloudVoiceAgentTtsPlayer,
  finishCloudVoiceAgentInput,
  sendCloudVoiceAgentTextMessage,
  startCloudVoiceAgentStream,
  stopCloudVoiceAgentStream,
  subscribeCloudVoiceAgentEvents,
} from "../audio/cloudVoiceAgentClient";
import { getAgentModelImageInputCapability } from "../agents/imageInputCapabilities";
import {
  getBigViewTextDiagnosticFields,
  logBigViewSyncDiagnosticEvent,
  logFileDragDiagnosticEvent,
} from "../threads/bigViewSyncDiagnostics";
import {
  getThreadTerminalGroundTruth,
} from "../threads/threadTerminalGroundTruth.js";
import { getWorkspaceThreadProviderBinding } from "../threads/workspaceThreads";
import GitWorkspaceView from "../git/GitWorkspaceView.jsx";
import PlansWorkspaceView from "../plans/PlansWorkspaceView.jsx";
import AccountTokenomicsView from "../tokenomics/AccountTokenomicsView.jsx";
import { logTerminalStatus } from "./terminalStatusLog.js";
import {
  terminalActivityStatusIsBusy,
  terminalActivityStatusIsPaused,
  terminalActivityStatusIsSendable,
} from "./terminalActivityState.js";
import {
  TODO_QUEUE_DEFAULT_DOT_COLOR,
  normalizeTerminalColorSlot,
  normalizeTerminalHexColor,
  terminalColorForSlot,
} from "./terminalColors.js";
import {
  evaluateTodoQueueInFlightPrompt,
} from "./todoQueueLaneState.js";
import { selectTodoQueueDispatchCandidate } from "./todoQueueScheduler.js";
import {
  TODO_QUEUE_SOURCE_REMOTE_CONTROL,
  TODO_QUEUE_SOURCE_SPEC_EDIT_AUTO,
  TODO_QUEUE_SOURCE_TODO_AUTO,
  TODO_QUEUE_SOURCE_VOICE_AGENT,
  TODO_QUEUE_SOURCE_VOICE_PLAN,
  getTodoQueueAutoQueueSourceForSource,
  getTodoQueueLifecycleSourceForSource,
  getTodoQueuePromptEventSourceForSource,
} from "./todoQueueSources.js";
import WorkspaceTerminal, {
  getTerminalPaneMinSizePercent,
  getWorkspaceTerminalPaneId,
} from "./WorkspaceTerminal.jsx";
import {
  MAX_WORKSPACE_TERMINAL_COUNT,
  buildTerminalComposerDraftInput,
  getTerminalInputDebugFields,
  TERMINAL_PARKED_PROMPT_EVENT,
  TERMINAL_SHIFT_ENTER_SEQUENCE,
  WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT,
} from "./WorkspaceTerminal/terminalCore.js";
import {
  appendWorkspaceThreadComposerAttachments,
  clearWorkspaceThreadComposerDraftIfRevision,
  clearActiveWorkspaceFileDrag,
  createTerminalPromptSubmittedWaiter,
  createThreadProjectionToken,
  createWorkspaceThreadPromptAcceptedWaiter,
  getActiveWorkspaceFileDrag,
  getDraggedWorkspaceFile,
  getErrorMessage,
  getTerminalAgentColorSlot,
  getTerminalSubmitSequence,
  getThreadComposerSyncKey,
  getWorkspaceThreadComposerAttachments,
  getWorkspaceThreadComposerDraftRecord,
  getWorkspaceThreadComposerDraftStore,
  isWorkspaceFileDragTransfer,
  requestTerminalSubmitDiagnosticSnapshot,
  setActiveWorkspaceFileDrag,
  setWorkspaceThreadComposerDraft,
  subscribeWorkspaceThreadComposerAttachments,
  subscribeWorkspaceThreadComposerDrafts,
  WORKSPACE_FILE_POINTER_DROP_EVENT,
  workspaceFileToComposerAttachment,
} from "./WorkspaceTerminal/threadRuntime.js";

const TERMINAL_FULLSCREEN_TRANSITION_MS = 190;
const TERMINAL_BREAKOUT_TRANSITION_MS = 260;
const TERMINAL_BREAKOUT_STORAGE_PREFIX = "diffforge.terminalBreakout.v1";
const TERMINAL_BREAKOUT_PHASE_GRID = "grid";
const TERMINAL_BREAKOUT_PHASE_BREAKING_OUT = "breaking-out";
const TERMINAL_BREAKOUT_PHASE_CANVAS = "canvas";
const TERMINAL_BREAKOUT_PHASE_RETURNING = "returning";
const TERMINAL_BREAKOUT_DEFAULT_ZOOM = 0.68;
const TERMINAL_BREAKOUT_MIN_ZOOM = 0.42;
const TERMINAL_BREAKOUT_MAX_ZOOM = 1.35;
const TERMINAL_BREAKOUT_ZOOM_STEP = 1.16;
const TERMINAL_BREAKOUT_DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: TERMINAL_BREAKOUT_DEFAULT_ZOOM };
const TERMINAL_BREAKOUT_HOLD_DRAG_DELAY_MS = 180;
const TERMINAL_BREAKOUT_HOLD_DRAG_CANCEL_PX = 6;
const TERMINAL_BREAKOUT_MIN_WIDTH = 420;
const TERMINAL_BREAKOUT_MIN_HEIGHT = 260;
const TERMINAL_BREAKOUT_MAX_WIDTH = 840;
const TERMINAL_BREAKOUT_MAX_HEIGHT = 560;
const TODO_QUEUE_CONSUME_TIMEOUT_MS = 45000;
const TODO_QUEUE_IN_FLIGHT_PROMPT_TIMEOUT_MS = 10 * 60 * 1000;
const TODO_QUEUE_IN_FLIGHT_PROMPT_READY_GRACE_MS = 1000;
const TODO_QUEUE_PROMPT_ACCEPT_GRACE_MS = 1200;
const TODO_QUEUE_SUBMIT_RETRY_DELAYS_MS = [350, 900];
const TODO_QUEUE_SUBMIT_SYNC_SETTLE_MS = 80;
const TODO_QUEUE_RESUME_LOCK_STALE_MS = 30 * 60 * 1000;
const TODO_QUEUE_PENDING_SPOKES = Array.from({ length: 8 }, (_, index) => index);
const TODO_QUEUE_AGENT_ROLES = new Set(["codex", "claude", "opencode"]);
const TODO_QUEUE_CLOSED_TURN_STATES = new Set(["completed", "error", "interrupted"]);
const TODO_QUEUE_PARKED_TERMINAL_STATUSES = new Set(["parked", "resume_ready", "resume_requested"]);
const TODO_QUEUE_BUSY_REASONS = new Set([
  "busy_activity",
  "busy_turn",
  "composer_attachments_present",
  "composer_draft_present",
  "agent_not_ready",
  "pending_prompt",
  "parked_task_resume_ready",
  "parked_task_waiting",
  "reserved",
  "resume_in_progress",
  "session_acceptance_pending",
  "submitted_prompt_active",
  "terminal_starting",
]);
const TERMINAL_FULLSCREEN_DEFAULT_MOTION = {
  originScaleX: 1,
  originScaleY: 1,
  originX: 0,
  originY: 0,
  phase: "idle",
};
const TERMINAL_FOCUS_REQUEST_EVENT = "diffforge:terminal-focus-request";
const SPEC_EDIT_TODO_QUEUE_EVENT = "diffforge:spec-edit-todo-queue";
const SPEC_EDIT_TODO_QUEUE_DISPATCH_EVENT = "diffforge:spec-edit-todo-queue-dispatched";
const SPEC_EDIT_TODO_QUEUE_CANCEL_EVENT = "diffforge:spec-edit-todo-queue-cancelled";
const REMOTE_TODO_QUEUE_EVENT = "diffforge:remote-todo-queue";
const VOICE_PLAN_SNAPSHOT_EVENT = "diffforge:voice-plan-snapshot";
const VOICE_PLAN_TASK_LIFECYCLE_EVENT = "diffforge:voice-plan-task-lifecycle";
const VOICE_PLAN_SERVER_RESULT_EVENT = "diffforge-voice-plan-server-result";
const VOICE_AGENT_OPEN_CODING_AGENTS_RESULT_EVENT = "diffforge:voice-agent-open-coding-agents-result";
const TODO_QUEUE_KIND_SPEC_EDIT = "spec-edit";
const ORCHESTRATOR_VOICE_OWNER = "orchestrator-voice-agent";
const ORCHESTRATOR_VOICE_TURN_TIMEOUT_MS = 60000;
const ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT = 256;
const ORCHESTRATOR_VOICE_RING_CENTER = 50;
const ORCHESTRATOR_VOICE_RING_MIN_RADIUS = 35.8;
const ORCHESTRATOR_VOICE_RING_BASE_RADIUS = 39.2;
const ORCHESTRATOR_VOICE_RING_MAX_RADIUS = 46.2;
const ORCHESTRATOR_VOICE_NOISE_CALIBRATION_MS = 700;
const ORCHESTRATOR_VOICE_NOISE_MARGIN = 0.035;
const ORCHESTRATOR_VOICE_ENVELOPE_MARGIN = 0.0015;
const ORCHESTRATOR_VOICE_SAMPLE_SOURCE_START = 0.5;
const ORCHESTRATOR_VOICE_SAMPLE_SOURCE_SPAN = 0.5;
const EMPTY_ORCHESTRATOR_VOICE_STATS = {
  bufferMs: 0,
  frequencyBands: [],
  peak: 0,
  rms: 0,
  timeDomainSamples: [],
};

function clampOrchestratorVoiceLevel(value) {
  const level = Number(value);

  if (!Number.isFinite(level)) {
    return 0;
  }

  return Math.max(0, Math.min(100, level));
}

function getOrchestratorVoiceLevel(stats) {
  const rms = Math.max(0, Number(stats?.rms || 0));
  const peak = Math.max(0, Number(stats?.peak || 0));
  const rmsLevel = Math.pow(Math.min(1, rms * 18), 0.74) * 100;
  const peakLevel = Math.pow(Math.min(1, peak * 2.8), 0.85) * 62;

  return Math.round(clampOrchestratorVoiceLevel(Math.max(rmsLevel, peakLevel)));
}

function getOrchestratorVoiceFrequencyBand(
  frequencyBands,
  pointIndex,
  pointCount = ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT,
) {
  if (!Array.isArray(frequencyBands) || frequencyBands.length === 0) {
    return null;
  }

  const bandPosition = (pointIndex / pointCount) * frequencyBands.length;
  const lowerIndex = Math.floor(bandPosition) % frequencyBands.length;
  const upperIndex = (lowerIndex + 1) % frequencyBands.length;
  const mix = bandPosition - Math.floor(bandPosition);
  const lowerValue = clampOrchestratorVoiceLevel(Number(frequencyBands[lowerIndex] || 0) * 100) / 100;
  const upperValue = clampOrchestratorVoiceLevel(Number(frequencyBands[upperIndex] || 0) * 100) / 100;

  return lowerValue + ((upperValue - lowerValue) * mix);
}

function getOrchestratorVoiceWaveformSample(
  timeDomainSamples,
  pointIndex,
  pointCount = ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT,
) {
  if (!Array.isArray(timeDomainSamples) || timeDomainSamples.length === 0) {
    return null;
  }

  const sourceLength = timeDomainSamples.length;
  const sourceStart = Math.floor(sourceLength * ORCHESTRATOR_VOICE_SAMPLE_SOURCE_START);
  const sourceSpan = Math.max(1, Math.floor(sourceLength * ORCHESTRATOR_VOICE_SAMPLE_SOURCE_SPAN));
  const wrappedPoint = ((pointIndex % pointCount) + pointCount) % pointCount;
  const samplePosition = (wrappedPoint / pointCount) * sourceSpan;
  const lowerOffset = Math.floor(samplePosition) % sourceSpan;
  const upperOffset = (lowerOffset + 1) % sourceSpan;
  const lowerIndex = (sourceStart + lowerOffset) % sourceLength;
  const upperIndex = (sourceStart + upperOffset) % sourceLength;
  const mix = samplePosition - Math.floor(samplePosition);
  const lowerValue = Math.max(0, Math.min(1, Number(timeDomainSamples[lowerIndex] || 0)));
  const upperValue = Math.max(0, Math.min(1, Number(timeDomainSamples[upperIndex] || 0)));

  return lowerValue + ((upperValue - lowerValue) * mix);
}

function getOrchestratorVoiceEnvelopeStats(
  timeDomainSamples,
  pointCount = ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT,
) {
  if (!Array.isArray(timeDomainSamples) || timeDomainSamples.length === 0) {
    return {
      average: 0,
      maximum: 0,
      minimum: 0,
      range: 0,
    };
  }

  let maximum = 0;
  let minimum = 1;
  let sum = 0;

  for (let index = 0; index < pointCount; index += 1) {
    const sample = getOrchestratorVoiceWaveformSample(timeDomainSamples, index, pointCount) || 0;
    maximum = Math.max(maximum, sample);
    minimum = Math.min(minimum, sample);
    sum += sample;
  }

  return {
    average: sum / pointCount,
    maximum,
    minimum,
    range: maximum - minimum,
  };
}

function getOrchestratorVoiceLocalEnvelopeAverage(
  timeDomainSamples,
  pointIndex,
  pointCount = ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT,
) {
  if (!Array.isArray(timeDomainSamples) || timeDomainSamples.length === 0) {
    return 0;
  }

  const sampleRadius = 12;
  let weightedSum = 0;
  let weightSum = 0;

  for (let offset = -sampleRadius; offset <= sampleRadius; offset += 1) {
    const sample = getOrchestratorVoiceWaveformSample(
      timeDomainSamples,
      (pointIndex + offset + pointCount) % pointCount,
      pointCount,
    );
    const weight = sampleRadius + 1 - Math.abs(offset);

    weightedSum += (sample || 0) * weight;
    weightSum += weight;
  }

  return weightSum > 0 ? weightedSum / weightSum : 0;
}

function getOrchestratorVoiceRingPoint(radius, angle) {
  return {
    x: ORCHESTRATOR_VOICE_RING_CENTER + Math.cos(angle) * radius,
    y: ORCHESTRATOR_VOICE_RING_CENTER + Math.sin(angle) * radius,
  };
}

function getOrchestratorVoiceCircularValue(values, index) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  return values[((index % values.length) + values.length) % values.length] || 0;
}

function getOrchestratorVoiceSmoothedEnvelopeValue(values, index) {
  return (
    (getOrchestratorVoiceCircularValue(values, index) * 0.34)
    + (getOrchestratorVoiceCircularValue(values, index - 1) * 0.19)
    + (getOrchestratorVoiceCircularValue(values, index + 1) * 0.19)
    + (getOrchestratorVoiceCircularValue(values, index - 2) * 0.1)
    + (getOrchestratorVoiceCircularValue(values, index + 2) * 0.1)
    + (getOrchestratorVoiceCircularValue(values, index - 3) * 0.04)
    + (getOrchestratorVoiceCircularValue(values, index + 3) * 0.04)
  );
}

function getOrchestratorVoiceBandAboveFloor(
  frequencyBands,
  noiseFloorBands,
  pointIndex,
  pointCount = ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT,
) {
  const rawEnergy = getOrchestratorVoiceFrequencyBand(frequencyBands, pointIndex, pointCount);
  const floorEnergy = getOrchestratorVoiceFrequencyBand(noiseFloorBands, pointIndex, pointCount) || 0;

  if (rawEnergy === null) {
    return null;
  }

  return Math.max(0, rawEnergy - floorEnergy - ORCHESTRATOR_VOICE_NOISE_MARGIN);
}

function getOrchestratorVoiceWaveformTarget(
  index,
  level,
  active,
  timeDomainSamples = [],
  envelopeStats = {},
  frequencyBands = [],
  noiseFloorBands = [],
  animationPhase = 0,
) {
  const normalizedLevel = active ? clampOrchestratorVoiceLevel(level) / 100 : 0;
  const activityGate = active
    ? Math.max(0, Math.min(1, (normalizedLevel - 0.035) / 0.58))
    : 0;
  const pointAngle = (-Math.PI / 2)
    + ((index / ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT) * Math.PI * 2);
  const waveformSample = getOrchestratorVoiceWaveformSample(
    timeDomainSamples,
    index,
    ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT,
  );
  const fallbackSample = Math.max(
    0,
    (
      Math.sin(pointAngle * 2.8 + animationPhase * 1.2)
      + (Math.cos(pointAngle * 5.2 - animationPhase * 0.7) * 0.44)
    ) * 0.003,
  );
  const envelopeSample = waveformSample ?? fallbackSample;
  const localAverage = getOrchestratorVoiceLocalEnvelopeAverage(
    timeDomainSamples,
    index,
    ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT,
  );
  const frameAverage = Math.max(0, Number(envelopeStats.average || 0));
  const dynamicRange = Math.max(
    Number(envelopeStats.range || 0),
    frameAverage * 0.28,
    0.003,
  );
  const localContrast = Math.max(
    0,
    envelopeSample - localAverage - ORCHESTRATOR_VOICE_ENVELOPE_MARGIN,
  );
  const frameContrast = Math.max(
    0,
    envelopeSample - frameAverage - ORCHESTRATOR_VOICE_ENVELOPE_MARGIN,
  );
  const contrastSample = Math.max(localContrast * 1.45, frameContrast * 0.9);
  const envelopeLift = Math.tanh((contrastSample / dynamicRange) * (2.2 + (normalizedLevel * 2.6)));
  const frequencyEnergy = getOrchestratorVoiceBandAboveFloor(
    frequencyBands,
    noiseFloorBands,
    index,
    ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT,
  );
  const previousEnergy = getOrchestratorVoiceBandAboveFloor(
    frequencyBands,
    noiseFloorBands,
    (index - 1 + ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT) % ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT,
    ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT,
  ) || 0;
  const nextEnergy = getOrchestratorVoiceBandAboveFloor(
    frequencyBands,
    noiseFloorBands,
    (index + 1) % ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT,
    ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT,
  ) || 0;
  const bandEnergy = frequencyEnergy ?? 0;
  const neighborAverage = (previousEnergy + nextEnergy) / 2;
  const localPeak = Math.max(0, bandEnergy - (neighborAverage * 0.72));
  const localLift = Math.min(0.1, Math.pow(localPeak * 7, 0.76) * 0.08);
  const idleDrift = active
    ? Math.max(0, Math.sin(pointAngle * 3 + animationPhase * 0.85) * 0.012)
    : 0;

  return active
    ? Math.max(0, Math.min(1, (envelopeLift * activityGate) + localLift + idleDrift))
    : 0;
}

function drawOrchestratorVoiceSmoothPath(context, points) {
  if (!points.length) {
    return;
  }

  const count = points.length;
  context.moveTo(points[0].x, points[0].y);

  for (let index = 0; index < count; index += 1) {
    const previous = points[(index - 1 + count) % count];
    const current = points[index];
    const next = points[(index + 1) % count];
    const afterNext = points[(index + 2) % count];
    const controlOne = {
      x: current.x + ((next.x - previous.x) / 6),
      y: current.y + ((next.y - previous.y) / 6),
    };
    const controlTwo = {
      x: next.x - ((afterNext.x - current.x) / 6),
      y: next.y - ((afterNext.y - current.y) / 6),
    };

    context.bezierCurveTo(controlOne.x, controlOne.y, controlTwo.x, controlTwo.y, next.x, next.y);
  }

  context.closePath();
}

function getForgeThemeMode() {
  if (typeof document === "undefined") {
    return "dark";
  }

  return document.documentElement?.dataset?.forgeTheme === "light" ? "light" : "dark";
}

function drawOrchestratorVoiceDotField(context, themeMode, alpha, phase) {
  const dotColor = themeMode === "light"
    ? "rgba(0, 102, 204, 0.24)"
    : "rgba(155, 213, 255, 0.26)";
  const warmDotColor = themeMode === "light"
    ? "rgba(221, 112, 31, 0.2)"
    : "rgba(240, 140, 69, 0.22)";
  const rings = [
    { count: 22, radius: 35.4, size: 0.42, speed: -0.09 },
    { count: 30, radius: 42.4, size: 0.5, speed: 0.07 },
    { count: 38, radius: 46.1, size: 0.44, speed: -0.045 },
  ];

  context.save();
  context.globalAlpha = alpha;

  rings.forEach((ring, ringIndex) => {
    for (let index = 0; index < ring.count; index += 1) {
      const angle = ((Math.PI * 2 * index) / ring.count) + (phase * ring.speed);
      const pulse = 0.66 + (Math.sin((phase * 1.8) + index * 0.72 + ringIndex) * 0.34);
      const point = getOrchestratorVoiceRingPoint(ring.radius, angle);

      context.beginPath();
      context.arc(point.x, point.y, ring.size * (0.75 + (pulse * 0.38)), 0, Math.PI * 2);
      context.fillStyle = index % 5 === 0 ? warmDotColor : dotColor;
      context.fill();
    }
  });

  context.restore();
}

function drawOrchestratorVoiceCanvasRing(context, waveform, options = {}) {
  const active = Boolean(options.active);
  const themeMode = options.themeMode === "light" ? "light" : "dark";
  const breath = active ? Math.min(1, Math.max(0, Number(options.breath || 0))) : 0;
  const phase = Number(options.phase || 0);
  const maxAmplitude = waveform.reduce(
    (maximum, value) => Math.max(maximum, Math.abs(Number(value || 0))),
    0,
  );
  const baseRadius = ORCHESTRATOR_VOICE_RING_BASE_RADIUS + (breath * 0.9);
  const waveLift = (ORCHESTRATOR_VOICE_RING_MAX_RADIUS - baseRadius) - 0.2;
  const waveformPoints = waveform.map((value, index) => {
    const angle = (-Math.PI / 2) + ((Math.PI * 2 * index) / ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT);
    const connectedValue = getOrchestratorVoiceSmoothedEnvelopeValue(waveform, index);
    const shapedValue = Math.pow(Math.max(0, Math.min(1, Number(connectedValue || value || 0))), 0.78);
    const radius = Math.max(
      ORCHESTRATOR_VOICE_RING_MIN_RADIUS,
      Math.min(
        ORCHESTRATOR_VOICE_RING_MAX_RADIUS,
        baseRadius + (shapedValue * waveLift) + (breath * 0.32),
      ),
    );

    return getOrchestratorVoiceRingPoint(radius, angle);
  });
  const visibleAlpha = active || maxAmplitude > 0.01
    ? Math.min(1, 0.32 + (breath * 0.16) + (maxAmplitude * 0.48))
    : 0;
  const baseStroke = themeMode === "light"
    ? "rgba(0, 102, 204, 0.22)"
    : "rgba(125, 176, 255, 0.2)";
  const centerStroke = themeMode === "light"
    ? "rgba(24, 34, 48, 0.08)"
    : "rgba(230, 236, 245, 0.08)";
  const glow = themeMode === "light"
    ? "rgba(0, 102, 204, 0.3)"
    : "rgba(125, 176, 255, 0.34)";
  const strokeGradient = context.createLinearGradient(18, 10, 82, 90);
  const glowGradient = context.createLinearGradient(14, 16, 88, 84);

  if (themeMode === "light") {
    strokeGradient.addColorStop(0, "#005fb8");
    strokeGradient.addColorStop(0.54, "#1a8cff");
    strokeGradient.addColorStop(1, "#d8681b");
    glowGradient.addColorStop(0, "rgba(0, 102, 204, 0.14)");
    glowGradient.addColorStop(0.56, "rgba(26, 140, 255, 0.22)");
    glowGradient.addColorStop(1, "rgba(221, 112, 31, 0.22)");
  } else {
    strokeGradient.addColorStop(0, "#9edbff");
    strokeGradient.addColorStop(0.46, "#4aa3ff");
    strokeGradient.addColorStop(1, "#f08c45");
    glowGradient.addColorStop(0, "rgba(158, 219, 255, 0.18)");
    glowGradient.addColorStop(0.48, "rgba(74, 163, 255, 0.28)");
    glowGradient.addColorStop(1, "rgba(240, 140, 69, 0.26)");
  }

  context.clearRect(0, 0, 100, 100);

  if (visibleAlpha <= 0.01) {
    return;
  }

  context.save();
  context.globalAlpha = visibleAlpha;

  drawOrchestratorVoiceDotField(context, themeMode, Math.min(0.42, 0.16 + (breath * 0.16)), phase);

  context.beginPath();
  context.arc(
    ORCHESTRATOR_VOICE_RING_CENTER,
    ORCHESTRATOR_VOICE_RING_CENTER,
    baseRadius,
    0,
    Math.PI * 2,
  );
  context.strokeStyle = baseStroke;
  context.lineWidth = 1.25;
  context.stroke();

  context.beginPath();
  context.arc(
    ORCHESTRATOR_VOICE_RING_CENTER,
    ORCHESTRATOR_VOICE_RING_CENTER,
    ORCHESTRATOR_VOICE_RING_MIN_RADIUS,
    0,
    Math.PI * 2,
  );
  context.strokeStyle = centerStroke;
  context.lineWidth = 0.9;
  context.stroke();

  context.save();
  context.globalAlpha *= 0.68;
  context.shadowBlur = 14;
  context.shadowColor = glow;
  context.beginPath();
  drawOrchestratorVoiceSmoothPath(context, waveformPoints);
  context.strokeStyle = glowGradient;
  context.lineWidth = 7.2;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();
  context.restore();

  context.save();
  context.globalAlpha *= 0.74;
  context.beginPath();
  drawOrchestratorVoiceSmoothPath(context, waveformPoints);
  context.strokeStyle = themeMode === "light"
    ? "rgba(255, 255, 255, 0.56)"
    : "rgba(255, 255, 255, 0.24)";
  context.lineWidth = 4.6;
  context.stroke();
  context.restore();

  context.beginPath();
  drawOrchestratorVoiceSmoothPath(context, waveformPoints);
  context.strokeStyle = strokeGradient;
  context.lineWidth = 2.55;
  context.lineJoin = "round";
  context.lineCap = "round";
  context.stroke();

  context.restore();
}

const TerminalWorkspaceMain = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  background: #020304;

  html[data-forge-theme="light"] & {
    background: #f5f5f7;
  }

  &[data-workspace-tool-fullscreen="true"] [data-workspace-tool-main-grid="true"] {
    opacity: 0.36;
    filter: brightness(0.6) saturate(0.78);
    pointer-events: none;
  }

  &[data-workspace-tool-fullscreen="true"] [data-workspace-tool-resize-handle="true"] {
    opacity: 0;
    pointer-events: none;
  }

  [data-workspace-tool-panel="true"]:not([data-pane-mode="minimized"]):not([data-pane-mode="fullscreen"]) {
    min-width: 300px;
  }

  [data-workspace-tool-panel="true"][data-pane-mode="fullscreen"] {
    position: absolute !important;
    inset: 0;
    z-index: 320;
    flex: none !important;
    width: auto !important;
    height: auto !important;
    max-width: none !important;
    min-width: 0 !important;
    min-height: 0 !important;
    overflow: visible;
    box-shadow:
      0 34px 90px rgba(0, 0, 0, 0.54),
      0 0 0 1px rgba(226, 232, 240, 0.08);
  }

  html[data-forge-theme="light"] & [data-workspace-tool-panel="true"][data-pane-mode="fullscreen"] {
    box-shadow:
      0 30px 70px rgba(15, 23, 42, 0.16),
      0 0 0 1px rgba(0, 0, 0, 0.08);
  }
`;

const TerminalPanelAnchor = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  background: #020304;
  pointer-events: none;

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }

  &[data-terminal-drag-placeholder="true"]::after {
    position: absolute;
    inset: 8px;
    border: 1px dashed rgba(148, 163, 184, 0.46);
    border-radius: 8px;
    background: rgba(148, 163, 184, 0.08);
    box-shadow: inset 0 0 20px rgba(148, 163, 184, 0.08);
    content: "";
  }
`;

const TerminalSurfaceLayer = styled.div`
  position: absolute;
  inset: 0;
  z-index: 20;
  overflow: visible;
  background: #020304;
  pointer-events: none;

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }

  &[data-terminal-breakout="true"] {
    background: transparent;
  }
`;

const TerminalSurfaceSlot = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  z-index: var(--terminal-slot-z, 1);
  width: var(--terminal-slot-width, 0px);
  height: var(--terminal-slot-height, 0px);
  min-width: 0;
  min-height: 0;
  overflow: visible;
  background: #020304;
  pointer-events: auto;
  transform: translate3d(var(--terminal-slot-x, 0px), var(--terminal-slot-y, 0px), 0);
  transition:
    width 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
    height 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
    transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1),
    filter 140ms ease,
    opacity 140ms ease;
  will-change: width, height, transform;

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }

  &[data-terminal-hidden="true"] {
    visibility: hidden;
    pointer-events: none;
  }

  &[data-terminal-dragging="true"] {
    z-index: 260;
    pointer-events: none;
    transition: none;
    filter: drop-shadow(0 28px 48px rgba(0, 0, 0, 0.46));
  }

  &[data-terminal-dragging="true"] > * {
    transform: scale(1.012);
    transform-origin: center;
  }

  &[data-terminal-fullscreen="true"] {
    z-index: 240;
  }
`;

const TerminalGridScaffold = styled.div`
  position: absolute;
  inset: 0;
  z-index: 6;
  min-width: 0;
  min-height: 0;
  opacity: 1;
  pointer-events: auto;
  transition:
    opacity 170ms ease,
    filter 170ms ease;

  &[data-breakout-visible="true"] {
    opacity: 0;
    pointer-events: none;
    filter: brightness(0.62);
  }
`;

const TerminalBreakoutCanvas = styled.div`
  position: absolute;
  inset: 0;
  z-index: 8;
  overflow: hidden;
  background: #020304;
  opacity: 0;
  pointer-events: none;
  transition: opacity 170ms ease;

  &[data-visible="true"] {
    opacity: 1;
    pointer-events: auto;
  }

  &[data-panning="true"] {
    cursor: grabbing;
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }
`;

const TerminalBreakoutBackgroundCanvas = styled.canvas`
  position: absolute;
  inset: 0;
  z-index: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
`;

const TerminalBreakoutPanPlane = styled.div`
  position: absolute;
  inset: 0;
  z-index: 1;
  cursor: grab;
`;

const TerminalBreakoutTopBar = styled.div`
  position: absolute;
  top: 7px;
  left: 50%;
  z-index: 74;
  display: inline-flex;
  max-width: calc(100% - 20px);
  align-items: center;
  gap: 2px;
  padding: 2px;
  border: 1px solid rgba(226, 232, 240, 0.12);
  border-radius: 999px;
  color: rgba(232, 238, 248, 0.86);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.024)),
    rgba(0, 0, 0, 0.74);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 10px 22px rgba(0, 0, 0, 0.24);
  transform: translateX(-50%);
  backdrop-filter: blur(14px) saturate(135%);

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.11);
    color: #2a2c31;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.86), rgba(255, 255, 255, 0.62)),
      rgba(230, 232, 236, 0.58);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.76),
      0 14px 30px rgba(15, 23, 42, 0.12);
  }
`;

const TerminalBreakoutTopBarDivider = styled.span`
  width: 1px;
  height: 14px;
  margin: 0 1px;
  border-radius: 999px;
  background: rgba(226, 232, 240, 0.14);

  html[data-forge-theme="light"] & {
    background: rgba(0, 0, 0, 0.12);
  }
`;

const TerminalBreakoutButton = styled.button`
  display: inline-grid;
  width: 23px;
  height: 23px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: inherit;
  background: transparent;
  cursor: pointer;
  outline: none;
  transition:
    background 140ms ease,
    color 140ms ease,
    opacity 140ms ease,
    transform 140ms ease;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.11);
  }

  &:active:not(:disabled) {
    transform: translateY(1px);
  }

  &:disabled {
    cursor: default;
    opacity: 0.42;
  }

  html[data-forge-theme="light"] &:hover:not(:disabled),
  html[data-forge-theme="light"] &:focus-visible {
    color: #05070a;
    background: rgba(0, 0, 0, 0.07);
  }
`;

const TODO_QUEUE_STORAGE_PREFIX = "diffforge.todoQueue.v1";
const TODO_QUEUE_REMOTE_COMMAND_RECEIPTS_PREFIX = "diffforge.todoQueue.remoteCommandReceipts.v1";
const TODO_QUEUE_REMOTE_COMMAND_RECEIPT_TTL_MS = 24 * 60 * 60 * 1000;
const TODO_QUEUE_REMOTE_COMMAND_RECEIPT_MAX_ITEMS = 400;
const TODO_QUEUE_REMOTE_COMMAND_BLOCKING_RECEIPT_STATES = new Set([
  "queued",
  "sending",
  "submitted",
  "completed",
]);
const TODO_QUEUE_VISIBLE_MIN_WIDTH = 760;
const TODO_QUEUE_MINIMIZED_WIDTH_PX = 32;
const TODO_QUEUE_RESTORED_MIN_WIDTH_PX = 300;
const TODO_QUEUE_MAX_ITEMS = 120;
const TODO_QUEUE_MAX_TEXT_LENGTH = 4000;
const TODO_QUEUE_MAX_NOTE_TEXT_LENGTH = 24000;
const TODO_QUEUE_NOTE_LINE_THRESHOLD = 6;
const TODO_QUEUE_NOTE_TITLE_LENGTH = 42;
const TODO_QUEUE_MAX_PASTE_IMAGES = 8;
const ORCHESTRATOR_VOICE_HISTORY_MAX_TURNS = 24;
const TODO_QUEUE_IMAGE_TERMINALS = new Set(["codex", "claude"]);
const VOICE_PLAN_STAGE_ORDER = ["execution", "revision"];
const VOICE_PLAN_COMPLETED_STATUSES = new Set([
  "accepted",
  "complete",
  "completed",
  "done",
  "finished",
  "merged",
  "not required",
  "not_required",
  "passed",
  "skipped",
  "success",
  "succeeded",
  "verified",
]);
const VOICE_PLAN_CLIENT_RELEASE_STATUSES = new Set([
  "queued",
  "ready",
  "ready_to_queue",
  "released",
  "sent_to_client",
]);
const VOICE_PLAN_PARKED_STATUSES = new Set([
  "parked",
  "resume_ready",
  "resume_requested",
]);
const WORKSPACE_TOOL_TABS = [
  { id: "orchestrator", label: "Orchestrator" },
  { id: "plans", label: "Plans" },
  { id: "git", label: "Git" },
  { id: "tokenomics", label: "Tokenomics" },
];
const TODO_QUEUE_PANE_MODE_NORMAL = "normal";
const TODO_QUEUE_PANE_MODE_MINIMIZED = "minimized";
const TODO_QUEUE_PANE_MODE_FULLSCREEN = "fullscreen";

const TodoQueueSurface = styled.aside`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr);
  padding: 0;
  border-left: 1px solid rgba(230, 236, 245, 0.08);
  color: #e8eef8;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.035), rgba(255, 255, 255, 0.012)),
    rgba(5, 8, 13, 0.96);
  overflow: hidden;

  html[data-forge-theme="light"] & {
    border-left-color: rgba(0, 0, 0, 0.08);
    color: #1d1d1f;
    background: #f5f5f7;
  }

  &[data-pane-mode="fullscreen"] {
    border-left: 0;
  }

  &[data-active-tool="orchestrator"] {
    grid-template-rows: auto minmax(0, 1fr);
  }
`;

const WorkspaceToolControlButton = styled.button`
  display: inline-grid;
  width: 24px;
  height: 24px;
  place-items: center;
  flex: 0 0 auto;
  border: 0;
  border-radius: 999px;
  color: rgba(232, 238, 248, 0.74);
  background: transparent;
  cursor: pointer;
  outline: none;
  transition:
    background 140ms ease,
    color 140ms ease,
    opacity 140ms ease,
    transform 140ms ease;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover,
  &:focus-visible,
  &[data-active="true"] {
    color: #ffffff;
    background: rgba(255, 255, 255, 0.1);
  }

  &:active {
    transform: translateY(1px);
  }

  html[data-forge-theme="light"] & {
    color: #5d626c;
  }

  html[data-forge-theme="light"] &:hover,
  html[data-forge-theme="light"] &:focus-visible,
  html[data-forge-theme="light"] &[data-active="true"] {
    color: #1d1d1f;
    background: rgba(0, 0, 0, 0.07);
  }
`;

const WorkspaceToolMinimizedRail = styled.aside`
  display: grid;
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: 1fr;
  place-items: center;
  padding: 7px 2px;
  border-left: 1px solid rgba(230, 236, 245, 0.08);
  color: rgba(232, 238, 248, 0.86);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.02)),
    rgba(0, 0, 0, 0.72);
  box-shadow:
    inset 1px 0 0 rgba(255, 255, 255, 0.045),
    0 8px 22px rgba(0, 0, 0, 0.2);
  overflow: hidden;
  backdrop-filter: blur(18px) saturate(135%);

  html[data-forge-theme="light"] & {
    border-left-color: rgba(0, 0, 0, 0.08);
    color: #2a2c31;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(255, 255, 255, 0.5)),
      rgba(18, 20, 24, 0.2);
    box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.8);
  }
`;

const WorkspaceToolRailControls = styled.div`
  position: absolute;
  top: 6px;
  left: 50%;
  z-index: 2;
  display: grid;
  place-items: center;
  transform: translateX(-50%);

  ${WorkspaceToolControlButton} {
    display: grid;
    width: 20px;
    height: 20px;
    color: rgba(232, 238, 248, 0.68);
    line-height: 0;
    padding: 0;
    place-items: center;

    svg {
      display: block;
      width: 11px;
      height: 11px;
    }
  }
`;

const WorkspaceToolRailLabel = styled.div`
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  color: rgba(232, 238, 248, 0.7);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0.08em;
  line-height: 1;
  text-transform: uppercase;
  user-select: none;

  html[data-forge-theme="light"] & {
    color: #2a2c31;
  }
`;

const OrchestratorTopNav = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr);
  min-height: 40px;
  border-bottom: 1px solid rgba(230, 236, 245, 0.08);
  background: rgba(2, 4, 8, 0.44);

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(0, 0, 0, 0.08);
    background: rgba(245, 245, 247, 0.86);
    backdrop-filter: saturate(180%) blur(20px);
  }
`;

const OrchestratorTopButton = styled.button`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-right: 1px solid rgba(230, 236, 245, 0.07);
  color: #9eabbc;
  background: transparent;
  cursor: pointer;
  font-size: 11px;
  font-weight: 780;
  line-height: 1;
  outline: none;
  transition:
    background 140ms ease,
    color 140ms ease,
    opacity 140ms ease;

  &:last-child {
    border-right: 0;
  }

  &[data-active="true"] {
    color: #f7fafc;
    background: rgba(47, 128, 255, 0.13);
  }

  &:disabled {
    cursor: default;
    opacity: 0.4;
  }

  &:not(:disabled):hover {
    color: #f7fafc;
    background: rgba(47, 128, 255, 0.16);
  }

  html[data-forge-theme="light"] & {
    border-right-color: rgba(0, 0, 0, 0.07);
    color: #333333;
  }

  html[data-forge-theme="light"] &[data-active="true"],
  html[data-forge-theme="light"] &:not(:disabled):hover {
    color: #0066cc;
    background: rgba(0, 102, 204, 0.08);
  }
`;

const OrchestratorView = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr);
`;

const OrchestratorVoiceArea = styled.div`
  display: grid;
  position: relative;
  min-height: 134px;
  place-items: center;
  gap: 10px;
  padding: 18px 12px 16px;
  border-bottom: 1px solid rgba(230, 236, 245, 0.08);
  background:
    radial-gradient(circle at center, rgba(98, 160, 255, 0.14), transparent 62%),
    rgba(2, 4, 8, 0.26);

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(0, 0, 0, 0.08);
    background: #ffffff;
  }
`;

const OrchestratorVoicePaneControls = styled.div`
  position: absolute;
  top: 3px;
  left: 50%;
  z-index: 8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 1px 2px;
  border: 1px solid rgba(226, 232, 240, 0.08);
  border-radius: 999px;
  transform: translateX(-50%);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.075), rgba(255, 255, 255, 0.02)),
    rgba(0, 0, 0, 0.72);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.055),
    0 8px 22px rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(18px) saturate(135%);

  ${WorkspaceToolControlButton} {
    width: 19px;
    height: 19px;
    color: rgba(232, 238, 248, 0.68);

    svg {
      width: 10px;
      height: 10px;
    }
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.1);
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(255, 255, 255, 0.5)),
      rgba(18, 20, 24, 0.2);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.72),
      0 8px 20px rgba(15, 23, 42, 0.1);
  }
`;

const OrchestratorVoiceControls = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  gap: 10px;
`;

const OrchestratorVoiceButton = styled.button`
  display: grid;
  position: relative;
  isolation: isolate;
  box-sizing: border-box;
  width: 58px;
  height: 58px;
  padding: 0;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  background: #000000;
  box-shadow: 0 0 0 4px rgba(244, 247, 250, 0.1);
  cursor: pointer;
  line-height: 0;
  outline: none;
  overflow: visible;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    transform 150ms ease;
  appearance: none;
  -webkit-appearance: none;

  &::before {
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: inherit;
    background:
      radial-gradient(circle, rgba(125, 176, 255, 0.2), transparent 62%),
      radial-gradient(circle, rgba(217, 121, 53, 0.1), transparent 76%);
    content: "";
    opacity: 0;
    transform: scale(0.92);
    transition:
      opacity 160ms ease,
      transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1);
    pointer-events: none;
  }

  html[data-forge-theme="light"] &::before {
    background:
      radial-gradient(circle, rgba(0, 102, 204, 0.15), transparent 62%),
      radial-gradient(circle, rgba(221, 112, 31, 0.09), transparent 76%);
  }

  &:hover {
    border-color: rgba(138, 216, 255, 0.26);
    box-shadow: 0 0 0 4px rgba(125, 176, 255, 0.16);
  }

  &:active {
    transform: scale(0.98);
  }

  &[data-monitoring="true"] {
    border-color: rgba(138, 216, 255, 0.34);
    box-shadow:
      0 0 0 4px rgba(125, 176, 255, 0.13),
      0 0 0 1px rgba(138, 216, 255, 0.14) inset;
  }

  &[data-monitoring="true"]::before {
    opacity: 1;
    transform: scale(1);
  }

  &[data-starting="true"] {
    cursor: progress;
  }

  &[data-error="true"] {
    border-color: rgba(239, 68, 68, 0.52);
    box-shadow:
      0 0 0 4px rgba(239, 68, 68, 0.1),
      0 0 24px rgba(239, 68, 68, 0.12);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(255, 255, 255, 0.16);
    background: #000000;
    box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.08);
  }

  html[data-forge-theme="light"] &:hover {
    border-color: rgba(255, 255, 255, 0.22);
    box-shadow: 0 0 0 4px rgba(0, 102, 204, 0.12);
  }

  html[data-forge-theme="light"] &[data-monitoring="true"] {
    border-color: rgba(255, 255, 255, 0.36);
    box-shadow:
      0 0 0 4px rgba(0, 102, 204, 0.11),
      0 0 0 1px rgba(0, 102, 204, 0.12) inset;
  }
`;

const OrchestratorVoiceCancelButton = styled.button`
  display: inline-grid;
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 8;
  width: 32px;
  height: 32px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 117, 117, 0.22);
  border-radius: 999px;
  color: #ff8d8d;
  background: rgba(61, 15, 18, 0.64);
  cursor: pointer;
  outline: none;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    transform 150ms ease;

  &:hover {
    border-color: rgba(255, 117, 117, 0.42);
    color: #ffd0d0;
    background: rgba(96, 20, 26, 0.82);
  }

  &:active {
    transform: scale(0.97);
  }

  > svg {
    width: 18px;
    height: 18px;
  }

  html[data-forge-theme="light"] & {
    color: #b42318;
    background: rgba(244, 63, 94, 0.1);
  }
`;

const OrchestratorVoiceCanvasSurface = styled.canvas`
  position: absolute;
  inset: -22px;
  z-index: 3;
  display: block;
  width: calc(100% + 44px);
  height: calc(100% + 44px);
  border-radius: inherit;
  opacity: 0;
  transform: scale(0.985);
  transition:
    opacity 150ms ease,
    transform 170ms cubic-bezier(0.2, 0.8, 0.2, 1);
  pointer-events: none;

  &[data-active="true"] {
    opacity: 1;
    transform: scale(1);
  }
`;

const OrchestratorVoiceLogo = styled.img.attrs({
  alt: "",
  draggable: false,
  src: "/logo.webp",
})`
  display: block;
  width: 100%;
  height: 100%;
  border-radius: inherit;
  background: #000000;
  object-fit: cover;
  object-position: center;
  position: relative;
  z-index: 2;
  user-select: none;
  -webkit-user-drag: none;
`;

const OrchestratorSectionTabs = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 38px;
  border-bottom: 1px solid rgba(230, 236, 245, 0.08);

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(0, 0, 0, 0.08);
  }
`;

const OrchestratorSectionButton = styled.button`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  border: 0;
  border-right: 1px solid rgba(230, 236, 245, 0.07);
  color: #8996a8;
  background: rgba(2, 4, 8, 0.3);
  font-size: 11px;
  font-weight: 780;
  outline: none;
  transition:
    background 140ms ease,
    color 140ms ease;

  &:last-child {
    border-right: 0;
  }

  &[data-active="true"] {
    color: #f7fafc;
    background: rgba(47, 128, 255, 0.12);
  }

  &:hover {
    color: #f7fafc;
    background: rgba(47, 128, 255, 0.16);
  }

  html[data-forge-theme="light"] & {
    border-right-color: rgba(0, 0, 0, 0.07);
    color: #7a7a7a;
    background: #fafafc;
  }

  html[data-forge-theme="light"] &[data-active="true"],
  html[data-forge-theme="light"] &:hover {
    color: #0066cc;
    background: rgba(0, 102, 204, 0.08);
  }
`;

const OrchestratorContent = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
`;

const OrchestratorHistoryView = styled.div`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr) auto;
  color: #7f8da1;
  background: rgba(2, 4, 8, 0.76);
  font-size: 12px;
  font-weight: 720;
  overflow: hidden;

  html[data-forge-theme="light"] & {
    color: #7a7a7a;
    background: #ffffff;
  }
`;

const OrchestratorHistoryScroll = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;

  html[data-forge-theme="light"] & {
    color: #7a7a7a;
    background: #ffffff;
  }
`;

const OrchestratorHistoryError = styled.div`
  display: grid;
  gap: 6px;
  width: 100%;
  padding: 11px 14px;
  border-bottom: 1px solid rgba(239, 68, 68, 0.28);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.2);

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(185, 28, 28, 0.24);
    color: #7f1d1d;
    background: rgba(254, 226, 226, 0.72);
  }
`;

const OrchestratorHistoryErrorTitle = styled.div`
  color: #fca5a5;
  font-size: 11px;
  font-weight: 820;
  line-height: 1.2;

  html[data-forge-theme="light"] & {
    color: #b91c1c;
  }
`;

const OrchestratorHistoryErrorText = styled.div`
  min-width: 0;
  color: inherit;
  font-size: 12px;
  font-weight: 680;
  line-height: 1.35;
  overflow-wrap: anywhere;
`;

const OrchestratorHistoryEmpty = styled.div`
  display: grid;
  min-height: 100%;
  place-items: center;
  padding: 22px 14px;
  color: #7f8da1;
  text-align: center;
`;

const OrchestratorHistoryList = styled.div`
  display: grid;
  min-width: 0;
  min-height: 100%;
  align-content: start;
  gap: 14px;
  padding: 14px 12px 16px;
`;

const OrchestratorHistoryTurn = styled.article`
  display: grid;
  min-width: 0;
  gap: 9px;
  background: transparent;

  &[data-pending="true"] {
    background: transparent;
  }

  &[data-cancelled="true"] {
    opacity: 0.72;
  }

  html[data-forge-theme="light"] & {
    background: transparent;
  }

  html[data-forge-theme="light"] &[data-pending="true"] {
    background: transparent;
  }
`;

const OrchestratorHistoryUserMessage = styled.div`
  display: grid;
  min-width: 0;
  justify-items: end;
  gap: 5px;
`;

const OrchestratorHistoryAssistantMessage = styled.div`
  display: grid;
  width: min(88%, 540px);
  min-width: 0;
  gap: 5px;
  justify-self: start;
`;

const OrchestratorHistoryMessageActions = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 9px;
  color: #a7a7a7;
  font-size: 10px;
  font-weight: 650;
  line-height: 1;

  &[data-align="right"] {
    justify-content: flex-end;
    padding-right: 8px;
  }

  &[data-align="left"] {
    justify-content: flex-start;
    padding-left: 4px;
  }

  html[data-forge-theme="light"] & {
    color: #7a7a7a;
  }
`;

const OrchestratorHistoryMessageTime = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 22px;
`;

const OrchestratorHistoryCopyButton = styled.button`
  display: inline-flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 999px;
  color: #a7a7a7;
  background: transparent;
  cursor: pointer;
  line-height: 1;
  outline: none;
  transition:
    background 140ms ease,
    color 140ms ease,
    opacity 140ms ease;

  &:hover {
    color: #f2f2f2;
    background: rgba(255, 255, 255, 0.08);
  }

  &[data-copied="true"] {
    color: #f2f2f2;
  }

  html[data-forge-theme="light"] & {
    color: #777777;
  }

  html[data-forge-theme="light"] &:hover,
  html[data-forge-theme="light"] &[data-copied="true"] {
    color: #20242b;
    background: rgba(0, 0, 0, 0.06);
  }
`;

const OrchestratorHistoryCopyIcon = styled(ContentCopy)`
  display: block;
  width: 15px;
  height: 15px;
`;

const OrchestratorHistoryCopiedIcon = styled(Check)`
  display: block;
  width: 16px;
  height: 16px;
`;

const OrchestratorHistoryTurnHeader = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 9px 14px 6px;
`;

const OrchestratorHistoryTurnLabel = styled.div`
  min-width: 0;
  color: #c8d2e0;
  font-size: 11px;
  font-weight: 820;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: #2f3744;
  }
`;

const OrchestratorHistoryTurnStatus = styled.div`
  flex: 0 0 auto;
  color: #8fb8ff;
  font-size: 10px;
  font-weight: 820;
  line-height: 1.2;
  text-transform: uppercase;

  html[data-forge-theme="light"] & {
    color: #0066cc;
  }

  &[data-status="cancelled"] {
    color: #ff9b73;
  }

  html[data-forge-theme="light"] &[data-status="cancelled"] {
    color: #b45309;
  }
`;

const OrchestratorHistoryTranscript = styled.div`
  min-width: 0;
  max-width: min(86%, 460px);
  padding: 11px 14px 12px;
  border: 1px solid rgba(255, 255, 255, 0.045);
  border-radius: 20px;
  color: #dedede;
  background: #242424;
  font-size: 11.5px;
  font-weight: 660;
  line-height: 1.42;
  overflow-wrap: anywhere;
  box-shadow: none;

  &[data-pending="true"] {
    color: #d2d2d2;
    background: #242424;
  }

  &[data-cancelled="true"] {
    border-color: rgba(255, 149, 103, 0.18);
    color: rgba(255, 220, 202, 0.8);
    background:
      linear-gradient(135deg, rgba(255, 149, 103, 0.08), rgba(67, 42, 30, 0.2)),
      #242424;
    text-decoration: line-through;
    text-decoration-thickness: 1px;
    text-decoration-color: rgba(255, 149, 103, 0.56);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.05);
    color: #242424;
    background: #eeeeee;
    box-shadow: none;
  }

  html[data-forge-theme="light"] &[data-pending="true"] {
    color: #343434;
    background: #eeeeee;
  }

  html[data-forge-theme="light"] &[data-cancelled="true"] {
    border-color: rgba(180, 83, 9, 0.16);
    color: rgba(91, 50, 15, 0.74);
    background: rgba(255, 247, 237, 0.92);
  }
`;

const OrchestratorHistoryLlm = styled.div`
  display: grid;
  min-width: 0;
  gap: 5px;
  padding: 1px 4px 3px;
  background: transparent;

  html[data-forge-theme="light"] & {
    background: transparent;
  }
`;

const OrchestratorHistoryLlmLabel = styled.div`
  color: #9fb0c7;
  font-size: 10px;
  font-weight: 820;
  line-height: 1.2;
  text-transform: uppercase;

  html[data-forge-theme="light"] & {
    color: #6b7280;
  }
`;

const OrchestratorHistoryLlmText = styled.div`
  min-width: 0;
  color: #dfe7f2;
  font-size: 12px;
  font-weight: 680;
  line-height: 1.46;
  overflow-wrap: anywhere;

  html[data-forge-theme="light"] & {
    color: #20242b;
  }
`;

const orchestratorHistorySpinner = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const orchestratorHistorySendPulse = keyframes`
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.22);
  }

  50% {
    box-shadow: 0 0 0 5px rgba(255, 255, 255, 0.06);
  }
`;

const OrchestratorHistoryPendingLine = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  color: #b9c7d9;
`;

const OrchestratorHistoryInlineSpinner = styled.span`
  display: inline-block;
  flex: 0 0 auto;
  width: 11px;
  height: 11px;
  border: 2px solid rgba(125, 176, 255, 0.2);
  border-top-color: rgba(125, 176, 255, 0.88);
  border-radius: 999px;
  animation: ${orchestratorHistorySpinner} 760ms linear infinite;

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.16);
    border-top-color: rgba(0, 102, 204, 0.82);
  }
`;

const OrchestratorHistoryPlan = styled.div`
  display: grid;
  width: min(94%, 560px);
  min-width: 0;
  gap: 8px;
  justify-self: start;
  padding: 9px 4px 4px;
  border-top: 1px solid rgba(45, 212, 191, 0.2);
  background: transparent;

  html[data-forge-theme="light"] & {
    border-top-color: rgba(13, 148, 136, 0.2);
    background: transparent;
  }
`;

const OrchestratorHistoryPlanHeader = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const OrchestratorHistoryPlanTitle = styled.div`
  min-width: 0;
  color: #eef4ff;
  font-size: 12px;
  font-weight: 820;
  line-height: 1.24;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: #20242b;
  }
`;

const OrchestratorHistoryPlanStatus = styled.div`
  flex: 0 0 auto;
  color: #7dd3fc;
  font-size: 10px;
  font-weight: 820;
  line-height: 1.2;
  text-transform: uppercase;

  html[data-forge-theme="light"] & {
    color: #0369a1;
  }
`;

const OrchestratorHistoryPlanGoal = styled.div`
  min-width: 0;
  color: #b9c7d9;
  font-size: 11px;
  font-weight: 660;
  line-height: 1.35;
  overflow-wrap: anywhere;

  html[data-forge-theme="light"] & {
    color: #56616f;
  }
`;

const OrchestratorHistoryPlanSteps = styled.div`
  display: grid;
  min-width: 0;
  gap: 7px;
`;

const OrchestratorHistoryPlanStep = styled.div`
  display: grid;
  min-width: 0;
  gap: 6px;
  padding: 8px 0 0;
  border-top: 1px solid rgba(230, 236, 245, 0.08);
  background: transparent;

  &[data-active="true"] {
    border-top-color: rgba(45, 212, 191, 0.26);
  }

  html[data-forge-theme="light"] & {
    border-top-color: rgba(0, 0, 0, 0.08);
    background: transparent;
  }

  html[data-forge-theme="light"] &[data-active="true"] {
    border-top-color: rgba(13, 148, 136, 0.22);
  }
`;

const OrchestratorHistoryPlanStepTitle = styled.div`
  min-width: 0;
  color: #d8e2f0;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.28;
  overflow-wrap: anywhere;

  html[data-forge-theme="light"] & {
    color: #343a46;
  }
`;

const OrchestratorHistoryPlanStage = styled.div`
  display: grid;
  min-width: 0;
  gap: 4px;
`;

const OrchestratorHistoryPlanStageHeader = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: #9fb0c7;
  font-size: 10px;
  font-weight: 820;
  line-height: 1.2;
  text-transform: uppercase;

  &[data-active="true"] {
    color: #5eead4;
  }

  html[data-forge-theme="light"] & {
    color: #6b7280;
  }

  html[data-forge-theme="light"] &[data-active="true"] {
    color: #0f766e;
  }
`;

const OrchestratorHistoryPlanTaskList = styled.div`
  display: grid;
  min-width: 0;
  gap: 3px;
`;

const OrchestratorHistoryPlanTask = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: 60px minmax(0, 1fr);
  gap: 6px;
  color: #c8d2e0;
  font-size: 11px;
  font-weight: 650;
  line-height: 1.28;
  overflow-wrap: anywhere;

  span {
    color: #7f8da1;
    font-size: 9px;
    font-weight: 820;
    text-transform: uppercase;
  }

  html[data-forge-theme="light"] & {
    color: #343a46;
  }

  html[data-forge-theme="light"] & span {
    color: #6b7280;
  }
`;

const OrchestratorHistoryComposer = styled.form`
  display: flex;
  min-width: 0;
  justify-content: center;
  padding: 10px 12px 12px;
  border-top: 1px solid rgba(230, 236, 245, 0.08);
  background: rgba(3, 7, 13, 0.92);

  html[data-forge-theme="light"] & {
    border-top-color: rgba(0, 0, 0, 0.08);
    background: #ffffff;
  }
`;

const OrchestratorHistoryInputFrame = styled.div`
  position: relative;
  width: min(440px, 100%);
  min-width: 0;
`;

const OrchestratorHistoryInput = styled.textarea`
  display: block;
  width: 100%;
  min-width: 0;
  min-height: 46px;
  max-height: 104px;
  padding: 12px 48px 12px 16px;
  border: 1px solid rgba(230, 236, 245, 0.11);
  border-radius: 23px;
  color: #eef4ff;
  background: rgba(8, 12, 18, 0.82);
  font: inherit;
  font-size: 12px;
  font-weight: 680;
  line-height: 1.35;
  outline: none;
  resize: none;

  &::placeholder {
    color: #657386;
  }

  &:focus {
    border-color: rgba(125, 176, 255, 0.45);
  }

  &:disabled {
    cursor: default;
    opacity: 0.56;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.1);
    color: #20242b;
    background: #f7f8fb;
  }

  html[data-forge-theme="light"] &::placeholder {
    color: #8a94a3;
  }

  html[data-forge-theme="light"] &:focus {
    border-color: rgba(0, 102, 204, 0.38);
  }
`;

const OrchestratorHistorySendButton = styled.button`
  position: absolute;
  right: 7px;
  bottom: 7px;
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 999px;
  color: #8d9aac;
  background: rgba(21, 27, 36, 0.94);
  line-height: 1;
  outline: none;
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease,
    color 140ms ease,
    opacity 140ms ease;

  &:not(:disabled):hover {
    border-color: rgba(255, 255, 255, 0.42);
    color: #05070a;
    background: #ffffff;
  }

  &[data-ready="true"],
  &[data-animated="true"] {
    border-color: rgba(255, 255, 255, 0.5);
    color: #05070a;
    background: #ffffff;
  }

  &[data-animated="true"] {
    animation: ${orchestratorHistorySendPulse} 900ms ease-in-out infinite;
  }

  &:disabled {
    cursor: default;
    opacity: 0.68;
  }

  &[data-animated="true"]:disabled {
    opacity: 1;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.11);
    color: #8a94a3;
    background: #e9edf4;
  }

  html[data-forge-theme="light"] &:not(:disabled):hover {
    border-color: rgba(0, 0, 0, 0.14);
    color: #05070a;
    background: #ffffff;
  }

  html[data-forge-theme="light"] &[data-ready="true"],
  html[data-forge-theme="light"] &[data-animated="true"] {
    border-color: rgba(0, 0, 0, 0.14);
    color: #05070a;
    background: #ffffff;
  }
`;

const OrchestratorHistorySendIcon = styled(North)`
  display: block;
  width: 17px;
  height: 17px;
  flex: 0 0 auto;
`;

const WorkspaceToolSurface = styled.div`
  display: grid;
  width: 100%;
  height: 100%;
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #05070a;

  > * {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
  }

  &[data-tool="files"] {
    background: var(--files-vscode-editor, #030405);
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }
`;

const TodoQueueComposer = styled.form`
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
`;

const TodoQueueBoard = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
`;

const TodoQueueTextArea = styled.textarea`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  min-height: 0;
  resize: none;
  padding: calc(8px + var(--todo-list-offset, 0px)) 36px 8px 32px;
  border: 0;
  border-radius: 0;
  color: #f7fafc;
  background: rgba(2, 4, 8, 0.76);
  font: 12px/1.45 "Cascadia Mono", "SFMono-Regular", Consolas, monospace;
  outline: none;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    background 150ms ease,
    padding 150ms ease;

  &::placeholder {
    color: rgba(166, 178, 194, 0.58);
  }

  &:focus {
    border-color: rgba(98, 160, 255, 0.46);
    background: rgba(2, 5, 10, 0.94);
    box-shadow:
      0 0 0 1px rgba(98, 160, 255, 0.12),
      0 0 22px rgba(47, 128, 255, 0.08);
  }

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
    background: #ffffff;
  }

  html[data-forge-theme="light"] &::placeholder {
    color: #7a7a7a;
  }

  html[data-forge-theme="light"] &:focus {
    background: #ffffff;
    box-shadow: inset 0 0 0 1px rgba(0, 102, 204, 0.2);
  }
`;

const TodoQueueList = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 2;
  display: grid;
  align-content: start;
  max-height: calc(100% - 42px);
  gap: 0;
  overflow-x: hidden;
  overflow-y: auto;
`;

const TodoQueueItemCard = styled.article`
  --todo-dot-center-x: 19px;
  --todo-dot-center-y: 19px;
  --todo-dot-radius: 3px;
  --todo-dot-size: 6px;
  --todo-spinner-radius: 8px;
  --todo-spinner-size: 16px;

  position: relative;
  display: grid;
  min-height: 35px;
  grid-template-columns: 20px minmax(0, 1fr);
  align-items: start;
  padding: 8px 36px 8px 12px;
  border: 0;
  border-radius: 0;
  color: #eef4fb;
  background: transparent;
  cursor: grab;
  touch-action: none;
  transition:
    background 150ms ease,
    opacity 150ms ease,
    transform 150ms ease;
  user-select: none;

  &::before {
    content: "";
    width: var(--todo-dot-size);
    height: var(--todo-dot-size);
    margin-top: calc(var(--todo-dot-center-y) - 8px - var(--todo-dot-radius));
    margin-left: calc(var(--todo-dot-center-x) - 12px - var(--todo-dot-radius));
    border-radius: 999px;
    background: var(--todo-agent-color, ${TODO_QUEUE_DEFAULT_DOT_COLOR});
    box-shadow: none;
    transition: opacity 130ms ease;
  }

  &:hover {
    background: rgba(47, 128, 255, 0.1);
  }

  &:hover::before,
  &:focus-within::before {
    opacity: 0;
  }

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
  }

  html[data-forge-theme="light"] &::before {
    background: var(--todo-agent-color, #0066cc);
  }

  html[data-forge-theme="light"] &:hover {
    background: rgba(0, 102, 204, 0.06);
  }

  &:active {
    cursor: grabbing;
  }

  &[data-todo-pending="true"] {
    cursor: progress;
    opacity: 0.74;
  }

  &[data-todo-pending="true"]::before {
    content: "";
  }

  &[data-todo-pending="true"]:active {
    cursor: progress;
  }

  &[data-todo-pending="true"] [data-todo-delete="true"] {
    opacity: 0;
    pointer-events: none;
  }

  &[data-todo-queued="true"] {
    cursor: default;
  }

  &[data-todo-sending="true"] {
    cursor: progress;
  }

  &[data-todo-dragging="true"] {
    opacity: 0.42;
    transform: scale(0.985);
  }

  &[data-todo-editing="true"] {
    padding-right: 12px;
    cursor: text;
    user-select: text;
  }

  &[data-todo-reordering="true"] {
    background: rgba(47, 128, 255, 0.14);
  }

  &:hover [data-todo-delete="true"],
  &:focus-within [data-todo-delete="true"] {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
`;

const TodoQueueItemActionButton = styled.button`
  position: absolute;
  top: 6px;
  left: 7px;
  z-index: 3;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: #cfe2ff;
  background: rgba(47, 128, 255, 0.16);
  opacity: 0;
  pointer-events: none;
  transition:
    background 130ms ease,
    color 130ms ease,
    opacity 130ms ease,
    transform 130ms ease;

  &:hover {
    color: #ffffff;
    background: rgba(47, 128, 255, 0.26);
    transform: translateY(-1px);
  }

  &:focus-visible {
    outline: 2px solid rgba(139, 184, 255, 0.52);
    outline-offset: 1px;
    opacity: 1;
    pointer-events: auto;
  }

  &[data-action="cancel"] {
    color: #ffd2d2;
    background: rgba(239, 107, 107, 0.16);
  }

  &[data-action="cancel"]:hover {
    color: #ffffff;
    background: rgba(239, 107, 107, 0.28);
  }

  ${TodoQueueItemCard}:hover &[data-visible="true"],
  ${TodoQueueItemCard}:focus-within &[data-visible="true"] {
    opacity: 1;
    pointer-events: auto;
  }

  html[data-forge-theme="light"] & {
    color: #0056b3;
    background: rgba(0, 102, 204, 0.1);
  }

  html[data-forge-theme="light"] &:hover {
    color: #003f82;
    background: rgba(0, 102, 204, 0.18);
  }

  html[data-forge-theme="light"] &[data-action="cancel"] {
    color: #b42318;
    background: rgba(180, 35, 24, 0.1);
  }

  html[data-forge-theme="light"] &[data-action="cancel"]:hover {
    color: #8f1c13;
    background: rgba(180, 35, 24, 0.18);
  }

  svg {
    width: 14px;
    height: 14px;
  }
`;

const todoQueuePendingSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const TodoQueueItemPendingSpinner = styled.div`
  position: absolute;
  top: calc(var(--todo-dot-center-y) - var(--todo-spinner-radius));
  left: calc(var(--todo-dot-center-x) - var(--todo-spinner-radius));
  z-index: 2;
  width: var(--todo-spinner-size);
  height: var(--todo-spinner-size);
  pointer-events: none;
  transition: opacity 130ms ease;

  animation: ${todoQueuePendingSpin} 850ms linear infinite;

  ${TodoQueueItemCard}[data-todo-cancellable="true"]:hover &,
  ${TodoQueueItemCard}[data-todo-cancellable="true"]:focus-within & {
    opacity: 0;
  }

  span {
    position: absolute;
    top: 1px;
    left: 7px;
    width: 2px;
    height: 5px;
    border-radius: 999px;
    background: #8bb8ff;
    opacity: calc(0.26 + (var(--todo-spinner-index, 0) * 0.085));
    transform: rotate(calc(var(--todo-spinner-index, 0) * 45deg)) translateY(-1px);
    transform-origin: 1px 7px;
  }

  html[data-forge-theme="light"] & span {
    background: #0066cc;
  }
`;

const TodoQueueItemContent = styled.div`
  display: grid;
  min-width: 0;
  align-items: center;
  gap: 10px;
  grid-template-columns: minmax(0, 1fr);

  &[data-has-preview="true"] {
    grid-template-columns: auto minmax(0, 1fr);
  }
`;

const TodoQueueItemImageFrame = styled.div`
  display: grid;
  width: 128px;
  height: 128px;
  place-items: center;
  align-self: center;
  overflow: hidden;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 8px;
  background: rgba(2, 4, 8, 0.34);

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.08);
    background: #fafafc;
  }
`;

const TodoQueueItemImage = styled.img.attrs({ draggable: false })`
  display: block;
  max-width: 128px;
  max-height: 128px;
  object-fit: contain;
  user-select: none;
`;

const TodoQueueItemNoteFrame = styled.div`
  display: grid;
  width: 128px;
  height: 128px;
  grid-template-rows: auto minmax(0, 1fr);
  align-self: center;
  gap: 10px;
  overflow: hidden;
  padding: 10px;
  border: 1px solid rgba(230, 236, 245, 0.1);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(98, 160, 255, 0.12), rgba(255, 255, 255, 0.025)),
    rgba(2, 4, 8, 0.34);

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.08);
    background: #fafafc;
  }
`;

const TodoQueueItemNoteTitle = styled.div`
  min-width: 0;
  overflow: hidden;
  color: #edf5ff;
  font-size: 10px;
  font-weight: 820;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
  }
`;

const TodoQueueItemNoteIcon = styled.div`
  position: relative;
  width: 42px;
  height: 52px;
  align-self: center;
  justify-self: center;
  border: 1px solid rgba(138, 216, 255, 0.42);
  border-radius: 5px;
  background: rgba(13, 17, 23, 0.7);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.22);
    background: #ffffff;
    box-shadow: none;
  }

  &::before {
    position: absolute;
    top: -1px;
    right: -1px;
    width: 14px;
    height: 14px;
    border-bottom: 1px solid rgba(138, 216, 255, 0.32);
    border-left: 1px solid rgba(138, 216, 255, 0.32);
    border-bottom-left-radius: 4px;
    background: rgba(98, 160, 255, 0.18);
    content: "";
  }

  &::after {
    position: absolute;
    right: 9px;
    bottom: 11px;
    left: 9px;
    height: 16px;
    border-top: 1px solid rgba(237, 245, 255, 0.44);
    border-bottom: 1px solid rgba(237, 245, 255, 0.28);
    box-shadow: 0 7px 0 rgba(237, 245, 255, 0.22);
    content: "";
  }
`;

const TodoQueueItemText = styled.p`
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: #edf5ff;
  font: 12px/1.45 "Cascadia Mono", "SFMono-Regular", Consolas, monospace;

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
  }
`;

const TodoQueueItemEditor = styled.textarea`
  width: 100%;
  min-height: 86px;
  max-height: 240px;
  resize: vertical;
  padding: 0;
  border: 0;
  color: #f7fafc;
  background: transparent;
  outline: none;
  font: 12px/1.45 "Cascadia Mono", "SFMono-Regular", Consolas, monospace;

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
  }
`;

const TodoQueueDraftBullet = styled.span`
  position: absolute;
  top: calc(16px + var(--todo-list-offset, 0px));
  left: 16px;
  z-index: 1;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: ${TODO_QUEUE_DEFAULT_DOT_COLOR};
  pointer-events: none;
  transition: top 150ms ease;

  &::before {
    content: "";
  }

  html[data-forge-theme="light"] & {
    background: #0066cc;
  }
`;

const TodoQueueDeleteButton = styled.button`
  position: absolute;
  top: 6px;
  right: 7px;
  display: grid;
  width: 22px;
  height: 22px;
  place-items: center;
  border: 1px solid rgba(239, 107, 107, 0.14);
  border-radius: 6px;
  color: #ffd0d0;
  background: rgba(127, 29, 29, 0.18);
  font-size: 12px;
  font-weight: 900;
  line-height: 1;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-2px);
  transition:
    background 140ms ease,
    border-color 140ms ease,
    opacity 140ms ease,
    transform 140ms ease;

  &:hover {
    border-color: rgba(239, 107, 107, 0.34);
    background: rgba(239, 107, 107, 0.16);
  }

  html[data-forge-theme="light"] & {
    color: #b42318;
    background: rgba(180, 35, 24, 0.08);
  }
`;

const TodoQueueError = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 3;
  border: 1px solid rgba(248, 113, 113, 0.26);
  border-radius: 8px;
  padding: 8px 9px;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.18);
  font-size: 11px;
  font-weight: 720;
  line-height: 1.4;

  html[data-forge-theme="light"] & {
    border-color: rgba(180, 35, 24, 0.2);
    color: #b42318;
    background: rgba(180, 35, 24, 0.08);
  }
`;

const TodoDragPreview = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  z-index: 6000;
  display: grid;
  width: min(var(--todo-drag-width, 280px), calc(100vw - 24px));
  max-height: min(260px, calc(100vh - 24px));
  gap: 7px;
  overflow: hidden;
  padding: 10px;
  border: 1px solid rgba(138, 216, 255, 0.52);
  border-radius: 8px;
  color: #f5fbff;
  background:
    linear-gradient(90deg, rgba(47, 128, 255, 0.18), rgba(255, 122, 24, 0.08)),
    rgba(5, 10, 18, 0.96);
  box-shadow:
    0 22px 54px rgba(0, 0, 0, 0.46),
    0 0 0 1px rgba(255, 255, 255, 0.05);
  opacity: 0.96;
  pointer-events: none;
  transform: translate3d(var(--todo-drag-x, 0px), var(--todo-drag-y, 0px), 0);
  will-change: transform;

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 102, 204, 0.28);
    color: #1d1d1f;
    background: #ffffff;
    box-shadow: none;
  }
`;

const TodoDragPreviewText = styled.div`
  overflow: hidden;
  overflow-wrap: anywhere;
  color: #f4faff;
  font-size: 12px;
  font-weight: 760;
  line-height: 1.45;
  white-space: pre-wrap;
`;

const TERMINAL_PANEL_ANCHOR_SELECTOR = "[data-terminal-panel-anchor='true']";

function normalizeViewTerminalRows(rows) {
  const usedIndexes = new Set();
  const normalizedRows = [];

  if (!Array.isArray(rows)) {
    return [];
  }

  rows.forEach((row) => {
    const rowIndexes = Array.isArray(row?.terminalIndexes)
      ? row.terminalIndexes
      : Array.isArray(row)
        ? row
        : [];
    const terminalIndexes = [];

    rowIndexes.forEach((index) => {
      const terminalIndex = Number.parseInt(index, 10);
      if (
        Number.isInteger(terminalIndex)
        && terminalIndex >= 0
        && !usedIndexes.has(terminalIndex)
      ) {
        usedIndexes.add(terminalIndex);
        terminalIndexes.push(terminalIndex);
      }
    });

    if (terminalIndexes.length) {
      normalizedRows.push({
        rowIndex: normalizedRows.length,
        terminalIndexes,
      });
    }
  });

  return normalizedRows;
}

function cloneTerminalRows(rows) {
  return normalizeViewTerminalRows(rows).map((row, rowIndex) => ({
    rowIndex,
    terminalIndexes: row.terminalIndexes.slice(),
  }));
}

function serializeTerminalRows(rows) {
  return cloneTerminalRows(rows)
    .map((row) => row.terminalIndexes.join(","))
    .join("|");
}

function areTerminalRowsEqual(leftRows, rightRows) {
  const left = cloneTerminalRows(leftRows);
  const right = cloneTerminalRows(rightRows);

  return left.length === right.length
    && left.every((leftRow, rowIndex) => (
      leftRow.terminalIndexes.length === right[rowIndex].terminalIndexes.length
      && leftRow.terminalIndexes.every((terminalIndex, columnIndex) => (
        terminalIndex === right[rowIndex].terminalIndexes[columnIndex]
      ))
    ));
}

function removeTerminalFromRows(rows, terminalIndex) {
  return cloneTerminalRows(rows)
    .map((row) => row.terminalIndexes.filter((index) => index !== terminalIndex))
    .filter((terminalIndexes) => terminalIndexes.length)
    .map((terminalIndexes, rowIndex) => ({
      rowIndex,
      terminalIndexes,
    }));
}

function findTerminalRowPosition(rows, terminalIndex) {
  const normalizedRows = cloneTerminalRows(rows);

  for (let rowIndex = 0; rowIndex < normalizedRows.length; rowIndex += 1) {
    const columnIndex = normalizedRows[rowIndex].terminalIndexes.indexOf(terminalIndex);
    if (columnIndex >= 0) {
      return { rowIndex, columnIndex };
    }
  }

  return null;
}

function insertTerminalInRows(rows, terminalIndex, target) {
  const withoutTerminal = removeTerminalFromRows(rows, terminalIndex);

  if (!withoutTerminal.length) {
    return [{ rowIndex: 0, terminalIndexes: [terminalIndex] }];
  }

  const rowIndex = Math.max(0, Math.min(Number.parseInt(target?.rowIndex, 10) || 0, withoutTerminal.length));
  const nextRows = withoutTerminal.map((row) => row.terminalIndexes.slice());

  if (rowIndex >= nextRows.length) {
    nextRows.push([terminalIndex]);
  } else {
    const columnIndex = Math.max(
      0,
      Math.min(Number.parseInt(target?.columnIndex, 10) || 0, nextRows[rowIndex].length),
    );
    nextRows[rowIndex].splice(columnIndex, 0, terminalIndex);
  }

  return nextRows
    .filter((terminalIndexes) => terminalIndexes.length)
    .map((terminalIndexes, nextRowIndex) => ({
      rowIndex: nextRowIndex,
      terminalIndexes,
    }));
}

function getAbsoluteRect(relativeRect, containerRect) {
  if (!relativeRect || !containerRect) {
    return null;
  }

  return {
    bottom: containerRect.top + relativeRect.top + relativeRect.height,
    height: relativeRect.height,
    left: containerRect.left + relativeRect.left,
    right: containerRect.left + relativeRect.left + relativeRect.width,
    top: containerRect.top + relativeRect.top,
    width: relativeRect.width,
  };
}

function pointIsInRect(clientX, clientY, rect) {
  return rect
    && clientX >= rect.left
    && clientX <= rect.right
    && clientY >= rect.top
    && clientY <= rect.bottom;
}

function getPlainDomRect(rect) {
  if (!rect) {
    return null;
  }

  return {
    height: Number(rect.height || 0),
    left: Number(rect.left || 0),
    top: Number(rect.top || 0),
    width: Number(rect.width || 0),
  };
}

function getTodoDropTargetFromPoint({
  clientX,
  clientY,
  containerRect,
  fullscreenTerminalIndex,
  rects,
  terminalIndexes,
}) {
  if (
    Number.isInteger(fullscreenTerminalIndex)
    && pointIsInRect(clientX, clientY, containerRect)
  ) {
    return fullscreenTerminalIndex;
  }

  for (const terminalIndex of terminalIndexes || []) {
    const rect = getAbsoluteRect(rects?.[terminalIndex], containerRect);
    if (pointIsInRect(clientX, clientY, rect)) {
      return terminalIndex;
    }
  }

  return null;
}

function getRowsWithMetrics(rows, rects, containerRect, draggedTerminalIndex) {
  return cloneTerminalRows(rows)
    .map((row, rowIndex) => {
      const rowRects = row.terminalIndexes
        .filter((terminalIndex) => terminalIndex !== draggedTerminalIndex)
        .map((terminalIndex) => ({
          rect: getAbsoluteRect(rects[terminalIndex], containerRect),
          terminalIndex,
        }))
        .filter((entry) => entry.rect);

      if (!rowRects.length) {
        return null;
      }

      return {
        bottom: Math.max(...rowRects.map((entry) => entry.rect.bottom)),
        left: Math.min(...rowRects.map((entry) => entry.rect.left)),
        rects: rowRects,
        right: Math.max(...rowRects.map((entry) => entry.rect.right)),
        rowIndex,
        top: Math.min(...rowRects.map((entry) => entry.rect.top)),
      };
    })
    .filter(Boolean);
}

function getDragTargetFromPoint({
  clientX,
  clientY,
  containerRect,
  draggedTerminalIndex,
  rects,
  rows,
}) {
  const normalizedRows = cloneTerminalRows(rows);
  const rowMetrics = getRowsWithMetrics(normalizedRows, rects, containerRect, draggedTerminalIndex);

  for (const row of normalizedRows) {
    for (const terminalIndex of row.terminalIndexes) {
      if (terminalIndex === draggedTerminalIndex) {
        continue;
      }

      const rect = getAbsoluteRect(rects[terminalIndex], containerRect);
      if (!pointIsInRect(clientX, clientY, rect)) {
        continue;
      }

      const position = findTerminalRowPosition(normalizedRows, terminalIndex);
      if (!position) {
        continue;
      }

      return {
        columnIndex: position.columnIndex + (clientX >= rect.left + rect.width / 2 ? 1 : 0),
        rowIndex: position.rowIndex,
      };
    }
  }

  if (!rowMetrics.length) {
    return { columnIndex: 0, rowIndex: 0 };
  }

  const firstRow = rowMetrics[0];
  const lastRow = rowMetrics[rowMetrics.length - 1];

  if (clientY < firstRow.top) {
    return { columnIndex: 0, rowIndex: 0 };
  }

  if (clientY > lastRow.bottom) {
    return { columnIndex: 0, rowIndex: normalizedRows.length };
  }

  const nearestRow = rowMetrics.reduce((bestRow, row) => {
    if (clientY >= row.top && clientY <= row.bottom) {
      return row;
    }

    const rowCenter = row.top + (row.bottom - row.top) / 2;
    const bestCenter = bestRow.top + (bestRow.bottom - bestRow.top) / 2;
    return Math.abs(clientY - rowCenter) < Math.abs(clientY - bestCenter) ? row : bestRow;
  }, rowMetrics[0]);

  const sortedRects = nearestRow.rects
    .slice()
    .sort((left, right) => left.rect.left - right.rect.left);
  const beforeIndex = sortedRects.findIndex((entry) => clientX < entry.rect.left + entry.rect.width / 2);
  const targetTerminalIndex = beforeIndex >= 0
    ? sortedRects[beforeIndex].terminalIndex
    : sortedRects[sortedRects.length - 1].terminalIndex;
  const position = findTerminalRowPosition(normalizedRows, targetTerminalIndex);

  if (!position) {
    return {
      columnIndex: normalizedRows[nearestRow.rowIndex]?.terminalIndexes.length || 0,
      rowIndex: nearestRow.rowIndex,
    };
  }

  return {
    columnIndex: beforeIndex >= 0 ? position.columnIndex : position.columnIndex + 1,
    rowIndex: position.rowIndex,
  };
}

function areRectMapsEqual(left, right) {
  const leftKeys = Object.keys(left || {});
  const rightKeys = Object.keys(right || {});

  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => {
      const leftRect = left[key];
      const rightRect = right[key];
      return rightRect
        && Math.abs(leftRect.left - rightRect.left) < 0.5
        && Math.abs(leftRect.top - rightRect.top) < 0.5
        && Math.abs(leftRect.width - rightRect.width) < 0.5
        && Math.abs(leftRect.height - rightRect.height) < 0.5;
    });
}

function areRectsEqual(leftRect, rightRect) {
  if (!leftRect || !rightRect) {
    return leftRect === rightRect;
  }

  return Math.abs(leftRect.left - rightRect.left) < 0.5
    && Math.abs(leftRect.top - rightRect.top) < 0.5
    && Math.abs(leftRect.width - rightRect.width) < 0.5
    && Math.abs(leftRect.height - rightRect.height) < 0.5;
}

function getTerminalBreakoutStorageKey(workspaceId) {
  const safeWorkspaceId = String(workspaceId || "default")
    .replace(/[^\w.-]/g, "_")
    .slice(0, 120) || "default";

  return `${TERMINAL_BREAKOUT_STORAGE_PREFIX}.${safeWorkspaceId}`;
}

function clampBreakoutZoom(value) {
  const zoom = Number(value);

  if (!Number.isFinite(zoom)) {
    return TERMINAL_BREAKOUT_DEFAULT_ZOOM;
  }

  return Math.max(TERMINAL_BREAKOUT_MIN_ZOOM, Math.min(TERMINAL_BREAKOUT_MAX_ZOOM, zoom));
}

function normalizeBreakoutViewport(value) {
  const x = Number(value?.x || 0);
  const y = Number(value?.y || 0);
  const zoom = clampBreakoutZoom(value?.zoom);

  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    zoom,
  };
}

function isTerminalBreakoutHoldDragExcludedTarget(target) {
  return Boolean(target?.closest?.(
    "[data-terminal-control='true'], [data-terminal-drag-handle='true'], button, input, textarea, select, a, [contenteditable='true']",
  ));
}

function normalizeBreakoutPlacement(value) {
  const x = Number(value?.x);
  const y = Number(value?.y);
  const width = Number(value?.width);
  const height = Number(value?.height);
  const z = Number.parseInt(value?.z, 10);

  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || width <= 0
    || height <= 0
  ) {
    return null;
  }

  return {
    height,
    width,
    x,
    y,
    z: Number.isInteger(z) ? z : 1,
  };
}

function normalizeBreakoutPlacements(value, terminalIndexes = []) {
  const terminalIndexSet = new Set((terminalIndexes || [])
    .filter((terminalIndex) => Number.isInteger(terminalIndex)));
  const source = value && typeof value === "object" ? value : {};
  const placements = {};

  Object.keys(source).forEach((key) => {
    const terminalIndex = Number.parseInt(key, 10);
    if (!Number.isInteger(terminalIndex) || (terminalIndexSet.size && !terminalIndexSet.has(terminalIndex))) {
      return;
    }

    const placement = normalizeBreakoutPlacement(source[key]);
    if (placement) {
      placements[terminalIndex] = placement;
    }
  });

  return placements;
}

function readTerminalBreakoutLayout(storageKey, terminalIndexes = []) {
  if (!canUseTodoQueueStorage()) {
    return {
      placements: {},
      viewport: TERMINAL_BREAKOUT_DEFAULT_VIEWPORT,
    };
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "{}");
    return {
      placements: normalizeBreakoutPlacements(parsed?.placements, terminalIndexes),
      viewport: normalizeBreakoutViewport(parsed?.viewport),
    };
  } catch {
    return {
      placements: {},
      viewport: TERMINAL_BREAKOUT_DEFAULT_VIEWPORT,
    };
  }
}

function writeTerminalBreakoutLayout(storageKey, layout) {
  if (!canUseTodoQueueStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify({
      placements: normalizeBreakoutPlacements(layout?.placements),
      viewport: normalizeBreakoutViewport(layout?.viewport),
    }));
  } catch {
    // Breakout layout is a visual preference; storage failures should not block terminals.
  }
}

function getBreakoutBaseTerminalSize(panelRect, rects = {}) {
  const measuredRects = Object.values(rects || {}).filter((rect) => rect?.width && rect?.height);
  const measuredWidth = measuredRects.length
    ? Math.max(...measuredRects.map((rect) => Number(rect.width || 0)))
    : 0;
  const measuredHeight = measuredRects.length
    ? Math.max(...measuredRects.map((rect) => Number(rect.height || 0)))
    : 0;
  const panelWidth = Number(panelRect?.width || 0);
  const panelHeight = Number(panelRect?.height || 0);

  return {
    height: Math.max(
      TERMINAL_BREAKOUT_MIN_HEIGHT,
      Math.min(TERMINAL_BREAKOUT_MAX_HEIGHT, measuredHeight || panelHeight * 0.52 || 360),
    ),
    width: Math.max(
      TERMINAL_BREAKOUT_MIN_WIDTH,
      Math.min(TERMINAL_BREAKOUT_MAX_WIDTH, measuredWidth || panelWidth * 0.56 || 620),
    ),
  };
}

function buildSpreadBreakoutPlacements({
  existingPlacements = {},
  panelRect,
  preserveExisting = true,
  rects = {},
  terminalIndexes = [],
} = {}) {
  const baseSize = getBreakoutBaseTerminalSize(panelRect, rects);
  const columns = Math.max(1, Math.min(3, Math.ceil(Math.sqrt(Math.max(1, terminalIndexes.length)))));
  const columnGap = 92;
  const rowGap = 112;
  const nextPlacements = {};
  let maxZ = 0;

  (terminalIndexes || []).forEach((terminalIndex, orderIndex) => {
    const existingPlacement = preserveExisting
      ? normalizeBreakoutPlacement(existingPlacements?.[terminalIndex])
      : null;

    if (existingPlacement) {
      nextPlacements[terminalIndex] = existingPlacement;
      maxZ = Math.max(maxZ, existingPlacement.z || 0);
      return;
    }

    const columnIndex = orderIndex % columns;
    const rowIndex = Math.floor(orderIndex / columns);
    const measuredRect = rects?.[terminalIndex] || {};
    const width = Math.max(
      TERMINAL_BREAKOUT_MIN_WIDTH,
      Math.min(TERMINAL_BREAKOUT_MAX_WIDTH, Number(measuredRect.width || 0) || baseSize.width),
    );
    const height = Math.max(
      TERMINAL_BREAKOUT_MIN_HEIGHT,
      Math.min(TERMINAL_BREAKOUT_MAX_HEIGHT, Number(measuredRect.height || 0) || baseSize.height),
    );
    nextPlacements[terminalIndex] = {
      height,
      width,
      x: 76 + (columnIndex * (baseSize.width + columnGap)) + (rowIndex % 2 ? 44 : 0),
      y: 88 + (rowIndex * (baseSize.height + rowGap)),
      z: orderIndex + 1,
    };
    maxZ = Math.max(maxZ, orderIndex + 1);
  });

  return {
    maxZ,
    placements: nextPlacements,
  };
}

function getBreakoutScreenRect(placement, viewport) {
  const normalizedPlacement = normalizeBreakoutPlacement(placement);
  const normalizedViewport = normalizeBreakoutViewport(viewport);

  if (!normalizedPlacement) {
    return null;
  }

  return {
    height: normalizedPlacement.height * normalizedViewport.zoom,
    left: (normalizedPlacement.x * normalizedViewport.zoom) + normalizedViewport.x,
    top: (normalizedPlacement.y * normalizedViewport.zoom) + normalizedViewport.y,
    width: normalizedPlacement.width * normalizedViewport.zoom,
  };
}

function getDisplayRowsFromBreakoutPlacements(terminalIndexes, placements) {
  const orderedIndexes = (terminalIndexes || [])
    .slice()
    .sort((leftIndex, rightIndex) => {
      const leftPlacement = normalizeBreakoutPlacement(placements?.[leftIndex]);
      const rightPlacement = normalizeBreakoutPlacement(placements?.[rightIndex]);

      if (!leftPlacement && !rightPlacement) {
        return leftIndex - rightIndex;
      }
      if (!leftPlacement) {
        return 1;
      }
      if (!rightPlacement) {
        return -1;
      }

      const yDelta = leftPlacement.y - rightPlacement.y;
      if (Math.abs(yDelta) > 48) {
        return yDelta;
      }

      return (leftPlacement.x - rightPlacement.x) || (leftIndex - rightIndex);
    });

  return orderedIndexes.map((terminalIndex, rowIndex) => ({
    rowIndex,
    terminalIndexes: [terminalIndex],
  }));
}

function canUseTodoQueueStorage() {
  try {
    return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
  } catch {
    return false;
  }
}

function getTodoQueueStorageKey(workspaceId) {
  const safeWorkspaceId = String(workspaceId || "default")
    .replace(/[^\w.-]/g, "_")
    .slice(0, 120) || "default";

  return `${TODO_QUEUE_STORAGE_PREFIX}.${safeWorkspaceId}`;
}

function getTodoQueueRemoteCommandReceiptStorageKey(workspaceId) {
  const safeWorkspaceId = String(workspaceId || "default")
    .replace(/[^\w.-]/g, "_")
    .slice(0, 120) || "default";

  return `${TODO_QUEUE_REMOTE_COMMAND_RECEIPTS_PREFIX}.${safeWorkspaceId}`;
}

function getOrchestratorVoiceHistoryWorkspaceId(workspaceId) {
  return String(workspaceId || "default").trim() || "default";
}

function normalizeTodoQueueText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, TODO_QUEUE_MAX_TEXT_LENGTH);
}

function normalizeTodoQueueMultilineText(value, maxLength = TODO_QUEUE_MAX_NOTE_TEXT_LENGTH) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function getTodoQueueLineCount(value) {
  const text = normalizeTodoQueueMultilineText(value);
  return text ? text.split("\n").length : 0;
}

function getTodoQueuePastedLinesLabel(lineCount) {
  return `[pasted-lines ${Math.max(1, Number(lineCount || 0))}]`;
}

function getTodoQueueNoteTitle(value) {
  const normalizedTitle = String(value || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalizedTitle) {
    return "Pasted note";
  }

  return normalizedTitle.length > TODO_QUEUE_NOTE_TITLE_LENGTH
    ? `${normalizedTitle.slice(0, TODO_QUEUE_NOTE_TITLE_LENGTH - 3)}...`
    : normalizedTitle;
}

function normalizeTodoQueueNote(value) {
  const note = typeof value === "string"
    ? { text: value }
    : value && typeof value === "object"
      ? value
      : null;
  const text = normalizeTodoQueueMultilineText(note?.text || note?.content);

  if (!text) {
    return null;
  }

  const lineCount = getTodoQueueLineCount(text);

  return {
    lineCount,
    text,
    title: getTodoQueuePastedLinesLabel(lineCount),
    preview: getTodoQueueNoteTitle(note?.preview || note?.title || text),
  };
}

function normalizeTodoQueueKind(value) {
  const kind = String(value || "").trim().toLowerCase();
  return kind === TODO_QUEUE_KIND_SPEC_EDIT ? TODO_QUEUE_KIND_SPEC_EDIT : "todo";
}

function normalizeTodoQueueSource(value) {
  return String(value || "").trim().slice(0, 80);
}

function normalizeTodoQueueSpecEdit(value) {
  const specEdit = value && typeof value === "object" ? value : null;
  if (!specEdit) {
    return null;
  }

  const intentPayload = specEdit.intentPayload && typeof specEdit.intentPayload === "object" && !Array.isArray(specEdit.intentPayload)
    ? { ...specEdit.intentPayload }
    : null;
  const intentId = String(
    specEdit.intentId
      || specEdit.intent_id
      || intentPayload?.intent_id
      || "",
  ).trim();
  const promptText = normalizeTodoQueueMultilineText(
    specEdit.promptText
      || specEdit.prompt
      || specEdit.terminalText
      || "",
  );

  if (!intentId && !promptText) {
    return null;
  }

  return {
    ...(intentPayload ? { intentPayload } : {}),
    baseGraphHash: String(specEdit.baseGraphHash || specEdit.base_graph_hash || intentPayload?.base_graph_hash || "").trim(),
    baseNodeHash: String(specEdit.baseNodeHash || specEdit.base_node_hash || intentPayload?.base_node_hash || "").trim(),
    containerTargetNodeId: String(
      specEdit.containerTargetNodeId
        || specEdit.container_target_node_id
        || intentPayload?.container_target_node_id
        || "",
    ).trim(),
    intentId,
    mountId: String(specEdit.mountId || specEdit.mount_id || intentPayload?.mount_id || "").trim(),
    operation: String(specEdit.operation || intentPayload?.operation || "edit").trim().slice(0, 40),
    promptText,
    repoPath: String(specEdit.repoPath || specEdit.repo_path || "").trim().slice(0, 4096),
    sourceRepoId: String(specEdit.sourceRepoId || specEdit.source_repo_id || intentPayload?.source_repo_id || "").trim(),
    targetNodeId: String(specEdit.targetNodeId || specEdit.target_node_id || intentPayload?.target_node_id || "").trim(),
    targetNodeSignature: String(specEdit.targetNodeSignature || specEdit.target_node_signature || "").trim(),
    targetPath: String(specEdit.targetPath || specEdit.target_path || intentPayload?.target_path || "").trim(),
    targetProjectRelativePath: String(
      specEdit.targetProjectRelativePath
        || specEdit.target_project_relative_path
        || intentPayload?.target_project_relative_path
        || "",
    ).trim(),
    targetProjectRoot: String(
      specEdit.targetProjectRoot
        || specEdit.target_project_root
        || intentPayload?.target_project_root
        || "",
    ).trim().slice(0, 4096),
    targetSpecObjectId: String(
      specEdit.targetSpecObjectId
        || specEdit.target_spec_object_id
        || intentPayload?.target_spec_object_id
        || "",
    ).trim(),
    targetTitle: String(specEdit.targetTitle || specEdit.target_title || intentPayload?.target_title || "").trim(),
    targetVisiblePath: String(specEdit.targetVisiblePath || specEdit.target_visible_path || intentPayload?.target_visible_path || "").trim(),
    targetWorkspaceRoot: String(
      specEdit.targetWorkspaceRoot
        || specEdit.target_workspace_root
        || intentPayload?.target_workspace_root
        || "",
    ).trim().slice(0, 4096),
    workspaceId: String(specEdit.workspaceId || specEdit.workspace_id || "").trim(),
    workspaceName: String(specEdit.workspaceName || specEdit.workspace_name || "").trim(),
  };
}

function normalizeTerminalCoordinationPath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "")
    .toLowerCase();
}

function terminalCoordinationPathsEqual(left, right) {
  const leftPath = normalizeTerminalCoordinationPath(left);
  const rightPath = normalizeTerminalCoordinationPath(right);
  return Boolean(leftPath && rightPath && leftPath === rightPath);
}

function normalizeTerminalCoordinationTarget(value) {
  const target = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!target) {
    return null;
  }
  const repoPath = String(target.repoPath || target.repo_path || "").trim();
  if (!repoPath) {
    return null;
  }
  return {
    repoPath,
    mountId: String(target.mountId || target.mount_id || "").trim(),
    projectName: String(target.projectName || target.project_name || "").trim(),
    projectKind: String(target.projectKind || target.project_kind || "").trim(),
    workspaceRelativePath: String(
      target.workspaceRelativePath || target.workspace_relative_path || "",
    ).trim(),
    isWorkspaceRoot: Boolean(target.isWorkspaceRoot || target.is_workspace_root),
  };
}

function normalizeTerminalCoordinationTargets(value) {
  return (Array.isArray(value) ? value : [])
    .map(normalizeTerminalCoordinationTarget)
    .filter(Boolean);
}

function terminalCoordinationTargetForIndex(targets, terminalIndexes, terminalIndex, fallbackRoot = "") {
  const normalizedTargets = normalizeTerminalCoordinationTargets(targets);
  if (!normalizedTargets.length) {
    return fallbackRoot
      ? { repoPath: fallbackRoot, mountId: "", projectName: "", projectKind: "workspace_root", workspaceRelativePath: "", isWorkspaceRoot: true }
      : null;
  }

  if (normalizedTargets.length === 1) {
    return normalizedTargets[0];
  }

  const position = (Array.isArray(terminalIndexes) ? terminalIndexes : []).indexOf(terminalIndex);
  const targetIndex = position >= 0 ? position % normalizedTargets.length : 0;
  return normalizedTargets[targetIndex];
}

function specEditTargetRepoPath(specEdit) {
  return String(specEdit?.repoPath || specEdit?.targetProjectRoot || "").trim();
}

function normalizeVoiceAgentQueueArguments(value) {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  return value && typeof value === "object" ? value : {};
}

function normalizeVoiceAgentManagementAgent(value) {
  const agentType = String(value || "").trim();
  if (["any", "codex", "claude", "opencode"].includes(agentType)) return agentType;
  return "";
}

function normalizeVoiceAgentOpenCodingAgentsAction(value) {
  const action = String(value || "").trim();
  if (action === "ensure_count" || action === "spawn_count") return action;
  return "";
}

function getVoiceAgentOpenCodingAgentsRequestSummary(args = {}) {
  const action = normalizeVoiceAgentOpenCodingAgentsAction(args.action);
  const agentId = normalizeVoiceAgentManagementAgent(args.agent_type);
  const count = Math.max(1, Math.min(12, Number.parseInt(args.count, 10) || 1));
  const agentLabel = agentId && agentId !== "any" ? agentId : "agent";

  if (action === "ensure_count") {
    return `Open ${count} total ${agentLabel} terminal${count === 1 ? "" : "s"}.`;
  }
  return `Open ${count} more ${agentLabel} terminal${count === 1 ? "" : "s"}.`;
}

function getVoiceAgentToolCallSignature(toolCall) {
  const callId = String(toolCall?.call_id || toolCall?.callId || "").trim();
  const toolName = String(toolCall?.name || toolCall?.tool_name || toolCall?.toolName || "").trim();
  const fallbackSignature = JSON.stringify(toolCall?.arguments || toolCall?.args || {});
  return callId || `${toolName}:${fallbackSignature}`;
}

function getVoiceAgentEventKind(event) {
  return cloudVoiceAgentEventKind(event);
}

function getVoiceAgentEventMarker(event) {
  return String(
    event?.response_kind
      || event?.responseKind
      || event?.phase
      || event?.status
      || event?.scope
      || "",
  ).trim().toLowerCase();
}

function isVoiceAgentTtsEventKind(kind) {
  return kind === "voice_agent_tts_start"
    || kind === "voice_agent_tts_audio"
    || kind === "voice_agent_tts_end";
}

function isVoiceAgentFastResponseEvent(event) {
  const kind = getVoiceAgentEventKind(event);
  const marker = getVoiceAgentEventMarker(event);
  return Boolean(
    event?.fast_response
      || event?.fastResponse
      || event?.is_fast_response
      || event?.isFastResponse
      || event?.fast_llm_response
      || event?.fastLlmResponse,
  )
    || kind === "voice_agent_fast_llm_feedback"
    || kind === "voice_agent_initial_llm_feedback"
    || marker === "fast_response"
    || marker === "fast_llm_response"
    || marker === "initial_fast_response";
}

function normalizeFastVoiceAgentFeedbackEvent(event) {
  return {
    ...(event || {}),
    final: false,
    kind: "voice_agent_llm_feedback",
    status: String(event?.status || "fast_response").trim() || "fast_response",
  };
}

function cleanPublicVoiceAgentText(value) {
  let text = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  for (let index = 0; index < 3; index += 1) {
    const nextText = text
      .replace(/^(?:in\s+)?(?:(?:repo_id|workspace_id)=[^\s,]+(?:\s+(?:repo_id|workspace_id)=[^\s,]+)*),?\s*/i, "")
      .trim();
    if (!nextText || nextText === text) {
      break;
    }
    text = nextText;
  }

  return text;
}

function createTodoQueueItemFromVoiceAgentToolCall(toolCall) {
  const args = normalizeVoiceAgentQueueArguments(toolCall?.arguments || toolCall?.args);
  const text = normalizeTodoQueueText(
    cleanPublicVoiceAgentText(
      args.text
        || args.todo
        || args.task
        || toolCall?.text
        || "",
    ),
  );

  if (!text) {
    return null;
  }

  const planTask = normalizeTodoQueuePlanTask({
    doneWhen: args.plan_done_when || args.planDoneWhen,
    maxConcurrency: args.plan_max_concurrency ?? args.planMaxConcurrency,
    releasePolicy: args.plan_release_policy || args.planReleasePolicy,
    requiresQueueDrain: args.plan_requires_queue_drain ?? args.planRequiresQueueDrain,
    runId: args.plan_run_id || args.planRunId,
    taskId: args.plan_task_id || args.planTaskId,
    stage: args.plan_stage || args.planStage,
    stepOrdinal: args.plan_step_ordinal ?? args.planStepOrdinal,
    title: args.plan_task_title || args.planTaskTitle || args.title,
  });

  return createTodoQueueItem(text, {
    ...(planTask ? {
      id: planTask.taskId,
      planTask,
      source: TODO_QUEUE_SOURCE_VOICE_PLAN,
    } : {
      source: TODO_QUEUE_SOURCE_VOICE_AGENT,
    }),
  });
}

function normalizeVoiceHistoryText(value, maxLength = TODO_QUEUE_MAX_TEXT_LENGTH) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function formatVoiceHistoryMessageTime(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

async function copyTextToClipboard(text) {
  const safeText = String(text || "");
  if (!safeText || typeof window === "undefined") {
    return false;
  }

  if (window.navigator?.clipboard?.writeText) {
    await window.navigator.clipboard.writeText(safeText);
    return true;
  }

  const textarea = window.document.createElement("textarea");
  textarea.value = safeText;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  window.document.body.appendChild(textarea);
  textarea.select();

  try {
    return window.document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function getVoiceHistoryTurnIndex(event) {
  const value = event?.turn_index ?? event?.turnIndex;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function getVoiceHistoryTurnKey(event, sessionId) {
  return `${Number(sessionId || 0)}:${getVoiceHistoryTurnIndex(event)}`;
}

function getVoiceHistoryTurnStatus(item) {
  const llmStatus = String(item?.llmStatus || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (llmStatus === "cancelled" || llmStatus === "canceled") {
    return "Cancelled";
  }
  if (llmStatus === "failed" || llmStatus === "error") {
    return "Failed";
  }
  if (llmStatus === "timed_out" || llmStatus === "timeout") {
    return "Timed out";
  }
  if (item?.plan) {
    return getVoicePlanStatusLabel(item.plan);
  }
  if (llmStatus === "planned") {
    return "Planned";
  }
  if (llmStatus === "ready") {
    return "Done";
  }
  if (!item?.transcriptFinal) {
    return "Pending";
  }
  if (item?.llmFinal || item?.queued) {
    return "Done";
  }
  if (item?.llmFeedback) {
    return "Thinking";
  }
  return "Thinking";
}

function getVoiceHistoryTurnLabel(item) {
  const turnIndex = Number(item?.turnIndex || 0);
  if (item?.plan?.title && !item.transcript) {
    return "Voice plan";
  }
  if (item?.source === "chat") {
    return `Chat turn ${turnIndex + 1}`;
  }
  return `Voice turn ${turnIndex + 1}`;
}

function normalizeOrchestratorVoiceHistoryItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const id = String(item.id || "").trim();
  const transcript = normalizeVoiceHistoryText(item.transcript);
  const llmFeedback = normalizeVoiceHistoryText(item.llmFeedback, 1600);
  const llmError = normalizeVoiceHistoryText(item.llmError, 1600);
  const queuedText = normalizeVoiceHistoryText(item.queuedText, 600);
  const plan = normalizeVoicePlanSnapshot(item.plan);
  if (!id || (!transcript && !llmFeedback && !llmError && !queuedText && !plan)) {
    return null;
  }

  const createdAtMs = Number(item.createdAtMs || item.updatedAtMs || Date.now());
  const updatedAtMs = Number(item.updatedAtMs || createdAtMs || Date.now());
  const turnIndex = Number(item.turnIndex);

  return {
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : Date.now(),
    id,
    llmFeedback,
    llmError,
    llmFinal: Boolean(item.llmFinal),
    llmStatus: String(item.llmStatus || "").trim().slice(0, 48),
    ...(plan ? { plan } : {}),
    queued: Boolean(item.queued),
    queuedText,
    source: String(item.source || "").trim().slice(0, 32),
    transcript,
    transcriptFinal: Boolean(item.transcriptFinal),
    turnIndex: Number.isFinite(turnIndex) ? turnIndex : 0,
    updatedAtMs: Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now(),
  };
}

function normalizeVoicePlanSnapshot(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const runId = String(value.runId || value.id || "").trim();
  if (!runId) {
    return null;
  }
  const steps = (Array.isArray(value.steps) ? value.steps : []).map((step, index) => {
    const ordinal = Number.isFinite(Number(step?.ordinal)) ? Number(step.ordinal) : index;
    return {
      executionStatus: String(step?.executionStatus || step?.execution_status || "").trim(),
      executionPolicy: String(step?.executionPolicy || step?.execution_policy || "").trim(),
      executionRequiresQueueDrain: Boolean(step?.executionRequiresQueueDrain || step?.execution_requires_queue_drain),
      executionDoneWhen: String(step?.executionDoneWhen || step?.execution_done_when || "").trim(),
      executionTasks: normalizeVoicePlanTasks(
        step?.executionTasks || step?.execution_tasks,
        { runId, stage: "execution", stepOrdinal: ordinal },
      ),
      objective: normalizeVoiceHistoryText(step?.objective, 600),
      ordinal,
      revisionStatus: String(step?.revisionStatus || step?.revision_status || "").trim(),
      revisionPolicy: String(step?.revisionPolicy || step?.revision_policy || "").trim(),
      revisionRequiresQueueDrain: Boolean(step?.revisionRequiresQueueDrain || step?.revision_requires_queue_drain),
      revisionDoneWhen: String(step?.revisionDoneWhen || step?.revision_done_when || "").trim(),
      revisionTasks: normalizeVoicePlanTasks(
        step?.revisionTasks || step?.revision_tasks,
        { runId, stage: "revision", stepOrdinal: ordinal },
      ),
      status: String(step?.status || "").trim(),
      title: normalizeVoiceHistoryText(step?.title, 160) || `Step ${index + 1}`,
    };
  });
  return {
    currentStage: String(value.currentStage || value.current_stage || "").trim(),
    currentStepOrdinal: Number.isFinite(Number(value.currentStepOrdinal ?? value.current_step_ordinal))
      ? Number(value.currentStepOrdinal ?? value.current_step_ordinal)
      : 0,
    goal: normalizeVoiceHistoryText(value.goal, 1200),
    runId,
    status: String(value.status || "").trim(),
    steps,
    title: normalizeVoiceHistoryText(value.title, 200) || "Voice plan",
    updatedAt: String(value.updatedAt || value.updated_at || "").trim(),
  };
}

function normalizeVoicePlanTasks(value, context = {}) {
  return (Array.isArray(value) ? value : []).map((task, index) => ({
    agentId: String(task?.agentId || task?.agent_id || "").trim(),
    id: String(task?.taskId || task?.id || "").trim(),
    ordinal: Number.isFinite(Number(task?.ordinal)) ? Number(task.ordinal) : index,
    promptEventId: String(task?.promptEventId || task?.prompt_event_id || "").trim(),
    releasePolicy: String(task?.releasePolicy || task?.release_policy || "").trim(),
    requiresQueueDrain: Boolean(task?.requiresQueueDrain || task?.requires_queue_drain),
    doneWhen: String(task?.doneWhen || task?.done_when || "").trim(),
    maxConcurrency: Number.isFinite(Number(task?.maxConcurrency ?? task?.max_concurrency))
      ? Number(task?.maxConcurrency ?? task?.max_concurrency)
      : 0,
    runId: String(task?.runId || task?.run_id || context.runId || "").trim(),
    stage: String(task?.stage || context.stage || "").trim(),
    status: String(task?.status || "").trim(),
    stepOrdinal: Number.isFinite(Number(task?.stepOrdinal ?? task?.step_ordinal ?? context.stepOrdinal))
      ? Number(task?.stepOrdinal ?? task?.step_ordinal ?? context.stepOrdinal)
      : 0,
    terminalIndex: Number.isFinite(Number(task?.terminalIndex ?? task?.terminal_index))
      ? Number(task?.terminalIndex ?? task?.terminal_index)
      : null,
    text: normalizeVoiceHistoryText(task?.text, 420),
    title: normalizeVoiceHistoryText(task?.title, 120),
  })).filter((task) => task.id || task.text);
}

function getVoicePlanStatusLabel(plan) {
  const status = String(plan?.status || "").trim().replace(/_/g, " ");
  if (status === "completed") {
    return "Complete";
  }
  if (status === "planned") {
    return "Planned";
  }
  if (status === "failed") {
    return "Failed";
  }
  if (status === "cancelled" || status === "canceled") {
    return "Cancelled";
  }
  const currentStep = Number(plan?.currentStepOrdinal || 0) + 1;
  const currentStage = String(plan?.currentStage || "").trim();
  if (currentStage) {
    return `Step ${currentStep} ${currentStage}`;
  }
  return status || "Plan";
}

function getVoicePlanTaskStatusLabel(task) {
  const status = String(task?.status || "").trim().replace(/_/g, " ");
  if (!status || status === "draft") {
    return "waiting";
  }
  if (status === "sent to client") {
    return "queued";
  }
  return status;
}

function getVoicePlanStageLabel(stageLabel, policy, doneWhen = "") {
  const normalizedPolicy = String(policy || "").trim().replace(/_/g, " ");
  const normalizedDoneWhen = String(doneWhen || "").trim().replace(/_/g, " ");
  if (!normalizedPolicy || normalizedPolicy === "parallel") {
    return stageLabel;
  }
  if (normalizedDoneWhen && normalizedDoneWhen !== "stage tasks completed") {
    return `${stageLabel} · ${normalizedPolicy} · ${normalizedDoneWhen}`;
  }
  return `${stageLabel} · ${normalizedPolicy}`;
}

function normalizeVoicePlanReleasedTask(value, snapshot = null) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const runId = String(
    value.runId
      || value.run_id
      || value.planRunId
      || value.plan_run_id
      || snapshot?.runId
      || "",
  ).trim();
  const taskId = String(value.taskId || value.task_id || value.id || "").trim();
  const text = normalizeTodoQueueText(cleanPublicVoiceAgentText(value.text || value.todo || value.task || ""));
  if (!runId || !taskId || !text) {
    return null;
  }
  return {
    doneWhen: String(value.doneWhen || value.done_when || value.planDoneWhen || value.plan_done_when || "").trim(),
    maxConcurrency: Number.isFinite(Number(value.maxConcurrency ?? value.max_concurrency ?? value.planMaxConcurrency ?? value.plan_max_concurrency))
      ? Number(value.maxConcurrency ?? value.max_concurrency ?? value.planMaxConcurrency ?? value.plan_max_concurrency)
      : 0,
    releasePolicy: String(value.releasePolicy || value.release_policy || value.planReleasePolicy || value.plan_release_policy || "").trim(),
    requiresQueueDrain: Boolean(value.requiresQueueDrain || value.requires_queue_drain || value.planRequiresQueueDrain || value.plan_requires_queue_drain),
    runId,
    stage: String(value.stage || value.planStage || value.plan_stage || snapshot?.currentStage || "").trim(),
    stepOrdinal: Number.isFinite(Number(value.stepOrdinal ?? value.step_ordinal ?? snapshot?.currentStepOrdinal))
      ? Number(value.stepOrdinal ?? value.step_ordinal ?? snapshot?.currentStepOrdinal)
      : 0,
    taskId,
    title: normalizeVoiceHistoryText(value.title, 120),
    text,
  };
}

function unwrapCloudVoicePlanResult(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  if (value.plan_snapshot || value.planSnapshot || value.snapshot || value.released_tasks || value.releasedTasks) {
    return value;
  }
  const data = value.data && typeof value.data === "object" ? value.data : null;
  if (data?.plan_snapshot || data?.planSnapshot || data?.snapshot || data?.released_tasks || data?.releasedTasks) {
    return data;
  }
  const nested = data?.data && typeof data.data === "object" ? data.data : null;
  if (nested?.plan_snapshot || nested?.planSnapshot || nested?.snapshot || nested?.released_tasks || nested?.releasedTasks) {
    return nested;
  }
  return data || null;
}

function getVoicePlanSnapshotFromPayload(value) {
  const payload = unwrapCloudVoicePlanResult(value);
  return normalizeVoicePlanSnapshot(
    payload?.plan_snapshot
      || payload?.planSnapshot
      || payload?.snapshot
      || value?.snapshot
      || value,
  );
}

function getVoicePlanReleasedTasksFromPayload(value, snapshot = null) {
  const payload = unwrapCloudVoicePlanResult(value);
  const rawTasks = payload?.released_tasks || payload?.releasedTasks || [];
  const releasedTasks = (Array.isArray(rawTasks) ? rawTasks : [])
    .map((task) => normalizeVoicePlanReleasedTask(task, snapshot))
    .filter(Boolean);
  if (releasedTasks.length) {
    return releasedTasks;
  }
  return getVoicePlanReleasedTasksFromSnapshot(snapshot || getVoicePlanSnapshotFromPayload(value));
}

function getVoicePlanTaskFromPromptEventId(value) {
  const taskId = String(value || "").trim();
  if (!taskId.startsWith("voice-plan-")) {
    return null;
  }
  const match = taskId.match(/^(voice-plan-.+)-s\d+-(execution|revision)-t\d+$/);
  if (!match) {
    return null;
  }
  return normalizeTodoQueuePlanTask({
    runId: match[1],
    stage: match[2],
    taskId,
  });
}

function normalizeOrchestratorVoiceHistoryItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeOrchestratorVoiceHistoryItem)
    .filter(Boolean)
    .sort((left, right) => (
      Number(left.createdAtMs || left.updatedAtMs || 0)
      - Number(right.createdAtMs || right.updatedAtMs || 0)
    ))
    .slice(-ORCHESTRATOR_VOICE_HISTORY_MAX_TURNS);
}

function getTodoQueueItemNote(item) {
  return normalizeTodoQueueNote(item?.note || item?.noteText || item?.longText);
}

function getTodoQueueItemSpecEdit(item) {
  const specEdit = normalizeTodoQueueSpecEdit(item?.specEdit || item?.spec_edit);
  return specEdit?.intentId || specEdit?.promptText ? specEdit : null;
}

function normalizeTodoQueuePlanTask(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const runId = String(value.runId || value.run_id || value.planRunId || value.plan_run_id || "").trim();
  const taskId = String(value.taskId || value.task_id || value.planTaskId || value.plan_task_id || "").trim();
  if (!runId || !taskId) {
    return null;
  }
  return {
    doneWhen: String(value.doneWhen || value.done_when || value.planDoneWhen || value.plan_done_when || "").trim(),
    maxConcurrency: Number.isFinite(Number(value.maxConcurrency ?? value.max_concurrency ?? value.planMaxConcurrency ?? value.plan_max_concurrency))
      ? Number(value.maxConcurrency ?? value.max_concurrency ?? value.planMaxConcurrency ?? value.plan_max_concurrency)
      : 0,
    releasePolicy: String(value.releasePolicy || value.release_policy || value.planReleasePolicy || value.plan_release_policy || "").trim(),
    requiresQueueDrain: Boolean(value.requiresQueueDrain || value.requires_queue_drain || value.planRequiresQueueDrain || value.plan_requires_queue_drain),
    runId,
    title: normalizeVoiceHistoryText(value.title, 120),
    taskId,
    stage: String(value.stage || value.planStage || value.plan_stage || "").trim(),
    stepOrdinal: Number.isFinite(Number(value.stepOrdinal ?? value.step_ordinal))
      ? Number(value.stepOrdinal ?? value.step_ordinal)
      : 0,
  };
}

function getTodoQueueItemPlanTask(item) {
  return normalizeTodoQueuePlanTask(item?.planTask || item?.plan_task);
}

function isVoicePlanBoundaryQueueItem(item) {
  const planTask = getTodoQueueItemPlanTask(item);
  const releasePolicy = String(planTask?.releasePolicy || "").trim();
  return Boolean(
    planTask
      && (
        planTask.requiresQueueDrain
        || releasePolicy === "verification_barrier"
      ),
  );
}

function normalizeVoicePlanStageName(value) {
  return String(value || "").trim();
}

function getVoicePlanStageIndex(value) {
  return VOICE_PLAN_STAGE_ORDER.indexOf(normalizeVoicePlanStageName(value));
}

function normalizeVoicePlanStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isVoicePlanCompletedStatus(value) {
  const normalized = normalizeVoicePlanStatus(value);
  return VOICE_PLAN_COMPLETED_STATUSES.has(normalized)
    || VOICE_PLAN_COMPLETED_STATUSES.has(normalized.replace(/_/g, " "));
}

function getVoicePlanStepByOrdinal(plan, ordinal) {
  const stepOrdinal = Number(ordinal);
  if (!Number.isFinite(stepOrdinal)) {
    return null;
  }
  return (Array.isArray(plan?.steps) ? plan.steps : []).find((step) => (
    Number(step?.ordinal) === stepOrdinal
  )) || null;
}

function getVoicePlanStageStatus(step, stageName) {
  const stage = normalizeVoicePlanStageName(stageName);
  if (stage === "execution") {
    return String(step?.executionStatus || "").trim();
  }
  if (stage === "revision") {
    return String(step?.revisionStatus || "").trim();
  }
  return "";
}

function getVoicePlanStageTasks(step, stageName) {
  const stage = normalizeVoicePlanStageName(stageName);
  if (stage === "execution") {
    return Array.isArray(step?.executionTasks) ? step.executionTasks : [];
  }
  if (stage === "revision") {
    return Array.isArray(step?.revisionTasks) ? step.revisionTasks : [];
  }
  return [];
}

function getVoicePlanSnapshotTask(snapshot, planTask) {
  const normalizedPlanTask = normalizeTodoQueuePlanTask(planTask);
  if (!snapshot?.runId || !normalizedPlanTask) {
    return null;
  }
  const taskStepOrdinal = Number(normalizedPlanTask.stepOrdinal || 0);
  const taskStage = normalizeVoicePlanStageName(
    normalizedPlanTask.stage || snapshot.currentStage || "execution",
  );
  const step = getVoicePlanStepByOrdinal(snapshot, taskStepOrdinal);
  return getVoicePlanStageTasks(step, taskStage).find((task) => (
    String(task?.id || task?.taskId || "").trim() === normalizedPlanTask.taskId
  )) || null;
}

function isVoicePlanStageComplete(step, stageName) {
  if (!step) {
    return false;
  }
  const status = getVoicePlanStageStatus(step, stageName);
  if (isVoicePlanCompletedStatus(status)) {
    return true;
  }
  const tasks = getVoicePlanStageTasks(step, stageName);
  if (!tasks.length) {
    return !status;
  }
  return tasks.every((task) => isVoicePlanCompletedStatus(task?.status));
}

function isVoicePlanStepComplete(step) {
  if (!step) {
    return false;
  }
  if (isVoicePlanCompletedStatus(step?.status)) {
    return true;
  }
  return VOICE_PLAN_STAGE_ORDER.every((stageName) => isVoicePlanStageComplete(step, stageName));
}

function getVoicePlanTaskReleaseDecision(task, snapshot = null) {
  const planTask = normalizeTodoQueuePlanTask(task);
  if (!planTask) {
    return { eligible: false, reason: "invalid_plan_task" };
  }

  const taskStepOrdinal = Number(planTask.stepOrdinal || 0);
  const taskStage = normalizeVoicePlanStageName(planTask.stage || snapshot?.currentStage || "execution");
  const taskStageIndex = getVoicePlanStageIndex(taskStage);
  if (taskStageIndex < 0) {
    return { eligible: false, reason: "invalid_stage" };
  }
  if (isVoicePlanCompletedStatus(snapshot?.status)) {
    return { eligible: false, reason: "plan_complete" };
  }
  if (!snapshot?.runId) {
    return taskStepOrdinal === 0 && taskStageIndex === 0
      ? { eligible: true, reason: "first_slot_without_snapshot" }
      : { eligible: false, reason: "missing_plan_snapshot" };
  }
  if (planTask.runId && snapshot.runId && planTask.runId !== snapshot.runId) {
    return { eligible: false, reason: "plan_snapshot_mismatch" };
  }

  const currentStepOrdinal = Number(snapshot.currentStepOrdinal);
  const currentStage = normalizeVoicePlanStageName(snapshot.currentStage);
  const currentStageIndex = getVoicePlanStageIndex(currentStage);
  if (Number.isFinite(currentStepOrdinal)) {
    if (taskStepOrdinal < currentStepOrdinal) {
      return { eligible: false, reason: "past_step" };
    }
    if (
      taskStepOrdinal === currentStepOrdinal
      && currentStage
      && taskStage
      && taskStageIndex >= 0
      && currentStageIndex >= 0
    ) {
      if (taskStageIndex < currentStageIndex) {
        return { eligible: false, reason: "past_stage" };
      }
      if (taskStageIndex === currentStageIndex) {
        return { eligible: true, reason: "current_stage" };
      }
    }
  }

  const steps = Array.isArray(snapshot.steps) ? snapshot.steps : [];
  for (const step of steps) {
    const stepOrdinal = Number(step?.ordinal);
    if (Number.isFinite(stepOrdinal) && stepOrdinal < taskStepOrdinal && !isVoicePlanStepComplete(step)) {
      return { eligible: false, reason: "previous_step_incomplete" };
    }
  }
  const currentStep = getVoicePlanStepByOrdinal(snapshot, taskStepOrdinal);
  for (const stageName of VOICE_PLAN_STAGE_ORDER) {
    const stageIndex = getVoicePlanStageIndex(stageName);
    if (stageIndex >= taskStageIndex || stageIndex < 0) {
      continue;
    }
    if (!isVoicePlanStageComplete(currentStep, stageName)) {
      return { eligible: false, reason: "previous_stage_incomplete" };
    }
  }

  return { eligible: true, reason: "previous_slots_complete" };
}

function shouldDeferVoicePlanTaskRelease(reason) {
  return [
    "future_stage",
    "future_step",
    "missing_plan_snapshot",
    "previous_stage_incomplete",
    "previous_step_incomplete",
  ].includes(String(reason || ""));
}

function isVoicePlanClientReleaseStatus(value) {
  return VOICE_PLAN_CLIENT_RELEASE_STATUSES.has(normalizeVoicePlanStatus(value));
}

function getVoicePlanReleasedTaskKey(task) {
  return `${task?.runId || "plan"}:${task?.taskId || task?.id || ""}`;
}

function getVoicePlanTaskStatusLogSummary(task) {
  if (!task) {
    return null;
  }
  return {
    runId: task.runId || task.run_id || task.planRunId || task.plan_run_id || "",
    stage: task.stage || task.planStage || task.plan_stage || "",
    stepOrdinal: task.stepOrdinal ?? task.step_ordinal ?? "",
    status: task.status || "",
    taskId: task.taskId || task.task_id || task.id || task.planTaskId || task.plan_task_id || "",
    textLength: String(task.text || task.todo || task.task || "").length,
    title: task.title || "",
  };
}

function getVoicePlanSnapshotLogSummary(snapshot) {
  if (!snapshot) {
    return null;
  }
  return {
    currentStage: snapshot.currentStage || "",
    currentStepOrdinal: snapshot.currentStepOrdinal ?? "",
    runId: snapshot.runId || "",
    status: snapshot.status || "",
    stepCount: Array.isArray(snapshot.steps) ? snapshot.steps.length : 0,
    steps: (Array.isArray(snapshot.steps) ? snapshot.steps : []).map((step) => ({
      executionStatus: step?.executionStatus || "",
      executionTaskStatuses: (Array.isArray(step?.executionTasks) ? step.executionTasks : [])
        .map((task) => ({
          id: task?.id || task?.taskId || "",
          status: task?.status || "",
        })),
      ordinal: step?.ordinal ?? "",
      revisionStatus: step?.revisionStatus || "",
      revisionTaskStatuses: (Array.isArray(step?.revisionTasks) ? step.revisionTasks : [])
        .map((task) => ({
          id: task?.id || task?.taskId || "",
          status: task?.status || "",
        })),
      status: step?.status || "",
    })),
  };
}

function getVoicePlanReleasedTasksFromSnapshot(snapshot) {
  if (!snapshot?.runId) {
    return [];
  }
  const currentStepOrdinal = Number(snapshot.currentStepOrdinal || 0);
  const currentStage = normalizeVoicePlanStageName(snapshot.currentStage);
  const releasedTasks = [];
  (Array.isArray(snapshot.steps) ? snapshot.steps : []).forEach((step) => {
    const stepOrdinal = Number.isFinite(Number(step?.ordinal)) ? Number(step.ordinal) : 0;
    const stages = currentStage && stepOrdinal === currentStepOrdinal
      ? [currentStage]
      : VOICE_PLAN_STAGE_ORDER;
    stages.forEach((stageName) => {
      getVoicePlanStageTasks(step, stageName).forEach((task) => {
        if (!isVoicePlanClientReleaseStatus(task?.status)) {
          return;
        }
        releasedTasks.push({
          doneWhen: task.doneWhen,
          maxConcurrency: task.maxConcurrency,
          releasePolicy: task.releasePolicy,
          requiresQueueDrain: task.requiresQueueDrain,
          runId: task.runId || snapshot.runId,
          stage: task.stage || stageName,
          stepOrdinal: task.stepOrdinal ?? stepOrdinal,
          taskId: task.id || task.taskId,
          title: task.title,
          text: task.text,
        });
      });
    });
  });
  return releasedTasks
    .map((task) => normalizeVoicePlanReleasedTask(task, snapshot))
    .filter(Boolean);
}

function isSpecEditTodoQueueItem(item) {
  return normalizeTodoQueueKind(item?.kind || item?.type) === TODO_QUEUE_KIND_SPEC_EDIT
    || Boolean(getTodoQueueItemSpecEdit(item));
}

function getTodoQueueNoteFromPastedText(value) {
  return getTodoQueueLineCount(value) > TODO_QUEUE_NOTE_LINE_THRESHOLD
    ? normalizeTodoQueueNote(value)
    : null;
}

function normalizeTodoTerminalPromptPart(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTodoQueueImage(value) {
  const image = typeof value === "string"
    ? { src: value }
    : value && typeof value === "object"
      ? value
      : null;
  const src = typeof image?.src === "string" ? image.src.trim() : "";

  if (!src || !src.startsWith("data:image/")) {
    return null;
  }

  return {
    name: typeof image.name === "string" ? image.name.slice(0, 160) : "",
    size: Number(image.size || 0),
    src,
    type: typeof image.type === "string" ? image.type.slice(0, 80) : "",
  };
}

function getTodoQueueItemImage(item) {
  return normalizeTodoQueueImage(item?.image || item?.imageDataUrl || item?.imageSrc);
}

function dedupeTodoQueueImages(images) {
  const seenSources = new Set();

  return (Array.isArray(images) ? images : [])
    .map(normalizeTodoQueueImage)
    .filter((image) => {
      if (!image || seenSources.has(image.src)) {
        return false;
      }

      seenSources.add(image.src);
      return true;
    });
}

function getTodoQueueItemTerminalText(item) {
  const specEdit = getTodoQueueItemSpecEdit(item);
  if (specEdit?.promptText) {
    return specEdit.promptText;
  }

  const text = normalizeTodoQueueText(item?.text);
  const note = getTodoQueueItemNote(item);

  if (text && note?.text) {
    return `${text}\n\n${note.text}`;
  }

  return text || note?.text || "";
}

function getTodoQueueItemThreadMessageText(item, fallback = "") {
  return getTodoQueueItemTerminalText(item) || String(fallback || "");
}

function getTodoQueueItemAutoQueueSource(item) {
  return getTodoQueueAutoQueueSourceForSource({
    source: item?.source,
    specEdit: isSpecEditTodoQueueItem(item),
  });
}

function getTodoQueueAttachmentSource(source) {
  if (source === TODO_QUEUE_SOURCE_SPEC_EDIT_AUTO) {
    return "tui_spec_edit_auto_queue";
  }
  if (source === TODO_QUEUE_SOURCE_VOICE_AGENT) {
    return "tui_voice_agent_queue";
  }
  if (source === TODO_QUEUE_SOURCE_VOICE_PLAN) {
    return "tui_voice_plan_queue";
  }
  return source === TODO_QUEUE_SOURCE_TODO_AUTO ? "tui_todo_auto_queue" : "tui_todo_drop";
}

function getTodoQueuePromptEventSource(source, item) {
  return getTodoQueuePromptEventSourceForSource({
    source,
    specEdit: isSpecEditTodoQueueItem(item),
  });
}

function getTodoQueueLifecycleSource(source, item) {
  return getTodoQueueLifecycleSourceForSource({
    source,
    specEdit: isSpecEditTodoQueueItem(item),
  });
}

function normalizeTodoTerminalAgentId(value) {
  return String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function normalizeTodoTerminalIdentity(value) {
  return String(value || "").trim();
}

function normalizeTodoTerminalIndex(value) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function todoQueueTimestampMs(value) {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function isTodoQueueSendableActivityStatus(value) {
  return terminalActivityStatusIsSendable(value);
}

function getTodoQueueTargetAgentId(item) {
  const queueState = getTodoQueueRawQueueState(item);
  return normalizeTodoTerminalAgentId(
    item?.targetAgentId
      || item?.target_agent_id
      || queueState?.targetAgentId
      || queueState?.target_agent_id
      || queueState?.targetRole
      || queueState?.target_role
      || item?.remoteCommand?.targetAgentId
      || item?.remote_command?.target_agent_id
      || "",
  );
}

function getTodoQueueTargetTerminalId(item) {
  const queueState = getTodoQueueRawQueueState(item);
  return normalizeTodoTerminalIdentity(
    item?.targetTerminalId
      || item?.target_terminal_id
      || item?.terminalId
      || item?.terminal_id
      || item?.paneId
      || item?.pane_id
      || queueState?.targetTerminalId
      || queueState?.target_terminal_id
      || queueState?.terminalId
      || queueState?.terminal_id
      || queueState?.paneId
      || queueState?.pane_id
      || item?.remoteCommand?.targetTerminalId
      || item?.remoteCommand?.target_terminal_id
      || item?.remoteCommand?.terminalId
      || item?.remoteCommand?.terminal_id
      || item?.remoteCommand?.paneId
      || item?.remoteCommand?.pane_id
      || item?.remote_command?.target_terminal_id
      || item?.remote_command?.terminal_id
      || item?.remote_command?.pane_id
      || "",
  );
}

function getTodoQueueTargetThreadId(item) {
  const queueState = getTodoQueueRawQueueState(item);
  return normalizeTodoTerminalIdentity(
    item?.targetThreadId
      || item?.target_thread_id
      || item?.threadId
      || item?.thread_id
      || queueState?.targetThreadId
      || queueState?.target_thread_id
      || queueState?.threadId
      || queueState?.thread_id
      || item?.remoteCommand?.targetThreadId
      || item?.remoteCommand?.target_thread_id
      || item?.remoteCommand?.threadId
      || item?.remoteCommand?.thread_id
      || item?.remote_command?.target_thread_id
      || item?.remote_command?.thread_id
      || "",
  );
}

function getTodoQueueTargetTerminalIndex(item) {
  const queueState = getTodoQueueRawQueueState(item);
  const directIndex = normalizeTodoTerminalIndex(
    item?.targetTerminalIndex
      ?? item?.target_terminal_index
      ?? item?.terminalIndex
      ?? item?.terminal_index
      ?? queueState?.targetTerminalIndex
      ?? queueState?.target_terminal_index
      ?? queueState?.terminalIndex
      ?? queueState?.terminal_index
      ?? item?.remoteCommand?.targetTerminalIndex
      ?? item?.remoteCommand?.target_terminal_index
      ?? item?.remoteCommand?.terminalIndex
      ?? item?.remoteCommand?.terminal_index
      ?? item?.remote_command?.target_terminal_index
      ?? item?.remote_command?.terminal_index,
  );
  if (directIndex !== null) {
    return directIndex;
  }

  const colorSlot = normalizeTerminalColorSlot(
    item?.targetColorSlot
      ?? item?.target_color_slot
      ?? item?.terminalColorSlot
      ?? item?.terminal_color_slot
      ?? item?.colorSlot
      ?? item?.color_slot
      ?? queueState?.targetColorSlot
      ?? queueState?.target_color_slot
      ?? queueState?.terminalColorSlot
      ?? queueState?.terminal_color_slot
      ?? queueState?.colorSlot
      ?? queueState?.color_slot
      ?? item?.remoteCommand?.targetColorSlot
      ?? item?.remoteCommand?.target_color_slot
      ?? item?.remoteCommand?.terminalColorSlot
      ?? item?.remoteCommand?.terminal_color_slot
      ?? item?.remoteCommand?.colorSlot
      ?? item?.remoteCommand?.color_slot
      ?? item?.remote_command?.target_color_slot
      ?? item?.remote_command?.terminal_color_slot
      ?? item?.remote_command?.color_slot,
  );
  const hasTerminalColor = Boolean(normalizeTerminalHexColor(
    item?.targetTerminalColor
      || item?.target_terminal_color
      || item?.terminalColor
      || item?.terminal_color
      || queueState?.targetTerminalColor
      || queueState?.target_terminal_color
      || queueState?.terminalColor
      || queueState?.terminal_color
      || item?.remoteCommand?.targetTerminalColor
      || item?.remoteCommand?.target_terminal_color
      || item?.remoteCommand?.terminalColor
      || item?.remoteCommand?.terminal_color
      || item?.remote_command?.target_terminal_color
      || item?.remote_command?.terminal_color,
  ));
  return hasTerminalColor ? colorSlot : null;
}

function getTodoQueueTargetColorSlot(item) {
  const queueState = getTodoQueueRawQueueState(item);
  return normalizeTerminalColorSlot(
    item?.targetColorSlot
      ?? item?.target_color_slot
      ?? item?.terminalColorSlot
      ?? item?.terminal_color_slot
      ?? item?.colorSlot
      ?? item?.color_slot
      ?? queueState?.targetColorSlot
      ?? queueState?.target_color_slot
      ?? queueState?.terminalColorSlot
      ?? queueState?.terminal_color_slot
      ?? queueState?.colorSlot
      ?? queueState?.color_slot
      ?? item?.remoteCommand?.targetColorSlot
      ?? item?.remoteCommand?.target_color_slot
      ?? item?.remoteCommand?.terminalColorSlot
      ?? item?.remoteCommand?.terminal_color_slot
      ?? item?.remoteCommand?.colorSlot
      ?? item?.remoteCommand?.color_slot
      ?? item?.remote_command?.target_color_slot
      ?? item?.remote_command?.terminal_color_slot
      ?? item?.remote_command?.color_slot,
  );
}

function getTodoQueueTargetTerminalColor(item) {
  const queueState = getTodoQueueRawQueueState(item);
  const candidates = [
    item?.targetTerminalColor,
    item?.target_terminal_color,
    item?.terminalColor,
    item?.terminal_color,
    queueState?.targetTerminalColor,
    queueState?.target_terminal_color,
    queueState?.terminalColor,
    queueState?.terminal_color,
    item?.remoteCommand?.targetTerminalColor,
    item?.remoteCommand?.target_terminal_color,
    item?.remoteCommand?.terminalColor,
    item?.remoteCommand?.terminal_color,
    item?.remote_command?.target_terminal_color,
    item?.remote_command?.terminal_color,
  ];
  for (const candidate of candidates) {
    const color = normalizeTerminalHexColor(candidate);
    if (color) {
      return color;
    }
  }
  return "";
}

function normalizeTodoQueuePersistedQueueState(item) {
  const queueState = getTodoQueueRawQueueState(item);
  if (!queueState) {
    return null;
  }

  const phase = normalizeTodoQueuePersistedPhase(
    queueState.phase
      || queueState.state
      || queueState.queuePhase
      || queueState.queue_phase,
  );
  if (!phase) {
    return null;
  }

  const source = normalizeTodoQueueSource(queueState.source || item?.source || "");
  const targetAgentId = getTodoQueueTargetAgentId(item);
  const targetTerminalId = getTodoQueueTargetTerminalId(item);
  const targetTerminalIndex = getTodoQueueTargetTerminalIndex(item);
  const targetThreadId = getTodoQueueTargetThreadId(item);
  const targetColorSlot = getTodoQueueTargetColorSlot(item);
  const targetTerminalColor = getTodoQueueTargetTerminalColor(item);
  const createdAt = String(queueState.createdAt || queueState.created_at || queueState.queuedAt || queueState.queued_at || "").trim();
  const updatedAt = String(queueState.updatedAt || queueState.updated_at || "").trim();
  const reason = String(queueState.reason || "").trim();

  return {
    phase,
    state: phase,
    ...(source ? { source } : {}),
    ...(targetAgentId ? { targetAgentId, targetRole: targetAgentId } : {}),
    ...(targetTerminalId ? { targetTerminalId } : {}),
    ...(Number.isInteger(targetTerminalIndex) ? { targetTerminalIndex } : {}),
    ...(targetThreadId ? { targetThreadId } : {}),
    ...(targetTerminalColor ? { targetTerminalColor } : {}),
    ...(Number.isInteger(targetColorSlot) ? { targetColorSlot } : {}),
    ...(createdAt ? { queuedAt: createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(reason ? { reason } : {}),
  };
}

function getTodoQueueItemWithPersistedQueueState(item, phase, fields = {}) {
  if (!item || typeof item !== "object") {
    return item;
  }

  const safePhase = normalizeTodoQueuePersistedPhase(phase);
  if (!safePhase) {
    const { queueState: _queueState, queue_state: _queueStateSnake, ...rest } = item;
    return rest;
  }

  const existingState = getTodoQueueRawQueueState(item) || {};
  const fieldTargetColorSlot = normalizeTerminalColorSlot(fields.targetColorSlot);
  const fieldTargetTerminalIndex = normalizeTodoTerminalIndex(fields.targetTerminalIndex);
  const existingTargetColorSlot = normalizeTerminalColorSlot(existingState.targetColorSlot ?? existingState.target_color_slot);
  const existingTargetTerminalIndex = normalizeTodoTerminalIndex(
    existingState.targetTerminalIndex
      ?? existingState.target_terminal_index
      ?? existingState.terminalIndex
      ?? existingState.terminal_index,
  );
  const nowIso = new Date().toISOString();
  const nextState = normalizeTodoQueuePersistedQueueState({
    ...item,
    queueState: {
      ...existingState,
      phase: safePhase,
      state: safePhase,
      source: fields.source || existingState.source || item.source || "",
      targetAgentId: fields.targetAgentId || fields.targetRole || existingState.targetAgentId || existingState.targetRole || getTodoQueueTargetAgentId(item),
      targetColorSlot: fieldTargetColorSlot ?? existingTargetColorSlot ?? getTodoQueueTargetColorSlot(item),
      targetTerminalColor: fields.targetTerminalColor || existingState.targetTerminalColor || existingState.target_terminal_color || getTodoQueueTargetTerminalColor(item),
      targetTerminalId: fields.targetTerminalId || existingState.targetTerminalId || existingState.target_terminal_id || getTodoQueueTargetTerminalId(item),
      targetTerminalIndex: fieldTargetTerminalIndex ?? existingTargetTerminalIndex ?? getTodoQueueTargetTerminalIndex(item),
      targetThreadId: fields.targetThreadId || existingState.targetThreadId || existingState.target_thread_id || getTodoQueueTargetThreadId(item),
      queuedAt: existingState.queuedAt || existingState.queued_at || nowIso,
      updatedAt: nowIso,
      reason: fields.reason || existingState.reason || "",
    },
  });

  return nextState ? { ...item, queueState: nextState } : item;
}

function getTodoQueueItemWithoutPersistedQueueState(item) {
  if (!item || typeof item !== "object") {
    return item;
  }
  const { queueState: _queueState, queue_state: _queueStateSnake, ...rest } = item;
  return rest;
}

function getTodoQueueItemStorageRehydrated(item) {
  const queueState = normalizeTodoQueuePersistedQueueState(item);
  if (!queueState) {
    return item;
  }
  if (queueState.phase !== "queued") {
    return null;
  }
  return getTodoQueueItemWithPersistedQueueState(item, "queued", {
    ...queueState,
    reason: queueState.reason || "",
  });
}

function buildTodoQueuePendingItemsFromPersistedQueue(items, workspaceId = "") {
  const startedAtMs = Date.now();
  return (Array.isArray(items) ? items : []).reduce((pendingItems, item) => {
    const queueState = normalizeTodoQueuePersistedQueueState(item);
    if (!item?.id || !queueState || queueState.phase !== "queued") {
      return pendingItems;
    }
    pendingItems[item.id] = {
      cancellable: true,
      item: getTodoQueueItemLogSummary([item])[0] || null,
      itemId: item.id,
      message: "",
      paneId: "",
      phase: "queued",
      reason: queueState.reason || "rehydrated",
      source: queueState.source || getTodoQueueItemAutoQueueSource(item),
      startedAtMs,
      state: "queued",
      targetRole: queueState.targetRole || queueState.targetAgentId || getTodoQueueTargetAgentId(item),
      targetTerminalId: queueState.targetTerminalId || getTodoQueueTargetTerminalId(item),
      targetTerminalIndex: Number.isInteger(queueState.targetTerminalIndex)
        ? queueState.targetTerminalIndex
        : getTodoQueueTargetTerminalIndex(item) ?? "",
      targetThreadId: queueState.targetThreadId || getTodoQueueTargetThreadId(item),
      timeoutAtMs: 0,
      timeoutMs: 0,
      workspaceId: item.workspaceId || workspaceId || "",
    };
    return pendingItems;
  }, {});
}

function todoQueueRemoteItemsMatch(left, right) {
  if (!left || !right) {
    return false;
  }

  const leftCommandId = String(left.remoteCommand?.commandId || left.remoteCommand?.id || "").trim();
  const rightCommandId = String(right.remoteCommand?.commandId || right.remoteCommand?.id || "").trim();
  if (leftCommandId && rightCommandId && leftCommandId === rightCommandId) {
    return true;
  }

  return Boolean(
    normalizeTodoQueueSource(left.source) === TODO_QUEUE_SOURCE_REMOTE_CONTROL
      && normalizeTodoQueueSource(right.source) === TODO_QUEUE_SOURCE_REMOTE_CONTROL
      && normalizeTodoQueueText(left.text) === normalizeTodoQueueText(right.text)
      && getTodoQueueTargetAgentId(left) === getTodoQueueTargetAgentId(right)
      && getTodoQueueTargetTerminalId(left) === getTodoQueueTargetTerminalId(right)
      && getTodoQueueTargetTerminalIndex(left) === getTodoQueueTargetTerminalIndex(right)
      && getTodoQueueTargetThreadId(left) === getTodoQueueTargetThreadId(right)
  );
}

function todoQueueSendTargetMatchesIdentity(candidate, targetTerminalId, targetThreadId) {
  const requestedTerminalId = normalizeTodoTerminalIdentity(targetTerminalId);
  const requestedThreadId = normalizeTodoTerminalIdentity(targetThreadId);
  if (!requestedTerminalId && !requestedThreadId) {
    return true;
  }
  const candidateTerminalIds = [
    candidate?.paneId,
    candidate?.targetBinding?.paneId,
    candidate?.targetProviderBinding?.terminalBinding?.paneId,
    candidate?.liveTerminal?.paneId,
    candidate?.liveTerminal?.terminalId,
    candidate?.terminalAgent?.paneId,
  ].map(normalizeTodoTerminalIdentity).filter(Boolean);
  const candidateThreadIds = [
    candidate?.targetThread?.id,
    candidate?.liveTerminal?.threadId,
    candidate?.terminalAgent?.threadId,
  ].map(normalizeTodoTerminalIdentity).filter(Boolean);
  return (!requestedTerminalId || candidateTerminalIds.includes(requestedTerminalId))
    && (!requestedThreadId || candidateThreadIds.includes(requestedThreadId));
}

function getTodoQueueAgentAccentColor(agentId) {
  const normalized = normalizeTodoTerminalAgentId(agentId);
  if (normalized === "claude") return "#ff9f43";
  if (normalized === "opencode") return "#41d38a";
  if (normalized === "codex") return "#62a0ff";
  return "#8bb8ff";
}

function findTodoAgentStatus(agentStatuses, agentId) {
  const normalizedAgentId = normalizeTodoTerminalAgentId(agentId);
  return (Array.isArray(agentStatuses) ? agentStatuses : []).find((status) => (
    normalizeTodoTerminalAgentId(status?.id) === normalizedAgentId
  )) || null;
}

function getProviderBindingModelId(providerBinding) {
  return String(
    providerBinding?.modelId
      || providerBinding?.model
      || providerBinding?.activeModel
      || providerBinding?.nativeModel
      || providerBinding?.selectedModel
      || providerBinding?.configuredModel
      || "",
  ).trim();
}

function resolveTodoImageInputSupport({ agent, agentStatuses, providerBinding = null, role }) {
  const roleId = normalizeTodoTerminalAgentId(role || agent?.id);
  const agentId = roleId === "generic" || roleId === "terminal" || roleId === "shell"
    ? roleId
    : normalizeTodoTerminalAgentId(agent?.id || roleId);
  const status = findTodoAgentStatus(agentStatuses, agentId);
  const activeModel = String(
    getProviderBindingModelId(providerBinding)
    || status?.activeModel
    || status?.model
    || status?.selectedModel
    || status?.configuredModel
    || "",
  ).trim();

  if (!TODO_QUEUE_IMAGE_TERMINALS.has(agentId)) {
    return {
      activeModel,
      reason: "This terminal does not accept image todos.",
      state: "unsupported",
      supported: false,
    };
  }

  return getAgentModelImageInputCapability(agentId, activeModel, {
    agentLabel: agent?.label || agentId,
  });
}

function getTodoImageUnsupportedDropMessage(capability) {
  const reason = typeof capability?.reason === "string" ? capability.reason.trim() : "";
  return reason || "Drop image todos on Codex or Claude with an image-capable model.";
}

function getTodoImageMimeType(image) {
  const normalized = normalizeTodoQueueImage(image);
  if (!normalized) {
    return "";
  }

  return normalized.type
    || normalized.src.match(/^data:(image\/[^;]+);base64,/i)?.[1]
    || "";
}

function getTodoImageLogSummary(images) {
  return (Array.isArray(images) ? images : [images])
    .map((image) => normalizeTodoQueueImage(image))
    .filter(Boolean)
    .map((image) => ({
      dataUrlLength: String(image.src || "").length,
      mimeType: getTodoImageMimeType(image),
      name: image.name || "",
      size: Number(image.size || 0),
    }));
}

function getTodoQueueItemLogSummary(items) {
  return (Array.isArray(items) ? items : [items])
    .map((item) => {
      const image = getTodoQueueItemImage(item);
      const note = getTodoQueueItemNote(item);
      const specEdit = getTodoQueueItemSpecEdit(item);
      return {
        hasImage: Boolean(image),
        hasNote: Boolean(note),
        hasSpecEdit: Boolean(specEdit),
        id: String(item?.id || ""),
        image: image ? getTodoImageLogSummary([image])[0] || null : null,
        kind: normalizeTodoQueueKind(item?.kind || item?.type),
        noteLength: note ? normalizeTodoQueueMultilineText(note.text).length : 0,
        source: normalizeTodoQueueSource(item?.source),
        specEditIntentId: specEdit?.intentId || "",
        textLength: normalizeTodoQueueText(item?.text).length,
      };
    });
}

function todoImageToAttachmentPayload(image, index = 0) {
  const normalized = normalizeTodoQueueImage(image);
  const mimeType = getTodoImageMimeType(normalized);

  if (!normalized || !mimeType) {
    return null;
  }

  return {
    dataUrl: normalized.src,
    mimeType,
    name: normalized.name || `todo-image-${index + 1}`,
  };
}

function todoImageToComposerAttachment(image, index = 0, source = "tui_todo_drop") {
  const normalized = normalizeTodoQueueImage(image);
  const mimeType = getTodoImageMimeType(normalized);

  if (!normalized || !mimeType) {
    return null;
  }

  return {
    dataUrl: normalized.src,
    mimeType,
    name: normalized.name || `todo-image-${index + 1}`,
    size: Number(normalized.size || 0),
    source,
    status: "queued",
  };
}

function formatSavedTodoImageAttachments(images) {
  return (Array.isArray(images) ? images : [])
    .map((image, index) => {
      const name = String(image?.name || `image-${index + 1}`).trim();
      const path = String(image?.path || "").trim();
      return path ? `[image-attached ${index + 1}] ${name} -> ${path}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

async function saveTodoQueueImageAttachments(images) {
  const payload = (Array.isArray(images) ? images : [images])
    .map(todoImageToAttachmentPayload)
    .filter(Boolean);

  if (!payload.length) {
    return [];
  }

  return invoke("save_todo_image_attachments", { images: payload });
}

async function saveTodoQueueTextAttachment(note) {
  const normalizedNote = normalizeTodoQueueNote(note);

  if (!normalizedNote?.text) {
    return null;
  }

  return invoke("save_todo_text_attachment", {
    request: {
      text: normalizedNote.text,
      title: normalizedNote.title,
    },
  });
}

async function prepareTodoTerminalText(item) {
  const specEdit = getTodoQueueItemSpecEdit(item);
  if (specEdit?.promptText) {
    return specEdit.promptText;
  }

  const text = normalizeTodoQueueText(item?.text);
  const note = getTodoQueueItemNote(item);
  const parts = [];

  if (text) {
    parts.push(text);
  }

  if (note?.text) {
    try {
      const savedNote = await saveTodoQueueTextAttachment(note);
      const savedPath = String(savedNote?.path || "").trim();
      const lineCount = Number(savedNote?.lineCount || note.lineCount || getTodoQueueLineCount(note.text));
      const label = getTodoQueuePastedLinesLabel(lineCount);

      parts.push(savedPath ? `${label} -> ${savedPath}` : `${label}: ${note.text}`);
    } catch {
      parts.push(`${getTodoQueuePastedLinesLabel(note.lineCount || getTodoQueueLineCount(note.text))}: ${note.text}`);
    }
  }

  return parts.map(normalizeTodoTerminalPromptPart).filter(Boolean).join(" ");
}

function getTodoClipboardFileSignature(file) {
  if (!file) {
    return "";
  }

  return [
    String(file.name || "clipboard-image"),
    String(file.type || ""),
    String(file.size || 0),
    String(file.lastModified || 0),
  ].join("|");
}

function getTodoClipboardImageFiles(clipboardData) {
  const itemFiles = Array.from(clipboardData?.items || [])
    .filter((item) => item?.kind === "file" && String(item.type || "").startsWith("image/"))
    .map((item) => item.getAsFile?.())
    .filter(Boolean);
  const clipboardFiles = Array.from(clipboardData?.files || [])
    .filter((file) => String(file?.type || "").startsWith("image/"));
  const seenFiles = new Set();

  return itemFiles.concat(clipboardFiles)
    .filter((file) => {
      const signature = getTodoClipboardFileSignature(file);
      if (!signature || seenFiles.has(signature)) {
        return false;
      }

      seenFiles.add(signature);
      return true;
    })
    .slice(0, TODO_QUEUE_MAX_PASTE_IMAGES);
}

function readTodoImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener("load", () => {
      resolve(normalizeTodoQueueImage({
        name: file?.name || "",
        src: String(reader.result || ""),
        type: file?.type || "",
      }));
    });
    reader.addEventListener("error", () => reject(reader.error || new Error("Unable to read image.")));
    reader.readAsDataURL(file);
  });
}

function getTodoDropErrorMessage(error) {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error && typeof error.message === "string" && error.message.trim()) {
    return error.message;
  }

  return "Unable to send todo to terminal.";
}

function createTodoQueueBusyError(reason, message) {
  const error = new Error(message || "No agent terminal is available yet.");
  error.todoQueueBusy = true;
  error.todoQueueBusyReason = String(reason || "");
  return error;
}

function isTodoQueueBusyError(error) {
  return Boolean(
    error?.todoQueueBusy
    || TODO_QUEUE_BUSY_REASONS.has(String(error?.todoQueueBusyReason || "").trim()),
  );
}

function getTodoQueuePendingPhase(pendingItem) {
  const phase = String(pendingItem?.phase || pendingItem?.state || "sending").trim().toLowerCase();
  return phase === "queued" ? "queued" : "sending";
}

function normalizeTodoQueuePersistedPhase(value) {
  const phase = String(value || "").trim().toLowerCase();
  return phase === "queued" || phase === "sending" ? phase : "";
}

function getTodoQueueRawQueueState(item) {
  if (item?.queueState && typeof item.queueState === "object") {
    return item.queueState;
  }
  if (item?.queue_state && typeof item.queue_state === "object") {
    return item.queue_state;
  }
  return null;
}

function createTodoQueueItem(text, options = {}) {
  const createdAt = typeof options.createdAt === "string" && options.createdAt.trim()
    ? options.createdAt
    : new Date().toISOString();
  const id = typeof options.id === "string" && options.id.trim()
    ? options.id.trim()
    : typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const image = normalizeTodoQueueImage(options.image);
  const note = normalizeTodoQueueNote(options.note);
  const kind = normalizeTodoQueueKind(options.kind);
  const source = normalizeTodoQueueSource(options.source);
  const specEdit = normalizeTodoQueueSpecEdit(options.specEdit);
  const planTask = normalizeTodoQueuePlanTask(options.planTask);
  const workspaceId = String(options.workspaceId || specEdit?.workspaceId || "").trim();
  const targetAgentId = normalizeTodoTerminalAgentId(options.targetAgentId || options.target_agent_id);
  const targetAgentLabel = String(options.targetAgentLabel || options.target_agent_label || targetAgentId || "").trim();
  const targetTerminalId = getTodoQueueTargetTerminalId(options);
  const targetTerminalIndex = getTodoQueueTargetTerminalIndex(options);
  const targetThreadId = getTodoQueueTargetThreadId(options);
  const targetColorSlot = getTodoQueueTargetColorSlot(options);
  const hasTerminalTarget = Boolean(targetTerminalId || Number.isInteger(targetTerminalIndex) || targetThreadId);
  const targetColorFallbackSlot = targetColorSlot ?? targetTerminalIndex ?? 0;
  const targetTerminalColor = hasTerminalTarget
    ? getTodoQueueTargetTerminalColor(options) || terminalColorForSlot(targetColorFallbackSlot)
    : "";
  const remoteCommand = options.remoteCommand && typeof options.remoteCommand === "object"
    ? { ...options.remoteCommand }
    : null;
  const queueState = normalizeTodoQueuePersistedQueueState(options);

  return {
    createdAt,
    id,
    ...(image ? { image } : {}),
    kind,
    ...(note ? { note } : {}),
    ...(planTask ? { planTask } : {}),
    ...(source ? { source } : {}),
    ...(specEdit ? { specEdit } : {}),
    ...(remoteCommand ? { remoteCommand } : {}),
    ...(queueState ? { queueState } : {}),
    ...(targetAgentId ? { targetAgentId } : {}),
    ...(targetAgentLabel ? { targetAgentLabel } : {}),
    ...(targetTerminalId ? { targetTerminalId } : {}),
    ...(Number.isInteger(targetTerminalIndex) ? { targetTerminalIndex } : {}),
    ...(targetThreadId ? { targetThreadId } : {}),
    ...(targetTerminalColor ? { targetTerminalColor } : {}),
    ...(Number.isInteger(targetColorSlot) ? { targetColorSlot } : {}),
    text: normalizeTodoQueueText(text),
    ...(workspaceId ? { workspaceId } : {}),
  };
}

function normalizeTodoQueueItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const text = normalizeTodoQueueText(item.text);
  const image = getTodoQueueItemImage(item);
  const note = getTodoQueueItemNote(item);
  const kind = normalizeTodoQueueKind(item.kind || item.type);
  const source = normalizeTodoQueueSource(item.source);
  const specEdit = getTodoQueueItemSpecEdit(item);
  const planTask = getTodoQueueItemPlanTask(item);
  const workspaceId = String(item.workspaceId || item.workspace_id || specEdit?.workspaceId || "").trim();
  const targetAgentId = normalizeTodoTerminalAgentId(item.targetAgentId || item.target_agent_id);
  const targetAgentLabel = String(item.targetAgentLabel || item.target_agent_label || targetAgentId || "").trim();
  const targetTerminalId = getTodoQueueTargetTerminalId(item);
  const targetTerminalIndex = getTodoQueueTargetTerminalIndex(item);
  const targetThreadId = getTodoQueueTargetThreadId(item);
  const targetColorSlot = getTodoQueueTargetColorSlot(item);
  const hasTerminalTarget = Boolean(targetTerminalId || Number.isInteger(targetTerminalIndex) || targetThreadId);
  const targetColorFallbackSlot = targetColorSlot ?? targetTerminalIndex ?? 0;
  const targetTerminalColor = hasTerminalTarget
    ? getTodoQueueTargetTerminalColor(item) || terminalColorForSlot(targetColorFallbackSlot)
    : "";
  const remoteCommand = item.remoteCommand && typeof item.remoteCommand === "object"
    ? { ...item.remoteCommand }
    : item.remote_command && typeof item.remote_command === "object"
      ? { ...item.remote_command }
      : null;
  const queueState = normalizeTodoQueuePersistedQueueState(item);
  if (!text && !image && !note && !specEdit?.promptText) {
    return null;
  }

  return {
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    id: typeof item.id === "string" && item.id.trim()
      ? item.id
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...(image ? { image } : {}),
    kind: specEdit ? TODO_QUEUE_KIND_SPEC_EDIT : kind,
    ...(note ? { note } : {}),
    ...(planTask ? { planTask } : {}),
    ...(source ? { source } : {}),
    ...(specEdit ? { specEdit } : {}),
    ...(remoteCommand ? { remoteCommand } : {}),
    ...(queueState ? { queueState } : {}),
    ...(targetAgentId ? { targetAgentId } : {}),
    ...(targetAgentLabel ? { targetAgentLabel } : {}),
    ...(targetTerminalId ? { targetTerminalId } : {}),
    ...(Number.isInteger(targetTerminalIndex) ? { targetTerminalIndex } : {}),
    ...(targetThreadId ? { targetThreadId } : {}),
    ...(targetTerminalColor ? { targetTerminalColor } : {}),
    ...(Number.isInteger(targetColorSlot) ? { targetColorSlot } : {}),
    text,
    ...(workspaceId ? { workspaceId } : {}),
  };
}

function normalizeTodoQueueItems(items) {
  return (Array.isArray(items) ? items : [])
    .map(normalizeTodoQueueItem)
    .filter(Boolean)
    .slice(0, TODO_QUEUE_MAX_ITEMS);
}

function readTodoQueueItems(storageKey) {
  if (!canUseTodoQueueStorage()) {
    return [];
  }

  try {
    return normalizeTodoQueueItems(JSON.parse(window.localStorage.getItem(storageKey) || "[]"))
      .map(getTodoQueueItemStorageRehydrated)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeTodoQueueItems(storageKey, items) {
  if (!canUseTodoQueueStorage()) {
    return;
  }

  try {
    const storageItems = normalizeTodoQueueItems(items).filter((item) => {
      const queueState = normalizeTodoQueuePersistedQueueState(item);
      return !queueState || queueState.phase === "queued";
    });
    window.localStorage.setItem(storageKey, JSON.stringify(storageItems));
  } catch {
    // The queue is a convenience layer; storage failures should not interrupt terminal work.
  }
}

function normalizeTodoQueueRemoteCommandReceiptStatus(value) {
  const status = String(value || "").trim().toLowerCase();
  return [
    "queued",
    "sending",
    "submitted",
    "completed",
    "failed",
    "duplicate_ignored",
  ].includes(status) ? status : "queued";
}

function pruneTodoQueueRemoteCommandReceipts(receipts, nowMs = Date.now()) {
  const entries = Object.entries(receipts && typeof receipts === "object" ? receipts : {})
    .map(([key, receipt]) => {
      const receivedAtMs = Number(receipt?.receivedAtMs || receipt?.updatedAtMs || 0);
      const updatedAtMs = Number(receipt?.updatedAtMs || receivedAtMs || 0);
      if (!key || !updatedAtMs || nowMs - updatedAtMs > TODO_QUEUE_REMOTE_COMMAND_RECEIPT_TTL_MS) {
        return null;
      }
      return [key, {
        commandId: String(receipt?.commandId || key),
        itemId: String(receipt?.itemId || ""),
        receivedAtMs,
        status: normalizeTodoQueueRemoteCommandReceiptStatus(receipt?.status),
        text: String(receipt?.text || "").slice(0, 180),
        updatedAtMs,
        workspaceId: String(receipt?.workspaceId || ""),
      }];
    })
    .filter(Boolean)
    .sort((left, right) => Number(right[1].updatedAtMs || 0) - Number(left[1].updatedAtMs || 0))
    .slice(0, TODO_QUEUE_REMOTE_COMMAND_RECEIPT_MAX_ITEMS);

  return Object.fromEntries(entries);
}

function readTodoQueueRemoteCommandReceipts(storageKey) {
  if (!canUseTodoQueueStorage()) {
    return {};
  }

  try {
    return pruneTodoQueueRemoteCommandReceipts(JSON.parse(window.localStorage.getItem(storageKey) || "{}"));
  } catch {
    return {};
  }
}

function writeTodoQueueRemoteCommandReceipts(storageKey, receipts) {
  if (!canUseTodoQueueStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(pruneTodoQueueRemoteCommandReceipts(receipts)),
    );
  } catch {
    // Receipt storage is only an idempotency cache; queue flow should continue without it.
  }
}

function getTodoQueueRemoteCommandId(item) {
  return String(item?.remoteCommand?.commandId || item?.remoteCommand?.id || item?.id || "").trim();
}

function getTodoQueueRemoteCommandReceiptKey(item, workspaceId = "") {
  const commandId = getTodoQueueRemoteCommandId(item);
  if (!commandId || normalizeTodoQueueSource(item?.source) !== TODO_QUEUE_SOURCE_REMOTE_CONTROL) {
    return "";
  }
  return commandId;
}

function todoQueueRemoteCommandReceiptBlocks(receipt) {
  if (!receipt) {
    return false;
  }
  const status = normalizeTodoQueueRemoteCommandReceiptStatus(receipt?.status);
  return TODO_QUEUE_REMOTE_COMMAND_BLOCKING_RECEIPT_STATES.has(status);
}

async function readOrchestratorVoiceHistoryItemsFromAgents({
  rootDirectory = "",
  workspaceId = "",
} = {}) {
  logTerminalStatus("frontend.voice_history.read.start", {
    rootDirectory,
    workspaceId: getOrchestratorVoiceHistoryWorkspaceId(workspaceId),
  });
  try {
    const result = await invoke("read_orchestrator_voice_history", {
      request: {
        rootDirectory: rootDirectory || "",
        workspaceId: getOrchestratorVoiceHistoryWorkspaceId(workspaceId),
      },
    });
    const items = normalizeOrchestratorVoiceHistoryItems(result?.items || []);
    logTerminalStatus("frontend.voice_history.read.result", {
      count: items.length,
      rootDirectory,
      workspaceId: getOrchestratorVoiceHistoryWorkspaceId(workspaceId),
    });
    return items;
  } catch (error) {
    logTerminalStatus("frontend.voice_history.read.error", {
      message: error?.message || String(error || ""),
      rootDirectory,
      workspaceId: getOrchestratorVoiceHistoryWorkspaceId(workspaceId),
    });
    return [];
  }
}

async function writeOrchestratorVoiceHistoryItemsToAgents({
  items = [],
  rootDirectory = "",
  workspaceId = "",
} = {}) {
  try {
    logTerminalStatus("frontend.voice_history.write.start", {
      count: normalizeOrchestratorVoiceHistoryItems(items).length,
      rootDirectory,
      workspaceId: getOrchestratorVoiceHistoryWorkspaceId(workspaceId),
    });
    await invoke("write_orchestrator_voice_history", {
      request: {
        items: normalizeOrchestratorVoiceHistoryItems(items),
        rootDirectory: rootDirectory || "",
        workspaceId: getOrchestratorVoiceHistoryWorkspaceId(workspaceId),
      },
    });
    logTerminalStatus("frontend.voice_history.write.result", {
      count: normalizeOrchestratorVoiceHistoryItems(items).length,
      rootDirectory,
      workspaceId: getOrchestratorVoiceHistoryWorkspaceId(workspaceId),
    });
  } catch (error) {
    logTerminalStatus("frontend.voice_history.write.error", {
      message: error?.message || String(error || ""),
      rootDirectory,
      workspaceId: getOrchestratorVoiceHistoryWorkspaceId(workspaceId),
    });
    // Voice history persistence should never interrupt terminal work.
  }
}

function OrchestratorVoiceCanvasRing({
  active = false,
  hasSignal = false,
  level = 0,
  stats = EMPTY_ORCHESTRATOR_VOICE_STATS,
}) {
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(0);
  const currentWaveformRef = useRef(Array.from({ length: ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT }, () => 0));
  const smoothedEnvelopeRef = useRef(Array.from({ length: ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT }, () => 0));
  const noiseFloorBandsRef = useRef([]);
  const noiseCalibrationUntilRef = useRef(0);
  const lastActiveRef = useRef(false);
  const breathRef = useRef(0);
  const renderStateRef = useRef({
    active,
    frequencyBands: Array.isArray(stats?.frequencyBands) ? stats.frequencyBands : [],
    level,
    timeDomainSamples: Array.isArray(stats?.timeDomainSamples) ? stats.timeDomainSamples : [],
  });

  useEffect(() => {
    renderStateRef.current = {
      active,
      frequencyBands: Array.isArray(stats?.frequencyBands) ? stats.frequencyBands : [],
      level,
      timeDomainSamples: Array.isArray(stats?.timeDomainSamples) ? stats.timeDomainSamples : [],
    };
  }, [active, level, stats]);

  useEffect(() => {
    let disposed = false;

    const renderFrame = (timestamp) => {
      if (disposed) {
        return;
      }

      const canvas = canvasRef.current;
      const context = canvas?.getContext?.("2d");

      if (canvas && context) {
        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, rect.width || 0);
        const height = Math.max(1, rect.height || 0);
        const pixelRatio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
        const nextWidth = Math.round(width * pixelRatio);
        const nextHeight = Math.round(height * pixelRatio);

        if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
          canvas.width = nextWidth;
          canvas.height = nextHeight;
        }

        context.setTransform(
          (pixelRatio * width) / 100,
          0,
          0,
          (pixelRatio * height) / 100,
          0,
          0,
        );

        const frameState = renderStateRef.current;
        const currentWaveform = currentWaveformRef.current;
        const smoothedEnvelope = smoothedEnvelopeRef.current;
        const animationPhase = timestamp / 360;
        const frequencyBands = Array.isArray(frameState.frequencyBands)
          ? frameState.frequencyBands.map((value) => Math.max(0, Math.min(1, Number(value || 0))))
          : [];
        const timeDomainSamples = Array.isArray(frameState.timeDomainSamples)
          ? frameState.timeDomainSamples.map((value) => Math.max(0, Math.min(1, Number(value || 0))))
          : [];
        const envelopeStats = getOrchestratorVoiceEnvelopeStats(timeDomainSamples);

        if (frameState.active && !lastActiveRef.current) {
          noiseFloorBandsRef.current = frequencyBands.map((value) => Math.min(0.2, value * 0.82));
          noiseCalibrationUntilRef.current = timestamp + ORCHESTRATOR_VOICE_NOISE_CALIBRATION_MS;
          currentWaveform.fill(0);
          smoothedEnvelope.fill(0);
          breathRef.current = 0;
        } else if (!frameState.active && lastActiveRef.current) {
          noiseCalibrationUntilRef.current = 0;
        }

        lastActiveRef.current = frameState.active;

        if (frameState.active && frequencyBands.length) {
          if (noiseFloorBandsRef.current.length !== frequencyBands.length) {
            noiseFloorBandsRef.current = frequencyBands.map((value) => Math.min(0.2, value * 0.82));
          } else {
            noiseFloorBandsRef.current = noiseFloorBandsRef.current.map((floorValue, index) => {
              const bandValue = frequencyBands[index] || 0;
              if (timestamp < noiseCalibrationUntilRef.current) {
                return Math.min(0.2, (floorValue * 0.72) + (bandValue * 0.28));
              }

              if (bandValue < floorValue + 0.015) {
                return Math.max(0, (floorValue * 0.92) + (bandValue * 0.08));
              }

              return Math.min(0.24, (floorValue * 0.997) + (bandValue * 0.003));
            });
          }
        }

        const breathTarget = frameState.active
          ? Math.max(0, Math.min(1, ((frameState.level / 100) - 0.12) * 0.36))
          : 0;
        const breathSmoothing = breathTarget > breathRef.current ? 0.14 : 0.055;
        breathRef.current += (breathTarget - breathRef.current) * breathSmoothing;

        for (let index = 0; index < ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT; index += 1) {
          const target = getOrchestratorVoiceWaveformTarget(
            index,
            frameState.level,
            frameState.active,
            timeDomainSamples,
            envelopeStats,
            frequencyBands,
            noiseFloorBandsRef.current,
            animationPhase,
          );
          const current = smoothedEnvelope[index] || 0;
          const smoothing = target > current ? 0.5 : 0.13;
          const next = current + ((target - current) * smoothing);

          smoothedEnvelope[index] = Math.abs(next) < 0.0005 ? 0 : next;
        }

        for (let index = 0; index < ORCHESTRATOR_VOICE_WAVEFORM_POINT_COUNT; index += 1) {
          const spatialTarget = getOrchestratorVoiceSmoothedEnvelopeValue(smoothedEnvelope, index);
          const output = currentWaveform[index] || 0;
          const smoothing = frameState.active ? 0.46 : 0.18;
          const rendered = output + ((spatialTarget - output) * smoothing);

          currentWaveform[index] = Math.abs(rendered) < 0.0005 ? 0 : rendered;
        }

        drawOrchestratorVoiceCanvasRing(context, currentWaveform, {
          active: frameState.active,
          breath: breathRef.current,
          phase: timestamp / 1000,
          themeMode: getForgeThemeMode(),
        });
      }

      animationFrameRef.current = window.requestAnimationFrame(renderFrame);
    };

    animationFrameRef.current = window.requestAnimationFrame(renderFrame);

    return () => {
      disposed = true;
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return (
    <OrchestratorVoiceCanvasSurface
      aria-hidden="true"
      data-active={active ? "true" : "false"}
      data-signal={hasSignal ? "live" : "quiet"}
      ref={canvasRef}
    />
  );
}

const TodoQueuePanel = memo(function TodoQueuePanel({
  accountKey = "",
  activeDragItemId = "",
  billingStatus = null,
  defaultWorkingDirectory = "",
  draft,
  dropError = "",
  agentStatuses = [],
  items,
  getItemAccentColor = null,
  onBeginWorkspaceFileDrag,
  onBeginTodoDrag,
  onCancelQueuedItem,
  onDraftChange,
  onMinimizePane,
  onOpenWorkspaceSettings,
  onQueueItem,
  onRemoveItem,
  onReorderItem,
  onResumePlan,
  onSubmitDraft,
  onToggleTerminalBreakout,
  onToggleFullscreenPane,
  onUpdateItem,
  onVoiceAgentToolCall,
  onVoicePlanServerResult,
  paneMode = TODO_QUEUE_PANE_MODE_NORMAL,
  pendingItems = {},
  rootDirectory = "",
  selectedTerminalPlanTarget = null,
  terminalBreakoutActive = false,
  workspace,
  workspaceError = "",
  workspaceId,
}) {
  const orchestratorPanelWorkspaceId = workspaceId || workspace?.id || "";
  const orchestratorVoiceHistoryStoreKey = useMemo(
    () => `${rootDirectory || ""}:${getOrchestratorVoiceHistoryWorkspaceId(orchestratorPanelWorkspaceId)}`,
    [orchestratorPanelWorkspaceId, rootDirectory],
  );
  const [activeWorkspaceTool, setActiveWorkspaceTool] = useState("orchestrator");
  const [activeOrchestratorSection, setActiveOrchestratorSection] = useState("todo");
  const [editingItemId, setEditingItemId] = useState("");
  const [editingDraft, setEditingDraft] = useState("");
  const [orchestratorVoiceError, setOrchestratorVoiceError] = useState("");
  const [orchestratorVoiceFeedback, setOrchestratorVoiceFeedback] = useState("");
  const [orchestratorVoiceHistoryItems, setOrchestratorVoiceHistoryItems] = useState([]);
  const [orchestratorSubmissionMode, setOrchestratorSubmissionMode] = useState(readOrchestratorVoiceSubmissionMode);
  const [orchestratorVoiceState, setOrchestratorVoiceState] = useState("idle");
  const [orchestratorVoiceStats, setOrchestratorVoiceStats] = useState(EMPTY_ORCHESTRATOR_VOICE_STATS);
  const [orchestratorChatDraft, setOrchestratorChatDraft] = useState("");
  const [orchestratorChatSubmitting, setOrchestratorChatSubmitting] = useState(false);
  const [orchestratorHistoryCopiedKey, setOrchestratorHistoryCopiedKey] = useState("");
  const [reorderingItemId, setReorderingItemId] = useState("");
  const [todoListOffset, setTodoListOffset] = useState(0);
  const orchestratorVoiceEventsActiveRef = useRef(false);
  const orchestratorVoiceInputFinishRequestedRef = useRef(false);
  const orchestratorVoiceMonitorRef = useRef(null);
  const orchestratorVoiceRunRef = useRef(0);
  const orchestratorVoiceSessionRef = useRef(Date.now());
  const orchestratorVoiceHistoryItemsRef = useRef([]);
  const orchestratorVoiceTurnTimeoutsRef = useRef(new Map());
  const orchestratorVoiceTtsPlayerRef = useRef(null);
  const orchestratorVoiceHistoryStoreKeyRef = useRef(orchestratorVoiceHistoryStoreKey);
  const orchestratorVoiceHistoryLoadedRef = useRef(false);
  const orchestratorVoiceHistoryWriteTimerRef = useRef(0);
  const orchestratorHistoryCopyTimerRef = useRef(0);
  const orchestratorVoiceFastResponseGateRef = useRef({
    cancelled: false,
    pendingFeedback: null,
    pendingTtsEvents: [],
    released: false,
    runId: 0,
    timer: 0,
  });
  const todoBoardRef = useRef(null);
  const todoItemElementsRef = useRef(new Map());
  const todoReorderDragRef = useRef(null);
  const draftTextAreaRef = useRef(null);
  const editingTextAreaRef = useRef(null);
  const todoListRef = useRef(null);
  const orchestratorHistoryScrollRef = useRef(null);
  const skipEditBlurCommitRef = useRef(false);

  const updateVoiceHistoryTurn = useCallback((turnKey, updater) => {
    const safeTurnKey = String(turnKey || "").trim();
    if (!safeTurnKey) {
      return;
    }

    setOrchestratorVoiceHistoryItems((currentItems) => {
      const currentIndex = currentItems.findIndex((item) => item.id === safeTurnKey);
      const currentItem = currentIndex >= 0
        ? currentItems[currentIndex]
        : {
          createdAtMs: Date.now(),
          id: safeTurnKey,
          llmFeedback: "",
          llmFinal: false,
          llmStatus: "",
          queued: false,
          transcript: "",
          transcriptFinal: false,
          turnIndex: Number(safeTurnKey.split(":").pop() || 0) || 0,
          updatedAtMs: Date.now(),
        };
      const nextItem = normalizeOrchestratorVoiceHistoryItem({
        ...currentItem,
        ...(typeof updater === "function" ? updater(currentItem) : updater),
        updatedAtMs: Date.now(),
      });
      if (!nextItem) {
        return currentItems;
      }
      const nextItems = currentIndex >= 0
        ? currentItems.map((item, index) => (index === currentIndex ? nextItem : item))
        : currentItems.concat([nextItem]);

      return nextItems.slice(-ORCHESTRATOR_VOICE_HISTORY_MAX_TURNS);
    });
  }, []);

  useEffect(() => {
    orchestratorVoiceHistoryItemsRef.current = orchestratorVoiceHistoryItems;
  }, [orchestratorVoiceHistoryItems]);

  useEffect(() => {
    const refreshMode = (event) => {
      setOrchestratorSubmissionMode(event?.detail?.mode || readOrchestratorVoiceSubmissionMode());
    };
    const handleStorage = (event) => {
      if (!event.key || event.key.startsWith("diffforge.audio.")) {
        refreshMode();
      }
    };

    window.addEventListener(AUDIO_ORCHESTRATOR_SUBMISSION_MODE_EVENT, refreshMode);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(AUDIO_ORCHESTRATOR_SUBMISSION_MODE_EVENT, refreshMode);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  useLayoutEffect(() => {
    if (activeOrchestratorSection !== "history") {
      return undefined;
    }
    const scrollElement = orchestratorHistoryScrollRef.current;
    if (!scrollElement) {
      return undefined;
    }
    const frameId = window.requestAnimationFrame(() => {
      scrollElement.scrollTop = scrollElement.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [
    activeOrchestratorSection,
    orchestratorChatSubmitting,
    orchestratorVoiceError,
    orchestratorVoiceHistoryItems,
  ]);

  useEffect(() => () => {
    if (orchestratorHistoryCopyTimerRef.current) {
      window.clearTimeout(orchestratorHistoryCopyTimerRef.current);
      orchestratorHistoryCopyTimerRef.current = 0;
    }
  }, []);

  const handleOrchestratorHistoryCopy = useCallback(async (copyKey, text) => {
    const safeCopyKey = String(copyKey || "");
    const safeText = String(text || "");
    if (!safeCopyKey || !safeText) {
      return;
    }

    try {
      const copied = await copyTextToClipboard(safeText);
      if (!copied) {
        return;
      }
      setOrchestratorHistoryCopiedKey(safeCopyKey);
      if (orchestratorHistoryCopyTimerRef.current) {
        window.clearTimeout(orchestratorHistoryCopyTimerRef.current);
      }
      orchestratorHistoryCopyTimerRef.current = window.setTimeout(() => {
        setOrchestratorHistoryCopiedKey((currentKey) => (
          currentKey === safeCopyKey ? "" : currentKey
        ));
        orchestratorHistoryCopyTimerRef.current = 0;
      }, 1400);
    } catch (error) {
      logBigViewSyncDiagnosticEvent("tui.voice_history.copy_failed", {
        message: String(error?.message || error || "Unable to copy message."),
        workspaceId: orchestratorPanelWorkspaceId,
      });
    }
  }, [orchestratorPanelWorkspaceId]);

  const clearVoiceHistoryTurnTimeout = useCallback((turnKey) => {
    const safeTurnKey = String(turnKey || "").trim();
    if (!safeTurnKey) {
      return;
    }
    const timeoutId = orchestratorVoiceTurnTimeoutsRef.current.get(safeTurnKey);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      orchestratorVoiceTurnTimeoutsRef.current.delete(safeTurnKey);
    }
  }, []);

  const clearAllVoiceHistoryTurnTimeouts = useCallback(() => {
    orchestratorVoiceTurnTimeoutsRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    orchestratorVoiceTurnTimeoutsRef.current.clear();
  }, []);

  const markVoiceHistoryTurnTerminal = useCallback((turnKey, status, message) => {
    const safeTurnKey = String(turnKey || "").trim();
    const normalizedStatus = String(status || "failed").trim() || "failed";
    const normalizedMessage = normalizeVoiceHistoryText(
      message || "The orchestrator did not return a final response.",
      1600,
    );
    if (!safeTurnKey) {
      return;
    }
    clearVoiceHistoryTurnTimeout(safeTurnKey);
    updateVoiceHistoryTurn(safeTurnKey, (currentItem) => {
      const isCancelled = normalizedStatus === "cancelled" || normalizedStatus === "canceled";
      if (currentItem.llmFinal || currentItem.queued || currentItem.plan) {
        if (normalizedStatus === "failed" || normalizedStatus === "error") {
          return {
            llmError: normalizedMessage,
            llmFeedback: currentItem.llmFeedback || normalizedMessage,
            llmFinal: true,
            llmStatus: normalizedStatus,
          };
        }
        if (isCancelled && !currentItem.queued && !currentItem.plan) {
          return {
            llmError: normalizedMessage,
            llmFeedback: currentItem.llmFeedback || "",
            llmFinal: true,
            llmStatus: normalizedStatus,
          };
        }
        return currentItem;
      }
      return {
        llmError: normalizedMessage,
        llmFeedback: isCancelled ? (currentItem.llmFeedback || "") : (currentItem.llmFeedback || normalizedMessage),
        llmFinal: true,
        llmStatus: normalizedStatus,
        transcriptFinal: isCancelled ? Boolean(currentItem.transcript) : currentItem.transcriptFinal,
      };
    });
  }, [clearVoiceHistoryTurnTimeout, updateVoiceHistoryTurn]);

  const markPendingVoiceHistoryTurnsTerminal = useCallback((status, message, options = {}) => {
    const includeInterim = Boolean(options?.includeInterim);
    const sessionPrefix = `${Number(orchestratorVoiceSessionRef.current || 0)}:`;
    const pendingTurnKeys = orchestratorVoiceHistoryItemsRef.current
      .filter((item) => (
        String(item.id || "").startsWith(sessionPrefix)
        && (item.transcriptFinal || (includeInterim && item.transcript))
        && !item.llmFinal
        && !item.queued
        && !item.plan
      ))
      .map((item) => item.id);
    pendingTurnKeys.forEach((turnKey) => {
      markVoiceHistoryTurnTerminal(turnKey, status, message);
    });
  }, [markVoiceHistoryTurnTerminal]);

  const scheduleVoiceHistoryTurnTimeout = useCallback((turnKey) => {
    const safeTurnKey = String(turnKey || "").trim();
    if (!safeTurnKey || orchestratorVoiceTurnTimeoutsRef.current.has(safeTurnKey)) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      orchestratorVoiceTurnTimeoutsRef.current.delete(safeTurnKey);
      const currentItem = orchestratorVoiceHistoryItemsRef.current.find((item) => item.id === safeTurnKey) || null;
      markVoiceHistoryTurnTerminal(
        safeTurnKey,
        "timed_out",
        "The orchestrator timed out before returning a final response, plan, or error.",
      );
      logTerminalStatus("frontend.voice_history.turn_timeout", {
        hasFinalTranscript: Boolean(currentItem?.transcriptFinal),
        hasLlmFeedback: Boolean(currentItem?.llmFeedback),
        hasPlan: Boolean(currentItem?.plan),
        llmFinal: Boolean(currentItem?.llmFinal),
        llmStatus: String(currentItem?.llmStatus || ""),
        transcriptLength: String(currentItem?.transcript || "").length,
        timeoutMs: ORCHESTRATOR_VOICE_TURN_TIMEOUT_MS,
        turnKey: safeTurnKey,
        workspaceId: orchestratorPanelWorkspaceId,
      });
    }, ORCHESTRATOR_VOICE_TURN_TIMEOUT_MS);
    orchestratorVoiceTurnTimeoutsRef.current.set(safeTurnKey, timeoutId);
  }, [markVoiceHistoryTurnTerminal, orchestratorPanelWorkspaceId]);

  useEffect(() => {
    let disposed = false;
    clearAllVoiceHistoryTurnTimeouts();
    orchestratorVoiceHistoryStoreKeyRef.current = orchestratorVoiceHistoryStoreKey;
    orchestratorVoiceHistoryLoadedRef.current = false;
    setOrchestratorVoiceHistoryItems([]);

    readOrchestratorVoiceHistoryItemsFromAgents({
      rootDirectory,
      workspaceId: orchestratorPanelWorkspaceId,
    }).then((items) => {
      if (
        disposed
        || orchestratorVoiceHistoryStoreKeyRef.current !== orchestratorVoiceHistoryStoreKey
      ) {
        return;
      }
      orchestratorVoiceHistoryLoadedRef.current = true;
      setOrchestratorVoiceHistoryItems(items);
    });

    return () => {
      disposed = true;
    };
  }, [clearAllVoiceHistoryTurnTimeouts, orchestratorPanelWorkspaceId, orchestratorVoiceHistoryStoreKey, rootDirectory]);

  useEffect(() => {
    if (!orchestratorVoiceHistoryLoadedRef.current) {
      return undefined;
    }

    const scheduledStoreKey = orchestratorVoiceHistoryStoreKey;
    if (orchestratorVoiceHistoryWriteTimerRef.current) {
      window.clearTimeout(orchestratorVoiceHistoryWriteTimerRef.current);
    }
    orchestratorVoiceHistoryWriteTimerRef.current = window.setTimeout(() => {
      orchestratorVoiceHistoryWriteTimerRef.current = 0;
      if (orchestratorVoiceHistoryStoreKeyRef.current !== scheduledStoreKey) {
        return;
      }
      void writeOrchestratorVoiceHistoryItemsToAgents({
        items: orchestratorVoiceHistoryItems,
        rootDirectory,
        workspaceId: orchestratorPanelWorkspaceId,
      });
    }, 120);

    return () => {
      if (orchestratorVoiceHistoryWriteTimerRef.current) {
        window.clearTimeout(orchestratorVoiceHistoryWriteTimerRef.current);
        orchestratorVoiceHistoryWriteTimerRef.current = 0;
      }
    };
  }, [
    orchestratorPanelWorkspaceId,
    orchestratorVoiceHistoryItems,
    orchestratorVoiceHistoryStoreKey,
    rootDirectory,
  ]);

  const recordVoiceHistoryTranscript = useCallback((event) => {
    const sessionId = orchestratorVoiceSessionRef.current;
    const turnKey = getVoiceHistoryTurnKey(event, sessionId);
    const transcript = normalizeVoiceHistoryText(event?.transcript);
    const isFinal = Boolean(event?.final);
    if (!transcript && !isFinal) {
      return;
    }

    logTerminalStatus("frontend.voice_history.transcript_arrived", {
      final: isFinal,
      textLength: transcript.length,
      turnIndex: getVoiceHistoryTurnIndex(event),
      turnKey,
      workspaceId: orchestratorPanelWorkspaceId,
    });
    updateVoiceHistoryTurn(turnKey, (currentItem) => ({
      source: event?.provider === "desktop_text" ? "chat" : currentItem.source || "voice",
      transcript: transcript || currentItem.transcript,
      transcriptFinal: currentItem.transcriptFinal || isFinal,
      turnIndex: getVoiceHistoryTurnIndex(event),
    }));
    if (isFinal) {
      scheduleVoiceHistoryTurnTimeout(turnKey);
    }
  }, [orchestratorPanelWorkspaceId, scheduleVoiceHistoryTurnTimeout, updateVoiceHistoryTurn]);

  const recordVoiceHistoryLlmFeedback = useCallback((event) => {
    const sessionId = orchestratorVoiceSessionRef.current;
    const turnKey = getVoiceHistoryTurnKey(event, sessionId);
    const feedback = normalizeVoiceHistoryText(cleanPublicVoiceAgentText(event?.feedback), 1600);
    if (!feedback) {
      return;
    }

    logTerminalStatus("frontend.voice_history.llm_feedback_arrived", {
      final: Boolean(event?.final),
      status: String(event?.status || "").trim(),
      textLength: feedback.length,
      turnIndex: getVoiceHistoryTurnIndex(event),
      turnKey,
      workspaceId: orchestratorPanelWorkspaceId,
    });
    updateVoiceHistoryTurn(turnKey, {
      llmFeedback: feedback,
      llmFinal: Boolean(event?.final),
      llmStatus: String(event?.status || "").trim(),
      turnIndex: getVoiceHistoryTurnIndex(event),
    });
    if (event?.final) {
      clearVoiceHistoryTurnTimeout(turnKey);
    } else {
      scheduleVoiceHistoryTurnTimeout(turnKey);
    }
  }, [clearVoiceHistoryTurnTimeout, orchestratorPanelWorkspaceId, scheduleVoiceHistoryTurnTimeout, updateVoiceHistoryTurn]);

  const recordVoiceHistoryToolCall = useCallback((event) => {
    const sessionId = orchestratorVoiceSessionRef.current;
    const turnKey = getVoiceHistoryTurnKey(event, sessionId);
    const toolName = String(event?.name || event?.tool_name || event?.toolName || "").trim();
    const args = normalizeVoiceAgentQueueArguments(event?.arguments || event?.args);
    const openAgentsSummary = getVoiceAgentOpenCodingAgentsRequestSummary(args);
    const planSummary = normalizeVoiceHistoryText(args.title || args.goal || args.objective || args.text || "", 220);
    const patch = {
      queued: toolName === "queue",
      queuedText: normalizeVoiceHistoryText(
        toolName === "open_coding_agents"
          ? openAgentsSummary
          : toolName === "create_plan"
            ? planSummary
          : cleanPublicVoiceAgentText(args.text || args.todo || args.task || ""),
        600,
      ),
      turnIndex: getVoiceHistoryTurnIndex(event),
    };
    if (toolName === "open_coding_agents") {
      patch.llmFeedback = `Opening agents: ${openAgentsSummary}`;
      patch.llmFinal = false;
    } else if (toolName === "create_plan") {
      patch.llmFeedback = planSummary ? `Creating plan: ${planSummary}` : "Creating plan...";
      patch.llmFinal = false;
    }
    updateVoiceHistoryTurn(turnKey, (currentItem) => ({
      ...patch,
      llmFeedback: currentItem.llmFeedback || patch.llmFeedback || "",
      llmFinal: currentItem.llmFeedback ? currentItem.llmFinal : Boolean(patch.llmFinal),
      llmStatus: currentItem.llmStatus || patch.llmStatus || "",
    }));
    if (toolName === "create_plan") {
      scheduleVoiceHistoryTurnTimeout(turnKey);
    } else {
      clearVoiceHistoryTurnTimeout(turnKey);
    }
  }, [clearVoiceHistoryTurnTimeout, scheduleVoiceHistoryTurnTimeout, updateVoiceHistoryTurn]);

  const recordVoiceHistoryOpenCodingAgentsResult = useCallback((event, message, status = "ready") => {
    const sessionId = orchestratorVoiceSessionRef.current;
    const turnKey = getVoiceHistoryTurnKey(event, sessionId);
    updateVoiceHistoryTurn(turnKey, {
      llmFeedback: normalizeVoiceHistoryText(message, 1600),
      llmFinal: true,
      llmStatus: status,
      turnIndex: getVoiceHistoryTurnIndex(event),
    });
    clearVoiceHistoryTurnTimeout(turnKey);
  }, [clearVoiceHistoryTurnTimeout, updateVoiceHistoryTurn]);

  const recordVoiceHistoryPlanSnapshot = useCallback((event) => {
    const snapshot = getVoicePlanSnapshotFromPayload(event);
    if (!snapshot) {
      return;
    }

    logTerminalStatus("frontend.voice_history.plan_snapshot_arrived", {
      snapshot: getVoicePlanSnapshotLogSummary(snapshot),
      workspaceId: orchestratorPanelWorkspaceId,
    });
    const hasTurnIndex = event?.turn_index != null || event?.turnIndex != null;
    const sessionId = orchestratorVoiceSessionRef.current;
    const turnKey = hasTurnIndex
      ? getVoiceHistoryTurnKey(event, sessionId)
      : `plan:${snapshot.runId}`;
    setOrchestratorVoiceHistoryItems((currentItems) => {
      const exactTurnIndex = currentItems.findIndex((item) => item.id === turnKey);
      const planIndex = currentItems.findIndex((item) => item.plan?.runId === snapshot.runId);
      const currentIndex = exactTurnIndex >= 0 ? exactTurnIndex : planIndex;
      const currentItem = currentIndex >= 0
        ? currentItems[currentIndex]
        : {
          createdAtMs: Date.now(),
          id: turnKey,
          llmFeedback: "",
          llmFinal: false,
          llmStatus: "",
          queued: false,
          transcript: "",
          transcriptFinal: true,
          turnIndex: hasTurnIndex ? getVoiceHistoryTurnIndex(event) : 0,
          updatedAtMs: Date.now(),
        };
      const nextItem = normalizeOrchestratorVoiceHistoryItem({
        ...currentItem,
        id: currentItem.id || turnKey,
        llmFeedback: currentItem.llmFeedback || `Plan: ${snapshot.title}`,
        llmFinal: true,
        llmStatus: snapshot.status === "completed" ? "ready" : "planned",
        plan: snapshot,
        transcriptFinal: currentItem.transcriptFinal || !hasTurnIndex,
        turnIndex: hasTurnIndex ? getVoiceHistoryTurnIndex(event) : currentItem.turnIndex,
        updatedAtMs: Date.now(),
      });
      if (!nextItem) {
        return currentItems;
      }
      const nextItems = currentIndex >= 0
        ? currentItems.map((item, index) => (index === currentIndex ? nextItem : item))
        : currentItems.concat([nextItem]);
      return nextItems.slice(-ORCHESTRATOR_VOICE_HISTORY_MAX_TURNS);
    });
    clearVoiceHistoryTurnTimeout(turnKey);
  }, [clearVoiceHistoryTurnTimeout, orchestratorPanelWorkspaceId]);

  const resetOrchestratorFastResponseGate = useCallback(() => {
    const gate = orchestratorVoiceFastResponseGateRef.current;
    if (gate?.timer) {
      window.clearTimeout(gate.timer);
    }
    orchestratorVoiceFastResponseGateRef.current = {
      cancelled: false,
      pendingFeedback: null,
      pendingTtsEvents: [],
      released: false,
      runId: orchestratorVoiceRunRef.current,
      timer: 0,
    };
  }, []);

  const cancelOrchestratorFastResponseGate = useCallback((reason = "main_response") => {
    const gate = orchestratorVoiceFastResponseGateRef.current;
    if (!gate || gate.cancelled || gate.released) {
      return;
    }
    const hadPending = Boolean(gate.pendingFeedback) || gate.pendingTtsEvents.length > 0;
    if (gate.timer) {
      window.clearTimeout(gate.timer);
    }
    orchestratorVoiceFastResponseGateRef.current = {
      ...gate,
      cancelled: true,
      pendingFeedback: null,
      pendingTtsEvents: [],
      timer: 0,
    };
    if (hadPending) {
      logBigViewSyncDiagnosticEvent("tui.voice_agent.fast_response_cancelled", {
        reason,
        surface: "tui_voice_agent",
        workspaceId: orchestratorPanelWorkspaceId,
      });
    }
  }, [orchestratorPanelWorkspaceId]);

  const releaseOrchestratorFastResponseGate = useCallback((reason = "timeout") => {
    const gate = orchestratorVoiceFastResponseGateRef.current;
    if (!gate || gate.cancelled || gate.released) {
      return;
    }
    if (gate.runId !== orchestratorVoiceRunRef.current || !orchestratorVoiceEventsActiveRef.current) {
      return;
    }
    if (gate.timer) {
      window.clearTimeout(gate.timer);
    }
    const feedbackEvent = gate.pendingFeedback;
    const ttsEvents = gate.pendingTtsEvents.slice();
    orchestratorVoiceFastResponseGateRef.current = {
      ...gate,
      pendingFeedback: null,
      pendingTtsEvents: [],
      released: true,
      timer: 0,
    };

    if (feedbackEvent) {
      const normalizedEvent = normalizeFastVoiceAgentFeedbackEvent(feedbackEvent);
      recordVoiceHistoryLlmFeedback(normalizedEvent);
      const feedback = String(normalizedEvent.feedback || "").trim();
      if (feedback) {
        setOrchestratorVoiceFeedback(feedback);
      }
    }
    for (const ttsEvent of ttsEvents) {
      void orchestratorVoiceTtsPlayerRef.current?.handleEvent?.(ttsEvent);
    }
    logBigViewSyncDiagnosticEvent("tui.voice_agent.fast_response_released", {
      hasFeedback: Boolean(feedbackEvent),
      reason,
      surface: "tui_voice_agent",
      ttsEventCount: ttsEvents.length,
      workspaceId: orchestratorPanelWorkspaceId,
    });
  }, [orchestratorPanelWorkspaceId, recordVoiceHistoryLlmFeedback]);

  const bufferOrReleaseOrchestratorFastResponseEvent = useCallback((event) => {
    const kind = getVoiceAgentEventKind(event);
    if (isVoiceAgentTtsEventKind(kind)) {
      void orchestratorVoiceTtsPlayerRef.current?.handleEvent?.(event);
      return "released";
    }

    const normalizedEvent = normalizeFastVoiceAgentFeedbackEvent(event);
    recordVoiceHistoryLlmFeedback(normalizedEvent);
    const feedback = String(normalizedEvent.feedback || "").trim();
    if (feedback) {
      setOrchestratorVoiceFeedback(feedback);
    }
    logBigViewSyncDiagnosticEvent("tui.voice_agent.fast_response_released", {
      hasFeedback: Boolean(feedback),
      reason: "immediate",
      surface: "tui_voice_agent",
      ttsEventCount: 0,
      workspaceId: orchestratorPanelWorkspaceId,
    });
    return "released";
  }, [orchestratorPanelWorkspaceId, recordVoiceHistoryLlmFeedback]);

  const getCloudVoiceAgentRequestContext = useCallback(() => ({
    agentStatuses: (Array.isArray(agentStatuses) ? agentStatuses : []).map((agent) => ({
      activeModel: agent?.activeModel || "",
      authenticated: Boolean(agent?.authenticated),
      binary: agent?.binary || agent?.id || "",
      id: agent?.id || "",
      installed: Boolean(agent?.installed),
      label: agent?.label || agent?.id || "",
      version: agent?.version || "",
    })),
    workspaceId: workspaceId || workspace?.id || "",
    workspaceName: workspace?.name || "",
    workspaceRoot: rootDirectory || defaultWorkingDirectory || "",
  }), [agentStatuses, defaultWorkingDirectory, rootDirectory, workspace?.id, workspace?.name, workspaceId]);

  const stopOrchestratorVoiceMonitor = useCallback(async () => {
    if (orchestratorVoiceEventsActiveRef.current) {
      markPendingVoiceHistoryTurnsTerminal(
        "failed",
        "Voice orchestration stopped before a final response, plan, or error arrived.",
      );
    }
    orchestratorVoiceRunRef.current += 1;
    cancelOrchestratorFastResponseGate("stop");
    clearAllVoiceHistoryTurnTimeouts();
    orchestratorVoiceInputFinishRequestedRef.current = false;
    const monitor = orchestratorVoiceMonitorRef.current;
    orchestratorVoiceMonitorRef.current = null;
    const ttsPlayer = orchestratorVoiceTtsPlayerRef.current;
    orchestratorVoiceTtsPlayerRef.current = null;
    setOrchestratorVoiceState("idle");
    setOrchestratorVoiceStats(EMPTY_ORCHESTRATOR_VOICE_STATS);
    setOrchestratorVoiceError("");
    setOrchestratorVoiceFeedback("");
    setOrchestratorChatSubmitting(false);
    await ttsPlayer?.close?.().catch(() => {});
    await stopCloudVoiceAgentStream().catch(() => {});
    await monitor?.finishCapture?.().catch(() => null);
    await monitor?.close?.().catch(() => {});
    orchestratorVoiceEventsActiveRef.current = false;
  }, [cancelOrchestratorFastResponseGate, clearAllVoiceHistoryTurnTimeouts, markPendingVoiceHistoryTurnsTerminal]);

  const finishOrchestratorVoiceInput = useCallback(async () => {
    orchestratorVoiceInputFinishRequestedRef.current = true;
    const monitor = orchestratorVoiceMonitorRef.current;
    orchestratorVoiceMonitorRef.current = null;
    setOrchestratorVoiceState("processing");
    setOrchestratorVoiceStats(EMPTY_ORCHESTRATOR_VOICE_STATS);
    setOrchestratorVoiceError("");
    await finishCloudVoiceAgentInput().catch((error) => {
      logBigViewSyncDiagnosticEvent("tui.voice_agent.finish_input_error", {
        message: getAudioInputErrorMessage(error, "Unable to finish voice input."),
        surface: "tui_voice_agent",
        workspaceId: orchestratorPanelWorkspaceId,
      });
    });
    await monitor?.finishCapture?.().catch(() => null);
    await monitor?.close?.().catch(() => {});
  }, [orchestratorPanelWorkspaceId]);

  const cancelOrchestratorVoiceSubmission = useCallback(async () => {
    const hadActiveEvents = orchestratorVoiceEventsActiveRef.current;
    orchestratorVoiceRunRef.current += 1;
    cancelOrchestratorFastResponseGate("cancelled");
    clearAllVoiceHistoryTurnTimeouts();
    orchestratorVoiceInputFinishRequestedRef.current = false;
    if (hadActiveEvents) {
      markPendingVoiceHistoryTurnsTerminal(
        "cancelled",
        "Voice submission cancelled.",
        { includeInterim: true },
      );
    }
    const monitor = orchestratorVoiceMonitorRef.current;
    orchestratorVoiceMonitorRef.current = null;
    const ttsPlayer = orchestratorVoiceTtsPlayerRef.current;
    orchestratorVoiceTtsPlayerRef.current = null;
    orchestratorVoiceEventsActiveRef.current = false;
    setOrchestratorVoiceState("idle");
    setOrchestratorVoiceStats(EMPTY_ORCHESTRATOR_VOICE_STATS);
    setOrchestratorVoiceError("");
    setOrchestratorVoiceFeedback("");
    setOrchestratorChatSubmitting(false);
    await ttsPlayer?.close?.().catch(() => {});
    await stopCloudVoiceAgentStream().catch(() => {});
    await monitor?.finishCapture?.().catch(() => null);
    await monitor?.close?.().catch(() => {});
  }, [cancelOrchestratorFastResponseGate, clearAllVoiceHistoryTurnTimeouts, markPendingVoiceHistoryTurnsTerminal]);

  const completeOrchestratorVoiceSession = useCallback(async () => {
    orchestratorVoiceRunRef.current += 1;
    cancelOrchestratorFastResponseGate("finished");
    clearAllVoiceHistoryTurnTimeouts();
    orchestratorVoiceInputFinishRequestedRef.current = false;
    const monitor = orchestratorVoiceMonitorRef.current;
    orchestratorVoiceMonitorRef.current = null;
    setOrchestratorVoiceState("idle");
    setOrchestratorVoiceStats(EMPTY_ORCHESTRATOR_VOICE_STATS);
    setOrchestratorVoiceError("");
    setOrchestratorVoiceFeedback("");
    setOrchestratorChatSubmitting(false);
    await stopCloudVoiceAgentStream().catch(() => {});
    await monitor?.finishCapture?.().catch(() => null);
    await monitor?.close?.().catch(() => {});
    orchestratorVoiceEventsActiveRef.current = false;
  }, [cancelOrchestratorFastResponseGate, clearAllVoiceHistoryTurnTimeouts]);

  const startOrchestratorVoiceMonitor = useCallback(async () => {
    const runId = orchestratorVoiceRunRef.current + 1;
    const submissionMode = readOrchestratorVoiceSubmissionMode();
    orchestratorVoiceRunRef.current = runId;
    clearAllVoiceHistoryTurnTimeouts();
    resetOrchestratorFastResponseGate();
    orchestratorVoiceInputFinishRequestedRef.current = false;
    orchestratorVoiceSessionRef.current = Date.now();
    orchestratorVoiceEventsActiveRef.current = true;
    const previousTtsPlayer = orchestratorVoiceTtsPlayerRef.current;
    orchestratorVoiceTtsPlayerRef.current = createCloudVoiceAgentTtsPlayer({
      onError: (error) => {
        logBigViewSyncDiagnosticEvent("tui.voice_agent.tts_playback_error", {
          message: getAudioInputErrorMessage(error, "Unable to play voice response."),
          surface: "tui_voice_agent",
          workspaceId: orchestratorPanelWorkspaceId,
        });
      },
    });
    void orchestratorVoiceTtsPlayerRef.current?.prime?.();
    await previousTtsPlayer?.close?.().catch(() => {});
    setOrchestratorVoiceState("starting");
    setOrchestratorSubmissionMode(submissionMode);
    setOrchestratorVoiceStats(EMPTY_ORCHESTRATOR_VOICE_STATS);
    setOrchestratorVoiceError("");
    setOrchestratorVoiceFeedback("");

    let monitor = null;
    let captureStarted = false;
    let cloudStarted = false;

    const cleanupStartedMonitor = async () => {
      if (cloudStarted) {
        await stopCloudVoiceAgentStream().catch(() => {});
      }
      if (captureStarted) {
        await monitor?.finishCapture?.().catch(() => null);
      }
      await monitor?.close?.().catch(() => {});
    };

    try {
      monitor = await startLowPowerAudioBuffer({
        deviceId: readSelectedAudioInputDeviceId(),
        owner: ORCHESTRATOR_VOICE_OWNER,
        onStats: (stats) => {
          if (orchestratorVoiceRunRef.current === runId) {
            setOrchestratorVoiceStats({
              ...EMPTY_ORCHESTRATOR_VOICE_STATS,
              ...(stats || {}),
            });
          }
        },
      });

      if (orchestratorVoiceRunRef.current !== runId) {
        await cleanupStartedMonitor();
        return;
      }

      orchestratorVoiceMonitorRef.current = monitor;
      await monitor.beginCapture();
      captureStarted = true;
      if (orchestratorVoiceRunRef.current !== runId) {
        orchestratorVoiceMonitorRef.current = null;
        await cleanupStartedMonitor();
        return;
      }

      await startCloudVoiceAgentStream({
        ...getCloudVoiceAgentRequestContext(),
        submissionMode,
      });
      cloudStarted = true;
      if (orchestratorVoiceRunRef.current !== runId) {
        orchestratorVoiceMonitorRef.current = null;
        await cleanupStartedMonitor();
        return;
      }

      if (orchestratorVoiceInputFinishRequestedRef.current) {
        const ownedMonitor = orchestratorVoiceMonitorRef.current === monitor ? monitor : null;
        if (ownedMonitor) {
          orchestratorVoiceMonitorRef.current = null;
        }
        setOrchestratorVoiceState("processing");
        setOrchestratorVoiceStats(EMPTY_ORCHESTRATOR_VOICE_STATS);
        await finishCloudVoiceAgentInput().catch(() => {});
        await ownedMonitor?.finishCapture?.().catch(() => null);
        await ownedMonitor?.close?.().catch(() => {});
        return;
      }

      setOrchestratorVoiceState("listening");
    } catch (error) {
      if (orchestratorVoiceRunRef.current !== runId) {
        await cleanupStartedMonitor();
        return;
      }

      orchestratorVoiceMonitorRef.current = null;
      setOrchestratorVoiceStats(EMPTY_ORCHESTRATOR_VOICE_STATS);
      setOrchestratorVoiceState("error");
      setOrchestratorVoiceFeedback("");
      await cleanupStartedMonitor();
      orchestratorVoiceEventsActiveRef.current = false;
      setOrchestratorVoiceError(getAudioInputErrorMessage(
        error,
        "Unable to start the cloud voice agent.",
      ));
    }
  }, [clearAllVoiceHistoryTurnTimeouts, getCloudVoiceAgentRequestContext, orchestratorPanelWorkspaceId, resetOrchestratorFastResponseGate]);

  const handleOrchestratorChatSubmit = useCallback(async (event) => {
    event?.preventDefault?.();
    const text = orchestratorChatDraft.trim();
    if (
      !text
      || orchestratorChatSubmitting
      || orchestratorVoiceState === "starting"
      || orchestratorVoiceState === "listening"
      || orchestratorVoiceState === "processing"
    ) {
      return;
    }

    const runId = orchestratorVoiceRunRef.current + 1;
    const sessionId = Date.now();
    const turnKey = `${sessionId}:0`;
    orchestratorVoiceRunRef.current = runId;
    clearAllVoiceHistoryTurnTimeouts();
    resetOrchestratorFastResponseGate();
    orchestratorVoiceInputFinishRequestedRef.current = false;
    orchestratorVoiceSessionRef.current = sessionId;
    orchestratorVoiceEventsActiveRef.current = true;
    setActiveOrchestratorSection("history");
    setOrchestratorChatDraft("");
    setOrchestratorChatSubmitting(true);
    setOrchestratorVoiceState("processing");
    setOrchestratorVoiceStats(EMPTY_ORCHESTRATOR_VOICE_STATS);
    setOrchestratorVoiceError("");
    setOrchestratorVoiceFeedback("");
    const previousTtsPlayer = orchestratorVoiceTtsPlayerRef.current;
    orchestratorVoiceTtsPlayerRef.current = null;
    await previousTtsPlayer?.close?.().catch(() => {});

    updateVoiceHistoryTurn(turnKey, {
      source: "chat",
      transcript: normalizeVoiceHistoryText(text, 1600),
      transcriptFinal: true,
      turnIndex: 0,
    });
    scheduleVoiceHistoryTurnTimeout(turnKey);

    try {
      await sendCloudVoiceAgentTextMessage({
        ...getCloudVoiceAgentRequestContext(),
        text,
        turnIndex: 0,
      });
      if (orchestratorVoiceRunRef.current === runId) {
        logTerminalStatus("frontend.voice_agent.text_message_sent", {
          textLength: text.length,
          workspaceId: orchestratorPanelWorkspaceId,
        });
      }
    } catch (error) {
      if (orchestratorVoiceRunRef.current !== runId) {
        return;
      }
      const message = getAudioInputErrorMessage(error, "Unable to send message to the voice agent.");
      markVoiceHistoryTurnTerminal(turnKey, "failed", message);
      orchestratorVoiceEventsActiveRef.current = false;
      setOrchestratorVoiceState("error");
      setOrchestratorVoiceError(message);
      setOrchestratorVoiceFeedback("");
      setOrchestratorChatSubmitting(false);
    }
  }, [
    clearAllVoiceHistoryTurnTimeouts,
    getCloudVoiceAgentRequestContext,
    markVoiceHistoryTurnTerminal,
    orchestratorChatDraft,
    orchestratorChatSubmitting,
    orchestratorPanelWorkspaceId,
    orchestratorVoiceState,
    resetOrchestratorFastResponseGate,
    scheduleVoiceHistoryTurnTimeout,
    updateVoiceHistoryTurn,
  ]);

  const handleOrchestratorChatKeyDown = useCallback((event) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    void handleOrchestratorChatSubmit(event);
  }, [handleOrchestratorChatSubmit]);

  const toggleOrchestratorVoiceMonitor = useCallback(() => {
    if (orchestratorVoiceState === "starting" || orchestratorVoiceState === "listening") {
      void finishOrchestratorVoiceInput();
      return;
    }

    if (orchestratorVoiceState === "processing") {
      return;
    }

    void startOrchestratorVoiceMonitor();
  }, [finishOrchestratorVoiceInput, orchestratorVoiceState, startOrchestratorVoiceMonitor]);

  const handleDraftKeyDown = useCallback((event) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    onSubmitDraft();
  }, [onSubmitDraft]);

  const handleDraftPaste = useCallback((event) => {
    const imageFiles = getTodoClipboardImageFiles(event.clipboardData);
    const note = getTodoQueueNoteFromPastedText(event.clipboardData?.getData?.("text/plain") || "");

    if (!imageFiles.length) {
      if (note) {
        event.preventDefault();
        onSubmitDraft({ note });
      }
      return;
    }

    event.preventDefault();
    logBigViewSyncDiagnosticEvent("tui.image.paste_start", {
      draftLength: normalizeTodoQueueText(draft).length,
      fileCount: imageFiles.length,
      files: imageFiles.map((file) => ({
        mimeType: String(file?.type || ""),
        name: String(file?.name || ""),
        size: Number(file?.size || 0),
      })),
      hasNote: Boolean(note),
      queueItemCount: items.length,
      surface: "tui_todo_queue",
      workspaceId,
    });
    Promise.all(imageFiles.map(readTodoImageFile))
      .then((images) => {
        const normalizedImages = dedupeTodoQueueImages(images);
        if (normalizedImages.length) {
          const createdItems = onSubmitDraft({ images: normalizedImages, note }) || [];
          logBigViewSyncDiagnosticEvent("tui.image.paste_done", {
            createdItemCount: createdItems.length,
            createdItems: getTodoQueueItemLogSummary(createdItems),
            imageCount: normalizedImages.length,
            images: getTodoImageLogSummary(normalizedImages),
            surface: "tui_todo_queue",
            workspaceId,
          });
          const firstImageItem = createdItems.find((item) => getTodoQueueItemImage(item)) || createdItems[0];

          if (firstImageItem?.id) {
            setEditingItemId(firstImageItem.id);
            setEditingDraft(normalizeTodoQueueText(firstImageItem.text));
            skipEditBlurCommitRef.current = false;
          }
        }
      })
      .catch((error) => {
        logBigViewSyncDiagnosticEvent("tui.image.paste_error", {
          fileCount: imageFiles.length,
          message: error?.message || String(error || ""),
          surface: "tui_todo_queue",
          workspaceId,
        });
      });
  }, [draft, items.length, onSubmitDraft, workspaceId]);

  const handleSubmit = useCallback((event) => {
    event.preventDefault();
    onSubmitDraft();
  }, [onSubmitDraft]);

  const beginItemEdit = useCallback((item) => {
    const text = normalizeTodoQueueText(item?.text);
    if (!item?.id || pendingItems[item.id]) {
      return;
    }

    setEditingItemId(item.id);
    setEditingDraft(text);
    skipEditBlurCommitRef.current = false;
  }, [pendingItems]);

  const clearItemEdit = useCallback(() => {
    setEditingItemId("");
    setEditingDraft("");
  }, []);

  const commitItemEdit = useCallback(() => {
    if (!editingItemId) {
      return;
    }

    onUpdateItem?.(editingItemId, editingDraft);
    skipEditBlurCommitRef.current = true;
    clearItemEdit();
  }, [clearItemEdit, editingDraft, editingItemId, onUpdateItem]);

  const handleItemEditBlur = useCallback(() => {
    if (skipEditBlurCommitRef.current) {
      skipEditBlurCommitRef.current = false;
      return;
    }

    commitItemEdit();
  }, [commitItemEdit]);

  const handleItemEditKeyDown = useCallback((event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      skipEditBlurCommitRef.current = true;
      clearItemEdit();
      return;
    }

    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }

    event.preventDefault();
    commitItemEdit();
  }, [clearItemEdit, commitItemEdit]);

  const focusDraftTextArea = useCallback(() => {
    draftTextAreaRef.current?.focus?.();
  }, []);

  const handleBoardPointerDown = useCallback((event) => {
    if (
      event.target === draftTextAreaRef.current
      || event.target?.closest?.("[data-todo-card='true']")
      || event.target?.closest?.("[data-todo-control='true']")
    ) {
      return;
    }

    event.preventDefault();
    focusDraftTextArea();
  }, [focusDraftTextArea]);

  const setTodoItemElement = useCallback((itemId, element) => {
    if (element) {
      todoItemElementsRef.current.set(itemId, element);
      return;
    }

    todoItemElementsRef.current.delete(itemId);
  }, []);

  const handlePointerDown = useCallback((event, item) => {
    if (
      event.button !== 0
      || event.detail > 1
      || editingItemId === item?.id
      || pendingItems[item?.id]
      || event.target?.closest?.("[data-todo-control='true']")
    ) {
      if (pendingItems[item?.id]) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    const text = normalizeTodoQueueText(item?.text);
    const terminalText = getTodoQueueItemTerminalText(item);
    const image = getTodoQueueItemImage(item);
    const note = getTodoQueueItemNote(item);
    const planTask = getTodoQueueItemPlanTask(item);
    const specEdit = getTodoQueueItemSpecEdit(item);
    if (!terminalText && !image && !note) {
      event.preventDefault();
      return;
    }

    const sourceRect = getPlainDomRect(event.currentTarget?.getBoundingClientRect?.());
    if (!sourceRect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    todoReorderDragRef.current = {
      itemId: item.id,
      pointerId: event.pointerId,
    };
    setReorderingItemId(item.id);
    onBeginTodoDrag?.({
      clientX: event.clientX,
      clientY: event.clientY,
      item: {
        id: item.id,
        ...(image ? { image } : {}),
        ...(note ? { note } : {}),
        ...(planTask ? { planTask } : {}),
        ...(specEdit ? { kind: TODO_QUEUE_KIND_SPEC_EDIT, specEdit } : {}),
        ...(item.source ? { source: item.source } : {}),
        text,
      },
      pointerId: event.pointerId,
      sourceRect,
      workspaceId,
    });
  }, [editingItemId, onBeginTodoDrag, pendingItems, workspaceId]);

  useEffect(() => {
    if (!editingItemId) {
      return;
    }

    const element = editingTextAreaRef.current;
    element?.focus?.();
    element?.setSelectionRange?.(editingDraft.length, editingDraft.length);
  }, [editingItemId]);

  useEffect(() => {
    if (editingItemId && !items.some((item) => item.id === editingItemId)) {
      clearItemEdit();
    }
  }, [clearItemEdit, editingItemId, items]);

  useLayoutEffect(() => {
    const listElement = todoListRef.current;

    if (!listElement || !items.length) {
      setTodoListOffset(0);
      return undefined;
    }

    const updateOffset = () => {
      const nextOffset = Math.ceil(listElement.getBoundingClientRect().height || 0);
      setTodoListOffset((currentOffset) => (
        currentOffset === nextOffset ? currentOffset : nextOffset
      ));
    };

    updateOffset();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateOffset);
      return () => window.removeEventListener("resize", updateOffset);
    }

    const observer = new ResizeObserver(updateOffset);
    observer.observe(listElement);

    return () => observer.disconnect();
  }, [activeOrchestratorSection, items.length]);

  useEffect(() => {
    if (activeWorkspaceTool !== "orchestrator") {
      void stopOrchestratorVoiceMonitor();
    }
  }, [activeWorkspaceTool, stopOrchestratorVoiceMonitor]);

  useEffect(() => () => {
    orchestratorVoiceRunRef.current += 1;
    cancelOrchestratorFastResponseGate("unmount");
    clearAllVoiceHistoryTurnTimeouts();
    orchestratorVoiceInputFinishRequestedRef.current = false;
    const monitor = orchestratorVoiceMonitorRef.current;
    orchestratorVoiceMonitorRef.current = null;
    const ttsPlayer = orchestratorVoiceTtsPlayerRef.current;
    orchestratorVoiceTtsPlayerRef.current = null;
    stopCloudVoiceAgentStream().catch(() => {});
    ttsPlayer?.close?.().catch(() => {});
    monitor?.finishCapture?.().catch(() => null);
    monitor?.close?.().catch(() => {});
    orchestratorVoiceEventsActiveRef.current = false;
  }, [cancelOrchestratorFastResponseGate, clearAllVoiceHistoryTurnTimeouts]);

  useEffect(() => {
    let disposed = false;
    let unlisten = null;

    subscribeCloudVoiceAgentEvents((event) => {
      if (disposed) {
        return;
      }

      const kind = cloudVoiceAgentEventKind(event);
      if (kind === "voice_agent_error") {
        if (!orchestratorVoiceEventsActiveRef.current) {
          return;
        }
        cancelOrchestratorFastResponseGate("error");
        const message = String(event?.error?.message || event?.message || "Cloud voice agent stopped.");
        const hasTurnIndex = event?.turn_index != null || event?.turnIndex != null;
        if (hasTurnIndex) {
          markVoiceHistoryTurnTerminal(
            getVoiceHistoryTurnKey(event, orchestratorVoiceSessionRef.current),
            "failed",
            message,
          );
        } else {
          markPendingVoiceHistoryTurnsTerminal("failed", message);
        }
        logTerminalStatus("frontend.voice_history.error_arrived", {
          code: String(event?.error?.code || event?.code || "").trim(),
          hasTurnIndex,
          message,
          workspaceId: orchestratorPanelWorkspaceId,
        });
        void stopOrchestratorVoiceMonitor().finally(() => {
          if (disposed) {
            return;
          }
          setOrchestratorVoiceState("error");
          setOrchestratorVoiceError(message);
          setOrchestratorVoiceFeedback("");
        });
        return;
      }

      if (kind === "voice_agent_stream_started") {
        if (!orchestratorVoiceEventsActiveRef.current) {
          return;
        }
        setOrchestratorVoiceError("");
        return;
      }

      if (kind === "voice_agent_transcript") {
        if (!orchestratorVoiceEventsActiveRef.current) {
          return;
        }
        recordVoiceHistoryTranscript(event);
        return;
      }

      if (
        isVoiceAgentFastResponseEvent(event)
        && !isVoiceAgentTtsEventKind(kind)
        && (kind === "voice_agent_fast_llm_feedback" || kind === "voice_agent_initial_llm_feedback" || event?.feedback)
      ) {
        if (!orchestratorVoiceEventsActiveRef.current) {
          return;
        }
        bufferOrReleaseOrchestratorFastResponseEvent(event);
        return;
      }

      if (kind === "voice_agent_llm_feedback") {
        if (!orchestratorVoiceEventsActiveRef.current) {
          return;
        }
        if (isVoiceAgentFastResponseEvent(event)) {
          bufferOrReleaseOrchestratorFastResponseEvent(event);
          return;
        }
        cancelOrchestratorFastResponseGate("llm_feedback");
        recordVoiceHistoryLlmFeedback(event);
        const feedback = String(event?.feedback || "").trim();
        if (feedback) {
          setOrchestratorVoiceFeedback(feedback);
        }
        return;
      }

      if (
        kind === "voice_agent_tts_start"
        || kind === "voice_agent_tts_audio"
        || kind === "voice_agent_tts_end"
      ) {
        if (!orchestratorVoiceEventsActiveRef.current) {
          return;
        }
        if (isVoiceAgentFastResponseEvent(event)) {
          bufferOrReleaseOrchestratorFastResponseEvent(event);
          return;
        }
        cancelOrchestratorFastResponseGate("tts");
        void orchestratorVoiceTtsPlayerRef.current?.handleEvent?.(event);
        return;
      }

      if (kind === "voice_agent_tts_error") {
        logBigViewSyncDiagnosticEvent("tui.voice_agent.tts_error", {
          message: String(event?.error?.message || event?.message || "Voice response playback failed."),
          phase: String(event?.phase || ""),
          surface: "tui_voice_agent",
          workspaceId: orchestratorPanelWorkspaceId,
        });
        return;
      }

      if (kind === "voice_agent_plan_snapshot") {
        if (!orchestratorVoiceEventsActiveRef.current) {
          return;
        }
        cancelOrchestratorFastResponseGate("plan_snapshot");
        logTerminalStatus("frontend.voice_agent.plan_snapshot_event", {
          active: Boolean(orchestratorVoiceEventsActiveRef.current),
          releasedTaskCount: getVoicePlanReleasedTasksFromPayload(event).length,
          snapshot: getVoicePlanSnapshotLogSummary(getVoicePlanSnapshotFromPayload(event)),
          workspaceId: orchestratorPanelWorkspaceId,
        });
        recordVoiceHistoryPlanSnapshot(event);
        const handledPlanResult = onVoicePlanServerResult?.(event);
        logTerminalStatus("frontend.voice_agent.plan_snapshot_routed", {
          handledPlanResult: Boolean(handledPlanResult),
          workspaceId: orchestratorPanelWorkspaceId,
        });
        const snapshot = getVoicePlanSnapshotFromPayload(event);
        if (snapshot) {
          setOrchestratorVoiceError("");
          setOrchestratorVoiceFeedback(`Plan: ${snapshot.title}`);
        }
        return;
      }

      if (kind === "voice_agent_tool_call") {
        if (!orchestratorVoiceEventsActiveRef.current) {
          logTerminalStatus("frontend.voice_agent.tool_call_ignored", {
            kind,
            reason: "orchestrator_voice_events_inactive",
            toolName: String(event?.name || event?.tool_name || event?.toolName || "").trim(),
            workspaceId: orchestratorPanelWorkspaceId,
          });
          return;
        }
        cancelOrchestratorFastResponseGate("tool_call");
        const toolName = String(event?.name || event?.tool_name || event?.toolName || "").trim();
        if (toolName === "queue" || toolName === "open_coding_agents" || toolName === "create_plan") {
          logTerminalStatus("frontend.voice_agent.tool_call_arrived", {
            toolName,
            workspaceId: orchestratorPanelWorkspaceId,
          });
          recordVoiceHistoryToolCall(event);
          onVoiceAgentToolCall?.(event);
          setOrchestratorVoiceError("");
          setOrchestratorVoiceFeedback(
            toolName === "open_coding_agents"
              ? "Opening coding agents..."
              : toolName === "create_plan"
                ? "Creating plan..."
                : "Queued voice todo.",
          );
        }
        return;
      }

      if (kind === "voice_agent_finished" && orchestratorVoiceEventsActiveRef.current) {
        cancelOrchestratorFastResponseGate("finished_event");
        markPendingVoiceHistoryTurnsTerminal(
          "failed",
          "The orchestrator stream finished before returning a final response, plan, or error.",
        );
        void completeOrchestratorVoiceSession();
      }
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten?.();
        return;
      }
      unlisten = nextUnlisten;
    }).catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    onVoiceAgentToolCall,
    bufferOrReleaseOrchestratorFastResponseEvent,
    cancelOrchestratorFastResponseGate,
    recordVoiceHistoryLlmFeedback,
    recordVoiceHistoryPlanSnapshot,
    recordVoiceHistoryToolCall,
    recordVoiceHistoryTranscript,
    onVoicePlanServerResult,
    markPendingVoiceHistoryTurnsTerminal,
    markVoiceHistoryTurnTerminal,
    completeOrchestratorVoiceSession,
    stopOrchestratorVoiceMonitor,
    orchestratorPanelWorkspaceId,
  ]);

  useEffect(() => {
    const handleVoicePlanSnapshot = (event) => {
      recordVoiceHistoryPlanSnapshot(event?.detail || {});
    };
    window.addEventListener(VOICE_PLAN_SNAPSHOT_EVENT, handleVoicePlanSnapshot);
    return () => {
      window.removeEventListener(VOICE_PLAN_SNAPSHOT_EVENT, handleVoicePlanSnapshot);
    };
  }, [recordVoiceHistoryPlanSnapshot]);

  useEffect(() => {
    const handleVoiceAgentOpenCodingAgentsResult = (event) => {
      const detail = event?.detail || {};
      const eventWorkspaceId = String(detail.workspaceId || "").trim();
      if (workspaceId && eventWorkspaceId && eventWorkspaceId !== workspaceId) {
        return;
      }

      const message = normalizeVoiceHistoryText(detail.message, 1600);
      const status = String(detail.status || "ready").trim() || "ready";
      if (!message) {
        return;
      }

      recordVoiceHistoryOpenCodingAgentsResult(detail.toolCall || detail.event || detail, message, status);
      if (status === "error") {
        setOrchestratorVoiceError(message);
        setOrchestratorVoiceFeedback("");
      } else {
        setOrchestratorVoiceError("");
        setOrchestratorVoiceFeedback(message);
      }
    };

    window.addEventListener(VOICE_AGENT_OPEN_CODING_AGENTS_RESULT_EVENT, handleVoiceAgentOpenCodingAgentsResult);
    return () => {
      window.removeEventListener(VOICE_AGENT_OPEN_CODING_AGENTS_RESULT_EVENT, handleVoiceAgentOpenCodingAgentsResult);
    };
  }, [recordVoiceHistoryOpenCodingAgentsResult, workspaceId]);

  useEffect(() => {
    const drag = todoReorderDragRef.current;
    if (!reorderingItemId || !drag) {
      return undefined;
    }

    const getTargetIndex = (clientY) => {
      const entries = items
        .map((item, index) => ({
          id: item.id,
          index,
          rect: todoItemElementsRef.current.get(item.id)?.getBoundingClientRect?.(),
        }))
        .filter((entry) => entry.rect);

      for (const entry of entries) {
        if (clientY < entry.rect.top + entry.rect.height / 2) {
          return entry.index;
        }
      }

      return entries.length;
    };

    const handlePointerMove = (event) => {
      const currentDrag = todoReorderDragRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      const boardRect = todoBoardRef.current?.getBoundingClientRect?.();
      if (!pointIsInRect(event.clientX, event.clientY, boardRect)) {
        return;
      }

      onReorderItem?.(currentDrag.itemId, getTargetIndex(event.clientY));
    };

    const endDrag = (event) => {
      const currentDrag = todoReorderDragRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      todoReorderDragRef.current = null;
      setReorderingItemId("");
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };
  }, [items, onReorderItem, reorderingItemId]);

  const orchestratorVoiceLevel = getOrchestratorVoiceLevel(orchestratorVoiceStats);
  const paneFullscreen = paneMode === TODO_QUEUE_PANE_MODE_FULLSCREEN;
  const orchestratorVoiceInputActive = orchestratorVoiceState === "starting"
    || orchestratorVoiceState === "listening";
  const orchestratorVoiceManualMode = orchestratorSubmissionMode === AUDIO_ORCHESTRATOR_SUBMISSION_MODE_MANUAL;
  const orchestratorVoiceHasSignal = orchestratorVoiceInputActive && orchestratorVoiceLevel >= 6;
  const orchestratorVoiceButtonLabel = orchestratorVoiceState === "starting"
    ? "Starting voice agent monitor"
    : orchestratorVoiceState === "listening"
      ? orchestratorVoiceManualMode
        ? "Submit voice agent input"
        : "Finish voice agent input"
      : orchestratorVoiceState === "processing"
        ? "Voice agent response in progress"
        : orchestratorVoiceError
          ? "Restart voice agent monitor"
          : "Start voice agent monitor";
  const orchestratorVoiceButtonTitle = orchestratorVoiceError
    || orchestratorVoiceFeedback
    || (orchestratorVoiceState === "starting"
      ? "Starting input"
      : orchestratorVoiceState === "listening"
        ? orchestratorVoiceManualMode ? "Submit input" : "Stop sending audio"
        : orchestratorVoiceState === "processing"
          ? "Waiting for the voice response"
          : "Start listening");
  const orchestratorVoiceCanCancel = orchestratorVoiceInputActive
    || orchestratorVoiceState === "processing"
    || orchestratorChatSubmitting;
  const orchestratorChatBusy = orchestratorChatSubmitting
    || orchestratorVoiceState === "starting"
    || orchestratorVoiceState === "listening"
    || orchestratorVoiceState === "processing";
  const orchestratorChatCanSend = Boolean(orchestratorChatDraft.trim()) && !orchestratorChatBusy;

  return (
    <TodoQueueSurface
      aria-label="Workspace tools"
      data-active-tool={activeWorkspaceTool}
      data-pane-mode={paneMode}
      data-tool-fullscreen={paneFullscreen ? "true" : undefined}
    >
      <OrchestratorTopNav aria-label="Workspace tool">
        {WORKSPACE_TOOL_TABS.map((tool) => (
          <OrchestratorTopButton
            data-active={activeWorkspaceTool === tool.id ? "true" : "false"}
            key={tool.id}
            onClick={() => setActiveWorkspaceTool(tool.id)}
            type="button"
          >
            {tool.label}
          </OrchestratorTopButton>
        ))}
      </OrchestratorTopNav>
      {activeWorkspaceTool === "plans" ? (
        <WorkspaceToolSurface data-tool="plans">
          <PlansWorkspaceView
            onResumePlan={onResumePlan}
            rootDirectory={rootDirectory}
            selectedTerminal={selectedTerminalPlanTarget}
            workspace={workspace}
          />
        </WorkspaceToolSurface>
      ) : activeWorkspaceTool === "git" ? (
        <WorkspaceToolSurface data-tool="git">
          <GitWorkspaceView
            rootDirectory={rootDirectory}
            workspace={workspace}
            workspaceError={workspaceError}
          />
        </WorkspaceToolSurface>
      ) : activeWorkspaceTool === "tokenomics" ? (
        <WorkspaceToolSurface data-tool="tokenomics">
          <AccountTokenomicsView
            accountKey={accountKey}
            billingStatus={billingStatus}
          />
        </WorkspaceToolSurface>
      ) : (
        <OrchestratorView>
          <OrchestratorVoiceArea>
            <OrchestratorVoicePaneControls aria-label="Orchestrator pane controls">
              <WorkspaceToolControlButton
                aria-label="Minimize workspace tools"
                onClick={onMinimizePane}
                title="Minimize"
                type="button"
              >
                <TitleMinimizeIcon aria-hidden="true" />
              </WorkspaceToolControlButton>
              <WorkspaceToolControlButton
                aria-label={terminalBreakoutActive ? "Exit terminal breakout canvas" : "Open terminal breakout canvas"}
                aria-pressed={terminalBreakoutActive ? "true" : "false"}
                data-active={terminalBreakoutActive ? "true" : undefined}
                onClick={onToggleTerminalBreakout}
                title={terminalBreakoutActive ? "Exit breakout" : "Breakout"}
                type="button"
              >
                <ButtonHubIcon aria-hidden="true" />
              </WorkspaceToolControlButton>
              <WorkspaceToolControlButton
                aria-label={paneFullscreen ? "Exit workspace tools big view" : "Open workspace tools big view"}
                onClick={onToggleFullscreenPane}
                title={paneFullscreen ? "Exit big view" : "Big view"}
                type="button"
              >
                {paneFullscreen ? (
                  <ButtonFullscreenExitIcon aria-hidden="true" />
                ) : (
                  <ButtonFullscreenIcon aria-hidden="true" />
                )}
              </WorkspaceToolControlButton>
            </OrchestratorVoicePaneControls>
            {orchestratorVoiceCanCancel && (
              <OrchestratorVoiceCancelButton
                aria-label="Cancel voice submission"
                onClick={cancelOrchestratorVoiceSubmission}
                title="Cancel submission"
                type="button"
              >
                <Close aria-hidden="true" />
              </OrchestratorVoiceCancelButton>
            )}
            <OrchestratorVoiceControls>
              <OrchestratorVoiceButton
                aria-label={orchestratorVoiceButtonLabel}
                data-error={orchestratorVoiceError ? "true" : undefined}
                data-monitoring={orchestratorVoiceInputActive ? "true" : undefined}
                data-starting={orchestratorVoiceState === "starting" ? "true" : undefined}
                onClick={toggleOrchestratorVoiceMonitor}
                title={orchestratorVoiceButtonTitle}
                type="button"
              >
                <OrchestratorVoiceCanvasRing
                  active={orchestratorVoiceInputActive}
                  hasSignal={orchestratorVoiceHasSignal}
                  level={orchestratorVoiceLevel}
                  stats={orchestratorVoiceStats}
                />
                <OrchestratorVoiceLogo />
              </OrchestratorVoiceButton>
            </OrchestratorVoiceControls>
          </OrchestratorVoiceArea>
          <OrchestratorSectionTabs aria-label="Orchestrator section">
            <OrchestratorSectionButton
              data-active={activeOrchestratorSection === "todo" ? "true" : "false"}
              onClick={() => setActiveOrchestratorSection("todo")}
              type="button"
            >
              Todo
            </OrchestratorSectionButton>
            <OrchestratorSectionButton
              data-active={activeOrchestratorSection === "history" ? "true" : "false"}
              onClick={() => setActiveOrchestratorSection("history")}
              type="button"
            >
              Voice History
            </OrchestratorSectionButton>
          </OrchestratorSectionTabs>
          <OrchestratorContent>
            {activeOrchestratorSection === "todo" ? (
              <TodoQueueComposer onSubmit={handleSubmit}>
                <TodoQueueBoard
                  onPointerDown={handleBoardPointerDown}
                  ref={todoBoardRef}
                  style={{ "--todo-list-offset": `${todoListOffset}px` }}
                >
                  <TodoQueueTextArea
                    aria-label="New todo"
                    maxLength={TODO_QUEUE_MAX_TEXT_LENGTH}
                    onChange={(event) => onDraftChange(event.target.value)}
                    onKeyDown={handleDraftKeyDown}
                    onPaste={handleDraftPaste}
                    placeholder="Type a todo..."
                    ref={draftTextAreaRef}
                    spellCheck="true"
                    value={draft}
                  />
                  <TodoQueueDraftBullet aria-hidden="true" />

                  {items.length > 0 && (
                    <TodoQueueList aria-label="Todo objects" ref={todoListRef} role="list">
                      {items.map((item) => {
                        const isEditing = editingItemId === item.id;
                        const pendingItem = pendingItems[item.id] || null;
                        const isPending = Boolean(pendingItem);
                        const pendingPhase = getTodoQueuePendingPhase(pendingItem);
                        const isQueued = pendingPhase === "queued";
                        const isSending = isPending && !isQueued;
                        const actionLabel = isQueued ? "Cancel queued todo" : "Queue todo";
                        const actionTitle = isQueued ? "Cancel queued send" : "Send when an agent is available";
                        const image = getTodoQueueItemImage(item);
                        const note = getTodoQueueItemNote(item);
                        const hasPreview = Boolean(image || note);
                        const targetAgentId = getTodoQueueTargetAgentId(item);
                        const targetTerminalIndex = getTodoQueueTargetTerminalIndex(item);
                        const hasTerminalTarget = Number.isInteger(targetTerminalIndex)
                          || Boolean(getTodoQueueTargetTerminalId(item))
                          || Boolean(getTodoQueueTargetThreadId(item));
                        const todoAccentColor = typeof getItemAccentColor === "function"
                          ? getItemAccentColor(item)
                          : targetAgentId
                            ? getTodoQueueAgentAccentColor(targetAgentId)
                            : "";

                        return (
                          <TodoQueueItemCard
                            data-todo-card="true"
                            data-todo-dragging={activeDragItemId === item.id ? "true" : undefined}
                            data-todo-editing={isEditing ? "true" : undefined}
                            data-todo-pending={isPending ? "true" : undefined}
                            data-todo-queued={isQueued ? "true" : undefined}
                            data-todo-reordering={reorderingItemId === item.id ? "true" : undefined}
                            data-todo-targeted={targetAgentId || hasTerminalTarget ? "true" : undefined}
                            data-todo-cancellable={isQueued ? "true" : undefined}
                            data-todo-sending={isSending ? "true" : undefined}
                            key={item.id}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              if (isPending) {
                                return;
                              }
                              beginItemEdit(item);
                            }}
                            onPointerDown={(event) => handlePointerDown(event, item)}
                            ref={(element) => setTodoItemElement(item.id, element)}
                            role="listitem"
                            style={todoAccentColor ? { "--todo-agent-color": todoAccentColor } : undefined}
                            title={
                              isQueued
                                ? hasTerminalTarget
                                  ? Number.isInteger(targetTerminalIndex)
                                    ? `Queued for terminal ${targetTerminalIndex + 1}.`
                                    : "Queued for the selected terminal."
                                  : targetAgentId
                                    ? `Queued for ${item.targetAgentLabel || targetAgentId}.`
                                    : "Queued for the next available agent."
                                : isSending
                                  ? "Sending to terminal."
                                  : "Drag into an agent terminal. Double-click to edit."
                            }
                          >
                            {!isEditing && (
                              <TodoQueueItemActionButton
                                aria-label={actionLabel}
                                data-action={isQueued ? "cancel" : "queue"}
                                data-todo-control="true"
                                data-visible={!isSending ? "true" : undefined}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (isQueued) {
                                    onCancelQueuedItem?.(item.id);
                                    return;
                                  }
                                  if (!isPending) {
                                    onQueueItem?.(item.id);
                                  }
                                }}
                                onPointerDown={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                }}
                                title={actionTitle}
                                type="button"
                              >
                                {isQueued ? <Close aria-hidden="true" /> : <AddToQueue aria-hidden="true" />}
                              </TodoQueueItemActionButton>
                            )}
                            {isPending && (
                              <TodoQueueItemPendingSpinner aria-label="Sending todo" role="img">
                                {TODO_QUEUE_PENDING_SPOKES.map((spoke) => (
                                  <span
                                    aria-hidden="true"
                                    key={spoke}
                                    style={{ "--todo-spinner-index": spoke }}
                                  />
                                ))}
                              </TodoQueueItemPendingSpinner>
                            )}
                            <TodoQueueItemContent data-has-preview={hasPreview ? "true" : "false"}>
                              {image && (
                                <TodoQueueItemImageFrame>
                                  <TodoQueueItemImage alt="" src={image.src} />
                                </TodoQueueItemImageFrame>
                              )}
                              {!image && note && (
                                <TodoQueueItemNoteFrame>
                                  <TodoQueueItemNoteTitle>{note.title}</TodoQueueItemNoteTitle>
                                  <TodoQueueItemNoteIcon aria-hidden="true" />
                                </TodoQueueItemNoteFrame>
                              )}
                              {isEditing && !isPending ? (
                                <TodoQueueItemEditor
                                  aria-label="Edit todo"
                                  data-todo-control="true"
                                  maxLength={TODO_QUEUE_MAX_TEXT_LENGTH}
                                  onBlur={handleItemEditBlur}
                                  onChange={(event) => setEditingDraft(event.target.value)}
                                  onKeyDown={handleItemEditKeyDown}
                                  ref={editingTextAreaRef}
                                  spellCheck="true"
                                  value={editingDraft}
                                />
                              ) : (
                                <TodoQueueItemText>{item.text}</TodoQueueItemText>
                              )}
                            </TodoQueueItemContent>
                            {!isEditing && !isPending && (
                              <TodoQueueDeleteButton
                                aria-label="Delete todo"
                                data-todo-control="true"
                                data-todo-delete="true"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  onRemoveItem?.(item.id);
                                }}
                                onPointerDown={(event) => {
                                  event.stopPropagation();
                                }}
                                title="Delete"
                                type="button"
                              >
                                x
                              </TodoQueueDeleteButton>
                            )}
                          </TodoQueueItemCard>
                        );
                      })}
                    </TodoQueueList>
                  )}

                  {dropError && <TodoQueueError role="alert">{dropError}</TodoQueueError>}
                </TodoQueueBoard>
              </TodoQueueComposer>
            ) : (
              <OrchestratorHistoryView aria-label="Voice history">
                <OrchestratorHistoryScroll ref={orchestratorHistoryScrollRef}>
                  {orchestratorVoiceError && (
                    <OrchestratorHistoryError role="alert">
                      <OrchestratorHistoryErrorTitle>Voice agent error</OrchestratorHistoryErrorTitle>
                      <OrchestratorHistoryErrorText>{orchestratorVoiceError}</OrchestratorHistoryErrorText>
                    </OrchestratorHistoryError>
                  )}
                  {orchestratorVoiceHistoryItems.length > 0 ? (
                    <OrchestratorHistoryList>
                      {orchestratorVoiceHistoryItems.map((item) => {
                        const status = getVoiceHistoryTurnStatus(item);
                        const cancelled = status === "Cancelled";
                        const pending = status === "Pending" || status === "Thinking";
                        const llmPending = Boolean(
                          item.transcriptFinal
                            && !item.llmFeedback
                            && !item.llmFinal
                            && !item.queued
                            && !item.plan,
                        );
                        const userCopyKey = `${item.id}:user`;
                        const assistantCopyKey = `${item.id}:assistant`;
                        const userCopied = orchestratorHistoryCopiedKey === userCopyKey;
                        const assistantCopied = orchestratorHistoryCopiedKey === assistantCopyKey;
                        const userTime = formatVoiceHistoryMessageTime(item.createdAtMs);
                        const assistantTime = formatVoiceHistoryMessageTime(item.updatedAtMs);

                        return (
                          <OrchestratorHistoryTurn
                            data-cancelled={cancelled ? "true" : undefined}
                            data-pending={pending ? "true" : undefined}
                            key={item.id}
                          >
                            {item.transcript && (
                              <OrchestratorHistoryUserMessage>
                                <OrchestratorHistoryTranscript
                                  data-cancelled={cancelled ? "true" : undefined}
                                  data-pending={pending ? "true" : undefined}
                                >
                                  {item.transcript}
                                </OrchestratorHistoryTranscript>
                                <OrchestratorHistoryMessageActions data-align="right">
                                  {cancelled && (
                                    <OrchestratorHistoryTurnStatus data-status="cancelled">
                                      Cancelled
                                    </OrchestratorHistoryTurnStatus>
                                  )}
                                  {userTime && (
                                    <OrchestratorHistoryMessageTime>{userTime}</OrchestratorHistoryMessageTime>
                                  )}
                                  <OrchestratorHistoryCopyButton
                                    aria-label={userCopied ? "Copied" : "Copy message"}
                                    data-copied={userCopied ? "true" : undefined}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      event.stopPropagation();
                                      void handleOrchestratorHistoryCopy(userCopyKey, item.transcript);
                                    }}
                                    title={userCopied ? "Copied" : "Copy"}
                                    type="button"
                                  >
                                    {userCopied ? (
                                      <OrchestratorHistoryCopiedIcon aria-hidden="true" />
                                    ) : (
                                      <OrchestratorHistoryCopyIcon aria-hidden="true" />
                                    )}
                                  </OrchestratorHistoryCopyButton>
                                </OrchestratorHistoryMessageActions>
                              </OrchestratorHistoryUserMessage>
                            )}
                            {(item.llmFeedback || llmPending) && (
                              <OrchestratorHistoryAssistantMessage>
                                <OrchestratorHistoryLlm>
                                  <OrchestratorHistoryLlmText>
                                    {item.llmFeedback || (
                                      <OrchestratorHistoryPendingLine aria-label="Waiting for orchestrator response" role="status">
                                        <OrchestratorHistoryInlineSpinner aria-hidden="true" />
                                      </OrchestratorHistoryPendingLine>
                                    )}
                                  </OrchestratorHistoryLlmText>
                                </OrchestratorHistoryLlm>
                                {item.llmFeedback && (
                                  <OrchestratorHistoryMessageActions data-align="left">
                                    {assistantTime && (
                                      <OrchestratorHistoryMessageTime>{assistantTime}</OrchestratorHistoryMessageTime>
                                    )}
                                    <OrchestratorHistoryCopyButton
                                      aria-label={assistantCopied ? "Copied" : "Copy response"}
                                      data-copied={assistantCopied ? "true" : undefined}
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void handleOrchestratorHistoryCopy(assistantCopyKey, item.llmFeedback);
                                      }}
                                      title={assistantCopied ? "Copied" : "Copy"}
                                      type="button"
                                    >
                                      {assistantCopied ? (
                                        <OrchestratorHistoryCopiedIcon aria-hidden="true" />
                                      ) : (
                                        <OrchestratorHistoryCopyIcon aria-hidden="true" />
                                      )}
                                    </OrchestratorHistoryCopyButton>
                                  </OrchestratorHistoryMessageActions>
                                )}
                              </OrchestratorHistoryAssistantMessage>
                            )}
                            {item.plan && (
                              <OrchestratorHistoryPlan>
                                <OrchestratorHistoryPlanHeader>
                                  <OrchestratorHistoryPlanTitle>{item.plan.title}</OrchestratorHistoryPlanTitle>
                                  <OrchestratorHistoryPlanStatus>
                                    {getVoicePlanStatusLabel(item.plan)}
                                  </OrchestratorHistoryPlanStatus>
                                </OrchestratorHistoryPlanHeader>
                                {item.plan.steps.length > 0 && (
                                  <OrchestratorHistoryPlanSteps>
                                    {item.plan.steps.map((step) => {
                                      const isActiveStep = Number(step.ordinal) === Number(item.plan.currentStepOrdinal);
                                      const activeStage = isActiveStep ? item.plan.currentStage : "";
                                      const renderStage = (stageName, stageLabel, stageStatus, tasks, policy, doneWhen) => {
                                        const normalizedStageStatus = String(stageStatus || "").trim().toLowerCase();
                                        if (!tasks.length && !stageStatus) {
                                          return null;
                                        }
                                        if (!tasks.length && (normalizedStageStatus === "draft" || normalizedStageStatus === "planned")) {
                                          return null;
                                        }
                                        const isActiveStage = isActiveStep && activeStage === stageName;
                                        return (
                                          <OrchestratorHistoryPlanStage key={stageName}>
                                            <OrchestratorHistoryPlanStageHeader data-active={isActiveStage ? "true" : undefined}>
                                              <span>{getVoicePlanStageLabel(stageLabel, policy, doneWhen)}</span>
                                              <span>{stageStatus || "waiting"}</span>
                                            </OrchestratorHistoryPlanStageHeader>
                                            {tasks.length > 0 && (
                                              <OrchestratorHistoryPlanTaskList>
                                                {tasks.map((task) => (
                                                  <OrchestratorHistoryPlanTask key={task.id || `${stageName}-${task.ordinal}`}>
                                                    <span>{getVoicePlanTaskStatusLabel(task)}</span>
                                                    <div title={task.text}>{task.title || task.text}</div>
                                                  </OrchestratorHistoryPlanTask>
                                                ))}
                                              </OrchestratorHistoryPlanTaskList>
                                            )}
                                          </OrchestratorHistoryPlanStage>
                                        );
                                      };

                                      return (
                                        <OrchestratorHistoryPlanStep
                                          data-active={isActiveStep ? "true" : undefined}
                                          key={step.ordinal}
                                        >
                                          <OrchestratorHistoryPlanStepTitle>
                                            {step.ordinal + 1}. {step.title}
                                          </OrchestratorHistoryPlanStepTitle>
                                          {renderStage("execution", "Execution", step.executionStatus, step.executionTasks, step.executionPolicy, step.executionDoneWhen)}
                                          {renderStage("revision", "Revision", step.revisionStatus, step.revisionTasks, step.revisionPolicy, step.revisionDoneWhen)}
                                        </OrchestratorHistoryPlanStep>
                                      );
                                    })}
                                  </OrchestratorHistoryPlanSteps>
                                )}
                              </OrchestratorHistoryPlan>
                            )}
                          </OrchestratorHistoryTurn>
                        );
                      })}
                    </OrchestratorHistoryList>
                  ) : (
                    <OrchestratorHistoryEmpty>Voice history</OrchestratorHistoryEmpty>
                  )}
                </OrchestratorHistoryScroll>
                <OrchestratorHistoryComposer onSubmit={handleOrchestratorChatSubmit}>
                  <OrchestratorHistoryInputFrame>
                    <OrchestratorHistoryInput
                      aria-label="Message orchestrator"
                      disabled={orchestratorChatBusy}
                      maxLength={12000}
                      onChange={(event) => setOrchestratorChatDraft(event.target.value)}
                      onKeyDown={handleOrchestratorChatKeyDown}
                      placeholder="Message orchestrator"
                      rows={1}
                      spellCheck="true"
                      value={orchestratorChatDraft}
                    />
                    <OrchestratorHistorySendButton
                      aria-label="Send message"
                      data-animated={orchestratorChatSubmitting ? "true" : undefined}
                      data-ready={orchestratorChatCanSend ? "true" : undefined}
                      disabled={!orchestratorChatCanSend}
                      type="submit"
                    >
                      <OrchestratorHistorySendIcon aria-hidden="true" />
                    </OrchestratorHistorySendButton>
                  </OrchestratorHistoryInputFrame>
                </OrchestratorHistoryComposer>
              </OrchestratorHistoryView>
            )}
          </OrchestratorContent>
        </OrchestratorView>
      )}
    </TodoQueueSurface>
  );
});

function TerminalView({
  accountKey = "",
  billingStatus = null,
  defaultWorkingDirectory = "",
  terminalWorkspace,
  terminalAgentsByIndex = {},
  terminalRolesByIndex = {},
  terminalThreadsByIndex = {},
  terminalWorkspaceCoordinationTargets = [],
  terminalWorkspaceRootWasEmptyAtSelection = false,
  terminalWorkspaceWorkingDirectory,
  terminalWorkspaceLogicalIndexes,
  terminalWorkspaceLogicalTerminalCount,
  agentStatusError,
  agentStatuses,
  agentStatusState,
  addWorkspaceTerminal,
  changeWorkspaceTerminalRole,
  closeWorkspaceTerminal,
  createWorkspaceThreadTerminal,
  createFirstWorkspace,
  chooseNewWorkspaceRootDirectory = () => {},
  handlePreparedTerminalChange,
  isAppClosing = false,
  isWorkspaceRuntimeVisible = true,
  isWorkspaceRuntimeDeactivating = false,
  manageWorkspaceAgents,
  onOpenWorkspaceSettings,
  onArchiveWorkspaceThread,
  onSelectWorkspaceThread,
  onToggleWorkspaceThreadPinned,
  onWorkspaceThreadsViewStateChange,
  onThreadTerminalLifecycle,
  refreshAgentStatuses,
  reorderWorkspaceTerminalDisplayLayout,
  setWorkspaceName,
  newWorkspaceRootDraft = "",
  shouldPrewarmWorkspaceTerminals,
  shouldShowWorkspaceSetup,
  showSettingsView,
  splitWorkspaceTerminal,
  terminalDisplayRows,
  viewMotion,
  workspaceAgentLaunchEpoch,
  workspaceError,
  workspaceName,
  workspaceSyncState,
  workspaceThreadRestoreReady = true,
  workspaceTerminalAgentLaunchReady,
  workspaceTerminalRenderAgent,
  workspaceThreads = {},
  workspaces = [],
  useDefaultNewWorkspaceRoot = () => {},
}) {
  const hasWorkspaceTerminals = Boolean(terminalWorkspace);
  const terminalStartupReady = Boolean(
    workspaceThreadRestoreReady
      && isWorkspaceRuntimeVisible
      && !isAppClosing
      && !isWorkspaceRuntimeDeactivating,
  );
  const logicalTerminalIndexes = Array.isArray(terminalWorkspaceLogicalIndexes)
    ? terminalWorkspaceLogicalIndexes
    : [];
  const logicalTerminalIndexSignature = logicalTerminalIndexes.join(",");
  const normalizedTerminalWorkspaceCoordinationTargets = useMemo(
    () => normalizeTerminalCoordinationTargets(terminalWorkspaceCoordinationTargets),
    [terminalWorkspaceCoordinationTargets],
  );
  const getTerminalProjectTarget = useCallback((terminalIndex) => (
    terminalCoordinationTargetForIndex(
      normalizedTerminalWorkspaceCoordinationTargets,
      logicalTerminalIndexes,
      terminalIndex,
      terminalWorkspaceWorkingDirectory || defaultWorkingDirectory || "",
    )
  ), [
    defaultWorkingDirectory,
    logicalTerminalIndexes,
    normalizedTerminalWorkspaceCoordinationTargets,
    terminalWorkspaceWorkingDirectory,
  ]);
  const displayTerminalRows = Array.isArray(terminalDisplayRows)
    ? terminalDisplayRows
    : [];
  const hasVisibleWorkspaceTerminalPanes = hasWorkspaceTerminals && displayTerminalRows.length > 0;
  const [activeTerminalPaneId, setActiveTerminalPaneId] = useState("");
  const [fullscreenTerminalIndex, setFullscreenTerminalIndex] = useState(null);
  const [fullscreenMotion, setFullscreenMotion] = useState(TERMINAL_FULLSCREEN_DEFAULT_MOTION);
  const [terminalLayoutRects, setTerminalLayoutRects] = useState({});
  const [terminalPanelRect, setTerminalPanelRect] = useState(null);
  const [terminalDragState, setTerminalDragState] = useState(null);
  const [terminalBreakoutPhase, setTerminalBreakoutPhase] = useState(TERMINAL_BREAKOUT_PHASE_GRID);
  const [terminalBreakoutPlacements, setTerminalBreakoutPlacements] = useState({});
  const [terminalBreakoutViewport, setTerminalBreakoutViewport] = useState(TERMINAL_BREAKOUT_DEFAULT_VIEWPORT);
  const [terminalBreakoutPanning, setTerminalBreakoutPanning] = useState(false);
  const activeDisplayRows = terminalDragState?.previewRows || displayTerminalRows;
  const activeDisplayRowsSignature = serializeTerminalRows(activeDisplayRows);
  const terminalDragActive = Boolean(terminalDragState);
  const fullscreenActive = Number.isInteger(fullscreenTerminalIndex)
    && logicalTerminalIndexes.includes(fullscreenTerminalIndex);
  const terminalBreakoutVisible = terminalBreakoutPhase !== TERMINAL_BREAKOUT_PHASE_GRID;
  const terminalBreakoutLayoutActive = terminalBreakoutPhase === TERMINAL_BREAKOUT_PHASE_BREAKING_OUT
    || terminalBreakoutPhase === TERMINAL_BREAKOUT_PHASE_CANVAS;
  const [todoDragState, setTodoDragState] = useState(null);
  const [todoDropError, setTodoDropError] = useState("");
  const todoDragActive = Boolean(todoDragState);
  const [workspaceFileDragState, setWorkspaceFileDragState] = useState(null);
  const workspaceFileDragActive = Boolean(workspaceFileDragState);
  const [todoQueueDraft, setTodoQueueDraft] = useState("");
  const [todoQueueItems, setTodoQueueItems] = useState([]);
  const [todoQueuePendingItems, setTodoQueuePendingItems] = useState({});
  const [todoQueueDispatchRevision, setTodoQueueDispatchRevision] = useState(0);
  const [todoQueuePaneMode, setTodoQueuePaneMode] = useState(TODO_QUEUE_PANE_MODE_NORMAL);
  const [terminalWorkspaceMainWidth, setTerminalWorkspaceMainWidth] = useState(0);
  const todoQueueVisible = Boolean(
    hasVisibleWorkspaceTerminalPanes
    && terminalWorkspaceMainWidth >= TODO_QUEUE_VISIBLE_MIN_WIDTH,
  );
  const todoQueuePaneMinimized = todoQueuePaneMode === TODO_QUEUE_PANE_MODE_MINIMIZED;
  const todoQueuePaneFullscreen = todoQueuePaneMode === TODO_QUEUE_PANE_MODE_FULLSCREEN;
  const todoQueueMinimizedSize = terminalWorkspaceMainWidth > 0
    ? Math.min(4, Math.max(2.8, (TODO_QUEUE_MINIMIZED_WIDTH_PX / terminalWorkspaceMainWidth) * 100))
    : 3.2;
  const todoQueueRestoredMinSize = terminalWorkspaceMainWidth > 0
    ? Math.min(70, Math.max(20, (TODO_QUEUE_RESTORED_MIN_WIDTH_PX / terminalWorkspaceMainWidth) * 100))
    : 20;
  const todoQueuePanelSize = todoQueuePaneMinimized
    ? todoQueueMinimizedSize
    : todoQueuePaneFullscreen
      ? 62
      : Math.max(30, todoQueueRestoredMinSize);
  const terminalGridPanelSize = 100 - todoQueuePanelSize;
  const todoQueuePanelMinSize = todoQueuePaneMinimized ? todoQueueMinimizedSize : todoQueueRestoredMinSize;
  const todoQueuePanelMaxSize = todoQueuePaneMinimized ? todoQueueMinimizedSize : 70;
  const terminalGridPanelMinSize = todoQueuePaneMinimized ? 72 : 30;
  const fullscreenTransitionTimerRef = useRef(0);
  const terminalBreakoutTransitionTimerRef = useRef(0);
  const terminalBreakoutPanStateRef = useRef(null);
  const terminalBreakoutBackgroundCanvasRef = useRef(null);
  const terminalBreakoutHoldDragRef = useRef(null);
  const terminalBreakoutPlacementsRef = useRef({});
  const terminalBreakoutPhaseRef = useRef(TERMINAL_BREAKOUT_PHASE_GRID);
  const terminalBreakoutViewportRef = useRef(TERMINAL_BREAKOUT_DEFAULT_VIEWPORT);
  const layoutMeasureFrameRef = useRef(0);
  const terminalDragStateRef = useRef(null);
  const terminalLayoutRectsRef = useRef({});
  const terminalPanelRectRef = useRef(null);
  const terminalGridPanelRef = useRef(null);
  const terminalWorkspaceMainRef = useRef(null);
  const terminalPanelsRef = useRef(null);
  const todoQueuePanelRef = useRef(null);
  const todoDragStateRef = useRef(null);
  const todoQueueDispatchingRef = useRef(false);
  const todoQueueItemsRef = useRef([]);
  const todoQueuePendingItemsRef = useRef({});
  const todoQueuePendingTimersRef = useRef(new Map());
  const todoQueueRemoteCommandReceiptsRef = useRef({});
  const todoQueueRemoteCommandReceiptStorageKeyRef = useRef("");
  const todoQueueTerminalInFlightPromptsRef = useRef(new Map());
  const todoQueueLiveTerminalsRef = useRef(new Map());
  const todoQueueTerminalReservationsRef = useRef(new Map());
  const todoQueueTerminalResumeLocksRef = useRef(new Map());
  const voiceAgentToolCallIdsRef = useRef(new Set());
  const voicePlanDeferredTasksRef = useRef(new Map());
  const voicePlanSnapshotsRef = useRef(new Map());
  const workspaceFileDragStateRef = useRef(null);
  const todoQueueStorageKeyRef = useRef("");
  const todoQueueStorageKey = useMemo(
    () => getTodoQueueStorageKey(terminalWorkspace?.id),
    [terminalWorkspace?.id],
  );
  const terminalBreakoutStorageKey = useMemo(
    () => getTerminalBreakoutStorageKey(terminalWorkspace?.id),
    [terminalWorkspace?.id],
  );
  const todoQueueRemoteCommandReceiptStorageKey = useMemo(
    () => getTodoQueueRemoteCommandReceiptStorageKey(terminalWorkspace?.id),
    [terminalWorkspace?.id],
  );
  todoQueueItemsRef.current = todoQueueItems;
  terminalBreakoutPhaseRef.current = terminalBreakoutPhase;
  terminalBreakoutPlacementsRef.current = terminalBreakoutPlacements;
  terminalBreakoutViewportRef.current = terminalBreakoutViewport;
  todoQueueStorageKeyRef.current = todoQueueStorageKey;
  todoQueueRemoteCommandReceiptStorageKeyRef.current = todoQueueRemoteCommandReceiptStorageKey;
  const visibleTodoQueueItems = useMemo(() => (
    todoQueueItems.filter((item) => {
      const pendingItem = todoQueuePendingItems[item.id] || null;
      if (pendingItem && getTodoQueuePendingPhase(pendingItem) !== "queued") {
        return false;
      }
      const queueState = normalizeTodoQueuePersistedQueueState(item);
      return !queueState || queueState.phase === "queued";
    })
  ), [todoQueueItems, todoQueuePendingItems]);

  const replaceTodoQueuePendingItems = useCallback((nextPendingItems) => {
    const normalizedPendingItems = nextPendingItems && typeof nextPendingItems === "object"
      ? nextPendingItems
      : {};
    todoQueuePendingItemsRef.current = normalizedPendingItems;
    setTodoQueuePendingItems(normalizedPendingItems);
  }, []);

  useEffect(() => {
    const receipts = readTodoQueueRemoteCommandReceipts(todoQueueRemoteCommandReceiptStorageKey);
    todoQueueRemoteCommandReceiptsRef.current = receipts;
    writeTodoQueueRemoteCommandReceipts(todoQueueRemoteCommandReceiptStorageKey, receipts);
  }, [todoQueueRemoteCommandReceiptStorageKey]);

  useEffect(() => {
    const layout = readTerminalBreakoutLayout(terminalBreakoutStorageKey, logicalTerminalIndexes);
    terminalBreakoutPlacementsRef.current = layout.placements;
    terminalBreakoutViewportRef.current = layout.viewport;
    setTerminalBreakoutPlacements(layout.placements);
    setTerminalBreakoutViewport(layout.viewport);
    setTerminalBreakoutPhase(TERMINAL_BREAKOUT_PHASE_GRID);
    setTerminalBreakoutPanning(false);
  }, [terminalBreakoutStorageKey]);

  useEffect(() => {
    setTerminalBreakoutPlacements((currentPlacements) => {
      const normalizedPlacements = normalizeBreakoutPlacements(currentPlacements, logicalTerminalIndexes);
      const missingPlacement = logicalTerminalIndexes.some((terminalIndex) => !normalizedPlacements[terminalIndex]);
      const currentPhase = terminalBreakoutPhaseRef.current;
      const shouldFillMissing = missingPlacement
        && (
          currentPhase === TERMINAL_BREAKOUT_PHASE_BREAKING_OUT
          || currentPhase === TERMINAL_BREAKOUT_PHASE_CANVAS
        );
      const nextPlacements = shouldFillMissing
        ? buildSpreadBreakoutPlacements({
          existingPlacements: normalizedPlacements,
          panelRect: terminalPanelRectRef.current,
          preserveExisting: true,
          rects: terminalLayoutRectsRef.current,
          terminalIndexes: logicalTerminalIndexes,
        }).placements
        : normalizedPlacements;

      terminalBreakoutPlacementsRef.current = nextPlacements;
      return nextPlacements;
    });
  }, [logicalTerminalIndexSignature]);

  useEffect(() => {
    writeTerminalBreakoutLayout(terminalBreakoutStorageKey, {
      placements: terminalBreakoutPlacements,
      viewport: terminalBreakoutViewport,
    });
  }, [terminalBreakoutPlacements, terminalBreakoutStorageKey, terminalBreakoutViewport]);

  const recordTodoQueueRemoteCommandReceipt = useCallback((item, status, fields = {}) => {
    const workspaceId = String(fields.workspaceId || item?.workspaceId || terminalWorkspace?.id || "").trim();
    const receiptKey = getTodoQueueRemoteCommandReceiptKey(item, workspaceId);
    if (!receiptKey) {
      return "";
    }

    const nowMs = Date.now();
    const currentReceipts = pruneTodoQueueRemoteCommandReceipts(todoQueueRemoteCommandReceiptsRef.current, nowMs);
    const existingReceipt = currentReceipts[receiptKey] || null;
    const nextReceipt = {
      commandId: getTodoQueueRemoteCommandId(item),
      itemId: String(item?.id || item?.itemId || existingReceipt?.itemId || ""),
      receivedAtMs: Number(existingReceipt?.receivedAtMs || nowMs),
      status: normalizeTodoQueueRemoteCommandReceiptStatus(status),
      text: normalizeTodoQueueText(item?.text || existingReceipt?.text || "").slice(0, 180),
      updatedAtMs: nowMs,
      workspaceId,
    };
    const nextReceipts = pruneTodoQueueRemoteCommandReceipts({
      ...currentReceipts,
      [receiptKey]: nextReceipt,
    }, nowMs);
    todoQueueRemoteCommandReceiptsRef.current = nextReceipts;
    writeTodoQueueRemoteCommandReceipts(
      todoQueueRemoteCommandReceiptStorageKeyRef.current,
      nextReceipts,
    );
    return receiptKey;
  }, [terminalWorkspace?.id]);

  const updateWorkspaceFileDragState = useCallback((nextState) => {
    workspaceFileDragStateRef.current = nextState || null;
    setWorkspaceFileDragState(nextState || null);
  }, []);
  const getTerminalAgent = useCallback((terminalIndex) => (
    Object.prototype.hasOwnProperty.call(terminalAgentsByIndex, terminalIndex)
      ? terminalAgentsByIndex[terminalIndex]
      : workspaceTerminalRenderAgent
  ), [terminalAgentsByIndex, workspaceTerminalRenderAgent]);
  const getTerminalRole = useCallback((terminalIndex) => (
    terminalRolesByIndex[terminalIndex] || getTerminalAgent(terminalIndex)?.id || ""
  ), [getTerminalAgent, terminalRolesByIndex]);
  const getTerminalThread = useCallback((terminalIndex) => (
    terminalThreadsByIndex[terminalIndex] || null
  ), [terminalThreadsByIndex]);
  const getTerminalPaneId = useCallback((terminalIndex) => {
    const role = getTerminalRole(terminalIndex);
    const agent = getTerminalAgent(terminalIndex);
    const paneAgentId = String(role || "").toLowerCase() === "generic"
      ? "generic"
      : agent?.id;

    return getWorkspaceTerminalPaneId(terminalWorkspace?.id, terminalIndex, paneAgentId);
  }, [getTerminalAgent, getTerminalRole, terminalWorkspace?.id]);
  const getTodoQueueItemAccentColor = useCallback((item) => {
    const targetTerminalId = getTodoQueueTargetTerminalId(item);
    const targetThreadId = getTodoQueueTargetThreadId(item);
    const targetTerminalIndex = getTodoQueueTargetTerminalIndex(item);
    const targetColorSlot = getTodoQueueTargetColorSlot(item);
    const hasTerminalTarget = Boolean(
      targetTerminalId
      || targetThreadId
      || Number.isInteger(targetTerminalIndex)
    );

    if (hasTerminalTarget) {
      const identityMatchedIndex = (targetTerminalId || targetThreadId)
        ? logicalTerminalIndexes.find((terminalIndex) => todoQueueSendTargetMatchesIdentity({
          paneId: getTerminalPaneId(terminalIndex),
          targetThread: getTerminalThread(terminalIndex),
        }, targetTerminalId, targetThreadId))
        : null;
      const liveTerminalIndex = Number.isInteger(identityMatchedIndex)
        ? identityMatchedIndex
        : Number.isInteger(targetTerminalIndex) && logicalTerminalIndexes.includes(targetTerminalIndex)
          ? targetTerminalIndex
          : null;
      if (Number.isInteger(liveTerminalIndex)) {
        return terminalColorForSlot(getTerminalAgentColorSlot(liveTerminalIndex));
      }

      return getTodoQueueTargetTerminalColor(item)
        || (Number.isInteger(targetColorSlot) ? terminalColorForSlot(targetColorSlot) : "")
        || (Number.isInteger(targetTerminalIndex) ? terminalColorForSlot(targetTerminalIndex) : "")
        || TODO_QUEUE_DEFAULT_DOT_COLOR;
    }

    const targetAgentId = getTodoQueueTargetAgentId(item);
    return targetAgentId ? getTodoQueueAgentAccentColor(targetAgentId) : "";
  }, [getTerminalPaneId, getTerminalThread, logicalTerminalIndexes]);
  const getTerminalImageInputSupport = useCallback((terminalIndex) => (
    (() => {
      const role = getTerminalRole(terminalIndex);
      const thread = getTerminalThread(terminalIndex);
      return resolveTodoImageInputSupport({
      agent: getTerminalAgent(terminalIndex),
      agentStatuses,
        providerBinding: getWorkspaceThreadProviderBinding(thread, role),
        role,
      });
    })()
  ), [agentStatuses, getTerminalAgent, getTerminalRole, getTerminalThread]);
  const getTerminalTodoDropUnsupportedMessage = useCallback((terminalIndex) => {
    const image = getTodoQueueItemImage(todoDragState);
    if (!image) {
      return "";
    }

    const capability = getTerminalImageInputSupport(terminalIndex);
    return capability?.supported ? "" : getTodoImageUnsupportedDropMessage(capability);
  }, [getTerminalImageInputSupport, todoDragState]);
  const getTerminalHitTestRects = useCallback(() => {
    const currentPhase = terminalBreakoutPhaseRef.current;
    const shouldUseBreakoutRects = currentPhase === TERMINAL_BREAKOUT_PHASE_BREAKING_OUT
      || currentPhase === TERMINAL_BREAKOUT_PHASE_CANVAS;

    if (!shouldUseBreakoutRects) {
      return terminalLayoutRectsRef.current;
    }

    const viewport = terminalBreakoutViewportRef.current;
    const placements = terminalBreakoutPlacementsRef.current;
    const nextRects = {};

    logicalTerminalIndexes.forEach((terminalIndex) => {
      const screenRect = getBreakoutScreenRect(placements?.[terminalIndex], viewport);
      if (screenRect) {
        nextRects[terminalIndex] = {
          height: screenRect.height,
          left: screenRect.left,
          top: screenRect.top,
          width: screenRect.width,
        };
      }
    });

    return Object.keys(nextRects).length ? nextRects : terminalLayoutRectsRef.current;
  }, [logicalTerminalIndexes]);
  const resolveTerminalDropTarget = useCallback((clientX, clientY) => {
    const containerRect = terminalPanelsRef.current?.getBoundingClientRect?.();
    if (!containerRect) {
      return null;
    }

    return getTodoDropTargetFromPoint({
      clientX,
      clientY,
      containerRect,
      fullscreenTerminalIndex: fullscreenActive ? fullscreenTerminalIndex : null,
      rects: getTerminalHitTestRects(),
      terminalIndexes: logicalTerminalIndexes,
    });
  }, [fullscreenActive, fullscreenTerminalIndex, getTerminalHitTestRects, logicalTerminalIndexes]);
  const queueWorkspaceFileForTerminalIndex = useCallback((workspaceFile, targetTerminalIndex, source = "fileviewer_global_drop") => {
    if (!Number.isInteger(targetTerminalIndex)) {
      logFileDragDiagnosticEvent("terminal_grid.drop_skip", {
        reason: "missing_target_terminal",
        source,
        workspaceId: terminalWorkspace?.id || "",
      });
      return false;
    }

    const paneId = getTerminalPaneId(targetTerminalIndex);
    const targetRole = String(getTerminalRole(targetTerminalIndex) || "").toLowerCase();
    const targetThread = getTerminalThread(targetTerminalIndex);
    const targetProviderBinding = getWorkspaceThreadProviderBinding(targetThread, targetRole);
    const targetBinding = targetProviderBinding?.terminalBinding || targetThread?.terminalBinding || null;
    const syncKey = getThreadComposerSyncKey(targetThread, {
      ...targetBinding,
      paneId: targetBinding?.paneId || paneId,
    });
    const attachment = workspaceFileToComposerAttachment(workspaceFile, source);

    logFileDragDiagnosticEvent("terminal_grid.drop_resolved", {
      attachmentCreated: Boolean(attachment),
      hasPaneId: Boolean(paneId),
      hasSyncKey: Boolean(syncKey),
      paneId,
      relativePath: workspaceFile?.relativePath || attachment?.relativePath || "",
      source,
      targetRole,
      targetTerminalIndex,
      threadId: targetThread?.id || "",
      workspaceId: terminalWorkspace?.id || "",
    });

    if (!attachment || !syncKey) {
      logFileDragDiagnosticEvent("terminal_grid.drop_skip", {
        attachmentCreated: Boolean(attachment),
        hasSyncKey: Boolean(syncKey),
        paneId,
        reason: !attachment ? "missing_attachment" : "missing_sync_key",
        source,
        targetTerminalIndex,
        threadId: targetThread?.id || "",
        workspaceId: terminalWorkspace?.id || "",
      });
      return false;
    }

    setActiveTerminalPaneId(paneId);
    window.dispatchEvent(new CustomEvent(TERMINAL_FOCUS_REQUEST_EVENT, {
      detail: {
        paneId,
        reason: "fileviewer_drop",
        terminalIndex: targetTerminalIndex,
      },
    }));
    appendWorkspaceThreadComposerAttachments(syncKey, [attachment], {
      fields: {
        paneId,
        relativePath: attachment.relativePath || "",
        source,
        surface: "terminal_grid",
        targetRole,
        targetTerminalIndex,
        threadId: targetThread?.id || "",
        workspaceId: terminalWorkspace?.id || "",
      },
      source,
    });
    logFileDragDiagnosticEvent("terminal_grid.attachment_appended", {
      attachmentName: attachment.name,
      attachmentPath: attachment.savedPath,
      kind: attachment.kind,
      paneId,
      relativePath: attachment.relativePath || "",
      source,
      syncKey,
      targetTerminalIndex,
      threadId: targetThread?.id || "",
      workspaceId: terminalWorkspace?.id || "",
    });
    return true;
  }, [
    getTerminalPaneId,
    getTerminalRole,
    getTerminalThread,
    terminalWorkspace?.id,
  ]);
  const handleBeginWorkspaceFileDrag = useCallback((drag = {}) => {
    const file = drag.file && typeof drag.file === "object" ? drag.file : null;
    if (!file) {
      return;
    }

    const width = Math.max(220, Number(drag.width || 0));
    const height = Math.max(36, Number(drag.height || 0));
    const offsetX = Math.max(12, Math.min(width - 4, Number(drag.offsetX || width / 2)));
    const offsetY = Math.max(8, Math.min(height - 4, Number(drag.offsetY || height / 2)));
    setActiveWorkspaceFileDrag(file);
    updateWorkspaceFileDragState({
      file,
      height,
      offsetX,
      offsetY,
      pointerId: drag.pointerId,
      targetTerminalIndex: resolveTerminalDropTarget(Number(drag.clientX || 0), Number(drag.clientY || 0)),
      width,
      x: Number(drag.clientX || 0) - offsetX,
      y: Number(drag.clientY || 0) - offsetY,
    });
    logFileDragDiagnosticEvent("fileviewer.pointer_drag_state_start", {
      clientX: Number(drag.clientX || 0),
      clientY: Number(drag.clientY || 0),
      name: file.name || "",
      relativePath: file.relativePath || "",
      workspaceId: file.workspaceId || terminalWorkspace?.id || "",
    });
  }, [resolveTerminalDropTarget, terminalWorkspace?.id, updateWorkspaceFileDragState]);
  const visibleTerminalPaneIds = useMemo(() => (
    terminalWorkspace
      ? logicalTerminalIndexes.map((terminalIndex) => getTerminalPaneId(terminalIndex))
      : []
  ), [getTerminalPaneId, logicalTerminalIndexes, terminalWorkspace]);
  const visibleTerminalPaneIdSignature = visibleTerminalPaneIds.join("|");
  const activePaneId = activeTerminalPaneId || visibleTerminalPaneIds[0] || "";
  const workspaceThreadEntry = terminalWorkspace
    ? workspaceThreads?.[terminalWorkspace.id] || null
    : null;
  const selectedWorkspaceThreadId = workspaceThreadEntry?.threadsView?.selectedThreadId
    || workspaceThreadEntry?.activeThreadId
    || "";
  const resolveTodoQueueLiveTerminal = useCallback((terminalIndex, paneIdOverride = "") => {
    const normalizedIndex = Number(terminalIndex);
    if (!Number.isInteger(normalizedIndex)) {
      return {
        liveTerminal: null,
        liveTerminalSource: "",
        runtimeTerminal: null,
        workspaceLiveTerminal: null,
      };
    }

    const paneId = String(paneIdOverride || getTerminalPaneId(normalizedIndex) || "").trim();
    const workspaceLiveTerminal = Object.values(workspaceThreadEntry?.terminals || {}).find((candidate) => {
      const candidateIndex = Number(candidate?.terminalIndex);
      return Number.isInteger(candidateIndex)
        ? candidateIndex === normalizedIndex
        : String(candidate?.paneId || "").trim() === paneId;
    }) || null;
    const runtimeCandidate = todoQueueLiveTerminalsRef.current.get(normalizedIndex) || null;
    const runtimePaneId = String(runtimeCandidate?.paneId || "").trim();
    const runtimeTerminal = runtimeCandidate && (!paneId || !runtimePaneId || runtimePaneId === paneId)
      ? runtimeCandidate
      : null;
    if (!workspaceLiveTerminal && !runtimeTerminal) {
      return {
        liveTerminal: null,
        liveTerminalSource: "",
        runtimeTerminal,
        workspaceLiveTerminal,
      };
    }

    const configuredThread = getTerminalThread(normalizedIndex);
    const workspaceStatus = String(workspaceLiveTerminal?.status || "").trim().toLowerCase();
    const runtimeStatus = String(runtimeTerminal?.status || "").trim().toLowerCase();
    const workspaceActivityStatus = String(
      workspaceLiveTerminal?.activityStatus
        || workspaceLiveTerminal?.activity_status
        || configuredThread?.activityStatus
        || "",
    ).trim().toLowerCase();
    const runtimeActivityStatus = String(
      runtimeTerminal?.activityStatus
        || runtimeTerminal?.activity_status
        || "",
    ).trim().toLowerCase();
    const workspaceInputReadyAt = workspaceLiveTerminal?.inputReadyAt
      || workspaceLiveTerminal?.promptReadyAt
      || "";
    const runtimeInputReadyAt = runtimeTerminal?.inputReadyAt
      || runtimeTerminal?.promptReadyAt
      || "";
    const workspaceStatusMs = Number(workspaceLiveTerminal?.statusSeq || 0)
      || todoQueueTimestampMs(workspaceLiveTerminal?.updatedAt)
      || todoQueueTimestampMs(workspaceInputReadyAt);
    const runtimeStatusMs = Number(runtimeTerminal?.statusSeq || 0)
      || todoQueueTimestampMs(runtimeTerminal?.updatedAt)
      || todoQueueTimestampMs(runtimeInputReadyAt);
    const workspaceActivityIsParked = Boolean(
      terminalActivityStatusIsPaused(workspaceActivityStatus)
        || TODO_QUEUE_PARKED_TERMINAL_STATUSES.has(workspaceActivityStatus)
    );
    const runtimeIsNewer = Boolean(
      !workspaceActivityIsParked
        && (runtimeActivityStatus || runtimeStatus)
        && runtimeStatusMs
        && (!workspaceStatusMs || runtimeStatusMs > workspaceStatusMs)
    );
    const workspaceLooksStarting = !workspaceActivityIsParked
      && (workspaceActivityStatus === "starting" || workspaceStatus === "starting");
    const mergedActivityStatus = workspaceLooksStarting || runtimeIsNewer
      ? runtimeActivityStatus || workspaceActivityStatus
      : workspaceActivityStatus || runtimeActivityStatus;
    const mergedStatus = workspaceLooksStarting || runtimeIsNewer
      ? runtimeStatus || workspaceStatus || "active"
      : workspaceStatus || runtimeStatus || "active";
    const inputReadyAt = runtimeStatusMs > workspaceStatusMs
      ? runtimeInputReadyAt || workspaceInputReadyAt
      : workspaceInputReadyAt || runtimeInputReadyAt;
    const promptReadyAt = workspaceLiveTerminal?.promptReadyAt
      || runtimeTerminal?.promptReadyAt
      || inputReadyAt;
    const coordination = workspaceLiveTerminal?.coordination || runtimeTerminal?.coordination || null;
    const activeTask = workspaceLiveTerminal?.activeTask
      || workspaceLiveTerminal?.active_task
      || runtimeTerminal?.activeTask
      || runtimeTerminal?.active_task
      || null;
    const liveTerminal = {
      ...(runtimeTerminal || {}),
      ...(workspaceLiveTerminal || {}),
      agentId: workspaceLiveTerminal?.agentId || runtimeTerminal?.agentId || getTerminalRole(normalizedIndex),
      activityStatus: mergedActivityStatus,
      activity_status: mergedActivityStatus,
      activeTask,
      active_task: activeTask,
      coordination,
      inputReady: Boolean(workspaceLiveTerminal?.inputReady || runtimeTerminal?.inputReady),
      inputReadyAt,
      instanceId: workspaceLiveTerminal?.instanceId || runtimeTerminal?.instanceId || "",
      paneId: workspaceLiveTerminal?.paneId || runtimeTerminal?.paneId || paneId,
      promptReadyAt,
      sessionId: workspaceLiveTerminal?.sessionId
        || runtimeTerminal?.sessionId
        || coordination?.sessionId
        || coordination?.session_id
        || "",
      status: mergedStatus,
      taskId: workspaceLiveTerminal?.taskId
        || workspaceLiveTerminal?.task_id
        || runtimeTerminal?.taskId
        || runtimeTerminal?.task_id
        || activeTask?.taskId
        || activeTask?.task_id
        || "",
      terminalIndex: normalizedIndex,
      threadId: workspaceLiveTerminal?.threadId || runtimeTerminal?.threadId || configuredThread?.id || "",
      workspaceId: workspaceLiveTerminal?.workspaceId || runtimeTerminal?.workspaceId || terminalWorkspace?.id || "",
    };
    const liveTerminalSource = workspaceLiveTerminal && runtimeTerminal
      ? "workspace_threads+mounted_terminal_lifecycle"
      : workspaceLiveTerminal
        ? "workspace_threads"
        : "mounted_terminal_lifecycle";

    return {
      liveTerminal,
      liveTerminalSource,
      runtimeTerminal,
      workspaceLiveTerminal,
    };
  }, [
    getTerminalPaneId,
    getTerminalRole,
    getTerminalThread,
    terminalWorkspace?.id,
    workspaceThreadEntry,
  ]);
  const selectedTerminalPlanTarget = useMemo(() => {
    const terminalIndex = logicalTerminalIndexes.find((candidateIndex) => (
      getTerminalPaneId(candidateIndex) === activePaneId
    ));
    const resolvedIndex = Number.isInteger(terminalIndex)
      ? terminalIndex
      : logicalTerminalIndexes[0];
    if (!Number.isInteger(resolvedIndex)) {
      return {
        agentId: "",
        paneId: activePaneId || "",
        sessionId: "",
        taskId: "",
        terminalIndex: null,
        workspaceId: terminalWorkspace?.id || "",
      };
    }
    const paneId = getTerminalPaneId(resolvedIndex);
    const { liveTerminal } = resolveTodoQueueLiveTerminal(resolvedIndex, paneId);
    const coordination = liveTerminal?.coordination || {};
    const activeTask = liveTerminal?.activeTask || liveTerminal?.active_task || {};
    return {
      agentId: liveTerminal?.agentId
        || coordination.agentId
        || coordination.agent_id
        || getTerminalRole(resolvedIndex)
        || "",
      paneId,
      sessionId: liveTerminal?.sessionId
        || liveTerminal?.session_id
        || coordination.sessionId
        || coordination.session_id
        || "",
      taskId: liveTerminal?.taskId
        || liveTerminal?.task_id
        || activeTask.taskId
        || activeTask.task_id
        || "",
      terminalIndex: resolvedIndex,
      workspaceId: terminalWorkspace?.id || liveTerminal?.workspaceId || "",
    };
  }, [
    activePaneId,
    getTerminalPaneId,
    getTerminalRole,
    logicalTerminalIndexes,
    resolveTodoQueueLiveTerminal,
    terminalWorkspace?.id,
    todoQueueDispatchRevision,
  ]);
  const handleResumeTerminalPlan = useCallback((plan) => {
    const targetSessionId = String(plan?.session_id || plan?.sessionId || "").trim();
    const targetTaskId = String(plan?.task_id || plan?.taskId || "").trim();
    const matchingIndex = logicalTerminalIndexes.find((terminalIndex) => {
      const paneId = getTerminalPaneId(terminalIndex);
      const { liveTerminal } = resolveTodoQueueLiveTerminal(terminalIndex, paneId);
      const coordination = liveTerminal?.coordination || {};
      const activeTask = liveTerminal?.activeTask || liveTerminal?.active_task || {};
      const sessionId = String(
        liveTerminal?.sessionId
          || liveTerminal?.session_id
          || coordination.sessionId
          || coordination.session_id
          || "",
      ).trim();
      const taskId = String(
        liveTerminal?.taskId
          || liveTerminal?.task_id
          || activeTask.taskId
          || activeTask.task_id
          || "",
      ).trim();
      return Boolean(
        (targetSessionId && sessionId === targetSessionId)
          || (targetTaskId && taskId === targetTaskId)
      );
    });
    const focusTerminal = (terminalIndex, paneIdOverride = "") => {
      const paneId = paneIdOverride || getTerminalPaneId(terminalIndex);
      setActiveTerminalPaneId(paneId);
      window.dispatchEvent(new CustomEvent(TERMINAL_FOCUS_REQUEST_EVENT, {
        detail: {
          paneId,
          reason: "terminal_plan_resume",
          terminalIndex,
        },
      }));
    };
    if (Number.isInteger(matchingIndex)) {
      focusTerminal(matchingIndex);
      return;
    }
    const added = addWorkspaceTerminal?.({
      role: String(plan?.agent_id || plan?.agentId || "").trim(),
      workspaceId: terminalWorkspace?.id || "",
    });
    if (added && Number.isInteger(added.terminalIndex)) {
      const paneId = getWorkspaceTerminalPaneId(
        terminalWorkspace?.id,
        added.terminalIndex,
        added.terminalRole,
      );
      window.requestAnimationFrame(() => focusTerminal(added.terminalIndex, paneId));
    }
  }, [
    addWorkspaceTerminal,
    getTerminalPaneId,
    logicalTerminalIndexes,
    resolveTodoQueueLiveTerminal,
    terminalWorkspace?.id,
  ]);
  const recordTodoQueueTerminalLifecycle = useCallback((event = {}) => {
    const eventWorkspaceId = String(event.workspaceId || event.workspace_id || "").trim();
    if (
      eventWorkspaceId
      && terminalWorkspace?.id
      && eventWorkspaceId !== terminalWorkspace.id
    ) {
      return;
    }

    const eventPaneId = String(event.paneId || event.pane_id || "").trim();
    let terminalIndex = Number(event.terminalIndex ?? event.terminal_index);
    if (!Number.isInteger(terminalIndex) && eventPaneId) {
      const matchingIndex = logicalTerminalIndexes.find((candidateIndex) => (
        getTerminalPaneId(candidateIndex) === eventPaneId
      ));
      terminalIndex = Number.isInteger(matchingIndex) ? matchingIndex : Number.NaN;
    }
    if (!Number.isInteger(terminalIndex) || !logicalTerminalIndexes.includes(terminalIndex)) {
      return;
    }

    const eventType = String(event.type || "").trim().toLowerCase();
    const paneId = eventPaneId || getTerminalPaneId(terminalIndex);
    const terminalClosed = eventType === "closed"
      || eventType === "exited"
      || eventType === "error"
      || event.forgetTerminalThread === true;
    if (terminalClosed) {
      const deleted = todoQueueLiveTerminalsRef.current.delete(terminalIndex);
      if (deleted) {
        setTodoQueueDispatchRevision((revision) => revision + 1);
      }
      logTerminalStatus("frontend.todo_queue.live_terminal_lifecycle", {
        eventType,
        paneId,
        reason: "terminal_removed",
        terminalIndex,
        threadId: event.threadId || "",
        workspaceId: eventWorkspaceId || terminalWorkspace?.id || "",
      });
      return;
    }

    const existing = todoQueueLiveTerminalsRef.current.get(terminalIndex) || {};
    const eventActivityStatus = String(event.activityStatus || event.activity_status || "").trim().toLowerCase();
    const activityStatus = eventActivityStatus
      || (
        eventType === "terminal-input-ready"
        || eventType === "terminal-prompt-ready"
        || eventType === "provider-turn-completed"
        || eventType === "provider-turn-interrupted"
          ? "idle"
          : ""
      )
      || (
        eventType === "message-submitted"
        || eventType === "agent-output"
        || eventType === "provider-turn-started"
          ? "thinking"
          : ""
      )
      || String(existing.activityStatus || existing.activity_status || "").trim().toLowerCase();
    const marksReady = event.inputReady === true
      || eventType === "terminal-input-ready"
      || eventType === "terminal-prompt-ready"
      || eventType === "provider-turn-completed"
      || eventType === "provider-turn-interrupted"
      || isTodoQueueSendableActivityStatus(activityStatus);
    const marksBusy = event.inputReady === false
      || eventType === "message-submitted"
      || eventType === "agent-output"
      || eventType === "provider-turn-started"
      || terminalActivityStatusIsBusy(activityStatus);
    const inputReady = marksReady
      ? true
      : marksBusy
        ? false
        : Boolean(existing.inputReady);
    const nowIso = new Date().toISOString();
    const status = String(event.status || existing.status || "active").trim().toLowerCase() || "active";
    const nextTerminal = {
      activeTask: event.activeTask || event.active_task || existing.activeTask || existing.active_task || null,
      active_task: event.activeTask || event.active_task || existing.activeTask || existing.active_task || null,
      agentId: event.agentId || existing.agentId || getTerminalRole(terminalIndex),
      activityStatus,
      activity_status: activityStatus,
      coordination: event.coordination || existing.coordination || null,
      inputReady,
      inputReadyAt: inputReady
        ? event.inputReadyAt || event.promptReadyAt || existing.inputReadyAt || existing.promptReadyAt || nowIso
        : "",
      inputReadyConfidence: event.inputReadyConfidence
        || event.promptReadyConfidence
        || existing.inputReadyConfidence
        || "",
      instanceId: event.instanceId ?? existing.instanceId ?? "",
      paneId,
      promptReadyAt: inputReady
        ? event.promptReadyAt || event.inputReadyAt || existing.promptReadyAt || existing.inputReadyAt || nowIso
        : "",
      promptReadyConfidence: event.promptReadyConfidence
        || event.inputReadyConfidence
        || existing.promptReadyConfidence
        || "",
      status,
      sessionId: event.sessionId || event.session_id || existing.sessionId || existing.session_id || "",
      taskId: event.taskId || event.task_id || existing.taskId || existing.task_id || "",
      terminalIndex,
      threadId: event.threadId || existing.threadId || getTerminalThread(terminalIndex)?.id || "",
      updatedAt: nowIso,
      workspaceId: eventWorkspaceId || terminalWorkspace?.id || "",
    };
    const changed = existing.inputReady !== nextTerminal.inputReady
      || String(existing.activityStatus || existing.activity_status || "") !== String(nextTerminal.activityStatus || "")
      || String(existing.instanceId || "") !== String(nextTerminal.instanceId || "")
      || String(existing.paneId || "") !== String(nextTerminal.paneId || "")
      || String(existing.sessionId || existing.session_id || "") !== String(nextTerminal.sessionId || "")
      || String(existing.status || "") !== String(nextTerminal.status || "")
      || String(existing.taskId || existing.task_id || "") !== String(nextTerminal.taskId || "")
      || String(existing.threadId || "") !== String(nextTerminal.threadId || "");
    todoQueueLiveTerminalsRef.current.set(terminalIndex, nextTerminal);
    if (changed || marksReady || marksBusy || eventType === "opened") {
      setTodoQueueDispatchRevision((revision) => revision + 1);
    }
    logTerminalStatus("frontend.todo_queue.live_terminal_lifecycle", {
      eventType,
      inputReady,
      inputReadyAt: nextTerminal.inputReadyAt,
      activityStatus,
      instanceId: nextTerminal.instanceId || "",
      marksBusy,
      marksReady,
      paneId,
      status,
      terminalIndex,
      threadId: nextTerminal.threadId || "",
      workspaceId: nextTerminal.workspaceId || "",
    });
  }, [
    getTerminalPaneId,
    getTerminalRole,
    getTerminalThread,
    logicalTerminalIndexes,
    terminalWorkspace?.id,
  ]);
  const handleWorkspaceTerminalLifecycle = useCallback((event) => {
    recordTodoQueueTerminalLifecycle(event);
    onThreadTerminalLifecycle?.(event);
  }, [onThreadTerminalLifecycle, recordTodoQueueTerminalLifecycle]);
  const getLiveTerminalPaneIdForThread = useCallback((threadId) => {
    const safeThreadId = String(threadId || "").trim();
    if (!safeThreadId || !workspaceThreadEntry?.terminals) {
      return "";
    }

    const terminal = Object.values(workspaceThreadEntry.terminals).find((candidate) => {
      const activityStatus = String(
        candidate?.activityStatus
          || candidate?.activity_status
          || workspaceThreadEntry?.threads?.[candidate?.threadId]?.activityStatus
          || "",
      ).toLowerCase();
      return candidate?.threadId === safeThreadId
        && (
          isTodoQueueSendableActivityStatus(activityStatus)
          || terminalActivityStatusIsPaused(activityStatus)
        )
        && Number.isInteger(Number.parseInt(candidate.terminalIndex, 10));
    });

    return terminal ? getTerminalPaneId(Number.parseInt(terminal.terminalIndex, 10)) : "";
  }, [getTerminalPaneId, workspaceThreadEntry]);

  useEffect(() => {
    let disposed = false;
    let unlisten = null;

    const resolvePayloadTerminalIndex = (payload = {}) => {
      const directIndex = Number(payload.terminalIndex ?? payload.terminal_index);
      if (Number.isInteger(directIndex) && logicalTerminalIndexes.includes(directIndex)) {
        return directIndex;
      }

      const payloadPaneId = String(payload.paneId || payload.pane_id || "").trim();
      if (!payloadPaneId) {
        return null;
      }

      const matchingIndex = logicalTerminalIndexes.find((terminalIndex) => (
        getTerminalPaneId(terminalIndex) === payloadPaneId
      ));
      return Number.isInteger(matchingIndex) ? matchingIndex : null;
    };

    listen(TERMINAL_PARKED_PROMPT_EVENT, (event) => {
      const payload = event?.payload || {};
      const payloadWorkspaceId = String(payload.workspaceId || payload.workspace_id || "").trim();
      if (
        payloadWorkspaceId
        && terminalWorkspace?.id
        && payloadWorkspaceId !== terminalWorkspace.id
      ) {
        return;
      }

      const targetTerminalIndex = resolvePayloadTerminalIndex(payload);
      if (!Number.isInteger(targetTerminalIndex)) {
        return;
      }

      const status = String(payload.activityStatus || payload.activity_status || payload.status || "").trim().toLowerCase();
      const taskId = String(payload.taskId || payload.task_id || "").trim();
      const promptEventId = String(payload.promptEventId || payload.prompt_event_id || "").trim();
      const lockId = promptEventId || taskId || `terminal-${targetTerminalIndex}`;
      const existingLock = todoQueueTerminalResumeLocksRef.current.get(targetTerminalIndex);
      const nowMs = Date.now();

      if (TODO_QUEUE_PARKED_TERMINAL_STATUSES.has(status)) {
        const reason = status === "resume_requested"
          ? "resume_in_progress"
          : status === "resume_ready"
          ? "parked_task_resume_ready"
          : "parked_task_waiting";
        todoQueueTerminalResumeLocksRef.current.set(targetTerminalIndex, {
          lockId,
          mode: status === "resume_requested" ? "resume_requested" : "parked",
          paneId: String(payload.paneId || payload.pane_id || ""),
          promptEventId,
          reason,
          source: `terminal-parked-${status}`,
          startedAtMs: Number(existingLock?.startedAtMs || 0) || nowMs,
          status,
          taskId,
          terminalIndex: targetTerminalIndex,
          threadId: String(payload.threadId || payload.thread_id || ""),
          workspaceId: payloadWorkspaceId || terminalWorkspace?.id || "",
        });
        setTodoQueueDispatchRevision((revision) => revision + 1);
        logTerminalStatus("frontend.todo_queue.resume_lock_set", {
          lockId,
          reason,
          status,
          targetTerminalIndex,
          threadId: payload.threadId || payload.thread_id || "",
          workspaceId: payloadWorkspaceId || terminalWorkspace?.id || "",
        });
        return;
      }

      if (status === "resumed" && String(payload.reason || "").trim() !== "task_terminal") {
        todoQueueTerminalResumeLocksRef.current.set(targetTerminalIndex, {
          lockId,
          mode: "resume",
          paneId: String(payload.paneId || payload.pane_id || ""),
          promptEventId,
          reason: "resume_in_progress",
          source: "terminal-parked-resume",
          startedAtMs: nowMs,
          status,
          taskId,
          terminalIndex: targetTerminalIndex,
          threadId: String(payload.threadId || payload.thread_id || ""),
          workspaceId: payloadWorkspaceId || terminalWorkspace?.id || "",
        });
        setTodoQueueDispatchRevision((revision) => revision + 1);
        logTerminalStatus("frontend.todo_queue.resume_lock_set", {
          lockId,
          reason: "resume_in_progress",
          status,
          targetTerminalIndex,
          threadId: payload.threadId || payload.thread_id || "",
          workspaceId: payloadWorkspaceId || terminalWorkspace?.id || "",
        });
        return;
      }

      const currentLock = todoQueueTerminalResumeLocksRef.current.get(targetTerminalIndex);
      if (currentLock && (!lockId || currentLock.lockId === lockId)) {
        todoQueueTerminalResumeLocksRef.current.delete(targetTerminalIndex);
        setTodoQueueDispatchRevision((revision) => revision + 1);
        logTerminalStatus("frontend.todo_queue.resume_lock_cleared", {
          lockId: currentLock.lockId || lockId,
          reason: "parked_event_released",
          status,
          targetTerminalIndex,
          threadId: currentLock.threadId || "",
          workspaceId: currentLock.workspaceId || terminalWorkspace?.id || "",
        });
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
  }, [getTerminalPaneId, logicalTerminalIndexes, terminalWorkspace?.id]);

  const settleTodoQueueInFlightPrompt = useCallback((terminalIndex, inFlightPrompt, reason, fields = {}) => {
    const safeTerminalIndex = Number(terminalIndex);
    if (!Number.isInteger(safeTerminalIndex)) {
      return;
    }

    const itemId = String(inFlightPrompt?.itemId || "").trim();
    const promptEventId = String(inFlightPrompt?.promptId || "").trim();
    todoQueueTerminalInFlightPromptsRef.current.delete(safeTerminalIndex);

    if (!itemId) {
      setTodoQueueDispatchRevision((revision) => revision + 1);
      return;
    }

    const pendingItem = todoQueuePendingItemsRef.current[itemId] || null;
    const timeoutId = todoQueuePendingTimersRef.current.get(itemId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      todoQueuePendingTimersRef.current.delete(itemId);
    }

    if (reason === "terminal_confirmed_finished") {
      const completedItem = todoQueueItemsRef.current.find((item) => item.id === itemId) || null;
      if (completedItem) {
        recordTodoQueueRemoteCommandReceipt(completedItem, "completed", {
          workspaceId: pendingItem?.workspaceId || terminalWorkspace?.id || "",
        });
      }
      if (pendingItem) {
        logTerminalStatus("frontend.todo_queue.pending_clear", {
          elapsedMs: Date.now() - Number(pendingItem.startedAtMs || Date.now()),
          itemId,
          phase: pendingItem.phase || pendingItem.state || "sending",
          promptEventId,
          reason,
          targetRole: pendingItem.targetRole || "",
          targetTerminalIndex: safeTerminalIndex,
          workspaceId: pendingItem.workspaceId || terminalWorkspace?.id || "",
          ...fields,
        });
      }
      const nextPendingItems = { ...todoQueuePendingItemsRef.current };
      delete nextPendingItems[itemId];
      replaceTodoQueuePendingItems(nextPendingItems);
      setTodoQueueItems((currentItems) => {
        const nextItems = normalizeTodoQueueItems(
          currentItems.filter((item) => item.id !== itemId),
        );
        logTerminalStatus("frontend.todo_queue.items_state", {
          nextItemCount: nextItems.length,
          previousItemCount: currentItems.length,
          reason,
          removedItemId: itemId,
          workspaceId: terminalWorkspace?.id || "",
        });
        writeTodoQueueItems(todoQueueStorageKeyRef.current, nextItems);
        return nextItems;
      });
      setTodoQueueDispatchRevision((revision) => revision + 1);
      return;
    }

    const startedAtMs = Date.now();
    const requeuedPendingItem = {
      cancellable: true,
      item: pendingItem?.item || null,
      itemId,
      message: "",
      paneId: String(pendingItem?.paneId || fields.paneId || ""),
      phase: "queued",
      reason,
      source: pendingItem?.source || inFlightPrompt?.source || "",
      startedAtMs,
      state: "queued",
      targetRole: String(pendingItem?.targetRole || fields.targetRole || ""),
      targetTerminalIndex: pendingItem?.targetTerminalIndex ?? safeTerminalIndex,
      timeoutAtMs: 0,
      timeoutMs: 0,
      workspaceId: String(pendingItem?.workspaceId || fields.workspaceId || terminalWorkspace?.id || ""),
    };
    const requeuedItem = todoQueueItemsRef.current.find((item) => item.id === itemId) || null;
    if (requeuedItem) {
      recordTodoQueueRemoteCommandReceipt(requeuedItem, "queued", {
        workspaceId: requeuedPendingItem.workspaceId,
      });
    }
    replaceTodoQueuePendingItems({
      ...todoQueuePendingItemsRef.current,
      [itemId]: requeuedPendingItem,
    });
    setTodoQueueItems((currentItems) => {
      const nextItems = normalizeTodoQueueItems(currentItems.map((item) => (
        item.id === itemId
          ? getTodoQueueItemWithPersistedQueueState(item, "queued", {
            reason,
            source: requeuedPendingItem.source,
            targetAgentId: requeuedPendingItem.targetRole,
            targetTerminalIndex: requeuedPendingItem.targetTerminalIndex,
          })
          : item
      )));
      writeTodoQueueItems(todoQueueStorageKeyRef.current, nextItems);
      return nextItems;
    });
    logTerminalStatus("frontend.todo_queue.in_flight_prompt_requeued", {
      itemId,
      promptEventId,
      reason,
      targetTerminalIndex: safeTerminalIndex,
      threadId: inFlightPrompt?.threadId || "",
      workspaceId: requeuedPendingItem.workspaceId,
      ...fields,
    });
    setTodoQueueDispatchRevision((revision) => revision + 1);
  }, [recordTodoQueueRemoteCommandReceipt, replaceTodoQueuePendingItems, terminalWorkspace?.id]);

  const getTodoQueueTerminalSendTarget = useCallback((terminalIndex, item = null, options = {}) => {
    const targetTerminalIndex = Number(terminalIndex);
    const image = getTodoQueueItemImage(item);
    const itemId = String(options.reservationItemId || item?.id || item?.itemId || "").trim();
    const allowGeneric = options.allowGeneric !== false;
    const requireAvailable = Boolean(options.requireAvailable);
    const baseWorkspaceId = String(item?.workspaceId || terminalWorkspace?.id || "");
    const logAvailability = (available, reason, message, fields = {}) => {
      if (!requireAvailable) {
        return;
      }
      logTerminalStatus("frontend.terminal_status.ground_truth_availability", {
          activityStatus: fields.activityStatus || "",
          agentInputReady: Boolean(fields.agentInputReady),
          allowGeneric,
          available,
          hasComposerDraft: Boolean(fields.syncKey && String(getWorkspaceThreadComposerDraftStore().get(fields.syncKey) || "").length > 0),
          hasComposerSyncKey: Boolean(fields.syncKey),
          hasLiveTerminal: Boolean(fields.liveTerminal),
          hasPendingPrompt: Boolean(fields.targetThread?.pendingPrompt),
          hasResolvedBinding: Boolean(fields.targetBinding?.instanceId || fields.targetBinding?.paneId),
          hasTargetThread: Boolean(fields.targetThread?.id),
          inputReadyAt: fields.inputReadyAt || "",
          liveTerminalSource: fields.liveTerminalSource || "",
          latestTurnState: fields.latestTurnState || "",
        effectiveLatestTurnState: fields.effectiveLatestTurnState || "",
        message,
        parkedStatus: fields.parkedStatus || "",
        reason,
        recordedAgentInputReady: Boolean(fields.recordedAgentInputReady),
        completedTurnLooksSendable: Boolean(fields.completedTurnLooksSendable),
        inputReadyIsFreshForTurn: Boolean(fields.inputReadyIsFreshForTurn),
        orphanRunningLooksIdle: Boolean(fields.orphanRunningLooksIdle),
        requiresAgentInputReady: Boolean(fields.requiresAgentInputReady),
        runningTurnLooksIdle: Boolean(fields.runningTurnLooksIdle),
        sourceItem: getTodoQueueItemLogSummary(item ? [item] : [])[0] || null,
        targetRole: fields.targetRole || "",
        targetTerminalIndex: Number.isInteger(targetTerminalIndex) ? targetTerminalIndex : "",
        terminalGroundTruthStatus: fields.terminalGroundTruthStatus || "",
        terminalIsParked: Boolean(fields.terminalIsParked),
        terminalStatus: fields.terminalStatus || "",
        turnStartedAt: fields.turnStartedAt || "",
        workspaceId: fields.workspaceId || baseWorkspaceId,
      });
    };
    const unavailable = (reason, message, fields = {}) => {
      logAvailability(false, reason, message, fields);
      return {
        available: false,
        image,
        message,
        reason,
        targetTerminalIndex: Number.isInteger(targetTerminalIndex) ? targetTerminalIndex : "",
        workspaceId: baseWorkspaceId,
        ...fields,
      };
    };

    if (!Number.isInteger(targetTerminalIndex) || !logicalTerminalIndexes.includes(targetTerminalIndex)) {
      return unavailable("missing_target_terminal", "Choose an agent terminal for this todo.");
    }

    const paneId = getTerminalPaneId(targetTerminalIndex);
    const targetRole = String(getTerminalRole(targetTerminalIndex) || "").trim().toLowerCase();
    const targetProject = getTerminalProjectTarget(targetTerminalIndex);
      const terminalAgent = getTerminalAgent(targetTerminalIndex);
      const specEdit = getTodoQueueItemSpecEdit(item);
      const specEditRepoPath = specEditTargetRepoPath(specEdit);
      const {
        liveTerminal,
        liveTerminalSource,
      } = resolveTodoQueueLiveTerminal(targetTerminalIndex, paneId);
      const liveThread = liveTerminal?.threadId
        ? workspaceThreadEntry?.threads?.[liveTerminal.threadId] || null
        : null;
    const configuredThread = getTerminalThread(targetTerminalIndex);
    const targetThread = liveThread || configuredThread || null;
    const targetProviderBinding = getWorkspaceThreadProviderBinding(targetThread, targetRole);
    const targetBinding = targetProviderBinding?.terminalBinding || targetThread?.terminalBinding || null;
    const resolvedBinding = targetBinding
      ? {
          ...targetBinding,
          instanceId: targetBinding.instanceId || liveTerminal?.instanceId || "",
          paneId: targetBinding.paneId || paneId,
        }
        : liveTerminal
          ? {
            instanceId: liveTerminal.instanceId || "",
            paneId: liveTerminal.paneId || paneId,
            terminalIndex: targetTerminalIndex,
          }
          : null;
    const syncKey = getThreadComposerSyncKey(targetThread, {
      ...resolvedBinding,
      paneId: resolvedBinding?.paneId || paneId,
    });
    const workspaceId = targetThread?.workspaceId || baseWorkspaceId;
    const terminalGroundTruth = getThreadTerminalGroundTruth({
      liveTerminal,
      providerBinding: targetProviderBinding,
      targetRole,
      thread: targetThread,
    });
    const {
      activityStatus,
      agentInputReady,
      completedTurnLooksSendable,
      effectiveActivityStatus,
      effectiveLatestTurnState,
      inputReadyAt,
      inputReadyIsFreshForTurn,
      latestTurnState,
      orphanRunningLooksIdle,
      parkedStatus,
      recordedAgentInputReady,
      requiresAgentInputReady,
      runningTurnLooksIdle,
      terminalGroundTruthStatus,
      terminalIsParked,
      terminalStatus,
      turnStartedAt,
    } = terminalGroundTruth;
      const sendableByCompletedIdleTerminal = Boolean(
        isTodoQueueSendableActivityStatus(effectiveActivityStatus)
          && !targetThread?.pendingPrompt
          && effectiveLatestTurnState !== "running"
          && !terminalActivityStatusIsBusy(effectiveActivityStatus)
          && (
            completedTurnLooksSendable
              || runningTurnLooksIdle
              || TODO_QUEUE_CLOSED_TURN_STATES.has(effectiveLatestTurnState || latestTurnState)
          )
      );
      const queueAgentInputReady = Boolean(agentInputReady || sendableByCompletedIdleTerminal);
      const shouldAutoSubmit = Boolean(
        !image
          && targetRole
          && !["generic", "terminal", "shell"].includes(targetRole),
      );
      const targetFields = {
        agentInputReady: queueAgentInputReady,
        activityStatus: effectiveActivityStatus,
        completedTurnLooksSendable,
        image,
        inputReadyAt,
        rawAgentInputReady: agentInputReady,
        latestTurnState,
        effectiveLatestTurnState,
        liveTerminal,
        liveTerminalSource,
        paneId,
      parkedStatus,
      projectRoot: targetProject?.repoPath || terminalWorkspaceWorkingDirectory || defaultWorkingDirectory || "",
      projectMountId: targetProject?.mountId || "",
      projectName: targetProject?.projectName || "",
      recordedAgentInputReady,
      requiresAgentInputReady,
      orphanRunningLooksIdle,
      inputReadyIsFreshForTurn,
        runningTurnLooksIdle,
        sendableByCompletedIdleTerminal,
        shouldAutoSubmit,
      syncKey,
      targetBinding: resolvedBinding,
      targetProviderBinding,
      targetRole,
      targetTerminalIndex,
      targetThread,
      terminalAgent,
      terminalGroundTruthStatus,
      terminalIsParked,
      terminalStatus,
      turnStartedAt,
      workspaceId,
    };

    if (
      specEditRepoPath
      && targetProject?.repoPath
      && !targetProject?.isWorkspaceRoot
      && !terminalCoordinationPathsEqual(specEditRepoPath, targetProject.repoPath)
    ) {
      return unavailable("project_mismatch", "Choose a terminal for this project.", {
        ...targetFields,
        specEditRepoPath,
      });
    }

    if (!paneId) {
      return unavailable("missing_pane", "Choose an agent terminal for this todo.", targetFields);
    }
    if (!allowGeneric && !TODO_QUEUE_AGENT_ROLES.has(targetRole)) {
      return unavailable("unsupported_role", "Queued todos can only auto-send to agent terminals.", targetFields);
    }

    const imageInputSupport = image
      ? getTerminalImageInputSupport(targetTerminalIndex)
      : { supported: true };
    if (image && !imageInputSupport.supported) {
      return unavailable("image_unsupported", getTodoImageUnsupportedDropMessage(imageInputSupport), {
        ...targetFields,
        imageInputSupport,
      });
    }

    if (!requireAvailable) {
      return {
        ...targetFields,
        available: true,
        imageInputSupport,
        reason: "",
      };
    }

    const resumeLock = todoQueueTerminalResumeLocksRef.current.get(targetTerminalIndex);
    if (resumeLock) {
      const resumeLockMode = String(resumeLock.mode || "").trim().toLowerCase();
      const lockAgeMs = Date.now() - Number(resumeLock.startedAtMs || 0);
      const resumeLockStartedAtMs = Number(resumeLock.startedAtMs || 0);
      const terminalInputReadyAtMs = Date.parse(inputReadyAt || liveTerminal?.promptReadyAt || "") || 0;
      const freshInputReadyAfterResume = Boolean(
        queueAgentInputReady
          && resumeLockStartedAtMs
          && terminalInputReadyAtMs
          && terminalInputReadyAtMs >= resumeLockStartedAtMs
      );
      const readyAfterResume = Boolean(
        resumeLockMode === "resume"
          && !terminalIsParked
          && isTodoQueueSendableActivityStatus(effectiveActivityStatus)
          && (
            !String(effectiveLatestTurnState || latestTurnState || "").trim()
              || TODO_QUEUE_CLOSED_TURN_STATES.has(effectiveLatestTurnState || latestTurnState)
          )
          && freshInputReadyAfterResume
          && !targetThread?.pendingPrompt
      );
      const staleAndReady = Boolean(
        resumeLockMode === "resume"
          && lockAgeMs > TODO_QUEUE_RESUME_LOCK_STALE_MS
          && TODO_QUEUE_CLOSED_TURN_STATES.has(effectiveLatestTurnState || latestTurnState)
          && freshInputReadyAfterResume
      );
      if (readyAfterResume || staleAndReady) {
        todoQueueTerminalResumeLocksRef.current.delete(targetTerminalIndex);
        logTerminalStatus("frontend.todo_queue.resume_lock_cleared", {
          lockAgeMs,
          lockId: resumeLock.lockId || "",
          reason: readyAfterResume ? "terminal_ready_after_resume" : "stale_but_terminal_ready",
          targetTerminalIndex,
          threadId: resumeLock.threadId || "",
          workspaceId: resumeLock.workspaceId || workspaceId,
        });
      } else {
        const reason = resumeLock.reason || "resume_in_progress";
        const message = reason === "resume_in_progress"
          ? "This terminal is resuming a parked task."
          : reason === "parked_task_resume_ready"
            ? "This terminal has a parked task ready to resume."
            : "This terminal is parked waiting on another task.";
        return unavailable(reason, message, {
          ...targetFields,
          resumeLockId: resumeLock.lockId || "",
          resumeLockMode: resumeLock.mode || "",
          resumeLockStartedAtMs: Number(resumeLock.startedAtMs || 0),
        });
      }
    }

    if (terminalIsParked) {
      const reason = parkedStatus === "resume_ready"
        ? "parked_task_resume_ready"
        : "parked_task_waiting";
      const message = parkedStatus === "resume_ready"
        ? "This terminal has a parked task ready to resume."
        : "This terminal is parked waiting on another task.";
      return unavailable(reason, message, targetFields);
    }

    const reservation = todoQueueTerminalReservationsRef.current.get(targetTerminalIndex);
    if (
      reservation
      && Number(reservation.startedAtMs || 0) > 0
      && Date.now() - Number(reservation.startedAtMs || 0) > TODO_QUEUE_CONSUME_TIMEOUT_MS * 2
    ) {
      todoQueueTerminalReservationsRef.current.delete(targetTerminalIndex);
    }
    const activeReservation = todoQueueTerminalReservationsRef.current.get(targetTerminalIndex);
    if (activeReservation && String(activeReservation.itemId || "") !== itemId) {
      return unavailable("reserved", "Another queued todo is already sending to this terminal.", targetFields);
    }
    const activeInFlightPrompt = todoQueueTerminalInFlightPromptsRef.current.get(targetTerminalIndex);
    if (
      activeInFlightPrompt
      && Number(activeInFlightPrompt.startedAtMs || 0) > 0
      && Date.now() - Number(activeInFlightPrompt.startedAtMs || 0) > TODO_QUEUE_IN_FLIGHT_PROMPT_TIMEOUT_MS
    ) {
      todoQueueTerminalInFlightPromptsRef.current.delete(targetTerminalIndex);
      logTerminalStatus("frontend.todo_queue.in_flight_prompt_expired", {
        promptEventId: activeInFlightPrompt.promptId || "",
        reason: "timeout",
        source: activeInFlightPrompt.source || "",
        targetTerminalIndex,
        threadId: activeInFlightPrompt.threadId || "",
        workspaceId,
      });
    }
    const blockingInFlightPrompt = todoQueueTerminalInFlightPromptsRef.current.get(targetTerminalIndex);
    if (blockingInFlightPrompt) {
      const inFlightEvaluation = evaluateTodoQueueInFlightPrompt({
        closedTurnStates: TODO_QUEUE_CLOSED_TURN_STATES,
        effectiveActivityStatus,
        effectiveLatestTurnState,
        inFlightPrompt: blockingInFlightPrompt,
        liveTerminal,
        providerBinding: targetProviderBinding,
        readyGraceMs: TODO_QUEUE_IN_FLIGHT_PROMPT_READY_GRACE_MS,
        recordedAgentInputReady,
        terminalGroundTruth: {
          ...terminalGroundTruth,
          agentInputReady: queueAgentInputReady,
          hasPendingPrompt: Boolean(targetThread?.pendingPrompt),
        },
        terminalStatus,
        targetThread,
        timeoutMs: TODO_QUEUE_IN_FLIGHT_PROMPT_TIMEOUT_MS,
      });
      if (inFlightEvaluation.releaseReason) {
        logTerminalStatus("frontend.todo_queue.in_flight_prompt_cleared", {
          agentInputReady,
          assistantCompletionAfterPrompt: inFlightEvaluation.assistantCompletionAfterPrompt,
          assistantTextAfterPrompt: inFlightEvaluation.assistantTextAfterPrompt,
          blockingAcceptedPromptFinished: inFlightEvaluation.terminalConfirmedFinished,
          blockingFreshInputReady: inFlightEvaluation.freshInputReady,
          blockingLatestTurnAfterSubmit: inFlightEvaluation.latestTurnAfterSubmit,
          blockingLatestTurnId: inFlightEvaluation.latestTurnId,
          blockingLatestTurnState: inFlightEvaluation.latestTurnState,
          blockingLatestUserPromptMatches: inFlightEvaluation.latestUserPromptMatches,
          blockingPromptAcceptedByCompletedThread: inFlightEvaluation.promptAcceptedByCompletedThread,
          blockingPromptId: blockingInFlightPrompt.promptId || "",
          blockingPromptTurnMatches: inFlightEvaluation.promptTurnMatches,
          blockingTerminalReadyForNextPrompt: inFlightEvaluation.terminalReadyForNextPrompt,
          completedTurnLooksSendable,
          effectiveLatestTurnState,
          exactPromptTranscriptFinished: inFlightEvaluation.exactPromptTranscriptFinished,
          inputReadyAt,
          inputReadyAtMs: inFlightEvaluation.terminalInputReadyAtMs,
          inFlightPromptInstanceChanged: inFlightEvaluation.terminalInstanceChanged,
          inFlightPromptThreadChanged: inFlightEvaluation.threadChanged,
          latestTurnState,
          promptUserMessageSeen: inFlightEvaluation.promptUserMessageSeen,
          reason: inFlightEvaluation.releaseReason,
          runningTurnLooksIdle,
          source: blockingInFlightPrompt.source || "",
          submittedAt: blockingInFlightPrompt.submittedAt || "",
          submittedAtMs: inFlightEvaluation.submittedAtMs,
          targetTerminalIndex,
          terminalStatus,
          threadId: inFlightEvaluation.promptThreadId || targetThread?.id || "",
          workspaceId,
        });
        settleTodoQueueInFlightPrompt(targetTerminalIndex, blockingInFlightPrompt, inFlightEvaluation.releaseReason, {
          workspaceId,
        });
      } else {
        return unavailable(
          "submitted_prompt_active",
          "This agent is still working on the submitted prompt.",
          {
            ...targetFields,
            blockingPromptId: blockingInFlightPrompt.promptId || "",
          },
        );
      }
    }
    if (!liveTerminal || !isTodoQueueSendableActivityStatus(effectiveActivityStatus)) {
      return unavailable("terminal_starting", "This terminal is still starting.", targetFields);
    }
    if (!targetThread?.id) {
      return unavailable("terminal_unavailable", "This terminal does not have a live thread yet.", targetFields);
    }
      if (!resolvedBinding?.paneId) {
        return unavailable("terminal_unavailable", "This terminal is not ready to receive a todo yet.", targetFields);
      }
    if (targetThread?.pendingPrompt) {
      return unavailable("pending_prompt", "This terminal already has a prompt waiting to send.", targetFields);
    }
    if (effectiveLatestTurnState === "running") {
      return unavailable("busy_turn", "This agent is already working.", targetFields);
    }
    if (terminalActivityStatusIsBusy(effectiveActivityStatus)) {
      return unavailable("busy_activity", "This agent is already working.", targetFields);
    }
      if (requiresAgentInputReady && !queueAgentInputReady) {
        return unavailable("agent_not_ready", "This agent is still starting.", targetFields);
      }
    if (!syncKey) {
      return unavailable("terminal_unavailable", "This terminal does not have a shared composer yet.", targetFields);
    }
    if (String(getWorkspaceThreadComposerDraftStore().get(syncKey) || "").length > 0) {
      return unavailable("composer_draft_present", "This terminal already has unsent composer text.", targetFields);
    }
    if (getWorkspaceThreadComposerAttachments(syncKey).length > 0) {
      return unavailable("composer_attachments_present", "This terminal already has queued attachments.", targetFields);
    }

    logAvailability(true, "", "", {
      ...targetFields,
      imageInputSupport,
    });
    return {
      ...targetFields,
      available: true,
      imageInputSupport,
      reason: "",
    };
  }, [
    defaultWorkingDirectory,
    getTerminalAgent,
      getTerminalImageInputSupport,
      getTerminalPaneId,
      getTerminalProjectTarget,
	      getTerminalRole,
	      getTerminalThread,
	      logicalTerminalIndexes,
	      resolveTodoQueueLiveTerminal,
	      settleTodoQueueInFlightPrompt,
	      terminalWorkspace?.id,
	      terminalWorkspaceWorkingDirectory,
	      workspaceThreadEntry,
	  ]);
  const fullscreenState = fullscreenActive
    ? fullscreenMotion.phase === "opening" || fullscreenMotion.phase === "closing"
      ? fullscreenMotion.phase
      : "open"
    : "idle";
  const fullscreenMotionStyle = useMemo(() => ({
    "--terminal-fullscreen-duration": `${TERMINAL_FULLSCREEN_TRANSITION_MS}ms`,
    "--terminal-fullscreen-origin-scale-x": fullscreenMotion.originScaleX || 1,
    "--terminal-fullscreen-origin-scale-y": fullscreenMotion.originScaleY || 1,
    "--terminal-fullscreen-origin-x": `${fullscreenMotion.originX || 0}px`,
    "--terminal-fullscreen-origin-y": `${fullscreenMotion.originY || 0}px`,
  }), [fullscreenMotion]);

  const measureTerminalLayout = useCallback(() => {
    const root = terminalPanelsRef.current;
    if (!root) {
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const nextPanelRect = {
      height: rootRect.height,
      left: rootRect.left,
      top: rootRect.top,
      width: rootRect.width,
    };
    const nextRects = {};

    root.querySelectorAll(TERMINAL_PANEL_ANCHOR_SELECTOR).forEach((element) => {
      const terminalIndex = Number.parseInt(element.getAttribute("data-terminal-index") || "", 10);
      if (!Number.isInteger(terminalIndex)) {
        return;
      }

      const rect = element.getBoundingClientRect();
      nextRects[terminalIndex] = {
        height: rect.height,
        left: rect.left - rootRect.left,
        top: rect.top - rootRect.top,
        width: rect.width,
      };
    });

    terminalLayoutRectsRef.current = nextRects;
    terminalPanelRectRef.current = nextPanelRect;
    setTerminalLayoutRects((currentRects) => (
      areRectMapsEqual(currentRects, nextRects) ? currentRects : nextRects
    ));
    setTerminalPanelRect((currentRect) => (
      areRectsEqual(currentRect, nextPanelRect) ? currentRect : nextPanelRect
    ));
  }, []);

  const scheduleMeasureTerminalLayout = useCallback(() => {
    if (layoutMeasureFrameRef.current) {
      return;
    }

    layoutMeasureFrameRef.current = window.requestAnimationFrame(() => {
      layoutMeasureFrameRef.current = 0;
      measureTerminalLayout();
    });
  }, [measureTerminalLayout]);

  const clearFullscreenTransitionTimer = useCallback(() => {
    if (fullscreenTransitionTimerRef.current) {
      window.clearTimeout(fullscreenTransitionTimerRef.current);
      fullscreenTransitionTimerRef.current = 0;
    }
  }, []);

  const clearTerminalBreakoutTransitionTimer = useCallback(() => {
    if (terminalBreakoutTransitionTimerRef.current) {
      window.clearTimeout(terminalBreakoutTransitionTimerRef.current);
      terminalBreakoutTransitionTimerRef.current = 0;
    }
  }, []);

  const getFullscreenMotionFromRect = useCallback((sourceRect) => {
    const targetRect = terminalPanelsRef.current?.getBoundingClientRect?.();
    const sourceWidth = Number(sourceRect?.width || 0);
    const sourceHeight = Number(sourceRect?.height || 0);
    const targetWidth = Number(targetRect?.width || 0);
    const targetHeight = Number(targetRect?.height || 0);

    if (!targetRect || !sourceWidth || !sourceHeight || !targetWidth || !targetHeight) {
      return TERMINAL_FULLSCREEN_DEFAULT_MOTION;
    }

    return {
      originScaleX: sourceWidth / targetWidth,
      originScaleY: sourceHeight / targetHeight,
      originX: Number(sourceRect.left || 0) - Number(targetRect.left || 0),
      originY: Number(sourceRect.top || 0) - Number(targetRect.top || 0),
      phase: "idle",
    };
  }, []);

  useEffect(() => () => {
    clearFullscreenTransitionTimer();
    clearTerminalBreakoutTransitionTimer();
    if (layoutMeasureFrameRef.current) {
      window.cancelAnimationFrame(layoutMeasureFrameRef.current);
      layoutMeasureFrameRef.current = 0;
    }
  }, [clearFullscreenTransitionTimer, clearTerminalBreakoutTransitionTimer]);

  useEffect(() => {
    todoQueuePendingTimersRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    todoQueuePendingTimersRef.current.clear();
    const persistedItems = readTodoQueueItems(todoQueueStorageKey);
    setTodoQueueItems(persistedItems);
    replaceTodoQueuePendingItems(buildTodoQueuePendingItemsFromPersistedQueue(
      persistedItems,
      terminalWorkspace?.id || "",
    ));
    writeTodoQueueItems(todoQueueStorageKey, persistedItems);
    setTodoQueueDraft("");
    if (persistedItems.some((item) => normalizeTodoQueuePersistedQueueState(item))) {
      setTodoQueueDispatchRevision((revision) => revision + 1);
      logTerminalStatus("frontend.todo_queue.rehydrated", {
        itemCount: persistedItems.length,
        queuedItemCount: persistedItems.filter((item) => normalizeTodoQueuePersistedQueueState(item)).length,
        workspaceId: terminalWorkspace?.id || "",
      });
    }
  }, [replaceTodoQueuePendingItems, terminalWorkspace?.id, todoQueueStorageKey]);

  useEffect(() => {
    const bumpDispatchRevision = () => setTodoQueueDispatchRevision((revision) => revision + 1);
    const unsubscribeDrafts = subscribeWorkspaceThreadComposerDrafts(bumpDispatchRevision);
    const unsubscribeAttachments = subscribeWorkspaceThreadComposerAttachments(bumpDispatchRevision);

    return () => {
      unsubscribeDrafts();
      unsubscribeAttachments();
    };
  }, []);

    useEffect(() => {
      const inFlightPrompts = todoQueueTerminalInFlightPromptsRef.current;
      if (!inFlightPrompts.size) {
        return;
      }

      let changed = false;
      const nowMs = Date.now();
      inFlightPrompts.forEach((inFlightPrompt, terminalIndex) => {
        const promptId = String(inFlightPrompt?.promptId || "").trim();
        const { liveTerminal } = resolveTodoQueueLiveTerminal(terminalIndex);
        const targetThread = inFlightPrompt?.threadId
          ? workspaceThreadEntry?.threads?.[inFlightPrompt.threadId] || null
          : liveTerminal?.threadId
            ? workspaceThreadEntry?.threads?.[liveTerminal.threadId] || null
            : null;
        const targetRole = String(liveTerminal?.agentId || targetThread?.currentAgent || "").trim().toLowerCase();
        const providerBinding = getWorkspaceThreadProviderBinding(targetThread, targetRole);
        const terminalGroundTruth = getThreadTerminalGroundTruth({
          liveTerminal,
          providerBinding,
          targetRole,
          thread: targetThread,
        });
        const evaluation = evaluateTodoQueueInFlightPrompt({
          closedTurnStates: TODO_QUEUE_CLOSED_TURN_STATES,
          effectiveActivityStatus: terminalGroundTruth.effectiveActivityStatus,
          effectiveLatestTurnState: terminalGroundTruth.effectiveLatestTurnState,
          inFlightPrompt,
          liveTerminal,
          nowMs,
          providerBinding,
          readyGraceMs: TODO_QUEUE_IN_FLIGHT_PROMPT_READY_GRACE_MS,
          recordedAgentInputReady: terminalGroundTruth.recordedAgentInputReady,
          terminalGroundTruth,
          terminalStatus: liveTerminal?.status || providerBinding?.status || "",
          targetThread,
          timeoutMs: TODO_QUEUE_IN_FLIGHT_PROMPT_TIMEOUT_MS,
        });
        const providerSessionId = String(
          targetThread?.transcriptSessionId
            || providerBinding?.nativeSessionId
            || inFlightPrompt?.sessionId
            || "",
        ).trim();

        if (evaluation.sessionAcceptedByThread || evaluation.promptAcceptedByCompletedThread) {
          const acceptedAt = new Date().toISOString();
          const acceptedMatchedBy = evaluation.sessionAcceptedByThread
            ? "thread-state-reconcile"
            : "completed-thread-reconcile";
          inFlightPrompts.set(terminalIndex, {
            ...inFlightPrompt,
            accepted: true,
            acceptedAt,
            acceptedAtMs: Date.parse(acceptedAt) || Date.now(),
            acceptedMatchedBy,
            sessionId: providerSessionId,
          });
          changed = true;
          logTerminalStatus("frontend.todo_queue.in_flight_prompt_acknowledged", {
            matchedBy: acceptedMatchedBy,
            promptEventId: promptId,
            promptAcceptedByCompletedThread: evaluation.promptAcceptedByCompletedThread,
            reason: evaluation.sessionAcceptedByThread
              ? "thread_state_prompt_accepted"
              : "completed_thread_prompt_accepted",
            sessionIdPresent: Boolean(providerSessionId),
            source: inFlightPrompt?.source || "",
            targetTerminalIndex: terminalIndex,
            threadId: targetThread?.id || inFlightPrompt?.threadId || "",
            workspaceId: targetThread?.workspaceId || inFlightPrompt?.workspaceId || terminalWorkspace?.id || "",
          });
          window.dispatchEvent(new CustomEvent(WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT, {
            detail: {
              agentId: targetRole,
              matchedBy: acceptedMatchedBy,
              promptEventId: promptId,
              sessionId: providerSessionId,
              threadId: targetThread?.id || inFlightPrompt?.threadId || "",
              workspaceId: targetThread?.workspaceId || inFlightPrompt?.workspaceId || terminalWorkspace?.id || "",
            },
          }));
        }

        if (!evaluation.releaseReason) {
          return;
        }

        changed = true;
        logTerminalStatus("frontend.todo_queue.in_flight_prompt_cleared", {
          assistantCompletionAfterPrompt: evaluation.assistantCompletionAfterPrompt,
          assistantTextAfterPrompt: evaluation.assistantTextAfterPrompt,
          completedMatchingTurn: evaluation.completedMatchingTurn,
          completionSignal: evaluation.releaseReason,
          exactPromptTranscriptFinished: evaluation.exactPromptTranscriptFinished,
          expired: evaluation.expired,
          freshInputReady: evaluation.freshInputReady,
          latestTurnAfterSubmit: evaluation.latestTurnAfterSubmit,
          latestMessageId: evaluation.latestMessageId,
          latestTurnId: evaluation.latestTurnId,
          latestTurnState: evaluation.latestTurnState,
          latestUserPromptMatches: evaluation.latestUserPromptMatches,
          promptAccepted: evaluation.effectivePromptAccepted,
          promptEventId: promptId,
          promptTurnMatches: evaluation.promptTurnMatches,
          promptUserMessageSeen: evaluation.promptUserMessageSeen,
          reason: evaluation.releaseReason,
          sessionAcceptedByThread: evaluation.sessionAcceptedByThread,
          source: inFlightPrompt?.source || "",
          submittedAt: inFlightPrompt?.submittedAt || "",
          submittedAtMs: evaluation.submittedAtMs,
          targetTerminalIndex: terminalIndex,
          terminalConfirmedFinished: evaluation.terminalConfirmedFinished,
          terminalInputReady: evaluation.terminalInputReady,
          terminalInputReadyAt: liveTerminal?.inputReadyAt
            || liveTerminal?.promptReadyAt
            || providerBinding?.inputReadyAt
            || providerBinding?.promptReadyAt
            || "",
          terminalInputReadyAtMs: evaluation.terminalInputReadyAtMs,
          terminalInstanceChanged: evaluation.terminalInstanceChanged,
          terminalReadyForNextPrompt: evaluation.terminalReadyForNextPrompt,
          threadChanged: evaluation.threadChanged,
          threadId: targetThread?.id || inFlightPrompt?.threadId || "",
          workspaceId: targetThread?.workspaceId || inFlightPrompt?.workspaceId || terminalWorkspace?.id || "",
        });
        settleTodoQueueInFlightPrompt(terminalIndex, inFlightPrompt, evaluation.releaseReason, {
          workspaceId: targetThread?.workspaceId || inFlightPrompt?.workspaceId || terminalWorkspace?.id || "",
        });
      });

      if (changed) {
        setTodoQueueDispatchRevision((revision) => revision + 1);
      }
    }, [resolveTodoQueueLiveTerminal, settleTodoQueueInFlightPrompt, terminalWorkspace?.id, workspaceThreadEntry]);

    useEffect(() => {
      const handlePromptAccepted = (event) => {
        const detail = event?.detail || {};
        const promptEventId = String(detail.promptEventId || detail.promptId || "").trim();
        if (!promptEventId || !todoQueueTerminalInFlightPromptsRef.current.size) {
          return;
        }

        let changed = false;
        todoQueueTerminalInFlightPromptsRef.current.forEach((inFlightPrompt, terminalIndex) => {
          if (String(inFlightPrompt?.promptId || "").trim() !== promptEventId) {
            return;
        }
        if (
          detail.threadId
          && inFlightPrompt?.threadId
          && String(detail.threadId) !== String(inFlightPrompt.threadId)
        ) {
          return;
        }

          todoQueueTerminalInFlightPromptsRef.current.set(terminalIndex, {
            ...inFlightPrompt,
            accepted: true,
            acceptedAt: new Date().toISOString(),
            acceptedAtMs: Date.now(),
            acceptedMatchedBy: detail.matchedBy || "",
            sessionId: detail.sessionId || inFlightPrompt?.sessionId || "",
          });
          changed = true;
          logTerminalStatus("frontend.todo_queue.in_flight_prompt_acknowledged", {
            matchedBy: detail.matchedBy || "",
          promptEventId,
          reason: "prompt_accepted_waiting_for_terminal_ready",
          source: inFlightPrompt?.source || "",
          targetTerminalIndex: terminalIndex,
          threadId: detail.threadId || inFlightPrompt?.threadId || "",
            workspaceId: detail.workspaceId || inFlightPrompt?.workspaceId || terminalWorkspace?.id || "",
          });
        });
        if (changed) {
          setTodoQueueDispatchRevision((revision) => revision + 1);
        }

      };

    window.addEventListener(WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT, handlePromptAccepted);
    return () => {
      window.removeEventListener(WORKSPACE_THREAD_PROMPT_ACCEPTED_EVENT, handlePromptAccepted);
    };
  }, [terminalWorkspace?.id]);

  useEffect(() => {
    const resumeLocks = todoQueueTerminalResumeLocksRef.current;
    if (!resumeLocks.size) {
      return;
    }

      const nowMs = Date.now();
      let changed = false;

      resumeLocks.forEach((resumeLock, terminalIndex) => {
        const { liveTerminal } = resolveTodoQueueLiveTerminal(terminalIndex);
      const targetThread = resumeLock?.threadId
        ? workspaceThreadEntry?.threads?.[resumeLock.threadId] || null
        : liveTerminal?.threadId
          ? workspaceThreadEntry?.threads?.[liveTerminal.threadId] || null
          : null;
      const targetRole = String(liveTerminal?.agentId || targetThread?.currentAgent || "").trim().toLowerCase();
      const providerBinding = getWorkspaceThreadProviderBinding(targetThread, targetRole);
      const latestTurn = targetThread?.latestTurn || null;
      const latestTurnState = String(latestTurn?.state || "").trim().toLowerCase();
      const latestTurnId = String(latestTurn?.turnId || latestTurn?.id || "").trim();
      const latestMessageId = String(latestTurn?.messageId || "").trim();
      const lockPromptId = String(resumeLock?.promptEventId || resumeLock?.taskId || "").trim();
      const liveActivityStatus = String(
        liveTerminal?.activityStatus
          || liveTerminal?.activity_status
          || targetThread?.activityStatus
          || providerBinding?.activityStatus
          || "",
      ).trim().toLowerCase();
      const terminalIsParked = terminalActivityStatusIsPaused(liveActivityStatus);
      const lockStartedAtMs = Number(resumeLock?.startedAtMs || 0);
      const terminalInputReadyAtMs = Date.parse(
        liveTerminal?.inputReadyAt
          || liveTerminal?.promptReadyAt
          || providerBinding?.inputReadyAt
          || providerBinding?.promptReadyAt
          || "",
      ) || 0;
      const turnStartedAtMs = Date.parse(
        latestTurn?.startedAt
          || latestTurn?.createdAt
          || latestTurn?.updatedAt
          || "",
      ) || 0;
      const promptTurnMatches = Boolean(
        !lockPromptId
          || latestTurnId.includes(lockPromptId)
          || latestMessageId === lockPromptId
      );
      const turnBelongsToLockWindow = Boolean(
        !turnStartedAtMs
          || !lockStartedAtMs
          || turnStartedAtMs >= lockStartedAtMs - 1000
      );
      const resumeLockMode = String(resumeLock?.mode || "").trim().toLowerCase();
      const freshInputReady = Boolean(
        (liveTerminal?.inputReady || providerBinding?.inputReady)
          && lockStartedAtMs
          && terminalInputReadyAtMs
          && terminalInputReadyAtMs >= lockStartedAtMs
      );
      const terminalReadyAfterResume = Boolean(
        resumeLockMode === "resume"
          && liveTerminal
          && !terminalIsParked
          && isTodoQueueSendableActivityStatus(liveActivityStatus)
          && freshInputReady
          && (
            !latestTurnState
            || TODO_QUEUE_CLOSED_TURN_STATES.has(latestTurnState)
          )
          && (liveTerminal?.inputReady || providerBinding?.inputReady)
      );
      const resumedTurnConfirmedFinished = Boolean(
        resumeLockMode === "resume"
          && TODO_QUEUE_CLOSED_TURN_STATES.has(latestTurnState)
          && freshInputReady
          && (promptTurnMatches || turnBelongsToLockWindow)
      );
      const lockAgeMs = lockStartedAtMs ? nowMs - lockStartedAtMs : 0;

      if (!liveTerminal && lockAgeMs > TODO_QUEUE_RESUME_LOCK_STALE_MS) {
        resumeLocks.delete(terminalIndex);
        changed = true;
        logTerminalStatus("frontend.todo_queue.resume_lock_cleared", {
          lockAgeMs,
          lockId: resumeLock?.lockId || "",
          reason: "terminal_missing",
          targetTerminalIndex: terminalIndex,
          threadId: resumeLock?.threadId || "",
          workspaceId: resumeLock?.workspaceId || terminalWorkspace?.id || "",
        });
        return;
      }

      if (terminalReadyAfterResume || resumedTurnConfirmedFinished) {
        resumeLocks.delete(terminalIndex);
        changed = true;
        logTerminalStatus("frontend.todo_queue.resume_lock_cleared", {
          freshInputReady,
          terminalReadyAfterResume,
          latestMessageId,
          latestTurnId,
          latestTurnState,
          lockAgeMs,
          lockId: resumeLock?.lockId || "",
          promptTurnMatches,
          reason: terminalReadyAfterResume ? "terminal_ready_after_resume" : "resumed_turn_finished",
          targetTerminalIndex: terminalIndex,
          terminalInputReadyAt: liveTerminal?.inputReadyAt
            || liveTerminal?.promptReadyAt
            || providerBinding?.inputReadyAt
            || providerBinding?.promptReadyAt
            || "",
          threadId: targetThread?.id || resumeLock?.threadId || "",
          workspaceId: targetThread?.workspaceId || resumeLock?.workspaceId || terminalWorkspace?.id || "",
        });
        return;
      }

      if (
        resumeLockMode !== "resume"
        && liveTerminal
        && !terminalIsParked
      ) {
        if (terminalActivityStatusIsBusy(liveActivityStatus) && !terminalReadyAfterResume) {
          resumeLocks.set(terminalIndex, {
            ...resumeLock,
            mode: "resume",
            reason: "resume_in_progress",
            source: resumeLock?.source || "terminal-parked-resume",
            activityStatus: liveActivityStatus,
            status: liveActivityStatus,
            threadId: resumeLock?.threadId || liveTerminal?.threadId || "",
          });
          changed = true;
          logTerminalStatus("frontend.todo_queue.resume_lock_set", {
            lockAgeMs,
            lockId: resumeLock?.lockId || "",
            reason: "resume_in_progress",
            activityStatus: liveActivityStatus,
            status: liveActivityStatus,
            targetTerminalIndex: terminalIndex,
            threadId: resumeLock?.threadId || liveTerminal?.threadId || "",
            workspaceId: resumeLock?.workspaceId || terminalWorkspace?.id || "",
          });
          return;
        }
      }
    });

    if (changed) {
      setTodoQueueDispatchRevision((revision) => revision + 1);
    }
    }, [resolveTodoQueueLiveTerminal, terminalWorkspace?.id, workspaceThreadEntry]);

  useEffect(() => {
    const element = terminalWorkspaceMainRef.current;
    if (!element) {
      return undefined;
    }

    const updateWidth = () => {
      const nextWidth = Math.round(element.getBoundingClientRect().width || 0);
      setTerminalWorkspaceMainWidth((currentWidth) => (
        currentWidth === nextWidth ? currentWidth : nextWidth
      ));
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => window.removeEventListener("resize", updateWidth);
    }

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, [shouldShowWorkspaceSetup]);

  useEffect(() => {
    if (!todoQueueVisible && todoQueuePaneMode !== TODO_QUEUE_PANE_MODE_NORMAL) {
      setTodoQueuePaneMode(TODO_QUEUE_PANE_MODE_NORMAL);
    }
  }, [todoQueuePaneMode, todoQueueVisible]);

  useEffect(() => {
    if (!todoQueueVisible || !hasVisibleWorkspaceTerminalPanes) {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      terminalGridPanelRef.current?.resize?.(terminalGridPanelSize);
      todoQueuePanelRef.current?.resize?.(todoQueuePanelSize);
      scheduleMeasureTerminalLayout();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [
    hasVisibleWorkspaceTerminalPanes,
    scheduleMeasureTerminalLayout,
    terminalGridPanelSize,
    todoQueuePanelSize,
    todoQueueVisible,
  ]);

  useLayoutEffect(() => {
    measureTerminalLayout();
  }, [activeDisplayRowsSignature, fullscreenActive, measureTerminalLayout]);

  useEffect(() => {
    const root = terminalPanelsRef.current;
    if (!root || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const observer = new ResizeObserver(scheduleMeasureTerminalLayout);
    observer.observe(root);
    root.querySelectorAll(TERMINAL_PANEL_ANCHOR_SELECTOR).forEach((element) => {
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, [activeDisplayRowsSignature, scheduleMeasureTerminalLayout]);

  useEffect(() => {
    window.addEventListener("resize", scheduleMeasureTerminalLayout);
    return () => window.removeEventListener("resize", scheduleMeasureTerminalLayout);
  }, [scheduleMeasureTerminalLayout]);

  useEffect(() => {
    setActiveTerminalPaneId((currentPaneId) => (
      currentPaneId && visibleTerminalPaneIds.includes(currentPaneId)
        ? currentPaneId
        : visibleTerminalPaneIds[0] || ""
    ));
  }, [visibleTerminalPaneIdSignature]);

  useEffect(() => {
    setFullscreenTerminalIndex((currentIndex) => (
      Number.isInteger(currentIndex) && logicalTerminalIndexes.includes(currentIndex)
        ? currentIndex
        : null
    ));
  }, [logicalTerminalIndexes]);

  useEffect(() => {
    if (
      Number.isInteger(fullscreenTerminalIndex)
      && !logicalTerminalIndexes.includes(fullscreenTerminalIndex)
    ) {
      clearFullscreenTransitionTimer();
      setFullscreenMotion(TERMINAL_FULLSCREEN_DEFAULT_MOTION);
    }
  }, [clearFullscreenTransitionTimer, fullscreenTerminalIndex, logicalTerminalIndexes]);

  const handleActivateTerminalPane = useCallback(({ paneId }) => {
    if (paneId) {
      setActiveTerminalPaneId(paneId);
    }
  }, []);

  const handleSplitTerminal = useCallback(({ direction, terminalIndex }) => {
    splitWorkspaceTerminal?.({
      direction,
      terminalIndex,
      workspaceId: terminalWorkspace?.id || "",
    });
  }, [splitWorkspaceTerminal, terminalWorkspace?.id]);

  const updateTerminalBreakoutPlacements = useCallback((updater) => {
    setTerminalBreakoutPlacements((currentPlacements) => {
      const nextPlacements = normalizeBreakoutPlacements(
        typeof updater === "function" ? updater(currentPlacements) : updater,
        logicalTerminalIndexes,
      );
      terminalBreakoutPlacementsRef.current = nextPlacements;
      return nextPlacements;
    });
  }, [logicalTerminalIndexes]);

  const setTerminalBreakoutViewportState = useCallback((updater) => {
    setTerminalBreakoutViewport((currentViewport) => {
      const nextViewport = normalizeBreakoutViewport(
        typeof updater === "function" ? updater(currentViewport) : updater,
      );
      terminalBreakoutViewportRef.current = nextViewport;
      return nextViewport;
    });
  }, []);

  const buildCurrentBreakoutPlacements = useCallback((options = {}) => (
    buildSpreadBreakoutPlacements({
      existingPlacements: terminalBreakoutPlacementsRef.current,
      panelRect: terminalPanelRectRef.current,
      preserveExisting: options.preserveExisting !== false,
      rects: terminalLayoutRectsRef.current,
      terminalIndexes: logicalTerminalIndexes,
    })
  ), [logicalTerminalIndexes]);

  const openTerminalBreakout = useCallback(() => {
    if (!hasVisibleWorkspaceTerminalPanes || !terminalWorkspace?.id) {
      return;
    }

    measureTerminalLayout();
    clearTerminalBreakoutTransitionTimer();
    const { placements } = buildCurrentBreakoutPlacements({ preserveExisting: true });
    updateTerminalBreakoutPlacements(placements);
    setTerminalBreakoutPhase(TERMINAL_BREAKOUT_PHASE_BREAKING_OUT);
    terminalBreakoutTransitionTimerRef.current = window.setTimeout(() => {
      terminalBreakoutTransitionTimerRef.current = 0;
      setTerminalBreakoutPhase((currentPhase) => (
        currentPhase === TERMINAL_BREAKOUT_PHASE_BREAKING_OUT
          ? TERMINAL_BREAKOUT_PHASE_CANVAS
          : currentPhase
      ));
    }, TERMINAL_BREAKOUT_TRANSITION_MS);
  }, [
    buildCurrentBreakoutPlacements,
    clearTerminalBreakoutTransitionTimer,
    hasVisibleWorkspaceTerminalPanes,
    measureTerminalLayout,
    terminalWorkspace?.id,
    updateTerminalBreakoutPlacements,
  ]);

  const closeTerminalBreakout = useCallback(() => {
    if (terminalBreakoutPhaseRef.current === TERMINAL_BREAKOUT_PHASE_GRID) {
      return;
    }

    measureTerminalLayout();
    clearTerminalBreakoutTransitionTimer();
    const nextDisplayRows = getDisplayRowsFromBreakoutPlacements(
      logicalTerminalIndexes,
      terminalBreakoutPlacementsRef.current,
    );

    if (nextDisplayRows.length) {
      reorderWorkspaceTerminalDisplayLayout?.({
        displayRows: nextDisplayRows,
        workspaceId: terminalWorkspace?.id || "",
      });
    }

    setTerminalBreakoutPhase(TERMINAL_BREAKOUT_PHASE_RETURNING);
    terminalBreakoutTransitionTimerRef.current = window.setTimeout(() => {
      terminalBreakoutTransitionTimerRef.current = 0;
      setTerminalBreakoutPhase((currentPhase) => (
        currentPhase === TERMINAL_BREAKOUT_PHASE_RETURNING
          ? TERMINAL_BREAKOUT_PHASE_GRID
          : currentPhase
      ));
    }, TERMINAL_BREAKOUT_TRANSITION_MS);
  }, [
    clearTerminalBreakoutTransitionTimer,
    logicalTerminalIndexes,
    measureTerminalLayout,
    reorderWorkspaceTerminalDisplayLayout,
    terminalWorkspace?.id,
  ]);

  const toggleTerminalBreakout = useCallback(() => {
    if (terminalBreakoutPhaseRef.current === TERMINAL_BREAKOUT_PHASE_GRID) {
      openTerminalBreakout();
      return;
    }

    closeTerminalBreakout();
  }, [closeTerminalBreakout, openTerminalBreakout]);

  const resetTerminalBreakoutLayout = useCallback(() => {
    if (!terminalBreakoutVisible) {
      return;
    }

    const { placements } = buildCurrentBreakoutPlacements({ preserveExisting: false });
    updateTerminalBreakoutPlacements(placements);
    setTerminalBreakoutViewportState(TERMINAL_BREAKOUT_DEFAULT_VIEWPORT);
  }, [
    buildCurrentBreakoutPlacements,
    setTerminalBreakoutViewportState,
    terminalBreakoutVisible,
    updateTerminalBreakoutPlacements,
  ]);

  const fitTerminalBreakoutCanvas = useCallback(() => {
    const panelRect = terminalPanelRectRef.current;
    const placements = Object.values(terminalBreakoutPlacementsRef.current)
      .map(normalizeBreakoutPlacement)
      .filter(Boolean);

    if (!panelRect || !placements.length) {
      setTerminalBreakoutViewportState(TERMINAL_BREAKOUT_DEFAULT_VIEWPORT);
      return;
    }

    const minX = Math.min(...placements.map((placement) => placement.x));
    const minY = Math.min(...placements.map((placement) => placement.y));
    const maxX = Math.max(...placements.map((placement) => placement.x + placement.width));
    const maxY = Math.max(...placements.map((placement) => placement.y + placement.height));
    const boundsWidth = maxX - minX;
    const boundsHeight = maxY - minY;
    const margin = 54;
    const availableWidth = Math.max(1, Number(panelRect.width || 0) - (margin * 2));
    const availableHeight = Math.max(1, Number(panelRect.height || 0) - (margin * 2));
    const fitZoom = clampBreakoutZoom(Math.min(
      availableWidth / Math.max(1, boundsWidth),
      availableHeight / Math.max(1, boundsHeight),
    ));

    setTerminalBreakoutViewportState({
      x: Math.round(((panelRect.width - (boundsWidth * fitZoom)) / 2) - (minX * fitZoom)),
      y: Math.round(((panelRect.height - (boundsHeight * fitZoom)) / 2) - (minY * fitZoom)),
      zoom: fitZoom,
    });
  }, [setTerminalBreakoutViewportState]);

  const zoomTerminalBreakoutCanvas = useCallback((factor) => {
    const panelRect = terminalPanelRectRef.current;

    setTerminalBreakoutViewportState((currentViewport) => {
      const viewport = normalizeBreakoutViewport(currentViewport);
      const nextZoom = clampBreakoutZoom(viewport.zoom * factor);

      if (Math.abs(nextZoom - viewport.zoom) < 0.001) {
        return viewport;
      }

      const centerX = Number(panelRect?.width || 0) / 2;
      const centerY = Number(panelRect?.height || 0) / 2;
      const worldCenterX = (centerX - viewport.x) / Math.max(0.001, viewport.zoom);
      const worldCenterY = (centerY - viewport.y) / Math.max(0.001, viewport.zoom);

      return {
        x: Math.round(centerX - (worldCenterX * nextZoom)),
        y: Math.round(centerY - (worldCenterY * nextZoom)),
        zoom: nextZoom,
      };
    });
  }, [setTerminalBreakoutViewportState]);

  const zoomInTerminalBreakoutCanvas = useCallback(() => {
    zoomTerminalBreakoutCanvas(TERMINAL_BREAKOUT_ZOOM_STEP);
  }, [zoomTerminalBreakoutCanvas]);

  const zoomOutTerminalBreakoutCanvas = useCallback(() => {
    zoomTerminalBreakoutCanvas(1 / TERMINAL_BREAKOUT_ZOOM_STEP);
  }, [zoomTerminalBreakoutCanvas]);

  const handleBreakoutPanPointerDown = useCallback((event) => {
    if (!terminalBreakoutVisible || event.button !== 0) {
      return;
    }

    event.preventDefault();
    terminalBreakoutPanStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startViewport: normalizeBreakoutViewport(terminalBreakoutViewportRef.current),
    };
    setTerminalBreakoutPanning(true);
  }, [terminalBreakoutVisible]);

  const handleAddTerminalToBreakout = useCallback(() => {
    if (!terminalWorkspace?.id || logicalTerminalIndexes.length >= MAX_WORKSPACE_TERMINAL_COUNT) {
      return;
    }

    const activeTerminalIndex = logicalTerminalIndexes.find((terminalIndex) => (
      getTerminalPaneId(terminalIndex) === activeTerminalPaneId
    ));
    const sourceTerminalIndex = Number.isInteger(activeTerminalIndex)
      ? activeTerminalIndex
      : logicalTerminalIndexes[logicalTerminalIndexes.length - 1];
    const result = addWorkspaceTerminal?.({
      role: Number.isInteger(sourceTerminalIndex) ? getTerminalRole(sourceTerminalIndex) : "",
      workspaceId: terminalWorkspace.id,
    });
    const terminalIndex = Number.parseInt(result?.terminalIndex, 10);

    if (!Number.isInteger(terminalIndex)) {
      return;
    }

    const panelRect = terminalPanelRectRef.current;
    const { width, height } = getBreakoutBaseTerminalSize(panelRect, terminalLayoutRectsRef.current);
    const currentPlacements = terminalBreakoutPlacementsRef.current;
    const maxZ = Object.values(currentPlacements)
      .map((placement) => Number.parseInt(placement?.z, 10) || 0)
      .reduce((maxValue, z) => Math.max(maxValue, z), 0);
    const viewport = normalizeBreakoutViewport(terminalBreakoutViewportRef.current);
    const zoom = Math.max(0.001, viewport.zoom);
    const placement = {
      height,
      width,
      x: Math.round((((Number(panelRect?.width || 0) || width) / 2) - viewport.x) / zoom - (width / 2) + 34),
      y: Math.round((((Number(panelRect?.height || 0) || height) / 2) - viewport.y) / zoom - (height / 2) + 34),
      z: maxZ + 1,
    };

    updateTerminalBreakoutPlacements({
      ...currentPlacements,
      [terminalIndex]: placement,
    });
    setActiveTerminalPaneId(getWorkspaceTerminalPaneId(terminalWorkspace.id, terminalIndex, result?.terminalRole || getTerminalRole(sourceTerminalIndex)));
  }, [
    activeTerminalPaneId,
    addWorkspaceTerminal,
    getTerminalPaneId,
    getTerminalRole,
    logicalTerminalIndexes,
    terminalWorkspace?.id,
    updateTerminalBreakoutPlacements,
  ]);

  useEffect(() => {
    if (!terminalBreakoutPanning) {
      return undefined;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event) => {
      const panState = terminalBreakoutPanStateRef.current;
      if (!panState || event.pointerId !== panState.pointerId) {
        return;
      }

      event.preventDefault();
      setTerminalBreakoutViewportState({
        x: panState.startViewport.x + (event.clientX - panState.startClientX),
        y: panState.startViewport.y + (event.clientY - panState.startClientY),
        zoom: panState.startViewport.zoom,
      });
    };

    const endPan = (event) => {
      const panState = terminalBreakoutPanStateRef.current;
      if (!panState || event.pointerId !== panState.pointerId) {
        return;
      }

      terminalBreakoutPanStateRef.current = null;
      setTerminalBreakoutPanning(false);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", endPan);
    window.addEventListener("pointercancel", endPan);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endPan);
      window.removeEventListener("pointercancel", endPan);
    };
  }, [setTerminalBreakoutViewportState, terminalBreakoutPanning]);

  useEffect(() => {
    if (!terminalBreakoutVisible) {
      return undefined;
    }

    const canvas = terminalBreakoutBackgroundCanvasRef.current;
    if (!canvas) {
      return undefined;
    }

    let frameId = 0;
    const scheduleDraw = () => {
      if (frameId) {
        return;
      }

      frameId = window.requestAnimationFrame(() => {
        frameId = 0;

        const rect = canvas.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width || 0));
        const height = Math.max(1, Math.round(rect.height || 0));
        const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const nextCanvasWidth = Math.round(width * pixelRatio);
        const nextCanvasHeight = Math.round(height * pixelRatio);

        if (canvas.width !== nextCanvasWidth) {
          canvas.width = nextCanvasWidth;
        }
        if (canvas.height !== nextCanvasHeight) {
          canvas.height = nextCanvasHeight;
        }

        const context = canvas.getContext("2d");
        if (!context) {
          return;
        }

        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        const isLightTheme = document.documentElement.getAttribute("data-forge-theme") === "light";
        context.fillStyle = isLightTheme ? "#ffffff" : "#020304";
        context.fillRect(0, 0, width, height);

        const shade = context.createLinearGradient(0, 0, 0, height);
        if (isLightTheme) {
          shade.addColorStop(0, "rgba(239, 243, 250, 0.46)");
          shade.addColorStop(0.5, "rgba(255, 255, 255, 0.16)");
          shade.addColorStop(1, "rgba(226, 232, 240, 0.38)");
        } else {
          shade.addColorStop(0, "rgba(7, 14, 26, 0.74)");
          shade.addColorStop(0.5, "rgba(2, 3, 4, 0.08)");
          shade.addColorStop(1, "rgba(5, 8, 14, 0.64)");
        }
        context.fillStyle = shade;
        context.fillRect(0, 0, width, height);

        const viewport = normalizeBreakoutViewport(terminalBreakoutViewportRef.current);
        const worldStep = 58;
        const spacing = Math.max(12, Math.min(54, worldStep * viewport.zoom));
        const offsetX = ((viewport.x % spacing) + spacing) % spacing;
        const offsetY = ((viewport.y % spacing) + spacing) % spacing;
        const minorColor = isLightTheme ? "rgba(50, 58, 74, 0.16)" : "rgba(148, 163, 184, 0.2)";
        const majorColor = isLightTheme ? "rgba(28, 38, 55, 0.28)" : "rgba(178, 197, 226, 0.32)";

        for (let x = offsetX - spacing; x <= width + spacing; x += spacing) {
          const worldColumn = Math.round((x - viewport.x) / Math.max(1, spacing));
          for (let y = offsetY - spacing; y <= height + spacing; y += spacing) {
            const worldRow = Math.round((y - viewport.y) / Math.max(1, spacing));
            const major = worldColumn % 4 === 0 && worldRow % 4 === 0;
            context.beginPath();
            context.fillStyle = major ? majorColor : minorColor;
            context.arc(x, y, major ? 1.28 : 0.82, 0, Math.PI * 2);
            context.fill();
          }
        }
      });
    };

    scheduleDraw();

    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleDraw);
    observer?.observe(canvas);
    const themeObserver = typeof MutationObserver === "undefined" ? null : new MutationObserver(scheduleDraw);
    themeObserver?.observe(document.documentElement, {
      attributeFilter: ["data-forge-theme"],
      attributes: true,
    });
    window.addEventListener("resize", scheduleDraw);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
      observer?.disconnect();
      themeObserver?.disconnect();
      window.removeEventListener("resize", scheduleDraw);
    };
  }, [terminalBreakoutVisible, terminalBreakoutViewport, terminalPanelRect]);

  const updateTodoQueueItems = useCallback((updater) => {
    setTodoQueueItems((currentItems) => {
      const nextItems = normalizeTodoQueueItems(
        typeof updater === "function" ? updater(currentItems) : updater,
      );
      const previousImageCount = currentItems.filter((item) => getTodoQueueItemImage(item)).length;
      const nextImageCount = nextItems.filter((item) => getTodoQueueItemImage(item)).length;
      if (previousImageCount || nextImageCount) {
        logBigViewSyncDiagnosticEvent("tui.image.queue_state", {
          nextImageCount,
          nextItemCount: nextItems.length,
          previousImageCount,
          previousItemCount: currentItems.length,
          surface: "tui_todo_queue",
          workspaceId: terminalWorkspace?.id || "",
        });
      }
      logTerminalStatus("frontend.todo_queue.items_state", {
        nextItemCount: nextItems.length,
        previousItemCount: currentItems.length,
        voicePlanItems: getTodoQueueItemLogSummary(nextItems.filter((item) => getTodoQueueItemPlanTask(item))),
        workspaceId: terminalWorkspace?.id || "",
      });
      writeTodoQueueItems(todoQueueStorageKeyRef.current, nextItems);
      return nextItems;
    });
  }, [terminalWorkspace?.id]);

  const clearTodoQueueItemPending = useCallback((itemId, reason = "unspecified", fields = {}) => {
    const safeItemId = String(itemId || "").trim();
    if (!safeItemId) {
      return;
    }

    const timeoutId = todoQueuePendingTimersRef.current.get(safeItemId);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      todoQueuePendingTimersRef.current.delete(safeItemId);
    }

    const pendingItem = todoQueuePendingItemsRef.current[safeItemId];
    if (!pendingItem) {
      return;
    }
    const remoteReceiptStatus = reason === "consumed" || reason === "terminal_confirmed_finished"
      ? "completed"
      : reason === "error"
        ? "failed"
        : "";
    if (remoteReceiptStatus) {
      const item = todoQueueItemsRef.current.find((candidate) => candidate.id === safeItemId) || null;
      if (item) {
        recordTodoQueueRemoteCommandReceipt(item, remoteReceiptStatus, {
          workspaceId: pendingItem.workspaceId || terminalWorkspace?.id || "",
        });
      }
    }

    logBigViewSyncDiagnosticEvent("tui.text.todo_pending_clear", {
      elapsedMs: Date.now() - Number(pendingItem.startedAtMs || Date.now()),
      itemId: safeItemId,
      phase: pendingItem.phase || pendingItem.state || "sending",
      reason,
      surface: "tui_todo_queue",
      targetRole: pendingItem.targetRole || "",
      targetTerminalIndex: pendingItem.targetTerminalIndex ?? "",
      timeoutMs: Number(pendingItem.timeoutMs || 0),
      workspaceId: pendingItem.workspaceId || terminalWorkspace?.id || "",
      ...fields,
    });
    logTerminalStatus("frontend.todo_queue.pending_clear", {
      elapsedMs: Date.now() - Number(pendingItem.startedAtMs || Date.now()),
      itemId: safeItemId,
      phase: pendingItem.phase || pendingItem.state || "sending",
      reason,
      targetRole: pendingItem.targetRole || "",
      targetTerminalIndex: pendingItem.targetTerminalIndex ?? "",
      workspaceId: pendingItem.workspaceId || terminalWorkspace?.id || "",
      ...fields,
    });
    const nextPendingItems = { ...todoQueuePendingItemsRef.current };
    delete nextPendingItems[safeItemId];
    replaceTodoQueuePendingItems(nextPendingItems);
    updateTodoQueueItems((currentItems) => (
      currentItems.map((item) => (
        item.id === safeItemId
          ? getTodoQueueItemWithoutPersistedQueueState(item)
          : item
      ))
    ));
  }, [
    recordTodoQueueRemoteCommandReceipt,
    replaceTodoQueuePendingItems,
    terminalWorkspace?.id,
    updateTodoQueueItems,
  ]);

  const setTodoQueueItemPending = useCallback((itemId, fields = {}) => {
    const safeItemId = String(itemId || "").trim();
    if (!safeItemId) {
      return;
    }

    const existingTimeoutId = todoQueuePendingTimersRef.current.get(safeItemId);
    if (existingTimeoutId) {
      window.clearTimeout(existingTimeoutId);
      todoQueuePendingTimersRef.current.delete(safeItemId);
    }

    const startedAtMs = Date.now();
    const rawPhase = String(fields.phase || fields.state || "sending").trim().toLowerCase();
    const phase = rawPhase === "queued" ? "queued" : "sending";
    const requestedTimeoutMs = Number(fields.timeoutMs || 0);
    const timeoutMs = phase === "queued"
      ? 0
      : requestedTimeoutMs > 0
        ? requestedTimeoutMs
        : TODO_QUEUE_IN_FLIGHT_PROMPT_TIMEOUT_MS;
    const pendingItem = {
      cancellable: phase === "queued",
      item: fields.item || null,
      itemId: safeItemId,
      message: String(fields.message || ""),
      paneId: String(fields.paneId || ""),
      phase,
      reason: String(fields.reason || ""),
      startedAtMs,
      state: phase,
      targetRole: String(fields.targetRole || ""),
      targetTerminalIndex: fields.targetTerminalIndex ?? "",
      timeoutAtMs: timeoutMs ? startedAtMs + timeoutMs : 0,
      timeoutMs,
      workspaceId: String(fields.workspaceId || terminalWorkspace?.id || ""),
    };
    updateTodoQueueItems((currentItems) => (
      currentItems.map((item) => (
        item.id === safeItemId
          ? getTodoQueueItemWithPersistedQueueState(item, phase, {
            reason: pendingItem.reason,
            source: fields.source || "",
            targetAgentId: fields.targetAgentId || "",
            targetColorSlot: fields.targetColorSlot,
            targetTerminalColor: fields.targetTerminalColor || "",
            targetTerminalId: fields.targetTerminalId || "",
            targetTerminalIndex: pendingItem.targetTerminalIndex,
            targetThreadId: fields.targetThreadId || "",
            targetRole: pendingItem.targetRole,
          })
          : item
      ))
    ));
    if (timeoutMs) {
      const timeoutId = window.setTimeout(() => {
        const currentPendingItem = todoQueuePendingItemsRef.current[safeItemId];
        if (!currentPendingItem || Number(currentPendingItem.startedAtMs) !== startedAtMs) {
          return;
        }

        logBigViewSyncDiagnosticEvent("tui.text.todo_pending_timeout", {
          elapsedMs: Date.now() - startedAtMs,
          itemId: safeItemId,
          phase,
          surface: "tui_todo_queue",
          targetRole: pendingItem.targetRole,
          targetTerminalIndex: pendingItem.targetTerminalIndex,
          timeoutMs,
          workspaceId: pendingItem.workspaceId,
          ...fields,
        });
        logTerminalStatus("frontend.todo_queue.pending_timeout", {
          elapsedMs: Date.now() - startedAtMs,
          itemId: safeItemId,
          phase,
          targetRole: pendingItem.targetRole,
          targetTerminalIndex: pendingItem.targetTerminalIndex,
          timeoutMs,
          workspaceId: pendingItem.workspaceId,
          ...fields,
        });
        todoQueuePendingTimersRef.current.delete(safeItemId);
        const nextPendingItems = { ...todoQueuePendingItemsRef.current };
        delete nextPendingItems[safeItemId];
        replaceTodoQueuePendingItems(nextPendingItems);
        updateTodoQueueItems((currentItems) => (
          currentItems.map((item) => (
            item.id === safeItemId
              ? getTodoQueueItemWithoutPersistedQueueState(item)
              : item
          ))
        ));
      }, timeoutMs);

      todoQueuePendingTimersRef.current.set(safeItemId, timeoutId);
    }
    logBigViewSyncDiagnosticEvent("tui.text.todo_pending_start", {
      itemId: safeItemId,
      phase,
      surface: "tui_todo_queue",
      targetRole: pendingItem.targetRole,
      targetTerminalIndex: pendingItem.targetTerminalIndex,
      timeoutMs,
      workspaceId: pendingItem.workspaceId,
      ...fields,
    });
    logTerminalStatus("frontend.todo_queue.pending_start", {
      itemId: safeItemId,
      phase,
      targetRole: pendingItem.targetRole,
      targetTerminalIndex: pendingItem.targetTerminalIndex,
      timeoutMs,
      workspaceId: pendingItem.workspaceId,
      ...fields,
    });
    replaceTodoQueuePendingItems({
      ...todoQueuePendingItemsRef.current,
      [safeItemId]: pendingItem,
    });
  }, [replaceTodoQueuePendingItems, terminalWorkspace?.id, updateTodoQueueItems]);

  const queueReleasedVoicePlanTasks = useCallback((tasks, snapshot = null, options = {}) => {
    const releasedTasks = (Array.isArray(tasks) ? tasks : [])
      .map((task) => normalizeVoicePlanReleasedTask(task, snapshot))
      .filter(Boolean);
    logTerminalStatus("frontend.voice_plan.release_input", {
      rawTaskCount: Array.isArray(tasks) ? tasks.length : 0,
      releasedTaskCount: releasedTasks.length,
      releaseSource: String(options.source || "voice_plan_result").trim() || "voice_plan_result",
      snapshot: getVoicePlanSnapshotLogSummary(snapshot),
      tasks: releasedTasks.map(getVoicePlanTaskStatusLogSummary),
      workspaceId: terminalWorkspace?.id || "",
    });
    if (!releasedTasks.length) {
      return [];
    }

    if (snapshot?.runId) {
      voicePlanSnapshotsRef.current.set(snapshot.runId, snapshot);
    }

    const releaseSource = String(options.source || "voice_plan_result").trim() || "voice_plan_result";
    const eligibleTasks = [];
    const deferredTasks = [];
    const discardedTasks = [];
    releasedTasks.forEach((task) => {
      const taskKey = getVoicePlanReleasedTaskKey(task);
      const effectiveSnapshot = snapshot?.runId === task.runId
        ? snapshot
        : voicePlanSnapshotsRef.current.get(task.runId) || null;
      const decision = getVoicePlanTaskReleaseDecision(task, effectiveSnapshot);
      logTerminalStatus("frontend.voice_plan.release_decision", {
        decision,
        effectiveSnapshot: getVoicePlanSnapshotLogSummary(effectiveSnapshot),
        releaseSource,
        task: getVoicePlanTaskStatusLogSummary(task),
        workspaceId: terminalWorkspace?.id || "",
      });
      if (!decision.eligible) {
        const summary = {
          planRunId: task.runId,
          planStage: task.stage,
          planStepOrdinal: task.stepOrdinal,
          planTaskId: task.taskId,
          reason: decision.reason,
        };
        if (shouldDeferVoicePlanTaskRelease(decision.reason)) {
          voicePlanDeferredTasksRef.current.set(taskKey, {
            task,
            reason: decision.reason,
            source: releaseSource,
            updatedAtMs: Date.now(),
          });
          deferredTasks.push(summary);
        } else {
          voicePlanDeferredTasksRef.current.delete(taskKey);
          discardedTasks.push(summary);
        }
        return;
      }

      voicePlanDeferredTasksRef.current.delete(taskKey);
      eligibleTasks.push(task);
    });

    if (deferredTasks.length) {
      logTerminalStatus("frontend.voice_plan.released_tasks_deferred", {
        items: deferredTasks,
        planRunId: snapshot?.runId || releasedTasks[0]?.runId || "",
        releaseSource,
        snapshot: getVoicePlanSnapshotLogSummary(snapshot),
        workspaceId: terminalWorkspace?.id || "",
      });
      logBigViewSyncDiagnosticEvent("tui.voice_plan.released_tasks_deferred", {
        items: deferredTasks,
        planRunId: snapshot?.runId || releasedTasks[0]?.runId || "",
        source: releaseSource,
        surface: "tui_todo_queue",
        workspaceId: terminalWorkspace?.id || "",
      });
    }
    if (discardedTasks.length) {
      logTerminalStatus("frontend.voice_plan.released_tasks_discarded", {
        items: discardedTasks,
        planRunId: snapshot?.runId || releasedTasks[0]?.runId || "",
        releaseSource,
        snapshot: getVoicePlanSnapshotLogSummary(snapshot),
        workspaceId: terminalWorkspace?.id || "",
      });
      logBigViewSyncDiagnosticEvent("tui.voice_plan.released_tasks_discarded", {
        items: discardedTasks,
        planRunId: snapshot?.runId || releasedTasks[0]?.runId || "",
        source: releaseSource,
        surface: "tui_todo_queue",
        workspaceId: terminalWorkspace?.id || "",
      });
    }
    if (!eligibleTasks.length) {
      logTerminalStatus("frontend.voice_plan.release_no_eligible_tasks", {
        deferredTasks,
        discardedTasks,
        planRunId: snapshot?.runId || releasedTasks[0]?.runId || "",
        releaseSource,
        workspaceId: terminalWorkspace?.id || "",
      });
      return [];
    }

    const existingIds = new Set(todoQueueItemsRef.current.map((item) => item.id));
    const createdItems = eligibleTasks.reduce((items, task) => {
      if (
        existingIds.has(task.taskId)
        || todoQueuePendingItemsRef.current[task.taskId]
      ) {
        logTerminalStatus("frontend.voice_plan.release_duplicate_skip", {
          alreadyPending: Boolean(todoQueuePendingItemsRef.current[task.taskId]),
          alreadyQueued: existingIds.has(task.taskId),
          releaseSource,
          task: getVoicePlanTaskStatusLogSummary(task),
          workspaceId: terminalWorkspace?.id || "",
        });
        voicePlanDeferredTasksRef.current.delete(getVoicePlanReleasedTaskKey(task));
        return items;
      }
      const item = createTodoQueueItem(task.text, {
        id: task.taskId,
        planTask: {
          doneWhen: task.doneWhen,
          maxConcurrency: task.maxConcurrency,
          releasePolicy: task.releasePolicy,
          requiresQueueDrain: task.requiresQueueDrain,
          runId: task.runId,
          stage: task.stage,
          stepOrdinal: task.stepOrdinal,
          taskId: task.taskId,
          title: task.title,
        },
        source: TODO_QUEUE_SOURCE_VOICE_PLAN,
        workspaceId: terminalWorkspace?.id || "",
      });
      existingIds.add(item.id);
      return items.concat([item]);
    }, []);
    if (!createdItems.length) {
      logTerminalStatus("frontend.voice_plan.release_no_created_items", {
        eligibleTasks: eligibleTasks.map(getVoicePlanTaskStatusLogSummary),
        planRunId: snapshot?.runId || eligibleTasks[0]?.runId || "",
        releaseSource,
        workspaceId: terminalWorkspace?.id || "",
      });
      return [];
    }

    updateTodoQueueItems((currentItems) => {
      const currentIds = new Set(currentItems.map((item) => item.id));
      return currentItems.concat(createdItems.filter((item) => !currentIds.has(item.id)));
    });

    createdItems.forEach((item) => {
      setTodoQueueItemPending(item.id, {
        item: getTodoQueueItemLogSummary([item])[0] || null,
        phase: "queued",
        source: TODO_QUEUE_SOURCE_VOICE_PLAN,
        workspaceId: terminalWorkspace?.id || "",
      });
    });
    if (createdItems.length) {
      setTodoQueueDispatchRevision((revision) => revision + 1);
      logTerminalStatus("frontend.voice_plan.released_tasks_queued", {
        items: getTodoQueueItemLogSummary(createdItems),
        planRunId: snapshot?.runId || eligibleTasks[0]?.runId || "",
        releaseSource,
        workspaceId: terminalWorkspace?.id || "",
      });
      logBigViewSyncDiagnosticEvent("tui.voice_plan.released_tasks_queued", {
        items: getTodoQueueItemLogSummary(createdItems),
        planRunId: snapshot?.runId || eligibleTasks[0]?.runId || "",
        source: releaseSource,
        surface: "tui_todo_queue",
        workspaceId: terminalWorkspace?.id || "",
      });
    }
    return createdItems;
  }, [
    setTodoQueueItemPending,
    terminalWorkspace?.id,
    updateTodoQueueItems,
  ]);

  const handleVoicePlanServerResult = useCallback((value) => {
    const snapshot = getVoicePlanSnapshotFromPayload(value);
    const releasedTasks = getVoicePlanReleasedTasksFromPayload(value, snapshot);
    logTerminalStatus("frontend.voice_plan.server_result_received", {
      releasedTaskCount: releasedTasks.length,
      releasedTasks: releasedTasks.map(getVoicePlanTaskStatusLogSummary),
      snapshot: getVoicePlanSnapshotLogSummary(snapshot),
      workspaceId: terminalWorkspace?.id || "",
    });
    if (snapshot) {
      voicePlanSnapshotsRef.current.set(snapshot.runId, snapshot);
      window.dispatchEvent(new CustomEvent(VOICE_PLAN_SNAPSHOT_EVENT, {
        detail: { snapshot },
      }));
    }
    let queuedItems = [];
    if (releasedTasks.length) {
      queuedItems = queuedItems.concat(queueReleasedVoicePlanTasks(releasedTasks, snapshot, {
        source: "voice_plan_server_result",
      }));
    }
    if (snapshot?.runId) {
      const deferredTasks = Array.from(voicePlanDeferredTasksRef.current.values())
        .filter((entry) => entry?.task?.runId === snapshot.runId)
        .map((entry) => entry.task);
      if (deferredTasks.length) {
        logTerminalStatus("frontend.voice_plan.deferred_retry_start", {
          deferredTaskCount: deferredTasks.length,
          deferredTasks: deferredTasks.map(getVoicePlanTaskStatusLogSummary),
          snapshot: getVoicePlanSnapshotLogSummary(snapshot),
          workspaceId: terminalWorkspace?.id || "",
        });
        queuedItems = queuedItems.concat(queueReleasedVoicePlanTasks(deferredTasks, snapshot, {
          source: "voice_plan_deferred_release",
        }));
      }
    }
    logTerminalStatus("frontend.voice_plan.server_result_handled", {
      handled: Boolean(snapshot || releasedTasks.length || queuedItems.length),
      queuedItemCount: queuedItems.length,
      queuedItems: getTodoQueueItemLogSummary(queuedItems),
      releasedTaskCount: releasedTasks.length,
      snapshot: getVoicePlanSnapshotLogSummary(snapshot),
      workspaceId: terminalWorkspace?.id || "",
    });
    return Boolean(snapshot || releasedTasks.length || queuedItems.length);
  }, [queueReleasedVoicePlanTasks, terminalWorkspace?.id]);

  useEffect(() => {
    let disposed = false;
    let unlisten = null;

    listen(VOICE_PLAN_SERVER_RESULT_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const payload = event?.payload || {};
      const eventWorkspaceId = String(payload.workspaceId || payload.workspace_id || "").trim();
      if (eventWorkspaceId && terminalWorkspace?.id && eventWorkspaceId !== terminalWorkspace.id) {
        logTerminalStatus("frontend.voice_plan.backend_server_result_ignored", {
          eventWorkspaceId,
          reason: "workspace_mismatch",
          workspaceId: terminalWorkspace.id,
        });
        return;
      }
      logTerminalStatus("frontend.voice_plan.backend_server_result_event", {
        source: payload.source || "",
        statusPayload: payload.statusPayload || null,
        workspaceId: terminalWorkspace?.id || eventWorkspaceId,
      });
      const statusPayload = payload.statusPayload || {};
      const promptEventId = String(statusPayload.promptEventId || statusPayload.prompt_event_id || "").trim();
      if (promptEventId) {
        logTerminalStatus("frontend.voice_plan.backend_status_payload_not_lifecycle", {
          agentId: statusPayload.agentId || statusPayload.agent_id || "",
          promptEventId,
          source: payload.source || "backend_voice_plan_status",
          targetTerminalIndex: statusPayload.terminalIndex ?? statusPayload.terminal_index ?? "",
          reason: "backend_status_result_updates_snapshot_without_inferred_completion",
          status: statusPayload.status || "",
          threadId: statusPayload.threadId || statusPayload.thread_id || "",
          workspaceId: terminalWorkspace?.id || eventWorkspaceId,
        });
      }
      handleVoicePlanServerResult(payload.result || payload);
    }).then((nextUnlisten) => {
      if (disposed) {
        nextUnlisten?.();
        return;
      }
      unlisten = nextUnlisten;
    }).catch((error) => {
      logTerminalStatus("frontend.voice_plan.backend_server_result_listen_error", {
        message: error?.message || String(error || ""),
        workspaceId: terminalWorkspace?.id || "",
      });
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [handleVoicePlanServerResult, terminalWorkspace?.id]);

  const recordVoicePlanTaskStatus = useCallback(async (planTask, status, fields = {}) => {
    const normalizedPlanTask = normalizeTodoQueuePlanTask(planTask);
    const nextStatus = String(status || "").trim();
    if (!normalizedPlanTask || !nextStatus || !terminalWorkspace?.id) {
      return null;
    }

    const payload = {
      ...fields,
      planRunId: normalizedPlanTask.runId,
      planTaskId: normalizedPlanTask.taskId,
      planStage: normalizedPlanTask.stage,
      planStepOrdinal: normalizedPlanTask.stepOrdinal,
      planReleasePolicy: normalizedPlanTask.releasePolicy,
      planRequiresQueueDrain: normalizedPlanTask.requiresQueueDrain,
      planDoneWhen: normalizedPlanTask.doneWhen,
      status: nextStatus,
    };
    try {
      logTerminalStatus("frontend.voice_plan.status_send", {
        payload,
        repoPath: target.projectRoot || terminalWorkspaceWorkingDirectory || defaultWorkingDirectory || "",
        workspaceId: terminalWorkspace.id,
        workspaceName: terminalWorkspace.name || "",
      });
      const result = await invoke("cloud_mcp_record_voice_plan_task_status", {
        repoPath: terminalWorkspaceWorkingDirectory || defaultWorkingDirectory || "",
        status: payload,
        workspaceId: terminalWorkspace.id,
        workspaceName: terminalWorkspace.name || "",
      });
      logTerminalStatus("frontend.voice_plan.status_result", {
        planRunId: normalizedPlanTask.runId,
        planStage: normalizedPlanTask.stage,
        planStepOrdinal: normalizedPlanTask.stepOrdinal,
        planTaskId: normalizedPlanTask.taskId,
        resultSnapshot: getVoicePlanSnapshotLogSummary(getVoicePlanSnapshotFromPayload(result)),
        releasedTaskCount: getVoicePlanReleasedTasksFromPayload(result).length,
        status: nextStatus,
        workspaceId: terminalWorkspace.id,
      });
      handleVoicePlanServerResult(result);
      return result;
    } catch (error) {
      logTerminalStatus("frontend.voice_plan.status_error", {
        message: getTodoDropErrorMessage(error),
        payload,
        planRunId: normalizedPlanTask.runId,
        planTaskId: normalizedPlanTask.taskId,
        status: nextStatus,
        workspaceId: terminalWorkspace.id,
      });
      logBigViewSyncDiagnosticEvent("tui.voice_plan.status_error", {
        message: getTodoDropErrorMessage(error),
        planRunId: normalizedPlanTask.runId,
        planTaskId: normalizedPlanTask.taskId,
        status: nextStatus,
        surface: "tui_todo_queue",
        workspaceId: terminalWorkspace.id,
      });
      return null;
    }
  }, [
    defaultWorkingDirectory,
    handleVoicePlanServerResult,
    terminalWorkspace?.id,
    terminalWorkspace?.name,
    terminalWorkspaceWorkingDirectory,
  ]);

  useEffect(() => {
    const handleVoicePlanLifecycle = (event) => {
      const detail = event?.detail || {};
      const eventType = String(detail.type || "").trim();
      logTerminalStatus("frontend.voice_plan.lifecycle_event_received", {
        detail,
        eventType,
        workspaceId: terminalWorkspace?.id || "",
      });
      if (!["provider-turn-completed", "provider-turn-error"].includes(eventType)) {
        logTerminalStatus("frontend.voice_plan.lifecycle_event_ignored", {
          eventType,
          reason: "unsupported_event_type",
          workspaceId: terminalWorkspace?.id || "",
        });
        return;
      }
      const completionSource = String(detail.completionSource || detail.source || "").trim();
      if (
        eventType === "provider-turn-completed"
        && (
          detail.completionInferred === true
          || completionSource === "backend_terminal_prompt_ready"
          || completionSource === "terminal_prompt_ready"
        )
      ) {
        logTerminalStatus("frontend.voice_plan.lifecycle_event_ignored", {
          eventType,
          promptEventId: detail.promptEventId || detail.pendingPromptId || detail.promptId || "",
          reason: "inferred_completion_is_not_final",
          source: completionSource,
          workspaceId: terminalWorkspace?.id || "",
        });
        return;
      }
      const promptEventId = String(
        detail.promptEventId
          || detail.pendingPromptId
          || detail.promptId
          || "",
      ).trim();
      const planTask = getVoicePlanTaskFromPromptEventId(promptEventId);
      if (!planTask) {
        logTerminalStatus("frontend.voice_plan.lifecycle_event_ignored", {
          eventType,
          promptEventId,
          reason: "not_voice_plan_prompt",
          workspaceId: terminalWorkspace?.id || "",
        });
        return;
      }
      const currentSnapshot = voicePlanSnapshotsRef.current.get(planTask.runId) || null;
      const snapshotTask = getVoicePlanSnapshotTask(currentSnapshot, planTask);
      const snapshotTaskStatus = normalizeVoicePlanStatus(snapshotTask?.status);
      const lifecycleStatus = normalizeVoicePlanStatus(detail.status || detail.taskStatus || detail.task_status);
      if (
        eventType === "provider-turn-completed"
        && (
          VOICE_PLAN_PARKED_STATUSES.has(snapshotTaskStatus)
          || VOICE_PLAN_PARKED_STATUSES.has(lifecycleStatus)
        )
      ) {
        logTerminalStatus("frontend.voice_plan.lifecycle_event_ignored", {
          eventType,
          lifecycleStatus,
          planTask,
          promptEventId,
          reason: "parked_task_completion_is_not_final",
          snapshotStatus: snapshotTaskStatus,
          workspaceId: terminalWorkspace?.id || "",
        });
        return;
      }
      logTerminalStatus("frontend.voice_plan.lifecycle_event_recording_status", {
        eventType,
        planTask,
        promptEventId,
        terminalGroundTruthStatus: eventType === "provider-turn-error" ? "error" : "idle_or_done",
        workspaceId: terminalWorkspace?.id || "",
      });
      void recordVoicePlanTaskStatus(
        planTask,
        eventType === "provider-turn-error" ? "failed" : "done",
        {
          agentId: detail.agentId || detail.currentAgent || "",
          error: detail.error || "",
          outputTextLength: String(detail.outputText || detail.text || "").length,
          promptEventId,
          terminalId: detail.paneId || "",
          terminalIndex: Number.isFinite(Number(detail.terminalIndex))
            ? Number(detail.terminalIndex)
            : null,
          threadId: detail.threadId || "",
        },
      );
    };

    window.addEventListener(VOICE_PLAN_TASK_LIFECYCLE_EVENT, handleVoicePlanLifecycle);
    return () => {
      window.removeEventListener(VOICE_PLAN_TASK_LIFECYCLE_EVENT, handleVoicePlanLifecycle);
    };
  }, [recordVoicePlanTaskStatus, terminalWorkspace?.id]);

  useEffect(() => () => {
    todoQueuePendingTimersRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    todoQueuePendingTimersRef.current.clear();
    todoQueuePendingItemsRef.current = {};
  }, []);

  const recordTodoQueueSpecEditDispatch = useCallback(async ({
    item,
    paneId,
    target,
    targetBinding,
    targetRole,
    targetThread,
    workspaceId,
  } = {}) => {
    const specEdit = getTodoQueueItemSpecEdit(item);
    if (!specEdit?.intentId) {
      return;
    }

    const intentPayload = specEdit.intentPayload && typeof specEdit.intentPayload === "object"
      ? specEdit.intentPayload
      : {};
    const targetTerminalIndex = Number.isInteger(target?.targetTerminalIndex)
      ? target.targetTerminalIndex
      : null;
    const terminalInstanceId = String(targetBinding?.instanceId || "");
    const threadId = String(targetThread?.id || "");
    const agentId = String(targetRole || intentPayload.agent_id || "").trim();
    const nextWorkspaceId = specEdit.workspaceId || workspaceId || terminalWorkspace?.id || "";
    const dispatchedAt = new Date().toISOString();

    window.dispatchEvent(new CustomEvent(SPEC_EDIT_TODO_QUEUE_DISPATCH_EVENT, {
      detail: {
        agentId,
        agentLabel: target?.terminalAgent?.label || agentId || "agent",
        dispatchedAt,
        intentId: specEdit.intentId,
        terminalId: paneId || "",
        terminalIndex: targetTerminalIndex,
        terminalInstanceId,
        threadId,
        workspaceId: nextWorkspaceId,
      },
    }));
  }, [
    terminalWorkspace?.id,
    terminalWorkspace?.name,
  ]);

  const recordTodoQueueSpecEditCancelled = useCallback((item, reason = "cancelled", message = "") => {
    const specEdit = getTodoQueueItemSpecEdit(item);
    if (!specEdit?.intentId) {
      return;
    }

    const workspaceId = specEdit.workspaceId || terminalWorkspace?.id || "";

    window.dispatchEvent(new CustomEvent(SPEC_EDIT_TODO_QUEUE_CANCEL_EVENT, {
      detail: {
        intentId: specEdit.intentId,
        reason,
        workspaceId,
      },
    }));
  }, [
    terminalWorkspace?.id,
  ]);

  const sendTodoQueueItemToTerminal = useCallback(async ({
    allowGeneric = true,
    focusReason = "todo_dropdown_drop",
    item,
    requireAvailable = false,
    reservationItemId = "",
    source = "tui-todo-drop",
    targetTerminalIndex,
  } = {}) => {
    const currentItem = item && typeof item === "object" ? item : {};
    const itemLogSummary = getTodoQueueItemLogSummary([currentItem])[0] || null;
    const target = getTodoQueueTerminalSendTarget(targetTerminalIndex, currentItem, {
      allowGeneric,
      requireAvailable,
      reservationItemId,
    });
    const image = target.image || getTodoQueueItemImage(currentItem);
    const paneId = target.paneId || "";
    const targetRole = String(target.targetRole || "").toLowerCase();
    const shouldAutoSubmit = Boolean(target.shouldAutoSubmit);
    const workspaceId = target.workspaceId || currentItem.workspaceId || terminalWorkspace?.id || "";
    const targetLogIndex = Number.isInteger(target.targetTerminalIndex)
      ? target.targetTerminalIndex
      : targetTerminalIndex ?? "";
    const terminalWriteLogBase = {
      item: itemLogSummary,
      paneId,
      source,
      targetRole,
      targetTerminalIndex: targetLogIndex,
      workspaceId,
    };
    const planTask = getTodoQueueItemPlanTask(currentItem);

    logTerminalStatus("frontend.todo_queue.send_start", {
      ...terminalWriteLogBase,
      allowGeneric,
      focusReason,
      requireAvailable,
      targetAvailable: Boolean(target.available),
      targetReason: target.reason || "",
    });

    logBigViewSyncDiagnosticEvent("tui.image.drop_start", {
      hasImage: Boolean(image),
      item: itemLogSummary,
      paneId,
      shouldAutoSubmit,
      source,
      surface: "tui_terminal_grid",
      targetRole,
      targetTerminalIndex: targetLogIndex,
      workspaceId,
    });

    if (!target.available) {
      if (target.reason === "image_unsupported") {
        logBigViewSyncDiagnosticEvent("tui.image.drop_unsupported", {
          image: getTodoImageLogSummary([image])[0] || null,
          imageSupportReason: target.imageInputSupport?.reason || "",
          imageSupportState: target.imageInputSupport?.state || "",
          paneId,
          source,
          surface: "tui_terminal_grid",
          targetRole,
          targetTerminalIndex: targetLogIndex,
          workspaceId,
        });
      } else {
        logBigViewSyncDiagnosticEvent("tui.image.drop_skip", {
          hasImage: Boolean(image),
          paneId,
          reason: target.reason || "unavailable",
          source,
          surface: "tui_terminal_grid",
          targetTerminalIndex: targetLogIndex,
          workspaceId,
        });
      }

      if (requireAvailable) {
        logTerminalStatus("frontend.todo_queue.send_blocked", {
          ...terminalWriteLogBase,
          message: target.message || "",
          reason: target.reason || "terminal_unavailable",
        });
        throw createTodoQueueBusyError(target.reason || "terminal_unavailable", target.message);
      }

      logTerminalStatus("frontend.todo_queue.send_blocked", {
        ...terminalWriteLogBase,
        message: target.message || "",
        reason: target.reason || "terminal_unavailable",
      });
      throw new Error(target.message || "Choose an agent terminal for this todo.");
    }

    const targetThread = target.targetThread || null;
    const targetBinding = target.targetBinding || null;
    const syncKey = target.syncKey || "";
    setActiveTerminalPaneId(paneId);
    window.dispatchEvent(new CustomEvent(TERMINAL_FOCUS_REQUEST_EVENT, {
      detail: {
        paneId,
        reason: focusReason,
        terminalIndex: target.targetTerminalIndex,
      },
    }));

    const terminalText = await prepareTodoTerminalText(currentItem);
    const threadMessageText = getTodoQueueItemThreadMessageText(currentItem, terminalText);
    const lifecycleSource = getTodoQueueLifecycleSource(source, currentItem);
    let threadMessageLifecycleDispatched = false;
    const dispatchThreadMessageLifecycle = ({
      acceptedDetail = null,
      promptId = "",
      reason = "submit_observed",
      submittedAt = "",
      terminalText: lifecycleTerminalText = terminalText,
      threadMessageText: lifecycleThreadMessageText = threadMessageText,
    } = {}) => {
      const safePromptId = String(promptId || "").trim();
      const safeThreadMessageText = String(lifecycleThreadMessageText || "");
      const canDispatch = Boolean(
        shouldAutoSubmit
          && !image
          && safeThreadMessageText.trim()
          && targetThread?.id
          && targetRole
          && targetRole !== "generic"
          && targetRole !== "terminal"
          && targetRole !== "shell"
          && onThreadTerminalLifecycle,
      );
      if (!canDispatch) {
        const skipReason = !shouldAutoSubmit
          ? "manual_draft"
          : image
            ? "image_submission"
            : !safeThreadMessageText.trim()
              ? "empty_message"
              : !targetThread?.id
                ? "missing_thread"
                : !onThreadTerminalLifecycle
                  ? "missing_lifecycle_handler"
                  : "unsupported_target_role";
        logTerminalStatus("frontend.terminal_status.lifecycle_send_skip", {
          confirmedSubmit: true,
          hasLifecycleHandler: Boolean(onThreadTerminalLifecycle),
          hasTargetThread: Boolean(targetThread?.id),
          hasThreadMessageText: Boolean(safeThreadMessageText.trim()),
          item: getTodoQueueItemLogSummary([currentItem])[0] || null,
          promptId: safePromptId,
          reason: skipReason,
          source: lifecycleSource,
          targetRole,
          targetTerminalIndex: targetLogIndex,
          workspaceId,
        });
        logBigViewSyncDiagnosticEvent("tui.text.drop_lifecycle_skip", {
          confirmedSubmit: true,
          hasLifecycleHandler: Boolean(onThreadTerminalLifecycle),
          hasTargetThread: Boolean(targetThread?.id),
          hasThreadMessageText: Boolean(safeThreadMessageText.trim()),
          paneId,
          promptId: safePromptId,
          reason: skipReason,
          source: lifecycleSource,
          surface: "tui_terminal_grid",
          targetRole,
          targetTerminalIndex: targetLogIndex,
          workspaceId,
        });
        return false;
      }

      const providerSessionId = String(acceptedDetail?.sessionId || "").trim();
      threadMessageLifecycleDispatched = true;
      logTerminalStatus("frontend.terminal_status.lifecycle_send", {
        agentId: targetRole,
        eventStatus: "active",
        eventType: "message-submitted",
        item: getTodoQueueItemLogSummary([currentItem])[0] || null,
        acceptedMatchedBy: acceptedDetail?.matchedBy || "",
        pendingPromptId: safePromptId,
        promptEventId: safePromptId,
        providerSessionPresent: Boolean(providerSessionId),
        reason,
        source: lifecycleSource,
        targetTerminalIndex: target.targetTerminalIndex,
        terminalGroundTruthStatus: providerSessionId
          ? "processing_request_accepted"
          : "processing_request_submitted",
        threadId: targetThread.id,
        workspaceId,
      });
      handleWorkspaceTerminalLifecycle({
        agentId: targetRole,
        instanceId: targetBinding?.instanceId || "",
        inputReady: false,
        activityStatus: "thinking",
        messageCreatedAt: submittedAt || "",
        messageId: safePromptId,
        messageSource: lifecycleSource,
        paneId,
        pendingPromptDeliveryMode: "session-acceptance",
        pendingPromptId: safePromptId,
        pendingPromptText: safeThreadMessageText,
        promptEventId: safePromptId,
        promptEventSubmittedAt: submittedAt || "",
        providerSessionId,
        repoPath: terminalWorkspaceWorkingDirectory || defaultWorkingDirectory || "",
        sessionAcceptancePending: !providerSessionId,
        slotKey: targetThread?.slotKey || targetBinding?.slotKey || "",
        source: lifecycleSource,
        status: "active",
        terminalIndex: target.targetTerminalIndex,
        expectedUserMessage: String(lifecycleTerminalText || ""),
        threadId: targetThread.id,
        type: "message-submitted",
        userMessage: safeThreadMessageText,
        nativeSessionId: providerSessionId,
        nativeSessionKind: providerSessionId ? "session" : "",
        nativeSessionSource: providerSessionId ? "terminal-confirmed" : "",
        workspaceId,
        workspaceName: terminalWorkspace?.name || "",
      });
      logBigViewSyncDiagnosticEvent("tui.text.drop_lifecycle_dispatched", {
        agentId: targetRole,
        paneId,
        promptId: safePromptId,
        reason,
        source: lifecycleSource,
        surface: "tui_terminal_grid",
        syncKey,
        submitConfirmed: true,
        targetTerminalIndex: targetLogIndex,
        terminalText: getBigViewTextDiagnosticFields(lifecycleTerminalText || ""),
        threadId: targetThread.id,
        threadMessageText: getBigViewTextDiagnosticFields(safeThreadMessageText),
        workspaceId,
      });
      return true;
    };
    const attachmentSource = getTodoQueueAttachmentSource(source);
    const queuedAttachment = image
      ? todoImageToComposerAttachment(image, 0, attachmentSource)
      : null;

    if (queuedAttachment && syncKey) {
      appendWorkspaceThreadComposerAttachments(syncKey, [queuedAttachment], {
        fields: {
          image: getTodoImageLogSummary([image])[0] || null,
          paneId,
          source,
          surface: "tui_terminal_grid",
          targetRole,
          targetTerminalIndex: targetLogIndex,
          workspaceId,
        },
        source: attachmentSource,
      });
    }
    if (queuedAttachment && !syncKey) {
      logBigViewSyncDiagnosticEvent("tui.image.drop_attachment_skip", {
        image: getTodoImageLogSummary([image])[0] || null,
        paneId,
        reason: "missing_sync_key",
        source,
        surface: "tui_terminal_grid",
        targetRole,
        targetTerminalIndex: targetLogIndex,
        workspaceId,
      });
    }

    let dropResult = null;
    let draftTransaction = null;
    let draftTransactionId = "";
    if (!terminalText && queuedAttachment) {
      if (!syncKey) {
        throw new Error("Unable to queue image because this terminal has no thread composer.");
      }
      logBigViewSyncDiagnosticEvent("tui.image.drop_queued_only", {
        attachmentQueued: Boolean(syncKey),
        image: getTodoImageLogSummary([image])[0] || null,
        paneId,
        shouldAutoSubmit,
        source,
        syncKey,
        surface: "tui_terminal_grid",
        targetRole,
        targetTerminalIndex: targetLogIndex,
        text: getBigViewTextDiagnosticFields(threadMessageText),
        workspaceId,
      });
      dropResult = {
        imageOnly: true,
        syncKey,
        targetBinding,
        targetThread,
        terminalText,
        threadMessageText,
      };
    } else {
      if (!terminalText) {
        throw new Error("Add text, an image, or a pasted note before sending this todo to a terminal.");
      }

      const previousDraft = syncKey
        ? String(getWorkspaceThreadComposerDraftStore().get(syncKey) || "")
        : "";
      const terminalSubmitSequence = getTerminalSubmitSequence(targetRole, false);
      const shouldConfirmAutoSubmit = Boolean(
        shouldAutoSubmit
          && !image
          && terminalSubmitSequence
          && targetThread?.id
          && paneId
          && targetBinding?.instanceId,
      );
      if (shouldAutoSubmit && !shouldConfirmAutoSubmit) {
        logBigViewSyncDiagnosticEvent("tui.text.drop_submit_blocked", {
          hasInstanceId: Boolean(targetBinding?.instanceId),
          hasPaneId: Boolean(paneId),
          hasSubmitSequence: Boolean(terminalSubmitSequence),
          hasTargetThread: Boolean(targetThread?.id),
          paneId,
          reason: !terminalSubmitSequence
            ? "missing_submit_sequence"
            : !targetThread?.id
              ? "missing_thread"
              : !paneId
                ? "missing_pane"
                : "missing_instance",
          source,
          surface: "tui_terminal_grid",
          targetRole,
          targetTerminalIndex: targetLogIndex,
          terminalText: getBigViewTextDiagnosticFields(terminalText),
          workspaceId,
        });
        throw new Error("Unable to confirm this todo submission for the selected terminal.");
      }
      const promptId = shouldConfirmAutoSubmit
        ? getTodoQueueItemPlanTask(currentItem)?.taskId
          || getTodoQueueItemSpecEdit(currentItem)?.intentId
          || createThreadProjectionToken("todo-drop-prompt")
        : "";
      draftTransactionId = promptId
        || String(currentItem?.id || currentItem?.itemId || createThreadProjectionToken("todo-draft"));
      if (syncKey) {
        draftTransaction = setWorkspaceThreadComposerDraft(syncKey, terminalText, {
          source: shouldConfirmAutoSubmit ? "todo_queue_submit_sync" : "todo_queue_draft_sync",
          transactionId: draftTransactionId,
        });
      }
      logBigViewSyncDiagnosticEvent("tui.image.drop_prepared", {
        attachmentQueued: Boolean(queuedAttachment && syncKey),
        draftRevision: draftTransaction?.revision || 0,
        hasImageAttachmentBlock: false,
        hasQueuedImage: Boolean(queuedAttachment),
        paneId,
        shouldAutoSubmit,
        sharedDraftSynced: Boolean(syncKey && draftTransaction),
        source,
        submitConfirmationRequired: shouldConfirmAutoSubmit,
        syncKey,
        surface: "tui_terminal_grid",
        targetRole,
        targetTerminalIndex: targetLogIndex,
        terminalText: getBigViewTextDiagnosticFields(terminalText),
        terminalTextLength: terminalText.length,
        threadMessageText: getBigViewTextDiagnosticFields(threadMessageText),
        workspaceId,
      });
      if (!shouldConfirmAutoSubmit) {
        const draftWriteStartedAt = performance.now();
        logTerminalStatus("frontend.todo_queue.terminal_write.draft_start", {
          ...terminalWriteLogBase,
          dataLength: terminalText.length,
          instanceId: targetBinding?.instanceId || "",
          threadId: targetThread?.id || "",
        });
        let writeResult = null;
        try {
          const draftSyncData = buildTerminalComposerDraftInput(previousDraft, terminalText, true);
          writeResult = await invoke("terminal_write", {
            data: draftSyncData || terminalText,
            instanceId: targetBinding?.instanceId,
            paneId,
            threadId: targetThread?.id || "",
          });
          logTerminalStatus("frontend.todo_queue.terminal_write.draft_done", {
            ...terminalWriteLogBase,
            dataLength: terminalText.length,
            draftRevision: draftTransaction?.revision || 0,
            elapsedMs: Math.round(performance.now() - draftWriteStartedAt),
            instanceId: targetBinding?.instanceId || "",
            threadId: targetThread?.id || "",
          });
        } catch (error) {
          logTerminalStatus("frontend.todo_queue.terminal_write.draft_error", {
            ...terminalWriteLogBase,
            dataLength: terminalText.length,
            draftRevision: draftTransaction?.revision || 0,
            elapsedMs: Math.round(performance.now() - draftWriteStartedAt),
            instanceId: targetBinding?.instanceId || "",
            message: error?.message || String(error || ""),
            threadId: targetThread?.id || "",
          });
          throw error;
        }
        dropResult = {
          confirmedSubmit: false,
          syncKey,
          targetBinding,
          targetThread,
          terminalText,
          threadMessageText,
          writeResult,
        };
      } else {
        const registerInFlightPrompt = (submittedAt) => {
          if (!Number.isInteger(Number(target.targetTerminalIndex))) {
            return;
          }

          todoQueueTerminalInFlightPromptsRef.current.set(Number(target.targetTerminalIndex), {
            agentId: targetRole,
            itemId: currentItem.id || currentItem.itemId || "",
            lifecycleSource,
            paneId,
            promptId,
            promptEventSubmittedAt: submittedAt,
            promptText: terminalText,
            source,
            startedAtMs: Date.now(),
            submittedAt,
            submittedAtMs: Date.parse(submittedAt) || Date.now(),
            targetTerminalIndex: target.targetTerminalIndex,
            terminalInstanceId: targetBinding?.instanceId || "",
            terminalText,
            threadMessageText,
            threadId: targetThread.id,
            workspaceId,
          });
          setTodoQueueDispatchRevision((revision) => revision + 1);
          logTerminalStatus("frontend.todo_queue.in_flight_prompt_registered", {
            item: getTodoQueueItemLogSummary([currentItem])[0] || null,
            promptEventId: promptId,
            source,
            submittedAt,
            targetTerminalIndex: target.targetTerminalIndex,
            threadId: targetThread.id,
            workspaceId,
          });
        };
        const clearInFlightPrompt = (reason, fields = {}) => {
          if (!Number.isInteger(Number(target.targetTerminalIndex))) {
            return;
          }

          const inFlightPrompt = todoQueueTerminalInFlightPromptsRef.current.get(Number(target.targetTerminalIndex));
          if (String(inFlightPrompt?.promptId || "") !== promptId) {
            return;
          }

          todoQueueTerminalInFlightPromptsRef.current.delete(Number(target.targetTerminalIndex));
          setTodoQueueDispatchRevision((revision) => revision + 1);
          logTerminalStatus("frontend.todo_queue.in_flight_prompt_cleared", {
            ...fields,
            promptEventId: promptId,
            reason,
            source,
            targetTerminalIndex: target.targetTerminalIndex,
            threadId: targetThread.id,
            workspaceId,
          });
        };
        const clearInFlightPromptOnError = (reason) => clearInFlightPrompt(reason);
        const syncData = buildTerminalComposerDraftInput(previousDraft, terminalText, true);
        const requestDropSubmitSnapshot = (reason, delayMs = 0, extraFields = {}) => {
          requestTerminalSubmitDiagnosticSnapshot({
            agentId: targetRole,
            delayMs,
            expectedPrompt: terminalText,
            expectedPromptLength: terminalText.length,
            paneId,
            promptId,
            reason,
            syncKey,
            targetTerminalIndex: targetLogIndex,
            threadId: targetThread.id,
            workspaceId,
            ...extraFields,
          });
        };
        logBigViewSyncDiagnosticEvent("tui.text.drop_sync_start", {
          agentId: targetRole,
          draftRevision: draftTransaction?.revision || 0,
          paneId,
          previousDraftLength: previousDraft.length,
          promptId,
          source,
          syncData: getTerminalInputDebugFields(syncData),
          syncDataHasForceReplace: syncData.includes("\x15"),
          syncDataHasShiftEnter: syncData.includes(TERMINAL_SHIFT_ENTER_SEQUENCE),
          syncDataLength: syncData.length,
          syncKey,
          surface: "tui_terminal_grid",
          targetTerminalIndex: targetLogIndex,
          terminalText: getBigViewTextDiagnosticFields(terminalText),
          threadId: targetThread.id,
          workspaceId,
        });
        const syncWriteStartedAt = performance.now();
        if (syncData) {
          logTerminalStatus("frontend.todo_queue.terminal_write.sync_start", {
            ...terminalWriteLogBase,
            atomicSubmit: false,
            draftRevision: draftTransaction?.revision || 0,
            instanceId: targetBinding?.instanceId || "",
            promptEventId: promptId,
            reason: "composer_sync_before_submit",
            syncDataLength: syncData.length,
            threadId: targetThread.id,
          });
          try {
            await invoke("terminal_write", {
              data: syncData,
              instanceId: targetBinding?.instanceId,
              paneId,
              threadId: targetThread.id,
            });
            logTerminalStatus("frontend.todo_queue.terminal_write.sync_done", {
              ...terminalWriteLogBase,
              atomicSubmit: false,
              draftRevision: draftTransaction?.revision || 0,
              elapsedMs: Math.round(performance.now() - syncWriteStartedAt),
              instanceId: targetBinding?.instanceId || "",
              promptEventId: promptId,
              reason: "composer_sync_before_submit",
              syncDataLength: syncData.length,
              threadId: targetThread.id,
            });
          } catch (syncError) {
            logTerminalStatus("frontend.todo_queue.terminal_write.sync_error", {
              ...terminalWriteLogBase,
              atomicSubmit: false,
              draftRevision: draftTransaction?.revision || 0,
              elapsedMs: Math.round(performance.now() - syncWriteStartedAt),
              instanceId: targetBinding?.instanceId || "",
              message: syncError?.message || String(syncError || ""),
              promptEventId: promptId,
              reason: "composer_sync_before_submit",
              syncDataLength: syncData.length,
              threadId: targetThread.id,
            });
            throw syncError;
          }
        } else {
          logTerminalStatus("frontend.todo_queue.terminal_write.sync_skip", {
            ...terminalWriteLogBase,
            draftRevision: draftTransaction?.revision || 0,
            instanceId: targetBinding?.instanceId || "",
            promptEventId: promptId,
            reason: "empty_sync_data",
            threadId: targetThread.id,
          });
        }
        const syncWriteDurationMs = Math.round(performance.now() - syncWriteStartedAt);
        logBigViewSyncDiagnosticEvent("tui.text.drop_sync_done", {
          agentId: targetRole,
          atomicSubmit: false,
          draftRevision: draftTransaction?.revision || 0,
          paneId,
          promptId,
          source,
          syncDataLength: syncData.length,
          syncKey,
          syncWriteDurationMs,
          surface: "tui_terminal_grid",
          targetTerminalIndex: targetLogIndex,
          threadId: targetThread.id,
          workspaceId,
        });
        requestDropSubmitSnapshot("tui.text.drop_after_sync_before_enter");
        requestDropSubmitSnapshot("tui.text.drop_after_sync_before_enter_80ms", 80);
        requestDropSubmitSnapshot("tui.text.drop_after_sync_before_enter_300ms", 300);
        requestDropSubmitSnapshot("tui.text.drop_after_sync_before_enter_900ms", 900);
        if (syncData && TODO_QUEUE_SUBMIT_SYNC_SETTLE_MS > 0) {
          await new Promise((resolve) => {
            window.setTimeout(resolve, TODO_QUEUE_SUBMIT_SYNC_SETTLE_MS);
          });
        }
        const acceptedWaiter = createWorkspaceThreadPromptAcceptedWaiter({
          agentId: targetRole,
          expectedPrompt: terminalText,
          promptId,
          threadId: targetThread.id,
          timeoutMs: TODO_QUEUE_IN_FLIGHT_PROMPT_TIMEOUT_MS,
          workspaceId,
        });
        const clearUnconfirmedSubmitDraft = async (reason, submitError) => {
          if (!syncKey) {
            return;
          }
          const clearResult = clearWorkspaceThreadComposerDraftIfRevision(syncKey, draftTransaction?.revision || 0, {
            expectedValue: terminalText,
            source: "todo_queue_unconfirmed_clear",
            transactionId: draftTransactionId,
          });
          if (!clearResult.cleared) {
            logTerminalStatus("frontend.todo_queue.terminal_write.unconfirmed_clear_skip", {
              ...terminalWriteLogBase,
              currentDraftLength: String(clearResult.value || "").length,
              currentDraftRevision: clearResult.revision || 0,
              expectedDraftRevision: draftTransaction?.revision || 0,
              instanceId: targetBinding?.instanceId || "",
              promptEventId: promptId,
              reason: clearResult.reason || "draft_changed",
              submitError: submitError?.message || String(submitError || ""),
              threadId: targetThread.id,
            });
            return;
          }

          const clearInputData = buildTerminalComposerDraftInput(terminalText, "", true);
          if (!clearInputData) {
            return;
          }
          try {
            await invoke("terminal_write", {
              data: clearInputData,
              instanceId: targetBinding?.instanceId,
              paneId,
              threadId: targetThread.id,
            });
            logTerminalStatus("frontend.todo_queue.terminal_write.unconfirmed_clear_done", {
              ...terminalWriteLogBase,
              draftRevision: draftTransaction?.revision || 0,
              instanceId: targetBinding?.instanceId || "",
              promptEventId: promptId,
              reason,
              threadId: targetThread.id,
            });
          } catch (clearError) {
            logTerminalStatus("frontend.todo_queue.terminal_write.unconfirmed_clear_error", {
              ...terminalWriteLogBase,
              instanceId: targetBinding?.instanceId || "",
              message: clearError?.message || String(clearError || ""),
              promptEventId: promptId,
              reason,
              threadId: targetThread.id,
            });
          }
        };
        try {
          let submittedAt = new Date().toISOString();
          const promptEventSource = getTodoQueuePromptEventSource(source, currentItem);
          registerInFlightPrompt(submittedAt);
          let writeResult = null;
          let submittedPayload = null;
          let lastSubmitError = null;
          const submitAttemptDelays = [0, ...TODO_QUEUE_SUBMIT_RETRY_DELAYS_MS];
          for (let submitAttemptIndex = 0; submitAttemptIndex < submitAttemptDelays.length; submitAttemptIndex += 1) {
            const retryDelayMs = Number(submitAttemptDelays[submitAttemptIndex] || 0);
            const isRetry = submitAttemptIndex > 0;
            if (retryDelayMs > 0) {
              await new Promise((resolve) => {
                window.setTimeout(resolve, retryDelayMs);
              });
            }
            const currentDraft = syncKey
              ? String(getWorkspaceThreadComposerDraftStore().get(syncKey) || "")
              : terminalText;
            const currentDraftRecord = syncKey
              ? getWorkspaceThreadComposerDraftRecord(syncKey)
              : { revision: draftTransaction?.revision || 0, value: terminalText };
            const draftStillMatchesTransaction = Boolean(
              currentDraft === terminalText
                && (
                  !syncKey
                    || !draftTransaction?.revision
                    || currentDraftRecord.revision === draftTransaction.revision
                )
            );
            if (!draftStillMatchesTransaction) {
              const draftChangedError = new Error("The terminal draft changed before the queued todo could be submitted.");
              draftChangedError.terminalPromptSubmitMismatch = true;
              draftChangedError.terminalPromptSubmitUnobserved = true;
              draftChangedError.currentDraftRevision = currentDraftRecord.revision || 0;
              draftChangedError.expectedDraftRevision = draftTransaction?.revision || 0;
              throw draftChangedError;
            }
            const attemptSubmittedAt = isRetry ? new Date().toISOString() : submittedAt;
            const submitTransactionData = terminalSubmitSequence;
            const submittedWaiter = await createTerminalPromptSubmittedWaiter({
              agentId: targetRole,
              expectedPrompt: terminalText,
              instanceId: targetBinding?.instanceId,
              paneId,
              promptId,
              requirePromptMatch: true,
              threadId: targetThread.id,
              workspaceId,
            });
            logBigViewSyncDiagnosticEvent("tui.text.drop_enter_write", {
              agentId: targetRole,
              atomicSubmit: false,
              attempt: submitAttemptIndex + 1,
              draftRevision: draftTransaction?.revision || 0,
              paneId,
              promptId,
              retry: isRetry,
              source,
              submitSequenceLength: terminalSubmitSequence.length,
              syncDataLength: syncData.length,
              syncKey,
              surface: "tui_terminal_grid",
              targetTerminalIndex: targetLogIndex,
              terminalText: getBigViewTextDiagnosticFields(terminalText),
              threadId: targetThread.id,
              workspaceId,
            });
            const submitWriteStartedAt = performance.now();
            logTerminalStatus("frontend.todo_queue.terminal_write.submit_start", {
              ...terminalWriteLogBase,
              atomicSubmit: false,
              attempt: submitAttemptIndex + 1,
              draftRevision: draftTransaction?.revision || 0,
              instanceId: targetBinding?.instanceId || "",
              promptEventId: promptId,
              promptEventSource,
              promptEventSubmittedAt: attemptSubmittedAt,
              promptTextLength: terminalText.length,
              retry: isRetry,
              submitSequenceLength: terminalSubmitSequence.length,
              syncDataLength: syncData.length,
              threadId: targetThread.id,
            });
            try {
              writeResult = await invoke("terminal_write", {
                data: submitTransactionData,
                instanceId: targetBinding?.instanceId,
                paneId,
                promptEventId: promptId,
                promptEventSource,
                promptEventSubmittedAt: attemptSubmittedAt,
                promptEventText: terminalText,
                threadId: targetThread.id,
              });
              logTerminalStatus("frontend.todo_queue.terminal_write.submit_done", {
                ...terminalWriteLogBase,
                atomicSubmit: false,
                attempt: submitAttemptIndex + 1,
                draftRevision: draftTransaction?.revision || 0,
                elapsedMs: Math.round(performance.now() - submitWriteStartedAt),
                instanceId: targetBinding?.instanceId || "",
                promptEventId: promptId,
                promptEventSource,
                promptEventSubmittedAt: attemptSubmittedAt,
                promptTextLength: terminalText.length,
                retry: isRetry,
                submitSequenceLength: terminalSubmitSequence.length,
                syncDataLength: syncData.length,
                threadId: targetThread.id,
              });
              requestDropSubmitSnapshot("tui.text.drop_after_enter_write_40ms", 40, {
                attempt: submitAttemptIndex + 1,
                submitSequenceLength: terminalSubmitSequence.length,
              });
              requestDropSubmitSnapshot("tui.text.drop_after_enter_write", 160, {
                attempt: submitAttemptIndex + 1,
                submitSequenceLength: terminalSubmitSequence.length,
              });
              requestDropSubmitSnapshot("tui.text.drop_after_enter_write_500ms", 500, {
                attempt: submitAttemptIndex + 1,
                submitSequenceLength: terminalSubmitSequence.length,
              });
              requestDropSubmitSnapshot("tui.text.drop_after_enter_write_1200ms", 1200, {
                attempt: submitAttemptIndex + 1,
                submitSequenceLength: terminalSubmitSequence.length,
              });
              submittedPayload = await submittedWaiter.promise;
              submittedAt = attemptSubmittedAt;
              break;
            } catch (error) {
              submittedWaiter.cancel();
              lastSubmitError = error;
              logTerminalStatus("frontend.todo_queue.terminal_write.submit_error", {
                ...terminalWriteLogBase,
                attempt: submitAttemptIndex + 1,
                elapsedMs: Math.round(performance.now() - submitWriteStartedAt),
                instanceId: targetBinding?.instanceId || "",
                message: error?.message || String(error || ""),
                promptEventId: promptId,
                promptEventSource,
                promptEventSubmittedAt: attemptSubmittedAt,
                promptTextLength: terminalText.length,
                retry: isRetry,
                submitSequenceLength: terminalSubmitSequence.length,
                threadId: targetThread.id,
                willRetry: submitAttemptIndex < submitAttemptDelays.length - 1,
              });
              if (submitAttemptIndex >= submitAttemptDelays.length - 1) {
                throw error;
              }
            }
          }
          if (!submittedPayload) {
            throw lastSubmitError || new Error("Timed out waiting for the prompt to be observed in the terminal.");
          }
          const inFlightPrompt = todoQueueTerminalInFlightPromptsRef.current.get(Number(target.targetTerminalIndex));
          if (String(inFlightPrompt?.promptId || "") === promptId) {
            todoQueueTerminalInFlightPromptsRef.current.set(Number(target.targetTerminalIndex), {
              ...inFlightPrompt,
              submittedAt,
              submittedAtMs: Date.parse(submittedAt) || Date.now(),
            });
          }
          logTerminalStatus("frontend.todo_queue.terminal_write.submit_observed", {
            ...terminalWriteLogBase,
            instanceId: targetBinding?.instanceId || "",
            promptEventId: promptId,
            promptMatch: submittedPayload?.promptMatch !== false,
            promptSource: submittedPayload?.promptSource || "",
            threadId: targetThread.id,
          });
          logBigViewSyncDiagnosticEvent("tui.text.drop_submit_observed", {
            agentId: targetRole,
            paneId,
            promptMatch: submittedPayload?.promptMatch !== false,
            promptSource: submittedPayload?.promptSource || "",
            promptId,
            source,
            syncKey,
            surface: "tui_terminal_grid",
            targetTerminalIndex: targetLogIndex,
            threadId: targetThread.id,
            workspaceId,
          });
          const lifecycleDispatchedAtSubmit = false;
          let acceptedDetail = null;
          let acceptedDraftClearResult = null;
          const clearAcceptedSubmitDraft = (detail, reason = "todo_queue_submit_accepted_clear") => {
            if (!syncKey || !detail) {
              return null;
            }

            const clearResult = clearWorkspaceThreadComposerDraftIfRevision(syncKey, draftTransaction?.revision || 0, {
              expectedValue: terminalText,
              source: reason,
              transactionId: draftTransactionId,
            });
            acceptedDraftClearResult = clearResult;
            logTerminalStatus("frontend.todo_queue.terminal_write.draft_clear", {
              ...terminalWriteLogBase,
              cleared: Boolean(clearResult?.cleared),
              currentDraftLength: String(clearResult?.value || "").length,
              currentDraftRevision: clearResult?.revision || 0,
              expectedDraftRevision: draftTransaction?.revision || 0,
              instanceId: targetBinding?.instanceId || "",
              promptEventId: promptId,
              reason: clearResult?.reason || reason,
              threadId: targetThread.id,
            });
            logBigViewSyncDiagnosticEvent("tui.text.drop_visible_input_clear", {
              acceptedMatchedBy: detail?.matchedBy || "",
              agentId: targetRole,
              cleared: Boolean(clearResult?.cleared),
              draftRevision: draftTransaction?.revision || 0,
              paneId,
              promptId,
              reason,
              source,
              syncKey,
              targetTerminalIndex: targetLogIndex,
              threadId: targetThread.id,
              workspaceId,
            });
            return clearResult;
          };
          const recordAcceptedDetail = (detail, matchedByFallback = "") => {
            if (!detail) {
              return null;
            }
            const acceptedMatchedBy = detail?.matchedBy || matchedByFallback || "";
            const targetTerminalNumber = Number(target.targetTerminalIndex);
            const inFlightPrompt = todoQueueTerminalInFlightPromptsRef.current.get(targetTerminalNumber);
            const lifecycleDispatchedAtAcceptance = dispatchThreadMessageLifecycle({
              acceptedDetail: {
                ...detail,
                matchedBy: acceptedMatchedBy,
              },
              promptId,
              reason: "session_accepted",
              submittedAt,
              terminalText,
              threadMessageText,
            });
            if (String(inFlightPrompt?.promptId || "") === promptId) {
              todoQueueTerminalInFlightPromptsRef.current.set(targetTerminalNumber, {
                ...inFlightPrompt,
                accepted: true,
                acceptedAt: new Date().toISOString(),
                acceptedAtMs: Date.now(),
                acceptedMatchedBy,
                lifecycleDispatched: Boolean(
                  inFlightPrompt?.lifecycleDispatched || lifecycleDispatchedAtAcceptance,
                ),
                sessionId: detail?.sessionId || inFlightPrompt?.sessionId || "",
              });
            }
            logTerminalStatus("frontend.todo_queue.terminal_write.accepted", {
              ...terminalWriteLogBase,
              acceptedMatchedBy,
              instanceId: targetBinding?.instanceId || "",
              lifecycleDispatched: lifecycleDispatchedAtAcceptance,
              promptEventId: promptId,
              sessionIdPresent: Boolean(detail?.sessionId),
              threadId: targetThread.id,
            });
            logBigViewSyncDiagnosticEvent("tui.text.drop_submit_accepted", {
              acceptedMatchedBy,
              agentId: targetRole,
              lifecycleDispatched: lifecycleDispatchedAtAcceptance,
              paneId,
              promptId,
              sessionIdPresent: Boolean(detail?.sessionId),
              source,
              syncKey,
              surface: "tui_terminal_grid",
              targetTerminalIndex: targetLogIndex,
              threadId: targetThread.id,
              workspaceId,
            });
            return detail;
          };
          const acceptedMonitorPromise = acceptedWaiter.promise
            .then((detail) => {
              const recordedDetail = recordAcceptedDetail(detail, "acceptance-waiter");
              clearAcceptedSubmitDraft(recordedDetail, "todo_queue_submit_accepted_clear");
              return recordedDetail;
            })
            .catch((acceptError) => {
              logTerminalStatus("frontend.todo_queue.terminal_write.accept_wait_done", {
                ...terminalWriteLogBase,
                instanceId: targetBinding?.instanceId || "",
                message: acceptError?.message || String(acceptError || ""),
                promptEventId: promptId,
                reason: "acceptance_wait_timeout_or_error",
                threadId: targetThread.id,
              });
              return null;
            });
          acceptedDetail = await Promise.race([
            acceptedMonitorPromise,
            new Promise((resolve) => {
              window.setTimeout(() => resolve(null), TODO_QUEUE_PROMPT_ACCEPT_GRACE_MS);
            }),
          ]);
          if (!acceptedDetail) {
            logTerminalStatus("frontend.todo_queue.terminal_write.accept_deferred", {
              ...terminalWriteLogBase,
              graceMs: TODO_QUEUE_PROMPT_ACCEPT_GRACE_MS,
              instanceId: targetBinding?.instanceId || "",
              promptEventId: promptId,
              reason: "terminal_submit_observed_waiting_for_session_acceptance",
              threadId: targetThread.id,
            });
            logBigViewSyncDiagnosticEvent("tui.text.drop_visible_input_clear_skip", {
              agentId: targetRole,
              draftRevision: draftTransaction?.revision || 0,
              paneId,
              promptId,
              reason: "session_acceptance_pending_keep_shared_draft",
              source,
              syncKey,
              targetTerminalIndex: targetLogIndex,
              threadId: targetThread.id,
              workspaceId,
            });
          }
          logTerminalStatus("frontend.todo_queue.in_flight_prompt_acknowledged", {
            ...terminalWriteLogBase,
            acceptedMatchedBy: acceptedDetail?.matchedBy || "",
            awaitingSessionAcceptance: !acceptedDetail,
            instanceId: targetBinding?.instanceId || "",
            promptEventId: promptId,
            reason: acceptedDetail
              ? "session_accepted_waiting_for_terminal_ready"
              : "terminal_submit_confirmed_waiting_for_session_acceptance",
            threadId: targetThread.id,
          });
          dropResult = {
            acceptedDetail,
            confirmedSubmit: true,
            draftClearedOnAcceptance: Boolean(acceptedDraftClearResult?.cleared),
            draftRevision: draftTransaction?.revision || 0,
            draftTransactionId,
            lifecycleDispatchedAtSubmit,
            promptId,
            promptEventSubmittedAt: submittedAt,
            sessionAccepted: Boolean(acceptedDetail),
            syncKey,
            targetBinding,
            targetThread,
            terminalText,
            threadMessageText,
            writeResult,
          };
        } catch (submitError) {
          clearInFlightPromptOnError("submit_error");
          acceptedWaiter.cancel();
          if (
            submitError?.terminalPromptSubmitUnobserved
            || String(submitError?.message || "").includes("Timed out waiting for the prompt")
          ) {
            await clearUnconfirmedSubmitDraft("submit_not_observed", submitError);
          }
          requestTerminalSubmitDiagnosticSnapshot({
            agentId: targetRole,
            expectedPrompt: terminalText,
            expectedPromptLength: terminalText.length,
            paneId,
            promptId,
            reason: "tui.text.drop_submit_confirm_error_snapshot",
            syncKey,
            targetTerminalIndex: targetLogIndex,
            threadId: targetThread.id,
            workspaceId,
          });
          logBigViewSyncDiagnosticEvent("tui.text.drop_submit_confirm_error", {
            agentId: targetRole,
            message: submitError?.message || String(submitError || ""),
            paneId,
            promptId,
            source,
            syncKey,
            surface: "tui_terminal_grid",
            targetTerminalIndex: targetLogIndex,
            threadId: targetThread.id,
            workspaceId,
          });
          logTerminalStatus("frontend.todo_queue.terminal_write.confirm_error", {
            ...terminalWriteLogBase,
            instanceId: targetBinding?.instanceId || "",
            message: submitError?.message || String(submitError || ""),
            promptEventId: promptId,
            threadId: targetThread.id,
          });
          throw submitError;
        }
      }
    }

    const writeResult = dropResult?.writeResult || null;
    const resultThreadMessageText = String(dropResult?.threadMessageText || "");
    const shouldDispatchThreadMessage = Boolean(
      !threadMessageLifecycleDispatched
        && dropResult?.confirmedSubmit
        && (dropResult?.sessionAccepted || dropResult?.acceptedDetail)
        && shouldAutoSubmit
        && !image
        && resultThreadMessageText.trim()
        && targetThread?.id
        && targetRole
        && targetRole !== "generic"
        && targetRole !== "terminal"
        && targetRole !== "shell"
        && onThreadTerminalLifecycle,
    );
    if (shouldDispatchThreadMessage) {
      logTerminalStatus("frontend.terminal_status.lifecycle_send", {
        agentId: targetRole,
        eventStatus: "active",
        eventType: "message-submitted",
        item: getTodoQueueItemLogSummary([currentItem])[0] || null,
        pendingPromptId: dropResult?.promptId || "",
        promptEventId: dropResult?.promptId || "",
        source: lifecycleSource,
        targetTerminalIndex: target.targetTerminalIndex,
        terminalGroundTruthStatus: "processing_request_submitted",
        threadId: targetThread.id,
        workspaceId,
      });
      handleWorkspaceTerminalLifecycle({
        agentId: targetRole,
        instanceId: targetBinding?.instanceId || "",
        inputReady: false,
        activityStatus: "thinking",
        messageCreatedAt: dropResult?.promptEventSubmittedAt || "",
        messageId: dropResult?.promptId || "",
        messageSource: lifecycleSource,
        paneId,
        pendingPromptDeliveryMode: "session-acceptance",
        pendingPromptId: dropResult?.promptId || "",
        pendingPromptText: resultThreadMessageText,
        promptEventId: dropResult?.promptId || "",
        promptEventSubmittedAt: dropResult?.promptEventSubmittedAt || "",
        repoPath: terminalWorkspaceWorkingDirectory || defaultWorkingDirectory || "",
        sessionAcceptancePending: true,
        slotKey: targetThread?.slotKey || targetBinding?.slotKey || "",
        source: lifecycleSource,
        status: "active",
        terminalIndex: target.targetTerminalIndex,
        expectedUserMessage: dropResult?.terminalText || "",
        threadId: targetThread.id,
        type: "message-submitted",
        userMessage: resultThreadMessageText,
        workspaceId,
        workspaceName: terminalWorkspace?.name || "",
      });
      logBigViewSyncDiagnosticEvent("tui.text.drop_lifecycle_dispatched", {
        agentId: targetRole,
        paneId,
        promptId: dropResult?.promptId || "",
        source: lifecycleSource,
        surface: "tui_terminal_grid",
        syncKey,
        submitConfirmed: true,
        targetTerminalIndex: targetLogIndex,
        terminalText: getBigViewTextDiagnosticFields(dropResult?.terminalText || ""),
        threadId: targetThread.id,
        threadMessageText: getBigViewTextDiagnosticFields(resultThreadMessageText),
        workspaceId,
      });
    } else if (shouldAutoSubmit && !image && !threadMessageLifecycleDispatched) {
      logTerminalStatus("frontend.terminal_status.lifecycle_send_skip", {
        confirmedSubmit: Boolean(dropResult?.confirmedSubmit),
        hasLifecycleHandler: Boolean(onThreadTerminalLifecycle),
        hasTargetThread: Boolean(targetThread?.id),
        hasThreadMessageText: Boolean(resultThreadMessageText.trim()),
        item: getTodoQueueItemLogSummary([currentItem])[0] || null,
        promptId: dropResult?.promptId || "",
        source: lifecycleSource,
        targetRole,
        targetTerminalIndex: targetLogIndex,
        workspaceId,
      });
      logBigViewSyncDiagnosticEvent("tui.text.drop_lifecycle_skip", {
        confirmedSubmit: Boolean(dropResult?.confirmedSubmit),
        hasLifecycleHandler: Boolean(onThreadTerminalLifecycle),
        hasTargetThread: Boolean(targetThread?.id),
        hasThreadMessageText: Boolean(resultThreadMessageText.trim()),
        paneId,
        promptId: dropResult?.promptId || "",
        reason: !dropResult?.confirmedSubmit
          ? "submit_not_confirmed"
          : !resultThreadMessageText.trim()
          ? "empty_message"
          : !targetThread?.id
            ? "missing_thread"
            : !onThreadTerminalLifecycle
              ? "missing_lifecycle_handler"
              : "unsupported_target_role",
        source: lifecycleSource,
        surface: "tui_terminal_grid",
        targetRole,
        targetTerminalIndex: targetLogIndex,
        workspaceId,
      });
    }
    let finalDraftClearResult = null;
    const dropDraftRevision = Number(dropResult?.draftRevision || draftTransaction?.revision || 0);
    const shouldRunFinalDraftClear = Boolean(
      syncKey
        && shouldAutoSubmit
        && (dropResult?.sessionAccepted || dropResult?.acceptedDetail)
        && !dropResult?.draftClearedOnAcceptance,
    );
    if (shouldRunFinalDraftClear) {
      finalDraftClearResult = clearWorkspaceThreadComposerDraftIfRevision(syncKey, dropDraftRevision, {
        expectedValue: dropResult?.terminalText || terminalText,
        source: "todo_queue_final_clear",
        transactionId: dropResult?.draftTransactionId || draftTransactionId,
      });
      logTerminalStatus("frontend.todo_queue.terminal_write.final_draft_clear", {
        ...terminalWriteLogBase,
        cleared: Boolean(finalDraftClearResult.cleared),
        currentDraftLength: String(finalDraftClearResult.value || "").length,
        currentDraftRevision: finalDraftClearResult.revision || 0,
        expectedDraftRevision: dropDraftRevision,
        reason: finalDraftClearResult.reason || "",
        threadId: targetThread?.id || "",
      });
    } else if (syncKey && shouldAutoSubmit) {
      logTerminalStatus("frontend.todo_queue.terminal_write.final_draft_clear_skip", {
        ...terminalWriteLogBase,
        acceptedMatchedBy: dropResult?.acceptedDetail?.matchedBy || "",
        draftClearedOnAcceptance: Boolean(dropResult?.draftClearedOnAcceptance),
        expectedDraftRevision: dropDraftRevision,
        promptEventId: dropResult?.promptId || "",
        reason: dropResult?.sessionAccepted || dropResult?.acceptedDetail
          ? "draft_already_cleared_on_acceptance"
          : "session_acceptance_pending_keep_shared_draft",
        threadId: targetThread?.id || "",
      });
    }
    if (dropResult?.confirmedSubmit && isSpecEditTodoQueueItem(currentItem)) {
      await recordTodoQueueSpecEditDispatch({
        item: currentItem,
        paneId,
        target,
        targetBinding,
        targetRole,
        targetThread,
        workspaceId,
      });
    }
      if (dropResult?.confirmedSubmit && planTask) {
        await recordVoicePlanTaskStatus(planTask, "dispatched", {
          agentId: targetRole,
          clientTodoId: currentItem.id || "",
          lifecycleDispatchedAtSubmit: Boolean(dropResult?.lifecycleDispatchedAtSubmit),
          promptEventId: dropResult?.promptId || planTask.taskId,
          sessionAccepted: Boolean(dropResult?.sessionAccepted || dropResult?.acceptedDetail),
          terminalId: paneId,
          terminalIndex: target.targetTerminalIndex,
          threadId: targetThread?.id || "",
        });
      dropResult.planTaskStatusRecorded = true;
    }
    logBigViewSyncDiagnosticEvent("tui.image.drop_write_done", {
      imageOnlyQueued: Boolean(dropResult?.imageOnly || writeResult?.imageOnly),
      hadQueueItem: Boolean(currentItem.itemId || currentItem.id),
      hasImage: Boolean(image),
      paneId,
      shouldAutoSubmit,
      sharedDraftCleared: Boolean(
        dropResult?.draftClearedOnAcceptance
          || finalDraftClearResult?.cleared,
      ),
      source,
      submitConfirmed: Boolean(dropResult?.confirmedSubmit),
      syncKey,
      surface: "tui_terminal_grid",
      targetRole,
      targetTerminalIndex: targetLogIndex,
      terminalText: getBigViewTextDiagnosticFields(dropResult?.terminalText || ""),
      threadMessageText: getBigViewTextDiagnosticFields(resultThreadMessageText),
      workspaceId,
    });
    logTerminalStatus("frontend.todo_queue.send_done", {
      ...terminalWriteLogBase,
      imageOnlyQueued: Boolean(dropResult?.imageOnly || writeResult?.imageOnly),
      promptEventId: dropResult?.promptId || "",
      submitConfirmed: Boolean(dropResult?.confirmedSubmit),
      terminalTextLength: String(dropResult?.terminalText || "").length,
      threadId: targetThread?.id || "",
    });

    return dropResult;
  }, [
    clearTodoQueueItemPending,
      defaultWorkingDirectory,
      getTodoQueueTerminalSendTarget,
      handleWorkspaceTerminalLifecycle,
      onThreadTerminalLifecycle,
    recordTodoQueueSpecEditDispatch,
    recordVoicePlanTaskStatus,
    terminalWorkspace?.id,
    terminalWorkspace?.name,
    terminalWorkspaceWorkingDirectory,
  ]);

  const submitTodoQueueDraft = useCallback((options = {}) => {
    const text = normalizeTodoQueueText(todoQueueDraft);
    const images = dedupeTodoQueueImages(Array.isArray(options.images) ? options.images : [options.image]);
    const note = normalizeTodoQueueNote(options.note);

    if (!text && !images.length && !note) {
      return [];
    }

    const nextItems = images.length
      ? images.map((image, imageIndex) => (
        createTodoQueueItem(imageIndex === 0 ? text : "", {
          image,
          ...(imageIndex === 0 && note ? { note } : {}),
        })
      ))
      : [createTodoQueueItem(text, note ? { note } : {})];

    if (images.length) {
      logBigViewSyncDiagnosticEvent("tui.image.queue_add", {
        draftLength: text.length,
        imageCount: images.length,
        images: getTodoImageLogSummary(images),
        items: getTodoQueueItemLogSummary(nextItems),
        notePresent: Boolean(note),
        surface: "tui_todo_queue",
        workspaceId: terminalWorkspace?.id || "",
      });
    }
    updateTodoQueueItems((currentItems) => currentItems.concat(nextItems));
    setTodoDropError("");
    setTodoQueueDraft("");
    return nextItems;
  }, [todoQueueDraft, updateTodoQueueItems]);

  const removeTodoQueueItem = useCallback((itemId) => {
    const item = todoQueueItemsRef.current.find((candidate) => candidate.id === itemId) || null;
    if (item && isSpecEditTodoQueueItem(item)) {
      recordTodoQueueSpecEditCancelled(item, "removed", "User removed the queued spec edit.");
    }
    const planTask = getTodoQueueItemPlanTask(item);
    if (planTask) {
      void recordVoicePlanTaskStatus(planTask, "cancelled", {
        clientTodoId: item.id || "",
        reason: "removed",
      });
    }
    clearTodoQueueItemPending(itemId, "removed");
    updateTodoQueueItems((currentItems) => (
      currentItems.filter((item) => item.id !== itemId)
    ));
  }, [
    clearTodoQueueItemPending,
    recordTodoQueueSpecEditCancelled,
    recordVoicePlanTaskStatus,
    updateTodoQueueItems,
  ]);

  const queueTodoQueueItem = useCallback((itemId) => {
    const safeItemId = String(itemId || "").trim();
    if (!safeItemId) {
      return;
    }

    const item = todoQueueItems.find((candidate) => candidate.id === safeItemId);
    const pendingItem = todoQueuePendingItemsRef.current[safeItemId] || null;
    if (!item || (pendingItem && getTodoQueuePendingPhase(pendingItem) === "sending")) {
      logTerminalStatus("frontend.todo_queue.manual_queue_skip", {
        itemId: safeItemId,
        pendingPhase: pendingItem ? getTodoQueuePendingPhase(pendingItem) : "",
        reason: !item ? "missing_item" : "already_sending",
        workspaceId: terminalWorkspace?.id || "",
      });
      return;
    }

    const source = getTodoQueueItemAutoQueueSource(item);
    logTerminalStatus("frontend.todo_queue.manual_queue", {
      item: getTodoQueueItemLogSummary([item])[0] || null,
      source,
      workspaceId: item.workspaceId || terminalWorkspace?.id || "",
    });
    setTodoDropError("");
    setTodoQueueItemPending(safeItemId, {
      item: getTodoQueueItemLogSummary([item])[0] || null,
      phase: "queued",
      source,
      workspaceId: item.workspaceId || terminalWorkspace?.id || "",
    });
    const planTask = getTodoQueueItemPlanTask(item);
    if (planTask) {
      void recordVoicePlanTaskStatus(planTask, "queued", {
        clientTodoId: item.id || "",
      });
    }
    setTodoQueueDispatchRevision((revision) => revision + 1);
  }, [
    recordVoicePlanTaskStatus,
    setTodoQueueItemPending,
    terminalWorkspace?.id,
    todoQueueItems,
  ]);

  const claimVoiceAgentToolCall = useCallback((toolCall) => {
    const toolCallSignature = getVoiceAgentToolCallSignature(toolCall);
    if (toolCallSignature) {
      if (voiceAgentToolCallIdsRef.current.has(toolCallSignature)) {
        return false;
      }
      if (voiceAgentToolCallIdsRef.current.size > 200) {
        voiceAgentToolCallIdsRef.current.clear();
      }
      voiceAgentToolCallIdsRef.current.add(toolCallSignature);
    }
    return true;
  }, []);

  const executeVoiceAgentOpenCodingAgentsToolCall = useCallback(async (toolCall) => {
    const args = normalizeVoiceAgentQueueArguments(toolCall?.arguments || toolCall?.args);
    const action = normalizeVoiceAgentOpenCodingAgentsAction(args.action);
    const agentType = normalizeVoiceAgentManagementAgent(args.agent_type);
    const count = Math.max(1, Math.min(12, Number.parseInt(args.count, 10) || 1));

    try {
      const result = await manageWorkspaceAgents?.({
        action,
        agentType,
        count,
        source: "voice-agent-open-coding-agents",
        workspaceId: terminalWorkspace?.id || "",
      });
      const message = result?.message || "Coding-agent terminals updated.";
      window.dispatchEvent(new CustomEvent(VOICE_AGENT_OPEN_CODING_AGENTS_RESULT_EVENT, {
        detail: {
          message,
          status: "ready",
          toolCall,
          workspaceId: terminalWorkspace?.id || "",
        },
      }));
      logBigViewSyncDiagnosticEvent("tui.voice_agent.open_coding_agents", {
        action,
        agentType,
        count,
        result,
        surface: "tui_orchestrator_voice",
        workspaceId: terminalWorkspace?.id || "",
      });
      return result;
    } catch (error) {
      const message = getErrorMessage(error, "Unable to open coding-agent terminals.");
      window.dispatchEvent(new CustomEvent(VOICE_AGENT_OPEN_CODING_AGENTS_RESULT_EVENT, {
        detail: {
          message,
          status: "error",
          toolCall,
          workspaceId: terminalWorkspace?.id || "",
        },
      }));
      logBigViewSyncDiagnosticEvent("tui.voice_agent.open_coding_agents_error", {
        action,
        agentType,
        count,
        message,
        surface: "tui_orchestrator_voice",
        workspaceId: terminalWorkspace?.id || "",
      });
      return null;
    }
  }, [
    manageWorkspaceAgents,
    terminalWorkspace?.id,
  ]);

  const handleVoiceAgentToolCall = useCallback((toolCall) => {
    const toolName = String(toolCall?.name || toolCall?.tool_name || toolCall?.toolName || "").trim();
    logTerminalStatus("frontend.voice_agent.tool_call_handle", {
      callId: String(toolCall?.call_id || toolCall?.callId || "").trim(),
      toolName,
      workspaceId: terminalWorkspace?.id || "",
    });
    if (toolName === "open_coding_agents") {
      if (!claimVoiceAgentToolCall(toolCall)) {
        logTerminalStatus("frontend.voice_agent.tool_call_skip", {
          reason: "duplicate_open_coding_agents",
          toolName,
          workspaceId: terminalWorkspace?.id || "",
        });
        return null;
      }
      void executeVoiceAgentOpenCodingAgentsToolCall(toolCall);
      return null;
    }
    if (toolName === "create_plan") {
      if (!claimVoiceAgentToolCall(toolCall)) {
        logTerminalStatus("frontend.voice_agent.tool_call_skip", {
          reason: "duplicate_create_plan",
          toolName,
          workspaceId: terminalWorkspace?.id || "",
        });
        return null;
      }
      const args = normalizeVoiceAgentQueueArguments(toolCall?.arguments || toolCall?.args);
      const handledPlanResult = handleVoicePlanServerResult(toolCall) || handleVoicePlanServerResult(args);
      logTerminalStatus("frontend.voice_agent.create_plan_tool_call", {
        handledPlanResult,
        snapshot: getVoicePlanSnapshotLogSummary(getVoicePlanSnapshotFromPayload(args) || getVoicePlanSnapshotFromPayload(toolCall)),
        toolName,
        workspaceId: terminalWorkspace?.id || "",
      });
      return null;
    }
    if (toolName && toolName !== "queue") {
      logTerminalStatus("frontend.voice_agent.tool_call_skip", {
        reason: "unsupported_tool",
        toolName,
        workspaceId: terminalWorkspace?.id || "",
      });
      return null;
    }
    if (!claimVoiceAgentToolCall(toolCall)) {
      logTerminalStatus("frontend.voice_agent.tool_call_skip", {
        reason: "duplicate_queue",
        toolName,
        workspaceId: terminalWorkspace?.id || "",
      });
      return null;
    }

    const item = createTodoQueueItemFromVoiceAgentToolCall(toolCall);
    if (!item) {
      logTerminalStatus("frontend.voice_agent.tool_call_skip", {
        reason: "invalid_queue_item",
        toolName,
        workspaceId: terminalWorkspace?.id || "",
      });
      return null;
    }
    const planTask = getTodoQueueItemPlanTask(item);
    if (planTask) {
      logTerminalStatus("frontend.voice_plan.tool_call_release", {
        item: getTodoQueueItemLogSummary([item])[0] || null,
        planTask,
        snapshot: getVoicePlanSnapshotLogSummary(voicePlanSnapshotsRef.current.get(planTask.runId) || null),
        workspaceId: terminalWorkspace?.id || "",
      });
      const createdItems = queueReleasedVoicePlanTasks([{
        doneWhen: planTask.doneWhen,
        maxConcurrency: planTask.maxConcurrency,
        releasePolicy: planTask.releasePolicy,
        requiresQueueDrain: planTask.requiresQueueDrain,
        runId: planTask.runId,
        stage: planTask.stage,
        stepOrdinal: planTask.stepOrdinal,
        taskId: planTask.taskId,
        title: planTask.title,
        text: getTodoQueueItemTerminalText(item) || item.text,
      }], voicePlanSnapshotsRef.current.get(planTask.runId) || null, {
        source: "voice_agent_tool_call",
      });
      return createdItems[0] || null;
    }

    const callId = String(toolCall?.call_id || toolCall?.callId || "").trim();
    const source = getTodoQueueItemAutoQueueSource(item);
    updateTodoQueueItems((currentItems) => currentItems.concat([item]));
    setTodoDropError("");
    logTerminalStatus("frontend.voice_agent.queue_item_created", {
      callId,
      item: getTodoQueueItemLogSummary([item])[0] || null,
      source,
      workspaceId: terminalWorkspace?.id || "",
    });
    setTodoQueueItemPending(item.id, {
      item: getTodoQueueItemLogSummary([item])[0] || null,
      phase: "queued",
      source,
      workspaceId: terminalWorkspace?.id || "",
    });
    setTodoQueueDispatchRevision((revision) => revision + 1);

    logBigViewSyncDiagnosticEvent("tui.text.voice_agent_queue", {
      callId,
      item: getTodoQueueItemLogSummary([item])[0] || null,
      source,
      surface: "tui_todo_queue",
      workspaceId: terminalWorkspace?.id || "",
    });

    return item;
  }, [
    claimVoiceAgentToolCall,
    executeVoiceAgentOpenCodingAgentsToolCall,
    handleVoicePlanServerResult,
    queueReleasedVoicePlanTasks,
    recordVoicePlanTaskStatus,
    setTodoQueueItemPending,
    terminalWorkspace?.id,
    updateTodoQueueItems,
  ]);

  useEffect(() => {
    const handleSpecEditQueueEvent = (event) => {
      const detail = event?.detail || {};
      const eventWorkspaceId = String(detail.workspaceId || detail.item?.workspaceId || "").trim();
      if (!terminalWorkspace?.id || eventWorkspaceId !== terminalWorkspace.id) {
        return;
      }

      const item = normalizeTodoQueueItem({
        ...(detail.item || {}),
        kind: TODO_QUEUE_KIND_SPEC_EDIT,
        source: TODO_QUEUE_SOURCE_SPEC_EDIT_AUTO,
        workspaceId: eventWorkspaceId,
      });
      if (!item || !isSpecEditTodoQueueItem(item)) {
        return;
      }

      updateTodoQueueItems((currentItems) => (
        currentItems
          .filter((candidate) => candidate.id !== item.id)
          .concat([item])
      ));
      setTodoDropError("");
      setTodoQueueItemPending(item.id, {
        item: getTodoQueueItemLogSummary([item])[0] || null,
        phase: "queued",
        source: TODO_QUEUE_SOURCE_SPEC_EDIT_AUTO,
        workspaceId: terminalWorkspace.id,
      });
      setTodoQueueDispatchRevision((revision) => revision + 1);
      logBigViewSyncDiagnosticEvent("spec_edit.queue_added", {
        intentId: getTodoQueueItemSpecEdit(item)?.intentId || item.id,
        item: getTodoQueueItemLogSummary([item])[0] || null,
        source: TODO_QUEUE_SOURCE_SPEC_EDIT_AUTO,
        surface: "tui_todo_queue",
        workspaceId: terminalWorkspace.id,
      });
    };

    window.addEventListener(SPEC_EDIT_TODO_QUEUE_EVENT, handleSpecEditQueueEvent);
    return () => {
      window.removeEventListener(SPEC_EDIT_TODO_QUEUE_EVENT, handleSpecEditQueueEvent);
    };
  }, [
    setTodoQueueItemPending,
    terminalWorkspace?.id,
    updateTodoQueueItems,
  ]);

  useEffect(() => {
    const handleRemoteTodoQueueEvent = (event) => {
      const detail = event?.detail || {};
      const eventWorkspaceId = String(detail.workspaceId || detail.item?.workspaceId || "").trim();
      if (!terminalWorkspace?.id || eventWorkspaceId !== terminalWorkspace.id) {
        return;
      }

      const item = normalizeTodoQueueItem({
        ...(detail.item || {}),
        kind: "todo",
        source: TODO_QUEUE_SOURCE_REMOTE_CONTROL,
        workspaceId: eventWorkspaceId,
      });
      if (!item) {
        return;
      }

      const receiptKey = getTodoQueueRemoteCommandReceiptKey(item, terminalWorkspace.id);
      const receipt = receiptKey
        ? todoQueueRemoteCommandReceiptsRef.current[receiptKey] || null
        : null;
      if (receiptKey && todoQueueRemoteCommandReceiptBlocks(receipt)) {
        logBigViewSyncDiagnosticEvent("remote_control.queue_duplicate_skip", {
          commandId: detail.commandId || item.remoteCommand?.commandId || item.id,
          item: getTodoQueueItemLogSummary([item])[0] || null,
          receiptStatus: receipt?.status || "",
          receiptUpdatedAtMs: Number(receipt?.updatedAtMs || 0),
          source: TODO_QUEUE_SOURCE_REMOTE_CONTROL,
          targetAgentId: getTodoQueueTargetAgentId(item),
          targetColorSlot: getTodoQueueTargetColorSlot(item),
          targetTerminalColor: getTodoQueueTargetTerminalColor(item),
          targetTerminalId: getTodoQueueTargetTerminalId(item),
          targetTerminalIndex: getTodoQueueTargetTerminalIndex(item),
          targetThreadId: getTodoQueueTargetThreadId(item),
          workspaceId: terminalWorkspace.id,
        });
        logTerminalStatus("frontend.todo_queue.remote_duplicate_skip", {
          commandId: detail.commandId || item.remoteCommand?.commandId || item.id,
          itemId: item.id,
          receiptStatus: receipt?.status || "",
          source: TODO_QUEUE_SOURCE_REMOTE_CONTROL,
          targetTerminalIndex: getTodoQueueTargetTerminalIndex(item) ?? "",
          workspaceId: terminalWorkspace.id,
        });
        return;
      }

      const duplicateItem = todoQueueItemsRef.current.find((candidate) => (
        candidate.id === item.id || todoQueueRemoteItemsMatch(candidate, item)
      ));
      if (duplicateItem && todoQueuePendingItemsRef.current[duplicateItem.id]) {
        logBigViewSyncDiagnosticEvent("remote_control.queue_duplicate_skip", {
          commandId: detail.commandId || item.remoteCommand?.commandId || item.id,
          duplicateItem: getTodoQueueItemLogSummary([duplicateItem])[0] || null,
          item: getTodoQueueItemLogSummary([item])[0] || null,
          source: TODO_QUEUE_SOURCE_REMOTE_CONTROL,
          targetAgentId: getTodoQueueTargetAgentId(item),
          targetColorSlot: getTodoQueueTargetColorSlot(item),
          targetTerminalColor: getTodoQueueTargetTerminalColor(item),
          targetTerminalId: getTodoQueueTargetTerminalId(item),
          targetTerminalIndex: getTodoQueueTargetTerminalIndex(item),
          targetThreadId: getTodoQueueTargetThreadId(item),
          workspaceId: terminalWorkspace.id,
        });
        logTerminalStatus("frontend.todo_queue.remote_duplicate_skip", {
          commandId: detail.commandId || item.remoteCommand?.commandId || item.id,
          duplicateItemId: duplicateItem.id,
          itemId: item.id,
          pendingPhase: getTodoQueuePendingPhase(todoQueuePendingItemsRef.current[duplicateItem.id]),
          source: TODO_QUEUE_SOURCE_REMOTE_CONTROL,
          targetTerminalIndex: getTodoQueueTargetTerminalIndex(item) ?? "",
          workspaceId: terminalWorkspace.id,
        });
        return;
      }

      recordTodoQueueRemoteCommandReceipt(item, "queued", {
        workspaceId: terminalWorkspace.id,
      });
      updateTodoQueueItems((currentItems) => (
        currentItems
          .filter((candidate) => candidate.id !== item.id)
          .concat([item])
      ));
      setTodoDropError("");
      setTodoQueueItemPending(item.id, {
        item: getTodoQueueItemLogSummary([item])[0] || null,
        phase: "queued",
        source: TODO_QUEUE_SOURCE_REMOTE_CONTROL,
        targetRole: getTodoQueueTargetAgentId(item),
        targetColorSlot: getTodoQueueTargetColorSlot(item),
        targetTerminalColor: getTodoQueueTargetTerminalColor(item),
        targetTerminalId: getTodoQueueTargetTerminalId(item),
        targetTerminalIndex: getTodoQueueTargetTerminalIndex(item),
        targetThreadId: getTodoQueueTargetThreadId(item),
        workspaceId: terminalWorkspace.id,
      });
      setTodoQueueDispatchRevision((revision) => revision + 1);
      logBigViewSyncDiagnosticEvent("remote_control.queue_added", {
        commandId: detail.commandId || item.remoteCommand?.commandId || item.id,
        item: getTodoQueueItemLogSummary([item])[0] || null,
        source: TODO_QUEUE_SOURCE_REMOTE_CONTROL,
        targetAgentId: getTodoQueueTargetAgentId(item),
        targetColorSlot: getTodoQueueTargetColorSlot(item),
        targetTerminalColor: getTodoQueueTargetTerminalColor(item),
        targetTerminalId: getTodoQueueTargetTerminalId(item),
        targetTerminalIndex: getTodoQueueTargetTerminalIndex(item),
        targetThreadId: getTodoQueueTargetThreadId(item),
        surface: "tui_todo_queue",
        workspaceId: terminalWorkspace.id,
      });
    };

    window.addEventListener(REMOTE_TODO_QUEUE_EVENT, handleRemoteTodoQueueEvent);
    return () => {
      window.removeEventListener(REMOTE_TODO_QUEUE_EVENT, handleRemoteTodoQueueEvent);
    };
  }, [
    recordTodoQueueRemoteCommandReceipt,
    setTodoQueueItemPending,
    terminalWorkspace?.id,
    updateTodoQueueItems,
  ]);

  const cancelQueuedTodoQueueItem = useCallback((itemId) => {
    const safeItemId = String(itemId || "").trim();
    const pendingItem = safeItemId ? todoQueuePendingItemsRef.current[safeItemId] || null : null;
    if (!pendingItem || getTodoQueuePendingPhase(pendingItem) !== "queued") {
      return;
    }

    const item = todoQueueItemsRef.current.find((candidate) => candidate.id === safeItemId) || null;
    const source = item ? getTodoQueueItemAutoQueueSource(item) : TODO_QUEUE_SOURCE_TODO_AUTO;
    clearTodoQueueItemPending(safeItemId, "cancelled", {
      source,
    });
    if (item && isSpecEditTodoQueueItem(item)) {
      recordTodoQueueSpecEditCancelled(item, "cancelled", "User cancelled the queued spec edit.");
      updateTodoQueueItems((currentItems) => (
        currentItems.filter((candidate) => candidate.id !== safeItemId)
      ));
    } else {
      const planTask = getTodoQueueItemPlanTask(item);
      if (planTask) {
        void recordVoicePlanTaskStatus(planTask, "cancelled", {
          clientTodoId: item.id || "",
          reason: "cancelled",
        });
        updateTodoQueueItems((currentItems) => (
          currentItems.filter((candidate) => candidate.id !== safeItemId)
        ));
      }
    }
    setTodoQueueDispatchRevision((revision) => revision + 1);
  }, [
    clearTodoQueueItemPending,
    recordTodoQueueSpecEditCancelled,
    recordVoicePlanTaskStatus,
    updateTodoQueueItems,
  ]);

  const reorderTodoQueueItem = useCallback((itemId, targetIndex) => {
    updateTodoQueueItems((currentItems) => {
      const currentIndex = currentItems.findIndex((item) => item.id === itemId);
      if (currentIndex < 0) {
        return currentItems;
      }

      const movingItem = currentItems[currentIndex];
      const withoutItem = currentItems.filter((item) => item.id !== itemId);
      const rawTargetIndex = Math.max(
        0,
        Math.min(Number.parseInt(targetIndex, 10) || 0, currentItems.length),
      );
      const adjustedTargetIndex = currentIndex < rawTargetIndex
        ? rawTargetIndex - 1
        : rawTargetIndex;
      const nextTargetIndex = Math.max(0, Math.min(adjustedTargetIndex, withoutItem.length));

      if (nextTargetIndex === currentIndex) {
        return currentItems;
      }

      withoutItem.splice(nextTargetIndex, 0, movingItem);
      return withoutItem;
    });
  }, [updateTodoQueueItems]);

  const updateTodoQueueItemText = useCallback((itemId, nextText) => {
    const text = normalizeTodoQueueText(nextText);

    updateTodoQueueItems((currentItems) => (
      currentItems
        .map((item) => (
          item.id === itemId
            ? { ...item, text }
            : item
        ))
        .filter((item) => (
          normalizeTodoQueueText(item.text)
          || getTodoQueueItemImage(item)
          || getTodoQueueItemNote(item)
        ))
    ));
  }, [updateTodoQueueItems]);

  const dispatchQueuedTodoItems = useCallback(() => {
    if (todoQueueDispatchingRef.current) {
      logTerminalStatus("frontend.todo_queue.dispatch_skip", {
        reason: "dispatch_already_in_progress",
        workspaceId: terminalWorkspace?.id || "",
      });
      return;
    }

    const queuedItems = todoQueueItems.filter((item) => {
      const pendingItem = todoQueuePendingItemsRef.current[item.id] || null;
      return pendingItem && getTodoQueuePendingPhase(pendingItem) === "queued";
    });
    if (!queuedItems.length) {
      logTerminalStatus("frontend.todo_queue.dispatch_skip", {
        pendingCount: Object.keys(todoQueuePendingItemsRef.current || {}).length,
        queueItemCount: todoQueueItems.length,
        reason: "no_queued_items",
        workspaceId: terminalWorkspace?.id || "",
      });
      return;
    }
    const firstQueuedItem = queuedItems[0] || null;
    if (isAppClosing || isWorkspaceRuntimeDeactivating) {
      logTerminalStatus("frontend.todo_queue.dispatch_wait", {
        item: getTodoQueueItemLogSummary(firstQueuedItem ? [firstQueuedItem] : [])[0] || null,
        pendingCount: Object.keys(todoQueuePendingItemsRef.current || {}).length,
        queueItemCount: todoQueueItems.length,
        reason: isAppClosing ? "app_shutdown_in_progress" : "workspace_deactivation_in_progress",
        workspaceId: terminalWorkspace?.id || "",
      });
      return;
    }

    const resolveQueuedItemDispatchTarget = (item) => {
      const requestedTargetAgentId = getTodoQueueTargetAgentId(item);
      const requestedTargetTerminalId = getTodoQueueTargetTerminalId(item);
      const requestedTargetTerminalIndex = getTodoQueueTargetTerminalIndex(item);
      const requestedTargetThreadId = getTodoQueueTargetThreadId(item);
      const hasExplicitTerminalTarget = Number.isInteger(requestedTargetTerminalIndex)
        || Boolean(requestedTargetTerminalId)
        || Boolean(requestedTargetThreadId);

      if (hasExplicitTerminalTarget) {
        const candidateIndexes = Number.isInteger(requestedTargetTerminalIndex)
          ? [requestedTargetTerminalIndex]
          : logicalTerminalIndexes;
        let matchedUnavailableTarget = null;
        for (const terminalIndex of candidateIndexes) {
          if (!logicalTerminalIndexes.includes(terminalIndex)) {
            continue;
          }
          const candidate = getTodoQueueTerminalSendTarget(terminalIndex, item, {
            allowGeneric: false,
            requireAvailable: true,
            reservationItemId: item.id,
          });
          if (!todoQueueSendTargetMatchesIdentity(candidate, requestedTargetTerminalId, requestedTargetThreadId)) {
            continue;
          }
          const candidateRole = normalizeTodoTerminalAgentId(candidate.targetRole);
          if (requestedTargetAgentId && candidateRole && candidateRole !== requestedTargetAgentId) {
            matchedUnavailableTarget = {
              ...candidate,
              reason: "target_agent_mismatch",
            };
            break;
          }
          if (candidate.available) {
            return {
              available: true,
              hasExplicitTerminalTarget,
              requestedTargetAgentId,
              requestedTargetTerminalId,
              requestedTargetTerminalIndex,
              requestedTargetThreadId,
              target: candidate,
            };
          }
          matchedUnavailableTarget = candidate;
          break;
        }
        return {
          available: false,
          hasExplicitTerminalTarget,
          reason: matchedUnavailableTarget?.reason || "target_terminal_not_found",
          requestedTargetAgentId,
          requestedTargetTerminalId,
          requestedTargetTerminalIndex,
          requestedTargetThreadId,
          target: null,
          unavailable: matchedUnavailableTarget,
        };
      }

      let firstUnavailableTarget = null;
      for (const terminalIndex of logicalTerminalIndexes) {
        const candidate = getTodoQueueTerminalSendTarget(terminalIndex, item, {
          allowGeneric: false,
          requireAvailable: true,
          reservationItemId: item.id,
        });
        const candidateRole = normalizeTodoTerminalAgentId(candidate.targetRole);
        if (candidate.available && (!requestedTargetAgentId || candidateRole === requestedTargetAgentId)) {
          return {
            available: true,
            hasExplicitTerminalTarget,
            requestedTargetAgentId,
            requestedTargetTerminalId,
            requestedTargetTerminalIndex,
            requestedTargetThreadId,
            target: candidate,
          };
        }
        if (!firstUnavailableTarget) {
          firstUnavailableTarget = candidate;
        }
      }
      return {
        available: false,
        hasExplicitTerminalTarget,
        reason: firstUnavailableTarget?.reason || "no_available_terminal",
        requestedTargetAgentId,
        requestedTargetTerminalId,
        requestedTargetTerminalIndex,
        requestedTargetThreadId,
        target: null,
        unavailable: firstUnavailableTarget,
      };
    };

    const dispatchSelection = selectTodoQueueDispatchCandidate({
      queuedItems,
      isBoundaryItem: isVoicePlanBoundaryQueueItem,
      resolveItemTarget: resolveQueuedItemDispatchTarget,
    });
    const queuedItem = dispatchSelection.item || null;
    const target = dispatchSelection.target || null;
    const selectionTargetInfo = target ? dispatchSelection : dispatchSelection.unavailable || {};
    const requestedTargetAgentId = selectionTargetInfo.requestedTargetAgentId || getTodoQueueTargetAgentId(queuedItem);
    const requestedTargetTerminalId = selectionTargetInfo.requestedTargetTerminalId || getTodoQueueTargetTerminalId(queuedItem);
    const requestedTargetTerminalIndex = Number.isInteger(selectionTargetInfo.requestedTargetTerminalIndex)
      ? selectionTargetInfo.requestedTargetTerminalIndex
      : getTodoQueueTargetTerminalIndex(queuedItem);
    const requestedTargetThreadId = selectionTargetInfo.requestedTargetThreadId || getTodoQueueTargetThreadId(queuedItem);

    if (!queuedItem || !target) {
      logTerminalStatus("frontend.todo_queue.dispatch_wait", {
        item: getTodoQueueItemLogSummary(queuedItem ? [queuedItem] : [])[0] || null,
        reason: dispatchSelection.reason || selectionTargetInfo.reason || "no_available_terminal",
        requestedTargetAgentId,
        requestedTargetTerminalId,
        requestedTargetTerminalIndex: Number.isInteger(requestedTargetTerminalIndex) ? requestedTargetTerminalIndex : "",
        requestedTargetThreadId,
        terminalCount: logicalTerminalIndexes.length,
        workspaceId: terminalWorkspace?.id || "",
      });
      return;
    }

    logTerminalStatus("frontend.todo_queue.dispatch_consider", {
      item: getTodoQueueItemLogSummary([queuedItem])[0] || null,
      queuedItemCount: queuedItems.length,
      selectionReason: dispatchSelection.reason || "",
      targetTerminalIndex: target.targetTerminalIndex,
      workspaceId: terminalWorkspace?.id || "",
    });
    if (isVoicePlanBoundaryQueueItem(queuedItem)) {
      const hasSendingItem = Object.values(todoQueuePendingItemsRef.current).some((pendingItem) => (
        pendingItem?.itemId !== queuedItem.id
        && getTodoQueuePendingPhase(pendingItem) === "sending"
      ));
      if (hasSendingItem) {
        logTerminalStatus("frontend.todo_queue.dispatch_wait", {
          item: getTodoQueueItemLogSummary([queuedItem])[0] || null,
          reason: "voice_plan_boundary_waiting_for_sending_item",
          workspaceId: terminalWorkspace?.id || "",
        });
        return;
      }
      const busyReasons = new Set([
        "agent_not_ready",
        "reserved",
        "pending_prompt",
        "parked_task_resume_ready",
        "parked_task_waiting",
        "resume_in_progress",
        "busy_turn",
        "busy_activity",
        "composer_draft_present",
        "composer_attachments_present",
      ]);
      const hasBusyAgent = logicalTerminalIndexes.some((terminalIndex) => {
        const candidate = getTodoQueueTerminalSendTarget(terminalIndex, queuedItem, {
          allowGeneric: false,
          requireAvailable: true,
          reservationItemId: queuedItem.id,
        });
        return !candidate.available && busyReasons.has(String(candidate.reason || ""));
      });
      if (hasBusyAgent) {
        logTerminalStatus("frontend.todo_queue.dispatch_wait", {
          item: getTodoQueueItemLogSummary([queuedItem])[0] || null,
          reason: "voice_plan_boundary_waiting_for_busy_agent",
          workspaceId: terminalWorkspace?.id || "",
        });
        return;
      }
    }

    const source = getTodoQueueItemAutoQueueSource(queuedItem);
    const targetTerminalIndex = target.targetTerminalIndex;
    todoQueueDispatchingRef.current = true;
    recordTodoQueueRemoteCommandReceipt(queuedItem, "sending", {
      workspaceId: target.workspaceId || queuedItem.workspaceId || terminalWorkspace?.id || "",
    });
    logTerminalStatus("frontend.todo_queue.dispatch_start", {
      agentInputReady: Boolean(target.agentInputReady),
      effectiveLatestTurnState: target.effectiveLatestTurnState || "",
      inputReadyAt: target.inputReadyAt || "",
      inputReadyIsFreshForTurn: Boolean(target.inputReadyIsFreshForTurn),
      item: getTodoQueueItemLogSummary([queuedItem])[0] || null,
      source,
      orphanRunningLooksIdle: Boolean(target.orphanRunningLooksIdle),
      runningTurnLooksIdle: Boolean(target.runningTurnLooksIdle),
      targetRole: target.targetRole,
      targetTerminalIndex,
      terminalGroundTruthStatus: target.terminalGroundTruthStatus || "",
      terminalStatus: target.terminalStatus || "",
      threadActivityStatus: target.activityStatus || "",
      threadLatestTurnState: target.latestTurnState || "",
      turnStartedAt: target.turnStartedAt || "",
      workspaceId: target.workspaceId || queuedItem.workspaceId || terminalWorkspace?.id || "",
    });
    todoQueueTerminalReservationsRef.current.set(targetTerminalIndex, {
      itemId: queuedItem.id,
      startedAtMs: Date.now(),
    });
    setTodoQueueItemPending(queuedItem.id, {
      item: getTodoQueueItemLogSummary([queuedItem])[0] || null,
      paneId: target.paneId,
      phase: "sending",
      source,
      targetRole: target.targetRole,
      targetTerminalIndex,
      workspaceId: target.workspaceId || queuedItem.workspaceId || terminalWorkspace?.id || "",
    });

    sendTodoQueueItemToTerminal({
      allowGeneric: false,
      focusReason: "todo_auto_queue",
      item: queuedItem,
      requireAvailable: true,
      reservationItemId: queuedItem.id,
      source,
      targetTerminalIndex,
      })
        .then((dropResult) => {
          const sessionAccepted = Boolean(
            dropResult?.sessionAccepted
              || dropResult?.acceptedDetail,
          );
          const terminalSubmitConfirmed = Boolean(dropResult?.confirmedSubmit);
          setTodoDropError("");
          logTerminalStatus("frontend.todo_queue.dispatch_consumed", {
            acceptedMatchedBy: dropResult?.acceptedDetail?.matchedBy || "",
            awaitingSessionAcceptance: terminalSubmitConfirmed && !sessionAccepted,
            item: getTodoQueueItemLogSummary([queuedItem])[0] || null,
            promptId: dropResult?.promptId || "",
            sessionAccepted,
            source,
            submitConfirmed: Boolean(dropResult?.confirmedSubmit),
            targetRole: target.targetRole,
            targetTerminalIndex,
            workspaceId: target.workspaceId || queuedItem.workspaceId || terminalWorkspace?.id || "",
          });
          if (terminalSubmitConfirmed) {
            recordTodoQueueRemoteCommandReceipt(queuedItem, "submitted", {
              workspaceId: target.workspaceId || queuedItem.workspaceId || terminalWorkspace?.id || "",
            });
            setTodoQueueItemPending(queuedItem.id, {
              acceptedMatchedBy: dropResult?.acceptedDetail?.matchedBy || "",
              awaitingSessionAcceptance: !sessionAccepted,
              item: getTodoQueueItemLogSummary([queuedItem])[0] || null,
              paneId: target.paneId,
              phase: "sending",
              promptId: dropResult?.promptId || "",
              reason: sessionAccepted
                ? "session_accepted_waiting_for_completion"
                : "terminal_submit_confirmed_waiting_for_session_acceptance",
              sessionAccepted,
              source,
              submitConfirmed: true,
              targetRole: target.targetRole,
              targetTerminalIndex,
              workspaceId: target.workspaceId || queuedItem.workspaceId || terminalWorkspace?.id || "",
            });
            setTodoQueueItems((currentItems) => {
              const nextItems = normalizeTodoQueueItems(currentItems.map((item) => (
                item.id === queuedItem.id
                  ? getTodoQueueItemWithPersistedQueueState(item, "sending", {
                    reason: sessionAccepted
                      ? "session_accepted_waiting_for_completion"
                      : "terminal_submit_confirmed_waiting_for_session_acceptance",
                    source,
                    targetAgentId: target.targetRole,
                    targetTerminalId: target.paneId,
                    targetTerminalIndex,
                  })
                  : item
              )));
              writeTodoQueueItems(todoQueueStorageKeyRef.current, nextItems);
              return nextItems;
            });
            return;
          }

          const consumeReason = "consumed";
          recordTodoQueueRemoteCommandReceipt(queuedItem, "completed", {
            workspaceId: target.workspaceId || queuedItem.workspaceId || terminalWorkspace?.id || "",
          });
          clearTodoQueueItemPending(queuedItem.id, consumeReason, {
            acceptedMatchedBy: dropResult?.acceptedDetail?.matchedBy || "",
            awaitingSessionAcceptance: terminalSubmitConfirmed && !sessionAccepted,
            promptId: dropResult?.promptId || "",
            sessionAccepted,
            source,
            submitConfirmed: Boolean(dropResult?.confirmedSubmit),
            targetRole: target.targetRole,
            targetTerminalIndex,
          });
          updateTodoQueueItems((currentItems) => (
            currentItems.filter((item) => item.id !== queuedItem.id)
          ));
      })
      .catch((error) => {
        const stillQueued = todoQueueItemsRef.current.some((item) => item.id === queuedItem.id);
        if (stillQueued && isTodoQueueBusyError(error)) {
          recordTodoQueueRemoteCommandReceipt(queuedItem, "queued", {
            workspaceId: queuedItem.workspaceId || terminalWorkspace?.id || "",
          });
          logTerminalStatus("frontend.todo_queue.dispatch_requeued_busy", {
            item: getTodoQueueItemLogSummary([queuedItem])[0] || null,
            message: error?.message || String(error || ""),
            reason: error?.todoQueueBusyReason || "",
            source,
            workspaceId: queuedItem.workspaceId || terminalWorkspace?.id || "",
          });
          setTodoQueueItemPending(queuedItem.id, {
            item: getTodoQueueItemLogSummary([queuedItem])[0] || null,
            phase: "queued",
            reason: error?.todoQueueBusyReason || "",
            source,
            workspaceId: queuedItem.workspaceId || terminalWorkspace?.id || "",
          });
          return;
        }

        recordTodoQueueRemoteCommandReceipt(queuedItem, "failed", {
          workspaceId: target.workspaceId || queuedItem.workspaceId || terminalWorkspace?.id || "",
        });
        logTerminalStatus("frontend.todo_queue.dispatch_error", {
          item: getTodoQueueItemLogSummary([queuedItem])[0] || null,
          message: error?.message || String(error || ""),
          source,
          targetRole: target.targetRole,
          targetTerminalIndex,
          workspaceId: target.workspaceId || queuedItem.workspaceId || terminalWorkspace?.id || "",
        });
        clearTodoQueueItemPending(queuedItem.id, "error", {
          message: error?.message || String(error || ""),
          source,
          targetRole: target.targetRole,
          targetTerminalIndex,
        });
        if (isSpecEditTodoQueueItem(queuedItem)) {
          recordTodoQueueSpecEditCancelled(
            queuedItem,
            "dispatch_error",
            error?.message || String(error || ""),
          );
        }
        const planTask = getTodoQueueItemPlanTask(queuedItem);
        if (planTask) {
          void recordVoicePlanTaskStatus(planTask, "failed", {
            clientTodoId: queuedItem.id || "",
            error: error?.message || String(error || ""),
            terminalIndex: targetTerminalIndex,
          });
        }
        setTodoDropError(getTodoDropErrorMessage(error));
        logBigViewSyncDiagnosticEvent("tui.image.drop_write_error", {
          hasImage: Boolean(getTodoQueueItemImage(queuedItem)),
          message: error?.message || String(error || ""),
          paneId: target.paneId,
          shouldAutoSubmit: Boolean(target.shouldAutoSubmit),
          source,
          surface: "tui_terminal_grid",
          targetRole: target.targetRole,
          targetTerminalIndex,
          workspaceId: target.workspaceId || queuedItem.workspaceId || terminalWorkspace?.id || "",
        });
      })
      .finally(() => {
        const reservation = todoQueueTerminalReservationsRef.current.get(targetTerminalIndex);
        if (String(reservation?.itemId || "") === queuedItem.id) {
          todoQueueTerminalReservationsRef.current.delete(targetTerminalIndex);
        }
        todoQueueDispatchingRef.current = false;
        setTodoQueueDispatchRevision((revision) => revision + 1);
      });
  }, [
    clearTodoQueueItemPending,
    getTodoQueueTerminalSendTarget,
    isAppClosing,
    isWorkspaceRuntimeDeactivating,
    logicalTerminalIndexes,
    recordTodoQueueSpecEditCancelled,
    recordTodoQueueRemoteCommandReceipt,
    recordVoicePlanTaskStatus,
    sendTodoQueueItemToTerminal,
    setTodoQueueItemPending,
    terminalWorkspace?.id,
    todoQueueItems,
    updateTodoQueueItems,
  ]);

  useEffect(() => {
    dispatchQueuedTodoItems();
  }, [
    dispatchQueuedTodoItems,
    todoQueueDispatchRevision,
    todoQueuePendingItems,
    workspaceThreads,
  ]);

  const updateTodoDragState = useCallback((updater) => {
    setTodoDragState((currentState) => {
      const nextState = typeof updater === "function" ? updater(currentState) : updater;
      todoDragStateRef.current = nextState || null;
      return nextState || null;
    });
  }, []);

  const handleBeginTodoDrag = useCallback((event) => {
    const text = normalizeTodoQueueText(event?.item?.text);
    const terminalText = getTodoQueueItemTerminalText(event?.item);
    const image = getTodoQueueItemImage(event?.item);
    const note = getTodoQueueItemNote(event?.item);
    const specEdit = getTodoQueueItemSpecEdit(event?.item);
    const sourceRect = event?.sourceRect;

    if (
      (!terminalText && !image && !note)
      || !terminalWorkspace?.id
      || !sourceRect
      || !terminalPanelsRef.current
      || terminalDragActive
    ) {
      return;
    }

    measureTerminalLayout();

    const containerRect = terminalPanelsRef.current?.getBoundingClientRect?.();
    const targetTerminalIndex = getTodoDropTargetFromPoint({
      clientX: event.clientX,
      clientY: event.clientY,
      containerRect,
      fullscreenTerminalIndex: fullscreenActive ? fullscreenTerminalIndex : null,
      rects: getTerminalHitTestRects(),
      terminalIndexes: logicalTerminalIndexes,
    });
    const dragWidth = Math.max(220, Number(sourceRect.width || 0));
    const dragHeight = Math.max(0, Number(sourceRect.height || 0));
    const offsetX = dragWidth / 2;
    const offsetY = Math.max(0, Math.min(dragHeight - 4, dragHeight * 0.68));

    setTodoDropError("");
    updateTodoDragState({
      height: dragHeight,
      itemId: event.item?.id || "",
      offsetX,
      offsetY,
      pointerId: event.pointerId,
      targetTerminalIndex,
      text,
      kind: specEdit ? TODO_QUEUE_KIND_SPEC_EDIT : normalizeTodoQueueKind(event.item?.kind),
      source: normalizeTodoQueueSource(event.item?.source),
      ...(image ? { image } : {}),
      ...(note ? { note } : {}),
      ...(specEdit ? { specEdit } : {}),
      width: dragWidth,
      workspaceId: event.workspaceId || terminalWorkspace.id,
      x: Number(event.clientX || 0) - offsetX,
      y: Number(event.clientY || 0) - offsetY,
    });
  }, [
    fullscreenActive,
    fullscreenTerminalIndex,
    getTerminalHitTestRects,
    logicalTerminalIndexes,
    measureTerminalLayout,
    terminalDragActive,
    terminalWorkspace?.id,
    updateTodoDragState,
  ]);

  const updateTerminalDragState = useCallback((updater) => {
    setTerminalDragState((currentState) => {
      const nextState = typeof updater === "function" ? updater(currentState) : updater;
      terminalDragStateRef.current = nextState || null;
      return nextState || null;
    });
  }, []);

  const beginTerminalCanvasDrag = useCallback((event) => {
    if (
      fullscreenActive
      || !terminalWorkspace?.id
      || todoDragActive
      || !Number.isInteger(event?.terminalIndex)
    ) {
      return false;
    }

    measureTerminalLayout();

    const containerRect = terminalPanelsRef.current?.getBoundingClientRect?.();
    const placement = normalizeBreakoutPlacement(
      terminalBreakoutPlacementsRef.current?.[event.terminalIndex],
    );
    const viewport = normalizeBreakoutViewport(terminalBreakoutViewportRef.current);
    const zoom = Math.max(0.001, viewport.zoom);

    if (!containerRect || !placement) {
      return false;
    }

    const offsetX = ((Number(event.clientX || 0) - Number(containerRect.left || 0) - viewport.x) / zoom) - placement.x;
    const offsetY = ((Number(event.clientY || 0) - Number(containerRect.top || 0) - viewport.y) / zoom) - placement.y;
    const maxZ = Object.values(terminalBreakoutPlacementsRef.current)
      .map((currentPlacement) => Number.parseInt(currentPlacement?.z, 10) || 0)
      .reduce((maxValue, z) => Math.max(maxValue, z), 0);
    const nextPlacement = {
      ...placement,
      z: maxZ + 1,
    };

    updateTerminalBreakoutPlacements({
      ...terminalBreakoutPlacementsRef.current,
      [event.terminalIndex]: nextPlacement,
    });
    setActiveTerminalPaneId(event.paneId || "");
    updateTerminalDragState({
      height: nextPlacement.height,
      mode: "canvas",
      offsetX,
      offsetY,
      paneId: event.paneId || "",
      pointerId: event.pointerId,
      terminalIndex: event.terminalIndex,
      width: nextPlacement.width,
      workspaceId: event.workspaceId || terminalWorkspace.id,
    });

    return true;
  }, [
    fullscreenActive,
    measureTerminalLayout,
    terminalWorkspace?.id,
    todoDragActive,
    updateTerminalBreakoutPlacements,
    updateTerminalDragState,
  ]);

  const clearTerminalBreakoutHoldDrag = useCallback(() => {
    const holdState = terminalBreakoutHoldDragRef.current;
    if (!holdState) {
      return;
    }

    if (holdState.timerId) {
      window.clearTimeout(holdState.timerId);
    }

    window.removeEventListener("pointermove", holdState.handlePointerMove, { capture: true });
    window.removeEventListener("pointerup", holdState.handlePointerEnd, { capture: true });
    window.removeEventListener("pointercancel", holdState.handlePointerEnd, { capture: true });
    terminalBreakoutHoldDragRef.current = null;
  }, []);

  const handleTerminalBreakoutSlotPointerDownCapture = useCallback((event, terminalIndex) => {
    if (
      !terminalBreakoutLayoutActive
      || fullscreenActive
      || terminalDragActive
      || todoDragActive
      || event.button !== 0
      || !terminalWorkspace?.id
      || !Number.isInteger(terminalIndex)
      || isTerminalBreakoutHoldDragExcludedTarget(event.target)
    ) {
      return;
    }

    const paneId = getTerminalPaneId(terminalIndex);
    if (!paneId) {
      return;
    }

    clearTerminalBreakoutHoldDrag();

    const holdState = {
      handlePointerEnd: null,
      handlePointerMove: null,
      latestClientX: event.clientX,
      latestClientY: event.clientY,
      paneId,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      started: false,
      terminalIndex,
      timerId: 0,
      workspaceId: terminalWorkspace.id,
    };

    holdState.handlePointerMove = (pointerEvent) => {
      const currentHoldState = terminalBreakoutHoldDragRef.current;
      if (!currentHoldState || pointerEvent.pointerId !== currentHoldState.pointerId) {
        return;
      }

      currentHoldState.latestClientX = pointerEvent.clientX;
      currentHoldState.latestClientY = pointerEvent.clientY;

      if (currentHoldState.started) {
        pointerEvent.preventDefault();
        pointerEvent.stopPropagation();
        return;
      }

      const dragDistance = Math.hypot(
        pointerEvent.clientX - currentHoldState.startClientX,
        pointerEvent.clientY - currentHoldState.startClientY,
      );

      if (dragDistance > TERMINAL_BREAKOUT_HOLD_DRAG_CANCEL_PX) {
        clearTerminalBreakoutHoldDrag();
      }
    };

    holdState.handlePointerEnd = (pointerEvent) => {
      const currentHoldState = terminalBreakoutHoldDragRef.current;
      if (!currentHoldState || pointerEvent.pointerId !== currentHoldState.pointerId) {
        return;
      }

      if (currentHoldState.started) {
        pointerEvent.preventDefault();
        pointerEvent.stopPropagation();
        const currentDragState = terminalDragStateRef.current;
        if (
          currentDragState?.mode === "canvas"
          && currentDragState.pointerId === currentHoldState.pointerId
        ) {
          updateTerminalDragState(null);
        }
      }

      clearTerminalBreakoutHoldDrag();
    };

    holdState.timerId = window.setTimeout(() => {
      const currentHoldState = terminalBreakoutHoldDragRef.current;
      if (!currentHoldState || currentHoldState.pointerId !== holdState.pointerId) {
        return;
      }

      currentHoldState.timerId = 0;
      currentHoldState.started = true;
      const dragStarted = beginTerminalCanvasDrag({
        clientX: currentHoldState.latestClientX,
        clientY: currentHoldState.latestClientY,
        paneId: currentHoldState.paneId,
        pointerId: currentHoldState.pointerId,
        terminalIndex: currentHoldState.terminalIndex,
        workspaceId: currentHoldState.workspaceId,
      });

      if (!dragStarted) {
        clearTerminalBreakoutHoldDrag();
      }
    }, TERMINAL_BREAKOUT_HOLD_DRAG_DELAY_MS);

    terminalBreakoutHoldDragRef.current = holdState;
    window.addEventListener("pointermove", holdState.handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", holdState.handlePointerEnd, { capture: true, passive: false });
    window.addEventListener("pointercancel", holdState.handlePointerEnd, { capture: true, passive: false });
  }, [
    beginTerminalCanvasDrag,
    clearTerminalBreakoutHoldDrag,
    fullscreenActive,
    getTerminalPaneId,
    terminalBreakoutLayoutActive,
    terminalDragActive,
    terminalWorkspace?.id,
    todoDragActive,
    updateTerminalDragState,
  ]);

  useEffect(() => clearTerminalBreakoutHoldDrag, [clearTerminalBreakoutHoldDrag]);

  const handleBeginTerminalDrag = useCallback((event) => {
    if (
      fullscreenActive
      || !terminalWorkspace?.id
      || !event?.surfaceRect
      || todoDragActive
    ) {
      return;
    }

    measureTerminalLayout();

    if (terminalBreakoutLayoutActive || terminalBreakoutPhaseRef.current === TERMINAL_BREAKOUT_PHASE_CANVAS) {
      beginTerminalCanvasDrag(event);
      return;
    }

    if (logicalTerminalIndexes.length <= 1) {
      return;
    }

    const sourceRows = cloneTerminalRows(displayTerminalRows);
    const sourceRect = event.surfaceRect || event.panelRect;
    const containerRect = terminalPanelsRef.current?.getBoundingClientRect?.();

    if (!sourceRows.length || !sourceRect || !containerRect) {
      return;
    }

    const offsetX = Number(event.clientX || 0) - Number(sourceRect.left || 0);
    const offsetY = Number(event.clientY || 0) - Number(sourceRect.top || 0);
    const nextState = {
      height: Number(sourceRect.height || 0),
      offsetX,
      offsetY,
      paneId: event.paneId || "",
      pointerId: event.pointerId,
      previewRows: sourceRows,
      sourceRows,
      terminalIndex: event.terminalIndex,
      width: Number(sourceRect.width || 0),
      workspaceId: event.workspaceId || terminalWorkspace.id,
      x: Number(event.clientX || 0) - Number(containerRect.left || 0) - offsetX,
      y: Number(event.clientY || 0) - Number(containerRect.top || 0) - offsetY,
    };

    setActiveTerminalPaneId(event.paneId || "");
    updateTerminalDragState(nextState);
  }, [
    beginTerminalCanvasDrag,
    displayTerminalRows,
    fullscreenActive,
    logicalTerminalIndexes.length,
    measureTerminalLayout,
    terminalBreakoutLayoutActive,
    terminalWorkspace?.id,
    todoDragActive,
    updateTerminalDragState,
  ]);

  useEffect(() => {
    if (!todoDragActive) {
      return undefined;
    }

    const previousCursor = document.body.style.cursor;
    const previousTouchAction = document.body.style.touchAction;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.touchAction = "none";
    document.body.style.userSelect = "none";

    const resolveDropTarget = (clientX, clientY) => {
      return resolveTerminalDropTarget(clientX, clientY);
    };

    const cancelDrag = () => {
      updateTodoDragState(null);
    };

    const commitDrag = (targetTerminalIndex) => {
      const currentDrag = todoDragStateRef.current;
      if (!currentDrag) {
        return;
      }

      {
        const source = isSpecEditTodoQueueItem(currentDrag)
          ? TODO_QUEUE_SOURCE_SPEC_EDIT_AUTO
          : getTodoQueueItemPlanTask(currentDrag)
            ? TODO_QUEUE_SOURCE_VOICE_PLAN
            : "tui-todo-drop";
        const target = getTodoQueueTerminalSendTarget(targetTerminalIndex, currentDrag, {
          allowGeneric: true,
          requireAvailable: true,
          reservationItemId: currentDrag.itemId,
        });
        const paneId = target.paneId || "";
        const targetRole = target.targetRole || "";
        const reservationItemId = currentDrag.itemId || `todo-drop-${Date.now().toString(36)}`;
        const reservedTerminalIndex = Number.isInteger(target.targetTerminalIndex)
          ? target.targetTerminalIndex
          : null;

        updateTodoDragState(null);

        if (!target.available && ["missing_pane", "missing_target_terminal"].includes(target.reason)) {
          logBigViewSyncDiagnosticEvent("tui.image.drop_skip", {
            hasImage: Boolean(getTodoQueueItemImage(currentDrag)),
            reason: target.reason || "missing_pane",
            source,
            surface: "tui_terminal_grid",
            targetTerminalIndex: targetTerminalIndex ?? "",
            workspaceId: currentDrag.workspaceId || terminalWorkspace?.id || "",
          });
          return;
        }
        if (!target.available) {
          const message = target.message || "This terminal is not ready for that todo yet.";
          if (currentDrag.itemId && TODO_QUEUE_BUSY_REASONS.has(String(target.reason || ""))) {
            setTodoQueueItemPending(currentDrag.itemId, {
              item: getTodoQueueItemLogSummary([currentDrag])[0] || null,
              phase: "queued",
              reason: target.reason || "",
              source,
              workspaceId: currentDrag.workspaceId || terminalWorkspace?.id || "",
            });
            const planTask = getTodoQueueItemPlanTask(currentDrag);
            if (planTask) {
              void recordVoicePlanTaskStatus(planTask, "queued", {
                clientTodoId: currentDrag.itemId || "",
                reason: target.reason || "",
                terminalIndex: targetTerminalIndex ?? null,
              });
            }
          } else if (currentDrag.itemId) {
            clearTodoQueueItemPending(currentDrag.itemId, "error", {
              message,
              source,
              targetRole,
              targetTerminalIndex: targetTerminalIndex ?? "",
            });
          }
          setTodoDropError(message);
          logBigViewSyncDiagnosticEvent("tui.image.drop_skip", {
            hasImage: Boolean(getTodoQueueItemImage(currentDrag)),
            paneId,
            reason: target.reason || "unavailable",
            source,
            surface: "tui_terminal_grid",
            targetRole,
            targetTerminalIndex: targetTerminalIndex ?? "",
            workspaceId: currentDrag.workspaceId || terminalWorkspace?.id || "",
          });
          return;
        }

        if (currentDrag.itemId && target.available) {
          setTodoQueueItemPending(currentDrag.itemId, {
            item: getTodoQueueItemLogSummary([currentDrag])[0] || null,
            paneId,
            phase: "sending",
            source,
            targetRole,
            targetTerminalIndex: targetTerminalIndex ?? "",
            workspaceId: currentDrag.workspaceId || terminalWorkspace?.id || "",
          });
        }

        if (target.available && Number.isInteger(reservedTerminalIndex)) {
          todoQueueTerminalReservationsRef.current.set(reservedTerminalIndex, {
            itemId: reservationItemId,
            source,
            startedAtMs: Date.now(),
          });
          setTodoQueueDispatchRevision((revision) => revision + 1);
        }

        sendTodoQueueItemToTerminal({
          allowGeneric: true,
          focusReason: "todo_dropdown_drop",
          item: currentDrag,
          requireAvailable: true,
          reservationItemId,
          source,
          targetTerminalIndex,
        })
          .then(async (dropResult) => {
            setTodoDropError("");
            const planTask = getTodoQueueItemPlanTask(currentDrag);
            const sessionAccepted = Boolean(
              dropResult?.sessionAccepted
                || dropResult?.acceptedDetail,
            );
            if (dropResult?.confirmedSubmit && planTask && !dropResult?.planTaskStatusRecorded) {
              await recordVoicePlanTaskStatus(planTask, "dispatched", {
                agentId: targetRole,
                clientTodoId: currentDrag.itemId || "",
                promptEventId: dropResult?.promptId || planTask.taskId,
                sessionAccepted,
                terminalId: paneId,
                terminalIndex: targetTerminalIndex ?? null,
                threadId: dropResult?.targetThread?.id || "",
              });
            }
            if (currentDrag.itemId) {
              if (dropResult?.confirmedSubmit) {
                setTodoQueueItemPending(currentDrag.itemId, {
                  acceptedMatchedBy: dropResult?.acceptedDetail?.matchedBy || "",
                  awaitingSessionAcceptance: !sessionAccepted,
                  item: getTodoQueueItemLogSummary([currentDrag])[0] || null,
                  paneId,
                  phase: "sending",
                  promptId: dropResult?.promptId || "",
                  reason: sessionAccepted
                    ? "session_accepted_waiting_for_completion"
                    : "terminal_submit_confirmed_waiting_for_session_acceptance",
                  sessionAccepted,
                  source,
                  submitConfirmed: true,
                  targetRole,
                  targetTerminalIndex: targetTerminalIndex ?? "",
                  workspaceId: currentDrag.workspaceId || terminalWorkspace?.id || "",
                });
                updateTodoQueueItems((currentItems) => (
                  normalizeTodoQueueItems(currentItems.map((item) => (
                    item.id === currentDrag.itemId
                      ? getTodoQueueItemWithPersistedQueueState(item, "sending", {
                        reason: sessionAccepted
                          ? "session_accepted_waiting_for_completion"
                          : "terminal_submit_confirmed_waiting_for_session_acceptance",
                        source,
                        targetAgentId: targetRole,
                        targetTerminalId: paneId,
                        targetTerminalIndex,
                      })
                      : item
                  )))
                ));
                return;
              }

              clearTodoQueueItemPending(currentDrag.itemId, "consumed", {
                promptId: dropResult?.promptId || "",
                source,
                submitConfirmed: Boolean(dropResult?.confirmedSubmit),
                targetRole,
                targetTerminalIndex: targetTerminalIndex ?? "",
              });
              updateTodoQueueItems((currentItems) => (
                currentItems.filter((item) => item.id !== currentDrag.itemId)
              ));
            }
          })
          .catch((error) => {
            if (currentDrag.itemId && isTodoQueueBusyError(error)) {
              setTodoQueueItemPending(currentDrag.itemId, {
                item: getTodoQueueItemLogSummary([currentDrag])[0] || null,
                phase: "queued",
                reason: error?.todoQueueBusyReason || "",
                source,
                workspaceId: currentDrag.workspaceId || terminalWorkspace?.id || "",
              });
              const planTask = getTodoQueueItemPlanTask(currentDrag);
              if (planTask) {
                void recordVoicePlanTaskStatus(planTask, "queued", {
                  clientTodoId: currentDrag.itemId || "",
                  error: error?.message || String(error || ""),
                  reason: error?.todoQueueBusyReason || "",
                  terminalIndex: targetTerminalIndex ?? null,
                });
              }
              setTodoDropError(getTodoDropErrorMessage(error));
              return;
            }
            if (currentDrag.itemId) {
              clearTodoQueueItemPending(currentDrag.itemId, "error", {
                message: error?.message || String(error || ""),
                source,
                targetRole,
                targetTerminalIndex: targetTerminalIndex ?? "",
              });
            }
            const planTask = getTodoQueueItemPlanTask(currentDrag);
            if (planTask) {
              void recordVoicePlanTaskStatus(planTask, "failed", {
                clientTodoId: currentDrag.itemId || "",
                error: error?.message || String(error || ""),
                terminalIndex: targetTerminalIndex ?? null,
              });
            }
            setTodoDropError(getTodoDropErrorMessage(error));
            logBigViewSyncDiagnosticEvent("tui.image.drop_write_error", {
              hasImage: Boolean(getTodoQueueItemImage(currentDrag)),
              message: error?.message || String(error || ""),
              paneId,
              shouldAutoSubmit: Boolean(target.shouldAutoSubmit),
              source,
              surface: "tui_terminal_grid",
              targetRole,
              targetTerminalIndex: targetTerminalIndex ?? "",
              workspaceId: currentDrag.workspaceId || terminalWorkspace?.id || "",
            });
          })
          .finally(() => {
            if (Number.isInteger(reservedTerminalIndex)) {
              const reservation = todoQueueTerminalReservationsRef.current.get(reservedTerminalIndex);
              if (String(reservation?.itemId || "") === reservationItemId) {
                todoQueueTerminalReservationsRef.current.delete(reservedTerminalIndex);
              }
              setTodoQueueDispatchRevision((revision) => revision + 1);
            }
          });
        return;
      }
    };

    const handlePointerMove = (event) => {
      const currentDrag = todoDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      event.preventDefault();

      const targetTerminalIndex = resolveDropTarget(event.clientX, event.clientY);
      updateTodoDragState({
        ...currentDrag,
        targetTerminalIndex,
        x: event.clientX - currentDrag.offsetX,
        y: event.clientY - currentDrag.offsetY,
      });
    };

    const handlePointerUp = (event) => {
      const currentDrag = todoDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      event.preventDefault();
      commitDrag(resolveDropTarget(event.clientX, event.clientY));
    };

    const handlePointerCancel = (event) => {
      const currentDrag = todoDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      cancelDrag();
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.touchAction = previousTouchAction;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [
    clearTodoQueueItemPending,
    getTerminalImageInputSupport,
    getTerminalRole,
    getTerminalPaneId,
    getTerminalThread,
    getTodoQueueTerminalSendTarget,
    logicalTerminalIndexes,
    recordVoicePlanTaskStatus,
    resolveTerminalDropTarget,
    sendTodoQueueItemToTerminal,
    setTodoQueueItemPending,
    terminalWorkspace?.id,
    todoDragActive,
    updateTodoQueueItems,
    updateTodoDragState,
  ]);

  useEffect(() => {
    if (!terminalDragActive) {
      return undefined;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";

    const handlePointerMove = (event) => {
      const currentDrag = terminalDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      event.preventDefault();
      if (currentDrag.mode === "canvas") {
        event.stopPropagation();
      }

      const containerRect = terminalPanelsRef.current?.getBoundingClientRect?.();
      if (!containerRect) {
        return;
      }

      if (currentDrag.mode === "canvas") {
        const currentPlacement = normalizeBreakoutPlacement(
          terminalBreakoutPlacementsRef.current?.[currentDrag.terminalIndex],
        );
        if (!currentPlacement) {
          return;
        }

        const viewport = terminalBreakoutViewportRef.current;
        const normalizedViewport = normalizeBreakoutViewport(viewport);
        const zoom = Math.max(0.001, normalizedViewport.zoom);
        const nextPlacement = {
          ...currentPlacement,
          x: ((event.clientX - containerRect.left - normalizedViewport.x) / zoom) - currentDrag.offsetX,
          y: ((event.clientY - containerRect.top - normalizedViewport.y) / zoom) - currentDrag.offsetY,
        };

        updateTerminalBreakoutPlacements({
          ...terminalBreakoutPlacementsRef.current,
          [currentDrag.terminalIndex]: nextPlacement,
        });
        return;
      }

      const target = getDragTargetFromPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        containerRect,
        draggedTerminalIndex: currentDrag.terminalIndex,
        rects: terminalLayoutRectsRef.current,
        rows: currentDrag.previewRows,
      });
      const nextPreviewRows = insertTerminalInRows(
        currentDrag.previewRows,
        currentDrag.terminalIndex,
        target,
      );

      updateTerminalDragState({
        ...currentDrag,
        previewRows: areTerminalRowsEqual(currentDrag.previewRows, nextPreviewRows)
          ? currentDrag.previewRows
          : nextPreviewRows,
        x: event.clientX - containerRect.left - currentDrag.offsetX,
        y: event.clientY - containerRect.top - currentDrag.offsetY,
      });
    };

    const commitDrag = () => {
      const currentDrag = terminalDragStateRef.current;
      if (!currentDrag) {
        return;
      }

      if (currentDrag.mode === "canvas") {
        updateTerminalDragState(null);
        return;
      }

      const nextRows = cloneTerminalRows(currentDrag.previewRows);
      if (!areTerminalRowsEqual(currentDrag.sourceRows, nextRows)) {
        reorderWorkspaceTerminalDisplayLayout?.({
          displayRows: nextRows,
          workspaceId: currentDrag.workspaceId,
        });
      }

      updateTerminalDragState(null);
    };

    const cancelDrag = () => {
      updateTerminalDragState(null);
    };

    const handlePointerUp = (event) => {
      const currentDrag = terminalDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      event.preventDefault();
      if (currentDrag.mode === "canvas") {
        event.stopPropagation();
      }
      commitDrag();
    };

    const handlePointerCancel = (event) => {
      const currentDrag = terminalDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      cancelDrag();
    };

    window.addEventListener("pointermove", handlePointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", handlePointerUp, { capture: true, passive: false });
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove, { capture: true });
      window.removeEventListener("pointerup", handlePointerUp, { capture: true });
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [
    reorderWorkspaceTerminalDisplayLayout,
    terminalDragActive,
    updateTerminalBreakoutPlacements,
    updateTerminalDragState,
  ]);

  useEffect(() => {
    if (!workspaceFileDragActive) {
      return undefined;
    }

    const previousCursor = document.body.style.cursor;
    const previousTouchAction = document.body.style.touchAction;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.touchAction = "none";
    document.body.style.userSelect = "none";

    const commitDrag = (clientX, clientY) => {
      const currentDrag = workspaceFileDragStateRef.current;
      if (!currentDrag?.file) {
        return;
      }

      const targetTerminalIndex = resolveTerminalDropTarget(clientX, clientY);
      updateWorkspaceFileDragState(null);
      if (Number.isInteger(targetTerminalIndex)) {
        const queued = queueWorkspaceFileForTerminalIndex(
          currentDrag.file,
          targetTerminalIndex,
          "fileviewer_pointer_drop",
        );
        if (queued) {
          clearActiveWorkspaceFileDrag();
        }
        logFileDragDiagnosticEvent("fileviewer.pointer_drop_terminal", {
          queued,
          relativePath: currentDrag.file.relativePath || "",
          targetTerminalIndex,
          workspaceId: currentDrag.file.workspaceId || terminalWorkspace?.id || "",
        });
        return;
      }

      const detail = {
        clientX,
        clientY,
        file: currentDrag.file,
        handled: false,
        workspaceId: currentDrag.file.workspaceId || terminalWorkspace?.id || "",
      };
      window.dispatchEvent(new CustomEvent(WORKSPACE_FILE_POINTER_DROP_EVENT, { detail }));
      clearActiveWorkspaceFileDrag();
      logFileDragDiagnosticEvent("fileviewer.pointer_drop_dispatch", {
        handled: Boolean(detail.handled),
        relativePath: currentDrag.file.relativePath || "",
        workspaceId: detail.workspaceId,
      });
    };

    const handlePointerMove = (event) => {
      const currentDrag = workspaceFileDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      event.preventDefault();
      updateWorkspaceFileDragState({
        ...currentDrag,
        targetTerminalIndex: resolveTerminalDropTarget(event.clientX, event.clientY),
        x: event.clientX - currentDrag.offsetX,
        y: event.clientY - currentDrag.offsetY,
      });
    };

    const handlePointerUp = (event) => {
      const currentDrag = workspaceFileDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      event.preventDefault();
      commitDrag(event.clientX, event.clientY);
    };

    const handlePointerCancel = (event) => {
      const currentDrag = workspaceFileDragStateRef.current;
      if (!currentDrag || event.pointerId !== currentDrag.pointerId) {
        return;
      }

      updateWorkspaceFileDragState(null);
      window.setTimeout(clearActiveWorkspaceFileDrag, 80);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerUp, { passive: false });
    window.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.touchAction = previousTouchAction;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [
    queueWorkspaceFileForTerminalIndex,
    resolveTerminalDropTarget,
    terminalWorkspace?.id,
    updateWorkspaceFileDragState,
    workspaceFileDragActive,
  ]);

  useEffect(() => {
    if (!hasVisibleWorkspaceTerminalPanes) {
      return undefined;
    }

    const handleWorkspaceFileDragOver = (event) => {
      const activeWorkspaceFile = getActiveWorkspaceFileDrag();
      const hasWorkspaceFileTransfer = isWorkspaceFileDragTransfer(event.dataTransfer);
      if (!hasWorkspaceFileTransfer && !activeWorkspaceFile) {
        return;
      }

      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      const targetTerminalIndex = resolveTerminalDropTarget(event.clientX, event.clientY);
      logFileDragDiagnosticEvent("terminal_grid.global_drag_over_raw", {
        hasActiveWorkspaceFile: Boolean(activeWorkspaceFile),
        hasWorkspaceFileTransfer,
        targetTerminalIndex: Number.isInteger(targetTerminalIndex) ? targetTerminalIndex : "",
        types: Array.from(event.dataTransfer?.types || []),
        workspaceId: terminalWorkspace?.id || "",
      });
      if (!Number.isInteger(targetTerminalIndex)) {
        return;
      }

      logFileDragDiagnosticEvent("terminal_grid.global_drag_over", {
        hasActiveWorkspaceFile: Boolean(activeWorkspaceFile),
        hasWorkspaceFileTransfer,
        targetTerminalIndex,
        types: Array.from(event.dataTransfer?.types || []),
        workspaceId: terminalWorkspace?.id || "",
      });
    };

    const handleWorkspaceFileDrop = (event) => {
      const activeWorkspaceFile = getActiveWorkspaceFileDrag();
      const hasWorkspaceFileTransfer = isWorkspaceFileDragTransfer(event.dataTransfer);
      if (!hasWorkspaceFileTransfer && !activeWorkspaceFile) {
        return;
      }

      event.preventDefault();
      const targetTerminalIndex = resolveTerminalDropTarget(event.clientX, event.clientY);
      logFileDragDiagnosticEvent("terminal_grid.global_drop_raw", {
        hasActiveWorkspaceFile: Boolean(activeWorkspaceFile),
        hasWorkspaceFileTransfer,
        targetTerminalIndex: Number.isInteger(targetTerminalIndex) ? targetTerminalIndex : "",
        types: Array.from(event.dataTransfer?.types || []),
        workspaceId: terminalWorkspace?.id || "",
      });
      if (!Number.isInteger(targetTerminalIndex)) {
        logFileDragDiagnosticEvent("terminal_grid.global_drop_ignored", {
          reason: "outside_terminal_grid",
          types: Array.from(event.dataTransfer?.types || []),
          workspaceId: terminalWorkspace?.id || "",
        });
        return;
      }

      event.stopPropagation();
      const workspaceFile = getDraggedWorkspaceFile(event.dataTransfer) || activeWorkspaceFile;
      logFileDragDiagnosticEvent("terminal_grid.global_drop", {
        filePresent: Boolean(workspaceFile),
        hasActiveWorkspaceFile: Boolean(activeWorkspaceFile),
        hasWorkspaceFileTransfer,
        relativePath: workspaceFile?.relativePath || "",
        targetTerminalIndex,
        types: Array.from(event.dataTransfer?.types || []),
        workspaceId: terminalWorkspace?.id || "",
      });
      if (queueWorkspaceFileForTerminalIndex(workspaceFile, targetTerminalIndex, "fileviewer_global_drop")) {
        clearActiveWorkspaceFileDrag();
      }
    };

    window.addEventListener("dragover", handleWorkspaceFileDragOver, true);
    window.addEventListener("drop", handleWorkspaceFileDrop, true);
    return () => {
      window.removeEventListener("dragover", handleWorkspaceFileDragOver, true);
      window.removeEventListener("drop", handleWorkspaceFileDrop, true);
    };
  }, [
    hasVisibleWorkspaceTerminalPanes,
    queueWorkspaceFileForTerminalIndex,
    resolveTerminalDropTarget,
    terminalWorkspace?.id,
  ]);

  const handleToggleFullscreenTerminal = useCallback(({ paneId, panelRect, surfaceRect, terminalIndex }) => {
    if (paneId) {
      setActiveTerminalPaneId(paneId);
    }

    const motion = getFullscreenMotionFromRect(panelRect || surfaceRect);
    clearFullscreenTransitionTimer();

    if (fullscreenActive && fullscreenTerminalIndex === terminalIndex) {
      const selectedLivePaneId = getLiveTerminalPaneIdForThread(selectedWorkspaceThreadId);
      if (selectedLivePaneId) {
        setActiveTerminalPaneId(selectedLivePaneId);
      }
      setFullscreenMotion({
        ...motion,
        phase: "closing",
      });
      fullscreenTransitionTimerRef.current = window.setTimeout(() => {
        fullscreenTransitionTimerRef.current = 0;
        setFullscreenTerminalIndex((currentIndex) => (
          currentIndex === terminalIndex ? null : currentIndex
        ));
        setFullscreenMotion(TERMINAL_FULLSCREEN_DEFAULT_MOTION);
      }, TERMINAL_FULLSCREEN_TRANSITION_MS);
      return;
    }

    const threadId = getTerminalThread(terminalIndex)?.id || "";
    if (terminalWorkspace?.id && threadId) {
      onSelectWorkspaceThread?.(terminalWorkspace.id, threadId);
    }

    setFullscreenTerminalIndex(terminalIndex);
    setFullscreenMotion({
      ...motion,
      phase: "opening",
    });
    fullscreenTransitionTimerRef.current = window.setTimeout(() => {
      fullscreenTransitionTimerRef.current = 0;
      setFullscreenMotion((currentMotion) => (
        currentMotion.phase === "opening"
          ? { ...currentMotion, phase: "open" }
          : currentMotion
      ));
    }, TERMINAL_FULLSCREEN_TRANSITION_MS);
  }, [
    clearFullscreenTransitionTimer,
    fullscreenActive,
    fullscreenTerminalIndex,
    getFullscreenMotionFromRect,
    getLiveTerminalPaneIdForThread,
    getTerminalThread,
    onSelectWorkspaceThread,
    selectedWorkspaceThreadId,
    terminalWorkspace?.id,
  ]);

  const minimizeTodoQueuePane = useCallback(() => {
    setTodoQueuePaneMode(TODO_QUEUE_PANE_MODE_MINIMIZED);
  }, []);

  const restoreTodoQueuePane = useCallback(() => {
    setTodoQueuePaneMode(TODO_QUEUE_PANE_MODE_NORMAL);
  }, []);

  const toggleFullscreenTodoQueuePane = useCallback(() => {
    setTodoQueuePaneMode((currentMode) => (
      currentMode === TODO_QUEUE_PANE_MODE_FULLSCREEN
        ? TODO_QUEUE_PANE_MODE_NORMAL
        : TODO_QUEUE_PANE_MODE_FULLSCREEN
    ));
  }, []);

  const getTerminalSlotStyle = useCallback((terminalIndex) => {
    const draggingThisTerminal = terminalDragState?.terminalIndex === terminalIndex;
    const fullscreenThisTerminal = fullscreenActive && fullscreenTerminalIndex === terminalIndex;

    if (draggingThisTerminal && terminalDragState?.mode !== "canvas") {
      return {
        "--terminal-slot-height": `${Math.max(0, terminalDragState.height || 0)}px`,
        "--terminal-slot-width": `${Math.max(0, terminalDragState.width || 0)}px`,
        "--terminal-slot-x": `${terminalDragState.x || 0}px`,
        "--terminal-slot-y": `${terminalDragState.y || 0}px`,
      };
    }

    if (fullscreenThisTerminal && terminalPanelRect) {
      return {
        "--terminal-slot-height": `${Math.max(0, terminalPanelRect.height || 0)}px`,
        "--terminal-slot-width": `${Math.max(0, terminalPanelRect.width || 0)}px`,
        "--terminal-slot-x": "0px",
        "--terminal-slot-y": "0px",
      };
    }

    if (terminalBreakoutLayoutActive) {
      const screenRect = getBreakoutScreenRect(
        terminalBreakoutPlacements[terminalIndex],
        terminalBreakoutViewport,
      );

      if (screenRect) {
        return {
          "--terminal-slot-height": `${Math.max(0, screenRect.height || 0)}px`,
          "--terminal-slot-width": `${Math.max(0, screenRect.width || 0)}px`,
          "--terminal-slot-x": `${screenRect.left || 0}px`,
          "--terminal-slot-y": `${screenRect.top || 0}px`,
          "--terminal-slot-z": normalizeBreakoutPlacement(terminalBreakoutPlacements[terminalIndex])?.z || 1,
        };
      }
    }

    const rect = terminalLayoutRects[terminalIndex];
    if (!rect) {
      return {
        "--terminal-slot-height": "0px",
        "--terminal-slot-width": "0px",
        "--terminal-slot-x": "0px",
        "--terminal-slot-y": "0px",
      };
    }

    return {
      "--terminal-slot-height": `${Math.max(0, rect.height || 0)}px`,
      "--terminal-slot-width": `${Math.max(0, rect.width || 0)}px`,
      "--terminal-slot-x": `${rect.left || 0}px`,
      "--terminal-slot-y": `${rect.top || 0}px`,
    };
  }, [
    fullscreenActive,
    fullscreenTerminalIndex,
    terminalDragState,
    terminalBreakoutLayoutActive,
    terminalBreakoutPlacements,
    terminalBreakoutViewport,
    terminalLayoutRects,
    terminalPanelRect,
  ]);

  const todoDragOverDropTarget = Boolean(
    todoDragActive && Number.isInteger(todoDragState?.targetTerminalIndex),
  );
  const todoDragImage = getTodoQueueItemImage(todoDragState);
  const todoDragNote = getTodoQueueItemNote(todoDragState);
  const todoDragHasPreview = Boolean(todoDragImage || todoDragNote);
  const terminalWorkspaceContent = hasVisibleWorkspaceTerminalPanes ? (
    <WorkspaceTerminalPanels
      data-terminal-breakout={terminalBreakoutVisible ? "true" : "false"}
      data-terminal-dragging={terminalDragActive ? "true" : "false"}
      data-terminal-fullscreen={fullscreenActive ? "true" : "false"}
      data-terminal-fullscreen-state={fullscreenState}
      data-todo-dragging={todoDragOverDropTarget ? "true" : "false"}
      ref={terminalPanelsRef}
      style={fullscreenMotionStyle}
    >
      <TerminalGridScaffold
        aria-hidden={terminalBreakoutVisible ? "true" : undefined}
        data-breakout-visible={terminalBreakoutVisible ? "true" : "false"}
      >
        <ResizePanelGroup
          id={`workspace-terminal-rows-${terminalWorkspace.id}`}
          orientation="vertical"
        >
          {activeDisplayRows.map((row, rowOrderIndex) => (
            <Fragment key={`row-${row.rowIndex}`}>
              {rowOrderIndex > 0 && (
                <ResizeHandle
                  data-direction="vertical"
                />
              )}
              <ResizePanel
                data-terminal-row="true"
                defaultSize={`${100 / activeDisplayRows.length}%`}
                id={`workspace-terminal-row-${terminalWorkspace.id}-${row.rowIndex}`}
                minSize={getTerminalPaneMinSizePercent(activeDisplayRows.length)}
              >
                <ResizePanelGroup
                  id={`workspace-terminal-cols-${terminalWorkspace.id}-${row.rowIndex}`}
                  orientation="horizontal"
                >
                  {row.terminalIndexes.map((terminalIndex, columnIndex) => (
                    <Fragment key={`${terminalWorkspace.id}-${terminalIndex}`}>
                      {columnIndex > 0 && (
                        <ResizeHandle
                          data-direction="horizontal"
                        />
                      )}
                      <ResizePanel
                        data-terminal-column="true"
                        data-terminal-leaf="true"
                        defaultSize={`${100 / row.terminalIndexes.length}%`}
                        id={`workspace-terminal-col-${terminalWorkspace.id}-${terminalIndex}`}
                        minSize={getTerminalPaneMinSizePercent(row.terminalIndexes.length)}
                      >
                        <TerminalPanelAnchor
                          data-terminal-drag-placeholder={
                            terminalDragState?.mode !== "canvas" && terminalDragState?.terminalIndex === terminalIndex ? "true" : undefined
                          }
                          data-terminal-index={terminalIndex}
                          data-terminal-panel-anchor="true"
                        />
                      </ResizePanel>
                    </Fragment>
                  ))}
                </ResizePanelGroup>
              </ResizePanel>
            </Fragment>
          ))}
        </ResizePanelGroup>
      </TerminalGridScaffold>
      <TerminalBreakoutCanvas
        aria-hidden={terminalBreakoutVisible ? undefined : "true"}
        data-panning={terminalBreakoutPanning ? "true" : undefined}
        data-visible={terminalBreakoutVisible ? "true" : "false"}
        style={{
          "--terminal-breakout-pan-x": `${Math.round(terminalBreakoutViewport.x || 0)}px`,
          "--terminal-breakout-pan-y": `${Math.round(terminalBreakoutViewport.y || 0)}px`,
          "--terminal-breakout-zoom": terminalBreakoutViewport.zoom || TERMINAL_BREAKOUT_DEFAULT_ZOOM,
        }}
      >
        <TerminalBreakoutBackgroundCanvas
          aria-hidden="true"
          ref={terminalBreakoutBackgroundCanvasRef}
        />
        <TerminalBreakoutPanPlane onPointerDown={handleBreakoutPanPointerDown} />
      </TerminalBreakoutCanvas>
      <TerminalSurfaceLayer
        aria-hidden={false}
        data-terminal-breakout={terminalBreakoutVisible ? "true" : "false"}
      >
        {logicalTerminalIndexes.map((terminalIndex) => {
          const draggingThisTerminal = terminalDragState?.terminalIndex === terminalIndex;
          const fullscreenThisTerminal = fullscreenActive && terminalIndex === fullscreenTerminalIndex;
          const terminalProjectTarget = getTerminalProjectTarget(terminalIndex);
          const hasMeasuredRect = Boolean(terminalLayoutRects[terminalIndex])
            || (terminalBreakoutLayoutActive && terminalBreakoutPlacements[terminalIndex])
            || draggingThisTerminal
            || fullscreenThisTerminal;

          return (
            <TerminalSurfaceSlot
              data-terminal-dragging={draggingThisTerminal ? "true" : "false"}
              data-terminal-fullscreen={fullscreenThisTerminal ? "true" : "false"}
              data-terminal-hidden={hasMeasuredRect ? "false" : "true"}
              key={`${terminalWorkspace.id}-${terminalIndex}`}
              onPointerDownCapture={(event) => handleTerminalBreakoutSlotPointerDownCapture(event, terminalIndex)}
              style={getTerminalSlotStyle(terminalIndex)}
            >
              <WorkspaceTerminal
                key={`${terminalWorkspace.id}-${terminalIndex}`}
                agent={getTerminalAgent(terminalIndex)}
                agentLaunchEpoch={workspaceAgentLaunchEpoch}
                agentLaunchReady={workspaceTerminalAgentLaunchReady}
                agentStatuses={agentStatuses}
                agentStatusError={agentStatusError}
                agentStatusState={agentStatusState}
                fullscreenState={fullscreenState}
                isActive={activePaneId === getTerminalPaneId(terminalIndex)}
                isFullscreen={fullscreenThisTerminal}
                onActivateTerminal={handleActivateTerminalPane}
                onBeginTerminalDrag={handleBeginTerminalDrag}
                onChangeTerminalRole={changeWorkspaceTerminalRole}
                onCloseTerminal={closeWorkspaceTerminal}
                onCreateWorkspaceThreadTerminal={createWorkspaceThreadTerminal}
                onOpenSettings={showSettingsView}
                onArchiveWorkspaceThread={onArchiveWorkspaceThread}
                onPreparedTerminalChange={handlePreparedTerminalChange}
                onRecheckAgents={refreshAgentStatuses}
                onSplitTerminal={handleSplitTerminal}
                onSelectWorkspaceThread={onSelectWorkspaceThread}
                onToggleWorkspaceThreadPinned={onToggleWorkspaceThreadPinned}
                onWorkspaceThreadsViewStateChange={onWorkspaceThreadsViewStateChange}
                  onThreadTerminalLifecycle={handleWorkspaceTerminalLifecycle}
                onToggleFullscreenTerminal={handleToggleFullscreenTerminal}
                prewarmShell={shouldPrewarmWorkspaceTerminals}
                projectRoot={terminalProjectTarget?.mountId ? terminalProjectTarget.repoPath : ""}
                mountId={terminalProjectTarget?.mountId || ""}
                startupReady={terminalStartupReady}
                terminalBreakoutActive={terminalBreakoutLayoutActive}
                terminalCount={terminalWorkspaceLogicalTerminalCount}
                terminalIndex={terminalIndex}
                terminalRole={getTerminalRole(terminalIndex)}
                thread={getTerminalThread(terminalIndex)}
                threadsViewActive={fullscreenThisTerminal}
                todoDropActive={todoDragActive || workspaceFileDragActive}
                todoDropTarget={
                  todoDragState?.targetTerminalIndex === terminalIndex
                    || workspaceFileDragState?.targetTerminalIndex === terminalIndex
                }
                todoDropUnsupportedMessage={todoDragState?.targetTerminalIndex === terminalIndex
                  ? getTerminalTodoDropUnsupportedMessage(terminalIndex)
                  : ""}
                workingDirectory={terminalWorkspaceWorkingDirectory}
                workspace={terminalWorkspace}
                workspaceError={workspaceError}
                workspaceRootWasEmptyAtSelection={terminalWorkspaceRootWasEmptyAtSelection}
                workspaceThreads={workspaceThreads}
                workspaces={workspaces}
                selectedWorkspaceThreadId={selectedWorkspaceThreadId}
              />
            </TerminalSurfaceSlot>
          );
        })}
      </TerminalSurfaceLayer>
      {terminalBreakoutVisible && (
        <TerminalBreakoutTopBar data-terminal-control="true">
          <TerminalBreakoutButton
            aria-label="Add terminal to canvas"
            disabled={!addWorkspaceTerminal || logicalTerminalIndexes.length >= MAX_WORKSPACE_TERMINAL_COUNT}
            onClick={handleAddTerminalToBreakout}
            title={
              logicalTerminalIndexes.length >= MAX_WORKSPACE_TERMINAL_COUNT
                ? "Terminal limit reached"
                : "Add terminal"
            }
            type="button"
          >
            <ButtonAddIcon aria-hidden="true" />
          </TerminalBreakoutButton>
          <TerminalBreakoutTopBarDivider aria-hidden="true" />
          <TerminalBreakoutButton
            aria-label="Zoom out terminal canvas"
            disabled={(terminalBreakoutViewport.zoom || TERMINAL_BREAKOUT_DEFAULT_ZOOM) <= TERMINAL_BREAKOUT_MIN_ZOOM + 0.01}
            onClick={zoomOutTerminalBreakoutCanvas}
            title="Zoom out"
            type="button"
          >
            <ZoomOut aria-hidden="true" />
          </TerminalBreakoutButton>
          <TerminalBreakoutButton
            aria-label="Zoom in terminal canvas"
            disabled={(terminalBreakoutViewport.zoom || TERMINAL_BREAKOUT_DEFAULT_ZOOM) >= TERMINAL_BREAKOUT_MAX_ZOOM - 0.01}
            onClick={zoomInTerminalBreakoutCanvas}
            title="Zoom in"
            type="button"
          >
            <ZoomIn aria-hidden="true" />
          </TerminalBreakoutButton>
          <TerminalBreakoutTopBarDivider aria-hidden="true" />
          <TerminalBreakoutButton
            aria-label="Fit terminals"
            onClick={fitTerminalBreakoutCanvas}
            title="Fit terminals"
            type="button"
          >
            <ButtonFullscreenIcon aria-hidden="true" />
          </TerminalBreakoutButton>
          <TerminalBreakoutButton
            aria-label="Reset terminal canvas layout"
            onClick={resetTerminalBreakoutLayout}
            title="Reset layout"
            type="button"
          >
            <ButtonRefreshIcon aria-hidden="true" />
          </TerminalBreakoutButton>
          <TerminalBreakoutTopBarDivider aria-hidden="true" />
          <TerminalBreakoutButton
            aria-label="Exit terminal breakout canvas"
            onClick={closeTerminalBreakout}
            title="Exit breakout"
            type="button"
          >
            <ButtonFullscreenExitIcon aria-hidden="true" />
          </TerminalBreakoutButton>
        </TerminalBreakoutTopBar>
      )}
    </WorkspaceTerminalPanels>
  ) : !hasWorkspaceTerminals ? (
    <WorkspaceTerminal
      key={`${terminalWorkspace?.id || "empty"}-${logicalTerminalIndexes[0] || 0}`}
      agent={terminalWorkspace ? workspaceTerminalRenderAgent : null}
      agentLaunchEpoch={workspaceAgentLaunchEpoch}
      agentLaunchReady={workspaceTerminalAgentLaunchReady}
      agentStatuses={agentStatuses}
      agentStatusError={agentStatusError}
      agentStatusState={agentStatusState}
      fullscreenState="idle"
      isActive={activePaneId === getTerminalPaneId(logicalTerminalIndexes[0] || 0)}
      isFullscreen={false}
      onActivateTerminal={handleActivateTerminalPane}
      onChangeTerminalRole={changeWorkspaceTerminalRole}
      onCloseTerminal={closeWorkspaceTerminal}
      onCreateWorkspaceThreadTerminal={createWorkspaceThreadTerminal}
      onOpenSettings={showSettingsView}
      onArchiveWorkspaceThread={onArchiveWorkspaceThread}
      onPreparedTerminalChange={handlePreparedTerminalChange}
      onRecheckAgents={refreshAgentStatuses}
      onSplitTerminal={handleSplitTerminal}
      onSelectWorkspaceThread={onSelectWorkspaceThread}
      onToggleWorkspaceThreadPinned={onToggleWorkspaceThreadPinned}
      onWorkspaceThreadsViewStateChange={onWorkspaceThreadsViewStateChange}
        onThreadTerminalLifecycle={handleWorkspaceTerminalLifecycle}
      onToggleFullscreenTerminal={handleToggleFullscreenTerminal}
      prewarmShell={terminalWorkspace ? shouldPrewarmWorkspaceTerminals : false}
      projectRoot={getTerminalProjectTarget(logicalTerminalIndexes[0] || 0)?.mountId
        ? getTerminalProjectTarget(logicalTerminalIndexes[0] || 0)?.repoPath
        : ""}
      mountId={getTerminalProjectTarget(logicalTerminalIndexes[0] || 0)?.mountId || ""}
      startupReady={terminalStartupReady}
      terminalBreakoutActive={false}
      terminalCount={terminalWorkspaceLogicalTerminalCount}
      terminalIndex={logicalTerminalIndexes[0] || 0}
      terminalRole={getTerminalRole(logicalTerminalIndexes[0] || 0)}
      thread={getTerminalThread(logicalTerminalIndexes[0] || 0)}
      threadsViewActive={false}
      todoDropActive={todoDragActive || workspaceFileDragActive}
      todoDropTarget={
        todoDragState?.targetTerminalIndex === (logicalTerminalIndexes[0] || 0)
          || workspaceFileDragState?.targetTerminalIndex === (logicalTerminalIndexes[0] || 0)
      }
      todoDropUnsupportedMessage={todoDragState?.targetTerminalIndex === (logicalTerminalIndexes[0] || 0)
        ? getTerminalTodoDropUnsupportedMessage(logicalTerminalIndexes[0] || 0)
        : ""}
      workingDirectory={terminalWorkspaceWorkingDirectory}
      workspace={terminalWorkspace}
      workspaceError={workspaceError}
      workspaceRootWasEmptyAtSelection={terminalWorkspaceRootWasEmptyAtSelection}
      workspaceThreads={workspaceThreads}
      workspaces={workspaces}
      selectedWorkspaceThreadId={selectedWorkspaceThreadId}
    />
  ) : null;

  return (
    <ForgeWorkspace aria-label="Forge workspace" data-motion={viewMotion}>
      {shouldShowWorkspaceSetup ? (
        <WorkspaceSetupPanel onSubmit={createFirstWorkspace}>
          <SetupHeader>
            <Kicker>First workspace</Kicker>
            <DashboardTitle>Create your workspace</DashboardTitle>
            <PageSubline>Name it and choose the project root that will be bound to this workspace.</PageSubline>
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
          <WorkspaceRootChooser>
            <SettingsLabel>Root directory</SettingsLabel>
            <RootDirectoryInput
              placeholder={defaultWorkingDirectory || "Choose project root"}
              readOnly
              title={newWorkspaceRootDraft || defaultWorkingDirectory}
              value={newWorkspaceRootDraft || defaultWorkingDirectory}
            />
            <WorkspaceRootActions>
              <SecondaryButton
                disabled={workspaceSyncState === "creating"}
                onClick={chooseNewWorkspaceRootDirectory}
                type="button"
              >
                <ButtonFolderIcon aria-hidden="true" />
                <span>Choose directory</span>
              </SecondaryButton>
              <SecondaryButton
                disabled={!defaultWorkingDirectory || workspaceSyncState === "creating"}
                onClick={useDefaultNewWorkspaceRoot}
                type="button"
              >
                <ButtonFolderIcon aria-hidden="true" />
                <span>Use app dir</span>
              </SecondaryButton>
            </WorkspaceRootActions>
          </WorkspaceRootChooser>
          <PrimaryButton disabled={workspaceSyncState === "creating"} type="submit">
            <ButtonForgeIcon aria-hidden="true" />
            <span>{workspaceSyncState === "creating" ? "Creating..." : "Create workspace"}</span>
          </PrimaryButton>
        </WorkspaceSetupPanel>
      ) : (
          <TerminalWorkspaceMain
            data-workspace-tool-fullscreen={todoQueuePaneFullscreen ? "true" : "false"}
            data-workspace-tool-pane-mode={todoQueuePaneMode}
            ref={terminalWorkspaceMainRef}
          >
            {hasVisibleWorkspaceTerminalPanes ? (
              <ResizePanelGroup
                id={`workspace-terminal-main-${terminalWorkspace.id}`}
                orientation="horizontal"
              >
                <ResizePanel
                  data-workspace-tool-main-grid="true"
                  defaultSize={todoQueueVisible ? `${terminalGridPanelSize}%` : "100%"}
                  id={`workspace-terminal-main-grid-${terminalWorkspace.id}`}
                  minSize={todoQueueVisible ? `${terminalGridPanelMinSize}%` : "100%"}
                  ref={terminalGridPanelRef}
                >
                  {terminalWorkspaceContent}
                </ResizePanel>
                {todoQueueVisible && (
                  <>
                    <ResizeHandle data-direction="horizontal" data-workspace-tool-resize-handle="true" />
                    <ResizePanel
                      data-pane-mode={todoQueuePaneMode}
                      data-workspace-tool-panel="true"
                      defaultSize={`${todoQueuePanelSize}%`}
                      id={`workspace-terminal-todo-queue-${terminalWorkspace.id}`}
                      maxSize={`${todoQueuePanelMaxSize}%`}
                      minSize={`${todoQueuePanelMinSize}%`}
                      ref={todoQueuePanelRef}
                    >
                      {todoQueuePaneMinimized ? (
                        <WorkspaceToolMinimizedRail aria-label="Workspace tools minimized">
                          <WorkspaceToolRailControls>
                            <WorkspaceToolControlButton
                              aria-label="Unminimize workspace tools"
                              onClick={restoreTodoQueuePane}
                              title="Unminimize"
                              type="button"
                            >
                              <TitleRestoreIcon aria-hidden="true" />
                            </WorkspaceToolControlButton>
                          </WorkspaceToolRailControls>
                          <WorkspaceToolRailLabel>Tools</WorkspaceToolRailLabel>
                        </WorkspaceToolMinimizedRail>
                      ) : (
                        <TodoQueuePanel
                          accountKey={accountKey}
                          activeDragItemId={todoDragState?.itemId || ""}
                          agentStatuses={agentStatuses}
                          billingStatus={billingStatus}
                          defaultWorkingDirectory={defaultWorkingDirectory}
                          draft={todoQueueDraft}
                          dropError={todoDropError}
                          getItemAccentColor={getTodoQueueItemAccentColor}
                          items={visibleTodoQueueItems}
                          onBeginWorkspaceFileDrag={handleBeginWorkspaceFileDrag}
                          onBeginTodoDrag={handleBeginTodoDrag}
                          onCancelQueuedItem={cancelQueuedTodoQueueItem}
                          onDraftChange={setTodoQueueDraft}
                          onMinimizePane={minimizeTodoQueuePane}
                          onOpenWorkspaceSettings={onOpenWorkspaceSettings}
                          onQueueItem={queueTodoQueueItem}
                          onRemoveItem={removeTodoQueueItem}
                          onReorderItem={reorderTodoQueueItem}
                          onResumePlan={handleResumeTerminalPlan}
                          onSubmitDraft={submitTodoQueueDraft}
                          onToggleTerminalBreakout={toggleTerminalBreakout}
                          onToggleFullscreenPane={toggleFullscreenTodoQueuePane}
                          onUpdateItem={updateTodoQueueItemText}
                          onVoiceAgentToolCall={handleVoiceAgentToolCall}
                          onVoicePlanServerResult={handleVoicePlanServerResult}
                          paneMode={todoQueuePaneMode}
                          pendingItems={todoQueuePendingItems}
                          rootDirectory={terminalWorkspaceWorkingDirectory || defaultWorkingDirectory}
                          selectedTerminalPlanTarget={selectedTerminalPlanTarget}
                          terminalBreakoutActive={terminalBreakoutVisible}
                          workspace={terminalWorkspace}
                          workspaceError={workspaceError}
                          workspaceId={terminalWorkspace.id}
                        />
                      )}
                    </ResizePanel>
                  </>
                )}
              </ResizePanelGroup>
            ) : terminalWorkspaceContent}
            {todoDragState && (
              <TodoDragPreview
                aria-hidden="true"
                style={{
                  "--todo-drag-width": `${Math.max(220, Number(todoDragState.width || 0))}px`,
                  "--todo-drag-x": `${Math.round(Number(todoDragState.x || 0))}px`,
                  "--todo-drag-y": `${Math.round(Number(todoDragState.y || 0))}px`,
                }}
              >
                <TodoQueueItemContent data-has-preview={todoDragHasPreview ? "true" : "false"}>
                  {todoDragImage && (
                    <TodoQueueItemImageFrame>
                      <TodoQueueItemImage alt="" src={todoDragImage.src} />
                    </TodoQueueItemImageFrame>
                  )}
                  {!todoDragImage && todoDragNote && (
                    <TodoQueueItemNoteFrame>
                      <TodoQueueItemNoteTitle>{todoDragNote.title}</TodoQueueItemNoteTitle>
                      <TodoQueueItemNoteIcon aria-hidden="true" />
                    </TodoQueueItemNoteFrame>
                  )}
                  {normalizeTodoQueueText(todoDragState.text) && (
                    <TodoDragPreviewText>{todoDragState.text}</TodoDragPreviewText>
                  )}
                </TodoQueueItemContent>
              </TodoDragPreview>
            )}
            {workspaceFileDragState && (
              <TodoDragPreview
                aria-hidden="true"
                style={{
                  "--todo-drag-width": `${Math.max(220, Number(workspaceFileDragState.width || 0))}px`,
                  "--todo-drag-x": `${Math.round(Number(workspaceFileDragState.x || 0))}px`,
                  "--todo-drag-y": `${Math.round(Number(workspaceFileDragState.y || 0))}px`,
                }}
              >
                <TodoQueueItemContent data-has-preview="false">
                  <TodoDragPreviewText>
                    {workspaceFileDragState.file?.name
                      || workspaceFileDragState.file?.relativePath
                      || "Workspace file"}
                  </TodoDragPreviewText>
                </TodoQueueItemContent>
              </TodoDragPreview>
            )}
          </TerminalWorkspaceMain>
      )}
    </ForgeWorkspace>
  );
}

export default memo(TerminalView);

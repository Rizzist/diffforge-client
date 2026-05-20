import { invoke } from "@tauri-apps/api/core";
import { AddToQueue } from "@styled-icons/material-rounded/AddToQueue";
import { Close } from "@styled-icons/material-rounded/Close";
import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import styled, { keyframes } from "styled-components";

import {
  ButtonForgeIcon,
  DashboardTitle,
  ForgeWorkspace,
  FormMessage,
  Kicker,
  PageSubline,
  PrimaryButton,
  ResizeHandle,
  ResizePanel,
  ResizePanelGroup,
  SettingsLabel,
  SetupField,
  SetupHeader,
  SetupInput,
  WorkspaceSetupPanel,
  WorkspaceTerminalPanels,
} from "../app/appStyles";
import {
  getAudioInputErrorMessage,
  readSelectedAudioInputDeviceId,
  startLowPowerAudioBuffer,
} from "../audio/audioCapture";
import { getAgentModelImageInputCapability } from "../agents/imageInputCapabilities";
import {
  getBigViewTextDiagnosticFields,
  logBigViewSyncDiagnosticEvent,
  logFileDragDiagnosticEvent,
} from "../threads/bigViewSyncDiagnostics";
import { getWorkspaceThreadProviderBinding } from "../threads/workspaceThreads";
import FilesWorkspaceView from "../files/FilesWorkspaceView.jsx";
import WebWorkspaceView from "../web/WebWorkspaceView.jsx";
import WorkspaceTerminal, {
  getTerminalPaneMinSizePercent,
  getWorkspaceTerminalPaneId,
} from "./WorkspaceTerminal.jsx";
import {
  buildTerminalComposerDraftInput,
  getTerminalInputDebugFields,
  TERMINAL_SHIFT_ENTER_SEQUENCE,
} from "./WorkspaceTerminal/terminalCore.js";
import {
  appendWorkspaceThreadComposerAttachments,
  clearActiveWorkspaceFileDrag,
  createTerminalPromptSubmittedWaiter,
  createThreadProjectionToken,
  createWorkspaceThreadPromptAcceptedWaiter,
  getActiveWorkspaceFileDrag,
  getDraggedWorkspaceFile,
  getTerminalSubmitSequence,
  getThreadComposerSyncKey,
  getWorkspaceThreadComposerAttachments,
  getWorkspaceThreadComposerDraftStore,
  isWorkspaceFileDragTransfer,
  requestTerminalSubmitDiagnosticSnapshot,
  setActiveWorkspaceFileDrag,
  setWorkspaceThreadComposerDraft,
  subscribeWorkspaceThreadComposerAttachments,
  subscribeWorkspaceThreadComposerDrafts,
  waitForWorkspaceThreadPromptAcceptedWithEnterRetries,
  WORKSPACE_FILE_POINTER_DROP_EVENT,
  workspaceFileToComposerAttachment,
} from "./WorkspaceTerminal/threadRuntime.js";

const TERMINAL_FULLSCREEN_TRANSITION_MS = 190;
const TODO_DROP_PROMPT_ACCEPT_RETRY_DELAYS_MS = [1000];
const TODO_QUEUE_CONSUME_TIMEOUT_MS = 45000;
const TODO_QUEUE_PENDING_SPOKES = Array.from({ length: 8 }, (_, index) => index);
const TODO_QUEUE_AGENT_ROLES = new Set(["codex", "claude", "opencode"]);
const TODO_QUEUE_BUSY_REASONS = new Set([
  "busy_activity",
  "busy_turn",
  "composer_attachments_present",
  "composer_draft_present",
  "pending_prompt",
  "reserved",
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
const ORCHESTRATOR_VOICE_OWNER = "orchestrator-voice-agent";
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
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;

  html[data-forge-theme="light"] & {
    background: #f5f5f7;
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
`;

const TerminalSurfaceSlot = styled.div`
  position: absolute;
  top: 0;
  left: 0;
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

const TODO_QUEUE_STORAGE_PREFIX = "diffforge.todoQueue.v1";
const TODO_QUEUE_VISIBLE_MIN_WIDTH = 1120;
const TODO_QUEUE_MAX_ITEMS = 120;
const TODO_QUEUE_MAX_TEXT_LENGTH = 4000;
const TODO_QUEUE_MAX_NOTE_TEXT_LENGTH = 24000;
const TODO_QUEUE_NOTE_LINE_THRESHOLD = 6;
const TODO_QUEUE_NOTE_TITLE_LENGTH = 42;
const TODO_QUEUE_MAX_PASTE_IMAGES = 8;
const TODO_QUEUE_IMAGE_TERMINALS = new Set(["codex", "claude"]);
const WORKSPACE_TOOL_TABS = [
  { id: "orchestrator", label: "Orchestrator" },
  { id: "files", label: "Files" },
  { id: "web", label: "Web" },
];

const TodoQueueSurface = styled.aside`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
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
  min-height: 128px;
  place-items: center;
  border-bottom: 1px solid rgba(230, 236, 245, 0.08);
  background:
    radial-gradient(circle at center, rgba(98, 160, 255, 0.14), transparent 62%),
    rgba(2, 4, 8, 0.26);

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(0, 0, 0, 0.08);
    background: #ffffff;
  }
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
  place-items: center;
  padding: 18px;
  color: #7f8da1;
  background: rgba(2, 4, 8, 0.76);
  font-size: 12px;
  font-weight: 720;

  html[data-forge-theme="light"] & {
    color: #7a7a7a;
    background: #ffffff;
  }
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
    content: "\\2022";
    color: #8bb8ff;
    font-size: 13px;
    font-weight: 900;
    line-height: 1.45;
  }

  &:hover {
    background: rgba(47, 128, 255, 0.1);
  }

  &:hover::before,
  &:focus-within::before {
    content: "";
  }

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
  }

  html[data-forge-theme="light"] &::before {
    color: #0066cc;
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
  top: 8px;
  left: 14px;
  z-index: 2;
  width: 16px;
  height: 16px;
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
  font-size: 12px;
  font-weight: 690;
  line-height: 1.45;

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
  font-size: 12px;
  font-weight: 690;
  line-height: 1.45;
  font-family: inherit;

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
  }
`;

const TodoQueueDraftBullet = styled.span`
  position: absolute;
  top: calc(8px + var(--todo-list-offset, 0px));
  left: 12px;
  z-index: 1;
  color: #8bb8ff;
  font-size: 13px;
  font-weight: 900;
  line-height: 1.45;
  pointer-events: none;
  transition: top 150ms ease;

  &::before {
    content: "\\2022";
  }

  html[data-forge-theme="light"] & {
    color: #0066cc;
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

function getTodoQueueItemNote(item) {
  return normalizeTodoQueueNote(item?.note || item?.noteText || item?.longText);
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

function normalizeTodoTerminalAgentId(value) {
  return String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
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
      return {
        hasImage: Boolean(image),
        hasNote: Boolean(note),
        id: String(item?.id || ""),
        image: image ? getTodoImageLogSummary([image])[0] || null : null,
        noteLength: note ? normalizeTodoQueueMultilineText(note.text).length : 0,
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

function createTodoQueueItem(text, options = {}) {
  const createdAt = new Date().toISOString();
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const image = normalizeTodoQueueImage(options.image);
  const note = normalizeTodoQueueNote(options.note);

  return {
    createdAt,
    id,
    ...(image ? { image } : {}),
    ...(note ? { note } : {}),
    text,
  };
}

function normalizeTodoQueueItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  const text = normalizeTodoQueueText(item.text);
  const image = getTodoQueueItemImage(item);
  const note = getTodoQueueItemNote(item);
  if (!text && !image && !note) {
    return null;
  }

  return {
    createdAt: typeof item.createdAt === "string" ? item.createdAt : new Date().toISOString(),
    id: typeof item.id === "string" && item.id.trim()
      ? item.id
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    ...(image ? { image } : {}),
    ...(note ? { note } : {}),
    text,
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
    return normalizeTodoQueueItems(JSON.parse(window.localStorage.getItem(storageKey) || "[]"));
  } catch {
    return [];
  }
}

function writeTodoQueueItems(storageKey, items) {
  if (!canUseTodoQueueStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(normalizeTodoQueueItems(items)));
  } catch {
    // The queue is a convenience layer; storage failures should not interrupt terminal work.
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
  activeDragItemId = "",
  defaultWorkingDirectory = "",
  draft,
  dropError = "",
  items,
  onBeginWorkspaceFileDrag,
  onBeginTodoDrag,
  onCancelQueuedItem,
  onDraftChange,
  onOpenWorkspaceSettings,
  onQueueItem,
  onRemoveItem,
  onReorderItem,
  onSubmitDraft,
  onUpdateItem,
  pendingItems = {},
  rootDirectory = "",
  workspace,
  workspaceError = "",
  workspaceId,
}) {
  const [activeWorkspaceTool, setActiveWorkspaceTool] = useState("orchestrator");
  const [activeOrchestratorSection, setActiveOrchestratorSection] = useState("todo");
  const [editingItemId, setEditingItemId] = useState("");
  const [editingDraft, setEditingDraft] = useState("");
  const [orchestratorVoiceError, setOrchestratorVoiceError] = useState("");
  const [orchestratorVoiceState, setOrchestratorVoiceState] = useState("idle");
  const [orchestratorVoiceStats, setOrchestratorVoiceStats] = useState(EMPTY_ORCHESTRATOR_VOICE_STATS);
  const [reorderingItemId, setReorderingItemId] = useState("");
  const [todoListOffset, setTodoListOffset] = useState(0);
  const orchestratorVoiceMonitorRef = useRef(null);
  const orchestratorVoiceRunRef = useRef(0);
  const todoBoardRef = useRef(null);
  const todoItemElementsRef = useRef(new Map());
  const todoReorderDragRef = useRef(null);
  const draftTextAreaRef = useRef(null);
  const editingTextAreaRef = useRef(null);
  const todoListRef = useRef(null);
  const skipEditBlurCommitRef = useRef(false);

  const stopOrchestratorVoiceMonitor = useCallback(async () => {
    orchestratorVoiceRunRef.current += 1;
    const monitor = orchestratorVoiceMonitorRef.current;
    orchestratorVoiceMonitorRef.current = null;
    setOrchestratorVoiceState("idle");
    setOrchestratorVoiceStats(EMPTY_ORCHESTRATOR_VOICE_STATS);
    setOrchestratorVoiceError("");
    await monitor?.close?.().catch(() => {});
  }, []);

  const startOrchestratorVoiceMonitor = useCallback(async () => {
    const runId = orchestratorVoiceRunRef.current + 1;
    orchestratorVoiceRunRef.current = runId;
    setOrchestratorVoiceState("starting");
    setOrchestratorVoiceStats(EMPTY_ORCHESTRATOR_VOICE_STATS);
    setOrchestratorVoiceError("");

    try {
      const monitor = await startLowPowerAudioBuffer({
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
        await monitor.close().catch(() => {});
        return;
      }

      orchestratorVoiceMonitorRef.current = monitor;
      setOrchestratorVoiceState("listening");
    } catch (error) {
      if (orchestratorVoiceRunRef.current !== runId) {
        return;
      }

      orchestratorVoiceMonitorRef.current = null;
      setOrchestratorVoiceStats(EMPTY_ORCHESTRATOR_VOICE_STATS);
      setOrchestratorVoiceState("error");
      setOrchestratorVoiceError(getAudioInputErrorMessage(
        error,
        "Unable to open the selected input source.",
      ));
    }
  }, []);

  const toggleOrchestratorVoiceMonitor = useCallback(() => {
    if (orchestratorVoiceState === "starting" || orchestratorVoiceState === "listening") {
      void stopOrchestratorVoiceMonitor();
      return;
    }

    void startOrchestratorVoiceMonitor();
  }, [orchestratorVoiceState, startOrchestratorVoiceMonitor, stopOrchestratorVoiceMonitor]);

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
    const monitor = orchestratorVoiceMonitorRef.current;
    orchestratorVoiceMonitorRef.current = null;
    monitor?.close?.().catch(() => {});
  }, []);

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
  const orchestratorVoiceActive = orchestratorVoiceState === "starting"
    || orchestratorVoiceState === "listening";
  const orchestratorVoiceHasSignal = orchestratorVoiceActive && orchestratorVoiceLevel >= 6;
  const orchestratorVoiceButtonLabel = orchestratorVoiceState === "starting"
    ? "Starting voice agent monitor"
    : orchestratorVoiceState === "listening"
      ? "Stop voice agent monitor"
      : orchestratorVoiceError
        ? "Restart voice agent monitor"
        : "Start voice agent monitor";
  const orchestratorVoiceButtonTitle = orchestratorVoiceError
    || (orchestratorVoiceState === "starting"
      ? "Starting input"
      : orchestratorVoiceState === "listening"
        ? "Stop listening"
        : "Start listening");

  return (
    <TodoQueueSurface aria-label="Orchestrator">
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
      {activeWorkspaceTool === "files" ? (
        <WorkspaceToolSurface data-tool="files">
          <FilesWorkspaceView
            defaultWorkingDirectory={defaultWorkingDirectory}
            onBeginWorkspaceFileDrag={onBeginWorkspaceFileDrag}
            onOpenWorkspaceSettings={onOpenWorkspaceSettings}
            rootDirectory={rootDirectory}
            workspace={workspace}
            workspaceError={workspaceError}
          />
        </WorkspaceToolSurface>
      ) : activeWorkspaceTool === "web" ? (
        <WorkspaceToolSurface data-tool="web">
          <WebWorkspaceView
            defaultWorkingDirectory={defaultWorkingDirectory}
            rootDirectory={rootDirectory}
            workspace={workspace}
          />
        </WorkspaceToolSurface>
      ) : (
        <OrchestratorView>
          <OrchestratorVoiceArea>
            <OrchestratorVoiceButton
              aria-label={orchestratorVoiceButtonLabel}
              data-error={orchestratorVoiceError ? "true" : undefined}
              data-monitoring={orchestratorVoiceActive ? "true" : undefined}
              data-starting={orchestratorVoiceState === "starting" ? "true" : undefined}
              onClick={toggleOrchestratorVoiceMonitor}
              title={orchestratorVoiceButtonTitle}
              type="button"
            >
              <OrchestratorVoiceCanvasRing
                active={orchestratorVoiceActive}
                hasSignal={orchestratorVoiceHasSignal}
                level={orchestratorVoiceLevel}
                stats={orchestratorVoiceStats}
              />
              <OrchestratorVoiceLogo />
            </OrchestratorVoiceButton>
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

                        return (
                          <TodoQueueItemCard
                            data-todo-card="true"
                            data-todo-dragging={activeDragItemId === item.id ? "true" : undefined}
                            data-todo-editing={isEditing ? "true" : undefined}
                            data-todo-pending={isPending ? "true" : undefined}
                            data-todo-queued={isQueued ? "true" : undefined}
                            data-todo-reordering={reorderingItemId === item.id ? "true" : undefined}
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
                            title={
                              isQueued
                                ? "Queued for the next available agent."
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
              <OrchestratorHistoryView>Voice history</OrchestratorHistoryView>
            )}
          </OrchestratorContent>
        </OrchestratorView>
      )}
    </TodoQueueSurface>
  );
});

function TerminalView({
  defaultWorkingDirectory = "",
  terminalWorkspace,
  terminalAgentsByIndex = {},
  terminalRolesByIndex = {},
  terminalThreadsByIndex = {},
  terminalWorkspaceWorkingDirectory,
  terminalWorkspaceLogicalIndexes,
  terminalWorkspaceLogicalTerminalCount,
  agentStatusError,
  agentStatuses,
  agentStatusState,
  changeWorkspaceTerminalRole,
  closeWorkspaceTerminal,
  createWorkspaceThreadTerminal,
  createFirstWorkspace,
  handlePreparedTerminalChange,
  onOpenWorkspaceSettings,
  onArchiveWorkspaceThread,
  onSelectWorkspaceThread,
  onToggleWorkspaceThreadPinned,
  onWorkspaceThreadsViewStateChange,
  onThreadTerminalLifecycle,
  refreshAgentStatuses,
  reorderWorkspaceTerminalDisplayLayout,
  setWorkspaceName,
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
  workspaceTerminalAgentLaunchReady,
  workspaceTerminalRenderAgent,
  workspaceThreads = {},
  workspaces = [],
}) {
  const hasWorkspaceTerminals = Boolean(terminalWorkspace);
  const logicalTerminalIndexes = Array.isArray(terminalWorkspaceLogicalIndexes)
    ? terminalWorkspaceLogicalIndexes
    : [];
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
  const activeDisplayRows = terminalDragState?.previewRows || displayTerminalRows;
  const activeDisplayRowsSignature = serializeTerminalRows(activeDisplayRows);
  const terminalDragActive = Boolean(terminalDragState);
  const fullscreenActive = Number.isInteger(fullscreenTerminalIndex)
    && logicalTerminalIndexes.includes(fullscreenTerminalIndex);
  const [todoDragState, setTodoDragState] = useState(null);
  const [todoDropError, setTodoDropError] = useState("");
  const todoDragActive = Boolean(todoDragState);
  const [workspaceFileDragState, setWorkspaceFileDragState] = useState(null);
  const workspaceFileDragActive = Boolean(workspaceFileDragState);
  const [todoQueueDraft, setTodoQueueDraft] = useState("");
  const [todoQueueItems, setTodoQueueItems] = useState([]);
  const [todoQueuePendingItems, setTodoQueuePendingItems] = useState({});
  const [todoQueueDispatchRevision, setTodoQueueDispatchRevision] = useState(0);
  const [terminalWorkspaceMainWidth, setTerminalWorkspaceMainWidth] = useState(0);
  const fullscreenTransitionTimerRef = useRef(0);
  const layoutMeasureFrameRef = useRef(0);
  const terminalDragStateRef = useRef(null);
  const terminalLayoutRectsRef = useRef({});
  const terminalPanelRectRef = useRef(null);
  const terminalWorkspaceMainRef = useRef(null);
  const terminalPanelsRef = useRef(null);
  const todoDragStateRef = useRef(null);
  const todoQueueDispatchingRef = useRef(false);
  const todoQueueItemsRef = useRef([]);
  const todoQueuePendingItemsRef = useRef({});
  const todoQueuePendingTimersRef = useRef(new Map());
  const todoQueueTerminalReservationsRef = useRef(new Map());
  const workspaceFileDragStateRef = useRef(null);
  const todoQueueStorageKeyRef = useRef("");
  const todoQueueStorageKey = useMemo(
    () => getTodoQueueStorageKey(terminalWorkspace?.id),
    [terminalWorkspace?.id],
  );
  todoQueueItemsRef.current = todoQueueItems;
  todoQueueStorageKeyRef.current = todoQueueStorageKey;
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
      rects: terminalLayoutRectsRef.current,
      terminalIndexes: logicalTerminalIndexes,
    });
  }, [fullscreenActive, fullscreenTerminalIndex, logicalTerminalIndexes]);
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
  const getLiveTerminalPaneIdForThread = useCallback((threadId) => {
    const safeThreadId = String(threadId || "").trim();
    if (!safeThreadId || !workspaceThreadEntry?.terminals) {
      return "";
    }

    const terminal = Object.values(workspaceThreadEntry.terminals).find((candidate) => (
      candidate?.threadId === safeThreadId
      && ["active", "starting"].includes(String(candidate.status || "").toLowerCase())
      && Number.isInteger(Number.parseInt(candidate.terminalIndex, 10))
    ));

    return terminal ? getTerminalPaneId(Number.parseInt(terminal.terminalIndex, 10)) : "";
  }, [getTerminalPaneId, workspaceThreadEntry]);
  const getTodoQueueTerminalSendTarget = useCallback((terminalIndex, item = null, options = {}) => {
    const targetTerminalIndex = Number(terminalIndex);
    const image = getTodoQueueItemImage(item);
    const itemId = String(options.reservationItemId || item?.id || item?.itemId || "").trim();
    const allowGeneric = options.allowGeneric !== false;
    const requireAvailable = Boolean(options.requireAvailable);
    const baseWorkspaceId = String(item?.workspaceId || terminalWorkspace?.id || "");
    const unavailable = (reason, message, fields = {}) => ({
      available: false,
      image,
      message,
      reason,
      targetTerminalIndex: Number.isInteger(targetTerminalIndex) ? targetTerminalIndex : "",
      workspaceId: baseWorkspaceId,
      ...fields,
    });

    if (!Number.isInteger(targetTerminalIndex) || !logicalTerminalIndexes.includes(targetTerminalIndex)) {
      return unavailable("missing_target_terminal", "Choose an agent terminal for this todo.");
    }

    const paneId = getTerminalPaneId(targetTerminalIndex);
    const targetRole = String(getTerminalRole(targetTerminalIndex) || "").trim().toLowerCase();
    const terminalAgent = getTerminalAgent(targetTerminalIndex);
    const terminalEntries = Object.values(workspaceThreadEntry?.terminals || {});
    const liveTerminal = terminalEntries.find((candidate) => {
      const candidateIndex = Number(candidate?.terminalIndex);
      return Number.isInteger(candidateIndex)
        ? candidateIndex === targetTerminalIndex
        : candidate?.paneId === paneId;
    }) || null;
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
      : liveTerminal?.instanceId
        ? {
          instanceId: liveTerminal.instanceId,
          paneId,
        }
        : null;
    const syncKey = getThreadComposerSyncKey(targetThread, {
      ...resolvedBinding,
      paneId: resolvedBinding?.paneId || paneId,
    });
    const workspaceId = targetThread?.workspaceId || baseWorkspaceId;
    const terminalStatus = String(liveTerminal?.status || "").trim().toLowerCase();
    const latestTurnState = String(targetThread?.latestTurn?.state || "").trim().toLowerCase();
    const activityStatus = String(
      targetThread?.activityStatus
        || targetProviderBinding?.activityStatus
        || "",
    ).trim().toLowerCase();
    const shouldAutoSubmit = Boolean(
      !image
        && targetRole
        && !["generic", "terminal", "shell"].includes(targetRole),
    );
    const targetFields = {
      activityStatus,
      image,
      latestTurnState,
      liveTerminal,
      paneId,
      shouldAutoSubmit,
      syncKey,
      targetBinding: resolvedBinding,
      targetProviderBinding,
      targetRole,
      targetTerminalIndex,
      targetThread,
      terminalAgent,
      terminalStatus,
      workspaceId,
    };

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
    if (!liveTerminal || !["active", "running"].includes(terminalStatus)) {
      return unavailable("terminal_starting", "This terminal is still starting.", targetFields);
    }
    if (!targetThread?.id) {
      return unavailable("terminal_unavailable", "This terminal does not have a live thread yet.", targetFields);
    }
    if (!resolvedBinding?.instanceId) {
      return unavailable("terminal_unavailable", "This terminal is not ready to receive a todo yet.", targetFields);
    }
    if (targetThread?.pendingPrompt) {
      return unavailable("pending_prompt", "This terminal already has a prompt waiting to send.", targetFields);
    }
    if (latestTurnState === "running") {
      return unavailable("busy_turn", "This agent is already working.", targetFields);
    }
    if (activityStatus === "thinking") {
      return unavailable("busy_activity", "This agent is already working.", targetFields);
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

    return {
      ...targetFields,
      available: true,
      imageInputSupport,
      reason: "",
    };
  }, [
    getTerminalAgent,
    getTerminalImageInputSupport,
    getTerminalPaneId,
    getTerminalRole,
    getTerminalThread,
    logicalTerminalIndexes,
    terminalWorkspace?.id,
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
    if (layoutMeasureFrameRef.current) {
      window.cancelAnimationFrame(layoutMeasureFrameRef.current);
      layoutMeasureFrameRef.current = 0;
    }
  }, [clearFullscreenTransitionTimer]);

  useEffect(() => {
    setTodoQueueItems(readTodoQueueItems(todoQueueStorageKey));
    setTodoQueueDraft("");
  }, [todoQueueStorageKey]);

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
      writeTodoQueueItems(todoQueueStorageKeyRef.current, nextItems);
      return nextItems;
    });
  }, [terminalWorkspace?.id]);

  const replaceTodoQueuePendingItems = useCallback((nextPendingItems) => {
    const normalizedPendingItems = nextPendingItems && typeof nextPendingItems === "object"
      ? nextPendingItems
      : {};
    todoQueuePendingItemsRef.current = normalizedPendingItems;
    setTodoQueuePendingItems(normalizedPendingItems);
  }, []);

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
    const nextPendingItems = { ...todoQueuePendingItemsRef.current };
    delete nextPendingItems[safeItemId];
    replaceTodoQueuePendingItems(nextPendingItems);
  }, [replaceTodoQueuePendingItems, terminalWorkspace?.id]);

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
    const timeoutMs = phase === "queued" ? 0 : TODO_QUEUE_CONSUME_TIMEOUT_MS;
    const pendingItem = {
      cancellable: phase === "queued",
      item: fields.item || null,
      itemId: safeItemId,
      paneId: String(fields.paneId || ""),
      phase,
      startedAtMs,
      state: phase,
      targetRole: String(fields.targetRole || ""),
      targetTerminalIndex: fields.targetTerminalIndex ?? "",
      timeoutAtMs: timeoutMs ? startedAtMs + timeoutMs : 0,
      timeoutMs,
      workspaceId: String(fields.workspaceId || terminalWorkspace?.id || ""),
    };
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
        todoQueuePendingTimersRef.current.delete(safeItemId);
        const nextPendingItems = { ...todoQueuePendingItemsRef.current };
        delete nextPendingItems[safeItemId];
        replaceTodoQueuePendingItems(nextPendingItems);
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
    replaceTodoQueuePendingItems({
      ...todoQueuePendingItemsRef.current,
      [safeItemId]: pendingItem,
    });
  }, [replaceTodoQueuePendingItems, terminalWorkspace?.id]);

  useEffect(() => () => {
    todoQueuePendingTimersRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    todoQueuePendingTimersRef.current.clear();
    todoQueuePendingItemsRef.current = {};
  }, []);

  useEffect(() => {
    todoQueuePendingTimersRef.current.forEach((timeoutId) => {
      window.clearTimeout(timeoutId);
    });
    todoQueuePendingTimersRef.current.clear();
    replaceTodoQueuePendingItems({});
  }, [replaceTodoQueuePendingItems, todoQueueStorageKey]);

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

    logBigViewSyncDiagnosticEvent("tui.image.drop_start", {
      hasImage: Boolean(image),
      item: getTodoQueueItemLogSummary([currentItem])[0] || null,
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
        throw createTodoQueueBusyError(target.reason || "terminal_unavailable", target.message);
      }

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
    const attachmentSource = source === "tui-todo-auto-queue" ? "tui_todo_auto_queue" : "tui_todo_drop";
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
          && targetThread?.id,
      );
      if (shouldAutoSubmit && !shouldConfirmAutoSubmit) {
        logBigViewSyncDiagnosticEvent("tui.text.drop_submit_blocked", {
          hasSubmitSequence: Boolean(terminalSubmitSequence),
          hasTargetThread: Boolean(targetThread?.id),
          paneId,
          reason: !terminalSubmitSequence
            ? "missing_submit_sequence"
            : "missing_thread",
          source,
          surface: "tui_terminal_grid",
          targetRole,
          targetTerminalIndex: targetLogIndex,
          terminalText: getBigViewTextDiagnosticFields(terminalText),
          workspaceId,
        });
        throw new Error("Unable to confirm this todo submission for the selected terminal.");
      }
      if (syncKey) {
        setWorkspaceThreadComposerDraft(syncKey, terminalText);
      }
      logBigViewSyncDiagnosticEvent("tui.image.drop_prepared", {
        attachmentQueued: Boolean(queuedAttachment && syncKey),
        hasImageAttachmentBlock: false,
        hasQueuedImage: Boolean(queuedAttachment),
        paneId,
        shouldAutoSubmit,
        sharedDraftSynced: Boolean(syncKey),
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
        const writeResult = await invoke("terminal_write", {
          data: terminalText,
          instanceId: targetBinding?.instanceId,
          paneId,
          threadId: targetThread?.id || "",
        });
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
        const promptId = createThreadProjectionToken("todo-drop-prompt");
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
          await invoke("terminal_write", {
            data: syncData,
            instanceId: targetBinding?.instanceId,
            paneId,
            threadId: targetThread.id,
          });
        }
        const syncWriteDurationMs = Math.round(performance.now() - syncWriteStartedAt);
        logBigViewSyncDiagnosticEvent("tui.text.drop_sync_done", {
          agentId: targetRole,
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
        const submittedWaiter = await createTerminalPromptSubmittedWaiter({
          agentId: targetRole,
          expectedPrompt: terminalText,
          instanceId: targetBinding?.instanceId,
          paneId,
          promptId,
          threadId: targetThread.id,
          workspaceId,
        });
        const acceptedWaiter = createWorkspaceThreadPromptAcceptedWaiter({
          agentId: targetRole,
          expectedPrompt: terminalText,
          promptId,
          threadId: targetThread.id,
          timeoutMs: TODO_QUEUE_CONSUME_TIMEOUT_MS,
          workspaceId,
        });
        try {
          const submittedAt = new Date().toISOString();
          const promptEventSource = source === "tui-todo-auto-queue"
            ? "todo-auto-queue"
            : "terminal-view-drop";
          logBigViewSyncDiagnosticEvent("tui.text.drop_enter_write", {
            agentId: targetRole,
            paneId,
            promptId,
            source,
            submitSequenceLength: terminalSubmitSequence.length,
            syncKey,
            surface: "tui_terminal_grid",
            targetTerminalIndex: targetLogIndex,
            terminalText: getBigViewTextDiagnosticFields(terminalText),
            threadId: targetThread.id,
            workspaceId,
          });
          const writeResult = await invoke("terminal_write", {
            data: terminalSubmitSequence,
            instanceId: targetBinding?.instanceId,
            paneId,
            promptEventId: promptId,
            promptEventSource,
            promptEventSubmittedAt: submittedAt,
            promptEventText: terminalText,
            threadId: targetThread.id,
          });
          requestDropSubmitSnapshot("tui.text.drop_after_enter_write_40ms", 40, {
            submitSequenceLength: terminalSubmitSequence.length,
          });
          requestDropSubmitSnapshot("tui.text.drop_after_enter_write", 160, {
            submitSequenceLength: terminalSubmitSequence.length,
          });
          requestDropSubmitSnapshot("tui.text.drop_after_enter_write_500ms", 500, {
            submitSequenceLength: terminalSubmitSequence.length,
          });
          requestDropSubmitSnapshot("tui.text.drop_after_enter_write_1200ms", 1200, {
            submitSequenceLength: terminalSubmitSequence.length,
          });
          await submittedWaiter.promise;
          logBigViewSyncDiagnosticEvent("tui.text.drop_submit_observed", {
            agentId: targetRole,
            paneId,
            promptId,
            source,
            syncKey,
            surface: "tui_terminal_grid",
            targetTerminalIndex: targetLogIndex,
            threadId: targetThread.id,
            workspaceId,
          });
          const acceptedDetail = await waitForWorkspaceThreadPromptAcceptedWithEnterRetries({
            acceptedWaiter,
            agentId: targetRole,
            binding: {
              instanceId: targetBinding?.instanceId,
              paneId,
              terminalIndex: target.targetTerminalIndex,
            },
            expectedPrompt: terminalText,
            getDraftValue: () => (
              syncKey
                ? String(getWorkspaceThreadComposerDraftStore().get(syncKey) || "")
                : terminalText
            ),
            isGenericTerminal: false,
            logPrefix: source === "tui-todo-auto-queue" ? "frontend.todo_auto_queue" : "frontend.todo_drop",
            promptId,
            retryDelaysMs: TODO_DROP_PROMPT_ACCEPT_RETRY_DELAYS_MS,
            submitSequence: terminalSubmitSequence,
            threadId: targetThread.id,
            workspaceId,
          });
          logBigViewSyncDiagnosticEvent("tui.text.drop_submit_accepted", {
            acceptedMatchedBy: acceptedDetail?.matchedBy || "",
            agentId: targetRole,
            paneId,
            promptId,
            sessionIdPresent: Boolean(acceptedDetail?.sessionId),
            source,
            syncKey,
            surface: "tui_terminal_grid",
            targetTerminalIndex: targetLogIndex,
            threadId: targetThread.id,
            workspaceId,
          });
          dropResult = {
            acceptedDetail,
            confirmedSubmit: true,
            promptId,
            syncKey,
            targetBinding,
            targetThread,
            terminalText,
            threadMessageText,
            writeResult,
          };
        } catch (submitError) {
          submittedWaiter.cancel();
          acceptedWaiter.cancel();
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
          throw submitError;
        }
      }
    }

    const writeResult = dropResult?.writeResult || null;
    const resultThreadMessageText = String(dropResult?.threadMessageText || "");
    const lifecycleSource = source === "tui-todo-auto-queue" ? "tui-todo-auto-queue" : "tui-todo-drop";
    const shouldDispatchThreadMessage = Boolean(
      dropResult?.confirmedSubmit
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
      onThreadTerminalLifecycle?.({
        agentId: targetRole,
        instanceId: targetBinding?.instanceId || "",
        messageSource: lifecycleSource,
        paneId,
        repoPath: terminalWorkspaceWorkingDirectory || defaultWorkingDirectory || "",
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
    } else if (shouldAutoSubmit && !image) {
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
    if (syncKey && shouldAutoSubmit) {
      setWorkspaceThreadComposerDraft(syncKey, "");
    }
    logBigViewSyncDiagnosticEvent("tui.image.drop_write_done", {
      imageOnlyQueued: Boolean(dropResult?.imageOnly || writeResult?.imageOnly),
      hadQueueItem: Boolean(currentItem.itemId || currentItem.id),
      hasImage: Boolean(image),
      paneId,
      shouldAutoSubmit,
      sharedDraftCleared: Boolean(syncKey && shouldAutoSubmit),
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

    return dropResult;
  }, [
    defaultWorkingDirectory,
    getTodoQueueTerminalSendTarget,
    onThreadTerminalLifecycle,
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
    clearTodoQueueItemPending(itemId, "removed");
    updateTodoQueueItems((currentItems) => (
      currentItems.filter((item) => item.id !== itemId)
    ));
  }, [clearTodoQueueItemPending, updateTodoQueueItems]);

  const queueTodoQueueItem = useCallback((itemId) => {
    const safeItemId = String(itemId || "").trim();
    if (!safeItemId) {
      return;
    }

    const item = todoQueueItems.find((candidate) => candidate.id === safeItemId);
    const pendingItem = todoQueuePendingItemsRef.current[safeItemId] || null;
    if (!item || (pendingItem && getTodoQueuePendingPhase(pendingItem) === "sending")) {
      return;
    }

    setTodoDropError("");
    setTodoQueueItemPending(safeItemId, {
      item: getTodoQueueItemLogSummary([item])[0] || null,
      phase: "queued",
      source: "tui-todo-auto-queue",
      workspaceId: item.workspaceId || terminalWorkspace?.id || "",
    });
    setTodoQueueDispatchRevision((revision) => revision + 1);
  }, [setTodoQueueItemPending, terminalWorkspace?.id, todoQueueItems]);

  const cancelQueuedTodoQueueItem = useCallback((itemId) => {
    const safeItemId = String(itemId || "").trim();
    const pendingItem = safeItemId ? todoQueuePendingItemsRef.current[safeItemId] || null : null;
    if (!pendingItem || getTodoQueuePendingPhase(pendingItem) !== "queued") {
      return;
    }

    clearTodoQueueItemPending(safeItemId, "cancelled", {
      source: "tui-todo-auto-queue",
    });
    setTodoQueueDispatchRevision((revision) => revision + 1);
  }, [clearTodoQueueItemPending]);

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
      return;
    }

    const queuedItem = todoQueueItems.find((item) => {
      const pendingItem = todoQueuePendingItemsRef.current[item.id] || null;
      return pendingItem && getTodoQueuePendingPhase(pendingItem) === "queued";
    });
    if (!queuedItem) {
      return;
    }

    let target = null;
    for (const terminalIndex of logicalTerminalIndexes) {
      const candidate = getTodoQueueTerminalSendTarget(terminalIndex, queuedItem, {
        allowGeneric: false,
        requireAvailable: true,
        reservationItemId: queuedItem.id,
      });
      if (candidate.available) {
        target = candidate;
        break;
      }
    }
    if (!target) {
      return;
    }

    const source = "tui-todo-auto-queue";
    const targetTerminalIndex = target.targetTerminalIndex;
    todoQueueDispatchingRef.current = true;
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
        setTodoDropError("");
        clearTodoQueueItemPending(queuedItem.id, "consumed", {
          promptId: dropResult?.promptId || "",
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
          setTodoQueueItemPending(queuedItem.id, {
            item: getTodoQueueItemLogSummary([queuedItem])[0] || null,
            phase: "queued",
            reason: error?.todoQueueBusyReason || "",
            source,
            workspaceId: queuedItem.workspaceId || terminalWorkspace?.id || "",
          });
          return;
        }

        clearTodoQueueItemPending(queuedItem.id, "error", {
          message: error?.message || String(error || ""),
          source,
          targetRole: target.targetRole,
          targetTerminalIndex,
        });
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
    logicalTerminalIndexes,
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
    const image = getTodoQueueItemImage(event?.item);
    const note = getTodoQueueItemNote(event?.item);
    const sourceRect = event?.sourceRect;

    if (
      (!text && !image && !note)
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
      rects: terminalLayoutRectsRef.current,
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
      ...(image ? { image } : {}),
      ...(note ? { note } : {}),
      width: dragWidth,
      workspaceId: event.workspaceId || terminalWorkspace.id,
      x: Number(event.clientX || 0) - offsetX,
      y: Number(event.clientY || 0) - offsetY,
    });
  }, [
    fullscreenActive,
    fullscreenTerminalIndex,
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

  const handleBeginTerminalDrag = useCallback((event) => {
    if (
      fullscreenActive
      || logicalTerminalIndexes.length <= 1
      || !terminalWorkspace?.id
      || !event?.surfaceRect
      || todoDragActive
    ) {
      return;
    }

    measureTerminalLayout();

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
    displayTerminalRows,
    fullscreenActive,
    logicalTerminalIndexes.length,
    measureTerminalLayout,
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
      const containerRect = terminalPanelsRef.current?.getBoundingClientRect?.();
      if (!containerRect) {
        return null;
      }

      return getTodoDropTargetFromPoint({
        clientX,
        clientY,
        containerRect,
        fullscreenTerminalIndex: fullscreenActive ? fullscreenTerminalIndex : null,
        rects: terminalLayoutRectsRef.current,
        terminalIndexes: logicalTerminalIndexes,
      });
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
        const source = "tui-todo-drop";
        const target = getTodoQueueTerminalSendTarget(targetTerminalIndex, currentDrag, {
          allowGeneric: true,
          requireAvailable: false,
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
          requireAvailable: false,
          reservationItemId,
          source,
          targetTerminalIndex,
        })
          .then((dropResult) => {
            setTodoDropError("");
            if (currentDrag.itemId) {
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
            if (currentDrag.itemId) {
              clearTodoQueueItemPending(currentDrag.itemId, "error", {
                message: error?.message || String(error || ""),
                source,
                targetRole,
                targetTerminalIndex: targetTerminalIndex ?? "",
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
    fullscreenActive,
    fullscreenTerminalIndex,
    getTerminalImageInputSupport,
    getTerminalRole,
    getTerminalPaneId,
    getTerminalThread,
    getTodoQueueTerminalSendTarget,
    logicalTerminalIndexes,
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

      const containerRect = terminalPanelsRef.current?.getBoundingClientRect?.();
      if (!containerRect) {
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
      commitDrag();
    };

    const handlePointerCancel = (event) => {
      const currentDrag = terminalDragStateRef.current;
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
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [
    reorderWorkspaceTerminalDisplayLayout,
    terminalDragActive,
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

  const getTerminalSlotStyle = useCallback((terminalIndex) => {
    const draggingThisTerminal = terminalDragState?.terminalIndex === terminalIndex;
    const fullscreenThisTerminal = fullscreenActive && fullscreenTerminalIndex === terminalIndex;

    if (draggingThisTerminal) {
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
    terminalLayoutRects,
    terminalPanelRect,
  ]);

  const todoQueueVisible = Boolean(
    hasVisibleWorkspaceTerminalPanes
    && terminalWorkspaceMainWidth >= TODO_QUEUE_VISIBLE_MIN_WIDTH,
  );
  const todoDragOverDropTarget = Boolean(
    todoDragActive && Number.isInteger(todoDragState?.targetTerminalIndex),
  );
  const todoDragImage = getTodoQueueItemImage(todoDragState);
  const todoDragNote = getTodoQueueItemNote(todoDragState);
  const todoDragHasPreview = Boolean(todoDragImage || todoDragNote);
  const terminalWorkspaceContent = hasVisibleWorkspaceTerminalPanes ? (
    <WorkspaceTerminalPanels
      data-terminal-dragging={terminalDragActive ? "true" : "false"}
      data-terminal-fullscreen={fullscreenActive ? "true" : "false"}
      data-terminal-fullscreen-state={fullscreenState}
      data-todo-dragging={todoDragOverDropTarget ? "true" : "false"}
      ref={terminalPanelsRef}
      style={fullscreenMotionStyle}
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
                          terminalDragState?.terminalIndex === terminalIndex ? "true" : undefined
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
      <TerminalSurfaceLayer aria-hidden={false}>
        {logicalTerminalIndexes.map((terminalIndex) => {
          const draggingThisTerminal = terminalDragState?.terminalIndex === terminalIndex;
          const fullscreenThisTerminal = fullscreenActive && terminalIndex === fullscreenTerminalIndex;
          const hasMeasuredRect = Boolean(terminalLayoutRects[terminalIndex])
            || draggingThisTerminal
            || fullscreenThisTerminal;

          return (
            <TerminalSurfaceSlot
              data-terminal-dragging={draggingThisTerminal ? "true" : "false"}
              data-terminal-fullscreen={fullscreenThisTerminal ? "true" : "false"}
              data-terminal-hidden={hasMeasuredRect ? "false" : "true"}
              key={`${terminalWorkspace.id}-${terminalIndex}`}
              style={getTerminalSlotStyle(terminalIndex)}
            >
              <WorkspaceTerminal
                key={`${terminalWorkspace.id}-${terminalIndex}-${getTerminalRole(terminalIndex)}-${terminalWorkspaceWorkingDirectory || ""}`}
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
                onThreadTerminalLifecycle={onThreadTerminalLifecycle}
                onToggleFullscreenTerminal={handleToggleFullscreenTerminal}
                prewarmShell={shouldPrewarmWorkspaceTerminals}
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
                workspaceThreads={workspaceThreads}
                workspaces={workspaces}
                selectedWorkspaceThreadId={selectedWorkspaceThreadId}
              />
            </TerminalSurfaceSlot>
          );
        })}
      </TerminalSurfaceLayer>
    </WorkspaceTerminalPanels>
  ) : !hasWorkspaceTerminals ? (
    <WorkspaceTerminal
      key={`${terminalWorkspace?.id || "empty"}-${logicalTerminalIndexes[0] || 0}-${getTerminalRole(logicalTerminalIndexes[0] || 0)}-${terminalWorkspaceWorkingDirectory || ""}`}
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
      onThreadTerminalLifecycle={onThreadTerminalLifecycle}
      onToggleFullscreenTerminal={handleToggleFullscreenTerminal}
      prewarmShell={terminalWorkspace ? shouldPrewarmWorkspaceTerminals : false}
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
      ) : (
          <TerminalWorkspaceMain ref={terminalWorkspaceMainRef}>
            {hasVisibleWorkspaceTerminalPanes ? (
              <ResizePanelGroup
                id={`workspace-terminal-main-${terminalWorkspace.id}`}
                orientation="horizontal"
              >
                <ResizePanel
                  defaultSize={todoQueueVisible ? "76%" : "100%"}
                  id={`workspace-terminal-main-grid-${terminalWorkspace.id}`}
                  minSize={todoQueueVisible ? "54%" : "100%"}
                >
                  {terminalWorkspaceContent}
                </ResizePanel>
                {todoQueueVisible && (
                  <>
                    <ResizeHandle data-direction="horizontal" />
                    <ResizePanel
                      defaultSize="24%"
                      id={`workspace-terminal-todo-queue-${terminalWorkspace.id}`}
                      maxSize="36%"
                      minSize="18%"
                    >
                      <TodoQueuePanel
                        activeDragItemId={todoDragState?.itemId || ""}
                        defaultWorkingDirectory={defaultWorkingDirectory}
                        draft={todoQueueDraft}
                        dropError={todoDropError}
                        items={todoQueueItems}
                        onBeginWorkspaceFileDrag={handleBeginWorkspaceFileDrag}
                        onBeginTodoDrag={handleBeginTodoDrag}
                        onCancelQueuedItem={cancelQueuedTodoQueueItem}
                        onDraftChange={setTodoQueueDraft}
                        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
                        onQueueItem={queueTodoQueueItem}
                        onRemoveItem={removeTodoQueueItem}
                        onReorderItem={reorderTodoQueueItem}
                        onSubmitDraft={submitTodoQueueDraft}
                        onUpdateItem={updateTodoQueueItemText}
                        pendingItems={todoQueuePendingItems}
                        rootDirectory={terminalWorkspaceWorkingDirectory || defaultWorkingDirectory}
                        workspace={terminalWorkspace}
                        workspaceError={workspaceError}
                        workspaceId={terminalWorkspace.id}
                      />
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

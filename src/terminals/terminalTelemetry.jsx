import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

import { TerminalDevMetric, TerminalDevMetricsBar } from "../app/appStyles";

const TERMINAL_METRICS_NOTIFY_MS = 250;
const TERMINAL_TELEMETRY_FLUSH_MS = 60;
const TERMINAL_TELEMETRY_MAX_BATCH = 80;
const TERMINAL_TELEMETRY_LOGGING_ENABLED = false;
const TERMINAL_RESIZE_TELEMETRY_LOGGING_ENABLED = false;

const pendingTerminalTelemetry = [];
const terminalMetricsSubscribers = new Set();
const terminalMetricsState = {
  terminalCount: 0,
  ipcEvents: 0,
  ipcBytes: 0,
  outputLagMs: 0,
  startupMs: 0,
  gridMs: 0,
  webglMs: 0,
  resizeBatches: 0,
  resizePanes: 0,
  resizeLagMs: 0,
};
let terminalMetricsNotifyTimer = 0;
let terminalTelemetryFlushTimer = 0;
let nextWorkspaceOpenTelemetryId = 1;
let currentWorkspaceOpenTelemetry = {
  id: 0,
  source: "",
  startedAt: 0,
  workspaceId: "",
};

export function startWorkspaceOpenTelemetry({
  source,
  workspaceId,
  fields = {},
}) {
  if (!workspaceId) {
    return currentWorkspaceOpenTelemetry;
  }

  const openId = nextWorkspaceOpenTelemetryId;
  nextWorkspaceOpenTelemetryId = nextWorkspaceOpenTelemetryId >= Number.MAX_SAFE_INTEGER
    ? 1
    : nextWorkspaceOpenTelemetryId + 1;

  currentWorkspaceOpenTelemetry = {
    id: openId,
    source,
    startedAt: performance.now(),
    workspaceId,
  };

  writeTerminalTelemetry({
    paneId: workspaceId,
    phase: "frontend.workspace.open_start",
    fields: {
      source,
      workspaceId,
      workspaceOpenId: openId,
      ...fields,
    },
  });

  return currentWorkspaceOpenTelemetry;
}

export function getWorkspaceOpenTelemetryFields(workspaceId) {
  if (
    !workspaceId
    || currentWorkspaceOpenTelemetry.workspaceId !== workspaceId
    || !currentWorkspaceOpenTelemetry.startedAt
  ) {
    return {};
  }

  return {
    workspaceId,
    workspaceOpenElapsedMs: performance.now() - currentWorkspaceOpenTelemetry.startedAt,
    workspaceOpenId: currentWorkspaceOpenTelemetry.id,
    workspaceOpenSource: currentWorkspaceOpenTelemetry.source,
  };
}

function getTerminalMetricsSnapshot() {
  return { ...terminalMetricsState };
}

function emitTerminalMetricsSoon() {
  if (terminalMetricsNotifyTimer) {
    return;
  }

  terminalMetricsNotifyTimer = window.setTimeout(() => {
    terminalMetricsNotifyTimer = 0;
    const snapshot = getTerminalMetricsSnapshot();
    terminalMetricsSubscribers.forEach((subscriber) => subscriber(snapshot));
  }, TERMINAL_METRICS_NOTIFY_MS);
}

export function patchTerminalMetrics(patch) {
  Object.assign(terminalMetricsState, patch);
  emitTerminalMetricsSoon();
}

export function addTerminalMetrics(delta) {
  Object.entries(delta).forEach(([key, value]) => {
    terminalMetricsState[key] = (terminalMetricsState[key] || 0) + value;
  });
  emitTerminalMetricsSoon();
}

function isTerminalResizeTelemetryPhase(phase) {
  return String(phase || "").toLowerCase().includes("resize");
}

export function isTerminalTelemetryPhaseEnabled(phase) {
  return TERMINAL_TELEMETRY_LOGGING_ENABLED
    || (TERMINAL_RESIZE_TELEMETRY_LOGGING_ENABLED && isTerminalResizeTelemetryPhase(phase));
}

function subscribeTerminalMetrics(subscriber) {
  terminalMetricsSubscribers.add(subscriber);
  subscriber(getTerminalMetricsSnapshot());

  return () => {
    terminalMetricsSubscribers.delete(subscriber);
  };
}

export function useTerminalDevMetrics() {
  const [metrics, setMetrics] = useState(getTerminalMetricsSnapshot);

  useEffect(() => subscribeTerminalMetrics(setMetrics), []);

  return metrics;
}

export function writeTerminalTelemetry({
  paneId,
  instanceId,
  phase,
  message = "",
  cols,
  rows,
  elapsedMs,
  fields = {},
}) {
  if (!isTerminalTelemetryPhaseEnabled(phase)) {
    return;
  }

  pendingTerminalTelemetry.push({
    tsMs: Date.now(),
    paneId,
    instanceId,
    phase,
    message,
    cols,
    rows,
    elapsedMs,
    fields,
  });

  if (pendingTerminalTelemetry.length >= TERMINAL_TELEMETRY_MAX_BATCH) {
    if (terminalTelemetryFlushTimer) {
      window.clearTimeout(terminalTelemetryFlushTimer);
      terminalTelemetryFlushTimer = 0;
    }
    flushTerminalTelemetry();
    return;
  }

  if (!terminalTelemetryFlushTimer) {
    terminalTelemetryFlushTimer = window.setTimeout(
      flushTerminalTelemetry,
      TERMINAL_TELEMETRY_FLUSH_MS,
    );
  }
}

function flushTerminalTelemetry() {
  terminalTelemetryFlushTimer = 0;
  const requests = pendingTerminalTelemetry.splice(0, TERMINAL_TELEMETRY_MAX_BATCH);

  if (!requests.length) {
    return;
  }

  invoke("terminal_telemetry_log_many", { requests }).catch(() => {});

  if (pendingTerminalTelemetry.length && !terminalTelemetryFlushTimer) {
    terminalTelemetryFlushTimer = window.setTimeout(
      flushTerminalTelemetry,
      TERMINAL_TELEMETRY_FLUSH_MS,
    );
  }
}

function formatMetricBytes(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  if (value < 1024) {
    return `${Math.round(value)} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMetricMs(value) {
  return `${Math.max(0, Math.round(Number(value) || 0))} ms`;
}

export function TerminalDevMetrics({ metrics }) {
  return (
    <TerminalDevMetricsBar aria-label="Terminal performance metrics">
      <TerminalDevMetric>ipc {metrics.ipcEvents} / {formatMetricBytes(metrics.ipcBytes)}</TerminalDevMetric>
      <TerminalDevMetric>out {formatMetricMs(metrics.outputLagMs)}</TerminalDevMetric>
      <TerminalDevMetric>open {formatMetricMs(metrics.startupMs)}</TerminalDevMetric>
      <TerminalDevMetric>grid {formatMetricMs(metrics.gridMs)}</TerminalDevMetric>
      <TerminalDevMetric>webgl {formatMetricMs(metrics.webglMs)}</TerminalDevMetric>
      <TerminalDevMetric>resize {formatMetricMs(metrics.resizeLagMs)} / {metrics.resizePanes}</TerminalDevMetric>
    </TerminalDevMetricsBar>
  );
}

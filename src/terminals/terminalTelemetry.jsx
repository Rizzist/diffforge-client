import { useEffect, useState } from "react";

import { TerminalDevMetric, TerminalDevMetricsBar } from "../app/appStyles";

const TERMINAL_METRICS_NOTIFY_MS = 250;

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

function getTerminalMetricsSnapshot() {
  return { ...terminalMetricsState };
}

function emitTerminalMetricsSoon() {
  if (!terminalMetricsSubscribers.size) {
    return;
  }

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

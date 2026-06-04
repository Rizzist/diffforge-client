import { invoke } from "@tauri-apps/api/core";

import {
  takeDiagnosticIpcBudget,
  withDiagnosticIpcDropCount,
} from "../diagnostics/diagnosticIpcBudget.js";

export const TERMINAL_DIAGNOSTIC_LOGGING_ENABLED = true;
export const TERMINAL_DIAGNOSTIC_FORCE_LOGGING_ENABLED = true;
export const THREAD_BRIDGE_DIAGNOSTIC_LOGGING_ENABLED = true;

const TERMINAL_DIAGNOSTIC_HEARTBEAT_MS = 100;
const TERMINAL_DIAGNOSTIC_MAIN_THREAD_GAP_MS = 120;
const TERMINAL_DIAGNOSTIC_DEFAULT_SAMPLE_MS = 1000;
const TERMINAL_DIAGNOSTIC_MAIN_THREAD_GAP_SAMPLE_MS = 2500;
const THREAD_BRIDGE_DIAGNOSTIC_DEFAULT_SAMPLE_MS = 1000;
const TERMINAL_DIAGNOSTIC_LOG_MAX_TEXT = 512;

let backendLoggingSynced = null;
let backendLoggingSyncInFlight = null;
let backendLoggingForceEnabled = false;
let heartbeatTimer = 0;
let heartbeatLastMs = 0;
const terminalDiagnosticSampleState = new Map();
const threadBridgeDiagnosticSampleState = new Map();

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function cleanDiagnosticText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, TERMINAL_DIAGNOSTIC_LOG_MAX_TEXT);
}

function getTerminalDiagnosticSampleMs(phase) {
  return phase === "frontend.main_thread_gap"
    ? TERMINAL_DIAGNOSTIC_MAIN_THREAD_GAP_SAMPLE_MS
    : TERMINAL_DIAGNOSTIC_DEFAULT_SAMPLE_MS;
}

function takeDiagnosticSample(sampleState, key, sampleMs, force = false) {
  if (force || !Number.isFinite(sampleMs) || sampleMs <= 0) {
    return { dropped: 0, skip: false };
  }

  const now = nowMs();
  const currentState = sampleState.get(key);
  if (currentState && now - currentState.lastLoggedAtMs < sampleMs) {
    currentState.dropped += 1;
    return { dropped: 0, skip: true };
  }

  const dropped = currentState?.dropped || 0;
  sampleState.set(key, {
    dropped: 0,
    lastLoggedAtMs: now,
  });
  return { dropped, skip: false };
}

function withSampledDropCount(fields, dropped) {
  if (!dropped) {
    return fields;
  }
  return {
    ...fields,
    sampledDropCount: dropped,
  };
}

export function isTerminalDiagnosticLoggingEnabled() {
  return TERMINAL_DIAGNOSTIC_LOGGING_ENABLED;
}

export function syncTerminalDiagnosticLogging(forceEnabled = false) {
  if (forceEnabled && TERMINAL_DIAGNOSTIC_FORCE_LOGGING_ENABLED) {
    backendLoggingForceEnabled = true;
  }

  const enabled = backendLoggingForceEnabled || isTerminalDiagnosticLoggingEnabled();

  if (backendLoggingSynced === enabled) {
    return backendLoggingSyncInFlight || Promise.resolve(enabled);
  }

  backendLoggingSyncInFlight = invoke("terminal_set_diagnostic_logging", { enabled })
    .then((resolvedEnabled) => {
      backendLoggingSynced = Boolean(resolvedEnabled);
      return backendLoggingSynced;
    })
    .catch(() => {
      backendLoggingSynced = null;
      return false;
    })
    .finally(() => {
      backendLoggingSyncInFlight = null;
    });

  return backendLoggingSyncInFlight;
}

export function logTerminalDiagnosticEvent(phase, fields = {}, options = {}) {
  const force = Boolean(options.force) && TERMINAL_DIAGNOSTIC_FORCE_LOGGING_ENABLED;
  if (!force && !isTerminalDiagnosticLoggingEnabled()) {
    return;
  }

  const cleanPhase = cleanDiagnosticText(phase);

  const elapsedMs = Number(fields.elapsedMs);
  if (
    Number.isFinite(options.minElapsedMs)
    && (!Number.isFinite(elapsedMs) || elapsedMs < options.minElapsedMs)
  ) {
    return;
  }

  const sample = takeDiagnosticSample(
    terminalDiagnosticSampleState,
    cleanPhase,
    getTerminalDiagnosticSampleMs(cleanPhase),
    force,
  );
  if (sample.skip) {
    return;
  }
  const budget = takeDiagnosticIpcBudget({ force });
  if (budget.skip) {
    return;
  }
  const sampledFields = withDiagnosticIpcDropCount(
    withSampledDropCount(fields, sample.dropped),
    budget.dropped,
  );

  const writeDiagnostic = () => invoke("terminal_diagnostic_log", {
    phase: cleanPhase,
    fields: {
      source: "frontend",
      ...sampledFields,
    },
  }).catch(() => {});

  syncTerminalDiagnosticLogging(force)
    .then((enabled) => {
      if (enabled) {
        writeDiagnostic();
      }
    })
    .catch(() => {});
}

export function logThreadBridgeDiagnosticEvent(phase, fields = {}) {
  if (!THREAD_BRIDGE_DIAGNOSTIC_LOGGING_ENABLED) {
    return;
  }

  const cleanPhase = cleanDiagnosticText(phase);
  const sample = takeDiagnosticSample(
    threadBridgeDiagnosticSampleState,
    cleanPhase,
    THREAD_BRIDGE_DIAGNOSTIC_DEFAULT_SAMPLE_MS,
  );
  if (sample.skip) {
    return;
  }
  const budget = takeDiagnosticIpcBudget();
  if (budget.skip) {
    return;
  }
  const sampledFields = withDiagnosticIpcDropCount(
    withSampledDropCount(fields, sample.dropped),
    budget.dropped,
  );

  invoke("thread_bridge_diagnostic_log", {
    phase: cleanPhase,
    fields: {
      source: "frontend",
      ...sampledFields,
    },
  }).catch(() => {});
}

export function logTerminalDiagnosticDuration(phase, startedAtMs, fields = {}, options = {}) {
  logTerminalDiagnosticEvent(
    phase,
    {
      ...fields,
      elapsedMs: Math.max(0, nowMs() - startedAtMs),
    },
    options,
  );
}

export function getTerminalDiagnosticEnvironment() {
  let webgl2 = false;

  try {
    const canvas = document.createElement("canvas");
    webgl2 = Boolean(canvas.getContext("webgl2"));
  } catch {
    webgl2 = false;
  }

  return {
    devicePixelRatio: window.devicePixelRatio || 1,
    hardwareConcurrency: navigator.hardwareConcurrency || 0,
    platform: cleanDiagnosticText(navigator.platform || ""),
    userAgent: cleanDiagnosticText(navigator.userAgent || ""),
    webgl2,
    webgpu: Boolean(navigator.gpu),
  };
}

export function startTerminalDiagnosticHeartbeat() {
  if (!isTerminalDiagnosticLoggingEnabled() || heartbeatTimer) {
    return;
  }

  syncTerminalDiagnosticLogging();
  heartbeatLastMs = nowMs();
  heartbeatTimer = window.setInterval(() => {
    const nextMs = nowMs();
    const gapMs = nextMs - heartbeatLastMs;
    heartbeatLastMs = nextMs;

    if (gapMs >= TERMINAL_DIAGNOSTIC_MAIN_THREAD_GAP_MS) {
      logTerminalDiagnosticEvent("frontend.main_thread_gap", {
        elapsedMs: gapMs,
        expectedMs: TERMINAL_DIAGNOSTIC_HEARTBEAT_MS,
      });
    }
  }, TERMINAL_DIAGNOSTIC_HEARTBEAT_MS);
}

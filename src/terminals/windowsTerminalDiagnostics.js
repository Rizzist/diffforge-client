import { invoke } from "@tauri-apps/api/core";

import {
  takeDiagnosticIpcBudget,
  withDiagnosticIpcDropCount,
} from "../diagnostics/diagnosticIpcBudget.js";

export const windowsterminaldiagnostics = false;

const WINDOWS_TERMINAL_DIAGNOSTIC_DEFAULT_SAMPLE_MS = 1000;
const WINDOWS_TERMINAL_DIAGNOSTIC_LOG_MAX_TEXT = 512;

let backendLoggingSynced = null;
let backendLoggingSyncInFlight = null;
const windowsTerminalDiagnosticSampleState = new Map();

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function cleanDiagnosticText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, WINDOWS_TERMINAL_DIAGNOSTIC_LOG_MAX_TEXT);
}

function takeWindowsTerminalDiagnosticSample(key, force = false) {
  if (force) {
    return { dropped: 0, skip: false };
  }

  const now = nowMs();
  const currentState = windowsTerminalDiagnosticSampleState.get(key);
  if (
    currentState
    && now - currentState.lastLoggedAtMs < WINDOWS_TERMINAL_DIAGNOSTIC_DEFAULT_SAMPLE_MS
  ) {
    currentState.dropped += 1;
    return { dropped: 0, skip: true };
  }

  const dropped = currentState?.dropped || 0;
  windowsTerminalDiagnosticSampleState.set(key, {
    dropped: 0,
    lastLoggedAtMs: now,
  });
  return { dropped, skip: false };
}

export function isWindowsTerminalDiagnosticLoggingEnabled() {
  return windowsterminaldiagnostics;
}

export function syncWindowsTerminalDiagnosticLogging() {
  const enabled = isWindowsTerminalDiagnosticLoggingEnabled();

  if (backendLoggingSynced === enabled) {
    return backendLoggingSyncInFlight || Promise.resolve(enabled);
  }

  backendLoggingSyncInFlight = invoke("windows_terminal_set_diagnostic_logging", { enabled })
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

export function logWindowsTerminalDiagnosticEvent(phase, fields = {}, options = {}) {
  if (!isWindowsTerminalDiagnosticLoggingEnabled()) {
    return;
  }

  const cleanPhase = cleanDiagnosticText(phase);
  const elapsedMs = Number(fields.elapsed_ms);
  if (
    Number.isFinite(options.minElapsedMs)
    && (!Number.isFinite(elapsedMs) || elapsedMs < options.minElapsedMs)
  ) {
    return;
  }

  const sample = takeWindowsTerminalDiagnosticSample(cleanPhase, Boolean(options.force));
  if (sample.skip) {
    return;
  }
  const budget = takeDiagnosticIpcBudget({ force: Boolean(options.force) });
  if (budget.skip) {
    return;
  }
  const sampledFields = sample.dropped
    ? { ...fields, sampledDropCount: sample.dropped }
    : fields;
  const budgetedFields = withDiagnosticIpcDropCount(sampledFields, budget.dropped);

  syncWindowsTerminalDiagnosticLogging();

  invoke("windows_terminal_diagnostic_log", {
    phase: cleanPhase,
    fields: {
      source: "frontend",
      ...budgetedFields,
    },
  }).catch(() => {});
}

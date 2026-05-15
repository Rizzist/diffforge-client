import { invoke } from "@tauri-apps/api/core";

export const windowsterminaldiagnostics = false;

const WINDOWS_TERMINAL_DIAGNOSTIC_LOG_MAX_TEXT = 512;

let backendLoggingSynced = null;
let backendLoggingSyncInFlight = null;

function cleanDiagnosticText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, WINDOWS_TERMINAL_DIAGNOSTIC_LOG_MAX_TEXT);
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

  const elapsedMs = Number(fields.elapsedMs);
  if (
    Number.isFinite(options.minElapsedMs)
    && (!Number.isFinite(elapsedMs) || elapsedMs < options.minElapsedMs)
  ) {
    return;
  }

  syncWindowsTerminalDiagnosticLogging();

  invoke("windows_terminal_diagnostic_log", {
    phase: cleanDiagnosticText(phase),
    fields: {
      source: "frontend",
      ...fields,
    },
  }).catch(() => {});
}

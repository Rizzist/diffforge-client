import { invoke } from "@tauri-apps/api/core";

export const TERMINAL_DIAGNOSTIC_LOGGING_ENABLED = false;
export const TERMINAL_DIAGNOSTIC_FORCE_LOGGING_ENABLED = false;
export const THREAD_BRIDGE_DIAGNOSTIC_LOGGING_ENABLED = true;

const TERMINAL_DIAGNOSTIC_HEARTBEAT_MS = 100;
const TERMINAL_DIAGNOSTIC_MAIN_THREAD_GAP_MS = 120;
const TERMINAL_DIAGNOSTIC_LOG_MAX_TEXT = 512;

let backendLoggingSynced = null;
let backendLoggingSyncInFlight = null;
let backendLoggingForceEnabled = false;
let heartbeatTimer = 0;
let heartbeatLastMs = 0;

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

  const elapsedMs = Number(fields.elapsedMs);
  if (
    Number.isFinite(options.minElapsedMs)
    && (!Number.isFinite(elapsedMs) || elapsedMs < options.minElapsedMs)
  ) {
    return;
  }

  const writeDiagnostic = () => invoke("terminal_diagnostic_log", {
    phase: cleanDiagnosticText(phase),
    fields: {
      source: "frontend",
      ...fields,
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

  invoke("thread_bridge_diagnostic_log", {
    phase: cleanDiagnosticText(phase),
    fields: {
      source: "frontend",
      ...fields,
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

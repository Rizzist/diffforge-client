import { invoke } from "@tauri-apps/api/core";

import {
  takeDiagnosticIpcBudget,
  withDiagnosticIpcDropCount,
} from "../diagnostics/diagnosticIpcBudget.js";

const TERMINAL_STATUS_LOGGING_ENABLED = true;
const TERMINAL_STATUS_LOG_SAMPLE_MS = 1000;
const TERMINAL_STATUS_LOG_MAX_TEXT = 900;
const TERMINAL_STATUS_LOG_MAX_ARRAY = 60;
const TERMINAL_STATUS_LOG_MAX_OBJECT_KEYS = 120;
const terminalStatusLogSampleState = new Map();

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function cleanTerminalStatusLogText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, TERMINAL_STATUS_LOG_MAX_TEXT);
}

function sanitizeTerminalStatusLogValue(value, depth = 0) {
  if (value == null) {
    return value;
  }
  if (typeof value === "string") {
    return cleanTerminalStatusLogText(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (depth >= 5) {
    return cleanTerminalStatusLogText(value);
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, TERMINAL_STATUS_LOG_MAX_ARRAY)
      .map((entry) => sanitizeTerminalStatusLogValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const result = {};
    Object.entries(value)
      .slice(0, TERMINAL_STATUS_LOG_MAX_OBJECT_KEYS)
      .forEach(([key, entry]) => {
        result[cleanTerminalStatusLogText(key)] = sanitizeTerminalStatusLogValue(entry, depth + 1);
      });
    return result;
  }
  return cleanTerminalStatusLogText(value);
}

function takeTerminalStatusLogSample(phase) {
  const now = nowMs();
  const currentState = terminalStatusLogSampleState.get(phase);
  if (currentState && now - currentState.lastLoggedAtMs < TERMINAL_STATUS_LOG_SAMPLE_MS) {
    currentState.dropped += 1;
    return { dropped: 0, skip: true };
  }

  const dropped = currentState?.dropped || 0;
  terminalStatusLogSampleState.set(phase, {
    dropped: 0,
    lastLoggedAtMs: now,
  });
  return { dropped, skip: false };
}

export function logTerminalStatus(phase, fields = {}) {
  if (!TERMINAL_STATUS_LOGGING_ENABLED) {
    return;
  }

  const cleanPhase = cleanTerminalStatusLogText(phase);
  const sample = takeTerminalStatusLogSample(cleanPhase);
  if (sample.skip) {
    return;
  }
  const budget = takeDiagnosticIpcBudget();
  if (budget.skip) {
    return;
  }
  const sampledFields = sample.dropped
    ? { ...fields, sampledDropCount: sample.dropped }
    : fields;
  const budgetedFields = withDiagnosticIpcDropCount(sampledFields, budget.dropped);

  invoke("terminal_status_log", {
    phase: cleanPhase,
    fields: sanitizeTerminalStatusLogValue({
      source: "frontend",
      ...budgetedFields,
    }),
  }).catch(() => {});
}

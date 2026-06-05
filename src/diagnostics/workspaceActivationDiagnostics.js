import { invoke } from "@tauri-apps/api/core";

import {
  takeDiagnosticIpcBudget,
  withDiagnosticIpcDropCount,
} from "./diagnosticIpcBudget.js";

export const WORKSPACE_ACTIVATION_DIAGNOSTIC_LOGGING_ENABLED = true;

const WORKSPACE_ACTIVATION_DIAGNOSTIC_LOG_MAX_TEXT = 512;

export function getWorkspaceActivationDiagnosticNowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function cleanDiagnosticText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, WORKSPACE_ACTIVATION_DIAGNOSTIC_LOG_MAX_TEXT);
}

function cleanDiagnosticValue(value, depth = 0) {
  if (value === null || typeof value === "undefined") {
    return value;
  }

  if (typeof value === "string") {
    return cleanDiagnosticText(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    if (depth >= 3) {
      return `[array:${value.length}]`;
    }
    return value.slice(0, 40).map((item) => cleanDiagnosticValue(item, depth + 1));
  }

  if (typeof value === "object") {
    if (depth >= 3) {
      return "[object]";
    }
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 80)
        .map(([key, item]) => [
          cleanDiagnosticText(key),
          cleanDiagnosticValue(item, depth + 1),
        ]),
    );
  }

  return cleanDiagnosticText(value);
}

function cleanDiagnosticFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return {};
  }

  return cleanDiagnosticValue(fields);
}

export function logWorkspaceActivationDiagnosticEvent(phase, fields = {}, options = {}) {
  if (!WORKSPACE_ACTIVATION_DIAGNOSTIC_LOGGING_ENABLED) {
    return;
  }

  const budget = takeDiagnosticIpcBudget({ force: Boolean(options.force) });
  if (budget.skip) {
    return;
  }

  invoke("workspace_activation_diagnostic_log", {
    phase: cleanDiagnosticText(phase),
    fields: {
      source: "frontend",
      ...withDiagnosticIpcDropCount(cleanDiagnosticFields(fields), budget.dropped),
    },
  }).catch(() => {});
}

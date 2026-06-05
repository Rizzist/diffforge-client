import { invoke } from "@tauri-apps/api/core";

import {
  takeDiagnosticIpcBudget,
  withDiagnosticIpcDropCount,
} from "./diagnosticIpcBudget.js";

export const WORKSPACE_ACTIVATION_DIAGNOSTIC_LOGGING_ENABLED = false;

const WORKSPACE_ACTIVATION_DIAGNOSTIC_FLUSH_MS = 32;
const WORKSPACE_ACTIVATION_DIAGNOSTIC_MAX_QUEUED_EVENTS = 256;
const WORKSPACE_ACTIVATION_DIAGNOSTIC_LOG_MAX_TEXT = 512;

let pendingDiagnosticEvents = [];
let pendingDiagnosticFlushHandle = null;
let pendingDiagnosticDropCount = 0;

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

function getDiagnosticTimerApi() {
  if (typeof window !== "undefined" && window.setTimeout && window.clearTimeout) {
    return window;
  }
  return {
    clearTimeout,
    setTimeout,
  };
}

function scheduleWorkspaceActivationDiagnosticFlush() {
  if (pendingDiagnosticFlushHandle !== null) {
    return;
  }

  const timerApi = getDiagnosticTimerApi();
  pendingDiagnosticFlushHandle = timerApi.setTimeout(() => {
    pendingDiagnosticFlushHandle = null;
    flushWorkspaceActivationDiagnosticEvents();
  }, WORKSPACE_ACTIVATION_DIAGNOSTIC_FLUSH_MS);
}

function flushWorkspaceActivationDiagnosticEvents({ force = false } = {}) {
  if (pendingDiagnosticFlushHandle !== null) {
    const timerApi = getDiagnosticTimerApi();
    timerApi.clearTimeout(pendingDiagnosticFlushHandle);
    pendingDiagnosticFlushHandle = null;
  }

  if (!pendingDiagnosticEvents.length) {
    return;
  }

  const events = pendingDiagnosticEvents;
  pendingDiagnosticEvents = [];

  const budget = takeDiagnosticIpcBudget({
    force: force || events.some((event) => event.force),
  });
  if (budget.skip) {
    pendingDiagnosticDropCount += events.length;
    return;
  }

  const dropped = pendingDiagnosticDropCount + budget.dropped;
  pendingDiagnosticDropCount = 0;

  const batchedEvents = events.map(({ fields, phase }) => ({ fields, phase }));
  if (dropped && batchedEvents.length) {
    batchedEvents[0] = {
      ...batchedEvents[0],
      fields: withDiagnosticIpcDropCount(batchedEvents[0].fields, dropped),
    };
  }

  invoke("workspace_activation_diagnostic_log_many", {
    events: batchedEvents,
  }).catch(() => {});
}

export function logWorkspaceActivationDiagnosticEvent(phase, fields = {}, options = {}) {
  if (!WORKSPACE_ACTIVATION_DIAGNOSTIC_LOGGING_ENABLED) {
    return;
  }

  if (pendingDiagnosticEvents.length >= WORKSPACE_ACTIVATION_DIAGNOSTIC_MAX_QUEUED_EVENTS) {
    pendingDiagnosticDropCount += 1;
    return;
  }

  pendingDiagnosticEvents.push({
    force: Boolean(options.force),
    phase: cleanDiagnosticText(phase),
    fields: {
      source: "frontend",
      ...cleanDiagnosticFields(fields),
    },
  });

  if (options.force) {
    flushWorkspaceActivationDiagnosticEvents({ force: true });
    return;
  }

  scheduleWorkspaceActivationDiagnosticFlush();
}

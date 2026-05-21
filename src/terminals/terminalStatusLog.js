import { invoke } from "@tauri-apps/api/core";

const TERMINAL_STATUS_LOGGING_ENABLED = true;
const TERMINAL_STATUS_LOG_MAX_TEXT = 900;
const TERMINAL_STATUS_LOG_MAX_ARRAY = 60;
const TERMINAL_STATUS_LOG_MAX_OBJECT_KEYS = 120;

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

export function logTerminalStatus(phase, fields = {}) {
  if (!TERMINAL_STATUS_LOGGING_ENABLED) {
    return;
  }

  invoke("terminal_status_log", {
    phase: cleanTerminalStatusLogText(phase),
    fields: sanitizeTerminalStatusLogValue({
      source: "frontend",
      ...fields,
    }),
  }).catch(() => {});
}

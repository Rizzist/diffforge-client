import { invoke } from "@tauri-apps/api/core";

export const BIGVIEW_SYNC_DIAGNOSTIC_LOGGING_ENABLED = true;

const BIGVIEW_SYNC_DIAGNOSTIC_LOG_MAX_TEXT = 512;

function cleanDiagnosticText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, BIGVIEW_SYNC_DIAGNOSTIC_LOG_MAX_TEXT);
}

export function logBigViewSyncDiagnosticEvent(phase, fields = {}) {
  if (!BIGVIEW_SYNC_DIAGNOSTIC_LOGGING_ENABLED) {
    return;
  }

  invoke("bigview_sync_diagnostic_log", {
    phase: cleanDiagnosticText(phase),
    fields: {
      source: "frontend",
      ...fields,
    },
  }).catch(() => {});
}


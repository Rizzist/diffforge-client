import { invoke } from "@tauri-apps/api/core";

export const BIGVIEW_SYNC_DIAGNOSTIC_LOGGING_ENABLED = false;
export const FILE_DRAG_DIAGNOSTIC_LOGGING_ENABLED = false;

const BIGVIEW_SYNC_DIAGNOSTIC_LOG_MAX_TEXT = 512;

function cleanDiagnosticText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, BIGVIEW_SYNC_DIAGNOSTIC_LOG_MAX_TEXT);
}

function hashDiagnosticText(value) {
  const text = String(value ?? "");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function getBigViewTextDiagnosticFields(value, options = {}) {
  const text = String(value ?? "");
  const previewLength = Math.max(0, Math.min(240, Number(options.previewLength) || 120));
  const newlineCount = (text.match(/\n/g) || []).length;
  const carriageReturnCount = (text.match(/\r/g) || []).length;
  const sanitized = cleanDiagnosticText(text);

  return {
    carriageReturnCount,
    hasBracketedPasteEnd: text.includes("\x1b[201~"),
    hasBracketedPasteStart: text.includes("\x1b[200~"),
    hasCodexPastedContentMarker: /\[Pasted Content \d+ chars\]/i.test(text),
    hasCarriageReturn: carriageReturnCount > 0,
    hasNewline: newlineCount > 0,
    lineCount: text ? text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").length : 0,
    newlineCount,
    preview: sanitized.slice(0, previewLength),
    tailPreview: sanitized.length > previewLength ? sanitized.slice(-previewLength) : "",
    textHash: hashDiagnosticText(text),
    textLength: text.length,
    trimmedLength: text.trim().length,
  };
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

export function logFileDragDiagnosticEvent(phase, fields = {}) {
  if (!FILE_DRAG_DIAGNOSTIC_LOGGING_ENABLED) {
    return;
  }

  invoke("bigview_sync_diagnostic_log", {
    phase: cleanDiagnosticText(`filedrag.${phase}`),
    fields: {
      source: "frontend",
      ...fields,
    },
  }).catch(() => {});
}

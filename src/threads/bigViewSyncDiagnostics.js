import { invoke } from "@tauri-apps/api/core";

import {
  takeDiagnosticIpcBudget,
  withDiagnosticIpcDropCount,
} from "../diagnostics/diagnosticIpcBudget.js";

export const BIGVIEW_SYNC_DIAGNOSTIC_LOGGING_ENABLED = false;
export const FILE_DRAG_DIAGNOSTIC_LOGGING_ENABLED = false;

const BIGVIEW_SYNC_DIAGNOSTIC_DEFAULT_SAMPLE_MS = 1000;
const BIGVIEW_SYNC_DIAGNOSTIC_NOISY_SAMPLE_MS = 2500;
const BIGVIEW_SYNC_DIAGNOSTIC_LOG_MAX_TEXT = 512;
const BIGVIEW_SYNC_DIAGNOSTIC_NOISY_PHASES = new Set([
  "bigview.draft.local_sync_effect",
  "bigview.draft.store_set",
  "bigview.draft.store_subscriber",
  "bigview.image.attachment_state",
  "bigview.overlay.selection_state",
  "bigview.thread_detail.live_activity_visible",
  "bigview.thread_detail.render_state",
  "tui.image.attachment_overlay_state",
  "tui.text.composer_state_updated",
  "tui.text.submit_state_snapshot",
]);
const bigViewSyncDiagnosticSampleState = new Map();

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function cleanDiagnosticText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, BIGVIEW_SYNC_DIAGNOSTIC_LOG_MAX_TEXT);
}

function getBigViewSyncDiagnosticSampleMs(phase) {
  return BIGVIEW_SYNC_DIAGNOSTIC_NOISY_PHASES.has(phase)
    ? BIGVIEW_SYNC_DIAGNOSTIC_NOISY_SAMPLE_MS
    : BIGVIEW_SYNC_DIAGNOSTIC_DEFAULT_SAMPLE_MS;
}

function takeBigViewSyncDiagnosticSample(phase) {
  const sampleMs = getBigViewSyncDiagnosticSampleMs(phase);
  const now = nowMs();
  const currentState = bigViewSyncDiagnosticSampleState.get(phase);
  if (currentState && now - currentState.lastLoggedAtMs < sampleMs) {
    currentState.dropped += 1;
    return { dropped: 0, skip: true };
  }

  const dropped = currentState?.dropped || 0;
  bigViewSyncDiagnosticSampleState.set(phase, {
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
    line_count: text ? text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").length : 0,
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

  const cleanPhase = cleanDiagnosticText(phase);
  const sample = takeBigViewSyncDiagnosticSample(cleanPhase);
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

  invoke("bigview_sync_diagnostic_log", {
    phase: cleanPhase,
    fields: {
      source: "frontend",
      ...sampledFields,
    },
  }).catch(() => {});
}

export function logFileDragDiagnosticEvent(phase, fields = {}) {
  if (!FILE_DRAG_DIAGNOSTIC_LOGGING_ENABLED) {
    return;
  }

  const cleanPhase = cleanDiagnosticText(`filedrag.${phase}`);
  const sample = takeBigViewSyncDiagnosticSample(cleanPhase);
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

  invoke("bigview_sync_diagnostic_log", {
    phase: cleanPhase,
    fields: {
      source: "frontend",
      ...sampledFields,
    },
  }).catch(() => {});
}

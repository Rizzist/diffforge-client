// Thin client for the SQLite-backed audio transcription history.
//
// The full history lives in the Rust backend (see src-tauri/src/audio_history.rs).
// The frontend only ever pulls the visible window via keyset/offset pagination,
// so the IPC payload stays tiny regardless of how large the history grows. A
// small localStorage cache of recent items still powers the dictation widget;
// this module owns the durable, paginated path used by the History tab.

import { invoke } from "@tauri-apps/api/core";

export const AUDIO_HISTORY_APPENDED_EVENT = "audio-history-appended";
export const AUDIO_HISTORY_CHANGED_EVENT = "audio-history-changed";

const AUDIO_HISTORY_MIGRATION_FLAG_KEY = "diffforge.audio.historyMigratedV1";

// The backend orders and buckets by a single numeric column, so resolve a
// millisecond timestamp here and never make Rust parse date strings.
export function audioHistoryEntryWithCreatedAtMs(entry) {
  if (!entry || typeof entry !== "object") {
    return entry;
  }

  const existing = Number(entry.createdAtMs);
  if (Number.isFinite(existing) && existing > 0) {
    return entry;
  }

  let createdAtMs = 0;
  if (typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)) {
    createdAtMs = entry.createdAt;
  } else if (typeof entry.createdAt === "string") {
    const parsed = Date.parse(entry.createdAt);
    if (Number.isFinite(parsed)) {
      createdAtMs = parsed;
    }
  }
  if (!createdAtMs) {
    createdAtMs = Date.now();
  }

  return { ...entry, createdAtMs };
}

export async function audioHistoryAppend(entry) {
  return invoke("audio_history_append", {
    entry: audioHistoryEntryWithCreatedAtMs(entry),
  });
}

export async function audioHistoryImportEntries(entries) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map(audioHistoryEntryWithCreatedAtMs)
    .filter(Boolean);
  if (!normalized.length) {
    return { imported: 0 };
  }
  return invoke("audio_history_import", { entries: normalized });
}

export async function audioHistoryFetchPage({
  offset = null,
  limit = 60,
  beforeCreatedAtMs = null,
  beforeId = null,
} = {}) {
  return invoke("audio_history_page", {
    offset,
    limit,
    beforeCreatedAtMs,
    beforeId,
  });
}

export async function audioHistoryFetchSummary() {
  return invoke("audio_history_summary");
}

export async function audioHistoryClearAll() {
  return invoke("audio_history_clear");
}

// One-time import of any pre-existing localStorage history into the backend.
// Idempotent: the backend keeps whatever already exists, and the flag stops us
// re-importing on every launch. Returns true once migration has completed.
export async function migrateLocalAudioHistoryToBackend(localEntries) {
  if (typeof window === "undefined" || !window.localStorage) {
    return false;
  }

  try {
    if (window.localStorage.getItem(AUDIO_HISTORY_MIGRATION_FLAG_KEY) === "1") {
      return true;
    }
  } catch {
    // Storage unavailable: skip migration, the backend simply starts empty.
    return false;
  }

  try {
    if (Array.isArray(localEntries) && localEntries.length) {
      await audioHistoryImportEntries(localEntries);
    }
    window.localStorage.setItem(AUDIO_HISTORY_MIGRATION_FLAG_KEY, "1");
    return true;
  } catch {
    // Leave the flag unset so a later launch retries the import.
    return false;
  }
}

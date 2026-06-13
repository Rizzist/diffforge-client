import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { createGlobalStyle, keyframes } from "styled-components";

export const ACTIVITY_OVERLAY_HASH = "#/activity-overlay";
export const ACTIVITY_OVERLAY_CONTEXT_STORAGE_KEY = "diffforge.activityOverlay.context";

const CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT = "cloud-mcp-workspace-todos-updated";
const CLOUD_MCP_WORKSPACE_ASSETS_UPDATED_EVENT = "cloud-mcp-workspace-assets-updated";
// Dictation history: written by the audio widget window, shared via the
// app-wide localStorage; every publish also broadcasts this event.
const AUDIO_TRANSCRIPTION_HISTORY_STORAGE_KEY = "diffforge.audio.transcriptionHistory";
const AUDIO_TRANSCRIPTION_RESULT_EVENT = "forge-audio-transcription-result";
const AUDIO_DICTATION_STREAM_EVENT = "forge-audio-dictation-stream";
const DICTATION_CARD_LIMIT = 8;
// A live stream frame older than this is a dead take (widget window went
// away without its closing frame): drop it instead of pinning "LIVE".
const DICTATION_STREAM_STALE_MS = 12_000;

const REFRESH_DEBOUNCE_MS = 40;
const CARD_LIMIT = 30;
// Recently finished todos stay on the widget briefly (per workspace cap)
// so completions are visible without flooding it with the history ledger.
const OVERVIEW_FINISHED_CARD_LIMIT = 8;
const OVERVIEW_FINISHED_WINDOW_MS = 24 * 60 * 60 * 1000;
// Event-driven refreshes lead; the interval is a safety net so the overlay
// window converges even if a tauri event never reaches it.
const OVERVIEW_REFRESH_INTERVAL_MS = 5_000;
// Just-finished work (todo or transfer reaching done/failed/stopped) stays
// pinned with the active items briefly before settling into history.
const ACTIVE_FINISH_PIN_MS = 5_000;
// Terminal transfers (success or fail) stay in the history list for the same
// window as finished todos, capped so they can't flood the widget.
const TRANSFER_HISTORY_CARD_LIMIT = 10;
const EXIT_CELEBRATE_MS = 1400;
const EXIT_COLLAPSE_MS = 380;
const TERMINAL_TODO_WINDOW_MS = 20000;
const WORKSPACE_TODOS_CACHE_KEY = "diffforge.activityOverlay.workspaceTodos";

function runOverlayWindowAction(action) {
  try {
    Promise.resolve(action(getCurrentWindow())).catch(() => {});
  } catch {
    // Native overlay chrome is best-effort.
  }
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function jsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      return jsonObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return null;
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function dataValue(value) {
  const object = jsonObject(value);
  const data = jsonObject(object?.data);
  return data || object || {};
}

function normalizeActivityOverlayContext(value) {
  const object = jsonObject(value) || {};
  return {
    repoPath: text(object.repoPath || object.repo_path),
    workspaceId: text(object.workspaceId || object.workspace_id),
    workspaceName: text(object.workspaceName || object.workspace_name),
  };
}

function readActivityOverlayContext() {
  if (typeof window === "undefined") {
    return normalizeActivityOverlayContext(null);
  }
  try {
    return normalizeActivityOverlayContext(window.localStorage.getItem(ACTIVITY_OVERLAY_CONTEXT_STORAGE_KEY));
  } catch {
    return normalizeActivityOverlayContext(null);
  }
}

function storageKeyPart(value) {
  return text(value, "none")
    .replace(/[^\w.-]/gu, "_")
    .slice(0, 120) || "none";
}

function workspaceTodosCacheKey(context = {}) {
  return `${WORKSPACE_TODOS_CACHE_KEY}.${storageKeyPart(context.repoPath)}.${storageKeyPart(context.workspaceId)}`;
}

function activityOverlayContextKey(context = {}) {
  return `${text(context.repoPath)}\n${text(context.workspaceId)}`;
}

function readCachedWorkspaceTodos(context = {}) {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    return jsonObject(window.localStorage.getItem(workspaceTodosCacheKey(context))) || {};
  } catch {
    return {};
  }
}

// Last-known overview snapshot (small: capped todo rows, 180-char texts) so
// a freshly booted overlay webview paints real cards on its very first
// frame; the live fetch then converges it.
const TODO_OVERVIEW_CACHE_KEY = "diffforge.activityOverlay.todoOverview";

function readCachedTodoOverview() {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return jsonObject(JSON.parse(window.localStorage.getItem(TODO_OVERVIEW_CACHE_KEY) || "null"));
  } catch {
    return null;
  }
}

function writeCachedTodoOverview(overview) {
  if (typeof window === "undefined" || !jsonObject(overview)) {
    return;
  }
  try {
    window.localStorage.setItem(TODO_OVERVIEW_CACHE_KEY, JSON.stringify(overview));
  } catch {
    // Snapshot cache is best-effort; the live fetch remains authoritative.
  }
}

function writeCachedWorkspaceTodos(value, context = {}) {
  const workspaceTodos = jsonObject(value);
  if (typeof window === "undefined" || !workspaceTodos) {
    return;
  }
  try {
    window.localStorage.setItem(workspaceTodosCacheKey(context), JSON.stringify(workspaceTodos));
  } catch {
    // Cache hydration is best-effort; the Rust mirror remains the source of truth.
  }
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDictationHistoryEntry(entry, index = 0) {
  const object = jsonObject(entry);
  const entryText = text(object?.text);
  if (!entryText) {
    return null;
  }
  const createdAt = timestampMs(object?.createdAt || object?.created_at);
  return {
    createdAt,
    id: text(object?.id, `dictation-${createdAt || index}`),
    status: text(object?.status, "inserted"),
    text: entryText,
  };
}

function mergeDictationHistoryEntries(...entryLists) {
  const seen = new Set();
  return entryLists
    .flatMap((entries) => jsonArray(entries))
    .map(normalizeDictationHistoryEntry)
    .filter(Boolean)
    .filter((entry) => {
      const key = entry.id || `${entry.createdAt}:${entry.text}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, DICTATION_CARD_LIMIT);
}

function readDictationHistoryEntries() {
  if (typeof window === "undefined") {
    return [];
  }
  let raw = [];
  try {
    raw = JSON.parse(window.localStorage.getItem(AUDIO_TRANSCRIPTION_HISTORY_STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
  return mergeDictationHistoryEntries(raw);
}

function dictationClockLabel(createdAt) {
  const at = timestampMs(createdAt);
  if (!at) {
    return "--:--";
  }
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(numberValue(value, 0))));
}

function firstText(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function shortText(value, maxLength = 86) {
  const raw = text(value);
  if (raw.length <= maxLength) {
    return raw;
  }
  if (maxLength <= 3) {
    return raw.slice(0, maxLength);
  }
  return `${raw.slice(0, maxLength - 3)}...`;
}

function looksLikeOpaqueId(value) {
  const raw = text(value);
  if (!raw) {
    return false;
  }
  const compact = raw.replace(/[-_:./\s]/gu, "");
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(raw)
    || /^[0-9a-f]{24,}$/iu.test(compact)
    || /^[a-z]+-[0-9a-f][0-9a-f-]{14,}$/iu.test(raw)
    || (raw.length > 44 && /[0-9a-f]{10,}/iu.test(compact))
  );
}

function displayText(value, fallback = "") {
  const raw = text(value);
  if (!raw) {
    return fallback;
  }
  const basename = raw.split(/[\\/]/u).filter(Boolean).pop() || raw;
  if (looksLikeOpaqueId(raw) || looksLikeOpaqueId(basename)) {
    return fallback;
  }
  return basename;
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) {
      return 0;
    }
    if (value > 999999999999) {
      return value;
    }
    if (value > 999999999) {
      return value * 1000;
    }
  }
  const raw = text(value);
  if (!raw || raw === "0") {
    return 0;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recentTimestamp(...values) {
  return values.map(timestampMs).filter(Boolean).sort((left, right) => right - left)[0] || 0;
}

function timeAgo(value) {
  const at = timestampMs(value);
  if (!at) {
    return "just now";
  }
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 5) {
    return "now";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.round(hours / 24)}d`;
}

function formatBytes(value) {
  const bytes = numberValue(value, 0);
  if (!bytes) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const decimals = amount >= 100 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(decimals)} ${units[unitIndex]}`;
}

function statusKey(value, fallback = "active") {
  const normalized = text(value, fallback)
    .toLowerCase()
    .replace(/[_\s]+/gu, "-");
  if (["complete", "completed", "done", "success", "succeeded", "accepted", "merged", "synced", "ready", "uploaded", "downloaded", "cloud-available", "local-available"].includes(normalized)) {
    return "done";
  }
  if (["running", "active", "processing", "submitting", "validating", "syncing", "uploading", "downloading", "transferring", "checking", "diffing", "applying", "sending", "started", "in-flight", "in-progress"].includes(normalized)) {
    return "active";
  }
  if (["queued", "pending", "requested", "prepared", "preparing", "waiting"].includes(normalized)) {
    return "queued";
  }
  if (["paused", "parked", "resume-ready", "resume-requested", "needs-input", "awaiting-input"].includes(normalized)) {
    return "paused";
  }
  if (["failed", "failure", "error", "blocked", "rejected", "conflict", "violated", "needs-attention"].includes(normalized)) {
    return "failed";
  }
  if (["cancelled", "canceled", "interrupted", "aborted", "timed-out", "timeout", "expired"].includes(normalized)) {
    return "stopped";
  }
  return normalized || fallback;
}

function statusTone(status) {
  const key = statusKey(status);
  if (key === "done") {
    return "good";
  }
  if (key === "failed") {
    return "danger";
  }
  if (key === "paused" || key === "queued") {
    return "warn";
  }
  if (key === "stopped") {
    return "muted";
  }
  return "hot";
}

function statusProgress(status, fallback = 42) {
  const key = statusKey(status);
  if (key === "done") {
    return 100;
  }
  if (key === "queued") {
    return 22;
  }
  if (key === "paused") {
    return 48;
  }
  if (key === "failed" || key === "stopped") {
    return 100;
  }
  return fallback;
}

function workspaceTodosFromStatus(status) {
  const data = dataValue(status);
  const liveRuntime = jsonObject(data.liveRuntimeStatus || data.live_runtime_status) || {};
  return jsonObject(
    data.workspaceTodos
      || data.workspace_todos
      || liveRuntime.workspaceTodos
      || liveRuntime.workspace_todos,
  ) || {};
}

function collectionItems(collection) {
  if (Array.isArray(collection)) {
    return collection.filter(Boolean);
  }
  const object = jsonObject(collection);
  if (!object) {
    return [];
  }
  if (Array.isArray(object.items)) {
    return object.items.filter(Boolean);
  }
  if (Array.isArray(object.todos)) {
    return object.todos.filter(Boolean);
  }
  if (Array.isArray(object.dispatches)) {
    return object.dispatches.filter(Boolean);
  }
  return [];
}

function collectionWorkspaceId(entry) {
  return firstText(
    entry?.workspaceId,
    entry?.workspace_id,
    entry?.observerWorkspaceId,
    entry?.observer_workspace_id,
    entry?.targetWorkspaceId,
    entry?.target_workspace_id,
  );
}

function collectionsByWorkspace(collection, workspaceId = "") {
  const safeWorkspaceId = text(workspaceId);
  if (Array.isArray(collection)) {
    return collection
      .filter((entry) => !safeWorkspaceId || collectionWorkspaceId(entry) === safeWorkspaceId)
      .flatMap((entry) => collectionItems(entry));
  }
  const object = jsonObject(collection);
  if (!object) {
    return [];
  }
  if (safeWorkspaceId) {
    const direct = object[safeWorkspaceId] || object[safeWorkspaceId.toLowerCase()];
    if (direct) {
      return collectionItems(direct);
    }
    return Object.values(object)
      .filter((entry) => collectionWorkspaceId(entry) === safeWorkspaceId)
      .flatMap((entry) => collectionItems(entry));
  }
  return Object.values(object).flatMap((entry) => collectionItems(entry));
}

function workspaceIdsForTodoItem(item, kind = "todo") {
  const common = [
    item?.workspaceId,
    item?.workspace_id,
    item?.observerWorkspaceId,
    item?.observer_workspace_id,
    item?.todoWorkspaceId,
    item?.todo_workspace_id,
    item?.originWorkspaceId,
    item?.origin_workspace_id,
  ];
  if (kind === "dispatch") {
    return [
      item?.targetWorkspaceId,
      item?.target_workspace_id,
      ...common,
    ].map(text).filter(Boolean);
  }
  return common.map(text).filter(Boolean);
}

function todoItemMatchesWorkspace(item, workspaceId, kind = "todo") {
  const safeWorkspaceId = text(workspaceId);
  if (!safeWorkspaceId) {
    return false;
  }
  return workspaceIdsForTodoItem(item, kind).some((candidate) => candidate === safeWorkspaceId);
}

function workspaceTodoCollection(workspaceTodos, directKeys, byWorkspaceKeys, workspaceId = "", kind = "todo") {
  const safeWorkspaceId = text(workspaceId);
  if (!safeWorkspaceId) {
    return [];
  }
  const direct = directKeys.flatMap((key) => collectionItems(workspaceTodos?.[key]));
  const byWorkspace = byWorkspaceKeys.flatMap((key) => collectionsByWorkspace(workspaceTodos?.[key], safeWorkspaceId));
  const items = byWorkspace.length ? byWorkspace : direct;
  return items.filter((item) => todoItemMatchesWorkspace(jsonObject(item) || {}, safeWorkspaceId, kind));
}

function todoIdentity(item, fallback) {
  return firstText(
    item?.todoId,
    item?.todo_id,
    item?.id,
    item?.bodyHash,
    item?.body_hash,
    item?.todoBodyHash,
    item?.todo_body_hash,
    fallback,
  );
}

function todoTitle(item, fallback = "todo") {
  return shortText(
    displayText(
      firstText(
        item?.llmTitle,
        item?.llm_title,
        item?.title,
        item?.summary,
        item?.body,
        item?.todoText,
        item?.todo_text,
        item?.text,
        item?.todoBodyPreview,
        item?.todo_body_preview,
        item?.textPreview,
        item?.text_preview,
      ),
      fallback,
    ),
    58,
  );
}

function todoWorkspaceLabel(item) {
  return shortText(
    displayText(
      firstText(
        item?.workspaceName,
        item?.workspace_name,
        item?.targetWorkspaceName,
        item?.target_workspace_name,
        item?.observerWorkspaceName,
        item?.observer_workspace_name,
        item?.gitRepoDisplayName,
        item?.git_repo_display_name,
        item?.repoName,
        item?.repo_name,
      ),
    ),
    32,
  );
}

function todoUpdatedAt(item) {
  return recentTimestamp(
    item?.todoCompletedAt,
    item?.todo_completed_at,
    item?.completedAt,
    item?.completed_at,
    item?.todoCancelledAt,
    item?.todo_cancelled_at,
    item?.cancelledAt,
    item?.cancelled_at,
    item?.todoFailedAt,
    item?.todo_failed_at,
    item?.failedAt,
    item?.failed_at,
    item?.todoInterruptedAt,
    item?.todo_interrupted_at,
    item?.interruptedAt,
    item?.interrupted_at,
    item?.todoTimedOutAt,
    item?.todo_timed_out_at,
    item?.timedOutAt,
    item?.timed_out_at,
    item?.updatedAt,
    item?.updated_at,
    item?.queuedAt,
    item?.queued_at,
    item?.createdAt,
    item?.created_at,
    item?.startedAt,
    item?.started_at,
  );
}

function todoRawStatusText(item) {
  return text(
    item?.dispatchStatus
      || item?.dispatch_status
      || item?.todoStatus
      || item?.todo_status
      || item?.cloudStatus
      || item?.cloud_status
      || item?.status
      || item?.state,
  );
}

function todoLifecycleRank(status) {
  const key = statusKey(status, "");
  if (["done", "failed", "stopped"].includes(key)) {
    return 3;
  }
  if (["active", "paused"].includes(key)) {
    return 2;
  }
  if (key === "queued") {
    return 1;
  }
  return 0;
}

function todoStatusUpdatedAt(item) {
  return recentTimestamp(
    item?.todoStatusUpdatedAt,
    item?.todo_status_updated_at,
    item?.statusUpdatedAt,
    item?.status_updated_at,
  ) || recentTimestamp(
    item?.updatedAt,
    item?.updated_at,
  );
}

function todoSettledEvidence(item) {
  const candidates = [
    { status: "done", at: firstText(item?.todoCompletedAt, item?.todo_completed_at, item?.completedAt, item?.completed_at) },
    { status: "stopped", at: firstText(item?.todoCancelledAt, item?.todo_cancelled_at, item?.cancelledAt, item?.cancelled_at, item?.canceledAt, item?.canceled_at) },
    { status: "failed", at: firstText(item?.todoFailedAt, item?.todo_failed_at, item?.failedAt, item?.failed_at) },
    { status: "stopped", at: firstText(item?.todoInterruptedAt, item?.todo_interrupted_at, item?.interruptedAt, item?.interrupted_at) },
    { status: "stopped", at: firstText(item?.todoTimedOutAt, item?.todo_timed_out_at, item?.timedOutAt, item?.timed_out_at, item?.timeoutAt, item?.timeout_at) },
  ];
  return candidates
    .map((candidate) => ({ ...candidate, atMs: timestampMs(candidate.at) }))
    .filter((candidate) => candidate.at)
    .sort((left, right) => (right.atMs || 0) - (left.atMs || 0))[0] || null;
}

function todoLifecycleStatus(item, fallback = "listed") {
  const rawText = todoRawStatusText(item);
  const status = statusKey(rawText || fallback, fallback);
  const evidence = todoSettledEvidence(item);
  if (!evidence) {
    return status;
  }
  const evidenceRank = todoLifecycleRank(evidence.status);
  const statusRank = rawText ? todoLifecycleRank(status) : 0;
  if (!evidenceRank || evidenceRank <= statusRank) {
    return status;
  }
  const statusAt = todoStatusUpdatedAt(item);
  if (!rawText || !statusAt || !evidence.atMs || evidence.atMs >= statusAt) {
    return evidence.status;
  }
  return status;
}

function todoDisplayStatus(item, fallback = "listed") {
  const status = todoLifecycleStatus(item, fallback);
  if (status === "queued") {
    return "queued";
  }
  if (status === "listed") {
    return "listed";
  }
  return "";
}

function isLocalTodo(item) {
  const source = text(item?.sourceKind || item?.source_kind || item?.source || item?.origin).toLowerCase();
  const mode = text(item?.mode || item?.queueMode || item?.queue_mode || item?.dispatchMode || item?.dispatch_mode).toLowerCase();
  if (
    source.includes("remote")
    || source.includes("dispatch")
    || mode.includes("remote")
    || mode.includes("dispatch")
  ) {
    return false;
  }
  return !(
    item?.remoteCommand
    || item?.remote_command
    || item?.dispatchId
    || item?.dispatch_id
    || item?.todoDispatchId
    || item?.todo_dispatch_id
    || item?.targetDeviceId
    || item?.target_device_id
  );
}

function uniqueCards(cards, limit = CARD_LIMIT) {
  const byId = new Map();
  cards.filter(Boolean).forEach((card, index) => {
    const id = firstText(card.id, `${card.lane || "card"}-${index}`);
    if (!byId.has(id)) {
      byId.set(id, { ...card, id });
    }
  });
  return Array.from(byId.values())
    .sort((left, right) => {
      const leftRank = statusKey(left.status) === "active" ? 2 : statusKey(left.status) === "queued" ? 1 : 0;
      const rightRank = statusKey(right.status) === "active" ? 2 : statusKey(right.status) === "queued" ? 1 : 0;
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
      return numberValue(right.updatedAt, 0) - numberValue(left.updatedAt, 0);
    })
    .slice(0, limit);
}

function todoCardFromItem(item, index, status, options = {}) {
  const object = jsonObject(item) || {};
  const workspace = todoWorkspaceLabel(object);
  const lane = options.lane || "todos";
  return {
    id: `${lane}-${todoIdentity(object, index)}`,
    detail: workspace,
    eyebrow: status,
    lane: "todos",
    meta: workspace,
    progress: status === "queued" ? 20 : 0,
    status,
    title: todoTitle(object, options.fallbackTitle || "Todo"),
    tone: status === "queued" ? "warn" : "good",
    updatedAt: todoUpdatedAt(object),
  };
}

/// Authoritative todo cards from the Rust queue stores (`todo_dispatch_overview`):
/// running, queued, AND listed todos render with zero cloud dependency — the
/// store is the headless source of truth, the cloud mirror below only adds
/// peer-device rows. Card ids share the mirror's `todo-` scheme so the same
/// logical todo dedupes to the Rust row.
function normalizeOverviewTodoCards(overview) {
  const cards = [];
  jsonArray(overview?.workspaces).forEach((workspace) => {
    const workspaceObject = jsonObject(workspace) || {};
    const workspaceName = text(
      workspaceObject.workspaceName
        || workspaceObject.workspace_name
        || workspaceObject.workspaceId
        || workspaceObject.workspace_id,
    );
    const finishedItems = [];
    jsonArray(workspaceObject.items).forEach((item, index) => {
      const object = jsonObject(item) || {};
      const bucket = text(object.bucket).toLowerCase();
      if (bucket === "finished") {
        finishedItems.push({ index, object });
        return;
      }
      if (!["running", "queued", "listed"].includes(bucket)) {
        return;
      }
      const status = bucket === "running" ? "active" : bucket;
      const card = todoCardFromItem(
        { ...object, workspaceName },
        index,
        status,
        {
          fallbackTitle: bucket === "running"
            ? "Running todo"
            : bucket === "queued"
              ? "Queued todo"
              : "Listed todo",
          lane: "todo",
        },
      );
      if (bucket === "running") {
        card.eyebrow = "running";
        card.progress = 60;
        card.tone = "hot";
      }
      cards.push(card);
    });
    // Recently finished todos stay visible (completed/failed/cancelled),
    // newest first and capped per workspace so the retained history ledger
    // doesn't flood the widget.
    finishedItems
      .map((entry) => ({ ...entry, updatedAt: todoUpdatedAt(entry.object) }))
      .filter((entry) => entry.updatedAt
        && Date.now() - entry.updatedAt <= OVERVIEW_FINISHED_WINDOW_MS)
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, OVERVIEW_FINISHED_CARD_LIMIT)
      .forEach(({ index, object }) => {
        const status = statusKey(object.status, "") === "failed" ? "failed" : "done";
        const card = todoCardFromItem(
          { ...object, workspaceName },
          index,
          status,
          { fallbackTitle: "Finished todo", lane: "todo" },
        );
        card.eyebrow = text(object.status, status);
        card.progress = 100;
        card.tone = statusTone(status);
        cards.push(card);
      });
  });
  return uniqueCards(cards);
}

function collectOverviewTodoIdentities(overview) {
  const identities = new Set();
  jsonArray(overview?.workspaces).forEach((workspace) => {
    jsonArray(workspace?.items).forEach((item, index) => {
      const object = jsonObject(item) || {};
      [
        todoIdentity(object, index),
        object.commandId,
        object.command_id,
        object.dispatchId,
        object.dispatch_id,
        object.todoDispatchId,
        object.todo_dispatch_id,
      ]
        .map(text)
        .filter(Boolean)
        .forEach((identity) => identities.add(identity));
    });
  });
  return identities;
}

function normalizeTodoCards(status, workspaceId = "") {
  const workspaceTodos = workspaceTodosFromStatus(status);
  const listedCards = workspaceTodoCollection(
    workspaceTodos,
    ["items", "todos"],
    ["itemsByWorkspace", "items_by_workspace", "todosByWorkspace", "todos_by_workspace"],
    workspaceId,
    "todo",
  ).map((item, index) => {
    const object = jsonObject(item) || {};
    const status = todoDisplayStatus(object, "listed");
    if (status !== "listed") {
      return null;
    }
    return todoCardFromItem(object, index, status, {
      fallbackTitle: "Listed todo",
      lane: "todo",
    });
  });

  const queuedCards = workspaceTodoCollection(
    workspaceTodos,
    ["dispatches", "todoDispatches", "todo_dispatches"],
    ["dispatchesByWorkspace", "dispatches_by_workspace", "todoDispatchesByWorkspace", "todo_dispatches_by_workspace"],
    workspaceId,
    "dispatch",
  ).map((item, index) => {
    const object = jsonObject(item) || {};
    const status = todoDisplayStatus(object, "queued");
    if (status !== "queued") {
      return null;
    }
    return todoCardFromItem(object, index, status, {
      fallbackTitle: "Queued todo",
      lane: "todo-dispatch",
    });
  });

  return uniqueCards(
    [...queuedCards, ...listedCards].filter(Boolean),
  );
}

function todoTerminalStatus(item) {
  const status = todoLifecycleStatus(item, "");
  if (["done", "failed", "stopped"].includes(status)) {
    return status;
  }
  return "";
}

/// Recently terminal todos (done/failed/cancelled/interrupted) so the
/// overlay can play the matching exit animation when an active row leaves.
function normalizeTerminalTodoStates(status) {
  const workspaceTodos = workspaceTodosFromStatus(status);
  const states = new Map();
  const record = (item) => {
    const object = jsonObject(item) || {};
    const terminal = todoTerminalStatus(object);
    if (!terminal) {
      return;
    }
    const updatedAt = todoUpdatedAt(object);
    if (!updatedAt || Date.now() - updatedAt > TERMINAL_TODO_WINDOW_MS) {
      return;
    }
    const id = todoIdentity(object, "");
    if (id) {
      states.set(`todo-${id}`, terminal);
      states.set(`todo-dispatch-${id}`, terminal);
    }
  };
  workspaceTodoCollection(
    workspaceTodos,
    ["items", "todos"],
    ["itemsByWorkspace", "items_by_workspace", "todosByWorkspace", "todos_by_workspace"],
    "",
    "todo",
  ).forEach(record);
  workspaceTodoCollection(
    workspaceTodos,
    ["dispatches", "todoDispatches", "todo_dispatches"],
    ["dispatchesByWorkspace", "dispatches_by_workspace", "todoDispatchesByWorkspace", "todo_dispatches_by_workspace"],
    "",
    "dispatch",
  ).forEach(record);
  return states;
}

function assetLibraryTransfers(value) {
  const data = dataValue(value);
  return jsonArray(data.transfers);
}

function assetItemsById(value) {
  const data = dataValue(value);
  const byId = new Map();
  [...jsonArray(data.items), ...jsonArray(data.assets)].forEach((asset) => {
    const object = jsonObject(asset);
    const id = firstText(object?.assetId, object?.asset_id, object?.id);
    if (object && id) {
      byId.set(id, object);
    }
  });
  return byId;
}

function assetLocalPath(asset) {
  return text(
    asset?.localPath
      || asset?.local_path
      || asset?.path
      || asset?.localPathHint
      || asset?.local_path_hint
      || asset?.lastLocalPath
      || asset?.last_local_path,
  );
}

function assetLocalAvailable(asset) {
  const explicit = asset?.localAvailable ?? asset?.local_available;
  if (typeof explicit === "boolean") return explicit && Boolean(assetLocalPath(asset));
  const localStatus = text(asset?.localStatus || asset?.local_status).toLowerCase().replace(/[_\s]+/gu, "-");
  if (["deleted", "local-deleted", "missing", "unavailable"].includes(localStatus)) return false;
  return Boolean(assetLocalPath(asset));
}

function assetCloudAvailable(asset) {
  const explicit = asset?.cloudAvailable ?? asset?.cloud_available;
  if (typeof explicit === "boolean") return explicit;
  const cloudStatus = text(
    asset?.cloudStatus || asset?.cloud_status || asset?.status || asset?.assetStatus || asset?.asset_status,
  ).toLowerCase().replace(/[_\s]+/gu, "-");
  if (["cloud-deleted-local-kept", "deleted", "local-only", "missing", "not-found", "unavailable"].includes(cloudStatus)) {
    return false;
  }
  if (["available", "cloud-available", "cloud-only", "complete", "completed", "ready", "synced", "uploaded"].includes(cloudStatus)) {
    return true;
  }
  return Boolean(asset?.blobId || asset?.blob_id || asset?.objectKey || asset?.object_key);
}

function assetSynced(asset) {
  return assetLocalAvailable(asset) && assetCloudAvailable(asset);
}

function assetUpdatedAt(asset) {
  return recentTimestamp(
    asset?.updatedAt,
    asset?.updated_at,
    asset?.cloudUpdatedAt,
    asset?.cloud_updated_at,
    asset?.localUpdatedAt,
    asset?.local_updated_at,
    asset?.createdAt,
    asset?.created_at,
  );
}

function transferPercent(transfer) {
  const total = numberValue(
    transfer?.bytesTotal
      ?? transfer?.bytes_total
      ?? transfer?.totalBytes
      ?? transfer?.total_bytes
      ?? transfer?.contentLength
      ?? transfer?.content_length,
    0,
  );
  const done = numberValue(
    transfer?.bytesDone
      ?? transfer?.bytes_done
      ?? transfer?.uploadedBytes
      ?? transfer?.uploaded_bytes
      ?? transfer?.downloadedBytes
      ?? transfer?.downloaded_bytes
      ?? transfer?.transferredBytes
      ?? transfer?.transferred_bytes,
    0,
  );
  const explicit = transfer?.percent ?? transfer?.progressPercent ?? transfer?.progress_percent;
  if (Number.isFinite(Number(explicit))) {
    return clampPercent(explicit);
  }
  if (!total) {
    return statusProgress(transfer?.status || transfer?.transferStatus || transfer?.transfer_status, 46);
  }
  return clampPercent((done / total) * 100);
}

function transferSizeMeta(transfer) {
  const total = numberValue(transfer?.bytesTotal ?? transfer?.bytes_total ?? transfer?.totalBytes ?? transfer?.total_bytes, 0);
  const done = numberValue(transfer?.bytesDone ?? transfer?.bytes_done ?? transfer?.uploadedBytes ?? transfer?.uploaded_bytes ?? transfer?.downloadedBytes ?? transfer?.downloaded_bytes, 0);
  if (done && total) {
    return `${formatBytes(done)} / ${formatBytes(total)}`;
  }
  if (total) {
    return formatBytes(total);
  }
  if (done) {
    return formatBytes(done);
  }
  return "";
}

function transferDirection(transfer) {
  const direction = text(transfer?.direction || transfer?.transferDirection || transfer?.transfer_direction, "sync")
    .toLowerCase()
    .replace(/[_\s]+/gu, "-");
  if (direction.includes("upload")) {
    return "upload";
  }
  if (direction.includes("download")) {
    return "download";
  }
  return "sync";
}

function transferUpdatedAt(transfer) {
  return recentTimestamp(
    transfer?.updatedAt,
    transfer?.updated_at,
    transfer?.completedAt,
    transfer?.completed_at,
    transfer?.createdAt,
    transfer?.created_at,
  );
}

function isOpenTransferStatus(transfer) {
  const status = statusKey(transfer?.status || transfer?.transferStatus || transfer?.transfer_status, "active");
  return (
    status === "active"
    || status === "queued"
    || [
      "prepared",
      "preparing",
      "syncing",
      "uploading",
      "downloading",
      "transferring",
      "verifying",
      "warming-cache",
      "warming_cache",
      "cache-warming",
      "committing",
      "sending",
      "receiving",
    ].includes(status)
  );
}

function isTerminalTransferStatus(status) {
  return ["done", "failed", "stopped"].includes(statusKey(status, ""));
}

function transferDisplayStatus(transfer, asset) {
  const status = statusKey(transfer?.status || transfer?.transferStatus || transfer?.transfer_status, "active");
  if (assetSynced(asset) && (status === "active" || status === "queued")) {
    return "done";
  }
  return status;
}

function transferActivityAt(transfer, asset) {
  return recentTimestamp(transferUpdatedAt(transfer), assetUpdatedAt(asset));
}

function isVisibleTransfer(transfer, asset) {
  const status = transferDisplayStatus(transfer, asset);
  if (isTerminalTransferStatus(status)) {
    // Terminal transfers (done/failed/stopped) are history rows; keep them
    // for the same retention window as finished todos.
    const updatedAt = transferActivityAt(transfer, asset);
    return updatedAt > 0 && Date.now() - updatedAt <= OVERVIEW_FINISHED_WINDOW_MS;
  }
  return isOpenTransferStatus(transfer);
}

function transferTitle(transfer, asset) {
  return shortText(firstText(
    displayText(asset?.name),
    displayText(asset?.filename),
    displayText(asset?.fileName),
    displayText(asset?.file_name),
    displayText(transfer?.assetName),
    displayText(transfer?.asset_name),
    displayText(transfer?.filename),
    displayText(transfer?.fileName),
    displayText(transfer?.file_name),
    "Asset transfer",
  ), 58);
}

function normalizeTransferCards(library) {
  const assets = assetItemsById(library);
  const cards = assetLibraryTransfers(library).map((transfer, index) => {
    const object = jsonObject(transfer) || {};
    const assetId = firstText(object.assetId, object.asset_id);
    const hasAsset = assetId ? assets.has(assetId) : false;
    const asset = assets.get(assetId) || {};
    if (!isVisibleTransfer(object, asset)) {
      return null;
    }
    const direction = transferDirection(object);
    const status = transferDisplayStatus(object, asset);
    const progress = status === "done" ? 100 : transferPercent(object);
    const size = transferSizeMeta(object);
    const title = transferTitle(object, asset);
    if (!hasAsset && title === "Asset transfer") {
      return null;
    }
    return {
      id: `transfer-${firstText(object.transferId, object.transfer_id, object.id, index)}`,
      eyebrow: direction,
      lane: "transfers",
      meta: firstText(size, `${progress}%`),
      progress,
      status,
      title,
      tone: status === "done" ? "good" : direction === "upload" ? "warn" : direction === "download" ? "hot" : statusTone(status),
      updatedAt: transferActivityAt(object, asset),
    };
  }).filter(Boolean);
  // Open transfers all show; terminal ones (the history ledger) keep only
  // the most recent few so old uploads/downloads can't flood the widget.
  const openCards = cards.filter((card) => !isTerminalTransferStatus(card.status));
  const terminalCards = cards
    .filter((card) => isTerminalTransferStatus(card.status))
    .sort((left, right) => numberValue(right.updatedAt, 0) - numberValue(left.updatedAt, 0))
    .slice(0, TRANSFER_HISTORY_CARD_LIMIT);
  return uniqueCards([...openCards, ...terminalCards]);
}

function summaryStats(todoCards, transferCards) {
  const cards = [...todoCards, ...transferCards];
  const active = transferCards.length;
  const queued = todoCards.filter((card) => statusKey(card.status) === "queued").length
    + transferCards.filter((card) => statusKey(card.status) === "queued").length;
  const failed = cards.filter((card) => statusKey(card.status) === "failed").length;
  return {
    active,
    failed,
    queued,
    todos: todoCards.length,
    transfers: transferCards.length,
  };
}

function hudCardKind(card) {
  const lane = text(card?.lane).toLowerCase();
  const eyebrow = text(card?.eyebrow).toLowerCase();
  const group = text(card?.group).toLowerCase();
  if (eyebrow.includes("upload")) return "upload";
  if (eyebrow.includes("download")) return "download";
  if (lane === "transfers" || group === "asset") return "transfer";
  return "todo";
}

/// Unified list tiers: 0 = active work (running todos, live transfers, and
/// anything that just finished — pinned for ACTIVE_FINISH_PIN_MS), 1 = queued
/// (top of the history list, under the active items), 2 = history (finished
/// todos, terminal transfers, listed todos, dictation entries) by recency.
function activityCardTier(card, now = Date.now()) {
  const status = statusKey(card?.status);
  if (status === "active") {
    return 0;
  }
  if (["done", "failed", "stopped"].includes(status)) {
    const finishedAt = numberValue(card?.updatedAt, 0);
    return finishedAt && now - finishedAt <= ACTIVE_FINISH_PIN_MS ? 0 : 2;
  }
  if (status === "queued") {
    return 1;
  }
  return 2;
}


function useActivityOverlayContext() {
  const [context, setContext] = useState(() => readActivityOverlayContext());

  useEffect(() => {
    const syncContext = () => {
      setContext(readActivityOverlayContext());
    };
    window.addEventListener("storage", syncContext);
    window.addEventListener("focus", syncContext);
    syncContext();
    return () => {
      window.removeEventListener("storage", syncContext);
      window.removeEventListener("focus", syncContext);
    };
  }, []);

  return context;
}

function useActivityOverlayData(context) {
  const [state, setState] = useState(() => ({
    cachedWorkspaceTodos: readCachedWorkspaceTodos(context),
    cloudStatus: null,
    errors: [],
    library: null,
    todoOverview: readCachedTodoOverview(),
    updatedAt: 0,
  }));
  const contextRef = useRef(context);
  const contextKeyRef = useRef(activityOverlayContextKey(context));
  const refreshTimerRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const refreshPendingOptionsRef = useRef(null);
  const overviewInFlightRef = useRef(false);
  const overviewPendingRef = useRef(false);

  // Fast path for the authoritative todo cards: a store change re-reads only
  // `todo_dispatch_overview` (a local queue-file read) and lands immediately,
  // instead of waiting behind the debounced full refresh whose cloud status
  // and asset calls are orders of magnitude slower.
  const refreshTodoOverview = useCallback(async () => {
    if (overviewInFlightRef.current) {
      overviewPendingRef.current = true;
      return;
    }
    overviewInFlightRef.current = true;
    try {
      do {
        overviewPendingRef.current = false;
        try {
          const overview = await invoke("todo_dispatch_overview");
          writeCachedTodoOverview(overview);
          setState((current) => ({
            ...current,
            todoOverview: overview,
            updatedAt: Date.now(),
          }));
        } catch {
          break;
        }
      } while (overviewPendingRef.current);
    } finally {
      overviewInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    contextRef.current = context;
    contextKeyRef.current = activityOverlayContextKey(context);
    setState((current) => ({
      ...current,
      cachedWorkspaceTodos: readCachedWorkspaceTodos(context),
      updatedAt: Date.now(),
    }));
  }, [context.repoPath, context.workspaceId]);

  const refresh = useCallback(async ({ localOnly = true } = {}) => {
    if (refreshInFlightRef.current) {
      refreshPendingOptionsRef.current = { localOnly: localOnly && refreshPendingOptionsRef.current?.localOnly !== false };
      return;
    }
    refreshInFlightRef.current = true;
    const refreshContext = contextRef.current || {};
    const refreshContextKey = activityOverlayContextKey(refreshContext);
    // The overlay always shows every active workspace; the mirror call is
    // intentionally unscoped.
    const cachedTodosPromise = invoke("cloud_mcp_get_cached_workspace_todos", {})
      .then((value) => {
        if (contextKeyRef.current !== refreshContextKey) {
          return null;
        }
        const cachedWorkspaceTodos = jsonObject(value) || {};
        writeCachedWorkspaceTodos(cachedWorkspaceTodos, refreshContext);
        setState((current) => ({
          ...current,
          cachedWorkspaceTodos,
          errors: current.errors.filter((entry) => entry !== "todos"),
          updatedAt: Date.now(),
        }));
        return cachedWorkspaceTodos;
      })
      .catch(() => {
        if (contextKeyRef.current !== refreshContextKey) {
          return null;
        }
        setState((current) => ({
          ...current,
          errors: Array.from(new Set([...current.errors, "todos"])),
          updatedAt: Date.now(),
        }));
        return null;
      });
    try {
      const [cloudStatusResult, libraryResult, todoOverviewResult] = await Promise.allSettled([
        invoke("cloud_mcp_get_status"),
        invoke("cloud_mcp_list_account_assets", {
          limit: 120,
          localOnly,
        }),
        // The Rust queue stores are the headless todo truth: running, queued,
        // and listed todos render from here with no cloud round trip.
        invoke("todo_dispatch_overview"),
      ]);
      const refreshedWorkspaceTodos = await cachedTodosPromise;
      if (contextKeyRef.current !== refreshContextKey) {
        return;
      }
      if (todoOverviewResult.status === "fulfilled") {
        writeCachedTodoOverview(todoOverviewResult.value);
      }
      setState((current) => {
        const errors = [];
        if (!refreshedWorkspaceTodos) {
          errors.push("todos");
        }
        if (cloudStatusResult.status === "rejected") {
          errors.push("cloud");
        }
        if (libraryResult.status === "rejected") {
          errors.push("assets");
        }
        const cloudStatus = cloudStatusResult.status === "fulfilled" ? cloudStatusResult.value : current.cloudStatus;
        const cloudWorkspaceTodos = cloudStatusResult.status === "fulfilled"
          ? workspaceTodosFromStatus(cloudStatus)
          : {};
        const nextWorkspaceTodos = refreshedWorkspaceTodos
          || (Object.keys(cloudWorkspaceTodos).length
            ? cloudWorkspaceTodos
            : current.cachedWorkspaceTodos);
        writeCachedWorkspaceTodos(nextWorkspaceTodos, refreshContext);
        return {
          ...current,
          cachedWorkspaceTodos: nextWorkspaceTodos,
          cloudStatus,
          errors,
          library: libraryResult.status === "fulfilled" ? libraryResult.value : current.library,
          todoOverview: todoOverviewResult.status === "fulfilled"
            ? todoOverviewResult.value
            : current.todoOverview,
          updatedAt: Date.now(),
        };
      });
    } finally {
      refreshInFlightRef.current = false;
      const pendingOptions = refreshPendingOptionsRef.current;
      refreshPendingOptionsRef.current = null;
      if (pendingOptions) {
        window.setTimeout(() => {
          void refresh(pendingOptions);
        }, 0);
      }
    }
  }, []);

  const scheduleRefresh = useCallback((options) => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = 0;
      void refresh(options);
    }, REFRESH_DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    const unlisteners = [];
    const addListener = async (eventName, options = {}) => {
      try {
        const unlisten = await listen(eventName, () => {
          if (cancelled) {
            return;
          }
          if (options.onEvent) {
            void options.onEvent();
          }
          scheduleRefresh(options.refreshOptions || {});
        });
        if (cancelled) {
          unlisten();
        } else {
          unlisteners.push(unlisten);
        }
      } catch {
        // The overlay can still run from periodic snapshots if an event channel is absent.
      }
    };

    void addListener(CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT, { onEvent: refreshTodoOverview });
    // Rust store mutations (direct captures, queue syncs, settlements,
    // deletes, sweeps) drive the authoritative todo cards; the fast path
    // updates them instantly, the debounced full refresh converges the rest.
    void addListener("todo-store-changed", { onEvent: refreshTodoOverview });
    void addListener(CLOUD_MCP_WORKSPACE_ASSETS_UPDATED_EVENT, { refreshOptions: { localOnly: false } });
    // The pre-created window keeps this panel mounted while hidden; the
    // moment Rust shows it, converge immediately instead of riding the poll.
    void addListener("forge-activity-overlay-visibility-changed", {
      onEvent: refreshTodoOverview,
      refreshOptions: { localOnly: false },
    });

    // Safety-net poll: overlay windows are separate webviews that can open
    // before listeners attach or miss an event entirely; the interval keeps
    // them converging on the Rust store regardless.
    const intervalId = window.setInterval(() => {
      if (!cancelled) {
        scheduleRefresh({});
      }
    }, OVERVIEW_REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = 0;
      }
      unlisteners.forEach((unlisten) => {
        try {
          unlisten();
        } catch {
          // Ignore listener teardown failures.
        }
      });
    };
  }, [refresh, refreshTodoOverview, scheduleRefresh]);

  useEffect(() => {
    void refresh({ localOnly: false });
  }, [context.repoPath, context.workspaceId, refresh]);

  return state;
}

function summaryLabel(stats) {
  const parts = [];
  if (stats.todos) {
    parts.push(`${stats.todos} ${stats.todos === 1 ? "todo" : "todos"}`);
  }
  if (stats.transfers) {
    parts.push(`${stats.transfers} ${stats.transfers === 1 ? "asset" : "assets"}`);
  }
  return parts.join(" · ") || "all clear";
}

function RowGlyph({ celebrate = false, kind, status, tone }) {
  const state = statusKey(status);
  const spinning = (kind !== "todo" && state === "active")
    || (kind === "todo" && state === "queued" && !celebrate);
  let shape;
  if (state === "stopped") {
    shape = (
      <>
        <circle cx="6" cy="6" r="3.5" />
        <path d="M3.6 8.4l4.8-4.8" />
      </>
    );
  } else if (state === "failed") {
    shape = (
      <>
        <path d="M6 2.9v3.6" />
        <circle cx="6" cy="9.1" r="0.8" fill="currentColor" stroke="none" />
      </>
    );
  } else if (state === "done") {
    shape = <path d="M2.8 6.3l2.2 2.3 4.2-4.7" />;
  } else if (state === "listed") {
    // Plain backlog todo: the same solid blue dot the orchestrator tab's
    // todo list uses.
    shape = <circle cx="6" cy="6" r="3" fill="currentColor" stroke="none" />;
  } else if (kind === "upload") {
    shape = (
      <>
        <path d="M6 9.6V2.8" />
        <path d="M3.3 5.4L6 2.7l2.7 2.7" />
      </>
    );
  } else if (kind === "download") {
    shape = (
      <>
        <path d="M6 2.4v6.8" />
        <path d="M3.3 6.6L6 9.3l2.7-2.7" />
      </>
    );
  } else if (kind === "transfer") {
    shape = (
      <>
        <path d="M9.9 6A3.9 3.9 0 1 1 8.8 3.3" />
        <path d="M9.1 1.4l.2 2.1-2.1.2" />
      </>
    );
  } else if (state === "queued") {
    // Open arc: reads as an in-progress spinner while the row is queued.
    shape = <path d="M9.5 6A3.5 3.5 0 1 1 6 2.5" />;
  } else {
    shape = (
      <>
        <circle cx="6" cy="6" r="3.5" />
        <circle cx="6" cy="6" r="1" fill="currentColor" stroke="none" />
      </>
    );
  }
  return (
    <GlyphBadge
      aria-hidden="true"
      data-celebrate={celebrate ? state : undefined}
      data-spin={spinning ? "true" : "false"}
      data-tone={tone}
    >
      <svg
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.4"
        viewBox="0 0 12 12"
      >
        {shape}
      </svg>
    </GlyphBadge>
  );
}

// The same activity surface renders in two hosts: the standalone overlay
// window (Ctrl+Shift+Space) and embedded inside the background tray popover.
// Embedded mode drops the window-drag affordances and the floating-card
// chrome; data flows identically (shared localStorage context + invokes).
export function ActivityOverlayPanel({ embedded = false }) {
  const context = useActivityOverlayContext();
  const data = useActivityOverlayData(context);
  const todoCards = useMemo(() => {
    // Rust queue stores lead (running/queued/listed, headless truth); the
    // cloud mirror only adds peer-device rows behind them. Mirror cards for
    // a todo the store already knows drop by todo identity, even after the
    // store's completed card ages out of the short finished window.
    const overviewCards = normalizeOverviewTodoCards(data.todoOverview);
    const storeIdentities = collectOverviewTodoIdentities(data.todoOverview);
    overviewCards
      .map((card) => String(card.id).replace(/^todo-/, ""))
      .filter(Boolean)
      .forEach((identity) => storeIdentities.add(identity));
    const mirrorCards = normalizeTodoCards({ workspaceTodos: data.cachedWorkspaceTodos }, "")
      .filter((card) => !storeIdentities.has(
        String(card.id).replace(/^todo-dispatch-/, "").replace(/^todo-/, ""),
      ));
    return uniqueCards([...overviewCards, ...mirrorCards]);
  }, [data.cachedWorkspaceTodos, data.todoOverview]);
  const terminalTodoStates = useMemo(
    () => normalizeTerminalTodoStates({ workspaceTodos: data.cachedWorkspaceTodos }),
    [data.cachedWorkspaceTodos],
  );
  const transferCards = useMemo(
    () => normalizeTransferCards(data.library),
    [data.library],
  );
  // Just-finished cards stay pinned with the active work for a few seconds,
  // then settle into history. A UI-only tick re-renders exactly when the
  // soonest pin expires (no backend polling).
  const [pinTick, setPinTick] = useState(0);
  const stats = useMemo(
    () => summaryStats(todoCards, transferCards),
    [todoCards, transferCards],
  );

  // Recent dictation inputs, timestamped, with one-tap copy. The audio
  // widget window owns the history; this panel mirrors it live.
  const [dictationEntries, setDictationEntries] = useState(readDictationHistoryEntries);
  const [copiedDictationId, setCopiedDictationId] = useState("");
  const copiedDictationTimerRef = useRef(0);

  // Live take: the audio widget broadcasts phase + interim transcript while
  // recording/transcribing, so the incoming stream shows here in real time.
  const [dictationStream, setDictationStream] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let unlistenStream = null;
    listen(AUDIO_DICTATION_STREAM_EVENT, (event) => {
      if (cancelled) return;
      const payload = jsonObject(event?.payload) || {};
      if (!payload.active) {
        setDictationStream(null);
        return;
      }
      const phase = text(payload.phase) === "transcribing" ? "transcribing" : "listening";
      setDictationStream({
        atMs: numberValue(payload.atMs, Date.now()),
        phase,
        text: text(payload.text),
      });
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenStream = unlisten;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (unlistenStream) unlistenStream();
    };
  }, []);

  useEffect(() => {
    if (!dictationStream) {
      return undefined;
    }
    const expiresInMs = dictationStream.atMs + DICTATION_STREAM_STALE_MS - Date.now();
    if (expiresInMs <= 0) {
      setDictationStream(null);
      return undefined;
    }
    const timer = window.setTimeout(() => setDictationStream(null), expiresInMs + 30);
    return () => window.clearTimeout(timer);
  }, [dictationStream]);

  useEffect(() => {
    let cancelled = false;
    let unlistenResult = null;
    let reconcileTimer = 0;
    const reconcileDictationHistory = () => {
      if (cancelled) return;
      setDictationEntries((current) => mergeDictationHistoryEntries(readDictationHistoryEntries(), current));
    };
    const scheduleDictationHistoryReconcile = () => {
      if (reconcileTimer) {
        window.clearTimeout(reconcileTimer);
      }
      reconcileTimer = window.setTimeout(() => {
        reconcileTimer = 0;
        reconcileDictationHistory();
      }, 80);
    };
    listen(AUDIO_TRANSCRIPTION_RESULT_EVENT, (event) => {
      if (cancelled) return;
      setDictationEntries((current) => mergeDictationHistoryEntries([event?.payload], current));
      scheduleDictationHistoryReconcile();
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        unlistenResult = unlisten;
      })
      .catch(() => {});
    const handleStorage = (event) => {
      if (event.key === AUDIO_TRANSCRIPTION_HISTORY_STORAGE_KEY) {
        reconcileDictationHistory();
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      cancelled = true;
      if (reconcileTimer) {
        window.clearTimeout(reconcileTimer);
      }
      window.removeEventListener("storage", handleStorage);
      if (unlistenResult) unlistenResult();
    };
  }, []);

  useEffect(() => () => {
    if (copiedDictationTimerRef.current) {
      window.clearTimeout(copiedDictationTimerRef.current);
    }
  }, []);

  const copyDictationEntry = useCallback(async (entry) => {
    try {
      await navigator.clipboard.writeText(entry.text);
    } catch {
      return;
    }
    setCopiedDictationId(entry.id);
    window.clearTimeout(copiedDictationTimerRef.current);
    copiedDictationTimerRef.current = window.setTimeout(() => {
      setCopiedDictationId("");
    }, 1400);
  }, []);

  // Exit lifecycle: when an active row leaves, keep it around to celebrate
  // (pop/shake/fade on its glyph), then collapse it out of the list.
  const [exitRows, setExitRows] = useState([]);
  const prevTodoMapRef = useRef(new Map());
  const prevTransferMapRef = useRef(new Map());
  const exitTimersRef = useRef(new Map());

  useEffect(() => () => {
    exitTimersRef.current.forEach((timers) => timers.forEach((timer) => window.clearTimeout(timer)));
    exitTimersRef.current.clear();
  }, []);

  const beginExit = useCallback((card, exitState) => {
    const key = `exit-${card.id}`;
    setExitRows((current) => {
      if (current.some((row) => row.key === key)) {
        return current;
      }
      return [...current, { card, exitState, key, phase: "celebrate" }];
    });
    const collapseTimer = window.setTimeout(() => {
      setExitRows((current) => current.map((row) => (
        row.key === key ? { ...row, phase: "collapse" } : row
      )));
    }, EXIT_CELEBRATE_MS);
    const removeTimer = window.setTimeout(() => {
      setExitRows((current) => current.filter((row) => row.key !== key));
      exitTimersRef.current.delete(key);
    }, EXIT_CELEBRATE_MS + EXIT_COLLAPSE_MS + 60);
    exitTimersRef.current.set(key, [collapseTimer, removeTimer]);
  }, []);

  useEffect(() => {
    const nextMap = new Map(todoCards.map((card) => [card.id, card]));
    prevTodoMapRef.current.forEach((card, id) => {
      if (!nextMap.has(id)) {
        beginExit(card, terminalTodoStates.get(id) || "done");
      }
    });
    prevTodoMapRef.current = nextMap;
    // Active again (requeued): cancel a pending exit for the same id.
    setExitRows((current) => current.filter((row) => !nextMap.has(row.card.id)));
  }, [beginExit, terminalTodoStates, todoCards]);

  useEffect(() => {
    const nextMap = new Map(transferCards.map((card) => [card.id, card]));
    prevTransferMapRef.current.forEach((card, id) => {
      if (!nextMap.has(id)) {
        const state = statusKey(card.status);
        beginExit(card, state === "failed" ? "failed" : state === "stopped" ? "stopped" : "done");
      }
    });
    prevTransferMapRef.current = nextMap;
  }, [beginExit, transferCards]);

  // One unified, tier-ordered list: active work first (running todos, live
  // transfers, just-finished pins), then queued todos, then the mixed
  // history ledger (dictation, transfer outcomes, finished/listed todos)
  // by recency.
  const unifiedItems = useMemo(() => {
    void pinTick;
    const now = Date.now();
    const items = [...todoCards, ...transferCards].map((card) => ({
      card,
      key: card.id,
      sortTime: numberValue(card.updatedAt, 0),
      tier: activityCardTier(card, now),
      type: "card",
    }));
    dictationEntries.forEach((entry) => {
      items.push({
        entry,
        key: `dictation-${entry.id}`,
        sortTime: numberValue(entry.createdAt, 0),
        tier: 2,
        type: "dictation",
      });
    });
    return items.sort((left, right) => (
      (left.tier - right.tier) || (right.sortTime - left.sortTime)
    ));
  }, [dictationEntries, pinTick, todoCards, transferCards]);
  const activeItems = useMemo(
    () => unifiedItems.filter((item) => item.tier === 0),
    [unifiedItems],
  );
  const historyItems = useMemo(
    () => unifiedItems.filter((item) => item.tier > 0),
    [unifiedItems],
  );

  // Re-render when the soonest just-finished pin expires so those cards
  // drop into history on time.
  useEffect(() => {
    const expiries = activeItems
      .filter((item) => item.type === "card"
        && ["done", "failed", "stopped"].includes(statusKey(item.card.status)))
      .map((item) => item.sortTime + ACTIVE_FINISH_PIN_MS - Date.now())
      .filter((delay) => Number.isFinite(delay));
    if (!expiries.length) {
      return undefined;
    }
    const timer = window.setTimeout(
      () => setPinTick((current) => current + 1),
      Math.max(60, Math.min(...expiries) + 30),
    );
    return () => window.clearTimeout(timer);
  }, [activeItems]);

  const hasLiveDictation = Boolean(dictationStream);
  const hasActive = activeItems.length > 0 || exitRows.length > 0;
  const hasHistory = historyItems.length > 0;
  const hasWork = hasActive || hasHistory || hasLiveDictation;
  const statusToneName = data.errors.length
    ? "warn"
    : stats.transfers > 0
      ? "hot"
      : stats.queued > 0
        ? "warn"
        : stats.todos > 0
          ? "good"
          : "muted";
  const dragOverlayWindow = useCallback((event) => {
    if (event.button !== 0) {
      return;
    }

    runOverlayWindowAction((windowHandle) => windowHandle.startDragging());
  }, []);

  const renderRow = useCallback((card, exit = null) => {
    const kind = hudCardKind(card);
    const state = exit ? exit.exitState : statusKey(card.status);
    const isListedTodo = !exit && kind === "todo" && state === "listed";
    const tone = exit
      ? exit.exitState === "done" ? "good" : exit.exitState === "failed" ? "danger" : "muted"
      : isListedTodo
        ? "dot"
        : card.tone || statusTone(card.status);
    const isTransfer = card.lane === "transfers";
    const progress = clampPercent(card.progress ?? statusProgress(card.status));
    const detail = isTransfer ? "" : text(card.detail);
    const statusLabel = exit
      ? exit.exitState === "done" ? "done" : exit.exitState === "failed" ? "failed" : "stopped"
      : isTransfer
        ? isTerminalTransferStatus(state) ? state : firstText(card.meta, `${progress}%`)
        : text(card.eyebrow, "listed");
    return (
      <OverlayRow
        data-exit-phase={exit ? exit.phase : undefined}
        data-exit-state={exit ? exit.exitState : undefined}
        data-tauri-drag-region={embedded ? undefined : true}
        key={exit ? exit.key : card.id}
      >
        <RowGlyph
          celebrate={Boolean(exit)}
          kind={kind}
          status={exit ? exit.exitState : card.status}
          tone={tone}
        />
        <RowBody data-tauri-drag-region={embedded ? undefined : true}>
          <RowLine>
            <RowTitle>{card.title}</RowTitle>
            {detail ? <RowDetail>{detail}</RowDetail> : null}
            {!isListedTodo && <RowStatus data-tone={tone}>{statusLabel}</RowStatus>}
          </RowLine>
          {!exit && isTransfer && !isTerminalTransferStatus(state) ? (
            <RowTrack aria-hidden="true">
              <RowTrackFill data-tone={tone} style={{ width: `${progress}%` }} />
            </RowTrack>
          ) : null}
        </RowBody>
      </OverlayRow>
    );
  }, [embedded]);

  const renderDictationRow = useCallback((entry) => (
    <DictationRow
      data-tauri-drag-region={embedded ? undefined : true}
      key={`dictation-${entry.id}`}
    >
      <DictationTime title={entry.createdAt ? new Date(entry.createdAt).toLocaleString() : undefined}>
        {dictationClockLabel(entry.createdAt)}
      </DictationTime>
      <DictationText
        data-cancelled={entry.status === "cancelled" ? "true" : undefined}
        title={entry.text}
      >
        {entry.text}
      </DictationText>
      <DictationCopyButton
        aria-label="Copy transcript"
        data-copied={copiedDictationId === entry.id ? "true" : undefined}
        onClick={() => void copyDictationEntry(entry)}
        title="Copy transcript"
        type="button"
      >
        {copiedDictationId === entry.id ? (
          <svg
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.6"
            viewBox="0 0 16 16"
          >
            <path d="M3.5 8.4l3 3 6-6.8" />
          </svg>
        ) : (
          <svg
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.3"
            viewBox="0 0 16 16"
          >
            <rect height="8.2" rx="1.5" width="8.2" x="5.6" y="5.6" />
            <path d="M10.6 3H4.4A1.7 1.7 0 0 0 2.7 4.7V11" />
          </svg>
        )}
      </DictationCopyButton>
    </DictationRow>
  ), [copiedDictationId, copyDictationEntry, embedded]);

  return (
    <OverlayCard
      data-embedded={embedded ? "true" : undefined}
      data-tauri-drag-region={embedded ? undefined : true}
      data-tone={statusToneName}
      onMouseDown={embedded ? undefined : dragOverlayWindow}
    >
      <OverlayHeader data-tauri-drag-region={embedded ? undefined : true}>
        <HeaderDot data-live={hasWork ? "true" : "false"} data-tone={statusToneName} />
        <HeaderTitle>Activity</HeaderTitle>
        <HeaderSummary>{summaryLabel(stats)}</HeaderSummary>
      </OverlayHeader>

      <OverlayBody data-tauri-drag-region={embedded ? undefined : true} aria-live="polite">
        {hasLiveDictation && (
          <LiveStreamRow data-tauri-drag-region={embedded ? undefined : true}>
            <LiveStreamBadge>
              <LiveStreamDot aria-hidden="true" />
              {dictationStream.phase === "transcribing" ? "Transcribing" : "Streaming"}
            </LiveStreamBadge>
            <LiveStreamText>
              <span>
                {dictationStream.text
                  || (dictationStream.phase === "transcribing" ? "finalizing transcript…" : "listening…")}
              </span>
            </LiveStreamText>
          </LiveStreamRow>
        )}
        {hasActive && (
          <>
            <SectionLabel data-tauri-drag-region={embedded ? undefined : true}>Active</SectionLabel>
            {activeItems.map((item) => renderRow(item.card))}
            {exitRows.map((row) => renderRow(row.card, row))}
          </>
        )}
        {hasHistory && (
          <>
            <SectionLabel data-tauri-drag-region={embedded ? undefined : true}>History</SectionLabel>
            {historyItems.map((item) => (
              item.type === "dictation"
                ? renderDictationRow(item.entry)
                : renderRow(item.card)
            ))}
          </>
        )}
        {!hasWork && (
          <OverlayEmpty data-tauri-drag-region={embedded ? undefined : true}>
            <EmptyGlyph aria-hidden="true">
              <svg
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.3"
                viewBox="0 0 16 16"
              >
                <circle cx="8" cy="8" r="5.6" />
                <path d="M5.6 8.2l1.7 1.7 3.1-3.6" />
              </svg>
            </EmptyGlyph>
            <EmptyTitle>All clear</EmptyTitle>
            <EmptyHint>no todos queued · no assets syncing</EmptyHint>
          </OverlayEmpty>
        )}
      </OverlayBody>

      <OverlayFooter data-tauri-drag-region={embedded ? undefined : true}>
        <span>{data.errors.length ? "snapshot pending" : `updated ${timeAgo(data.updatedAt)}`}</span>
        <FooterSpacer />
        <span>{stats.queued ? `${stats.queued} queued` : "live"}</span>
      </OverlayFooter>
    </OverlayCard>
  );
}

export default function ActivityOverlayWindow() {
  return (
    <>
      <OverlayGlobalStyle />
      <OverlayShell>
        <ActivityOverlayPanel />
      </OverlayShell>
    </>
  );
}

const softPulse = keyframes`
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
`;

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const popIn = keyframes`
  0% { transform: scale(0.4); opacity: 0.2; }
  55% { transform: scale(1.35); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
`;

const shake = keyframes`
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-2px); }
  40% { transform: translateX(2px); }
  60% { transform: translateX(-1.5px); }
  80% { transform: translateX(1.5px); }
`;

const fadeDim = keyframes`
  0% { opacity: 1; }
  100% { opacity: 0.45; }
`;

const collapseOut = keyframes`
  0% { max-height: 32px; opacity: 1; transform: translateY(0); }
  100% { max-height: 0; opacity: 0; transform: translateY(8px); }
`;

const OverlayShell = styled.div`
  width: 100vw;
  height: 100vh;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  border-radius: 18px;
  background: transparent;
  clip-path: inset(0 round 18px);
`;

const OverlayCard = styled.main`
  width: 100%;
  height: 100%;
  max-width: 100vw;
  max-height: 100vh;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 12px 14px 9px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: var(--forge-text, #f4f7fa);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
  line-height: 1.2;
  background: linear-gradient(180deg, rgba(17, 18, 23, 0.92), rgba(9, 10, 13, 0.95));
  border: 1px solid rgba(255, 255, 255, 0.085);
  border-radius: 18px;
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
  clip-path: inset(0 round 18px);
  contain: paint;
  container-type: inline-size;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-app-region: drag;

  &[data-embedded="true"] {
    border: 0;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
    clip-path: none;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    cursor: default;
    -webkit-app-region: no-drag;
    max-width: 100%;
    max-height: 100%;
  }

  @media (max-width: 280px) {
    padding: 10px 10px 8px;
  }

  &[data-tone="danger"] {
    border-color: rgba(240, 127, 127, 0.26);
  }

  &[data-tone="warn"] {
    border-color: rgba(227, 169, 99, 0.22);
  }

  &[data-tone="hot"] {
    border-color: rgba(130, 173, 255, 0.2);
  }

  &:active {
    cursor: grabbing;
  }
`;

const OverlayHeader = styled.header`
  flex: 0 0 auto;
  min-width: 0;
  height: 16px;
  display: flex;
  align-items: center;
  gap: 7px;
  cursor: grab;
  -webkit-app-region: drag;

  &:active {
    cursor: grabbing;
  }
`;

const HeaderDot = styled.span`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: rgba(107, 116, 128, 0.9);

  &[data-tone="good"] {
    background: rgba(78, 213, 152, 0.95);
  }

  &[data-tone="warn"] {
    background: rgba(227, 169, 99, 0.95);
  }

  &[data-tone="hot"] {
    background: rgba(130, 173, 255, 0.95);
  }

  &[data-tone="danger"] {
    background: rgba(240, 127, 127, 0.95);
  }

  &[data-live="true"] {
    animation: ${softPulse} 1.8s ease-in-out infinite;
  }
`;

const HeaderTitle = styled.span`
  flex: 0 0 auto;
  color: rgba(235, 240, 247, 0.5);
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: 0.14em;
  line-height: 1;
  text-transform: uppercase;
`;

const HeaderSummary = styled.span`
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: rgba(160, 169, 181, 0.75);
  font-size: 10px;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const OverlayBody = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(148, 163, 184, 0.35) transparent;
  cursor: grab;
  -webkit-app-region: drag;

  &::-webkit-scrollbar {
    width: 4px;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.35);
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &:active {
    cursor: grabbing;
  }
`;

const OverlayRow = styled.div`
  flex: 0 0 auto;
  min-width: 0;
  height: 32px;
  max-height: 32px;
  overflow: hidden;

  &[data-exit-phase="collapse"] {
    animation: ${collapseOut} ${EXIT_COLLAPSE_MS}ms ease forwards;
  }

  &[data-exit-state="failed"][data-exit-phase="celebrate"] {
    animation: ${shake} 420ms ease;
  }
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  cursor: grab;
  -webkit-app-region: drag;

  & + & {
    border-top: 1px solid rgba(255, 255, 255, 0.045);
  }

  &:active {
    cursor: grabbing;
  }
`;

const GlyphBadge = styled.span`
  width: 16px;
  height: 16px;
  display: grid;
  place-items: center;
  color: rgba(130, 173, 255, 0.85);

  & > svg {
    width: 12px;
    height: 12px;
  }

  &[data-tone="good"] {
    color: rgba(78, 213, 152, 0.85);
  }

  &[data-tone="warn"] {
    color: rgba(227, 169, 99, 0.9);
  }

  &[data-tone="danger"] {
    color: rgba(240, 127, 127, 0.9);
  }

  &[data-tone="muted"] {
    color: rgba(107, 116, 128, 0.9);
  }

  /* Listed todos reuse the orchestrator todo list's solid blue dot color. */
  &[data-tone="dot"] {
    color: #8bb8ff;
  }

  &[data-spin="true"] > svg {
    animation: ${spin} 1.6s linear infinite;
  }

  &[data-celebrate="done"] > svg {
    animation: ${popIn} 480ms cubic-bezier(0.2, 1.4, 0.4, 1);
  }

  &[data-celebrate="failed"] > svg {
    animation: ${popIn} 360ms ease;
  }

  &[data-celebrate="stopped"] > svg {
    animation: ${fadeDim} 600ms ease forwards;
  }
`;

const RowBody = styled.div`
  min-width: 0;
  display: grid;
  align-content: center;
  gap: 4px;
`;

const RowLine = styled.div`
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;

  @container (max-width: 280px) {
    gap: 6px;
  }
`;

const RowTitle = styled.span`
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  color: rgba(240, 244, 249, 0.92);
  font-size: 11.5px;
  font-weight: 550;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowDetail = styled.span`
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  color: rgba(150, 158, 170, 0.6);
  font-size: 9.5px;
  font-weight: 500;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;

  @container (max-width: 260px) {
    display: none;
  }
`;

const RowStatus = styled.span`
  flex: 0 0 auto;
  margin-left: auto;
  /* Transfer meta ("1.2 MB / 4.0 MB") can outgrow a narrow panel; truncate
     instead of clipping past the card edge. */
  max-width: 55%;
  overflow: hidden;
  color: rgba(130, 173, 255, 0.85);
  font-size: 9.5px;
  font-weight: 620;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-overflow: ellipsis;
  text-transform: lowercase;
  white-space: nowrap;

  &[data-tone="good"] {
    color: rgba(78, 213, 152, 0.85);
  }

  &[data-tone="warn"] {
    color: rgba(227, 169, 99, 0.9);
  }

  &[data-tone="danger"] {
    color: rgba(240, 127, 127, 0.9);
  }

  &[data-tone="muted"] {
    color: rgba(107, 116, 128, 0.9);
  }
`;

const RowTrack = styled.div`
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.07);
`;

const RowTrackFill = styled.div`
  height: 100%;
  min-width: 4%;
  border-radius: inherit;
  background: rgba(130, 173, 255, 0.9);
  transition: width 240ms ease;

  &[data-tone="good"] {
    background: rgba(78, 213, 152, 0.9);
  }

  &[data-tone="warn"] {
    background: rgba(227, 169, 99, 0.9);
  }

  &[data-tone="danger"] {
    background: rgba(240, 127, 127, 0.9);
  }
`;

const SectionLabel = styled.span`
  flex: 0 0 auto;
  margin: 2px 0 1px;
  color: rgba(122, 132, 147, 0.55);
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.14em;
  line-height: 1;
  text-transform: uppercase;
`;

/* Live take banner pinned at the top of the panel: pulsing dot + phase
   badge, with the interim transcript clipped from the LEFT so the newest
   words stay visible as the stream grows. */
const LiveStreamRow = styled.div`
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 9px;
  min-width: 0;
  height: 30px;
  margin: 1px 0 2px;
  padding: 0 9px;
  overflow: hidden;
  border: 1px solid rgba(242, 85, 85, 0.28);
  border-radius: 9px;
  background: linear-gradient(180deg, rgba(242, 85, 85, 0.1), rgba(242, 85, 85, 0.04));
`;

const liveStreamPulse = keyframes`
  0%, 100% { opacity: 0.5; transform: scale(0.85); }
  50% { opacity: 1; transform: scale(1.12); }
`;

const LiveStreamDot = styled.span`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #f25555;
  animation: ${liveStreamPulse} 1.1s ease-in-out infinite;
`;

const LiveStreamBadge = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 5px;
  color: rgba(242, 120, 120, 0.95);
  font-size: 8.5px;
  font-weight: 800;
  letter-spacing: 0.12em;
  line-height: 1;
  text-transform: uppercase;
`;

const LiveStreamText = styled.div`
  display: flex;
  min-width: 0;
  justify-content: flex-end;
  overflow: hidden;

  & > span {
    color: rgba(240, 244, 249, 0.88);
    font-size: 11px;
    font-weight: 500;
    line-height: 1.15;
    white-space: nowrap;
  }
`;

const DictationRow = styled.div`
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  height: 28px;
  min-width: 0;
  overflow: hidden;
  cursor: grab;
  -webkit-app-region: drag;

  & + & {
    border-top: 1px solid rgba(255, 255, 255, 0.045);
  }

  &:active {
    cursor: grabbing;
  }
`;

const DictationTime = styled.span`
  flex: 0 0 auto;
  color: rgba(122, 132, 147, 0.7);
  font-size: 9.5px;
  font-weight: 620;
  font-variant-numeric: tabular-nums;
  line-height: 1;
`;

const DictationText = styled.span`
  min-width: 0;
  overflow: hidden;
  color: rgba(225, 231, 239, 0.85);
  font-size: 11px;
  font-weight: 500;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-cancelled="true"] {
    color: rgba(150, 158, 170, 0.6);
    text-decoration: line-through;
  }
`;

const DictationCopyButton = styled.button`
  display: grid;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: rgba(150, 158, 170, 0.75);
  background: transparent;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 120ms ease, color 120ms ease;

  & > svg {
    width: 12px;
    height: 12px;
  }

  &:hover {
    color: rgba(240, 244, 249, 0.95);
    background: rgba(255, 255, 255, 0.08);
  }

  &[data-copied="true"] {
    color: rgba(78, 213, 152, 0.95);
  }
`;

const OverlayEmpty = styled.div`
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
`;

const EmptyGlyph = styled.span`
  display: grid;
  place-items: center;
  color: rgba(107, 116, 128, 0.7);

  & > svg {
    width: 18px;
    height: 18px;
  }
`;

const EmptyTitle = styled.span`
  color: rgba(220, 226, 234, 0.78);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
`;

const EmptyHint = styled.span`
  max-width: 100%;
  padding: 0 8px;
  color: rgba(122, 132, 147, 0.6);
  font-size: 9.5px;
  font-weight: 500;
  line-height: 1.45;
  text-align: center;
`;

const OverlayFooter = styled.footer`
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 5px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  color: rgba(122, 132, 147, 0.65);
  cursor: grab;
  font-size: 9px;
  font-weight: 550;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  text-transform: lowercase;
  -webkit-app-region: drag;

  /* :first-child/:last-child skip the flexible FooterSpacer between them. */
  & > span:first-child,
  & > span:last-child {
    min-width: 0;
    flex: 0 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:active {
    cursor: grabbing;
  }
`;

const FooterSpacer = styled.span`
  flex: 1 1 auto;
`;

const OverlayGlobalStyle = createGlobalStyle`
  :root {
    --forge-bg: #07090d;
    --forge-bg-deep: #020304;
    --forge-surface: #0d1117;
    --forge-surface-raised: #11161d;
    --forge-surface-control: #151b23;
    --forge-border: rgba(230, 236, 245, 0.1);
    --forge-border-strong: rgba(230, 236, 245, 0.16);
    --forge-text: #f4f7fa;
    --forge-text-soft: #b6c0cc;
    --forge-text-muted: #7a8493;
    --forge-text-disabled: #505966;
    --forge-blue: #3b82f6;
    --forge-blue-soft: #7db0ff;
    --forge-amber: #dfa55a;
    --forge-green: #3ccb7f;
    --forge-red: #ef6b6b;
    color-scheme: dark;
  }

  html,
  body,
  #app {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 0;
    margin: 0;
    overflow: hidden;
    border-radius: 18px;
    background: transparent;
    clip-path: inset(0 round 18px);
  }

  body {
    color: var(--forge-text, #f4f7fa);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    letter-spacing: 0;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }

  * {
    box-sizing: border-box;
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
  }
`;

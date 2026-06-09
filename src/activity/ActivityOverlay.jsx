import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { createGlobalStyle, keyframes } from "styled-components";

export const ACTIVITY_OVERLAY_HASH = "#/activity-overlay";

const CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT = "cloud-mcp-workspace-todos-updated";
const CLOUD_MCP_WORKSPACE_ASSETS_UPDATED_EVENT = "cloud-mcp-workspace-assets-updated";

const REFRESH_INTERVAL_MS = 4500;
const REFRESH_DEBOUNCE_MS = 180;
const CARD_LIMIT = 6;
const VISIBLE_CARD_LIMIT = 4;
const RECENT_FINISHED_MS = 5 * 60 * 1000;
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

function readCachedWorkspaceTodos() {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    return jsonObject(window.localStorage.getItem(WORKSPACE_TODOS_CACHE_KEY)) || {};
  } catch {
    return {};
  }
}

function writeCachedWorkspaceTodos(value) {
  const workspaceTodos = jsonObject(value);
  if (typeof window === "undefined" || !workspaceTodos) {
    return;
  }
  try {
    window.localStorage.setItem(WORKSPACE_TODOS_CACHE_KEY, JSON.stringify(workspaceTodos));
  } catch {
    // Cache hydration is best-effort; the Rust mirror remains the source of truth.
  }
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
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

function collectionsByWorkspace(collection) {
  if (Array.isArray(collection)) {
    return collection.flatMap((entry) => collectionItems(entry));
  }
  const object = jsonObject(collection);
  if (!object) {
    return [];
  }
  return Object.values(object).flatMap((entry) => collectionItems(entry));
}

function workspaceTodoCollection(workspaceTodos, directKeys, byWorkspaceKeys) {
  const direct = directKeys.flatMap((key) => collectionItems(workspaceTodos?.[key]));
  const byWorkspace = byWorkspaceKeys.flatMap((key) => collectionsByWorkspace(workspaceTodos?.[key]));
  return [...direct, ...byWorkspace];
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

function todoDisplayStatus(item) {
  const status = statusKey(
    item?.todoStatus
      || item?.todo_status
      || item?.cloudStatus
      || item?.cloud_status
      || item?.status
      || item?.state,
    "listed",
  );
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

function normalizeTodoCards(status) {
  const workspaceTodos = workspaceTodosFromStatus(status);
  return uniqueCards(
    workspaceTodoCollection(
      workspaceTodos,
      ["items", "todos"],
      ["itemsByWorkspace", "items_by_workspace", "todosByWorkspace", "todos_by_workspace"],
    ).map((item, index) => {
      const object = jsonObject(item) || {};
      const status = todoDisplayStatus(object);
      if (!status || !isLocalTodo(object)) {
        return null;
      }
      const workspace = todoWorkspaceLabel(object);
      return {
        id: `todo-${todoIdentity(object, index)}`,
        detail: workspace,
        eyebrow: status,
        lane: "todos",
        meta: workspace,
        progress: status === "queued" ? 20 : 0,
        status,
        title: todoTitle(object, "Queued todo"),
        tone: status === "queued" ? "warn" : "good",
        updatedAt: todoUpdatedAt(object),
      };
    }).filter(Boolean),
  );
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

function isRecentlyFinishedTransfer(transfer) {
  const status = statusKey(transfer?.status || transfer?.transferStatus || transfer?.transfer_status, "active");
  const updatedAt = transferUpdatedAt(transfer);
  return status === "done" && updatedAt > 0 && Date.now() - updatedAt <= RECENT_FINISHED_MS;
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
  if (status === "done") {
    const updatedAt = transferActivityAt(transfer, asset);
    return updatedAt > 0 && Date.now() - updatedAt <= RECENT_FINISHED_MS;
  }
  return isOpenTransferStatus(transfer) || isRecentlyFinishedTransfer(transfer);
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
  return uniqueCards(cards);
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

function hudCardChip(card) {
  if (statusKey(card?.status) === "done") return "Done";
  const kind = hudCardKind(card);
  if (kind === "upload") return "Upload";
  if (kind === "download") return "Download";
  if (kind === "transfer") return "Sync";
  return text(card?.eyebrow, "Todo");
}

function activityCardPriority(card) {
  const status = statusKey(card?.status);
  const kind = hudCardKind(card);
  if (status === "active" && kind !== "todo") return 5;
  if (status === "queued") return 4;
  if (status === "done") return 3;
  if (kind !== "todo") return 2;
  return 1;
}

function selectActivityCards(todoCards, transferCards) {
  return [...todoCards, ...transferCards]
    .filter(Boolean)
    .sort((left, right) => {
      const rankDelta = activityCardPriority(right) - activityCardPriority(left);
      if (rankDelta !== 0) {
        return rankDelta;
      }
      return numberValue(right.updatedAt, 0) - numberValue(left.updatedAt, 0);
    })
    .slice(0, CARD_LIMIT);
}

function useActivityOverlayData() {
  const [state, setState] = useState({
    cachedWorkspaceTodos: readCachedWorkspaceTodos(),
    cloudStatus: null,
    errors: [],
    library: null,
    updatedAt: 0,
  });
  const refreshTimerRef = useRef(0);
  const refreshInFlightRef = useRef(false);

  const refresh = useCallback(async ({ localOnly = true } = {}) => {
    if (refreshInFlightRef.current) {
      return;
    }
    refreshInFlightRef.current = true;
    const cachedTodosPromise = invoke("cloud_mcp_get_cached_workspace_todos")
      .then((value) => {
        const cachedWorkspaceTodos = jsonObject(value) || {};
        writeCachedWorkspaceTodos(cachedWorkspaceTodos);
        setState((current) => ({
          ...current,
          cachedWorkspaceTodos,
          errors: current.errors.filter((entry) => entry !== "todos"),
          updatedAt: Date.now(),
        }));
        return cachedWorkspaceTodos;
      })
      .catch(() => {
        setState((current) => ({
          ...current,
          errors: Array.from(new Set([...current.errors, "todos"])),
          updatedAt: Date.now(),
        }));
        return null;
      });
    const [cloudStatusResult, libraryResult] = await Promise.allSettled([
      invoke("cloud_mcp_get_status"),
      invoke("cloud_mcp_list_workspace_assets", {
        includeAllWorkspaces: true,
        limit: 120,
        localOnly,
        repoPath: "",
      }),
    ]);
    const refreshedWorkspaceTodos = await cachedTodosPromise;
    refreshInFlightRef.current = false;
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
      const cachedWorkspaceTodos = refreshedWorkspaceTodos || current.cachedWorkspaceTodos;
      const cloudWorkspaceTodos = cloudStatusResult.status === "fulfilled"
        ? workspaceTodosFromStatus(cloudStatus)
        : {};
      const nextWorkspaceTodos = Object.keys(cloudWorkspaceTodos).length
        ? cloudWorkspaceTodos
        : cachedWorkspaceTodos;
      writeCachedWorkspaceTodos(nextWorkspaceTodos);
      return {
        ...current,
        cachedWorkspaceTodos: nextWorkspaceTodos,
        cloudStatus,
        errors,
        library: libraryResult.status === "fulfilled" ? libraryResult.value : current.library,
        updatedAt: Date.now(),
      };
    });
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
    let intervalId = 0;
    const unlisteners = [];
    const addListener = async (eventName, options = {}) => {
      try {
        const unlisten = await listen(eventName, () => {
          if (cancelled) {
            return;
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

    void refresh({ localOnly: true });
    intervalId = window.setInterval(() => {
      void refresh({ localOnly: true });
    }, REFRESH_INTERVAL_MS);

    void addListener(CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT);
    void addListener(CLOUD_MCP_WORKSPACE_ASSETS_UPDATED_EVENT, { refreshOptions: { localOnly: true } });

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
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
  }, [refresh, scheduleRefresh]);

  return state;
}

export default function ActivityOverlayWindow() {
  const data = useActivityOverlayData();
  const todoCards = useMemo(
    () => normalizeTodoCards({ workspaceTodos: data.cachedWorkspaceTodos }),
    [data.cachedWorkspaceTodos],
  );
  const transferCards = useMemo(
    () => normalizeTransferCards(data.library),
    [data.library],
  );
  const stats = useMemo(
    () => summaryStats(todoCards, transferCards),
    [todoCards, transferCards],
  );
  const activityCards = useMemo(
    () => selectActivityCards(todoCards, transferCards),
    [todoCards, transferCards],
  );
  const visibleCards = activityCards.slice(0, VISIBLE_CARD_LIMIT);
  const totalCount = todoCards.length + transferCards.length;
  const hiddenCount = Math.max(0, totalCount - visibleCards.length);
  const hasWork = totalCount > 0;
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
  const renderRow = useCallback((card) => {
    const kind = hudCardKind(card);
    const tone = card.tone || statusTone(card.status);
    const progress = clampPercent(card.progress ?? statusProgress(card.status));
    const chip = hudCardChip(card);
    return (
      <OverlayRow data-tauri-drag-region data-tone={tone} key={card.id}>
        <RowSignal aria-hidden="true" data-kind={kind} data-tone={tone} />
        <RowMain data-tauri-drag-region>
          <RowTitle>{card.title}</RowTitle>
          {card.lane === "transfers" ? (
            <RowProgress aria-hidden="true">
              <RowProgressFill data-kind={kind} data-tone={tone} style={{ width: `${progress}%` }} />
            </RowProgress>
          ) : null}
        </RowMain>
        <RowChip data-tone={tone}>{chip}</RowChip>
      </OverlayRow>
    );
  }, []);

  return (
    <>
      <OverlayGlobalStyle />
      <OverlayShell>
        <MinimalRoot
          data-tauri-drag-region
          data-tone={statusToneName}
          onMouseDown={dragOverlayWindow}
        >
          <OverlayBody data-tauri-drag-region aria-live="polite">
            {visibleCards.length ? visibleCards.map(renderRow) : (
              <ListEmpty data-tauri-drag-region>No local activity</ListEmpty>
            )}
          </OverlayBody>

          <MinimalFooter data-tauri-drag-region>
            <LiveDot data-active={hasWork ? "true" : "false"} />
            <span>{data.errors.length ? "snapshot pending" : "local only"}</span>
            <FooterSpacer />
            <span>{hiddenCount ? `+${hiddenCount} more` : `updated ${timeAgo(data.updatedAt)}`}</span>
          </MinimalFooter>
        </MinimalRoot>
      </OverlayShell>
    </>
  );
}

const softPulse = keyframes`
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
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

const MinimalRoot = styled.main`
  width: 100%;
  height: 100%;
  max-width: 100vw;
  max-height: 100vh;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 11px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--forge-text, #f4f7fa);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  letter-spacing: 0;
  line-height: 1.2;
  background:
    radial-gradient(circle at 60% 0%, rgba(255, 255, 255, 0.045), transparent 34%),
    linear-gradient(180deg, rgba(13, 15, 19, 0.94), rgba(5, 6, 8, 0.965)),
    rgba(5, 6, 8, 0.96);
  border: 1px solid rgba(240, 244, 248, 0.095);
  border-radius: 18px;
  box-shadow:
    0 14px 34px rgba(0, 0, 0, 0.22),
    inset 0 1px 0 rgba(255, 255, 255, 0.055),
    inset 0 -1px 0 rgba(0, 0, 0, 0.34);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  clip-path: inset(0 round 18px);
  contain: paint;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  -webkit-app-region: drag;

  &[data-tone="danger"] {
    border-color: rgba(239, 107, 107, 0.28);
  }

  &[data-tone="warn"] {
    border-color: rgba(223, 165, 90, 0.28);
  }

  &[data-tone="hot"] {
    border-color: rgba(125, 176, 255, 0.24);
  }

  &:active {
    cursor: grabbing;
  }
`;

const OverlayBody = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 4px;
  overflow: hidden;
  cursor: grab;
  -webkit-app-region: drag;

  &:active {
    cursor: grabbing;
  }
`;

const OverlayRow = styled.div`
  min-width: 0;
  height: 30px;
  display: grid;
  grid-template-columns: 7px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  cursor: grab;
  -webkit-app-region: drag;

  &:active {
    cursor: grabbing;
  }
`;

const RowSignal = styled.span`
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: rgba(125, 176, 255, 0.76);

  &[data-tone="good"] {
    background: rgba(60, 203, 127, 0.78);
  }

  &[data-tone="warn"] {
    background: rgba(223, 165, 90, 0.86);
  }
`;

const RowMain = styled.div`
  min-width: 0;
  display: grid;
  align-content: center;
  gap: 5px;
`;

const RowTitle = styled.div`
  min-width: 0;
  overflow: hidden;
  color: rgba(245, 247, 250, 0.82);
  font-size: 11px;
  font-weight: 650;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const RowChip = styled.div`
  max-width: 58px;
  overflow: hidden;
  padding: 3px 6px;
  border: 1px solid rgba(240, 244, 248, 0.08);
  border-radius: 5px;
  color: rgba(182, 192, 204, 0.58);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 9px;
  font-weight: 650;
  line-height: 1;
  text-overflow: ellipsis;
  text-transform: lowercase;
  white-space: nowrap;

  &[data-tone="good"] {
    color: rgba(60, 203, 127, 0.75);
    border-color: rgba(60, 203, 127, 0.16);
  }

  &[data-tone="warn"] {
    color: rgba(223, 165, 90, 0.78);
    border-color: rgba(223, 165, 90, 0.18);
  }

  &[data-tone="hot"] {
    color: rgba(125, 176, 255, 0.78);
    border-color: rgba(125, 176, 255, 0.18);
  }
`;

const RowProgress = styled.div`
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(230, 236, 245, 0.07);
`;

const RowProgressFill = styled.div`
  height: 100%;
  min-width: 5%;
  border-radius: inherit;
  background: rgba(125, 176, 255, 0.82);
  transition: width 180ms ease;

  &[data-tone="warn"] {
    background: rgba(223, 165, 90, 0.82);
  }
`;

const ListEmpty = styled.div`
  height: 52px;
  display: flex;
  align-items: center;
  color: rgba(122, 132, 147, 0.62);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 10px;
  font-weight: 560;
  line-height: 1;
`;

const MinimalFooter = styled.footer`
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 2px;
  color: var(--forge-text-muted, #7a8493);
  cursor: grab;
  font-size: 9px;
  font-weight: 600;
  line-height: 1;
  text-transform: lowercase;
  -webkit-app-region: drag;

  &:active {
    cursor: grabbing;
  }
`;

const LiveDot = styled.span`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--forge-text-disabled, #505966);

  &[data-active="true"] {
    background: var(--forge-blue-soft, #7db0ff);
    animation: ${softPulse} 1.2s ease-in-out infinite;
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

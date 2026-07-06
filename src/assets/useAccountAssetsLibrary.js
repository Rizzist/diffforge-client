import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { accountAssetFanoutFromValue } from "./accountAssetV2.js";

const ASSETS_UPDATED_EVENT = "cloud-mcp-account-assets-updated";
const DEFAULT_ASSET_LIBRARY_LIMIT = 500;
const ACCOUNT_ASSET_LIBRARY_KEY = "account";

function createAssetsLibraryState() {
  return {
    error: "",
    library: null,
    loading: true,
    syncing: false,
  };
}

const assetsLibraryStore = {
  initializedKeys: new Set(),
  listenerPromise: null,
  loadCachedPromise: null,
  refreshPromise: null,
  state: createAssetsLibraryState(),
  subscribers: new Set(),
  unlisten: null,
};

function updateAssetsLibraryStore(patchOrUpdater) {
  const previous = assetsLibraryStore.state;
  const patch = typeof patchOrUpdater === "function"
    ? patchOrUpdater(previous)
    : patchOrUpdater;
  assetsLibraryStore.state = {
    ...previous,
    ...(patch || {}),
  };
  assetsLibraryStore.subscribers.forEach((subscriber) => subscriber(assetsLibraryStore.state));
}

function subscribeAssetsLibraryStore(subscriber) {
  assetsLibraryStore.subscribers.add(subscriber);
  subscriber(assetsLibraryStore.state);
  return () => {
    assetsLibraryStore.subscribers.delete(subscriber);
  };
}

function assetLibraryErrorMessage(error) {
  return error?.message || String(error || "Unable to load assets.");
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(...values) {
  for (const value of values) {
    const next = String(value ?? "").trim();
    if (next) return next;
  }
  return "";
}

function assetLibraryPayload(value, depth = 0) {
  const object = jsonObject(value);
  if (!object || depth > 4) return object || {};
  const data = jsonObject(object.data);
  if (data) return assetLibraryPayload(data, depth + 1);
  const payload = jsonObject(object.payload);
  if (payload) return assetLibraryPayload(payload, depth + 1);
  return object;
}

function assetLocalPath(asset) {
  return text(asset?.localPath || asset?.local_path || asset?.path);
}

function assetRowShaped(asset) {
  return Boolean(jsonObject(asset) && text(asset?.assetId || asset?.asset_id || asset?.id));
}

function normalizedStatus(value) {
  return text(value).toLowerCase().replace(/[_\s.]+/gu, "-");
}

const LOCAL_UNAVAILABLE_STATUSES = new Set([
  "deleted",
  "local-deleted",
  "local-missing",
  "missing",
  "not-found",
  "unavailable",
]);

const CLOUD_AVAILABLE_STATUSES = new Set([
  "available",
  "cloud-available",
  "cloud-only",
  "complete",
  "completed",
  "ready",
  "synced",
  "uploaded",
]);

const CLOUD_UNAVAILABLE_STATUSES = new Set([
  "cloud-deleted",
  "cloud-deleted-local-kept",
  "deleted",
  "local-only",
  "missing",
  "not-found",
  "unavailable",
]);

const DOC_BACKED_ASSET_SOURCE_TOKENS = new Set([
  "account-document",
]);

const DOC_BACKED_ASSET_DOMAIN_TOKENS = new Set([
  "documents",
  "docs",
]);

const DOC_BACKED_ASSET_FOLDER_TOKENS = new Set([
  "account-documents",
]);

function assetIdText(asset) {
  if (typeof asset === "string") return text(asset);
  return text(asset?.assetId || asset?.asset_id || asset?.id);
}

function assetDeviceRows(asset) {
  return [
    ...jsonArray(asset?.devices),
    ...jsonArray(asset?.assetDevices),
    ...jsonArray(asset?.asset_devices),
    ...jsonArray(asset?.localCopies),
    ...jsonArray(asset?.local_copies),
    ...jsonArray(asset?.locations),
  ].filter((device) => device && typeof device === "object");
}

function assetDeviceLocalAvailable(device) {
  const explicit = device?.localAvailable ?? device?.local_available ?? device?.available;
  if (typeof explicit === "boolean") return explicit;
  const status = normalizedStatus(device?.localStatus || device?.local_status || device?.status || device?.availability);
  return ["available", "local-available", "present", "ready", "synced"].includes(status);
}

function assetCloudCopyAvailable(asset) {
  const cloudStates = [
    ...jsonArray(asset?.clouds),
    ...jsonArray(asset?.cloudStatuses),
    ...jsonArray(asset?.cloud_statuses),
  ];
  let sawUnavailableCloudState = false;
  for (const cloudState of cloudStates) {
    const explicit = cloudState?.cloudAvailable ?? cloudState?.cloud_available;
    if (explicit === true) return true;
    if (explicit === false) {
      sawUnavailableCloudState = true;
      continue;
    }
    const status = normalizedStatus(cloudState?.cloudStatus || cloudState?.cloud_status || cloudState?.status);
    if (CLOUD_AVAILABLE_STATUSES.has(status)) return true;
    if (CLOUD_UNAVAILABLE_STATUSES.has(status)) sawUnavailableCloudState = true;
  }
  if (sawUnavailableCloudState) return false;
  const explicit = asset?.cloudAvailable ?? asset?.cloud_available;
  if (typeof explicit === "boolean") return explicit;
  const status = normalizedStatus(
    asset?.cloudStatus || asset?.cloud_status || asset?.status || asset?.assetStatus || asset?.asset_status,
  );
  if (CLOUD_UNAVAILABLE_STATUSES.has(status)) return false;
  if (CLOUD_AVAILABLE_STATUSES.has(status)) return true;
  return Boolean(asset?.blobId || asset?.blob_id || asset?.objectKey || asset?.object_key);
}

function assetRemoteCopyAvailable(asset) {
  return assetDeviceRows(asset).some((device) => {
    if (!assetDeviceLocalAvailable(device)) return false;
    return !(
      device?.current
      || device?.isCurrent
      || device?.is_current
      || device?.currentDevice
      || device?.current_device
    );
  });
}

function removedAssetClearsOnlyLocal(removed) {
  const row = jsonObject(removed);
  if (!row) return false;
  if (row.cloudRemoved === true || row.cloud_removed === true) return false;
  const cloudStatus = normalizedStatus(
    row.cloudStatus || row.cloud_status || row.assetStatus || row.asset_status || row.status,
  );
  if (CLOUD_UNAVAILABLE_STATUSES.has(cloudStatus) && !LOCAL_UNAVAILABLE_STATUSES.has(cloudStatus)) {
    return false;
  }
  const localStatus = normalizedStatus(row.local_status || row.localStatus);
  if (LOCAL_UNAVAILABLE_STATUSES.has(localStatus)) return true;
  if (row.local_available === false || row.localAvailable === false) return true;
  const reason = normalizedStatus(row.delete_reason || row.deleteReason || row.reason);
  return reason.includes("local") && !reason.includes("cloud");
}

function assetLocalDeletedPatch(removed, assetId) {
  const patch = { ...(jsonObject(removed) || {}) };
  delete patch.deleted;
  delete patch.status;
  delete patch.assetStatus;
  delete patch.asset_status;
  delete patch.deleted_at;
  delete patch.deletedAt;
  return {
    ...patch,
    asset_id: assetId,
    assetId,
    id: assetId,
    local_available: false,
    localAvailable: false,
    local_path: "",
    localPath: "",
    path: "",
    local_status: "local_deleted",
    localStatus: "local_deleted",
    can_upload: false,
    canUpload: false,
  };
}

export function assetIdentityKeys(asset) {
  const keys = [];
  const add = (prefix, value) => {
    const key = text(value);
    if (key) keys.push(`${prefix}:${key.toLowerCase()}`);
  };
  const assetId = assetIdText(asset);
  if (assetId) {
    add("asset", assetId);
    return keys;
  }
  add("blob", asset?.blobId || asset?.blob_id);
  add("object", asset?.objectKey || asset?.object_key);
  const sha = text(asset?.sha256 || asset?.hash || asset?.contentHash || asset?.content_hash);
  const size = text(asset?.sizeBytes || asset?.size_bytes);
  if (sha && size) keys.push(`sha:${sha.toLowerCase()}:${size}`);
  add("local", asset?.localPath || asset?.local_path || asset?.path || asset?.localPathHint || asset?.local_path_hint);
  return keys;
}

function assetIncomingClearsLocal(incoming) {
  const incomingObject = jsonObject(incoming) || {};
  const localStatus = normalizedStatus(incomingObject.local_status || incomingObject.localStatus);
  if (LOCAL_UNAVAILABLE_STATUSES.has(localStatus)) return true;
  if (
    incomingObject.local_available === false
    || incomingObject.localAvailable === false
  ) {
    const hasPathKey = ["local_path", "localPath", "path"].some((key) => (
      Object.prototype.hasOwnProperty.call(incomingObject, key)
    ));
    return hasPathKey ? !assetLocalPath(incomingObject) : Boolean(localStatus);
  }
  return false;
}

function mergeAssetRows(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const clearsLocal = assetIncomingClearsLocal(incoming);
  const merged = { ...existing };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    const current = merged[key];
    const incomingText = typeof value === "string" ? value.trim() : "";
    const currentText = typeof current === "string" ? current.trim() : "";
    if ((value === null || value === undefined || incomingText === "") && currentText) {
      if (clearsLocal && ["local_path", "localPath", "path"].includes(key)) {
        merged[key] = "";
      }
      return;
    }
    if (["local_path", "localPath", "path"].includes(key) && !incomingText && !clearsLocal) {
      return;
    }
    if (
      ["local_status", "localStatus", "cloud_status", "cloudStatus"].includes(key)
      && ["", "unknown"].includes(normalizedStatus(incomingText))
      && currentText
    ) {
      return;
    }
    merged[key] = value;
  });
  if (clearsLocal) {
    merged.local_path = "";
    merged.localPath = "";
    merged.path = "";
    merged.local_available = false;
    merged.localAvailable = false;
    merged.local_status = text(incoming.local_status, incoming.localStatus, "local_deleted");
    merged.localStatus = merged.local_status;
    merged.can_upload = false;
    merged.canUpload = false;
  }
  return merged;
}

function dedupeAssetRows(items) {
  const byKey = new Map();
  const rows = [];
  jsonArray(items).forEach((item) => {
    if (!item || typeof item !== "object") return;
    const keys = assetIdentityKeys(item);
    const existingIndex = keys.map((key) => byKey.get(key)).find((index) => index !== undefined);
    if (existingIndex === undefined) {
      const index = rows.length;
      rows.push(item);
      keys.forEach((key) => byKey.set(key, index));
      return;
    }
    rows[existingIndex] = mergeAssetRows(rows[existingIndex], item);
    assetIdentityKeys(rows[existingIndex]).forEach((key) => byKey.set(key, existingIndex));
  });
  return rows;
}

function assetHiddenFromGenericLibrary(asset) {
  const metadata = jsonObject(asset?.metadata) || {};
  const sourceToken = text(
    asset?.sourceKind,
    asset?.source_kind,
    asset?.source,
    metadata.sourceKind,
    metadata.source_kind,
    metadata.source,
  ).toLowerCase().replace(/[._\s]+/gu, "-");
  const domainToken = text(
    asset?.docDomain,
    asset?.doc_domain,
    metadata.docDomain,
    metadata.doc_domain,
  ).toLowerCase().replace(/[._\s]+/gu, "-");
  const folderToken = text(
    asset?.assetFolder,
    asset?.asset_folder,
    asset?.folder,
    asset?.group,
    asset?.assetGroup,
    asset?.asset_group,
    metadata.assetFolder,
    metadata.asset_folder,
    metadata.folder,
    metadata.group,
    metadata.assetGroup,
    metadata.asset_group,
  ).toLowerCase().replace(/[._\s]+/gu, "-");
  return DOC_BACKED_ASSET_SOURCE_TOKENS.has(sourceToken)
    || DOC_BACKED_ASSET_DOMAIN_TOKENS.has(domainToken)
    || DOC_BACKED_ASSET_FOLDER_TOKENS.has(folderToken);
}

function hiddenAssetIdsFromItems(items) {
  const hiddenIds = new Set();
  jsonArray(items).forEach((item) => {
    if (!assetHiddenFromGenericLibrary(item)) return;
    const id = assetIdText(item);
    if (id) hiddenIds.add(id);
  });
  return hiddenIds;
}

function transferAssetIdText(transfer) {
  return text(transfer?.assetId || transfer?.asset_id);
}

const TERMINAL_TRANSFER_STATUSES = new Set([
  "completed",
  "failed",
  "interrupted",
  "cancelled",
  "canceled",
]);

function transferStatus(transfer) {
  return text(transfer?.status || transfer?.transferStatus || transfer?.transfer_status).toLowerCase();
}

function transferTerminal(transfer) {
  return TERMINAL_TRANSFER_STATUSES.has(transferStatus(transfer));
}

function transferCompleted(transfer) {
  return transferStatus(transfer) === "completed";
}

function transferUpdatedText(transfer) {
  return text(transfer?.updatedAt || transfer?.updated_at || transfer?.createdAt || transfer?.created_at);
}

function transferBytesDone(transfer) {
  const value = Number(transfer?.bytesDone ?? transfer?.bytes_done ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function transferFieldValue(row, camelKey, snakeKey = camelKey) {
  if (Object.prototype.hasOwnProperty.call(row || {}, camelKey)) return row[camelKey];
  if (Object.prototype.hasOwnProperty.call(row || {}, snakeKey)) return row[snakeKey];
  return undefined;
}

function applyTransferWinnerFields(merged, winner) {
  const status = transferFieldValue(winner, "status");
  if (status !== undefined) merged.status = status;
  const bytesDone = transferFieldValue(winner, "bytesDone", "bytes_done");
  if (bytesDone !== undefined) {
    merged.bytesDone = bytesDone;
    merged.bytes_done = bytesDone;
  }
  const bytesTotal = transferFieldValue(winner, "bytesTotal", "bytes_total");
  if (bytesTotal !== undefined) {
    merged.bytesTotal = bytesTotal;
    merged.bytes_total = bytesTotal;
  }
  const updatedAt = transferFieldValue(winner, "updatedAt", "updated_at");
  if (updatedAt !== undefined) {
    merged.updatedAt = updatedAt;
    merged.updated_at = updatedAt;
  }
  merged.error = transferFieldValue(winner, "error") ?? "";
  return merged;
}

function mergeTransferRows(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const merged = mergeAssetRows(existing, incoming);
  const existingTerminal = transferTerminal(existing);
  const incomingTerminal = transferTerminal(incoming);
  if (incomingTerminal && !existingTerminal) {
    return applyTransferWinnerFields(merged, incoming);
  }
  if (existingTerminal && !incomingTerminal) {
    return applyTransferWinnerFields(merged, existing);
  }
  if (incomingTerminal && existingTerminal) {
    const existingUpdated = transferUpdatedText(existing);
    const incomingUpdated = transferUpdatedText(incoming);
    if (
      existingUpdated > incomingUpdated
      || (existingUpdated === incomingUpdated && transferCompleted(existing) && !transferCompleted(incoming))
    ) {
      return applyTransferWinnerFields(merged, existing);
    }
    return applyTransferWinnerFields(merged, incoming);
  }
  const winner = transferBytesDone(existing) > transferBytesDone(incoming) ? existing : incoming;
  return applyTransferWinnerFields(merged, winner);
}

function dedupeTransferRows(transfers) {
  const byKey = new Map();
  const rows = [];
  jsonArray(transfers).forEach((transfer) => {
    if (!transfer || typeof transfer !== "object") return;
    const transferId = text(transfer.transferId || transfer.transfer_id || transfer.id);
    const cloudId = text(transfer.cloudId || transfer.cloud_id || transfer.assetCloudId || transfer.asset_cloud_id || "diffforge-ai-cloud");
    const key = transferId
      ? `transfer:${cloudId.toLowerCase()}:${transferId.toLowerCase()}`
      : [
        text(transfer.assetId || transfer.asset_id).toLowerCase(),
        cloudId.toLowerCase(),
        text(transfer.direction).toLowerCase(),
        text(transfer.status).toLowerCase(),
        text(transfer.updatedAt || transfer.updated_at || transfer.createdAt || transfer.created_at),
      ].join(":");
    if (!key || !key.replaceAll(":", "")) return;
    const existingIndex = byKey.get(key);
    if (existingIndex === undefined) {
      byKey.set(key, rows.length);
      rows.push(transfer);
      return;
    }
    rows[existingIndex] = mergeTransferRows(rows[existingIndex], transfer);
  });
  return rows;
}

function normalizeAssetsLibrary(library) {
  if (!library || typeof library !== "object") return library;
  const payload = assetLibraryPayload(library);
  const fanout = accountAssetFanoutFromValue(library);
  const directItems = jsonArray(payload.items).length
    ? jsonArray(payload.items)
    : jsonArray(payload.assets);
  const singularItems = [payload.asset, payload.item].filter(assetRowShaped);
  const allItems = dedupeAssetRows([
    ...(fanout?.items || []),
    ...directItems,
    ...singularItems,
  ]);
  const hiddenIds = hiddenAssetIdsFromItems(allItems);
  const items = allItems.filter((item) => !assetHiddenFromGenericLibrary(item));
  const transfers = dedupeTransferRows([
    ...(fanout?.transfers || []),
    ...jsonArray(payload.transfers),
  ]).filter((transfer) => !hiddenIds.has(transferAssetIdText(transfer)));
  const clouds = jsonArray(fanout?.clouds).length
    ? jsonArray(fanout.clouds)
    : jsonArray(payload.clouds).length
      ? jsonArray(payload.clouds)
      : jsonArray(payload.assetClouds).length
        ? jsonArray(payload.assetClouds)
        : jsonArray(payload.asset_clouds);
  return {
    ...payload,
    ...(fanout || {}),
    items,
    assets: items,
    clouds,
    assetClouds: clouds,
    asset_clouds: clouds,
    transfers,
    count: items.length,
  };
}

function mergeAssetsLibrarySnapshot(library, snapshot) {
  const normalizedSnapshot = normalizeAssetsLibrary(snapshot);
  if (!normalizedSnapshot) return library;
  const snapshotPayload = assetLibraryPayload(snapshot);
  const snapshotIsFull = Boolean(
    normalizedSnapshot?.snapshotFull
      || normalizedSnapshot?.snapshot_full
      || snapshotPayload?.snapshotFull
      || snapshotPayload?.snapshot_full
      || snapshotPayload?.source === "local_asset_library"
      || snapshotPayload?.kind === "account_assets",
  );
  if (!library || !normalizeAssetsLibrary(library)?.items?.length || snapshotIsFull) {
    return normalizedSnapshot;
  }
  const current = normalizeAssetsLibrary(library || {});
  const allItems = dedupeAssetRows([
    ...jsonArray(current?.items),
    ...jsonArray(normalizedSnapshot?.items),
  ]);
  const hiddenIds = hiddenAssetIdsFromItems(allItems);
  const nextItems = allItems.filter((item) => !assetHiddenFromGenericLibrary(item));
  const nextTransfers = dedupeTransferRows([
    ...jsonArray(current?.transfers),
    ...jsonArray(normalizedSnapshot?.transfers),
  ]).filter((transfer) => !hiddenIds.has(transferAssetIdText(transfer)));
  const clouds = jsonArray(normalizedSnapshot?.clouds).length
    ? jsonArray(normalizedSnapshot.clouds)
    : jsonArray(current?.clouds);
  return normalizeAssetsLibrary({
    ...(current || {}),
    ...(normalizedSnapshot || {}),
    items: nextItems,
    assets: nextItems,
    clouds,
    assetClouds: clouds,
    asset_clouds: clouds,
    transfers: nextTransfers,
  });
}

function mergeAssetsLibraryEvent(library, eventPayload) {
  const fanout = accountAssetFanoutFromValue(eventPayload);
  const payload = assetLibraryPayload(eventPayload);
  const normalizedEvent = normalizeAssetsLibrary(payload);
  const items = normalizedEvent?.items || fanout?.items || [];
  const transfers = normalizedEvent?.transfers || fanout?.transfers || [];
  const removedAssets = [
    ...jsonArray(fanout?.removedAssets || fanout?.removed_assets),
    ...jsonArray(payload?.removed_assets),
    ...jsonArray(payload?.removedAssets),
  ];
  if (!items.length && !transfers.length && !removedAssets.length) return library;
  const current = normalizeAssetsLibrary(library || {});
  const currentItems = jsonArray(current?.items);
  const currentItemsById = new Map(
    currentItems
      .map((item) => [assetIdText(item), item])
      .filter(([id]) => Boolean(id)),
  );
  const removedIds = new Set();
  const localDeletedItems = [];
  removedAssets.forEach((removed) => {
    const id = assetIdText(removed);
    if (!id) return;
    const existing = currentItemsById.get(id);
    if (
      existing
      && removedAssetClearsOnlyLocal(removed)
      && (assetCloudCopyAvailable(existing) || assetRemoteCopyAvailable(existing))
    ) {
      localDeletedItems.push(assetLocalDeletedPatch(removed, id));
      return;
    }
    removedIds.add(id);
  });
  const allItems = dedupeAssetRows([
    ...currentItems,
    ...items,
    ...localDeletedItems,
  ]);
  const hiddenIds = hiddenAssetIdsFromItems(allItems);
  const nextItems = allItems
    .filter((item) => !assetHiddenFromGenericLibrary(item))
    .filter((item) => !removedIds.has(text(item.assetId || item.asset_id || item.id)));
  const nextTransfers = dedupeTransferRows([
    ...jsonArray(current?.transfers),
    ...transfers,
  ])
    .filter((transfer) => !hiddenIds.has(transferAssetIdText(transfer)))
    .filter((transfer) => !removedIds.has(transferAssetIdText(transfer)));
  return normalizeAssetsLibrary({
    ...(current || {}),
    ...(fanout || {}),
    items: nextItems,
    assets: nextItems,
    transfers: nextTransfers,
  });
}

function assetLibraryRequestOptions({ localOnly = false } = {}) {
  return {
    limit: DEFAULT_ASSET_LIBRARY_LIMIT,
    localOnly,
  };
}

function loadCachedAssetsLibrary() {
  if (assetsLibraryStore.loadCachedPromise) {
    return assetsLibraryStore.loadCachedPromise;
  }

  assetsLibraryStore.loadCachedPromise = invoke(
    "cloud_mcp_list_account_assets",
    assetLibraryRequestOptions({ localOnly: true }),
  )
    .then((library) => {
      if (library) {
        updateAssetsLibraryStore((previous) => ({
          library: mergeAssetsLibrarySnapshot(previous.library, library),
        }));
      }
      return library;
    })
    .catch(() => null)
    .finally(() => {
      assetsLibraryStore.loadCachedPromise = null;
    });

  return assetsLibraryStore.loadCachedPromise;
}

function refreshAssetsLibrary({ silent = false, force = false } = {}) {
  if (assetsLibraryStore.refreshPromise && !force) {
    return assetsLibraryStore.refreshPromise;
  }

  if (!silent) {
    updateAssetsLibraryStore({ loading: true });
  }
  updateAssetsLibraryStore({ error: "", syncing: true });

  assetsLibraryStore.refreshPromise = invoke(
    "cloud_mcp_list_account_assets",
    assetLibraryRequestOptions(),
  )
    .then((library) => {
      updateAssetsLibraryStore((previous) => ({
        error: "",
        library: mergeAssetsLibrarySnapshot(previous.library, library),
        loading: false,
      }));
      return library;
    })
    .catch((error) => {
      updateAssetsLibraryStore((previous) => ({
        error: assetLibraryErrorMessage(error),
        loading: false,
        library: previous.library,
      }));
      return null;
    })
    .finally(() => {
      assetsLibraryStore.refreshPromise = null;
      updateAssetsLibraryStore({ syncing: false });
    });

  return assetsLibraryStore.refreshPromise;
}

export function adoptAccountAssetsLibraryEvent(eventPayload) {
  updateAssetsLibraryStore((previous) => ({
    library: mergeAssetsLibraryEvent(previous.library, eventPayload),
    loading: false,
  }));
}

function ensureAssetsLibraryListener() {
  if (assetsLibraryStore.unlisten || assetsLibraryStore.listenerPromise) {
    return;
  }

  assetsLibraryStore.listenerPromise = listen(ASSETS_UPDATED_EVENT, (event) => {
    updateAssetsLibraryStore((previous) => ({
      library: mergeAssetsLibraryEvent(previous.library, event?.payload),
      loading: false,
    }));
    void loadCachedAssetsLibrary();
  })
    .then((unlisten) => {
      assetsLibraryStore.unlisten = unlisten;
    })
    .catch(() => {})
    .finally(() => {
      assetsLibraryStore.listenerPromise = null;
    });
}

function startAssetsLibrarySync() {
  ensureAssetsLibraryListener();

  const key = ACCOUNT_ASSET_LIBRARY_KEY;
  if (assetsLibraryStore.initializedKeys.has(key)) {
    return Promise.resolve(assetsLibraryStore.state.library);
  }
  assetsLibraryStore.initializedKeys.add(key);

  return loadCachedAssetsLibrary()
    .finally(() => {
      updateAssetsLibraryStore({ loading: false });
      void refreshAssetsLibrary({ silent: true });
    });
}

export function useAccountAssetsLibrary() {
  const [state, setState] = useState(() => assetsLibraryStore.state);

  useEffect(() => subscribeAssetsLibraryStore(setState), []);

  useEffect(() => {
    void startAssetsLibrarySync();
  }, []);

  const loadCached = useCallback(() => loadCachedAssetsLibrary(), []);
  const refresh = useCallback((options = {}) => refreshAssetsLibrary(options), []);

  return {
    ...state,
    loadCached,
    refresh,
  };
}

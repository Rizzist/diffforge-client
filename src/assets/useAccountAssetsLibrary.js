import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const ASSETS_UPDATED_EVENT = "cloud-mcp-workspace-assets-updated";
const DEFAULT_ASSET_LIBRARY_LIMIT = 500;

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
  repoPath: "",
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

function text(value) {
  return String(value ?? "").trim();
}

export function assetIdentityKeys(asset) {
  const keys = [];
  const add = (prefix, value) => {
    const key = text(value);
    if (key) keys.push(`${prefix}:${key.toLowerCase()}`);
  };
  add("asset", asset?.assetId || asset?.asset_id || asset?.id);
  add("blob", asset?.blobId || asset?.blob_id);
  add("object", asset?.objectKey || asset?.object_key);
  const sha = text(asset?.sha256 || asset?.hash || asset?.contentHash || asset?.content_hash);
  const size = text(asset?.sizeBytes || asset?.size_bytes);
  if (sha && size) keys.push(`sha:${sha.toLowerCase()}:${size}`);
  add("local", asset?.localPath || asset?.local_path || asset?.path || asset?.localPathHint || asset?.local_path_hint);
  return keys;
}

function mergeAssetRows(existing, incoming) {
  if (!existing) return incoming;
  const merged = { ...existing };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    const current = merged[key];
    const incomingText = typeof value === "string" ? value.trim() : "";
    const currentText = typeof current === "string" ? current.trim() : "";
    if ((value === null || value === undefined || incomingText === "") && currentText) {
      return;
    }
    if (
      ["local_status", "localStatus", "cloud_status", "cloudStatus"].includes(key)
      && ["", "unknown"].includes(incomingText.toLowerCase())
      && currentText
    ) {
      return;
    }
    merged[key] = value;
  });
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
    rows[existingIndex] = mergeAssetRows(rows[existingIndex], transfer);
  });
  return rows;
}

function normalizeAssetsLibrary(library) {
  if (!library || typeof library !== "object") return library;
  const items = dedupeAssetRows(jsonArray(library.items).length ? library.items : library.assets);
  const transfers = dedupeTransferRows(library.transfers);
  const clouds = jsonArray(library.clouds).length
    ? jsonArray(library.clouds)
    : jsonArray(library.assetClouds).length
      ? jsonArray(library.assetClouds)
      : jsonArray(library.asset_clouds);
  return {
    ...library,
    items,
    assets: items,
    clouds,
    assetClouds: clouds,
    asset_clouds: clouds,
    transfers,
    count: items.length,
  };
}

function normalizeRepoPath(repoPath) {
  return String(repoPath || "").trim();
}

function resetAssetsLibraryStore(repoPath) {
  const nextRepoPath = normalizeRepoPath(repoPath);
  if (assetsLibraryStore.repoPath === nextRepoPath) {
    return;
  }

  assetsLibraryStore.repoPath = nextRepoPath;
  assetsLibraryStore.loadCachedPromise = null;
  assetsLibraryStore.refreshPromise = null;
  assetsLibraryStore.initializedKeys.clear();
  assetsLibraryStore.state = createAssetsLibraryState();
  assetsLibraryStore.subscribers.forEach((subscriber) => subscriber(assetsLibraryStore.state));
}

function assetLibraryRequestOptions(repoPath, { localOnly = false } = {}) {
  return {
    includeAllWorkspaces: true,
    limit: DEFAULT_ASSET_LIBRARY_LIMIT,
    localOnly,
    repoPath,
  };
}

function loadCachedAssetsLibrary() {
  if (assetsLibraryStore.loadCachedPromise) {
    return assetsLibraryStore.loadCachedPromise;
  }

  const requestRepoPath = assetsLibraryStore.repoPath;
  assetsLibraryStore.loadCachedPromise = invoke(
    "cloud_mcp_list_workspace_assets",
    assetLibraryRequestOptions(requestRepoPath, { localOnly: true }),
  )
    .then((library) => {
      if (library && assetsLibraryStore.repoPath === requestRepoPath) {
        updateAssetsLibraryStore({ library: normalizeAssetsLibrary(library) });
      }
      return library;
    })
    .catch(() => null)
    .finally(() => {
      if (assetsLibraryStore.repoPath === requestRepoPath) {
        assetsLibraryStore.loadCachedPromise = null;
      }
    });

  return assetsLibraryStore.loadCachedPromise;
}

function refreshAssetsLibrary({ silent = false, force = false } = {}) {
  if (assetsLibraryStore.refreshPromise && !force) {
    return assetsLibraryStore.refreshPromise;
  }

  const requestRepoPath = assetsLibraryStore.repoPath;
  if (!silent) {
    updateAssetsLibraryStore({ loading: true });
  }
  updateAssetsLibraryStore({ error: "", syncing: true });

  assetsLibraryStore.refreshPromise = invoke(
    "cloud_mcp_list_workspace_assets",
    assetLibraryRequestOptions(requestRepoPath),
  )
    .then((library) => {
      if (assetsLibraryStore.repoPath === requestRepoPath) {
        updateAssetsLibraryStore({
          error: "",
          library: normalizeAssetsLibrary(library),
          loading: false,
        });
      }
      return library;
    })
    .catch((error) => {
      if (assetsLibraryStore.repoPath === requestRepoPath) {
        updateAssetsLibraryStore((previous) => ({
          error: assetLibraryErrorMessage(error),
          loading: false,
          library: previous.library,
        }));
      }
      return null;
    })
    .finally(() => {
      if (assetsLibraryStore.repoPath === requestRepoPath) {
        assetsLibraryStore.refreshPromise = null;
        updateAssetsLibraryStore({ syncing: false });
      }
    });

  return assetsLibraryStore.refreshPromise;
}

function ensureAssetsLibraryListener() {
  if (assetsLibraryStore.unlisten || assetsLibraryStore.listenerPromise) {
    return;
  }

  assetsLibraryStore.listenerPromise = listen(ASSETS_UPDATED_EVENT, () => {
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

function startAssetsLibrarySync(repoPath) {
  resetAssetsLibraryStore(repoPath);
  ensureAssetsLibraryListener();

  const requestRepoPath = assetsLibraryStore.repoPath;
  const key = assetsLibraryStore.repoPath || "account";
  if (assetsLibraryStore.initializedKeys.has(key)) {
    return Promise.resolve(assetsLibraryStore.state.library);
  }
  assetsLibraryStore.initializedKeys.add(key);

  return loadCachedAssetsLibrary()
    .finally(() => {
      if (assetsLibraryStore.repoPath !== requestRepoPath) {
        return;
      }
      updateAssetsLibraryStore({ loading: false });
      void refreshAssetsLibrary({ silent: true });
    });
}

export function useAccountAssetsLibrary({ repoPath = "" } = {}) {
  const [state, setState] = useState(() => assetsLibraryStore.state);

  useEffect(() => subscribeAssetsLibraryStore(setState), []);

  useEffect(() => {
    void startAssetsLibrarySync(repoPath);
  }, [repoPath]);

  const loadCached = useCallback(() => loadCachedAssetsLibrary(), []);
  const refresh = useCallback((options = {}) => refreshAssetsLibrary(options), []);

  return {
    ...state,
    loadCached,
    refresh,
  };
}

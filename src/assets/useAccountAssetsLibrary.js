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
        updateAssetsLibraryStore({ library });
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
          library,
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

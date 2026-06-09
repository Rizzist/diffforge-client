import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const UNTRACKED_ASSETS_UPDATED_EVENT = "diffforge-untracked-assets-updated";
const DEFAULT_UNTRACKED_ASSET_LIMIT = 1000;

function createUntrackedAssetsState() {
  return {
    error: "",
    library: null,
    loading: true,
    syncing: false,
  };
}

const untrackedAssetsStore = {
  initialized: false,
  listenerPromise: null,
  refreshPromise: null,
  state: createUntrackedAssetsState(),
  subscribers: new Set(),
  unlisten: null,
  watcherPromise: null,
};

function updateUntrackedAssetsStore(patchOrUpdater) {
  const previous = untrackedAssetsStore.state;
  const patch = typeof patchOrUpdater === "function"
    ? patchOrUpdater(previous)
    : patchOrUpdater;
  untrackedAssetsStore.state = {
    ...previous,
    ...(patch || {}),
  };
  untrackedAssetsStore.subscribers.forEach((subscriber) => subscriber(untrackedAssetsStore.state));
}

function subscribeUntrackedAssetsStore(subscriber) {
  untrackedAssetsStore.subscribers.add(subscriber);
  subscriber(untrackedAssetsStore.state);
  return () => {
    untrackedAssetsStore.subscribers.delete(subscriber);
  };
}

function untrackedAssetsErrorMessage(error) {
  return error?.message || String(error || "Unable to load untracked assets.");
}

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function resultLibrary(value) {
  const object = jsonObject(value) || {};
  return jsonObject(object.library) || object;
}

function refreshUntrackedAssetsLibrary({ silent = false, force = false } = {}) {
  if (untrackedAssetsStore.refreshPromise && !force) {
    return untrackedAssetsStore.refreshPromise;
  }

  if (!silent) {
    updateUntrackedAssetsStore({ loading: true });
  }
  updateUntrackedAssetsStore({ error: "", syncing: true });

  untrackedAssetsStore.refreshPromise = invoke("diffforge_list_untracked_assets", {
    limit: DEFAULT_UNTRACKED_ASSET_LIMIT,
  })
    .then((library) => {
      updateUntrackedAssetsStore({
        error: "",
        library: resultLibrary(library),
        loading: false,
      });
      return library;
    })
    .catch((error) => {
      updateUntrackedAssetsStore((previous) => ({
        error: untrackedAssetsErrorMessage(error),
        library: previous.library,
        loading: false,
      }));
      return null;
    })
    .finally(() => {
      untrackedAssetsStore.refreshPromise = null;
      updateUntrackedAssetsStore({ syncing: false });
    });

  return untrackedAssetsStore.refreshPromise;
}

function ensureUntrackedAssetsListener() {
  if (untrackedAssetsStore.unlisten || untrackedAssetsStore.listenerPromise) {
    return;
  }

  untrackedAssetsStore.listenerPromise = listen(UNTRACKED_ASSETS_UPDATED_EVENT, () => {
    void refreshUntrackedAssetsLibrary({ silent: true, force: true });
  })
    .then((unlisten) => {
      untrackedAssetsStore.unlisten = unlisten;
    })
    .catch(() => {})
    .finally(() => {
      untrackedAssetsStore.listenerPromise = null;
    });
}

function ensureUntrackedAssetsWatcher() {
  if (untrackedAssetsStore.watcherPromise) {
    return untrackedAssetsStore.watcherPromise;
  }
  untrackedAssetsStore.watcherPromise = invoke("diffforge_start_untracked_assets_watcher")
    .catch(() => null);
  return untrackedAssetsStore.watcherPromise;
}

function startUntrackedAssetsLibrarySync() {
  ensureUntrackedAssetsListener();
  void ensureUntrackedAssetsWatcher();
  if (untrackedAssetsStore.initialized) {
    return Promise.resolve(untrackedAssetsStore.state.library);
  }
  untrackedAssetsStore.initialized = true;
  return refreshUntrackedAssetsLibrary({ silent: true });
}

async function runUntrackedMutation(command, payload) {
  updateUntrackedAssetsStore({ error: "", syncing: true });
  try {
    const result = await invoke(command, payload);
    updateUntrackedAssetsStore({
      error: "",
      library: resultLibrary(result),
      loading: false,
    });
    return result;
  } catch (error) {
    updateUntrackedAssetsStore((previous) => ({
      error: untrackedAssetsErrorMessage(error),
      library: previous.library,
      loading: false,
    }));
    throw error;
  } finally {
    updateUntrackedAssetsStore({ syncing: false });
  }
}

export function useUntrackedAssetsLibrary() {
  const [state, setState] = useState(() => untrackedAssetsStore.state);

  useEffect(() => subscribeUntrackedAssetsStore(setState), []);

  useEffect(() => {
    void startUntrackedAssetsLibrarySync();
  }, []);

  const refresh = useCallback((options = {}) => refreshUntrackedAssetsLibrary(options), []);
  const deleteAsset = useCallback((path) => (
    runUntrackedMutation("diffforge_delete_untracked_asset", { path })
  ), []);
  const renameAsset = useCallback((path, newName) => (
    runUntrackedMutation("diffforge_rename_untracked_asset", { newName, path })
  ), []);
  const promoteAsset = useCallback((payload) => (
    runUntrackedMutation("diffforge_promote_untracked_asset", {
      deleteSource: true,
      ...(payload || {}),
    })
  ), []);

  return {
    ...state,
    deleteAsset,
    loadCached: refresh,
    promoteAsset,
    refresh,
    renameAsset,
  };
}

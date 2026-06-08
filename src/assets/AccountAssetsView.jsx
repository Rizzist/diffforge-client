import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import styled, { keyframes } from "styled-components";
import { Cached } from "@styled-icons/material-rounded/Cached";
import { Cloud } from "@styled-icons/material-rounded/Cloud";
import { CloudUpload } from "@styled-icons/material-rounded/CloudUpload";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { FileDownload } from "@styled-icons/material-rounded/FileDownload";
import { InsertDriveFile } from "@styled-icons/material-rounded/InsertDriveFile";

const ASSETS_UPDATED_EVENT = "cloud-mcp-workspace-assets-updated";
const ASSET_IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
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

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function shortLabel(value, maxLength = 30) {
  const raw = text(value);
  if (raw.length <= maxLength) return raw;
  if (maxLength <= 3) return raw.slice(0, maxLength);
  return `${raw.slice(0, maxLength - 3)}...`;
}

function repoPathKey(value) {
  return text(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function assetLibraryItems(value) {
  const object = jsonObject(value) || {};
  const data = jsonObject(object.data) || object;
  return jsonArray(data.items).length ? jsonArray(data.items) : jsonArray(data.assets);
}

function assetLibraryTransfers(value) {
  const object = jsonObject(value) || {};
  const data = jsonObject(object.data) || object;
  return jsonArray(data.transfers);
}

function assetLibraryAggregate(value) {
  const object = jsonObject(value) || {};
  const data = jsonObject(object.data) || object;
  return jsonObject(data.aggregate) || {};
}

function assetId(asset, fallback = "") {
  return text(asset?.assetId || asset?.asset_id || asset?.id, fallback);
}

function assetName(asset, fallback = "asset") {
  return text(asset?.name || asset?.filename || asset?.fileName || asset?.file_name, fallback);
}

function assetKind(asset) {
  return text(asset?.kind || asset?.assetKind || asset?.asset_kind || asset?.mimeType || asset?.mime_type, "asset");
}

function assetStatusKind(status) {
  const normalized = text(status).toLowerCase().replace(/[_\s]+/gu, "-");
  if (["cloud-available", "uploaded", "complete", "completed", "ready", "synced"].includes(normalized)) return "done";
  if (["uploading", "downloading", "prepared", "preparing", "queued", "verifying", "committing", "transferring", "warming-cache", "cache-warming"].includes(normalized)) return "active";
  if (["failed", "error", "hash-mismatch", "interrupted"].includes(normalized)) return "failed";
  if (["deleted", "cloud-deleted-local-kept"].includes(normalized)) return "cancelled";
  if (["local-only", "local-available", "registered"].includes(normalized)) return "parked";
  return "queued";
}

function assetTransferStatusKind(transfer) {
  return assetStatusKind(transfer?.status || transfer?.transferStatus || transfer?.transfer_status);
}

function assetTransferAssetId(transfer) {
  return text(transfer?.assetId || transfer?.asset_id);
}

function assetTransferUpdatedAt(transfer) {
  const value = Date.parse(text(transfer?.updatedAt || transfer?.updated_at || transfer?.createdAt || transfer?.created_at));
  return Number.isFinite(value) ? value : 0;
}

function latestAssetTransfer(transfers, asset) {
  const id = assetId(asset);
  if (!id) return null;
  return transfers
    .filter((transfer) => assetTransferAssetId(transfer) === id)
    .sort((left, right) => assetTransferUpdatedAt(right) - assetTransferUpdatedAt(left))[0] || null;
}

function assetTransferDirection(transfer) {
  return text(transfer?.direction, "transfer").toLowerCase();
}

function assetTransferProgress(transfer) {
  const bytesTotal = Math.max(0, numberValue(transfer?.bytesTotal ?? transfer?.bytes_total));
  const bytesDone = Math.max(0, numberValue(transfer?.bytesDone ?? transfer?.bytes_done));
  const percent = bytesTotal > 0 ? Math.min(100, Math.max(0, (bytesDone / bytesTotal) * 100)) : null;
  return { bytesDone, bytesTotal, percent };
}

function formatBytes(value) {
  const bytes = Math.max(0, numberValue(value));
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = bytes / 1024;
  let unit = units[0];
  for (let index = 1; index < units.length && size >= 1024; index += 1) {
    size /= 1024;
    unit = units[index];
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${unit}`;
}

function assetTransferLabel(transfer) {
  const status = text(transfer?.status, "transferring").toLowerCase().replace(/[_-]+/gu, " ");
  const direction = assetTransferDirection(transfer);
  const progress = assetTransferProgress(transfer);
  if (assetTransferStatusKind(transfer) === "failed") {
    return `${direction === "download" ? "Download" : "Upload"} failed`;
  }
  const action = direction === "download" ? "Downloading" : direction === "upload" ? "Uploading" : status;
  if (progress.percent === null) return action;
  return `${action} ${Math.round(progress.percent)}% · ${formatBytes(progress.bytesTotal)}`;
}

function assetLocalPath(asset) {
  return text(asset?.localPath || asset?.local_path || asset?.path);
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

function assetAvailability(asset, syncing = false) {
  if (syncing) {
    return { hasCloud: false, hasLocal: true, label: "Local only", statusKind: "parked" };
  }
  const hasLocal = assetLocalAvailable(asset);
  const hasCloud = assetCloudAvailable(asset);
  if (hasLocal && hasCloud) return { hasCloud, hasLocal, label: "Local & Cloud", statusKind: "done" };
  if (hasCloud) return { hasCloud, hasLocal, label: "Cloud only", statusKind: "done" };
  if (hasLocal) return { hasCloud, hasLocal, label: "Local only", statusKind: "parked" };
  return { hasCloud, hasLocal, label: "Unavailable", statusKind: "failed" };
}

function assetMimeType(asset) {
  return text(asset?.mimeType || asset?.mime_type || asset?.contentType || asset?.content_type);
}

function assetFileExtension(asset) {
  const source = assetName(asset, "") || assetLocalPath(asset);
  const filename = source.split(/[\\/]/u).pop() || "";
  const match = filename.match(/\.([^.\\/]+)$/u);
  return text(match?.[1]).toLowerCase();
}

function assetIsImage(asset) {
  const mimeType = assetMimeType(asset).toLowerCase();
  const kind = assetKind(asset).toLowerCase();
  return mimeType.startsWith("image/")
    || kind === "image"
    || ASSET_IMAGE_EXTENSIONS.has(assetFileExtension(asset));
}

function assetPreviewUrl(asset) {
  const localPath = assetLocalPath(asset);
  if (!localPath || !assetIsImage(asset)) return "";
  try {
    return convertFileSrc(localPath);
  } catch {
    return "";
  }
}

function assetFileTypeLabel(asset) {
  const extension = assetFileExtension(asset);
  if (extension) return shortLabel(extension.toUpperCase(), 8);
  const kind = assetKind(asset);
  return kind === "asset" ? "FILE" : shortLabel(kind.toUpperCase(), 8);
}

function assetWorkspaceId(asset) {
  return text(asset?.workspaceId || asset?.workspace_id || asset?.workspace?.id);
}

function assetWorkspaceName(asset) {
  return text(asset?.workspaceName || asset?.workspace_name || asset?.workspace?.name);
}

function assetRepoPath(asset) {
  return text(asset?.repoPath || asset?.repo_path || asset?.workspaceRoot || asset?.workspace_root || asset?.rootPath || asset?.root_path);
}

function assetWorkspaceOptionKey(option) {
  const id = text(option?.id || option?.workspaceId || option?.workspace_id);
  if (id) return `id:${id}`;
  const name = text(option?.name || option?.workspaceName || option?.workspace_name);
  if (name) return `name:${name.toLowerCase()}`;
  const rootDirectory = text(option?.rootDirectory || option?.root_directory || option?.repoPath || option?.repo_path);
  if (rootDirectory) return `root:${repoPathKey(rootDirectory)}`;
  return "";
}

function assetWorkspaceOptionLabel(option) {
  return text(
    option?.name
      || option?.workspaceName
      || option?.workspace_name
      || option?.id
      || option?.workspaceId
      || option?.workspace_id,
    "Workspace",
  );
}

function assetMatchesWorkspaceOption(asset, option) {
  const optionId = text(option?.id || option?.workspaceId || option?.workspace_id);
  const optionName = text(option?.name || option?.workspaceName || option?.workspace_name);
  const optionRoot = text(option?.rootDirectory || option?.root_directory || option?.repoPath || option?.repo_path);
  const workspaceId = assetWorkspaceId(asset);
  const workspaceName = assetWorkspaceName(asset);
  const repoPath = assetRepoPath(asset);

  return Boolean(
    (optionId && workspaceId && optionId === workspaceId)
      || (optionName && workspaceName && optionName === workspaceName)
      || (optionRoot && repoPath && repoPathKey(optionRoot) === repoPathKey(repoPath)),
  );
}

function assetSha(asset) {
  return text(asset?.sha256 || asset?.hash || asset?.contentHash || asset?.content_hash);
}

export default function AccountAssetsView({
  assetWorkspaces = [],
  defaultWorkingDirectory = "",
  rootDirectory = "",
}) {
  const repoPath = rootDirectory || defaultWorkingDirectory || "";
  const [assetLibrary, setAssetLibrary] = useState(null);
  const [assetLibraryLoading, setAssetLibraryLoading] = useState(true);
  const [assetLibrarySyncCount, setAssetLibrarySyncCount] = useState(0);
  const [assetLibraryError, setAssetLibraryError] = useState("");
  const assetLibrarySyncing = assetLibrarySyncCount > 0;

  const loadCachedAssetLibrary = useCallback(() => (
    invoke("cloud_mcp_list_workspace_assets", {
      includeAllWorkspaces: true,
      limit: 500,
      localOnly: true,
      repoPath,
    }).catch(() => null)
  ), [repoPath]);

  const reloadCachedAssetLibrary = useCallback(() => (
    loadCachedAssetLibrary().then((result) => {
      if (result) setAssetLibrary(result);
      return result;
    })
  ), [loadCachedAssetLibrary]);

  const refreshAssetLibrary = useCallback(({ silent = false } = {}) => {
    if (!silent) setAssetLibraryLoading(true);
    setAssetLibrarySyncCount((current) => current + 1);
    setAssetLibraryError("");
    return invoke("cloud_mcp_list_workspace_assets", {
      includeAllWorkspaces: true,
      limit: 500,
      repoPath,
    })
      .then((result) => {
        setAssetLibrary(result);
        return result;
      })
      .catch((error) => {
        setAssetLibraryError(error?.message || String(error || "Unable to load assets."));
        return null;
      })
      .finally(() => {
        setAssetLibrarySyncCount((current) => Math.max(0, current - 1));
        if (!silent) setAssetLibraryLoading(false);
      });
  }, [repoPath]);

  useEffect(() => {
    let cancelled = false;
    void reloadCachedAssetLibrary()
      .finally(() => {
        if (cancelled) return;
        setAssetLibraryLoading(false);
        void refreshAssetLibrary({ silent: true });
      });
    return () => {
      cancelled = true;
    };
  }, [refreshAssetLibrary, reloadCachedAssetLibrary]);

  useEffect(() => {
    let cancelled = false;
    let unlistenAssets = null;
    listen(ASSETS_UPDATED_EVENT, () => {
      if (cancelled) return;
      void reloadCachedAssetLibrary();
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenAssets = unlisten;
    }).catch(() => {});

    return () => {
      cancelled = true;
      if (unlistenAssets) unlistenAssets();
    };
  }, [reloadCachedAssetLibrary]);

  return (
    <AssetsSurface aria-label="Account Assets" data-state={assetLibraryLoading ? "loading" : "ready"}>
      <AssetsPanel
        assetWorkspaces={assetWorkspaces}
        error={assetLibraryError}
        library={assetLibrary}
        loading={assetLibraryLoading}
        onLoadCached={reloadCachedAssetLibrary}
        onRefresh={refreshAssetLibrary}
        repoLabel="Assets"
        repoPath={repoPath}
        syncing={assetLibrarySyncing}
      />
    </AssetsSurface>
  );
}

function AssetsPanel({
  assetWorkspaces = [],
  error = "",
  library = null,
  loading = false,
  onLoadCached,
  onRefresh,
  repoLabel,
  repoPath,
  syncing = false,
}) {
  const items = useMemo(() => assetLibraryItems(library), [library]);
  const transfers = useMemo(() => assetLibraryTransfers(library), [library]);
  const aggregate = useMemo(() => assetLibraryAggregate(library), [library]);
  const [selectedWorkspaceFilterKeys, setSelectedWorkspaceFilterKeys] = useState([]);
  const [busyKey, setBusyKey] = useState("");
  const [actionError, setActionError] = useState("");

  const workspaceFilterOptions = useMemo(() => {
    const options = [];
    const seen = new Set();
    const seenNames = new Set();
    const seenRoots = new Set();
    const addOption = (option, fallbackOnly = false) => {
      const key = assetWorkspaceOptionKey(option);
      const nameKey = text(option?.name || option?.workspaceName || option?.workspace_name).toLowerCase();
      const rootKey = repoPathKey(option?.rootDirectory || option?.root_directory || option?.repoPath || option?.repo_path);
      if (!key || seen.has(key)) return;
      if (fallbackOnly && ((nameKey && seenNames.has(nameKey)) || (rootKey && seenRoots.has(rootKey)))) return;
      seen.add(key);
      if (nameKey) seenNames.add(nameKey);
      if (rootKey) seenRoots.add(rootKey);
      options.push({
        id: text(option?.id || option?.workspaceId || option?.workspace_id),
        key,
        name: assetWorkspaceOptionLabel(option),
        rootDirectory: text(option?.rootDirectory || option?.root_directory || option?.repoPath || option?.repo_path),
      });
    };

    assetWorkspaces.forEach((option) => addOption(option));
    items.forEach((asset) => {
      addOption({
        id: assetWorkspaceId(asset),
        name: assetWorkspaceName(asset),
        rootDirectory: assetRepoPath(asset),
      }, true);
    });

    return options;
  }, [assetWorkspaces, items]);
  const workspaceFilterOptionKeys = useMemo(
    () => new Set(workspaceFilterOptions.map((option) => option.key)),
    [workspaceFilterOptions],
  );

  useEffect(() => {
    setSelectedWorkspaceFilterKeys((current) => current.filter((key) => workspaceFilterOptionKeys.has(key)));
  }, [workspaceFilterOptionKeys]);

  const selectedWorkspaceFilterOptions = useMemo(() => (
    selectedWorkspaceFilterKeys
      .map((key) => workspaceFilterOptions.find((option) => option.key === key))
      .filter(Boolean)
  ), [selectedWorkspaceFilterKeys, workspaceFilterOptions]);
  const filteredItems = useMemo(() => {
    if (!selectedWorkspaceFilterOptions.length) return items;
    return items.filter((asset) => (
      selectedWorkspaceFilterOptions.some((option) => assetMatchesWorkspaceOption(asset, option))
    ));
  }, [items, selectedWorkspaceFilterOptions]);
  const visibleAssetIds = useMemo(
    () => new Set(filteredItems.map((asset) => assetId(asset)).filter(Boolean)),
    [filteredItems],
  );
  const visibleTransfers = useMemo(() => (
    selectedWorkspaceFilterOptions.length
      ? transfers.filter((transfer) => visibleAssetIds.has(text(transfer?.assetId || transfer?.asset_id)))
      : transfers
  ), [selectedWorkspaceFilterOptions.length, transfers, visibleAssetIds]);
  const cloudCount = filteredItems.filter((item) => assetAvailability(item, syncing).hasCloud).length;
  const localCount = filteredItems.filter((item) => assetAvailability(item, syncing).hasLocal).length;
  const activeTransfers = selectedWorkspaceFilterOptions.length
    ? visibleTransfers.filter((transfer) => assetTransferStatusKind(transfer) === "active").length
    : numberValue(aggregate.activeTransfers ?? aggregate.active_transfers, 0)
      || visibleTransfers.filter((transfer) => assetTransferStatusKind(transfer) === "active").length;
  const hasWorkspaceFilters = selectedWorkspaceFilterKeys.length > 0;
  const assetCountPluralBase = hasWorkspaceFilters ? items.length : filteredItems.length;

  const refresh = useCallback((options = { silent: true }) => (
    typeof onRefresh === "function" ? onRefresh(options) : Promise.resolve(null)
  ), [onRefresh]);

  useEffect(() => {
    if (!busyKey && !activeTransfers) return undefined;
    const loadCached = () => {
      if (typeof onLoadCached === "function") void onLoadCached();
    };
    loadCached();
    const interval = window.setInterval(loadCached, 250);
    return () => window.clearInterval(interval);
  }, [activeTransfers, busyKey, onLoadCached]);

  const workspaceOptionForAsset = useCallback((asset) => (
    workspaceFilterOptions.find((option) => assetMatchesWorkspaceOption(asset, option)) || null
  ), [workspaceFilterOptions]);

  const runAssetAction = useCallback((action, asset) => {
    const id = assetId(asset);
    const actionWorkspace = workspaceOptionForAsset(asset);
    const actionRepoPath = assetRepoPath(asset) || actionWorkspace?.rootDirectory || repoPath;
    const actionWorkspaceId = assetWorkspaceId(asset) || actionWorkspace?.id;
    const actionWorkspaceName = assetWorkspaceName(asset) || actionWorkspace?.name;
    if (!id || !actionRepoPath || !actionWorkspaceId) return;
    const key = `${action}:${id}`;
    setBusyKey(key);
    setActionError("");
    const command = action === "upload"
      ? "cloud_mcp_upload_workspace_asset"
      : action === "download"
        ? "cloud_mcp_download_workspace_asset"
        : action === "deleteLocal"
          ? "cloud_mcp_delete_local_workspace_asset"
          : "cloud_mcp_delete_cloud_workspace_asset";
    invoke(command, {
      assetId: id,
      deleteFile: action === "deleteLocal" ? true : undefined,
      repoPath: actionRepoPath,
      workspaceId: actionWorkspaceId,
      workspaceName: actionWorkspaceName,
    })
      .then(() => refresh({ silent: true }))
      .catch((nextError) => {
        setActionError(nextError?.message || String(nextError || `Unable to ${action} asset.`));
      })
      .finally(() => {
        setBusyKey((current) => (current === key ? "" : current));
      });
  }, [refresh, repoPath, workspaceOptionForAsset]);

  return (
    <AssetsPane>
      <AssetsHeader>
        <div>
          <AssetsKicker>Library</AssetsKicker>
          <AssetHeadingLine>
            <AssetsTitle>{repoLabel}</AssetsTitle>
            {syncing && (
              <AssetSyncPill aria-live="polite">
                <AssetSyncSpinner aria-hidden="true" />
                Syncing
              </AssetSyncPill>
            )}
          </AssetHeadingLine>
        </div>
        <AssetHeaderActions>
          <AssetsSummary>
            {filteredItems.length}{hasWorkspaceFilters ? ` / ${items.length}` : ""} asset{assetCountPluralBase === 1 ? "" : "s"} · {localCount} local · {cloudCount} cloud
            {activeTransfers ? ` · ${activeTransfers} active` : ""}
          </AssetsSummary>
          <AssetIconButton
            aria-label="Refresh assets"
            disabled={loading || syncing}
            onClick={() => refresh({ silent: false })}
            title="Refresh assets"
            type="button"
          >
            <Cached aria-hidden="true" />
          </AssetIconButton>
        </AssetHeaderActions>
      </AssetsHeader>
      {workspaceFilterOptions.length > 0 && (
        <AssetWorkspaceFilters aria-label="Asset workspace filters">
          <AssetFilterButton
            aria-pressed={!hasWorkspaceFilters}
            data-active={!hasWorkspaceFilters}
            onClick={() => setSelectedWorkspaceFilterKeys([])}
            title="Show all assets"
            type="button"
          >
            All
          </AssetFilterButton>
          {workspaceFilterOptions.map((option) => {
            const selected = selectedWorkspaceFilterKeys.includes(option.key);
            return (
              <AssetFilterButton
                aria-pressed={selected}
                data-active={selected}
                key={option.key}
                onClick={() => setSelectedWorkspaceFilterKeys((current) => (
                  current.includes(option.key)
                    ? current.filter((item) => item !== option.key)
                    : [...current, option.key]
                ))}
                title={option.name}
                type="button"
              >
                {option.name}
              </AssetFilterButton>
            );
          })}
        </AssetWorkspaceFilters>
      )}
      {(error || actionError) && <AssetError>{actionError || error}</AssetError>}
      {!filteredItems.length ? (
        <AssetEmptyState>{loading ? "Loading assets..." : hasWorkspaceFilters ? "No assets match those workspaces." : "No assets registered yet."}</AssetEmptyState>
      ) : (
        <AssetGrid aria-label="Asset library grid">
          {filteredItems.map((asset, index) => {
            const id = assetId(asset, `asset-${index}`);
            const name = assetName(asset, `Asset ${index + 1}`);
            const availability = assetAvailability(asset, syncing);
            const transfer = latestAssetTransfer(visibleTransfers, asset);
            const transferStatus = transfer ? assetTransferStatusKind(transfer) : "";
            const transferActive = transferStatus === "active";
            const transferFailed = transferStatus === "failed";
            const transferProgress = transfer ? assetTransferProgress(transfer) : null;
            const cardStatus = transferActive || transferFailed ? transferStatus : availability.statusKind;
            const localPath = assetLocalPath(asset);
            const previewUrl = assetPreviewUrl(asset);
            const rowWorkspaceOption = workspaceOptionForAsset(asset);
            const canRunAssetAction = Boolean(
              (assetRepoPath(asset) || rowWorkspaceOption?.rootDirectory || repoPath)
                && (assetWorkspaceId(asset) || rowWorkspaceOption?.id),
            );
            const uploadBusy = busyKey === `upload:${id}`;
            const downloadBusy = busyKey === `download:${id}`;
            const deleteLocalBusy = busyKey === `deleteLocal:${id}`;
            const deleteCloudBusy = busyKey === `deleteCloud:${id}`;
            const canUpload = canRunAssetAction && !transferActive && availability.hasLocal && !availability.hasCloud && Boolean(localPath);
            const canDownload = canRunAssetAction && !transferActive && availability.hasCloud && !availability.hasLocal;
            const canDeleteCloud = canRunAssetAction && !transferActive && availability.hasCloud;
            const canDeleteLocal = canRunAssetAction && !transferActive && availability.hasLocal && Boolean(localPath);

            return (
              <AssetCard data-status={cardStatus} key={id} title={localPath || assetSha(asset) || name}>
                <AssetCardPreview>
                  <AssetDocumentPreview aria-hidden={previewUrl ? "true" : undefined}>
                    <AssetDocumentGlyph>
                      <InsertDriveFile aria-hidden="true" />
                      <span>{assetFileTypeLabel(asset)}</span>
                    </AssetDocumentGlyph>
                  </AssetDocumentPreview>
                  {previewUrl && (
                    <AssetPreviewImage
                      alt={name}
                      decoding="async"
                      draggable={false}
                      loading={index < 20 ? "eager" : "lazy"}
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                      }}
                      src={previewUrl}
                    />
                  )}
                </AssetCardPreview>
                <AssetCardStatus data-status={availability.statusKind} title={`Availability: ${availability.label}`}>
                  {availability.label}
                </AssetCardStatus>
                <AssetCardActions>
                  {canUpload && (
                    <AssetIconButton
                      aria-label={`Upload ${name}`}
                      disabled={uploadBusy || Boolean(busyKey && !uploadBusy)}
                      onClick={() => runAssetAction("upload", asset)}
                      title="Upload to Cloud"
                      type="button"
                    >
                      <CloudUpload aria-hidden="true" />
                    </AssetIconButton>
                  )}
                  {canDownload && (
                    <AssetIconButton
                      aria-label={`Download ${name}`}
                      disabled={downloadBusy || Boolean(busyKey && !downloadBusy)}
                      onClick={() => runAssetAction("download", asset)}
                      title="Download asset"
                      type="button"
                    >
                      <FileDownload aria-hidden="true" />
                    </AssetIconButton>
                  )}
                  {canDeleteCloud && (
                    <AssetIconButton
                      aria-label={`Delete Cloud copy of ${name}`}
                      data-danger="true"
                      disabled={deleteCloudBusy || Boolean(busyKey && !deleteCloudBusy)}
                      onClick={() => runAssetAction("deleteCloud", asset)}
                      title="Delete Cloud copy"
                      type="button"
                    >
                      <Cloud aria-hidden="true" />
                    </AssetIconButton>
                  )}
                  {canDeleteLocal && (
                    <AssetIconButton
                      aria-label={`Delete local copy of ${name}`}
                      data-danger="true"
                      disabled={deleteLocalBusy || Boolean(busyKey && !deleteLocalBusy)}
                      onClick={() => runAssetAction("deleteLocal", asset)}
                      title="Delete local copy"
                      type="button"
                    >
                      <Delete aria-hidden="true" />
                    </AssetIconButton>
                  )}
                </AssetCardActions>
                <AssetCardCaption>
                  <AssetCardName>{name}</AssetCardName>
                </AssetCardCaption>
                {(transferActive || transferFailed) && (
                  <>
                    <AssetTransferLabel data-status={transferStatus}>
                      {assetTransferLabel(transfer)}
                    </AssetTransferLabel>
                    <AssetTransferTrack
                      aria-label={assetTransferLabel(transfer)}
                      aria-valuemax={transferProgress?.percent === null ? undefined : 100}
                      aria-valuenow={transferProgress?.percent === null ? undefined : Math.round(transferProgress.percent)}
                      data-indeterminate={transferProgress?.percent === null}
                      data-status={transferStatus}
                      role="progressbar"
                    >
                      <AssetTransferFill
                        data-indeterminate={transferProgress?.percent === null}
                        style={transferProgress?.percent === null ? undefined : { width: `${transferProgress.percent}%` }}
                      />
                    </AssetTransferTrack>
                  </>
                )}
              </AssetCard>
            );
          })}
        </AssetGrid>
      )}
    </AssetsPane>
  );
}

const AssetsSurface = styled.section`
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  color: var(--forge-text);
  background: var(--forge-bg);
`;

const AssetsPane = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  padding: 16px;
`;

const AssetsHeader = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;

  @media (max-width: 700px) {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
`;

const AssetsKicker = styled.div`
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
`;

const AssetsTitle = styled.strong`
  display: block;
  min-width: 0;
  overflow: hidden;
  font-size: 14px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AssetsSummary = styled.span`
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 820;
`;

const assetSyncSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const assetTransferSweep = keyframes`
  from {
    transform: translateX(-120%);
  }

  to {
    transform: translateX(360%);
  }
`;

const AssetHeadingLine = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  margin-top: 2px;
`;

const AssetSyncPill = styled.span`
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  min-height: 20px;
  padding: 0 7px;
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 7px;
  color: rgba(191, 219, 254, 0.86);
  background: rgba(30, 64, 175, 0.14);
  font-size: 8px;
  font-weight: 850;
  line-height: 1;
  text-transform: uppercase;
`;

const AssetSyncSpinner = styled.i`
  width: 9px;
  height: 9px;
  border: 2px solid rgba(191, 219, 254, 0.22);
  border-top-color: rgba(191, 219, 254, 0.9);
  border-radius: 50%;
  animation: ${assetSyncSpin} 720ms linear infinite;
`;

const AssetHeaderActions = styled.div`
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;

  @media (max-width: 700px) {
    width: 100%;
    justify-content: space-between;
  }
`;

const AssetWorkspaceFilters = styled.div`
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  max-height: 112px;
  overflow: auto;
  padding-bottom: 10px;
  padding-right: 2px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  scrollbar-width: thin;
`;

const AssetFilterButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 44px;
  max-width: 180px;
  min-height: 30px;
  padding: 0 10px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 7px;
  color: rgba(203, 213, 225, 0.78);
  background: rgba(15, 23, 42, 0.38);
  font: inherit;
  font-size: 10px;
  font-weight: 850;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  &:hover,
  &:focus-visible {
    border-color: rgba(125, 211, 252, 0.34);
    color: rgba(224, 242, 254, 0.94);
    background: rgba(14, 165, 233, 0.14);
  }

  &[data-active="true"] {
    border-color: rgba(45, 212, 191, 0.34);
    color: rgba(204, 251, 241, 0.96);
    background: rgba(13, 148, 136, 0.2);
  }
`;

const AssetGrid = styled.div`
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: repeat(auto-fill, minmax(148px, 176px));
  grid-auto-rows: max-content;
  gap: 10px;
  align-content: start;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 12px 2px 2px;
  border-top: 1px solid rgba(148, 163, 184, 0.12);

  @media (max-width: 520px) {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const AssetCard = styled.article`
  position: relative;
  aspect-ratio: 1;
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  color: var(--forge-text);
  background: rgba(2, 6, 23, 0.42);
  box-shadow: 0 8px 20px rgba(2, 6, 23, 0.14);
  transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;

  &:hover,
  &:focus-within {
    border-color: rgba(125, 211, 252, 0.36);
    box-shadow: 0 12px 28px rgba(2, 6, 23, 0.34);
    transform: translateY(-1px);

    [data-asset-actions="true"] {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }
  }

  &[data-status="active"] {
    border-color: rgba(96, 165, 250, 0.3);
  }

  &[data-status="failed"] {
    border-color: rgba(251, 113, 133, 0.28);
  }

  @media (hover: none) {
    [data-asset-actions="true"] {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }
  }
`;

const AssetCardPreview = styled.div`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: rgba(15, 23, 42, 0.44);
`;

const AssetDocumentPreview = styled.div`
  display: grid;
  place-items: center;
  width: 100%;
  min-width: 0;
  padding: 16px 14px 42px;
  color: rgba(203, 213, 225, 0.78);
`;

const AssetDocumentGlyph = styled.div`
  position: relative;
  width: 62px;
  height: 72px;

  svg {
    width: 100%;
    height: 100%;
    color: rgba(148, 163, 184, 0.34);
  }

  span {
    position: absolute;
    top: 32px;
    left: 50%;
    width: 36px;
    overflow: hidden;
    color: rgba(226, 232, 240, 0.86);
    font-size: 8px;
    font-weight: 900;
    line-height: 1;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
    transform: translateX(-50%);
  }
`;

const AssetPreviewImage = styled.img`
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 7px 7px 34px;
  object-fit: contain;
  object-position: center;
  background: rgba(2, 6, 23, 0.7);
`;

const AssetCardStatus = styled.span`
  position: absolute;
  top: 7px;
  left: 7px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  max-width: calc(100% - 78px);
  overflow: hidden;
  padding: 3px 6px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 6px;
  color: rgba(203, 213, 225, 0.74);
  background: rgba(2, 6, 23, 0.84);
  font-size: 8px;
  font-weight: 850;
  line-height: 1;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
  backdrop-filter: blur(8px);

  &[data-status="done"] {
    border-color: rgba(52, 211, 153, 0.22);
    color: rgba(167, 243, 208, 0.86);
  }

  &[data-status="active"] {
    border-color: rgba(96, 165, 250, 0.24);
    color: rgba(191, 219, 254, 0.88);
  }

  &[data-status="parked"] {
    border-color: rgba(245, 158, 11, 0.22);
    color: rgba(253, 230, 138, 0.84);
  }

  &[data-status="failed"],
  &[data-status="cancelled"] {
    border-color: rgba(251, 113, 133, 0.24);
    color: rgba(254, 205, 211, 0.86);
  }
`;

const AssetCardActions = styled.div.attrs({ "data-asset-actions": "true" })`
  position: absolute;
  top: 7px;
  right: 7px;
  z-index: 4;
  display: grid;
  grid-template-columns: repeat(2, 28px);
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-3px);
  transition: opacity 130ms ease, transform 130ms ease;

  button {
    width: 28px;
    height: 28px;
    background: rgba(2, 6, 23, 0.88);
    backdrop-filter: blur(8px);
  }
`;

const AssetCardCaption = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2;
  min-width: 0;
  padding: 18px 8px 7px;
  background: linear-gradient(180deg, transparent, rgba(2, 6, 23, 0.94) 42%);
  pointer-events: none;
`;

const AssetTransferLabel = styled.span`
  position: absolute;
  right: 7px;
  bottom: 29px;
  left: 7px;
  z-index: 5;
  overflow: hidden;
  color: rgba(219, 234, 254, 0.94);
  font-size: 8px;
  font-weight: 850;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  text-shadow: 0 1px 3px rgba(2, 6, 23, 0.95);

  &[data-status="failed"] {
    color: rgba(254, 205, 211, 0.96);
  }
`;

const AssetTransferTrack = styled.div`
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 6;
  height: 5px;
  overflow: hidden;
  background: rgba(30, 41, 59, 0.92);
  pointer-events: none;

  &[data-status="failed"] {
    background: rgba(127, 29, 29, 0.82);
  }
`;

const AssetTransferFill = styled.i`
  display: block;
  width: 0;
  height: 100%;
  background: rgba(96, 165, 250, 0.96);
  box-shadow: 0 0 8px rgba(96, 165, 250, 0.72);
  transition: width 180ms ease;

  &[data-indeterminate="true"] {
    width: 34%;
    animation: ${assetTransferSweep} 1s ease-in-out infinite;
  }

  ${AssetTransferTrack}[data-status="failed"] & {
    width: 100%;
    background: rgba(251, 113, 133, 0.92);
    box-shadow: none;
  }
`;

const AssetCardName = styled.strong`
  display: block;
  min-width: 0;
  overflow: hidden;
  color: rgba(241, 245, 249, 0.94);
  font-size: 10px;
  font-weight: 850;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const AssetIconButton = styled.button`
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 7px;
  color: rgba(226, 232, 240, 0.84);
  background: rgba(15, 23, 42, 0.5);
  font: inherit;
  cursor: pointer;

  svg {
    width: 16px;
    height: 16px;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(125, 211, 252, 0.34);
    color: rgba(224, 242, 254, 0.94);
    background: rgba(14, 165, 233, 0.14);
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }

  &[data-danger="true"] {
    border-color: rgba(251, 113, 133, 0.18);
    color: rgba(254, 205, 211, 0.86);
    background: rgba(127, 29, 29, 0.16);

    &:hover:not(:disabled),
    &:focus-visible {
      border-color: rgba(251, 113, 133, 0.32);
      background: rgba(190, 18, 60, 0.18);
    }
  }
`;

const AssetError = styled.div`
  padding: 8px 10px;
  border: 1px solid rgba(248, 113, 113, 0.22);
  border-radius: 8px;
  color: rgba(254, 202, 202, 0.92);
  background: rgba(127, 29, 29, 0.12);
  font-size: 10px;
  font-weight: 760;
  line-height: 1.35;
  overflow-wrap: anywhere;
`;

const AssetEmptyState = styled.div`
  display: grid;
  flex: 1 1 auto;
  place-items: center;
  min-height: 0;
  padding: 20px;
  border: 1px dashed rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  color: var(--forge-text-muted);
  font-size: 13px;
  font-weight: 760;
`;

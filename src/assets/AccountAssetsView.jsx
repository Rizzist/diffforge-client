import { useCallback, useEffect, useMemo, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import styled, { keyframes } from "styled-components";
import { AddToPhotos } from "@styled-icons/material-rounded/AddToPhotos";
import { Cached } from "@styled-icons/material-rounded/Cached";
import { CheckBox } from "@styled-icons/material-rounded/CheckBox";
import { CheckBoxOutlineBlank } from "@styled-icons/material-rounded/CheckBoxOutlineBlank";
import { Cloud } from "@styled-icons/material-rounded/Cloud";
import { CloudUpload } from "@styled-icons/material-rounded/CloudUpload";
import { ContentCopy } from "@styled-icons/material-rounded/ContentCopy";
import { Close } from "@styled-icons/material-rounded/Close";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { DriveFileRenameOutline } from "@styled-icons/material-rounded/DriveFileRenameOutline";
import { FileDownload } from "@styled-icons/material-rounded/FileDownload";
import { FileOpen } from "@styled-icons/material-rounded/FileOpen";
import { InsertDriveFile } from "@styled-icons/material-rounded/InsertDriveFile";
import { ModeEdit } from "@styled-icons/material-rounded/ModeEdit";
import { MoveToInbox } from "@styled-icons/material-rounded/MoveToInbox";
import { OpenInFull } from "@styled-icons/material-rounded/OpenInFull";
import { Settings } from "@styled-icons/material-rounded/Settings";
import HyperframeEditor, {
  assetCanContainHyperframe,
  assetLooksLikeHyperframe,
  loadHyperframeAsset,
} from "./HyperframeEditor.jsx";

const ASSET_IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const DEFAULT_ASSET_CLOUD_ID = "diffforge-ai-cloud";

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

function assetLibraryClouds(value) {
  const object = jsonObject(value) || {};
  const data = jsonObject(object.data) || object;
  const direct = jsonArray(data.clouds).length
    ? jsonArray(data.clouds)
    : jsonArray(data.assetClouds).length
      ? jsonArray(data.assetClouds)
      : jsonArray(data.asset_clouds);
  const byId = new Map();
  const add = (cloud) => {
    if (!cloud || typeof cloud !== "object") return;
    const id = text(cloud.cloudId || cloud.cloud_id || cloud.id);
    if (!id || byId.has(id)) return;
    byId.set(id, {
      ...cloud,
      cloudId: id,
      cloud_id: id,
      label: text(cloud.label || cloud.name, id === DEFAULT_ASSET_CLOUD_ID ? "Diff Forge AI Cloud" : id),
      providerKind: text(cloud.providerKind || cloud.provider_kind || cloud.provider, id === DEFAULT_ASSET_CLOUD_ID ? "diffforge" : "s3"),
    });
  };
  direct.forEach(add);
  assetLibraryItems(value).forEach((asset) => {
    jsonArray(asset?.registeredClouds).forEach(add);
    jsonArray(asset?.registered_clouds).forEach(add);
    jsonArray(asset?.clouds).forEach(add);
  });
  if (!byId.has(DEFAULT_ASSET_CLOUD_ID)) {
    add({
      cloudId: DEFAULT_ASSET_CLOUD_ID,
      cloud_id: DEFAULT_ASSET_CLOUD_ID,
      label: "Diff Forge AI Cloud",
      providerKind: "diffforge",
      provider_kind: "diffforge",
      defaultCloud: true,
      default_cloud: true,
      builtin: true,
      status: "active",
    });
  }
  return [...byId.values()];
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

function assetTransferDeviceName(transfer) {
  const device = transfer?.device && typeof transfer.device === "object" ? transfer.device : {};
  return text(
    device.displayName
      || device.display_name
      || device.deviceName
      || device.device_name
      || transfer?.deviceName
      || transfer?.device_name
      || device.machineName
      || device.machine_name
      || transfer?.machineName
      || transfer?.machine_name
      || device.deviceId
      || device.device_id
      || transfer?.deviceId
      || transfer?.device_id,
    "device",
  );
}

function assetTransferDeviceSummary(transfers) {
  const seen = new Set();
  const labels = [];
  transfers.forEach((transfer) => {
    if (assetTransferStatusKind(transfer) !== "active") return;
    const direction = text(transfer?.direction, "syncing").toLowerCase();
    const device = assetTransferDeviceName(transfer);
    const label = `${direction} on ${device}`;
    const key = label.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      labels.push(label);
    }
  });
  if (labels.length <= 2) return labels.join(" · ");
  return `${labels.slice(0, 2).join(" · ")} · +${labels.length - 2} more`;
}

function assetTransferCloudId(transfer) {
  return text(transfer?.cloudId || transfer?.cloud_id || transfer?.assetCloudId || transfer?.asset_cloud_id, DEFAULT_ASSET_CLOUD_ID);
}

function latestAssetTransfer(transfers, asset, cloudId = DEFAULT_ASSET_CLOUD_ID) {
  const id = assetId(asset);
  if (!id) return null;
  const selectedCloud = text(cloudId, DEFAULT_ASSET_CLOUD_ID);
  return transfers
    .filter((transfer) => assetTransferAssetId(transfer) === id && assetTransferCloudId(transfer) === selectedCloud)
    .sort((left, right) => assetTransferUpdatedAt(right) - assetTransferUpdatedAt(left))[0] || null;
}

function assetTransferId(transfer) {
  return text(transfer?.transferId || transfer?.transfer_id || transfer?.id);
}

function assetTransferPercent(transfer) {
  const total = Number(transfer?.bytesTotal ?? transfer?.bytes_total ?? 0) || 0;
  const done = Number(transfer?.bytesDone ?? transfer?.bytes_done ?? 0) || 0;
  if (total <= 0) return done > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function assetTransferDirectionLabel(transfer) {
  const direction = text(transfer?.direction).toLowerCase();
  if (direction.includes("upload")) return "Uploading";
  if (direction.includes("download")) return "Downloading";
  return "Syncing";
}

function assetSyncedDeviceNames(asset) {
  const seen = new Set();
  const names = [];
  jsonArray(asset?.devices).forEach((device) => {
    const status = text(device?.localStatus || device?.local_status).toLowerCase();
    if (status !== "local_available") return;
    const name = text(device?.deviceName || device?.device_name)
      || text(device?.deviceId || device?.device_id);
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  });
  return names;
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

function assetCloudState(asset, cloudId = DEFAULT_ASSET_CLOUD_ID) {
  const selectedCloud = text(cloudId, DEFAULT_ASSET_CLOUD_ID);
  const maps = [
    jsonObject(asset?.cloudStatusByCloud),
    jsonObject(asset?.cloud_status_by_cloud),
  ].filter(Boolean);
  for (const map of maps) {
    if (map[selectedCloud]) return jsonObject(map[selectedCloud]) || map[selectedCloud];
  }
  const rows = [
    ...jsonArray(asset?.clouds),
    ...jsonArray(asset?.cloudStatuses),
    ...jsonArray(asset?.cloud_statuses),
  ];
  return rows.find((row) => text(row?.cloudId || row?.cloud_id || row?.id) === selectedCloud) || null;
}

function assetCloudAvailable(asset, cloudId = DEFAULT_ASSET_CLOUD_ID) {
  const cloudState = assetCloudState(asset, cloudId);
  if (cloudState) {
    const explicit = cloudState.cloudAvailable ?? cloudState.cloud_available;
    if (typeof explicit === "boolean") return explicit;
    const stateStatus = text(
      cloudState.cloudStatus || cloudState.cloud_status || cloudState.status,
    ).toLowerCase().replace(/[_\s]+/gu, "-");
    if (["complete", "cloud-available", "available", "ready", "synced", "uploaded"].includes(stateStatus)) return true;
    if (["deleted", "cloud-deleted-local-kept", "local-only", "missing", "not-found", "unavailable"].includes(stateStatus)) return false;
  }
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

function assetAvailability(asset, cloudId = DEFAULT_ASSET_CLOUD_ID, cloudLabel = "Cloud") {
  const hasLocal = assetLocalAvailable(asset);
  const hasCloud = assetCloudAvailable(asset, cloudId);
  const label = shortLabel(cloudLabel || "Cloud", 18);
  if (hasLocal && hasCloud) return { hasCloud, hasLocal, label: `Local & ${label}`, statusKind: "done" };
  if (hasCloud) return { hasCloud, hasLocal, label: `${label} only`, statusKind: "done" };
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
  if (assetLooksLikeHyperframe(asset)) return "HYPER";
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
  error = "",
  library = null,
  loading = false,
  onLoadCached = null,
  onRefresh = null,
  rootDirectory = "",
  syncing = false,
  untrackedError = "",
  untrackedLibrary = null,
  untrackedLoading = false,
  untrackedSyncing = false,
  onUntrackedDelete = null,
  onUntrackedPromote = null,
  onUntrackedRefresh = null,
  onUntrackedRename = null,
}) {
  const repoPath = rootDirectory || defaultWorkingDirectory || "";
  const [assetMode, setAssetMode] = useState("tracked");
  const [hyperframeEditor, setHyperframeEditor] = useState(null);
  const trackedItems = useMemo(() => assetLibraryItems(library), [library]);
  const untrackedItems = useMemo(() => assetLibraryItems(untrackedLibrary), [untrackedLibrary]);
  const allAssetItems = useMemo(() => {
    const byKey = new Map();
    [...trackedItems, ...untrackedItems].forEach((asset, index) => {
      const key = assetId(asset) || assetLocalPath(asset) || `${assetName(asset, "asset")}:${index}`;
      if (key && !byKey.has(key)) byKey.set(key, asset);
    });
    return [...byKey.values()];
  }, [trackedItems, untrackedItems]);
  const trackedCount = trackedItems.length;
  const untrackedCount = untrackedItems.length;

  const openHyperframeAsset = useCallback(async (asset) => {
    if (!assetLocalPath(asset) || !assetCanContainHyperframe(asset)) return false;
    try {
      const loaded = await loadHyperframeAsset(asset);
      if (!loaded.isHyperframe) return false;
      setHyperframeEditor({
        ...loaded,
        asset,
        assetKey: assetId(asset) || assetLocalPath(asset),
      });
      return true;
    } catch (nextError) {
      if (!assetLooksLikeHyperframe(asset)) return false;
      setHyperframeEditor({
        asset,
        assetKey: assetId(asset) || assetLocalPath(asset),
        error: nextError?.message || String(nextError || "Unable to open Hyperframe."),
        html: "",
        isHyperframe: true,
        manifest: null,
      });
      return true;
    }
  }, []);

  return (
    <AssetsSurface aria-label="Account Assets" data-state={loading ? "loading" : "ready"}>
      {hyperframeEditor ? (
        <HyperframeEditor
          asset={hyperframeEditor.asset}
          assets={allAssetItems}
          initialDocument={hyperframeEditor}
          onBack={() => setHyperframeEditor(null)}
          onRefreshTracked={onRefresh}
          onRefreshUntracked={onUntrackedRefresh}
        />
      ) : assetMode === "untracked" ? (
        <UntrackedAssetsPanel
          assetMode={assetMode}
          assetWorkspaces={assetWorkspaces}
          error={untrackedError}
          library={untrackedLibrary}
          loading={untrackedLoading}
          onAssetModeChange={setAssetMode}
          onOpenHyperframeAsset={openHyperframeAsset}
          onDelete={onUntrackedDelete}
          onPromote={onUntrackedPromote}
          onRefresh={onUntrackedRefresh}
          onRename={onUntrackedRename}
          onTrackedRefresh={onRefresh}
          repoPath={repoPath}
          syncing={untrackedSyncing}
          trackedCount={trackedCount}
          untrackedCount={untrackedCount}
        />
      ) : (
        <AssetsPanel
          assetMode={assetMode}
          assetWorkspaces={assetWorkspaces}
          error={error}
          library={library}
          loading={loading}
          onAssetModeChange={setAssetMode}
          onLoadCached={onLoadCached}
          onOpenHyperframeAsset={openHyperframeAsset}
          onRefresh={onRefresh}
          repoLabel="Assets"
          repoPath={repoPath}
          syncing={syncing}
          trackedCount={trackedCount}
          untrackedCount={untrackedCount}
        />
      )}
    </AssetsSurface>
  );
}

function AssetModeTabs({
  assetMode = "tracked",
  onAssetModeChange,
  trackedCount = 0,
  untrackedCount = 0,
}) {
  const setMode = typeof onAssetModeChange === "function" ? onAssetModeChange : () => {};
  return (
    <AssetModeTabList aria-label="Asset library sections">
      <AssetModeTab
        aria-pressed={assetMode === "tracked"}
        data-active={assetMode === "tracked"}
        onClick={() => setMode("tracked")}
        type="button"
      >
        Tracked
        <span>{trackedCount}</span>
      </AssetModeTab>
      <AssetModeTab
        aria-pressed={assetMode === "untracked"}
        data-active={assetMode === "untracked"}
        onClick={() => setMode("untracked")}
        type="button"
      >
        Untracked
        <span>{untrackedCount}</span>
      </AssetModeTab>
    </AssetModeTabList>
  );
}

function AssetsPanel({
  assetMode = "tracked",
  assetWorkspaces = [],
  error = "",
  library = null,
  loading = false,
  onAssetModeChange,
  onLoadCached,
  onOpenHyperframeAsset,
  onRefresh,
  repoLabel,
  repoPath,
  syncing = false,
  trackedCount = 0,
  untrackedCount = 0,
}) {
  const items = useMemo(() => assetLibraryItems(library), [library]);
  const transfers = useMemo(() => assetLibraryTransfers(library), [library]);
  const aggregate = useMemo(() => assetLibraryAggregate(library), [library]);
  const libraryClouds = useMemo(() => assetLibraryClouds(library), [library]);
  const [cloudsOverride, setCloudsOverride] = useState([]);
  const clouds = useMemo(() => {
    const byId = new Map();
    [...libraryClouds, ...cloudsOverride].forEach((cloud) => {
      const id = text(cloud?.cloudId || cloud?.cloud_id || cloud?.id);
      if (!id) return;
      byId.set(id, {
        ...cloud,
        cloudId: id,
        cloud_id: id,
        label: text(cloud?.label || cloud?.name, id === DEFAULT_ASSET_CLOUD_ID ? "Diff Forge AI Cloud" : id),
      });
    });
    return [...byId.values()];
  }, [cloudsOverride, libraryClouds]);
  const defaultCloudId = useMemo(() => (
    text(
      clouds.find((cloud) => cloud?.defaultCloud || cloud?.default_cloud)?.cloudId
        || clouds.find((cloud) => cloud?.defaultCloud || cloud?.default_cloud)?.cloud_id,
      DEFAULT_ASSET_CLOUD_ID,
    )
  ), [clouds]);
  const [selectedCloudId, setSelectedCloudId] = useState(DEFAULT_ASSET_CLOUD_ID);
  const [cloudSettingsOpen, setCloudSettingsOpen] = useState(false);
  const [cloudSettingsError, setCloudSettingsError] = useState("");
  const [cloudSettingsBusy, setCloudSettingsBusy] = useState("");
  const [selectedWorkspaceFilterKeys, setSelectedWorkspaceFilterKeys] = useState([]);
  const [busyKey, setBusyKey] = useState("");
  const [actionError, setActionError] = useState("");
  const [failedPreviewKeys, setFailedPreviewKeys] = useState(() => new Set());
  const [selectedAssetIds, setSelectedAssetIds] = useState(() => new Set());
  const selectedCloud = useMemo(() => (
    clouds.find((cloud) => text(cloud.cloudId || cloud.cloud_id || cloud.id) === selectedCloudId)
      || clouds.find((cloud) => text(cloud.cloudId || cloud.cloud_id || cloud.id) === defaultCloudId)
      || { cloudId: DEFAULT_ASSET_CLOUD_ID, cloud_id: DEFAULT_ASSET_CLOUD_ID, label: "Diff Forge AI Cloud" }
  ), [clouds, defaultCloudId, selectedCloudId]);
  const selectedCloudLabel = text(selectedCloud?.label || selectedCloud?.name, "Cloud");
  const effectiveCloudId = text(selectedCloud?.cloudId || selectedCloud?.cloud_id || selectedCloudId, DEFAULT_ASSET_CLOUD_ID);

  useEffect(() => {
    if (!clouds.length) return;
    const ids = new Set(clouds.map((cloud) => text(cloud.cloudId || cloud.cloud_id || cloud.id)).filter(Boolean));
    if (!ids.has(selectedCloudId)) {
      setSelectedCloudId(defaultCloudId);
    }
  }, [clouds, defaultCloudId, selectedCloudId]);

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
    (selectedWorkspaceFilterOptions.length
      ? transfers.filter((transfer) => visibleAssetIds.has(text(transfer?.assetId || transfer?.asset_id)))
      : transfers
    ).filter((transfer) => assetTransferCloudId(transfer) === effectiveCloudId)
  ), [effectiveCloudId, selectedWorkspaceFilterOptions.length, transfers, visibleAssetIds]);
  const cloudCount = filteredItems.filter((item) => assetAvailability(item, effectiveCloudId, selectedCloudLabel).hasCloud).length;
  const localCount = filteredItems.filter((item) => assetAvailability(item, effectiveCloudId, selectedCloudLabel).hasLocal).length;
  const activeTransfers = selectedWorkspaceFilterOptions.length
    ? visibleTransfers.filter((transfer) => assetTransferStatusKind(transfer) === "active").length
    : numberValue(aggregate.activeTransfers ?? aggregate.active_transfers, 0)
      || visibleTransfers.filter((transfer) => assetTransferStatusKind(transfer) === "active").length;
  const activeTransferSummary = useMemo(
    () => assetTransferDeviceSummary(visibleTransfers),
    [visibleTransfers],
  );
  const hasWorkspaceFilters = selectedWorkspaceFilterKeys.length > 0;
  const assetCountPluralBase = hasWorkspaceFilters ? items.length : filteredItems.length;
  const selectedAssets = useMemo(() => (
    filteredItems.filter((asset) => selectedAssetIds.has(assetId(asset)))
  ), [filteredItems, selectedAssetIds]);
  const selectedImageAssets = useMemo(() => (
    selectedAssets.filter((asset) => assetLocalAvailable(asset) && assetIsImage(asset) && assetLocalPath(asset))
  ), [selectedAssets]);

  useEffect(() => {
    const visibleIds = new Set(filteredItems.map((asset) => assetId(asset)).filter(Boolean));
    setSelectedAssetIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [filteredItems]);

  const refresh = useCallback((options = { silent: true }) => (
    typeof onRefresh === "function" ? onRefresh(options) : Promise.resolve(null)
  ), [onRefresh]);

  const refreshClouds = useCallback(async () => {
    setCloudSettingsError("");
    const response = await invoke("cloud_mcp_list_asset_clouds", {
      repoPath,
      workspaceId: null,
      workspaceName: null,
    });
    const nextClouds = assetLibraryClouds(response);
    setCloudsOverride(nextClouds);
    return nextClouds;
  }, [repoPath]);

  useEffect(() => {
    if (!cloudSettingsOpen) return;
    void refreshClouds().catch((nextError) => {
      setCloudSettingsError(nextError?.message || String(nextError || "Unable to load asset clouds."));
    });
  }, [cloudSettingsOpen, refreshClouds]);

  const runCloudSettingsAction = useCallback(async (action, payload = {}) => {
    const cloudId = text(payload.cloudId || payload.cloud_id || payload.id);
    const key = `${action}:${cloudId || "new"}`;
    setCloudSettingsBusy(key);
    setCloudSettingsError("");
    try {
      let response = null;
      if (action === "save") {
        response = await invoke("cloud_mcp_save_asset_cloud", {
          repoPath,
          workspaceId: null,
          workspaceName: null,
          cloud: payload,
        });
      } else if (action === "validate") {
        response = await invoke("cloud_mcp_validate_asset_cloud", {
          repoPath,
          workspaceId: null,
          workspaceName: null,
          cloudId,
        });
      } else if (action === "default") {
        response = await invoke("cloud_mcp_set_default_asset_cloud", {
          repoPath,
          workspaceId: null,
          workspaceName: null,
          cloudId,
        });
        if (cloudId) setSelectedCloudId(cloudId);
      } else if (action === "delete") {
        response = await invoke("cloud_mcp_delete_asset_cloud", {
          repoPath,
          workspaceId: null,
          workspaceName: null,
          cloudId,
        });
        if (cloudId === effectiveCloudId) setSelectedCloudId(DEFAULT_ASSET_CLOUD_ID);
      } else if (action === "refresh") {
        response = { clouds: await refreshClouds() };
      }
      const nextClouds = assetLibraryClouds(response);
      if (nextClouds.length) setCloudsOverride(nextClouds);
      await refresh({ silent: true, force: true });
      return response;
    } catch (nextError) {
      setCloudSettingsError(nextError?.message || String(nextError || "Cloud settings update failed."));
      return null;
    } finally {
      setCloudSettingsBusy((current) => (current === key ? "" : current));
    }
  }, [effectiveCloudId, refresh, refreshClouds, repoPath]);

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

  const toggleAssetSelected = useCallback((asset) => {
    const id = assetId(asset);
    if (!id) return;
    setSelectedAssetIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelectedAssets = useCallback(() => {
    setSelectedAssetIds(new Set());
  }, []);

  const runAssetAction = useCallback(async (action, asset) => {
    const id = assetId(asset);
    const name = assetName(asset, "asset");
    const localPath = assetLocalPath(asset);
    const availability = assetAvailability(asset, effectiveCloudId, selectedCloudLabel);
    if (["copy", "open", "view"].includes(action) && !localPath) return;
    if (action === "open") {
      const key = `${action}:${id || localPath}`;
      setBusyKey(key);
      setActionError("");
      try {
        if (typeof onOpenHyperframeAsset === "function" && await onOpenHyperframeAsset(asset)) {
          return;
        }
        await openPath(localPath);
      } catch (nextError) {
        setActionError(nextError?.message || String(nextError || "Unable to open asset."));
      } finally {
        setBusyKey((current) => (current === key ? "" : current));
      }
      return;
    }
    if (action === "copy") {
      const key = `${action}:${id || localPath}`;
      setBusyKey(key);
      setActionError("");
      try {
        await invoke("diffforge_copy_asset_to_clipboard", { path: localPath });
      } catch (nextError) {
        setActionError(nextError?.message || String(nextError || "Unable to copy asset."));
      } finally {
        setBusyKey((current) => (current === key ? "" : current));
      }
      return;
    }
    if (action === "view") {
      const key = `${action}:${id || localPath}`;
      setBusyKey(key);
      setActionError("");
      try {
        await invoke("snipping_open_annotation_editor", { path: localPath });
      } catch (nextError) {
        setActionError(nextError?.message || String(nextError || "Unable to open asset viewer."));
      } finally {
        setBusyKey((current) => (current === key ? "" : current));
      }
      return;
    }
    const actionWorkspace = workspaceOptionForAsset(asset);
    const actionRepoPath = assetRepoPath(asset) || actionWorkspace?.rootDirectory || repoPath;
    const actionWorkspaceId = assetWorkspaceId(asset) || actionWorkspace?.id;
    const actionWorkspaceName = assetWorkspaceName(asset) || actionWorkspace?.name;
    if (!id || !actionRepoPath || !actionWorkspaceId) return;
    const key = `${action}:${id}`;
    setBusyKey(key);
    setActionError("");
    try {
      if (action === "untrack") {
        if (!localPath) return;
        await invoke("diffforge_untrack_workspace_asset", {
          assetId: id,
          name,
          path: localPath,
        });
        if (availability.hasCloud) {
          try {
            await invoke("cloud_mcp_delete_cloud_workspace_asset", {
              assetId: id,
              cloudId: effectiveCloudId,
              repoPath: actionRepoPath,
              workspaceId: actionWorkspaceId,
              workspaceName: actionWorkspaceName,
            });
          } catch (cloudError) {
            setActionError(
              `Moved to scratch, but the Cloud copy is still tracked: ${
                cloudError?.message || String(cloudError || "Cloud delete failed.")
              }`,
            );
          }
        }
      } else {
        const command = action === "upload"
          ? "cloud_mcp_upload_workspace_asset"
          : action === "download"
            ? "cloud_mcp_download_workspace_asset"
            : action === "deleteLocal"
              ? "cloud_mcp_delete_local_workspace_asset"
              : "cloud_mcp_delete_cloud_workspace_asset";
        await invoke(command, {
          assetId: id,
          cloudId: ["upload", "download", "deleteCloud"].includes(action) ? effectiveCloudId : undefined,
          deleteFile: action === "deleteLocal" ? true : undefined,
          repoPath: actionRepoPath,
          workspaceId: actionWorkspaceId,
          workspaceName: actionWorkspaceName,
        });
      }
      await refresh({ silent: true, force: true });
    } catch (nextError) {
      setActionError(nextError?.message || String(nextError || `Unable to ${action} asset.`));
    } finally {
      setBusyKey((current) => (current === key ? "" : current));
    }
  }, [effectiveCloudId, onOpenHyperframeAsset, refresh, repoPath, selectedCloudLabel, workspaceOptionForAsset]);

  const cancelAssetTransfer = useCallback(async (asset, transfer) => {
    const id = assetId(asset);
    const transferId = assetTransferId(transfer);
    if (!id && !transferId) return;
    const key = `cancel:${id || transferId}`;
    setBusyKey(key);
    setActionError("");
    try {
      await invoke("cloud_mcp_cancel_asset_transfer", {
        assetId: id || null,
        transferId: transferId || null,
      });
      await refresh({ silent: true, force: true });
    } catch (nextError) {
      setActionError(nextError?.message || String(nextError || "Unable to cancel transfer."));
    } finally {
      setBusyKey((current) => (current === key ? "" : current));
    }
  }, [refresh]);

  const runSelectedAssetAction = useCallback(async (action) => {
    if (!selectedAssets.length) return;
    const key = `batch:${action}`;
    setBusyKey(key);
    setActionError("");
    try {
      if (action === "annotate") {
        const paths = selectedImageAssets.map(assetLocalPath).filter(Boolean);
        if (!paths.length) {
          setActionError("Select at least one local image to annotate.");
          return;
        }
        await invoke("snipping_open_annotation_editor_batch", {
          request: { paths },
        });
        return;
      }

      if (action === "delete") {
        let deletedCount = 0;
        for (const asset of selectedAssets) {
          const id = assetId(asset);
          const actionWorkspace = workspaceOptionForAsset(asset);
          const actionRepoPath = assetRepoPath(asset) || actionWorkspace?.rootDirectory || repoPath;
          const actionWorkspaceId = assetWorkspaceId(asset) || actionWorkspace?.id;
          const actionWorkspaceName = assetWorkspaceName(asset) || actionWorkspace?.name;
          const availability = assetAvailability(asset, effectiveCloudId, selectedCloudLabel);
          if (!id || !actionRepoPath || !actionWorkspaceId) {
            continue;
          }
          if (availability.hasLocal) {
            await invoke("cloud_mcp_delete_local_workspace_asset", {
              assetId: id,
              deleteFile: true,
              repoPath: actionRepoPath,
              workspaceId: actionWorkspaceId,
              workspaceName: actionWorkspaceName,
            });
            deletedCount += 1;
          }
          if (availability.hasCloud) {
            await invoke("cloud_mcp_delete_cloud_workspace_asset", {
              assetId: id,
              cloudId: effectiveCloudId,
              repoPath: actionRepoPath,
              workspaceId: actionWorkspaceId,
              workspaceName: actionWorkspaceName,
            });
            deletedCount += 1;
          }
        }
        if (!deletedCount) {
          setActionError("Selected assets could not be deleted from this workspace.");
          return;
        }
        clearSelectedAssets();
        await refresh({ silent: true, force: true });
      }
    } catch (nextError) {
      setActionError(nextError?.message || String(nextError || `Unable to ${action} selected assets.`));
    } finally {
      setBusyKey((current) => (current === key ? "" : current));
    }
  }, [
    clearSelectedAssets,
    refresh,
    repoPath,
    selectedAssets,
    selectedImageAssets,
    effectiveCloudId,
    selectedCloudLabel,
    workspaceOptionForAsset,
  ]);

  return (
    <AssetsPane>
      <AssetsHeader>
        <div>
          <AssetsKicker>Library</AssetsKicker>
          <AssetModeTabs
            assetMode={assetMode}
            onAssetModeChange={onAssetModeChange}
            trackedCount={trackedCount}
            untrackedCount={untrackedCount}
          />
          <AssetHeadingLine>
            <AssetsTitle>{repoLabel}</AssetsTitle>
            {(syncing || (!loading && !error)) && (
              <AssetSyncPill aria-live="polite" data-state={syncing ? "syncing" : "synced"}>
                {syncing && <AssetSyncSpinner aria-hidden="true" />}
                {syncing ? "Syncing" : "Synced"}
              </AssetSyncPill>
            )}
          </AssetHeadingLine>
        </div>
        <AssetHeaderActions>
          <AssetsSummary>
            {filteredItems.length}{hasWorkspaceFilters ? ` / ${items.length}` : ""} asset{assetCountPluralBase === 1 ? "" : "s"} · {localCount} local · {cloudCount} {shortLabel(selectedCloudLabel, 14)}
            {activeTransfers ? ` · ${activeTransfers} active` : ""}
            {activeTransferSummary ? ` · ${activeTransferSummary}` : ""}
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
          <AssetIconButton
            aria-label="Asset cloud settings"
            data-active={cloudSettingsOpen ? "true" : "false"}
            onClick={() => setCloudSettingsOpen((open) => !open)}
            title="Asset cloud settings"
            type="button"
          >
            <Settings aria-hidden="true" />
          </AssetIconButton>
        </AssetHeaderActions>
      </AssetsHeader>
      <AssetCloudControls aria-label="Asset cloud">
        {clouds.map((cloud) => {
          const cloudId = text(cloud.cloudId || cloud.cloud_id || cloud.id, DEFAULT_ASSET_CLOUD_ID);
          const active = cloudId === effectiveCloudId;
          return (
            <AssetCloudButton
              aria-pressed={active}
              data-active={active}
              key={cloudId}
              onClick={() => setSelectedCloudId(cloudId)}
              title={text(cloud.endpoint || cloud.bucket || cloud.providerKind || cloud.provider_kind, cloud.label)}
              type="button"
            >
              <Cloud aria-hidden="true" />
              <span>{shortLabel(cloud.label, 22)}</span>
            </AssetCloudButton>
          );
        })}
      </AssetCloudControls>
      {cloudSettingsOpen && (
        <AssetCloudSettingsPanel
          busyKey={cloudSettingsBusy}
          clouds={clouds}
          error={cloudSettingsError}
          onAction={runCloudSettingsAction}
          selectedCloudId={effectiveCloudId}
        />
      )}
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
      {selectedAssets.length > 0 && (
        <AssetSelectionToolbar>
          <strong>{selectedAssets.length} selected</strong>
          <span>{selectedImageAssets.length} annotatable image{selectedImageAssets.length === 1 ? "" : "s"}</span>
          <AssetBatchButton
            data-primary="true"
            disabled={!selectedImageAssets.length || Boolean(busyKey)}
            onClick={() => runSelectedAssetAction("annotate")}
            type="button"
          >
            <ModeEdit aria-hidden="true" />
            <span>Annotation</span>
          </AssetBatchButton>
          <AssetBatchButton
            data-danger="true"
            disabled={Boolean(busyKey)}
            onClick={() => runSelectedAssetAction("delete")}
            type="button"
          >
            <Delete aria-hidden="true" />
            <span>Delete</span>
          </AssetBatchButton>
          <AssetBatchButton disabled={Boolean(busyKey)} onClick={clearSelectedAssets} type="button">
            Clear
          </AssetBatchButton>
        </AssetSelectionToolbar>
      )}
      {(error || actionError) && <AssetError>{actionError || error}</AssetError>}
      {!filteredItems.length ? (
        <AssetEmptyState>{loading ? "Loading assets..." : hasWorkspaceFilters ? "No assets match those workspaces." : "No assets registered yet."}</AssetEmptyState>
      ) : (
        <AssetGrid aria-label="Asset library grid">
          {filteredItems.map((asset, index) => {
            const id = assetId(asset, `asset-${index}`);
            const name = assetName(asset, `Asset ${index + 1}`);
            const availability = assetAvailability(asset, effectiveCloudId, selectedCloudLabel);
            const transfer = latestAssetTransfer(visibleTransfers, asset, effectiveCloudId);
            const transferStatus = transfer ? assetTransferStatusKind(transfer) : "";
            const transferActive = transferStatus === "active";
            const transferFailed = transferStatus === "failed";
            const transferPercent = transfer ? assetTransferPercent(transfer) : 0;
            const transferLabel = transfer ? assetTransferDirectionLabel(transfer) : "";
            const transferError = text(transfer?.error);
            const syncedDeviceNames = assetSyncedDeviceNames(asset);
            const cardStatus = transferActive || transferFailed ? transferStatus : availability.statusKind;
            const localPath = assetLocalPath(asset);
            const previewUrl = assetPreviewUrl(asset);
            const previewKey = `${id}:${previewUrl}`;
            const shouldShowImagePreview = Boolean(previewUrl && !failedPreviewKeys.has(previewKey));
            const shouldOpenHyperframeEditor = !shouldShowImagePreview && assetCanContainHyperframe(asset) && Boolean(localPath);
            const rowWorkspaceOption = workspaceOptionForAsset(asset);
            const canRunAssetAction = Boolean(
              (assetRepoPath(asset) || rowWorkspaceOption?.rootDirectory || repoPath)
                && (assetWorkspaceId(asset) || rowWorkspaceOption?.id),
            );
            const uploadBusy = busyKey === `upload:${id}`;
            const downloadBusy = busyKey === `download:${id}`;
            const deleteLocalBusy = busyKey === `deleteLocal:${id}`;
            const deleteCloudBusy = busyKey === `deleteCloud:${id}`;
            const viewBusy = busyKey === `view:${id}`;
            const copyBusy = busyKey === `copy:${id}`;
            const untrackBusy = busyKey === `untrack:${id}`;
            const canUpload = canRunAssetAction && !transferActive && availability.hasLocal && !availability.hasCloud && Boolean(localPath);
            const canDownload = canRunAssetAction && !transferActive && availability.hasCloud && !availability.hasLocal;
            const canDeleteCloud = canRunAssetAction && !transferActive && availability.hasCloud;
            const canDeleteLocal = canRunAssetAction && !transferActive && availability.hasLocal && Boolean(localPath);
            const canView = availability.hasLocal && assetIsImage(asset) && Boolean(localPath);
            const canCopy = availability.hasLocal && assetIsImage(asset) && Boolean(localPath);
            const canUntrack = canRunAssetAction && !transferActive && availability.hasLocal && Boolean(localPath);
            const showUpload = availability.hasLocal;
            const showDownload = availability.hasCloud;
            const showDeleteCloud = availability.hasCloud;
            const showDeleteLocal = availability.hasLocal;
            const selected = selectedAssetIds.has(id);

            return (
              <AssetCard data-selected={selected ? "true" : "false"} data-status={cardStatus} key={id} title={localPath || assetSha(asset) || name}>
                <AssetCardPreview
                  aria-label={shouldShowImagePreview ? `Open ${name} in image editor` : shouldOpenHyperframeEditor ? `Open ${name} in Hyperframe editor` : `Open ${name}`}
                  disabled={!localPath || Boolean(busyKey)}
                  onClick={() => runAssetAction(shouldShowImagePreview ? "view" : "open", asset)}
                  title={shouldShowImagePreview ? "Open big view and annotate" : shouldOpenHyperframeEditor ? "Open Hyperframe editor" : "Open file"}
                  type="button"
                >
                  {shouldShowImagePreview ? (
                    <AssetPreviewImage
                      alt={name}
                      decoding="async"
                      draggable={false}
                      loading={index < 20 ? "eager" : "lazy"}
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                        setFailedPreviewKeys((current) => {
                          const next = new Set(current);
                          next.add(previewKey);
                          return next;
                        });
                      }}
                      src={previewUrl}
                    />
                  ) : (
                    <AssetDocumentPreview aria-hidden="true">
                      <AssetDocumentGlyph>
                        <InsertDriveFile aria-hidden="true" />
                        <span>{assetFileTypeLabel(asset)}</span>
                      </AssetDocumentGlyph>
                    </AssetDocumentPreview>
                  )}
                </AssetCardPreview>
                <AssetCardStatus data-status={availability.statusKind} title={`${selectedCloudLabel}: ${availability.label}`}>
                  {availability.label}
                </AssetCardStatus>
                {transferActive && (
                  <AssetTransferOverlay>
                    <AssetTransferInfo>
                      <AssetTransferLabel>
                        {`${transferLabel} ${transferPercent}%`}
                      </AssetTransferLabel>
                      <AssetTransferTrack aria-hidden="true">
                        <AssetTransferFill style={{ width: `${transferPercent}%` }} />
                      </AssetTransferTrack>
                    </AssetTransferInfo>
                    <AssetTransferCancel
                      aria-label={`Cancel ${transferLabel.toLowerCase()} of ${name}`}
                      disabled={busyKey === `cancel:${id}`}
                      onClick={() => cancelAssetTransfer(asset, transfer)}
                      title="Cancel transfer"
                      type="button"
                    >
                      <Close aria-hidden="true" />
                    </AssetTransferCancel>
                  </AssetTransferOverlay>
                )}
                <AssetSelectButton
                  aria-label={`${selected ? "Deselect" : "Select"} ${name}`}
                  aria-pressed={selected}
                  data-selected={selected ? "true" : "false"}
                  disabled={Boolean(busyKey)}
                  onClick={() => toggleAssetSelected(asset)}
                  title={selected ? "Deselect asset" : "Select asset"}
                  type="button"
                >
                  {selected ? <CheckBox aria-hidden="true" /> : <CheckBoxOutlineBlank aria-hidden="true" />}
                </AssetSelectButton>
                <AssetCardActions>
                  {canView && (
                    <AssetIconButton
                      aria-label={`Open big view for ${name}`}
                      disabled={!canView || viewBusy || Boolean(busyKey && !viewBusy)}
                      onClick={() => runAssetAction("view", asset)}
                      title="Open big view and annotate"
                      type="button"
                    >
                      <OpenInFull aria-hidden="true" />
                    </AssetIconButton>
                  )}
                  {canCopy && (
                    <AssetIconButton
                      aria-label={`Copy ${name} to clipboard`}
                      disabled={!canCopy || copyBusy || Boolean(busyKey && !copyBusy)}
                      onClick={() => runAssetAction("copy", asset)}
                      title="Copy image to clipboard"
                      type="button"
                    >
                      <ContentCopy aria-hidden="true" />
                    </AssetIconButton>
                  )}
                  {canUntrack && (
                    <AssetIconButton
                      aria-label={`Untrack ${name}`}
                      data-warning="true"
                      disabled={!canUntrack || untrackBusy || Boolean(busyKey && !untrackBusy)}
                      onClick={() => runAssetAction("untrack", asset)}
                      title="Move to untracked scratch"
                      type="button"
                    >
                      <MoveToInbox aria-hidden="true" />
                    </AssetIconButton>
                  )}
                  {showUpload && (
                    <AssetIconButton
                      aria-label={`Upload ${name}`}
                      disabled={!canUpload || uploadBusy || Boolean(busyKey && !uploadBusy)}
                      onClick={() => runAssetAction("upload", asset)}
                      title={availability.hasCloud ? "Already in Cloud" : "Upload to Cloud"}
                      type="button"
                    >
                      <CloudUpload aria-hidden="true" />
                    </AssetIconButton>
                  )}
                  {showDownload && (
                    <AssetIconButton
                      aria-label={`Download ${name}`}
                      disabled={!canDownload || downloadBusy || Boolean(busyKey && !downloadBusy)}
                      onClick={() => runAssetAction("download", asset)}
                      title={availability.hasLocal ? "Already local" : "Download asset"}
                      type="button"
                    >
                      <FileDownload aria-hidden="true" />
                    </AssetIconButton>
                  )}
                  {showDeleteCloud && (
                    <AssetIconButton
                      aria-label={`Delete Cloud copy of ${name}`}
                      data-danger="true"
                      disabled={!canDeleteCloud || deleteCloudBusy || Boolean(busyKey && !deleteCloudBusy)}
                      onClick={() => runAssetAction("deleteCloud", asset)}
                      title="Delete Cloud copy"
                      type="button"
                    >
                      <Cloud aria-hidden="true" />
                    </AssetIconButton>
                  )}
                  {showDeleteLocal && (
                    <AssetIconButton
                      aria-label={`Delete local copy of ${name}`}
                      data-danger="true"
                      disabled={!canDeleteLocal || deleteLocalBusy || Boolean(busyKey && !deleteLocalBusy)}
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
                  {syncedDeviceNames.length > 0 && (
                    <AssetCardMetaLine title={`Synced to: ${syncedDeviceNames.join(", ")}`}>
                      {syncedDeviceNames.length === 1
                        ? `On ${syncedDeviceNames[0]}`
                        : `On ${syncedDeviceNames.length} devices`}
                    </AssetCardMetaLine>
                  )}
                  {transferFailed && !transferActive && (
                    <AssetCardMetaLine data-failed="true" title={transferError || "Transfer failed."}>
                      {`${transferLabel || "Transfer"} failed — retry available`}
                    </AssetCardMetaLine>
                  )}
                </AssetCardCaption>
              </AssetCard>
            );
          })}
        </AssetGrid>
      )}
    </AssetsPane>
  );
}

function AssetCloudSettingsPanel({
  busyKey = "",
  clouds = [],
  error = "",
  onAction,
  selectedCloudId = DEFAULT_ASSET_CLOUD_ID,
}) {
  const [form, setForm] = useState({
    accessKeyId: "",
    bucket: "",
    endpoint: "",
    keyPrefix: "diffforge/assets/blobs",
    label: "",
    makeDefault: false,
    providerKind: "s3",
    region: "us-east-1",
    secretAccessKey: "",
  });
  const setField = useCallback((key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  }, []);
  const providerKind = text(form.providerKind, "s3");
  const canSave = text(form.label)
    && text(form.bucket)
    && text(form.endpoint)
    && text(form.accessKeyId)
    && text(form.secretAccessKey);
  const submit = useCallback(async (event) => {
    event.preventDefault();
    if (!canSave || typeof onAction !== "function") return;
    const response = await onAction("save", {
      bucket: form.bucket,
      credentials: {
        accessKeyId: form.accessKeyId,
        access_key_id: form.accessKeyId,
        secretAccessKey: form.secretAccessKey,
        secret_access_key: form.secretAccessKey,
      },
      defaultCloud: form.makeDefault,
      default_cloud: form.makeDefault,
      endpoint: form.endpoint,
      keyPrefix: form.keyPrefix,
      key_prefix: form.keyPrefix,
      label: form.label,
      providerKind,
      provider_kind: providerKind,
      region: form.region,
    });
    if (response) {
      setForm((current) => ({
        ...current,
        accessKeyId: "",
        bucket: "",
        endpoint: "",
        label: "",
        makeDefault: false,
        secretAccessKey: "",
      }));
    }
  }, [canSave, form, onAction, providerKind]);

  return (
    <AssetCloudSettings>
      <AssetCloudList>
        {clouds.map((cloud) => {
          const cloudId = text(cloud.cloudId || cloud.cloud_id || cloud.id, DEFAULT_ASSET_CLOUD_ID);
          const builtin = cloudId === DEFAULT_ASSET_CLOUD_ID || cloud.builtin;
          const isDefault = Boolean(cloud.defaultCloud || cloud.default_cloud);
          return (
            <AssetCloudRow data-active={cloudId === selectedCloudId} key={cloudId}>
              <Cloud aria-hidden="true" />
              <AssetCloudRowText>
                <strong>{text(cloud.label || cloud.name, cloudId)}</strong>
                <span>{text(cloud.providerKind || cloud.provider_kind || cloud.provider, "cloud")} {isDefault ? "· default" : ""}</span>
              </AssetCloudRowText>
              <AssetCloudRowActions>
                {!builtin && (
                  <AssetMiniButton
                    disabled={Boolean(busyKey)}
                    onClick={() => onAction?.("validate", { cloudId })}
                    type="button"
                  >
                    Test
                  </AssetMiniButton>
                )}
                {!isDefault && (
                  <AssetMiniButton
                    disabled={Boolean(busyKey)}
                    onClick={() => onAction?.("default", { cloudId })}
                    type="button"
                  >
                    Default
                  </AssetMiniButton>
                )}
                {!builtin && (
                  <AssetMiniButton
                    data-danger="true"
                    disabled={Boolean(busyKey)}
                    onClick={() => {
                      if (window.confirm(`Remove ${text(cloud.label || cloudId)}?`)) {
                        void onAction?.("delete", { cloudId });
                      }
                    }}
                    type="button"
                  >
                    Remove
                  </AssetMiniButton>
                )}
              </AssetCloudRowActions>
            </AssetCloudRow>
          );
        })}
      </AssetCloudList>
      <AssetCloudForm onSubmit={submit}>
        <AssetProviderTabs aria-label="Cloud provider">
          {["s3", "r2", "b2"].map((provider) => (
            <AssetProviderButton
              aria-pressed={providerKind === provider}
              data-active={providerKind === provider}
              key={provider}
              onClick={() => {
                setField("providerKind", provider);
                if (provider === "r2") setField("region", "auto");
                if (provider === "s3" && form.region === "auto") setField("region", "us-east-1");
              }}
              type="button"
            >
              {provider.toUpperCase()}
            </AssetProviderButton>
          ))}
        </AssetProviderTabs>
        <AssetCloudFields>
          <AssetCloudInput aria-label="Cloud label" placeholder="Cloud label" value={form.label} onChange={(event) => setField("label", event.target.value)} />
          <AssetCloudInput aria-label="Bucket" placeholder="Bucket" value={form.bucket} onChange={(event) => setField("bucket", event.target.value)} />
          <AssetCloudInput aria-label="Endpoint" placeholder="Endpoint URL" value={form.endpoint} onChange={(event) => setField("endpoint", event.target.value)} />
          <AssetCloudInput aria-label="Region" placeholder="Region" value={form.region} onChange={(event) => setField("region", event.target.value)} />
          <AssetCloudInput aria-label="Key prefix" placeholder="Key prefix" value={form.keyPrefix} onChange={(event) => setField("keyPrefix", event.target.value)} />
          <AssetCloudInput aria-label="Access key id" placeholder="Access key id" value={form.accessKeyId} onChange={(event) => setField("accessKeyId", event.target.value)} />
          <AssetCloudInput aria-label="Secret access key" placeholder="Secret access key" type="password" value={form.secretAccessKey} onChange={(event) => setField("secretAccessKey", event.target.value)} />
        </AssetCloudFields>
        <AssetCloudFormFooter>
          <label>
            <input checked={form.makeDefault} onChange={(event) => setField("makeDefault", event.target.checked)} type="checkbox" />
            Default
          </label>
          <AssetMiniButton data-primary="true" disabled={!canSave || Boolean(busyKey)} type="submit">
            Add Cloud
          </AssetMiniButton>
          <AssetMiniButton disabled={Boolean(busyKey)} onClick={() => onAction?.("refresh")} type="button">
            Refresh
          </AssetMiniButton>
        </AssetCloudFormFooter>
        {error && <AssetCloudError>{error}</AssetCloudError>}
      </AssetCloudForm>
    </AssetCloudSettings>
  );
}

function UntrackedAssetsPanel({
  assetMode = "untracked",
  assetWorkspaces = [],
  error = "",
  library = null,
  loading = false,
  onAssetModeChange,
  onDelete,
  onOpenHyperframeAsset,
  onPromote,
  onRefresh,
  onRename,
  onTrackedRefresh,
  repoPath = "",
  syncing = false,
  trackedCount = 0,
  untrackedCount = 0,
}) {
  const items = useMemo(() => assetLibraryItems(library), [library]);
  const [busyKey, setBusyKey] = useState("");
  const [actionError, setActionError] = useState("");
  const [failedPreviewKeys, setFailedPreviewKeys] = useState(() => new Set());
  const [selectedAssetIds, setSelectedAssetIds] = useState(() => new Set());
  const defaultWorkspace = useMemo(() => (
    assetWorkspaces.find((workspace) => text(workspace?.id))
      || assetWorkspaces.find((workspace) => text(workspace?.rootDirectory))
      || assetWorkspaces[0]
      || null
  ), [assetWorkspaces]);
  const selectedAssets = useMemo(() => (
    items.filter((asset) => selectedAssetIds.has(assetId(asset)))
  ), [items, selectedAssetIds]);
  const selectedImageAssets = useMemo(() => (
    selectedAssets.filter((asset) => assetLocalAvailable(asset) && assetIsImage(asset) && assetLocalPath(asset))
  ), [selectedAssets]);

  useEffect(() => {
    const visibleIds = new Set(items.map((asset) => assetId(asset)).filter(Boolean));
    setSelectedAssetIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [items]);

  const refresh = useCallback((options = { silent: true }) => (
    typeof onRefresh === "function" ? onRefresh(options) : Promise.resolve(null)
  ), [onRefresh]);
  const trackedRefresh = useCallback((options = { silent: true, force: true }) => (
    typeof onTrackedRefresh === "function" ? onTrackedRefresh(options) : Promise.resolve(null)
  ), [onTrackedRefresh]);

  const toggleAssetSelected = useCallback((asset) => {
    const id = assetId(asset);
    if (!id) return;
    setSelectedAssetIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const clearSelectedAssets = useCallback(() => {
    setSelectedAssetIds(new Set());
  }, []);

  const runUntrackedAction = useCallback(async (action, asset) => {
    const id = assetId(asset);
    const name = assetName(asset, "asset");
    const localPath = assetLocalPath(asset);
    if (!id || !localPath) return;
    const key = `${action}:${id}`;
    setBusyKey(key);
    setActionError("");
    try {
      if (action === "open") {
        if (typeof onOpenHyperframeAsset === "function" && await onOpenHyperframeAsset(asset)) {
          return;
        }
        await openPath(localPath);
      } else if (action === "view") {
        await invoke("snipping_open_annotation_editor", { path: localPath });
      } else if (action === "copy") {
        await invoke("diffforge_copy_asset_to_clipboard", { path: localPath });
      } else if (action === "delete") {
        if (typeof onDelete !== "function") return;
        await onDelete(localPath);
      } else if (action === "rename") {
        if (typeof onRename !== "function") return;
        const nextName = window.prompt("Rename untracked asset", name);
        if (nextName === null) return;
        const trimmed = nextName.trim();
        if (!trimmed || trimmed === name) return;
        await onRename(localPath, trimmed);
      } else if (action === "track") {
        if (typeof onPromote !== "function") return;
        await onPromote({
          deleteSource: true,
          name,
          path: localPath,
          repoPath,
          workspaceId: text(defaultWorkspace?.id),
          workspaceName: text(defaultWorkspace?.name),
        });
        await trackedRefresh({ silent: true, force: true });
      }
    } catch (nextError) {
      setActionError(nextError?.message || String(nextError || `Unable to ${action} untracked asset.`));
    } finally {
      setBusyKey((current) => (current === key ? "" : current));
    }
  }, [defaultWorkspace, onDelete, onOpenHyperframeAsset, onPromote, onRename, repoPath, trackedRefresh]);

  const runSelectedUntrackedAction = useCallback(async (action) => {
    if (!selectedAssets.length) return;
    const key = `batch:${action}`;
    setBusyKey(key);
    setActionError("");
    try {
      if (action === "annotate") {
        const paths = selectedImageAssets.map(assetLocalPath).filter(Boolean);
        if (!paths.length) {
          setActionError("Select at least one local image to annotate.");
          return;
        }
        await invoke("snipping_open_annotation_editor_batch", {
          request: { paths },
        });
        return;
      }

      if (action === "delete") {
        if (typeof onDelete !== "function") return;
        for (const asset of selectedAssets) {
          const localPath = assetLocalPath(asset);
          if (localPath) {
            await onDelete(localPath);
          }
        }
        clearSelectedAssets();
        await refresh({ silent: true, force: true });
      }
    } catch (nextError) {
      setActionError(nextError?.message || String(nextError || `Unable to ${action} selected scratch assets.`));
    } finally {
      setBusyKey((current) => (current === key ? "" : current));
    }
  }, [
    clearSelectedAssets,
    onDelete,
    refresh,
    selectedAssets,
    selectedImageAssets,
  ]);

  return (
    <AssetsPane>
      <AssetsHeader>
        <div>
          <AssetsKicker>Scratch</AssetsKicker>
          <AssetModeTabs
            assetMode={assetMode}
            onAssetModeChange={onAssetModeChange}
            trackedCount={trackedCount}
            untrackedCount={untrackedCount}
          />
          <AssetHeadingLine>
            <AssetsTitle>Untracked Assets</AssetsTitle>
            <AssetSyncPill aria-live="polite" data-state={syncing ? "syncing" : "local"}>
              {syncing && <AssetSyncSpinner aria-hidden="true" />}
              {syncing ? "Scanning" : "Local Scratch"}
            </AssetSyncPill>
          </AssetHeadingLine>
        </div>
        <AssetHeaderActions>
          <AssetsSummary>
            {items.length} scratch file{items.length === 1 ? "" : "s"} · local only · not synced
          </AssetsSummary>
          <AssetIconButton
            aria-label="Refresh untracked assets"
            disabled={loading || syncing}
            onClick={() => refresh({ silent: false, force: true })}
            title="Refresh untracked assets"
            type="button"
          >
            <Cached aria-hidden="true" />
          </AssetIconButton>
        </AssetHeaderActions>
      </AssetsHeader>
      {selectedAssets.length > 0 && (
        <AssetSelectionToolbar>
          <strong>{selectedAssets.length} selected</strong>
          <span>{selectedImageAssets.length} annotatable image{selectedImageAssets.length === 1 ? "" : "s"}</span>
          <AssetBatchButton
            data-primary="true"
            disabled={!selectedImageAssets.length || Boolean(busyKey)}
            onClick={() => runSelectedUntrackedAction("annotate")}
            type="button"
          >
            <ModeEdit aria-hidden="true" />
            <span>Annotation</span>
          </AssetBatchButton>
          <AssetBatchButton
            data-danger="true"
            disabled={Boolean(busyKey)}
            onClick={() => runSelectedUntrackedAction("delete")}
            type="button"
          >
            <Delete aria-hidden="true" />
            <span>Delete</span>
          </AssetBatchButton>
          <AssetBatchButton disabled={Boolean(busyKey)} onClick={clearSelectedAssets} type="button">
            Clear
          </AssetBatchButton>
        </AssetSelectionToolbar>
      )}
      {(error || actionError) && <AssetError>{actionError || error}</AssetError>}
      {!items.length ? (
        <AssetEmptyState>
          {loading ? "Loading untracked assets..." : "No untracked scratch files yet. Snips and edits will appear here before you track them."}
        </AssetEmptyState>
      ) : (
        <AssetGrid aria-label="Untracked asset scratch grid">
          {items.map((asset, index) => {
            const id = assetId(asset, `untracked-${index}`);
            const name = assetName(asset, `Scratch ${index + 1}`);
            const localPath = assetLocalPath(asset);
            const previewUrl = assetPreviewUrl(asset);
            const previewKey = `${id}:${previewUrl}`;
            const shouldShowImagePreview = Boolean(previewUrl && !failedPreviewKeys.has(previewKey));
            const shouldOpenHyperframeEditor = !shouldShowImagePreview && assetCanContainHyperframe(asset) && Boolean(localPath);
            const openBusy = busyKey === `open:${id}`;
            const viewBusy = busyKey === `view:${id}`;
            const copyBusy = busyKey === `copy:${id}`;
            const trackBusy = busyKey === `track:${id}`;
            const renameBusy = busyKey === `rename:${id}`;
            const deleteBusy = busyKey === `delete:${id}`;
            const canView = assetIsImage(asset) && Boolean(localPath);
            const canCopy = assetIsImage(asset) && Boolean(localPath);
            const selected = selectedAssetIds.has(id);

            return (
              <AssetCard data-selected={selected ? "true" : "false"} data-status="parked" key={id} title={localPath || name}>
                <AssetCardPreview
                  aria-label={shouldShowImagePreview ? `Open ${name} in image editor` : shouldOpenHyperframeEditor ? `Open ${name} in Hyperframe editor` : `Open ${name}`}
                  disabled={!localPath || Boolean(busyKey)}
                  onClick={() => runUntrackedAction(shouldShowImagePreview ? "view" : "open", asset)}
                  title={shouldShowImagePreview ? "Open big view and annotate" : shouldOpenHyperframeEditor ? "Open Hyperframe editor" : "Open file"}
                  type="button"
                >
                  {shouldShowImagePreview ? (
                    <AssetPreviewImage
                      alt={name}
                      decoding="async"
                      draggable={false}
                      loading={index < 20 ? "eager" : "lazy"}
                      onError={(event) => {
                        event.currentTarget.hidden = true;
                        setFailedPreviewKeys((current) => {
                          const next = new Set(current);
                          next.add(previewKey);
                          return next;
                        });
                      }}
                      src={previewUrl}
                    />
                  ) : (
                    <AssetDocumentPreview aria-hidden="true">
                      <AssetDocumentGlyph>
                        <InsertDriveFile aria-hidden="true" />
                        <span>{assetFileTypeLabel(asset)}</span>
                      </AssetDocumentGlyph>
                    </AssetDocumentPreview>
                  )}
                </AssetCardPreview>
                <AssetCardStatus data-status="parked" title="This file is local scratch and is not synced">
                  Untracked
                </AssetCardStatus>
                <AssetSelectButton
                  aria-label={`${selected ? "Deselect" : "Select"} ${name}`}
                  aria-pressed={selected}
                  data-selected={selected ? "true" : "false"}
                  disabled={Boolean(busyKey)}
                  onClick={() => toggleAssetSelected(asset)}
                  title={selected ? "Deselect asset" : "Select asset"}
                  type="button"
                >
                  {selected ? <CheckBox aria-hidden="true" /> : <CheckBoxOutlineBlank aria-hidden="true" />}
                </AssetSelectButton>
                <AssetCardActions>
                  {canView && (
                    <AssetIconButton
                      aria-label={`Open big view for ${name}`}
                      disabled={!localPath || viewBusy || Boolean(busyKey && !viewBusy)}
                      onClick={() => runUntrackedAction("view", asset)}
                      title="Open big view and annotate"
                      type="button"
                    >
                      <OpenInFull aria-hidden="true" />
                    </AssetIconButton>
                  )}
                  {canCopy && (
                    <AssetIconButton
                      aria-label={`Copy ${name} to clipboard`}
                      disabled={!localPath || copyBusy || Boolean(busyKey && !copyBusy)}
                      onClick={() => runUntrackedAction("copy", asset)}
                      title="Copy image to clipboard"
                      type="button"
                    >
                      <ContentCopy aria-hidden="true" />
                    </AssetIconButton>
                  )}
                  <AssetIconButton
                    aria-label={`Open ${name}`}
                    disabled={!localPath || openBusy || Boolean(busyKey && !openBusy)}
                    onClick={() => runUntrackedAction("open", asset)}
                    title="Open file"
                    type="button"
                  >
                    <FileOpen aria-hidden="true" />
                  </AssetIconButton>
                  <AssetIconButton
                    aria-label={`Track ${name}`}
                    data-primary="true"
                    disabled={!localPath || !onPromote || trackBusy || Boolean(busyKey && !trackBusy)}
                    onClick={() => runUntrackedAction("track", asset)}
                    title="Track this scratch asset"
                    type="button"
                  >
                    <AddToPhotos aria-hidden="true" />
                  </AssetIconButton>
                  <AssetIconButton
                    aria-label={`Rename ${name}`}
                    disabled={!localPath || !onRename || renameBusy || Boolean(busyKey && !renameBusy)}
                    onClick={() => runUntrackedAction("rename", asset)}
                    title="Rename scratch file"
                    type="button"
                  >
                    <DriveFileRenameOutline aria-hidden="true" />
                  </AssetIconButton>
                  <AssetIconButton
                    aria-label={`Delete ${name}`}
                    data-danger="true"
                    disabled={!localPath || !onDelete || deleteBusy || Boolean(busyKey && !deleteBusy)}
                    onClick={() => runUntrackedAction("delete", asset)}
                    title="Delete scratch file"
                    type="button"
                  >
                    <Delete aria-hidden="true" />
                  </AssetIconButton>
                </AssetCardActions>
                <AssetCardCaption>
                  <AssetCardName>{name}</AssetCardName>
                </AssetCardCaption>
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

const AssetModeTabList = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  margin-top: 6px;
  padding: 3px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.28);
`;

const AssetModeTab = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: rgba(203, 213, 225, 0.74);
  background: transparent;
  font: inherit;
  font-size: 9px;
  font-weight: 900;
  line-height: 1;
  text-transform: uppercase;
  cursor: pointer;

  span {
    color: rgba(148, 163, 184, 0.8);
    font-size: 8px;
    font-weight: 900;
  }

  &:hover,
  &:focus-visible {
    border-color: rgba(125, 211, 252, 0.24);
    color: rgba(224, 242, 254, 0.94);
    background: rgba(14, 165, 233, 0.1);
  }

  &[data-active="true"] {
    border-color: rgba(45, 212, 191, 0.26);
    color: rgba(204, 251, 241, 0.96);
    background: rgba(13, 148, 136, 0.16);

    span {
      color: rgba(204, 251, 241, 0.78);
    }
  }
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

  &[data-state="synced"] {
    border-color: rgba(45, 212, 191, 0.2);
    color: rgba(204, 251, 241, 0.82);
    background: rgba(13, 148, 136, 0.12);
  }

  &[data-state="local"] {
    border-color: rgba(245, 158, 11, 0.22);
    color: rgba(253, 230, 138, 0.86);
    background: rgba(146, 64, 14, 0.12);
  }
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

const AssetCloudControls = styled.div`
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
`;

const AssetCloudButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  max-width: 190px;
  padding: 0 9px;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 7px;
  color: rgba(203, 213, 225, 0.78);
  background: rgba(15, 23, 42, 0.36);
  font: inherit;
  font-size: 10px;
  font-weight: 850;
  line-height: 1;
  cursor: pointer;

  svg {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

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

const AssetCloudSettings = styled.div`
  display: grid;
  grid-template-columns: minmax(180px, 0.85fr) minmax(260px, 1.15fr);
  gap: 10px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.15);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.36);

  @media (max-width: 820px) {
    grid-template-columns: 1fr;
  }
`;

const AssetCloudList = styled.div`
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 0;
  max-height: 220px;
  overflow: auto;
`;

const AssetCloudRow = styled.div`
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 7px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.34);

  > svg {
    width: 16px;
    height: 16px;
    color: rgba(125, 211, 252, 0.78);
  }

  &[data-active="true"] {
    border-color: rgba(45, 212, 191, 0.26);
    background: rgba(13, 148, 136, 0.12);
  }
`;

const AssetCloudRowText = styled.div`
  min-width: 0;

  strong,
  span {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: rgba(241, 245, 249, 0.92);
    font-size: 10px;
    font-weight: 900;
  }

  span {
    margin-top: 2px;
    color: rgba(148, 163, 184, 0.82);
    font-size: 9px;
    font-weight: 720;
  }
`;

const AssetCloudRowActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
`;

const AssetCloudForm = styled.form`
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
`;

const AssetProviderTabs = styled.div`
  display: inline-flex;
  gap: 4px;
  width: max-content;
  padding: 3px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.34);
`;

const AssetProviderButton = styled.button`
  min-height: 24px;
  padding: 0 9px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: rgba(203, 213, 225, 0.76);
  background: transparent;
  font: inherit;
  font-size: 9px;
  font-weight: 900;
  cursor: pointer;

  &[data-active="true"],
  &:hover,
  &:focus-visible {
    border-color: rgba(45, 212, 191, 0.26);
    color: rgba(204, 251, 241, 0.96);
    background: rgba(13, 148, 136, 0.18);
  }
`;

const AssetCloudFields = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  min-width: 0;

  @media (max-width: 620px) {
    grid-template-columns: 1fr;
  }
`;

const AssetCloudInput = styled.input`
  min-width: 0;
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 7px;
  color: rgba(226, 232, 240, 0.92);
  background: rgba(15, 23, 42, 0.5);
  font: inherit;
  font-size: 10px;
  font-weight: 760;
  outline: none;

  &:focus {
    border-color: rgba(125, 211, 252, 0.42);
  }

  &::placeholder {
    color: rgba(148, 163, 184, 0.64);
  }
`;

const AssetCloudFormFooter = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;

  label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: rgba(203, 213, 225, 0.78);
    font-size: 10px;
    font-weight: 820;
  }
`;

const AssetMiniButton = styled.button`
  min-height: 26px;
  padding: 0 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 6px;
  color: rgba(226, 232, 240, 0.84);
  background: rgba(15, 23, 42, 0.48);
  font: inherit;
  font-size: 9px;
  font-weight: 850;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(125, 211, 252, 0.34);
    color: rgba(224, 242, 254, 0.94);
    background: rgba(14, 165, 233, 0.14);
  }

  &[data-primary="true"] {
    border-color: rgba(45, 212, 191, 0.26);
    color: rgba(204, 251, 241, 0.96);
    background: rgba(13, 148, 136, 0.16);
  }

  &[data-danger="true"] {
    border-color: rgba(251, 113, 133, 0.2);
    color: rgba(254, 205, 211, 0.9);
    background: rgba(127, 29, 29, 0.16);
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

const AssetCloudError = styled.div`
  padding: 7px 8px;
  border: 1px solid rgba(248, 113, 113, 0.22);
  border-radius: 7px;
  color: rgba(254, 202, 202, 0.92);
  background: rgba(127, 29, 29, 0.12);
  font-size: 10px;
  font-weight: 760;
  overflow-wrap: anywhere;
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

const AssetSelectionToolbar = styled.div`
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 7px;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid rgba(45, 212, 191, 0.18);
  border-radius: 9px;
  background: rgba(13, 148, 136, 0.1);

  strong {
    color: rgba(204, 251, 241, 0.96);
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  span {
    color: rgba(203, 213, 225, 0.72);
    font-size: 10px;
    font-weight: 780;
  }
`;

const AssetBatchButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.86);
  background: rgba(15, 23, 42, 0.42);
  font: inherit;
  font-size: 10px;
  font-weight: 850;
  cursor: pointer;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(125, 211, 252, 0.34);
    color: rgba(224, 242, 254, 0.95);
    background: rgba(14, 165, 233, 0.14);
  }

  &[data-primary="true"] {
    border-color: rgba(45, 212, 191, 0.26);
    color: rgba(204, 251, 241, 0.96);
    background: rgba(13, 148, 136, 0.16);
  }

  &[data-danger="true"] {
    border-color: rgba(251, 113, 133, 0.2);
    color: rgba(254, 205, 211, 0.9);
    background: rgba(127, 29, 29, 0.16);
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
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
      transform: translate(-50%, 0);
    }

    [data-asset-select="true"] {
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

  &[data-selected="true"] {
    border-color: rgba(45, 212, 191, 0.5);
    box-shadow:
      0 12px 28px rgba(2, 6, 23, 0.34),
      0 0 0 1px rgba(45, 212, 191, 0.22);
  }

  @media (hover: none) {
    [data-asset-actions="true"] {
      opacity: 1;
      pointer-events: auto;
      transform: translate(-50%, 0);
    }

    [data-asset-select="true"] {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }
  }
`;

const AssetCardPreview = styled.button`
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  padding: 0;
  border: 0;
  color: inherit;
  background: rgba(15, 23, 42, 0.44);
  font: inherit;
  text-align: inherit;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid rgba(125, 211, 252, 0.46);
    outline-offset: -3px;
  }

  &:disabled {
    cursor: default;
  }
`;

const AssetDocumentPreview = styled.div`
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
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
  padding: 7px 7px 45px;
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
  max-width: calc(100% - 50px);
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

const AssetSelectButton = styled.button.attrs({ "data-asset-select": "true" })`
  position: absolute;
  top: 7px;
  right: 7px;
  z-index: 5;
  display: inline-grid;
  width: 28px;
  height: 28px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.84);
  background: rgba(2, 6, 23, 0.82);
  opacity: 0;
  pointer-events: none;
  transform: translateY(-3px);
  cursor: pointer;
  transition: opacity 130ms ease, transform 130ms ease;
  backdrop-filter: blur(8px);

  svg {
    width: 17px;
    height: 17px;
  }

  &:hover:not(:disabled),
  &:focus-visible,
  &[data-selected="true"] {
    border-color: rgba(45, 212, 191, 0.36);
    color: rgba(204, 251, 241, 0.96);
    background: rgba(13, 148, 136, 0.2);
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`;

const AssetCardActions = styled.div.attrs({ "data-asset-actions": "true" })`
  position: absolute;
  right: auto;
  bottom: 34px;
  left: 50%;
  z-index: 4;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 4px;
  max-width: calc(100% - 14px);
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 999px;
  background: rgba(2, 6, 23, 0.58);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 5px);
  transition: opacity 130ms ease, transform 130ms ease;
  backdrop-filter: blur(10px);

  button {
    width: 26px;
    height: 26px;
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

const AssetCardMetaLine = styled.span`
  display: block;
  min-width: 0;
  overflow: hidden;
  margin-top: 2px;
  color: rgba(148, 163, 184, 0.82);
  font-size: 9px;
  font-weight: 650;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-failed="true"] {
    color: rgba(254, 205, 211, 0.9);
  }
`;

const AssetTransferOverlay = styled.div`
  position: absolute;
  top: 32px;
  right: 7px;
  left: 7px;
  z-index: 4;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 7px;
  background: rgba(2, 6, 23, 0.88);
  backdrop-filter: blur(8px);
`;

const AssetTransferInfo = styled.div`
  flex: 1 1 auto;
  min-width: 0;
  display: grid;
  gap: 4px;
`;

const AssetTransferLabel = styled.span`
  overflow: hidden;
  color: rgba(191, 219, 254, 0.9);
  font-size: 8px;
  font-weight: 850;
  line-height: 1;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
`;

const AssetTransferTrack = styled.div`
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.18);
`;

const AssetTransferFill = styled.div`
  height: 100%;
  min-width: 4%;
  border-radius: inherit;
  background: rgba(96, 165, 250, 0.92);
  transition: width 200ms ease;
`;

const AssetTransferCancel = styled.button`
  display: inline-grid;
  flex: 0 0 auto;
  width: 20px;
  height: 20px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(251, 113, 133, 0.28);
  border-radius: 999px;
  color: rgba(254, 205, 211, 0.92);
  background: rgba(2, 6, 23, 0.85);
  cursor: pointer;

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover:not(:disabled) {
    border-color: rgba(251, 113, 133, 0.5);
    background: rgba(159, 18, 57, 0.28);
  }

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
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

  &[data-primary="true"] {
    border-color: rgba(45, 212, 191, 0.28);
    color: rgba(204, 251, 241, 0.96);
    background: rgba(13, 148, 136, 0.18);

    &:hover:not(:disabled),
    &:focus-visible {
      border-color: rgba(45, 212, 191, 0.46);
      background: rgba(13, 148, 136, 0.28);
    }
  }

  &[data-warning="true"] {
    border-color: rgba(251, 191, 36, 0.22);
    color: rgba(254, 240, 138, 0.9);
    background: rgba(113, 63, 18, 0.18);

    &:hover:not(:disabled),
    &:focus-visible {
      border-color: rgba(251, 191, 36, 0.4);
      background: rgba(146, 64, 14, 0.26);
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

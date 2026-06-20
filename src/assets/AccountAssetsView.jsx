import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import styled, { keyframes } from "styled-components";
import { AddToPhotos } from "@styled-icons/material-rounded/AddToPhotos";
import { Cached } from "@styled-icons/material-rounded/Cached";
import { CheckBox } from "@styled-icons/material-rounded/CheckBox";
import { CheckBoxOutlineBlank } from "@styled-icons/material-rounded/CheckBoxOutlineBlank";
import { Cloud } from "@styled-icons/material-rounded/Cloud";
import { CloudDownload } from "@styled-icons/material-rounded/CloudDownload";
import { CloudOff } from "@styled-icons/material-rounded/CloudOff";
import { CloudUpload } from "@styled-icons/material-rounded/CloudUpload";
import { ContentCopy } from "@styled-icons/material-rounded/ContentCopy";
import { Close } from "@styled-icons/material-rounded/Close";
import { Delete } from "@styled-icons/material-rounded/Delete";
import { DriveFileRenameOutline } from "@styled-icons/material-rounded/DriveFileRenameOutline";
import { FileOpen } from "@styled-icons/material-rounded/FileOpen";
import { Info } from "@styled-icons/material-rounded/Info";
import { InsertDriveFile } from "@styled-icons/material-rounded/InsertDriveFile";
import { Link } from "@styled-icons/material-rounded/Link";
import { ModeEdit } from "@styled-icons/material-rounded/ModeEdit";
import { MoveToInbox } from "@styled-icons/material-rounded/MoveToInbox";
import { PinOff } from "@styled-icons/fluentui-system-regular/PinOff";
import { Public } from "@styled-icons/material-rounded/Public";
import { PushPin } from "@styled-icons/material-rounded/PushPin";
import { Settings } from "@styled-icons/material-rounded/Settings";
import { CloudQueue } from "@styled-icons/material-rounded/CloudQueue";
import { Computer } from "@styled-icons/material-rounded/Computer";
import { Devices } from "@styled-icons/material-rounded/Devices";
import MediaTranscriptChip from "./MediaTranscriptChip.jsx";
import { accountAssetFanoutFromValue } from "./accountAssetV2.js";
import { adoptAccountAssetsLibraryEvent } from "./useAccountAssetsLibrary.js";

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

function assetLibraryItems(value) {
  const object = jsonObject(value) || {};
  const data = jsonObject(object.data) || object;
  const direct = jsonArray(data.items).length
    ? jsonArray(data.items)
    : jsonArray(data.assets);
  if (direct.length) return direct;
  const fanout = accountAssetFanoutFromValue(data);
  if (fanout) return jsonArray(fanout.items);
  return direct;
}

function assetLibraryTransfers(value) {
  const object = jsonObject(value) || {};
  const data = jsonObject(object.data) || object;
  const direct = jsonArray(data.transfers);
  if (direct.length) return direct;
  const fanout = accountAssetFanoutFromValue(data);
  if (fanout) return jsonArray(fanout.transfers);
  return direct;
}

function assetLibraryAggregate(value) {
  const object = jsonObject(value) || {};
  const data = jsonObject(object.data) || object;
  return jsonObject(data.aggregate) || {};
}

function assetLibraryClouds(value) {
  const object = jsonObject(value) || {};
  const data = jsonObject(object.data) || object;
  const fanout = accountAssetFanoutFromValue(data);
  const direct = jsonArray(fanout?.clouds).length
    ? jsonArray(fanout.clouds)
    : jsonArray(data.clouds).length
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
  if ([
    "uploading",
    "upload-queued",
    "upload-prepared",
    "download-queued",
    "download-prepared",
    "downloading",
    "prepared",
    "preparing",
    "queued",
    "verifying",
    "committing",
    "transferring",
    "warming-cache",
    "cache-warming",
  ].includes(normalized)) return "active";
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

function assetTransferDirection(transfer) {
  const direction = text(transfer?.direction || transfer?.transferDirection || transfer?.transfer_direction).toLowerCase();
  if (direction.includes("download")) return "download";
  if (direction.includes("upload")) return "upload";
  return "";
}

function assetTransferCacheKey(assetIdValue, cloudId = DEFAULT_ASSET_CLOUD_ID, direction = "upload") {
  const id = text(assetIdValue);
  if (!id) return "";
  return `${id}:${text(cloudId, DEFAULT_ASSET_CLOUD_ID).toLowerCase()}:${text(direction, "upload").toLowerCase()}`;
}

function assetTransferShadowedByAsset(transfer, asset, cloudId = DEFAULT_ASSET_CLOUD_ID) {
  const status = text(transfer?.status || transfer?.transferStatus || transfer?.transfer_status).toLowerCase();
  if (!["failed", "interrupted"].includes(status)) return false;
  const direction = assetTransferDirection(transfer);
  if (direction === "upload") return assetCloudAvailable(asset, cloudId);
  if (direction === "download") return assetLocalAvailable(asset);
  return false;
}

function assetTransferClearedOnRestart(transfer) {
  const status = text(transfer?.status || transfer?.transferStatus || transfer?.transfer_status).toLowerCase();
  if (status !== "interrupted") return false;
  const error = text(transfer?.error || transfer?.errorMessage || transfer?.error_message).toLowerCase();
  return error.includes("diff forge reopened") || error.includes("previous-process asset transfer");
}

function latestAssetTransfer(transfers, asset, cloudId = DEFAULT_ASSET_CLOUD_ID) {
  const id = assetId(asset);
  if (!id) return null;
  const selectedCloud = text(cloudId, DEFAULT_ASSET_CLOUD_ID);
  const rows = transfers
    .filter((transfer) => assetTransferAssetId(transfer) === id && assetTransferCloudId(transfer) === selectedCloud)
    .filter((transfer) => !assetTransferClearedOnRestart(transfer))
    .sort((left, right) => assetTransferUpdatedAt(right) - assetTransferUpdatedAt(left));
  return rows.find((transfer) => assetTransferStatusKind(transfer) === "active")
    || rows.find((transfer) => !assetTransferShadowedByAsset(transfer, asset, selectedCloud))
    || null;
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

function formatAssetBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 || size >= 10 ? 0 : 1;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
}

function formatAssetTimestamp(value) {
  const source = text(value);
  if (!source) return "";
  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) return source;
  return parsed.toLocaleString([], {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function assetTransferBytesSummary(transfer) {
  const total = Number(transfer?.bytesTotal ?? transfer?.bytes_total ?? 0) || 0;
  const done = Number(transfer?.bytesDone ?? transfer?.bytes_done ?? 0) || 0;
  if (total <= 0 && done <= 0) return "";
  if (total > 0) {
    return `${formatAssetBytes(done)} of ${formatAssetBytes(total)} (${assetTransferPercent(transfer)}%)`;
  }
  return formatAssetBytes(done);
}

function assetTransferDirectionLabel(transfer) {
  const direction = assetTransferDirection(transfer);
  if (direction === "upload") return "Uploading";
  if (direction === "download") return "Downloading";
  return "Syncing";
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

function assetDeviceId(device) {
  return text(
    device?.deviceId
      || device?.device_id
      || device?.machineId
      || device?.machine_id
      || device?.id,
  );
}

function assetDeviceName(device) {
  return text(
    device?.deviceName
      || device?.device_name
      || device?.machineName
      || device?.machine_name
      || device?.hostname
      || device?.name,
    assetDeviceId(device),
  );
}

function assetDeviceLocalAvailable(device) {
  const explicit = device?.localAvailable ?? device?.local_available ?? device?.available;
  if (typeof explicit === "boolean") return explicit;
  const status = text(
    device?.localStatus
      || device?.local_status
      || device?.status
      || device?.availability,
  ).toLowerCase().replace(/[_\s]+/gu, "-");
  return ["available", "local-available", "present", "ready", "synced"].includes(status);
}

function assetCurrentDeviceLocalAvailable(asset, currentDeviceId = "") {
  const currentId = text(currentDeviceId).toLowerCase();
  if (!currentId) return false;
  return assetDeviceRows(asset).some((device) => {
    if (!assetDeviceLocalAvailable(device)) return false;
    const id = assetDeviceId(device).toLowerCase();
    return id === currentId
      || device?.current
      || device?.isCurrent
      || device?.is_current
      || device?.currentDevice
      || device?.current_device;
  });
}

function assetDeviceUpdatedAt(device) {
  return text(
    device?.updatedAt
      || device?.updated_at
      || device?.lastSeenAt
      || device?.last_seen_at
      || device?.seenAt
      || device?.seen_at,
  );
}

function assetRemoteDevices(asset, currentDeviceId = "") {
  const currentId = text(currentDeviceId).toLowerCase();
  const seen = new Set();
  const remoteDevices = [];
  const localPath = assetLocalPath(asset);
  assetDeviceRows(asset).forEach((device) => {
    if (!assetDeviceLocalAvailable(device)) return;
    const id = assetDeviceId(device);
    const idKey = id.toLowerCase();
    if (currentId && idKey === currentId) return;
    if (device?.current || device?.isCurrent || device?.is_current || device?.currentDevice || device?.current_device) return;
    const devicePath = text(device?.localPath || device?.local_path || device?.path);
    if (!currentId && localPath && devicePath && devicePath === localPath) return;
    const name = assetDeviceName(device);
    const key = (id || name).toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      remoteDevices.push({
        ...device,
        deviceId: id,
        deviceName: name,
        updatedAt: assetDeviceUpdatedAt(device),
      });
    }
  });
  return remoteDevices;
}

function assetRemoteDeviceNames(asset, currentDeviceId = "") {
  return assetRemoteDevices(asset, currentDeviceId).map((device) => device.deviceName);
}

function assetLocalPath(asset) {
  return text(
    asset?.localPath
      || asset?.local_path
      || asset?.path,
  );
}

function assetLocalAvailable(asset) {
  const explicit = asset?.localAvailable ?? asset?.local_available;
  if (typeof explicit === "boolean") return explicit && Boolean(assetLocalPath(asset));
  const localStatus = text(asset?.localStatus || asset?.local_status).toLowerCase().replace(/[_\s]+/gu, "-");
  if (["deleted", "local-deleted", "local-missing", "missing", "not-found", "unavailable"].includes(localStatus)) return false;
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

function assetAvailability(asset, cloudId = DEFAULT_ASSET_CLOUD_ID, cloudLabel = "Cloud", currentDeviceId = "") {
  const hasCurrentDevicePresence = assetCurrentDeviceLocalAvailable(asset, currentDeviceId);
  const hasLocal = assetLocalAvailable(asset);
  const hasCloud = assetCloudAvailable(asset, cloudId);
  const remoteDevices = assetRemoteDevices(asset, currentDeviceId);
  const remoteCount = remoteDevices.length;
  const hasRemote = remoteCount > 0;
  const parts = [];
  if (hasLocal) parts.push("Local");
  if (hasCloud) parts.push("Cloud");
  if (hasRemote) parts.push(`Remote (${remoteCount})`);
  if (!parts.length) {
    return {
      hasCloud,
      hasCurrentDevicePresence,
      hasLocal,
      hasRemote,
      label: "Unavailable",
      remoteCount,
      remoteDevices,
      statusKind: "failed",
    };
  }
  return {
    hasCloud,
    hasCurrentDevicePresence,
    hasLocal,
    hasRemote,
    label: parts.join(" + "),
    remoteCount,
    remoteDevices,
    statusKind: hasLocal || hasCloud ? "done" : "remote",
  };
}

function AssetAvailabilityBadges({
  availability,
  cloudLabel = "Cloud",
  currentDeviceName = "this device",
  remoteDeviceNames = [],
}) {
  const remoteCount = numberValue(availability?.remoteCount);
  const remoteLabel = remoteCount > 99 ? "99+" : String(remoteCount);
  const remoteTitle = remoteDeviceNames.length
    ? `Remote on ${remoteDeviceNames.join(", ")}`
    : `Remote on ${remoteCount} device${remoteCount === 1 ? "" : "s"}`;
  const groupLabel = `Availability: ${availability?.label || "Unavailable"}`;

  if (!availability?.hasLocal && !availability?.hasCloud && !availability?.hasRemote) {
    return (
      <AssetAvailabilityBadgeGroup aria-label={groupLabel} title={groupLabel}>
        <AssetAvailabilityBadge aria-label="Unavailable" data-kind="unavailable" title="No local, cloud, or remote copy found">
          <span aria-hidden="true">!</span>
        </AssetAvailabilityBadge>
      </AssetAvailabilityBadgeGroup>
    );
  }

  return (
    <AssetAvailabilityBadgeGroup aria-label={groupLabel} title={groupLabel}>
      {availability?.hasLocal && (
        <AssetAvailabilityBadge aria-label={`Local on ${currentDeviceName}`} data-kind="local" title={`Local on ${currentDeviceName}`}>
          <Computer aria-hidden="true" />
        </AssetAvailabilityBadge>
      )}
      {availability?.hasCloud && (
        <AssetAvailabilityBadge aria-label={`Cloud copy in ${cloudLabel}`} data-kind="cloud" title={`Cloud copy in ${cloudLabel}`}>
          <CloudQueue aria-hidden="true" />
        </AssetAvailabilityBadge>
      )}
      {availability?.hasRemote && (
        <AssetAvailabilityBadge aria-label={remoteTitle} data-kind="remote" title={remoteTitle}>
          <span aria-hidden="true">{remoteLabel}</span>
        </AssetAvailabilityBadge>
      )}
    </AssetAvailabilityBadgeGroup>
  );
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
  if (!localPath || !assetLocalAvailable(asset) || !assetIsImage(asset)) return "";
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

function assetSha(asset) {
  return text(asset?.sha256 || asset?.hash || asset?.contentHash || asset?.content_hash);
}

function assetPublicLink(asset) {
  return jsonObject(asset?.publicLink || asset?.public_link) || null;
}

function assetPublicUrl(asset) {
  const link = assetPublicLink(asset);
  return text(
    asset?.publicUrl
      || asset?.public_url
      || link?.publicUrl
      || link?.public_url
      || link?.url,
  );
}

function assetTransferFailureDetails({
  asset,
  assetIdValue,
  cloudId,
  cloudLabel,
  direction,
  transfer,
}) {
  const details = [];
  const cloudName = text(cloudLabel, cloudId || "Cloud");
  if (cloudName) details.push(`Cloud: ${cloudName}`);
  const bytes = transfer ? assetTransferBytesSummary(transfer) : "";
  if (bytes) details.push(`Progress: ${bytes}`);
  const transferId = transfer ? assetTransferId(transfer) : "";
  if (transferId) details.push(`Transfer: ${shortLabel(transferId, 22)}`);
  const id = text(assetIdValue || assetId(asset));
  if (id) details.push(`Asset ID: ${shortLabel(id, 22)}`);
  const localPath = assetLocalPath(asset);
  if (direction === "upload" && localPath) details.push(`Local path: ${localPath}`);
  return details;
}

function assetTransferFailureFromAction(action, asset, cloudLabel, cloudId, error) {
  const direction = action === "download" ? "download" : action === "upload" ? "upload" : "";
  if (!direction) return null;
  const operation = direction === "download" ? "Download" : "Upload";
  const id = assetId(asset);
  const errorMessage = error?.message || String(error || `${operation} failed.`);
  return {
    assetId: id,
    cloudId,
    details: assetTransferFailureDetails({
      asset,
      assetIdValue: id,
      cloudId,
      cloudLabel,
      direction,
      transfer: null,
    }),
    direction,
    key: `action:${direction}:${cloudId}:${id}:${Date.now()}`,
    message: errorMessage,
    title: `${operation} failed for ${assetName(asset, "asset")}`,
    updatedAt: Date.now(),
  };
}

function assetToastCopyText(toast) {
  return [
    text(toast?.title),
    text(toast?.message),
    ...jsonArray(toast?.details).map((detail) => text(detail)).filter(Boolean),
  ]
    .filter(Boolean)
    .join("\n");
}

function createAssetToastId(kind = "toast") {
  return `${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`;
}

async function copyTextToClipboard(value) {
  const normalized = text(value);
  if (!normalized) return false;
  if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
    await navigator.clipboard.writeText(normalized);
    return true;
  }
  return false;
}

export default function AccountAssetsView({
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
  void rootDirectory;
  void defaultWorkingDirectory;
  const [assetMode, setAssetMode] = useState("tracked");
  const trackedItems = useMemo(() => assetLibraryItems(library), [library]);
  const untrackedItems = useMemo(() => assetLibraryItems(untrackedLibrary), [untrackedLibrary]);
  const trackedCount = trackedItems.length;
  const untrackedCount = untrackedItems.length;

  return (
    <AssetsSurface aria-label="Account Assets" data-state={loading ? "loading" : "ready"}>
      {assetMode === "untracked" ? (
        <UntrackedAssetsPanel
          assetMode={assetMode}
          error={untrackedError}
          library={untrackedLibrary}
          loading={untrackedLoading}
          onAssetModeChange={setAssetMode}
          onDelete={onUntrackedDelete}
          onPromote={onUntrackedPromote}
          onRefresh={onUntrackedRefresh}
          onRename={onUntrackedRename}
          onTrackedRefresh={onRefresh}
          syncing={untrackedSyncing}
          trackedCount={trackedCount}
          untrackedCount={untrackedCount}
        />
      ) : (
        <AssetsPanel
          assetMode={assetMode}
          error={error}
          library={library}
          loading={loading}
          onAssetModeChange={setAssetMode}
          onLoadCached={onLoadCached}
          onRefresh={onRefresh}
          repoLabel="Assets"
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

function useAssetToastController() {
  const [assetToasts, setAssetToasts] = useState([]);
  const dismissedToastKeysRef = useRef(new Set());

  const enqueueAssetToast = useCallback((toast) => {
    const kind = text(toast?.kind, "success");
    const key = text(toast?.key, createAssetToastId(kind));
    const nextToast = {
      ...toast,
      key,
      kind,
      createdAt: Date.now(),
      details: jsonArray(toast?.details),
    };
    dismissedToastKeysRef.current.delete(key);
    setAssetToasts((current) => {
      const withoutDuplicate = current.filter((item) => item.key !== key);
      return [...withoutDuplicate, nextToast].slice(-6);
    });
  }, []);

  const dismissAssetToast = useCallback((key) => {
    dismissedToastKeysRef.current.add(key);
    setAssetToasts((current) => current.filter((toast) => toast.key !== key));
  }, []);

  const showAssetToast = useCallback((kind, title, message, details = [], key = "") => {
    enqueueAssetToast({
      kind,
      title,
      message,
      details,
      key: key || createAssetToastId(kind),
    });
  }, [enqueueAssetToast]);

  return {
    assetToasts,
    dismissAssetToast,
    dismissedToastKeysRef,
    enqueueAssetToast,
    showAssetToast,
  };
}

function AssetsPanel({
  assetMode = "tracked",
  error = "",
  library = null,
  loading = false,
  onAssetModeChange,
  onLoadCached,
  onRefresh,
  repoLabel,
  syncing = false,
  trackedCount = 0,
  untrackedCount = 0,
}) {
  const items = useMemo(() => assetLibraryItems(library), [library]);
  const transfers = useMemo(() => assetLibraryTransfers(library), [library]);
  const aggregate = useMemo(() => assetLibraryAggregate(library), [library]);
  const libraryClouds = useMemo(() => assetLibraryClouds(library), [library]);
  const currentDeviceId = text(
    library?.currentDeviceId
      || library?.current_device_id
      || library?.deviceId
      || library?.device_id
      || library?.device?.deviceId
      || library?.device?.device_id,
  );
  const currentDeviceName = text(
    library?.currentDeviceName
      || library?.current_device_name
      || library?.deviceName
      || library?.device_name
      || library?.device?.deviceName
      || library?.device?.device_name,
    "This device",
  );
  const [cloudsOverride, setCloudsOverride] = useState([]);
  const [infoAssetId, setInfoAssetId] = useState("");
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
  const [busyKey, setBusyKey] = useState("");
  const {
    assetToasts,
    dismissAssetToast,
    dismissedToastKeysRef,
    enqueueAssetToast,
    showAssetToast,
  } = useAssetToastController();
  const [failedPreviewKeys, setFailedPreviewKeys] = useState(() => new Set());
  const [selectedAssetIds, setSelectedAssetIds] = useState(() => new Set());
  const [optimisticTransfers, setOptimisticTransfers] = useState({});

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

  const filteredItems = items;
  const visibleAssetIds = useMemo(
    () => new Set(filteredItems.map((asset) => assetId(asset)).filter(Boolean)),
    [filteredItems],
  );
  const infoAsset = useMemo(() => (
    filteredItems.find((asset) => assetId(asset) === infoAssetId) || null
  ), [filteredItems, infoAssetId]);
  const optimisticTransferRows = useMemo(() => Object.values(optimisticTransfers), [optimisticTransfers]);
  const visibleTransfers = useMemo(() => {
    const rows = [...transfers, ...optimisticTransferRows];
    return rows
      .filter((transfer) => visibleAssetIds.has(text(transfer?.assetId || transfer?.asset_id)))
      .filter((transfer) => assetTransferCloudId(transfer) === effectiveCloudId);
  }, [effectiveCloudId, optimisticTransferRows, transfers, visibleAssetIds]);
  const activeToastKeySet = useMemo(
    () => new Set(assetToasts.map((toast) => toast.key)),
    [assetToasts],
  );
  useEffect(() => {
    const message = text(error);
    if (!message) return;
    const key = `asset-library-error:${message}`;
    if (dismissedToastKeysRef.current.has(key) || activeToastKeySet.has(key)) return;
    enqueueAssetToast({
      kind: "error",
      key,
      title: "Assets failed to load",
      message,
      details: [selectedCloudLabel],
    });
  }, [activeToastKeySet, enqueueAssetToast, error, selectedCloudLabel]);
  const cloudCount = filteredItems.filter((item) => assetAvailability(item, effectiveCloudId, selectedCloudLabel, currentDeviceId).hasCloud).length;
  const localCount = filteredItems.filter((item) => assetAvailability(item, effectiveCloudId, selectedCloudLabel, currentDeviceId).hasLocal).length;
  const remoteCount = filteredItems.filter((item) => assetAvailability(item, effectiveCloudId, selectedCloudLabel, currentDeviceId).hasRemote).length;
  const activeTransfers = numberValue(aggregate.activeTransfers ?? aggregate.active_transfers, 0)
    || visibleTransfers.filter((transfer) => assetTransferStatusKind(transfer) === "active").length;
  const activeTransferSummary = useMemo(
    () => assetTransferDeviceSummary(visibleTransfers),
    [visibleTransfers],
  );
  const assetCountPluralBase = filteredItems.length;
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
    setInfoAssetId((current) => (current && !visibleIds.has(current) ? "" : current));
  }, [filteredItems]);

  const refresh = useCallback((options = { silent: true }) => (
    typeof onRefresh === "function" ? onRefresh(options) : Promise.resolve(null)
  ), [onRefresh]);

  const refreshClouds = useCallback(async () => {
    setCloudSettingsError("");
    const response = await invoke("cloud_mcp_list_asset_clouds");
    const nextClouds = assetLibraryClouds(response);
    setCloudsOverride(nextClouds);
    return nextClouds;
  }, []);

  useEffect(() => {
    if (!cloudSettingsOpen) return;
    void refreshClouds().catch((nextError) => {
      setCloudSettingsError(nextError?.message || String(nextError || "Unable to load asset clouds."));
    });
  }, [cloudSettingsOpen, refreshClouds]);

  // Custom clouds should be selectable chips from the first render, not only
  // after the settings panel has been opened once.
  useEffect(() => {
    void refreshClouds().catch(() => {});
  }, [refreshClouds]);

  useEffect(() => {
    if (!cloudSettingsOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setCloudSettingsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cloudSettingsOpen]);

  useEffect(() => {
    if (!infoAssetId) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setInfoAssetId("");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [infoAssetId]);

  const runCloudSettingsAction = useCallback(async (action, payload = {}) => {
    const cloudId = text(payload.cloudId || payload.cloud_id || payload.id);
    const key = `${action}:${cloudId || "new"}`;
    setCloudSettingsBusy(key);
    setCloudSettingsError("");
    try {
      let response = null;
      if (action === "save") {
        response = await invoke("cloud_mcp_save_asset_cloud", {
          cloud: payload,
        });
        const savedCloud = jsonObject(response?.cloud) || {};
        const savedCloudId = text(savedCloud.cloudId || savedCloud.cloud_id || savedCloud.id);
        if (savedCloudId) {
          // A freshly added bucket becomes the active sync target right away
          // and is probed immediately so its verified/error status is honest.
          setSelectedCloudId(savedCloudId);
          try {
            await invoke("cloud_mcp_validate_asset_cloud", {
              cloudId: savedCloudId,
            });
          } catch (validationError) {
            setCloudSettingsError(
              `Cloud added, but the bucket check failed: ${validationError?.message || validationError}`,
            );
          }
          response = { clouds: await refreshClouds() };
        }
      } else if (action === "validate") {
        response = await invoke("cloud_mcp_validate_asset_cloud", {
          cloudId,
        });
      } else if (action === "default") {
        response = await invoke("cloud_mcp_set_default_asset_cloud", {
          cloudId,
        });
        if (cloudId) setSelectedCloudId(cloudId);
      } else if (action === "delete") {
        response = await invoke("cloud_mcp_delete_asset_cloud", {
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
  }, [effectiveCloudId, refresh, refreshClouds]);

  useEffect(() => {
    if (!busyKey && !activeTransfers) return undefined;
    const loadCached = () => {
      if (typeof onLoadCached === "function") void onLoadCached();
    };
    loadCached();
    const interval = window.setInterval(loadCached, 250);
    return () => window.clearInterval(interval);
  }, [activeTransfers, busyKey, onLoadCached]);

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

  const setOptimisticUploadTransfer = useCallback((asset, cloudId, status, fields = {}) => {
    const id = assetId(asset);
    const key = assetTransferCacheKey(id, cloudId, "upload");
    if (!key) return;
    const now = new Date().toISOString();
    const sizeBytes = numberValue(asset?.sizeBytes ?? asset?.size_bytes, 0);
    setOptimisticTransfers((current) => {
      const currentRow = current[key] || {};
      const transferId = currentRow.transferId || currentRow.transfer_id || `local-upload-${id}-${Date.now()}`;
      const bytesDone = status === "completed" ? sizeBytes : numberValue(fields.bytesDone ?? fields.bytes_done, 0);
      return {
        ...current,
        [key]: {
          ...currentRow,
          transferId,
          transfer_id: transferId,
          assetId: id,
          asset_id: id,
          cloudId,
          cloud_id: cloudId,
          direction: "upload",
          status,
          bytesTotal: sizeBytes,
          bytes_total: sizeBytes,
          bytesDone,
          bytes_done: bytesDone,
          updatedAt: now,
          updated_at: now,
          ...fields,
        },
      };
    });
  }, []);

  const clearOptimisticUploadTransfer = useCallback((asset, cloudId) => {
    const key = assetTransferCacheKey(assetId(asset), cloudId, "upload");
    if (!key) return;
    setOptimisticTransfers((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const runAssetAction = useCallback(async (action, asset) => {
    const id = assetId(asset);
    const name = assetName(asset, "asset");
    const localPath = assetLocalPath(asset);
    const availability = assetAvailability(asset, effectiveCloudId, selectedCloudLabel, currentDeviceId);
    if (["copy", "open", "view"].includes(action) && !localPath) return;
    if (action === "copyPublic") {
      const publicUrl = assetPublicUrl(asset);
      if (!publicUrl) return;
      const key = `${action}:${id || publicUrl}`;
      setBusyKey(key);
      try {
        const copied = await copyTextToClipboard(publicUrl);
        if (copied) {
          showAssetToast("success", "Public URL copied", "Public URL copied to clipboard.", [publicUrl]);
        } else {
          const message = "Public URL is ready, but clipboard access is unavailable.";
          showAssetToast("error", "Copy failed", message, [publicUrl]);
        }
      } catch (nextError) {
        const message = nextError?.message || String(nextError || "Unable to copy public URL.");
        showAssetToast("error", "Copy failed", message, [publicUrl]);
      } finally {
        setBusyKey((current) => (current === key ? "" : current));
      }
      return;
    }
    if (action === "open") {
      const key = `${action}:${id || localPath}`;
      setBusyKey(key);
      try {
        await openPath(localPath);
      } catch (nextError) {
        const message = nextError?.message || String(nextError || "Unable to open asset.");
        showAssetToast("error", "Open failed", message, [name, localPath]);
      } finally {
        setBusyKey((current) => (current === key ? "" : current));
      }
      return;
    }
    if (action === "copy") {
      const key = `${action}:${id || localPath}`;
      setBusyKey(key);
      try {
        await invoke("diffforge_copy_asset_to_clipboard", { path: localPath });
      } catch (nextError) {
        const message = nextError?.message || String(nextError || "Unable to copy asset.");
        showAssetToast("error", "Copy failed", message, [name, localPath]);
      } finally {
        setBusyKey((current) => (current === key ? "" : current));
      }
      return;
    }
    if (action === "view") {
      const key = `${action}:${id || localPath}`;
      setBusyKey(key);
      try {
        await invoke("snipping_open_annotation_editor", { path: localPath });
      } catch (nextError) {
        const message = nextError?.message || String(nextError || "Unable to open asset viewer.");
        showAssetToast("error", "Viewer failed", message, [name, localPath]);
      } finally {
        setBusyKey((current) => (current === key ? "" : current));
      }
      return;
    }
    if (action === "pin") {
      // Pin/unpin toggle, same as untracked scratch assets and the floating
      // preview chrome. Rust owns the source of truth for which paths are live.
      if (!localPath) return;
      const key = `${action}:${id || localPath}`;
      setBusyKey(key);
      try {
        const floatState = await invoke("snipping_snip_float_open", { path: localPath })
          .catch(() => null);
        if (floatState?.open) {
          await invoke("snipping_close_snip_float_for_path", { path: localPath });
        } else {
          await invoke("snipping_open_snip_float", { path: localPath, focused: false });
        }
      } catch (nextError) {
        const message = nextError?.message || String(nextError || "Unable to toggle asset preview.");
        showAssetToast("error", "Pin toggle failed", message, [name, localPath]);
      } finally {
        setBusyKey((current) => (current === key ? "" : current));
      }
      return;
    }
    if (!id) return;
    const key = `${action}:${id}`;
    setBusyKey(key);
    if (action === "upload") {
      setOptimisticUploadTransfer(asset, effectiveCloudId, "preparing");
    }
    try {
      if (action === "untrack") {
        // Untracking only moves the local copy back to scratch; cloud copies
        // stay until the CloudOff action removes private and public storage.
        if (!localPath) return;
        const response = await invoke("diffforge_untrack_account_asset", {
          assetId: id,
          name,
          path: localPath,
        });
        adoptAccountAssetsLibraryEvent(response);
      } else if (action === "publish") {
        const response = await invoke("cloud_mcp_publish_account_asset", {
          assetId: id,
          cloudId: effectiveCloudId,
        });
        adoptAccountAssetsLibraryEvent(response);
        const publicUrl = text(
          response?.publicUrl
            || response?.public_url
            || response?.publicLink?.publicUrl
            || response?.public_link?.public_url,
        );
        if (publicUrl) {
          const copied = await copyTextToClipboard(publicUrl);
          if (copied) {
            showAssetToast("success", "Public URL copied", "Public URL copied to clipboard.", [publicUrl]);
          } else {
            const message = "Public URL created, but clipboard access is unavailable.";
            showAssetToast("error", "Copy failed", message, [publicUrl]);
          }
        }
      } else {
        const command = action === "upload"
          ? "cloud_mcp_upload_account_asset"
          : action === "download"
            ? "cloud_mcp_download_account_asset"
            : action === "deleteLocal"
              ? "cloud_mcp_delete_local_account_asset"
              : "cloud_mcp_delete_cloud_account_asset";
        const response = await invoke(command, {
          assetId: id,
          cloudId: ["upload", "download", "deleteCloud"].includes(action) ? effectiveCloudId : undefined,
          deleteFile: action === "deleteLocal" ? true : undefined,
        });
        adoptAccountAssetsLibraryEvent(response);
        if (action === "upload") {
          setOptimisticUploadTransfer(asset, effectiveCloudId, "completed");
          await refresh({ silent: true, force: true });
          showAssetToast("success", "Upload complete", "Uploaded privately to Cloud.", [name, selectedCloudLabel]);
          clearOptimisticUploadTransfer(asset, effectiveCloudId);
          return;
        }
      }
      await refresh({ silent: true, force: true });
      if (action === "download") {
        showAssetToast("success", "Download complete", "Downloaded local copy.", [name, selectedCloudLabel]);
      } else if (action === "deleteLocal") {
        showAssetToast("success", "Local copy deleted", availability?.hasCloud ? "Cloud copy is unchanged." : "Deleted local copy.", [name]);
      } else if (action === "deleteCloud") {
        showAssetToast("success", "Cloud copy deleted", availability?.hasLocal ? "Private and public Cloud copies were removed. Local copy is unchanged." : "Private and public Cloud copies were removed.", [name, selectedCloudLabel]);
      }
    } catch (nextError) {
      if (action === "upload") {
        setOptimisticUploadTransfer(asset, effectiveCloudId, "failed", {
          error: nextError?.message || String(nextError || "Upload failed."),
        });
      }
      if (["upload", "download"].includes(action)) {
        const failure = assetTransferFailureFromAction(
          action,
          asset,
          selectedCloudLabel,
          effectiveCloudId,
          nextError,
        );
        showAssetToast("error", failure.title, failure.message, failure.details, failure.key);
      }
      const message = nextError?.message || String(nextError || `Unable to ${action} asset.`);
      if (!["upload", "download"].includes(action)) {
        showAssetToast("error", "Asset action failed", message, [name, selectedCloudLabel]);
      }
    } finally {
      setBusyKey((current) => (current === key ? "" : current));
    }
  }, [
    clearOptimisticUploadTransfer,
    currentDeviceId,
    effectiveCloudId,
    refresh,
    selectedCloudLabel,
    setOptimisticUploadTransfer,
    showAssetToast,
  ]);

  const cancelAssetTransfer = useCallback(async (asset, transfer) => {
    const id = assetId(asset);
    const transferId = assetTransferId(transfer);
    if (!id && !transferId) return;
    const key = `cancel:${id || transferId}`;
    setBusyKey(key);
    try {
      await invoke("cloud_mcp_cancel_asset_transfer", {
        assetId: id || null,
        transferId: transferId || null,
      });
      await refresh({ silent: true, force: true });
    } catch (nextError) {
      const message = nextError?.message || String(nextError || "Unable to cancel transfer.");
      showAssetToast("error", "Cancel failed", message, [assetName(asset, "asset")]);
    } finally {
      setBusyKey((current) => (current === key ? "" : current));
    }
  }, [refresh, showAssetToast]);

  const runSelectedAssetAction = useCallback(async (action) => {
    if (!selectedAssets.length) return;
    const key = `batch:${action}`;
    setBusyKey(key);
    try {
      if (action === "annotate") {
        const paths = selectedImageAssets.map(assetLocalPath).filter(Boolean);
        if (!paths.length) {
          const message = "Select at least one local image to annotate.";
          showAssetToast("error", "Selection action failed", message);
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
          const availability = assetAvailability(asset, effectiveCloudId, selectedCloudLabel, currentDeviceId);
          if (!id) {
            continue;
          }
          if (availability.hasLocal) {
            const response = await invoke("cloud_mcp_delete_local_account_asset", {
              assetId: id,
              deleteFile: true,
            });
            adoptAccountAssetsLibraryEvent(response);
            deletedCount += 1;
          }
        }
        if (!deletedCount) {
          const message = "Selected assets do not have local copies to delete.";
          showAssetToast("error", "Delete failed", message);
          return;
        }
        clearSelectedAssets();
        await refresh({ silent: true, force: true });
        showAssetToast("success", "Local copies deleted", `Deleted ${deletedCount} local cop${deletedCount === 1 ? "y" : "ies"}. Cloud copies are unchanged.`);
      }
    } catch (nextError) {
      const message = nextError?.message || String(nextError || `Unable to ${action} selected assets.`);
      showAssetToast("error", "Selection action failed", message);
    } finally {
      setBusyKey((current) => (current === key ? "" : current));
    }
  }, [
    clearSelectedAssets,
    refresh,
    selectedAssets,
    selectedImageAssets,
    currentDeviceId,
    effectiveCloudId,
    selectedCloudLabel,
    showAssetToast,
  ]);

  return (
    <AssetsPane>
      <AssetControlsRegion>
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
              {filteredItems.length} asset{assetCountPluralBase === 1 ? "" : "s"} · {localCount} local · {cloudCount} cloud · {remoteCount} remote
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
            onClose={() => setCloudSettingsOpen(false)}
            selectedCloudId={effectiveCloudId}
          />
        )}
      </AssetControlsRegion>
      <AssetSelectionDock
        busy={Boolean(busyKey)}
        count={selectedAssets.length}
        deleteCount={selectedAssets.filter((asset) => {
          const availability = assetAvailability(asset, effectiveCloudId, selectedCloudLabel, currentDeviceId);
          return availability.hasLocal && Boolean(assetLocalPath(asset));
        }).length}
        imageCount={selectedImageAssets.length}
        onAnnotate={() => runSelectedAssetAction("annotate")}
        onClear={clearSelectedAssets}
        onDelete={() => runSelectedAssetAction("delete")}
        deleteLabel="Delete local"
      />
      <AssetToastStack
        onDismiss={dismissAssetToast}
        selectionVisible={selectedAssets.length > 0}
        toasts={assetToasts}
      />
      {!filteredItems.length ? (
        <AssetEmptyState>{loading ? "Loading assets..." : "No assets registered yet."}</AssetEmptyState>
      ) : (
        <VirtualAssetGrid
          ariaLabel="Asset library grid"
          items={filteredItems}
          renderItem={(asset, index) => {
            const id = assetId(asset, `asset-${index}`);
            const name = assetName(asset, `Asset ${index + 1}`);
            const availability = assetAvailability(asset, effectiveCloudId, selectedCloudLabel, currentDeviceId);
            const transfer = latestAssetTransfer(visibleTransfers, asset, effectiveCloudId);
            const transferStatus = transfer ? assetTransferStatusKind(transfer) : "";
            const transferActive = transferStatus === "active";
            const transferFailed = transferStatus === "failed";
            const transferPercent = transfer ? assetTransferPercent(transfer) : 0;
            const transferLabel = transfer ? assetTransferDirectionLabel(transfer) : "";
            const remoteDeviceNames = assetRemoteDeviceNames(asset, currentDeviceId);
            const showRemoteDeviceLine = remoteDeviceNames.length > 0;
            const cardStatus = transferActive || transferFailed ? transferStatus : availability.statusKind;
            const localPath = availability.hasLocal ? assetLocalPath(asset) : "";
            const previewUrl = localPath ? assetPreviewUrl(asset) : "";
            const publicUrl = assetPublicUrl(asset);
            const isPublic = Boolean(publicUrl);
            const previewKey = `${id}:${previewUrl}`;
            const shouldShowImagePreview = Boolean(previewUrl && !failedPreviewKeys.has(previewKey));
            // Assets are account-level: actions only need the asset id, so
            // nothing is gated on a resolvable workspace/repo anymore.
            const canRunAssetAction = Boolean(id);
            const uploadBusy = busyKey === `upload:${id}`;
            const downloadBusy = busyKey === `download:${id}`;
            const deleteLocalBusy = busyKey === `deleteLocal:${id}`;
            const deleteCloudBusy = busyKey === `deleteCloud:${id}`;
            const viewBusy = busyKey === `view:${id}`;
            const copyBusy = busyKey === `copy:${id}`;
            const copyPublicBusy = busyKey === `copyPublic:${id}`;
            const publishBusy = busyKey === `publish:${id}`;
            const pinBusy = busyKey === `pin:${id}`;
            const untrackBusy = busyKey === `untrack:${id}`;
            const canUpload = canRunAssetAction && !transferActive && availability.hasLocal && !availability.hasCloud && Boolean(localPath);
            const canDownload = canRunAssetAction && !transferActive && availability.hasCloud && !availability.hasLocal;
            const canDeleteCloud = canRunAssetAction && !transferActive && availability.hasCloud;
            const canDeleteLocal = canRunAssetAction && !transferActive && availability.hasLocal && Boolean(localPath);
            const canPublish = canRunAssetAction && !transferActive && availability.hasCloud && !isPublic;
            const canCopyPublic = isPublic;
            const canView = availability.hasLocal && assetIsImage(asset) && Boolean(localPath);
            const canCopy = availability.hasLocal && assetIsImage(asset) && Boolean(localPath);
            const canUntrack = canRunAssetAction && !transferActive && availability.hasLocal && Boolean(localPath);
            const showInfoAction = !availability.hasLocal || availability.hasCloud || availability.hasRemote;
            const previewTitle = localPath
              ? shouldShowImagePreview
                ? "Double-click to open big view and annotate"
                : "Double-click to open file"
              : availability.hasCloud
                ? "No local copy downloaded"
                : "No local copy";
            const primaryCloudAction = availability.hasCloud && availability.hasLocal
              ? "deleteCloud"
              : availability.hasCloud
                ? "download"
                : availability.hasLocal
                  ? "upload"
                  : "";
            const primaryCloudBusy = primaryCloudAction === "deleteCloud"
              ? deleteCloudBusy
              : primaryCloudAction === "download"
                ? downloadBusy
                : uploadBusy;
            const canPrimaryCloudAction = primaryCloudAction === "deleteCloud"
              ? canDeleteCloud
              : primaryCloudAction === "download"
                ? canDownload
                : primaryCloudAction === "upload"
                  ? canUpload
                  : false;
            const primaryCloudTitle = primaryCloudAction === "deleteCloud"
              ? "Remove from Cloud"
              : primaryCloudAction === "download"
                ? "Download local copy"
                : "Upload to Cloud";
            const primaryCloudLabel = primaryCloudAction === "deleteCloud"
              ? `Remove ${name} from Cloud`
              : primaryCloudAction === "download"
                ? `Download local copy of ${name}`
                : `Upload ${name}`;
            const showSecondaryCloudDelete = availability.hasCloud && !availability.hasLocal;
            const bottomDeleteAction = canDeleteLocal ? "deleteLocal" : "";
            const bottomDeleteBusy = deleteLocalBusy;
            const canBottomDelete = canDeleteLocal;
            const bottomDeleteTitle = canDeleteLocal ? "Delete local copy" : "No local copy to delete";
            const selected = selectedAssetIds.has(id);

            return (
              <AssetCard data-selected={selected ? "true" : "false"} data-status={cardStatus} key={id} title={localPath || assetSha(asset) || name}>
                <AssetCardMedia>
                <AssetCardPreview
                  aria-label={shouldShowImagePreview ? `Open ${name} in image editor` : `Open ${name}`}
                  disabled={!localPath || Boolean(busyKey)}
                  onDoubleClick={() => runAssetAction(shouldShowImagePreview ? "view" : "open", asset)}
                  title={previewTitle}
                  type="button"
                >
                  {shouldShowImagePreview ? (
                    <AssetCardImage
                      alt={name}
                      eager={index < 20}
                      onError={() => {
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
                <AssetAvailabilityBadges
                  availability={availability}
                  cloudLabel={selectedCloudLabel}
                  currentDeviceName={currentDeviceName}
                  remoteDeviceNames={remoteDeviceNames}
                />
                {primaryCloudAction && (
                  <AssetTopActionButton
                    aria-label={primaryCloudLabel}
                    data-busy={primaryCloudBusy ? "true" : "false"}
                    data-danger={primaryCloudAction === "deleteCloud" ? "true" : "false"}
                    disabled={!canPrimaryCloudAction || primaryCloudBusy || Boolean(busyKey && !primaryCloudBusy)}
                    onClick={() => runAssetAction(primaryCloudAction, asset)}
                    title={primaryCloudTitle}
                    type="button"
                  >
                    {primaryCloudAction === "deleteCloud" ? (
                      <CloudOff aria-hidden="true" />
                    ) : primaryCloudAction === "download" ? (
                      <CloudDownload aria-hidden="true" />
                    ) : (
                      <CloudUpload aria-hidden="true" />
                    )}
                  </AssetTopActionButton>
                )}
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
                {availability.hasCloud && (
                  <AssetShareActions data-visible="true">
                    {!isPublic && (
                      <AssetShareButton
                        aria-label={`Make ${name} public and copy URL`}
                        data-primary="true"
                        disabled={!canPublish || publishBusy || Boolean(busyKey && !publishBusy)}
                        onClick={() => runAssetAction("publish", asset)}
                        title="Make public and copy URL"
                        type="button"
                      >
                        <Public aria-hidden="true" />
                        <span>Make public</span>
                      </AssetShareButton>
                    )}
                    {isPublic && (
                      <AssetShareButton
                        aria-label={`Copy public URL for ${name}`}
                        data-primary="true"
                        disabled={!canCopyPublic || copyPublicBusy || Boolean(busyKey && !copyPublicBusy)}
                        onClick={() => runAssetAction("copyPublic", asset)}
                        title="Copy public URL"
                        type="button"
                      >
                        <Link aria-hidden="true" />
                        <span>Copy URL</span>
                      </AssetShareButton>
                    )}
                  </AssetShareActions>
                )}
                <AssetUtilityStrip>
                  {canCopy && (
                    <AssetPinButton
                      disabled={pinBusy || Boolean(busyKey && !pinBusy)}
                      localPath={localPath}
                      name={name}
                      onToggle={() => runAssetAction("pin", asset)}
                    />
                  )}
                  {canUntrack && (
                    <AssetUtilityButton
                      aria-label={`Untrack ${name}`}
                      data-warning="true"
                      disabled={!canUntrack || untrackBusy || Boolean(busyKey && !untrackBusy)}
                      onClick={() => runAssetAction("untrack", asset)}
                      title="Move to untracked scratch"
                      type="button"
                    >
                      <MoveToInbox aria-hidden="true" />
                    </AssetUtilityButton>
                  )}
                  {showSecondaryCloudDelete && (
                    <AssetUtilityButton
                      aria-label={`Remove ${name} from Cloud`}
                      data-danger="true"
                      disabled={!canDeleteCloud || deleteCloudBusy || Boolean(busyKey && !deleteCloudBusy)}
                      onClick={() => runAssetAction("deleteCloud", asset)}
                      title="Remove from Cloud"
                      type="button"
                    >
                      <CloudOff aria-hidden="true" />
                    </AssetUtilityButton>
                  )}
                </AssetUtilityStrip>
                <AssetCardActions>
                  <AssetIconButton
                    aria-label={`Copy ${name} to clipboard`}
                    disabled={!canCopy || copyBusy || Boolean(busyKey && !copyBusy)}
                    onClick={() => runAssetAction("copy", asset)}
                    title="Copy image to clipboard"
                    type="button"
                  >
                    <ContentCopy aria-hidden="true" />
                  </AssetIconButton>
                  <AssetIconButton
                    aria-label={showInfoAction ? `Show availability for ${name}` : `Annotate ${name}`}
                    data-primary={showInfoAction ? "true" : undefined}
                    disabled={showInfoAction ? Boolean(busyKey) : (!canView || viewBusy || Boolean(busyKey && !viewBusy))}
                    onClick={() => (showInfoAction ? setInfoAssetId(id) : runAssetAction("view", asset))}
                    title={showInfoAction ? "File availability" : "Annotate copy"}
                    type="button"
                  >
                    {showInfoAction ? <Info aria-hidden="true" /> : <ModeEdit aria-hidden="true" />}
                  </AssetIconButton>
                  {canDeleteLocal && (
                    <AssetIconButton
                      aria-label={`Delete local copy of ${name}`}
                      data-danger="true"
                      disabled={!canBottomDelete || bottomDeleteBusy || Boolean(busyKey && !bottomDeleteBusy)}
                      onClick={() => bottomDeleteAction && runAssetAction(bottomDeleteAction, asset)}
                      title={bottomDeleteTitle}
                      type="button"
                    >
                      <Delete aria-hidden="true" />
                    </AssetIconButton>
                  )}
                </AssetCardActions>
                </AssetCardMedia>
                <AssetCardCaption>
                  <AssetCardName>{name}</AssetCardName>
                  {localPath ? (
                    <MediaTranscriptChip localPath={localPath} mediaName={name} />
                  ) : null}
                  {showRemoteDeviceLine && (
                    <AssetCardMetaLine title={`Remote devices: ${remoteDeviceNames.join(", ")}`}>
                      {remoteDeviceNames.length === 1
                        ? `Remote on ${remoteDeviceNames[0]}`
                        : `Remote on ${remoteDeviceNames.length} devices`}
                    </AssetCardMetaLine>
                  )}
                  {isPublic && (
                    <AssetCardMetaLine title={publicUrl}>
                      Public link
                    </AssetCardMetaLine>
                  )}
                </AssetCardCaption>
              </AssetCard>
            );
          }}
        />
      )}
      {infoAsset && (
        <AssetInfoSheet
          asset={infoAsset}
          availability={assetAvailability(infoAsset, effectiveCloudId, selectedCloudLabel, currentDeviceId)}
          cloudId={effectiveCloudId}
          cloudLabel={selectedCloudLabel}
          currentDeviceName={currentDeviceName}
          onClose={() => setInfoAssetId("")}
        />
      )}
    </AssetsPane>
  );
}

function AssetInfoSheet({
  asset,
  availability,
  cloudId = DEFAULT_ASSET_CLOUD_ID,
  cloudLabel = "Cloud",
  currentDeviceName = "This device",
  onClose,
}) {
  const name = assetName(asset, "Asset");
  const localPath = availability?.hasLocal ? assetLocalPath(asset) : "";
  const previousLocalPath = text(
    asset?.lastLocalPath
      || asset?.last_local_path
      || asset?.localPathHint
      || asset?.local_path_hint,
  );
  const cloudState = assetCloudState(asset, cloudId);
  const cloudStatus = text(
    cloudState?.cloudStatus
      || cloudState?.cloud_status
      || cloudState?.status
      || asset?.cloudStatus
      || asset?.cloud_status
      || asset?.status,
    availability?.hasCloud ? "available" : "not available",
  );
  const publicUrl = assetPublicUrl(asset);
  const remoteDevices = jsonArray(availability?.remoteDevices);
  const sizeBytes = Number(asset?.sizeBytes ?? asset?.size_bytes ?? 0) || 0;
  const updatedAt = formatAssetTimestamp(asset?.updatedAt || asset?.updated_at);
  const fileRows = [
    ["Type", assetMimeType(asset) || assetFileTypeLabel(asset)],
    ["Size", sizeBytes > 0 ? formatAssetBytes(sizeBytes) : ""],
    ["SHA-256", assetSha(asset)],
    ["Updated", updatedAt],
  ].filter(([, value]) => text(value));

  return (
    <AssetInfoBackdrop onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <AssetInfoPanel aria-label={`${name} availability`} aria-modal="true" role="dialog">
        <AssetInfoHeader>
          <div>
            <AssetInfoEyebrow>Asset info</AssetInfoEyebrow>
            <AssetInfoTitle>{name}</AssetInfoTitle>
          </div>
          <AssetInfoCloseButton aria-label="Close asset info" onClick={() => onClose?.()} title="Close" type="button">
            <Close aria-hidden="true" />
          </AssetInfoCloseButton>
        </AssetInfoHeader>

        <AssetInfoStatusGrid>
          <AssetInfoStatusCard data-active={availability?.hasLocal ? "true" : "false"} data-kind="local">
            <Computer aria-hidden="true" />
            <strong>Local</strong>
            <span>{availability?.hasLocal ? `Available on ${currentDeviceName}` : "Not on this device"}</span>
          </AssetInfoStatusCard>
          <AssetInfoStatusCard data-active={availability?.hasCloud ? "true" : "false"} data-kind="cloud">
            <CloudQueue aria-hidden="true" />
            <strong>Cloud</strong>
            <span>{availability?.hasCloud ? `${shortLabel(cloudLabel, 22)} copy available` : "No cloud copy"}</span>
          </AssetInfoStatusCard>
          <AssetInfoStatusCard data-active={availability?.hasRemote ? "true" : "false"} data-kind="remote">
            <Devices aria-hidden="true" />
            <strong>Remote</strong>
            <span>{availability?.hasRemote ? `${availability.remoteCount} device${availability.remoteCount === 1 ? "" : "s"}` : "No remote devices"}</span>
          </AssetInfoStatusCard>
        </AssetInfoStatusGrid>

        <AssetInfoSection>
          <AssetInfoSectionTitle>Location</AssetInfoSectionTitle>
          <AssetInfoRows>
            <AssetInfoRow>
              <span>This device</span>
              <strong title={localPath || previousLocalPath || undefined}>
                {localPath || (previousLocalPath ? "Missing local file" : "No local copy")}
              </strong>
            </AssetInfoRow>
            <AssetInfoRow>
              <span>Cloud</span>
              <strong>{availability?.hasCloud ? `${shortLabel(cloudLabel, 22)} · ${cloudStatus}` : "Not uploaded"}</strong>
            </AssetInfoRow>
            {publicUrl && (
              <AssetInfoRow>
                <span>Public link</span>
                <strong title={publicUrl}>Available</strong>
              </AssetInfoRow>
            )}
          </AssetInfoRows>
        </AssetInfoSection>

        <AssetInfoSection>
          <AssetInfoSectionTitle>Remote devices</AssetInfoSectionTitle>
          {remoteDevices.length ? (
            <AssetInfoDeviceList>
              {remoteDevices.map((device) => {
                const deviceName = assetDeviceName(device);
                const deviceId = assetDeviceId(device);
                const updated = formatAssetTimestamp(device.updatedAt || device.updated_at);
                return (
                  <AssetInfoDeviceRow key={deviceId || deviceName}>
                    <Devices aria-hidden="true" />
                    <div>
                      <strong>{deviceName}</strong>
                      <span>{updated ? `Last seen ${updated}` : "Local copy reported by this device"}</span>
                    </div>
                  </AssetInfoDeviceRow>
                );
              })}
            </AssetInfoDeviceList>
          ) : (
            <AssetInfoEmpty>No remote device has reported a local copy.</AssetInfoEmpty>
          )}
        </AssetInfoSection>

        {fileRows.length > 0 && (
          <AssetInfoSection>
            <AssetInfoSectionTitle>File</AssetInfoSectionTitle>
            <AssetInfoRows>
              {fileRows.map(([label, value]) => (
                <AssetInfoRow key={label}>
                  <span>{label}</span>
                  <strong title={value}>{value}</strong>
                </AssetInfoRow>
              ))}
            </AssetInfoRows>
          </AssetInfoSection>
        )}
      </AssetInfoPanel>
    </AssetInfoBackdrop>
  );
}

function AssetToastStack({ toasts = [], onDismiss, selectionVisible = false }) {
  if (!toasts.length) return null;
  return (
    <AssetToastViewport
      aria-live="polite"
      data-selection-visible={selectionVisible ? "true" : "false"}
    >
      {toasts.map((toast) => (
        <AssetToastCard
          key={toast.key}
          onDismiss={onDismiss}
          toast={toast}
        />
      ))}
    </AssetToastViewport>
  );
}

function AssetToastCard({ toast, onDismiss }) {
  const [paused, setPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef(0);
  const copyText = useMemo(() => text(toast.copyText, assetToastCopyText(toast)), [toast]);
  const details = useMemo(() => jsonArray(toast.details).filter((detail) => text(detail)), [toast.details]);
  const kind = text(toast.kind, "success");
  const title = text(toast.title, kind === "error" ? "Asset action failed" : "Asset action complete");
  const message = text(toast.message);

  const pauseDismiss = useCallback(() => {
    setPaused(true);
  }, []);

  const resumeDismiss = useCallback((event) => {
    if (event?.currentTarget?.contains?.(event.relatedTarget)) return;
    setPaused(false);
  }, []);

  useEffect(() => {
    if (paused) return undefined;
    const timer = window.setTimeout(() => {
      onDismiss(toast.key);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [onDismiss, paused, toast.createdAt, toast.key]);

  useEffect(() => () => {
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
  }, []);

  const copyToast = useCallback(async () => {
    const didCopy = await copyTextToClipboard(copyText);
    if (!didCopy) return;
    setCopied(true);
    if (copiedTimerRef.current) {
      window.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = window.setTimeout(() => {
      copiedTimerRef.current = 0;
      setCopied(false);
    }, 1400);
  }, [copyText]);

  return (
    <AssetToast
      data-kind={kind}
      onBlur={resumeDismiss}
      onFocus={pauseDismiss}
      onMouseEnter={pauseDismiss}
      onMouseLeave={resumeDismiss}
      role={kind === "error" ? "alert" : "status"}
    >
      <AssetToastBody>
        <AssetToastTitle>{title}</AssetToastTitle>
        {message && <AssetToastMessage>{message}</AssetToastMessage>}
        {details.length ? (
          <AssetToastMeta>
            {details.slice(0, 3).map((detail) => (
              <span key={detail}>{detail}</span>
            ))}
          </AssetToastMeta>
        ) : null}
      </AssetToastBody>
      <AssetToastActions>
        <AssetToastIconButton
          aria-label={`Copy ${title}`}
          data-copied={copied ? "true" : "false"}
          disabled={!copyText}
          onClick={() => void copyToast()}
          title={copied ? "Copied" : "Copy"}
          type="button"
        >
          <ContentCopy aria-hidden="true" />
        </AssetToastIconButton>
        <AssetToastIconButton
          aria-label={`Dismiss ${title}`}
          onClick={() => onDismiss(toast.key)}
          title="Dismiss"
          type="button"
        >
          <Close aria-hidden="true" />
        </AssetToastIconButton>
      </AssetToastActions>
    </AssetToast>
  );
}

function AssetCloudSettingsPanel({
  busyKey = "",
  clouds = [],
  error = "",
  onAction,
  onClose = null,
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
  // AWS S3 endpoints are derivable from the region; R2/B2 endpoints carry the
  // account/cluster and must be supplied.
  const endpointRequired = providerKind !== "s3";
  const endpointPlaceholder = providerKind === "r2"
    ? "https://<account-id>.r2.cloudflarestorage.com"
    : providerKind === "b2"
      ? "https://s3.<region>.backblazeb2.com"
      : "Endpoint URL (optional for AWS S3)";
  const canSave = text(form.label)
    && text(form.bucket)
    && (!endpointRequired || text(form.endpoint))
    && text(form.accessKeyId)
    && text(form.secretAccessKey);
  const submit = useCallback(async (event) => {
    event.preventDefault();
    if (!canSave || typeof onAction !== "function") return;
    const endpoint = text(form.endpoint)
      || (providerKind === "s3" ? `https://s3.${text(form.region, "us-east-1")}.amazonaws.com` : "");
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
      endpoint,
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
      <AssetCloudSettingsHeader>
        <div>
          <strong>Asset clouds</strong>
          <span>Diff Forge AI Cloud is built in. Add your own S3, R2, or B2 buckets for asset syncing.</span>
        </div>
        {typeof onClose === "function" && (
          <AssetMiniButton aria-label="Close asset cloud settings" onClick={() => onClose()} type="button">
            Close
          </AssetMiniButton>
        )}
      </AssetCloudSettingsHeader>
      <AssetCloudList>
        {clouds.map((cloud) => {
          const cloudId = text(cloud.cloudId || cloud.cloud_id || cloud.id, DEFAULT_ASSET_CLOUD_ID);
          const builtin = cloudId === DEFAULT_ASSET_CLOUD_ID || cloud.builtin;
          const isDefault = Boolean(cloud.defaultCloud || cloud.default_cloud);
          const status = text(cloud.status, "active");
          const verified = Boolean(text(cloud.validatedAt || cloud.validated_at)) && status === "active";
          const detail = (builtin
            ? ["Managed by Diff Forge", isDefault ? "default" : ""]
            : [
              text(cloud.providerKind || cloud.provider_kind || cloud.provider, "cloud"),
              verified ? "verified" : status,
              isDefault ? "default" : "",
            ]
          ).filter(Boolean).join(" · ");
          return (
            <AssetCloudRow data-active={cloudId === selectedCloudId} key={cloudId}>
              <Cloud aria-hidden="true" />
              <AssetCloudRowText>
                <strong>{text(cloud.label || cloud.name, cloudId)}</strong>
                <span>{detail}</span>
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
        <AssetCloudFormTitle>
          <strong>Add custom cloud</strong>
          <span>Bucket credentials are stored cloud-side and verified with a write probe after adding.</span>
        </AssetCloudFormTitle>
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
          <AssetCloudInput aria-label="Endpoint" placeholder={endpointPlaceholder} value={form.endpoint} onChange={(event) => setField("endpoint", event.target.value)} />
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

const SNIP_FLOATS_CHANGED_EVENT = "forge-snip-floats-changed";

/// Whether this file is currently pinned on screen as a floating snip
/// preview. Live: pinning/unpinning anywhere (editor, strip, the float's own
/// close button) flips it through Rust's floats-changed event.
function useSnipFloatOpen(localPath) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!localPath) {
      setOpen(false);
      return undefined;
    }
    let cancelled = false;
    const refresh = () => {
      invoke("snipping_snip_float_open", { path: localPath })
        .then((result) => {
          if (!cancelled) setOpen(Boolean(result?.open));
        })
        .catch(() => {});
    };
    refresh();
    let unlisten = () => {};
    listen(SNIP_FLOATS_CHANGED_EVENT, refresh)
      .then((nextUnlisten) => {
        if (cancelled) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten();
    };
  }, [localPath]);
  return open;
}

function AssetPinButton({ localPath, name, disabled, onToggle }) {
  const pinned = useSnipFloatOpen(localPath);
  return (
    <AssetFloatPinButton
      aria-label={pinned ? `Unpin ${name} floating preview` : `Pin ${name} as a floating preview`}
      aria-pressed={pinned}
      data-pinned={pinned ? "true" : "false"}
      disabled={disabled}
      onClick={onToggle}
      title={pinned ? "Unpin floating preview" : "Pin as draggable floating preview"}
      type="button"
    >
      {pinned ? <PinOff aria-hidden="true" /> : <PushPin aria-hidden="true" />}
    </AssetFloatPinButton>
  );
}

function UntrackedAssetsPanel({
  assetMode = "untracked",
  error = "",
  library = null,
  loading = false,
  onAssetModeChange,
  onDelete,
  onPromote,
  onRefresh,
  onRename,
  onTrackedRefresh,
  syncing = false,
  trackedCount = 0,
  untrackedCount = 0,
}) {
  const items = useMemo(() => assetLibraryItems(library), [library]);
  const [busyKey, setBusyKey] = useState("");
  const {
    assetToasts,
    dismissAssetToast,
    dismissedToastKeysRef,
    enqueueAssetToast,
    showAssetToast,
  } = useAssetToastController();
  const [failedPreviewKeys, setFailedPreviewKeys] = useState(() => new Set());
  const [selectedAssetIds, setSelectedAssetIds] = useState(() => new Set());
  const selectedAssets = useMemo(() => (
    items.filter((asset) => selectedAssetIds.has(assetId(asset)))
  ), [items, selectedAssetIds]);
  const selectedImageAssets = useMemo(() => (
    selectedAssets.filter((asset) => assetLocalAvailable(asset) && assetIsImage(asset) && assetLocalPath(asset))
  ), [selectedAssets]);
  const activeToastKeySet = useMemo(
    () => new Set(assetToasts.map((toast) => toast.key)),
    [assetToasts],
  );

  useEffect(() => {
    const message = text(error);
    if (!message) return;
    const key = `untracked-assets-error:${message}`;
    if (dismissedToastKeysRef.current.has(key) || activeToastKeySet.has(key)) return;
    enqueueAssetToast({
      kind: "error",
      key,
      title: "Scratch assets failed to load",
      message,
    });
  }, [activeToastKeySet, enqueueAssetToast, error, dismissedToastKeysRef]);

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
    try {
      if (action === "open") {
        await openPath(localPath);
      } else if (action === "view") {
        await invoke("snipping_open_annotation_editor", { path: localPath });
      } else if (action === "pin") {
        // Pin/unpin toggle, same as the snip preview's own pin button: Rust
        // tracks which files are floating, so query it rather than guessing.
        const floatState = await invoke("snipping_snip_float_open", { path: localPath })
          .catch(() => null);
        if (floatState?.open) {
          await invoke("snipping_close_snip_float_for_path", { path: localPath });
        } else {
          // Unfocused so the assets view keeps focus.
          await invoke("snipping_open_snip_float", { path: localPath, focused: false });
        }
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
        // Tracking is account-level: no workspace/repo scope on the asset.
        const result = await onPromote({
          deleteSource: true,
          name,
          path: localPath,
        });
        adoptAccountAssetsLibraryEvent(result);
        await trackedRefresh({ silent: true, force: true });
        showAssetToast("success", "Asset tracked", "Moved into tracked assets.", [name]);
      }
    } catch (nextError) {
      const message = nextError?.message || String(nextError || `Unable to ${action} untracked asset.`);
      showAssetToast("error", "Scratch action failed", message, [name, localPath]);
    } finally {
      setBusyKey((current) => (current === key ? "" : current));
    }
  }, [onDelete, onPromote, onRename, showAssetToast, trackedRefresh]);

  const runSelectedUntrackedAction = useCallback(async (action) => {
    if (!selectedAssets.length) return;
    const key = `batch:${action}`;
    setBusyKey(key);
    try {
      if (action === "annotate") {
        const paths = selectedImageAssets.map(assetLocalPath).filter(Boolean);
        if (!paths.length) {
          showAssetToast("error", "Selection action failed", "Select at least one local image to annotate.");
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
      const message = nextError?.message || String(nextError || `Unable to ${action} selected scratch assets.`);
      showAssetToast("error", "Selection action failed", message);
    } finally {
      setBusyKey((current) => (current === key ? "" : current));
    }
  }, [
    clearSelectedAssets,
    onDelete,
    refresh,
    selectedAssets,
    selectedImageAssets,
    showAssetToast,
  ]);

  return (
    <AssetsPane>
      <AssetControlsRegion>
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
      </AssetControlsRegion>
      <AssetSelectionDock
        busy={Boolean(busyKey)}
        count={selectedAssets.length}
        imageCount={selectedImageAssets.length}
        onAnnotate={() => runSelectedUntrackedAction("annotate")}
        onClear={clearSelectedAssets}
        onDelete={() => runSelectedUntrackedAction("delete")}
      />
      <AssetToastStack
        onDismiss={dismissAssetToast}
        selectionVisible={selectedAssets.length > 0}
        toasts={assetToasts}
      />
      {!items.length ? (
        <AssetEmptyState>
          {loading ? "Loading untracked assets..." : "No untracked scratch files yet. Snips and edits will appear here before you track them."}
        </AssetEmptyState>
      ) : (
        <VirtualAssetGrid
          ariaLabel="Untracked asset scratch grid"
          items={items}
          renderItem={(asset, index) => {
            const id = assetId(asset, `untracked-${index}`);
            const name = assetName(asset, `Scratch ${index + 1}`);
            const localPath = assetLocalPath(asset);
            const previewUrl = assetPreviewUrl(asset);
            const previewKey = `${id}:${previewUrl}`;
            const shouldShowImagePreview = Boolean(previewUrl && !failedPreviewKeys.has(previewKey));
            const openBusy = busyKey === `open:${id}`;
            const viewBusy = busyKey === `view:${id}`;
            const copyBusy = busyKey === `copy:${id}`;
            const pinBusy = busyKey === `pin:${id}`;
            const trackBusy = busyKey === `track:${id}`;
            const renameBusy = busyKey === `rename:${id}`;
            const deleteBusy = busyKey === `delete:${id}`;
            const canView = assetIsImage(asset) && Boolean(localPath);
            const canCopy = assetIsImage(asset) && Boolean(localPath);
            const selected = selectedAssetIds.has(id);

            return (
              <AssetCard data-selected={selected ? "true" : "false"} data-status="parked" key={id} title={localPath || name}>
                <AssetCardMedia>
                <AssetCardPreview
                  aria-label={shouldShowImagePreview ? `Open ${name} in image editor` : `Open ${name}`}
                  disabled={!localPath || Boolean(busyKey)}
                  onDoubleClick={() => runUntrackedAction(shouldShowImagePreview ? "view" : "open", asset)}
                  title={shouldShowImagePreview ? "Double-click to open big view and annotate" : "Double-click to open file"}
                  type="button"
                >
                  {shouldShowImagePreview ? (
                    <AssetCardImage
                      alt={name}
                      eager={index < 20}
                      onError={() => {
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
                <AssetUtilityStrip>
                  {canCopy && (
                    <AssetPinButton
                      disabled={!localPath || pinBusy || Boolean(busyKey && !pinBusy)}
                      localPath={localPath}
                      name={name}
                      onToggle={() => runUntrackedAction("pin", asset)}
                    />
                  )}
                  <AssetTrackButton
                    aria-label={`Track ${name}`}
                    disabled={!localPath || !onPromote || trackBusy || Boolean(busyKey && !trackBusy)}
                    onClick={() => runUntrackedAction("track", asset)}
                    title="Move from untracked scratch into tracked assets"
                    type="button"
                  >
                    <AddToPhotos aria-hidden="true" />
                  </AssetTrackButton>
                  <AssetUtilityButton
                    aria-label={`Open ${name}`}
                    disabled={!localPath || openBusy || Boolean(busyKey && !openBusy)}
                    onClick={() => runUntrackedAction("open", asset)}
                    title="Open file"
                    type="button"
                  >
                    <FileOpen aria-hidden="true" />
                  </AssetUtilityButton>
                  <AssetUtilityButton
                    aria-label={`Rename ${name}`}
                    disabled={!localPath || !onRename || renameBusy || Boolean(busyKey && !renameBusy)}
                    onClick={() => runUntrackedAction("rename", asset)}
                    title="Rename scratch file"
                    type="button"
                  >
                    <DriveFileRenameOutline aria-hidden="true" />
                  </AssetUtilityButton>
                </AssetUtilityStrip>
                <AssetCardActions>
                  <AssetIconButton
                    aria-label={`Copy ${name} to clipboard`}
                    disabled={!canCopy || copyBusy || Boolean(busyKey && !copyBusy)}
                    onClick={() => runUntrackedAction("copy", asset)}
                    title="Copy image to clipboard"
                    type="button"
                  >
                    <ContentCopy aria-hidden="true" />
                  </AssetIconButton>
                  <AssetIconButton
                    aria-label={`Annotate ${name}`}
                    disabled={!canView || viewBusy || Boolean(busyKey && !viewBusy)}
                    onClick={() => runUntrackedAction("view", asset)}
                    title="Annotate copy"
                    type="button"
                  >
                    <ModeEdit aria-hidden="true" />
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
                </AssetCardMedia>
                <AssetCardCaption>
                  <AssetCardName>{name}</AssetCardName>
                  {localPath ? (
                    <MediaTranscriptChip localPath={localPath} mediaName={name} />
                  ) : null}
                </AssetCardCaption>
              </AssetCard>
            );
          }}
        />
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
  /* Anchor for the floating selection dock. */
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  padding: 16px;
`;

const AssetControlsRegion = styled.div`
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  max-height: min(46%, 420px);
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 2px;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;

  @media (max-height: 680px) {
    max-height: min(54%, 360px);
  }
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

const AssetCloudSettingsHeader = styled.div`
  display: flex;
  grid-column: 1 / -1;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);

  > div {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  strong {
    color: rgba(241, 245, 249, 0.94);
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  span {
    color: rgba(148, 163, 184, 0.82);
    font-size: 9px;
    font-weight: 720;
  }
`;

const AssetCloudFormTitle = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;

  strong {
    color: rgba(226, 232, 240, 0.92);
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  span {
    color: rgba(148, 163, 184, 0.78);
    font-size: 9px;
    font-weight: 720;
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

/* The selection bar floats over the bottom of the grid instead of sitting in
   flow — an in-flow bar shoves every card down the moment the first asset is
   selected. Always mounted: visibility is animated (slide + fade) so it can
   play an exit, with the visibility flip delayed past the transition so it
   stays clickable right up until it's gone. */
const AssetSelectionDockBar = styled.div`
  position: absolute;
  bottom: 14px;
  left: 50%;
  z-index: 12;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 7px;
  max-width: calc(100% - 32px);
  padding: 8px 12px;
  border: 1px solid rgba(45, 212, 191, 0.22);
  border-radius: 999px;
  background: rgba(9, 16, 22, 0.9);
  backdrop-filter: blur(12px);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.45);
  transform: translate(-50%, 0);
  opacity: 1;
  visibility: visible;
  transition:
    transform 340ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 240ms ease,
    visibility 0s 0s;

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

  &[data-visible="false"] {
    transform: translate(-50%, calc(100% + 24px));
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transition:
      transform 240ms cubic-bezier(0.5, 0, 0.75, 0.4),
      opacity 200ms ease,
      visibility 0s 240ms;
  }
`;

/* Floating batch-action dock for both asset views. Renders the last
   non-empty counts while animating out so "0 selected" never flashes, and
   every button hard-disables the moment the selection empties. */
function AssetSelectionDock({
  busy,
  count,
  deleteCount = count,
  deleteLabel = "Delete",
  imageCount,
  onAnnotate,
  onClear,
  onDelete,
}) {
  const lastCountsRef = useRef({ count: 0, deleteCount: 0, imageCount: 0 });
  if (count > 0) {
    lastCountsRef.current = { count, deleteCount, imageCount };
  }
  const visible = count > 0;
  const shown = visible ? { count, deleteCount, imageCount } : lastCountsRef.current;
  return (
    <AssetSelectionDockBar
      aria-hidden={visible ? "false" : "true"}
      data-visible={visible ? "true" : "false"}
    >
      <strong>{shown.count} selected</strong>
      <span>{shown.imageCount} annotatable image{shown.imageCount === 1 ? "" : "s"}</span>
      <AssetBatchButton
        data-primary="true"
        disabled={!visible || !imageCount || busy}
        onClick={onAnnotate}
        type="button"
      >
        <ModeEdit aria-hidden="true" />
        <span>Annotation</span>
      </AssetBatchButton>
      {shown.deleteCount > 0 && (
        <AssetBatchButton
          data-danger="true"
          disabled={!visible || busy}
          onClick={onDelete}
          type="button"
        >
          <Delete aria-hidden="true" />
          <span>{deleteLabel}</span>
        </AssetBatchButton>
      )}
      <AssetBatchButton disabled={!visible || busy} onClick={onClear} type="button">
        Clear
      </AssetBatchButton>
    </AssetSelectionDockBar>
  );
}

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

// Asset grid geometry. The grid is virtualized (see VirtualAssetGrid) so a
// 10k+ library only ever mounts the cards inside the viewport plus a small
// overscan band. These mirror the CSS column/gap/padding the layout used to
// express directly so the windowed math stays faithful to the visual grid.
const ASSET_GRID_GAP = 12;
const ASSET_GRID_MIN_COL = 220;
const ASSET_GRID_MAX_COL = 240;
const ASSET_GRID_PAD_TOP = 14;
const ASSET_GRID_PAD_BOTTOM = 72;
const ASSET_GRID_PAD_X = 4;
const ASSET_GRID_OVERSCAN_ROWS = 4;
const ASSET_GRID_SMALL_BREAKPOINT = 520;
const ASSET_GRID_CAPTION_ESTIMATE = 64;
const ASSET_GRID_DEFAULT_CARD_HEIGHT = 196;
const ASSET_CARD_MEDIA_ASPECT = 1.618;

// Columns matching `repeat(auto-fill, minmax(220px, 240px))`: pack as many
// 220px-min columns as fit, with the small-screen two-column fallback.
function assetGridColumnCount(width) {
  if (!width || width <= 0) return 1;
  if (width <= ASSET_GRID_SMALL_BREAKPOINT) return 2;
  const inner = width - ASSET_GRID_PAD_X * 2;
  const columns = Math.floor((inner + ASSET_GRID_GAP) / (ASSET_GRID_MIN_COL + ASSET_GRID_GAP));
  return Math.max(1, columns);
}

// First-paint card-height estimate (media is a fixed 1.618 aspect of the
// column width). Real heights replace this after the first measured layout.
function assetGridEstimatedCardHeight(width, columns) {
  if (!width || !columns) return ASSET_GRID_DEFAULT_CARD_HEIGHT;
  const inner = width - ASSET_GRID_PAD_X * 2 - (columns - 1) * ASSET_GRID_GAP;
  const rawColumnWidth = inner / columns;
  const columnWidth = width <= ASSET_GRID_SMALL_BREAKPOINT
    ? rawColumnWidth
    : Math.min(ASSET_GRID_MAX_COL, Math.max(ASSET_GRID_MIN_COL, rawColumnWidth));
  const mediaHeight = columnWidth / ASSET_CARD_MEDIA_ASPECT;
  return Math.round(mediaHeight + ASSET_GRID_CAPTION_ESTIMATE);
}

const AssetGridScroller = styled.div`
  flex: 1 1 0;
  min-width: 0;
  min-height: 120px;
  overflow: auto;
  padding: 0 ${ASSET_GRID_PAD_X}px;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
`;

const AssetGridSpacer = styled.div`
  width: 100%;
  flex: 0 0 auto;
`;

const AssetGridWindow = styled.div`
  display: grid;
  gap: ${ASSET_GRID_GAP}px;
  align-items: start;
  align-content: start;
  min-width: 0;
`;

// Windowed asset grid: renders only the rows intersecting the viewport (plus
// an overscan band) so the DOM stays bounded no matter how large the library
// grows. Card markup and styling are unchanged — callers pass the same
// per-item render they used inside `items.map(...)`, and the absolute item
// index is preserved so fallbacks/keys keep working.
function VirtualAssetGrid({ items, renderItem, ariaLabel }) {
  const scrollerRef = useRef(null);
  const windowRef = useRef(null);
  const measureRef = useRef({ columns: 0, cardHeight: 0 });
  const [viewport, setViewport] = useState({ width: 0, height: 0, scrollTop: 0 });
  const [cardHeight, setCardHeight] = useState(ASSET_GRID_DEFAULT_CARD_HEIGHT);

  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      setViewport((previous) => {
        const width = element.clientWidth;
        const height = element.clientHeight;
        const scrollTop = element.scrollTop;
        if (previous.width === width && previous.height === height && previous.scrollTop === scrollTop) {
          return previous;
        }
        return { width, height, scrollTop };
      });
    };
    const schedule = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(read);
    };
    read();
    element.addEventListener("scroll", schedule, { passive: true });
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null;
    if (observer) observer.observe(element);
    return () => {
      element.removeEventListener("scroll", schedule);
      if (observer) observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  const columns = assetGridColumnCount(viewport.width);
  const itemCount = items.length;
  const totalRows = columns > 0 ? Math.ceil(itemCount / columns) : 0;
  const rowStride = Math.max(1, cardHeight + ASSET_GRID_GAP);

  const viewportTop = Math.max(0, viewport.scrollTop - ASSET_GRID_PAD_TOP);
  const startRow = Math.max(0, Math.floor(viewportTop / rowStride) - ASSET_GRID_OVERSCAN_ROWS);
  const rowsInView = Math.ceil((viewport.height || rowStride) / rowStride) + ASSET_GRID_OVERSCAN_ROWS * 2 + 1;
  const endRow = Math.min(totalRows, startRow + rowsInView);

  const startIndex = startRow * columns;
  const endIndex = Math.min(itemCount, endRow * columns);
  const visibleItems = startIndex < endIndex ? items.slice(startIndex, endIndex) : [];

  const topSpacer = ASSET_GRID_PAD_TOP + startRow * rowStride;
  const bottomSpacer = Math.max(0, (totalRows - endRow) * rowStride) + ASSET_GRID_PAD_BOTTOM;

  // Keep the row height honest by measuring the tallest mounted card. Reset the
  // running max whenever the column count changes (cards get narrower/shorter),
  // otherwise grow monotonically so a fixed `grid-auto-rows` never clips a card.
  useLayoutEffect(() => {
    const node = windowRef.current;
    if (!node) return;
    let max = 0;
    for (const child of node.children) {
      const height = child.offsetHeight;
      if (height > max) max = height;
    }
    if (max <= 0) return;
    const columnsChanged = measureRef.current.columns !== columns;
    const nextHeight = columnsChanged ? max : Math.max(max, measureRef.current.cardHeight);
    if (columnsChanged || nextHeight !== measureRef.current.cardHeight) {
      measureRef.current = { columns, cardHeight: nextHeight };
      setCardHeight((previous) => (previous === nextHeight ? previous : nextHeight));
    }
  });

  // Seed an estimate as soon as the width is known so the first paint isn't
  // wildly off before the measured height lands.
  useEffect(() => {
    if (viewport.width <= 0) return;
    if (measureRef.current.columns === columns && measureRef.current.cardHeight > 0) return;
    const estimate = assetGridEstimatedCardHeight(viewport.width, columns);
    setCardHeight((previous) => (Math.abs(previous - estimate) > 1 ? estimate : previous));
  }, [viewport.width, columns]);

  const template = viewport.width > 0 && viewport.width <= ASSET_GRID_SMALL_BREAKPOINT
    ? "repeat(2, minmax(0, 1fr))"
    : `repeat(${columns}, minmax(${ASSET_GRID_MIN_COL}px, ${ASSET_GRID_MAX_COL}px))`;

  return (
    <AssetGridScroller ref={scrollerRef} aria-label={ariaLabel}>
      <AssetGridSpacer style={{ height: `${topSpacer}px` }} aria-hidden="true" />
      <AssetGridWindow
        ref={windowRef}
        style={{ gridTemplateColumns: template, gridAutoRows: `${cardHeight}px` }}
      >
        {visibleItems.map((asset, localIndex) => renderItem(asset, startIndex + localIndex))}
      </AssetGridWindow>
      <AssetGridSpacer style={{ height: `${bottomSpacer}px` }} aria-hidden="true" />
    </AssetGridScroller>
  );
}

const AssetCard = styled.article`
  position: relative;
  display: flex;
  flex-direction: column;
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

    [data-asset-select="true"],
    [data-asset-share="true"],
    [data-asset-upload="true"] {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }

    [data-asset-utilities="true"] {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(0);
    }
  }

  &:has([data-pinned="true"]) {
    [data-asset-utilities="true"] {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(0);
    }
  }

  &[data-status="active"] {
    border-color: rgba(96, 165, 250, 0.3);
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

    [data-asset-select="true"],
    [data-asset-share="true"],
    [data-asset-upload="true"] {
      opacity: 1;
      pointer-events: auto;
      transform: translateY(0);
    }

    [data-asset-utilities="true"] {
      opacity: 1;
      pointer-events: auto;
      transform: translateX(0);
    }
  }
`;

/* Golden-ratio media stage, the same proportions as the floating snip
   preview window. The caption is a separate title strip below it. */
const AssetCardMedia = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 1.618;
  overflow: hidden;
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
  padding: 12px 14px;
  color: rgba(203, 213, 225, 0.78);
`;

const AssetDocumentGlyph = styled.div`
  position: relative;
  width: 52px;
  height: 60px;

  svg {
    width: 100%;
    height: 100%;
    color: rgba(148, 163, 184, 0.34);
  }

  span {
    position: absolute;
    top: 27px;
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
  padding: 6px;
  object-fit: contain;
  object-position: center;
  background: rgba(2, 6, 23, 0.7);
  opacity: 0;
  transition: opacity 160ms ease;

  &[data-loaded="true"] {
    opacity: 1;
  }
`;

// Shimmer skeleton shown under the preview until the image decodes, mirroring
// the snip-tile lazy-load placeholder so cards paint instantly and never sit
// blank while their asset loads.
const assetThumbnailPulse = keyframes`
  0% { transform: translateX(-28%); opacity: 0.25; }
  50% { transform: translateX(28%); opacity: 0.5; }
  100% { transform: translateX(-28%); opacity: 0.25; }
`;

const AssetPreviewPlaceholder = styled.div`
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background:
    radial-gradient(circle at 24% 28%, rgba(125, 176, 255, 0.16), transparent 30%),
    linear-gradient(135deg, rgba(15, 23, 42, 0.92), rgba(30, 41, 59, 0.7));

  &::after {
    content: "";
    position: absolute;
    top: 16px;
    bottom: 16px;
    left: 10px;
    width: 70%;
    border-radius: 8px;
    background: linear-gradient(90deg, transparent, rgba(226, 232, 240, 0.18), transparent);
    opacity: 0.4;
    transform: translateX(-28%);
  }

  &[data-loading="true"]::after {
    animation: ${assetThumbnailPulse} 1050ms ease-in-out infinite;
  }
`;

// Lazy preview image: the card renders immediately with the shimmer
// placeholder, and the image fades in once it (or a cached copy) finishes
// loading. Resets its loaded state when the source changes.
function AssetCardImage({ alt, eager, onError, src }) {
  const imageRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(false);
    const node = imageRef.current;
    if (node && node.complete && node.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [src]);

  return (
    <>
      {!loaded && <AssetPreviewPlaceholder aria-hidden="true" data-loading="true" />}
      <AssetPreviewImage
        ref={imageRef}
        alt={alt}
        data-loaded={loaded ? "true" : "false"}
        decoding="async"
        draggable={false}
        loading={eager ? "eager" : "lazy"}
        onError={onError}
        onLoad={() => setLoaded(true)}
        src={src}
      />
    </>
  );
}

const AssetCardStatus = styled.span`
  position: absolute;
  top: 7px;
  left: 7px;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  max-width: calc(100% - 84px);
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

  &[data-status="remote"] {
    border-color: rgba(125, 176, 255, 0.28);
    color: rgba(191, 219, 254, 0.9);
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

const AssetAvailabilityBadgeGroup = styled.div`
  position: absolute;
  top: 8px;
  left: 7px;
  z-index: 4;
  display: inline-flex;
  align-items: center;
  max-width: calc(100% - 84px);
  gap: 4px;
  overflow: hidden;
  pointer-events: none;
`;

const AssetAvailabilityBadge = styled.span`
  display: inline-grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.84);
  background: rgba(7, 10, 16, 0.85);
  box-shadow: 0 8px 18px rgba(2, 6, 23, 0.2);
  font-size: 8.5px;
  font-weight: 900;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0;
  line-height: 1;
  backdrop-filter: blur(8px);

  svg {
    width: 13px;
    height: 13px;
  }

  &[data-kind="local"] {
    border-color: rgba(251, 191, 36, 0.24);
    color: rgba(254, 240, 138, 0.92);
    background: rgba(113, 63, 18, 0.22);
  }

  &[data-kind="cloud"] {
    border-color: rgba(74, 222, 128, 0.24);
    color: rgba(187, 247, 208, 0.92);
    background: rgba(22, 101, 52, 0.2);
  }

  &[data-kind="remote"] {
    border-color: rgba(125, 176, 255, 0.28);
    color: rgba(207, 227, 255, 0.94);
    background: rgba(37, 64, 110, 0.26);
  }

  &[data-kind="unavailable"] {
    border-color: rgba(251, 113, 133, 0.22);
    color: rgba(254, 205, 211, 0.9);
    background: rgba(127, 29, 29, 0.2);
  }
`;

const AssetShareActions = styled.div.attrs({ "data-asset-share": "true" })`
  position: absolute;
  top: 42px;
  right: 7px;
  z-index: 5;
  display: flex;
  max-width: calc(100% - 18px);
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-3px);
  transition: opacity 130ms ease, transform 130ms ease;

  &[data-visible="true"] {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }
`;

const AssetShareButton = styled.button`
  display: inline-flex;
  max-width: 132px;
  min-height: 24px;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border: 1px solid rgba(125, 176, 255, 0.28);
  border-radius: 999px;
  color: rgba(219, 234, 254, 0.94);
  background: rgba(7, 10, 16, 0.88);
  font: inherit;
  font-size: 9px;
  font-weight: 850;
  line-height: 1;
  cursor: pointer;
  backdrop-filter: blur(8px);
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease;

  svg {
    width: 12px;
    height: 12px;
    flex: 0 0 auto;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(125, 176, 255, 0.6);
    color: #06121f;
    background: #7db0ff;
    transform: translateX(-1px);
  }

  &[data-primary="true"] {
    border-color: rgba(45, 212, 191, 0.32);
    color: rgba(204, 251, 241, 0.98);
    background: rgba(13, 148, 136, 0.22);
  }

  &[data-warning="true"] {
    border-color: rgba(251, 191, 36, 0.26);
    color: rgba(254, 240, 138, 0.94);
    background: rgba(113, 63, 18, 0.22);
  }

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`;

const AssetUtilityStrip = styled.div.attrs({ "data-asset-utilities": "true" })`
  position: absolute;
  top: 42px;
  left: 7px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: calc(100% - 48px);
  overflow: auto;
  opacity: 0;
  pointer-events: none;
  transform: translateX(-4px);
  transition: opacity 130ms ease, transform 150ms ease;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`;

const AssetUtilityButton = styled.button`
  display: grid;
  width: 24px;
  height: 24px;
  flex: 0 0 24px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  color: #f8fafc;
  background: rgba(7, 10, 16, 0.85);
  font: inherit;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease, color 120ms ease, transform 120ms ease;
  backdrop-filter: blur(8px);

  svg {
    width: 13px;
    height: 13px;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(125, 176, 255, 0.55);
    background: rgba(23, 37, 62, 0.92);
    transform: scale(1.05);
  }

  &[data-primary="true"] {
    border-color: rgba(45, 212, 191, 0.28);
    color: rgba(204, 251, 241, 0.96);
    background: rgba(13, 148, 136, 0.18);
  }

  &[data-warning="true"] {
    border-color: rgba(251, 191, 36, 0.22);
    color: rgba(254, 240, 138, 0.9);
    background: rgba(113, 63, 18, 0.18);
  }

  &[data-danger="true"] {
    border-color: rgba(251, 113, 133, 0.22);
    color: rgba(254, 205, 211, 0.9);
    background: rgba(127, 29, 29, 0.18);
  }

  &[data-pinned="true"] {
    border-color: rgba(125, 176, 255, 0.5);
    color: #cfe3ff;
    background: rgba(37, 64, 110, 0.9);
  }

  &:disabled {
    cursor: default;
    opacity: 0.5;
  }
`;

const AssetTopActionButton = styled(AssetUtilityButton).attrs({ "data-asset-upload": "true" })`
  position: absolute;
  top: 8px;
  right: 42px;
  z-index: 5;
  border-color: rgba(125, 176, 255, 0.34);
  color: #cfe3ff;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-3px);

  &:hover:not(:disabled),
  &:focus-visible {
    color: #06121f;
    background: #7db0ff;
    border-color: transparent;
  }

  &[data-danger="true"] {
    border-color: rgba(251, 113, 133, 0.36);
    color: rgba(254, 205, 211, 0.96);
    background: rgba(127, 29, 29, 0.28);

    &:hover:not(:disabled),
    &:focus-visible {
      border-color: rgba(251, 113, 133, 0.6);
      color: rgba(255, 255, 255, 0.98);
      background: rgba(190, 18, 60, 0.86);
    }
  }

  &[data-busy="true"] {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  &:disabled:not([data-busy="true"]) {
    opacity: 0;
    pointer-events: none;
    transform: translateY(-3px);
  }
`;

const AssetFloatPinButton = styled(AssetUtilityButton).attrs({ "data-asset-pin": "true" })``;

const AssetTrackButton = styled(AssetUtilityButton).attrs({ "data-asset-track": "true" })`
  border-color: rgba(125, 176, 255, 0.34);
  color: #cfe3ff;
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
  }

  &:disabled[data-selected="true"] {
    opacity: 0.55;
  }

  &:disabled:not([data-selected="true"]) {
    opacity: 0;
    pointer-events: none;
    transform: translateY(-3px);
  }
`;

/* Same bottom action chrome as the floating snip preview: exactly three
   borderless icon buttons inside one compact dark pill. */
const AssetCardActions = styled.div.attrs({ "data-asset-actions": "true" })`
  position: absolute;
  right: auto;
  bottom: 6px;
  left: 50%;
  z-index: 4;
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px 6px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 999px;
  background: rgba(7, 10, 16, 0.88);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.42);
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, 6px);
  transition: opacity 160ms ease, transform 180ms cubic-bezier(0.22, 1, 0.36, 1);
  backdrop-filter: blur(12px);

  button {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 999px;
    color: rgba(248, 250, 252, 0.82);
    background: transparent;
    backdrop-filter: none;
    transition: background 120ms ease, color 120ms ease;
  }

  button svg {
    width: 14px;
    height: 14px;
  }

  button:hover:not(:disabled),
  button:focus-visible {
    border: 0;
    color: #ffffff;
    background: rgba(125, 176, 255, 0.22);
  }

  button[data-primary="true"]:hover:not(:disabled) {
    color: #06121f;
    background: rgba(45, 212, 191, 0.85);
  }

  button[data-warning="true"]:hover:not(:disabled) {
    color: #1f1304;
    background: rgba(251, 191, 36, 0.82);
  }

  button[data-danger="true"]:hover:not(:disabled) {
    color: #ffffff;
    background: rgba(214, 69, 69, 0.85);
  }

  button:disabled {
    opacity: 0.4;
  }
`;

const AssetCardCaption = styled.div`
  flex: 0 0 auto;
  min-width: 0;
  min-height: 36px;
  padding: 6px 9px 7px;
  border-top: 1px solid rgba(148, 163, 184, 0.1);
  background: rgba(2, 6, 23, 0.55);
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
`;

const AssetInfoBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 120;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(2, 6, 23, 0.58);
  backdrop-filter: blur(10px);
`;

const AssetInfoPanel = styled.section`
  width: min(560px, 100%);
  max-height: min(720px, calc(100vh - 36px));
  overflow: auto;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  color: var(--forge-text);
  background: rgba(7, 10, 16, 0.96);
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.48);
`;

const AssetInfoHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 12px;
`;

const AssetInfoEyebrow = styled.span`
  display: block;
  margin-bottom: 4px;
  color: rgba(148, 163, 184, 0.78);
  font-size: 9px;
  font-weight: 850;
  letter-spacing: 0;
  line-height: 1;
  text-transform: uppercase;
`;

const AssetInfoTitle = styled.strong`
  display: block;
  overflow: hidden;
  color: rgba(248, 250, 252, 0.96);
  font-size: 16px;
  font-weight: 850;
  line-height: 1.2;
  text-overflow: ellipsis;
`;

const AssetInfoCloseButton = styled.button`
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
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

  &:hover,
  &:focus-visible {
    border-color: rgba(125, 211, 252, 0.34);
    color: rgba(224, 242, 254, 0.94);
    background: rgba(14, 165, 233, 0.14);
  }
`;

const AssetInfoStatusGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 12px;

  @media (max-width: 560px) {
    grid-template-columns: 1fr;
  }
`;

const AssetInfoStatusCard = styled.div`
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.42);

  svg {
    width: 16px;
    height: 16px;
    color: rgba(148, 163, 184, 0.82);
  }

  strong {
    color: rgba(226, 232, 240, 0.94);
    font-size: 11px;
    font-weight: 850;
    line-height: 1;
  }

  span {
    min-width: 0;
    overflow: hidden;
    color: rgba(148, 163, 184, 0.82);
    font-size: 10px;
    font-weight: 650;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-active="true"][data-kind="local"] {
    border-color: rgba(245, 158, 11, 0.36);
    background: rgba(245, 158, 11, 0.13);

    svg,
    strong {
      color: #fbbf24;
    }
  }

  &[data-active="true"][data-kind="cloud"] {
    border-color: rgba(34, 197, 94, 0.34);
    background: rgba(34, 197, 94, 0.12);

    svg,
    strong {
      color: #4ade80;
    }
  }

  &[data-active="true"][data-kind="remote"] {
    border-color: rgba(59, 130, 246, 0.36);
    background: rgba(59, 130, 246, 0.13);

    svg,
    strong {
      color: #93c5fd;
    }
  }
`;

const AssetInfoSection = styled.section`
  display: grid;
  gap: 7px;
  padding: 11px 0;
  border-top: 1px solid rgba(148, 163, 184, 0.1);
`;

const AssetInfoSectionTitle = styled.strong`
  color: rgba(203, 213, 225, 0.92);
  font-size: 10px;
  font-weight: 850;
  line-height: 1;
  text-transform: uppercase;
`;

const AssetInfoRows = styled.div`
  display: grid;
  gap: 6px;
`;

const AssetInfoRow = styled.div`
  display: grid;
  grid-template-columns: minmax(86px, 0.36fr) minmax(0, 1fr);
  gap: 10px;
  align-items: center;
  min-width: 0;

  span {
    color: rgba(148, 163, 184, 0.82);
    font-size: 10px;
    font-weight: 750;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: rgba(241, 245, 249, 0.92);
    font-size: 10px;
    font-weight: 750;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const AssetInfoDeviceList = styled.div`
  display: grid;
  gap: 6px;
`;

const AssetInfoDeviceRow = styled.div`
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(125, 176, 255, 0.16);
  border-radius: 7px;
  background: rgba(30, 41, 59, 0.32);

  svg {
    width: 16px;
    height: 16px;
    color: rgba(191, 219, 254, 0.9);
  }

  div {
    min-width: 0;
  }

  strong,
  span {
    display: block;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: rgba(241, 245, 249, 0.94);
    font-size: 11px;
    font-weight: 850;
  }

  span {
    margin-top: 2px;
    color: rgba(148, 163, 184, 0.82);
    font-size: 9px;
    font-weight: 650;
  }
`;

const AssetInfoEmpty = styled.p`
  margin: 0;
  color: rgba(148, 163, 184, 0.82);
  font-size: 10px;
  font-weight: 650;
  line-height: 1.35;
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

const AssetToastViewport = styled.div`
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 32;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  width: min(360px, calc(100vw - 28px));
  pointer-events: none;

  &[data-selection-visible="true"] {
    bottom: 76px;
  }

  @media (max-width: 620px) {
    right: 10px;
    bottom: 12px;
    left: 10px;
    width: auto;

    &[data-selection-visible="true"] {
      bottom: 86px;
    }
  }
`;

const AssetToast = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 9px;
  width: 100%;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(74, 222, 128, 0.3);
  border-radius: 8px;
  color: rgba(226, 232, 240, 0.94);
  background: rgba(8, 14, 22, 0.94);
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.46);
  backdrop-filter: blur(14px);
  pointer-events: auto;

  &[data-kind="error"] {
    border-color: rgba(248, 113, 113, 0.34);
    background:
      linear-gradient(135deg, rgba(127, 29, 29, 0.2), rgba(8, 14, 22, 0.94) 52%),
      rgba(8, 14, 22, 0.94);
  }

  &[data-kind="success"] {
    border-color: rgba(74, 222, 128, 0.32);
    background:
      linear-gradient(135deg, rgba(20, 83, 45, 0.2), rgba(8, 14, 22, 0.94) 52%),
      rgba(8, 14, 22, 0.94);
  }
`;

const AssetToastBody = styled.div`
  display: grid;
  gap: 4px;
  min-width: 0;
`;

const AssetToastTitle = styled.strong`
  min-width: 0;
  color: rgba(241, 245, 249, 0.96);
  font-size: 11px;
  font-weight: 900;
  line-height: 1.25;
  overflow-wrap: anywhere;
`;

const AssetToastMessage = styled.div`
  min-width: 0;
  color: rgba(203, 213, 225, 0.9);
  font-size: 10px;
  font-weight: 760;
  line-height: 1.35;
  overflow-wrap: anywhere;
`;

const AssetToastMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;

  span {
    max-width: 100%;
    padding: 3px 5px;
    overflow: hidden;
    border: 1px solid rgba(148, 163, 184, 0.13);
    border-radius: 5px;
    color: rgba(203, 213, 225, 0.76);
    background: rgba(15, 23, 42, 0.42);
    font-size: 8px;
    font-weight: 820;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const AssetToastActions = styled.div`
  display: inline-flex;
  align-items: start;
  gap: 5px;
`;

const AssetToastIconButton = styled.button`
  display: inline-grid;
  width: 26px;
  height: 26px;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 6px;
  color: rgba(226, 232, 240, 0.78);
  background: rgba(15, 23, 42, 0.44);
  cursor: pointer;

  svg {
    width: 14px;
    height: 14px;
  }

  &:hover:not(:disabled),
  &:focus-visible,
  &[data-copied="true"] {
    border-color: rgba(45, 212, 191, 0.32);
    color: rgba(204, 251, 241, 0.96);
    background: rgba(13, 148, 136, 0.16);
  }

  &:disabled {
    cursor: default;
    opacity: 0.46;
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

const AssetEmptyState = styled.div`
  display: grid;
  flex: 1 1 0;
  place-items: center;
  min-height: 120px;
  overflow: auto;
  padding: 20px;
  border: 1px dashed rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  color: var(--forge-text-muted);
  font-size: 13px;
  font-weight: 760;
`;

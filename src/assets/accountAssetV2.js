const ACCOUNT_ASSET_V2_CONTRACT = "diffforge.account_assets.v2";

const CLOUD_AVAILABLE_STATUS_TOKENS = new Set([
  "available",
  "cloud-available",
  "cloud-only",
  "complete",
  "completed",
  "ready",
  "synced",
  "uploaded",
]);

const LOCAL_AVAILABLE_STATUS_TOKENS = new Set([
  "available",
  "local-available",
  "present",
  "ready",
  "synced",
]);

function text(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function jsonObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function numberValue(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function booleanValue(value, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizedToken(value) {
  return text(value).toLowerCase().replace(/[._\s]+/gu, "-");
}

function compactUpdatedAt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  return text(value);
}

function eventKind(value = {}) {
  return normalizedToken(value.t || value.event_kind || value.eventKind || value.kind || value.ev);
}

function compactAssetV2Payload(candidate = {}) {
  const object = jsonObject(candidate);
  if (!object) return false;
  if (object.contract === ACCOUNT_ASSET_V2_CONTRACT && (object.up || object.t || object.cols)) return true;
  const token = eventKind(object);
  return token === "asset-snapshot"
    || token === "asset-delta"
    || token === "asset-tx"
    || token === "asset-terminal";
}

function compactRows(payload = {}, key) {
  const direct = jsonArray(payload[key]);
  const up = jsonArray(jsonObject(payload.up)?.[key]);
  return direct.concat(up);
}

function compactRowObject(row, cols = []) {
  if (jsonObject(row)) return row;
  if (!Array.isArray(row)) return null;
  return cols.reduce((object, key, index) => {
    object[key] = row[index];
    return object;
  }, {});
}

function collectAssetV2Payloads(value, depth = 0, seen = new Set()) {
  const object = jsonObject(value);
  if (!object || depth > 8 || seen.has(object)) return [];
  seen.add(object);
  const rows = compactAssetV2Payload(object) ? [object] : [];
  [
    "asset_state",
    "assetState",
    "initial_account_asset_state",
    "initialAccountAssetState",
    "data",
    "payload",
    "result",
    "stored",
    "account_assets",
    "accountAssets",
  ].forEach((key) => {
    rows.push(...collectAssetV2Payloads(object[key], depth + 1, seen));
  });
  return rows;
}

export function accountAssetFanoutFromValue(value = {}) {
  const payloads = collectAssetV2Payloads(value);
  if (!payloads.length) return null;

  const itemsById = new Map();
  const cloudsByBlob = new Map();
  const devicesByAsset = new Map();
  const removedAssets = [];
  const transfers = [];
  const registryClouds = [];
  let aggregate = null;
  let eventKindValue = "";
  let serverCursor = "";
  let snapshotFull = false;

  payloads.forEach((payload) => {
    const cols = jsonObject(payload.cols) || {};
    const event = eventKind(payload);
    eventKindValue ||= event;
    serverCursor ||= text(payload.cur, payload.cursor, payload.server_cursor, payload.serverCursor, payload.sync_cursor, payload.syncCursor);
    snapshotFull = snapshotFull
      || booleanValue(payload.sf ?? payload.snapshot_full ?? payload.snapshotFull, false)
      || event === "asset-snapshot";
    aggregate ||= jsonObject(payload.ag) || jsonObject(payload.aggregate);
    jsonArray(payload.clouds || payload.asset_clouds || payload.assetClouds).forEach((cloud) => {
      if (jsonObject(cloud)) registryClouds.push(cloud);
    });

    compactRows(payload, "c").forEach((row) => {
      const object = compactRowObject(row, cols.c || ["bid", "cid", "st", "ut"]);
      const blobId = text(object?.bid, object?.blob_id, object?.blobId);
      const cloudId = text(object?.cid, object?.cloud_id, object?.cloudId);
      if (!blobId || !cloudId) return;
      const status = text(object.st, object.status, object.cloud_status, object.cloudStatus);
      const cloud = {
        blob_id: blobId,
        blobId,
        cloud_id: cloudId,
        cloudId: cloudId,
        id: cloudId,
        status,
        cloud_status: status,
        cloudStatus: status,
        cloud_available: CLOUD_AVAILABLE_STATUS_TOKENS.has(normalizedToken(status)),
        cloudAvailable: CLOUD_AVAILABLE_STATUS_TOKENS.has(normalizedToken(status)),
        updated_at: compactUpdatedAt(object.ut ?? object.updated_at ?? object.updatedAt),
        updatedAt: compactUpdatedAt(object.ut ?? object.updated_at ?? object.updatedAt),
      };
      if (!cloudsByBlob.has(blobId)) cloudsByBlob.set(blobId, []);
      cloudsByBlob.get(blobId).push(cloud);
    });

    compactRows(payload, "p").forEach((row) => {
      const object = compactRowObject(row, cols.p || ["aid", "dev", "st", "ut"]);
      const assetId = text(object?.aid, object?.asset_id, object?.assetId);
      const deviceId = text(object?.dev, object?.device_id, object?.deviceId);
      if (!assetId || !deviceId) return;
      const status = text(object.st, object.status, object.local_status, object.localStatus);
      const device = {
        asset_id: assetId,
        assetId: assetId,
        device_id: deviceId,
        deviceId: deviceId,
        id: deviceId,
        local_status: status,
        localStatus: status,
        local_available: LOCAL_AVAILABLE_STATUS_TOKENS.has(normalizedToken(status)),
        localAvailable: LOCAL_AVAILABLE_STATUS_TOKENS.has(normalizedToken(status)),
        updated_at: compactUpdatedAt(object.ut ?? object.updated_at ?? object.updatedAt),
        updatedAt: compactUpdatedAt(object.ut ?? object.updated_at ?? object.updatedAt),
      };
      if (!devicesByAsset.has(assetId)) devicesByAsset.set(assetId, []);
      devicesByAsset.get(assetId).push(device);
    });

    compactRows(payload, "a").forEach((row) => {
      const object = compactRowObject(row, cols.a || ["aid", "bid", "n", "k", "mt", "sz", "sha", "st", "ut"]);
      const assetId = text(object?.aid, object?.asset_id, object?.assetId, object?.id);
      if (!assetId) return;
      const blobId = text(object.bid, object.blob_id, object.blobId);
      itemsById.set(assetId, {
        asset_id: assetId,
        assetId: assetId,
        id: assetId,
        blob_id: blobId,
        blobId,
        name: text(object.n, object.name),
        kind: text(object.k, object.kind),
        mime_type: text(object.mt, object.mime_type, object.mimeType),
        mimeType: text(object.mt, object.mime_type, object.mimeType),
        size_bytes: numberValue(object.sz, object.size_bytes, object.sizeBytes),
        sizeBytes: numberValue(object.sz, object.size_bytes, object.sizeBytes),
        sha256: text(object.sha, object.sha256),
        cloud_status: text(object.st, object.status, object.cloud_status, object.cloudStatus),
        cloudStatus: text(object.st, object.status, object.cloud_status, object.cloudStatus),
        updated_at: compactUpdatedAt(object.ut ?? object.updated_at ?? object.updatedAt),
        updatedAt: compactUpdatedAt(object.ut ?? object.updated_at ?? object.updatedAt),
      });
    });

    compactRows(payload, "r").forEach((row) => {
      const object = compactRowObject(row, cols.r || ["aid", "ut"]);
      const assetId = text(object?.aid, object?.asset_id, object?.assetId, object?.id);
      if (!assetId) return;
      removedAssets.push({
        asset_id: assetId,
        assetId: assetId,
        id: assetId,
        deleted: true,
        status: "deleted",
        updated_at: compactUpdatedAt(object.ut ?? object.updated_at ?? object.updatedAt),
        updatedAt: compactUpdatedAt(object.ut ?? object.updated_at ?? object.updatedAt),
      });
    });

    compactRows(payload, "x").forEach((row) => {
      const object = compactRowObject(row, cols.x || ["tid", "aid", "dir", "dev", "cid", "st", "dn", "tot", "err", "ut"]);
      const transferId = text(object?.tid, object?.transfer_id, object?.transferId, object?.id);
      if (!transferId) return;
      transfers.push({
        transfer_id: transferId,
        transferId: transferId,
        id: transferId,
        asset_id: text(object.aid, object.asset_id, object.assetId),
        assetId: text(object.aid, object.asset_id, object.assetId),
        direction: text(object.dir, object.direction),
        device_id: text(object.dev, object.device_id, object.deviceId),
        deviceId: text(object.dev, object.device_id, object.deviceId),
        cloud_id: text(object.cid, object.cloud_id, object.cloudId),
        cloudId: text(object.cid, object.cloud_id, object.cloudId),
        status: text(object.st, object.status),
        bytes_done: numberValue(object.dn, object.bytes_done, object.bytesDone, object.done),
        bytesDone: numberValue(object.dn, object.bytes_done, object.bytesDone, object.done),
        bytes_total: numberValue(object.tot, object.bytes_total, object.bytesTotal, object.total),
        bytesTotal: numberValue(object.tot, object.bytes_total, object.bytesTotal, object.total),
        error: text(object.err, object.error),
        updated_at: compactUpdatedAt(object.ut ?? object.updated_at ?? object.updatedAt),
        updatedAt: compactUpdatedAt(object.ut ?? object.updated_at ?? object.updatedAt),
      });
    });

    if (event === "asset-tx" || event === "asset-terminal") {
      const transferId = text(payload.tid, payload.transfer_id, payload.transferId);
      if (transferId) {
        transfers.push({
          transfer_id: transferId,
          transferId: transferId,
          id: transferId,
          asset_id: text(payload.aid, payload.asset_id, payload.assetId),
          assetId: text(payload.aid, payload.asset_id, payload.assetId),
          direction: text(payload.dir, payload.direction),
          device_id: text(payload.dev, payload.device_id, payload.deviceId),
          deviceId: text(payload.dev, payload.device_id, payload.deviceId),
          cloud_id: text(payload.cid, payload.cloud_id, payload.cloudId),
          cloudId: text(payload.cid, payload.cloud_id, payload.cloudId),
          status: text(payload.st, payload.status),
          bytes_done: numberValue(payload.dn, payload.bytes_done, payload.bytesDone),
          bytesDone: numberValue(payload.dn, payload.bytes_done, payload.bytesDone),
          bytes_total: numberValue(payload.tot, payload.bytes_total, payload.bytesTotal),
          bytesTotal: numberValue(payload.tot, payload.bytes_total, payload.bytesTotal),
          error: text(payload.err, payload.error),
          updated_at: compactUpdatedAt(payload.ut ?? payload.updated_at ?? payload.updatedAt),
          updatedAt: compactUpdatedAt(payload.ut ?? payload.updated_at ?? payload.updatedAt),
        });
      }
    }
  });

  const items = [...itemsById.values()].map((item) => {
    const clouds = cloudsByBlob.get(item.blob_id) || [];
    const devices = devicesByAsset.get(item.asset_id) || [];
    return {
      ...item,
      clouds,
      cloud_statuses: clouds,
      cloudStatuses: clouds,
      cloud_available: clouds.some((cloud) => cloud.cloud_available || cloud.cloudAvailable),
      cloudAvailable: clouds.some((cloud) => cloud.cloud_available || cloud.cloudAvailable),
      devices,
      device_count: devices.length,
      deviceCount: devices.length,
      synced_device_count: devices.filter((device) => device.local_available || device.localAvailable).length,
      syncedDeviceCount: devices.filter((device) => device.local_available || device.localAvailable).length,
    };
  });

  return {
    aggregate: aggregate || {},
    clouds: registryClouds,
    eventKind: eventKindValue || "asset-delta",
    items,
    assets: items,
    known: true,
    removedAssets,
    removed_assets: removedAssets,
    serverCursor,
    snapshotFull,
    transfers,
  };
}

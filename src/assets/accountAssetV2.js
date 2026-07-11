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

function assetDocBacked(row = {}) {
  const object = jsonObject(row);
  if (!object) return false;
  const metadata = jsonObject(object.metadata) || {};
  const sourceKind = normalizedToken(
    text(
      object.src,
      object.source_kind,
      object.source,
      metadata.src,
      metadata.source_kind,
      metadata.source,
    ),
  );
  const docDomain = normalizedToken(
    text(
      object.dom,
      object.doc_domain,
      metadata.dom,
      metadata.doc_domain,
    ),
  );
  const folder = normalizedToken(
    text(
      object.fold,
      object.asset_folder,
      object.folder,
      object.group,
      object.asset_group,
      metadata.fold,
      metadata.asset_folder,
      metadata.folder,
      metadata.group,
      metadata.asset_group,
    ),
  );
  return DOC_BACKED_ASSET_SOURCE_TOKENS.has(sourceKind)
    || DOC_BACKED_ASSET_DOMAIN_TOKENS.has(docDomain)
    || DOC_BACKED_ASSET_FOLDER_TOKENS.has(folder);
}

function compactUpdatedAt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString();
  }
  return text(value);
}

function eventKind(value = {}) {
  return normalizedToken(value.t || value.event_kind || value.kind || value.ev);
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
    "initial_account_asset_state",
    "data",
    "payload",
    "result",
    "stored",
    "account_assets",
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
    serverCursor ||= text(payload.cur, payload.cursor, payload.server_cursor, payload.sync_cursor);
    snapshotFull = snapshotFull
      || booleanValue(payload.sf ?? payload.snapshot_full, false)
      || event === "asset-snapshot";
    aggregate ||= jsonObject(payload.ag) || jsonObject(payload.aggregate);
    jsonArray(payload.clouds || payload.asset_clouds).forEach((cloud) => {
      if (jsonObject(cloud)) registryClouds.push(cloud);
    });

    compactRows(payload, "c").forEach((row) => {
      const object = compactRowObject(row, cols.c || ["bid", "cid", "st", "ut"]);
      const blobId = text(object?.bid, object?.blob_id);
      const cloudId = text(object?.cid, object?.cloud_id);
      if (!blobId || !cloudId) return;
      const status = text(object.st, object.status, object.cloud_status);
      const cloud = {
        blob_id: blobId,
        cloud_id: cloudId,
        id: cloudId,
        status,
        cloud_status: status,
        cloud_available: CLOUD_AVAILABLE_STATUS_TOKENS.has(normalizedToken(status)),
        updated_at: compactUpdatedAt(object.ut ?? object.updated_at),
      };
      if (!cloudsByBlob.has(blobId)) cloudsByBlob.set(blobId, []);
      cloudsByBlob.get(blobId).push(cloud);
    });

    compactRows(payload, "p").forEach((row) => {
      const object = compactRowObject(row, cols.p || ["aid", "dev", "st", "ut"]);
      const assetId = text(object?.aid, object?.asset_id);
      const deviceId = text(object?.dev, object?.device_id);
      if (!assetId || !deviceId) return;
      const status = text(object.st, object.status, object.local_status);
      const device = {
        asset_id: assetId,
        device_id: deviceId,
        id: deviceId,
        local_status: status,
        local_available: LOCAL_AVAILABLE_STATUS_TOKENS.has(normalizedToken(status)),
        updated_at: compactUpdatedAt(object.ut ?? object.updated_at),
      };
      if (!devicesByAsset.has(assetId)) devicesByAsset.set(assetId, []);
      devicesByAsset.get(assetId).push(device);
    });

    compactRows(payload, "a").forEach((row) => {
      const object = compactRowObject(row, cols.a || ["aid", "bid", "n", "k", "mt", "sz", "sha", "st", "ut", "src", "fold", "dom", "pub", "purl"]);
      const assetId = text(object?.aid, object?.asset_id, object?.id);
      if (!assetId) return;
      const blobId = text(object.bid, object.blob_id);
      const sourceKind = text(object.src, object.source_kind, object.source);
      const folder = text(object.fold, object.asset_folder, object.folder, object.group, object.asset_group);
      const docDomain = text(object.dom, object.doc_domain);
      if (assetDocBacked({ source_kind: sourceKind, folder, doc_domain: docDomain })) {
        return;
      }
      /* "pub" is tri-state: 1/0 when the cloud resolved the public link,
         absent on older payloads — omit the fields then so merges keep
         prior knowledge instead of reading "unknown" as "private". */
      const publicState = object.pub === undefined || object.pub === null
        ? null
        : Boolean(Number(object.pub));
      const publicFields = publicState === null ? {} : {
        public: publicState,
        is_public: publicState,
        public_url: publicState ? text(object.purl, object.public_url) : "",
      };
      itemsById.set(assetId, {
        ...publicFields,
        asset_id: assetId,
        id: assetId,
        blob_id: blobId,
        name: text(object.n, object.name),
        kind: text(object.k, object.kind),
        mime_type: text(object.mt, object.mime_type),
        size_bytes: numberValue(object.sz, object.size_bytes),
        sha256: text(object.sha, object.sha256),
        cloud_status: text(object.st, object.status, object.cloud_status),
        source_kind: sourceKind,
        folder,
        group: folder,
        asset_folder: folder,
        asset_group: folder,
        doc_domain: docDomain,
        metadata: {
          source_kind: sourceKind,
          folder,
          group: folder,
          asset_folder: folder,
          doc_domain: docDomain,
        },
        updated_at: compactUpdatedAt(object.ut ?? object.updated_at),
      });
    });

    compactRows(payload, "r").forEach((row) => {
      const object = compactRowObject(row, cols.r || ["aid", "ut"]);
      const assetId = text(object?.aid, object?.asset_id, object?.id);
      if (!assetId) return;
      removedAssets.push({
        asset_id: assetId,
        id: assetId,
        deleted: true,
        status: "deleted",
        updated_at: compactUpdatedAt(object.ut ?? object.updated_at),
      });
    });

    compactRows(payload, "x").forEach((row) => {
      const object = compactRowObject(row, cols.x || ["tid", "aid", "dir", "dev", "cid", "st", "dn", "tot", "err", "ut"]);
      const transferId = text(object?.tid, object?.transfer_id, object?.id);
      if (!transferId) return;
      transfers.push({
        transfer_id: transferId,
        id: transferId,
        asset_id: text(object.aid, object.asset_id),
        direction: text(object.dir, object.direction),
        device_id: text(object.dev, object.device_id),
        cloud_id: text(object.cid, object.cloud_id),
        status: text(object.st, object.status),
        bytes_done: numberValue(object.dn, object.bytes_done, object.done),
        bytes_total: numberValue(object.tot, object.bytes_total, object.total),
        error: text(object.err, object.error),
        updated_at: compactUpdatedAt(object.ut ?? object.updated_at),
      });
    });

    if (event === "asset-tx" || event === "asset-terminal") {
      const transferId = text(payload.tid, payload.transfer_id);
      if (transferId) {
        transfers.push({
          transfer_id: transferId,
          id: transferId,
          asset_id: text(payload.aid, payload.asset_id),
          direction: text(payload.dir, payload.direction),
          device_id: text(payload.dev, payload.device_id),
          cloud_id: text(payload.cid, payload.cloud_id),
          status: text(payload.st, payload.status),
          bytes_done: numberValue(payload.dn, payload.bytes_done),
          bytes_total: numberValue(payload.tot, payload.bytes_total),
          error: text(payload.err, payload.error),
          updated_at: compactUpdatedAt(payload.ut ?? payload.updated_at),
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
      cloud_available: clouds.some((cloud) => cloud.cloud_available),
      devices,
      device_count: devices.length,
      synced_device_count: devices.filter((device) => device.local_available).length,
    };
  });

  return {
    aggregate: aggregate || {},
    clouds: registryClouds,
    event_kind: eventKindValue || "asset-delta",
    items,
    assets: items,
    known: true,
    removed_assets: removedAssets,
    server_cursor: serverCursor,
    snapshot_full: snapshotFull,
    transfers,
  };
}

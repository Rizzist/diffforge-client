export const TODO_QUEUE_DEVICE_KIND_DESKTOP = "desktop";
export const TODO_QUEUE_DEVICE_KIND_MOBILE = "mobile";
export const TODO_QUEUE_DEVICE_KIND_UNKNOWN = "unknown";

function todoQueueDeviceWorkspaceKey(deviceId, workspaceId) {
  return JSON.stringify([
    normalizeTodoQueueSwitcherId(deviceId),
    normalizeWorkspaceId(workspaceId),
  ]);
}

const LIVE_STATE_PRESENT_KEYS = [
  "connected",
  "online",
  "live",
  "active",
  "is_connected",
  "is_online",
  "native_connected",
  "web_connected",
];

const NATIVE_CONNECTED_KEYS = [
  "native_connected",
  "native_online",
  "native_active",
];

const WEB_CONNECTED_KEYS = [
  "web_connected",
  "web_active",
  "web_open",
  "web_online",
];

const LIVE_STATE_STATUS_KEYS = [
  "status",
  "state",
  "connection",
  "connection_status",
  "live_status",
  "presence_status",
];

const LIVE_STATE_CONTAINER_KEYS = [
  "account_device_live_state_snapshot",
  "client_connection",
  "server_roster",
  "account_device_server_roster",
  "registered_devices",
  "device_registry",
  "devices",
  "items",
  "machines",
  "clients",
  "client_devices",
  "account_devices",
  "active_desktop_devices",
  "desktop_devices",
  "mobile_devices",
  "web_devices",
  "workspaces",
  "workspace_states",
  "workspace_presence",
  "workspace_live_state",
  "terminals",
  "terminal_sessions",
  "sessions",
];

const DEVICE_ALIAS_KEYS = [
  "id",
  "device_id",
  "desktop_device_id",
  "source_device_id",
  "target_device_id",
  "target_native_device_id",
  "todo_device_id",
  "machine_id",
  "native_device_id",
  "current_web_device_id",
  "web_device_id",
  "web_presence_device_id",
  "browser_device_id",
  "matched_device_id",
  "requested_target_device_id",
  // Server-side fold linking fields: an identity-migrated row (new native id or
  // a durable-web standalone card) still merges with its canonical device
  // instead of rendering as a duplicate.
  "card_id",
  "physical_device_id",
  "bound_native_device_id",
  "device_aliases",
  "replaced_web_device_ids",
];

const TODO_WORKSPACE_CONTAINER_KEYS = [
  "items",
  "todos",
  "items_by_workspace",
  "todos_by_workspace",
  "dispatch_targets",
  "dispatch_targets_by_workspace",
  "dispatches",
  "todo_dispatches",
  "dispatches_by_workspace",
  "todo_dispatches_by_workspace",
  "peer_activity",
  "peer_activity_by_workspace",
  "workspace_peer_activity",
];

const WORKSPACE_STATUS_KEYS = [
  "workspace_status",
  "runtime_status",
  "display_status",
  "status",
  "state",
  "phase",
];

const WORKSPACE_ACTIVE_KEYS = [
  "workspace_active",
  "active",
  "activated",
  "selected",
  "workspace_selected",
  "is_active",
];

const WORKSPACE_TERMINAL_KEYS = [
  "terminals",
  "terminal_sessions",
  "terminal_list",
  "sessions",
];

const WORKSPACE_SERVER_KEYS = [
  "servers",
  "server_sessions",
  "services",
];

const WORKSPACE_MCP_KEYS = [
  "mcps",
  "mcp_servers",
  "mcp_sessions",
];

function firstText(...values) {
  return values
    .map((value) => String(value ?? "").trim())
    .find(Boolean) || "";
}

export function normalizeTodoQueueSwitcherId(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const cleaned = [...trimmed]
    .map((character) => (/[A-Za-z0-9._-]/.test(character) ? character : "_"))
    .join("")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 96)
    .toLowerCase();
  return cleaned || "dev-client";
}

function normalizeWorkspaceId(value) {
  return String(value || "").trim();
}

// Workspace ids are usually absolute paths. Keep the original spelling for commands and
// display, but use one path-aware key whenever ids are compared. Windows can report the
// same workspace with either slash style, a differently-cased drive letter/path, or the
// extended-length path prefix depending on which runtime produced the row.
function todoQueuePlatformIsWindows(platform) {
  const normalized = String(platform || "").trim().toLowerCase();
  return ["windows", "win32", "win64"].includes(normalized) || normalized.startsWith("windows ");
}

export function normalizeTodoQueueWorkspaceMatchId(value, platform = "") {
  const raw = normalizeWorkspaceId(value);
  const windowsPath = todoQueuePlatformIsWindows(platform);
  let normalized = windowsPath ? raw.replace(/\\/g, "/") : raw;
  if (!normalized) {
    return "";
  }
  if (windowsPath) {
    normalized = normalized
      .replace(/^\/\/\?\//, "")
      .replace(/^unc\//i, "//")
      .replace(/^\/([a-z]:\/)/i, "$1")
      .replace(/\/{2,}/g, "/");
  }
  if (normalized.length > 1 && !/^[a-z]:\/$/i.test(normalized)) {
    normalized = normalized.replace(/\/+$/, "");
  }
  return windowsPath ? normalized.toLowerCase() : normalized;
}

// Production todo_store_snapshot hydration gate. It deliberately receives the
// owning device platform; a Windows catalog can otherwise lose its own rows
// when Rust and the webview spell the same path with different slash/case.
export function buildTodoQueueHydratedSnapshotRows({
  device_id: deviceId = "",
  platform = "",
  snapshot = null,
  workspace_id: workspaceId = "",
} = {}) {
  const safeWorkspaceId = normalizeWorkspaceId(workspaceId);
  const workspaceMatchId = normalizeTodoQueueWorkspaceMatchId(safeWorkspaceId, platform);
  const safeDeviceId = normalizeTodoQueueSwitcherId(deviceId);
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  return items
    .filter((item) => {
      const itemWorkspaceId = normalizeWorkspaceId(item?.workspace_id);
      return !workspaceMatchId
        || !itemWorkspaceId
        || normalizeTodoQueueWorkspaceMatchId(itemWorkspaceId, platform) === workspaceMatchId;
    })
    .map((item) => ({
      ...item,
      ...(
        safeDeviceId && !normalizeTodoQueueSwitcherId(item?.device_id)
          ? { device_id: safeDeviceId }
          : {}
      ),
      ...(
        safeWorkspaceId && !normalizeWorkspaceId(item?.workspace_id)
          ? { workspace_id: safeWorkspaceId }
          : {}
      ),
    }));
}

function normalizeLiveBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on", "connected", "online", "live", "active"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off", "disconnected", "offline", "closed", "inactive"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function boolFromKeys(object, keys) {
  if (!object || typeof object !== "object") {
    return null;
  }
  return keys
    .map((key) => normalizeLiveBoolean(object[key]))
    .find((value) => value !== null) ?? null;
}

function normalizedToken(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function surfaceRecordFor(record, surfaceId) {
  const surfaces = record?.surfaces;
  if (Array.isArray(surfaces)) {
    return surfaces.find((surface) => (
      normalizedToken(surface?.id || surface?.label || surface?.name) === surfaceId
    )) || {};
  }
  if (surfaces && typeof surfaces === "object") {
    const direct = surfaces[surfaceId] || surfaces[surfaceId.toLowerCase()];
    return direct && typeof direct === "object" ? direct : {};
  }
  return {};
}

function webPresenceForRecord(record) {
  const direct = record?.web_presence;
  if (direct && typeof direct === "object") {
    return direct;
  }
  return surfaceRecordFor(record, "web");
}

function appendDeviceAlias(aliases, value) {
  if (Array.isArray(value)) {
    value.forEach((item) => appendDeviceAlias(aliases, item));
    return;
  }
  if (value && typeof value === "object") {
    DEVICE_ALIAS_KEYS.forEach((key) => appendDeviceAlias(aliases, value[key]));
    return;
  }
  if (typeof value !== "string" && typeof value !== "number") {
    return;
  }
  const normalized = normalizeTodoQueueSwitcherId(value);
  if (normalized) {
    aliases.add(normalized);
  }
}

function deviceAliasesForRecord(record, primaryId = "") {
  const aliases = new Set();
  appendDeviceAlias(aliases, primaryId);
  if (!record || typeof record !== "object") {
    return Array.from(aliases);
  }
  DEVICE_ALIAS_KEYS.forEach((key) => appendDeviceAlias(aliases, record[key]));
  appendDeviceAlias(aliases, record.device);
  appendDeviceAlias(aliases, record.raw_device);
  appendDeviceAlias(aliases, record.web_presence);
  appendDeviceAlias(aliases, surfaceRecordFor(record, "native"));
  appendDeviceAlias(aliases, surfaceRecordFor(record, "web"));
  return Array.from(aliases);
}

function uniqueDeviceAliases(...aliasLists) {
  const aliases = new Set();
  aliasLists.forEach((list) => appendDeviceAlias(aliases, list));
  return Array.from(aliases);
}

function aliasesIntersect(left = [], right = []) {
  const rightSet = new Set((Array.isArray(right) ? right : [right]).map(normalizeTodoQueueSwitcherId).filter(Boolean));
  return (Array.isArray(left) ? left : [left])
    .map(normalizeTodoQueueSwitcherId)
    .filter(Boolean)
    .some((alias) => rightSet.has(alias));
}

export function todoQueueDeviceRecordsShareIdentity(left = {}, right = {}) {
  return aliasesIntersect(
    deviceAliasesForRecord(left, left?.device_id),
    deviceAliasesForRecord(right, right?.device_id),
  );
}

function firstDeviceObject(...values) {
  return values.find((value) => value && typeof value === "object" && !Array.isArray(value)) || {};
}

function collectDeviceIdsFromValue(value, ids = new Set()) {
  if (!value) {
    return ids;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDeviceIdsFromValue(item, ids));
    return ids;
  }
  if (typeof value === "object") {
    deviceAliasesForRecord(value).forEach((id) => ids.add(id));
    return ids;
  }
  const id = normalizeTodoQueueSwitcherId(value);
  if (id) {
    ids.add(id);
  }
  return ids;
}

function liveStateSnapshotRoot(value) {
  if (!value || typeof value !== "object") {
    return { root: {}, snapshotRoot: {} };
  }
  const root = value?.data && typeof value.data === "object" ? value.data : value;
  const accountSnapshot = root.account_device_live_state_snapshot || root.device_live_state_snapshot || null;
  const snapshotRoot = accountSnapshot && typeof accountSnapshot === "object"
    ? accountSnapshot
    : root;
  return { root, snapshotRoot };
}

function connectionOverlayFromLiveState(value) {
  const { root, snapshotRoot } = liveStateSnapshotRoot(value);
  const summary = firstDeviceObject(
    snapshotRoot.client_connection,
    snapshotRoot.connection_summary,
    root.client_connection,
    root.connection_summary,
  );
  const activeNativeIds = collectDeviceIdsFromValue([
    summary.active_desktop_device_ids,
    summary.active_native_device_ids,
    summary.active_desktop_devices,
    summary.active_native_devices,
  ]);
  const activeWebTargetIds = collectDeviceIdsFromValue([
    summary.active_web_target_device_ids,
  ]);
  const activeWebDevices = Array.isArray(summary.active_web_devices)
    ? summary.active_web_devices
    : [];
  activeWebDevices.forEach((device) => {
    collectDeviceIdsFromValue(
      device?.target_device_id || device?.target_native_device_id,
      activeWebTargetIds,
    );
  });
  return { activeNativeIds, activeWebTargetIds };
}

function applyConnectionOverlayToDevices(devices, liveState) {
  const { activeNativeIds, activeWebTargetIds } = connectionOverlayFromLiveState(liveState);
  if (!activeNativeIds.size && !activeWebTargetIds.size) {
    return devices;
  }
  return devices.map((device) => {
    const aliases = uniqueDeviceAliases(device?.device_aliases, device?.device_id);
    const nativeOverlayActive = aliases.some((id) => activeNativeIds.has(id));
    const webOverlayActive = aliases.some((id) => activeWebTargetIds.has(id));
    if (!nativeOverlayActive && !webOverlayActive) {
      return device;
    }
    const nativeConnected = nativeOverlayActive ? true : device.native_connected;
    const webConnected = webOverlayActive ? true : device.web_connected;
    return {
      ...device,
      connected: true,
      liveState: "live",
      native_connected: nativeConnected,
      web_connected: webConnected,
    };
  });
}

function recordLooksWebOnly(record) {
  const web = webPresenceForRecord(record);
  const source = [
    record?.client_kind,
    record?.client_type,
    record?.connection_source,
    record?.source,
    web?.client_kind,
    web?.source,
  ].map(normalizedToken).join(" ");
  return source.includes("web")
    || source.includes("browser")
    || source.includes("dashboard")
    || source.includes("next-diffforge");
}

function idLooksWebOnly(value) {
  const id = normalizeTodoQueueSwitcherId(value);
  return !id || id === "dashboard-web" || id.startsWith("web-") || id.startsWith("browser-");
}

function objectHasEntries(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function recordHasNativeAnchor(record) {
  if (!record || typeof record !== "object") {
    return false;
  }
  const web = webPresenceForRecord(record);
  const nativeSurface = surfaceRecordFor(record, "native");
  const nativeIds = uniqueDeviceAliases(
    record.device_id,
    record.machine_id,
    record.native_device_id,
    record.desktop_device_id,
    record.target_native_device_id,
    web?.native_device_id,
    nativeSurface?.device_id,
    nativeSurface?.machine_id,
  );
  const platformAndForm = [
    record.platform,
    record.os,
    record.form_factor,
    record.device_type,
    web?.web_platform,
    web?.web_form_factor,
  ].map(normalizedToken).join(" ");
  const clientKind = [
    record.client_kind,
    record.client_type,
    record.connection_source,
    record.source,
    nativeSurface?.client_kind,
    nativeSurface?.client_type,
    nativeSurface?.source,
  ].map(normalizedToken).join(" ");
  const mobileLike = ["mobile", "phone", "tablet", "android", "ios", "iphone", "ipad"]
    .some((token) => platformAndForm.includes(token));
  const webLike = clientKind.includes("web")
    || clientKind.includes("browser")
    || clientKind.includes("dashboard")
    || clientKind.includes("next-diffforge");
  const nativeFlag = (boolFromKeys(record, NATIVE_CONNECTED_KEYS)
    ?? boolFromKeys(nativeSurface, ["connected", "active", "online", "open", "status", "state"])) === true;
  const nativeLike = ["native", "desktop", "tauri", "rust"].some((token) => clientKind.includes(token));
  const workspaceCount = Number(record.workspace_count ?? 0) || 0;
  const hasWorkspaces = workspaceCount > 0 || objectHasEntries(record.workspaces) || objectHasEntries(record.workspace_catalog) || objectHasEntries(record.workspace_states);
  const hasNativeId = nativeIds.some((id) => !idLooksWebOnly(id));
  return Boolean(
    !mobileLike
      && (hasNativeId || hasWorkspaces)
      && (!webLike || nativeFlag || nativeLike || hasWorkspaces)
  );
}

function nativeConnectedForRecord(record, inherited = null) {
  const nativeSurface = surfaceRecordFor(record, "native");
  const explicit = boolFromKeys(record, NATIVE_CONNECTED_KEYS)
    ?? boolFromKeys(nativeSurface, ["connected", "active", "online", "open", "status", "state"]);
  if (explicit !== null) {
    return explicit;
  }
  if (webConnectedForRecord(record, null) !== null) {
    return inherited?.native_connected ?? null;
  }
  const generic = boolFromKeys(record, ["connected", "online", "live", "active", "status", "state"]);
  if (generic !== null && (!recordLooksWebOnly(record) || recordHasNativeAnchor(record))) {
    return generic;
  }
  return inherited?.native_connected ?? null;
}

function webConnectedForRecord(record, inherited = null) {
  const web = webPresenceForRecord(record);
  const webSurface = surfaceRecordFor(record, "web");
  const explicit = boolFromKeys(record, WEB_CONNECTED_KEYS)
    ?? boolFromKeys(web, ["connected", "active", "online", "open", "status", "state"])
    ?? boolFromKeys(webSurface, ["connected", "active", "online", "open", "status", "state"])
    ?? null;
  if (explicit !== null) {
    return explicit;
  }
  const generic = boolFromKeys(record, ["connected", "online", "live", "active", "status", "state"]);
  if (generic !== null && recordLooksWebOnly(record)) {
    return generic;
  }
  return inherited?.web_connected ?? null;
}

function liveStateFromSurfaces(nativeConnected, webConnected, explicitConnected, fallback = "unknown") {
  const hasSurfaceState = nativeConnected !== null || webConnected !== null;
  if (nativeConnected === true || webConnected === true || explicitConnected === true) {
    if (!hasSurfaceState || nativeConnected === true || webConnected === true) {
      return "live";
    }
  }
  if (hasSurfaceState && nativeConnected !== true && webConnected !== true) {
    return "offline";
  }
  if (
    (nativeConnected === false || nativeConnected === null)
    && (webConnected === false || webConnected === null)
    && explicitConnected === false
  ) {
    return "offline";
  }
  if (nativeConnected === false && webConnected === false) {
    return "offline";
  }
  return fallback;
}

function mergeNullableBooleans(left, right) {
  if (right === true || right === false) return right;
  if (left === true || left === false) return left;
  return null;
}

function mergeDeviceSurfaceBoolean(previous, next, key) {
  const left = previous?.[key];
  const right = next?.[key];
  if (right === true) return true;
  if (right === false) {
    if (previous?.registered && !next?.registered && (left === true || left === false)) {
      return left;
    }
    // A web-identity echo merging into a canonical device row may LIGHT its
    // surfaces but never darken them: the canonical row's own v2 stamp is
    // the authority for its badges.
    if (next?.web_only === true && previous?.web_only !== true && (left === true || left === false)) {
      return left;
    }
    return false;
  }
  if (left === true || left === false) return left;
  return null;
}

function readFirstKey(object, keys) {
  if (!object || typeof object !== "object") {
    return undefined;
  }
  return keys.map((key) => object[key]).find((value) => value !== undefined && value !== null);
}

function hasAnyKey(object, keys) {
  return Boolean(object && typeof object === "object" && keys.some((key) => object[key] !== undefined && object[key] !== null));
}

function normalizeDeviceKind(value, fallback = TODO_QUEUE_DEVICE_KIND_UNKNOWN) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (!normalized) {
    return fallback;
  }
  if (
    normalized.includes("mobile")
    || normalized.includes("phone")
    || normalized.includes("tablet")
    || normalized.includes("ios")
    || normalized.includes("android")
    || normalized === "ipad"
    || normalized === "iphone"
  ) {
    return TODO_QUEUE_DEVICE_KIND_MOBILE;
  }
  if (
    normalized.includes("desktop")
    || normalized.includes("laptop")
    || normalized.includes("mac")
    || normalized.includes("windows")
    || normalized.includes("linux")
    || normalized.includes("darwin")
    || normalized.includes("pc")
    || normalized.includes("computer")
  ) {
    return TODO_QUEUE_DEVICE_KIND_DESKTOP;
  }
  return fallback;
}

function deviceKindForRecord(record, fallback = TODO_QUEUE_DEVICE_KIND_UNKNOWN) {
  const direct = normalizeDeviceKind(
    readFirstKey(record, [
      "device_kind",
      "kind",
      "client_kind",
      "client_type",
      "form_factor",
      "device_type",
      "platform",
      "os",
    ]),
    "",
  );
  return direct || fallback;
}

function liveStateForRecord(record, fallback = "unknown") {
  const direct = LIVE_STATE_PRESENT_KEYS
    .map((key) => normalizeLiveBoolean(record?.[key]))
    .find((value) => value !== null);
  if (direct === true) return "live";
  if (direct === false) return "offline";

  const status = String(readFirstKey(record, LIVE_STATE_STATUS_KEYS) || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (["connected", "online", "live", "active", "ready", "open"].includes(status)) {
    return "live";
  }
  if (["disconnected", "offline", "closed", "inactive", "stale"].includes(status)) {
    return "offline";
  }
  return fallback;
}

function deviceIdForRecord(record) {
  const explicit = normalizeTodoQueueSwitcherId(readFirstKey(record, [
    "device_id",
    "desktop_device_id",
    "source_device_id",
    "target_device_id",
    "todo_device_id",
    "machine_id",
    "client_id",
  ]));
  if (explicit) {
    return explicit;
  }
  if (hasAnyKey(record, [
    "display_name",
    "device_name",
    "machine_name",
    "hostname",
    "client_kind",
    "client_type",
    "form_factor",
    "device_type",
    "platform",
    "os",
  ])) {
    return normalizeTodoQueueSwitcherId(record?.id);
  }
  return "";
}

function deviceNameForRecord(record, index = 0) {
  return firstText(
    record?.display_name,
    record?.device_name,
    record?.target_device_name,
    record?.source_device_name,
    record?.machine_name,
    record?.hostname,
    record?.label,
    record?.name,
    index === 0 ? "This device" : `Device ${index + 1}`,
  );
}

function deviceNameIsGeneric(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return (
    !normalized
    || normalized === "this device"
    || normalized === "diff forge client"
    || /^device \d+$/i.test(normalized)
  );
}

function workspaceIdForRecord(record, fallback = "") {
  const explicit = normalizeWorkspaceId(readFirstKey(record, [
    "source_workspace_id",
    "target_workspace_id",
    "workspace_id",
    "observer_workspace_id",
    "repo_workspace_id",
  ]));
  if (explicit) {
    return explicit;
  }
  if (fallback) {
    return normalizeWorkspaceId(fallback);
  }
  if (
    hasAnyKey(record, [
      "workspace_name",
      "source_workspace_name",
      "target_workspace_name",
      "repo_path",
      "git_repo_display_name",
    ])
    && !deviceIdForRecord(record)
  ) {
    return normalizeWorkspaceId(record?.id);
  }
  return "";
}

function todoMirrorWorkspaceIdsForRecord(record, fallback = "") {
  const targetDeviceIds = [
    record?.target_device_id,
    record?.target?.device_id,
  ]
    .map(normalizeTodoQueueSwitcherId)
    .filter(Boolean);
  const targetWorkspaceIds = [
    record?.target_workspace_id,
    record?.target?.workspace_id,
  ]
    .map(normalizeWorkspaceId)
    .filter(Boolean);
  const values = targetDeviceIds.length && targetWorkspaceIds.length
    ? targetWorkspaceIds
    : [
    record?.workspace_id,
    record?.source_workspace_id,
    record?.todo_workspace_id,
    record?.requested_by_workspace_id,
    record?.origin_workspace_id,
    record?.origin?.workspace_id,
    ]
      .map(normalizeWorkspaceId)
      .filter(Boolean);
  if (!values.length && fallback) {
    values.push(normalizeWorkspaceId(fallback));
  }
  return Array.from(new Set(values));
}

function todoMirrorDeviceIdsForRecord(record) {
  const targetValues = [
    record?.target_device_id,
    record?.target?.device_id,
  ]
    .map(normalizeTodoQueueSwitcherId)
    .filter(Boolean);
  if (targetValues.length) {
    return Array.from(new Set(targetValues));
  }
  const values = [
    record?.device_id,
    record?.machine_id,
    record?.source_device_id,
    record?.todo_device_id,
    record?.requested_by_device_id,
    record?.origin_device_id,
    record?.origin?.device_id,
  ]
    .map(normalizeTodoQueueSwitcherId)
    .filter(Boolean);
  return Array.from(new Set(values));
}

function workspaceNameForRecord(record, fallback = "") {
  return firstText(
    record?.source_workspace_name,
    record?.target_workspace_name,
    record?.workspace_name,
    record?.repo_name,
    record?.git_repo_display_name,
    record?.name,
    fallback,
  );
}

function normalizedGraphStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function graphEntryStatusForRecord(record) {
  if (!record || typeof record !== "object") {
    return "unknown";
  }
  const status = normalizedGraphStatus(readFirstKey(record, [
    "activity_status",
    "display_status",
    "session_state",
    "status",
    "state",
    "phase",
  ]));
  if (["running", "busy", "processing", "in_flight", "sending", "dispatching", "active"].includes(status)) {
    return "busy";
  }
  if (["paused", "blocked", "waiting", "needs_input"].includes(status)) {
    return "waiting";
  }
  if (["failed", "error", "crashed", "rejected"].includes(status)) {
    return "error";
  }
  if (["complete", "completed", "done", "success", "idle", "ready"].includes(status)) {
    return "idle";
  }
  return status || "unknown";
}

function graphEntryStatusCounts(entries = []) {
  return entries.reduce((counts, entry) => {
    const status = graphEntryStatusForRecord(entry);
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
}

function listFromRecordKeys(record, keys = []) {
  const value = readFirstKey(record, keys);
  if (Array.isArray(value)) {
    return value.filter((item) => item && typeof item === "object");
  }
  if (value && typeof value === "object") {
    return Object.values(value).filter((item) => item && typeof item === "object");
  }
  return [];
}

function numberFromRecord(record, keys = []) {
  const value = readFirstKey(record, keys);
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function workspaceStatusForRecord(record) {
  const explicit = normalizedGraphStatus(readFirstKey(record, WORKSPACE_STATUS_KEYS));
  const active = boolFromKeys(record, WORKSPACE_ACTIVE_KEYS);
  if (active === true) {
    return "active";
  }
  if (["syncing", "sync", "synchronizing", "loading", "starting", "activating", "initializing", "refreshing", "pending"].includes(explicit)) {
    return "syncing";
  }
  if (["active", "activated", "connected", "online", "live", "open", "running"].includes(explicit)) {
    return "active";
  }
  if (["closed", "inactive", "stopped", "offline", "disconnected"].includes(explicit)) {
    return "idle";
  }
  return explicit || (active === false ? "idle" : "");
}

function workspaceGraphDetailsForRecord(record) {
  const terminals = listFromRecordKeys(record, WORKSPACE_TERMINAL_KEYS);
  const servers = listFromRecordKeys(record, WORKSPACE_SERVER_KEYS);
  const mcps = listFromRecordKeys(record, WORKSPACE_MCP_KEYS);
  return {
    mcps: mcps.slice(0, 16),
    mcpCount: numberFromRecord(record, ["mcp_count", "mcp_server_count"]) ?? mcps.length,
    mcpStatusCounts: graphEntryStatusCounts(mcps),
    server_count: numberFromRecord(record, ["server_count", "service_count"]) ?? servers.length,
    serverStatusCounts: graphEntryStatusCounts(servers),
    servers: servers.slice(0, 16),
    terminal_count: numberFromRecord(record, ["terminal_count", "terminal_session_count"]) ?? terminals.length,
    terminalStatusCounts: graphEntryStatusCounts(terminals),
    terminals: terminals.slice(0, 16),
    workspace_active: boolFromKeys(record, WORKSPACE_ACTIVE_KEYS) === true,
    workspace_status: workspaceStatusForRecord(record),
  };
}

function normalizeDeviceRecord(record, index = 0, options = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const inherited = options.inherited || null;
  const forcedKind = options.kind || "";
  const deviceId = deviceIdForRecord(record) || normalizeTodoQueueSwitcherId(inherited?.device_id);
  if (!deviceId) {
    return null;
  }
  const kind = forcedKind
    || deviceKindForRecord(record, inherited?.device_kind || TODO_QUEUE_DEVICE_KIND_UNKNOWN);
  const looksWebOnly = recordLooksWebOnly(record);
  const hasNativeAnchor = recordHasNativeAnchor(record);
  const explicitConnected = normalizeLiveBoolean(readFirstKey(record, LIVE_STATE_PRESENT_KEYS));
  const nativeConnected = nativeConnectedForRecord(record, inherited);
  const webConnected = webConnectedForRecord(record, inherited);
  const hasSurfaceConnectionState = nativeConnected !== null || webConnected !== null;
  const connected = hasSurfaceConnectionState
    ? Boolean(nativeConnected === true || webConnected === true)
    : explicitConnected;
  const liveState = liveStateFromSurfaces(
    nativeConnected,
    webConnected,
    explicitConnected,
    liveStateForRecord(record, inherited?.liveState || "unknown"),
  );
  const deviceAliases = uniqueDeviceAliases(
    inherited?.device_aliases,
    deviceAliasesForRecord(record, deviceId),
  );
  const rawDeviceName = deviceNameForRecord(record, index);
  const inheritedDeviceName = inherited?.device_name || "";
  const deviceName = deviceNameIsGeneric(rawDeviceName) && !deviceNameIsGeneric(inheritedDeviceName)
    ? inheritedDeviceName
    : rawDeviceName || inheritedDeviceName || "Device";
  return {
    connected,
    device_aliases: deviceAliases,
    device_id: deviceId,
    device_kind: kind,
    device_name: deviceName,
    form_factor_label: firstText(
      record.form_factor_label,
      record.form_factor,
      record.device_type,
      kind === TODO_QUEUE_DEVICE_KIND_MOBILE ? "Mobile" : "",
    ),
    is_local: Boolean(options.is_local || inherited?.is_local),
    liveState,
    native_connected: nativeConnected,
    platform_icon: firstText(
      record.platform_icon,
      record.device_icon,
      record.icon,
      inherited?.platform_icon,
    ),
    platform_label: firstText(
      record.platform_label,
      record.platform,
      record.os,
      inherited?.platform_label,
    ),
    push_capable: normalizeLiveBoolean(readFirstKey(record, ["push_capable"]))
      ?? inherited?.push_capable
      ?? null,
    push_public_key: firstText(record.push_public_key, inherited?.push_public_key),
    registered: Boolean(
      options.registered || inherited?.registered || record.registered || record.registered_device
    ),
    serverSeen: Boolean(options.serverSeen || inherited?.serverSeen),
    web_connected: webConnected,
    web_only: Boolean(looksWebOnly && !hasNativeAnchor),
  };
}

function mergeDevice(previous, next) {
  if (!previous) {
    return {
      ...next,
      device_aliases: uniqueDeviceAliases(next?.device_aliases, next?.device_id),
      web_only: Boolean(next?.web_only),
    };
  }
  const nextIsWebOverlay = Boolean(next.web_only && previous.web_only !== true);
  const nextIsCanonicalIdentity = Boolean(previous.web_only && !next.web_only);
  const previousHasUsefulName = !deviceNameIsGeneric(previous.device_name);
  const nextHasUsefulName = !deviceNameIsGeneric(next.device_name);
  const preferNextName = Boolean(
    nextHasUsefulName
      && (
        !previousHasUsefulName
        || (next.serverSeen && (!previous.serverSeen || nextHasUsefulName))
      ),
  ) || Boolean(!previous.device_name && next.device_name);
  const connected = mergeNullableBooleans(previous.connected, next.connected);
  const nativeConnected = mergeDeviceSurfaceBoolean(previous, next, "native_connected");
  const webConnected = mergeDeviceSurfaceBoolean(previous, next, "web_connected");
  const liveState = previous.liveState === "live" || next.liveState === "live"
    ? "live"
    : next.liveState !== "unknown"
      ? next.liveState
      : previous.liveState || "unknown";
  return {
    ...previous,
    ...next,
    connected,
    device_aliases: uniqueDeviceAliases(previous.device_aliases, previous.device_id, next.device_aliases, next.device_id),
    device_kind: nextIsWebOverlay
      ? previous.device_kind
      : previous.device_kind === TODO_QUEUE_DEVICE_KIND_DESKTOP || previous.is_local
      ? previous.device_kind
      : next.device_kind || previous.device_kind,
    device_name: nextIsWebOverlay || !preferNextName
      ? previous.device_name
      : next.device_name,
    form_factor_label: nextIsCanonicalIdentity
      ? next.form_factor_label || previous.form_factor_label || ""
      : nextIsWebOverlay
      ? previous.form_factor_label || ""
      : previous.form_factor_label || next.form_factor_label || "",
    is_local: Boolean(previous.is_local || next.is_local),
    liveState,
    native_connected: nativeConnected,
    platform_icon: nextIsCanonicalIdentity
      ? next.platform_icon || previous.platform_icon || ""
      : nextIsWebOverlay
      ? previous.platform_icon || ""
      : previous.platform_icon || next.platform_icon || "",
    platform_label: nextIsCanonicalIdentity
      ? next.platform_label || previous.platform_label || ""
      : nextIsWebOverlay
      ? previous.platform_label || ""
      : previous.platform_label || next.platform_label || "",
    push_capable: next.push_capable ?? previous.push_capable ?? null,
    push_public_key: next.push_public_key || previous.push_public_key || "",
    registered: Boolean(previous.registered || next.registered),
    serverSeen: Boolean(previous.serverSeen || next.serverSeen),
    web_connected: webConnected,
    web_only: Boolean(previous.web_only && next.web_only),
  };
}

function shouldPreferDeviceKey(candidateId, currentId, previous = null, next = null) {
  const safeCandidateId = normalizeTodoQueueSwitcherId(candidateId);
  const safeCurrentId = normalizeTodoQueueSwitcherId(currentId);
  if (!safeCandidateId || !safeCurrentId || safeCandidateId === safeCurrentId) {
    return false;
  }
  if (idLooksWebOnly(safeCurrentId) && !idLooksWebOnly(safeCandidateId)) {
    return true;
  }
  return Boolean(previous?.web_only && !next?.web_only && !idLooksWebOnly(safeCandidateId));
}

function addWorkspace(workspacesByDevice, entry) {
  const deviceId = normalizeTodoQueueSwitcherId(entry?.device_id);
  const workspaceId = normalizeWorkspaceId(entry?.workspace_id);
  const workspacePlatform = firstText(entry?.platform, entry?.os, entry?.platform_label);
  const workspaceMatchId = normalizeTodoQueueWorkspaceMatchId(workspaceId, workspacePlatform);
  if (!deviceId || !workspaceId || !workspaceMatchId) {
    return;
  }
  const key = todoQueueDeviceWorkspaceKey(deviceId, workspaceMatchId);
  const previous = workspacesByDevice.get(key) || {};
  workspacesByDevice.set(key, {
    ...previous,
    ...entry,
    device_id: deviceId,
    workspace_id: workspaceId,
    workspace_name: entry.workspace_name || previous.workspace_name || workspaceId,
  });
}

function findDeviceKeyByAliases(devicesById, aliases = []) {
  const aliasList = uniqueDeviceAliases(aliases);
  if (!aliasList.length) {
    return "";
  }
  for (const [deviceId, device] of devicesById.entries()) {
    if (aliasList.includes(deviceId) || aliasesIntersect(device.device_aliases, aliasList)) {
      return deviceId;
    }
  }
  return "";
}

function upsertDevice(devicesById, device) {
  if (!device?.device_id) {
    return "";
  }
  const deviceAliases = uniqueDeviceAliases(device.device_aliases, device.device_id);
  const existingKey = findDeviceKeyByAliases(devicesById, deviceAliases);
  const deviceId = existingKey || device.device_id;
  const previous = devicesById.get(deviceId) || null;
  const preferredDeviceId = shouldPreferDeviceKey(device.device_id, deviceId, previous, device)
    ? device.device_id
    : deviceId;
  const merged = mergeDevice(previous, {
    ...device,
    device_aliases: deviceAliases,
    device_id: preferredDeviceId,
  });
  if (preferredDeviceId !== deviceId) {
    devicesById.delete(deviceId);
  }
  devicesById.set(preferredDeviceId, {
    ...merged,
    device_aliases: uniqueDeviceAliases(merged.device_aliases, deviceAliases, device.device_id, deviceId, preferredDeviceId),
    device_id: preferredDeviceId,
  });
  return preferredDeviceId;
}

function canonicalDeviceIdFor(devicesById, entry) {
  const aliases = uniqueDeviceAliases(
    entry?.device_aliases,
    deviceAliasesForRecord(entry, entry?.device_id),
    entry?.device_id,
  );
  return findDeviceKeyByAliases(devicesById, aliases) || normalizeTodoQueueSwitcherId(entry?.device_id);
}

function moveWorkspaceEntriesToDevice(workspacesByDevice, fromDeviceId, toDeviceId, targetDevice = {}) {
  const safeFromDeviceId = normalizeTodoQueueSwitcherId(fromDeviceId);
  const safeToDeviceId = normalizeTodoQueueSwitcherId(toDeviceId);
  if (!safeFromDeviceId || !safeToDeviceId || safeFromDeviceId === safeToDeviceId) {
    return;
  }
  const entriesToMove = [];
  for (const [key, entry] of workspacesByDevice.entries()) {
    if (normalizeTodoQueueSwitcherId(entry?.device_id) === safeFromDeviceId) {
      entriesToMove.push([key, entry]);
    }
  }
  entriesToMove.forEach(([key, entry]) => {
    workspacesByDevice.delete(key);
    addWorkspace(workspacesByDevice, {
      ...entry,
      device_id: safeToDeviceId,
      device_kind: targetDevice.device_kind || entry.device_kind,
      device_name: targetDevice.device_name || entry.device_name,
    });
  });
}

function removeWorkspaceEntriesForDevice(workspacesByDevice, deviceId) {
  const safeDeviceId = normalizeTodoQueueSwitcherId(deviceId);
  if (!safeDeviceId) {
    return;
  }
  Array.from(workspacesByDevice.entries()).forEach(([key, entry]) => {
    if (normalizeTodoQueueSwitcherId(entry?.device_id) === safeDeviceId) {
      workspacesByDevice.delete(key);
    }
  });
}

function pruneToRegisteredDeviceRows(devicesById, workspacesByDevice) {
  const registeredEntries = Array.from(devicesById.entries())
    .filter(([, device]) => device?.registered);
  if (!registeredEntries.length) {
    return;
  }
  for (const [deviceId, device] of Array.from(devicesById.entries())) {
    if (device?.registered || device?.is_local) {
      continue;
    }
    const targetEntry = registeredEntries.find(([registeredId, registeredDevice]) => (
      registeredId !== deviceId
        && aliasesIntersect(registeredDevice.device_aliases, device.device_aliases)
    ));
    if (targetEntry) {
      const [targetDeviceId, targetDevice] = targetEntry;
      const currentTargetDevice = devicesById.get(targetDeviceId) || targetDevice;
      devicesById.set(targetDeviceId, mergeDevice(currentTargetDevice, {
        ...device,
        device_id: targetDeviceId,
        device_name: currentTargetDevice.device_name,
        registered: true,
        web_only: false,
      }));
      moveWorkspaceEntriesToDevice(workspacesByDevice, deviceId, targetDeviceId, currentTargetDevice);
    } else {
      removeWorkspaceEntriesForDevice(workspacesByDevice, deviceId);
    }
    devicesById.delete(deviceId);
  }
}

function foldWebOnlyDeviceRows(devicesById, workspacesByDevice) {
  const entries = Array.from(devicesById.entries());
  const canonicalEntries = entries.filter(([, device]) => (
    device
      && device.web_only !== true
      && device.device_kind !== TODO_QUEUE_DEVICE_KIND_MOBILE
      && (device.serverSeen || device.is_local || device.native_connected === true || !idLooksWebOnly(device.device_id))
  ));
  if (!canonicalEntries.length) {
    return;
  }
  const hasRegisteredInventory = canonicalEntries.some(([, device]) => device?.registered);
  const canonicalWithWeb = canonicalEntries.filter(([, device]) => device.web_connected === true);
  entries.forEach(([deviceId, device]) => {
    if (
      !device?.web_only
      || device.is_local
      || device.device_kind === TODO_QUEUE_DEVICE_KIND_MOBILE
    ) {
      return;
    }
    // Alias-proven folds only for REGISTERED web rows: the server's fold
    // links (device_aliases / proven web ids) are the presence-v2 authority.
    // The single-candidate guesses below exist for UNREGISTERED ephemeral
    // echoes only — a registered standalone web/mobile device is its own
    // card and must never be swallowed by a heuristic.
    const targetEntry = canonicalEntries.find(([, candidate]) => (
      aliasesIntersect(candidate.device_aliases, device.device_aliases)
    )) || (device.registered
      ? null
      : (canonicalWithWeb.length === 1
        ? canonicalWithWeb[0]
        : (!hasRegisteredInventory && canonicalEntries.length === 1)
          ? canonicalEntries[0]
          : null));
    if (!targetEntry) {
      if (deviceNameIsGeneric(device.device_name)) {
        removeWorkspaceEntriesForDevice(workspacesByDevice, deviceId);
        devicesById.delete(deviceId);
      }
      return;
    }
    const [targetDeviceId, targetDevice] = targetEntry;
    const currentTargetDevice = devicesById.get(targetDeviceId) || targetDevice;
    const merged = mergeDevice(currentTargetDevice, {
      ...device,
      connected: device.connected,
      device_id: targetDeviceId,
      device_kind: currentTargetDevice.device_kind,
      device_name: currentTargetDevice.device_name,
      form_factor_label: currentTargetDevice.form_factor_label,
      is_local: currentTargetDevice.is_local,
      native_connected: null,
      platform_icon: currentTargetDevice.platform_icon,
      platform_label: currentTargetDevice.platform_label,
      serverSeen: Boolean(currentTargetDevice.serverSeen || device.serverSeen),
      // Folds LIGHT the target's WEB badge, never darken it: an offline
      // folded row must not drag web_connected=false over a v2-stamped lit
      // target (presence truth is the stamped item, not the echo).
      web_connected: device.web_connected === true
        ? true
        : currentTargetDevice.web_connected,
      web_only: false,
    });
    devicesById.set(targetDeviceId, {
      ...merged,
      device_aliases: uniqueDeviceAliases(merged.device_aliases, currentTargetDevice.device_aliases, device.device_aliases, targetDeviceId, deviceId),
      device_id: targetDeviceId,
      device_name: currentTargetDevice.device_name || merged.device_name,
      is_local: Boolean(currentTargetDevice.is_local || merged.is_local),
      web_only: false,
    });
    moveWorkspaceEntriesToDevice(workspacesByDevice, deviceId, targetDeviceId, currentTargetDevice);
    devicesById.delete(deviceId);
  });
}

function collectAccountLiveDeviceEntries(deviceLiveState) {
  const { root, snapshotRoot } = liveStateSnapshotRoot(deviceLiveState);
  const result = { devices: [], workspaces: [] };
  const collectContainer = (value, options = {}) => {
    if (value && typeof value === "object") {
      collectLiveStateEntries(value, result, null, 0, options);
    }
  };
  const clientConnection = firstDeviceObject(
    snapshotRoot.client_connection,
    snapshotRoot.connection_summary,
    root.client_connection,
    root.connection_summary,
  );

  [
    snapshotRoot.registered_devices,
    snapshotRoot.device_registry,
    root.registered_devices,
    root.device_registry,
  ].forEach((value) => collectContainer(value, { registered: true }));

  [
    snapshotRoot.devices,
    snapshotRoot.device_map,
    snapshotRoot.devices_by_id,
    snapshotRoot.items,
    snapshotRoot.server_roster,
    root.devices,
    root.device_map,
    root.devices_by_id,
    root.items,
    root.server_roster,
    clientConnection.active_desktop_devices,
    clientConnection.active_native_devices,
    clientConnection.active_web_devices,
  ].forEach((value) => collectContainer(value));

  return result;
}

export function buildAccountLiveDeviceRows({
  connectedDevices = [],
  deviceLiveState = null,
  knownDevices = [],
  localProfile = null,
  maxRows = 12,
} = {}) {
  const devicesById = new Map();
  const workspacesByDevice = new Map();
  const numericMaxRows = Number(maxRows);
  const safeMaxRows = maxRows === "all" || numericMaxRows === Infinity
    ? Infinity
    : Number.isFinite(numericMaxRows) && numericMaxRows > 0
      ? Math.floor(numericMaxRows)
      : 12;
  const upsertNormalizedRecord = (record, index, options = {}) => {
    const normalized = normalizeDeviceRecord(record, index, {
      serverSeen: true,
      ...options,
    });
    if (normalized) {
      upsertDevice(devicesById, normalized);
    }
  };

  (Array.isArray(knownDevices) ? knownDevices : []).forEach((device, index) => {
    upsertNormalizedRecord(device, index);
  });

  const liveEntries = collectAccountLiveDeviceEntries(deviceLiveState);
  applyConnectionOverlayToDevices(liveEntries.devices, deviceLiveState).forEach((device, index) => {
    upsertDevice(devicesById, device);
    liveEntries.workspaces
      .filter((workspace) => aliasesIntersect(device.device_aliases, workspace.device_aliases || workspace.device_id))
      .forEach((workspace) => addWorkspace(workspacesByDevice, {
        ...workspace,
        device_id: device.device_id,
      }));
    if (!device.serverSeen) {
      upsertNormalizedRecord(device, index);
    }
  });

  (Array.isArray(connectedDevices) ? connectedDevices : []).forEach((device, index) => {
    upsertNormalizedRecord(device, index);
  });

  const localDevice = normalizeDeviceRecord(localProfile || {}, 0, {
    is_local: true,
    kind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
  });
  if (localDevice) {
    const localDeviceId = findDeviceKeyByAliases(devicesById, localDevice.device_aliases);
    if (localDeviceId) {
      const serverDevice = devicesById.get(localDeviceId) || {};
      const mergedLocalDevice = mergeDevice(serverDevice, {
        ...localDevice,
        device_id: localDeviceId,
      });
      devicesById.set(localDeviceId, {
        ...mergedLocalDevice,
        device_aliases: uniqueDeviceAliases(
          mergedLocalDevice.device_aliases,
          serverDevice.device_aliases,
          localDevice.device_aliases,
          localDeviceId,
        ),
        device_kind: mergedLocalDevice.device_kind === TODO_QUEUE_DEVICE_KIND_UNKNOWN
          ? TODO_QUEUE_DEVICE_KIND_DESKTOP
          : mergedLocalDevice.device_kind,
        is_local: true,
        serverSeen: Boolean(serverDevice.serverSeen || mergedLocalDevice.serverSeen),
      });
    } else {
      upsertDevice(devicesById, localDevice);
    }
  }

  foldWebOnlyDeviceRows(devicesById, workspacesByDevice);
  pruneToRegisteredDeviceRows(devicesById, workspacesByDevice);

  return Array.from(devicesById.values())
    .filter((device) => device.is_local || device.serverSeen || device.registered || device.liveState !== "offline")
    .map((device, index) => ({
      device_id: device.device_id || `device-${index}`,
      device_aliases: uniqueDeviceAliases(device.device_aliases, device.device_id),
      device_kind: device.device_kind || TODO_QUEUE_DEVICE_KIND_UNKNOWN,
      device_name: device.device_name || `Device ${index + 1}`,
      form_factor_label: device.form_factor_label || "",
      is_local: Boolean(device.is_local),
      liveState: device.liveState === "unknown" && device.connected === true ? "live" : device.liveState || "unknown",
      native_connected: device.native_connected === true,
      platform_icon: device.platform_icon || "",
      platform_label: device.platform_label || "",
      push_capable: device.push_capable ?? null,
      push_public_key: device.push_public_key || "",
      registered: Boolean(device.registered),
      serverSeen: Boolean(device.serverSeen),
      web_connected: device.web_connected === true,
      workspaces: Array.from(workspacesByDevice.values())
        .filter((workspace) => normalizeTodoQueueSwitcherId(workspace.device_id) === device.device_id)
        .map((workspace) => ({
          id: workspace.workspace_id,
          isCurrentWorkspace: Boolean(workspace.isCurrentWorkspace),
          mcps: Array.isArray(workspace.mcps) ? workspace.mcps : [],
          mcpCount: Number(workspace.mcpCount) || 0,
          mcpStatusCounts: workspace.mcpStatusCounts || {},
          name: workspace.workspace_name || workspace.workspace_id,
          server_count: Number(workspace.server_count) || 0,
          serverStatusCounts: workspace.serverStatusCounts || {},
          servers: Array.isArray(workspace.servers) ? workspace.servers : [],
          status: workspace.workspace_status || "",
          terminal_count: Number(workspace.terminal_count) || 0,
          terminalStatusCounts: workspace.terminalStatusCounts || {},
          terminals: Array.isArray(workspace.terminals) ? workspace.terminals : [],
          workspace_active: workspace.workspace_active === true,
        })),
    }))
    .sort((left, right) => {
      if (left.is_local !== right.is_local) {
        return left.is_local ? -1 : 1;
      }
      if (left.liveState === "live" && right.liveState !== "live") return -1;
      if (right.liveState === "live" && left.liveState !== "live") return 1;
      return String(left.device_name).localeCompare(String(right.device_name));
    })
    .slice(0, safeMaxRows);
}

function collectLiveStateEntries(value, result, inheritedDevice = null, depth = 0, options = {}) {
  if (!value || depth > 5) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectLiveStateEntries(item, result, inheritedDevice, depth + 1, options));
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  const ownDevice = deviceIdForRecord(value)
    ? normalizeDeviceRecord(value, result.devices.length, {
      inherited: inheritedDevice,
      registered: options.registered,
      serverSeen: true,
    })
    : null;
  const currentDevice = ownDevice || inheritedDevice;
  if (ownDevice) {
    result.devices.push(ownDevice);
  }

  const workspaceId = workspaceIdForRecord(value);
  if (workspaceId && currentDevice?.device_id) {
    result.workspaces.push({
      device_id: currentDevice.device_id,
      device_aliases: currentDevice.device_aliases,
      device_kind: currentDevice.device_kind,
      device_name: currentDevice.device_name,
      platform_label: currentDevice.platform_label,
      workspace_id: workspaceId,
      workspace_name: workspaceNameForRecord(value, workspaceId),
      ...workspaceGraphDetailsForRecord(value),
    });
  }

  if (!ownDevice && !workspaceId) {
    Object.values(value)
      .filter((item) => item && typeof item === "object")
      .forEach((item) => collectLiveStateEntries(item, result, currentDevice, depth + 1, options));
  }

  LIVE_STATE_CONTAINER_KEYS.forEach((key) => {
    if (value[key] !== undefined && value[key] !== value) {
      const registered = options.registered || key === "registered_devices" || key === "device_registry";
      collectLiveStateEntries(value[key], result, currentDevice, depth + 1, { registered });
    }
  });
}

function collectWorkspaceTodoOptionEntries(value, entries, inheritedWorkspaceId = "", depth = 0) {
  if (!value || depth > 5) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectWorkspaceTodoOptionEntries(item, entries, inheritedWorkspaceId, depth + 1));
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  const workspaceId = workspaceIdForRecord(value, inheritedWorkspaceId);
  const deviceId = deviceIdForRecord(value);
  if (workspaceId && deviceId) {
    entries.push({
      device_id: deviceId,
      device_aliases: deviceAliasesForRecord(value, deviceId),
      device_kind: deviceKindForRecord(value, TODO_QUEUE_DEVICE_KIND_UNKNOWN),
      device_name: deviceNameForRecord(value, entries.length),
      workspace_id: workspaceId,
      workspace_name: workspaceNameForRecord(value, workspaceId),
    });
  }

  TODO_WORKSPACE_CONTAINER_KEYS.forEach((key) => {
    const nextValue = value[key];
    if (!nextValue || nextValue === value) {
      return;
    }
    if (
      key.endsWith("ByWorkspace") || key.endsWith("_by_workspace") || key === "peer_activity_by_workspace"
    ) {
      if (Array.isArray(nextValue)) {
        nextValue.forEach((entry) => {
          collectWorkspaceTodoOptionEntries(entry, entries, workspaceIdForRecord(entry, inheritedWorkspaceId), depth + 1);
        });
      } else if (typeof nextValue === "object") {
        Object.entries(nextValue).forEach(([nextWorkspaceId, entry]) => {
          collectWorkspaceTodoOptionEntries(entry, entries, normalizeWorkspaceId(nextWorkspaceId), depth + 1);
        });
      }
      return;
    }
    collectWorkspaceTodoOptionEntries(nextValue, entries, workspaceId, depth + 1);
  });
}

function selectionIdFor({
  device_id: deviceId,
  workspace_id: workspaceId = "",
  device_kind: deviceKind = TODO_QUEUE_DEVICE_KIND_UNKNOWN,
  platform = "",
}) {
  const safeDeviceId = normalizeTodoQueueSwitcherId(deviceId) || "device";
  const safeWorkspaceId = normalizeTodoQueueWorkspaceMatchId(workspaceId, platform);
  return safeWorkspaceId
    ? todoQueueDeviceWorkspaceKey(safeDeviceId, safeWorkspaceId)
    : todoQueueDeviceWorkspaceKey(safeDeviceId, `device-kind:${deviceKind}`);
}

function sortWorkspaceEntries(a, b) {
  return String(a.workspace_name || a.workspace_id).localeCompare(String(b.workspace_name || b.workspace_id));
}

export function buildTodoQueueDeviceWorkspaceOptions({
  connectedDevices = [],
  currentWorkspaceId = "",
  currentWorkspaceName = "",
  deviceLiveState = null,
  knownDevices = [],
  localProfile = null,
  workspace_todos: workspaceTodos = null,
} = {}) {
  const devicesById = new Map();
  const workspacesByDevice = new Map();
  const safeCurrentWorkspaceId = normalizeWorkspaceId(currentWorkspaceId);
  const safeCurrentWorkspaceName = firstText(currentWorkspaceName, safeCurrentWorkspaceId, "Current workspace");
  const serverSourceAvailable = Boolean(
    (Array.isArray(knownDevices) && knownDevices.length)
      || (Array.isArray(connectedDevices) && connectedDevices.length)
      || (deviceLiveState && typeof deviceLiveState === "object")
  );

  const normalizedLocalProfile = normalizeDeviceRecord(localProfile || {}, 0, {
    is_local: true,
    kind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
  });
  const localDevice = normalizedLocalProfile || {
    connected: null,
    device_aliases: ["local-device"],
    device_id: "local-device",
    device_kind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
    device_name: "This device",
    form_factor_label: "Desktop",
    is_local: true,
    liveState: "unknown",
    native_connected: null,
    platform_label: "",
    serverSeen: false,
    web_connected: null,
  };
  const currentWorkspaceMatchId = normalizeTodoQueueWorkspaceMatchId(
    safeCurrentWorkspaceId,
    localDevice.platform_label,
  );
  const bindCurrentWorkspaceToLocalDevice = (deviceId, device = {}) => {
    const safeDeviceId = normalizeTodoQueueSwitcherId(deviceId);
    if (!safeDeviceId || !safeCurrentWorkspaceId) {
      return;
    }
    const workspaceKey = todoQueueDeviceWorkspaceKey(safeDeviceId, currentWorkspaceMatchId);
    const currentWorkspace = workspacesByDevice.get(workspaceKey);
    if (currentWorkspace) {
      workspacesByDevice.set(workspaceKey, {
        ...currentWorkspace,
        isCurrentWorkspace: true,
        is_local: true,
      });
      return;
    }
    addWorkspace(workspacesByDevice, {
      device_id: safeDeviceId,
      device_kind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
      device_name: device.device_name || localDevice.device_name,
      isCurrentWorkspace: true,
      is_local: true,
      platform_label: device.platform_label || localDevice.platform_label,
      workspace_id: safeCurrentWorkspaceId,
      workspace_name: safeCurrentWorkspaceName,
    });
  };

  const addCanonicalWorkspace = (entry) => {
    const canonicalDeviceId = canonicalDeviceIdFor(devicesById, entry);
    if (!canonicalDeviceId) {
      return;
    }
    const canonicalDevice = devicesById.get(canonicalDeviceId) || {};
    addWorkspace(workspacesByDevice, {
      ...entry,
      device_id: canonicalDeviceId,
      platform_label: firstText(entry?.platform_label, entry?.platform, entry?.os, canonicalDevice.platform_label),
    });
  };

  [...knownDevices, ...connectedDevices].forEach((device, index) => {
    const normalized = normalizeDeviceRecord(device, index, { serverSeen: true });
    if (!normalized) {
      return;
    }
    upsertDevice(devicesById, normalized);
  });

  const liveEntries = { devices: [], workspaces: [] };
  collectLiveStateEntries(deviceLiveState, liveEntries);
  applyConnectionOverlayToDevices(liveEntries.devices, deviceLiveState).forEach((device) => {
    upsertDevice(devicesById, device);
  });
  liveEntries.workspaces.forEach((workspace) => addCanonicalWorkspace(workspace));

  const todoWorkspaceEntries = [];
  collectWorkspaceTodoOptionEntries(workspaceTodos, todoWorkspaceEntries);
  todoWorkspaceEntries.forEach((workspace) => {
    const normalizedDevice = normalizeDeviceRecord(workspace, devicesById.size, { serverSeen: true });
    if (normalizedDevice) {
      upsertDevice(devicesById, normalizedDevice);
    }
    addCanonicalWorkspace(workspace);
  });

  const serverBackedDeviceCount = devicesById.size;
  const localCanonicalDeviceId = findDeviceKeyByAliases(devicesById, localDevice.device_aliases);
  if (localCanonicalDeviceId) {
    const serverDevice = devicesById.get(localCanonicalDeviceId) || {};
    const mergedLocalDevice = mergeDevice(serverDevice, {
      ...localDevice,
      device_id: localCanonicalDeviceId,
    });
    devicesById.set(localCanonicalDeviceId, {
      ...mergedLocalDevice,
      device_aliases: uniqueDeviceAliases(mergedLocalDevice.device_aliases, serverDevice.device_aliases, localDevice.device_aliases, localCanonicalDeviceId),
      device_kind: mergedLocalDevice.device_kind === TODO_QUEUE_DEVICE_KIND_UNKNOWN
        ? TODO_QUEUE_DEVICE_KIND_DESKTOP
        : mergedLocalDevice.device_kind,
      is_local: true,
      serverSeen: Boolean(serverDevice.serverSeen || mergedLocalDevice.serverSeen),
    });
    bindCurrentWorkspaceToLocalDevice(localCanonicalDeviceId, mergedLocalDevice);
  } else if (normalizedLocalProfile || (!serverSourceAvailable && serverBackedDeviceCount === 0)) {
    const fallbackDeviceId = upsertDevice(devicesById, localDevice);
    bindCurrentWorkspaceToLocalDevice(fallbackDeviceId, devicesById.get(fallbackDeviceId) || localDevice);
  }

  foldWebOnlyDeviceRows(devicesById, workspacesByDevice);
  pruneToRegisteredDeviceRows(devicesById, workspacesByDevice);

  const workspaceEntries = Array.from(workspacesByDevice.values());
  const workspaceEntriesByDevice = new Map();
  workspaceEntries.forEach((entry) => {
    const safeDeviceId = normalizeTodoQueueSwitcherId(entry.device_id);
    if (!safeDeviceId) {
      return;
    }
    const list = workspaceEntriesByDevice.get(safeDeviceId) || [];
    list.push(entry);
    workspaceEntriesByDevice.set(safeDeviceId, list);
  });

  const options = [];
  const addOption = (device, workspace = null, extra = {}) => {
    const workspaceId = normalizeWorkspaceId(workspace?.workspace_id);
    const option = {
      connected: device.connected,
      device_aliases: uniqueDeviceAliases(device.device_aliases, device.device_id),
      device_id: device.device_id,
      device_kind: device.device_kind || TODO_QUEUE_DEVICE_KIND_UNKNOWN,
      device_name: device.device_name || "Device",
      form_factor_label: device.form_factor_label || "",
      id: selectionIdFor({
        device_id: device.device_id,
        device_kind: device.device_kind,
        platform: device.platform_label,
        workspace_id: workspaceId,
      }),
      isCurrentWorkspace: Boolean(extra.isCurrentWorkspace),
      is_local: Boolean(device.is_local),
      liveState: device.liveState === "unknown" && device.connected === true ? "live" : device.liveState || "unknown",
      native_connected: device.native_connected === true,
      platform_icon: device.platform_icon || "",
      platform_label: device.platform_label || "",
      serverSeen: Boolean(device.serverSeen),
      surfaces: [
        { active: device.native_connected === true, id: "native", label: "native" },
        { active: device.web_connected === true, id: "web", label: "web" },
      ],
      web_connected: device.web_connected === true,
      workspace_id: workspaceId,
      workspace_name: workspace?.workspace_name || "",
    };
    if (!options.some((candidate) => candidate.id === option.id)) {
      options.push(option);
    }
  };

  const sortedDevices = Array.from(devicesById.values())
    .sort((a, b) => {
      if (a.is_local !== b.is_local) {
        return a.is_local ? -1 : 1;
      }
      if (a.liveState === "live" && b.liveState !== "live") return -1;
      if (b.liveState === "live" && a.liveState !== "live") return 1;
      return String(a.device_name).localeCompare(String(b.device_name));
    });

  sortedDevices.forEach((device) => {
    let workspaces = (workspaceEntriesByDevice.get(device.device_id) || [])
      .sort((a, b) => {
        if (a.isCurrentWorkspace !== b.isCurrentWorkspace) {
          return a.isCurrentWorkspace ? -1 : 1;
        }
        return sortWorkspaceEntries(a, b);
      });
    if (device.is_local && device.device_kind !== TODO_QUEUE_DEVICE_KIND_MOBILE) {
      const preferredWorkspace = workspaces.find((workspace) => (
        workspace.isCurrentWorkspace
        || normalizeTodoQueueWorkspaceMatchId(
          workspace.workspace_id,
          device.platform_label,
        ) === currentWorkspaceMatchId
      )) || workspaces[0] || null;
      workspaces = preferredWorkspace ? [preferredWorkspace] : [];
    }
    if (device.device_kind === TODO_QUEUE_DEVICE_KIND_MOBILE || !workspaces.length) {
      addOption(device);
      return;
    }
    workspaces.forEach((workspace) => addOption(device, workspace, {
      isCurrentWorkspace: Boolean(workspace.isCurrentWorkspace),
    }));
  });

  return options;
}

function collectionForWorkspace(
  workspaceTodos,
  workspaceId,
  directKeys = [],
  byWorkspaceKeys = [],
  platform = "",
) {
  if (!workspaceTodos || typeof workspaceTodos !== "object") {
    return null;
  }
  const safeWorkspaceId = normalizeWorkspaceId(workspaceId);
  const workspaceMatchId = normalizeTodoQueueWorkspaceMatchId(safeWorkspaceId, platform);
  const direct = directKeys
    .map((key) => workspaceTodos[key])
    .find((value) => value);
  const byWorkspace = byWorkspaceKeys
    .map((key) => workspaceTodos[key])
    .find((value) => value);

  if (Array.isArray(byWorkspace)) {
    return byWorkspace.find((entry) => (
      todoMirrorWorkspaceIdsForRecord(entry).some((candidate) => (
        normalizeTodoQueueWorkspaceMatchId(candidate, platform) === workspaceMatchId
      ))
    )) || direct;
  }

  if (byWorkspace && typeof byWorkspace === "object") {
    const matchingKey = Object.keys(byWorkspace).find((key) => (
      normalizeTodoQueueWorkspaceMatchId(key, platform) === workspaceMatchId
    ));
    return byWorkspace[safeWorkspaceId]
      || (matchingKey ? byWorkspace[matchingKey] : null)
      || direct;
  }

  return direct;
}

export function workspaceTodoItemsForDeviceWorkspace(workspaceTodos, selection = {}) {
  const safeSelection = selection && typeof selection === "object" ? selection : {};
  const platform = firstText(
    safeSelection.platform,
    safeSelection.os,
    safeSelection.platform_label,
  );
  const workspaceId = normalizeWorkspaceId(safeSelection.workspace_id);
  const workspaceMatchId = normalizeTodoQueueWorkspaceMatchId(workspaceId, platform);
  const deviceId = normalizeTodoQueueSwitcherId(safeSelection.device_id);
  if (!workspaceId || !deviceId) {
    return [];
  }
  const selectionDeviceAliases = new Set(uniqueDeviceAliases(safeSelection.device_aliases, deviceId));
  const todoCollection = collectionForWorkspace(
    workspaceTodos,
    workspaceId,
    ["items", "todos", "dispatches", "todo_dispatches"],
    [
      "items_by_workspace",
      "todos_by_workspace",
      "dispatches_by_workspace",
      "todo_dispatches_by_workspace",
    ],
    platform,
  );
  const items = Array.isArray(todoCollection?.items)
    ? todoCollection.items
    : Array.isArray(todoCollection)
      ? todoCollection
      : [];
  return items.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const itemWorkspaceIds = todoMirrorWorkspaceIdsForRecord(item, workspaceId);
    if (!itemWorkspaceIds.some((candidate) => (
      normalizeTodoQueueWorkspaceMatchId(candidate, platform) === workspaceMatchId
    ))) {
      return false;
    }
    const itemDeviceIds = todoMirrorDeviceIdsForRecord(item);
    if (!itemDeviceIds.some((candidate) => selectionDeviceAliases.has(candidate))) {
      return false;
    }
    const status = String(item.todo_status || item.status || item.state || "")
      .trim()
      .toLowerCase();
    return !["deleted", "removed", "tombstoned", "archived"].includes(status);
  });
}

function todoQueueMirroredDisplayItem(item, selection = {}) {
  const target = item?.target && typeof item.target === "object" ? item.target : {};
  const id = firstText(
    item?.id,
    item?.todo_id,
    item?.dispatch_id,
    item?.command_id,
  );
  const text = firstText(
    item?.text,
    item?.todo_text,
    item?.title,
    item?.description,
  );
  return {
    ...item,
    ...(id ? { id } : {}),
    ...(text ? { text } : {}),
    device_id: firstText(
      item?.target_device_id,
      target?.device_id,
      selection?.device_id,
    ),
    workspace_id: firstText(
      item?.target_workspace_id,
      target?.workspace_id,
      selection?.workspace_id,
    ),
    readOnly: true,
    mirrored: true,
  };
}

// This model is the production source for the arrays rendered by TodoQueuePanel.
// Keeping the recipient filter here makes the regression test exercise the same
// branch as the visible "No mirrored todos" state, not the devices graph helper.
export function buildTodoQueueDisplayedSelectionArrays({
  editable = false,
  items = [],
  peerItems = [],
  pendingItems = {},
  selection = null,
  workspace_todos: workspaceTodos = null,
} = {}) {
  if (editable) {
    return {
      items: Array.isArray(items) ? items : [],
      peerItems: Array.isArray(peerItems) ? peerItems : [],
      pendingItems: pendingItems && typeof pendingItems === "object" ? pendingItems : {},
    };
  }
  const mirroredItems = workspaceTodoItemsForDeviceWorkspace(workspaceTodos, selection)
    .map((item) => todoQueueMirroredDisplayItem(item, selection));
  return {
    items: mirroredItems,
    peerItems: [],
    pendingItems: {},
  };
}

function workspaceTodoItemsForGraph(workspaceTodos, device, workspace) {
  const platform = firstText(device?.platform_label, device?.platform, device?.os);
  const workspaceId = normalizeWorkspaceId(workspace?.id || workspace?.workspace_id);
  const workspaceMatchId = normalizeTodoQueueWorkspaceMatchId(workspaceId, platform);
  if (!workspaceId) {
    return [];
  }
  const deviceId = normalizeTodoQueueSwitcherId(device?.device_id);
  const deviceAliases = new Set(uniqueDeviceAliases(device?.device_aliases, deviceId));
  const deviceScopedItems = workspaceTodoItemsForDeviceWorkspace(workspaceTodos, {
    device_aliases: Array.from(deviceAliases),
    device_id: deviceId,
    platform,
    workspace_id: workspaceId,
  });
  if (deviceScopedItems.length) {
    return deviceScopedItems;
  }

  const todoCollection = collectionForWorkspace(
    workspaceTodos,
    workspaceId,
    ["items", "todos"],
    ["items_by_workspace", "todos_by_workspace"],
    platform,
  );
  const items = Array.isArray(todoCollection?.items)
    ? todoCollection.items
    : Array.isArray(todoCollection)
      ? todoCollection
      : [];
  return items.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const itemWorkspaceIds = todoMirrorWorkspaceIdsForRecord(item, workspaceId);
    if (!itemWorkspaceIds.some((candidate) => (
      normalizeTodoQueueWorkspaceMatchId(candidate, platform) === workspaceMatchId
    ))) {
      return false;
    }
    const itemDeviceIds = todoMirrorDeviceIdsForRecord(item);
    if (itemDeviceIds.length && !itemDeviceIds.some((candidate) => deviceAliases.has(candidate))) {
      return false;
    }
    const status = normalizedGraphStatus(item.todo_status || item.status || item.state);
    return !["deleted", "removed", "tombstoned", "archived"].includes(status);
  });
}

function statusPriorityForWorkspace(status) {
  if (status === "active") return 0;
  if (status === "syncing") return 1;
  if (status === "idle") return 2;
  if (status === "offline") return 3;
  return 4;
}

function normalizeDeviceGraphWorkspace(workspace, device, workspaceTodos) {
  const status = normalizedGraphStatus(workspace?.status)
    || (workspace?.workspace_active ? "active" : "idle");
  const todoItems = workspaceTodoItemsForGraph(workspaceTodos, device, workspace);
  const terminalCount = Number(workspace?.terminal_count) || 0;
  const serverCount = Number(workspace?.server_count) || 0;
  const mcpCount = Number(workspace?.mcpCount) || 0;
  const toolCount = serverCount + mcpCount;
  const id = normalizeWorkspaceId(workspace?.id || workspace?.workspace_id);
  return {
    id,
    isCurrentWorkspace: Boolean(workspace?.isCurrentWorkspace),
    name: firstText(workspace?.name, workspace?.workspace_name, id, "Workspace"),
    mcpCount,
    mcpStatusCounts: workspace?.mcpStatusCounts || {},
    server_count: serverCount,
    serverStatusCounts: workspace?.serverStatusCounts || {},
    status,
    terminal_count: terminalCount,
    terminalStatusCounts: workspace?.terminalStatusCounts || {},
    todo_count: todoItems.length,
    tool_count: toolCount,
    workspace_active: Boolean(workspace?.workspace_active || status === "active"),
  };
}

function accountNameFromDeviceLiveState(deviceLiveState) {
  const { root, snapshotRoot } = liveStateSnapshotRoot(deviceLiveState);
  return firstText(
    snapshotRoot.account_name,
    snapshotRoot.organization_name,
    snapshotRoot.team_name,
    root.account_name,
    root.organization_name,
    root.team_name,
    "Account",
  );
}

export function buildDevicesGraphModel({
  connectedDevices = [],
  deviceLiveState = null,
  knownDevices = [],
  localProfile = null,
  workspace_todos: workspaceTodos = null,
} = {}) {
  const deviceRows = buildAccountLiveDeviceRows({
    connectedDevices,
    deviceLiveState,
    knownDevices,
    localProfile,
    maxRows: "all",
  });
  const devices = deviceRows.map((device, index) => {
    const workspaces = (Array.isArray(device.workspaces) ? device.workspaces : [])
      .map((workspace) => normalizeDeviceGraphWorkspace(workspace, device, workspaceTodos))
      .filter((workspace) => workspace.id)
      .sort((left, right) => {
        if (left.isCurrentWorkspace !== right.isCurrentWorkspace) {
          return left.isCurrentWorkspace ? -1 : 1;
        }
        const statusDelta = statusPriorityForWorkspace(left.status) - statusPriorityForWorkspace(right.status);
        if (statusDelta) return statusDelta;
        return String(left.name).localeCompare(String(right.name));
      });
    const liveState = device.liveState === "unknown" && device.connected === true
      ? "live"
      : device.liveState || "unknown";
    return {
      device_aliases: uniqueDeviceAliases(device.device_aliases, device.device_id),
      device_id: device.device_id || `device-${index}`,
      device_kind: device.device_kind || TODO_QUEUE_DEVICE_KIND_UNKNOWN,
      device_name: device.device_name || `Device ${index + 1}`,
      form_factor_label: device.form_factor_label || "",
      is_local: Boolean(device.is_local),
      liveState,
      native_connected: device.native_connected === true,
      platform_label: device.platform_label || "",
      registered: Boolean(device.registered),
      serverSeen: Boolean(device.serverSeen),
      todo_count: workspaces.reduce((total, workspace) => total + workspace.todo_count, 0),
      tool_count: workspaces.reduce((total, workspace) => total + workspace.tool_count, 0),
      terminal_count: workspaces.reduce((total, workspace) => total + workspace.terminal_count, 0),
      web_connected: device.web_connected === true,
      workspace_count: workspaces.length,
      workspaces,
    };
  });

  const totals = devices.reduce((summary, device) => ({
    device_count: summary.device_count + 1,
    liveDeviceCount: summary.liveDeviceCount + (device.liveState === "live" ? 1 : 0),
    workspace_count: summary.workspace_count + device.workspace_count,
    activeWorkspaceCount: summary.activeWorkspaceCount + device.workspaces.filter((workspace) => workspace.status === "active").length,
    syncingWorkspaceCount: summary.syncingWorkspaceCount + device.workspaces.filter((workspace) => workspace.status === "syncing").length,
    todo_count: summary.todo_count + device.todo_count,
    terminal_count: summary.terminal_count + device.terminal_count,
    tool_count: summary.tool_count + device.tool_count,
  }), {
    activeWorkspaceCount: 0,
    device_count: 0,
    liveDeviceCount: 0,
    syncingWorkspaceCount: 0,
    terminal_count: 0,
    todo_count: 0,
    tool_count: 0,
    workspace_count: 0,
  });

  return {
    account: {
      name: accountNameFromDeviceLiveState(deviceLiveState),
      status: totals.liveDeviceCount > 0 ? "live" : "idle",
    },
    devices,
    totals,
  };
}

export function todoQueueDeviceSelectionIsLocalEditable(selection, _currentWorkspaceId = "") {
  const deviceKind = [
    selection?.device_kind,
    selection?.form_factor,
    selection?.platform,
    selection?.os,
    selection?.platform_label,
    selection?.rawDevice?.device_kind,
    selection?.rawDevice?.form_factor,
    selection?.rawDevice?.platform,
    selection?.rawDevice?.os,
  ]
    .map((value) => normalizeDeviceKind(value, TODO_QUEUE_DEVICE_KIND_UNKNOWN))
    .find((value) => value !== TODO_QUEUE_DEVICE_KIND_UNKNOWN)
    || TODO_QUEUE_DEVICE_KIND_UNKNOWN;
  const isLocal = normalizeLiveBoolean(
    selection?.is_local ?? selection?.local ?? selection?.rawDevice?.is_local ?? selection?.rawDevice?.local,
  ) === true;
  return Boolean(
    isLocal
      && deviceKind === TODO_QUEUE_DEVICE_KIND_DESKTOP,
  );
}

function todoQueueSnapshotItemAliases(item = {}) {
  return new Set([
    item?.id,
    item?.todo_id,
    item?.command_id,
    item?.dispatch_id,
    item?.client_action_id,
    item?.remote_command?.id,
    item?.remote_command?.command_id,
    item?.remote_command?.todo_id,
  ].map((value) => String(value || "").trim()).filter(Boolean));
}

// todo_store_snapshot is a complete queue snapshot. Hard deletes deliberately
// have no tombstone, so callers must also treat an item missing by every stable
// alias as deleted instead of retaining a stale webview copy.
export function todoQueueItemFromAuthoritativeSnapshot(items = [], item = {}) {
  const aliases = todoQueueSnapshotItemAliases(item);
  if (!aliases.size) {
    return null;
  }
  return (Array.isArray(items) ? items : []).find((candidate) => {
    const candidateAliases = todoQueueSnapshotItemAliases(candidate);
    return [...candidateAliases].some((alias) => aliases.has(alias));
  }) || null;
}

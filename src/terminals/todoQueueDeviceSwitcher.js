export const TODO_QUEUE_DEVICE_KIND_DESKTOP = "desktop";
export const TODO_QUEUE_DEVICE_KIND_MOBILE = "mobile";
export const TODO_QUEUE_DEVICE_KIND_UNKNOWN = "unknown";

const LIVE_STATE_PRESENT_KEYS = [
  "connected",
  "online",
  "live",
  "active",
  "isConnected",
  "is_connected",
  "isOnline",
  "is_online",
  "nativeConnected",
  "native_connected",
  "webConnected",
  "web_connected",
];

const NATIVE_CONNECTED_KEYS = [
  "nativeConnected",
  "native_connected",
  "nativeOnline",
  "native_online",
  "nativeActive",
  "native_active",
];

const WEB_CONNECTED_KEYS = [
  "webConnected",
  "web_connected",
  "webActive",
  "web_active",
  "webOpen",
  "web_open",
  "webOnline",
  "web_online",
];

const LIVE_STATE_STATUS_KEYS = [
  "status",
  "state",
  "connection",
  "connectionStatus",
  "connection_status",
  "liveStatus",
  "live_status",
  "presenceStatus",
  "presence_status",
];

const LIVE_STATE_CONTAINER_KEYS = [
  "accountDeviceLiveStateSnapshot",
  "account_device_live_state_snapshot",
  "clientConnection",
  "client_connection",
  "serverRoster",
  "server_roster",
  "accountDeviceServerRoster",
  "account_device_server_roster",
  "registeredDevices",
  "registered_devices",
  "deviceRegistry",
  "device_registry",
  "devices",
  "items",
  "machines",
  "clients",
  "clientDevices",
  "client_devices",
  "accountDevices",
  "account_devices",
  "activeDesktopDevices",
  "active_desktop_devices",
  "desktopDevices",
  "desktop_devices",
  "mobileDevices",
  "mobile_devices",
  "webDevices",
  "web_devices",
  "workspaces",
  "workspaceStates",
  "workspace_states",
  "workspacePresence",
  "workspace_presence",
  "workspaceLiveState",
  "workspace_live_state",
  "terminals",
  "terminalSessions",
  "terminal_sessions",
  "sessions",
];

const DEVICE_ALIAS_KEYS = [
  "id",
  "deviceId",
  "device_id",
  "desktopDeviceId",
  "desktop_device_id",
  "sourceDeviceId",
  "source_device_id",
  "targetDeviceId",
  "target_device_id",
  "targetNativeDeviceId",
  "target_native_device_id",
  "todoDeviceId",
  "todo_device_id",
  "machineId",
  "machine_id",
  "nativeDeviceId",
  "native_device_id",
  "desktopDeviceId",
  "desktop_device_id",
  "currentWebDeviceId",
  "current_web_device_id",
  "webDeviceId",
  "web_device_id",
  "webPresenceDeviceId",
  "web_presence_device_id",
  "browserDeviceId",
  "browser_device_id",
  "matchedDeviceId",
  "matched_device_id",
  "requestedTargetDeviceId",
  "requested_target_device_id",
  "deviceAliases",
  "device_aliases",
  "replacedWebDeviceIds",
  "replaced_web_device_ids",
];

const TODO_WORKSPACE_CONTAINER_KEYS = [
  "items",
  "todos",
  "itemsByWorkspace",
  "items_by_workspace",
  "todosByWorkspace",
  "todos_by_workspace",
  "dispatchTargets",
  "dispatch_targets",
  "dispatchTargetsByWorkspace",
  "dispatch_targets_by_workspace",
  "dispatches",
  "todoDispatches",
  "todo_dispatches",
  "dispatchesByWorkspace",
  "dispatches_by_workspace",
  "todoDispatchesByWorkspace",
  "todo_dispatches_by_workspace",
  "peerActivity",
  "peer_activity",
  "peerActivityByWorkspace",
  "peer_activity_by_workspace",
  "workspacePeerActivity",
  "workspace_peer_activity",
];

const WORKSPACE_STATUS_KEYS = [
  "workspaceStatus",
  "workspace_status",
  "runtimeStatus",
  "runtime_status",
  "displayStatus",
  "display_status",
  "status",
  "state",
  "phase",
];

const WORKSPACE_ACTIVE_KEYS = [
  "workspaceActive",
  "workspace_active",
  "active",
  "activated",
  "selected",
  "workspaceSelected",
  "workspace_selected",
  "isActive",
  "is_active",
];

const WORKSPACE_TERMINAL_KEYS = [
  "terminals",
  "terminalSessions",
  "terminal_sessions",
  "terminalList",
  "terminal_list",
  "sessions",
];

const WORKSPACE_SERVER_KEYS = [
  "servers",
  "serverSessions",
  "server_sessions",
  "services",
];

const WORKSPACE_MCP_KEYS = [
  "mcps",
  "mcpServers",
  "mcp_servers",
  "mcpSessions",
  "mcp_sessions",
];

function firstText(...values) {
  return values
    .map((value) => String(value ?? "").trim())
    .find(Boolean) || "";
}

export function normalizeTodoQueueSwitcherId(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeWorkspaceId(value) {
  return String(value || "").trim();
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
  const direct = record?.webPresence || record?.web_presence;
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
  appendDeviceAlias(aliases, record.rawDevice);
  appendDeviceAlias(aliases, record.raw_device);
  appendDeviceAlias(aliases, record.webPresence);
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
  const accountSnapshot = root.accountDeviceLiveStateSnapshot
    || root.account_device_live_state_snapshot
    || root.deviceLiveStateSnapshot
    || root.device_live_state_snapshot
    || null;
  const snapshotRoot = accountSnapshot && typeof accountSnapshot === "object"
    ? accountSnapshot
    : root;
  return { root, snapshotRoot };
}

function connectionOverlayFromLiveState(value) {
  const { root, snapshotRoot } = liveStateSnapshotRoot(value);
  const summary = firstDeviceObject(
    snapshotRoot.client_connection,
    snapshotRoot.clientConnection,
    snapshotRoot.connection_summary,
    snapshotRoot.connectionSummary,
    root.client_connection,
    root.clientConnection,
    root.connection_summary,
    root.connectionSummary,
  );
  const activeNativeIds = collectDeviceIdsFromValue([
    summary.active_desktop_device_ids,
    summary.activeDesktopDeviceIds,
    summary.active_native_device_ids,
    summary.activeNativeDeviceIds,
    summary.active_desktop_devices,
    summary.activeDesktopDevices,
    summary.active_native_devices,
    summary.activeNativeDevices,
  ]);
  const activeWebTargetIds = collectDeviceIdsFromValue([
    summary.active_web_target_device_ids,
    summary.activeWebTargetDeviceIds,
  ]);
  const activeWebDevices = Array.isArray(summary.active_web_devices)
    ? summary.active_web_devices
    : Array.isArray(summary.activeWebDevices)
      ? summary.activeWebDevices
      : [];
  activeWebDevices.forEach((device) => {
    collectDeviceIdsFromValue(
      device?.target_device_id
        || device?.targetDeviceId
        || device?.target_native_device_id
        || device?.targetNativeDeviceId,
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
    const aliases = uniqueDeviceAliases(device?.deviceAliases, device?.deviceId);
    const nativeOverlayActive = aliases.some((id) => activeNativeIds.has(id));
    const webOverlayActive = aliases.some((id) => activeWebTargetIds.has(id));
    if (!nativeOverlayActive && !webOverlayActive) {
      return device;
    }
    const nativeConnected = nativeOverlayActive ? true : device.nativeConnected;
    const webConnected = webOverlayActive ? true : device.webConnected;
    return {
      ...device,
      connected: true,
      liveState: "live",
      nativeConnected,
      webConnected,
    };
  });
}

function recordLooksWebOnly(record) {
  const web = webPresenceForRecord(record);
  const source = [
    record?.clientKind,
    record?.client_kind,
    record?.clientType,
    record?.client_type,
    record?.connectionSource,
    record?.connection_source,
    record?.source,
    web?.clientKind,
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
    record.deviceId,
    record.device_id,
    record.machineId,
    record.machine_id,
    record.nativeDeviceId,
    record.native_device_id,
    record.desktopDeviceId,
    record.desktop_device_id,
    record.targetNativeDeviceId,
    record.target_native_device_id,
    web?.nativeDeviceId,
    web?.native_device_id,
    nativeSurface?.deviceId,
    nativeSurface?.device_id,
    nativeSurface?.machineId,
    nativeSurface?.machine_id,
  );
  const platformAndForm = [
    record.platform,
    record.os,
    record.formFactor,
    record.form_factor,
    record.deviceType,
    record.device_type,
    web?.webPlatform,
    web?.web_platform,
    web?.webFormFactor,
    web?.web_form_factor,
  ].map(normalizedToken).join(" ");
  const clientKind = [
    record.clientKind,
    record.client_kind,
    record.clientType,
    record.client_type,
    record.connectionSource,
    record.connection_source,
    record.source,
    nativeSurface?.clientKind,
    nativeSurface?.client_kind,
    nativeSurface?.clientType,
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
  const workspaceCount = Number(record.workspaceCount ?? record.workspace_count ?? 0) || 0;
  const hasWorkspaces = workspaceCount > 0
    || objectHasEntries(record.workspaces)
    || objectHasEntries(record.workspaceCatalog)
    || objectHasEntries(record.workspace_catalog)
    || objectHasEntries(record.workspaceStates)
    || objectHasEntries(record.workspace_states);
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
    return inherited?.nativeConnected ?? null;
  }
  const generic = boolFromKeys(record, ["connected", "online", "live", "active", "status", "state"]);
  if (generic !== null && (!recordLooksWebOnly(record) || recordHasNativeAnchor(record))) {
    return generic;
  }
  return inherited?.nativeConnected ?? null;
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
  return inherited?.webConnected ?? null;
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
      "deviceKind",
      "device_kind",
      "kind",
      "clientKind",
      "client_kind",
      "clientType",
      "client_type",
      "formFactor",
      "form_factor",
      "deviceType",
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
    "deviceId",
    "device_id",
    "desktopDeviceId",
    "desktop_device_id",
    "sourceDeviceId",
    "source_device_id",
    "targetDeviceId",
    "target_device_id",
    "todoDeviceId",
    "todo_device_id",
    "machineId",
    "machine_id",
    "clientId",
    "client_id",
  ]));
  if (explicit) {
    return explicit;
  }
  if (hasAnyKey(record, [
    "displayName",
    "display_name",
    "deviceName",
    "device_name",
    "machineName",
    "machine_name",
    "hostname",
    "clientKind",
    "client_kind",
    "clientType",
    "client_type",
    "formFactor",
    "form_factor",
    "deviceType",
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
    record?.displayName,
    record?.display_name,
    record?.deviceName,
    record?.device_name,
    record?.targetDeviceName,
    record?.target_device_name,
    record?.sourceDeviceName,
    record?.source_device_name,
    record?.machineName,
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
    "sourceWorkspaceId",
    "source_workspace_id",
    "targetWorkspaceId",
    "target_workspace_id",
    "workspaceId",
    "workspace_id",
    "observerWorkspaceId",
    "observer_workspace_id",
    "repoWorkspaceId",
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
      "workspaceName",
      "workspace_name",
      "sourceWorkspaceName",
      "source_workspace_name",
      "targetWorkspaceName",
      "target_workspace_name",
      "repoPath",
      "repo_path",
      "gitRepoDisplayName",
      "git_repo_display_name",
    ])
    && !deviceIdForRecord(record)
  ) {
    return normalizeWorkspaceId(record?.id);
  }
  return "";
}

function workspaceNameForRecord(record, fallback = "") {
  return firstText(
    record?.sourceWorkspaceName,
    record?.source_workspace_name,
    record?.targetWorkspaceName,
    record?.target_workspace_name,
    record?.workspaceName,
    record?.workspace_name,
    record?.repoName,
    record?.repo_name,
    record?.gitRepoDisplayName,
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
    "activityStatus",
    "activity_status",
    "displayStatus",
    "display_status",
    "sessionState",
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
    mcpCount: numberFromRecord(record, ["mcpCount", "mcp_count", "mcpServerCount", "mcp_server_count"]) ?? mcps.length,
    mcpStatusCounts: graphEntryStatusCounts(mcps),
    serverCount: numberFromRecord(record, ["serverCount", "server_count", "serviceCount", "service_count"]) ?? servers.length,
    serverStatusCounts: graphEntryStatusCounts(servers),
    servers: servers.slice(0, 16),
    terminalCount: numberFromRecord(record, ["terminalCount", "terminal_count", "terminalSessionCount", "terminal_session_count"]) ?? terminals.length,
    terminalStatusCounts: graphEntryStatusCounts(terminals),
    terminals: terminals.slice(0, 16),
    workspaceActive: boolFromKeys(record, WORKSPACE_ACTIVE_KEYS) === true,
    workspaceStatus: workspaceStatusForRecord(record),
  };
}

function normalizeDeviceRecord(record, index = 0, options = {}) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const inherited = options.inherited || null;
  const forcedKind = options.kind || "";
  const deviceId = deviceIdForRecord(record) || normalizeTodoQueueSwitcherId(inherited?.deviceId);
  if (!deviceId) {
    return null;
  }
  const kind = forcedKind
    || deviceKindForRecord(record, inherited?.deviceKind || TODO_QUEUE_DEVICE_KIND_UNKNOWN);
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
    inherited?.deviceAliases,
    deviceAliasesForRecord(record, deviceId),
  );
  const rawDeviceName = deviceNameForRecord(record, index);
  const inheritedDeviceName = inherited?.deviceName || "";
  const deviceName = deviceNameIsGeneric(rawDeviceName) && !deviceNameIsGeneric(inheritedDeviceName)
    ? inheritedDeviceName
    : rawDeviceName || inheritedDeviceName || "Device";
  return {
    connected,
    deviceAliases,
    deviceId,
    deviceKind: kind,
    deviceName,
    formFactorLabel: firstText(
      record.formFactorLabel,
      record.form_factor_label,
      record.formFactor,
      record.form_factor,
      record.deviceType,
      record.device_type,
      kind === TODO_QUEUE_DEVICE_KIND_MOBILE ? "Mobile" : "",
    ),
    isLocal: Boolean(options.isLocal || inherited?.isLocal),
    liveState,
    nativeConnected,
    platformIcon: firstText(
      record.platformIcon,
      record.platform_icon,
      record.deviceIcon,
      record.device_icon,
      record.icon,
      inherited?.platformIcon,
    ),
    platformLabel: firstText(
      record.platformLabel,
      record.platform_label,
      record.platform,
      record.os,
      inherited?.platformLabel,
    ),
    registered: Boolean(
      options.registered
        || inherited?.registered
        || record.registered
        || record.registeredDevice
        || record.registered_device
    ),
    serverSeen: Boolean(options.serverSeen || inherited?.serverSeen),
    webConnected,
    webOnly: Boolean(looksWebOnly && !hasNativeAnchor),
  };
}

function mergeDevice(previous, next) {
  if (!previous) {
    return {
      ...next,
      deviceAliases: uniqueDeviceAliases(next?.deviceAliases, next?.deviceId),
      webOnly: Boolean(next?.webOnly),
    };
  }
  const nextIsWebOverlay = Boolean(next.webOnly && previous.webOnly !== true);
  const nextIsCanonicalIdentity = Boolean(previous.webOnly && !next.webOnly);
  const previousHasUsefulName = !deviceNameIsGeneric(previous.deviceName);
  const nextHasUsefulName = !deviceNameIsGeneric(next.deviceName);
  const preferNextName = Boolean(
    nextHasUsefulName
      && (
        !previousHasUsefulName
        || (next.serverSeen && (!previous.serverSeen || nextHasUsefulName))
      ),
  ) || Boolean(!previous.deviceName && next.deviceName);
  const connected = mergeNullableBooleans(previous.connected, next.connected);
  const nativeConnected = mergeDeviceSurfaceBoolean(previous, next, "nativeConnected");
  const webConnected = mergeDeviceSurfaceBoolean(previous, next, "webConnected");
  const liveState = previous.liveState === "live" || next.liveState === "live"
    ? "live"
    : next.liveState !== "unknown"
      ? next.liveState
      : previous.liveState || "unknown";
  return {
    ...previous,
    ...next,
    connected,
    deviceAliases: uniqueDeviceAliases(previous.deviceAliases, previous.deviceId, next.deviceAliases, next.deviceId),
    deviceKind: nextIsWebOverlay
      ? previous.deviceKind
      : previous.deviceKind === TODO_QUEUE_DEVICE_KIND_DESKTOP || previous.isLocal
      ? previous.deviceKind
      : next.deviceKind || previous.deviceKind,
    deviceName: nextIsWebOverlay || !preferNextName
      ? previous.deviceName
      : next.deviceName,
    formFactorLabel: nextIsCanonicalIdentity
      ? next.formFactorLabel || previous.formFactorLabel || ""
      : nextIsWebOverlay
      ? previous.formFactorLabel || ""
      : previous.formFactorLabel || next.formFactorLabel || "",
    isLocal: Boolean(previous.isLocal || next.isLocal),
    liveState,
    nativeConnected,
    platformIcon: nextIsCanonicalIdentity
      ? next.platformIcon || previous.platformIcon || ""
      : nextIsWebOverlay
      ? previous.platformIcon || ""
      : previous.platformIcon || next.platformIcon || "",
    platformLabel: nextIsCanonicalIdentity
      ? next.platformLabel || previous.platformLabel || ""
      : nextIsWebOverlay
      ? previous.platformLabel || ""
      : previous.platformLabel || next.platformLabel || "",
    registered: Boolean(previous.registered || next.registered),
    serverSeen: Boolean(previous.serverSeen || next.serverSeen),
    webConnected,
    webOnly: Boolean(previous.webOnly && next.webOnly),
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
  return Boolean(previous?.webOnly && !next?.webOnly && !idLooksWebOnly(safeCandidateId));
}

function addWorkspace(workspacesByDevice, entry) {
  const deviceId = normalizeTodoQueueSwitcherId(entry?.deviceId);
  const workspaceId = normalizeWorkspaceId(entry?.workspaceId);
  if (!deviceId || !workspaceId) {
    return;
  }
  const key = `${deviceId}::${workspaceId}`;
  const previous = workspacesByDevice.get(key) || {};
  workspacesByDevice.set(key, {
    ...previous,
    ...entry,
    deviceId,
    workspaceId,
    workspaceName: entry.workspaceName || previous.workspaceName || workspaceId,
  });
}

function findDeviceKeyByAliases(devicesById, aliases = []) {
  const aliasList = uniqueDeviceAliases(aliases);
  if (!aliasList.length) {
    return "";
  }
  for (const [deviceId, device] of devicesById.entries()) {
    if (aliasList.includes(deviceId) || aliasesIntersect(device.deviceAliases, aliasList)) {
      return deviceId;
    }
  }
  return "";
}

function upsertDevice(devicesById, device) {
  if (!device?.deviceId) {
    return "";
  }
  const deviceAliases = uniqueDeviceAliases(device.deviceAliases, device.deviceId);
  const existingKey = findDeviceKeyByAliases(devicesById, deviceAliases);
  const deviceId = existingKey || device.deviceId;
  const previous = devicesById.get(deviceId) || null;
  const preferredDeviceId = shouldPreferDeviceKey(device.deviceId, deviceId, previous, device)
    ? device.deviceId
    : deviceId;
  const merged = mergeDevice(previous, {
    ...device,
    deviceAliases,
    deviceId: preferredDeviceId,
  });
  if (preferredDeviceId !== deviceId) {
    devicesById.delete(deviceId);
  }
  devicesById.set(preferredDeviceId, {
    ...merged,
    deviceAliases: uniqueDeviceAliases(merged.deviceAliases, deviceAliases, device.deviceId, deviceId, preferredDeviceId),
    deviceId: preferredDeviceId,
  });
  return preferredDeviceId;
}

function canonicalDeviceIdFor(devicesById, entry) {
  const aliases = uniqueDeviceAliases(
    entry?.deviceAliases,
    deviceAliasesForRecord(entry, entry?.deviceId),
    entry?.deviceId,
  );
  return findDeviceKeyByAliases(devicesById, aliases) || normalizeTodoQueueSwitcherId(entry?.deviceId);
}

function moveWorkspaceEntriesToDevice(workspacesByDevice, fromDeviceId, toDeviceId, targetDevice = {}) {
  const safeFromDeviceId = normalizeTodoQueueSwitcherId(fromDeviceId);
  const safeToDeviceId = normalizeTodoQueueSwitcherId(toDeviceId);
  if (!safeFromDeviceId || !safeToDeviceId || safeFromDeviceId === safeToDeviceId) {
    return;
  }
  const fromPrefix = `${safeFromDeviceId}::`;
  const entriesToMove = [];
  for (const [key, entry] of workspacesByDevice.entries()) {
    if (String(key || "").startsWith(fromPrefix)) {
      entriesToMove.push([key, entry]);
    }
  }
  entriesToMove.forEach(([key, entry]) => {
    workspacesByDevice.delete(key);
    addWorkspace(workspacesByDevice, {
      ...entry,
      deviceId: safeToDeviceId,
      deviceKind: targetDevice.deviceKind || entry.deviceKind,
      deviceName: targetDevice.deviceName || entry.deviceName,
    });
  });
}

function removeWorkspaceEntriesForDevice(workspacesByDevice, deviceId) {
  const safeDeviceId = normalizeTodoQueueSwitcherId(deviceId);
  if (!safeDeviceId) {
    return;
  }
  const prefix = `${safeDeviceId}::`;
  Array.from(workspacesByDevice.keys()).forEach((key) => {
    if (String(key || "").startsWith(prefix)) {
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
    if (device?.registered) {
      continue;
    }
    const targetEntry = registeredEntries.find(([registeredId, registeredDevice]) => (
      registeredId !== deviceId
        && aliasesIntersect(registeredDevice.deviceAliases, device.deviceAliases)
    ));
    if (targetEntry) {
      const [targetDeviceId, targetDevice] = targetEntry;
      const currentTargetDevice = devicesById.get(targetDeviceId) || targetDevice;
      devicesById.set(targetDeviceId, mergeDevice(currentTargetDevice, {
        ...device,
        deviceId: targetDeviceId,
        deviceName: currentTargetDevice.deviceName,
        registered: true,
        webOnly: false,
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
      && device.webOnly !== true
      && device.deviceKind !== TODO_QUEUE_DEVICE_KIND_MOBILE
      && (device.serverSeen || device.isLocal || device.nativeConnected === true || !idLooksWebOnly(device.deviceId))
  ));
  if (!canonicalEntries.length) {
    return;
  }
  const hasRegisteredInventory = canonicalEntries.some(([, device]) => device?.registered);
  const canonicalWithWeb = canonicalEntries.filter(([, device]) => device.webConnected === true);
  entries.forEach(([deviceId, device]) => {
    if (
      !device?.webOnly
      || device.isLocal
      || device.deviceKind === TODO_QUEUE_DEVICE_KIND_MOBILE
    ) {
      return;
    }
    const targetEntry = canonicalEntries.find(([, candidate]) => (
      aliasesIntersect(candidate.deviceAliases, device.deviceAliases)
    )) || (canonicalWithWeb.length === 1
      ? canonicalWithWeb[0]
      : (!hasRegisteredInventory && canonicalEntries.length === 1)
        ? canonicalEntries[0]
        : null);
    if (!targetEntry) {
      if (deviceNameIsGeneric(device.deviceName)) {
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
      deviceId: targetDeviceId,
      deviceKind: currentTargetDevice.deviceKind,
      deviceName: currentTargetDevice.deviceName,
      formFactorLabel: currentTargetDevice.formFactorLabel,
      isLocal: currentTargetDevice.isLocal,
      nativeConnected: null,
      platformIcon: currentTargetDevice.platformIcon,
      platformLabel: currentTargetDevice.platformLabel,
      serverSeen: Boolean(currentTargetDevice.serverSeen || device.serverSeen),
      webOnly: false,
    });
    devicesById.set(targetDeviceId, {
      ...merged,
      deviceAliases: uniqueDeviceAliases(merged.deviceAliases, currentTargetDevice.deviceAliases, device.deviceAliases, targetDeviceId, deviceId),
      deviceId: targetDeviceId,
      deviceName: currentTargetDevice.deviceName || merged.deviceName,
      isLocal: Boolean(currentTargetDevice.isLocal || merged.isLocal),
      webOnly: false,
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
    snapshotRoot.clientConnection,
    snapshotRoot.connection_summary,
    snapshotRoot.connectionSummary,
    root.client_connection,
    root.clientConnection,
    root.connection_summary,
    root.connectionSummary,
  );

  [
    snapshotRoot.registered_devices,
    snapshotRoot.registeredDevices,
    snapshotRoot.device_registry,
    snapshotRoot.deviceRegistry,
    root.registered_devices,
    root.registeredDevices,
    root.device_registry,
    root.deviceRegistry,
  ].forEach((value) => collectContainer(value, { registered: true }));

  [
    snapshotRoot.devices,
    snapshotRoot.device_map,
    snapshotRoot.deviceMap,
    snapshotRoot.devices_by_id,
    snapshotRoot.devicesById,
    snapshotRoot.items,
    snapshotRoot.server_roster,
    snapshotRoot.serverRoster,
    root.devices,
    root.device_map,
    root.deviceMap,
    root.devices_by_id,
    root.devicesById,
    root.items,
    root.server_roster,
    root.serverRoster,
    clientConnection.active_desktop_devices,
    clientConnection.activeDesktopDevices,
    clientConnection.active_native_devices,
    clientConnection.activeNativeDevices,
    clientConnection.active_web_devices,
    clientConnection.activeWebDevices,
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
      .filter((workspace) => aliasesIntersect(device.deviceAliases, workspace.deviceAliases || workspace.deviceId))
      .forEach((workspace) => addWorkspace(workspacesByDevice, {
        ...workspace,
        deviceId: device.deviceId,
      }));
    if (!device.serverSeen) {
      upsertNormalizedRecord(device, index);
    }
  });

  (Array.isArray(connectedDevices) ? connectedDevices : []).forEach((device, index) => {
    upsertNormalizedRecord(device, index);
  });

  const localDevice = normalizeDeviceRecord(localProfile || {}, 0, {
    isLocal: true,
    kind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
  });
  if (localDevice) {
    const localDeviceId = findDeviceKeyByAliases(devicesById, localDevice.deviceAliases);
    if (localDeviceId) {
      const serverDevice = devicesById.get(localDeviceId) || {};
      const mergedLocalDevice = mergeDevice(serverDevice, {
        ...localDevice,
        deviceId: localDeviceId,
      });
      devicesById.set(localDeviceId, {
        ...mergedLocalDevice,
        deviceAliases: uniqueDeviceAliases(
          mergedLocalDevice.deviceAliases,
          serverDevice.deviceAliases,
          localDevice.deviceAliases,
          localDeviceId,
        ),
        deviceKind: mergedLocalDevice.deviceKind === TODO_QUEUE_DEVICE_KIND_UNKNOWN
          ? TODO_QUEUE_DEVICE_KIND_DESKTOP
          : mergedLocalDevice.deviceKind,
        isLocal: true,
        serverSeen: Boolean(serverDevice.serverSeen || mergedLocalDevice.serverSeen),
      });
    }
  }

  foldWebOnlyDeviceRows(devicesById, workspacesByDevice);
  pruneToRegisteredDeviceRows(devicesById, workspacesByDevice);

  return Array.from(devicesById.values())
    .filter((device) => device.isLocal || device.serverSeen || device.registered || device.liveState !== "offline")
    .map((device, index) => ({
      deviceId: device.deviceId || `device-${index}`,
      deviceAliases: uniqueDeviceAliases(device.deviceAliases, device.deviceId),
      deviceKind: device.deviceKind || TODO_QUEUE_DEVICE_KIND_UNKNOWN,
      deviceName: device.deviceName || `Device ${index + 1}`,
      formFactorLabel: device.formFactorLabel || "",
      isLocal: Boolean(device.isLocal),
      liveState: device.liveState === "unknown" && device.connected === true ? "live" : device.liveState || "unknown",
      nativeConnected: device.nativeConnected === true,
      platformIcon: device.platformIcon || "",
      platformLabel: device.platformLabel || "",
      registered: Boolean(device.registered),
      serverSeen: Boolean(device.serverSeen),
      webConnected: device.webConnected === true,
      workspaces: Array.from(workspacesByDevice.values())
        .filter((workspace) => normalizeTodoQueueSwitcherId(workspace.deviceId) === device.deviceId)
        .map((workspace) => ({
          id: workspace.workspaceId,
          isCurrentWorkspace: Boolean(workspace.isCurrentWorkspace),
          mcps: Array.isArray(workspace.mcps) ? workspace.mcps : [],
          mcpCount: Number(workspace.mcpCount) || 0,
          mcpStatusCounts: workspace.mcpStatusCounts || {},
          name: workspace.workspaceName || workspace.workspaceId,
          serverCount: Number(workspace.serverCount) || 0,
          serverStatusCounts: workspace.serverStatusCounts || {},
          servers: Array.isArray(workspace.servers) ? workspace.servers : [],
          status: workspace.workspaceStatus || "",
          terminalCount: Number(workspace.terminalCount) || 0,
          terminalStatusCounts: workspace.terminalStatusCounts || {},
          terminals: Array.isArray(workspace.terminals) ? workspace.terminals : [],
          workspaceActive: workspace.workspaceActive === true,
        })),
    }))
    .sort((left, right) => {
      if (left.isLocal !== right.isLocal) {
        return left.isLocal ? -1 : 1;
      }
      if (left.liveState === "live" && right.liveState !== "live") return -1;
      if (right.liveState === "live" && left.liveState !== "live") return 1;
      return String(left.deviceName).localeCompare(String(right.deviceName));
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
  if (workspaceId && currentDevice?.deviceId) {
    result.workspaces.push({
      deviceId: currentDevice.deviceId,
      deviceAliases: currentDevice.deviceAliases,
      deviceKind: currentDevice.deviceKind,
      deviceName: currentDevice.deviceName,
      workspaceId,
      workspaceName: workspaceNameForRecord(value, workspaceId),
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
      const registered = options.registered
        || key === "registeredDevices"
        || key === "registered_devices"
        || key === "deviceRegistry"
        || key === "device_registry";
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
      deviceId,
      deviceAliases: deviceAliasesForRecord(value, deviceId),
      deviceKind: deviceKindForRecord(value, TODO_QUEUE_DEVICE_KIND_UNKNOWN),
      deviceName: deviceNameForRecord(value, entries.length),
      workspaceId,
      workspaceName: workspaceNameForRecord(value, workspaceId),
    });
  }

  TODO_WORKSPACE_CONTAINER_KEYS.forEach((key) => {
    const nextValue = value[key];
    if (!nextValue || nextValue === value) {
      return;
    }
    if (
      key.endsWith("ByWorkspace")
      || key.endsWith("_by_workspace")
      || key === "peerActivityByWorkspace"
      || key === "peer_activity_by_workspace"
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

function selectionIdFor({ deviceId, workspaceId = "", deviceKind = TODO_QUEUE_DEVICE_KIND_UNKNOWN }) {
  const safeDeviceId = normalizeTodoQueueSwitcherId(deviceId) || "device";
  const safeWorkspaceId = normalizeWorkspaceId(workspaceId);
  return safeWorkspaceId
    ? `${safeDeviceId}::${safeWorkspaceId}`
    : `${safeDeviceId}::${deviceKind}`;
}

function sortWorkspaceEntries(a, b) {
  return String(a.workspaceName || a.workspaceId).localeCompare(String(b.workspaceName || b.workspaceId));
}

export function buildTodoQueueDeviceWorkspaceOptions({
  connectedDevices = [],
  currentWorkspaceId = "",
  currentWorkspaceName = "",
  deviceLiveState = null,
  knownDevices = [],
  localProfile = null,
  workspaceTodos = null,
} = {}) {
  const devicesById = new Map();
  const workspacesByDevice = new Map();
  const safeCurrentWorkspaceId = normalizeWorkspaceId(currentWorkspaceId);
  const safeCurrentWorkspaceName = firstText(currentWorkspaceName, safeCurrentWorkspaceId, "Current workspace");
  const serverSourceAvailable = Boolean(
    (Array.isArray(knownDevices) && knownDevices.length)
      || (Array.isArray(connectedDevices) && connectedDevices.length)
      || (deviceLiveState && typeof deviceLiveState === "object")
      || (workspaceTodos && typeof workspaceTodos === "object")
  );

  const localDevice = normalizeDeviceRecord(localProfile || {}, 0, {
    isLocal: true,
    kind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
  }) || {
    connected: null,
    deviceAliases: ["local-device"],
    deviceId: "local-device",
    deviceKind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
    deviceName: "This device",
    formFactorLabel: "Desktop",
    isLocal: true,
    liveState: "unknown",
    nativeConnected: null,
    platformLabel: "",
    serverSeen: false,
    webConnected: null,
  };

  const addCanonicalWorkspace = (entry) => {
    const canonicalDeviceId = canonicalDeviceIdFor(devicesById, entry);
    if (!canonicalDeviceId) {
      return;
    }
    addWorkspace(workspacesByDevice, {
      ...entry,
      deviceId: canonicalDeviceId,
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
  const localCanonicalDeviceId = findDeviceKeyByAliases(devicesById, localDevice.deviceAliases);
  if (localCanonicalDeviceId) {
    const serverDevice = devicesById.get(localCanonicalDeviceId) || {};
    const mergedLocalDevice = mergeDevice(serverDevice, {
      ...localDevice,
      deviceId: localCanonicalDeviceId,
    });
    devicesById.set(localCanonicalDeviceId, {
      ...mergedLocalDevice,
      deviceAliases: uniqueDeviceAliases(mergedLocalDevice.deviceAliases, serverDevice.deviceAliases, localDevice.deviceAliases, localCanonicalDeviceId),
      deviceKind: mergedLocalDevice.deviceKind === TODO_QUEUE_DEVICE_KIND_UNKNOWN
        ? TODO_QUEUE_DEVICE_KIND_DESKTOP
        : mergedLocalDevice.deviceKind,
      isLocal: true,
      serverSeen: Boolean(serverDevice.serverSeen || mergedLocalDevice.serverSeen),
    });
    if (safeCurrentWorkspaceId) {
      const workspaceKey = `${localCanonicalDeviceId}::${safeCurrentWorkspaceId}`;
      const currentWorkspace = workspacesByDevice.get(workspaceKey);
      if (currentWorkspace) {
        workspacesByDevice.set(workspaceKey, {
          ...currentWorkspace,
          isCurrentWorkspace: true,
          isLocal: true,
        });
      } else {
        addWorkspace(workspacesByDevice, {
          deviceId: localCanonicalDeviceId,
          deviceKind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
          deviceName: mergedLocalDevice.deviceName || localDevice.deviceName,
          isCurrentWorkspace: true,
          isLocal: true,
          workspaceId: safeCurrentWorkspaceId,
          workspaceName: safeCurrentWorkspaceName,
        });
      }
    }
  } else if (!serverSourceAvailable && serverBackedDeviceCount === 0) {
    const fallbackDeviceId = upsertDevice(devicesById, localDevice);
    if (fallbackDeviceId && safeCurrentWorkspaceId) {
      addWorkspace(workspacesByDevice, {
        deviceId: fallbackDeviceId,
        deviceKind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
        deviceName: localDevice.deviceName,
        isCurrentWorkspace: true,
        isLocal: true,
        workspaceId: safeCurrentWorkspaceId,
        workspaceName: safeCurrentWorkspaceName,
      });
    }
  }

  foldWebOnlyDeviceRows(devicesById, workspacesByDevice);
  pruneToRegisteredDeviceRows(devicesById, workspacesByDevice);

  const workspaceEntries = Array.from(workspacesByDevice.values());
  const workspaceEntriesByDevice = new Map();
  workspaceEntries.forEach((entry) => {
    const safeDeviceId = normalizeTodoQueueSwitcherId(entry.deviceId);
    if (!safeDeviceId) {
      return;
    }
    const list = workspaceEntriesByDevice.get(safeDeviceId) || [];
    list.push(entry);
    workspaceEntriesByDevice.set(safeDeviceId, list);
  });

  const options = [];
  const addOption = (device, workspace = null, extra = {}) => {
    const workspaceId = normalizeWorkspaceId(workspace?.workspaceId);
    const option = {
      connected: device.connected,
      deviceAliases: uniqueDeviceAliases(device.deviceAliases, device.deviceId),
      deviceId: device.deviceId,
      deviceKind: device.deviceKind || TODO_QUEUE_DEVICE_KIND_UNKNOWN,
      deviceName: device.deviceName || "Device",
      formFactorLabel: device.formFactorLabel || "",
      id: selectionIdFor({
        deviceId: device.deviceId,
        deviceKind: device.deviceKind,
        workspaceId,
      }),
      isCurrentWorkspace: Boolean(extra.isCurrentWorkspace),
      isLocal: Boolean(device.isLocal),
      liveState: device.liveState === "unknown" && device.connected === true ? "live" : device.liveState || "unknown",
      nativeConnected: device.nativeConnected === true,
      platformIcon: device.platformIcon || "",
      platformLabel: device.platformLabel || "",
      serverSeen: Boolean(device.serverSeen),
      surfaces: [
        { active: device.nativeConnected === true, id: "native", label: "native" },
        { active: device.webConnected === true, id: "web", label: "web" },
      ],
      webConnected: device.webConnected === true,
      workspaceId,
      workspaceName: workspace?.workspaceName || "",
    };
    if (!options.some((candidate) => candidate.id === option.id)) {
      options.push(option);
    }
  };

  const sortedDevices = Array.from(devicesById.values())
    .sort((a, b) => {
      if (a.isLocal !== b.isLocal) {
        return a.isLocal ? -1 : 1;
      }
      if (a.liveState === "live" && b.liveState !== "live") return -1;
      if (b.liveState === "live" && a.liveState !== "live") return 1;
      return String(a.deviceName).localeCompare(String(b.deviceName));
    });

  sortedDevices.forEach((device) => {
    let workspaces = (workspaceEntriesByDevice.get(device.deviceId) || [])
      .sort((a, b) => {
        if (a.isCurrentWorkspace !== b.isCurrentWorkspace) {
          return a.isCurrentWorkspace ? -1 : 1;
        }
        return sortWorkspaceEntries(a, b);
      });
    if (device.isLocal && device.deviceKind !== TODO_QUEUE_DEVICE_KIND_MOBILE) {
      const preferredWorkspace = workspaces.find((workspace) => (
        workspace.isCurrentWorkspace
        || normalizeWorkspaceId(workspace.workspaceId) === safeCurrentWorkspaceId
      )) || workspaces[0] || null;
      workspaces = preferredWorkspace ? [preferredWorkspace] : [];
    }
    if (device.deviceKind === TODO_QUEUE_DEVICE_KIND_MOBILE || !workspaces.length) {
      addOption(device);
      return;
    }
    workspaces.forEach((workspace) => addOption(device, workspace, {
      isCurrentWorkspace: Boolean(workspace.isCurrentWorkspace),
    }));
  });

  return options;
}

function collectionForWorkspace(workspaceTodos, workspaceId, directKeys = [], byWorkspaceKeys = []) {
  if (!workspaceTodos || typeof workspaceTodos !== "object") {
    return null;
  }
  const safeWorkspaceId = normalizeWorkspaceId(workspaceId);
  const direct = directKeys
    .map((key) => workspaceTodos[key])
    .find((value) => value);
  const byWorkspace = byWorkspaceKeys
    .map((key) => workspaceTodos[key])
    .find((value) => value);

  if (Array.isArray(byWorkspace)) {
    return byWorkspace.find((entry) => workspaceIdForRecord(entry) === safeWorkspaceId) || direct;
  }

  if (byWorkspace && typeof byWorkspace === "object") {
    return byWorkspace[safeWorkspaceId] || byWorkspace[safeWorkspaceId.toLowerCase()] || direct;
  }

  return direct;
}

export function workspaceTodoItemsForDeviceWorkspace(workspaceTodos, selection = {}) {
  const safeSelection = selection && typeof selection === "object" ? selection : {};
  const workspaceId = normalizeWorkspaceId(safeSelection.workspaceId);
  const deviceId = normalizeTodoQueueSwitcherId(safeSelection.deviceId);
  if (!workspaceId || !deviceId) {
    return [];
  }
  const selectionDeviceAliases = new Set(uniqueDeviceAliases(safeSelection.deviceAliases, deviceId));
  const todoCollection = collectionForWorkspace(
    workspaceTodos,
    workspaceId,
    ["items", "todos"],
    ["itemsByWorkspace", "items_by_workspace", "todosByWorkspace", "todos_by_workspace"],
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
    const itemWorkspaceId = workspaceIdForRecord(item, workspaceId);
    if (itemWorkspaceId && itemWorkspaceId !== workspaceId) {
      return false;
    }
    const itemDeviceId = normalizeTodoQueueSwitcherId(readFirstKey(item, [
      "sourceDeviceId",
      "source_device_id",
      "deviceId",
      "device_id",
      "machineId",
      "machine_id",
      "todoDeviceId",
      "todo_device_id",
    ]));
    if (!selectionDeviceAliases.has(itemDeviceId)) {
      return false;
    }
    const status = String(item.todoStatus || item.todo_status || item.status || item.state || "")
      .trim()
      .toLowerCase();
    return !["deleted", "removed", "tombstoned", "archived"].includes(status);
  });
}

function workspaceTodoItemsForGraph(workspaceTodos, device, workspace) {
  const workspaceId = normalizeWorkspaceId(workspace?.id || workspace?.workspaceId);
  if (!workspaceId) {
    return [];
  }
  const deviceId = normalizeTodoQueueSwitcherId(device?.deviceId);
  const deviceAliases = new Set(uniqueDeviceAliases(device?.deviceAliases, deviceId));
  const deviceScopedItems = workspaceTodoItemsForDeviceWorkspace(workspaceTodos, {
    deviceAliases: Array.from(deviceAliases),
    deviceId,
    workspaceId,
  });
  if (deviceScopedItems.length) {
    return deviceScopedItems;
  }

  const todoCollection = collectionForWorkspace(
    workspaceTodos,
    workspaceId,
    ["items", "todos"],
    ["itemsByWorkspace", "items_by_workspace", "todosByWorkspace", "todos_by_workspace"],
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
    const itemWorkspaceId = workspaceIdForRecord(item, workspaceId);
    if (itemWorkspaceId && itemWorkspaceId !== workspaceId) {
      return false;
    }
    const itemDeviceId = normalizeTodoQueueSwitcherId(readFirstKey(item, [
      "sourceDeviceId",
      "source_device_id",
      "deviceId",
      "device_id",
      "machineId",
      "machine_id",
      "todoDeviceId",
      "todo_device_id",
    ]));
    if (itemDeviceId && !deviceAliases.has(itemDeviceId)) {
      return false;
    }
    const status = normalizedGraphStatus(item.todoStatus || item.todo_status || item.status || item.state);
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
    || (workspace?.workspaceActive ? "active" : "idle");
  const todoItems = workspaceTodoItemsForGraph(workspaceTodos, device, workspace);
  const terminalCount = Number(workspace?.terminalCount) || 0;
  const serverCount = Number(workspace?.serverCount) || 0;
  const mcpCount = Number(workspace?.mcpCount) || 0;
  const toolCount = serverCount + mcpCount;
  const id = normalizeWorkspaceId(workspace?.id || workspace?.workspaceId);
  return {
    id,
    isCurrentWorkspace: Boolean(workspace?.isCurrentWorkspace),
    name: firstText(workspace?.name, workspace?.workspaceName, id, "Workspace"),
    mcpCount,
    mcpStatusCounts: workspace?.mcpStatusCounts || {},
    serverCount,
    serverStatusCounts: workspace?.serverStatusCounts || {},
    status,
    terminalCount,
    terminalStatusCounts: workspace?.terminalStatusCounts || {},
    todoCount: todoItems.length,
    toolCount,
    workspaceActive: Boolean(workspace?.workspaceActive || status === "active"),
  };
}

function accountNameFromDeviceLiveState(deviceLiveState) {
  const { root, snapshotRoot } = liveStateSnapshotRoot(deviceLiveState);
  return firstText(
    snapshotRoot.accountName,
    snapshotRoot.account_name,
    snapshotRoot.organizationName,
    snapshotRoot.organization_name,
    snapshotRoot.teamName,
    snapshotRoot.team_name,
    root.accountName,
    root.account_name,
    root.organizationName,
    root.organization_name,
    root.teamName,
    root.team_name,
    "Account",
  );
}

export function buildDevicesGraphModel({
  connectedDevices = [],
  deviceLiveState = null,
  knownDevices = [],
  localProfile = null,
  workspaceTodos = null,
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
      deviceAliases: uniqueDeviceAliases(device.deviceAliases, device.deviceId),
      deviceId: device.deviceId || `device-${index}`,
      deviceKind: device.deviceKind || TODO_QUEUE_DEVICE_KIND_UNKNOWN,
      deviceName: device.deviceName || `Device ${index + 1}`,
      formFactorLabel: device.formFactorLabel || "",
      isLocal: Boolean(device.isLocal),
      liveState,
      nativeConnected: device.nativeConnected === true,
      platformLabel: device.platformLabel || "",
      registered: Boolean(device.registered),
      serverSeen: Boolean(device.serverSeen),
      todoCount: workspaces.reduce((total, workspace) => total + workspace.todoCount, 0),
      toolCount: workspaces.reduce((total, workspace) => total + workspace.toolCount, 0),
      terminalCount: workspaces.reduce((total, workspace) => total + workspace.terminalCount, 0),
      webConnected: device.webConnected === true,
      workspaceCount: workspaces.length,
      workspaces,
    };
  });

  const totals = devices.reduce((summary, device) => ({
    deviceCount: summary.deviceCount + 1,
    liveDeviceCount: summary.liveDeviceCount + (device.liveState === "live" ? 1 : 0),
    workspaceCount: summary.workspaceCount + device.workspaceCount,
    activeWorkspaceCount: summary.activeWorkspaceCount + device.workspaces.filter((workspace) => workspace.status === "active").length,
    syncingWorkspaceCount: summary.syncingWorkspaceCount + device.workspaces.filter((workspace) => workspace.status === "syncing").length,
    todoCount: summary.todoCount + device.todoCount,
    terminalCount: summary.terminalCount + device.terminalCount,
    toolCount: summary.toolCount + device.toolCount,
  }), {
    activeWorkspaceCount: 0,
    deviceCount: 0,
    liveDeviceCount: 0,
    syncingWorkspaceCount: 0,
    terminalCount: 0,
    todoCount: 0,
    toolCount: 0,
    workspaceCount: 0,
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

export function todoQueueDeviceSelectionIsLocalEditable(selection, currentWorkspaceId = "") {
  const selectionWorkspaceId = normalizeWorkspaceId(selection?.workspaceId);
  const safeCurrentWorkspaceId = normalizeWorkspaceId(currentWorkspaceId);
  return Boolean(
    selection?.isLocal
      && selection.deviceKind === TODO_QUEUE_DEVICE_KIND_DESKTOP
      && selectionWorkspaceId
      && safeCurrentWorkspaceId
      && selectionWorkspaceId === safeCurrentWorkspaceId,
  );
}

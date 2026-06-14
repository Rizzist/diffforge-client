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
  "serverRoster",
  "server_roster",
  "accountDeviceServerRoster",
  "account_device_server_roster",
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
  return source.includes("web") || source.includes("browser") || source.includes("next-dashboard");
}

function nativeConnectedForRecord(record, inherited = null) {
  const nativeSurface = surfaceRecordFor(record, "native");
  const explicit = boolFromKeys(record, NATIVE_CONNECTED_KEYS)
    ?? boolFromKeys(nativeSurface, ["connected", "active", "online", "open", "status", "state"]);
  if (explicit !== null) {
    return explicit;
  }
  const generic = boolFromKeys(record, ["connected", "online", "live", "active", "status", "state"]);
  if (generic !== null && !recordLooksWebOnly(record)) {
    return generic;
  }
  return inherited?.nativeConnected ?? null;
}

function webConnectedForRecord(record, inherited = null) {
  const web = webPresenceForRecord(record);
  const webSurface = surfaceRecordFor(record, "web");
  return boolFromKeys(record, WEB_CONNECTED_KEYS)
    ?? boolFromKeys(web, ["connected", "active", "online", "open", "status", "state"])
    ?? boolFromKeys(webSurface, ["connected", "active", "online", "open", "status", "state"])
    ?? inherited?.webConnected
    ?? null;
}

function liveStateFromSurfaces(nativeConnected, webConnected, explicitConnected, fallback = "unknown") {
  if (nativeConnected === true || webConnected === true || explicitConnected === true) {
    return "live";
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
  if (left === true || right === true) return true;
  if (right === false) return false;
  if (left === false) return false;
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
  const explicitConnected = normalizeLiveBoolean(readFirstKey(record, LIVE_STATE_PRESENT_KEYS));
  const nativeConnected = nativeConnectedForRecord(record, inherited);
  const webConnected = webConnectedForRecord(record, inherited);
  const connected = mergeNullableBooleans(
    mergeNullableBooleans(nativeConnected, webConnected),
    explicitConnected,
  );
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
    serverSeen: Boolean(options.serverSeen || inherited?.serverSeen),
    webConnected,
  };
}

function mergeDevice(previous, next) {
  if (!previous) {
    return {
      ...next,
      deviceAliases: uniqueDeviceAliases(next?.deviceAliases, next?.deviceId),
    };
  }
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
  const nativeConnected = mergeNullableBooleans(previous.nativeConnected, next.nativeConnected);
  const webConnected = mergeNullableBooleans(previous.webConnected, next.webConnected);
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
    deviceKind: previous.deviceKind === TODO_QUEUE_DEVICE_KIND_DESKTOP || previous.isLocal
      ? previous.deviceKind
      : next.deviceKind || previous.deviceKind,
    deviceName: !preferNextName
      ? previous.deviceName
      : next.deviceName,
    formFactorLabel: previous.formFactorLabel || next.formFactorLabel || "",
    isLocal: Boolean(previous.isLocal || next.isLocal),
    liveState,
    nativeConnected,
    platformIcon: previous.platformIcon || next.platformIcon || "",
    platformLabel: previous.platformLabel || next.platformLabel || "",
    serverSeen: Boolean(previous.serverSeen || next.serverSeen),
    webConnected,
  };
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
  const merged = mergeDevice(previous, {
    ...device,
    deviceAliases,
    deviceId,
  });
  devicesById.set(deviceId, {
    ...merged,
    deviceAliases: uniqueDeviceAliases(merged.deviceAliases, deviceAliases, device.deviceId, deviceId),
    deviceId,
  });
  return deviceId;
}

function canonicalDeviceIdFor(devicesById, entry) {
  const aliases = uniqueDeviceAliases(
    entry?.deviceAliases,
    deviceAliasesForRecord(entry, entry?.deviceId),
    entry?.deviceId,
  );
  return findDeviceKeyByAliases(devicesById, aliases) || normalizeTodoQueueSwitcherId(entry?.deviceId);
}

function collectLiveStateEntries(value, result, inheritedDevice = null, depth = 0) {
  if (!value || depth > 5) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectLiveStateEntries(item, result, inheritedDevice, depth + 1));
    return;
  }
  if (typeof value !== "object") {
    return;
  }

  const ownDevice = normalizeDeviceRecord(value, result.devices.length, {
    inherited: inheritedDevice,
    serverSeen: true,
  });
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
    });
  }

  LIVE_STATE_CONTAINER_KEYS.forEach((key) => {
    if (value[key] !== undefined && value[key] !== value) {
      collectLiveStateEntries(value[key], result, currentDevice, depth + 1);
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
  liveEntries.devices.forEach((device) => {
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
  const workspaceId = normalizeWorkspaceId(selection.workspaceId);
  const deviceId = normalizeTodoQueueSwitcherId(selection.deviceId);
  if (!workspaceId || !deviceId) {
    return [];
  }
  const selectionDeviceAliases = new Set(uniqueDeviceAliases(selection.deviceAliases, deviceId));
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

export function todoQueueDeviceSelectionIsLocalEditable(selection, currentWorkspaceId = "") {
  return Boolean(
    selection?.isLocal
      && selection.deviceKind === TODO_QUEUE_DEVICE_KIND_DESKTOP
      && normalizeWorkspaceId(selection.workspaceId) === normalizeWorkspaceId(currentWorkspaceId),
  );
}

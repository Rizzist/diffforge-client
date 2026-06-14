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
  return {
    connected: normalizeLiveBoolean(readFirstKey(record, LIVE_STATE_PRESENT_KEYS)),
    deviceId,
    deviceKind: kind,
    deviceName: deviceNameForRecord(record, index) || inherited?.deviceName || "Device",
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
    liveState: liveStateForRecord(record, inherited?.liveState || "unknown"),
    platformLabel: firstText(
      record.platformLabel,
      record.platform_label,
      record.platform,
      record.os,
      inherited?.platformLabel,
    ),
  };
}

function mergeDevice(previous, next) {
  if (!previous) {
    return next;
  }
  const preferNextName = !previous.isLocal && next.deviceName && !/^device \d+$/i.test(next.deviceName);
  return {
    ...previous,
    ...next,
    connected: next.connected ?? previous.connected ?? null,
    deviceKind: previous.deviceKind === TODO_QUEUE_DEVICE_KIND_DESKTOP || previous.isLocal
      ? previous.deviceKind
      : next.deviceKind || previous.deviceKind,
    deviceName: previous.isLocal || !preferNextName
      ? previous.deviceName
      : next.deviceName,
    formFactorLabel: previous.formFactorLabel || next.formFactorLabel || "",
    isLocal: Boolean(previous.isLocal || next.isLocal),
    liveState: next.liveState !== "unknown" ? next.liveState : previous.liveState || "unknown",
    platformLabel: previous.platformLabel || next.platformLabel || "",
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

  const ownDevice = normalizeDeviceRecord(value, result.devices.length, { inherited: inheritedDevice });
  const currentDevice = ownDevice || inheritedDevice;
  if (ownDevice) {
    result.devices.push(ownDevice);
  }

  const workspaceId = workspaceIdForRecord(value);
  if (workspaceId && currentDevice?.deviceId) {
    result.workspaces.push({
      deviceId: currentDevice.deviceId,
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

  const localDevice = normalizeDeviceRecord(localProfile || {}, 0, {
    isLocal: true,
    kind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
  }) || {
    connected: null,
    deviceId: "local-device",
    deviceKind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
    deviceName: "This device",
    formFactorLabel: "Desktop",
    isLocal: true,
    liveState: "unknown",
    platformLabel: "",
  };
  devicesById.set(localDevice.deviceId, localDevice);
  if (safeCurrentWorkspaceId) {
    addWorkspace(workspacesByDevice, {
      deviceId: localDevice.deviceId,
      deviceKind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
      deviceName: localDevice.deviceName,
      isCurrentWorkspace: true,
      isLocal: true,
      workspaceId: safeCurrentWorkspaceId,
      workspaceName: safeCurrentWorkspaceName,
    });
  }

  [...knownDevices, ...connectedDevices].forEach((device, index) => {
    const normalized = normalizeDeviceRecord(device, index);
    if (!normalized) {
      return;
    }
    devicesById.set(normalized.deviceId, mergeDevice(devicesById.get(normalized.deviceId), normalized));
  });

  const liveEntries = { devices: [], workspaces: [] };
  collectLiveStateEntries(deviceLiveState, liveEntries);
  liveEntries.devices.forEach((device) => {
    devicesById.set(device.deviceId, mergeDevice(devicesById.get(device.deviceId), device));
  });
  liveEntries.workspaces.forEach((workspace) => addWorkspace(workspacesByDevice, workspace));

  const todoWorkspaceEntries = [];
  collectWorkspaceTodoOptionEntries(workspaceTodos, todoWorkspaceEntries);
  todoWorkspaceEntries.forEach((workspace) => {
    const normalizedDevice = normalizeDeviceRecord(workspace, devicesById.size);
    if (normalizedDevice) {
      devicesById.set(normalizedDevice.deviceId, mergeDevice(devicesById.get(normalizedDevice.deviceId), normalizedDevice));
    }
    addWorkspace(workspacesByDevice, workspace);
  });

  const mergedLocalDevice = mergeDevice(localDevice, devicesById.get(localDevice.deviceId) || localDevice);
  devicesById.set(localDevice.deviceId, {
    ...mergedLocalDevice,
    isLocal: true,
    deviceKind: TODO_QUEUE_DEVICE_KIND_DESKTOP,
  });

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
      liveState: device.liveState || "unknown",
      platformLabel: device.platformLabel || "",
      workspaceId,
      workspaceName: workspace?.workspaceName || "",
    };
    if (!options.some((candidate) => candidate.id === option.id)) {
      options.push(option);
    }
  };

  const localWorkspace = workspaceEntriesByDevice.get(localDevice.deviceId)
    ?.find((workspace) => workspace.workspaceId === safeCurrentWorkspaceId)
    || (safeCurrentWorkspaceId ? {
      workspaceId: safeCurrentWorkspaceId,
      workspaceName: safeCurrentWorkspaceName,
    } : null);
  addOption(devicesById.get(localDevice.deviceId), localWorkspace, { isCurrentWorkspace: true });

  const sortedDevices = Array.from(devicesById.values())
    .filter((device) => device.deviceId !== localDevice.deviceId)
    .sort((a, b) => String(a.deviceName).localeCompare(String(b.deviceName)));

  const localOtherWorkspaces = (workspaceEntriesByDevice.get(localDevice.deviceId) || [])
    .filter((workspace) => workspace.workspaceId !== safeCurrentWorkspaceId)
    .sort(sortWorkspaceEntries);
  localOtherWorkspaces.forEach((workspace) => {
    addOption(devicesById.get(localDevice.deviceId), workspace, { isCurrentWorkspace: false });
  });

  sortedDevices.forEach((device) => {
    const workspaces = (workspaceEntriesByDevice.get(device.deviceId) || []).sort(sortWorkspaceEntries);
    if (device.deviceKind === TODO_QUEUE_DEVICE_KIND_MOBILE || !workspaces.length) {
      addOption(device);
      return;
    }
    workspaces.forEach((workspace) => addOption(device, workspace));
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
    if (itemDeviceId !== deviceId) {
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

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled, { createGlobalStyle, keyframes } from "styled-components";

export const ACTIVITY_OVERLAY_HASH = "#/activity-overlay";

const CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT = "cloud-mcp-workspace-todos-updated";
const CLOUD_MCP_WORKSPACE_ASSETS_UPDATED_EVENT = "cloud-mcp-workspace-assets-updated";
const WORKSPACE_MCP_BACKGROUND_JOB_EVENT = "workspace-mcp-background-job";
const WORKSPACE_NOTIFICATION_EVENT = "diffforge:workspace-notification-event";
const TERMINAL_TODO_PLAN_UPDATED_EVENT = "forge-terminal-todo-plan-updated";
const TERMINAL_ACTIVITY_HOOK_EVENT = "forge-terminal-activity-hook";
const AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT = "forge-audio-model-download-progress";

const REFRESH_INTERVAL_MS = 4500;
const REFRESH_DEBOUNCE_MS = 180;
const LIVE_EVENT_LIMIT = 36;
const CARD_LIMIT = 8;

function runOverlayWindowAction(action) {
  try {
    Promise.resolve(action(getCurrentWindow())).catch(() => {});
  } catch {
    // Native overlay chrome is best-effort.
  }
}

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
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

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function dataValue(value) {
  const object = jsonObject(value);
  const data = jsonObject(object?.data);
  return data || object || {};
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(numberValue(value, 0))));
}

function firstText(...values) {
  for (const value of values) {
    const normalized = text(value);
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function shortText(value, maxLength = 86) {
  const raw = text(value);
  if (raw.length <= maxLength) {
    return raw;
  }
  if (maxLength <= 3) {
    return raw.slice(0, maxLength);
  }
  return `${raw.slice(0, maxLength - 3)}...`;
}

function timestampMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) {
      return 0;
    }
    if (value > 999999999999) {
      return value;
    }
    if (value > 999999999) {
      return value * 1000;
    }
  }
  const raw = text(value);
  if (!raw || raw === "0") {
    return 0;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recentTimestamp(...values) {
  return values.map(timestampMs).filter(Boolean).sort((left, right) => right - left)[0] || 0;
}

function timeAgo(value) {
  const at = timestampMs(value);
  if (!at) {
    return "just now";
  }
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 5) {
    return "now";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.round(hours / 24)}d`;
}

function formatBytes(value) {
  const bytes = numberValue(value, 0);
  if (!bytes) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const decimals = amount >= 100 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(decimals)} ${units[unitIndex]}`;
}

function statusKey(value, fallback = "active") {
  const normalized = text(value, fallback)
    .toLowerCase()
    .replace(/[_\s]+/gu, "-");
  if (["complete", "completed", "done", "success", "succeeded", "accepted", "merged", "synced", "ready"].includes(normalized)) {
    return "done";
  }
  if (["running", "active", "processing", "submitting", "validating", "syncing", "uploading", "downloading", "transferring", "checking", "diffing", "applying", "sending", "started", "in-flight", "in-progress"].includes(normalized)) {
    return "active";
  }
  if (["queued", "pending", "requested", "prepared", "preparing", "waiting"].includes(normalized)) {
    return "queued";
  }
  if (["paused", "parked", "resume-ready", "resume-requested", "needs-input", "awaiting-input"].includes(normalized)) {
    return "paused";
  }
  if (["failed", "failure", "error", "blocked", "rejected", "conflict", "violated", "needs-attention"].includes(normalized)) {
    return "failed";
  }
  if (["cancelled", "canceled", "interrupted", "aborted", "timed-out", "timeout", "expired"].includes(normalized)) {
    return "stopped";
  }
  return normalized || fallback;
}

function statusTone(status) {
  const key = statusKey(status);
  if (key === "done") {
    return "good";
  }
  if (key === "failed") {
    return "danger";
  }
  if (key === "paused" || key === "queued") {
    return "warn";
  }
  if (key === "stopped") {
    return "muted";
  }
  return "hot";
}

function statusProgress(status, fallback = 42) {
  const key = statusKey(status);
  if (key === "done") {
    return 100;
  }
  if (key === "queued") {
    return 22;
  }
  if (key === "paused") {
    return 48;
  }
  if (key === "failed" || key === "stopped") {
    return 100;
  }
  return fallback;
}

function workspaceTodosFromStatus(status) {
  const data = dataValue(status);
  const liveRuntime = jsonObject(data.liveRuntimeStatus || data.live_runtime_status) || {};
  return jsonObject(
    data.workspaceTodos
      || data.workspace_todos
      || liveRuntime.workspaceTodos
      || liveRuntime.workspace_todos,
  ) || {};
}

function knownDevicesFromStatus(status) {
  const data = dataValue(status);
  const liveRuntime = jsonObject(data.liveRuntimeStatus || data.live_runtime_status) || {};
  const candidates = [
    ...jsonArray(data.connectedDevices),
    ...jsonArray(data.connected_devices),
    ...jsonArray(data.knownDevices),
    ...jsonArray(data.known_devices),
    ...jsonArray(liveRuntime.connectedDevices),
    ...jsonArray(liveRuntime.connected_devices),
    ...jsonArray(liveRuntime.knownDevices),
    ...jsonArray(liveRuntime.known_devices),
  ];
  const byId = new Map();
  candidates.forEach((candidate, index) => {
    const item = jsonObject(candidate);
    if (!item) {
      return;
    }
    const id = firstText(
      item.deviceId,
      item.device_id,
      item.clientId,
      item.client_id,
      item.id,
      `device-${index}`,
    );
    const name = firstText(
      item.displayName,
      item.display_name,
      item.deviceName,
      item.device_name,
      item.machineName,
      item.machine_name,
      id,
    );
    byId.set(id, {
      id,
      name,
      status: statusKey(item.status || item.connectionStatus || item.connection_status, "active"),
    });
  });
  return Array.from(byId.values());
}

function deviceNameFromMap(deviceMap, id, fallback = "") {
  const safeId = text(id);
  if (!safeId) {
    return fallback;
  }
  return deviceMap.get(safeId)?.name || fallback || safeId;
}

function collectionItems(collection) {
  if (Array.isArray(collection)) {
    return collection.filter(Boolean);
  }
  const object = jsonObject(collection);
  if (!object) {
    return [];
  }
  if (Array.isArray(object.items)) {
    return object.items.filter(Boolean);
  }
  if (Array.isArray(object.todos)) {
    return object.todos.filter(Boolean);
  }
  if (Array.isArray(object.dispatches)) {
    return object.dispatches.filter(Boolean);
  }
  return [];
}

function collectionsByWorkspace(collection) {
  if (Array.isArray(collection)) {
    return collection.flatMap((entry) => collectionItems(entry));
  }
  const object = jsonObject(collection);
  if (!object) {
    return [];
  }
  return Object.values(object).flatMap((entry) => collectionItems(entry));
}

function workspaceTodoCollection(workspaceTodos, directKeys, byWorkspaceKeys) {
  const direct = directKeys.flatMap((key) => collectionItems(workspaceTodos?.[key]));
  const byWorkspace = byWorkspaceKeys.flatMap((key) => collectionsByWorkspace(workspaceTodos?.[key]));
  return [...direct, ...byWorkspace];
}

function todoIdentity(item, fallback) {
  return firstText(
    item?.todoId,
    item?.todo_id,
    item?.id,
    item?.bodyHash,
    item?.body_hash,
    item?.todoBodyHash,
    item?.todo_body_hash,
    fallback,
  );
}

function todoTitle(item, fallback = "todo") {
  return shortText(
    firstText(
      item?.title,
      item?.summary,
      item?.body,
      item?.todoText,
      item?.todo_text,
      item?.text,
      item?.todoBodyPreview,
      item?.todo_body_preview,
      item?.textPreview,
      item?.text_preview,
      fallback,
    ),
    94,
  );
}

function todoWorkspaceLabel(item) {
  return firstText(
    item?.workspaceName,
    item?.workspace_name,
    item?.targetWorkspaceName,
    item?.target_workspace_name,
    item?.observerWorkspaceName,
    item?.observer_workspace_name,
    item?.gitRepoDisplayName,
    item?.git_repo_display_name,
    item?.repoName,
    item?.repo_name,
    item?.workspaceId,
    item?.workspace_id,
    item?.targetWorkspaceId,
    item?.target_workspace_id,
  );
}

function todoDeviceLabel(item, deviceMap) {
  const id = firstText(
    item?.deviceId,
    item?.device_id,
    item?.targetDeviceId,
    item?.target_device_id,
    item?.sourceDeviceId,
    item?.source_device_id,
    item?.machineId,
    item?.machine_id,
  );
  return firstText(
    item?.targetDeviceName,
    item?.target_device_name,
    item?.deviceName,
    item?.device_name,
    item?.sourceDeviceName,
    item?.source_device_name,
    item?.machineName,
    item?.machine_name,
    deviceNameFromMap(deviceMap, id, ""),
    id,
  );
}

function todoUpdatedAt(item) {
  return recentTimestamp(
    item?.updatedAt,
    item?.updated_at,
    item?.queuedAt,
    item?.queued_at,
    item?.createdAt,
    item?.created_at,
    item?.startedAt,
    item?.started_at,
  );
}

function uniqueCards(cards, limit = CARD_LIMIT) {
  const byId = new Map();
  cards.filter(Boolean).forEach((card, index) => {
    const id = firstText(card.id, `${card.lane || "card"}-${index}`);
    if (!byId.has(id)) {
      byId.set(id, { ...card, id });
    }
  });
  return Array.from(byId.values())
    .sort((left, right) => {
      const leftRank = statusKey(left.status) === "active" ? 2 : statusKey(left.status) === "queued" ? 1 : 0;
      const rightRank = statusKey(right.status) === "active" ? 2 : statusKey(right.status) === "queued" ? 1 : 0;
      if (leftRank !== rightRank) {
        return rightRank - leftRank;
      }
      return numberValue(right.updatedAt, 0) - numberValue(left.updatedAt, 0);
    })
    .slice(0, limit);
}

function normalizeTodoCards(status) {
  const workspaceTodos = workspaceTodosFromStatus(status);
  const deviceMap = new Map(knownDevicesFromStatus(status).map((device) => [device.id, device]));
  return uniqueCards(
    workspaceTodoCollection(
      workspaceTodos,
      ["items", "todos"],
      ["itemsByWorkspace", "items_by_workspace", "todosByWorkspace", "todos_by_workspace"],
    ).map((item, index) => {
      const object = jsonObject(item) || {};
      const status = statusKey(
        object.todoStatus
          || object.todo_status
          || object.status
          || object.state,
        "listed",
      );
      const device = todoDeviceLabel(object, deviceMap);
      const workspace = todoWorkspaceLabel(object);
      return {
        id: `todo-${todoIdentity(object, index)}`,
        detail: firstText(object.detail, object.description, object.preview, device && `on ${device}`),
        eyebrow: "working todo",
        lane: "todos",
        meta: [device, workspace].filter(Boolean).join(" / "),
        progress: statusProgress(status, status === "active" ? 66 : 36),
        status,
        title: todoTitle(object, "Queued todo"),
        tone: statusTone(status),
        updatedAt: todoUpdatedAt(object),
      };
    }),
  );
}

function normalizeRemoteCards(status) {
  const workspaceTodos = workspaceTodosFromStatus(status);
  const deviceMap = new Map(knownDevicesFromStatus(status).map((device) => [device.id, device]));
  const dispatches = workspaceTodoCollection(
    workspaceTodos,
    ["dispatches", "todoDispatches", "todo_dispatches"],
    ["dispatchesByWorkspace", "dispatches_by_workspace", "todoDispatchesByWorkspace", "todo_dispatches_by_workspace"],
  ).map((item, index) => {
    const object = jsonObject(item) || {};
    const targetDeviceId = firstText(object.targetDeviceId, object.target_device_id, object.deviceId, object.device_id);
    const targetDevice = firstText(
      object.targetDeviceName,
      object.target_device_name,
      deviceNameFromMap(deviceMap, targetDeviceId),
      targetDeviceId,
      "remote device",
    );
    const targetWorkspace = firstText(
      object.targetWorkspaceName,
      object.target_workspace_name,
      object.workspaceName,
      object.workspace_name,
      object.targetWorkspaceId,
      object.target_workspace_id,
      object.workspaceId,
      object.workspace_id,
    );
    const sourceDevice = firstText(object.sourceDeviceName, object.source_device_name, object.sourceDeviceId, object.source_device_id);
    const status = statusKey(object.status || object.dispatchStatus || object.dispatch_status || object.state, "queued");
    return {
      id: `dispatch-${todoIdentity(object, index)}`,
      detail: sourceDevice ? `from ${sourceDevice}` : firstText(object.detail, object.message, object.description),
      eyebrow: "remote todo",
      lane: "remote",
      meta: [targetDevice, targetWorkspace].filter(Boolean).join(" / "),
      progress: statusProgress(status, status === "active" ? 68 : 30),
      status,
      title: todoTitle(object, "Remote todo dispatch"),
      tone: statusTone(status),
      updatedAt: todoUpdatedAt(object),
    };
  });
  const peerActivity = workspaceTodoCollection(
    workspaceTodos,
    ["peerActivity", "peer_activity"],
    ["peerActivityByWorkspace", "peer_activity_by_workspace", "workspacePeerActivity", "workspace_peer_activity"],
  ).map((item, index) => {
    const object = jsonObject(item) || {};
    const device = todoDeviceLabel(object, deviceMap) || firstText(object.peerDeviceName, object.peer_device_name, "remote device");
    const workspace = todoWorkspaceLabel(object);
    const status = statusKey(object.status || object.activityStatus || object.activity_status || object.state, "active");
    return {
      id: `peer-${firstText(object.id, object.activityId, object.activity_id, device, index)}`,
      detail: firstText(object.detail, object.message, object.description, object.lastAction, object.last_action),
      eyebrow: "remote activity",
      lane: "remote",
      meta: [device, workspace].filter(Boolean).join(" / "),
      progress: statusProgress(status, 72),
      status,
      title: shortText(firstText(object.title, object.summary, object.todoTitle, object.todo_title, "Remote todo activity"), 88),
      tone: statusTone(status),
      updatedAt: todoUpdatedAt(object),
    };
  });
  return uniqueCards([...dispatches, ...peerActivity]);
}

function allCoordinationSnapshots(snapshot) {
  const data = dataValue(snapshot);
  const targets = jsonArray(data.targets);
  if (!targets.length) {
    return [data];
  }
  return targets.map((target) => dataValue(target?.snapshot || target?.data || target)).filter(Boolean);
}

function coordinationItemTime(item) {
  return recentTimestamp(item?.updated_at, item?.updatedAt, item?.created_at, item?.createdAt, item?.timestamp);
}

function parseCoordinationPayload(item) {
  return jsonObject(item?.payload) || jsonObject(item?.data) || {};
}

function coordinationCommandName(item) {
  const payload = parseCoordinationPayload(item);
  return firstText(
    item?.command_name,
    item?.commandName,
    item?.tool_name,
    item?.toolName,
    payload.command_name,
    payload.commandName,
    payload.tool_name,
    payload.toolName,
  );
}

function normalizeCoordinationCards(snapshot, liveEvents) {
  const snapshots = allCoordinationSnapshots(snapshot);
  const cards = [];
  snapshots.forEach((itemSet) => {
    jsonArray(itemSet.active_leases).forEach((lease, index) => {
      const status = statusKey(lease.status || "active");
      cards.push({
        id: `lease-${firstText(lease.id, lease.resource_key, lease.resourceKey, index)}`,
        detail: firstText(lease.task_id, lease.taskId, lease.agent_id, lease.agentId),
        eyebrow: "lease",
        lane: "sync",
        meta: firstText(lease.resource_key, lease.resourceKey, "resource lease"),
        progress: statusProgress(status, 64),
        status,
        title: "File lease active",
        tone: statusTone(status),
        updatedAt: coordinationItemTime(lease),
      });
    });
    jsonArray(itemSet.resource_queues).forEach((queue, index) => {
      const queued = numberValue(queue.queued_count ?? queue.queuedCount, 0);
      const active = numberValue(queue.active_count ?? queue.activeCount, 0);
      if (queued <= 0 && active <= 0) {
        return;
      }
      const status = queued > 0 ? "queued" : "active";
      cards.push({
        id: `queue-${firstText(queue.resource_key, queue.resourceKey, index)}`,
        detail: queued > 0 ? `${queued} waiting / ${active} active` : `${active} active`,
        eyebrow: "task queue",
        lane: "sync",
        meta: firstText(queue.resource_key, queue.resourceKey, "resource queue"),
        progress: queued > 0 ? 30 : 58,
        status,
        title: "Lease queue",
        tone: statusTone(status),
        updatedAt: coordinationItemTime(queue),
      });
    });
    jsonArray(itemSet.submit_jobs).forEach((job, index) => {
      const status = statusKey(job.status || job.phase || "active");
      cards.push({
        id: `submit-${firstText(job.id, job.submit_job_id, job.submitJobId, index)}`,
        detail: firstText(job.phase_message, job.phaseMessage, job.message, job.task_id, job.taskId),
        eyebrow: "submit patch",
        lane: "sync",
        meta: firstText(job.phase, job.status, "submit"),
        progress: statusProgress(status, status === "active" ? 74 : 44),
        status,
        title: "Patch submit",
        tone: statusTone(status),
        updatedAt: coordinationItemTime(job),
      });
    });
    jsonArray(itemSet.patch_validations).forEach((validation, index) => {
      const status = statusKey(validation.status || validation.result || "active");
      cards.push({
        id: `validation-${firstText(validation.id, validation.patch_id, validation.patchId, index)}`,
        detail: firstText(validation.message, validation.error, validation.patch_id, validation.patchId),
        eyebrow: "validation",
        lane: "sync",
        meta: firstText(validation.status, validation.result, "validation"),
        progress: statusProgress(status, 86),
        status,
        title: "Patch validation",
        tone: statusTone(status),
        updatedAt: coordinationItemTime(validation),
      });
    });
    jsonArray(itemSet.merge_jobs).forEach((job, index) => {
      const status = statusKey(job.status || job.phase || "active");
      cards.push({
        id: `merge-${firstText(job.id, job.patch_id, job.patchId, index)}`,
        detail: firstText(job.message, job.phase_message, job.phaseMessage, job.patch_id, job.patchId),
        eyebrow: "integration",
        lane: "sync",
        meta: firstText(job.phase, job.status, "merge"),
        progress: statusProgress(status, 78),
        status,
        title: "Local integration",
        tone: statusTone(status),
        updatedAt: coordinationItemTime(job),
      });
    });
    jsonArray(itemSet.events).slice(0, 48).forEach((event, index) => {
      const eventType = text(event.event_type || event.eventType || event.type).toLowerCase();
      const command = coordinationCommandName(event);
      const important = [
        "start_task",
        "create_plan",
        "acquire_lease",
        "checkpoint",
        "submit_patch",
        "submit_patch_status",
      ].some((name) => eventType.includes(name) || command === name);
      if (!important) {
        return;
      }
      const label = command || eventType.replace(/^mcp_/u, "").replace(/_/gu, " ");
      cards.push({
        id: `event-${firstText(event.id, event.seq, index)}`,
        detail: firstText(event.message, event.summary, event.task_id, event.taskId),
        eyebrow: "background sync",
        lane: "sync",
        meta: label,
        progress: label.includes("submit") ? 70 : label.includes("checkpoint") ? 54 : 42,
        status: "active",
        title: shortText(label || "MCP activity", 64),
        tone: "hot",
        updatedAt: coordinationItemTime(event),
      });
    });
  });

  liveEvents.forEach((event) => {
    if (!["job", "notification", "terminal"].includes(event.kind)) {
      return;
    }
    const payload = jsonObject(event.payload) || {};
    const command = firstText(payload.command_name, payload.commandName, payload.tool_name, payload.toolName, payload.kind, payload.type);
    const status = statusKey(payload.status || payload.phase || "active");
    cards.push({
      id: `live-${event.id}`,
      detail: firstText(payload.message, payload.summary, payload.detail, payload.title),
      eyebrow: event.kind === "terminal" ? "terminal activity" : "background sync",
      lane: "sync",
      meta: command || event.label,
      progress: statusProgress(status, 62),
      status,
      title: shortText(firstText(payload.title, command, event.label, "Background job"), 70),
      tone: statusTone(status),
      updatedAt: event.at,
    });
  });

  return uniqueCards(cards);
}

function assetLibraryTransfers(value) {
  const data = dataValue(value);
  return jsonArray(data.transfers);
}

function assetItemsById(value) {
  const data = dataValue(value);
  const byId = new Map();
  [...jsonArray(data.items), ...jsonArray(data.assets)].forEach((asset) => {
    const object = jsonObject(asset);
    const id = firstText(object?.assetId, object?.asset_id, object?.id);
    if (object && id) {
      byId.set(id, object);
    }
  });
  return byId;
}

function transferPercent(transfer) {
  const total = numberValue(
    transfer?.bytesTotal
      ?? transfer?.bytes_total
      ?? transfer?.totalBytes
      ?? transfer?.total_bytes
      ?? transfer?.contentLength
      ?? transfer?.content_length,
    0,
  );
  const done = numberValue(
    transfer?.bytesDone
      ?? transfer?.bytes_done
      ?? transfer?.uploadedBytes
      ?? transfer?.uploaded_bytes
      ?? transfer?.downloadedBytes
      ?? transfer?.downloaded_bytes
      ?? transfer?.transferredBytes
      ?? transfer?.transferred_bytes,
    0,
  );
  const explicit = transfer?.percent ?? transfer?.progressPercent ?? transfer?.progress_percent;
  if (Number.isFinite(Number(explicit))) {
    return clampPercent(explicit);
  }
  if (!total) {
    return statusProgress(transfer?.status || transfer?.transferStatus || transfer?.transfer_status, 46);
  }
  return clampPercent((done / total) * 100);
}

function transferSizeMeta(transfer) {
  const total = numberValue(transfer?.bytesTotal ?? transfer?.bytes_total ?? transfer?.totalBytes ?? transfer?.total_bytes, 0);
  const done = numberValue(transfer?.bytesDone ?? transfer?.bytes_done ?? transfer?.uploadedBytes ?? transfer?.uploaded_bytes ?? transfer?.downloadedBytes ?? transfer?.downloaded_bytes, 0);
  if (done && total) {
    return `${formatBytes(done)} / ${formatBytes(total)}`;
  }
  if (total) {
    return formatBytes(total);
  }
  if (done) {
    return formatBytes(done);
  }
  return "";
}

function transferDeviceLabel(transfer) {
  const device = jsonObject(transfer?.device) || {};
  return firstText(
    device.displayName,
    device.display_name,
    device.deviceName,
    device.device_name,
    transfer?.deviceName,
    transfer?.device_name,
    device.machineName,
    device.machine_name,
    transfer?.machineName,
    transfer?.machine_name,
    device.deviceId,
    device.device_id,
    transfer?.deviceId,
    transfer?.device_id,
    "device",
  );
}

function transferTitle(transfer, asset) {
  return shortText(firstText(
    asset?.name,
    asset?.filename,
    asset?.fileName,
    asset?.file_name,
    transfer?.assetName,
    transfer?.asset_name,
    transfer?.filename,
    transfer?.fileName,
    transfer?.file_name,
    transfer?.assetId,
    transfer?.asset_id,
    "workspace item",
  ), 84);
}

function normalizeAudioProgress(progress) {
  const payload = jsonObject(progress);
  if (!payload) {
    return null;
  }
  const status = statusKey(payload.status || payload.phase || "downloading");
  const percent = transferPercent(payload);
  return {
    id: "audio-model-download",
    detail: firstText(payload.message, payload.detail, "local transcription model"),
    eyebrow: "download",
    lane: "transfers",
    meta: firstText(transferSizeMeta(payload), payload.phase, payload.status, "audio model"),
    progress: percent,
    status,
    title: "Whisper model",
    tone: statusTone(status),
    updatedAt: Date.now(),
  };
}

function normalizeTransferCards(library, audioProgress, liveEvents) {
  const assets = assetItemsById(library);
  const cards = assetLibraryTransfers(library).map((transfer, index) => {
    const object = jsonObject(transfer) || {};
    const assetId = firstText(object.assetId, object.asset_id);
    const asset = assets.get(assetId) || {};
    const direction = text(object.direction, "sync").toLowerCase();
    const status = statusKey(object.status || object.transferStatus || object.transfer_status, "active");
    return {
      id: `transfer-${firstText(object.transferId, object.transfer_id, object.id, index)}`,
      detail: transferDeviceLabel(object),
      eyebrow: direction === "download" || direction === "downloading" ? "download" : direction === "upload" || direction === "uploading" ? "upload" : "transfer",
      lane: "transfers",
      meta: firstText(transferSizeMeta(object), object.status, direction),
      progress: transferPercent(object),
      status,
      title: transferTitle(object, asset),
      tone: statusTone(status),
      updatedAt: recentTimestamp(object.updatedAt, object.updated_at, object.createdAt, object.created_at),
    };
  });
  const audioCard = normalizeAudioProgress(audioProgress);
  if (audioCard) {
    cards.push(audioCard);
  }
  liveEvents.forEach((event) => {
    if (event.kind !== "asset") {
      return;
    }
    const payload = jsonObject(event.payload) || {};
    const workspaceAssets = jsonObject(payload.workspaceAssets || payload.workspace_assets) || payload;
    assetLibraryTransfers(workspaceAssets).forEach((transfer, index) => {
      const object = jsonObject(transfer) || {};
      const status = statusKey(object.status || object.transferStatus || object.transfer_status, "active");
      cards.push({
        id: `asset-live-${event.id}-${index}`,
        detail: transferDeviceLabel(object),
        eyebrow: text(object.direction, "transfer"),
        lane: "transfers",
        meta: firstText(transferSizeMeta(object), object.status, object.direction),
        progress: transferPercent(object),
        status,
        title: transferTitle(object, {}),
        tone: statusTone(status),
        updatedAt: event.at,
      });
    });
  });
  return uniqueCards(cards);
}

function liveEventLabel(kind, payload) {
  const object = jsonObject(payload) || {};
  if (kind === "asset") {
    return "asset transfer";
  }
  if (kind === "todo") {
    return "workspace todo";
  }
  if (kind === "job") {
    return "background job";
  }
  if (kind === "terminal") {
    return "terminal activity";
  }
  return firstText(object.type, object.kind, kind, "event");
}

function summaryStats(todoCards, remoteCards, syncCards, transferCards) {
  const cards = [...todoCards, ...remoteCards, ...syncCards, ...transferCards];
  const active = cards.filter((card) => statusKey(card.status) === "active").length;
  const queued = cards.filter((card) => statusKey(card.status) === "queued" || statusKey(card.status) === "paused").length;
  const failed = cards.filter((card) => statusKey(card.status) === "failed").length;
  const transfers = transferCards.filter((card) => statusKey(card.status) === "active" || statusKey(card.status) === "queued").length;
  return {
    active,
    failed,
    queued,
    transfers,
  };
}

function selectHudCards(todoCards, remoteCards, syncCards, transferCards) {
  return uniqueCards([
    ...todoCards.map((card) => ({ ...card, group: "todo" })),
    ...remoteCards.map((card) => ({ ...card, group: "remote" })),
    ...syncCards.map((card) => ({ ...card, group: "sync" })),
    ...transferCards.map((card) => ({ ...card, group: "move" })),
  ], 14);
}

function hudCardKind(card) {
  const lane = text(card?.lane).toLowerCase();
  const eyebrow = text(card?.eyebrow).toLowerCase();
  const group = text(card?.group).toLowerCase();
  if (eyebrow.includes("upload")) return "upload";
  if (eyebrow.includes("download")) return "download";
  if (lane === "transfers" || group === "move") return "transfer";
  if (group === "remote" || lane === "remote") return "remote";
  if (group === "sync" || lane === "sync") return "sync";
  return "todo";
}

function hudCardChip(card) {
  const kind = hudCardKind(card);
  if (kind === "upload") return "Upload";
  if (kind === "download") return "Download";
  if (kind === "transfer") return "Transfer";
  if (kind === "remote") return "Remote";
  if (kind === "sync") return "Sync";
  return "Task";
}

function hudCardSubtitle(card) {
  return shortText(firstText(card?.detail, card?.meta, card?.eyebrow, "live activity"), 72);
}

function hudCardMeta(card) {
  const meta = firstText(card?.meta, card?.detail);
  const age = timeAgo(card?.updatedAt);
  return meta ? `${shortText(meta, 44)} / ${age}` : `updated ${age}`;
}

function hudCardShowsProgress(card) {
  const kind = hudCardKind(card);
  return kind === "upload" || kind === "download" || kind === "transfer";
}

function hudIdleCard(data) {
  const hasErrors = Array.isArray(data?.errors) && data.errors.length > 0;
  return {
    detail: hasErrors ? data.errors.join(", ") : "todos, sync, and transfers",
    eyebrow: hasErrors ? "degraded" : "watching",
    group: hasErrors ? "sync" : "todo",
    id: "activity-idle",
    lane: hasErrors ? "sync" : "todos",
    meta: hasErrors ? "snapshot pending" : "ready",
    progress: hasErrors ? 36 : 18,
    status: hasErrors ? "queued" : "idle",
    title: hasErrors ? "Snapshot pending" : "Waiting for activity",
    tone: hasErrors ? "warn" : "muted",
    updatedAt: data?.updatedAt || Date.now(),
  };
}

function useActivityOverlayData() {
  const [state, setState] = useState({
    audioProgress: null,
    cloudStatus: null,
    coordinationSnapshot: null,
    errors: [],
    library: null,
    liveEvents: [],
    updatedAt: 0,
  });
  const refreshTimerRef = useRef(0);
  const refreshInFlightRef = useRef(false);

  const pushLiveEvent = useCallback((kind, payload = {}) => {
    const at = Date.now();
    setState((current) => ({
      ...current,
      liveEvents: [
        {
          at,
          id: `${kind}-${at}-${Math.random().toString(36).slice(2, 8)}`,
          kind,
          label: liveEventLabel(kind, payload),
          payload,
        },
        ...current.liveEvents,
      ].slice(0, LIVE_EVENT_LIMIT),
    }));
  }, []);

  const refresh = useCallback(async ({ localOnly = true } = {}) => {
    if (refreshInFlightRef.current) {
      return;
    }
    refreshInFlightRef.current = true;
    const [cloudStatusResult, libraryResult, snapshotResult] = await Promise.allSettled([
      invoke("cloud_mcp_get_status"),
      invoke("cloud_mcp_list_workspace_assets", {
        includeAllWorkspaces: true,
        limit: 120,
        localOnly,
        repoPath: "",
      }),
      invoke("coordination_get_snapshot", {
        dbPath: null,
        repoPath: null,
      }),
    ]);
    refreshInFlightRef.current = false;
    setState((current) => {
      const errors = [];
      if (cloudStatusResult.status === "rejected") {
        errors.push("cloud");
      }
      if (libraryResult.status === "rejected") {
        errors.push("assets");
      }
      if (snapshotResult.status === "rejected") {
        errors.push("coordination");
      }
      return {
        ...current,
        cloudStatus: cloudStatusResult.status === "fulfilled" ? cloudStatusResult.value : current.cloudStatus,
        coordinationSnapshot: snapshotResult.status === "fulfilled" ? snapshotResult.value : current.coordinationSnapshot,
        errors,
        library: libraryResult.status === "fulfilled" ? libraryResult.value : current.library,
        updatedAt: Date.now(),
      };
    });
  }, []);

  const scheduleRefresh = useCallback((options) => {
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = 0;
      void refresh(options);
    }, REFRESH_DEBOUNCE_MS);
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let intervalId = 0;
    const unlisteners = [];
    const addListener = async (eventName, kind, options = {}) => {
      try {
        const unlisten = await listen(eventName, (event) => {
          if (cancelled) {
            return;
          }
          const payload = event?.payload || {};
          if (eventName === AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT) {
            setState((current) => ({ ...current, audioProgress: payload }));
          }
          pushLiveEvent(kind, payload);
          scheduleRefresh(options.refreshOptions || {});
        });
        if (cancelled) {
          unlisten();
        } else {
          unlisteners.push(unlisten);
        }
      } catch {
        // The overlay can still run from periodic snapshots if an event channel is absent.
      }
    };

    void refresh({ localOnly: true });
    intervalId = window.setInterval(() => {
      void refresh({ localOnly: true });
    }, REFRESH_INTERVAL_MS);

    void addListener(CLOUD_MCP_WORKSPACE_TODOS_UPDATED_EVENT, "todo");
    void addListener(CLOUD_MCP_WORKSPACE_ASSETS_UPDATED_EVENT, "asset", { refreshOptions: { localOnly: true } });
    void addListener(WORKSPACE_MCP_BACKGROUND_JOB_EVENT, "job");
    void addListener(WORKSPACE_NOTIFICATION_EVENT, "notification");
    void addListener(TERMINAL_TODO_PLAN_UPDATED_EVENT, "terminal");
    void addListener(TERMINAL_ACTIVITY_HOOK_EVENT, "terminal");
    void addListener(AUDIO_MODEL_DOWNLOAD_PROGRESS_EVENT, "asset", { refreshOptions: { localOnly: true } });

    return () => {
      cancelled = true;
      if (intervalId) {
        window.clearInterval(intervalId);
      }
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = 0;
      }
      unlisteners.forEach((unlisten) => {
        try {
          unlisten();
        } catch {
          // Ignore listener teardown failures.
        }
      });
    };
  }, [pushLiveEvent, refresh, scheduleRefresh]);

  return state;
}

export default function ActivityOverlayWindow() {
  const data = useActivityOverlayData();
  const todoCards = useMemo(() => normalizeTodoCards(data.cloudStatus), [data.cloudStatus]);
  const remoteCards = useMemo(() => normalizeRemoteCards(data.cloudStatus), [data.cloudStatus]);
  const syncCards = useMemo(
    () => normalizeCoordinationCards(data.coordinationSnapshot, data.liveEvents),
    [data.coordinationSnapshot, data.liveEvents],
  );
  const transferCards = useMemo(
    () => normalizeTransferCards(data.library, data.audioProgress, data.liveEvents),
    [data.audioProgress, data.library, data.liveEvents],
  );
  const stats = useMemo(
    () => summaryStats(todoCards, remoteCards, syncCards, transferCards),
    [remoteCards, syncCards, todoCards, transferCards],
  );
  const hudCards = useMemo(
    () => selectHudCards(todoCards, remoteCards, syncCards, transferCards),
    [remoteCards, syncCards, todoCards, transferCards],
  );
  const primaryCard = hudCards[0] || hudIdleCard(data);
  const secondaryCards = hudCards.slice(1);
  const statusToneName = primaryCard.tone || (data.errors.length ? "warn" : stats.failed ? "danger" : stats.active ? "hot" : "muted");
  const primaryKind = hudCardKind(primaryCard);
  const primaryActive = statusKey(primaryCard.status) === "active";
  const primaryProgress = clampPercent(primaryCard.progress ?? statusProgress(primaryCard.status));
  const primaryShowsProgress = hudCardShowsProgress(primaryCard);
  const dragOverlayWindow = useCallback((event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (event.button !== 0 || target?.closest("[data-overlay-scroll]")) {
      return;
    }

    runOverlayWindowAction((windowHandle) => windowHandle.startDragging());
  }, []);

  return (
    <>
      <OverlayGlobalStyle />
      <OverlayShell>
        <MinimalRoot data-tone={statusToneName} onMouseDown={dragOverlayWindow}>
          <PrimarySignal
            data-tauri-drag-region
            data-tone={statusToneName}
          >
            <PrimaryTop>
              <SignalIcon
                aria-hidden="true"
                data-active={primaryActive ? "true" : "false"}
                data-kind={primaryKind}
                data-tone={statusToneName}
              />
              <PrimaryCopy>
                <PrimaryTitle>{primaryCard.title}</PrimaryTitle>
                <PrimaryDetail>{hudCardSubtitle(primaryCard)}</PrimaryDetail>
              </PrimaryCopy>
              <SignalChip data-tone={statusToneName}>{hudCardChip(primaryCard)}</SignalChip>
            </PrimaryTop>
            <PrimaryMeta>{hudCardMeta(primaryCard)}</PrimaryMeta>
            {primaryShowsProgress ? (
              <SignalTrack aria-hidden="true">
                <SignalFill
                  data-kind={primaryKind}
                  data-tone={statusToneName}
                  style={{ width: `${primaryProgress}%` }}
                />
              </SignalTrack>
            ) : null}
          </PrimarySignal>

          <MiniFeed aria-live="polite" data-overlay-scroll>
            {secondaryCards.length ? secondaryCards.map((card) => {
              const kind = hudCardKind(card);
              const tone = card.tone || statusTone(card.status);
              const progress = clampPercent(card.progress ?? statusProgress(card.status));
              const showsProgress = hudCardShowsProgress(card);
              return (
                <MiniRow data-progress={showsProgress ? "true" : "false"} data-tone={tone} key={card.id}>
                  <MiniIcon aria-hidden="true" data-kind={kind} data-tone={tone} />
                  <MiniCopy>
                    <MiniTitle>{card.title}</MiniTitle>
                    <MiniMeta>{hudCardMeta(card)}</MiniMeta>
                    {showsProgress ? (
                      <MiniTrack aria-hidden="true">
                        <MiniFill data-kind={kind} data-tone={tone} style={{ width: `${progress}%` }} />
                      </MiniTrack>
                    ) : null}
                  </MiniCopy>
                  <MiniChip>{hudCardChip(card)}</MiniChip>
                </MiniRow>
              );
            }) : (
              <QuietRow>
                <QuietLoader aria-hidden="true" />
                <QuietCopy>
                  <QuietTitle>Listening for work</QuietTitle>
                  <QuietMeta>{data.errors.length ? data.errors.join(", ") : `updated ${timeAgo(data.updatedAt)}`}</QuietMeta>
                </QuietCopy>
              </QuietRow>
            )}
          </MiniFeed>

          <MinimalFooter data-tauri-drag-region>
            <LiveDot data-active={stats.active > 0 ? "true" : "false"} />
            <span>{data.errors.length ? "snapshot pending" : stats.active > 0 ? "live work" : "quiet"}</span>
            <FooterSpacer />
            <span>{timeAgo(data.updatedAt)}</span>
          </MinimalFooter>
        </MinimalRoot>
      </OverlayShell>
    </>
  );
}

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const softPulse = keyframes`
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
`;

const OverlayShell = styled.div`
  width: 100vw;
  height: 100vh;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 8px;
  background: transparent;
`;

const MinimalRoot = styled.main`
  width: 100%;
  height: 100%;
  max-width: 100vw;
  max-height: 100vh;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 9px;
  color: var(--forge-text, #f4f7fa);
  font-family: "SF Mono", "JetBrains Mono", "Roboto Mono", ui-monospace, Menlo, Consolas, monospace;
  letter-spacing: 0;
  background: rgba(7, 9, 13, 0.94);
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, var(--forge-surface-raised, #11161d) 92%, transparent),
      color-mix(in srgb, var(--forge-bg, #07090d) 94%, transparent)
    ),
    var(--forge-bg, #07090d);
  border: 1px solid var(--forge-border-strong, rgba(230, 236, 245, 0.16));
  border-radius: 20px;
  box-shadow:
    0 18px 54px rgba(0, 0, 0, 0.42),
    inset 0 1px 0 rgba(255, 255, 255, 0.035);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);

  &[data-tone="danger"] {
    border-color: color-mix(in srgb, var(--forge-red, #ef6b6b) 42%, var(--forge-border-strong, rgba(230, 236, 245, 0.16)));
  }

  &[data-tone="warn"] {
    border-color: color-mix(in srgb, var(--forge-amber, #dfa55a) 38%, var(--forge-border-strong, rgba(230, 236, 245, 0.16)));
  }

  &[data-tone="hot"] {
    border-color: color-mix(in srgb, var(--forge-blue, #3b82f6) 36%, var(--forge-border-strong, rgba(230, 236, 245, 0.16)));
  }
`;

const PrimarySignal = styled.section`
  flex: 0 0 auto;
  min-width: 0;
  display: grid;
  gap: 8px;
  cursor: grab;

  &:active {
    cursor: grabbing;
  }
`;

const PrimaryTop = styled.div`
  min-width: 0;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr) auto;
  align-items: start;
  gap: 10px;
`;

const PrimaryCopy = styled.div`
  min-width: 0;
  display: grid;
  gap: 5px;
`;

const PrimaryTitle = styled.div`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text, #f4f7fa);
  font-size: 15px;
  font-weight: 760;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PrimaryDetail = styled.div`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-soft, #b6c0cc);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PrimaryMeta = styled.div`
  min-width: 0;
  overflow: hidden;
  padding-left: 40px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 10px;
  font-weight: 520;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SignalChip = styled.div`
  max-width: 86px;
  overflow: hidden;
  padding: 5px 9px;
  border: 1px solid color-mix(in srgb, var(--forge-blue, #3b82f6) 54%, transparent);
  border-radius: 5px;
  color: var(--forge-blue-soft, #7db0ff);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;

  &[data-tone="warn"] {
    color: var(--forge-amber, #dfa55a);
    border-color: color-mix(in srgb, var(--forge-amber, #dfa55a) 52%, transparent);
  }

  &[data-tone="danger"] {
    color: var(--forge-red, #ef6b6b);
    border-color: color-mix(in srgb, var(--forge-red, #ef6b6b) 54%, transparent);
  }

  &[data-tone="good"] {
    color: var(--forge-green, #3ccb7f);
    border-color: color-mix(in srgb, var(--forge-green, #3ccb7f) 48%, transparent);
  }
`;

const iconColor = `
  color: var(--forge-blue-soft, #7db0ff);

  &[data-tone="danger"] {
    color: var(--forge-red, #ef6b6b);
  }

  &[data-tone="good"] {
    color: var(--forge-green, #3ccb7f);
  }

  &[data-tone="warn"] {
    color: var(--forge-amber, #dfa55a);
  }

  &[data-kind="download"] {
    color: #8ec5ff;
  }
`;

const SignalIcon = styled.span`
  position: relative;
  width: 30px;
  height: 30px;
  display: block;
  border-radius: 10px;
  background: var(--forge-surface-control, #151b23);
  ${iconColor}

  &::before,
  &::after {
    content: "";
    position: absolute;
    display: block;
  }

  &::before {
    inset: 8px;
    border: 2px solid currentColor;
    border-radius: 50%;
    opacity: 0.86;
  }

  &[data-active="true"]::before {
    border-right-color: transparent;
    animation: ${spin} 0.9s linear infinite;
  }

  &[data-kind="upload"]::before,
  &[data-kind="download"]::before {
    width: 2px;
    height: 13px;
    inset: auto;
    left: 14px;
    top: 8px;
    border: 0;
    border-radius: 2px;
    background: currentColor;
    animation: none;
  }

  &[data-kind="upload"]::after,
  &[data-kind="download"]::after {
    width: 8px;
    height: 8px;
    left: 10px;
    border-left: 2px solid currentColor;
    border-top: 2px solid currentColor;
  }

  &[data-kind="upload"]::after {
    top: 7px;
    transform: rotate(45deg);
  }

  &[data-kind="download"]::after {
    top: 14px;
    transform: rotate(225deg);
  }

  &[data-kind="remote"]::before {
    width: 13px;
    height: 9px;
    inset: auto;
    left: 7px;
    top: 10px;
    border-radius: 3px;
  }

  &[data-kind="remote"]::after {
    width: 5px;
    height: 5px;
    right: 7px;
    top: 8px;
    border-radius: 50%;
    background: currentColor;
    animation: ${softPulse} 1.2s ease-in-out infinite;
  }
`;

const SignalTrack = styled.div`
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--forge-border-strong, rgba(230, 236, 245, 0.16)) 70%, transparent);
`;

const SignalFill = styled.div`
  height: 100%;
  min-width: 7%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--forge-blue, #3b82f6), var(--forge-blue-soft, #7db0ff));
  transition: width 180ms ease;

  &[data-kind="download"] {
    background: linear-gradient(90deg, #4fa3ff, #8ec5ff);
  }

  &[data-kind="sync"],
  &[data-tone="good"] {
    background: linear-gradient(90deg, var(--forge-green, #3ccb7f), #84e7b0);
  }

  &[data-tone="danger"] {
    background: linear-gradient(90deg, var(--forge-red, #ef6b6b), #ff9a9a);
  }
`;

const MiniFeed = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 7px;
  overflow-y: auto;
  padding-right: 2px;
  overscroll-behavior: contain;
  scrollbar-color: color-mix(in srgb, var(--forge-blue, #3b82f6) 52%, transparent) transparent;

  &::-webkit-scrollbar {
    width: 5px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: color-mix(in srgb, var(--forge-blue, #3b82f6) 42%, transparent);
  }
`;

const MiniRow = styled.div`
  min-width: 0;
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 8px 9px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.1));
  border-radius: 8px;
  background: color-mix(in srgb, var(--forge-surface-raised, #11161d) 72%, transparent);

  &[data-progress="false"] {
    padding-block: 9px;
  }
`;

const MiniIcon = styled.span`
  position: relative;
  width: 18px;
  height: 18px;
  display: block;
  ${iconColor}

  &::before,
  &::after {
    content: "";
    position: absolute;
    display: block;
  }

  &::before {
    inset: 4px;
    border: 2px solid currentColor;
    border-radius: 50%;
  }

  &[data-kind="upload"]::before,
  &[data-kind="download"]::before {
    width: 2px;
    height: 10px;
    inset: auto;
    left: 8px;
    top: 4px;
    border: 0;
    border-radius: 2px;
    background: currentColor;
  }

  &[data-kind="upload"]::after,
  &[data-kind="download"]::after {
    width: 6px;
    height: 6px;
    left: 5px;
    border-left: 2px solid currentColor;
    border-top: 2px solid currentColor;
  }

  &[data-kind="upload"]::after {
    top: 3px;
    transform: rotate(45deg);
  }

  &[data-kind="download"]::after {
    top: 8px;
    transform: rotate(225deg);
  }
`;

const MiniCopy = styled.div`
  min-width: 0;
  display: grid;
  gap: 4px;
`;

const MiniTitle = styled.div`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text, #f4f7fa);
  font-size: 11px;
  font-weight: 640;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MiniMeta = styled.div`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-muted, #7a8493);
  font-size: 9px;
  font-weight: 520;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MiniTrack = styled.div`
  height: 2px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--forge-border, rgba(230, 236, 245, 0.1)) 82%, transparent);
`;

const MiniFill = styled(SignalFill)`
  min-width: 5%;
`;

const MiniChip = styled.div`
  max-width: 62px;
  overflow: hidden;
  color: var(--forge-text-muted, #7a8493);
  font-size: 9px;
  font-weight: 650;
  line-height: 1;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
`;

const QuietRow = styled.div`
  min-height: 58px;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  padding: 10px;
  border: 1px dashed var(--forge-border, rgba(230, 236, 245, 0.1));
  border-radius: 10px;
  background: color-mix(in srgb, var(--forge-surface, #0d1117) 54%, transparent);
`;

const QuietLoader = styled.span`
  width: 18px;
  height: 18px;
  border: 2px solid color-mix(in srgb, var(--forge-border-strong, rgba(230, 236, 245, 0.16)) 88%, transparent);
  border-top-color: var(--forge-blue-soft, #7db0ff);
  border-radius: 50%;
  animation: ${spin} 1s linear infinite;
`;

const QuietCopy = styled.div`
  min-width: 0;
  display: grid;
  gap: 5px;
`;

const QuietTitle = styled.div`
  color: var(--forge-text, #f4f7fa);
  font-size: 12px;
  font-weight: 680;
  line-height: 1;
`;

const QuietMeta = styled.div`
  min-width: 0;
  overflow: hidden;
  color: var(--forge-text-muted, #7a8493);
  font-size: 10px;
  font-weight: 520;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const MinimalFooter = styled.footer`
  flex: 0 0 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--forge-text-muted, #7a8493);
  cursor: grab;
  font-size: 9px;
  font-weight: 650;
  line-height: 1;
  text-transform: uppercase;

  &:active {
    cursor: grabbing;
  }
`;

const LiveDot = styled.span`
  width: 6px;
  height: 6px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: var(--forge-text-disabled, #505966);

  &[data-active="true"] {
    background: var(--forge-blue-soft, #7db0ff);
    animation: ${softPulse} 1.2s ease-in-out infinite;
  }
`;

const FooterSpacer = styled.span`
  flex: 1 1 auto;
`;

const OverlayGlobalStyle = createGlobalStyle`
  :root {
    --forge-bg: #07090d;
    --forge-bg-deep: #020304;
    --forge-surface: #0d1117;
    --forge-surface-raised: #11161d;
    --forge-surface-control: #151b23;
    --forge-border: rgba(230, 236, 245, 0.1);
    --forge-border-strong: rgba(230, 236, 245, 0.16);
    --forge-text: #f4f7fa;
    --forge-text-soft: #b6c0cc;
    --forge-text-muted: #7a8493;
    --forge-text-disabled: #505966;
    --forge-blue: #3b82f6;
    --forge-blue-soft: #7db0ff;
    --forge-amber: #dfa55a;
    --forge-green: #3ccb7f;
    --forge-red: #ef6b6b;
    color-scheme: dark;
  }

  html,
  body,
  #root {
    width: 100%;
    height: 100%;
    min-width: 0;
    min-height: 100%;
    margin: 0;
    overflow: hidden;
    background: transparent;
  }

  body {
    color: var(--forge-text, #f4f7fa);
    font-family: "SF Mono", "JetBrains Mono", "Roboto Mono", ui-monospace, Menlo, Consolas, monospace;
    letter-spacing: 0;
    user-select: none;
  }

  * {
    box-sizing: border-box;
  }
`;

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

import { listenShared } from "../app/sharedTauriEvents.js";

export const TERMINAL_REMOTE_PRESENCE_CHANGED_EVENT = "terminal-remote-presence-changed";

const EMPTY_PRESENCE = Object.freeze({
  chat_watchers: 0,
  instance_id: null,
  pane_id: "",
  shell_controller: false,
  shell_viewers: 0,
  stream_key: "",
  workspace_id: "",
});

const EMPTY_SNAPSHOT = Object.freeze({
  by_stream_key: Object.freeze({}),
  by_terminal_key: Object.freeze({}),
  items: Object.freeze([]),
  updated_at_ms: 0,
});

let currentSnapshot = EMPTY_SNAPSHOT;
let hydratePromise = null;
let subscribedToBackend = false;
const subscribers = new Set();

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function terminalRemotePresencePlatformHint() {
  if (typeof navigator === "undefined") {
    return "";
  }
  return [
    navigator.userAgentData?.platform,
    navigator.platform,
    navigator.userAgent,
  ].find((value) => String(value || "").trim()) || "";
}

function terminalRemotePresencePlatformIsWindows(platform = "") {
  const normalized = String(platform || "").trim().toLowerCase();
  return normalized === "windows"
    || normalized === "win32"
    || normalized === "win64"
    || normalized.startsWith("windows ");
}

export function normalizeTerminalRemotePresenceWorkspaceId(
  value,
  platform = terminalRemotePresencePlatformHint(),
) {
  let normalized = String(value || "").trim();
  const windowsPath = terminalRemotePresencePlatformIsWindows(platform);
  if (windowsPath) {
    normalized = normalized.replace(/\\/g, "/");
  }
  if (!normalized) {
    return normalized;
  }
  if (windowsPath) {
    if (normalized.startsWith("//?/")) {
      normalized = normalized.slice(4);
    }
    if (normalized.slice(0, 4).toLowerCase() === "unc/") {
      normalized = `//${normalized.slice(4)}`;
    }
    if (
      normalized.startsWith("/")
      && /^[A-Za-z]:$/.test(normalized.slice(1, 3))
    ) {
      normalized = normalized.slice(1);
    }
    while (normalized.includes("//")) {
      normalized = normalized.replaceAll("//", "/");
    }
  }
  const driveRoot = normalized.length === 3
    && /^[A-Za-z]$/.test(normalized[0])
    && normalized[1] === ":"
    && normalized[2] === "/";
  if (normalized.length > 1 && !driveRoot) {
    normalized = normalized.replace(/\/+$/g, "");
  }
  return windowsPath ? normalized.toLowerCase() : normalized;
}

function normalizePresenceItem(item = {}) {
  return {
    chat_watchers: Math.max(0, Number(item.chat_watchers || 0) || 0),
    instance_id: numberOrNull(item.instance_id),
    pane_id: String(item.pane_id || "").trim(),
    shell_controller: Boolean(item.shell_controller),
    shell_viewers: Math.max(0, Number(item.shell_viewers || 0) || 0),
    stream_key: String(item.stream_key || "").trim(),
    workspace_id: normalizeTerminalRemotePresenceWorkspaceId(item.workspace_id),
  };
}

function normalizeSnapshot(snapshot = {}) {
  const items = (Array.isArray(snapshot?.items) ? snapshot.items : [])
    .map(normalizePresenceItem)
    .filter((item) => (
      item.pane_id
      && (item.shell_viewers > 0 || item.shell_controller || item.chat_watchers > 0)
    ));
  const byStreamKey = {};
  const byTerminalKey = {};
  items.forEach((item) => {
    if (item.stream_key) {
      byStreamKey[item.stream_key] = item;
    }
    const instanceKey = item.instance_id || "unknown";
    byTerminalKey[`${item.workspace_id}|${item.pane_id}|${instanceKey}`] = item;
  });
  return {
    by_stream_key: byStreamKey,
    by_terminal_key: byTerminalKey,
    items,
    updated_at_ms: Number(snapshot?.updated_at_ms || Date.now()) || Date.now(),
  };
}

function publishSnapshot(snapshot) {
  currentSnapshot = normalizeSnapshot(snapshot);
  subscribers.forEach((subscriber) => {
    try {
      subscriber(currentSnapshot);
    } catch (error) {
      console.error("Terminal remote presence subscriber failed", error);
    }
  });
}

function ensureBackendSubscription() {
  if (subscribedToBackend) {
    return;
  }
  subscribedToBackend = true;
  listenShared(TERMINAL_REMOTE_PRESENCE_CHANGED_EVENT, (event) => {
    publishSnapshot(event?.payload || {});
  });
}

function hydrateTerminalRemotePresence() {
  ensureBackendSubscription();
  if (!hydratePromise) {
    hydratePromise = invoke("terminal_remote_presence_snapshot")
      .then((snapshot) => {
        publishSnapshot(snapshot || {});
        return currentSnapshot;
      })
      .catch((error) => {
        hydratePromise = null;
        console.error("Unable to hydrate terminal remote presence", error);
        return currentSnapshot;
      });
  }
  return hydratePromise;
}

export function subscribeTerminalRemotePresence(subscriber) {
  ensureBackendSubscription();
  subscribers.add(subscriber);
  hydrateTerminalRemotePresence();
  return () => {
    subscribers.delete(subscriber);
  };
}

export function getTerminalRemotePresenceForPane(snapshot, {
  workspaceId = "",
  paneId = "",
  instanceId = 0,
} = {}) {
  const safePaneId = String(paneId || "").trim();
  const workspaceProvided = String(workspaceId || "").trim() !== "";
  const safeWorkspaceId = normalizeTerminalRemotePresenceWorkspaceId(workspaceId);
  const safeInstanceId = numberOrNull(instanceId);
  if (!safePaneId) {
    return EMPTY_PRESENCE;
  }

  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];

  // Shell presence always carries a globally-unique instance id, so pane +
  // instance is an exact, collision-free key — no workspace check (and no
  // workspace-ignoring fallback) is needed or safe here.
  if (safeInstanceId !== null) {
    const exact = items.find((item) => (
      item.pane_id === safePaneId && item.instance_id === safeInstanceId
    ));
    if (exact) {
      return exact;
    }
  }

  // Chat-only presence can arrive with no instance id (a web client watching
  // the transcript without an attached shell). Pane ids are only unique WITHIN
  // a workspace, so this branch MUST match the workspace or it would paint
  // workspace B's badge onto workspace A's identically-named pane. Without a
  // workspace id on either side we cannot disambiguate, so we decline rather
  // than guess — no single-pane fallback.
  if (workspaceProvided) {
    const chatOnly = items.find((item) => (
      item.pane_id === safePaneId
      && item.instance_id === null
      && item.chat_watchers > 0
      && normalizeTerminalRemotePresenceWorkspaceId(item?.workspace_id) === safeWorkspaceId
    ));
    if (chatOnly) {
      return chatOnly;
    }
  }

  return EMPTY_PRESENCE;
}

export function useTerminalRemotePresence({
  workspaceId = "",
  paneId = "",
  instanceId = 0,
} = {}) {
  const [snapshot, setSnapshot] = useState(currentSnapshot);

  useEffect(() => subscribeTerminalRemotePresence(setSnapshot), []);

  return useMemo(() => getTerminalRemotePresenceForPane(snapshot, {
    workspaceId,
    paneId,
    instanceId,
  }), [instanceId, paneId, snapshot, workspaceId]);
}

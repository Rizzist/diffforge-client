import { useSyncExternalStore } from "react";

const EMPTY_DATA = Object.freeze({});

const WORKSPACE_TOOL_PANEL_ACTUATOR_KEYS = Object.freeze([
  "onAddToolTodo",
  "onBeginTodoDrag",
  "onBeginWorkspaceFileDrag",
  "onCancelQueuedItem",
  "onCancelVoicePlan",
  "onCancelVoicePlanTask",
  "onDispatchTodoToTarget",
  "onDraftChange",
  "onMinimizePane",
  "onOpenDocumentPanel",
  "onOpenWorkspaceSettings",
  "onQueueAllItems",
  "onQueueItem",
  "onRefreshGitRepositories",
  "onRefreshGitSnapshot",
  "onRecheckAgents",
  "onRemoveItem",
  "onRemoveItemAttachment",
  "onReorderItem",
  "onRequeueVoicePlanTask",
  "onRequeueVoicePlanUnfinished",
  "onResumePlan",
  "onResumeTodoSession",
  "onSubmitDraft",
  "onToggleFullscreenPane",
  "onToggleTerminalBreakout",
  "onToggleWindowBreakout",
  "onUpdateItem",
  "onVoiceAgentToolCall",
  "onVoicePlanNeedsRequeue",
  "onVoicePlanServerResult",
]);

const workspaceToolPanelStore = {
  activeWorkspaceId: "",
  actuators: {},
  data: EMPTY_DATA,
  owner_id: "",
  snapshot: null,
  subscribers: new Set(),
};

const actuatorWrappers = Object.freeze(
  WORKSPACE_TOOL_PANEL_ACTUATOR_KEYS.reduce((wrappers, key) => {
    wrappers[key] = (...args) => {
      const fn = workspaceToolPanelStore.actuators?.[key];
      return typeof fn === "function" ? fn(...args) : undefined;
    };
    return wrappers;
  }, {}),
);

const EMPTY_SNAPSHOT = Object.freeze({
  activeWorkspaceId: "",
  actuators: actuatorWrappers,
  data: EMPTY_DATA,
  hasRuntime: false,
});

workspaceToolPanelStore.snapshot = EMPTY_SNAPSHOT;

function shallowEqualObject(left, right) {
  if (left === right) {
    return true;
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && left[key] === right[key]);
}

function emitWorkspaceToolPanelStore() {
  workspaceToolPanelStore.subscribers.forEach((subscriber) => subscriber());
}

function setWorkspaceToolPanelSnapshot(nextSnapshot) {
  if (workspaceToolPanelStore.snapshot === nextSnapshot) {
    return;
  }
  workspaceToolPanelStore.snapshot = nextSnapshot;
  emitWorkspaceToolPanelStore();
}

export function publishWorkspaceToolPanelState(ownerId, data = EMPTY_DATA, actuators = {}) {
  const safeOwnerId = String(ownerId || "").trim();
  const safeData = data && typeof data === "object" && !Array.isArray(data) ? data : EMPTY_DATA;
  const activeWorkspaceId = String(safeData.workspace_id || safeData.workspace?.id || "").trim();
  if (!safeOwnerId || !activeWorkspaceId) {
    return;
  }

  const previousData = workspaceToolPanelStore.data;
  const nextData = shallowEqualObject(previousData, safeData) ? previousData : safeData;
  const snapshotUnchanged = workspaceToolPanelStore.snapshot !== EMPTY_SNAPSHOT
    && workspaceToolPanelStore.activeWorkspaceId === activeWorkspaceId
    && workspaceToolPanelStore.data === nextData;

  workspaceToolPanelStore.owner_id = safeOwnerId;
  workspaceToolPanelStore.activeWorkspaceId = activeWorkspaceId;
  workspaceToolPanelStore.data = nextData;
  workspaceToolPanelStore.actuators = actuators && typeof actuators === "object" ? actuators : {};

  if (snapshotUnchanged) {
    return;
  }

  setWorkspaceToolPanelSnapshot({
    activeWorkspaceId,
    actuators: actuatorWrappers,
    data: nextData,
    hasRuntime: true,
  });
}

export function clearWorkspaceToolPanelState(ownerId) {
  const safeOwnerId = String(ownerId || "").trim();
  if (!safeOwnerId || workspaceToolPanelStore.owner_id !== safeOwnerId) {
    return;
  }
  workspaceToolPanelStore.owner_id = "";
  workspaceToolPanelStore.activeWorkspaceId = "";
  workspaceToolPanelStore.data = EMPTY_DATA;
  workspaceToolPanelStore.actuators = {};
  setWorkspaceToolPanelSnapshot(EMPTY_SNAPSHOT);
}

function subscribeWorkspaceToolPanelStore(subscriber) {
  workspaceToolPanelStore.subscribers.add(subscriber);
  return () => {
    workspaceToolPanelStore.subscribers.delete(subscriber);
  };
}

function getWorkspaceToolPanelSnapshot() {
  return workspaceToolPanelStore.snapshot;
}

export function useWorkspaceToolPanelBridge() {
  return useSyncExternalStore(
    subscribeWorkspaceToolPanelStore,
    getWorkspaceToolPanelSnapshot,
    getWorkspaceToolPanelSnapshot,
  );
}

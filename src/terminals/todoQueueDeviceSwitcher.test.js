import assert from "node:assert/strict";
import test from "node:test";

import {
  TODO_QUEUE_DEVICE_KIND_MOBILE,
  buildTodoQueueDeviceWorkspaceOptions,
  todoQueueDeviceSelectionIsLocalEditable,
  workspaceTodoItemsForDeviceWorkspace,
} from "./todoQueueDeviceSwitcher.js";

test("device switcher puts the local desktop first and dedupes its server echo", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    connectedDevices: [
      {
        connected: true,
        deviceId: "desktop-local",
        displayName: "Server Echo",
        formFactor: "desktop",
      },
    ],
    currentWorkspaceId: "ws-local",
    currentWorkspaceName: "Main repo",
    deviceLiveState: {
      devices: [
        {
          device_id: "desktop-local",
          device_name: "Server Echo",
          status: "online",
          workspaces: [{ workspace_id: "ws-local", workspace_name: "Main repo" }],
        },
        {
          device_id: "desktop-remote",
          device_name: "Studio Mac",
          form_factor: "desktop",
          status: "online",
          workspaces: [{ workspace_id: "ws-remote", workspace_name: "Remote repo" }],
        },
      ],
    },
    localProfile: {
      device_id: "desktop-local",
      device_name: "Local Rig",
      form_factor: "desktop",
    },
  });

  assert.equal(options[0].deviceId, "desktop-local");
  assert.equal(options[0].deviceName, "Local Rig");
  assert.equal(options[0].isLocal, true);
  assert.equal(options[0].liveState, "live");
  assert.equal(
    options.filter((option) => option.deviceId === "desktop-local" && option.workspaceId === "ws-local").length,
    1,
  );
  assert.ok(options.some((option) => (
    option.deviceId === "desktop-remote"
      && option.workspaceId === "ws-remote"
      && option.workspaceName === "Remote repo"
  )));
});

test("mobile devices are selectable as devices without workspace todo views", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    currentWorkspaceId: "ws-local",
    deviceLiveState: {
      devices: [
        {
          device_id: "phone-1",
          device_name: "Pocket",
          form_factor: "mobile",
          status: "online",
          workspaces: [{ workspace_id: "mobile-ws", workspace_name: "Ignored mobile workspace" }],
        },
      ],
    },
    localProfile: { device_id: "desktop-local", device_name: "Local Rig" },
  });
  const mobile = options.find((option) => option.deviceId === "phone-1");

  assert.equal(mobile.deviceKind, TODO_QUEUE_DEVICE_KIND_MOBILE);
  assert.equal(mobile.workspaceId, "");
  assert.equal(mobile.liveState, "live");
});

test("workspaceTodos filtering keeps only the selected source device and workspace", () => {
  const items = workspaceTodoItemsForDeviceWorkspace({
    itemsByWorkspace: {
      "ws-remote": [
        {
          deviceId: "desktop-remote",
          status: "listed",
          text: "Remote todo",
          todoId: "todo-remote",
          workspaceId: "ws-remote",
        },
        {
          deviceId: "desktop-local",
          status: "listed",
          text: "Local todo",
          todoId: "todo-local",
          workspaceId: "ws-remote",
        },
        {
          deviceId: "desktop-remote",
          status: "deleted",
          text: "Deleted todo",
          todoId: "todo-deleted",
          workspaceId: "ws-remote",
        },
      ],
    },
  }, {
    deviceId: "desktop-remote",
    workspaceId: "ws-remote",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].todoId, "todo-remote");
});

test("only local device current workspace selections are editable", () => {
  assert.equal(todoQueueDeviceSelectionIsLocalEditable({
    deviceKind: "desktop",
    isLocal: true,
    workspaceId: "ws-local",
  }, "ws-local"), true);
  assert.equal(todoQueueDeviceSelectionIsLocalEditable({
    deviceKind: "desktop",
    isLocal: true,
    workspaceId: "ws-other",
  }, "ws-local"), false);
  assert.equal(todoQueueDeviceSelectionIsLocalEditable({
    deviceKind: "desktop",
    isLocal: false,
    workspaceId: "ws-local",
  }, "ws-local"), false);
});

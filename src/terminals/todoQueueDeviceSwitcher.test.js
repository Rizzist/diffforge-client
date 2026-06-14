import assert from "node:assert/strict";
import test from "node:test";

import {
  TODO_QUEUE_DEVICE_KIND_MOBILE,
  buildTodoQueueDeviceWorkspaceOptions,
  todoQueueDeviceSelectionIsLocalEditable,
  workspaceTodoItemsForDeviceWorkspace,
} from "./todoQueueDeviceSwitcher.js";

test("device switcher puts the server-seen local desktop first and dedupes its echo", () => {
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
          native_connected: true,
          status: "online",
          web_connected: true,
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
  assert.equal(options[0].deviceName, "Server Echo");
  assert.equal(options[0].isLocal, true);
  assert.equal(options[0].liveState, "live");
  assert.equal(options[0].nativeConnected, true);
  assert.equal(options[0].webConnected, true);
  assert.equal(options[0].serverSeen, true);
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

test("device switcher aliases local profile to the canonical server device", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    currentWorkspaceId: "ws-local",
    currentWorkspaceName: "Main repo",
    deviceLiveState: {
      devices: [
        {
          device_aliases: ["desktop-local", "web-local"],
          device_id: "server-device",
          device_name: "Syed MacBook Air",
          form_factor: "desktop",
          native_connected: true,
          status: "online",
          web_connected: true,
          web_device_id: "web-local",
          workspaces: [{ workspace_id: "ws-local", workspace_name: "Main repo" }],
        },
      ],
    },
    localProfile: {
      device_id: "desktop-local",
      device_name: "Local Rig",
      form_factor: "desktop",
    },
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].deviceId, "server-device");
  assert.equal(options[0].deviceName, "Syed MacBook Air");
  assert.equal(options[0].isLocal, true);
  assert.equal(options[0].isCurrentWorkspace, true);
  assert.equal(options[0].nativeConnected, true);
  assert.equal(options[0].webConnected, true);
  assert.deepEqual(options[0].deviceAliases.sort(), ["desktop-local", "server-device", "web-local"].sort());
});

test("device switcher collapses local desktop workspace echoes to the current workspace", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    currentWorkspaceId: "ws-current",
    currentWorkspaceName: "Coding core",
    deviceLiveState: {
      devices: [
        {
          device_id: "macos-local",
          native_connected: true,
          status: "online",
          web_connected: true,
          workspaces: [
            { workspace_id: "ws-stale" },
            { workspace_id: "ws-current", workspace_name: "Coding core" },
          ],
        },
      ],
    },
    localProfile: {
      device_id: "macos-local",
      device_name: "Syed MacBook Air",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].deviceId, "macos-local");
  assert.equal(options[0].deviceName, "Syed MacBook Air");
  assert.equal(options[0].isLocal, true);
  assert.equal(options[0].workspaceId, "ws-current");
  assert.equal(options[0].workspaceName, "Coding core");
  assert.equal(options[0].nativeConnected, true);
  assert.equal(options[0].webConnected, true);
  assert.equal(options[0].platformLabel, "macos");
});

test("device switcher does not invent local device rows when server roster is present", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    currentWorkspaceId: "ws-local",
    deviceLiveState: {
      devices: [
        {
          device_id: "server-remote",
          device_name: "Studio Mac",
          status: "online",
        },
      ],
    },
    localProfile: {
      device_id: "desktop-local",
      device_name: "Local Rig",
      form_factor: "desktop",
    },
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].deviceId, "server-remote");
  assert.equal(options[0].isLocal, false);
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

test("workspaceTodos filtering accepts selected device aliases", () => {
  const items = workspaceTodoItemsForDeviceWorkspace({
    itemsByWorkspace: {
      "ws-local": [
        {
          deviceId: "desktop-local",
          status: "listed",
          text: "Local alias todo",
          todoId: "todo-local",
          workspaceId: "ws-local",
        },
      ],
    },
  }, {
    deviceAliases: ["server-device", "desktop-local"],
    deviceId: "server-device",
    workspaceId: "ws-local",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].todoId, "todo-local");
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

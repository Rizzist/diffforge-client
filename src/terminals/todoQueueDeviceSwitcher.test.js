import assert from "node:assert/strict";
import test from "node:test";

import {
  TODO_QUEUE_DEVICE_KIND_MOBILE,
  buildAccountLiveDeviceRows,
  buildDevicesGraphModel,
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

test("device switcher keeps web-sourced roster native badge tied to native_connected", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    currentWorkspaceId: "ws-local",
    currentWorkspaceName: "Coding core",
    deviceLiveState: {
      devices: [
        {
          client_kind: "next-dashboard",
          connected: true,
          device_id: "desktop-local",
          device_name: "Syed's MacBook Air",
          platform: "macos",
          web_connected: true,
          workspaces: [{ workspace_id: "ws-local", workspace_name: "Coding core" }],
        },
      ],
    },
    localProfile: {
      device_id: "desktop-local",
      device_name: "Syed's MacBook Air",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].deviceId, "desktop-local");
  assert.equal(options[0].deviceName, "Syed's MacBook Air");
  assert.equal(options[0].isLocal, true);
  assert.equal(options[0].liveState, "live");
  assert.equal(options[0].nativeConnected, false);
  assert.equal(options[0].webConnected, true);
  assert.equal(options[0].workspaceId, "ws-local");
});

test("device switcher treats generic connected browser rows as web live", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    currentWorkspaceId: "ws-local",
    currentWorkspaceName: "Coding core",
    deviceLiveState: {
      devices: [
        {
          client_kind: "next-dashboard",
          connected: true,
          device_id: "desktop-local",
          device_name: "Syed's MacBook Air",
          platform: "macos",
          web_presence: {
            web_device_id: "web-macos-desktop-chrome",
          },
          workspaces: [{ workspace_id: "ws-local", workspace_name: "Coding core" }],
        },
      ],
    },
    localProfile: {
      device_id: "desktop-local",
      device_name: "Syed's MacBook Air",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].deviceId, "desktop-local");
  assert.equal(options[0].liveState, "live");
  assert.equal(options[0].nativeConnected, false);
  assert.equal(options[0].webConnected, true);
});

test("device switcher reads account live-state device maps and connection-summary surfaces", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    currentWorkspaceId: "ws-local",
    currentWorkspaceName: "Coding core",
    deviceLiveState: {
      accountDeviceLiveStateSnapshot: {
        client_connection: {
          active_desktop_devices: [
            {
              device_id: "desktop-local",
              device_name: "Syed's MacBook Air",
              form_factor: "desktop",
              native_connected: true,
              platform: "macos",
            },
          ],
        },
        devices: {
          "desktop-local": {
            device_id: "desktop-local",
            device_name: "Syed's MacBook Air",
            form_factor: "desktop",
            native_connected: true,
            status: "connected",
            web_connected: true,
            workspaces: {
              "ws-local": { workspace_id: "ws-local", workspace_name: "Coding core" },
            },
          },
        },
      },
    },
    localProfile: {
      device_id: "desktop-local",
      device_name: "Syed's MacBook Air",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].deviceId, "desktop-local");
  assert.equal(options[0].liveState, "live");
  assert.equal(options[0].nativeConnected, true);
  assert.equal(options[0].webConnected, true);
  assert.equal(options[0].workspaceId, "ws-local");
});

test("device switcher folds targeted web connection summaries into the canonical native device", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    deviceLiveState: {
      account_device_live_state_snapshot: {
        client_connection: {
          active_web_devices: [
            {
              connected: true,
              device_id: "web-macos-chrome",
              device_name: "Device 4",
              source: "next-diffforge-dashboard",
              target_device_id: "desktop-local",
              web_connected: true,
              web_device_id: "web-macos-chrome",
            },
          ],
        },
        devices: {
          "desktop-local": {
            device_id: "desktop-local",
            device_name: "Syed's MacBook Air",
            native_connected: true,
            status: "connected",
            web_connected: true,
          },
        },
      },
    },
    localProfile: {
      device_id: "desktop-local",
      device_name: "Syed's MacBook Air",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].deviceId, "desktop-local");
  assert.equal(options[0].deviceName, "Syed's MacBook Air");
  assert.equal(options[0].isLocal, true);
  assert.equal(options[0].nativeConnected, true);
  assert.equal(options[0].webConnected, true);
  assert.deepEqual(options[0].deviceAliases.sort(), ["desktop-local", "web-macos-chrome"].sort());
});

test("device switcher suppresses generic web-only echoes when the native device already has web presence", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    deviceLiveState: {
      account_device_live_state_snapshot: {
        client_connection: {
          active_web_devices: [
            {
              connected: true,
              device_id: "web-dashboard-1",
              device_name: "Device 4",
              source: "next-diffforge-dashboard",
              web_connected: true,
              web_device_id: "web-dashboard-1",
            },
            {
              connected: true,
              device_id: "web-dashboard-2",
              device_name: "This device",
              source: "next-diffforge-dashboard",
              web_connected: true,
              web_device_id: "web-dashboard-2",
            },
          ],
        },
        devices: {
          "desktop-local": {
            device_id: "desktop-local",
            device_name: "Syed's MacBook Air",
            native_connected: true,
            status: "connected",
            web_connected: true,
          },
        },
      },
    },
    localProfile: {
      device_id: "desktop-local",
      device_name: "Syed's MacBook Air",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].deviceId, "desktop-local");
  assert.equal(options[0].nativeConnected, true);
  assert.equal(options[0].webConnected, true);
  assert.deepEqual(options[0].deviceAliases.sort(), ["desktop-local", "web-dashboard-1", "web-dashboard-2"].sort());
});

test("device switcher keeps registered inventory identity while overlaying web sessions", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    deviceLiveState: {
      account_device_live_state_snapshot: {
        client_connection: {
          active_web_devices: [
            {
              connected: true,
              device_id: "web-phone-browser",
              device_name: "This device",
              platform: "android",
              source: "next-diffforge-dashboard",
              target_device_id: "desktop-local",
              web_connected: true,
              web_device_id: "web-phone-browser",
            },
          ],
        },
        devices: {
          "desktop-local": {
            device_id: "desktop-local",
            device_name: "Syed's MacBook Air",
            form_factor: "pc",
            native_connected: true,
            platform: "macos",
            status: "connected",
            web_connected: true,
          },
          "android-phone": {
            device_id: "android-phone",
            device_name: "Samsung Galaxy S23 Ultra",
            form_factor: "mobile",
            native_connected: false,
            platform: "android",
            status: "offline",
            web_connected: false,
          },
        },
      },
    },
    localProfile: {
      device_id: "desktop-local",
      device_name: "This device",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.equal(options.length, 2);
  assert.equal(options[0].deviceId, "desktop-local");
  assert.equal(options[0].deviceName, "Syed's MacBook Air");
  assert.equal(options[0].platformLabel, "macos");
  assert.equal(options[0].formFactorLabel, "pc");
  assert.equal(options[0].nativeConnected, true);
  assert.equal(options[0].webConnected, true);
  assert.equal(options[1].deviceId, "android-phone");
  assert.equal(options[1].deviceName, "Samsung Galaxy S23 Ultra");
  assert.equal(options[1].platformLabel, "android");
  assert.equal(options[1].formFactorLabel, "mobile");
  assert.equal(options[1].nativeConnected, false);
  assert.equal(options[1].webConnected, false);
  assert.equal(options[1].liveState, "offline");
});

test("device switcher drops generic web-only workspace rows when registered inventory exists", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    deviceLiveState: {
      account_device_live_state_snapshot: {
        devices: {
          "desktop-local": {
            device_id: "desktop-local",
            device_name: "Syed's MacBook Air",
            form_factor: "pc",
            native_connected: true,
            platform: "macos",
            status: "connected",
            web_connected: true,
          },
          "android-phone": {
            device_id: "android-phone",
            device_name: "Samsung Galaxy S23 Ultra",
            form_factor: "mobile",
            native_connected: false,
            platform: "android",
            status: "offline",
            web_connected: false,
          },
          "web-current-browser": {
            client_kind: "web",
            device_id: "web-current-browser",
            device_name: "This device",
            source: "next-diffforge-dashboard",
            status: "connected",
            web_connected: true,
            workspace_id: "ws-web",
            workspace_name: "Browser workspace echo",
          },
        },
      },
    },
    localProfile: {
      device_id: "desktop-local",
      device_name: "This device",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.equal(options.length, 2);
  assert.ok(options.every((option) => option.deviceName !== "This device"));
  assert.ok(options.every((option) => option.deviceId !== "web-current-browser"));
  assert.ok(options.some((option) => (
    option.deviceId === "desktop-local"
      && option.workspaceId === "ws-web"
      && option.workspaceName === "Browser workspace echo"
      && option.webConnected === true
  )));
  assert.ok(options.some((option) => (
    option.deviceId === "android-phone"
      && option.deviceName === "Samsung Galaxy S23 Ultra"
      && option.liveState === "offline"
  )));
});

test("device switcher uses next registered device payload as the stable inventory", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    deviceLiveState: {
      account_device_live_state_snapshot: {
        registered_devices: {
          account_id: "user-1",
          authoritative: true,
          count: 2,
          items: [
            {
              device_id: "desktop-local",
              device_name: "Syed's MacBook Air",
              form_factor: "pc",
              native_connected: true,
              platform: "macos",
              status: "connected",
              web_connected: false,
            },
            {
              device_id: "android-phone",
              device_name: "Samsung Galaxy S23 Ultra",
              form_factor: "mobile",
              native_connected: false,
              platform: "android",
              status: "offline",
              web_connected: false,
            },
          ],
          registered_count: 2,
          scope: "cloud_current_sqlite",
        },
        devices: {
          "web-current-browser": {
            client_kind: "web",
            device_id: "web-current-browser",
            device_name: "This device",
            source: "next-diffforge-dashboard",
            status: "offline",
            web_connected: false,
          },
        },
      },
    },
    localProfile: {
      device_id: "unmatched-local-profile",
      device_name: "This device",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.equal(options.length, 2);
  assert.deepEqual(options.map((option) => option.deviceName), [
    "Syed's MacBook Air",
    "Samsung Galaxy S23 Ultra",
  ]);
  assert.ok(options.every((option) => option.deviceId !== "web-current-browser"));
  assert.ok(options.every((option) => option.deviceName !== "This device"));
  assert.equal(options.find((option) => option.deviceId === "desktop-local")?.webConnected, false);
  assert.equal(options.find((option) => option.deviceId === "android-phone")?.liveState, "offline");
});

test("device switcher keeps app-shell registered inventory over live generic rows", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    connectedDevices: [
      {
        device_id: "desktop-local",
        device_name: "Syed's MacBook Air",
        native_connected: false,
        status: "connected",
        web_connected: false,
      },
      {
        client_kind: "next-dashboard",
        device_id: "web-current-browser",
        device_name: "This device",
        source: "next-diffforge-dashboard",
        status: "connected",
        web_connected: true,
      },
    ],
    knownDevices: [
      {
        device_id: "desktop-local",
        device_name: "Syed's MacBook Air",
        form_factor: "pc",
        native_connected: true,
        platform: "macos",
        registered: true,
        status: "connected",
        web_connected: false,
      },
      {
        device_id: "android-phone",
        device_name: "Samsung Galaxy S23 Ultra",
        form_factor: "mobile",
        native_connected: false,
        platform: "android",
        registered: true,
        status: "offline",
        web_connected: false,
      },
    ],
    localProfile: {
      device_id: "desktop-local",
      device_name: "This device",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.deepEqual(options.map((option) => option.deviceName), [
    "Syed's MacBook Air",
    "Samsung Galaxy S23 Ultra",
  ]);
  assert.ok(options.every((option) => option.deviceName !== "This device"));
  assert.ok(options.every((option) => option.deviceId !== "web-current-browser"));
  assert.equal(options.find((option) => option.deviceId === "desktop-local")?.nativeConnected, true);
  assert.equal(options.find((option) => option.deviceId === "desktop-local")?.webConnected, false);
  assert.equal(options.find((option) => option.deviceId === "android-phone")?.liveState, "offline");
});

test("device switcher lets account live-state surface flags override stale connected devices", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    connectedDevices: [
      {
        device_id: "desktop-local",
        device_name: "Syed's MacBook Air",
        native_connected: true,
        web_connected: true,
      },
    ],
    currentWorkspaceId: "ws-local",
    currentWorkspaceName: "Coding core",
    deviceLiveState: {
      account_device_live_state_snapshot: {
        devices: {
          "desktop-local": {
            device_id: "desktop-local",
            device_name: "Syed's MacBook Air",
            native_connected: false,
            status: "connected",
            web_connected: true,
            workspaces: {
              "ws-local": { workspace_id: "ws-local", workspace_name: "Coding core" },
            },
          },
        },
      },
    },
    localProfile: {
      device_id: "desktop-local",
      device_name: "Syed's MacBook Air",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].deviceId, "desktop-local");
  assert.equal(options[0].liveState, "live");
  assert.equal(options[0].nativeConnected, false);
  assert.equal(options[0].webConnected, true);
  assert.equal(options[0].workspaceId, "ws-local");
});

test("device switcher lights native from account connection summary overlay", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    deviceLiveState: {
      account_device_live_state_snapshot: {
        account_id: "acct-1",
        client_id: "rust-diffforge-agent",
        client_connection: {
          active_desktop_device_ids: ["desktop-local"],
          active_desktop_devices: [
            {
              device_id: "desktop-local",
              machine_id: "desktop-local",
              native_connected: true,
              status: "connected",
            },
          ],
        },
        devices: {
          "desktop-local": {
            device_id: "desktop-local",
            device_name: "Syed's MacBook Air",
            native_connected: false,
            status: "connected",
            web_connected: true,
          },
        },
        registered_devices: {
          items: [
            {
              device_id: "desktop-local",
              device_name: "Syed's MacBook Air",
              form_factor: "pc",
              native_connected: false,
              platform: "macos",
              registered: true,
              status: "connected",
              web_connected: true,
            },
          ],
        },
      },
    },
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].deviceName, "Syed's MacBook Air");
  assert.equal(options[0].liveState, "live");
  assert.equal(options[0].nativeConnected, true);
  assert.equal(options[0].webConnected, true);
  assert.deepEqual(options[0].surfaces.map(({ id, active }) => [id, active]), [
    ["native", true],
    ["web", true],
  ]);
});

test("device switcher keeps registered roster while partial live updates light desktop surfaces", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    connectedDevices: [
      {
        device_id: "desktop-local",
        device_name: "Syed's MacBook Air",
        native_connected: false,
        status: "connected",
        web_connected: true,
      },
    ],
    deviceLiveState: {
      account_device_live_state_snapshot: {
        account_id: "acct-1",
        client_id: "rust-diffforge-agent",
        client_connection: {
          active_desktop_device_ids: ["desktop-local"],
          active_desktop_devices: [
            {
              device_id: "desktop-local",
              machine_id: "desktop-local",
              native_connected: true,
              status: "connected",
            },
          ],
        },
        devices: {
          "desktop-local": {
            device_id: "desktop-local",
            device_name: "Syed's MacBook Air",
            native_connected: false,
            status: "connected",
            web_connected: true,
          },
        },
      },
    },
    knownDevices: [
      {
        device_id: "desktop-local",
        device_name: "Syed's MacBook Air",
        form_factor: "pc",
        native_connected: false,
        platform: "macos",
        registered: true,
        status: "connected",
        web_connected: false,
      },
      {
        device_id: "android-phone",
        device_name: "Samsung Galaxy S23 Ultra",
        form_factor: "mobile",
        native_connected: false,
        platform: "android",
        registered: true,
        status: "offline",
        web_connected: false,
      },
    ],
    localProfile: {
      device_id: "desktop-local",
      device_name: "This device",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.deepEqual(options.map((option) => option.deviceName), [
    "Syed's MacBook Air",
    "Samsung Galaxy S23 Ultra",
  ]);
  const mac = options.find((option) => option.deviceId === "desktop-local");
  const phone = options.find((option) => option.deviceId === "android-phone");
  assert.equal(mac?.nativeConnected, true);
  assert.equal(mac?.webConnected, true);
  assert.equal(mac?.liveState, "live");
  assert.deepEqual(mac?.surfaces.map(({ id, active }) => [id, active]), [
    ["native", true],
    ["web", true],
  ]);
  assert.equal(phone?.nativeConnected, false);
  assert.equal(phone?.webConnected, false);
  assert.equal(phone?.liveState, "offline");
});

test("account devices rows mirror dashboard registry with live overlays", () => {
  const rows = buildAccountLiveDeviceRows({
    connectedDevices: [
      {
        device_id: "desktop-local",
        device_name: "Syed's MacBook Air",
        native_connected: false,
        status: "connected",
        web_connected: true,
      },
    ],
    deviceLiveState: {
      account_device_live_state_snapshot: {
        account_id: "acct-1",
        client_id: "rust-diffforge-agent",
        client_connection: {
          active_desktop_device_ids: ["desktop-local"],
          active_desktop_devices: [
            {
              device_id: "desktop-local",
              machine_id: "desktop-local",
              native_connected: true,
              status: "connected",
            },
          ],
          active_web_target_device_ids: ["desktop-local"],
        },
        devices: {
          "desktop-local": {
            device_id: "desktop-local",
            device_name: "Syed's MacBook Air",
            native_connected: false,
            status: "connected",
            web_connected: true,
          },
        },
        registered_devices: {
          items: [
            {
              device_id: "desktop-local",
              device_name: "Syed's MacBook Air",
              form_factor: "pc",
              native_connected: false,
              platform: "macos",
              registered: true,
              status: "connected",
              web_connected: false,
            },
            {
              device_id: "android-phone",
              device_name: "Samsung Galaxy S23 Ultra",
              form_factor: "mobile",
              native_connected: false,
              platform: "android",
              registered: true,
              status: "offline",
              web_connected: false,
            },
          ],
        },
      },
    },
    knownDevices: [],
    localProfile: {
      device_id: "desktop-local",
      device_name: "This device",
      form_factor: "desktop",
      platform: "macos",
    },
  });

  assert.deepEqual(rows.map((row) => row.deviceName), [
    "Syed's MacBook Air",
    "Samsung Galaxy S23 Ultra",
  ]);
  assert.equal(rows.length, 2);
  const mac = rows.find((row) => row.deviceId === "desktop-local");
  const phone = rows.find((row) => row.deviceId === "android-phone");
  assert.equal(mac?.nativeConnected, true);
  assert.equal(mac?.webConnected, true);
  assert.equal(mac?.isLocal, true);
  assert.equal(phone?.nativeConnected, false);
  assert.equal(phone?.webConnected, false);
  assert.equal(phone?.liveState, "offline");
});

test("device switcher treats false server surface flags as offline despite generic connected", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    deviceLiveState: {
      devices: [
        {
          connected: true,
          device_id: "desktop-offline",
          device_name: "Sleeping Mac",
          native_connected: false,
          status: "connected",
          web_connected: false,
        },
      ],
    },
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].deviceId, "desktop-offline");
  assert.equal(options[0].connected, false);
  assert.equal(options[0].liveState, "offline");
  assert.equal(options[0].nativeConnected, false);
  assert.equal(options[0].webConnected, false);
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

test("workspaceTodos filtering ignores null device selections", () => {
  const items = workspaceTodoItemsForDeviceWorkspace({
    itemsByWorkspace: {
      "ws-local": [
        {
          deviceId: "desktop-local",
          status: "listed",
          text: "Local todo",
          todoId: "todo-local",
          workspaceId: "ws-local",
        },
      ],
    },
  }, null);

  assert.deepEqual(items, []);
});

test("devices graph model preserves device, workspace, terminal, tool, and todo status", () => {
  const graph = buildDevicesGraphModel({
    deviceLiveState: {
      account_device_live_state_snapshot: {
        account_name: "Acme Corp",
        devices: {
          "desktop-local": {
            device_id: "desktop-local",
            device_name: "Local Mac",
            form_factor: "desktop",
            native_connected: true,
            platform: "macos",
            status: "connected",
            web_connected: true,
            workspaces: {
              "ws-app": {
                mcps: [{ status: "ready" }],
                servers: [{ status: "running" }],
                terminals: [
                  { activity_status: "running", terminal_index: 0 },
                  { activity_status: "idle", terminal_index: 1 },
                ],
                workspace_active: true,
                workspace_id: "ws-app",
                workspace_name: "mobile-app",
                workspace_status: "active",
              },
            },
          },
          "studio-pc": {
            device_id: "studio-pc",
            device_name: "Studio PC",
            form_factor: "pc",
            native_connected: false,
            status: "offline",
            web_connected: false,
            workspaces: {
              "ws-infra": {
                workspace_id: "ws-infra",
                workspace_name: "infra-tools",
                workspace_status: "idle",
              },
            },
          },
        },
      },
    },
    localProfile: {
      device_id: "desktop-local",
      device_name: "Local Mac",
      form_factor: "desktop",
      platform: "macos",
    },
    workspaceTodos: {
      itemsByWorkspace: {
        "ws-app": [
          {
            deviceId: "desktop-local",
            status: "listed",
            text: "Build graph",
            todoId: "todo-1",
            workspaceId: "ws-app",
          },
          {
            deviceId: "desktop-local",
            status: "deleted",
            text: "Discarded",
            todoId: "todo-2",
            workspaceId: "ws-app",
          },
        ],
      },
    },
  });

  assert.equal(graph.account.name, "Acme Corp");
  assert.equal(graph.totals.deviceCount, 2);
  assert.equal(graph.totals.workspaceCount, 2);
  assert.equal(graph.totals.terminalCount, 2);
  assert.equal(graph.totals.toolCount, 2);
  assert.equal(graph.totals.todoCount, 1);
  const localDevice = graph.devices.find((device) => device.deviceId === "desktop-local");
  assert.equal(localDevice.isLocal, true);
  assert.equal(localDevice.liveState, "live");
  assert.equal(localDevice.nativeConnected, true);
  assert.equal(localDevice.webConnected, true);
  assert.equal(localDevice.workspaceCount, 1);
  assert.equal(localDevice.workspaces[0].status, "active");
  assert.equal(localDevice.workspaces[0].terminalCount, 2);
  assert.equal(localDevice.workspaces[0].terminalStatusCounts.busy, 1);
  assert.equal(localDevice.workspaces[0].toolCount, 2);
  assert.equal(localDevice.workspaces[0].todoCount, 1);
  const remoteDevice = graph.devices.find((device) => device.deviceId === "studio-pc");
  assert.equal(remoteDevice.liveState, "offline");
  assert.equal(remoteDevice.workspaces[0].status, "idle");
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
  assert.equal(todoQueueDeviceSelectionIsLocalEditable({
    deviceKind: "desktop",
    isLocal: true,
    workspaceId: "",
  }, ""), false);
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  TODO_QUEUE_DEVICE_KIND_MOBILE,
  buildAccountLiveDeviceRows,
  buildDevicesGraphModel,
  buildTodoQueueHydratedSnapshotRows,
  buildTodoQueueDisplayedSelectionArrays,
  buildTodoQueueDeviceWorkspaceOptions,
  normalizeTodoQueueSwitcherId,
  normalizeTodoQueueWorkspaceMatchId,
  todoQueueDeviceRecordsShareIdentity,
  todoQueueDeviceSelectionIsLocalEditable,
  todoQueueItemFromAuthoritativeSnapshot,
  workspaceTodoItemsForDeviceWorkspace,
} from "./todoQueueDeviceSwitcher.js";

test("device rows match workspace options through server and local aliases", () => {
  assert.equal(todoQueueDeviceRecordsShareIdentity(
    {
      device_aliases: ["DESKTOP-M87SHCL", "web-windows-rig"],
      device_id: "web-windows-rig",
    },
    {
      device_aliases: ["desktop-m87shcl"],
      device_id: "desktop-m87shcl",
    },
  ), true);
  assert.equal(todoQueueDeviceRecordsShareIdentity(
    { device_aliases: ["DESKTOP-M87SHCL"], device_id: "web-windows-rig" },
    { device_aliases: ["syeds-macbook-air"], device_id: "mac-local" },
  ), false);
});

test("device switcher puts the server-seen local desktop first and dedupes its echo", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    connectedDevices: [
      {
        connected: true,
        device_id: "desktop-local",
        display_name: "Server Echo",
        form_factor: "desktop",
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

  assert.equal(options[0].device_id, "desktop-local");
  assert.equal(options[0].device_name, "Server Echo");
  assert.equal(options[0].is_local, true);
  assert.equal(options[0].liveState, "live");
  assert.equal(options[0].native_connected, true);
  assert.equal(options[0].web_connected, true);
  assert.equal(options[0].serverSeen, true);
  assert.equal(
    options.filter((option) => option.device_id === "desktop-local" && option.workspace_id === "ws-local").length,
    1,
  );
  assert.ok(options.some((option) => (
    option.device_id === "desktop-remote"
      && option.workspace_id === "ws-remote"
      && option.workspace_name === "Remote repo"
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
  assert.equal(options[0].device_id, "server-device");
  assert.equal(options[0].device_name, "Syed MacBook Air");
  assert.equal(options[0].is_local, true);
  assert.equal(options[0].isCurrentWorkspace, true);
  assert.equal(options[0].native_connected, true);
  assert.equal(options[0].web_connected, true);
  assert.deepEqual(options[0].device_aliases.sort(), ["desktop-local", "server-device", "web-local"].sort());
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
  assert.equal(options[0].device_id, "macos-local");
  assert.equal(options[0].device_name, "Syed MacBook Air");
  assert.equal(options[0].is_local, true);
  assert.equal(options[0].workspace_id, "ws-current");
  assert.equal(options[0].workspace_name, "Coding core");
  assert.equal(options[0].native_connected, true);
  assert.equal(options[0].web_connected, true);
  assert.equal(options[0].platform_label, "macos");
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
  assert.equal(options[0].device_id, "desktop-local");
  assert.equal(options[0].device_name, "Syed's MacBook Air");
  assert.equal(options[0].is_local, true);
  assert.equal(options[0].liveState, "live");
  assert.equal(options[0].native_connected, false);
  assert.equal(options[0].web_connected, true);
  assert.equal(options[0].workspace_id, "ws-local");
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
  assert.equal(options[0].device_id, "desktop-local");
  assert.equal(options[0].liveState, "live");
  assert.equal(options[0].native_connected, false);
  assert.equal(options[0].web_connected, true);
});

test("device switcher reads account live-state device maps and connection-summary surfaces", () => {
  const options = buildTodoQueueDeviceWorkspaceOptions({
    currentWorkspaceId: "ws-local",
    currentWorkspaceName: "Coding core",
    deviceLiveState: {
      account_device_live_state_snapshot: {
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
  assert.equal(options[0].device_id, "desktop-local");
  assert.equal(options[0].liveState, "live");
  assert.equal(options[0].native_connected, true);
  assert.equal(options[0].web_connected, true);
  assert.equal(options[0].workspace_id, "ws-local");
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
  assert.equal(options[0].device_id, "desktop-local");
  assert.equal(options[0].device_name, "Syed's MacBook Air");
  assert.equal(options[0].is_local, true);
  assert.equal(options[0].native_connected, true);
  assert.equal(options[0].web_connected, true);
  assert.deepEqual(options[0].device_aliases.sort(), ["desktop-local", "web-macos-chrome"].sort());
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
  assert.equal(options[0].device_id, "desktop-local");
  assert.equal(options[0].native_connected, true);
  assert.equal(options[0].web_connected, true);
  assert.deepEqual(options[0].device_aliases.sort(), ["desktop-local", "web-dashboard-1", "web-dashboard-2"].sort());
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
  assert.equal(options[0].device_id, "desktop-local");
  assert.equal(options[0].device_name, "Syed's MacBook Air");
  assert.equal(options[0].platform_label, "macos");
  assert.equal(options[0].form_factor_label, "pc");
  assert.equal(options[0].native_connected, true);
  assert.equal(options[0].web_connected, true);
  assert.equal(options[1].device_id, "android-phone");
  assert.equal(options[1].device_name, "Samsung Galaxy S23 Ultra");
  assert.equal(options[1].platform_label, "android");
  assert.equal(options[1].form_factor_label, "mobile");
  assert.equal(options[1].native_connected, false);
  assert.equal(options[1].web_connected, false);
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
  assert.ok(options.every((option) => option.device_name !== "This device"));
  assert.ok(options.every((option) => option.device_id !== "web-current-browser"));
  assert.ok(options.some((option) => (
    option.device_id === "desktop-local"
      && option.workspace_id === "ws-web"
      && option.workspace_name === "Browser workspace echo"
      && option.web_connected === true
  )));
  assert.ok(options.some((option) => (
    option.device_id === "android-phone"
      && option.device_name === "Samsung Galaxy S23 Ultra"
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

  assert.equal(options.length, 3);
  assert.equal(options[0].device_id, "unmatched-local-profile");
  assert.equal(options[0].device_name, "This device");
  assert.equal(options[0].is_local, true);
  assert.deepEqual(options.slice(1).map((option) => option.device_name), [
    "Syed's MacBook Air",
    "Samsung Galaxy S23 Ultra",
  ]);
  assert.ok(options.every((option) => option.device_id !== "web-current-browser"));
  assert.ok(options.slice(1).every((option) => option.device_name !== "This device"));
  assert.equal(options.find((option) => option.device_id === "desktop-local")?.web_connected, false);
  assert.equal(options.find((option) => option.device_id === "android-phone")?.liveState, "offline");
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

  assert.deepEqual(options.map((option) => option.device_name), [
    "Syed's MacBook Air",
    "Samsung Galaxy S23 Ultra",
  ]);
  assert.ok(options.every((option) => option.device_name !== "This device"));
  assert.ok(options.every((option) => option.device_id !== "web-current-browser"));
  assert.equal(options.find((option) => option.device_id === "desktop-local")?.native_connected, true);
  assert.equal(options.find((option) => option.device_id === "desktop-local")?.web_connected, false);
  assert.equal(options.find((option) => option.device_id === "android-phone")?.liveState, "offline");
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
  assert.equal(options[0].device_id, "desktop-local");
  assert.equal(options[0].liveState, "live");
  assert.equal(options[0].native_connected, false);
  assert.equal(options[0].web_connected, true);
  assert.equal(options[0].workspace_id, "ws-local");
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
  assert.equal(options[0].device_name, "Syed's MacBook Air");
  assert.equal(options[0].liveState, "live");
  assert.equal(options[0].native_connected, true);
  assert.equal(options[0].web_connected, true);
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

  assert.deepEqual(options.map((option) => option.device_name), [
    "Syed's MacBook Air",
    "Samsung Galaxy S23 Ultra",
  ]);
  const mac = options.find((option) => option.device_id === "desktop-local");
  const phone = options.find((option) => option.device_id === "android-phone");
  assert.equal(mac?.native_connected, true);
  assert.equal(mac?.web_connected, true);
  assert.equal(mac?.liveState, "live");
  assert.deepEqual(mac?.surfaces.map(({ id, active }) => [id, active]), [
    ["native", true],
    ["web", true],
  ]);
  assert.equal(phone?.native_connected, false);
  assert.equal(phone?.web_connected, false);
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

  assert.deepEqual(rows.map((row) => row.device_name), [
    "Syed's MacBook Air",
    "Samsung Galaxy S23 Ultra",
  ]);
  assert.equal(rows.length, 2);
  const mac = rows.find((row) => row.device_id === "desktop-local");
  const phone = rows.find((row) => row.device_id === "android-phone");
  assert.equal(mac?.native_connected, true);
  assert.equal(mac?.web_connected, true);
  assert.equal(mac?.is_local, true);
  assert.equal(phone?.native_connected, false);
  assert.equal(phone?.web_connected, false);
  assert.equal(phone?.liveState, "offline");
});

test("identity-migrated registry rows sharing card_id collapse to one device", () => {
  // A machine that re-registered under a new native id (same physical device,
  // same card_id) must render as ONE card even when a stale row under the old
  // id is still present in the feed — the server-fold linking fields dedupe it.
  const rows = buildAccountLiveDeviceRows({
    knownDevices: [
      {
        device_id: "desktop-m87shcl",
        card_id: "card-win-1",
        physical_device_id: "card-win-1",
        device_name: "DESKTOP-M87SHCL",
        platform: "windows",
        registered: true,
        native_connected: true,
        status: "connected",
      },
      {
        device_id: "desktop-m87shcl-new",
        card_id: "card-win-1",
        physical_device_id: "card-win-1",
        device_name: "DESKTOP-M87SHCL",
        platform: "windows",
        registered: true,
        native_connected: true,
        status: "connected",
      },
    ],
    deviceLiveState: {
      account_device_live_state_snapshot: {
        registered_devices: {
          items: [
            {
              device_id: "desktop-m87shcl-new",
              card_id: "card-win-1",
              physical_device_id: "card-win-1",
              device_name: "DESKTOP-M87SHCL",
              platform: "windows",
              registered: true,
              native_connected: true,
              status: "connected",
            },
          ],
        },
      },
    },
    maxRows: "all",
  });
  const windows = rows.filter((row) => row.device_name === "DESKTOP-M87SHCL");
  assert.equal(windows.length, 1);
});

test("accumulated snapshots across workspace switches keep one row per physical device", () => {
  // Reproduces the workspace-switch duplication: each switch republishes a
  // fresh account snapshot, and (pre-fix) prior rows were re-injected forever.
  // Feed every raw item ever seen (mirroring that re-injection); with the
  // server-fold linking fields (card_id/physical_device_id), an id migration
  // across snapshots collapses instead of spawning a duplicate card.
  const macItem = {
    device_id: "desktop-local",
    card_id: "card-mac-1",
    physical_device_id: "card-mac-1",
    device_name: "Syed's MacBook Air",
    platform: "macos",
    registered: true,
    native_connected: true,
    status: "connected",
  };
  const winItem = (k) => ({
    device_id: k < 2 ? "desktop-m87shcl" : "desktop-m87shcl-new",
    card_id: "card-win-1",
    physical_device_id: "card-win-1",
    device_name: "DESKTOP-M87SHCL",
    platform: "windows",
    registered: true,
    native_connected: true,
    status: "connected",
  });
  const seenItems = [];
  for (let k = 0; k < 5; k += 1) {
    const items = [macItem, winItem(k)];
    seenItems.push(...items);
    const rows = buildAccountLiveDeviceRows({
      knownDevices: seenItems.slice(),
      deviceLiveState: {
        account_device_live_state_snapshot: {
          registered_devices: { items },
        },
      },
      localProfile: {
        device_id: "desktop-local",
        card_id: "card-mac-1",
        device_name: "This device",
        platform: "macos",
      },
      maxRows: "all",
    });
    const names = rows.map((row) => row.device_name);
    assert.equal(
      rows.length,
      2,
      `iteration ${k}: expected exactly 2 device rows, got ${rows.length} (${names.join(", ")})`,
    );
    assert.equal(
      new Set(names).size,
      names.length,
      `iteration ${k}: duplicate device names ${names.join(", ")}`,
    );
  }
});

test("account devices rows include an unmatched local profile with registered inventory", () => {
  const rows = buildAccountLiveDeviceRows({
    deviceLiveState: {
      account_device_live_state_snapshot: {
        registered_devices: {
          items: [
            {
              device_id: "studio-pc",
              device_name: "Studio PC",
              form_factor: "desktop",
              native_connected: false,
              platform: "windows",
              registered: true,
              status: "offline",
              web_connected: false,
            },
          ],
        },
      },
    },
    localProfile: {
      device_id: "native-local-device",
      device_name: "Local Rig",
      form_factor: "desktop",
      platform: "macos",
    },
    maxRows: "all",
  });

  const local = rows.find((row) => row.device_id === "native-local-device");
  const remote = rows.find((row) => row.device_id === "studio-pc");

  assert.equal(rows[0].device_id, "native-local-device");
  assert.equal(local?.is_local, true);
  assert.equal(local?.device_kind, "desktop");
  assert.equal(local?.serverSeen, false);
  assert.equal(remote?.registered, true);
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
  assert.equal(options[0].device_id, "desktop-offline");
  assert.equal(options[0].connected, false);
  assert.equal(options[0].liveState, "offline");
  assert.equal(options[0].native_connected, false);
  assert.equal(options[0].web_connected, false);
});

test("device switcher does not invent local device rows without a local profile when server roster is present", () => {
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
    localProfile: null,
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].device_id, "server-remote");
  assert.equal(options[0].is_local, false);
});

test("device switcher keeps an unmatched local profile editable despite local mirror rows", () => {
  const currentWorkspaceId = "ws-local";
  const workspaceTodos = {
    source: "local_todo_mirror",
    dispatches_by_workspace: [{
      workspace_id: currentWorkspaceId,
      workspace_name: "Main repo",
      items: [{
        mirror_row_kind: "dispatch",
        status: "pending",
        target: {
          device_id: "stale-server-device",
          workspace_id: currentWorkspaceId,
        },
        target_device_id: "stale-server-device",
        target_workspace_id: currentWorkspaceId,
        text: "Stale mirror recipient",
        todo_id: "mirror-1",
      }],
    }],
  };
  const options = buildTodoQueueDeviceWorkspaceOptions({
    currentWorkspaceId,
    currentWorkspaceName: "Main repo",
    localProfile: {
      device_id: "native-local-device",
      device_name: "Local Rig",
      form_factor: "desktop",
      platform: "macos",
    },
    workspace_todos: workspaceTodos,
  });

  assert.equal(options[0].device_id, "native-local-device");
  assert.equal(options[0].is_local, true);
  assert.equal(options[0].workspace_id, currentWorkspaceId);
  assert.equal(options[0].workspace_name, "Main repo");
  assert.equal(options[0].isCurrentWorkspace, true);
  assert.equal(todoQueueDeviceSelectionIsLocalEditable(options[0], currentWorkspaceId), true);
  assert.ok(options.some((option) => (
    option.device_id === "stale-server-device"
      && option.is_local === false
  )));

  const displayed = buildTodoQueueDisplayedSelectionArrays({
    editable: todoQueueDeviceSelectionIsLocalEditable(options[0], currentWorkspaceId),
    items: [{ id: "own-native-todo", text: "Native own todo" }],
    selection: options[0],
    workspace_todos: workspaceTodos,
  });

  assert.deepEqual(displayed.items, [{ id: "own-native-todo", text: "Native own todo" }]);
  assert.deepEqual(displayed.peerItems, []);
});

test("device switcher preserves mirror selection behavior without a local profile", () => {
  const currentWorkspaceId = "ws-local";
  const options = buildTodoQueueDeviceWorkspaceOptions({
    currentWorkspaceId,
    currentWorkspaceName: "Main repo",
    localProfile: null,
    workspace_todos: {
      source: "local_todo_mirror",
      dispatches_by_workspace: [{
        workspace_id: currentWorkspaceId,
        workspace_name: "Main repo",
        items: [{
          mirror_row_kind: "dispatch",
          status: "pending",
          target: {
            device_id: "stale-server-device",
            workspace_id: currentWorkspaceId,
          },
          target_device_id: "stale-server-device",
          target_workspace_id: currentWorkspaceId,
          text: "Stale mirror recipient",
          todo_id: "mirror-1",
        }],
      }],
    },
  });

  assert.equal(options.length, 1);
  assert.equal(options[0].device_id, "stale-server-device");
  assert.equal(options[0].is_local, false);
  assert.equal(todoQueueDeviceSelectionIsLocalEditable(options[0], currentWorkspaceId), false);
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
  const mobile = options.find((option) => option.device_id === "phone-1");

  assert.equal(mobile.device_kind, TODO_QUEUE_DEVICE_KIND_MOBILE);
  assert.equal(mobile.workspace_id, "");
  assert.equal(mobile.liveState, "live");
});

test("workspaceTodos filtering keeps only the selected source device and workspace", () => {
  const items = workspaceTodoItemsForDeviceWorkspace({
    items_by_workspace: {
      "ws-remote": [
        {
          device_id: "desktop-remote",
          status: "listed",
          text: "Remote todo",
          todo_id: "todo-remote",
          workspace_id: "ws-remote",
        },
        {
          device_id: "desktop-local",
          status: "listed",
          text: "Local todo",
          todo_id: "todo-local",
          workspace_id: "ws-remote",
        },
        {
          device_id: "desktop-remote",
          status: "deleted",
          text: "Deleted todo",
          todo_id: "todo-deleted",
          workspace_id: "ws-remote",
        },
      ],
    },
  }, {
    device_id: "desktop-remote",
    workspace_id: "ws-remote",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].todo_id, "todo-remote");
});

test("workspaceTodos filtering accepts selected device aliases", () => {
  const items = workspaceTodoItemsForDeviceWorkspace({
    items_by_workspace: {
      "ws-local": [
        {
          device_id: "desktop-local",
          status: "listed",
          text: "Local alias todo",
          todo_id: "todo-local",
          workspace_id: "ws-local",
        },
      ],
    },
  }, {
    device_aliases: ["server-device", "desktop-local"],
    device_id: "server-device",
    workspace_id: "ws-local",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].todo_id, "todo-local");
});

test("workspaceTodos filtering ignores null device selections", () => {
  const items = workspaceTodoItemsForDeviceWorkspace({
    items_by_workspace: {
      "ws-local": [
        {
          device_id: "desktop-local",
          status: "listed",
          text: "Local todo",
          todo_id: "todo-local",
          workspace_id: "ws-local",
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
    workspace_todos: {
      items_by_workspace: {
        "ws-app": [
          {
            device_id: "desktop-local",
            status: "listed",
            text: "Build graph",
            todo_id: "todo-1",
            workspace_id: "ws-app",
          },
          {
            device_id: "desktop-local",
            status: "deleted",
            text: "Discarded",
            todo_id: "todo-2",
            workspace_id: "ws-app",
          },
        ],
      },
    },
  });

  assert.equal(graph.account.name, "Acme Corp");
  assert.equal(graph.totals.device_count, 2);
  assert.equal(graph.totals.workspace_count, 2);
  assert.equal(graph.totals.terminal_count, 2);
  assert.equal(graph.totals.tool_count, 2);
  assert.equal(graph.totals.todo_count, 1);
  const localDevice = graph.devices.find((device) => device.device_id === "desktop-local");
  assert.equal(localDevice.is_local, true);
  assert.equal(localDevice.liveState, "live");
  assert.equal(localDevice.native_connected, true);
  assert.equal(localDevice.web_connected, true);
  assert.equal(localDevice.workspace_count, 1);
  assert.equal(localDevice.workspaces[0].status, "active");
  assert.equal(localDevice.workspaces[0].terminal_count, 2);
  assert.equal(localDevice.workspaces[0].terminalStatusCounts.busy, 1);
  assert.equal(localDevice.workspaces[0].tool_count, 2);
  assert.equal(localDevice.workspaces[0].todo_count, 1);
  const remoteDevice = graph.devices.find((device) => device.device_id === "studio-pc");
  assert.equal(remoteDevice.liveState, "offline");
  assert.equal(remoteDevice.workspaces[0].status, "idle");
});

test("local desktop ownership controls editability instead of workspace mirror metadata", () => {
  assert.equal(todoQueueDeviceSelectionIsLocalEditable({
    device_kind: "desktop",
    is_local: true,
    workspace_id: "ws-local",
  }, "ws-local"), true);
  assert.equal(todoQueueDeviceSelectionIsLocalEditable({
    device_kind: "desktop",
    is_local: true,
    workspace_id: "ws-other",
  }, "ws-local"), true);
  assert.equal(todoQueueDeviceSelectionIsLocalEditable({
    device_kind: "desktop",
    is_local: false,
    workspace_id: "ws-local",
  }, "ws-local"), false);
  assert.equal(todoQueueDeviceSelectionIsLocalEditable({
    device_kind: "desktop",
    is_local: true,
    workspace_id: "",
  }, ""), true);
  assert.equal(todoQueueDeviceSelectionIsLocalEditable({
    device_kind: "mobile",
    is_local: true,
  }, ""), false);
});

test("Windows local workspace aliases stay editable and resolve mirrored todos", () => {
  const windowsWorkspaceId = "C:\\Users\\Rizzi\\Code\\DiffForge";
  const currentWorkspaceId = "c:/users/rizzi/code/diffforge/";
  const reportedDeviceId = "C:\\Users\\Rizzi\\Devices\\Windows-Rig";
  const localDeviceId = "c:/users/rizzi/devices/windows-rig";
  const options = buildTodoQueueDeviceWorkspaceOptions({
    currentWorkspaceId,
    currentWorkspaceName: "DiffForge",
    deviceLiveState: {
      devices: [{
        device_aliases: [reportedDeviceId, "web-windows-rig"],
        device_id: reportedDeviceId,
        form_factor: "Windows Desktop",
        native_connected: true,
        workspaces: [{
          device_id: reportedDeviceId,
          workspace_id: windowsWorkspaceId,
          workspace_name: "DiffForge",
        }],
      }],
    },
    localProfile: {
      device_id: localDeviceId,
      form_factor: "desktop",
      platform: "Windows",
    },
  });

  assert.equal(
    normalizeTodoQueueWorkspaceMatchId(windowsWorkspaceId, "Windows"),
    "c:/users/rizzi/code/diffforge",
  );
  assert.equal(
    normalizeTodoQueueSwitcherId(windowsWorkspaceId),
    "c__users_rizzi_code_diffforge",
  );
  assert.equal(
    normalizeTodoQueueSwitcherId(reportedDeviceId),
    normalizeTodoQueueSwitcherId(localDeviceId),
  );
  assert.equal(normalizeTodoQueueSwitcherId(`device:${"x".repeat(120)}`).length, 96);
  assert.notEqual(
    normalizeTodoQueueWorkspaceMatchId("/srv/Foo\\Bar", "linux"),
    normalizeTodoQueueWorkspaceMatchId("/srv/foo/bar", "linux"),
  );
  assert.equal(normalizeTodoQueueWorkspaceMatchId("C:\\Üser\\Repo", "windows"), "c:/üser/repo");
  assert.equal(options.length, 1);
  assert.equal(options[0].is_local, true);
  assert.equal(options[0].device_kind, "desktop");
  assert.equal(todoQueueDeviceSelectionIsLocalEditable(options[0], currentWorkspaceId), true);
  assert.equal(todoQueueDeviceSelectionIsLocalEditable({
    device_kind: "unknown",
    is_local: true,
    platform: "Windows",
    workspace_id: windowsWorkspaceId,
  }, currentWorkspaceId), true);

  const todos = workspaceTodoItemsForDeviceWorkspace({
    items_by_workspace: {
      [currentWorkspaceId]: [{
        mirror_row_kind: "dispatch",
        todo_device_id: "web-origin",
        todo_workspace_id: "web-origin-workspace",
        target_device_id: reportedDeviceId,
        target_workspace_id: windowsWorkspaceId,
        todo_id: "23",
        target: {
          device_id: reportedDeviceId,
          workspace_id: windowsWorkspaceId,
        },
        status: "pending",
        text: "Mirror this todo",
      }],
    },
  }, options[0]);
  assert.equal(todos.length, 1);
  assert.equal(todos[0].todo_id, "23");
});

test("displayed todo arrays render a production dispatch for its remote Windows recipient", () => {
  const recipientWorkspace = "C:\\Code\\Recipient";
  const displayed = buildTodoQueueDisplayedSelectionArrays({
    editable: false,
    items: [{ id: "local-only", text: "Must not render for remote selection" }],
    selection: {
      device_aliases: ["Windows-Rig"],
      device_id: "windows-rig",
      device_kind: "desktop",
      is_local: false,
      platform: "windows",
      workspace_id: "c:/code/recipient/",
    },
    workspace_todos: {
      dispatches_by_workspace: [{
        workspace_id: recipientWorkspace,
        items: [{
          mirror_row_kind: "dispatch",
          todo_device_id: "web-origin",
          todo_workspace_id: "web-origin-workspace",
          target_device_id: "Windows-Rig",
          target_workspace_id: recipientWorkspace,
          target: {
            device_id: "Windows-Rig",
            workspace_id: recipientWorkspace,
          },
          todo_id: "23",
          dispatch_status: "running",
          text: "Recipient-shaped mirror row",
        }],
      }],
    },
  });

  assert.equal(displayed.items.length, 1);
  assert.equal(displayed.items[0].id, "23");
  assert.equal(displayed.items[0].todo_device_id, "web-origin");
  assert.equal(displayed.items[0].target_device_id, "Windows-Rig");
  assert.equal(displayed.items[0].readOnly, true);
  assert.deepEqual(displayed.pendingItems, {});
  assert.deepEqual(displayed.peerItems, []);
});

test("targeted mirror rows belong only to the recipient device and workspace", () => {
  const workspaceTodos = {
    dispatches_by_workspace: [{
      workspace_id: "ws-recipient",
      items: [{
        dispatch_id: "dispatch-1",
        todo_device_id: "mac-source",
        todo_workspace_id: "ws-source",
        target_device_id: "windows-recipient",
        target_workspace_id: "ws-recipient",
        text: "Run remotely",
      }],
    }],
  };
  const recipientItems = workspaceTodoItemsForDeviceWorkspace(workspaceTodos, {
    device_id: "windows-recipient",
    workspace_id: "ws-recipient",
  });
  const sourceItems = workspaceTodoItemsForDeviceWorkspace(workspaceTodos, {
    device_id: "mac-source",
    workspace_id: "ws-source",
  });

  assert.equal(recipientItems.length, 1);
  assert.equal(sourceItems.length, 0);
});

test("todo_store_snapshot hydration keeps a Windows workspace across slash and drive case", () => {
  const hydratedRows = buildTodoQueueHydratedSnapshotRows({
    device_id: "Windows-Rig",
    platform: "windows",
    snapshot: {
      items: [{
        device_id: "windows-rig",
        id: "todo-23",
        text: "Hydrated on the Windows recipient",
        workspace_id: "C:\\Code\\Recipient",
      }],
    },
    workspace_id: "c:/code/recipient/",
  });

  assert.equal(hydratedRows.length, 1);
  assert.equal(hydratedRows[0].id, "todo-23");
  assert.equal(hydratedRows[0].workspace_id, "C:\\Code\\Recipient");
});

test("authoritative todo_store_snapshot absence removes hard-deleted webview rows", () => {
  const stale = {
    id: "todo-hard-deleted",
    remote_command: { command_id: "command-hard-deleted" },
  };

  assert.equal(todoQueueItemFromAuthoritativeSnapshot([], stale), null);
  assert.equal(
    todoQueueItemFromAuthoritativeSnapshot([{ id: "different-todo" }], stale),
    null,
  );
  assert.equal(
    todoQueueItemFromAuthoritativeSnapshot([{ id: "command-hard-deleted" }], stale)?.id,
    "command-hard-deleted",
  );
});

test("presence v2 prod shape: claimed_target_device_id never lights a badge", () => {
  // The cloud's v2 summary keeps the browser's declared operating target as a
  // routing-only claim under claimed_target_device_id; the badge-lighting
  // target_device_id carries the SERVER-VALIDATED resolution (an unlinked
  // browser targets its own standalone identity). A claim about a native
  // device must never light that device's WEB badge.
  const rows = buildAccountLiveDeviceRows({
    deviceLiveState: {
      account_device_live_state_snapshot: {
        client_connection: {
          active_desktop_device_ids: ["desktop-local"],
          active_web_device_ids: ["web-macos-chrome"],
          active_web_devices: [
            {
              active_count: 1,
              claimed_target_device_id: "desktop-local",
              device_id: "web-macos-chrome",
              target_device_id: "web-macos-chrome",
              web_device_id: "web-macos-chrome",
            },
          ],
          active_web_target_device_ids: ["web-macos-chrome"],
          web_connected: true,
        },
        registered_devices: {
          items: [
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
          ],
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
  const mac = rows.find((row) => row.device_id === "desktop-local");
  assert.equal(mac?.native_connected, true);
  assert.equal(
    mac?.web_connected,
    false,
    "a routing claim must not light the native device's WEB badge",
  );
});

test("presence v2 prod shape: linked browser lights the device WEB badge; disconnect darkens both", () => {
  // Linked shape: the server-validated target IS the native device — WEB lights.
  const registered_devices = {
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
    ],
  };
  const linkedRows = buildAccountLiveDeviceRows({
    deviceLiveState: {
      account_device_live_state_snapshot: {
        client_connection: {
          active_desktop_device_ids: ["desktop-local"],
          active_web_device_ids: ["web-macos-chrome"],
          active_web_devices: [
            {
              active_count: 1,
              device_id: "web-macos-chrome",
              target_device_id: "desktop-local",
              web_device_id: "web-macos-chrome",
            },
          ],
          active_web_target_device_ids: ["desktop-local"],
          web_connected: true,
        },
        registered_devices,
      },
    },
  });
  const linkedMac = linkedRows.find((row) => row.device_id === "desktop-local");
  assert.equal(linkedMac?.native_connected, true);
  assert.equal(linkedMac?.web_connected, true);

  // Disconnect shape: v2 empties every compat field and the per-item stamps
  // are false — both badges MUST go dark (no latch from earlier frames).
  const darkRows = buildAccountLiveDeviceRows({
    deviceLiveState: {
      account_device_live_state_snapshot: {
        client_connection: {
          active_desktop_device_ids: [],
          active_web_device_ids: [],
          active_web_devices: [],
          active_web_target_device_ids: [],
          connected: false,
          web_connected: false,
        },
        registered_devices,
      },
    },
  });
  const darkMac = darkRows.find((row) => row.device_id === "desktop-local");
  assert.equal(darkMac?.native_connected, false);
  assert.equal(darkMac?.web_connected, false);
});

test("presence v2: registered standalone web/mobile rows are never heuristic-folded", () => {
  // A REGISTERED web-identity device (mobile browser, second PC's browser) is
  // its own card. Only alias-proven folds (server fold links) may collapse a
  // web row into a native device — the single-web-lit-canonical guess must
  // not swallow registered inventory, and a fold must never DARKEN the
  // target's lit WEB badge.
  const rows = buildAccountLiveDeviceRows({
    deviceLiveState: {
      account_device_live_state_snapshot: {
        registered_devices: {
          items: [
            {
              device_id: "desktop-local",
              device_name: "Syed's MacBook Air",
              platform: "macos",
              form_factor: "desktop",
              client_kind: "desktop",
              registered: true,
              status: "connected",
              native_connected: true,
              web_connected: true,
              device_aliases: ["desktop-local", "web-macos-chrome"],
            },
            {
              device_id: "web-macos-chrome",
              device_name: "macOS web browser",
              platform: "macos",
              form_factor: "pc",
              client_kind: "web",
              registered: true,
              status: "connected",
              native_connected: false,
              web_connected: false,
            },
            {
              device_id: "web-samsung",
              device_name: "Samsung Galaxy S23 Ultra",
              platform: "android",
              form_factor: "mobile",
              client_kind: "web",
              registered: true,
              status: "offline",
              native_connected: false,
              web_connected: false,
            },
          ],
        },
      },
    },
  });
  const ids = rows.map((row) => row.device_id).sort();
  assert.deepEqual(ids, ["desktop-local", "web-samsung"]);
  const mac = rows.find((row) => row.device_id === "desktop-local");
  assert.equal(mac?.native_connected, true);
  assert.equal(
    mac?.web_connected,
    true,
    "an alias-proven fold must not darken the stamped WEB badge",
  );
  const samsung = rows.find((row) => row.device_id === "web-samsung");
  assert.equal(samsung?.registered, true);
  assert.equal(samsung?.web_connected, false);
});

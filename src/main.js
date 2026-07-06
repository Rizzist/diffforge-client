// Must be first: installs the React commit-storm watchdog hook before
// react-dom evaluates and captures __REACT_DEVTOOLS_GLOBAL_HOOK__.
import "./app/renderLoopProbe.js";
// IPC invoke-storm watchdog: names the commands behind cold-start IPC bursts.
import "./app/invokeProbe.js";
// Main-thread freeze watchdog: measures UI blocking and maps it to the
// workspace-activation phase it happened inside.
import "./diagnostics/uiFreezeProbe.js";
// Serialization watchdog: names the caller behind slow JSON.stringify/parse
// and localStorage writes (the confirmed freeze class from native sampling).
import "./diagnostics/serializationProbe.js";
// Focus-edge watchdog: names what the user clicked right before the webview
// lost focus (the "hover goes dead until I click the app" bug class).
import "./diagnostics/windowFocusDiagnostics.js";
import React from "react";
import { createRoot } from "react-dom/client";
import { StyleSheetManager } from "styled-components";

window.addEventListener("unhandledrejection", (event) => {
  const message = String(event?.reason?.message || event?.reason || "");
  if (message.includes("listeners[") && message.includes("handlerId")) {
    event.preventDefault();
  }
});

// Utility windows boot from narrow chunks instead of evaluating the entire
// AppShell bundle. Besides startup latency, this keeps AppShell's background
// listeners/pollers out of small always-on surfaces.
const hash = window.location.hash || "";
const mainWindowBoot = !hash;

if (mainWindowBoot) {
  const platformText = [
    navigator.userAgentData?.platform,
    navigator.platform,
    navigator.userAgent,
  ].filter(Boolean).join(" ").toLowerCase();
  const windowPlatform = /mac|darwin/.test(platformText)
    ? "macos"
    : /win/.test(platformText)
      ? "windows"
      : "linux";

  document.documentElement.dataset.windowPlatform = windowPlatform;
  document.body.dataset.windowPlatform = windowPlatform;
}

const loadRootComponent = hash === "#/snipping-overlay"
  ? import("./snipping/SnippingWorkspaceView.jsx").then((module) => module.SnippingOverlayWindow)
  : hash === "#/snipping-recording-controls"
  ? import("./snipping/SnippingWorkspaceView.jsx").then((module) => module.SnippingRecordingControlsWindow)
  : hash.startsWith("#/snipping-editor")
  || hash.startsWith("#/snipping-float")
  || hash.startsWith("#/snipping-strip")
  || hash === "#/snipping-toasts"
  ? import("./snipping/SnippingQuickAccess.jsx").then((module) => {
    if (hash.startsWith("#/snipping-editor")) return module.SnippingAnnotationEditorWindow;
    if (hash.startsWith("#/snipping-float")) return module.SnippingFloatWindow;
    if (hash.startsWith("#/snipping-strip")) return module.SnippingStripWindow;
    return module.default;
  })
  : hash === "#/activity-overlay"
  ? import("./activity/ActivityOverlay.jsx").then((module) => module.default)
  : hash === "#/audio-widget"
  ? import("./audio/AudioWorkspaceView.jsx").then((module) => module.AudioWidgetWindow)
  : hash === "#/audio-widget-error"
  ? import("./audio/AudioWorkspaceView.jsx").then((module) => module.AudioWidgetErrorOverlayWindow)
  : hash === "#/background-monitor"
  ? import("./background/BackgroundMonitorWindow.jsx").then((module) => module.default)
  : hash.startsWith("#/terminal-window")
  ? import("./terminals/TerminalWindowHost.jsx").then((module) => module.default)
  : hash.startsWith("#/tools-window")
  ? import("./tools/ToolsWindowHost.jsx").then((module) => module.default)
  : hash.startsWith("#/web-panel")
  ? import("./web/WebPanelHost.jsx").then((module) => module.default)
  : hash.startsWith("#/pcb-window")
  ? import("./pcb/PcbWindowHost.jsx").then((module) => module.default)
  : hash.startsWith("#/video-window")
  ? import("./video/VideoWindowHost.jsx").then((module) => module.default)
  : import("./App.jsx").then((module) => module.default);

loadRootComponent.then(async (RootComponent) => {
  // The OTA update banner rides only the main window; utility windows keep
  // their narrow chunks, and the backend never restarts without a click.
  const AppUpdateBanner = mainWindowBoot
    ? (await import("./app/AppUpdateBanner.jsx")).default
    : null;
  createRoot(document.querySelector("#app")).render(
    React.createElement(
      StyleSheetManager,
      { disableCSSOMInjection: true },
      AppUpdateBanner
        ? React.createElement(
          React.Fragment,
          null,
          React.createElement(RootComponent),
          React.createElement(AppUpdateBanner),
        )
        : React.createElement(RootComponent),
    ),
  );
});

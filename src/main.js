// Must be first: installs the React commit-storm watchdog hook before
// react-dom evaluates and captures __REACT_DEVTOOLS_GLOBAL_HOOK__.
import "./app/renderLoopProbe.js";
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

loadRootComponent.then((RootComponent) => {
  createRoot(document.querySelector("#app")).render(
    React.createElement(
      StyleSheetManager,
      { disableCSSOMInjection: true },
      React.createElement(RootComponent),
    ),
  );
});

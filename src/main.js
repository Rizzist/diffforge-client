import React from "react";
import { createRoot } from "react-dom/client";
import { StyleSheetManager } from "styled-components";

window.addEventListener("unhandledrejection", (event) => {
  const message = String(event?.reason?.message || event?.reason || "");
  if (message.includes("listeners[") && message.includes("handlerId")) {
    event.preventDefault();
  }
});

// Pause all CSS animations whenever a window is unfocused or hidden — exactly
// the state macOS samples for Energy Impact. Done here in the shared entry so
// it covers EVERY window (main app, audio widget, overlays, snipping,
// background monitor), independent of whether each renders the GlobalStyle.
(() => {
  if (typeof document === "undefined") {
    return;
  }
  const idleStyle = document.createElement("style");
  idleStyle.textContent =
    'html[data-app-idle="true"] *,'
    + 'html[data-app-idle="true"] *::before,'
    + 'html[data-app-idle="true"] *::after{animation-play-state:paused !important;}';
  (document.head || document.documentElement).appendChild(idleStyle);
  const syncIdle = () => {
    const active = document.visibilityState !== "hidden"
      && (typeof document.hasFocus !== "function" || document.hasFocus());
    document.documentElement.dataset.appIdle = active ? "false" : "true";
  };
  window.addEventListener("focus", syncIdle);
  window.addEventListener("blur", syncIdle);
  document.addEventListener("visibilitychange", syncIdle);
  syncIdle();
})();

// Utility windows boot from narrow chunks instead of evaluating the entire
// AppShell bundle. Besides startup latency, this keeps AppShell's background
// listeners/pollers out of small always-on surfaces.
const hash = window.location.hash || "";
const loadRootComponent = hash === "#/snipping-recording-controls"
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

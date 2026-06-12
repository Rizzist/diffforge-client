import React from "react";
import { createRoot } from "react-dom/client";
import { StyleSheetManager } from "styled-components";

window.addEventListener("unhandledrejection", (event) => {
  const message = String(event?.reason?.message || event?.reason || "");
  if (message.includes("listeners[") && message.includes("handlerId")) {
    event.preventDefault();
  }
});

// Snipping floating windows (annotation editor, snip previews, legacy toast
// dock) boot from the small snipping chunk instead of evaluating the entire
// AppShell bundle, so they open near-instantly.
const hash = window.location.hash || "";
const loadRootComponent = hash.startsWith("#/snipping-editor")
  || hash.startsWith("#/snipping-float")
  || hash === "#/snipping-strip"
  || hash === "#/snipping-toasts"
  ? import("./snipping/SnippingQuickAccess.jsx").then((module) => {
    if (hash.startsWith("#/snipping-editor")) return module.SnippingAnnotationEditorWindow;
    if (hash.startsWith("#/snipping-float")) return module.SnippingFloatWindow;
    if (hash === "#/snipping-strip") return module.SnippingStripWindow;
    return module.default;
  })
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

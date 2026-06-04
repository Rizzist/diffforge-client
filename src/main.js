import React from "react";
import { createRoot } from "react-dom/client";
import { StyleSheetManager } from "styled-components";

import App from "./App.jsx";

window.addEventListener("unhandledrejection", (event) => {
  const message = String(event?.reason?.message || event?.reason || "");
  if (message.includes("listeners[") && message.includes("handlerId")) {
    event.preventDefault();
  }
});

createRoot(document.querySelector("#app")).render(
  React.createElement(
    StyleSheetManager,
    { disableCSSOMInjection: true },
    React.createElement(App),
  ),
);

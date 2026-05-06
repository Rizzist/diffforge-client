import React from "react";
import { createRoot } from "react-dom/client";

import App from "./App.jsx";

createRoot(document.querySelector("#app")).render(
  React.createElement(React.StrictMode, null, React.createElement(App)),
);

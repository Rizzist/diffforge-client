(function () {
  const supportedTabs = [
    "pcb",
    "schematic",
    "cad",
    "assembly",
    "pinout",
    "analog_simulation",
    "bom",
    "circuit_json",
    "errors",
    "render_log",
    "solvers",
  ];
  const currentScript = document.currentScript;
  const defaultTab = currentScript?.dataset?.defaultTab || "pcb";
  const safeTab = supportedTabs.includes(defaultTab) ? defaultTab : "pcb";

  window.history.replaceState(null, "", "#tab=" + safeTab);
  try {
    window.localStorage.setItem("runframe-active-tab", JSON.stringify(safeTab));
  } catch {
    // RunFrame will fall back to PCB if storage is unavailable.
  }

  function showRendererError(message) {
    const status = document.getElementById("status");
    if (status) {
      status.textContent = "Renderer failed to load: " + (message || "Unknown error");
    }
  }

  window.addEventListener("error", (event) => {
    showRendererError(event.message || event.error);
  });

  window.addEventListener("unhandledrejection", (event) => {
    showRendererError(event.reason);
  });
})();

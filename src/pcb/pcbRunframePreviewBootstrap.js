(function () {
  function readJsonScript(id, fallback) {
    const element = document.getElementById(id);
    if (!element) {
      return fallback;
    }
    try {
      return JSON.parse(element.textContent || "");
    } catch (error) {
      console.error("Failed to parse PCB preview payload", error);
      return fallback;
    }
  }

  window.CIRCUIT_JSON = readJsonScript("circuit-json", []);
  window.CIRCUIT_JSON_PREVIEW_PROPS = readJsonScript("preview-props", {});
})();

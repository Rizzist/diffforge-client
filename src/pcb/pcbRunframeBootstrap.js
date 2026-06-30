(function () {
  const messageType = "diffforge:pcb:set-active-tab";
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

  const tabLabels = {
    analog_simulation: "Analog Simulation",
    bom: "BOM",
    cad: "3D",
    circuit_json: "Circuit JSON",
    errors: "Errors",
    render_log: "Render Log",
    solvers: "Solvers",
    assembly: "Assembly",
    pcb: "PCB",
    pinout: "Pinout",
    schematic: "Schematic",
  };

  const currentScript = document.currentScript;
  const defaultTab = currentScript?.dataset?.defaultTab || "pcb";
  const safeTab = normalizeTab(defaultTab);
  let requestedTab = safeTab;

  function normalizeTab(tab) {
    const cleanTab = String(tab || "").trim().toLowerCase();
    return supportedTabs.includes(cleanTab) ? cleanTab : "pcb";
  }

  function normalizeLabel(label) {
    return String(label || "").replace(/[^a-z0-9]+/gi, "").toLowerCase();
  }

  function expectedLabel(tab) {
    return normalizeLabel(tabLabels[tab] || tab.replace(/_/g, " "));
  }

  function elementMatchesTab(element, tab) {
    if (!element) {
      return false;
    }
    const label = expectedLabel(tab);
    const text = normalizeLabel(element.textContent);
    const title = normalizeLabel(element.getAttribute("title"));
    const ariaLabel = normalizeLabel(element.getAttribute("aria-label"));
    const value = normalizeLabel(element.getAttribute("value") || element.dataset?.value);
    return [text, title, ariaLabel, value].includes(label);
  }

  function rememberTab(tab) {
    const safeNextTab = normalizeTab(tab);
    try {
      window.history.replaceState(null, "", "#tab=" + safeNextTab);
    } catch {
      // History state is cosmetic for this embedded frame.
    }
    try {
      window.localStorage.setItem("runframe-active-tab", JSON.stringify(safeNextTab));
    } catch {
      // RunFrame will fall back to PCB if storage is unavailable.
    }
  }

  function fiberFromNode(node) {
    if (!node) {
      return null;
    }
    const key = Object.keys(node).find(
      (name) => name.startsWith("__reactFiber$")
        || name.startsWith("__reactInternalInstance$")
        || name.startsWith("__reactContainer$"),
    );
    return key ? node[key] : null;
  }

  function findRunframeTabsController() {
    const roots = [
      document.getElementById("root"),
      ...Array.from(document.querySelectorAll("[role='tablist'], [role='tab']")),
    ];
    const seen = new Set();
    let controller = null;

    function visit(fiber) {
      if (!fiber || seen.has(fiber) || controller) {
        return;
      }
      seen.add(fiber);
      const props = fiber.memoizedProps || fiber.pendingProps || {};
      const className = typeof props.className === "string" ? props.className : "";
      if (
        typeof props.onValueChange === "function"
        && supportedTabs.includes(props.value)
        && className.includes("rf-flex-grow")
      ) {
        controller = props.onValueChange;
        return;
      }
      visit(fiber.child);
      visit(fiber.sibling);
    }

    roots.forEach((root) => visit(fiberFromNode(root)));
    return controller;
  }

  function switchViaReactController(tab) {
    const controller = findRunframeTabsController();
    if (!controller) {
      return false;
    }
    try {
      controller(tab);
      return true;
    } catch {
      return false;
    }
  }

  function clickMatchingElement(selector, tab) {
    const element = Array.from(document.querySelectorAll(selector))
      .find((candidate) => elementMatchesTab(candidate, tab));
    if (!element) {
      return false;
    }
    element.click();
    return true;
  }

  function openDropdownForHiddenTabs() {
    const trigger = Array.from(document.querySelectorAll("[aria-haspopup='menu'], [data-radix-menu-trigger]"))
      .find((candidate) => !candidate.closest("[role='menu']"));
    if (!trigger) {
      return false;
    }
    trigger.click();
    return true;
  }

  function switchViaDom(tab) {
    if (clickMatchingElement("[role='tab']", tab)) {
      return true;
    }
    if (clickMatchingElement("[role='menuitem']", tab)) {
      return true;
    }
    openDropdownForHiddenTabs();
    return clickMatchingElement("[role='menuitem']", tab);
  }

  function applyRequestedTab(tab, attempt = 0) {
    const safeNextTab = normalizeTab(tab);
    requestedTab = safeNextTab;
    rememberTab(safeNextTab);
    if (switchViaReactController(safeNextTab) || switchViaDom(safeNextTab)) {
      return;
    }
    if (attempt >= 40) {
      return;
    }
    window.setTimeout(() => {
      if (requestedTab === safeNextTab) {
        applyRequestedTab(safeNextTab, attempt + 1);
      }
    }, 50);
  }

  rememberTab(safeTab);

  window.addEventListener("message", (event) => {
    const data = event?.data || {};
    if (data.type !== messageType || data.source !== "diffforge-pcb-panel") {
      return;
    }
    applyRequestedTab(data.tab);
  });

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

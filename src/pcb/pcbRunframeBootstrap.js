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

  const pcbPickerMessageType = "diffforge:pcb:element-picker";
  const pcbPickerStateMessageType = "diffforge:pcb:element-picker-state";
  const pcbPickerKey = "__diffforgePcbElementPicker";
  const pcbPickerOverlayId = "diffforge-pcb-element-picker-overlay";
  const pcbPickerLabelId = "diffforge-pcb-element-picker-label";
  const pcbPickerMaxSelections = 3;
  const pcbPickerHoverColor = "#60a5fa";
  const pcbPickerSelectedColor = "#34d399";
  const pcbIdKeys = [
    "pcbComponentId",
    "pcbSmtpadId",
    "pcbPlatedHoleId",
    "pcbTraceId",
    "pcbViaId",
    "pcbPortId",
    "schematicComponentId",
    "schematicPortId",
    "schematicTraceId",
    "sourceComponentId",
    "sourcePortId",
    "sourceTraceId",
    "sourceNetId",
    "cadComponentId",
  ];

  function compactPcbText(value, maxLength = 120) {
    const normalized = String(value || "").replace(/\s+/g, " ").trim();
    if (!normalized) {
      return "";
    }
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd() + "...";
  }

  function normalizeCircuitJson(value) {
    if (Array.isArray(value)) {
      return value.filter((element) => element && typeof element === "object");
    }
    if (Array.isArray(value?.circuitJson)) return normalizeCircuitJson(value.circuitJson);
    if (Array.isArray(value?.circuit_json)) return normalizeCircuitJson(value.circuit_json);
    if (Array.isArray(value?.elements)) return normalizeCircuitJson(value.elements);
    return [];
  }

  function getCircuitJson() {
    return normalizeCircuitJson(window.CIRCUIT_JSON);
  }

  function circuitElementId(element) {
    if (!element || typeof element !== "object") {
      return "";
    }
    if (typeof element.type === "string" && element[`${element.type}_id`]) {
      return String(element[`${element.type}_id`]);
    }
    const key = Object.keys(element).find((name) => /_id$/.test(name) && typeof element[name] === "string");
    return key ? String(element[key]) : "";
  }

  function findCircuitElementById(id) {
    const cleanId = String(id || "");
    if (!cleanId) {
      return null;
    }
    return getCircuitJson().find((element) => circuitElementId(element) === cleanId) || null;
  }

  function circuitElementsByType(type) {
    return getCircuitJson().filter((element) => element.type === type);
  }

  function sourceComponentFor(element, identity = {}) {
    const sourceComponentId = identity.sourceComponentId || element?.source_component_id;
    if (sourceComponentId) {
      const source = findCircuitElementById(sourceComponentId);
      if (source?.type === "source_component") return source;
    }
    if (element?.type === "source_component") return element;
    if (element?.pcb_component_id) {
      const pcbComponent = findCircuitElementById(element.pcb_component_id);
      if (pcbComponent?.source_component_id) return findCircuitElementById(pcbComponent.source_component_id);
    }
    if (element?.pcb_port_id) {
      const pcbPort = findCircuitElementById(element.pcb_port_id);
      if (pcbPort?.source_port_id) {
        const sourcePort = findCircuitElementById(pcbPort.source_port_id);
        if (sourcePort?.source_component_id) return findCircuitElementById(sourcePort.source_component_id);
      }
      if (pcbPort?.pcb_component_id) {
        const pcbComponent = findCircuitElementById(pcbPort.pcb_component_id);
        if (pcbComponent?.source_component_id) return findCircuitElementById(pcbComponent.source_component_id);
      }
    }
    if (element?.source_port_id) {
      const sourcePort = findCircuitElementById(element.source_port_id);
      if (sourcePort?.source_component_id) return findCircuitElementById(sourcePort.source_component_id);
    }
    const name = String(identity.name || "").replace(/^\./, "");
    if (name) {
      return circuitElementsByType("source_component").find((source) => source.name === name) || null;
    }
    return null;
  }

  function pcbComponentFor(element, sourceComponent) {
    if (element?.type === "pcb_component") return element;
    if (element?.pcb_component_id) {
      const pcbComponent = findCircuitElementById(element.pcb_component_id);
      if (pcbComponent?.type === "pcb_component") return pcbComponent;
    }
    if (element?.pcb_port_id) {
      const pcbPort = findCircuitElementById(element.pcb_port_id);
      if (pcbPort?.pcb_component_id) {
        const pcbComponent = findCircuitElementById(pcbPort.pcb_component_id);
        if (pcbComponent?.type === "pcb_component") return pcbComponent;
      }
    }
    if (sourceComponent?.source_component_id) {
      return circuitElementsByType("pcb_component")
        .find((component) => component.source_component_id === sourceComponent.source_component_id) || null;
    }
    return null;
  }

  function cadComponentFor(sourceComponent, pcbComponent, element) {
    if (element?.type === "cad_component") return element;
    return circuitElementsByType("cad_component").find((cadComponent) => (
      (sourceComponent?.source_component_id && cadComponent.source_component_id === sourceComponent.source_component_id)
      || (pcbComponent?.pcb_component_id && cadComponent.pcb_component_id === pcbComponent.pcb_component_id)
    )) || null;
  }

  function sourceNetIdsFor(element, sourceComponent) {
    const ids = new Set();
    if (Array.isArray(element?.connected_source_net_ids)) {
      element.connected_source_net_ids.forEach((id) => ids.add(id));
    }
    if (element?.source_net_id) ids.add(element.source_net_id);
    if (sourceComponent?.source_component_id) {
      const sourcePorts = circuitElementsByType("source_port")
        .filter((port) => port.source_component_id === sourceComponent.source_component_id);
      for (const port of sourcePorts) {
        for (const trace of circuitElementsByType("source_trace")) {
          if (Array.isArray(trace.connected_source_port_ids) && trace.connected_source_port_ids.includes(port.source_port_id)) {
            (trace.connected_source_net_ids || []).forEach((id) => ids.add(id));
            if (trace.subcircuit_connectivity_map_key) {
              circuitElementsByType("source_net")
                .filter((net) => net.subcircuit_connectivity_map_key === trace.subcircuit_connectivity_map_key)
                .forEach((net) => ids.add(net.source_net_id));
            }
          }
        }
        if (port.subcircuit_connectivity_map_key) {
          circuitElementsByType("source_net")
            .filter((net) => net.subcircuit_connectivity_map_key === port.subcircuit_connectivity_map_key)
            .forEach((net) => ids.add(net.source_net_id));
        }
      }
    }
    return Array.from(ids).filter(Boolean).slice(0, 6);
  }

  function sourceNetLabel(netIds) {
    const labels = netIds.map((id) => {
      const net = findCircuitElementById(id);
      return compactPcbText(net?.name || id, 60);
    }).filter(Boolean);
    return labels[0] || "";
  }

  function pickLabel(identity) {
    const designator = compactPcbText(identity.name, 60);
    const footprint = compactPcbText(identity.footprint, 60);
    if (designator && footprint) return `${designator} · ${footprint}`;
    if (designator) return designator;
    if (identity.elementType === "pcb_trace" || identity.elementType === "schematic_trace") {
      const net = sourceNetLabel(identity.netIds || []);
      return net ? `trace · net ${net}` : "trace";
    }
    if (identity.elementType === "pcb_smtpad" || identity.elementType === "pcb_plated_hole") {
      return "pad";
    }
    return compactPcbText(identity.elementType || "PCB element", 80);
  }

  function roundPcbNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
  }

  function cleanPcbPoint(value) {
    const x = roundPcbNumber(value?.x);
    const y = roundPcbNumber(value?.y);
    return x == null || y == null ? null : { x, y };
  }

  function createPickedElement(identity, tab, space) {
    const sourceComponent = sourceComponentFor(identity.element, identity);
    const pcbComponent = pcbComponentFor(identity.element, sourceComponent);
    const cadComponent = cadComponentFor(sourceComponent, pcbComponent, identity.element);
    const netIds = identity.netIds || sourceNetIdsFor(identity.element, sourceComponent);
    const elementType = compactPcbText(identity.element?.type || identity.elementType, 80) || null;
    const circuitId = compactPcbText(circuitElementId(identity.element) || identity.circuitElementId, 160) || null;
    const footprint = compactPcbText(identity.footprint || cadComponent?.footprinter_string, 120) || null;
    const name = compactPcbText(sourceComponent?.name || identity.name, 80) || null;
    const layer = compactPcbText(identity.element?.layer || pcbComponent?.layer || identity.layer, 40) || null;
    const pointMm = cleanPcbPoint(identity.pointMm || identity.element?.center || identity.element);
    const pick = {
      id: "pcbctx_" + Math.random().toString(36).slice(2, 10),
      tab: compactPcbText(tab, 40) || "pcb",
      space,
      elementType,
      circuitElementId: circuitId,
      sourceComponentId: compactPcbText(sourceComponent?.source_component_id || identity.sourceComponentId, 160) || null,
      name,
      footprint,
      layer,
      label: "",
      pointMm,
      netIds: netIds.length ? netIds : null,
    };
    pick.label = pickLabel(pick);
    return pick;
  }

  function createPcbPickerOverlay() {
    let overlay = document.getElementById(pcbPickerOverlayId);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = pcbPickerOverlayId;
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.cssText = [
        "position:fixed",
        "z-index:2147483646",
        "pointer-events:none",
        "box-sizing:border-box",
        "border:2px solid #60a5fa",
        "outline:1px solid rgba(15,23,42,.55)",
        "background:rgba(37,99,235,.13)",
        "border-radius:6px",
        "box-shadow:0 0 0 1px rgba(255,255,255,.24),0 10px 30px rgba(15,23,42,.24)",
        "display:none",
      ].join(";");
      document.documentElement.appendChild(overlay);
    }
    let label = document.getElementById(pcbPickerLabelId);
    if (!label) {
      label = document.createElement("div");
      label.id = pcbPickerLabelId;
      label.setAttribute("aria-hidden", "true");
      label.style.cssText = [
        "position:fixed",
        "z-index:2147483647",
        "pointer-events:none",
        "max-width:360px",
        "padding:4px 7px",
        "border:1px solid rgba(255,255,255,.22)",
        "border-radius:999px",
        "background:rgba(3,7,18,.9)",
        "color:#e5edff",
        "font:700 11px/1.2 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
        "box-shadow:0 8px 24px rgba(0,0,0,.28)",
        "white-space:nowrap",
        "overflow:hidden",
        "text-overflow:ellipsis",
        "display:none",
      ].join(";");
      document.documentElement.appendChild(label);
    }
    return { overlay, label };
  }

  function hidePcbPickerOverlay() {
    const overlay = document.getElementById(pcbPickerOverlayId);
    const label = document.getElementById(pcbPickerLabelId);
    if (overlay) overlay.style.display = "none";
    if (label) label.style.display = "none";
  }

  function updatePcbPickerOverlay(target, labelText, selected, pointer) {
    const { overlay, label } = createPcbPickerOverlay();
    if (!target || !target.getBoundingClientRect) {
      overlay.style.display = "none";
      label.style.display = "block";
      label.textContent = labelText || "";
      label.style.left = Math.max(8, Math.min(window.innerWidth - 140, pointer?.x || 8)) + "px";
      label.style.top = Math.max(8, (pointer?.y || 8) - 28) + "px";
      return;
    }
    const rect = target.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      hidePcbPickerOverlay();
      return;
    }
    overlay.style.display = "block";
    overlay.style.left = Math.max(0, rect.left) + "px";
    overlay.style.top = Math.max(0, rect.top) + "px";
    overlay.style.width = Math.max(1, rect.width) + "px";
    overlay.style.height = Math.max(1, rect.height) + "px";
    overlay.style.borderColor = selected ? pcbPickerSelectedColor : pcbPickerHoverColor;
    overlay.style.background = selected ? "rgba(16,185,129,.14)" : "rgba(37,99,235,.13)";
    label.textContent = labelText || "";
    label.style.display = "block";
    label.style.left = Math.max(8, Math.min(window.innerWidth - 140, rect.left)) + "px";
    label.style.top = Math.max(8, rect.top - 28) + "px";
  }

  function currentRunframeTab() {
    try {
      const stored = JSON.parse(window.localStorage.getItem("runframe-active-tab") || "null");
      if (supportedTabs.includes(stored)) return stored;
    } catch {}
    try {
      const match = String(window.location.hash || "").match(/tab=([^&]+)/);
      if (match) return normalizeTab(decodeURIComponent(match[1]));
    } catch {}
    return requestedTab || "pcb";
  }

  function parseDistance(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const number = Number.parseFloat(String(value || ""));
    return Number.isFinite(number) ? number : null;
  }

  function updateBounds(bounds, center, width = 0, height = 0) {
    const x = parseDistance(center?.x);
    const y = parseDistance(center?.y);
    if (x == null || y == null) return;
    const halfWidth = (parseDistance(width) || 0) / 2;
    const halfHeight = (parseDistance(height) || 0) / 2;
    bounds.minX = Math.min(bounds.minX, x - halfWidth);
    bounds.minY = Math.min(bounds.minY, y - halfHeight);
    bounds.maxX = Math.max(bounds.maxX, x + halfWidth);
    bounds.maxY = Math.max(bounds.maxY, y + halfHeight);
    bounds.hasBounds = true;
  }

  function updateTraceBounds(bounds, route) {
    if (!Array.isArray(route)) return;
    route.forEach((point) => updateBounds(bounds, point, 0, 0));
  }

  function pcbBounds() {
    const bounds = {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
      hasBounds: false,
    };
    for (const element of getCircuitJson()) {
      if (element.type === "pcb_board" || element.type === "pcb_panel" || element.type === "pcb_component") {
        if (Array.isArray(element.outline)) {
          element.outline.forEach((point) => updateBounds(bounds, point, 0, 0));
        } else {
          updateBounds(bounds, element.center, element.width, element.height);
        }
      } else if (element.type === "pcb_smtpad") {
        updateBounds(bounds, { x: element.x, y: element.y }, element.width || element.radius || 0, element.height || element.radius || 0);
      } else if ("x" in element && "y" in element) {
        updateBounds(bounds, element, 0, 0);
      } else if (Array.isArray(element.route)) {
        updateTraceBounds(bounds, element.route);
      }
    }
    if (!bounds.hasBounds) {
      bounds.minX = -10;
      bounds.minY = -10;
      bounds.maxX = 10;
      bounds.maxY = 10;
    }
    return bounds;
  }

  function svgSize(svg) {
    const viewBox = String(svg.getAttribute("viewBox") || "").trim().split(/[\s,]+/).map(Number);
    if (viewBox.length === 4 && viewBox.every(Number.isFinite)) {
      return { width: viewBox[2], height: viewBox[3] };
    }
    const rect = svg.getBoundingClientRect();
    return { width: rect.width || 800, height: rect.height || 600 };
  }

  function pcbPointFromPointer(event, svg) {
    if (!svg || typeof svg.createSVGPoint !== "function") return null;
    let svgPoint = null;
    try {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      svgPoint = point.matrixTransform(svg.getScreenCTM().inverse());
    } catch {
      return null;
    }
    const size = svgSize(svg);
    const bounds = pcbBounds();
    const padding = 1;
    const circuitWidth = Math.max(1, bounds.maxX - bounds.minX + 2 * padding);
    const circuitHeight = Math.max(1, bounds.maxY - bounds.minY + 2 * padding);
    const scaleFactor = Math.min(size.width / circuitWidth, size.height / circuitHeight);
    const offsetX = (size.width - circuitWidth * scaleFactor) / 2;
    const offsetY = (size.height - circuitHeight * scaleFactor) / 2;
    const translateX = offsetX - bounds.minX * scaleFactor + padding * scaleFactor;
    const translateY = size.height - offsetY + bounds.minY * scaleFactor - padding * scaleFactor;
    return cleanPcbPoint({
      x: (svgPoint.x - translateX) / scaleFactor,
      y: (svgPoint.y - translateY) / -scaleFactor,
    });
  }

  function distanceToSegment(point, start, end) {
    const sx = Number(start?.x);
    const sy = Number(start?.y);
    const ex = Number(end?.x);
    const ey = Number(end?.y);
    if (![point.x, point.y, sx, sy, ex, ey].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
    const dx = ex - sx;
    const dy = ey - sy;
    const lengthSq = dx * dx + dy * dy;
    if (!lengthSq) return Math.hypot(point.x - sx, point.y - sy);
    const t = Math.max(0, Math.min(1, ((point.x - sx) * dx + (point.y - sy) * dy) / lengthSq));
    return Math.hypot(point.x - (sx + t * dx), point.y - (sy + t * dy));
  }

  function nearestPcbElement(type, layer, pointMm) {
    if (!pointMm) return null;
    const interesting = type === "pcb_trace"
      ? ["pcb_trace"]
      : type === "pcb_component"
        ? ["pcb_component"]
        : type === "pcb_plated_hole"
          ? ["pcb_plated_hole"]
          : type === "pcb_smtpad"
            ? ["pcb_smtpad"]
            : ["pcb_smtpad", "pcb_plated_hole", "pcb_trace", "pcb_component"];
    let best = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const element of getCircuitJson()) {
      if (!interesting.includes(element.type)) continue;
      if (layer && element.layer && element.layer !== layer) continue;
      let distance = Number.POSITIVE_INFINITY;
      if (element.type === "pcb_trace" && Array.isArray(element.route)) {
        for (let index = 1; index < element.route.length; index += 1) {
          distance = Math.min(distance, distanceToSegment(pointMm, element.route[index - 1], element.route[index]));
        }
        if (element.route.length === 1) {
          distance = Math.hypot(pointMm.x - element.route[0].x, pointMm.y - element.route[0].y);
        }
      } else {
        const x = Number(element.center?.x ?? element.x);
        const y = Number(element.center?.y ?? element.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          distance = Math.hypot(pointMm.x - x, pointMm.y - y);
        }
      }
      if (distance < bestDistance) {
        bestDistance = distance;
        best = element;
      }
    }
    return bestDistance <= 2 ? best : null;
  }

  function datasetIdentity(element, event) {
    let cursor = element;
    while (cursor && cursor.nodeType === 1) {
      const dataset = cursor.dataset || {};
      const type = dataset.circuitJsonType || dataset.type || "";
      const idKey = pcbIdKeys.find((key) => dataset[key]);
      const id = idKey ? dataset[idKey] : "";
      let circuitElement = id ? findCircuitElementById(id) : null;
      if (!circuitElement && id && dataset.schematicPortId) {
        circuitElement = getCircuitJson().find((candidate) => (
          candidate.schematic_port_id === id || candidate.source_port_id === id
        )) || null;
      }
      const svg = cursor.ownerSVGElement || (cursor.tagName?.toLowerCase() === "svg" ? cursor : null);
      const pointMm = pcbPointFromPointer(event, svg);
      if (!circuitElement && type && type !== "pcb_background" && type !== "pcb_soldermask" && type !== "pcb_soldermask_opening") {
        circuitElement = nearestPcbElement(type, dataset.pcbLayer || dataset.layer, pointMm);
      }
      if (circuitElement || (type && type !== "pcb_background")) {
        return {
          element: circuitElement,
          elementType: circuitElement?.type || type || null,
          circuitElementId: circuitElement ? circuitElementId(circuitElement) : null,
          layer: dataset.pcbLayer || dataset.layer || circuitElement?.layer || null,
          node: cursor,
          pointMm,
        };
      }
      if (cursor.tagName?.toLowerCase() === "svg") break;
      cursor = cursor.parentElement;
    }
    return null;
  }

  function identityFromProps(props, depth = 0, seen = new Set()) {
    if (!props || typeof props !== "object" || depth > 4 || seen.has(props)) return null;
    seen.add(props);
    if (typeof props.type === "string") {
      const id = circuitElementId(props);
      if (id) return { element: props, elementType: props.type, circuitElementId: id };
    }
    for (const key of pcbIdKeys) {
      const value = props[key] || props[key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)];
      if (value) {
        const element = findCircuitElementById(value);
        if (element) return { element, elementType: element.type, circuitElementId: circuitElementId(element) };
      }
    }
    for (const value of Object.values(props)) {
      if (value && typeof value === "object") {
        const identity = identityFromProps(value, depth + 1, seen);
        if (identity) return identity;
      }
    }
    return null;
  }

  function fiberIdentity(element) {
    let cursor = element;
    const seen = new Set();
    while (cursor && cursor.nodeType === 1) {
      let fiber = fiberFromNode(cursor);
      while (fiber && !seen.has(fiber)) {
        seen.add(fiber);
        const identity = identityFromProps(fiber.memoizedProps || fiber.pendingProps || {});
        if (identity) return { ...identity, node: cursor };
        fiber = fiber.return;
      }
      cursor = cursor.parentElement;
    }
    return null;
  }

  function selectable2dFromPoint(event) {
    let element = document.elementFromPoint(event.clientX, event.clientY);
    while (element && (element.id === pcbPickerOverlayId || element.id === pcbPickerLabelId)) {
      element = element.parentElement;
    }
    if (!element || element.tagName?.toLowerCase() === "body") return null;
    return element;
  }

  function resolve2dIdentity(event) {
    const element = selectable2dFromPoint(event);
    if (!element) return null;
    const identity = datasetIdentity(element, event) || fiberIdentity(element);
    if (!identity) return null;
    return {
      ...identity,
      node: identity.node || element,
      pointMm: identity.pointMm || pcbPointFromPointer(event, element.ownerSVGElement),
    };
  }

  function findThreeContext() {
    const rootObject = window.TSCIRCUIT_3D_OBJECT_REF || window.__TSCIRCUIT_THREE_OBJECT || null;
    const roots = [document.getElementById("root"), ...Array.from(document.querySelectorAll("canvas"))];
    const seen = new Set();
    let found = null;
    function visit(fiber) {
      if (!fiber || seen.has(fiber) || found) return;
      seen.add(fiber);
      const props = fiber.memoizedProps || fiber.pendingProps || {};
      const value = props.value;
      if (value?.scene?.isScene && value?.camera?.isCamera && value?.renderer?.domElement) {
        found = value;
        return;
      }
      visit(fiber.child);
      visit(fiber.sibling);
    }
    roots.forEach((root) => visit(fiberFromNode(root)));
    if (found) return found;
    return rootObject ? { rootObject, scene: rootObject.parent || rootObject, camera: null, renderer: null } : null;
  }

  function hasThreeDPicking() {
    const context = findThreeContext();
    return Boolean(context?.rootObject && context?.camera && context?.renderer?.domElement);
  }

  function rayFromPointer(event, context) {
    const canvas = context.renderer?.domElement;
    const camera = context.camera;
    if (!canvas || !camera) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    const Vector3 = camera.position?.constructor;
    if (typeof Vector3 !== "function") return null;
    const origin = camera.position.clone();
    let direction;
    if (camera.isPerspectiveCamera) {
      direction = new Vector3(x, y, 0.5).unproject(camera).sub(origin).normalize();
    } else if (camera.isOrthographicCamera) {
      origin.copy(new Vector3(x, y, (camera.near + camera.far) / (camera.near - camera.far)).unproject(camera));
      direction = new Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
    } else {
      return null;
    }
    return { origin, direction };
  }

  function objectRadius(object) {
    const geometry = object.geometry;
    if (!geometry) return 0;
    try {
      if (!geometry.boundingSphere && typeof geometry.computeBoundingSphere === "function") {
        geometry.computeBoundingSphere();
      }
      const radius = geometry.boundingSphere?.radius || 0;
      const scale = object.getWorldScale ? object.getWorldScale(object.scale.clone()) : object.scale;
      return radius * Math.max(Math.abs(scale.x || 1), Math.abs(scale.y || 1), Math.abs(scale.z || 1));
    } catch {
      return 0;
    }
  }

  function rayDistanceToSphere(ray, center, radius) {
    const toCenter = center.clone().sub(ray.origin);
    const t = toCenter.dot(ray.direction);
    if (t < 0) return Number.POSITIVE_INFINITY;
    const closest = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
    const distance = closest.distanceTo(center);
    return distance <= Math.max(radius, 0.15) ? t : Number.POSITIVE_INFINITY;
  }

  function resolve3dIdentity(event) {
    const context = findThreeContext();
    if (!context?.rootObject || !context?.camera || !context?.renderer?.domElement) return null;
    const ray = rayFromPointer(event, context);
    if (!ray) return null;
    let bestObject = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const center = context.camera.position.clone();
    context.rootObject.updateMatrixWorld?.(true);
    context.rootObject.traverse?.((object) => {
      if (!object?.visible || !object.geometry) return;
      const radius = objectRadius(object);
      if (!radius) return;
      const objectCenter = center.clone();
      try {
        object.getWorldPosition(objectCenter);
      } catch {
        return;
      }
      const distance = rayDistanceToSphere(ray, objectCenter, radius);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestObject = object;
      }
    });
    if (!bestObject) return null;
    const point = ray.origin.clone().add(ray.direction.clone().multiplyScalar(bestDistance));
    let cadElement = null;
    const userData = bestObject.userData || {};
    for (const key of ["cad_component_id", "cadComponentId", "pcb_component_id", "pcbComponentId", "source_component_id", "sourceComponentId"]) {
      if (userData[key]) {
        cadElement = findCircuitElementById(userData[key]);
        if (cadElement) break;
      }
    }
    if (!cadElement) {
      let bestCadDistance = Number.POSITIVE_INFINITY;
      for (const candidate of circuitElementsByType("cad_component")) {
        const distance = Math.hypot(point.x - Number(candidate.position?.x || 0), point.y - Number(candidate.position?.y || 0));
        if (distance < bestCadDistance) {
          bestCadDistance = distance;
          cadElement = candidate;
        }
      }
    }
    return {
      element: cadElement,
      elementType: cadElement?.type || "cad_component",
      circuitElementId: cadElement ? circuitElementId(cadElement) : null,
      sourceComponentId: cadElement?.source_component_id || null,
      footprint: cadElement?.footprinter_string || null,
      node: null,
      object: bestObject,
      pointMm: cleanPcbPoint({ x: point.x, y: point.y }),
    };
  }

  function selectionKey(selection) {
    return [
      selection?.space,
      selection?.circuitElementId,
      selection?.sourceComponentId,
      selection?.elementType,
      selection?.name,
      selection?.label,
    ].filter(Boolean).join(":");
  }

  function createPcbPickerController() {
    const state = {
      enabled: false,
      hot: null,
      hoverNode: null,
      hoverObject: null,
      selections: [],
      selectedNodes: new Map(),
      selectedObjects: new Map(),
      originalNodeStyles: new WeakMap(),
      originalMaterials: new WeakMap(),
      pointer: { x: 0, y: 0 },
    };

    function snapshot(reason) {
      return {
        type: pcbPickerStateMessageType,
        enabled: state.enabled,
        reason,
        capabilities: { threeD: hasThreeDPicking() },
        selections: state.selections.slice(),
      };
    }

    function post(reason) {
      try {
        window.parent?.postMessage(snapshot(reason), "*");
      } catch {}
    }

    function rememberNodeStyle(node) {
      if (!node || state.originalNodeStyles.has(node)) return;
      state.originalNodeStyles.set(node, {
        cssText: node.style?.cssText || "",
        stroke: node.getAttribute?.("stroke"),
        strokeWidth: node.getAttribute?.("stroke-width"),
        filter: node.getAttribute?.("filter"),
      });
    }

    function applyNodeHighlight(node, color) {
      if (!node?.style) return;
      rememberNodeStyle(node);
      node.style.outline = `2px solid ${color}`;
      node.style.filter = `drop-shadow(0 0 5px ${color})`;
      if (typeof node.setAttribute === "function") {
        node.setAttribute("stroke", color);
        node.setAttribute("stroke-width", "2");
      }
    }

    function restoreNode(node) {
      if (!node || state.selectedNodes.has(node) || node === state.hoverNode) return;
      const original = state.originalNodeStyles.get(node);
      if (!original) return;
      if (node.style) node.style.cssText = original.cssText;
      if (original.stroke == null) node.removeAttribute?.("stroke");
      else node.setAttribute?.("stroke", original.stroke);
      if (original.strokeWidth == null) node.removeAttribute?.("stroke-width");
      else node.setAttribute?.("stroke-width", original.strokeWidth);
      if (original.filter == null) node.removeAttribute?.("filter");
      else node.setAttribute?.("filter", original.filter);
      state.originalNodeStyles.delete(node);
    }

    function materialList(object) {
      const material = object?.material;
      return Array.isArray(material) ? material : material ? [material] : [];
    }

    function rememberMaterial(material) {
      if (!material || state.originalMaterials.has(material)) return;
      state.originalMaterials.set(material, {
        color: material.color?.clone?.(),
        emissive: material.emissive?.clone?.(),
        opacity: material.opacity,
        transparent: material.transparent,
      });
    }

    function applyObjectHighlight(object, selected) {
      const color = selected ? pcbPickerSelectedColor : pcbPickerHoverColor;
      materialList(object).forEach((material) => {
        rememberMaterial(material);
        try {
          if (material.emissive?.set) material.emissive.set(color);
          else if (material.color?.set) material.color.set(color);
          if (!selected) {
            material.transparent = true;
            material.opacity = Math.min(1, Math.max(0.65, material.opacity ?? 1));
          }
          material.needsUpdate = true;
        } catch {}
      });
    }

    function restoreObject(object) {
      if (!object || state.selectedObjects.has(object) || object === state.hoverObject) return;
      materialList(object).forEach((material) => {
        const original = state.originalMaterials.get(material);
        if (!original) return;
        try {
          if (original.color && material.color?.copy) material.color.copy(original.color);
          if (original.emissive && material.emissive?.copy) material.emissive.copy(original.emissive);
          material.opacity = original.opacity;
          material.transparent = original.transparent;
          material.needsUpdate = true;
        } catch {}
        state.originalMaterials.delete(material);
      });
    }

    function clearHover() {
      const node = state.hoverNode;
      const object = state.hoverObject;
      state.hoverNode = null;
      state.hoverObject = null;
      restoreNode(node);
      restoreObject(object);
      state.hot = null;
      hidePcbPickerOverlay();
    }

    function applySelectedHighlights() {
      state.selectedNodes.forEach((_key, node) => applyNodeHighlight(node, pcbPickerSelectedColor));
      state.selectedObjects.forEach((_key, object) => applyObjectHighlight(object, true));
    }

    function clearSelectedHighlights() {
      const nodes = Array.from(state.selectedNodes.keys());
      const objects = Array.from(state.selectedObjects.keys());
      state.selectedNodes.clear();
      state.selectedObjects.clear();
      nodes.forEach((node) => restoreNode(node));
      objects.forEach((object) => restoreObject(object));
    }

    function updateHover(event) {
      if (!state.enabled) return;
      state.pointer = { x: event.clientX, y: event.clientY };
      const tab = currentRunframeTab();
      const identity = tab === "cad" ? resolve3dIdentity(event) : resolve2dIdentity(event);
      if (!identity) {
        clearHover();
        return;
      }
      const pick = createPickedElement(identity, tab, tab === "cad" ? "3d" : "2d");
      const key = selectionKey(pick);
      const selected = state.selections.some((selection) => selectionKey(selection) === key);
      if (state.hoverNode && state.hoverNode !== identity.node) {
        const previous = state.hoverNode;
        state.hoverNode = null;
        restoreNode(previous);
      }
      if (state.hoverObject && state.hoverObject !== identity.object) {
        const previous = state.hoverObject;
        state.hoverObject = null;
        restoreObject(previous);
      }
      state.hot = { identity, pick };
      state.hoverNode = identity.node || null;
      state.hoverObject = identity.object || null;
      if (identity.node && !selected) applyNodeHighlight(identity.node, pcbPickerHoverColor);
      if (identity.object && !selected) applyObjectHighlight(identity.object, false);
      updatePcbPickerOverlay(identity.node, (selected ? "Selected " : "Select ") + pick.label, selected, state.pointer);
    }

    function suppressClick() {
      const suppressNextClick = (nextEvent) => {
        nextEvent.preventDefault();
        nextEvent.stopImmediatePropagation();
        document.removeEventListener("click", suppressNextClick, true);
      };
      document.addEventListener("click", suppressNextClick, true);
      window.setTimeout(() => {
        document.removeEventListener("click", suppressNextClick, true);
      }, 900);
    }

    function handlePointerMove(event) {
      updateHover(event);
    }

    function handlePointerDown(event) {
      if (!state.enabled || event.button !== 0) return;
      updateHover(event);
      if (!state.hot?.pick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressClick();
      const { pick, identity } = state.hot;
      const key = selectionKey(pick);
      const existingIndex = state.selections.findIndex((selection) => selectionKey(selection) === key);
      if (existingIndex >= 0) {
        state.selections.splice(existingIndex, 1);
        for (const [node, nodeKey] of state.selectedNodes.entries()) {
          if (nodeKey === key) state.selectedNodes.delete(node);
        }
        for (const [object, objectKey] of state.selectedObjects.entries()) {
          if (objectKey === key) state.selectedObjects.delete(object);
        }
        restoreNode(identity.node);
        restoreObject(identity.object);
        post("unpick");
        updateHover(event);
        return;
      }
      if (state.selections.length >= pcbPickerMaxSelections) {
        post("limit");
        return;
      }
      state.selections.push(pick);
      if (identity.node) state.selectedNodes.set(identity.node, key);
      if (identity.object) state.selectedObjects.set(identity.object, key);
      applySelectedHighlights();
      post("pick");
      updateHover(event);
    }

    function handleKeyDown(event) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      state.selections = [];
      state.enabled = false;
      removeListeners();
      clearHover();
      clearSelectedHighlights();
      post("escape");
    }

    function handleRefresh() {
      if (!state.enabled) {
        hidePcbPickerOverlay();
        return;
      }
      applySelectedHighlights();
    }

    function addListeners() {
      document.addEventListener("pointermove", handlePointerMove, true);
      document.addEventListener("pointerdown", handlePointerDown, true);
      document.addEventListener("keydown", handleKeyDown, true);
      window.addEventListener("scroll", handleRefresh, true);
      window.addEventListener("resize", handleRefresh, true);
    }

    function removeListeners() {
      document.removeEventListener("pointermove", handlePointerMove, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleRefresh, true);
      window.removeEventListener("resize", handleRefresh, true);
    }

    return {
      enable() {
        removeListeners();
        state.enabled = true;
        clearHover();
        applySelectedHighlights();
        addListeners();
        post("enable");
        return snapshot("enable");
      },
      disable() {
        removeListeners();
        state.enabled = false;
        clearHover();
        clearSelectedHighlights();
        post("disable");
        return snapshot("disable");
      },
      clear() {
        removeListeners();
        state.enabled = false;
        state.selections = [];
        clearHover();
        clearSelectedHighlights();
        post("clear");
        return snapshot("clear");
      },
      snapshot(reason = "ready") {
        return snapshot(reason);
      },
    };
  }

  const pcbPickerController = window[pcbPickerKey] || (window[pcbPickerKey] = createPcbPickerController());

  window.addEventListener("message", (event) => {
    const data = event?.data || {};
    if (data.type !== pcbPickerMessageType) {
      return;
    }
    if (data.action === "enable") {
      pcbPickerController.enable();
    } else if (data.action === "disable") {
      pcbPickerController.disable();
    } else if (data.action === "clear") {
      pcbPickerController.clear();
    }
  });

  try {
    window.parent?.postMessage(pcbPickerController.snapshot("ready"), "*");
  } catch {}
})();

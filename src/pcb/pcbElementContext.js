const MAX_CONTEXTS = 3;
const MAX_TEXT = 120;
const MAX_SNIPPET = 240;

function compactText(value, maxLength = MAX_TEXT) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function compactMultiline(value, maxLength = MAX_SNIPPET) {
  const normalized = String(value ?? "")
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  if (!normalized || normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function cleanId(value) {
  return compactText(value, 160);
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function cleanPoint(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const x = cleanNumber(value.x ?? value.xMm);
  const y = cleanNumber(value.y ?? value.yMm);
  if (x == null || y == null) {
    return null;
  }
  return { x, y };
}

function cleanPosition(value) {
  const point = cleanPoint(value);
  return point ? { xMm: point.x, yMm: point.y } : null;
}

function normalizeCircuitJson(value) {
  if (Array.isArray(value)) {
    return value.filter((element) => element && typeof element === "object");
  }
  if (Array.isArray(value?.circuitJson)) {
    return normalizeCircuitJson(value.circuitJson);
  }
  if (Array.isArray(value?.circuit_json)) {
    return normalizeCircuitJson(value.circuit_json);
  }
  if (Array.isArray(value?.elements)) {
    return normalizeCircuitJson(value.elements);
  }
  return [];
}

function primaryIdForElement(element) {
  if (!element || typeof element !== "object") {
    return "";
  }
  if (typeof element.type === "string" && element[`${element.type}_id`]) {
    return String(element[`${element.type}_id`]);
  }
  const key = Object.keys(element).find((name) => /_id$/.test(name) && typeof element[name] === "string");
  return key ? String(element[key]) : "";
}

function buildIndex(circuitJson) {
  const byId = new Map();
  const byType = new Map();
  const sourceByName = new Map();

  for (const element of circuitJson) {
    const type = compactText(element.type, 80);
    if (type) {
      if (!byType.has(type)) {
        byType.set(type, []);
      }
      byType.get(type).push(element);
    }
    const primaryId = primaryIdForElement(element);
    if (primaryId) {
      byId.set(primaryId, element);
    }
    if (element.type === "source_component" && element.name) {
      const name = normalizeDesignator(element.name);
      if (name) {
        sourceByName.set(name, element);
      }
    }
  }

  return {
    byId,
    byType,
    sourceByName,
    list(type) {
      return byType.get(type) || [];
    },
    get(id) {
      return byId.get(String(id || "")) || null;
    },
  };
}

function normalizeDesignator(value) {
  return String(value ?? "").trim().replace(/^\./, "");
}

function sourceComponentValue(sourceComponent) {
  if (!sourceComponent) {
    return "";
  }
  const preferred = [
    sourceComponent.display_value,
    sourceComponent.display_resistance,
    sourceComponent.display_capacitance,
    sourceComponent.display_inductance,
    sourceComponent.display_max_resistance,
    sourceComponent.symbol_display_value,
  ].find((value) => value != null && value !== "");
  if (preferred != null) {
    return compactText(preferred);
  }
  const numericKeys = [
    "resistance",
    "capacitance",
    "inductance",
    "voltage",
    "current",
    "frequency",
    "load_capacitance",
    "max_resistance",
    "max_voltage_rating",
    "max_current_rating",
  ];
  const key = numericKeys.find((name) => sourceComponent[name] != null);
  return key ? compactText(sourceComponent[key]) : "";
}

function firstPresent(...values) {
  for (const value of values) {
    const text = compactText(value);
    if (text) {
      return text;
    }
  }
  return "";
}

function getPcbComponentForElement(element, sourceComponent, index) {
  if (element?.type === "pcb_component") {
    return element;
  }
  if (element?.pcb_component_id) {
    const component = index.get(element.pcb_component_id);
    if (component?.type === "pcb_component") {
      return component;
    }
  }
  if (element?.pcb_port_id) {
    const port = index.get(element.pcb_port_id);
    if (port?.pcb_component_id) {
      const component = index.get(port.pcb_component_id);
      if (component?.type === "pcb_component") {
        return component;
      }
    }
  }
  if (sourceComponent?.source_component_id) {
    return index.list("pcb_component")
      .find((component) => component.source_component_id === sourceComponent.source_component_id) || null;
  }
  return null;
}

function getSourcePortForElement(element, index) {
  if (element?.type === "source_port") {
    return element;
  }
  if (element?.source_port_id) {
    const sourcePort = index.get(element.source_port_id);
    if (sourcePort?.type === "source_port") {
      return sourcePort;
    }
  }
  if (element?.pcb_port_id) {
    const pcbPort = index.get(element.pcb_port_id);
    if (pcbPort?.source_port_id) {
      const sourcePort = index.get(pcbPort.source_port_id);
      if (sourcePort?.type === "source_port") {
        return sourcePort;
      }
    }
  }
  if (element?.schematic_port_id) {
    const schematicPort = index.get(element.schematic_port_id);
    if (schematicPort?.source_port_id) {
      const sourcePort = index.get(schematicPort.source_port_id);
      if (sourcePort?.type === "source_port") {
        return sourcePort;
      }
    }
  }
  return null;
}

function getSourceComponentForElement(element, pick, index) {
  const sourceComponentId = firstPresent(
    pick?.sourceComponentId,
    element?.source_component_id,
  );
  if (sourceComponentId) {
    const sourceComponent = index.get(sourceComponentId);
    if (sourceComponent?.type === "source_component") {
      return sourceComponent;
    }
  }
  if (element?.type === "source_component") {
    return element;
  }
  const sourcePort = getSourcePortForElement(element, index);
  if (sourcePort?.source_component_id) {
    const sourceComponent = index.get(sourcePort.source_component_id);
    if (sourceComponent?.type === "source_component") {
      return sourceComponent;
    }
  }
  if (element?.pcb_component_id) {
    const pcbComponent = index.get(element.pcb_component_id);
    if (pcbComponent?.source_component_id) {
      const sourceComponent = index.get(pcbComponent.source_component_id);
      if (sourceComponent?.type === "source_component") {
        return sourceComponent;
      }
    }
  }
  const designator = normalizeDesignator(pick?.name);
  if (designator) {
    return index.sourceByName.get(designator) || null;
  }
  return null;
}

function getCadComponent(sourceComponent, pcbComponent, element, index) {
  if (element?.type === "cad_component") {
    return element;
  }
  const sourceComponentId = sourceComponent?.source_component_id;
  const pcbComponentId = pcbComponent?.pcb_component_id || element?.pcb_component_id;
  return index.list("cad_component").find((cadComponent) => (
    (sourceComponentId && cadComponent.source_component_id === sourceComponentId)
      || (pcbComponentId && cadComponent.pcb_component_id === pcbComponentId)
  )) || null;
}

function getSchematicComponentForElement(element, sourceComponent, index) {
  if (element?.type === "schematic_component") {
    return element;
  }
  if (element?.schematic_component_id) {
    const schematicComponent = index.get(element.schematic_component_id);
    if (schematicComponent?.type === "schematic_component") {
      return schematicComponent;
    }
  }
  if (sourceComponent?.source_component_id) {
    return index.list("schematic_component")
      .find((component) => component.source_component_id === sourceComponent.source_component_id) || null;
  }
  return null;
}

function portLabel(sourcePort, fallback = "") {
  return compactText(
    sourcePort?.name
      || sourcePort?.port_hints?.[0]
      || sourcePort?.pin_number
      || fallback,
    60,
  );
}

function netLabel(sourceNet) {
  return compactText(sourceNet?.name || sourceNet?.source_net_id, 80);
}

function traceLabel(sourceTrace) {
  return compactText(sourceTrace?.display_name || sourceTrace?.source_trace_id, 80);
}

function uniqueStrings(values, limit) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = compactText(value);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    result.push(text);
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function sourceNetsForPort(sourcePort, index) {
  if (!sourcePort?.source_port_id) {
    return [];
  }
  const nets = [];
  const key = sourcePort.subcircuit_connectivity_map_key;
  if (key) {
    nets.push(...index.list("source_net").filter((net) => net.subcircuit_connectivity_map_key === key));
  }
  for (const trace of index.list("source_trace")) {
    if (!Array.isArray(trace.connected_source_port_ids) || !trace.connected_source_port_ids.includes(sourcePort.source_port_id)) {
      continue;
    }
    for (const netId of trace.connected_source_net_ids || []) {
      const sourceNet = index.get(netId);
      if (sourceNet?.type === "source_net") {
        nets.push(sourceNet);
      }
    }
    if (trace.subcircuit_connectivity_map_key) {
      nets.push(...index.list("source_net")
        .filter((net) => net.subcircuit_connectivity_map_key === trace.subcircuit_connectivity_map_key));
    }
  }
  return uniqueById(nets);
}

function sourceTracesForPort(sourcePort, index) {
  if (!sourcePort?.source_port_id) {
    return [];
  }
  const key = sourcePort.subcircuit_connectivity_map_key;
  return index.list("source_trace").filter((trace) => (
    Array.isArray(trace.connected_source_port_ids)
      && trace.connected_source_port_ids.includes(sourcePort.source_port_id)
  ) || (key && trace.subcircuit_connectivity_map_key === key));
}

function uniqueById(elements) {
  const seen = new Set();
  const result = [];
  for (const element of elements) {
    const id = primaryIdForElement(element);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(element);
  }
  return result;
}

function sourceNetNamesForPort(sourcePort, index) {
  const namedNets = sourceNetsForPort(sourcePort, index).map(netLabel);
  if (namedNets.length) {
    return uniqueStrings(namedNets, 6);
  }
  return uniqueStrings(sourceTracesForPort(sourcePort, index).map(traceLabel), 6);
}

function padsForComponent(pcbComponent, index) {
  if (!pcbComponent?.pcb_component_id) {
    return [];
  }
  const padElements = [
    ...index.list("pcb_smtpad"),
    ...index.list("pcb_plated_hole"),
  ].filter((element) => element.pcb_component_id === pcbComponent.pcb_component_id);

  return padElements.map((pad, padIndex) => {
    const pcbPort = pad.pcb_port_id ? index.get(pad.pcb_port_id) : null;
    const sourcePort = pcbPort?.source_port_id ? index.get(pcbPort.source_port_id) : null;
    const pin = portLabel(sourcePort, pad.port_hints?.[0] || padIndex + 1);
    const net = sourceNetNamesForPort(sourcePort, index)[0] || "";
    return {
      pin: compactText(pin, 60),
      net: compactText(net, 80),
    };
  }).filter((pad) => pad.pin || pad.net).slice(0, 8);
}

function netsForComponent(sourceComponent, index, pick) {
  const nets = [];
  if (Array.isArray(pick?.netIds)) {
    for (const netId of pick.netIds) {
      const sourceNet = index.get(netId);
      nets.push(netLabel(sourceNet) || netId);
    }
  }
  if (sourceComponent?.source_component_id) {
    const sourcePorts = index.list("source_port")
      .filter((port) => port.source_component_id === sourceComponent.source_component_id);
    for (const sourcePort of sourcePorts) {
      nets.push(...sourceNetNamesForPort(sourcePort, index));
    }
  }
  return uniqueStrings(nets, 6);
}

function neighborsForComponent(sourceComponent, index) {
  if (!sourceComponent?.source_component_id) {
    return [];
  }
  const neighbors = [];
  const sourcePorts = index.list("source_port")
    .filter((port) => port.source_component_id === sourceComponent.source_component_id);

  for (const sourcePort of sourcePorts) {
    const traces = sourceTracesForPort(sourcePort, index);
    for (const trace of traces) {
      const netNames = uniqueStrings([
        ...((trace.connected_source_net_ids || []).map((netId) => netLabel(index.get(netId)) || netId)),
        ...index.list("source_net")
          .filter((net) => trace.subcircuit_connectivity_map_key && net.subcircuit_connectivity_map_key === trace.subcircuit_connectivity_map_key)
          .map(netLabel),
      ], 2);
      const via = netNames[0] ? `via net ${netNames[0]}` : `via trace ${traceLabel(trace)}`;
      for (const otherPortId of trace.connected_source_port_ids || []) {
        if (otherPortId === sourcePort.source_port_id) {
          continue;
        }
        const otherPort = index.get(otherPortId);
        const otherComponent = otherPort?.source_component_id ? index.get(otherPort.source_component_id) : null;
        if (!otherComponent || otherComponent.source_component_id === sourceComponent.source_component_id) {
          continue;
        }
        neighbors.push(`${otherComponent.name || otherComponent.source_component_id}.${portLabel(otherPort, otherPortId)} ${via}`);
      }
    }
    const key = sourcePort.subcircuit_connectivity_map_key;
    if (key) {
      const netName = index.list("source_net").find((net) => net.subcircuit_connectivity_map_key === key);
      for (const otherPort of index.list("source_port")) {
        if (
          otherPort.source_port_id === sourcePort.source_port_id
          || otherPort.source_component_id === sourceComponent.source_component_id
          || otherPort.subcircuit_connectivity_map_key !== key
        ) {
          continue;
        }
        const otherComponent = otherPort.source_component_id ? index.get(otherPort.source_component_id) : null;
        if (otherComponent?.type === "source_component") {
          neighbors.push(`${otherComponent.name || otherComponent.source_component_id}.${portLabel(otherPort)} via net ${netLabel(netName) || key}`);
        }
      }
    }
  }

  return uniqueStrings(neighbors, 6);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSourceAnchor(source, designator, boardPath, sourceComponent) {
  if (!source || !designator || !boardPath) {
    return null;
  }
  const lines = String(source).split(/\r?\n/);
  const escaped = escapeRegExp(designator);
  const tagName = ftypeToTagName(sourceComponent?.ftype);
  const patterns = [
    new RegExp(`name\\s*=\\s*["']\\.?${escaped}["']`),
    new RegExp(`name\\s*=\\s*\\{\\s*["']\\.?${escaped}["']\\s*\\}`),
    tagName ? new RegExp(`<${escapeRegExp(tagName)}\\b[^>]*name\\s*=\\s*["']\\.?${escaped}["']`) : null,
  ].filter(Boolean);

  const index = lines.findIndex((line) => patterns.some((pattern) => pattern.test(line)));
  if (index < 0) {
    return null;
  }
  const start = Math.max(0, index - 1);
  const end = Math.min(lines.length, index + 2);
  return {
    path: compactText(boardPath, 240),
    line: index + 1,
    snippet: compactMultiline(lines.slice(start, end).join("\n"), MAX_SNIPPET),
  };
}

function ftypeToTagName(ftype) {
  const clean = String(ftype || "").replace(/^simple_/, "");
  const aliases = {
    led: "led",
    resistor: "resistor",
    capacitor: "capacitor",
    inductor: "inductor",
    diode: "diode",
    chip: "chip",
    pin_header: "pinheader",
    connector: "connector",
    test_point: "testpoint",
  };
  return aliases[clean] || clean || "";
}

function positionForSelection(pick, element, pcbComponent, schematicComponent, cadComponent) {
  const candidates = [
    pick?.pointMm,
    element?.center,
    element && (element.x != null || element.y != null) ? { x: element.x, y: element.y } : null,
    pcbComponent?.center,
    schematicComponent?.center,
    cadComponent?.position,
  ];
  for (const candidate of candidates) {
    const position = cleanPosition(candidate);
    if (position) {
      return position;
    }
  }
  return null;
}

function pointForSelection(pick, position) {
  const point = cleanPoint(pick?.pointMm);
  if (point) {
    return point;
  }
  return position ? { x: position.xMm, y: position.yMm } : null;
}

function resolveCircuitElement(pick, index) {
  const id = firstPresent(pick?.circuitElementId);
  if (id) {
    const element = index.get(id);
    if (element) {
      return element;
    }
  }
  const type = compactText(pick?.elementType, 80);
  const name = normalizeDesignator(pick?.name);
  if (type === "source_component" && name) {
    return index.sourceByName.get(name) || null;
  }
  return null;
}

export function resolvePcbPickedElementContext(pick, {
  circuitJson,
  source,
  board_path: boardPath,
  boardTitle,
} = {}) {
  if (!pick || typeof pick !== "object") {
    return null;
  }
  const id = cleanId(pick.id);
  if (!id) {
    return null;
  }

  const normalizedCircuitJson = normalizeCircuitJson(circuitJson);
  const index = buildIndex(normalizedCircuitJson);
  const circuitElement = resolveCircuitElement(pick, index);
  const sourceComponent = getSourceComponentForElement(circuitElement, pick, index);
  const pcbComponent = getPcbComponentForElement(circuitElement, sourceComponent, index);
  const schematicComponent = getSchematicComponentForElement(circuitElement, sourceComponent, index);
  const cadComponent = getCadComponent(sourceComponent, pcbComponent, circuitElement, index);
  const designator = compactText(normalizeDesignator(sourceComponent?.name || pick.name));
  const elementType = compactText(circuitElement?.type || pick.elementType, 80);
  const footprint = firstPresent(
    pick.footprint,
    cadComponent?.footprinter_string,
    sourceComponent?.footprint,
    sourceComponent?.footprinter_string,
    pcbComponent?.footprint,
    pcbComponent?.metadata?.kicad_footprint?.footprintName,
  );
  const value = sourceComponentValue(sourceComponent);
  const position = positionForSelection(pick, circuitElement, pcbComponent, schematicComponent, cadComponent);
  const pointMm = pointForSelection(pick, position);
  const pads = padsForComponent(pcbComponent, index);
  const nets = netsForComponent(sourceComponent, index, pick);
  const neighbors = neighborsForComponent(sourceComponent, index);
  const label = firstPresent(
    pick.label,
    [designator, footprint].filter(Boolean).join(" · "),
    designator,
    elementType,
    "PCB element",
  );

  return normalizePcbElementContext({
    id,
    kind: "pcb-element",
    tab: compactText(pick.tab, 40),
    space: compactText(pick.space, 20),
    label,
    designator,
    elementType,
    footprint,
    value,
    position,
    layer: compactText(circuitElement?.layer || pcbComponent?.layer || pick.layer, 40),
    pads,
    nets,
    neighbors,
    sourceAnchor: findSourceAnchor(source, designator, boardPath, sourceComponent),
    pointMm,
    boardTitle: compactText(boardTitle, 160),
  });
}

function normalizePcbElementContext(context) {
  if (!context || typeof context !== "object") {
    return null;
  }
  const id = cleanId(context.id);
  if (!id) {
    return null;
  }
  const position = context.position && typeof context.position === "object"
    ? {
      xMm: cleanNumber(context.position.xMm ?? context.position.x),
      yMm: cleanNumber(context.position.yMm ?? context.position.y),
    }
    : null;
  const cleanPositionValue = position && position.xMm != null && position.yMm != null ? position : null;
  const pointMm = cleanPoint(context.pointMm);
  const sourceAnchor = context.sourceAnchor && typeof context.sourceAnchor === "object"
    ? {
      path: compactText(context.sourceAnchor.path, 240),
      line: Number.parseInt(context.sourceAnchor.line, 10) || 0,
      snippet: compactMultiline(context.sourceAnchor.snippet, MAX_SNIPPET),
    }
    : null;

  return {
    id,
    kind: "pcb-element",
    tab: compactText(context.tab, 40),
    space: compactText(context.space, 20),
    label: compactText(context.label),
    designator: compactText(context.designator),
    elementType: compactText(context.elementType, 80),
    footprint: compactText(context.footprint),
    value: compactText(context.value),
    position: cleanPositionValue,
    layer: compactText(context.layer, 40),
    pads: (Array.isArray(context.pads) ? context.pads : [])
      .map((pad) => ({
        pin: compactText(pad?.pin, 60),
        net: compactText(pad?.net, 80),
      }))
      .filter((pad) => pad.pin || pad.net)
      .slice(0, 8),
    nets: uniqueStrings(Array.isArray(context.nets) ? context.nets : [], 6),
    neighbors: uniqueStrings(Array.isArray(context.neighbors) ? context.neighbors : [], 6),
    sourceAnchor: sourceAnchor?.path && sourceAnchor.line && sourceAnchor.snippet ? sourceAnchor : null,
    pointMm,
    boardTitle: compactText(context.boardTitle, 160),
  };
}

export function normalizePcbElementContexts(list) {
  const values = Array.isArray(list)
    ? list
    : list && typeof list === "object"
      ? [list]
      : [];
  return values
    .map((context) => normalizePcbElementContext(context))
    .filter(Boolean)
    .slice(0, MAX_CONTEXTS);
}

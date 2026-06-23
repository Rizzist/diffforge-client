export const DFBLUEPRINT_SOURCE_FORMAT = "dfblueprint.v1";
export const DFBLUEPRINT_CANONICAL_FORMAT = "diffforge.dfblueprint.v1";

function safeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function sanitizeDfBlueprintId(value, fallback = "node") {
  const safe = String(value ?? "")
    .trim()
    .replace(/^"|"$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || fallback;
}

function quoteDfBlueprint(value) {
  return `"${String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/"/g, '\\"')}"`;
}

function unquoteDfBlueprint(value) {
  const trimmed = String(value ?? "").trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\t/g, "\t")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\\\/g, "\\");
  }
  return trimmed.replace(/^'|'$/g, "");
}

function splitDfBlueprintTopLevel(input, separator = ",") {
  const parts = [];
  let current = "";
  let quote = "";
  let bracketDepth = 0;
  let parenDepth = 0;
  let escaped = false;
  for (const char of String(input ?? "")) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (char === separator && bracketDepth === 0 && parenDepth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function parseDfBlueprintProps(rawProps = "") {
  const props = {};
  for (const part of splitDfBlueprintTopLevel(rawProps)) {
    const colonIndex = part.indexOf(":");
    const equalsIndex = part.indexOf("=");
    let index = -1;
    if (colonIndex > 0 && equalsIndex > 0) index = Math.min(colonIndex, equalsIndex);
    else index = colonIndex > 0 ? colonIndex : equalsIndex;
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = unquoteDfBlueprint(part.slice(index + 1).trim());
    if (!key) continue;
    props[key] = value;
    props[key.toLowerCase()] = value;
  }
  return props;
}

function serializeDfBlueprintProps(props = {}, preferredKeys = []) {
  const seen = new Set();
  const seenLower = new Set();
  const ordered = [];
  const pushKey = (key) => {
    const lowerKey = String(key || "").toLowerCase();
    if (!key || seen.has(key) || seenLower.has(lowerKey)) return;
    const value = props[key];
    if (value === undefined || value === null || value === "") return;
    seen.add(key);
    seenLower.add(lowerKey);
    ordered.push([key, value]);
  };
  preferredKeys.forEach(pushKey);
  Object.keys(props)
    .sort()
    .forEach(pushKey);
  return ordered.map(([key, value]) => {
    const stringValue = String(value);
    const serialized = /^[a-zA-Z0-9_.:/@-]+$/.test(stringValue)
      ? stringValue
      : quoteDfBlueprint(stringValue);
    return `${key}: ${serialized}`;
  }).join(", ");
}

function numberOrNull(value) {
  const number = Number.parseFloat(value);
  return Number.isFinite(number) ? number : null;
}

function parseNodeLine(line, lineIndex) {
  const match = String(line || "").trim().match(/^(node|trigger)\s+((?:"(?:\\"|[^"])*")|(?:[^\[]+?))\s*\[(.*)\]\s*$/i);
  if (!match) return null;
  const lineKind = match[1].toLowerCase();
  const label = unquoteDfBlueprint(match[2].trim());
  const props = parseDfBlueprintProps(match[3]);
  const id = safeText(props.id || props.node_id, sanitizeDfBlueprintId(label, `${lineKind}-${lineIndex}`));
  const triggerId = safeText(props.trigger_id);
  const kind = lineKind === "trigger"
    ? "trigger"
    : safeText(props.kind || props.node_kind || props.type, "action");
  const x = numberOrNull(props.x ?? props.pos_x ?? props.left);
  const y = numberOrNull(props.y ?? props.pos_y ?? props.top);
  return {
    id,
    label: label || id,
    kind,
    nodeKind: kind === "trigger" ? "" : kind,
    role: safeText(props.role, kind === "trigger" ? "trigger" : "action"),
    icon: safeText(props.icon),
    mode: safeText(props.mode || props.splitter_mode),
    triggerId,
    triggerType: safeText(props.trigger_type),
    hasPosition: x !== null || y !== null,
    x: x ?? 0,
    y: y ?? 0,
    props,
  };
}

function parseEdgeEndpoint(raw) {
  const endpoint = String(raw || "").trim();
  const match = endpoint.match(/^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)$/);
  if (!match) return null;
  return {
    nodeId: match[1],
    portId: match[2],
  };
}

function parseEdgeLine(line, lineIndex) {
  const trimmed = String(line || "").trim();
  const match = trimmed.match(/^edge\s+([a-zA-Z0-9_.-]+)\s*->\s*([a-zA-Z0-9_.-]+)(?:\s*\[(.*)\])?\s*$/i);
  if (!match) return null;
  const from = parseEdgeEndpoint(match[1]);
  const to = parseEdgeEndpoint(match[2]);
  if (!from || !to) return null;
  const props = parseDfBlueprintProps(match[3] || "");
  const id = safeText(props.id || props.edge_id, `edge-${from.nodeId}-${from.portId}-${to.nodeId}-${to.portId}-${lineIndex}`);
  return {
    id,
    from: from.nodeId,
    fromPort: from.portId,
    to: to.nodeId,
    toPort: to.portId,
    label: safeText(props.label || props.name),
    role: safeText(props.role, "flow"),
    props,
  };
}

export function emptyDfBlueprintAst(name = "Loopspace") {
  return {
    format: DFBLUEPRINT_CANONICAL_FORMAT,
    name: safeText(name, "Loopspace"),
    direction: "right",
    nodes: [],
    edges: [],
  };
}

export function parseDfBlueprintSource(source = "") {
  const text = String(source || "");
  const ast = emptyDfBlueprintAst();
  if (!text.trim()) return ast;
  const hasBlueprintHeader = text.split(/\r?\n/).some((line) => /^\s*(dfblueprint|blueprint|format)\b/i.test(line));
  if (!hasBlueprintHeader) return ast;
  const seenNodes = new Set();
  text.split(/\r?\n/).forEach((line, lineIndex) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) return;
    const headerMatch = trimmed.match(/^(dfblueprint|blueprint)\s+(.+)$/i);
    if (headerMatch) {
      ast.name = unquoteDfBlueprint(headerMatch[2].trim()) || ast.name;
      return;
    }
    const directionMatch = trimmed.match(/^direction\s+([a-zA-Z0-9_-]+)$/i);
    if (directionMatch) {
      ast.direction = directionMatch[1];
      return;
    }
    if (/^format\s+/i.test(trimmed)) return;
    const node = parseNodeLine(trimmed, lineIndex);
    if (node) {
      if (!seenNodes.has(node.id)) {
        seenNodes.add(node.id);
        ast.nodes.push(node);
      }
      return;
    }
    const edge = parseEdgeLine(trimmed, lineIndex);
    if (edge) ast.edges.push(edge);
  });
  return ast;
}

export function serializeDfBlueprint(ast = emptyDfBlueprintAst()) {
  const next = {
    ...emptyDfBlueprintAst(ast.name),
    ...ast,
    nodes: Array.isArray(ast.nodes) ? ast.nodes : [],
    edges: Array.isArray(ast.edges) ? ast.edges : [],
  };
  const lines = [
    `dfblueprint ${quoteDfBlueprint(next.name || "Loopspace")}`,
    `format ${DFBLUEPRINT_CANONICAL_FORMAT}`,
    `direction ${safeText(next.direction, "right")}`,
    "",
  ];
  for (const node of next.nodes) {
    const isTrigger = Boolean(node.triggerId) || node.kind === "trigger" || node.role === "trigger";
    const props = {
      id: node.id,
      ...(isTrigger ? {
        trigger_id: node.triggerId,
        trigger_type: node.triggerType || node.type || "manual",
      } : {
        kind: node.nodeKind || node.kind || "action",
        role: node.role || "action",
      }),
      ...(node.icon ? { icon: node.icon } : {}),
      ...(node.mode ? { mode: node.mode } : {}),
      ...(node.hasPosition || Number.isFinite(node.x) ? { x: Math.round(Number(node.x) || 0) } : {}),
      ...(node.hasPosition || Number.isFinite(node.y) ? { y: Math.round(Number(node.y) || 0) } : {}),
      ...(node.props && typeof node.props === "object" ? Object.fromEntries(
        Object.entries(node.props).filter(([key]) => ![
          "id", "nodeId", "nodeid", "node_id", "kind", "nodeKind", "nodekind", "node_kind", "role", "icon", "mode", "x", "y",
          "triggerId", "triggerid", "trigger_id", "trigger", "triggerType", "triggertype", "trigger_type", "type",
        ].includes(key)),
      ) : {}),
    };
    lines.push(`${isTrigger ? "trigger" : "node"} ${quoteDfBlueprint(node.label || node.id)} [${serializeDfBlueprintProps(props, isTrigger
      ? ["id", "trigger_id", "trigger_type", "icon", "x", "y"]
      : ["id", "kind", "role", "icon", "mode", "x", "y"])}]`);
  }
  if (next.nodes.length && next.edges.length) lines.push("");
  for (const edge of next.edges) {
    const fromPort = safeText(edge.fromPort);
    const toPort = safeText(edge.toPort);
    if (!fromPort || !toPort) continue;
    const props = {
      id: edge.id,
      role: edge.role || "flow",
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.props && typeof edge.props === "object" ? Object.fromEntries(
        Object.entries(edge.props).filter(([key]) => ![
          "id", "edgeId", "edgeid", "edge_id", "role", "label", "name", "fromPort", "fromport", "from_port", "toPort", "toport", "to_port",
        ].includes(key)),
      ) : {}),
    };
    lines.push(`edge ${edge.from}.${fromPort} -> ${edge.to}.${toPort} [${serializeDfBlueprintProps(props, ["id", "role", "label"])}]`);
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function normalizeDfBlueprintSource(source = "", options = {}) {
  const ast = parseDfBlueprintSource(source);
  if (options.name && (!ast.name || ast.name === "Loopspace")) {
    ast.name = options.name;
  }
  return serializeDfBlueprint(ast);
}

export function createDfBlueprintNodeFromTemplate(template, position = null) {
  const templateId = sanitizeDfBlueprintId(template?.id || template?.node_kind || "node", "node").replace(/-/g, "_");
  const deviceId = safeText(template?.device_id);
  if (templateId === "device" && deviceId) {
    const safeDeviceId = sanitizeDfBlueprintId(deviceId, "device");
    const label = safeText(template?.label || template?.device_label, deviceId);
    return {
      id: `device-${safeDeviceId}`,
      icon: safeText(template?.icon, "device"),
      label,
      mode: "",
      nodeKind: "device",
      kind: "device",
      role: safeText(template?.role, "variable"),
      triggerId: "",
      hasPosition: Boolean(position),
      x: position ? Math.round(Number(position.x) || 0) : 0,
      y: position ? Math.round(Number(position.y) || 0) : 0,
      props: {
        device_id: deviceId,
        device_label: label,
        platform: safeText(template?.platform),
        status: safeText(template?.status, "offline"),
      },
    };
  }
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  if (templateId === "run_script") {
    const scriptId = safeText(template?.script_id || template?.script);
    const pathKey = safeText(template?.path_key);
    const scriptName = safeText(template?.script_name || template?.label, scriptId || pathKey || "Script");
    const deviceLabel = safeText(template?.device_label);
    return {
      id: `${templateId}-${sanitizeDfBlueprintId(scriptId || pathKey || "script", "script")}-${suffix}`,
      icon: safeText(template?.icon, "terminal"),
      label: safeText(template?.label, scriptName),
      mode: "",
      nodeKind: "run_script",
      kind: "run_script",
      role: safeText(template?.role, "action"),
      triggerId: "",
      hasPosition: Boolean(position),
      x: position ? Math.round(Number(position.x) || 0) : 0,
      y: position ? Math.round(Number(position.y) || 0) : 0,
      props: {
        device_id: deviceId,
        device_label: deviceLabel,
        path_key: pathKey,
        script_id: scriptId || pathKey,
        script_name: scriptName,
        shell: safeText(template?.shell),
      },
    };
  }
  if (templateId === "send_message") {
    const deviceLabel = safeText(template?.device_label);
    return {
      id: `${templateId}-${suffix}`,
      icon: safeText(template?.icon, "message"),
      label: safeText(template?.label, "Send message"),
      mode: "",
      nodeKind: "send_message",
      kind: "send_message",
      role: safeText(template?.role, "action"),
      triggerId: "",
      hasPosition: Boolean(position),
      x: position ? Math.round(Number(position.x) || 0) : 0,
      y: position ? Math.round(Number(position.y) || 0) : 0,
      props: {
        device_id: deviceId,
        device_label: deviceLabel,
        display: "region",
        h: "260",
        model: safeText(template?.model),
        prompt: "",
        reasoning_effort: safeText(template?.reasoning_effort || template?.effort),
        speed: safeText(template?.speed),
        target_agent_id: safeText(template?.target_agent_id || template?.agent_id, "codex"),
        target_terminal_id: safeText(template?.target_terminal_id),
        target_terminal_name: safeText(template?.target_terminal_name),
        w: "680",
      },
    };
  }
  if (templateId === "document_read" || templateId === "document_write") {
    const mode = templateId === "document_read" ? "read" : "write";
    const label = safeText(template?.label, mode === "read" ? "Document read" : "Document write");
    return {
      id: `${templateId}-${suffix}`,
      icon: safeText(template?.icon, "document"),
      label,
      mode,
      nodeKind: templateId,
      kind: templateId,
      role: safeText(template?.role, "context"),
      triggerId: "",
      hasPosition: Boolean(position),
      x: position ? Math.round(Number(position.x) || 0) : 0,
      y: position ? Math.round(Number(position.y) || 0) : 0,
      props: {
        doc_refs: safeText(template?.doc_refs || template?.documents || template?.path_key),
        mode,
      },
    };
  }
  return {
    id: `${templateId}-${suffix}`,
    icon: safeText(template?.icon, "node"),
    label: safeText(template?.label, "Graph node"),
    mode: "",
    nodeKind: templateId,
    kind: templateId,
    role: safeText(template?.role, "action"),
    triggerId: "",
    hasPosition: Boolean(position),
    x: position ? Math.round(Number(position.x) || 0) : 0,
    y: position ? Math.round(Number(position.y) || 0) : 0,
    props: {},
  };
}

export function createDfBlueprintTriggerNode(trigger, position = null) {
  const triggerId = safeText(trigger?.trigger_id || trigger?.id);
  const type = safeText(trigger?.type || trigger?.trigger_type, "manual").toLowerCase();
  return {
    id: `trigger-${triggerId}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
    icon: type === "cron" ? "clock" : type === "webhook" ? "webhook" : "play",
    label: safeText(trigger?.name || triggerId, "Trigger"),
    kind: "trigger",
    nodeKind: "",
    role: "trigger",
    triggerId,
    triggerType: type,
    hasPosition: Boolean(position),
    x: position ? Math.round(Number(position.x) || 0) : 0,
    y: position ? Math.round(Number(position.y) || 0) : 0,
    props: {},
  };
}

export function addDfBlueprintNode(source, node, options = {}) {
  const ast = parseDfBlueprintSource(source);
  if (options.name && (!ast.name || ast.name === "Loopspace")) ast.name = options.name;
  if (!ast.nodes.some((item) => item.id === node.id)) ast.nodes.push(node);
  return serializeDfBlueprint(ast);
}

export function removeDfBlueprintNode(source, nodeId) {
  const id = safeText(nodeId);
  const ast = parseDfBlueprintSource(source);
  ast.nodes = ast.nodes.filter((node) => node.id !== id);
  ast.edges = ast.edges.filter((edge) => edge.from !== id && edge.to !== id);
  return serializeDfBlueprint(ast);
}

export function removeDfBlueprintTrigger(source, triggerId) {
  const id = safeText(triggerId);
  const ast = parseDfBlueprintSource(source);
  const nodeIds = new Set(ast.nodes.filter((node) => node.triggerId === id).map((node) => node.id));
  ast.nodes = ast.nodes.filter((node) => node.triggerId !== id);
  ast.edges = ast.edges.filter((edge) => !nodeIds.has(edge.from) && !nodeIds.has(edge.to));
  return serializeDfBlueprint(ast);
}

export function removeDfBlueprintEdge(source, edgeId) {
  const id = safeText(edgeId);
  if (!id) return source || "";
  const ast = parseDfBlueprintSource(source);
  ast.edges = ast.edges.filter((edge) => edge.id !== id);
  return serializeDfBlueprint(ast);
}

export function connectDfBlueprintNodes(source, fromNode, toNode, options = {}) {
  const from = safeText(fromNode?.id || fromNode);
  const to = safeText(toNode?.id || toNode);
  if (!from || !to || from === to) return source || "";
  const ast = parseDfBlueprintSource(source);
  const fromPort = safeText(options.fromPort || options.from_port, "out");
  const toPort = safeText(options.toPort || options.to_port, "in");
  const branch = safeText(options.branch || fromPort);
  const label = safeText(options.label, branch ? branch.toUpperCase() : "NEXT");
  if (ast.edges.some((edge) => (
    edge.from === from
    && edge.to === to
    && edge.fromPort === fromPort
    && edge.toPort === toPort
  ))) {
    return serializeDfBlueprint(ast);
  }
  ast.edges.push({
    id: `edge-${from}-${fromPort}-${to}-${toPort}-${Date.now().toString(36)}`,
    from,
    fromPort,
    to,
    toPort,
    label,
    role: "flow",
    props: branch ? { branch } : {},
  });
  return serializeDfBlueprint(ast);
}

export function updateDfBlueprintNodeProps(source, nodeId, patch = {}) {
  const id = safeText(nodeId);
  const ast = parseDfBlueprintSource(source);
  ast.nodes = ast.nodes.map((node) => {
    if (node.id !== id) return node;
    const next = {
      ...node,
      ...patch,
      props: {
        ...(node.props || {}),
        ...(patch.props || {}),
      },
    };
    if (Object.prototype.hasOwnProperty.call(patch, "hasPosition")) {
      next.hasPosition = Boolean(patch.hasPosition);
    } else if (Object.prototype.hasOwnProperty.call(patch, "x") || Object.prototype.hasOwnProperty.call(patch, "y")) {
      next.hasPosition = true;
    }
    return next;
  });
  return serializeDfBlueprint(ast);
}

export function applyDfBlueprintPatchOperations(source, operations = [], options = {}) {
  let ast = parseDfBlueprintSource(source);
  if (options.name && (!ast.name || ast.name === "Loopspace")) ast.name = options.name;
  for (const op of Array.isArray(operations) ? operations : []) {
    const action = safeText(op?.op || op?.type || op?.action).toLowerCase();
    if (action === "addnode" || action === "add_node") {
      const node = createDfBlueprintNodeFromTemplate({
        id: op.kind || op.node_kind || "action",
        label: op.label || op.name || "Graph node",
        role: op.role || "action",
        icon: op.icon || "",
        mode: op.mode || "",
        device_id: op.device_id,
        device_label: op.device_label,
        path_key: op.path_key,
        script_id: op.script_id,
        script_name: op.script_name,
        shell: op.shell,
        doc_refs: op.doc_refs || op.documents,
      }, op.position || { x: op.x, y: op.y });
      if (op.id) node.id = sanitizeDfBlueprintId(op.id, node.id);
      const existingIndex = ast.nodes.findIndex((item) => item.id === node.id);
      if (existingIndex >= 0) {
        ast.nodes[existingIndex] = {
          ...ast.nodes[existingIndex],
          ...node,
          props: {
            ...(ast.nodes[existingIndex].props || {}),
            ...(node.props || {}),
          },
        };
      } else {
        ast.nodes.push(node);
      }
    } else if (action === "addtrigger" || action === "add_trigger" || action === "attach_trigger") {
      const node = createDfBlueprintTriggerNode({
        trigger_id: op.trigger_id,
        name: op.label || op.name,
        trigger_type: op.trigger_type || op.type,
      }, op.position || { x: op.x, y: op.y });
      if (node.triggerId && !ast.nodes.some((item) => item.id === node.id)) ast.nodes.push(node);
    } else if (action === "removenode" || action === "remove_node") {
      const id = safeText(op.node_id || op.id);
      ast.nodes = ast.nodes.filter((node) => node.id !== id);
      ast.edges = ast.edges.filter((edge) => edge.from !== id && edge.to !== id);
    } else if (action === "movenode" || action === "move_node") {
      const id = safeText(op.node_id || op.id);
      ast.nodes = ast.nodes.map((node) => node.id === id ? {
        ...node,
        hasPosition: true,
        x: Math.round(Number(op.x ?? op.position?.x ?? node.x) || 0),
        y: Math.round(Number(op.y ?? op.position?.y ?? node.y) || 0),
      } : node);
    } else if (action === "connect") {
      const from = safeText(op.from || op.from_id);
      const to = safeText(op.to || op.to_id);
      const fromPort = safeText(op.from_port);
      const toPort = safeText(op.to_port);
      const branch = safeText(op.branch || fromPort);
      if (from && to && from !== to && fromPort && toPort && !ast.edges.some((edge) => (
        edge.from === from
        && edge.to === to
        && edge.fromPort === fromPort
        && edge.toPort === toPort
      ))) {
        ast.edges.push({
          id: safeText(op.edge_id || op.id, `edge-${from}-${fromPort}-${to}-${toPort}-${Date.now().toString(36)}`),
          from,
          fromPort,
          to,
          toPort,
          label: safeText(op.label, branch ? branch.toUpperCase() : "NEXT"),
          role: safeText(op.role, "flow"),
          props: branch ? { branch } : {},
        });
      }
    } else if (action === "disconnect") {
      const edgeId = safeText(op.edge_id || op.id);
      const from = safeText(op.from || op.from_id);
      const to = safeText(op.to || op.to_id);
      const fromPort = safeText(op.from_port || op.fromPort);
      const toPort = safeText(op.to_port || op.toPort);
      const branch = safeText(op.branch);
      ast.edges = ast.edges.filter((edge) => {
        if (edgeId) return edge.id !== edgeId;
        if (edge.from !== from || edge.to !== to) return true;
        if (fromPort && edge.fromPort !== fromPort) return true;
        if (toPort && edge.toPort !== toPort) return true;
        if (branch && safeText(edge.props?.branch || edge.branch || edge.fromPort) !== branch) return true;
        return false;
      });
    } else if (action === "updatenodeprops" || action === "update_node_props" || action === "updateprops") {
      const id = safeText(op.node_id || op.id);
      ast.nodes = ast.nodes.map((node) => {
        if (node.id !== id) return node;
        const props = op.props && typeof op.props === "object" ? op.props : {};
        return {
          ...node,
          ...props,
          props: {
            ...(node.props || {}),
            ...props,
          },
        };
      });
    }
  }
  return serializeDfBlueprint(ast);
}

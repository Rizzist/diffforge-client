import {
  loopspaceGraphVisualDefaultsForNode,
  validateLoopspaceGraphAst,
  validateLoopspaceGraphAstForUpdate,
  validateLoopspaceGraphEdgeCandidate,
} from "./graphContract.js";

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

const DEPRECATED_DFBLUEPRINT_CREATION_KINDS = new Set(["device"]);

function creatableDfBlueprintTemplateId(value, fallback = "node") {
  const templateId = sanitizeDfBlueprintId(value, fallback).replace(/-/g, "_");
  return DEPRECATED_DFBLUEPRINT_CREATION_KINDS.has(templateId) ? fallback : templateId;
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
    node_kind: kind === "trigger" ? "" : kind,
    role: safeText(props.role, kind === "trigger" ? "trigger" : "action"),
    icon: safeText(props.icon),
    mode: safeText(props.mode || props.splitter_mode),
    trigger_id: triggerId,
    trigger_type: safeText(props.trigger_type),
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
    node_id: match[1],
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
  const id = safeText(props.id || props.edge_id, `edge-${from.node_id}-${from.portId}-${to.node_id}-${to.portId}-${lineIndex}`);
  return {
    id,
    from: from.node_id,
    from_port: from.portId,
    to: to.node_id,
    to_port: to.portId,
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
    const isTrigger = Boolean(node.trigger_id) || node.kind === "trigger" || node.role === "trigger";
    const props = {
      id: node.id,
      ...(isTrigger ? {
        trigger_id: node.trigger_id,
        trigger_type: node.trigger_type || node.type || "manual",
      } : {
        kind: node.node_kind || node.kind || "action",
        role: node.role || "action",
      }),
      ...(node.icon ? { icon: node.icon } : {}),
      ...(node.mode ? { mode: node.mode } : {}),
      ...(node.hasPosition || Number.isFinite(node.x) ? { x: Math.round(Number(node.x) || 0) } : {}),
      ...(node.hasPosition || Number.isFinite(node.y) ? { y: Math.round(Number(node.y) || 0) } : {}),
      ...(node.props && typeof node.props === "object" ? Object.fromEntries(
        Object.entries(node.props).filter(([key]) => ![
          "id", "node_id", "nodeid", "kind", "node_kind", "nodekind", "role", "icon", "mode", "x", "y",
          "trigger_id", "triggerid", "trigger", "trigger_type", "triggertype", "type",
        ].includes(key)),
      ) : {}),
    };
    lines.push(`${isTrigger ? "trigger" : "node"} ${quoteDfBlueprint(node.label || node.id)} [${serializeDfBlueprintProps(props, isTrigger
      ? ["id", "trigger_id", "trigger_type", "icon", "x", "y"]
      : ["id", "kind", "role", "icon", "mode", "x", "y"])}]`);
  }
  if (next.nodes.length && next.edges.length) lines.push("");
  for (const edge of next.edges) {
    const fromPort = safeText(edge.from_port);
    const toPort = safeText(edge.to_port);
    if (!fromPort || !toPort) continue;
    const props = {
      id: edge.id,
      role: edge.role || "flow",
      ...(edge.label ? { label: edge.label } : {}),
      ...(edge.props && typeof edge.props === "object" ? Object.fromEntries(
        Object.entries(edge.props).filter(([key]) => ![
          "id", "edge_id", "edgeid", "role", "label", "name", "from_port", "fromport", "to_port", "toport",
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

export function validateDfBlueprintSource(source = "", options = {}) {
  return validateLoopspaceGraphAst(parseDfBlueprintSource(source), options);
}

export function validateDfBlueprintSourceForUpdate(source = "", previousSource = "") {
  return validateLoopspaceGraphAstForUpdate(
    parseDfBlueprintSource(source),
    parseDfBlueprintSource(previousSource),
  );
}

export function createDfBlueprintNodeFromTemplate(template, position = null) {
  const templateId = creatableDfBlueprintTemplateId(template?.id || template?.node_kind || "node", "node");
  const deviceId = safeText(template?.device_id);
  const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  if (templateId === "run_script") {
    const scriptId = safeText(template?.script_id || template?.script);
    const pathKey = safeText(template?.path_key);
    const scriptName = safeText(template?.script_name || template?.label, scriptId || pathKey || "Script");
    const deviceLabel = safeText(template?.device_label);
    const visualDefaults = loopspaceGraphVisualDefaultsForNode("run_script");
    return {
      id: `${templateId}-${sanitizeDfBlueprintId(scriptId || pathKey || "script", "script")}-${suffix}`,
      icon: safeText(template?.icon, "terminal"),
      label: safeText(template?.label, scriptName),
      mode: "",
      node_kind: "run_script",
      kind: "run_script",
      role: safeText(template?.role, "action"),
      trigger_id: "",
      hasPosition: Boolean(position),
      x: position ? Math.round(Number(position.x) || 0) : 0,
      y: position ? Math.round(Number(position.y) || 0) : 0,
      props: {
        device_id: deviceId,
        device_label: deviceLabel,
        h: safeText(template?.h || template?.height, String(visualDefaults.height || 132)),
        path_key: pathKey,
        script_id: scriptId || pathKey,
        script_name: scriptName,
        shell: safeText(template?.shell),
        w: safeText(template?.w || template?.width, String(visualDefaults.width || 360)),
      },
    };
  }
  if (templateId === "send_message") {
    const messageDeviceId = deviceId || safeText(template?.target_device_id);
    const deviceLabel = safeText(template?.device_label || template?.target_device_label);
    const visualDefaults = loopspaceGraphVisualDefaultsForNode("send_message");
    return {
      id: `${templateId}-${suffix}`,
      icon: safeText(template?.icon, "message"),
      label: safeText(template?.label, "Send message"),
      mode: "",
      node_kind: "send_message",
      kind: "send_message",
      role: safeText(template?.role, "action"),
      trigger_id: "",
      hasPosition: Boolean(position),
      x: position ? Math.round(Number(position.x) || 0) : 0,
      y: position ? Math.round(Number(position.y) || 0) : 0,
      props: {
        device_id: messageDeviceId,
        device_label: deviceLabel,
        display: "region",
        h: safeText(template?.h || template?.height, String(visualDefaults.height || 260)),
        model: safeText(template?.model),
        prompt: safeText(template?.prompt || template?.message || template?.body || template?.text || template?.instructions),
        reasoning_effort: safeText(template?.reasoning_effort || template?.effort),
        speed: safeText(template?.speed),
        target_agent_id: safeText(template?.target_agent_id || template?.agent_id, "codex"),
        target_device_id: messageDeviceId,
        target_device_label: deviceLabel,
        target_terminal_id: safeText(template?.target_terminal_id),
        target_terminal_name: safeText(template?.target_terminal_name),
        w: safeText(template?.w || template?.width, String(visualDefaults.width || 680)),
      },
    };
  }
  if (templateId === "notify_device") {
    const deviceLabel = safeText(template?.device_label || template?.target_device_label);
    const deliveryRaw = safeText(template?.delivery || template?.delivery_mode || template?.channel, "auto").toLowerCase();
    const visualDefaults = loopspaceGraphVisualDefaultsForNode("notify_device");
    return {
      id: `${templateId}-${suffix}`,
      icon: safeText(template?.icon, "bell"),
      label: safeText(template?.label, "Notify device"),
      mode: "",
      node_kind: "notify_device",
      kind: "notify_device",
      role: safeText(template?.role, "action"),
      trigger_id: "",
      hasPosition: Boolean(position),
      x: position ? Math.round(Number(position.x) || 0) : 0,
      y: position ? Math.round(Number(position.y) || 0) : 0,
      props: {
        body: safeText(template?.body || template?.message || template?.notification_body),
        delivery: deliveryRaw === "native" || deliveryRaw === "push" ? deliveryRaw : "auto",
        device_id: deviceId || safeText(template?.target_device_id),
        device_label: deviceLabel,
        h: safeText(template?.h || template?.height, String(visualDefaults.height || 148)),
        title: safeText(template?.title || template?.notification_title),
        url: safeText(template?.url || template?.link),
        w: safeText(template?.w || template?.width, String(visualDefaults.width || 380)),
      },
    };
  }
  if (templateId === "dispatch_todos") {
    const dispatchDeviceId = deviceId || safeText(template?.target_device_id);
    const deviceLabel = safeText(template?.device_label || template?.target_device_label);
    const visualDefaults = loopspaceGraphVisualDefaultsForNode("dispatch_todos");
    return {
      id: `${templateId}-${suffix}`,
      icon: safeText(template?.icon, "todos"),
      label: safeText(template?.label, "Dispatch todos"),
      mode: safeText(template?.mode || template?.dispatch_mode || template?.send_mode, "queued"),
      node_kind: "dispatch_todos",
      kind: "dispatch_todos",
      role: safeText(template?.role, "action"),
      trigger_id: "",
      hasPosition: Boolean(position),
      x: position ? Math.round(Number(position.x) || 0) : 0,
      y: position ? Math.round(Number(position.y) || 0) : 0,
      props: {
        device_id: dispatchDeviceId,
        device_label: deviceLabel,
        display: "region",
        dispatch_mode: safeText(template?.dispatch_mode || template?.send_mode || template?.mode, "queued"),
        enable_wait_ms: safeText(template?.enable_wait_ms, "30000"),
        h: safeText(template?.h || template?.height, String(visualDefaults.height || 178)),
        model: safeText(template?.model),
        reasoning_effort: safeText(template?.reasoning_effort || template?.effort),
        speed: safeText(template?.speed),
        target_agent_id: safeText(template?.target_agent_id || template?.agent_id, "codex"),
        target_device_id: dispatchDeviceId,
        target_device_label: deviceLabel,
        target_terminal_id: safeText(template?.target_terminal_id),
        target_terminal_index: safeText(template?.target_terminal_index),
        target_terminal_mode: safeText(template?.target_terminal_mode || template?.terminal_mode, "auto"),
        target_terminal_name: safeText(template?.target_terminal_name),
        target_thread_id: safeText(template?.target_thread_id),
        target_workspace_ids: safeText(template?.target_workspace_ids || template?.workspace_ids || template?.workspace_id),
        todo_batch_id: safeText(template?.todo_batch_id || template?.batch_id),
        todo_lines: safeText(template?.todo_lines || template?.todos || template?.items || template?.prompt || template?.text),
        w: safeText(template?.w || template?.width, String(visualDefaults.width || 420)),
      },
    };
  }
  if (templateId === "document_read" || templateId === "document_write") {
    const mode = templateId === "document_read" ? "read" : "write";
    const label = safeText(template?.label, mode === "read" ? "Document read" : "Document write");
    const visualDefaults = loopspaceGraphVisualDefaultsForNode(templateId);
    return {
      id: `${templateId}-${suffix}`,
      icon: safeText(template?.icon, "document"),
      label,
      mode,
      node_kind: templateId,
      kind: templateId,
      role: safeText(template?.role, "context"),
      trigger_id: "",
      hasPosition: Boolean(position),
      x: position ? Math.round(Number(position.x) || 0) : 0,
      y: position ? Math.round(Number(position.y) || 0) : 0,
      props: {
        create_name: safeText(template?.create_name || template?.name),
        doc_refs: safeText(template?.doc_refs || template?.documents || template?.path_key),
        h: safeText(template?.h || template?.height, String(visualDefaults.height || 128)),
        mode,
        operation: mode === "write"
          ? safeText(
            template?.operation || template?.write_operation || template?.document_operation,
            "append",
          )
          : "",
        content_template: mode === "write"
          ? safeText(template?.content_template || template?.template)
          : "",
        target_mode: safeText(template?.target_mode, mode === "write" ? "create_or_update" : "select"),
      },
    };
  }
  if (templateId === "asset_read" || templateId === "asset_write") {
    const mode = templateId === "asset_read" ? "read" : "write";
    const label = safeText(template?.label, mode === "read" ? "Asset read" : "Asset write");
    const visualDefaults = loopspaceGraphVisualDefaultsForNode(templateId);
    return {
      id: `${templateId}-${suffix}`,
      icon: safeText(template?.icon, "asset"),
      label,
      mode,
      node_kind: templateId,
      kind: templateId,
      role: safeText(template?.role, "context"),
      trigger_id: "",
      hasPosition: Boolean(position),
      x: position ? Math.round(Number(position.x) || 0) : 0,
      y: position ? Math.round(Number(position.y) || 0) : 0,
      props: {
        asset_refs: safeText(template?.asset_refs || template?.assets || template?.path_key || template?.asset_id),
        create_name: safeText(template?.create_name || template?.name),
        h: safeText(template?.h || template?.height, String(visualDefaults.height || 128)),
        mode,
        operation: mode === "write"
          ? safeText(
            template?.operation || template?.write_operation || template?.asset_operation,
            "add_version",
          )
          : "",
        content_template: mode === "write"
          ? safeText(template?.content_template || template?.template)
          : "",
        target_mode: safeText(template?.target_mode, mode === "write" ? "capture_generated" : "select"),
      },
    };
  }
  if (templateId === "checkpoint" || templateId === "message_step" || templateId === "step" || templateId === "substep" || templateId === "todo") {
    const label = safeText(template?.label || template?.title || template?.name, "Step");
    return {
      id: `${templateId}-${suffix}`,
      icon: safeText(template?.icon, "node"),
      label,
      mode: "",
      node_kind: "step",
      kind: "step",
      role: safeText(template?.role, "checkpoint"),
      trigger_id: "",
      hasPosition: Boolean(position),
      x: position ? Math.round(Number(position.x) || 0) : 0,
      y: position ? Math.round(Number(position.y) || 0) : 0,
      props: {
        description: safeText(template?.description || template?.desc || template?.details),
        order: safeText(template?.order || template?.index),
        parent_id: safeText(template?.parent_id || template?.parent),
        status: safeText(template?.status, "pending"),
      },
    };
  }
  return {
    id: `${templateId}-${suffix}`,
    icon: safeText(template?.icon, "node"),
    label: safeText(template?.label, "Graph node"),
    mode: "",
    node_kind: templateId,
    kind: templateId,
    role: safeText(template?.role, "action"),
    trigger_id: "",
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
    node_kind: "",
    role: "trigger",
    trigger_id: triggerId,
    trigger_type: type,
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
  const nodeIds = new Set(ast.nodes.filter((node) => node.trigger_id === id).map((node) => node.id));
  ast.nodes = ast.nodes.filter((node) => node.trigger_id !== id);
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
  const fromPort = safeText(options.from_port, "out");
  const toPort = safeText(options.to_port, "in");
  const nodeById = new Map(ast.nodes.map((node) => [node.id, node]));
  const fromGraphNode = nodeById.get(from)
    || (fromNode && typeof fromNode === "object" ? fromNode : null);
  const toGraphNode = nodeById.get(to)
    || (toNode && typeof toNode === "object" ? toNode : null);
  const validation = validateLoopspaceGraphEdgeCandidate(fromGraphNode, toGraphNode, {
    from,
    from_port: fromPort,
    nodeById,
    to,
    to_port: toPort,
  });
  if (!validation.ok) {
    return serializeDfBlueprint(ast);
  }
  const branch = safeText(options.branch || fromPort);
  const label = safeText(options.label, branch ? branch.toUpperCase() : "NEXT");
  if (ast.edges.some((edge) => (
    edge.from === from
    && edge.to === to
    && edge.from_port === fromPort
    && edge.to_port === toPort
  ))) {
    return serializeDfBlueprint(ast);
  }
  ast.edges.push({
    id: `edge-${from}-${fromPort}-${to}-${toPort}-${Date.now().toString(36)}`,
    from,
    from_port: fromPort,
    to,
    to_port: toPort,
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

function dfBlueprintResourcePropsFromPatchOperation(op = {}, node = null) {
  const nodeKind = sanitizeDfBlueprintId(node?.node_kind || node?.kind || "", "").replace(/-/g, "_");
  const props = {};
  const putFirst = (targetKey, aliases = []) => {
    for (const alias of aliases) {
      if (Object.prototype.hasOwnProperty.call(op, alias) && op[alias] !== undefined) {
        props[targetKey] = safeText(op[alias]);
        return;
      }
    }
  };
  putFirst("create_name", ["create_name"]);
  putFirst("h", ["h", "height"]);
  putFirst("mode", ["mode"]);
  putFirst("operation", ["operation", "write_operation", "document_operation", "asset_operation"]);
  putFirst("content_template", ["content_template", "template", "body_template"]);
  putFirst("target_mode", ["target_mode"]);
  if (nodeKind === "document_read" || nodeKind === "document_write") {
    putFirst("doc_refs", ["doc_refs", "documents", "path_key"]);
  }
  if (nodeKind === "asset_read" || nodeKind === "asset_write") {
    putFirst("asset_refs", ["asset_refs", "assets", "asset_id", "path_key"]);
  }
  if (nodeKind === "notify_device") {
    putFirst("body", ["body", "message", "notification_body"]);
    putFirst("delivery", ["delivery", "delivery_mode", "channel"]);
    putFirst("device_id", ["device_id", "target_device_id"]);
    putFirst("device_label", ["device_label", "target_device_label"]);
    putFirst("title", ["title", "notification_title"]);
    putFirst("url", ["url", "link"]);
  }
  if (nodeKind === "send_message") {
    putFirst("device_id", ["device_id", "target_device_id"]);
    putFirst("device_label", ["device_label", "target_device_label"]);
    putFirst("model", ["model", "model_id"]);
    putFirst("prompt", ["prompt", "message", "body", "text", "instructions"]);
    putFirst("reasoning_effort", ["reasoning_effort", "effort", "thinking_power"]);
    putFirst("speed", ["speed", "service_tier"]);
    putFirst("target_agent_id", ["target_agent_id", "agent_id", "agent"]);
    putFirst("target_device_id", ["target_device_id", "device_id"]);
    putFirst("target_device_label", ["target_device_label", "device_label"]);
    putFirst("target_terminal_id", ["target_terminal_id", "terminal_id", "pane_id"]);
    putFirst("target_terminal_name", ["target_terminal_name", "terminal_name"]);
  }
  if (nodeKind === "dispatch_todos") {
    putFirst("device_id", ["device_id", "target_device_id"]);
    putFirst("device_label", ["device_label", "target_device_label"]);
    putFirst("dispatch_mode", ["dispatch_mode", "send_mode", "mode"]);
    putFirst("enable_wait_ms", ["enable_wait_ms"]);
    putFirst("model", ["model", "model_id"]);
    putFirst("reasoning_effort", ["reasoning_effort", "effort", "thinking_power"]);
    putFirst("speed", ["speed", "service_tier"]);
    putFirst("target_agent_id", ["target_agent_id", "agent_id", "agent"]);
    putFirst("target_device_id", ["target_device_id", "device_id"]);
    putFirst("target_device_label", ["target_device_label", "device_label"]);
    putFirst("target_terminal_id", ["target_terminal_id", "terminal_id", "pane_id"]);
    putFirst("target_terminal_index", ["target_terminal_index", "terminal_index"]);
    putFirst("target_terminal_mode", ["target_terminal_mode", "terminal_mode"]);
    putFirst("target_terminal_name", ["target_terminal_name", "terminal_name"]);
    putFirst("target_thread_id", ["target_thread_id", "thread_id"]);
    putFirst("target_workspace_ids", ["target_workspace_ids", "workspace_ids", "workspace_id"]);
    putFirst("todo_batch_id", ["todo_batch_id", "batch_id"]);
    putFirst("todo_lines", ["todo_lines", "todos", "items", "prompt", "text"]);
  }
  return props;
}

export function applyDfBlueprintPatchOperations(source, operations = [], options = {}) {
  let ast = parseDfBlueprintSource(source);
  if (options.name && (!ast.name || ast.name === "Loopspace")) ast.name = options.name;
  for (const op of Array.isArray(operations) ? operations : []) {
    const action = safeText(op?.op || op?.type || op?.action).toLowerCase();
    if (action === "addnode" || action === "add_node") {
      const requestedKind = sanitizeDfBlueprintId(op?.kind || op?.node_kind || "action", "action").replace(/-/g, "_");
      if (DEPRECATED_DFBLUEPRINT_CREATION_KINDS.has(requestedKind)) {
        continue;
      }
      const node = createDfBlueprintNodeFromTemplate({
        id: requestedKind,
        label: op.label || op.name || "Graph node",
        role: op.role || "action",
        icon: op.icon || "",
        mode: op.mode || "",
        device_id: op.device_id,
        device_label: op.device_label,
        model: op.model || op.model_id,
        prompt: op.prompt || op.message || op.body || op.text || op.instructions,
        path_key: op.path_key,
        reasoning_effort: op.reasoning_effort || op.effort || op.thinking_power,
        script_id: op.script_id,
        script_name: op.script_name,
        shell: op.shell,
        speed: op.speed || op.service_tier,
        dispatch_mode: op.dispatch_mode || op.send_mode,
        enable_wait_ms: op.enable_wait_ms,
        target_agent_id: op.target_agent_id || op.agent_id,
        target_device_id: op.target_device_id,
        target_device_label: op.target_device_label,
        target_terminal_id: op.target_terminal_id || op.terminal_id || op.pane_id,
        target_terminal_index: op.target_terminal_index || op.terminal_index,
        target_terminal_mode: op.target_terminal_mode || op.terminal_mode,
        target_terminal_name: op.target_terminal_name || op.terminal_name,
        target_thread_id: op.target_thread_id || op.thread_id,
        target_workspace_ids: op.target_workspace_ids || op.workspace_ids || op.workspace_id,
        todo_batch_id: op.todo_batch_id || op.batch_id,
        todo_lines: op.todo_lines || op.todos || op.items || op.prompt || op.text,
        description: op.description || op.desc || op.details,
        asset_refs: op.asset_refs || op.assets,
        create_name: op.create_name,
        doc_refs: op.doc_refs || op.documents,
        h: op.h || op.height,
        operation: op.operation || op.write_operation || op.document_operation || op.asset_operation,
        content_template: op.content_template || op.template || op.body_template,
        order: op.order || op.index,
        parent_id: op.parent_id || op.parent,
        status: op.status,
        target_mode: op.target_mode,
        title: op.title || op.notification_title,
        body: op.body || op.message || op.notification_body,
        url: op.url || op.link,
        delivery: op.delivery || op.delivery_mode || op.channel,
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
      if (node.trigger_id && !ast.nodes.some((item) => item.id === node.id)) ast.nodes.push(node);
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
      const fromPort = safeText(op.from_port, "out");
      const toPort = safeText(op.to_port, "in");
      const branch = safeText(op.branch || fromPort);
      const nodeById = new Map(ast.nodes.map((node) => [node.id, node]));
      const validation = validateLoopspaceGraphEdgeCandidate(
        nodeById.get(from),
        nodeById.get(to),
        {
          from,
          from_port: fromPort,
          nodeById,
          to,
          to_port: toPort,
        },
      );
      if (!validation.ok) {
        const error = new Error(validation.error || "Invalid Loopspace graph connection.");
        error.code = "loopspace_graph_contract_invalid";
        throw error;
      }
      if (from && to && from !== to && fromPort && toPort && !ast.edges.some((edge) => (
        edge.from === from
        && edge.to === to
        && edge.from_port === fromPort
        && edge.to_port === toPort
      ))) {
        ast.edges.push({
          id: safeText(op.edge_id || op.id, `edge-${from}-${fromPort}-${to}-${toPort}-${Date.now().toString(36)}`),
          from,
          from_port: fromPort,
          to,
          to_port: toPort,
          label: safeText(op.label, branch ? branch.toUpperCase() : "NEXT"),
          role: safeText(op.role, "flow"),
          props: branch ? { branch } : {},
        });
      }
    } else if (action === "disconnect") {
      const edgeId = safeText(op.edge_id || op.id);
      const from = safeText(op.from || op.from_id);
      const to = safeText(op.to || op.to_id);
      const fromPort = safeText(op.from_port);
      const toPort = safeText(op.to_port);
      const branch = safeText(op.branch);
      ast.edges = ast.edges.filter((edge) => {
        if (edgeId) return edge.id !== edgeId;
        if (edge.from !== from || edge.to !== to) return true;
        if (fromPort && edge.from_port !== fromPort) return true;
        if (toPort && edge.to_port !== toPort) return true;
        if (branch && safeText(edge.props?.branch || edge.branch || edge.from_port) !== branch) return true;
        return false;
      });
    } else if (action === "updatenodeprops" || action === "update_node_props" || action === "updateprops") {
      const id = safeText(op.node_id || op.id);
      ast.nodes = ast.nodes.map((node) => {
        if (node.id !== id) return node;
        const props = {
          ...(op.props && typeof op.props === "object" ? op.props : {}),
          ...dfBlueprintResourcePropsFromPatchOperation(op, node),
        };
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

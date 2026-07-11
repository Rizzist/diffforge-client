const OUTPUT_PORTS_BY_ID = {
  assets: { id: "assets", label: "ASSETS", tone: "asset" },
  docs: { id: "docs", label: "DOCS", tone: "exec" },
  exec: { id: "exec", label: "EXECOUT", tone: "exec" },
  failure: { id: "failure", label: "FAILURE", tone: "failure" },
  interrupt: { id: "interrupt", label: "INTERRUPT", tone: "interrupt" },
  out: { id: "out", label: "OUT", tone: "default" },
  success: { id: "success", label: "SUCCESS", tone: "success" },
};

const INPUT_PORTS_BY_ID = {
  in: { id: "in", label: "IN", tone: "default" },
};

const EXECUTION_OUTPUT_PORTS = [
  OUTPUT_PORTS_BY_ID.exec,
  OUTPUT_PORTS_BY_ID.success,
  OUTPUT_PORTS_BY_ID.failure,
  OUTPUT_PORTS_BY_ID.interrupt,
];

const STEP_OUTPUT_PORTS = [
  OUTPUT_PORTS_BY_ID.success,
  OUTPUT_PORTS_BY_ID.docs,
  OUTPUT_PORTS_BY_ID.assets,
];

const EXECUTION_OUTPUT_PORT_IDS = new Set([
  "exec",
  "success",
  "failure",
  "interrupt",
  "out",
]);

export const LOOPSPACE_GRAPH_NODE_TEMPLATES = [
  {
    description: "Attach read-only document context to a runtime step.",
    icon: "document",
    id: "document_read",
    label: "Document read",
    role: "context",
  },
  {
    description: "Write runtime output into selected documents.",
    icon: "document",
    id: "document_write",
    label: "Document write",
    role: "context",
  },
  {
    description: "Attach existing assets as readable runtime context.",
    icon: "asset",
    id: "asset_read",
    label: "Asset read",
    role: "context",
  },
  {
    description: "Capture or create assets from runtime output.",
    icon: "asset",
    id: "asset_write",
    label: "Asset write",
    role: "context",
  },
  {
    description: "Run a selected local script on its device.",
    icon: "terminal",
    id: "run_script",
    label: "Run script",
    role: "action",
  },
  {
    description: "Queue numbered todos into selected workspace terminals.",
    icon: "todos",
    id: "dispatch_todos",
    label: "Dispatch todos",
    role: "action",
  },
  {
    description: "Send a prompt into a device terminal agent.",
    icon: "message",
    id: "send_message",
    label: "Send message",
    role: "action",
  },
  {
    description: "Send a push notification to a device (laptop or phone).",
    icon: "bell",
    id: "notify_device",
    label: "Notify device",
    role: "action",
  },
];

export const LOOPSPACE_GRAPH_NODE_CONTRACTS = {
  device: {
    inputs: [INPUT_PORTS_BY_ID.in],
    outputs: [OUTPUT_PORTS_BY_ID.out],
    role: "variable",
    visual: { height: 66, width: 220 },
  },
  document_read: {
    inputs: [],
    outputs: [OUTPUT_PORTS_BY_ID.docs],
    role: "context",
    visual: { height: 128, minHeight: 128, minWidth: 270, sized: true, width: 270 },
  },
  document_write: {
    inputs: [INPUT_PORTS_BY_ID.in],
    outputs: [OUTPUT_PORTS_BY_ID.docs],
    role: "context",
    visual: { height: 248, minHeight: 248, minWidth: 270, sized: true, width: 270 },
  },
  asset_read: {
    inputs: [],
    outputs: [OUTPUT_PORTS_BY_ID.assets],
    role: "context",
    visual: { height: 128, minHeight: 128, minWidth: 270, sized: true, width: 270 },
  },
  asset_write: {
    inputs: [INPUT_PORTS_BY_ID.in],
    outputs: [OUTPUT_PORTS_BY_ID.assets],
    role: "context",
    visual: { height: 128, minHeight: 128, minWidth: 270, sized: true, width: 270 },
  },
  loop: {
    inputs: [INPUT_PORTS_BY_ID.in],
    outputs: [OUTPUT_PORTS_BY_ID.out],
    role: "action",
    visual: { height: 66, width: 220 },
  },
  run_script: {
    inputs: [INPUT_PORTS_BY_ID.in],
    legacyOutputs: [OUTPUT_PORTS_BY_ID.out],
    outputs: EXECUTION_OUTPUT_PORTS,
    role: "action",
    visual: {
      height: 132,
      minHeight: 132,
      minWidth: 360,
      outputGutter: 112,
      sized: true,
      width: 360,
    },
  },
  dispatch_todos: {
    inputs: [INPUT_PORTS_BY_ID.in],
    legacyOutputs: [OUTPUT_PORTS_BY_ID.out],
    outputs: EXECUTION_OUTPUT_PORTS,
    role: "action",
    visual: {
      height: 260,
      minHeight: 220,
      minWidth: 560,
      outputGutter: 92,
      region: true,
      sized: true,
      width: 680,
    },
  },
  send_message: {
    inputs: [INPUT_PORTS_BY_ID.in],
    legacyOutputs: [OUTPUT_PORTS_BY_ID.out],
    outputs: EXECUTION_OUTPUT_PORTS,
    role: "action",
    visual: {
      height: 260,
      minHeight: 220,
      minWidth: 560,
      outputGutter: 92,
      region: true,
      sized: true,
      width: 680,
    },
  },
  notify_device: {
    inputs: [INPUT_PORTS_BY_ID.in],
    outputs: EXECUTION_OUTPUT_PORTS,
    role: "action",
    visual: {
      height: 148,
      minHeight: 148,
      minWidth: 380,
      outputGutter: 104,
      sized: true,
      width: 380,
    },
  },
  step: {
    inputs: [INPUT_PORTS_BY_ID.in],
    internal: true,
    outputs: STEP_OUTPUT_PORTS,
    role: "checkpoint",
    visual: { height: 30, width: 160 },
  },
  trigger: {
    inputs: [],
    outputs: [OUTPUT_PORTS_BY_ID.out],
    role: "trigger",
    visual: { height: 66, width: 220 },
  },
};

const MESSAGE_STEP_NODE_KINDS = new Set(["checkpoint", "message_step", "step", "substep", "todo"]);

function cleanKind(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[.\s-]+/g, "_");
}

function nodeKindFromValue(value) {
  if (value && typeof value === "object") {
    if (value.trigger_id || value.kind === "trigger" || value.role === "trigger") {
      return "trigger";
    }
    return cleanKind(value.node_kind || value.kind || value.role || "loop");
  }
  return cleanKind(value || "loop");
}

function graphContractNodeParentId(value) {
  if (!value || typeof value !== "object") return "";
  return String(
    value?.props?.parent_id || value?.props?.parent || value?.parent_id || value?.parent || "",
  ).trim();
}

function graphContractNodeFromLookup(lookup, id) {
  const safeId = String(id || "").trim();
  if (!safeId || !lookup) return null;
  if (lookup instanceof Map) return lookup.get(safeId) || null;
  if (typeof lookup === "object" && !Array.isArray(lookup)) return lookup[safeId] || null;
  return null;
}

function graphContractIsInternalActionSubstep(node, nodeLookup = null) {
  if (normalizeLoopspaceGraphNodeKind(node) !== "step") return false;
  const parentId = graphContractNodeParentId(node);
  if (!parentId || parentId === String(node?.id || "").trim()) return false;
  const parentNode = graphContractNodeFromLookup(nodeLookup, parentId);
  if (!parentNode) return false;
  const parentKind = normalizeLoopspaceGraphNodeKind(parentNode);
  return parentKind === "send_message" || parentKind === "dispatch_todos";
}

export function normalizeLoopspaceGraphNodeKind(value) {
  const kind = nodeKindFromValue(value);
  if (MESSAGE_STEP_NODE_KINDS.has(kind)) return "step";
  return Object.prototype.hasOwnProperty.call(LOOPSPACE_GRAPH_NODE_CONTRACTS, kind)
    ? kind
    : "loop";
}

export function loopspaceGraphNodeContract(value) {
  return LOOPSPACE_GRAPH_NODE_CONTRACTS[normalizeLoopspaceGraphNodeKind(value)]
    || LOOPSPACE_GRAPH_NODE_CONTRACTS.loop;
}

export function loopspaceGraphInputPortsForNode(value) {
  return [...(loopspaceGraphNodeContract(value).inputs || [])];
}

export function loopspaceGraphOutputPortsForNode(value) {
  return [...(loopspaceGraphNodeContract(value).outputs || [])];
}

export function loopspaceGraphOutputPortForId(value, portId = "", options = {}) {
  const safePortId = String(portId || "").trim().toLowerCase();
  const ports = loopspaceGraphOutputPortsForNode(value);
  const found = ports.find((port) => port.id === safePortId) || null;
  if (found || options.fallback === false) return found;
  return ports[0] || OUTPUT_PORTS_BY_ID.out;
}

export function loopspaceGraphPortLabel(portId = "") {
  const safePortId = String(portId || "").trim().toLowerCase();
  const port = OUTPUT_PORTS_BY_ID[safePortId] || INPUT_PORTS_BY_ID[safePortId];
  return port?.label || (safePortId ? safePortId.toUpperCase() : "OUT");
}

export function loopspaceGraphPropValue(props, keys = []) {
  if (!props || typeof props !== "object" || Array.isArray(props)) {
    return undefined;
  }
  const propKeys = Array.isArray(keys) ? keys : [keys];
  for (const key of propKeys) {
    if (Object.prototype.hasOwnProperty.call(props, key) && props[key] !== "") {
      return props[key];
    }
  }
  return undefined;
}

export function loopspaceGraphVisualDefaultsForNode(value) {
  return { ...(loopspaceGraphNodeContract(value).visual || {}) };
}

export function loopspaceGraphNodeHasInputPort(value, portId = "") {
  const safePortId = String(portId || "").trim().toLowerCase();
  return loopspaceGraphInputPortsForNode(value).some((port) => port.id === safePortId);
}

export function loopspaceGraphNodeHasOutputPort(value, portId = "", options = {}) {
  const safePortId = String(portId || "").trim().toLowerCase();
  const contract = loopspaceGraphNodeContract(value);
  if ((contract.outputs || []).some((port) => port.id === safePortId)) return true;
  return Boolean(options.allowLegacy)
    && (contract.legacyOutputs || []).some((port) => port.id === safePortId);
}

export function validateLoopspaceGraphEdgeCandidate(fromNode, toNode, options = {}) {
  const fromId = String(fromNode?.id || options.from || "").trim();
  const toId = String(toNode?.id || options.to || "").trim();
  const fromPort = String(options.from_port || "").trim().toLowerCase();
  const toPort = String(options.to_port || "in").trim().toLowerCase();
  if (!fromId || !toId) {
    return { error: "Graph edge requires both a source and target node.", ok: false };
  }
  if (fromId === toId) {
    return { error: "A graph node cannot connect to itself.", ok: false };
  }
  if (!fromNode) {
    return { error: `Source node "${fromId}" does not exist.`, ok: false };
  }
  if (!toNode) {
    return { error: `Target node "${toId}" does not exist.`, ok: false };
  }
  const fromContract = loopspaceGraphNodeContract(fromNode);
  const toContract = loopspaceGraphNodeContract(toNode);
  const fromKind = normalizeLoopspaceGraphNodeKind(fromNode);
  const toKind = normalizeLoopspaceGraphNodeKind(toNode);
  const nodeLookup = options.nodeById || options.nodeLookup || options.nodes || null;
  const isSendMessageSubstepSuccessEdge = (
    fromKind === "step"
      && (toKind === "run_script" || toKind === "send_message" || toKind === "dispatch_todos" || toKind === "notify_device")
      && fromPort === "success"
      && toPort === "in"
      && graphContractIsInternalActionSubstep(fromNode, nodeLookup)
  );
  const isResourceStepContextEdge = (
    fromKind === "document_read"
      && toKind === "step"
      && fromPort === "docs"
      && toPort === "in"
      && graphContractIsInternalActionSubstep(toNode, nodeLookup)
  ) || (
    fromKind === "step"
      && toKind === "document_write"
      && fromPort === "docs"
      && toPort === "in"
      && graphContractIsInternalActionSubstep(fromNode, nodeLookup)
  ) || (
    fromKind === "step"
      && toKind === "asset_write"
      && fromPort === "assets"
      && toPort === "in"
      && graphContractIsInternalActionSubstep(fromNode, nodeLookup)
  ) || (
    fromKind === "document_write"
      && toKind === "step"
      && fromPort === "docs"
      && toPort === "in"
      && graphContractIsInternalActionSubstep(toNode, nodeLookup)
  ) || (
    fromKind === "asset_read"
      && toKind === "step"
      && fromPort === "assets"
      && toPort === "in"
      && graphContractIsInternalActionSubstep(toNode, nodeLookup)
  ) || (
    fromKind === "asset_write"
      && toKind === "step"
      && fromPort === "assets"
      && toPort === "in"
      && graphContractIsInternalActionSubstep(toNode, nodeLookup)
  );
  if ((fromContract.internal || toContract.internal) && !isResourceStepContextEdge && !isSendMessageSubstepSuccessEdge) {
    return { error: "Internal action steps cannot be connected as standalone graph nodes.", ok: false };
  }
  if (
    (toKind === "document_write" || toKind === "asset_write")
      && (fromKind === "run_script" || fromKind === "send_message" || fromKind === "dispatch_todos" || fromKind === "notify_device")
      && EXECUTION_OUTPUT_PORT_IDS.has(fromPort)
  ) {
    const resourceLabel = toKind === "document_write" ? "Document" : "Asset";
    const resourcePort = toKind === "document_write" ? "document" : "asset";
    return {
      error: `${resourceLabel} write nodes must be connected from an internal action step ${resourcePort} output, not an action execution branch.`,
      ok: false,
    };
  }
  if (!loopspaceGraphNodeHasOutputPort(fromNode, fromPort, { allowLegacy: options.allowLegacy })) {
    return {
      error: `${fromNode.label || fromId} does not have a "${fromPort || "blank"}" output port.`,
      ok: false,
    };
  }
  if (!loopspaceGraphNodeHasInputPort(toNode, toPort)) {
    return {
      error: `${toNode.label || toId} does not have a "${toPort || "blank"}" input port.`,
      ok: false,
    };
  }
  return { from_port: fromPort, ok: true, to_port: toPort };
}

function graphContractEdgeBranch(edge = {}) {
  return String(edge?.props?.branch || edge?.branch || edge?.from_port || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function sortedPlainObject(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function loopspaceGraphLegacyActionOutEdgeKey(edge = {}) {
  return JSON.stringify({
    branch: graphContractEdgeBranch(edge),
    from: String(edge?.from || "").trim(),
    from_port: String(edge?.from_port || "").trim().toLowerCase(),
    id: String(edge?.id || "").trim(),
    label: String(edge?.label || "").trim(),
    props: sortedPlainObject(edge?.props),
    role: String(edge?.role || "").trim(),
    to: String(edge?.to || "").trim(),
    to_port: String(edge?.to_port || "").trim().toLowerCase(),
  });
}

function loopspaceGraphLegacyActionOutEdgeCounts(ast = {}) {
  const nodes = Array.isArray(ast.nodes) ? ast.nodes : [];
  const edges = Array.isArray(ast.edges) ? ast.edges : [];
  const nodeById = new Map(nodes.map((node) => [String(node?.id || "").trim(), node]));
  const counts = new Map();
  for (const edge of edges) {
    const fromNode = nodeById.get(String(edge?.from || "").trim());
    const fromKind = normalizeLoopspaceGraphNodeKind(fromNode);
    const fromPort = String(edge?.from_port || "").trim().toLowerCase();
    if ((fromKind === "run_script" || fromKind === "send_message" || fromKind === "dispatch_todos") && fromPort === "out") {
      const key = loopspaceGraphLegacyActionOutEdgeKey(edge);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

export function validateLoopspaceGraphAst(ast = {}, options = {}) {
  const errors = [];
  const nodes = Array.isArray(ast.nodes) ? ast.nodes : [];
  const edges = Array.isArray(ast.edges) ? ast.edges : [];
  const nodeById = new Map();
  const allowedLegacyActionOutEdgeCounts = options.allowedLegacyActionOutEdgeCounts instanceof Map
    ? new Map(options.allowedLegacyActionOutEdgeCounts)
    : null;
  for (const node of nodes) {
    const id = String(node?.id || "").trim();
    if (!id) {
      errors.push("Every graph node must have an id.");
      continue;
    }
    if (nodeById.has(id)) {
      errors.push(`Duplicate graph node id "${id}".`);
      continue;
    }
    nodeById.set(id, node);
  }
  for (const edge of edges) {
    const from = String(edge?.from || "").trim();
    const to = String(edge?.to || "").trim();
    let validation = validateLoopspaceGraphEdgeCandidate(nodeById.get(from), nodeById.get(to), {
      from,
      from_port: edge?.from_port,
      nodeById,
      to,
      to_port: edge?.to_port,
    });
    if (!validation.ok && allowedLegacyActionOutEdgeCounts) {
      const legacyKey = loopspaceGraphLegacyActionOutEdgeKey(edge);
      const legacyCount = allowedLegacyActionOutEdgeCounts.get(legacyKey) || 0;
      if (legacyCount > 0) {
        const legacyValidation = validateLoopspaceGraphEdgeCandidate(nodeById.get(from), nodeById.get(to), {
          allowLegacy: true,
          from,
          from_port: edge?.from_port,
          nodeById,
          to,
          to_port: edge?.to_port,
        });
        if (legacyValidation.ok) {
          allowedLegacyActionOutEdgeCounts.set(legacyKey, legacyCount - 1);
          validation = legacyValidation;
        }
      }
    } else if (!validation.ok && options.allowLegacy) {
      validation = validateLoopspaceGraphEdgeCandidate(nodeById.get(from), nodeById.get(to), {
        allowLegacy: true,
        from,
        from_port: edge?.from_port,
        nodeById,
        to,
        to_port: edge?.to_port,
      });
    }
    if (!validation.ok) {
      errors.push(`Invalid edge ${edge?.id || `${from}->${to}`}: ${validation.error}`);
    }
  }
  return {
    errors,
    ok: errors.length === 0,
  };
}

export function validateLoopspaceGraphAstForUpdate(ast = {}, previousAst = {}) {
  return validateLoopspaceGraphAst(ast, {
    allowedLegacyActionOutEdgeCounts: loopspaceGraphLegacyActionOutEdgeCounts(previousAst),
  });
}

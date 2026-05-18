import {
  createWorkspaceDisplayIdentity,
  getWorkspacePathDisplayLabel,
  workspaceRelativePath,
} from "../workspace/workspaceDisplayIdentity.js";
import { field, text } from "./specGraphCore.js";

function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function jsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function knowledgeFreshness(value) {
  switch (text(value).toLowerCase()) {
    case "stale":
    case "maybe_stale":
      return "behind_code";
    case "missing_path":
    case "missing":
      return "out_of_spec";
    case "fresh":
    case "updated":
    default:
      return "updated";
  }
}

function displayTitle(title, notePath, nodeType, displayIdentity) {
  if (nodeType === "knowledge_root") {
    return displayIdentity?.repoName
      ? `${displayIdentity.repoName} atlas`
      : getWorkspacePathDisplayLabel(title, { fallback: "Knowledge atlas", includeChildPath: false });
  }
  return title || notePath || "Knowledge note";
}

function normalizeKnowledgeNode(raw, index, displayIdentity) {
  const metadata = jsonObject(field(raw, "metadata", "metadata_json", "metadataJson"));
  const id = text(field(raw, "id", "node_id", "nodeId"), `knowledge-${index}`);
  const notePath = text(field(raw, "note_path", "notePath", "markdown_path", "markdownPath", "path"));
  const knowledgeType = text(field(raw, "node_type", "nodeType", "type"), "knowledge_note");
  const title = text(field(raw, "title"), notePath || "Knowledge note");
  const summary = text(field(raw, "summary", "description", "purpose"), "Markdown knowledge note.");
  const rawState = text(field(raw, "knowledge_state", "knowledgeState", "freshness_state", "freshnessState"), "fresh");
  const pathRefs = jsonArray(field(raw, "path_refs", "pathRefs"));
  const outboundLinks = jsonArray(field(raw, "outbound_links", "outboundLinks"));
  const nodeType = knowledgeType === "knowledge_root" ? "workspace" : "concept";
  const freshnessState = knowledgeFreshness(rawState);
  const displayPath = notePath || workspaceRelativePath(notePath, displayIdentity) || "";

  return {
    ...raw,
    id,
    title,
    display_title: displayTitle(title, notePath, knowledgeType, displayIdentity),
    displayTitle: displayTitle(title, notePath, knowledgeType, displayIdentity),
    display_path: displayPath,
    displayPath,
    node_type: nodeType,
    knowledge_node_type: knowledgeType,
    note_path: notePath,
    path: notePath,
    summary,
    purpose: summary,
    markdown: text(field(raw, "markdown", "body", "content"), summary),
    markdown_path: notePath,
    path_refs: pathRefs,
    path_ref_count: Number(field(raw, "path_ref_count", "pathRefCount")) || pathRefs.length,
    missing_path_count: Number(field(raw, "missing_path_count", "missingPathCount")) || 0,
    outbound_links: outboundLinks,
    freshness_state: freshnessState,
    knowledge_state: rawState,
    spec_state: freshnessState,
    has_active_specs: true,
    active_specs: [{ id: `${id}-knowledge`, status: "active", statement: summary }],
    active_agent_count: 0,
    active_agents: [],
    metadata,
  };
}

export function normalizeKnowledgeSnapshot(snapshot, options = {}) {
  const displayIdentity = options.workspaceDisplayIdentity || createWorkspaceDisplayIdentity(
    options.repoPath || snapshot?.repoPath || snapshot?.repo_path || "",
    options.fallbackWorkspaceName || snapshot?.workspaceName || snapshot?.workspace_name || "Workspace",
  );
  const matrix = snapshot?.knowledgeGraph || snapshot?.raw || {};
  const sourceNodes = Array.isArray(snapshot?.knowledgeNodes)
    ? snapshot.knowledgeNodes
    : Array.isArray(matrix?.nodes)
      ? matrix.nodes
      : [];
  const nodes = sourceNodes.map((node, index) => normalizeKnowledgeNode(node, index, displayIdentity));
  const sourceEdges = Array.isArray(snapshot?.knowledgeEdges)
    ? snapshot.knowledgeEdges
    : Array.isArray(matrix?.edges)
      ? matrix.edges
      : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = sourceEdges
    .map((edge, index) => ({
      id: text(field(edge, "id"), `knowledge-edge-${index}`),
      from: text(field(edge, "from_node_id", "fromNoteId", "from_note_id", "from", "source")),
      to: text(field(edge, "to_node_id", "toNoteId", "to_note_id", "to", "target")),
      kind: text(field(edge, "edge_kind", "edgeKind", "kind"), "links_to"),
      metadata: jsonObject(field(edge, "metadata", "metadata_json", "metadataJson")),
    }))
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  return {
    matrix,
    nodes,
    edges,
    graphStats: snapshot?.graphStats || matrix?.graph_stats || matrix?.graphStats || {},
    workspaceDisplayIdentity: displayIdentity,
  };
}

export function knowledgeNodeTypeLabel(node) {
  switch (node?.knowledge_node_type) {
    case "knowledge_root":
      return "root";
    case "knowledge_area":
      return "area";
    case "knowledge_system":
      return "system";
    case "knowledge_flow":
      return "flow";
    case "knowledge_data":
      return "data";
    default:
      return "note";
  }
}

export function relatedKnowledgeNodes(graph, nodeId) {
  const nodesById = new Map((graph?.nodes || []).map((node) => [node.id, node]));
  const outbound = [];
  const backlinks = [];
  for (const edge of graph?.edges || []) {
    if (edge.from === nodeId && nodesById.has(edge.to)) {
      outbound.push({ edge, node: nodesById.get(edge.to) });
    }
    if (edge.to === nodeId && nodesById.has(edge.from)) {
      backlinks.push({ edge, node: nodesById.get(edge.from) });
    }
  }
  return { outbound, backlinks };
}

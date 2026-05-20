import {
  createWorkspaceDisplayIdentity,
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
    case "no_spec":
    case "empty":
      return "no_spec";
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
  if (nodeType === "repo_root") {
    return notePath || title || "index.md";
  }
  return title || notePath || "Knowledge note";
}

function knowledgeNodeSortKey(node) {
  const rootRank = node?.knowledge_node_type === "repo_root" ? "0" : "1";
  return [
    rootRank,
    text(node?.note_path || node?.path || node?.markdown_path).toLowerCase(),
    text(node?.display_title || node?.displayTitle || node?.title).toLowerCase(),
    text(node?.id).toLowerCase(),
  ].join("|");
}

function compareKnowledgeNodes(left, right) {
  return knowledgeNodeSortKey(left).localeCompare(knowledgeNodeSortKey(right));
}

function knowledgeEdgeSortKey(edge) {
  const kindRank = edge?.kind === "contains" || edge?.metadata?.containment === true ? "0" : "1";
  return [
    kindRank,
    text(edge?.from).toLowerCase(),
    text(edge?.kind).toLowerCase(),
    text(edge?.to).toLowerCase(),
    text(edge?.id).toLowerCase(),
  ].join("|");
}

function compareKnowledgeEdges(left, right) {
  return knowledgeEdgeSortKey(left).localeCompare(knowledgeEdgeSortKey(right));
}

function dedupeKnowledgeEdges(edges) {
  const byKey = new Map();
  for (const edge of edges || []) {
    const key = [
      text(edge?.from),
      text(edge?.to),
      text(edge?.kind),
      edge?.metadata?.containment === true ? "containment" : "",
    ].join("|");
    if (!byKey.has(key)) byKey.set(key, edge);
  }
  return [...byKey.values()];
}

function isKnowledgeRootNode(node) {
  return node?.knowledge_node_type === "repo_root";
}

function markdownText(value) {
  if (value === undefined || value === null) return "";
  return String(value)
    .replace(/\r\n?/g, "\n")
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, " ")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .trim();
}

function normalizeKnowledgeNode(raw, index, displayIdentity) {
  const metadata = jsonObject(field(raw, "metadata", "metadata_json", "metadataJson"));
  const id = text(field(raw, "id", "node_id", "nodeId"), `knowledge-${index}`);
  const notePath = text(field(raw, "note_path", "notePath", "markdown_path", "markdownPath", "path"));
  const knowledgeType = text(field(raw, "node_type", "nodeType", "type"), "concept");
  const title = text(field(raw, "title"), notePath || "Knowledge note");
  const rawMarkdown = markdownText(field(raw, "markdown", "body", "content"));
  const isRoot = knowledgeType === "repo_root";
  const blankRoot = isRoot && !rawMarkdown;
  const summary = text(field(raw, "summary", "description", "purpose", "standard_capsule", "standardCapsule"), blankRoot ? "" : "Markdown knowledge note.");
  const rawState = text(
    field(raw, "knowledge_state", "knowledgeState", "freshness_state", "freshnessState"),
    blankRoot ? "no_spec" : "fresh",
  );
  const pathRefs = jsonArray(field(raw, "path_refs", "pathRefs"));
  const outboundLinks = jsonArray(field(raw, "outbound_links", "outboundLinks"));
  const nodeType = isRoot ? "workspace" : "concept";
  const freshnessState = knowledgeFreshness(rawState);
  const displayPath = notePath || workspaceRelativePath(notePath, displayIdentity) || "";
  const fallbackMarkdown = markdownText(field(raw, "standard_capsule", "standardCapsule"));
  const markdown = blankRoot
    ? rawMarkdown
    : rawMarkdown || fallbackMarkdown || summary;

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
    markdown,
    markdown_path: notePath,
    path_refs: pathRefs,
    path_ref_count: Number(field(raw, "path_ref_count", "pathRefCount")) || pathRefs.length,
    missing_path_count: Number(field(raw, "missing_path_count", "missingPathCount")) || 0,
    outbound_links: outboundLinks,
    freshness_state: freshnessState,
    knowledge_state: rawState,
    spec_state: freshnessState,
    has_active_specs: !blankRoot,
    active_specs: blankRoot ? [] : [{ id: `${id}-knowledge`, status: "active", statement: summary }],
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
  const normalizedNodes = sourceNodes
    .map((node, index) => normalizeKnowledgeNode(node, index, displayIdentity))
    .sort(compareKnowledgeNodes);
  let nodes = normalizedNodes;
  const sourceEdges = Array.isArray(snapshot?.knowledgeEdges)
    ? snapshot.knowledgeEdges
    : Array.isArray(matrix?.edges)
      ? matrix.edges
      : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  let edges = sourceEdges
    .map((edge) => {
      const from = text(field(edge, "from_node_id", "fromNoteId", "from_note_id", "from", "source"));
      const to = text(field(edge, "to_node_id", "toNoteId", "to_note_id", "to", "target"));
      const kind = text(field(edge, "edge_kind", "edgeKind", "kind"), "links_to");
      return {
        id: text(field(edge, "id"), `knowledge-edge-${from}-${kind}-${to}`),
        from,
        to,
        kind,
        metadata: jsonObject(field(edge, "metadata", "metadata_json", "metadataJson")),
      };
    })
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to) && edge.from !== edge.to);
  const activeNodeIds = new Set(nodes.map((node) => node.id));
  edges = edges.filter((edge) => activeNodeIds.has(edge.from) && activeNodeIds.has(edge.to));
  const currentRootNode = nodes.find(isKnowledgeRootNode);
  if (currentRootNode) {
    const containmentTargets = new Set(
      edges
        .filter((edge) => edge.kind === "contains" || edge.metadata?.containment === true)
        .map((edge) => edge.to),
    );
    nodes
      .filter((node) => node.id !== currentRootNode.id && !containmentTargets.has(node.id))
      .forEach((node) => {
        edges.unshift({
          id: `knowledge-root-edge-${currentRootNode.id}-${node.id}`,
          from: currentRootNode.id,
          to: node.id,
          kind: "contains",
          metadata: {
            source: "knowledge_graph_root",
            containment: true,
          },
        });
      });
  }
  edges = dedupeKnowledgeEdges(edges).sort(compareKnowledgeEdges);

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
    case "repo_root":
      return "root";
    default:
      return "concept";
  }
}

export function relatedKnowledgeNodes(graph, nodeId) {
  const nodesById = new Map((graph?.nodes || []).map((node) => [node.id, node]));
  const outboundById = new Map();
  const backlinksById = new Map();
  for (const edge of graph?.edges || []) {
    if (edge.from === nodeId && nodesById.has(edge.to)) {
      if (!outboundById.has(edge.to)) outboundById.set(edge.to, { edge, node: nodesById.get(edge.to) });
    }
    if (edge.to === nodeId && nodesById.has(edge.from)) {
      if (!backlinksById.has(edge.from)) backlinksById.set(edge.from, { edge, node: nodesById.get(edge.from) });
    }
  }
  const compareRelated = (left, right) => compareKnowledgeNodes(left.node, right.node);
  const outbound = [...outboundById.values()].sort(compareRelated);
  const backlinks = [...backlinksById.values()].sort(compareRelated);
  return { outbound, backlinks };
}

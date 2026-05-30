import {
  createWorkspaceDisplayIdentity,
  getWorkspacePathDisplayLabel,
  isWorkspacePathLike,
  normalizeWorkspacePathSeparators,
  workspacePathLeaf,
  workspaceRelativePath,
} from "../workspace/workspaceDisplayIdentity.js";

export const NODE_DIMENSIONS = {
  workspace: { width: 176, height: 176 },
  folder: { width: 92, height: 54 },
  file: { width: 142, height: 82 },
  abstract: { width: 158, height: 96 },
};

function cleanText(value) {
  return String(value || "")
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, " ")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, " ")
    .replace(/\x1BO./g, " ")
    .replace(/\x1B[@-Z\\-_]/g, " ")
    .replace(/\[(?:\??\d[\d;?]*|[OI])[@-~]?/g, " ")
    .replace(/\]\d+;rgb:[^\s\\]*(?:\\)?/gi, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .trim();
}

export function text(value, fallback = "") {
  const cleaned = cleanText(value);
  return cleaned || fallback;
}

export function field(item, ...keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function booleanField(item, ...keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
    }
  }
  return false;
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

function metadata(item) {
  return jsonObject(field(item, "metadata", "metadata_json", "metadataJson"));
}

function metadataText(item, meta, ...keys) {
  return text(field(item, ...keys) || field(meta, ...keys));
}

function normalizeProjectMount(rawMount) {
  const mount = rawMount && typeof rawMount === "object" && !Array.isArray(rawMount)
    ? rawMount
    : {};
  const mountId = text(field(mount, "mountId", "mount_id"));
  const workspaceRelativePath = text(field(mount, "workspaceRelativePath", "workspace_relative_path"));
  const projectRoot = text(field(mount, "projectRoot", "project_root"));
  const projectName = text(field(mount, "projectName", "project_name"));
  const projectKind = text(field(mount, "projectKind", "project_kind"));
  const mountKind = text(field(mount, "mountKind", "mount_kind"), projectKind === "container" ? "container" : "project");
  const parentMountId = text(field(mount, "parentMountId", "parent_mount_id"));
  return {
    ...mount,
    mountId,
    mount_id: mountId,
    mountKind,
    mount_kind: mountKind,
    parentMountId,
    parent_mount_id: parentMountId,
    workspaceRelativePath,
    workspace_relative_path: workspaceRelativePath,
    projectRoot,
    project_root: projectRoot,
    projectName,
    project_name: projectName,
    projectKind,
    project_kind: projectKind,
    hasGit: booleanField(mount, "hasGit", "has_git"),
    hasAgents: booleanField(mount, "hasAgents", "has_agents"),
    hasSpecGraphCache: booleanField(mount, "hasSpecGraphCache", "has_spec_graph_cache"),
  };
}

export function nodeProjectContext(node = {}) {
  const meta = node?.metadata || {};
  const mountId = metadataText(node, meta, "mountId", "mount_id");
  const projectRoot = metadataText(node, meta, "projectRoot", "project_root");
  const workspaceRoot = metadataText(node, meta, "workspaceRoot", "workspace_root");
  const projectRelativePath = metadataText(node, meta, "projectRelativePath", "project_relative_path");
  const visiblePath = metadataText(node, meta, "visiblePath", "visible_path");
  const sourceRepoId = metadataText(node, meta, "sourceRepoId", "source_repo_id", "repoId", "repo_id");
  const sourceGraphCursor = metadataText(node, meta, "sourceGraphCursor", "source_graph_cursor");
  const sourceNodeId = metadataText(node, meta, "sourceNodeId", "source_node_id");
  const sourceNodeHash = metadataText(node, meta, "sourceNodeHash", "source_node_hash");
  const containerNodeId = metadataText(node, meta, "containerNodeId", "container_node_id") || text(node?.id);
  return {
    containerNodeId,
    mountId,
    projectRelativePath,
    projectRoot,
    sourceGraphCursor,
    sourceNodeHash,
    sourceNodeId,
    sourceRepoId,
    visiblePath,
    workspaceRoot,
  };
}

function displayTitleForNode(title, path, nodeType, displayIdentity) {
  if (isWorkspaceNodeType(nodeType)) {
    return displayIdentity?.repoName
      ? displayIdentity.displayRoot
      : getWorkspacePathDisplayLabel(title, { fallback: "Workspace", includeChildPath: false });
  }

  const normalizedTitle = normalizeWorkspacePathSeparators(title);
  const absoluteTitle = /^(?:[A-Za-z]:\/|\/|\/\/|~\/)/.test(normalizedTitle)
    || normalizedTitle.includes("/.agents/");

  if ((isFileNodeType(nodeType) || isFolderNodeType(nodeType)) && isWorkspacePathLike(title)) {
    return workspacePathLeaf(title) || title;
  }

  if (absoluteTitle) {
    return getWorkspacePathDisplayLabel(title, {
      identity: displayIdentity,
      includeChildPath: true,
    });
  }

  if (!title && path) {
    return workspacePathLeaf(path) || path;
  }

  return title;
}

function displayPathForNode(path, title, nodeType, displayIdentity) {
  const source = text(path) || (isWorkspacePathLike(title) ? title : "");
  if (!source || isWorkspaceNodeType(nodeType)) return "";

  const relative = workspaceRelativePath(source, displayIdentity);
  if (relative !== null) return relative;

  const normalized = normalizeWorkspacePathSeparators(source).replace(/^\.\/+/, "");
  if (/^(?:[A-Za-z]:\/|\/|\/\/|~\/)/.test(normalized)) {
    return workspacePathLeaf(normalized) || getWorkspacePathDisplayLabel(normalized, {
      fallback: "",
      includeChildPath: false,
    });
  }

  return normalized;
}

export function isFileNodeType(nodeType) {
  return nodeType === "file" || nodeType === "implementation_unit";
}

function isFolderNodeType(nodeType) {
  return nodeType === "folder";
}

export function isWorkspaceNodeType(nodeType) {
  return ["workspace", "repository", "repo_root", "root"].includes(nodeType);
}

export function nodeKind(node) {
  if (isWorkspaceNodeType(node?.node_type)) return "workspace";
  if (isFolderNodeType(node?.node_type)) return "folder";
  if (isFileNodeType(node?.node_type)) return "file";
  return "abstract";
}

function normalizeFreshnessState(value) {
  switch (text(value).toLowerCase()) {
    case "updated":
    case "in_sync":
    case "verified":
    case "linked":
      return "updated";
    case "no_spec":
    case "uncovered":
    case "not_specified":
      return "no_spec";
    case "behind_code":
    case "code_ahead":
    case "needs_review":
    case "review":
    case "stale":
      return "behind_code";
    case "out_of_spec":
    case "incomplete":
    case "cancelled":
    case "interrupted":
      return "out_of_spec";
    case "ahead_of_code":
    case "spec_ahead":
    case "candidate":
    case "none":
    case "unknown":
    default:
      return "ahead_of_code";
  }
}

export function freshnessLabel(value) {
  switch (normalizeFreshnessState(value)) {
    case "updated":
      return "updated";
    case "no_spec":
      return "no spec";
    case "behind_code":
      return "behind code";
    case "out_of_spec":
      return "out of spec";
    case "ahead_of_code":
    default:
      return "ahead of code";
  }
}

function freshnessTone(value) {
  switch (normalizeFreshnessState(value)) {
    case "updated":
      return "#34d399";
    case "no_spec":
      return "#64748b";
    case "behind_code":
      return "#fb7185";
    case "out_of_spec":
      return "#fb923c";
    case "ahead_of_code":
    default:
      return "#fbbf24";
  }
}

export function isWorktreeFileNode(node) {
  if (!isFileNodeType(node?.node_type)) return false;
  return nodeSourceState(node) === "worktree";
}

export function isLeasedFileNode(node) {
  if (!isFileNodeType(node?.node_type)) return false;
  return nodeSourceState(node) === "lease";
}

export function isLocalOnlyNode(node) {
  return node?.local_only === true
    || node?.ignored_overlay === true
    || node?.file_source === "local_ignored";
}

export function nodeSourceState(node) {
  const meta = node?.metadata || {};
  const source = text(
    field(node, "file_source", "fileSource", "source")
      || field(meta, "source", "file_source", "fileSource"),
  ).toLowerCase();
  const origin = text(
    field(node, "file_origin", "fileOrigin", "origin")
      || field(meta, "origin", "file_origin", "fileOrigin"),
  ).toLowerCase();
  const fileState = text(
    field(node, "file_state", "fileState")
      || field(meta, "file_state", "fileState"),
  ).toLowerCase();
  const leaseState = text(
    field(node, "lease_state", "leaseState")
      || field(meta, "lease_state", "leaseState"),
  ).toLowerCase();
  const provisional = node?.provisional === true || meta?.provisional === true;
  const pendingMainSync = node?.pending_main_sync === true
    || node?.pendingMainSync === true
    || meta?.pending_main_sync === true
    || meta?.pendingMainSync === true;

  if (isLocalOnlyNode(node) || source === "local_ignored") return "local";
  if (
    source === "lease"
    || origin === "lease"
    || fileState === "lease"
    || leaseState === "active"
  ) {
    return "lease";
  }
  if (
    source === "worktree"
    || origin === "worktree"
    || fileState === "worktree"
    || provisional
    || pendingMainSync
  ) {
    return "worktree";
  }
  if (
    source === "filetree"
    || source === "main"
    || source === "committed"
    || origin === "main"
    || origin === "committed"
  ) {
    return "main";
  }
  return "unknown";
}

export function nodeSourceTone(node) {
  switch (nodeSourceState(node)) {
    case "lease":
      return "#f59e0b";
    case "worktree":
      return "#38bdf8";
    case "main":
      return "#22c55e";
    case "local":
      return "#94a3b8";
    case "unknown":
    default:
      return "#64748b";
  }
}

export function hasActiveSpecs(node) {
  if (typeof node?.has_active_specs === "boolean") return node.has_active_specs;
  if (typeof node?.hasActiveSpecs === "boolean") return node.hasActiveSpecs;
  return Array.isArray(node?.active_specs) && node.active_specs.length > 0;
}

export function isNoSpecNode(node) {
  return normalizeFreshnessState(node?.freshness_state || node?.spec_state) === "no_spec"
    || !hasActiveSpecs(node);
}

export function isUnspecifiedStructuralNode(node) {
  return ["workspace", "folder", "file"].includes(nodeKind(node)) && isNoSpecNode(node);
}

export function nodeTone(node) {
  if (isNoSpecNode(node)) return "#64748b";
  return freshnessTone(node?.freshness_state);
}

export function liveAgentsFor(node) {
  const activeAgents = jsonArray(field(node, "active_agents", "activeAgents", "live_agents", "liveAgents"));
  if (activeAgents.length) return activeAgents;
  const count = Number(field(node, "active_agent_count", "activeAgentCount", "live_agent_count", "liveAgentCount")) || 0;
  return Array.from({ length: Math.max(0, count) }, (_, index) => ({ id: `live-agent-${index}` }));
}

function normalizeNode(raw, index = 0, options = {}) {
  const displayIdentity = options.workspaceDisplayIdentity || createWorkspaceDisplayIdentity(options.repoPath || "");
  const meta = metadata(raw);
  const id = text(field(raw, "id", "node_id", "nodeId", "task_id", "taskId"), `spec-${index}`);
  const title = text(field(raw, "title", "summary"), "Untitled spec");
  const nodeType = text(field(raw, "node_type", "nodeType", "type"), "feature").toLowerCase();
  const path = text(field(raw, "path") || field(meta, "path"));
  const displayTitle = displayTitleForNode(title, path, nodeType, displayIdentity);
  const displayPath = displayPathForNode(path, title, nodeType, displayIdentity);
  const summary = text(field(raw, "summary", "current_summary", "body", "description"), "");
  const purpose = text(field(raw, "purpose"), summary || "Intentional behavior captured from prompts, checkpoints, and patch history.");
  const rawMarkdown = field(raw, "markdown");
  const freshnessState = normalizeFreshnessState(field(raw, "freshness_state", "freshnessState", "spec_state", "specState"));
  const activeAgents = jsonArray(field(raw, "active_agents", "activeAgents", "live_agents", "liveAgents"));
  const activeAgentCount = Math.max(
    activeAgents.length,
    Number(field(raw, "active_agent_count", "activeAgentCount", "live_agent_count", "liveAgentCount")) || 0,
  );
  const fileSource = text(
    field(raw, "file_source", "fileSource") || field(meta, "source", "file_source", "fileSource"),
  ).toLowerCase();
  const fileOrigin = text(
    field(raw, "file_origin", "fileOrigin") || field(meta, "origin", "file_origin", "fileOrigin"),
    fileSource,
  ).toLowerCase();
  const provisional = booleanField(raw, "provisional", "isProvisional") || booleanField(meta, "provisional", "isProvisional");
  const pendingMainSync = booleanField(raw, "pending_main_sync", "pendingMainSync")
    || booleanField(meta, "pending_main_sync", "pendingMainSync");
  const fileState = text(
    field(raw, "file_state", "fileState") || field(meta, "file_state", "fileState"),
  ).toLowerCase();
  const leaseState = text(
    field(raw, "lease_state", "leaseState") || field(meta, "lease_state", "leaseState"),
  ).toLowerCase();
  const localOnly = booleanField(raw, "local_only", "localOnly")
    || booleanField(meta, "local_only", "localOnly");
  const ignoredOverlay = booleanField(raw, "ignored_overlay", "ignoredOverlay")
    || booleanField(meta, "ignored_overlay", "ignoredOverlay");
  const projectContext = nodeProjectContext({ ...raw, metadata: meta, id });
  const notificationCount = Math.max(
    0,
    Number(field(raw, "notification_count", "notificationCount", "out_of_spec_count", "outOfSpecCount")) || 0,
  );
  const outOfSpecCount = Math.max(
    notificationCount,
    Number(field(raw, "out_of_spec_count", "outOfSpecCount")) || 0,
  );
  return {
    ...raw,
    id,
    title,
    display_title: displayTitle,
    display_path: displayPath,
    displayTitle,
    displayPath,
    node_type: nodeType,
    path,
    summary,
    purpose,
    freshness_state: freshnessState,
    spec_state: freshnessState,
    spec_state_label: freshnessLabel(freshnessState),
    active_agent_count: activeAgentCount,
    active_agents: activeAgents,
    specs: jsonArray(field(raw, "specs")),
    active_specs: jsonArray(field(raw, "active_specs", "activeSpecs")),
    superseded_specs: jsonArray(field(raw, "superseded_specs", "supersededSpecs")),
    agent_rationale: jsonArray(field(raw, "agent_rationale", "agentRationale")),
    notifications: jsonArray(field(raw, "notifications")),
    notification_count: notificationCount,
    out_of_spec_count: outOfSpecCount,
    file_source: fileSource,
    file_origin: fileOrigin,
    file_state: fileState,
    lease_state: leaseState,
    container_node_id: projectContext.containerNodeId,
    containerNodeId: projectContext.containerNodeId,
    mount_id: projectContext.mountId,
    mountId: projectContext.mountId,
    project_root: projectContext.projectRoot,
    projectRoot: projectContext.projectRoot,
    workspace_root: projectContext.workspaceRoot,
    workspaceRoot: projectContext.workspaceRoot,
    project_relative_path: projectContext.projectRelativePath,
    projectRelativePath: projectContext.projectRelativePath,
    visible_path: projectContext.visiblePath,
    visiblePath: projectContext.visiblePath,
    source_repo_id: projectContext.sourceRepoId,
    sourceRepoId: projectContext.sourceRepoId,
    source_graph_cursor: projectContext.sourceGraphCursor,
    sourceGraphCursor: projectContext.sourceGraphCursor,
    source_node_id: projectContext.sourceNodeId,
    sourceNodeId: projectContext.sourceNodeId,
    source_node_hash: projectContext.sourceNodeHash,
    sourceNodeHash: projectContext.sourceNodeHash,
    local_only: localOnly,
    ignored_overlay: ignoredOverlay,
    provisional,
    pending_main_sync: pendingMainSync,
    markdown: typeof rawMarkdown === "string" && rawMarkdown.trim()
      ? rawMarkdown
      : fallbackMarkdown({ title, summary, purpose, freshness_state: freshnessState }),
    markdown_path: text(field(raw, "markdown_path", "markdownPath")),
    metadata: meta,
  };
}

function fallbackMarkdown(node) {
  return [
    `# ${node.title || "Spec Node"}`,
    "",
    node.summary || node.purpose || "No spec summary has been recorded yet.",
    "",
    `Spec status: \`${freshnessLabel(node.freshness_state)}\``,
  ].join("\n");
}

function isConsolidationSpec(spec) {
  const reason = text(field(spec, "supersession_reason", "supersessionReason")).toLowerCase();
  return ["consolidat", "merg", "incorporat", "absorb", "combin", "roll into", "rolled into"]
    .some((marker) => reason.includes(marker));
}

export function splitSpecHistory(activeSpecs, supersededSpecs) {
  const active = Array.isArray(activeSpecs) ? activeSpecs : [];
  const superseded = Array.isArray(supersededSpecs) ? supersededSpecs : [];
  const activeIds = new Set(active.map((spec) => text(field(spec, "id"))).filter(Boolean));
  const consolidatedByActiveId = new Map(active.map((spec) => [text(field(spec, "id")), []]));
  const historical = [];

  superseded.forEach((spec) => {
    if (!isConsolidationSpec(spec)) {
      historical.push(spec);
      return;
    }
    const targetId = text(field(spec, "superseded_by_id", "supersededById"));
    if (targetId && activeIds.has(targetId)) {
      consolidatedByActiveId.get(targetId).push(spec);
      return;
    }
    if (active.length === 1) {
      const onlyActiveId = text(field(active[0], "id"));
      consolidatedByActiveId.get(onlyActiveId)?.push(spec);
    }
  });

  return {
    active: active.map((spec) => ({
      ...spec,
      consolidated_specs: consolidatedByActiveId.get(text(field(spec, "id"))) || [],
    })),
    historical,
  };
}

export function normalizeSnapshot(snapshot, options = {}) {
  const displayIdentity = options.workspaceDisplayIdentity || createWorkspaceDisplayIdentity(
    options.repoPath || snapshot?.repoPath || snapshot?.repo_path || "",
    options.fallbackWorkspaceName || snapshot?.workspaceName || snapshot?.workspace_name || "Workspace",
  );
  const matrix = snapshot?.specGraph || snapshot?.raw || {};
  const specNodes = Array.isArray(snapshot?.specNodes)
    ? snapshot.specNodes
    : Array.isArray(matrix?.nodes)
      ? matrix.nodes
      : [];
  const nodes = specNodes.map((node, index) => normalizeNode(node, index, {
    workspaceDisplayIdentity: displayIdentity,
  }));
  const edgeSource = Array.isArray(snapshot?.specEdges)
    ? snapshot.specEdges
    : Array.isArray(matrix?.edges)
      ? matrix.edges
      : [];
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = edgeSource
    .map((edge, index) => {
      const meta = metadata(edge);
      if (meta.hidden || field(edge, "hidden") === true) return null;
      return {
        id: text(field(edge, "id"), `edge-${index}`),
        from: text(field(edge, "from_node_id", "fromNodeId", "from", "source")),
        to: text(field(edge, "to_node_id", "toNodeId", "to", "target")),
        kind: text(field(edge, "edge_kind", "edgeKind", "kind"), "related"),
        metadata: meta,
      };
    })
    .filter(Boolean)
    .filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const graphStats = snapshot?.graphStats || matrix?.graph_stats || matrix?.graphStats || {};
  const projectMountSource = Array.isArray(snapshot?.projectMounts)
    ? snapshot.projectMounts
    : Array.isArray(snapshot?.project_mounts)
      ? snapshot.project_mounts
      : Array.isArray(graphStats?.project_mounts)
        ? graphStats.project_mounts
        : Array.isArray(graphStats?.projectMounts)
          ? graphStats.projectMounts
          : [];
  const projectMounts = projectMountSource.map(normalizeProjectMount);
  const containerWorkspace = booleanField(snapshot, "containerWorkspace", "container_workspace")
    || booleanField(matrix, "container_workspace", "containerWorkspace")
    || booleanField(graphStats, "container_workspace", "containerWorkspace")
    || projectMounts.length > 0;

  return {
    matrix,
    nodes,
    edges,
    agentWork: snapshot?.agentWork || matrix?.agent_work || {},
    graphStats,
    containerWorkspace,
    projectMounts,
    taskHistory: normalizeTaskHistory(snapshot?.taskHistory || matrix?.task_history || matrix?.taskHistory || {}),
    workspaceDisplayIdentity: displayIdentity,
  };
}

export function normalizeTaskHistory(rawHistory = {}) {
  const tasks = Array.isArray(rawHistory?.tasks) ? rawHistory.tasks : [];
  return {
    ...rawHistory,
    tasks: tasks.map((task, taskIndex) => normalizeHistoryTask(task, taskIndex)),
  };
}

function normalizeHistoryTask(task, taskIndex) {
  const taskId = text(field(task, "task_id", "taskId", "id"), `task-${taskIndex}`);
  const nodes = Array.isArray(task?.nodes) ? task.nodes : [];
  const mutations = Array.isArray(task?.mutations) ? task.mutations : [];
  const arbiterDecisions = Array.isArray(task?.arbiter_decisions)
    ? task.arbiter_decisions
    : Array.isArray(task?.arbiterDecisions)
      ? task.arbiterDecisions
      : [];
  return {
    ...task,
    task_id: taskId,
    taskId,
    title: text(field(task, "title", "summary"), "Untitled task"),
    original_prompt: text(field(task, "original_prompt", "originalPrompt", "prompt")),
    prompt: text(field(task, "prompt", "original_prompt", "originalPrompt")),
    start_task_plan: text(field(task, "start_task_plan", "startTaskPlan", "body")),
    coding_agent: text(field(task, "coding_agent", "codingAgent", "agent_kind", "agentKind")),
    agent_kind: text(field(task, "agent_kind", "agentKind", "coding_agent", "codingAgent")),
    status: text(field(task, "status"), "unknown"),
    agent_id: text(field(task, "agent_id", "agentId")),
    first_mutation_at: text(field(task, "first_mutation_at", "firstMutationAt", "created_at", "createdAt")),
    last_mutation_at: text(field(task, "last_mutation_at", "lastMutationAt", "updated_at", "updatedAt")),
    mutation_count: Number(field(task, "mutation_count", "mutationCount")) || mutations.length,
    rolled_back_count: Number(field(task, "rolled_back_count", "rolledBackCount")) || 0,
    arbiter_decision_count: Number(field(task, "arbiter_decision_count", "arbiterDecisionCount")) || arbiterDecisions.length,
    arbiter_status: text(field(task, "arbiter_status", "arbiterStatus")),
    rollback_state: text(field(task, "rollback_state", "rollbackState"), "active"),
    nodes: nodes.map((node, nodeIndex) => normalizeHistoryNode(node, nodeIndex)),
    mutations: mutations.map((mutation, mutationIndex) => normalizeHistoryMutation(mutation, mutationIndex)),
    arbiter_decisions: arbiterDecisions.map((decision, decisionIndex) => normalizeHistoryArbiterDecision(decision, decisionIndex)),
  };
}

function normalizeHistoryNode(node, nodeIndex) {
  const nodeId = text(field(node, "node_id", "nodeId", "id"), `node-${nodeIndex}`);
  const specChanges = Array.isArray(node?.spec_changes) ? node.spec_changes : [];
  const structuralChanges = Array.isArray(node?.structural_changes) ? node.structural_changes : [];
  return {
    ...node,
    id: nodeId,
    node_id: nodeId,
    title: text(field(node, "title", "path"), nodeId),
    node_type: text(field(node, "node_type", "nodeType"), "node"),
    path: text(field(node, "path")),
    summary: text(field(node, "summary")),
    mutation_count: Number(field(node, "mutation_count", "mutationCount")) || specChanges.length + structuralChanges.length,
    spec_changes: specChanges.map((mutation, index) => normalizeHistoryMutation(mutation, index)),
    structural_changes: structuralChanges.map((mutation, index) => normalizeHistoryMutation(mutation, index)),
  };
}

function normalizeHistoryMutation(mutation, mutationIndex) {
  return {
    ...mutation,
    id: text(field(mutation, "id"), `mutation-${mutationIndex}`),
    mutation_kind: text(field(mutation, "mutation_kind", "mutationKind"), "changed"),
    action: text(field(mutation, "action"), "changed"),
    entity_type: text(field(mutation, "entity_type", "entityType")),
    entity_id: text(field(mutation, "entity_id", "entityId")),
    node_id: text(field(mutation, "node_id", "nodeId")),
    spec_object_id: text(field(mutation, "spec_object_id", "specObjectId")),
    before_statement: text(field(mutation, "before_statement", "beforeStatement")),
    after_statement: text(field(mutation, "after_statement", "afterStatement")),
    before_status: text(field(mutation, "before_status", "beforeStatus")),
    after_status: text(field(mutation, "after_status", "afterStatus")),
    rollback_state: text(field(mutation, "rollback_state", "rollbackState"), "active"),
    created_at: text(field(mutation, "created_at", "createdAt")),
  };
}

function normalizeHistoryArbiterDecision(decision, decisionIndex) {
  return {
    ...decision,
    id: text(field(decision, "id"), `arbiter-${decisionIndex}`),
    status: text(field(decision, "status"), "unknown"),
    provider: text(field(decision, "provider"), "unknown"),
    scope: text(field(decision, "scope")),
    operation: text(field(decision, "operation")),
    target_node_id: text(field(decision, "target_node_id", "targetNodeId")),
    target_path: text(field(decision, "target_path", "targetPath")),
    statement: text(field(decision, "statement")),
    reason: text(field(decision, "reason")),
    created_at: text(field(decision, "created_at", "createdAt")),
  };
}

export function mergeLocalIgnoredOverlay(graph, overlay, enabled, options = {}) {
  if (!enabled || !overlay || typeof overlay !== "object") return graph;
  const overlayNodes = Array.isArray(overlay.nodes) ? overlay.nodes : [];
  if (!overlayNodes.length) return graph;

  const existingPaths = new Set(graph.nodes.map((node) => text(node.path)).filter(Boolean));
  const existingIds = new Set(graph.nodes.map((node) => node.id));
  const localNodes = overlayNodes
    .map((node, index) => normalizeNode(node, graph.nodes.length + index, {
      workspaceDisplayIdentity: options.workspaceDisplayIdentity || graph.workspaceDisplayIdentity,
    }))
    .filter((node) => node.id && !existingIds.has(node.id))
    .filter((node) => {
      const path = text(node.path);
      return !path || !existingPaths.has(path);
    });
  if (!localNodes.length) return graph;

  const root = graphRootNode(graph.nodes, graph.edges);
  const localEdges = root
    ? localNodes.map((node) => ({
      id: `local-ignored-edge-${root.id}-${node.id}`,
      from: root.id,
      to: node.id,
      kind: "contains",
      metadata: {
        source: "local_ignored_overlay",
        visible: true,
        containment: true,
        local_only: true,
        ignored_overlay: true,
        path: node.path,
      },
    }))
    : [];

  return {
    ...graph,
    nodes: [...graph.nodes, ...localNodes],
    edges: [...graph.edges, ...localEdges],
    graphStats: {
      ...graph.graphStats,
      localIgnoredOverlayCount: localNodes.length,
      localIgnoredOverlayCacheHit: overlay.cache_hit === true,
    },
  };
}

export function selectedFallback(nodes, selectedNodeId) {
  return nodes.find((node) => node.id === selectedNodeId) || nodes[0] || null;
}

export function isContainmentEdge(edge) {
  return edge.kind === "contains" || edge.metadata?.containment === true;
}

export function dimensionsForNode(node) {
  return NODE_DIMENSIONS[nodeKind(node)] || NODE_DIMENSIONS.abstract;
}

export function graphRootNode(nodes, edges) {
  const workspaceNode = nodes.find((node) => isWorkspaceNodeType(node.node_type));
  if (workspaceNode) return workspaceNode;
  if (!nodes.length) return null;
  const degreeById = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    if (degreeById.has(edge.from)) degreeById.set(edge.from, degreeById.get(edge.from) + 1);
    if (degreeById.has(edge.to)) degreeById.set(edge.to, degreeById.get(edge.to) + 1);
  }
  return [...nodes].sort((left, right) => {
    const scoreFor = (node) => {
      const title = `${node.id} ${node.title}`.toLowerCase();
      const centralHint = title.includes("project") || title.includes("root") || title.includes("workspace") ? 160 : 0;
      const typeHint = isFileNodeType(node.node_type) ? -20 : 20;
      return centralHint + typeHint + (degreeById.get(node.id) || 0) * 20;
    };
    return scoreFor(right) - scoreFor(left) || left.title.localeCompare(right.title);
  })[0];
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Add } from "@styled-icons/material-rounded/Add";
import { Close } from "@styled-icons/material-rounded/Close";
import { DeleteOutline } from "@styled-icons/material-rounded/DeleteOutline";
import { Edit } from "@styled-icons/material-rounded/Edit";
import { ExpandMore } from "@styled-icons/material-rounded/ExpandMore";
import { KeyboardArrowLeft } from "@styled-icons/material-rounded/KeyboardArrowLeft";
import { Send } from "@styled-icons/material-rounded/Send";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styled from "styled-components";
import { createWorkspaceDisplayIdentity } from "../workspace/workspaceDisplayIdentity.js";
import GraphRendererHost from "./renderers/GraphRendererHost.jsx";
import {
  knowledgeNodeTypeLabel,
  normalizeKnowledgeSnapshot,
  relatedKnowledgeNodes,
} from "./knowledgeGraphCore.js";
import {
  field,
  freshnessLabel,
  graphRootNode,
  isLeasedFileNode,
  isLocalOnlyNode,
  isUnspecifiedStructuralNode,
  isWorktreeFileNode,
  mergeLocalIgnoredOverlay,
  normalizeSnapshot,
  selectedFallback,
  splitSpecHistory,
  text,
} from "./specGraphCore.js";

export default function SpecGraphWorkspaceView({
  defaultWorkingDirectory,
  knowledgeGraphError = "",
  knowledgeGraphSnapshot = null,
  knowledgeGraphState = "idle",
  rootDirectory,
  specGraphError = "",
  specGraphSnapshot = null,
  specGraphState = "idle",
  isWorkspaceActive = false,
  onSubmitSpecEditIntent = null,
  specEditAgents = [],
  workspace,
}) {
  const workspaceId = workspace?.id || "";
  const workspaceName = workspace?.name || "";
  const repoPath = workspaceId ? rootDirectory || defaultWorkingDirectory || "" : "";
  const workspaceDisplayIdentity = useMemo(
    () => createWorkspaceDisplayIdentity(repoPath, workspaceName || "Workspace"),
    [repoPath, workspaceName],
  );
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [showLocalIgnored, setShowLocalIgnored] = useState(false);
  const [localIgnoredOverlay, setLocalIgnoredOverlay] = useState(null);
  const [localIgnoredState, setLocalIgnoredState] = useState("idle");
  const [localIgnoredError, setLocalIgnoredError] = useState("");
  const [viewMode, setViewMode] = useState("graph");
  const [graphKind, setGraphKind] = useState("specs");
  const [specEditDraft, setSpecEditDraft] = useState(null);
  const [specEditStatus, setSpecEditStatus] = useState({ state: "idle", message: "" });
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedHistoryNodeId, setSelectedHistoryNodeId] = useState("");
  const [selectedKnowledgeNodeId, setSelectedKnowledgeNodeId] = useState("");
  const snapshot = specGraphSnapshot;
  const error = specGraphError;
  const state = specGraphState;
  const knowledgeSnapshot = knowledgeGraphSnapshot;
  const knowledgeError = knowledgeGraphError;
  const knowledgeState = knowledgeGraphState;

  const loadLocalIgnoredOverlay = useCallback(() => {
    if (!repoPath || !workspaceId) return;
    setLocalIgnoredState("loading");
    setLocalIgnoredError("");
    invoke("cloud_mcp_get_local_ignored_spec_graph_overlay", { repoPath })
      .then((overlay) => {
        setLocalIgnoredOverlay(overlay);
        setLocalIgnoredState("ready");
      })
      .catch((nextError) => {
        setLocalIgnoredError(nextError?.message || String(nextError));
        setLocalIgnoredState("error");
      });
  }, [repoPath, workspaceId]);

  useEffect(() => {
    if (showLocalIgnored) loadLocalIgnoredOverlay();
  }, [loadLocalIgnoredOverlay, showLocalIgnored]);

  const baseSpecGraph = useMemo(
    () => normalizeSnapshot(snapshot, { workspaceDisplayIdentity }),
    [snapshot, workspaceDisplayIdentity],
  );
  const specGraph = useMemo(
    () => mergeLocalIgnoredOverlay(baseSpecGraph, localIgnoredOverlay, showLocalIgnored, {
      workspaceDisplayIdentity,
    }),
    [baseSpecGraph, localIgnoredOverlay, showLocalIgnored, workspaceDisplayIdentity],
  );
  const knowledgeGraph = useMemo(
    () => normalizeKnowledgeSnapshot(knowledgeSnapshot, { workspaceDisplayIdentity }),
    [knowledgeSnapshot, workspaceDisplayIdentity],
  );
  const selectedNode = selectedFallback(specGraph.nodes, selectedNodeId);
  const selectedKnowledgeNode = selectedFallback(knowledgeGraph.nodes, selectedKnowledgeNodeId);
  const selectedKnowledgeRelations = useMemo(
    () => relatedKnowledgeNodes(knowledgeGraph, selectedKnowledgeNode?.id),
    [knowledgeGraph, selectedKnowledgeNode?.id],
  );
  const taskHistory = specGraph.taskHistory || { tasks: [] };
  const historyTasks = Array.isArray(taskHistory.tasks) ? taskHistory.tasks : [];
  const selectedTask = historyTasks.find((task) => task.task_id === selectedTaskId) || historyTasks[0] || null;
  const selectedHistoryNode = selectedTask?.nodes?.find((node) => node.node_id === selectedHistoryNodeId)
    || selectedTask?.nodes?.[0]
    || null;
  const localIgnoredCount = Array.isArray(localIgnoredOverlay?.nodes)
    ? localIgnoredOverlay.nodes.length
    : 0;
  const readySpecEditAgents = useMemo(
    () => (Array.isArray(specEditAgents) ? specEditAgents : [])
      .filter((agent) => agent?.ready !== false && agent?.paneId && agent?.instanceId),
    [specEditAgents],
  );
  const specEditDisabledReason = useMemo(() => {
    if (!isWorkspaceActive) return "Activate this workspace to edit specs.";
    if (!readySpecEditAgents.length) return "Start an agent terminal to edit specs.";
    if (state === "loading" || state === "syncing") return "Wait for the Spec Graph to finish syncing.";
    if (error) return "Resolve the Spec Graph sync error before editing.";
    return "";
  }, [error, isWorkspaceActive, readySpecEditAgents.length, state]);
  const openSpecEditDraft = useCallback((operation, spec = null) => {
    if (!selectedNode) return;
    const targetSpec = spec || null;
    const currentStatement = targetSpec ? text(field(targetSpec, "statement"), "") : "";
    setSpecEditStatus({ state: "idle", message: "" });
    setSpecEditDraft({
      operation,
      targetNodeId: selectedNode.id,
      targetSpecObjectId: targetSpec ? text(field(targetSpec, "id"), "") : "",
      currentStatement,
      desiredStatement: operation === "edit" ? currentStatement : "",
      userInstruction: "",
      terminalKey: readySpecEditAgents[0]?.key || "",
    });
  }, [readySpecEditAgents, selectedNode]);
  const closeSpecEditDraft = useCallback(() => {
    setSpecEditDraft(null);
    setSpecEditStatus({ state: "idle", message: "" });
  }, []);
  const submitSpecEditDraft = useCallback((event) => {
    event.preventDefault();
    if (!specEditDraft || !selectedNode || !onSubmitSpecEditIntent) return;
    const agent = readySpecEditAgents.find((candidate) => candidate.key === specEditDraft.terminalKey)
      || readySpecEditAgents[0]
      || null;
    if (!agent) {
      setSpecEditStatus({ state: "error", message: "Choose an active agent terminal." });
      return;
    }
    const instruction = text(specEditDraft.userInstruction, "");
    const desiredStatement = text(specEditDraft.desiredStatement, "");
    if (specEditDraft.operation !== "delete" && !desiredStatement && !instruction) {
      setSpecEditStatus({ state: "error", message: "Describe the spec change first." });
      return;
    }
    if (specEditDraft.operation === "delete" && !specEditDraft.targetSpecObjectId) {
      setSpecEditStatus({ state: "error", message: "Choose an active spec to delete." });
      return;
    }
    setSpecEditStatus({ state: "submitting", message: "Sending spec edit to the agent..." });
    onSubmitSpecEditIntent({
      agent,
      baseGraphHash: text(specGraphSnapshot?.cursor, ""),
      baseNodeHash: text(specGraphSnapshot?.nodeHashes?.[selectedNode.id], ""),
      currentStatement: specEditDraft.currentStatement,
      desiredStatement,
      operation: specEditDraft.operation,
      targetNode: selectedNode,
      targetNodeId: selectedNode.id,
      targetPath: text(selectedNode.display_path || selectedNode.displayPath || selectedNode.path, ""),
      targetSpecObjectId: specEditDraft.targetSpecObjectId,
      targetTitle: text(selectedNode.display_title || selectedNode.displayTitle || selectedNode.title, "Spec node"),
      userInstruction: instruction,
    })
      .then((result) => {
        setSpecEditStatus({
          state: "sent",
          message: result?.intentId ? `Sent to ${agent.label || agent.agentId}.` : "Sent to the agent.",
        });
        window.setTimeout(() => setSpecEditDraft(null), 650);
      })
      .catch((nextError) => {
        setSpecEditStatus({
          state: "error",
          message: nextError?.message || String(nextError || "Unable to send spec edit."),
        });
      });
  }, [
    onSubmitSpecEditIntent,
    readySpecEditAgents,
    selectedNode,
    specEditDraft,
    specGraphSnapshot?.cursor,
    specGraphSnapshot?.nodeHashes,
  ]);

  useEffect(() => {
    if (specGraph.nodes.length && !specGraph.nodes.some((node) => node.id === selectedNodeId)) {
      const root = graphRootNode(specGraph.nodes, specGraph.edges);
      setSelectedNodeId(root?.id || specGraph.nodes[0].id);
    }
  }, [specGraph.edges, specGraph.nodes, selectedNodeId]);

  useEffect(() => {
    if (
      knowledgeGraph.nodes.length
      && !knowledgeGraph.nodes.some((node) => node.id === selectedKnowledgeNodeId)
    ) {
      const root = graphRootNode(knowledgeGraph.nodes, knowledgeGraph.edges);
      setSelectedKnowledgeNodeId(root?.id || knowledgeGraph.nodes[0].id);
    }
  }, [knowledgeGraph.edges, knowledgeGraph.nodes, selectedKnowledgeNodeId]);

  useEffect(() => {
    if (!historyTasks.length) {
      setSelectedTaskId("");
      setSelectedHistoryNodeId("");
      return;
    }
    if (!historyTasks.some((task) => task.task_id === selectedTaskId)) {
      setSelectedTaskId(historyTasks[0].task_id);
    }
  }, [historyTasks, selectedTaskId]);

  useEffect(() => {
    const nodes = Array.isArray(selectedTask?.nodes) ? selectedTask.nodes : [];
    if (!nodes.length) {
      setSelectedHistoryNodeId("");
      return;
    }
    if (!nodes.some((node) => node.node_id === selectedHistoryNodeId)) {
      setSelectedHistoryNodeId(nodes[0].node_id);
    }
  }, [selectedHistoryNodeId, selectedTask]);

  return (
    <SpecGraphSurface aria-label={`${workspace?.name || "Workspace"} Spec Graph`} data-state={state}>
      {error && <SpecGraphError>{error}</SpecGraphError>}
      {localIgnoredError && <SpecGraphError>{localIgnoredError}</SpecGraphError>}
      {knowledgeError && graphKind === "knowledge" && <SpecGraphError>{knowledgeError}</SpecGraphError>}

      <SpecGraphToolbar>
        {graphKind === "specs" ? (
          <>
            <ViewToggleGroup aria-label="Spec Graph view mode">
              <ViewToggleButton
                type="button"
                data-active={viewMode === "graph" ? "true" : "false"}
                onClick={() => setViewMode("graph")}
              >
                Graph
              </ViewToggleButton>
              <ViewToggleButton
                type="button"
                data-active={viewMode === "history" ? "true" : "false"}
                onClick={() => setViewMode("history")}
              >
                History
              </ViewToggleButton>
            </ViewToggleGroup>
            <LocalIgnoredToggle
              type="button"
              data-active={showLocalIgnored ? "true" : "false"}
              onClick={() => {
                setShowLocalIgnored((current) => !current);
              }}
            >
              {showLocalIgnored ? "Hide local ignored" : "Show local ignored"}
            </LocalIgnoredToggle>
            <LocalIgnoredHint>
              {localIgnoredState === "loading"
                ? "checking local cache"
                : showLocalIgnored
                  ? `${localIgnoredCount} local-only whitelisted path${localIgnoredCount === 1 ? "" : "s"}`
                  : "local only, not synced"}
            </LocalIgnoredHint>
          </>
        ) : (
          <KnowledgeToolbarSummary>
            <span>{knowledgeGraph.nodes.length} nodes</span>
            <span>{knowledgeGraph.edges.length} links</span>
            {Number(knowledgeGraph.graphStats?.missing_paths || 0) > 0 && (
              <span data-state="missing">{knowledgeGraph.graphStats.missing_paths} missing paths</span>
            )}
            <span data-state={knowledgeState}>{knowledgeState}</span>
          </KnowledgeToolbarSummary>
        )}
        <ToolbarSpacer />
        <ViewToggleGroup aria-label="Graph source">
          <ViewToggleButton
            type="button"
            data-active={graphKind === "specs" ? "true" : "false"}
            onClick={() => setGraphKind("specs")}
          >
            Specs
          </ViewToggleButton>
          <ViewToggleButton
            type="button"
            data-active={graphKind === "knowledge" ? "true" : "false"}
            onClick={() => setGraphKind("knowledge")}
          >
            Knowledge
          </ViewToggleButton>
        </ViewToggleGroup>
      </SpecGraphToolbar>

      {graphKind === "knowledge" ? (
        <KnowledgeGraphShell>
          <KnowledgeOutline
            nodes={knowledgeGraph.nodes}
            edges={knowledgeGraph.edges}
            selectedNodeId={selectedKnowledgeNode?.id}
            onSelect={setSelectedKnowledgeNodeId}
          />
          <SpecGraphMain>
            <GraphRendererHost
              nodes={knowledgeGraph.nodes}
              edges={knowledgeGraph.edges}
              selectedNodeId={selectedKnowledgeNode?.id}
              onSelect={setSelectedKnowledgeNodeId}
              state={knowledgeState}
              emptyLabel="No knowledge notes indexed yet."
              layoutLabel="Laying out knowledge graph..."
              variant="knowledge"
            />
          </SpecGraphMain>
          <KnowledgeInspector
            graph={knowledgeGraph}
            node={selectedKnowledgeNode}
            relations={selectedKnowledgeRelations}
            onSelect={setSelectedKnowledgeNodeId}
          />
        </KnowledgeGraphShell>
      ) : (
        <SpecGraphShell>
          {viewMode === "history" ? (
          <>
            <TaskHistoryMain
              tasks={historyTasks}
              selectedTaskId={selectedTask?.task_id}
              selectedNodeId={selectedHistoryNode?.node_id}
              onSelectTask={setSelectedTaskId}
              onSelectNode={setSelectedHistoryNodeId}
            />
            <TaskHistoryInspector task={selectedTask} node={selectedHistoryNode} />
          </>
        ) : (
          <>
            <SpecGraphMain>
              <GraphRendererHost
                nodes={specGraph.nodes}
                edges={specGraph.edges}
                selectedNodeId={selectedNode?.id}
                onSelect={setSelectedNodeId}
                state={state}
              />
            </SpecGraphMain>

            <SpecInspector
              editDisabledReason={specEditDisabledReason}
              node={selectedNode}
              onAddSpec={() => openSpecEditDraft("add")}
              onDeleteSpec={(spec) => openSpecEditDraft("delete", spec)}
              onEditSpec={(spec) => openSpecEditDraft("edit", spec)}
            />
          </>
          )}
        </SpecGraphShell>
      )}
      {specEditDraft && (
        <SpecEditDialog
          agents={readySpecEditAgents}
          disabledReason={specEditDisabledReason}
          draft={specEditDraft}
          node={selectedNode}
          onChange={setSpecEditDraft}
          onClose={closeSpecEditDraft}
          onSubmit={submitSpecEditDraft}
          status={specEditStatus}
        />
      )}
    </SpecGraphSurface>
  );
}

function knowledgeOutlineNodePath(node) {
  return String(node?.note_path || node?.path || node?.markdown_path || "").replace(/\\/g, "/");
}

function isKnowledgeOutlineRoot(node) {
  const nodeType = String(node?.knowledge_node_type || node?.node_type || "").toLowerCase();
  const notePath = knowledgeOutlineNodePath(node).toLowerCase();
  return Boolean(node?.is_root)
    || nodeType === "workspace"
    || nodeType === "repo_root"
    || notePath === "index.md";
}

function isKnowledgeContainmentEdge(edge) {
  return edge?.kind === "contains" || edge?.metadata?.containment === true;
}

function compareKnowledgeOutlineNodes(left, right) {
  const leftTitle = String(left?.display_title || left?.title || "").toLowerCase();
  const rightTitle = String(right?.display_title || right?.title || "").toLowerCase();
  return leftTitle.localeCompare(rightTitle)
    || knowledgeOutlineNodePath(left).localeCompare(knowledgeOutlineNodePath(right))
    || String(left?.id || "").localeCompare(String(right?.id || ""));
}

function buildKnowledgeOutlineTree(nodes, edges) {
  const visibleNodes = Array.isArray(nodes) ? nodes : [];
  const visibleEdges = Array.isArray(edges) ? edges : [];
  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const rootNode = visibleNodes.find(isKnowledgeOutlineRoot) || graphRootNode(visibleNodes, visibleEdges) || visibleNodes[0] || null;
  const childrenByParent = new Map();
  const parentById = new Map();

  if (!rootNode) {
    return { rootNode: null, childrenByParent, parentById };
  }

  const incomingByChild = new Map();
  visibleEdges
    .filter(isKnowledgeContainmentEdge)
    .filter((edge) => nodeById.has(edge.from) && nodeById.has(edge.to) && edge.from !== edge.to)
    .forEach((edge) => {
      if (!incomingByChild.has(edge.to)) incomingByChild.set(edge.to, []);
      incomingByChild.get(edge.to).push(edge);
    });

  for (const node of visibleNodes) {
    if (node.id === rootNode.id) continue;
    const incoming = incomingByChild.get(node.id) || [];
    const chosen = incoming.find((edge) => edge.from !== rootNode.id) || incoming[0];
    const parentId = chosen?.from && nodeById.has(chosen.from) ? chosen.from : rootNode.id;
    parentById.set(node.id, parentId);
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(node);
  }

  for (const [parentId, children] of childrenByParent.entries()) {
    childrenByParent.set(parentId, children.sort(compareKnowledgeOutlineNodes));
  }

  return { rootNode, childrenByParent, parentById };
}

function selectedKnowledgePath(parentById, selectedNodeId) {
  const path = [];
  let current = selectedNodeId;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    path.push(current);
    current = parentById.get(current);
  }
  return path;
}

function KnowledgeOutlineNode({
  node,
  depth,
  childrenByParent,
  expandedIds,
  selectedNodeId,
  onSelect,
  onToggle,
  ancestorIds = new Set(),
}) {
  const nextAncestorIds = useMemo(() => new Set([...ancestorIds, node.id]), [ancestorIds, node.id]);
  const children = (childrenByParent.get(node.id) || []).filter((child) => !nextAncestorIds.has(child.id));
  const hasChildren = children.length > 0;
  const expanded = expandedIds.has(node.id);

  return (
    <KnowledgeOutlineNodeBlock>
      <KnowledgeOutlineRow $depth={depth} data-active={node.id === selectedNodeId ? "true" : "false"}>
        <KnowledgeOutlineButton
          type="button"
          data-active={node.id === selectedNodeId ? "true" : "false"}
          onClick={() => onSelect(node.id)}
        >
          <KnowledgeOutlineText>
            <span>{node.display_title || node.title || "Knowledge concept"}</span>
          </KnowledgeOutlineText>
        </KnowledgeOutlineButton>
        <KnowledgeOutlineDisclosure
          type="button"
          aria-label={expanded ? "Collapse concept" : "Expand concept"}
          data-expanded={expanded ? "true" : "false"}
          disabled={!hasChildren}
          onClick={() => hasChildren && onToggle(node.id)}
        >
          {hasChildren ? <KnowledgeDisclosureIcon aria-hidden="true" /> : null}
        </KnowledgeOutlineDisclosure>
      </KnowledgeOutlineRow>
      {hasChildren ? (
        <KnowledgeOutlineChildren
          $depth={depth}
          data-expanded={expanded ? "true" : "false"}
          aria-hidden={expanded ? undefined : "true"}
        >
          <KnowledgeOutlineChildrenInner>
            {children.map((child) => (
              <KnowledgeOutlineNode
                key={child.id}
                node={child}
                depth={depth + 1}
                childrenByParent={childrenByParent}
                expandedIds={expandedIds}
                selectedNodeId={selectedNodeId}
                onSelect={onSelect}
                onToggle={onToggle}
                ancestorIds={nextAncestorIds}
              />
            ))}
          </KnowledgeOutlineChildrenInner>
        </KnowledgeOutlineChildren>
      ) : null}
    </KnowledgeOutlineNodeBlock>
  );
}

function KnowledgeOutline({ nodes, edges, selectedNodeId, onSelect }) {
  const visibleNodes = Array.isArray(nodes) ? nodes : [];
  const outline = useMemo(() => buildKnowledgeOutlineTree(visibleNodes, edges), [edges, visibleNodes]);
  const hideRootItem = Boolean(outline.rootNode && isKnowledgeOutlineRoot(outline.rootNode));
  const topLevelNodes = useMemo(() => {
    if (!outline.rootNode) return [];
    if (hideRootItem) return outline.childrenByParent.get(outline.rootNode.id) || [];
    return [outline.rootNode];
  }, [hideRootItem, outline.childrenByParent, outline.rootNode]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [userCollapsedIds, setUserCollapsedIds] = useState(() => new Set());

  useEffect(() => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (outline.rootNode?.id && !userCollapsedIds.has(outline.rootNode.id)) next.add(outline.rootNode.id);
      for (const id of selectedKnowledgePath(outline.parentById, selectedNodeId)) {
        if (!userCollapsedIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [outline.parentById, outline.rootNode?.id, selectedNodeId, userCollapsedIds]);

  const toggleExpanded = useCallback((nodeId) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(nodeId)) {
        next.delete(nodeId);
        setUserCollapsedIds((collapsed) => new Set(collapsed).add(nodeId));
      } else {
        next.add(nodeId);
        setUserCollapsedIds((collapsed) => {
          const nextCollapsed = new Set(collapsed);
          nextCollapsed.delete(nodeId);
          return nextCollapsed;
        });
      }
      return next;
    });
  }, []);

  if (!visibleNodes.length) {
    return (
      <KnowledgeOutlinePanel>
        <KnowledgeOutlineEmpty>No knowledge notes indexed yet.</KnowledgeOutlineEmpty>
      </KnowledgeOutlinePanel>
    );
  }

  return (
    <KnowledgeOutlinePanel>
      <KnowledgePanelHeader>
        <span>Graph</span>
        <small>.agents/knowledge</small>
      </KnowledgePanelHeader>
      <KnowledgeOutlineList>
        {topLevelNodes.length ? (
          topLevelNodes.map((node) => (
            <KnowledgeOutlineNode
              key={node.id}
              node={node}
              depth={0}
              childrenByParent={outline.childrenByParent}
              expandedIds={expandedIds}
              selectedNodeId={selectedNodeId}
              onSelect={onSelect}
              onToggle={toggleExpanded}
              ancestorIds={hideRootItem && outline.rootNode?.id ? new Set([outline.rootNode.id]) : new Set()}
            />
          ))
        ) : (
          <KnowledgeOutlineEmpty>No knowledge concepts indexed yet.</KnowledgeOutlineEmpty>
        )}
      </KnowledgeOutlineList>
    </KnowledgeOutlinePanel>
  );
}

function isExternalKnowledgeMarkdownHref(value) {
  return /^(?:https?:|mailto:|tel:)/i.test(String(value || "").trim());
}

function decodeKnowledgeMarkdownHref(value) {
  const href = String(value || "").trim();
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function normalizeKnowledgeMarkdownTarget(value) {
  return decodeKnowledgeMarkdownHref(value)
    .replace(/\\/g, "/")
    .replace(/^\.agents\/knowledge\//i, "")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/\.md$/i, "")
    .toLowerCase();
}

function findKnowledgeNodeForMarkdownTarget(graph, target) {
  const normalizedTarget = normalizeKnowledgeMarkdownTarget(target);
  if (!normalizedTarget) return null;
  return (graph?.nodes || []).find((node) => {
    const candidates = [
      node.note_path,
      node.markdown_path,
      node.path,
      node.title,
      node.display_title,
      node.displayTitle,
    ];
    return candidates.some((candidate) => normalizeKnowledgeMarkdownTarget(candidate) === normalizedTarget);
  }) || null;
}

function openKnowledgeMarkdownLink(event, href, graph, onSelect) {
  const target = String(href || "").trim();
  if (!target || target.startsWith("#") || isExternalKnowledgeMarkdownHref(target)) {
    return;
  }

  const linkedNode = findKnowledgeNodeForMarkdownTarget(graph, target);
  if (!linkedNode) return;
  event.preventDefault();
  onSelect?.(linkedNode.id);
}

function escapeKnowledgeMarkdownLabel(value) {
  return String(value || "").replace(/([\\\]])/g, "\\$1");
}

function escapeKnowledgeMarkdownDestination(value) {
  return String(value || "")
    .replace(/[<>\r\n]/g, "")
    .trim();
}

function renderKnowledgeWikilinks(source) {
  return String(source || "").replace(/\[\[([^\]\n]+?)\]\]/g, (match, body) => {
    const [rawTarget, ...labelParts] = String(body || "").split("|");
    const target = escapeKnowledgeMarkdownDestination(rawTarget);
    if (!target) return match;
    const label = escapeKnowledgeMarkdownLabel(labelParts.join("|").trim() || target);
    return `[${label}](<${target}>)`;
  });
}

function createKnowledgeMarkdownComponents(graph, onSelect) {
  return {
    a({ node: _node, href, children, ...props }) {
      return (
        <a
          {...props}
          href={href}
          onClick={(event) => openKnowledgeMarkdownLink(event, href, graph, onSelect)}
          rel={isExternalKnowledgeMarkdownHref(href) ? "noreferrer" : undefined}
          target={isExternalKnowledgeMarkdownHref(href) ? "_blank" : undefined}
        >
          {children}
        </a>
      );
    },
    table(props) {
      const tableProps = { ...props };
      delete tableProps.node;

      return (
        <div className="knowledge-markdown-table-wrap">
          <table {...tableProps} />
        </div>
      );
    },
  };
}

function KnowledgeInspector({ graph, node, relations, onSelect }) {
  if (!node) {
    return (
      <Inspector>
        <InspectorEmpty>Select a knowledge note.</InspectorEmpty>
      </Inspector>
    );
  }
  const markdown = normalizeKnowledgeMarkdownSource(node.markdown, node);
  const outbound = Array.isArray(relations?.outbound) ? relations.outbound : [];
  const backlinks = Array.isArray(relations?.backlinks) ? relations.backlinks : [];
  const suggested = suggestedKnowledgeNodes(graph, node, relations);
  const wordCount = knowledgeWordCount(markdown);

  return (
    <Inspector>
      <KnowledgeInspectorHeader>
        <span>Inspector</span>
        <h2>{text(node.display_title || node.displayTitle || node.title, "Knowledge note")}</h2>
        <small>{text(node.note_path || node.path || node.markdown_path, ".agents/knowledge")}</small>
        <KnowledgeMetricRow>
          <strong>{wordCount.toLocaleString()} <em>words</em></strong>
          <strong>{outbound.length} <em>out</em></strong>
          <strong>{backlinks.length} <em>back</em></strong>
          <strong>{knowledgeNodeTypeLabel(node)}</strong>
        </KnowledgeMetricRow>
      </KnowledgeInspectorHeader>
      <MarkdownPane>
        <KnowledgeMarkdownBlock markdown={markdown} node={node} graph={graph} onSelect={onSelect} />
        <KnowledgeRelationsPanel>
          <KnowledgeRelationSection
            title="Outgoing"
            items={outbound}
            empty="No outgoing links."
            onSelect={onSelect}
          />
          <KnowledgeRelationSection
            title="Backlinks"
            items={backlinks}
            empty="No backlinks yet."
            onSelect={onSelect}
          />
          <KnowledgeRelationSection
            title="Suggested"
            items={suggested}
            empty="No suggested notes yet."
            onSelect={onSelect}
            suggested
          />
        </KnowledgeRelationsPanel>
      </MarkdownPane>
    </Inspector>
  );
}

function KnowledgeMarkdownBlock({ markdown, node, graph, onSelect }) {
  const source = normalizeKnowledgeMarkdownSource(markdown, node);
  const renderedSource = useMemo(() => renderKnowledgeWikilinks(source), [source]);
  const components = useMemo(() => createKnowledgeMarkdownComponents(graph, onSelect), [graph, onSelect]);
  if (!source) return <InspectorEmpty>No markdown content for this note yet.</InspectorEmpty>;
  return (
    <KnowledgeMarkdown>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {renderedSource}
      </ReactMarkdown>
    </KnowledgeMarkdown>
  );
}

function normalizeKnowledgeMarkdownText(markdown) {
  return String(markdown || "")
    .replace(/\r\n/g, "\n")
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, " ")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .trim();
}

function compactKnowledgeHeading(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripRedundantKnowledgeTitle(source, node) {
  const lines = source.split(/\n/);
  const firstContentIndex = lines.findIndex((line) => line.trim());
  if (firstContentIndex < 0) return "";
  const firstLine = lines[firstContentIndex].trim();
  const heading = firstLine.match(/^#\s+(.+)$/);
  if (!heading) return source;

  const headingText = compactKnowledgeHeading(heading[1]);
  const titleCandidates = [
    node?.title,
    node?.display_title,
    node?.displayTitle,
    node?.summary && headingText.includes("knowledge root") ? "project knowledge root" : "",
  ].map(compactKnowledgeHeading).filter(Boolean);
  const redundant = !titleCandidates.length
    || titleCandidates.some((candidate) => candidate === headingText || headingText.includes(candidate));
  if (!redundant) return source;

  const nextLines = [...lines.slice(0, firstContentIndex), ...lines.slice(firstContentIndex + 1)];
  while (nextLines[0]?.trim() === "") nextLines.shift();
  return nextLines.join("\n").trim();
}

function normalizeKnowledgeMarkdownSource(markdown, node = null) {
  const source = normalizeKnowledgeMarkdownText(markdown);
  if (!source) return "";
  return stripRedundantKnowledgeTitle(source, node);
}

function knowledgeWordCount(markdown) {
  const plainText = text(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/[#*_~>\-[\]()`]/g, " ");
  return (plainText.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)?/g) || []).length;
}

function knowledgeKeywordsFor(node) {
  const pathRefs = Array.isArray(node?.path_refs) ? node.path_refs : [];
  const pathRefText = pathRefs
    .map((ref) => text(ref?.path || ref?.title || ref?.evidence_key || ref?.evidenceKey || ref))
    .filter(Boolean);
  const raw = [
    node?.display_title,
    node?.displayTitle,
    node?.title,
    node?.note_path,
    node?.summary,
    ...pathRefText,
  ].join(" ");
  return new Set(
    raw
      .toLowerCase()
      .replace(/[`"'()[\]{}.,:;/\\_-]/g, " ")
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length >= 4),
  );
}

function suggestedKnowledgeNodes(graph, node, relations) {
  const relationIds = new Set([
    node?.id,
    ...(relations?.outbound || []).map((item) => item.node?.id),
    ...(relations?.backlinks || []).map((item) => item.node?.id),
  ].filter(Boolean));
  const activeKeywords = knowledgeKeywordsFor(node);
  if (!activeKeywords.size) return [];
  return (graph?.nodes || [])
    .filter((candidate) => !relationIds.has(candidate.id) && candidate.knowledge_node_type !== "repo_root")
    .map((candidate) => {
      const candidateKeywords = knowledgeKeywordsFor(candidate);
      let score = 0;
      candidateKeywords.forEach((keyword) => {
        if (activeKeywords.has(keyword)) score += 1;
      });
      return { edge: { id: `suggested-${node.id}-${candidate.id}`, kind: "suggested", metadata: { score } }, node: candidate, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || text(left.node.title).localeCompare(text(right.node.title)))
    .slice(0, 5);
}

function KnowledgeRelationSection({ title, items, empty, onSelect, suggested = false }) {
  const visibleItems = Array.isArray(items) ? items : [];
  return (
    <KnowledgeRelationGroup>
      <h3>{title} <span>{visibleItems.length}</span></h3>
      {visibleItems.length ? (
        <KnowledgeRelationList>
          {visibleItems.map(({ edge, node }, index) => (
            <li key={`${edge.id}-${node.id}-${index}`}>
              <KnowledgeRelationButton type="button" onClick={() => onSelect?.(node.id)}>
                <span>{text(node.display_title || node.displayTitle || node.title, "Knowledge note")}</span>
                <small>
                  {suggested
                    ? suggestedKeywordsForDisplay(node).join(" · ")
                    : text(node.note_path || node.path || node.markdown_path)}
                </small>
              </KnowledgeRelationButton>
            </li>
          ))}
        </KnowledgeRelationList>
      ) : (
        <KnowledgeRelationEmpty>{empty}</KnowledgeRelationEmpty>
      )}
    </KnowledgeRelationGroup>
  );
}

function suggestedKeywordsForDisplay(node) {
  const pathRefs = Array.isArray(node?.path_refs) ? node.path_refs : [];
  const pathRefText = pathRefs
    .map((ref) => text(ref?.path || ref?.title || ref?.evidence_key || ref?.evidenceKey || ref))
    .flatMap((value) => value.split(/[\\/._-]+/))
    .filter((part) => part.length >= 4);
  const fallback = text(node.note_path || node.path || node.title)
    .split(/[\\/._-]+/)
    .filter((part) => part.length >= 4);
  return [...pathRefText, ...fallback].slice(0, 4);
}

function KnowledgeLinkSection({ title, items, empty }) {
  const visibleItems = Array.isArray(items) ? items : [];
  return (
    <KnowledgeSection>
      <h3>{title}</h3>
      {visibleItems.length ? (
        <KnowledgeMiniList>
          {visibleItems.map(({ edge, node }, index) => (
            <li key={`${edge.id}-${node.id}-${index}`}>
              <span>{node.display_title || node.title}</span>
              <small>{edge.kind || "links_to"} · {node.note_path}</small>
            </li>
          ))}
        </KnowledgeMiniList>
      ) : (
        <SpecObjectsEmpty>{empty}</SpecObjectsEmpty>
      )}
    </KnowledgeSection>
  );
}

function KnowledgePathSection({ paths }) {
  const visiblePaths = Array.isArray(paths) ? paths : [];
  return (
    <KnowledgeSection>
      <h3>Related Paths</h3>
      {visiblePaths.length ? (
        <KnowledgePathList>
          {visiblePaths.map((pathRef, index) => {
            const path = text(field(pathRef, "path"), "unknown path");
            const exists = field(pathRef, "exists") !== false;
            return (
              <li key={`${path}-${index}`} data-missing={exists ? "false" : "true"}>
                <span>{path}</span>
                <small>{text(field(pathRef, "kind"), exists ? "path" : "missing")}</small>
              </li>
            );
          })}
        </KnowledgePathList>
      ) : (
        <SpecObjectsEmpty>No file or folder anchors recorded.</SpecObjectsEmpty>
      )}
    </KnowledgeSection>
  );
}

function KnowledgeStatsSection({ graph }) {
  const stats = graph?.graphStats || {};
  return (
    <KnowledgeSection>
      <h3>Atlas Stats</h3>
      <KnowledgeStatsGrid>
        <span><strong>{graph?.nodes?.length || 0}</strong> notes</span>
        <span><strong>{graph?.edges?.length || 0}</strong> links</span>
        <span><strong>{Number(stats.flow_notes || 0)}</strong> flows</span>
        <span><strong>{Number(stats.area_notes || 0)}</strong> areas</span>
      </KnowledgeStatsGrid>
    </KnowledgeSection>
  );
}

function TaskHistoryMain({ tasks, selectedTaskId, selectedNodeId, onSelectTask, onSelectNode }) {
  const visibleTasks = Array.isArray(tasks) ? tasks : [];
  if (!visibleTasks.length) {
    return (
      <HistoryMain>
        <HistoryEmpty>No task history recorded yet.</HistoryEmpty>
      </HistoryMain>
    );
  }

  return (
    <HistoryMain>
      <HistoryTimeline>
        {visibleTasks.map((task, index) => {
          const active = task.task_id === selectedTaskId;
          const nodes = Array.isArray(task.nodes) ? task.nodes : [];
          const rolledBack = task.rollback_state === "rolled_back";
          const statusLabel = rolledBack ? "rolled back" : text(task.status, "unknown");
          const statusState = rolledBack ? "rolled_back" : text(task.status, "unknown");
          const codingAgent = formatCodingAgent(task.coding_agent || task.agent_kind);
          const originalPrompt = text(task.original_prompt || task.prompt || task.start_task_plan, "No original prompt captured.");
          const arbiterStatus = text(task.arbiter_status);
          const delta = computeGraphDelta(task);
          const isLast = index === visibleTasks.length - 1;
          return (
            <HistoryTimelineRow key={task.task_id || index}>
              <TimelineRail data-state={statusState} data-last={isLast ? "true" : "false"}>
                <TimelineDot data-state={statusState} />
              </TimelineRail>
              <HistoryTaskCard
                data-active={active ? "true" : "false"}
                data-rolled-back={rolledBack ? "true" : "false"}
              >
                <HistoryTaskButton type="button" onClick={() => onSelectTask(task.task_id)}>
                  <HistoryTaskTopRow>
                    <HistoryTaskIndex>#{index + 1}</HistoryTaskIndex>
                    <HistoryTaskTitle>{text(task.title, "Untitled task")}</HistoryTaskTitle>
                    <HistoryStatusPill data-state={statusState}>{statusLabel}</HistoryStatusPill>
                  </HistoryTaskTopRow>
                  <HistoryTaskPrompt>{originalPrompt}</HistoryTaskPrompt>
                  <HistoryDeltaStrip>
                    <DeltaChip data-kind="node" data-empty={delta.createdNodes.length === 0 ? "true" : "false"}>
                      <NodeGlyph $created={delta.createdNodes.length > 0} />
                      <span>{delta.createdNodes.length} nodes</span>
                    </DeltaChip>
                    {delta.removedNodes.length > 0 && (
                      <DeltaChip data-kind="node-rm">
                        <NodeGlyph $removed />
                        <span>{"−"}{delta.removedNodes.length}</span>
                      </DeltaChip>
                    )}
                    <DeltaChip data-kind="edge" data-empty={delta.createdEdges.length === 0 ? "true" : "false"}>
                      <EdgeGlyph $created={delta.createdEdges.length > 0} />
                      <span>{delta.createdEdges.length} edges</span>
                    </DeltaChip>
                    {delta.removedEdges.length > 0 && (
                      <DeltaChip data-kind="edge-rm">
                        <EdgeGlyph $removed />
                        <span>{"−"}{delta.removedEdges.length}</span>
                      </DeltaChip>
                    )}
                    <DeltaChip data-kind="specs">
                      <SpecGlyph />
                      <span>{task.mutation_count || 0} specs</span>
                    </DeltaChip>
                  </HistoryDeltaStrip>
                  <HistoryTaskFoot>
                    {codingAgent && <FootBadge data-state="agent">{codingAgent}</FootBadge>}
                    {arbiterStatus && <FootBadge data-state={arbiterStatus}>arbiter {arbiterStatus}</FootBadge>}
                    {task.arbiter_decision_count ? (
                      <FootBadge>{task.arbiter_decision_count} arbiter decisions</FootBadge>
                    ) : null}
                    <FootBadge data-kind="muted">{shortTaskId(task.task_id)}</FootBadge>
                    <FootTime>{formatHistoryTime(task.first_mutation_at)}</FootTime>
                  </HistoryTaskFoot>
                </HistoryTaskButton>
                {active && (
                  <HistoryNodeList>
                    {nodes.length ? nodes.map((node) => {
                      const created = nodeWasCreated(node);
                      return (
                        <HistoryNodeButton
                          key={node.node_id}
                          type="button"
                          data-active={node.node_id === selectedNodeId ? "true" : "false"}
                          data-created={created ? "true" : "false"}
                          onClick={() => onSelectNode(node.node_id)}
                        >
                          <NodeButtonGlyph>
                            <NodeGlyph $created={created} $existing={!created} />
                          </NodeButtonGlyph>
                          <NodeButtonBody>
                            <NodeButtonKicker>
                              <span data-kind={created ? "created" : "touched"}>{created ? "created" : "touched"}</span>
                              <small>{node.node_type || "node"}</small>
                            </NodeButtonKicker>
                            <strong>{text(node.path || node.title, node.node_id)}</strong>
                            <small>{node.spec_changes.length} spec changes · {node.structural_changes.length} structural</small>
                          </NodeButtonBody>
                        </HistoryNodeButton>
                      );
                    }) : (
                      <HistoryNodeEmpty>No node-level mutations captured.</HistoryNodeEmpty>
                    )}
                  </HistoryNodeList>
                )}
              </HistoryTaskCard>
            </HistoryTimelineRow>
          );
        })}
      </HistoryTimeline>
    </HistoryMain>
  );
}

function TaskHistoryInspector({ task, node }) {
  if (!task) {
    return (
      <Inspector>
        <InspectorEmpty>Select a task run.</InspectorEmpty>
      </Inspector>
    );
  }
  const specChanges = Array.isArray(node?.spec_changes) ? node.spec_changes : [];
  const structuralChanges = Array.isArray(node?.structural_changes) ? node.structural_changes : [];
  const codingAgent = formatCodingAgent(task.coding_agent || task.agent_kind);
  const originalPrompt = text(task.original_prompt || task.prompt || task.start_task_plan, "No original prompt captured.");
  const startPlan = text(task.start_task_plan);
  const arbiterDecisions = Array.isArray(task.arbiter_decisions) ? task.arbiter_decisions : [];
  const delta = computeGraphDelta(task);

  return (
    <Inspector>
      <InspectorHeader>
        <h2>{node ? text(node.path || node.title, node.node_id) : text(task.title, task.task_id)}</h2>
        <InspectorFacts>
          <span data-state={task.rollback_state === "rolled_back" ? "out_of_spec" : task.status}>
            {task.rollback_state === "rolled_back" ? "rolled back" : task.status}
          </span>
          <span>{shortTaskId(task.task_id)}</span>
          <span>{task.mutation_count} changes</span>
        </InspectorFacts>
      </InspectorHeader>
      <MarkdownPane>
        <GraphDeltaPanel delta={delta} />
        <HistoryDetailsSection>
          <h3>Task</h3>
          <HistoryDetailCard data-rolled-back={task.rollback_state === "rolled_back" ? "true" : "false"}>
            <p>{originalPrompt}</p>
            {startPlan && startPlan !== originalPrompt && (
              <HistoryTaskPlan>Start task plan: {startPlan}</HistoryTaskPlan>
            )}
            <small>{text(codingAgent, "unknown agent")} · {text(task.agent_id, "unknown agent id")} · {formatHistoryTime(task.first_mutation_at)}</small>
          </HistoryDetailCard>
        </HistoryDetailsSection>
        <HistoryArbiterList decisions={arbiterDecisions} />
        <HistoryMutationList title="Spec Object Changes" changes={specChanges} empty="No spec objects changed for this node." />
        <HistoryMutationList title="Node / Edge Changes" changes={structuralChanges} empty="No structural changes for this node." />
      </MarkdownPane>
    </Inspector>
  );
}

function HistoryArbiterList({ decisions }) {
  const visibleDecisions = Array.isArray(decisions) ? decisions : [];
  return (
    <HistoryDetailsSection>
      <h3>Spec Arbiter</h3>
      {visibleDecisions.length ? visibleDecisions.map((decision) => (
        <HistoryMutationCard key={decision.id} data-action={decision.status}>
          <HistoryMutationHeading>
            <span>{text(decision.status, "unknown")}</span>
            <small>{text(decision.provider, "unknown provider")}</small>
          </HistoryMutationHeading>
          {(decision.scope || decision.operation || decision.target_path) && (
            <HistoryStatement>
              <span>Decision</span>
              <p>{[decision.operation, decision.scope, decision.target_path].filter(Boolean).join(" · ")}</p>
            </HistoryStatement>
          )}
          {decision.statement && (
            <HistoryStatement>
              <span>Statement</span>
              <p>{decision.statement}</p>
            </HistoryStatement>
          )}
          {decision.reason && <p>{decision.reason}</p>}
        </HistoryMutationCard>
      )) : (
        <SpecObjectsEmpty>No arbiter decisions captured for this task.</SpecObjectsEmpty>
      )}
    </HistoryDetailsSection>
  );
}

function HistoryMutationList({ title, changes, empty }) {
  const visibleChanges = Array.isArray(changes) ? changes : [];
  return (
    <HistoryDetailsSection>
      <h3>{title}</h3>
      {visibleChanges.length ? visibleChanges.map((change) => (
        <HistoryMutationCard key={change.id} data-action={change.action}>
          <HistoryMutationHeading>
            <span>{change.action}</span>
            <small>{change.rollback_state === "rolled_back" ? "rolled back" : change.mutation_kind}</small>
          </HistoryMutationHeading>
          {change.before_statement && (
            <HistoryStatement $before>
              <span>Before</span>
              <p>{change.before_statement}</p>
            </HistoryStatement>
          )}
          {change.after_statement && (
            <HistoryStatement>
              <span>After</span>
              <p>{change.after_statement}</p>
            </HistoryStatement>
          )}
          {!change.before_statement && !change.after_statement && (
            <p>{text(change.summary, change.entity_id)}</p>
          )}
        </HistoryMutationCard>
      )) : (
        <SpecObjectsEmpty>{empty}</SpecObjectsEmpty>
      )}
    </HistoryDetailsSection>
  );
}

function shortTaskId(taskId) {
  const value = text(taskId);
  if (!value) return "no task";
  return value.length > 10 ? `${value.slice(0, 8)}...` : value;
}

function formatCodingAgent(value) {
  const agent = text(value).toLowerCase();
  if (!agent) return "";
  if (agent.includes("claude")) return "Claude";
  if (agent.includes("opencode") || agent.includes("open-code") || agent.includes("open_code")) return "OpenCode";
  if (agent.includes("codex")) return "Codex";
  return agent;
}

function formatHistoryTime(value) {
  const textValue = text(value);
  if (!textValue) return "no timestamp";
  const date = new Date(textValue);
  if (Number.isNaN(date.getTime())) return textValue;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isEdgeEntity(change) {
  return /edge/i.test(text(change?.entity_type));
}

function isCreateAction(change) {
  return /^(added|created|restored|inserted)$/i.test(text(change?.action));
}

function isRemoveAction(change) {
  return /^(removed|abrogated|deleted)$/i.test(text(change?.action));
}

function computeGraphDelta(task) {
  const empty = { createdNodes: [], removedNodes: [], createdEdges: [], removedEdges: [] };
  if (!task) return empty;
  const taskNodes = Array.isArray(task.nodes) ? task.nodes : [];
  const createdNodes = [];
  const removedNodes = [];
  const createdEdges = [];
  const removedEdges = [];
  for (const taskNode of taskNodes) {
    const structural = Array.isArray(taskNode.structural_changes) ? taskNode.structural_changes : [];
    for (const change of structural) {
      const enriched = { ...change, _node: taskNode };
      if (isEdgeEntity(change)) {
        if (isCreateAction(change)) createdEdges.push(enriched);
        else if (isRemoveAction(change)) removedEdges.push(enriched);
      } else {
        if (isCreateAction(change)) createdNodes.push(enriched);
        else if (isRemoveAction(change)) removedNodes.push(enriched);
      }
    }
  }
  return { createdNodes, removedNodes, createdEdges, removedEdges };
}

function nodeWasCreated(taskNode) {
  const changes = Array.isArray(taskNode?.structural_changes) ? taskNode.structural_changes : [];
  return changes.some((change) => !isEdgeEntity(change) && isCreateAction(change));
}

function nodeChangeLabel(change) {
  return text(
    change?._node?.path
      || change?._node?.title
      || change?.entity_id
      || change?.after_statement
      || change?.summary,
    "node",
  );
}

function edgeChangeLabel(change) {
  return text(
    change?.summary
      || change?.after_statement
      || change?.before_statement
      || change?.entity_id,
    "edge",
  );
}

function NodeGlyph({ $created, $existing, $removed }) {
  const stroke = $removed
    ? "#b9876d"
    : $created
      ? "#8aa892"
      : "rgba(139, 151, 166, 0.76)";
  const fill = $created
    ? "rgba(138, 168, 146, 0.12)"
    : $removed
      ? "rgba(185, 135, 109, 0.12)"
      : "transparent";
  const dash = $existing ? "2 1.6" : undefined;
  return (
    <Glyph viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
      <circle cx="7" cy="7" r="4.6" fill={fill} stroke={stroke} strokeWidth="1.4" strokeDasharray={dash} />
      {$removed && <line x1="3.6" y1="3.6" x2="10.4" y2="10.4" stroke={stroke} strokeWidth="1.3" />}
    </Glyph>
  );
}

function EdgeGlyph({ $created, $removed }) {
  const stroke = $removed
    ? "#b9876d"
    : $created
      ? "#8aa892"
      : "rgba(139, 151, 166, 0.76)";
  const fill = $created
    ? "rgba(138, 168, 146, 0.12)"
    : $removed
      ? "rgba(185, 135, 109, 0.12)"
      : "transparent";
  const dash = $removed ? "1.8 1.8" : undefined;
  return (
    <Glyph viewBox="0 0 22 12" width="22" height="12" aria-hidden="true">
      <circle cx="3.2" cy="6" r="2.4" fill={fill} stroke={stroke} strokeWidth="1.3" />
      <circle cx="18.8" cy="6" r="2.4" fill={fill} stroke={stroke} strokeWidth="1.3" />
      <line x1="5.7" y1="6" x2="16.3" y2="6" stroke={stroke} strokeWidth="1.4" strokeDasharray={dash} />
    </Glyph>
  );
}

function SpecGlyph() {
  return (
    <Glyph viewBox="0 0 14 14" width="13" height="13" aria-hidden="true">
      <rect x="2.4" y="2.2" width="9.2" height="9.6" rx="1.6" fill="transparent" stroke="rgba(136, 165, 200, 0.78)" strokeWidth="1.3" />
      <line x1="4.2" y1="5.8" x2="9.8" y2="5.8" stroke="rgba(136, 165, 200, 0.78)" strokeWidth="1.1" />
      <line x1="4.2" y1="8.4" x2="7.8" y2="8.4" stroke="rgba(136, 165, 200, 0.78)" strokeWidth="1.1" />
    </Glyph>
  );
}

function GraphDeltaPanel({ delta }) {
  const { createdNodes, removedNodes, createdEdges, removedEdges } = delta;
  const total = createdNodes.length + removedNodes.length + createdEdges.length + removedEdges.length;
  return (
    <HistoryDetailsSection>
      <h3>Graph Delta</h3>
      {total === 0 ? (
        <SpecObjectsEmpty>No nodes or edges were added or removed by this task.</SpecObjectsEmpty>
      ) : (
        <GraphDeltaGrid>
          <GraphDeltaColumn>
            <GraphDeltaHeading>
              <NodeGlyph $created />
              <span>Nodes</span>
              <DeltaCount>
                <em data-tone="added">+{createdNodes.length}</em>
                {removedNodes.length > 0 && <em data-tone="removed">{"−"}{removedNodes.length}</em>}
              </DeltaCount>
            </GraphDeltaHeading>
            <GraphDeltaList>
              {createdNodes.map((change) => (
                <GraphDeltaPill key={change.id} data-action="added">
                  <NodeGlyph $created />
                  <span>{nodeChangeLabel(change)}</span>
                </GraphDeltaPill>
              ))}
              {removedNodes.map((change) => (
                <GraphDeltaPill key={change.id} data-action="removed">
                  <NodeGlyph $removed />
                  <span>{nodeChangeLabel(change)}</span>
                </GraphDeltaPill>
              ))}
              {!createdNodes.length && !removedNodes.length && (
                <GraphDeltaEmpty>No nodes added or removed.</GraphDeltaEmpty>
              )}
            </GraphDeltaList>
          </GraphDeltaColumn>
          <GraphDeltaColumn>
            <GraphDeltaHeading>
              <EdgeGlyph $created />
              <span>Edges</span>
              <DeltaCount>
                <em data-tone="added">+{createdEdges.length}</em>
                {removedEdges.length > 0 && <em data-tone="removed">{"−"}{removedEdges.length}</em>}
              </DeltaCount>
            </GraphDeltaHeading>
            <GraphDeltaList>
              {createdEdges.map((change) => (
                <GraphDeltaPill key={change.id} data-action="added">
                  <EdgeGlyph $created />
                  <span>{edgeChangeLabel(change)}</span>
                </GraphDeltaPill>
              ))}
              {removedEdges.map((change) => (
                <GraphDeltaPill key={change.id} data-action="removed">
                  <EdgeGlyph $removed />
                  <span>{edgeChangeLabel(change)}</span>
                </GraphDeltaPill>
              ))}
              {!createdEdges.length && !removedEdges.length && (
                <GraphDeltaEmpty>No edges added or removed.</GraphDeltaEmpty>
              )}
            </GraphDeltaList>
          </GraphDeltaColumn>
        </GraphDeltaGrid>
      )}
    </HistoryDetailsSection>
  );
}

function specEditOperationLabel(operation) {
  switch (operation) {
    case "add":
      return "Add spec";
    case "delete":
      return "Delete spec";
    case "edit":
    default:
      return "Edit spec";
  }
}

function SpecEditDialog({
  agents,
  disabledReason,
  draft,
  node,
  onChange,
  onClose,
  onSubmit,
  status,
}) {
  const visibleAgents = Array.isArray(agents) ? agents : [];
  const operationLabel = specEditOperationLabel(draft.operation);
  const submitDisabled = Boolean(disabledReason)
    || status.state === "submitting"
    || !visibleAgents.length
    || !draft.terminalKey
    || (draft.operation !== "delete" && !text(draft.desiredStatement) && !text(draft.userInstruction));
  const nodeTitle = text(node?.display_title || node?.displayTitle || node?.title, "Spec node");

  return (
    <SpecEditOverlay role="presentation">
      <SpecEditModal role="dialog" aria-modal="true" aria-label={operationLabel}>
        <SpecEditModalHeader>
          <SpecEditModalTitle>
            <span>{operationLabel}</span>
            <strong>{nodeTitle}</strong>
          </SpecEditModalTitle>
          <SpecEditCloseButton type="button" aria-label="Close" onClick={onClose}>
            <CloseSpecIcon aria-hidden="true" />
          </SpecEditCloseButton>
        </SpecEditModalHeader>
        <SpecEditForm onSubmit={onSubmit}>
          <SpecEditField>
            <label htmlFor="spec-edit-agent">Agent</label>
            <SpecEditSelect
              id="spec-edit-agent"
              value={draft.terminalKey}
              onChange={(event) => onChange((current) => ({
                ...current,
                terminalKey: event.target.value,
              }))}
            >
              {visibleAgents.map((agent) => (
                <option key={agent.key} value={agent.key}>
                  {agent.label || agent.agentId} #{Number(agent.terminalIndex) + 1}
                </option>
              ))}
            </SpecEditSelect>
          </SpecEditField>
          {draft.currentStatement && (
            <SpecEditField>
              <label htmlFor="spec-edit-current">Current</label>
              <SpecEditReadonly id="spec-edit-current">{draft.currentStatement}</SpecEditReadonly>
            </SpecEditField>
          )}
          {draft.operation !== "delete" && (
            <SpecEditField>
              <label htmlFor="spec-edit-desired">Spec</label>
              <SpecEditTextarea
                id="spec-edit-desired"
                rows={4}
                value={draft.desiredStatement}
                onChange={(event) => onChange((current) => ({
                  ...current,
                  desiredStatement: event.target.value,
                }))}
              />
            </SpecEditField>
          )}
          <SpecEditField>
            <label htmlFor="spec-edit-instruction">Instruction</label>
            <SpecEditTextarea
              id="spec-edit-instruction"
              rows={3}
              value={draft.userInstruction}
              onChange={(event) => onChange((current) => ({
                ...current,
                userInstruction: event.target.value,
              }))}
            />
          </SpecEditField>
          {disabledReason && <SpecEditMessage data-state="error">{disabledReason}</SpecEditMessage>}
          {status.message && <SpecEditMessage data-state={status.state}>{status.message}</SpecEditMessage>}
          <SpecEditFooter>
            <SpecEditSecondaryButton type="button" onClick={onClose}>
              Cancel
            </SpecEditSecondaryButton>
            <SpecEditPrimaryButton type="submit" disabled={submitDisabled}>
              <SendSpecIcon aria-hidden="true" />
              <span>{status.state === "submitting" ? "Sending" : "Send"}</span>
            </SpecEditPrimaryButton>
          </SpecEditFooter>
        </SpecEditForm>
      </SpecEditModal>
    </SpecEditOverlay>
  );
}

function SpecInspector({
  editDisabledReason = "",
  node,
  onAddSpec,
  onDeleteSpec,
  onEditSpec,
}) {
  if (!node) {
    return (
      <Inspector>
        <InspectorEmpty>Select a spec node.</InspectorEmpty>
      </Inspector>
    );
  }

  const specHistory = splitSpecHistory(node.active_specs, node.superseded_specs);
  const activeAgentCount = Number(node.active_agent_count) || 0;
  const localOnly = isLocalOnlyNode(node);
  const disabledReason = localOnly
    ? "Sync this local-only node before editing specs."
    : editDisabledReason;
  const canEdit = !disabledReason;

  return (
    <Inspector>
      <InspectorHeader>
        <InspectorTitleBlock>
          <h2>{node.display_title || node.displayTitle || node.title}</h2>
          <InspectorActions>
            <InspectorIconButton
              type="button"
              aria-label="Add spec"
              title={disabledReason || "Add spec"}
              disabled={!canEdit}
              onClick={onAddSpec}
            >
              <AddSpecIcon aria-hidden="true" />
            </InspectorIconButton>
          </InspectorActions>
        </InspectorTitleBlock>
        <InspectorFacts>
          <span data-state={node.freshness_state}>{freshnessLabel(node.freshness_state)}</span>
          {isUnspecifiedStructuralNode(node) && <span data-state="no_spec">structural</span>}
          {isLocalOnlyNode(node) && <span data-state="local_only">local only</span>}
          {isLeasedFileNode(node) && <span data-state="leased">leased</span>}
          {isWorktreeFileNode(node) && <span data-state="worktree">isolated</span>}
          {(Number(node.out_of_spec_count || node.notification_count) || 0) > 0 && (
            <span data-state="out_of_spec">out of spec: {Number(node.out_of_spec_count || node.notification_count) || 0}</span>
          )}
        </InspectorFacts>
      </InspectorHeader>
      <MarkdownPane>
        <SpecObjectList
          title="Active Specs"
          specs={specHistory.active}
          empty="No active specs recorded yet."
          activeAgentCount={activeAgentCount}
          disabledReason={disabledReason}
          onDeleteSpec={onDeleteSpec}
          onEditSpec={onEditSpec}
        />
        <SpecObjectList
          title="Superseded History"
          specs={specHistory.historical}
          empty="No superseded specs yet."
          historical
        />
      </MarkdownPane>
    </Inspector>
  );
}

function SpecObjectList({
  title,
  specs,
  empty,
  historical = false,
  activeAgentCount = null,
  disabledReason = "",
  onDeleteSpec,
  onEditSpec,
}) {
  const visibleSpecs = Array.isArray(specs) ? specs : [];
  const [expandedPriorSpecs, setExpandedPriorSpecs] = useState({});
  const togglePriorSpecs = useCallback((specKey) => {
    setExpandedPriorSpecs((current) => ({
      ...current,
      [specKey]: !current[specKey],
    }));
  }, []);

  return (
    <SpecObjectsSection>
      <h3>
        <span>{title}</span>
        {activeAgentCount !== null && (
          <SpecObjectsHeadingBadge>
            {activeAgentCount} {activeAgentCount === 1 ? "agent" : "agents"}
          </SpecObjectsHeadingBadge>
        )}
      </h3>
      {visibleSpecs.length ? (
        visibleSpecs.map((spec, index) => {
          const specKey = field(spec, "id") || `${title}-${index}`;
          const priorSpecs = Array.isArray(spec.consolidated_specs) ? spec.consolidated_specs : [];
          const priorSpecsExpanded = Boolean(expandedPriorSpecs[specKey]);
          const editBlocked = Boolean(historical || disabledReason);
          return (
            <SpecObjectCard key={specKey} $historical={historical}>
              <SpecObjectCardHeader>
                <p>{text(field(spec, "statement"), "Unnamed spec")}</p>
                {!historical && (
                  <SpecObjectActions>
                    <SpecObjectIconButton
                      type="button"
                      aria-label="Edit spec"
                      title={disabledReason || "Edit spec"}
                      disabled={editBlocked}
                      onClick={() => onEditSpec?.(spec)}
                    >
                      <EditSpecIcon aria-hidden="true" />
                    </SpecObjectIconButton>
                    <SpecObjectIconButton
                      type="button"
                      aria-label="Delete spec"
                      title={disabledReason || "Delete spec"}
                      disabled={editBlocked}
                      onClick={() => onDeleteSpec?.(spec)}
                    >
                      <DeleteSpecIcon aria-hidden="true" />
                    </SpecObjectIconButton>
                  </SpecObjectActions>
                )}
              </SpecObjectCardHeader>
              {priorSpecs.length > 0 && (
                <>
                  <PriorSpecsButton
                    type="button"
                    aria-expanded={priorSpecsExpanded ? "true" : "false"}
                    $expanded={priorSpecsExpanded}
                    onClick={() => togglePriorSpecs(specKey)}
                  >
                    <PriorSpecsIcon aria-hidden="true" />
                    {priorSpecs.length} prior {priorSpecs.length === 1 ? "version" : "versions"}
                  </PriorSpecsButton>
                  {priorSpecsExpanded && (
                    <PriorSpecsList>
                      {priorSpecs.map((priorSpec, priorIndex) => (
                        <PriorSpecItem key={field(priorSpec, "id") || `${specKey}-prior-${priorIndex}`}>
                          <span>Previously</span>
                          <p>{text(field(priorSpec, "statement"), "Unnamed spec")}</p>
                          {text(field(priorSpec, "supersession_reason")) && (
                            <small>{text(field(priorSpec, "supersession_reason"))}</small>
                          )}
                        </PriorSpecItem>
                      ))}
                    </PriorSpecsList>
                  )}
                </>
              )}
              {historical && text(field(spec, "supersession_reason")) && (
                <small>Reason: {text(field(spec, "supersession_reason"))}</small>
              )}
            </SpecObjectCard>
          );
        })
      ) : (
        <SpecObjectsEmpty>{empty}</SpecObjectsEmpty>
      )}
    </SpecObjectsSection>
  );
}

const SpecGraphSurface = styled.section`
  --history-bg: #0b0f14;
  --history-panel: #0f141b;
  --history-panel-soft: #111821;
  --history-panel-muted: #0d1218;
  --history-border: rgba(139, 151, 166, 0.18);
  --history-border-strong: rgba(139, 151, 166, 0.3);
  --history-text: #d8dee8;
  --history-muted: #8b95a4;
  --history-subtle: #626d7a;
  --history-blue: #88a5c8;
  --history-green: #8aa892;
  --history-amber: #b8a06a;
  --history-orange: #b9876d;
  --history-red: #c48787;

  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 10px;
  background:
    linear-gradient(180deg, rgba(17, 24, 39, 0.95), rgba(10, 11, 14, 0.96)),
    #0a0b0e;
  color: var(--forge-text, #dbe7f7);
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;

  html[data-forge-theme="light"] & {
    --history-bg: #ffffff;
    --history-panel: #ffffff;
    --history-panel-soft: #fafafc;
    --history-panel-muted: #f5f5f7;
    --history-border: rgba(0, 0, 0, 0.08);
    --history-border-strong: rgba(0, 0, 0, 0.14);
    --history-text: #1d1d1f;
    --history-muted: #7a7a7a;
    --history-subtle: #a1a1a6;
    --history-blue: #0066cc;
    --history-green: #0a7f45;
    --history-amber: #8b5a00;
    --history-orange: #8b5a00;
    --history-red: #b42318;
    background: var(--forge-bg);
    color: var(--forge-text);
  }
`;

const SpecGraphError = styled.div`
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: 8px;
  background: rgba(127, 29, 29, 0.22);
  color: #fecaca;
  padding: 10px;

  html[data-forge-theme="light"] & {
    border-color: rgba(180, 35, 24, 0.2);
    background: rgba(180, 35, 24, 0.08);
    color: var(--history-red);
  }
`;

const SpecGraphToolbar = styled.div`
  align-items: center;
  display: flex;
  gap: 10px;
  justify-content: flex-start;
  min-height: 34px;
`;

const ViewToggleGroup = styled.div`
  align-items: center;
  border: 1px solid var(--history-border);
  border-radius: 7px;
  background: var(--history-panel-muted);
  display: inline-flex;
  gap: 1px;
  padding: 2px;
`;

const ViewToggleButton = styled.button`
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--history-muted);
  cursor: pointer;
  font-size: 11px;
  font-weight: 720;
  letter-spacing: 0.01em;
  padding: 6px 10px;
  transition: background 160ms ease, color 160ms ease;

  &[data-active="true"] {
    background: rgba(139, 151, 166, 0.12);
    color: var(--history-text);
  }
`;

const ToolbarSpacer = styled.div`
  flex: 1;
`;

const KnowledgeToolbarSummary = styled.div`
  align-items: center;
  display: flex;
  gap: 7px;
  min-width: 0;

  span {
    border: 1px solid var(--history-border);
    border-radius: 999px;
    color: var(--history-muted);
    font-size: 10px;
    font-weight: 760;
    line-height: 1;
    padding: 6px 9px;
    text-transform: uppercase;
  }

  span[data-state="ready"],
  span[data-state="fresh"],
  span[data-state="local"] {
    border-color: rgba(138, 168, 146, 0.3);
    color: var(--history-green);
  }

  span[data-state="missing"],
  span[data-state="error"] {
    border-color: rgba(185, 135, 109, 0.34);
    color: var(--history-orange);
  }
`;

const LocalIgnoredToggle = styled.button`
  background: rgba(15, 23, 42, 0.88);
  border: 1px solid rgba(148, 163, 184, 0.32);
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.84);
  cursor: pointer;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.06em;
  padding: 8px 12px;
  text-transform: uppercase;
  transition: border-color 160ms ease, color 160ms ease, transform 160ms ease;

  &[data-active="true"] {
    border-color: rgba(251, 191, 36, 0.68);
    color: #fde68a;
  }

  &:hover {
    border-color: rgba(251, 191, 36, 0.72);
    color: #fef3c7;
    transform: translateY(-1px);
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(0, 102, 204, 0.22);
    color: var(--forge-blue);
    box-shadow:
      0 1px 2px rgba(0, 0, 0, 0.045),
      inset 0 1px 0 rgba(255, 255, 255, 0.96);
  }

  html[data-forge-theme="light"] &[data-active="true"] {
    background: rgba(0, 102, 204, 0.08);
    border-color: rgba(0, 102, 204, 0.32);
    color: var(--forge-blue);
  }

  html[data-forge-theme="light"] &:hover {
    background: rgba(0, 102, 204, 0.06);
    border-color: rgba(0, 102, 204, 0.38);
    color: var(--forge-blue-soft);
  }
`;

const LocalIgnoredHint = styled.span`
  color: rgba(148, 163, 184, 0.78);
  font-size: 11px;
  font-weight: 760;

  html[data-forge-theme="light"] & {
    color: var(--forge-text-muted);
  }
`;

const SpecGraphShell = styled.div`
  align-items: stretch;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(280px, 34%);
  gap: 10px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: hidden;

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 1fr) minmax(260px, 40%);
  }
`;

const KnowledgeGraphShell = styled.div`
  align-items: stretch;
  display: grid;
  grid-template-columns: minmax(210px, 250px) minmax(0, 1fr) minmax(280px, 34%);
  gap: 10px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow: hidden;

  @media (max-width: 1100px) {
    grid-template-columns: minmax(0, 1fr) minmax(280px, 38%);
    > aside:first-child {
      display: none;
    }
  }

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 1fr) minmax(260px, 40%);
  }
`;

const SpecGraphMain = styled.main`
  border: 1px solid rgba(230, 236, 245, 0.07);
  border-radius: 8px;
  background: rgba(7, 9, 13, 0.58);
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  html[data-forge-theme="light"] & {
    border-color: var(--history-border-strong);
    background: #ffffff;
  }
`;

const HistoryMain = styled.main`
  border: 1px solid var(--history-border);
  border-radius: 8px;
  background: var(--history-bg);
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 12px;
`;

const Glyph = styled.svg`
  flex-shrink: 0;
  display: block;
`;

const HistoryTimeline = styled.div`
  display: grid;
  gap: 0;
`;

const HistoryTimelineRow = styled.div`
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: stretch;
  min-width: 0;
`;

const TimelineRail = styled.div`
  position: relative;
  width: 28px;

  &::before {
    content: "";
    position: absolute;
    left: 13px;
    top: 0;
    bottom: 0;
    width: 2px;
    background: rgba(139, 151, 166, 0.18);
    border-radius: 2px;
  }

  &[data-last="true"]::before {
    bottom: calc(100% - 26px);
  }
`;

const TimelineDot = styled.span`
  position: absolute;
  left: 8px;
  top: 18px;
  width: 12px;
  height: 12px;
  border: 1px solid var(--dot-color);
  border-radius: 999px;
  background: var(--history-bg);
  --dot-color: rgba(139, 151, 166, 0.72);

  &::after {
    content: "";
    position: absolute;
    inset: 3px;
    border-radius: 999px;
    background: var(--dot-color);
    opacity: 0.9;
  }

  &[data-state="done"],
  &[data-state="merged"],
  &[data-state="applied"],
  &[data-state="accepted"] {
    --dot-color: var(--history-green);
  }

  &[data-state="rolled_back"],
  &[data-state="interrupted"],
  &[data-state="cancelled"],
  &[data-state="rejected"] {
    --dot-color: var(--history-orange);
  }

  &[data-state="pending"] {
    --dot-color: var(--history-amber);
  }
`;

const HistoryTaskCard = styled.article`
  border: 1px solid var(--history-border);
  border-radius: 8px;
  background: var(--history-panel);
  overflow: hidden;
  margin-bottom: 10px;
  transition: border-color 160ms ease, background 160ms ease, box-shadow 160ms ease;

  &[data-active="true"] {
    border-color: var(--history-border-strong);
    background: var(--history-panel-soft);
    box-shadow: inset 2px 0 0 var(--history-blue);
  }

  &[data-rolled-back="true"]:not([data-active="true"]) {
    border-color: rgba(139, 151, 166, 0.12);
    background: rgba(13, 18, 24, 0.82);
    opacity: 0.76;
  }

  html[data-forge-theme="light"] &[data-active="true"] {
    border-color: rgba(0, 102, 204, 0.26);
    background: #ffffff;
    box-shadow: inset 2px 0 0 var(--history-blue), 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  html[data-forge-theme="light"] &[data-rolled-back="true"]:not([data-active="true"]) {
    border-color: rgba(0, 0, 0, 0.08);
    background: #fafafc;
  }
`;

const HistoryTaskButton = styled.button`
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 9px;
  padding: 12px 13px;
  text-align: left;
  width: 100%;
`;

const HistoryTaskTopRow = styled.div`
  align-items: center;
  display: flex;
  gap: 8px;
  min-width: 0;
`;

const HistoryTaskIndex = styled.span`
  color: var(--history-subtle);
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.02em;
  flex-shrink: 0;
`;

const HistoryTaskTitle = styled.strong`
  color: var(--history-text);
  font-size: 13px;
  font-weight: 720;
  line-height: 1.3;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const HistoryStatusPill = styled.span`
  align-items: center;
  border: 1px solid var(--history-border);
  border-radius: 5px;
  color: var(--history-muted);
  display: inline-flex;
  flex-shrink: 0;
  font-size: 9.5px;
  font-weight: 740;
  letter-spacing: 0.03em;
  padding: 3px 6px;
  text-transform: uppercase;

  &[data-state="done"],
  &[data-state="merged"],
  &[data-state="applied"],
  &[data-state="accepted"] {
    border-color: rgba(138, 168, 146, 0.34);
    color: var(--history-green);
    background: rgba(138, 168, 146, 0.08);
  }

  &[data-state="rolled_back"],
  &[data-state="interrupted"],
  &[data-state="cancelled"],
  &[data-state="rejected"] {
    border-color: rgba(185, 135, 109, 0.36);
    color: var(--history-orange);
    background: rgba(185, 135, 109, 0.08);
  }

  &[data-state="pending"] {
    border-color: rgba(184, 160, 106, 0.34);
    color: var(--history-amber);
  }
`;

const HistoryTaskPrompt = styled.p`
  color: var(--history-muted);
  display: -webkit-box;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1.42;
  margin: 0;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
`;

const HistoryDeltaStrip = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 6px 0 2px;
  border-top: 1px solid rgba(139, 151, 166, 0.12);
`;

const DeltaChip = styled.span`
  align-items: center;
  border: 1px solid var(--history-border);
  border-radius: 5px;
  background: var(--history-panel-muted);
  color: var(--history-text);
  display: inline-flex;
  font-size: 10.5px;
  font-weight: 640;
  gap: 5px;
  letter-spacing: 0.01em;
  padding: 3px 7px 3px 6px;

  &[data-empty="true"] {
    border-color: rgba(139, 151, 166, 0.12);
    color: var(--history-subtle);
    background: transparent;
  }

  &[data-kind="node"]:not([data-empty="true"]) {
    border-color: rgba(138, 168, 146, 0.28);
    color: var(--history-green);
  }

  &[data-kind="edge"]:not([data-empty="true"]) {
    border-color: rgba(136, 165, 200, 0.3);
    color: var(--history-blue);
  }

  &[data-kind="node-rm"],
  &[data-kind="edge-rm"] {
    border-color: rgba(185, 135, 109, 0.32);
    color: var(--history-orange);
  }

  &[data-kind="specs"] {
    border-color: rgba(136, 165, 200, 0.22);
    color: var(--history-blue);
  }
`;

const HistoryTaskFoot = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const FootBadge = styled.span`
  border: 1px solid var(--history-border);
  border-radius: 5px;
  color: var(--history-muted);
  font-size: 9.5px;
  font-weight: 680;
  letter-spacing: 0.03em;
  padding: 3px 6px;
  text-transform: uppercase;

  &[data-state="agent"] {
    border-color: rgba(136, 165, 200, 0.28);
    color: var(--history-blue);
  }

  &[data-state="accepted"],
  &[data-state="approved"],
  &[data-state="done"] {
    border-color: rgba(138, 168, 146, 0.28);
    color: var(--history-green);
  }

  &[data-state="rejected"],
  &[data-state="blocked"] {
    border-color: rgba(196, 135, 135, 0.34);
    color: var(--history-red);
  }

  &[data-kind="muted"] {
    border-color: rgba(139, 151, 166, 0.12);
    color: var(--history-subtle);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    letter-spacing: 0;
    text-transform: none;
  }
`;

const FootTime = styled.span`
  color: var(--history-subtle);
  font-size: 10px;
  font-weight: 620;
  margin-left: auto;
`;

const HistoryNodeList = styled.div`
  border-top: 1px solid rgba(139, 151, 166, 0.14);
  display: grid;
  gap: 5px;
  padding: 8px 12px 12px;
  background: rgba(8, 12, 16, 0.48);

  html[data-forge-theme="light"] & {
    border-top-color: rgba(0, 0, 0, 0.08);
    background: #f5f5f7;
  }
`;

const HistoryNodeButton = styled.button`
  align-items: center;
  border: 1px solid rgba(139, 151, 166, 0.13);
  border-radius: 6px;
  background: rgba(11, 15, 20, 0.72);
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 10px;
  grid-template-columns: 22px minmax(0, 1fr);
  padding: 8px 10px;
  text-align: left;
  transition: border-color 140ms ease, background 140ms ease;

  &:hover {
    border-color: var(--history-border-strong);
  }

  &[data-active="true"] {
    border-color: rgba(136, 165, 200, 0.38);
    background: rgba(17, 24, 33, 0.82);
  }

  &[data-created="true"] {
    box-shadow: inset 2px 0 0 var(--history-green);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.08);
    background: #ffffff;
  }

  html[data-forge-theme="light"] &:hover {
    border-color: rgba(0, 102, 204, 0.22);
    background: #fdfdff;
  }

  html[data-forge-theme="light"] &[data-active="true"] {
    border-color: rgba(0, 102, 204, 0.3);
    background: rgba(0, 102, 204, 0.06);
  }
`;

const NodeButtonGlyph = styled.span`
  align-items: center;
  display: flex;
  justify-content: center;
  width: 22px;
  height: 22px;
`;

const NodeButtonBody = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;

  strong {
    color: var(--history-text);
    font-size: 12px;
    font-weight: 700;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  small {
    color: var(--history-muted);
    font-size: 10px;
    font-weight: 560;
  }
`;

const NodeButtonKicker = styled.div`
  align-items: center;
  display: flex;
  gap: 6px;

  span {
    color: var(--history-blue);
    font-size: 9px;
    font-weight: 760;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  span[data-kind="created"] {
    color: var(--history-green);
  }

  small {
    color: var(--history-subtle);
    font-size: 9px;
    font-weight: 640;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
`;

const GraphDeltaGrid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 10px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const GraphDeltaColumn = styled.div`
  border: 1px solid var(--history-border);
  border-radius: 8px;
  background: var(--history-panel-muted);
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
`;

const GraphDeltaHeading = styled.div`
  align-items: center;
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid rgba(139, 151, 166, 0.12);
  background: rgba(17, 24, 33, 0.58);

  span {
    color: var(--history-text);
    font-size: 10.5px;
    font-weight: 760;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(0, 0, 0, 0.08);
    background: #eeeeef;
  }
`;

const DeltaCount = styled.span`
  align-items: center;
  display: inline-flex !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace !important;
  font-size: 10px !important;
  font-weight: 800 !important;
  gap: 6px;
  letter-spacing: 0 !important;
  margin-left: auto;
  text-transform: none !important;

  em {
    font-style: normal;
  }

  em[data-tone="added"] {
    color: var(--history-green);
  }

  em[data-tone="removed"] {
    color: var(--history-orange);
  }
`;

const GraphDeltaList = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 10px;
`;

const GraphDeltaPill = styled.span`
  align-items: center;
  border: 1px solid var(--history-border);
  border-radius: 5px;
  background: var(--history-panel);
  color: var(--history-text);
  display: inline-flex;
  font-size: 10.5px;
  font-weight: 720;
  gap: 6px;
  max-width: 100%;
  padding: 4px 9px 4px 7px;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 220px;
  }

  &[data-action="added"] {
    border-color: rgba(138, 168, 146, 0.28);
    color: var(--history-green);
  }

  &[data-action="removed"] {
    border-color: rgba(185, 135, 109, 0.32);
    color: var(--history-orange);
  }
`;

const GraphDeltaEmpty = styled.span`
  color: var(--history-subtle);
  font-size: 10.5px;
  font-weight: 680;
  padding: 2px 0;
`;

const HistoryEmpty = styled.div`
  color: var(--history-muted);
  font-size: 12px;
  font-weight: 600;
  padding: 16px;
`;

const HistoryNodeEmpty = styled.div`
  color: var(--history-subtle);
  font-size: 11px;
  font-weight: 560;
  padding: 10px 2px 0;
`;

const KnowledgeOutlinePanel = styled.aside`
  border: 1px solid rgba(139, 151, 166, 0.12);
  border-radius: 8px;
  background: rgba(7, 10, 15, 0.88);
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.08);
    background: #fbfbfc;
  }
`;

const KnowledgePanelHeader = styled.header`
  display: grid;
  gap: 2px;
  padding: 10px 12px 5px;

  span {
    color: rgba(226, 232, 240, 0.88);
    font-size: 12.5px;
    font-weight: 720;
    line-height: 1.2;
  }

  small {
    color: rgba(148, 163, 184, 0.7);
    font-size: 10px;
    font-weight: 620;
    line-height: 1.2;
  }

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(0, 0, 0, 0.08);
  }

  html[data-forge-theme="light"] & span {
    color: #1d1d1f;
  }

  html[data-forge-theme="light"] & small {
    color: #6e6e73;
  }
`;

const KnowledgeOutlineList = styled.div`
  display: grid;
  align-content: flex-start;
  gap: 1px;
  min-height: 0;
  overflow: auto;
  padding: 4px 6px 10px;

  &::-webkit-scrollbar {
    width: 6px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.14);
  }
`;

const KnowledgeOutlineNodeBlock = styled.div`
  display: grid;
  gap: 0;
`;

const KnowledgeOutlineRow = styled.div`
  align-items: center;
  border-radius: 5px;
  display: grid;
  gap: 1px;
  grid-template-columns: minmax(0, 1fr) 20px;
  min-width: 0;
  padding-left: ${({ $depth = 0 }) => 5 + Math.min($depth, 8) * 14}px;
  padding-right: 2px;
  transition: background 120ms ease;

  &:hover {
    background: rgba(148, 163, 184, 0.045);
  }

  &[data-active="true"] {
    background: rgba(148, 163, 184, 0.072);
  }

  html[data-forge-theme="light"] &:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  html[data-forge-theme="light"] &[data-active="true"] {
    background: rgba(0, 102, 204, 0.08);
  }
`;

const KnowledgeOutlineDisclosure = styled.button`
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: rgba(148, 163, 184, 0.72);
  cursor: pointer;
  display: inline-flex;
  height: 23px;
  justify-content: center;
  padding: 0;
  width: 20px;
  transition: background 140ms ease, border-color 140ms ease, color 140ms ease;

  svg {
    transform: rotate(-90deg);
    transition: transform 130ms ease;
  }

  &[data-expanded="true"] svg {
    transform: rotate(0deg);
  }

  &:hover:not(:disabled) {
    background: rgba(148, 163, 184, 0.1);
    color: rgba(226, 232, 240, 0.92);
  }

  &:disabled {
    cursor: default;
    opacity: 0;
  }

  html[data-forge-theme="light"] & {
    color: #7a7a7a;
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    background: rgba(0, 0, 0, 0.06);
    color: #1d1d1f;
  }

  @media (prefers-reduced-motion: reduce) {
    svg {
      transition: none;
    }
  }
`;

const KnowledgeOutlineButton = styled.button`
  align-items: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: grid;
  min-width: 0;
  padding: 4px 5px 4px 4px;
  text-align: left;
  transition: color 140ms ease;

  &:hover {
    color: rgba(248, 250, 252, 0.96);
  }

  html[data-forge-theme="light"] &:hover {
    color: #1d1d1f;
  }
`;

const KnowledgeOutlineText = styled.span`
  display: grid;
  min-width: 0;

  span {
    color: rgba(226, 232, 240, 0.86);
    font-size: 11px;
    font-weight: 590;
    line-height: 1.25;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & span {
    color: #242428;
  }

  @media (min-width: 1600px) and (min-height: 820px) {
    span {
      font-size: 11.5px;
    }
  }

  @media (min-width: 1920px) and (min-height: 980px) {
    span {
      font-size: 12px;
    }
  }
`;

const KnowledgeDisclosureIcon = styled(ExpandMore)`
  height: 16px;
  width: 16px;
`;

const KnowledgeOutlineChildren = styled.div`
  display: grid;
  grid-template-rows: 0fr;
  min-width: 0;
  opacity: 0;
  overflow: hidden;
  pointer-events: none;
  position: relative;
  transform: translateY(-2px);
  visibility: hidden;
  transition:
    grid-template-rows 180ms cubic-bezier(0.16, 1, 0.3, 1),
    opacity 140ms ease,
    transform 180ms cubic-bezier(0.16, 1, 0.3, 1),
    visibility 0s linear 180ms;

  &[data-expanded="true"] {
    grid-template-rows: 1fr;
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
    visibility: visible;
    transition:
      grid-template-rows 190ms cubic-bezier(0.16, 1, 0.3, 1),
      opacity 150ms ease,
      transform 190ms cubic-bezier(0.16, 1, 0.3, 1),
      visibility 0s linear 0s;
  }

  &::before {
    background: rgba(148, 163, 184, 0.16);
    border-radius: 999px;
    bottom: 4px;
    content: "";
    left: ${({ $depth = 0 }) => 16 + Math.min($depth, 8) * 14}px;
    opacity: 0;
    position: absolute;
    top: 1px;
    transition: opacity 150ms ease;
    width: 1px;
  }

  &[data-expanded="true"]::before {
    opacity: 1;
    transition-delay: 40ms;
  }

  html[data-forge-theme="light"] &::before {
    background: rgba(0, 0, 0, 0.12);
  }

  @media (prefers-reduced-motion: reduce) {
    transition: none;
    transform: none;

    &::before {
      transition: none;
    }
  }
`;

const KnowledgeOutlineChildrenInner = styled.div`
  display: grid;
  gap: 1px;
  min-height: 0;
  overflow: hidden;
`;

const KnowledgeOutlineEmpty = styled.div`
  color: var(--history-muted);
  font-size: 12px;
  font-weight: 620;
  padding: 14px;
`;

const Inspector = styled.aside`
  border: 1px solid var(--history-border);
  border-radius: 8px;
  background: var(--history-bg);
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  html[data-forge-theme="light"] & {
    border-color: var(--history-border-strong);
    background: #ffffff;
  }
`;

const InspectorHeader = styled.header`
  align-items: flex-start;
  border-bottom: 1px solid var(--history-border);
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 11px 12px;

  h2 {
    color: var(--history-text);
    font-size: 14px;
    font-weight: 720;
    line-height: 1.24;
    margin: 0;
    min-width: 0;
  }
`;

const InspectorFacts = styled.div`
  align-items: flex-end;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 5px;

  span {
    border: 1px solid var(--history-border);
    border-radius: 5px;
    color: var(--history-muted);
    font-size: 10px;
    font-weight: 680;
    line-height: 1;
    padding: 5px 8px;
    text-transform: lowercase;
  }

  span[data-state="updated"] {
    border-color: rgba(138, 168, 146, 0.3);
    color: var(--history-green);
  }

  span[data-state="behind_code"] {
    border-color: rgba(196, 135, 135, 0.3);
    color: var(--history-red);
  }

  span[data-state="ahead_of_code"] {
    border-color: rgba(184, 160, 106, 0.3);
    color: var(--history-amber);
  }

  span[data-state="no_spec"] {
    border-color: rgba(139, 151, 166, 0.24);
    color: var(--history-muted);
  }

  span[data-state="out_of_spec"] {
    border-color: rgba(185, 135, 109, 0.34);
    color: var(--history-orange);
  }

  span[data-state="worktree"] {
    border-color: rgba(136, 165, 200, 0.36);
    color: var(--history-blue);
  }

  span[data-state="local_only"],
  span[data-state="leased"] {
    border-color: rgba(139, 90, 0, 0.26);
    color: var(--history-amber);
  }
`;

const InspectorTitleBlock = styled.div`
  align-items: flex-start;
  display: flex;
  gap: 8px;
  min-width: 0;
`;

const InspectorActions = styled.div`
  align-items: center;
  display: inline-flex;
  flex-shrink: 0;
  gap: 5px;
`;

const InspectorIconButton = styled.button`
  align-items: center;
  border: 1px solid rgba(52, 211, 153, 0.22);
  border-radius: 6px;
  background: rgba(6, 78, 59, 0.16);
  color: rgba(167, 243, 208, 0.9);
  cursor: pointer;
  display: inline-flex;
  height: 28px;
  justify-content: center;
  padding: 0;
  width: 28px;

  &:hover:not(:disabled) {
    border-color: rgba(52, 211, 153, 0.42);
    background: rgba(6, 78, 59, 0.28);
    color: #d1fae5;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(10, 127, 69, 0.22);
    background: rgba(10, 127, 69, 0.08);
    color: var(--history-green);
  }
`;

const AddSpecIcon = styled(Add)`
  height: 15px;
  width: 15px;
`;

const EditSpecIcon = styled(Edit)`
  height: 13px;
  width: 13px;
`;

const DeleteSpecIcon = styled(DeleteOutline)`
  height: 14px;
  width: 14px;
`;

const SendSpecIcon = styled(Send)`
  height: 15px;
  width: 15px;
`;

const CloseSpecIcon = styled(Close)`
  height: 15px;
  width: 15px;
`;

const SpecEditOverlay = styled.div`
  align-items: center;
  background: rgba(2, 6, 12, 0.58);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 24px;
  position: absolute;
  z-index: 20;
`;

const SpecEditModal = styled.div`
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  background: #0b111b;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.32);
  color: var(--history-text);
  display: flex;
  flex-direction: column;
  max-height: min(720px, calc(100% - 16px));
  max-width: min(620px, calc(100% - 16px));
  min-width: min(520px, calc(100% - 16px));
  overflow: hidden;

  html[data-forge-theme="light"] & {
    background: #ffffff;
    border-color: rgba(29, 29, 31, 0.12);
  }
`;

const SpecEditModalHeader = styled.header`
  align-items: center;
  border-bottom: 1px solid var(--history-border);
  display: flex;
  gap: 12px;
  justify-content: space-between;
  padding: 14px 16px;
`;

const SpecEditModalTitle = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;

  span {
    color: var(--history-green);
    font-size: 11px;
    font-weight: 760;
    letter-spacing: 0.04em;
    line-height: 1;
    text-transform: uppercase;
  }

  strong {
    color: var(--history-text);
    font-size: 15px;
    font-weight: 720;
    line-height: 1.22;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const SpecEditCloseButton = styled.button`
  align-items: center;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  background: transparent;
  color: var(--history-muted);
  cursor: pointer;
  display: inline-flex;
  font-size: 14px;
  font-weight: 760;
  height: 28px;
  justify-content: center;
  line-height: 1;
  padding: 0;
  width: 28px;

  &:hover {
    border-color: rgba(148, 163, 184, 0.32);
    color: var(--history-text);
  }
`;

const SpecEditForm = styled.form`
  display: grid;
  gap: 12px;
  overflow: auto;
  padding: 14px 16px 16px;
`;

const SpecEditField = styled.div`
  display: grid;
  gap: 6px;

  label {
    color: var(--history-muted);
    font-size: 10px;
    font-weight: 760;
    letter-spacing: 0.05em;
    line-height: 1;
    text-transform: uppercase;
  }
`;

const SpecEditSelect = styled.select`
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.74);
  color: var(--history-text);
  font: inherit;
  font-size: 12px;
  height: 36px;
  outline: none;
  padding: 0 10px;

  &:focus {
    border-color: rgba(52, 211, 153, 0.48);
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }
`;

const SpecEditTextarea = styled.textarea`
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.74);
  color: var(--history-text);
  font: inherit;
  font-size: 12px;
  line-height: 1.45;
  min-height: 92px;
  outline: none;
  padding: 9px 10px;
  resize: vertical;

  &:focus {
    border-color: rgba(52, 211, 153, 0.48);
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }
`;

const SpecEditReadonly = styled.div`
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.45);
  color: rgba(229, 236, 246, 0.76);
  font-size: 12px;
  font-weight: 560;
  line-height: 1.45;
  max-height: 120px;
  overflow: auto;
  padding: 9px 10px;

  html[data-forge-theme="light"] & {
    background: #f7f9fc;
    color: var(--history-text);
  }
`;

const SpecEditMessage = styled.div`
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 7px;
  color: var(--history-muted);
  font-size: 11px;
  font-weight: 650;
  line-height: 1.35;
  padding: 8px 10px;

  &[data-state="error"] {
    border-color: rgba(196, 135, 135, 0.32);
    color: var(--history-red);
  }

  &[data-state="sent"] {
    border-color: rgba(52, 211, 153, 0.28);
    color: var(--history-green);
  }
`;

const SpecEditFooter = styled.footer`
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
`;

const SpecEditSecondaryButton = styled.button`
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 7px;
  background: transparent;
  color: var(--history-muted);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  height: 34px;
  padding: 0 12px;

  &:hover {
    color: var(--history-text);
  }
`;

const SpecEditPrimaryButton = styled.button`
  align-items: center;
  border: 1px solid rgba(52, 211, 153, 0.3);
  border-radius: 7px;
  background: rgba(6, 78, 59, 0.34);
  color: #d1fae5;
  cursor: pointer;
  display: inline-flex;
  font-size: 12px;
  font-weight: 760;
  gap: 7px;
  height: 34px;
  padding: 0 13px;

  &:hover:not(:disabled) {
    border-color: rgba(52, 211, 153, 0.48);
    background: rgba(6, 78, 59, 0.46);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

const KnowledgeInspectorHeader = styled.header`
  border-bottom: 1px solid var(--history-border);
  background:
    radial-gradient(circle at 12% 0%, rgba(136, 165, 200, 0.09), transparent 38%),
    rgba(7, 12, 19, 0.4);
  flex-shrink: 0;
  padding: 18px 22px 16px;

  > span {
    color: var(--history-subtle);
    display: block;
    font-size: 10px;
    font-weight: 740;
    letter-spacing: 0.08em;
    margin-bottom: 10px;
    text-transform: uppercase;
  }

  h2 {
    color: rgba(248, 250, 252, 0.94);
    font-size: 20px;
    font-weight: 680;
    letter-spacing: -0.026em;
    line-height: 1.18;
    margin: 0;
  }

  small {
    color: rgba(148, 163, 184, 0.76);
    display: block;
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.45;
    margin-top: 7px;
    overflow-wrap: anywhere;
  }

  html[data-forge-theme="light"] & {
    background:
      radial-gradient(circle at 12% 0%, rgba(0, 102, 204, 0.07), transparent 40%),
      #ffffff;
  }

  html[data-forge-theme="light"] & h2 {
    color: rgba(29, 29, 31, 0.94);
  }

  html[data-forge-theme="light"] & small {
    color: rgba(90, 96, 108, 0.82);
  }
`;

const KnowledgeMetricRow = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0;
  margin-top: 14px;

  strong {
    align-items: baseline;
    color: rgba(226, 232, 240, 0.9);
    display: inline-flex;
    font-size: 12px;
    font-weight: 650;
    gap: 4px;
    line-height: 1;
    padding: 0 12px;
  }

  strong:first-child {
    padding-left: 0;
  }

  strong + strong {
    border-left: 1px solid rgba(148, 163, 184, 0.16);
  }

  em {
    color: rgba(148, 163, 184, 0.74);
    font-style: normal;
    font-weight: 560;
  }

  html[data-forge-theme="light"] & strong {
    color: rgba(29, 29, 31, 0.84);
  }

  html[data-forge-theme="light"] & em {
    color: rgba(90, 96, 108, 0.72);
  }
`;

const MarkdownPane = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
`;

const SpecObjectsSection = styled.section`
  border-top: 1px solid var(--history-border);
  padding: 12px;

  h3 {
    align-items: center;
    color: var(--history-muted);
    display: flex;
    font-size: 10px;
    font-weight: 740;
    gap: 8px;
    letter-spacing: 0.06em;
    margin: 0 0 8px;
    text-transform: uppercase;
  }
`;

const SpecObjectsHeadingBadge = styled.span`
  border: 1px solid var(--history-border);
  border-radius: 5px;
  color: var(--history-muted);
  font-size: 10px;
  font-weight: 680;
  letter-spacing: 0;
  line-height: 1;
  margin-left: auto;
  padding: 5px 8px;
  text-transform: lowercase;
`;

const KnowledgeSection = styled(SpecObjectsSection)``;

const KnowledgeMarkdown = styled.div`
  min-width: 0;
  width: min(100%, 70ch);
  margin: 0 auto;
  padding: 22px 28px 38px;
  color: rgba(226, 232, 240, 0.82);
  font-family: ui-sans-serif, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  font-size: 12.5px;
  font-weight: 430;
  letter-spacing: 0;
  line-height: 1.56;
  overflow-wrap: break-word;
  user-select: text;
  -webkit-user-select: text;

  > :first-child {
    margin-top: 0;
  }

  > :last-child {
    margin-bottom: 0;
  }

  p {
    margin: 0 0 10px;
  }

  h1,
  h2,
  h3,
  h4 {
    color: rgba(226, 232, 240, 0.86);
    font-weight: 650;
    letter-spacing: 0.02em;
    line-height: 1.3;
    text-transform: uppercase;
  }

  h1 {
    border-bottom: 1px solid rgba(148, 163, 184, 0.13);
    font-size: 13px;
    margin: 0 0 12px;
    padding-bottom: 8px;
  }

  h2 {
    font-size: 12px;
    margin: 18px 0 8px;
  }

  h3,
  h4 {
    font-size: 11.5px;
    margin: 16px 0 7px;
  }

  ul,
  ol {
    margin: 6px 0 14px;
    padding-left: 1.35em;
  }

  li {
    color: rgba(226, 232, 240, 0.78);
    margin: 4px 0;
    padding-left: 4px;
  }

  li::marker {
    color: rgba(148, 163, 184, 0.58);
  }

  li > p {
    margin: 0;
  }

  li > p + p {
    margin-top: 7px;
  }

  blockquote {
    margin: 12px 0;
    border-left: 2px solid rgba(148, 163, 184, 0.3);
    padding: 2px 0 2px 12px;
    color: rgba(203, 213, 225, 0.68);
  }

  a {
    color: rgba(147, 197, 253, 0.88);
    font-weight: 520;
    text-decoration: none;
  }

  a:hover {
    color: var(--history-text);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  code {
    border-radius: 5px;
    padding: 0.12em 0.38em 0.16em;
    color: rgba(203, 213, 225, 0.9);
    background: rgba(148, 163, 184, 0.1);
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 0.88em;
    font-weight: 500;
  }

  pre {
    max-width: 100%;
    margin: 12px 0;
    overflow-x: auto;
    overflow-y: hidden;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 8px;
    padding: 11px 12px;
    background: rgba(15, 23, 42, 0.46);
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 12px;
    line-height: 1.58;
    white-space: pre;
  }

  pre code {
    display: block;
    min-width: max-content;
    padding: 0;
    color: inherit;
    background: transparent;
    font: inherit;
    font-weight: 500;
    white-space: pre;
    overflow-wrap: normal;
  }

  .knowledge-markdown-table-wrap {
    max-width: 100%;
    margin: 12px 0;
    overflow-x: auto;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 10px;
  }

  table {
    width: 100%;
    min-width: 420px;
    border-collapse: collapse;
    font-size: 12px;
    line-height: 1.45;
  }

  th,
  td {
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
  }

  th {
    color: rgba(248, 250, 252, 0.9);
    background: rgba(148, 163, 184, 0.08);
    font-weight: 620;
  }

  tr:last-child td {
    border-bottom: 0;
  }

  hr {
    height: 1px;
    margin: 16px 0;
    border: 0;
    background: rgba(148, 163, 184, 0.14);
  }

  strong {
    color: rgba(248, 250, 252, 0.9);
    font-weight: 620;
  }

  html[data-forge-theme="light"] & {
    color: rgba(29, 29, 31, 0.78);
  }

  html[data-forge-theme="light"] & h1,
  html[data-forge-theme="light"] & h2,
  html[data-forge-theme="light"] & h3,
  html[data-forge-theme="light"] & h4,
  html[data-forge-theme="light"] & strong {
    color: rgba(29, 29, 31, 0.94);
  }

  html[data-forge-theme="light"] & li {
    color: rgba(29, 29, 31, 0.76);
  }

  html[data-forge-theme="light"] & code {
    color: rgba(0, 102, 204, 0.92);
    background: rgba(0, 102, 204, 0.08);
  }

  html[data-forge-theme="light"] & pre,
  html[data-forge-theme="light"] & .knowledge-markdown-table-wrap {
    border-color: rgba(0, 0, 0, 0.08);
    background: rgba(0, 0, 0, 0.028);
  }
`;

const KnowledgeRelationsPanel = styled.div`
  border-top: 1px solid rgba(148, 163, 184, 0.13);
  display: grid;
  gap: 22px;
  margin: 0 auto;
  padding: 22px 28px 34px;
  width: min(100%, 68ch);

  html[data-forge-theme="light"] & {
    border-top-color: rgba(0, 0, 0, 0.08);
  }
`;

const KnowledgeRelationGroup = styled.section`
  h3 {
    align-items: center;
    color: rgba(226, 232, 240, 0.78);
    display: flex;
    font-size: 12px;
    font-weight: 650;
    gap: 8px;
    letter-spacing: -0.01em;
    margin: 0 0 10px;
  }

  h3 span {
    color: rgba(148, 163, 184, 0.7);
    font-size: 11px;
    font-weight: 560;
  }

  html[data-forge-theme="light"] & h3 {
    color: rgba(29, 29, 31, 0.78);
  }

  html[data-forge-theme="light"] & h3 span {
    color: rgba(90, 96, 108, 0.72);
  }
`;

const KnowledgeRelationList = styled.ul`
  display: grid;
  gap: 4px;
  list-style: none;
  margin: 0;
  padding: 0;
`;

const KnowledgeRelationButton = styled.button`
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 4px;
  padding: 7px 8px;
  text-align: left;
  transition: background 140ms ease;
  width: 100%;

  &:hover {
    background: rgba(148, 163, 184, 0.08);
  }

  span {
    color: rgba(226, 232, 240, 0.82);
    font-size: 13px;
    font-weight: 560;
    line-height: 1.32;
    overflow-wrap: anywhere;
  }

  small {
    color: rgba(148, 163, 184, 0.66);
    font-size: 11.5px;
    font-weight: 480;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  html[data-forge-theme="light"] &:hover {
    background: rgba(0, 0, 0, 0.045);
  }

  html[data-forge-theme="light"] & span {
    color: rgba(29, 29, 31, 0.82);
  }

  html[data-forge-theme="light"] & small {
    color: rgba(90, 96, 108, 0.7);
  }
`;

const KnowledgeRelationEmpty = styled.div`
  color: rgba(148, 163, 184, 0.6);
  font-size: 12px;
  font-weight: 500;
  padding: 4px 8px;

  html[data-forge-theme="light"] & {
    color: rgba(90, 96, 108, 0.68);
  }
`;

const KnowledgeMiniList = styled.ul`
  display: grid;
  gap: 7px;
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    border: 1px solid var(--history-border);
    border-radius: 7px;
    background: var(--history-panel);
    display: grid;
    gap: 4px;
    padding: 9px;
  }

  span {
    color: var(--history-text);
    font-size: 11px;
    font-weight: 700;
  }

  small {
    color: var(--history-subtle);
    font-size: 10px;
    font-weight: 620;
    overflow-wrap: anywhere;
  }
`;

const KnowledgePathList = styled(KnowledgeMiniList)`
  li[data-missing="true"] {
    border-color: rgba(185, 135, 109, 0.34);
    background: rgba(67, 40, 24, 0.2);
  }
`;

const KnowledgeStatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;

  span {
    border: 1px solid var(--history-border);
    border-radius: 7px;
    background: var(--history-panel);
    color: var(--history-muted);
    font-size: 10.5px;
    font-weight: 650;
    padding: 9px;
  }

  strong {
    color: var(--history-text);
    font-size: 13px;
    margin-right: 4px;
  }
`;

const HistoryDetailsSection = styled(SpecObjectsSection)``;

const HistoryDetailCard = styled.article`
  border: 1px solid var(--history-border);
  border-radius: 7px;
  background: var(--history-panel);
  padding: 10px;

  &[data-rolled-back="true"] {
    border-color: rgba(139, 151, 166, 0.14);
    background: rgba(13, 18, 24, 0.82);
    opacity: 0.74;
  }

  html[data-forge-theme="light"] &[data-rolled-back="true"] {
    border-color: rgba(0, 0, 0, 0.08);
    background: #fafafc;
  }

  p {
    color: var(--history-text);
    font-size: 11.5px;
    font-weight: 560;
    line-height: 1.45;
    margin: 0;
  }

  small {
    color: var(--history-muted);
    display: block;
    font-size: 10px;
    font-weight: 560;
    margin-top: 6px;
  }
`;

const HistoryTaskPlan = styled.div`
  border-left: 2px solid rgba(136, 165, 200, 0.34);
  color: var(--history-blue);
  font-size: 10.5px;
  font-weight: 560;
  line-height: 1.45;
  margin-top: 8px;
  padding-left: 8px;
`;

const HistoryMutationCard = styled.article`
  border: 1px solid var(--history-border);
  border-radius: 7px;
  background: var(--history-panel);
  padding: 10px;

  & + & {
    margin-top: 8px;
  }

  &[data-action="added"],
  &[data-action="restored"] {
    border-color: rgba(138, 168, 146, 0.24);
  }

  &[data-action="abrogated"],
  &[data-action="removed"] {
    border-color: rgba(185, 135, 109, 0.26);
  }

  > p {
    color: var(--history-muted);
    font-size: 11px;
    font-weight: 540;
    line-height: 1.45;
    margin: 8px 0 0;
  }
`;

const HistoryMutationHeading = styled.div`
  align-items: center;
  display: flex;
  justify-content: space-between;
  gap: 8px;

  span {
    color: var(--history-text);
    font-size: 10px;
    font-weight: 760;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  small {
    color: var(--history-subtle);
    font-size: 9.5px;
    font-weight: 620;
  }
`;

const HistoryStatement = styled.div`
  border-left: 2px solid ${({ $before }) => ($before ? "rgba(185, 135, 109, 0.44)" : "rgba(138, 168, 146, 0.42)")};
  margin-top: 8px;
  padding-left: 8px;

  span {
    color: ${({ $before }) => ($before ? "var(--history-orange)" : "var(--history-green)")};
    display: block;
    font-size: 9px;
    font-weight: 760;
    letter-spacing: 0.05em;
    margin-bottom: 3px;
    text-transform: uppercase;
  }

  p {
    color: ${({ $before }) => ($before ? "var(--history-muted)" : "var(--history-text)")};
    font-size: 11px;
    font-weight: 540;
    line-height: 1.45;
    margin: 0;
  }
`;

const SpecObjectCard = styled.article`
  border: 1px solid ${({ $historical }) => ($historical ? "rgba(148, 163, 184, 0.16)" : "rgba(52, 211, 153, 0.18)")};
  border-radius: 8px;
  background: ${({ $historical }) => ($historical ? "rgba(15, 23, 42, 0.38)" : "rgba(6, 78, 59, 0.14)")};
  padding: 9px 10px;

  & + & {
    margin-top: 7px;
  }

  p {
    color: rgba(229, 236, 246, ${({ $historical }) => ($historical ? 0.58 : 0.86)});
    font-size: 11px;
    font-weight: 650;
    line-height: 1.45;
    margin: 0;
  }

  small {
    color: rgba(251, 191, 36, 0.82);
    display: block;
    font-size: 10px;
    font-weight: 650;
    line-height: 1.4;
    margin-top: 7px;
  }

  html[data-forge-theme="light"] & {
    border-color: ${({ $historical }) => ($historical ? "rgba(0, 0, 0, 0.1)" : "rgba(10, 127, 69, 0.24)")};
    background: ${({ $historical }) => ($historical ? "#fafafc" : "rgba(10, 127, 69, 0.09)")};
  }

  html[data-forge-theme="light"] & p {
    color: ${({ $historical }) => ($historical ? "var(--history-muted)" : "var(--history-text)")};
  }

  html[data-forge-theme="light"] & small {
    color: var(--history-amber);
  }
`;

const SpecObjectCardHeader = styled.div`
  align-items: flex-start;
  display: flex;
  gap: 8px;

  > p {
    flex: 1;
    min-width: 0;
  }
`;

const SpecObjectActions = styled.div`
  align-items: center;
  display: inline-flex;
  flex-shrink: 0;
  gap: 5px;
`;

const SpecObjectIconButton = styled.button`
  align-items: center;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 6px;
  background: rgba(7, 12, 19, 0.24);
  color: rgba(219, 231, 247, 0.68);
  cursor: pointer;
  display: inline-flex;
  height: 24px;
  justify-content: center;
  padding: 0;
  width: 24px;

  &:hover:not(:disabled) {
    border-color: rgba(52, 211, 153, 0.3);
    color: rgba(238, 245, 255, 0.92);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.38;
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(10, 127, 69, 0.16);
    background: rgba(255, 255, 255, 0.78);
    color: var(--history-muted);
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    border-color: rgba(10, 127, 69, 0.32);
    color: var(--history-green);
  }
`;

const PriorSpecsButton = styled.button`
  align-items: center;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 999px;
  background: rgba(7, 12, 19, 0.38);
  color: rgba(219, 231, 247, 0.66);
  cursor: pointer;
  display: inline-flex;
  font-size: 10px;
  font-weight: 780;
  gap: 3px;
  line-height: 1;
  margin-top: 8px;
  padding: 5px 8px 5px 6px;

  &:hover {
    border-color: rgba(52, 211, 153, 0.24);
    color: rgba(238, 245, 255, 0.9);
  }

  svg {
    transform: ${({ $expanded }) => ($expanded ? "rotate(-90deg)" : "rotate(0deg)")};
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(10, 127, 69, 0.24);
    background: rgba(10, 127, 69, 0.08);
    color: var(--history-green);
  }

  html[data-forge-theme="light"] &:hover {
    border-color: rgba(10, 127, 69, 0.34);
    background: rgba(10, 127, 69, 0.12);
    color: var(--history-green);
  }
`;

const PriorSpecsIcon = styled(KeyboardArrowLeft)`
  height: 14px;
  transition: transform 140ms ease;
  width: 14px;
`;

const PriorSpecsList = styled.div`
  border-left: 1px solid rgba(52, 211, 153, 0.18);
  display: grid;
  gap: 7px;
  margin-top: 8px;
  padding-left: 9px;

  html[data-forge-theme="light"] & {
    border-left-color: rgba(10, 127, 69, 0.24);
  }
`;

const PriorSpecItem = styled.div`
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.36);
  padding: 8px 9px;

  span {
    color: rgba(219, 231, 247, 0.42);
    display: block;
    font-size: 9px;
    font-weight: 850;
    letter-spacing: 0.06em;
    line-height: 1;
    margin-bottom: 5px;
    text-transform: uppercase;
  }

  p {
    color: rgba(229, 236, 246, 0.68);
    font-size: 10.5px;
    font-weight: 640;
    line-height: 1.42;
    margin: 0;
  }

  small {
    color: rgba(251, 191, 36, 0.74);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.1);
    background: #ffffff;
  }

  html[data-forge-theme="light"] & span {
    color: var(--history-muted);
  }

  html[data-forge-theme="light"] & p {
    color: var(--history-text);
  }

  html[data-forge-theme="light"] & small {
    color: var(--history-amber);
  }
`;

const SpecObjectsEmpty = styled.div`
  color: rgba(219, 231, 247, 0.38);
  font-size: 11px;
  font-weight: 650;

  html[data-forge-theme="light"] & {
    color: var(--history-muted);
  }
`;

const InspectorEmpty = styled.div`
  color: rgba(219, 231, 247, 0.48);
  font-size: 12px;
  font-weight: 680;
  padding: 14px;

  html[data-forge-theme="light"] & {
    color: var(--history-muted);
  }
`;

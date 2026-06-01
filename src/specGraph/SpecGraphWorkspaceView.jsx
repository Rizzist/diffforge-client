import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Add } from "@styled-icons/material-rounded/Add";
import { Close } from "@styled-icons/material-rounded/Close";
import { DeleteOutline } from "@styled-icons/material-rounded/DeleteOutline";
import { Edit } from "@styled-icons/material-rounded/Edit";
import { KeyboardArrowLeft } from "@styled-icons/material-rounded/KeyboardArrowLeft";
import { Refresh } from "@styled-icons/material-rounded/Refresh";
import { Send } from "@styled-icons/material-rounded/Send";
import styled, { keyframes } from "styled-components";
import { createWorkspaceDisplayIdentity } from "../workspace/workspaceDisplayIdentity.js";
import GraphRendererHost from "./renderers/GraphRendererHost.jsx";
import {
  field,
  freshnessLabel,
  graphRootNode,
  isLeasedFileNode,
  isLocalOnlyNode,
  isUnspecifiedStructuralNode,
  isWorktreeFileNode,
  mergeLocalIgnoredOverlay,
  nodeProjectContext,
  normalizeSnapshot,
  selectedFallback,
  splitSpecHistory,
  text,
} from "./specGraphCore.js";

export default function SpecGraphWorkspaceView({
  defaultWorkingDirectory,
  rootDirectory,
  specGraphError = "",
  specGraphSnapshot = null,
  specGraphState = "idle",
  isWorkspaceActive = false,
  onSubmitSpecEditIntent = null,
  pendingSpecEdits = [],
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
  const [specEditDraft, setSpecEditDraft] = useState(null);
  const [specEditStatus, setSpecEditStatus] = useState({ state: "idle", message: "" });
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedHistoryNodeId, setSelectedHistoryNodeId] = useState("");
  const [resetStatus, setResetStatus] = useState({ state: "idle", message: "" });
  const [rawScan, setRawScan] = useState(null);
  const [rawScanState, setRawScanState] = useState("idle");
  const [rawScanError, setRawScanError] = useState("");
  const snapshot = specGraphSnapshot;
  const error = specGraphError;
  const state = specGraphState;

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

  const loadRawScan = useCallback(() => {
    if (!repoPath || !workspaceId) {
      setRawScan(null);
      setRawScanError("");
      setRawScanState("idle");
      return;
    }

    setRawScanState((current) => (current === "idle" ? "loading" : "refreshing"));
    setRawScanError("");
    invoke("terminal_workspace_raw_scan", {
      repoPath,
      workspaceId,
      workspaceName,
    })
      .then((scan) => {
        setRawScan(scan);
        setRawScanState("ready");
      })
      .catch((nextError) => {
        setRawScanError(nextError?.message || String(nextError));
        setRawScanState("error");
      });
  }, [repoPath, workspaceId, workspaceName]);

  useEffect(() => {
    if (viewMode === "rawScan") loadRawScan();
  }, [loadRawScan, viewMode]);

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
  const selectedNode = selectedFallback(specGraph.nodes, selectedNodeId);
  const selectedNodePendingSpecEdits = useMemo(() => {
    const nodeId = text(selectedNode?.id, "");
    if (!nodeId) return [];
    return (Array.isArray(pendingSpecEdits) ? pendingSpecEdits : [])
      .filter((intent) => {
        const targetNodeId = text(intent?.targetNodeId, "");
        const containerTargetNodeId = text(intent?.containerTargetNodeId, "");
        return targetNodeId === nodeId || containerTargetNodeId === nodeId;
      });
  }, [pendingSpecEdits, selectedNode?.id]);
  const taskHistory = specGraph.taskHistory || { tasks: [] };
  const historyTasks = Array.isArray(taskHistory.tasks) ? taskHistory.tasks : [];
  const selectedTask = historyTasks.find((task) => task.task_id === selectedTaskId) || historyTasks[0] || null;
  const selectedHistoryNode = selectedTask?.nodes?.find((node) => node.node_id === selectedHistoryNodeId)
    || selectedTask?.nodes?.[0]
    || null;
  const localIgnoredCount = Array.isArray(localIgnoredOverlay?.nodes)
    ? localIgnoredOverlay.nodes.length
    : 0;
  const specEditDisabledReason = useMemo(() => {
    if (!isWorkspaceActive) return "Activate this workspace to edit specs.";
    if (state === "loading" || state === "syncing") return "Wait for the Spec Graph to finish syncing.";
    if (error) return "Resolve the Spec Graph sync error before editing.";
    return "";
  }, [error, isWorkspaceActive, state]);
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
    });
  }, [selectedNode]);
  const closeSpecEditDraft = useCallback(() => {
    setSpecEditDraft(null);
    setSpecEditStatus({ state: "idle", message: "" });
  }, []);
  const submitSpecEditDraft = useCallback((event) => {
    event.preventDefault();
    if (!specEditDraft || !selectedNode || !onSubmitSpecEditIntent) return;
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
    setSpecEditStatus({ state: "submitting", message: "Queueing spec edit..." });
    const projectContext = nodeProjectContext(selectedNode);
    const displayPath = text(selectedNode.display_path || selectedNode.displayPath || selectedNode.path, "");
    const routedNodeId = projectContext.sourceNodeId || selectedNode.id;
    const routedNodeHash = projectContext.sourceNodeHash
      || text(specGraphSnapshot?.nodeHashes?.[selectedNode.id], "");
    const targetPath = projectContext.projectRoot
      ? projectContext.projectRelativePath
      : displayPath;
    onSubmitSpecEditIntent({
      baseGraphHash: projectContext.sourceGraphCursor || text(specGraphSnapshot?.cursor, ""),
      baseNodeHash: routedNodeHash,
      containerTargetNodeId: projectContext.containerNodeId || selectedNode.id,
      currentStatement: specEditDraft.currentStatement,
      desiredStatement,
      mountId: projectContext.mountId,
      operation: specEditDraft.operation,
      sourceRepoId: projectContext.sourceRepoId,
      targetNode: selectedNode,
      targetNodeId: routedNodeId,
      targetPath,
      targetProjectRelativePath: projectContext.projectRelativePath,
      targetProjectRoot: projectContext.projectRoot,
      targetSpecObjectId: specEditDraft.targetSpecObjectId,
      targetTitle: text(selectedNode.display_title || selectedNode.displayTitle || selectedNode.title, "Spec node"),
      targetVisiblePath: displayPath || projectContext.visiblePath,
      targetWorkspaceRoot: projectContext.workspaceRoot,
      userInstruction: instruction,
    })
      .then((result) => {
        setSpecEditStatus({
          state: "sent",
          message: result?.intentId ? "Queued for the next available agent." : "Queued.",
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
    selectedNode,
    specEditDraft,
    specGraphSnapshot?.cursor,
    specGraphSnapshot?.nodeHashes,
  ]);
  const runGraphReset = useCallback((scope) => {
    if (!repoPath || !workspaceId) return;
    const confirmed = window.confirm("Reset spec graph state for this workspace?");
    if (!confirmed) return;
    setResetStatus({ state: "running", message: "Resetting..." });
    invoke("cloud_mcp_reset_workspace_graph_state", {
      repoPath,
      workspaceId,
      workspaceName,
      scope,
    })
      .then(() => {
        setSelectedNodeId("");
        setSelectedTaskId("");
        setSelectedHistoryNodeId("");
        setLocalIgnoredOverlay(null);
        setResetStatus({ state: "done", message: "Reset complete" });
        window.setTimeout(() => setResetStatus({ state: "idle", message: "" }), 1800);
      })
      .catch((nextError) => {
        setResetStatus({
          state: "error",
          message: nextError?.message || String(nextError || "Reset failed."),
        });
      });
  }, [repoPath, workspaceId, workspaceName]);

  useEffect(() => {
    if (specGraph.nodes.length && !specGraph.nodes.some((node) => node.id === selectedNodeId)) {
      const root = graphRootNode(specGraph.nodes, specGraph.edges);
      setSelectedNodeId(root?.id || specGraph.nodes[0].id);
    }
  }, [specGraph.edges, specGraph.nodes, selectedNodeId]);

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

      <SpecGraphToolbar>
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
          <ViewToggleButton
            type="button"
            data-active={viewMode === "rawScan" ? "true" : "false"}
            onClick={() => setViewMode("rawScan")}
          >
            Raw Scan
          </ViewToggleButton>
        </ViewToggleGroup>
        {viewMode === "graph" && (
          <>
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
        )}
        <ToolbarSpacer />
        <ResetGraphButton
          type="button"
          disabled={!repoPath || !workspaceId || resetStatus.state === "running"}
          onClick={() => runGraphReset("spec")}
        >
          <DeleteOutline size={15} />
          <span>Reset</span>
        </ResetGraphButton>
        {resetStatus.message && (
          <ResetGraphStatus data-state={resetStatus.state}>{resetStatus.message}</ResetGraphStatus>
        )}
      </SpecGraphToolbar>

      <SpecGraphShell data-view={viewMode}>
        {viewMode === "rawScan" ? (
          <RawScanMain
            error={rawScanError}
            onRefresh={loadRawScan}
            scan={rawScan}
            state={rawScanState}
          />
        ) : viewMode === "history" ? (
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
                viewKey={`${workspaceId || "workspace"}:${repoPath || "repo"}:spec-graph`}
              />
            </SpecGraphMain>

            <SpecInspector
              editDisabledReason={specEditDisabledReason}
              node={selectedNode}
              onAddSpec={() => openSpecEditDraft("add")}
              onDeleteSpec={(spec) => openSpecEditDraft("delete", spec)}
              onEditSpec={(spec) => openSpecEditDraft("edit", spec)}
              pendingSpecEdits={selectedNodePendingSpecEdits}
            />
          </>
        )}
      </SpecGraphShell>
      {specEditDraft && (
        <SpecEditDialog
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

function RawScanMain({ error, onRefresh, scan, state }) {
  const loading = state === "loading" || state === "refreshing";
  const graph = useMemo(() => buildRawScanGraph(scan), [scan]);

  return (
    <RawScanGraphPane>
      <RawScanGraphToolbar>
        {error && <RawScanGraphError>{error}</RawScanGraphError>}
        <RawScanRefreshButton
          aria-label={loading ? "Scanning raw workspace graph" : "Refresh raw workspace graph"}
          disabled={loading}
          onClick={onRefresh}
          title={loading ? "Scanning" : "Refresh"}
          type="button"
        >
          <RefreshIcon aria-hidden="true" data-spinning={loading ? "true" : "false"} />
        </RawScanRefreshButton>
      </RawScanGraphToolbar>

      {graph.nodes.length ? (
        <RawScanGraphCanvas style={{ height: graph.height, width: graph.width }}>
          <RawScanGraphEdges height={graph.height} width={graph.width}>
            {graph.edges.map((edge) => (
              <path d={edge.path} data-state={edge.state} key={edge.id} />
            ))}
          </RawScanGraphEdges>
          {graph.nodes.map((node) => (
            <RawScanGraphNode
              data-state={node.state}
              key={node.id}
              style={{ transform: `translate(${node.x}px, ${node.y}px)` }}
              title={node.path}
            >
              <RawScanGraphNodeTop>
                <strong>{node.label}</strong>
                <span>{node.kind}</span>
              </RawScanGraphNodeTop>
              <small>{node.detail}</small>
              {node.badges.length > 0 && (
                <RawScanGraphNodeBadges>
                  {node.badges.map((badge, index) => (
                    <span data-state={badge.state} key={`${badge.state}:${badge.label}:${index}`}>{badge.label}</span>
                  ))}
                </RawScanGraphNodeBadges>
              )}
            </RawScanGraphNode>
          ))}
        </RawScanGraphCanvas>
      ) : (
        <RawScanGraphEmpty>{loading ? "Scanning" : "No scan graph"}</RawScanGraphEmpty>
      )}
    </RawScanGraphPane>
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

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeRawScanRelativePath(value) {
  const normalized = text(value)
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return normalized === "." ? "" : normalized;
}

function rawScanGraphNodeId(relativePath) {
  return relativePath ? `folder:${relativePath}` : "folder:root";
}

function rawScanGraphParentRelativePath(relativePath) {
  if (!relativePath) return "";
  const parts = relativePath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function rawScanGraphNodeLabel(relativePath) {
  if (!relativePath) return ".";
  const parts = relativePath.split("/").filter(Boolean);
  return parts[parts.length - 1] || ".";
}

function rawScanGraphNodeState(entry) {
  const action = text(entry?.scanAction);
  if (entry?.selectedRoot) return "root";
  if (action === "skipped_by_mount_scan") return "skipped";
  if (action.startsWith("ignored")) return "ignored";
  if (action === "detected_mount") return "mount";
  if (action === "max_depth") return "max_depth";
  if (entry?.isExactGitRoot || entry?.hasGitMarker) return "git";
  if (entry?.projectKind && entry.projectKind !== "none") return "project";
  return "folder";
}

function rawScanGraphNodeKind(entry) {
  if (entry?.selectedRoot) return "root";
  if (entry?.entryKind === "symlink") return "symlink";
  if (entry?.isExactGitRoot || entry?.hasGitMarker) return "git";
  if (entry?.projectKind && entry.projectKind !== "none") return entry.projectKind;
  return "folder";
}

function rawScanGraphBadges(entry) {
  const badges = [];
  const action = text(entry?.scanAction);
  if (action && action !== "queued") badges.push({ label: action.replace(/_/g, " "), state: action });
  if (entry?.isExactGitRoot || entry?.hasGitMarker) badges.push({ label: "git", state: "git" });
  if (entry?.projectKind && entry.projectKind !== "none") {
    badges.push({ label: entry.projectKind, state: entry.projectKind });
  }
  if (entry?.hasAgents) badges.push({ label: ".agents", state: "agents" });
  if (entry?.hasSpecGraphCache) badges.push({ label: "spec cache", state: "cache" });
  return badges.slice(0, 4);
}

function rawScanGraphEdgePath(source, target) {
  const startX = source.x + RAW_SCAN_GRAPH_NODE_WIDTH;
  const startY = source.y + RAW_SCAN_GRAPH_NODE_HEIGHT / 2;
  const endX = target.x;
  const endY = target.y + RAW_SCAN_GRAPH_NODE_HEIGHT / 2;
  const curve = Math.max(54, (endX - startX) * 0.5);
  return `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`;
}

const RAW_SCAN_GRAPH_NODE_WIDTH = 238;
const RAW_SCAN_GRAPH_NODE_HEIGHT = 70;
const RAW_SCAN_GRAPH_X_GAP = 112;
const RAW_SCAN_GRAPH_Y_GAP = 24;
const RAW_SCAN_GRAPH_LEFT = 36;
const RAW_SCAN_GRAPH_TOP = 42;

function buildRawScanGraph(scan) {
  const entries = arrayValue(scan?.folderTrace?.entries);
  const fallbackRoot = text(scan?.root);
  const sourceEntries = entries.length
    ? entries
    : fallbackRoot
      ? [{ path: fallbackRoot, relativePath: "", selectedRoot: true, scanAction: "selected_root" }]
      : [];
  const prepared = sourceEntries.map((entry, index) => {
    const relativePath = normalizeRawScanRelativePath(entry?.relativePath);
    const depth = Math.max(0, Number(entry?.depth) || 0);
    return {
      entry,
      depth,
      id: rawScanGraphNodeId(relativePath),
      index,
      relativePath,
    };
  });
  const maxDepth = prepared.reduce((value, node) => Math.max(value, node.depth), 0);
  const nodes = prepared.map((node) => {
    const x = RAW_SCAN_GRAPH_LEFT + node.depth * (RAW_SCAN_GRAPH_NODE_WIDTH + RAW_SCAN_GRAPH_X_GAP);
    const y = RAW_SCAN_GRAPH_TOP + node.index * (RAW_SCAN_GRAPH_NODE_HEIGHT + RAW_SCAN_GRAPH_Y_GAP);
    return {
      ...node,
      badges: rawScanGraphBadges(node.entry),
      detail: node.relativePath || text(scan?.root, "workspace"),
      kind: rawScanGraphNodeKind(node.entry),
      label: rawScanGraphNodeLabel(node.relativePath),
      path: text(node.entry?.path, text(scan?.root)),
      state: rawScanGraphNodeState(node.entry),
      x,
      y,
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const rootNode = nodes.find((node) => !node.relativePath) || nodes[0];
  const edges = nodes
    .filter((node) => node !== rootNode)
    .map((node) => {
      const parentRelativePath = rawScanGraphParentRelativePath(node.relativePath);
      const parent = nodeById.get(rawScanGraphNodeId(parentRelativePath)) || rootNode;
      if (!parent) return null;
      return {
        id: `${parent.id}->${node.id}`,
        path: rawScanGraphEdgePath(parent, node),
        state: node.state,
      };
    })
    .filter(Boolean);

  return {
    edges,
    height: Math.max(520, RAW_SCAN_GRAPH_TOP * 2 + nodes.length * (RAW_SCAN_GRAPH_NODE_HEIGHT + RAW_SCAN_GRAPH_Y_GAP)),
    nodes,
    width: Math.max(900, RAW_SCAN_GRAPH_LEFT * 2 + (maxDepth + 1) * RAW_SCAN_GRAPH_NODE_WIDTH + maxDepth * RAW_SCAN_GRAPH_X_GAP),
  };
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
  disabledReason,
  draft,
  node,
  onChange,
  onClose,
  onSubmit,
  status,
}) {
  const operationLabel = specEditOperationLabel(draft.operation);
  const submitDisabled = Boolean(disabledReason)
    || status.state === "submitting"
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
              <span>{status.state === "submitting" ? "Queueing" : "Queue"}</span>
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
  pendingSpecEdits = [],
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
          pendingSpecs={pendingSpecEdits}
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

function pendingSpecEditStatement(intent) {
  const operation = text(intent?.operation, "edit").toLowerCase();
  if (operation === "delete") {
    return text(intent?.currentStatement || intent?.desiredStatement, "Deleting selected spec");
  }
  return text(
    intent?.desiredStatement || intent?.currentStatement || intent?.userInstruction,
    "Requested spec update",
  );
}

function pendingSpecEditStatusLabel(intent) {
  const operation = text(intent?.operation, "edit").toLowerCase();
  if (operation === "add") return "adding";
  if (operation === "delete") return "deleting";
  return "updating";
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
  pendingSpecs = [],
}) {
  const visibleSpecs = Array.isArray(specs) ? specs : [];
  const visiblePendingSpecs = historical ? [] : (Array.isArray(pendingSpecs) ? pendingSpecs : []);
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
      {visibleSpecs.length || visiblePendingSpecs.length ? (
        <>
          {visiblePendingSpecs.map((intent, index) => (
            <SpecObjectCard
              key={intent?.intentId || `pending-spec-${index}`}
              $pending
              data-pending="true"
            >
              <SpecObjectCardHeader>
                <p>{pendingSpecEditStatement(intent)}</p>
                <SpecObjectPendingState>
                  <SpecGhostSpinner aria-hidden="true" />
                  <span>{pendingSpecEditStatusLabel(intent)}</span>
                </SpecObjectPendingState>
              </SpecObjectCardHeader>
              <SpecObjectGhostMeta>
                Processing with {text(intent?.agentLabel, "agent")}
              </SpecObjectGhostMeta>
            </SpecObjectCard>
          ))}
          {visibleSpecs.map((spec, index) => {
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
        })}
        </>
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

const ResetGraphButton = styled.button`
  align-items: center;
  background: rgba(127, 29, 29, 0.12);
  border: 1px solid rgba(248, 113, 113, 0.28);
  border-radius: 7px;
  color: #fecaca;
  cursor: pointer;
  display: inline-flex;
  gap: 5px;
  font-size: 11px;
  font-weight: 760;
  letter-spacing: 0;
  min-height: 31px;
  padding: 0 8px;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  html[data-forge-theme="light"] & {
    background: rgba(180, 35, 24, 0.07);
    border-color: rgba(180, 35, 24, 0.2);
    color: var(--history-red);
  }
`;

const ResetGraphStatus = styled.span`
  color: var(--history-muted);
  font-size: 11px;
  font-weight: 760;

  &[data-state="error"] {
    color: var(--history-red);
  }

  &[data-state="done"] {
    color: var(--history-green);
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

  &[data-view="rawScan"] {
    grid-template-columns: minmax(0, 1fr);
  }

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(360px, 1fr) minmax(260px, 40%);

    &[data-view="rawScan"] {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(360px, 1fr);
    }
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

const rawScanGraphSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const RawScanGraphPane = styled.main`
  border: 1px solid rgba(230, 236, 245, 0.07);
  border-radius: 8px;
  background:
    linear-gradient(rgba(139, 151, 166, 0.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(139, 151, 166, 0.045) 1px, transparent 1px),
    rgba(7, 9, 13, 0.58);
  background-size: 42px 42px;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  position: relative;

  html[data-forge-theme="light"] & {
    border-color: var(--history-border-strong);
    background:
      linear-gradient(rgba(2, 6, 23, 0.05) 1px, transparent 1px),
      linear-gradient(90deg, rgba(2, 6, 23, 0.05) 1px, transparent 1px),
      #ffffff;
    background-size: 42px 42px;
  }
`;

const RawScanGraphToolbar = styled.div`
  align-items: flex-start;
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  left: 10px;
  pointer-events: none;
  position: sticky;
  right: 10px;
  top: 10px;
  z-index: 6;

  > * {
    pointer-events: auto;
  }
`;

const RawScanGraphError = styled.div`
  background: rgba(20, 24, 31, 0.92);
  border: 1px solid rgba(196, 135, 135, 0.32);
  border-radius: 7px;
  color: var(--history-red);
  font-size: 12px;
  font-weight: 640;
  max-width: min(620px, 70vw);
  padding: 9px 10px;

  html[data-forge-theme="light"] & {
    background: rgba(255, 255, 255, 0.94);
  }
`;

const RawScanRefreshButton = styled.button`
  align-items: center;
  background: rgba(20, 24, 31, 0.9);
  border: 1px solid rgba(136, 165, 200, 0.24);
  border-radius: 7px;
  color: var(--history-blue);
  cursor: pointer;
  display: inline-flex;
  flex-shrink: 0;
  height: 34px;
  justify-content: center;
  padding: 0;
  width: 34px;

  &:disabled {
    cursor: default;
    opacity: 0.58;
  }

  html[data-forge-theme="light"] & {
    background: rgba(255, 255, 255, 0.94);
  }
`;

const RefreshIcon = styled(Refresh)`
  height: 16px;
  width: 16px;

  &[data-spinning="true"] {
    animation: ${rawScanGraphSpin} 0.8s linear infinite;
  }
`;

const RawScanGraphCanvas = styled.div`
  min-height: 100%;
  min-width: 100%;
  position: relative;
`;

const RawScanGraphEdges = styled.svg`
  inset: 0;
  overflow: visible;
  pointer-events: none;
  position: absolute;

  path {
    fill: none;
    stroke: rgba(136, 165, 200, 0.34);
    stroke-width: 1.5;
  }

  path[data-state="root"],
  path[data-state="git"],
  path[data-state="mount"],
  path[data-state="project"] {
    stroke: rgba(138, 168, 146, 0.42);
  }

  path[data-state="skipped"],
  path[data-state="ignored"],
  path[data-state="max_depth"] {
    stroke: rgba(185, 135, 109, 0.36);
    stroke-dasharray: 4 5;
  }
`;

const RawScanGraphNode = styled.div`
  background: rgba(14, 18, 24, 0.94);
  border: 1px solid rgba(136, 165, 200, 0.22);
  border-radius: 8px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
  display: grid;
  gap: 5px;
  height: ${RAW_SCAN_GRAPH_NODE_HEIGHT}px;
  left: 0;
  min-width: 0;
  padding: 9px 10px;
  position: absolute;
  top: 0;
  width: ${RAW_SCAN_GRAPH_NODE_WIDTH}px;

  &[data-state="root"],
  &[data-state="git"],
  &[data-state="mount"],
  &[data-state="project"] {
    background: rgba(14, 29, 22, 0.95);
    border-color: rgba(138, 168, 146, 0.42);
  }

  &[data-state="skipped"],
  &[data-state="ignored"],
  &[data-state="max_depth"] {
    background: rgba(28, 21, 17, 0.95);
    border-color: rgba(185, 135, 109, 0.42);
  }

  > small {
    color: var(--history-muted);
    font-family: "SFMono-Regular", "Menlo", monospace;
    font-size: 10px;
    line-height: 1.2;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] & {
    background: rgba(255, 255, 255, 0.97);
    box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
  }

  html[data-forge-theme="light"] &[data-state="root"],
  html[data-forge-theme="light"] &[data-state="git"],
  html[data-forge-theme="light"] &[data-state="mount"],
  html[data-forge-theme="light"] &[data-state="project"] {
    background: rgba(242, 249, 244, 0.98);
  }

  html[data-forge-theme="light"] &[data-state="skipped"],
  html[data-forge-theme="light"] &[data-state="ignored"],
  html[data-forge-theme="light"] &[data-state="max_depth"] {
    background: rgba(255, 249, 244, 0.98);
  }
`;

const RawScanGraphNodeTop = styled.div`
  align-items: center;
  display: flex;
  gap: 8px;
  justify-content: space-between;
  min-width: 0;

  strong {
    color: var(--history-text);
    font-size: 13px;
    line-height: 1.15;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    border: 1px solid rgba(136, 165, 200, 0.22);
    border-radius: 5px;
    color: var(--history-blue);
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 760;
    line-height: 1;
    padding: 4px 6px;
    text-transform: uppercase;
  }
`;

const RawScanGraphNodeBadges = styled.div`
  align-items: center;
  display: flex;
  gap: 4px;
  min-width: 0;
  overflow: hidden;

  span {
    border: 1px solid rgba(139, 151, 166, 0.18);
    border-radius: 5px;
    color: var(--history-muted);
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 720;
    line-height: 1;
    max-width: 86px;
    overflow: hidden;
    padding: 3px 5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span[data-state="git"],
  span[data-state="project"],
  span[data-state="agents"],
  span[data-state="cache"] {
    border-color: rgba(138, 168, 146, 0.32);
    color: var(--history-green);
  }

  span[data-state="skipped_by_mount_scan"],
  span[data-state="ignored_symlink"],
  span[data-state="ignored_outside_workspace"],
  span[data-state="max_depth"] {
    border-color: rgba(185, 135, 109, 0.32);
    color: var(--history-orange);
  }
`;

const RawScanGraphEmpty = styled.div`
  align-items: center;
  color: var(--history-muted);
  display: grid;
  font-size: 13px;
  font-weight: 720;
  height: 100%;
  justify-items: center;
  min-height: 360px;
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

const specGhostSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const SpecObjectCard = styled.article`
  border: 1px solid ${({ $historical, $pending }) => (
    $pending
      ? "rgba(136, 165, 200, 0.32)"
      : $historical
        ? "rgba(148, 163, 184, 0.16)"
        : "rgba(52, 211, 153, 0.18)"
  )};
  border-radius: 8px;
  background: ${({ $historical, $pending }) => (
    $pending
      ? "rgba(20, 36, 56, 0.36)"
      : $historical
        ? "rgba(15, 23, 42, 0.38)"
        : "rgba(6, 78, 59, 0.14)"
  )};
  padding: 9px 10px;

  & + & {
    margin-top: 7px;
  }

  p {
    color: rgba(229, 236, 246, ${({ $historical, $pending }) => ($historical || $pending ? 0.64 : 0.86)});
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
    border-color: ${({ $historical, $pending }) => (
      $pending
        ? "rgba(40, 89, 142, 0.24)"
        : $historical
          ? "rgba(0, 0, 0, 0.1)"
          : "rgba(10, 127, 69, 0.24)"
    )};
    background: ${({ $historical, $pending }) => (
      $pending
        ? "rgba(40, 89, 142, 0.08)"
        : $historical
          ? "#fafafc"
          : "rgba(10, 127, 69, 0.09)"
    )};
  }

  html[data-forge-theme="light"] & p {
    color: ${({ $historical, $pending }) => (($historical || $pending) ? "var(--history-muted)" : "var(--history-text)")};
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

const SpecObjectPendingState = styled.div`
  align-items: center;
  border: 1px solid rgba(136, 165, 200, 0.24);
  border-radius: 999px;
  color: var(--history-blue);
  display: inline-flex;
  flex-shrink: 0;
  font-size: 9.5px;
  font-weight: 760;
  gap: 5px;
  letter-spacing: 0.03em;
  padding: 3px 7px;
  text-transform: uppercase;
`;

const SpecGhostSpinner = styled.span`
  animation: ${specGhostSpin} 0.9s linear infinite;
  border: 2px solid rgba(136, 165, 200, 0.22);
  border-top-color: var(--history-blue);
  border-radius: 999px;
  display: inline-block;
  height: 10px;
  width: 10px;
`;

const SpecObjectGhostMeta = styled.small`
  color: rgba(136, 165, 200, 0.82);
  display: block;
  font-size: 10px;
  font-weight: 680;
  line-height: 1.4;
  margin-top: 7px;

  html[data-forge-theme="light"] & {
    color: var(--history-blue);
  }
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

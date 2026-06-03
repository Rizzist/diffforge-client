import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import styled from "styled-components";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

function jsonObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return jsonObject(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeTaskHistory(value) {
  const object = jsonObject(value);
  if (!object) return null;
  if (Array.isArray(object.tasks)) return object;
  if (Array.isArray(object.recent_tasks)) {
    return {
      ...object,
      tasks: object.recent_tasks,
    };
  }
  return null;
}

function taskHistoryFromSnapshot(snapshot) {
  const candidates = [
    snapshot?.taskHistory,
    snapshot?.task_history,
    snapshot?.raw?.task_history,
    snapshot,
  ].map(normalizeTaskHistory).filter(Boolean);

  return candidates.find((candidate) => jsonArray(candidate.tasks).length)
    || candidates[0]
    || { kind: "task_history", version: 1, tasks: [] };
}

function taskStatus(task) {
  if (task?.rollback_state === "rolled_back") return "rolled back";
  return text(task?.status, "unknown");
}

function taskPrompt(task) {
  return text(
    task?.original_prompt
      || task?.prompt
      || task?.start_task_plan
      || task?.body
      || task?.title,
    "No task prompt captured.",
  );
}

function taskTerminalPlan(task) {
  const metadata = jsonObject(task?.metadata_json || task?.metadata);
  return jsonObject(task?.terminal_task_plan)
    || jsonObject(task?.terminalTaskPlan)
    || jsonObject(metadata?.terminal_task_plan)
    || jsonObject(metadata?.terminalTaskPlan);
}

function planStepStatusKind(status) {
  const normalized = text(status).toLowerCase();
  if (["complete", "completed", "done", "finished", "success"].includes(normalized)) {
    return "completed";
  }
  if (["active", "current", "in_progress", "in-progress", "pending", "running", "working"].includes(normalized)) {
    return "active";
  }
  if (["blocked", "interrupted", "cancelled", "canceled", "stopped"].includes(normalized)) {
    return "blocked";
  }
  if (normalized === "skipped") {
    return "skipped";
  }
  return "queued";
}

function planStatusLabel(status) {
  const kind = planStepStatusKind(status);
  if (kind === "completed") return "Completed";
  if (kind === "active") return "In progress";
  if (kind === "blocked") return "Blocked";
  if (kind === "skipped") return "Skipped";
  return "Queued";
}

function formatTime(value) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString();
}

export default function ArchitectureWorkspaceView({
  defaultWorkingDirectory,
  rootDirectory,
  architectureError = "",
  architectureSnapshot = null,
  architectureState = "idle",
  workspace,
}) {
  const workspaceId = workspace?.id || "";
  const workspaceName = workspace?.name || "";
  const repoPath = workspaceId ? rootDirectory || defaultWorkingDirectory || "" : "";
  const [viewMode, setViewMode] = useState("taskHistory");
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [rawScan, setRawScan] = useState(null);
  const [rawScanState, setRawScanState] = useState("idle");
  const [rawScanError, setRawScanError] = useState("");
  const taskHistory = useMemo(() => taskHistoryFromSnapshot(architectureSnapshot), [architectureSnapshot]);
  const tasks = useMemo(() => jsonArray(taskHistory.tasks), [taskHistory]);
  const selectedTask = tasks.find((task) => text(task?.task_id) === selectedTaskId) || tasks[0] || null;

  useEffect(() => {
    if (!tasks.length) {
      setSelectedTaskId("");
      return;
    }
    if (!tasks.some((task) => text(task?.task_id) === selectedTaskId)) {
      setSelectedTaskId(text(tasks[0]?.task_id));
    }
  }, [selectedTaskId, tasks]);

  const loadRawScan = useCallback((options = {}) => {
    if (!repoPath || !workspaceId) {
      setRawScan(null);
      setRawScanError("");
      setRawScanState("idle");
      return;
    }
    const includeFolderTrace = options?.includeFolderTrace === true;
    setRawScanState((current) => (includeFolderTrace && current !== "idle" ? "refreshing" : "loading"));
    setRawScanError("");
    invoke("terminal_workspace_raw_scan", {
      includeFolderTrace,
      repoPath,
      workspaceId,
      workspaceName,
    })
      .then((scan) => {
        setRawScan(scan);
        setRawScanState("ready");
      })
      .catch((error) => {
        setRawScanError(error?.message || String(error || "Unable to scan workspace."));
        setRawScanState("error");
      });
  }, [repoPath, workspaceId, workspaceName]);

  useEffect(() => {
    if (viewMode === "rawScan") {
      loadRawScan();
    }
  }, [loadRawScan, viewMode]);

  return (
    <ArchitectureSurface aria-label={`${workspace?.name || "Workspace"} Architecture`} data-state={architectureState}>
      {architectureError && <ArchitectureError>{architectureError}</ArchitectureError>}
      <ArchitectureToolbar>
        <ViewToggleGroup aria-label="Architecture view mode">
          <ViewToggleButton
            data-active={viewMode === "taskHistory" ? "true" : "false"}
            onClick={() => setViewMode("taskHistory")}
            type="button"
          >
            Task History
          </ViewToggleButton>
          <ViewToggleButton
            data-active={viewMode === "rawScan" ? "true" : "false"}
            onClick={() => setViewMode("rawScan")}
            type="button"
          >
            Raw Scan
          </ViewToggleButton>
        </ViewToggleGroup>
        <ToolbarMeta>{tasks.length} task{tasks.length === 1 ? "" : "s"}</ToolbarMeta>
      </ArchitectureToolbar>

      {viewMode === "rawScan" ? (
        <RawScanPanel
          error={rawScanError}
          onRefresh={loadRawScan}
          scan={rawScan}
          state={rawScanState}
        />
      ) : (
        <HistoryShell>
          <HistoryList tasks={tasks} selectedTaskId={text(selectedTask?.task_id)} onSelectTask={setSelectedTaskId} />
          <HistoryInspector task={selectedTask} />
        </HistoryShell>
      )}
    </ArchitectureSurface>
  );
}

function HistoryList({ tasks, selectedTaskId, onSelectTask }) {
  if (!tasks.length) {
    return (
      <HistoryPane>
        <EmptyState>No task history recorded yet.</EmptyState>
      </HistoryPane>
    );
  }

  return (
    <HistoryPane>
      {tasks.map((task) => {
        const taskId = text(task?.task_id);
        const selected = taskId === selectedTaskId;
        const nodeCount = jsonArray(task?.nodes).length;
        const decisionCount = jsonArray(task?.arbiter_decisions).length;
        const terminalPlan = taskTerminalPlan(task);
        const terminalPlanStepCount = jsonArray(terminalPlan?.steps).length;

        return (
          <TaskButton
            data-selected={selected ? "true" : undefined}
            key={taskId || taskPrompt(task)}
            onClick={() => onSelectTask(taskId)}
            type="button"
          >
            <TaskHeader>
              <strong>{text(task?.title, taskPrompt(task))}</strong>
              <StatusPill>{taskStatus(task)}</StatusPill>
            </TaskHeader>
            <TaskPrompt>{taskPrompt(task)}</TaskPrompt>
            <TaskMeta>
              <span>{text(task?.coding_agent || task?.agent_kind, "agent")}</span>
              {terminalPlanStepCount > 0 && (
                <span>{terminalPlanStepCount} plan step{terminalPlanStepCount === 1 ? "" : "s"}</span>
              )}
              <span>{nodeCount} node delta{nodeCount === 1 ? "" : "s"}</span>
              <span>{decisionCount} decision{decisionCount === 1 ? "" : "s"}</span>
            </TaskMeta>
          </TaskButton>
        );
      })}
    </HistoryPane>
  );
}

function HistoryInspector({ task }) {
  if (!task) {
    return (
      <InspectorPane>
        <EmptyState>No task selected.</EmptyState>
      </InspectorPane>
    );
  }

  const nodes = jsonArray(task.nodes);
  const decisions = jsonArray(task.arbiter_decisions);
  const mutations = jsonArray(task.mutations);
  const terminalPlan = taskTerminalPlan(task);
  const terminalPlanSteps = jsonArray(terminalPlan?.steps);

  return (
    <InspectorPane>
      <InspectorHeader>
        <span>{taskStatus(task)}</span>
        <strong>{text(task.title, "Task")}</strong>
      </InspectorHeader>
      <InspectorPrompt>{taskPrompt(task)}</InspectorPrompt>
      <InspectorGrid>
        <InfoCell>
          <span>Agent</span>
          <strong>{text(task.coding_agent || task.agent_kind || task.agent_id, "unknown")}</strong>
        </InfoCell>
        <InfoCell>
          <span>Started</span>
          <strong>{formatTime(task.started_at || task.created_at) || "unknown"}</strong>
        </InfoCell>
        <InfoCell>
          <span>Finished</span>
          <strong>{formatTime(task.finished_at) || "not finished"}</strong>
        </InfoCell>
      </InspectorGrid>

      {terminalPlan && (
        <>
          <SectionTitle>Terminal Plan</SectionTitle>
          <PlanPanel>
            <PlanPanelHeader>
              <strong>{text(terminalPlan.title, "Terminal task plan")}</strong>
              <StatusPill>{planStatusLabel(terminalPlan.status)}</StatusPill>
            </PlanPanelHeader>
            {terminalPlanSteps.length ? (
              <PlanStepList>
                {terminalPlanSteps.map((step, index) => {
                  const statusKind = planStepStatusKind(step?.status);
                  return (
                    <PlanStepItem data-status={statusKind} key={`${text(step?.title, "step")}-${index}`}>
                      <PlanStepMarker aria-hidden="true" data-status={statusKind} />
                      <div>
                        <strong>{text(step?.title, "Untitled step")}</strong>
                        <span>{planStatusLabel(step?.status)}</span>
                      </div>
                    </PlanStepItem>
                  );
                })}
              </PlanStepList>
            ) : (
              <EmptyState>No plan steps captured for this task.</EmptyState>
            )}
          </PlanPanel>
        </>
      )}

      <SectionTitle>Task Deltas</SectionTitle>
      <DeltaList>
        {nodes.length ? nodes.map((node) => (
          <DeltaItem key={text(node.node_id) || text(node.title)}>
            <strong>{text(node.title || node.display_title || node.node_id, "Architecture item")}</strong>
            <span>
              {Number(node.mutation_count) || 0} change{Number(node.mutation_count) === 1 ? "" : "s"}
            </span>
          </DeltaItem>
        )) : (
          <EmptyState>No graph node deltas for this task.</EmptyState>
        )}
      </DeltaList>

      <SectionTitle>Raw Task Record</SectionTitle>
      <JsonBlock>{JSON.stringify({ task, decisions, mutations }, null, 2)}</JsonBlock>
    </InspectorPane>
  );
}

function RawScanPanel({ error, onRefresh, scan, state }) {
  return (
    <RawShell>
      <RawHeader>
        <div>
          <RawKicker>Local scan</RawKicker>
          <RawTitle>{state === "loading" ? "Scanning..." : "Raw workspace scan"}</RawTitle>
        </div>
        <RawActions>
          <button disabled={state === "loading" || state === "refreshing"} onClick={() => onRefresh()} type="button">
            Refresh
          </button>
          <button disabled={state === "loading" || state === "refreshing"} onClick={() => onRefresh({ includeFolderTrace: true })} type="button">
            Trace
          </button>
        </RawActions>
      </RawHeader>
      {error && <ArchitectureError>{error}</ArchitectureError>}
      <JsonBlock>{JSON.stringify(scan || { state }, null, 2)}</JsonBlock>
    </RawShell>
  );
}

const ArchitectureSurface = styled.section`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  height: 100%;
  color: var(--forge-text);
  background: var(--forge-bg);
`;

const ArchitectureToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 12px 16px;
  border-bottom: 1px solid var(--forge-border);
  background: rgba(15, 23, 42, 0.42);
`;

const ViewToggleGroup = styled.div`
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid var(--forge-border);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.48);
`;

const ViewToggleButton = styled.button`
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-muted);
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 850;
  cursor: pointer;

  &[data-active="true"] {
    color: var(--forge-text);
    background: rgba(148, 163, 184, 0.14);
  }
`;

const ToolbarMeta = styled.span`
  color: var(--forge-text-muted);
  font-size: 13px;
  font-weight: 800;
`;

const ArchitectureError = styled.div`
  margin: 12px 16px 0;
  padding: 9px 11px;
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 8px;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.18);
  font-size: 12px;
  font-weight: 760;
`;

const HistoryShell = styled.div`
  display: grid;
  grid-template-columns: minmax(280px, 0.95fr) minmax(0, 1.35fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
  }
`;

const HistoryPane = styled.div`
  display: grid;
  align-content: start;
  gap: 8px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 14px;
  border-right: 1px solid var(--forge-border);
`;

const InspectorPane = styled.aside`
  display: grid;
  align-content: start;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 16px;
`;

const TaskButton = styled.button`
  display: grid;
  gap: 8px;
  width: 100%;
  min-width: 0;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  color: inherit;
  background: rgba(15, 23, 42, 0.5);
  text-align: left;
  cursor: pointer;

  &[data-selected="true"] {
    border-color: rgba(96, 165, 250, 0.46);
    background: rgba(30, 64, 175, 0.22);
  }
`;

const TaskHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;

  strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 13px;
    line-height: 1.3;
  }
`;

const StatusPill = styled.span`
  flex: 0 0 auto;
  padding: 3px 7px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 850;
  text-transform: uppercase;
`;

const TaskPrompt = styled.p`
  margin: 0;
  color: var(--forge-text-soft);
  font-size: 12px;
  font-weight: 690;
  line-height: 1.45;
`;

const TaskMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  span {
    padding: 3px 6px;
    border: 1px solid rgba(148, 163, 184, 0.14);
    border-radius: 7px;
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 820;
  }
`;

const InspectorHeader = styled.header`
  display: grid;
  gap: 5px;

  span {
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 850;
    text-transform: uppercase;
  }

  strong {
    overflow-wrap: anywhere;
    font-size: 20px;
    line-height: 1.2;
  }
`;

const InspectorPrompt = styled.p`
  margin: 0;
  color: var(--forge-text-soft);
  font-size: 13px;
  line-height: 1.55;
`;

const InspectorGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
  }
`;

const InfoCell = styled.div`
  display: grid;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.38);

  span {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 850;
    text-transform: uppercase;
  }

  strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 12px;
  }
`;

const PlanPanel = styled.div`
  display: grid;
  gap: 0;
  overflow: hidden;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.34);
`;

const PlanPanelHeader = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);

  strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 13px;
  }
`;

const PlanStepList = styled.div`
  display: grid;
`;

const PlanStepItem = styled.div`
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 9px;
  padding: 10px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);

  &:last-child {
    border-bottom: 0;
  }

  strong {
    display: block;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--forge-text);
    font-size: 12px;
    line-height: 1.3;
  }

  span {
    display: block;
    margin-top: 3px;
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 760;
  }
`;

const PlanStepMarker = styled.span`
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 50%;

  &::after {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(148, 163, 184, 0.7);
    content: "";
  }

  &[data-status="completed"] {
    border-color: rgba(74, 222, 128, 0.36);
    background: rgba(34, 197, 94, 0.12);

    &::after {
      width: 8px;
      height: 4px;
      border: 0 solid #a7f3d0;
      border-width: 0 0 2px 2px;
      border-radius: 0;
      background: transparent;
      transform: rotate(-45deg) translate(1px, -1px);
    }
  }

  &[data-status="active"] {
    border-color: rgba(96, 165, 250, 0.42);

    &::after {
      width: 10px;
      height: 10px;
      border: 2px solid rgba(147, 197, 253, 0.24);
      border-top-color: #93c5fd;
      background: transparent;
      animation: architecture-plan-spin 0.8s linear infinite;
    }
  }

  &[data-status="blocked"] {
    border-color: rgba(251, 146, 60, 0.38);
    background: rgba(194, 65, 12, 0.12);

    &::after {
      background: #fed7aa;
    }
  }

  @keyframes architecture-plan-spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const SectionTitle = styled.h3`
  margin: 4px 0 0;
  color: var(--forge-text-muted);
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;
`;

const DeltaList = styled.div`
  display: grid;
  gap: 7px;
`;

const DeltaItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 9px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.32);

  strong {
    min-width: 0;
    overflow-wrap: anywhere;
    font-size: 12px;
  }

  span {
    flex: 0 0 auto;
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 820;
  }
`;

const RawShell = styled.div`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 14px;
`;

const RawHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const RawKicker = styled.div`
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 850;
  text-transform: uppercase;
`;

const RawTitle = styled.strong`
  display: block;
  margin-top: 3px;
  font-size: 16px;
`;

const RawActions = styled.div`
  display: flex;
  gap: 8px;

  button {
    min-height: 32px;
    padding: 0 10px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 8px;
    color: var(--forge-text);
    background: rgba(15, 23, 42, 0.54);
    font: inherit;
    font-size: 12px;
    font-weight: 850;
    cursor: pointer;
  }

  button:disabled {
    cursor: wait;
    opacity: 0.62;
  }
`;

const JsonBlock = styled.pre`
  min-width: 0;
  min-height: 0;
  margin: 0;
  overflow: auto;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  color: #cbd5e1;
  background: rgba(2, 6, 23, 0.72);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const EmptyState = styled.div`
  display: grid;
  place-items: center;
  min-height: 160px;
  padding: 20px;
  border: 1px dashed rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  color: var(--forge-text-muted);
  font-size: 13px;
  font-weight: 760;
`;

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

function taskHistoryFromSnapshot(snapshot) {
  return snapshot?.taskHistory
    || snapshot?.task_history
    || snapshot?.raw?.task_history
    || { kind: "architecture_task_history", version: 1, tasks: [] };
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
  const [viewMode, setViewMode] = useState("history");
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
            data-active={viewMode === "history" ? "true" : "false"}
            onClick={() => setViewMode("history")}
            type="button"
          >
            History
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

      <SectionTitle>History Deltas</SectionTitle>
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

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

function taskTerminalPlan(task) {
  const metadata = jsonObject(task?.metadata_json || task?.metadata);
  return jsonObject(task?.terminal_task_plan)
    || jsonObject(task?.terminalTaskPlan)
    || jsonObject(metadata?.terminal_task_plan)
    || jsonObject(metadata?.terminalTaskPlan);
}

function formatTime(value) {
  const ms = parseTimeMs(value);
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatClockTime(value) {
  const ms = parseTimeMs(value);
  if (!ms) return "";
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function parseTimeMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  const raw = text(value);
  if (!raw) return 0;
  const numeric = raw.match(/^-?\d+(?:\.\d+)?Z?$/u);
  if (numeric) {
    const number = Number(raw.replace(/Z$/u, ""));
    if (Number.isFinite(number)) return number < 10_000_000_000 ? number * 1000 : number;
  }
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function numberValue(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function pathName(value, fallback = "workspace") {
  const raw = text(value, fallback);
  const parts = raw.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || fallback;
}

function shortLabel(value, maxLength = 30) {
  const raw = text(value);
  if (raw.length <= maxLength) return raw;
  if (maxLength <= 3) return raw.slice(0, maxLength);
  return `${raw.slice(0, maxLength - 3)}...`;
}

function formatDurationMs(value) {
  const ms = numberValue(value, 0);
  if (!ms) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function formatTimelineDuration(startMs, endMs, active) {
  if (!startMs) return "";
  const durationMs = (endMs || Date.now()) - startMs;
  const formatted = formatDurationMs(Math.max(0, durationMs));
  if (!formatted) return "";
  return active ? `${formatted} live` : formatted;
}

function taskStartMs(task) {
  return parseTimeMs(task?.started_at)
    || parseTimeMs(task?.task_started_at)
    || parseTimeMs(task?.created_at)
    || parseTimeMs(task?.task_created_at)
    || parseTimeMs(task?.first_mutation_at)
    || parseTimeMs(task?.updated_at)
    || parseTimeMs(task?.last_mutation_at);
}

function taskEndMs(task) {
  return parseTimeMs(task?.finished_at)
    || parseTimeMs(task?.completed_at)
    || parseTimeMs(task?.merged_at);
}

function taskUpdatedMs(task) {
  return parseTimeMs(task?.updated_at)
    || parseTimeMs(task?.task_updated_at)
    || parseTimeMs(task?.last_mutation_at)
    || taskEndMs(task)
    || taskStartMs(task);
}

function taskStatusKind(task) {
  const status = taskStatus(task).toLowerCase().replaceAll("_", "-");
  if (["merged", "done", "completed", "complete", "success"].includes(status)) return "completed";
  if (["active", "running", "started", "claimed", "in-progress", "working"].includes(status)) return "active";
  if (["parked", "waiting", "resume-ready", "resume-requested", "blocked", "queued"].includes(status)) return "parked";
  if (["failed", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled", "interrupted", "rolled back", "rolled-back"].includes(status)) return "stopped";
  return "unknown";
}

function taskStatusLabel(task) {
  const status = taskStatus(task).replaceAll("_", " ");
  return status || "unknown";
}

function taskIsActive(task) {
  return ["active", "parked"].includes(taskStatusKind(task)) && !taskEndMs(task);
}

function taskDisplayTitle(task) {
  const terminalPlan = taskTerminalPlan(task);
  return text(
    terminalPlan?.title
      || task?.plan_title
      || task?.planTitle
      || task?.title
      || task?.start_task_plan
      || task?.body,
    "Untitled task",
  );
}

function buildTimelineItems(tasks) {
  const normalized = jsonArray(tasks)
    .map((task, index) => {
      const startMs = taskStartMs(task);
      const endMs = taskEndMs(task);
      const active = taskIsActive(task);
      return {
        active,
        endMs,
        index,
        label: taskDisplayTitle(task),
        startMs,
        statusKind: taskStatusKind(task),
        statusLabel: taskStatusLabel(task),
        task,
        taskId: text(task?.task_id || task?.id, `task-${index}`),
        updatedMs: taskUpdatedMs(task),
      };
    })
    .filter((item) => item.taskId);

  const ascending = [...normalized].sort((left, right) => (
    (left.startMs || left.updatedMs || 0) - (right.startMs || right.updatedMs || 0)
      || left.index - right.index
  ));
  const laneEnds = [];
  ascending.forEach((item) => {
    const startMs = item.startMs || item.updatedMs || 0;
    const endMs = item.endMs || (item.active ? Date.now() : item.updatedMs || startMs);
    let lane = laneEnds.findIndex((laneEnd) => startMs >= laneEnd);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = Math.max(laneEnds[lane] || 0, endMs || startMs);
    item.lane = lane;
  });

  return {
    laneCount: Math.max(1, laneEnds.length),
    rows: normalized.sort((left, right) => (
      (right.startMs || right.updatedMs || 0) - (left.startMs || left.updatedMs || 0)
        || right.index - left.index
    )),
  };
}

function mountField(mount, camelKey, snakeKey, fallback = "") {
  return text(mount?.[camelKey] ?? mount?.[snakeKey], fallback);
}

function rawGraphNodeKind(mount) {
  const mountKind = mountField(mount, "mountKind", "mount_kind");
  const projectKind = mountField(mount, "projectKind", "project_kind");
  if (mountKind === "container" || projectKind === "container") return "container";
  if (projectKind === "git" || mount?.hasGit === true || mount?.has_git === true) return "git";
  return "project";
}

function rawGraphParentPath(relativePath) {
  const parts = text(relativePath).split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function buildRawScanGraph(scan) {
  const object = jsonObject(scan);
  if (!object) {
    return {
      edges: [],
      nodes: [],
      stats: {
        cacheLabel: "No scan data",
        projectCount: 0,
        sourceLabel: "Waiting",
        workspaceKind: "workspace",
      },
    };
  }

  const nodeMap = new Map();
  const edgeMap = new Map();
  const rootId = "root";
  const rootName = text(object.workspaceName) || pathName(object.root, "workspace");

  const addNode = (node) => {
    const existing = nodeMap.get(node.id) || {};
    nodeMap.set(node.id, {
      ...existing,
      ...node,
      depth: Math.max(numberValue(existing.depth, 0), numberValue(node.depth, 0)),
    });
  };
  const addEdge = (from, to) => {
    if (!from || !to || from === to) return;
    edgeMap.set(`${from}->${to}`, { from, to });
  };

  addNode({
    id: rootId,
    kind: "root",
    label: rootName,
    meta: text(object.workspaceKind, "workspace"),
    path: text(object.root),
    relativePath: "",
    badge: text(object.scanMode, "cached_topology").replaceAll("_", " "),
    depth: 0,
  });

  const mounts = [
    ...jsonArray(object.workspaceMounts),
    ...jsonArray(object.projectMounts),
  ];
  const seenMountKeys = new Set();
  const mountNodes = [];

  mounts.forEach((mount) => {
    const relativePath = mountField(mount, "workspaceRelativePath", "workspace_relative_path");
    const mountId = mountField(mount, "mountId", "mount_id", relativePath || "root");
    const key = mountId || relativePath || mountField(mount, "projectRoot", "project_root");
    if (!key || seenMountKeys.has(key)) return;
    seenMountKeys.add(key);
    if (!relativePath) {
      addNode({
        id: rootId,
        kind: "root",
        label: mountField(mount, "projectName", "project_name", rootName),
        meta: mountField(mount, "projectKind", "project_kind", text(object.workspaceKind, "workspace")),
        path: mountField(mount, "projectRoot", "project_root", text(object.root)),
        relativePath: "",
        badge: mountField(mount, "mountKind", "mount_kind", "root"),
        depth: 0,
      });
      return;
    }
    mountNodes.push({ mount, mountId, relativePath });
    addNode({
      id: `mount:${mountId}`,
      kind: rawGraphNodeKind(mount),
      label: mountField(mount, "projectName", "project_name", pathName(relativePath, "project")),
      meta: relativePath,
      path: mountField(mount, "projectRoot", "project_root"),
      relativePath,
      badge: mountField(mount, "projectKind", "project_kind", "project"),
      depth: numberValue(mount?.mountDepth ?? mount?.mount_depth, relativePath.split("/").filter(Boolean).length),
      mountId,
    });
  });

  const idByMountId = new Map(mountNodes.map((entry) => [entry.mountId, `mount:${entry.mountId}`]));
  const idByPath = new Map(mountNodes.map((entry) => [entry.relativePath, `mount:${entry.mountId}`]));
  mountNodes.forEach(({ mount, mountId, relativePath }) => {
    const parentMountId = mountField(mount, "parentMountId", "parent_mount_id");
    const parentId = idByMountId.get(parentMountId)
      || idByPath.get(rawGraphParentPath(relativePath))
      || rootId;
    addEdge(parentId, `mount:${mountId}`);
  });

  if (nodeMap.size <= 1) {
    const traceEntries = jsonArray(object.folderTrace?.entries);
    const traceIdByPath = new Map();
    traceEntries.forEach((entry, index) => {
      const relativePath = text(entry?.relativePath);
      if (!relativePath && index > 0) return;
      const id = relativePath ? `trace:${relativePath}` : rootId;
      traceIdByPath.set(relativePath, id);
      const depth = numberValue(entry?.depth, relativePath.split("/").filter(Boolean).length);
      addNode({
        id,
        kind: entry?.skipped ? "skipped" : text(entry?.projectKind) === "git" ? "git" : "trace",
        label: relativePath ? pathName(relativePath) : rootName,
        meta: relativePath || text(object.root),
        path: text(entry?.path),
        relativePath,
        badge: text(entry?.scanAction, "scan").replaceAll("_", " "),
        depth,
      });
    });
    traceEntries.forEach((entry, index) => {
      const relativePath = text(entry?.relativePath);
      if (!relativePath && index > 0) return;
      if (!relativePath) return;
      const parentRelativePath = rawGraphParentPath(relativePath);
      const parentId = traceIdByPath.get(parentRelativePath) || idByPath.get(parentRelativePath) || rootId;
      const id = traceIdByPath.get(relativePath);
      if (id !== rootId) {
        addEdge(parentId, id);
      }
    });
  }

  const nodes = Array.from(nodeMap.values());
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.from(edgeMap.values()).filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const cacheStatus = text(object.cache?.status, "missing");
  const cacheAge = formatDurationMs(object.cache?.ageMs);

  return {
    edges,
    nodes,
    stats: {
      cacheLabel: cacheAge ? `${cacheStatus} · ${cacheAge}` : cacheStatus,
      projectCount: jsonArray(object.projectMounts).length,
      sourceLabel: text(object.scanMode, "cached_topology").replaceAll("_", " "),
      workspaceKind: text(object.workspaceKind, "workspace"),
    },
  };
}

function layoutRawScanGraph(graph) {
  const nodes = jsonArray(graph?.nodes);
  if (!nodes.length) {
    return { edges: [], height: 360, nodes: [], width: 760 };
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map();
  jsonArray(graph?.edges).forEach((edge) => {
    if (!byId.has(edge.from) || !byId.has(edge.to)) return;
    if (!childrenByParent.has(edge.from)) childrenByParent.set(edge.from, []);
    childrenByParent.get(edge.from).push(edge.to);
  });

  childrenByParent.forEach((children) => {
    children.sort((left, right) => {
      const leftNode = byId.get(left);
      const rightNode = byId.get(right);
      return numberValue(leftNode?.depth, 0) - numberValue(rightNode?.depth, 0)
        || text(leftNode?.label).localeCompare(text(rightNode?.label));
    });
  });

  const positioned = new Map();
  const visited = new Set();
  let nextY = 54;
  let maxDepth = 0;

  const place = (id, depth = 0) => {
    if (visited.has(id)) return positioned.get(id)?.y || nextY;
    visited.add(id);
    const node = byId.get(id);
    const children = childrenByParent.get(id) || [];
    const childYs = children.map((childId) => place(childId, depth + 1));
    const y = childYs.length
      ? childYs.reduce((sum, value) => sum + value, 0) / childYs.length
      : nextY;
    if (!childYs.length) nextY += 88;
    const nodeDepth = Math.max(depth, numberValue(node?.depth, depth));
    maxDepth = Math.max(maxDepth, nodeDepth);
    positioned.set(id, {
      ...node,
      depth: nodeDepth,
      x: 44 + nodeDepth * 245,
      y,
    });
    return y;
  };

  place("root", 0);
  nodes.forEach((node) => {
    if (!visited.has(node.id)) {
      place(node.id, numberValue(node.depth, 1));
    }
  });

  return {
    edges: jsonArray(graph?.edges),
    height: Math.max(360, nextY + 38),
    nodes: Array.from(positioned.values()),
    width: Math.max(760, 44 + (maxDepth + 1) * 245 + 250),
  };
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
  const [rawScan, setRawScan] = useState(null);
  const [rawScanState, setRawScanState] = useState("idle");
  const [rawScanError, setRawScanError] = useState("");
  const taskHistory = useMemo(() => taskHistoryFromSnapshot(architectureSnapshot), [architectureSnapshot]);
  const tasks = useMemo(() => jsonArray(taskHistory.tasks), [taskHistory]);
  const repoLabel = pathName(repoPath || rootDirectory || defaultWorkingDirectory, "repo");

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
        <ToolbarMeta>Task History · {tasks.length} task{tasks.length === 1 ? "" : "s"} · repo: {repoLabel} · live</ToolbarMeta>
      </ArchitectureToolbar>

      {viewMode === "rawScan" ? (
        <RawScanPanel
          error={rawScanError}
          onRefresh={loadRawScan}
          scan={rawScan}
          state={rawScanState}
        />
      ) : (
        <HistoryTimeline tasks={tasks} repoLabel={repoLabel} />
      )}
      {architectureError && (
        <ArchitectureErrorToast aria-live="polite" role="status" title={architectureError}>
          <strong>Architecture sync issue</strong>
          <span>{architectureError}</span>
        </ArchitectureErrorToast>
      )}
    </ArchitectureSurface>
  );
}

function HistoryTimeline({ tasks, repoLabel }) {
  const timeline = useMemo(() => buildTimelineItems(tasks), [tasks]);

  if (!tasks.length) {
    return (
      <HistoryPane>
        <EmptyState>No task history recorded yet.</EmptyState>
      </HistoryPane>
    );
  }

  return (
    <HistoryPane>
      <TimelineHeader>
        <div>
          <TimelineKicker>Repo timeline</TimelineKicker>
          <TimelineTitle>{repoLabel}</TimelineTitle>
        </div>
        <TimelineSummary>{timeline.rows.length} task{timeline.rows.length === 1 ? "" : "s"} · newest first</TimelineSummary>
      </TimelineHeader>
      <TimelineList style={{ "--timeline-lanes": timeline.laneCount }}>
        {timeline.rows.map((item) => {
          const startLabel = formatTime(item.startMs) || "unknown";
          const finishLabel = item.endMs
            ? formatTime(item.endMs)
            : item.active ? "now" : "not finished";
          const startClock = formatClockTime(item.startMs) || "unknown";
          const finishClock = item.endMs
            ? formatClockTime(item.endMs)
            : item.active ? "now" : "open";
          const duration = formatTimelineDuration(item.startMs, item.endMs, item.active);
          const agent = text(item.task?.coding_agent || item.task?.agent_kind || item.task?.agent_id);

          return (
            <TimelineRow data-status={item.statusKind} key={item.taskId} title={`${item.label}\n${startLabel} -> ${finishLabel}`}>
              <TimelineTrack aria-hidden="true" style={{ "--timeline-lane": item.lane }}>
                <span data-part="trunk" />
                <span data-part="lane" />
                <span data-part="connector" />
                <span data-part="dot" />
              </TimelineTrack>
              <TimelineTask>
                <TimelineTaskName>{item.label}</TimelineTaskName>
                <TimelineTaskMeta>
                  <StatusPill data-status={item.statusKind}>{item.statusLabel}</StatusPill>
                  {agent && <span>{agent}</span>}
                </TimelineTaskMeta>
              </TimelineTask>
              <TimelineTimes>
                <strong>{startClock}</strong>
                <span>{finishClock}</span>
                {duration && <em>{duration}</em>}
              </TimelineTimes>
            </TimelineRow>
          );
        })}
      </TimelineList>
    </HistoryPane>
  );
}

function RawScanPanel({ error, onRefresh, scan, state }) {
  const graph = useMemo(() => buildRawScanGraph(scan), [scan]);
  const hasGraph = graph.nodes.length > 0;

  return (
    <RawShell>
      <RawHeader>
        <div>
          <RawKicker>Local scan</RawKicker>
          <RawTitle>{state === "loading" ? "Scanning..." : "Cached workspace graph"}</RawTitle>
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
      <RawGraphStats>
        <span>{graph.stats.sourceLabel}</span>
        <span>{graph.stats.cacheLabel}</span>
        <span>{graph.stats.workspaceKind}</span>
        <span>{graph.stats.projectCount} project{graph.stats.projectCount === 1 ? "" : "s"}</span>
      </RawGraphStats>
      {hasGraph ? (
        <RawScanGraph graph={graph} />
      ) : (
        <EmptyState>{state === "loading" ? "Loading workspace graph..." : "No cached workspace graph yet."}</EmptyState>
      )}
      <RawDetails>
        <summary>Raw payload</summary>
        <JsonBlock>{JSON.stringify(scan || { state }, null, 2)}</JsonBlock>
      </RawDetails>
    </RawShell>
  );
}

function RawScanGraph({ graph }) {
  const layout = useMemo(() => layoutRawScanGraph(graph), [graph]);
  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );
  const nodeWidth = 206;
  const nodeHeight = 66;

  return (
    <RawGraphViewport>
      <RawGraphSvg
        aria-label="Cached workspace scan graph"
        role="img"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        <defs>
          <marker id="raw-graph-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
            <path d="M0,0 L8,4 L0,8 Z" fill="rgba(147, 197, 253, 0.72)" />
          </marker>
        </defs>
        <g>
          {layout.edges.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (!from || !to) return null;
            const startX = from.x + nodeWidth;
            const startY = from.y;
            const endX = to.x;
            const endY = to.y;
            const midX = startX + Math.max(50, (endX - startX) * 0.52);
            return (
              <path
                className="raw-edge"
                d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                key={`${edge.from}-${edge.to}`}
                markerEnd="url(#raw-graph-arrow)"
              />
            );
          })}
        </g>
        <g>
          {layout.nodes.map((node) => (
            <g data-kind={node.kind} key={node.id} transform={`translate(${node.x}, ${node.y - nodeHeight / 2})`}>
              <title>{[node.label, node.meta, node.path].filter(Boolean).join("\n")}</title>
              <rect className="raw-node-box" height={nodeHeight} rx="8" width={nodeWidth} />
              <circle className="raw-node-dot" cx="18" cy="21" r="5" />
              <text className="raw-node-label" x="32" y="24">{shortLabel(node.label, 24)}</text>
              <text className="raw-node-meta" x="14" y="46">{shortLabel(node.meta || node.relativePath || node.path, 30)}</text>
              <text className="raw-node-badge" x={nodeWidth - 14} y="46" textAnchor="end">{shortLabel(node.badge, 13)}</text>
            </g>
          ))}
        </g>
      </RawGraphSvg>
    </RawGraphViewport>
  );
}

const ArchitectureSurface = styled.section`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
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
  max-height: 76px;
  margin: 0;
  padding: 9px 11px;
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 8px;
  color: #fecaca;
  background: rgba(127, 29, 29, 0.18);
  font-size: 12px;
  font-weight: 760;
  line-height: 1.35;
  overflow: auto;
  overflow-wrap: anywhere;
`;

const ArchitectureErrorToast = styled.div`
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 6;
  display: grid;
  gap: 4px;
  width: min(520px, calc(100% - 32px));
  max-height: 96px;
  padding: 10px 12px;
  overflow: auto;
  border: 1px solid rgba(248, 113, 113, 0.38);
  border-radius: 8px;
  color: #fecaca;
  background:
    linear-gradient(180deg, rgba(127, 29, 29, 0.36), rgba(69, 10, 10, 0.3)),
    rgba(2, 6, 23, 0.94);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.38);
  font-size: 11px;
  line-height: 1.35;
  overflow-wrap: anywhere;

  strong {
    color: #fee2e2;
    font-size: 11px;
    font-weight: 900;
    text-transform: uppercase;
  }

  span {
    color: rgba(254, 202, 202, 0.9);
    font-weight: 720;
  }
`;

const HistoryPane = styled.div`
  display: grid;
  align-content: start;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 10px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 16px;
`;

const TimelineHeader = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  min-width: 0;

  @media (max-width: 700px) {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
`;

const TimelineKicker = styled.div`
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;
`;

const TimelineTitle = styled.strong`
  display: block;
  min-width: 0;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 1.2;
`;

const TimelineSummary = styled.span`
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 820;
`;

const TimelineList = styled.div`
  --timeline-track-width: calc(var(--timeline-lanes) * 18px + 20px);
  display: grid;
  align-content: start;
  min-width: 0;
  overflow: visible;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
`;

const TimelineRow = styled.div`
  display: grid;
  grid-template-columns: var(--timeline-track-width) minmax(0, 1fr) minmax(150px, 220px);
  min-width: 0;
  min-height: 58px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  color: var(--forge-text);

  &[data-status="active"] {
    background: rgba(37, 99, 235, 0.08);
  }

  &[data-status="parked"] {
    background: rgba(217, 119, 6, 0.06);
  }

  @media (max-width: 700px) {
    grid-template-columns: var(--timeline-track-width) minmax(0, 1fr);
  }
`;

const TimelineTrack = styled.div`
  --timeline-lane-x: calc(10px + var(--timeline-lane) * 18px);
  position: relative;
  min-width: 0;

  span {
    position: absolute;
    display: block;
    pointer-events: none;
  }

  [data-part="trunk"],
  [data-part="lane"] {
    top: 0;
    bottom: 0;
    width: 2px;
    border-radius: 2px;
    background: rgba(71, 85, 105, 0.72);
  }

  [data-part="trunk"] {
    left: 10px;
  }

  [data-part="lane"] {
    left: var(--timeline-lane-x);
    background: rgba(96, 165, 250, 0.5);
  }

  [data-part="connector"] {
    top: 28px;
    left: 10px;
    width: calc(var(--timeline-lane) * 18px);
    height: 2px;
    border-radius: 2px;
    background: rgba(96, 165, 250, 0.5);
  }

  [data-part="dot"] {
    top: 22px;
    left: calc(var(--timeline-lane-x) - 5px);
    width: 12px;
    height: 12px;
    border: 2px solid rgba(15, 23, 42, 0.96);
    border-radius: 50%;
    background: #93c5fd;
    box-shadow: 0 0 0 1px rgba(147, 197, 253, 0.5);
  }

  ${TimelineRow}[data-status="completed"] & [data-part="dot"] {
    background: #34d399;
    box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.5);
  }

  ${TimelineRow}[data-status="active"] & [data-part="dot"] {
    background: #60a5fa;
    box-shadow: 0 0 0 1px rgba(96, 165, 250, 0.62), 0 0 18px rgba(96, 165, 250, 0.3);
  }

  ${TimelineRow}[data-status="parked"] & [data-part="dot"] {
    background: #f59e0b;
    box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.5);
  }

  ${TimelineRow}[data-status="failed"] & [data-part="dot"],
  ${TimelineRow}[data-status="stopped"] & [data-part="dot"] {
    background: #fb7185;
    box-shadow: 0 0 0 1px rgba(251, 113, 133, 0.5);
  }
`;

const TimelineTask = styled.div`
  display: grid;
  align-content: center;
  gap: 5px;
  min-width: 0;
  padding: 9px 10px 9px 0;
`;

const TimelineTaskName = styled.strong`
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 1.25;
`;

const TimelineTaskMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;

  > span:not([data-status]) {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text-muted);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 780;
  }
`;

const StatusPill = styled.span`
  flex: 0 0 auto;
  padding: 3px 7px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 7px;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 850;
  text-transform: uppercase;

  &[data-status="completed"] {
    border-color: rgba(52, 211, 153, 0.28);
    color: #a7f3d0;
    background: rgba(6, 78, 59, 0.2);
  }

  &[data-status="active"] {
    border-color: rgba(96, 165, 250, 0.32);
    color: #bfdbfe;
    background: rgba(30, 64, 175, 0.2);
  }

  &[data-status="parked"] {
    border-color: rgba(245, 158, 11, 0.3);
    color: #fde68a;
    background: rgba(120, 53, 15, 0.18);
  }

  &[data-status="failed"],
  &[data-status="stopped"] {
    border-color: rgba(251, 113, 133, 0.3);
    color: #fecdd3;
    background: rgba(127, 29, 29, 0.18);
  }
`;

const TimelineTimes = styled.div`
  display: grid;
  align-content: center;
  justify-items: end;
  gap: 2px;
  min-width: 0;
  padding: 8px 0 8px 10px;
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 760;

  strong {
    min-width: 0;
    color: var(--forge-text);
    font-size: 11px;
    font-weight: 850;
  }

  span,
  em {
    min-width: 0;
    overflow: hidden;
    max-width: 100%;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    color: rgba(148, 163, 184, 0.78);
    font-style: normal;
  }

  @media (max-width: 700px) {
    grid-column: 2;
    grid-template-columns: auto auto minmax(0, 1fr);
    justify-items: start;
    gap: 8px;
    padding: 0 0 10px;
  }
`;

const RawShell = styled.div`
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
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

const RawGraphStats = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 7px;

  span {
    padding: 4px 7px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    color: var(--forge-text-muted);
    background: rgba(15, 23, 42, 0.42);
    font-size: 11px;
    font-weight: 820;
  }
`;

const RawGraphViewport = styled.div`
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background:
    linear-gradient(rgba(96, 165, 250, 0.035) 1px, transparent 1px),
    linear-gradient(90deg, rgba(96, 165, 250, 0.035) 1px, transparent 1px),
    rgba(2, 6, 23, 0.72);
  background-size: 26px 26px;
`;

const RawGraphSvg = styled.svg`
  display: block;
  min-width: 760px;
  min-height: 360px;

  .raw-edge {
    fill: none;
    stroke: rgba(147, 197, 253, 0.5);
    stroke-width: 2;
  }

  .raw-node-box {
    fill: rgba(15, 23, 42, 0.92);
    stroke: rgba(148, 163, 184, 0.24);
    stroke-width: 1.4;
  }

  .raw-node-dot {
    fill: #94a3b8;
  }

  .raw-node-label {
    fill: #f8fafc;
    font-size: 13px;
    font-weight: 850;
  }

  .raw-node-meta,
  .raw-node-badge {
    fill: rgba(203, 213, 225, 0.68);
    font-size: 10px;
    font-weight: 760;
  }

  [data-kind="root"] .raw-node-box {
    fill: rgba(30, 64, 175, 0.28);
    stroke: rgba(96, 165, 250, 0.55);
  }

  [data-kind="root"] .raw-node-dot {
    fill: #60a5fa;
  }

  [data-kind="git"] .raw-node-box {
    fill: rgba(20, 83, 45, 0.2);
    stroke: rgba(52, 211, 153, 0.42);
  }

  [data-kind="git"] .raw-node-dot {
    fill: #34d399;
  }

  [data-kind="project"] .raw-node-box {
    fill: rgba(8, 47, 73, 0.24);
    stroke: rgba(56, 189, 248, 0.34);
  }

  [data-kind="project"] .raw-node-dot {
    fill: #38bdf8;
  }

  [data-kind="container"] .raw-node-box {
    fill: rgba(120, 53, 15, 0.18);
    stroke: rgba(251, 191, 36, 0.36);
  }

  [data-kind="container"] .raw-node-dot {
    fill: #fbbf24;
  }

  [data-kind="skipped"] {
    opacity: 0.62;
  }
`;

const RawDetails = styled.details`
  min-width: 0;

  summary {
    cursor: pointer;
    color: var(--forge-text-muted);
    font-size: 11px;
    font-weight: 850;
  }

  &[open] {
    display: grid;
    gap: 8px;
  }

  & > pre {
    max-height: 220px;
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

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

function formatRelativeTimeMs(value, nowMs = Date.now()) {
  const ms = parseTimeMs(value);
  if (!ms) return "";
  const deltaMs = Math.max(0, nowMs - ms);
  if (deltaMs < 45_000) return "now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(deltaMs / 3_600_000);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(deltaMs / 86_400_000);
  if (days < 14) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  if (weeks < 8) return `${weeks}w ago`;
  return formatTime(ms);
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
  if (["merged", "applied", "done", "completed", "complete", "success", "idle", "ready", "prompt-ready"].includes(status)) return "done";
  if (["active", "running", "started", "claimed", "in-progress", "working", "starting"].includes(status)) return "active";
  if (["integrator-reviewing", "merge-queued", "patch-submitted", "resolved-patch-submitted", "review", "submitted"].includes(status)) return "active";
  if (["queued", "dispatched"].includes(status)) return "queued";
  if (["blocked"].includes(status)) return "blocked";
  if (["parked", "waiting", "paused", "resume-ready", "resume-requested"].includes(status)) return "parked";
  if (["failed", "error"].includes(status)) return "failed";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["interrupted"].includes(status)) return "interrupted";
  if (["rolled back", "rolled-back"].includes(status)) return "rolled-back";
  if (["skipped"].includes(status)) return "skipped";
  return "unknown";
}

const TASK_TIMELINE_STATUS_LABELS = {
  active: "Active",
  blocked: "Blocked",
  cancelled: "Cancelled",
  done: "Done",
  failed: "Failed",
  interrupted: "Interrupted",
  parked: "Parked",
  queued: "Queued",
  "rolled-back": "Rolled Back",
  skipped: "Skipped",
  unknown: "Unknown",
};

function taskStatusLabel(task) {
  const status = taskStatus(task).replaceAll("_", " ");
  return status || "unknown";
}

function terminalPlanStatusKind(plan) {
  const status = text(plan?.status).toLowerCase().replaceAll("_", "-");
  if (["complete", "completed", "done", "finished", "success"].includes(status)) return "completed";
  if (["interrupted", "cancelled", "canceled", "stopped"].includes(status)) return "interrupted";
  if (["blocked"].includes(status)) return "blocked";
  return status ? "active" : "unknown";
}

function taskTimelineStatusLabel(task) {
  return TASK_TIMELINE_STATUS_LABELS[taskStatusKind(task)] || TASK_TIMELINE_STATUS_LABELS.unknown;
}

function taskIsActive(task) {
  return ["active", "parked"].includes(taskStatusKind(task)) && !taskEndMs(task);
}

function taskDisplayTitle(task) {
  const metadata = jsonObject(task?.metadata_json || task?.metadata);
  const terminalPlan = taskTerminalPlan(task);
  return text(
    terminalPlan?.title
      || terminalPlan?.name
      || task?.plan_title
      || task?.planTitle
      || metadata?.plan_title
      || metadata?.planTitle
      || task?.title
      || task?.name
      || metadata?.title
      || metadata?.name,
    "Untitled plan",
  );
}

function taskBody(task) {
  const terminalPlan = taskTerminalPlan(task);
  const metadata = jsonObject(task?.metadata_json || task?.metadata);
  return text(
    task?.body
      || task?.prompt
      || task?.input
      || task?.user_input
      || task?.userInput
      || task?.description
      || task?.details
      || task?.summary
      || task?.request
      || metadata?.body
      || metadata?.prompt
      || metadata?.input
      || metadata?.user_input
      || metadata?.userInput
      || terminalPlan?.description
      || terminalPlan?.detail
      || task?.start_task_plan,
  );
}

function taskAgentLabel(task) {
  return text(task?.coding_agent || task?.agent_kind || task?.agent || task?.agent_id);
}

function taskRelativeStamp(item) {
  if (!item) return "";
  if (item.active) return "live now";
  const referenceMs = item.endMs || item.updatedMs || item.startMs;
  return formatRelativeTimeMs(referenceMs) || "unknown";
}

function addUniqueInputBlock(blocks, label, value) {
  const content = text(value);
  if (!content || blocks.some((block) => block.content === content)) return;
  blocks.push({ content, label });
}

function taskInputBlocks(task) {
  const metadata = jsonObject(task?.metadata_json || task?.metadata);
  const terminalPlan = taskTerminalPlan(task);
  const blocks = [];

  addUniqueInputBlock(blocks, "Input", task?.input);
  addUniqueInputBlock(blocks, "Input", task?.user_input);
  addUniqueInputBlock(blocks, "Input", task?.userInput);
  addUniqueInputBlock(blocks, "Input", task?.prompt);
  addUniqueInputBlock(blocks, "Input", task?.body);
  addUniqueInputBlock(blocks, "Input", task?.request);
  addUniqueInputBlock(blocks, "Input", task?.description);
  addUniqueInputBlock(blocks, "Input", metadata?.input);
  addUniqueInputBlock(blocks, "Input", metadata?.user_input);
  addUniqueInputBlock(blocks, "Input", metadata?.userInput);
  addUniqueInputBlock(blocks, "Input", metadata?.prompt);
  addUniqueInputBlock(blocks, "Input", metadata?.body);
  addUniqueInputBlock(blocks, "Input", metadata?.request);
  addUniqueInputBlock(blocks, "Input", terminalPlan?.description);

  addUniqueInputBlock(blocks, "Park resume", task?.parked_prompt);
  addUniqueInputBlock(blocks, "Park resume", task?.parkedPrompt);
  addUniqueInputBlock(blocks, "Park resume", task?.parked_resume_input);
  addUniqueInputBlock(blocks, "Park resume", task?.parkedResumeInput);
  addUniqueInputBlock(blocks, "Park resume", task?.resume_prompt);
  addUniqueInputBlock(blocks, "Park resume", task?.resumePrompt);
  addUniqueInputBlock(blocks, "Park resume", task?.resume_input);
  addUniqueInputBlock(blocks, "Park resume", task?.resumeInput);
  addUniqueInputBlock(blocks, "Park resume", metadata?.parked_prompt);
  addUniqueInputBlock(blocks, "Park resume", metadata?.parkedPrompt);
  addUniqueInputBlock(blocks, "Park resume", metadata?.parked_resume_input);
  addUniqueInputBlock(blocks, "Park resume", metadata?.parkedResumeInput);
  addUniqueInputBlock(blocks, "Park resume", metadata?.resume_prompt);
  addUniqueInputBlock(blocks, "Park resume", metadata?.resumePrompt);
  addUniqueInputBlock(blocks, "Park resume", metadata?.resume_input);
  addUniqueInputBlock(blocks, "Park resume", metadata?.resumeInput);
  addUniqueInputBlock(blocks, "Park resume", metadata?.resume_instruction);
  addUniqueInputBlock(blocks, "Park resume", metadata?.resumeInstruction);

  return blocks;
}

function planStepStatusKind(step) {
  const status = text(step?.status || step?.state || step?.phase).toLowerCase().replaceAll("_", "-");
  if (["complete", "completed", "done", "finished", "success"].includes(status)) return "completed";
  if (["active", "current", "in-progress", "running", "working", "pending"].includes(status)) return "active";
  if (["blocked", "interrupted"].includes(status)) return "blocked";
  if (["skipped"].includes(status)) return "skipped";
  if (["cancelled", "canceled", "failed", "error"].includes(status)) return "failed";
  return "queued";
}

function planStepStatusLabel(step) {
  const kind = planStepStatusKind(step);
  if (kind === "completed") return "Done";
  if (kind === "active") return "Active";
  if (kind === "blocked") return "Blocked";
  if (kind === "skipped") return "Skipped";
  if (kind === "failed") return "Failed";
  return "Queued";
}

function planStepTitle(step, index) {
  return text(
    step?.title
      || step?.step
      || step?.task
      || step?.objective
      || (typeof step === "string" ? step : ""),
    `Step ${index + 1}`,
  );
}

function planStepDetail(step) {
  return text(
    step?.detail
      || step?.details
      || step?.description
      || step?.done_when
      || step?.doneWhen
      || step?.summary
      || step?.result,
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
        statusLabel: taskTimelineStatusLabel(task),
        rawStatusLabel: taskStatusLabel(task),
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
  rawScanError = "",
  rawScanSnapshot = null,
  rawScanState = "idle",
  workspace,
}) {
  const workspaceId = workspace?.id || "";
  const workspaceName = workspace?.name || "";
  const repoPath = workspaceId ? rootDirectory || defaultWorkingDirectory || "" : "";
  const [viewMode, setViewMode] = useState("taskHistory");
  const [localArchitectureSnapshot, setLocalArchitectureSnapshot] = useState(architectureSnapshot);
  const [finishPlanState, setFinishPlanState] = useState({ error: "", taskId: "" });
  const activeArchitectureSnapshot = localArchitectureSnapshot || architectureSnapshot;
  const taskHistory = useMemo(() => taskHistoryFromSnapshot(activeArchitectureSnapshot), [activeArchitectureSnapshot]);
  const tasks = useMemo(() => jsonArray(taskHistory.tasks), [taskHistory]);
  const repoLabel = pathName(repoPath || rootDirectory || defaultWorkingDirectory, "repo");

  useEffect(() => {
    setLocalArchitectureSnapshot(architectureSnapshot);
  }, [architectureSnapshot]);

  const refreshTaskHistorySnapshot = useCallback(() => {
    if (!repoPath || !workspaceId) {
      return Promise.resolve(null);
    }
    return invoke("cloud_mcp_get_task_history", {
      repoPath,
      workspaceId,
      workspaceName,
    }).then((result) => {
      setLocalArchitectureSnapshot(result);
      return result;
    });
  }, [repoPath, workspaceId, workspaceName]);

  const finishTerminalTaskPlan = useCallback((item) => {
    const task = item?.task || null;
    const terminalPlan = taskTerminalPlan(task);
    const taskId = text(
      terminalPlan?.task_id
        || terminalPlan?.taskId
        || task?.task_id
        || task?.id
        || item?.taskId,
    );
    if (!taskId || !repoPath) return;

    setFinishPlanState({ error: "", taskId });
    invoke("coordination_terminal_task_plan_finish", {
      repoPath,
      input: {
        agent_id: terminalPlan?.agent_id || terminalPlan?.agentId || task?.agent_id || task?.agentId || taskAgentLabel(task),
        session_id: terminalPlan?.session_id || terminalPlan?.sessionId || task?.session_id || task?.sessionId,
        task_id: taskId,
        workspace_id: workspaceId,
      },
    })
      .then(() => refreshTaskHistorySnapshot())
      .catch((error) => {
        setFinishPlanState({
          error: error?.message || String(error || "Unable to finish terminal plan."),
          taskId: "",
        });
      })
      .finally(() => {
        setFinishPlanState((current) => (
          current.taskId === taskId ? { ...current, taskId: "" } : current
        ));
      });
  }, [refreshTaskHistorySnapshot, repoPath, workspaceId]);

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
          scan={rawScanSnapshot}
          state={rawScanState}
        />
      ) : (
        <HistoryTimeline
          finishPlanError={finishPlanState.error}
          finishingPlanTaskId={finishPlanState.taskId}
          onFinishPlan={finishTerminalTaskPlan}
          tasks={tasks}
          repoLabel={repoLabel}
        />
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

function HistoryTimeline({
  finishPlanError = "",
  finishingPlanTaskId = "",
  onFinishPlan,
  repoLabel,
  tasks,
}) {
  const timeline = useMemo(() => buildTimelineItems(tasks), [tasks]);
  const [selectedTaskId, setSelectedTaskId] = useState("");

  useEffect(() => {
    if (!timeline.rows.length) {
      if (selectedTaskId) setSelectedTaskId("");
      return;
    }
    if (!timeline.rows.some((item) => item.taskId === selectedTaskId)) {
      setSelectedTaskId(timeline.rows[0].taskId);
    }
  }, [selectedTaskId, timeline.rows]);

  const selectedItem = timeline.rows.find((item) => item.taskId === selectedTaskId)
    || timeline.rows[0]
    || null;

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
      <HistorySplit>
        <TimelineList aria-label="Task history timeline" style={{ "--timeline-lanes": timeline.laneCount }}>
          {timeline.rows.map((item) => {
            const startLabel = formatTime(item.startMs) || "unknown";
            const finishLabel = item.endMs
              ? formatTime(item.endMs)
              : item.active ? "now" : "not finished";
            const duration = formatTimelineDuration(item.startMs, item.endMs, item.active);
            const relativeStamp = taskRelativeStamp(item);

            return (
              <TimelineRow
                aria-pressed={selectedItem?.taskId === item.taskId}
                data-selected={selectedItem?.taskId === item.taskId ? "true" : "false"}
                data-status={item.statusKind}
                key={item.taskId}
                onClick={() => setSelectedTaskId(item.taskId)}
                title={`${item.label}\n${startLabel} -> ${finishLabel}`}
                type="button"
              >
                <TimelineTrack aria-hidden="true" style={{ "--timeline-lane": item.lane }}>
                  <span data-part="trunk" />
                  <span data-part="lane" />
                  <span data-part="connector" />
                  <span data-part="dot" />
                </TimelineTrack>
                <TimelineTask>
                  <TimelineTaskLine>
                    <TimelineTaskName>{item.label}</TimelineTaskName>
                    <StatusPill data-status={item.statusKind} title={`Actual status: ${item.rawStatusLabel}`}>
                      {item.statusLabel}
                    </StatusPill>
                  </TimelineTaskLine>
                </TimelineTask>
                <TimelineTimes>
                  <strong>{relativeStamp}</strong>
                  {duration && <em>{duration}</em>}
                </TimelineTimes>
              </TimelineRow>
            );
          })}
        </TimelineList>
        <TaskDetailPanel
          finishPlanError={finishPlanError}
          finishingPlanTaskId={finishingPlanTaskId}
          item={selectedItem}
          onFinishPlan={onFinishPlan}
          repoLabel={repoLabel}
        />
      </HistorySplit>
    </HistoryPane>
  );
}

function TaskDetailPanel({
  finishPlanError = "",
  finishingPlanTaskId = "",
  item,
  onFinishPlan,
  repoLabel,
}) {
  if (!item) {
    return (
      <TaskDetails>
        <EmptyState>Select a task to inspect it.</EmptyState>
      </TaskDetails>
    );
  }

  const task = item.task;
  const terminalPlan = taskTerminalPlan(task);
  const duration = formatTimelineDuration(item.startMs, item.endMs, item.active) || "unknown";
  const agent = taskAgentLabel(task) || "unknown";
  const body = taskBody(task);
  const title = item.label;
  const relativeStamp = taskRelativeStamp(item);
  const updatedRelative = formatRelativeTimeMs(item.updatedMs || item.endMs || item.startMs) || relativeStamp;
  const taskId = text(terminalPlan?.task_id || terminalPlan?.taskId || task?.task_id || task?.id || item.taskId);
  const planKey = text(terminalPlan?.plan_id || terminalPlan?.planId, taskId);
  const planSteps = jsonArray(terminalPlan?.steps);
  const planDetail = text(terminalPlan?.description || terminalPlan?.detail || terminalPlan?.summary);
  const inputBlocks = taskInputBlocks(task);
  const canFinishPlan = Boolean(
    terminalPlan
      && taskId
      && terminalPlanStatusKind(terminalPlan) !== "completed"
      && typeof onFinishPlan === "function",
  );
  const finishingPlan = finishingPlanTaskId === taskId;

  return (
    <TaskDetails aria-label="Selected task details">
      <TaskDetailsHeader>
        <div>
          <TimelineKicker>{repoLabel}</TimelineKicker>
          <TaskDetailsTitle>{title}</TaskDetailsTitle>
        </div>
        <TaskDetailsHeaderActions>
          <TaskDetailsUpdated>Updated {updatedRelative}</TaskDetailsUpdated>
          <StatusPill data-status={item.statusKind} title={`Actual status: ${item.rawStatusLabel}`}>
            {item.statusLabel}
          </StatusPill>
          {canFinishPlan && (
            <FinishPlanButton
              disabled={finishingPlan}
              onClick={() => onFinishPlan(item)}
              type="button"
            >
              {finishingPlan ? "Finishing..." : "Finish plan"}
            </FinishPlanButton>
          )}
        </TaskDetailsHeaderActions>
      </TaskDetailsHeader>
      <TaskMetaStrip>
        <TaskMetaChip>
          <span>Agent</span>
          <strong>{agent}</strong>
        </TaskMetaChip>
        <TaskMetaChip>
          <span>Duration</span>
          <strong>{duration}</strong>
        </TaskMetaChip>
      </TaskMetaStrip>
      <TaskInputPanel>
        {(inputBlocks.length ? inputBlocks : [{ content: body || "No agent input recorded.", label: "Input" }])
          .map((block, index) => (
            <TaskInputBlock key={`${block.label}-${index}-${block.content.slice(0, 24)}`}>
              <span>{block.label}</span>
              <p>{block.content}</p>
            </TaskInputBlock>
          ))}
      </TaskInputPanel>
      {terminalPlan && (
        <TaskPlanCard>
          <TaskPlanHeader>
            <span>Terminal plan</span>
            <strong>{text(terminalPlan.title, title)}</strong>
          </TaskPlanHeader>
          {planDetail && <TaskPlanDescription>{planDetail}</TaskPlanDescription>}
          {planSteps.length > 0 && (
            <TaskPlanSteps>
              {planSteps.map((step, index) => {
                const stepStatus = planStepStatusKind(step);
                const stepDetail = planStepDetail(step);
                return (
                  <TaskPlanStep data-status={stepStatus} key={`${planKey}-step-${text(step?.id || step?.index, index)}`}>
                    <TaskPlanStepMarker aria-hidden="true" data-status={stepStatus}>
                      <span />
                    </TaskPlanStepMarker>
                    <TaskPlanStepContent>
                      <TaskPlanStepTitleRow>
                        <strong>{planStepTitle(step, index)}</strong>
                        <TaskPlanStepBadge data-status={stepStatus}>{planStepStatusLabel(step)}</TaskPlanStepBadge>
                      </TaskPlanStepTitleRow>
                      {stepDetail && <p>{stepDetail}</p>}
                    </TaskPlanStepContent>
                  </TaskPlanStep>
                );
              })}
            </TaskPlanSteps>
          )}
        </TaskPlanCard>
      )}
      {finishPlanError && <TaskActionError>{finishPlanError}</TaskActionError>}
    </TaskDetails>
  );
}

function RawScanPanel({ error, scan, state }) {
  const graph = useMemo(() => buildRawScanGraph(scan), [scan]);
  const hasGraph = graph.nodes.length > 0;
  const isLoading = state === "loading";

  return (
    <RawShell>
      <RawHeader>
        <div>
          <RawKicker>Startup cache</RawKicker>
          <RawTitle>{isLoading ? "Loading cached workspace graph..." : "Cached workspace graph"}</RawTitle>
        </div>
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
        <EmptyState>{isLoading ? "Loading startup workspace graph..." : "No startup workspace graph cached yet."}</EmptyState>
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
  overflow: hidden;
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

const HistorySplit = styled.div`
  display: grid;
  grid-template-columns: minmax(420px, 0.95fr) minmax(340px, 1.05fr);
  gap: 12px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

const TimelineList = styled.div`
  --timeline-lane-gap: 14px;
  --timeline-line-center: 15px;
  --timeline-track-width: calc(var(--timeline-lanes) * var(--timeline-lane-gap) + 26px);
  display: grid;
  align-content: start;
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border-top: 1px solid rgba(148, 163, 184, 0.12);

  &::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 14px;
    z-index: 1;
    width: 2px;
    border-radius: 2px;
    background: linear-gradient(180deg, rgba(71, 85, 105, 0.3), rgba(96, 165, 250, 0.58), rgba(71, 85, 105, 0.3));
    content: "";
    pointer-events: none;
  }
`;

const TimelineRow = styled.button`
  display: grid;
  grid-template-columns: var(--timeline-track-width) minmax(0, 1fr) minmax(78px, 104px);
  position: relative;
  width: 100%;
  min-width: 0;
  min-height: 36px;
  padding: 0;
  border: 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.1);
  color: var(--forge-text);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 140ms ease, box-shadow 140ms ease;

  &:hover {
    background: rgba(148, 163, 184, 0.055);
  }

  &:focus-visible {
    outline: 2px solid rgba(96, 165, 250, 0.7);
    outline-offset: -2px;
  }

  &[data-selected="true"] {
    background: rgba(37, 99, 235, 0.13);
    box-shadow: inset 2px 0 0 rgba(96, 165, 250, 0.75);
  }

  &[data-status="active"] {
    background: rgba(37, 99, 235, 0.08);
  }

  &[data-status="queued"] {
    background: rgba(14, 165, 233, 0.055);
  }

  &[data-status="blocked"] {
    background: rgba(217, 119, 6, 0.085);
  }

  &[data-status="parked"] {
    background: rgba(217, 119, 6, 0.06);
  }

  &[data-selected="true"][data-status="active"] {
    background: rgba(37, 99, 235, 0.16);
  }

  &[data-selected="true"][data-status="parked"] {
    background: rgba(217, 119, 6, 0.12);
  }

  &[data-selected="true"][data-status="queued"] {
    background: rgba(14, 165, 233, 0.12);
  }

  &[data-selected="true"][data-status="blocked"] {
    background: rgba(217, 119, 6, 0.16);
  }

  @media (max-width: 700px) {
    grid-template-columns: var(--timeline-track-width) minmax(0, 1fr);
  }
`;

const TimelineTrack = styled.div`
  --timeline-lane-x: calc(var(--timeline-line-center) + var(--timeline-lane) * var(--timeline-lane-gap));
  align-self: stretch;
  position: relative;
  height: 100%;
  min-width: 0;
  min-height: 36px;

  span {
    position: absolute;
    z-index: 2;
    display: block;
    pointer-events: none;
  }

  [data-part="trunk"],
  [data-part="lane"] {
    top: -1px;
    bottom: -1px;
    width: 2px;
    border-radius: 2px;
    background: linear-gradient(180deg, rgba(71, 85, 105, 0.38), rgba(96, 165, 250, 0.5), rgba(71, 85, 105, 0.38));
  }

  [data-part="trunk"] {
    left: calc(var(--timeline-line-center) - 1px);
    background: transparent;
  }

  [data-part="lane"] {
    left: calc(var(--timeline-lane-x) - 1px);
    background: linear-gradient(180deg, rgba(96, 165, 250, 0.12), rgba(96, 165, 250, 0.56), rgba(96, 165, 250, 0.12));
  }

  [data-part="connector"] {
    top: 50%;
    left: var(--timeline-line-center);
    width: calc(var(--timeline-lane) * var(--timeline-lane-gap));
    height: 0;
    border-bottom: 2px solid rgba(96, 165, 250, 0.5);
    border-left: 2px solid rgba(96, 165, 250, 0.24);
    border-bottom-left-radius: 14px;
    transform: translateY(-1px);
  }

  [data-part="dot"] {
    top: 50%;
    left: var(--timeline-lane-x);
    z-index: 3;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(15, 23, 42, 0.96);
    border-radius: 50%;
    box-sizing: border-box;
    background: #93c5fd;
    box-shadow: 0 0 0 1px rgba(147, 197, 253, 0.5);
    transform: translate(-50%, -50%);
  }

  ${TimelineRow}[data-status="done"] & [data-part="dot"] {
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

  ${TimelineRow}[data-status="queued"] & [data-part="dot"] {
    background: #38bdf8;
    box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.46);
  }

  ${TimelineRow}[data-status="blocked"] & [data-part="dot"] {
    background: #f97316;
    box-shadow: 0 0 0 1px rgba(249, 115, 22, 0.5);
  }

  ${TimelineRow}[data-status="failed"] & [data-part="dot"],
  ${TimelineRow}[data-status="cancelled"] & [data-part="dot"],
  ${TimelineRow}[data-status="interrupted"] & [data-part="dot"],
  ${TimelineRow}[data-status="rolled-back"] & [data-part="dot"] {
    background: #fb7185;
    box-shadow: 0 0 0 1px rgba(251, 113, 133, 0.5);
  }

  ${TimelineRow}[data-status="skipped"] & [data-part="dot"] {
    background: #94a3b8;
    box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.44);
  }
`;

const TimelineTask = styled.div`
  display: grid;
  align-content: center;
  min-width: 0;
  padding: 5px 10px 5px 0;
`;

const TimelineTaskLine = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
`;

const TimelineTaskName = styled.strong`
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 1.25;
`;

const StatusPill = styled.span`
  flex: 0 0 auto;
  padding: 2px 5px;
  border: 1px solid rgba(148, 163, 184, 0.11);
  border-radius: 6px;
  color: rgba(148, 163, 184, 0.72);
  font-size: 8px;
  font-weight: 820;
  line-height: 1.05;
  text-transform: uppercase;

  &[data-status="done"] {
    border-color: rgba(52, 211, 153, 0.16);
    color: rgba(167, 243, 208, 0.72);
    background: rgba(6, 78, 59, 0.11);
  }

  &[data-status="active"] {
    border-color: rgba(96, 165, 250, 0.18);
    color: rgba(191, 219, 254, 0.74);
    background: rgba(30, 64, 175, 0.12);
  }

  &[data-status="queued"] {
    border-color: rgba(56, 189, 248, 0.16);
    color: rgba(186, 230, 253, 0.72);
    background: rgba(8, 47, 73, 0.11);
  }

  &[data-status="blocked"] {
    border-color: rgba(249, 115, 22, 0.18);
    color: rgba(254, 215, 170, 0.74);
    background: rgba(124, 45, 18, 0.12);
  }

  &[data-status="parked"] {
    border-color: rgba(245, 158, 11, 0.17);
    color: rgba(253, 230, 138, 0.72);
    background: rgba(120, 53, 15, 0.11);
  }

  &[data-status="failed"],
  &[data-status="interrupted"],
  &[data-status="rolled-back"] {
    border-color: rgba(251, 113, 133, 0.18);
    color: rgba(254, 205, 211, 0.72);
    background: rgba(127, 29, 29, 0.11);
  }

  &[data-status="cancelled"],
  &[data-status="skipped"] {
    border-color: rgba(148, 163, 184, 0.14);
    color: rgba(203, 213, 225, 0.66);
    background: rgba(51, 65, 85, 0.1);
  }
`;

const TimelineTimes = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 1px;
  min-width: 0;
  padding: 5px 0 5px 8px;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 760;
  white-space: nowrap;

  strong {
    min-width: 0;
    color: var(--forge-text);
    font-size: 10px;
    font-weight: 850;
    line-height: 1.15;
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
    font-size: 9px;
    font-style: normal;
  }

  @media (max-width: 700px) {
    grid-column: 2;
    justify-items: start;
    gap: 8px;
    padding: 0 0 10px;
  }
`;

const TaskDetails = styled.aside`
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 14px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.28);
`;

const TaskDetailsHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
`;

const TaskDetailsHeaderActions = styled.div`
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  min-width: 0;
`;

const TaskDetailsUpdated = styled.span`
  color: rgba(148, 163, 184, 0.72);
  font-size: 10px;
  font-weight: 760;
  white-space: nowrap;
`;

const FinishPlanButton = styled.button`
  min-height: 24px;
  padding: 0 8px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 7px;
  color: rgba(191, 219, 254, 0.84);
  background: rgba(30, 64, 175, 0.14);
  font: inherit;
  font-size: 9px;
  font-weight: 850;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(96, 165, 250, 0.3);
    color: rgba(219, 234, 254, 0.94);
    background: rgba(37, 99, 235, 0.2);
  }

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`;

const TaskDetailsTitle = styled.strong`
  display: block;
  min-width: 0;
  margin-top: 4px;
  overflow-wrap: anywhere;
  color: var(--forge-text);
  font-size: 16px;
  line-height: 1.25;
`;

const TaskMetaStrip = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
`;

const TaskMetaChip = styled.div`
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  padding: 5px 8px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 7px;
  background: rgba(2, 6, 23, 0.24);

  span {
    color: var(--forge-text-muted);
    font-size: 9px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 820;
  }
`;

const TaskPlanCard = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-radius: 8px;
  background: rgba(30, 64, 175, 0.12);
`;

const TaskPlanHeader = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;

  span {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    color: var(--forge-text);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 12px;
    font-weight: 860;
  }
`;

const TaskPlanDescription = styled.p`
  margin: -2px 0 0;
  color: rgba(203, 213, 225, 0.78);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.38;
`;

const TaskPlanSteps = styled.ol`
  display: grid;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
`;

const TaskPlanStep = styled.li`
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  padding: 6px 7px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 7px;
  background: rgba(2, 6, 23, 0.2);

  &[data-status="active"] {
    border-color: rgba(96, 165, 250, 0.18);
    background: rgba(37, 99, 235, 0.11);
  }

  &[data-status="completed"] {
    border-color: rgba(52, 211, 153, 0.16);
    background: rgba(6, 78, 59, 0.11);
  }

  &[data-status="blocked"],
  &[data-status="failed"] {
    border-color: rgba(251, 113, 133, 0.18);
    background: rgba(127, 29, 29, 0.12);
  }
`;

const TaskPlanStepMarker = styled.span`
  display: grid;
  position: relative;
  place-items: center;
  min-height: 20px;

  span {
    display: block;
    width: 9px;
    height: 9px;
    border: 2px solid rgba(15, 23, 42, 0.96);
    border-radius: 50%;
    background: #94a3b8;
    box-shadow: 0 0 0 1px rgba(148, 163, 184, 0.36);
  }

  &[data-status="completed"] span {
    background: #34d399;
    box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.42);
  }

  &[data-status="active"] span {
    background: #60a5fa;
    box-shadow:
      0 0 0 1px rgba(96, 165, 250, 0.5),
      0 0 14px rgba(96, 165, 250, 0.28);
  }

  &[data-status="blocked"] span,
  &[data-status="failed"] span {
    background: #fb7185;
    box-shadow: 0 0 0 1px rgba(251, 113, 133, 0.45);
  }

  &[data-status="skipped"] span {
    background: #64748b;
  }
`;

const TaskPlanStepContent = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;

  p {
    margin: 0;
    color: rgba(203, 213, 225, 0.72);
    font-size: 10px;
    font-weight: 690;
    line-height: 1.34;
    overflow-wrap: anywhere;
  }
`;

const TaskPlanStepTitleRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;

  strong {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: rgba(241, 245, 249, 0.94);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 800;
  }
`;

const TaskPlanStepBadge = styled.span`
  flex: 0 0 auto;
  padding: 2px 5px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 999px;
  color: rgba(203, 213, 225, 0.72);
  font-size: 8px;
  font-weight: 900;
  text-transform: uppercase;

  &[data-status="completed"] {
    border-color: rgba(52, 211, 153, 0.24);
    color: #a7f3d0;
    background: rgba(6, 78, 59, 0.18);
  }

  &[data-status="active"] {
    border-color: rgba(96, 165, 250, 0.28);
    color: #bfdbfe;
    background: rgba(30, 64, 175, 0.2);
  }

  &[data-status="blocked"],
  &[data-status="failed"] {
    border-color: rgba(251, 113, 133, 0.24);
    color: #fecdd3;
    background: rgba(127, 29, 29, 0.18);
  }
`;

const TaskInputPanel = styled.div`
  display: grid;
  gap: 5px;
  min-width: 0;
`;

const TaskInputBlock = styled.div`
  display: grid;
  gap: 5px;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.22);

  span {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  p {
    max-height: 116px;
    margin: 0;
    overflow: auto;
    color: rgba(203, 213, 225, 0.84);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
`;

const TaskActionError = styled.div`
  padding: 8px 10px;
  border: 1px solid rgba(248, 113, 113, 0.22);
  border-radius: 8px;
  color: rgba(254, 202, 202, 0.92);
  background: rgba(127, 29, 29, 0.12);
  font-size: 10px;
  font-weight: 760;
  line-height: 1.35;
  overflow-wrap: anywhere;
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

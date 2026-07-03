import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getConnectedEdges,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import styled, { keyframes } from "styled-components";
import { Apple as TodoDeviceAppleIcon } from "@styled-icons/fa-brands/Apple";
import { Linux as TodoDeviceLinuxIcon } from "@styled-icons/fa-brands/Linux";
import { Windows as TodoDeviceWindowsIcon } from "@styled-icons/fa-brands/Windows";
import { AccountTree } from "@styled-icons/material-rounded/AccountTree";
import { Devices as TodoDeviceGenericIcon } from "@styled-icons/material-rounded/Devices";
import { Language as TodoDeviceWebIcon } from "@styled-icons/material-rounded/Language";
import { Smartphone as TodoDeviceMobileIcon } from "@styled-icons/material-rounded/Smartphone";
import { Add } from "@styled-icons/material-rounded/Add";
import { AllInbox } from "@styled-icons/material-rounded/AllInbox";
import { Api } from "@styled-icons/material-rounded/Api";
import { Cached } from "@styled-icons/material-rounded/Cached";
import { Cloud } from "@styled-icons/material-rounded/Cloud";
import { Computer } from "@styled-icons/material-rounded/Computer";
import { CreateNewFolder } from "@styled-icons/material-rounded/CreateNewFolder";
import { Dns } from "@styled-icons/material-rounded/Dns";
import { Folder } from "@styled-icons/material-rounded/Folder";
import { Groups } from "@styled-icons/material-rounded/Groups";
import { Http } from "@styled-icons/material-rounded/Http";
import { InsertDriveFile } from "@styled-icons/material-rounded/InsertDriveFile";
import { Hub } from "@styled-icons/material-rounded/Hub";
import { KeyboardDoubleArrowLeft } from "@styled-icons/material-rounded/KeyboardDoubleArrowLeft";
import { KeyboardDoubleArrowRight } from "@styled-icons/material-rounded/KeyboardDoubleArrowRight";
import { Lock } from "@styled-icons/material-rounded/Lock";
import { Memory } from "@styled-icons/material-rounded/Memory";
import { North } from "@styled-icons/material-rounded/North";
import { Person } from "@styled-icons/material-rounded/Person";
import { Public } from "@styled-icons/material-rounded/Public";
import { Route } from "@styled-icons/material-rounded/Route";
import { Schema } from "@styled-icons/material-rounded/Schema";
import { Search } from "@styled-icons/material-rounded/Search";
import { Security } from "@styled-icons/material-rounded/Security";
import { Settings } from "@styled-icons/material-rounded/Settings";
import { Storage } from "@styled-icons/material-rounded/Storage";
import { Sync } from "@styled-icons/material-rounded/Sync";
import { Terminal } from "@styled-icons/material-rounded/Terminal";
import { VpnKey } from "@styled-icons/material-rounded/VpnKey";
import { Webhook } from "@styled-icons/material-rounded/Webhook";
import { Work } from "@styled-icons/material-rounded/Work";
import { Auth0 } from "@styled-icons/simple-icons/Auth0";
import { Cloudflare } from "@styled-icons/simple-icons/Cloudflare";
import { Cockroachlabs } from "@styled-icons/simple-icons/Cockroachlabs";
import { Docker } from "@styled-icons/simple-icons/Docker";
import { Github } from "@styled-icons/simple-icons/Github";
import { Githubactions } from "@styled-icons/simple-icons/Githubactions";
import { Kubernetes } from "@styled-icons/simple-icons/Kubernetes";
import { Mongodb } from "@styled-icons/simple-icons/Mongodb";
import { Nginx } from "@styled-icons/simple-icons/Nginx";
import { Postgresql } from "@styled-icons/simple-icons/Postgresql";
import { Redis } from "@styled-icons/simple-icons/Redis";
import { Stripe } from "@styled-icons/simple-icons/Stripe";
import { Supabase } from "@styled-icons/simple-icons/Supabase";
import Select from "react-select";
import {
  FilesWorkspaceSurface,
  FileExplorerPane,
  FileExplorerHeader,
  FileExplorerActions,
  FileIconButton,
  FileRootPath,
  FileTree,
  FileTreeItem,
  FileTreeButton,
  FileContextMenu,
  FileContextMenuItem,
  FileDisclosure,
  FileKindIcon,
  FileTreeName,
  FileGitStatusMark,
  FileTreeMessage,
  FileTreeEmpty,
  PanelKicker,
  WorkspaceCreateAgentClaudeIcon,
  WorkspaceCreateAgentCodexIcon,
  WorkspaceCreateAgentOpenCodeIcon,
} from "../app/appStyles.js";
import {
  buildSnippingAnnotationTargetFields,
  normalizeSnippingDispatchTargets,
} from "../snipping/snippingAnnotationTargets.js";
import { sanitizeTerminalColor } from "../terminals/terminalColors.js";
import AppSelect from "../app/AppSelect.jsx";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function architectureErrorText(value, fallback = "") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!value || typeof value !== "object") return fallback;
  const direct = [value.error, value.message, value.reason, value.detail]
    .find((item) => typeof item === "string" && item.trim());
  if (direct) return direct.trim();
  const item = value.item && typeof value.item === "object" ? value.item : null;
  const itemLabel = text(
    item?.architecture_id
      || item?.architectureId
      || item?.graph_id
      || item?.graphId
      || item?.id,
  );
  const itemHash = text(item?.content_hash || item?.contentHash);
  if (itemLabel || itemHash) {
    return [
      itemLabel ? `graph ${itemLabel}` : "",
      itemHash ? `hash ${itemHash.slice(0, 12)}` : "",
    ].filter(Boolean).join(" / ");
  }
  try {
    const serialized = JSON.stringify(value);
    return serialized && serialized !== "{}" ? serialized.slice(0, 240) : fallback;
  } catch {
    return fallback;
  }
}

function architectureWorkspaceOptionLabelRenderer(option) {
  return (
    <ArchitectureTargetOptionLabel>
      <Folder aria-hidden="true" />
      <span>{option.label}</span>
    </ArchitectureTargetOptionLabel>
  );
}

function architectureTerminalOptionLabelRenderer(option) {
  return (
    <ArchitectureTargetOptionLabel
      data-any={option.value === "" ? "true" : "false"}
      style={option.color ? { "--architecture-target-option-dot": option.color } : undefined}
    >
      <i aria-hidden="true" />
      <span>{option.label}</span>
    </ArchitectureTargetOptionLabel>
  );
}

const ARCHITECTURE_TARGET_SELECT_STYLES = {
  container: (base) => ({
    ...base,
    minWidth: 0,
    width: "100%",
  }),
  control: (base, state) => ({
    ...base,
    minHeight: 30,
    height: 30,
    borderRadius: 999,
    borderColor: state.isFocused ? "rgba(var(--forge-accent-soft-rgb), 0.58)" : "rgba(230, 236, 245, 0.11)",
    backgroundColor: "rgba(21, 27, 36, 0.92)",
    boxShadow: "none",
    color: "#eef4ff",
    cursor: "pointer",
  }),
  dropdownIndicator: (base) => ({
    ...base,
    color: "#8d9aac",
    padding: "0 7px",
  }),
  indicatorSeparator: () => ({ display: "none" }),
  menu: (base) => ({
    ...base,
    zIndex: 40,
    overflow: "hidden",
    border: "1px solid rgba(230, 236, 245, 0.12)",
    borderRadius: 12,
    backgroundColor: "rgba(8, 12, 18, 0.98)",
  }),
  menuPortal: (base) => ({ ...base, zIndex: 10000 }),
  option: (base, state) => ({
    ...base,
    color: state.isSelected ? "#f8fbff" : "#b7c4d8",
    backgroundColor: state.isSelected
      ? "rgba(var(--forge-accent-rgb), 0.22)"
      : state.isFocused
        ? "rgba(148, 163, 184, 0.12)"
        : "transparent",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 820,
  }),
  placeholder: (base) => ({
    ...base,
    color: "#657386",
    fontSize: 11,
    fontWeight: 780,
  }),
  singleValue: (base) => ({
    ...base,
    color: "#eef4ff",
    fontSize: 11,
    fontWeight: 860,
  }),
  valueContainer: (base) => ({
    ...base,
    height: 30,
    padding: "0 4px 0 10px",
  }),
};

function jsonArray(value) {
  return Array.isArray(value) ? value : [];
}

const SESSION_HISTORY_CACHE_LIMIT = 24;
const SESSION_HISTORY_ENRICH_REFRESH_DELAY_MS = 250;
const SESSION_HISTORY_SYNC_REFRESH_DELAY_MS = 900;
const sessionHistoryCache = new Map();

function sessionHistoryCacheKey(workspaceId, rootDirectory) {
  const workspaceKey = text(workspaceId);
  if (!workspaceKey) return "";
  return `${workspaceKey}\n${text(rootDirectory)}`;
}

function readSessionHistoryCache(cacheKey) {
  if (!cacheKey || !sessionHistoryCache.has(cacheKey)) return null;
  return sessionHistoryCache.get(cacheKey);
}

function writeSessionHistoryCache(cacheKey, items) {
  if (!cacheKey) return;
  sessionHistoryCache.delete(cacheKey);
  sessionHistoryCache.set(cacheKey, {
    items: jsonArray(items),
    updatedAtMs: Date.now(),
  });
  while (sessionHistoryCache.size > SESSION_HISTORY_CACHE_LIMIT) {
    const oldestKey = sessionHistoryCache.keys().next().value;
    if (!oldestKey) break;
    sessionHistoryCache.delete(oldestKey);
  }
}

function architectureGraphIdsFromCloudEvent(event) {
  const ids = new Set();
  const pushGraphId = (value) => {
    const graphId = architectureGraphId(value) || architectureGraphCloudId(value);
    if (graphId) ids.add(graphId);
  };
  const visitGraphLike = (value) => {
    const object = jsonObject(value);
    if (!object) return;
    pushGraphId(object);
    [
      object.graph,
      object.g,
      object.item,
      object.architecture,
      object.doc,
    ].forEach((nested) => {
      const nestedObject = jsonObject(nested);
      if (nestedObject) pushGraphId(nestedObject);
    });
  };
  const visitPayload = (value, depth = 0) => {
    if (depth > 4) return;
    const object = jsonObject(value);
    if (!object) return;
    [
      object.ops,
      object.operations,
      object.o,
      object.graphs,
      object.remoteGraphs,
      object.remote_graphs,
      object.hydratedGraphs,
      object.hydrated_graphs,
      object.items,
    ].forEach((list) => jsonArray(list).forEach(visitGraphLike));
    [
      object.graph,
      object.g,
      object.item,
      object.architecture,
      object.doc,
    ].forEach(visitGraphLike);
    [
      object.payload,
      object.data,
      object.result,
      object.stored,
    ].forEach((nested) => visitPayload(nested, depth + 1));
  };
  visitPayload(event);
  return Array.from(ids);
}

function architectureRepoPathKey(value) {
  return text(value).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function architectureRepoPathFromEntry(entry) {
  return text(entry?.path || entry?.projectRoot || entry?.project_root || entry?.repoPath || entry?.repo_path);
}

function architectureGraphListCacheEntry(graphLists, repoPath) {
  if (!graphLists || typeof graphLists !== "object") return null;
  const repoKey = architectureRepoPathKey(repoPath);
  return graphLists[repoKey]
    || graphLists[repoPath]
    || Object.values(graphLists).find((entry) => architectureRepoPathKey(entry?.repoPath || entry?.repo_path) === repoKey)
    || null;
}

function architectureGraphContentHash(graph) {
  return text(
    graph?.contentHash
      || graph?.content_hash
      || graph?.contentRevision
      || graph?.content_revision
      || graph?.syncContentHash
      || graph?.sync_content_hash
      || graph?.hash,
  );
}

function architectureGraphLocalUnsaved(graph) {
  return Boolean(
    graph?.localUnsaved
      || graph?.local_unsaved
      || graph?.dirty
      || graph?.syncState === "local_unsaved"
      || graph?.sync_state === "local_unsaved",
  );
}

function architectureGraphListSameContent(left, right) {
  const leftList = Array.isArray(left) ? left : [];
  const rightList = Array.isArray(right) ? right : [];
  if (leftList.length !== rightList.length) return false;
  return leftList.every((graph, index) => {
    const other = rightList[index];
    return text(graph?.id) === text(other?.id)
      && text(graph?.title) === text(other?.title)
      && text(graph?.updatedAt || graph?.updated_at) === text(other?.updatedAt || other?.updated_at)
      && architectureGraphContentHash(graph) === architectureGraphContentHash(other)
      && text(graph?.architectureId || graph?.architecture_id) === text(other?.architectureId || other?.architecture_id)
      && text(graph?.filePath || graph?.file_path) === text(other?.filePath || other?.file_path)
      && Boolean(graph?.cloudOnly || graph?.cloud_only) === Boolean(other?.cloudOnly || other?.cloud_only)
      && Boolean(graph?.cloudNeedsHydration || graph?.cloud_needs_hydration) === Boolean(other?.cloudNeedsHydration || other?.cloud_needs_hydration)
      && architectureGraphLocalUnsaved(graph) === architectureGraphLocalUnsaved(other)
      && Boolean(graph?.localAvailable ?? graph?.local_available ?? true) === Boolean(other?.localAvailable ?? other?.local_available ?? true)
      && Boolean(graph?.hydrated ?? true) === Boolean(other?.hydrated ?? true)
      && Number(graph?.nodeCount || 0) === Number(other?.nodeCount || 0)
      && text(graph?.syncState || graph?.sync_state) === text(other?.syncState || other?.sync_state);
  });
}

function architectureGraphCloudId(graph) {
  return text(
    graph?.cloudArchitectureId
      || graph?.cloud_architecture_id
      || graph?.cloudGraphId
      || graph?.cloud_graph_id
      || graph?.architectureId
      || graph?.architecture_id
      || graph?.graphId
      || graph?.graph_id
      || graph?.docId
      || graph?.doc_id
      || graph?.id,
  );
}

function architectureGraphCloudRef(graph) {
  const cloudGraph = graph?.cloudGraph || graph?.cloud_graph || graph;
  const graphId = architectureGraphCloudId(cloudGraph) || architectureGraphCloudId(graph);
  if (!graphId) return null;
  const contentHash = architectureGraphContentHash(cloudGraph) || architectureGraphContentHash(graph);
  const assetId = text(cloudGraph?.assetId || cloudGraph?.asset_id || graph?.assetId || graph?.asset_id);
  return {
    id: graphId,
    architectureId: graphId,
    architecture_id: graphId,
    graphId,
    graph_id: graphId,
    docId: graphId,
    doc_id: graphId,
    contentHash,
    content_hash: contentHash,
    contentRevision: contentHash,
    content_revision: contentHash,
    ...(assetId ? {
      assetId,
      asset_id: assetId,
    } : {}),
    blobId: text(cloudGraph?.blobId || cloudGraph?.blob_id || graph?.blobId || graph?.blob_id),
    blob_id: text(cloudGraph?.blob_id || cloudGraph?.blobId || graph?.blob_id || graph?.blobId),
    sha256: text(cloudGraph?.sha256 || graph?.sha256),
    sourceFormat: text(cloudGraph?.sourceFormat || cloudGraph?.source_format || graph?.sourceFormat || graph?.source_format, "eraserDsl"),
    source_format: text(cloudGraph?.source_format || cloudGraph?.sourceFormat || graph?.source_format || graph?.sourceFormat, "eraserDsl"),
  };
}

function architectureGraphNeedsCloudHydration(graph) {
  if (architectureGraphLocalUnsaved(graph)) return false;
  return Boolean(
    graph?.cloudOnly
      || graph?.cloud_only
      || graph?.cloudNeedsHydration
      || graph?.cloud_needs_hydration
      || graph?.localAvailable === false
      || graph?.local_available === false
      || (graph?.cloudAvailable && graph?.hydrated === false),
  );
}

function architectureGraphNotFoundError(value) {
  return text(value?.message || value).toLowerCase().includes("architecture graph was not found");
}

function architectureGraphId(graph) {
  return text(
    graph?.localGraphId
      || graph?.local_graph_id
      || graph?.architectureId
      || graph?.architecture_id
      || graph?.graphId
      || graph?.graph_id
      || graph?.docId
      || graph?.doc_id
      || graph?.id,
  );
}

function architectureHydratedGraph(result, graphId = "") {
  const items = jsonArray(result?.items);
  if (!items.length) return null;
  const normalizedGraphId = text(graphId);
  return items.find((item) => architectureGraphId(item) === normalizedGraphId) || items[0] || null;
}

function architectureRevisionGraphId(revision) {
  return text(revision?.graphId || revision?.graph_id);
}

function architectureRevisionId(revision) {
  return text(revision?.revisionId || revision?.revision_id);
}

function architectureRevisionReasonLabel(reason) {
  const value = text(reason, "revision");
  return value
    .replace(/[_-]+/gu, " ")
    .replace(/\b\w/gu, (match) => match.toUpperCase());
}

function architectureRevisionTimestamp(revision) {
  return revision?.timestamp || revision?.updatedAt || revision?.updated_at || revision?.createdAt || revision?.created_at;
}

const ARCHITECTURE_SELECTED_GRAPH_REFRESH_MS = 450;
const ARCHITECTURE_CLOUD_UPDATED_EVENT = "cloud-mcp-workspace-architectures-updated";
const ARCHITECTURE_FILE_WRITE_SUPPRESSION_MS = 7000;
const ARCHITECTURE_REMOTE_TODO_QUEUE_EVENT = "diffforge:remote-todo-queue";
const ARCHITECTURE_TODO_QUEUE_SOURCE = "next-remote-control";
const ARCHITECTURE_AGENT_EDIT_MARKERS_STORAGE_PREFIX = "diffforge.architectureAgentEdits.v1";
const ARCHITECTURE_AGENT_EDIT_MARKER_MAX_ITEMS = 80;
const ARCHITECTURE_AGENT_EDIT_MARKER_MAX_AGE_MS = 36 * 60 * 60 * 1000;
const ARCHITECTURE_AGENT_EDIT_DONE_STATUSES = new Set([
  "cancelled",
  "done",
  "failed",
  "interrupted",
  "rolled-back",
  "skipped",
]);
const ARCHITECTURE_AGENT_EDIT_AGENT_COLORS = {
  claude: "#f59e0b",
  "claude-code": "#f59e0b",
  codex: "#60a5fa",
  opencode: "#34d399",
};
const ARCHITECTURE_AGENT_EDIT_FALLBACK_COLORS = [
  "#60a5fa",
  "#34d399",
  "#f59e0b",
  "#f472b6",
  "#a78bfa",
  "#2dd4bf",
];
const ARCHITECTURE_API_CORRIDOR_INTENT = "api-corridor";
const ARCHITECTURE_API_CORRIDOR_ALIASES = new Set([
  "api-corridor",
  "api-procedure-overlay",
  "api-procedure",
  "procedure-overlay",
  "procedure-corridor",
]);
const ARCHITECTURE_RUN_DEFAULT_ENVS = ["local", "staging", "production"];
const ARCHITECTURE_RUN_DEFAULT_MODES = ["plan", "apply", "verify"];
const ARCHITECTURE_RUN_ACTION_LABELS = {
  deploy: "Deploy",
  "health-check": "Health Check",
  "logs-toggle": "Toggle Logs",
  rollback: "Rollback",
  "rotate-secret": "Rotate Secret",
  "smoke-test": "Smoke Test",
};
const ARCHITECTURE_ROUTE_CACHE_MAX = 700;
const ARCHITECTURE_ROUTE_NODE_CLEARANCE = 44;
const ARCHITECTURE_ROUTE_EDGE_CLEARANCE = 20;
const ARCHITECTURE_ROUTE_ENDPOINT_STUB = ARCHITECTURE_ROUTE_NODE_CLEARANCE + 24;
const ARCHITECTURE_ROUTE_CROSSING_EPSILON = 2;
const ARCHITECTURE_EDGE_LABEL_HEIGHT = 21;
const ARCHITECTURE_EDGE_LABEL_MIN_WIDTH = 54;
const ARCHITECTURE_EDGE_LABEL_MAX_WIDTH = 156;
const ARCHITECTURE_EDGE_LABEL_ENDPOINT_GAP = 44;
const ARCHITECTURE_EDGE_LABEL_OFFSET = 12;
const ARCHITECTURE_EDGE_LABEL_NODE_PADDING = 12;
const ARCHITECTURE_EDGE_LABEL_NODE_REJECT_PADDING = 2;
const ARCHITECTURE_EDGE_LABEL_ROUTE_PADDING = 6;
const ARCHITECTURE_EDGE_LABEL_OWN_ROUTE_PADDING = 1;
const ARCHITECTURE_NODE_CARD_WIDTH = 184;
const ARCHITECTURE_NODE_CARD_HEIGHT = 76;
const ARCHITECTURE_NODE_COMPACT_WIDTH = 100;
const ARCHITECTURE_NODE_COMPACT_HEIGHT = 80;

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

function architectureWorkspaceTodoCollection(workspaceTodos, workspaceId, directKeys = [], byWorkspaceKeys = []) {
  if (!workspaceTodos || typeof workspaceTodos !== "object") {
    return null;
  }
  const safeWorkspaceId = text(workspaceId);
  const direct = directKeys
    .map((key) => workspaceTodos[key])
    .find((value) => value);
  const byWorkspace = byWorkspaceKeys
    .map((key) => workspaceTodos[key])
    .find((value) => value);

  if (Array.isArray(byWorkspace)) {
    return byWorkspace.find((entry) => (
      text(
        entry?.workspaceId
          || entry?.workspace_id
          || entry?.observerWorkspaceId
          || entry?.observer_workspace_id,
      ) === safeWorkspaceId
    )) || direct;
  }

  if (byWorkspace && typeof byWorkspace === "object") {
    return byWorkspace[safeWorkspaceId] || byWorkspace[safeWorkspaceId.toLowerCase()] || direct;
  }

  return direct;
}

function architectureTodoArrayFromCollection(collection) {
  if (Array.isArray(collection)) return collection;
  if (!collection || typeof collection !== "object") return [];
  return jsonArray(collection.items).length
    ? jsonArray(collection.items)
    : jsonArray(collection.todos).length
      ? jsonArray(collection.todos)
      : jsonArray(collection.history).length
        ? jsonArray(collection.history)
        : jsonArray(collection.entries).length
          ? jsonArray(collection.entries)
          : jsonArray(collection.recent);
}

function architectureWorkspaceTodoRawItems(workspaceTodos, workspaceId, localItems = []) {
  const collections = [
    architectureWorkspaceTodoCollection(
      workspaceTodos,
      workspaceId,
      ["history", "todoHistory", "todo_history", "dispatches", "todoDispatches", "todo_dispatches", "items", "todos"],
      [
        "historyByWorkspace",
        "history_by_workspace",
        "todoHistoryByWorkspace",
        "todo_history_by_workspace",
        "dispatchesByWorkspace",
        "dispatches_by_workspace",
        "todoDispatchesByWorkspace",
        "todo_dispatches_by_workspace",
        "itemsByWorkspace",
        "items_by_workspace",
        "todosByWorkspace",
        "todos_by_workspace",
      ],
    ),
    architectureWorkspaceTodoCollection(
      workspaceTodos,
      workspaceId,
      ["peerActivity", "peer_activity"],
      ["peerActivityByWorkspace", "peer_activity_by_workspace"],
    ),
  ];

  const seen = new Set();
  // Local-first: the Rust queue ledger items lead so listed/queued/running
  // todos render without any cloud round-trip; cloud snapshot entries with
  // the same id dedupe away behind them.
  const safeLocalItems = (Array.isArray(localItems) ? localItems : [])
    .filter((item) => item && typeof item === "object");
  return [...safeLocalItems, ...collections.flatMap(architectureTodoArrayFromCollection)].filter((item, index) => {
    if (!item || typeof item !== "object") return false;
    const id = text(
      item.todoDispatchId
        || item.todo_dispatch_id
        || item.dispatchId
        || item.dispatch_id
        || item.commandId
        || item.command_id
        || item.todoId
        || item.todo_id
        || item.id
        || item.clientTodoId
        || item.client_todo_id,
      `todo-${index}`,
    );
    const sourceDeviceId = text(item.deviceId || item.device_id || item.sourceDeviceId || item.source_device_id);
    const key = `${sourceDeviceId}::${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function architectureNormalizeTodoStatus(value) {
  const status = text(value).toLowerCase().replaceAll("_", "-");
  if (["complete", "completed", "done", "success", "sent"].includes(status)) return "completed";
  if (["running", "sending", "submitted", "active", "in-progress", "working", "loading"].includes(status)) {
    return "running";
  }
  if (["queued", "pending", "listed", "ready", "list"].includes(status)) return status === "queued" ? "queued" : "listed";
  if (["paused", "parked", "waiting"].includes(status)) return "paused";
  if (["cancelled", "canceled"].includes(status)) return "cancelled";
  if (["interrupted", "stopped"].includes(status)) return "interrupted";
  if (["timed-out", "timeout", "expired"].includes(status)) return "timed-out";
  if (["failed", "failure", "error", "blocked", "rejected"].includes(status)) return "failed";
  if (["deleted", "removed"].includes(status)) return "deleted";
  return status || "listed";
}

function architectureTodoStatusKind(status) {
  if (status === "completed") return "done";
  if (status === "running") return "active";
  if (status === "queued") return "queued";
  if (status === "paused") return "parked";
  if (status === "cancelled") return "cancelled";
  if (status === "interrupted") return "interrupted";
  if (status === "timed-out" || status === "failed") return "failed";
  if (status === "deleted") return "skipped";
  return "unknown";
}

function architectureTodoStatusLabel(status) {
  if (status === "timed-out") return "Timed Out";
  if (status === "completed") return "Done";
  if (status === "running") return "Running";
  if (status === "queued") return "Queued";
  if (status === "paused") return "Paused";
  if (status === "cancelled") return "Cancelled";
  if (status === "interrupted") return "Interrupted";
  if (status === "failed") return "Failed";
  if (status === "deleted") return "Deleted";
  return "Listed";
}

function architectureTodoText(item) {
  const note = jsonObject(item?.note) || {};
  return text(
    item?.text
      || item?.body
      || item?.todoText
      || item?.todo_text
      || item?.todoBodyPreview
      || item?.todo_body_preview
      || item?.prompt
      || item?.todo
      || item?.task
      || note.text
      || note.body,
  );
}

function architectureTodoPreviewText(value, maxLength = 96) {
  const normalized = text(value).replace(/\s+/gu, " ");
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function architectureTodoTitle(item, fallback = "Todo") {
  const note = jsonObject(item?.note) || {};
  const body = architectureTodoText(item);
  const bodyTitle = architectureTodoPreviewText(body);
  // The cloud-generated LLM title is the human label for the todo; the body
  // preview is the fallback so a row is never reduced to a raw id.
  return text(
    item?.llmTitle
      || item?.llm_title
      || bodyTitle
      || item?.title
      || item?.name
      || note.title,
    fallback,
  );
}

function architectureTodoSourceLabel(item) {
  const source = text(item?.source || item?.kind || item?.origin);
  if (!source) return "workspace";
  return source.replace(/[-_]+/gu, " ");
}

function architectureTodoNestedObject(item, keys) {
  return keys
    .map((key) => jsonObject(item?.[key]))
    .find(Boolean) || {};
}

function architectureTodoEndpointLabel(endpoint, fallback = "unknown") {
  const device = text(endpoint.deviceName || endpoint.deviceId);
  const workspace = text(endpoint.workspaceName || endpoint.workspaceId);
  if (device && workspace) return `${device} / ${workspace}`;
  return device || workspace || fallback;
}

function todoDeviceKey(value) {
  return String(value || "").trim().toLowerCase();
}

// Friendly-name + platform directory for the todo history's device chips,
// built from the cloud presence lists (known + connected devices).
function buildTodoDeviceDirectory(...deviceLists) {
  const byId = new Map();
  deviceLists.flat().forEach((device) => {
    if (!device || typeof device !== "object") return;
    const deviceId = todoDeviceKey(
      device.deviceId || device.device_id || device.machineId || device.machine_id || device.id,
    );
    if (!deviceId) return;
    const displayName = text(
      device.displayName
        || device.display_name
        || device.label
        || device.deviceName
        || device.device_name
        || device.machineName
        || device.machine_name
        || device.hostname
        || device.name,
    );
    const previous = byId.get(deviceId) || {};
    byId.set(deviceId, {
      displayName: displayName || previous.displayName || "",
      icon: todoDeviceKey(device.platformIcon || device.platform_icon || device.icon) || previous.icon || "",
      platform: todoDeviceKey(device.platform || device.os) || previous.platform || "",
    });
  });
  return byId;
}

const TODO_DEVICE_PLATFORM_ICONS = {
  apple: TodoDeviceAppleIcon,
  device: TodoDeviceGenericIcon,
  linux: TodoDeviceLinuxIcon,
  mobile: TodoDeviceMobileIcon,
  web: TodoDeviceWebIcon,
  windows: TodoDeviceWindowsIcon,
};

const TODO_DEVICE_PLATFORM_LABELS = {
  apple: "macOS",
  device: "Device",
  linux: "Linux",
  mobile: "Mobile",
  web: "Web",
  windows: "Windows",
};

// Device ids carry a platform prefix (e.g. "macos-24c1b00d-..."), so the
// platform stays resolvable even when the presence directory has no entry.
function todoDevicePlatformToken(endpoint, directoryEntry) {
  const hints = [directoryEntry?.icon, directoryEntry?.platform, endpoint?.deviceId, endpoint?.deviceName]
    .map(todoDeviceKey)
    .join(" ");
  if (/iphone|ipad|android|mobile|phone|tablet/u.test(hints)) return "mobile";
  if (/apple|mac|darwin|\bios\b/u.test(hints)) return "apple";
  if (/windows|win32|\bwin\b/u.test(hints)) return "windows";
  if (/linux/u.test(hints)) return "linux";
  if (/\bweb\b|browser|dashboard/u.test(hints)) return "web";
  return "device";
}

function todoDeviceLooksLikeId(value) {
  return /^[a-z0-9]+-[0-9a-f]{6,}/u.test(todoDeviceKey(value));
}

function todoDeviceDisplayName(endpoint, directory) {
  const deviceId = todoDeviceKey(endpoint?.deviceId);
  const entry = deviceId ? directory?.get?.(deviceId) : null;
  if (entry?.displayName) return entry.displayName;
  const rawName = text(endpoint?.deviceName);
  if (rawName && todoDeviceKey(rawName) !== deviceId && !todoDeviceLooksLikeId(rawName)) return rawName;
  if (!deviceId && !rawName) return "Unknown device";
  const platformLabel = TODO_DEVICE_PLATFORM_LABELS[todoDevicePlatformToken(endpoint, entry)];
  const idTail = (deviceId || todoDeviceKey(rawName))
    .split("-")
    .find((part) => /^[0-9a-f]{6,}$/u.test(part)) || "";
  return idTail ? `${platformLabel} · ${idTail.slice(0, 8)}` : platformLabel;
}

function architectureTodoSourceEndpoint(item) {
  const dispatchSource = architectureTodoNestedObject(item, [
    "dispatchSource",
    "dispatch_source",
    "sourceContext",
    "source_context",
    "sourceEndpoint",
    "source_endpoint",
    "origin",
  ]);
  const device = jsonObject(item?.device) || {};
  const deviceId = text(
    dispatchSource.deviceId
      || dispatchSource.device_id
      || item?.todoDeviceId
      || item?.todo_device_id
      || item?.requestedByDeviceId
      || item?.requested_by_device_id
      || item?.sourceDeviceId
      || item?.source_device_id
      || item?.deviceId
      || item?.device_id
      || device.deviceId
      || device.device_id,
  );
  const deviceName = text(
    dispatchSource.deviceName
      || dispatchSource.device_name
      || item?.todoDeviceName
      || item?.todo_device_name
      || item?.requestedByDeviceName
      || item?.requested_by_device_name
      || item?.sourceDeviceName
      || item?.source_device_name
      || item?.deviceName
      || item?.device_name
      || item?.machineName
      || item?.machine_name
      || device.deviceName
      || device.device_name
      || device.machineName
      || device.machine_name,
  );
  const workspaceId = text(
    dispatchSource.workspaceId
      || dispatchSource.workspace_id
      || item?.todoWorkspaceId
      || item?.todo_workspace_id
      || item?.requestedByWorkspaceId
      || item?.requested_by_workspace_id
      || item?.sourceWorkspaceId
      || item?.source_workspace_id
      || item?.workspaceId
      || item?.workspace_id,
  );
  const workspaceName = text(
    dispatchSource.workspaceName
      || dispatchSource.workspace_name
      || item?.todoWorkspaceName
      || item?.todo_workspace_name
      || item?.requestedByWorkspaceName
      || item?.requested_by_workspace_name
      || item?.sourceWorkspaceName
      || item?.source_workspace_name
      || item?.workspaceName
      || item?.workspace_name,
  );
  return {
    clientId: text(dispatchSource.clientId || dispatchSource.client_id || item?.sourceClientId || item?.source_client_id),
    clientKind: text(dispatchSource.clientKind || dispatchSource.client_kind || item?.sourceClientKind || item?.source_client_kind),
    deviceId,
    deviceName,
    label: architectureTodoEndpointLabel({ deviceId, deviceName, workspaceId, workspaceName }, "source device"),
    workspaceId,
    workspaceName,
  };
}

function architectureTodoTargetLabel(item) {
  const targetWorkspace = text(
    item?.targetWorkspaceName
      || item?.target_workspace_name
      || item?.workspaceName
      || item?.workspace_name,
  );
  const targetDevice = text(
    item?.targetDeviceName
      || item?.target_device_name
      || item?.deviceName
      || item?.device_name
      || item?.machineName
      || item?.machine_name,
  );
  const targetAgent = text(item?.targetAgentLabel || item?.target_agent_label || item?.targetAgentId || item?.target_agent_id);
  const targetTerminalIndex = item?.targetTerminalIndex ?? item?.target_terminal_index;
  const targetTerminal = text(item?.targetTerminalId || item?.target_terminal_id || item?.terminalId || item?.terminal_id);
  if (targetAgent) return targetAgent;
  if (Number.isInteger(Number(targetTerminalIndex))) return `Terminal ${Number(targetTerminalIndex) + 1}`;
  if (targetTerminal) return targetTerminal;
  if (targetDevice && targetWorkspace) return `${targetDevice} / ${targetWorkspace}`;
  return targetDevice || targetWorkspace || "workspace";
}

function architectureTodoTargetEndpoint(item) {
  const dispatchTarget = architectureTodoNestedObject(item, [
    "dispatchTarget",
    "dispatch_target",
    "targetContext",
    "target_context",
    "targetEndpoint",
    "target_endpoint",
    "target",
  ]);
  const deviceId = text(
    dispatchTarget.deviceId
      || dispatchTarget.device_id
      || item?.targetDeviceId
      || item?.target_device_id
      || item?.deviceId
      || item?.device_id,
  );
  const deviceName = text(
    dispatchTarget.deviceName
      || dispatchTarget.device_name
      || item?.targetDeviceName
      || item?.target_device_name
      || item?.machineName
      || item?.machine_name
      || item?.deviceName
      || item?.device_name,
  );
  const workspaceId = text(
    dispatchTarget.workspaceId
      || dispatchTarget.workspace_id
      || item?.targetWorkspaceId
      || item?.target_workspace_id
      || item?.workspaceId
      || item?.workspace_id,
  );
  const workspaceName = text(
    dispatchTarget.workspaceName
      || dispatchTarget.workspace_name
      || item?.targetWorkspaceName
      || item?.target_workspace_name
      || item?.workspaceName
      || item?.workspace_name,
  );
  return {
    agentId: text(dispatchTarget.agentId || dispatchTarget.agent_id || item?.targetAgentId || item?.target_agent_id),
    clientId: text(dispatchTarget.clientId || dispatchTarget.client_id || item?.targetClientId || item?.target_client_id),
    clientKind: text(dispatchTarget.clientKind || dispatchTarget.client_kind || item?.targetClientKind || item?.target_client_kind),
    deviceId,
    deviceName,
    label: architectureTodoEndpointLabel({ deviceId, deviceName, workspaceId, workspaceName }, architectureTodoTargetLabel(item)),
    terminalId: text(dispatchTarget.terminalId || dispatchTarget.terminal_id || item?.targetTerminalId || item?.target_terminal_id),
    terminalIndex: item?.targetTerminalIndex ?? item?.target_terminal_index ?? dispatchTarget.terminalIndex ?? dispatchTarget.terminal_index,
    threadId: text(dispatchTarget.threadId || dispatchTarget.thread_id || item?.targetThreadId || item?.target_thread_id),
    workspaceId,
    workspaceName,
  };
}

function architectureTodoCreatedMs(item) {
  return parseTimeMs(item?.createdAt || item?.created_at || item?.queuedAt || item?.queued_at);
}

function architectureTodoFinishedMs(item, status) {
  if (status === "completed") return parseTimeMs(item?.completedAt || item?.completed_at || item?.todoCompletedAt || item?.todo_completed_at);
  if (status === "cancelled") return parseTimeMs(item?.cancelledAt || item?.cancelled_at || item?.canceledAt || item?.canceled_at || item?.todoCancelledAt || item?.todo_cancelled_at);
  if (status === "paused") return parseTimeMs(item?.pausedAt || item?.paused_at || item?.parkedAt || item?.parked_at || item?.todoPausedAt || item?.todo_paused_at);
  if (status === "interrupted") return parseTimeMs(item?.interruptedAt || item?.interrupted_at || item?.todoInterruptedAt || item?.todo_interrupted_at);
  if (status === "timed-out") return parseTimeMs(item?.timedOutAt || item?.timed_out_at || item?.timeoutAt || item?.timeout_at || item?.todoTimedOutAt || item?.todo_timed_out_at);
  if (status === "failed") return parseTimeMs(item?.failedAt || item?.failed_at || item?.todoFailedAt || item?.todo_failed_at);
  if (status === "deleted") return parseTimeMs(item?.deletedAt || item?.deleted_at || item?.todoDeletedAt || item?.todo_deleted_at);
  return 0;
}

function architectureTodoRefs(item, fallbackId = "") {
  const todoId = text(item?.todoId || item?.todo_id || item?.id || item?.clientTodoId || item?.client_todo_id);
  const todoIds = jsonArray(item?.todoIds || item?.todo_ids)
    .map((value) => text(value))
    .filter(Boolean);
  const dispatchId = text(
    item?.dispatchId
      || item?.dispatch_id
      || item?.todoDispatchId
      || item?.todo_dispatch_id,
  );
  const commandId = text(item?.commandId || item?.command_id);
  const promptEventId = text(item?.promptEventId || item?.prompt_event_id);
  const batchId = text(
    item?.todoBatchId
      || item?.todo_batch_id
      || item?.batchId
      || item?.batch_id
      || item?.planId
      || item?.plan_id,
  );
  const historyId = text(dispatchId || commandId || promptEventId || todoId || batchId, fallbackId);
  return {
    batchId,
    commandId,
    dispatchId,
    historyId,
    promptEventId,
    todoId,
    todoIds: [todoId, ...todoIds].filter(Boolean),
  };
}

function architectureTaskSourceRefs(task) {
  const metadata = jsonObject(task?.metadata_json || task?.metadata) || {};
  const source = jsonObject(task?.source_todo || task?.sourceTodo || metadata.source_todo || metadata.sourceTodo) || {};
  return {
    commandId: text(
      task?.source_command_id
        || task?.sourceCommandId
        || task?.command_id
        || task?.commandId
        || source.command_id
        || source.commandId,
    ),
    dispatchId: text(
      task?.source_todo_dispatch_id
        || task?.sourceTodoDispatchId
        || task?.todo_dispatch_id
        || task?.todoDispatchId
        || source.todo_dispatch_id
        || source.todoDispatchId,
    ),
    promptEventId: text(
      task?.source_prompt_event_id
        || task?.sourcePromptEventId
        || task?.prompt_event_id
        || task?.promptEventId
        || source.prompt_event_id
        || source.promptEventId,
    ),
    todoId: text(
      task?.source_todo_id
        || task?.sourceTodoId
        || task?.todo_id
        || task?.todoId
        || source.todo_id
        || source.todoId,
    ),
  };
}

function architectureTaskMatchesTodo(task, todoRefs) {
  const taskRefs = architectureTaskSourceRefs(task);
  return Boolean(
    (todoRefs.todoId && taskRefs.todoId === todoRefs.todoId)
      || (todoRefs.dispatchId && taskRefs.dispatchId === todoRefs.dispatchId)
      || (todoRefs.commandId && taskRefs.commandId === todoRefs.commandId)
      || (todoRefs.promptEventId && taskRefs.promptEventId === todoRefs.promptEventId),
  );
}

function architectureTasksForTodo(todoRefs, tasks) {
  return jsonArray(tasks)
    .filter((task) => architectureTaskMatchesTodo(task, todoRefs))
    .sort((left, right) => taskUpdatedMs(right) - taskUpdatedMs(left));
}

function architecturePlanSteps(plan) {
  return jsonArray(plan?.steps).length
    ? jsonArray(plan.steps)
    : jsonArray(plan?.planSteps).length
      ? jsonArray(plan.planSteps)
      : jsonArray(plan?.plan_steps).length
        ? jsonArray(plan.plan_steps)
        : jsonArray(plan?.items);
}

function architecturePlanTitle(plan, fallback = "Plan") {
  return text(plan?.title || plan?.name || plan?.objective || plan?.summary, fallback);
}

function architecturePlanDescription(plan) {
  return text(plan?.description || plan?.detail || plan?.details || plan?.summary || plan?.result);
}

function architectureTodoSyntheticPlan(item) {
  const explicitPlanId = text(
    item?.planId
      || item?.plan_id,
  );
  const batchPlanId = text(
    item?.todoBatchId
      || item?.todo_batch_id
      || item?.batchId
      || item?.batch_id,
  );
  const source = text(item?.source || item?.sourceKind || item?.source_kind).toLowerCase();
  const hasPlanShape = Boolean(
    explicitPlanId
      || text(item?.planTitle || item?.plan_title)
      || item?.planStepIndex !== undefined
      || item?.plan_step_index !== undefined
      || item?.planStepCount !== undefined
      || item?.plan_step_count !== undefined
      || source.includes("create_plan")
      || source.includes("create-plan"),
  );
  const planId = explicitPlanId || (hasPlanShape ? batchPlanId : "");
  if (!planId) return null;
  const refs = architectureTodoRefs(item);
  const title = text(item?.planTitle || item?.plan_title || item?.title || item?.name, "Todo plan");
  const stepIndex = Number(item?.planStepIndex ?? item?.plan_step_index ?? item?.stepIndex ?? item?.step_index);
  const stepTitle = text(
    item?.title
      || item?.bodyPreview
      || item?.body_preview
      || item?.todoBodyPreview
      || item?.todo_body_preview
      || item?.text
      || item?.body,
    title,
  );
  return {
    id: planId,
    plan_id: planId,
    planId,
    status: text(item?.planStatus || item?.plan_status || item?.todoStatus || item?.todo_status || item?.status, "listed"),
    title,
    todo_batch_id: refs.batchId || planId,
    todoBatchId: refs.batchId || planId,
    todo_id: refs.todoId,
    todoId: refs.todoId,
    todo_ids: refs.todoIds,
    todoIds: refs.todoIds,
    steps: Number.isInteger(stepIndex)
      ? [{
        detail: item?.detail || item?.details || item?.description,
        id: refs.todoId || `${planId}-step-${stepIndex}`,
        status: text(item?.todoStatus || item?.todo_status || item?.status, "listed"),
        step_index: stepIndex,
        stepIndex,
        title: stepTitle,
      }]
      : [],
  };
}

function architectureTodoPlanEntries(item, relatedTasks = []) {
  const entries = [];
  const seen = new Set();
  const addPlan = (plan, sourceLabel, keyHint, task = null) => {
    const normalized = jsonObject(plan);
    if (!normalized) return;
    const title = architecturePlanTitle(normalized, task ? taskDisplayTitle(task) : "Todo plan");
    const key = text(
      normalized.plan_id
        || normalized.planId
        || normalized.id
        || normalized.todo_batch_id
        || normalized.todoBatchId
        || normalized.batch_id
        || normalized.batchId
        || keyHint
        || `${sourceLabel}-${entries.length}`,
    );
    const dedupeKey = key ? `plan:${key}` : `${sourceLabel}:${keyHint}:${title}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    entries.push({
      key: dedupeKey,
      plan: normalized,
      sourceLabel,
      task,
      title,
    });
  };

  [
    item?.compactPlan,
    item?.compact_plan,
    item?.terminal_todo_plan,
    item?.terminalTodoPlan,
    item?.terminalPlan,
    item?.terminal_plan,
    item?.todoPlan,
    item?.todo_plan,
    item?.plan,
    item?.planTask,
    item?.plan_task,
    architectureTodoSyntheticPlan(item),
  ].forEach((plan, index) => addPlan(plan, "Todo", `todo-inline-${index}`));
  jsonArray(item?.plans).forEach((plan, index) => addPlan(plan, "Todo", `todo-plan-${index}`));
  jsonArray(item?.planTasks || item?.plan_tasks).forEach((plan, index) => addPlan(plan, "Todo", `todo-plan-task-${index}`));
  jsonArray(item?.terminalPlans || item?.terminal_plans).forEach((plan, index) => (
    addPlan(plan, "Todo", `todo-terminal-plan-${index}`)
  ));
  relatedTasks.forEach((task, index) => {
    const plan = taskTerminalPlan(task);
    if (plan) addPlan(plan, "Task", taskPlanTaskId(task, `task-${index}`), task);
  });

  return entries;
}

function architectureTodoHistoryItemsFromWorkspaceTodos(workspaceTodos, workspaceId, tasks = [], localItems = []) {
  return architectureWorkspaceTodoRawItems(workspaceTodos, workspaceId, localItems)
    .map((item, index) => {
      const status = architectureNormalizeTodoStatus(
        item.todoStatus
          || item.todo_status
          || item.status
          || item.cloudStatus
          || item.cloud_status,
      );
      const createdMs = architectureTodoCreatedMs(item);
      const finishedMs = architectureTodoFinishedMs(item, status);
      const updatedMs = parseTimeMs(item.updatedAt || item.updated_at || item.todoStatusUpdatedAt || item.todo_status_updated_at)
        || finishedMs
        || createdMs;
      const body = architectureTodoText(item);
      const bodyTitle = architectureTodoPreviewText(body);
      const refs = architectureTodoRefs(item, `todo-${index}`);
      const relatedTasks = architectureTasksForTodo(refs, tasks);
      const relatedPlans = architectureTodoPlanEntries(item, relatedTasks);
      const sourceDevice = architectureTodoSourceEndpoint(item);
      const targetDevice = architectureTodoTargetEndpoint(item);
      return {
        batchId: refs.batchId,
        body,
        commandId: refs.commandId,
        createdMs,
        dispatchId: refs.dispatchId,
        duration: formatTimelineDuration(createdMs, finishedMs || updatedMs, status === "running"),
        endMs: finishedMs,
        id: refs.historyId,
        planCount: relatedPlans.length,
        promptEventId: refs.promptEventId,
        raw: item,
        rawStatus: text(item.todoStatus || item.todo_status || item.status || item.cloudStatus || item.cloud_status, status),
        relatedPlans,
        relatedTasks,
        source: architectureTodoSourceLabel(item),
        sourceDevice,
        startMs: createdMs,
        status,
        statusKind: architectureTodoStatusKind(status),
        statusLabel: architectureTodoStatusLabel(status),
        target: targetDevice.label || architectureTodoTargetLabel(item),
        targetDevice,
        taskCount: relatedTasks.length,
        title: architectureTodoTitle(item, `Todo ${index + 1}`),
        titleFromBody: Boolean(bodyTitle),
        todoId: refs.todoId,
        todoIds: refs.todoIds,
        updatedMs,
      };
    })
    .sort((left, right) => (
      (right.updatedMs || right.createdMs || 0) - (left.updatedMs || left.createdMs || 0)
        || left.title.localeCompare(right.title)
    ))
    .slice(0, 200);
}

function taskStatus(task) {
  if (task?.rollback_state === "rolled_back") return "rolled back";
  return text(task?.status, "unknown");
}

function taskTerminalPlan(task) {
  const metadata = jsonObject(task?.metadata_json || task?.metadata);
  return jsonObject(task?.terminal_todo_plan)
    || jsonObject(task?.terminalTodoPlan)
    || jsonObject(metadata?.terminal_todo_plan)
    || jsonObject(metadata?.terminalTodoPlan);
}

function taskPlanTaskId(task, fallback = "") {
  return text(
    task?.task_id
      || task?.taskId
      || task?.id,
    fallback,
  );
}

function terminalPlanIdentity(plan, fallback = "") {
  return text(
    plan?.plan_id
      || plan?.planId
      || plan?.id
      || plan?.todo_id
      || plan?.todoId,
    fallback,
  );
}

function completedTerminalTodoPlan(plan) {
  if (!plan) return null;
  const steps = jsonArray(plan.steps).map((step, index) => {
    if (typeof step === "string") {
      return {
        status: "completed",
        step_index: index,
        title: step,
      };
    }
    return {
      ...step,
      status: "completed",
    };
  });
  return {
    ...plan,
    current_step_index: steps.length ? steps.length - 1 : plan.current_step_index,
    currentStepIndex: steps.length ? steps.length - 1 : plan.currentStepIndex,
    status: "completed",
    steps,
  };
}

function taskWithCompletedTerminalPlan(task) {
  const terminalPlan = taskTerminalPlan(task);
  const completedPlan = completedTerminalTodoPlan(terminalPlan);
  if (!completedPlan) return task;
  return {
    ...task,
    terminal_todo_plan: completedPlan,
  };
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

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
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

const ARCHITECTURE_KIND_OPTIONS = [
  { label: "Architecture", value: "architecture" },
  { label: "Deployment", value: "deployment" },
  { label: "API pathway", value: "api-pathway" },
  { label: "API corridor", value: "api-corridor" },
  { label: "Data flow", value: "data-flow" },
  { label: "Control graph", value: "control-graph" },
  { label: "State machine", value: "state-machine" },
  { label: "Dependency graph", value: "dependency-graph" },
  { label: "Subsystem", value: "subsystem" },
  { label: "Runtime", value: "runtime" },
];

const ARCHITECTURE_NODE_ROLE_OPTIONS = [
  "actor",
  "service",
  "api",
  "endpoint",
  "controller",
  "worker",
  "queue",
  "datastore",
  "cache",
  "file",
  "external",
  "state",
  "decision",
  "action",
  "event",
  "timer",
  "terminal",
  "dependency",
  "package",
];

const ARCHITECTURE_EDGE_ROLE_OPTIONS = [
  "calls",
  "request",
  "response",
  "redirect",
  "callback",
  "reads",
  "writes",
  "publishes",
  "subscribes",
  "transitions",
  "guards",
  "depends-on",
  "emits",
  "retries",
  "fails-to",
  "resolves-to",
];

const ARCHITECTURE_GROUP_INTENT_VALUES = new Set(ARCHITECTURE_KIND_OPTIONS.map((option) => option.value));
const ARCHITECTURE_NODE_ROLE_VALUES = new Set(ARCHITECTURE_NODE_ROLE_OPTIONS);
const ARCHITECTURE_EDGE_ROLE_VALUES = new Set(ARCHITECTURE_EDGE_ROLE_OPTIONS);

const ARCHITECTURE_GROUP_INTENT_ICONS = {
  architecture: "group",
  "api-pathway": "api",
  "api-corridor": "route",
  "data-flow": "flow",
  "control-graph": "router",
  "state-machine": "flow",
  "dependency-graph": "schema",
  deployment: "cloud",
  runtime: "server",
  subsystem: "settings",
};

const ARCHITECTURE_GROUP_INTENT_COLORS = {
  architecture: "blue",
  "api-pathway": "sky",
  "api-corridor": "cyan",
  "data-flow": "emerald",
  "control-graph": "amber",
  "state-machine": "violet",
  "dependency-graph": "rose",
  deployment: "cyan",
  runtime: "slate",
  subsystem: "blue",
};

const ARCHITECTURE_NODE_ROLE_ICONS = {
  actor: "users",
  service: "service",
  api: "api",
  endpoint: "api",
  controller: "router",
  worker: "worker",
  queue: "queue",
  datastore: "database",
  cache: "cache",
  file: "file",
  external: "external",
  state: "flow",
  decision: "router",
  action: "settings",
  event: "webhook",
  timer: "cache",
  terminal: "security",
  dependency: "schema",
  package: "schema",
};

const ARCHITECTURE_NODE_ROLE_KIND = {
  actor: "client",
  service: "service",
  api: "api",
  endpoint: "api",
  controller: "router",
  worker: "worker",
  queue: "queue",
  datastore: "database",
  cache: "database",
  file: "service",
  external: "external",
  state: "state",
  decision: "decision",
  action: "action",
  event: "event",
  timer: "event",
  terminal: "terminal",
  dependency: "dependency",
  package: "dependency",
};

const ARCHITECTURE_EDGE_ROLE_KIND = {
  callback: "calls",
  "depends-on": "depends",
  redirect: "calls",
  request: "calls",
  response: "calls",
  reads: "reads",
  writes: "writes",
  publishes: "publishes",
  subscribes: "subscribes",
  transitions: "transitions",
  guards: "guards",
  retries: "retries",
  "fails-to": "fails-to",
  emits: "emits",
  "resolves-to": "resolves-to",
};

const ARCHITECTURE_LIKEC4_ICON_MODULES = import.meta.glob("/node_modules/@likec4/icons/{aws,azure,gcp,tech,bootstrap}/*.js");
const ARCHITECTURE_LIKEC4_ICON_CACHE = new Map();
const ARCHITECTURE_STYLED_SIMPLE_ICON_MODULES = import.meta.glob([
  "/node_modules/@styled-icons/simple-icons/*/*.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Auth0/Auth0.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Cloudflare/Cloudflare.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Cockroachlabs/Cockroachlabs.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Docker/Docker.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Github/Github.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Githubactions/Githubactions.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Kubernetes/Kubernetes.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Mongodb/Mongodb.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Nginx/Nginx.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Postgresql/Postgresql.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Redis/Redis.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Stripe/Stripe.esm.js",
  "!/node_modules/@styled-icons/simple-icons/Supabase/Supabase.esm.js",
]);
const ARCHITECTURE_STYLED_SIMPLE_ICON_CACHE = new Map();
let architectureStyledSimpleIconIndex = null;

const ARCHITECTURE_ICON_NAMESPACE_ALIASES = {
  amazon: "aws",
  "amazon-web-services": "aws",
  awslabs: "aws",
  bi: "bootstrap",
  bs: "bootstrap",
  "bootstrap-icons": "bootstrap",
  google: "gcp",
  "google-cloud": "gcp",
  gcloud: "gcp",
  microsoft: "azure",
  "microsoft-azure": "azure",
  simple: "styled",
  "simple-icons": "styled",
  "styled-icons": "styled",
  brand: "tech",
  company: "tech",
  logo: "tech",
};

const ARCHITECTURE_STYLED_SIMPLE_ICON_ALIASES = {
  "adobe-creative-cloud": "adobecreativecloud",
  "adobe-photoshop": "adobephotoshop",
  amazon: "amazon",
  "amazon-web-services": "amazonaws",
  amazonaws: "amazonaws",
  aws: "amazonaws",
  "aws-dynamodb": "amazondynamodb",
  "aws-s3": "amazons3",
  "c-plus-plus": "cplusplus",
  "c-sharp": "csharp",
  cockroach: "cockroachlabs",
  "cockroach-db": "cockroachlabs",
  cockroachdb: "cockroachlabs",
  "cockroach-labs": "cockroachlabs",
  cockraoch: "cockroachlabs",
  "cockraoch-db": "cockroachlabs",
  cockraochdb: "cockroachlabs",
  cockraochlabs: "cockroachlabs",
  "dot-net": "dotnet",
  dynamodb: "amazondynamodb",
  node: "nodedotjs",
  "node-dot-js": "nodedotjs",
  "node-js": "nodedotjs",
  nodejs: "nodedotjs",
  nuxt: "nuxtdotjs",
  "nuxt-js": "nuxtdotjs",
  nuxtjs: "nuxtdotjs",
  react: "reactlogo",
  "react-js": "reactlogo",
  s3: "amazons3",
  vue: "vuedotjs",
  "vue-js": "vuedotjs",
  vuejs: "vuedotjs",
};

const ARCHITECTURE_ICON_ALIASES = {
  "aws:api": "aws:api-gateway",
  "aws:apigateway": "aws:api-gateway",
  "aws:api-gateway": "aws:api-gateway",
  "aws:cloudfront": "aws:cloud-front",
  "aws:cloudwatch": "aws:cloud-watch",
  "aws:dynamodb": "aws:dynamo-db",
  "aws:ebs": "aws:elastic-block-store",
  "aws:ec2": "aws:ec2",
  "aws:ecr": "aws:elastic-container-registry",
  "aws:ecs": "aws:elastic-container-service",
  "aws:eks": "aws:elastic-kubernetes-service",
  "aws:elasticache": "aws:elasti-cache",
  "aws:elb": "aws:elastic-load-balancing",
  "aws:eventbridge": "aws:event-bridge",
  "aws:iam": "aws:identity-and-access-management",
  "aws:kms": "aws:key-management-service",
  "aws:opensearch": "aws:open-search-service",
  "aws:route53": "aws:route-53",
  "aws:s3": "aws:simple-storage-service",
  "aws:secrets": "aws:secrets-manager",
  "aws:secret-manager": "aws:secrets-manager",
  "aws:sns": "aws:simple-notification-service",
  "aws:sqs": "aws:simple-queue-service",
  "aws:vpc": "aws:virtual-private-cloud",
  "api-gateway": "generic:api",
  "aws-api-gateway": "aws:api-gateway",
  "aws-cloudfront": "aws:cloud-front",
  "aws-cloudwatch": "aws:cloud-watch",
  "aws-dynamodb": "aws:dynamo-db",
  "aws-ec2": "aws:ec2",
  "aws-ecr": "aws:elastic-container-registry",
  "aws-ecs": "aws:elastic-container-service",
  "aws-eks": "aws:elastic-kubernetes-service",
  "aws-elasticache": "aws:elasti-cache",
  "aws-elb": "aws:elastic-load-balancing",
  "aws-eventbridge": "aws:event-bridge",
  "aws-iam": "aws:identity-and-access-management",
  "aws-kms": "aws:key-management-service",
  "aws-lambda": "aws:lambda",
  "aws-opensearch": "aws:open-search-service",
  "aws-rds": "aws:rds",
  "aws-route53": "aws:route-53",
  "aws-s3": "aws:simple-storage-service",
  "aws-secrets": "aws:secrets-manager",
  "aws-sns": "aws:simple-notification-service",
  "aws-sqs": "aws:simple-queue-service",
  "aws-vpc": "aws:virtual-private-cloud",
  bucket: "aws:simple-storage-service",
  buckets: "aws:simple-storage-service",
  cloudfront: "aws:cloud-front",
  cloudwatch: "aws:cloud-watch",
  dynamodb: "aws:dynamo-db",
  ec2: "aws:ec2",
  ecr: "aws:elastic-container-registry",
  ecs: "aws:elastic-container-service",
  eks: "aws:elastic-kubernetes-service",
  elasticache: "aws:elasti-cache",
  elb: "aws:elastic-load-balancing",
  eventbridge: "aws:event-bridge",
  iam: "aws:identity-and-access-management",
  kinesis: "aws:kinesis",
  kms: "aws:key-management-service",
  lambda: "aws:lambda",
  opensearch: "aws:open-search-service",
  rds: "aws:rds",
  route53: "aws:route-53",
  s3: "aws:simple-storage-service",
  sns: "aws:simple-notification-service",
  sqs: "aws:simple-queue-service",
  vpc: "aws:virtual-private-cloud",
  "gcp:gcs": "gcp:cloud-storage",
  "gcp:pubsub": "gcp:pub-sub",
  "gcp:sql": "gcp:cloud-sql",
  "google-cloud-run": "gcp:cloud-run",
  "google-cloud-storage": "gcp:cloud-storage",
  bigquery: "gcp:big-query",
  "big-query": "gcp:big-query",
  "cloud-run": "gcp:cloud-run",
  "cloud-sql": "gcp:cloud-sql",
  "cloud-storage": "gcp:cloud-storage",
  gcs: "gcp:cloud-storage",
  gke: "gcp:google-kubernetes-engine",
  pubsub: "gcp:pub-sub",
  "pub-sub": "gcp:pub-sub",
  "azure:aks": "azure:kubernetes-services",
  "azure:blob": "azure:storage-accounts",
  "azure:blob-storage": "azure:storage-accounts",
  "azure:cosmosdb": "azure:azure-cosmos-db",
  "azure:function": "azure:function-apps",
  "azure:functions": "azure:function-apps",
  "azure:postgres": "azure:azure-database-postgre-sql-server",
  "azure:postgresql": "azure:azure-database-postgre-sql-server",
  "azure:redis": "azure:azure-managed-redis",
  "azure:service-bus": "azure:azure-service-bus",
  "azure:sql": "azure:azure-sql",
  "azure:storage": "azure:storage-accounts",
  aks: "azure:kubernetes-services",
  "azure-blob-storage": "azure:storage-accounts",
  "azure-cosmos": "azure:azure-cosmos-db",
  "azure-cosmosdb": "azure:azure-cosmos-db",
  "azure-functions": "azure:function-apps",
  "blob-storage": "azure:storage-accounts",
  cosmos: "azure:azure-cosmos-db",
  cosmosdb: "azure:azure-cosmos-db",
  cockroach: "styled:cockroachlabs",
  "cockroach-db": "styled:cockroachlabs",
  cockroachdb: "styled:cockroachlabs",
  cockroachlabs: "styled:cockroachlabs",
  "cockroach-labs": "styled:cockroachlabs",
  cockraoch: "styled:cockroachlabs",
  "cockraoch-db": "styled:cockroachlabs",
  cockraochdb: "styled:cockroachlabs",
  cockraochlabs: "styled:cockroachlabs",
  postgres: "tech:postgresql",
  pg: "tech:postgresql",
  mongo: "tech:mongodb-icon",
  mongodb: "tech:mongodb-icon",
  "mongo-db": "tech:mongodb-icon",
  github: "tech:github-icon",
  gh: "tech:github-icon",
  "github-actions": "tech:github-actions",
  cloudflare: "tech:cloudflare-icon",
  "cloudflare-workers": "tech:cloudflare-workers-icon",
  docker: "tech:docker-icon",
  supabase: "tech:supabase-icon",
  auth0: "tech:auth0-icon",
  node: "tech:nodejs-icon",
  nodejs: "tech:nodejs-icon",
  "node-js": "tech:nodejs-icon",
  next: "tech:nextjs-icon",
  "next-js": "tech:nextjs-icon",
  nextjs: "tech:nextjs-icon",
  typescript: "tech:typescript-icon",
  ts: "tech:typescript-icon",
  vue: "styled:vuedotjs",
  "vue-js": "styled:vuedotjs",
  vuejs: "styled:vuedotjs",
  openai: "tech:openai-icon",
  anthropic: "tech:anthropic-icon",
  ai: "generic:ai",
  api: "generic:api",
  auth: "generic:auth",
  authentication: "generic:auth",
  authorization: "generic:auth",
  browser: "generic:client",
  box: "generic:group",
  boxes: "generic:group",
  cache: "generic:cache",
  cli: "generic:terminal",
  client: "generic:client",
  compute: "generic:compute",
  database: "generic:database",
  datastore: "generic:database",
  db: "generic:database",
  "external-service": "generic:external",
  config: "generic:file",
  document: "generic:file",
  file: "generic:file",
  flow: "generic:flow",
  folder: "generic:folder",
  gateway: "generic:api",
  group: "generic:group",
  decision: "generic:router",
  dependency: "generic:schema",
  event: "generic:webhook",
  package: "generic:schema",
  state: "generic:flow",
  terminal: "generic:security",
  users: "generic:users",
  monitor: "generic:client",
  persistence: "generic:database",
  queue: "generic:queue",
  router: "generic:router",
  server: "generic:server",
  service: "generic:service",
  settings: "generic:settings",
  schema: "generic:schema",
  start: "generic:flow",
  storage: "generic:storage",
  subscription: "generic:subscription",
  worker: "generic:worker",
};

const ARCHITECTURE_STYLED_ICON_COMPONENTS = {
  ai: Memory,
  api: Api,
  auth: VpnKey,
  cache: Cached,
  client: Computer,
  cloud: Cloud,
  cockroachlabs: Cockroachlabs,
  compute: Memory,
  database: Storage,
  db: Storage,
  docker: Docker,
  dns: Dns,
  external: Public,
  file: InsertDriveFile,
  flow: AccountTree,
  folder: Folder,
  github: Github,
  "github-actions": Githubactions,
  group: Hub,
  http: Http,
  kubernetes: Kubernetes,
  lock: Lock,
  mongodb: Mongodb,
  nginx: Nginx,
  postgres: Postgresql,
  postgresql: Postgresql,
  queue: AllInbox,
  redis: Redis,
  router: Route,
  security: Security,
  server: Dns,
  service: Work,
  settings: Settings,
  schema: Schema,
  storage: Storage,
  stripe: Stripe,
  subscription: Sync,
  supabase: Supabase,
  terminal: Terminal,
  users: Groups,
  user: Person,
  webhook: Webhook,
  worker: Settings,
  auth0: Auth0,
  cloudflare: Cloudflare,
};

const ARCHITECTURE_KIND_ICON_FALLBACKS = {
  api: "generic:api",
  client: "generic:client",
  database: "generic:database",
  external: "generic:external",
  group: "generic:group",
  queue: "generic:queue",
  service: "generic:service",
  state: "generic:flow",
  decision: "generic:router",
  action: "generic:settings",
  event: "generic:webhook",
  terminal: "generic:security",
  dependency: "generic:schema",
  worker: "generic:worker",
};

const ARCHITECTURE_SEMANTIC_ICON_SLUGS = new Set([
  "ai",
  "api",
  "auth",
  "authentication",
  "authorization",
  "browser",
  "box",
  "boxes",
  "cache",
  "client",
  "cloud",
  "compute",
  "config",
  "database",
  "datastore",
  "db",
  "document",
  "external",
  "external-service",
  "file",
  "flow",
  "folder",
  "gateway",
  "group",
  "decision",
  "dependency",
  "event",
  "package",
  "monitor",
  "persistence",
  "queue",
  "router",
  "schema",
  "security",
  "server",
  "service",
  "settings",
  "state",
  "start",
  "storage",
  "subscription",
  "terminal",
  "user",
  "users",
  "webhook",
  "worker",
]);

const ARCHITECTURE_TITLE_ICON_SUFFIXES = new Set([
  "account",
  "accounts",
  "api",
  "apis",
  "app",
  "application",
  "auth",
  "authentication",
  "bucket",
  "buckets",
  "cache",
  "client",
  "cloud",
  "cluster",
  "database",
  "databases",
  "db",
  "gateway",
  "integration",
  "platform",
  "provider",
  "providers",
  "queue",
  "router",
  "sdk",
  "server",
  "service",
  "services",
  "store",
  "storage",
  "system",
  "worker",
]);

const architectureNodeTypes = {
  architectureCorridor: ArchitectureApiCorridorNode,
  architectureGroup: ArchitectureCanvasGroup,
  architectureNode: ArchitectureCanvasNode,
};

const architectureEdgeTypes = {
  architectureEdge: ArchitectureCanvasEdge,
};

function architectureSlug(value, fallback = "architecture") {
  const raw = text(value, fallback).toLowerCase();
  const slug = raw
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 96);
  return slug || fallback;
}

function architectureTitleFromSlug(value, fallback = "Run") {
  const raw = text(value);
  if (!raw) return fallback;
  return raw
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || fallback;
}

function architectureRunList(value, fallback = []) {
  const raw = text(value);
  const source = raw ? raw.split(/[|,]/u) : fallback;
  const seen = new Set();
  return source
    .map((item) => architectureSemanticSlug(item))
    .filter((item) => {
      if (!item || seen.has(item)) return false;
      seen.add(item);
      return true;
    });
}

function architectureRunTargetId(label, action, index = 0) {
  return `run-${architectureSlug(label || action || "target")}-${index + 1}`;
}

function architectureNormalizeRunTarget(target, index = 0) {
  if (!target || typeof target !== "object") return null;
  const props = architectureCleanDslProps(target.semanticProps || target.props || target);
  const action = architectureSemanticSlug(
    target.action || props.action || props.kind || props.type || target.kind || target.type,
    "run",
  );
  const label = text(
    target.label || target.title || target.name || props.label || props.title,
    ARCHITECTURE_RUN_ACTION_LABELS[action] || architectureTitleFromSlug(action, "Run"),
  );
  const envs = architectureRunList(
    target.envs || target.environments || props.envs || props.environments || props.env,
    ARCHITECTURE_RUN_DEFAULT_ENVS,
  );
  const modes = architectureRunList(
    target.modes || target.allowedModes || target.allowed_modes || props.modes || props.allowedModes || props.allowed_modes || props.mode,
    ARCHITECTURE_RUN_DEFAULT_MODES,
  );
  const defaultEnv = architectureSemanticSlug(
    target.defaultEnv || target.default_env || props.defaultEnv || props.default_env,
    envs.includes("staging") ? "staging" : envs[0] || "local",
  );
  const defaultMode = architectureSemanticSlug(
    target.defaultMode || target.default_mode || props.defaultMode || props.default_mode,
    modes.includes("plan") ? "plan" : modes[0] || "plan",
  );
  return {
    action,
    defaultEnv: envs.includes(defaultEnv) ? defaultEnv : envs[0] || "local",
    defaultMode: modes.includes(defaultMode) ? defaultMode : modes[0] || "plan",
    envs: envs.length ? envs : ARCHITECTURE_RUN_DEFAULT_ENVS,
    id: text(target.id || props.id, architectureRunTargetId(label, action, index)),
    label,
    modes: modes.length ? modes : ARCHITECTURE_RUN_DEFAULT_MODES,
    requiresApproval: text(target.requiresApproval || target.requires_approval || props.requiresApproval || props.requires_approval || props.approval),
    scope: text(target.scope || props.scope),
    semanticProps: props,
  };
}

function architectureRunTargetFromDslLine(line, index = 0) {
  const raw = text(line).replace(/^run\s+/u, "");
  if (!raw) return null;
  const { name, props } = architectureExtractDslProps(raw);
  return architectureNormalizeRunTarget({
    ...props,
    label: name,
    semanticProps: props,
  }, index);
}

function architectureRunTargetDslLine(target, index = 0) {
  const runTarget = architectureNormalizeRunTarget(target, index);
  if (!runTarget) return "";
  const props = architecturePropsWithOrderedOverrides(runTarget.semanticProps, {
    action: runTarget.action,
    envs: runTarget.envs.join(","),
    modes: runTarget.modes.join(","),
    defaultEnv: runTarget.defaultEnv,
    defaultMode: runTarget.defaultMode,
    ...(runTarget.scope ? { scope: runTarget.scope } : {}),
    ...(runTarget.requiresApproval ? { approval: runTarget.requiresApproval } : {}),
  });
  return `run ${architectureDslString(runTarget.label)}${architectureDslPropsText(props)}`;
}

function architectureRunTargetsFromGraph(graph) {
  const direct = jsonArray(graph?.runTargets || graph?.run_targets)
    .map(architectureNormalizeRunTarget)
    .filter(Boolean);
  if (direct.length) return direct;
  const source = text(graph?.source);
  if (!source) return [];
  const targets = [];
  source.split(/\r?\n/u).forEach((rawLine) => {
    const line = architectureStripDslComments(rawLine);
    if (!/^run\s+/u.test(line)) return;
    const target = architectureRunTargetFromDslLine(line, targets.length);
    if (target) targets.push(target);
  });
  return targets;
}

function architectureRunTargetSelection(target, selections = {}) {
  const runTarget = architectureNormalizeRunTarget(target) || {};
  const selected = jsonObject(selections[runTarget.id]) || {};
  const env = architectureSemanticSlug(selected.env, runTarget.defaultEnv || runTarget.envs?.[0] || "local");
  const mode = architectureSemanticSlug(selected.mode, runTarget.defaultMode || "plan");
  return {
    env: jsonArray(runTarget.envs).includes(env) ? env : runTarget.defaultEnv || runTarget.envs?.[0] || "local",
    mode: jsonArray(runTarget.modes).includes(mode) ? mode : runTarget.defaultMode || "plan",
  };
}

function architectureRunRisk(env, mode) {
  const safeEnv = architectureSemanticSlug(env);
  const safeMode = architectureSemanticSlug(mode);
  if (safeEnv === "production" && ["apply", "rollback"].includes(safeMode)) return "high";
  if (["apply", "rollback"].includes(safeMode)) return "medium";
  return "low";
}

function architectureRunPrompt(target, env, mode) {
  const runTarget = architectureNormalizeRunTarget(target) || {};
  return [
    `Run architecture target "${text(runTarget.label, "Run")}".`,
    `Action: ${text(runTarget.action, "run")}.`,
    `Environment: ${text(env, runTarget.defaultEnv || "local")}.`,
    `Mode: ${text(mode, runTarget.defaultMode || "plan")}.`,
    runTarget.scope ? `Scope: ${runTarget.scope}.` : "",
  ].filter(Boolean).join(" ");
}

function architectureIconSlug(value, fallback = "") {
  const raw = text(value).toLowerCase();
  const slug = raw
    .replace(/&/gu, " and ")
    .replace(/\+/gu, " plus ")
    .replace(/([a-z])([0-9])/gu, "$1-$2")
    .replace(/([0-9])([a-z])/gu, "$1-$2")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || fallback;
}

function architectureIconNamespace(value) {
  const normalized = architectureIconSlug(value);
  return ARCHITECTURE_ICON_NAMESPACE_ALIASES[normalized] || normalized;
}

function architectureIconParts(value) {
  const raw = text(value).toLowerCase();
  const namespaceMatch = raw.match(/^([a-z0-9][a-z0-9\s_-]*)\s*[:/]\s*(.+)$/u);
  if (namespaceMatch) {
    const namespace = architectureIconNamespace(namespaceMatch[1]);
    const slug = architectureIconSlug(namespaceMatch[2]);
    return {
      key: namespace && slug ? `${namespace}:${slug}` : slug,
      namespace,
      slug,
    };
  }
  const slug = architectureIconSlug(raw);
  return {
    key: slug,
    namespace: "",
    slug,
  };
}

function architectureLikeC4IconPath(collection, slug) {
  return `/node_modules/@likec4/icons/${collection}/${slug}.js`;
}

function architectureAddLikeC4Candidate(candidates, collection, value) {
  const slug = architectureIconSlug(value);
  if (!collection || !slug) return;
  const path = architectureLikeC4IconPath(collection, slug);
  if (!ARCHITECTURE_LIKEC4_ICON_MODULES[path]) return;
  if (candidates.some((candidate) => candidate.path === path)) return;
  candidates.push({
    collection,
    path,
    slug,
  });
}

function architectureStyledSimpleIconFolder(path) {
  return text(path.match(/\/simple-icons\/([^/]+)\//u)?.[1]);
}

function architectureStyledSimpleIconIndexes() {
  if (architectureStyledSimpleIconIndex) return architectureStyledSimpleIconIndex;
  const byCompact = new Map();
  const bySlug = new Map();
  Object.keys(ARCHITECTURE_STYLED_SIMPLE_ICON_MODULES).forEach((path) => {
    const folder = architectureStyledSimpleIconFolder(path);
    const slug = architectureIconSlug(folder);
    const compact = slug.replace(/-/gu, "");
    if (slug && !bySlug.has(slug)) bySlug.set(slug, path);
    if (compact && !byCompact.has(compact)) byCompact.set(compact, path);
  });
  architectureStyledSimpleIconIndex = { byCompact, bySlug };
  return architectureStyledSimpleIconIndex;
}

function architectureStyledSimpleIconPath(value) {
  const slug = architectureIconSlug(value);
  if (!slug) return "";
  const compact = slug.replace(/-/gu, "");
  const alias = ARCHITECTURE_STYLED_SIMPLE_ICON_ALIASES[slug]
    || ARCHITECTURE_STYLED_SIMPLE_ICON_ALIASES[compact]
    || "";
  const aliasSlug = architectureIconSlug(alias);
  const aliasCompact = aliasSlug.replace(/-/gu, "");
  const indexes = architectureStyledSimpleIconIndexes();
  return indexes.bySlug.get(aliasSlug)
    || indexes.byCompact.get(aliasCompact)
    || indexes.bySlug.get(slug)
    || indexes.byCompact.get(compact)
    || "";
}

function architectureAddStyledSimpleCandidate(candidates, value) {
  const path = architectureStyledSimpleIconPath(value);
  if (!path) return;
  const folder = architectureStyledSimpleIconFolder(path);
  if (!folder) return;
  if (candidates.some((candidate) => candidate.path === path)) return;
  candidates.push({
    folder,
    path,
    slug: architectureIconSlug(folder),
  });
}

function architectureIconAliasTarget(parts) {
  if (!parts?.slug) return "";
  if (parts.key && ARCHITECTURE_ICON_ALIASES[parts.key]) {
    return ARCHITECTURE_ICON_ALIASES[parts.key];
  }
  return ARCHITECTURE_ICON_ALIASES[parts.slug] || "";
}

function architectureIconTokenIsGeneric(value) {
  const parts = architectureIconParts(value);
  if (!parts.slug) return true;
  if (parts.namespace === "generic") return true;
  const aliasTarget = architectureIconAliasTarget(parts);
  if (aliasTarget) {
    const aliasParts = architectureIconParts(aliasTarget);
    return aliasParts.namespace === "generic"
      || ARCHITECTURE_SEMANTIC_ICON_SLUGS.has(aliasParts.slug);
  }
  return ARCHITECTURE_SEMANTIC_ICON_SLUGS.has(parts.slug);
}

function architectureLabelIconHintTokens(value) {
  const slug = architectureIconSlug(value);
  if (!slug) return [];
  const tokens = [];
  const seen = new Set();
  const addToken = (token) => {
    const clean = architectureIconSlug(token);
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    tokens.push(clean);
  };
  addToken(slug);

  const parts = slug.split("-").filter(Boolean);
  while (parts.length > 1 && ARCHITECTURE_TITLE_ICON_SUFFIXES.has(parts.at(-1))) {
    parts.pop();
    addToken(parts.join("-"));
  }

  if (slug.includes("-")) {
    addToken(slug.replace(/-/gu, ""));
  }

  return tokens;
}

function architectureAddPackageIconHint(state, value, depth = 0) {
  if (!state || depth > 4) return;
  const parts = architectureIconParts(value);
  if (!parts.slug) return;
  const aliasTarget = architectureIconAliasTarget(parts);
  if (aliasTarget) {
    if (!architectureIconTokenIsGeneric(aliasTarget)) {
      architectureAddIconToken(state, aliasTarget, depth + 1);
    }
    return;
  }

  if (parts.namespace === "generic") return;

  if (parts.namespace === "styled") {
    architectureAddStyledSimpleCandidate(state.styledCandidates, parts.slug);
    return;
  }

  if (parts.namespace === "aws") {
    architectureAddLikeC4Candidate(state.candidates, "aws", parts.slug);
    architectureAddLikeC4Candidate(state.candidates, "tech", `aws-${parts.slug}`);
    architectureAddStyledSimpleCandidate(state.styledCandidates, `aws-${parts.slug}`);
    return;
  }

  if (parts.namespace === "gcp") {
    architectureAddLikeC4Candidate(state.candidates, "gcp", parts.slug);
    architectureAddLikeC4Candidate(state.candidates, "tech", `google-cloud-${parts.slug}`);
    architectureAddLikeC4Candidate(state.candidates, "tech", `gcp-${parts.slug}`);
    architectureAddStyledSimpleCandidate(state.styledCandidates, `google-cloud-${parts.slug}`);
    return;
  }

  if (parts.namespace === "azure") {
    architectureAddLikeC4Candidate(state.candidates, "azure", parts.slug);
    architectureAddLikeC4Candidate(state.candidates, "tech", `azure-${parts.slug}`);
    architectureAddStyledSimpleCandidate(state.styledCandidates, `azure-${parts.slug}`);
    return;
  }

  if (parts.namespace === "tech") {
    architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
    architectureAddStyledSimpleCandidate(state.styledCandidates, parts.slug);
    return;
  }

  if (parts.namespace === "bootstrap") {
    architectureAddLikeC4Candidate(state.candidates, "bootstrap", parts.slug);
    return;
  }

  if (parts.namespace) return;

  if (!parts.slug.endsWith("-icon")) {
    architectureAddLikeC4Candidate(state.candidates, "tech", `${parts.slug}-icon`);
  }
  architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
  architectureAddStyledSimpleCandidate(state.styledCandidates, parts.slug);
}

function architectureAddLabelIconHints(state, value) {
  architectureLabelIconHintTokens(value).forEach((token) => {
    architectureAddPackageIconHint(state, token);
  });
}

function architectureAddIconToken(state, value, depth = 0) {
  if (!state || depth > 5) return;
  const parts = architectureIconParts(value);
  if (!parts.slug) return;
  const tokenKey = parts.key || parts.slug;
  if (state.seenTokens.has(tokenKey)) return;
  state.seenTokens.add(tokenKey);

  const aliasTarget = architectureIconAliasTarget(parts);
  if (aliasTarget) {
    architectureAddIconToken(state, aliasTarget, depth + 1);
  }

  if (parts.namespace === "styled") {
    architectureAddStyledSimpleCandidate(state.styledCandidates, parts.slug);
    if (!state.styledKey) state.styledKey = parts.slug;
    return;
  }

  if (parts.namespace === "generic") {
    if (!state.styledKey) state.styledKey = parts.slug;
    return;
  }

  if (parts.namespace === "aws") {
    architectureAddLikeC4Candidate(state.candidates, "aws", parts.slug);
    architectureAddLikeC4Candidate(state.candidates, "tech", `aws-${parts.slug}`);
    architectureAddStyledSimpleCandidate(state.styledCandidates, `aws-${parts.slug}`);
    return;
  }

  if (parts.namespace === "gcp") {
    architectureAddLikeC4Candidate(state.candidates, "gcp", parts.slug);
    architectureAddLikeC4Candidate(state.candidates, "tech", `google-cloud-${parts.slug}`);
    architectureAddLikeC4Candidate(state.candidates, "tech", `gcp-${parts.slug}`);
    architectureAddStyledSimpleCandidate(state.styledCandidates, `google-cloud-${parts.slug}`);
    return;
  }

  if (parts.namespace === "azure") {
    architectureAddLikeC4Candidate(state.candidates, "azure", parts.slug);
    architectureAddLikeC4Candidate(state.candidates, "tech", `azure-${parts.slug}`);
    architectureAddStyledSimpleCandidate(state.styledCandidates, `azure-${parts.slug}`);
    return;
  }

  if (parts.namespace === "tech") {
    architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
    architectureAddStyledSimpleCandidate(state.styledCandidates, parts.slug);
    return;
  }

  if (parts.namespace === "bootstrap") {
    architectureAddLikeC4Candidate(state.candidates, "bootstrap", parts.slug);
    return;
  }

  if (parts.slug.startsWith("aws-")) {
    const awsSlug = parts.slug.replace(/^aws-/u, "");
    architectureAddIconToken(state, `aws:${awsSlug}`, depth + 1);
    architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
  } else if (parts.slug.startsWith("google-cloud-")) {
    const gcpSlug = parts.slug.replace(/^google-cloud-/u, "");
    architectureAddIconToken(state, `gcp:${gcpSlug}`, depth + 1);
    architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
  } else if (parts.slug.startsWith("gcp-")) {
    architectureAddIconToken(state, `gcp:${parts.slug.replace(/^gcp-/u, "")}`, depth + 1);
  } else if (parts.slug.startsWith("azure-")) {
    const azureSlug = parts.slug.replace(/^azure-/u, "");
    architectureAddIconToken(state, `azure:${azureSlug}`, depth + 1);
    architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
  }

  if (!parts.slug.endsWith("-icon")) {
    architectureAddLikeC4Candidate(state.candidates, "tech", `${parts.slug}-icon`);
  }
  architectureAddLikeC4Candidate(state.candidates, "tech", parts.slug);
  architectureAddStyledSimpleCandidate(state.styledCandidates, parts.slug);
  if (!state.styledKey && ARCHITECTURE_STYLED_ICON_COMPONENTS[parts.slug]) {
    state.styledKey = parts.slug;
  }
}

function architectureIconInitials(value, fallback = "IC") {
  const raw = text(value, fallback);
  return raw
    .split(/[^a-z0-9]+/iu)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || fallback;
}

function architectureResolveIconDescriptor(icon, kind = "service", labelHint = "") {
  const state = {
    candidates: [],
    seenTokens: new Set(),
    styledCandidates: [],
    styledKey: "",
  };
  const rawIcon = text(icon);
  const rawKind = text(kind, "service");
  const rawLabelHint = text(labelHint);
  if (!rawIcon || architectureIconTokenIsGeneric(rawIcon)) {
    architectureAddLabelIconHints(state, rawLabelHint);
  }
  architectureAddIconToken(state, rawIcon || rawKind);
  const kindFallback = ARCHITECTURE_KIND_ICON_FALLBACKS[architectureIconSlug(rawKind)];
  if (kindFallback) architectureAddIconToken(state, kindFallback);
  if (!state.styledKey) {
    const styledFallback = architectureIconSlug(rawKind);
    if (ARCHITECTURE_STYLED_ICON_COMPONENTS[styledFallback]) {
      state.styledKey = styledFallback;
    }
  }
  const displayName = rawIcon || rawKind;
  return {
    candidates: state.candidates,
    key: [
      rawIcon,
      rawKind,
      state.styledKey,
      ...state.candidates.map((candidate) => candidate.path),
      ...state.styledCandidates.map((candidate) => candidate.path),
      rawLabelHint,
    ].join("|"),
    label: architectureIconInitials(rawLabelHint || displayName),
    sourceLabel: displayName,
    styledCandidates: state.styledCandidates,
    styledKey: state.styledKey,
  };
}

function architectureIconFallbackState(descriptor) {
  const Icon = ARCHITECTURE_STYLED_ICON_COMPONENTS[descriptor.styledKey] || null;
  return {
    Icon,
    label: descriptor.label,
    source: Icon ? "styled" : "label",
    title: descriptor.sourceLabel,
  };
}

function architectureLoadLikeC4Icon(candidates) {
  const key = candidates.map((candidate) => candidate.path).join("|");
  if (!key) return Promise.resolve(null);
  if (ARCHITECTURE_LIKEC4_ICON_CACHE.has(key)) {
    return ARCHITECTURE_LIKEC4_ICON_CACHE.get(key);
  }
  const promise = (async () => {
    for (const candidate of candidates) {
      const load = ARCHITECTURE_LIKEC4_ICON_MODULES[candidate.path];
      if (!load) continue;
      try {
        const iconModule = await load();
        if (iconModule?.default) {
          return {
            Icon: iconModule.default,
            title: `${candidate.collection}:${candidate.slug}`,
          };
        }
      } catch {
        // Try the next candidate; bad package entries should not break graph rendering.
      }
    }
    return null;
  })();
  ARCHITECTURE_LIKEC4_ICON_CACHE.set(key, promise);
  return promise;
}

function architectureLoadStyledSimpleIcon(candidates) {
  const key = candidates.map((candidate) => candidate.path).join("|");
  if (!key) return Promise.resolve(null);
  if (ARCHITECTURE_STYLED_SIMPLE_ICON_CACHE.has(key)) {
    return ARCHITECTURE_STYLED_SIMPLE_ICON_CACHE.get(key);
  }
  const promise = (async () => {
    for (const candidate of candidates) {
      const load = ARCHITECTURE_STYLED_SIMPLE_ICON_MODULES[candidate.path];
      if (!load) continue;
      try {
        const iconModule = await load();
        const Icon = iconModule?.[candidate.folder];
        if (Icon) {
          return {
            Icon,
            title: `styled:${candidate.slug}`,
          };
        }
      } catch {
        // Try the next candidate; missing brand fallbacks should not break rendering.
      }
    }
    return null;
  })();
  ARCHITECTURE_STYLED_SIMPLE_ICON_CACHE.set(key, promise);
  return promise;
}

function useArchitectureIcon(icon, kind = "service", labelHint = "") {
  const descriptor = useMemo(
    () => architectureResolveIconDescriptor(icon, kind, labelHint),
    [icon, kind, labelHint],
  );
  const [state, setState] = useState(() => architectureIconFallbackState(descriptor));

  useEffect(() => {
    let cancelled = false;
    setState(architectureIconFallbackState(descriptor));
    Promise.resolve()
      .then(async () => (
        await architectureLoadLikeC4Icon(descriptor.candidates)
        || await architectureLoadStyledSimpleIcon(descriptor.styledCandidates)
      ))
      .then((loaded) => {
      if (cancelled || !loaded?.Icon) return;
      setState({
        Icon: loaded.Icon,
        label: descriptor.label,
        source: loaded.title?.startsWith("styled:") ? "styled" : "likec4",
        title: loaded.title,
      });
    });
    return () => {
      cancelled = true;
    };
  }, [descriptor]);

  return state;
}

function architectureEntityId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function architectureFolderPathParts(value) {
  return jsonArray(value)
    .map((item) => text(item))
    .filter(Boolean);
}

function architectureFolderPathText(value) {
  return architectureFolderPathParts(value).join(" / ");
}

function architectureFileNameFromPath(value) {
  const parts = text(value).replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function architectureGraphFileName(graph) {
  const pathName = architectureFileNameFromPath(graph?.filePath || graph?.file_path);
  if (pathName) return pathName;
  const graphId = text(graph?.id, architectureSlug(graph?.title || "architecture"));
  if (/\.(arch|json)$/iu.test(graphId)) return graphId;
  return `${graphId || "architecture"}.arch`;
}

function createArchitectureTreeNode(name = "", path = []) {
  return {
    folders: new Map(),
    graphs: [],
    name,
    path,
  };
}

function architectureGraphTreeRows(graphs, startDepth = 0) {
  const root = createArchitectureTreeNode();
  jsonArray(graphs).forEach((graph) => {
    const parts = architectureFolderPathParts(graph.groupPath);
    let node = root;
    parts.forEach((part) => {
      const key = part.toLowerCase();
      if (!node.folders.has(key)) {
        node.folders.set(key, createArchitectureTreeNode(part, [...node.path, part]));
      }
      node = node.folders.get(key);
    });
    node.graphs.push(graph);
  });

  const rows = [];
  const sortGraphs = (items) => [...items].sort((left, right) => (
    text(left.title).localeCompare(text(right.title))
  ));
  const flatten = (node, depth) => {
    sortGraphs(node.graphs).forEach((graph) => {
      rows.push({
        depth,
        graph,
        id: graph.id,
        kind: "graph",
      });
    });
    [...node.folders.values()]
      .sort((left, right) => left.name.localeCompare(right.name))
      .forEach((folder) => {
        rows.push({
          depth,
          id: folder.path.join("/"),
          kind: "folder",
          name: folder.name,
          path: folder.path,
        });
        flatten(folder, depth + 1);
      });
  };

  flatten(root, startDepth);
  return rows;
}

function architectureCloudMcpNoiseError(value) {
  const raw = text(value).toLowerCase();
  return raw.includes("cloud mcp app websocket request timed out")
    || raw.includes("cloud mcp websocket request timed out");
}

function architectureEscapeDsl(value) {
  return text(value).replace(/\\/gu, "\\\\").replace(/"/gu, "\\\"");
}

function architectureDslString(value) {
  return `"${architectureEscapeDsl(value)}"`;
}

function architectureDslName(value) {
  const raw = text(value, "Node");
  if (/^[A-Za-z0-9][A-Za-z0-9 _./-]*$/u.test(raw) && !/[{}[\],:<>]/u.test(raw)) {
    return raw;
  }
  return architectureDslString(raw);
}

function architectureStripDslComments(line) {
  let inQuote = false;
  let previous = "";
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && previous !== "\\") inQuote = !inQuote;
    if (!inQuote && char === "/" && next === "/") return line.slice(0, index).trim();
    if (!inQuote && char === "#") return line.slice(0, index).trim();
    previous = char;
  }
  return line.trim();
}

function architectureUnquoteDsl(value) {
  const raw = text(value);
  if (raw.length >= 2 && raw.startsWith("\"") && raw.endsWith("\"")) {
    return raw.slice(1, -1).replace(/\\"/gu, "\"").replace(/\\\\/gu, "\\").trim();
  }
  return raw.trim();
}

function architectureSplitDslTopLevel(value, separator = ",") {
  const parts = [];
  let inQuote = false;
  let bracketDepth = 0;
  let current = "";
  let previous = "";

  for (const char of text(value)) {
    if (char === "\"" && previous !== "\\") inQuote = !inQuote;
    if (!inQuote && char === "[") bracketDepth += 1;
    if (!inQuote && char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (!inQuote && bracketDepth === 0 && char === separator) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
    previous = char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function architectureExtractDslProps(value) {
  const raw = text(value);
  let inQuote = false;
  let bracketStart = -1;
  let previous = "";

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\"" && previous !== "\\") inQuote = !inQuote;
    if (!inQuote && char === "[") bracketStart = index;
    previous = char;
  }

  if (bracketStart < 0 || !raw.endsWith("]")) {
    return { name: architectureUnquoteDsl(raw), props: {} };
  }

  const name = architectureUnquoteDsl(raw.slice(0, bracketStart).trim());
  const propsText = raw.slice(bracketStart + 1, -1);
  const props = {};
  architectureSplitDslTopLevel(propsText).forEach((part) => {
    const colonIndex = part.indexOf(":");
    if (colonIndex <= 0) return;
    const key = part.slice(0, colonIndex).trim();
    const valuePart = architectureUnquoteDsl(part.slice(colonIndex + 1).trim());
    if (key) props[key] = valuePart;
  });
  return { name, props };
}

function architectureSemanticSlug(value, fallback = "") {
  const raw = text(value);
  if (!raw) return fallback;
  return raw
    .toLowerCase()
    .replace(/[_\s]+/gu, "-")
    .replace(/[^a-z0-9:-]+/gu, "-")
    .replace(/-{2,}/gu, "-")
    .replace(/^-|-$/gu, "") || fallback;
}

function architectureSemanticOptionLabel(options, value, fallback = "") {
  const slug = architectureSemanticSlug(value);
  return options.find((option) => option.value === slug)?.label
    || text(fallback)
    || slug.replace(/[-_]+/gu, " ");
}

function architectureGroupIntent(value, fallback = "architecture") {
  const slug = architectureSemanticSlug(value, fallback);
  if (ARCHITECTURE_API_CORRIDOR_ALIASES.has(slug)) return ARCHITECTURE_API_CORRIDOR_INTENT;
  return ARCHITECTURE_GROUP_INTENT_VALUES.has(slug) ? slug : slug;
}

function architectureIsApiCorridorIntent(value) {
  return architectureGroupIntent(value, "") === ARCHITECTURE_API_CORRIDOR_INTENT;
}

function architectureGroupIntentLabel(value) {
  return architectureSemanticOptionLabel(ARCHITECTURE_KIND_OPTIONS, value, "Architecture");
}

function architectureNodeRole(value, fallback = "service") {
  const slug = architectureSemanticSlug(value, fallback);
  if (slug === "client" || slug === "user" || slug === "users") return "actor";
  if (slug === "database" || slug === "db" || slug === "store" || slug === "storage") return "datastore";
  if (slug === "router") return "controller";
  if (slug === "depends" || slug === "dependency") return "dependency";
  return ARCHITECTURE_NODE_ROLE_VALUES.has(slug) ? slug : slug;
}

function architectureEdgeRole(value, fallback = "calls") {
  const slug = architectureSemanticSlug(value, fallback);
  if (slug === "depends" || slug === "dependency") return "depends-on";
  if (slug === "call") return "calls";
  if (slug === "transition") return "transitions";
  if (slug === "guard") return "guards";
  if (slug === "fail" || slug === "failure") return "fails-to";
  return ARCHITECTURE_EDGE_ROLE_VALUES.has(slug) ? slug : slug;
}

function architectureNodeKindFromRole(role, fallback = "service") {
  return ARCHITECTURE_NODE_ROLE_KIND[architectureNodeRole(role)] || fallback;
}

function architectureEdgeKindFromRole(role, fallback = "calls") {
  return ARCHITECTURE_EDGE_ROLE_KIND[architectureEdgeRole(role)] || fallback;
}

function architectureCleanDslProps(props = {}) {
  const object = jsonObject(props) || {};
  return Object.fromEntries(
    Object.entries(object)
      .map(([key, value]) => [text(key), text(value)])
      .filter(([key, value]) => key && value),
  );
}

function architecturePropsWithOrderedOverrides(baseProps = {}, overrides = {}) {
  const next = {
    ...architectureCleanDslProps(baseProps),
    ...architectureCleanDslProps(overrides),
  };
  return Object.fromEntries(Object.entries(next).filter(([, value]) => text(value)));
}

function architectureEdgeConnectorForRole(role, kind = "") {
  const edgeRole = architectureEdgeRole(role || kind);
  const edgeKind = text(kind);
  if (edgeRole === "depends-on" || edgeKind === "depends") return "--";
  return ">";
}

function architectureFindDslLabelIndex(value) {
  let inQuote = false;
  let bracketDepth = 0;
  let previous = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "\"" && previous !== "\\") inQuote = !inQuote;
    if (!inQuote && char === "[") bracketDepth += 1;
    if (!inQuote && char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (!inQuote && bracketDepth === 0 && char === ":") return index;
    previous = char;
  }
  return -1;
}

function architectureTokenizeDslConnection(value) {
  const tokens = [];
  let inQuote = false;
  let bracketDepth = 0;
  let current = "";
  let previous = "";
  let index = 0;
  const pushCurrent = () => {
    const token = current.trim();
    if (token) tokens.push({ type: "name", value: token });
    current = "";
  };

  while (index < value.length) {
    const char = value[index];
    const pair = value.slice(index, index + 2);
    const triple = value.slice(index, index + 3);

    if (char === "\"" && previous !== "\\") inQuote = !inQuote;
    if (!inQuote && char === "[") bracketDepth += 1;
    if (!inQuote && char === "]") bracketDepth = Math.max(0, bracketDepth - 1);

    if (!inQuote && bracketDepth === 0) {
      const connector = triple === "-->" ? "-->"
        : pair === "<>" ? "<>"
          : pair === "--" ? "--"
            : char === ">" || char === "<" ? char : "";
      if (connector) {
        pushCurrent();
        tokens.push({ type: "connector", value: connector });
        index += connector.length;
        previous = "";
        continue;
      }
    }

    current += char;
    previous = char;
    index += 1;
  }
  pushCurrent();
  return tokens;
}

function architectureIconKind(icon, fallback = "service") {
  const raw = text(icon).toLowerCase();
  if (!raw) return fallback;
  if (/(db|database|rds|sql|postgres|mysql|mongo|redis|store|storage|bucket|s3)/u.test(raw)) return "database";
  if (/(user|client|browser|mobile|cli|bot|agent)/u.test(raw)) return "client";
  if (/(queue|kafka|pubsub|bus|stream|event)/u.test(raw)) return "queue";
  if (/(api|gateway|route|router|endpoint)/u.test(raw)) return "api";
  if (/(worker|lambda|function|job)/u.test(raw)) return "worker";
  if (/(external|cloud|github|slack|stripe|third)/u.test(raw)) return "external";
  return fallback;
}

function architectureNormalizeNodeDisplay(value) {
  const raw = architectureIconSlug(value);
  if (/(^|-)(compact|actor|person|people|human|icon|avatar)(-|$)/u.test(raw)) return "compact";
  if (/(^|-)(card|full|node|component)(-|$)/u.test(raw)) return "card";
  return "";
}

function architectureNodeDisplayMode(node, isGroup = false) {
  if (isGroup) return "group";
  const explicit = architectureNormalizeNodeDisplay(
    node?.display || node?.variant || node?.shape || node?.mode || node?.presentation,
  );
  if (explicit) return explicit;

  const titleSlug = architectureIconSlug(node?.title || node?.label || node?.name);
  const iconSlug = architectureIconSlug(node?.icon);
  const kindSlug = architectureIconSlug(node?.kind || node?.type);
  const actorPattern = /(^|-)(user|users|customer|customers|visitor|visitors|admin|admins|operator|operators|person|people|human|humans|actor|actors|agent|agents|bot|bots|client|clients|browser|browsers|cli|terminal)(-|$)/u;
  const systemTitlePattern = /(^|-)(api|service|server|database|db|store|storage|queue|worker|sdk|context|component|router|gateway|controller|manager|provider|page|pages|route|routes)(-|$)/u;
  const actorByIconOrKind = actorPattern.test(iconSlug) || actorPattern.test(kindSlug);
  const actorByTitle = actorPattern.test(titleSlug) && !systemTitlePattern.test(titleSlug);
  return (actorByIconOrKind || actorByTitle)
    ? "compact"
    : "card";
}

function architectureIsCompactNode(node, isGroup = false) {
  return architectureNodeDisplayMode(node, isGroup) === "compact";
}

function architectureDslPropsText(props = {}) {
  const entries = Object.entries(props)
    .filter(([, value]) => text(value))
    .map(([key, value]) => `${key}: ${/[,\][{}:<>]/u.test(text(value)) || /\s/u.test(text(value)) ? architectureDslString(value) : value}`);
  return entries.length ? ` [${entries.join(", ")}]` : "";
}

function architectureLayoutGraph(graph) {
  const nodes = jsonArray(graph.nodes).map((node, index) => ({ ...node, __order: index }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const childrenByParent = new Map();
  nodes.forEach((node) => {
    const parentId = text(node.parentId || "");
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(node);
  });

  const rawDirection = text(graph?.layout?.direction, "LR").toUpperCase();
  const direction = ["LR", "RL", "TB", "BT"].includes(rawDirection) ? rawDirection : "LR";
  const horizontal = direction === "LR" || direction === "RL";
  const reverseRanks = direction === "RL" || direction === "BT";
  const nodeWidth = ARCHITECTURE_NODE_CARD_WIDTH;
  const nodeHeight = ARCHITECTURE_NODE_CARD_HEIGHT;
  const groupMinWidth = 460;
  const groupMinHeight = 280;
  const groupPadX = 52;
  const groupHeaderHeight = 88;
  const groupPadBottom = 48;
  const rootPadX = 80;
  const rootPadY = 70;
  const rankGap = 150;
  const rowGap = 58;
  const groupRankGap = 104;
  const groupRowGap = 44;
  const edges = jsonArray(graph.edges)
    .map((edge) => ({
      source: text(edge?.source || edge?.from),
      target: text(edge?.target || edge?.to),
    }))
    .filter((edge) => edge.source && edge.target && byId.has(edge.source) && byId.has(edge.target));
  const rankById = new Map(nodes.map((node) => [node.id, 0]));
  const incomingById = new Map(nodes.map((node) => [node.id, new Set()]));
  const outgoingById = new Map(nodes.map((node) => [node.id, new Set()]));

  edges.forEach((edge) => {
    if (edge.source === edge.target) return;
    incomingById.get(edge.target)?.add(edge.source);
    outgoingById.get(edge.source)?.add(edge.target);
  });

  const sortedNodes = [...nodes].sort((left, right) => left.__order - right.__order);
  const queue = sortedNodes
    .filter((node) => !(incomingById.get(node.id)?.size))
    .map((node) => node.id);
  if (!queue.length) {
    sortedNodes.forEach((node) => queue.push(node.id));
  }
  const indegree = new Map(nodes.map((node) => [node.id, incomingById.get(node.id)?.size || 0]));
  const queued = new Set(queue);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const sourceId = queue[cursor];
    const sourceRank = rankById.get(sourceId) || 0;
    [...(outgoingById.get(sourceId) || [])]
      .sort((left, right) => (byId.get(left)?.__order || 0) - (byId.get(right)?.__order || 0))
      .forEach((targetId) => {
        rankById.set(targetId, Math.max(rankById.get(targetId) || 0, sourceRank + 1));
        indegree.set(targetId, Math.max(0, (indegree.get(targetId) || 0) - 1));
        if ((indegree.get(targetId) || 0) === 0 && !queued.has(targetId)) {
          queued.add(targetId);
          queue.push(targetId);
        }
      });
  }
  for (let iteration = 0; iteration < nodes.length; iteration += 1) {
    let changed = false;
    edges.forEach((edge) => {
      const nextRank = Math.min(nodes.length, (rankById.get(edge.source) || 0) + 1);
      if ((rankById.get(edge.target) || 0) < nextRank) {
        rankById.set(edge.target, nextRank);
        changed = true;
      }
    });
    if (!changed) break;
  }

  const descendantsByGroup = new Map();
  function descendantNodeIds(groupId) {
    if (descendantsByGroup.has(groupId)) return descendantsByGroup.get(groupId);
    const directChildren = childrenByParent.get(groupId) || [];
    const ids = [];
    directChildren.forEach((child) => {
      if (child.type === "group") {
        ids.push(...descendantNodeIds(child.id));
      } else {
        ids.push(child.id);
      }
    });
    descendantsByGroup.set(groupId, ids);
    return ids;
  }

  function rankForEntity(entity) {
    if (!entity) return 0;
    if (entity.type !== "group") return rankById.get(entity.id) || 0;
    const childRanks = descendantNodeIds(entity.id)
      .map((id) => rankById.get(id))
      .filter((rank) => Number.isFinite(rank));
    return childRanks.length ? Math.min(...childRanks) : rankById.get(entity.id) || 0;
  }

  // Map each edge leaf endpoint id to the scope-level box id that contains it,
  // so inter-group edges influence ordering/alignment at the parent scope.
  function buildEndpointToBoxMap(scopeBoxes) {
    const map = new Map();
    scopeBoxes.forEach((box) => {
      if (box.node?.type === "group") {
        descendantNodeIds(box.id).forEach((leafId) => map.set(leafId, box.id));
      } else {
        map.set(box.id, box.id);
      }
    });
    return map;
  }

  function countInversions(values) {
    const work = values.slice();
    const tmp = new Array(work.length);
    let count = 0;
    const sort = (lo, hi) => {
      if (hi - lo <= 1) return;
      const mid = (lo + hi) >> 1;
      sort(lo, mid);
      sort(mid, hi);
      let i = lo;
      let j = mid;
      let k = lo;
      while (i < mid && j < hi) {
        if (work[i] <= work[j]) {
          tmp[k] = work[i];
          i += 1;
        } else {
          tmp[k] = work[j];
          j += 1;
          count += mid - i;
        }
        k += 1;
      }
      while (i < mid) { tmp[k] = work[i]; i += 1; k += 1; }
      while (j < hi) { tmp[k] = work[j]; j += 1; k += 1; }
      for (let t = lo; t < hi; t += 1) work[t] = tmp[t];
    };
    sort(0, work.length);
    return count;
  }

  // Sugiyama median crossing-minimization within ranks. Returns a global
  // ordinal map; deterministic (seeded from DSL order, tie-broken by it).
  function orderRanksByMedian(scopeBoxes) {
    const ids = new Set(scopeBoxes.map((box) => box.id));
    if (ids.size <= 2) return new Map();
    const rankOf = new Map(scopeBoxes.map((box) => [box.id, numberValue(box.rank, 0)]));
    const dslOrder = new Map(scopeBoxes.map((box) => [box.id, numberValue(box.order, 0)]));
    const endpointBox = buildEndpointToBoxMap(scopeBoxes);
    const downAdj = new Map([...ids].map((id) => [id, []]));
    const upAdj = new Map([...ids].map((id) => [id, []]));
    edges.forEach((edge) => {
      const sourceBox = endpointBox.get(edge.source);
      const targetBox = endpointBox.get(edge.target);
      if (!sourceBox || !targetBox || sourceBox === targetBox) return;
      if (!ids.has(sourceBox) || !ids.has(targetBox)) return;
      const sourceRank = rankOf.get(sourceBox);
      const targetRank = rankOf.get(targetBox);
      if (sourceRank === targetRank) return;
      const [low, high] = sourceRank < targetRank ? [sourceBox, targetBox] : [targetBox, sourceBox];
      downAdj.get(low).push(high);
      upAdj.get(high).push(low);
    });

    const rankKeys = [...new Set(scopeBoxes.map((box) => numberValue(box.rank, 0)))]
      .sort((left, right) => left - right);
    if (reverseRanks) rankKeys.reverse();
    let layers = rankKeys.map((rank) => scopeBoxes
      .filter((box) => numberValue(box.rank, 0) === rank)
      .sort((left, right) => dslOrder.get(left.id) - dslOrder.get(right.id)
        || text(left.id).localeCompare(text(right.id)))
      .map((box) => box.id));

    const medianValue = (neighbors, pos) => {
      const positions = neighbors
        .map((neighbor) => pos.get(neighbor))
        .filter((value) => value !== undefined)
        .sort((left, right) => left - right);
      if (!positions.length) return -1;
      const mid = Math.floor(positions.length / 2);
      if (positions.length % 2 === 1) return positions[mid];
      if (positions.length === 2) return (positions[0] + positions[1]) / 2;
      const left = positions[mid - 1] - positions[0];
      const right = positions[positions.length - 1] - positions[mid];
      if (left + right === 0) return (positions[mid - 1] + positions[mid]) / 2;
      return (positions[mid - 1] * right + positions[mid] * left) / (left + right);
    };

    const sortLayer = (layer, adj, pos) => {
      const measure = new Map(layer.map((id) => [id, medianValue(adj.get(id) || [], pos)]));
      const fixed = layer.map((id) => measure.get(id) === -1);
      const movable = layer
        .filter((id) => measure.get(id) !== -1)
        .sort((left, right) => measure.get(left) - measure.get(right)
          || dslOrder.get(left) - dslOrder.get(right)
          || text(left).localeCompare(text(right)));
      const result = [];
      let cursor = 0;
      layer.forEach((id, index) => {
        result.push(fixed[index] ? id : movable[cursor++]);
      });
      return result;
    };

    const buildPos = (currentLayers) => {
      const pos = new Map();
      currentLayers.forEach((layer) => layer.forEach((id, index) => pos.set(id, index)));
      return pos;
    };

    const crossingsBetween = (upper, lower) => {
      const lowerPos = new Map(lower.map((id, index) => [id, index]));
      const sequence = [];
      upper.forEach((id, upperIndex) => {
        (downAdj.get(id) || []).forEach((neighbor) => {
          if (lowerPos.has(neighbor)) sequence.push([upperIndex, lowerPos.get(neighbor)]);
        });
      });
      sequence.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
      return countInversions(sequence.map((pair) => pair[1]));
    };

    const totalCrossings = (currentLayers) => {
      let total = 0;
      for (let index = 0; index + 1 < currentLayers.length; index += 1) {
        total += crossingsBetween(currentLayers[index], currentLayers[index + 1]);
      }
      return total;
    };

    let best = layers.map((layer) => [...layer]);
    let bestCrossings = totalCrossings(layers);
    for (let sweep = 0; sweep < 8 && bestCrossings > 0; sweep += 1) {
      const pos = buildPos(layers);
      if (sweep % 2 === 0) {
        for (let index = 1; index < layers.length; index += 1) {
          layers[index] = sortLayer(layers[index], upAdj, pos);
          layers[index].forEach((id, idx) => pos.set(id, idx));
        }
      } else {
        for (let index = layers.length - 2; index >= 0; index -= 1) {
          layers[index] = sortLayer(layers[index], downAdj, pos);
          layers[index].forEach((id, idx) => pos.set(id, idx));
        }
      }
      const crossings = totalCrossings(layers);
      if (crossings < bestCrossings) {
        bestCrossings = crossings;
        best = layers.map((layer) => [...layer]);
      }
    }

    const orderMap = new Map();
    let ordinal = 0;
    best.forEach((layer) => layer.forEach((id) => orderMap.set(id, ordinal++)));
    return orderMap;
  }

  // Pull each box's cross-axis coordinate toward the median of its neighbors'
  // centers so chains straighten. Order-preserving (no new crossings).
  function alignCrossAxis(placed, gap) {
    if (placed.length <= 1) return;
    const crossKey = horizontal ? "y" : "x";
    const sizeKey = horizontal ? "height" : "width";
    const boxById = new Map(placed.map((box) => [box.id, box]));
    const endpointBox = buildEndpointToBoxMap(placed);
    const neighbors = new Map(placed.map((box) => [box.id, []]));
    edges.forEach((edge) => {
      const sourceBox = endpointBox.get(edge.source);
      const targetBox = endpointBox.get(edge.target);
      if (!sourceBox || !targetBox || sourceBox === targetBox) return;
      if (!boxById.has(sourceBox) || !boxById.has(targetBox)) return;
      if (numberValue(boxById.get(sourceBox).rank, 0) === numberValue(boxById.get(targetBox).rank, 0)) return;
      neighbors.get(sourceBox).push(targetBox);
      neighbors.get(targetBox).push(sourceBox);
    });

    const byRank = new Map();
    placed.forEach((box) => {
      const rank = numberValue(box.rank, 0);
      if (!byRank.has(rank)) byRank.set(rank, []);
      byRank.get(rank).push(box);
    });
    const rankKeys = [...byRank.keys()].sort((left, right) => left - right);
    const layers = rankKeys.map((rank) => byRank.get(rank));

    const centerOf = (box) => box[crossKey] + numberValue(box[sizeKey], 0) / 2;
    const desiredCenter = (box) => {
      const centers = (neighbors.get(box.id) || [])
        .map((id) => centerOf(boxById.get(id)))
        .sort((left, right) => left - right);
      if (!centers.length) return null;
      const mid = Math.floor(centers.length / 2);
      return centers.length % 2 === 1 ? centers[mid] : (centers[mid - 1] + centers[mid]) / 2;
    };

    const passLayer = (layer) => {
      for (let index = 0; index < layer.length; index += 1) {
        const box = layer[index];
        const want = desiredCenter(box);
        if (want === null) continue;
        const halfSize = numberValue(box[sizeKey], 0) / 2;
        let low = -Infinity;
        let high = Infinity;
        if (index > 0) {
          const prev = layer[index - 1];
          low = prev[crossKey] + numberValue(prev[sizeKey], 0) + gap + halfSize;
        }
        if (index < layer.length - 1) {
          const next = layer[index + 1];
          high = next[crossKey] - gap - halfSize;
        }
        if (low > high) continue;
        const clamped = Math.max(low, Math.min(high, want));
        box[crossKey] = Math.round(clamped - halfSize);
      }
    };

    for (let round = 0; round < 2; round += 1) {
      for (let index = 0; index < layers.length; index += 1) passLayer(layers[index]);
      for (let index = layers.length - 1; index >= 0; index -= 1) passLayer(layers[index]);
    }
  }

  function layoutRankedBoxes(boxes, options = {}) {
    const safeBoxes = boxes.filter(Boolean);
    const medianOrder = orderRanksByMedian(safeBoxes);
    const paddingLeft = numberValue(options.paddingLeft, 0);
    const paddingTop = numberValue(options.paddingTop, 0);
    const paddingRight = numberValue(options.paddingRight, paddingLeft);
    const paddingBottom = numberValue(options.paddingBottom, paddingTop);
    const localRankGap = numberValue(options.rankGap, rankGap);
    const localRowGap = numberValue(options.rowGap, rowGap);
    const minWidth = numberValue(options.minWidth, 0);
    const minHeight = numberValue(options.minHeight, 0);
    if (!safeBoxes.length) {
      return {
        boxes: [],
        height: Math.max(minHeight, paddingTop + paddingBottom),
        width: Math.max(minWidth, paddingLeft + paddingRight),
      };
    }

    const rankKeys = [...new Set(safeBoxes.map((box) => numberValue(box.rank, 0)))]
      .sort((left, right) => left - right);
    if (reverseRanks) rankKeys.reverse();
    const boxesByRank = new Map(rankKeys.map((rank) => [rank, []]));
    safeBoxes
      .sort((left, right) => (
        numberValue(left.rank, 0) - numberValue(right.rank, 0)
          || (medianOrder.get(left.id) ?? numberValue(left.order, 0))
            - (medianOrder.get(right.id) ?? numberValue(right.order, 0))
          || numberValue(left.order, 0) - numberValue(right.order, 0)
          || text(left.id).localeCompare(text(right.id))
      ))
      .forEach((box) => {
        const rank = numberValue(box.rank, 0);
        if (!boxesByRank.has(rank)) boxesByRank.set(rank, []);
        boxesByRank.get(rank).push(box);
      });

    const placed = [];
    let width = paddingLeft + paddingRight;
    let height = paddingTop + paddingBottom;
    if (horizontal) {
      let x = paddingLeft;
      rankKeys.forEach((rank) => {
        const rankBoxes = boxesByRank.get(rank) || [];
        const columnWidth = Math.max(...rankBoxes.map((box) => numberValue(box.width, nodeWidth)), nodeWidth);
        let y = paddingTop;
        rankBoxes.forEach((box) => {
          const boxWidth = numberValue(box.width, nodeWidth);
          const boxHeight = numberValue(box.height, nodeHeight);
          placed.push({
            ...box,
            x: Math.round(x + Math.max(0, (columnWidth - boxWidth) / 2)),
            y: Math.round(y),
          });
          y += boxHeight + localRowGap;
        });
        width = Math.max(width, x + columnWidth + paddingRight);
        height = Math.max(height, y - localRowGap + paddingBottom);
        x += columnWidth + localRankGap;
      });
    } else {
      let y = paddingTop;
      rankKeys.forEach((rank) => {
        const rankBoxes = boxesByRank.get(rank) || [];
        const rowHeight = Math.max(...rankBoxes.map((box) => numberValue(box.height, nodeHeight)), nodeHeight);
        let x = paddingLeft;
        rankBoxes.forEach((box) => {
          const boxWidth = numberValue(box.width, nodeWidth);
          const boxHeight = numberValue(box.height, nodeHeight);
          placed.push({
            ...box,
            x: Math.round(x),
            y: Math.round(y + Math.max(0, (rowHeight - boxHeight) / 2)),
          });
          x += boxWidth + localRowGap;
        });
        width = Math.max(width, x - localRowGap + paddingRight);
        height = Math.max(height, y + rowHeight + paddingBottom);
        y += rowHeight + localRankGap;
      });
    }

    alignCrossAxis(placed, localRowGap);
    if (placed.length) {
      const crossKey = horizontal ? "y" : "x";
      const padStart = horizontal ? paddingTop : paddingLeft;
      const minCross = Math.min(...placed.map((box) => box[crossKey]));
      const shift = padStart - minCross;
      if (shift > 0.5) {
        const delta = Math.round(shift);
        placed.forEach((box) => { box[crossKey] += delta; });
      }
      let maxRight = 0;
      let maxBottom = 0;
      placed.forEach((box) => {
        maxRight = Math.max(maxRight, box.x + numberValue(box.width, nodeWidth));
        maxBottom = Math.max(maxBottom, box.y + numberValue(box.height, nodeHeight));
      });
      width = Math.max(width, maxRight + paddingRight);
      height = Math.max(height, maxBottom + paddingBottom);
    }

    return {
      boxes: placed,
      height: Math.max(minHeight, Math.round(height)),
      width: Math.max(minWidth, Math.round(width)),
    };
  }

  const laidOutGroups = new Map();
  function boxForEntity(entity) {
    if (!entity) return null;
    if (entity.type === "group") return layoutGroup(entity);
    const compact = architectureIsCompactNode(entity);
    return {
      height: compact ? ARCHITECTURE_NODE_COMPACT_HEIGHT : nodeHeight,
      id: entity.id,
      node: entity,
      order: entity.__order,
      rank: rankForEntity(entity),
      width: compact ? ARCHITECTURE_NODE_COMPACT_WIDTH : nodeWidth,
    };
  }

  function layoutGroup(group) {
    if (laidOutGroups.has(group.id)) return laidOutGroups.get(group.id);
    const directChildren = childrenByParent.get(group.id) || [];
    const childBoxes = directChildren.map(boxForEntity).filter(Boolean);
    const layout = layoutRankedBoxes(childBoxes, {
      minHeight: groupMinHeight,
      minWidth: groupMinWidth,
      paddingBottom: groupPadBottom,
      paddingLeft: groupPadX,
      paddingRight: groupPadX,
      paddingTop: groupHeaderHeight,
      rankGap: groupRankGap,
      rowGap: groupRowGap,
    });
    layout.boxes.forEach((box) => {
      box.node.position = { x: box.x, y: box.y };
    });
    group.width = Math.max(numberValue(group.width, 0), layout.width);
    group.height = Math.max(numberValue(group.height, 0), layout.height);
    const groupBox = {
      height: group.height,
      id: group.id,
      node: group,
      order: group.__order,
      rank: rankForEntity(group),
      width: group.width,
    };
    laidOutGroups.set(group.id, groupBox);
    return groupBox;
  }

  const rootLayout = layoutRankedBoxes((childrenByParent.get("") || []).map(boxForEntity), {
    minHeight: 360,
    minWidth: 760,
    paddingBottom: rootPadY,
    paddingLeft: rootPadX,
    paddingRight: rootPadX,
    paddingTop: rootPadY,
    rankGap,
    rowGap,
  });
  rootLayout.boxes.forEach((box) => {
    box.node.position = { x: box.x, y: box.y };
  });

  return {
    ...graph,
    layout: {
      ...(jsonObject(graph?.layout) || {}),
      direction,
      engine: "ranked",
    },
    nodes: nodes
      .sort((left, right) => left.__order - right.__order)
      .map(({ __order, ...node }) => node),
  };
}

function architectureParseDslGraph(graph) {
  const source = text(graph?.source);
  if (!source) return jsonObject(graph) || null;

  const parsed = {
    id: text(graph?.id, architectureSlug(graph?.title || "architecture")),
    title: text(graph?.title, "Architecture graph"),
    kind: "architecture",
    groupPath: architectureFolderPathParts(graph?.groupPath),
    layout: { direction: "LR", engine: "dsl" },
    source,
    sourceFormat: "eraserDsl",
    version: 2,
    createdAt: text(graph?.createdAt),
    updatedAt: text(graph?.updatedAt),
    filePath: text(graph?.filePath),
    nodes: [],
    edges: [],
    apiCorridors: [],
    runTargets: [],
  };
  const nameToId = new Map();
  const nodeById = new Map();
  const stack = [];
  const idCounts = new Map();

  const uniqueId = (name, prefix = "node") => {
    const base = architectureSlug(name, prefix);
    const count = idCounts.get(base) || 0;
    idCounts.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  };
  const registerNode = (name, props = {}, isGroup = false, explicitParentId = "") => {
    const cleanName = text(name);
    if (!cleanName) return null;
    if (nameToId.has(cleanName)) return nameToId.get(cleanName);
    const id = uniqueId(cleanName, isGroup ? "group" : "node");
    const parentId = explicitParentId || [...stack].reverse().find((item) => item.type === "group")?.id || "";
    const semanticProps = architectureCleanDslProps(props);
    const title = text(props.label, cleanName);
    const intent = isGroup
      ? architectureGroupIntent(props.intent || props.view || props.kind || props.type)
      : "";
    const role = !isGroup
      ? architectureNodeRole(props.role || props.kind || props.type || architectureIconKind(props.icon, "service"))
      : "";
    const icon = text(
      props.icon,
      isGroup
        ? ARCHITECTURE_GROUP_INTENT_ICONS[intent] || "group"
        : ARCHITECTURE_NODE_ROLE_ICONS[role] || "",
    );
    const kind = isGroup ? "group" : architectureNodeKindFromRole(role, architectureIconKind(icon, "service"));
    const display = architectureNodeDisplayMode({ ...props, icon, kind, role, title }, isGroup);
    const node = {
      id,
      title,
      subtitle: display === "compact"
        ? ""
        : text(props.desc || props.description, isGroup ? architectureGroupIntentLabel(intent) : ""),
      kind,
      type: isGroup ? "group" : "node",
      icon,
      color: text(props.color, isGroup ? ARCHITECTURE_GROUP_INTENT_COLORS[intent] : ""),
      semanticProps,
      ...(isGroup ? {
        intent,
        owner: text(props.owner),
        scope: text(props.scope),
        status: text(props.status),
      } : {
        lifecycle: text(props.lifecycle),
        role,
        source: text(props.source || props.ref || props.reference),
        status: text(props.status),
      }),
      ...(!isGroup ? { display } : {}),
      ...(parentId ? { parentId } : {}),
    };
    parsed.nodes.push(node);
    nodeById.set(id, node);
    nameToId.set(cleanName, id);
    return id;
  };
  const ensureNode = (name) => registerNode(name, {}, false, "");
  const resolveReference = (value) => {
    const raw = text(value);
    if (!raw) return "";
    return nameToId.get(raw) || (nodeById.has(raw) ? raw : "");
  };
  const pushCorridorStep = (corridor, leftName, rightName, connectorValue, cleanLabel, edgeProps = {}) => {
    if (!corridor || !leftName || !rightName) return;
    const sourceName = connectorValue === "<" ? rightName : leftName;
    const targetName = connectorValue === "<" ? leftName : rightName;
    const role = architectureEdgeRole(
      edgeProps.role || edgeProps.kind || edgeProps.type,
      "request",
    );
    corridor.steps.push({
      id: uniqueId(`${corridor.id}-step`, "corridor-step"),
      sourceName,
      targetName,
      label: cleanLabel,
      kind: architectureEdgeKindFromRole(role, "calls"),
      role,
      branch: text(edgeProps.branch || edgeProps.variant),
      condition: text(edgeProps.condition || edgeProps.guard),
      criticality: text(edgeProps.criticality),
      event: text(edgeProps.event),
      method: text(edgeProps.method),
      path: text(edgeProps.path || edgeProps.route),
      status: text(edgeProps.status),
      step: text(edgeProps.step),
      semanticProps: edgeProps,
    });
  };

  source.split(/\r?\n/u).forEach((rawLine) => {
    let line = architectureStripDslComments(rawLine);
    if (!line) return;
    if (line === "}") {
      stack.pop();
      return;
    }
    if (line.startsWith("title ")) {
      parsed.title = architectureUnquoteDsl(line.slice(6));
      return;
    }
    if (line.startsWith("folder ") || line.startsWith("groupPath ") || line.startsWith("path ")) {
      parsed.groupPath = architectureUnquoteDsl(line.replace(/^(folder|groupPath|path)\s+/u, ""))
        .split(/[/>]/u)
        .map((part) => part.trim())
        .filter(Boolean);
      return;
    }
    if (line.startsWith("direction ")) {
      const direction = text(line.slice(10)).toLowerCase();
      parsed.layout.direction = direction === "down" ? "TB"
        : direction === "up" ? "BT"
          : direction === "left" ? "RL" : "LR";
      return;
    }
    if (/^run\s+/u.test(line)) {
      const target = architectureRunTargetFromDslLine(line, parsed.runTargets.length);
      if (target) parsed.runTargets.push(target);
      return;
    }
    if (/^(colorMode|styleMode|typeface|legend)\b/u.test(line)) return;

    const opensGroup = line.endsWith("{");
    if (opensGroup) {
      line = line.slice(0, -1).trim();
      const { name, props } = architectureExtractDslProps(line);
      const intent = architectureGroupIntent(props.intent || props.view || props.kind || props.type);
      if (architectureIsApiCorridorIntent(intent)) {
        const semanticProps = architectureCleanDslProps(props);
        const id = uniqueId(name, "api-corridor");
        const corridor = {
          id,
          title: text(props.label, name),
          anchorName: text(props.anchor || props.endpoint || props.edge),
          display: text(props.display || props.mode, "overlay"),
          fromName: text(props.from || props.source || props.client),
          intent: ARCHITECTURE_API_CORRIDOR_INTENT,
          lastVerified: text(props.lastVerified || props.last_verified || props.verified),
          orient: text(props.orient || props.orientation, "shortest-path"),
          route: text(props.route || props.via),
          semanticProps,
          source: text(props.sourceRef || props.source || props.ref),
          status: text(props.status, "current"),
          steps: [],
          toName: text(props.to || props.target || props.server),
        };
        parsed.apiCorridors.push(corridor);
        stack.push({ corridor, id, name, type: "apiCorridor" });
        return;
      }
      const id = registerNode(name, props, true);
      if (id) stack.push({ id, name, type: "group" });
      return;
    }

    const labelIndex = architectureFindDslLabelIndex(line);
    const connectionExpression = labelIndex >= 0 ? line.slice(0, labelIndex).trim() : line;
    const connectionLabelRaw = labelIndex >= 0 ? line.slice(labelIndex + 1).trim() : "";
    const tokens = architectureTokenizeDslConnection(connectionExpression);
    if (tokens.some((token) => token.type === "connector")) {
      const labelParts = architectureExtractDslProps(connectionLabelRaw);
      const cleanLabel = labelParts.name;
      const edgeProps = architectureCleanDslProps(labelParts.props);
      const activeCorridor = stack.at(-1)?.type === "apiCorridor" ? stack.at(-1).corridor : null;
      for (let index = 0; index < tokens.length - 2; index += 2) {
        const left = tokens[index];
        const connector = tokens[index + 1];
        const right = tokens[index + 2];
        if (left?.type !== "name" || connector?.type !== "connector" || right?.type !== "name") continue;
        const leftNames = architectureSplitDslTopLevel(left.value).map((item) => architectureExtractDslProps(item).name).filter(Boolean);
        const rightNames = architectureSplitDslTopLevel(right.value).map((item) => architectureExtractDslProps(item).name).filter(Boolean);
        leftNames.forEach((leftName) => {
          rightNames.forEach((rightName) => {
            if (activeCorridor) {
              pushCorridorStep(activeCorridor, leftName, rightName, connector.value, cleanLabel, edgeProps);
              if (connector.value === "<>") {
                pushCorridorStep(activeCorridor, rightName, leftName, ">", cleanLabel, edgeProps);
              }
              return;
            }
            const sourceId = ensureNode(connector.value === "<" ? rightName : leftName);
            const targetId = ensureNode(connector.value === "<" ? leftName : rightName);
            if (!sourceId || !targetId) return;
            const role = architectureEdgeRole(
              edgeProps.role || edgeProps.kind || edgeProps.type,
              connector.value === "--" ? "depends-on" : "calls",
            );
            parsed.edges.push({
              id: uniqueId(`${sourceId}-${targetId}`, "edge"),
              source: sourceId,
              target: targetId,
              label: cleanLabel,
              kind: architectureEdgeKindFromRole(role, connector.value === "--" ? "depends" : "calls"),
              role,
              condition: text(edgeProps.condition || edgeProps.guard),
              criticality: text(edgeProps.criticality),
              event: text(edgeProps.event),
              semanticProps: edgeProps,
            });
            if (connector.value === "<>") {
              parsed.edges.push({
                id: uniqueId(`${targetId}-${sourceId}`, "edge"),
                source: targetId,
                target: sourceId,
                label: cleanLabel,
                kind: architectureEdgeKindFromRole(role, "calls"),
                role,
                condition: text(edgeProps.condition || edgeProps.guard),
                criticality: text(edgeProps.criticality),
                event: text(edgeProps.event),
                semanticProps: edgeProps,
              });
            }
          });
        });
      }
      return;
    }

    const { name, props } = architectureExtractDslProps(line);
    if (stack.at(-1)?.type === "apiCorridor") return;
    registerNode(name, props, false);
  });

  parsed.apiCorridors = parsed.apiCorridors
    .map((corridor, index) => {
      const fromId = resolveReference(corridor.fromName)
        || resolveReference(corridor.steps[0]?.sourceName)
        || "";
      const toId = resolveReference(corridor.toName)
        || resolveReference(corridor.steps.at(-1)?.targetName)
        || "";
      const routeNames = architectureTokenizeDslConnection(corridor.route)
        .filter((token) => token.type === "name")
        .flatMap((token) => architectureSplitDslTopLevel(token.value).map((item) => architectureExtractDslProps(item).name))
        .filter(Boolean);
      const steps = corridor.steps.map((step, stepIndex) => ({
        ...step,
        source: resolveReference(step.sourceName),
        target: resolveReference(step.targetName),
        step: text(step.step, String(stepIndex + 1)),
      }));
      return {
        ...corridor,
        anchor: resolveReference(corridor.anchorName),
        from: fromId,
        index,
        routeIds: routeNames.map(resolveReference).filter(Boolean),
        routeNames,
        steps,
        to: toId,
      };
    })
    .filter((corridor) => corridor.steps.length);

  return architectureLayoutGraph(parsed);
}

function architectureEmptyGraphSource({ groupPath = "", title = "" } = {}) {
  const cleanTitle = text(title, "Architecture graph");
  const groupParts = text(groupPath)
    .split(/[/>]/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 8);
  const lines = [
    `title ${architectureDslString(cleanTitle)}`,
    "direction right",
  ];
  if (groupParts.length) lines.push(`folder ${architectureDslString(groupParts.join(" / "))}`);
  return `${lines.join("\n")}\n`;
}

function architectureEmptyGraph({ groupPath = "", title = "" } = {}) {
  const cleanTitle = text(title, "Architecture graph");
  const id = `${architectureSlug(cleanTitle)}-${String(Date.now()).slice(-5)}`;
  const source = architectureEmptyGraphSource({ groupPath, title: cleanTitle });
  return architectureParseDslGraph({
    id,
    title: cleanTitle,
    groupPath: text(groupPath)
      .split(/[/>]/u)
      .map((part) => part.trim())
      .filter(Boolean),
    source,
    sourceFormat: "eraserDsl",
  });
}

function architectureSourceHandlePosition(direction) {
  if (direction === "TB") return Position.Bottom;
  if (direction === "BT") return Position.Top;
  if (direction === "RL") return Position.Left;
  return Position.Right;
}

function architectureTargetHandlePosition(direction) {
  if (direction === "TB") return Position.Top;
  if (direction === "BT") return Position.Bottom;
  if (direction === "RL") return Position.Right;
  return Position.Left;
}

function architectureFlowNodeFromGraphNode(node, index = 0, direction = "LR") {
  const isSourceGroup = text(node?.kind || node?.type) === "group" || text(node?.type) === "group";
  const intent = isSourceGroup ? architectureGroupIntent(node?.intent || node?.view || node?.groupIntent) : "";
  const role = !isSourceGroup ? architectureNodeRole(node?.role || node?.semanticRole || node?.kind || node?.type) : "";
  const rawKind = text(
    node?.kind && node?.kind !== "node" ? node.kind : "",
    isSourceGroup ? "group" : architectureNodeKindFromRole(role, "service"),
  );
  const isGroup = rawKind === "group" || text(node?.type) === "group";
  const id = text(node?.id, architectureEntityId(isGroup ? "group" : "node"));
  const parentId = text(node?.parentId || node?.parent_id);
  const position = jsonObject(node?.position) || {};
  const title = text(node?.title || node?.label, isGroup ? "Group" : "Node");
  const semanticProps = architectureCleanDslProps(node?.semanticProps || node?.semantic_props || node?.props);
  const display = architectureNodeDisplayMode({ ...node, kind: rawKind, role, title }, isGroup);
  const compact = display === "compact";
  const icon = text(
    node?.icon,
    isGroup
      ? ARCHITECTURE_GROUP_INTENT_ICONS[intent] || "group"
      : ARCHITECTURE_NODE_ROLE_ICONS[role] || "",
  );
  const width = numberValue(
    node?.width || node?.style?.width,
    isGroup ? 460 : compact ? ARCHITECTURE_NODE_COMPACT_WIDTH : ARCHITECTURE_NODE_CARD_WIDTH,
  );
  const height = numberValue(
    node?.height || node?.style?.height,
    isGroup ? 280 : compact ? ARCHITECTURE_NODE_COMPACT_HEIGHT : ARCHITECTURE_NODE_CARD_HEIGHT,
  );

  return {
    id,
    type: isGroup ? "architectureGroup" : "architectureNode",
    parentId: parentId || undefined,
    extent: parentId ? "parent" : undefined,
    position: {
      x: numberValue(position.x, 80 + (index % 3) * 220),
      y: numberValue(position.y, 80 + Math.floor(index / 3) * 120),
    },
    sourcePosition: architectureSourceHandlePosition(direction),
    style: isGroup || compact ? { width, height } : undefined,
    targetPosition: architectureTargetHandlePosition(direction),
    data: {
      color: text(node?.color),
      display,
      flowDirection: direction,
      icon,
      intent,
      kind: isGroup ? "group" : rawKind,
      lifecycle: text(node?.lifecycle),
      owner: text(node?.owner),
      role,
      scope: text(node?.scope),
      semanticProps,
      source: text(node?.source || node?.sourceRef || node?.reference),
      status: text(node?.status),
      subtitle: compact ? "" : text(
        node?.subtitle || node?.description,
        isGroup ? architectureGroupIntentLabel(intent) : "",
      ),
      title,
    },
  };
}

function architectureFlowEdgeFromGraphEdge(edge) {
  const source = text(edge?.source || edge?.from);
  const target = text(edge?.target || edge?.to);
  if (!source || !target) return null;
  return {
    id: text(edge?.id, `${source}-${target}`),
    source,
    target,
    type: "architectureEdge",
    zIndex: 0,
    markerEnd: {
      color: "rgba(125, 211, 252, 0.88)",
      height: 18,
      type: MarkerType.ArrowClosed,
      width: 18,
    },
    data: {
      condition: text(edge?.condition || edge?.guard),
      criticality: text(edge?.criticality),
      event: text(edge?.event),
      kind: text(edge?.kind, architectureEdgeKindFromRole(edge?.role, "calls")),
      label: text(edge?.label || edge?.title),
      role: architectureEdgeRole(edge?.role || edge?.kind, "calls"),
      semanticProps: architectureCleanDslProps(edge?.semanticProps || edge?.semantic_props || edge?.props),
    },
  };
}

function architectureFlowNodeTitle(node) {
  return text(node?.data?.title || node?.title || node?.label || node?.id, "Node");
}

function architectureShortestPathNodeIds(sourceId, targetId, edges) {
  const source = text(sourceId);
  const target = text(targetId);
  if (!source || !target) return [];
  if (source === target) return [source];
  const neighbors = new Map();
  const add = (left, right) => {
    if (!left || !right) return;
    if (!neighbors.has(left)) neighbors.set(left, new Set());
    neighbors.get(left).add(right);
  };
  jsonArray(edges).forEach((edge) => {
    add(edge.source, edge.target);
    add(edge.target, edge.source);
  });
  const queue = [[source]];
  const seen = new Set([source]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const path = queue[cursor];
    const last = path.at(-1);
    for (const neighbor of neighbors.get(last) || []) {
      if (seen.has(neighbor)) continue;
      const nextPath = [...path, neighbor];
      if (neighbor === target) return nextPath;
      seen.add(neighbor);
      queue.push(nextPath);
    }
  }
  return [source, target];
}

function architectureApiCorridorParticipantIds(corridor, edges) {
  const from = text(corridor?.from);
  const to = text(corridor?.to);
  const routeIds = jsonArray(corridor?.routeIds).map(text).filter(Boolean);
  if (routeIds.length >= 2) return routeIds;
  const shortest = architectureShortestPathNodeIds(from, to, edges);
  if (shortest.length >= 2) return shortest;
  const stepIds = [];
  jsonArray(corridor?.steps).forEach((step) => {
    [step?.source, step?.target].map(text).filter(Boolean).forEach((id) => {
      if (!stepIds.includes(id)) stepIds.push(id);
    });
  });
  return stepIds.length ? stepIds : [from, to].filter(Boolean);
}

function architectureApiCorridorRoleTone(role) {
  const normalized = architectureEdgeRole(role);
  if (["response", "callback"].includes(normalized)) return "response";
  if (["redirect"].includes(normalized)) return "redirect";
  if (["reads", "writes", "publishes", "subscribes"].includes(normalized)) return "effect";
  if (["retries", "fails-to"].includes(normalized)) return "failure";
  return "request";
}

function architectureApiCorridorStepLabel(step) {
  return text(
    step?.label
      || [step?.method, step?.path].map(text).filter(Boolean).join(" ")
      || step?.event
      || step?.status,
    "exchange",
  );
}

function architectureApiCorridorSummary(corridor) {
  const firstRequest = jsonArray(corridor?.steps).find((step) => text(step?.method) || text(step?.path))
    || jsonArray(corridor?.steps)[0]
    || null;
  return [
    text(firstRequest?.method),
    text(firstRequest?.path),
  ].filter(Boolean).join(" ") || architectureApiCorridorStepLabel(firstRequest) || text(corridor?.title, "API corridor");
}

function architectureApiCorridorFlowNodeFromCorridor(corridor, index, flowNodes, flowEdges, direction = "LR") {
  if (!corridor || typeof corridor !== "object") return null;
  const nodeById = new Map(flowNodes.map((node) => [node.id, node]));
  const routeIds = architectureApiCorridorParticipantIds(corridor, flowEdges)
    .filter((id) => nodeById.has(id));
  const fromId = text(corridor.from) || routeIds[0] || "";
  const toId = text(corridor.to) || routeIds.at(-1) || "";
  const fromNode = nodeById.get(fromId) || nodeById.get(routeIds[0]);
  const toNode = nodeById.get(toId) || nodeById.get(routeIds.at(-1));
  if (!fromNode || !toNode) return null;

  const positionCache = new Map();
  const fromPosition = architectureAbsoluteNodePosition(fromNode, nodeById, positionCache);
  const toPosition = architectureAbsoluteNodePosition(toNode, nodeById, positionCache);
  const fromSize = architectureNodeSize(fromNode);
  const toSize = architectureNodeSize(toNode);
  const fromCenter = {
    x: fromPosition.x + fromSize.width / 2,
    y: fromPosition.y + fromSize.height / 2,
  };
  const toCenter = {
    x: toPosition.x + toSize.width / 2,
    y: toPosition.y + toSize.height / 2,
  };
  const dx = toCenter.x - fromCenter.x;
  const dy = toCenter.y - fromCenter.y;
  const orient = text(corridor.orient || corridor.orientation, "shortest-path").toLowerCase();
  const horizontal = orient === "horizontal" || orient === "right" || orient === "left"
    ? true
    : orient === "vertical" || orient === "down" || orient === "up"
      ? false
      : Math.abs(dx) >= Math.abs(dy);
  const compactWidth = horizontal ? 340 : 260;
  const compactHeight = horizontal ? 64 : 86;
  const offset = 42 + (index % 4) * 18;
  const midpoint = {
    x: (fromCenter.x + toCenter.x) / 2,
    y: (fromCenter.y + toCenter.y) / 2,
  };
  const position = horizontal
    ? { x: midpoint.x - compactWidth / 2, y: midpoint.y - compactHeight / 2 - offset }
    : { x: midpoint.x - compactWidth / 2 + offset, y: midpoint.y - compactHeight / 2 };
  const routeParticipants = routeIds.map((id) => ({
    id,
    title: architectureFlowNodeTitle(nodeById.get(id)),
  }));
  const steps = jsonArray(corridor.steps).map((step, stepIndex) => ({
    ...step,
    id: text(step?.id, `${corridor.id}-step-${stepIndex + 1}`),
    label: architectureApiCorridorStepLabel(step),
    sourceTitle: architectureFlowNodeTitle(nodeById.get(step?.source)) || text(step?.sourceName, "source"),
    targetTitle: architectureFlowNodeTitle(nodeById.get(step?.target)) || text(step?.targetName, "target"),
    tone: architectureApiCorridorRoleTone(step?.role || step?.kind),
  }));

  return {
    id: text(corridor.id, architectureEntityId("api-corridor")),
    type: "architectureCorridor",
    position: {
      x: Math.round(position.x),
      y: Math.round(position.y),
    },
    selectable: false,
    draggable: false,
    zIndex: 18 + index,
    style: {
      height: compactHeight,
      width: compactWidth,
    },
    data: {
      anchor: text(corridor.anchor),
      anchorName: text(corridor.anchorName),
      direction,
      from: fromId,
      fromTitle: architectureFlowNodeTitle(fromNode),
      lastVerified: text(corridor.lastVerified),
      orientation: horizontal ? "horizontal" : "vertical",
      orient: text(corridor.orient || corridor.orientation, "shortest-path"),
      routeParticipants,
      semanticProps: architectureCleanDslProps(corridor.semanticProps),
      source: text(corridor.source),
      status: text(corridor.status, "current"),
      steps,
      summary: architectureApiCorridorSummary(corridor),
      title: text(corridor.title, "API corridor"),
      to: toId,
      toTitle: architectureFlowNodeTitle(toNode),
    },
  };
}

function architectureGraphToFlow(graph) {
  const compiledGraph = architectureParseDslGraph(graph) || graph;
  const direction = text(compiledGraph?.layout?.direction, "LR").toUpperCase();
  const nodes = jsonArray(compiledGraph?.nodes).map((node, index) => (
    architectureFlowNodeFromGraphNode(node, index, direction)
  ));
  const edges = jsonArray(compiledGraph?.edges)
    .map(architectureFlowEdgeFromGraphEdge)
    .filter(Boolean);
  const corridorNodes = jsonArray(compiledGraph?.apiCorridors || compiledGraph?.api_corridors)
    .map((corridor, index) => architectureApiCorridorFlowNodeFromCorridor(corridor, index, nodes, edges, direction))
    .filter(Boolean);
  return { edges, nodes: [...nodes, ...corridorNodes] };
}

function architectureApiCorridorDslNodeName(id, fallback, dslNameById) {
  return architectureDslName(dslNameById.get(text(id)) || text(fallback, id));
}

function architectureApiCorridorFlowNodeToGraph(node) {
  const data = jsonObject(node?.data) || {};
  return {
    anchor: text(data.anchor),
    anchorName: text(data.anchorName),
    display: "overlay",
    from: text(data.from),
    fromName: text(data.fromTitle),
    id: text(node?.id),
    intent: ARCHITECTURE_API_CORRIDOR_INTENT,
    lastVerified: text(data.lastVerified),
    orient: text(data.orient, "shortest-path"),
    semanticProps: architectureCleanDslProps(data.semanticProps),
    source: text(data.source),
    status: text(data.status, "current"),
    steps: jsonArray(data.steps).map((step, index) => ({
      ...step,
      id: text(step?.id, `${node?.id || "api-corridor"}-step-${index + 1}`),
      step: text(step?.step, String(index + 1)),
    })),
    title: text(data.title, "API corridor"),
    to: text(data.to),
    toName: text(data.toTitle),
  };
}

function architectureApiCorridorDslLines(node, dslNameById) {
  const corridor = architectureApiCorridorFlowNodeToGraph(node);
  const props = architecturePropsWithOrderedOverrides(corridor.semanticProps, {
    intent: ARCHITECTURE_API_CORRIDOR_INTENT,
    display: "overlay",
    from: dslNameById.get(corridor.from) || corridor.fromName,
    to: dslNameById.get(corridor.to) || corridor.toName,
    ...(corridor.anchor ? { anchor: dslNameById.get(corridor.anchor) || corridor.anchorName || corridor.anchor } : corridor.anchorName ? { anchor: corridor.anchorName } : {}),
    orient: corridor.orient || "shortest-path",
    ...(corridor.status ? { status: corridor.status } : {}),
    ...(corridor.source ? { source: corridor.source } : {}),
    ...(corridor.lastVerified ? { lastVerified: corridor.lastVerified } : {}),
  });
  const lines = [
    `${architectureDslName(corridor.title)}${architectureDslPropsText(props)} {`,
  ];
  corridor.steps.forEach((step, index) => {
    const role = architectureEdgeRole(step?.role || step?.kind, "request");
    const source = architectureApiCorridorDslNodeName(step?.source, step?.sourceName || step?.sourceTitle, dslNameById);
    const target = architectureApiCorridorDslNodeName(step?.target, step?.targetName || step?.targetTitle, dslNameById);
    const stepProps = architecturePropsWithOrderedOverrides(step?.semanticProps, {
      step: text(step?.step, String(index + 1)),
      role,
      ...(step?.method ? { method: step.method } : {}),
      ...(step?.path ? { path: step.path } : {}),
      ...(step?.status ? { status: step.status } : {}),
      ...(step?.event ? { event: step.event } : {}),
      ...(step?.condition ? { condition: step.condition } : {}),
      ...(step?.branch ? { branch: step.branch } : {}),
      ...(step?.criticality ? { criticality: step.criticality } : {}),
    });
    const label = text(step?.label);
    const labelWithProps = `${label}${architectureDslPropsText(stepProps)}`.trim();
    lines.push(`  ${source} > ${target}${labelWithProps ? `: ${labelWithProps}` : ""}`);
  });
  lines.push("}");
  return lines;
}

function architectureFlowGraphToDsl(graph, nodes, edges) {
  const currentGraph = jsonObject(graph) || {};
  const graphTitle = text(currentGraph.title, "Architecture graph");
  const groupPath = architectureFolderPathParts(currentGraph.groupPath);
  const runTargets = architectureRunTargetsFromGraph(currentGraph);
  const corridorNodes = nodes.filter((node) => node.type === "architectureCorridor");
  const groupNodes = nodes.filter((node) => node.type === "architectureGroup");
  const regularNodes = nodes.filter((node) => node.type !== "architectureGroup" && node.type !== "architectureCorridor");
  const allNodes = [...groupNodes, ...regularNodes];
  const nodeById = new Map(allNodes.map((node) => [node.id, node]));
  const childrenByParent = new Map();
  allNodes.forEach((node) => {
    const parentId = text(node.parentId);
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(node);
  });
  const titleCounts = new Map();
  allNodes.forEach((node) => {
    const title = text(node.data?.title || node.id, node.id).toLowerCase();
    titleCounts.set(title, (titleCounts.get(title) || 0) + 1);
  });
  const dslNameById = new Map();
  const dslLabelById = new Map();
  allNodes.forEach((node) => {
    const title = text(node.data?.title || node.id, node.id);
    const duplicateTitle = (titleCounts.get(title.toLowerCase()) || 0) > 1;
    const parentTitle = text(nodeById.get(node.parentId)?.data?.title);
    const idSuffix = text(node.id).split("-").filter(Boolean).at(-1);
    const dslName = duplicateTitle
      ? [parentTitle, title, idSuffix].filter(Boolean).join(" / ")
      : title;
    dslNameById.set(node.id, dslName);
    if (dslName !== title) dslLabelById.set(node.id, title);
  });
  const lineForNode = (node, depth) => {
    const display = architectureNodeDisplayMode(node.data || {}, false);
    const compact = display === "compact";
    const role = architectureNodeRole(node.data?.role || node.data?.kind);
    const props = architecturePropsWithOrderedOverrides(node.data?.semanticProps, {
      icon: node.data?.icon || ARCHITECTURE_NODE_ROLE_ICONS[role] || node.data?.kind,
      ...(dslLabelById.has(node.id) ? { label: dslLabelById.get(node.id) } : {}),
      role,
      ...(compact ? { display: "compact" } : {}),
      ...(node.data?.lifecycle ? { lifecycle: node.data.lifecycle } : {}),
      ...(node.data?.source ? { source: node.data.source } : {}),
      ...(node.data?.status ? { status: node.data.status } : {}),
      ...(!compact ? { desc: node.data?.subtitle } : {}),
    });
    return `${"  ".repeat(depth)}${architectureDslName(dslNameById.get(node.id) || node.data?.title || node.id)}${architectureDslPropsText(props)}`;
  };
  const lines = [
    `title ${architectureDslString(graphTitle)}`,
    "direction right",
  ];
  if (groupPath.length) lines.push(`folder ${architectureDslString(groupPath.join(" / "))}`);
  runTargets.forEach((target, index) => {
    const line = architectureRunTargetDslLine(target, index);
    if (line) lines.push(line);
  });
  lines.push("");
  const emitGroup = (group, depth = 0) => {
    const intent = architectureGroupIntent(group.data?.intent);
    lines.push(`${"  ".repeat(depth)}${architectureDslName(dslNameById.get(group.id) || group.data?.title || group.id)}${architectureDslPropsText(architecturePropsWithOrderedOverrides(group.data?.semanticProps, {
      icon: group.data?.icon || ARCHITECTURE_GROUP_INTENT_ICONS[intent] || "box",
      color: group.data?.color || ARCHITECTURE_GROUP_INTENT_COLORS[intent],
      intent,
      ...(dslLabelById.has(group.id) ? { label: dslLabelById.get(group.id) } : {}),
      ...(group.data?.scope ? { scope: group.data.scope } : {}),
      ...(group.data?.owner ? { owner: group.data.owner } : {}),
      ...(group.data?.status ? { status: group.data.status } : {}),
      desc: group.data?.subtitle,
    }))} {`);
    const children = childrenByParent.get(group.id) || [];
    children.filter((child) => child.type === "architectureGroup").forEach((childGroup) => emitGroup(childGroup, depth + 1));
    children.filter((child) => child.type !== "architectureGroup").forEach((child) => lines.push(lineForNode(child, depth + 1)));
    lines.push(`${"  ".repeat(depth)}}`);
    lines.push("");
  };
  (childrenByParent.get("") || [])
    .filter((node) => node.type === "architectureGroup")
    .forEach((group) => emitGroup(group));
  (childrenByParent.get("") || [])
    .filter((node) => node.type !== "architectureGroup")
    .forEach((node) => lines.push(lineForNode(node, 0)));
  const structuralEdges = edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target));
  if (structuralEdges.length) lines.push("");
  structuralEdges.forEach((edge) => {
    const source = architectureDslName(dslNameById.get(edge.source) || edge.source);
    const target = architectureDslName(dslNameById.get(edge.target) || edge.target);
    const label = text(edge.data?.label);
    const role = architectureEdgeRole(edge.data?.role || edge.data?.kind);
    const props = architecturePropsWithOrderedOverrides(edge.data?.semanticProps, {
      role,
      ...(edge.data?.condition ? { condition: edge.data.condition } : {}),
      ...(edge.data?.event ? { event: edge.data.event } : {}),
      ...(edge.data?.criticality ? { criticality: edge.data.criticality } : {}),
    });
    const labelWithProps = `${label}${architectureDslPropsText(props)}`.trim();
    lines.push(`${source} ${architectureEdgeConnectorForRole(role, edge.data?.kind)} ${target}${labelWithProps ? `: ${labelWithProps}` : ""}`);
  });
  if (corridorNodes.length) lines.push("");
  corridorNodes.forEach((node, index) => {
    if (index) lines.push("");
    lines.push(...architectureApiCorridorDslLines(node, dslNameById));
  });
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim()}\n`;
}

function architectureGraphFromFlow(graph, nodes, edges) {
  const currentGraph = jsonObject(graph) || {};
  const source = architectureFlowGraphToDsl(currentGraph, nodes, edges);
  return {
    ...currentGraph,
    source,
    sourceFormat: "eraserDsl",
    runTargets: architectureRunTargetsFromGraph(currentGraph),
    apiCorridors: nodes
      .filter((node) => node.type === "architectureCorridor")
      .map(architectureApiCorridorFlowNodeToGraph),
    nodes: nodes.filter((node) => node.type !== "architectureCorridor").map((node) => {
      const isGroup = node.type === "architectureGroup";
      const display = architectureNodeDisplayMode(node.data || {}, isGroup);
      const compact = display === "compact";
      const intent = isGroup ? architectureGroupIntent(node.data?.intent) : "";
      const role = !isGroup ? architectureNodeRole(node.data?.role || node.data?.kind) : "";
      return {
        id: node.id,
        title: text(node.data?.title, isGroup ? "Group" : "Node"),
        subtitle: compact ? "" : text(node.data?.subtitle),
        icon: text(node.data?.icon),
        color: text(node.data?.color),
        kind: isGroup ? "group" : text(node.data?.kind, "service"),
        type: isGroup ? "group" : "node",
        semanticProps: architectureCleanDslProps(node.data?.semanticProps),
        ...(isGroup ? {
          intent,
          owner: text(node.data?.owner),
          scope: text(node.data?.scope),
          status: text(node.data?.status),
        } : {
          display,
          lifecycle: text(node.data?.lifecycle),
          role,
          source: text(node.data?.source),
          status: text(node.data?.status),
        }),
        position: {
          x: Math.round(numberValue(node.position?.x, 0)),
          y: Math.round(numberValue(node.position?.y, 0)),
        },
        ...(node.parentId ? { parentId: node.parentId } : {}),
        ...(isGroup || compact ? {
          height: Math.round(numberValue(
            node.style?.height,
            isGroup ? 220 : ARCHITECTURE_NODE_COMPACT_HEIGHT,
          )),
          width: Math.round(numberValue(
            node.style?.width,
            isGroup ? 360 : ARCHITECTURE_NODE_COMPACT_WIDTH,
          )),
        } : {}),
      };
    }),
    edges: edges.filter((edge) => (
      nodes.some((node) => node.type !== "architectureCorridor" && node.id === edge.source)
      && nodes.some((node) => node.type !== "architectureCorridor" && node.id === edge.target)
    )).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      condition: text(edge.data?.condition),
      criticality: text(edge.data?.criticality),
      event: text(edge.data?.event),
      label: text(edge.data?.label),
      kind: text(edge.data?.kind, "calls"),
      role: architectureEdgeRole(edge.data?.role || edge.data?.kind),
      semanticProps: architectureCleanDslProps(edge.data?.semanticProps),
    })),
    layout: {
      ...(jsonObject(graph?.layout) || {}),
      engine: "manual",
    },
  };
}

function architectureGroupDescendantIds(groupId, nodes) {
  const childrenByParent = new Map();
  jsonArray(nodes).forEach((node) => {
    const parentId = text(node.parentId);
    if (!parentId) return;
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(node);
  });
  const ids = new Set();
  const visit = (parentId) => {
    (childrenByParent.get(parentId) || []).forEach((child) => {
      if (ids.has(child.id)) return;
      ids.add(child.id);
      visit(child.id);
    });
  };
  visit(groupId);
  return ids;
}

function architectureValidateSemanticGraph(graph, nodes, edges) {
  const warnings = [];
  const nodeById = new Map(jsonArray(nodes).map((node) => [node.id, node]));
  const edgesBySource = new Map();
  jsonArray(edges).forEach((edge) => {
    if (!edgesBySource.has(edge.source)) edgesBySource.set(edge.source, []);
    edgesBySource.get(edge.source).push(edge);
  });
  const groups = jsonArray(nodes).filter((node) => node.type === "architectureGroup");
  groups.forEach((group) => {
    const intent = architectureGroupIntent(group.data?.intent);
    if (!["control-graph", "state-machine", "data-flow", "api-pathway", "dependency-graph"].includes(intent)) return;
    const descendantIds = architectureGroupDescendantIds(group.id, nodes);
    const groupNodes = [...descendantIds]
      .map((id) => nodeById.get(id))
      .filter((node) => node && node.type !== "architectureGroup");
    const groupEdges = jsonArray(edges).filter((edge) => descendantIds.has(edge.source) && descendantIds.has(edge.target));
    const title = text(group.data?.title, architectureGroupIntentLabel(intent));
    if (!groupNodes.length) {
      warnings.push(`${title}: add nodes for this ${architectureGroupIntentLabel(intent).toLowerCase()}.`);
      return;
    }
    if (intent === "control-graph" || intent === "state-machine") {
      const startNodes = groupNodes.filter((node) => text(node.data?.lifecycle) === "start" || text(node.data?.role) === "start");
      const terminalNodes = groupNodes.filter((node) => text(node.data?.lifecycle) === "terminal" || text(node.data?.role) === "terminal");
      if (!startNodes.length) warnings.push(`${title}: mark one state as lifecycle start.`);
      if (!terminalNodes.length) warnings.push(`${title}: mark at least one terminal state.`);
      const decisionNodes = groupNodes.filter((node) => architectureNodeRole(node.data?.role) === "decision");
      decisionNodes.forEach((decision) => {
        const outgoing = groupEdges.filter((edge) => edge.source === decision.id);
        const unlabeled = outgoing.filter((edge) => !text(edge.data?.label) && !text(edge.data?.condition));
        if (outgoing.length < 2) warnings.push(`${text(decision.data?.title, "Decision")}: decision should branch to at least two paths.`);
        if (unlabeled.length) warnings.push(`${text(decision.data?.title, "Decision")}: label or condition each decision edge.`);
      });
      if (startNodes.length) {
        const reachable = new Set(startNodes.map((node) => node.id));
        const queue = [...reachable];
        for (let cursor = 0; cursor < queue.length; cursor += 1) {
          (edgesBySource.get(queue[cursor]) || []).forEach((edge) => {
            if (!descendantIds.has(edge.target) || reachable.has(edge.target)) return;
            reachable.add(edge.target);
            queue.push(edge.target);
          });
        }
        const unreachable = groupNodes.filter((node) => !reachable.has(node.id));
        if (unreachable.length) warnings.push(`${title}: ${unreachable.length} state/control node${unreachable.length === 1 ? "" : "s"} unreachable from start.`);
      }
    }
    if (intent === "data-flow") {
      const hasDataEdge = groupEdges.some((edge) => ["reads", "writes", "publishes", "subscribes"].includes(architectureEdgeRole(edge.data?.role || edge.data?.kind)));
      if (!hasDataEdge) warnings.push(`${title}: use reads/writes/publishes/subscribes edges for the data path.`);
    }
    if (intent === "api-pathway") {
      const hasEndpoint = groupNodes.some((node) => ["api", "endpoint"].includes(architectureNodeRole(node.data?.role || node.data?.kind)));
      if (!hasEndpoint) warnings.push(`${title}: include an api or endpoint node.`);
    }
    if (intent === "dependency-graph") {
      const hasDepends = groupEdges.some((edge) => architectureEdgeRole(edge.data?.role || edge.data?.kind) === "depends-on");
      if (!hasDepends) warnings.push(`${title}: use depends-on edges to show dependency direction.`);
    }
  });
  jsonArray(nodes)
    .filter((node) => node.type === "architectureCorridor")
    .forEach((corridor) => {
      const title = text(corridor.data?.title, "API corridor");
      const steps = jsonArray(corridor.data?.steps);
      if (!steps.length) {
        warnings.push(`${title}: add ordered procedure steps.`);
        return;
      }
      if (steps.length > 12) {
        warnings.push(`${title}: consider phases or a control graph for long procedures.`);
      }
      if (!text(corridor.data?.from) || !text(corridor.data?.to)) {
        warnings.push(`${title}: set from and to to existing graph nodes or groups.`);
      }
      const unresolved = steps.filter((step) => !text(step.source) || !text(step.target));
      if (unresolved.length) {
        warnings.push(`${title}: ${unresolved.length} step${unresolved.length === 1 ? "" : "s"} reference missing graph participants.`);
      }
    });
  return warnings.slice(0, 8);
}

function architectureNormalizedIdentityText(value) {
  return text(value).replace(/\\/g, "/").replace(/\/+$/u, "").toLowerCase();
}

function architectureGraphIdentity(graph) {
  const graphId = text(graph?.id);
  const graphTitle = text(graph?.title, "Architecture graph");
  const graphFilePath = text(graph?.filePath || graph?.file_path);
  return {
    graphFilePath,
    graphId,
    graphKey: architectureNormalizedIdentityText(graphFilePath || graphId || graphTitle),
    graphTitle,
  };
}

function architectureAgentEditMarkersStorageKey(workspaceId, repoPath) {
  const safeWorkspaceId = architectureNormalizedIdentityText(workspaceId || "local");
  const safeRepoPath = architectureNormalizedIdentityText(repoPath);
  if (!safeWorkspaceId && !safeRepoPath) return "";
  return `${ARCHITECTURE_AGENT_EDIT_MARKERS_STORAGE_PREFIX}.${safeWorkspaceId || "local"}.${safeRepoPath || "repo"}`;
}

function architectureHashText(value) {
  const raw = text(value);
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = ((hash << 5) - hash + raw.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function architectureAgentLabel(value) {
  const raw = text(value);
  const normalized = raw.toLowerCase().replace(/[_\s]+/gu, "-");
  if (normalized.includes("claude")) return "Claude Code";
  if (normalized.includes("opencode")) return "OpenCode";
  if (normalized.includes("codex")) return "Codex";
  return raw || "Coding agent";
}

function architectureAgentColor(value, fallback = "") {
  const normalized = text(value).toLowerCase().replace(/[_\s]+/gu, "-");
  const directColor = ARCHITECTURE_AGENT_EDIT_AGENT_COLORS[normalized];
  if (directColor) return directColor;
  const matchedKey = Object.keys(ARCHITECTURE_AGENT_EDIT_AGENT_COLORS)
    .find((key) => normalized.includes(key));
  if (matchedKey) return ARCHITECTURE_AGENT_EDIT_AGENT_COLORS[matchedKey];
  const colors = ARCHITECTURE_AGENT_EDIT_FALLBACK_COLORS;
  return colors[architectureHashText(value || fallback) % colors.length];
}

function architectureNormalizeAgentEditMarker(marker) {
  if (!marker || typeof marker !== "object") return null;
  const identity = architectureGraphIdentity({
    filePath: marker.graphFilePath || marker.graph_file_path,
    id: marker.graphId || marker.graph_id,
    title: marker.graphTitle || marker.graph_title,
  });
  const commandId = text(marker.commandId || marker.command_id || marker.id);
  const createdAt = text(marker.createdAt || marker.created_at, new Date().toISOString());
  const status = text(marker.status || marker.state, "queued") === "editing" ? "editing" : "queued";
  if (!commandId || !identity.graphKey) return null;
  const agentId = text(marker.agentId || marker.agent_id || marker.codingAgent || marker.coding_agent);
  const agentLabel = architectureAgentLabel(marker.agentLabel || marker.agent_label || agentId);
  return {
    agentColor: text(marker.agentColor || marker.agent_color, architectureAgentColor(agentId || agentLabel, commandId)),
    agentId,
    agentLabel,
    commandId,
    createdAt,
    graphFilePath: identity.graphFilePath,
    graphId: identity.graphId,
    graphKey: identity.graphKey,
    graphTitle: identity.graphTitle,
    id: commandId,
    repoPath: text(marker.repoPath || marker.repo_path),
    status,
    taskId: text(marker.taskId || marker.task_id),
    updatedAt: text(marker.updatedAt || marker.updated_at, createdAt),
    workspaceId: text(marker.workspaceId || marker.workspace_id),
  };
}

function architectureReadStoredAgentEditMarkers(storageKey) {
  if (!storageKey || typeof window === "undefined" || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
    return jsonArray(parsed).map(architectureNormalizeAgentEditMarker).filter(Boolean);
  } catch {
    return [];
  }
}

function architectureWriteStoredAgentEditMarkers(storageKey, markers) {
  if (!storageKey || typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(jsonArray(markers).slice(-ARCHITECTURE_AGENT_EDIT_MARKER_MAX_ITEMS)),
    );
  } catch {
    // Visual edit markers are best effort; the queued task still exists independently.
  }
}

function architectureTodoCommandId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `architecture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function architectureAgentTaskText({
  commandId,
  graph,
  prompt,
  repoPath,
  runEnvironment = "",
  runMode = "",
  runTarget = null,
}) {
  const identity = architectureGraphIdentity(graph);
  const normalizedRunTarget = architectureNormalizeRunTarget(runTarget);
  const runLines = normalizedRunTarget ? [
    "",
    `Run target: ${normalizedRunTarget.label}`,
    `Run action: ${normalizedRunTarget.action}`,
    `Run environment: ${text(runEnvironment, normalizedRunTarget.defaultEnv)}`,
    `Run mode: ${text(runMode, normalizedRunTarget.defaultMode)}`,
    normalizedRunTarget.scope ? `Run scope: ${normalizedRunTarget.scope}` : "",
    "Run target instructions: the `run` line describes operational intent and guardrails, not shell commands. Read the selected architecture graph and repo evidence before acting. In plan mode, stay read-only and explain the intended operation. For apply, rollback, production, destructive, credential, migration, or externally mutating work, use normal Diff Forge coordination and approval gates before changing or running anything.",
  ] : [];
  return [
    `Architecture graph request: ${prompt}`,
    "",
    commandId ? `Command id: ${commandId}` : "",
    `Current graph: ${identity.graphTitle}`,
    identity.graphFilePath ? `Graph file: ${identity.graphFilePath}` : identity.graphId ? `Graph id: ${identity.graphId}` : "",
    repoPath ? `Repo: ${repoPath}` : "",
    "",
    "Update the selected .arch graph file for this graph. Keep each edit syntactically valid so the Architecture tab can hot-reload the graph as nodes, groups, and edges are added.",
    "Treat .arch as a general system graph: one graph may contain connected or disconnected groups for architecture, api-pathway, api-corridor, data-flow, control-graph, state-machine, dependency-graph, deployment, runtime, or subsystem slices.",
    "Use api-corridor overlay containers only for important ordered API procedures such as auth, checkout, webhooks, task dispatch, uploads, token refresh, or async job lifecycles. API corridors explain runtime order across existing nodes; they are not replacement topology and not line-by-line source narration.",
    "Write corridors as `OAuth Login [intent: api-corridor, display: overlay, from: Browser, to: API Server, anchor: Auth API, orient: shortest-path] { Browser > API Server: GET /auth/start [step: 1, role: request, method: GET, path: /auth/start] }`. Corridor message endpoints should reference existing graph nodes or groups.",
    "Use `run` lines only as graph-level launch metadata, for example `run \"Deploy\" [action: deploy, envs: \"local,staging,production\", modes: \"plan,apply,verify,rollback\", defaultEnv: staging, scope: \"Deployment\"]`. Do not treat run lines as executable scripts.",
    "Preserve semantic props when editing. Groups should use intent. Nodes should use role, lifecycle, source, and status when useful. Edges should use role plus condition, event, and criticality when useful.",
    "Use compact actor nodes for people, users, customers, admins, agents, bots, browsers, CLI clients, and similar graph entrypoints: write `User [icon: users, role: actor, display: compact]` or `AI Agent [icon: ai, role: actor, display: compact]` and omit `desc` for those compact nodes.",
    ...runLines,
  ].filter(Boolean).join("\n");
}

function architectureQueueAgentTodo({
  graph,
  prompt,
  repoPath,
  runEnvironment = "",
  runMode = "",
  runTarget = null,
  targetFields = {},
  workspaceId,
  workspaceName,
}) {
  const safeWorkspaceId = text(workspaceId);
  const safeTargetFields = jsonObject(targetFields) || {};
  const commandId = architectureTodoCommandId();
  const now = new Date().toISOString();
  const identity = architectureGraphIdentity(graph);
  const architectureGraph = {
    filePath: identity.graphFilePath,
    graphKey: identity.graphKey,
    id: identity.graphId,
    repoPath: text(repoPath),
    title: identity.graphTitle,
  };
  const architectureRun = architectureNormalizeRunTarget(runTarget);
  const selectedRun = architectureRun ? {
    environment: text(runEnvironment, architectureRun.defaultEnv),
    mode: text(runMode, architectureRun.defaultMode),
    target: architectureRun,
  } : null;
  const item = {
    architectureGraph,
    ...(selectedRun ? { architectureRun: selectedRun } : {}),
    createdAt: now,
    id: commandId,
    kind: "todo",
    ...safeTargetFields,
    remoteCommand: {
      ...(selectedRun ? { architectureRun: selectedRun } : {}),
      architectureGraph,
      commandId,
      graphFilePath: identity.graphFilePath,
      graphId: identity.graphId,
      graphTitle: identity.graphTitle,
      source: "architecture-tab",
      ...safeTargetFields,
    },
    source: ARCHITECTURE_TODO_QUEUE_SOURCE,
    text: architectureAgentTaskText({
      commandId,
      graph,
      prompt,
      repoPath,
      runEnvironment,
      runMode,
      runTarget: architectureRun,
    }),
    workspaceId: safeWorkspaceId,
  };
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(ARCHITECTURE_REMOTE_TODO_QUEUE_EVENT, {
      detail: {
        commandId,
        item,
        source: "architecture-tab",
        workspaceId: safeWorkspaceId,
        workspaceName: text(workspaceName),
      },
    }));
  }
  return item;
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
  if (["merged", "applied", "done", "completed", "complete", "success", "idle", "ready"].includes(status)) return "done";
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

function architectureTaskAgentId(task) {
  const terminalPlan = taskTerminalPlan(task);
  return text(
    taskAgentLabel(task)
      || terminalPlan?.agent_kind
      || terminalPlan?.agentKind
      || terminalPlan?.agent_id
      || terminalPlan?.agentId,
  );
}

function architectureAgentEditMarkerFromQueueItem(item) {
  const remoteCommand = jsonObject(item?.remoteCommand || item?.remote_command) || {};
  const graphMetadata = jsonObject(
    item?.architectureGraph
      || item?.architecture_graph
      || remoteCommand?.architectureGraph
      || remoteCommand?.architecture_graph,
  ) || {};
  const identity = architectureGraphIdentity({
    filePath: graphMetadata.filePath
      || graphMetadata.file_path
      || remoteCommand.graphFilePath
      || remoteCommand.graph_file_path,
    id: graphMetadata.id || graphMetadata.graphId || graphMetadata.graph_id || remoteCommand.graphId || remoteCommand.graph_id,
    title: graphMetadata.title || graphMetadata.graphTitle || graphMetadata.graph_title || remoteCommand.graphTitle || remoteCommand.graph_title,
  });
  const commandId = text(remoteCommand.commandId || remoteCommand.command_id || item?.id);
  if (!commandId || !identity.graphKey) return null;
  const agentId = text(
    item?.targetAgentId
      || item?.target_agent_id
      || remoteCommand.targetAgentId
      || remoteCommand.target_agent_id,
  );
  return architectureNormalizeAgentEditMarker({
    agentId,
    agentLabel: item?.targetAgentLabel || item?.target_agent_label || architectureAgentLabel(agentId),
    commandId,
    createdAt: item?.createdAt || item?.created_at,
    graphFilePath: identity.graphFilePath,
    graphId: identity.graphId,
    graphTitle: identity.graphTitle,
    repoPath: graphMetadata.repoPath || graphMetadata.repo_path,
    status: "queued",
    updatedAt: item?.updatedAt || item?.updated_at || item?.createdAt || item?.created_at,
    workspaceId: item?.workspaceId || item?.workspace_id,
  });
}

function architectureAgentEditMarkersEqual(left, right) {
  return JSON.stringify(jsonArray(left)) === JSON.stringify(jsonArray(right));
}

function architectureGraphMatchesAgentEditMarker(graph, marker) {
  const identity = architectureGraphIdentity(graph);
  const normalizedMarker = architectureNormalizeAgentEditMarker(marker);
  if (!identity.graphKey || !normalizedMarker) return false;
  if (identity.graphKey === normalizedMarker.graphKey) return true;
  if (identity.graphId && normalizedMarker.graphId && identity.graphId === normalizedMarker.graphId) return true;
  if (
    identity.graphFilePath
    && normalizedMarker.graphFilePath
    && architectureNormalizedIdentityText(identity.graphFilePath)
      === architectureNormalizedIdentityText(normalizedMarker.graphFilePath)
  ) {
    return true;
  }
  return Boolean(
    identity.graphTitle
      && normalizedMarker.graphTitle
      && architectureNormalizedIdentityText(identity.graphTitle)
        === architectureNormalizedIdentityText(normalizedMarker.graphTitle),
  );
}

function architectureAgentEditMarkersGraphMatch(left, right) {
  const normalizedLeft = architectureNormalizeAgentEditMarker(left);
  const normalizedRight = architectureNormalizeAgentEditMarker(right);
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft.graphKey && normalizedRight.graphKey && normalizedLeft.graphKey === normalizedRight.graphKey) return true;
  if (normalizedLeft.graphId && normalizedRight.graphId && normalizedLeft.graphId === normalizedRight.graphId) return true;
  if (
    normalizedLeft.graphFilePath
    && normalizedRight.graphFilePath
    && architectureNormalizedIdentityText(normalizedLeft.graphFilePath)
      === architectureNormalizedIdentityText(normalizedRight.graphFilePath)
  ) {
    return true;
  }
  return false;
}

function architectureTaskSearchText(task) {
  const metadata = jsonObject(task?.metadata_json || task?.metadata);
  const terminalPlan = taskTerminalPlan(task);
  const parts = [
    taskPlanTaskId(task),
    taskDisplayTitle(task),
    taskBody(task),
    taskStatus(task),
    architectureTaskAgentId(task),
    task?.id,
    task?.taskId,
    task?.task_id,
    task?.remote_command_id,
    task?.remoteCommandId,
    terminalPlan?.title,
    terminalPlan?.description,
    ...taskInputBlocks(task).map((block) => block.content),
  ];
  try {
    if (metadata) parts.push(JSON.stringify(metadata));
    if (terminalPlan) parts.push(JSON.stringify(terminalPlan));
  } catch {
    // Some task payloads may contain unserializable values; field-level matching above is enough.
  }
  return parts.map((part) => text(part)).filter(Boolean).join("\n").toLowerCase();
}

function architectureTaskMatchesAgentEditMarker(task, marker) {
  const normalizedMarker = architectureNormalizeAgentEditMarker(marker);
  if (!task || !normalizedMarker) return false;
  const haystack = architectureTaskSearchText(task);
  const normalizedHaystack = architectureNormalizedIdentityText(haystack);
  const commandId = text(normalizedMarker.commandId).toLowerCase();
  if (commandId && haystack.includes(commandId)) return true;
  const graphFilePath = architectureNormalizedIdentityText(normalizedMarker.graphFilePath);
  if (graphFilePath && normalizedHaystack.includes(graphFilePath)) return true;
  const graphId = text(normalizedMarker.graphId).toLowerCase();
  if (graphId && haystack.includes(graphId)) return true;
  const graphTitle = text(normalizedMarker.graphTitle).toLowerCase();
  return Boolean(
    graphTitle.length >= 8
      && haystack.includes(graphTitle)
      && (haystack.includes("architecture graph") || haystack.includes(".arch")),
  );
}

function architectureFindAgentEditTask(marker, tasks) {
  const commandId = text(marker?.commandId).toLowerCase();
  return jsonArray(tasks)
    .map((task, index) => {
      if (!architectureTaskMatchesAgentEditMarker(task, marker)) return null;
      const haystack = architectureTaskSearchText(task);
      return {
        commandMatch: commandId && haystack.includes(commandId) ? 1 : 0,
        index,
        task,
        updatedMs: taskUpdatedMs(task),
      };
    })
    .filter(Boolean)
    .sort((left, right) => (
      right.commandMatch - left.commandMatch
        || right.updatedMs - left.updatedMs
        || right.index - left.index
    ))[0]?.task || null;
}

function architectureGraphUpdatedAfterAgentEditMarker(graph, marker) {
  const graphUpdatedMs = parseTimeMs(graph?.updatedAt || graph?.updated_at);
  const markerCreatedMs = parseTimeMs(marker?.createdAt || marker?.created_at);
  return Boolean(graphUpdatedMs && markerCreatedMs && graphUpdatedMs > markerCreatedMs + 500);
}

function architectureDeriveAgentEditMarker(marker, tasks, graphs) {
  const normalizedMarker = architectureNormalizeAgentEditMarker(marker);
  if (!normalizedMarker) return null;
  const createdMs = parseTimeMs(normalizedMarker.createdAt);
  if (createdMs && Date.now() - createdMs > ARCHITECTURE_AGENT_EDIT_MARKER_MAX_AGE_MS) {
    return null;
  }
  const task = architectureFindAgentEditTask(normalizedMarker, tasks);
  if (task) {
    const statusKind = taskStatusKind(task);
    if (ARCHITECTURE_AGENT_EDIT_DONE_STATUSES.has(statusKind)) return null;
    const agentId = architectureTaskAgentId(task) || normalizedMarker.agentId;
    const agentLabel = architectureAgentLabel(agentId || normalizedMarker.agentLabel);
    return {
      ...normalizedMarker,
      agentColor: architectureAgentColor(agentId || agentLabel, normalizedMarker.commandId),
      agentId,
      agentLabel,
      status: statusKind === "queued" ? "queued" : "editing",
      taskId: taskPlanTaskId(task, normalizedMarker.taskId),
      updatedAt: taskUpdatedMs(task) ? new Date(taskUpdatedMs(task)).toISOString() : normalizedMarker.updatedAt,
    };
  }
  const graph = jsonArray(graphs).find((candidate) => architectureGraphMatchesAgentEditMarker(candidate, normalizedMarker));
  if (graph && architectureGraphUpdatedAfterAgentEditMarker(graph, normalizedMarker)) {
    return {
      ...normalizedMarker,
      status: "editing",
      updatedAt: text(graph.updatedAt || graph.updated_at, normalizedMarker.updatedAt),
    };
  }
  return normalizedMarker;
}

function architectureVisibleAgentEditMarkers(markers, tasks, graphs) {
  const nextMarkers = [];
  jsonArray(markers).forEach((marker) => {
    const nextMarker = architectureDeriveAgentEditMarker(marker, tasks, graphs);
    if (!nextMarker) return;
    const existingIndex = nextMarkers.findIndex((candidate) => candidate.commandId === nextMarker.commandId);
    if (existingIndex >= 0) {
      nextMarkers[existingIndex] = nextMarker;
      return;
    }
    nextMarkers.push(nextMarker);
  });
  return nextMarkers
    .sort((left, right) => parseTimeMs(left.createdAt) - parseTimeMs(right.createdAt))
    .slice(-ARCHITECTURE_AGENT_EDIT_MARKER_MAX_ITEMS);
}

function architectureAgentEditMarkerForGraph(graph, markers) {
  return jsonArray(markers)
    .filter((marker) => architectureGraphMatchesAgentEditMarker(graph, marker))
    .sort((left, right) => (
      parseTimeMs(right.updatedAt || right.createdAt) - parseTimeMs(left.updatedAt || left.createdAt)
    ))[0] || null;
}

function architectureAgentEditMarkerBlurb(marker) {
  const normalizedMarker = architectureNormalizeAgentEditMarker(marker);
  if (!normalizedMarker) return "";
  const action = normalizedMarker.status === "editing" ? "editing" : "queued edit";
  return `${normalizedMarker.agentLabel} ${action}`;
}

function architectureAgentEditMarkerTitle(marker) {
  const normalizedMarker = architectureNormalizeAgentEditMarker(marker);
  if (!normalizedMarker) return "";
  return `${architectureAgentEditMarkerBlurb(normalizedMarker)} for ${normalizedMarker.graphTitle}`;
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

function todoInputBlocks(todo, relatedTasks = []) {
  const item = jsonObject(todo) || {};
  const note = jsonObject(item.note) || {};
  const metadata = jsonObject(item.metadata_json || item.metadata) || {};
  const blocks = [];

  addUniqueInputBlock(blocks, "Todo", item.text);
  addUniqueInputBlock(blocks, "Todo", item.body);
  addUniqueInputBlock(blocks, "Todo", item.todo_text);
  addUniqueInputBlock(blocks, "Todo", item.todoText);
  addUniqueInputBlock(blocks, "Todo", item.todo);
  addUniqueInputBlock(blocks, "Todo", item.task);
  addUniqueInputBlock(blocks, "Input", item.input);
  addUniqueInputBlock(blocks, "Input", item.user_input);
  addUniqueInputBlock(blocks, "Input", item.userInput);
  addUniqueInputBlock(blocks, "Prompt", item.prompt);
  addUniqueInputBlock(blocks, "Command", item.command);
  addUniqueInputBlock(blocks, "Command", item.command_text);
  addUniqueInputBlock(blocks, "Command", item.commandText);
  addUniqueInputBlock(blocks, "Detail", item.detail);
  addUniqueInputBlock(blocks, "Detail", item.details);
  addUniqueInputBlock(blocks, "Detail", item.description);
  addUniqueInputBlock(blocks, "Note", note.text);
  addUniqueInputBlock(blocks, "Note", note.body);
  addUniqueInputBlock(blocks, "Input", metadata.input);
  addUniqueInputBlock(blocks, "Input", metadata.user_input);
  addUniqueInputBlock(blocks, "Input", metadata.userInput);
  addUniqueInputBlock(blocks, "Prompt", metadata.prompt);
  addUniqueInputBlock(blocks, "Command", metadata.command);
  addUniqueInputBlock(blocks, "Detail", metadata.detail);
  addUniqueInputBlock(blocks, "Detail", metadata.details);
  addUniqueInputBlock(blocks, "Detail", metadata.description);

  relatedTasks.forEach((task) => {
    taskInputBlocks(task).forEach((block) => {
      addUniqueInputBlock(blocks, `Task ${block.label}`, block.content);
    });
  });

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

function scannedResultParentPath(relativePath) {
  const parts = text(relativePath).split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function scannedResultPathJoin(rootDirectory, relativePath) {
  const root = text(rootDirectory).replace(/[\\/]+$/g, "");
  const relative = text(relativePath).replace(/^[\\/]+|[\\/]+$/g, "");
  if (!root || !relative) return root || relative;
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${separator}${relative.replace(/[\\/]+/g, separator)}`;
}

function scannedResultEntryPath(entry) {
  return text(entry?.projectRoot || entry?.project_root || entry?.path || entry?.repoPath || entry?.repo_path);
}

function scannedResultEntryName(entry, fallback = "Project") {
  const entryPath = scannedResultEntryPath(entry);
  return text(entry?.projectName || entry?.project_name || entry?.name, pathName(entryPath, fallback));
}

function scannedResultRelativePath(entry, rootDirectory) {
  const explicit = text(entry?.workspaceRelativePath || entry?.workspace_relative_path || entry?.relativePath || entry?.relative_path);
  if (explicit === ".") return "";
  if (explicit) return explicit.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

  const root = text(rootDirectory).replace(/\\/g, "/").replace(/\/+$/g, "");
  const entryPath = scannedResultEntryPath(entry).replace(/\\/g, "/").replace(/\/+$/g, "");
  if (!root || !entryPath) return "";
  if (entryPath.toLowerCase() === root.toLowerCase()) return "";
  if (entryPath.toLowerCase().startsWith(`${root.toLowerCase()}/`)) {
    return entryPath.slice(root.length + 1);
  }
  return "";
}

function scannedResultEntryHasGit(entry) {
  return entry?.hasGit === true || entry?.has_git === true;
}

function scannedResultEntryMountKind(entry) {
  return text(entry?.mountKind || entry?.mount_kind);
}

function scannedResultGraphKind(entry) {
  if (
    scannedResultEntryMountKind(entry) === "container"
    || text(entry?.projectKind || entry?.project_kind) === "container"
  ) {
    return "container";
  }
  return scannedResultEntryHasGit(entry) ? "git" : "project";
}

function scannedResultEntryKindLabel(entry) {
  const graphKind = scannedResultGraphKind(entry);
  if (graphKind === "git") return "git repo";
  if (graphKind === "container") return "folder";
  return "project folder";
}

function scannedResultGraphBadge(entry) {
  return scannedResultEntryKindLabel(entry);
}

function buildScannedResultGraph(scan) {
  const object = jsonObject(scan);
  if (!object) {
    return {
      edges: [],
      nodes: [],
      stats: {
        graphCount: 0,
        gitCount: 0,
        repoCount: 0,
        rootLabel: "No scan data",
        sourceLabel: "Waiting",
      },
    };
  }

  const nodeMap = new Map();
  const edgeMap = new Map();
  const rootId = "root";
  const rootDirectory = text(object.rootDirectory || object.root_directory || object.repoPath || object.repo_path);
  const rootName = pathName(rootDirectory, "workspace");
  const cacheSource = text(object.cache?.source || object.cacheSource || object.cache_source);
  const cacheStatus = text(object.cache?.status || object.cacheStatus || object.cache_status);
  const sourceLabel = cacheSource === "backend_workspace_topology_cache"
    ? `backend cache${cacheStatus ? `: ${cacheStatus.replaceAll("_", " ")}` : ""}`
    : "architecture scan";

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
    meta: rootDirectory,
    path: rootDirectory,
    relativePath: "",
    badge: "architecture root",
    depth: 0,
  });

  const repositories = jsonArray(object.repositories);
  const repoByPath = new Map(repositories.map((repo) => [scannedResultEntryPath(repo), repo]));
  const workspaceMounts = jsonArray(object.workspaceMounts || object.workspace_mounts);
  const mounts = workspaceMounts.length ? workspaceMounts : jsonArray(object.mounts);
  const hasExplicitWorkspaceMounts = workspaceMounts.length > 0;
  const scanEntries = mounts.length
    ? mounts.map((mount) => ({
      ...mount,
      graphCount: numberValue(repoByPath.get(scannedResultEntryPath(mount))?.graphCount, 0),
    }))
    : repositories;
  const entryNodeIdsByMountId = new Map();
  scanEntries.forEach((entry, index) => {
    const relativePath = scannedResultRelativePath(entry, rootDirectory);
    if (!relativePath) return;
    const entryId = text(entry?.mountId || entry?.mount_id || entry?.id, scannedResultEntryPath(entry) || `scan-entry-${index}`);
    entryNodeIdsByMountId.set(entryId, `${scannedResultGraphKind(entry)}:${entryId}`);
  });
  let gitCount = 0;
  let totalGraphCount = 0;

  scanEntries.forEach((entry, index) => {
    const entryPath = scannedResultEntryPath(entry);
    const relativePath = scannedResultRelativePath(entry, rootDirectory);
    const parts = relativePath.split("/").filter(Boolean);
    const entryId = text(entry?.mountId || entry?.mount_id || entry?.id, entryPath || `scan-entry-${index}`);
    const entryName = scannedResultEntryName(entry, "Project");
    const entryKind = scannedResultGraphKind(entry);
    const graphCount = numberValue(entry?.graphCount ?? entry?.graph_count, 0);
    if (entryKind === "git") gitCount += 1;
    totalGraphCount += graphCount;

    if (!parts.length) {
      addNode({
        id: rootId,
        kind: entryKind === "git" ? "rootGit" : "root",
        label: entryName || rootName,
        meta: entryPath || rootDirectory,
        path: entryPath || rootDirectory,
        relativePath: "",
        badge: scannedResultGraphBadge(entry),
        depth: 0,
      });
      return;
    }

    const repoNodeId = `${entryKind}:${entryId}`;
    if (hasExplicitWorkspaceMounts) {
      const parentMountId = text(entry?.parentMountId || entry?.parent_mount_id);
      const parentNodeId = parentMountId ? entryNodeIdsByMountId.get(parentMountId) : rootId;
      addNode({
        id: repoNodeId,
        kind: entryKind,
        label: entryName,
        meta: relativePath,
        path: entryPath,
        relativePath,
        badge: scannedResultGraphBadge(entry),
        depth: parts.length,
        entry,
      });
      addEdge(parentNodeId || rootId, repoNodeId);
      return;
    }

    let parentId = rootId;
    parts.slice(0, -1).forEach((part, partIndex) => {
      const folderPath = parts.slice(0, partIndex + 1).join("/");
      const folderId = `folder:${folderPath}`;
      addNode({
        id: folderId,
        kind: "container",
        label: part,
        meta: folderPath,
        path: scannedResultPathJoin(rootDirectory, folderPath),
        relativePath: folderPath,
        badge: "folder",
        depth: partIndex + 1,
      });
      addEdge(parentId, folderId);
      parentId = folderId;
    });

    const parentRelativePath = scannedResultParentPath(relativePath);
    const fallbackParentId = parentRelativePath ? `folder:${parentRelativePath}` : rootId;
    addNode({
      id: repoNodeId,
      kind: entryKind,
      label: entryName,
      meta: relativePath,
      path: entryPath,
      relativePath,
      badge: scannedResultGraphBadge(entry),
      depth: parts.length,
      entry,
    });
    addEdge(parentId || fallbackParentId, repoNodeId);
  });

  const nodes = Array.from(nodeMap.values());
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = Array.from(edgeMap.values()).filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
  const folderCount = nodes.filter((node) => (
    node.kind === "root"
      || node.kind === "container"
      || node.kind === "folder"
  )).length;

  return {
    edges,
    nodes,
    stats: {
      folderCount,
      graphCount: totalGraphCount,
      gitCount,
      repoCount: scanEntries.length,
      rootLabel: rootDirectory || rootName,
      sourceLabel,
    },
  };
}

function layoutScannedResultGraph(graph) {
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
  architectureRepositoryScanError = "",
  architectureRepositoryScanSnapshot = null,
  architectureRepositoryScanState = "idle",
  architectureGraphLists = {},
  architectureSelectedGraphId = "",
  architectureSelectedRepoPath = "",
  architectureSnapshot = null,
  architectureState = "idle",
  connectedDevices = [],
  knownDevices = [],
  onArchitectureGraphListRefresh = null,
  onArchitectureSelectionChange = null,
  onGoToSessionTerminal = null,
  onOpenSessionTerminal = null,
  workspace,
  workspaceTerminalOptions = [],
}) {
  const activeWorkspaceId = workspace?.id || "";
  const activeWorkspaceName = workspace?.name || "";
  const repoPath = activeWorkspaceId ? rootDirectory || defaultWorkingDirectory || "" : "";
  const sessionHistoryStoreRoot = repoPath || rootDirectory || defaultWorkingDirectory || "";
  const sessionHistoryCacheKeyValue = sessionHistoryCacheKey(activeWorkspaceId, sessionHistoryStoreRoot);
  const sessionHistoryInitialCache = readSessionHistoryCache(sessionHistoryCacheKeyValue);
  const hasSessionHistoryInitialCache = Boolean(sessionHistoryInitialCache);
  const [viewMode, setViewMode] = useState("sessionHistory");
  const [localArchitectureSnapshot, setLocalArchitectureSnapshot] = useState(architectureSnapshot);
	  const [finishPlanState, setFinishPlanState] = useState({ error: "", planRef: "" });
	  const [finishedPlanRefs, setFinishedPlanRefs] = useState(() => new Set());
  const activeArchitectureSnapshot = localArchitectureSnapshot || architectureSnapshot;
  const todoDeviceDirectory = useMemo(
    () => buildTodoDeviceDirectory(knownDevices, connectedDevices),
    [connectedDevices, knownDevices],
  );
  const taskHistory = useMemo(() => taskHistoryFromSnapshot(activeArchitectureSnapshot), [activeArchitectureSnapshot]);
  const tasks = useMemo(() => jsonArray(taskHistory.tasks), [taskHistory]);
  const visibleTasks = useMemo(() => {
	    if (!finishedPlanRefs.size) return tasks;
	    return tasks.map((task, index) => {
	      const planRef = terminalPlanIdentity(taskTerminalPlan(task), `task-${index}`);
	      return finishedPlanRefs.has(planRef) ? taskWithCompletedTerminalPlan(task) : task;
	    });
	  }, [finishedPlanRefs, tasks]);
  // Todos History reads ONE Rust door: todo_store_history returns the local
  // Rust queue ledger (listed/queued/running AND retained finished rows),
  // deduped per logical todo and tombstone-gated.
  const [localTodoItems, setLocalTodoItems] = useState([]);
  useEffect(() => {
    const workspaceId = text(activeWorkspaceId);
    if (!workspaceId) {
      setLocalTodoItems([]);
      return undefined;
    }
    let cancelled = false;
    const unlisteners = [];
    const refreshLocalTodos = () => {
      invoke("todo_store_history", { workspaceId })
        .then((result) => {
          if (cancelled) return;
          setLocalTodoItems(jsonArray(result?.items));
        })
        .catch(() => {
          // Never render an empty history because one command failed: the raw
          // queue ledger still has this device's todos.
          invoke("todo_dispatch_queue_get", { workspaceId })
            .then((result) => {
              if (cancelled) return;
              setLocalTodoItems(jsonArray(result?.items));
            })
            .catch(() => {});
        });
    };
    refreshLocalTodos();
    // Store mutations (creates, deletes, cancels, sweeps, direct captures) are
    // the only todo refresh signal. Rust emits this event for every mutation.
    listen("todo-store-changed", (event) => {
      if (cancelled) return;
      const eventWorkspaceId = String(event?.payload?.workspaceId || "").trim();
      if (!eventWorkspaceId || eventWorkspaceId === workspaceId) {
        refreshLocalTodos();
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    }).catch(() => {});
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [activeWorkspaceId]);
  const todoHistoryItems = useMemo(
    () => architectureTodoHistoryItemsFromWorkspaceTodos(null, activeWorkspaceId, visibleTasks, localTodoItems),
    [activeWorkspaceId, localTodoItems, visibleTasks],
  );
  const [sessionHistoryItems, setSessionHistoryItems] = useState(() => jsonArray(sessionHistoryInitialCache?.items));
  const [sessionHistoryState, setSessionHistoryState] = useState(() => (
    hasSessionHistoryInitialCache ? "ready" : "idle"
  ));
  const [sessionHistoryError, setSessionHistoryError] = useState("");
  const sessionHistoryItemsRef = useRef(sessionHistoryItems);
  const sessionHistoryRefreshSeqRef = useRef(0);
  const sessionHistorySyncRefreshTimerRef = useRef(0);
  useEffect(() => {
    sessionHistoryItemsRef.current = sessionHistoryItems;
  }, [sessionHistoryItems]);
  useEffect(() => {
    const workspaceId = text(activeWorkspaceId);
    const cacheKey = sessionHistoryCacheKeyValue;
    if (!workspaceId) {
      sessionHistoryRefreshSeqRef.current += 1;
      if (sessionHistorySyncRefreshTimerRef.current) {
        window.clearTimeout(sessionHistorySyncRefreshTimerRef.current);
        sessionHistorySyncRefreshTimerRef.current = 0;
      }
      sessionHistoryItemsRef.current = [];
      setSessionHistoryItems([]);
      setSessionHistoryState("idle");
      setSessionHistoryError("");
      return undefined;
    }
    let cancelled = false;
    const unlisteners = [];
    const cached = readSessionHistoryCache(cacheKey);
    if (cached) {
      const cachedItems = jsonArray(cached.items);
      sessionHistoryItemsRef.current = cachedItems;
      setSessionHistoryItems(cachedItems);
      setSessionHistoryState("ready");
      setSessionHistoryError("");
    } else {
      sessionHistoryItemsRef.current = [];
      setSessionHistoryItems([]);
    }
    const refreshSessionHistory = ({ fast = true } = {}) => {
      const refreshSeq = sessionHistoryRefreshSeqRef.current + 1;
      sessionHistoryRefreshSeqRef.current = refreshSeq;
      setSessionHistoryState((state) => (
        state === "ready" || state === "refreshing" || sessionHistoryItemsRef.current.length
          ? "refreshing"
          : "loading"
      ));
      invoke("workspace_agent_session_history_list", {
        request: {
          fast,
          limit: 500,
          rootDirectory: sessionHistoryStoreRoot || null,
          workspaceId,
        },
      })
        .then((result) => {
          if (cancelled || refreshSeq !== sessionHistoryRefreshSeqRef.current) return;
          const nextItems = jsonArray(result?.items);
          sessionHistoryItemsRef.current = nextItems;
          writeSessionHistoryCache(cacheKey, nextItems);
          setSessionHistoryItems(nextItems);
          setSessionHistoryError("");
          setSessionHistoryState("ready");
          if (fast) {
            scheduleSessionHistoryRefresh(SESSION_HISTORY_ENRICH_REFRESH_DELAY_MS, { fast: false });
          }
        })
        .catch((error) => {
          if (cancelled || refreshSeq !== sessionHistoryRefreshSeqRef.current) return;
          setSessionHistoryError(String(error?.message || error || "Unable to load session history."));
          setSessionHistoryState(sessionHistoryItemsRef.current.length ? "ready" : "error");
        });
    };
    const scheduleSessionHistoryRefresh = (delayMs = 0, options = {}) => {
      if (sessionHistorySyncRefreshTimerRef.current) {
        window.clearTimeout(sessionHistorySyncRefreshTimerRef.current);
        sessionHistorySyncRefreshTimerRef.current = 0;
      }
      if (delayMs > 0) {
        sessionHistorySyncRefreshTimerRef.current = window.setTimeout(() => {
          sessionHistorySyncRefreshTimerRef.current = 0;
          refreshSessionHistory(options);
        }, delayMs);
        return;
      }
      refreshSessionHistory(options);
    };
    refreshSessionHistory({ fast: true });
    listen("workspace-agent-session-history-changed", (event) => {
      if (cancelled) return;
      const eventWorkspaceId = String(event?.payload?.workspaceId || "").trim();
      if (!eventWorkspaceId || eventWorkspaceId === workspaceId) {
        scheduleSessionHistoryRefresh(0, { fast: true });
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    }).catch(() => {});
    listen("agent-chat-session-sync-status-changed", (event) => {
      if (cancelled) return;
      const eventWorkspaceId = String(event?.payload?.workspaceId || "").trim();
      if (!eventWorkspaceId || eventWorkspaceId === workspaceId) {
        scheduleSessionHistoryRefresh(SESSION_HISTORY_SYNC_REFRESH_DELAY_MS, { fast: false });
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlisteners.push(unlisten);
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (sessionHistorySyncRefreshTimerRef.current) {
        window.clearTimeout(sessionHistorySyncRefreshTimerRef.current);
        sessionHistorySyncRefreshTimerRef.current = 0;
      }
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [activeWorkspaceId, sessionHistoryCacheKeyValue, sessionHistoryStoreRoot]);
  const repoLabel = pathName(sessionHistoryStoreRoot, "repo");
  const visibleArchitectureError = architectureCloudMcpNoiseError(architectureError) ? "" : architectureError;

  useEffect(() => {
    setLocalArchitectureSnapshot(architectureSnapshot);
  }, [architectureSnapshot]);

	  useEffect(() => {
	    setFinishedPlanRefs(new Set());
	    setFinishPlanState({ error: "", planRef: "" });
	  }, [repoPath, activeWorkspaceId]);

	  const finishTerminalTodoPlan = useCallback((entry) => {
	    const task = entry?.task || null;
	    const terminalPlan = jsonObject(entry?.plan) || taskTerminalPlan(task);
	    const planRef = terminalPlanIdentity(terminalPlan);
	    if (!planRef || !repoPath) return;

	    setFinishPlanState({ error: "", planRef });
	    invoke("coordination_terminal_todo_plan_finish", {
	      repoPath,
	      input: {
	        agent_id: terminalPlan?.agent_id || terminalPlan?.agentId || task?.agent_id || task?.agentId || taskAgentLabel(task),
	        direct_repo_target: true,
	        plan_id: text(terminalPlan?.plan_id || terminalPlan?.planId || terminalPlan?.id) || planRef,
	        session_id: terminalPlan?.session_id || terminalPlan?.sessionId || task?.session_id || task?.sessionId,
	        todo_id: text(terminalPlan?.todo_id || terminalPlan?.todoId),
	        workspace_id: activeWorkspaceId,
	      },
	    })
      .then((response) => {
        if (response?.data?.plan_finished === false) {
          throw new Error("No terminal todo plan was found to finish.");
        }
	        setFinishedPlanRefs((current) => {
	          const next = new Set(current);
	          next.add(planRef);
	          return next;
	        });
		        setFinishPlanState((current) => (
		          current.planRef === planRef ? { error: "", planRef: "" } : current
		        ));
	      })
	      .catch((error) => {
		        setFinishPlanState({
	          error: error?.message || String(error || "Unable to finish terminal todo plan."),
	          planRef: "",
		        });
	      });
  }, [repoPath, activeWorkspaceId]);

  return (
    <ArchitectureSurface aria-label={`${workspace?.name || "Workspace"} Architecture`} data-state={architectureState}>
      <ArchitectureToolbar>
        <ViewToggleGroup aria-label="Architecture view mode">
          <ViewToggleButton
            data-active={viewMode === "sessionHistory" ? "true" : "false"}
            onClick={() => setViewMode("sessionHistory")}
            type="button"
          >
            Session History
          </ViewToggleButton>
          <ViewToggleButton
            data-active={viewMode === "todoHistory" ? "true" : "false"}
            onClick={() => setViewMode("todoHistory")}
            type="button"
          >
            Todo History
          </ViewToggleButton>
          <ViewToggleButton
            data-active={viewMode === "scannedResult" ? "true" : "false"}
            onClick={() => setViewMode("scannedResult")}
            type="button"
          >
            Scan Result
          </ViewToggleButton>
        </ViewToggleGroup>
      </ArchitectureToolbar>

      {viewMode === "scannedResult" ? (
        <ScannedResultPanel
          error={architectureRepositoryScanError}
          scan={architectureRepositoryScanSnapshot}
          state={architectureRepositoryScanState}
        />
      ) : viewMode === "todoHistory" ? (
        <TodosHistoryPanel
          deviceDirectory={todoDeviceDirectory}
          finishPlanError={finishPlanState.error}
          finishedPlanRefs={finishedPlanRefs}
          finishingPlanRef={finishPlanState.planRef}
          items={todoHistoryItems}
          onFinishPlan={finishTerminalTodoPlan}
          repoLabel={repoLabel}
          terminalOptions={workspaceTerminalOptions}
          workspaceId={activeWorkspaceId}
        />
      ) : (
        <SessionHistoryPanel
          error={sessionHistoryError}
          items={sessionHistoryItems}
          onGoToTerminal={onGoToSessionTerminal}
          onOpenTerminal={onOpenSessionTerminal}
          repoLabel={repoLabel}
          state={sessionHistoryState}
          terminalOptions={workspaceTerminalOptions}
          workspaceId={activeWorkspaceId}
        />
      )}
      {visibleArchitectureError && (
        <ArchitectureErrorToast aria-live="polite" role="status" title={visibleArchitectureError}>
          <strong>Architecture sync issue</strong>
          <span>{visibleArchitectureError}</span>
        </ArchitectureErrorToast>
      )}
    </ArchitectureSurface>
  );
}

export function ArchitectureHubView({
  catalog = null,
  catalogState = "idle",
  catalogError = "",
  onRefreshCatalog = null,
  graphLists = {},
  onCopyGraph = null,
  onGraphListRefresh = null,
  onSelectionChange = null,
  resolveRepoSyncContext = null,
  selectedGraphId = "",
  selectedRepoPath = "",
  workspaceDispatchTargets = [],
}) {
  const repositoryGroups = useMemo(() => {
    if (!catalog || typeof catalog !== "object") return [];
    const groups = [];
    const globalEntry = jsonObject(catalog.global);
    if (globalEntry) {
      groups.push({
        id: "global",
        kind: "global",
        label: "Global",
        repositories: [globalEntry],
      });
    }
    jsonArray(catalog.workspaces).forEach((workspaceGroup) => {
      const workspaceId = text(workspaceGroup?.workspaceId);
      const repositories = jsonArray(workspaceGroup?.repositories);
      if (!workspaceId) return;
      groups.push({
        id: `workspace-${workspaceId}`,
        kind: "workspace",
        label: text(workspaceGroup?.workspaceName) || workspaceId,
        repositories,
      });
    });
    const folderRepositories = jsonArray(catalog.folderRepositories);
    if (folderRepositories.length) {
      groups.push({
        id: "folders",
        kind: "folder",
        label: "Folders",
        repositories: folderRepositories,
      });
    }
    const orphanRepositories = jsonArray(catalog.orphanRepositories);
    if (orphanRepositories.length) {
      groups.push({
        id: "orphans",
        kind: "orphan",
        label: "Other synced repos",
        repositories: orphanRepositories,
      });
    }
    return groups;
  }, [catalog]);

  const repositoryScan = useMemo(() => ({
    repositories: repositoryGroups.flatMap((group) => group.repositories),
  }), [repositoryGroups]);
  const createNamedFolder = useCallback(async (name) => {
    const entry = await invoke("architecture_named_root", { name });
    if (typeof onRefreshCatalog === "function") {
      await onRefreshCatalog({ refresh: true });
    }
    return entry;
  }, [onRefreshCatalog]);
  const scanState = catalogState === "ready" || catalog ? "ready" : catalogState;

  // No toolbar bar: the catalog auto-syncs from the Rust store watcher and
  // cloud broadcasts, so the hub renders the panel full-height. data-layout
  // "single" collapses the surface to one bounded row — without it the panel
  // lands in the toolbar's `auto` row and only sizes to its content.
  return (
    <ArchitectureSurface aria-label="Architectures" data-layout="single" data-state={scanState}>
      <ArchitecturesPanel
        graphLists={graphLists}
        onCopyGraph={onCopyGraph}
        onCreateNamedFolder={createNamedFolder}
        onGraphListRefresh={onGraphListRefresh}
        onSelectionChange={onSelectionChange}
        repoLabel="account"
        repoPath=""
        repositoryGroups={repositoryGroups}
        repositoryScan={repositoryScan}
        repositoryScanError={catalogError}
        repositoryScanState={scanState}
        resolveRepoSyncContext={resolveRepoSyncContext}
        workspaceDispatchTargets={workspaceDispatchTargets}
        workspaceSelectedGraphId={selectedGraphId}
        workspaceSelectedRepoPath={selectedRepoPath}
      />
      {catalogError && catalogState === "ready" && (
        <ArchitectureErrorToast aria-live="polite" role="status" title={catalogError}>
          <strong>Architecture catalog issue</strong>
          <span>{catalogError}</span>
        </ArchitectureErrorToast>
      )}
    </ArchitectureSurface>
  );
}

function ArchitecturesPanel({
  graphLists = {},
  onGraphListRefresh = null,
  onSelectionChange = null,
  onCopyGraph = null,
  onCreateNamedFolder = null,
  queueWorkspaceId = "",
  queueWorkspaceName = "",
  repoLabel,
  repoPath,
  repositoryScan = null,
  repositoryScanError = "",
  repositoryScanState = "idle",
  resolveRepoSyncContext = null,
  workspaceSelectedGraphId = "",
  workspaceSelectedRepoPath = "",
  workspaceDispatchTargets = [],
  tasks = [],
}) {
  const [repositories, setRepositories] = useState([]);
  const [selectedRepoPath, setSelectedRepoPath] = useState("");
  const [repoState, setRepoState] = useState("loading");
  const [graphs, setGraphs] = useState([]);
  const [graphState, setGraphState] = useState("idle");
  const [selectedGraphId, setSelectedGraphId] = useState("");
  const [selectedGraph, setSelectedGraph] = useState(null);
  const [error, setError] = useState("");
  const [creatingGraph, setCreatingGraph] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftLocationMode, setDraftLocationMode] = useState("root");
  const [draftFolderPath, setDraftFolderPath] = useState("");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [saveState, setSaveState] = useState("idle");
  const [agentEditMarkers, setAgentEditMarkers] = useState([]);
  const [selectedGraphDirty, setSelectedGraphDirty] = useState(false);
  const [selectedGraphExternalDirty, setSelectedGraphExternalDirty] = useState(false);
  const [externalDirtyGraphIds, setExternalDirtyGraphIds] = useState(() => new Set());
  const [revisionBrowser, setRevisionBrowser] = useState({ graphId: "", open: false });
  const [, setDragGraph] = useState(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [draftFolderName, setDraftFolderName] = useState("");
  const [folderCreateState, setFolderCreateState] = useState("idle");
  const [navContextMenu, setNavContextMenu] = useState(null);
  const navPaneRef = useRef(null);
  const selectedGraphDirtyRef = useRef(false);
  const selectedGraphLoadedKeyRef = useRef("");
  const hydratedListRefreshKeysRef = useRef(new Set());
  const suppressedExternalGraphWritesRef = useRef(new Map());

  const suppressExternalGraphWrites = useCallback((graphIds = []) => {
    const expiresAt = Date.now() + ARCHITECTURE_FILE_WRITE_SUPPRESSION_MS;
    graphIds
      .map((graphId) => text(graphId))
      .filter(Boolean)
      .forEach((graphId) => suppressedExternalGraphWritesRef.current.set(graphId, expiresAt));
  }, []);

  const isExternalGraphWriteSuppressed = useCallback((graphId) => {
    const normalizedGraphId = text(graphId);
    if (!normalizedGraphId) return false;
    const now = Date.now();
    suppressedExternalGraphWritesRef.current.forEach((expiresAt, currentGraphId) => {
      if (expiresAt <= now) {
        suppressedExternalGraphWritesRef.current.delete(currentGraphId);
      }
    });
    const expiresAt = suppressedExternalGraphWritesRef.current.get(normalizedGraphId);
    if (!expiresAt || expiresAt <= now) {
      suppressedExternalGraphWritesRef.current.delete(normalizedGraphId);
      return false;
    }
    return true;
  }, []);

  const markSelectedGraphExternallyDirty = useCallback((graphId = selectedGraphId) => {
    const dirtyGraphId = text(graphId);
    if (!dirtyGraphId) return;
    selectedGraphDirtyRef.current = true;
    setSelectedGraphDirty(true);
    setSelectedGraphExternalDirty(true);
    setExternalDirtyGraphIds((currentIds) => {
      if (currentIds.has(dirtyGraphId)) return currentIds;
      const nextIds = new Set(currentIds);
      nextIds.add(dirtyGraphId);
      return nextIds;
    });
  }, [selectedGraphId]);

  useEffect(() => {
    selectedGraphDirtyRef.current = selectedGraphDirty;
  }, [selectedGraphDirty]);

  const repoSyncContext = useCallback((repo = "") => {
    const targetRepo = text(repo);
    if (typeof resolveRepoSyncContext === "function" && targetRepo) {
      const context = resolveRepoSyncContext(targetRepo);
      if (context && typeof context === "object") {
        return {
          workspaceId: text(context.workspaceId),
          workspaceName: text(context.workspaceName),
          queueWorkspaceId: text(context.queueWorkspaceId),
          queueWorkspaceName: text(context.queueWorkspaceName),
          scopeRepoId: text(context.scopeRepoId),
          scopeGitRepoIdentityId: text(context.scopeGitRepoIdentityId),
        };
      }
    }
    return {
      workspaceId: text(queueWorkspaceId),
      workspaceName: text(queueWorkspaceName),
      queueWorkspaceId: text(queueWorkspaceId),
      queueWorkspaceName: text(queueWorkspaceName),
      scopeRepoId: "",
      scopeGitRepoIdentityId: "",
    };
  }, [queueWorkspaceId, queueWorkspaceName, resolveRepoSyncContext]);
  const selectedRepoSyncContext = useMemo(
    () => repoSyncContext(selectedRepoPath),
    [repoSyncContext, selectedRepoPath],
  );
  const syncWorkspaceId = selectedRepoSyncContext.workspaceId;
  const syncWorkspaceName = selectedRepoSyncContext.workspaceName;
  const syncScopeRepoId = selectedRepoSyncContext.scopeRepoId;
  const syncScopeGitRepoIdentityId = selectedRepoSyncContext.scopeGitRepoIdentityId;
  const dispatchWorkspaceId = selectedRepoSyncContext.queueWorkspaceId;
  const dispatchWorkspaceName = selectedRepoSyncContext.queueWorkspaceName;
  const normalizedWorkspaceDispatchTargets = useMemo(
    () => normalizeSnippingDispatchTargets(workspaceDispatchTargets),
    [workspaceDispatchTargets],
  );

  useEffect(() => {
    const nextRepositories = jsonArray(repositoryScan?.repositories);

    if (repositoryScanState === "loading") {
      setRepoState("loading");
      setError("");
      if (nextRepositories.length) {
        setRepositories(nextRepositories);
      }
      return;
    }

    if (repositoryScanState === "error") {
      setRepositories([]);
      setSelectedRepoPath("");
      setCreatingGraph(false);
      setRepoState("error");
      setError(repositoryScanError || "Unable to load architecture repositories.");
      return;
    }

    if (repositoryScanState === "ready" || nextRepositories.length) {
      setRepositories(nextRepositories);
      setSelectedRepoPath((current) => {
        const preferredRepoPath = text(workspaceSelectedRepoPath);
        const preferredRepoKey = architectureRepoPathKey(preferredRepoPath);
        if (preferredRepoKey && nextRepositories.some((repo) => architectureRepoPathKey(architectureRepoPathFromEntry(repo)) === preferredRepoKey)) {
          return preferredRepoPath;
        }
        if (current && nextRepositories.some((repo) => architectureRepoPathKey(architectureRepoPathFromEntry(repo)) === architectureRepoPathKey(current))) return current;
        return architectureRepoPathFromEntry(nextRepositories[0]) || "";
      });
      setRepoState("ready");
      setError("");
      return;
    }

    setRepositories([]);
    setSelectedRepoPath("");
    setCreatingGraph(false);
    setRepoState("idle");
    setError("");
  }, [repositoryScan, repositoryScanError, repositoryScanState, workspaceSelectedRepoPath]);

  const selectedGraphListCacheEntry = useMemo(
    () => architectureGraphListCacheEntry(graphLists, selectedRepoPath),
    [graphLists, selectedRepoPath],
  );

  useEffect(() => {
    if (!selectedRepoPath || !selectedGraphListCacheEntry) return;
    const nextGraphs = jsonArray(selectedGraphListCacheEntry.graphs || selectedGraphListCacheEntry.navTree);
    const cacheState = text(selectedGraphListCacheEntry.state, nextGraphs.length ? "ready" : "idle");
    setGraphs((current) => (architectureGraphListSameContent(current, nextGraphs) ? current : nextGraphs));
    setRepositories((currentRepositories) => {
      const repoKey = architectureRepoPathKey(selectedRepoPath);
      if (!currentRepositories.some((repository) => (
        architectureRepoPathKey(architectureRepoPathFromEntry(repository)) === repoKey
          && Number(repository?.graphCount || 0) !== nextGraphs.length
      ))) {
        return currentRepositories;
      }
      return currentRepositories.map((repository) => (
        architectureRepoPathKey(architectureRepoPathFromEntry(repository)) === repoKey
          ? { ...repository, graphCount: nextGraphs.length }
          : repository
      ));
    });
    setSelectedGraphId((current) => {
      const preferredGraphId = architectureRepoPathKey(workspaceSelectedRepoPath) === architectureRepoPathKey(selectedRepoPath)
        ? text(workspaceSelectedGraphId)
        : "";
      if (preferredGraphId && nextGraphs.some((graph) => graph.id === preferredGraphId)) return preferredGraphId;
      if (current && nextGraphs.some((graph) => graph.id === current)) return current;
      return nextGraphs[0]?.id || "";
    });
    if (!nextGraphs.length) {
      setSelectedGraph(null);
    }
    if (cacheState === "error") {
      setGraphState("error");
      setError(text(selectedGraphListCacheEntry.error, "Unable to load architecture graphs."));
      return;
    }
    setGraphState(cacheState === "loading" && !nextGraphs.length ? "loading" : "ready");
  }, [
    selectedGraphListCacheEntry,
    selectedRepoPath,
    workspaceSelectedGraphId,
    workspaceSelectedRepoPath,
  ]);

  const loadGraphList = useCallback((repo = selectedRepoPath, options = {}) => {
    if (!repo) {
      setGraphs([]);
      setSelectedGraphId("");
      setSelectedGraph(null);
      return Promise.resolve([]);
    }
    if (!options.silent) setGraphState("loading");
    setError("");
    const listPromise = typeof onGraphListRefresh === "function"
      ? onGraphListRefresh(repo, options)
      : invoke("architecture_graphs_list", { repoPath: repo }).then((result) => jsonArray(result?.graphs));
    return listPromise
      .then((result) => {
        const nextGraphs = jsonArray(result?.graphs || result);
        setGraphs((current) => (architectureGraphListSameContent(current, nextGraphs) ? current : nextGraphs));
        setRepositories((currentRepositories) => {
          const repoKey = architectureRepoPathKey(repo);
          if (!currentRepositories.some((repository) => (
            architectureRepoPathKey(architectureRepoPathFromEntry(repository)) === repoKey
              && Number(repository?.graphCount || 0) !== nextGraphs.length
          ))) {
            return currentRepositories;
          }
          return currentRepositories.map((repository) => (
            architectureRepoPathKey(architectureRepoPathFromEntry(repository)) === repoKey
              ? { ...repository, graphCount: nextGraphs.length }
              : repository
          ));
        });
        setSelectedGraphId((current) => {
          const preferredGraphId = architectureRepoPathKey(workspaceSelectedRepoPath) === architectureRepoPathKey(repo)
            ? text(workspaceSelectedGraphId)
            : "";
          if (preferredGraphId && nextGraphs.some((graph) => graph.id === preferredGraphId)) return preferredGraphId;
          if (current && nextGraphs.some((graph) => graph.id === current)) return current;
          return nextGraphs[0]?.id || "";
        });
        if (!nextGraphs.length) {
          setSelectedGraph(null);
        }
        setGraphState("ready");
        return nextGraphs;
      })
      .catch((nextError) => {
        setGraphs([]);
        setSelectedGraphId("");
        setSelectedGraph(null);
        setGraphState("error");
        setError(nextError?.message || String(nextError || "Unable to load architecture graphs."));
        return [];
      });
  }, [
    onGraphListRefresh,
    selectedRepoPath,
    workspaceSelectedGraphId,
    workspaceSelectedRepoPath,
  ]);

  // Auto-load is keyed on a stable cache signature, never on the cache entry
  // object identity: every refresh writes a fresh entry object, and
  // identity-keyed reloads hot-looped on repos whose list failed
  // (load → error entry → "changed" entry → load → ...). Error entries do
  // not auto-retry at all — the error renders with manual refresh.
  const selectedGraphListCacheSignature = selectedGraphListCacheEntry
    ? `${text(selectedGraphListCacheEntry.state)}:${Number(selectedGraphListCacheEntry.updatedAt || 0)}`
    : "";
  const selectedGraphListCacheRef = useRef(null);
  selectedGraphListCacheRef.current = selectedGraphListCacheEntry;
  useEffect(() => {
    const cacheEntry = selectedGraphListCacheRef.current;
    if (cacheEntry && text(cacheEntry.state) === "error") {
      return;
    }
    void loadGraphList(selectedRepoPath, { silent: Boolean(cacheEntry) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadGraphList, selectedGraphListCacheSignature, selectedRepoPath]);

  useEffect(() => {
    if (!selectedRepoPath || !syncWorkspaceId) {
      return undefined;
    }
    let cancelled = false;
    let unlistenArchitecture = null;
    listen(ARCHITECTURE_CLOUD_UPDATED_EVENT, (event) => {
      if (cancelled) return;
      const payload = jsonObject(event?.payload) || {};
      const nestedPayload = jsonObject(payload.payload) || {};
      const eventWorkspaceId = text(
        payload.workspaceId
          || payload.workspace_id
          || nestedPayload.workspaceId
          || nestedPayload.workspace_id,
      );
      const workspaceIds = jsonArray(payload.workspace_ids || payload.workspaceIds || nestedPayload.workspace_ids || nestedPayload.workspaceIds)
        .map((item) => text(item))
        .filter(Boolean);
      if (
        eventWorkspaceId
        && eventWorkspaceId !== syncWorkspaceId
        && !workspaceIds.includes(syncWorkspaceId)
      ) {
        return;
      }
      suppressExternalGraphWrites(architectureGraphIdsFromCloudEvent(event?.payload || event));
      void loadGraphList(selectedRepoPath, {
        refresh: true,
        silent: true,
        workspaceName: syncWorkspaceName,
      });
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenArchitecture = unlisten;
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (unlistenArchitecture) unlistenArchitecture();
    };
  }, [loadGraphList, selectedRepoPath, suppressExternalGraphWrites, syncWorkspaceId, syncWorkspaceName]);

  const selectedGraphSummary = useMemo(
    () => graphs.find((graph) => architectureGraphId(graph) === selectedGraphId) || null,
    [graphs, selectedGraphId],
  );
  const selectedGraphFileDirty = selectedGraphExternalDirty
    || externalDirtyGraphIds.has(selectedGraphId)
    || (!selectedGraphDirty && architectureGraphLocalUnsaved(selectedGraphSummary));

  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;
    if (!selectedRepoPath || !selectedGraphId) {
      selectedGraphLoadedKeyRef.current = "";
      setSelectedGraph(null);
      setSelectedGraphDirty(false);
      setSelectedGraphExternalDirty(false);
      return () => {
        cancelled = true;
        if (retryTimer) window.clearTimeout(retryTimer);
      };
    }

    // Only flash the loading state when a different graph is being opened;
    // background list refreshes re-run this effect and should stay silent.
    const loadedKey = `${architectureRepoPathKey(selectedRepoPath)}::${selectedGraphId}`;
    if (selectedGraphLoadedKeyRef.current !== loadedKey) {
      setGraphState("loading");
      setError("");
      setSelectedGraphExternalDirty(false);
    }
    const hydrateRef = architectureGraphNeedsCloudHydration(selectedGraphSummary)
      ? architectureGraphCloudRef(selectedGraphSummary)
      : null;

    const readLocalGraph = () => invoke("architecture_graph_read", {
      graphId: selectedGraphId,
      repoPath: selectedRepoPath,
    });
    const hydrateGraph = (ref) => {
      suppressExternalGraphWrites([
        selectedGraphId,
        architectureGraphCloudId(ref),
      ]);
      return Promise.resolve({
        failed: [],
        items: [],
        skipped: [ref],
      }).then((result) => {
        suppressExternalGraphWrites([
          selectedGraphId,
          architectureGraphCloudId(ref),
          ...architectureGraphIdsFromCloudEvent(result),
        ]);
        const hydratedGraph = architectureHydratedGraph(result, selectedGraphId);
        if (hydratedGraph) return hydratedGraph;
        const skipped = jsonArray(result?.skipped);
        if (skipped.length) {
          return readLocalGraph();
        }
        const failures = jsonArray(result?.failed).concat(jsonArray(result?.missing));
        if (failures.length) {
          const firstFailure = failures[0];
          throw new Error(architectureErrorText(
            firstFailure?.error
              || firstFailure?.message
              || firstFailure,
            "Architecture graph hydration failed.",
          ));
        }
        return loadGraphList(selectedRepoPath, { refresh: true, silent: true })
          .then(() => readLocalGraph())
          .catch((readError) => {
            if (architectureGraphNotFoundError(readError)) {
              throw new Error("Architecture graph is still hydrating from cloud.");
            }
            throw readError;
          });
        });
    };
    const readPromise = hydrateRef
      ? hydrateGraph(hydrateRef)
      : readLocalGraph().catch((readError) => {
        if (!architectureGraphNotFoundError(readError) || !selectedGraphSummary) {
          throw readError;
        }
        const fallbackHydrateRef = architectureGraphCloudRef(selectedGraphSummary);
        if (!fallbackHydrateRef) {
          throw readError;
        }
        return hydrateGraph(fallbackHydrateRef).catch((hydrateError) => {
          if (!architectureGraphNotFoundError(hydrateError)) {
            throw hydrateError;
          }
          return loadGraphList(selectedRepoPath, { refresh: true, silent: true }).then(() => readLocalGraph());
        });
      });

    readPromise
      .then((graph) => {
        if (cancelled) return;
        if (selectedGraphDirtyRef.current) return;
        const alreadyLoadedSelectedGraph = selectedGraphLoadedKeyRef.current === loadedKey;
        selectedGraphLoadedKeyRef.current = loadedKey;
        setSelectedGraph((current) => {
          const sameGraph = current && text(current?.id) === text(graph?.id);
          const sameContent = sameGraph
            && text(current?.source) === text(graph?.source)
            && text(current?.updatedAt) === text(graph?.updatedAt);
          if (
            alreadyLoadedSelectedGraph
            && sameGraph
            && !sameContent
            && !isExternalGraphWriteSuppressed(selectedGraphId)
          ) {
            markSelectedGraphExternallyDirty(selectedGraphId);
          }
          return sameContent ? current : graph;
        });
        setGraphState("ready");
        setError("");
        // One post-hydration list refresh per graph. Without this guard a
        // graph the cloud keeps reporting as hydration-pending re-triggers
        // refresh -> new list -> hydrate -> refresh forever, which is what
        // made the hub flicker and show "Refreshing" constantly.
        if (hydrateRef && !hydratedListRefreshKeysRef.current.has(loadedKey)) {
          hydratedListRefreshKeysRef.current.add(loadedKey);
          if (hydratedListRefreshKeysRef.current.size > 200) {
            hydratedListRefreshKeysRef.current.clear();
            hydratedListRefreshKeysRef.current.add(loadedKey);
          }
          void loadGraphList(selectedRepoPath, { refresh: true, silent: true });
        }
      })
      .catch((nextError) => {
        if (cancelled) return;
        const message = nextError?.message || String(nextError || "Unable to read architecture graph.");
        if (hydrateRef && message.toLowerCase().includes("still hydrating from cloud")) {
          setSelectedGraph(null);
          setGraphState("loading");
          setError("");
          retryTimer = window.setTimeout(() => {
            if (!cancelled) {
              void loadGraphList(selectedRepoPath, { refresh: true, silent: true });
            }
          }, 1000);
          return;
        }
        setSelectedGraph(null);
        setGraphState("error");
        setError(message);
      });

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [
    loadGraphList,
    isExternalGraphWriteSuppressed,
    markSelectedGraphExternallyDirty,
    suppressExternalGraphWrites,
    selectedGraphId,
    selectedGraphSummary,
    selectedRepoPath,
    syncScopeGitRepoIdentityId,
    syncScopeRepoId,
    syncWorkspaceId,
    syncWorkspaceName,
  ]);

  useEffect(() => {
    if (!selectedRepoPath || !selectedGraphId || creatingGraph || saveState === "saving") {
      return undefined;
    }
    let cancelled = false;
    let unlisten = null;
    const rereadSelectedGraph = ({ allowDirtyRefresh = false } = {}) => {
      invoke("architecture_graph_read", {
        graphId: selectedGraphId,
        repoPath: selectedRepoPath,
      })
        .then((graph) => {
          if (cancelled) return;
          setSelectedGraph((current) => {
            const currentSource = text(current?.source);
            const nextSource = text(graph?.source);
            const currentUpdatedAt = text(current?.updatedAt);
            const nextUpdatedAt = text(graph?.updatedAt);
            if (selectedGraphDirtyRef.current && !allowDirtyRefresh) {
              return current;
            }
            if (currentSource === nextSource && currentUpdatedAt === nextUpdatedAt) {
              return current;
            }
            if (isExternalGraphWriteSuppressed(selectedGraphId)) {
              return graph;
            }
            markSelectedGraphExternallyDirty(selectedGraphId);
            return graph;
          });
        })
        .catch(() => {});
    };
    // Event-driven instead of a 450ms poll: the backend file-watcher emits
    // "architecture-store-changed" (debounced) on any graph file write —
    // including server-synced architectures — so re-read only then. The open
    // graph also loads on selection elsewhere. Zero idle wake-ups while idle.
    listen("architecture-store-changed", (event) => {
      if (!cancelled) {
        const payload = event?.payload || {};
        const changedGraphIds = jsonArray(payload.graphIds || payload.graph_ids)
          .map((item) => text(item))
          .filter(Boolean);
        if (!changedGraphIds.length || changedGraphIds.includes(selectedGraphId)) {
          const suppressed = isExternalGraphWriteSuppressed(selectedGraphId);
          if (!suppressed) {
            markSelectedGraphExternallyDirty(selectedGraphId);
          }
          rereadSelectedGraph({ allowDirtyRefresh: !suppressed });
        }
      }
    }).then((fn) => {
      if (cancelled) {
        fn();
        return;
      }
      unlisten = fn;
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [creatingGraph, isExternalGraphWriteSuppressed, markSelectedGraphExternallyDirty, saveState, selectedGraphId, selectedRepoPath]);

  const selectedRepo = repositories.find((repo) => (
    architectureRepoPathKey(architectureRepoPathFromEntry(repo)) === architectureRepoPathKey(selectedRepoPath)
  )) || null;
  useEffect(() => {
    if (!selectedRepoPath || typeof onSelectionChange !== "function") return;
    if (selectedGraphId && graphs.length && !graphs.some((graph) => graph.id === selectedGraphId)) return;
    onSelectionChange({ graphId: selectedGraphId, repoPath: selectedRepoPath });
  }, [
    graphs,
    onSelectionChange,
    selectedGraphId,
    selectedRepoPath,
  ]);
  const agentEditMarkersStorageKey = useMemo(
    () => architectureAgentEditMarkersStorageKey(
      syncWorkspaceId || queueWorkspaceId,
      selectedRepoPath || repoPath,
    ),
    [queueWorkspaceId, repoPath, selectedRepoPath, syncWorkspaceId],
  );
  const visibleAgentEditMarkers = useMemo(
    () => architectureVisibleAgentEditMarkers(agentEditMarkers, tasks, graphs),
    [agentEditMarkers, graphs, tasks],
  );
  const selectedAgentEditMarker = useMemo(
    () => architectureAgentEditMarkerForGraph(selectedGraph, visibleAgentEditMarkers),
    [selectedGraph, visibleAgentEditMarkers],
  );
  const treeRows = useMemo(() => architectureGraphTreeRows(graphs, 0), [graphs]);
  const showEmptyGraphList = !graphs.length && (
    graphState === "ready"
    || (graphState === "loading" && Boolean(selectedGraphListCacheEntry))
  );
  const folderSuggestions = useMemo(() => (
    [...new Set(graphs.map((graph) => architectureFolderPathText(graph.groupPath)).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right))
  ), [graphs]);
  const revisionBrowserOpen = revisionBrowser.open && Boolean(selectedRepoPath);

  useEffect(() => {
    if (!agentEditMarkersStorageKey) {
      setAgentEditMarkers([]);
      return;
    }
    setAgentEditMarkers(architectureReadStoredAgentEditMarkers(agentEditMarkersStorageKey));
  }, [agentEditMarkersStorageKey]);

  useEffect(() => {
    if (!agentEditMarkersStorageKey) return;
    if (architectureAgentEditMarkersEqual(agentEditMarkers, visibleAgentEditMarkers)) return;
    setAgentEditMarkers(visibleAgentEditMarkers);
    architectureWriteStoredAgentEditMarkers(agentEditMarkersStorageKey, visibleAgentEditMarkers);
  }, [agentEditMarkers, agentEditMarkersStorageKey, visibleAgentEditMarkers]);

  const recordAgentEditQueued = useCallback((queuedItem) => {
    const marker = architectureAgentEditMarkerFromQueueItem(queuedItem);
    if (!marker) return;
    setAgentEditMarkers((currentMarkers) => {
      const currentVisibleMarkers = architectureVisibleAgentEditMarkers(currentMarkers, tasks, graphs);
      const nextMarkers = currentVisibleMarkers
        .filter((candidate) => (
          candidate.commandId !== marker.commandId
            && !architectureAgentEditMarkersGraphMatch(candidate, marker)
        ))
        .concat([marker])
        .slice(-ARCHITECTURE_AGENT_EDIT_MARKER_MAX_ITEMS);
      architectureWriteStoredAgentEditMarkers(agentEditMarkersStorageKey, nextMarkers);
      return nextMarkers;
    });
  }, [agentEditMarkersStorageKey, graphs, tasks]);

  const openRevisionBrowser = useCallback((graphId = "") => {
    setRevisionBrowser({
      graphId: text(graphId),
      open: true,
    });
    setCreatingGraph(false);
    setError("");
  }, []);

  const closeRevisionBrowser = useCallback(() => {
    setRevisionBrowser((current) => ({ ...current, open: false }));
  }, []);

  const submitNamedFolder = useCallback(() => {
    const name = text(draftFolderName);
    if (!name || typeof onCreateNamedFolder !== "function" || folderCreateState === "saving") return;
    setFolderCreateState("saving");
    setError("");
    Promise.resolve(onCreateNamedFolder(name))
      .then((entry) => {
        const entryPath = text(entry?.rootDirectory || entry?.root_directory || entry?.path);
        const initialFolderPath = text(
          entry?.initialFolderPath
            || entry?.initial_folder_path
            || entry?.folderPath
            || entry?.folder_path
            || name,
        );
        setCreatingFolder(false);
        setDraftFolderName("");
        setFolderCreateState("idle");
        if (entryPath) {
          setSelectedRepoPath(entryPath);
          setSelectedGraphId("");
          setSelectedGraph(null);
          setDraftTitle("");
          setDraftLocationMode(initialFolderPath ? "folder" : "root");
          setDraftFolderPath(initialFolderPath);
          setCreatingGraph(Boolean(initialFolderPath));
        }
      })
      .catch((nextError) => {
        setFolderCreateState("idle");
        setError(nextError?.message || String(nextError || "Unable to create architecture folder."));
      });
  }, [draftFolderName, folderCreateState, onCreateNamedFolder]);

  const beginCreateGraph = useCallback((folderPath = "") => {
    const nextFolderPath = text(folderPath);
    setDraftTitle("");
    setDraftLocationMode(nextFolderPath ? "folder" : "root");
    setDraftFolderPath(nextFolderPath);
    setCreatingFolder(false);
    setDraftFolderName("");
    setRevisionBrowser((current) => ({ ...current, open: false }));
    setCreatingGraph(true);
    setError("");
  }, []);

  const beginCreateFolder = useCallback(() => {
    if (typeof onCreateNamedFolder !== "function") return;
    setCreatingFolder(true);
    setDraftFolderName("");
    setCreatingGraph(false);
    setRevisionBrowser((current) => ({ ...current, open: false }));
    setError("");
  }, [onCreateNamedFolder]);

  const createGraph = useCallback(() => {
    if (!selectedRepoPath) return;
    const groupPath = draftLocationMode === "folder" ? draftFolderPath : "";
    const graph = architectureEmptyGraph({
      groupPath,
      title: draftTitle,
    });
    setSaveState("saving");
    setError("");
    invoke("architecture_graph_save", {
      graph,
      repoPath: selectedRepoPath,
    })
      .then((result) => {
        const nextGraph = result?.graph || graph;
        const savedGraphId = architectureGraphId(nextGraph) || result?.graphId || result?.graph_id || graph.id;
        suppressExternalGraphWrites([savedGraphId]);
        setSelectedGraph(nextGraph);
        setSelectedGraphId(savedGraphId || graph.id);
        setCreatingGraph(false);
        setDraftTitle("");
        setDraftLocationMode("root");
        setDraftFolderPath("");
        setSaveState("idle");
        void loadGraphList(selectedRepoPath, { refresh: true });
      })
      .catch((nextError) => {
        setSaveState("idle");
        setError(nextError?.message || String(nextError || "Unable to create architecture graph."));
      });
  }, [draftFolderPath, draftLocationMode, draftTitle, loadGraphList, selectedRepoPath, selectedRepoSyncContext, suppressExternalGraphWrites, syncWorkspaceId, syncWorkspaceName]);

  const saveGraph = useCallback((graph) => {
    if (!selectedRepoPath) return Promise.reject(new Error("Select a repository first."));
    setSaveState("saving");
    setError("");
    return invoke("architecture_graph_save", {
      graph,
      repoPath: selectedRepoPath,
    })
      .then((result) => {
        const nextGraph = result?.graph || graph;
        const savedGraphId = architectureGraphId(nextGraph) || result?.graphId || result?.graph_id;
        suppressExternalGraphWrites([savedGraphId]);
        setSelectedGraph(nextGraph);
        setSelectedGraphId(savedGraphId || nextGraph.id);
        setSelectedGraphDirty(false);
        selectedGraphDirtyRef.current = false;
        setSelectedGraphExternalDirty(false);
        setExternalDirtyGraphIds((currentIds) => {
          if (!savedGraphId || !currentIds.has(savedGraphId)) return currentIds;
          const nextIds = new Set(currentIds);
          nextIds.delete(savedGraphId);
          return nextIds;
        });
        setSaveState("idle");
        void loadGraphList(selectedRepoPath, { refresh: true });
        return nextGraph;
      })
      .catch((nextError) => {
        setSaveState("idle");
        setError(nextError?.message || String(nextError || "Unable to save architecture graph."));
        throw nextError;
      });
  }, [loadGraphList, selectedRepoPath, selectedRepoSyncContext, suppressExternalGraphWrites, syncWorkspaceId, syncWorkspaceName]);

  const deleteGraph = useCallback((graph) => {
    if (!selectedRepoPath) return Promise.reject(new Error("Select a repository first."));
    const graphId = text(graph?.id || selectedGraphId);
    if (!graphId) return Promise.reject(new Error("Select an architecture graph first."));
    const graphTitle = text(graph?.title || graph?.name || selectedGraph?.title || graphId, graphId);
    const confirmed = typeof window === "undefined" || window.confirm(
      `Delete "${graphTitle}"?\n\nThis will remove the architecture graph and its revision history, then sync the delete to every client.`,
    );
    if (!confirmed) return Promise.resolve(false);
    setSaveState("saving");
    setError("");
    return invoke("architecture_graph_delete", {
      graphId,
      repoPath: selectedRepoPath,
    })
      .then((result) => {
        setSelectedGraphDirty(false);
        selectedGraphDirtyRef.current = false;
        setSelectedGraphExternalDirty(false);
        setExternalDirtyGraphIds((currentIds) => {
          if (!currentIds.has(graphId)) return currentIds;
          const nextIds = new Set(currentIds);
          nextIds.delete(graphId);
          return nextIds;
        });
        setRevisionBrowser((current) => (
          text(current.graphId) === graphId ? { graphId: "", open: false } : { ...current, open: false }
        ));
        setCreatingGraph(false);
        setSelectedGraphId("");
        setSelectedGraph(null);
        setSaveState("idle");
        hydratedListRefreshKeysRef.current.delete(`${architectureRepoPathKey(selectedRepoPath)}::${graphId}`);
        void loadGraphList(selectedRepoPath, { refresh: true });
        return result;
      })
      .catch((nextError) => {
        setSaveState("idle");
        setError(nextError?.message || String(nextError || "Unable to delete architecture graph."));
        throw nextError;
      });
  }, [loadGraphList, selectedGraph?.title, selectedGraphId, selectedRepoPath]);

  const handleRevisionRestored = useCallback((result) => {
    const nextGraph = result?.graph || null;
    const nextGraphId = text(result?.graphId || result?.graph_id || nextGraph?.id);
    suppressExternalGraphWrites([nextGraphId]);
    if (nextGraph) setSelectedGraph(nextGraph);
    if (nextGraphId) setSelectedGraphId(nextGraphId);
    setCreatingGraph(false);
    setSelectedGraphDirty(false);
    setSelectedGraphExternalDirty(false);
    if (nextGraphId) {
      setExternalDirtyGraphIds((currentIds) => {
        if (!currentIds.has(nextGraphId)) return currentIds;
        const nextIds = new Set(currentIds);
        nextIds.delete(nextGraphId);
        return nextIds;
      });
    }
    void loadGraphList(selectedRepoPath, { refresh: true });
  }, [loadGraphList, selectedRepoPath, selectedRepoSyncContext, suppressExternalGraphWrites, syncWorkspaceId, syncWorkspaceName]);

  const renderTreeRows = useCallback((emptyDepth = 0) => (
    <>
      {treeRows.map((row) => {
        if (row.kind === "folder") {
          return (
            <FileTreeItem key={`folder-${row.id}`}>
              <ArchitectureFileTreeButton
                $depth={row.depth}
                data-architecture-row="folder"
                onClick={() => beginCreateGraph(row.path.join(" / "))}
                title={row.path.join(" / ")}
                type="button"
              >
                <FileDisclosure aria-hidden="true">
                  <span className="codicon codicon-chevron-down" />
                </FileDisclosure>
                <ArchitectureFileKindIcon
                  aria-hidden="true"
                  data-file-tone="folder"
                  title="Architecture folder"
                >
                  <span className="codicon codicon-folder-opened" />
                </ArchitectureFileKindIcon>
                <FileTreeName>{row.name}</FileTreeName>
                <FileGitStatusMark aria-hidden="true" />
              </ArchitectureFileTreeButton>
            </FileTreeItem>
          );
        }

        const rowMarker = architectureAgentEditMarkerForGraph(row.graph, visibleAgentEditMarkers);
        const rowMarkerTitle = architectureAgentEditMarkerTitle(rowMarker);
        const rowDirty = architectureGraphLocalUnsaved(row.graph)
          || externalDirtyGraphIds.has(row.graph.id)
          || (row.graph.id === selectedGraphId && selectedGraphDirty);
        const graphFileName = architectureGraphFileName(row.graph);
        const draggable = typeof onCopyGraph === "function";
        return (
          <FileTreeItem key={`graph-${row.graph.id}`}>
            <ArchitectureFileTreeButton
              $depth={row.depth}
              data-agent-edit={rowMarker ? rowMarker.status : undefined}
              data-architecture-row="graph"
              data-local-unsaved={rowDirty ? "true" : undefined}
              data-selected={row.graph.id === selectedGraphId && !creatingGraph ? "true" : undefined}
              draggable={draggable || undefined}
              onClick={() => {
                setSelectedGraphId(row.graph.id);
                setCreatingGraph(false);
                setError("");
                if (row.graph.id !== selectedGraphId) {
                  setGraphState("loading");
                }
                setRevisionBrowser((current) => ({ ...current, open: false }));
              }}
              onDragEnd={draggable ? () => setDragGraph(null) : undefined}
              onDragStart={draggable ? (event) => {
                const payload = {
                  filePath: row.graph.filePath || `.agents/architectures/graphs/${row.graph.id}.arch`,
                  graphId: row.graph.id,
                  sourceRepoPath: selectedRepoPath,
                  title: row.graph.title || graphFileName,
                };
                setDragGraph(payload);
                try {
                  event.dataTransfer.setData("application/x-diffforge-architecture-graph", JSON.stringify(payload));
                  event.dataTransfer.effectAllowed = "copy";
                } catch {
                  // dataTransfer can be unavailable in some webviews; state carries the payload.
                }
              } : undefined}
              title={[
                graphFileName,
                row.graph.title && row.graph.title !== graphFileName ? row.graph.title : "",
                row.graph.filePath,
                rowMarkerTitle,
                rowDirty ? "Unsaved local changes" : "",
              ].filter(Boolean).join("\n")}
              type="button"
            >
              <FileDisclosure aria-hidden="true" />
              <ArchitectureFileKindIcon
                aria-hidden="true"
                data-file-tone="architecture"
                title="Architecture graph"
              >
                <ArchitectureGraphFileIcon aria-hidden="true" />
              </ArchitectureFileKindIcon>
              <FileTreeName>{graphFileName}</FileTreeName>
              <ArchitectureFileStatusMark
                aria-hidden={!rowMarker && !rowDirty}
                data-agent-edit={rowMarker ? rowMarker.status : undefined}
                data-local-unsaved={rowDirty ? "true" : undefined}
                style={rowMarker ? { "--agent-edit-color": rowMarker.agentColor } : undefined}
                title={rowMarkerTitle || (rowDirty ? "Unsaved local changes" : undefined)}
              >
                {rowMarker || rowDirty ? <i /> : null}
              </ArchitectureFileStatusMark>
            </ArchitectureFileTreeButton>
          </FileTreeItem>
        );
      })}
      {showEmptyGraphList && (
        <FileTreeMessage $depth={emptyDepth}>No architecture files yet</FileTreeMessage>
      )}
    </>
  ), [
    beginCreateGraph,
    creatingGraph,
    onCopyGraph,
    externalDirtyGraphIds,
    selectedGraphId,
    selectedGraphDirty,
    selectedRepoPath,
    showEmptyGraphList,
    treeRows,
    visibleAgentEditMarkers,
  ]);

  const handleRepoSelection = useCallback((repoPathValue) => {
    const nextRepoPath = text(repoPathValue);
    if (!nextRepoPath || architectureRepoPathKey(nextRepoPath) === architectureRepoPathKey(selectedRepoPath)) return;
    setSelectedRepoPath(nextRepoPath);
    setSelectedGraphId("");
    setSelectedGraph(null);
    setCreatingGraph(false);
    setRevisionBrowser((current) => ({ ...current, open: false }));
  }, [selectedRepoPath]);

  const closeNavContextMenu = useCallback(() => {
    setNavContextMenu(null);
  }, []);

  const openNavContextMenu = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 190;
    const menuHeight = 64;
    const paneRect = navPaneRef.current?.getBoundingClientRect?.();
    const leftBoundary = paneRect?.left ?? 0;
    const topBoundary = paneRect?.top ?? 0;
    const paneWidth = paneRect?.width ?? window.innerWidth;
    const paneHeight = paneRect?.height ?? window.innerHeight;
    const clickX = event.clientX - leftBoundary;
    const clickY = event.clientY - topBoundary;
    setNavContextMenu({
      x: clampNumber(clickX, 8, Math.max(8, paneWidth - menuWidth - 8)),
      y: clampNumber(clickY, 8, Math.max(8, paneHeight - menuHeight - 8)),
    });
  }, []);

  useEffect(() => {
    if (!navContextMenu) return undefined;
    const closeMenu = (event) => {
      if (event?.target?.closest?.("[data-architecture-context-menu='true']")) return;
      closeNavContextMenu();
    };
    const handleKeyDown = (event) => {
      if (event.key === "Escape") closeNavContextMenu();
    };
    window.addEventListener("pointerdown", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("pointerdown", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [closeNavContextMenu, navContextMenu]);

  const beginContextCreateGraph = useCallback(() => {
    closeNavContextMenu();
    beginCreateGraph("");
  }, [beginCreateGraph, closeNavContextMenu]);

  const beginContextCreateFolder = useCallback(() => {
    closeNavContextMenu();
    beginCreateFolder();
  }, [beginCreateFolder, closeNavContextMenu]);

  const selectedListedGraphPending = Boolean(selectedGraphId && selectedGraphSummary && !selectedGraph && !creatingGraph);

  return (
    <ArchitecturesShell data-nav-collapsed={navCollapsed ? "true" : "false"}>
      {!navCollapsed && (
        <ArchitectureFilesNavPane
          aria-label="Architecture files"
          onContextMenu={openNavContextMenu}
          ref={navPaneRef}
        >
          <FileExplorerHeader>
            <div>
              <PanelKicker>Architectures</PanelKicker>
            </div>
            <FileExplorerActions>
              <FileIconButton
                aria-label="Open architecture revision history"
                disabled={!selectedRepoPath}
                onClick={() => openRevisionBrowser("")}
                title="Open architecture revision history"
                type="button"
              >
                <Cached aria-hidden="true" />
              </FileIconButton>
              <FileIconButton
                aria-label="Hide architecture navigation"
                onClick={() => setNavCollapsed(true)}
                title="Hide architecture navigation"
                type="button"
              >
                <KeyboardDoubleArrowLeft aria-hidden="true" />
              </FileIconButton>
            </FileExplorerActions>
          </FileExplorerHeader>
          <FileRootPath title={selectedRepo?.architectureRoot || selectedRepoPath || "No architecture root"}>
            {selectedRepo?.architectureRoot || selectedRepoPath || "No architecture root"}
          </FileRootPath>
          <ArchitectureNavControls>
            {repositories.length > 1 && (
              <ArchitectureRootPickerWrap>
                <AppSelect
                  aria-label="Architecture root"
                  onChange={(value) => handleRepoSelection(value)}
                  options={repositories.map((repo) => {
                    const repoPathValue = architectureRepoPathFromEntry(repo);
                    return {
                      value: repoPathValue,
                      label: repo.name || architectureFileNameFromPath(repoPathValue) || repoPathValue,
                    };
                  })}
                  placeholder="Architecture root"
                  value={selectedRepoPath}
                />
              </ArchitectureRootPickerWrap>
            )}
            {creatingFolder && (
              <ArchitectureFolderCreateForm
                onSubmit={(event) => {
                  event.preventDefault();
                  submitNamedFolder();
                }}
              >
                <input
                  aria-label="Architecture folder name"
                  autoFocus
                  disabled={folderCreateState === "saving"}
                  onChange={(event) => setDraftFolderName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setCreatingFolder(false);
                      setDraftFolderName("");
                    }
                  }}
                  placeholder="Folder name"
                  value={draftFolderName}
                />
                <button
                  disabled={!draftFolderName.trim() || folderCreateState === "saving"}
                  type="submit"
                >
                  {folderCreateState === "saving" ? "..." : "Add"}
                </button>
              </ArchitectureFolderCreateForm>
            )}
          </ArchitectureNavControls>
          <FileTree aria-label="Architecture file explorer">
            {repoState === "ready" && !repositories.length ? (
              <FileTreeEmpty>No architecture root detected.</FileTreeEmpty>
            ) : (
              <>
                {repoState === "loading" && !graphs.length && (
                  <FileTreeMessage $depth={0}>Loading...</FileTreeMessage>
                )}
                {graphState === "error" && !graphs.length && (
                  <FileTreeMessage $depth={0} data-tone="error">
                    Unable to load architecture files
                  </FileTreeMessage>
                )}
                {renderTreeRows(0)}
              </>
            )}
          </FileTree>
          <ArchitectureNavBottomActions>
            <ArchitectureNavBottomButton
              disabled={!selectedRepoPath || saveState === "saving"}
              onClick={() => beginCreateGraph("")}
              title="Add new architecture"
              type="button"
            >
              <Add aria-hidden="true" />
              <span>Add new Architecture</span>
            </ArchitectureNavBottomButton>
            <ArchitectureNavBottomButton
              disabled={typeof onCreateNamedFolder !== "function"}
              onClick={beginCreateFolder}
              title="Add new folder"
              type="button"
            >
              <CreateNewFolder aria-hidden="true" />
              <span>Add new folder</span>
            </ArchitectureNavBottomButton>
          </ArchitectureNavBottomActions>
          {navContextMenu && (
            <FileContextMenu
              data-architecture-context-menu="true"
              role="menu"
              style={{
                left: navContextMenu.x,
                top: navContextMenu.y,
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <FileContextMenuItem
                disabled={!selectedRepoPath || saveState === "saving"}
                onClick={beginContextCreateGraph}
                role="menuitem"
                type="button"
              >
                Add new Architecture
              </FileContextMenuItem>
              <FileContextMenuItem
                disabled={typeof onCreateNamedFolder !== "function"}
                onClick={beginContextCreateFolder}
                role="menuitem"
                type="button"
              >
                Add new folder
              </FileContextMenuItem>
            </FileContextMenu>
          )}
        </ArchitectureFilesNavPane>
      )}

      <ArchitectureEditorRegion>
        {error && <ArchitectureError>{error}</ArchitectureError>}
        <ArchitectureEditorContent>
          {navCollapsed && (
            <ArchitectureRestoreNavButton
              aria-label="Show architecture navigation"
              onClick={() => setNavCollapsed(false)}
              title="Show architecture navigation"
              type="button"
            >
              <KeyboardDoubleArrowRight aria-hidden="true" />
            </ArchitectureRestoreNavButton>
          )}
          {revisionBrowserOpen ? (
            <ArchitectureRevisionDrawer
              activeGraphDirty={selectedGraphDirty}
              graphId={revisionBrowser.graphId}
              onClose={closeRevisionBrowser}
              onRestored={handleRevisionRestored}
              repoPath={selectedRepoPath}
              selectedGraphId={selectedGraphId}
            />
          ) : selectedListedGraphPending ? (
            <ArchitectureGraphResolvingSurface
              graph={selectedGraphSummary}
              graphState={graphState}
            />
          ) : creatingGraph || !selectedGraph ? (
            <ArchitectureCreateSurface
              canCancel={creatingGraph && Boolean(selectedGraph)}
              draftFolderPath={draftFolderPath}
              draftLocationMode={draftLocationMode}
              draftTitle={draftTitle}
              folderSuggestions={folderSuggestions}
              onCancel={() => setCreatingGraph(false)}
              onCreate={createGraph}
              onDraftFolderPathChange={setDraftFolderPath}
              onDraftLocationModeChange={setDraftLocationMode}
              onDraftTitleChange={setDraftTitle}
              saveState={saveState}
              selectedRepo={selectedRepo}
            />
          ) : (
            <ArchitectureGraphEditor
              agentEditMarker={selectedAgentEditMarker}
              externalDirty={selectedGraphFileDirty}
              graph={selectedGraph}
              onAgentEditQueued={recordAgentEditQueued}
              onDeleteGraph={deleteGraph}
              onDirtyChange={setSelectedGraphDirty}
              onOpenRevisions={openRevisionBrowser}
              onSave={saveGraph}
              queueWorkspaceId={dispatchWorkspaceId}
              queueWorkspaceName={dispatchWorkspaceName}
              workspaceDispatchTargets={normalizedWorkspaceDispatchTargets}
              saveState={saveState}
              selectedRepo={selectedRepo}
            />
          )}
        </ArchitectureEditorContent>
      </ArchitectureEditorRegion>
    </ArchitecturesShell>
  );
}

function ArchitectureCreateSurface({
  canCancel,
  draftFolderPath,
  draftLocationMode,
  draftTitle,
  folderSuggestions,
  onCancel,
  onCreate,
  onDraftFolderPathChange,
  onDraftLocationModeChange,
  onDraftTitleChange,
  saveState,
  selectedRepo,
}) {
  const canCreate = Boolean(selectedRepo && text(draftTitle));

  return (
    <ArchitectureCreateSurfaceShell>
      <ArchitectureCreateDialog aria-label="Create architecture graph">
        <ArchitectureField>
          <span>Name</span>
          <ArchitectureInput
            autoFocus
            onChange={(event) => onDraftTitleChange(event.target.value)}
            placeholder="Architecture graph name"
            value={draftTitle}
          />
        </ArchitectureField>
        <ArchitectureField>
          <span>Location</span>
          <ArchitectureLocationToggle aria-label="Architecture graph location">
            <ArchitectureLocationButton
              data-active={draftLocationMode === "root" ? "true" : "false"}
              onClick={() => onDraftLocationModeChange("root")}
              type="button"
            >
              Root
            </ArchitectureLocationButton>
            <ArchitectureLocationButton
              data-active={draftLocationMode === "folder" ? "true" : "false"}
              onClick={() => onDraftLocationModeChange("folder")}
              type="button"
            >
              Folder
            </ArchitectureLocationButton>
          </ArchitectureLocationToggle>
        </ArchitectureField>
        {draftLocationMode === "folder" && (
          <ArchitectureField>
            <span>Folder path</span>
            <ArchitectureInput
              onChange={(event) => onDraftFolderPathChange(event.target.value)}
              placeholder="auth / api"
              value={draftFolderPath}
            />
          </ArchitectureField>
        )}
        {draftLocationMode === "folder" && folderSuggestions.length > 0 && (
          <ArchitectureFolderSuggestions>
            {folderSuggestions.slice(0, 6).map((folderPath) => (
              <button
                key={folderPath}
                onClick={() => onDraftFolderPathChange(folderPath)}
                type="button"
              >
                {folderPath}
              </button>
            ))}
          </ArchitectureFolderSuggestions>
        )}
        <ArchitectureCreateActions>
          {canCancel && (
            <ArchitectureSmallButton onClick={onCancel} type="button">
              Cancel
            </ArchitectureSmallButton>
          )}
          <ArchitecturePrimaryButton
            disabled={!canCreate || saveState === "saving"}
            onClick={onCreate}
            type="button"
          >
            {saveState === "saving" ? "Creating..." : "Create Graph"}
          </ArchitecturePrimaryButton>
        </ArchitectureCreateActions>
      </ArchitectureCreateDialog>
    </ArchitectureCreateSurfaceShell>
  );
}

function ArchitectureGraphResolvingSurface({
  graph,
  graphState,
}) {
  const isError = graphState === "error";
  const graphTitle = text(graph?.title || graph?.name || architectureGraphId(graph), "Architecture graph");
  return (
    <ArchitectureCreateSurfaceShell>
      <ArchitectureCreateDialog aria-label="Loading architecture graph">
        <ArchitectureResolvingMessage data-state={isError ? "error" : "loading"}>
          <strong>{isError ? "Architecture graph unavailable" : "Loading architecture graph"}</strong>
          <span>{graphTitle}</span>
        </ArchitectureResolvingMessage>
      </ArchitectureCreateDialog>
    </ArchitectureCreateSurfaceShell>
  );
}

function ArchitectureGraphEditor(props) {
  return (
    <ReactFlowProvider>
      <ArchitectureGraphEditorView {...props} />
    </ReactFlowProvider>
  );
}

function ArchitectureGraphEditorView({
  agentEditMarker = null,
  externalDirty = false,
  graph,
  onAgentEditQueued = () => {},
  onDeleteGraph = null,
  onDirtyChange = () => {},
  onOpenRevisions = null,
  onSave,
  queueWorkspaceId = "",
  queueWorkspaceName = "",
  saveState,
  selectedRepo,
  workspaceDispatchTargets = [],
}) {
  const initialFlow = useMemo(() => architectureGraphToFlow(graph), [graph]);
  const [nodes, setNodes, handleNodesChange] = useNodesState(initialFlow.nodes);
  const [edges, setEdges, handleEdgesChange] = useEdgesState(initialFlow.edges);
  const [draftGraph, setDraftGraph] = useState(() => jsonObject(graph) || {});
  const [agentCommandDraft, setAgentCommandDraft] = useState("");
  const [agentCommandNotice, setAgentCommandNotice] = useState("");
  const [agentTargetWorkspaceId, setAgentTargetWorkspaceId] = useState("");
  const [agentTargetThreadId, setAgentTargetThreadId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [localError, setLocalError] = useState("");
  const [expandedCorridorId, setExpandedCorridorId] = useState("");
  const [runSelections, setRunSelections] = useState({});
  const routeCacheRef = useRef(new Map());
  const colorMode = useForgeThemeMode();
  const reactFlow = useReactFlow();
  const [searchQuery, setSearchQuery] = useState("");
  const [focusedNodeId, setFocusedNodeId] = useState("");
  const activeFocusId = focusedNodeId;
  const runTargets = useMemo(() => architectureRunTargetsFromGraph(draftGraph), [draftGraph]);
  const highlightSets = useMemo(() => {
    if (!activeFocusId) return null;
    const focusNode = nodes.find((node) => node.id === activeFocusId);
    if (!focusNode) return null;
    const connected = getConnectedEdges([focusNode], edges);
    const nodeIds = new Set([activeFocusId]);
    const edgeIds = new Set();
    connected.forEach((edge) => {
      nodeIds.add(edge.source);
      nodeIds.add(edge.target);
      if (edge.id) edgeIds.add(edge.id);
    });
    [...nodeIds].forEach((id) => {
      const parentId = nodes.find((node) => node.id === id)?.parentId;
      if (parentId) nodeIds.add(parentId);
    });
    return { edgeIds, nodeIds };
  }, [activeFocusId, edges, nodes]);
  const focusNode = useCallback((id) => {
    if (!id) return;
    setFocusedNodeId(id);
    if (reactFlow?.fitView) {
      reactFlow.fitView({ duration: 420, maxZoom: 1.2, nodes: [{ id }], padding: 0.5 });
    }
  }, [reactFlow]);
  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return nodes
      .filter((node) => node.type !== "architectureGroup")
      .filter((node) => architectureFlowNodeTitle(node).toLowerCase().includes(query)
        || text(node.data?.role).toLowerCase().includes(query)
        || text(node.data?.kind).toLowerCase().includes(query))
      .slice(0, 8);
  }, [nodes, searchQuery]);
  const renderNodes = useMemo(() => architectureOrderFlowNodes(nodes).map((node) => {
    const dimmed = highlightSets && !highlightSets.nodeIds.has(node.id);
    const focused = Boolean(activeFocusId) && node.id === activeFocusId;
    const className = [dimmed ? "arch-dim" : "", focused ? "arch-focus" : ""]
      .filter(Boolean)
      .join(" ") || undefined;
    if (node.type !== "architectureCorridor") {
      return className ? { ...node, className } : node;
    }
    const expanded = expandedCorridorId === node.id;
    const horizontal = text(node.data?.orientation, "horizontal") === "horizontal";
    const stepCount = jsonArray(node.data?.steps).length;
    const expandedHeight = Math.min(430, Math.max(168, 96 + stepCount * 42));
    const expandedWidth = horizontal ? 640 : 390;
    return {
      ...node,
      className,
      data: {
        ...(node.data || {}),
        expanded,
        onToggle: () => setExpandedCorridorId((current) => (current === node.id ? "" : node.id)),
      },
      style: {
        ...(node.style || {}),
        height: expanded ? expandedHeight : numberValue(node.style?.height, horizontal ? 64 : 86),
        width: expanded ? expandedWidth : numberValue(node.style?.width, horizontal ? 340 : 260),
      },
    };
  }), [activeFocusId, expandedCorridorId, highlightSets, nodes]);
  const renderEdges = useMemo(() => {
    const routed = architectureEdgesWithRoutingData(edges, renderNodes, {
      routeCache: routeCacheRef.current,
    });
    const focusActive = Boolean(highlightSets);
    return routed.map((edge) => {
      const focused = focusActive && Boolean(edge.id && highlightSets.edgeIds.has(edge.id));
      const dimmed = focusActive && !focused;
      const className = dimmed
        ? (edge.className ? `${edge.className} arch-dim` : "arch-dim")
        : edge.className;
      const role = architectureEdgeRole(edge.data?.role || edge.data?.kind);
      const strokeColor = architectureEdgeStrokeColor(role, false, colorMode);
      return {
        ...edge,
        className,
        markerEnd: { ...(edge.markerEnd || {}), color: strokeColor, type: MarkerType.ArrowClosed },
        data: { ...(edge.data || {}), colorMode, dimmed, focusActive, focused },
      };
    });
  }, [colorMode, edges, highlightSets, renderNodes]);
  const semanticWarnings = useMemo(
    () => architectureValidateSemanticGraph(draftGraph, nodes, edges),
    [draftGraph, edges, nodes],
  );
  const dispatchTargets = useMemo(
    () => normalizeSnippingDispatchTargets(workspaceDispatchTargets),
    [workspaceDispatchTargets],
  );
  const agentTargetWorkspace = useMemo(
    () => dispatchTargets.find((target) => target.workspaceId === agentTargetWorkspaceId) || null,
    [agentTargetWorkspaceId, dispatchTargets],
  );
  const agentWorkspaceOptions = useMemo(() => dispatchTargets.map((target) => ({
    label: text(target.workspaceName, target.workspaceId),
    value: target.workspaceId,
  })), [dispatchTargets]);
  const agentTerminalOptions = useMemo(() => [
    { color: "", label: "Any terminal", value: "" },
    ...(agentTargetWorkspace?.threads || []).map((thread, index) => ({
      ...thread,
      color: sanitizeTerminalColor(
        thread.targetTerminalColor || thread.color,
        Number.isInteger(thread.targetColorSlot)
          ? thread.targetColorSlot
          : Number.isInteger(thread.terminalIndex)
            ? thread.terminalIndex
            : index,
      ),
      label: text(thread.label || thread.targetTerminalName, thread.threadId),
      value: thread.threadId,
    })),
  ], [agentTargetWorkspace]);
  const activeQueueWorkspaceId = text(agentTargetWorkspace?.workspaceId || queueWorkspaceId);
  const activeQueueWorkspaceName = text(agentTargetWorkspace?.workspaceName || queueWorkspaceName);

  useEffect(() => {
    const nextFlow = architectureGraphToFlow(graph);
    routeCacheRef.current.clear();
    setNodes(nextFlow.nodes);
    setEdges(nextFlow.edges);
    setDraftGraph(jsonObject(graph) || {});
    setExpandedCorridorId("");
    setRunSelections({});
    setDirty(Boolean(externalDirty));
    setLocalError("");
    setAgentCommandDraft("");
    setAgentCommandNotice("");
  }, [externalDirty, graph, setEdges, setNodes]);

  useEffect(() => {
    setAgentTargetWorkspaceId((current) => {
      if (current && dispatchTargets.some((target) => target.workspaceId === current)) return current;
      if (queueWorkspaceId && dispatchTargets.some((target) => target.workspaceId === queueWorkspaceId)) {
        return queueWorkspaceId;
      }
      return text(dispatchTargets[0]?.workspaceId);
    });
  }, [dispatchTargets, queueWorkspaceId]);

  useEffect(() => {
    setAgentTargetThreadId((current) => {
      if (!current) return current;
      const threads = agentTargetWorkspace?.threads || [];
      return threads.some((thread) => thread.threadId === current) ? current : "";
    });
  }, [agentTargetWorkspace]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  // View-only canvas: let React Flow apply internal measurement/dimension
  // changes, but never let viewing interactions mark the graph dirty.
  const onNodesChange = useCallback((changes) => {
    handleNodesChange(changes);
  }, [handleNodesChange]);

  const onEdgesChange = useCallback((changes) => {
    handleEdgesChange(changes);
  }, [handleEdgesChange]);

  const save = useCallback(() => {
    const nextGraph = architectureGraphFromFlow(draftGraph, nodes, edges);
    setLocalError("");
    onSave(nextGraph)
      .then(() => setDirty(false))
      .catch((nextError) => {
        setLocalError(nextError?.message || String(nextError || "Unable to save graph."));
      });
  }, [draftGraph, edges, nodes, onSave]);

  const requestDeleteGraph = useCallback(() => {
    if (typeof onDeleteGraph !== "function") return;
    setLocalError("");
    Promise.resolve(onDeleteGraph(draftGraph || graph)).catch((nextError) => {
      setLocalError(nextError?.message || String(nextError || "Unable to delete graph."));
    });
  }, [draftGraph, graph, onDeleteGraph]);

  const queueArchitectureAgentCommand = useCallback((event) => {
    event.preventDefault();
    const prompt = text(agentCommandDraft);
    if (!prompt) return;
    if (!activeQueueWorkspaceId || !agentTargetWorkspace) {
      setLocalError("Pick a workspace before queueing an architecture task.");
      return;
    }
    const targetFields = buildSnippingAnnotationTargetFields({
      targetThreadId: agentTargetThreadId,
      targetWorkspace: agentTargetWorkspace,
    });
    const queuedItem = architectureQueueAgentTodo({
      graph: draftGraph,
      prompt,
      repoPath: selectedRepo?.path || "",
      targetFields,
      workspaceId: activeQueueWorkspaceId,
      workspaceName: activeQueueWorkspaceName,
    });
    setAgentCommandDraft("");
    setAgentCommandNotice(queuedItem ? "Queued for coding agents" : "Queued locally");
    if (queuedItem) onAgentEditQueued(queuedItem);
    setLocalError("");
  }, [
    activeQueueWorkspaceId,
    activeQueueWorkspaceName,
    agentCommandDraft,
    agentTargetThreadId,
    agentTargetWorkspace,
    draftGraph,
    onAgentEditQueued,
    selectedRepo?.path,
  ]);

  const updateRunSelection = useCallback((targetId, patch) => {
    const safeTargetId = text(targetId);
    if (!safeTargetId) return;
    setRunSelections((current) => ({
      ...current,
      [safeTargetId]: {
        ...(jsonObject(current[safeTargetId]) || {}),
        ...patch,
      },
    }));
    if (agentCommandNotice) setAgentCommandNotice("");
  }, [agentCommandNotice]);

  const queueArchitectureRunTarget = useCallback((target) => {
    const runTarget = architectureNormalizeRunTarget(target);
    if (!runTarget) return;
    if (dirty) {
      setLocalError("Save this architecture graph before running a target.");
      return;
    }
    if (!activeQueueWorkspaceId || !agentTargetWorkspace) {
      setLocalError("Pick a workspace before running an architecture target.");
      return;
    }
    const selection = architectureRunTargetSelection(runTarget, runSelections);
    const prompt = architectureRunPrompt(runTarget, selection.env, selection.mode);
    const targetFields = buildSnippingAnnotationTargetFields({
      targetThreadId: agentTargetThreadId,
      targetWorkspace: agentTargetWorkspace,
    });
    const queuedItem = architectureQueueAgentTodo({
      graph: draftGraph,
      prompt,
      repoPath: selectedRepo?.path || "",
      runEnvironment: selection.env,
      runMode: selection.mode,
      runTarget,
      targetFields,
      workspaceId: activeQueueWorkspaceId,
      workspaceName: activeQueueWorkspaceName,
    });
    setAgentCommandNotice(queuedItem ? `Queued ${runTarget.label}` : "Queued locally");
    if (queuedItem) onAgentEditQueued(queuedItem);
    setLocalError("");
  }, [
    activeQueueWorkspaceId,
    activeQueueWorkspaceName,
    agentTargetThreadId,
    agentTargetWorkspace,
    dirty,
    draftGraph,
    onAgentEditQueued,
    runSelections,
    selectedRepo?.path,
  ]);

  const agentDispatchReady = dispatchTargets.length > 0;
  const agentCommandReady = Boolean(text(agentCommandDraft)) && agentDispatchReady;
  const agentCommandStatus = localError
    || agentCommandNotice
    || (dirty ? "Unsaved changes" : agentDispatchReady ? "Press Enter to queue" : "Open an active coding-agent terminal");
  const agentEditBlurb = architectureAgentEditMarkerBlurb(agentEditMarker);
  const agentEditTitle = architectureAgentEditMarkerTitle(agentEditMarker);

  return (
    <ArchitectureEditorShell>
      <ArchitectureEditorBody>
        <ArchitectureCanvasViewport>
          <ReactFlow
            colorMode={colorMode}
            defaultEdgeOptions={{
              markerEnd: {
                color: colorMode === "light" ? "#6b7280" : "rgba(148, 163, 184, 0.6)",
                type: MarkerType.ArrowClosed,
              },
              type: "architectureEdge",
              zIndex: 0,
            }}
            edgeTypes={architectureEdgeTypes}
            edges={renderEdges}
            edgesFocusable={false}
            elementsSelectable={false}
            fitView
            fitViewOptions={{ maxZoom: 1.1, padding: 0.22 }}
            maxZoom={1.7}
            minZoom={0.18}
            nodeTypes={architectureNodeTypes}
            nodes={renderNodes}
            nodesConnectable={false}
            nodesDraggable={false}
            nodesFocusable={false}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => {
              if (node.type === "architectureGroup") {
                setFocusedNodeId("");
                return;
              }
              setFocusedNodeId((current) => (current === node.id ? "" : node.id));
            }}
            onNodesChange={onNodesChange}
            onPaneClick={() => { setFocusedNodeId(""); }}
            panOnDrag
            panOnScroll
            proOptions={{ hideAttribution: true }}
            selectionOnDrag={false}
            zoomOnDoubleClick={false}
          >
            <Background
              color={colorMode === "light" ? "rgba(0, 0, 0, 0.1)" : "rgba(148, 163, 184, 0.16)"}
              gap={26}
              size={1.4}
            />
            <MiniMap
              maskColor={colorMode === "light" ? "rgba(0, 0, 0, 0.08)" : "rgba(2, 6, 23, 0.6)"}
              nodeColor={architectureMiniMapNodeColor}
              nodeStrokeWidth={2}
              pannable
              position="bottom-right"
              zoomable
            />
            <Controls position="bottom-left" showInteractive={false} />
          </ReactFlow>
          <ArchitectureSearchBar
            data-active={searchQuery ? "true" : "false"}
            onSubmit={(event) => {
              event.preventDefault();
              focusNode(searchResults[0]?.id);
            }}
          >
            <input
              aria-label="Find a node"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Find a node..."
              value={searchQuery}
            />
            {searchResults.length > 0 && (
              <ArchitectureSearchResults>
                {searchResults.map((node) => (
                  <button
                    key={node.id}
                    onClick={() => { focusNode(node.id); setSearchQuery(""); }}
                    type="button"
                  >
                    <strong>{architectureFlowNodeTitle(node)}</strong>
                    <span>{text(node.data?.role || node.data?.kind)}</span>
                  </button>
                ))}
              </ArchitectureSearchResults>
            )}
          </ArchitectureSearchBar>
          {agentEditMarker && (
            <ArchitectureAgentEditStatus
              aria-live="polite"
              role="status"
              style={{ "--agent-edit-color": agentEditMarker.agentColor }}
              title={agentEditTitle}
            >
              <i aria-hidden="true" />
              <span>{agentEditBlurb}</span>
            </ArchitectureAgentEditStatus>
          )}
          {semanticWarnings.length > 0 && (
            <ArchitectureValidationPanel title="Semantic graph warnings">
              <strong>{semanticWarnings.length} warning{semanticWarnings.length === 1 ? "" : "s"}</strong>
              {semanticWarnings.slice(0, 4).map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </ArchitectureValidationPanel>
          )}
          {runTargets.length > 0 && (
            <ArchitectureRunTargetsBar
              aria-label="Architecture run targets"
              data-disabled={dirty || saveState === "saving" || !agentDispatchReady ? "true" : "false"}
            >
              {runTargets.slice(0, 4).map((target) => {
                const selection = architectureRunTargetSelection(target, runSelections);
                const risk = architectureRunRisk(selection.env, selection.mode);
                return (
                  <ArchitectureRunTargetControl
                    data-risk={risk}
                    key={target.id}
                    title={`${target.label}\n${target.action}${target.scope ? ` / ${target.scope}` : ""}`}
                  >
                    <ArchitectureRunButton
                      data-action={target.action}
                      data-risk={risk}
                      disabled={dirty || saveState === "saving" || !agentDispatchReady}
                      onClick={() => queueArchitectureRunTarget(target)}
                      type="button"
                    >
                      {target.label}
                    </ArchitectureRunButton>
                    <ArchitectureRunSelectWrap>
                      <AppSelect
                        aria-label={`${target.label} environment`}
                        isDisabled={dirty || saveState === "saving" || !agentDispatchReady}
                        onChange={(value) => updateRunSelection(target.id, { env: value })}
                        options={target.envs.map((env) => ({
                          value: env,
                          label: architectureTitleFromSlug(env, env),
                        }))}
                        value={selection.env}
                      />
                    </ArchitectureRunSelectWrap>
                    <ArchitectureRunSelectWrap>
                      <AppSelect
                        aria-label={`${target.label} mode`}
                        isDisabled={dirty || saveState === "saving" || !agentDispatchReady}
                        onChange={(value) => updateRunSelection(target.id, { mode: value })}
                        options={target.modes.map((mode) => ({
                          value: mode,
                          label: architectureTitleFromSlug(mode, mode),
                        }))}
                        value={selection.mode}
                      />
                    </ArchitectureRunSelectWrap>
                  </ArchitectureRunTargetControl>
                );
              })}
            </ArchitectureRunTargetsBar>
          )}
          <ArchitectureFloatingActions>
            <ArchitectureFloatingButton
              onClick={() => {
                if (typeof onOpenRevisions === "function") onOpenRevisions(draftGraph.id || graph?.id);
              }}
              type="button"
            >
              History
            </ArchitectureFloatingButton>
            <ArchitectureFloatingDangerButton
              disabled={!text(draftGraph?.id || graph?.id) || saveState === "saving"}
              onClick={requestDeleteGraph}
              title="Delete this architecture graph"
              type="button"
            >
              Delete
            </ArchitectureFloatingDangerButton>
            <ArchitectureFloatingPrimaryButton
              disabled={!dirty || saveState === "saving"}
              onClick={save}
              type="button"
            >
              {saveState === "saving" ? "Saving..." : dirty ? "Save" : "Saved"}
            </ArchitectureFloatingPrimaryButton>
          </ArchitectureFloatingActions>
          <ArchitectureAgentCommandForm
            aria-label={agentCommandStatus}
            data-state={localError ? "error" : agentCommandNotice ? "notice" : dirty ? "dirty" : "idle"}
            onSubmit={queueArchitectureAgentCommand}
            title={agentCommandStatus}
          >
            <ArchitectureAgentCommandInput
              aria-label="Queue architecture task"
              onChange={(event) => {
                setAgentCommandDraft(event.target.value);
                if (agentCommandNotice) setAgentCommandNotice("");
              }}
              placeholder={agentDispatchReady
                ? "Ask a coding agent to update this architecture graph..."
                : "Open an active coding-agent terminal to queue a graph task..."}
              value={agentCommandDraft}
            />
            <ArchitectureAgentCommandControls>
              <ArchitectureAgentCommandSelectSlot data-kind="workspace">
                <Select
                  aria-label="Target workspace"
                  formatOptionLabel={architectureWorkspaceOptionLabelRenderer}
                  isDisabled={!agentDispatchReady}
                  isSearchable={false}
                  menuPlacement="top"
                  menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                  onChange={(option) => setAgentTargetWorkspaceId(option?.value || "")}
                  options={agentWorkspaceOptions}
                  placeholder="Workspace"
                  styles={ARCHITECTURE_TARGET_SELECT_STYLES}
                  value={agentWorkspaceOptions.find((option) => option.value === agentTargetWorkspaceId) || null}
                />
              </ArchitectureAgentCommandSelectSlot>
              <ArchitectureAgentCommandSelectSlot data-kind="terminal">
                <Select
                  aria-label="Target terminal"
                  formatOptionLabel={architectureTerminalOptionLabelRenderer}
                  isDisabled={!agentDispatchReady || !(agentTargetWorkspace?.threads || []).length}
                  isSearchable={false}
                  menuPlacement="top"
                  menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                  onChange={(option) => setAgentTargetThreadId(option?.value || "")}
                  options={agentTerminalOptions}
                  placeholder="Any terminal"
                  styles={ARCHITECTURE_TARGET_SELECT_STYLES}
                  value={agentTerminalOptions.find((option) => option.value === agentTargetThreadId) || agentTerminalOptions[0] || null}
                />
              </ArchitectureAgentCommandSelectSlot>
            </ArchitectureAgentCommandControls>
            <ArchitectureAgentCommandSubmitButton
              aria-label="Queue architecture task"
              data-ready={agentCommandReady ? "true" : undefined}
              disabled={!agentCommandReady}
              type="submit"
            >
              <ArchitectureAgentCommandSubmitIcon aria-hidden="true" />
            </ArchitectureAgentCommandSubmitButton>
          </ArchitectureAgentCommandForm>
        </ArchitectureCanvasViewport>
      </ArchitectureEditorBody>
    </ArchitectureEditorShell>
  );
}

function ArchitectureRevisionDrawer({
  activeGraphDirty = false,
  graphId = "",
  onClose = () => {},
  onRestored = () => {},
  repoPath = "",
  selectedGraphId = "",
}) {
  const scopedGraphId = text(graphId);
  const [items, setItems] = useState([]);
  const [state, setState] = useState("loading");
  const [error, setError] = useState("");
  const [selectedRevisionId, setSelectedRevisionId] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewState, setPreviewState] = useState("idle");
  const [restoreState, setRestoreState] = useState("idle");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!repoPath) {
      setItems([]);
      setState("idle");
      return () => {
        cancelled = true;
      };
    }
    setState("loading");
    setError("");
    setNotice("");
    invoke("architecture_graph_revisions_list", {
      graphId: scopedGraphId || null,
      repoPath,
    })
      .then((result) => {
        if (cancelled) return;
        const revisions = jsonArray(result?.revisions);
        setItems(revisions);
        setSelectedRevisionId((current) => {
          if (current && revisions.some((item) => architectureRevisionId(item) === current)) return current;
          return architectureRevisionId(revisions[0]) || "";
        });
        setState("ready");
      })
      .catch((nextError) => {
        if (cancelled) return;
        setItems([]);
        setSelectedRevisionId("");
        setState("error");
        setError(nextError?.message || String(nextError || "Unable to load architecture revisions."));
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, scopedGraphId]);

  const selectedRevision = useMemo(() => (
    items.find((item) => architectureRevisionId(item) === selectedRevisionId) || items[0] || null
  ), [items, selectedRevisionId]);

  useEffect(() => {
    let cancelled = false;
    if (!repoPath || !selectedRevision) {
      setPreview(null);
      setPreviewState("idle");
      return () => {
        cancelled = true;
      };
    }
    const revisionId = architectureRevisionId(selectedRevision);
    const revisionGraphId = architectureRevisionGraphId(selectedRevision);
    if (!revisionId || !revisionGraphId) {
      setPreview(null);
      setPreviewState("idle");
      return () => {
        cancelled = true;
      };
    }
    setPreviewState("loading");
    setError("");
    invoke("architecture_graph_revision_read", {
      graphId: revisionGraphId,
      repoPath,
      revisionId,
    })
      .then((result) => {
        if (cancelled) return;
        setPreview(result);
        setPreviewState("ready");
      })
      .catch((nextError) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewState("error");
        setError(nextError?.message || String(nextError || "Unable to read architecture revision."));
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, selectedRevision]);

  const restoreRevision = useCallback(() => {
    if (!repoPath || !selectedRevision || activeGraphDirty || restoreState === "restoring") return;
    const revisionId = architectureRevisionId(selectedRevision);
    const revisionGraphId = architectureRevisionGraphId(selectedRevision);
    if (!revisionId || !revisionGraphId) return;
    setRestoreState("restoring");
    setError("");
    setNotice("");
    invoke("architecture_graph_revision_restore", {
      graphId: revisionGraphId,
      repoPath,
      revisionId,
    })
      .then((result) => {
        setRestoreState("idle");
        setNotice("Revision restored");
        onRestored(result);
      })
      .catch((nextError) => {
        setRestoreState("idle");
        setError(nextError?.message || String(nextError || "Unable to restore architecture revision."));
      });
  }, [activeGraphDirty, onRestored, repoPath, restoreState, selectedRevision]);

  const source = text(preview?.source);
  const title = scopedGraphId ? "Graph History" : "Architecture History";
  const restoreDisabled = !selectedRevision || activeGraphDirty || restoreState === "restoring";
  const activeGraphLabel = scopedGraphId || selectedGraphId || "repo";

  return (
    <ArchitectureRevisionOverlay role="region" aria-label={title}>
      <ArchitectureRevisionDrawerShell>
        <ArchitectureRevisionHeader>
          <div>
            <TimelineKicker>{activeGraphLabel}</TimelineKicker>
            <ArchitectureRevisionTitle>{title}</ArchitectureRevisionTitle>
          </div>
          <ArchitectureRevisionHeaderActions>
            <ArchitectureSmallButton onClick={onClose} type="button">Close</ArchitectureSmallButton>
          </ArchitectureRevisionHeaderActions>
        </ArchitectureRevisionHeader>
        <ArchitectureRevisionBody>
          <ArchitectureRevisionList aria-label="Architecture revisions" data-state={state}>
            {state === "loading" && <ArchitectureRevisionEmpty>Loading revisions...</ArchitectureRevisionEmpty>}
            {state !== "loading" && !items.length && (
              <ArchitectureRevisionEmpty>No local revisions recorded yet.</ArchitectureRevisionEmpty>
            )}
            {items.map((item) => {
              const revisionId = architectureRevisionId(item);
              const revisionGraphId = architectureRevisionGraphId(item);
              const timestamp = architectureRevisionTimestamp(item);
              return (
                <ArchitectureRevisionRow
                  data-deleted={item?.deleted ? "true" : "false"}
                  data-selected={revisionId === architectureRevisionId(selectedRevision) ? "true" : "false"}
                  key={`${revisionGraphId}-${revisionId}`}
                  onClick={() => setSelectedRevisionId(revisionId)}
                  title={item?.filePath || item?.file_path || revisionId}
                  type="button"
                >
                  <strong>{text(item?.title, revisionGraphId || "Architecture")}</strong>
                  <span>{architectureRevisionReasonLabel(item?.reason)} · {formatRelativeTimeMs(timestamp) || formatTime(timestamp) || "unknown"}</span>
                  <em>{revisionGraphId}{item?.deleted ? " · deleted" : ""}</em>
                </ArchitectureRevisionRow>
              );
            })}
          </ArchitectureRevisionList>
          <ArchitectureRevisionPreview>
            {error && <ArchitectureEditorNotice data-kind="error">{error}</ArchitectureEditorNotice>}
            {notice && <ArchitectureEditorNotice>{notice}</ArchitectureEditorNotice>}
            {selectedRevision && (
              <ArchitectureRevisionMeta>
                <strong>{text(selectedRevision.title, architectureRevisionGraphId(selectedRevision))}</strong>
                <span>{architectureRevisionReasonLabel(selectedRevision.reason)}</span>
                <span>{formatTime(architectureRevisionTimestamp(selectedRevision)) || "unknown time"}</span>
                <span>{selectedRevision.nodeCount || 0} nodes · {selectedRevision.edgeCount || 0} edges</span>
              </ArchitectureRevisionMeta>
            )}
            <ArchitectureRevisionSource data-state={previewState}>
              {previewState === "loading" ? "Loading source..." : source || "Select a revision to preview its source."}
            </ArchitectureRevisionSource>
            <ArchitectureRevisionActions>
              {activeGraphDirty && (
                <ArchitectureRevisionRestoreNote>Save the current graph before restoring a revision.</ArchitectureRevisionRestoreNote>
              )}
              <ArchitectureFloatingPrimaryButton
                disabled={restoreDisabled}
                onClick={restoreRevision}
                type="button"
              >
                {restoreState === "restoring" ? "Restoring..." : "Restore Revision"}
              </ArchitectureFloatingPrimaryButton>
            </ArchitectureRevisionActions>
          </ArchitectureRevisionPreview>
        </ArchitectureRevisionBody>
      </ArchitectureRevisionDrawerShell>
    </ArchitectureRevisionOverlay>
  );
}

function ArchitectureApiCorridorNode({ data }) {
  const expanded = Boolean(data?.expanded);
  const steps = jsonArray(data?.steps);
  const participants = jsonArray(data?.routeParticipants);
  const status = text(data?.status, "current");
  const orientation = text(data?.orientation, "horizontal");
  const summary = text(data?.summary, `${steps.length} exchanges`);
  const handleToggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    data?.onToggle?.();
  };

  return (
    <ArchitectureApiCorridorShell
      data-expanded={expanded ? "true" : "false"}
      data-orientation={orientation}
      data-status={status}
    >
      <ArchitectureApiCorridorHeader
        aria-expanded={expanded}
        onClick={handleToggle}
        title={`${text(data?.title, "API corridor")}\n${summary}`}
        type="button"
      >
        <ArchitectureApiCorridorGlyph aria-hidden="true" />
        <ArchitectureApiCorridorHeaderText>
          <strong>{text(data?.title, "API corridor")}</strong>
          <span>{summary}</span>
        </ArchitectureApiCorridorHeaderText>
        <ArchitectureApiCorridorBadge>{steps.length} step{steps.length === 1 ? "" : "s"}</ArchitectureApiCorridorBadge>
      </ArchitectureApiCorridorHeader>
      {expanded ? (
        <ArchitectureApiCorridorExpanded>
          {participants.length > 0 && (
            <ArchitectureApiCorridorParticipants aria-label="API corridor participants">
              {participants.map((participant, index) => (
                <span key={`${participant.id || participant.title}-${index}`}>{participant.title}</span>
              ))}
            </ArchitectureApiCorridorParticipants>
          )}
          <ArchitectureApiCorridorStepList>
            {steps.map((step, index) => {
              const chips = [
                step.method,
                step.path,
                step.status,
                step.condition,
                step.event,
                step.branch,
              ].map(text).filter(Boolean).slice(0, 4);
              return (
                <ArchitectureApiCorridorStep
                  data-tone={step.tone || architectureApiCorridorRoleTone(step.role)}
                  key={step.id || `${step.sourceTitle}-${step.targetTitle}-${index}`}
                >
                  <ArchitectureApiCorridorStepNumber>{text(step.step, String(index + 1))}</ArchitectureApiCorridorStepNumber>
                  <ArchitectureApiCorridorStepBody>
                    <ArchitectureApiCorridorStepRoute>
                      <span>{text(step.sourceTitle, "source")}</span>
                      <i aria-hidden="true">{"->"}</i>
                      <span>{text(step.targetTitle, "target")}</span>
                    </ArchitectureApiCorridorStepRoute>
                    <ArchitectureApiCorridorStepLabel>{step.label}</ArchitectureApiCorridorStepLabel>
                    {chips.length > 0 && (
                      <ArchitectureApiCorridorStepChips>
                        {chips.map((chip) => <span key={chip}>{chip}</span>)}
                      </ArchitectureApiCorridorStepChips>
                    )}
                  </ArchitectureApiCorridorStepBody>
                </ArchitectureApiCorridorStep>
              );
            })}
          </ArchitectureApiCorridorStepList>
        </ArchitectureApiCorridorExpanded>
      ) : (
        <ArchitectureApiCorridorCollapsed aria-hidden="true">
          {participants.slice(0, 4).map((participant, index) => (
            <span key={`${participant.id || participant.title}-${index}`}>{participant.title}</span>
          ))}
        </ArchitectureApiCorridorCollapsed>
      )}
    </ArchitectureApiCorridorShell>
  );
}

function ArchitectureCanvasNode({ data, selected }) {
  const icon = useArchitectureIcon(data?.icon, data?.kind, data?.title);
  const IconComponent = icon.Icon;
  const direction = text(data?.flowDirection, "LR").toUpperCase();
  const display = architectureNodeDisplayMode(data || {});
  const compact = display === "compact";
  const role = architectureNodeRole(data?.role || data?.kind);
  const lifecycle = architectureSemanticSlug(data?.lifecycle);
  return (
    <ArchitectureCanvasNodeShell
      data-display={display}
      data-kind={text(data?.kind, "service")}
      data-lifecycle={lifecycle}
      data-role={role}
      data-selected={selected ? "true" : "false"}
    >
      <Handle position={architectureTargetHandlePosition(direction)} type="target" />
      <ArchitectureNodeIcon
        aria-hidden="true"
        data-kind={text(data?.kind, "service")}
        data-source={icon.source}
        title={icon.title}
      >
        {IconComponent ? <IconComponent /> : icon.label}
      </ArchitectureNodeIcon>
      <ArchitectureNodeText>
        <strong>{text(data?.title, "Node")}</strong>
        {!compact && <span>{text(data?.subtitle, role.replace(/[-_]+/gu, " "))}</span>}
      </ArchitectureNodeText>
      <Handle position={architectureSourceHandlePosition(direction)} type="source" />
    </ArchitectureCanvasNodeShell>
  );
}

function ArchitectureCanvasGroup({ data, selected }) {
  const icon = useArchitectureIcon(data?.icon, "group", data?.title);
  const IconComponent = icon.Icon;
  const direction = text(data?.flowDirection, "LR").toUpperCase();
  const intent = architectureGroupIntent(data?.intent);
  return (
    <ArchitectureCanvasGroupShell data-intent={intent} data-selected={selected ? "true" : "false"}>
      <Handle position={architectureTargetHandlePosition(direction)} type="target" />
      <ArchitectureGroupHeader>
        <ArchitectureNodeIcon
          aria-hidden="true"
          data-kind="group"
          data-source={icon.source}
          title={icon.title}
        >
          {IconComponent ? <IconComponent /> : icon.label}
        </ArchitectureNodeIcon>
        <ArchitectureGroupText>
          <strong>{text(data?.title, "Group")}</strong>
          <span>{text(data?.subtitle, architectureGroupIntentLabel(intent))}</span>
        </ArchitectureGroupText>
      </ArchitectureGroupHeader>
      <Handle position={architectureSourceHandlePosition(direction)} type="source" />
    </ArchitectureCanvasGroupShell>
  );
}

function architectureOrderFlowNodes(nodes) {
  const nodeList = jsonArray(nodes);
  const byId = new Map(nodeList.map((node) => [node.id, node]));
  const orderById = new Map(nodeList.map((node, index) => [node.id, index]));
  const childrenByParent = new Map();
  nodeList.forEach((node) => {
    const parentId = text(node?.parentId);
    const safeParentId = parentId && byId.has(parentId) ? parentId : "";
    if (!childrenByParent.has(safeParentId)) childrenByParent.set(safeParentId, []);
    childrenByParent.get(safeParentId).push(node);
  });

  const ordered = [];
  const seen = new Set();
  const visitChildren = (parentId) => {
    const children = [...(childrenByParent.get(parentId) || [])].sort((left, right) => {
      const leftGroup = left.type === "architectureGroup" ? 0 : 1;
      const rightGroup = right.type === "architectureGroup" ? 0 : 1;
      return leftGroup - rightGroup
        || (orderById.get(left.id) || 0) - (orderById.get(right.id) || 0);
    });
    children.forEach((child) => {
      if (seen.has(child.id)) return;
      seen.add(child.id);
      ordered.push(child);
      visitChildren(child.id);
    });
  };

  visitChildren("");
  nodeList.forEach((node) => {
    if (seen.has(node.id)) return;
    seen.add(node.id);
    ordered.push(node);
  });
  return ordered;
}

function architectureNodeSize(node) {
  const isGroup = node?.type === "architectureGroup";
  const compact = !isGroup && architectureIsCompactNode(node?.data || {});
  return {
    height: numberValue(
      node?.style?.height,
      isGroup ? 280 : compact ? ARCHITECTURE_NODE_COMPACT_HEIGHT : ARCHITECTURE_NODE_CARD_HEIGHT,
    ),
    width: numberValue(
      node?.style?.width,
      isGroup ? 460 : compact ? ARCHITECTURE_NODE_COMPACT_WIDTH : ARCHITECTURE_NODE_CARD_WIDTH,
    ),
  };
}

function architectureAbsoluteNodePosition(node, nodeById, cache) {
  const nodeId = text(node?.id);
  if (!nodeId) return { x: 0, y: 0 };
  if (cache.has(nodeId)) return cache.get(nodeId);
  const parentId = text(node?.parentId);
  const parentPosition = parentId && nodeById.has(parentId)
    ? architectureAbsoluteNodePosition(nodeById.get(parentId), nodeById, cache)
    : { x: 0, y: 0 };
  const position = {
    x: parentPosition.x + numberValue(node?.position?.x, 0),
    y: parentPosition.y + numberValue(node?.position?.y, 0),
  };
  cache.set(nodeId, position);
  return position;
}

function architectureNodeRect(node, nodeById, positionCache) {
  const position = architectureAbsoluteNodePosition(node, nodeById, positionCache);
  const size = architectureNodeSize(node);
  return {
    height: size.height,
    id: node.id,
    width: size.width,
    x: position.x,
    y: position.y,
  };
}

function architectureNodeHandlePoint(node, side, nodeById, positionCache) {
  const rect = architectureNodeRect(node, nodeById, positionCache);
  if (side === "left") return { x: rect.x, y: rect.y + rect.height / 2 };
  if (side === "right") return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
  if (side === "top") return { x: rect.x + rect.width / 2, y: rect.y };
  if (side === "bottom") return { x: rect.x + rect.width / 2, y: rect.y + rect.height };
  return { x: rect.x + rect.width, y: rect.y + rect.height / 2 };
}

function architectureEdgeRenderKey(edge, index = 0) {
  return text(edge?.id, `edge-${index}`);
}

function architectureEndpointFanOffset(index, count) {
  if (count <= 1) return 0;
  const offset = Math.round((index - (count - 1) / 2) * 18);
  return Math.max(-90, Math.min(90, offset));
}

function architectureEndpointFanOffsets(edges, nodeById = new Map(), positionCache = new Map()) {
  const bySource = new Map();
  const byTarget = new Map();
  const offsets = new Map();
  const addToGroup = (groupMap, key, entry) => {
    if (!key) return;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(entry);
  };

  // Cross-axis center of a node, picking the axis its handles fan along.
  const crossCenter = (nodeId, handleHint) => {
    const node = nodeById.get(nodeId);
    if (!node) return 0;
    const rect = architectureNodeRect(node, nodeById, positionCache);
    const side = architectureEdgeSide(handleHint || node.sourcePosition || node.targetPosition);
    return side === "left" || side === "right"
      ? rect.y + rect.height / 2
      : rect.x + rect.width / 2;
  };

  edges.forEach((edge, index) => {
    const key = architectureEdgeRenderKey(edge, index);
    offsets.set(key, { source: 0, target: 0 });
    const sourceNode = nodeById.get(text(edge.source));
    const targetNode = nodeById.get(text(edge.target));
    addToGroup(bySource, text(edge.source), {
      edge,
      index,
      key,
      sortKey: crossCenter(text(edge.target), sourceNode?.sourcePosition),
      tieId: text(edge.target),
    });
    addToGroup(byTarget, text(edge.target), {
      edge,
      index,
      key,
      sortKey: crossCenter(text(edge.source), targetNode?.targetPosition),
      tieId: text(edge.source),
    });
  });

  const assign = (groupMap, offsetKey) => {
    groupMap.forEach((items) => {
      const sorted = [...items].sort((left, right) => (
        left.sortKey - right.sortKey
          || left.tieId.localeCompare(right.tieId)
          || left.index - right.index
      ));
      sorted.forEach((item, index) => {
        const current = offsets.get(item.key) || { source: 0, target: 0 };
        current[offsetKey] = architectureEndpointFanOffset(index, sorted.length);
        offsets.set(item.key, current);
      });
    });
  };

  assign(bySource, "source");
  assign(byTarget, "target");
  return offsets;
}

function architectureRouteHashString(seed, value) {
  let hash = seed >>> 0;
  const raw = String(value ?? "");
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function architectureRouteHashNumber(seed, value) {
  return architectureRouteHashString(seed, Math.round(numberValue(value, 0)));
}

function architectureRectsRoutingHash(rects) {
  return jsonArray(rects).reduce((hash, rect) => {
    let nextHash = architectureRouteHashString(hash, rect?.id || "");
    nextHash = architectureRouteHashNumber(nextHash, rect?.x);
    nextHash = architectureRouteHashNumber(nextHash, rect?.y);
    nextHash = architectureRouteHashNumber(nextHash, rect?.width);
    nextHash = architectureRouteHashNumber(nextHash, rect?.height);
    return nextHash;
  }, 2166136261);
}

function architectureRouteCacheGet(routeCache, key) {
  if (!routeCache?.has?.(key)) return null;
  const routePoints = routeCache.get(key);
  routeCache.delete(key);
  routeCache.set(key, routePoints);
  return routePoints;
}

function architectureRouteCacheSet(routeCache, key, routePoints) {
  if (!routeCache?.set) return;
  routeCache.set(key, routePoints);
  while (routeCache.size > ARCHITECTURE_ROUTE_CACHE_MAX) {
    const firstKey = routeCache.keys().next().value;
    if (!firstKey) break;
    routeCache.delete(firstKey);
  }
}

function architectureEdgesWithRoutingData(edges, nodes, options = {}) {
  const routeCache = options.routeCache || null;
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const positionCache = new Map();
  const nodeRects = nodes
    .filter((node) => node.type !== "architectureGroup")
    .map((node) => architectureNodeRect(node, nodeById, positionCache));
  const groupHeaderRects = nodes
    .filter((node) => node.type === "architectureGroup")
    .map((node) => {
      const rect = architectureNodeRect(node, nodeById, positionCache);
      return {
        ...rect,
        height: 74,
        id: `${node.id}:header`,
      };
    });
  const obstacleRects = [...nodeRects, ...groupHeaderRects];
  const obstacleHash = architectureRectsRoutingHash(obstacleRects);
  const endpointFanOffsets = architectureEndpointFanOffsets(edges, nodeById, positionCache);

  const routedEdges = edges.map((edge, index) => {
    const sourceNode = nodeById.get(edge.source);
    const targetNode = nodeById.get(edge.target);
    const edgeKey = architectureEdgeRenderKey(edge, index);
    const data = {
      ...(edge.data || {}),
      avoidanceRects: obstacleRects,
    };
    if (!sourceNode || !targetNode) {
      return {
        ...edge,
        data,
      };
    }

    const sourceSide = architectureEdgeSide(sourceNode.sourcePosition);
    const targetSide = architectureEdgeSide(targetNode.targetPosition);
    const sourcePoint = architectureNodeHandlePoint(sourceNode, sourceSide, nodeById, positionCache);
    const targetPoint = architectureNodeHandlePoint(targetNode, targetSide, nodeById, positionCache);
    const edgeFan = endpointFanOffsets.get(edgeKey) || { source: 0, target: 0 };
    const routeKey = [
      edgeKey,
      edge.source,
      edge.target,
      sourceSide,
      targetSide,
      Math.round(sourcePoint.x),
      Math.round(sourcePoint.y),
      Math.round(targetPoint.x),
      Math.round(targetPoint.y),
      Math.round(edgeFan.source),
      Math.round(edgeFan.target),
      obstacleHash.toString(36),
    ].join("|");
    let routePoints = architectureRouteCacheGet(routeCache, routeKey);
    if (!routePoints) {
      routePoints = architectureOrthogonalEdgePoints({
        avoidanceRects: obstacleRects,
        edgeIndex: index,
        id: edge.id,
        sourceFanOffset: edgeFan.source,
        sourcePosition: sourceNode.sourcePosition,
        sourceX: sourcePoint.x,
        sourceY: sourcePoint.y,
        targetFanOffset: edgeFan.target,
        targetPosition: targetNode.targetPosition,
        targetX: targetPoint.x,
        targetY: targetPoint.y,
      });
      architectureRouteCacheSet(routeCache, routeKey, routePoints);
    }

    return {
      ...edge,
      data: {
        ...data,
        routePoints,
      },
    };
  });
  const allRouteSegments = routedEdges.flatMap((edge, index) => (
    architectureRouteSegments(jsonArray(edge.data?.routePoints)).map((segment) => ({
      ...segment,
      edgeId: architectureEdgeRenderKey(edge, index),
    }))
  ));
  const labelRects = [];
  return routedEdges.map((edge, index) => {
    const edgeKey = architectureEdgeRenderKey(edge, index);
    const label = text(edge.data?.label);
    const ownRouteSegments = allRouteSegments.filter((segment) => segment.edgeId === edgeKey);
    const otherRouteSegments = allRouteSegments.filter((segment) => segment.edgeId !== edgeKey);
    const labelPlacement = label
      ? architectureEdgeLabelPlacement(jsonArray(edge.data?.routePoints), {
        avoidanceRects: [...obstacleRects, ...labelRects],
        label,
        nodeAvoidanceRects: obstacleRects,
        ownRouteSegments,
        routeSegments: otherRouteSegments,
      })
      : null;
    if (labelPlacement) {
      labelRects.push({
        ...architectureLabelRect(
          labelPlacement,
          labelPlacement.width,
          ARCHITECTURE_EDGE_LABEL_HEIGHT,
        ),
        id: `${edgeKey}:label`,
      });
    }
    return {
      ...edge,
      data: {
        ...(edge.data || {}),
        labelAvoidanceSegments: allRouteSegments,
        labelPlacement,
      },
    };
  });
}

function architectureEdgeSide(position) {
  const normalized = String(position || "").toLowerCase();
  if (normalized.includes("left")) return "left";
  if (normalized.includes("right")) return "right";
  if (normalized.includes("top")) return "top";
  if (normalized.includes("bottom")) return "bottom";
  return "right";
}

function architectureEdgeOffsetPoint(x, y, side, distance) {
  if (side === "left") return { x: x - distance, y };
  if (side === "right") return { x: x + distance, y };
  if (side === "top") return { x, y: y - distance };
  if (side === "bottom") return { x, y: y + distance };
  return { x, y };
}

function architectureDedupEdgePoints(points) {
  return jsonArray(points).map((point) => ({
    x: Math.round(numberValue(point?.x, 0)),
    y: Math.round(numberValue(point?.y, 0)),
  })).filter((point, index, cleanPoints) => {
    if (!index) return true;
    const previous = cleanPoints[index - 1];
    return previous.x !== point.x || previous.y !== point.y;
  });
}

function architectureEdgeHashOffset(id) {
  const raw = text(id);
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) % 997;
  }
  return (hash % 5 - 2) * 6;
}

function architectureEdgeLaneOffsets(edgeIndex = 0, hashOffset = 0) {
  const nudge = ((edgeIndex % 3) - 1) * 4 + hashOffset;
  return [0, 28, -28, 56, -56, 84, -84, 112, -112, 140, -140]
    .map((offset) => offset + nudge);
}

function architectureSegmentIntersectsRect(start, end, rect, padding = ARCHITECTURE_ROUTE_NODE_CLEARANCE) {
  const left = rect.x - padding;
  const right = rect.x + rect.width + padding;
  const top = rect.y - padding;
  const bottom = rect.y + rect.height + padding;
  if (Math.round(start.x) === Math.round(end.x)) {
    const x = start.x;
    if (x < left || x > right) return false;
    return Math.max(start.y, end.y) >= top && Math.min(start.y, end.y) <= bottom;
  }
  if (Math.round(start.y) === Math.round(end.y)) {
    const y = start.y;
    if (y < top || y > bottom) return false;
    return Math.max(start.x, end.x) >= left && Math.min(start.x, end.x) <= right;
  }
  return false;
}

function architectureRouteSegment(start, end) {
  const x1 = Math.round(start.x);
  const y1 = Math.round(start.y);
  const x2 = Math.round(end.x);
  const y2 = Math.round(end.y);
  if (x1 === x2 && y1 !== y2) {
    return {
      orientation: "vertical",
      x: x1,
      y1: Math.min(y1, y2),
      y2: Math.max(y1, y2),
    };
  }
  if (y1 === y2 && x1 !== x2) {
    return {
      orientation: "horizontal",
      y: y1,
      x1: Math.min(x1, x2),
      x2: Math.max(x1, x2),
    };
  }
  return null;
}

function architectureRouteSegments(points) {
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const segment = architectureRouteSegment(points[index - 1], points[index]);
    if (segment) segments.push(segment);
  }
  return segments;
}

function architecturePointOnRouteSegment(point, segment) {
  if (!point || !segment) return false;
  const x = Math.round(numberValue(point.x, 0));
  const y = Math.round(numberValue(point.y, 0));
  if (segment.orientation === "vertical") {
    return x === segment.x && y >= segment.y1 && y <= segment.y2;
  }
  if (segment.orientation === "horizontal") {
    return y === segment.y && x >= segment.x1 && x <= segment.x2;
  }
  return false;
}

function architectureRouteSegmentIntersectionPoint(leftStart, leftEnd, rightStart, rightEnd) {
  const left = architectureRouteSegment(leftStart, leftEnd);
  const right = architectureRouteSegment(rightStart, rightEnd);
  if (!left || !right) return null;
  if (left.orientation !== right.orientation) {
    const vertical = left.orientation === "vertical" ? left : right;
    const horizontal = left.orientation === "horizontal" ? left : right;
    const point = { x: vertical.x, y: horizontal.y };
    return architecturePointOnRouteSegment(point, left) && architecturePointOnRouteSegment(point, right)
      ? point
      : null;
  }
  if (left.orientation === "vertical") {
    if (left.x !== right.x) return null;
    const overlapStart = Math.max(left.y1, right.y1);
    const overlapEnd = Math.min(left.y2, right.y2);
    if (overlapEnd <= overlapStart) return null;
    const candidates = [
      { x: left.x, y: overlapStart },
      { x: left.x, y: overlapEnd },
      leftStart,
      leftEnd,
      rightStart,
      rightEnd,
    ].filter((point) => architecturePointOnRouteSegment(point, left) && architecturePointOnRouteSegment(point, right));
    return candidates.sort((first, second) => (
      Math.abs(first.y - leftStart.y) - Math.abs(second.y - leftStart.y)
    ))[0] || null;
  }
  if (left.y !== right.y) return null;
  const overlapStart = Math.max(left.x1, right.x1);
  const overlapEnd = Math.min(left.x2, right.x2);
  if (overlapEnd <= overlapStart) return null;
  const candidates = [
    { x: overlapStart, y: left.y },
    { x: overlapEnd, y: left.y },
    leftStart,
    leftEnd,
    rightStart,
    rightEnd,
  ].filter((point) => architecturePointOnRouteSegment(point, left) && architecturePointOnRouteSegment(point, right));
  return candidates.sort((first, second) => (
    Math.abs(first.x - leftStart.x) - Math.abs(second.x - leftStart.x)
  ))[0] || null;
}

function architectureRemoveCollinearEdgePoints(points) {
  const deduped = architectureDedupEdgePoints(points);
  return deduped.filter((point, index) => {
    if (!index || index === deduped.length - 1) return true;
    const previous = deduped[index - 1];
    const next = deduped[index + 1];
    const vertical = previous.x === point.x && point.x === next.x;
    const horizontal = previous.y === point.y && point.y === next.y;
    return !vertical && !horizontal;
  });
}

function architecturePruneSelfIntersectingEdgePoints(points) {
  const cleanPoints = architectureRemoveCollinearEdgePoints(points);
  for (let leftIndex = 0; leftIndex < cleanPoints.length - 3; leftIndex += 1) {
    for (let rightIndex = leftIndex + 2; rightIndex < cleanPoints.length - 1; rightIndex += 1) {
      const intersection = architectureRouteSegmentIntersectionPoint(
        cleanPoints[leftIndex],
        cleanPoints[leftIndex + 1],
        cleanPoints[rightIndex],
        cleanPoints[rightIndex + 1],
      );
      if (!intersection) continue;
      const leftEndKey = architecturePointKey(cleanPoints[leftIndex + 1]);
      const rightStartKey = architecturePointKey(cleanPoints[rightIndex]);
      const intersectionKey = architecturePointKey(intersection);
      if (rightIndex === leftIndex + 1 && intersectionKey === leftEndKey) continue;
      if (intersectionKey === leftEndKey && intersectionKey === rightStartKey) continue;
      return architectureDedupEdgePoints([
        ...cleanPoints.slice(0, leftIndex + 1),
        intersection,
        ...cleanPoints.slice(rightIndex + 1),
      ]);
    }
  }
  return cleanPoints;
}

function architecturePointsSignature(points) {
  return architectureDedupEdgePoints(points)
    .map((point) => `${point.x},${point.y}`)
    .join("|");
}

function architectureSimplifyEdgePoints(points) {
  let cleanPoints = architectureDedupEdgePoints(points);
  for (let pass = 0; pass < 6; pass += 1) {
    const previousSignature = architecturePointsSignature(cleanPoints);
    cleanPoints = architecturePruneSelfIntersectingEdgePoints(cleanPoints);
    cleanPoints = architectureRemoveCollinearEdgePoints(cleanPoints);
    if (architecturePointsSignature(cleanPoints) === previousSignature) break;
  }
  return cleanPoints;
}

function architectureSegmentOverlapLength(left, right) {
  if (!left || !right || left.orientation !== right.orientation) return 0;
  if (left.orientation === "vertical") {
    if (Math.abs(left.x - right.x) > 1) return 0;
    return Math.max(0, Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1));
  }
  if (Math.abs(left.y - right.y) > 1) return 0;
  return Math.max(0, Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1));
}

function architectureSegmentsCross(left, right, epsilon = ARCHITECTURE_ROUTE_CROSSING_EPSILON) {
  if (!left || !right || left.orientation === right.orientation) return false;
  const vertical = left.orientation === "vertical" ? left : right;
  const horizontal = left.orientation === "horizontal" ? left : right;
  return vertical.x > horizontal.x1 + epsilon
    && vertical.x < horizontal.x2 - epsilon
    && horizontal.y > vertical.y1 + epsilon
    && horizontal.y < vertical.y2 - epsilon;
}

function architectureSegmentCloseOverlap(left, right, spacing = ARCHITECTURE_ROUTE_EDGE_CLEARANCE) {
  if (!left || !right || left.orientation !== right.orientation) {
    return { distance: Infinity, overlap: 0 };
  }
  if (left.orientation === "vertical") {
    const distance = Math.abs(left.x - right.x);
    if (distance > spacing) return { distance, overlap: 0 };
    return {
      distance,
      overlap: Math.max(0, Math.min(left.y2, right.y2) - Math.max(left.y1, right.y1)),
    };
  }
  const distance = Math.abs(left.y - right.y);
  if (distance > spacing) return { distance, overlap: 0 };
  return {
    distance,
    overlap: Math.max(0, Math.min(left.x2, right.x2) - Math.max(left.x1, right.x1)),
  };
}

function architectureRouteConflictPenalty(points, reservedSegments) {
  const segments = architectureRouteSegments(points);
  let penalty = 0;
  segments.forEach((segment, index) => {
    const nearEndpoint = index < 2 || index > segments.length - 3;
    reservedSegments.forEach((reservedSegment) => {
      const overlap = architectureSegmentOverlapLength(segment, reservedSegment);
      if (overlap > 0) {
        penalty += (nearEndpoint ? 4500 : 18000) + overlap * 180;
      } else {
        const closeOverlap = architectureSegmentCloseOverlap(segment, reservedSegment);
        if (closeOverlap.overlap > 0) {
          const closeness = Math.max(1, ARCHITECTURE_ROUTE_EDGE_CLEARANCE - closeOverlap.distance + 1);
          penalty += (nearEndpoint ? 1800 : 9000) + closeOverlap.overlap * closeness * 18;
        }
      }
      if (architectureSegmentsCross(segment, reservedSegment)) {
        penalty += nearEndpoint ? 4500 : 32000;
      }
    });
  });
  return penalty;
}

function architectureEdgePathLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.abs(points[index].x - points[index - 1].x)
      + Math.abs(points[index].y - points[index - 1].y);
  }
  return length;
}

function architectureEndpointBacktrackPenalty(points, sourceSide, targetSide, sourceX, targetX, sourceY, targetY) {
  const second = points[2] || points[1] || points[0];
  const beforeTarget = points.at(-3) || points.at(-2) || points.at(-1);
  let penalty = 0;
  if (sourceSide === "right" && second.x < sourceX) penalty += 2400;
  if (sourceSide === "left" && second.x > sourceX) penalty += 2400;
  if (sourceSide === "bottom" && second.y < sourceY) penalty += 2400;
  if (sourceSide === "top" && second.y > sourceY) penalty += 2400;
  if (targetSide === "left" && beforeTarget.x > targetX) penalty += 1600;
  if (targetSide === "right" && beforeTarget.x < targetX) penalty += 1600;
  if (targetSide === "top" && beforeTarget.y > targetY) penalty += 1600;
  if (targetSide === "bottom" && beforeTarget.y < targetY) penalty += 1600;
  return penalty;
}

function architectureScoreEdgePoints(
  points,
  rects,
  sourceSide,
  targetSide,
  sourceX,
  targetX,
  sourceY,
  targetY,
  reservedSegments = [],
) {
  let collisions = 0;
  for (let index = 1; index < points.length; index += 1) {
    rects.forEach((rect) => {
      if (architectureSegmentIntersectsRect(points[index - 1], points[index], rect)) {
        collisions += 1;
      }
    });
  }
  return collisions * 10000
    + architectureRouteConflictPenalty(points, reservedSegments)
    + architectureEndpointBacktrackPenalty(points, sourceSide, targetSide, sourceX, targetX, sourceY, targetY)
    + architectureEdgePathLength(points);
}

function architectureEdgeBounds(sourceX, sourceY, targetX, targetY, rects) {
  const xs = [sourceX, targetX];
  const ys = [sourceY, targetY];
  rects.forEach((rect) => {
    xs.push(rect.x, rect.x + rect.width);
    ys.push(rect.y, rect.y + rect.height);
  });
  return {
    bottom: Math.max(...ys),
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
  };
}

function architectureEdgeFanPoint(point, side, fanOffset) {
  if (side === "left" || side === "right") {
    return { x: point.x, y: point.y + fanOffset };
  }
  if (side === "top" || side === "bottom") {
    return { x: point.x + fanOffset, y: point.y };
  }
  return point;
}

function architectureSourceRoutePoints(x, y, side, fanOffset, stubDistance) {
  const start = { x, y };
  const portStub = architectureEdgeOffsetPoint(x, y, side, 12);
  const fanPoint = architectureEdgeFanPoint(portStub, side, fanOffset);
  const stub = architectureEdgeOffsetPoint(fanPoint.x, fanPoint.y, side, stubDistance);
  return {
    points: [start, portStub, fanPoint, stub],
    stub,
  };
}

function architectureTargetRoutePoints(x, y, side, fanOffset, stubDistance) {
  const end = { x, y };
  const portStub = architectureEdgeOffsetPoint(x, y, side, 12);
  const fanPoint = architectureEdgeFanPoint(portStub, side, fanOffset);
  const stub = architectureEdgeOffsetPoint(fanPoint.x, fanPoint.y, side, stubDistance);
  return {
    points: [stub, fanPoint, portStub, end],
    stub,
  };
}

function architecturePointKey(point) {
  return `${Math.round(numberValue(point?.x, 0))},${Math.round(numberValue(point?.y, 0))}`;
}

function architectureOrthogonalEdgePoints({
  avoidanceRects = [],
  edgeIndex = 0,
  id,
  reservedSegments = [],
  sourceFanOffset = 0,
  sourcePosition,
  sourceX,
  sourceY,
  targetFanOffset = 0,
  targetPosition,
  targetX,
  targetY,
}) {
  const sourceSide = architectureEdgeSide(sourcePosition);
  const targetSide = architectureEdgeSide(targetPosition);
  const horizontal = sourceSide === "left"
    || sourceSide === "right"
    || targetSide === "left"
    || targetSide === "right";
  const offset = ARCHITECTURE_ROUTE_ENDPOINT_STUB;
  const bendOffset = architectureEdgeHashOffset(id);
  const sourceRoute = architectureSourceRoutePoints(sourceX, sourceY, sourceSide, sourceFanOffset, offset);
  const targetRoute = architectureTargetRoutePoints(targetX, targetY, targetSide, targetFanOffset, offset);
  const sourceStub = sourceRoute.stub;
  const targetStub = targetRoute.stub;
  const rects = jsonArray(avoidanceRects).filter((rect) => text(rect?.id) !== text(id));
  const bounds = architectureEdgeBounds(sourceX, sourceY, targetX, targetY, rects);
  const outsideOffset = 76 + Math.abs(bendOffset);
  const leftLane = bounds.left - outsideOffset;
  const rightLane = bounds.right + outsideOffset;
  const topLane = bounds.top - outsideOffset;
  const bottomLane = bounds.bottom + outsideOffset;
  const laneOffsets = architectureEdgeLaneOffsets(edgeIndex, bendOffset);
  const candidates = [];
  const pushCandidate = (middlePoints) => {
    candidates.push(architectureDedupEdgePoints([
      ...sourceRoute.points,
      ...middlePoints,
      ...targetRoute.points,
    ]));
  };

  if (horizontal) {
    laneOffsets.forEach((laneOffset) => {
      const midX = Math.round((sourceStub.x + targetStub.x) / 2 + laneOffset);
      pushCandidate([
        { x: midX, y: sourceStub.y },
        { x: midX, y: targetStub.y },
      ]);
    });
    laneOffsets.forEach((laneOffset) => {
      [leftLane - Math.abs(laneOffset), rightLane + Math.abs(laneOffset)].forEach((laneX) => {
        pushCandidate([
          { x: laneX, y: sourceStub.y },
          { x: laneX, y: targetStub.y },
        ]);
      });
      [topLane - Math.abs(laneOffset), bottomLane + Math.abs(laneOffset)].forEach((laneY) => {
        pushCandidate([
          { x: sourceStub.x, y: laneY },
          { x: targetStub.x, y: laneY },
        ]);
      });
    });
  } else {
    laneOffsets.forEach((laneOffset) => {
      const midY = Math.round((sourceStub.y + targetStub.y) / 2 + laneOffset);
      pushCandidate([
        { x: sourceStub.x, y: midY },
        { x: targetStub.x, y: midY },
      ]);
    });
    laneOffsets.forEach((laneOffset) => {
      [topLane - Math.abs(laneOffset), bottomLane + Math.abs(laneOffset)].forEach((laneY) => {
        pushCandidate([
          { x: sourceStub.x, y: laneY },
          { x: targetStub.x, y: laneY },
        ]);
      });
      [leftLane - Math.abs(laneOffset), rightLane + Math.abs(laneOffset)].forEach((laneX) => {
        pushCandidate([
          { x: laneX, y: sourceStub.y },
          { x: laneX, y: targetStub.y },
        ]);
      });
    });
  }

  return candidates
    .sort((left, right) => (
      architectureScoreEdgePoints(left, rects, sourceSide, targetSide, sourceX, targetX, sourceY, targetY, reservedSegments)
        - architectureScoreEdgePoints(right, rects, sourceSide, targetSide, sourceX, targetX, sourceY, targetY, reservedSegments)
    ))[0] || [
    { x: sourceX, y: sourceY },
    { x: targetX, y: targetY },
  ];
}

function architecturePointTowardPoint(from, to, distance) {
  const xDelta = Math.round(numberValue(to?.x, 0)) - Math.round(numberValue(from?.x, 0));
  const yDelta = Math.round(numberValue(to?.y, 0)) - Math.round(numberValue(from?.y, 0));
  if (xDelta !== 0) {
    return {
      x: Math.round(numberValue(from?.x, 0)) + Math.sign(xDelta) * distance,
      y: Math.round(numberValue(from?.y, 0)),
    };
  }
  if (yDelta !== 0) {
    return {
      x: Math.round(numberValue(from?.x, 0)),
      y: Math.round(numberValue(from?.y, 0)) + Math.sign(yDelta) * distance,
    };
  }
  return {
    x: Math.round(numberValue(from?.x, 0)),
    y: Math.round(numberValue(from?.y, 0)),
  };
}

function architectureEdgePathFromPoints(points) {
  const cleanPoints = architectureSimplifyEdgePoints(points);
  if (!cleanPoints.length) return "";
  if (cleanPoints.length === 1) return `M ${cleanPoints[0].x} ${cleanPoints[0].y}`;
  const commands = [`M ${cleanPoints[0].x} ${cleanPoints[0].y}`];
  const cornerRadius = 14;
  for (let index = 1; index < cleanPoints.length - 1; index += 1) {
    const previous = cleanPoints[index - 1];
    const point = cleanPoints[index];
    const next = cleanPoints[index + 1];
    const previousLength = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
    const nextLength = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
    const isCorner = (previous.x === point.x || previous.y === point.y)
      && (point.x === next.x || point.y === next.y)
      && !((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y));
    const radius = Math.min(cornerRadius, Math.floor(previousLength / 2), Math.floor(nextLength / 2));
    if (!isCorner || radius < 3) {
      commands.push(`L ${point.x} ${point.y}`);
      continue;
    }
    const beforeCorner = architecturePointTowardPoint(point, previous, radius);
    const afterCorner = architecturePointTowardPoint(point, next, radius);
    commands.push(`L ${beforeCorner.x} ${beforeCorner.y}`);
    commands.push(`Q ${point.x} ${point.y} ${afterCorner.x} ${afterCorner.y}`);
  }
  const lastPoint = cleanPoints.at(-1);
  commands.push(`L ${lastPoint.x} ${lastPoint.y}`);
  return commands.join(" ");
}

function architectureLabelRect(center, width, height) {
  return {
    height,
    width,
    x: Math.round(numberValue(center?.x, 0) - width / 2),
    y: Math.round(numberValue(center?.y, 0) - height / 2),
  };
}

function architectureRectsOverlap(left, right, padding = 0) {
  if (!left || !right) return false;
  return left.x - padding < right.x + right.width
    && left.x + left.width + padding > right.x
    && left.y - padding < right.y + right.height
    && left.y + left.height + padding > right.y;
}

function architectureSegmentIntersectsLabelRect(segment, rect, padding = 0) {
  if (!segment || !rect) return false;
  const left = rect.x - padding;
  const right = rect.x + rect.width + padding;
  const top = rect.y - padding;
  const bottom = rect.y + rect.height + padding;
  if (segment.orientation === "vertical") {
    return segment.x >= left
      && segment.x <= right
      && segment.y2 >= top
      && segment.y1 <= bottom;
  }
  if (segment.orientation === "horizontal") {
    return segment.y >= top
      && segment.y <= bottom
      && segment.x2 >= left
      && segment.x1 <= right;
  }
  return false;
}

function architectureEdgeLabelSize(label) {
  const raw = text(label);
  return {
    height: ARCHITECTURE_EDGE_LABEL_HEIGHT,
    width: Math.round(clampNumber(
      raw.length * 6.2 + 24,
      ARCHITECTURE_EDGE_LABEL_MIN_WIDTH,
      ARCHITECTURE_EDGE_LABEL_MAX_WIDTH,
    )),
  };
}

function architecturePointAlongAxisSegment(start, end, distance) {
  const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
  if (!length) return { x: Math.round(start.x), y: Math.round(start.y) };
  const ratio = clampNumber(distance / length, 0, 1);
  return {
    x: Math.round(start.x + (end.x - start.x) * ratio),
    y: Math.round(start.y + (end.y - start.y) * ratio),
  };
}

function architectureEdgeLabelCollisionScore(
  rect,
  routeSegments,
  avoidanceRects,
  ownRouteSegments = [],
  nodeAvoidanceRects = [],
) {
  if (jsonArray(nodeAvoidanceRects).some((obstacle) => (
    architectureRectsOverlap(rect, obstacle, ARCHITECTURE_EDGE_LABEL_NODE_REJECT_PADDING)
  ))) {
    return Infinity;
  }

  let score = 0;
  jsonArray(avoidanceRects).forEach((obstacle) => {
    if (architectureRectsOverlap(rect, obstacle, ARCHITECTURE_EDGE_LABEL_NODE_PADDING)) {
      score += 260000;
    } else if (architectureRectsOverlap(rect, obstacle, ARCHITECTURE_EDGE_LABEL_NODE_PADDING + 16)) {
      score += 12000;
    }
  });
  jsonArray(routeSegments).forEach((segment) => {
    if (architectureSegmentIntersectsLabelRect(segment, rect, ARCHITECTURE_EDGE_LABEL_ROUTE_PADDING)) {
      score += 90000;
    } else if (architectureSegmentIntersectsLabelRect(segment, rect, ARCHITECTURE_EDGE_LABEL_ROUTE_PADDING + 12)) {
      score += 9000;
    }
  });
  jsonArray(ownRouteSegments).forEach((segment) => {
    if (architectureSegmentIntersectsLabelRect(segment, rect, ARCHITECTURE_EDGE_LABEL_OWN_ROUTE_PADDING)) {
      score += 14000;
    } else if (architectureSegmentIntersectsLabelRect(segment, rect, ARCHITECTURE_EDGE_LABEL_OWN_ROUTE_PADDING + 4)) {
      score += 700;
    }
  });
  return score;
}

function architectureEdgeLabelFallbackPoint(points) {
  const cleanPoints = architectureSimplifyEdgePoints(points);
  let bestStart = cleanPoints[0] || { x: 0, y: 0 };
  let bestEnd = cleanPoints[1] || bestStart;
  let bestLength = -1;
  for (let index = 1; index < cleanPoints.length; index += 1) {
    const nearEndpoint = index <= 2 || index >= cleanPoints.length - 2;
    const start = cleanPoints[index - 1];
    const end = cleanPoints[index];
    const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (!nearEndpoint && length > bestLength) {
      bestStart = start;
      bestEnd = end;
      bestLength = length;
    }
  }
  if (bestLength < 0) {
    const labelSegmentIndex = Math.max(0, Math.min(cleanPoints.length - 2, Math.floor((cleanPoints.length - 1) / 2)));
    bestStart = cleanPoints[labelSegmentIndex] || bestStart;
    bestEnd = cleanPoints[labelSegmentIndex + 1] || bestStart;
  }
  return {
    x: Math.round((bestStart.x + bestEnd.x) / 2),
    y: Math.round((bestStart.y + bestEnd.y) / 2),
  };
}

function architectureEdgeLabelPlacement(points, options = {}) {
  const cleanPoints = architectureSimplifyEdgePoints(points);
  const labelSize = architectureEdgeLabelSize(options.label);
  const nodeAvoidanceRects = jsonArray(options.nodeAvoidanceRects);
  const ownRouteSegments = jsonArray(options.ownRouteSegments);
  const routeSegments = jsonArray(options.routeSegments);
  const avoidanceRects = jsonArray(options.avoidanceRects);
  let bestCandidate = null;
  let routeLength = 0;
  const segmentEntries = [];

  for (let index = 1; index < cleanPoints.length; index += 1) {
    const start = cleanPoints[index - 1];
    const end = cleanPoints[index];
    const horizontal = start.y === end.y;
    const vertical = start.x === end.x;
    if (!horizontal && !vertical) continue;
    const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (length <= 0) continue;

    segmentEntries.push({
      end,
      horizontal,
      index,
      length,
      pathStart: routeLength,
      start,
      vertical,
    });
    routeLength += length;
  }

  segmentEntries.forEach((entry) => {
    const { end, horizontal, index, length, pathStart, start } = entry;

    const nearEndpoint = index <= 2 || index >= cleanPoints.length - 2;
    const inset = Math.min(
      ARCHITECTURE_EDGE_LABEL_ENDPOINT_GAP,
      Math.max(0, Math.floor(length / 2) - 1),
    );
    const distances = [...new Set([0.5, 0.36, 0.64, 0.24, 0.76].map((ratio) => (
      Math.round(clampNumber(length * ratio, inset, Math.max(inset, length - inset)))
    )))];
    const offsetDistances = [
      ARCHITECTURE_EDGE_LABEL_OFFSET,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 4,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 9,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 18,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 30,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 44,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 64,
      ARCHITECTURE_EDGE_LABEL_OFFSET + 88,
    ];
    const sideOrder = index % 2 ? [-1, 1] : [1, -1];

    distances.forEach((distance) => {
      const basePoint = architecturePointAlongAxisSegment(start, end, distance);
      offsetDistances.forEach((offsetDistance) => {
        sideOrder.forEach((side) => {
          const center = horizontal
            ? { x: basePoint.x, y: basePoint.y + side * offsetDistance }
            : { x: basePoint.x + side * offsetDistance, y: basePoint.y };
          const rect = architectureLabelRect(center, labelSize.width, labelSize.height);
          const endpointGap = Math.min(distance, length - distance);
          const pathDistance = pathStart + distance;
          const score = architectureEdgeLabelCollisionScore(
            rect,
            routeSegments,
            avoidanceRects,
            ownRouteSegments,
            nodeAvoidanceRects,
          )
            + (horizontal ? 0 : 18000)
            + (nearEndpoint ? 3200 : 0)
            + Math.max(0, ARCHITECTURE_EDGE_LABEL_ENDPOINT_GAP - endpointGap) * 70
            + Math.max(0, labelSize.width + 28 - length) * 120
            + Math.abs(distance - length / 2) * 5
            + Math.abs(pathDistance - routeLength / 2) * 4
            + Math.abs(index - cleanPoints.length / 2) * 120
            + (offsetDistance - ARCHITECTURE_EDGE_LABEL_OFFSET) * 180
            - Math.min(length, 220) * 2;
          if (Number.isFinite(score) && (!bestCandidate || score < bestCandidate.score)) {
            bestCandidate = {
              center,
              orientation: horizontal ? "horizontal" : "vertical",
              score,
            };
          }
        });
      });
    });
  });
  const fallback = architectureEdgeLabelFallbackPoint(cleanPoints);
  const fallbackBlocked = Boolean(
    !bestCandidate
    && nodeAvoidanceRects.length
    && jsonArray(nodeAvoidanceRects).some((obstacle) => (
      architectureRectsOverlap(
        architectureLabelRect(fallback, labelSize.width, labelSize.height),
        obstacle,
        ARCHITECTURE_EDGE_LABEL_NODE_REJECT_PADDING,
      )
    )),
  );
  return {
    hidden: fallbackBlocked,
    orientation: bestCandidate?.orientation || "horizontal",
    width: labelSize.width,
    x: Math.round(bestCandidate?.center?.x ?? fallback.x),
    y: Math.round(bestCandidate?.center?.y ?? fallback.y),
  };
}

function architectureOrthogonalEdgePath({
  avoidanceRects = [],
  id,
  label = "",
  labelAvoidanceSegments = [],
  labelPlacement: providedLabelPlacement = null,
  routePoints = [],
  sourcePosition,
  sourceX,
  sourceY,
  targetPosition,
  targetX,
  targetY,
}) {
  const cleanPoints = jsonArray(routePoints).length >= 2
    ? architectureDedupEdgePoints(routePoints)
    : architectureOrthogonalEdgePoints({
      avoidanceRects,
      id,
      sourcePosition,
      sourceX,
      sourceY,
      targetPosition,
      targetX,
      targetY,
    });
  const labelPlacement = providedLabelPlacement || architectureEdgeLabelPlacement(cleanPoints, {
    avoidanceRects,
    label,
    routeSegments: labelAvoidanceSegments,
  });
  return [
    architectureEdgePathFromPoints(cleanPoints),
    labelPlacement.x,
    labelPlacement.y,
    labelPlacement,
  ];
}

function readForgeThemeMode() {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.forgeTheme === "light" ? "light" : "dark";
}

function useForgeThemeMode() {
  const [mode, setMode] = useState(readForgeThemeMode);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const el = document.documentElement;
    const sync = () => setMode(readForgeThemeMode());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributeFilter: ["data-forge-theme"] });
    return () => observer.disconnect();
  }, []);
  return mode;
}

function architectureEdgeStrokeColor(role, selected = false, mode = "dark") {
  const light = mode === "light";
  if (selected) return light ? "#b45309" : "rgba(251, 191, 36, 0.95)";
  const edgeRole = architectureEdgeRole(role);
  // Neutral-first: only high-signal semantics carry color; calls / resolves-to
  // / render / reads stay neutral gray so the canvas reads calm and accurate.
  if (edgeRole === "writes" || edgeRole === "publishes") return light ? "#057a55" : "rgba(52, 211, 153, 0.85)";
  if (edgeRole === "transitions" || edgeRole === "guards") return light ? "#6d28d9" : "rgba(167, 139, 250, 0.88)";
  if (edgeRole === "depends-on") return light ? "#be185d" : "rgba(244, 114, 182, 0.82)";
  if (edgeRole === "fails-to" || edgeRole === "retries") return light ? "#be123c" : "rgba(248, 113, 113, 0.88)";
  return light ? "#6b7280" : "rgba(148, 163, 184, 0.5)";
}

function architectureMiniMapNodeColor(node) {
  if (node?.type === "architectureGroup") return "rgba(148, 163, 184, 0.5)";
  const kind = text(node?.data?.kind);
  const role = architectureNodeRole(node?.data?.role || kind);
  if (kind === "database") return "rgb(52, 211, 153)";
  if (kind === "queue" || role === "state") return "rgb(167, 139, 250)";
  if (kind === "client" || role === "decision" || role === "actor") return "rgb(251, 191, 36)";
  if (kind === "external" || role === "dependency" || role === "package") return "rgb(244, 114, 182)";
  if (role === "terminal") return "rgb(248, 113, 113)";
  return "rgb(96, 165, 250)";
}

function architectureEdgeStrokeDash(role, kind = "") {
  const edgeRole = architectureEdgeRole(role || kind);
  if (edgeRole === "depends-on" || kind === "depends") return "7 5";
  if (edgeRole === "subscribes" || edgeRole === "guards") return "2 6";
  if (edgeRole === "retries") return "5 4 1 4";
  return "0";
}

function ArchitectureCanvasEdge({
  data,
  id,
  markerEnd,
  selected,
  sourcePosition,
  sourceX,
  sourceY,
  targetPosition,
  targetX,
  targetY,
}) {
  const kind = text(data?.kind, "calls");
  const role = architectureEdgeRole(data?.role || kind);
  const label = text(data?.label);
  const colorMode = data?.colorMode === "light" ? "light" : "dark";
  const dimmed = Boolean(data?.dimmed);
  const focused = Boolean(data?.focused);
  const focusActive = Boolean(data?.focusActive);
  // resolves-to is the high-volume "routing table" fan; calm it at rest.
  const isRoutingRole = role === "resolves-to";
  const strokeWidth = dimmed
    ? 1
    : focused || selected
      ? 3
      : isRoutingRole
        ? 1.4
        : 1.9;
  const [edgePath, labelX, labelY, labelPlacement] = architectureOrthogonalEdgePath({
    avoidanceRects: data?.avoidanceRects,
    id,
    label,
    labelAvoidanceSegments: data?.labelAvoidanceSegments,
    labelPlacement: data?.labelPlacement,
    routePoints: data?.routePoints,
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  });
  // Labels: never on dimmed edges; at rest hide the routing-fan noise; on
  // focus only the selected node's edges show their labels.
  const showLabel = Boolean(label)
    && !labelPlacement?.hidden
    && !dimmed
    && (focusActive ? focused : !isRoutingRole);

  return (
    <>
      <BaseEdge
        id={id}
        markerEnd={markerEnd}
        path={edgePath}
        style={{
          stroke: architectureEdgeStrokeColor(role, selected, colorMode),
          strokeDasharray: architectureEdgeStrokeDash(role, kind),
          strokeLinecap: "round",
          strokeLinejoin: "round",
          strokeWidth,
        }}
      />
      {showLabel && (
        <EdgeLabelRenderer>
          <ArchitectureEdgeLabel
            data-kind={role}
            data-orientation={labelPlacement?.orientation || "horizontal"}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              "--edge-label-max-width": `${labelPlacement?.width || ARCHITECTURE_EDGE_LABEL_MAX_WIDTH}px`,
            }}
          >
            {label}
          </ArchitectureEdgeLabel>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const TODO_HISTORY_CONTROL_EVENT = "diffforge:todo-history-control";
const TODO_HISTORY_CONTROL_RESULT_EVENT = "diffforge:todo-history-control-result";
const TODO_HISTORY_FINISHED_STATUSES = new Set([
  "completed",
  "cancelled",
  "interrupted",
  "failed",
  "timed-out",
  "deleted",
]);
const TODO_HISTORY_GROUP_ORDER = [
  { hint: "Active in a terminal right now", id: "running", label: "Running" },
  { hint: "Waiting for a free terminal", id: "queued", label: "Queued" },
  { hint: "On the list, not queued yet", id: "listed", label: "Listed" },
  { hint: "Completed, cancelled, or interrupted", id: "finished", label: "Finished" },
];

function todoHistoryGroupId(item) {
  const status = text(item?.status);
  if (status === "running" || status === "paused") return "running";
  if (status === "queued") return "queued";
  if (TODO_HISTORY_FINISHED_STATUSES.has(status)) return "finished";
  return "listed";
}

function todoTargetSelectPortal() {
  return typeof document === "undefined" ? undefined : document.body;
}

function todoTargetColorAlpha(hex, alpha) {
  const value = String(hex || "").trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) {
    return `rgba(148, 163, 184, ${alpha})`;
  }
  const r = Number.parseInt(value.slice(1, 3), 16);
  const g = Number.parseInt(value.slice(3, 5), 16);
  const b = Number.parseInt(value.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TODO_TARGET_SELECT_STYLES = {
  container: (base) => ({ ...base, flex: "0 1 auto", minWidth: 126, maxWidth: 188 }),
  control: (base, state) => {
    const accent = state.getValue()?.[0]?.color || "";
    return {
      ...base,
      minHeight: 26,
      height: 26,
      borderRadius: 7,
      borderColor: accent
        ? todoTargetColorAlpha(accent, state.isFocused ? 0.68 : 0.4)
        : state.isFocused
          ? "rgba(var(--forge-accent-soft-rgb), 0.44)"
          : "rgba(148, 163, 184, 0.24)",
      backgroundColor: "rgba(2, 6, 23, 0.85)",
      boxShadow: state.isFocused ? `0 0 0 3px ${todoTargetColorAlpha(accent, 0.14)}` : "none",
      cursor: "pointer",
      transition: "border-color 140ms ease, box-shadow 140ms ease",
    };
  },
  valueContainer: (base) => ({ ...base, padding: "0 2px 0 8px", flexWrap: "nowrap" }),
  singleValue: (base) => ({
    ...base,
    display: "flex",
    minWidth: 0,
    margin: 0,
    color: "rgba(226, 232, 240, 0.95)",
    fontSize: 10.5,
    fontWeight: 760,
  }),
  input: (base) => ({ ...base, margin: 0, padding: 0, color: "transparent" }),
  indicatorSeparator: () => ({ display: "none" }),
  dropdownIndicator: (base, state) => ({
    ...base,
    padding: "0 6px 0 2px",
    color: state.isFocused ? "rgba(226, 232, 240, 0.9)" : "rgba(148, 163, 184, 0.8)",
    transform: state.selectProps.menuIsOpen ? "rotate(180deg)" : "none",
    transition: "transform 160ms ease",
    svg: { width: 14, height: 14 },
  }),
  menuPortal: (base) => ({ ...base, zIndex: 9999 }),
  menu: (base) => ({
    ...base,
    minWidth: 172,
    overflow: "hidden",
    border: "1px solid rgba(148, 163, 184, 0.22)",
    borderRadius: 9,
    backgroundColor: "rgba(10, 14, 24, 0.98)",
    boxShadow: "0 16px 36px rgba(0, 0, 0, 0.45)",
  }),
  menuList: (base) => ({ ...base, padding: 4 }),
  option: (base, state) => ({
    ...base,
    display: "flex",
    alignItems: "center",
    borderRadius: 6,
    padding: "6px 8px",
    color: state.isSelected ? "rgba(240, 244, 255, 0.98)" : "rgba(203, 213, 225, 0.92)",
    backgroundColor: state.isSelected
      ? (state.data?.color ? todoTargetColorAlpha(state.data.color, 0.2) : "rgba(var(--forge-accent-rgb), 0.18)")
      : state.isFocused
        ? "rgba(148, 163, 184, 0.12)"
        : "transparent",
    fontSize: 11,
    fontWeight: 760,
    cursor: "pointer",
  }),
};

const TodoTargetOptionLabel = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-width: 0;

  i {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 999px;
    background: var(--todo-target-dot, rgba(148, 163, 184, 0.5));
  }

  &[data-any="true"] i {
    background: transparent;
    border: 1.5px solid rgba(148, 163, 184, 0.55);
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const TodoTargetSelectShell = styled.span`
  display: inline-flex;
  min-width: 0;
`;

function todoTargetOptionLabelRenderer(option) {
  return (
    <TodoTargetOptionLabel
      data-any={option.value === "" ? "true" : "false"}
      style={option.color ? { "--todo-target-dot": option.color } : undefined}
    >
      <i aria-hidden="true" />
      <span>{option.label}</span>
    </TodoTargetOptionLabel>
  );
}

function TodoHistoryTargetSelect({ item, onSelect, terminalOptions = [], value }) {
  const options = useMemo(() => [
    { color: "", label: "Any terminal", value: "" },
    ...terminalOptions.map((terminal) => ({
      color: sanitizeTerminalColor(terminal.color, terminal.terminalIndex),
      label: terminal.label,
      value: String(terminal.terminalIndex),
    })),
  ], [terminalOptions]);
  const selected = options.find((option) => option.value === String(value ?? "")) || options[0];
  return (
    <TodoTargetSelectShell
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <Select
        aria-label="Todo target terminal"
        formatOptionLabel={todoTargetOptionLabelRenderer}
        isSearchable={false}
        menuPortalTarget={todoTargetSelectPortal()}
        onChange={(option) => onSelect(item, option?.value ?? "")}
        options={options}
        styles={TODO_TARGET_SELECT_STYLES}
        value={selected}
      />
    </TodoTargetSelectShell>
  );
}

function sessionHistoryAgentKey(item) {
  const raw = text(item?.agentId || item?.agent_id || item?.provider || item?.agentKind || item?.agent_kind).toLowerCase();
  if (raw.includes("claude")) return "claude";
  if (raw.includes("opencode") || raw.includes("open-code")) return "opencode";
  if (raw.includes("codex") || raw.includes("openai") || raw.includes("open-ai")) return "codex";
  return raw || "terminal";
}

function sessionHistoryAgentLabel(item) {
  switch (sessionHistoryAgentKey(item)) {
    case "claude":
      return "Claude Code";
    case "opencode":
      return "OpenCode";
    case "codex":
      return "OpenAI Codex";
    default:
      return text(item?.provider || item?.agentId || item?.agent_id, "Coding agent");
  }
}

function sessionHistoryModelLabel(item) {
  return text(item?.modelId || item?.model_id, "Unknown model");
}

function sessionHistoryStatusKind(item) {
  const raw = text(item?.status).toLowerCase();
  if (["idle", "ready", "done", "complete", "completed", "finished"].includes(raw)) return "done";
  if (["running", "thinking", "busy", "active", "starting", "initializing", "warming"].includes(raw)) return "active";
  if (["queued", "pending"].includes(raw)) return "queued";
  if (["error", "failed", "crashed"].includes(raw)) return "blocked";
  return "parked";
}

function sessionHistoryStatusLabel(item) {
  const raw = text(item?.status);
  if (!raw) return "Recorded";
  return raw
    .split(/[-_\s]+/u)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function sessionHistoryTitle(item) {
  return text(
    item?.firstUserMessage
      || item?.first_user_message
      || item?.initialUserMessage
      || item?.initial_user_message
      || item?.promptPreview
      || item?.prompt_preview
      || item?.title
      || item?.sessionTitle
      || item?.session_title
      || item?.providerSessionId
      || item?.provider_session_id
      || item?.nativeSessionId
      || item?.native_session_id
      || item?.threadId
      || item?.thread_id,
    sessionHistoryAgentLabel(item),
  );
}

function sessionHistorySearchFields(item) {
  return [
    sessionHistoryTitle(item),
    item?.firstUserMessage,
    item?.first_user_message,
    sessionHistoryAgentLabel(item),
    sessionHistoryAgentKey(item),
    sessionHistoryModelLabel(item),
    item?.modelSource,
    item?.model_source,
    item?.sessionMode,
    item?.session_mode,
    item?.fileAuthority,
    item?.file_authority,
    item?.coordinationMode,
    item?.coordination_mode,
    sessionHistoryStatusLabel(item),
    item?.status,
    item?.title,
    item?.sessionTitle,
    item?.session_title,
    item?.provider,
    item?.agentId,
    item?.agent_id,
    item?.providerSessionId,
    item?.provider_session_id,
    item?.nativeSessionId,
    item?.native_session_id,
    item?.forkFromProviderSessionId,
    item?.fork_from_provider_session_id,
    item?.sharedHistoryId,
    item?.shared_history_id,
    item?.chatSync?.status,
    item?.chatSync?.label,
    item?.chat_sync?.status,
    item?.chat_sync?.label,
    item?.threadId,
    item?.thread_id,
    item?.source,
    item?.cwd,
    item?.workspaceName,
    item?.workspace_name,
  ]
    .map((value) => text(value).toLowerCase())
    .filter(Boolean);
}

function sessionHistoryMatchesSearch(item, query) {
  const terms = text(query)
    .toLowerCase()
    .split(/\s+/u)
    .filter(Boolean);
  if (!terms.length) return true;
  const fields = sessionHistorySearchFields(item);
  const haystack = fields.join("\n");
  return terms.every((term) => haystack.includes(term) || fields.some((field) => field.startsWith(term)));
}

function sessionHistoryRowKey(item, index = 0) {
  return text(
    item?.id
      || [
        item?.workspaceId || item?.workspace_id,
        sessionHistoryAgentKey(item),
        item?.providerSessionId || item?.provider_session_id || item?.nativeSessionId || item?.native_session_id,
        item?.createdAtMs || item?.created_at_ms,
        item?.latestAtMs || item?.latest_at_ms,
      ].map((part) => text(part)).filter(Boolean).join(":"),
    `session-${index}`,
  );
}

function sessionHistoryPrimarySessionValues(value) {
  const values = [
    value?.providerSessionId,
    value?.provider_session_id,
    value?.nativeSessionId,
    value?.native_session_id,
    value?.currentProviderSessionId,
    value?.current_provider_session_id,
    value?.currentNativeSessionId,
    value?.current_native_session_id,
    value?.transcriptSessionId,
    value?.transcript_session_id,
    value?.sessionId,
    value?.session_id,
  ];
  const flattened = [];
  const append = (entry) => {
    if (Array.isArray(entry)) {
      entry.forEach(append);
      return;
    }
    const cleaned = text(entry);
    if (cleaned) {
      cleaned.split(",").map((item) => text(item)).filter(Boolean).forEach((item) => flattened.push(item));
    }
  };
  values.forEach(append);
  return Array.from(new Set(flattened.map((entry) => text(entry)).filter(Boolean)));
}

function sessionHistoryForkParentSessionId(item) {
  return text(
    item?.forkFromProviderSessionId
      || item?.fork_from_provider_session_id
      || item?.forkedFromProviderSessionId
      || item?.forked_from_provider_session_id
      || item?.parentProviderSessionId
      || item?.parent_provider_session_id,
  );
}

function sessionHistoryAgentMatches(item, terminal) {
  const itemAgent = sessionHistoryAgentKey(item);
  const terminalAgent = sessionHistoryAgentKey({
    agentId: terminal?.agentId || terminal?.agent_id || terminal?.agentKind || terminal?.agent_kind,
    provider: terminal?.provider || terminal?.agentId || terminal?.agent_id || terminal?.agentKind || terminal?.agent_kind,
  });
  return !itemAgent || !terminalAgent || itemAgent === terminalAgent;
}

function sessionHistoryProviderSessionId(item) {
  return sessionHistoryPrimarySessionValues(item)[0] || "";
}

function sessionHistoryTerminalConnected(terminal) {
  if (!terminal) return false;
  if (terminal.connected === false || terminal.nativeConnected === false || terminal.native_connected === false) {
    return false;
  }
  const status = text(
    terminal.status
      || terminal.terminalStatus
      || terminal.terminal_status
      || terminal.terminalLifecycle
      || terminal.terminal_lifecycle,
  ).toLowerCase();
  return !["closed", "closing", "disconnected", "exited", "offline", "terminated"].includes(status);
}

function sessionHistoryFindExactTerminal(item, terminalOptions = []) {
  const itemSessionIds = new Set(sessionHistoryPrimarySessionValues(item));
  if (!itemSessionIds.size) {
    return null;
  }
  return terminalOptions.find((terminal) => {
    if (!sessionHistoryTerminalConnected(terminal)) {
      return false;
    }
    if (!sessionHistoryAgentMatches(item, terminal)) {
      return false;
    }
    return sessionHistoryPrimarySessionValues(terminal).some((sessionId) => itemSessionIds.has(sessionId));
  }) || null;
}

function sessionHistoryChatSyncStatus(item) {
  const sync = item?.chatSync || item?.chat_sync || {};
  const rawStatus = text(sync.status || sync.state || sync.syncStatus || sync.sync_status, "waiting").toLowerCase();
  const status = ["live", "waiting", "syncing", "synced", "failed"].includes(rawStatus)
    ? rawStatus
    : rawStatus === "retrying" || rawStatus === "active"
      ? "syncing"
      : rawStatus === "done" || rawStatus === "acked"
        ? "synced"
        : "waiting";
  const labels = {
    failed: "Failed",
    live: "Live sync",
    synced: "Synced",
    syncing: "Syncing",
    waiting: "Not synced",
  };
  const pending = Number(sync.pendingPacketCount ?? sync.pending_packet_count ?? 0) || 0;
  const syncing = Number(sync.syncingPacketCount ?? sync.syncing_packet_count ?? 0) || 0;
  const retrying = Number(sync.retryingPacketCount ?? sync.retrying_packet_count ?? 0) || 0;
  const failed = Number(sync.failedPacketCount ?? sync.failed_packet_count ?? 0) || 0;
  const acked = Number(sync.recordAckedCount ?? sync.record_acked_count ?? 0) || 0;
  const total = Number(sync.recordTotalCount ?? sync.record_total_count ?? 0) || 0;
  const parts = [];
  if (pending) parts.push(`${pending} waiting`);
  if (syncing) parts.push(`${syncing} sending`);
  if (retrying) parts.push(`${retrying} retrying`);
  if (failed) parts.push(`${failed} failed`);
  if (acked || total) parts.push(`${acked}/${total || acked} records`);
  const lastError = text(sync.lastError || sync.last_error);
  if (lastError) parts.push(lastError);
  const rawLabel = text(sync.label);
  const normalizedRawLabel = rawLabel.toLowerCase();
  return {
    label: rawLabel && !["live", "waiting"].includes(normalizedRawLabel)
      ? rawLabel
      : labels[status],
    status,
    title: parts.length ? parts.join(" · ") : labels[status],
  };
}

function sessionHistoryRowMatchesSession(item, sessionId, agentKey = "") {
  const targetSessionId = text(sessionId);
  if (!targetSessionId) return false;
  if (agentKey && sessionHistoryAgentKey(item) !== agentKey) return false;
  return sessionHistoryPrimarySessionValues(item).includes(targetSessionId);
}

function SessionHistoryProviderIcon({ item }) {
  const agentKey = sessionHistoryAgentKey(item);
  if (agentKey === "claude") {
    return <WorkspaceCreateAgentClaudeIcon aria-hidden="true" />;
  }
  if (agentKey === "opencode") {
    return (
      <WorkspaceCreateAgentOpenCodeIcon
        aria-hidden="true"
        fill="none"
        viewBox="0 0 24 30"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M18 24H6V12H18V24Z" fill="#4B4646" />
        <path d="M18 6H6V24H18V6ZM24 30H0V0H24V30Z" fill="#F1ECEC" />
      </WorkspaceCreateAgentOpenCodeIcon>
    );
  }
  if (agentKey === "codex") {
    return <WorkspaceCreateAgentCodexIcon aria-hidden="true" />;
  }
  return <Terminal aria-hidden="true" />;
}

const SESSION_HISTORY_ROW_HEIGHT = 92;
const SESSION_HISTORY_ROW_GAP = 8;
const SESSION_HISTORY_OVERSCAN = 6;

function SessionHistoryPanel({
  error = "",
  items = [],
  onGoToTerminal = null,
  onOpenTerminal = null,
  repoLabel = "",
  state = "idle",
  terminalOptions = [],
  workspaceId = "",
}) {
  const [searchQuery, setSearchQuery] = useState("");
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const listRef = useRef(null);
  const filteredItems = useMemo(
    () => items.filter((item) => sessionHistoryMatchesSearch(item, searchQuery)),
    [items, searchQuery],
  );
  const hasItems = filteredItems.length > 0;
  const hasAnyItems = items.length > 0;
  useEffect(() => {
    setScrollTop(0);
    if (listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [workspaceId, searchQuery]);
  useEffect(() => {
    const node = listRef.current;
    if (!node) return undefined;
    const updateHeight = () => setViewportHeight(node.clientHeight || 0);
    updateHeight();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => window.removeEventListener("resize", updateHeight);
    }
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasItems]);
  const loading = state === "loading";
  const searchActive = text(searchQuery).length > 0;
  const rowStride = SESSION_HISTORY_ROW_HEIGHT + SESSION_HISTORY_ROW_GAP;
  const visibleHeight = viewportHeight || 560;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowStride) - SESSION_HISTORY_OVERSCAN);
  const endIndex = Math.min(
    filteredItems.length,
    startIndex + Math.ceil(visibleHeight / rowStride) + SESSION_HISTORY_OVERSCAN * 2,
  );
  const virtualItems = filteredItems.slice(startIndex, endIndex);
  const totalListHeight = Math.max(0, filteredItems.length * rowStride - SESSION_HISTORY_ROW_GAP);
  const scrollToSession = useCallback((sessionId, agentKey = "") => {
    const targetSessionId = text(sessionId);
    if (!targetSessionId) return false;
    const scrollToIndex = (index) => {
      if (index < 0) return false;
      const nextTop = Math.max(0, index * rowStride);
      setScrollTop(nextTop);
      if (listRef.current) {
        listRef.current.scrollTop = nextTop;
      }
      return true;
    };
    const visibleIndex = filteredItems.findIndex((candidate) => (
      sessionHistoryRowMatchesSession(candidate, targetSessionId, agentKey)
    ));
    if (scrollToIndex(visibleIndex)) return true;
    const allIndex = items.findIndex((candidate) => (
      sessionHistoryRowMatchesSession(candidate, targetSessionId, agentKey)
    ));
    if (allIndex >= 0) {
      setSearchQuery("");
      window.setTimeout(() => {
        scrollToIndex(allIndex);
      }, 0);
      return true;
    }
    return false;
  }, [filteredItems, items, rowStride]);
  return (
    <HistoryPane>
      <SessionHistoryHeaderBlock>
        <TimelineHeader>
          <div>
            <TimelineKicker>Session history</TimelineKicker>
            <TimelineTitle>{repoLabel}</TimelineTitle>
          </div>
          <TimelineSummary>
            {loading && !hasAnyItems
              ? "Loading"
              : searchActive
                ? `${filteredItems.length} of ${items.length} session${items.length === 1 ? "" : "s"}`
                : `${items.length} session${items.length === 1 ? "" : "s"}`}
          </TimelineSummary>
        </TimelineHeader>
        {(hasAnyItems || searchActive) && (
          <SessionHistoryControls>
            <SessionHistorySearchBox>
              <Search aria-hidden="true" />
              <input
                aria-label="Search session history"
                autoComplete="off"
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search sessions"
                type="search"
                value={searchQuery}
              />
            </SessionHistorySearchBox>
          </SessionHistoryControls>
        )}
      </SessionHistoryHeaderBlock>
      {error && <ArchitectureError>{error}</ArchitectureError>}
      {hasItems ? (
        <SessionHistoryList
          aria-label="Session history list"
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          ref={listRef}
          role="list"
        >
          <SessionHistoryVirtualSpacer style={{ height: totalListHeight }}>
          {virtualItems.map((item, virtualIndex) => {
            const index = startIndex + virtualIndex;
            const createdMs = parseTimeMs(item?.createdAtMs ?? item?.created_at_ms);
            const latestMs = parseTimeMs(item?.latestAtMs ?? item?.latest_at_ms);
            const id = sessionHistoryRowKey(item, index);
            const terminalMatch = sessionHistoryFindExactTerminal(item, terminalOptions);
            const syncBadge = sessionHistoryChatSyncStatus(item);
            const providerSessionId = sessionHistoryProviderSessionId(item);
            const forkParentSessionId = sessionHistoryForkParentSessionId(item);
            const hasForkParentRow = Boolean(forkParentSessionId && items.some((candidate) => (
              sessionHistoryRowMatchesSession(candidate, forkParentSessionId, sessionHistoryAgentKey(item))
            )));
            const sessionTitle = sessionHistoryTitle(item);
            return (
              <SessionHistoryVirtualRow
                key={id}
                style={{ transform: `translateY(${index * rowStride}px)` }}
              >
                <SessionHistoryCard data-agent={sessionHistoryAgentKey(item)} role="listitem">
                  <SessionHistoryIcon aria-hidden="true">
                    <SessionHistoryProviderIcon item={item} />
                  </SessionHistoryIcon>
                  <SessionHistoryContent>
                    <SessionHistoryCardTop>
                      <div>
                        <SessionHistoryAgent>{sessionHistoryAgentLabel(item)}</SessionHistoryAgent>
                        <SessionHistoryTitle title={sessionTitle}>{sessionTitle}</SessionHistoryTitle>
                      </div>
                      <SessionHistoryCardTopActions>
                        <SessionHistoryActionGroup>
                          {forkParentSessionId && (
                            <SessionHistoryActionButton
                              aria-label={`Show fork parent for ${sessionTitle}`}
                              data-variant="fork"
                              disabled={!hasForkParentRow}
                              onClick={() => scrollToSession(forkParentSessionId, sessionHistoryAgentKey(item))}
                              title={hasForkParentRow ? "Scroll to the session this was forked from" : "Fork parent is not in this history list"}
                              type="button"
                            >
                              <Hub aria-hidden="true" />
                              <span>Fork</span>
                            </SessionHistoryActionButton>
                          )}
                          {terminalMatch ? (
                            <SessionHistoryActionButton
                              aria-label={`Go to active terminal for ${sessionTitle}`}
                              data-variant="goto"
                              onClick={() => onGoToTerminal?.({
                                item,
                                terminal: terminalMatch,
                                workspaceId,
                              })}
                              title={`Go to active terminal ${terminalMatch.label || "terminal"} and highlight it`}
                              type="button"
                            >
                              <Terminal aria-hidden="true" />
                              <span>Go to active terminal</span>
                            </SessionHistoryActionButton>
                          ) : (
                            <SessionHistoryActionButton
                              aria-label={`Open terminal for ${sessionTitle}`}
                              data-variant="open"
                              disabled={!providerSessionId}
                              onClick={() => onOpenTerminal?.({
                                item,
                                providerSessionId,
                                workspaceId,
                              })}
                              title={providerSessionId ? "Open this session in a terminal" : "No provider session id recorded"}
                              type="button"
                            >
                              <Add aria-hidden="true" />
                              <span>Open</span>
                            </SessionHistoryActionButton>
                          )}
                        </SessionHistoryActionGroup>
                      </SessionHistoryCardTopActions>
                    </SessionHistoryCardTop>
                    <SessionHistoryMeta>
                      <span title={sessionHistoryModelLabel(item)}>{sessionHistoryModelLabel(item)}</span>
                      <SessionHistorySyncBadge data-status={syncBadge.status} title={syncBadge.title}>
                        <Sync aria-hidden="true" />
                        <span>{syncBadge.label}</span>
                      </SessionHistorySyncBadge>
                      <span>created {formatRelativeTimeMs(createdMs) || formatTime(createdMs) || "unknown"}</span>
                      <span>latest {formatRelativeTimeMs(latestMs) || formatTime(latestMs) || "unknown"}</span>
                    </SessionHistoryMeta>
                  </SessionHistoryContent>
                </SessionHistoryCard>
              </SessionHistoryVirtualRow>
            );
          })}
          </SessionHistoryVirtualSpacer>
        </SessionHistoryList>
      ) : (
        <EmptyState>
          {loading
            ? "Loading session history..."
            : searchActive
              ? "No sessions match that search."
              : "No session history recorded yet."}
        </EmptyState>
      )}
    </HistoryPane>
  );
}

function TodosHistoryPanel({
  deviceDirectory = null,
  finishPlanError = "",
  finishedPlanRefs = null,
  finishingPlanRef = "",
  items = [],
  onFinishPlan = null,
  repoLabel,
  terminalOptions = [],
  workspaceId = "",
}) {
  const [selectedTodoId, setSelectedTodoId] = useState("");
  const [actionNotice, setActionNotice] = useState(null);
  const [draftTargets, setDraftTargets] = useState({});
  const actionRequestRef = useRef("");
  const noticeTimerRef = useRef(0);

  useEffect(() => {
    const handleResult = (event) => {
      const detail = event?.detail || {};
      if (!detail.requestId || detail.requestId !== actionRequestRef.current) return;
      actionRequestRef.current = "";
      if (detail.ok) {
        setActionNotice(null);
        return;
      }
      setActionNotice({
        action: text(detail.action),
        reason: text(detail.reason, "The todo action could not be applied."),
      });
      window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => setActionNotice(null), 4600);
    };
    window.addEventListener(TODO_HISTORY_CONTROL_RESULT_EVENT, handleResult);
    return () => {
      window.removeEventListener(TODO_HISTORY_CONTROL_RESULT_EVENT, handleResult);
      window.clearTimeout(noticeTimerRef.current);
    };
  }, []);

  const dispatchTodoAction = useCallback((item, action, extra = {}) => {
    const requestId = `todo-history-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    actionRequestRef.current = requestId;
    // Every history action is client-authoritative: the Rust todo store
    // applies it immediately (tombstone or status flip + local emits) and
    // syncs the cloud in the background, so the UI settles instantly and the
    // row can never come back from a later hydration. The bus event still
    // fires in parallel so a mounted TerminalView can interrupt live panes,
    // actuate queue dispatch, and prune its in-memory queue state.
    const storeOwnsAction = action === "cancel"
      || action === "delete"
      || action === "unqueue"
      || action === "queue"
      || action === "retarget";
    window.dispatchEvent(new CustomEvent(TODO_HISTORY_CONTROL_EVENT, {
      detail: {
        action,
        commandId: item.commandId,
        dispatchId: item.dispatchId,
        item: item.raw || null,
        itemId: text(item.raw?.id),
        promptEventId: item.promptEventId,
        requestId,
        storeApplied: storeOwnsAction,
        todoId: item.todoId,
        todoIds: item.todoIds,
        workspaceId,
        ...extra,
      },
    }));
    if (!storeOwnsAction) {
      return;
    }
    const respond = (ok, reason = "") => {
      window.dispatchEvent(new CustomEvent(TODO_HISTORY_CONTROL_RESULT_EVENT, {
        detail: { action, ok, reason, requestId, workspaceId },
      }));
    };
    const todoIds = [
      ...new Set(
        [text(item.raw?.id), item.todoId, ...(Array.isArray(item.todoIds) ? item.todoIds : [])]
          .map((value) => String(value || "").trim())
          .filter(Boolean),
      ),
    ];
    const todoRefs = {
      todoId: String(item.todoId || text(item.raw?.id) || "").trim() || null,
      commandId: String(item.commandId || "").trim() || null,
      dispatchId: String(item.dispatchId || "").trim() || null,
    };
    const todoItemPayload = item.raw || null;
    const queueTargetIndex = Number(extra.targetTerminalIndex);
    const request = action === "cancel"
      ? invoke("todo_store_cancel", {
        workspaceId,
        ...todoRefs,
        reason: "todo_history_cancel",
      })
      : action === "unqueue"
        ? invoke("todo_store_set_status", {
          workspaceId,
          ...todoRefs,
          item: todoItemPayload,
          status: "listed",
          reason: "todo_history_unqueue",
        })
        : action === "queue" || action === "retarget"
          ? invoke("todo_store_set_status", {
            workspaceId,
            ...todoRefs,
            item: todoItemPayload,
            status: "queued",
            reason: action === "queue" ? "todo_history_queue" : "todo_history_retarget",
            targetTerminalIndex: Number.isInteger(queueTargetIndex) ? queueTargetIndex : null,
            clearTarget: extra.generic === true,
          })
          : invoke("todo_store_delete", {
            workspaceId,
            todoIds,
            reason: "todo_history_delete",
          });
    request
      .then(() => respond(true))
      .catch((error) => respond(false, String(error?.message || error || "The todo action could not be applied.")));
  }, [workspaceId]);

  const queuedTargetValue = useCallback((item) => {
    const raw = item.raw || {};
    const index = Number(raw.targetTerminalIndex ?? raw.target_terminal_index);
    return Number.isInteger(index) ? String(index) : "";
  }, []);

  const handleQueuedRetarget = useCallback((item, value) => {
    const targetTerminalIndex = value === "" ? null : Number(value);
    dispatchTodoAction(item, "retarget", {
      generic: value === "",
      targetTerminalIndex: Number.isInteger(targetTerminalIndex) ? targetTerminalIndex : null,
    });
  }, [dispatchTodoAction]);

  const handleListedTargetDraft = useCallback((item, value) => {
    setDraftTargets((current) => ({ ...current, [item.id]: value }));
  }, []);

  const groupedItems = useMemo(() => {
    const groups = new Map(TODO_HISTORY_GROUP_ORDER.map((group) => [group.id, []]));
    items.forEach((item) => {
      groups.get(todoHistoryGroupId(item)).push(item);
    });
    return groups;
  }, [items]);

  useEffect(() => {
    if (!items.length) {
      if (selectedTodoId) setSelectedTodoId("");
      return;
    }
    if (!items.some((item) => item.id === selectedTodoId)) {
      const firstGroupWithItems = TODO_HISTORY_GROUP_ORDER.find((group) => groupedItems.get(group.id)?.length);
      setSelectedTodoId(firstGroupWithItems ? groupedItems.get(firstGroupWithItems.id)[0].id : items[0].id);
    }
  }, [groupedItems, items, selectedTodoId]);

  const selectedItem = items.find((item) => item.id === selectedTodoId)
    || items[0]
    || null;

  if (!items.length) {
    return (
      <HistoryPane>
        <EmptyState>No todo history recorded yet.</EmptyState>
      </HistoryPane>
    );
  }

  return (
    <HistoryPane>
      <TimelineHeader>
        <div>
          <TimelineKicker>Workspace todos</TimelineKicker>
          <TimelineTitle>{repoLabel}</TimelineTitle>
        </div>
        <TimelineSummary>{items.length} todo{items.length === 1 ? "" : "s"}</TimelineSummary>
      </TimelineHeader>
      {actionNotice && (
        <TodoHistoryNotice role="alert">
          {actionNotice.reason}
        </TodoHistoryNotice>
      )}
      <HistorySplit>
        <TodoHistoryRail aria-label="Todos history list">
          {TODO_HISTORY_GROUP_ORDER.map((group) => {
            const groupItems = groupedItems.get(group.id) || [];
            if (!groupItems.length) return null;
            return (
              <TodoHistoryGroup key={group.id}>
                <TodoHistoryGroupLabel data-group={group.id} title={group.hint}>
                  <span>{group.label}</span>
                  <em>{groupItems.length}</em>
                </TodoHistoryGroupLabel>
                {groupItems.map((item) => {
                  const selected = selectedItem?.id === item.id;
                  const relativeStamp = item.statusKind === "active"
                    ? "live now"
                    : formatRelativeTimeMs(item.updatedMs || item.endMs || item.createdMs) || "unknown";
                  const preview = text(item.body, item.title);
                  return (
                    <TodoHistoryRowShell data-selected={selected ? "true" : "false"} key={item.id}>
                      <TodoHistoryRow
                        aria-pressed={selected}
                        data-selected={selected ? "true" : "false"}
                        data-status={item.statusKind}
                        onClick={() => setSelectedTodoId(item.id)}
                        type="button"
                      >
                        <TodoHistoryRowTop>
                          <StatusPill data-status={item.statusKind} title={`Actual status: ${item.rawStatus}`}>
                            {item.statusLabel}
                          </StatusPill>
                          <time>{relativeStamp}</time>
                        </TodoHistoryRowTop>
                        <TodoHistoryRowPreview>{preview}</TodoHistoryRowPreview>
                        <TodoHistoryRowMeta>
                          <span>{item.target || item.source || "unassigned"}</span>
                          {item.taskCount > 0 && <em>{item.taskCount} task{item.taskCount === 1 ? "" : "s"}</em>}
                          {item.planCount > 0 && <em>{item.planCount} plan{item.planCount === 1 ? "" : "s"}</em>}
                        </TodoHistoryRowMeta>
                      </TodoHistoryRow>
                      {group.id === "running" && (
                        <TodoHistoryRowActions>
                          <TodoActionButton
                            data-danger="true"
                            onClick={(event) => {
                              event.stopPropagation();
                              dispatchTodoAction(item, "cancel");
                            }}
                            title="Stop this todo's terminal turn; the next queued todo dispatches automatically"
                            type="button"
                          >
                            Stop
                          </TodoActionButton>
                          <TodoActionButton
                            data-danger="true"
                            onClick={(event) => {
                              event.stopPropagation();
                              dispatchTodoAction(item, "delete");
                            }}
                            title="Delete this todo everywhere (interrupts the turn if one is live; tombstoned on the server)"
                            type="button"
                          >
                            Delete
                          </TodoActionButton>
                        </TodoHistoryRowActions>
                      )}
                      {group.id === "queued" && (
                        <TodoHistoryRowActions>
                          <TodoHistoryTargetSelect
                            item={item}
                            onSelect={handleQueuedRetarget}
                            terminalOptions={terminalOptions}
                            value={queuedTargetValue(item)}
                          />
                          <TodoActionButton
                            onClick={(event) => {
                              event.stopPropagation();
                              dispatchTodoAction(item, "unqueue");
                            }}
                            title="Move this todo back to the list"
                            type="button"
                          >
                            Unqueue
                          </TodoActionButton>
                          <TodoActionButton
                            data-danger="true"
                            onClick={(event) => {
                              event.stopPropagation();
                              dispatchTodoAction(item, "delete");
                            }}
                            title="Delete this todo everywhere (tombstoned on the server)"
                            type="button"
                          >
                            Delete
                          </TodoActionButton>
                        </TodoHistoryRowActions>
                      )}
                      {group.id === "listed" && (
                        <TodoHistoryRowActions>
                          <TodoHistoryTargetSelect
                            item={item}
                            onSelect={handleListedTargetDraft}
                            terminalOptions={terminalOptions}
                            value={draftTargets[item.id] ?? queuedTargetValue(item)}
                          />
                          <TodoActionButton
                            onClick={(event) => {
                              event.stopPropagation();
                              const draftValue = draftTargets[item.id] ?? queuedTargetValue(item);
                              const targetTerminalIndex = draftValue === "" ? null : Number(draftValue);
                              dispatchTodoAction(item, "queue", {
                                generic: draftValue === "",
                                targetTerminalIndex: Number.isInteger(targetTerminalIndex) ? targetTerminalIndex : null,
                              });
                            }}
                            title="Queue this todo"
                            type="button"
                          >
                            Queue
                          </TodoActionButton>
                          <TodoActionButton
                            data-danger="true"
                            onClick={(event) => {
                              event.stopPropagation();
                              dispatchTodoAction(item, "delete");
                            }}
                            title="Delete this listed todo"
                            type="button"
                          >
                            Delete
                          </TodoActionButton>
                        </TodoHistoryRowActions>
                      )}
                      {group.id === "finished" && (
                        <TodoHistoryRowActions>
                          <TodoActionButton
                            data-danger="true"
                            onClick={(event) => {
                              event.stopPropagation();
                              dispatchTodoAction(item, "delete");
                            }}
                            title="Delete this todo everywhere (tombstoned on the server)"
                            type="button"
                          >
                            Delete
                          </TodoActionButton>
                        </TodoHistoryRowActions>
                      )}
                    </TodoHistoryRowShell>
                  );
                })}
              </TodoHistoryGroup>
            );
          })}
        </TodoHistoryRail>
        <TodoDetailPanel
          deviceDirectory={deviceDirectory}
          finishPlanError={finishPlanError}
          finishedPlanRefs={finishedPlanRefs}
          finishingPlanRef={finishingPlanRef}
          item={selectedItem}
          onFinishPlan={onFinishPlan}
          repoLabel={repoLabel}
        />
      </HistorySplit>
    </HistoryPane>
  );
}

function TaskPlanPreviewCard({
  action = null,
  label = "Terminal todo plan",
  plan,
  statusKind = "",
  statusLabel = "",
  title = "",
}) {
  if (!plan) return null;
  const planKey = terminalPlanIdentity(plan, title);
  const planSteps = architecturePlanSteps(plan);
  const planDetail = architecturePlanDescription(plan);

  return (
    <TaskPlanCard>
      <TaskPlanHeader>
        <span>{label}</span>
        <strong>{text(plan.title, title)}</strong>
        {statusLabel && (
          <StatusPill data-status={statusKind}>{statusLabel}</StatusPill>
        )}
        {action}
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
  );
}

const TODO_PLAN_STATUS_LABELS = {
  active: "Active",
  blocked: "Blocked",
  completed: "Completed",
  interrupted: "Interrupted",
  unknown: "Unknown",
};

function TodoTaskAccordionItem({ task }) {
  const [expanded, setExpanded] = useState(false);
  const startMs = taskStartMs(task);
  const endMs = taskEndMs(task);
  const active = taskIsActive(task);
  const updated = formatRelativeTimeMs(taskUpdatedMs(task) || endMs || startMs) || "unknown";
  const taskDuration = formatTimelineDuration(startMs, endMs, active);
  const agent = taskAgentLabel(task);
  const inputBlocks = taskInputBlocks(task);
  const body = taskBody(task);

  return (
    <TodoTaskAccordion data-expanded={expanded ? "true" : "false"}>
      <TodoTaskAccordionHeader
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <TodoTaskAccordionChevron aria-hidden="true" data-expanded={expanded ? "true" : "false"} />
        <div>
          <strong>{taskDisplayTitle(task)}</strong>
        </div>
        <TodoTaskMeta>
          <StatusPill data-status={taskStatusKind(task)} title={`Actual status: ${taskStatusLabel(task)}`}>
            {taskTimelineStatusLabel(task)}
          </StatusPill>
          {agent && <em>{agent}</em>}
          {taskDuration && <em>{taskDuration}</em>}
          <em>{updated}</em>
        </TodoTaskMeta>
      </TodoTaskAccordionHeader>
      {expanded && (
        <TodoTaskAccordionBody>
          <TaskInputPanel>
            {(inputBlocks.length ? inputBlocks : [{ content: body || "No agent input recorded.", label: "Input" }])
              .map((block, index) => (
                <TaskInputBlock key={`${block.label}-${index}-${block.content.slice(0, 24)}`}>
                  <span>{block.label}</span>
                  <p>{block.content}</p>
                </TaskInputBlock>
              ))}
          </TaskInputPanel>
        </TodoTaskAccordionBody>
      )}
    </TodoTaskAccordion>
  );
}

function TodoDetailPanel({
  deviceDirectory = null,
  finishPlanError = "",
  finishedPlanRefs = null,
  finishingPlanRef = "",
  item,
  onFinishPlan = null,
  repoLabel,
}) {
  if (!item) {
    return (
      <TaskDetails>
        <EmptyState>Select a todo to inspect it.</EmptyState>
      </TaskDetails>
    );
  }

  const updatedRelative = formatRelativeTimeMs(item.updatedMs || item.createdMs) || "unknown";
  const duration = item.duration || formatTimelineDuration(
    item.startMs || item.createdMs,
    item.endMs,
    item.statusKind === "active",
  ) || "unknown";
  const sourceDevice = item.sourceDevice || {};
  const targetDevice = item.targetDevice || {};
  const sourceName = todoDeviceDisplayName(sourceDevice, deviceDirectory);
  const targetName = todoDeviceDisplayName(targetDevice, deviceDirectory);
  const sourceWorkspace = sourceDevice.workspaceName || sourceDevice.workspaceId || "unknown workspace";
  const targetWorkspace = targetDevice.workspaceName || targetDevice.workspaceId || "unknown workspace";
  const SourceDeviceIcon = TODO_DEVICE_PLATFORM_ICONS[
    todoDevicePlatformToken(sourceDevice, deviceDirectory?.get?.(todoDeviceKey(sourceDevice.deviceId)))
  ];
  const TargetDeviceIcon = TODO_DEVICE_PLATFORM_ICONS[
    todoDevicePlatformToken(targetDevice, deviceDirectory?.get?.(todoDeviceKey(targetDevice.deviceId)))
  ];
  // Same device + workspace on both ends collapses to one chip — half the
  // detail panel's todos are self-dispatched and the duplication reads noisy.
  const sameEndpoint = sourceName === targetName && sourceWorkspace === targetWorkspace;
  const inputBlocks = todoInputBlocks(item.raw || item, item.relatedTasks);

  return (
    <TaskDetails aria-label="Selected todo details">
      <TaskDetailsHeader>
        <div>
          <TimelineKicker>{repoLabel}</TimelineKicker>
          <TaskDetailsTitle>{item.title}</TaskDetailsTitle>
        </div>
        <TaskDetailsHeaderActions>
          <TaskDetailsUpdated>Updated {updatedRelative}</TaskDetailsUpdated>
          <StatusPill data-status={item.statusKind} title={`Actual status: ${item.rawStatus}`}>
            {item.statusLabel}
          </StatusPill>
        </TaskDetailsHeaderActions>
      </TaskDetailsHeader>
      <TaskMetaStrip>
        <TaskMetaChip>
          <span>Duration</span>
          <strong>{duration}</strong>
        </TaskMetaChip>
        <TaskMetaChip>
          <span>Tasks</span>
          <strong>{item.taskCount}</strong>
        </TaskMetaChip>
        <TaskMetaChip>
          <span>Plans</span>
          <strong>{item.planCount}</strong>
        </TaskMetaChip>
      </TaskMetaStrip>
      <TodoDeviceGrid data-single={sameEndpoint ? "true" : undefined}>
        <TodoDeviceCard title={text(sourceDevice.deviceId) || undefined}>
          <span>{sameEndpoint ? "Device" : "Source"}</span>
          <TodoDeviceIcon aria-hidden="true"><SourceDeviceIcon /></TodoDeviceIcon>
          <strong>{sourceName}</strong>
          <em>{sourceWorkspace}</em>
        </TodoDeviceCard>
        {!sameEndpoint && (
          <TodoDeviceCard title={text(targetDevice.deviceId) || undefined}>
            <span>Target</span>
            <TodoDeviceIcon aria-hidden="true"><TargetDeviceIcon /></TodoDeviceIcon>
            <strong>{targetName}</strong>
            <em>{targetWorkspace}</em>
          </TodoDeviceCard>
        )}
      </TodoDeviceGrid>
      <TaskInputPanel>
        {(inputBlocks.length ? inputBlocks : [{ content: item.body || item.title || "No todo input recorded.", label: "Todo" }])
          .map((block, index) => (
            <TaskInputBlock key={`${block.label}-${index}-${block.content.slice(0, 24)}`}>
              <span>{block.label}</span>
              <p>{block.content}</p>
            </TaskInputBlock>
          ))}
      </TaskInputPanel>
      <TodoDetailSection>
        <TodoDetailSectionHeader>
          <span>Tasks under this todo</span>
          <strong>{item.relatedTasks.length}</strong>
        </TodoDetailSectionHeader>
        {item.relatedTasks.length ? (
          <TodoTaskList>
            {item.relatedTasks.map((task, index) => (
              <TodoTaskAccordionItem
                key={`${item.id}-${taskPlanTaskId(task, `task-${index}`)}`}
                task={task}
              />
            ))}
          </TodoTaskList>
        ) : (
          <TodoEmptyInline>No matching task records yet.</TodoEmptyInline>
        )}
      </TodoDetailSection>
      <TodoDetailSection>
        <TodoDetailSectionHeader>
          <span>Plans under this todo</span>
          <strong>{item.relatedPlans.length}</strong>
        </TodoDetailSectionHeader>
        {item.relatedPlans.length ? item.relatedPlans.map((entry) => {
          const basePlan = entry.plan;
          const planRef = terminalPlanIdentity(basePlan, entry.key);
          const finishedOverride = Boolean(finishedPlanRefs?.has?.(planRef));
          const plan = finishedOverride
            ? completedTerminalTodoPlan(basePlan) || basePlan
            : basePlan;
          const statusKind = finishedOverride ? "completed" : terminalPlanStatusKind(plan);
          const statusLabel = TODO_PLAN_STATUS_LABELS[statusKind] || TODO_PLAN_STATUS_LABELS.unknown;
          const canFinish = Boolean(
            typeof onFinishPlan === "function"
              && planRef
              && statusKind !== "completed",
          );
          const finishing = finishingPlanRef === planRef;
          return (
            <TaskPlanPreviewCard
              action={canFinish ? (
                <FinishPlanButton
                  data-loading={finishing ? "true" : undefined}
                  disabled={finishing}
                  onClick={() => onFinishPlan({ plan: basePlan, task: entry.task })}
                  type="button"
                >
                  {finishing && <FinishPlanButtonSpinner aria-hidden="true" />}
                  <span>{finishing ? "Finishing..." : "Finish plan"}</span>
                </FinishPlanButton>
              ) : null}
              key={entry.key}
              label={entry.sourceLabel === "Task" ? "Task plan" : "Todo plan"}
              plan={plan}
              statusKind={statusKind}
              statusLabel={statusLabel}
              title={entry.title}
            />
          );
        }) : (
          <TodoEmptyInline>No matching plans recorded yet.</TodoEmptyInline>
        )}
        {finishPlanError && <TaskActionError>{finishPlanError}</TaskActionError>}
      </TodoDetailSection>
    </TaskDetails>
  );
}

function ScannedResultPanel({ error = "", scan = null, state = "idle" }) {
  const graph = useMemo(() => buildScannedResultGraph(scan), [scan]);
  const hasGraph = graph.nodes.length > 0;
  const isLoading = state === "loading";
  const repositoriesByPath = new Map(jsonArray(scan?.repositories).map((repo) => [scannedResultEntryPath(repo), repo]));
  const discoveredScanEntries = jsonArray(scan?.workspaceMounts || scan?.workspace_mounts).length
    ? jsonArray(scan?.workspaceMounts || scan?.workspace_mounts)
    : jsonArray(scan?.mounts).length
      ? jsonArray(scan.mounts)
      : jsonArray(scan?.repositories);
  const scanEntries = discoveredScanEntries.map((entry) => {
    const matchingRepository = repositoriesByPath.get(scannedResultEntryPath(entry));
    return {
      ...entry,
      graphCount: numberValue(entry?.graphCount ?? entry?.graph_count ?? matchingRepository?.graphCount ?? matchingRepository?.graph_count, 0),
    };
  });

  return (
    <ScannedResultShell>
      <ScannedResultHeader>
        <div>
          <ScannedResultKicker>Architecture scan</ScannedResultKicker>
          <ScannedResultTitle>{isLoading && !hasGraph ? "Scanning workspace..." : "Scanned Result"}</ScannedResultTitle>
        </div>
      </ScannedResultHeader>
      {error && <ArchitectureError>{error}</ArchitectureError>}
      <ScannedResultStats>
        <span>{graph.stats.sourceLabel}</span>
        <span>{graph.stats.repoCount} scan entr{graph.stats.repoCount === 1 ? "y" : "ies"}</span>
        <span>{graph.stats.gitCount} git</span>
        <span>{graph.stats.folderCount} folder{graph.stats.folderCount === 1 ? "" : "s"}</span>
      </ScannedResultStats>
      {hasGraph ? (
        <ScannedResultGraph graph={graph} />
      ) : (
        <EmptyState>{isLoading ? "Scanning workspace..." : "No architecture scan result yet."}</EmptyState>
      )}
      {scanEntries.length > 0 && (
        <ScannedResultList aria-label="Scanned entries">
          {scanEntries.map((entry, index) => {
            const graphCount = numberValue(entry?.graphCount ?? entry?.graph_count, 0);
            return (
              <ScannedResultListRow
                data-kind={scannedResultGraphKind(entry)}
                key={text(entry.mountId || entry.mount_id || entry.id || scannedResultEntryPath(entry), `scan-entry-${index}`)}
              >
                <strong>{scannedResultEntryName(entry, "Project")}</strong>
                <span>{text(scannedResultRelativePath(entry, scan?.rootDirectory || scan?.root_directory), ".")}</span>
                <em>{scannedResultEntryKindLabel(entry)}</em>
                <em>{graphCount} graph{graphCount === 1 ? "" : "s"}</em>
              </ScannedResultListRow>
            );
          })}
        </ScannedResultList>
      )}
    </ScannedResultShell>
  );
}

function ScannedResultGraph({ graph }) {
  const layout = useMemo(() => layoutScannedResultGraph(graph), [graph]);
  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );
  const nodeWidth = 206;
  const nodeHeight = 66;

  return (
    <ScannedResultGraphViewport>
      <ScannedResultGraphSvg
        aria-label="Architecture scan graph"
        role="img"
        viewBox={`0 0 ${layout.width} ${layout.height}`}
      >
        <defs>
          <marker id="scanned-result-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
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
                className="scan-edge"
                d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                key={`${edge.from}-${edge.to}`}
                markerEnd="url(#scanned-result-arrow)"
              />
            );
          })}
        </g>
        <g>
          {layout.nodes.map((node) => (
            <g data-kind={node.kind} key={node.id} transform={`translate(${node.x}, ${node.y - nodeHeight / 2})`}>
              <title>{[node.label, node.meta, node.path].filter(Boolean).join("\n")}</title>
              <rect className="scan-node-box" height={nodeHeight} rx="8" width={nodeWidth} />
              <circle className="scan-node-dot" cx="18" cy="21" r="5" />
              <text className="scan-node-label" x="32" y="24">{shortLabel(node.label, 24)}</text>
              <text className="scan-node-meta" x="14" y="46">{shortLabel(node.meta || node.relativePath || node.path, 30)}</text>
              <text className="scan-node-badge" x={nodeWidth - 14} y="46" textAnchor="end">{shortLabel(node.badge, 13)}</text>
            </g>
          ))}
        </g>
      </ScannedResultGraphSvg>
    </ScannedResultGraphViewport>
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

  &[data-layout="single"] {
    grid-template-rows: minmax(0, 1fr);
  }
`;

const ArchitectureToolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  min-height: 38px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--forge-border);
  background: rgba(15, 23, 42, 0.34);
`;

const ViewToggleGroup = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  gap: 2px;
  max-width: 100%;
  overflow-x: auto;
  padding: 2px;
  border: 1px solid var(--forge-border);
  border-radius: 7px;
  background: rgba(2, 6, 23, 0.42);
`;

const ViewToggleButton = styled.button`
  flex: 0 0 auto;
  min-height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 5px;
  color: var(--forge-text-muted);
  background: transparent;
  font: inherit;
  font-size: 11px;
  font-weight: 850;
  cursor: pointer;
  white-space: nowrap;

  &[data-active="true"] {
    color: var(--forge-text);
    background: rgba(148, 163, 184, 0.14);
  }
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

const ArchitecturesShell = styled(FilesWorkspaceSurface)`
  display: grid;
  grid-template-columns: clamp(176px, 15vw, 232px) minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  &[data-nav-collapsed="true"] {
    grid-template-columns: minmax(0, 1fr);
  }

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

const ArchitectureFilesNavPane = styled(FileExplorerPane)`
  position: relative;
  grid-template-rows: auto auto auto minmax(0, 1fr) auto;
`;

const ArchitectureNavControls = styled.div`
  display: grid;
  gap: 0;
  min-width: 0;
  min-height: 0;
  background: var(--files-vscode-sidebar);
`;

const ArchitectureRootPickerWrap = styled.div`
  width: calc(100% - 16px);
  min-width: 0;
  margin: 4px 8px 6px;
`;

const ArchitectureNavBottomActions = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
  padding: 8px;
  border-top: 1px solid var(--files-vscode-border-subtle);
  background: var(--files-vscode-sidebar);
`;

const ArchitectureNavBottomButton = styled.button`
  display: grid;
  grid-template-columns: 16px minmax(0, 1fr);
  align-items: center;
  gap: 7px;
  width: 100%;
  min-width: 0;
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid var(--files-vscode-border);
  border-radius: 4px;
  color: var(--files-vscode-text);
  background: var(--files-vscode-editor);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;

  svg {
    width: 16px;
    height: 16px;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover:not(:disabled),
  &:focus-visible {
    background: var(--files-vscode-hover);
    outline: none;
  }

  &:disabled {
    cursor: default;
    opacity: 0.48;
  }
`;

const ArchitectureFileTreeButton = styled(FileTreeButton)`
  &[data-agent-edit] {
    color: var(--files-vscode-text);
  }

  &[data-local-unsaved="true"] {
    color: var(--files-vscode-text);
  }
`;

const ArchitectureFileKindIcon = styled(FileKindIcon)`
  &[data-file-tone="architecture"] {
    color: #4ec9b0;
  }

  svg {
    width: 15px;
    height: 15px;
  }
`;

const ArchitectureGraphFileIcon = styled(AccountTree)`
  display: block;
`;

const ArchitectureFileStatusMark = styled(FileGitStatusMark)`
  color: transparent;

  &[data-agent-edit] {
    color: var(--agent-edit-color, #60a5fa);
  }

  &[data-local-unsaved="true"] {
    color: #fbbf24;
  }

  i {
    width: 7px;
    height: 7px;
    border-radius: 999px;
    background: currentColor;
    box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 18%, transparent);
  }
`;

const ArchitectureNavRail = styled.aside`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  padding: 8px;
  overflow: hidden;
  border-right: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(2, 6, 23, 0.32);

  @media (max-width: 760px) {
    min-height: 260px;
    border-right: 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  }
`;

const ArchitectureNavHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  min-height: 26px;

  strong {
    min-width: 0;
    overflow: hidden;
    color: rgba(226, 232, 240, 0.86);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
  }
`;

const ArchitectureNavHeaderActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
`;

const ArchitectureIconButton = styled.button`
  display: inline-grid;
  flex: 0 0 auto;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid rgba(45, 212, 191, 0.28);
  border-radius: 6px;
  color: rgba(204, 251, 241, 0.95);
  background: rgba(13, 148, 136, 0.18);
  font: inherit;
  font-size: 16px;
  font-weight: 780;
  line-height: 1;
  cursor: pointer;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(94, 234, 212, 0.5);
    background: rgba(20, 184, 166, 0.26);
  }

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

const ArchitectureCreateGraphButton = styled(ArchitectureIconButton)`
  width: 22px;
  height: 22px;
  border-radius: 6px;

  svg {
    display: block;
    width: 14px;
    height: 14px;
  }
`;

const ArchitectureNavToggleButton = styled(ArchitectureIconButton)`
  border-color: rgba(148, 163, 184, 0.18);
  color: rgba(203, 213, 225, 0.8);
  background: rgba(15, 23, 42, 0.42);

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.34);
    background: rgba(var(--forge-accent-rgb), 0.14);
  }

  svg {
    display: block;
    width: 15px;
    height: 15px;
  }
`;

const ArchitectureFolderCreateForm = styled.form`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--forge-border, rgba(230, 236, 245, 0.08));

  input {
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid rgba(94, 234, 212, 0.28);
    border-radius: 6px;
    color: var(--forge-text, #f4f7fa);
    background: rgba(7, 9, 13, 0.55);
    font-size: 11.5px;
    font-weight: 650;
  }

  input:focus-visible {
    outline: 2px solid rgba(var(--forge-accent-soft-rgb), 0.32);
    outline-offset: -1px;
  }

  button {
    padding: 5px 10px;
    border: 1px solid rgba(45, 212, 191, 0.32);
    border-radius: 6px;
    color: rgba(204, 251, 241, 0.95);
    background: rgba(13, 148, 136, 0.2);
    font-size: 11px;
    font-weight: 750;
    cursor: pointer;
  }

  button:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

const ArchitectureTree = styled.div`
  display: grid;
  align-content: start;
  gap: 2px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
`;

const ArchitectureTreeRepoGroup = styled.div`
  display: grid;
  align-content: start;
  gap: 2px;
  min-width: 0;
`;

const ArchitectureTreeGroupLabel = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 8px 0 2px;
  padding: 0 6px;
  color: rgba(148, 163, 184, 0.78);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  &:first-child {
    margin-top: 2px;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    font-style: normal;
    font-weight: 600;
    color: rgba(100, 116, 139, 0.9);
  }
`;

const ArchitectureTreeBranch = styled.div`
  display: grid;
  align-content: start;
  gap: 1px;
  min-width: 0;
`;

const ArchitectureTreeRow = styled.button`
  display: grid;
  grid-template-columns: 12px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-width: 0;
  min-height: 24px;
  padding: 0 6px 0 calc(6px + var(--tree-depth, 0) * 12px);
  border: 1px solid transparent;
  border-radius: 6px;
  color: rgba(203, 213, 225, 0.82);
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &[data-drop-enabled="true"] {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.45);
    background: rgba(var(--forge-accent-rgb), 0.08);
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 11px;
    font-weight: 760;
  }

  em {
    min-width: 16px;
    color: rgba(148, 163, 184, 0.62);
    font-size: 9px;
    font-style: normal;
    font-weight: 850;
    text-align: right;
  }

  &[data-kind="repo"] {
    color: rgba(226, 232, 240, 0.92);
  }

  &[data-kind="repo"] span {
    font-size: 12px;
    font-weight: 880;
  }

  &[data-kind="repo"] em:first-of-type {
    color: rgba(52, 211, 153, 0.84);
  }

  &[data-kind="folder"] {
    color: rgba(148, 163, 184, 0.86);
  }

  &[data-kind="folder"] em:first-of-type {
    color: rgba(251, 191, 36, 0.84);
  }

  &[data-kind="graph"] {
    color: rgba(226, 232, 240, 0.86);
  }

  &[data-agent-edit] {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.16);
  }

  &:hover,
  &[data-active="true"] {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.14);
    background: rgba(148, 163, 184, 0.08);
  }

  &[data-active="true"] {
    color: rgba(248, 250, 252, 0.96);
    background: rgba(var(--forge-accent-rgb), 0.13);
    box-shadow: inset 2px 0 0 rgba(var(--forge-accent-soft-rgb), 0.72);
  }
`;

const ArchitectureTreeAgentMarker = styled.span`
  display: inline-flex;
  max-width: 74px;
  min-width: 0;
  align-items: center;
  gap: 4px;
  color: rgba(226, 232, 240, 0.74);
  font-size: 8px;
  font-weight: 920;
  line-height: 1;
  text-transform: uppercase;

  i {
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--agent-edit-color, #60a5fa);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--agent-edit-color, #60a5fa) 18%, transparent);
  }

  strong {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ArchitectureTreeGlyph = styled.i`
  display: inline-block;
  width: 9px;
  height: 9px;
  border: 1px solid rgba(148, 163, 184, 0.26);
  border-radius: 3px;
  background: rgba(148, 163, 184, 0.08);

  &[data-kind="repo"] {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.32);
    background: rgba(var(--forge-accent-rgb), 0.15);
  }

  &[data-kind="folder"] {
    border-color: rgba(251, 191, 36, 0.28);
    background: rgba(217, 119, 6, 0.15);
  }

  &[data-kind="graph"] {
    border-color: rgba(45, 212, 191, 0.28);
    border-radius: 50%;
    background: rgba(13, 148, 136, 0.16);
  }
`;

const ArchitectureTreeEmpty = styled.div`
  min-width: 0;
  min-height: 24px;
  padding: 5px 6px 5px calc(6px + var(--tree-depth, 0) * 12px + 18px);
  color: rgba(148, 163, 184, 0.58);
  font-size: 10px;
  font-weight: 760;
`;

const ArchitectureNavStoragePath = styled.span`
  min-width: 0;
  overflow: hidden;
  color: rgba(148, 163, 184, 0.62);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 760;
`;

const ArchitectureRepoRail = styled.aside`
  display: grid;
  align-content: start;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 10px;
  min-width: 0;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
  border-right: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(2, 6, 23, 0.34);

  @media (max-width: 760px) {
    border-right: 0;
    border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  }
`;

const ArchitectureRailHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  color: var(--forge-text-muted);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;

  strong {
    color: rgba(226, 232, 240, 0.82);
    font-size: 10px;
    font-weight: 900;
    text-transform: none;
  }
`;

const ArchitectureNavTitle = styled.div`
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
`;

const ArchitectureRepoList = styled.div`
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
`;

const ArchitectureRepoButton = styled.button`
  display: grid;
  gap: 3px;
  width: 100%;
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  color: var(--forge-text);
  background: rgba(15, 23, 42, 0.28);
  font: inherit;
  text-align: left;
  cursor: pointer;

  strong,
  span,
  em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 12px;
    font-weight: 880;
  }

  span {
    color: rgba(148, 163, 184, 0.78);
    font-size: 10px;
    font-weight: 720;
  }

  em {
    color: rgba(var(--forge-accent-soft-rgb), 0.78);
    font-size: 9px;
    font-style: normal;
    font-weight: 820;
  }

  &:hover,
  &[data-active="true"] {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.24);
    background: rgba(var(--forge-accent-rgb), 0.12);
  }

  &[data-active="true"] {
    box-shadow: inset 2px 0 0 rgba(var(--forge-accent-soft-rgb), 0.72);
  }
`;

const ArchitectureCreatePanel = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
  padding-top: 10px;
  border-top: 1px solid rgba(148, 163, 184, 0.12);
`;

const ArchitectureField = styled.label`
  display: grid;
  gap: 4px;
  min-width: 0;

  span {
    color: rgba(148, 163, 184, 0.82);
    font-size: 9px;
    font-weight: 900;
    letter-spacing: 0;
    text-transform: uppercase;
  }
`;

const ArchitectureInput = styled.input`
  width: 100%;
  min-width: 0;
  min-height: 30px;
  padding: 0 9px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 7px;
  color: var(--forge-text);
  background: rgba(2, 6, 23, 0.42);
  font: inherit;
  font-size: 12px;
  font-weight: 760;
  outline: none;

  &:focus {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.52);
    box-shadow: 0 0 0 2px rgba(var(--forge-accent-rgb), 0.14);
  }
`;

const ArchitecturePrimaryButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 30px;
  padding: 0 11px;
  border: 1px solid rgba(45, 212, 191, 0.32);
  border-radius: 7px;
  color: rgba(204, 251, 241, 0.95);
  background: rgba(13, 148, 136, 0.22);
  font: inherit;
  font-size: 11px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(94, 234, 212, 0.48);
    background: rgba(20, 184, 166, 0.28);
  }

  &:disabled {
    cursor: default;
    opacity: 0.52;
  }
`;

const ArchitectureSmallButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 7px;
  color: rgba(226, 232, 240, 0.86);
  background: rgba(15, 23, 42, 0.48);
  font: inherit;
  font-size: 10px;
  font-weight: 850;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.34);
    background: rgba(var(--forge-accent-rgb), 0.13);
  }

  &:disabled {
    cursor: default;
    opacity: 0.48;
  }
`;

const ArchitectureDangerButton = styled(ArchitectureSmallButton)`
  border-color: rgba(251, 113, 133, 0.18);
  color: rgba(254, 205, 211, 0.86);
  background: rgba(127, 29, 29, 0.16);

  &:hover:not(:disabled),
  &:focus-visible {
    border-color: rgba(251, 113, 133, 0.32);
    background: rgba(190, 18, 60, 0.18);
  }
`;

const ArchitectureGraphLibrary = styled.aside`
  display: grid;
  align-content: start;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
  border-right: 1px solid rgba(148, 163, 184, 0.12);
  background: rgba(15, 23, 42, 0.18);

  @media (max-width: 1100px) {
    display: none;
  }
`;

const ArchitectureGraphHeader = styled.header`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
`;

const ArchitectureGraphTitle = styled.strong`
  display: block;
  min-width: 0;
  margin-top: 2px;
  overflow: hidden;
  color: var(--forge-text);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 1.2;
`;

const ArchitectureGraphHeaderActions = styled.div`
  display: inline-flex;
  flex: 0 0 auto;
  gap: 6px;
`;

const ArchitectureStoragePath = styled.span`
  min-width: 0;
  overflow: hidden;
  color: rgba(167, 243, 208, 0.74);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 820;
`;

const ArchitectureGraphList = styled.div`
  display: grid;
  align-content: start;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
`;

const ArchitectureGraphButton = styled.button`
  display: grid;
  gap: 4px;
  width: 100%;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  color: var(--forge-text);
  background: rgba(2, 6, 23, 0.24);
  font: inherit;
  text-align: left;
  cursor: pointer;

  strong,
  span,
  em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    font-size: 12px;
    font-weight: 880;
  }

  span {
    color: rgba(226, 232, 240, 0.72);
    font-size: 10px;
    font-weight: 740;
    text-transform: capitalize;
  }

  em {
    color: rgba(148, 163, 184, 0.72);
    font-size: 9px;
    font-style: normal;
    font-weight: 780;
  }

  &:hover,
  &[data-active="true"] {
    border-color: rgba(251, 191, 36, 0.26);
    background: rgba(120, 53, 15, 0.14);
  }

  &[data-active="true"] {
    box-shadow: inset 2px 0 0 rgba(251, 191, 36, 0.68);
  }
`;

const ArchitectureEmptyNote = styled.div`
  padding: 10px;
  border: 1px dashed rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  color: rgba(148, 163, 184, 0.76);
  font-size: 11px;
  font-weight: 760;
  line-height: 1.4;
`;

const ArchitectureEditorRegion = styled.main`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 0;
  min-width: 0;
  min-height: 0;
  padding: 0;
  overflow: hidden;
`;

const ArchitectureEditorContent = styled.div`
  position: relative;
  display: grid;
  grid-row: 2;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
`;

const ArchitectureRestoreNavButton = styled.button`
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 9;
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 32px;
  padding: 0;
  border: 1px solid rgba(var(--forge-accent-soft-rgb), 0.28);
  border-radius: 8px;
  color: var(--forge-accent-soft, rgba(224, 242, 254, 0.9));
  background: rgba(15, 23, 42, 0.72);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
  cursor: pointer;
  font: inherit;

  svg {
    display: block;
    width: 17px;
    height: 17px;
  }

  &:hover,
  &:focus-visible {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.46);
    background: rgba(var(--forge-accent-rgb), 0.18);
  }
`;

const ArchitectureEditorEmpty = styled.div`
  display: grid;
  place-content: center;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  border: 1px dashed rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  color: rgba(148, 163, 184, 0.78);
  text-align: center;

  strong {
    color: var(--forge-text);
    font-size: 15px;
    font-weight: 900;
  }

  span {
    font-size: 12px;
    font-weight: 760;
  }
`;

const ArchitectureCreateSurfaceShell = styled.div`
  display: grid;
  align-self: stretch;
  place-items: center;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 24px;
  overflow: auto;
  border: 1px dashed rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.18), rgba(2, 6, 23, 0.12)),
    rgba(2, 6, 23, 0.18);
`;

const ArchitectureCreateDialog = styled.div`
  display: grid;
  gap: 11px;
  width: min(460px, 100%);
  min-width: 0;
  padding: 18px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.46);
  box-shadow: 0 18px 46px rgba(0, 0, 0, 0.26);
`;

const ArchitectureResolvingMessage = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
  color: rgba(148, 163, 184, 0.84);

  strong {
    color: var(--forge-text);
    font-size: 15px;
    font-weight: 900;
  }

  span {
    min-width: 0;
    overflow: hidden;
    font-size: 12px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-state="error"] strong {
    color: #fecaca;
  }
`;

const ArchitectureLocationToggle = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  min-width: 0;
  padding: 4px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.36);
`;

const ArchitectureLocationButton = styled.button`
  min-width: 0;
  min-height: 28px;
  padding: 0 8px;
  overflow: hidden;
  border: 0;
  border-radius: 6px;
  color: rgba(148, 163, 184, 0.82);
  background: transparent;
  font: inherit;
  font-size: 11px;
  font-weight: 850;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  &[data-active="true"] {
    color: rgba(226, 232, 240, 0.95);
    background: rgba(148, 163, 184, 0.13);
  }
`;

const ArchitectureFolderSuggestions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;

  button {
    max-width: 100%;
    min-height: 24px;
    padding: 0 8px;
    overflow: hidden;
    border: 1px solid rgba(251, 191, 36, 0.16);
    border-radius: 999px;
    color: rgba(254, 243, 199, 0.82);
    background: rgba(120, 53, 15, 0.12);
    font: inherit;
    font-size: 10px;
    font-weight: 820;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }
`;

const ArchitectureCreateActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  min-width: 0;
  padding-top: 2px;
`;

const ArchitectureEditorShell = styled.div`
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  gap: 0;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
`;

const ArchitectureEditorToolbar = styled.header`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 10px;
  min-width: 0;

  @media (max-width: 980px) {
    grid-template-columns: 1fr;
  }
`;

const ArchitectureEditorMeta = styled.div`
  display: grid;
  grid-template-columns: minmax(180px, 1.25fr) minmax(140px, 0.85fr);
  gap: 8px;
  min-width: 0;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
  }
`;

const ArchitectureEditorActions = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;
`;

const ArchitectureEditorNoticeSlot = styled.div`
  min-width: 0;
  min-height: 0;
`;

const ArchitectureEditorNotice = styled.div`
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid rgba(251, 191, 36, 0.2);
  border-radius: 8px;
  color: rgba(254, 240, 138, 0.82);
  background: rgba(120, 53, 15, 0.12);
  font-size: 11px;
  font-weight: 800;
  overflow-wrap: anywhere;

  &[data-kind="error"] {
    border-color: rgba(251, 113, 133, 0.26);
    color: #fecaca;
    background: rgba(127, 29, 29, 0.16);
  }
`;

const ArchitectureRevisionOverlay = styled.div`
  position: relative;
  display: grid;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.18), rgba(2, 6, 23, 0.12)),
    rgba(2, 6, 23, 0.18);
`;

const ArchitectureRevisionDrawerShell = styled.aside`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  width: 100%;
  min-width: 0;
  min-height: 0;
  height: 100%;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(8, 12, 18, 0.74);
  overflow: hidden;
`;

const ArchitectureRevisionHeader = styled.header`
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 13px 14px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
`;

const ArchitectureRevisionHeaderActions = styled.div`
  display: flex;
  flex: 0 0 auto;
  gap: 6px;
`;

const ArchitectureRevisionTitle = styled.strong`
  display: block;
  min-width: 0;
  overflow: hidden;
  color: rgba(248, 250, 252, 0.96);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  font-weight: 900;
  line-height: 1.2;
`;

const ArchitectureRevisionBody = styled.div`
  display: grid;
  grid-template-columns: minmax(230px, 0.78fr) minmax(0, 1.22fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  @media (max-width: 760px) {
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

const ArchitectureRevisionList = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  border-right: 1px solid rgba(148, 163, 184, 0.1);
`;

const ArchitectureRevisionEmpty = styled.div`
  padding: 14px;
  color: rgba(148, 163, 184, 0.78);
  font-size: 12px;
  font-weight: 760;
`;

const ArchitectureRevisionRow = styled.button`
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
  border: 0;
  border-bottom: 1px solid rgba(148, 163, 184, 0.09);
  color: rgba(226, 232, 240, 0.86);
  background: transparent;
  text-align: left;
  cursor: pointer;

  strong,
  span,
  em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: rgba(248, 250, 252, 0.94);
    font-size: 12px;
    font-weight: 860;
  }

  span {
    color: rgba(203, 213, 225, 0.72);
    font-size: 10px;
    font-weight: 760;
  }

  em {
    color: rgba(148, 163, 184, 0.68);
    font-size: 9px;
    font-style: normal;
    font-weight: 760;
  }

  &[data-selected="true"] {
    background: rgba(20, 184, 166, 0.1);
    box-shadow: inset 3px 0 0 rgba(45, 212, 191, 0.64);
  }

  &[data-deleted="true"] {
    background: linear-gradient(90deg, rgba(127, 29, 29, 0.12), transparent 72%);
  }
`;

const ArchitectureRevisionPreview = styled.div`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 9px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 12px;
`;

const ArchitectureRevisionMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;

  strong,
  span {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    padding: 4px 7px;
    border: 1px solid rgba(148, 163, 184, 0.12);
    border-radius: 7px;
    background: rgba(15, 23, 42, 0.44);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    font-weight: 800;
  }

  strong {
    color: rgba(240, 253, 250, 0.92);
    border-color: rgba(45, 212, 191, 0.16);
  }

  span {
    color: rgba(203, 213, 225, 0.74);
  }
`;

const ArchitectureRevisionSource = styled.pre`
  min-width: 0;
  min-height: 0;
  margin: 0;
  overflow: auto;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  color: rgba(226, 232, 240, 0.86);
  background: rgba(2, 6, 23, 0.55);
  font-family: "SFMono-Regular", "Cascadia Code", "Roboto Mono", monospace;
  font-size: 11px;
  font-weight: 650;
  line-height: 1.45;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

const ArchitectureRevisionActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-width: 0;
`;

const ArchitectureRevisionRestoreNote = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  color: rgba(254, 202, 202, 0.82);
  font-size: 10px;
  font-weight: 800;
`;

const ArchitectureEditorBody = styled.div`
  display: block;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;

  @media (max-width: 900px) {
    overflow: hidden;
  }
`;

const ArchitectureCanvasViewport = styled.div`
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  border: 0;
  border-radius: 0;
  background:
    radial-gradient(120% 80% at 50% -10%, var(--arch-canvas-glow), transparent 60%),
    var(--arch-canvas-bg);

  .react-flow {
    width: 100%;
    height: 100%;
    min-height: 0;
  }

  .react-flow__edge-path {
    shape-rendering: geometricPrecision;
  }

  .react-flow__node,
  .react-flow__edge {
    transition: opacity 140ms ease;
  }

  .react-flow__node.arch-dim,
  .react-flow__edge.arch-dim {
    opacity: 0.12;
    pointer-events: none;
  }

  .react-flow__node.arch-focus {
    z-index: 10 !important;
  }

  .react-flow__node.arch-focus > * {
    box-shadow:
      0 0 0 2px var(--arch-focus-ring),
      var(--arch-node-shadow) !important;
  }

  .react-flow__minimap {
    --xy-minimap-background-color: var(--arch-node-bg);
    border: 1px solid var(--arch-node-border);
    border-radius: 12px;
    overflow: hidden;
  }

  .react-flow__controls {
    --xy-controls-button-background-color: var(--arch-node-bg);
    --xy-controls-button-background-color-hover: var(--arch-icon-tile-bg);
    --xy-controls-button-color: var(--arch-node-text);
    --xy-controls-button-color-hover: var(--arch-node-text);
    --xy-controls-button-border-color: var(--arch-node-border);
    border-radius: 10px;
    box-shadow: var(--arch-node-shadow);
    overflow: hidden;
  }

`;

const ArchitectureSearchBar = styled.form`
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 9;
  display: grid;
  gap: 6px;
  width: 248px;
  pointer-events: auto;
  opacity: 0.82;
  transition: opacity 120ms ease;

  &:focus-within,
  &[data-active="true"] {
    opacity: 1;
  }

  input {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    border: 1px solid var(--arch-node-border);
    border-radius: 10px;
    color: var(--arch-node-text);
    background: var(--arch-node-bg);
    box-shadow: var(--arch-node-shadow);
    font-size: 12px;
    font-weight: 600;
    outline: none;
  }

  input::placeholder {
    color: var(--arch-node-text-muted);
  }

  input:focus {
    border-color: rgba(var(--forge-accent-rgb), 0.6);
  }
`;

const ArchitectureSearchResults = styled.div`
  display: grid;
  max-height: 280px;
  overflow-y: auto;
  padding: 4px;
  border: 1px solid var(--arch-node-border);
  border-radius: 10px;
  background: var(--arch-node-bg);
  box-shadow: var(--arch-node-shadow);

  button {
    display: grid;
    gap: 1px;
    padding: 7px 9px;
    border: 0;
    border-radius: 7px;
    text-align: left;
    color: var(--arch-node-text);
    background: transparent;
    cursor: pointer;
  }

  button:hover {
    background: var(--arch-icon-tile-bg);
  }

  button strong {
    overflow: hidden;
    font-size: 12px;
    font-weight: 700;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  button span {
    color: var(--arch-node-text-muted);
    font-size: 9.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
`;

const ArchitectureFloatingActions = styled.div`
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 8;
  display: flex;
  gap: 7px;
  pointer-events: auto;
  opacity: 0.72;
  transition: opacity 120ms ease, transform 120ms ease;

  ${ArchitectureCanvasViewport}:hover &,
  &:focus-within {
    opacity: 1;
    transform: translateY(0);
  }
`;

const ArchitectureRunTargetsBar = styled.div`
  position: absolute;
  top: 12px;
  left: 50%;
  z-index: 8;
  display: flex;
  max-width: min(720px, calc(100% - 330px));
  min-width: 0;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  pointer-events: auto;
  transform: translateX(-50%);

  &[data-disabled="true"] {
    opacity: 0.56;
  }

  @media (max-width: 980px) {
    top: 50px;
    max-width: calc(100% - 24px);
  }
`;

const ArchitectureRunTargetControl = styled.div`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 3px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 999px;
  background: rgba(8, 12, 18, 0.82);
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(12px);

  &[data-risk="high"] {
    border-color: rgba(251, 113, 133, 0.32);
  }

  &[data-risk="medium"] {
    border-color: rgba(251, 191, 36, 0.24);
  }
`;

const ArchitectureRunButton = styled.button`
  min-width: 0;
  max-width: 132px;
  height: 24px;
  padding: 0 10px;
  overflow: hidden;
  border: 1px solid rgba(45, 212, 191, 0.28);
  border-radius: 999px;
  color: rgba(240, 253, 250, 0.94);
  background: rgba(13, 148, 136, 0.2);
  font: inherit;
  font-size: 10px;
  font-weight: 900;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;

  &[data-risk="high"] {
    border-color: rgba(251, 113, 133, 0.46);
    color: #fee2e2;
    background: rgba(127, 29, 29, 0.24);
  }

  &[data-risk="medium"] {
    border-color: rgba(251, 191, 36, 0.36);
    color: rgba(254, 243, 199, 0.92);
    background: rgba(120, 53, 15, 0.2);
  }

  &:disabled {
    cursor: default;
  }

  &:not(:disabled):hover {
    filter: brightness(1.18);
  }
`;

const ArchitectureRunSelectWrap = styled.div`
  min-width: 76px;
  max-width: 112px;
  flex: 0 0 auto;
`;

const ArchitectureAgentEditStatus = styled.div`
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 9;
  display: inline-flex;
  max-width: min(300px, calc(100% - 240px));
  min-width: 0;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid color-mix(in srgb, var(--agent-edit-color, #60a5fa) 28%, rgba(148, 163, 184, 0.16));
  border-radius: 999px;
  color: rgba(226, 232, 240, 0.9);
  background: rgba(15, 23, 42, 0.78);
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
  backdrop-filter: blur(10px);
  pointer-events: none;

  i {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--agent-edit-color, #60a5fa);
    box-shadow:
      0 0 0 2px color-mix(in srgb, var(--agent-edit-color, #60a5fa) 18%, transparent),
      0 0 14px color-mix(in srgb, var(--agent-edit-color, #60a5fa) 32%, transparent);
  }

  span {
    min-width: 0;
    overflow: hidden;
    font-size: 10px;
    font-weight: 860;
    line-height: 1;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (max-width: 900px) {
    right: 12px;
    max-width: calc(100% - 24px);
  }
`;

const ArchitectureApiCorridorShell = styled.div`
  position: relative;
  isolation: isolate;
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(45, 212, 191, 0.34);
  border-radius: 8px;
  color: rgba(226, 232, 240, 0.92);
  background:
    linear-gradient(180deg, rgba(8, 47, 73, 0.78), rgba(15, 23, 42, 0.82)),
    rgba(2, 6, 23, 0.72);
  box-shadow:
    0 18px 36px rgba(0, 0, 0, 0.28),
    0 0 0 1px rgba(45, 212, 191, 0.08);
  backdrop-filter: blur(10px);
  pointer-events: auto;

  &::before {
    position: absolute;
    z-index: 0;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(45, 212, 191, 0.16), rgba(125, 211, 252, 0.78), rgba(45, 212, 191, 0.16));
    content: "";
    pointer-events: none;
  }

  &[data-expanded="false"][data-orientation="horizontal"]::before {
    right: 11px;
    bottom: 15px;
    left: 39px;
    height: 2px;
  }

  &[data-expanded="false"][data-orientation="vertical"]::before {
    top: 39px;
    bottom: 9px;
    left: 28px;
    width: 2px;
    background: linear-gradient(180deg, rgba(45, 212, 191, 0.16), rgba(125, 211, 252, 0.78), rgba(45, 212, 191, 0.16));
  }

  &[data-expanded="true"]::before {
    opacity: 0;
  }

  > * {
    position: relative;
    z-index: 1;
  }

  &[data-expanded="false"] {
    grid-template-rows: minmax(0, 1fr) auto;
  }

  &[data-expanded="true"] {
    grid-template-rows: auto minmax(0, 1fr);
  }

  &[data-status="uncertain"] {
    border-color: rgba(251, 191, 36, 0.38);
  }

  &[data-status="deprecated"] {
    border-color: rgba(251, 113, 133, 0.34);
  }
`;

const ArchitectureApiCorridorHeader = styled.button`
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  width: 100%;
  min-height: 52px;
  padding: 8px 9px;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid rgba(45, 212, 191, 0.72);
    outline-offset: -2px;
  }
`;

const ArchitectureApiCorridorGlyph = styled.span`
  position: relative;
  display: block;
  width: 20px;
  height: 20px;
  border: 1px solid rgba(45, 212, 191, 0.32);
  border-radius: 7px;
  background: rgba(13, 148, 136, 0.16);

  &::before,
  &::after {
    position: absolute;
    left: 4px;
    right: 4px;
    height: 2px;
    border-radius: 2px;
    background: rgba(153, 246, 228, 0.92);
    content: "";
  }

  &::before {
    top: 6px;
  }

  &::after {
    bottom: 6px;
    background: rgba(125, 211, 252, 0.9);
  }
`;

const ArchitectureApiCorridorHeaderText = styled.div`
  display: grid;
  gap: 2px;
  min-width: 0;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: rgba(240, 253, 250, 0.96);
    font-size: 11px;
    font-weight: 900;
  }

  span {
    color: rgba(186, 230, 253, 0.74);
    font-size: 9px;
    font-weight: 760;
  }
`;

const ArchitectureApiCorridorBadge = styled.span`
  padding: 3px 5px;
  border: 1px solid rgba(125, 211, 252, 0.18);
  border-radius: 6px;
  color: rgba(224, 242, 254, 0.82);
  background: rgba(8, 47, 73, 0.5);
  font-size: 8px;
  font-weight: 880;
  white-space: nowrap;
`;

const ArchitectureApiCorridorCollapsed = styled.div`
  display: flex;
  min-width: 0;
  gap: 4px;
  padding: 0 9px 8px 39px;
  overflow: hidden;

  span {
    min-width: 0;
    max-width: 88px;
    overflow: hidden;
    padding: 2px 5px;
    border: 1px solid rgba(45, 212, 191, 0.14);
    border-radius: 6px;
    color: rgba(204, 251, 241, 0.74);
    background: rgba(6, 78, 59, 0.16);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 8px;
    font-weight: 760;
  }
`;

const ArchitectureApiCorridorExpanded = styled.div`
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  min-height: 0;
  padding: 0 9px 10px;
`;

const ArchitectureApiCorridorParticipants = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;

  span {
    min-width: 0;
    max-width: 112px;
    overflow: hidden;
    padding: 3px 6px;
    border: 1px solid rgba(148, 163, 184, 0.13);
    border-radius: 6px;
    color: rgba(203, 213, 225, 0.78);
    background: rgba(2, 6, 23, 0.28);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 8px;
    font-weight: 800;
  }
`;

const ArchitectureApiCorridorStepList = styled.div`
  display: grid;
  align-content: start;
  gap: 5px;
  min-width: 0;
  min-height: 0;
  overflow: auto;
`;

const ArchitectureApiCorridorStep = styled.div`
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 7px;
  min-width: 0;
  padding: 6px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 7px;
  background: rgba(2, 6, 23, 0.24);

  &[data-tone="response"] {
    border-color: rgba(96, 165, 250, 0.16);
    background: rgba(30, 64, 175, 0.11);
  }

  &[data-tone="effect"] {
    border-color: rgba(52, 211, 153, 0.15);
    background: rgba(6, 78, 59, 0.11);
  }

  &[data-tone="redirect"] {
    border-color: rgba(251, 191, 36, 0.16);
    background: rgba(120, 53, 15, 0.11);
  }

  &[data-tone="failure"] {
    border-color: rgba(251, 113, 133, 0.18);
    background: rgba(127, 29, 29, 0.12);
  }
`;

const ArchitectureApiCorridorStepNumber = styled.span`
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border: 1px solid rgba(45, 212, 191, 0.22);
  border-radius: 6px;
  color: rgba(204, 251, 241, 0.9);
  background: rgba(13, 148, 136, 0.16);
  font-size: 8px;
  font-weight: 900;
`;

const ArchitectureApiCorridorStepBody = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;
`;

const ArchitectureApiCorridorStepRoute = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: rgba(148, 163, 184, 0.76);
  font-size: 8px;
  font-weight: 820;

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  i {
    flex: 0 0 auto;
    color: rgba(45, 212, 191, 0.86);
    font-style: normal;
  }
`;

const ArchitectureApiCorridorStepLabel = styled.strong`
  min-width: 0;
  overflow: hidden;
  color: rgba(248, 250, 252, 0.92);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
  font-weight: 850;
`;

const ArchitectureApiCorridorStepChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-width: 0;

  span {
    max-width: 130px;
    overflow: hidden;
    padding: 2px 5px;
    border: 1px solid rgba(125, 211, 252, 0.13);
    border-radius: 5px;
    color: rgba(224, 242, 254, 0.72);
    background: rgba(8, 47, 73, 0.28);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 7.5px;
    font-weight: 780;
  }
`;

const ArchitectureFloatingButton = styled.button`
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 8px;
  color: rgba(226, 232, 240, 0.88);
  background: rgba(15, 23, 42, 0.78);
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0;

  &:disabled {
    cursor: default;
    opacity: 0.45;
  }
`;

const ArchitectureFloatingDangerButton = styled(ArchitectureFloatingButton)`
  border-color: rgba(251, 113, 133, 0.28);
  color: #fecdd3;
  background: rgba(69, 10, 10, 0.64);
`;

const ArchitectureFloatingPrimaryButton = styled(ArchitectureFloatingButton)`
  border-color: rgba(45, 212, 191, 0.3);
  color: #ccfbf1;
  background: rgba(13, 69, 63, 0.66);
`;

const ArchitectureValidationPanel = styled.div`
  position: absolute;
  left: 12px;
  bottom: 58px;
  z-index: 7;
  display: grid;
  gap: 4px;
  width: min(380px, calc(100% - 24px));
  max-height: 154px;
  padding: 10px;
  overflow: hidden;
  border: 1px solid rgba(251, 191, 36, 0.2);
  border-radius: 8px;
  color: rgba(254, 243, 199, 0.86);
  background: rgba(15, 23, 42, 0.78);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(10px);
  pointer-events: none;

  strong {
    color: rgba(254, 249, 195, 0.95);
    font-size: 11px;
    font-weight: 920;
  }

  span {
    overflow: hidden;
    color: rgba(253, 230, 138, 0.82);
    font-size: 10px;
    font-weight: 760;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ArchitectureAgentCommandForm = styled.form`
  position: absolute;
  left: 50%;
  bottom: 12px;
  z-index: 8;
  display: flex;
  align-items: center;
  gap: 6px;
  width: min(760px, calc(100% - 28px));
  min-width: 0;
  min-height: 40px;
  padding: 5px 6px 5px 14px;
  border: 1px solid rgba(230, 236, 245, 0.11);
  border-radius: 999px;
  background: rgba(8, 12, 18, 0.82);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.26);
  backdrop-filter: blur(12px);
  transform: translateX(-50%);

  &:focus-within {
    border-color: rgba(var(--forge-accent-soft-rgb), 0.45);
    background: rgba(8, 12, 18, 0.92);
  }

  &[data-state="error"] {
    border-color: rgba(251, 113, 133, 0.36);
  }

  &[data-state="notice"] {
    border-color: rgba(45, 212, 191, 0.32);
  }

  @media (max-width: 720px) {
    flex-wrap: wrap;
    border-radius: 18px;
    padding: 7px;
  }
`;

const ArchitectureAgentCommandInput = styled.input`
  flex: 1 1 auto;
  min-width: 0;
  height: 30px;
  border: 0;
  outline: none;
  color: #eef4ff;
  background: transparent;
  font: inherit;
  font-size: 11px;
  font-weight: 680;
  line-height: 1.25;

  &::placeholder {
    color: #657386;
  }
`;

const ArchitectureAgentCommandControls = styled.div`
  display: grid;
  flex: 0 1 318px;
  grid-template-columns: minmax(112px, 1fr) minmax(112px, 1fr);
  gap: 6px;
  min-width: min(318px, 100%);

  @media (max-width: 720px) {
    flex: 1 1 100%;
    order: 3;
  }
`;

const ArchitectureAgentCommandSelectSlot = styled.div`
  min-width: 0;

  &[data-kind="workspace"] {
    min-width: 126px;
  }

  &[data-kind="terminal"] {
    min-width: 126px;
  }
`;

const ArchitectureTargetOptionLabel = styled.span`
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;

  i {
    display: block;
    width: 9px;
    height: 9px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--architecture-target-option-dot, var(--forge-accent-soft, #60a5fa));
    box-shadow: 0 0 0 2px rgba(var(--forge-accent-rgb), 0.14);
  }

  &[data-any="true"] i {
    border: 1.5px solid rgba(148, 163, 184, 0.55);
    background: transparent;
    box-shadow: none;
  }

  svg {
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
    color: rgba(148, 163, 184, 0.86);
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const ArchitectureAgentCommandSubmitButton = styled.button`
  display: inline-flex;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 1px solid rgba(230, 236, 245, 0.12);
  border-radius: 999px;
  color: #8d9aac;
  background: rgba(21, 27, 36, 0.94);
  line-height: 1;
  outline: none;
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease,
    color 140ms ease,
    opacity 140ms ease;

  &:not(:disabled):hover {
    border-color: rgba(255, 255, 255, 0.42);
    color: #05070a;
    background: #ffffff;
  }

  &[data-ready="true"] {
    border-color: rgba(255, 255, 255, 0.5);
    color: #05070a;
    background: #ffffff;
  }

  &:disabled {
    cursor: default;
    opacity: 0.68;
  }
`;

const ArchitectureAgentCommandSubmitIcon = styled(North)`
  display: block;
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
`;

const ArchitectureInspector = styled.aside`
  display: grid;
  align-content: start;
  gap: 9px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: auto;
  padding: 11px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.3);
`;

const ArchitectureInspectorHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: rgba(148, 163, 184, 0.82);
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;

  strong {
    color: rgba(226, 232, 240, 0.88);
    text-transform: none;
  }
`;

const ArchitectureInspectorMeta = styled.div`
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 7px;
  color: rgba(148, 163, 184, 0.78);
  background: rgba(2, 6, 23, 0.24);
  font-size: 11px;
  font-weight: 760;
  overflow-wrap: anywhere;
`;

const ArchitectureCanvasNodeShell = styled.div`
  --node-accent: 96, 165, 250;
  box-sizing: border-box;
  position: relative;
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 11px;
  width: ${ARCHITECTURE_NODE_CARD_WIDTH}px;
  min-height: ${ARCHITECTURE_NODE_CARD_HEIGHT}px;
  padding: 12px 15px;
  border: 1px solid var(--arch-node-border);
  border-radius: 14px;
  color: var(--arch-node-text);
  background: var(--arch-node-bg);
  box-shadow: var(--arch-node-shadow);

  &::before {
    content: "";
    position: absolute;
    left: 0;
    top: 13px;
    bottom: 13px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: rgba(var(--node-accent), 0.95);
    box-shadow: 0 0 10px rgba(var(--node-accent), 0.45);
  }

  html[data-forge-theme="light"] &::before {
    box-shadow: none;
  }

  &[data-kind="client"] { --node-accent: 251, 191, 36; }
  &[data-kind="database"] { --node-accent: 52, 211, 153; }
  &[data-kind="external"] { --node-accent: 244, 114, 182; }
  &[data-kind="queue"] { --node-accent: 167, 139, 250; }
  &[data-role="state"] { --node-accent: 167, 139, 250; }
  &[data-role="decision"] { --node-accent: 251, 191, 36; }
  &[data-role="terminal"] { --node-accent: 248, 113, 113; }
  &[data-role="actor"] { --node-accent: 251, 191, 36; }
  &[data-role="dependency"],
  &[data-role="package"] { --node-accent: 244, 114, 182; }

  html[data-forge-theme="light"] & { --node-accent: 37, 99, 235; }
  html[data-forge-theme="light"] &[data-kind="client"] { --node-accent: 180, 83, 9; }
  html[data-forge-theme="light"] &[data-kind="database"] { --node-accent: 5, 122, 85; }
  html[data-forge-theme="light"] &[data-kind="external"] { --node-accent: 190, 24, 93; }
  html[data-forge-theme="light"] &[data-kind="queue"] { --node-accent: 109, 40, 217; }
  html[data-forge-theme="light"] &[data-role="state"] { --node-accent: 109, 40, 217; }
  html[data-forge-theme="light"] &[data-role="decision"] { --node-accent: 180, 83, 9; }
  html[data-forge-theme="light"] &[data-role="terminal"] { --node-accent: 190, 18, 60; }
  html[data-forge-theme="light"] &[data-role="actor"] { --node-accent: 180, 83, 9; }
  html[data-forge-theme="light"] &[data-role="dependency"],
  html[data-forge-theme="light"] &[data-role="package"] { --node-accent: 190, 24, 93; }

  &[data-lifecycle="start"]::before {
    background: rgba(52, 211, 153, 0.95);
    box-shadow: 0 0 16px rgba(52, 211, 153, 0.6);
  }

  html[data-forge-theme="light"] &[data-lifecycle="start"]::before {
    background: rgba(5, 122, 85, 0.95);
    box-shadow: none;
  }

  &[data-display="compact"] {
    grid-template-columns: 1fr;
    align-content: center;
    justify-items: center;
    gap: 7px;
    width: ${ARCHITECTURE_NODE_COMPACT_WIDTH}px;
    min-height: ${ARCHITECTURE_NODE_COMPACT_HEIGHT}px;
    padding: 8px 6px;
    border-color: var(--arch-node-border);
    background: var(--arch-node-bg);
    box-shadow: var(--arch-node-shadow);
  }

  &[data-display="compact"]::before {
    display: none;
  }

  &[data-selected="true"] {
    border-color: rgba(var(--node-accent), 0.7);
    box-shadow:
      0 0 0 1px rgba(var(--node-accent), 0.35),
      0 0 0 4px rgba(var(--node-accent), 0.12),
      0 8px 24px rgba(2, 6, 23, 0.48);
  }

  &[data-display="compact"][data-selected="true"] {
    border-color: rgba(var(--node-accent), 0.5);
    background: var(--arch-node-bg);
    box-shadow: 0 0 0 3px rgba(var(--node-accent), 0.18);
  }

  .react-flow__handle {
    width: 6px;
    height: 6px;
    border: 0;
    opacity: 0;
    background: rgba(var(--node-accent), 0.9);
    pointer-events: none;
  }
`;

const ArchitectureNodeIcon = styled.span`
  display: inline-grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(var(--node-accent, 125, 211, 252), 0.42);
  border-radius: 9px;
  color: var(--arch-icon-mono);
  background: rgba(var(--node-accent, 125, 211, 252), 0.16);
  font-size: 7px;
  font-weight: 800;
  line-height: 1;
  overflow: hidden;

  svg {
    display: block;
    width: 18px;
    height: 18px;
    max-width: 20px;
    max-height: 20px;
    color: currentColor;
  }

  &[data-source="likec4"],
  &[data-source="styled"] {
    border-color: var(--arch-icon-tile-border);
    color: var(--arch-icon-mono);
    background: var(--arch-icon-tile-bg);
    box-shadow: none;
  }

  &[data-source="styled"] svg {
    color: inherit;
  }

  &[data-source="likec4"] svg {
    filter: brightness(0) invert(1);
  }

  html[data-forge-theme="light"] &[data-source="likec4"] svg {
    filter: brightness(0);
  }

  &[data-source="label"] {
    letter-spacing: 0;
    font-size: 8px;
  }

  &[data-kind="database"] {
    border-radius: 50%;
  }

  &[data-kind="group"] {
    border-radius: 9px;
  }

  ${ArchitectureCanvasNodeShell}[data-display="compact"] & {
    width: 38px;
    height: 38px;
    border-radius: 12px;
    border-color: rgba(var(--node-accent, 125, 211, 252), 0.42);
    background: rgba(var(--node-accent, 125, 211, 252), 0.16);
    font-size: 8px;
  }

  ${ArchitectureCanvasNodeShell}[data-display="compact"] &[data-kind="database"] {
    border-radius: 50%;
  }

  ${ArchitectureCanvasNodeShell}[data-display="compact"] & svg {
    width: 22px;
    height: 22px;
    max-width: 24px;
    max-height: 24px;
  }
`;

const ArchitectureNodeText = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--arch-node-text);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  span {
    color: var(--arch-node-text-muted);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  ${ArchitectureCanvasNodeShell}[data-display="compact"] & {
    justify-items: center;
    width: 100%;
    text-align: center;
  }

  ${ArchitectureCanvasNodeShell}[data-display="compact"] & strong {
    max-width: ${ARCHITECTURE_NODE_COMPACT_WIDTH - 4}px;
    color: var(--arch-node-text);
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0;
  }
`;

const ArchitectureCanvasGroupShell = styled.div`
  --node-accent: 148, 163, 184;
  width: 100%;
  height: 100%;
  padding: 18px;
  border: 1px solid var(--arch-group-border);
  border-radius: 18px;
  color: var(--arch-node-text);
  background:
    radial-gradient(130% 90% at 0% 0%, rgba(var(--node-accent), 0.1), rgba(var(--node-accent), 0) 58%),
    var(--arch-group-bg);
  box-shadow: none;

  &[data-intent="api-pathway"] { --node-accent: 96, 165, 250; }
  &[data-intent="api-corridor"] { --node-accent: 45, 212, 191; }
  &[data-intent="data-flow"] { --node-accent: 52, 211, 153; }
  &[data-intent="control-graph"] { --node-accent: 251, 191, 36; }
  &[data-intent="state-machine"] { --node-accent: 167, 139, 250; }
  &[data-intent="dependency-graph"] { --node-accent: 244, 114, 182; }
  &[data-intent="deployment"] { --node-accent: 45, 212, 191; }

  html[data-forge-theme="light"] & { --node-accent: 71, 85, 105; }
  html[data-forge-theme="light"] &[data-intent="api-pathway"] { --node-accent: 37, 99, 235; }
  html[data-forge-theme="light"] &[data-intent="api-corridor"] { --node-accent: 13, 148, 136; }
  html[data-forge-theme="light"] &[data-intent="data-flow"] { --node-accent: 5, 122, 85; }
  html[data-forge-theme="light"] &[data-intent="control-graph"] { --node-accent: 180, 83, 9; }
  html[data-forge-theme="light"] &[data-intent="state-machine"] { --node-accent: 109, 40, 217; }
  html[data-forge-theme="light"] &[data-intent="dependency-graph"] { --node-accent: 190, 24, 93; }
  html[data-forge-theme="light"] &[data-intent="deployment"] { --node-accent: 13, 148, 136; }

  &[data-selected="true"] {
    border-color: rgba(var(--node-accent), 0.6);
    box-shadow:
      inset 0 0 0 1px rgba(var(--node-accent), 0.16),
      0 0 0 3px rgba(var(--node-accent), 0.1);
  }

  .react-flow__handle {
    width: 6px;
    height: 6px;
    border: 0;
    opacity: 0;
    background: rgba(var(--node-accent), 0.9);
    pointer-events: none;
  }
`;

const ArchitectureGroupHeader = styled.div`
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  max-width: calc(100% - 14px);
  padding: 1px 0 0;
`;

const ArchitectureGroupText = styled.div`
  display: grid;
  gap: 3px;
  min-width: 0;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--arch-node-text);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  span {
    color: var(--arch-node-text-muted);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
`;

const ArchitectureEdgeLabel = styled.div`
  position: absolute;
  z-index: 3;
  max-width: var(--edge-label-max-width, 156px);
  padding: 3px 9px;
  overflow: hidden;
  border: 1px solid var(--arch-edge-label-border);
  border-radius: 999px;
  color: var(--arch-edge-label-text);
  background: var(--arch-edge-label-bg);
  box-shadow: 0 2px 8px rgba(2, 6, 23, 0.18);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.02em;
  line-height: 1.15;
  pointer-events: none;
  text-overflow: ellipsis;
  text-transform: lowercase;
  white-space: nowrap;

  &[data-kind="writes"],
  &[data-kind="publishes"] {
    border-color: rgba(52, 211, 153, 0.24);
    color: rgba(209, 250, 229, 0.92);
  }

  &[data-kind="transitions"],
  &[data-kind="guards"] {
    border-color: rgba(167, 139, 250, 0.28);
    color: rgba(237, 233, 254, 0.94);
  }

  &[data-kind="depends-on"] {
    border-color: rgba(244, 114, 182, 0.26);
    color: rgba(251, 207, 232, 0.92);
  }

  &[data-kind="fails-to"],
  &[data-kind="retries"] {
    border-color: rgba(251, 113, 133, 0.28);
    color: rgba(254, 205, 211, 0.94);
  }

  html[data-forge-theme="light"] &[data-kind="writes"],
  html[data-forge-theme="light"] &[data-kind="publishes"] {
    border-color: rgba(5, 122, 85, 0.45);
    color: #05653b;
  }

  html[data-forge-theme="light"] &[data-kind="transitions"],
  html[data-forge-theme="light"] &[data-kind="guards"] {
    border-color: rgba(109, 40, 217, 0.45);
    color: #5b21b6;
  }

  html[data-forge-theme="light"] &[data-kind="depends-on"] {
    border-color: rgba(190, 24, 93, 0.45);
    color: #9d174d;
  }

  html[data-forge-theme="light"] &[data-kind="fails-to"],
  html[data-forge-theme="light"] &[data-kind="retries"] {
    border-color: rgba(190, 18, 60, 0.45);
    color: #9f1239;
  }
`;

const HistoryPane = styled.div`
  container-type: inline-size;
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

const SessionHistoryHeaderBlock = styled.div`
  display: grid;
  gap: 10px;
  min-width: 0;
`;

const SessionHistoryControls = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;

const SessionHistorySearchBox = styled.label`
  position: relative;
  display: block;
  width: min(360px, 100%);
  min-width: 0;

  svg {
    position: absolute;
    top: 50%;
    left: 10px;
    width: 15px;
    height: 15px;
    color: rgba(148, 163, 184, 0.72);
    pointer-events: none;
    transform: translateY(-50%);
  }

  input {
    width: 100%;
    box-sizing: border-box;
    min-height: 34px;
    padding: 0 12px 0 32px;
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    color: rgba(241, 245, 249, 0.94);
    background: rgba(2, 6, 23, 0.28);
    font-size: 12px;
    font-weight: 760;
    outline: none;
  }

  input::placeholder {
    color: rgba(148, 163, 184, 0.58);
  }

  input:focus {
    border-color: rgba(var(--forge-accent-rgb), 0.52);
    box-shadow: 0 0 0 2px rgba(var(--forge-accent-rgb), 0.12);
  }
`;

const HistorySplit = styled.div`
  display: grid;
  grid-template-columns: minmax(170px, 0.82fr) minmax(0, 1.18fr);
  gap: 12px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;

  @container (max-width: 640px) {
    grid-template-columns: 1fr;
    overflow: auto;
  }

  @media (max-width: 920px) {
    grid-template-columns: 1fr;
    overflow: auto;
  }
`;

const SessionHistoryList = styled.div`
  position: relative;
  display: block;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
`;

const SessionHistoryVirtualSpacer = styled.div`
  position: relative;
  min-width: 0;
`;

const SessionHistoryVirtualRow = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 2px;
  height: 92px;
  will-change: transform;
`;

const SessionHistoryCard = styled.article`
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 10px;
  box-sizing: border-box;
  height: 92px;
  min-width: 0;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-left-width: 3px;
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.28);
  overflow: hidden;

  &[data-agent="codex"] {
    border-color: rgba(96, 165, 250, 0.18);
    border-left-color: rgba(96, 165, 250, 0.54);
  }

  &[data-agent="claude"] {
    border-color: rgba(248, 176, 92, 0.22);
    border-left-color: rgba(248, 176, 92, 0.6);
  }

  &[data-agent="opencode"] {
    border-color: rgba(167, 139, 250, 0.2);
    border-left-color: rgba(167, 139, 250, 0.58);
  }
`;

const SessionHistoryIcon = styled.div`
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  color: rgba(226, 232, 240, 0.92);
  background: rgba(15, 23, 42, 0.48);

  svg {
    display: block;
    max-width: 20px;
    max-height: 22px;
  }
`;

const SessionHistoryContent = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
`;

const SessionHistoryCardTop = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;

  > div {
    min-width: 0;
  }

  @media (max-width: 760px) {
    align-items: flex-start;
    flex-direction: row;
  }
`;

const SessionHistoryCardTopActions = styled.div`
  display: grid;
  align-content: start;
  align-items: start;
  flex: 0 0 auto;
  gap: 7px;
  justify-items: end;
  max-width: min(48%, 430px);
  min-width: 0;

  @media (max-width: 760px) {
    justify-items: stretch;
  }
`;

const SessionHistoryActionGroup = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: flex-end;
  min-width: 0;
`;

const SessionHistoryActionButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  max-width: 220px;
  min-height: 26px;
  min-width: 0;
  padding: 0 8px;
  border: 1px solid rgba(125, 211, 252, 0.24);
  border-radius: 7px;
  color: rgba(226, 242, 255, 0.94);
  background: rgba(14, 116, 144, 0.18);
  cursor: pointer;
  font-size: 10px;
  font-weight: 860;
  line-height: 1;
  white-space: nowrap;

  svg {
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &[data-variant="open"] {
    border-color: rgba(134, 239, 172, 0.2);
    background: rgba(22, 101, 52, 0.18);
  }

  &[data-variant="goto"] {
    border-color: rgba(96, 165, 250, 0.36);
    color: rgba(219, 234, 254, 0.98);
    background: linear-gradient(180deg, rgba(37, 99, 235, 0.32), rgba(14, 116, 144, 0.2));
    box-shadow:
      inset 0 0 0 1px rgba(147, 197, 253, 0.08),
      0 0 0 1px rgba(37, 99, 235, 0.05);
  }

  &[data-variant="fork"] {
    border-color: rgba(251, 191, 36, 0.22);
    color: rgba(254, 243, 199, 0.94);
    background: rgba(146, 64, 14, 0.18);
  }

  &:hover:not(:disabled) {
    border-color: rgba(125, 211, 252, 0.5);
    background: rgba(14, 116, 144, 0.3);
  }

  &[data-variant="goto"]:hover:not(:disabled) {
    border-color: rgba(147, 197, 253, 0.58);
    background: linear-gradient(180deg, rgba(37, 99, 235, 0.44), rgba(14, 116, 144, 0.3));
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }

  @media (max-width: 760px) {
    max-width: 100%;
  }
`;

const SessionHistorySyncBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex: 0 0 auto;
  max-width: 118px;
  min-width: 70px;
  min-height: 20px;
  padding: 0 6px;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 6px;
  color: rgba(203, 213, 225, 0.72);
  background: rgba(51, 65, 85, 0.1);
  font-size: 8px;
  font-weight: 880;
  line-height: 1;
  text-align: center;
  text-transform: uppercase;
  white-space: nowrap;

  svg {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
  }

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  &[data-status="live"] {
    border-color: rgba(45, 212, 191, 0.2);
    color: rgba(153, 246, 228, 0.82);
    background: rgba(15, 118, 110, 0.14);
  }

  &[data-status="waiting"] {
    border-color: rgba(56, 189, 248, 0.16);
    color: rgba(186, 230, 253, 0.72);
    background: rgba(8, 47, 73, 0.11);
  }

  &[data-status="syncing"] {
    border-color: rgba(96, 165, 250, 0.2);
    color: rgba(191, 219, 254, 0.78);
    background: rgba(30, 64, 175, 0.13);
  }

  &[data-status="synced"] {
    border-color: rgba(52, 211, 153, 0.16);
    color: rgba(167, 243, 208, 0.76);
    background: rgba(6, 78, 59, 0.11);
  }

  &[data-status="failed"] {
    border-color: rgba(251, 113, 133, 0.18);
    color: rgba(254, 205, 211, 0.76);
    background: rgba(127, 29, 29, 0.12);
  }
`;

const SessionHistoryAgent = styled.div`
  overflow: hidden;
  color: rgba(148, 163, 184, 0.9);
  font-size: 9.5px;
  font-weight: 850;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
`;

const SessionHistoryTitle = styled.strong`
  display: block;
  min-width: 0;
  overflow: hidden;
  color: rgba(248, 250, 252, 0.96);
  font-size: 13px;
  font-weight: 860;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const SessionHistoryMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: rgba(148, 163, 184, 0.82);
  font-size: 10px;
  font-weight: 720;

  > span:not(${SessionHistorySyncBadge}) {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  > span:first-child {
    color: rgba(191, 219, 254, 0.9);
    font-weight: 840;
  }

  @media (max-width: 700px) {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
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
  box-sizing: border-box;
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
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

  > div {
    min-width: 0;
  }

  @container (max-width: 520px) {
    flex-direction: column;
    gap: 7px;
  }
`;

const TaskDetailsHeaderActions = styled.div`
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  min-width: 0;
  max-width: 100%;
`;

const TaskDetailsUpdated = styled.span`
  color: rgba(148, 163, 184, 0.72);
  font-size: 10px;
  font-weight: 760;
  white-space: nowrap;
`;

const finishPlanButtonSpin = keyframes`
  to {
    transform: rotate(360deg);
  }
`;

const FinishPlanButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
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

  &[data-loading="true"] {
    opacity: 0.82;
  }
`;

const FinishPlanButtonSpinner = styled.i`
  display: inline-block;
  width: 9px;
  height: 9px;
  border: 2px solid rgba(191, 219, 254, 0.22);
  border-top-color: rgba(191, 219, 254, 0.88);
  border-radius: 50%;
  animation: ${finishPlanButtonSpin} 720ms linear infinite;
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
  flex: 1 1 92px;
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

const TodoDeviceGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  min-width: 0;

  &[data-single="true"] {
    grid-template-columns: 1fr;
  }

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`;

const TodoDeviceCard = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
  min-height: 30px;
  padding: 5px 10px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.22);

  span {
    flex: none;
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong,
  em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    flex: 1 1 auto;
    color: rgba(241, 245, 249, 0.94);
    font-size: 12px;
    font-weight: 850;
  }

  em {
    flex: 0 1 auto;
    margin-left: auto;
    max-width: 50%;
    color: rgba(203, 213, 225, 0.7);
    font-size: 10px;
    font-style: normal;
    font-weight: 720;
  }
`;

const TodoDeviceIcon = styled.span`
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.12);
  color: rgba(203, 213, 225, 0.88);

  svg {
    width: 11px;
    height: 11px;
  }
`;

const TodoEmptyInline = styled.span`
  display: block;
  color: rgba(148, 163, 184, 0.72);
  font-size: 10px;
  font-weight: 720;
  line-height: 1.35;
`;

const TodoDetailSection = styled.section`
  display: grid;
  gap: 8px;
  min-width: 0;
`;

const TodoDetailSectionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
  padding-top: 2px;

  span {
    color: var(--forge-text-muted);
    font-size: 10px;
    font-weight: 900;
    text-transform: uppercase;
  }

  strong {
    display: inline-grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    border: 1px solid rgba(96, 165, 250, 0.18);
    border-radius: 999px;
    color: rgba(191, 219, 254, 0.86);
    background: rgba(30, 64, 175, 0.12);
    font-size: 10px;
    font-weight: 900;
  }
`;

const TodoTaskList = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
`;

const TodoTaskRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  min-width: 0;
  padding: 8px 9px;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.2);

  > div:first-child {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: rgba(241, 245, 249, 0.94);
    font-size: 11px;
    font-weight: 820;
  }

  span {
    color: rgba(148, 163, 184, 0.76);
    font-size: 9px;
    font-weight: 720;
  }

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`;

const TodoTaskMeta = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;

  em {
    max-width: 120px;
    overflow: hidden;
    color: rgba(203, 213, 225, 0.68);
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 9px;
    font-style: normal;
    font-weight: 720;
  }

  @media (max-width: 700px) {
    justify-content: flex-start;
  }
`;

const TodoHistoryRail = styled.div`
  display: flex;
  flex-direction: column;
  align-content: start;
  gap: 6px;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  padding-right: 2px;
`;

const TodoHistoryRow = styled.button`
  display: grid;
  gap: 5px;
  min-width: 0;
  width: 100%;
  padding: 9px 10px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 10px;
  color: inherit;
  background: rgba(2, 6, 23, 0.24);
  font: inherit;
  text-align: left;
  cursor: pointer;
  flex-shrink: 0;

  &:hover {
    border-color: rgba(96, 165, 250, 0.3);
  }

  &[data-selected="true"] {
    border-color: rgba(96, 165, 250, 0.45);
    background: rgba(30, 64, 175, 0.14);
  }
`;

const TodoHistoryGroup = styled.section`
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex-shrink: 0;
`;

const TodoHistoryGroupLabel = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  padding: 2px 4px;
  color: rgba(148, 163, 184, 0.85);
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;

  em {
    color: rgba(148, 163, 184, 0.6);
    font-style: normal;
    font-weight: 750;
  }

  &[data-group="running"] span {
    color: rgba(94, 234, 212, 0.92);
  }

  &[data-group="queued"] span {
    color: rgba(125, 176, 255, 0.92);
  }
`;

const TodoHistoryRowShell = styled.div`
  position: relative;
  min-width: 0;
  flex-shrink: 0;
`;

const TodoHistoryRowActions = styled.div`
  position: absolute;
  top: 6px;
  right: 6px;
  display: none;
  align-items: center;
  gap: 4px;
  padding: 3px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.92);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);

  ${TodoHistoryRowShell}:hover &,
  ${TodoHistoryRowShell}:focus-within & {
    display: inline-flex;
  }
`;

const TodoActionButton = styled.button`
  padding: 3px 8px;
  border: 1px solid rgba(125, 176, 255, 0.3);
  border-radius: 6px;
  color: rgba(200, 222, 255, 0.95);
  background: rgba(59, 130, 246, 0.12);
  font-size: 10px;
  font-weight: 760;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: rgba(59, 130, 246, 0.26);
  }

  &[data-danger="true"] {
    border-color: rgba(239, 107, 107, 0.32);
    color: rgba(250, 180, 180, 0.92);
    background: transparent;
  }

  &[data-danger="true"]:hover {
    background: rgba(127, 29, 29, 0.24);
  }
`;

const TodoHistoryNotice = styled.p`
  margin: 0 0 8px;
  padding: 7px 10px;
  border: 1px solid rgba(223, 165, 90, 0.32);
  border-radius: 8px;
  color: rgba(240, 200, 140, 0.95);
  background: rgba(63, 38, 10, 0.32);
  font-size: 11px;
  font-weight: 650;
`;

const TodoHistoryRowTop = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;

  time {
    color: rgba(148, 163, 184, 0.8);
    font-size: 9px;
    font-weight: 760;
    white-space: nowrap;
  }
`;

const TodoHistoryRowPreview = styled.p`
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  margin: 0;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  color: rgba(226, 232, 240, 0.92);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
`;

const TodoHistoryRowMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  span,
  em {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 9px;
    font-style: normal;
    font-weight: 720;
  }

  span {
    min-width: 0;
    color: rgba(148, 163, 184, 0.78);
  }

  em {
    flex-shrink: 0;
    color: rgba(125, 211, 252, 0.78);
  }
`;

const TodoTaskAccordion = styled.div`
  display: grid;
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 8px;
  background: rgba(2, 6, 23, 0.2);
  overflow: hidden;

  &[data-expanded="true"] {
    border-color: rgba(96, 165, 250, 0.28);
  }
`;

const TodoTaskAccordionHeader = styled.button`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 9px;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  text-align: left;
  cursor: pointer;

  > div {
    display: grid;
    gap: 3px;
    min-width: 0;
  }

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: rgba(241, 245, 249, 0.94);
    font-size: 11px;
    font-weight: 820;
  }

  span {
    color: rgba(148, 163, 184, 0.76);
    font-size: 9px;
    font-weight: 720;
  }

  @media (max-width: 700px) {
    grid-template-columns: auto minmax(0, 1fr);
  }
`;

const TodoTaskAccordionChevron = styled.span`
  width: 0;
  height: 0;
  border-left: 5px solid rgba(148, 163, 184, 0.85);
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 140ms ease;

  &[data-expanded="true"] {
    transform: rotate(90deg);
  }
`;

const TodoTaskAccordionBody = styled.div`
  display: grid;
  gap: 8px;
  min-width: 0;
  padding: 8px 9px 9px;
  border-top: 1px solid rgba(148, 163, 184, 0.08);
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

const ScannedResultShell = styled.div`
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: 12px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  padding: 14px;
`;

const ScannedResultHeader = styled.header`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
`;

const ScannedResultKicker = styled.div`
  color: var(--forge-text-muted);
  font-size: 11px;
  font-weight: 850;
  text-transform: uppercase;
`;

const ScannedResultTitle = styled.strong`
  display: block;
  margin-top: 3px;
  font-size: 16px;
`;

const ScannedResultStats = styled.div`
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

const ScannedResultGraphViewport = styled.div`
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

const ScannedResultGraphSvg = styled.svg`
  display: block;
  min-width: 760px;
  min-height: 360px;

  .scan-edge {
    fill: none;
    stroke: rgba(147, 197, 253, 0.5);
    stroke-width: 2;
  }

  .scan-node-box {
    fill: rgba(15, 23, 42, 0.92);
    stroke: rgba(148, 163, 184, 0.24);
    stroke-width: 1.4;
  }

  .scan-node-dot {
    fill: #94a3b8;
  }

  .scan-node-label {
    fill: #f8fafc;
    font-size: 13px;
    font-weight: 850;
  }

  .scan-node-meta,
  .scan-node-badge {
    fill: rgba(203, 213, 225, 0.68);
    font-size: 10px;
    font-weight: 760;
  }

  [data-kind="root"] .scan-node-box {
    fill: rgba(30, 64, 175, 0.28);
    stroke: rgba(96, 165, 250, 0.55);
  }

  [data-kind="root"] .scan-node-dot {
    fill: #60a5fa;
  }

  [data-kind="rootGit"] .scan-node-box,
  [data-kind="git"] .scan-node-box {
    fill: rgba(20, 83, 45, 0.2);
    stroke: rgba(52, 211, 153, 0.42);
  }

  [data-kind="rootGit"] .scan-node-dot,
  [data-kind="git"] .scan-node-dot {
    fill: #34d399;
  }

  [data-kind="folder"] .scan-node-box {
    fill: rgba(120, 53, 15, 0.18);
    stroke: rgba(251, 191, 36, 0.36);
  }

  [data-kind="folder"] .scan-node-dot {
    fill: #fbbf24;
  }

  [data-kind="project"] .scan-node-box {
    fill: rgba(8, 47, 73, 0.24);
    stroke: rgba(56, 189, 248, 0.34);
  }

  [data-kind="project"] .scan-node-dot {
    fill: #38bdf8;
  }

  [data-kind="container"] .scan-node-box {
    fill: rgba(120, 53, 15, 0.18);
    stroke: rgba(251, 191, 36, 0.36);
  }

  [data-kind="container"] .scan-node-dot {
    fill: #fbbf24;
  }

  [data-kind="skipped"] {
    opacity: 0.62;
  }
`;

const ScannedResultList = styled.div`
  display: grid;
  gap: 6px;
  min-width: 0;
  max-height: 150px;
  overflow: auto;
`;

const ScannedResultListRow = styled.div`
  display: grid;
  grid-template-columns: minmax(120px, 1.2fr) minmax(120px, 2fr) auto auto;
  gap: 8px;
  align-items: center;
  min-width: 0;
  padding: 7px 9px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.32);
  font-size: 11px;
  font-weight: 760;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: rgba(248, 250, 252, 0.92);
  }

  span,
  em {
    color: var(--forge-text-muted);
    font-style: normal;
  }

  &[data-kind="git"] em:first-of-type {
    color: rgba(52, 211, 153, 0.86);
  }

  &[data-kind="folder"],
  &[data-kind="container"] {
    em:first-of-type {
      color: rgba(251, 191, 36, 0.84);
    }
  }
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

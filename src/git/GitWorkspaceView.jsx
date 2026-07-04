import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";

import { FormMessage } from "../app/appStyles";
import { collapseFunctionalRepoPathToCoreRepoPath } from "../terminals/coreRepoNameDisplay";

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanWorkspaceRootDirectory(value) {
  if (typeof value !== "string") {
    return "";
  }

  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, "").trim();
  const uncVerbatimMatch = cleaned.match(/^[\\/]{2}\?[\\/]UNC[\\/](.+)$/i);

  if (uncVerbatimMatch) {
    return collapseFunctionalRepoPathToCoreRepoPath(`\\\\${uncVerbatimMatch[1]}`.trim());
  }

  const driveVerbatimMatch = cleaned.match(/^[\\/]{2}\?[\\/]([a-z]:[\\/].*)$/i);

  if (driveVerbatimMatch) {
    return collapseFunctionalRepoPathToCoreRepoPath(driveVerbatimMatch[1].trim());
  }

  return collapseFunctionalRepoPathToCoreRepoPath(cleaned);
}

function getWorkspaceRootIdentity(value) {
  const cleaned = cleanWorkspaceRootDirectory(value).replace(/\\/g, "/");

  if (!cleaned) {
    return "";
  }

  const withoutTrailingSlash = cleaned === "/"
    ? cleaned
    : cleaned.replace(/\/+$/g, "");

  return withoutTrailingSlash.toLowerCase();
}

function workspaceRootDirectoryMatches(left, right) {
  if (left === right) {
    return true;
  }

  const leftIdentity = getWorkspaceRootIdentity(left);
  const rightIdentity = getWorkspaceRootIdentity(right);
  return Boolean(leftIdentity && rightIdentity && leftIdentity === rightIdentity);
}

function shortSha(value) {
  const sha = text(value);
  return sha ? sha.slice(0, 8) : "no head";
}

function repoLabel(repo) {
  return text(repo?.relativePath) || text(repo?.name, "Repository");
}

function repoMeta(repo) {
  const parts = [text(repo?.branch), shortSha(repo?.headSha)];
  const ahead = numberValue(repo?.ahead);
  const behind = numberValue(repo?.behind);
  if (ahead || behind) parts.push(`${ahead} ahead / ${behind} behind`);
  return parts.filter(Boolean).join(" · ");
}

function repoChangeSummary(repo) {
  const counts = repo?.statusCounts || {};
  const total = numberValue(counts.total);
  if (!total) return "Clean";
  const parts = [];
  const staged = numberValue(counts.staged);
  const unstaged = numberValue(counts.unstaged);
  const untracked = numberValue(counts.untracked);
  const conflicted = numberValue(counts.conflicted);
  if (staged) parts.push(`${staged} staged`);
  if (unstaged) parts.push(`${unstaged} modified`);
  if (untracked) parts.push(`${untracked} untracked`);
  if (conflicted) parts.push(`${conflicted} conflicted`);
  return parts.length ? parts.join(" · ") : `${total} changed`;
}

function historyFileCode(file) {
  const status = text(file?.status, "M");
  const match = status.match(/^[A-Z?]+/);
  return (match?.[0] || status).slice(0, 2);
}

function historyFileLabel(file) {
  const status = text(file?.status).toUpperCase();
  if (status.startsWith("A") || status === "??") return "Added";
  if (status.startsWith("C")) return "Copied";
  if (status.startsWith("D")) return "Deleted";
  if (status.startsWith("R")) return "Renamed";
  if (status.startsWith("T")) return "Type changed";
  if (status.startsWith("U")) return "Conflicted";
  return "Modified";
}

const WORKING_TREE_HISTORY_KEY = "__working_tree_changes__";
const REPOSITORY_PRELOAD_LOADING_STALE_MS = 15000;

function repositoryPreloadLoadingStale(preload, nowMs = Date.now()) {
  if (!preload || preload.state !== "loading") {
    return false;
  }
  const requestedAtMs = numberValue(preload.requestedAtMs || preload.generatedAtMs);
  return requestedAtMs > 0 && nowMs - requestedAtMs >= REPOSITORY_PRELOAD_LOADING_STALE_MS;
}

function filePathName(path) {
  const normalized = text(path);
  if (!normalized) return "file";
  return normalized.split("/").filter(Boolean).pop() || normalized;
}

function filePathDirectory(path) {
  const normalized = text(path);
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "";
  return parts.slice(0, -1).join("/");
}

function changeFileCode(file) {
  return text(file?.code || file?.status, "M").slice(0, 2);
}

function fileExtension(path) {
  const leaf = filePathName(path).toLowerCase();
  const index = leaf.lastIndexOf(".");
  return index > 0 ? leaf.slice(index + 1) : "";
}

function fileNameLower(path) {
  return filePathName(path).toLowerCase();
}

function fileIconMeta(path) {
  const extension = fileExtension(path);
  const fileName = fileNameLower(path);

  if (fileName === ".gitignore" || fileName === ".gitattributes" || fileName === ".gitmodules") {
    return { codicon: "codicon-git-branch", tone: "git" };
  }
  if (fileName === "cargo.toml" || fileName === "cargo.lock") {
    return { label: "RS", tone: "rust" };
  }
  if (fileName === "package.json" || fileName === "package-lock.json") {
    return { codicon: "codicon-json", tone: "npm" };
  }

  return ({
    css: { label: "CSS", tone: "style" },
    html: { label: "HTML", tone: "markup" },
    js: { label: "JS", tone: "javascript" },
    json: { codicon: "codicon-json", tone: "data" },
    jsx: { label: "JSX", tone: "react" },
    md: { codicon: "codicon-markdown", tone: "markdown" },
    py: { label: "PY", tone: "python" },
    rs: { label: "RS", tone: "rust" },
    scss: { label: "CSS", tone: "style" },
    ts: { label: "TS", tone: "typescript" },
    tsx: { label: "TSX", tone: "react" },
    toml: { codicon: "codicon-settings-gear", tone: "config" },
    yml: { codicon: "codicon-symbol-array", tone: "data" },
    yaml: { codicon: "codicon-symbol-array", tone: "data" },
  })[extension] || { codicon: "codicon-file", tone: "file" };
}

function statusMarkFromCode(code) {
  const status = text(code, "M").toUpperCase();
  if (status === "??") return "U";
  if (status.includes("U")) return "!";
  if (status.includes("A")) return "A";
  if (status.includes("D")) return "D";
  if (status.includes("R")) return "R";
  if (status.includes("C")) return "C";
  if (status.includes("T")) return "T";
  return "M";
}

function changeGitStatus(file) {
  const kind = text(file?.kind).toLowerCase();
  if (kind === "added") return "added";
  if (kind === "untracked") return "untracked";
  if (kind === "deleted") return "deleted";
  if (kind === "renamed") return "renamed";
  if (kind === "copied") return "copied";
  if (kind === "conflicted") return "conflicted";
  return "modified";
}

function historyGitStatus(file) {
  const label = historyFileLabel(file).toLowerCase();
  if (label === "added") return "added";
  if (label === "copied") return "copied";
  if (label === "deleted") return "deleted";
  if (label === "renamed") return "renamed";
  if (label === "conflicted") return "conflicted";
  return "modified";
}

// --- VS Code-style commit graph -------------------------------------------
// History rows render like VS Code's Source Control Graph: a lane column with
// colored dots and branch/merge curves, the commit subject, ref badges, and
// author/time/sha on the right. Lanes are computed from parent topology.

const GRAPH_LANE_WIDTH = 11;
const GRAPH_ROW_HEIGHT = 24;
const GRAPH_EDGE_PAD = 5;
// VS Code source-control graph chart palette, cycled per lane.
const GRAPH_LANE_COLORS = [
  "#3794ff",
  "#f14c4c",
  "#3fb950",
  "#cca700",
  "#b180d7",
  "#29b8db",
  "#ff8c00",
  "#75beff",
];

function graphLaneColor(laneIndex) {
  const safe = Number.isInteger(laneIndex) && laneIndex >= 0 ? laneIndex : 0;
  return GRAPH_LANE_COLORS[safe % GRAPH_LANE_COLORS.length];
}

function graphLaneX(laneIndex) {
  return GRAPH_EDGE_PAD + GRAPH_LANE_WIDTH / 2 + laneIndex * GRAPH_LANE_WIDTH;
}

function graphColumnWidthFor(maxLanes) {
  return GRAPH_EDGE_PAD * 2 + Math.max(1, maxLanes) * GRAPH_LANE_WIDTH;
}

function commitParentShas(commit) {
  if (Array.isArray(commit?.parents)) {
    return commit.parents.map((parent) => text(parent)).filter(Boolean);
  }
  return text(commit?.parents).split(/\s+/).filter(Boolean);
}

function relativeCommitTime(value) {
  const timestamp = Date.parse(text(value));
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.floor(Math.max(0, Date.now() - timestamp) / 60000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  return `${Math.floor(days / 365)}y`;
}

// Classic lane tracker: each lane waits for a sha. A commit lands on the
// first lane waiting for it (others waiting for it curve into the same dot),
// its first parent keeps the lane, and extra parents fork to existing or new
// lanes. Snapshots without parent data degrade to a single linear lane.
function buildHistoryGraph(history) {
  const rows = [];
  const lanes = [];
  const hasParentData = history.some((commit) => commitParentShas(commit).length > 0);

  history.forEach((commit, index) => {
    const sha = text(commit?.sha);
    const parents = hasParentData
      ? commitParentShas(commit)
      : (history[index + 1] ? [text(history[index + 1].sha)].filter(Boolean) : []);

    const joinLanes = [];
    lanes.forEach((expected, laneIndex) => {
      if (expected && expected === sha) joinLanes.push(laneIndex);
    });
    let lane = joinLanes.length ? joinLanes[0] : lanes.indexOf(null);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(null);
    }
    const ownTop = joinLanes.length > 0;
    const joinCurves = joinLanes.slice(1);
    joinCurves.forEach((laneIndex) => {
      lanes[laneIndex] = null;
    });

    const passLanes = [];
    lanes.forEach((expected, laneIndex) => {
      if (laneIndex !== lane && expected) passLanes.push(laneIndex);
    });

    const forkCurves = [];
    if (parents.length) {
      lanes[lane] = parents[0];
      parents.slice(1).forEach((parent) => {
        let target = lanes.findIndex((expected) => expected === parent);
        if (target === -1) {
          target = lanes.indexOf(null);
          if (target === -1) {
            target = lanes.length;
            lanes.push(parent);
          } else {
            lanes[target] = parent;
          }
        }
        if (target !== lane) forkCurves.push(target);
      });
    } else {
      lanes[lane] = null;
    }

    const continueLanes = [];
    lanes.forEach((expected, laneIndex) => {
      if (expected) continueLanes.push(laneIndex);
    });
    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }
    const laneCount = Math.max(
      lanes.length,
      ...[lane, ...passLanes, ...joinCurves, ...forkCurves].map((laneIndex) => laneIndex + 1),
    );

    rows.push({
      commit,
      continueLanes,
      forkCurves,
      joinCurves,
      lane,
      laneCount,
      ownBottom: parents.length > 0,
      ownTop,
      passLanes,
    });
  });

  const maxLanes = rows.reduce((max, row) => Math.max(max, row.laneCount), 1);
  return { maxLanes, rows };
}

function HistoryGraphCell({ maxLanes, row, variant = "commit" }) {
  const width = graphColumnWidthFor(maxLanes);
  const height = GRAPH_ROW_HEIGHT;
  const midY = height / 2;
  const dotX = graphLaneX(row.lane);
  const ownColor = graphLaneColor(row.lane);
  const dashed = variant === "uncommitted";
  return (
    <GraphSvg
      aria-hidden="true"
      height={height}
      preserveAspectRatio="xMinYMid meet"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      {row.passLanes.map((laneIndex) => (
        <line
          key={`pass-${laneIndex}`}
          stroke={graphLaneColor(laneIndex)}
          strokeWidth="2"
          x1={graphLaneX(laneIndex)}
          x2={graphLaneX(laneIndex)}
          y1="0"
          y2={height}
        />
      ))}
      {row.ownTop && (
        <line
          stroke={ownColor}
          strokeDasharray={row.topDashed ? "2 3" : undefined}
          strokeWidth="2"
          x1={dotX}
          x2={dotX}
          y1="0"
          y2={midY}
        />
      )}
      {row.ownBottom && (
        <line
          stroke={ownColor}
          strokeDasharray={dashed ? "2 3" : undefined}
          strokeWidth="2"
          x1={dotX}
          x2={dotX}
          y1={midY}
          y2={height}
        />
      )}
      {row.joinCurves.map((laneIndex) => (
        <path
          d={`M ${graphLaneX(laneIndex)} 0 C ${graphLaneX(laneIndex)} ${midY * 0.8}, ${dotX} ${midY * 0.2}, ${dotX} ${midY}`}
          fill="none"
          key={`join-${laneIndex}`}
          stroke={graphLaneColor(laneIndex)}
          strokeWidth="2"
        />
      ))}
      {row.forkCurves.map((laneIndex) => (
        <path
          d={`M ${dotX} ${midY} C ${dotX} ${height - midY * 0.2}, ${graphLaneX(laneIndex)} ${midY + midY * 0.2}, ${graphLaneX(laneIndex)} ${height}`}
          fill="none"
          key={`fork-${laneIndex}`}
          stroke={graphLaneColor(laneIndex)}
          strokeWidth="2"
        />
      ))}
      {dashed ? (
        <circle
          cx={dotX}
          cy={midY}
          fill="var(--git-vscode-sidebar)"
          r="3.4"
          stroke={ownColor}
          strokeDasharray="2 2"
          strokeWidth="1.6"
        />
      ) : (
        <circle
          cx={dotX}
          cy={midY}
          fill={ownColor}
          r="3.6"
          stroke="var(--git-vscode-sidebar)"
          strokeWidth="1.4"
        />
      )}
    </GraphSvg>
  );
}

function GraphContinuationLines({ dashed = false, lanes }) {
  return (
    <GraphContinuation aria-hidden="true">
      {lanes.map((laneIndex) => (
        <i
          data-dashed={dashed ? "true" : undefined}
          key={laneIndex}
          style={{
            "--git-lane-color": graphLaneColor(laneIndex),
            left: `${graphLaneX(laneIndex) - 1}px`,
          }}
        />
      ))}
    </GraphContinuation>
  );
}

export default function GitWorkspaceView({
  onRefreshRepositories = null,
  onRefreshSnapshot = null,
  repositoriesPreload = null,
  rootDirectory = "",
  snapshotsPreload = null,
  workspace = null,
  workspaceError = "",
}) {
  const [repositoriesState, setRepositoriesState] = useState("idle");
  const [repositoriesError, setRepositoriesError] = useState("");
  const [repositories, setRepositories] = useState([]);
  const [selectedRepoPath, setSelectedRepoPath] = useState("");
  const [snapshotState, setSnapshotState] = useState("idle");
  const [snapshotError, setSnapshotError] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [expandedHistoryKeys, setExpandedHistoryKeys] = useState(() => new Set());
  const [initializeRepositoryState, setInitializeRepositoryState] = useState("idle");
  const [commitMessage, setCommitMessage] = useState("");
  const [commitState, setCommitState] = useState("idle");
  const [commitError, setCommitError] = useState("");
  const [commitNotice, setCommitNotice] = useState("");
  const repoRailRef = useRef(null);
  const repoRailDragRef = useRef({
    active: false,
    consumeClick: false,
    moved: false,
    pointerId: null,
    startScrollLeft: 0,
    startX: 0,
  });
  const [repoRailDragging, setRepoRailDragging] = useState(false);
  const workspaceId = workspace?.id || "";
  const preloadMatches = Boolean(
    repositoriesPreload
      && repositoriesPreload.workspaceId === workspaceId
      && workspaceRootDirectoryMatches(repositoriesPreload.rootDirectory, rootDirectory),
  );
  const snapshotsPreloadMatches = Boolean(
    snapshotsPreload
      && snapshotsPreload.workspaceId === workspaceId
      && workspaceRootDirectoryMatches(snapshotsPreload.rootDirectory, rootDirectory)
      && snapshotsPreload.snapshots
      && typeof snapshotsPreload.snapshots === "object",
  );
  const selectedSnapshotEntry = selectedRepoPath && snapshotsPreloadMatches
    ? snapshotsPreload.snapshots[selectedRepoPath] || null
    : null;
  const selectedSnapshotSignature = [
    snapshotsPreload?.checkKey || "",
    snapshotsPreload?.state || "",
    selectedSnapshotEntry?.state || "",
    selectedSnapshotEntry?.error || "",
    Number(selectedSnapshotEntry?.generatedAtMs) || 0,
    Number(selectedSnapshotEntry?.repositoryGeneratedAtMs) || 0,
    Number(selectedSnapshotEntry?.snapshot?.generatedAtMs) || 0,
    selectedSnapshotEntry?.snapshot?.repo?.headSha || "",
    Array.isArray(selectedSnapshotEntry?.snapshot?.history) ? selectedSnapshotEntry.snapshot.history.length : -1,
    Array.isArray(selectedSnapshotEntry?.snapshot?.status?.files) ? selectedSnapshotEntry.snapshot.status.files.length : -1,
  ].join(":");
  const preloadSignature = [
    repositoriesPreload?.checkKey || "",
    repositoriesPreload?.state || "",
    Number(repositoriesPreload?.requestedAtMs) || 0,
    Number(repositoriesPreload?.generatedAtMs) || 0,
    Array.isArray(repositoriesPreload?.repositories) ? repositoriesPreload.repositories.length : -1,
    repositoriesPreload?.error || "",
  ].join(":");

  const changedFiles = useMemo(
    () => (Array.isArray(snapshot?.status?.files) ? snapshot.status.files : []),
    [snapshot],
  );
  const history = useMemo(
    () => (Array.isArray(snapshot?.history) ? snapshot.history : []),
    [snapshot],
  );
  const selectedRepo = useMemo(
    () => repositories.find((repo) => repo.path === selectedRepoPath) || null,
    [repositories, selectedRepoPath],
  );
  const historyGraph = useMemo(() => buildHistoryGraph(history), [history]);
  const graphColumnWidth = graphColumnWidthFor(historyGraph.maxLanes);
  const uncommittedGraphRow = useMemo(() => {
    const lane = historyGraph.rows[0]?.lane ?? 0;
    return {
      continueLanes: historyGraph.rows.length ? [lane] : [],
      forkCurves: [],
      joinCurves: [],
      lane,
      laneCount: lane + 1,
      ownBottom: historyGraph.rows.length > 0,
      ownTop: false,
      passLanes: [],
    };
  }, [historyGraph]);
  const operationBlocked = snapshot?.operationState && snapshot.operationState.clean === false;
  const hasChanges = changedFiles.length > 0;
  const commitBusy = commitState === "generating" || commitState === "committing";
  const canCommit = Boolean(hasChanges && !operationBlocked && commitMessage.trim() && !commitBusy);

  const loadSnapshot = useCallback(async (repoPath, options = {}) => {
    if (!repoPath) {
      setSnapshot(null);
      setSnapshotState("idle");
      setSnapshotError("");
      return null;
    }
    setSnapshotState("loading");
    setSnapshotError("");
    try {
      const result = typeof onRefreshSnapshot === "function"
        ? await onRefreshSnapshot({
          refresh: options.refresh === true,
          repoPath,
          rootDirectory,
          snapshot: options.snapshot || null,
          repositoryGeneratedAtMs: Number(repositoriesPreload?.generatedAtMs) || 0,
          workspaceId,
          workspaceName: workspace?.name || "",
        })
        : {
          snapshot: options.snapshot || await invoke("workspace_git_snapshot", { repoPath }),
        };
      const nextSnapshot = result?.snapshot || options.snapshot || null;
      setSnapshot(nextSnapshot);
      setSnapshotState("ready");
      return result;
    } catch (error) {
      setSnapshotError(error?.message || String(error));
      setSnapshotState("error");
      return null;
    }
  }, [
    onRefreshSnapshot,
    repositoriesPreload?.generatedAtMs,
    rootDirectory,
    workspace?.name,
    workspaceId,
  ]);

  const refreshRepositories = useCallback(async (options = {}) => {
    if (!rootDirectory || !workspaceId) {
      return null;
    }
    if (typeof onRefreshRepositories === "function") {
      return onRefreshRepositories({
        refresh: options.refresh === true,
        rootDirectory,
        workspaceId,
        workspaceName: workspace?.name || "",
      });
    }
    // No parent preload plumbing on this render path (defensive): load
    // directly so the Git tab can never sit in "Loading repositories..."
    // waiting for a preload prop that will never arrive.
    const response = await invoke("workspace_git_pull_candidates", {
      repoPath: rootDirectory,
      workspaceId,
      workspaceName: workspace?.name || "",
      refresh: options.refresh === true,
      fetchRemote: false,
    });
    const nextRepositories = Array.isArray(response?.repositories)
      ? response.repositories.filter((repo) => repo && repo.path)
      : [];
    setRepositories(nextRepositories);
    setSelectedRepoPath((current) => {
      if (current && nextRepositories.some((repo) => repo.path === current)) return current;
      return nextRepositories[0]?.path || "";
    });
    setRepositoriesError("");
    setRepositoriesState("ready");
    return { allRepositories: nextRepositories, response };
  }, [onRefreshRepositories, rootDirectory, workspace?.name, workspaceId]);

  const handleRetryRepositories = useCallback(() => {
    setRepositoriesState("loading");
    setRepositoriesError("");
    void refreshRepositories({ refresh: true }).catch((error) => {
      setRepositoriesError(error?.message || String(error || "Unable to load Git repositories."));
      setRepositoriesState("error");
    });
  }, [refreshRepositories]);

  const handleInitializeRepository = useCallback(async () => {
    if (!rootDirectory || initializeRepositoryState === "running") {
      return;
    }

    setInitializeRepositoryState("running");
    setRepositoriesError("");
    try {
      await invoke("workspace_initialize_git", { repoPath: rootDirectory });
      if (typeof onRefreshRepositories === "function") {
        setRepositoriesState("loading");
        await refreshRepositories({ refresh: true });
      }
    } catch (error) {
      setRepositoriesError(error?.message || String(error || "Unable to initialize Git repository."));
      setRepositoriesState("error");
    } finally {
      setInitializeRepositoryState("idle");
    }
  }, [
    initializeRepositoryState,
    onRefreshRepositories,
    refreshRepositories,
    rootDirectory,
  ]);

  useEffect(() => {
    if (!preloadMatches || !repositoriesPreload || repositoriesPreload.state !== "loading") {
      return undefined;
    }
    const requestedAtMs = numberValue(repositoriesPreload.requestedAtMs || repositoriesPreload.generatedAtMs);
    if (!requestedAtMs || repositoryPreloadLoadingStale(repositoriesPreload)) {
      return undefined;
    }
    const delayMs = Math.max(0, REPOSITORY_PRELOAD_LOADING_STALE_MS - (Date.now() - requestedAtMs));
    const timer = window.setTimeout(() => {
      void refreshRepositories();
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [preloadMatches, preloadSignature, refreshRepositories, repositoriesPreload]);

  useEffect(() => {
    const shouldRecoverStaleLoading = preloadMatches
      && repositoryPreloadLoadingStale(repositoriesPreload);
    if (
      (preloadMatches && !shouldRecoverStaleLoading)
      || !rootDirectory
      || !workspaceId
    ) {
      return undefined;
    }
    let cancelled = false;
    setRepositoriesState("loading");
    setRepositoriesError("");
    refreshRepositories().catch((error) => {
      if (cancelled) {
        return;
      }
      setRepositoriesError(error?.message || String(error || "Unable to load Git repositories."));
      setRepositoriesState("error");
    });
    return () => {
      cancelled = true;
    };
  }, [
    onRefreshRepositories,
    preloadMatches,
    refreshRepositories,
    rootDirectory,
    workspaceId,
  ]);

  useEffect(() => {
    if (!preloadMatches) {
      return;
    }
    const nextRepositories = Array.isArray(repositoriesPreload?.repositories)
      ? repositoriesPreload.repositories
      : [];
    setRepositories(nextRepositories);
    setRepositoriesError(repositoriesPreload?.error || "");
    setSelectedRepoPath((current) => {
      if (current && nextRepositories.some((repo) => repo.path === current)) return current;
      return nextRepositories[0]?.path || "";
    });
    if (repositoriesPreload?.state === "error") {
      setRepositoriesState("error");
    } else if (
      repositoriesPreload?.state === "loading"
      && repositoryPreloadLoadingStale(repositoriesPreload)
    ) {
      setRepositoriesError("Git repository check timed out.");
      setRepositoriesState("error");
    } else {
      setRepositoriesState(repositoriesPreload?.state === "loading" ? "loading" : "ready");
    }
  }, [preloadMatches, preloadSignature, repositoriesPreload]);

  useEffect(() => {
    if (preloadMatches) {
      return;
    }
    setRepositories([]);
    setSelectedRepoPath("");
    setRepositoriesError("");
    setRepositoriesState(rootDirectory && workspaceId ? "loading" : "idle");
  }, [preloadMatches, rootDirectory, workspaceId]);

  useEffect(() => {
    setSnapshot(null);
    setExpandedHistoryKeys(new Set());
    setCommitMessage("");
    setInitializeRepositoryState("idle");
    setCommitState("idle");
    setCommitError("");
    setCommitNotice("");
  }, [rootDirectory, selectedRepoPath, workspaceId]);

  useEffect(() => {
    if (!selectedRepoPath) {
      setSnapshot(null);
      setSnapshotState("idle");
      setSnapshotError("");
      return;
    }

    const nextSnapshot = selectedSnapshotEntry?.snapshot || null;
    setSnapshot(nextSnapshot);
    setSnapshotError(selectedSnapshotEntry?.error || "");

    if (selectedSnapshotEntry?.state === "error") {
      setSnapshotState("error");
    } else if (selectedSnapshotEntry?.state === "loading") {
      setSnapshotState("loading");
    } else if (nextSnapshot) {
      setSnapshotState("ready");
    } else if (snapshotsPreloadMatches && repositoriesPreload?.state === "ready") {
      setSnapshotState("loading");
    } else {
      setSnapshotState("idle");
    }
  }, [
    repositoriesPreload?.state,
    selectedRepoPath,
    selectedSnapshotEntry,
    selectedSnapshotSignature,
    snapshotsPreloadMatches,
  ]);

  // Defensive twin of the repositories fallback: without parent snapshot
  // plumbing nothing else would ever fetch history for the selected repo.
  useEffect(() => {
    if (typeof onRefreshSnapshot === "function" || !selectedRepoPath) {
      return;
    }
    void loadSnapshot(selectedRepoPath);
  }, [loadSnapshot, onRefreshSnapshot, selectedRepoPath]);

  useEffect(() => {
    setExpandedHistoryKeys((current) => {
      const next = new Set();
      current.forEach((key) => {
        if (key === WORKING_TREE_HISTORY_KEY && hasChanges) {
          next.add(key);
        } else if (history.some((commit) => commit.sha === key)) {
          next.add(key);
        }
      });
      if (hasChanges) next.add(WORKING_TREE_HISTORY_KEY);
      return next;
    });
  }, [hasChanges, history]);

  useEffect(() => {
    if (!hasChanges) {
      setCommitMessage("");
      setCommitError("");
      return;
    }
    if (!selectedRepoPath || commitMessage.trim() || commitBusy) {
      return;
    }
    let cancelled = false;
    setCommitState("generating");
    setCommitError("");
    invoke("workspace_git_generate_commit_message", { repoPath: selectedRepoPath })
      .then((result) => {
        if (cancelled) return;
        const generated = text(result?.summary || result?.message);
        if (generated) setCommitMessage(generated);
      })
      .catch((error) => {
        if (!cancelled) {
          setCommitError(error?.message || String(error || "Unable to generate commit message."));
        }
      })
      .finally(() => {
        if (!cancelled) setCommitState("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [commitMessage, hasChanges, selectedRepoPath]);

  const toggleHistoryKey = useCallback((key) => {
    setExpandedHistoryKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const commitAndPush = useCallback(async () => {
    if (!selectedRepoPath || !canCommit) return;
    setCommitState("committing");
    setCommitError("");
    setCommitNotice("");
    try {
      const result = await invoke("workspace_git_commit_and_push", {
        message: commitMessage,
        push: true,
        repoPath: selectedRepoPath,
      });
      if (result?.snapshot) {
        await loadSnapshot(selectedRepoPath, { snapshot: result.snapshot });
      } else {
        await loadSnapshot(selectedRepoPath, { refresh: true });
      }
      setCommitMessage("");
      setCommitNotice(result?.pushed
        ? `Committed and pushed ${shortSha(result?.commitSha)}.`
        : `Committed ${shortSha(result?.commitSha)}.${result?.pushError ? ` Push failed: ${result.pushError}` : ""}`);
      await refreshRepositories({ refresh: true });
    } catch (error) {
      setCommitError(error?.message || String(error || "Unable to commit and push."));
    } finally {
      setCommitState("idle");
    }
  }, [canCommit, commitMessage, loadSnapshot, refreshRepositories, selectedRepoPath]);

  const selectRepository = useCallback((repoPath) => {
    if (repoRailDragRef.current.consumeClick) {
      repoRailDragRef.current.consumeClick = false;
      return;
    }
    setSelectedRepoPath(repoPath);
  }, []);

  // Native non-passive wheel listener: React's synthetic onWheel can be
  // registered passively in the WKWebView, which silently drops the
  // preventDefault and lets ancestors consume two-finger trackpad scrolls.
  useEffect(() => {
    const rail = repoRailRef.current;
    if (!rail) return undefined;
    const handleWheel = (event) => {
      if (rail.scrollWidth <= rail.clientWidth + 1) return;

      const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
      if (!raw) return;
      // Mice/webviews that report line- or page-mode deltas would otherwise
      // move ~1px per notch and feel like the rail isn't scrollable at all.
      const delta = event.deltaMode === 1
        ? raw * 16
        : event.deltaMode === 2
          ? raw * rail.clientWidth
          : raw;

      const maxScrollLeft = rail.scrollWidth - rail.clientWidth;
      const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, rail.scrollLeft + delta));
      if (nextScrollLeft === rail.scrollLeft) return;

      event.preventDefault();
      rail.scrollLeft = nextScrollLeft;
    };
    rail.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      rail.removeEventListener("wheel", handleWheel);
    };
  }, [repositories.length]);

  const handleRepoRailPointerDown = useCallback((event) => {
    const rail = repoRailRef.current;
    if (!rail || rail.scrollWidth <= rail.clientWidth + 1) return;
    // Primary mouse button (or touch/pen contact) only: right/middle presses
    // keep their native behavior.
    if (event.button !== 0) return;

    repoRailDragRef.current = {
      active: true,
      consumeClick: false,
      moved: false,
      pointerId: event.pointerId,
      startScrollLeft: rail.scrollLeft,
      startX: event.clientX,
    };
  }, []);

  const handleRepoRailPointerMove = useCallback((event) => {
    const rail = repoRailRef.current;
    const drag = repoRailDragRef.current;
    if (!rail || !drag.active || drag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - drag.startX;
    if (!drag.moved && Math.abs(deltaX) <= 3) {
      // Below the drag threshold this is still a click; capturing here would
      // retarget the click away from the repo button under the pointer.
      return;
    }
    if (!drag.moved) {
      drag.moved = true;
      drag.consumeClick = true;
      setRepoRailDragging(true);
      rail.setPointerCapture?.(event.pointerId);
    }
    event.preventDefault();
    rail.scrollLeft = drag.startScrollLeft - deltaX;
  }, []);

  const endRepoRailDrag = useCallback((event) => {
    const rail = repoRailRef.current;
    const drag = repoRailDragRef.current;
    if (!drag.active || drag.pointerId !== event.pointerId) return;

    repoRailDragRef.current = {
      ...drag,
      active: false,
      pointerId: null,
    };
    if (drag.moved) {
      window.setTimeout(() => {
        repoRailDragRef.current.consumeClick = false;
      }, 180);
    }
    setRepoRailDragging(false);
    rail?.releasePointerCapture?.(event.pointerId);
  }, []);

  if (!rootDirectory || !workspace) {
    return (
      <GitSurface>
        <GitEmpty>Select a workspace to inspect Git repositories.</GitEmpty>
      </GitSurface>
    );
  }

  return (
    <GitSurface aria-label="Workspace Git">
      {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
      {repositoriesError && <FormMessage $state="error">{repositoriesError}</FormMessage>}
      {snapshotError && <FormMessage $state="error">{snapshotError}</FormMessage>}

      {repositories.length ? (
        <RepoRail
          aria-label="Git repositories"
          data-dragging={repoRailDragging ? "true" : undefined}
          onClickCapture={(event) => {
            // A drag that ends on top of a repo card is a scroll, not a pick.
            if (repoRailDragRef.current.consumeClick) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onPointerCancel={endRepoRailDrag}
          onPointerDown={handleRepoRailPointerDown}
          onPointerMove={handleRepoRailPointerMove}
          onPointerUp={endRepoRailDrag}
          ref={repoRailRef}
          role="list"
        >
          {repositories.map((repo) => {
            const active = repo.path === selectedRepoPath;
            const changeSummary = repoChangeSummary(repo);
            return (
              <RepoButton
                data-active={active ? "true" : undefined}
                data-dirty={repo.dirty ? "true" : undefined}
                key={repo.path}
                onClick={() => selectRepository(repo.path)}
                title={repo.path}
                type="button"
              >
                <strong>{repoLabel(repo)}</strong>
                <span>{repoMeta(repo)}</span>
                <em>{changeSummary}</em>
              </RepoButton>
            );
          })}
        </RepoRail>
      ) : null}

      {!repositories.length && (
        <GitEmpty>
          <span>
            {repositoriesState === "loading"
              ? "Loading repositories..."
              : repositoriesState === "error"
                ? "Unable to load Git repositories."
                : "No Git repositories found in this workspace."}
          </span>
          {repositoriesState === "error" && typeof onRefreshRepositories === "function" ? (
            <GitEmptyAction
              onClick={handleRetryRepositories}
              type="button"
            >
              Retry
            </GitEmptyAction>
          ) : null}
          {repositoriesState === "ready" ? (
            <GitEmptyAction
              disabled={initializeRepositoryState === "running"}
              onClick={handleInitializeRepository}
              type="button"
            >
              {initializeRepositoryState === "running" ? "Initializing..." : "Initialize Git repository"}
            </GitEmptyAction>
          ) : null}
        </GitEmpty>
      )}

      {selectedRepo ? (
        <GitBody>
          {operationBlocked && (
            <GitNotice data-state="warning">
              Repository is in {snapshot.operationState.state} state. Resolve it before committing from Diff Forge.
            </GitNotice>
          )}

          <CommitBar aria-label="Commit and push changes">
            <CommitInput
              disabled={!hasChanges || operationBlocked || commitBusy}
              onChange={(event) => setCommitMessage(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void commitAndPush();
                }
              }}
              placeholder={hasChanges ? "Commit message" : "Clean working tree"}
              value={commitMessage}
            />
            <CommitButton
              disabled={!canCommit}
              onClick={commitAndPush}
              title={hasChanges ? "Commit all changes and push" : "No changes to commit"}
              type="button"
            >
              {commitState === "committing" ? "Committing..." : "Commit & Push"}
            </CommitButton>
          </CommitBar>
          {commitError && <GitNotice data-state="error">{commitError}</GitNotice>}
          {commitNotice && <GitNotice>{commitNotice}</GitNotice>}

          <HistoryPane>
            <HistoryList style={{ "--git-graph-width": `${graphColumnWidth}px` }}>
              {hasChanges && (() => {
                const active = expandedHistoryKeys.has(WORKING_TREE_HISTORY_KEY);
                return (
                  <HistoryEntry data-active={active ? "true" : undefined} key={WORKING_TREE_HISTORY_KEY}>
                    <HistoryButton
                      data-active={active ? "true" : undefined}
                      aria-expanded={active}
                      onClick={() => toggleHistoryKey(WORKING_TREE_HISTORY_KEY)}
                      title="Uncommitted working tree changes"
                      type="button"
                    >
                      <HistoryGraphCell
                        maxLanes={historyGraph.maxLanes}
                        row={uncommittedGraphRow}
                        variant="uncommitted"
                      />
                      <HistoryCommitLine>
                        <strong data-uncommitted="true">Changes</strong>
                      </HistoryCommitLine>
                      <HistoryMeta>
                        <span>{changedFiles.length} file{changedFiles.length === 1 ? "" : "s"}</span>
                      </HistoryMeta>
                      <HistoryToggleIcon aria-hidden="true" data-open={active ? "true" : undefined}>›</HistoryToggleIcon>
                    </HistoryButton>
                    {active && (
                      <HistoryFileList>
                        <GraphContinuationLines dashed lanes={uncommittedGraphRow.continueLanes} />
                        {changedFiles.map((file) => {
                          const icon = fileIconMeta(file.path);
                          const gitStatus = changeGitStatus(file);
                          return (
                            <GitFileItem
                              data-git-status={gitStatus}
                              key={`${file.code}:${file.path}:${file.oldPath || ""}`}
                              title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
                            >
                              <GitFileIcon data-file-tone={icon.tone} data-git-status={gitStatus}>
                                {icon.label ? (
                                  <span>{icon.label}</span>
                                ) : (
                                  <span className={`codicon ${icon.codicon}`} />
                                )}
                              </GitFileIcon>
                              <GitFileName>
                                <strong>{filePathName(file.path)}</strong>
                                {filePathDirectory(file.path) && <em>{filePathDirectory(file.path)}</em>}
                              </GitFileName>
                              <GitFileStatusMark data-git-status={gitStatus}>{statusMarkFromCode(changeFileCode(file))}</GitFileStatusMark>
                            </GitFileItem>
                          );
                        })}
                      </HistoryFileList>
                    )}
                  </HistoryEntry>
                );
              })()}
              {historyGraph.rows.length ? historyGraph.rows.map((row, rowIndex) => {
                const commit = row.commit;
                const active = expandedHistoryKeys.has(commit.sha);
                const files = Array.isArray(commit.files) ? commit.files : [];
                const relativeTime = relativeCommitTime(commit.date);
                // The dashed line from the uncommitted-changes dot continues
                // into the HEAD commit's dot, like VS Code.
                const renderRow = rowIndex === 0 && hasChanges
                  ? { ...row, ownTop: true, topDashed: true }
                  : row;
                return (
                  <HistoryEntry data-active={active ? "true" : undefined} key={commit.sha}>
                    <HistoryButton
                      data-active={active ? "true" : undefined}
                      aria-expanded={active}
                      onClick={() => toggleHistoryKey(commit.sha)}
                      title={[commit.subject, commit.authorName, commit.date].filter(Boolean).join(" — ")}
                      type="button"
                    >
                      <HistoryGraphCell maxLanes={historyGraph.maxLanes} row={renderRow} />
                      <HistoryCommitLine>
                        <strong>{commit.subject}</strong>
                      </HistoryCommitLine>
                      <HistoryMeta>
                        {commit.authorName ? <em>{commit.authorName}</em> : null}
                        {relativeTime ? <span>{relativeTime}</span> : null}
                        <code>{commit.shortSha || shortSha(commit.sha)}</code>
                      </HistoryMeta>
                      <HistoryToggleIcon aria-hidden="true" data-open={active ? "true" : undefined}>›</HistoryToggleIcon>
                    </HistoryButton>
                    {active && (
                      <HistoryFileList>
                        <GraphContinuationLines lanes={row.continueLanes} />
                        {files.length ? files.map((file, index) => {
                          const icon = fileIconMeta(file.path);
                          const gitStatus = historyGitStatus(file);
                          return (
                            <GitFileItem
                              data-git-status={gitStatus}
                              key={`${commit.sha}:${file.path}:${index}`}
                              title={file.oldPath ? `${file.oldPath} -> ${file.path}` : file.path}
                            >
                              <GitFileIcon data-file-tone={icon.tone} data-git-status={gitStatus}>
                                {icon.label ? (
                                  <span>{icon.label}</span>
                                ) : (
                                  <span className={`codicon ${icon.codicon}`} />
                                )}
                              </GitFileIcon>
                              <GitFileName>
                                <strong>{filePathName(file.path)}</strong>
                                {filePathDirectory(file.path) && <em>{filePathDirectory(file.path)}</em>}
                              </GitFileName>
                              <GitFileStatusMark data-git-status={gitStatus}>
                                {statusMarkFromCode(historyFileCode(file))}
                              </GitFileStatusMark>
                            </GitFileItem>
                          );
                        }) : (
                          <GitTreeEmpty>No files recorded for this commit.</GitTreeEmpty>
                        )}
                      </HistoryFileList>
                    )}
                  </HistoryEntry>
                );
              }) : (
                <GitEmpty>{snapshotState === "loading" ? "Loading history..." : "No commits recorded yet."}</GitEmpty>
              )}
            </HistoryList>
          </HistoryPane>
        </GitBody>
      ) : null}
    </GitSurface>
  );
}

const GitSurface = styled.section`
  --git-vscode-sidebar: var(--forge-bg, #070b10);
  --git-vscode-border: var(--forge-border, rgba(148, 163, 184, 0.16));
  --git-vscode-border-subtle: rgba(148, 163, 184, 0.1);
  --git-vscode-dotted: rgba(148, 163, 184, 0.46);
  --git-vscode-hover: rgba(148, 163, 184, 0.1);
  --git-vscode-selection: rgba(37, 99, 235, 0.34);
  --git-vscode-selection-text: var(--forge-text, #f8fafc);
  --git-vscode-text: var(--forge-text, #dbe7f7);
  --git-vscode-text-muted: var(--forge-text-muted, #8ea0b8);
  --git-vscode-blue: #3794ff;
  --git-vscode-focus: #007fd4;
  --git-card-bg: rgba(15, 23, 42, 0.58);
  --git-card-bg-active: rgba(30, 64, 175, 0.22);

  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 0;
  padding: 0;
  color: var(--git-vscode-text);
  background: var(--git-vscode-sidebar);
  font-size: 13px;
  overflow: hidden;

  html[data-forge-theme="light"] & {
    --git-vscode-sidebar: var(--forge-bg, #ffffff);
    --git-vscode-border: var(--forge-border, rgba(0, 0, 0, 0.1));
    --git-vscode-border-subtle: rgba(0, 0, 0, 0.08);
    --git-vscode-dotted: rgba(0, 0, 0, 0.34);
    --git-vscode-hover: rgba(15, 23, 42, 0.06);
    --git-vscode-selection: rgba(59, 130, 246, 0.18);
    --git-vscode-selection-text: var(--forge-text, #1d1d1f);
    --git-vscode-text: var(--forge-text, #1d1d1f);
    --git-vscode-text-muted: var(--forge-text-muted, #6e6e6e);
    --git-vscode-blue: #006ab1;
    --git-vscode-focus: #007fd4;
    --git-card-bg: rgba(15, 23, 42, 0.035);
    --git-card-bg-active: rgba(59, 130, 246, 0.14);
  }
`;

const RepoRail = styled.div`
  display: flex;
  flex: 0 0 auto;
  align-items: flex-start;
  flex-wrap: nowrap;
  min-width: 0;
  gap: 6px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 6px 8px;
  border-bottom: 1px solid var(--git-vscode-border-subtle);
  cursor: grab;
  overscroll-behavior-x: contain;
  scrollbar-color: color-mix(in srgb, var(--git-vscode-blue) 46%, transparent) transparent;
  scrollbar-width: thin;
  touch-action: pan-x;
  user-select: none;
  -webkit-overflow-scrolling: touch;

  &[data-dragging="true"] {
    cursor: grabbing;
  }

  &::-webkit-scrollbar {
    height: 8px;
  }

  &::-webkit-scrollbar-track {
    background: transparent;
  }

  &::-webkit-scrollbar-thumb {
    border: 2px solid transparent;
    border-radius: 999px;
    background: color-mix(in srgb, var(--git-vscode-blue) 42%, rgba(148, 163, 184, 0.28));
    background-clip: padding-box;
  }
`;

const RepoButton = styled.button`
  display: grid;
  /* Grow into free rail space (so one or two repos don't truncate their
     change summary against a hard 128px cap) but keep a compact basis so
     many repos still overflow into a horizontally scrollable rail. */
  flex: 1 0 128px;
  max-width: 224px;
  min-width: 0;
  min-height: 0;
  align-content: start;
  gap: 2px;
  padding: 5px 8px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 7px;
  color: var(--git-vscode-text);
  background: var(--git-card-bg);
  box-shadow: none;
  cursor: pointer;
  text-align: left;
  transition:
    border-color 140ms ease,
    background 140ms ease,
    box-shadow 140ms ease;

  strong,
  span,
  em {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--git-vscode-selection-text);
    font-size: 10.5px;
    font-weight: 850;
  }

  span {
    color: var(--git-vscode-text-muted);
    font-size: 9.5px;
    font-weight: 720;
  }

  em {
    color: color-mix(in srgb, var(--git-vscode-text) 76%, transparent);
    font-size: 9.5px;
    font-style: normal;
    font-weight: 760;
  }

  &:hover {
    border-color: color-mix(in srgb, var(--git-vscode-blue) 42%, var(--git-vscode-border));
    background: var(--git-vscode-hover);
  }

  &[data-dirty="true"] {
    border-color: rgba(245, 158, 11, 0.44);
  }

  &[data-active="true"] {
    border-color: rgba(125, 176, 255, 0.54);
    color: var(--git-vscode-selection-text);
    background: var(--git-card-bg-active);
    box-shadow:
      0 0 0 1px rgba(79, 163, 255, 0.22),
      inset 0 0 0 1px rgba(125, 176, 255, 0.08);
  }

  &[data-active="true"] strong {
    color: var(--git-vscode-selection-text);
  }

  &[data-active="true"] span,
  &[data-active="true"] em {
    color: rgba(203, 213, 225, 0.82);
  }
`;

const GitBody = styled.div`
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  gap: 0;
  overflow: hidden;
`;

const CommitBar = styled.div`
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  min-width: 0;
  padding: 8px 10px;
  border-bottom: 1px solid var(--git-vscode-border-subtle);
  background: rgba(2, 6, 23, 0.12);
`;

const CommitInput = styled.input`
  width: 100%;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--git-vscode-border);
  border-radius: 8px;
  color: var(--git-vscode-text);
  background: rgba(2, 6, 23, 0.38);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  outline: none;

  &::placeholder {
    color: color-mix(in srgb, var(--git-vscode-text-muted) 78%, transparent);
  }

  &:focus {
    border-color: color-mix(in srgb, var(--git-vscode-blue) 72%, var(--git-vscode-border));
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--git-vscode-blue) 14%, transparent);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.58;
  }
`;

const CommitButton = styled.button`
  flex: 0 0 auto;
  min-width: 112px;
  height: 32px;
  padding: 0 11px;
  border: 1px solid color-mix(in srgb, var(--git-vscode-blue) 56%, var(--git-vscode-border));
  border-radius: 8px;
  color: var(--git-vscode-selection-text);
  background: color-mix(in srgb, var(--git-vscode-blue) 28%, rgba(15, 23, 42, 0.64));
  font: inherit;
  font-size: 11px;
  font-weight: 850;
  cursor: pointer;
  white-space: nowrap;

  &:hover:not(:disabled) {
    background: color-mix(in srgb, var(--git-vscode-blue) 38%, rgba(15, 23, 42, 0.64));
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

const GitFileItem = styled.div`
  display: grid;
  height: 22px;
  min-height: 22px;
  min-width: 0;
  grid-template-columns: 22px minmax(0, 1fr) 22px;
  align-items: center;
  gap: 3px;
  padding: 0 7px 0 20px;
  color: var(--git-vscode-text);

  &:hover {
    background: var(--git-vscode-hover);
  }
`;

const GitFileIcon = styled.span`
  display: grid;
  width: 20px;
  height: 22px;
  place-items: center;
  color: var(--git-vscode-text-muted);

  .codicon {
    font-size: 16px;
  }

  > span:not(.codicon) {
    display: block;
    overflow: hidden;
    width: 20px;
    font-size: 10px;
    font-weight: 700;
    line-height: 22px;
    text-align: center;
    text-overflow: clip;
    white-space: nowrap;
  }

  &[data-file-tone="javascript"],
  &[data-file-tone="npm"] {
    color: #cbcb41;
  }

  &[data-file-tone="typescript"] {
    color: #519aba;
  }

  &[data-file-tone="react"] {
    color: #4ec9b0;
  }

  &[data-file-tone="rust"] {
    color: #dea584;
  }

  &[data-file-tone="style"],
  &[data-file-tone="media"] {
    color: #c586c0;
  }

  &[data-file-tone="markup"],
  &[data-file-tone="markdown"] {
    color: #569cd6;
  }

  &[data-file-tone="data"] {
    color: #4fc1ff;
  }

  &[data-file-tone="config"],
  &[data-file-tone="file"] {
    color: #c5c5c5;
  }

  &[data-file-tone="python"],
  &[data-file-tone="git"] {
    color: #75beff;
  }
`;

const GitFileName = styled.div`
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 6px;

  strong,
  em {
    min-width: 0;
    overflow: hidden;
    line-height: 22px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--git-vscode-text);
    font-size: 12px;
    font-weight: 400;
  }

  em {
    flex: 1 1 auto;
    color: var(--git-vscode-text-muted);
    font-size: 11px;
    font-style: normal;
    font-weight: 400;
  }
`;

const GitFileStatusMark = styled.em`
  display: block;
  min-width: 0;
  overflow: hidden;
  color: var(--git-vscode-text-muted);
  font-size: 11px;
  font-style: normal;
  font-weight: 600;
  line-height: 22px;
  text-align: right;
  text-overflow: clip;
  white-space: nowrap;

  &[data-git-status="added"],
  &[data-git-status="copied"],
  &[data-git-status="untracked"] {
    color: #73c991;
  }

  &[data-git-status="modified"],
  &[data-git-status="renamed"] {
    color: #e2c08d;
  }

  &[data-git-status="deleted"],
  &[data-git-status="conflicted"] {
    color: #ff7b72;
  }
`;

const HistoryPane = styled.section`
  display: grid;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  grid-template-rows: minmax(0, 1fr);
  overflow: hidden;
`;

const HistoryList = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  min-height: 0;
  overflow: auto;
`;

const HistoryEntry = styled.article`
  display: grid;
  position: relative;
  min-width: 0;
`;

const GraphSvg = styled.svg`
  display: block;
  flex: none;
  align-self: center;
`;

// Lane lines continuing behind an expanded commit's file list, so the graph
// column reads as one continuous tree like VS Code's source control graph.
const GraphContinuation = styled.span`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  display: block;
  width: var(--git-graph-width, 40px);
  pointer-events: none;

  i {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--git-lane-color, var(--git-vscode-blue));
  }

  i[data-dashed="true"] {
    background: repeating-linear-gradient(
      180deg,
      var(--git-lane-color, var(--git-vscode-blue)) 0 3px,
      transparent 3px 6px
    );
  }
`;

const HistoryButton = styled.button`
  display: grid;
  width: 100%;
  height: 24px;
  min-height: 24px;
  min-width: 0;
  grid-template-columns: var(--git-graph-width, 40px) minmax(0, 1fr) auto 18px;
  align-items: center;
  padding: 0 4px 0 0;
  border: 0;
  border-radius: 0;
  color: var(--git-vscode-text);
  background: transparent;
  cursor: pointer;
  text-align: left;

  &:hover {
    background: var(--git-vscode-hover);
  }

  &[data-active="true"] {
    color: var(--git-vscode-selection-text);
    background: var(--git-vscode-selection);
  }

  &:focus-visible {
    outline: 1px solid var(--git-vscode-focus);
    outline-offset: -1px;
  }
`;

const HistoryCommitLine = styled.div`
  display: flex;
  height: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;

  strong {
    min-width: 0;
    overflow: hidden;
    color: inherit;
    font-size: 12px;
    font-weight: 400;
    line-height: 24px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong[data-uncommitted="true"] {
    color: var(--git-vscode-text-muted);
    font-style: italic;
  }
`;

const HistoryMeta = styled.div`
  display: flex;
  min-width: 0;
  max-width: 60%;
  align-items: center;
  gap: 7px;
  padding-left: 8px;

  em,
  span,
  code {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    color: var(--git-vscode-text-muted);
    font-size: 11px;
    font-style: normal;
    font-weight: 400;
    line-height: 24px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  em {
    max-width: 96px;
  }

  code {
    flex: none;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 10.5px;
  }

  ${HistoryButton}[data-active="true"] & em,
  ${HistoryButton}[data-active="true"] & span,
  ${HistoryButton}[data-active="true"] & code {
    color: color-mix(in srgb, var(--git-vscode-selection-text) 72%, transparent);
  }
`;

// VS Code-style ref decorations: branch / remote / tag pills colored by the
// commit's lane.
const HistoryToggleIcon = styled.span`
  display: grid;
  width: 18px;
  height: 18px;
  place-items: center;
  color: var(--git-vscode-text-muted);
  font-size: 17px;
  font-weight: 700;
  line-height: 1;
  transform: rotate(0deg);
  transition: transform 140ms ease;

  &[data-open="true"] {
    transform: rotate(90deg);
  }
`;

const HistoryFileList = styled.div`
  display: grid;
  position: relative;
  align-content: start;
  min-width: 0;
  padding: 0 0 4px var(--git-graph-width, 40px);

  ${GitFileItem} {
    padding-left: 0;
  }
`;

const GitNotice = styled.div`
  margin: 8px 10px 0;
  padding: 7px 8px;
  border: 1px solid var(--git-vscode-border);
  border-radius: 2px;
  color: var(--git-vscode-text);
  background: var(--git-vscode-hover);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.35;

  &[data-state="warning"] {
    border-color: rgba(245, 158, 11, 0.32);
    color: #fde68a;
    background: rgba(120, 53, 15, 0.2);
  }

  &[data-state="error"] {
    border-color: rgba(248, 113, 113, 0.32);
    color: #fecaca;
    background: rgba(127, 29, 29, 0.2);
  }
`;

const GitEmpty = styled.div`
  display: grid;
  min-height: 42px;
  gap: 8px;
  place-items: center;
  padding: 12px;
  color: var(--git-vscode-text-muted);
  font-size: 12px;
  font-weight: 400;
  text-align: center;
`;

const GitEmptyAction = styled.button`
  border: 1px solid var(--git-vscode-border);
  border-radius: 6px;
  padding: 5px 10px;
  color: var(--git-vscode-text);
  background: var(--git-card-bg);
  font: inherit;
  font-weight: 650;
  cursor: pointer;

  &:hover {
    border-color: rgba(125, 176, 255, 0.45);
    background: var(--git-vscode-hover);
  }

  &:disabled {
    cursor: wait;
    opacity: 0.65;
  }
`;

const GitTreeEmpty = styled.div`
  height: 24px;
  overflow: hidden;
  padding: 0 12px 0 20px;
  color: var(--git-vscode-text-muted);
  font-size: 12px;
  font-weight: 400;
  line-height: 24px;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

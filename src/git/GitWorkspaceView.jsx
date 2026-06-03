import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import { FormMessage } from "../app/appStyles";

function text(value, fallback = "") {
  const normalized = String(value || "").trim();
  return normalized || fallback;
}

function numberValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
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

function statusSummary(snapshot) {
  const counts = snapshot?.status?.counts || {};
  const total = numberValue(counts.total);
  if (!total) return "Clean working tree";
  const parts = [];
  const staged = numberValue(counts.staged);
  const unstaged = numberValue(counts.unstaged);
  const untracked = numberValue(counts.untracked);
  const conflicted = numberValue(counts.conflicted);
  if (staged) parts.push(`${staged} staged`);
  if (unstaged) parts.push(`${unstaged} unstaged`);
  if (untracked) parts.push(`${untracked} untracked`);
  if (conflicted) parts.push(`${conflicted} conflicted`);
  return parts.length ? `${total} changed · ${parts.join(" · ")}` : `${total} changed`;
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

export default function GitWorkspaceView({
  repositoriesPreload = null,
  rootDirectory = "",
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
  const [selectedCommitSha, setSelectedCommitSha] = useState("");
  const workspaceId = workspace?.id || "";
  const preloadMatches = Boolean(
    repositoriesPreload
      && repositoriesPreload.workspaceId === workspaceId
      && repositoriesPreload.rootDirectory === rootDirectory
      && Array.isArray(repositoriesPreload.repositories),
  );
  const preloadSignature = [
    repositoriesPreload?.checkKey || "",
    repositoriesPreload?.state || "",
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
  const operationBlocked = snapshot?.operationState && snapshot.operationState.clean === false;
  const hasChanges = changedFiles.length > 0;

  const loadSnapshot = useCallback(async (repoPath) => {
    if (!repoPath) {
      setSnapshot(null);
      setSnapshotState("idle");
      setSnapshotError("");
      return;
    }
    setSnapshotState("loading");
    setSnapshotError("");
    try {
      const result = await invoke("workspace_git_snapshot", { repoPath });
      setSnapshot(result);
      setSnapshotState("ready");
    } catch (error) {
      setSnapshotError(error?.message || String(error));
      setSnapshotState("error");
    }
  }, []);

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
    setRepositoriesState(repositoriesPreload?.state === "error"
      ? "error"
      : repositoriesPreload?.state === "loading"
        ? "loading"
        : "ready");
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
    setSelectedCommitSha("");
    void loadSnapshot(selectedRepoPath);
  }, [loadSnapshot, selectedRepoPath]);

  useEffect(() => {
    setSelectedCommitSha((current) => {
      if (current === WORKING_TREE_HISTORY_KEY && hasChanges) return current;
      if (current && history.some((commit) => commit.sha === current)) return current;
      return "";
    });
  }, [hasChanges, history]);

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
        <RepoRail aria-label="Git repositories" role="list">
          {repositories.map((repo) => {
            const active = repo.path === selectedRepoPath;
            const changeSummary = repoChangeSummary(repo);
            return (
              <RepoButton
                data-active={active ? "true" : undefined}
                data-dirty={repo.dirty ? "true" : undefined}
                key={repo.path}
                onClick={() => setSelectedRepoPath(repo.path)}
                title={repo.path}
                type="button"
              >
                <RepoCardTop>
                  <strong>{repoLabel(repo)}</strong>
                  <RepoDirtyDot data-dirty={repo.dirty ? "true" : undefined} />
                </RepoCardTop>
                <span>{repoMeta(repo)}</span>
                <em>{changeSummary}</em>
              </RepoButton>
            );
          })}
        </RepoRail>
      ) : null}

      {!repositories.length && (
        <GitEmpty>
          {repositoriesState === "loading" ? "Loading repositories..." : "No Git repositories found in this workspace."}
        </GitEmpty>
      )}

      {selectedRepo ? (
        <GitBody>
          <RepoSummary>
            <RepoSummaryMain>
              <strong>{repoLabel(selectedRepo)}</strong>
              <span title={selectedRepo.path}>{selectedRepo.path}</span>
            </RepoSummaryMain>
            <RepoFacts>
              <span>{text(snapshot?.repo?.branch, selectedRepo.branch) || "no branch"}</span>
              <span>{shortSha(snapshot?.repo?.headSha || selectedRepo.headSha)}</span>
              <span>{statusSummary(snapshot)}</span>
            </RepoFacts>
          </RepoSummary>

          {operationBlocked && (
            <GitNotice data-state="warning">
              Repository is in {snapshot.operationState.state} state. Resolve it before committing from Diff Forge.
            </GitNotice>
          )}

          <HistoryPane>
            <HistoryList>
              <HistoryEntry data-empty="true">
                <HistoryButton
                  data-empty="true"
                  onClick={() => setSelectedCommitSha("")}
                  title="Clear selected history item"
                  type="button"
                >
                  <HistoryGraph aria-hidden="true" />
                  <HistoryCommitLine aria-hidden="true" />
                </HistoryButton>
              </HistoryEntry>
              {hasChanges && (() => {
                const active = selectedCommitSha === WORKING_TREE_HISTORY_KEY;
                return (
                  <HistoryEntry data-active={active ? "true" : undefined} key={WORKING_TREE_HISTORY_KEY}>
                    <HistoryButton
                      data-active={active ? "true" : undefined}
                      onClick={() => setSelectedCommitSha(WORKING_TREE_HISTORY_KEY)}
                      title="Uncommitted working tree changes"
                      type="button"
                    >
                      <HistoryGraph aria-hidden="true" />
                      <HistoryCommitLine>
                        <strong>Changes</strong>
                      </HistoryCommitLine>
                    </HistoryButton>
                    {active && (
                      <HistoryFileList>
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
              {history.length ? history.map((commit) => {
                const active = commit.sha === selectedCommitSha;
                const files = Array.isArray(commit.files) ? commit.files : [];
                return (
                  <HistoryEntry data-active={active ? "true" : undefined} key={commit.sha}>
                    <HistoryButton
                      data-active={active ? "true" : undefined}
                      onClick={() => setSelectedCommitSha(commit.sha)}
                      title={commit.subject}
                      type="button"
                    >
                      <HistoryGraph aria-hidden="true" />
                      <HistoryCommitLine>
                        <strong>{commit.subject}</strong>
                      </HistoryCommitLine>
                    </HistoryButton>
                    {active && (
                      <HistoryFileList>
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
  display: grid;
  flex: 0 0 auto;
  min-width: 0;
  max-height: 124px;
  grid-template-columns: repeat(auto-fill, minmax(188px, 1fr));
  gap: 8px;
  overflow: auto;
  padding: 10px 10px 8px;
  border-bottom: 1px solid var(--git-vscode-border-subtle);
`;

const RepoButton = styled.button`
  display: grid;
  min-width: 0;
  min-height: 76px;
  align-content: start;
  gap: 5px;
  padding: 9px 10px;
  border: 1px solid var(--git-vscode-border);
  border-radius: 8px;
  color: var(--git-vscode-text);
  background: var(--git-card-bg);
  cursor: pointer;
  text-align: left;

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
    font-size: 12px;
    font-weight: 850;
  }

  span {
    color: var(--git-vscode-text-muted);
    font-size: 10px;
    font-weight: 720;
  }

  em {
    color: color-mix(in srgb, var(--git-vscode-text) 76%, transparent);
    font-size: 10px;
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
    border-color: color-mix(in srgb, var(--git-vscode-blue) 72%, var(--git-vscode-border));
    background: var(--git-card-bg-active);
  }
`;

const RepoCardTop = styled.div`
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
`;

const RepoDirtyDot = styled.i`
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: rgba(148, 163, 184, 0.46);

  &[data-dirty="true"] {
    background: #f59e0b;
    box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.12);
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

const RepoSummary = styled.section`
  display: flex;
  flex: 0 0 auto;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--git-vscode-border-subtle);
  background: color-mix(in srgb, var(--git-card-bg) 68%, transparent);
`;

const RepoSummaryMain = styled.div`
  display: grid;
  min-width: 0;
  gap: 2px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: var(--git-vscode-selection-text);
    font-size: 13px;
    font-weight: 850;
  }

  span {
    color: var(--git-vscode-text-muted);
    font-size: 10px;
    font-weight: 720;
  }
`;

const RepoFacts = styled.div`
  display: flex;
  flex: 0 1 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  min-width: 0;

  span {
    min-width: 0;
    max-width: 180px;
    overflow: hidden;
    padding: 3px 7px;
    border: 1px solid var(--git-vscode-border);
    border-radius: 999px;
    color: var(--git-vscode-text-muted);
    background: rgba(15, 23, 42, 0.22);
    font-size: 10px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
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

const HistoryGraph = styled.span`
  position: relative;
  display: block;
  width: 40px;
  height: 24px;

  &::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 20px;
    width: 1px;
    background: color-mix(in srgb, var(--git-vscode-blue) 58%, transparent);
    content: "";
  }

  &::after {
    position: absolute;
    top: 7px;
    left: 15px;
    width: 10px;
    height: 10px;
    border: 2px solid var(--git-vscode-blue);
    border-radius: 999px;
    background: var(--git-vscode-sidebar);
    content: "";
  }
`;

const HistoryButton = styled.button`
  display: grid;
  width: 100%;
  height: 24px;
  min-width: 0;
  grid-template-columns: 40px minmax(0, 1fr);
  align-items: center;
  padding: 0 8px 0 0;
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

  &[data-active="true"] ${HistoryGraph}::after {
    background: var(--git-vscode-blue);
  }

  &[data-empty="true"] {
    height: 36px;
    padding-right: 8px;
  }

  &[data-empty="true"] ${HistoryGraph} {
    height: 36px;
  }

  &[data-empty="true"] ${HistoryGraph}::after {
    top: 13px;
  }

  &[data-empty="true"]:hover {
    background: transparent;
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
  gap: 0;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: inherit;
    font-size: 13px;
    font-weight: 400;
    line-height: 24px;
  }

  span {
    flex: 0 1 auto;
    color: var(--git-vscode-text-muted);
    font-size: 13px;
    font-weight: 400;
    line-height: 24px;
  }

  ${HistoryButton}[data-active="true"] & span {
    color: color-mix(in srgb, var(--git-vscode-selection-text) 72%, transparent);
  }

  ${HistoryButton}[data-empty="true"] & {
    height: 24px;
    border: 1px dotted var(--git-vscode-dotted);
    border-radius: 2px;
  }

  ${HistoryButton}[data-empty="true"]:hover & {
    border-color: var(--git-vscode-blue);
    background: color-mix(in srgb, var(--git-vscode-blue) 7%, transparent);
  }
`;

const HistoryFileList = styled.div`
  display: grid;
  position: relative;
  align-content: start;
  min-width: 0;
  padding: 0 0 4px 40px;

  &::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 20px;
    width: 1px;
    background: color-mix(in srgb, var(--git-vscode-blue) 58%, transparent);
    content: "";
  }

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
  place-items: center;
  padding: 12px;
  color: var(--git-vscode-text-muted);
  font-size: 12px;
  font-weight: 400;
  text-align: center;
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

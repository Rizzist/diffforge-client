import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";

import {
  ButtonBrowserIcon,
  ButtonCheckIcon,
  ButtonRefreshIcon,
  FormMessage,
  PrimaryButton,
  SecondaryButton,
} from "../app/appStyles";

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

function formatTime(value) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  return `${total} changed · ${parts.join(" · ")}`;
}

function fileStatusTone(file) {
  const kind = text(file?.kind);
  if (kind === "conflicted") return "conflict";
  if (kind === "added" || kind === "untracked") return "added";
  if (kind === "deleted") return "deleted";
  if (kind === "renamed" || kind === "copied") return "moved";
  return "modified";
}

function commitActionMessage(result, pushRequested) {
  if (!result?.committed) return "No commit was created.";
  const sha = shortSha(result.commitSha);
  if (!pushRequested) return `Committed ${sha}.`;
  if (result.pushed) return `Committed and pushed ${sha}.`;
  return `Committed ${sha}. Push needs attention: ${result.pushError || "git push failed."}`;
}

export default function GitWorkspaceView({
  rootDirectory = "",
  workspace = null,
  workspaceError = "",
}) {
  const [repositoriesState, setRepositoriesState] = useState("idle");
  const [repositoriesError, setRepositoriesError] = useState("");
  const [repositories, setRepositories] = useState([]);
  const [cacheStatus, setCacheStatus] = useState("");
  const [selectedRepoPath, setSelectedRepoPath] = useState("");
  const [snapshotState, setSnapshotState] = useState("idle");
  const [snapshotError, setSnapshotError] = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [selectedFilePath, setSelectedFilePath] = useState("");
  const [diffState, setDiffState] = useState("idle");
  const [diffError, setDiffError] = useState("");
  const [diff, setDiff] = useState(null);
  const [messageState, setMessageState] = useState("idle");
  const [messageDraft, setMessageDraft] = useState("");
  const [messageTouched, setMessageTouched] = useState(false);
  const [actionState, setActionState] = useState("idle");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const workspaceId = workspace?.id || "";
  const workspaceName = workspace?.name || "";

  const changedFiles = useMemo(
    () => (Array.isArray(snapshot?.status?.files) ? snapshot.status.files : []),
    [snapshot],
  );
  const history = useMemo(
    () => (Array.isArray(snapshot?.history) ? snapshot.history : []),
    [snapshot],
  );
  const selectedFile = useMemo(
    () => changedFiles.find((file) => file.path === selectedFilePath) || null,
    [changedFiles, selectedFilePath],
  );
  const selectedRepo = useMemo(
    () => repositories.find((repo) => repo.path === selectedRepoPath) || null,
    [repositories, selectedRepoPath],
  );
  const operationBlocked = snapshot?.operationState && snapshot.operationState.clean === false;
  const hasChanges = changedFiles.length > 0;
  const canCommit = Boolean(selectedRepoPath && messageDraft.trim() && hasChanges && !operationBlocked && actionState !== "running");

  const loadRepositories = useCallback(async ({ refresh = false } = {}) => {
    if (!rootDirectory || !workspaceId) {
      setRepositories([]);
      setSelectedRepoPath("");
      setCacheStatus("");
      setRepositoriesState("idle");
      setRepositoriesError("");
      return;
    }
    setRepositoriesState(refresh ? "refreshing" : "loading");
    setRepositoriesError("");
    try {
      const result = await invoke("workspace_git_repositories", {
        refresh,
        repoPath: rootDirectory,
        workspaceId,
        workspaceName,
      });
      const nextRepositories = Array.isArray(result?.repositories) ? result.repositories : [];
      setRepositories(nextRepositories);
      setCacheStatus(text(result?.cache?.status));
      setSelectedRepoPath((current) => {
        if (current && nextRepositories.some((repo) => repo.path === current)) return current;
        return nextRepositories[0]?.path || "";
      });
      setRepositoriesState("ready");
    } catch (error) {
      setRepositoriesError(error?.message || String(error));
      setRepositoriesState("error");
    }
  }, [rootDirectory, workspaceId, workspaceName]);

  const generateMessage = useCallback(async (repoPath) => {
    if (!repoPath) {
      setMessageDraft("");
      return;
    }
    setMessageState("loading");
    try {
      const result = await invoke("workspace_git_generate_commit_message", { repoPath });
      setMessageDraft(result?.message || "");
      setMessageTouched(false);
      setMessageState("ready");
    } catch (error) {
      setMessageState("error");
      setActionError(error?.message || String(error));
    }
  }, []);

  const loadSnapshot = useCallback(async (repoPath, { regenerateMessage = true } = {}) => {
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
      const files = Array.isArray(result?.status?.files) ? result.status.files : [];
      setSelectedFilePath((current) => {
        if (current && files.some((file) => file.path === current)) return current;
        return files[0]?.path || "";
      });
      if (regenerateMessage && files.length && !messageTouched) {
        void generateMessage(repoPath);
      }
      if (!files.length && !messageTouched) {
        setMessageDraft("");
      }
    } catch (error) {
      setSnapshotError(error?.message || String(error));
      setSnapshotState("error");
    }
  }, [generateMessage, messageTouched]);

  const loadDiff = useCallback(async (repoPath, file) => {
    if (!repoPath || !file?.path) {
      setDiff(null);
      setDiffState("idle");
      setDiffError("");
      return;
    }
    setDiffState("loading");
    setDiffError("");
    try {
      const result = await invoke("workspace_git_file_diff", {
        filePath: file.path,
        repoPath,
        staged: Boolean(file.staged && !file.unstaged),
      });
      setDiff(result);
      setDiffState("ready");
    } catch (error) {
      setDiffError(error?.message || String(error));
      setDiffState("error");
    }
  }, []);

  useEffect(() => {
    void loadRepositories({ refresh: false });
  }, [loadRepositories]);

  useEffect(() => {
    setSnapshot(null);
    setSelectedFilePath("");
    setMessageDraft("");
    setMessageTouched(false);
    setActionMessage("");
    setActionError("");
    void loadSnapshot(selectedRepoPath, { regenerateMessage: true });
  }, [loadSnapshot, selectedRepoPath]);

  useEffect(() => {
    void loadDiff(selectedRepoPath, selectedFile);
  }, [loadDiff, selectedFile, selectedRepoPath]);

  const refreshAll = useCallback(() => {
    void loadRepositories({ refresh: true });
    if (selectedRepoPath) void loadSnapshot(selectedRepoPath, { regenerateMessage: false });
  }, [loadRepositories, loadSnapshot, selectedRepoPath]);

  const commitRepo = useCallback(async (push) => {
    if (!selectedRepoPath || !messageDraft.trim()) return;
    setActionState("running");
    setActionMessage("");
    setActionError("");
    try {
      const result = await invoke("workspace_git_commit_and_push", {
        message: messageDraft,
        push,
        repoPath: selectedRepoPath,
      });
      setActionMessage(commitActionMessage(result, push));
      setSnapshot(result?.snapshot || null);
      setMessageDraft("");
      setMessageTouched(false);
      setActionState(result?.pushError ? "warning" : "success");
      void loadRepositories({ refresh: false });
    } catch (error) {
      setActionError(error?.message || String(error));
      setActionState("error");
    }
  }, [loadRepositories, messageDraft, selectedRepoPath]);

  if (!rootDirectory || !workspace) {
    return (
      <GitSurface>
        <GitEmpty>Select a workspace to inspect Git repositories.</GitEmpty>
      </GitSurface>
    );
  }

  return (
    <GitSurface aria-label="Workspace Git">
      <GitHeader>
        <div>
          <GitKicker>Git</GitKicker>
          <GitTitle>{workspaceName || "Workspace repositories"}</GitTitle>
        </div>
        <SecondaryButton
          disabled={repositoriesState === "refreshing"}
          onClick={refreshAll}
          title="Refresh Git repositories"
          type="button"
        >
          <ButtonRefreshIcon aria-hidden="true" />
          <span>{repositoriesState === "refreshing" ? "Refreshing" : "Refresh"}</span>
        </SecondaryButton>
      </GitHeader>

      {workspaceError && <FormMessage $state="error">{workspaceError}</FormMessage>}
      {repositoriesError && <FormMessage $state="error">{repositoriesError}</FormMessage>}
      {snapshotError && <FormMessage $state="error">{snapshotError}</FormMessage>}
      {actionError && <FormMessage $state="error">{actionError}</FormMessage>}
      {actionMessage && <GitNotice data-state={actionState}>{actionMessage}</GitNotice>}

      <RepoStrip aria-label="Git repositories" role="list">
        {repositories.map((repo) => (
          <RepoButton
            data-active={repo.path === selectedRepoPath ? "true" : undefined}
            data-dirty={repo.dirty ? "true" : undefined}
            key={repo.path}
            onClick={() => setSelectedRepoPath(repo.path)}
            title={repo.path}
            type="button"
          >
            <strong>{repoLabel(repo)}</strong>
            <span>{repoMeta(repo)}</span>
          </RepoButton>
        ))}
        {!repositories.length && (
          <GitEmpty>
            {repositoriesState === "loading" ? "Loading repositories..." : "No Git repositories found in this workspace."}
          </GitEmpty>
        )}
      </RepoStrip>

      {selectedRepo ? (
        <GitBody>
          <RepoSummary>
            <RepoSummaryMain>
              <strong>{repoLabel(selectedRepo)}</strong>
              <span title={selectedRepo.path}>{selectedRepo.path}</span>
            </RepoSummaryMain>
            <RepoFacts>
              <span>{text(snapshot?.repo?.branch, selectedRepo.branch)}</span>
              <span>{shortSha(snapshot?.repo?.headSha || selectedRepo.headSha)}</span>
              <span>{statusSummary(snapshot)}</span>
              {cacheStatus && <span>scan {cacheStatus}</span>}
            </RepoFacts>
          </RepoSummary>

          {operationBlocked && (
            <GitNotice data-state="warning">
              Repository is in {snapshot.operationState.state} state. Resolve it before committing from Diff Forge.
            </GitNotice>
          )}

          <CommitPanel>
            <CommitMessage
              aria-label="Commit message"
              disabled={!hasChanges || actionState === "running"}
              onChange={(event) => {
                setMessageDraft(event.target.value);
                setMessageTouched(true);
              }}
              placeholder={hasChanges ? "Commit message" : "No changes to commit"}
              spellCheck="true"
              value={messageDraft}
            />
            <CommitActions>
              <SecondaryButton
                disabled={!selectedRepoPath || messageState === "loading" || !hasChanges}
                onClick={() => generateMessage(selectedRepoPath)}
                type="button"
              >
                <ButtonRefreshIcon aria-hidden="true" />
                <span>{messageState === "loading" ? "Generating" : "Regenerate"}</span>
              </SecondaryButton>
              <SecondaryButton
                disabled={!canCommit}
                onClick={() => commitRepo(false)}
                type="button"
              >
                <ButtonCheckIcon aria-hidden="true" />
                <span>{actionState === "running" ? "Committing" : "Commit"}</span>
              </SecondaryButton>
              <PrimaryButton
                disabled={!canCommit}
                onClick={() => commitRepo(true)}
                type="button"
              >
                <ButtonBrowserIcon aria-hidden="true" />
                <span>{actionState === "running" ? "Pushing" : "Commit & Push"}</span>
              </PrimaryButton>
            </CommitActions>
          </CommitPanel>

          <GitColumns>
            <ChangesPane>
              <SectionTitle>Changed Files</SectionTitle>
              {changedFiles.length ? (
                <ChangeList>
                  {changedFiles.map((file) => (
                    <ChangeButton
                      data-active={file.path === selectedFilePath ? "true" : undefined}
                      data-tone={fileStatusTone(file)}
                      key={`${file.code}:${file.path}:${file.oldPath || ""}`}
                      onClick={() => setSelectedFilePath(file.path)}
                      title={file.path}
                      type="button"
                    >
                      <span>{file.code}</span>
                      <strong>{file.path}</strong>
                    </ChangeButton>
                  ))}
                </ChangeList>
              ) : (
                <GitEmpty>Working tree clean.</GitEmpty>
              )}
            </ChangesPane>

            <DiffPane>
              <SectionTitle>{selectedFilePath || "Diff"}</SectionTitle>
              {diffError && <FormMessage $state="error">{diffError}</FormMessage>}
              <DiffText>
                {diffState === "loading"
                  ? "Loading diff..."
                  : diff?.diff
                    ? diff.diff
                    : selectedFile?.untracked
                      ? "Untracked file diff will appear after staging. Commit uses git add -A."
                      : "No diff text for this file."}
              </DiffText>
            </DiffPane>
          </GitColumns>

          <HistoryPane>
            <SectionTitle>Recent History</SectionTitle>
            {history.length ? history.map((commit) => (
              <HistoryItem key={commit.sha}>
                <HistoryItemHeader>
                  <strong>{commit.subject}</strong>
                  <span>{shortSha(commit.sha)} · {formatTime(commit.date)}</span>
                </HistoryItemHeader>
                <HistoryFiles>
                  {(Array.isArray(commit.files) ? commit.files : []).slice(0, 6).map((file, index) => (
                    <span key={`${commit.sha}:${file.path}:${index}`}>{file.status} {file.path}</span>
                  ))}
                </HistoryFiles>
              </HistoryItem>
            )) : (
              <GitEmpty>{snapshotState === "loading" ? "Loading history..." : "No commits recorded yet."}</GitEmpty>
            )}
          </HistoryPane>
        </GitBody>
      ) : null}
    </GitSurface>
  );
}

const GitSurface = styled.section`
  display: grid;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 10px;
  padding: 12px;
  color: #dbe7f7;
  background: rgba(4, 8, 13, 0.9);
  overflow: hidden;

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
    background: #ffffff;
  }
`;

const GitHeader = styled.header`
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
`;

const GitKicker = styled.div`
  color: #8ea0b8;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  text-transform: uppercase;
`;

const GitTitle = styled.h2`
  margin: 2px 0 0;
  color: #f8fafc;
  font-size: 15px;
  font-weight: 880;
  letter-spacing: 0;

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
  }
`;

const RepoStrip = styled.div`
  display: flex;
  min-width: 0;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
`;

const RepoButton = styled.button`
  display: grid;
  min-width: 185px;
  max-width: 240px;
  gap: 4px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  color: #c8d4e5;
  background: rgba(15, 23, 42, 0.72);
  cursor: pointer;
  text-align: left;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #f8fafc;
    font-size: 12px;
    font-weight: 880;
  }

  span {
    color: #8ea0b8;
    font-size: 10px;
    font-weight: 720;
  }

  &[data-dirty="true"] {
    border-color: rgba(245, 158, 11, 0.44);
  }

  &[data-active="true"] {
    border-color: rgba(56, 189, 248, 0.7);
    background: rgba(14, 116, 144, 0.2);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.08);
    color: #333333;
    background: #f5f5f7;
  }

  html[data-forge-theme="light"] strong {
    color: #1d1d1f;
  }
`;

const GitBody = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto auto minmax(260px, 1fr) minmax(160px, 0.62fr);
  gap: 10px;
  overflow: hidden;
`;

const RepoSummary = styled.section`
  display: grid;
  gap: 8px;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  background: rgba(2, 6, 12, 0.58);

  html[data-forge-theme="light"] & {
    border-color: rgba(0, 0, 0, 0.08);
    background: #fafafc;
  }
`;

const RepoSummaryMain = styled.div`
  display: grid;
  min-width: 0;
  gap: 3px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #f8fafc;
    font-size: 14px;
    font-weight: 900;
  }

  span {
    color: #8ea0b8;
    font-size: 10px;
    font-weight: 720;
  }

  html[data-forge-theme="light"] strong {
    color: #1d1d1f;
  }
`;

const RepoFacts = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;

  span {
    min-width: 0;
    max-width: 100%;
    overflow: hidden;
    padding: 4px 7px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    border-radius: 999px;
    color: #cbd5e1;
    background: rgba(15, 23, 42, 0.68);
    font-size: 10px;
    font-weight: 780;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  html[data-forge-theme="light"] span {
    color: #333333;
    background: #ffffff;
  }
`;

const CommitPanel = styled.section`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  min-height: 88px;
`;

const CommitMessage = styled.textarea`
  width: 100%;
  min-width: 0;
  min-height: 88px;
  resize: none;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  color: #f8fafc;
  background: rgba(2, 6, 12, 0.68);
  font: inherit;
  font-size: 12px;
  font-weight: 680;
  line-height: 1.45;
  outline: none;

  &:focus {
    border-color: rgba(56, 189, 248, 0.58);
  }

  &:disabled {
    opacity: 0.62;
  }

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
    background: #ffffff;
  }
`;

const CommitActions = styled.div`
  display: flex;
  width: 148px;
  min-width: 0;
  flex-direction: column;
  gap: 7px;

  button {
    width: 100%;
    justify-content: center;
  }
`;

const GitColumns = styled.div`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-columns: minmax(165px, 0.42fr) minmax(0, 1fr);
  gap: 10px;
  overflow: hidden;
`;

const ChangesPane = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  overflow: hidden;
`;

const DiffPane = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  overflow: hidden;
`;

const SectionTitle = styled.h3`
  margin: 0;
  min-width: 0;
  overflow: hidden;
  color: #9fb0c7;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 0;
  text-overflow: ellipsis;
  text-transform: uppercase;
  white-space: nowrap;
`;

const ChangeList = styled.div`
  display: grid;
  align-content: start;
  min-width: 0;
  min-height: 0;
  gap: 6px;
  overflow: auto;
`;

const ChangeButton = styled.button`
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 7px;
  color: #dbe7f7;
  background: rgba(15, 23, 42, 0.58);
  cursor: pointer;
  text-align: left;

  span {
    color: #94a3b8;
    font-size: 10px;
    font-weight: 900;
  }

  strong {
    min-width: 0;
    overflow: hidden;
    font-size: 11px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &[data-tone="added"] span {
    color: #34d399;
  }

  &[data-tone="deleted"] span,
  &[data-tone="conflict"] span {
    color: #fb7185;
  }

  &[data-tone="moved"] span {
    color: #fbbf24;
  }

  &[data-active="true"] {
    border-color: rgba(56, 189, 248, 0.58);
    background: rgba(14, 116, 144, 0.18);
  }

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
    background: #fafafc;
  }
`;

const DiffText = styled.pre`
  min-width: 0;
  min-height: 0;
  margin: 0;
  overflow: auto;
  padding: 10px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  color: #dbe7f7;
  background: rgba(2, 6, 12, 0.74);
  font-size: 10px;
  line-height: 1.45;
  white-space: pre-wrap;

  html[data-forge-theme="light"] & {
    color: #1d1d1f;
    background: #ffffff;
  }
`;

const HistoryPane = styled.section`
  display: grid;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 8px;
  overflow: auto;
`;

const HistoryItem = styled.article`
  display: grid;
  gap: 7px;
  padding: 9px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.5);

  html[data-forge-theme="light"] & {
    background: #fafafc;
  }
`;

const HistoryItemHeader = styled.div`
  display: grid;
  min-width: 0;
  gap: 3px;

  strong,
  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  strong {
    color: #f8fafc;
    font-size: 11px;
    font-weight: 850;
  }

  span {
    color: #8ea0b8;
    font-size: 10px;
    font-weight: 700;
  }

  html[data-forge-theme="light"] strong {
    color: #1d1d1f;
  }
`;

const HistoryFiles = styled.div`
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 5px;

  span {
    max-width: 100%;
    overflow: hidden;
    padding: 3px 6px;
    border-radius: 999px;
    color: #aab8ca;
    background: rgba(2, 6, 12, 0.55);
    font-size: 9px;
    font-weight: 760;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const GitNotice = styled.div`
  padding: 9px 10px;
  border: 1px solid rgba(56, 189, 248, 0.24);
  border-radius: 8px;
  color: #bae6fd;
  background: rgba(14, 116, 144, 0.14);
  font-size: 11px;
  font-weight: 740;
  line-height: 1.45;

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
  color: #8ea0b8;
  font-size: 11px;
  font-weight: 740;
  text-align: center;
`;

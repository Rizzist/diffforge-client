import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import styled from "styled-components";

const KANBAN_COLUMNS = [
  { id: "todo", label: "To do", tone: "#60a5fa" },
  { id: "active", label: "In progress", tone: "#34d399" },
  { id: "blocked", label: "Blocked", tone: "#fb7185" },
  { id: "review", label: "Review", tone: "#fbbf24" },
  { id: "done", label: "Done", tone: "#a78bfa" },
  { id: "cancelled", label: "Cancelled", tone: "#94a3b8" },
];

function cleanText(value) {
  return String(value || "")
    .replace(/\x1B\][\s\S]*?(?:\x07|\x1B\\)/g, " ")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, " ")
    .replace(/\x1BO./g, " ")
    .replace(/\x1B[@-Z\\-_]/g, " ")
    .replace(/\[(?:\??\d[\d;?]*|[OI])[@-~]?/g, " ")
    .replace(/\]\d+;rgb:[^\s\\]*(?:\\)?/gi, " ")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .trim();
}

function text(value, fallback = "") {
  const cleaned = cleanText(value);
  return cleaned || fallback;
}

function field(item, ...keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function jsonObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function metadata(task) {
  return jsonObject(field(task, "metadata", "metadata_json", "metadataJson"));
}

function shortId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "AGT";
  return (raw.split("-")[0] || raw)
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 3)
    .padEnd(3, "x")
    .toUpperCase();
}

function colorFor(value) {
  const palette = ["#38bdf8", "#34d399", "#fbbf24", "#fb7185", "#a78bfa", "#2dd4bf", "#f97316"];
  const raw = String(value || "agent");
  let hash = 0;
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0;
  }
  return palette[hash % palette.length];
}

function agentLabelFor(task, agentId) {
  const meta = metadata(task);
  const explicit = text(field(task, "agent_label", "agentLabel", "label") || meta.agent_label || meta.agentLabel);
  if (explicit) return explicit.toUpperCase();

  const slot = text(field(task, "slot_key", "slotKey") || meta.slot_key || meta.slotKey);
  const match = slot.match(/^codex-(\d+)$/i);
  if (match) {
    const index = Number(match[1]);
    if (Number.isFinite(index) && index > 0 && index <= 26) {
      return `CX${String.fromCharCode(64 + index)}`;
    }
  }

  return shortId(agentId);
}

function inferredStatus(task, fallback) {
  const status = text(fallback, "todo").toLowerCase();
  const meta = metadata(task);
  const body = text(field(task, "body", "description"));
  const title = text(field(task, "title", "summary"));
  const requested = text(meta.requested_status || meta.requestedStatus).toLowerCase();
  const combined = `${title} ${body} ${text(meta.block_reason || meta.blockReason)} ${text(meta.completion_gate || meta.completionGate)}`.toLowerCase();

  if (
    status === "blocked" ||
    meta.completion_blocked_until_submit_patch ||
    meta.completionBlockedUntilSubmitPatch ||
    combined.includes("blocked by") ||
    combined.startsWith("blocked:") ||
    combined.includes("unable to apply") ||
    combined.includes("unable to complete") ||
    combined.includes("owned by another active") ||
    combined.includes("peer lease")
  ) {
    return "blocked";
  }

  if (status === "review" && requested === "done") return "review";
  return KANBAN_COLUMNS.some((column) => column.id === status) ? status : "todo";
}

function normalizeBoard(response) {
  const board = response?.taskBoard && typeof response.taskBoard === "object" ? response.taskBoard : {};
  const tasks = Array.isArray(response?.tasks) ? response.tasks : [];
  const byStatus = Object.fromEntries(KANBAN_COLUMNS.map((column) => [column.id, []]));

  for (const column of KANBAN_COLUMNS) {
    const items = Array.isArray(board[column.id]) ? board[column.id] : [];
    for (const item of items) {
      const status = inferredStatus(item, column.id);
      byStatus[status].push(item);
    }
  }

  if (!Object.values(byStatus).some((items) => items.length) && tasks.length) {
    for (const task of tasks) {
      const status = inferredStatus(task, field(task, "status"));
      byStatus[status].push(task);
    }
  }

  return byStatus;
}

export default function KanbanWorkspaceView({
  defaultWorkingDirectory,
  rootDirectory,
  workspace,
}) {
  const repoPath = rootDirectory || defaultWorkingDirectory || "";
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState("");
  const [state, setState] = useState("idle");
  const refreshInFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!repoPath || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setState((current) => (current === "idle" ? "loading" : current));
    try {
      const next = await invoke("cloud_mcp_get_kanban", {
        repoPath,
        workspaceId: workspace?.id || null,
        workspaceName: workspace?.name || null,
      });
      setSnapshot(next);
      setError("");
      setState("ready");
    } catch (nextError) {
      setError(nextError?.message || String(nextError));
      setState("error");
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [repoPath, workspace?.id, workspace?.name]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const board = useMemo(() => normalizeBoard(snapshot), [snapshot]);

  return (
    <KanbanSurface aria-label={`${workspace?.name || "Workspace"} Kanban`} data-state={state}>
      {error && <KanbanError>{error}</KanbanError>}
      <KanbanColumns>
        {KANBAN_COLUMNS.map((column) => {
          const items = board[column.id] || [];
          return (
            <KanbanColumn key={column.id} $tone={column.tone}>
              <ColumnHeader $tone={column.tone}>
                <span>{column.label}</span>
                <strong>{items.length}</strong>
              </ColumnHeader>
              <TaskStack>
                {items.length ? items.map((task) => {
                  const taskId = text(field(task, "id", "task_id", "taskId"), "task");
                  const agentId = text(field(task, "agent_id", "agentId", "owner_agent_id", "ownerAgentId"));
                  const lane = text(field(task, "lane", "resource_lane", "resourceLane"));
                  const priority = field(task, "priority");
                  const title = text(field(task, "title", "summary"), "Untitled task");
                  const body = text(field(task, "body", "description"));
                  const agentLabel = agentLabelFor(task, agentId);
                  return (
                    <TaskCard key={taskId}>
                      <TaskTitle>{title}</TaskTitle>
                      {body && body !== title && (
                        <TaskBody>{body}</TaskBody>
                      )}
                      <TaskMeta>
                        {agentId && <TaskBadge $color={colorFor(agentLabel || agentId)}>{agentLabel}</TaskBadge>}
                        {lane && <TaskBadge>{lane}</TaskBadge>}
                        {priority !== "" && <TaskBadge>p{priority}</TaskBadge>}
                      </TaskMeta>
                    </TaskCard>
                  );
                }) : (
                  <ColumnEmpty>Empty</ColumnEmpty>
                )}
              </TaskStack>
            </KanbanColumn>
          );
        })}
      </KanbanColumns>
    </KanbanSurface>
  );
}

const KanbanSurface = styled.section`
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: auto;
  padding: 10px;
  background:
    linear-gradient(180deg, rgba(47, 128, 255, 0.035), rgba(255, 122, 24, 0.018)),
    rgba(6, 9, 16, 0.94);
  color: var(--forge-text, #dbe7f7);
`;

const KanbanError = styled.div`
  border: 1px solid rgba(248, 113, 113, 0.3);
  border-radius: 10px;
  background: rgba(127, 29, 29, 0.22);
  color: #fecaca;
  margin-bottom: 10px;
  padding: 10px;
`;

const KanbanColumns = styled.div`
  display: grid;
  grid-template-columns: repeat(6, minmax(172px, 1fr));
  gap: 6px;
  min-height: 100%;

  @media (max-width: 1500px) {
    grid-template-columns: repeat(3, minmax(190px, 1fr));
  }

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const KanbanColumn = styled.section`
  border: 1px solid rgba(230, 236, 245, 0.06);
  border-radius: 8px;
  background: rgba(13, 17, 23, 0.48);
  min-height: 320px;
  overflow: hidden;
`;

const ColumnHeader = styled.header`
  align-items: center;
  border-bottom: 1px solid rgba(230, 236, 245, 0.06);
  display: flex;
  justify-content: space-between;
  padding: 8px 9px;

  span {
    align-items: center;
    color: var(--forge-text-disabled, rgba(219, 231, 247, 0.52));
    display: inline-flex;
    font-size: 10px;
    font-weight: 760;
    gap: 7px;
    letter-spacing: 0.06em;
    text-transform: uppercase;

    &::before {
      width: 3px;
      height: 14px;
      border-radius: 999px;
      background: ${({ $tone }) => $tone || "#60a5fa"};
      box-shadow: 0 0 12px ${({ $tone }) => $tone || "#60a5fa"}33;
      content: "";
    }
  }

  strong {
    border: 1px solid rgba(230, 236, 245, 0.08);
    border-radius: 6px;
    color: var(--forge-text-muted, rgba(219, 231, 247, 0.62));
    font-size: 10px;
    font-weight: 760;
    min-width: 20px;
    padding: 2px 6px;
    text-align: center;
  }
`;

const TaskStack = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
`;

const TaskCard = styled.article`
  position: relative;
  border: 1px solid rgba(230, 236, 245, 0.06);
  border-radius: 8px;
  background: rgba(7, 9, 13, 0.56);
  padding: 8px 8px 8px 15px;
  overflow: hidden;

  &::before {
    position: absolute;
    top: 10px;
    bottom: 10px;
    left: 7px;
    width: 3px;
    border-radius: 999px;
    background: rgba(230, 236, 245, 0.16);
    content: "";
  }
`;

const TaskTitle = styled.h2`
  color: var(--forge-text-soft, #eef5ff);
  font-size: 12px;
  font-weight: 720;
  line-height: 1.28;
  margin: 0;
`;

const TaskBody = styled.p`
  color: var(--forge-text-muted, rgba(219, 231, 247, 0.56));
  font-size: 11px;
  font-weight: 600;
  line-height: 1.4;
  margin: 5px 0 0;
`;

const TaskMeta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
`;

const TaskBadge = styled.span`
  border: 1px solid ${({ $color }) => $color || "rgba(230, 236, 245, 0.08)"};
  border-radius: 6px;
  background: rgba(230, 236, 245, 0.035);
  color: ${({ $color }) => $color || "var(--forge-text-muted, rgba(219, 231, 247, 0.68))"};
  font-size: 10px;
  font-weight: 760;
  letter-spacing: 0.06em;
  line-height: 1;
  padding: 3px 6px;
  text-transform: uppercase;
`;

const ColumnEmpty = styled.div`
  border: 1px dashed rgba(230, 236, 245, 0.08);
  border-radius: 8px;
  color: var(--forge-text-muted, rgba(219, 231, 247, 0.42));
  font-size: 11px;
  font-weight: 650;
  padding: 8px 9px;
`;

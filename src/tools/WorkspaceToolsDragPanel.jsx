import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import styled from "styled-components";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "architectures", label: "Architectures" },
  { id: "skills", label: "Skills" },
];

const FILTER_STORAGE_PREFIX = "diffforge.workspaceTools.filter";
const SEND_STORAGE_PREFIX = "diffforge.workspaceTools.sendOnDrop";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function storageKey(prefix, workspaceId) {
  return `${prefix}.${text(workspaceId, "default")}`;
}

function readStorage(prefix, workspaceId, fallback) {
  try {
    const value = window.localStorage.getItem(storageKey(prefix, workspaceId));
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

function writeStorage(prefix, workspaceId, value) {
  try {
    window.localStorage.setItem(storageKey(prefix, workspaceId), String(value));
  } catch {
    // Persistence is best-effort.
  }
}

function parseSkillsEntries(skillsMd) {
  const content = text(skillsMd);
  if (!content) return [];
  const lines = content.split("\n");
  const entries = [];
  let current = null;
  lines.forEach((line) => {
    const heading = line.match(/^#{1,3}\s+(.+)$/u);
    if (heading) {
      if (current && (current.title || current.body.trim())) entries.push(current);
      current = { title: heading[1].trim(), body: "" };
      return;
    }
    if (!current) current = { title: "", body: "" };
    current.body += `${line}\n`;
  });
  if (current && (current.title || current.body.trim())) entries.push(current);
  const named = entries.filter((entry) => entry.title);
  if (named.length) return named;
  return [{ title: "SKILLS.md", body: content }];
}

function architectureTodoText(item) {
  return `Use the architecture graph "${item.title}" at .agents/architectures/graphs/${item.graphId}.arch in ${item.repoLabel} as the working context for this task.`;
}

function skillTodoText(entry) {
  const body = text(entry.body).slice(0, 4000);
  return body
    ? `Apply the "${entry.title}" skill from the account SKILLS.md:\n\n${body}`
    : `Apply the "${entry.title}" skill from the account SKILLS.md.`;
}

/**
 * Drag-and-drop sources for the workspace tools tab: architecture graphs and
 * account skills. Items can be dragged into the todo composer (plain text) or
 * clicked; the send-on-drop toggle decides whether a dropped/clicked item is
 * queued immediately or just listed.
 */
export default function WorkspaceToolsDragPanel({
  coordinationTargets = [],
  onAddToolTodo,
  rootDirectory = "",
  workspaceId = "",
}) {
  const [filter, setFilter] = useState(() => {
    const stored = readStorage(FILTER_STORAGE_PREFIX, workspaceId, "all");
    return FILTERS.some((entry) => entry.id === stored) ? stored : "all";
  });
  const [sendOnDrop, setSendOnDrop] = useState(
    () => readStorage(SEND_STORAGE_PREFIX, workspaceId, "false") === "true",
  );
  const [architectures, setArchitectures] = useState([]);
  const [skills, setSkills] = useState([]);
  const [state, setState] = useState("loading");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const stored = readStorage(FILTER_STORAGE_PREFIX, workspaceId, "all");
    setFilter(FILTERS.some((entry) => entry.id === stored) ? stored : "all");
    setSendOnDrop(readStorage(SEND_STORAGE_PREFIX, workspaceId, "false") === "true");
  }, [workspaceId]);

  const selectFilter = useCallback((next) => {
    setFilter(next);
    writeStorage(FILTER_STORAGE_PREFIX, workspaceId, next);
  }, [workspaceId]);

  const toggleSendOnDrop = useCallback(() => {
    setSendOnDrop((current) => {
      writeStorage(SEND_STORAGE_PREFIX, workspaceId, String(!current));
      return !current;
    });
  }, [workspaceId]);

  const refresh = useCallback(async () => {
    setState("loading");
    const repoPaths = [];
    const seen = new Set();
    const addRepo = (repoPath, label) => {
      const cleaned = text(repoPath);
      if (!cleaned || seen.has(cleaned)) return;
      seen.add(cleaned);
      repoPaths.push({ repoPath: cleaned, label: text(label, cleaned.split(/[\\/]/u).pop()) });
    };
    (Array.isArray(coordinationTargets) ? coordinationTargets : []).forEach((target) => {
      addRepo(target?.repoPath, target?.projectName || target?.repoLabel);
    });
    addRepo(rootDirectory, rootDirectory.split(/[\\/]/u).pop());

    const archResults = await Promise.allSettled(repoPaths.map(async ({ repoPath, label }) => {
      const list = await invoke("architecture_graphs_list", { repoPath });
      return (Array.isArray(list?.graphs) ? list.graphs : []).map((graph) => ({
        graphId: text(graph?.graphId || graph?.graph_id || graph?.id),
        repoLabel: label,
        repoPath,
        title: text(graph?.title || graph?.name || graph?.graphId || graph?.graph_id, "architecture"),
      }));
    }));
    const nextArchitectures = archResults
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .filter((item) => item.graphId);
    setArchitectures(nextArchitectures);

    try {
      const tools = await invoke("cloud_mcp_get_account_tools");
      const skillsMd = text(tools?.skills?.skills_md ?? tools?.skills?.skillsMd);
      setSkills(parseSkillsEntries(skillsMd));
    } catch {
      setSkills([]);
    }
    setState("ready");
  }, [coordinationTargets, rootDirectory]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleAdd = useCallback((todoText, { forceSend = null } = {}) => {
    if (typeof onAddToolTodo !== "function") return;
    const send = forceSend === null ? sendOnDrop : forceSend;
    const item = onAddToolTodo(todoText, { send });
    if (item) {
      setNotice(send ? "Queued todo" : "Added to todo list");
      window.setTimeout(() => setNotice(""), 2200);
    }
  }, [onAddToolTodo, sendOnDrop]);

  const handleDragStart = useCallback((event, todoText) => {
    event.dataTransfer.setData("text/plain", todoText);
    event.dataTransfer.effectAllowed = "copy";
  }, []);

  const handleDragEnd = useCallback((event, todoText) => {
    // With send-on-drop enabled, a completed drop queues the todo directly;
    // otherwise the native text drop into the composer is the whole gesture.
    if (!sendOnDrop) return;
    if (event.dataTransfer.dropEffect === "none") return;
    handleAdd(todoText, { forceSend: true });
  }, [handleAdd, sendOnDrop]);

  const visibleArchitectures = filter === "skills" ? [] : architectures;
  const visibleSkills = filter === "architectures" ? [] : skills;

  return (
    <Panel aria-label="Draggable workspace tools">
      <Toolbar>
        <FilterNav role="tablist" aria-label="Tool filter">
          {FILTERS.map((entry) => (
            <FilterButton
              aria-selected={filter === entry.id}
              data-active={filter === entry.id ? "true" : "false"}
              key={entry.id}
              onClick={() => selectFilter(entry.id)}
              role="tab"
              type="button"
            >
              {entry.label}
            </FilterButton>
          ))}
        </FilterNav>
        <ToolbarActions>
          <SendToggle
            aria-pressed={sendOnDrop}
            data-active={sendOnDrop ? "true" : "false"}
            onClick={toggleSendOnDrop}
            title={sendOnDrop
              ? "Dropping or clicking queues the todo immediately"
              : "Dropping or clicking adds the todo without sending"}
            type="button"
          >
            <SendToggleKnob aria-hidden="true" data-active={sendOnDrop ? "true" : "false"} />
            Send on drop
          </SendToggle>
          <GhostButton disabled={state === "loading"} onClick={() => void refresh()} type="button">
            {state === "loading" ? "Loading…" : "Refresh"}
          </GhostButton>
        </ToolbarActions>
      </Toolbar>
      {notice && <Notice aria-live="polite">{notice}</Notice>}

      <ItemsScroll>
        {visibleArchitectures.length > 0 && (
          <>
            <GroupLabel>Architectures</GroupLabel>
            {visibleArchitectures.map((item) => {
              const todoText = architectureTodoText(item);
              return (
                <ToolRow
                  draggable
                  key={`${item.repoPath}:${item.graphId}`}
                  onDragEnd={(event) => handleDragEnd(event, todoText)}
                  onDragStart={(event) => handleDragStart(event, todoText)}
                  title="Drag into the composer, or click + to add"
                >
                  <ToolGlyph aria-hidden="true" data-kind="architecture">⌬</ToolGlyph>
                  <ToolCopy>
                    <strong>{item.title}</strong>
                    <span>{item.repoLabel}</span>
                  </ToolCopy>
                  <AddButton
                    aria-label={`Add architecture ${item.title} as todo`}
                    onClick={() => handleAdd(todoText)}
                    type="button"
                  >
                    {sendOnDrop ? "Queue" : "Add"}
                  </AddButton>
                </ToolRow>
              );
            })}
          </>
        )}
        {visibleSkills.length > 0 && (
          <>
            <GroupLabel>Skills</GroupLabel>
            {visibleSkills.map((entry) => {
              const todoText = skillTodoText(entry);
              return (
                <ToolRow
                  draggable
                  key={`skill:${entry.title}`}
                  onDragEnd={(event) => handleDragEnd(event, todoText)}
                  onDragStart={(event) => handleDragStart(event, todoText)}
                  title="Drag into the composer, or click + to add"
                >
                  <ToolGlyph aria-hidden="true" data-kind="skill">✦</ToolGlyph>
                  <ToolCopy>
                    <strong>{entry.title}</strong>
                    <span>{text(entry.body).split("\n").find(Boolean) || "Account skill"}</span>
                  </ToolCopy>
                  <AddButton
                    aria-label={`Add skill ${entry.title} as todo`}
                    onClick={() => handleAdd(todoText)}
                    type="button"
                  >
                    {sendOnDrop ? "Queue" : "Add"}
                  </AddButton>
                </ToolRow>
              );
            })}
          </>
        )}
        {state === "ready" && !visibleArchitectures.length && !visibleSkills.length && (
          <Empty>
            {filter === "skills"
              ? "No skills yet — write SKILLS.md in the Tools tab."
              : filter === "architectures"
                ? "No architecture graphs in this workspace yet."
                : "No architectures or skills yet."}
          </Empty>
        )}
        {state === "loading" && <Empty>Loading tools…</Empty>}
      </ItemsScroll>
    </Panel>
  );
}

const Panel = styled.div`
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  gap: 8px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 10px;
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
`;

const FilterNav = styled.nav`
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.1));
  border-radius: 8px;
  background: rgba(7, 9, 13, 0.5);
`;

const FilterButton = styled.button`
  padding: 5px 10px;
  border: 0;
  border-radius: 6px;
  color: var(--forge-text-muted, #7a8493);
  background: transparent;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;

  &[data-active="true"] {
    color: var(--forge-text, #f4f7fa);
    background: rgba(125, 176, 255, 0.14);
  }
`;

const ToolbarActions = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

const SendToggle = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.12));
  border-radius: 999px;
  color: var(--forge-text-muted, #7a8493);
  background: transparent;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;

  &[data-active="true"] {
    border-color: rgba(60, 203, 127, 0.35);
    color: rgba(150, 230, 185, 0.95);
  }
`;

const SendToggleKnob = styled.span`
  width: 22px;
  height: 12px;
  border-radius: 999px;
  background: rgba(122, 132, 147, 0.4);
  position: relative;

  &::after {
    content: "";
    position: absolute;
    top: 2px;
    left: 2px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: rgba(244, 247, 250, 0.85);
    transition: transform 130ms ease;
  }

  &[data-active="true"] {
    background: rgba(60, 203, 127, 0.5);
  }

  &[data-active="true"]::after {
    transform: translateX(10px);
  }
`;

const GhostButton = styled.button`
  padding: 5px 10px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.12));
  border-radius: 7px;
  color: var(--forge-text-muted, #7a8493);
  background: transparent;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;

  &:hover:not(:disabled) {
    color: var(--forge-text, #f4f7fa);
  }

  &:disabled {
    cursor: default;
    opacity: 0.55;
  }
`;

const Notice = styled.div`
  padding: 5px 9px;
  border: 1px solid rgba(60, 203, 127, 0.25);
  border-radius: 7px;
  color: rgba(170, 235, 200, 0.95);
  background: rgba(10, 40, 25, 0.3);
  font-size: 11px;
  font-weight: 650;
`;

const ItemsScroll = styled.div`
  display: grid;
  align-content: start;
  gap: 4px;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
`;

const GroupLabel = styled.span`
  margin-top: 4px;
  color: var(--forge-text-muted, #7a8493);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
`;

const ToolRow = styled.div`
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border: 1px solid var(--forge-border, rgba(230, 236, 245, 0.08));
  border-radius: 8px;
  background: rgba(13, 17, 23, 0.5);
  cursor: grab;

  &:hover {
    border-color: rgba(125, 176, 255, 0.25);
  }

  &:active {
    cursor: grabbing;
  }
`;

const ToolGlyph = styled.span`
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 13px;

  &[data-kind="architecture"] {
    color: rgba(125, 176, 255, 0.9);
    background: rgba(59, 130, 246, 0.12);
  }

  &[data-kind="skill"] {
    color: rgba(223, 165, 90, 0.95);
    background: rgba(223, 165, 90, 0.12);
  }
`;

const ToolCopy = styled.div`
  display: grid;
  min-width: 0;
  gap: 1px;

  strong {
    overflow: hidden;
    font-size: 12px;
    font-weight: 750;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  span {
    overflow: hidden;
    color: var(--forge-text-muted, #7a8493);
    font-size: 10.5px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const AddButton = styled.button`
  padding: 5px 10px;
  border: 1px solid rgba(125, 176, 255, 0.3);
  border-radius: 7px;
  color: rgba(200, 222, 255, 0.95);
  background: rgba(59, 130, 246, 0.14);
  font-size: 11px;
  font-weight: 750;
  cursor: pointer;

  &:hover {
    background: rgba(59, 130, 246, 0.26);
  }
`;

const Empty = styled.p`
  margin: 8px 0 0;
  color: var(--forge-text-muted, #7a8493);
  font-size: 11.5px;
`;

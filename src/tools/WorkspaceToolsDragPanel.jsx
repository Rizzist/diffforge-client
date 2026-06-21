import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import styled from "styled-components";
import {
  ensureWorkspaceToolsFresh,
  getWorkspaceToolsSkills,
  getWorkspaceToolsVersion,
  hasWorkspaceToolsLoaded,
  subscribeWorkspaceTools,
  workspaceToolsRepoDescriptors,
} from "./workspaceToolsStore.js";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "docs", label: "Docs" },
];

const FILTER_STORAGE_PREFIX = "diffforge.workspaceTools.filter";
const SEND_STORAGE_PREFIX = "diffforge.workspaceTools.sendOnDrop";
export const WORKSPACE_TOOL_TODO_DRAG_MIME = "application/x-diffforge-workspace-tool-todo";

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

function docTodoText(entry) {
  const body = text(entry.body).slice(0, 4000);
  return body
    ? `Apply the "${entry.title}" account doc:\n\n${body}`
    : `Apply the "${entry.title}" account doc.`;
}

/**
 * Drag-and-drop sources for account docs. Items can be dragged into the todo
 * composer or clicked; the send-on-drop toggle decides whether a click queues
 * immediately or just lists the todo.
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
  const [notice, setNotice] = useState("");

  const repoDescriptors = useMemo(
    () => workspaceToolsRepoDescriptors(coordinationTargets, rootDirectory),
    [coordinationTargets, rootDirectory],
  );
  const storeVersion = useSyncExternalStore(subscribeWorkspaceTools, getWorkspaceToolsVersion);

  useEffect(() => {
    ensureWorkspaceToolsFresh(repoDescriptors);
  }, [repoDescriptors]);

  const skills = useMemo(
    () => getWorkspaceToolsSkills(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeVersion],
  );
  const toolsLoaded = hasWorkspaceToolsLoaded(repoDescriptors);

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
    event.dataTransfer.setData(WORKSPACE_TOOL_TODO_DRAG_MIME, JSON.stringify({ text: todoText }));
    event.dataTransfer.setData("text/plain", todoText);
    event.dataTransfer.effectAllowed = "copy";
  }, []);

  const visibleDocs = filter === "docs" || filter === "all" ? skills : [];

  return (
    <Panel aria-label="Draggable workspace docs">
      <Toolbar>
        <FilterNav role="tablist" aria-label="Doc filter">
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
              ? "Clicking queues immediately; dropping sends only over a terminal"
              : "Clicking adds without sending; dropping sends only over a terminal"}
            type="button"
          >
            <SendToggleKnob aria-hidden="true" data-active={sendOnDrop ? "true" : "false"} />
            Send on drop
          </SendToggle>
        </ToolbarActions>
      </Toolbar>
      {notice && <Notice aria-live="polite">{notice}</Notice>}

      <ItemsScroll>
        {visibleDocs.length > 0 && (
          <>
            <GroupLabel>Docs</GroupLabel>
            {visibleDocs.map((entry) => {
              const todoText = docTodoText(entry);
              return (
                <ToolRow
                  draggable
                  key={`doc:${entry.title}`}
                  onDragStart={(event) => handleDragStart(event, todoText)}
                  title="Drag onto a terminal, or click + to add"
                >
                  <ToolGlyph aria-hidden="true" data-kind="doc">✦</ToolGlyph>
                  <ToolCopy>
                    <strong>{entry.title}</strong>
                    <span>{text(entry.body).split("\n").find(Boolean) || "Account doc"}</span>
                  </ToolCopy>
                  <AddButton
                    aria-label={`Add doc ${entry.title} as todo`}
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
        {toolsLoaded && !visibleDocs.length && (
          <Empty>
            {filter === "docs"
              ? "No docs yet — create one in Tools > Docs."
              : "No docs yet."}
          </Empty>
        )}
        {!toolsLoaded && !visibleDocs.length && (
          <Empty>Loading docs…</Empty>
        )}
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

  html[data-forge-theme="light"] & {
    background: rgba(0, 0, 0, 0.045);
  }
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
    background: rgba(var(--forge-tint-rgb), 0.14);
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
    border-color: rgba(var(--forge-tint-soft-rgb), 0.25);
  }

  &:active {
    cursor: grabbing;
  }

  html[data-forge-theme="light"] & {
    background: #ffffff;
  }
`;

const ToolGlyph = styled.span`
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 6px;
  font-size: 13px;

  &[data-kind="doc"] {
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
  border: 1px solid rgba(var(--forge-tint-soft-rgb), 0.3);
  border-radius: 7px;
  color: var(--forge-tint-soft);
  background: rgba(var(--forge-tint-rgb), 0.14);
  font-size: 11px;
  font-weight: 750;
  cursor: pointer;

  &:hover {
    background: rgba(var(--forge-tint-rgb), 0.26);
  }
`;

const Empty = styled.p`
  margin: 8px 0 0;
  color: var(--forge-text-muted, #7a8493);
  font-size: 11.5px;
`;

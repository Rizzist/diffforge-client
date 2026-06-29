import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { Group, Panel, Separator } from "react-resizable-panels";
import { invoke } from "@tauri-apps/api/core";
import PcbPanel from "./PcbPanel.jsx";

const STORAGE_PREFIX = "diffforge.pcb.openBoards.";

function loadOpenBoards(workspaceId) {
  if (!workspaceId) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + workspaceId);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((board) => board && typeof board.path === "string")
      : [];
  } catch {
    return [];
  }
}

function saveOpenBoards(workspaceId, boards) {
  if (!workspaceId) {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + workspaceId,
      JSON.stringify(boards.map((board) => ({ path: board.path, name: board.name }))),
    );
  } catch {
    /* persistence is best-effort */
  }
}

const ViewRoot = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  width: 100%;
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.14);
  flex: 0 0 auto;
`;

const ToolbarButton = styled.button`
  appearance: none;
  border: 1px solid rgba(16, 185, 129, 0.32);
  background: rgba(16, 185, 129, 0.1);
  color: #a7f3d0;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 10px;
  border-radius: 7px;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.18);
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

const BoardPicker = styled.select`
  appearance: auto;
  background: #0b1626;
  color: #cbd5f5;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 7px;
  font-size: 12px;
  padding: 5px 8px;
  max-width: 220px;
`;

const ToolbarSpacer = styled.div`
  flex: 1 1 auto;
`;

const ToolbarError = styled.span`
  font-size: 11px;
  color: #fca5a5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;
`;

const GridArea = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  padding: 10px;
`;

const PanelSlot = styled(Panel)`
  min-width: 0;
  min-height: 0;
  display: flex;
`;

const GridSeparator = styled(Separator)`
  width: 8px;
  background: transparent;
  cursor: col-resize;

  &:hover {
    background: rgba(16, 185, 129, 0.16);
  }
`;

const EmptyState = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  height: 100%;
  color: #94a3b8;
  font-size: 13px;
  text-align: center;
`;

export default function PcbView({ workspace, rootDirectory }) {
  const repoPath = rootDirectory || "";
  const workspaceId = workspace?.id || "";
  const [openBoards, setOpenBoards] = useState([]);
  const [available, setAvailable] = useState([]);
  const [activePath, setActivePath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const restoredForWorkspace = useRef("");

  const refreshList = useCallback(() => {
    if (!repoPath) {
      return;
    }
    invoke("pcb_documents_list", { repoPath })
      .then((result) => setAvailable(Array.isArray(result?.boards) ? result.boards : []))
      .catch((err) => setError(String(err)));
  }, [repoPath]);

  // Start the per-workspace filesystem watcher + load the board list.
  useEffect(() => {
    if (!repoPath) {
      return;
    }
    invoke("pcb_watch_start", { repoPath }).catch(() => {});
    refreshList();
  }, [repoPath, refreshList]);

  // Restore the boards that were open for this workspace.
  useEffect(() => {
    if (!workspaceId || restoredForWorkspace.current === workspaceId) {
      return;
    }
    restoredForWorkspace.current = workspaceId;
    const restored = loadOpenBoards(workspaceId);
    setOpenBoards(restored);
    setActivePath(restored[0]?.path || "");
  }, [workspaceId]);

  // Persist open boards whenever they change.
  useEffect(() => {
    if (restoredForWorkspace.current === workspaceId) {
      saveOpenBoards(workspaceId, openBoards);
    }
  }, [workspaceId, openBoards]);

  const openBoard = useCallback((board) => {
    if (!board?.path) {
      return;
    }
    setOpenBoards((current) =>
      current.some((entry) => entry.path === board.path)
        ? current
        : [...current, { path: board.path, name: board.name || board.path }],
    );
    setActivePath(board.path);
  }, []);

  const closeBoard = useCallback((board) => {
    setOpenBoards((current) => {
      const next = current.filter((entry) => entry.path !== board.path);
      setActivePath((active) =>
        active === board.path ? next[next.length - 1]?.path || "" : active,
      );
      return next;
    });
  }, []);

  const popOutBoard = useCallback(
    (board) => {
      if (!board?.path) {
        return;
      }
      invoke("pcb_window_open", {
        repoPath,
        boardPath: board.path,
        boardName: board.name || board.path,
      }).catch((err) => setError(String(err)));
    },
    [repoPath],
  );

  const createBoard = useCallback(() => {
    if (!repoPath) {
      return;
    }
    const name = window.prompt("New PCB board name", "blinky");
    if (!name) {
      return;
    }
    setBusy(true);
    setError("");
    invoke("pcb_document_create", { repoPath, name })
      .then((doc) => {
        openBoard({ path: doc?.path, name: doc?.name });
        refreshList();
      })
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(false));
  }, [repoPath, openBoard, refreshList]);

  const handlePick = useCallback(
    (event) => {
      const path = event.target.value;
      if (!path) {
        return;
      }
      const board = available.find((entry) => entry.path === path);
      if (board) {
        openBoard(board);
      }
      event.target.value = "";
    },
    [available, openBoard],
  );

  const unopened = useMemo(
    () => available.filter((board) => !openBoards.some((entry) => entry.path === board.path)),
    [available, openBoards],
  );

  return (
    <ViewRoot>
      <Toolbar>
        <ToolbarButton disabled={busy || !repoPath} onClick={createBoard} type="button">
          + New board
        </ToolbarButton>
        <BoardPicker defaultValue="" disabled={!unopened.length} onChange={handlePick}>
          <option value="">
            {unopened.length ? "Open existing board…" : "No other boards"}
          </option>
          {unopened.map((board) => (
            <option key={board.path} value={board.path}>
              {board.name || board.path}
            </option>
          ))}
        </BoardPicker>
        <ToolbarSpacer />
        {error ? <ToolbarError title={error}>{error}</ToolbarError> : null}
      </Toolbar>
      <GridArea>
        {openBoards.length === 0 ? (
          <EmptyState>
            <div>No PCB boards open.</div>
            <ToolbarButton disabled={busy || !repoPath} onClick={createBoard} type="button">
              + Create your first board
            </ToolbarButton>
          </EmptyState>
        ) : (
          <Group orientation="horizontal" style={{ height: "100%", width: "100%" }}>
            {openBoards.map((board, index) => (
              <React.Fragment key={board.path}>
                {index > 0 ? <GridSeparator /> : null}
                <PanelSlot>
                  <PcbPanel
                    board={board}
                    isActive={activePath === board.path}
                    onActivate={() => setActivePath(board.path)}
                    onClose={closeBoard}
                    onPopOut={popOutBoard}
                    repoPath={repoPath}
                  />
                </PanelSlot>
              </React.Fragment>
            ))}
          </Group>
        )}
      </GridArea>
    </ViewRoot>
  );
}

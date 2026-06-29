import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { Group, Panel, Separator } from "react-resizable-panels";
import { invoke } from "@tauri-apps/api/core";
import PcbPanel from "./PcbPanel.jsx";

const STORAGE_PREFIX = "diffforge.pcb.slots.";

// A slot is one panel in the grid: bound to a board (path) or empty (path: null,
// shows the create/select chooser).
function loadSlots(workspaceId) {
  if (!workspaceId) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + workspaceId);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((slot) => slot && typeof slot === "object")
      .map((slot) => ({ path: typeof slot.path === "string" ? slot.path : null }));
  } catch {
    return [];
  }
}

function saveSlots(workspaceId, slots) {
  if (!workspaceId) {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + workspaceId,
      JSON.stringify(slots.map((slot) => ({ path: slot.path }))),
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

const ToolbarSpacer = styled.div`
  flex: 1 1 auto;
`;

const ToolbarCount = styled.span`
  font-size: 11px;
  color: #94a3b8;
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

const ChooserShell = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 16px;
  background: #07101d;
  border: 1px dashed rgba(148, 163, 184, 0.26);
  border-radius: 10px;
`;

const ChooserTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #a7f3d0;
`;

const ChooserHint = styled.div`
  font-size: 11px;
  color: #94a3b8;
  text-align: center;
`;

const ChooserClose = styled.button`
  position: absolute;
  top: 8px;
  right: 8px;
  appearance: none;
  border: none;
  background: transparent;
  color: #cbd5f5;
  font-size: 15px;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;

  &:hover {
    background: rgba(148, 163, 184, 0.16);
    color: #ffffff;
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
  max-width: 240px;
`;

// Inline chooser shown in an empty panel: create a new design or open one.
function PcbSlotChooser({ available, busy, repoPath, onCreate, onSelect, onClose }) {
  const handlePick = useCallback(
    (event) => {
      const path = event.target.value;
      if (!path) {
        return;
      }
      const board = available.find((entry) => entry.path === path);
      if (board) {
        onSelect(board);
      }
    },
    [available, onSelect],
  );

  return (
    <ChooserShell>
      {onClose ? (
        <ChooserClose aria-label="Remove panel" onClick={onClose} title="Remove panel" type="button">
          ×
        </ChooserClose>
      ) : null}
      <ChooserTitle>PCB design</ChooserTitle>
      <ChooserHint>Create a new board or open an existing design.</ChooserHint>
      <ToolbarButton disabled={busy || !repoPath} onClick={onCreate} type="button">
        + New board
      </ToolbarButton>
      <BoardPicker defaultValue="" disabled={!available.length} onChange={handlePick}>
        <option value="">{available.length ? "Open existing design…" : "No saved designs yet"}</option>
        {available.map((board) => (
          <option key={board.path} value={board.path}>
            {board.name || board.path}
          </option>
        ))}
      </BoardPicker>
    </ChooserShell>
  );
}

export default function PcbView({ workspace, rootDirectory, initialPanelCount = 0 }) {
  const repoPath = rootDirectory || "";
  const workspaceId = workspace?.id || "";
  const [slots, setSlots] = useState([]);
  const [available, setAvailable] = useState([]);
  const [activeKey, setActiveKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const restoredFor = useRef("");
  const slotSeq = useRef(0);

  const makeSlot = useCallback((path = null) => {
    slotSeq.current += 1;
    return { key: `slot-${slotSeq.current}`, path: path || null };
  }, []);

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

  // Restore slots for this workspace; otherwise seed empty slots from the
  // create-modal count (at least one so the view is never blank).
  useEffect(() => {
    if (!workspaceId || restoredFor.current === workspaceId) {
      return;
    }
    restoredFor.current = workspaceId;
    const restored = loadSlots(workspaceId).map((slot) => makeSlot(slot.path));
    const seedCount = Math.max(1, Number(initialPanelCount) || 0);
    const next = restored.length ? restored : Array.from({ length: seedCount }, () => makeSlot());
    setSlots(next);
    setActiveKey(next[0]?.key || "");
  }, [workspaceId, initialPanelCount, makeSlot]);

  // Persist slots whenever they change.
  useEffect(() => {
    if (restoredFor.current === workspaceId) {
      saveSlots(workspaceId, slots);
    }
  }, [workspaceId, slots]);

  const addSlot = useCallback(() => {
    setSlots((current) => {
      const slot = makeSlot();
      setActiveKey(slot.key);
      return [...current, slot];
    });
  }, [makeSlot]);

  const closeSlot = useCallback((key) => {
    setSlots((current) => current.filter((slot) => slot.key !== key));
  }, []);

  const bindSlot = useCallback((key, board) => {
    if (!board?.path) {
      return;
    }
    setSlots((current) =>
      current.map((slot) => (slot.key === key ? { ...slot, path: board.path } : slot)),
    );
    setActiveKey(key);
  }, []);

  const createInSlot = useCallback(
    (key) => {
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
          if (doc?.path) {
            bindSlot(key, { path: doc.path, name: doc.name });
          }
          refreshList();
        })
        .catch((err) => setError(String(err)))
        .finally(() => setBusy(false));
    },
    [repoPath, bindSlot, refreshList],
  );

  const popOut = useCallback(
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

  const boardName = useCallback(
    (path) => available.find((entry) => entry.path === path)?.name || path,
    [available],
  );

  const boundCount = useMemo(() => slots.filter((slot) => slot.path).length, [slots]);

  return (
    <ViewRoot>
      <Toolbar>
        <ToolbarButton disabled={!repoPath} onClick={addSlot} type="button">
          + Add panel
        </ToolbarButton>
        {slots.length ? (
          <ToolbarCount>
            {slots.length} panel{slots.length === 1 ? "" : "s"} · {boundCount} design
            {boundCount === 1 ? "" : "s"}
          </ToolbarCount>
        ) : null}
        <ToolbarSpacer />
        {error ? <ToolbarError title={error}>{error}</ToolbarError> : null}
      </Toolbar>
      <GridArea>
        {slots.length === 0 ? (
          <EmptyState>
            <div>No PCB panels.</div>
            <ToolbarButton disabled={!repoPath} onClick={addSlot} type="button">
              + Add a panel
            </ToolbarButton>
          </EmptyState>
        ) : (
          <Group orientation="horizontal" style={{ height: "100%", width: "100%" }}>
            {slots.map((slot, index) => (
              <React.Fragment key={slot.key}>
                {index > 0 ? <GridSeparator /> : null}
                <PanelSlot>
                  {slot.path ? (
                    <PcbPanel
                      board={{ path: slot.path, name: boardName(slot.path) }}
                      isActive={activeKey === slot.key}
                      onActivate={() => setActiveKey(slot.key)}
                      onClose={() => closeSlot(slot.key)}
                      onPopOut={popOut}
                      repoPath={repoPath}
                    />
                  ) : (
                    <PcbSlotChooser
                      available={available}
                      busy={busy}
                      onClose={slots.length > 1 ? () => closeSlot(slot.key) : null}
                      onCreate={() => createInSlot(slot.key)}
                      onSelect={(board) => bindSlot(slot.key, board)}
                      repoPath={repoPath}
                    />
                  )}
                </PanelSlot>
              </React.Fragment>
            ))}
          </Group>
        )}
      </GridArea>
    </ViewRoot>
  );
}

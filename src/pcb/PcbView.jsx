import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { Group, Panel, Separator } from "react-resizable-panels";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import PcbPanel, { PCB_STORE_CHANGED_EVENT } from "./PcbPanel.jsx";
import AppSelect from "../app/AppSelect.jsx";

const STORAGE_PREFIX = "diffforge.pcb.slots.";

function normalizeRepoIdentity(repoPath) {
  return String(repoPath || "").trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}

function slotStorageKey(workspaceId, repoPath) {
  const safeWorkspaceId = String(workspaceId || "").trim();
  const repoIdentity = normalizeRepoIdentity(repoPath);
  return safeWorkspaceId && repoIdentity
    ? `${STORAGE_PREFIX}${encodeURIComponent(safeWorkspaceId)}.${encodeURIComponent(repoIdentity)}`
    : "";
}

// A slot is one panel in the grid: bound to a board (path) or empty (path: null,
// shows the create/select chooser).
function loadSlots(workspaceId, repoPath) {
  const key = slotStorageKey(workspaceId, repoPath);
  if (!key) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    const slots = Array.isArray(parsed) ? parsed : parsed?.slots;
    if (parsed?.repoPath && normalizeRepoIdentity(parsed.repoPath) !== normalizeRepoIdentity(repoPath)) {
      return [];
    }
    if (!Array.isArray(slots)) {
      return [];
    }
    return slots
      .filter((slot) => slot && typeof slot === "object")
      .map((slot) => ({ path: typeof slot.path === "string" ? slot.path : null }));
  } catch {
    return [];
  }
}

function saveSlots(workspaceId, repoPath, slots) {
  const key = slotStorageKey(workspaceId, repoPath);
  if (!key) {
    return;
  }
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({
        repoPath: normalizeRepoIdentity(repoPath),
        slots: slots.map((slot) => ({ path: slot.path })),
      }),
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

  html[data-forge-theme="light"] & {
    border-bottom-color: rgba(15, 23, 42, 0.1);
  }
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

  html[data-forge-theme="light"] & {
    border-color: rgba(16, 185, 129, 0.34);
    background: rgba(16, 185, 129, 0.12);
    color: #047857;
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.2);
  }
`;

const ToolbarSpacer = styled.div`
  flex: 1 1 auto;
`;

const ToolbarCount = styled.span`
  font-size: 11px;
  color: #94a3b8;

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
`;

const ToolbarError = styled.span`
  font-size: 11px;
  color: #fca5a5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 40%;

  html[data-forge-theme="light"] & {
    color: #dc2626;
  }
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

  html[data-forge-theme="light"] &:hover {
    background: rgba(16, 185, 129, 0.18);
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

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
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

  html[data-forge-theme="light"] & {
    background: #f8fafc;
    border-color: rgba(15, 23, 42, 0.16);
  }
`;

const ChooserTitle = styled.div`
  font-size: 13px;
  font-weight: 600;
  color: #a7f3d0;

  html[data-forge-theme="light"] & {
    color: #047857;
  }
`;

const ChooserHint = styled.div`
  font-size: 11px;
  color: #94a3b8;
  text-align: center;

  html[data-forge-theme="light"] & {
    color: #64748b;
  }
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

  html[data-forge-theme="light"] & {
    color: #475569;
  }

  html[data-forge-theme="light"] &:hover {
    background: rgba(15, 23, 42, 0.06);
    color: #0f172a;
  }
`;

const BoardPickerWrap = styled.div`
  width: 240px;
  max-width: 100%;
`;

const ChooserCreateForm = styled.form`
  display: grid;
  width: min(280px, 100%);
  gap: 8px;
`;

const ChooserInput = styled.input`
  min-width: 0;
  min-height: 34px;
  padding: 0 11px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  border-radius: 7px;
  outline: 0;
  color: rgba(241, 245, 249, 0.94);
  background: rgba(2, 6, 12, 0.82);
  font-size: 12px;
  font-weight: 750;

  &:focus {
    border-color: rgba(16, 185, 129, 0.55);
    box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.14);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.14);
    color: #0f172a;
    background: #ffffff;
  }
`;

const ChooserCreateActions = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
`;

const ChooserCancelButton = styled.button`
  min-height: 30px;
  padding: 0 12px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  border-radius: 7px;
  color: rgba(203, 213, 225, 0.84);
  background: rgba(15, 23, 42, 0.54);
  font-size: 12px;
  font-weight: 780;
  cursor: pointer;

  &:hover:not(:disabled) {
    border-color: rgba(148, 163, 184, 0.34);
    color: rgba(241, 245, 249, 0.94);
  }

  html[data-forge-theme="light"] & {
    border-color: rgba(15, 23, 42, 0.12);
    color: #475569;
    background: #f8fafc;
  }

  html[data-forge-theme="light"] &:hover:not(:disabled) {
    border-color: rgba(15, 23, 42, 0.2);
    color: #0f172a;
  }
`;

// Inline chooser shown in an empty panel: create a new design or open one.
function PcbSlotChooser({ available, busy, repoPath, onCreate, onSelect, onClose }) {
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("blinky");
  const inputRef = useRef(null);
  const handlePick = useCallback(
    (path) => {
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

  useEffect(() => {
    if (!creating) {
      return;
    }
    window.requestAnimationFrame(() => {
      inputRef.current?.focus?.();
      inputRef.current?.select?.();
    });
  }, [creating]);

  const handleCreate = useCallback((event) => {
    event.preventDefault();
    const cleanName = String(draftName || "").trim();
    if (!cleanName) {
      return;
    }
    Promise.resolve(onCreate?.(cleanName))
      .then(() => {
        setCreating(false);
        setDraftName("blinky");
      })
      .catch(() => {});
  }, [draftName, onCreate]);

  const options = useMemo(
    () => available.map((board) => ({ value: board.path, label: board.name || board.path })),
    [available],
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
      {creating ? (
        <ChooserCreateForm onSubmit={handleCreate}>
          <ChooserInput
            aria-label="PCB board name"
            disabled={busy}
            onChange={(event) => setDraftName(event.target.value)}
            ref={inputRef}
            value={draftName}
          />
          <ChooserCreateActions>
            <ToolbarButton disabled={busy || !repoPath || !draftName.trim()} type="submit">
              Create board
            </ToolbarButton>
            <ChooserCancelButton disabled={busy} onClick={() => setCreating(false)} type="button">
              Cancel
            </ChooserCancelButton>
          </ChooserCreateActions>
        </ChooserCreateForm>
      ) : (
        <ToolbarButton disabled={busy || !repoPath} onClick={() => setCreating(true)} type="button">
          + New board
        </ToolbarButton>
      )}
      <BoardPickerWrap>
        <AppSelect
          isDisabled={!available.length}
          onChange={handlePick}
          options={options}
          placeholder={available.length ? "Open existing design…" : "No saved designs yet"}
          value={null}
        />
      </BoardPickerWrap>
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
  const skipPersistFor = useRef("");
  const slotSeq = useRef(0);
  const restoreKey = useMemo(() => slotStorageKey(workspaceId, repoPath), [repoPath, workspaceId]);

  const makeSlot = useCallback((path = null) => {
    slotSeq.current += 1;
    return { key: `slot-${slotSeq.current}`, path: path || null };
  }, []);

  const refreshList = useCallback(() => {
    if (!repoPath) {
      return;
    }
    invoke("pcb_documents_list", { repoPath, workspaceId })
      .then((result) => setAvailable(Array.isArray(result?.boards) ? result.boards : []))
      .catch((err) => setError(String(err)));
  }, [repoPath, workspaceId]);

  // Start the per-workspace filesystem watcher + load the board list.
  useEffect(() => {
    if (!repoPath) {
      return;
    }
    invoke("pcb_watch_start", { repoPath }).catch(() => {});
    refreshList();
  }, [repoPath, refreshList]);

  useEffect(() => {
    if (!repoPath) {
      return undefined;
    }
    let disposed = false;
    let unlisten = () => {};
    listen(PCB_STORE_CHANGED_EVENT, (event) => {
      if (disposed) {
        return;
      }
      const eventRepo = normalizeRepoIdentity(event?.payload?.repoPath);
      const eventWorkspace = String(event?.payload?.workspaceId || event?.payload?.workspace_id || "").trim();
      if (eventRepo && eventRepo !== normalizeRepoIdentity(repoPath)) {
        return;
      }
      if (eventWorkspace && workspaceId && eventWorkspace !== workspaceId) {
        return;
      }
      refreshList();
    })
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
        } else {
          unlisten = nextUnlisten;
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten();
    };
  }, [refreshList, repoPath, workspaceId]);

  // Restore slots for this workspace; otherwise seed empty slots from the
  // create-modal count (at least one so the view is never blank).
  useEffect(() => {
    if (!restoreKey || restoredFor.current === restoreKey) {
      return;
    }
    restoredFor.current = restoreKey;
    skipPersistFor.current = restoreKey;
    const restored = loadSlots(workspaceId, repoPath).map((slot) => makeSlot(slot.path));
    const seedCount = Math.max(1, Number(initialPanelCount) || 0);
    const next = restored.length ? restored : Array.from({ length: seedCount }, () => makeSlot());
    setSlots(next);
    setActiveKey(next[0]?.key || "");
  }, [workspaceId, initialPanelCount, makeSlot, repoPath, restoreKey]);

  // Persist slots whenever they change.
  useEffect(() => {
    if (!restoreKey || restoredFor.current !== restoreKey) {
      return;
    }
    if (skipPersistFor.current === restoreKey) {
      skipPersistFor.current = "";
      return;
    }
    saveSlots(workspaceId, repoPath, slots);
  }, [repoPath, restoreKey, slots, workspaceId]);

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
    (key, name) => {
      if (!repoPath) {
        return Promise.resolve(null);
      }
      setBusy(true);
      setError("");
      return invoke("pcb_document_create", { repoPath, name, workspaceId })
        .then((doc) => {
          if (doc?.path) {
            bindSlot(key, { path: doc.path, name: doc.name });
          }
          refreshList();
        })
        .catch((err) => {
          setError(String(err));
          throw err;
        })
        .finally(() => setBusy(false));
    },
    [repoPath, bindSlot, refreshList, workspaceId],
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
        workspaceId,
      }).catch((err) => setError(String(err)));
    },
    [repoPath, workspaceId],
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
                      workspaceId={workspaceId}
                    />
                  ) : (
                    <PcbSlotChooser
                      available={available}
                      busy={busy}
                      onClose={slots.length > 1 ? () => closeSlot(slot.key) : null}
                      onCreate={(name) => createInSlot(slot.key, name)}
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

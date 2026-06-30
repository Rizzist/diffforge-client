import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import AppSelect from "../app/AppSelect.jsx";
import PcbPanel, { PCB_STORE_CHANGED_EVENT } from "./PcbPanel.jsx";

const PCB_GRID_SLOT_STORAGE_PREFIX = "diffforge.pcb.gridPaneSlot.";

function normalizeRepoIdentity(repoPath) {
  return String(repoPath || "").trim().replace(/\\/g, "/").replace(/\/+$/g, "");
}

function storageSegment(value) {
  return encodeURIComponent(String(value || "").trim());
}

function storageKeyForPane(workspaceId, paneId, repoPath) {
  const safeWorkspaceId = String(workspaceId || "").trim();
  const safePaneId = String(paneId || "").trim();
  const repoIdentity = normalizeRepoIdentity(repoPath);
  return safeWorkspaceId && safePaneId && repoIdentity
    ? `${PCB_GRID_SLOT_STORAGE_PREFIX}${storageSegment(safeWorkspaceId)}.${storageSegment(repoIdentity)}.${storageSegment(safePaneId)}`
    : "";
}

function readStoredBoardPath(workspaceId, paneId, repoPath) {
  const key = storageKeyForPane(workspaceId, paneId, repoPath);
  if (!key) {
    return "";
  }
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    const repoIdentity = normalizeRepoIdentity(repoPath);
    if (parsed?.repoPath && normalizeRepoIdentity(parsed.repoPath) !== repoIdentity) {
      return "";
    }
    return typeof parsed?.path === "string" ? parsed.path : "";
  } catch {
    return "";
  }
}

function writeStoredBoardPath(workspaceId, paneId, repoPath, boardPath) {
  const key = storageKeyForPane(workspaceId, paneId, repoPath);
  if (!key) {
    return;
  }
  try {
    if (boardPath) {
      window.localStorage.setItem(key, JSON.stringify({
        path: boardPath,
        repoPath: normalizeRepoIdentity(repoPath),
      }));
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* local pane persistence is best-effort */
  }
}

const PaneSurface = styled.div`
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: #020304;
`;

const PaneBody = styled.div`
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
`;

const EmptyPane = styled.div`
  display: grid;
  width: 100%;
  min-width: 0;
  min-height: 0;
  place-items: center;
  padding: 18px;
  color: rgba(203, 213, 225, 0.82);
  background:
    linear-gradient(135deg, rgba(16, 185, 129, 0.08), transparent 34%),
    #04070d;
`;

const EmptyCard = styled.div`
  display: flex;
  width: min(360px, 100%);
  min-width: 0;
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding: 16px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 8px;
  background: rgba(11, 14, 20, 0.88);
`;

const EmptyTitle = styled.div`
  color: rgba(241, 245, 249, 0.92);
  font-size: 13px;
  font-weight: 850;
`;

const EmptyHint = styled.div`
  color: rgba(148, 163, 184, 0.88);
  font-size: 11px;
  font-weight: 700;
  line-height: 1.35;
`;

const PaneButton = styled.button`
  appearance: none;
  min-height: 30px;
  border: 1px solid rgba(16, 185, 129, 0.34);
  border-radius: 7px;
  color: #d1fae5;
  background: rgba(16, 185, 129, 0.12);
  font-size: 12px;
  font-weight: 850;
  cursor: pointer;

  &:hover:not(:disabled) {
    background: rgba(16, 185, 129, 0.2);
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.45;
  }
`;

const DangerButton = styled(PaneButton)`
  border-color: rgba(248, 113, 113, 0.42);
  color: #fecaca;
  background: rgba(127, 29, 29, 0.28);

  &:hover:not(:disabled) {
    background: rgba(127, 29, 29, 0.42);
  }
`;

const SecondaryButton = styled(PaneButton)`
  border-color: rgba(148, 163, 184, 0.24);
  color: rgba(203, 213, 225, 0.88);
  background: rgba(15, 23, 42, 0.54);

  &:hover:not(:disabled) {
    background: rgba(30, 41, 59, 0.78);
  }
`;

const CreateOverlay = styled.div`
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-items: center;
  padding: 18px;
  background: rgba(2, 3, 4, 0.72);
  backdrop-filter: blur(10px);
`;

const CreateCard = styled(EmptyCard)`
  width: min(380px, 100%);
`;

const CreateInput = styled.input`
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

  &::placeholder {
    color: rgba(148, 163, 184, 0.72);
  }
`;

const CreateActions = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
`;

const CreateSecondaryRow = styled.div`
  display: flex;
  min-width: 0;
  justify-content: flex-start;
`;

const CreateCancelButton = styled.button`
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

  &:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
`;

const PaneError = styled.div`
  color: #fca5a5;
  font-size: 11px;
  font-weight: 750;
  line-height: 1.35;
`;

const CreatePickerWrap = styled.div`
  min-width: 0;
`;

const CreateLabel = styled.div`
  color: rgba(203, 213, 225, 0.78);
  font-size: 10px;
  font-weight: 850;
  letter-spacing: 0;
  text-transform: uppercase;
`;

export default function PcbWorkspacePane({
  controlCommand = null,
  createRequestNonce = 0,
  createRequestName = "",
  deleteRequestNonce = 0,
  isActive = true,
  onBoardChange = null,
  paneId = "",
  refreshRequestNonce = 0,
  repoPath = "",
  workspaceId = "",
}) {
  const [availableBoards, setAvailableBoards] = useState([]);
  const [boardListReady, setBoardListReady] = useState(false);
  const [selectedBoardPath, setSelectedBoardPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [draftName, setDraftName] = useState("blinky");
  const createInputRef = useRef(null);
  const controlCommandSeenRef = useRef(0);
  const restoredKeyRef = useRef("");
  const skipPersistForKeyRef = useRef("");
  const createRequestSeenRef = useRef(0);
  const deleteRequestSeenRef = useRef(0);
  const refreshRequestSeenRef = useRef(0);
  const boardListSeqRef = useRef(0);
  const repoIdentity = useMemo(() => normalizeRepoIdentity(repoPath), [repoPath]);
  const storageKey = useMemo(
    () => storageKeyForPane(workspaceId, paneId, repoPath),
    [paneId, repoPath, workspaceId],
  );

  const refreshBoardList = useCallback(() => {
    if (!repoPath) {
      boardListSeqRef.current += 1;
      setAvailableBoards([]);
      setBoardListReady(false);
      return Promise.resolve([]);
    }
    const requestSeq = boardListSeqRef.current + 1;
    boardListSeqRef.current = requestSeq;
    setBoardListReady(false);
    return invoke("pcb_documents_list", { repoPath, workspaceId })
      .then((result) => {
        if (boardListSeqRef.current !== requestSeq) {
          return [];
        }
        const boards = Array.isArray(result?.boards) ? result.boards : [];
        setAvailableBoards(boards);
        setBoardListReady(true);
        setError("");
        return boards;
      })
      .catch((err) => {
        if (boardListSeqRef.current !== requestSeq) {
          return [];
        }
        setBoardListReady(false);
        setError(String(err));
        throw err;
      });
  }, [repoPath, workspaceId]);

  useEffect(() => {
    if (!repoPath) {
      return;
    }
    invoke("pcb_watch_start", { repoPath }).catch(() => {});
    refreshBoardList().catch(() => {});
  }, [repoPath, refreshBoardList]);

  useEffect(() => {
    if (!storageKey || restoredKeyRef.current === storageKey) {
      return;
    }
    restoredKeyRef.current = storageKey;
    skipPersistForKeyRef.current = storageKey;
    setSelectedBoardPath(readStoredBoardPath(workspaceId, paneId, repoPath));
  }, [paneId, repoPath, storageKey, workspaceId]);

  useEffect(() => {
    if (!storageKey || restoredKeyRef.current !== storageKey) {
      return;
    }
    if (skipPersistForKeyRef.current === storageKey) {
      skipPersistForKeyRef.current = "";
      return;
    }
    writeStoredBoardPath(workspaceId, paneId, repoPath, selectedBoardPath);
  }, [paneId, repoPath, selectedBoardPath, storageKey, workspaceId]);

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
      if (eventRepo && eventRepo !== repoIdentity) {
        return;
      }
      if (eventWorkspace && workspaceId && eventWorkspace !== workspaceId) {
        return;
      }
      refreshBoardList().catch(() => {});
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
  }, [refreshBoardList, repoIdentity, repoPath, workspaceId]);

  const boardNameForPath = useCallback(
    (boardPath) => availableBoards.find((board) => board.path === boardPath)?.name || boardPath,
    [availableBoards],
  );

  const selectedBoard = useMemo(() => {
    if (!selectedBoardPath) {
      return null;
    }
    return {
      name: boardNameForPath(selectedBoardPath),
      path: selectedBoardPath,
    };
  }, [boardNameForPath, selectedBoardPath]);

  useEffect(() => {
    if (typeof onBoardChange === "function") {
      onBoardChange(selectedBoard);
    }
  }, [onBoardChange, selectedBoard]);

  const requestDeleteBoard = useCallback((target = null) => {
    const nextTarget = target || selectedBoard;
    if (!nextTarget?.path || deleting) {
      return;
    }
    setError("");
    setDeleteTarget(nextTarget);
  }, [deleting, selectedBoard]);

  const cancelDeleteBoard = useCallback(() => {
    if (deleting) {
      return;
    }
    setDeleteTarget(null);
    setError("");
  }, [deleting]);

  const confirmDeleteBoard = useCallback(() => {
    const target = deleteTarget;
    if (!repoPath || !target?.path || deleting) {
      return;
    }
    setDeleting(true);
    setError("");
    invoke("pcb_document_delete", {
      boardPath: target.path,
      repoPath,
      workspaceId,
    })
      .then(() => {
        setAvailableBoards((current) => current.filter((board) => board.path !== target.path));
        setDeleteTarget(null);
        setCreating(false);
        if (selectedBoardPath === target.path) {
          setSelectedBoardPath("");
          writeStoredBoardPath(workspaceId, paneId, repoPath, "");
        }
        refreshBoardList().catch(() => {});
      })
      .catch((err) => setError(String(err)))
      .finally(() => setDeleting(false));
  }, [
    deleteTarget,
    deleting,
    paneId,
    refreshBoardList,
    repoPath,
    selectedBoardPath,
    workspaceId,
  ]);

  const boardOptions = useMemo(
    () => availableBoards.map((board) => ({ label: board.name || board.path, value: board.path })),
    [availableBoards],
  );

  useEffect(() => {
    if (!boardListReady || !selectedBoardPath) {
      return;
    }
    if (!availableBoards.some((board) => board.path === selectedBoardPath)) {
      setSelectedBoardPath("");
    }
  }, [availableBoards, boardListReady, selectedBoardPath]);

  const selectBoardPath = useCallback((boardPath, options = {}) => {
    const cleanPath = String(boardPath || "").trim();
    if (!cleanPath) {
      return;
    }
    setError("");
    if (options.refreshFirst) {
      setBoardListReady(false);
    }
    setSelectedBoardPath(cleanPath);
    if (options.closeChooser) {
      setCreating(false);
    }
  }, []);

  const selectBoardByName = useCallback((boardName, boards = availableBoards) => {
    const cleanName = String(boardName || "").trim().toLowerCase();
    if (!cleanName) {
      return false;
    }
    const match = (Array.isArray(boards) ? boards : []).find((board) => (
      String(board.name || "").trim().toLowerCase() === cleanName
      || String(board.id || "").trim().toLowerCase() === cleanName
      || String(board.path || "").trim().toLowerCase() === cleanName
    ));
    if (!match?.path) {
      return false;
    }
    selectBoardPath(match.path, { closeChooser: true });
    return true;
  }, [availableBoards, selectBoardPath]);

  const openCreateBoard = useCallback((initialName = "") => {
    if (!repoPath || busy) {
      return;
    }
    const cleanInitialName = initialName && typeof initialName === "object"
      ? ""
      : String(initialName || "").trim();
    setError("");
    if (cleanInitialName) {
      setDraftName(cleanInitialName);
    }
    setCreating(true);
  }, [busy, repoPath]);

  useEffect(() => {
    if (!creating) {
      return;
    }
    window.requestAnimationFrame(() => {
      createInputRef.current?.focus?.();
      createInputRef.current?.select?.();
    });
  }, [creating]);

  const createBoardWithName = useCallback((boardName) => {
    if (!repoPath || busy) {
      return;
    }
    const cleanName = String(boardName || "").trim();
    if (!cleanName) {
      setError("Enter a board name.");
      return;
    }
    setBusy(true);
    setError("");
    invoke("pcb_document_create", { repoPath, name: cleanName, workspaceId })
      .then((doc) => {
        if (doc?.path) {
          setBoardListReady(false);
          setSelectedBoardPath(doc.path);
        }
        refreshBoardList().catch(() => {});
        setCreating(false);
        setDraftName("blinky");
      })
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(false));
  }, [busy, refreshBoardList, repoPath, workspaceId]);

  const submitCreateBoard = useCallback((event) => {
    event?.preventDefault?.();
    createBoardWithName(draftName);
  }, [createBoardWithName, draftName]);

  useEffect(() => {
    const nonce = Number(createRequestNonce || 0);
    if (!nonce || createRequestSeenRef.current === nonce) {
      return;
    }
    createRequestSeenRef.current = nonce;
    openCreateBoard(createRequestName);
  }, [createRequestName, createRequestNonce, openCreateBoard]);

  useEffect(() => {
    const nonce = Number(deleteRequestNonce || 0);
    if (!nonce || deleteRequestSeenRef.current === nonce) {
      return;
    }
    deleteRequestSeenRef.current = nonce;
    if (selectedBoard) {
      requestDeleteBoard(selectedBoard);
    } else {
      setError("Open a PCB board before deleting it.");
    }
  }, [deleteRequestNonce, requestDeleteBoard, selectedBoard]);

  useEffect(() => {
    const nonce = Number(refreshRequestNonce || 0);
    if (!nonce || refreshRequestSeenRef.current === nonce) {
      return;
    }
    refreshRequestSeenRef.current = nonce;
    refreshBoardList().catch(() => {});
  }, [refreshBoardList, refreshRequestNonce]);

  useEffect(() => {
    const nonce = Number(controlCommand?.nonce || 0);
    if (!nonce || controlCommandSeenRef.current === nonce) {
      return;
    }
    controlCommandSeenRef.current = nonce;
    const action = String(controlCommand?.action || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
    if (action === "create" || action === "new" || action === "new-board") {
      const requestedName = String(controlCommand?.name || controlCommand?.boardName || controlCommand?.board_name || "").trim();
      if (requestedName) {
        createBoardWithName(requestedName);
      } else {
        openCreateBoard();
      }
      return;
    }
    if (["select", "switch", "switch-board", "open-board", "open-existing"].includes(action)) {
      const requestedPath = String(
        controlCommand?.boardPath
          || controlCommand?.board_path
          || controlCommand?.path
          || controlCommand?.filePath
          || controlCommand?.file_path
          || "",
      ).trim();
      if (requestedPath) {
        selectBoardPath(requestedPath, { closeChooser: true, refreshFirst: true });
        refreshBoardList().catch(() => {});
        return;
      }
      const requestedName = String(
        controlCommand?.boardName
          || controlCommand?.board_name
          || controlCommand?.name
          || "",
      ).trim();
      if (requestedName) {
        if (!selectBoardByName(requestedName)) {
          refreshBoardList()
            .then((boards) => {
              if (!selectBoardByName(requestedName, boards)) {
                setError(`Board "${requestedName}" was not found in this workspace.`);
              }
            })
            .catch(() => {});
        }
        return;
      }
      setCreating(true);
      return;
    }
    if (action === "refresh" || action === "reload") {
      refreshBoardList().catch(() => {});
      return;
    }
    if (["delete", "delete-board", "remove-board"].includes(action)) {
      if (selectedBoard) {
        requestDeleteBoard(selectedBoard);
      } else {
        setError("Open a PCB board before deleting it.");
      }
    }
  }, [
    controlCommand,
    createBoardWithName,
    openCreateBoard,
    refreshBoardList,
    requestDeleteBoard,
    selectedBoard,
    selectBoardByName,
    selectBoardPath,
  ]);

  const selectBoardFromPicker = useCallback((boardPath) => {
    selectBoardPath(boardPath, { closeChooser: true });
  }, [selectBoardPath]);

  return (
    <PaneSurface data-workspace-pcb-surface="true">
      <PaneBody>
        {selectedBoard ? (
          <PcbPanel
            board={selectedBoard}
            embedded
            isActive={isActive}
            key={`${workspaceId}:${repoIdentity}:${selectedBoard.path}`}
            repoPath={repoPath}
            showHeader={false}
            workspaceId={workspaceId}
          />
        ) : (
          <EmptyPane>
            <EmptyCard>
              <EmptyTitle>PCB design</EmptyTitle>
              <EmptyHint>Create a board or open an existing design in this panel.</EmptyHint>
              <PaneButton disabled={busy || deleting || !repoPath} onClick={() => openCreateBoard()} type="button">
                + New board
              </PaneButton>
              <AppSelect
                isDisabled={!availableBoards.length || busy || deleting}
                onChange={selectBoardPath}
                options={boardOptions}
                placeholder={availableBoards.length ? "Open existing design" : "No saved designs yet"}
                value={null}
              />
              {error ? <PaneError role="alert">{error}</PaneError> : null}
            </EmptyCard>
          </EmptyPane>
        )}
        {creating ? (
          <CreateOverlay>
            <CreateCard as="form" onSubmit={submitCreateBoard}>
              <EmptyTitle>PCB board</EmptyTitle>
              <EmptyHint>Create a new board or switch to an existing design.</EmptyHint>
              <CreateLabel>Existing boards</CreateLabel>
              <CreatePickerWrap>
                <AppSelect
                  isDisabled={!availableBoards.length || busy || deleting}
                  onChange={selectBoardFromPicker}
                  options={boardOptions}
                  placeholder={availableBoards.length ? "Switch board" : "No saved designs yet"}
                  value={selectedBoardPath || null}
                />
              </CreatePickerWrap>
              {selectedBoard ? (
                <CreateSecondaryRow>
                  <DangerButton disabled={busy || deleting} onClick={() => requestDeleteBoard(selectedBoard)} type="button">
                    Delete selected board
                  </DangerButton>
                </CreateSecondaryRow>
              ) : null}
              <CreateLabel>New board</CreateLabel>
              <CreateInput
                aria-label="PCB board name"
                disabled={busy || deleting}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Board name"
                ref={createInputRef}
                value={draftName}
              />
              {error ? <PaneError role="alert">{error}</PaneError> : null}
              <CreateActions>
                <PaneButton disabled={busy || deleting || !repoPath} type="submit">
                  Create board
                </PaneButton>
                <CreateCancelButton
                  disabled={busy || deleting}
                  onClick={() => {
                    setCreating(false);
                    setError("");
                  }}
                  type="button"
                >
                  Cancel
                </CreateCancelButton>
              </CreateActions>
            </CreateCard>
          </CreateOverlay>
        ) : null}
        {deleteTarget ? (
          <CreateOverlay>
            <CreateCard role="dialog" aria-modal="true" aria-labelledby="pcb-delete-title">
              <EmptyTitle id="pcb-delete-title">Delete PCB board?</EmptyTitle>
              <EmptyHint>
                Delete {deleteTarget.name || deleteTarget.path} from this workspace. This removes the board file.
              </EmptyHint>
              {error ? <PaneError role="alert">{error}</PaneError> : null}
              <CreateActions>
                <DangerButton disabled={deleting || !repoPath} onClick={confirmDeleteBoard} type="button">
                  {deleting ? "Deleting..." : "Delete board"}
                </DangerButton>
                <CreateCancelButton disabled={deleting} onClick={cancelDeleteBoard} type="button">
                  Cancel
                </CreateCancelButton>
              </CreateActions>
            </CreateCard>
          </CreateOverlay>
        ) : null}
      </PaneBody>
    </PaneSurface>
  );
}

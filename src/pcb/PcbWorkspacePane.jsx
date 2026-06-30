import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styled from "styled-components";
import { invoke } from "@tauri-apps/api/core";

import AppSelect from "../app/AppSelect.jsx";
import PcbPanel from "./PcbPanel.jsx";

const PCB_GRID_SLOT_STORAGE_PREFIX = "diffforge.pcb.gridPaneSlot.";

function storageKeyForPane(workspaceId, paneId) {
  const safeWorkspaceId = String(workspaceId || "").trim();
  const safePaneId = String(paneId || "").trim();
  return safeWorkspaceId && safePaneId
    ? `${PCB_GRID_SLOT_STORAGE_PREFIX}${safeWorkspaceId}.${safePaneId}`
    : "";
}

function readStoredBoardPath(workspaceId, paneId) {
  const key = storageKeyForPane(workspaceId, paneId);
  if (!key) {
    return "";
  }
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return typeof parsed?.path === "string" ? parsed.path : "";
  } catch {
    return "";
  }
}

function writeStoredBoardPath(workspaceId, paneId, boardPath) {
  const key = storageKeyForPane(workspaceId, paneId);
  if (!key) {
    return;
  }
  try {
    if (boardPath) {
      window.localStorage.setItem(key, JSON.stringify({ path: boardPath }));
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

export default function PcbWorkspacePane({
  controlCommand = null,
  createRequestNonce = 0,
  createRequestName = "",
  isActive = true,
  onBoardChange = null,
  paneId = "",
  refreshRequestNonce = 0,
  repoPath = "",
  workspaceId = "",
}) {
  const [availableBoards, setAvailableBoards] = useState([]);
  const [selectedBoardPath, setSelectedBoardPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("blinky");
  const createInputRef = useRef(null);
  const controlCommandSeenRef = useRef(0);
  const restoredKeyRef = useRef("");
  const createRequestSeenRef = useRef(0);
  const refreshRequestSeenRef = useRef(0);

  const refreshBoardList = useCallback(() => {
    if (!repoPath) {
      setAvailableBoards([]);
      return;
    }
    invoke("pcb_documents_list", { repoPath })
      .then((result) => {
        setAvailableBoards(Array.isArray(result?.boards) ? result.boards : []);
        setError("");
      })
      .catch((err) => setError(String(err)));
  }, [repoPath]);

  useEffect(() => {
    if (!repoPath) {
      return;
    }
    invoke("pcb_watch_start", { repoPath }).catch(() => {});
    refreshBoardList();
  }, [repoPath, refreshBoardList]);

  useEffect(() => {
    const storageKey = storageKeyForPane(workspaceId, paneId);
    if (!storageKey || restoredKeyRef.current === storageKey) {
      return;
    }
    restoredKeyRef.current = storageKey;
    setSelectedBoardPath(readStoredBoardPath(workspaceId, paneId));
  }, [paneId, workspaceId]);

  useEffect(() => {
    if (restoredKeyRef.current === storageKeyForPane(workspaceId, paneId)) {
      writeStoredBoardPath(workspaceId, paneId, selectedBoardPath);
    }
  }, [paneId, selectedBoardPath, workspaceId]);

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

  const boardOptions = useMemo(
    () => availableBoards.map((board) => ({ label: board.name || board.path, value: board.path })),
    [availableBoards],
  );

  const openCreateBoard = useCallback((initialName = "") => {
    if (!repoPath || busy) {
      return;
    }
    const cleanInitialName = String(initialName || "").trim();
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
    invoke("pcb_document_create", { repoPath, name: cleanName })
      .then((doc) => {
        if (doc?.path) {
          setSelectedBoardPath(doc.path);
        }
        refreshBoardList();
        setCreating(false);
        setDraftName("blinky");
      })
      .catch((err) => setError(String(err)))
      .finally(() => setBusy(false));
  }, [busy, refreshBoardList, repoPath]);

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
    const nonce = Number(refreshRequestNonce || 0);
    if (!nonce || refreshRequestSeenRef.current === nonce) {
      return;
    }
    refreshRequestSeenRef.current = nonce;
    refreshBoardList();
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
    if (action === "refresh" || action === "reload") {
      refreshBoardList();
    }
  }, [controlCommand, createBoardWithName, openCreateBoard, refreshBoardList]);

  const selectBoardPath = useCallback((boardPath) => {
    const cleanPath = String(boardPath || "").trim();
    if (cleanPath) {
      setSelectedBoardPath(cleanPath);
    }
  }, []);

  return (
    <PaneSurface data-workspace-pcb-surface="true">
      <PaneBody>
        {selectedBoard ? (
          <PcbPanel
            board={selectedBoard}
            embedded
            isActive={isActive}
            repoPath={repoPath}
            showHeader={false}
          />
        ) : (
          <EmptyPane>
            <EmptyCard>
              <EmptyTitle>PCB design</EmptyTitle>
              <EmptyHint>Create a board or open an existing design in this panel.</EmptyHint>
              <PaneButton disabled={busy || !repoPath} onClick={openCreateBoard} type="button">
                + New board
              </PaneButton>
              <AppSelect
                isDisabled={!availableBoards.length || busy}
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
              <EmptyTitle>New PCB board</EmptyTitle>
              <CreateInput
                aria-label="PCB board name"
                disabled={busy}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="Board name"
                ref={createInputRef}
                value={draftName}
              />
              {error ? <PaneError role="alert">{error}</PaneError> : null}
              <CreateActions>
                <PaneButton disabled={busy || !repoPath} type="submit">
                  Create board
                </PaneButton>
                <CreateCancelButton
                  disabled={busy}
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
      </PaneBody>
    </PaneSurface>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import {
  closeSpaceLeaf,
  focusSpaceLeaf,
  serializeSpaceLayout,
  setSpaceActiveTab,
} from "./spacesModel.js";
import {
  createSpaceLayoutSaver,
  dragOutLeafInSpace,
  enterSpaceState,
  reconcileSpaceState,
  revealSessionInSpace,
  rosterWithConfirmedSession,
  spaceRailScope,
  SPACE_LAYOUT_CANONICAL_DIVERGENCE,
} from "./spacesController.js";

/* React seam for Spaces: owns the record list, the active space's model
   state, and layout persistence. Every layout mutation flows through ONE
   door (mutateSpace): model op -> reconcile against the roster -> publish ->
   schedule a canonical save. The debounced saver guarantees the LAST state
   lands PER SPACE; exit/switch/unmount/quit flush it. Reconciliation re-runs
   whenever the roster changes, and never schedules a save (render state is
   not layout). */

function storeErrorPresentation(error) {
  const message = String(error?.message || error || "Spaces store error.");
  /* The Rust store reports a stored-bytes divergence in its own words; map
     both spellings onto the one typed code the surface renders. */
  const diverged = message.includes("canonical-byte divergence")
    || message.includes("non-canonical saved layout");
  return {
    code: diverged ? SPACE_LAYOUT_CANONICAL_DIVERGENCE : "SPACE_STORE_ERROR",
    message,
  };
}

/* spaces_list returns per-row typed entries: a "divergent" row is listed with
   its identity (so the rail can show it and entering it reaches the typed
   error card) instead of failing the whole list. Every list row is normalized
   to this lightweight shape — the heavy layout_json is fetched fresh by
   space_get on enter, never carried in the list. */
function normalizeSpaceEntry(entry) {
  const status = entry?.status === "divergent" ? "divergent" : "ready";
  return {
    id: String(entry?.id ?? ""),
    name: String(entry?.name ?? ""),
    ordinal: Number(entry?.ordinal ?? 0),
    status,
    reason: status === "divergent" ? String(entry?.reason || "") : null,
  };
}

export function useSpaces({ enabled = true, roster, sessions = [] }) {
  const [spaces, setSpaces] = useState([]);
  const [spacesListError, setSpacesListError] = useState("");
  const [activeSpaceId, setActiveSpaceId] = useState("");
  const [spaceState, setSpaceState] = useState(null);
  const [spaceError, setSpaceError] = useState(null); // typed { code, message }
  const [saveErrorsBySpace, setSaveErrorsBySpace] = useState({}); // spaceId -> message
  const [deleteError, setDeleteError] = useState(null); // { spaceId, message }
  const [spaceOpError, setSpaceOpError] = useState("");

  const spaceStateRef = useRef(null);
  const activeSpaceIdRef = useRef("");
  const rosterRef = useRef(roster);
  rosterRef.current = roster;
  const enterSeqRef = useRef(0);

  const saverRef = useRef(null);
  if (saverRef.current == null) {
    saverRef.current = createSpaceLayoutSaver({
      save: async ({ spaceId, layoutJson, focusedLeaf }) => {
        const record = await invoke("space_save_layout", {
          space_id: spaceId,
          layout_json: layoutJson,
          focused_leaf: focusedLeaf,
        });
        /* A successful save clears ONLY this space's error and updates ONLY
           this space's row — never another space's pending error. */
        setSaveErrorsBySpace((current) => {
          if (!(spaceId in current)) return current;
          const next = { ...current };
          delete next[spaceId];
          return next;
        });
        if (record?.id) {
          setSpaces((current) => current.map((row) => (
            row.id === record.id ? normalizeSpaceEntry({ ...record, status: "ready" }) : row
          )));
        }
      },
      onError: (error, payload) => {
        const spaceId = payload?.spaceId;
        if (!spaceId) return;
        const message = String(error?.message || error || "Space layout save failed.");
        setSaveErrorsBySpace((current) => ({ ...current, [spaceId]: message }));
      },
    });
  }

  const refreshSpaces = useCallback(async () => {
    try {
      const rows = await invoke("spaces_list");
      setSpaces(Array.isArray(rows) ? rows.map(normalizeSpaceEntry) : []);
      setSpacesListError("");
    } catch (error) {
      /* An unreadable store is reported, never rendered as "no spaces". */
      setSpacesListError(String(error?.message || error || "Unable to list spaces."));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refreshSpaces();
  }, [enabled, refreshSpaces]);

  const publishState = useCallback((state) => {
    spaceStateRef.current = state;
    setSpaceState(state);
  }, []);

  const exitSpace = useCallback(() => {
    const leaving = activeSpaceIdRef.current;
    if (leaving) void saverRef.current.flush(leaving);
    activeSpaceIdRef.current = "";
    enterSeqRef.current += 1;
    setActiveSpaceId("");
    publishState(null);
    setSpaceError(null);
    setSpaceOpError("");
  }, [publishState]);

  const enterSpace = useCallback(async (spaceId) => {
    if (!spaceId) return;
    /* Flush the space we are leaving (if any) so its last bytes land — or stay
       pending with their own error — before we switch. */
    const leaving = activeSpaceIdRef.current;
    if (leaving && leaving !== spaceId) await saverRef.current.flush(leaving);
    const seq = enterSeqRef.current + 1;
    enterSeqRef.current = seq;
    activeSpaceIdRef.current = spaceId;
    setActiveSpaceId(spaceId);
    publishState(null);
    setSpaceError(null);
    setSpaceOpError("");
    let record;
    try {
      record = await invoke("space_get", { space_id: spaceId });
    } catch (error) {
      /* A divergent stored layout fails space_get with the store's own reason;
         it maps to the typed card — never a silent reset. */
      if (enterSeqRef.current === seq) setSpaceError(storeErrorPresentation(error));
      return;
    }
    if (enterSeqRef.current !== seq) return;
    const result = enterSpaceState(record, rosterRef.current);
    if (result.ok) {
      publishState(result.state);
    } else {
      setSpaceError(result.error);
    }
  }, [publishState]);

  /* The one mutation door. Model op errors surface as text — the state the
     user saw stays exactly what it was. */
  const mutateSpace = useCallback((op, rosterOverride = null) => {
    const current = spaceStateRef.current;
    if (!current) return false;
    let next;
    try {
      next = op(current);
    } catch (error) {
      setSpaceOpError(String(error?.message || error));
      return false;
    }
    if (next === current) return true;
    const reconciled = reconcileSpaceState(next, rosterOverride || rosterRef.current);
    publishState(reconciled);
    setSpaceOpError("");
    saverRef.current.schedule({
      spaceId: activeSpaceIdRef.current,
      layoutJson: serializeSpaceLayout(reconciled),
      focusedLeaf: reconciled.focusedLeaf,
    });
    return true;
  }, [publishState]);

  /* Roster changes re-reconcile the open space (a vanished session becomes a
     tombstone, a recovered daemon revives unknowns). Render state is not
     layout, so no save is scheduled. */
  useEffect(() => {
    const current = spaceStateRef.current;
    if (!current || !roster) return;
    publishState(reconcileSpaceState(current, roster));
  }, [publishState, roster]);

  const createSpace = useCallback(async (name) => {
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    try {
      const record = await invoke("space_create", { name: trimmed, ordinal: null });
      await refreshSpaces();
      if (record?.id) await enterSpace(record.id);
    } catch (error) {
      setSpacesListError(String(error?.message || error));
    }
  }, [enterSpace, refreshSpaces]);

  const renameSpace = useCallback(async (spaceId, name) => {
    const trimmed = String(name || "").trim();
    if (!spaceId || !trimmed) return;
    try {
      const record = await invoke("space_rename", { space_id: spaceId, name: trimmed });
      setSpaces((current) => current.map((row) => (
        row.id === record.id ? normalizeSpaceEntry({ ...record, status: "ready" }) : row
      )));
    } catch (error) {
      setSpacesListError(String(error?.message || error));
    }
  }, []);

  /* Deletion is committed BEFORE any local state is dropped. On failure the
     row still exists with its latest layout, so we keep the pending bytes, set
     a typed deletion error that a list refresh does NOT clear, and stay in the
     space if it was active. Only a confirmed delete discards + exits. */
  const deleteSpace = useCallback(async (spaceId) => {
    if (!spaceId) return;
    /* Persist the latest bytes first: a FAILED delete must leave the true
       layout on disk, not a stale one. */
    await saverRef.current.flush(spaceId);
    try {
      await invoke("space_delete", { space_id: spaceId });
    } catch (error) {
      setDeleteError({
        spaceId,
        message: String(error?.message || error || "Unable to delete space."),
      });
      await refreshSpaces();
      return;
    }
    /* Deleted for real: the row no longer exists, so dropping pending bytes is
       correct rather than flushing them into a not-found error. */
    saverRef.current.discard(spaceId);
    setDeleteError((current) => (current?.spaceId === spaceId ? null : current));
    setSaveErrorsBySpace((current) => {
      if (!(spaceId in current)) return current;
      const next = { ...current };
      delete next[spaceId];
      return next;
    });
    /* Decide at RESOLUTION time. The user may have entered another space while
       flush/delete awaited; deleting A must never make a now-active B exit. */
    if (activeSpaceIdRef.current === spaceId) exitSpace();
    await refreshSpaces();
  }, [exitSpace, refreshSpaces]);

  const dismissDeleteError = useCallback(() => setDeleteError(null), []);

  /* Rail click on a member and new-chat-into-space are the same model op:
     reveal-or-open in the focused stack (adding membership when absent). */
  const revealSession = useCallback((sessionRef) => {
    if (!sessionRef) return false;
    return mutateSpace((state) => revealSessionInSpace(state, sessionRef));
  }, [mutateSpace]);

  /* A new session materialization is direct daemon confirmation. Reconcile the
     reveal against that one confirmed fact immediately, before React can
     deliver the parent roster prop, so the fresh leaf never flashes tombstone.
     AppShell mirrors the same fact into sessionsRoster for the next render. */
  const revealConfirmedSession = useCallback((sessionRef) => {
    if (!sessionRef) return false;
    const confirmedRoster = rosterWithConfirmedSession(rosterRef.current, sessionRef);
    rosterRef.current = confirmedRoster;
    return mutateSpace(
      (state) => revealSessionInSpace(state, sessionRef),
      confirmedRoster,
    );
  }, [mutateSpace]);

  const focusLeaf = useCallback((leafId) => {
    mutateSpace((state) => focusSpaceLeaf(state, leafId));
  }, [mutateSpace]);

  const selectTab = useCallback((stackId, leafId) => {
    mutateSpace((state) => setSpaceActiveTab(state, stackId, leafId));
  }, [mutateSpace]);

  const closeLeaf = useCallback((leafId) => {
    mutateSpace((state) => closeSpaceLeaf(state, leafId));
  }, [mutateSpace]);

  const dragOutLeaf = useCallback((leafId, targetLeafId, options) => {
    mutateSpace((state) => dragOutLeafInSpace(state, leafId, targetLeafId, options));
  }, [mutateSpace]);

  /* Quit/hide safety: flush every space's pending bytes. The shell's close
     handler awaits flushSaves() before the window closes; pagehide and a
     hidden visibility transition are the belt-and-braces for a close the
     handler does not mediate. */
  const flushSaves = useCallback(() => saverRef.current.flush(), []);
  useEffect(() => {
    const onHide = () => { void saverRef.current.flush(); };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      /* Unmount still starts a flush; the shell close path is what AWAITS. */
      void saverRef.current.flush();
    };
  }, []);

  const railScope = useMemo(() => {
    if (!activeSpaceId || !spaceState) return null;
    return spaceRailScope(spaceState, sessions);
  }, [activeSpaceId, sessions, spaceState]);

  const activeSpace = useMemo(
    () => spaces.find((row) => row.id === activeSpaceId) || null,
    [activeSpaceId, spaces],
  );

  const saveError = saveErrorsBySpace[activeSpaceId] || "";
  const activeDeleteError = deleteError?.spaceId === activeSpaceId ? deleteError.message : "";

  return {
    activeSpace,
    activeSpaceId,
    closeLeaf,
    createSpace,
    deleteError,
    deleteSpace,
    dismissDeleteError,
    activeDeleteError,
    dragOutLeaf,
    enterSpace,
    exitSpace,
    flushSaves,
    focusLeaf,
    railScope,
    refreshSpaces,
    renameSpace,
    revealConfirmedSession,
    revealSession,
    saveError,
    selectTab,
    spaces,
    spacesListError,
    spaceError,
    spaceOpError,
    spaceState,
  };
}

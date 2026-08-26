import {
  applySpaceReconciliation,
  deserializeSpaceLayout,
  dragOutSpaceLeaf,
  focusedSpaceSessionRef,
  revealOrOpenSpaceSession,
  validateSpaceState,
} from "./spacesModel.js";
import { submitSessionPrompt } from "./sessionSubmit.js";

/* Controller layer between the pure spacesModel and the Tauri seam: roster
   snapshots, reconciliation application, the enter-space pipeline, rail
   scoping, and the last-state-always-lands layout saver. House law applies
   throughout: the daemon roster is the only authority on liveness, absence is
   never fabricated into a value, and a stored layout that diverges from its
   canonical bytes becomes a typed error — never a silent reset. */

export const SPACE_ROSTER_PENDING_REASON =
  "The daemon session roster has not answered yet.";
export const SPACE_LEAF_UNRECONCILED_REASON =
  "No reconciliation result was provided.";
export const SPACE_LEAF_MISSING_ROW_REASON =
  "The live roster no longer lists this session.";
export const SPACE_LAYOUT_CANONICAL_DIVERGENCE = "SPACE_LAYOUT_CANONICAL_DIVERGENCE";
export const SPACE_LAYOUT_INVALID = "SPACE_LAYOUT_INVALID";

function requireTrimmed(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new Error(`${label} must be a non-empty, already-trimmed string.`);
  }
  return value;
}

/* Roster snapshots are constructed, never ad-hoc: "unreachable" must carry
   its reason and "reachable" must carry the actual refs, so an empty roster
   can only ever mean "the daemon answered and listed nothing". */
export function reachableSpacesRoster(sessionRefs) {
  if (!Array.isArray(sessionRefs)) {
    throw new Error("A reachable roster must list its session references.");
  }
  for (const sessionRef of sessionRefs) {
    requireTrimmed(sessionRef, "Roster session reference");
  }
  return { state: "reachable", sessionRefs: [...sessionRefs] };
}

export function unreachableSpacesRoster(reason) {
  requireTrimmed(reason, "Unreachable roster reason");
  return { state: "unreachable", reason };
}

/* A successfully materialized session is a daemon-confirmed live fact even if
   the last full roster read is older or unreachable. Preserve that narrow fact
   without promoting any other local session row to live: reachable snapshots
   gain the id normally; unreachable snapshots stay unreachable and carry only
   the explicitly confirmed ids. A later full roster read replaces this bridge. */
export function rosterWithConfirmedSession(roster, sessionRef) {
  assertRoster(roster);
  requireTrimmed(sessionRef, "Confirmed session reference");
  if (roster.state === "reachable") {
    return reachableSpacesRoster([...new Set([...roster.sessionRefs, sessionRef])]);
  }
  const confirmedSessionRefs = [...new Set([
    ...(roster.confirmedSessionRefs || []),
    sessionRef,
  ])];
  return { ...roster, confirmedSessionRefs };
}

/* The one mapping from a sessions-store read to a roster snapshot. A FAILED
   read can only ever become unreachable-with-reason: turning it into
   reachable-and-empty would fabricate a tombstone for every open leaf. */
export function rosterFromSessionsRead(read) {
  if (read?.ok === true) {
    const rows = Array.isArray(read.rows) ? read.rows : [];
    return reachableSpacesRoster(rows
      .map((row) => row?.id)
      .filter((id) => typeof id === "string" && id.length > 0 && id.trim() === id));
  }
  const reason = String(read?.error?.message || read?.error || "").trim();
  return unreachableSpacesRoster(reason || "The daemon session roster is unavailable.");
}

function assertRoster(roster) {
  if (roster?.state === "reachable" && Array.isArray(roster.sessionRefs)) return roster;
  if (roster?.state === "unreachable"
    && typeof roster.reason === "string"
    && roster.reason.trim() === roster.reason
    && roster.reason.length > 0) {
    const confirmed = roster.confirmedSessionRefs ?? [];
    if (Array.isArray(confirmed)) {
      for (const sessionRef of confirmed) {
        requireTrimmed(sessionRef, "Confirmed session reference");
      }
      return roster;
    }
  }
  throw new Error("A spaces roster snapshot must be reachable-with-refs or unreachable-with-reason.");
}

function collectLeaves(node, leaves) {
  if (!node) return;
  if (node.kind === "leaf") {
    leaves.push(node);
    return;
  }
  const children = node.kind === "stack" ? node.tabs : node.children;
  for (const child of children) collectLeaves(child, leaves);
}

/* Mirrors src-tauri/src/spaces.rs reconcile_space for full roster snapshots:
   reachable + present is live, reachable + absent is a tombstone (vanished,
   never dropped), and unreachable renders unknown WITH the roster's reason.
   The sole additional live path is an explicit daemon-confirmed materialized
   id carried by rosterWithConfirmedSession. Every leaf still gets a verdict. */
export function reconcileSpaceLeaves(state, roster) {
  validateSpaceState(state);
  assertRoster(roster);
  const liveRefs = roster.state === "reachable" ? new Set(roster.sessionRefs) : null;
  const confirmedLiveRefs = new Set(roster.confirmedSessionRefs || []);
  const leaves = [];
  collectLeaves(state.root, leaves);
  return leaves.map((leaf) => {
    if (liveRefs) {
      return liveRefs.has(leaf.sessionRef)
        ? { leaf_id: leaf.id, session_ref: leaf.sessionRef, state: "live" }
        : { leaf_id: leaf.id, session_ref: leaf.sessionRef, state: "tombstone" };
    }
    if (confirmedLiveRefs.has(leaf.sessionRef)) {
      return { leaf_id: leaf.id, session_ref: leaf.sessionRef, state: "live" };
    }
    return {
      leaf_id: leaf.id,
      session_ref: leaf.sessionRef,
      state: "unknown",
      reason: roster.reason,
    };
  });
}

export function reconcileSpaceState(state, roster) {
  return applySpaceReconciliation(state, reconcileSpaceLeaves(state, roster));
}

/* Enter pipeline: stored record -> model state -> reconciled render state.
   A canonical-byte divergence (or any invalid stored layout) is a typed,
   space-scoped error the surface renders as such. It never becomes an empty
   space: auto-normalizing would silently rewrite what the store holds. */
export function enterSpaceState(record, roster) {
  let state;
  try {
    state = deserializeSpaceLayout(
      String(record?.layout_json ?? ""),
      record?.focused_leaf ?? null,
    );
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error?.code === SPACE_LAYOUT_CANONICAL_DIVERGENCE
          ? SPACE_LAYOUT_CANONICAL_DIVERGENCE
          : SPACE_LAYOUT_INVALID,
        message: String(error?.message || error),
      },
    };
  }
  return { ok: true, state: reconcileSpaceState(state, roster) };
}

/* What a leaf may render as. "live" requires BOTH the reconciliation verdict
   and an actual roster row to mount; every other combination renders as its
   honest non-live state. A leaf with no renderState was never reconciled and
   must not pass for live. */
export function spaceLeafPresentation(leaf, sessionsById) {
  const renderState = leaf?.renderState;
  if (!renderState || typeof renderState.state !== "string") {
    return { mode: "unknown", reason: SPACE_LEAF_UNRECONCILED_REASON };
  }
  if (renderState.state === "tombstone") {
    return { mode: "tombstone" };
  }
  if (renderState.state === "unknown") {
    return { mode: "unknown", reason: renderState.reason };
  }
  if (renderState.state !== "live") {
    return { mode: "unknown", reason: `Unsupported render state '${renderState.state}'.` };
  }
  const session = sessionsById?.get?.(leaf.sessionRef) ?? null;
  if (!session) {
    return { mode: "unknown", reason: SPACE_LEAF_MISSING_ROW_REASON };
  }
  return { mode: "live", session };
}

export function sessionsByIdMap(sessions = []) {
  const map = new Map();
  for (const session of sessions) {
    if (session?.id) map.set(session.id, session);
  }
  return map;
}

/* SpaceSurface's composer adapter is kept in this importable JS boundary so
   its no-attachment behavior can be exercised without mounting JSX. The
   shared submit seam requires an array because it reads attachments.length. */
export function createSpaceSessionSubmitFor(invokeCommand) {
  if (typeof invokeCommand !== "function") {
    throw new Error("A space session submitter requires an invoke function.");
  }
  return (session) => async (prompt, attachments = []) => submitSessionPrompt(invokeCommand, {
    sessionId: requireTrimmed(session?.id, "Session id"),
    prompt,
    attachments: attachments || [],
  });
}

/* Rail scoping while a space is active: the list is the space's members (in
   the rail's own ordering domain), and the highlight DERIVES from the model's
   focused leaf — there is no parallel selection input to disagree with it. */
export function spaceRailScope(state, sessions = []) {
  validateSpaceState(state);
  const members = new Set(state.members);
  const memberSessions = sessions.filter((session) => members.has(session?.id));
  const presentIds = new Set(memberSessions.map((session) => session.id));
  return {
    memberSessions,
    missingMemberRefs: state.members.filter((memberRef) => !presentIds.has(memberRef)),
    highlightedSessionRef: focusedSpaceSessionRef(state),
  };
}

/* The rail's row authority while a space MAY be active. Two states must never
   be conflated: spaceMode (a space is active) and spaceScoped (its member scope
   has resolved). In spaceMode the ordinary activeSessionId is NEVER the
   highlight and clicks NEVER route to the ordinary handler — even before the
   scope resolves. Falling back to activeSessionId there leaks a stale ordinary
   session as "active" behind an opening or errored space. */
export function spaceRailRowAuthority({
  activeSpaceId,
  spaceScope,
  activeSessionId,
  sessionId,
}) {
  const spaceMode = Boolean(activeSpaceId);
  const spaceScoped = Boolean(activeSpaceId && spaceScope);
  const highlightRef = spaceScoped ? (spaceScope.highlightedSessionRef || "") : "";
  const effectiveActiveId = spaceMode ? highlightRef : (activeSessionId || "");
  return {
    spaceMode,
    spaceScoped,
    routeToSpace: spaceMode,
    effectiveActiveId,
    isActive: effectiveActiveId !== "" && sessionId === effectiveActiveId,
  };
}

let spaceNodeIdCounter = 0;
export function spaceNodeId(prefix) {
  requireTrimmed(prefix, "Node id prefix");
  spaceNodeIdCounter += 1;
  const unique = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${unique}-${spaceNodeIdCounter.toString(36)}`;
}

/* Model-op wrappers that own node-id minting so the UI cannot invent ids. */
export function revealSessionInSpace(state, sessionRef, options = {}, idGen = spaceNodeId) {
  return revealOrOpenSpaceSession(state, sessionRef, {
    viewKind: options.viewKind ?? "chat",
    viewState: options.viewState ?? {},
    leafId: idGen("leaf"),
    initialStackId: idGen("stack"),
    stackId: options.stackId ?? null,
  });
}

export function dragOutLeafInSpace(state, leafId, targetLeafId, options = {}, idGen = spaceNodeId) {
  return dragOutSpaceLeaf(state, leafId, targetLeafId, {
    splitId: idGen("split"),
    stackId: idGen("stack"),
    direction: options.direction ?? "horizontal",
    position: options.position ?? "after",
  });
}

/* Debounced layout persistence with one guarantee: for EACH space the LAST
   scheduled state always lands (or its failure is reported and kept pending).
   Pending state and failures are keyed PER SPACE: switching from space A to B
   can never let B's write supersede A's unsaved bytes, and B's successful save
   can never clear A's error. States within one space may be skipped, but never
   superseded-by-older or silently dropped. A failed save keeps that space's
   newest payload pending for the next schedule() or flush() to retry. */
export function createSpaceLayoutSaver({
  save,
  onError = () => {},
  debounceMs = 600,
  setTimeoutFn = (...args) => globalThis.setTimeout(...args),
  clearTimeoutFn = (...args) => globalThis.clearTimeout(...args),
} = {}) {
  if (typeof save !== "function") {
    throw new Error("A layout saver requires a save function.");
  }
  /* spaceId -> { pending, timer, inFlight, generation, inFlightGeneration }.
     discard() advances the generation so a save already in flight cannot
     restore work that belongs to the discarded generation. One slot per
     space; a slot with no pending, timer, or in-flight work is pruned. */
  const slots = new Map();

  const slotFor = (spaceId) => {
    let slot = slots.get(spaceId);
    if (!slot) {
      slot = {
        pending: null,
        timer: null,
        inFlight: null,
        generation: 0,
        inFlightGeneration: null,
      };
      slots.set(spaceId, slot);
    }
    return slot;
  };

  const pruneIfEmpty = (spaceId) => {
    const slot = slots.get(spaceId);
    if (slot && slot.pending == null && slot.timer == null && slot.inFlight == null) {
      slots.delete(spaceId);
    }
  };

  const deliver = (spaceId) => {
    const slot = slots.get(spaceId);
    if (!slot) return Promise.resolve();
    if (slot.inFlight) return slot.inFlight;
    if (!slot.pending) return Promise.resolve();
    slot.inFlight = (async () => {
      while (slot.pending) {
        const payload = slot.pending;
        const generation = slot.generation;
        slot.pending = null;
        slot.inFlightGeneration = generation;
        try {
          await save(payload);
        } catch (error) {
          /* Keep this space's newest truth pending: the payload that failed
             unless a newer one for the SAME space arrived mid-flight. No
             auto-retry loop — the next schedule() or flush() retries. A
             discarded generation is no longer this space's truth and must
             neither restore pending work nor report a stale save error. */
          if (slot.generation === generation) {
            slot.pending = slot.pending ?? payload;
            onError(error, payload);
            break;
          }
        }
      }
    })().finally(() => {
      slot.inFlight = null;
      slot.inFlightGeneration = null;
      pruneIfEmpty(spaceId);
    });
    return slot.inFlight;
  };

  const idsFor = (spaceId) => (spaceId != null ? [spaceId] : [...slots.keys()]);

  return {
    schedule(payload) {
      if (!payload || typeof payload.spaceId !== "string" || !payload.spaceId) {
        throw new Error("A layout save payload must name its space.");
      }
      const slot = slotFor(payload.spaceId);
      slot.pending = payload;
      if (slot.timer != null) clearTimeoutFn(slot.timer);
      slot.timer = setTimeoutFn(() => {
        slot.timer = null;
        void deliver(payload.spaceId);
      }, debounceMs);
    },
    /* flush(spaceId) drains one space; flush() drains every space. Each space's
       in-flight save is awaited so a caller switching away from A knows A's
       bytes have landed (or failed and stayed pending) before B proceeds. */
    async flush(spaceId) {
      const ids = idsFor(spaceId);
      for (const id of ids) {
        const slot = slots.get(id);
        if (slot?.timer != null) {
          clearTimeoutFn(slot.timer);
          slot.timer = null;
        }
      }
      for (const id of ids) {
        const slot = slots.get(id);
        if (slot?.inFlight) await slot.inFlight;
        await deliver(id);
        const after = slots.get(id);
        if (after?.inFlight) await after.inFlight;
      }
    },
    /* Drop a space's pending work without saving it — ONLY for a space that
       was just deleted, where the layout row no longer exists to land on. */
    discard(spaceId) {
      for (const id of idsFor(spaceId)) {
        const slot = slots.get(id);
        if (!slot) continue;
        slot.generation += 1;
        slot.pending = null;
        if (slot.timer != null) {
          clearTimeoutFn(slot.timer);
          slot.timer = null;
        }
        pruneIfEmpty(id);
      }
    },
    hasPending(spaceId) {
      for (const id of idsFor(spaceId)) {
        const slot = slots.get(id);
        if (slot && (slot.pending != null
          || (slot.inFlight != null && slot.inFlightGeneration === slot.generation))) {
          return true;
        }
      }
      return false;
    },
  };
}

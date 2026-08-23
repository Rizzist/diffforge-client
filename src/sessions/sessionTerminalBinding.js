export function initialSessionBindingState() {
  return {
    authority: "unknown",
    known: false,
    sessionId: null,
    workerGeneration: null,
    observation: 0,
    observedSurface: null,
    legacyAnnouncement: null,
    pendingLegacy: null,
  };
}

function normalizedAnnouncement(announcement) {
  if (!announcement || typeof announcement !== "object") return null;
  return {
    ...announcement,
    providerSessionId: String(announcement.providerSessionId || "").trim() || null,
  };
}

function normalizedSurface(surface) {
  if (!surface?.paneId || !surface?.hostSessionId) return null;
  return {
    paneId: String(surface.paneId),
    hostSessionId: String(surface.hostSessionId),
  };
}

export function applyResidentBindingSnapshot(state, snapshot, surface = null) {
  if (typeof snapshot?.supported !== "boolean") return state;
  if (snapshot.supported) {
    const known = snapshot.known === true;
    return {
      authority: "protocol",
      known,
      sessionId: known ? String(snapshot.session_id || "").trim() || null : null,
      workerGeneration: known && Number.isFinite(Number(snapshot.worker_generation))
        ? Number(snapshot.worker_generation)
        : null,
      observation: known ? state.observation + 1 : state.observation,
      observedSurface: known ? normalizedSurface(surface) : null,
      legacyAnnouncement: null,
      pendingLegacy: null,
    };
  }

  /* Reconnects to a legacy daemon can repeat the same capability snapshot.
     That is not a new binding observation and must not erase the OSC state
     already learned from this terminal. */
  if (state.authority === "osc") return state;

  const pending = state.pendingLegacy;
  if (pending) {
    return {
      authority: "osc",
      known: true,
      sessionId: pending.providerSessionId,
      workerGeneration: null,
      observation: state.observation,
      observedSurface: null,
      legacyAnnouncement: pending,
      pendingLegacy: null,
    };
  }
  return {
    authority: "osc",
    known: false,
    sessionId: null,
    workerGeneration: null,
    observation: state.observation,
    observedSurface: null,
    legacyAnnouncement: null,
    pendingLegacy: null,
  };
}

export function applyLegacySessionBinding(state, announcement) {
  if (state.authority === "protocol") return state;
  const normalized = normalizedAnnouncement(announcement);
  if (!normalized) return state;
  if (state.authority === "unknown") {
    return {
      ...state,
      pendingLegacy: normalized,
    };
  }
  return {
    ...state,
    known: true,
    sessionId: normalized.providerSessionId,
    workerGeneration: null,
    legacyAnnouncement: normalized,
    pendingLegacy: null,
  };
}

/* Only a PER-PANE fact may produce a pane-addressed announcement.

   OSC 7791 qualifies by construction: it arrives inside one pane's own PTY
   stream, so it cannot describe any other pane. The daemon's
   resident_session_binding does not: the registry keeps N publishers keyed by
   connection and collapses them to a single most-recent winner, dropping the
   owner before the frame is sent. It says "something in this profile is bound
   to X" and names nothing else.

   This used to pair the protocol fact with whichever surface happened to be
   mounted when it arrived, which reads as careful — the surface is real, the
   timing is fenced — but it manufactures an identity the fact never carried.
   With one shell open it is right by coincidence. With two, an in-TUI hop in
   one rehomed the other and nothing errored. */
export function sessionBindingAnnouncement(state) {
  if (!state.known) return null;
  if (state.authority === "osc") return state.legacyAnnouncement;
  return null;
}

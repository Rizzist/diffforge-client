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

export function sessionBindingAnnouncement(state) {
  if (!state.known) return null;
  if (state.authority === "osc") return state.legacyAnnouncement;
  const source = state.observedSurface;
  if (!source?.paneId || !source?.hostSessionId) return null;
  return {
    ...source,
    providerSessionId: state.sessionId,
  };
}

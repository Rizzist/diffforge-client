/* Testable form of the legacy omission fallback. */
export function projectionCaughtUp(result) {
  return typeof result?.caught_up === "boolean" ? result.caught_up : null;
}

/* Every callback boundary carries the same three values. Keeping this
   normalization shared prevents null (unobserved) from becoming false
   (observed caught up) while it crosses component-owned state. */
export function sessionSyncTransportState(syncing) {
  return typeof syncing === "boolean" ? syncing : null;
}

export function transcriptSyncReport(loadState, caughtUp) {
  if (loadState === "loading") return true;
  return typeof caughtUp === "boolean" ? !caughtUp : null;
}

export function sessionSyncUnmountReport() {
  return null;
}

/* SessionSurface owns the claim it publishes to AppShell, so its lifecycle
   must own retracting that claim too. Keeping the reporter free of React makes
   the report -> unmount transition executable under this repo's node:test
   setup while the component uses the exact same contract. */
export function createSessionSyncLifecycleReporter(onSyncingChange) {
  const notify = typeof onSyncingChange === "function" ? onSyncingChange : () => {};
  return Object.freeze({
    report(syncing) {
      notify(sessionSyncTransportState(syncing));
    },
    unmount() {
      notify(sessionSyncUnmountReport());
    },
  });
}

export function activeSessionSyncReport(draftOpen, activeSessionId, reports) {
  if (draftOpen || !activeSessionId) return null;
  return sessionSyncTransportState(reports?.[activeSessionId]);
}

/* The rail's session-history pill. Three states, because the projection has
   three — and a pill reading "Synced" when no projection head has been
   observed is a claim the client cannot support. */
export function railSyncPillState(syncing) {
  if (syncing === true) {
    return {
      state: "syncing",
      label: "Syncing",
      ariaLabel: "Syncing session history — open sync activity",
      title: "Syncing this session's history — click for the sync inbox/outbox",
    };
  }
  if (syncing === false) {
    return {
      state: "synced",
      label: "Synced",
      ariaLabel: "Session history synced — open sync activity",
      title: "Synced — click for the sync inbox/outbox",
    };
  }
  return {
    state: "unknown",
    label: "Sync unknown",
    ariaLabel: "Session history sync state not observed — open sync activity",
    title: "No session history has been observed yet — click for the sync inbox/outbox",
  };
}

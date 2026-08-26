export const SESSION_WINDOW_HASH = "#/session-window";
export const SESSION_WINDOW_CLOSED_EVENT = "forge-session-window-closed";
export const SESSION_WINDOW_CONTROL_EVENT = "forge-session-window-control";
export const SESSION_WINDOW_REFRESH_EVENT = "forge-session-window-refresh";
export const SESSION_WINDOW_CONTROL_FOCUS_MAIN = "focus-main";
export const SESSION_WINDOW_CONTROL_RETURN = "return";
export const SESSION_WINDOW_THEME_STORAGE_PREFIX = "diffforge.session.breakout.theme.";

function text(value) {
  return String(value ?? "").trim();
}

/* Return routing is ordered: the exact originating space must win entry
   supersession before its exact leaf is focused. A failed/stale entry never
   leaks a focus mutation into whichever space is currently displayed. */
export async function returnSessionWindowToSpaceLeaf({
  enterSpace,
  focusLeaf,
  leafId: leafIdValue,
  spaceId: spaceIdValue,
} = {}) {
  const spaceId = text(spaceIdValue);
  const leafId = text(leafIdValue);
  if (!spaceId || typeof enterSpace !== "function") return false;
  const entered = await enterSpace(spaceId);
  if (entered !== true) return false;
  if (leafId && typeof focusLeaf === "function") focusLeaf(leafId);
  return true;
}

function incarnation(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/* React may defer a state updater until after Destroyed invalidates the open
   continuation that scheduled it. Keep the guard check and mutation in the
   same updater-local seam so stale work returns the identical current object
   without even invoking the tracking mutation. */
export function trackSessionWindowStateIfCurrent({
  current,
  isCurrent,
  track,
} = {}) {
  if ((typeof isCurrent === "function" && !isCurrent()) || typeof track !== "function") {
    return current;
  }
  return track(current);
}

/* Window labels are stable across native recreations, so a label alone cannot
   distinguish a delayed Destroyed notification from the currently-open
   incarnation. This synchronous registry is deliberately independent of
   React state: opening and close reconciliation can invalidate continuations
   before a queued state updater gets a chance to run. */
export function createSessionWindowIncarnationGuard() {
  const currentByLabel = new Map();
  return Object.freeze({
    begin(labelValue) {
      const label = text(labelValue);
      if (!label) return null;
      const next = (currentByLabel.get(label) || 0) + 1;
      currentByLabel.set(label, next);
      return next;
    },
    current(labelValue) {
      const label = text(labelValue);
      return label ? currentByLabel.get(label) || 0 : null;
    },
    invalidate(labelValue, expectedIncarnation) {
      const label = text(labelValue);
      const expected = incarnation(expectedIncarnation);
      if (!label || expected == null || (currentByLabel.get(label) || 0) !== expected) {
        return false;
      }
      currentByLabel.set(label, expected + 1);
      return true;
    },
    isCurrent(labelValue, expectedIncarnation) {
      const label = text(labelValue);
      const expected = incarnation(expectedIncarnation);
      return Boolean(label)
        && expected != null
        && (currentByLabel.get(label) || 0) === expected;
    },
  });
}

/* Claim the next incarnation before the asynchronous native-existence check.
   `track` must still check guard.isCurrent inside any deferred state updater;
   the callback receives the claimed token so production and tests share that
   exact race boundary. */
export async function trackSessionWindowAfterNativeCheck({
  guard,
  label: labelValue,
  nativeExists,
  remove,
  track,
} = {}) {
  const label = text(labelValue);
  if (!label || typeof guard?.begin !== "function" || typeof nativeExists !== "function") {
    return null;
  }
  const claimedIncarnation = guard.begin(label);
  let exists;
  try {
    exists = await nativeExists(label);
  } catch {
    exists = null;
  }
  if (exists !== true) {
    const invalidated = guard.invalidate(label, claimedIncarnation);
    /* A literal false is positive native absence, unlike an invocation error.
       Whichever of the open check or Destroyed check wins invalidation owns
       cleanup of tracking left by the previous incarnation. */
    if (exists === false && invalidated && typeof remove === "function") {
      remove(claimedIncarnation);
    }
    return null;
  }
  if (!guard.isCurrent(label, claimedIncarnation)) return null;
  if (typeof track === "function") track(claimedIncarnation);
  return claimedIncarnation;
}

/* Browser beforeunload/cleanup reports are advisory because the native window
   can remain alive. A close removes bookkeeping only when the native command
   positively reports absence, and only for the incarnation snapshotted before
   that await. Errors remain unknown and therefore retain tracking. */
export async function removeSessionWindowAfterNativeCheck({
  guard,
  label: labelValue,
  nativeExists,
  remove,
} = {}) {
  const label = text(labelValue);
  if (!label || typeof guard?.current !== "function" || typeof nativeExists !== "function") {
    return false;
  }
  const expectedIncarnation = guard.current(label);
  let exists;
  try {
    exists = await nativeExists(label);
  } catch {
    return false;
  }
  if (exists !== false || !guard.invalidate(label, expectedIncarnation)) return false;
  if (typeof remove === "function") remove(expectedIncarnation);
  return true;
}

export function normalizedSessionWindowTheme(value) {
  return text(value).toLowerCase() === "light" ? "light" : "dark";
}

export function trackSessionWindowBreakout(current, result, session) {
  const label = text(result?.label);
  const sessionId = text(session?.id || session?.sessionId || session);
  if (!label || !sessionId) return current;
  const trackedIncarnation = incarnation(result?.incarnation);
  return {
    ...current,
    [label]: {
      label,
      sessionId,
      title: text(session?.title) || sessionId,
      ...(trackedIncarnation == null ? {} : { incarnation: trackedIncarnation }),
    },
  };
}

export function trackSpaceWindowBreakout(current, result, target = {}) {
  const label = text(result?.label);
  const spaceId = text(target.spaceId || target.space_id);
  const leafId = text(target.leafId || target.leaf_id);
  const sessionId = text(target.sessionId || target.session_id);
  if (!label || !spaceId || !leafId || !sessionId) return current;
  const trackedIncarnation = incarnation(result?.incarnation);
  return {
    ...current,
    [label]: {
      label,
      leafId,
      sessionId,
      spaceId,
      title: text(target.title) || sessionId,
      ...(trackedIncarnation == null ? {} : { incarnation: trackedIncarnation }),
    },
  };
}

function breakoutIncarnationMatches(breakout, payload) {
  const expected = incarnation(payload?.incarnation);
  return expected == null || incarnation(breakout?.incarnation) === expected;
}

/* Cleanup is idempotent and accepts either coordinate published by Rust. When
   the native gate supplies an incarnation, a delayed older close cannot
   remove a newly tracked window that reused the stable label. */
export function removeSessionWindowBreakout(current, payload = {}) {
  const windowId = text(payload.window_id || payload.windowId || payload.label);
  const sessionId = text(payload.session_id || payload.sessionId);
  const spaceId = text(payload.space_id || payload.spaceId);
  const leafId = text(payload.leaf_id || payload.leafId);
  let changed = false;
  const next = { ...current };
  Object.entries(next).forEach(([key, breakout]) => {
    const matchesIdentity = (windowId && breakout?.label === windowId)
      || (!spaceId && !leafId && sessionId && breakout?.sessionId === sessionId);
    if (matchesIdentity && breakoutIncarnationMatches(breakout, payload)) {
      delete next[key];
      changed = true;
    }
  });
  return changed ? next : current;
}

export function removeSpaceWindowBreakout(current, payload = {}) {
  const windowId = text(payload.window_id || payload.windowId || payload.label);
  const spaceId = text(payload.space_id || payload.spaceId);
  const leafId = text(payload.leaf_id || payload.leafId);
  let changed = false;
  const next = { ...current };
  Object.entries(next).forEach(([key, breakout]) => {
    const matchesIdentity = (windowId && breakout?.label === windowId)
      || (spaceId && leafId
        && breakout?.spaceId === spaceId
        && breakout?.leafId === leafId);
    if (matchesIdentity && breakoutIncarnationMatches(breakout, payload)) {
      delete next[key];
      changed = true;
    }
  });
  return changed ? next : current;
}

/* Standalone windows do not infer liveness from the session id in their URL
   or from an older local row. Only a successful sessions_list roster can
   produce live/tombstone; pending and failed reads stay explicitly unknown. */
export function sessionWindowRosterPresentation({
  sessionId,
  rosterState,
  sessions = [],
  reason = "",
} = {}) {
  const target = text(sessionId);
  if (rosterState !== "reachable") {
    return {
      mode: "unknown",
      reason: text(reason) || (rosterState === "pending"
        ? "The daemon session roster has not answered yet."
        : "The daemon session roster is unavailable."),
    };
  }
  const session = sessions.find((row) => text(row?.id) === target) || null;
  return session ? { mode: "live", session } : { mode: "tombstone" };
}

/* Main forwards roster reads to every breakout, while the spaces controller
   publishes a refresh only after canonical layout bytes land. A leaf accepts
   layout refreshes for its exact authoritative space; ordinary windows do not. */
export function sessionWindowShouldRefresh(params = {}, payload = {}) {
  const scope = text(payload.scope);
  if (scope === "sessions") return true;
  return scope === "space"
    && Boolean(text(params.spaceId))
    && text(params.spaceId) === text(payload.space_id || payload.spaceId);
}

export const SESSION_WINDOW_HASH = "#/session-window";
export const SESSION_WINDOW_CLOSED_EVENT = "forge-session-window-closed";
export const SESSION_WINDOW_CONTROL_EVENT = "forge-session-window-control";
export const SESSION_WINDOW_REFRESH_EVENT = "forge-session-window-refresh";
export const SESSION_WINDOW_CONTROL_FOCUS_MAIN = "focus-main";
export const SESSION_WINDOW_CONTROL_RETURN = "return";
export const SESSION_WINDOW_THEME_STORAGE_PREFIX = "diffforge.session.breakout.theme.";

const BREAKOUT_KIND_SESSION = "session";
const BREAKOUT_KIND_SPACE_LEAF = "space_leaf";
const BREAKOUT_ID_DIGEST_CHARS = 24;

function text(value) {
  return String(value ?? "").trim();
}

function breakoutIdentity(value = {}) {
  const profileId = text(value.profileId || value.profile_id);
  const kind = text(value.kind);
  const sessionRef = text(value.sessionRef || value.session_ref);
  const spaceId = text(value.spaceId || value.space_id);
  const leafId = text(value.leafId || value.leaf_id);
  if (!profileId) return null;
  if (kind === BREAKOUT_KIND_SESSION && sessionRef && !spaceId && !leafId) {
    return { kind, profileId, sessionRef, spaceId: "", leafId: "" };
  }
  if (kind === BREAKOUT_KIND_SPACE_LEAF && !sessionRef && spaceId && leafId) {
    return { kind, profileId, sessionRef: "", spaceId, leafId };
  }
  return null;
}

function breakoutIdentityFromPayload(profileId, payload = {}) {
  const spaceId = text(payload.space_id || payload.spaceId);
  const leafId = text(payload.leaf_id || payload.leafId);
  if (spaceId && leafId) {
    return breakoutIdentity({
      kind: BREAKOUT_KIND_SPACE_LEAF,
      leafId,
      profileId,
      spaceId,
    });
  }
  return breakoutIdentity({
    kind: BREAKOUT_KIND_SESSION,
    profileId,
    sessionRef: payload.session_ref || payload.sessionRef
      || payload.session_id || payload.sessionId,
  });
}

function breakoutIdentityFingerprint(identity) {
  /* S3 hashes the stable logical coordinates for its native label. Durable
     identity hashes the same logical inputs in an unambiguous tuple, extended
     with the profile because breakout_window.id is globally unique rather
     than profile-composite. */
  return JSON.stringify(identity.kind === BREAKOUT_KIND_SESSION
    ? [identity.profileId, identity.kind, identity.sessionRef]
    : [identity.profileId, identity.kind, identity.spaceId, identity.leafId]);
}

async function sha256Hex(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof TextEncoder !== "function") {
    throw new Error("Breakout identity hashing is unavailable.");
  }
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Stable durable identity. Native labels and incarnation ids are never inputs. */
export async function breakoutWindowPersistenceId(value, hash = sha256Hex) {
  const identity = breakoutIdentity(value);
  if (!identity || typeof hash !== "function") return "";
  const digest = text(await hash(breakoutIdentityFingerprint(identity))).toLowerCase();
  if (!/^[a-f0-9]{24,}$/.test(digest)) {
    throw new Error("Breakout identity hash must be lowercase hexadecimal.");
  }
  const scope = identity.kind === BREAKOUT_KIND_SESSION ? "session" : "space-leaf";
  return `breakout-intent-${scope}-${digest.slice(0, BREAKOUT_ID_DIGEST_CHARS)}`;
}

function breakoutViewStateJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const selected = {};
  for (const key of ["activeSubTab", "viewMode"]) {
    if (!Object.hasOwn(value, key)) continue;
    const field = value[key];
    if (field !== null && typeof field !== "string") {
      throw new Error(`Breakout view state ${key} must be a string or null.`);
    }
    selected[key] = field;
  }
  return Object.keys(selected).length ? JSON.stringify(selected) : null;
}

function breakoutUpsertPayload(identity, id, viewStateJson) {
  return {
    profile_id: identity.profileId,
    id,
    kind: identity.kind,
    session_ref: identity.kind === BREAKOUT_KIND_SESSION ? identity.sessionRef : null,
    space_id: identity.kind === BREAKOUT_KIND_SPACE_LEAF ? identity.spaceId : null,
    leaf_id: identity.kind === BREAKOUT_KIND_SPACE_LEAF ? identity.leafId : null,
    /* Geometry capture is intentionally absent until all supported child
       platforms expose one complete, throttled move/resize snapshot. */
    geometry_json: null,
    view_state_json: viewStateJson,
  };
}

/**
 * Durable breakout intent is a restore-gated command stream, separate from
 * S3's native-existence map. Calls made before arm() are dropped, not queued;
 * Step 6 owns arming only after breakout_list restoration has completed.
 */
export function createBreakoutWindowPersistence({
  deriveId = breakoutWindowPersistenceId,
  onError = () => {},
  register = async () => {},
  remove,
  upsert,
} = {}) {
  if (typeof deriveId !== "function" || typeof upsert !== "function" || typeof remove !== "function") {
    throw new Error("Breakout persistence requires deriveId, upsert, and remove functions.");
  }
  if (typeof onError !== "function") {
    throw new Error("Breakout persistence onError must be a function.");
  }
  if (typeof register !== "function") {
    throw new Error("Breakout persistence register must be a function.");
  }

  let armedProfileId = null;
  let generation = 0;
  let tail = Promise.resolve();
  const descriptorByWindowId = new Map();

  const enqueue = (operation) => {
    const result = tail.then(operation);
    const guarded = result.catch((error) => {
      onError(error);
      return false;
    });
    tail = guarded.then(() => undefined);
    return guarded;
  };

  const remember = (identity, windowIdValue, viewState) => {
    const windowId = text(windowIdValue);
    const viewStateJson = breakoutViewStateJson(viewState);
    let payloadPromise = null;
    const descriptor = {
      authorized: armedProfileId === identity.profileId,
      identity,
      payload() {
        if (!payloadPromise) {
          payloadPromise = Promise.resolve()
            .then(() => deriveId(identity))
            .then((id) => {
              const durableId = text(id);
              if (!durableId) throw new Error("Breakout persistence derived no durable id.");
              return breakoutUpsertPayload(identity, durableId, viewStateJson);
            });
        }
        return payloadPromise;
      },
    };
    if (windowId) descriptorByWindowId.set(windowId, descriptor);
    return descriptor;
  };

  const persistOpen = (value) => {
    const identity = breakoutIdentity(value);
    if (!identity) return Promise.resolve(false);
    let descriptor;
    try {
      descriptor = remember(identity, value.windowId || value.window_id, value.viewState);
    } catch (error) {
      onError(error);
      return Promise.resolve(false);
    }
    /* Snapshot the gate synchronously. An open started before restoration
       must stay dropped even if its hash resolves after arm(). */
    const intentGeneration = generation;
    if (armedProfileId !== identity.profileId) return Promise.resolve(false);
    return enqueue(async () => {
      if (generation !== intentGeneration || armedProfileId !== identity.profileId) return false;
      const payload = await descriptor.payload();
      /* Publish durable intent before making its native label closeable by the
         backend authority. Once registration exists, any child
         CloseRequested either removes this row or is refused because the
         backend has committed to exit; no later upsert can resurrect it. */
      await upsert(payload);
      const windowId = text(value.windowId || value.window_id);
      if (windowId) {
        await register({
          id: payload.id,
          profile_id: identity.profileId,
          window_id: windowId,
        });
      }
      return true;
    });
  };

  const persistExplicitClose = (value = {}) => {
    const windowId = text(value.windowId || value.window_id
      || value.payload?.window_id || value.payload?.windowId || value.payload?.label);
    const remembered = windowId ? descriptorByWindowId.get(windowId) : null;
    const fallbackIdentity = remembered
      ? null
      : breakoutIdentityFromPayload(value.profileId || value.profile_id, value.payload || value);
    const descriptor = remembered || (fallbackIdentity
      ? remember(fallbackIdentity, "", null)
      : null);
    if (!descriptor) return Promise.resolve(false);
    const forgetWindow = value.forgetWindow === true;

    /* A mapped child keeps the profile that owned its open. This remains
       correct if another profile becomes active before Destroyed arrives. */
    const profileId = descriptor.identity.profileId;
    const mappedProfileWasRestored = remembered && descriptor.authorized;
    const fallbackIsCurrentlyArmed = !remembered && armedProfileId === profileId;
    if (!mappedProfileWasRestored && !fallbackIsCurrentlyArmed) return Promise.resolve(false);
    return enqueue(async () => {
      const payload = await descriptor.payload();
      await remove({ profile_id: profileId, id: payload.id });
      if (forgetWindow && windowId && descriptorByWindowId.get(windowId) === descriptor) {
        descriptorByWindowId.delete(windowId);
      }
      return true;
    });
  };

  return Object.freeze({
    arm(value = {}) {
      const profileId = text(value.profileId || value.profile_id || value);
      if (!profileId) throw new Error("Arming breakout persistence requires a profile id.");
      generation += 1;
      armedProfileId = profileId;
      descriptorByWindowId.forEach((descriptor) => {
        if (descriptor.identity.profileId === profileId) descriptor.authorized = true;
      });
    },
    disarm() {
      generation += 1;
      armedProfileId = null;
    },
    flush: async () => {
      /* A close can join the command stream while app shutdown is already
         awaiting this barrier. Keep draining until no enqueue replaced the
         tail we just observed, so exit commit cannot overtake that close. */
      while (true) {
        const pending = tail;
        await pending;
        if (pending === tail) return;
      }
    },
    isArmed: () => Boolean(armedProfileId),
    persistExplicitClose,
    persistSessionOpen: (value = {}) => persistOpen({
      ...value,
      kind: BREAKOUT_KIND_SESSION,
      sessionRef: value.sessionRef || value.session_ref || value.sessionId || value.session_id,
      spaceId: "",
      leafId: "",
    }),
    persistSpaceLeafOpen: (value = {}) => persistOpen({
      ...value,
      kind: BREAKOUT_KIND_SPACE_LEAF,
      sessionRef: "",
    }),
  });
}

export function sessionWindowControlEndsBreakout(control) {
  return text(control) === SESSION_WINDOW_CONTROL_RETURN;
}

/* The durable command must enter its ordered stream before focus verification
   yields to the standalone child. This shared seam keeps production and the
   fast-Return behavioral pin on the same ordering path. Persistence reports
   its own errors; native verification retains its existing result contract. */
export function startBreakoutOpenBeforeNativeCheck({
  persistOpen,
  trackAfterNativeCheck,
} = {}) {
  if (typeof persistOpen === "function") {
    try {
      void Promise.resolve(persistOpen()).catch(() => {});
    } catch {
      // Persistence owns error reporting; native tracking must still proceed.
    }
  }
  if (typeof trackAfterNativeCheck !== "function") return Promise.resolve(null);
  return Promise.resolve().then(trackAfterNativeCheck);
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

function monitorWorkArea(monitor) {
  const area = monitor?.workArea || monitor;
  const x = Number(area?.position?.x);
  const y = Number(area?.position?.y);
  const width = Number(area?.size?.width);
  const height = Number(area?.size?.height);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }
  return {
    bottom: y + height,
    height,
    left: x,
    name: text(monitor?.name),
    right: x + width,
    top: y,
    width,
  };
}

function rectangleIntersectionArea(left, right) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left));
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top));
  return width * height;
}

/**
 * Decode future persisted geometry at the JS trust boundary and constrain it
 * to a display that exists now. Invalid/unplaceable geometry deliberately
 * returns null so the native S3 path uses its safe default cascade.
 */
export function clampBreakoutRestoreGeometry(geometryJson, monitors = []) {
  if (typeof geometryJson !== "string" || !geometryJson) return null;
  let geometry;
  try {
    geometry = JSON.parse(geometryJson);
  } catch {
    return null;
  }
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) return null;
  const allowedKeys = new Set([
    "display", "fullscreen", "height", "maximized", "width", "x", "y",
  ]);
  if (Object.keys(geometry).some((key) => !allowedKeys.has(key))) return null;
  const width = Number(geometry.width);
  const height = Number(geometry.height);
  if (!Number.isSafeInteger(width) || width <= 0
    || !Number.isSafeInteger(height) || height <= 0) {
    return null;
  }
  const hasX = Object.hasOwn(geometry, "x");
  const hasY = Object.hasOwn(geometry, "y");
  if (hasX !== hasY
    || (hasX && (!Number.isSafeInteger(geometry.x) || !Number.isSafeInteger(geometry.y)))
    || (Object.hasOwn(geometry, "display")
      && (typeof geometry.display !== "string" || !geometry.display.trim()))
    || (Object.hasOwn(geometry, "maximized") && typeof geometry.maximized !== "boolean")
    || (Object.hasOwn(geometry, "fullscreen") && typeof geometry.fullscreen !== "boolean")) {
    return null;
  }
  const workAreas = Array.isArray(monitors) ? monitors.map(monitorWorkArea).filter(Boolean) : [];
  if (!workAreas.length) return null;

  const requestedX = hasX ? geometry.x : null;
  const requestedY = hasY ? geometry.y : null;
  const hasPosition = hasX && hasY;
  const requestedRect = hasPosition ? {
    bottom: requestedY + height,
    left: requestedX,
    right: requestedX + width,
    top: requestedY,
  } : null;
  const namedDisplay = text(geometry.display);
  const namedArea = namedDisplay
    ? workAreas.find((area) => area.name === namedDisplay) || null
    : null;
  const intersectingArea = requestedRect
    ? workAreas.reduce((best, area) => {
      const intersection = rectangleIntersectionArea(requestedRect, area);
      return !best || intersection > best.intersection ? { area, intersection } : best;
    }, null)
    : null;
  const workArea = namedArea
    || (intersectingArea?.intersection > 0 ? intersectingArea.area : null)
    || workAreas[0];

  const clampedWidth = Math.round(Math.min(Math.max(width, 520), workArea.width, 2600));
  const clampedHeight = Math.round(Math.min(Math.max(height, 420), workArea.height, 1800));
  const result = {
    height: clampedHeight,
    width: clampedWidth,
  };
  if (hasPosition) {
    result.x = Math.round(Math.min(
      Math.max(requestedX, workArea.left),
      Math.max(workArea.left, workArea.right - clampedWidth),
    ));
    result.y = Math.round(Math.min(
      Math.max(requestedY, workArea.top),
      Math.max(workArea.top, workArea.bottom - clampedHeight),
    ));
  }
  if (geometry.maximized === true) result.maximized = true;
  if (geometry.fullscreen === true) result.fullscreen = true;
  return result;
}

/** Pure restore decision: validate coordinates, retain placeholders, and
 * collapse duplicated durable rows by logical native-window identity. */
export function decideBreakoutRestoreReopens(records, profileIdValue) {
  const profileId = text(profileIdValue);
  if (!profileId || !Array.isArray(records)) return [];
  const seen = new Set();
  const reopens = [];
  records.forEach((record) => {
    const identity = breakoutIdentity(record);
    if (!identity || identity.profileId !== profileId) return;
    const key = breakoutIdentityFingerprint(identity);
    if (seen.has(key)) return;
    seen.add(key);
    reopens.push(identity.kind === BREAKOUT_KIND_SESSION ? {
      geometryJson: typeof record.geometry_json === "string" ? record.geometry_json : null,
      kind: identity.kind,
      sessionRef: identity.sessionRef,
      viewStateJson: typeof record.view_state_json === "string" ? record.view_state_json : null,
    } : {
      geometryJson: typeof record.geometry_json === "string" ? record.geometry_json : null,
      kind: identity.kind,
      leafId: identity.leafId,
      spaceId: identity.spaceId,
      viewStateJson: typeof record.view_state_json === "string" ? record.view_state_json : null,
    });
  });
  return reopens;
}

export function breakoutRestoreShouldArm({ current, reopenComplete } = {}) {
  return current === true && reopenComplete === true;
}

/**
 * Step 4 completion is an edge, not a profile-level boolean. Invalidating the
 * gate synchronously makes an older completion unusable even before React has
 * committed the state update that clears its public token. Each completion
 * can be claimed by Step 6 exactly once.
 */
export function createBreakoutHydrationRestoreGate() {
  let generation = 0;
  let currentToken = null;
  let claimedToken = null;
  return Object.freeze({
    claim(token, expectedProfileId) {
      const profileId = text(expectedProfileId);
      if (!profileId
        || token !== currentToken
        || token?.generation !== generation
        || token?.profileId !== profileId
        || claimedToken === token) {
        return false;
      }
      claimedToken = token;
      return true;
    },
    complete(value = {}) {
      const profileId = text(value.profileId || value.profile_id);
      if (!profileId) return null;
      const revision = value.revision ?? null;
      if (currentToken) {
        return currentToken.profileId === profileId && currentToken.revision === revision
          ? currentToken
          : null;
      }
      const token = Object.freeze({
        generation,
        profileId,
        revision,
      });
      currentToken = token;
      claimedToken = null;
      return token;
    },
    invalidate() {
      generation += 1;
      currentToken = null;
      claimedToken = null;
      return generation;
    },
  });
}

function sessionWindowNativeIdentity(payload = {}) {
  const spaceId = text(payload.space_id || payload.spaceId);
  const leafId = text(payload.leaf_id || payload.leafId);
  if (spaceId && leafId) return `space:${spaceId}\nleaf:${leafId}`;
  const sessionId = text(payload.session_id || payload.sessionId);
  return sessionId ? `session:${sessionId}` : "";
}

/**
 * The JS-to-native production boundary retains the stable label returned for
 * a logical coordinate. Later opens first ask native to focus that label and
 * create only after native positively reports it absent. Per-identity
 * serialization also closes the double-click race before the first label is
 * cached; Rust's own create-or-focus decision remains the final backstop.
 */
export function createSessionWindowNativeBoundary({ invokeCommand } = {}) {
  const labelsByIdentity = new Map();
  const pendingByIdentity = new Map();
  const forget = (labelValue) => {
    const label = text(labelValue);
    if (!label) return;
    labelsByIdentity.forEach((knownLabel, identity) => {
      if (knownLabel === label) labelsByIdentity.delete(identity);
    });
  };
  const focus = (label) => invokeCommand?.("session_window_focus", { label });
  const open = (payload = {}) => {
    const identity = sessionWindowNativeIdentity(payload);
    if (!identity || typeof invokeCommand !== "function") {
      return Promise.resolve(invokeCommand?.("session_window_open", payload));
    }
    const previous = pendingByIdentity.get(identity) || Promise.resolve();
    let pending;
    pending = previous.catch(() => {}).then(async () => {
      const knownLabel = labelsByIdentity.get(identity);
      if (knownLabel) {
        let exists = null;
        try {
          exists = await focus(knownLabel);
        } catch {
          exists = null;
        }
        if (exists === true) return { label: knownLabel, reused: true };
        labelsByIdentity.delete(identity);
      }
      const result = await invokeCommand("session_window_open", payload);
      const label = text(result?.label);
      if (label) labelsByIdentity.set(identity, label);
      return result;
    });
    pendingByIdentity.set(identity, pending);
    return pending.finally(() => {
      if (pendingByIdentity.get(identity) === pending) pendingByIdentity.delete(identity);
    });
  };
  return Object.freeze({
    close(label) {
      forget(label);
      return invokeCommand?.("session_window_close", { label });
    },
    focus,
    forget,
    open,
  });
}

/**
 * Serialize profile restore generations. A new generation first invalidates
 * an in-flight predecessor; it then waits for that predecessor to close any
 * just-created orphan before issuing its own native opens.
 */
export function createBreakoutRestoreCoordinator() {
  let generation = 0;
  let tail = Promise.resolve();
  const restore = (options = {}) => {
    const profileId = text(options.profileId || options.profile_id);
    const claimedGeneration = generation + 1;
    generation = claimedGeneration;
    const isCurrent = () => generation === claimedGeneration;
    const previous = tail;
    const run = (async () => {
      await previous.catch(() => {});
      if (!profileId || !isCurrent()) return { armed: false, opened: 0, status: "stale" };
      let records;
      let status = "restored";
      try {
        records = await options.listBreakouts(profileId);
      } catch (error) {
        status = "unreadable";
        records = [];
        options.onError?.(error);
      }
      if (!isCurrent()) return { armed: false, opened: 0, status: "stale" };

      const reopens = decideBreakoutRestoreReopens(records, profileId);
      let opened = 0;
      for (const reopen of reopens) {
        if (!isCurrent()) return { armed: false, opened, status: "stale" };
        try {
          const label = await options.openBreakout?.(reopen, { isCurrent });
          if (label && !isCurrent()) {
            try {
              await options.closeBreakout?.(label);
            } catch (error) {
              options.onError?.(error);
            }
            return { armed: false, opened, status: "stale" };
          }
          if (label) opened += 1;
        } catch (error) {
          options.onError?.(error);
        }
      }
      const reopenComplete = isCurrent();
      if (breakoutRestoreShouldArm({ current: isCurrent(), reopenComplete })) {
        try {
          options.armPersistence?.({ profileId });
          return { armed: true, opened, status };
        } catch (error) {
          options.onError?.(error);
        }
      }
      return { armed: false, opened, status: isCurrent() ? status : "stale" };
    })();
    tail = run.catch(() => undefined);
    return run;
  };
  return Object.freeze({
    cancel() {
      generation += 1;
    },
    restore,
  });
}

/**
 * Production Step-6 boundary: claim the exact fresh Step-4 completion and
 * wire every durable/native command used by restore in one importable path.
 * `removeBreakout` is intentionally exposed to the coordinator but is never
 * used merely because breakout_list was unreadable.
 */
export function restoreBreakoutWindowsAtProductionBoundary({
  armPersistence,
  closeBreakout,
  coordinator,
  hydrationGate,
  hydrationToken,
  invokeCommand,
  onError,
  openBreakout,
  profileId,
} = {}) {
  if (!hydrationGate?.claim?.(hydrationToken, profileId)) {
    return Promise.resolve({ armed: false, opened: 0, status: "gated" });
  }
  return coordinator.restore({
    armPersistence,
    closeBreakout: closeBreakout
      || ((label) => invokeCommand("session_window_close", { label })),
    listBreakouts: (currentProfileId) => invokeCommand("breakout_list", {
      profile_id: currentProfileId,
    }),
    onError,
    openBreakout,
    profileId,
    removeBreakout: (id) => invokeCommand("breakout_remove", {
      id,
      profile_id: profileId,
    }),
  });
}

/**
 * One native S3 open/focus path for user opens and boot reopens. Persistence
 * is announced synchronously after native creation (and is therefore dropped
 * by the unarmed restore gate), while generation checks cover the entire open
 * await. A stale result is actively closed instead of becoming an orphan.
 */
export async function openTrackedSessionWindowNative({
  applyNativeGeometry,
  closeNative,
  geometry = null,
  guard,
  isCurrent = () => true,
  nativeExists,
  openNative,
  persistOpen,
  removeTracked,
  track,
} = {}) {
  if (typeof openNative !== "function" || typeof isCurrent !== "function") return "";
  if (!isCurrent()) return "";
  const result = await openNative(geometry);
  const label = text(result?.label);
  if (!label) return "";
  const ownsCreatedWindow = result?.reused !== true;
  let staleCloseStarted = false;
  const closeIfStale = async () => {
    if (isCurrent()) return false;
    if (ownsCreatedWindow && !staleCloseStarted && typeof closeNative === "function") {
      staleCloseStarted = true;
      try {
        await closeNative(label);
      } catch {
        // The native window may already have completed its own close.
      }
    }
    return true;
  };

  let claimedIncarnation = null;
  await startBreakoutOpenBeforeNativeCheck({
    persistOpen: () => persistOpen?.({ label, result }),
    trackAfterNativeCheck: async () => {
      if (await closeIfStale()) return null;
      if (geometry && typeof applyNativeGeometry === "function") {
        try {
          await applyNativeGeometry(label, geometry);
        } catch {
          // A rejected placement falls back to the already-safe native frame.
        }
      }
      if (await closeIfStale()) return null;
      claimedIncarnation = await trackSessionWindowAfterNativeCheck({
        guard,
        label,
        nativeExists,
        remove: (incarnationValue) => removeTracked?.({
          incarnation: incarnationValue,
          label,
        }),
        track: (incarnationValue) => track?.({
          incarnation: incarnationValue,
          label,
          result,
        }),
      });
      return claimedIncarnation;
    },
  });

  if (await closeIfStale()) {
    if (claimedIncarnation != null
      && guard?.invalidate?.(label, claimedIncarnation)
      && typeof removeTracked === "function") {
      removeTracked({ incarnation: claimedIncarnation, label });
    }
    return "";
  }
  return label;
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

/* Destroyed always reconciles S3's dead native window. It also issues an
   idempotent durable removal while the main listener is alive. Shutdown is
   deliberately not classified here: breakout_remove's backend exit guard is
   the sole authority that either applies or refuses the mutation. */
export async function reconcileSessionWindowDestroyed({
  guard,
  label,
  nativeExists,
  removeDurable,
  removeTracked,
} = {}) {
  const removed = await removeSessionWindowAfterNativeCheck({
    guard,
    label,
    nativeExists,
    remove: removeTracked,
  });
  if (removed && typeof removeDurable === "function") {
    await removeDurable();
  }
  return removed;
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

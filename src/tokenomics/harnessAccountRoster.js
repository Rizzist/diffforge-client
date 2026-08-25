// LIVE harness account roster for the tokenomics accounts row.
//
// This module is the only source of live accounts in Tokenomics: the roster
// comes from `account_list` (gated by account_management_v1) plus the
// `account-roster-changed` watch (gated by account_list_watch_v1). The
// historical filter chips keep deriving from STORED usage rows in
// tokenomicsAccountRoster.js — that file is archive filtering, never this
// roster. The two must not be mixed: stored rows can reference accounts that
// no longer exist, and live accounts can have no stored rows yet.
//
// Honesty rules enforced here:
// - Snapshot presence NEVER implies live: an `account_list` result carries a
//   `watch` readiness state, and anything short of `live` renders the roster
//   as possibly stale with the daemon's reason available.
// - A missing feature bit is UNSUPPORTED, which is a different fact from an
//   empty roster.
// - Swap is optimistic-NEVER: starting a swap changes only the in-flight
//   marker; the displayed active account moves only on the daemon's success
//   result (or the roster-changed re-list), and a failure leaves the
//   displayed active account untouched.

export const HARNESS_ACCOUNTS_UNSUPPORTED_CODE = "haider_accounts_unavailable";

export const HARNESS_ROSTER_STARTUP_EFFECT = Object.freeze({
  LISTEN: "listen",
  WATCH: "watch",
  LIST: "list",
});

const DEFAULT_WATCH_REASON = "The account roster watch has not been started for this window.";

function harnessWireText(value) {
  return String(value || "").trim();
}

/* Live account identity is always the daemon's verbatim alias/provider pair.
   Keep normalization and matching here so roster and usage presentation cannot
   grow subtly different spellings of that rule. */
export function harnessAccountAlias(value) {
  return harnessWireText(value && typeof value === "object" ? value.alias : value);
}

export function harnessAccountProvider(value) {
  return harnessWireText(value && typeof value === "object" ? value.provider : value);
}

export function harnessAccountMatchesWireIdentity(row, descriptor) {
  const alias = harnessAccountAlias(descriptor);
  if (!alias || harnessWireText(row?.account_alias) !== alias) return false;
  const provider = harnessAccountProvider(descriptor);
  return !provider || harnessWireText(row?.provider) === provider;
}

export function createHarnessRosterWatchUnavailable(reason = DEFAULT_WATCH_REASON) {
  return { state: "unavailable", reason: harnessWireText(reason || DEFAULT_WATCH_REASON) };
}

/* Startup is an explicit, pure state machine so the ordering is reviewable as
   data, not merely an incidental promise chain. The only legal path is:
   listener registered -> watch attached -> baseline listed. A listener
   rejection is terminal because no revision event could safely reach the
   snapshot after that point. */
export function createHarnessRosterStartupState() {
  return {
    phase: "listener_pending",
    nextEffect: HARNESS_ROSTER_STARTUP_EFFECT.LISTEN,
    listenerFailureReason: "",
    watchFailureReason: "",
  };
}

export function harnessRosterStartupTransition(state, event) {
  const type = harnessWireText(event?.type);
  if (state?.phase === "listener_pending") {
    if (type === "listener_registered") {
      return { ...state, phase: "watch_pending", nextEffect: HARNESS_ROSTER_STARTUP_EFFECT.WATCH };
    }
    if (type === "listener_rejected") {
      return {
        ...state,
        phase: "listener_failed",
        nextEffect: null,
        listenerFailureReason: harnessRosterErrorCode(event?.error) || "account roster listener failed",
      };
    }
    return state;
  }
  if (state?.phase === "watch_pending") {
    if (type === "watch_attached") {
      return { ...state, phase: "baseline_pending", nextEffect: HARNESS_ROSTER_STARTUP_EFFECT.LIST };
    }
    if (type === "watch_rejected") {
      return {
        ...state,
        phase: "baseline_pending",
        nextEffect: HARNESS_ROSTER_STARTUP_EFFECT.LIST,
        watchFailureReason: harnessRosterErrorCode(event?.error) || "account_list_watch failed",
      };
    }
    return state;
  }
  if (state?.phase === "baseline_pending" && type === "baseline_settled") {
    return { ...state, phase: "complete", nextEffect: null };
  }
  return state;
}

/* Executes the Tauri adapters through the state machine above. Dependency
   injection keeps delayed/rejected listener sequences runnable under
   node:test while production passes listen/invoke adapters from the hook. */
export async function driveHarnessRosterStartup({
  registerListener,
  attachWatch,
  takeBaseline,
  onListenerFailure = () => {},
  onWatchResult = () => {},
  onWatchFailure = () => {},
  onBaselineResult = () => {},
  onBaselineFailure = () => {},
  isCancelled = () => false,
}) {
  let machine = createHarnessRosterStartupState();
  let unlisten = null;
  while (machine.nextEffect) {
    if (isCancelled()) {
      if (typeof unlisten === "function") unlisten();
      return { machine, unlisten: null };
    }
    if (machine.nextEffect === HARNESS_ROSTER_STARTUP_EFFECT.LISTEN) {
      try {
        unlisten = await registerListener();
        machine = harnessRosterStartupTransition(machine, { type: "listener_registered" });
      } catch (error) {
        machine = harnessRosterStartupTransition(machine, { type: "listener_rejected", error });
        if (!isCancelled()) onListenerFailure(error);
      }
      continue;
    }
    if (machine.nextEffect === HARNESS_ROSTER_STARTUP_EFFECT.WATCH) {
      try {
        const watch = await attachWatch();
        machine = harnessRosterStartupTransition(machine, { type: "watch_attached" });
        if (!isCancelled()) onWatchResult(watch);
      } catch (error) {
        machine = harnessRosterStartupTransition(machine, { type: "watch_rejected", error });
        if (!isCancelled()) onWatchFailure(error);
      }
      continue;
    }
    if (machine.nextEffect === HARNESS_ROSTER_STARTUP_EFFECT.LIST) {
      try {
        const result = await takeBaseline();
        if (!isCancelled()) onBaselineResult(result);
      } catch (error) {
        if (!isCancelled()) onBaselineFailure(error);
      }
      machine = harnessRosterStartupTransition(machine, { type: "baseline_settled" });
      continue;
    }
    throw new Error(`Unknown harness roster startup effect: ${machine.nextEffect}`);
  }
  return { machine, unlisten };
}

/* Normalizes a wire watch state. Malformed input returns null so callers drop
   it — an unreadable readiness signal must never be fabricated into either
   "live" or a stale marker with an invented reason. */
export function harnessRosterWatchState(value) {
  const state = harnessWireText(value?.state);
  if (state === "live") return { state: "live" };
  if (state === "unavailable") {
    return { state: "unavailable", reason: harnessWireText(value?.reason) };
  }
  return null;
}

/* Classifies one `account-roster-changed` payload.
   - {revision, watch:{state:"live"}} → "roster_changed": the roster moved and
     the payload intentionally carries NO roster data — the only valid
     reaction is to RE-LIST via account_list.
   - {watch:{state, reason?}} → "readiness": a watch transition only; the
     roster snapshot is untouched and must not be re-fetched on its account.
   - anything else → "malformed": dropped. */
export function harnessRosterSignal(payload) {
  const watch = harnessRosterWatchState(payload?.watch);
  if (!watch) return { kind: "malformed" };
  const revision = payload?.revision;
  if (revision != null) {
    if (!Number.isInteger(revision) || revision < 0) return { kind: "malformed" };
    return { kind: "roster_changed", revision, watch };
  }
  return { kind: "readiness", watch };
}

export function createHarnessRosterState() {
  return {
    phase: "loading", // loading | ready | unsupported | unavailable
    descriptors: [],
    revision: null,
    /* Availability of the snapshot itself (tri-state from the daemon), kept
       verbatim; null means no snapshot has been read yet. */
    availability: null,
    hasSnapshot: false,
    watch: createHarnessRosterWatchUnavailable(),
    reason: "",
    swap: { phase: "idle", alias: "", message: "" }, // idle | in_flight | confirm_epoch | failed
  };
}

export function harnessRosterOnListResult(state, result) {
  const descriptors = Array.isArray(result?.descriptors) ? result.descriptors : [];
  const revision = Number.isInteger(result?.revision) ? result.revision : null;
  const watch = harnessRosterWatchState(result?.watch)
    || createHarnessRosterWatchUnavailable();
  return {
    ...state,
    phase: "ready",
    descriptors,
    revision,
    availability: result?.availability ?? null,
    hasSnapshot: true,
    watch,
    reason: "",
  };
}

export function harnessRosterErrorCode(error) {
  return harnessWireText(error?.message || error);
}

export function harnessRosterOnListError(state, error) {
  const code = harnessRosterErrorCode(error);
  const unsupported = code.includes(HARNESS_ACCOUNTS_UNSUPPORTED_CODE);
  return {
    ...state,
    /* The list failing says nothing about the previous snapshot's content,
       but the phase must say the surface is not currently authoritative. */
    phase: unsupported ? "unsupported" : "unavailable",
    reason: code || "account_list failed",
  };
}

export function harnessRosterOnWatchState(state, watchValue) {
  const watch = harnessRosterWatchState(watchValue);
  if (!watch) return state;
  return { ...state, watch };
}

/* Applies one roster-changed payload. Returns the next state plus whether the
   caller must re-list — the payload never carries roster data, so a
   "roster_changed" signal without a re-list would leave stale pixels marked
   live. */
export function harnessRosterApplySignal(state, payload) {
  const signal = harnessRosterSignal(payload);
  if (signal.kind === "malformed") return { state, relist: false };
  return {
    state: { ...state, watch: signal.watch },
    relist: signal.kind === "roster_changed",
  };
}

function snapshotAvailabilityState(availability) {
  const state = harnessWireText(availability?.state);
  return ["available", "unavailable", "unknown"].includes(state) ? state : "";
}

/* Derives what the accounts row renders. Phases:
   - "loading": no snapshot and no error yet.
   - "unsupported": the daemon does not advertise account_management_v1 —
     NOT the same fact as an empty roster.
   - "unavailable": the list failed (reason carried).
   - "empty": an explicitly available snapshot with zero descriptors — the
     only state allowed to claim "there are no accounts".
   - "ready": descriptors to render.
   - "unverified": a snapshot whose availability is not explicitly available
     and which carries no descriptors — unknown, never rendered as empty.
   possiblyStale is true whenever a rendered snapshot's watch is not live. */
export function harnessRosterPresentation(state) {
  const watchLive = state.watch?.state === "live";
  const staleReason = watchLive ? "" : String(state.watch?.reason || DEFAULT_WATCH_REASON);
  if (state.phase === "unsupported") {
    return { phase: "unsupported", descriptors: [], reason: state.reason, possiblyStale: false, staleReason: "", watchLive };
  }
  if (state.phase === "unavailable") {
    return { phase: "unavailable", descriptors: [], reason: state.reason, possiblyStale: false, staleReason: "", watchLive };
  }
  if (!state.hasSnapshot) {
    return { phase: "loading", descriptors: [], reason: "", possiblyStale: false, staleReason, watchLive };
  }
  const availability = snapshotAvailabilityState(state.availability);
  if (availability === "unavailable") {
    return {
      phase: "unavailable",
      descriptors: state.descriptors,
      reason: String(state.availability?.reason || ""),
      possiblyStale: !watchLive,
      staleReason,
      watchLive,
    };
  }
  if (!state.descriptors.length) {
    if (availability === "available") {
      return { phase: "empty", descriptors: [], reason: "", possiblyStale: !watchLive, staleReason, watchLive };
    }
    /* No explicit availability and no rows: unknown — never claim empty. */
    return { phase: "unverified", descriptors: [], reason: "", possiblyStale: !watchLive, staleReason, watchLive };
  }
  return {
    phase: "ready",
    descriptors: state.descriptors,
    reason: "",
    possiblyStale: !watchLive,
    staleReason,
    watchLive,
  };
}

/* An operator label (account_label_v1) outranks the provider identity, which
   outranks the alias — same precedence the Accounts view uses. */
export function harnessAccountDisplayLabel(descriptor) {
  return harnessWireText(
    descriptor?.label || descriptor?.identity || descriptor?.alias || "",
  ) || "Account";
}

/* Pure chip state/title projection. Formatting the recorded token total stays
   with the view's established formatters; all account/swap presentation
   choices live here. */
export function harnessAccountChipPresentation(
  descriptor,
  swap,
  { meterTitle = "", usageKnown = false, usageTitle = "" } = {},
) {
  const alias = harnessAccountAlias(descriptor);
  const provider = harnessAccountProvider(descriptor) || "provider";
  const label = harnessAccountDisplayLabel(descriptor);
  const isActive = descriptor?.active === true;
  const inFlight = swap?.phase === "in_flight" && swap?.alias === alias;
  const confirmEpoch = swap?.phase === "confirm_epoch" && swap?.alias === alias;
  return {
    alias,
    provider,
    label,
    isActive,
    inFlight,
    confirmEpoch,
    disabled: inFlight || (swap?.phase === "in_flight" && !inFlight),
    title: [
      `${label} (${alias}) · ${provider}`,
      usageKnown
        ? usageTitle
        : "No harness ledger lanes are keyed to this account yet",
      meterTitle,
      isActive ? "Active account" : "Click to make this the active account",
    ].filter(Boolean).join("\n"),
  };
}

export function harnessSwapAllowed(state, descriptor) {
  if (!descriptor || !harnessAccountAlias(descriptor)) {
    return { allowed: false, reason: "missing_alias" };
  }
  if (state.swap.phase === "in_flight") {
    return { allowed: false, reason: "swap_in_flight" };
  }
  if (descriptor.active === true) {
    return { allowed: false, reason: "already_active" };
  }
  return { allowed: true, reason: "" };
}

/* Starting a swap marks ONLY the in-flight alias. Descriptors — and with
   them the displayed active account — are untouched until the daemon
   confirms. */
export function harnessSwapBegin(state, alias) {
  if (state.swap.phase === "in_flight") return state;
  return { ...state, swap: { phase: "in_flight", alias: harnessAccountAlias(alias), message: "" } };
}

/* The daemon's success result IS the confirmation: it publishes the new
   active descriptor and the prior alias. Apply exactly those two facts —
   nothing else is inferred — and clear the in-flight marker. Callers still
   re-list to reconcile the full roster. */
export function harnessSwapConfirm(state, alias, result) {
  const descriptor = result?.descriptor && typeof result.descriptor === "object"
    ? result.descriptor
    : null;
  const priorAlias = harnessAccountAlias(result?.prior_alias);
  const descriptors = state.descriptors.map((row) => {
    const rowAlias = harnessAccountAlias(row);
    if (descriptor && rowAlias === harnessAccountAlias(descriptor)) {
      return { ...descriptor, active: true };
    }
    if (priorAlias && rowAlias === priorAlias) {
      return { ...row, active: false };
    }
    return row;
  });
  return {
    ...state,
    descriptors,
    revision: Number.isInteger(result?.revision) ? result.revision : state.revision,
    swap: { phase: "idle", alias: "", message: "" },
  };
}

export function harnessSwapFailureMessage(code) {
  if (code.includes("revision_conflict")) return "The account list changed underneath — refreshed; try again.";
  if (code.includes("invalid_argument")) return "The daemon rejected the switch (bad alias or provider).";
  if (code.includes("busy")) return "The daemon is busy — try again in a moment.";
  if (code.includes(HARNESS_ACCOUNTS_UNSUPPORTED_CODE)) return "The harness connection is unavailable.";
  return code || "The account switch failed.";
}

/* A failed swap surfaces its typed failure and leaves descriptors — the
   displayed active account — exactly as the daemon last published them. */
export function harnessSwapFail(state, alias, error) {
  const code = harnessRosterErrorCode(error);
  if (code.includes("cache_epoch_confirmation_required")) {
    return { ...state, swap: { phase: "confirm_epoch", alias: harnessAccountAlias(alias), message: "" } };
  }
  return {
    ...state,
    swap: {
      phase: "failed",
      alias: harnessAccountAlias(alias),
      message: harnessSwapFailureMessage(code),
    },
  };
}

export function harnessSwapDismissFailure(state) {
  if (state.swap.phase !== "failed" && state.swap.phase !== "confirm_epoch") return state;
  return { ...state, swap: { phase: "idle", alias: "", message: "" } };
}

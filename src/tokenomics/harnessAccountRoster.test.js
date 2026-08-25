import test from "node:test";
import assert from "node:assert/strict";
import {
  createHarnessRosterState,
  createHarnessRosterStartupState,
  createHarnessRosterWatchUnavailable,
  driveHarnessRosterStartup,
  harnessAccountChipPresentation,
  harnessAccountDisplayLabel,
  harnessRosterApplySignal,
  harnessRosterOnListError,
  harnessRosterOnListResult,
  harnessRosterOnWatchState,
  harnessRosterPresentation,
  harnessRosterSignal,
  harnessRosterStartupTransition,
  harnessRosterWatchState,
  harnessSwapAllowed,
  harnessSwapBegin,
  harnessSwapConfirm,
  harnessSwapDismissFailure,
  harnessSwapFail,
} from "./harnessAccountRoster.js";

const descriptor = (alias, extra = {}) => ({
  alias,
  provider: "anthropic",
  label: "",
  identity: `${alias}@example.com`,
  active: false,
  ...extra,
});

const readyState = (extra = {}) => harnessRosterOnListResult(createHarnessRosterState(), {
  descriptors: [descriptor("work", { active: true }), descriptor("personal")],
  revision: 7,
  availability: { state: "available" },
  watch: { state: "live" },
  ...extra,
});

test("roster-changed signals demand a re-list; readiness transitions never do", () => {
  const changed = harnessRosterSignal({ revision: 12, watch: { state: "live" } });
  assert.deepEqual(changed, { kind: "roster_changed", revision: 12, watch: { state: "live" } });

  const readiness = harnessRosterSignal({ watch: { state: "unavailable", reason: "connection lost" } });
  assert.deepEqual(readiness, {
    kind: "readiness",
    watch: { state: "unavailable", reason: "connection lost" },
  });

  const state = readyState();
  const changedApplied = harnessRosterApplySignal(state, { revision: 13, watch: { state: "live" } });
  assert.equal(changedApplied.relist, true, "a revision signal carries no roster data — re-list is mandatory");
  const readinessApplied = harnessRosterApplySignal(state, { watch: { state: "unavailable", reason: "gone" } });
  assert.equal(readinessApplied.relist, false, "a readiness transition must not trigger a roster re-fetch");
  assert.deepEqual(readinessApplied.state.watch, { state: "unavailable", reason: "gone" });
  assert.deepEqual(
    readinessApplied.state.descriptors,
    state.descriptors,
    "a readiness transition leaves the snapshot untouched",
  );
});

test("malformed roster signals are dropped, never fabricated into state", () => {
  const state = readyState();
  for (const payload of [
    null,
    {},
    { revision: 3 },
    { revision: -1, watch: { state: "live" } },
    { revision: 3.5, watch: { state: "live" } },
    { watch: { state: "weird" } },
  ]) {
    const applied = harnessRosterApplySignal(state, payload);
    assert.equal(applied.relist, false);
    assert.equal(applied.state, state, `payload ${JSON.stringify(payload)} must be dropped`);
  }
  assert.equal(harnessRosterWatchState({ state: "unexpected" }), null);
});

test("snapshot presence never implies live: non-live watch renders possibly-stale with the reason", () => {
  const stale = harnessRosterOnListResult(createHarnessRosterState(), {
    descriptors: [descriptor("work", { active: true })],
    revision: 1,
    availability: { state: "available" },
    watch: { state: "unavailable", reason: "the daemon does not advertise account_list_watch_v1" },
  });
  const presented = harnessRosterPresentation(stale);
  assert.equal(presented.phase, "ready");
  assert.equal(presented.possiblyStale, true);
  assert.equal(presented.staleReason, "the daemon does not advertise account_list_watch_v1");
  assert.equal(presented.watchLive, false);

  const live = harnessRosterPresentation(readyState());
  assert.equal(live.possiblyStale, false);
  assert.equal(live.watchLive, true);

  /* A result missing its watch field entirely is NOT live either. */
  const missingWatch = harnessRosterOnListResult(createHarnessRosterState(), {
    descriptors: [descriptor("work")],
    availability: { state: "available" },
  });
  assert.equal(harnessRosterPresentation(missingWatch).possiblyStale, true);
});

test("a missing feature bit is unsupported — a different fact from an empty roster", () => {
  const unsupported = harnessRosterOnListError(
    createHarnessRosterState(),
    "haider_accounts_unavailable",
  );
  assert.equal(harnessRosterPresentation(unsupported).phase, "unsupported");

  const empty = harnessRosterOnListResult(createHarnessRosterState(), {
    descriptors: [],
    availability: { state: "available" },
    watch: { state: "live" },
  });
  assert.equal(harnessRosterPresentation(empty).phase, "empty");

  /* Zero descriptors WITHOUT explicit availability is unknown, never empty. */
  const unverified = harnessRosterOnListResult(createHarnessRosterState(), {
    descriptors: [],
    watch: { state: "live" },
  });
  assert.equal(harnessRosterPresentation(unverified).phase, "unverified");

  const failed = harnessRosterOnListError(createHarnessRosterState(), new Error("connection refused"));
  assert.equal(harnessRosterPresentation(failed).phase, "unavailable");
  assert.equal(harnessRosterPresentation(failed).reason, "connection refused");
});

test("swap is optimistic-NEVER: begin and failure leave the displayed active account untouched", () => {
  const state = readyState();
  const began = harnessSwapBegin(state, "personal");
  assert.deepEqual(began.swap, { phase: "in_flight", alias: "personal", message: "" });
  assert.deepEqual(
    began.descriptors,
    state.descriptors,
    "starting a swap must not move the active marker",
  );
  assert.equal(began.descriptors.find((row) => row.alias === "work").active, true);
  assert.equal(began.descriptors.find((row) => row.alias === "personal").active, false);

  const failed = harnessSwapFail(began, "personal", "busy: try later");
  assert.equal(failed.swap.phase, "failed");
  assert.equal(failed.swap.alias, "personal");
  assert.match(failed.swap.message, /busy/i);
  assert.deepEqual(
    failed.descriptors,
    state.descriptors,
    "a failed swap must not change the displayed active account",
  );
});

test("swap success clears only the marker and waits for account_list to publish roster facts", () => {
  const began = harnessSwapBegin(readyState(), "personal");
  const confirmed = harnessSwapConfirm(began, "personal", {
    descriptor: descriptor("personal", { active: true, label: "Personal" }),
    prior_alias: "work",
    revision: 8,
  });
  assert.deepEqual(confirmed.swap, { phase: "idle", alias: "", message: "" });
  assert.equal(
    confirmed.descriptors,
    began.descriptors,
    "even a successful point response must not replace or edit cached descriptors",
  );
  assert.deepEqual(confirmed.descriptors, readyState().descriptors);
  assert.equal(confirmed.revision, 7, "revision changes only when account_list republishes it");
});

test("cache_epoch_confirmation_required becomes a typed confirm state, not a silent retry", () => {
  const began = harnessSwapBegin(readyState(), "personal");
  const needsConfirm = harnessSwapFail(
    began,
    "personal",
    new Error("cache_epoch_confirmation_required: switching restarts provider caches"),
  );
  assert.deepEqual(needsConfirm.swap, { phase: "confirm_epoch", alias: "personal", message: "" });
  assert.deepEqual(needsConfirm.descriptors, began.descriptors);
  const dismissed = harnessSwapDismissFailure(needsConfirm);
  assert.equal(dismissed.swap.phase, "idle");
});

test("swap gating: active accounts and in-flight swaps refuse a new swap", () => {
  const state = readyState();
  assert.equal(harnessSwapAllowed(state, state.descriptors[0]).allowed, false);
  assert.equal(harnessSwapAllowed(state, state.descriptors[0]).reason, "already_active");
  assert.equal(harnessSwapAllowed(state, state.descriptors[1]).allowed, true);
  const busy = harnessSwapBegin(state, "personal");
  assert.equal(harnessSwapAllowed(busy, state.descriptors[1]).allowed, false);
  assert.equal(harnessSwapAllowed(busy, state.descriptors[1]).reason, "swap_in_flight");
});

test("display label precedence: operator label, then identity, then alias", () => {
  assert.equal(harnessAccountDisplayLabel({ alias: "a1", identity: "me@x.dev", label: "Work" }), "Work");
  assert.equal(harnessAccountDisplayLabel({ alias: "a1", identity: "me@x.dev" }), "me@x.dev");
  assert.equal(harnessAccountDisplayLabel({ alias: "a1" }), "a1");
});

test("watch readiness from account_list_watch replaces only the watch state", () => {
  const state = readyState();
  const updated = harnessRosterOnWatchState(state, { state: "unavailable", reason: "capability_denied" });
  assert.deepEqual(updated.watch, { state: "unavailable", reason: "capability_denied" });
  assert.deepEqual(updated.descriptors, state.descriptors);
  assert.equal(harnessRosterOnWatchState(state, { state: "bogus" }), state, "malformed readiness is dropped");
});

test("startup state machine keeps watch and baseline blocked behind a delayed listener", async () => {
  const initial = createHarnessRosterStartupState();
  assert.equal(initial.nextEffect, "listen");
  assert.equal(
    harnessRosterStartupTransition(initial, { type: "watch_attached" }),
    initial,
    "the machine refuses an out-of-order watch",
  );

  const calls = [];
  let releaseListener;
  const listenerReady = new Promise((resolve) => {
    releaseListener = resolve;
  });
  const startup = driveHarnessRosterStartup({
    registerListener: () => {
      calls.push("listen");
      return listenerReady;
    },
    attachWatch: async () => {
      calls.push("watch");
      return { state: "live" };
    },
    takeBaseline: async () => {
      calls.push("list");
      return { descriptors: [] };
    },
  });
  await Promise.resolve();
  assert.deepEqual(calls, ["listen"], "neither watch nor list may start in the listener-registration gap");
  releaseListener(() => {});
  const completed = await startup;
  assert.deepEqual(calls, ["listen", "watch", "list"]);
  assert.equal(completed.machine.phase, "complete");
  assert.equal(completed.machine.nextEffect, null);
});

test("a rejected listener stops startup and leaves Snapshot carrying the actual reason", async () => {
  const calls = [];
  let roster = createHarnessRosterState();
  const rejected = await driveHarnessRosterStartup({
    registerListener: async () => {
      calls.push("listen");
      throw new Error("event permission denied by runtime");
    },
    attachWatch: async () => {
      calls.push("watch");
    },
    takeBaseline: async () => {
      calls.push("list");
    },
    onListenerFailure: (error) => {
      roster = harnessRosterOnWatchState(
        roster,
        createHarnessRosterWatchUnavailable(error.message),
      );
    },
  });
  assert.deepEqual(calls, ["listen"], "watch and baseline must not run without a listener");
  assert.equal(rejected.machine.phase, "listener_failed");
  assert.equal(rejected.machine.listenerFailureReason, "event permission denied by runtime");
  const presentation = harnessRosterPresentation(roster);
  assert.equal(presentation.watchLive, false, "the badge projection remains Snapshot");
  assert.equal(presentation.staleReason, "event permission denied by runtime");
});

test("mocked account_set_active failure keeps active render projections on the old account", async () => {
  let state = readyState();
  const accountSetActive = async () => {
    throw new Error("busy: mocked account_set_active failure");
  };
  state = harnessSwapBegin(state, "personal");
  try {
    await accountSetActive();
    assert.fail("the mocked command must reject");
  } catch (error) {
    state = harnessSwapFail(state, "personal", error);
  }
  const rendered = Object.fromEntries(state.descriptors.map((row) => {
    const projection = harnessAccountChipPresentation(row, state.swap);
    return [row.alias, {
      activeStyle: projection.isActive,
      activeBadge: projection.isActive ? "Active" : null,
      ariaPressed: projection.isActive,
    }];
  }));
  assert.deepEqual(rendered.work, {
    activeStyle: true,
    activeBadge: "Active",
    ariaPressed: true,
  });
  assert.deepEqual(rendered.personal, {
    activeStyle: false,
    activeBadge: null,
    ariaPressed: false,
  });
});

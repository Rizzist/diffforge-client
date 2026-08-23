import assert from "node:assert/strict";
import test from "node:test";

import {
  applyLegacySessionBinding,
  applyResidentBindingSnapshot,
  initialSessionBindingState,
  sessionBindingAnnouncement,
} from "./sessionTerminalBinding.js";

const SURFACE = {
  paneId: "session-pane-source",
  hostSessionId: "local-source",
};

test("a resident binding frame reports WHAT is bound, not which pane shows it", () => {
  const state = applyResidentBindingSnapshot(
    initialSessionBindingState(),
    {
      supported: true,
      known: true,
      session_id: "session-target",
      worker_generation: 129,
    },
    SURFACE,
  );

  // The profile-level fact is real and is what retired the terminal scrape.
  assert.equal(state.authority, "protocol");
  assert.equal(state.known, true);
  assert.equal(state.sessionId, "session-target");

  // But it names no pane, so it must not produce a pane-addressed
  // announcement — not even when a surface happens to be mounted.
  assert.equal(sessionBindingAnnouncement(state), null);
});

test("an absent resident session_id is known unbound, not never observed", () => {
  const neverObserved = initialSessionBindingState();
  const unbound = applyResidentBindingSnapshot(neverObserved, {
    supported: true,
    known: true,
    session_id: null,
    worker_generation: 129,
  });

  assert.equal(neverObserved.known, false);
  assert.equal(unbound.known, true);
  assert.equal(unbound.sessionId, null);
  assert.notDeepEqual(unbound, neverObserved);
});

test("without the feature bit the OSC fallback drives binding", () => {
  const legacy = applyResidentBindingSnapshot(initialSessionBindingState(), {
    supported: false,
    known: false,
  });
  const bound = applyLegacySessionBinding(legacy, {
    ...SURFACE,
    providerSessionId: "session-legacy",
  });

  assert.equal(bound.authority, "osc");
  assert.equal(bound.known, true);
  assert.equal(bound.sessionId, "session-legacy");
  assert.deepEqual(sessionBindingAnnouncement(bound), {
    ...SURFACE,
    providerSessionId: "session-legacy",
  });
});

test("with the feature bit OSC cannot also write binding state", () => {
  const protocol = applyResidentBindingSnapshot(initialSessionBindingState(), {
    supported: true,
    known: true,
    session_id: "session-protocol",
    worker_generation: 129,
  });
  const afterOsc = applyLegacySessionBinding(protocol, {
    ...SURFACE,
    providerSessionId: "session-stale-osc",
  });

  assert.strictEqual(afterOsc, protocol);
  assert.equal(afterOsc.sessionId, "session-protocol");
});

/* Pairing the protocol fact with the surface mounted when it arrived LOOKS
   careful — the surface is real and the timing is fenced — but it manufactures
   an identity the fact never carried. Right by coincidence with one shell
   open; with two, an in-TUI hop in one rehomed the other. */
test("a protocol observation never inherits the surface that was mounted", () => {
  const observed = applyResidentBindingSnapshot(
    initialSessionBindingState(),
    {
      supported: true,
      known: true,
      session_id: "session-target",
      worker_generation: 129,
    },
    SURFACE,
  );

  assert.equal(sessionBindingAnnouncement(observed), null);
  assert.equal(observed.sessionId, "session-target");
});

test("repeated legacy capability snapshots preserve a known OSC binding", () => {
  const legacy = applyResidentBindingSnapshot(initialSessionBindingState(), {
    supported: false,
    known: false,
  });
  const bound = applyLegacySessionBinding(legacy, {
    ...SURFACE,
    providerSessionId: "session-legacy",
  });
  const repeated = applyResidentBindingSnapshot(bound, {
    supported: false,
    known: false,
  });

  assert.strictEqual(repeated, bound);
  assert.equal(repeated.known, true);
  assert.equal(repeated.sessionId, "session-legacy");
});

/* The profile-global frame must never be usable as a per-pane identity.

   The daemon keeps N binding publishers keyed by connection and collapses them
   to a single most-recent winner, discarding the owner. With several shells
   open it therefore reports whichever published last — which may be none of
   the panes on screen. An earlier build routed it into pane rehoming, so an
   in-TUI hop in one shell moved a different shell, silently.

   Per-pane identity comes from OSC 7791, which arrives inside that pane's own
   stream and so can only ever describe that pane. */
test("a protocol binding names no pane, so it cannot address one", () => {
  const bound = applyResidentBindingSnapshot(
    initialSessionBindingState,
    {
      supported: true,
      known: true,
      session_id: "session-from-some-other-shell",
      worker_generation: 129,
    },
    // A surface IS mounted — the realistic case, and the one that used to
    // make this fact address a pane it never named.
    { paneId: "pane-for-a-different-session", hostSessionId: "session-b" },
  );

  assert.equal(bound.authority, "protocol");
  const announcement = sessionBindingAnnouncement(bound);
  assert.ok(
    announcement == null || announcement.paneId == null,
    "a profile-global fact must not carry a pane it never identified",
  );
});

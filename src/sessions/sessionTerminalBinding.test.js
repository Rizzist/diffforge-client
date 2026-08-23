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

test("a resident binding frame with session_id binds the surface", () => {
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

  assert.deepEqual(sessionBindingAnnouncement(state), {
    ...SURFACE,
    providerSessionId: "session-target",
  });
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

test("a cached protocol observation stays attached to its original surface", () => {
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

  const afterNavigation = sessionBindingAnnouncement(observed);

  assert.deepEqual(afterNavigation, {
    ...SURFACE,
    providerSessionId: "session-target",
  });
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

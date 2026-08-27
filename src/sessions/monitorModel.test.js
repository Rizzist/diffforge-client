import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceWatchCursor,
  cursorAdvances,
  listOutcomeView,
  MONITOR_CURSOR_BASELINE,
  monitorCursorOrNull,
  registerOutcomeView,
  sourceAvailabilityView,
} from "./monitorModel.js";

test("[pin] source availability is tri-state and absence is never available", () => {
  assert.deepEqual(
    sourceAvailabilityView({ source: "timer", state: "available" }),
    { source: "timer", state: "available", reason: null, stateRaw: "available" },
  );
  assert.deepEqual(
    sourceAvailabilityView({
      source: "sms",
      availability: {
        state: "unavailable",
        reason: { reason: "adapter_not_configured" },
      },
    }),
    {
      source: "sms",
      state: "unavailable",
      reason: "adapter_not_configured",
      stateRaw: "unavailable",
    },
  );

  const absent = sourceAvailabilityView({ source: "file" });
  assert.equal(absent.state, "unknown",
    "an absent source state must remain unknown, never available");
  assert.equal(absent.stateRaw, null);
  assert.equal(absent.reason, null);

  const future = sourceAvailabilityView({ source: "poll", state: "probing" });
  assert.equal(future.state, "unknown",
    "an unrecognized source state must remain unknown, never available");
  assert.equal(future.stateRaw, "probing");
});

test("[pin] monitors is a real list only when the outcome is listed", () => {
  const listed = listOutcomeView({ status: "listed", monitors: [] });
  assert.deepEqual(listed, { status: "listed", monitors: [] },
    "listed-and-empty is the only honest empty monitor set");

  const rejected = listOutcomeView({
    status: "rejected",
    rejection: { reason: "capability_denied", capability: "view" },
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(Object.hasOwn(rejected, "monitors"), false,
    "a rejected list outcome must not expose monitors or claim '0 monitors'");
  assert.equal(rejected.rejection.reason, "capability_denied");

  const unknown = listOutcomeView({ status: "deferred" });
  assert.equal(unknown.status, "unknown");
  assert.equal(Object.hasOwn(unknown, "monitors"), false,
    "an unknown list outcome must not expose monitors or claim '0 monitors'");
});

test("[pin] register rejection remains a structured typed reason, never success or a string", () => {
  const rejection = {
    reason: "limit_reached",
    limit: 3,
    current: 3,
  };
  const view = registerOutcomeView({ status: "rejected", rejection });

  assert.equal(view.status, "rejected",
    "a rejected registration must never be fabricated into a success");
  assert.equal(typeof view.rejection, "object",
    "a register rejection must remain a structured object, never a bare string");
  assert.deepEqual(view.rejection, {
    kind: "limit_reached",
    reason: "limit_reached",
    detail: "limit: 3, current: 3",
    raw: rejection,
  });
});

test("[pin] watch cursors are validated decimal strings, BigInt-compared, and advanced verbatim", () => {
  assert.equal(MONITOR_CURSOR_BASELINE, "0",
    "the watch baseline must be the decimal string '0'");
  for (const valid of ["0", "7", "0007", "9007199254740993"]) {
    assert.equal(monitorCursorOrNull(valid), valid,
      `valid decimal cursor ${valid} must ride verbatim`);
  }
  for (const invalid of [null, undefined, "", "-1", "+1", "1.0", " 1", 0, 9007199254740993]) {
    assert.equal(monitorCursorOrNull(invalid), null,
      `non-decimal-string cursor ${String(invalid)} must be refused`);
  }

  assert.equal(cursorAdvances("9007199254740992", "9007199254740993"), true,
    "cursor order above 2^53 must use BigInt, not lossy number math");
  assert.equal(cursorAdvances("9007199254740993", "9007199254740992"), false);

  const beyondSafeInteger = "9007199254740993";
  assert.equal(
    advanceWatchCursor("9007199254740992", [beyondSafeInteger]),
    beyondSafeInteger,
    "a >2^53 cursor must advance character-for-character",
  );
  assert.equal(advanceWatchCursor("7", [8]), "7",
    "a number candidate must be refused even when it looks newer");
});

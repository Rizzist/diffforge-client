import assert from "node:assert/strict";
import test from "node:test";

import {
  cacheRereadMetric,
  formatBasisPoints,
  measuredCacheRereadBasisPoints,
} from "./cacheMetric.js";

/* This metric spent a full day unreachable, not because the daemon withheld it
   but because a lossier roster source kept overwriting the rows that carried
   it. Now that it arrives, the way it can still go wrong is by rendering a fact
   the daemon never stated. */

test("a measured zero is kept, not treated as missing", () => {
  // 0 means the daemon measured and nothing was re-readable. It is a result.
  const session = {
    agent_metrics: { usage: { cache_reread_hit_basis_points: 0 } },
  };

  assert.equal(measuredCacheRereadBasisPoints(session), 0);
  assert.equal(formatBasisPoints(0), "0%");
});

test("an unmeasured session reports nothing, never zero", () => {
  // A first turn has nothing that could have been re-read, so no rate exists.
  // Rendering that as 0% would invent a measurement.
  for (const session of [
    undefined,
    {},
    { agent_metrics: {} },
    { agent_metrics: { usage: {} } },
    { agent_metrics: { usage: { cache_reread_hit_basis_points: null } } },
  ]) {
    assert.equal(measuredCacheRereadBasisPoints(session), null);
  }
});

test("a session with no measured cache value produces no cache metric at all", () => {
  const session = {
    agent_metrics: {
      usage: {
        input_tokens: 2400,
        cached_input_tokens: 1800,
        cache_read_input_tokens: 1800,
      },
    },
  };

  assert.equal(cacheRereadMetric(session), null);
});

test("a small real rate never rounds away to the measured-zero string", () => {
  // 12bp is 0.12% — real, and rounding it to "0%" would render it as the one
  // thing it is not.
  assert.notEqual(formatBasisPoints(12), "0%");
  assert.equal(formatBasisPoints(12), "0.1%");
  assert.equal(formatBasisPoints(950), "9.5%");
});

test("ordinary rates read as whole percentages", () => {
  assert.equal(formatBasisPoints(10000), "100%");
  assert.equal(formatBasisPoints(8266), "83%");
  assert.equal(formatBasisPoints(1000), "10%");
});

/* 0.0.943 promoted this to a top-level field. Old sessions keep only the deep
   one, so both paths are permanent — a client reads whatever is on the other
   end of the socket, not whatever is current. */
test("the promoted top-level rate is preferred, and the deep one still works", () => {
  assert.equal(
    measuredCacheRereadBasisPoints({ cache_reread_hit_basis_points: 9058 }),
    9058,
  );

  // A pre-943 session carries only the nested shape.
  assert.equal(
    measuredCacheRereadBasisPoints({
      agent_metrics: { usage: { cache_reread_hit_basis_points: 6370 } },
    }),
    6370,
  );

  // A measured zero at the top level must not fall through to the deep path —
  // 0 is a result, and `||` here would silently prefer the older number.
  assert.equal(
    measuredCacheRereadBasisPoints({
      cache_reread_hit_basis_points: 0,
      agent_metrics: { usage: { cache_reread_hit_basis_points: 9058 } },
    }),
    0,
  );
});

/* The defect one layer below the `promoted || nested` trap.

   Testing that the promoted value is a usable number still falls through when
   it is present-but-null — letting a stale nested projection overwrite a fresh
   "the daemon answered, and the answer is that it did not measure this". The
   contract permits an explicit null here, so presence is the only test that
   closes both cases. */
test("a present-but-null promoted field is an answer, not a reason to fall back", () => {
  assert.equal(
    measuredCacheRereadBasisPoints({
      cache_reread_hit_basis_points: null,
      agent_metrics: { usage: { cache_reread_hit_basis_points: 9058 } },
    }),
    null,
  );

  // Absent — not present-but-null — is what legitimately reaches the older path.
  assert.equal(
    measuredCacheRereadBasisPoints({
      agent_metrics: { usage: { cache_reread_hit_basis_points: 9058 } },
    }),
    9058,
  );

  // And the nested path obeys the same rule at its own level.
  assert.equal(
    measuredCacheRereadBasisPoints({
      agent_metrics: { usage: { cache_reread_hit_basis_points: null } },
    }),
    null,
  );
});

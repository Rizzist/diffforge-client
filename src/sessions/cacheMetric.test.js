import assert from "node:assert/strict";
import test from "node:test";

import {
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

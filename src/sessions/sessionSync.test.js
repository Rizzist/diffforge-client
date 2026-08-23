import assert from "node:assert/strict";
import test from "node:test";

import { projectionCaughtUp } from "./sessionSync.js";

test("omitted synchronization truth stays unknown", () => {
  assert.equal(projectionCaughtUp({ caught_up: true }), true);
  assert.equal(projectionCaughtUp({ caught_up: false }), false);
  assert.equal(projectionCaughtUp({}), null);
  assert.equal(projectionCaughtUp(null), null);
});

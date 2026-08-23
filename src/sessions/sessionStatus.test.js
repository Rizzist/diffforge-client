import assert from "node:assert/strict";
import test from "node:test";

import { surfaceStatusLabel } from "./sessionStatus.js";

test("surface status uses structured state and never parses display text", () => {
  assert.equal(surfaceStatusLabel({
    state: "running_tool",
    detail: "Running cargo",
    line: "[ IDLE ] localized decoration",
  }, { status: "idle" }), "Running cargo");
  assert.equal(surfaceStatusLabel({ line: "[ RUNNING ] text only" }, {
    status: "unknown",
  }), "Unknown");
  assert.equal(surfaceStatusLabel(null, { status: "future_bucket" }), "Unknown");
  assert.equal(surfaceStatusLabel(null, { status: "idle" }), "Idle");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  exactTrajectoryUsagePoints,
  formatSessionDuration,
  sessionLifecycleDuration,
  trajectoryDurationLabel,
  trajectorySummaryMetrics,
} from "./trajectoryMetrics.js";

test("trajectory headlines read the published summary totals including zero", () => {
  const metrics = trajectorySummaryMetrics({
    turn_count: 5,
    agent_metrics: {
      tool_attempts: 0,
      usage: { logical_input_tokens: 12_000, billed_output_tokens: 345 },
    },
  }, [
    { role: "user" },
    { kind: "tool" },
    { kind: "tool" },
  ], [
    { input: 999_999, output: 1 },
  ]);

  assert.deepEqual(metrics, { turns: 5, calls: 0, tokenTotal: 12_345 });
  assert.deepEqual(trajectorySummaryMetrics({}, [], []), {
    turns: null,
    calls: null,
    tokenTotal: null,
  });
});

test("trajectory request bars use nested exact request values and last-wins", () => {
  const exact = exactTrajectoryUsagePoints([
    {
      seq: 10,
      run_id: "run-1",
      input: 1_000,
      output: 200,
      request: { ordinal: 1, input: 9, output: 2, cached: 0 },
    },
    {
      seq: 11,
      run_id: "run-1",
      input: 2_000,
      output: 400,
      request: { ordinal: 1, input: 10, output: 3, cached: 4 },
    },
  ]);

  assert.deepEqual(exact.map(({ seq, input, output, cached }) => ({ seq, input, output, cached })), [
    { seq: 11, input: 10, output: 3, cached: 4 },
  ]);
  assert.deepEqual(exactTrajectoryUsagePoints([{ seq: 12, input: 50, output: 6 }]), []);
});

test("trajectory duration uses published lifecycle coordinates and preserves unknown", () => {
  assert.deepEqual(sessionLifecycleDuration({
    agent_metrics: {
      started_at_ms: 10_000,
      terminal_at_ms: 130_456,
      live: false,
    },
  }, 999_999), { state: "finished", durationMs: 120_456 });

  const live = sessionLifecycleDuration({
    agent_metrics: {
      started_at_ms: 10_000,
      live: true,
    },
  }, 71_500);
  assert.deepEqual(live, { state: "live", durationMs: 61_500 });
  assert.equal(formatSessionDuration(live.durationMs), "1m 1s");

  assert.deepEqual(sessionLifecycleDuration({
    agent_metrics: { started_at_ms: 10_000, live: false },
  }, 71_500), { state: "unknown", durationMs: null });
  assert.deepEqual(sessionLifecycleDuration({}, 71_500), {
    state: "unknown",
    durationMs: null,
  });
  assert.equal(formatSessionDuration(null), "—");
  assert.equal(formatSessionDuration(0), "<1s");
  assert.equal(trajectoryDurationLabel({}, 71_500), "—");
  assert.equal(trajectoryDurationLabel({
    agent_metrics: { started_at_ms: 10_000, live: true },
  }, 71_500), "1m 1s · live");

  // The frontend suite has no JSX runtime. Pin the tiny renderer seam so a
  // literal cannot bypass the behaviorally tested lifecycle view-model.
  const source = readFileSync(new URL("./SessionTrajectory.jsx", import.meta.url), "utf8");
  assert.match(source, /const durationLabel = trajectoryDurationLabel\(session, durationNowMs\)/);
  assert.match(source, /<span>\{durationLabel\}<\/span>/);
});

test("absent trajectory duration renders an em dash", () => {
  assert.equal(
    trajectoryDurationLabel({ agent_metrics: { live: false } }, 71_500),
    "—",
    "absent published lifecycle coordinates must render —, never a fabricated duration",
  );
});

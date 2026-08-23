import assert from "node:assert/strict";
import test from "node:test";

import {
  exactTrajectoryUsagePoints,
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

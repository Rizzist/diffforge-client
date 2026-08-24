import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  sessionActivityVisualState,
  sessionCloseCautionSummary,
  sessionRunActivityState,
  sessionRunCanCancel,
  sessionRunIsActive,
} from "./sessionActivity.js";

test("terminal daemon summaries stay inactive when the selected run_id is retained", () => {
  // Shape copied from the installed 0.0.952 daemon mirror: select_observed_run
  // falls back to the latest terminal run, and agent_metrics publishes live.
  const realIdleSummary = {
    run_state: "idle",
    state_raw: "idle",
    status: "idle",
    run_id: "run-393cd229e9dc18c5abcd1b1b45221c14",
    worker_generation: 140,
    agent_metrics: {
      head_seq: 11,
      live: false,
      session_id: "session-05fe93cb2ed25580faf1be7205e91c0b",
      started_at_ms: 1785912885260,
      terminal_at_ms: 1785912887317,
      tool_attempts: 0,
    },
  };
  assert.equal(
    sessionRunActivityState(realIdleSummary),
    "inactive",
    "terminal daemon run_id identifies history; it is not liveness",
  );
  assert.equal(sessionRunIsActive(realIdleSummary), false);
  assert.equal(sessionRunCanCancel(realIdleSummary), false);
  assert.equal(sessionActivityVisualState(realIdleSummary), "idle");
  assert.deepEqual(
    sessionCloseCautionSummary([realIdleSummary]),
    { active: 0, unknown: 0, total: 0 },
  );

  for (const runState of ["errored", "cancelled", "done", "completed"]) {
    assert.equal(sessionRunActivityState({
      run_state: runState,
      state_raw: runState,
      status: runState === "errored" ? "error" : "idle",
      run_id: `terminal-${runState}`,
      agent_metrics: { live: false },
    }), "inactive", `${runState} is terminal even with run_id`);
  }
});

test("published active state and run identity are both required for cancellation", () => {
  const active = {
    run_state: "running",
    state_raw: "running",
    status: "running",
    run_id: "run-active-7",
    worker_generation: 147,
    agent_metrics: { live: true, terminal_at_ms: null },
  };
  assert.equal(sessionRunActivityState(active), "active");
  assert.equal(sessionRunCanCancel(active), true);
  assert.equal(sessionRunCanCancel({ ...active, run_id: null }), false);
  assert.equal(sessionRunActivityState({ ...active, run_id: null }), "active");
  assert.equal(sessionRunActivityState({ status: "waiting" }), "active");
});

test("unknown activity is neutral on home while close remains cautious", () => {
  const serializedUnknown = { run_id: null, status: "unknown" };
  assert.equal(sessionRunActivityState(serializedUnknown), "unknown");
  assert.equal(
    sessionActivityVisualState({ run_id: "run-7", status: "unknown" }),
    "unknown",
  );
  // Real 0.0.952 shape: effect_unknown is the unresolved side-effect honesty
  // state. Metrics report the agent as live, but that does not resolve whether
  // cancelling/retrying the effect is safe.
  assert.equal(sessionRunActivityState({
    run_state: "effect_unknown",
    state_raw: "effect_unknown",
    status: "unknown",
    run_id: "run-effect-unknown",
    agent_metrics: { live: true },
  }), "unknown");
  assert.equal(
    sessionActivityVisualState({ run_id: null, status: "running" }),
    "running",
  );
  assert.equal(
    sessionActivityVisualState({ run_id: null, status: "idle" }),
    "idle",
  );

  assert.deepEqual(sessionCloseCautionSummary([
    { run_id: "run-7", status: "unknown" },
    // SessionRow::serialized_value historically produced this exact shape
    // when the daemon omitted both optional run facts. It must stay cautious.
    { run_id: null, status: "unknown" },
    { run_id: null, status: "idle" },
  ]), { active: 0, unknown: 2, total: 2 });
});

test("session surfaces wire the shared activity facts into close and home UI", () => {
  const appSource = readFileSync(new URL("../app/AppShell.jsx", import.meta.url), "utf8");
  const surfaceSource = readFileSync(new URL("./SessionSurface.jsx", import.meta.url), "utf8");
  const dotStart = surfaceSource.indexOf("const HomeContinueDot = styled.i");
  const dotEnd = surfaceSource.indexOf("const HomeContinue = styled.div", dotStart);
  const dotStyle = surfaceSource.slice(dotStart, dotEnd);

  assert.match(appSource, /sessionCloseCautionSummary\(sessions\)/);
  assert.match(
    surfaceSource,
    /data-status=\{sessionActivityVisualState\(session\)\}/,
  );
  assert.match(surfaceSource, /if \(!sessionRunCanCancel\(session\)\) return null/);
  assert.match(
    dotStyle,
    /\[data-status="unknown"\][\s\S]*?background: var\(--forge-text-disabled\)/,
  );
});

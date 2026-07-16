import test from "node:test";
import assert from "node:assert/strict";

import {
  TERMINAL_SESSION_RESTART_DEFAULT_DEADLINE_MS,
  TERMINAL_SESSION_RESTART_REPLACEMENT_OPEN_TIMEOUT_MS,
  resolveTerminalSessionOpenBinding,
  resolveTerminalSessionRestartRole,
  terminalSessionRestartClearedResult,
  terminalSessionRestartRemoteTimeoutMs,
  terminalSessionRestartResultIsSuccessful,
} from "./terminalSessionRestart.js";

test("canonical restart role wins over conflicting legacy target_agent_id", () => {
  assert.equal(resolveTerminalSessionRestartRole({
    role: "claude",
    target_agent_id: "codex",
  }), "claude");
  assert.equal(resolveTerminalSessionRestartRole({
    target_agent_id: "terminal",
  }), "generic");
  assert.equal(resolveTerminalSessionRestartRole({
    role: "unsupported-role",
    target_agent_id: "codex",
  }), "");
});

test("fresh restart binding drops every historical provider session id", () => {
  assert.deepEqual(resolveTerminalSessionOpenBinding({
    forceFreshSession: true,
    forkFromProviderSessionId: "fork-session-old",
    providerSessionOverride: "override-session-old",
    threadProviderSessionId: "thread-session-old",
  }), {
    fresh_session: true,
    fork_from_provider_session_id: "",
    provider_session_id: "",
  });
});

test("remote restart timeout covers deferred deadline plus replacement open", () => {
  const timeoutMs = terminalSessionRestartRemoteTimeoutMs();
  assert.ok(
    timeoutMs > (
      TERMINAL_SESSION_RESTART_DEFAULT_DEADLINE_MS
      + TERMINAL_SESSION_RESTART_REPLACEMENT_OPEN_TIMEOUT_MS
    ),
  );
  assert.ok(terminalSessionRestartRemoteTimeoutMs(300_000) > 420_000);
});

test("cleared queued restart is a successful superseded terminal result", () => {
  const result = terminalSessionRestartClearedResult({
    coordinator_id: "remote-restart-1",
    instance_id: 7,
    launch_epoch: "pane-1:7",
    mode: "restart_when_idle",
    pane_id: "pane-1",
    restart_intent_seq: 9,
    target_role: "codex",
  }, {
    terminal_index: 0,
    workspace_id: "workspace-1",
  });

  assert.equal(result.status, "superseded");
  assert.equal(result.superseded, true);
  assert.equal(terminalSessionRestartResultIsSuccessful(result), true);
  assert.equal(terminalSessionRestartResultIsSuccessful({ status: "failed" }), false);
});

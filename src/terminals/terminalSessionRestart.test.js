import test from "node:test";
import assert from "node:assert/strict";

import {
  TERMINAL_SESSION_RESTART_DEFAULT_DEADLINE_MS,
  TERMINAL_SESSION_RESTART_REPLACEMENT_OPEN_TIMEOUT_MS,
  getTerminalRestartMenuActions,
  probeTerminalSessionForRestart,
  resolveTerminalRestartOpenPlan,
  resolveTerminalSessionOpenBinding,
  resolveTerminalSessionRestartRole,
  resolveTerminalStartedSessionBinding,
  terminalSessionRestartClearedResult,
  terminalSessionRestartRemoteTimeoutMs,
  terminalSessionRestartReadyRequest,
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
    provider_session_missing: false,
  });
});

test("missing provider session resolves to a fresh empty binding", () => {
  assert.deepEqual(resolveTerminalSessionOpenBinding({
    providerSessionExists: false,
    threadProviderSessionId: "missing-session",
  }), {
    fresh_session: true,
    fork_from_provider_session_id: "",
    provider_session_id: "",
    provider_session_missing: true,
  });

  assert.deepEqual(resolveTerminalSessionOpenBinding({
    providerSessionExists: true,
    threadProviderSessionId: "local-session",
  }), {
    fresh_session: false,
    fork_from_provider_session_id: "",
    provider_session_id: "local-session",
    provider_session_missing: false,
  });
});

test("provider existence guard does not turn an explicit fork into an empty session", () => {
  assert.deepEqual(resolveTerminalSessionOpenBinding({
    forkFromProviderSessionId: "fork-session",
    providerSessionExists: false,
    threadProviderSessionId: "historical-session",
  }), {
    fresh_session: false,
    fork_from_provider_session_id: "fork-session",
    provider_session_id: "",
    provider_session_missing: false,
  });
});

test("restart-with-session always opens fresh when the probe or instance goes stale", () => {
  const base = {
    currentInstanceId: 41,
    currentLaunchEpoch: "pane-1:41",
    expectedInstanceId: 41,
    expectedLaunchEpoch: "pane-1:41",
    requestedFreshSession: false,
    terminalState: "running",
  };

  assert.deepEqual(resolveTerminalRestartOpenPlan({
    ...base,
    providerSessionExists: false,
  }), {
    close_existing: true,
    fresh_session: true,
    instance_current: true,
    open_terminal: true,
  });
  assert.deepEqual(resolveTerminalRestartOpenPlan({
    ...base,
    currentInstanceId: 0,
    providerSessionExists: false,
    terminalState: "exited",
  }), {
    close_existing: false,
    fresh_session: true,
    instance_current: false,
    open_terminal: true,
  });
  assert.deepEqual(resolveTerminalRestartOpenPlan({
    ...base,
    providerSessionExists: true,
    terminalState: "exited",
  }), {
    close_existing: false,
    fresh_session: true,
    instance_current: false,
    open_terminal: true,
  });
  assert.deepEqual(resolveTerminalRestartOpenPlan({
    ...base,
    closeSucceeded: false,
    providerSessionExists: true,
  }), {
    close_existing: false,
    fresh_session: true,
    instance_current: true,
    open_terminal: true,
  });
});

test("restart-with-session preserves a genuine current provider session", () => {
  const base = {
    currentInstanceId: 42,
    currentLaunchEpoch: "pane-1:42",
    expectedInstanceId: 42,
    expectedLaunchEpoch: "pane-1:42",
    providerSessionExists: true,
    terminalState: "running",
  };

  assert.deepEqual(resolveTerminalRestartOpenPlan({
    ...base,
    requestedFreshSession: false,
  }), {
    close_existing: true,
    fresh_session: false,
    instance_current: true,
    open_terminal: true,
  });
  assert.deepEqual(resolveTerminalRestartOpenPlan({
    ...base,
    requestedFreshSession: true,
  }), {
    close_existing: true,
    fresh_session: true,
    instance_current: true,
    open_terminal: true,
  });
});

test("queued restart-with-session preserves its binding across the expected backend exit", () => {
  const readyRequest = terminalSessionRestartReadyRequest({
    coordinator_id: "restart-session-race",
    fresh_session: false,
    instance_id: 43,
    launch_epoch: "pane-1:43",
    pane_id: "pane-1",
    provider_session_id: "provider-session-a",
    target_role: "codex",
  });

  assert.deepEqual(resolveTerminalRestartOpenPlan({
    backendAlreadyClosed: readyRequest.backend_already_closed,
    currentInstanceId: 43,
    currentLaunchEpoch: "pane-1:43",
    expectedInstanceId: readyRequest.instance_id,
    expectedLaunchEpoch: readyRequest.launch_epoch,
    providerSessionExists: true,
    requestedFreshSession: readyRequest.fresh_session,
    terminalState: "exited",
  }), {
    close_existing: false,
    fresh_session: false,
    instance_current: true,
    open_terminal: true,
  });
  assert.deepEqual(resolveTerminalRestartOpenPlan({
    backendAlreadyClosed: true,
    currentInstanceId: 44,
    currentLaunchEpoch: "pane-1:44",
    expectedInstanceId: readyRequest.instance_id,
    expectedLaunchEpoch: readyRequest.launch_epoch,
    providerSessionExists: true,
    requestedFreshSession: readyRequest.fresh_session,
    terminalState: "exited",
  }), {
    close_existing: false,
    fresh_session: true,
    instance_current: false,
    open_terminal: true,
  });
});

test("an explicit Close during the provider-session probe cancels replacement open", () => {
  assert.deepEqual(resolveTerminalRestartOpenPlan({
    currentInstanceId: 42,
    currentLaunchEpoch: "pane-1:42",
    expectedInstanceId: 42,
    expectedLaunchEpoch: "pane-1:42",
    explicitCloseRequested: true,
    providerSessionExists: false,
    requestedFreshSession: false,
    terminalClosing: false,
    terminalState: "closed",
  }), {
    close_existing: false,
    fresh_session: true,
    instance_current: false,
    open_terminal: false,
  });
});

test("an explicit Close that lands while the async session probe is pending wins", async () => {
  let releaseProbe;
  let explicitCloseRequested = false;
  const probe = new Promise((resolve) => {
    releaseProbe = resolve;
  });
  const pending = probeTerminalSessionForRestart(
    () => probe,
    () => explicitCloseRequested,
  );

  explicitCloseRequested = true;
  releaseProbe(false);

  assert.deepEqual(await pending, {
    explicit_close_requested: true,
    provider_session_exists: false,
  });
});

test("prepared agent start binds only the session the backend actually resumed", () => {
  assert.deepEqual(resolveTerminalStartedSessionBinding({
    paneResult: { effective_provider_session_id: null, started: true },
    provider: "claude",
    requestedProviderSessionId: "missing-session",
  }), {
    provider_session_id: "",
    provider_session_id_cleared: true,
  });
  assert.deepEqual(resolveTerminalStartedSessionBinding({
    paneResult: { effective_provider_session_id: "present-session", started: true },
    provider: "claude",
    requestedProviderSessionId: "present-session",
  }), {
    provider_session_id: "present-session",
    provider_session_id_cleared: false,
  });
});

test("restart menu splits the current role only when a provider session exists", () => {
  const roleOptions = [
    { id: "claude", label: "Claude Code" },
    { id: "codex", label: "Codex" },
    { id: "generic", label: "Terminal" },
  ];
  const withSession = getTerminalRestartMenuActions(roleOptions, {
    currentRoleId: "claude",
    hasProviderSession: true,
  });

  assert.deepEqual(withSession.map((action) => [
    action.id,
    action.label,
    action.fresh_session,
  ]), [
    ["claude:with-session", "Restart with session", false],
    ["claude:fresh", "Restart fresh", true],
    ["codex:restart", "Codex", true],
    ["generic:restart", "Terminal", true],
  ]);

  const withoutSession = getTerminalRestartMenuActions(roleOptions, {
    currentRoleId: "claude",
    hasProviderSession: false,
  });
  assert.deepEqual(withoutSession.map((action) => action.label), [
    "Restart",
    "Codex",
    "Terminal",
  ]);
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

test("queued restart-with-session re-entry preserves its resume binding", () => {
  assert.deepEqual(terminalSessionRestartReadyRequest({
    coordinator_id: "restart-session-1",
    fresh_session: false,
    instance_id: 17,
    launch_epoch: "pane-1:17",
    pane_id: "pane-1",
    provider_session_id: "provider-session-a",
    target_role: "codex",
  }, {
    terminal_index: 0,
    workspace_id: "workspace-1",
  }), {
    backend_already_closed: true,
    coordinator_id: "restart-session-1",
    fresh_session: false,
    instance_id: 17,
    launch_epoch: "pane-1:17",
    mode: "restart_now",
    pane_id: "pane-1",
    provider_session_id: "provider-session-a",
    role: "codex",
    terminal_index: 0,
    workspace_id: "workspace-1",
  });
});

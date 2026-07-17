export const TERMINAL_SESSION_RESTART_REQUEST_EVENT = "diffforge:terminal-session-restart-request";
export const TERMINAL_SESSION_RESTART_RESULT_EVENT = "diffforge:terminal-session-restart-result";
export const TERMINAL_SESSION_RESTART_MODES = Object.freeze({
  NOW: "restart_now",
  WHEN_IDLE: "restart_when_idle",
});
export const TERMINAL_SESSION_RESTART_DEFAULT_DEADLINE_MS = 120_000;
export const TERMINAL_SESSION_RESTART_REPLACEMENT_OPEN_TIMEOUT_MS = 120_000;
const TERMINAL_SESSION_RESTART_REMOTE_SETTLE_BUFFER_MS = 15_000;

export function normalizeTerminalSessionRestartMode(value) {
  return String(value || "").trim().toLowerCase() === TERMINAL_SESSION_RESTART_MODES.WHEN_IDLE
    ? TERMINAL_SESSION_RESTART_MODES.WHEN_IDLE
    : TERMINAL_SESSION_RESTART_MODES.NOW;
}

export function normalizeTerminalSessionRestartRole(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (["codex", "claude", "opencode"].includes(normalized)) {
    return normalized;
  }
  if (["generic", "terminal", "shell", "plain-shell"].includes(normalized)) {
    return "generic";
  }
  return "";
}

export function resolveTerminalSessionRestartRole(detail = {}) {
  if (String(detail.role || "").trim()) {
    return normalizeTerminalSessionRestartRole(detail.role);
  }
  return normalizeTerminalSessionRestartRole(
    detail.target_agent_id || detail.agent_id || detail.provider,
  );
}

export function resolveTerminalSessionOpenBinding({
  forceFreshSession = false,
  forkFromProviderSessionId = "",
  providerSessionExists = null,
  providerSessionOverride = "",
  threadProviderSessionId = "",
} = {}) {
  const requestedProviderSessionId = String(
    providerSessionOverride || threadProviderSessionId || "",
  ).trim();
  const providerSessionMissing = Boolean(
    requestedProviderSessionId
      && !String(forkFromProviderSessionId || "").trim()
      && providerSessionExists === false,
  );
  const freshSession = Boolean(forceFreshSession || providerSessionMissing);
  const forkSessionId = freshSession ? "" : String(forkFromProviderSessionId || "").trim();
  return {
    fresh_session: freshSession,
    fork_from_provider_session_id: forkSessionId,
    provider_session_id: freshSession || forkSessionId
      ? ""
      : requestedProviderSessionId,
    provider_session_missing: providerSessionMissing,
  };
}

export function resolveTerminalRestartOpenPlan({
  backendAlreadyClosed = false,
  closeSucceeded = null,
  currentInstanceId = 0,
  currentLaunchEpoch = "",
  expectedInstanceId = 0,
  expectedLaunchEpoch = "",
  explicitCloseRequested = false,
  providerSessionExists = null,
  requestedFreshSession = false,
  terminalClosing = false,
  terminalState = "running",
} = {}) {
  const safeCurrentInstanceId = Number(currentInstanceId || 0);
  const safeExpectedInstanceId = Number(expectedInstanceId || 0);
  const safeCurrentLaunchEpoch = String(currentLaunchEpoch || "").trim();
  const safeExpectedLaunchEpoch = String(expectedLaunchEpoch || "").trim();
  const safeTerminalState = String(terminalState || "").trim().toLowerCase();
  if (explicitCloseRequested) {
    return {
      close_existing: false,
      fresh_session: true,
      instance_current: false,
      open_terminal: false,
    };
  }
  const identityCurrent = Boolean(
    safeCurrentInstanceId
      && safeExpectedInstanceId === safeCurrentInstanceId
      && (!safeExpectedLaunchEpoch || safeExpectedLaunchEpoch === safeCurrentLaunchEpoch),
  );
  const expectedBackendCloseState = Boolean(
    backendAlreadyClosed && ["closed", "exited"].includes(safeTerminalState),
  );
  const instanceCurrent = Boolean(
    !terminalClosing
      && identityCurrent
      && (
        expectedBackendCloseState
        || !["blocked", "closed", "error", "exited"].includes(safeTerminalState)
      ),
  );
  const closeRejected = closeSucceeded === false;
  const freshSession = Boolean(
    requestedFreshSession
      || providerSessionExists !== true
      || !instanceCurrent
      || closeRejected,
  );

  return {
    close_existing: instanceCurrent && !backendAlreadyClosed && closeSucceeded == null,
    fresh_session: freshSession,
    instance_current: instanceCurrent,
    open_terminal: true,
  };
}

export async function probeTerminalSessionForRestart(
  probe,
  explicitCloseRequested = () => false,
) {
  const providerSessionExists = await probe() === true;
  return {
    explicit_close_requested: Boolean(explicitCloseRequested()),
    provider_session_exists: providerSessionExists,
  };
}

export function resolveTerminalStartedSessionBinding({
  forkFromProviderSessionId = "",
  paneResult = {},
  provider = "",
  requestedProviderSessionId = "",
} = {}) {
  const forkSessionId = String(forkFromProviderSessionId || "").trim();
  const requestedSessionId = String(requestedProviderSessionId || "").trim();
  const backendReportedEffectiveSession = Object.prototype.hasOwnProperty.call(
    paneResult || {},
    "effective_provider_session_id",
  );
  const effectiveSessionId = String(
    paneResult?.effective_provider_session_id || "",
  ).trim();
  const suppressOpenCodeAliasSession = String(provider || "").trim().toLowerCase() === "opencode"
    && requestedSessionId
    && !requestedSessionId.startsWith("ses_");
  const providerSessionId = forkSessionId || suppressOpenCodeAliasSession
    ? ""
    : backendReportedEffectiveSession
      ? effectiveSessionId
      : requestedSessionId;
  const providerSessionIdCleared = Boolean(
    forkSessionId
      || suppressOpenCodeAliasSession
      || (requestedSessionId && backendReportedEffectiveSession && !effectiveSessionId),
  );

  return {
    provider_session_id: providerSessionId,
    provider_session_id_cleared: providerSessionIdCleared,
  };
}

export function getTerminalRestartMenuActions(roleOptions = [], {
  currentRoleId = "",
  hasProviderSession = false,
} = {}) {
  const safeCurrentRoleId = normalizeTerminalSessionRestartRole(currentRoleId);
  return roleOptions.flatMap((option) => {
    const roleId = normalizeTerminalSessionRestartRole(option?.id);
    if (!roleId) {
      return [];
    }
    const label = String(option?.label || roleId).trim() || roleId;
    if (hasProviderSession && roleId === safeCurrentRoleId) {
      return [
        {
          fresh_session: false,
          id: `${roleId}:with-session`,
          label: "Restart with session",
          role_id: roleId,
          role_label: label,
        },
        {
          fresh_session: true,
          id: `${roleId}:fresh`,
          label: "Restart fresh",
          role_id: roleId,
          role_label: label,
        },
      ];
    }
    return [{
      fresh_session: true,
      id: `${roleId}:restart`,
      label: roleId === safeCurrentRoleId ? "Restart" : label,
      role_id: roleId,
      role_label: label,
    }];
  });
}

export function terminalSessionRestartRemoteTimeoutMs(deadlineMs) {
  const normalizedDeadline = Number.isFinite(Number(deadlineMs)) && Number(deadlineMs) > 0
    ? Number(deadlineMs)
    : TERMINAL_SESSION_RESTART_DEFAULT_DEADLINE_MS;
  return normalizedDeadline
    + TERMINAL_SESSION_RESTART_REPLACEMENT_OPEN_TIMEOUT_MS
    + TERMINAL_SESSION_RESTART_REMOTE_SETTLE_BUFFER_MS;
}

export function terminalSessionRestartClearedResult(detail = {}, context = {}) {
  return {
    coordinator_id: detail.coordinator_id,
    fresh_session: detail.fresh_session !== false,
    instance_id: detail.instance_id,
    launch_epoch: detail.launch_epoch,
    message: "Queued restart was superseded by another terminal lifecycle action.",
    mode: detail.mode,
    pane_id: context.pane_id || detail.pane_id || "",
    provider_session_id: String(detail.provider_session_id || "").trim(),
    restart_intent_seq: detail.restart_intent_seq,
    role: detail.target_role,
    status: "superseded",
    superseded: true,
    terminal_index: context.terminal_index,
    workspace_id: context.workspace_id || "",
  };
}

export function terminalSessionRestartReadyRequest(detail = {}, context = {}) {
  return {
    backend_already_closed: true,
    coordinator_id: detail.coordinator_id,
    fresh_session: detail.fresh_session !== false,
    instance_id: detail.instance_id,
    launch_epoch: detail.launch_epoch,
    mode: TERMINAL_SESSION_RESTART_MODES.NOW,
    pane_id: context.pane_id || detail.pane_id || "",
    provider_session_id: String(detail.provider_session_id || "").trim(),
    role: detail.target_role,
    terminal_index: context.terminal_index,
    workspace_id: context.workspace_id || "",
  };
}

export function terminalSessionRestartResultIsSuccessful(result = {}) {
  return ["completed", "superseded"].includes(String(result.status || ""));
}

export function createTerminalSessionRestartCoordinatorId(prefix = "restart") {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${String(prefix || "restart").trim() || "restart"}-${suffix}`;
}

export function emitTerminalSessionRestartResult(detail = {}) {
  window.dispatchEvent(new CustomEvent(TERMINAL_SESSION_RESTART_RESULT_EVENT, {
    detail: {
      contract: "diffforge.terminal_session_restart.v1",
      ...detail,
    },
  }));
}

export function requestTerminalSessionRestart(detail = {}, options = {}) {
  const coordinatorId = String(detail.coordinator_id || "").trim()
    || createTerminalSessionRestartCoordinatorId(options.coordinatorPrefix);
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs) || 180_000);

  return new Promise((resolve, reject) => {
    let timer = 0;
    const finish = (callback, value) => {
      window.clearTimeout(timer);
      window.removeEventListener(TERMINAL_SESSION_RESTART_RESULT_EVENT, handleResult);
      callback(value);
    };
    const handleResult = (event) => {
      const result = event?.detail || {};
      if (String(result.coordinator_id || "") !== coordinatorId) {
        return;
      }
      options.onStatus?.(result);
      if (["queued", "running"].includes(String(result.status || ""))) {
        if (result.status === "queued" && options.resolveOnQueued) {
          finish(resolve, result);
        }
        return;
      }
      finish(resolve, result);
    };

    window.addEventListener(TERMINAL_SESSION_RESTART_RESULT_EVENT, handleResult);
    timer = window.setTimeout(() => {
      finish(reject, new Error("Timed out waiting for the replacement terminal session to open."));
    }, timeoutMs);
    window.dispatchEvent(new CustomEvent(TERMINAL_SESSION_RESTART_REQUEST_EVENT, {
      detail: {
        contract: "diffforge.terminal_session_restart.v1",
        fresh_session: true,
        ...detail,
        coordinator_id: coordinatorId,
        mode: normalizeTerminalSessionRestartMode(detail.mode),
        role: normalizeTerminalSessionRestartRole(detail.role),
      },
    }));
  });
}

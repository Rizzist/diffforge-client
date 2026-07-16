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
  providerSessionOverride = "",
  threadProviderSessionId = "",
} = {}) {
  const freshSession = Boolean(forceFreshSession);
  const forkSessionId = freshSession ? "" : String(forkFromProviderSessionId || "").trim();
  return {
    fresh_session: freshSession,
    fork_from_provider_session_id: forkSessionId,
    provider_session_id: freshSession || forkSessionId
      ? ""
      : String(providerSessionOverride || threadProviderSessionId || "").trim(),
  };
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
    fresh_session: true,
    instance_id: detail.instance_id,
    launch_epoch: detail.launch_epoch,
    message: "Queued restart was superseded by another terminal lifecycle action.",
    mode: detail.mode,
    pane_id: context.pane_id || detail.pane_id || "",
    restart_intent_seq: detail.restart_intent_seq,
    role: detail.target_role,
    status: "superseded",
    superseded: true,
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

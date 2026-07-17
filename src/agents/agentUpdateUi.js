export const AGENT_UPDATE_QUEUE_TIMEOUT_MS = 60_000;

const UPDATE_STAGES = new Set([
  "available",
  "queued",
  "downloading",
  "installing",
  "verifying",
  "complete",
  "failed",
]);

export function agentUpdateMessageLooksPermissionDenied(value) {
  const message = String(value || "").toLowerCase();
  return [
    "eacces",
    "eperm",
    "permission denied",
    "access is denied",
    "operation not permitted",
    "requires elevation",
    "administrator",
  ].some((needle) => message.includes(needle));
}

export function agentUpdateResultSucceeded(result) {
  return Boolean(
    result?.ok === true
    && result?.updated === true
    && String(result?.installed_version || "").trim(),
  );
}

export function agentPackageResultSucceeded(result) {
  if (!result) {
    return false;
  }
  if (result.source === "npm-update") {
    return agentUpdateResultSucceeded(result);
  }
  if (result.source === "npm") {
    return result.ok === true && result.installed === true;
  }
  return result.ok === true;
}

export function agentUpdateCanRetryAsAdministrator(result, isWindows) {
  return Boolean(
    isWindows
    && result?.source === "npm-update"
    && result?.remote !== true
    && result?.ok !== true
    && result?.permission_denied === true,
  );
}

export function normalizeAgentUpdateProgress(payload = {}) {
  const provider = String(payload?.provider || payload?.progress?.provider || "")
    .trim()
    .toLowerCase();
  const stage = String(payload?.stage || payload?.progress?.stage || "")
    .trim()
    .toLowerCase();
  if (!provider || !UPDATE_STAGES.has(stage)) {
    return null;
  }
  return {
    provider,
    stage,
    stage_seq: Number(payload?.stage_seq ?? payload?.progress?.stage_seq) || 0,
    from_version: String(payload?.from_version ?? payload?.progress?.from_version ?? "").trim(),
    to_version: String(payload?.to_version ?? payload?.progress?.to_version ?? "").trim(),
    error_reason: String(payload?.error_reason ?? payload?.progress?.error_reason ?? "").trim(),
    failed_stage: String(payload?.failed_stage ?? payload?.progress?.failed_stage ?? "").trim(),
  };
}

export function agentUpdateProgressMessage(progress, label = "Agent") {
  const toVersion = String(progress?.to_version || "").trim();
  switch (progress?.stage) {
    case "available":
      return `Preparing ${label} update${toVersion ? ` to ${toVersion}` : ""}…`;
    case "queued":
      return `Queued — waiting for active ${label} terminals to close. This wait cancels automatically after ${Math.round(AGENT_UPDATE_QUEUE_TIMEOUT_MS / 1_000)} seconds.`;
    case "downloading":
      return `Downloading — ${label} update${toVersion ? ` ${toVersion}` : ""}…`;
    case "installing":
      return `Installing — applying the ${label} update…`;
    case "verifying":
      return `Verifying — checking the installed ${label} version…`;
    case "complete":
      return `${label} update finished${toVersion ? ` at version ${toVersion}` : ""}.`;
    case "failed": {
      const failedAt = progress?.failed_stage ? ` during ${progress.failed_stage}` : "";
      return progress?.error_reason
        ? `Failed — ${progress.error_reason}`
        : `Failed — ${label} update failed${failedAt}.`;
    }
    default:
      return "";
  }
}

export function agentUpdateProgressIsBusy(progress) {
  return ["available", "queued", "downloading", "installing", "verifying"].includes(progress?.stage);
}

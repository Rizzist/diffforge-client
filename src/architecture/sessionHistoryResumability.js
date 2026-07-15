export const CLAUDE_RESUME_UNAVAILABLE_MESSAGE =
  "This Claude session was created on another device and isn't available to resume here.";

function normalizedSessionHistoryAgent(item) {
  const value = `${item?.agent_id || ""} ${item?.provider || ""}`.trim().toLowerCase();
  if (value.includes("claude")) return "claude";
  if (value.includes("opencode") || value.includes("open-code")) return "opencode";
  if (value.includes("codex")) return "codex";
  return value;
}

export function invalidateClaudeSessionHistoryResumability(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (normalizedSessionHistoryAgent(item) !== "claude") return item;
    return {
      ...item,
      resumable: false,
      resume_unavailable_reason: CLAUDE_RESUME_UNAVAILABLE_MESSAGE,
    };
  });
}

export function getSessionHistoryResumeAvailability(item, providerSessionId = "") {
  const sessionId = String(providerSessionId || "").trim();
  if (!sessionId) {
    return {
      canOpen: false,
      label: "Unavailable",
      reason: "No provider session id was recorded.",
      remoteOnly: false,
    };
  }

  if (normalizedSessionHistoryAgent(item) !== "claude") {
    return {
      canOpen: true,
      label: "Open",
      reason: "Open this session in a terminal",
      remoteOnly: false,
    };
  }

  if (item?.resumable === true) {
    return {
      canOpen: true,
      label: "Open",
      reason: "Open this local Claude session in a terminal",
      remoteOnly: false,
    };
  }

  return {
    canOpen: false,
    label: "Not on this device",
    reason: String(item?.resume_unavailable_reason || "").trim()
      || CLAUDE_RESUME_UNAVAILABLE_MESSAGE,
    remoteOnly: true,
  };
}

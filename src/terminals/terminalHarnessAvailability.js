const LEGACY_HARNESS_LABELS = Object.freeze({
  claude: "Claude Code",
  codex: "Codex",
  grok: "grok-cli",
  kimi: "Kimi",
  opencode: "OpenCode",
});

export function normalizeTerminalHarnessId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  if (["terminal", "shell", "plain-shell", "generic-shell", "generic"].includes(normalized)) {
    return "generic";
  }
  if (["haider", "haider-agent"].includes(normalized)) return "haider";
  if (["claude", "claude-code", "claudecode"].includes(normalized)) return "claude";
  if (["codex", "openai-codex"].includes(normalized)) return "codex";
  if (["opencode", "open-code", "opencode-ai", "open-code-ai"].includes(normalized)) return "opencode";
  if (["grok", "grok-cli"].includes(normalized)) return "grok";
  if (["kimi", "kimi-cli"].includes(normalized)) return "kimi";
  return normalized;
}

export function terminalHarnessPresentation(value, publishedAvailability = null) {
  const id = normalizeTerminalHarnessId(value);
  if (id === "generic") {
    return {
      availability: "available",
      id,
      label: "Terminal",
      reason: "",
      selectable: true,
    };
  }
  if (Object.hasOwn(LEGACY_HARNESS_LABELS, id)) {
    return {
      availability: "unavailable",
      id,
      label: LEGACY_HARNESS_LABELS[id],
      reason: "This legacy harness is no longer supported by DiffForge.",
      selectable: false,
    };
  }
  if (id === "haider") {
    const state = ["available", "unavailable", "unknown"].includes(publishedAvailability?.state)
      ? publishedAvailability.state
      : "unknown";
    return {
      availability: state,
      id,
      label: "Haider",
      reason: state === "unavailable" ? String(publishedAvailability?.reason || "") : "",
      selectable: state !== "unavailable",
    };
  }
  return {
    availability: "unknown",
    id,
    label: String(value || "Unknown harness").trim() || "Unknown harness",
    reason: "No harness availability was published.",
    selectable: false,
  };
}

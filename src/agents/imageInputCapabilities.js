const IMAGE_INPUT_SUPPORTED = "supported";
const IMAGE_INPUT_UNSUPPORTED = "unsupported";
const IMAGE_INPUT_UNKNOWN = "unknown";

const CODEX_IMAGE_INPUT_MODELS = new Map([
  ["gpt-5.5", IMAGE_INPUT_UNKNOWN],
  ["gpt-5.4", IMAGE_INPUT_UNKNOWN],
  ["gpt-5.3-codex-spark", IMAGE_INPUT_UNSUPPORTED],
  ["gpt-5.2", IMAGE_INPUT_SUPPORTED],
  ["gpt-5.1", IMAGE_INPUT_SUPPORTED],
  ["gpt-5", IMAGE_INPUT_SUPPORTED],
  ["gpt-5-mini", IMAGE_INPUT_SUPPORTED],
  ["gpt-5-nano", IMAGE_INPUT_SUPPORTED],
  ["gpt-4.1", IMAGE_INPUT_SUPPORTED],
  ["gpt-4.1-mini", IMAGE_INPUT_SUPPORTED],
  ["gpt-4.1-nano", IMAGE_INPUT_SUPPORTED],
  ["gpt-4o", IMAGE_INPUT_SUPPORTED],
  ["gpt-4o-mini", IMAGE_INPUT_SUPPORTED],
  ["codex-mini-latest", IMAGE_INPUT_UNSUPPORTED],
  ["gpt-5.1-codex-mini", IMAGE_INPUT_UNSUPPORTED],
  ["gpt-3.5-turbo", IMAGE_INPUT_UNSUPPORTED],
  ["gpt-oss-120b", IMAGE_INPUT_UNSUPPORTED],
  ["gpt-oss-20b", IMAGE_INPUT_UNSUPPORTED],
  ["o1-mini", IMAGE_INPUT_UNSUPPORTED],
  ["o3-mini", IMAGE_INPUT_UNSUPPORTED],
]);

const CLAUDE_IMAGE_INPUT_MODELS = new Map([
  ["opus", IMAGE_INPUT_SUPPORTED],
  ["sonnet", IMAGE_INPUT_SUPPORTED],
  ["haiku", IMAGE_INPUT_SUPPORTED],
  ["claude-opus-4-1", IMAGE_INPUT_SUPPORTED],
  ["claude-opus-4-1-20250805", IMAGE_INPUT_SUPPORTED],
  ["claude-opus-4", IMAGE_INPUT_SUPPORTED],
  ["claude-opus-4-20250514", IMAGE_INPUT_SUPPORTED],
  ["claude-sonnet-4", IMAGE_INPUT_SUPPORTED],
  ["claude-sonnet-4-20250514", IMAGE_INPUT_SUPPORTED],
  ["claude-3-7-sonnet-latest", IMAGE_INPUT_SUPPORTED],
  ["claude-3-7-sonnet-20250219", IMAGE_INPUT_SUPPORTED],
  ["claude-3-5-haiku-latest", IMAGE_INPUT_SUPPORTED],
  ["claude-3-5-haiku-20241022", IMAGE_INPUT_SUPPORTED],
  ["claude-3-haiku-20240307", IMAGE_INPUT_SUPPORTED],
  ["claude-2", IMAGE_INPUT_UNSUPPORTED],
  ["claude-2.0", IMAGE_INPUT_UNSUPPORTED],
  ["claude-2.1", IMAGE_INPUT_UNSUPPORTED],
  ["claude-instant", IMAGE_INPUT_UNSUPPORTED],
]);

function normalizeCapabilityAgentId(value) {
  const agentId = String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");

  if (agentId.includes("claude")) {
    return "claude";
  }

  if (agentId.includes("opencode") || agentId.includes("open-code")) {
    return "opencode";
  }

  if (agentId.includes("codex")) {
    return "codex";
  }

  return agentId;
}

function normalizeModelId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^openai\//, "")
    .replace(/^anthropic\//, "");
}

function lookupCodexImageInputState(model) {
  const normalized = normalizeModelId(model);
  if (!normalized) {
    return IMAGE_INPUT_UNKNOWN;
  }

  if (CODEX_IMAGE_INPUT_MODELS.has(normalized)) {
    return CODEX_IMAGE_INPUT_MODELS.get(normalized);
  }

  if (normalized.includes("codex-spark") || normalized.includes("codex-mini")) {
    return IMAGE_INPUT_UNSUPPORTED;
  }

  if (normalized.startsWith("gpt-4o") || normalized.startsWith("gpt-4.1")) {
    return IMAGE_INPUT_SUPPORTED;
  }

  if (normalized === "gpt-5" || normalized.startsWith("gpt-5.1") || normalized.startsWith("gpt-5.2")) {
    return IMAGE_INPUT_SUPPORTED;
  }

  if (
    normalized.startsWith("gpt-3.5")
    || normalized.startsWith("gpt-oss")
    || normalized === "o1-mini"
    || normalized === "o3-mini"
  ) {
    return IMAGE_INPUT_UNSUPPORTED;
  }

  return IMAGE_INPUT_UNKNOWN;
}

function lookupClaudeImageInputState(model) {
  const normalized = normalizeModelId(model);
  if (!normalized) {
    return IMAGE_INPUT_UNKNOWN;
  }

  if (CLAUDE_IMAGE_INPUT_MODELS.has(normalized)) {
    return CLAUDE_IMAGE_INPUT_MODELS.get(normalized);
  }

  if (normalized.startsWith("claude-3") || normalized.startsWith("claude-4")) {
    return IMAGE_INPUT_SUPPORTED;
  }

  if (
    normalized.startsWith("claude-1")
    || normalized.startsWith("claude-v1")
    || normalized.startsWith("claude-2")
    || normalized.startsWith("claude-v2")
    || normalized.includes("instant")
  ) {
    return IMAGE_INPUT_UNSUPPORTED;
  }

  return IMAGE_INPUT_UNKNOWN;
}

function buildCapabilityResult({ activeModel, agentId, agentLabel, state }) {
  const label = agentLabel || agentId || "This agent";
  const modelLabel = activeModel || "the selected model";

  if (state === IMAGE_INPUT_SUPPORTED) {
    return {
      activeModel,
      reason: `${label} image input is supported for ${modelLabel}.`,
      state,
      supported: true,
    };
  }

  if (state === IMAGE_INPUT_UNSUPPORTED) {
    return {
      activeModel,
      reason: `${label} image input is not supported for ${modelLabel}.`,
      state,
      supported: false,
    };
  }

  return {
    activeModel,
    reason: activeModel
      ? `${label} image input support is unknown for ${activeModel}.`
      : `${label} image input depends on the selected model.`,
    state: IMAGE_INPUT_UNKNOWN,
    supported: false,
  };
}

export function getAgentModelImageInputCapability(agentId, model, options = {}) {
  const normalizedAgentId = normalizeCapabilityAgentId(agentId);
  const activeModel = normalizeModelId(model);
  const agentLabel = options.agentLabel || (
    normalizedAgentId === "claude"
      ? "Claude"
      : normalizedAgentId === "codex"
        ? "Codex"
        : normalizedAgentId === "opencode"
          ? "OpenCode"
          : "This agent"
  );

  if (normalizedAgentId === "opencode") {
    return {
      activeModel,
      reason: "OpenCode image upload is disabled for now.",
      state: IMAGE_INPUT_UNSUPPORTED,
      supported: false,
    };
  }

  if (normalizedAgentId === "codex") {
    return buildCapabilityResult({
      activeModel,
      agentId: normalizedAgentId,
      agentLabel,
      state: lookupCodexImageInputState(activeModel),
    });
  }

  if (normalizedAgentId === "claude") {
    return buildCapabilityResult({
      activeModel,
      agentId: normalizedAgentId,
      agentLabel,
      state: lookupClaudeImageInputState(activeModel),
    });
  }

  return {
    activeModel,
    reason: "This terminal does not accept image input.",
    state: IMAGE_INPUT_UNSUPPORTED,
    supported: false,
  };
}


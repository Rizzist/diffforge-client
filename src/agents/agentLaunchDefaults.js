export const AGENT_LAUNCH_DEFAULTS_STORAGE_VERSION = 1;

export const AGENT_LAUNCH_MODEL_OPTIONS = Object.freeze({
  claude: Object.freeze([
    { detail: "Balanced Claude Code default", label: "Sonnet", value: "sonnet" },
    { detail: "Higher capability Claude model", label: "Opus", speed_modes: ["standard", "fast"], value: "opus" },
    { detail: "Lower-latency Claude model", label: "Haiku", value: "haiku" },
    { detail: "Latest Claude alias when available", label: "Fable", value: "fable" },
  ]),
  codex: Object.freeze([
    { detail: "Latest Codex model", label: "GPT-5.5", speed_modes: ["standard", "fast"], thinking_power: "medium", value: "gpt-5.5" },
    { detail: "Balanced coding model", label: "GPT-5.4", speed_modes: ["standard", "fast"], thinking_power: "medium", value: "gpt-5.4" },
    { detail: "Faster lower-cost coding model", label: "GPT-5.4 mini", thinking_power: "medium", value: "gpt-5.4-mini" },
    { detail: "Research preview quick coding model", label: "Codex Spark", speed: "fast", thinking_power: "high", value: "gpt-5.3-codex-spark" },
  ]),
  opencode: Object.freeze([
    { detail: "OpenAI model through OpenCode", label: "GPT-5.5", value: "openai/gpt-5.5" },
    { detail: "OpenAI mini model through OpenCode", label: "GPT-5.4 mini", value: "openai/gpt-5.4-mini" },
    { detail: "Anthropic model through OpenCode", label: "Claude Sonnet", value: "anthropic/claude-sonnet-4-5" },
    { detail: "Google model through OpenCode", label: "Gemini 2.5 Pro", value: "google/gemini-2.5-pro" },
  ]),
});

export const BUILTIN_AGENT_LAUNCH_DEFAULTS = Object.freeze({
  claude: Object.freeze({ effort: "default", model: "sonnet", speed: "standard" }),
  codex: Object.freeze({ effort: "medium", model: "gpt-5.5", speed: "standard" }),
  opencode: Object.freeze({ effort: "default", model: "anthropic/claude-sonnet-4-5", speed: "standard" }),
});

const AGENT_LAUNCH_EFFORT_OPTIONS = Object.freeze({
  claude: Object.freeze([
    { label: "Default", value: "default" },
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" },
    { label: "XHigh", value: "xhigh" },
    { label: "Max", value: "max" },
  ]),
  codex: Object.freeze([
    { label: "Low", value: "low" },
    { label: "Medium", value: "medium" },
    { label: "High", value: "high" },
    { label: "XHigh", value: "xhigh" },
  ]),
  opencode: Object.freeze([
    { label: "Provider default", value: "default" },
  ]),
});

const AGENT_LAUNCH_SPEED_OPTIONS = Object.freeze({
  standard: Object.freeze({ label: "Standard", value: "standard" }),
  fast: Object.freeze({ label: "Fast", value: "fast" }),
});

function agentLaunchEffortLabel(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.toLowerCase() === "xhigh") return "XHigh";
  return text
    .split(/[-_\s]+/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

export function normalizeAgentLaunchAgentId(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (normalized === "codex" || normalized === "openai-codex") {
    return "codex";
  }
  if (normalized === "claude" || normalized === "claude-code" || normalized === "claudecode") {
    return "claude";
  }
  if (normalized === "opencode" || normalized === "open-code" || normalized === "open-code-ai" || normalized === "opencode-ai") {
    return "opencode";
  }
  return "";
}

export function isValidAgentLaunchModelId(value) {
  const model = String(value || "").trim();
  return Boolean(
    model
      && model.length <= 120
      && /^[A-Za-z0-9._:/-]+$/.test(model),
  );
}

export function cleanAgentLaunchModelId(value, fallback = "") {
  const model = String(value || "").trim();
  return isValidAgentLaunchModelId(model) ? model : String(fallback || "").trim();
}

export function getAgentLaunchModelOptions(agentId, modelCatalog = null) {
  return getMergedAgentLaunchModelOptions(agentId, modelCatalog);
}

function normalizeAgentLaunchCatalogModelOption(agentId, entry) {
  if (!entry || typeof entry !== "object") return null;
  const normalizedAgentId = normalizeAgentLaunchAgentId(agentId);
  const entryAgentId = normalizeAgentLaunchAgentId(entry.agent_kind || entry.agentKind || normalizedAgentId);
  if (!normalizedAgentId || entryAgentId !== normalizedAgentId) return null;
  if (entry.hidden || entry.deprecated) return null;
  const value = cleanAgentLaunchModelId(entry.id ?? entry.model_id ?? entry.value ?? "");
  if (!value) return null;
  const label = String(entry.display_name || entry.displayName || entry.label || value).trim() || value;
  const detail = String(entry.description || entry.detail || "").trim();
  const speedModes = Array.isArray(entry.speed_modes)
    ? entry.speed_modes.map((mode) => String(mode || "").trim()).filter(Boolean)
    : Array.isArray(entry.speedModes)
      ? entry.speedModes.map((mode) => String(mode || "").trim()).filter(Boolean)
      : null;
  return {
    ...(detail ? { detail } : {}),
    ...(speedModes?.length ? { speed_modes: speedModes } : {}),
    label,
    source: entry.source || "harness_api",
    value,
  };
}

export function getMergedAgentLaunchModelOptions(agentId, modelCatalog = null) {
  const normalizedAgentId = normalizeAgentLaunchAgentId(agentId);
  const baseline = AGENT_LAUNCH_MODEL_OPTIONS[normalizedAgentId] || [];
  const catalogModels = Array.isArray(modelCatalog?.models) ? modelCatalog.models : [];
  const seen = new Set();
  const merged = [];
  catalogModels
    .map((entry) => normalizeAgentLaunchCatalogModelOption(normalizedAgentId, entry))
    .filter(Boolean)
    .forEach((option) => {
      if (seen.has(option.value)) return;
      seen.add(option.value);
      merged.push(option);
    });
  baseline.forEach((option) => {
    if (!option?.value || seen.has(option.value)) return;
    seen.add(option.value);
    merged.push(option);
  });
  return merged;
}

export function getAgentLaunchModelOption(agentId, model, modelCatalog = null) {
  const safeModel = String(model || "").trim();
  if (!safeModel) {
    return null;
  }
  return getMergedAgentLaunchModelOptions(agentId, modelCatalog).find((option) => option.value === safeModel) || null;
}

export function getAgentLaunchCatalogModelEntry(agentId, model, modelCatalog = null) {
  const normalizedAgentId = normalizeAgentLaunchAgentId(agentId);
  const safeModel = String(model || "").trim();
  if (!normalizedAgentId || !safeModel) return null;
  const catalogModels = Array.isArray(modelCatalog?.models) ? modelCatalog.models : [];
  return catalogModels.find((entry) => {
    if (!entry || typeof entry !== "object" || entry.hidden || entry.deprecated) return false;
    const entryAgentId = normalizeAgentLaunchAgentId(entry.agent_kind || entry.agentKind || normalizedAgentId);
    const entryModel = String(entry.id ?? entry.model_id ?? entry.value ?? "").trim();
    return entryAgentId === normalizedAgentId && entryModel === safeModel;
  }) || null;
}

export function getAgentLaunchCatalogReasoningEfforts(agentId, model, modelCatalog = null) {
  const entry = getAgentLaunchCatalogModelEntry(agentId, model, modelCatalog);
  const rawEfforts = Array.isArray(entry?.reasoning_efforts)
    ? entry.reasoning_efforts
    : Array.isArray(entry?.reasoningEfforts)
      ? entry.reasoningEfforts
      : Array.isArray(entry?.reasoning_options)
        ? entry.reasoning_options
        : Array.isArray(entry?.reasoningOptions)
          ? entry.reasoningOptions
          : [];
  const seen = new Set();
  return rawEfforts
    .map((effort) => String(effort || "").trim().toLowerCase())
    .filter((effort) => {
      if (!effort || seen.has(effort)) return false;
      seen.add(effort);
      return true;
    });
}

export function agentLaunchModelSupportsFast(agentId, model, modelCatalog = null) {
  const normalizedAgentId = normalizeAgentLaunchAgentId(agentId);
  const normalizedModel = String(model || "").trim().toLowerCase();
  const option = getAgentLaunchModelOption(normalizedAgentId, model, modelCatalog);

  if (Array.isArray(option?.speed_modes) && option.speed_modes.includes("fast")) {
    return true;
  }
  if (normalizedAgentId === "codex") {
    return normalizedModel === "gpt-5.5" || normalizedModel === "gpt-5.4";
  }
  if (normalizedAgentId === "claude") {
    return normalizedModel === "opus" || normalizedModel.includes("opus");
  }
  return false;
}

export function getAgentLaunchEffortOptions(agentId, model = "", modelCatalog = null) {
  const catalogEfforts = getAgentLaunchCatalogReasoningEfforts(agentId, model, modelCatalog);
  if (catalogEfforts.length) {
    return catalogEfforts.map((effort) => ({
      label: agentLaunchEffortLabel(effort),
      value: effort,
    }));
  }
  return AGENT_LAUNCH_EFFORT_OPTIONS[normalizeAgentLaunchAgentId(agentId)] || [];
}

export function getAgentLaunchSpeedOptions(agentId, model = "", modelCatalog = null) {
  const options = [AGENT_LAUNCH_SPEED_OPTIONS.standard];
  if (agentLaunchModelSupportsFast(agentId, model, modelCatalog)) {
    options.push(AGENT_LAUNCH_SPEED_OPTIONS.fast);
  }
  return options;
}

export function normalizeAgentLaunchEffort(agentId, model, effort, modelCatalog = null) {
  const normalizedAgentId = normalizeAgentLaunchAgentId(agentId);
  const safeEffort = String(effort || "").trim().toLowerCase();
  const options = getAgentLaunchEffortOptions(normalizedAgentId, model, modelCatalog).map((option) => option.value);

  if (safeEffort && options.includes(safeEffort)) {
    return safeEffort;
  }

  return BUILTIN_AGENT_LAUNCH_DEFAULTS[normalizedAgentId]?.effort || "default";
}

export function normalizeAgentLaunchSpeed(agentId, model, speed, modelCatalog = null) {
  const safeSpeed = String(speed || "").trim().toLowerCase();
  if (safeSpeed === "fast" && agentLaunchModelSupportsFast(agentId, model, modelCatalog)) {
    return "fast";
  }
  return "standard";
}

export function normalizeAgentLaunchDefault(agentId, value = {}) {
  const normalizedAgentId = normalizeAgentLaunchAgentId(agentId);
  const builtin = BUILTIN_AGENT_LAUNCH_DEFAULTS[normalizedAgentId] || {};
  const rawModel = value?.model ?? value?.model_id ?? value?.defaultModel ?? "";
  const model = cleanAgentLaunchModelId(rawModel, builtin.model || "");

  return {
    effort: normalizeAgentLaunchEffort(
      normalizedAgentId,
      model,
      value?.effort ?? value?.reasoning_effort ?? value?.thinking_power ?? builtin.effort,
    ),
    model,
    speed: normalizeAgentLaunchSpeed(normalizedAgentId, model, value?.speed ?? builtin.speed),
  };
}

export function normalizeAgentLaunchDefaults(value = {}) {
  const rawProviders = value?.providers && typeof value.providers === "object"
    ? value.providers
    : value;
  const providers = {};

  Object.keys(BUILTIN_AGENT_LAUNCH_DEFAULTS).forEach((agentId) => {
    providers[agentId] = normalizeAgentLaunchDefault(agentId, rawProviders?.[agentId]);
  });

  return {
    providers,
    version: AGENT_LAUNCH_DEFAULTS_STORAGE_VERSION,
  };
}

export function getAgentLaunchDefault(agentId, defaults = null) {
  const normalizedAgentId = normalizeAgentLaunchAgentId(agentId);
  const normalizedDefaults = defaults?.version === AGENT_LAUNCH_DEFAULTS_STORAGE_VERSION
    && defaults?.providers
    ? defaults
    : normalizeAgentLaunchDefaults(defaults || {});
  return normalizeAgentLaunchDefault(
    normalizedAgentId,
    normalizedDefaults.providers?.[normalizedAgentId],
  );
}

export function resolveAgentLaunchDefaultForModel(agentId, defaults = null, model = "") {
  const base = getAgentLaunchDefault(agentId, defaults);
  const resolvedModel = cleanAgentLaunchModelId(model, base.model);
  return {
    effort: normalizeAgentLaunchEffort(agentId, resolvedModel, base.effort),
    model: resolvedModel,
    speed: normalizeAgentLaunchSpeed(agentId, resolvedModel, base.speed),
  };
}

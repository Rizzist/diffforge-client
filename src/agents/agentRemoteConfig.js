import { normalizeAgentLaunchAgentId } from "./agentLaunchDefaults.js";

const REMOTE_AGENT_MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const REMOTE_AGENT_EFFORT_PATTERN = /^[A-Za-z0-9_-]+$/;

export function normalizeAgentRemoteConfigEffortValues(values = []) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
}

export function buildAgentChatChangeEffortCommand({
  currentModel = "",
  effortValues = [],
  provider = "",
  requestedEffort = "",
} = {}) {
  const normalizedProvider = normalizeAgentLaunchAgentId(provider);
  const effort = String(requestedEffort || "").trim().toLowerCase();
  const validEfforts = new Set(normalizeAgentRemoteConfigEffortValues(effortValues));
  const effortIsKnown = validEfforts.has(effort);

  if (!["codex", "claude"].includes(normalizedProvider)) {
    return { error: "Remote model configuration requires a supported provider." };
  }
  if (!effort || effort.length > 40 || !REMOTE_AGENT_EFFORT_PATTERN.test(effort)) {
    return { error: `Remote effort change included an invalid ${normalizedProvider} reasoning_effort.` };
  }
  if (normalizedProvider === "claude") {
    return {
      awaitingDetection: !effortIsKnown,
      command: `/effort ${effort}`,
      model_id: String(currentModel || "").trim(),
      recordModelId: "",
      recordReasoningEffort: effortIsKnown ? effort : "",
      reasoning_effort: effort,
    };
  }

  const model = String(currentModel || "").trim();
  if (!model || model.length > 160 || !REMOTE_AGENT_MODEL_ID_PATTERN.test(model)) {
    return { error: "Codex effort changes require the current model_id." };
  }
  return {
    awaitingDetection: true,
    command: "/model",
    model_id: model,
    picker_model: model,
    picker_effort: effort,
    recordModelId: "",
    recordReasoningEffort: "",
    reasoning_effort: effort,
  };
}

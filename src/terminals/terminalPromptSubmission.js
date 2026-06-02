export const TERMINAL_AUTHORITATIVE_PROMPT_SUBMITTED_SOURCES = Object.freeze([
  "observed_input_gate",
  "parked_resume_backend_submit",
]);

export function terminalPromptSubmittedPayloadIsAuthoritative(payload = {}) {
  const promptSource = String(payload?.promptSource || "").trim();
  const promptMatch = payload?.promptMatch !== false;
  if (!promptMatch) {
    return false;
  }

  if (promptSource === "observed_input_gate") {
    return String(payload?.observedPrompt || "").trim().length > 0;
  }

  return promptSource === "parked_resume_backend_submit";
}

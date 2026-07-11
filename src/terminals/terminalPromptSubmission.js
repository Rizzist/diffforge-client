export function terminalPromptSubmittedPayloadIsAuthoritative(payload = {}) {
  const promptSource = String(payload?.prompt_source || "").trim();
  const promptMatch = payload?.prompt_match !== false;
  if (!promptMatch) {
    return false;
  }

  if (promptSource === "observed_input_gate") {
    return String(payload?.observed_prompt || "").trim().length > 0;
  }

  if (
    promptSource === "activity_hook_user_prompt_submit"
    || promptSource === "cli_hook_user_prompt_submit"
  ) {
    return String(
      payload?.prompt || payload?.observed_prompt || payload?.expected_prompt || "",
    ).trim().length > 0;
  }

  return (
    promptSource === "parked_resume_backend_submit"
    || promptSource === "crash_todo_resume_backend_submit"
    || promptSource === "todo_queue_backend_submit"
  );
}

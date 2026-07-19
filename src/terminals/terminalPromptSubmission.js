// Mirrors the Rust `terminal_prompt_is_local_slash_command` in terminals.rs:
// `^/[A-Za-z0-9_:-]+(\s|$)`. A local CLI slash command (Claude Code `/model`,
// `/clear`, Codex `/status`, OpenCode `/help`, …) is handled entirely inside
// the agent CLI: it prints a result, never calls the provider API, and never
// fires a UserPromptSubmit hook. Optimistically flipping the pane to
// "thinking" for one strands it until a watchdog because no Stop ever arrives.
// The command-shape check keeps ordinary prompts that merely contain a slash (a
// bare "/", a "/foo/bar" path) out of scope so their turn still flips to
// thinking normally. A slash command that does start a real turn (a skill that
// prompts the model) still flips via the CLI's own UserPromptSubmit/PreToolUse
// hook evidence, which arrives independently of the optimistic synthesis.
const TERMINAL_LOCAL_SLASH_COMMAND_PATTERN = /^\/[A-Za-z0-9_:-]+(\s|$)/;

export function terminalPromptIsLocalSlashCommand(prompt) {
  return TERMINAL_LOCAL_SLASH_COMMAND_PATTERN.test(String(prompt || "").trimStart());
}

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

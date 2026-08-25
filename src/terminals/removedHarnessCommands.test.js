import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const REMOVED_HARNESS_COMMANDS = [
  "agent_statuses",
  "opencode_list_models",
  "start_agent_login",
  "start_agent_account_login",
  "disconnect_agent",
  "install_agent",
  "update_agent",
  "retry_update_agent_as_administrator",
  "cancel_agent_update",
  "uninstall_agent",
  "run_forge_prompt",
  "agent_thread_turn_start",
  "terminal_start_agent",
  "terminal_start_agent_many",
  "terminal_control_automation_begin",
  "terminal_control_automation_end",
  "terminal_answer_agent_prompt_remote_command",
  "terminal_request_fork",
  "terminal_refresh_theme",
];

test("removed legacy harness commands are not registered with Tauri", () => {
  const libSource = readFileSync(
    new URL("../../src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );
  for (const command of REMOVED_HARNESS_COMMANDS) {
    assert.doesNotMatch(libSource, new RegExp(`\\b${command},`), command);
  }
});

test("terminal frontend does not invoke removed legacy harness commands", () => {
  const terminalSource = readFileSync(
    new URL("./WorkspaceTerminal/index.jsx", import.meta.url),
    "utf8",
  );
  for (const command of REMOVED_HARNESS_COMMANDS) {
    assert.doesNotMatch(
      terminalSource,
      new RegExp(`invoke\\(["']${command}["']`),
      command,
    );
  }
});

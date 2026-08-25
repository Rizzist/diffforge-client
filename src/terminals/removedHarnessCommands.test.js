import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const NEWLY_REMOVED_SESSION_COMMANDS = [
  "agent_thread_session_discover",
  "agent_thread_transcript",
  "agent_thread_transcript_watch",
];

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
  "agent_accounts_start_profile_login",
  "agent_accounts_web_login_command",
  "agent_accounts_cancel_profile_login",
  "agent_accounts_bind_login_terminal",
  "agent_accounts_reconcile_workspace_trust",
  "agent_accounts_state",
  "agent_accounts_update_display",
  "agent_accounts_set_active",
  "agent_accounts_remove",
  "agent_accounts_pane_profiles",
  "account_oauth_import",
  "account_oauth_import_sources",
  "account_device_candidates",
  "account_import_device",
  ...NEWLY_REMOVED_SESSION_COMMANDS,
];

const SHIPPED_SOURCE_EXTENSIONS = new Set(["js", "jsx", "mjs", "ts", "tsx"]);
const LITERAL_ALLOWLIST_MARKER = "removed-harness-door-literal-allowlist";

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shippedFrontendSources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    if (entry.isDirectory()) {
      return shippedFrontendSources(url);
    }
    const extension = entry.name.split(".").pop();
    if (
      !SHIPPED_SOURCE_EXTENSIONS.has(extension)
      || /\.(?:test|spec)\.[^.]+$/.test(entry.name)
    ) {
      return [];
    }
    return [url];
  });
}

test("removed legacy harness commands are not registered with Tauri", () => {
  const libSource = readFileSync(
    new URL("../../src-tauri/src/lib.rs", import.meta.url),
    "utf8",
  );
  for (const command of REMOVED_HARNESS_COMMANDS) {
    assert.doesNotMatch(
      libSource,
      new RegExp(`\\b${escapeRegExp(command)}\\b(?=\\s*(?:,|\\]))`),
      command,
    );
  }
});

test("the removed-door corpus includes every retired session transcript door", () => {
  for (const command of NEWLY_REMOVED_SESSION_COMMANDS) {
    assert.ok(REMOVED_HARNESS_COMMANDS.includes(command), command);
  }
});

test("no shipped frontend source contains a removed command as a string literal", () => {
  const sourceRoot = new URL("../", import.meta.url);
  for (const sourceUrl of shippedFrontendSources(sourceRoot)) {
    const source = readFileSync(sourceUrl, "utf8");
    source.split(/\r?\n/).forEach((line, index) => {
      if (line.includes(LITERAL_ALLOWLIST_MARKER)) {
        return;
      }
      for (const command of REMOVED_HARNESS_COMMANDS) {
        const literal = new RegExp(`(["'\`])${escapeRegExp(command)}\\1`);
        assert.doesNotMatch(
          line,
          literal,
          `${sourceUrl.pathname}:${index + 1}: ${command}`,
        );
      }
    });
  }
});

test("retired transcript observers have no inert Rust seam or live caller", () => {
  const rustSources = [
    "../../src-tauri/src/removed_session_compat.rs",
    "../../src-tauri/src/terminals.rs",
    "../../src-tauri/src/cloud_mcp.rs",
  ].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
  const removedSymbols = [
    "register_agent_thread_transcript_native_watch",
    "unregister_agent_thread_transcript_native_watch",
    "trigger_agent_thread_transcript_native_watch",
    "agent_chat_session_set_terminal_observed",
    "agent_chat_session_touch_terminal_observed",
    "agent_chat_session_clear_observed_terminal_matching",
    "agent_chat_session_clear_observed_terminals",
    "agent_chat_session_prune_stale_observed_terminals",
    "agent_chat_session_has_observed_terminal_origins",
    "agent_chat_session_terminal_identity_is_observed",
    "agent_chat_session_observed_terminal_presence_entries",
  ];
  for (const source of rustSources) {
    for (const symbol of removedSymbols) {
      assert.doesNotMatch(source, new RegExp(`\\b${symbol}\\b`), symbol);
    }
  }
});

test("legacy account implementations are test-and-feature gated", () => {
  const source = readFileSync(
    new URL("../../src-tauri/src/agent_accounts.rs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /#\[cfg\(feature = "account-push-unquarantined-tests"\)\]/,
  );
  assert.match(
    source,
    /cfg!\(all\(test, feature = "account-push-unquarantined-tests"\)\)/,
  );
  assert.match(
    source,
    /#\[cfg\(all\(test, feature = "account-push-unquarantined-tests"\)\)\]/,
  );
});

test("retired hook session synchronizers and turn-context graph stay excised", () => {
  const source = readFileSync(
    new URL("../../src-tauri/src/cloud_mcp.rs", import.meta.url),
    "utf8",
  );
  const removedSymbols = [
    "cloud_mcp_sync_agent_chat_turn_summary_from_hook",
    "cloud_mcp_agent_chat_turn_summary_has_stable_key",
    "CloudMcpAgentChatTurnGitSnapshot",
    "CloudMcpAgentChatTurnGitDiff",
    "CloudMcpAgentChatTurnGitStatusEntry",
    "CloudMcpAgentChatTurnGitSnapshotState",
    "CLOUD_MCP_AGENT_CHAT_TURN_GIT_SNAPSHOTS",
    "CLOUD_MCP_AGENT_CHAT_TURN_GIT_TEMP_INDEX_SEQ",
    "CLOUD_MCP_AGENT_CHAT_TURN_GIT_SNAPSHOT_MAX",
    "CLOUD_MCP_AGENT_CHAT_TURN_GIT_SNAPSHOT_TTL_MS",
    "CLOUD_MCP_AGENT_CHAT_TURN_DIFF_PATCH_MAX_CHARS",
    "CLOUD_MCP_AGENT_CHAT_TURN_DIFF_MESSAGES_MAX_BYTES",
    "CLOUD_MCP_AGENT_CHAT_TURN_DIFF_MESSAGES_CAP_HEADROOM_BYTES",
    "CLOUD_MCP_AGENT_CHAT_TURN_DIFF_PATCH_TIMEOUT_MS",
    "cloud_mcp_agent_chat_turn_git_snapshots",
    "cloud_mcp_agent_chat_turn_iso_from_ms",
    "cloud_mcp_agent_chat_turn_hook_ms",
    "cloud_mcp_agent_chat_turn_started_at",
    "cloud_mcp_agent_chat_turn_completed_at",
    "cloud_mcp_agent_chat_turn_native_id",
    "cloud_mcp_agent_chat_turn_key_from_start",
    "cloud_mcp_agent_chat_turn_prompt_start_key",
    "cloud_mcp_agent_chat_turn_snapshot_key",
    "cloud_mcp_agent_chat_turn_git_env",
    "cloud_mcp_agent_chat_turn_git_run",
    "cloud_mcp_agent_chat_turn_git_run_with_timeout",
    "cloud_mcp_agent_chat_turn_git_root",
    "cloud_mcp_agent_chat_turn_temp_index_path",
    "cloud_mcp_agent_chat_turn_cleanup_index",
    "cloud_mcp_agent_chat_turn_git_snapshot_tree",
    "cloud_mcp_agent_chat_turn_git_record_start",
    "cloud_mcp_agent_chat_turn_git_mark_start",
    "cloud_mcp_agent_chat_turn_git_prune_locked",
    "cloud_mcp_agent_chat_turn_git_finish_start",
    "cloud_mcp_agent_chat_turn_git_record_start_after_mark",
    "cloud_mcp_agent_chat_turn_git_take_snapshot",
    "cloud_mcp_agent_chat_turn_git_take_snapshot_key",
    "cloud_mcp_agent_chat_turn_git_take_completion_snapshot",
    "cloud_mcp_agent_chat_turn_git_clear_session",
    "cloud_mcp_agent_chat_turn_git_clear_all_snapshots",
    "cloud_mcp_agent_chat_turn_git_name_status_entries",
    "cloud_mcp_agent_chat_turn_git_name_status_map",
    "cloud_mcp_agent_chat_turn_git_numstat_rename_path",
    "cloud_mcp_agent_chat_turn_git_parse_numstat",
    "cloud_mcp_agent_chat_turn_git_diff_header_path",
    "cloud_mcp_agent_chat_turn_git_patch_section_path",
    "cloud_mcp_agent_chat_turn_git_unified_patch",
    "cloud_mcp_agent_chat_turn_git_patch_map",
    "cloud_mcp_agent_chat_turn_diff_totals",
    "cloud_mcp_agent_chat_turn_diff_message",
    "cloud_mcp_agent_chat_turn_diff_messages_effective_max_bytes",
    "cloud_mcp_agent_chat_turn_diff_messages_bytes",
    "cloud_mcp_agent_chat_turn_git_attach_patches",
    "cloud_mcp_agent_chat_turn_git_diff",
    "cloud_mcp_agent_chat_turn_git_diff_with_patch_timeout",
    "cloud_mcp_agent_chat_status_hook_is_relevant",
    "cloud_mcp_agent_chat_status_from_hook",
    "CloudMcpAgentChatStatusSyncRequest",
    "cloud_mcp_agent_chat_status_sync_request_from_hook",
    "CLOUD_MCP_AGENT_CHAT_STATUS_SYNC_MEMO",
    "CLOUD_MCP_AGENT_CHAT_STATUS_SYNC_MEMO_TOKEN",
    "CLOUD_MCP_AGENT_CHAT_STATUS_SYNC_MEMO_MAX",
    "cloud_mcp_agent_chat_status_sync_try_arm",
    "cloud_mcp_agent_chat_status_sync_memo_settle",
    "cloud_mcp_sync_agent_chat_session_status_from_hook",
    "cloud_mcp_agent_chat_status_sync_memo_tests",
    "cloud_mcp_agent_chat_turn_git_should_clear",
    "cloud_mcp_agent_chat_turn_summary_context_from_hook",
    "cloud_mcp_agent_chat_turn_contexts_from_hook",
  ];
  for (const symbol of removedSymbols) {
    assert.doesNotMatch(source, new RegExp(`\\b${symbol}\\b`), symbol);
  }
});

test("serialized unavailable sessions publish a categorical reason", () => {
  const source = readFileSync(
    new URL("../../src-tauri/src/sessions.rs", import.meta.url),
    "utf8",
  );
  const serializedValue = source
    .split("fn serialized_value(&self) -> Value {")[1]
    ?.split("impl Serialize for SessionRow")[0] || "";
  assert.match(serializedValue, /"session_availability_reason"\.to_string\(\)/);
  for (const reason of ["daemon-unavailable", "not-published", "legacy-provenance"]) {
    assert.match(source, new RegExp(`Some\\(\"${reason}\"\\)`), reason);
  }
});

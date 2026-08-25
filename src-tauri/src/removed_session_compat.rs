// Temporary compile seams for out-of-lane callers that still name retired
// provider-session helpers. None of these functions discover, read, watch,
// resume, or sync legacy sessions. The remaining callers are reported as
// orphans and can be removed by their owning lanes.

const CODEX_TRANSCRIPT_DEFAULT_LIMIT: usize = 260;
const CODEX_TRANSCRIPT_MAX_TEXT: usize = 65_536;

#[cfg(test)]
pub(crate) static OPENCODE_DB_TEST_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
    std::sync::OnceLock::new();

#[derive(Clone, Default)]
struct AgentThreadTranscriptNativeWatchRequest {
    agent_id: String,
    cwd: String,
    instance_id: Option<u64>,
    pane_id: String,
    provider_session_id: String,
    source: String,
    terminal_index: Option<i64>,
    thread_id: String,
    transcript_path: Option<String>,
    workspace_id: String,
}

#[derive(Clone, Default)]
struct CodexObservedSession {
    session_id: String,
    session_title: String,
    rollout_path: String,
    cwd: String,
    latest_timestamp: String,
    modified_at_ms: u64,
}

#[derive(Clone, Default)]
struct CodexThreadTranscriptMessage {
    role: String,
    kind: String,
    text: String,
}

struct CodexThreadTranscriptResult {
    messages: Vec<CodexThreadTranscriptMessage>,
}

#[derive(Clone)]
struct AgentChatSessionObservedTerminalPresence {
    workspace_id: String,
    pane_id: String,
    instance_id: Option<u64>,
    origins: Vec<String>,
}

#[derive(Clone, Default)]
struct AgentChatSessionSyncContext {
    workspace_id: String,
    workspace_name: String,
    thread_id: String,
    pane_id: String,
    terminal_instance_id: Option<u64>,
    terminal_index: Option<i64>,
    model_id: String,
    model_source: String,
    session_mode: String,
    file_authority: String,
    coordination_mode: String,
    status: String,
    source: String,
    shared_history_id: String,
    fork_from_provider_session_id: String,
    metadata_only: bool,
    turn_summary: Option<AgentChatTurnSummaryContext>,
    turn_diff: Option<AgentChatTurnDiffContext>,
}

#[derive(Clone, Default)]
struct AgentChatTurnSummaryContext {
    turn_id: String,
    turn_key: String,
    started_at: String,
    completed_at: String,
    duration_ms: Option<u64>,
    raw: Value,
    file_change: Option<Value>,
}

#[derive(Clone, Default)]
struct AgentChatTurnDiffContext {
    turn_id: String,
    turn_key: String,
    completed_at: String,
    raw: Value,
    files: Vec<Value>,
    total_additions: i64,
    total_deletions: i64,
    files_omitted: usize,
    truncated: bool,
}

type AgentChatSessionSyncSettleObserver = Box<dyn FnOnce(bool) + Send + 'static>;

fn clean_codex_id(value: impl AsRef<str>) -> String {
    value
        .as_ref()
        .trim()
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':' | '/')
        })
        .take(180)
        .collect()
}

fn clean_codex_transcript_text(value: impl AsRef<str>, max_chars: usize) -> String {
    let normalized = value.as_ref().replace('\r', "\n");
    let truncated = normalized.chars().count() > max_chars;
    let mut output = normalized.chars().take(max_chars).collect::<String>();
    if truncated {
        output.push_str("\n[truncated]");
    }
    output.trim().to_string()
}

fn claude_home_dir() -> Option<PathBuf> {
    env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".claude")))
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude")))
}

fn opencode_native_data_home_from(
    selected_xdg_data_home: Option<PathBuf>,
    home: Option<PathBuf>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(data_home) = selected_xdg_data_home {
        candidates.push(data_home.join("opencode"));
    } else if let Some(home) = home {
        candidates.push(home.join(".local").join("share").join("opencode"));
        candidates.push(home.join("AppData").join("Roaming").join("opencode"));
        candidates.push(home.join("AppData").join("Local").join("opencode"));
    }
    candidates.dedup();
    candidates
}

fn opencode_native_data_home() -> Vec<PathBuf> {
    opencode_native_data_home_from(
        env::var_os("XDG_DATA_HOME").map(PathBuf::from),
        user_home_dir(),
    )
}

fn opencode_data_home() -> Vec<PathBuf> {
    let mut candidates = agent_accounts_profile_home_for_launch("opencode")
        .map(|profile_root| vec![profile_root.join("opencode")])
        .unwrap_or_default();
    candidates.extend(opencode_native_data_home());
    candidates.dedup();
    candidates
}

fn opencode_native_data_home_for_launch(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|path| path.exists())
        .cloned()
        .or_else(|| candidates.first().cloned())
}

fn opencode_db_path_for_launch_roots(
    active_profile_root: Option<PathBuf>,
    native_data_homes: Vec<PathBuf>,
) -> Option<PathBuf> {
    if let Some(profile_root) = active_profile_root {
        let selected_profile_db = profile_root.join("opencode").join("opencode.db");
        return selected_profile_db.is_file().then_some(selected_profile_db);
    }
    let native_data_home = opencode_native_data_home_for_launch(&native_data_homes)?;
    let native_db = native_data_home.join("opencode.db");
    native_db.is_file().then_some(native_db)
}

fn legacy_session_unavailable(provider: &str) -> String {
    format!(
        "{provider} session files are no longer an ADE session authority; use a Haider session"
    )
}

fn jsonl_tail_last_model(_provider: AgentProvider, _path: &Path) -> Option<String> {
    None
}

fn claude_session_transcript_path_in_home(_home: &Path, _session_id: &str) -> Option<PathBuf> {
    None
}

fn codex_session_transcript_path_in_home(_home: &Path, _session_id: &str) -> Option<PathBuf> {
    None
}

fn opencode_session_last_model_in_db(_session_id: &str, _db_path: &Path) -> Option<String> {
    None
}

fn discover_latest_codex_session_for_cwd_in_auth_home(
    _cwd: &str,
    _not_before_ms: u64,
    _auth_home: &Path,
) -> Result<Option<CodexObservedSession>, String> {
    Ok(None)
}

fn resolve_codex_resume_session_for_auth_home(
    _provider_session_id: &str,
    _cwd: &str,
    _auth_home: &Path,
) -> Result<(String, PathBuf), String> {
    Err(legacy_session_unavailable("Codex"))
}

fn materialize_codex_rollout_in_managed_home(
    _provider_session_id: &str,
    _source_home: &Path,
    _managed_home: &Path,
) -> Result<PathBuf, String> {
    Err(legacy_session_unavailable("Codex"))
}

fn resolve_claude_resume_session_in_home(
    _provider_session_id: &str,
    _cwd: &str,
    _home: &Path,
) -> Result<String, String> {
    Err(legacy_session_unavailable("Claude Code"))
}

fn resolve_opencode_resume_session_in_db(
    _db_path: &Path,
    _provider_session_id: &str,
    _cwd: &str,
) -> Result<String, String> {
    Err(legacy_session_unavailable("OpenCode"))
}

fn read_agent_thread_transcript(
    _agent_id: &str,
    _provider_session_id: &str,
    _cwd: &str,
    _workspace_id: Option<&str>,
    _max_messages: usize,
) -> Result<CodexThreadTranscriptResult, String> {
    Err(legacy_session_unavailable("Provider"))
}

fn register_agent_thread_transcript_native_watch(
    _app: &AppHandle,
    _request: &AgentThreadTranscriptNativeWatchRequest,
) -> Result<(), String> {
    Ok(())
}

fn unregister_agent_thread_transcript_native_watch(_pane_id: &str, _instance_id: Option<u64>) {}

fn trigger_agent_thread_transcript_native_watch(
    _app: &AppHandle,
    _pane_id: &str,
    _instance_id: Option<u64>,
    _reason: &'static str,
) -> usize {
    0
}

fn agent_chat_session_set_terminal_observed(
    _workspace_id: &str,
    _pane_id: &str,
    _instance_id: Option<u64>,
    _origin: Option<&str>,
    _active: bool,
) -> usize {
    0
}

fn agent_chat_session_touch_terminal_observed(
    _workspace_id: &str,
    _pane_id: &str,
    _instance_id: Option<u64>,
    _origin: Option<&str>,
) -> usize {
    0
}

fn agent_chat_session_clear_observed_terminal_matching(
    _workspace_id: Option<&str>,
    _pane_id: &str,
    _instance_id: Option<u64>,
) -> bool {
    false
}

fn agent_chat_session_clear_observed_terminals() -> bool {
    false
}

fn agent_chat_session_prune_stale_observed_terminals(
    _now_ms: u64,
    _stale_after_ms: u64,
) -> bool {
    false
}

fn agent_chat_session_has_observed_terminal_origins() -> bool {
    false
}

fn agent_chat_session_terminal_identity_is_observed(
    _workspace_id: &str,
    _pane_id: &str,
    _instance_id: Option<u64>,
) -> bool {
    false
}

fn agent_chat_session_observed_terminal_presence_entries(
) -> Vec<AgentChatSessionObservedTerminalPresence> {
    Vec::new()
}

fn agent_chat_session_sync_provider(_agent_id: &str) -> Option<&'static str> {
    None
}

fn agent_chat_session_sync_spawn_with_state(
    _state: CloudMcpState,
    _agent_id: String,
    _provider_session_id: String,
    _cwd: String,
    _context: AgentChatSessionSyncContext,
    _reason: &'static str,
) {
}

fn agent_chat_session_sync_spawn_with_state_observed(
    _state: CloudMcpState,
    _agent_id: String,
    _provider_session_id: String,
    _cwd: String,
    _context: AgentChatSessionSyncContext,
    _reason: &'static str,
    on_settled: Option<AgentChatSessionSyncSettleObserver>,
) {
    if let Some(on_settled) = on_settled {
        on_settled(false);
    }
}

fn agent_chat_session_sync_spawn_from_payload_repair(
    _app: AppHandle,
    _payload: &Value,
    _reason: &'static str,
) -> bool {
    false
}

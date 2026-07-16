const CODEX_TRANSCRIPT_DEFAULT_LIMIT: usize = 260;
const CODEX_TRANSCRIPT_MAX_LIMIT: usize = 420;
const CODEX_TRANSCRIPT_MAX_TEXT: usize = 65_536;
const CODEX_TRANSCRIPT_MAX_TOOL_TEXT: usize = 65_536;
const CODEX_TRANSCRIPT_MAX_REASONING_TEXT: usize = 65_536;
const CODEX_TRANSCRIPT_MAX_RECORD_MESSAGES_BYTES: usize = 512 * 1024;
const CODEX_ROLLOUT_SCAN_LIMIT: usize = 2_500;
const CODEX_USER_MESSAGE_DEDUPE_LINE_WINDOW: usize = 4;
const CODEX_USER_MESSAGE_DEDUPE_TIME_WINDOW_MS: i64 = 15_000;
const AGENT_THREAD_TRANSCRIPT_UPDATED_EVENT: &str = "forge-agent-thread-transcript-updated";
const AGENT_THREAD_TRANSCRIPT_WATCH_DEBOUNCE_MS: u64 = 300;
const AGENT_THREAD_TRANSCRIPT_WATCH_MAX_WAIT_MS: u64 = 750;
const AGENT_THREAD_TRANSCRIPT_MAX_WATCHES: usize = 128;
const CODEX_GENERATED_IMAGE_DIR_SCAN_LIMIT: usize = 16;

use notify::Watcher as NotifyWatcher;

#[derive(Clone, Deserialize)]
struct CodexThreadTranscriptRequest {
    agent_id: Option<String>,
    provider_session_id: Option<String>,
    cwd: Option<String>,
    max_messages: Option<usize>,
    workspace_id: Option<String>,
}

#[derive(Clone, Deserialize)]
struct AgentThreadTranscriptWatchRequest {
    agent_id: Option<String>,
    allow_timestamp_fallback: Option<bool>,
    cwd: Option<String>,
    expected_message_created_at: Option<String>,
    expected_user_message: Option<String>,
    instance_id: Option<u64>,
    max_messages: Option<usize>,
    pane_id: Option<String>,
    poll_until_turn_complete: Option<bool>,
    prompt_event_id: Option<String>,
    prompt_event_submitted_at: Option<String>,
    provider_session_id: Option<String>,
    source: Option<String>,
    submitted_at: Option<String>,
    terminal_index: Option<i64>,
    terminal_prompt_accepted: Option<bool>,
    thread_id: Option<String>,
    workspace_id: Option<String>,
}

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

#[derive(Deserialize)]
struct CodexThreadSessionDiscoverRequest {
    allow_timestamp_fallback: Option<bool>,
    agent_id: Option<String>,
    cwd: Option<String>,
    expected_user_message: Option<String>,
    fallback_window_ms: Option<u64>,
    home_search_cwd: Option<String>,
    max_messages: Option<usize>,
    submitted_at: Option<String>,
    workspace_id: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct CodexThreadTranscriptArtifact {
    kind: String,
    #[serde(alias = "mime", alias = "mimeType")]
    mime_type: String,
    path: String,
    url: String,
    title: String,
    prompt: String,
    #[serde(alias = "assetId", skip_serializing_if = "String::is_empty")]
    asset_id: String,
    #[serde(alias = "assetPath", skip_serializing_if = "String::is_empty")]
    asset_path: String,
    #[serde(alias = "originalPath", skip_serializing_if = "String::is_empty")]
    original_path: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default)]
struct CodexThreadTranscriptMessage {
    #[serde(alias = "messageId")]
    id: String,
    role: String,
    kind: String,
    #[serde(alias = "legacyKind", skip_serializing_if = "String::is_empty")]
    legacy_kind: String,
    text: String,
    title: String,
    #[serde(alias = "callId")]
    call_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    status: String,
    #[serde(alias = "createdAt")]
    created_at: String,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    tool: Option<Value>,
    #[serde(alias = "toolOutput", skip_serializing_if = "Option::is_none")]
    tool_output: Option<Value>,
    #[serde(alias = "toolError", skip_serializing_if = "Option::is_none")]
    tool_error: Option<Value>,
    #[serde(alias = "fileChange", skip_serializing_if = "Option::is_none")]
    file_change: Option<Value>,
    #[serde(alias = "durationMs", skip_serializing_if = "Option::is_none")]
    duration_ms: Option<u64>,
    #[serde(alias = "exitCode", skip_serializing_if = "Option::is_none")]
    exit_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    subagent: Option<Value>,
    #[serde(alias = "subagentId", skip_serializing_if = "String::is_empty")]
    subagent_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    usage: Option<Value>,
    #[serde(skip_serializing_if = "bool_is_false")]
    truncated: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    artifacts: Vec<CodexThreadTranscriptArtifact>,
}

fn bool_is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Default)]
struct CodexRolloutMeta {
    session_id: String,
    cwd: String,
    latest_timestamp: String,
    title: String,
}

#[derive(Clone, Debug)]
pub(crate) struct CodexObservedSession {
    pub(crate) session_id: String,
    pub(crate) session_title: String,
    pub(crate) rollout_path: String,
    pub(crate) cwd: String,
    pub(crate) latest_timestamp: String,
    pub(crate) modified_at_ms: u64,
}

#[derive(Clone, Serialize)]
struct CodexThreadTranscriptResult {
    session_id: String,
    session_title: String,
    rollout_path: String,
    cwd: String,
    matched_by: String,
    latest_timestamp: String,
    messages: Vec<CodexThreadTranscriptMessage>,
}

#[derive(Clone, Default)]
struct AgentThreadTranscriptWatchContext {
    agent_id: String,
    allow_timestamp_fallback: bool,
    cwd: String,
    expected_message_created_at: String,
    expected_user_message: String,
    instance_id: Option<u64>,
    max_messages: usize,
    pane_id: String,
    poll_until_turn_complete: bool,
    prompt_event_id: String,
    prompt_event_submitted_at: String,
    provider_session_id: String,
    source: String,
    submitted_at: String,
    terminal_index: Option<i64>,
    terminal_prompt_accepted: bool,
    thread_id: String,
    workspace_id: String,
}

struct AgentThreadTranscriptWatchEntry {
    context: Arc<StdMutex<AgentThreadTranscriptWatchContext>>,
    last_signature: String,
    owners: HashSet<String>,
    touched_ms: u64,
    _watcher: notify::RecommendedWatcher,
}

struct AgentThreadTranscriptWatchDebounce {
    generation: AtomicU64,
    scheduled: AtomicBool,
}

static AGENT_THREAD_TRANSCRIPT_WATCHES: OnceLock<
    StdMutex<HashMap<String, AgentThreadTranscriptWatchEntry>>,
> = OnceLock::new();
#[derive(Clone)]
struct AgentChatSessionObservedTerminalPresence {
    workspace_id: String,
    pane_id: String,
    instance_id: Option<u64>,
    origins: Vec<String>,
}

#[derive(Clone)]
struct AgentChatSessionObservedTerminal {
    workspace_id: String,
    pane_id: String,
    instance_id: Option<u64>,
    origins: HashMap<String, u64>,
}

static AGENT_CHAT_SESSION_OBSERVED_TERMINALS: OnceLock<
    StdMutex<HashMap<String, AgentChatSessionObservedTerminal>>,
> = OnceLock::new();

fn agent_chat_session_observed_terminal_key(
    workspace_id: &str,
    pane_id: &str,
    instance_id: Option<u64>,
) -> String {
    let workspace_id = cloud_mcp_workspace_id_match_key(workspace_id);
    format!(
        "{}|{}|{}",
        workspace_id.trim(),
        pane_id.trim(),
        instance_id
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
    )
}

fn agent_chat_session_observer_origin(origin: Option<&str>) -> Option<String> {
    let origin = origin.map(str::trim).filter(|value| !value.is_empty())?;
    Some(origin.to_string())
}

fn agent_chat_session_set_terminal_observed(
    workspace_id: &str,
    pane_id: &str,
    instance_id: Option<u64>,
    origin: Option<&str>,
    active: bool,
) -> usize {
    let workspace_id = cloud_mcp_workspace_id_match_key(workspace_id);
    let key = agent_chat_session_observed_terminal_key(&workspace_id, pane_id, instance_id);
    let observed =
        AGENT_CHAT_SESSION_OBSERVED_TERMINALS.get_or_init(|| StdMutex::new(HashMap::new()));
    let Ok(mut observed) = observed.lock() else {
        return 0;
    };
    let origin = agent_chat_session_observer_origin(origin);
    if active {
        let origin = origin.unwrap_or_else(|| "unknown".to_string());
        let now_ms = cloud_mcp_now_ms();
        let entry = observed
            .entry(key)
            .or_insert_with(|| AgentChatSessionObservedTerminal {
                workspace_id,
                pane_id: pane_id.trim().to_string(),
                instance_id,
                origins: HashMap::new(),
            });
        entry.origins.insert(origin, now_ms);
        entry.origins.len()
    } else {
        let Some(origin) = origin else {
            observed.remove(&key);
            return 0;
        };
        let count = if let Some(entry) = observed.get_mut(&key) {
            entry.origins.remove(&origin);
            entry.origins.len()
        } else {
            0
        };
        if count == 0 {
            observed.remove(&key);
        }
        count
    }
}

fn agent_chat_session_touch_terminal_observed(
    workspace_id: &str,
    pane_id: &str,
    instance_id: Option<u64>,
    origin: Option<&str>,
) -> usize {
    let Some(origin) = agent_chat_session_observer_origin(origin) else {
        return 0;
    };
    let key = agent_chat_session_observed_terminal_key(workspace_id, pane_id, instance_id);
    AGENT_CHAT_SESSION_OBSERVED_TERMINALS
        .get()
        .and_then(|observed| observed.lock().ok())
        .and_then(|mut observed| {
            observed.get_mut(&key).map(|entry| {
                if let Some(last_seen_ms) = entry.origins.get_mut(&origin) {
                    *last_seen_ms = cloud_mcp_now_ms();
                }
                entry.origins.len()
            })
        })
        .unwrap_or(0)
}

fn agent_chat_session_clear_observed_terminal_matching(
    workspace_id: Option<&str>,
    pane_id: &str,
    instance_id: Option<u64>,
) -> bool {
    let pane_id = pane_id.trim();
    if pane_id.is_empty() {
        return false;
    }
    let workspace_id = workspace_id
        .map(cloud_mcp_workspace_id_match_key)
        .filter(|value| !value.is_empty());
    let Some(observed) = AGENT_CHAT_SESSION_OBSERVED_TERMINALS.get() else {
        return false;
    };
    let Ok(mut observed) = observed.lock() else {
        return false;
    };
    let mut changed = false;
    observed.retain(|_, entry| {
        let workspace_matches = workspace_id.as_ref().is_none_or(|workspace_id| {
            cloud_mcp_workspace_id_match_key(&entry.workspace_id) == *workspace_id
        });
        let remove = workspace_matches
            && entry.pane_id.trim() == pane_id
            && entry.instance_id == instance_id;
        changed |= remove;
        !remove
    });
    changed
}

fn agent_chat_session_clear_observed_terminals() -> bool {
    if let Some(observed) = AGENT_CHAT_SESSION_OBSERVED_TERMINALS.get() {
        if let Ok(mut observed) = observed.lock() {
            let changed = !observed.is_empty();
            observed.clear();
            return changed;
        }
    }
    false
}

fn agent_chat_session_prune_stale_observed_terminals(now_ms: u64, stale_after_ms: u64) -> bool {
    let Some(observed) = AGENT_CHAT_SESSION_OBSERVED_TERMINALS.get() else {
        return false;
    };
    let Ok(mut observed) = observed.lock() else {
        return false;
    };
    let mut changed = false;
    observed.retain(|_, entry| {
        let before = entry.origins.len();
        entry
            .origins
            .retain(|_, last_seen_ms| now_ms.saturating_sub(*last_seen_ms) < stale_after_ms);
        changed |= entry.origins.len() != before;
        let keep = !entry.origins.is_empty();
        changed |= !keep;
        keep
    });
    changed
}

fn agent_chat_session_has_observed_terminal_origins() -> bool {
    AGENT_CHAT_SESSION_OBSERVED_TERMINALS
        .get()
        .and_then(|observed| observed.lock().ok())
        .is_some_and(|observed| observed.values().any(|entry| !entry.origins.is_empty()))
}

fn agent_chat_session_terminal_identity_is_observed(
    workspace_id: &str,
    pane_id: &str,
    instance_id: Option<u64>,
) -> bool {
    let key = agent_chat_session_observed_terminal_key(workspace_id, pane_id, instance_id);
    AGENT_CHAT_SESSION_OBSERVED_TERMINALS
        .get()
        .and_then(|observed| observed.lock().ok())
        .is_some_and(|observed| {
            observed
                .get(&key)
                .is_some_and(|entry| !entry.origins.is_empty())
        })
}

fn agent_chat_session_terminal_is_observed(context: &AgentThreadTranscriptWatchContext) -> bool {
    agent_chat_session_terminal_identity_is_observed(
        &context.workspace_id,
        &context.pane_id,
        context.instance_id,
    )
}

fn agent_chat_session_observed_terminal_presence_entries(
) -> Vec<AgentChatSessionObservedTerminalPresence> {
    AGENT_CHAT_SESSION_OBSERVED_TERMINALS
        .get()
        .and_then(|observed| observed.lock().ok())
        .map(|observed| {
            observed
                .values()
                .filter(|entry| !entry.origins.is_empty())
                .map(|entry| {
                    let mut origins = entry.origins.keys().cloned().collect::<Vec<_>>();
                    origins.sort();
                    AgentChatSessionObservedTerminalPresence {
                        workspace_id: entry.workspace_id.clone(),
                        pane_id: entry.pane_id.clone(),
                        instance_id: entry.instance_id,
                        origins,
                    }
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn codex_home_dir() -> Option<PathBuf> {
    env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".codex")))
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
}

fn diffforge_app_support_dir() -> Option<PathBuf> {
    env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|path| path.join("DiffForge"))
        .or_else(|| {
            env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .map(|path| path.join("DiffForge"))
        })
        .or_else(|| {
            env::var_os("HOME").map(|home| {
                PathBuf::from(home)
                    .join("Library")
                    .join("Application Support")
                    .join("DiffForge")
            })
        })
}

fn push_unique_path(paths: &mut Vec<PathBuf>, seen: &mut HashSet<String>, path: PathBuf) {
    let key_path = path.canonicalize().unwrap_or_else(|_| path.clone());
    let key = key_path.to_string_lossy().replace('\\', "/");
    if key.trim().is_empty() || !seen.insert(key) {
        return;
    }
    paths.push(path);
}

fn codex_worktree_root_and_slot(cwd: &Path) -> Option<(PathBuf, String)> {
    let components: Vec<_> = cwd.components().collect();
    for index in 0..components.len().saturating_sub(2) {
        let component = components[index].as_os_str().to_string_lossy();
        let next_component = components[index + 1].as_os_str().to_string_lossy();
        if component != ".agents" || next_component != "worktrees" {
            continue;
        }

        let slot = components[index + 2]
            .as_os_str()
            .to_string_lossy()
            .trim()
            .to_string();
        if slot.is_empty() {
            continue;
        }

        let mut repo_root = PathBuf::new();
        for root_component in &components[..index] {
            repo_root.push(root_component.as_os_str());
        }
        if !repo_root.as_os_str().is_empty() {
            return Some((repo_root, slot));
        }
    }

    None
}

fn push_codex_managed_home_candidates(
    paths: &mut Vec<PathBuf>,
    seen: &mut HashSet<String>,
    repo_root: &Path,
    slot: Option<&str>,
) {
    for coordinated_root in [
        repo_root
            .join(".agents")
            .join("codex-home")
            .join("coordinated"),
        coordination::db::coordination_repo_state_root(repo_root)
            .join("codex-home")
            .join("coordinated"),
    ] {
        if let Some(slot) = slot.filter(|value| !value.trim().is_empty()) {
            push_unique_path(paths, seen, coordinated_root.join(slot));
            continue;
        }

        let Ok(entries) = fs::read_dir(&coordinated_root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                push_unique_path(paths, seen, path);
            }
        }
    }
}

fn codex_home_candidates(cwd: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();
    let cwd_path = PathBuf::from(cwd.trim());

    if !cwd.trim().is_empty() {
        if let Some((repo_root, slot)) = codex_worktree_root_and_slot(&cwd_path) {
            push_codex_managed_home_candidates(&mut paths, &mut seen, &repo_root, Some(&slot));
        }

        for ancestor in cwd_path.ancestors() {
            push_codex_managed_home_candidates(&mut paths, &mut seen, ancestor, None);
        }
    }

    if let Some(home) = codex_home_dir() {
        push_unique_path(&mut paths, &mut seen, home);
    }
    if let Some(home) = agent_accounts_codex_home_for_launch() {
        push_unique_path(&mut paths, &mut seen, home);
    }

    paths
}

fn collect_codex_rollout_candidates(cwd: &str) -> Result<Vec<PathBuf>, String> {
    let homes = codex_home_candidates(cwd);
    if homes.is_empty() {
        return Err("Unable to locate Codex home.".to_string());
    }

    let mut files = Vec::new();
    for home in &homes {
        if files.len() >= CODEX_ROLLOUT_SCAN_LIMIT {
            break;
        }
        let sessions_dir = home.join("sessions");
        if sessions_dir.exists() {
            collect_codex_rollout_files(&sessions_dir, &mut files);
        }
    }
    sort_rollouts_newest_first(&mut files);

    if files.is_empty() {
        let searched = homes
            .iter()
            .map(|home| home.join("sessions").to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "No Codex rollout transcripts were found in: {searched}"
        ));
    }

    Ok(files)
}

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

fn normalize_agent_path_text(value: impl AsRef<str>) -> String {
    let text = value.as_ref().trim();
    if text.is_empty() {
        return String::new();
    }

    let path = PathBuf::from(text);
    let path = path.canonicalize().unwrap_or(path);
    let mut normalized = path.to_string_lossy().replace('\\', "/");
    while normalized.ends_with('/') && normalized.len() > 1 {
        normalized.pop();
    }

    if cfg!(windows) {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

fn agent_paths_match(left: &str, right: &str) -> bool {
    let left = normalize_agent_path_text(left);
    let right = normalize_agent_path_text(right);
    !left.is_empty() && left == right
}

fn normalize_prompt_match_text(value: impl AsRef<str>) -> String {
    let mut output = String::new();
    let mut previous_space = false;
    for character in value.as_ref().replace('\r', "\n").chars() {
        let character = match character {
            '\u{0000}'..='\u{0008}' | '\u{000B}'..='\u{001F}' | '\u{007F}' => ' ',
            '\t' => ' ',
            value => value,
        };
        if character == ' ' {
            if previous_space {
                continue;
            }
            previous_space = true;
        } else {
            previous_space = false;
        }
        output.push(character);
    }

    while output.contains("\n\n\n\n") {
        output = output.replace("\n\n\n\n", "\n\n\n");
    }

    output.trim().to_string()
}

fn codex_strip_native_image_envelopes(value: impl AsRef<str>) -> String {
    let mut output = value.as_ref().to_string();
    loop {
        let Some(start) = output.find("<image") else {
            break;
        };
        let Some(relative_end) = output[start..].find("</image>") else {
            break;
        };
        let end = start + relative_end + "</image>".len();
        output.replace_range(start..end, "");
    }
    output
}

fn codex_strip_image_attachment_summary(value: impl AsRef<str>) -> String {
    value
        .as_ref()
        .lines()
        .filter(|line| {
            let token = line.trim().to_ascii_lowercase();
            !(token.starts_with('[')
                && token.ends_with("image attachment(s)]")
                && token[1..]
                    .split_whitespace()
                    .next()
                    .is_some_and(|count| count.parse::<usize>().is_ok()))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn codex_normalize_user_prompt_text(value: impl AsRef<str>) -> String {
    let without_envelopes = codex_strip_native_image_envelopes(value);
    let without_summary = codex_strip_image_attachment_summary(without_envelopes);
    normalize_prompt_match_text(clean_codex_transcript_text(
        without_summary,
        CODEX_TRANSCRIPT_MAX_TEXT,
    ))
}

fn codex_transcript_timestamp_ms(value: &str) -> Option<i64> {
    let text = value.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(number) = text.parse::<f64>() {
        if number.is_finite() && number > 0.0 {
            return Some(
                (if number < 1_000_000_000_000.0 {
                    number * 1000.0
                } else {
                    number
                })
                .round() as i64,
            );
        }
    }
    let year = text.get(0..4)?.parse::<i64>().ok()?;
    let month = text.get(5..7)?.parse::<i64>().ok()?;
    let day = text.get(8..10)?.parse::<i64>().ok()?;
    let hour = text.get(11..13)?.parse::<i64>().ok()?;
    let minute = text.get(14..16)?.parse::<i64>().ok()?;
    let second = text.get(17..19)?.parse::<i64>().ok()?;
    let bytes = text.as_bytes();
    let mut index = 19usize;
    let mut millis = 0i64;
    if bytes.get(index) == Some(&b'.') {
        index = index.saturating_add(1);
        let start = index;
        while bytes.get(index).is_some_and(u8::is_ascii_digit) {
            index = index.saturating_add(1);
        }
        let fraction = &text[start..index];
        if !fraction.is_empty() {
            let mut digits = fraction.chars().take(3).collect::<String>();
            while digits.len() < 3 {
                digits.push('0');
            }
            millis = digits.parse::<i64>().ok()?;
        }
    }
    let mut offset_ms = 0i64;
    if bytes
        .get(index)
        .is_some_and(|ch| *ch == b'+' || *ch == b'-')
    {
        let sign = if bytes[index] == b'-' { -1 } else { 1 };
        let offset_hour = text.get(index + 1..index + 3)?.parse::<i64>().ok()?;
        let offset_minute = text.get(index + 4..index + 6)?.parse::<i64>().ok()?;
        offset_ms = sign * (offset_hour * 3_600_000 + offset_minute * 60_000);
    }
    Some(
        (cloud_mcp_tokenomics_days_from_civil(year, month, day) * 86_400
            + hour.clamp(0, 23) * 3_600
            + minute.clamp(0, 59) * 60
            + second.clamp(0, 59))
            * 1000
            + millis
            - offset_ms,
    )
}

#[derive(Clone)]
struct CodexUserMessageDedupeEntry {
    line_index: usize,
    timestamp: String,
    normalized_text: String,
}

#[derive(Default)]
struct CodexUserMessageDedupeTracker {
    recent_events: VecDeque<CodexUserMessageDedupeEntry>,
}

fn codex_user_message_in_dedupe_window(
    left_line_index: usize,
    left_timestamp: &str,
    right_line_index: usize,
    right_timestamp: &str,
) -> bool {
    if left_line_index.abs_diff(right_line_index) > CODEX_USER_MESSAGE_DEDUPE_LINE_WINDOW {
        return false;
    }
    match (
        codex_transcript_timestamp_ms(left_timestamp),
        codex_transcript_timestamp_ms(right_timestamp),
    ) {
        (Some(left), Some(right)) => {
            left.abs_diff(right) <= CODEX_USER_MESSAGE_DEDUPE_TIME_WINDOW_MS as u64
        }
        _ => true,
    }
}

impl CodexUserMessageDedupeTracker {
    fn prune(&mut self, line_index: usize, timestamp: &str) {
        self.recent_events.retain(|entry| {
            codex_user_message_in_dedupe_window(
                entry.line_index,
                &entry.timestamp,
                line_index,
                timestamp,
            )
        });
    }

    fn observe_event(&mut self, line_index: usize, timestamp: &str, normalized_text: String) {
        if normalized_text.is_empty() {
            return;
        }
        self.prune(line_index, timestamp);
        self.recent_events.push_back(CodexUserMessageDedupeEntry {
            line_index,
            timestamp: timestamp.to_string(),
            normalized_text,
        });
    }

    fn matches_recent_event(
        &mut self,
        line_index: usize,
        timestamp: &str,
        normalized_text: &str,
    ) -> bool {
        if normalized_text.is_empty() {
            return false;
        }
        self.prune(line_index, timestamp);
        self.recent_events.iter().any(|entry| {
            entry.normalized_text == normalized_text
                && codex_user_message_in_dedupe_window(
                    entry.line_index,
                    &entry.timestamp,
                    line_index,
                    timestamp,
                )
        })
    }
}

fn transcript_has_exact_user_prompt(
    messages: &[CodexThreadTranscriptMessage],
    expected_user_message: &str,
) -> bool {
    let expected = normalize_prompt_match_text(expected_user_message);
    !expected.is_empty()
        && messages.iter().any(|message| {
            message.role.eq_ignore_ascii_case("user")
                && normalize_prompt_match_text(&message.text) == expected
        })
}

fn transcript_has_exact_user_prompt_at_or_after(
    messages: &[CodexThreadTranscriptMessage],
    expected_user_message: &str,
    submitted_at: &str,
) -> bool {
    let expected = normalize_prompt_match_text(expected_user_message);
    !expected.is_empty()
        && messages.iter().any(|message| {
            message.role.eq_ignore_ascii_case("user")
                && normalize_prompt_match_text(&message.text) == expected
                && timestamp_text_at_or_after(&message.created_at, submitted_at)
        })
}

fn timestamp_text_at_or_after(value: &str, submitted_at: &str) -> bool {
    let value = value.trim();
    let submitted_at = submitted_at.trim();
    if value.is_empty() || submitted_at.is_empty() {
        return false;
    }

    value >= submitted_at
}

fn transcript_has_user_prompt_at_or_after(
    messages: &[CodexThreadTranscriptMessage],
    submitted_at: &str,
) -> bool {
    messages.iter().any(|message| {
        message.role.eq_ignore_ascii_case("user")
            && timestamp_text_at_or_after(&message.created_at, submitted_at)
    })
}

fn collect_codex_rollout_files(root: &Path, files: &mut Vec<PathBuf>) {
    if files.len() >= CODEX_ROLLOUT_SCAN_LIMIT {
        return;
    }

    let Ok(entries) = fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        if files.len() >= CODEX_ROLLOUT_SCAN_LIMIT {
            return;
        }

        let path = entry.path();
        if path.is_dir() {
            collect_codex_rollout_files(&path, files);
            continue;
        }

        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        if name.starts_with("rollout-") && name.ends_with(".jsonl") {
            files.push(path);
        }
    }
}

fn authoritative_model_text(value: Option<&Value>) -> Option<String> {
    let value = value_string(value);
    if value.is_empty()
        || value.len() > 120
        || value == "<synthetic>"
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':' | b'/')
        })
    {
        return None;
    }
    Some(value)
}

fn authoritative_model_from_direct_keys(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| authoritative_model_text(value.get(*key)))
}

fn codex_jsonl_record_authoritative_model(value: &Value) -> Option<String> {
    let record_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if record_type == "turn_context" {
        return authoritative_model_from_direct_keys(value, &["model", "model_id", "modelId"])
            .or_else(|| {
                authoritative_model_from_direct_keys(
                    value.get("payload").unwrap_or(&Value::Null),
                    &["model", "model_id", "modelId"],
                )
            });
    }

    let payload = value.get("payload").unwrap_or(&Value::Null);
    let payload_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if record_type == "token_count" || (record_type == "event_msg" && payload_type == "token_count")
    {
        return authoritative_model_from_direct_keys(payload, &["model", "model_id", "modelId"])
            .or_else(|| {
                authoritative_model_from_direct_keys(value, &["model", "model_id", "modelId"])
            });
    }

    None
}

fn claude_jsonl_record_authoritative_model(value: &Value) -> Option<String> {
    if value.get("type").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    let message = value.get("message").unwrap_or(&Value::Null);
    if message.get("role").and_then(Value::as_str) != Some("assistant") {
        return None;
    }
    authoritative_model_from_direct_keys(message, &["model"])
}

fn jsonl_record_authoritative_model(provider: AgentProvider, value: &Value) -> Option<String> {
    match provider {
        AgentProvider::Codex => codex_jsonl_record_authoritative_model(value),
        AgentProvider::Claude => claude_jsonl_record_authoritative_model(value),
        AgentProvider::OpenCode => None,
    }
}

/// Scans the tail of a provider session transcript for the last model the
/// session actually used, but only from provider-owned model metadata fields.
fn jsonl_tail_last_model(provider: AgentProvider, path: &Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(192 * 1024);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let mut last = None;
    for line in text.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(model) = jsonl_record_authoritative_model(provider, &value) {
            last = Some(model);
        }
    }
    last
}

fn claude_session_transcript_path(session_id: &str) -> Option<PathBuf> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return None;
    }
    let projects_dir = claude_home_dir()?.join("projects");
    for entry in fs::read_dir(&projects_dir).ok()?.flatten() {
        let path = entry.path().join(format!("{session_id}.jsonl"));
        if path.exists() {
            return Some(path);
        }
    }
    None
}

fn codex_session_transcript_path(session_id: &str) -> Option<PathBuf> {
    let session_id = session_id.trim();
    if session_id.is_empty() {
        return None;
    }
    let sessions_dir = codex_home_dir()?.join("sessions");
    let mut files = Vec::new();
    collect_codex_rollout_files(&sessions_dir, &mut files);
    let mut matches = files
        .into_iter()
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.contains(session_id))
        })
        .collect::<Vec<_>>();
    sort_rollouts_newest_first(&mut matches);
    matches.into_iter().next()
}

/// Resolves the model a provider session was last using, straight from the
/// provider's own transcript. This is more current than any stored binding
/// because it reflects in-session model switches (e.g. `/model`).
pub(crate) fn agent_session_last_model(
    provider: AgentProvider,
    session_id: &str,
) -> Option<String> {
    let transcript = match provider {
        AgentProvider::Claude => claude_session_transcript_path(session_id)?,
        AgentProvider::Codex => codex_session_transcript_path(session_id)?,
        // OpenCode stores its session in opencode.db rather than a JSONL
        // transcript, so the tail-scan above does not apply.
        AgentProvider::OpenCode => return opencode_session_last_model(session_id),
    };
    jsonl_tail_last_model(provider, &transcript)
}

/// Builds an OpenCode `--model` value (`providerID/modelID`) from a value that
/// carries the model. Handles both the assistant message shape
/// (`{modelID, providerID}`) and the session column shape (`{id, providerID}`).
fn opencode_model_from_value(value: &Value) -> Option<String> {
    let is_assistant_message = value.get("role").and_then(Value::as_str) == Some("assistant");
    let model_id = if is_assistant_message {
        first_value_string(&[value.get("modelID"), value.get("model_id")])
    } else {
        first_value_string(&[
            value.get("modelID"),
            value.get("model_id"),
            value.get("id"),
            value.get("model"),
        ])
    };
    let model_id = model_id.trim();
    if model_id.is_empty() {
        return None;
    }
    let provider_id = first_value_string(&[value.get("providerID"), value.get("provider_id")]);
    let provider_id = provider_id.trim();
    if provider_id.is_empty() {
        Some(model_id.to_string())
    } else {
        Some(format!("{provider_id}/{model_id}"))
    }
}

/// Recovers the model an OpenCode session last used, mirroring the JSONL
/// tail-scan for Claude/Codex. Prefers the most recent assistant message's
/// model (captures in-session `/model` switches), falling back to the
/// `session.model` column.
fn opencode_session_last_model(session_id: &str) -> Option<String> {
    let session_id = clean_codex_id(session_id);
    if session_id.is_empty() {
        return None;
    }
    let db_path = opencode_db_path()?;
    let connection =
        rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()?;

    if let Ok(mut statement) = connection.prepare(
        "select data from message where session_id = ?1 order by time_created desc, id desc limit 200",
    ) {
        if let Ok(mut rows) = statement.query(rusqlite::params![session_id]) {
            while let Ok(Some(row)) = rows.next() {
                let data: String = row.get(0).unwrap_or_default();
                let Ok(value) = serde_json::from_str::<Value>(&data) else {
                    continue;
                };
                if value.get("role").and_then(Value::as_str) != Some("assistant") {
                    continue;
                }
                if let Some(model) = opencode_model_from_value(&value) {
                    return Some(model);
                }
            }
        }
    }

    if let Ok(mut statement) = connection.prepare("select model from session where id = ?1 limit 1")
    {
        if let Ok(mut rows) = statement.query(rusqlite::params![session_id]) {
            if let Ok(Some(row)) = rows.next() {
                if let Ok(model) = row.get::<_, String>(0) {
                    if let Ok(value) = serde_json::from_str::<Value>(&model) {
                        if let Some(model) = opencode_model_from_value(&value) {
                            return Some(model);
                        }
                    }
                }
            }
        }
    }

    None
}

fn sort_rollouts_newest_first(files: &mut [PathBuf]) {
    files.sort_by(|left, right| {
        let left_modified = fs::metadata(left)
            .and_then(|metadata| metadata.modified())
            .ok();
        let right_modified = fs::metadata(right)
            .and_then(|metadata| metadata.modified())
            .ok();
        right_modified.cmp(&left_modified)
    });
}

fn value_string(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn first_value_string(values: &[Option<&Value>]) -> String {
    values
        .iter()
        .map(|value| value_string(*value))
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
}

fn value_i64(value: Option<&Value>) -> Option<i64> {
    value.and_then(|value| match value {
        Value::Number(number) => number.as_i64(),
        Value::String(text) => text.trim().parse::<i64>().ok(),
        _ => None,
    })
}

fn first_value_i64(values: &[Option<&Value>]) -> Option<i64> {
    values.iter().find_map(|value| value_i64(*value))
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for character in value.chars().take(max_chars) {
        output.push(character);
    }
    output
}

fn redact_prefixed_secret(text: &str, prefix: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut remainder = text;

    while let Some(index) = remainder.find(prefix) {
        output.push_str(&remainder[..index]);
        output.push_str(prefix);
        output.push_str("[redacted]");
        let secret_start = index + prefix.len();
        let secret_tail = &remainder[secret_start..];
        let secret_end = secret_tail
            .find(|character: char| {
                character.is_whitespace()
                    || matches!(
                        character,
                        '"' | '\'' | '`' | ',' | ';' | ')' | ']' | '}' | '<' | '>'
                    )
            })
            .unwrap_or(secret_tail.len());
        remainder = &secret_tail[secret_end..];
    }

    output.push_str(remainder);
    output
}

fn redact_codex_transcript_secrets(text: &str) -> String {
    ["sk-proj-", "sk-", "github_pat_", "ghp_", "gho_", "glpat-"]
        .iter()
        .fold(text.to_string(), |current, prefix| {
            redact_prefixed_secret(&current, prefix)
        })
}

fn append_transcript_truncation_marker(output: &mut String) {
    if output.ends_with("[truncated]") {
        return;
    }
    if !output.is_empty() {
        output.push_str("\n\n");
    }
    output.push_str("[truncated]");
}

fn clean_codex_transcript_text_with_truncation(
    value: impl AsRef<str>,
    max_chars: usize,
) -> (String, bool) {
    let redacted = redact_codex_transcript_secrets(value.as_ref());
    let mut output = String::with_capacity(redacted.len().min(max_chars));
    let mut previous_was_newline = false;
    let mut blank_lines = 0usize;
    let mut output_chars = 0usize;
    let mut truncated = false;

    for character in redacted.chars() {
        if output_chars >= max_chars {
            truncated = true;
            break;
        }
        let character = match character {
            '\r' => '\n',
            '\n' | '\t' => character,
            value if value.is_control() => ' ',
            value => value,
        };

        if character == '\n' {
            if previous_was_newline {
                blank_lines += 1;
                if blank_lines > 2 {
                    continue;
                }
            } else {
                blank_lines = 0;
            }
            previous_was_newline = true;
        } else if !character.is_whitespace() {
            previous_was_newline = false;
            blank_lines = 0;
        }

        output.push(character);
        output_chars = output_chars.saturating_add(1);
    }

    output = output.trim().to_string();
    if truncated {
        append_transcript_truncation_marker(&mut output);
    }
    (output, truncated)
}

fn clean_codex_transcript_text(value: impl AsRef<str>, max_chars: usize) -> String {
    clean_codex_transcript_text_with_truncation(value, max_chars).0
}

fn clean_codex_reasoning_text(value: impl AsRef<str>) -> String {
    let (cleaned, pre_truncated) = clean_codex_transcript_text_with_truncation(
        value,
        CODEX_TRANSCRIPT_MAX_REASONING_TEXT + 1024,
    );
    if cleaned.chars().count() <= CODEX_TRANSCRIPT_MAX_REASONING_TEXT {
        return cleaned;
    }
    let mut output = cleaned
        .chars()
        .take(CODEX_TRANSCRIPT_MAX_REASONING_TEXT)
        .collect::<String>();
    if let Some((index, _)) = output
        .char_indices()
        .rev()
        .take_while(|(index, _)| output.len().saturating_sub(*index) <= 1024)
        .find(|(_, character)| character.is_whitespace())
    {
        output.truncate(index);
    }
    output = output.trim().to_string();
    if pre_truncated || cleaned.chars().count() > CODEX_TRANSCRIPT_MAX_REASONING_TEXT {
        append_transcript_truncation_marker(&mut output);
    }
    output
}

fn clean_codex_title(value: impl AsRef<str>, fallback: &str) -> String {
    let title = clean_codex_transcript_text(value, 160)
        .lines()
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    if title.is_empty() {
        fallback.to_string()
    } else if title.chars().count() > 96 {
        format!("{}...", truncate_chars(&title, 93).trim())
    } else {
        title
    }
}

fn codex_content_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(codex_content_text)
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(object) => {
            for key in ["text", "input_text", "output_text", "message"] {
                if let Some(text) = object.get(key).and_then(Value::as_str) {
                    return text.to_string();
                }
            }

            if let Some(content) = object.get("content") {
                return codex_content_text(content);
            }

            String::new()
        }
        _ => String::new(),
    }
}

fn codex_first_content_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(codex_first_content_text)
            .find(|text| !text.trim().is_empty())
            .unwrap_or_default(),
        Value::Object(object) => {
            for key in ["text", "input_text", "output_text", "message"] {
                if let Some(text) = object.get(key).and_then(Value::as_str) {
                    return text.to_string();
                }
            }

            if let Some(content) = object.get("content") {
                return codex_first_content_text(content);
            }

            String::new()
        }
        _ => String::new(),
    }
}

fn codex_user_message_internal_context_text(text: &str) -> bool {
    let text = text.trim();
    [
        "# AGENTS.md instructions",
        "<INSTRUCTIONS>",
        "<!-- DIFFFORGE_AGENT_CONTRACT_BEGIN -->",
        "<environment_context>",
        "<turn_aborted",
        "<turn_interrupted",
    ]
    .iter()
    .any(|marker| text.starts_with(marker))
}

fn codex_response_item_user_message_is_internal_context(payload: &Value) -> bool {
    if payload.get("type").and_then(Value::as_str) != Some("message")
        || payload.get("role").and_then(Value::as_str) != Some("user")
    {
        return false;
    }
    let content = payload.get("content").unwrap_or(&Value::Null);
    codex_user_message_internal_context_text(&codex_first_content_text(content))
}

fn codex_response_item_user_message_normalized_text(payload: &Value) -> Option<String> {
    if payload.get("type").and_then(Value::as_str) != Some("message")
        || payload.get("role").and_then(Value::as_str) != Some("user")
    {
        return None;
    }
    let text = codex_normalize_user_prompt_text(codex_content_text(
        payload.get("content").unwrap_or(&Value::Null),
    ));
    (!text.is_empty()).then_some(text)
}

fn codex_event_user_message_normalized_text(payload: &Value) -> Option<String> {
    if payload.get("type").and_then(Value::as_str) != Some("user_message") {
        return None;
    }
    let text = codex_normalize_user_prompt_text(value_string(payload.get("message")));
    (!text.is_empty()).then_some(text)
}

fn codex_value_is_turn_context(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("turn_context")
}

fn codex_value_is_environment_context(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("environment_context")
        || value.get("environment_context").is_some()
        || value.get("environmentContext").is_some()
}

fn codex_value_internal_context_response_item(value: &Value) -> bool {
    value.get("type").and_then(Value::as_str) == Some("response_item")
        && codex_response_item_user_message_is_internal_context(
            value.get("payload").unwrap_or(&Value::Null),
        )
}

fn codex_value_is_internal_context_record(value: &Value) -> bool {
    codex_value_is_turn_context(value)
        || codex_value_is_environment_context(value)
        || codex_value_internal_context_response_item(value)
}

fn clean_codex_artifact_reference(value: &str) -> String {
    value
        .trim()
        .trim_matches(|ch: char| {
            matches!(
                ch,
                '`' | '"' | '\'' | '<' | '>' | '[' | ']' | '(' | ')' | ',' | ';'
            )
        })
        .trim()
        .to_string()
}

fn codex_percent_decode_path(value: &str) -> String {
    let bytes = value.as_bytes();
    if !bytes.contains(&b'%') {
        return value.to_string();
    }

    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' || index + 2 >= bytes.len() {
            output.push(bytes[index]);
            index += 1;
            continue;
        }

        let hi = (bytes[index + 1] as char).to_digit(16);
        let lo = (bytes[index + 2] as char).to_digit(16);
        match (hi, lo) {
            (Some(hi), Some(lo)) => {
                output.push(((hi << 4) | lo) as u8);
                index += 3;
            }
            _ => {
                output.push(bytes[index]);
                index += 1;
            }
        }
    }

    String::from_utf8(output).unwrap_or_else(|_| value.to_string())
}

fn codex_file_url_for_path(path: &Path) -> String {
    let path = path.to_string_lossy().replace('\\', "/");
    format!("file://{}", path.replace('%', "%25").replace(' ', "%20"))
}

fn codex_artifact_extension(reference: &str) -> String {
    let reference = reference
        .split(['?', '#'])
        .next()
        .unwrap_or(reference)
        .trim_end_matches('/');
    Path::new(reference)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn codex_image_mime(reference: &str, explicit_mime: &str) -> String {
    let explicit_mime = explicit_mime.trim().to_lowercase();
    if explicit_mime.starts_with("image/") {
        return explicit_mime;
    }

    match codex_artifact_extension(reference).as_str() {
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "",
    }
    .to_string()
}

fn codex_artifact_path_url(reference: &str) -> (String, String) {
    let reference = clean_codex_artifact_reference(reference);
    if reference.starts_with("file://") {
        let mut path = reference.trim_start_matches("file://").to_string();
        if let Some(stripped) = path.strip_prefix("localhost/") {
            path = format!("/{stripped}");
        }
        return (codex_percent_decode_path(&path), reference);
    }
    if reference.starts_with("http://")
        || reference.starts_with("https://")
        || reference.starts_with("data:")
    {
        return (String::new(), reference);
    }
    if reference.starts_with('/') || reference.starts_with("~/") {
        let path = codex_percent_decode_path(&reference);
        return (path.clone(), codex_file_url_for_path(Path::new(&path)));
    }

    (reference.clone(), reference)
}

fn codex_image_artifact(
    reference: &str,
    title: &str,
    prompt: &str,
    explicit_mime: &str,
) -> Option<CodexThreadTranscriptArtifact> {
    let reference = clean_codex_artifact_reference(reference);
    if reference.is_empty() {
        return None;
    }
    if reference.contains("_image_id_") {
        return None;
    }

    let mime_type = codex_image_mime(&reference, explicit_mime);
    if mime_type.is_empty() {
        return None;
    }

    let (path, url) = codex_artifact_path_url(&reference);
    Some(CodexThreadTranscriptArtifact {
        kind: "image".to_string(),
        mime_type,
        path,
        url,
        title: clean_codex_title(title, "Generated image"),
        prompt: prompt.trim().to_string(),
        asset_id: String::new(),
        asset_path: String::new(),
        original_path: String::new(),
    })
}

fn codex_artifact_path_from_reference(reference: &str) -> Option<PathBuf> {
    let (path, _) = codex_artifact_path_url(reference);
    let path = path.trim();
    if path.is_empty() || !(path.starts_with('/') || path.starts_with("~/")) {
        return None;
    }

    if let Some(stripped) = path.strip_prefix("~/") {
        return env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join(stripped))
            .or_else(|| Some(PathBuf::from(path)));
    }

    Some(PathBuf::from(path))
}

fn codex_generated_image_source_path(artifact: &CodexThreadTranscriptArtifact) -> Option<PathBuf> {
    if !artifact
        .mime_type
        .to_ascii_lowercase()
        .starts_with("image/")
    {
        return None;
    }
    let path = codex_artifact_path_from_reference(&artifact.path)?;
    let path_key = path.to_string_lossy().replace('\\', "/");
    if !path_key.contains("/generated_images/") {
        return None;
    }
    if !path.is_file() {
        return None;
    }
    Some(path)
}

fn promote_generated_image_artifacts(
    messages: &mut [CodexThreadTranscriptMessage],
    cwd: &str,
    workspace_id: Option<&str>,
) {
    for message in messages {
        for artifact in &mut message.artifacts {
            let Some(source_path) = codex_generated_image_source_path(artifact) else {
                continue;
            };
            let name_hint = Path::new(&artifact.path)
                .file_name()
                .and_then(|value| value.to_str())
                .filter(|value| !value.trim().is_empty());
            let promoted = cloud_mcp_promote_generated_asset_to_library(
                Some(cwd),
                workspace_id,
                &source_path,
                name_hint,
                Some(&artifact.prompt),
            );
            let Ok(promoted) = promoted else {
                continue;
            };
            let asset_path =
                cloud_mcp_payload_text(&promoted, &["local_path", "path"]).unwrap_or_default();
            if asset_path.is_empty() {
                continue;
            }
            let asset_id =
                cloud_mcp_payload_text(&promoted, &["asset_id", "id"]).unwrap_or_default();
            let original_path = artifact.path.clone();
            artifact.asset_id = asset_id;
            artifact.asset_path = asset_path.clone();
            if artifact.original_path.is_empty() {
                artifact.original_path = original_path;
            }
            artifact.path = asset_path.clone();
            artifact.url = codex_file_url_for_path(Path::new(&asset_path));
        }
    }
}

fn promote_result_generated_image_artifacts(
    result: &mut CodexThreadTranscriptResult,
    workspace_id: Option<&str>,
) {
    let cwd = result.cwd.clone();
    promote_generated_image_artifacts(&mut result.messages, &cwd, workspace_id);
}

fn promoted_generated_asset_event(
    result: &CodexThreadTranscriptResult,
    _workspace_id: Option<&str>,
    reason: &str,
) -> Option<Value> {
    let mut seen = HashSet::new();
    let mut assets = Vec::new();
    for artifact in result
        .messages
        .iter()
        .flat_map(|message| &message.artifacts)
    {
        if artifact.asset_path.trim().is_empty() {
            continue;
        }
        let key = if artifact.asset_id.trim().is_empty() {
            artifact.asset_path.clone()
        } else {
            artifact.asset_id.clone()
        };
        if !seen.insert(key.clone()) {
            continue;
        }
        assets.push(json!({
            "asset_id": artifact.asset_id,
            "local_path": artifact.asset_path,
            "original_path": artifact.original_path,
            "path": artifact.asset_path,
        }));
    }
    if assets.is_empty() {
        return None;
    }

    Some(json!({
        "event_kind": "account_assets_updated",
        "kind": "account_assets_updated",
        "reason": reason,
        "source": "codex_imagegen_autocopy",
        "assets": assets,
    }))
}

fn emit_promoted_generated_asset_event(
    app: &AppHandle,
    result: &CodexThreadTranscriptResult,
    workspace_id: Option<&str>,
    reason: &str,
) {
    let Some(event) = promoted_generated_asset_event(result, workspace_id, reason) else {
        return;
    };
    let _ = app.emit(CLOUD_MCP_ACCOUNT_ASSETS_UPDATED_EVENT, event);
}

fn codex_path_has_generated_images(path: &Path) -> bool {
    path.to_string_lossy()
        .replace('\\', "/")
        .contains("/generated_images/")
}

fn collect_codex_generated_image_dir_artifacts(
    reference: &str,
    title: &str,
    prompt: &str,
    artifacts: &mut Vec<CodexThreadTranscriptArtifact>,
    seen: &mut HashSet<String>,
) {
    let Some(path) = codex_artifact_path_from_reference(reference) else {
        return;
    };
    if !codex_path_has_generated_images(&path) {
        return;
    }

    if path.is_file() {
        let path = path.to_string_lossy().to_string();
        push_codex_image_artifact(artifacts, seen, &path, title, prompt, "");
        return;
    }

    let scan_dir = if path.is_dir() {
        path
    } else if codex_image_mime(&path.to_string_lossy(), "").starts_with("image/") {
        match path.parent() {
            Some(parent) => parent.to_path_buf(),
            None => return,
        }
    } else {
        return;
    };
    if !scan_dir.is_dir() {
        return;
    }

    let Ok(entries) = fs::read_dir(scan_dir) else {
        return;
    };
    let mut image_paths = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .filter(|path| codex_image_mime(&path.to_string_lossy(), "").starts_with("image/"))
        .collect::<Vec<_>>();
    image_paths.sort();

    for path in image_paths
        .into_iter()
        .take(CODEX_GENERATED_IMAGE_DIR_SCAN_LIMIT)
    {
        let path = path.to_string_lossy().to_string();
        push_codex_image_artifact(artifacts, seen, &path, title, prompt, "");
    }
}

fn text_before_any_marker<'a>(text: &'a str, markers: &[&str]) -> &'a str {
    let lower = text.to_ascii_lowercase();
    let end = markers
        .iter()
        .filter_map(|marker| lower.find(marker))
        .min()
        .unwrap_or(text.len());
    &text[..end]
}

fn push_codex_image_artifact(
    artifacts: &mut Vec<CodexThreadTranscriptArtifact>,
    seen: &mut HashSet<String>,
    reference: &str,
    title: &str,
    prompt: &str,
    explicit_mime: &str,
) {
    let Some(artifact) = codex_image_artifact(reference, title, prompt, explicit_mime) else {
        return;
    };
    let key = if artifact.url.is_empty() {
        artifact.path.clone()
    } else {
        artifact.url.clone()
    };
    if seen.insert(key) {
        artifacts.push(artifact);
    }
}

fn collect_codex_generated_image_notice_artifacts(
    line: &str,
    title: &str,
    prompt: &str,
    artifacts: &mut Vec<CodexThreadTranscriptArtifact>,
    seen: &mut HashSet<String>,
) {
    let lower = line.to_ascii_lowercase();
    for marker in [
        "generated images are saved to ",
        "generated image is saved to ",
        "generated images saved to ",
        "generated image saved to ",
    ] {
        let Some(index) = lower.find(marker) else {
            continue;
        };
        let after_marker = &line[index + marker.len()..];
        let directory =
            text_before_any_marker(after_marker, &[" as ", " by default", " unless "]).trim();
        collect_codex_generated_image_dir_artifacts(directory, title, prompt, artifacts, seen);

        let after_marker_lower = after_marker.to_ascii_lowercase();
        if let Some(as_index) = after_marker_lower.find(" as ") {
            let after_as = &after_marker[as_index + " as ".len()..];
            let pattern = text_before_any_marker(after_as, &[" by default", " unless "]).trim();
            collect_codex_generated_image_dir_artifacts(pattern, title, prompt, artifacts, seen);
        }
    }
}

fn codex_generated_image_prompt(text: &str) -> String {
    for line in text.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();
        for marker in ["prompt used:", "prompt:"] {
            if let Some(index) = lower.find(marker) {
                return trimmed[index + marker.len()..].trim().to_string();
            }
        }
    }

    String::new()
}

fn collect_codex_image_artifacts_from_text(
    text: &str,
    title: &str,
    prompt: &str,
    artifacts: &mut Vec<CodexThreadTranscriptArtifact>,
    seen: &mut HashSet<String>,
) {
    for line in text.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();
        collect_codex_generated_image_notice_artifacts(trimmed, title, prompt, artifacts, seen);

        if lower.starts_with("<image") {
            if let Some(path_index) = lower.find("path=") {
                let value = trimmed[path_index + "path=".len()..].trim_start();
                let reference = if let Some(quote) =
                    value.chars().next().filter(|ch| *ch == '"' || *ch == '\'')
                {
                    value[quote.len_utf8()..]
                        .split(quote)
                        .next()
                        .unwrap_or_default()
                } else {
                    value
                        .split(|ch: char| ch.is_whitespace() || ch == '>')
                        .next()
                        .unwrap_or_default()
                };
                push_codex_image_artifact(artifacts, seen, reference, title, prompt, "");
            }
            continue;
        }

        for marker in ["saved to:", "generated image:", "image:", "path:"] {
            if lower.starts_with(marker) {
                push_codex_image_artifact(
                    artifacts,
                    seen,
                    trimmed[marker.len()..].trim(),
                    title,
                    prompt,
                    "",
                );
            }
        }

        if let Some(index) = trimmed.find("file://") {
            push_codex_image_artifact(artifacts, seen, &trimmed[index..], title, prompt, "");
        }

        for token in trimmed.split_whitespace() {
            push_codex_image_artifact(artifacts, seen, token, title, prompt, "");
        }
    }
}

fn collect_codex_image_artifacts_from_value(
    value: &Value,
    title: &str,
    prompt: &str,
    artifacts: &mut Vec<CodexThreadTranscriptArtifact>,
    seen: &mut HashSet<String>,
) {
    match value {
        Value::String(text) => {
            collect_codex_image_artifacts_from_text(text, title, prompt, artifacts, seen);
        }
        Value::Array(items) => {
            for item in items {
                collect_codex_image_artifacts_from_value(item, title, prompt, artifacts, seen);
            }
        }
        Value::Object(object) => {
            let explicit_mime = object
                .get("mime_type")
                .or_else(|| object.get("mimeType"))
                .or_else(|| object.get("content_type"))
                .or_else(|| object.get("contentType"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            let kind = object
                .get("kind")
                .or_else(|| object.get("type"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_lowercase();
            let object_title = object
                .get("title")
                .or_else(|| object.get("name"))
                .and_then(Value::as_str)
                .unwrap_or(title);
            let object_prompt = object
                .get("prompt")
                .and_then(Value::as_str)
                .unwrap_or(prompt);

            for key in [
                "path",
                "file_path",
                "filePath",
                "local_path",
                "localPath",
                "url",
                "uri",
                "file_url",
                "fileUrl",
                "image_url",
                "imageUrl",
                "src",
            ] {
                if let Some(reference) = object.get(key).and_then(Value::as_str) {
                    let mime_hint = if explicit_mime.starts_with("image/")
                        || kind.contains("image")
                        || key.to_lowercase().contains("image")
                    {
                        explicit_mime
                    } else {
                        ""
                    };
                    push_codex_image_artifact(
                        artifacts,
                        seen,
                        reference,
                        object_title,
                        object_prompt,
                        mime_hint,
                    );
                }
            }

            for value in object.values() {
                collect_codex_image_artifacts_from_value(
                    value,
                    object_title,
                    object_prompt,
                    artifacts,
                    seen,
                );
            }
        }
        _ => {}
    }
}

fn codex_image_artifacts_from_content(
    value: &Value,
    text: &str,
    fallback_title: &str,
) -> Vec<CodexThreadTranscriptArtifact> {
    let prompt = codex_generated_image_prompt(text);
    let title = if text.to_lowercase().contains("generated image") {
        "Generated image"
    } else {
        fallback_title
    };
    let mut artifacts = Vec::new();
    let mut seen = HashSet::new();
    collect_codex_image_artifacts_from_value(value, title, &prompt, &mut artifacts, &mut seen);
    collect_codex_image_artifacts_from_text(text, title, &prompt, &mut artifacts, &mut seen);
    artifacts
}

fn codex_artifact_activity_kind(text: &str, artifacts: &[CodexThreadTranscriptArtifact]) -> String {
    let lower = text.to_lowercase();
    if !artifacts.is_empty()
        && (lower.contains("generated image")
            || lower.contains("image generated")
            || lower.contains("prompt used:"))
    {
        return "image_generation".to_string();
    }

    "tool_output".to_string()
}

fn codex_artifact_activity_title(
    text: &str,
    fallback: &str,
    artifacts: &[CodexThreadTranscriptArtifact],
) -> String {
    if !artifacts.is_empty() && codex_artifact_activity_kind(text, artifacts) == "image_generation"
    {
        return "Generated image".to_string();
    }

    fallback.to_string()
}

fn transcript_tool_value_has_content(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(items) => items.iter().any(transcript_tool_value_has_content),
        Value::Object(object) => object.values().any(transcript_tool_value_has_content),
        _ => true,
    }
}

fn transcript_tool_value_status_is_error(value: &Value) -> bool {
    value
        .as_str()
        .map(|text| {
            matches!(
                text.trim().to_ascii_lowercase().as_str(),
                "error" | "failed" | "failure" | "denied"
            )
        })
        .unwrap_or(false)
}

fn transcript_tool_value_has_error(value: &Value) -> bool {
    let Some(object) = value.as_object() else {
        return false;
    };
    if ["is_error", "isError", "failed", "failure"]
        .iter()
        .any(|key| object.get(*key).and_then(Value::as_bool).unwrap_or(false))
    {
        return true;
    }
    if ["status", "state", "phase"].iter().any(|key| {
        object
            .get(*key)
            .is_some_and(transcript_tool_value_status_is_error)
    }) {
        return true;
    }
    if ["error", "toolError", "tool_error", "stderr"]
        .iter()
        .any(|key| {
            object
                .get(*key)
                .is_some_and(transcript_tool_value_has_content)
        })
    {
        return true;
    }
    ["output", "result", "response", "state"].iter().any(|key| {
        object
            .get(*key)
            .is_some_and(transcript_tool_value_has_error)
    })
}

fn codex_summary_text(payload: &Value) -> String {
    let Some(summary) = payload.get("summary") else {
        return String::new();
    };

    codex_content_text(summary)
}

fn pretty_json(value: &Value) -> String {
    serde_json::to_string_pretty(value).unwrap_or_else(|_| value.to_string())
}

fn parse_call_arguments(arguments: &Value) -> Option<Value> {
    if let Some(arguments) = arguments.as_str() {
        return serde_json::from_str(arguments).ok();
    }

    if arguments.is_object() || arguments.is_array() {
        return Some(arguments.clone());
    }

    None
}

fn transcript_value_is_present(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(object) => !object.is_empty(),
        _ => true,
    }
}

fn transcript_tool_io_value(
    value: Option<&Value>,
    fallback_text: impl AsRef<str>,
    max_chars: usize,
) -> (Option<Value>, bool) {
    if let Some(value) = value.filter(|value| transcript_value_is_present(value)) {
        return match value {
            Value::String(text) => {
                let (text, truncated) =
                    clean_codex_transcript_text_with_truncation(text, max_chars);
                ((!text.is_empty()).then(|| Value::String(text)), truncated)
            }
            Value::Array(_) | Value::Object(_) => (Some(value.clone()), false),
            _ => (Some(value.clone()), false),
        };
    }

    let fallback_text = fallback_text.as_ref();
    if fallback_text.trim().is_empty() {
        return (None, false);
    }
    let (text, truncated) = clean_codex_transcript_text_with_truncation(fallback_text, max_chars);
    ((!text.is_empty()).then(|| Value::String(text)), truncated)
}

fn transcript_tool_object(
    name: impl AsRef<str>,
    call_id: impl AsRef<str>,
    status: impl AsRef<str>,
    input: Option<Value>,
    output: Option<Value>,
    title: impl AsRef<str>,
) -> Value {
    let mut object = serde_json::Map::new();
    let name = name.as_ref().trim();
    if !name.is_empty() {
        object.insert("name".to_string(), json!(name));
    }
    let call_id = call_id.as_ref().trim();
    if !call_id.is_empty() {
        object.insert("call_id".to_string(), json!(call_id));
    }
    let status = status.as_ref().trim();
    if !status.is_empty() {
        object.insert("status".to_string(), json!(status));
    }
    if let Some(input) = input.filter(transcript_value_is_present) {
        object.insert("input".to_string(), input);
    }
    if let Some(output) = output.filter(transcript_value_is_present) {
        object.insert("output".to_string(), output);
    }
    let title = title.as_ref().trim();
    if !title.is_empty() {
        object.insert("title".to_string(), json!(title));
    }
    Value::Object(object)
}

#[derive(Clone, Default)]
struct TranscriptToolCallMetadata {
    name: String,
    title: String,
}

fn transcript_tool_message_name(message: &CodexThreadTranscriptMessage) -> String {
    message
        .tool
        .as_ref()
        .and_then(|tool| tool.get("name"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn transcript_tool_message_title(message: &CodexThreadTranscriptMessage) -> String {
    message
        .tool
        .as_ref()
        .and_then(|tool| tool.get("title"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(message.title.as_str())
        .trim()
        .to_string()
}

fn transcript_record_tool_call_metadata(
    tool_metadata: &mut HashMap<String, TranscriptToolCallMetadata>,
    message: &CodexThreadTranscriptMessage,
) {
    if message.kind != "tool_call" || message.call_id.trim().is_empty() {
        return;
    }
    let metadata = TranscriptToolCallMetadata {
        name: transcript_tool_message_name(message),
        title: transcript_tool_message_title(message),
    };
    if metadata.name.is_empty() && metadata.title.is_empty() {
        return;
    }
    tool_metadata.insert(message.call_id.clone(), metadata);
}

fn transcript_apply_tool_call_metadata(
    tool_metadata: &HashMap<String, TranscriptToolCallMetadata>,
    message: &mut CodexThreadTranscriptMessage,
) {
    if message.call_id.trim().is_empty() || message.kind == "tool_call" {
        return;
    }
    let Some(metadata) = tool_metadata.get(message.call_id.as_str()) else {
        return;
    };
    let Some(tool) = message.tool.as_mut().and_then(Value::as_object_mut) else {
        return;
    };
    let name_is_empty = tool
        .get("name")
        .and_then(Value::as_str)
        .is_none_or(|value| value.trim().is_empty());
    if name_is_empty && !metadata.name.trim().is_empty() {
        tool.insert("name".to_string(), json!(metadata.name.clone()));
    }
    if !metadata.title.trim().is_empty() {
        tool.insert("title".to_string(), json!(metadata.title.clone()));
    }
}

fn push_codex_message_with_tool_metadata(
    messages: &mut Vec<CodexThreadTranscriptMessage>,
    seen: &mut HashSet<String>,
    message: Option<CodexThreadTranscriptMessage>,
    tool_metadata: &mut HashMap<String, TranscriptToolCallMetadata>,
) {
    let Some(mut message) = message else {
        return;
    };
    transcript_apply_tool_call_metadata(tool_metadata, &mut message);
    transcript_record_tool_call_metadata(tool_metadata, &message);
    push_codex_message(messages, seen, Some(message));
}

fn transcript_usage_number(value: Option<&Value>) -> Option<Value> {
    value.and_then(|value| match value {
        Value::Number(_) => Some(value.clone()),
        Value::String(text) if !text.trim().is_empty() => {
            Some(Value::String(text.trim().to_string()))
        }
        _ => None,
    })
}

fn transcript_usage_from_value(value: &Value) -> Option<Value> {
    let usage = value
        .get("usage")
        .or_else(|| value.get("token_usage"))
        .or_else(|| value.get("tokenUsage"))
        .or_else(|| value.get("usage_report"))
        .or_else(|| value.get("usageReport"))
        .or_else(|| {
            value
                .get("message")
                .and_then(|message| message.get("usage"))
        })
        .unwrap_or(value);
    let mut object = serde_json::Map::new();
    for (target, aliases) in [
        (
            "input_tokens",
            &[
                "input_tokens",
                "inputTokens",
                "prompt_tokens",
                "promptTokens",
            ][..],
        ),
        (
            "output_tokens",
            &[
                "output_tokens",
                "outputTokens",
                "completion_tokens",
                "completionTokens",
            ][..],
        ),
        (
            "cache_read_tokens",
            &[
                "cache_read_tokens",
                "cacheReadTokens",
                "cache_read_input_tokens",
                "cacheReadInputTokens",
                "cached_input_tokens",
                "cachedInputTokens",
            ][..],
        ),
        (
            "cache_write_tokens",
            &[
                "cache_write_tokens",
                "cacheWriteTokens",
                "cache_creation_input_tokens",
                "cacheCreationInputTokens",
            ][..],
        ),
        ("cost_usd", &["cost_usd", "costUsd", "costUSD", "cost"][..]),
    ] {
        let value = aliases
            .iter()
            .find_map(|key| transcript_usage_number(usage.get(*key)));
        if let Some(value) = value {
            object.insert(target.to_string(), value);
        }
    }
    (!object.is_empty()).then(|| Value::Object(object))
}

fn transcript_cumulative_usage_from_value(value: &Value) -> Option<Value> {
    let usage = value
        .get("info")
        .and_then(|info| info.get("total_token_usage"))
        .or_else(|| value.get("total_token_usage"))
        .or_else(|| value.get("totalTokenUsage"))?;
    let mut usage = transcript_usage_from_value(usage)?;
    if let Some(object) = usage.as_object_mut() {
        object.insert("cumulative".to_string(), json!(true));
        object.insert("is_cumulative".to_string(), json!(true));
        object.insert("usage_kind".to_string(), json!("cumulative"));
    }
    Some(usage)
}

#[derive(Clone, Default)]
struct TranscriptClaudeSidechainRow {
    parent_id: String,
}

#[derive(Default)]
struct TranscriptClaudeSidechainTracker {
    rows: HashMap<String, TranscriptClaudeSidechainRow>,
}

fn transcript_row_uuid_from_value(value: &Value) -> String {
    first_value_string(&[value.get("uuid"), value.get("id")])
}

fn transcript_parent_id_from_value(value: &Value) -> String {
    first_value_string(&[
        value.get("parentUuid"),
        value.get("parent_uuid"),
        value.get("parentId"),
        value.get("parent_id"),
        value.get("parentAgentId"),
        value.get("parent_agent_id"),
    ])
}

fn transcript_sidechain_id_from_value(value: &Value) -> String {
    first_value_string(&[
        value.get("sidechainId"),
        value.get("sidechain_id"),
        value.get("sidechainUuid"),
        value.get("sidechain_uuid"),
    ])
}

fn transcript_has_explicit_sidechain_evidence(value: &Value) -> bool {
    value
        .get("isSidechain")
        .or_else(|| value.get("is_sidechain"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || !transcript_sidechain_id_from_value(value).trim().is_empty()
}

fn transcript_set_subagent_id(object: &mut serde_json::Map<String, Value>, subagent_id: String) {
    if subagent_id.trim().is_empty() {
        return;
    }
    object.insert("subagent_id".to_string(), json!(subagent_id));
}

impl TranscriptClaudeSidechainTracker {
    fn root_parent_id(&self, row_id: &str, parent_id: &str) -> String {
        let mut current = if row_id.trim().is_empty() {
            parent_id.trim().to_string()
        } else {
            row_id.trim().to_string()
        };
        let mut seen = HashSet::new();
        while !current.trim().is_empty() && seen.insert(current.clone()) {
            let Some(row) = self.rows.get(current.trim()) else {
                return current;
            };
            if row.parent_id.trim().is_empty() {
                return current;
            }
            current = row.parent_id.trim().to_string();
        }
        parent_id.trim().to_string()
    }

    fn subagent_from_value(&mut self, value: &Value, fallback_title: &str) -> Option<Value> {
        if !transcript_has_explicit_sidechain_evidence(value) {
            return None;
        }
        let row_id = transcript_row_uuid_from_value(value);
        let parent_id = transcript_parent_id_from_value(value);
        if !row_id.trim().is_empty() {
            self.rows.insert(
                row_id.clone(),
                TranscriptClaudeSidechainRow {
                    parent_id: parent_id.clone(),
                },
            );
        }
        let explicit_sidechain_id = transcript_sidechain_id_from_value(value);
        let subagent_id = if !explicit_sidechain_id.trim().is_empty() {
            explicit_sidechain_id
        } else {
            self.root_parent_id(&row_id, &parent_id)
        };
        let mut subagent = transcript_sidechain_subagent_from_value(value, fallback_title)?;
        if let Some(object) = subagent.as_object_mut() {
            transcript_set_subagent_id(object, subagent_id);
        }
        Some(subagent)
    }
}

fn transcript_subagent_from_value(value: &Value, fallback_title: &str) -> Option<Value> {
    let is_sidechain = value
        .get("isSidechain")
        .or_else(|| value.get("is_sidechain"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let parent_id = transcript_parent_id_from_value(value);
    let sidechain_id = transcript_sidechain_id_from_value(value);
    let sidechain_like =
        is_sidechain || !parent_id.trim().is_empty() || !sidechain_id.trim().is_empty();
    let explicit_subagent_id = first_value_string(&[
        value.get("subagentId"),
        value.get("subagent_id"),
        value.get("agentId"),
        value.get("agent_id"),
    ]);
    let subagent_id = if sidechain_like {
        if !sidechain_id.trim().is_empty() {
            sidechain_id.clone()
        } else if !parent_id.trim().is_empty() {
            parent_id.clone()
        } else {
            explicit_subagent_id
        }
    } else {
        let native_subagent_id = first_value_string(&[
            value.get("uuid"),
            value.get("id"),
            value.get("sessionId"),
            value.get("session_id"),
        ]);
        if native_subagent_id.trim().is_empty() {
            explicit_subagent_id
        } else {
            native_subagent_id
        }
    };
    let title = first_value_string(&[
        value.get("title"),
        value.get("name"),
        value.get("description"),
        value.get("summary"),
    ]);
    let status = first_value_string(&[value.get("status"), value.get("state")]);
    if !is_sidechain
        && parent_id.trim().is_empty()
        && sidechain_id.trim().is_empty()
        && title.trim().is_empty()
        && status.trim().is_empty()
    {
        return None;
    }
    let mut object = serde_json::Map::new();
    if !subagent_id.trim().is_empty() {
        transcript_set_subagent_id(&mut object, subagent_id);
    }
    if !parent_id.trim().is_empty() {
        object.insert("parent_id".to_string(), json!(parent_id));
    }
    if !sidechain_id.trim().is_empty() {
        object.insert("sidechain_id".to_string(), json!(sidechain_id));
    }
    let title = if title.trim().is_empty() {
        fallback_title.to_string()
    } else {
        title
    };
    if !title.trim().is_empty() {
        object.insert("title".to_string(), json!(title));
    }
    if !status.trim().is_empty() {
        object.insert("status".to_string(), json!(status));
    }
    Some(Value::Object(object))
}

fn transcript_sidechain_subagent_from_value(value: &Value, fallback_title: &str) -> Option<Value> {
    if !transcript_has_explicit_sidechain_evidence(value) {
        return None;
    }
    transcript_subagent_from_value(value, fallback_title)
}

fn transcript_subagent_link_id(subagent: &Value) -> String {
    first_value_string(&[
        subagent.get("subagent_id"),
        subagent.get("subagentId"),
        subagent.get("agent_id"),
        subagent.get("agentId"),
        subagent.get("sidechain_id"),
        subagent.get("sidechainId"),
        subagent.get("sidechainUuid"),
        subagent.get("sidechain_uuid"),
        subagent.get("parent_id"),
        subagent.get("parentId"),
        subagent.get("parentUuid"),
        subagent.get("parent_uuid"),
    ])
}

fn transcript_subagent_message(
    id: String,
    source: &str,
    timestamp: &str,
    subagent: Value,
    fallback_title: &str,
) -> CodexThreadTranscriptMessage {
    let title = subagent
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(fallback_title)
        .to_string();
    CodexThreadTranscriptMessage {
        id,
        role: "activity".to_string(),
        kind: "subagent".to_string(),
        legacy_kind: "tool_call".to_string(),
        text: title.clone(),
        title,
        created_at: timestamp.to_string(),
        source: source.to_string(),
        subagent_id: transcript_subagent_link_id(&subagent),
        subagent: Some(subagent),
        ..Default::default()
    }
}

fn transcript_stamp_messages_with_subagent_scope(
    messages: &mut [CodexThreadTranscriptMessage],
    subagent: Option<&Value>,
) {
    let Some(subagent) = subagent else {
        return;
    };
    let subagent_id = transcript_subagent_link_id(subagent);
    if subagent_id.trim().is_empty() {
        return;
    }
    for message in messages {
        if message.subagent_id.trim().is_empty() {
            message.subagent_id = subagent_id.clone();
        }
        if message.subagent.is_none() {
            message.subagent = Some(subagent.clone());
        }
    }
}

fn transcript_codex_subagent_scope_event(payload: &Value) -> Option<(bool, bool, Value)> {
    let event_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let is_start = matches!(event_type, "ss" | "subagent_start");
    let is_end = matches!(event_type, "se" | "subagent_end");
    if !is_start && !is_end {
        return None;
    }
    let fallback = if is_end {
        "Subagent finished"
    } else {
        "Subagent started"
    };
    transcript_subagent_from_value(payload, fallback)
        .or_else(|| {
            let subagent_id = first_value_string(&[
                payload.get("subagentId"),
                payload.get("subagent_id"),
                payload.get("agentId"),
                payload.get("agent_id"),
                payload.get("id"),
            ]);
            if subagent_id.trim().is_empty() {
                return None;
            }
            let mut object = serde_json::Map::new();
            transcript_set_subagent_id(&mut object, subagent_id);
            object.insert("title".to_string(), json!(fallback));
            Some(Value::Object(object))
        })
        .map(|subagent| (is_start, is_end, subagent))
}

fn transcript_apply_codex_subagent_scope(
    active_subagents: &mut Vec<Value>,
    payload: &Value,
    messages: &mut [CodexThreadTranscriptMessage],
) {
    let scope_event = transcript_codex_subagent_scope_event(payload);
    if let Some((true, _, subagent)) = scope_event.as_ref() {
        active_subagents.push(subagent.clone());
    }
    let active = active_subagents
        .last()
        .or_else(|| scope_event.as_ref().map(|(_, _, subagent)| subagent));
    transcript_stamp_messages_with_subagent_scope(messages, active);
    if let Some((_, true, subagent)) = scope_event {
        let subagent_id = transcript_subagent_link_id(&subagent);
        if let Some(index) = active_subagents
            .iter()
            .rposition(|active| transcript_subagent_link_id(active) == subagent_id)
        {
            active_subagents.remove(index);
        } else {
            active_subagents.pop();
        }
    }
}

fn transcript_file_kind(value: &str) -> &'static str {
    let value = value.trim().to_ascii_lowercase();
    if value.contains("delete") || value.contains("remove") {
        "delete"
    } else if value.contains("create") || value.contains("add") || value == "new" {
        "create"
    } else if value.contains("rename") || value.contains("move") {
        "rename"
    } else {
        "edit"
    }
}

fn transcript_push_file_change_file(
    files: &mut Vec<Value>,
    seen: &mut HashSet<String>,
    path: String,
    kind: &str,
    additions: Option<i64>,
    deletions: Option<i64>,
) {
    let path = path.trim().trim_matches('"').to_string();
    if path.is_empty() || path == "/dev/null" {
        return;
    }
    let key = format!("{}:{}", kind, path);
    if !seen.insert(key) {
        return;
    }
    let mut object = serde_json::Map::new();
    object.insert("path".to_string(), json!(path));
    object.insert("kind".to_string(), json!(transcript_file_kind(kind)));
    if let Some(additions) = additions {
        object.insert("additions".to_string(), json!(additions.max(0)));
    }
    if let Some(deletions) = deletions {
        object.insert("deletions".to_string(), json!(deletions.max(0)));
    }
    files.push(Value::Object(object));
}

fn transcript_line_count(value: Option<&Value>) -> Option<i64> {
    value
        .and_then(Value::as_str)
        .map(|text| text.lines().count() as i64)
}

fn transcript_sum_line_counts<'a>(values: impl Iterator<Item = Option<&'a Value>>) -> Option<i64> {
    let mut found = false;
    let mut total = 0i64;
    for count in values.filter_map(transcript_line_count) {
        found = true;
        total = total.saturating_add(count);
    }
    found.then_some(total)
}

fn transcript_file_change_from_files(files: Vec<Value>) -> Option<Value> {
    if files.is_empty() {
        return None;
    }
    let mut object = serde_json::Map::new();
    object.insert("files".to_string(), Value::Array(files));
    Some(Value::Object(object))
}

fn transcript_claude_write_kind(input: &Value) -> &'static str {
    if [
        "existing",
        "existingFile",
        "existing_file",
        "overwrite",
        "replace",
    ]
    .iter()
    .any(|key| input.get(*key).and_then(Value::as_bool).unwrap_or(false))
    {
        "edit"
    } else if [
        "newFile", "new_file", "create", "created", "isNew", "is_new",
    ]
    .iter()
    .any(|key| input.get(*key).and_then(Value::as_bool).unwrap_or(false))
    {
        "create"
    } else {
        "create"
    }
}

fn transcript_file_change_from_claude_tool_input(name: &str, input: &Value) -> Option<Value> {
    let normalized = name.trim().to_ascii_lowercase();
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    match normalized.as_str() {
        "edit" => {
            let path = first_value_string(&[input.get("file_path"), input.get("filePath")]);
            if !path.trim().is_empty() {
                transcript_push_file_change_file(
                    &mut files,
                    &mut seen,
                    path,
                    "edit",
                    transcript_line_count(
                        input.get("new_string").or_else(|| input.get("newString")),
                    ),
                    transcript_line_count(
                        input.get("old_string").or_else(|| input.get("oldString")),
                    ),
                );
            }
        }
        "write" => {
            let path = first_value_string(&[input.get("file_path"), input.get("filePath")]);
            if !path.trim().is_empty() {
                transcript_push_file_change_file(
                    &mut files,
                    &mut seen,
                    path,
                    transcript_claude_write_kind(input),
                    transcript_line_count(input.get("content")),
                    Some(0),
                );
            }
        }
        "multiedit" => {
            let path = first_value_string(&[input.get("file_path"), input.get("filePath")]);
            if !path.trim().is_empty() {
                let edits = input
                    .get("edits")
                    .and_then(Value::as_array)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                let additions = transcript_sum_line_counts(
                    edits
                        .iter()
                        .map(|edit| edit.get("new_string").or_else(|| edit.get("newString"))),
                );
                let deletions = transcript_sum_line_counts(
                    edits
                        .iter()
                        .map(|edit| edit.get("old_string").or_else(|| edit.get("oldString"))),
                );
                transcript_push_file_change_file(
                    &mut files, &mut seen, path, "edit", additions, deletions,
                );
            }
        }
        "notebookedit" => {
            let path = first_value_string(&[
                input.get("notebook_path"),
                input.get("notebookPath"),
                input.get("file_path"),
                input.get("filePath"),
            ]);
            if !path.trim().is_empty() {
                transcript_push_file_change_file(
                    &mut files,
                    &mut seen,
                    path,
                    "edit",
                    transcript_line_count(
                        input
                            .get("new_source")
                            .or_else(|| input.get("newSource"))
                            .or_else(|| input.get("new_string"))
                            .or_else(|| input.get("newString"))
                            .or_else(|| input.get("source"))
                            .or_else(|| input.get("content")),
                    ),
                    transcript_line_count(
                        input
                            .get("old_source")
                            .or_else(|| input.get("oldSource"))
                            .or_else(|| input.get("old_string"))
                            .or_else(|| input.get("oldString")),
                    ),
                );
            }
        }
        _ => {}
    }
    transcript_file_change_from_files(files)
}

fn transcript_collect_file_changes_from_value(
    value: &Value,
    files: &mut Vec<Value>,
    seen: &mut HashSet<String>,
) {
    match value {
        Value::Array(items) => {
            for item in items {
                transcript_collect_file_changes_from_value(item, files, seen);
            }
        }
        Value::Object(object) => {
            let path = first_value_string(&[
                object.get("path"),
                object.get("file"),
                object.get("filePath"),
                object.get("file_path"),
                object.get("filename"),
                object.get("name"),
            ]);
            if !path.trim().is_empty() {
                let kind = first_value_string(&[
                    object.get("kind"),
                    object.get("type"),
                    object.get("action"),
                    object.get("operation"),
                    object.get("status"),
                ]);
                let additions = object
                    .get("additions")
                    .or_else(|| object.get("added"))
                    .and_then(Value::as_i64);
                let deletions = object
                    .get("deletions")
                    .or_else(|| object.get("deleted"))
                    .or_else(|| object.get("removals"))
                    .and_then(Value::as_i64);
                transcript_push_file_change_file(files, seen, path, &kind, additions, deletions);
            }
            for key in ["files", "changes", "edits", "diffs", "patches"] {
                if let Some(child) = object.get(key) {
                    transcript_collect_file_changes_from_value(child, files, seen);
                }
            }
            for key in ["patch", "diff", "stdout", "stderr", "summary"] {
                if let Some(text) = object.get(key).and_then(Value::as_str) {
                    transcript_collect_file_changes_from_text(text, files, seen);
                }
            }
        }
        Value::String(text) => transcript_collect_file_changes_from_text(text, files, seen),
        _ => {}
    }
}

fn transcript_collect_file_changes_from_text(
    text: &str,
    files: &mut Vec<Value>,
    seen: &mut HashSet<String>,
) {
    let mut current_path = String::new();
    let mut additions = 0i64;
    let mut deletions = 0i64;
    let flush_current = |files: &mut Vec<Value>,
                         seen: &mut HashSet<String>,
                         path: &mut String,
                         additions: &mut i64,
                         deletions: &mut i64| {
        if !path.trim().is_empty() {
            transcript_push_file_change_file(
                files,
                seen,
                std::mem::take(path),
                "edit",
                Some(*additions),
                Some(*deletions),
            );
        }
        *additions = 0;
        *deletions = 0;
    };

    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("diff --git ") {
            flush_current(
                files,
                seen,
                &mut current_path,
                &mut additions,
                &mut deletions,
            );
            let candidate = rest
                .split_whitespace()
                .nth(1)
                .or_else(|| rest.split_whitespace().next())
                .unwrap_or_default()
                .trim_start_matches("b/")
                .trim_start_matches("a/")
                .to_string();
            current_path = candidate;
            continue;
        }
        if let Some(path) = trimmed.strip_prefix("+++ b/") {
            if current_path.trim().is_empty() {
                current_path = path.trim().to_string();
            }
            continue;
        }
        if let Some(path) = trimmed.strip_prefix("M ") {
            transcript_push_file_change_file(files, seen, path.to_string(), "edit", None, None);
            continue;
        }
        if let Some(path) = trimmed.strip_prefix("A ") {
            transcript_push_file_change_file(files, seen, path.to_string(), "create", None, None);
            continue;
        }
        if let Some(path) = trimmed.strip_prefix("D ") {
            transcript_push_file_change_file(files, seen, path.to_string(), "delete", None, None);
            continue;
        }
        if trimmed.starts_with('+') && !trimmed.starts_with("+++") {
            additions = additions.saturating_add(1);
        } else if trimmed.starts_with('-') && !trimmed.starts_with("---") {
            deletions = deletions.saturating_add(1);
        }
    }
    flush_current(
        files,
        seen,
        &mut current_path,
        &mut additions,
        &mut deletions,
    );
}

fn transcript_file_change_from_value(value: &Value, fallback_summary: &str) -> Option<Value> {
    let mut files = Vec::new();
    let mut seen = HashSet::new();
    transcript_collect_file_changes_from_value(value, &mut files, &mut seen);
    transcript_collect_file_changes_from_text(fallback_summary, &mut files, &mut seen);
    if files.is_empty() && fallback_summary.trim().is_empty() {
        return None;
    }
    let mut object = serde_json::Map::new();
    object.insert("files".to_string(), Value::Array(files));
    let summary = clean_codex_transcript_text(fallback_summary, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
    if !summary.trim().is_empty() {
        object.insert("summary".to_string(), json!(summary));
    }
    Some(Value::Object(object))
}

fn transcript_codex_output_exit_code(payload: &Value, output: &Value) -> Option<i64> {
    let payload_metadata = payload.get("metadata").unwrap_or(&Value::Null);
    let output_metadata = output.get("metadata").unwrap_or(&Value::Null);
    first_value_i64(&[
        payload.get("exit_code"),
        payload.get("exitCode"),
        payload_metadata.get("exit_code"),
        payload_metadata.get("exitCode"),
        output.get("exit_code"),
        output.get("exitCode"),
        output_metadata.get("exit_code"),
        output_metadata.get("exitCode"),
    ])
}

fn command_title(command: &str, fallback: &str) -> String {
    let first_line = command.lines().next().unwrap_or(command).trim();
    if first_line.is_empty() {
        return fallback.to_string();
    }

    format!("Ran {}", clean_codex_title(first_line, fallback))
}

fn transcript_task_complete_message(
    id: String,
    source: &str,
    timestamp: &str,
    text: impl AsRef<str>,
) -> CodexThreadTranscriptMessage {
    let (text, truncated) =
        clean_codex_transcript_text_with_truncation(text, CODEX_TRANSCRIPT_MAX_TEXT);
    CodexThreadTranscriptMessage {
        id,
        role: "assistant".to_string(),
        kind: "task_complete".to_string(),
        text,
        title: "Task complete".to_string(),
        call_id: String::new(),
        status: "task_complete".to_string(),
        created_at: timestamp.to_string(),
        source: source.to_string(),
        truncated,
        artifacts: Vec::new(),
        ..Default::default()
    }
}

fn transcript_error_message(
    id: String,
    source: &str,
    timestamp: &str,
    text: impl AsRef<str>,
) -> CodexThreadTranscriptMessage {
    let (text, truncated) =
        clean_codex_transcript_text_with_truncation(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
    CodexThreadTranscriptMessage {
        id,
        role: "activity".to_string(),
        kind: "error".to_string(),
        text,
        title: "Error".to_string(),
        call_id: String::new(),
        status: "error".to_string(),
        created_at: timestamp.to_string(),
        source: source.to_string(),
        truncated,
        artifacts: Vec::new(),
        ..Default::default()
    }
}

fn codex_function_call_message(
    line_index: usize,
    timestamp: &str,
    payload: &Value,
) -> Option<CodexThreadTranscriptMessage> {
    let name = value_string(payload.get("name"));
    let call_id = value_string(payload.get("call_id"));
    let arguments = payload
        .get("arguments")
        .or_else(|| payload.get("input"))
        .unwrap_or(&Value::Null);
    let parsed_arguments = parse_call_arguments(arguments);
    let fallback_title = if name.is_empty() {
        "Called tool".to_string()
    } else {
        format!("Called {name}")
    };

    let (title, text) = if name == "shell_command" {
        let command = parsed_arguments
            .as_ref()
            .and_then(|value| value.get("command"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let workdir = parsed_arguments
            .as_ref()
            .and_then(|value| value.get("workdir"))
            .and_then(Value::as_str)
            .unwrap_or_default();
        let timeout = parsed_arguments
            .as_ref()
            .and_then(|value| value.get("timeout_ms"))
            .map(Value::to_string)
            .unwrap_or_default();
        let mut lines = Vec::new();
        if !command.trim().is_empty() {
            lines.push(format!("$ {}", command.trim()));
        }
        if !workdir.trim().is_empty() {
            lines.push(format!("workdir: {}", workdir.trim()));
        }
        if !timeout.trim().is_empty() {
            lines.push(format!("timeout: {timeout} ms"));
        }
        (command_title(command, "Ran command"), lines.join("\n"))
    } else {
        let text = parsed_arguments
            .as_ref()
            .map(pretty_json)
            .unwrap_or_else(|| codex_content_text(arguments));
        (fallback_title, text)
    };

    let tool_input = parsed_arguments.clone().or_else(|| {
        if transcript_value_is_present(arguments) {
            Some(arguments.clone())
        } else {
            None
        }
    });
    let (text, truncated) =
        clean_codex_transcript_text_with_truncation(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
    if text.is_empty() && title.is_empty() {
        return None;
    }
    let title = clean_codex_title(title, "Called tool");

    Some(CodexThreadTranscriptMessage {
        id: format!("codex-{line_index}-tool-call"),
        role: "activity".to_string(),
        kind: "tool_call".to_string(),
        text,
        title: title.clone(),
        call_id: call_id.clone(),
        status: "running".to_string(),
        created_at: timestamp.to_string(),
        source: "codex".to_string(),
        tool: Some(transcript_tool_object(
            name, call_id, "running", tool_input, None, title,
        )),
        usage: transcript_usage_from_value(payload),
        truncated,
        artifacts: Vec::new(),
        ..Default::default()
    })
}

fn codex_function_output_message(
    line_index: usize,
    timestamp: &str,
    payload: &Value,
) -> Option<CodexThreadTranscriptMessage> {
    let call_id = value_string(payload.get("call_id"));
    let output_value = payload.get("output").unwrap_or(&Value::Null);
    let exit_code = transcript_codex_output_exit_code(payload, output_value);
    let content_output = codex_content_text(output_value);
    let raw_output = if content_output.trim().is_empty() {
        let stdout = first_value_string(&[output_value.get("stdout"), payload.get("stdout")]);
        let stderr = first_value_string(&[output_value.get("stderr"), payload.get("stderr")]);
        let combined = [stdout, stderr]
            .into_iter()
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n");
        if combined.trim().is_empty() && exit_code.is_some() {
            pretty_json(output_value)
        } else {
            combined
        }
    } else {
        content_output
    };
    let (output, text_truncated) =
        clean_codex_transcript_text_with_truncation(&raw_output, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
    let (tool_output, output_truncated) = transcript_tool_io_value(
        Some(output_value),
        &raw_output,
        CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
    );
    let artifacts = codex_image_artifacts_from_content(output_value, &raw_output, "Tool output");
    let has_error = transcript_tool_value_has_error(payload)
        || transcript_tool_value_has_error(output_value)
        || exit_code.is_some_and(|code| code != 0);

    if output.is_empty() && artifacts.is_empty() {
        return None;
    }
    let kind = if has_error {
        "tool_output".to_string()
    } else {
        codex_artifact_activity_kind(&output, &artifacts)
    };
    let title = if has_error {
        "Tool error".to_string()
    } else {
        codex_artifact_activity_title(&output, "Tool output", &artifacts)
    };

    Some(CodexThreadTranscriptMessage {
        id: format!("codex-{line_index}-tool-output"),
        role: "activity".to_string(),
        kind,
        text: output,
        title: title.clone(),
        call_id: call_id.clone(),
        status: if has_error { "error" } else { "completed" }.to_string(),
        created_at: timestamp.to_string(),
        source: "codex".to_string(),
        tool: Some(transcript_tool_object(
            "",
            &call_id,
            if has_error { "failed" } else { "completed" },
            None,
            tool_output.clone(),
            &title,
        )),
        tool_output: (!has_error).then(|| tool_output.clone()).flatten(),
        tool_error: has_error.then(|| tool_output.clone()).flatten(),
        exit_code,
        usage: transcript_usage_from_value(payload),
        truncated: text_truncated || output_truncated,
        artifacts,
        ..Default::default()
    })
}

fn codex_rollout_meta(path: &Path) -> Option<CodexRolloutMeta> {
    let file = fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
    let mut meta = CodexRolloutMeta {
        session_id: String::new(),
        cwd: String::new(),
        latest_timestamp: String::new(),
        title: String::new(),
    };

    for line in std::io::BufRead::lines(reader).take(120).flatten() {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let latest_timestamp = value_string(value.get("timestamp"));
        if !latest_timestamp.is_empty() {
            meta.latest_timestamp = latest_timestamp;
        }

        let record_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let payload = value.get("payload").unwrap_or(&Value::Null);
        match record_type {
            "session_meta" => {
                meta.session_id = clean_codex_id(value_string(payload.get("id")));
                meta.cwd = value_string(payload.get("cwd"));
            }
            "event_msg" => {
                if payload.get("type").and_then(Value::as_str) == Some("thread_name_updated") {
                    meta.title = clean_codex_title(value_string(payload.get("thread_name")), "");
                }
            }
            _ => {}
        }
    }

    if meta.session_id.is_empty() {
        None
    } else {
        Some(meta)
    }
}

fn codex_session_index_title(session_id: &str) -> String {
    let session_id = clean_codex_id(session_id);
    if session_id.is_empty() {
        return String::new();
    }

    let Some(codex_home) = codex_home_dir() else {
        return String::new();
    };
    let index_path = codex_home.join("session_index.jsonl");
    let Ok(file) = fs::File::open(&index_path) else {
        return String::new();
    };
    let reader = std::io::BufReader::new(file);
    let mut title = String::new();

    for line in std::io::BufRead::lines(reader).map_while(Result::ok) {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if clean_codex_id(value_string(value.get("id"))) != session_id {
            continue;
        }

        let next_title = clean_codex_title(
            first_value_string(&[value.get("thread_name"), value.get("title")]),
            "",
        );
        if !next_title.is_empty() {
            title = next_title;
        }
    }

    title
}

fn first_non_empty_title(values: &[String]) -> String {
    values
        .iter()
        .map(|value| clean_codex_title(value, ""))
        .find(|value| !value.is_empty())
        .unwrap_or_default()
}

fn system_time_to_unix_ms(value: SystemTime) -> u64 {
    value
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or(0)
}

pub(crate) fn discover_latest_codex_session_for_cwd(
    cwd: &str,
    not_before_ms: u64,
) -> Result<Option<CodexObservedSession>, String> {
    let files = collect_codex_rollout_candidates(cwd)?;
    let threshold_ms = not_before_ms.saturating_sub(30_000);

    for path in files {
        let modified_at_ms = fs::metadata(&path)
            .and_then(|metadata| metadata.modified())
            .map(system_time_to_unix_ms)
            .unwrap_or(0);
        if modified_at_ms > 0 && modified_at_ms < threshold_ms {
            continue;
        }

        let Some(meta) = codex_rollout_meta(&path) else {
            continue;
        };
        if meta.session_id.is_empty() {
            continue;
        }
        if !cwd.trim().is_empty() && !agent_paths_match(&meta.cwd, cwd) {
            continue;
        }

        let session_title = first_non_empty_title(&[
            meta.title.clone(),
            codex_session_index_title(&meta.session_id),
        ]);

        return Ok(Some(CodexObservedSession {
            session_id: meta.session_id,
            session_title,
            rollout_path: path.to_string_lossy().to_string(),
            cwd: meta.cwd,
            latest_timestamp: meta.latest_timestamp,
            modified_at_ms,
        }));
    }

    Ok(None)
}

fn push_codex_message(
    messages: &mut Vec<CodexThreadTranscriptMessage>,
    seen: &mut HashSet<String>,
    message: Option<CodexThreadTranscriptMessage>,
) {
    let Some(message) = message else {
        return;
    };
    if message.text.trim().is_empty() && message.title.trim().is_empty() {
        return;
    }

    let key = if message.role == "user"
        || message.kind == "task_complete"
        || (message.role == "activity" && message.call_id.is_empty())
    {
        format!("id:{}", message.id)
    } else if !message.call_id.is_empty() {
        format!(
            "{}:{}:{}:{}",
            message.role, message.kind, message.call_id, message.text
        )
    } else {
        format!("{}:{}:{}", message.role, message.kind, message.text)
    };
    if !seen.insert(key) {
        return;
    }

    messages.push(message);
}

fn codex_messages_from_event(
    line_index: usize,
    timestamp: &str,
    payload: &Value,
) -> Vec<CodexThreadTranscriptMessage> {
    let event_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match event_type {
        "user_message" => {
            let mut text = value_string(payload.get("message"));
            let image_count = payload
                .get("images")
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0)
                + payload
                    .get("local_images")
                    .and_then(Value::as_array)
                    .map(Vec::len)
                    .unwrap_or(0);
            if image_count > 0 {
                if !text.trim().is_empty() {
                    text.push('\n');
                }
                text.push_str(&format!("[{image_count} image attachment(s)]"));
            }
            let artifacts = codex_image_artifacts_from_content(payload, &text, "Attached image");
            let (text, truncated) =
                clean_codex_transcript_text_with_truncation(text, CODEX_TRANSCRIPT_MAX_TEXT);
            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-user"),
                role: "user".to_string(),
                kind: "message".to_string(),
                text,
                title: String::new(),
                call_id: String::new(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
                usage: transcript_usage_from_value(payload),
                truncated,
                artifacts,
                ..Default::default()
            }]
        }
        "agent_message" => {
            let raw_message = value_string(payload.get("message"));
            let (text, truncated) = clean_codex_transcript_text_with_truncation(
                &raw_message,
                CODEX_TRANSCRIPT_MAX_TEXT,
            );
            let artifacts =
                codex_image_artifacts_from_content(payload, &raw_message, "Generated image");
            if text.is_empty() && artifacts.is_empty() {
                Vec::new()
            } else {
                vec![CodexThreadTranscriptMessage {
                    id: format!("codex-{line_index}-assistant-event"),
                    role: "assistant".to_string(),
                    kind: "message".to_string(),
                    text,
                    title: String::new(),
                    call_id: String::new(),
                    created_at: timestamp.to_string(),
                    source: "codex".to_string(),
                    usage: transcript_usage_from_value(payload),
                    truncated,
                    artifacts,
                    ..Default::default()
                }]
            }
        }
        "task_complete" => vec![CodexThreadTranscriptMessage {
            id: format!("codex-{line_index}-task-complete"),
            role: "assistant".to_string(),
            kind: "task_complete".to_string(),
            text: {
                let (text, _) = clean_codex_transcript_text_with_truncation(
                    value_string(payload.get("last_agent_message")),
                    CODEX_TRANSCRIPT_MAX_TEXT,
                );
                if text.trim().is_empty() {
                    "Task complete".to_string()
                } else {
                    text
                }
            },
            title: "Task complete".to_string(),
            call_id: String::new(),
            status: "task_complete".to_string(),
            created_at: timestamp.to_string(),
            source: "codex".to_string(),
            usage: transcript_usage_from_value(payload),
            artifacts: Vec::new(),
            ..Default::default()
        }],
        "token_count" => transcript_cumulative_usage_from_value(payload)
            .map(|usage| CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-usage"),
                role: "activity".to_string(),
                kind: "usage_report".to_string(),
                text: "Token usage updated".to_string(),
                title: "Token usage".to_string(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
                usage: Some(usage),
                artifacts: Vec::new(),
                ..Default::default()
            })
            .into_iter()
            .collect(),
        "patch_apply_end" => {
            let success = payload
                .get("success")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let stdout = value_string(payload.get("stdout"));
            let stderr = value_string(payload.get("stderr"));
            let text = [stdout, stderr]
                .into_iter()
                .filter(|text| !text.trim().is_empty())
                .collect::<Vec<_>>()
                .join("\n");
            let (text, truncated) =
                clean_codex_transcript_text_with_truncation(&text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
            let title = if success {
                "Patch applied"
            } else {
                "Patch failed"
            }
            .to_string();
            let file_change = transcript_file_change_from_value(payload, &text);
            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-patch"),
                role: "activity".to_string(),
                kind: "patch".to_string(),
                text,
                title,
                call_id: String::new(),
                status: if success { "completed" } else { "error" }.to_string(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
                file_change,
                truncated,
                artifacts: Vec::new(),
                ..Default::default()
            }]
        }
        "context_compacted" => vec![CodexThreadTranscriptMessage {
            id: format!("codex-{line_index}-compact"),
            role: "activity".to_string(),
            kind: "context".to_string(),
            text: "Context compacted".to_string(),
            title: "Context compacted".to_string(),
            call_id: String::new(),
            created_at: timestamp.to_string(),
            source: "codex".to_string(),
            artifacts: Vec::new(),
            ..Default::default()
        }],
        "mcp_tool_call_end" => {
            let invocation = payload.get("invocation").unwrap_or(&Value::Null);
            let server = value_string(invocation.get("server"));
            let tool = value_string(invocation.get("tool"));
            let mut title = String::from("MCP tool");
            if !server.is_empty() || !tool.is_empty() {
                title = format!(
                    "MCP {}{}",
                    server,
                    if tool.is_empty() {
                        String::new()
                    } else {
                        format!(" / {tool}")
                    }
                );
            }
            let text = payload
                .get("result")
                .map(pretty_json)
                .or_else(|| payload.get("error").map(pretty_json))
                .unwrap_or_default();
            let artifact_value = payload
                .get("result")
                .or_else(|| payload.get("error"))
                .unwrap_or(&Value::Null);
            let artifacts = codex_image_artifacts_from_content(artifact_value, &text, &title);
            let has_error = transcript_tool_value_has_error(payload);
            let kind = if has_error {
                "tool_output".to_string()
            } else {
                codex_artifact_activity_kind(&text, &artifacts)
            };
            let title = if has_error {
                "MCP tool error".to_string()
            } else {
                codex_artifact_activity_title(
                    &text,
                    &clean_codex_title(title, "MCP tool"),
                    &artifacts,
                )
            };
            let (text, text_truncated) =
                clean_codex_transcript_text_with_truncation(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
            let (tool_output, output_truncated) = transcript_tool_io_value(
                Some(artifact_value),
                &text,
                CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
            );
            let call_id = value_string(invocation.get("call_id"));
            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-mcp"),
                role: "activity".to_string(),
                kind,
                text,
                title: title.clone(),
                call_id: call_id.clone(),
                status: if has_error { "error" } else { "completed" }.to_string(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
                tool: Some(transcript_tool_object(
                    if server.is_empty() {
                        tool.clone()
                    } else if tool.is_empty() {
                        server.clone()
                    } else {
                        format!("{server}/{tool}")
                    },
                    &call_id,
                    if has_error { "failed" } else { "completed" },
                    None,
                    tool_output.clone(),
                    &title,
                )),
                tool_output: (!has_error).then(|| tool_output.clone()).flatten(),
                tool_error: has_error.then(|| tool_output.clone()).flatten(),
                usage: transcript_usage_from_value(payload),
                truncated: text_truncated || output_truncated,
                artifacts,
                ..Default::default()
            }]
        }
        "ss" | "se" | "subagent_start" | "subagent_end" => {
            transcript_codex_subagent_scope_event(payload)
                .map(|(_, _, subagent)| {
                    transcript_subagent_message(
                        format!("codex-{line_index}-subagent"),
                        "codex",
                        timestamp,
                        subagent,
                        "Subagent",
                    )
                })
                .into_iter()
                .collect()
        }
        _ => Vec::new(),
    }
}

fn codex_messages_from_response_item(
    line_index: usize,
    timestamp: &str,
    payload: &Value,
) -> Vec<CodexThreadTranscriptMessage> {
    let item_type = payload
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match item_type {
        "message" => {
            let role = payload
                .get("role")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let content = payload.get("content").unwrap_or(&Value::Null);
            let raw_text = codex_content_text(content);
            let artifact_title = if role == "user" {
                "Attached image"
            } else {
                "Generated image"
            };
            let artifacts = codex_image_artifacts_from_content(content, &raw_text, artifact_title);
            let display_text = if role == "user" {
                let mut text = codex_strip_native_image_envelopes(&raw_text)
                    .trim()
                    .to_string();
                if !artifacts.is_empty()
                    && !text.to_ascii_lowercase().contains("image attachment(s)]")
                {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str(&format!("[{} image attachment(s)]", artifacts.len()));
                }
                text
            } else {
                raw_text.clone()
            };
            let (text, truncated) = clean_codex_transcript_text_with_truncation(
                &display_text,
                CODEX_TRANSCRIPT_MAX_TEXT,
            );
            if role == "developer" {
                if artifacts.is_empty() {
                    return Vec::new();
                }

                return vec![CodexThreadTranscriptMessage {
                    id: format!("codex-{line_index}-generated-image"),
                    role: "activity".to_string(),
                    kind: "image_generation".to_string(),
                    text: String::new(),
                    title: "Generated image".to_string(),
                    call_id: String::new(),
                    created_at: timestamp.to_string(),
                    source: "codex".to_string(),
                    tool: Some(transcript_tool_object(
                        "image_generation",
                        "",
                        "completed",
                        None,
                        None,
                        "Generated image",
                    )),
                    truncated,
                    artifacts,
                    ..Default::default()
                }];
            }
            if role == "user" {
                if codex_response_item_user_message_is_internal_context(payload) {
                    return Vec::new();
                }
                if text.is_empty() && artifacts.is_empty() {
                    return Vec::new();
                }
                return vec![CodexThreadTranscriptMessage {
                    id: format!("codex-{line_index}-user"),
                    role: "user".to_string(),
                    kind: "message".to_string(),
                    text,
                    title: String::new(),
                    call_id: String::new(),
                    created_at: timestamp.to_string(),
                    source: "codex".to_string(),
                    usage: transcript_usage_from_value(payload),
                    truncated,
                    artifacts,
                    ..Default::default()
                }];
            }
            if role != "assistant" {
                return Vec::new();
            }
            if text.is_empty() && artifacts.is_empty() {
                return Vec::new();
            }

            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-assistant"),
                role: "assistant".to_string(),
                kind: "message".to_string(),
                text,
                title: String::new(),
                call_id: String::new(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
                usage: transcript_usage_from_value(payload),
                truncated,
                artifacts,
                ..Default::default()
            }]
        }
        "function_call" | "custom_tool_call" | "custom_tool" => {
            codex_function_call_message(line_index, timestamp, payload)
                .into_iter()
                .collect()
        }
        "function_call_output" | "custom_tool_call_output" | "custom_tool_output" => {
            codex_function_output_message(line_index, timestamp, payload)
                .into_iter()
                .collect()
        }
        "tool_search_call" | "tool_search" => {
            let raw_text = pretty_json(payload);
            let (text, truncated) = clean_codex_transcript_text_with_truncation(
                raw_text,
                CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
            );
            let call_id = first_value_string(&[
                payload.get("call_id"),
                payload.get("callId"),
                payload.get("id"),
            ]);
            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-tool-search-call"),
                role: "activity".to_string(),
                kind: "tool_call".to_string(),
                text,
                title: "Searched tools".to_string(),
                call_id: call_id.clone(),
                status: "running".to_string(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
                tool: Some(transcript_tool_object(
                    "tool_search",
                    call_id,
                    "running",
                    Some(payload.clone()),
                    None,
                    "Searched tools",
                )),
                usage: transcript_usage_from_value(payload),
                truncated,
                artifacts: Vec::new(),
                ..Default::default()
            }]
        }
        "tool_search_output" => {
            let output = payload
                .get("output")
                .or_else(|| payload.get("result"))
                .or_else(|| payload.get("results"))
                .unwrap_or(payload);
            let output_text = {
                let text = codex_content_text(output);
                if text.trim().is_empty() {
                    pretty_json(output)
                } else {
                    text
                }
            };
            let (text, text_truncated) = clean_codex_transcript_text_with_truncation(
                output_text,
                CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
            );
            let (tool_output, output_truncated) =
                transcript_tool_io_value(Some(output), &text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
            let call_id = first_value_string(&[
                payload.get("call_id"),
                payload.get("callId"),
                payload.get("id"),
            ]);
            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-tool-search-output"),
                role: "activity".to_string(),
                kind: "tool_output".to_string(),
                text,
                title: "Tool search results".to_string(),
                call_id: call_id.clone(),
                status: "completed".to_string(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
                tool: Some(transcript_tool_object(
                    "tool_search",
                    &call_id,
                    "completed",
                    None,
                    tool_output.clone(),
                    "Tool search results",
                )),
                tool_output,
                usage: transcript_usage_from_value(payload),
                truncated: text_truncated || output_truncated,
                artifacts: Vec::new(),
                ..Default::default()
            }]
        }
        "web_search_call" => {
            let raw_text = pretty_json(payload);
            let (text, truncated) = clean_codex_transcript_text_with_truncation(
                raw_text,
                CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
            );
            let call_id = value_string(payload.get("id"));
            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-web-search"),
                role: "activity".to_string(),
                kind: "web".to_string(),
                legacy_kind: "web".to_string(),
                text,
                title: "Searched web".to_string(),
                call_id: call_id.clone(),
                status: "running".to_string(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
                tool: Some(transcript_tool_object(
                    "web_search",
                    call_id,
                    "running",
                    Some(payload.clone()),
                    None,
                    "Searched web",
                )),
                usage: transcript_usage_from_value(payload),
                truncated,
                artifacts: Vec::new(),
                ..Default::default()
            }]
        }
        "reasoning" => {
            let (summary, truncated) = clean_codex_transcript_text_with_truncation(
                codex_summary_text(payload),
                CODEX_TRANSCRIPT_MAX_REASONING_TEXT,
            );
            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-reasoning"),
                role: "activity".to_string(),
                kind: "reasoning".to_string(),
                text: if summary.is_empty() {
                    "Reasoning step recorded.".to_string()
                } else {
                    summary
                },
                title: "Reasoning".to_string(),
                call_id: String::new(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
                usage: transcript_usage_from_value(payload),
                truncated,
                artifacts: Vec::new(),
                ..Default::default()
            }]
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
pub(crate) static OPENCODE_DB_TEST_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
    std::sync::OnceLock::new();

#[cfg(test)]
mod agent_sessions_tests {
    use super::*;

    #[test]
    fn transcript_artifact_accepts_legacy_camel_case_fields() {
        let artifact: CodexThreadTranscriptArtifact = serde_json::from_value(json!({
            "kind": "image",
            "mimeType": "image/png",
            "assetId": "asset-legacy",
            "assetPath": "assets/legacy.png",
            "originalPath": "/tmp/legacy.png"
        }))
        .expect("deserialize artifact");

        assert_eq!(artifact.mime_type, "image/png");
        assert_eq!(artifact.asset_id, "asset-legacy");
        assert_eq!(artifact.asset_path, "assets/legacy.png");
        assert_eq!(artifact.original_path, "/tmp/legacy.png");
        let serialized = serde_json::to_value(artifact).expect("serialize artifact");
        assert_eq!(serialized.get("mime_type"), Some(&json!("image/png")));
        assert_eq!(serialized.get("asset_id"), Some(&json!("asset-legacy")));
        assert!(serialized.get("mimeType").is_none());
        assert!(serialized.get("assetId").is_none());

        let mime_alias: CodexThreadTranscriptArtifact = serde_json::from_value(json!({
            "mime": "image/jpeg"
        }))
        .expect("deserialize mime alias");
        assert_eq!(mime_alias.mime_type, "image/jpeg");
    }

    fn unique_test_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        env::temp_dir().join(format!("{name}-{suffix}"))
    }

    #[test]
    fn transcript_watch_owner_priority_preserves_webview_context() {
        let native_owner = agent_thread_transcript_native_watch_owner_key("pane-a", Some(42));
        let webview_owner = agent_thread_transcript_webview_watch_owner_key();
        let mut owners = HashSet::new();

        assert!(agent_thread_transcript_watch_entry_replace_context(
            &owners,
            &native_owner,
        ));
        owners.insert(webview_owner.clone());
        assert!(!agent_thread_transcript_watch_entry_replace_context(
            &owners,
            &native_owner,
        ));
        assert!(agent_thread_transcript_watch_entry_replace_context(
            &owners,
            &webview_owner,
        ));
    }

    #[test]
    fn native_transcript_watch_path_prefers_explicit_path() {
        let path = agent_thread_transcript_native_watch_path(
            "codex",
            "session-a",
            Some("/tmp/diffforge-explicit-transcript.jsonl"),
        );

        assert_eq!(
            path.as_deref(),
            Some(Path::new("/tmp/diffforge-explicit-transcript.jsonl"))
        );
    }

    #[test]
    fn transcript_watch_targets_parent_so_atomic_replacements_stay_observed() {
        let root = unique_test_dir("transcript-watch-parent");
        fs::create_dir_all(&root).unwrap();
        let transcript = root.join("rollout-session.jsonl");
        fs::write(&transcript, "{}\n").unwrap();

        assert_eq!(
            agent_thread_transcript_watch_target("codex", &transcript),
            root,
        );
        assert!(agent_thread_transcript_watch_event_matches(
            &transcript,
            &[transcript.parent().unwrap().to_path_buf()],
        ));
        let _ = fs::remove_dir_all(transcript.parent().unwrap());
    }

    #[test]
    fn terminal_observer_state_is_explicit_and_reversible() {
        let workspace_id = format!("workspace-observed-{}", current_time_ms());
        let pane_id = "pane-observed";
        assert!(!agent_chat_session_terminal_identity_is_observed(
            &workspace_id,
            pane_id,
            Some(7),
        ));
        agent_chat_session_set_terminal_observed(
            &workspace_id,
            pane_id,
            Some(7),
            Some("viewer-a"),
            true,
        );
        assert!(agent_chat_session_terminal_identity_is_observed(
            &workspace_id,
            pane_id,
            Some(7),
        ));
        agent_chat_session_set_terminal_observed(
            &workspace_id,
            pane_id,
            Some(7),
            Some("viewer-a"),
            false,
        );
        assert!(!agent_chat_session_terminal_identity_is_observed(
            &workspace_id,
            pane_id,
            Some(7),
        ));
    }

    #[test]
    fn transcript_caps_are_phase2_sizes_and_mark_truncation() {
        assert_eq!(CODEX_TRANSCRIPT_MAX_TEXT, 65_536);
        assert_eq!(CODEX_TRANSCRIPT_MAX_TOOL_TEXT, 65_536);
        assert_eq!(CODEX_TRANSCRIPT_MAX_REASONING_TEXT, 65_536);
        let (text, truncated) = clean_codex_transcript_text_with_truncation(
            "x".repeat(CODEX_TRANSCRIPT_MAX_TEXT + 1),
            CODEX_TRANSCRIPT_MAX_TEXT,
        );
        assert!(truncated);
        assert!(text.ends_with("[truncated]"));
    }

    fn opencode_step_finish(data: Value) -> Vec<CodexThreadTranscriptMessage> {
        opencode_part_message("msg1", "assistant", "part1", "2024-01-01T00:00:00Z", &data)
    }

    #[test]
    fn codex_response_item_handles_v142_tool_search_and_user_shapes() {
        let custom_tool = codex_messages_from_response_item(
            1,
            "2026-07-02T00:00:00Z",
            &json!({
                "type": "custom_tool_call",
                "name": "tool_search",
                "call_id": "call-custom",
                "input": {"query": "workspace tools"}
            }),
        );
        assert_eq!(custom_tool.len(), 1);
        assert_eq!(custom_tool[0].kind, "tool_call");
        assert!(custom_tool[0].text.contains("workspace tools"));
        assert_eq!(
            custom_tool[0].tool.as_ref().unwrap()["input"],
            json!({"query": "workspace tools"})
        );

        let tool_search = codex_messages_from_response_item(
            2,
            "2026-07-02T00:00:01Z",
            &json!({
                "type": "tool_search_call",
                "call_id": "call-search",
                "query": "browser"
            }),
        );
        assert_eq!(tool_search.len(), 1);
        assert_eq!(tool_search[0].title, "Searched tools");
        assert_eq!(tool_search[0].call_id, "call-search");

        let tool_search_output = codex_messages_from_response_item(
            3,
            "2026-07-02T00:00:02Z",
            &json!({
                "type": "tool_search_output",
                "call_id": "call-search",
                "output": [{"name": "browser.open"}]
            }),
        );
        assert_eq!(tool_search_output.len(), 1);
        assert_eq!(tool_search_output[0].kind, "tool_output");
        assert!(tool_search_output[0].text.contains("browser.open"));
        assert_eq!(
            tool_search_output[0].tool.as_ref().unwrap()["status"],
            json!("completed")
        );
        assert_eq!(
            tool_search_output[0].tool.as_ref().unwrap()["output"],
            json!([{"name": "browser.open"}])
        );

        let reasoning = codex_messages_from_response_item(
            4,
            "2026-07-02T00:00:03Z",
            &json!({
                "type": "reasoning",
                "summary": []
            }),
        );
        assert_eq!(reasoning.len(), 1);
        assert_eq!(reasoning[0].text, "Reasoning step recorded.");

        let user_message = codex_messages_from_response_item(
            5,
            "2026-07-02T00:00:04Z",
            &json!({
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "queued prompt"}]
            }),
        );
        assert_eq!(user_message.len(), 1);
        assert_eq!(user_message[0].role, "user");
        assert!(user_message[0].text.contains("queued prompt"));
    }

    #[test]
    fn codex_response_item_skips_internal_context_user_messages() {
        for (index, marker) in [
            "# AGENTS.md instructions for /tmp/project",
            "<INSTRUCTIONS>",
            "<!-- DIFFFORGE_AGENT_CONTRACT_BEGIN -->",
            "<environment_context>",
            "<turn_aborted reason=\"user_cancelled\">",
            "<turn_interrupted reason=\"user_interrupt\">",
        ]
        .iter()
        .enumerate()
        {
            let messages = codex_messages_from_response_item(
                index,
                "2026-07-02T00:00:00Z",
                &json!({
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": format!("{marker}\ninternal")}]
                }),
            );

            assert!(messages.is_empty());
        }
    }

    #[test]
    fn codex_response_item_normalizes_native_attached_image_envelope() {
        let path = "/tmp/diffforge-todo-attachments/chat-images-staged/image.jpg";
        let messages = codex_messages_from_response_item(
            7,
            "2026-07-12T12:00:00Z",
            &json!({
                "type": "message",
                "role": "user",
                "content": [{
                    "type": "input_text",
                    "text": format!(
                        "<image name=[Image #1] path=\"{path}\">\n</image>\n[Image #1] what is this?"
                    )
                }]
            }),
        );

        assert_eq!(messages.len(), 1);
        assert!(!messages[0].text.contains("<image"));
        assert!(messages[0].text.contains("[Image #1] what is this?"));
        assert!(messages[0].text.contains("[1 image attachment(s)]"));
        assert_eq!(messages[0].artifacts.len(), 1);
        assert_eq!(messages[0].artifacts[0].path, path);
        assert_eq!(messages[0].artifacts[0].title, "Attached image");
        assert_eq!(
            codex_normalize_user_prompt_text(&messages[0].text),
            "[Image #1] what is this?"
        );
    }

    #[test]
    fn codex_rollout_prefers_event_user_message_over_adjacent_response_item() {
        let root = unique_test_dir("codex-user-dedupe");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("rollout-test.jsonl");
        let lines = [
            json!({
                "type": "session_meta",
                "timestamp": "2026-07-02T00:00:00Z",
                "payload": {"id": "codex-session", "cwd": "/tmp/project"}
            }),
            json!({
                "type": "response_item",
                "timestamp": "2026-07-02T00:00:01Z",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": "typed prompt"}]
                }
            }),
            json!({
                "type": "environment_context",
                "timestamp": "2026-07-02T00:00:01.500Z",
                "cwd": "/tmp/project"
            }),
            json!({
                "type": "event_msg",
                "timestamp": "2026-07-02T00:00:02Z",
                "payload": {"type": "user_message", "message": "typed prompt"}
            }),
        ]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        fs::write(&path, format!("{lines}\n")).unwrap();

        let (_, messages) = parse_codex_rollout(&path, 20).unwrap();
        let user_messages = messages
            .iter()
            .filter(|message| message.role == "user")
            .collect::<Vec<_>>();

        assert_eq!(user_messages.len(), 1);
        assert_eq!(user_messages[0].id, "codex-3-user");
        assert_eq!(user_messages[0].text, "typed prompt");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_rollout_keeps_response_item_only_user_message() {
        let root = unique_test_dir("codex-response-user-only");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("rollout-test.jsonl");
        let lines = [
            json!({
                "type": "session_meta",
                "timestamp": "2026-07-02T00:00:00Z",
                "payload": {"id": "codex-session", "cwd": "/tmp/project"}
            }),
            json!({
                "type": "response_item",
                "timestamp": "2026-07-02T00:00:01Z",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": "queued prompt"}]
                }
            }),
        ]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        fs::write(&path, format!("{lines}\n")).unwrap();

        let (_, messages) = parse_codex_rollout(&path, 20).unwrap();
        let user_messages = messages
            .iter()
            .filter(|message| message.role == "user")
            .collect::<Vec<_>>();

        assert_eq!(user_messages.len(), 1);
        assert_eq!(user_messages[0].id, "codex-1-user");
        assert_eq!(user_messages[0].text, "queued prompt");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_rollout_keeps_angle_bracket_user_messages_without_internal_prefixes() {
        let root = unique_test_dir("codex-angle-bracket-user");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("rollout-test.jsonl");
        let lines = [
            json!({
                "type": "session_meta",
                "timestamp": "2026-07-02T00:00:00Z",
                "payload": {"id": "codex-session", "cwd": "/tmp/project"}
            }),
            json!({
                "type": "response_item",
                "timestamp": "2026-07-02T00:00:01Z",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": "<div> is my favorite tag"}]
                }
            }),
            json!({
                "type": "response_item",
                "timestamp": "2026-07-02T00:00:02Z",
                "payload": {
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": "<turnip recipes>"}]
                }
            }),
        ]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        fs::write(&path, format!("{lines}\n")).unwrap();

        let (_, messages) = parse_codex_rollout(&path, 20).unwrap();
        let user_texts = messages
            .iter()
            .filter(|message| message.role == "user")
            .map(|message| message.text.as_str())
            .collect::<Vec<_>>();

        assert_eq!(
            user_texts,
            vec!["<div> is my favorite tag", "<turnip recipes>"]
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_token_count_event_emits_cumulative_usage() {
        let messages = codex_messages_from_event(
            6,
            "2026-07-02T00:00:05Z",
            &json!({
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 100,
                        "output_tokens": 25,
                        "cached_input_tokens": 40
                    }
                }
            }),
        );

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].kind, "usage_report");
        let usage = messages[0].usage.as_ref().expect("usage");
        assert_eq!(usage["input_tokens"], json!(100));
        assert_eq!(usage["output_tokens"], json!(25));
        assert_eq!(usage["cache_read_tokens"], json!(40));
        assert_eq!(usage["cumulative"], json!(true));
    }

    #[test]
    fn opencode_step_finish_classifies_on_structured_fields_only() {
        // Normal finish reasons are control metadata, not visible messages.
        for reason in ["stop", "tool-calls", "length"] {
            let messages = opencode_step_finish(json!({"type": "step-finish", "reason": reason}));
            assert!(
                messages.is_empty(),
                "reason {reason} should not render a transcript message"
            );
        }
        // The message-level `finish` mirror is also suppressed.
        assert!(opencode_step_finish(json!({"type": "step-finish", "finish": "stop"})).is_empty());

        // R5: free-form `summary` prose must NOT be classified — only the
        // structured finish-reason fields drive error/interrupted routing.
        let messages = opencode_step_finish(
            json!({"type": "step-finish", "summary": "cancelled the timer and stopped"}),
        );
        assert!(messages.is_empty(), "free-text summary must not render");

        // Structured error / abort reasons route away from completion.
        let message = opencode_step_finish(json!({"type": "step-finish", "reason": "error"}))
            .into_iter()
            .next()
            .expect("error message");
        assert_eq!(message.kind, "error");
        assert!(message.id.ends_with("step-error"));

        let message = opencode_step_finish(json!({"type": "step-finish", "reason": "aborted"}))
            .into_iter()
            .next()
            .expect("aborted message");
        assert_eq!(message.kind, "error");
        assert!(message.id.ends_with("step-interrupted"));
    }

    #[test]
    fn opencode_reasoning_uses_word_boundary_truncation() {
        let reasoning = format!(
            "{} tailword",
            "reasoning ".repeat(CODEX_TRANSCRIPT_MAX_REASONING_TEXT / "reasoning ".len() + 200)
        );
        let messages = opencode_part_message(
            "msg1",
            "assistant",
            "part1",
            "2024-01-01T00:00:00Z",
            &json!({"type": "reasoning", "text": reasoning}),
        );
        assert_eq!(messages.len(), 1);
        let text = messages[0].text.as_str();
        assert!(text.ends_with("[truncated]"));
        assert!(text.chars().count() > CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
        assert!(!text.contains("tailword"));
    }

    #[test]
    fn opencode_model_value_formats_provider_and_model() {
        // Assistant message shape.
        assert_eq!(
            opencode_model_from_value(&json!({"modelID": "glm-5.2", "providerID": "opencode-go"})),
            Some("opencode-go/glm-5.2".to_string())
        );
        // Session column shape.
        assert_eq!(
            opencode_model_from_value(&json!({"id": "glm-5.2", "providerID": "opencode-go"})),
            Some("opencode-go/glm-5.2".to_string())
        );
        // No provider → bare model id.
        assert_eq!(
            opencode_model_from_value(&json!({"modelID": "glm-5.2"})),
            Some("glm-5.2".to_string())
        );
        // No model → None.
        assert_eq!(
            opencode_model_from_value(&json!({"providerID": "opencode-go"})),
            None
        );
        assert_eq!(
            opencode_model_from_value(
                &json!({"role": "assistant", "model": "seedance_2_0", "providerID": "video"})
            ),
            None,
            "assistant rows must not accept generic tool-style model fields"
        );
        assert_eq!(opencode_model_from_value(&json!({})), None);
    }

    #[test]
    fn codex_last_model_ignores_nested_tool_payload_model() {
        let root = unique_test_dir("codex-last-model-tool-payload");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("rollout-session.jsonl");
        let lines = [
            json!({
                "type": "turn_context",
                "timestamp": "2026-07-02T00:00:00Z",
                "model": "gpt-5.5"
            }),
            json!({
                "type": "response_item",
                "timestamp": "2026-07-02T00:00:01Z",
                "payload": {
                    "type": "function_call",
                    "name": "generate_video",
                    "input": {
                        "prompt": "make a clip",
                        "model": "seedance_2_0"
                    }
                }
            }),
            json!({
                "type": "response_item",
                "timestamp": "2026-07-02T00:00:02Z",
                "payload": {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "Video generation started."}]
                }
            }),
        ]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        fs::write(&path, format!("{lines}\n")).unwrap();

        assert_eq!(
            jsonl_tail_last_model(AgentProvider::Codex, &path),
            Some("gpt-5.5".to_string())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn claude_last_model_ignores_nested_tool_result_model() {
        let root = unique_test_dir("claude-last-model-tool-result");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("claude-session.jsonl");
        let lines = [
            json!({
                "type": "assistant",
                "sessionId": "claude-session",
                "timestamp": "2026-07-02T00:00:00Z",
                "message": {
                    "role": "assistant",
                    "model": "claude-sonnet-4-5",
                    "content": [{"type": "text", "text": "I will generate it."}]
                }
            }),
            json!({
                "type": "user",
                "sessionId": "claude-session",
                "timestamp": "2026-07-02T00:00:01Z",
                "message": {
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": "toolu-video",
                        "content": {
                            "status": "queued",
                            "model": "seedance_2_0"
                        }
                    }]
                }
            }),
        ]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        fs::write(&path, format!("{lines}\n")).unwrap();

        assert_eq!(
            jsonl_tail_last_model(AgentProvider::Claude, &path),
            Some("claude-sonnet-4-5".to_string())
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cloud_session_response_rehydrates_normalized_messages() {
        let first_messages = serde_json::to_string(&json!([
            {
                "id": "m1",
                "role": "user",
                "kind": "message",
                "text": "please inspect the board",
                "created_at": "2026-01-01T00:00:00Z",
                "source": "claude",
            }
        ]))
        .unwrap();
        let response = json!({
            "ok": true,
            "session": {
                "id": "agent-chat-session-1",
                "provider_session_id": "provider-session-1",
                "title": "Board inspection",
                "cwd": "/tmp/project",
                "latest_timestamp": "2026-01-01T00:00:05Z",
            },
            "records": [
                {
                    "record_index": 0,
                    "messages_json": first_messages,
                },
                {
                    "record_index": 1,
                    "messages": [{
                        "id": "m2",
                        "role": "assistant",
                        "kind": "message",
                        "text": "I found the synced transcript.",
                        "created_at": "2026-01-01T00:00:05Z",
                        "source": "claude",
                    }],
                },
            ],
        });

        let result = agent_thread_transcript_from_cloud_session_response(
            "claude",
            "provider-session-1",
            "/fallback",
            10,
            &response,
        )
        .unwrap();

        assert_eq!(result.session_id, "provider-session-1");
        assert_eq!(result.session_title, "Board inspection");
        assert_eq!(result.cwd, "/tmp/project");
        assert_eq!(result.matched_by, "sessionId");
        assert_eq!(
            result.rollout_path,
            "cloud://agent-chat-session/agent-chat-session-1"
        );
        assert_eq!(result.messages.len(), 2);
        assert_eq!(result.messages[0].text, "please inspect the board");
        assert_eq!(result.messages[1].text, "I found the synced transcript.");
    }

    #[test]
    fn cloud_session_response_accepts_legacy_camel_case_fields() {
        let response = json!({
            "session": {
                "agentChatSessionId": "agent-chat-session-camel",
                "providerSessionId": "provider-session-camel",
                "sessionTitle": "Legacy session",
                "workingDirectory": "/tmp/legacy",
                "latestTimestamp": "2026-01-02T00:00:05Z"
            },
            "records": [{
                "recordTimestamp": "2026-01-02T00:00:04Z",
                "messages": [{
                    "messageId": "legacy-message",
                    "role": "assistant",
                    "kind": "tool",
                    "text": "Legacy tool result",
                    "callId": "legacy-call",
                    "createdAt": "2026-01-02T00:00:04Z",
                    "toolOutput": { "ok": true },
                    "toolError": { "message": "warning" },
                    "fileChange": { "path": "src/main.rs" },
                    "durationMs": 42,
                    "exitCode": 0
                }]
            }]
        });

        let result = agent_thread_transcript_from_cloud_session_response(
            "claude",
            "provider-session-camel",
            "/fallback",
            10,
            &response,
        )
        .expect("rehydrate camel-case cloud session");

        assert_eq!(result.session_id, "provider-session-camel");
        assert_eq!(result.session_title, "Legacy session");
        assert_eq!(result.cwd, "/tmp/legacy");
        assert_eq!(result.latest_timestamp, "2026-01-02T00:00:05Z");
        assert_eq!(
            result.rollout_path,
            "cloud://agent-chat-session/agent-chat-session-camel"
        );
        assert!(agent_thread_cloud_session_matches_provider_session(
            &response["session"],
            "provider-session-camel"
        ));

        let message = result.messages.first().expect("legacy message");
        assert_eq!(message.id, "legacy-message");
        assert_eq!(message.call_id, "legacy-call");
        assert_eq!(message.created_at, "2026-01-02T00:00:04Z");
        assert_eq!(message.tool_output, Some(json!({ "ok": true })));
        assert_eq!(message.tool_error, Some(json!({ "message": "warning" })));
        assert_eq!(message.file_change, Some(json!({ "path": "src/main.rs" })));
        assert_eq!(message.duration_ms, Some(42));
        assert_eq!(message.exit_code, Some(0));
        let serialized = serde_json::to_value(message).expect("serialize normalized message");
        assert!(serialized.get("tool_output").is_some());
        assert!(serialized.get("toolOutput").is_none());
    }

    #[test]
    fn opencode_session_last_model_prefers_latest_assistant_then_session_column() {
        let _guard = OPENCODE_DB_TEST_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());

        let dir = unique_test_dir("opencode-model-db");
        let data_dir = dir.join("opencode");
        fs::create_dir_all(&data_dir).unwrap();
        let db_path = data_dir.join("opencode.db");
        {
            let connection = rusqlite::Connection::open(&db_path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE session (id TEXT PRIMARY KEY, model TEXT);
                     CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT);",
                )
                .unwrap();
            // Session column has an older model; the latest assistant message
            // switched to a newer one and must win.
            connection
                .execute(
                    "INSERT INTO session (id, model) VALUES (?1, ?2)",
                    rusqlite::params!["ses_1", r#"{"id":"glm-5.1","providerID":"opencode-go"}"#],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO message (id, session_id, time_created, data) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![
                        "msg_old", "ses_1", 100i64,
                        r#"{"role":"assistant","modelID":"glm-5.1","providerID":"opencode-go"}"#
                    ],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO message (id, session_id, time_created, data) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![
                        "msg_new", "ses_1", 200i64,
                        r#"{"role":"assistant","modelID":"kimi-k2","providerID":"fireworks-ai"}"#
                    ],
                )
                .unwrap();
            // A session with no assistant messages falls back to its column.
            connection
                .execute(
                    "INSERT INTO session (id, model) VALUES (?1, ?2)",
                    rusqlite::params!["ses_2", r#"{"id":"glm-5.2","providerID":"opencode-go"}"#],
                )
                .unwrap();
        }

        let previous = env::var_os("XDG_DATA_HOME");
        env::set_var("XDG_DATA_HOME", &dir);

        assert_eq!(
            opencode_session_last_model("ses_1"),
            Some("fireworks-ai/kimi-k2".to_string()),
            "latest assistant message model should win"
        );
        assert_eq!(
            opencode_session_last_model("ses_2"),
            Some("opencode-go/glm-5.2".to_string()),
            "session column is the fallback when there are no messages"
        );
        assert_eq!(opencode_session_last_model("missing"), None);
        assert_eq!(
            agent_session_last_model(AgentProvider::OpenCode, "ses_1"),
            Some("fireworks-ai/kimi-k2".to_string())
        );

        match previous {
            Some(value) => env::set_var("XDG_DATA_HOME", value),
            None => env::remove_var("XDG_DATA_HOME"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn opencode_resume_resolution_requires_existing_workspace_session() {
        let _guard = OPENCODE_DB_TEST_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());

        let dir = unique_test_dir("opencode-resume-db");
        let workspace = dir.join("workspace");
        let other_workspace = dir.join("other-workspace");
        fs::create_dir_all(&workspace).unwrap();
        fs::create_dir_all(&other_workspace).unwrap();
        let data_dir = dir.join("opencode");
        fs::create_dir_all(&data_dir).unwrap();
        let db_path = data_dir.join("opencode.db");
        {
            let connection = rusqlite::Connection::open(&db_path).unwrap();
            connection
                .execute_batch(
                    "CREATE TABLE session (
                        id TEXT PRIMARY KEY,
                        title TEXT NOT NULL,
                        directory TEXT NOT NULL,
                        time_updated INTEGER NOT NULL
                    );",
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO session (id, title, directory, time_updated) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![
                        "ses_native_12345678",
                        "OpenCode native session",
                        workspace.to_string_lossy().to_string(),
                        200i64,
                    ],
                )
                .unwrap();
            connection
                .execute(
                    "INSERT INTO session (id, title, directory, time_updated) VALUES (?1, ?2, ?3, ?4)",
                    rusqlite::params![
                        "ses_other_12345678",
                        "Other workspace session",
                        other_workspace.to_string_lossy().to_string(),
                        300i64,
                    ],
                )
                .unwrap();
        }

        let previous = env::var_os("XDG_DATA_HOME");
        env::set_var("XDG_DATA_HOME", &dir);

        assert_eq!(
            resolve_opencode_resume_session(
                "ses_native_12345678",
                workspace.to_string_lossy().as_ref()
            )
            .as_deref(),
            Ok("ses_native_12345678")
        );
        assert!(
            resolve_opencode_resume_session(
                "019f0cd7-1347-7273-b20f-e959c3772a01",
                workspace.to_string_lossy().as_ref()
            )
            .is_err(),
            "coordination/turn UUIDs must not be treated as OpenCode session ids"
        );
        assert!(
            resolve_opencode_resume_session(
                "ses_other_12345678",
                workspace.to_string_lossy().as_ref()
            )
            .is_err(),
            "session history for a different workspace must not be resumed in this cwd"
        );

        match previous {
            Some(value) => env::set_var("XDG_DATA_HOME", value),
            None => env::remove_var("XDG_DATA_HOME"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn codex_resume_sanitizer_removes_only_unresumable_image_response_items() {
        let image_event = json!({
            "type": "event_msg",
            "payload": {
                "type": "image_generation_end",
                "call_id": "ig_image",
                "saved_path": "/tmp/generated/ig_image.png"
            }
        })
        .to_string();
        let image_response_item = json!({
            "type": "response_item",
            "payload": {
                "type": "image_generation_call",
                "id": "ig_image",
                "result": "base64-image"
            }
        })
        .to_string();
        let assistant_message = json!({
            "type": "response_item",
            "payload": {
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "Created."}]
            }
        })
        .to_string();
        let body = format!("{image_event}\n{image_response_item}\n{assistant_message}\n");

        let (sanitized, removed) = sanitize_codex_rollout_for_resume(&body);

        assert_eq!(removed, 1);
        assert!(sanitized.contains("image_generation_end"));
        assert!(sanitized.contains("/tmp/generated/ig_image.png"));
        assert!(sanitized.contains("Created."));
        assert!(!sanitized.contains("image_generation_call"));
        assert!(!sanitized.contains("base64-image"));
    }

    #[test]
    fn claude_session_parser_accepts_top_level_stop_reason() {
        let root = unique_test_dir("claude-transcript-output");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("claude-session.jsonl");
        let user = json!({
            "type": "user",
            "sessionId": "claude-session",
            "cwd": "/tmp/project",
            "timestamp": "2026-06-18T20:50:15Z",
            "message": {
                "role": "user",
                "content": "hey there"
            }
        })
        .to_string();
        let assistant = json!({
            "type": "assistant",
            "sessionId": "claude-session",
            "cwd": "/tmp/project",
            "timestamp": "2026-06-18T20:50:17Z",
            "stop_reason": "end_turn",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "Hey! How can I help you today?"}]
            }
        })
        .to_string();
        fs::write(&path, format!("{user}\n{assistant}\n")).unwrap();

        let (_, messages) = parse_claude_session(&path, 20).unwrap();

        assert!(messages
            .iter()
            .any(|message| message.role == "user" && message.text == "hey there"));
        assert!(messages.iter().any(|message| {
            message.role == "assistant"
                && message.kind == "message"
                && message.text == "Hey! How can I help you today?"
        }));
        assert!(messages
            .iter()
            .any(|message| message.kind == "task_complete"));
    }

    #[test]
    fn claude_resume_requires_a_local_conversation_in_the_launch_home() {
        let root = unique_test_dir("claude-resume-local-home");
        let launch_home = root.join("active-account");
        let other_home = root.join("other-account");
        let cwd = root.join("workspace");
        let session_id = "8b11443c-1111-4222-8333-123456789abc";
        let other_project_dir = other_home
            .join("projects")
            .join(claude_project_dir_name(&cwd.to_string_lossy()));
        fs::create_dir_all(&other_project_dir).unwrap();
        fs::write(
            other_project_dir.join(format!("{session_id}.jsonl")),
            format!(
                "{}\n",
                json!({
                    "type": "user",
                    "sessionId": session_id,
                    "cwd": cwd.to_string_lossy(),
                    "timestamp": "2026-07-12T12:00:00Z",
                    "message": {"role": "user", "content": "remote session"}
                })
            ),
        )
        .unwrap();

        assert!(resolve_claude_resume_session_in_home(
            session_id,
            &cwd.to_string_lossy(),
            &launch_home,
        )
        .is_err());
        assert_eq!(
            resolve_claude_resume_session_in_home(
                session_id,
                &cwd.to_string_lossy(),
                &other_home,
            )
            .unwrap(),
            session_id
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn claude_resume_rejects_a_local_conversation_from_another_workspace() {
        let root = unique_test_dir("claude-resume-cwd");
        let home = root.join("account");
        let stored_cwd = root.join("workspace-a");
        let requested_cwd = root.join("workspace-b");
        let session_id = "9c22554d-2222-4333-8444-abcdef123456";
        let project_dir = home
            .join("projects")
            .join(claude_project_dir_name(&stored_cwd.to_string_lossy()));
        fs::create_dir_all(&project_dir).unwrap();
        fs::write(
            project_dir.join(format!("{session_id}.jsonl")),
            format!(
                "{}\n",
                json!({
                    "type": "user",
                    "sessionId": session_id,
                    "cwd": stored_cwd.to_string_lossy(),
                    "timestamp": "2026-07-12T12:00:00Z",
                    "message": {"role": "user", "content": "local session"}
                })
            ),
        )
        .unwrap();

        assert!(resolve_claude_resume_session_in_home(
            session_id,
            &requested_cwd.to_string_lossy(),
            &home,
        )
        .is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn claude_resume_rejects_orphaned_subagent_transcripts() {
        let root = unique_test_dir("claude-resume-subagent-only");
        let home = root.join("account");
        let cwd = root.join("workspace");
        let session_id = "7a11443c-3333-4444-8555-123456789abc";
        let subagents_dir = home
            .join("projects")
            .join(claude_project_dir_name(&cwd.to_string_lossy()))
            .join(session_id)
            .join("subagents");
        fs::create_dir_all(&subagents_dir).unwrap();
        fs::write(
            subagents_dir.join("agent-a1b2c3.jsonl"),
            format!(
                "{}\n",
                json!({
                    "type": "user",
                    "sessionId": session_id,
                    "cwd": cwd.to_string_lossy(),
                    "timestamp": "2026-07-12T12:00:00Z",
                    "message": {"role": "user", "content": "orphaned subagent"}
                })
            ),
        )
        .unwrap();

        assert!(resolve_claude_resume_session_in_home(
            session_id,
            &cwd.to_string_lossy(),
            &home,
        )
        .is_err());
        assert!(!claude_local_resume_index_contains(
            &claude_local_resume_index_in_home(&home),
            session_id,
            &cwd.to_string_lossy(),
        ));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn claude_session_parser_promotes_result_text_to_assistant_message() {
        let root = unique_test_dir("claude-result-output");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("claude-session.jsonl");
        let result = json!({
            "type": "result",
            "sessionId": "claude-session",
            "cwd": "/tmp/project",
            "timestamp": "2026-06-18T20:50:17Z",
            "result": "Done."
        })
        .to_string();
        fs::write(&path, format!("{result}\n")).unwrap();

        let (_, messages) = parse_claude_session(&path, 20).unwrap();

        assert!(messages.iter().any(|message| {
            message.role == "assistant" && message.kind == "message" && message.text == "Done."
        }));
        assert!(messages
            .iter()
            .any(|message| message.kind == "task_complete" && message.text == "Done."));
    }

    #[test]
    fn developer_imagegen_response_item_yields_generated_dir_artifact() {
        let root = unique_test_dir("codex-developer-imagegen-artifact");
        let image_dir = root
            .join("codex-home")
            .join("generated_images")
            .join("019ea89a-b677-7fd3-a293-cdc2d10c0351");
        let image_path =
            image_dir.join("ig_0baf5da02d75dc2f016a2711455b2c81908b3860dc4fbe6d20.png");
        fs::create_dir_all(&image_dir).unwrap();
        fs::write(&image_path, b"fake png").unwrap();

        let notice = format!(
            "Generated images are saved to {} as {}/_image_id_.png by default.\nIf you need to use a generated image at another path, copy it and leave the original in place unless the user explicitly asks you to delete it.",
            image_dir.display(),
            image_dir.display()
        );
        let payload = serde_json::json!({
            "type": "message",
            "role": "developer",
            "content": [
                {
                    "type": "input_text",
                    "text": notice
                }
            ]
        });

        let messages = codex_messages_from_response_item(11, "2026-06-08T15:00:51Z", &payload);

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].role, "activity");
        assert_eq!(messages[0].kind, "image_generation");
        assert_eq!(messages[0].title, "Generated image");
        assert_eq!(messages[0].artifacts.len(), 1);
        assert_eq!(
            messages[0].artifacts[0].path,
            image_path.to_string_lossy().to_string()
        );
        assert_eq!(messages[0].artifacts[0].mime_type, "image/png");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_rollout_enriches_output_tool_identity_and_exit_code() {
        let root = unique_test_dir("codex-output-tool-metadata");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("rollout-test.jsonl");
        let lines = [
            json!({
                "type": "session_meta",
                "timestamp": "2026-07-02T00:00:00Z",
                "payload": {"id": "codex-session", "cwd": "/tmp/project"}
            }),
            json!({
                "type": "response_item",
                "timestamp": "2026-07-02T00:00:01Z",
                "payload": {
                    "type": "function_call",
                    "name": "shell_command",
                    "call_id": "call-shell",
                    "arguments": {"command": "cargo test", "workdir": "/tmp/project"}
                }
            }),
            json!({
                "type": "response_item",
                "timestamp": "2026-07-02T00:00:02Z",
                "payload": {
                    "type": "function_call_output",
                    "call_id": "call-shell",
                    "output": {"stdout": "compile failed", "exit_code": 1}
                }
            }),
        ]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        fs::write(&path, format!("{lines}\n")).unwrap();

        let (_, messages) = parse_codex_rollout(&path, 20).unwrap();
        let output = messages
            .iter()
            .find(|message| message.id.ends_with("tool-output"))
            .expect("tool output");

        assert_eq!(output.status, "error");
        assert_eq!(output.exit_code, Some(1));
        assert_eq!(
            output.tool.as_ref().unwrap()["name"],
            json!("shell_command")
        );
        assert_eq!(
            output.tool.as_ref().unwrap()["title"],
            json!("Ran cargo test")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn claude_parser_maps_edit_tool_and_avoids_bare_uuid_subagent() {
        let root = unique_test_dir("claude-edit-tool-file-change");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("claude-session.jsonl");
        let lines = [
            json!({
                "type": "user",
                "uuid": "message-uuid",
                "sessionId": "claude-session",
                "cwd": "/tmp/project",
                "timestamp": "2026-07-02T00:00:00Z",
                "message": {"role": "user", "content": "please edit"}
            }),
            json!({
                "type": "assistant",
                "sessionId": "claude-session",
                "cwd": "/tmp/project",
                "timestamp": "2026-07-02T00:00:01Z",
                "message": {
                    "role": "assistant",
                    "content": [{
                        "type": "tool_use",
                        "id": "toolu-edit",
                        "name": "Edit",
                        "input": {
                            "file_path": "src/main.rs",
                            "old_string": "old one\nold two",
                            "new_string": "new one"
                        }
                    }]
                }
            }),
            json!({
                "type": "user",
                "sessionId": "claude-session",
                "cwd": "/tmp/project",
                "timestamp": "2026-07-02T00:00:02Z",
                "message": {
                    "role": "user",
                    "content": [{
                        "type": "tool_result",
                        "tool_use_id": "toolu-edit",
                        "content": "Updated src/main.rs"
                    }]
                }
            }),
        ]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        fs::write(&path, format!("{lines}\n")).unwrap();

        let (_, messages) = parse_claude_session(&path, 20).unwrap();
        let user = messages
            .iter()
            .find(|message| message.id.ends_with("-user") && message.text == "please edit")
            .expect("user message");
        assert!(user.subagent.is_none());

        let call = messages
            .iter()
            .find(|message| message.id.ends_with("tool-call"))
            .expect("tool call");
        let file_change = call.file_change.as_ref().expect("file change");
        assert_eq!(file_change["files"][0]["path"], json!("src/main.rs"));
        assert_eq!(file_change["files"][0]["kind"], json!("edit"));
        assert_eq!(file_change["files"][0]["additions"], json!(1));
        assert_eq!(file_change["files"][0]["deletions"], json!(2));

        let output = messages
            .iter()
            .find(|message| message.id.ends_with("tool-output"))
            .expect("tool output");
        assert_eq!(output.tool.as_ref().unwrap()["name"], json!("Edit"));
        assert_eq!(output.tool.as_ref().unwrap()["title"], json!("Called Edit"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn claude_sidechain_rows_resolve_root_parent_subagent_id() {
        let root = unique_test_dir("claude-sidechain-stable-id");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("claude-session.jsonl");
        let lines = [
            json!({
                "type": "user",
                "uuid": "row-a",
                "parentUuid": "mainline-spawn",
                "isSidechain": true,
                "sessionId": "claude-session",
                "cwd": "/tmp/project",
                "timestamp": "2026-07-02T00:00:00Z",
                "message": {"role": "user", "content": "sidechain prompt"}
            }),
            json!({
                "type": "assistant",
                "uuid": "row-b",
                "parentUuid": "row-a",
                "isSidechain": true,
                "sessionId": "claude-session",
                "cwd": "/tmp/project",
                "timestamp": "2026-07-02T00:00:01Z",
                "message": {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "sidechain answer"}]
                }
            }),
        ]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        fs::write(&path, format!("{lines}\n")).unwrap();

        let (_, messages) = parse_claude_session(&path, 20).unwrap();
        let scoped = messages
            .iter()
            .filter(|message| message.text.contains("sidechain"))
            .collect::<Vec<_>>();

        assert_eq!(scoped.len(), 2);
        assert_eq!(scoped[0].subagent_id, "mainline-spawn");
        assert_eq!(scoped[1].subagent_id, "mainline-spawn");
        assert_ne!(scoped[0].subagent_id, "row-a");
        assert_ne!(scoped[1].subagent_id, "row-a");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn claude_mainline_parent_uuid_does_not_create_subagent() {
        let root = unique_test_dir("claude-mainline-parent-uuid");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("claude-session.jsonl");
        let lines = [
            json!({
                "type": "user",
                "uuid": "row-user",
                "parentUuid": "previous-mainline",
                "isSidechain": false,
                "sessionId": "claude-session",
                "cwd": "/tmp/project",
                "timestamp": "2026-07-02T00:00:00Z",
                "message": {"role": "user", "content": "please inspect"}
            }),
            json!({
                "type": "assistant",
                "uuid": "row-assistant",
                "parentUuid": "row-user",
                "isSidechain": false,
                "sessionId": "claude-session",
                "cwd": "/tmp/project",
                "timestamp": "2026-07-02T00:00:01Z",
                "message": {
                    "role": "assistant",
                    "content": [
                        {"type": "text", "text": "I will inspect it"},
                        {
                            "type": "tool_use",
                            "id": "toolu-read",
                            "name": "Read",
                            "input": {"file_path": "src/main.rs"}
                        }
                    ]
                }
            }),
        ]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        fs::write(&path, format!("{lines}\n")).unwrap();

        let (_, messages) = parse_claude_session(&path, 20).unwrap();
        let assistant = messages
            .iter()
            .find(|message| message.role == "assistant" && message.text == "I will inspect it")
            .expect("assistant message");
        let tool = messages
            .iter()
            .find(|message| message.call_id == "toolu-read")
            .expect("tool call");

        assert_eq!(assistant.kind, "message");
        assert!(assistant.subagent.is_none());
        assert!(assistant.subagent_id.is_empty());
        assert_eq!(tool.kind, "tool_call");
        assert!(tool.subagent.is_none());
        assert!(tool.subagent_id.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn claude_message_usage_reads_nested_message_usage() {
        let root = unique_test_dir("claude-message-usage");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("claude-session.jsonl");
        let lines = [json!({
            "type": "assistant",
            "uuid": "row-usage",
            "sessionId": "claude-session",
            "cwd": "/tmp/project",
            "timestamp": "2026-07-02T00:00:00Z",
            "message": {
                "role": "assistant",
                "usage": {
                    "input_tokens": 17,
                    "output_tokens": 5,
                    "cache_read_input_tokens": 3,
                    "cache_creation_input_tokens": 2
                },
                "content": [{"type": "text", "text": "usage-bearing answer"}]
            }
        })]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        fs::write(&path, format!("{lines}\n")).unwrap();

        let (_, messages) = parse_claude_session(&path, 20).unwrap();
        let assistant = messages
            .iter()
            .find(|message| message.text == "usage-bearing answer")
            .expect("assistant message");
        let usage = assistant.usage.as_ref().expect("usage");

        assert_eq!(usage["input_tokens"], json!(17));
        assert_eq!(usage["output_tokens"], json!(5));
        assert_eq!(usage["cache_read_tokens"], json!(3));
        assert_eq!(usage["cache_write_tokens"], json!(2));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_rollout_stamps_messages_inside_subagent_scope() {
        let root = unique_test_dir("codex-subagent-scope");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("rollout-test.jsonl");
        let lines = [
            json!({
                "type": "session_meta",
                "timestamp": "2026-07-02T00:00:00Z",
                "payload": {"id": "codex-session", "cwd": "/tmp/project"}
            }),
            json!({
                "type": "event_msg",
                "timestamp": "2026-07-02T00:00:01Z",
                "payload": {"type": "ss", "id": "scope-a"}
            }),
            json!({
                "type": "response_item",
                "timestamp": "2026-07-02T00:00:02Z",
                "payload": {
                    "type": "function_call",
                    "name": "shell_command",
                    "call_id": "call-scope",
                    "arguments": {"command": "cargo test"}
                }
            }),
            json!({
                "type": "response_item",
                "timestamp": "2026-07-02T00:00:03Z",
                "payload": {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "inside scope"}]
                }
            }),
            json!({
                "type": "event_msg",
                "timestamp": "2026-07-02T00:00:04Z",
                "payload": {"type": "se", "id": "scope-a"}
            }),
            json!({
                "type": "response_item",
                "timestamp": "2026-07-02T00:00:05Z",
                "payload": {
                    "type": "message",
                    "role": "assistant",
                    "content": [{"type": "output_text", "text": "outside scope"}]
                }
            }),
        ]
        .into_iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        fs::write(&path, format!("{lines}\n")).unwrap();

        let (_, messages) = parse_codex_rollout(&path, 20).unwrap();
        let tool = messages
            .iter()
            .find(|message| message.call_id == "call-scope")
            .expect("scoped tool");
        let inside = messages
            .iter()
            .find(|message| message.text == "inside scope")
            .expect("scoped assistant");
        let outside = messages
            .iter()
            .find(|message| message.text == "outside scope")
            .expect("outside assistant");

        assert_eq!(tool.subagent_id, "scope-a");
        assert_eq!(inside.subagent_id, "scope-a");
        assert!(outside.subagent_id.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn opencode_tool_output_uses_native_part_duration() {
        let messages = opencode_part_message(
            "msg1",
            "assistant",
            "part1",
            "1000",
            &json!({
                "type": "tool",
                "tool": "bash",
                "callID": "call-1",
                "input": {"command": "cargo test"},
                "output": "ok",
                "time": {"start": 1000, "end": 2250}
            }),
        );
        let output = messages
            .iter()
            .find(|message| message.id.ends_with("tool-output"))
            .expect("tool output");
        assert_eq!(output.duration_ms, Some(1250));
    }

    #[test]
    fn direct_transcript_event_aliases_subagent_to_legacy_tool_call_kind() {
        let result = CodexThreadTranscriptResult {
            session_id: "session-a".to_string(),
            session_title: "Session A".to_string(),
            rollout_path: "/tmp/session-a.jsonl".to_string(),
            cwd: "/tmp/project".to_string(),
            matched_by: "sessionId".to_string(),
            latest_timestamp: "2026-07-02T00:00:00Z".to_string(),
            messages: vec![transcript_subagent_message(
                "subagent-message".to_string(),
                "claude",
                "2026-07-02T00:00:00Z",
                json!({"title": "Review worker", "subagent_id": "worker-a"}),
                "Subagent",
            )],
        };

        let value = agent_thread_transcript_direct_result_value(&result);
        let message = &value["messages"][0];
        assert_eq!(message["kind"], json!("tool_call"));
        assert_eq!(message["canonical_kind"], json!("subagent"));
        assert_eq!(message["subagent_id"], json!("worker-a"));
        assert_eq!(message["subagent"]["title"], json!("Review worker"));
        assert_eq!(message["subagent"]["subagent_id"], json!("worker-a"));
    }
}

struct CodexPendingResponseUserMessage {
    line_index: usize,
    timestamp: String,
    normalized_text: String,
    message: CodexThreadTranscriptMessage,
}

fn codex_flush_pending_response_user_messages(
    pending: &mut Vec<CodexPendingResponseUserMessage>,
    current: Option<(usize, &str)>,
    messages: &mut Vec<CodexThreadTranscriptMessage>,
    seen: &mut HashSet<String>,
    tool_metadata: &mut HashMap<String, TranscriptToolCallMetadata>,
) {
    let mut index = 0usize;
    while index < pending.len() {
        let should_flush = match current {
            Some((line_index, timestamp)) => !codex_user_message_in_dedupe_window(
                pending[index].line_index,
                &pending[index].timestamp,
                line_index,
                timestamp,
            ),
            None => true,
        };
        if should_flush {
            let pending_message = pending.remove(index);
            push_codex_message_with_tool_metadata(
                messages,
                seen,
                Some(pending_message.message),
                tool_metadata,
            );
        } else {
            index = index.saturating_add(1);
        }
    }
}

fn codex_drop_pending_response_user_messages(
    pending: &mut Vec<CodexPendingResponseUserMessage>,
    line_index: usize,
    timestamp: &str,
    normalized_text: &str,
) {
    pending.retain(|entry| {
        entry.normalized_text != normalized_text
            || !codex_user_message_in_dedupe_window(
                entry.line_index,
                &entry.timestamp,
                line_index,
                timestamp,
            )
    });
}

fn parse_codex_rollout(
    path: &Path,
    max_messages: usize,
) -> Result<(CodexRolloutMeta, Vec<CodexThreadTranscriptMessage>), String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("Unable to open Codex rollout {}: {error}", path.display()))?;
    let reader = std::io::BufReader::new(file);
    let mut meta = CodexRolloutMeta {
        session_id: String::new(),
        cwd: String::new(),
        latest_timestamp: String::new(),
        title: String::new(),
    };
    let mut messages = Vec::new();
    let mut seen = HashSet::new();
    let mut tool_metadata = HashMap::<String, TranscriptToolCallMetadata>::new();
    let mut active_subagents = Vec::<Value>::new();
    let mut user_dedupe = CodexUserMessageDedupeTracker::default();
    let mut pending_response_users = Vec::<CodexPendingResponseUserMessage>::new();

    for (line_index, line) in std::io::BufRead::lines(reader).enumerate() {
        let Ok(line) = line else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let timestamp = value_string(value.get("timestamp"));
        if !timestamp.is_empty() {
            meta.latest_timestamp = timestamp.clone();
        }
        let record_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let payload = value.get("payload").unwrap_or(&Value::Null);
        if codex_value_is_internal_context_record(&value) {
            continue;
        }
        codex_flush_pending_response_user_messages(
            &mut pending_response_users,
            Some((line_index, &timestamp)),
            &mut messages,
            &mut seen,
            &mut tool_metadata,
        );
        let event_user_text = (record_type == "event_msg")
            .then(|| codex_event_user_message_normalized_text(payload))
            .flatten();
        if event_user_text.is_none() {
            codex_flush_pending_response_user_messages(
                &mut pending_response_users,
                None,
                &mut messages,
                &mut seen,
                &mut tool_metadata,
            );
        }
        match record_type {
            "session_meta" => {
                meta.session_id = clean_codex_id(value_string(payload.get("id")));
                meta.cwd = value_string(payload.get("cwd"));
            }
            "event_msg" => {
                if payload.get("type").and_then(Value::as_str) == Some("thread_name_updated") {
                    meta.title = clean_codex_title(value_string(payload.get("thread_name")), "");
                }
                if let Some(normalized_text) = event_user_text {
                    codex_drop_pending_response_user_messages(
                        &mut pending_response_users,
                        line_index,
                        &timestamp,
                        &normalized_text,
                    );
                    codex_flush_pending_response_user_messages(
                        &mut pending_response_users,
                        None,
                        &mut messages,
                        &mut seen,
                        &mut tool_metadata,
                    );
                    user_dedupe.observe_event(line_index, &timestamp, normalized_text);
                }
                let mut parsed_messages =
                    codex_messages_from_event(line_index, &timestamp, payload);
                transcript_apply_codex_subagent_scope(
                    &mut active_subagents,
                    payload,
                    &mut parsed_messages,
                );
                for message in parsed_messages {
                    push_codex_message_with_tool_metadata(
                        &mut messages,
                        &mut seen,
                        Some(message),
                        &mut tool_metadata,
                    );
                }
            }
            "response_item" => {
                let mut parsed_messages =
                    codex_messages_from_response_item(line_index, &timestamp, payload);
                transcript_apply_codex_subagent_scope(
                    &mut active_subagents,
                    payload,
                    &mut parsed_messages,
                );
                if let Some(normalized_text) =
                    codex_response_item_user_message_normalized_text(payload)
                {
                    if user_dedupe.matches_recent_event(line_index, &timestamp, &normalized_text) {
                        continue;
                    }
                    let mut remaining = Vec::new();
                    for message in parsed_messages {
                        if message.role == "user"
                            && codex_normalize_user_prompt_text(&message.text) == normalized_text
                        {
                            pending_response_users.push(CodexPendingResponseUserMessage {
                                line_index,
                                timestamp: timestamp.clone(),
                                normalized_text: normalized_text.clone(),
                                message,
                            });
                        } else {
                            remaining.push(message);
                        }
                    }
                    parsed_messages = remaining;
                }
                for message in parsed_messages {
                    push_codex_message_with_tool_metadata(
                        &mut messages,
                        &mut seen,
                        Some(message),
                        &mut tool_metadata,
                    );
                }
            }
            _ => {}
        }
    }

    codex_flush_pending_response_user_messages(
        &mut pending_response_users,
        None,
        &mut messages,
        &mut seen,
        &mut tool_metadata,
    );

    if messages.len() > max_messages {
        messages = messages[messages.len() - max_messages..].to_vec();
    }

    Ok((meta, messages))
}

fn find_codex_rollout(
    provider_session_id: &str,
    cwd: &str,
) -> Result<(PathBuf, CodexRolloutMeta, String), String> {
    let files = collect_codex_rollout_candidates(cwd)?;

    let requested_session_id = clean_codex_id(provider_session_id);
    if !requested_session_id.is_empty() {
        for path in &files {
            let name_match = path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.contains(&requested_session_id));
            let Some(meta) = codex_rollout_meta(path) else {
                continue;
            };
            if name_match || meta.session_id == requested_session_id {
                return Ok((path.clone(), meta, "sessionId".to_string()));
            }
        }
    }

    Err("No Codex transcript matched this thread session.".to_string())
}

fn codex_rollout_line_is_unresumable_image_item(line: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(line.trim()) else {
        return false;
    };
    if value.get("type").and_then(Value::as_str) != Some("response_item") {
        return false;
    }

    let payload = value.get("payload").unwrap_or(&Value::Null);
    payload.get("type").and_then(Value::as_str) == Some("image_generation_call")
        && payload
            .get("id")
            .and_then(Value::as_str)
            .is_some_and(|id| id.trim().starts_with("ig_"))
}

fn sanitize_codex_rollout_for_resume(body: &str) -> (String, usize) {
    let mut sanitized = String::with_capacity(body.len());
    let mut removed = 0usize;

    for line in body.split_inclusive('\n') {
        if codex_rollout_line_is_unresumable_image_item(line) {
            removed += 1;
        } else {
            sanitized.push_str(line);
        }
    }

    (sanitized, removed)
}

fn prepare_codex_rollout_for_resume(provider_session_id: &str, cwd: &str) -> Result<usize, String> {
    if provider_session_id.trim().is_empty() {
        return Ok(0);
    }

    let (path, _, _) = find_codex_rollout(provider_session_id, cwd)?;
    let body = fs::read_to_string(&path)
        .map_err(|error| format!("Unable to read Codex rollout {}: {error}", path.display()))?;
    let (sanitized, removed) = sanitize_codex_rollout_for_resume(&body);
    if removed > 0 {
        fs::write(&path, sanitized).map_err(|error| {
            format!(
                "Unable to repair Codex rollout {} before resume: {error}",
                path.display()
            )
        })?;
    }

    Ok(removed)
}

fn find_codex_rollout_in_home(
    provider_session_id: &str,
    home: &Path,
) -> Result<PathBuf, String> {
    let requested_session_id = clean_codex_id(provider_session_id);
    if requested_session_id.is_empty() {
        return Err("Codex rollout transcript has no resumable session id.".to_string());
    }
    let mut files = Vec::new();
    collect_codex_rollout_files(&home.join("sessions"), &mut files);
    sort_rollouts_newest_first(&mut files);
    for path in files {
        let name_match = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.contains(&requested_session_id));
        let meta_match = codex_rollout_meta(&path)
            .is_some_and(|meta| meta.session_id == requested_session_id);
        if name_match || meta_match {
            return Ok(path);
        }
    }
    Err(format!(
        "No Codex transcript matched this thread session in {}.",
        home.join("sessions").display()
    ))
}

fn materialize_codex_rollout_in_managed_home(
    provider_session_id: &str,
    source_home: &Path,
    managed_home: &Path,
) -> Result<PathBuf, String> {
    let source_sessions = source_home.join("sessions");
    let source = find_codex_rollout_in_home(provider_session_id, source_home)?;
    let relative = source.strip_prefix(&source_sessions).map_err(|_| {
        format!(
            "Codex rollout {} is outside its source home {}.",
            source.display(),
            source_sessions.display()
        )
    })?;
    let destination = managed_home.join("sessions").join(relative);
    let paths_match = source == destination
        || matches!(
            (source.canonicalize(), destination.canonicalize()),
            (Ok(source), Ok(destination)) if source == destination
        );
    if paths_match {
        return Ok(destination);
    }
    if fs::symlink_metadata(&destination).is_ok() {
        if destination.is_file() {
            return Ok(destination);
        }
        fs::remove_file(&destination).map_err(|error| {
            format!(
                "Unable to replace staged Codex rollout {}: {error}",
                destination.display()
            )
        })?;
    }
    let parent = destination.parent().ok_or_else(|| {
        format!(
            "Codex rollout destination has no parent: {}.",
            destination.display()
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Unable to prepare managed Codex sessions directory {}: {error}",
            parent.display()
        )
    })?;
    codex_link_or_copy_rollout(&source, &destination).map_err(|error| {
        format!(
            "Unable to stage Codex rollout {} in managed home {}: {error}",
            source.display(),
            managed_home.display()
        )
    })?;
    Ok(destination)
}

#[cfg(unix)]
fn codex_link_or_copy_rollout(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(source, destination)
        .or_else(|_| fs::hard_link(source, destination))
        .or_else(|_| fs::copy(source, destination).map(|_| ()))
}

#[cfg(windows)]
fn codex_link_or_copy_rollout(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(source, destination)
        .or_else(|_| fs::hard_link(source, destination))
        .or_else(|_| fs::copy(source, destination).map(|_| ()))
}

#[cfg(not(any(unix, windows)))]
fn codex_link_or_copy_rollout(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::hard_link(source, destination).or_else(|_| fs::copy(source, destination).map(|_| ()))
}

fn codex_home_from_rollout_path(path: &Path) -> Option<PathBuf> {
    let mut current = path.parent();
    while let Some(parent) = current {
        if parent.file_name().and_then(|name| name.to_str()) == Some("sessions") {
            return parent.parent().map(Path::to_path_buf);
        }
        current = parent.parent();
    }
    None
}

fn resolve_codex_resume_session(
    provider_session_id: &str,
    cwd: &str,
) -> Result<(String, PathBuf), String> {
    let (path, meta, _) = find_codex_rollout(provider_session_id, cwd)?;
    if meta.session_id.trim().is_empty() {
        return Err("Codex rollout transcript has no resumable session id.".to_string());
    }
    let home = codex_home_from_rollout_path(&path).ok_or_else(|| {
        "Codex rollout transcript is not inside a sessions directory.".to_string()
    })?;
    Ok((meta.session_id, home))
}

fn claude_home_dir() -> Option<PathBuf> {
    env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".claude")))
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude")))
}

fn claude_home_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let mut seen = HashSet::new();
    if let Some(home) = claude_home_dir() {
        push_unique_path(&mut paths, &mut seen, home);
    }
    if let Some(home) = agent_accounts_profile_home_for_launch("claude") {
        push_unique_path(&mut paths, &mut seen, home);
    }
    if let Some(profile_root) = diffforge_app_support_dir()
        .map(|root| root.join("agent-profiles").join("claude"))
        .filter(|root| root.is_dir())
    {
        let Ok(entries) = fs::read_dir(profile_root) else {
            return paths;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                push_unique_path(&mut paths, &mut seen, path);
            }
        }
    }
    paths
}

fn claude_home_for_launch() -> Option<PathBuf> {
    // Spawn-time account binding prefers the selected/captured Claude profile
    // over the process-wide default. Resume validation must inspect that same
    // store; finding the id under a different local account would still make
    // `claude --resume` fail after the launch env is applied.
    agent_accounts_profile_home_for_launch("claude").or_else(claude_home_dir)
}

fn claude_project_dir_name(cwd: &str) -> String {
    cwd.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect()
}

fn collect_claude_session_files(root: &Path, files: &mut Vec<PathBuf>) {
    if files.len() >= CODEX_ROLLOUT_SCAN_LIMIT {
        return;
    }

    let Ok(entries) = fs::read_dir(root) else {
        return;
    };

    for entry in entries.flatten() {
        if files.len() >= CODEX_ROLLOUT_SCAN_LIMIT {
            return;
        }

        let path = entry.path();
        if path.is_dir() {
            collect_claude_session_files(&path, files);
            continue;
        }

        if path.extension().and_then(|extension| extension.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

fn collect_claude_candidate_files(cwd: &str) -> Result<Vec<PathBuf>, String> {
    let homes = claude_home_candidates();
    if homes.is_empty() {
        return Err("Unable to locate Claude Code home.".to_string());
    }

    let mut files = Vec::new();
    for home in homes {
        if files.len() >= CODEX_ROLLOUT_SCAN_LIMIT {
            break;
        }
        let projects_dir = home.join("projects");
        if !projects_dir.exists() {
            continue;
        }
        if !cwd.trim().is_empty() {
            let encoded = claude_project_dir_name(cwd);
            for candidate in [
                projects_dir.join(&encoded),
                projects_dir.join(encoded.to_lowercase()),
            ] {
                if candidate.exists() {
                    collect_claude_session_files(&candidate, &mut files);
                }
            }
        }
        collect_claude_session_files(&projects_dir, &mut files);
    }
    sort_rollouts_newest_first(&mut files);

    if files.is_empty() {
        return Err("No Claude Code transcripts were found.".to_string());
    }
    Ok(files)
}

fn claude_file_meta(path: &Path) -> Option<CodexRolloutMeta> {
    let file = fs::File::open(path).ok()?;
    let reader = std::io::BufReader::new(file);
    let mut session_id = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .map(clean_codex_id)
        .unwrap_or_default();
    let mut cwd = String::new();
    let mut latest_timestamp = String::new();
    let mut title = String::new();

    for line in std::io::BufRead::lines(reader).take(80).flatten() {
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let timestamp = value_string(value.get("timestamp"));
        if !timestamp.is_empty() {
            latest_timestamp = timestamp;
        }
        let next_session_id = clean_codex_id(value_string(value.get("sessionId")));
        if !next_session_id.is_empty() {
            session_id = next_session_id;
        }
        let next_cwd = value_string(value.get("cwd"));
        if !next_cwd.is_empty() {
            cwd = next_cwd;
        }
        let entry_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if entry_type == "ai-title" {
            title = clean_codex_title(value_string(value.get("aiTitle")), "");
        } else if entry_type == "summary" {
            title = clean_codex_title(value_string(value.get("summary")), "");
        }
        if !session_id.is_empty() && !cwd.is_empty() && !title.is_empty() {
            break;
        }
    }

    if session_id.is_empty() {
        return None;
    }

    Some(CodexRolloutMeta {
        session_id,
        cwd,
        latest_timestamp,
        title,
    })
}

fn find_claude_session_in_homes(
    provider_session_id: &str,
    cwd: &str,
    homes: &[PathBuf],
    top_level_only: bool,
) -> Result<(PathBuf, CodexRolloutMeta, String), String> {
    let requested_session_id = clean_codex_id(provider_session_id);
    if requested_session_id.is_empty() {
        return Err("Claude Code session id is required.".to_string());
    }

    let mut direct_matches = Vec::new();
    let mut seen = HashSet::new();
    for home in homes {
        let projects_dir = home.join("projects");
        if !cwd.trim().is_empty() {
            let encoded = claude_project_dir_name(cwd);
            for project_dir in [
                projects_dir.join(&encoded),
                projects_dir.join(encoded.to_lowercase()),
            ] {
                let path = project_dir.join(format!("{requested_session_id}.jsonl"));
                if path.is_file() {
                    push_unique_path(&mut direct_matches, &mut seen, path);
                }
            }
        }

        let Ok(entries) = fs::read_dir(&projects_dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path().join(format!("{requested_session_id}.jsonl"));
            if path.is_file() {
                push_unique_path(&mut direct_matches, &mut seen, path);
            }
        }
    }

    for path in direct_matches {
        let Some(meta) = claude_file_meta(&path) else {
            continue;
        };
        if meta.session_id != requested_session_id {
            continue;
        }
        if !cwd.trim().is_empty()
            && !meta.cwd.trim().is_empty()
            && !agent_paths_match(&meta.cwd, cwd)
        {
            continue;
        }
        return Ok((path, meta, "sessionId".to_string()));
    }

    if top_level_only {
        return Err(
            "No local Claude Code conversation matched this session and workspace.".to_string(),
        );
    }

    // Claude normally stores a top-level conversation directly below its
    // encoded project directory. Keep the recursive fallback for provider
    // layouts that nest transcripts (and for older stores), while still
    // requiring both the exact session id and the requested project cwd.
    let mut files = Vec::new();
    for home in homes {
        collect_claude_session_files(&home.join("projects"), &mut files);
    }
    sort_rollouts_newest_first(&mut files);
    for path in files {
        let file_match = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .is_some_and(|name| name == requested_session_id);
        let Some(meta) = claude_file_meta(&path) else {
            continue;
        };
        if !file_match || meta.session_id != requested_session_id {
            continue;
        }
        if !cwd.trim().is_empty()
            && !meta.cwd.trim().is_empty()
            && !agent_paths_match(&meta.cwd, cwd)
        {
            continue;
        }
        return Ok((path, meta, "sessionId".to_string()));
    }

    Err("No local Claude Code conversation matched this session and workspace.".to_string())
}

fn find_claude_session(
    provider_session_id: &str,
    cwd: &str,
) -> Result<(PathBuf, CodexRolloutMeta, String), String> {
    find_claude_session_in_homes(
        provider_session_id,
        cwd,
        &claude_home_candidates(),
        false,
    )
}

fn resolve_claude_resume_session_in_home(
    provider_session_id: &str,
    cwd: &str,
    home: &Path,
) -> Result<String, String> {
    let (_, meta, _) =
        find_claude_session_in_homes(provider_session_id, cwd, &[home.to_path_buf()], true)?;
    let session_id = clean_codex_id(meta.session_id);
    if session_id.is_empty() {
        return Err("Claude Code transcript has no resumable session id.".to_string());
    }
    Ok(session_id)
}

fn resolve_claude_resume_session(provider_session_id: &str, cwd: &str) -> Result<String, String> {
    let home = claude_home_for_launch()
        .ok_or_else(|| "Unable to locate the active Claude Code home.".to_string())?;
    resolve_claude_resume_session_in_home(provider_session_id, cwd, &home)
}

fn claude_local_resume_index_in_home(home: &Path) -> HashMap<String, Vec<String>> {
    let mut files = Vec::new();
    if let Ok(projects) = fs::read_dir(home.join("projects")) {
        for project in projects.flatten() {
            let project_dir = project.path();
            if !project_dir.is_dir() {
                continue;
            }
            let Ok(entries) = fs::read_dir(project_dir) else {
                continue;
            };
            files.extend(entries.flatten().filter_map(|entry| {
                let path = entry.path();
                (path.is_file()
                    && path.extension().and_then(|extension| extension.to_str()) == Some("jsonl"))
                .then_some(path)
            }));
        }
    }
    let mut sessions = HashMap::<String, Vec<String>>::new();
    for path in files {
        let Some(meta) = claude_file_meta(&path) else {
            continue;
        };
        let session_id = clean_codex_id(meta.session_id);
        let file_session_id = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(clean_codex_id)
            .unwrap_or_default();
        if session_id.is_empty() || file_session_id != session_id {
            continue;
        }
        sessions.entry(session_id).or_default().push(meta.cwd);
    }
    sessions
}

fn claude_local_resume_index_for_launch() -> HashMap<String, Vec<String>> {
    claude_home_for_launch()
        .as_deref()
        .map(claude_local_resume_index_in_home)
        .unwrap_or_default()
}

fn claude_local_resume_index_contains(
    sessions: &HashMap<String, Vec<String>>,
    provider_session_id: &str,
    cwd: &str,
) -> bool {
    let session_id = clean_codex_id(provider_session_id);
    sessions.get(&session_id).is_some_and(|session_cwds| {
        session_cwds.iter().any(|session_cwd| {
            cwd.trim().is_empty()
                || session_cwd.trim().is_empty()
                || agent_paths_match(session_cwd, cwd)
        })
    })
}

fn claude_content_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.to_string(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                let item_type = item.get("type").and_then(Value::as_str).unwrap_or_default();
                match item_type {
                    "text" => item.get("text").and_then(Value::as_str).map(str::to_string),
                    _ => None,
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(object) => object
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

fn claude_tool_title(name: &str, input: &Value) -> String {
    let fallback = if name.trim().is_empty() {
        "Called tool".to_string()
    } else {
        format!("Called {name}")
    };
    let normalized_name = name.trim().to_lowercase();
    if normalized_name == "bash" || normalized_name == "shell" {
        let command = value_string(input.get("command"));
        if !command.trim().is_empty() {
            return command_title(&command, &fallback);
        }
    }

    fallback
}

fn claude_stop_reason_completes_turn(stop_reason: &str) -> bool {
    let stop_reason = stop_reason.trim();
    !stop_reason.is_empty() && stop_reason != "tool_use" && stop_reason != "max_tokens"
}

fn claude_activity_from_block(
    line_index: usize,
    block_index: usize,
    timestamp: &str,
    block: &Value,
    parent_subagent: Option<&Value>,
) -> Option<CodexThreadTranscriptMessage> {
    let block_type = block
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match block_type {
        "tool_use" => {
            let name = value_string(block.get("name"));
            let call_id = value_string(block.get("id"));
            let input_value = block.get("input").unwrap_or(&Value::Null);
            let subagent = if name.trim().eq_ignore_ascii_case("task")
                || name.trim().eq_ignore_ascii_case("subagent")
            {
                transcript_subagent_from_value(input_value, "Subagent")
            } else {
                None
            };
            if let Some(subagent) = subagent {
                return Some(transcript_subagent_message(
                    format!("claude-{line_index}-{block_index}-subagent"),
                    "claude",
                    timestamp,
                    subagent,
                    "Subagent",
                ));
            }
            let input = block
                .get("input")
                .map(pretty_json)
                .unwrap_or_else(|| "{}".to_string());
            let (text, truncated) =
                clean_codex_transcript_text_with_truncation(input, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
            let title = clean_codex_title(claude_tool_title(&name, input_value), "Called tool");
            let file_change = transcript_file_change_from_claude_tool_input(&name, input_value);
            Some(CodexThreadTranscriptMessage {
                id: format!("claude-{line_index}-{block_index}-tool-call"),
                role: "activity".to_string(),
                kind: "tool_call".to_string(),
                text,
                title: title.clone(),
                call_id: call_id.clone(),
                status: "running".to_string(),
                created_at: timestamp.to_string(),
                source: "claude".to_string(),
                tool: Some(transcript_tool_object(
                    name.clone(),
                    call_id,
                    "running",
                    block.get("input").cloned(),
                    None,
                    title,
                )),
                file_change,
                subagent_id: parent_subagent
                    .map(transcript_subagent_link_id)
                    .unwrap_or_default(),
                subagent: parent_subagent.cloned(),
                usage: transcript_usage_from_value(block),
                truncated,
                artifacts: Vec::new(),
                ..Default::default()
            })
        }
        "tool_result" => {
            let call_id = value_string(block.get("tool_use_id"));
            let content = block
                .get("content")
                .map(claude_content_text)
                .unwrap_or_default();
            let (text, text_truncated) = clean_codex_transcript_text_with_truncation(
                &content,
                CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
            );
            let (tool_output, output_truncated) = transcript_tool_io_value(
                block.get("content"),
                &content,
                CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
            );
            let artifacts = codex_image_artifacts_from_content(block, &content, "Tool output");
            let has_error = transcript_tool_value_has_error(block);
            let kind = if has_error {
                "tool_output".to_string()
            } else {
                codex_artifact_activity_kind(&text, &artifacts)
            };
            let title = if has_error {
                "Tool error".to_string()
            } else {
                codex_artifact_activity_title(&text, "Tool output", &artifacts)
            };
            Some(CodexThreadTranscriptMessage {
                id: format!("claude-{line_index}-{block_index}-tool-output"),
                role: "activity".to_string(),
                kind,
                text,
                title: title.clone(),
                call_id: call_id.clone(),
                status: if has_error { "error" } else { "completed" }.to_string(),
                created_at: timestamp.to_string(),
                source: "claude".to_string(),
                tool: Some(transcript_tool_object(
                    "",
                    &call_id,
                    if has_error { "failed" } else { "completed" },
                    None,
                    tool_output.clone(),
                    &title,
                )),
                tool_output: (!has_error).then(|| tool_output.clone()).flatten(),
                tool_error: has_error.then(|| tool_output.clone()).flatten(),
                subagent_id: parent_subagent
                    .map(transcript_subagent_link_id)
                    .unwrap_or_default(),
                subagent: parent_subagent.cloned(),
                usage: transcript_usage_from_value(block),
                truncated: text_truncated || output_truncated,
                artifacts,
                ..Default::default()
            })
        }
        "thinking" => {
            let thinking = value_string(block.get("thinking"));
            if thinking.is_empty() {
                None
            } else {
                let (text, truncated) = clean_codex_transcript_text_with_truncation(
                    thinking,
                    CODEX_TRANSCRIPT_MAX_REASONING_TEXT,
                );
                Some(CodexThreadTranscriptMessage {
                    id: format!("claude-{line_index}-{block_index}-reasoning"),
                    role: "activity".to_string(),
                    kind: "reasoning".to_string(),
                    text,
                    title: "Reasoning".to_string(),
                    call_id: String::new(),
                    created_at: timestamp.to_string(),
                    source: "claude".to_string(),
                    subagent_id: parent_subagent
                        .map(transcript_subagent_link_id)
                        .unwrap_or_default(),
                    subagent: parent_subagent.cloned(),
                    usage: transcript_usage_from_value(block),
                    truncated,
                    artifacts: Vec::new(),
                    ..Default::default()
                })
            }
        }
        _ => None,
    }
}

fn parse_claude_session(
    path: &Path,
    max_messages: usize,
) -> Result<(CodexRolloutMeta, Vec<CodexThreadTranscriptMessage>), String> {
    let file = fs::File::open(path).map_err(|error| {
        format!(
            "Unable to open Claude Code transcript {}: {error}",
            path.display()
        )
    })?;
    let reader = std::io::BufReader::new(file);
    let mut meta = CodexRolloutMeta {
        session_id: path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .map(clean_codex_id)
            .unwrap_or_default(),
        cwd: String::new(),
        latest_timestamp: String::new(),
        title: String::new(),
    };
    let mut messages = Vec::new();
    let mut seen = HashSet::new();
    let mut tool_metadata = HashMap::<String, TranscriptToolCallMetadata>::new();
    let mut sidechains = TranscriptClaudeSidechainTracker::default();

    for (line_index, line) in std::io::BufRead::lines(reader).enumerate() {
        let Ok(line) = line else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let timestamp = value_string(value.get("timestamp"));
        if !timestamp.is_empty() {
            meta.latest_timestamp = timestamp.clone();
        }
        let session_id = clean_codex_id(value_string(value.get("sessionId")));
        if !session_id.is_empty() {
            meta.session_id = session_id;
        }
        let cwd = value_string(value.get("cwd"));
        if !cwd.is_empty() {
            meta.cwd = cwd;
        }

        let entry_type = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if entry_type == "ai-title" {
            meta.title = clean_codex_title(value_string(value.get("aiTitle")), "");
            continue;
        }
        if entry_type == "summary" {
            meta.title = clean_codex_title(value_string(value.get("summary")), "");
            continue;
        }
        if entry_type == "result" {
            let is_error = value
                .get("is_error")
                .and_then(Value::as_bool)
                .unwrap_or(false)
                || value_string(value.get("subtype"))
                    .to_lowercase()
                    .contains("error");
            let result_text = first_value_string(&[
                value.get("result"),
                value.get("message"),
                value.get("error"),
            ]);
            if is_error {
                push_codex_message_with_tool_metadata(
                    &mut messages,
                    &mut seen,
                    Some(transcript_error_message(
                        format!("claude-{line_index}-result-error"),
                        "claude",
                        &timestamp,
                        if result_text.trim().is_empty() {
                            "Claude Code turn failed"
                        } else {
                            result_text.as_str()
                        },
                    )),
                    &mut tool_metadata,
                );
            } else {
                let (assistant_text, assistant_truncated) =
                    clean_codex_transcript_text_with_truncation(
                        &result_text,
                        CODEX_TRANSCRIPT_MAX_TEXT,
                    );
                let already_has_assistant_text = !assistant_text.is_empty()
                    && messages.iter().rev().any(|message| {
                        message.role == "assistant" && message.text == assistant_text
                    });
                if !assistant_text.is_empty() && !already_has_assistant_text {
                    push_codex_message_with_tool_metadata(
                        &mut messages,
                        &mut seen,
                        Some(CodexThreadTranscriptMessage {
                            id: format!("claude-{line_index}-result-assistant"),
                            role: "assistant".to_string(),
                            kind: "message".to_string(),
                            text: assistant_text,
                            title: String::new(),
                            call_id: String::new(),
                            created_at: timestamp.clone(),
                            source: "claude".to_string(),
                            usage: transcript_usage_from_value(&value),
                            truncated: assistant_truncated,
                            artifacts: Vec::new(),
                            ..Default::default()
                        }),
                        &mut tool_metadata,
                    );
                }
                push_codex_message_with_tool_metadata(
                    &mut messages,
                    &mut seen,
                    Some(transcript_task_complete_message(
                        format!("claude-{line_index}-task-complete"),
                        "claude",
                        &timestamp,
                        result_text,
                    )),
                    &mut tool_metadata,
                );
            }
            continue;
        }
        let Some(message) = value.get("message") else {
            continue;
        };
        let content = message.get("content").unwrap_or(&Value::Null);

        let message_role = value_string(message.get("role"));
        if entry_type == "user"
            || entry_type == "assistant"
            || message_role == "user"
            || message_role == "assistant"
        {
            let role = if entry_type == "assistant" || message_role == "assistant" {
                "assistant"
            } else {
                "user"
            };
            let (text, truncated) = clean_codex_transcript_text_with_truncation(
                claude_content_text(content),
                CODEX_TRANSCRIPT_MAX_TEXT,
            );
            let parent_subagent = sidechains.subagent_from_value(&value, "Sidechain");
            if !text.is_empty() {
                push_codex_message_with_tool_metadata(
                    &mut messages,
                    &mut seen,
                    Some(CodexThreadTranscriptMessage {
                        id: format!("claude-{line_index}-{role}"),
                        role: role.to_string(),
                        kind: "message".to_string(),
                        text: text.clone(),
                        title: String::new(),
                        call_id: String::new(),
                        created_at: timestamp.clone(),
                        source: "claude".to_string(),
                        subagent_id: parent_subagent
                            .as_ref()
                            .map(transcript_subagent_link_id)
                            .unwrap_or_default(),
                        subagent: parent_subagent.clone(),
                        usage: transcript_usage_from_value(&value),
                        truncated,
                        artifacts: Vec::new(),
                        ..Default::default()
                    }),
                    &mut tool_metadata,
                );
            }

            if let Some(blocks) = content.as_array() {
                for (block_index, block) in blocks.iter().enumerate() {
                    push_codex_message_with_tool_metadata(
                        &mut messages,
                        &mut seen,
                        claude_activity_from_block(
                            line_index,
                            block_index,
                            &timestamp,
                            block,
                            parent_subagent.as_ref(),
                        ),
                        &mut tool_metadata,
                    );
                }
            }

            if role == "assistant"
                && claude_stop_reason_completes_turn(&value_string(
                    message
                        .get("stop_reason")
                        .or_else(|| value.get("stop_reason")),
                ))
            {
                push_codex_message_with_tool_metadata(
                    &mut messages,
                    &mut seen,
                    Some(transcript_task_complete_message(
                        format!("claude-{line_index}-task-complete"),
                        "claude",
                        &timestamp,
                        text,
                    )),
                    &mut tool_metadata,
                );
            }
        }
    }

    if messages.len() > max_messages {
        messages = messages[messages.len() - max_messages..].to_vec();
    }

    Ok((meta, messages))
}

fn opencode_native_data_home() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(value) = env::var_os("XDG_DATA_HOME") {
        candidates.push(PathBuf::from(value).join("opencode"));
    }
    if let Some(home) = user_home_dir() {
        candidates.push(home.join(".local").join("share").join("opencode"));
        candidates.push(home.join("AppData").join("Roaming").join("opencode"));
        candidates.push(home.join("AppData").join("Local").join("opencode"));
    }
    candidates.dedup();
    candidates
}

fn opencode_data_home() -> Vec<PathBuf> {
    let mut candidates = agent_accounts_active_profile_dir("opencode")
        .map(|profile_root| vec![PathBuf::from(profile_root).join("opencode")])
        .unwrap_or_default();
    candidates.extend(opencode_native_data_home());
    candidates.dedup();
    candidates
}

fn opencode_db_path() -> Option<PathBuf> {
    opencode_data_home()
        .into_iter()
        .map(|path| path.join("opencode.db"))
        .find(|path| path.exists())
}

fn opencode_timestamp(value: i64) -> String {
    if value <= 0 {
        String::new()
    } else {
        value.to_string()
    }
}

fn opencode_json_text(value: Option<&Value>) -> String {
    value
        .map(|value| match value {
            Value::String(text) => text.clone(),
            Value::Array(_) | Value::Object(_) => pretty_json(value),
            _ => value.to_string(),
        })
        .unwrap_or_default()
}

fn opencode_tool_title(tool: &str, input_value: &Value) -> String {
    let fallback = if tool.trim().is_empty() {
        "Called tool".to_string()
    } else {
        format!("Called {tool}")
    };
    let normalized_tool = tool.trim().to_lowercase();
    if normalized_tool == "bash" || normalized_tool == "shell" {
        let command = value_string(input_value.get("command")).trim().to_string();
        if !command.is_empty() {
            return command_title(&command, &fallback);
        }
    }

    fallback
}

fn opencode_part_created_at(timestamp: &str, data: &Value, end_time: bool) -> String {
    let time = data.get("time").unwrap_or(&Value::Null);
    let state_time = data
        .get("state")
        .and_then(|state| state.get("time"))
        .unwrap_or(&Value::Null);
    let key = if end_time { "end" } else { "start" };
    let raw = time
        .get(key)
        .or_else(|| state_time.get(key))
        .and_then(Value::as_i64)
        .unwrap_or_default();
    let stamped = opencode_timestamp(raw);
    if stamped.is_empty() {
        timestamp.to_string()
    } else {
        stamped
    }
}

fn opencode_part_duration_ms(data: &Value) -> Option<u64> {
    let time = data.get("time").unwrap_or(&Value::Null);
    let state_time = data
        .get("state")
        .and_then(|state| state.get("time"))
        .unwrap_or(&Value::Null);
    let start = first_value_i64(&[time.get("start"), state_time.get("start")])?;
    let end = first_value_i64(&[time.get("end"), state_time.get("end")])?;
    (end >= start).then_some((end - start) as u64)
}

fn opencode_part_message(
    message_id: &str,
    role: &str,
    part_id: &str,
    timestamp: &str,
    data: &Value,
) -> Vec<CodexThreadTranscriptMessage> {
    let part_type = data.get("type").and_then(Value::as_str).unwrap_or_default();
    let message_role = if role == "assistant" {
        "assistant"
    } else {
        "user"
    };
    match part_type {
        "text" => {
            let text = first_value_string(&[data.get("text"), data.get("content")]);
            if text.trim().is_empty() {
                return Vec::new();
            }
            let (text, truncated) =
                clean_codex_transcript_text_with_truncation(text, CODEX_TRANSCRIPT_MAX_TEXT);
            vec![CodexThreadTranscriptMessage {
                id: format!("opencode-{message_id}-{part_id}-text"),
                role: message_role.to_string(),
                kind: "message".to_string(),
                text,
                title: String::new(),
                call_id: String::new(),
                created_at: opencode_part_created_at(timestamp, data, false),
                source: "opencode".to_string(),
                usage: transcript_usage_from_value(data),
                truncated,
                artifacts: Vec::new(),
                ..Default::default()
            }]
        }
        "reasoning" => {
            let text = first_value_string(&[data.get("text"), data.get("content")]);
            if text.trim().is_empty() {
                return Vec::new();
            }
            let text = clean_codex_reasoning_text(text);
            let truncated = text.ends_with("[truncated]");
            vec![CodexThreadTranscriptMessage {
                id: format!("opencode-{message_id}-{part_id}-reasoning"),
                role: "activity".to_string(),
                kind: "reasoning".to_string(),
                text,
                title: "Reasoning".to_string(),
                call_id: String::new(),
                created_at: opencode_part_created_at(timestamp, data, false),
                source: "opencode".to_string(),
                usage: transcript_usage_from_value(data),
                truncated,
                artifacts: Vec::new(),
                ..Default::default()
            }]
        }
        "tool" => {
            let tool = first_value_string(&[data.get("tool"), data.get("name"), data.get("title")]);
            let call_id =
                first_value_string(&[data.get("callID"), data.get("callId"), data.get("id")]);
            let state = data.get("state").unwrap_or(&Value::Null);
            let input_value = data
                .get("input")
                .or_else(|| state.get("input"))
                .unwrap_or(&Value::Null);
            let input = opencode_json_text(data.get("input").or_else(|| state.get("input")));
            let output = opencode_json_text(
                data.get("output")
                    .or_else(|| data.get("result"))
                    .or_else(|| state.get("output"))
                    .or_else(|| state.get("result")),
            );
            let error = opencode_json_text(data.get("error").or_else(|| state.get("error")));
            let duration_ms = opencode_part_duration_ms(data);
            let mut messages = Vec::new();
            let call_text = if input.trim().is_empty() {
                pretty_json(data)
            } else {
                input
            };
            let (call_text, call_truncated) = clean_codex_transcript_text_with_truncation(
                call_text,
                CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
            );
            let title = clean_codex_title(opencode_tool_title(&tool, input_value), "Called tool");
            messages.push(CodexThreadTranscriptMessage {
                id: format!("opencode-{message_id}-{part_id}-tool-call"),
                role: "activity".to_string(),
                kind: "tool_call".to_string(),
                text: call_text,
                title: title.clone(),
                call_id: call_id.clone(),
                status: "running".to_string(),
                created_at: opencode_part_created_at(timestamp, data, false),
                source: "opencode".to_string(),
                tool: Some(transcript_tool_object(
                    &tool,
                    &call_id,
                    "running",
                    data.get("input").or_else(|| state.get("input")).cloned(),
                    None,
                    &title,
                )),
                usage: transcript_usage_from_value(data),
                truncated: call_truncated,
                artifacts: Vec::new(),
                ..Default::default()
            });
            let has_error = !error.trim().is_empty()
                || transcript_tool_value_has_error(data)
                || transcript_tool_value_has_error(state);
            let output_text = if has_error && !error.trim().is_empty() {
                error
            } else {
                output
            };
            if !output_text.trim().is_empty() {
                let (text, text_truncated) = clean_codex_transcript_text_with_truncation(
                    &output_text,
                    CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
                );
                let output_value = if has_error {
                    data.get("error").or_else(|| state.get("error"))
                } else {
                    data.get("output")
                        .or_else(|| data.get("result"))
                        .or_else(|| state.get("output"))
                        .or_else(|| state.get("result"))
                };
                let (tool_output, output_truncated) = transcript_tool_io_value(
                    output_value,
                    &output_text,
                    CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
                );
                let artifacts =
                    codex_image_artifacts_from_content(data, &output_text, "Tool output");
                let kind = if has_error {
                    "tool_output".to_string()
                } else {
                    codex_artifact_activity_kind(&output_text, &artifacts)
                };
                let title = if has_error {
                    "Tool error".to_string()
                } else {
                    codex_artifact_activity_title(&output_text, "Tool output", &artifacts)
                };
                messages.push(CodexThreadTranscriptMessage {
                    id: format!("opencode-{message_id}-{part_id}-tool-output"),
                    role: "activity".to_string(),
                    kind,
                    text,
                    title: title.clone(),
                    call_id: call_id.clone(),
                    status: if has_error { "error" } else { "completed" }.to_string(),
                    created_at: opencode_part_created_at(timestamp, data, true),
                    source: "opencode".to_string(),
                    tool: Some(transcript_tool_object(
                        &tool,
                        &call_id,
                        if has_error { "failed" } else { "completed" },
                        None,
                        tool_output.clone(),
                        &title,
                    )),
                    tool_output: (!has_error).then(|| tool_output.clone()).flatten(),
                    tool_error: has_error.then(|| tool_output.clone()).flatten(),
                    duration_ms,
                    usage: transcript_usage_from_value(data),
                    truncated: text_truncated || output_truncated,
                    artifacts,
                    ..Default::default()
                });
            }
            messages
        }
        "patch" => {
            let raw_text = pretty_json(data);
            let (text, truncated) = clean_codex_transcript_text_with_truncation(
                &raw_text,
                CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
            );
            vec![CodexThreadTranscriptMessage {
                id: format!("opencode-{message_id}-{part_id}-patch"),
                role: "activity".to_string(),
                kind: "patch".to_string(),
                text: text.clone(),
                title: "Patch".to_string(),
                call_id: String::new(),
                status: "completed".to_string(),
                created_at: timestamp.to_string(),
                source: "opencode".to_string(),
                file_change: transcript_file_change_from_value(data, &raw_text),
                usage: transcript_usage_from_value(data),
                truncated,
                artifacts: Vec::new(),
                ..Default::default()
            }]
        }
        "file" => {
            let text = pretty_json(data);
            let artifacts = codex_image_artifacts_from_content(data, &text, "File");
            let (text, truncated) =
                clean_codex_transcript_text_with_truncation(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
            vec![CodexThreadTranscriptMessage {
                id: format!("opencode-{message_id}-{part_id}-file"),
                role: "activity".to_string(),
                kind: "file".to_string(),
                text: text.clone(),
                title: "File".to_string(),
                call_id: String::new(),
                status: "completed".to_string(),
                created_at: timestamp.to_string(),
                source: "opencode".to_string(),
                file_change: transcript_file_change_from_value(data, &text),
                usage: transcript_usage_from_value(data),
                truncated,
                artifacts,
                ..Default::default()
            }]
        }
        "step-start" => {
            let text = first_value_string(&[data.get("summary"), data.get("description")]);
            let text = if text.trim().is_empty() {
                "Working".to_string()
            } else {
                text
            };
            let (text, truncated) =
                clean_codex_transcript_text_with_truncation(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
            vec![CodexThreadTranscriptMessage {
                id: format!("opencode-{message_id}-{part_id}-step-start"),
                role: "activity".to_string(),
                kind: "task_progress".to_string(),
                text,
                title: "Working".to_string(),
                call_id: String::new(),
                created_at: timestamp.to_string(),
                source: "opencode".to_string(),
                truncated,
                artifacts: Vec::new(),
                ..Default::default()
            }]
        }
        "step-finish" => {
            // OpenCode/AI-SDK records the finish reason on the step part as
            // `reason` (e.g. "stop", "tool-calls", "length"); some versions also
            // mirror it on the assistant message as `finish`. Normal finish
            // reasons are control metadata and must not render as assistant
            // messages; live hooks settle the turn state.
            // Classification runs ONLY on the structured finish-reason fields —
            // `summary` is free-form prose used for display text only, so a
            // summary like "cancelled the timer" must not be read as an
            // interrupt.
            let finish_reason = first_value_string(&[
                data.get("reason"),
                data.get("finish"),
                data.get("finishReason"),
            ]);
            let display_text = if finish_reason.trim().is_empty() {
                first_value_string(&[data.get("summary")])
            } else {
                finish_reason.clone()
            };
            let reason_key = finish_reason.to_lowercase();
            let reason_is_error = reason_key.contains("error") || reason_key.contains("fail");
            let reason_is_interrupted = reason_key.contains("abort")
                || reason_key.contains("cancel")
                || reason_key.contains("interrupt");
            if reason_is_error {
                vec![transcript_error_message(
                    format!("opencode-{message_id}-{part_id}-step-error"),
                    "opencode",
                    timestamp,
                    if display_text.trim().is_empty() {
                        "OpenCode turn failed"
                    } else {
                        display_text.as_str()
                    },
                )]
            } else if reason_is_interrupted {
                vec![transcript_error_message(
                    format!("opencode-{message_id}-{part_id}-step-interrupted"),
                    "opencode",
                    timestamp,
                    if display_text.trim().is_empty() {
                        "OpenCode turn interrupted"
                    } else {
                        display_text.as_str()
                    },
                )]
            } else {
                Vec::new()
            }
        }
        "snapshot" => vec![CodexThreadTranscriptMessage {
            id: format!("opencode-{message_id}-{part_id}-snapshot"),
            role: "activity".to_string(),
            kind: "activity".to_string(),
            text: clean_codex_transcript_text("Snapshot captured", CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
            title: "Snapshot".to_string(),
            call_id: String::new(),
            created_at: timestamp.to_string(),
            source: "opencode".to_string(),
            artifacts: Vec::new(),
            ..Default::default()
        }],
        _ => Vec::new(),
    }
}

fn opencode_message_role(data: &Value) -> String {
    let role = first_value_string(&[
        data.get("role"),
        data.get("type"),
        data.get("info").and_then(|info| info.get("role")),
    ]);
    if role == "assistant" {
        "assistant".to_string()
    } else {
        "user".to_string()
    }
}

fn find_opencode_session(
    provider_session_id: &str,
    _cwd: &str,
) -> Result<(String, String, String, String), String> {
    let db_path =
        opencode_db_path().ok_or_else(|| "Unable to locate OpenCode database.".to_string())?;
    let connection =
        rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| {
                format!(
                    "Unable to open OpenCode database {}: {error}",
                    db_path.display()
                )
            })?;
    let requested_session_id = clean_codex_id(provider_session_id);

    if !requested_session_id.is_empty() {
        let mut statement = connection
            .prepare("select id, title, directory, time_updated from session where id = ?1 limit 1")
            .map_err(|error| format!("Unable to query OpenCode sessions: {error}"))?;
        let mut rows = statement
            .query(rusqlite::params![requested_session_id])
            .map_err(|error| format!("Unable to query OpenCode session: {error}"))?;
        if let Some(row) = rows
            .next()
            .map_err(|error| format!("Unable to read OpenCode session row: {error}"))?
        {
            return Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, String>(1).unwrap_or_default(),
                row.get::<_, String>(2).unwrap_or_default(),
                "sessionId".to_string(),
            ));
        }
    }

    Err("No OpenCode session matched this thread session.".to_string())
}

fn resolve_opencode_resume_session(provider_session_id: &str, cwd: &str) -> Result<String, String> {
    let (session_id, _, session_cwd, _) = find_opencode_session(provider_session_id, cwd)?;
    let session_id = clean_codex_id(session_id);
    if session_id.trim().is_empty() {
        return Err("OpenCode session row has no resumable session id.".to_string());
    }
    if !cwd.trim().is_empty()
        && !session_cwd.trim().is_empty()
        && !agent_paths_match(&session_cwd, cwd)
    {
        return Err("OpenCode session belongs to a different workspace path.".to_string());
    }
    Ok(session_id)
}

fn discover_codex_session_by_prompt(
    expected_user_message: &str,
    cwd: &str,
    home_search_cwd: &str,
    allow_timestamp_fallback: bool,
    submitted_at: &str,
    _fallback_window_ms: u64,
    max_messages: usize,
) -> Result<CodexThreadTranscriptResult, String> {
    let search_cwd = if home_search_cwd.trim().is_empty() {
        cwd
    } else {
        home_search_cwd
    };
    let files = collect_codex_rollout_candidates(search_cwd)?;

    for path in files {
        let initial_meta = codex_rollout_meta(&path).unwrap_or_default();
        let Ok((parsed_meta, messages)) = parse_codex_rollout(&path, max_messages) else {
            continue;
        };
        let session_id = if parsed_meta.session_id.is_empty() {
            initial_meta.session_id
        } else {
            parsed_meta.session_id
        };
        if session_id.is_empty() {
            continue;
        }
        let session_cwd = if parsed_meta.cwd.is_empty() {
            initial_meta.cwd
        } else {
            parsed_meta.cwd
        };
        if !cwd.trim().is_empty() && !agent_paths_match(&session_cwd, cwd) {
            continue;
        }
        let exact_prompt_match = if submitted_at.trim().is_empty() {
            transcript_has_exact_user_prompt(&messages, expected_user_message)
        } else {
            transcript_has_exact_user_prompt_at_or_after(
                &messages,
                expected_user_message,
                submitted_at,
            )
        };
        let timestamp_recovery_match = allow_timestamp_fallback
            && !submitted_at.trim().is_empty()
            && transcript_has_user_prompt_at_or_after(&messages, submitted_at);
        if !exact_prompt_match && !timestamp_recovery_match {
            continue;
        }

        let latest_timestamp = if parsed_meta.latest_timestamp.is_empty() {
            initial_meta.latest_timestamp
        } else {
            parsed_meta.latest_timestamp
        };
        let session_title = first_non_empty_title(&[
            parsed_meta.title,
            initial_meta.title,
            codex_session_index_title(&session_id),
        ]);

        return Ok(CodexThreadTranscriptResult {
            session_id,
            session_title,
            rollout_path: path.to_string_lossy().to_string(),
            cwd: session_cwd,
            matched_by: if timestamp_recovery_match && !exact_prompt_match {
                "cwd+timestamp-recovery".to_string()
            } else if cwd.trim().is_empty() {
                "prompt".to_string()
            } else {
                "prompt+cwd".to_string()
            },
            latest_timestamp,
            messages,
        });
    }

    Err("No Codex session matched this prompt.".to_string())
}

fn discover_claude_session_by_prompt(
    expected_user_message: &str,
    cwd: &str,
    max_messages: usize,
) -> Result<CodexThreadTranscriptResult, String> {
    let files = collect_claude_candidate_files(cwd)?;

    for path in files {
        let Some(initial_meta) = claude_file_meta(&path) else {
            continue;
        };
        let Ok((parsed_meta, messages)) = parse_claude_session(&path, max_messages) else {
            continue;
        };
        let session_id = if parsed_meta.session_id.is_empty() {
            initial_meta.session_id
        } else {
            parsed_meta.session_id
        };
        if session_id.is_empty() {
            continue;
        }
        let session_cwd = if parsed_meta.cwd.is_empty() {
            initial_meta.cwd
        } else {
            parsed_meta.cwd
        };
        if !cwd.trim().is_empty() && !agent_paths_match(&session_cwd, cwd) {
            continue;
        }
        if !transcript_has_exact_user_prompt(&messages, expected_user_message) {
            continue;
        }
        let latest_timestamp = if parsed_meta.latest_timestamp.is_empty() {
            initial_meta.latest_timestamp
        } else {
            parsed_meta.latest_timestamp
        };

        return Ok(CodexThreadTranscriptResult {
            session_id,
            session_title: if parsed_meta.title.is_empty() {
                initial_meta.title
            } else {
                parsed_meta.title
            },
            rollout_path: path.to_string_lossy().to_string(),
            cwd: session_cwd,
            matched_by: if cwd.trim().is_empty() {
                "prompt".to_string()
            } else {
                "prompt+cwd".to_string()
            },
            latest_timestamp,
            messages,
        });
    }

    Err("No Claude Code session matched this prompt.".to_string())
}

fn discover_opencode_session_by_prompt(
    expected_user_message: &str,
    cwd: &str,
    max_messages: usize,
) -> Result<CodexThreadTranscriptResult, String> {
    let db_path =
        opencode_db_path().ok_or_else(|| "Unable to locate OpenCode database.".to_string())?;
    let connection =
        rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| {
                format!(
                    "Unable to open OpenCode database {}: {error}",
                    db_path.display()
                )
            })?;
    let mut statement = connection
        .prepare(
            "select id, title, directory, time_updated from session order by time_updated desc",
        )
        .map_err(|error| format!("Unable to query OpenCode sessions: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, String>(1).unwrap_or_default(),
                row.get::<_, String>(2).unwrap_or_default(),
            ))
        })
        .map_err(|error| format!("Unable to list OpenCode sessions: {error}"))?;

    for row in rows.flatten() {
        let session_id = row.0;
        let title = row.1;
        let session_cwd = row.2;
        if session_id.trim().is_empty() {
            continue;
        }
        if !cwd.trim().is_empty() && !agent_paths_match(&session_cwd, cwd) {
            continue;
        }
        let Ok((parsed_meta, messages)) =
            parse_opencode_session(&session_id, &title, &session_cwd, max_messages)
        else {
            continue;
        };
        if !transcript_has_exact_user_prompt(&messages, expected_user_message) {
            continue;
        }

        return Ok(CodexThreadTranscriptResult {
            session_id: parsed_meta.session_id,
            session_title: parsed_meta.title,
            rollout_path: db_path.to_string_lossy().to_string(),
            cwd: parsed_meta.cwd,
            matched_by: if cwd.trim().is_empty() {
                "prompt".to_string()
            } else {
                "prompt+cwd".to_string()
            },
            latest_timestamp: parsed_meta.latest_timestamp,
            messages,
        });
    }

    Err("No OpenCode session matched this prompt.".to_string())
}

fn parse_opencode_session(
    session_id: &str,
    _title: &str,
    cwd: &str,
    max_messages: usize,
) -> Result<(CodexRolloutMeta, Vec<CodexThreadTranscriptMessage>), String> {
    let db_path =
        opencode_db_path().ok_or_else(|| "Unable to locate OpenCode database.".to_string())?;
    let connection =
        rusqlite::Connection::open_with_flags(&db_path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| {
                format!(
                    "Unable to open OpenCode database {}: {error}",
                    db_path.display()
                )
            })?;

    let mut part_statement = connection
        .prepare(
            "select id, message_id, time_created, data from part where session_id = ?1 order by time_created, id",
        )
        .map_err(|error| format!("Unable to query OpenCode parts: {error}"))?;
    let part_rows = part_statement
        .query_map(rusqlite::params![session_id], |row| {
            Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, String>(1).unwrap_or_default(),
                row.get::<_, i64>(2).unwrap_or_default(),
                row.get::<_, String>(3).unwrap_or_default(),
            ))
        })
        .map_err(|error| format!("Unable to read OpenCode parts: {error}"))?;
    let mut parts_by_message: HashMap<String, Vec<(String, i64, Value)>> = HashMap::new();
    for row in part_rows.flatten() {
        let data = serde_json::from_str::<Value>(&row.3).unwrap_or(Value::Null);
        parts_by_message
            .entry(row.1)
            .or_default()
            .push((row.0, row.2, data));
    }

    let mut message_statement = connection
        .prepare(
            "select id, time_created, data from message where session_id = ?1 order by time_created, id",
        )
        .map_err(|error| format!("Unable to query OpenCode messages: {error}"))?;
    let message_rows = message_statement
        .query_map(rusqlite::params![session_id], |row| {
            Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, i64>(1).unwrap_or_default(),
                row.get::<_, String>(2).unwrap_or_default(),
            ))
        })
        .map_err(|error| format!("Unable to read OpenCode messages: {error}"))?;

    let mut messages = Vec::new();
    let mut seen = HashSet::new();
    let mut latest_timestamp = String::new();
    for row in message_rows.flatten() {
        let message_data = serde_json::from_str::<Value>(&row.2).unwrap_or(Value::Null);
        let role = opencode_message_role(&message_data);
        let timestamp = opencode_timestamp(row.1);
        if !timestamp.is_empty() {
            latest_timestamp = timestamp.clone();
        }

        let message_text = first_value_string(&[
            message_data.get("text"),
            message_data.get("content"),
            message_data.get("message"),
        ]);
        if !message_text.trim().is_empty() {
            let (message_text, truncated) = clean_codex_transcript_text_with_truncation(
                message_text,
                CODEX_TRANSCRIPT_MAX_TEXT,
            );
            push_codex_message(
                &mut messages,
                &mut seen,
                Some(CodexThreadTranscriptMessage {
                    id: format!("opencode-{}-message", row.0),
                    role: role.clone(),
                    kind: "message".to_string(),
                    text: message_text,
                    title: String::new(),
                    call_id: String::new(),
                    created_at: timestamp.clone(),
                    source: "opencode".to_string(),
                    usage: transcript_usage_from_value(&message_data),
                    truncated,
                    artifacts: Vec::new(),
                    ..Default::default()
                }),
            );
        }

        for (part_id, part_time, part_data) in parts_by_message.remove(&row.0).unwrap_or_default() {
            let part_timestamp = opencode_timestamp(part_time);
            for message in
                opencode_part_message(&row.0, &role, &part_id, &part_timestamp, &part_data)
            {
                push_codex_message(&mut messages, &mut seen, Some(message));
            }
        }
    }

    if messages.len() > max_messages {
        messages = messages[messages.len() - max_messages..].to_vec();
    }

    // OpenCode normally summarizes a session title itself, but a brand-new
    // session can be empty before it does. Fall back to the first user message
    // (Codex uses session_index.jsonl; Claude uses ai-title/summary).
    let title = clean_codex_title(_title, "");
    let title = if title.trim().is_empty() {
        messages
            .iter()
            .find(|message| message.role == "user" && !message.text.trim().is_empty())
            .map(|message| {
                let first_line = message.text.lines().next().unwrap_or_default();
                clean_codex_title(first_line.chars().take(80).collect::<String>(), "")
            })
            .unwrap_or_default()
    } else {
        title
    };

    Ok((
        CodexRolloutMeta {
            session_id: clean_codex_id(session_id),
            cwd: cwd.to_string(),
            latest_timestamp,
            title,
        },
        messages,
    ))
}

fn agent_thread_cloud_response_root(value: &Value) -> &Value {
    value
        .get("data")
        .filter(|data| data.is_object())
        .unwrap_or(value)
}

fn agent_thread_cloud_string_array(value: Option<&Value>) -> Vec<Value> {
    match value {
        Some(Value::Array(items)) => items.clone(),
        Some(Value::String(text)) => serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|parsed| parsed.as_array().cloned())
            .unwrap_or_default(),
        Some(Value::Object(object)) => object
            .get("messages")
            .or_else(|| object.get("items"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn agent_thread_cloud_record_messages(record: &Value) -> Vec<Value> {
    for key in ["messages", "messages_json"] {
        let messages = agent_thread_cloud_string_array(record.get(key));
        if !messages.is_empty() {
            return messages;
        }
    }
    Vec::new()
}

fn agent_thread_cloud_message_has_content(message: &CodexThreadTranscriptMessage) -> bool {
    !message.text.trim().is_empty()
        || !message.title.trim().is_empty()
        || !message.artifacts.is_empty()
        || message.tool.is_some()
        || message.file_change.is_some()
        || message.subagent.is_some()
        || message.usage.is_some()
        || message.kind.trim().eq_ignore_ascii_case("task_complete")
}

fn agent_thread_cloud_artifacts(value: &Value) -> Vec<CodexThreadTranscriptArtifact> {
    value
        .get("artifacts")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    serde_json::from_value::<CodexThreadTranscriptArtifact>(item.clone()).ok()
                })
                .collect()
        })
        .unwrap_or_default()
}

fn agent_thread_cloud_message_role(value: &Value, fallback_kind: &str) -> String {
    let role = cloud_mcp_payload_text(value, &["role"])
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if matches!(
        role.as_str(),
        "assistant" | "user" | "system" | "tool" | "activity"
    ) {
        return role;
    }
    let kind = fallback_kind.trim().to_ascii_lowercase();
    if kind.contains("terminal")
        || kind.contains("termio")
        || kind.contains("output")
        || kind.contains("stdout")
        || kind.contains("stderr")
        || kind.contains("log")
    {
        return "activity".to_string();
    }
    "activity".to_string()
}

fn agent_thread_cloud_message_from_value(
    value: &Value,
    agent_id: &str,
    fallback_timestamp: &str,
    fallback_id: String,
) -> Option<CodexThreadTranscriptMessage> {
    if let Ok(mut message) = serde_json::from_value::<CodexThreadTranscriptMessage>(value.clone()) {
        if message.id.trim().is_empty() {
            message.id = fallback_id.clone();
        }
        if message.role.trim().is_empty() {
            message.role = agent_thread_cloud_message_role(value, &message.kind);
        }
        if message.kind.trim().is_empty() {
            message.kind = "message".to_string();
        }
        if message.created_at.trim().is_empty() {
            message.created_at = fallback_timestamp.to_string();
        }
        if message.source.trim().is_empty() {
            message.source = agent_id.to_string();
        }
        if agent_thread_cloud_message_has_content(&message) {
            return Some(message);
        }
    }

    let kind =
        cloud_mcp_payload_text(value, &["kind", "type"]).unwrap_or_else(|| "message".to_string());
    let text = cloud_mcp_payload_text(value, &["text", "message", "content"]).unwrap_or_default();
    let title = cloud_mcp_payload_text(value, &["title"]).unwrap_or_default();
    let artifacts = agent_thread_cloud_artifacts(value);
    if text.trim().is_empty()
        && title.trim().is_empty()
        && artifacts.is_empty()
        && !kind.trim().eq_ignore_ascii_case("task_complete")
    {
        return None;
    }

    let role = agent_thread_cloud_message_role(value, &kind);
    Some(CodexThreadTranscriptMessage {
        id: cloud_mcp_payload_text(value, &["id", "message_id", "messageId"])
            .unwrap_or(fallback_id),
        role,
        kind,
        text,
        title,
        call_id: cloud_mcp_payload_text(value, &["call_id", "callId"]).unwrap_or_default(),
        created_at: cloud_mcp_payload_text(
            value,
            &["created_at", "createdAt", "timestamp", "time"],
        )
        .unwrap_or_else(|| fallback_timestamp.to_string()),
        source: cloud_mcp_payload_text(value, &["source"]).unwrap_or_else(|| agent_id.to_string()),
        tool: value.get("tool").cloned(),
        tool_output: value
            .get("tool_output")
            .or_else(|| value.get("toolOutput"))
            .cloned(),
        tool_error: value
            .get("tool_error")
            .or_else(|| value.get("toolError"))
            .cloned(),
        file_change: value
            .get("file_change")
            .or_else(|| value.get("fileChange"))
            .cloned(),
        duration_ms: first_value_i64(&[value.get("duration_ms"), value.get("durationMs")])
            .and_then(|value| (value >= 0).then_some(value as u64)),
        exit_code: first_value_i64(&[value.get("exit_code"), value.get("exitCode")]),
        subagent: value.get("subagent").cloned(),
        usage: value.get("usage").cloned(),
        truncated: cloud_mcp_payload_bool(value, &["truncated"], false),
        artifacts,
        ..Default::default()
    })
}

fn agent_thread_transcript_from_cloud_session_response(
    agent_id: &str,
    provider_session_id: &str,
    fallback_cwd: &str,
    max_messages: usize,
    response: &Value,
) -> Result<CodexThreadTranscriptResult, String> {
    let root = agent_thread_cloud_response_root(response);
    let session = root
        .get("session")
        .filter(|value| value.is_object())
        .ok_or_else(|| "Cloud session response did not include a session.".to_string())?;
    let cloud_session_id = cloud_mcp_payload_text(
        session,
        &["id", "agent_chat_session_id", "agentChatSessionId"],
    )
    .unwrap_or_default();
    let session_id = cloud_mcp_payload_text(
        session,
        &[
            "session_id",
            "provider_session_id",
            "sessionId",
            "providerSessionId",
        ],
    )
    .unwrap_or_else(|| provider_session_id.to_string());
    let mut latest_timestamp = cloud_mcp_payload_text(
        session,
        &[
            "latest_timestamp",
            "updated_at",
            "created_at",
            "latestTimestamp",
            "updatedAt",
            "createdAt",
        ],
    )
    .unwrap_or_default();
    let records = root
        .get("records")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut messages = Vec::new();
    for (record_index, record) in records.iter().enumerate() {
        let record_timestamp = cloud_mcp_payload_text(
            record,
            &[
                "record_timestamp",
                "latest_timestamp",
                "created_at",
                "recordTimestamp",
                "latestTimestamp",
                "createdAt",
            ],
        )
        .unwrap_or_else(|| latest_timestamp.clone());
        for (message_index, message) in agent_thread_cloud_record_messages(record)
            .iter()
            .enumerate()
        {
            let fallback_id = format!("cloud-{record_index}-{message_index}");
            if let Some(message) = agent_thread_cloud_message_from_value(
                message,
                agent_id,
                &record_timestamp,
                fallback_id,
            ) {
                messages.push(message);
            }
        }
    }
    if messages.len() > max_messages {
        messages.drain(0..messages.len() - max_messages);
    }
    if latest_timestamp.trim().is_empty() {
        latest_timestamp = messages
            .last()
            .map(|message| message.created_at.clone())
            .unwrap_or_default();
    }

    Ok(CodexThreadTranscriptResult {
        session_id,
        session_title: cloud_mcp_payload_text(session, &["title", "session_title", "sessionTitle"])
            .unwrap_or_default(),
        rollout_path: if cloud_session_id.trim().is_empty() {
            format!("cloud://agent-chat-session/{provider_session_id}")
        } else {
            format!("cloud://agent-chat-session/{cloud_session_id}")
        },
        cwd: cloud_mcp_payload_text(session, &["cwd", "working_directory", "workingDirectory"])
            .unwrap_or_else(|| fallback_cwd.to_string()),
        matched_by: "sessionId".to_string(),
        latest_timestamp,
        messages,
    })
}

fn agent_thread_cloud_session_matches_provider_session(
    session: &Value,
    provider_session_id: &str,
) -> bool {
    let expected = provider_session_id.trim();
    if expected.is_empty() {
        return false;
    }
    cloud_mcp_payload_text(
        session,
        &[
            "session_id",
            "provider_session_id",
            "sessionId",
            "providerSessionId",
        ],
    )
    .map(|value| value.trim() == expected)
    .unwrap_or(false)
}

fn read_agent_thread_cloud_transcript(
    agent_id: &str,
    provider_session_id: &str,
    cwd: &str,
    workspace_id: Option<&str>,
    max_messages: usize,
) -> Result<CodexThreadTranscriptResult, String> {
    let provider_session_id = provider_session_id.trim();
    if provider_session_id.is_empty() {
        return Err("Provider session id is required to read a cloud transcript.".to_string());
    }

    let mut list_query = vec![
        ("limit", "5".to_string()),
        ("provider", agent_id.to_string()),
        ("provider_session_id", provider_session_id.to_string()),
    ];
    if let Some(workspace_id) = workspace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        list_query.push(("workspace_id", workspace_id.to_string()));
    }
    let list_response =
        cloud_mcp_internal_api_get_blocking("/v1/internal/api/sessions", &list_query)?;
    let list_root = agent_thread_cloud_response_root(&list_response);
    let sessions = list_root
        .get("sessions")
        .and_then(Value::as_array)
        .ok_or_else(|| "Cloud session list response did not include sessions.".to_string())?;
    let session = sessions
        .iter()
        .find(|session| {
            agent_thread_cloud_session_matches_provider_session(session, provider_session_id)
        })
        .or_else(|| sessions.first())
        .ok_or_else(|| "Cloud did not return a synced session for this provider id.".to_string())?;
    let cloud_session_id = cloud_mcp_payload_text(
        session,
        &["id", "agent_chat_session_id", "agentChatSessionId"],
    )
    .ok_or_else(|| "Cloud session list row did not include a session id.".to_string())?;

    let mut detail_query = vec![
        ("limit", "2000".to_string()),
        ("record_limit", "2000".to_string()),
        ("record_direction", "latest".to_string()),
    ];
    if let Some(workspace_id) = workspace_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        detail_query.push(("workspace_id", workspace_id.to_string()));
    }
    let detail_path = format!("/v1/internal/api/sessions/{cloud_session_id}");
    let detail_response = cloud_mcp_internal_api_get_blocking(&detail_path, &detail_query)?;
    agent_thread_transcript_from_cloud_session_response(
        agent_id,
        provider_session_id,
        cwd,
        max_messages,
        &detail_response,
    )
}

fn agent_thread_transcript_result_is_cloud_backed(result: &CodexThreadTranscriptResult) -> bool {
    result.rollout_path.trim_start().starts_with("cloud://")
}

fn read_agent_thread_transcript(
    agent_id: &str,
    provider_session_id: &str,
    cwd: &str,
    workspace_id: Option<&str>,
    max_messages: usize,
) -> Result<CodexThreadTranscriptResult, String> {
    if provider_session_id.trim().is_empty() {
        return Err("Provider session id is required to read an agent transcript.".to_string());
    }

    if agent_id == "claude" {
        let local_result: Result<CodexThreadTranscriptResult, String> = (|| {
            let (path, initial_meta, matched_by) = find_claude_session(provider_session_id, cwd)?;
            let (parsed_meta, mut messages) = parse_claude_session(&path, max_messages)?;
            let session_id = if parsed_meta.session_id.is_empty() {
                initial_meta.session_id
            } else {
                parsed_meta.session_id
            };
            let cwd = if parsed_meta.cwd.is_empty() {
                initial_meta.cwd
            } else {
                parsed_meta.cwd
            };
            let latest_timestamp = if parsed_meta.latest_timestamp.is_empty() {
                initial_meta.latest_timestamp
            } else {
                parsed_meta.latest_timestamp
            };

            promote_generated_image_artifacts(&mut messages, &cwd, workspace_id);
            Ok(CodexThreadTranscriptResult {
                session_id,
                session_title: if parsed_meta.title.is_empty() {
                    initial_meta.title
                } else {
                    parsed_meta.title
                },
                rollout_path: path.to_string_lossy().to_string(),
                cwd,
                matched_by,
                latest_timestamp,
                messages,
            })
        })();
        return local_result.or_else(|local_error| {
            read_agent_thread_cloud_transcript(
                agent_id,
                provider_session_id,
                cwd,
                workspace_id,
                max_messages,
            )
            .map_err(|cloud_error| format!("{local_error}; cloud fallback failed: {cloud_error}"))
        });
    }

    if agent_id == "opencode" {
        let local_result: Result<CodexThreadTranscriptResult, String> = (|| {
            let (session_id, title, session_cwd, matched_by) =
                find_opencode_session(provider_session_id, cwd)?;
            let (parsed_meta, mut messages) =
                parse_opencode_session(&session_id, &title, &session_cwd, max_messages)?;
            promote_generated_image_artifacts(&mut messages, &parsed_meta.cwd, workspace_id);
            Ok(CodexThreadTranscriptResult {
                session_id: parsed_meta.session_id,
                session_title: parsed_meta.title,
                rollout_path: opencode_db_path()
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or_default(),
                cwd: parsed_meta.cwd,
                matched_by,
                latest_timestamp: parsed_meta.latest_timestamp,
                messages,
            })
        })();
        return local_result.or_else(|local_error| {
            read_agent_thread_cloud_transcript(
                agent_id,
                provider_session_id,
                cwd,
                workspace_id,
                max_messages,
            )
            .map_err(|cloud_error| format!("{local_error}; cloud fallback failed: {cloud_error}"))
        });
    }

    let local_result: Result<CodexThreadTranscriptResult, String> = (|| {
        let (path, initial_meta, matched_by) = find_codex_rollout(provider_session_id, cwd)?;
        let (parsed_meta, mut messages) = parse_codex_rollout(&path, max_messages)?;
        let session_id = if parsed_meta.session_id.is_empty() {
            initial_meta.session_id
        } else {
            parsed_meta.session_id
        };
        let cwd = if parsed_meta.cwd.is_empty() {
            initial_meta.cwd
        } else {
            parsed_meta.cwd
        };
        let latest_timestamp = if parsed_meta.latest_timestamp.is_empty() {
            initial_meta.latest_timestamp
        } else {
            parsed_meta.latest_timestamp
        };
        let session_title = first_non_empty_title(&[
            parsed_meta.title,
            initial_meta.title,
            codex_session_index_title(&session_id),
        ]);
        promote_generated_image_artifacts(&mut messages, &cwd, workspace_id);

        Ok(CodexThreadTranscriptResult {
            session_id,
            session_title,
            rollout_path: path.to_string_lossy().to_string(),
            cwd,
            matched_by,
            latest_timestamp,
            messages,
        })
    })();
    local_result.or_else(|local_error| {
        read_agent_thread_cloud_transcript(
            agent_id,
            provider_session_id,
            cwd,
            workspace_id,
            max_messages,
        )
        .map_err(|cloud_error| format!("{local_error}; cloud fallback failed: {cloud_error}"))
    })
}

/// Return durable, local evidence that a provider session is a real
/// conversation. This intentionally scans the complete native source instead
/// of the UI transcript tail and never falls back to cloud/network I/O.
fn agent_thread_local_first_user_message(
    agent_id: &str,
    provider_session_id: &str,
    cwd: &str,
) -> Result<Option<String>, String> {
    let messages = if agent_id == "claude" {
        let (path, _, _) = find_claude_session(provider_session_id, cwd)?;
        parse_claude_session(&path, usize::MAX)?.1
    } else if agent_id == "opencode" {
        let (session_id, title, session_cwd, _) =
            find_opencode_session(provider_session_id, cwd)?;
        parse_opencode_session(&session_id, &title, &session_cwd, usize::MAX)?.1
    } else {
        let (path, _, _) = find_codex_rollout(provider_session_id, cwd)?;
        parse_codex_rollout(&path, usize::MAX)?.1
    };
    Ok(messages
        .into_iter()
        .find(|message| {
            message.role.eq_ignore_ascii_case("user") && !message.text.trim().is_empty()
        })
        .map(|message| message.text))
}

fn agent_thread_transcript_signature(result: &CodexThreadTranscriptResult) -> String {
    let tail = result.messages.last();
    format!(
        "{}|{}|{}|{}|{}|{}",
        result.session_id,
        result.latest_timestamp,
        result.messages.len(),
        tail.map(|message| message.id.as_str()).unwrap_or_default(),
        tail.map(|message| message.kind.as_str())
            .unwrap_or_default(),
        tail.map(|message| message.text.len()).unwrap_or_default(),
    )
}

fn agent_thread_transcript_direct_message_value(message: &CodexThreadTranscriptMessage) -> Value {
    let mut value = serde_json::to_value(message).unwrap_or_else(|_| json!({}));
    let legacy_kind =
        cloud_mcp_payload_text(&value, &["legacy_kind"]).filter(|value| !value.trim().is_empty());
    if let Some(legacy_kind) = legacy_kind {
        let canonical_kind = cloud_mcp_payload_text(&value, &["kind"]).unwrap_or_default();
        if let Some(object) = value.as_object_mut() {
            object.insert("canonical_kind".to_string(), json!(canonical_kind));
            object.insert("kind".to_string(), json!(legacy_kind));
        }
    }
    value
}

fn agent_thread_transcript_direct_result_value(result: &CodexThreadTranscriptResult) -> Value {
    let mut value = serde_json::to_value(result).unwrap_or_else(|_| json!({}));
    if let Some(object) = value.as_object_mut() {
        object.insert(
            "messages".to_string(),
            Value::Array(
                result
                    .messages
                    .iter()
                    .map(agent_thread_transcript_direct_message_value)
                    .collect(),
            ),
        );
    }
    value
}

fn agent_thread_transcript_watch_context(
    request: &AgentThreadTranscriptWatchRequest,
) -> AgentThreadTranscriptWatchContext {
    AgentThreadTranscriptWatchContext {
        agent_id: clean_codex_id(
            request
                .agent_id
                .clone()
                .unwrap_or_else(|| "codex".to_string()),
        )
        .to_lowercase(),
        allow_timestamp_fallback: request.allow_timestamp_fallback.unwrap_or(false),
        cwd: request.cwd.clone().unwrap_or_default(),
        expected_message_created_at: request
            .expected_message_created_at
            .clone()
            .unwrap_or_default(),
        expected_user_message: request.expected_user_message.clone().unwrap_or_default(),
        instance_id: request.instance_id,
        max_messages: request
            .max_messages
            .unwrap_or(CODEX_TRANSCRIPT_DEFAULT_LIMIT)
            .clamp(1, CODEX_TRANSCRIPT_MAX_LIMIT),
        pane_id: request.pane_id.clone().unwrap_or_default(),
        poll_until_turn_complete: request.poll_until_turn_complete.unwrap_or(false),
        prompt_event_id: request.prompt_event_id.clone().unwrap_or_default(),
        prompt_event_submitted_at: request
            .prompt_event_submitted_at
            .clone()
            .unwrap_or_default(),
        provider_session_id: clean_codex_id(
            request.provider_session_id.clone().unwrap_or_default(),
        ),
        source: request.source.clone().unwrap_or_default(),
        submitted_at: request.submitted_at.clone().unwrap_or_default(),
        terminal_index: request.terminal_index,
        terminal_prompt_accepted: request.terminal_prompt_accepted.unwrap_or(false),
        thread_id: request.thread_id.clone().unwrap_or_default(),
        workspace_id: request.workspace_id.clone().unwrap_or_default(),
    }
}

fn agent_thread_transcript_watch_key(
    context: &AgentThreadTranscriptWatchContext,
    watch_path: &Path,
) -> String {
    let path_key = watch_path
        .canonicalize()
        .unwrap_or_else(|_| watch_path.to_path_buf())
        .to_string_lossy()
        .replace('\\', "/");
    format!(
        "{}|{}|{}|{}|{}",
        context.workspace_id,
        context.thread_id,
        context.agent_id,
        context.provider_session_id,
        path_key,
    )
}

fn agent_thread_transcript_webview_watch_owner_key() -> String {
    "webview".to_string()
}

fn agent_thread_transcript_native_watch_owner_key(
    pane_id: &str,
    instance_id: Option<u64>,
) -> String {
    format!(
        "terminal:{}:{}",
        pane_id.trim(),
        instance_id
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".to_string())
    )
}

fn agent_thread_transcript_native_watch_context(
    request: &AgentThreadTranscriptNativeWatchRequest,
) -> AgentThreadTranscriptWatchContext {
    AgentThreadTranscriptWatchContext {
        agent_id: clean_codex_id(&request.agent_id).to_lowercase(),
        allow_timestamp_fallback: false,
        cwd: request.cwd.clone(),
        expected_message_created_at: String::new(),
        expected_user_message: String::new(),
        instance_id: request.instance_id,
        max_messages: CODEX_TRANSCRIPT_DEFAULT_LIMIT,
        pane_id: request.pane_id.clone(),
        poll_until_turn_complete: false,
        prompt_event_id: String::new(),
        prompt_event_submitted_at: String::new(),
        provider_session_id: clean_codex_id(&request.provider_session_id),
        source: request.source.clone(),
        submitted_at: String::new(),
        terminal_index: request.terminal_index,
        terminal_prompt_accepted: false,
        thread_id: request.thread_id.clone(),
        workspace_id: request.workspace_id.clone(),
    }
}

fn agent_thread_transcript_native_watch_path(
    agent_id: &str,
    provider_session_id: &str,
    transcript_path: Option<&str>,
) -> Option<PathBuf> {
    if let Some(path) = transcript_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(PathBuf::from(path));
    }
    match clean_codex_id(agent_id).to_lowercase().as_str() {
        "claude" => claude_session_transcript_path(provider_session_id),
        "opencode" => opencode_db_path(),
        _ => codex_session_transcript_path(provider_session_id),
    }
}

fn agent_thread_transcript_watch_entry_replace_context(
    owners: &HashSet<String>,
    owner_key: &str,
) -> bool {
    owner_key == agent_thread_transcript_webview_watch_owner_key()
        || !owners.contains(&agent_thread_transcript_webview_watch_owner_key())
}

fn trim_agent_thread_transcript_native_owner_from_other_watches(
    watches: &mut HashMap<String, AgentThreadTranscriptWatchEntry>,
    owner_key: &str,
    keep_key: &str,
) {
    if !owner_key.starts_with("terminal:") {
        return;
    }
    watches.retain(|key, entry| {
        if key != keep_key {
            entry.owners.remove(owner_key);
        }
        !entry.owners.is_empty()
    });
}

fn agent_thread_transcript_watch_target(agent_id: &str, watch_path: &Path) -> PathBuf {
    // Harnesses commonly update their transcript with an atomic rename. A
    // watcher attached to the file follows the old inode and silently misses
    // every record after replacement. Watch the containing directory and
    // retain exact-path filtering in `agent_thread_transcript_watch_event_matches`.
    if watch_path.is_file() || !watch_path.exists() || agent_id == "opencode" {
        return watch_path
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| watch_path.to_path_buf());
    }
    watch_path.to_path_buf()
}

fn agent_thread_transcript_watch_event_matches(watch_path: &Path, paths: &[PathBuf]) -> bool {
    if paths.is_empty() {
        return true;
    }
    let watch_name = watch_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let watch_parent = watch_path.parent();
    paths.iter().any(|path| {
        path == watch_path
            || path.starts_with(watch_path)
            || watch_parent.is_some_and(|parent| path == parent)
            || (!watch_name.is_empty()
                && path
                    .file_name()
                    .map(|value| value.to_string_lossy().starts_with(&watch_name))
                    .unwrap_or(false))
    })
}

fn trim_agent_thread_transcript_watches(
    watches: &mut HashMap<String, AgentThreadTranscriptWatchEntry>,
) {
    while watches.len() > AGENT_THREAD_TRANSCRIPT_MAX_WATCHES {
        let Some(oldest_key) = watches
            .iter()
            .min_by_key(|(_, entry)| entry.touched_ms)
            .map(|(key, _)| key.clone())
        else {
            break;
        };
        watches.remove(&oldest_key);
    }
}

async fn emit_agent_thread_transcript_watch_update(
    app: AppHandle,
    key: String,
    reason: &'static str,
) {
    let context = {
        let watches = AGENT_THREAD_TRANSCRIPT_WATCHES.get_or_init(|| StdMutex::new(HashMap::new()));
        watches
            .lock()
            .ok()
            .and_then(|entries| entries.get(&key).map(|entry| entry.context.clone()))
            .and_then(|context| context.lock().ok().map(|context| context.clone()))
    };
    let Some(context) = context else {
        return;
    };

    let read_context = context.clone();
    let read_result = tauri::async_runtime::spawn_blocking(move || {
        read_agent_thread_transcript(
            &read_context.agent_id,
            &read_context.provider_session_id,
            &read_context.cwd,
            Some(read_context.workspace_id.as_str()).filter(|value| !value.trim().is_empty()),
            read_context.max_messages,
        )
    })
    .await
    .ok()
    .and_then(Result::ok);

    let Some(result) = read_result else {
        return;
    };
    emit_promoted_generated_asset_event(
        &app,
        &result,
        Some(context.workspace_id.as_str()).filter(|value| !value.trim().is_empty()),
        "transcript-watch",
    );

    let signature = agent_thread_transcript_signature(&result);
    let should_emit = {
        let watches = AGENT_THREAD_TRANSCRIPT_WATCHES.get_or_init(|| StdMutex::new(HashMap::new()));
        let Ok(mut entries) = watches.lock() else {
            return;
        };
        let Some(entry) = entries.get_mut(&key) else {
            return;
        };
        entry.touched_ms = current_time_ms();
        if entry.last_signature == signature {
            false
        } else {
            entry.last_signature = signature;
            true
        }
    };
    let observed = agent_chat_session_terminal_is_observed(&context);
    let final_flush = reason == "terminal-activity-final";
    let should_sync_durable = observed || final_flush;
    if !should_emit && !should_sync_durable {
        return;
    }

    if should_emit {
        let _ = app.emit(
            AGENT_THREAD_TRANSCRIPT_UPDATED_EVENT,
            json!({
            "agent_id": context.agent_id,
            "allow_timestamp_fallback": context.allow_timestamp_fallback,
            "cwd": context.cwd,
            "expected_message_created_at": context.expected_message_created_at,
            "expected_user_message": context.expected_user_message,
            "instance_id": context.instance_id,
            "pane_id": context.pane_id,
            "poll_until_turn_complete": context.poll_until_turn_complete,
            "prompt_event_id": context.prompt_event_id,
            "prompt_event_submitted_at": context.prompt_event_submitted_at,
            "provider_session_id": context.provider_session_id,
            "reason": reason,
            "request_source": context.source,
            "result": agent_thread_transcript_direct_result_value(&result),
            "source": "agent-transcript-watch",
            "submitted_at": context.submitted_at,
            "terminal_index": context.terminal_index,
            "terminal_prompt_accepted": context.terminal_prompt_accepted,
            "thread_id": context.thread_id,
            "workspace_id": context.workspace_id,
            }),
        );
    }
    if should_sync_durable && !agent_thread_transcript_result_is_cloud_backed(&result) {
        log_terminal_status_event(
            "backend.agent_chat_session_sync.transcript_flush",
            json!({
                "instance_id": context.instance_id,
                "observed": observed,
                "pane_id": context.pane_id,
                "reason": reason,
                "workspace_id": context.workspace_id,
            }),
        );
        agent_chat_session_sync_spawn_from_result(
            app,
            &context.agent_id,
            &result,
            agent_chat_session_sync_context_from_watch(&context),
            "transcript_watch_update",
        );
    } else if should_emit && !agent_thread_transcript_result_is_cloud_backed(&result) {
        log_terminal_status_event(
            "backend.agent_chat_session_sync.transcript_flush_deferred",
            json!({
                "instance_id": context.instance_id,
                "pane_id": context.pane_id,
                "reason": reason,
                "workspace_id": context.workspace_id,
            }),
        );
    }
}

async fn agent_thread_transcript_watch_debounce_worker(
    app: AppHandle,
    key: String,
    debounce: Arc<AgentThreadTranscriptWatchDebounce>,
    mut observed_generation: u64,
) {
    loop {
        let window_started = Instant::now();
        loop {
            let elapsed = window_started.elapsed();
            if elapsed >= Duration::from_millis(AGENT_THREAD_TRANSCRIPT_WATCH_MAX_WAIT_MS) {
                observed_generation = debounce.generation.load(Ordering::SeqCst);
                break;
            }
            let remaining =
                Duration::from_millis(AGENT_THREAD_TRANSCRIPT_WATCH_MAX_WAIT_MS) - elapsed;
            let delay =
                if remaining < Duration::from_millis(AGENT_THREAD_TRANSCRIPT_WATCH_DEBOUNCE_MS) {
                    remaining
                } else {
                    Duration::from_millis(AGENT_THREAD_TRANSCRIPT_WATCH_DEBOUNCE_MS)
                };
            sleep(delay).await;
            let latest_generation = debounce.generation.load(Ordering::SeqCst);
            if latest_generation == observed_generation
                || window_started.elapsed()
                    >= Duration::from_millis(AGENT_THREAD_TRANSCRIPT_WATCH_MAX_WAIT_MS)
            {
                observed_generation = latest_generation;
                break;
            }
            observed_generation = latest_generation;
        }

        emit_agent_thread_transcript_watch_update(app.clone(), key.clone(), "file-change").await;
        let latest_generation = debounce.generation.load(Ordering::SeqCst);
        if latest_generation != observed_generation {
            observed_generation = latest_generation;
            continue;
        }
        debounce.scheduled.store(false, Ordering::SeqCst);
        let next_generation = debounce.generation.load(Ordering::SeqCst);
        if next_generation == latest_generation || debounce.scheduled.swap(true, Ordering::SeqCst) {
            break;
        }
        observed_generation = next_generation;
    }
}

fn agent_thread_transcript_note_watch_event(
    app: AppHandle,
    key: String,
    debounce: Arc<AgentThreadTranscriptWatchDebounce>,
) {
    let generation = debounce
        .generation
        .fetch_add(1, Ordering::SeqCst)
        .wrapping_add(1);
    if debounce.scheduled.swap(true, Ordering::SeqCst) {
        return;
    }
    tauri::async_runtime::spawn(agent_thread_transcript_watch_debounce_worker(
        app, key, debounce, generation,
    ));
}

fn register_agent_thread_transcript_watch_internal(
    app: &AppHandle,
    context: AgentThreadTranscriptWatchContext,
    watch_path: PathBuf,
    initial_signature: String,
    owner_key: String,
) -> Result<(), String> {
    if context.provider_session_id.trim().is_empty() {
        return Ok(());
    }
    let key = agent_thread_transcript_watch_key(&context, &watch_path);
    let watches = AGENT_THREAD_TRANSCRIPT_WATCHES.get_or_init(|| StdMutex::new(HashMap::new()));
    if let Ok(mut entries) = watches.lock() {
        trim_agent_thread_transcript_native_owner_from_other_watches(
            &mut entries,
            &owner_key,
            &key,
        );
        if let Some(entry) = entries.get_mut(&key) {
            if agent_thread_transcript_watch_entry_replace_context(&entry.owners, &owner_key) {
                if let Ok(mut existing_context) = entry.context.lock() {
                    *existing_context = context;
                }
            }
            if !initial_signature.is_empty() {
                entry.last_signature = initial_signature;
            }
            entry.owners.insert(owner_key);
            entry.touched_ms = current_time_ms();
            return Ok(());
        }
    }

    let app_for_watch = app.clone();
    let key_for_watch = key.clone();
    let watch_path_for_filter = watch_path.clone();
    let debounce = Arc::new(AgentThreadTranscriptWatchDebounce {
        generation: AtomicU64::new(0),
        scheduled: AtomicBool::new(false),
    });
    let debounce_for_watch = debounce.clone();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<notify::Event>| {
        let Ok(event) = event else {
            return;
        };
        match event.kind {
            notify::event::EventKind::Any
            | notify::event::EventKind::Create(_)
            | notify::event::EventKind::Modify(_) => {}
            _ => return,
        }
        if !agent_thread_transcript_watch_event_matches(&watch_path_for_filter, &event.paths) {
            return;
        }
        agent_thread_transcript_note_watch_event(
            app_for_watch.clone(),
            key_for_watch.clone(),
            debounce_for_watch.clone(),
        );
    })
    .map_err(|error| format!("Unable to create transcript watcher: {error}"))?;
    let watch_target = agent_thread_transcript_watch_target(&context.agent_id, &watch_path);
    if !watch_path.exists() && !watch_target.exists() {
        return Ok(());
    }
    watcher
        .watch(&watch_target, notify::RecursiveMode::NonRecursive)
        .map_err(|error| {
            format!(
                "Unable to watch transcript path {}: {error}",
                watch_target.display()
            )
        })?;

    let entry = AgentThreadTranscriptWatchEntry {
        context: Arc::new(StdMutex::new(context)),
        last_signature: initial_signature,
        owners: HashSet::from([owner_key]),
        touched_ms: current_time_ms(),
        _watcher: watcher,
    };
    if let Ok(mut entries) = watches.lock() {
        entries.insert(key, entry);
        trim_agent_thread_transcript_watches(&mut entries);
    }
    Ok(())
}

fn register_agent_thread_transcript_watch(
    app: &AppHandle,
    request: &AgentThreadTranscriptWatchRequest,
    result: &CodexThreadTranscriptResult,
) -> Result<(), String> {
    if agent_thread_transcript_result_is_cloud_backed(result) {
        return Ok(());
    }
    let mut context = agent_thread_transcript_watch_context(request);
    if context.provider_session_id.trim().is_empty() {
        context.provider_session_id = result.session_id.clone();
    }
    if context.cwd.trim().is_empty() {
        context.cwd = result.cwd.clone();
    }
    if result.rollout_path.trim().is_empty() {
        return Ok(());
    }
    register_agent_thread_transcript_watch_internal(
        app,
        context,
        PathBuf::from(result.rollout_path.trim()),
        agent_thread_transcript_signature(result),
        agent_thread_transcript_webview_watch_owner_key(),
    )
}

fn register_agent_thread_transcript_native_watch(
    app: &AppHandle,
    request: &AgentThreadTranscriptNativeWatchRequest,
) -> Result<(), String> {
    let context = agent_thread_transcript_native_watch_context(request);
    if context.provider_session_id.trim().is_empty() {
        return Ok(());
    }
    let Some(watch_path) = agent_thread_transcript_native_watch_path(
        &context.agent_id,
        &context.provider_session_id,
        request.transcript_path.as_deref(),
    ) else {
        return Ok(());
    };
    let watch_key = agent_thread_transcript_watch_key(&context, &watch_path);
    register_agent_thread_transcript_watch_internal(
        app,
        context,
        watch_path,
        String::new(),
        agent_thread_transcript_native_watch_owner_key(&request.pane_id, request.instance_id),
    )?;

    // Discovery can bind after the first response is already present. A file
    // watcher only observes future writes, so immediately seed session history
    // from the transcript that exists at bind time.
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        emit_agent_thread_transcript_watch_update(app, watch_key, "native-watch-initial").await;
    });
    Ok(())
}

fn unregister_agent_thread_transcript_native_watch(pane_id: &str, instance_id: Option<u64>) {
    let owner_key = agent_thread_transcript_native_watch_owner_key(pane_id, instance_id);
    let Some(watches) = AGENT_THREAD_TRANSCRIPT_WATCHES.get() else {
        return;
    };
    let Ok(mut entries) = watches.lock() else {
        return;
    };
    entries.retain(|_, entry| {
        entry.owners.remove(&owner_key);
        !entry.owners.is_empty()
    });
}

fn trigger_agent_thread_transcript_native_watch(
    app: &AppHandle,
    pane_id: &str,
    instance_id: Option<u64>,
    reason: &'static str,
) -> usize {
    let owner_key = agent_thread_transcript_native_watch_owner_key(pane_id, instance_id);
    let Some(watches) = AGENT_THREAD_TRANSCRIPT_WATCHES.get() else {
        return 0;
    };
    let watch_keys = watches
        .lock()
        .ok()
        .map(|entries| {
            entries
                .iter()
                .filter(|(_, entry)| entry.owners.contains(&owner_key))
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    for watch_key in &watch_keys {
        let app = app.clone();
        let watch_key = watch_key.clone();
        tauri::async_runtime::spawn(async move {
            emit_agent_thread_transcript_watch_update(app.clone(), watch_key.clone(), reason).await;
            // Some harnesses emit their completion hook just before the final
            // atomic transcript replace. Short signature-deduped retries cover
            // that write without returning to periodic history polling.
            sleep(Duration::from_millis(250)).await;
            emit_agent_thread_transcript_watch_update(app.clone(), watch_key.clone(), reason).await;
            sleep(Duration::from_millis(750)).await;
            emit_agent_thread_transcript_watch_update(app, watch_key, reason).await;
        });
    }
    watch_keys.len()
}

#[tauri::command(rename_all = "snake_case")]
async fn agent_thread_session_discover(
    app: AppHandle,
    request: CodexThreadSessionDiscoverRequest,
) -> Result<CodexThreadTranscriptResult, String> {
    let agent_id =
        clean_codex_id(request.agent_id.unwrap_or_else(|| "codex".to_string())).to_lowercase();
    let expected_user_message = request.expected_user_message.unwrap_or_default();
    let allow_timestamp_fallback = request.allow_timestamp_fallback.unwrap_or(false);
    let submitted_at = request.submitted_at.unwrap_or_default();
    let fallback_window_ms = request.fallback_window_ms.unwrap_or(90_000);
    if normalize_prompt_match_text(&expected_user_message).is_empty()
        && !(allow_timestamp_fallback && !submitted_at.trim().is_empty())
    {
        return Err("Expected user message is required to discover an agent session.".to_string());
    }

    let cwd = request.cwd.unwrap_or_default();
    let home_search_cwd = request.home_search_cwd.unwrap_or_else(|| cwd.clone());
    let max_messages = request
        .max_messages
        .unwrap_or(CODEX_TRANSCRIPT_DEFAULT_LIMIT)
        .clamp(1, CODEX_TRANSCRIPT_MAX_LIMIT);
    let workspace_id = request.workspace_id.unwrap_or_default();
    let workspace_id = Some(workspace_id.as_str()).filter(|value| !value.trim().is_empty());

    let mut result = if agent_id == "claude" {
        discover_claude_session_by_prompt(&expected_user_message, &cwd, max_messages)
    } else if agent_id == "opencode" {
        discover_opencode_session_by_prompt(&expected_user_message, &cwd, max_messages)
    } else {
        discover_codex_session_by_prompt(
            &expected_user_message,
            &cwd,
            &home_search_cwd,
            allow_timestamp_fallback,
            &submitted_at,
            fallback_window_ms,
            max_messages,
        )
    }?;
    promote_result_generated_image_artifacts(&mut result, workspace_id);
    emit_promoted_generated_asset_event(&app, &result, workspace_id, "session-discover");
    if !agent_thread_transcript_result_is_cloud_backed(&result) {
        agent_chat_session_sync_spawn_from_result(
            app,
            &agent_id,
            &result,
            AgentChatSessionSyncContext {
                workspace_id: workspace_id.unwrap_or_default().to_string(),
                source: "session-discover".to_string(),
                ..AgentChatSessionSyncContext::default()
            },
            "session_discover",
        );
    }
    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
async fn agent_thread_transcript(
    app: AppHandle,
    request: CodexThreadTranscriptRequest,
) -> Result<CodexThreadTranscriptResult, String> {
    let agent_id =
        clean_codex_id(request.agent_id.unwrap_or_else(|| "codex".to_string())).to_lowercase();
    let provider_session_id = clean_codex_id(request.provider_session_id.unwrap_or_default());
    let cwd = request.cwd.unwrap_or_default();
    let max_messages = request
        .max_messages
        .unwrap_or(CODEX_TRANSCRIPT_DEFAULT_LIMIT)
        .clamp(1, CODEX_TRANSCRIPT_MAX_LIMIT);

    let result = read_agent_thread_transcript(
        &agent_id,
        &provider_session_id,
        &cwd,
        request.workspace_id.as_deref(),
        max_messages,
    )?;
    emit_promoted_generated_asset_event(
        &app,
        &result,
        request.workspace_id.as_deref(),
        "transcript-read",
    );
    if !agent_thread_transcript_result_is_cloud_backed(&result) {
        agent_chat_session_sync_spawn_from_result(
            app,
            &agent_id,
            &result,
            AgentChatSessionSyncContext {
                workspace_id: request.workspace_id.unwrap_or_default(),
                source: "transcript-read".to_string(),
                ..AgentChatSessionSyncContext::default()
            },
            "transcript_read",
        );
    }
    Ok(result)
}

#[tauri::command(rename_all = "snake_case")]
async fn agent_thread_transcript_watch(
    app: AppHandle,
    request: AgentThreadTranscriptWatchRequest,
) -> Result<CodexThreadTranscriptResult, String> {
    let context = agent_thread_transcript_watch_context(&request);
    let result = read_agent_thread_transcript(
        &context.agent_id,
        &context.provider_session_id,
        &context.cwd,
        Some(context.workspace_id.as_str()).filter(|value| !value.trim().is_empty()),
        context.max_messages,
    )?;
    emit_promoted_generated_asset_event(
        &app,
        &result,
        Some(context.workspace_id.as_str()).filter(|value| !value.trim().is_empty()),
        "transcript-watch-start",
    );
    if !agent_thread_transcript_result_is_cloud_backed(&result) {
        agent_chat_session_sync_spawn_from_result(
            app.clone(),
            &context.agent_id,
            &result,
            agent_chat_session_sync_context_from_watch(&context),
            "transcript_watch_start",
        );
        let _ = register_agent_thread_transcript_watch(&app, &request, &result);
    }
    Ok(result)
}

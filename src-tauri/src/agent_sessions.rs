const CODEX_TRANSCRIPT_DEFAULT_LIMIT: usize = 260;
const CODEX_TRANSCRIPT_MAX_LIMIT: usize = 420;
const CODEX_TRANSCRIPT_MAX_TEXT: usize = 12_000;
const CODEX_TRANSCRIPT_MAX_TOOL_TEXT: usize = 8_000;
const CODEX_TRANSCRIPT_MAX_REASONING_TEXT: usize = 48_000;
const CODEX_ROLLOUT_SCAN_LIMIT: usize = 2_500;
const AGENT_THREAD_TRANSCRIPT_UPDATED_EVENT: &str = "forge-agent-thread-transcript-updated";
const AGENT_THREAD_TRANSCRIPT_WATCH_DEBOUNCE_MS: u64 = 180;
const AGENT_THREAD_TRANSCRIPT_MAX_WATCHES: usize = 128;
const CODEX_GENERATED_IMAGE_DIR_SCAN_LIMIT: usize = 16;

use notify::Watcher as NotifyWatcher;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadTranscriptRequest {
    agent_id: Option<String>,
    provider_session_id: Option<String>,
    cwd: Option<String>,
    max_messages: Option<usize>,
    workspace_id: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
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
#[serde(rename_all = "camelCase")]
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
#[serde(default, rename_all = "camelCase")]
struct CodexThreadTranscriptArtifact {
    kind: String,
    mime_type: String,
    path: String,
    url: String,
    title: String,
    prompt: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    asset_id: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    asset_path: String,
    #[serde(skip_serializing_if = "String::is_empty")]
    original_path: String,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
struct CodexThreadTranscriptMessage {
    id: String,
    role: String,
    kind: String,
    text: String,
    title: String,
    call_id: String,
    created_at: String,
    source: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    artifacts: Vec<CodexThreadTranscriptArtifact>,
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
#[serde(rename_all = "camelCase")]
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
    pending: Arc<AtomicBool>,
    touched_ms: u64,
    _watcher: notify::RecommendedWatcher,
}

static AGENT_THREAD_TRANSCRIPT_WATCHES: OnceLock<
    StdMutex<HashMap<String, AgentThreadTranscriptWatchEntry>>,
> = OnceLock::new();

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

/// Scans the tail of a provider session transcript for the last model the
/// session actually used. Both Claude Code and Codex write compact JSONL
/// where assistant/turn entries carry a `"model":"..."` field, so the last
/// occurrence is the model that was active when the session closed.
fn jsonl_tail_last_model(path: &Path) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(192 * 1024);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    let needle = "\"model\":\"";
    let mut last = None;
    let mut cursor = 0usize;
    while let Some(position) = text[cursor..].find(needle) {
        let value_start = cursor + position + needle.len();
        let Some(value_length) = text[value_start..].find('"') else {
            break;
        };
        let value = text[value_start..value_start + value_length].trim();
        if !value.is_empty()
            && value.len() <= 120
            && value != "<synthetic>"
            && value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':' | b'/')
            })
        {
            last = Some(value.to_string());
        }
        cursor = value_start + value_length;
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
    jsonl_tail_last_model(&transcript)
}

/// Builds an OpenCode `--model` value (`providerID/modelID`) from a value that
/// carries the model. Handles both the assistant message shape
/// (`{modelID, providerID}`) and the session column shape (`{id, providerID}`).
fn opencode_model_from_value(value: &Value) -> Option<String> {
    let model_id = first_value_string(&[
        value.get("modelID"),
        value.get("model_id"),
        value.get("id"),
        value.get("model"),
    ]);
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
    let connection = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
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

    if let Ok(mut statement) =
        connection.prepare("select model from session where id = ?1 limit 1")
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

fn clean_codex_transcript_text(value: impl AsRef<str>, max_chars: usize) -> String {
    let redacted = redact_codex_transcript_secrets(value.as_ref());
    let mut output = String::with_capacity(redacted.len().min(max_chars));
    let mut previous_was_newline = false;
    let mut blank_lines = 0usize;

    for character in redacted.chars() {
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
        if output.chars().count() >= max_chars {
            break;
        }
    }

    output.trim().to_string()
}

fn clean_codex_reasoning_text(value: impl AsRef<str>) -> String {
    let cleaned = clean_codex_transcript_text(value, CODEX_TRANSCRIPT_MAX_REASONING_TEXT + 1024);
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
        .take_while(|(index, _)| {
            output.len().saturating_sub(*index) <= 1024
        })
        .find(|(_, character)| character.is_whitespace())
    {
        output.truncate(index);
    }
    output = output.trim().to_string();
    output.push_str("\n\n[truncated]");
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
                cloud_mcp_payload_text(&promoted, &["local_path", "localPath", "path"])
                    .unwrap_or_default();
            if asset_path.is_empty() {
                continue;
            }
            let asset_id = cloud_mcp_payload_text(&promoted, &["asset_id", "assetId", "id"])
                .unwrap_or_default();
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
            "assetId": artifact.asset_id,
            "local_path": artifact.asset_path,
            "localPath": artifact.asset_path,
            "original_path": artifact.original_path,
            "originalPath": artifact.original_path,
            "path": artifact.asset_path,
        }));
    }
    if assets.is_empty() {
        return None;
    }

    Some(json!({
        "event_kind": "account_assets_updated",
        "eventKind": "account_assets_updated",
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
    if ["status", "state", "phase"]
        .iter()
        .any(|key| object.get(*key).is_some_and(transcript_tool_value_status_is_error))
    {
        return true;
    }
    if ["error", "toolError", "tool_error", "stderr"]
        .iter()
        .any(|key| object.get(*key).is_some_and(transcript_tool_value_has_content))
    {
        return true;
    }
    ["output", "result", "response", "state"]
        .iter()
        .any(|key| object.get(*key).is_some_and(transcript_tool_value_has_error))
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
    let text = clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TEXT);
    CodexThreadTranscriptMessage {
        id,
        role: "assistant".to_string(),
        kind: "task_complete".to_string(),
        text,
        title: "Task complete".to_string(),
        call_id: String::new(),
        created_at: timestamp.to_string(),
        source: source.to_string(),
        artifacts: Vec::new(),
    }
}

fn transcript_error_message(
    id: String,
    source: &str,
    timestamp: &str,
    text: impl AsRef<str>,
) -> CodexThreadTranscriptMessage {
    CodexThreadTranscriptMessage {
        id,
        role: "activity".to_string(),
        kind: "error".to_string(),
        text: clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
        title: "Error".to_string(),
        call_id: String::new(),
        created_at: timestamp.to_string(),
        source: source.to_string(),
        artifacts: Vec::new(),
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

    let text = clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
    if text.is_empty() && title.is_empty() {
        return None;
    }

    Some(CodexThreadTranscriptMessage {
        id: format!("codex-{line_index}-tool-call"),
        role: "activity".to_string(),
        kind: "tool_call".to_string(),
        text,
        title: clean_codex_title(title, "Called tool"),
        call_id,
        created_at: timestamp.to_string(),
        source: "codex".to_string(),
        artifacts: Vec::new(),
    })
}

fn codex_function_output_message(
    line_index: usize,
    timestamp: &str,
    payload: &Value,
) -> Option<CodexThreadTranscriptMessage> {
    let call_id = value_string(payload.get("call_id"));
    let output_value = payload.get("output").unwrap_or(&Value::Null);
    let raw_output = codex_content_text(output_value);
    let output = clean_codex_transcript_text(&raw_output, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
    let artifacts = codex_image_artifacts_from_content(output_value, &raw_output, "Tool output");
    let has_error =
        transcript_tool_value_has_error(payload) || transcript_tool_value_has_error(output_value);

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
        title,
        call_id,
        created_at: timestamp.to_string(),
        source: "codex".to_string(),
        artifacts,
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
            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-user"),
                role: "user".to_string(),
                kind: "message".to_string(),
                text: clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TEXT),
                title: String::new(),
                call_id: String::new(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
                artifacts,
            }]
        }
        "agent_message" => {
            let raw_message = value_string(payload.get("message"));
            let text = clean_codex_transcript_text(&raw_message, CODEX_TRANSCRIPT_MAX_TEXT);
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
                    artifacts,
                }]
            }
        }
        "task_complete" => vec![CodexThreadTranscriptMessage {
            id: format!("codex-{line_index}-task-complete"),
            role: "assistant".to_string(),
            kind: "task_complete".to_string(),
            text: {
                let text = clean_codex_transcript_text(
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
            created_at: timestamp.to_string(),
            source: "codex".to_string(),
            artifacts: Vec::new(),
        }],
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
            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-patch"),
                role: "activity".to_string(),
                kind: "patch".to_string(),
                text: clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
                title: if success {
                    "Patch applied"
                } else {
                    "Patch failed"
                }
                .to_string(),
                call_id: String::new(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
                artifacts: Vec::new(),
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
            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-mcp"),
                role: "activity".to_string(),
                kind,
                text: clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
                title,
                call_id: value_string(invocation.get("call_id")),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
                artifacts,
            }]
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
            let text = clean_codex_transcript_text(&raw_text, CODEX_TRANSCRIPT_MAX_TEXT);
            let artifacts =
                codex_image_artifacts_from_content(content, &raw_text, "Generated image");
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
                    artifacts,
                }];
            }
            if role == "user" {
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
                    artifacts,
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
                artifacts,
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
        "tool_search_call" | "tool_search" => vec![CodexThreadTranscriptMessage {
            id: format!("codex-{line_index}-tool-search-call"),
            role: "activity".to_string(),
            kind: "tool_call".to_string(),
            text: clean_codex_transcript_text(pretty_json(payload), CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
            title: "Searched tools".to_string(),
            call_id: first_value_string(&[payload.get("call_id"), payload.get("callId"), payload.get("id")]),
            created_at: timestamp.to_string(),
            source: "codex".to_string(),
            artifacts: Vec::new(),
        }],
        "tool_search_output" => vec![CodexThreadTranscriptMessage {
            id: format!("codex-{line_index}-tool-search-output"),
            role: "activity".to_string(),
            kind: "tool_output".to_string(),
            text: clean_codex_transcript_text(
                {
                    let output = payload
                        .get("output")
                        .or_else(|| payload.get("result"))
                        .or_else(|| payload.get("results"))
                        .unwrap_or(payload);
                    let text = codex_content_text(output);
                    if text.trim().is_empty() {
                        pretty_json(output)
                    } else {
                        text
                    }
                },
                CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
            ),
            title: "Tool search results".to_string(),
            call_id: first_value_string(&[payload.get("call_id"), payload.get("callId"), payload.get("id")]),
            created_at: timestamp.to_string(),
            source: "codex".to_string(),
            artifacts: Vec::new(),
        }],
        "web_search_call" => vec![CodexThreadTranscriptMessage {
            id: format!("codex-{line_index}-web-search"),
            role: "activity".to_string(),
            kind: "web".to_string(),
            text: clean_codex_transcript_text(pretty_json(payload), CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
            title: "Searched web".to_string(),
            call_id: value_string(payload.get("id")),
            created_at: timestamp.to_string(),
            source: "codex".to_string(),
            artifacts: Vec::new(),
        }],
        "reasoning" => {
            let summary = clean_codex_transcript_text(
                codex_summary_text(payload),
                CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
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
                artifacts: Vec::new(),
            }]
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod agent_sessions_tests {
    use super::*;

    fn unique_test_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        env::temp_dir().join(format!("{name}-{suffix}"))
    }

    #[test]
    fn transcript_watch_owner_priority_preserves_webview_context() {
        let native_owner =
            agent_thread_transcript_native_watch_owner_key("pane-a", Some(42));
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
	    fn opencode_step_finish_classifies_on_structured_fields_only() {
        // Normal finish reasons are control metadata, not visible messages.
        for reason in ["stop", "tool-calls", "length"] {
            let messages =
                opencode_step_finish(json!({"type": "step-finish", "reason": reason}));
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
        assert_eq!(opencode_model_from_value(&json!({"providerID": "opencode-go"})), None);
        assert_eq!(opencode_model_from_value(&json!({})), None);
    }

    #[test]
    fn cloud_session_response_rehydrates_normalized_messages() {
        let first_messages = serde_json::to_string(&json!([
            {
                "id": "m1",
                "role": "user",
                "kind": "message",
                "text": "please inspect the board",
                "createdAt": "2026-01-01T00:00:00Z",
                "source": "claude",
            }
        ]))
        .unwrap();
        let response = json!({
            "ok": true,
            "session": {
                "id": "agent-chat-session-1",
                "providerSessionId": "provider-session-1",
                "title": "Board inspection",
                "cwd": "/tmp/project",
                "latestTimestamp": "2026-01-01T00:00:05Z",
            },
            "records": [
                {
                    "recordIndex": 0,
                    "messages_json": first_messages,
                },
                {
                    "recordIndex": 1,
                    "messages": [{
                        "id": "m2",
                        "role": "assistant",
                        "kind": "message",
                        "text": "I found the synced transcript.",
                        "createdAt": "2026-01-01T00:00:05Z",
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

    static OPENCODE_DB_TEST_LOCK: std::sync::OnceLock<StdMutex<()>> = std::sync::OnceLock::new();

    #[test]
    fn opencode_session_last_model_prefers_latest_assistant_then_session_column() {
        let _guard = OPENCODE_DB_TEST_LOCK
            .get_or_init(|| StdMutex::new(()))
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());

        let dir = unique_test_dir("opencode-model-db");
        fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("opencode.db");
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
                    rusqlite::params![
                        "ses_1",
                        r#"{"id":"glm-5.1","providerID":"opencode-go"}"#
                    ],
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
                    rusqlite::params![
                        "ses_2",
                        r#"{"id":"glm-5.2","providerID":"opencode-go"}"#
                    ],
                )
                .unwrap();
        }

        let previous = env::var_os("OPENCODE_DATA_DIR");
        env::set_var("OPENCODE_DATA_DIR", &dir);

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
            Some(value) => env::set_var("OPENCODE_DATA_DIR", value),
            None => env::remove_var("OPENCODE_DATA_DIR"),
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
        let db_path = dir.join("opencode.db");
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

        let previous = env::var_os("OPENCODE_DATA_DIR");
        env::set_var("OPENCODE_DATA_DIR", &dir);

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
            Some(value) => env::set_var("OPENCODE_DATA_DIR", value),
            None => env::remove_var("OPENCODE_DATA_DIR"),
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
    fn claude_session_parser_keeps_assistant_output_visible() {
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
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": "Hey! How can I help you today?"}],
                "stop_reason": "end_turn"
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
        match record_type {
            "session_meta" => {
                meta.session_id = clean_codex_id(value_string(payload.get("id")));
                meta.cwd = value_string(payload.get("cwd"));
            }
            "event_msg" => {
                if payload.get("type").and_then(Value::as_str) == Some("thread_name_updated") {
                    meta.title = clean_codex_title(value_string(payload.get("thread_name")), "");
                }
                for message in codex_messages_from_event(line_index, &timestamp, payload) {
                    push_codex_message(&mut messages, &mut seen, Some(message));
                }
            }
            "response_item" => {
                for message in codex_messages_from_response_item(line_index, &timestamp, payload) {
                    push_codex_message(&mut messages, &mut seen, Some(message));
                }
            }
            _ => {}
        }
    }

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
    let home = codex_home_from_rollout_path(&path)
        .ok_or_else(|| "Codex rollout transcript is not inside a sessions directory.".to_string())?;
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

fn find_claude_session(
    provider_session_id: &str,
    cwd: &str,
) -> Result<(PathBuf, CodexRolloutMeta, String), String> {
    let requested_session_id = clean_codex_id(provider_session_id);
    if !requested_session_id.is_empty() {
        let mut direct_matches = Vec::new();
        for home in claude_home_candidates() {
            let projects_dir = home.join("projects");
            let Ok(entries) = fs::read_dir(projects_dir) else {
                continue;
            };
            direct_matches.extend(entries.flatten().filter_map(|entry| {
                let path = entry.path().join(format!("{requested_session_id}.jsonl"));
                path.exists().then_some(path)
            }));
        }

        for path in direct_matches {
            if let Some(meta) = claude_file_meta(&path) {
                return Ok((path, meta, "sessionId".to_string()));
            }
        }
    }

    let files = collect_claude_candidate_files(cwd)?;

    if !requested_session_id.is_empty() {
        for path in &files {
            let file_match = path
                .file_stem()
                .and_then(|stem| stem.to_str())
                .is_some_and(|name| name == requested_session_id);
            let Some(meta) = claude_file_meta(path) else {
                continue;
            };
            if file_match || meta.session_id == requested_session_id {
                return Ok((path.clone(), meta, "sessionId".to_string()));
            }
        }
    }

    Err("No Claude Code transcript matched this thread session.".to_string())
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
            let input = block
                .get("input")
                .map(pretty_json)
                .unwrap_or_else(|| "{}".to_string());
            Some(CodexThreadTranscriptMessage {
                id: format!("claude-{line_index}-{block_index}-tool-call"),
                role: "activity".to_string(),
                kind: "tool_call".to_string(),
                text: clean_codex_transcript_text(input, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
                title: clean_codex_title(claude_tool_title(&name, input_value), "Called tool"),
                call_id,
                created_at: timestamp.to_string(),
                source: "claude".to_string(),
                artifacts: Vec::new(),
            })
        }
        "tool_result" => {
            let call_id = value_string(block.get("tool_use_id"));
            let content = block
                .get("content")
                .map(claude_content_text)
                .unwrap_or_default();
            let text = clean_codex_transcript_text(&content, CODEX_TRANSCRIPT_MAX_TOOL_TEXT);
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
                title,
                call_id,
                created_at: timestamp.to_string(),
                source: "claude".to_string(),
                artifacts,
            })
        }
        "thinking" => {
            let thinking = value_string(block.get("thinking"));
            if thinking.is_empty() {
                None
            } else {
                Some(CodexThreadTranscriptMessage {
                    id: format!("claude-{line_index}-{block_index}-reasoning"),
                    role: "activity".to_string(),
                    kind: "reasoning".to_string(),
                    text: clean_codex_transcript_text(thinking, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
                    title: "Reasoning".to_string(),
                    call_id: String::new(),
                    created_at: timestamp.to_string(),
                    source: "claude".to_string(),
                    artifacts: Vec::new(),
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
                push_codex_message(
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
                );
            } else {
                let assistant_text =
                    clean_codex_transcript_text(&result_text, CODEX_TRANSCRIPT_MAX_TEXT);
                let already_has_assistant_text = !assistant_text.is_empty()
                    && messages
                        .iter()
                        .rev()
                        .any(|message| message.role == "assistant" && message.text == assistant_text);
                if !assistant_text.is_empty() && !already_has_assistant_text {
                    push_codex_message(
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
                            artifacts: Vec::new(),
                        }),
                    );
                }
                push_codex_message(
                    &mut messages,
                    &mut seen,
                    Some(transcript_task_complete_message(
                        format!("claude-{line_index}-task-complete"),
                        "claude",
                        &timestamp,
                        result_text,
                    )),
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
            let text = clean_codex_transcript_text(
                claude_content_text(content),
                CODEX_TRANSCRIPT_MAX_TEXT,
            );
            if !text.is_empty() {
                push_codex_message(
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
                        artifacts: Vec::new(),
                    }),
                );
            }

            if let Some(blocks) = content.as_array() {
                for (block_index, block) in blocks.iter().enumerate() {
                    push_codex_message(
                        &mut messages,
                        &mut seen,
                        claude_activity_from_block(line_index, block_index, &timestamp, block),
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
                push_codex_message(
                    &mut messages,
                    &mut seen,
                    Some(transcript_task_complete_message(
                        format!("claude-{line_index}-task-complete"),
                        "claude",
                        &timestamp,
                        text,
                    )),
                );
            }
        }
    }

    if messages.len() > max_messages {
        messages = messages[messages.len() - max_messages..].to_vec();
    }

    Ok((meta, messages))
}

fn opencode_data_home() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(value) = env::var_os("OPENCODE_DATA_DIR") {
        candidates.push(PathBuf::from(value));
    }
    if let Some(value) = env::var_os("XDG_DATA_HOME") {
        candidates.push(PathBuf::from(value).join("opencode"));
    }
    if let Some(value) = env::var_os("USERPROFILE") {
        let home = PathBuf::from(value);
        candidates.push(home.join(".local").join("share").join("opencode"));
        candidates.push(home.join("AppData").join("Roaming").join("opencode"));
        candidates.push(home.join("AppData").join("Local").join("opencode"));
    }
    if let Some(value) = env::var_os("HOME") {
        candidates.push(
            PathBuf::from(value)
                .join(".local")
                .join("share")
                .join("opencode"),
        );
    }

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
            vec![CodexThreadTranscriptMessage {
                id: format!("opencode-{message_id}-{part_id}-text"),
                role: message_role.to_string(),
                kind: "message".to_string(),
                text: clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TEXT),
                title: String::new(),
                call_id: String::new(),
                created_at: opencode_part_created_at(timestamp, data, false),
                source: "opencode".to_string(),
                artifacts: Vec::new(),
            }]
        }
        "reasoning" => {
            let text = first_value_string(&[data.get("text"), data.get("content")]);
            if text.trim().is_empty() {
                return Vec::new();
            }
            vec![CodexThreadTranscriptMessage {
                id: format!("opencode-{message_id}-{part_id}-reasoning"),
                role: "activity".to_string(),
                kind: "reasoning".to_string(),
                text: clean_codex_reasoning_text(text),
                title: "Reasoning".to_string(),
                call_id: String::new(),
                created_at: opencode_part_created_at(timestamp, data, false),
                source: "opencode".to_string(),
                artifacts: Vec::new(),
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
            let mut messages = Vec::new();
            let call_text = if input.trim().is_empty() {
                pretty_json(data)
            } else {
                input
            };
            messages.push(CodexThreadTranscriptMessage {
                id: format!("opencode-{message_id}-{part_id}-tool-call"),
                role: "activity".to_string(),
                kind: "tool_call".to_string(),
                text: clean_codex_transcript_text(call_text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
                title: clean_codex_title(opencode_tool_title(&tool, input_value), "Called tool"),
                call_id: call_id.clone(),
                created_at: opencode_part_created_at(timestamp, data, false),
                source: "opencode".to_string(),
                artifacts: Vec::new(),
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
                    text: clean_codex_transcript_text(output_text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
                    title,
                    call_id,
                    created_at: opencode_part_created_at(timestamp, data, true),
                    source: "opencode".to_string(),
                    artifacts,
                });
            }
            messages
        }
        "patch" => vec![CodexThreadTranscriptMessage {
            id: format!("opencode-{message_id}-{part_id}-patch"),
            role: "activity".to_string(),
            kind: "patch".to_string(),
            text: clean_codex_transcript_text(pretty_json(data), CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
            title: "Patch".to_string(),
            call_id: String::new(),
            created_at: timestamp.to_string(),
            source: "opencode".to_string(),
            artifacts: Vec::new(),
        }],
        "file" => {
            let text = pretty_json(data);
            let artifacts = codex_image_artifacts_from_content(data, &text, "File");
            vec![CodexThreadTranscriptMessage {
                id: format!("opencode-{message_id}-{part_id}-file"),
                role: "activity".to_string(),
                kind: "file".to_string(),
                text: clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
                title: "File".to_string(),
                call_id: String::new(),
                created_at: timestamp.to_string(),
                source: "opencode".to_string(),
                artifacts,
            }]
        }
        "step-start" => {
            let text = first_value_string(&[data.get("summary"), data.get("description")]);
            let text = if text.trim().is_empty() {
                "Working".to_string()
            } else {
                text
            };
            vec![CodexThreadTranscriptMessage {
                id: format!("opencode-{message_id}-{part_id}-step-start"),
                role: "activity".to_string(),
                kind: "task_progress".to_string(),
                text: clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
                title: "Working".to_string(),
                call_id: String::new(),
                created_at: timestamp.to_string(),
                source: "opencode".to_string(),
                artifacts: Vec::new(),
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
            let reason_is_error =
                reason_key.contains("error") || reason_key.contains("fail");
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
            push_codex_message(
                &mut messages,
                &mut seen,
                Some(CodexThreadTranscriptMessage {
                    id: format!("opencode-{}-message", row.0),
                    role: role.clone(),
                    kind: "message".to_string(),
                    text: clean_codex_transcript_text(message_text, CODEX_TRANSCRIPT_MAX_TEXT),
                    title: String::new(),
                    call_id: String::new(),
                    created_at: timestamp.clone(),
                    source: "opencode".to_string(),
                    artifacts: Vec::new(),
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
    for key in ["messages", "messagesJson", "messages_json"] {
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
    if matches!(role.as_str(), "assistant" | "user" | "system" | "tool" | "activity") {
        return role;
    }
    let kind = fallback_kind.trim().to_ascii_lowercase();
    if kind.contains("terminal")
        || kind.contains("termout")
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
    if let Ok(mut message) =
        serde_json::from_value::<CodexThreadTranscriptMessage>(value.clone())
    {
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

    let kind = cloud_mcp_payload_text(value, &["kind", "type"])
        .unwrap_or_else(|| "message".to_string());
    let text = cloud_mcp_payload_text(value, &["text", "message", "content"])
        .unwrap_or_default();
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
        id: cloud_mcp_payload_text(value, &["id", "messageId", "message_id"])
            .unwrap_or(fallback_id),
        role,
        kind,
        text,
        title,
        call_id: cloud_mcp_payload_text(value, &["callId", "call_id"]).unwrap_or_default(),
        created_at: cloud_mcp_payload_text(
            value,
            &["createdAt", "created_at", "timestamp", "time"],
        )
        .unwrap_or_else(|| fallback_timestamp.to_string()),
        source: cloud_mcp_payload_text(value, &["source"]).unwrap_or_else(|| agent_id.to_string()),
        artifacts,
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
        &["id", "agentChatSessionId", "agent_chat_session_id"],
    )
    .unwrap_or_default();
    let session_id = cloud_mcp_payload_text(
        session,
        &[
            "sessionId",
            "session_id",
            "providerSessionId",
            "provider_session_id",
        ],
    )
    .unwrap_or_else(|| provider_session_id.to_string());
    let mut latest_timestamp = cloud_mcp_payload_text(
        session,
        &[
            "latestTimestamp",
            "latest_timestamp",
            "updatedAt",
            "updated_at",
            "createdAt",
            "created_at",
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
                "recordTimestamp",
                "record_timestamp",
                "latestTimestamp",
                "latest_timestamp",
                "createdAt",
                "created_at",
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
        session_title: cloud_mcp_payload_text(session, &["title", "sessionTitle", "session_title"])
            .unwrap_or_default(),
        rollout_path: if cloud_session_id.trim().is_empty() {
            format!("cloud://agent-chat-session/{provider_session_id}")
        } else {
            format!("cloud://agent-chat-session/{cloud_session_id}")
        },
        cwd: cloud_mcp_payload_text(session, &["cwd", "workingDirectory", "working_directory"])
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
            "sessionId",
            "session_id",
            "providerSessionId",
            "provider_session_id",
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
    if let Some(workspace_id) = workspace_id.map(str::trim).filter(|value| !value.is_empty()) {
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
        .find(|session| agent_thread_cloud_session_matches_provider_session(session, provider_session_id))
        .or_else(|| sessions.first())
        .ok_or_else(|| "Cloud did not return a synced session for this provider id.".to_string())?;
    let cloud_session_id = cloud_mcp_payload_text(
        session,
        &["id", "agentChatSessionId", "agent_chat_session_id"],
    )
    .ok_or_else(|| "Cloud session list row did not include a session id.".to_string())?;

    let mut detail_query = vec![
        ("limit", "2000".to_string()),
        ("record_limit", "2000".to_string()),
        ("record_direction", "latest".to_string()),
    ];
    if let Some(workspace_id) = workspace_id.map(str::trim).filter(|value| !value.is_empty()) {
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

fn agent_thread_transcript_result_is_cloud_backed(
    result: &CodexThreadTranscriptResult,
) -> bool {
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

fn agent_thread_transcript_native_watch_owner_key(pane_id: &str, instance_id: Option<u64>) -> String {
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
    if let Some(path) = transcript_path.map(str::trim).filter(|value| !value.is_empty()) {
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
    if (agent_id == "opencode" && watch_path.is_file()) || !watch_path.exists() {
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
    paths.iter().any(|path| {
        path == watch_path
            || path.starts_with(watch_path)
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
        if let Some(watches) = AGENT_THREAD_TRANSCRIPT_WATCHES.get() {
            if let Ok(entries) = watches.lock() {
                if let Some(entry) = entries.get(&key) {
                    entry.pending.store(false, Ordering::SeqCst);
                }
            }
        }
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
        entry.pending.store(false, Ordering::SeqCst);
        entry.touched_ms = current_time_ms();
        if entry.last_signature == signature {
            false
        } else {
            entry.last_signature = signature;
            true
        }
    };
    if !should_emit {
        return;
    }

    let _ = app.emit(
        AGENT_THREAD_TRANSCRIPT_UPDATED_EVENT,
        json!({
            "agentId": context.agent_id,
            "allowTimestampFallback": context.allow_timestamp_fallback,
            "cwd": context.cwd,
            "expectedMessageCreatedAt": context.expected_message_created_at,
            "expectedUserMessage": context.expected_user_message,
            "instanceId": context.instance_id,
            "paneId": context.pane_id,
            "pollUntilTurnComplete": context.poll_until_turn_complete,
            "promptEventId": context.prompt_event_id,
            "promptEventSubmittedAt": context.prompt_event_submitted_at,
            "providerSessionId": context.provider_session_id,
            "reason": reason,
            "requestSource": context.source,
            "result": result,
            "source": "agent-transcript-watch",
            "submittedAt": context.submitted_at,
            "terminalIndex": context.terminal_index,
            "terminalPromptAccepted": context.terminal_prompt_accepted,
            "threadId": context.thread_id,
            "workspaceId": context.workspace_id,
        }),
    );
    if !agent_thread_transcript_result_is_cloud_backed(&result) {
        agent_chat_session_sync_spawn_from_result(
            app,
            &context.agent_id,
            &result,
            agent_chat_session_sync_context_from_watch(&context),
            "transcript_watch_update",
        );
    }
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
    let pending = Arc::new(AtomicBool::new(false));
    let pending_for_watch = pending.clone();
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
        if pending_for_watch
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return;
        }
        let app_for_emit = app_for_watch.clone();
        let key_for_emit = key_for_watch.clone();
        tauri::async_runtime::spawn(async move {
            sleep(Duration::from_millis(
                AGENT_THREAD_TRANSCRIPT_WATCH_DEBOUNCE_MS,
            ))
            .await;
            emit_agent_thread_transcript_watch_update(app_for_emit, key_for_emit, "file-change")
                .await;
        });
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
        pending,
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
    register_agent_thread_transcript_watch_internal(
        app,
        context,
        watch_path,
        String::new(),
        agent_thread_transcript_native_watch_owner_key(&request.pane_id, request.instance_id),
    )
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

#[tauri::command]
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

#[tauri::command]
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

#[tauri::command]
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

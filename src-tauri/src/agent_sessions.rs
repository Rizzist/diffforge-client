const CODEX_TRANSCRIPT_DEFAULT_LIMIT: usize = 260;
const CODEX_TRANSCRIPT_MAX_LIMIT: usize = 420;
const CODEX_TRANSCRIPT_MAX_TEXT: usize = 12_000;
const CODEX_TRANSCRIPT_MAX_TOOL_TEXT: usize = 8_000;
const CODEX_ROLLOUT_SCAN_LIMIT: usize = 2_500;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadTranscriptRequest {
    agent_id: Option<String>,
    provider_session_id: Option<String>,
    cwd: Option<String>,
    max_messages: Option<usize>,
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
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexThreadTranscriptMessage {
    id: String,
    role: String,
    kind: String,
    text: String,
    title: String,
    call_id: String,
    created_at: String,
    source: String,
}

#[derive(Clone, Default)]
struct CodexRolloutMeta {
    session_id: String,
    cwd: String,
    latest_timestamp: String,
    title: String,
}

#[derive(Serialize)]
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

fn codex_home_dir() -> Option<PathBuf> {
    env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".codex")))
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
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
        return Err(format!("No Codex rollout transcripts were found in: {searched}"));
    }

    Ok(files)
}

fn clean_codex_id(value: impl AsRef<str>) -> String {
    value
        .as_ref()
        .trim()
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, '-' | '_' | '.' | ':' | '/')
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

fn sort_rollouts_newest_first(files: &mut [PathBuf]) {
    files.sort_by(|left, right| {
        let left_modified = fs::metadata(left).and_then(|metadata| metadata.modified()).ok();
        let right_modified = fs::metadata(right).and_then(|metadata| metadata.modified()).ok();
        right_modified.cmp(&left_modified)
    });
}

fn value_string(value: Option<&Value>) -> String {
    value.and_then(Value::as_str).unwrap_or_default().trim().to_string()
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
    [
        "sk-proj-",
        "sk-",
        "github_pat_",
        "ghp_",
        "gho_",
        "glpat-",
    ]
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
    }
}

fn codex_function_call_message(
    line_index: usize,
    timestamp: &str,
    payload: &Value,
) -> Option<CodexThreadTranscriptMessage> {
    let name = value_string(payload.get("name"));
    let call_id = value_string(payload.get("call_id"));
    let arguments = payload.get("arguments").unwrap_or(&Value::Null);
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
        (
            command_title(command, "Ran command"),
            lines.join("\n"),
        )
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
    })
}

fn codex_function_output_message(
    line_index: usize,
    timestamp: &str,
    payload: &Value,
) -> Option<CodexThreadTranscriptMessage> {
    let call_id = value_string(payload.get("call_id"));
    let output = clean_codex_transcript_text(
        codex_content_text(payload.get("output").unwrap_or(&Value::Null)),
        CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
    );

    if output.is_empty() {
        return None;
    }

    Some(CodexThreadTranscriptMessage {
        id: format!("codex-{line_index}-tool-output"),
        role: "activity".to_string(),
        kind: "tool_output".to_string(),
        text: output,
        title: "Tool output".to_string(),
        call_id,
        created_at: timestamp.to_string(),
        source: "codex".to_string(),
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

        let record_type = value.get("type").and_then(Value::as_str).unwrap_or_default();
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
            message.role,
            message.kind,
            message.call_id,
            message.text
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
    let event_type = payload.get("type").and_then(Value::as_str).unwrap_or_default();
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
            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-user"),
                role: "user".to_string(),
                kind: "message".to_string(),
                text: clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TEXT),
                title: String::new(),
                call_id: String::new(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
            }]
        }
        "agent_message" => vec![CodexThreadTranscriptMessage {
            id: format!("codex-{line_index}-assistant-event"),
            role: "assistant".to_string(),
            kind: "message".to_string(),
            text: clean_codex_transcript_text(
                value_string(payload.get("message")),
                CODEX_TRANSCRIPT_MAX_TEXT,
            ),
            title: String::new(),
            call_id: String::new(),
            created_at: timestamp.to_string(),
            source: "codex".to_string(),
        }],
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
        }],
        "patch_apply_end" => {
            let success = payload.get("success").and_then(Value::as_bool).unwrap_or(false);
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
                title: if success { "Patch applied" } else { "Patch failed" }.to_string(),
                call_id: String::new(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
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
            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-mcp"),
                role: "activity".to_string(),
                kind: "tool_output".to_string(),
                text: clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
                title: clean_codex_title(title, "MCP tool"),
                call_id: value_string(invocation.get("call_id")),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
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
    let item_type = payload.get("type").and_then(Value::as_str).unwrap_or_default();
    match item_type {
        "message" => {
            let role = payload.get("role").and_then(Value::as_str).unwrap_or_default();
            if role != "assistant" {
                return Vec::new();
            }

            vec![CodexThreadTranscriptMessage {
                id: format!("codex-{line_index}-assistant"),
                role: "assistant".to_string(),
                kind: "message".to_string(),
                text: clean_codex_transcript_text(
                    codex_content_text(payload.get("content").unwrap_or(&Value::Null)),
                    CODEX_TRANSCRIPT_MAX_TEXT,
                ),
                title: String::new(),
                call_id: String::new(),
                created_at: timestamp.to_string(),
                source: "codex".to_string(),
            }]
        }
        "function_call" | "custom_tool_call" => {
            codex_function_call_message(line_index, timestamp, payload)
                .into_iter()
                .collect()
        }
        "function_call_output" | "custom_tool_call_output" => {
            codex_function_output_message(line_index, timestamp, payload)
                .into_iter()
                .collect()
        }
        "web_search_call" => vec![CodexThreadTranscriptMessage {
            id: format!("codex-{line_index}-web-search"),
            role: "activity".to_string(),
            kind: "web".to_string(),
            text: clean_codex_transcript_text(pretty_json(payload), CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
            title: "Searched web".to_string(),
            call_id: value_string(payload.get("id")),
            created_at: timestamp.to_string(),
            source: "codex".to_string(),
        }],
        "reasoning" => {
            let summary = clean_codex_transcript_text(
                codex_summary_text(payload),
                CODEX_TRANSCRIPT_MAX_TOOL_TEXT,
            );
            if summary.is_empty() {
                Vec::new()
            } else {
                vec![CodexThreadTranscriptMessage {
                    id: format!("codex-{line_index}-reasoning"),
                    role: "activity".to_string(),
                    kind: "reasoning".to_string(),
                    text: summary,
                    title: "Reasoning".to_string(),
                    call_id: String::new(),
                    created_at: timestamp.to_string(),
                    source: "codex".to_string(),
                }]
            }
        }
        _ => Vec::new(),
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

        let record_type = value.get("type").and_then(Value::as_str).unwrap_or_default();
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

fn claude_home_dir() -> Option<PathBuf> {
    env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(|home| PathBuf::from(home).join(".claude")))
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".claude")))
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
        let entry_type = value.get("type").and_then(Value::as_str).unwrap_or_default();
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
    let claude_home =
        claude_home_dir().ok_or_else(|| "Unable to locate Claude Code home.".to_string())?;
    let projects_dir = claude_home.join("projects");
    if !projects_dir.exists() {
        return Err(format!(
            "Claude Code projects directory does not exist: {}",
            projects_dir.display()
        ));
    }

    let requested_session_id = clean_codex_id(provider_session_id);
    if !requested_session_id.is_empty() {
        let direct_matches = fs::read_dir(&projects_dir)
            .ok()
            .into_iter()
            .flat_map(|entries| entries.flatten())
            .filter_map(|entry| {
                let path = entry.path().join(format!("{requested_session_id}.jsonl"));
                if path.exists() {
                    Some(path)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();

        for path in direct_matches {
            if let Some(meta) = claude_file_meta(&path) {
                return Ok((path, meta, "sessionId".to_string()));
            }
        }
    }

    let mut files = Vec::new();
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
    sort_rollouts_newest_first(&mut files);

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
    let block_type = block.get("type").and_then(Value::as_str).unwrap_or_default();
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
            })
        }
        "tool_result" => {
            let call_id = value_string(block.get("tool_use_id"));
            let content = block
                .get("content")
                .map(claude_content_text)
                .unwrap_or_default();
            Some(CodexThreadTranscriptMessage {
                id: format!("claude-{line_index}-{block_index}-tool-output"),
                role: "activity".to_string(),
                kind: "tool_output".to_string(),
                text: clean_codex_transcript_text(content, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
                title: "Tool output".to_string(),
                call_id,
                created_at: timestamp.to_string(),
                source: "claude".to_string(),
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
    let file = fs::File::open(path)
        .map_err(|error| format!("Unable to open Claude Code transcript {}: {error}", path.display()))?;
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

        let entry_type = value.get("type").and_then(Value::as_str).unwrap_or_default();
        if entry_type == "ai-title" {
            meta.title = clean_codex_title(value_string(value.get("aiTitle")), "");
            continue;
        }
        if entry_type == "summary" {
            meta.title = clean_codex_title(value_string(value.get("summary")), "");
            continue;
        }
        if entry_type == "result" {
            let is_error = value.get("is_error").and_then(Value::as_bool).unwrap_or(false)
                || value_string(value.get("subtype")).to_lowercase().contains("error");
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

        if entry_type == "user" || entry_type == "assistant" {
            let role = if entry_type == "assistant" {
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
                && claude_stop_reason_completes_turn(
                    &value_string(message.get("stop_reason").or_else(|| value.get("stop_reason"))),
                )
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
        candidates.push(PathBuf::from(value).join(".local").join("share").join("opencode"));
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
        let command = value_string(input_value.get("command"))
            .trim()
            .to_string();
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
    let message_role = if role == "assistant" { "assistant" } else { "user" };
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
                text: clean_codex_transcript_text(text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
                title: "Reasoning".to_string(),
                call_id: String::new(),
                created_at: opencode_part_created_at(timestamp, data, false),
                source: "opencode".to_string(),
            }]
        }
        "tool" => {
            let tool = first_value_string(&[data.get("tool"), data.get("name"), data.get("title")]);
            let call_id = first_value_string(&[data.get("callID"), data.get("callId"), data.get("id")]);
            let state = data.get("state").unwrap_or(&Value::Null);
            let input_value = data.get("input").or_else(|| state.get("input")).unwrap_or(&Value::Null);
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
            });
            let has_error = !error.trim().is_empty();
            let output_text = if has_error {
                error
            } else {
                output
            };
            if !output_text.trim().is_empty() {
                messages.push(CodexThreadTranscriptMessage {
                    id: format!("opencode-{message_id}-{part_id}-tool-output"),
                    role: "activity".to_string(),
                    kind: "tool_output".to_string(),
                    text: clean_codex_transcript_text(output_text, CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
                    title: if has_error {
                        "Tool error".to_string()
                    } else {
                        "Tool output".to_string()
                    },
                    call_id,
                    created_at: opencode_part_created_at(timestamp, data, true),
                    source: "opencode".to_string(),
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
        }],
        "file" => vec![CodexThreadTranscriptMessage {
            id: format!("opencode-{message_id}-{part_id}-file"),
            role: "activity".to_string(),
            kind: "file".to_string(),
            text: clean_codex_transcript_text(pretty_json(data), CODEX_TRANSCRIPT_MAX_TOOL_TEXT),
            title: "File".to_string(),
            call_id: String::new(),
            created_at: timestamp.to_string(),
            source: "opencode".to_string(),
        }],
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
            }]
        }
        "step-finish" => {
            let reason = first_value_string(&[data.get("reason"), data.get("summary")]);
            let reason_is_error = reason.to_lowercase().contains("error")
                || reason.to_lowercase().contains("fail");
            if reason_is_error {
                vec![transcript_error_message(
                    format!("opencode-{message_id}-{part_id}-step-error"),
                    "opencode",
                    timestamp,
                    if reason.trim().is_empty() {
                        "OpenCode turn failed"
                    } else {
                        reason.as_str()
                    },
                )]
            } else {
                vec![transcript_task_complete_message(
                    format!("opencode-{message_id}-{part_id}-task-complete"),
                    "opencode",
                    timestamp,
                    reason,
                )]
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
    let db_path = opencode_db_path().ok_or_else(|| "Unable to locate OpenCode database.".to_string())?;
    let connection = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|error| format!("Unable to open OpenCode database {}: {error}", db_path.display()))?;
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
    let claude_home =
        claude_home_dir().ok_or_else(|| "Unable to locate Claude Code home.".to_string())?;
    let projects_dir = claude_home.join("projects");
    if !projects_dir.exists() {
        return Err(format!(
            "Claude Code projects directory does not exist: {}",
            projects_dir.display()
        ));
    }

    let mut files = Vec::new();
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
    sort_rollouts_newest_first(&mut files);

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
    let db_path = opencode_db_path().ok_or_else(|| "Unable to locate OpenCode database.".to_string())?;
    let connection = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|error| format!("Unable to open OpenCode database {}: {error}", db_path.display()))?;
    let mut statement = connection
        .prepare("select id, title, directory, time_updated from session order by time_updated desc")
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
    let db_path = opencode_db_path().ok_or_else(|| "Unable to locate OpenCode database.".to_string())?;
    let connection = rusqlite::Connection::open_with_flags(
        &db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|error| format!("Unable to open OpenCode database {}: {error}", db_path.display()))?;

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
        parts_by_message.entry(row.1).or_default().push((row.0, row.2, data));
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
                }),
            );
        }

        for (part_id, part_time, part_data) in parts_by_message.remove(&row.0).unwrap_or_default() {
            let part_timestamp = opencode_timestamp(part_time);
            for message in opencode_part_message(&row.0, &role, &part_id, &part_timestamp, &part_data) {
                push_codex_message(&mut messages, &mut seen, Some(message));
            }
        }
    }

    if messages.len() > max_messages {
        messages = messages[messages.len() - max_messages..].to_vec();
    }

    Ok((
        CodexRolloutMeta {
            session_id: clean_codex_id(session_id),
            cwd: cwd.to_string(),
            latest_timestamp,
            title: clean_codex_title(_title, ""),
        },
        messages,
    ))
}

#[tauri::command]
async fn agent_thread_session_discover(
    request: CodexThreadSessionDiscoverRequest,
) -> Result<CodexThreadTranscriptResult, String> {
    let agent_id = clean_codex_id(request.agent_id.unwrap_or_else(|| "codex".to_string()))
        .to_lowercase();
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

    if agent_id == "claude" {
        return discover_claude_session_by_prompt(&expected_user_message, &cwd, max_messages);
    }

    if agent_id == "opencode" {
        return discover_opencode_session_by_prompt(&expected_user_message, &cwd, max_messages);
    }

    discover_codex_session_by_prompt(
        &expected_user_message,
        &cwd,
        &home_search_cwd,
        allow_timestamp_fallback,
        &submitted_at,
        fallback_window_ms,
        max_messages,
    )
}

#[tauri::command]
async fn agent_thread_transcript(
    request: CodexThreadTranscriptRequest,
) -> Result<CodexThreadTranscriptResult, String> {
    let agent_id = clean_codex_id(request.agent_id.unwrap_or_else(|| "codex".to_string()))
        .to_lowercase();
    let provider_session_id = clean_codex_id(request.provider_session_id.unwrap_or_default());
    let cwd = request.cwd.unwrap_or_default();
    let max_messages = request
        .max_messages
        .unwrap_or(CODEX_TRANSCRIPT_DEFAULT_LIMIT)
        .clamp(1, CODEX_TRANSCRIPT_MAX_LIMIT);

    if provider_session_id.is_empty() {
        return Err("Provider session id is required to read an agent transcript.".to_string());
    }

    if agent_id == "claude" {
        let (path, initial_meta, matched_by) = find_claude_session(&provider_session_id, &cwd)?;
        let (parsed_meta, messages) = parse_claude_session(&path, max_messages)?;
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

        return Ok(CodexThreadTranscriptResult {
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
        });
    }

    if agent_id == "opencode" {
        let (session_id, title, session_cwd, matched_by) =
            find_opencode_session(&provider_session_id, &cwd)?;
        let (parsed_meta, messages) =
            parse_opencode_session(&session_id, &title, &session_cwd, max_messages)?;
        return Ok(CodexThreadTranscriptResult {
            session_id: parsed_meta.session_id,
            session_title: parsed_meta.title,
            rollout_path: opencode_db_path()
                .map(|path| path.to_string_lossy().to_string())
                .unwrap_or_default(),
            cwd: parsed_meta.cwd,
            matched_by,
            latest_timestamp: parsed_meta.latest_timestamp,
            messages,
        });
    }

    let (path, initial_meta, matched_by) = find_codex_rollout(&provider_session_id, &cwd)?;
    let (parsed_meta, messages) = parse_codex_rollout(&path, max_messages)?;
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

    Ok(CodexThreadTranscriptResult {
        session_id,
        session_title,
        rollout_path: path.to_string_lossy().to_string(),
        cwd,
        matched_by,
        latest_timestamp,
        messages,
    })
}

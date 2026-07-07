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
}

struct AgentChatSessionSyncSource {
    provider: String,
    source_kind: String,
    source_path: String,
    session_id: String,
    title: String,
    cwd: String,
    latest_timestamp: String,
    model_id: String,
    model_config: Value,
    records: Vec<Value>,
    thread_detail_messages: Vec<Value>,
    total_record_count: usize,
}

const AGENT_CHAT_SESSION_SYNC_TARGET_PACKET_BYTES: usize = 512 * 1024;
const AGENT_CHAT_SESSION_SYNC_MAX_RECORDS_PER_PACKET: usize = 128;
const AGENT_CHAT_SESSION_HISTORY_BACKFILL_LIMIT: usize = 100;
const AGENT_CHAT_SESSION_HISTORY_BACKFILL_SPAWN_LIMIT: usize = 24;
const AGENT_CHAT_SESSION_HISTORY_BACKFILL_INTERVAL_MS: u64 = 60_000;
const AGENT_CHAT_SESSION_HISTORY_SYNC_VERIFY_INTERVAL_MS: u64 = 30 * 60_000;
const AGENT_CHAT_SESSION_SYNC_BUILD_CONCURRENCY: usize = 4;
const AGENT_CHAT_SESSION_SYNC_PARSER_SCHEMA_VERSION: u64 = 3;
const AGENT_CHAT_SESSION_SYNC_RECORD_KEY_VERSION: u64 = 2;
const AGENT_CHAT_SESSION_SYNC_RECORD_HASH_SCHEMA_VERSION: u64 = 2;

static AGENT_CHAT_SESSION_HISTORY_BACKFILL_LAST: OnceLock<StdMutex<HashMap<String, u64>>> =
    OnceLock::new();
static AGENT_CHAT_SESSION_HISTORY_BACKFILL_WORKSPACES: OnceLock<
    StdMutex<HashMap<String, AgentChatSessionHistoryBackfillWorkspace>>,
> = OnceLock::new();
static AGENT_CHAT_SESSION_HISTORY_BACKFILL_ALL_DIRTY_SINCE: AtomicU64 = AtomicU64::new(0);
static AGENT_CHAT_SESSION_HISTORY_SOURCE_FINGERPRINTS: OnceLock<
    StdMutex<HashMap<String, AgentChatSessionHistorySourceFingerprint>>,
> = OnceLock::new();
static AGENT_CHAT_SESSION_SYNC_BUILD_SEMAPHORE: OnceLock<Arc<tokio::sync::Semaphore>> =
    OnceLock::new();

#[derive(Clone, Copy, Default)]
struct AgentChatSessionHistoryBackfillWorkspace {
    dirty_since_ms: Option<u64>,
    last_full_pass_spawned: Option<bool>,
    last_full_pass_ms: u64,
    all_dirty_seen_ms: u64,
}

#[derive(Clone, PartialEq, Eq)]
struct AgentChatSessionHistorySourceFingerprint {
    source_path: String,
    modified_ms: u64,
    len: u64,
}

fn agent_chat_session_sync_build_semaphore() -> Arc<tokio::sync::Semaphore> {
    AGENT_CHAT_SESSION_SYNC_BUILD_SEMAPHORE
        .get_or_init(|| {
            Arc::new(tokio::sync::Semaphore::new(
                AGENT_CHAT_SESSION_SYNC_BUILD_CONCURRENCY,
            ))
        })
        .clone()
}

fn agent_chat_session_history_source_fingerprints(
) -> &'static StdMutex<HashMap<String, AgentChatSessionHistorySourceFingerprint>> {
    AGENT_CHAT_SESSION_HISTORY_SOURCE_FINGERPRINTS.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn agent_chat_session_history_backfill_workspaces(
) -> &'static StdMutex<HashMap<String, AgentChatSessionHistoryBackfillWorkspace>> {
    AGENT_CHAT_SESSION_HISTORY_BACKFILL_WORKSPACES.get_or_init(|| StdMutex::new(HashMap::new()))
}

fn agent_chat_session_history_backfill_workspace_key(workspace_id: &str) -> Option<String> {
    let workspace_id = workspace_id.trim();
    (!workspace_id.is_empty()).then(|| workspace_id.to_string())
}

fn agent_chat_session_history_backfill_root_key(
    workspace_id: &str,
    root_directory: Option<&str>,
) -> Option<String> {
    let workspace_id = workspace_id.trim();
    if workspace_id.is_empty() {
        return None;
    }
    Some(format!(
        "{}\n{}",
        workspace_id,
        root_directory.unwrap_or_default().trim()
    ))
}

fn agent_chat_session_sync_mark_workspace_history_dirty(workspace_id: &str) {
    let Some(key) = agent_chat_session_history_backfill_workspace_key(workspace_id) else {
        return;
    };
    let now = current_time_ms().max(1);
    let Ok(mut entries) = agent_chat_session_history_backfill_workspaces().lock() else {
        return;
    };
    let entry = entries.entry(key).or_default();
    entry.dirty_since_ms = Some(
        entry
            .dirty_since_ms
            .map(|dirty_since| dirty_since.min(now))
            .unwrap_or(now),
    );
}

fn agent_chat_session_sync_mark_payload_workspace_history_dirty(payload: &Value) {
    let workspace_id = cloud_mcp_payload_text(
        payload,
        &[
            "workspace_id",
            "workspaceId",
            "w",
            "repo_id",
            "repoId",
            "target_workspace_id",
            "targetWorkspaceId",
        ],
    )
    .unwrap_or_default();
    agent_chat_session_sync_mark_workspace_history_dirty(&workspace_id);
}

fn agent_chat_session_sync_mark_all_workspace_history_dirty() {
    let now = current_time_ms().max(1);
    AGENT_CHAT_SESSION_HISTORY_BACKFILL_ALL_DIRTY_SINCE.store(now, Ordering::Release);
    if let Some(workspaces) = AGENT_CHAT_SESSION_HISTORY_BACKFILL_WORKSPACES.get() {
        if let Ok(mut entries) = workspaces.lock() {
            for entry in entries.values_mut() {
                entry.dirty_since_ms = Some(
                    entry
                        .dirty_since_ms
                        .map(|dirty_since| dirty_since.min(now))
                        .unwrap_or(now),
                );
                entry.all_dirty_seen_ms = now;
            }
        }
    }
}

fn agent_chat_session_history_source_fingerprint_for_path(
    path: &Path,
) -> Option<AgentChatSessionHistorySourceFingerprint> {
    let metadata = fs::metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    Some(AgentChatSessionHistorySourceFingerprint {
        source_path: path.to_string_lossy().to_string(),
        modified_ms,
        len: metadata.len(),
    })
}

fn agent_chat_session_sync_provider(agent_id: &str) -> Option<&'static str> {
    match agent_id.trim().to_ascii_lowercase().as_str() {
        "codex" | "openai" => Some("codex"),
        "claude" | "claude-code" | "claude_code" => Some("claude"),
        "opencode" | "open-code" | "open_code" => Some("opencode"),
        _ => None,
    }
}

fn agent_chat_session_sync_provider_enum(provider: &str) -> Option<AgentProvider> {
    match provider {
        "codex" => Some(AgentProvider::Codex),
        "claude" => Some(AgentProvider::Claude),
        "opencode" => Some(AgentProvider::OpenCode),
        _ => None,
    }
}

fn agent_chat_session_sync_hash(seed: &Value) -> String {
    let digest = Sha256::digest(seed.to_string().as_bytes());
    format!("{digest:x}")
}

fn agent_chat_session_sync_text_hash(seed: &str) -> String {
    let digest = Sha256::digest(seed.as_bytes());
    format!("{digest:x}")
}

fn agent_chat_session_sync_acked_record_hashes(
    scope_key: &str,
    device_id: &str,
    workspace_id: &str,
    provider: &str,
    session_id: &str,
) -> HashMap<String, String> {
    let Ok(conn) = cloud_mcp_open_outbox_conn() else {
        return HashMap::new();
    };
    let Ok(mut statement) = conn.prepare(&format!(
        "SELECT record_key, record_hash
         FROM {CLOUD_MCP_AGENT_CHAT_RECORD_SYNC_STATE_TABLE}
         WHERE scope_key=?1 AND device_id=?2 AND workspace_id=?3 AND provider=?4 AND session_id=?5
           AND acked_at_ms>0"
    )) else {
        return HashMap::new();
    };
    let Ok(rows) = statement.query_map(
        rusqlite::params![scope_key, device_id, workspace_id, provider, session_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    ) else {
        return HashMap::new();
    };
    let mut hashes = HashMap::new();
    for row in rows.flatten() {
        hashes.insert(row.0, row.1);
    }
    hashes
}

fn agent_chat_session_sync_acked_session_metadata_hash(
    scope_key: &str,
    device_id: &str,
    workspace_id: &str,
    provider: &str,
    session_id: &str,
) -> Option<String> {
    let conn = cloud_mcp_open_outbox_conn().ok()?;
    conn.query_row(
        &format!(
            "SELECT COALESCE(NULLIF(metadata_hash, ''), content_hash)
             FROM {CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_STATE_TABLE}
             WHERE scope_key=?1 AND device_id=?2 AND workspace_id=?3 AND provider=?4 AND session_id=?5
               AND acked_at_ms>0
             LIMIT 1"
        ),
        rusqlite::params![scope_key, device_id, workspace_id, provider, session_id],
        |row| row.get::<_, String>(0),
    )
    .ok()
    .filter(|value| !value.trim().is_empty())
}

fn agent_chat_session_sync_record_is_changed(
    acked: &HashMap<String, String>,
    record_key: &str,
    record_hash: &str,
) -> bool {
    acked
        .get(record_key)
        .map(|acked_hash| acked_hash != record_hash)
        .unwrap_or(true)
}

fn agent_chat_session_sync_value_has_content(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::String(text) => !text.trim().is_empty(),
        Value::Array(items) => items.iter().any(agent_chat_session_sync_value_has_content),
        Value::Object(object) => object
            .values()
            .any(agent_chat_session_sync_value_has_content),
        _ => true,
    }
}

fn agent_chat_session_sync_error_text_marker(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();
    !value.is_empty()
        && (value.contains("error")
            || value.contains("failed")
            || value.contains("failure")
            || value.contains("denied"))
}

fn agent_chat_session_sync_message_error_evidence(message: &Value) -> bool {
    if cloud_mcp_payload_bool(message, &["is_error", "isError"], false) {
        return true;
    }
    if message
        .get("tool")
        .and_then(|tool| cloud_mcp_payload_text(tool, &["status"]))
        .is_some_and(|status| status.trim().eq_ignore_ascii_case("failed"))
    {
        return true;
    }
    if ["error", "tool_error", "toolError", "stderr"]
        .iter()
        .any(|key| {
            message
                .get(*key)
                .is_some_and(agent_chat_session_sync_value_has_content)
        })
    {
        return true;
    }
    let kind = agent_chat_session_sync_message_kind(message);
    if !matches!(kind.as_str(), "tool_output" | "tool_error") {
        return false;
    }
    cloud_mcp_payload_text(message, &["title"])
        .is_some_and(|title| agent_chat_session_sync_error_text_marker(&title))
}

fn agent_chat_session_sync_insert_aliases(object: &mut serde_json::Map<String, Value>) {
    for (camel, snake) in [
        ("createdAt", "created_at"),
        ("callId", "call_id"),
        ("legacyKind", "legacy_kind"),
        ("toolOutput", "tool_output"),
        ("toolError", "tool_error"),
        ("fileChange", "file_change"),
    ] {
        if let Some(value) = object.get(camel).cloned() {
            object.entry(snake.to_string()).or_insert(value);
        } else if let Some(value) = object.get(snake).cloned() {
            object.entry(camel.to_string()).or_insert(value);
        }
    }
}

fn agent_chat_session_sync_normalize_artifact_aliases(value: &mut Value) {
    let Some(artifacts) = value.get_mut("artifacts").and_then(Value::as_array_mut) else {
        return;
    };
    for artifact in artifacts {
        let Some(object) = artifact.as_object_mut() else {
            continue;
        };
        let mime = object
            .get("mimeType")
            .or_else(|| object.get("mime_type"))
            .or_else(|| object.get("mime"))
            .cloned();
        if let Some(mime) = mime {
            object.entry("mimeType".to_string()).or_insert(mime.clone());
            object
                .entry("mime_type".to_string())
                .or_insert(mime.clone());
            object.entry("mime".to_string()).or_insert(mime);
        }
    }
}

fn agent_chat_session_sync_tool_status(message: &Value) -> String {
    message
        .get("tool")
        .and_then(|tool| cloud_mcp_payload_text(tool, &["status"]))
        .unwrap_or_default()
}

fn agent_chat_session_sync_subagent_is_genuine(message: &Value) -> bool {
    let legacy_kind = cloud_mcp_payload_text(message, &["legacyKind", "legacy_kind"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    let kind = agent_chat_session_sync_message_kind(message);
    if legacy_kind == "subagent" || kind == "subagent" {
        return true;
    }
    let Some(subagent) = message.get("subagent") else {
        return false;
    };
    subagent
        .get("isSidechain")
        .or_else(|| subagent.get("is_sidechain"))
        .and_then(Value::as_bool)
        .unwrap_or(false)
        || cloud_mcp_payload_text(
            subagent,
            &[
                "parentUuid",
                "parent_uuid",
                "parentId",
                "parent_id",
                "sidechainId",
                "sidechain_id",
                "sidechainUuid",
                "sidechain_uuid",
            ],
        )
        .is_some_and(|value| !value.trim().is_empty())
}

fn agent_chat_session_sync_canonical_kind(message: &Value, legacy_kind: &str) -> String {
    if message
        .get("file_change")
        .or_else(|| message.get("fileChange"))
        .is_some()
    {
        return "file_change".to_string();
    }
    if message.get("subagent").is_some() && agent_chat_session_sync_subagent_is_genuine(message) {
        return "subagent".to_string();
    }
    if message.get("tool").is_some()
        || matches!(
            legacy_kind,
            "tool_call" | "tool_output" | "tool_error" | "web" | "image_generation"
        )
    {
        return "tool_call".to_string();
    }
    match legacy_kind {
        "reasoning" | "error" | "usage_report" | "system_note" => legacy_kind.to_string(),
        "patch" | "file" => "file_change".to_string(),
        "subagent" => "subagent".to_string(),
        _ => match agent_chat_session_sync_message_role(message).as_str() {
            "user" => "user_message".to_string(),
            "assistant" => "assistant_message".to_string(),
            "system" => "system_note".to_string(),
            _ => "system_note".to_string(),
        },
    }
}

fn agent_chat_session_sync_ensure_tool_value(
    object: &mut serde_json::Map<String, Value>,
    legacy_kind: &str,
) {
    let has_tool = object
        .get("tool")
        .is_some_and(agent_chat_session_sync_value_has_content);
    if has_tool
        || !matches!(
            legacy_kind,
            "tool_call" | "tool_output" | "tool_error" | "web" | "image_generation"
        )
    {
        return;
    }
    let mut tool = serde_json::Map::new();
    if let Some(call_id) = object
        .get("call_id")
        .or_else(|| object.get("callId"))
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        tool.insert("call_id".to_string(), json!(call_id));
    }
    if let Some(title) = object
        .get("title")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        tool.insert("title".to_string(), json!(title));
    }
    let status = if agent_chat_session_sync_message_error_evidence(&Value::Object(object.clone())) {
        "failed"
    } else if matches!(legacy_kind, "tool_output" | "image_generation") {
        "completed"
    } else {
        "running"
    };
    tool.insert("status".to_string(), json!(status));
    if matches!(legacy_kind, "tool_output" | "tool_error") {
        if let Some(text) = object
            .get("text")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
        {
            tool.insert("output".to_string(), json!(text));
        }
    } else if let Some(text) = object
        .get("text")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
    {
        tool.insert("input".to_string(), json!(text));
    }
    object.insert("tool".to_string(), Value::Object(tool));
}

fn agent_chat_session_sync_normalize_message_value(mut value: Value) -> Value {
    let legacy_kind = agent_chat_session_sync_message_kind(&value);
    if let Some(object) = value.as_object_mut() {
        agent_chat_session_sync_insert_aliases(object);
        if object
            .get("truncated")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || object
                .get("text")
                .and_then(Value::as_str)
                .is_some_and(|text| text.trim_end().ends_with("[truncated]"))
        {
            object.insert("truncated".to_string(), json!(true));
        }
        agent_chat_session_sync_ensure_tool_value(object, &legacy_kind);
        if let Some(tool) = object.get("tool").and_then(Value::as_object) {
            let output = tool.get("output").cloned();
            let status = tool
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            if let Some(output) = output.filter(agent_chat_session_sync_value_has_content) {
                if status == "failed" {
                    object
                        .entry("toolError".to_string())
                        .or_insert(output.clone());
                    object.entry("tool_error".to_string()).or_insert(output);
                } else {
                    object
                        .entry("toolOutput".to_string())
                        .or_insert(output.clone());
                    object.entry("tool_output".to_string()).or_insert(output);
                }
            }
        }
    }
    agent_chat_session_sync_normalize_artifact_aliases(&mut value);
    if agent_chat_session_sync_message_status(&value) == "error" {
        let kind = agent_chat_session_sync_message_kind(&value);
        let text = cloud_mcp_payload_text(&value, &["text"]).unwrap_or_default();
        if let Some(object) = value.as_object_mut() {
            object.insert("status".to_string(), json!("error"));
            if kind == "tool_output"
                && !object
                    .get("toolError")
                    .or_else(|| object.get("tool_error"))
                    .is_some_and(agent_chat_session_sync_value_has_content)
                && !text.trim().is_empty()
            {
                object.insert("toolError".to_string(), json!(text.clone()));
                object.insert("tool_error".to_string(), json!(text));
            }
        }
    }
    let legacy_kind = agent_chat_session_sync_message_kind(&value);
    let canonical_kind = agent_chat_session_sync_canonical_kind(&value, &legacy_kind);
    if let Some(object) = value.as_object_mut() {
        if canonical_kind != legacy_kind {
            object
                .entry("legacyKind".to_string())
                .or_insert_with(|| json!(legacy_kind.clone()));
            object
                .entry("legacy_kind".to_string())
                .or_insert_with(|| json!(legacy_kind.clone()));
        }
        object.insert("kind".to_string(), json!(canonical_kind));
        if let Some(tool) = object.get("tool").and_then(Value::as_object) {
            if let Some(status) = tool
                .get("status")
                .and_then(Value::as_str)
                .map(str::to_string)
            {
                let top_status = if status == "failed" {
                    "error"
                } else if status == "completed" {
                    "completed"
                } else {
                    status.as_str()
                };
                object
                    .entry("status".to_string())
                    .or_insert_with(|| json!(top_status));
            }
        }
    }
    value
}

fn agent_chat_session_sync_message_value(message: CodexThreadTranscriptMessage) -> Value {
    agent_chat_session_sync_normalize_message_value(
        serde_json::to_value(message).unwrap_or_else(|_| json!({})),
    )
}

fn agent_chat_session_sync_messages_value(
    messages: Vec<CodexThreadTranscriptMessage>,
) -> Vec<Value> {
    messages
        .into_iter()
        .map(agent_chat_session_sync_message_value)
        .collect()
}

fn agent_chat_session_sync_message_id(message: &Value, index: usize) -> String {
    cloud_mcp_payload_text(message, &["id", "message_id", "messageId"])
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| format!("message-{index}"))
}

fn agent_chat_session_sync_message_role(message: &Value) -> String {
    cloud_mcp_payload_text(message, &["role"])
        .unwrap_or_else(|| "message".to_string())
        .trim()
        .to_ascii_lowercase()
}

fn agent_chat_session_sync_message_kind(message: &Value) -> String {
    cloud_mcp_payload_text(message, &["kind", "type"])
        .unwrap_or_else(|| "message".to_string())
        .trim()
        .to_ascii_lowercase()
}

fn agent_chat_session_sync_message_turn_id(message: &Value) -> String {
    cloud_mcp_payload_text(message, &["turnId", "turn_id"])
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn agent_chat_session_sync_message_status(message: &Value) -> String {
    let status = cloud_mcp_payload_text(message, &["status"]).unwrap_or_default();
    if status.trim().eq_ignore_ascii_case("error")
        || agent_chat_session_sync_message_error_evidence(message)
    {
        return "error".to_string();
    }
    if !status.trim().is_empty() {
        return status.trim().to_ascii_lowercase();
    }
    let tool_status = agent_chat_session_sync_tool_status(message);
    if tool_status == "failed" {
        return "error".to_string();
    }
    if tool_status == "running" {
        return "running".to_string();
    }
    if tool_status == "completed" {
        return "complete".to_string();
    }
    let kind = agent_chat_session_sync_message_kind(message);
    if matches!(kind.as_str(), "error" | "tool_error") {
        "error".to_string()
    } else if matches!(
        kind.as_str(),
        "tool_call"
            | "tool_output"
            | "patch"
            | "file"
            | "file_change"
            | "subagent"
            | "reasoning"
            | "usage_report"
            | "system_note"
    ) {
        "complete".to_string()
    } else {
        String::new()
    }
}

fn agent_chat_session_sync_group_status(messages: &[Value]) -> String {
    if messages
        .iter()
        .any(|message| agent_chat_session_sync_message_status(message) == "error")
    {
        return "error".to_string();
    }
    if messages
        .iter()
        .any(|message| agent_chat_session_sync_message_status(message) == "running")
    {
        return "running".to_string();
    }
    "complete".to_string()
}

fn agent_chat_session_sync_group_title(messages: &[Value]) -> String {
    if messages.len() == 1 {
        return cloud_mcp_payload_text(&messages[0], &["title"])
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "Activity".to_string());
    }
    format!("{} activities", messages.len())
}

fn agent_chat_session_sync_flush_activity_group(items: &mut Vec<Value>, group: &mut Vec<Value>) {
    if group.is_empty() {
        return;
    }
    let first_id = agent_chat_session_sync_message_id(&group[0], items.len());
    let last_id =
        agent_chat_session_sync_message_id(group.last().unwrap_or(&group[0]), items.len());
    let mut turn_id = agent_chat_session_sync_message_turn_id(&group[0]);
    if turn_id.trim().is_empty() {
        turn_id = agent_chat_session_sync_message_turn_id(group.last().unwrap_or(&group[0]));
    }
    let title = agent_chat_session_sync_group_title(group);
    let status = agent_chat_session_sync_group_status(group);
    let messages = std::mem::take(group);
    items.push(json!({
        "id": format!("activity-group-{first_id}-{last_id}"),
        "type": "activity-group",
        "itemType": "activityGroup",
        "title": title,
        "status": status,
        "turnId": turn_id.as_str(),
        "turn_id": turn_id.as_str(),
        "messages": messages,
    }));
}

fn agent_chat_session_sync_flush_assistant_block(
    items: &mut Vec<Value>,
    block_id: &mut String,
    block_turn_id: &mut String,
    block_items: &mut Vec<Value>,
    activity_group: &mut Vec<Value>,
) {
    agent_chat_session_sync_flush_activity_group(block_items, activity_group);
    if block_items.is_empty() {
        block_id.clear();
        block_turn_id.clear();
        return;
    }
    let id = if block_id.trim().is_empty() {
        format!("assistant-block-{}", items.len())
    } else {
        block_id.clone()
    };
    let turn_id = block_turn_id.clone();
    let child_items = std::mem::take(block_items);
    items.push(json!({
        "id": id,
        "type": "assistant-block",
        "itemType": "assistantBlock",
        "turnId": turn_id.as_str(),
        "turn_id": turn_id.as_str(),
        "items": child_items,
    }));
    block_id.clear();
    block_turn_id.clear();
}

fn agent_chat_session_sync_thread_detail_legacy_kind(message: &Value) -> String {
    if let Some(kind) = cloud_mcp_payload_text(message, &["legacyKind", "legacy_kind"])
        .filter(|value| !value.trim().is_empty())
    {
        return kind;
    }
    let kind = agent_chat_session_sync_message_kind(message);
    match kind.as_str() {
        "user_message" | "assistant_message" => "message".to_string(),
        "tool_call" => {
            let tool_status = agent_chat_session_sync_tool_status(message);
            if tool_status == "completed" || tool_status == "failed" {
                "tool_output".to_string()
            } else {
                "tool_call".to_string()
            }
        }
        "file_change" => "patch".to_string(),
        "system_note" => "activity".to_string(),
        _ => kind,
    }
}

fn agent_chat_session_sync_thread_detail_message(message: &Value) -> Value {
    let mut message = message.clone();
    let canonical_kind = agent_chat_session_sync_message_kind(&message);
    let legacy_kind = agent_chat_session_sync_thread_detail_legacy_kind(&message);
    if let Some(object) = message.as_object_mut() {
        object.insert("canonicalKind".to_string(), json!(canonical_kind.clone()));
        object.insert("canonical_kind".to_string(), json!(canonical_kind));
        object.insert("kind".to_string(), json!(legacy_kind));
    }
    message
}

fn agent_chat_session_sync_file_change_value(message: &Value) -> Option<&Value> {
    message
        .get("file_change")
        .or_else(|| message.get("fileChange"))
        .filter(|value| value.is_object())
}

fn agent_chat_session_sync_thread_detail_diff_summaries(
    messages: &[Value],
) -> (Vec<Value>, usize, i64, i64) {
    let mut summaries = Vec::new();
    let mut total_files = 0usize;
    let mut total_additions = 0i64;
    let mut total_deletions = 0i64;
    for (index, message) in messages.iter().enumerate() {
        let Some(file_change) = agent_chat_session_sync_file_change_value(message) else {
            continue;
        };
        let files = file_change
            .get("files")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let additions = files
            .iter()
            .filter_map(|file| file.get("additions").and_then(Value::as_i64))
            .sum::<i64>();
        let deletions = files
            .iter()
            .filter_map(|file| file.get("deletions").and_then(Value::as_i64))
            .sum::<i64>();
        total_files = total_files.saturating_add(files.len());
        total_additions = total_additions.saturating_add(additions);
        total_deletions = total_deletions.saturating_add(deletions);
        let message_id = agent_chat_session_sync_message_id(message, index);
        let turn_id = agent_chat_session_sync_message_turn_id(message);
        let summary = cloud_mcp_payload_text(file_change, &["summary"]).unwrap_or_default();
        summaries.push(json!({
            "id": format!("diff-summary-{message_id}"),
            "messageId": message_id.as_str(),
            "message_id": message_id.as_str(),
            "turnId": turn_id.as_str(),
            "turn_id": turn_id.as_str(),
            "summary": summary,
            "files": files,
            "fileCount": files.len(),
            "file_count": files.len(),
            "additions": additions,
            "deletions": deletions,
        }));
    }
    (summaries, total_files, total_additions, total_deletions)
}

fn agent_chat_session_sync_thread_detail(
    source: &AgentChatSessionSyncSource,
    context: &AgentChatSessionSyncContext,
    model_id: &str,
    model_config: &Value,
) -> Value {
    let thread_detail_messages = source
        .thread_detail_messages
        .iter()
        .map(agent_chat_session_sync_thread_detail_message)
        .collect::<Vec<_>>();
    let (diff_summaries, file_count, additions, deletions) =
        agent_chat_session_sync_thread_detail_diff_summaries(&source.thread_detail_messages);
    let mut items = Vec::new();
    let mut activity_group = Vec::new();
    let mut assistant_block_id = String::new();
    let mut assistant_block_turn_id = String::new();
    let mut assistant_block_items = Vec::new();
    let mut user_count = 0usize;
    let mut assistant_count = 0usize;
    let mut activity_count = 0usize;
    let mut artifact_count = 0usize;

    for (index, message) in thread_detail_messages.iter().enumerate() {
        let role = agent_chat_session_sync_message_role(message);
        let message_id = agent_chat_session_sync_message_id(message, index);
        let turn_id = agent_chat_session_sync_message_turn_id(message);
        let artifacts = message
            .get("artifacts")
            .and_then(Value::as_array)
            .map(Vec::len)
            .unwrap_or(0);
        artifact_count = artifact_count.saturating_add(artifacts);
        if role == "activity" || role == "assistant" {
            if !assistant_block_turn_id.is_empty()
                && !turn_id.is_empty()
                && assistant_block_turn_id != turn_id
            {
                agent_chat_session_sync_flush_assistant_block(
                    &mut items,
                    &mut assistant_block_id,
                    &mut assistant_block_turn_id,
                    &mut assistant_block_items,
                    &mut activity_group,
                );
            }
            if assistant_block_id.trim().is_empty() {
                assistant_block_id = format!("assistant-block-{message_id}");
            }
            if assistant_block_turn_id.trim().is_empty() && !turn_id.is_empty() {
                assistant_block_turn_id = turn_id.clone();
            }
        }
        if role == "activity" {
            activity_count = activity_count.saturating_add(1);
            activity_group.push(message.clone());
            continue;
        }

        if role == "assistant" {
            agent_chat_session_sync_flush_activity_group(
                &mut assistant_block_items,
                &mut activity_group,
            );
            assistant_count = assistant_count.saturating_add(1);
            assistant_block_items.push(json!({
                "id": message_id.as_str(),
                "type": "message",
                "itemType": "message",
                "role": role.as_str(),
                "turnId": turn_id.as_str(),
                "turn_id": turn_id.as_str(),
                "message": message,
            }));
            continue;
        }

        agent_chat_session_sync_flush_assistant_block(
            &mut items,
            &mut assistant_block_id,
            &mut assistant_block_turn_id,
            &mut assistant_block_items,
            &mut activity_group,
        );
        if role == "user" {
            user_count = user_count.saturating_add(1);
        }
        items.push(json!({
            "id": message_id.as_str(),
            "type": "message",
            "itemType": "message",
            "role": role.as_str(),
            "turnId": turn_id.as_str(),
            "turn_id": turn_id.as_str(),
            "message": message,
        }));
    }
    agent_chat_session_sync_flush_assistant_block(
        &mut items,
        &mut assistant_block_id,
        &mut assistant_block_turn_id,
        &mut assistant_block_items,
        &mut activity_group,
    );

    json!({
        "contract": "diffforge.thread_detail_view.v1",
        "schemaVersion": 1,
        "schema_version": 1,
        "provider": source.provider.as_str(),
        "sessionId": source.session_id.as_str(),
        "session_id": source.session_id.as_str(),
        "providerSessionId": source.session_id.as_str(),
        "provider_session_id": source.session_id.as_str(),
        "title": source.title.as_str(),
        "cwd": source.cwd.as_str(),
        "workspaceId": context.workspace_id.as_str(),
        "workspace_id": context.workspace_id.as_str(),
        "workspaceName": context.workspace_name.as_str(),
        "workspace_name": context.workspace_name.as_str(),
        "threadId": context.thread_id.as_str(),
        "thread_id": context.thread_id.as_str(),
        "paneId": context.pane_id.as_str(),
        "pane_id": context.pane_id.as_str(),
        "modelId": model_id,
        "model_id": model_id,
        "modelConfig": model_config,
        "model_config": model_config,
        "latestTimestamp": source.latest_timestamp.as_str(),
        "latest_timestamp": source.latest_timestamp.as_str(),
        "messages": thread_detail_messages.clone(),
        "items": items,
        "diffSummaries": diff_summaries.clone(),
        "diff_summaries": diff_summaries,
        "stats": {
            "messageCount": thread_detail_messages.len(),
            "message_count": thread_detail_messages.len(),
            "userCount": user_count,
            "user_count": user_count,
            "assistantCount": assistant_count,
            "assistant_count": assistant_count,
            "activityCount": activity_count,
            "activity_count": activity_count,
            "artifactCount": artifact_count,
            "artifact_count": artifact_count,
            "fileCount": file_count,
            "file_count": file_count,
            "additions": additions,
            "deletions": deletions,
        },
    })
}

fn agent_chat_session_sync_find_text_deep(value: &Value, keys: &[&str], depth: usize) -> String {
    if depth > 5 {
        return String::new();
    }
    if let Some(text) = cloud_mcp_payload_text(value, keys) {
        return text;
    }
    match value {
        Value::Array(items) => {
            for item in items {
                let text = agent_chat_session_sync_find_text_deep(item, keys, depth + 1);
                if !text.is_empty() {
                    return text;
                }
            }
        }
        Value::Object(object) => {
            for child in object.values() {
                let text = agent_chat_session_sync_find_text_deep(child, keys, depth + 1);
                if !text.is_empty() {
                    return text;
                }
            }
        }
        _ => {}
    }
    String::new()
}

fn agent_chat_session_sync_model_config_from_raw(value: &Value) -> Value {
    let model_id = agent_chat_session_sync_find_text_deep(
        value,
        &[
            "model_id",
            "modelId",
            "model",
            "modelID",
            "provider_model_id",
            "providerModelId",
        ],
        0,
    );
    let model_source = agent_chat_session_sync_find_text_deep(
        value,
        &["model_source", "modelSource", "providerID", "provider_id"],
        0,
    );
    let reasoning_effort = agent_chat_session_sync_find_text_deep(
        value,
        &[
            "reasoning_effort",
            "reasoningEffort",
            "model_reasoning_effort",
            "effort",
        ],
        0,
    );
    let service_tier =
        agent_chat_session_sync_find_text_deep(value, &["service_tier", "serviceTier", "tier"], 0);
    let speed_mode = {
        let explicit =
            agent_chat_session_sync_find_text_deep(value, &["speed_mode", "speedMode", "speed"], 0);
        if !explicit.is_empty() {
            explicit
        } else if service_tier.eq_ignore_ascii_case("fast") {
            "fast".to_string()
        } else if cloud_mcp_payload_bool(value, &["xfast", "xFast", "fastMode", "fast_mode"], false)
        {
            "xfast".to_string()
        } else {
            String::new()
        }
    };
    json!({
        "modelId": model_id,
        "model_id": model_id,
        "modelSource": model_source,
        "model_source": model_source,
        "reasoningEffort": reasoning_effort,
        "reasoning_effort": reasoning_effort,
        "serviceTier": service_tier,
        "service_tier": service_tier,
        "speedMode": speed_mode,
        "speed_mode": speed_mode,
    })
}

fn agent_chat_session_sync_merge_model_config(current: &mut Value, candidate: Value) {
    let Some(current_object) = current.as_object_mut() else {
        *current = candidate;
        return;
    };
    let Some(candidate_object) = candidate.as_object() else {
        return;
    };
    for (key, value) in candidate_object {
        let is_present = match value {
            Value::String(text) => !text.trim().is_empty(),
            Value::Null => false,
            _ => true,
        };
        if is_present {
            current_object.insert(key.clone(), value.clone());
        }
    }
}

fn agent_chat_session_sync_latest_model_id(model_config: &Value, fallback: &str) -> String {
    cloud_mcp_payload_text(model_config, &["model_id", "modelId"])
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| fallback.trim().to_string())
}

fn agent_chat_session_sync_model_config_fingerprint(model_config: &Value) -> String {
    let model_id =
        cloud_mcp_payload_text(model_config, &["model_id", "modelId"]).unwrap_or_default();
    let reasoning_effort = cloud_mcp_payload_text(
        model_config,
        &["reasoning_effort", "reasoningEffort", "effort"],
    )
    .unwrap_or_default();
    if model_id.trim().is_empty() && reasoning_effort.trim().is_empty() {
        return String::new();
    }
    format!(
        "{}::{}",
        model_id.trim(),
        reasoning_effort.trim().to_ascii_lowercase()
    )
}

fn agent_chat_session_sync_model_config_record(
    acked: &HashMap<String, String>,
    provider: &str,
    session_id: &str,
    line_index: usize,
    start_offset: u64,
    timestamp: &str,
    model_config: &Value,
) -> Option<Value> {
    let model_id = cloud_mcp_payload_text(model_config, &["model_id", "modelId"]);
    let reasoning_effort = cloud_mcp_payload_text(
        model_config,
        &["reasoning_effort", "reasoningEffort", "effort"],
    )
    .map(|value| value.to_ascii_lowercase());
    if model_id.as_deref().unwrap_or_default().trim().is_empty()
        && reasoning_effort
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
    {
        return None;
    }
    let record_key = format!(
        "{provider}:{session_id}:model_config:{line_index}:{start_offset}:{}",
        agent_chat_session_sync_hash(&json!({
            "model_id": model_id.as_deref().unwrap_or(""),
            "reasoning_effort": reasoning_effort.as_deref().unwrap_or(""),
        }))
    );
    let timestamp = if timestamp.trim().is_empty() {
        chrono_like_now_iso()
    } else {
        timestamp.to_string()
    };
    let raw = json!({
        "model_id": model_id.clone(),
        "modelId": model_id.clone(),
        "reasoning_effort": reasoning_effort.clone(),
        "reasoningEffort": reasoning_effort.clone(),
        "origin": "local",
    });
    let mut record = agent_chat_session_sync_record(
        acked,
        provider,
        session_id,
        record_key,
        "model_config",
        json!({
            "lineIndex": line_index,
            "line_index": line_index,
            "startOffset": start_offset,
            "start_offset": start_offset,
        }),
        timestamp,
        raw,
        Vec::new(),
    )?;
    record["model_id"] = model_id.clone().map(Value::from).unwrap_or(Value::Null);
    record["modelId"] = model_id.map(Value::from).unwrap_or(Value::Null);
    record["reasoning_effort"] = reasoning_effort
        .clone()
        .map(Value::from)
        .unwrap_or(Value::Null);
    record["reasoningEffort"] = reasoning_effort.map(Value::from).unwrap_or(Value::Null);
    record["origin"] = json!("local");
    Some(record)
}

fn agent_chat_session_sync_messages_json_bytes(messages: &[Value]) -> usize {
    serde_json::to_vec(messages)
        .map(|bytes| bytes.len())
        .unwrap_or(0)
}

fn agent_chat_session_sync_largest_string_field(
    messages: &[Value],
) -> Option<(usize, &'static str, usize)> {
    let mut largest: Option<(usize, &'static str, usize)> = None;
    for (index, message) in messages.iter().enumerate() {
        for path in [
            "/text",
            "/tool/input",
            "/tool/output",
            "/file_change/summary",
            "/fileChange/summary",
        ] {
            let Some(text) = message.pointer(path).and_then(Value::as_str) else {
                continue;
            };
            let len = text.chars().count();
            if len > largest.map(|(_, _, current)| current).unwrap_or(0) {
                largest = Some((index, path, len));
            }
        }
    }
    largest
}

fn agent_chat_session_sync_largest_structured_tool_field(
    messages: &[Value],
) -> Option<(usize, &'static str, usize)> {
    let mut largest: Option<(usize, &'static str, usize)> = None;
    for (index, message) in messages.iter().enumerate() {
        for path in ["/tool/input", "/tool/output"] {
            let Some(value) = message.pointer(path) else {
                continue;
            };
            if !matches!(value, Value::Array(_) | Value::Object(_)) {
                continue;
            }
            let len = value.to_string().len();
            if len > largest.map(|(_, _, current)| current).unwrap_or(0) {
                largest = Some((index, path, len));
            }
        }
    }
    largest
}

fn agent_chat_session_sync_mark_message_truncated(message: &mut Value) {
    if let Some(object) = message.as_object_mut() {
        object.insert("truncated".to_string(), json!(true));
    }
}

fn agent_chat_session_sync_truncate_string_field(
    messages: &mut [Value],
    index: usize,
    path: &str,
    target_chars: usize,
) -> bool {
    let Some(message) = messages.get_mut(index) else {
        return false;
    };
    let Some(value) = message.pointer_mut(path) else {
        return false;
    };
    let Some(text) = value.as_str() else {
        return false;
    };
    let mut truncated = truncate_chars(text, target_chars.max(256));
    truncated = truncated.trim().to_string();
    append_transcript_truncation_marker(&mut truncated);
    *value = json!(truncated);
    agent_chat_session_sync_mark_message_truncated(message);
    true
}

fn agent_chat_session_sync_replace_structured_field(
    messages: &mut [Value],
    index: usize,
    path: &str,
) -> bool {
    let Some(message) = messages.get_mut(index) else {
        return false;
    };
    let Some(value) = message.pointer_mut(path) else {
        return false;
    };
    if !matches!(value, Value::Array(_) | Value::Object(_)) {
        return false;
    }
    *value = json!("[truncated structured JSON]");
    agent_chat_session_sync_mark_message_truncated(message);
    true
}

fn agent_chat_session_sync_guard_record_messages(mut messages: Vec<Value>) -> Vec<Value> {
    let mut iterations = 0usize;
    while agent_chat_session_sync_messages_json_bytes(&messages)
        > CODEX_TRANSCRIPT_MAX_RECORD_MESSAGES_BYTES
        && iterations < 48
    {
        iterations = iterations.saturating_add(1);
        if let Some((index, path, len)) = agent_chat_session_sync_largest_string_field(&messages) {
            if len > 512 {
                let target = (len / 2).max(256);
                if agent_chat_session_sync_truncate_string_field(&mut messages, index, path, target)
                {
                    continue;
                }
            }
        }
        if let Some((index, path, _)) =
            agent_chat_session_sync_largest_structured_tool_field(&messages)
        {
            if agent_chat_session_sync_replace_structured_field(&mut messages, index, path) {
                continue;
            }
        }
        break;
    }
    messages
}

fn agent_chat_session_sync_record(
    acked: &HashMap<String, String>,
    provider: &str,
    session_id: &str,
    record_key: String,
    record_kind: &str,
    source_cursor: Value,
    timestamp: String,
    raw: Value,
    normalized_messages: Vec<Value>,
) -> Option<Value> {
    let normalized_messages = agent_chat_session_sync_guard_record_messages(normalized_messages);
    let record_hash = agent_chat_session_sync_hash(&json!({
                "provider": provider,
        "parser_schema_version": AGENT_CHAT_SESSION_SYNC_RECORD_HASH_SCHEMA_VERSION,
                "session_id": session_id,
                "record_key": record_key.clone(),
            "record_kind": record_kind,
            "raw": raw.clone(),
    }));
    if !agent_chat_session_sync_record_is_changed(acked, &record_key, &record_hash) {
        return None;
    }
    Some(json!({
        "recordKey": record_key,
        "record_key": record_key,
        "recordHash": record_hash,
        "record_hash": record_hash,
            "recordKind": record_kind,
            "record_kind": record_kind,
        "parserSchemaVersion": AGENT_CHAT_SESSION_SYNC_PARSER_SCHEMA_VERSION,
        "parser_schema_version": AGENT_CHAT_SESSION_SYNC_PARSER_SCHEMA_VERSION,
            "sourceCursor": source_cursor,
        "source_cursor": source_cursor,
        "timestamp": timestamp,
        "createdAt": timestamp,
        "created_at": timestamp,
        "raw": raw,
        "messages": normalized_messages,
    }))
}

fn agent_chat_session_sync_codex_messages_for_line(
    line_index: usize,
    timestamp: &str,
    value: &Value,
) -> Vec<CodexThreadTranscriptMessage> {
    let record_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let payload = value.get("payload").unwrap_or(&Value::Null);
    match record_type {
        "event_msg" => codex_messages_from_event(line_index, timestamp, payload),
        "response_item" => codex_messages_from_response_item(line_index, timestamp, payload),
        _ => Vec::new(),
    }
}

fn agent_chat_session_sync_claude_messages_for_line(
    line_index: usize,
    timestamp: &str,
    value: &Value,
) -> Vec<CodexThreadTranscriptMessage> {
    let mut messages = Vec::<CodexThreadTranscriptMessage>::new();
    let entry_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
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
            messages.push(transcript_error_message(
                format!("claude-{line_index}-result-error"),
                "claude",
                timestamp,
                if result_text.trim().is_empty() {
                    "Claude Code turn failed"
                } else {
                    result_text.as_str()
                },
            ));
        } else {
            let (assistant_text, assistant_truncated) = clean_codex_transcript_text_with_truncation(
                &result_text,
                CODEX_TRANSCRIPT_MAX_TEXT,
            );
            if !assistant_text.is_empty() {
                messages.push(CodexThreadTranscriptMessage {
                    id: format!("claude-{line_index}-result-assistant"),
                    role: "assistant".to_string(),
                    kind: "message".to_string(),
                    text: assistant_text,
                    title: String::new(),
                    call_id: String::new(),
                    created_at: timestamp.to_string(),
                    source: "claude".to_string(),
                    usage: transcript_usage_from_value(value),
                    truncated: assistant_truncated,
                    artifacts: Vec::new(),
                    ..Default::default()
                });
            }
            messages.push(transcript_task_complete_message(
                format!("claude-{line_index}-task-complete"),
                "claude",
                timestamp,
                result_text,
            ));
        }
        return messages;
    }

    let Some(message) = value.get("message") else {
        return Vec::new();
    };
    let content = message.get("content").unwrap_or(&Value::Null);
    let message_role = value_string(message.get("role"));
    if entry_type != "user"
        && entry_type != "assistant"
        && message_role != "user"
        && message_role != "assistant"
    {
        return Vec::new();
    }
    let role = if entry_type == "assistant" || message_role == "assistant" {
        "assistant"
    } else {
        "user"
    };
    let (text, truncated) = clean_codex_transcript_text_with_truncation(
        claude_content_text(content),
        CODEX_TRANSCRIPT_MAX_TEXT,
    );
    if !text.is_empty() {
        messages.push(CodexThreadTranscriptMessage {
            id: format!("claude-{line_index}-{role}"),
            role: role.to_string(),
            kind: "message".to_string(),
            text: text.clone(),
            title: String::new(),
            call_id: String::new(),
            created_at: timestamp.to_string(),
            source: "claude".to_string(),
            subagent: transcript_sidechain_subagent_from_value(value, "Sidechain"),
            usage: transcript_usage_from_value(value),
            truncated,
            artifacts: Vec::new(),
            ..Default::default()
        });
    }
    if let Some(blocks) = content.as_array() {
        for (block_index, block) in blocks.iter().enumerate() {
            if let Some(message) =
                claude_activity_from_block(line_index, block_index, timestamp, block)
            {
                messages.push(message);
            }
        }
    }
    if role == "assistant"
        && claude_stop_reason_completes_turn(&value_string(
            message
                .get("stop_reason")
                .or_else(|| value.get("stop_reason")),
        ))
    {
        messages.push(transcript_task_complete_message(
            format!("claude-{line_index}-task-complete"),
            "claude",
            timestamp,
            text,
        ));
    }
    messages
}

fn agent_chat_session_sync_jsonl_source(
    provider: &str,
    source_kind: &str,
    path: &Path,
    resolved_session_id: &str,
    initial_meta: CodexRolloutMeta,
    acked: &HashMap<String, String>,
) -> Result<AgentChatSessionSyncSource, String> {
    let file = fs::File::open(path).map_err(|error| {
        format!(
            "Unable to open agent chat source {}: {error}",
            path.display()
        )
    })?;
    let mut reader = std::io::BufReader::new(file);
    let mut offset: u64 = 0;
    let mut line_index: usize = 0;
    let mut buffer = Vec::new();
    let mut session_id = clean_codex_id(resolved_session_id);
    if session_id.is_empty() {
        session_id = initial_meta.session_id;
    }
    let mut cwd = initial_meta.cwd;
    let mut title = initial_meta.title;
    let mut latest_timestamp = initial_meta.latest_timestamp;
    let mut records = Vec::new();
    let mut thread_detail_messages = Vec::new();
    let mut total_record_count = 0usize;
    let mut model_config = json!({});
    let mut last_model_config_fingerprint = String::new();
    let mut tool_metadata = HashMap::<String, TranscriptToolCallMetadata>::new();

    loop {
        buffer.clear();
        let bytes_read = std::io::BufRead::read_until(&mut reader, b'\n', &mut buffer)
            .map_err(|error| format!("Unable to read agent chat source: {error}"))?;
        if bytes_read == 0 {
            break;
        }
        let start_offset = offset;
        offset = offset.saturating_add(bytes_read as u64);
        let raw_line = String::from_utf8_lossy(&buffer)
            .trim_end_matches(['\n', '\r'])
            .to_string();
        if raw_line.trim().is_empty() {
            line_index = line_index.saturating_add(1);
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(&raw_line) else {
            line_index = line_index.saturating_add(1);
            continue;
        };
        total_record_count = total_record_count.saturating_add(1);
        let candidate_model_config = agent_chat_session_sync_model_config_from_raw(&value);
        let candidate_model_config_fingerprint =
            agent_chat_session_sync_model_config_fingerprint(&candidate_model_config);
        let should_emit_model_config = !candidate_model_config_fingerprint.is_empty()
            && !last_model_config_fingerprint.is_empty()
            && candidate_model_config_fingerprint != last_model_config_fingerprint;
        agent_chat_session_sync_merge_model_config(
            &mut model_config,
            candidate_model_config.clone(),
        );
        let timestamp = value_string(value.get("timestamp"));
        if !timestamp.is_empty() {
            latest_timestamp = timestamp.clone();
        }
        if provider == "codex" {
            if value.get("type").and_then(Value::as_str) == Some("session_meta") {
                let payload = value.get("payload").unwrap_or(&Value::Null);
                let candidate_session_id = clean_codex_id(value_string(payload.get("id")));
                if !candidate_session_id.is_empty() {
                    session_id = candidate_session_id;
                }
                let candidate_cwd = value_string(payload.get("cwd"));
                if !candidate_cwd.is_empty() {
                    cwd = candidate_cwd;
                }
            }
            if value
                .get("payload")
                .and_then(|payload| payload.get("type"))
                .and_then(Value::as_str)
                == Some("thread_name_updated")
            {
                let candidate_title = clean_codex_title(
                    value_string(
                        value
                            .get("payload")
                            .and_then(|payload| payload.get("thread_name")),
                    ),
                    "",
                );
                if !candidate_title.is_empty() {
                    title = candidate_title;
                }
            }
        } else if provider == "claude" {
            let candidate_session_id = clean_codex_id(value_string(value.get("sessionId")));
            if !candidate_session_id.is_empty() {
                session_id = candidate_session_id;
            }
            let candidate_cwd = value_string(value.get("cwd"));
            if !candidate_cwd.is_empty() {
                cwd = candidate_cwd;
            }
            match value
                .get("type")
                .and_then(Value::as_str)
                .unwrap_or_default()
            {
                "ai-title" => {
                    let candidate = clean_codex_title(value_string(value.get("aiTitle")), "");
                    if !candidate.is_empty() {
                        title = candidate;
                    }
                }
                "summary" => {
                    let candidate = clean_codex_title(value_string(value.get("summary")), "");
                    if !candidate.is_empty() {
                        title = candidate;
                    }
                }
                _ => {}
            }
        }

        let mut parsed_messages = if provider == "claude" {
            agent_chat_session_sync_claude_messages_for_line(line_index, &timestamp, &value)
        } else {
            agent_chat_session_sync_codex_messages_for_line(line_index, &timestamp, &value)
        };
        for message in &mut parsed_messages {
            transcript_apply_tool_call_metadata(&tool_metadata, message);
            transcript_record_tool_call_metadata(&mut tool_metadata, message);
        }
        let normalized_messages = agent_chat_session_sync_messages_value(parsed_messages);
        thread_detail_messages.extend(normalized_messages.iter().cloned());
        let record_kind = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("jsonl")
            .to_string();
        let line_hash = agent_chat_session_sync_text_hash(&raw_line);
        let record_key = format!(
            "{provider}:{session_id}:jsonl:v{AGENT_CHAT_SESSION_SYNC_RECORD_KEY_VERSION}:{line_index}:{start_offset}:{line_hash}"
        );
        if let Some(record) = agent_chat_session_sync_record(
            acked,
            provider,
            &session_id,
            record_key,
            &record_kind,
            json!({
                "lineIndex": line_index,
                "line_index": line_index,
                "startOffset": start_offset,
                "start_offset": start_offset,
                "endOffset": offset,
                "end_offset": offset,
            }),
            timestamp.clone(),
            value,
            normalized_messages,
        ) {
            records.push(record);
        }
        if should_emit_model_config {
            if let Some(record) = agent_chat_session_sync_model_config_record(
                acked,
                provider,
                &session_id,
                line_index,
                start_offset,
                &timestamp,
                &candidate_model_config,
            ) {
                records.push(record);
            }
        }
        if !candidate_model_config_fingerprint.is_empty() {
            last_model_config_fingerprint = candidate_model_config_fingerprint;
        }
        line_index = line_index.saturating_add(1);
    }

    let model_id = agent_chat_session_sync_provider_enum(provider)
        .and_then(|provider| agent_session_last_model(provider, &session_id))
        .unwrap_or_else(|| agent_chat_session_sync_latest_model_id(&model_config, ""));
    Ok(AgentChatSessionSyncSource {
        provider: provider.to_string(),
        source_kind: source_kind.to_string(),
        source_path: path.to_string_lossy().to_string(),
        session_id,
        title,
        cwd,
        latest_timestamp,
        model_id,
        model_config,
        records,
        thread_detail_messages,
        total_record_count,
    })
}

fn agent_chat_session_sync_sqlite_value(value: rusqlite::types::ValueRef<'_>) -> Value {
    match value {
        rusqlite::types::ValueRef::Null => Value::Null,
        rusqlite::types::ValueRef::Integer(value) => json!(value),
        rusqlite::types::ValueRef::Real(value) => json!(value),
        rusqlite::types::ValueRef::Text(value) => {
            Value::String(String::from_utf8_lossy(value).to_string())
        }
        rusqlite::types::ValueRef::Blob(value) => json!({
            "encoding": "base64",
            "data": general_purpose::STANDARD.encode(value),
        }),
    }
}

fn agent_chat_session_sync_opencode_session_raw_row(
    connection: &rusqlite::Connection,
    session_id: &str,
) -> Option<Value> {
    let mut statement = connection
        .prepare("select * from session where id = ?1 limit 1")
        .ok()?;
    let columns = statement
        .column_names()
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    statement
        .query_row(rusqlite::params![session_id], |row| {
            let mut object = serde_json::Map::new();
            for (index, column) in columns.iter().enumerate() {
                object.insert(
                    column.clone(),
                    agent_chat_session_sync_sqlite_value(row.get_ref(index)?),
                );
            }
            Ok(Value::Object(object))
        })
        .ok()
}

fn agent_chat_session_sync_opencode_model_config(model: &str) -> Value {
    let model = model.trim();
    if model.is_empty() {
        return json!({});
    }
    let mut config = json!({});
    if let Ok(value) = serde_json::from_str::<Value>(model) {
        agent_chat_session_sync_merge_model_config(
            &mut config,
            agent_chat_session_sync_model_config_from_raw(&value),
        );
        if let Some(model_id) = opencode_model_from_value(&value) {
            agent_chat_session_sync_merge_model_config(
                &mut config,
                json!({
                    "modelId": model_id.clone(),
                    "model_id": model_id,
                }),
            );
        } else if let Some(model_text) = value
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            agent_chat_session_sync_merge_model_config(
                &mut config,
                json!({
                    "modelId": model_text,
                    "model_id": model_text,
                }),
            );
        }
    } else {
        agent_chat_session_sync_merge_model_config(
            &mut config,
            json!({
                "modelId": model,
                "model_id": model,
            }),
        );
    }
    config
}

fn agent_chat_session_sync_opencode_source(
    session_id: &str,
    title: &str,
    cwd: &str,
    acked: &HashMap<String, String>,
) -> Result<AgentChatSessionSyncSource, String> {
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
    let session_id = clean_codex_id(session_id);
    let mut session_title = clean_codex_title(title, "");
    let mut session_cwd = cwd.to_string();
    let mut session_updated_at_ms = 0i64;
    let mut model_config = json!({});
    if let Ok(mut statement) = connection
        .prepare("select title, directory, time_updated, model from session where id = ?1 limit 1")
    {
        if let Ok(mut rows) = statement.query(rusqlite::params![session_id.as_str()]) {
            if let Ok(Some(row)) = rows.next() {
                let candidate_title =
                    clean_codex_title(row.get::<_, String>(0).unwrap_or_default(), "");
                if !candidate_title.is_empty() {
                    session_title = candidate_title;
                }
                let candidate_cwd = row.get::<_, String>(1).unwrap_or_default();
                if !candidate_cwd.is_empty() {
                    session_cwd = candidate_cwd;
                }
                session_updated_at_ms = row.get::<_, i64>(2).unwrap_or_default();
                let model = row.get::<_, String>(3).unwrap_or_default();
                if !model.trim().is_empty() {
                    agent_chat_session_sync_merge_model_config(
                        &mut model_config,
                        agent_chat_session_sync_opencode_model_config(&model),
                    );
                }
            }
        }
    }

    let mut records = Vec::new();
    let mut thread_detail_messages = Vec::new();
    let mut total_record_count = 0usize;
    let mut latest_timestamp = opencode_timestamp(session_updated_at_ms);
    let session_raw =
        agent_chat_session_sync_opencode_session_raw_row(&connection, &session_id).unwrap_or_else(
            || {
                json!({
                    "id": session_id.clone(),
                    "title": session_title.clone(),
                    "directory": session_cwd.clone(),
                    "time_updated": session_updated_at_ms,
                    "model": cloud_mcp_payload_text(&model_config, &["model_id", "modelId"]).unwrap_or_default(),
                })
            },
        );
    total_record_count = total_record_count.saturating_add(1);
    if let Some(record) = agent_chat_session_sync_record(
        acked,
        "opencode",
        &session_id,
        format!("opencode:{session_id}:session"),
        "session",
        json!({
            "table": "session",
            "id": session_id,
            "timeCreated": session_updated_at_ms,
            "time_created": session_updated_at_ms,
        }),
        latest_timestamp.clone(),
        session_raw,
        Vec::new(),
    ) {
        records.push(record);
    }

    let mut role_by_message = HashMap::<String, String>::new();
    let mut message_statement = connection
        .prepare(
            "select id, time_created, data from message where session_id = ?1 order by time_created, id",
        )
        .map_err(|error| format!("Unable to query OpenCode messages: {error}"))?;
    let message_rows = message_statement
        .query_map(rusqlite::params![session_id.as_str()], |row| {
            Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, i64>(1).unwrap_or_default(),
                row.get::<_, String>(2).unwrap_or_default(),
            ))
        })
        .map_err(|error| format!("Unable to read OpenCode messages: {error}"))?
        .flatten()
        .collect::<Vec<_>>();

    let mut part_statement = connection
        .prepare(
            "select id, message_id, time_created, data from part where session_id = ?1 order by time_created, id",
        )
        .map_err(|error| format!("Unable to query OpenCode parts: {error}"))?;
    let part_rows = part_statement
        .query_map(rusqlite::params![session_id.as_str()], |row| {
            Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, String>(1).unwrap_or_default(),
                row.get::<_, i64>(2).unwrap_or_default(),
                row.get::<_, String>(3).unwrap_or_default(),
            ))
        })
        .map_err(|error| format!("Unable to read OpenCode parts: {error}"))?
        .flatten()
        .collect::<Vec<_>>();
    let message_ids_with_parts = part_rows
        .iter()
        .filter_map(|row| {
            let message_id = row.1.trim();
            (!message_id.is_empty()).then(|| message_id.to_string())
        })
        .collect::<HashSet<_>>();

    for row in message_rows {
        let message_data = serde_json::from_str::<Value>(&row.2).unwrap_or(Value::Null);
        agent_chat_session_sync_merge_model_config(
            &mut model_config,
            agent_chat_session_sync_model_config_from_raw(&message_data),
        );
        let role = opencode_message_role(&message_data);
        role_by_message.insert(row.0.clone(), role.clone());
        let timestamp = opencode_timestamp(row.1);
        if !timestamp.is_empty() {
            latest_timestamp = timestamp.clone();
        }
        let message_text = first_value_string(&[
            message_data.get("text"),
            message_data.get("content"),
            message_data.get("message"),
        ]);
        let normalized_messages =
            if message_text.trim().is_empty() || message_ids_with_parts.contains(row.0.as_str()) {
                Vec::new()
            } else {
                let (message_text, truncated) = clean_codex_transcript_text_with_truncation(
                    message_text,
                    CODEX_TRANSCRIPT_MAX_TEXT,
                );
                agent_chat_session_sync_messages_value(vec![CodexThreadTranscriptMessage {
                    id: format!("opencode-{}-message", row.0),
                    role,
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
                }])
            };
        thread_detail_messages.extend(normalized_messages.iter().cloned());
        total_record_count = total_record_count.saturating_add(1);
        if let Some(record) = agent_chat_session_sync_record(
            acked,
            "opencode",
            &session_id,
            format!("opencode:{session_id}:message:{}", row.0),
            "message",
            json!({
                "table": "message",
                "id": row.0,
                "timeCreated": row.1,
                "time_created": row.1,
            }),
            timestamp,
            json!({
                "id": row.0,
                "session_id": session_id,
                "time_created": row.1,
                "data": message_data,
            }),
            normalized_messages,
        ) {
            records.push(record);
        }
    }

    for row in part_rows {
        let part_data = serde_json::from_str::<Value>(&row.3).unwrap_or(Value::Null);
        agent_chat_session_sync_merge_model_config(
            &mut model_config,
            agent_chat_session_sync_model_config_from_raw(&part_data),
        );
        let timestamp = opencode_timestamp(row.2);
        if !timestamp.is_empty() {
            latest_timestamp = timestamp.clone();
        }
        let Some(role) = role_by_message.get(&row.1).cloned() else {
            continue;
        };
        let normalized_messages = agent_chat_session_sync_messages_value(opencode_part_message(
            &row.1, &role, &row.0, &timestamp, &part_data,
        ));
        thread_detail_messages.extend(normalized_messages.iter().cloned());
        total_record_count = total_record_count.saturating_add(1);
        if let Some(record) = agent_chat_session_sync_record(
            acked,
            "opencode",
            &session_id,
            format!("opencode:{session_id}:part:{}", row.0),
            "part",
            json!({
                "table": "part",
                "id": row.0,
                "messageId": row.1,
                "message_id": row.1,
                "timeCreated": row.2,
                "time_created": row.2,
            }),
            timestamp,
            json!({
                "id": row.0,
                "message_id": row.1,
                "session_id": session_id,
                "time_created": row.2,
                "data": part_data,
            }),
            normalized_messages,
        ) {
            records.push(record);
        }
    }

    let model_id = agent_session_last_model(AgentProvider::OpenCode, &session_id)
        .unwrap_or_else(|| agent_chat_session_sync_latest_model_id(&model_config, ""));
    Ok(AgentChatSessionSyncSource {
        provider: "opencode".to_string(),
        source_kind: "opencode_sqlite".to_string(),
        source_path: db_path.to_string_lossy().to_string(),
        session_id,
        title: session_title,
        cwd: session_cwd,
        latest_timestamp,
        model_id,
        model_config,
        records,
        thread_detail_messages,
        total_record_count,
    })
}

fn agent_chat_session_sync_source(
    provider: &str,
    provider_session_id: &str,
    cwd: &str,
    scope_key: &str,
    device_id: &str,
    workspace_id: &str,
) -> Result<AgentChatSessionSyncSource, String> {
    let requested_session_id = clean_codex_id(provider_session_id);
    if requested_session_id.is_empty() {
        return Err("Provider session id is required for agent chat sync.".to_string());
    }
    match provider {
        "claude" => {
            let (path, initial_meta, _) = find_claude_session(&requested_session_id, cwd)?;
            let session_id = if initial_meta.session_id.trim().is_empty() {
                requested_session_id
            } else {
                initial_meta.session_id.clone()
            };
            let acked = agent_chat_session_sync_acked_record_hashes(
                scope_key,
                device_id,
                workspace_id,
                provider,
                &session_id,
            );
            agent_chat_session_sync_jsonl_source(
                provider,
                "claude_jsonl",
                &path,
                &session_id,
                initial_meta,
                &acked,
            )
        }
        "opencode" => {
            let (session_id, title, session_cwd, _) =
                find_opencode_session(&requested_session_id, cwd)?;
            let acked = agent_chat_session_sync_acked_record_hashes(
                scope_key,
                device_id,
                workspace_id,
                provider,
                &session_id,
            );
            agent_chat_session_sync_opencode_source(&session_id, &title, &session_cwd, &acked)
        }
        "codex" => {
            let (path, initial_meta, _) = find_codex_rollout(&requested_session_id, cwd)?;
            let session_id = if initial_meta.session_id.trim().is_empty() {
                requested_session_id
            } else {
                initial_meta.session_id.clone()
            };
            let acked = agent_chat_session_sync_acked_record_hashes(
                scope_key,
                device_id,
                workspace_id,
                provider,
                &session_id,
            );
            agent_chat_session_sync_jsonl_source(
                provider,
                "codex_jsonl",
                &path,
                &session_id,
                initial_meta,
                &acked,
            )
        }
        _ => Err("Agent chat sync supports Codex, Claude Code, and OpenCode only.".to_string()),
    }
}

fn agent_chat_session_sync_record_refs(records: &[Value]) -> Vec<Value> {
    records
        .iter()
        .map(|record| {
            json!({
                "key": cloud_mcp_payload_text(record, &["record_key", "recordKey"]).unwrap_or_default(),
                "hash": cloud_mcp_payload_text(record, &["record_hash", "recordHash"]).unwrap_or_default(),
            })
        })
        .collect()
}

fn agent_chat_session_sync_record_chunks(records: Vec<Value>) -> Vec<Vec<Value>> {
    if records.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut current = Vec::new();
    let mut current_bytes = 2usize;
    for record in records {
        let record_bytes = record.to_string().len();
        let would_exceed_record_count =
            current.len() >= AGENT_CHAT_SESSION_SYNC_MAX_RECORDS_PER_PACKET;
        let would_exceed_bytes = !current.is_empty()
            && current_bytes.saturating_add(record_bytes)
                > AGENT_CHAT_SESSION_SYNC_TARGET_PACKET_BYTES;
        if would_exceed_record_count || would_exceed_bytes {
            chunks.push(current);
            current = Vec::new();
            current_bytes = 2;
        }
        current_bytes = current_bytes.saturating_add(record_bytes).saturating_add(1);
        current.push(record);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn agent_chat_session_sync_reason_forces_metadata_probe(reason: &str) -> bool {
    matches!(
        reason,
        "device_workspaces_snapshot_history_backfill"
            | "workspace_session_history_list"
            | "terminal_session_history"
    )
}

fn agent_chat_session_sync_fill_text(target: &mut String, value: String) {
    if target.trim().is_empty() && !value.trim().is_empty() {
        *target = value;
    }
}

fn agent_chat_session_sync_enrich_context_from_history(
    root_directory: Option<&str>,
    agent_id: &str,
    provider_session_id: &str,
    mut context: AgentChatSessionSyncContext,
) -> AgentChatSessionSyncContext {
    let Ok(workspace_id) = workspace_threads_clean_workspace_id(&context.workspace_id) else {
        return context;
    };
    let Some(provider) = agent_chat_session_sync_provider(agent_id) else {
        return context;
    };
    let Some(session_id) = workspace_threads_clean_provider_session_id(provider_session_id) else {
        return context;
    };
    let Ok((connection, _, _)) = workspace_threads_open_store(root_directory, true) else {
        return context;
    };
    let Ok(mut statement) = connection.prepare(
        "SELECT
            workspace_name,
            thread_id,
            pane_id,
            terminal_instance_id,
            terminal_index,
            model_id,
            model_source,
            session_mode,
            file_authority,
            coordination_mode,
            status,
            source,
            shared_history_id,
            fork_from_provider_session_id
         FROM workspace_agent_session_history
         WHERE workspace_id=?1
           AND COALESCE(NULLIF(TRIM(provider_session_id), ''), TRIM(native_session_id))=?2
           AND (
                LOWER(agent_id)=?3
                OR LOWER(provider)=?3
                OR (?3='codex' AND (LOWER(agent_id)='openai' OR LOWER(provider)='openai'))
           )
         ORDER BY latest_at_ms DESC, created_at_ms DESC, id DESC
         LIMIT 1",
    ) else {
        return context;
    };
    let Ok(row) = statement.query_row(
        rusqlite::params![workspace_id, session_id, provider],
        |row| {
            Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, String>(1).unwrap_or_default(),
                row.get::<_, String>(2).unwrap_or_default(),
                row.get::<_, Option<i64>>(3).ok().flatten(),
                row.get::<_, Option<i64>>(4).ok().flatten(),
                row.get::<_, String>(5).unwrap_or_default(),
                row.get::<_, String>(6).unwrap_or_default(),
                row.get::<_, String>(7).unwrap_or_default(),
                row.get::<_, String>(8).unwrap_or_default(),
                row.get::<_, String>(9).unwrap_or_default(),
                row.get::<_, String>(10).unwrap_or_default(),
                row.get::<_, String>(11).unwrap_or_default(),
                row.get::<_, String>(12).unwrap_or_default(),
                row.get::<_, String>(13).unwrap_or_default(),
            ))
        },
    ) else {
        return context;
    };
    let (
        workspace_name,
        thread_id,
        pane_id,
        terminal_instance_id,
        terminal_index,
        model_id,
        model_source,
        session_mode,
        file_authority,
        coordination_mode,
        status,
        source,
        shared_history_id,
        fork_from_provider_session_id,
    ) = row;
    agent_chat_session_sync_fill_text(&mut context.workspace_name, workspace_name);
    agent_chat_session_sync_fill_text(&mut context.thread_id, thread_id);
    agent_chat_session_sync_fill_text(&mut context.pane_id, pane_id);
    agent_chat_session_sync_fill_text(&mut context.model_id, model_id);
    agent_chat_session_sync_fill_text(&mut context.model_source, model_source);
    agent_chat_session_sync_fill_text(&mut context.session_mode, session_mode);
    agent_chat_session_sync_fill_text(&mut context.file_authority, file_authority);
    agent_chat_session_sync_fill_text(&mut context.coordination_mode, coordination_mode);
    agent_chat_session_sync_fill_text(&mut context.status, status);
    agent_chat_session_sync_fill_text(&mut context.source, source);
    agent_chat_session_sync_fill_text(&mut context.shared_history_id, shared_history_id);
    agent_chat_session_sync_fill_text(
        &mut context.fork_from_provider_session_id,
        fork_from_provider_session_id,
    );
    if context.terminal_instance_id.is_none() {
        context.terminal_instance_id =
            terminal_instance_id.and_then(|value| u64::try_from(value).ok());
    }
    if context.terminal_index.is_none() {
        context.terminal_index = terminal_index;
    }
    context
}

fn agent_chat_session_sync_mark_build_failed(
    agent_id: &str,
    provider_session_id: &str,
    context: &AgentChatSessionSyncContext,
    error: &str,
) {
    let Some(provider) = agent_chat_session_sync_provider(agent_id) else {
        return;
    };
    let workspace_id = context.workspace_id.trim();
    if workspace_id.is_empty() {
        return;
    }
    let session_id = clean_codex_id(provider_session_id);
    if session_id.is_empty() {
        return;
    }
    let device_profile = cloud_mcp_desktop_device_profile();
    let device_id = cloud_mcp_payload_text(&device_profile, &["device_id", "deviceId"])
        .unwrap_or_else(|| "desktop-primary".to_string());
    let scope_key = cloud_mcp_process_account_scope_key();
    let now = cloud_mcp_now_ms() as i64;
    let last_error = clean_terminal_telemetry_text(error);
    let Ok(conn) = cloud_mcp_open_outbox_conn() else {
        return;
    };
    let _ = conn.execute(
        &format!(
            "INSERT INTO {CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_STATE_TABLE}(
                scope_key, device_id, workspace_id, provider, session_id, source_kind, source_path,
                content_hash, payload_hash, idempotency_key, record_count,
                acked_at_ms, failed_at_ms, last_error, updated_at_ms
             ) VALUES(?1, ?2, ?3, ?4, ?5, 'build_error', '', '', '', '', 0, 0, ?6, ?7, ?6)
             ON CONFLICT(scope_key, device_id, workspace_id, provider, session_id) DO UPDATE SET
                source_kind='build_error',
                failed_at_ms=excluded.failed_at_ms,
                last_error=excluded.last_error,
                updated_at_ms=excluded.updated_at_ms"
        ),
        rusqlite::params![
            scope_key,
            device_id,
            workspace_id,
            provider,
            session_id,
            now,
            last_error,
        ],
    );
    cloud_mcp_emit_agent_chat_session_sync_status_changed(
        &json!({
            "scope_key": cloud_mcp_process_account_scope_key(),
            "device_id": cloud_mcp_payload_text(&device_profile, &["device_id", "deviceId"]).unwrap_or_default(),
            "workspace_id": workspace_id,
            "provider": provider,
            "session_id": provider_session_id,
        }),
        "failed",
    );
}

fn agent_chat_session_sync_payloads(
    agent_id: &str,
    provider_session_id: &str,
    cwd: &str,
    context: AgentChatSessionSyncContext,
    reason: &str,
) -> Result<Vec<Value>, String> {
    let Some(provider) = agent_chat_session_sync_provider(agent_id) else {
        return Ok(Vec::new());
    };
    let device_profile = cloud_mcp_desktop_device_profile();
    let device_id = cloud_mcp_payload_text(&device_profile, &["device_id", "deviceId"])
        .unwrap_or_else(|| "desktop-primary".to_string());
    let scope_key = cloud_mcp_process_account_scope_key();
    let workspace_id = context.workspace_id.trim().to_string();
    let mut source = agent_chat_session_sync_source(
        provider,
        provider_session_id,
        cwd,
        &scope_key,
        &device_id,
        &workspace_id,
    )?;
    let mut model_config = source.model_config.clone();
    if !context.model_id.trim().is_empty() {
        let model_id = if source.model_id.trim().is_empty() {
            context.model_id.clone()
        } else {
            source.model_id.clone()
        };
        agent_chat_session_sync_merge_model_config(
            &mut model_config,
            json!({
                "diffForgeModelId": context.model_id.clone(),
                "diff_forge_model_id": context.model_id.clone(),
                "modelId": model_id.clone(),
                "model_id": model_id,
            }),
        );
    }
    if !context.model_source.trim().is_empty() {
        agent_chat_session_sync_merge_model_config(
            &mut model_config,
            json!({
                "diffForgeModelSource": context.model_source.clone(),
                "diff_forge_model_source": context.model_source.clone(),
            }),
        );
    }
    let model_id = agent_chat_session_sync_latest_model_id(&model_config, &source.model_id);
    let thread_detail =
        agent_chat_session_sync_thread_detail(&source, &context, &model_id, &model_config);
    let thread_detail_hash = agent_chat_session_sync_hash(&thread_detail);
    let metadata_hash = agent_chat_session_sync_hash(&json!({
        "provider": source.provider.as_str(),
        "session_id": source.session_id.as_str(),
        "source_kind": source.source_kind.as_str(),
        "source_path": source.source_path.as_str(),
        "cwd": source.cwd.as_str(),
        "title": source.title.as_str(),
        "latest_timestamp": source.latest_timestamp.as_str(),
        "total_record_count": source.total_record_count,
        "workspace_id": context.workspace_id.as_str(),
        "workspace_name": context.workspace_name.as_str(),
        "thread_id": context.thread_id.as_str(),
        "pane_id": context.pane_id.as_str(),
        "terminal_instance_id": context.terminal_instance_id,
        "terminal_index": context.terminal_index,
        "session_mode": context.session_mode.as_str(),
        "file_authority": context.file_authority.as_str(),
        "coordination_mode": context.coordination_mode.as_str(),
        "status": context.status.as_str(),
        "context_source": context.source.as_str(),
        "shared_history_id": context.shared_history_id.as_str(),
        "fork_from_provider_session_id": context.fork_from_provider_session_id.as_str(),
        "model_id": model_id.as_str(),
        "model_config": model_config.clone(),
        "thread_detail_hash": thread_detail_hash.as_str(),
    }));
    if context.metadata_only {
        source.records.clear();
    }
    let metadata_already_acked = agent_chat_session_sync_acked_session_metadata_hash(
        &scope_key,
        &device_id,
        &workspace_id,
        &source.provider,
        &source.session_id,
    )
    .as_deref()
        == Some(metadata_hash.as_str());
    if source.records.is_empty()
        && metadata_already_acked
        && !agent_chat_session_sync_reason_forces_metadata_probe(reason)
    {
        return Ok(Vec::new());
    }
    let changed_record_count = source.records.len();
    let chunks = if changed_record_count == 0 {
        vec![Vec::new()]
    } else {
        agent_chat_session_sync_record_chunks(std::mem::take(&mut source.records))
    };
    let total_packet_count = chunks.len().max(1);
    let base_mode = if changed_record_count == 0 {
        "metadata".to_string()
    } else if source.total_record_count == changed_record_count {
        "snapshot".to_string()
    } else {
        "delta".to_string()
    };
    let mut payloads = Vec::new();
    let mut packet_record_offset = 0usize;
    for (packet_index, packet_records) in chunks.into_iter().enumerate() {
        let packet_refs = agent_chat_session_sync_record_refs(&packet_records);
        let content_hash = if packet_records.is_empty() {
            metadata_hash.clone()
        } else {
            agent_chat_session_sync_hash(&json!({
                "metadata_hash": metadata_hash.as_str(),
                "records": packet_refs,
            }))
        };
        let packet_key = if packet_records.is_empty() {
            "metadata".to_string()
        } else if total_packet_count == 1 {
            "records".to_string()
        } else {
            format!("records-{:04}", packet_index + 1)
        };
        let mode = if total_packet_count > 1 && !packet_records.is_empty() {
            format!("{base_mode}_chunk")
        } else {
            base_mode.clone()
        };
        let payload_hash = agent_chat_session_sync_hash(&json!({
            "contract": CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_CONTRACT,
            "schema": CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_SCHEMA_VERSION,
            "scope": scope_key.as_str(),
            "device": device_id.as_str(),
            "workspace": workspace_id.as_str(),
            "provider": source.provider.as_str(),
            "session": source.session_id.as_str(),
            "packet": packet_key.as_str(),
            "content": content_hash.as_str(),
        }));
        let idempotency_key = format!(
            "agent-chat-session:v1:{scope_key}:{device_id}:{workspace_id}:{}:{}:{packet_key}:{payload_hash}",
            source.provider, source.session_id
        );
        let record_count = packet_records.len();
        let records_remaining = changed_record_count
            .saturating_sub(packet_record_offset)
            .saturating_sub(record_count);
        let mut payload = json!({
            "c": CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_CONTRACT,
            "contract": CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_CONTRACT,
            "m": mode.clone(),
            "mode": mode,
            "v": CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_SCHEMA_VERSION,
            "schemaVersion": CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_SCHEMA_VERSION,
            "schema_version": CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_SCHEMA_VERSION,
            "pid": idempotency_key.clone(),
            "idempotency_key": idempotency_key.clone(),
            "idempotencyKey": idempotency_key,
            "ph": payload_hash.clone(),
            "payload_hash": payload_hash.clone(),
            "payloadHash": payload_hash,
            "content_hash": content_hash.clone(),
            "contentHash": content_hash,
            "metadata_hash": metadata_hash.clone(),
            "metadataHash": metadata_hash.clone(),
            "scope_key": scope_key.clone(),
            "scopeKey": scope_key.clone(),
            "device": device_profile.clone(),
            "device_id": device_id.clone(),
            "deviceId": device_id.clone(),
            "source": "rust-diffforge",
            "reason": reason,
            "provider": source.provider.clone(),
            "agent_kind": source.provider.clone(),
            "agentKind": source.provider.clone(),
            "session_id": source.session_id.clone(),
            "sessionId": source.session_id.clone(),
            "provider_session_id": source.session_id.clone(),
            "providerSessionId": source.session_id.clone(),
            "source_kind": source.source_kind.clone(),
            "sourceKind": source.source_kind.clone(),
            "source_path": source.source_path.clone(),
            "sourcePath": source.source_path.clone(),
            "cwd": source.cwd.clone(),
            "title": source.title.clone(),
            "latest_timestamp": source.latest_timestamp.clone(),
            "latestTimestamp": source.latest_timestamp.clone(),
            "record_count": record_count,
            "recordCount": record_count,
            "changed_record_count": changed_record_count,
            "changedRecordCount": changed_record_count,
            "total_record_count": source.total_record_count,
            "totalRecordCount": source.total_record_count,
            "packet_key": packet_key.clone(),
            "packetKey": packet_key,
            "packet_index": packet_index,
            "packetIndex": packet_index,
            "packet_ordinal": packet_index + 1,
            "packetOrdinal": packet_index + 1,
            "packet_count": total_packet_count,
            "packetCount": total_packet_count,
            "packet_record_offset": packet_record_offset,
            "packetRecordOffset": packet_record_offset,
            "records_remaining": records_remaining,
            "recordsRemaining": records_remaining,
            "has_more_records": records_remaining > 0,
            "hasMoreRecords": records_remaining > 0,
            "workspace_id": workspace_id.clone(),
            "workspaceId": workspace_id.clone(),
            "workspace_name": context.workspace_name.clone(),
            "workspaceName": context.workspace_name.clone(),
            "thread_id": context.thread_id.clone(),
            "threadId": context.thread_id.clone(),
            "pane_id": context.pane_id.clone(),
            "paneId": context.pane_id.clone(),
            "terminal_instance_id": context.terminal_instance_id,
            "terminalInstanceId": context.terminal_instance_id,
            "terminal_index": context.terminal_index,
            "terminalIndex": context.terminal_index,
            "session_mode": context.session_mode.clone(),
            "sessionMode": context.session_mode.clone(),
            "file_authority": context.file_authority.clone(),
            "fileAuthority": context.file_authority.clone(),
            "coordination_mode": context.coordination_mode.clone(),
            "coordinationMode": context.coordination_mode.clone(),
            "status": context.status.clone(),
            "context_source": context.source.clone(),
            "contextSource": context.source.clone(),
            "shared_history_id": context.shared_history_id.clone(),
            "sharedHistoryId": context.shared_history_id.clone(),
            "fork_from_provider_session_id": context.fork_from_provider_session_id.clone(),
            "forkFromProviderSessionId": context.fork_from_provider_session_id.clone(),
            "model_id": model_id.clone(),
            "modelId": model_id.clone(),
            "model_config": model_config.clone(),
            "modelConfig": model_config.clone(),
            "thread_detail": thread_detail.clone(),
            "threadDetail": thread_detail.clone(),
            "records": packet_records,
        });
        if context.metadata_only {
            if let Some(object) = payload.as_object_mut() {
                object.insert("metadata_only".to_string(), json!(true));
                object.insert("metadataOnly".to_string(), json!(true));
            }
        }
        payloads.push(payload);
        packet_record_offset = packet_record_offset.saturating_add(record_count);
    }
    Ok(payloads)
}

fn agent_chat_session_sync_spawn(
    app: AppHandle,
    agent_id: String,
    provider_session_id: String,
    cwd: String,
    context: AgentChatSessionSyncContext,
    reason: &'static str,
) {
    let state = app.state::<CloudMcpState>().inner().clone();
    agent_chat_session_sync_spawn_with_state(
        state,
        agent_id,
        provider_session_id,
        cwd,
        context,
        reason,
    );
}

fn agent_chat_session_sync_spawn_with_state(
    state: CloudMcpState,
    agent_id: String,
    provider_session_id: String,
    cwd: String,
    context: AgentChatSessionSyncContext,
    reason: &'static str,
) {
    tauri::async_runtime::spawn(async move {
        let _build_permit = match agent_chat_session_sync_build_semaphore()
            .acquire_owned()
            .await
        {
            Ok(permit) => permit,
            Err(_) => return,
        };
        let build_agent_id = agent_id.clone();
        let build_provider_session_id = provider_session_id.clone();
        let build_cwd = cwd.clone();
        let build_context = agent_chat_session_sync_enrich_context_from_history(
            Some(build_cwd.as_str()),
            &build_agent_id,
            &build_provider_session_id,
            context.clone(),
        );
        let result = tauri::async_runtime::spawn_blocking(move || {
            let _heavy_permit = backend_heavy_job_acquire("agent_chat_session_sync.build_payloads");
            let _span = BackendCpuSpan::new("agent_chat_session_sync.build_payloads");
            agent_chat_session_sync_payloads(
                &build_agent_id,
                &build_provider_session_id,
                &build_cwd,
                build_context,
                reason,
            )
        })
        .await
        .map_err(|error| format!("Agent chat sync build task failed: {error}"));
        let payloads = match result {
            Ok(Ok(payloads)) if !payloads.is_empty() => payloads,
            Ok(Ok(_)) => return,
            Ok(Err(error)) | Err(error) => {
                agent_chat_session_sync_mark_build_failed(
                    &agent_id,
                    &provider_session_id,
                    &context,
                    &error,
                );
                log_terminal_status_event(
                    "backend.agent_chat_session_sync.build_error",
                    json!({
                        "agent_id": agent_id,
                        "provider_session_id": provider_session_id,
                        "reason": reason,
                        "error": clean_terminal_telemetry_text(&error),
                    }),
                );
                return;
            }
        };
        for payload in payloads {
            agent_chat_session_sync_mark_workspace_history_dirty(&context.workspace_id);
            let key = format!(
                "agent-chat-session:{}:{}:{}:{}",
                cloud_mcp_payload_text(&payload, &["workspace_id", "workspaceId"])
                    .unwrap_or_default(),
                cloud_mcp_payload_text(&payload, &["provider"]).unwrap_or_default(),
                cloud_mcp_payload_text(&payload, &["session_id", "sessionId"]).unwrap_or_default(),
                cloud_mcp_payload_text(&payload, &["packet_key", "packetKey"])
                    .unwrap_or_else(|| "session".to_string())
            );
            cloud_mcp_enqueue_background_sync(
                &state,
                key,
                CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_EVENT,
                payload,
                cloud_mcp_outbox_priority_for_event(CLOUD_MCP_AGENT_CHAT_SESSION_SYNC_EVENT),
                reason,
            )
            .await;
        }
    });
}

fn agent_chat_session_sync_spawn_from_result(
    app: AppHandle,
    agent_id: &str,
    result: &CodexThreadTranscriptResult,
    context: AgentChatSessionSyncContext,
    reason: &'static str,
) {
    let Some(provider) = agent_chat_session_sync_provider(agent_id) else {
        return;
    };
    if context.workspace_id.trim().is_empty() {
        log_terminal_status_event(
            "backend.agent_chat_session_sync.history_missing_workspace",
            json!({
                "agent_id": agent_id,
                "provider_session_id": result.session_id,
                "reason": reason,
            }),
        );
        return;
    }
    agent_chat_session_sync_mark_workspace_history_dirty(&context.workspace_id);
    let app_for_task = app.clone();
    let agent_id = provider.to_string();
    let result = result.clone();
    let context = context.clone();
    tauri::async_runtime::spawn(async move {
        let provider_session_id = result.session_id.clone();
        let root_directory = result.cwd.clone();
        let source = if context.source.trim().is_empty() {
            reason.to_string()
        } else {
            context.source.clone()
        };
        let history_id = workspace_agent_session_history_record_id(
            &context.workspace_id,
            &agent_id,
            &provider_session_id,
        );
        let record = WorkspaceAgentSessionHistoryRecord {
            id: history_id,
            workspace_id: context.workspace_id.clone(),
            workspace_name: context.workspace_name.clone(),
            coordination_session_id: String::new(),
            provider_session_id: provider_session_id.clone(),
            native_session_id: provider_session_id.clone(),
            fork_from_provider_session_id: context.fork_from_provider_session_id.clone(),
            shared_history_id: context.shared_history_id.clone(),
            agent_id: agent_id.clone(),
            provider: agent_id.clone(),
            model_id: context.model_id.clone(),
            model_source: context.model_source.clone(),
            session_mode: context.session_mode.clone(),
            file_authority: context.file_authority.clone(),
            coordination_mode: context.coordination_mode.clone(),
            thread_id: context.thread_id.clone(),
            pane_id: context.pane_id.clone(),
            terminal_instance_id: context.terminal_instance_id,
            terminal_index: context.terminal_index,
            slot_key: String::new(),
            cwd: result.cwd.clone(),
            status: if context.status.trim().is_empty() {
                "observed".to_string()
            } else {
                context.status.clone()
            },
            title: result.session_title.clone(),
            source,
            observed_at_ms: Some(current_time_ms()),
            created_at_ms: None,
        };
        let record_for_emit = record.clone();
        let upsert_result = tauri::async_runtime::spawn_blocking(move || {
            let root = if root_directory.trim().is_empty() {
                None
            } else {
                Some(root_directory.as_str())
            };
            workspace_agent_session_history_upsert_blocking(root, record)
        })
        .await
        .map_err(|error| format!("Agent chat history upsert task failed: {error}"))
        .and_then(|value| value);
        match upsert_result {
            Ok(recorded) => {
                terminal_emit_workspace_agent_session_history_changed(
                    &app_for_task,
                    &record_for_emit,
                    Some(recorded),
                );
                agent_chat_session_sync_spawn(
                    app_for_task,
                    agent_id,
                    provider_session_id,
                    result.cwd,
                    context,
                    reason,
                );
            }
            Err(error) => {
                log_terminal_status_event(
                    "backend.agent_chat_session_sync.history_upsert_error",
                    json!({
                        "agent_id": agent_id,
                        "provider_session_id": provider_session_id,
                        "reason": reason,
                        "error": clean_terminal_telemetry_text(&error),
                    }),
                );
            }
        }
    });
}

fn agent_chat_session_sync_context_from_watch(
    context: &AgentThreadTranscriptWatchContext,
) -> AgentChatSessionSyncContext {
    AgentChatSessionSyncContext {
        workspace_id: context.workspace_id.clone(),
        thread_id: context.thread_id.clone(),
        pane_id: context.pane_id.clone(),
        terminal_instance_id: context.instance_id,
        terminal_index: context.terminal_index,
        status: if context.poll_until_turn_complete {
            "observed".to_string()
        } else {
            String::new()
        },
        source: context.source.clone(),
        ..AgentChatSessionSyncContext::default()
    }
}

fn agent_chat_session_sync_spawn_from_history_record(
    app: AppHandle,
    record: WorkspaceAgentSessionHistoryRecord,
    reason: &'static str,
) {
    let provider_session_id = if !record.provider_session_id.trim().is_empty() {
        record.provider_session_id.clone()
    } else {
        record.native_session_id.clone()
    };
    if provider_session_id.trim().is_empty() {
        return;
    }
    agent_chat_session_sync_mark_workspace_history_dirty(&record.workspace_id);
    let context = AgentChatSessionSyncContext {
        workspace_id: record.workspace_id.clone(),
        workspace_name: record.workspace_name.clone(),
        thread_id: record.thread_id.clone(),
        pane_id: record.pane_id.clone(),
        terminal_instance_id: record.terminal_instance_id,
        terminal_index: record.terminal_index,
        model_id: record.model_id.clone(),
        model_source: record.model_source.clone(),
        session_mode: record.session_mode.clone(),
        file_authority: record.file_authority.clone(),
        coordination_mode: record.coordination_mode.clone(),
        status: record.status.clone(),
        source: record.source.clone(),
        shared_history_id: record.shared_history_id.clone(),
        fork_from_provider_session_id: record.fork_from_provider_session_id.clone(),
        metadata_only: false,
    };
    agent_chat_session_sync_spawn(
        app,
        record.provider.clone(),
        provider_session_id,
        record.cwd.clone(),
        context,
        reason,
    );
}

fn agent_chat_session_sync_history_item_record(
    item: &WorkspaceAgentSessionHistoryItem,
) -> WorkspaceAgentSessionHistoryRecord {
    let provider = workspace_threads_clean_agent_id(&item.provider)
        .or_else(|| workspace_threads_clean_agent_id(&item.agent_id))
        .unwrap_or_else(|| item.provider.clone());
    let visible_session_id = workspace_agent_session_history_item_session_id(item)
        .unwrap_or_else(|| item.provider_session_id.clone());
    let shared_history_id = if item.shared_history_id.trim().is_empty() {
        workspace_agent_session_history_shared_history_id(
            &item.workspace_id,
            &provider,
            &visible_session_id,
            &item.fork_from_provider_session_id,
        )
    } else {
        item.shared_history_id.clone()
    };
    WorkspaceAgentSessionHistoryRecord {
        id: item.id.clone(),
        workspace_id: item.workspace_id.clone(),
        workspace_name: item.workspace_name.clone(),
        coordination_session_id: item.coordination_session_id.clone(),
        provider_session_id: item.provider_session_id.clone(),
        native_session_id: item.native_session_id.clone(),
        fork_from_provider_session_id: item.fork_from_provider_session_id.clone(),
        shared_history_id,
        agent_id: item.agent_id.clone(),
        provider,
        model_id: item.model_id.clone(),
        model_source: item.model_source.clone(),
        session_mode: item.session_mode.clone(),
        file_authority: item.file_authority.clone(),
        coordination_mode: item.coordination_mode.clone(),
        thread_id: item.thread_id.clone(),
        pane_id: item.pane_id.clone(),
        terminal_instance_id: item.terminal_instance_id,
        terminal_index: item.terminal_index,
        slot_key: item.slot_key.clone(),
        cwd: if item.cwd.trim().is_empty() {
            item.workspace_root.clone()
        } else {
            item.cwd.clone()
        },
        status: item.status.clone(),
        title: item.title.clone(),
        source: if item.source.trim().is_empty() {
            "workspace_agent_session_history_backfill".to_string()
        } else {
            item.source.clone()
        },
        observed_at_ms: Some(current_time_ms()),
        created_at_ms: Some(item.created_at_ms),
    }
}

fn agent_chat_session_sync_history_item_fully_synced(
    item: &WorkspaceAgentSessionHistoryItem,
) -> bool {
    let sync = &item.chat_sync;
    sync.status.trim().eq_ignore_ascii_case("synced")
        && sync.acked_at_ms > 0
        && (sync.record_total_count == 0 || sync.record_acked_count >= sync.record_total_count)
}

fn agent_chat_session_sync_history_fingerprint_key(
    item: &WorkspaceAgentSessionHistoryItem,
    provider: &str,
    session_id: &str,
) -> String {
    format!(
        "{}:{}:{}:{}",
        item.workspace_id.trim(),
        provider.trim(),
        session_id.trim(),
        item.workspace_root.trim()
    )
}

fn agent_chat_session_sync_history_item_source_fingerprint(
    item: &WorkspaceAgentSessionHistoryItem,
    provider: &str,
    session_id: &str,
) -> Option<AgentChatSessionHistorySourceFingerprint> {
    match provider {
        "claude" => {
            let (path, _, _) = find_claude_session(session_id, item.cwd.as_str()).ok()?;
            agent_chat_session_history_source_fingerprint_for_path(&path)
        }
        "codex" => {
            let (path, _, _) = find_codex_rollout(session_id, item.cwd.as_str()).ok()?;
            agent_chat_session_history_source_fingerprint_for_path(&path)
        }
        "opencode" => {
            let path = opencode_db_path()?;
            agent_chat_session_history_source_fingerprint_for_path(&path)
        }
        _ => None,
    }
}

fn agent_chat_session_sync_history_item_skip_unchanged_verify(
    item: &WorkspaceAgentSessionHistoryItem,
) -> bool {
    if !agent_chat_session_sync_history_item_fully_synced(item) {
        return false;
    }
    let Some(provider) = workspace_threads_clean_agent_id(&item.provider)
        .or_else(|| workspace_threads_clean_agent_id(&item.agent_id))
    else {
        return false;
    };
    let Some(session_id) = workspace_agent_session_history_item_session_id(item) else {
        return false;
    };
    let Some(fingerprint) =
        agent_chat_session_sync_history_item_source_fingerprint(item, &provider, &session_id)
    else {
        return false;
    };
    let key = agent_chat_session_sync_history_fingerprint_key(item, &provider, &session_id);
    let ledger = agent_chat_session_history_source_fingerprints();
    let Ok(mut entries) = ledger.lock() else {
        return false;
    };
    let sync = &item.chat_sync;
    let last_verified_at_ms = sync
        .acked_at_ms
        .max(sync.updated_at_ms)
        .max(sync.last_enqueued_at_ms);
    if fingerprint.modified_ms > 0
        && last_verified_at_ms > 0
        && fingerprint.modified_ms <= last_verified_at_ms
    {
        entries.insert(key, fingerprint);
        return true;
    }
    let unchanged = entries
        .get(&key)
        .is_some_and(|previous| previous == &fingerprint);
    entries.insert(key, fingerprint);
    unchanged
}

fn agent_chat_session_sync_history_item_needs_backfill(
    item: &WorkspaceAgentSessionHistoryItem,
) -> bool {
    let Some(provider) = workspace_threads_clean_agent_id(&item.provider)
        .or_else(|| workspace_threads_clean_agent_id(&item.agent_id))
    else {
        return false;
    };
    let Some(session_id) = workspace_agent_session_history_item_session_id(item) else {
        return false;
    };
    if item.workspace_id.trim().is_empty()
        || item.workspace_root.trim().is_empty()
        || agent_chat_session_sync_provider(&provider).is_none()
        || !workspace_agent_session_history_session_id_is_visible(&provider, &session_id)
    {
        return false;
    }
    let sync = &item.chat_sync;
    if sync.pending_packet_count > 0
        || sync.syncing_packet_count > 0
        || sync.retrying_packet_count > 0
    {
        return false;
    }
    if agent_chat_session_sync_history_item_fully_synced(item) {
        let last_verified_at_ms = sync
            .acked_at_ms
            .max(sync.updated_at_ms)
            .max(sync.last_enqueued_at_ms);
        return current_time_ms().saturating_sub(last_verified_at_ms)
            >= AGENT_CHAT_SESSION_HISTORY_SYNC_VERIFY_INTERVAL_MS;
    }
    true
}

fn agent_chat_session_sync_spawn_from_history_items(
    app: AppHandle,
    items: &[WorkspaceAgentSessionHistoryItem],
    reason: &'static str,
) -> usize {
    let mut spawned = 0usize;
    for item in items
        .iter()
        .filter(|item| agent_chat_session_sync_history_item_needs_backfill(item))
        .filter(|item| !agent_chat_session_sync_history_item_skip_unchanged_verify(item))
        .take(AGENT_CHAT_SESSION_HISTORY_BACKFILL_SPAWN_LIMIT)
    {
        agent_chat_session_sync_spawn_from_history_record(
            app.clone(),
            agent_chat_session_sync_history_item_record(item),
            reason,
        );
        spawned += 1;
    }
    spawned
}

fn agent_chat_session_sync_should_backfill_workspace(
    workspace_id: &str,
    root_directory: Option<&str>,
) -> Option<u64> {
    let now = current_time_ms();
    let workspace_key = agent_chat_session_history_backfill_workspace_key(workspace_id)?;
    let root_key = agent_chat_session_history_backfill_root_key(workspace_id, root_directory)?;
    let should_scan = {
        let all_dirty_since =
            AGENT_CHAT_SESSION_HISTORY_BACKFILL_ALL_DIRTY_SINCE.load(Ordering::Acquire);
        let workspaces = agent_chat_session_history_backfill_workspaces();
        match workspaces.lock() {
            Ok(mut entries) => {
                let entry = entries.entry(workspace_key.clone()).or_insert(
                    AgentChatSessionHistoryBackfillWorkspace {
                        dirty_since_ms: Some(0),
                        last_full_pass_spawned: None,
                        last_full_pass_ms: 0,
                        all_dirty_seen_ms: all_dirty_since,
                    },
                );
                if all_dirty_since > entry.all_dirty_seen_ms {
                    entry.dirty_since_ms = Some(
                        entry
                            .dirty_since_ms
                            .map(|dirty_since| dirty_since.min(all_dirty_since))
                            .unwrap_or(all_dirty_since),
                    );
                    entry.all_dirty_seen_ms = all_dirty_since;
                }
                let verify_due = entry.last_full_pass_spawned == Some(false)
                    && entry.last_full_pass_ms > 0
                    && now.saturating_sub(entry.last_full_pass_ms)
                        >= AGENT_CHAT_SESSION_HISTORY_SYNC_VERIFY_INTERVAL_MS;
                entry.dirty_since_ms.is_some()
                    || entry.last_full_pass_spawned.unwrap_or(true)
                    || verify_due
            }
            Err(_) => true,
        }
    };
    if !should_scan {
        return None;
    }
    let ledger =
        AGENT_CHAT_SESSION_HISTORY_BACKFILL_LAST.get_or_init(|| StdMutex::new(HashMap::new()));
    let Ok(mut entries) = ledger.lock() else {
        return Some(now);
    };
    if entries.get(&root_key).is_some_and(|last| {
        now.saturating_sub(*last) < AGENT_CHAT_SESSION_HISTORY_BACKFILL_INTERVAL_MS
    }) {
        return None;
    }
    entries.insert(root_key, now);
    Some(now)
}

fn agent_chat_session_sync_finish_backfill_workspace(
    workspace_id: &str,
    started_at_ms: u64,
    spawned: usize,
) {
    let Some(workspace_key) = agent_chat_session_history_backfill_workspace_key(workspace_id)
    else {
        return;
    };
    let Ok(mut entries) = agent_chat_session_history_backfill_workspaces().lock() else {
        return;
    };
    let entry = entries.entry(workspace_key).or_default();
    if entry
        .dirty_since_ms
        .is_some_and(|dirty_since| dirty_since <= started_at_ms)
    {
        entry.dirty_since_ms = None;
    }
    entry.last_full_pass_spawned = Some(spawned > 0);
    entry.last_full_pass_ms = started_at_ms;
}

fn agent_chat_session_sync_backfill_workspace_history(
    app: AppHandle,
    workspace_id: String,
    root_directory: Option<String>,
    reason: &'static str,
) {
    let requested_workspace_id = workspace_id.clone();
    tauri::async_runtime::spawn(async move {
        // Workspace-snapshot rebuilds fire this during workspace activation,
        // and the full history list can burn seconds of CPU/disk exactly while
        // the runtime mounts (user-visible switch lag). Let the switch settle
        // first; the dirty latch is checked after the delay so work another
        // pass already served is skipped.
        tokio::time::sleep(std::time::Duration::from_millis(5_000)).await;
        let Some(started_at_ms) = agent_chat_session_sync_should_backfill_workspace(
            &workspace_id,
            root_directory.as_deref(),
        ) else {
            return;
        };
        let request = WorkspaceAgentSessionHistoryListRequest {
            fast: Some(false),
            workspace_id,
            root_directory,
            limit: Some(AGENT_CHAT_SESSION_HISTORY_BACKFILL_LIMIT),
        };
        let result = tauri::async_runtime::spawn_blocking(move || {
            let _heavy_permit =
                backend_heavy_job_acquire("agent_chat_session_sync.history_backfill_list");
            let _span = BackendCpuSpan::new("agent_chat_session_sync.history_backfill_list");
            workspace_agent_session_history_list_blocking(request)
        })
        .await
        .map_err(|error| format!("Workspace session history backfill read failed: {error}"))
        .and_then(|value| value);
        match result {
            Ok(mut history) => {
                workspace_agent_session_history_enrich_chat_sync(&mut history.items);
                let queued =
                    agent_chat_session_sync_spawn_from_history_items(app, &history.items, reason);
                agent_chat_session_sync_finish_backfill_workspace(
                    &requested_workspace_id,
                    started_at_ms,
                    queued,
                );
                if queued > 0 {
                    log_terminal_status_event(
                        "backend.agent_chat_session_sync.history_backfill_queued",
                        json!({
                            "queued": queued,
                            "reason": reason,
                            "workspace_id": history.workspace_id,
                        }),
                    );
                }
            }
            Err(error) => {
                log_terminal_status_event(
                    "backend.agent_chat_session_sync.history_backfill_error",
                    json!({
                        "error": clean_terminal_telemetry_text(&error),
                        "reason": reason,
                    }),
                );
            }
        }
    });
}

fn agent_chat_session_sync_spawn_from_payload_repair(
    app: AppHandle,
    payload: &Value,
    reason: &'static str,
) -> bool {
    let provider = cloud_mcp_payload_text(payload, &["provider", "agent_kind", "agentKind"])
        .unwrap_or_default();
    let provider_session_id = cloud_mcp_payload_text(
        payload,
        &[
            "provider_session_id",
            "providerSessionId",
            "session_id",
            "sessionId",
        ],
    )
    .unwrap_or_default();
    let workspace_id =
        cloud_mcp_payload_text(payload, &["workspace_id", "workspaceId"]).unwrap_or_default();
    if provider.trim().is_empty()
        || provider_session_id.trim().is_empty()
        || workspace_id.trim().is_empty()
    {
        return false;
    }
    let cwd = cloud_mcp_payload_text(payload, &["cwd", "workspace_root", "workspaceRoot"])
        .unwrap_or_default();
    agent_chat_session_sync_mark_workspace_history_dirty(&workspace_id);
    let context = AgentChatSessionSyncContext {
        workspace_id,
        workspace_name: cloud_mcp_payload_text(payload, &["workspace_name", "workspaceName"])
            .unwrap_or_default(),
        thread_id: cloud_mcp_payload_text(payload, &["thread_id", "threadId"]).unwrap_or_default(),
        pane_id: cloud_mcp_payload_text(payload, &["pane_id", "paneId"]).unwrap_or_default(),
        terminal_instance_id: payload
            .get("terminal_instance_id")
            .or_else(|| payload.get("terminalInstanceId"))
            .and_then(Value::as_u64),
        terminal_index: payload
            .get("terminal_index")
            .or_else(|| payload.get("terminalIndex"))
            .and_then(|value| {
                value
                    .as_i64()
                    .or_else(|| value.as_u64().map(|number| number as i64))
            }),
        model_id: cloud_mcp_payload_text(payload, &["model_id", "modelId", "model"])
            .unwrap_or_default(),
        model_source: String::new(),
        session_mode: cloud_mcp_payload_text(payload, &["session_mode", "sessionMode"])
            .unwrap_or_default(),
        file_authority: cloud_mcp_payload_text(payload, &["file_authority", "fileAuthority"])
            .unwrap_or_default(),
        coordination_mode: cloud_mcp_payload_text(
            payload,
            &["coordination_mode", "coordinationMode"],
        )
        .unwrap_or_default(),
        status: "waiting".to_string(),
        source: "agent_chat_ack_repair".to_string(),
        shared_history_id: cloud_mcp_payload_text(
            payload,
            &["shared_history_id", "sharedHistoryId"],
        )
        .unwrap_or_default(),
        fork_from_provider_session_id: cloud_mcp_payload_text(
            payload,
            &[
                "fork_from_provider_session_id",
                "forkFromProviderSessionId",
                "fork_from_session_id",
                "forkFromSessionId",
            ],
        )
        .unwrap_or_default(),
        metadata_only: false,
    };
    agent_chat_session_sync_spawn(app, provider, provider_session_id, cwd, context, reason);
    true
}

#[cfg(test)]
mod agent_chat_session_sync_tests {
    use super::*;

    fn test_history_item(
        provider_session_id: &str,
        chat_sync: WorkspaceAgentSessionHistoryChatSync,
    ) -> WorkspaceAgentSessionHistoryItem {
        WorkspaceAgentSessionHistoryItem {
            id: format!("session:workspace-a:codex:{provider_session_id}"),
            workspace_id: "workspace-a".to_string(),
            workspace_name: "Workspace A".to_string(),
            workspace_root: "/tmp/workspace-a".to_string(),
            coordination_session_id: "coord-a".to_string(),
            provider_session_id: provider_session_id.to_string(),
            native_session_id: provider_session_id.to_string(),
            fork_from_provider_session_id: String::new(),
            shared_history_id: String::new(),
            agent_id: "codex".to_string(),
            provider: "codex".to_string(),
            model_id: "gpt-5.5".to_string(),
            model_source: "launch".to_string(),
            session_mode: "direct".to_string(),
            file_authority: "workspace".to_string(),
            coordination_mode: "direct".to_string(),
            thread_id: "thread-a".to_string(),
            pane_id: "pane-a".to_string(),
            terminal_instance_id: Some(42),
            terminal_index: Some(0),
            slot_key: "terminal:0".to_string(),
            cwd: String::new(),
            status: "idle".to_string(),
            title: "Test session".to_string(),
            first_user_message: String::new(),
            chat_sync,
            source: "test".to_string(),
            created_at_ms: 10,
            latest_at_ms: 20,
        }
    }

    #[test]
    fn agent_chat_session_sync_chunks_records_by_session_packet_limit() {
        let records = (0..=AGENT_CHAT_SESSION_SYNC_MAX_RECORDS_PER_PACKET)
            .map(|index| json!({ "record_key": format!("record-{index}") }))
            .collect::<Vec<_>>();

        let chunks = agent_chat_session_sync_record_chunks(records);

        assert_eq!(chunks.len(), 2);
        assert_eq!(
            chunks[0].len(),
            AGENT_CHAT_SESSION_SYNC_MAX_RECORDS_PER_PACKET
        );
        assert_eq!(chunks[1].len(), 1);
    }

    #[test]
    fn agent_chat_session_sync_tool_output_error_sets_status() {
        let message = agent_chat_session_sync_message_value(CodexThreadTranscriptMessage {
            id: "tool-output-1".to_string(),
            role: "activity".to_string(),
            kind: "tool_output".to_string(),
            text: "permission denied".to_string(),
            title: "Tool error".to_string(),
            call_id: "call-1".to_string(),
            created_at: "2026-07-02T00:00:00Z".to_string(),
            source: "codex".to_string(),
            artifacts: Vec::new(),
            ..Default::default()
        });

        assert_eq!(message["kind"], json!("tool_call"));
        assert_eq!(message["legacy_kind"], json!("tool_output"));
        assert_eq!(message["status"], json!("error"));
        assert_eq!(message["toolError"], json!("permission denied"));
        assert_eq!(message["tool"]["status"], json!("failed"));
        assert_eq!(message["tool"]["output"], json!("permission denied"));
        assert_eq!(agent_chat_session_sync_message_status(&message), "error");
    }

    #[test]
    fn agent_chat_session_sync_message_value_emits_v2_tool_contract() {
        let message = agent_chat_session_sync_message_value(CodexThreadTranscriptMessage {
            id: "tool-call-1".to_string(),
            role: "activity".to_string(),
            kind: "tool_call".to_string(),
            text: "reading src/lib.rs".to_string(),
            title: "Read file".to_string(),
            call_id: "call-read".to_string(),
            created_at: "2026-07-02T00:00:00Z".to_string(),
            source: "codex".to_string(),
            tool: Some(json!({
                "name": "read_file",
                "call_id": "call-read",
                "status": "running",
                "input": { "path": "src/lib.rs" },
                "title": "Read file"
            })),
            usage: Some(json!({ "input_tokens": 12, "output_tokens": 3 })),
            artifacts: Vec::new(),
            ..Default::default()
        });

        assert_eq!(message["kind"], json!("tool_call"));
        assert_eq!(message["call_id"], json!("call-read"));
        assert_eq!(message["created_at"], json!("2026-07-02T00:00:00Z"));
        assert_eq!(message["tool"]["input"], json!({ "path": "src/lib.rs" }));
        assert_eq!(message["tool"]["status"], json!("running"));
        assert_eq!(message["usage"]["input_tokens"], json!(12));
    }

    #[test]
    fn agent_chat_session_sync_record_guard_truncates_oversized_messages() {
        let huge_text = "x".repeat(CODEX_TRANSCRIPT_MAX_RECORD_MESSAGES_BYTES + 32_000);
        let record = agent_chat_session_sync_record(
            &HashMap::new(),
            "codex",
            "session-a",
            "codex:session-a:jsonl:v2:0:0:abc".to_string(),
            "response_item",
            json!({ "lineIndex": 0 }),
            "2026-07-02T00:00:00Z".to_string(),
            json!({ "type": "response_item" }),
            vec![json!({
                "id": "assistant-1",
                "role": "assistant",
                "kind": "assistant_message",
                "text": huge_text,
            })],
        )
        .expect("record");

        let messages = record["messages"].as_array().expect("messages");
        assert!(
            agent_chat_session_sync_messages_json_bytes(messages)
                <= CODEX_TRANSCRIPT_MAX_RECORD_MESSAGES_BYTES
        );
        assert_eq!(messages[0]["truncated"], json!(true));
        assert!(messages[0]["text"]
            .as_str()
            .unwrap_or_default()
            .ends_with("[truncated]"));
    }

    #[test]
    fn agent_chat_session_sync_record_identity_stays_stable_across_parser_bump() {
        let raw = json!({ "type": "response_item", "payload": { "type": "message" } });
        let record_key =
            format!("codex:session-a:jsonl:v{AGENT_CHAT_SESSION_SYNC_RECORD_KEY_VERSION}:0:0:abc");
        let record = agent_chat_session_sync_record(
            &HashMap::new(),
            "codex",
            "session-a",
            record_key.clone(),
            "response_item",
            json!({ "lineIndex": 0 }),
            "2026-07-02T00:00:00Z".to_string(),
            raw.clone(),
            Vec::new(),
        )
        .expect("record");
        let expected_hash = agent_chat_session_sync_hash(&json!({
            "provider": "codex",
            "parser_schema_version": AGENT_CHAT_SESSION_SYNC_RECORD_HASH_SCHEMA_VERSION,
            "session_id": "session-a",
            "record_key": record_key,
            "record_kind": "response_item",
            "raw": raw,
        }));

        assert_eq!(AGENT_CHAT_SESSION_SYNC_PARSER_SCHEMA_VERSION, 3);
        assert_eq!(AGENT_CHAT_SESSION_SYNC_RECORD_KEY_VERSION, 2);
        assert_eq!(AGENT_CHAT_SESSION_SYNC_RECORD_HASH_SCHEMA_VERSION, 2);
        assert_eq!(record["parserSchemaVersion"], json!(3));
        assert_eq!(record["recordHash"], json!(expected_hash));
    }

    #[test]
    fn agent_chat_session_sync_opencode_model_config_parses_session_model_json() {
        let config = agent_chat_session_sync_opencode_model_config(
            r#"{"id":"glm-5.2","providerID":"opencode-go"}"#,
        );

        assert_eq!(config["modelId"], json!("opencode-go/glm-5.2"));
        assert_eq!(config["model_id"], json!("opencode-go/glm-5.2"));
    }

    #[test]
    fn agent_chat_session_sync_thread_detail_uses_bigview_blocks() {
        let source = AgentChatSessionSyncSource {
            provider: "codex".to_string(),
            source_kind: "jsonl".to_string(),
            source_path: "/tmp/session.jsonl".to_string(),
            session_id: "session-a".to_string(),
            title: "Session A".to_string(),
            cwd: "/tmp/workspace-a".to_string(),
            latest_timestamp: "2026-06-30T00:00:00Z".to_string(),
            model_id: "gpt-5.5".to_string(),
            model_config: json!({}),
            records: Vec::new(),
            thread_detail_messages: vec![
                json!({
                    "id": "user-1",
                    "role": "user",
                    "text": "hello",
                }),
                json!({
                    "id": "assistant-1",
                    "role": "assistant",
                    "text": "hi",
                    "turnId": "turn-1",
                }),
                json!({
                    "id": "tool-1",
                    "role": "activity",
                    "kind": "tool_call",
                    "title": "Read file",
                    "text": "src/main.rs",
                    "turnId": "turn-1",
                }),
            ],
            total_record_count: 0,
        };
        let context = AgentChatSessionSyncContext {
            workspace_id: "workspace-a".to_string(),
            workspace_name: "Workspace A".to_string(),
            ..AgentChatSessionSyncContext::default()
        };

        let detail =
            agent_chat_session_sync_thread_detail(&source, &context, "gpt-5.5", &json!({}));
        let items = detail["items"].as_array().expect("thread detail items");

        assert_eq!(items.len(), 2);
        assert_eq!(items[0]["type"], "message");
        assert_eq!(items[1]["type"], "assistant-block");
        assert_eq!(items[1]["turnId"], "turn-1");
        assert_eq!(items[1]["items"][0]["type"], "message");
        assert_eq!(items[1]["items"][1]["type"], "activity-group");
        assert_eq!(items[1]["items"][1]["messages"][0]["id"], "tool-1");
    }

    #[test]
    fn agent_chat_session_sync_thread_detail_populates_diff_summaries_from_file_change() {
        let source = AgentChatSessionSyncSource {
            provider: "opencode".to_string(),
            source_kind: "opencode_sqlite".to_string(),
            source_path: "/tmp/opencode.db".to_string(),
            session_id: "session-a".to_string(),
            title: "Session A".to_string(),
            cwd: "/tmp/workspace-a".to_string(),
            latest_timestamp: "2026-06-30T00:00:00Z".to_string(),
            model_id: "gpt-5.5".to_string(),
            model_config: json!({}),
            records: Vec::new(),
            thread_detail_messages: vec![json!({
                "id": "patch-1",
                "role": "activity",
                "kind": "file_change",
                "legacy_kind": "patch",
                "title": "Patch",
                "text": "edited src/lib.rs",
                "turn_id": "turn-1",
                "file_change": {
                    "files": [
                        { "path": "src/lib.rs", "kind": "edit", "additions": 2, "deletions": 1 }
                    ],
                    "summary": "edited src/lib.rs"
                }
            })],
            total_record_count: 1,
        };
        let context = AgentChatSessionSyncContext {
            workspace_id: "workspace-a".to_string(),
            workspace_name: "Workspace A".to_string(),
            ..AgentChatSessionSyncContext::default()
        };

        let detail =
            agent_chat_session_sync_thread_detail(&source, &context, "gpt-5.5", &json!({}));
        assert_eq!(detail["messages"][0]["kind"], json!("patch"));
        assert_eq!(
            detail["messages"][0]["canonical_kind"],
            json!("file_change")
        );
        assert_eq!(detail["diffSummaries"][0]["fileCount"], json!(1));
        assert_eq!(
            detail["diffSummaries"][0]["files"][0]["path"],
            json!("src/lib.rs")
        );
        assert_eq!(detail["stats"]["additions"], json!(2));
        assert_eq!(detail["stats"]["deletions"], json!(1));
    }

    #[test]
    fn agent_chat_session_history_backfill_selects_only_unsynced_rows() {
        let waiting = test_history_item(
            "codex-session-a",
            WorkspaceAgentSessionHistoryChatSync::default(),
        );
        assert!(agent_chat_session_sync_history_item_needs_backfill(
            &waiting
        ));

        let mut queued_sync = WorkspaceAgentSessionHistoryChatSync::default();
        queued_sync.pending_packet_count = 1;
        let queued = test_history_item("codex-session-b", queued_sync);
        assert!(!agent_chat_session_sync_history_item_needs_backfill(
            &queued
        ));

        let mut fresh_synced_sync = WorkspaceAgentSessionHistoryChatSync::default();
        fresh_synced_sync.status = "synced".to_string();
        fresh_synced_sync.acked_at_ms = current_time_ms();
        fresh_synced_sync.record_total_count = 2;
        fresh_synced_sync.record_acked_count = 2;
        let fresh_synced = test_history_item("codex-session-c", fresh_synced_sync);
        assert!(!agent_chat_session_sync_history_item_needs_backfill(
            &fresh_synced
        ));

        let mut stale_synced_sync = WorkspaceAgentSessionHistoryChatSync::default();
        stale_synced_sync.status = "synced".to_string();
        stale_synced_sync.acked_at_ms = current_time_ms()
            .saturating_sub(AGENT_CHAT_SESSION_HISTORY_SYNC_VERIFY_INTERVAL_MS + 1);
        stale_synced_sync.record_total_count = 2;
        stale_synced_sync.record_acked_count = 2;
        let stale_synced = test_history_item("codex-session-d", stale_synced_sync);
        assert!(agent_chat_session_sync_history_item_needs_backfill(
            &stale_synced
        ));

        let unsupported = WorkspaceAgentSessionHistoryItem {
            provider: "shell".to_string(),
            agent_id: "shell".to_string(),
            ..test_history_item(
                "shell-session",
                WorkspaceAgentSessionHistoryChatSync::default(),
            )
        };
        assert!(!agent_chat_session_sync_history_item_needs_backfill(
            &unsupported
        ));
    }

    #[test]
    fn agent_chat_session_history_backfill_record_preserves_session_identity() {
        let item = test_history_item(
            "codex-session-identity",
            WorkspaceAgentSessionHistoryChatSync::default(),
        );

        let record = agent_chat_session_sync_history_item_record(&item);

        assert_eq!(record.provider, "codex");
        assert_eq!(record.provider_session_id, "codex-session-identity");
        assert_eq!(record.native_session_id, "codex-session-identity");
        assert_eq!(record.cwd, "/tmp/workspace-a");
        assert_eq!(
            record.shared_history_id,
            "history:workspace-a:codex:codex-session-identity"
        );
    }
}

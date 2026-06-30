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
    total_record_count: usize,
}

const AGENT_CHAT_SESSION_SYNC_TARGET_PACKET_BYTES: usize = 512 * 1024;
const AGENT_CHAT_SESSION_SYNC_MAX_RECORDS_PER_PACKET: usize = 128;

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

fn agent_chat_session_sync_acked_session_content_hash(
    scope_key: &str,
    device_id: &str,
    workspace_id: &str,
    provider: &str,
    session_id: &str,
) -> Option<String> {
    let conn = cloud_mcp_open_outbox_conn().ok()?;
    conn.query_row(
        &format!(
            "SELECT content_hash
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

fn agent_chat_session_sync_message_value(message: CodexThreadTranscriptMessage) -> Value {
    serde_json::to_value(message).unwrap_or_else(|_| json!({}))
}

fn agent_chat_session_sync_messages_value(
    messages: Vec<CodexThreadTranscriptMessage>,
) -> Vec<Value> {
    messages
        .into_iter()
        .map(agent_chat_session_sync_message_value)
        .collect()
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
    let record_hash = agent_chat_session_sync_hash(&json!({
        "provider": provider,
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
) -> Vec<Value> {
    let record_type = value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let payload = value.get("payload").unwrap_or(&Value::Null);
    let messages = match record_type {
        "event_msg" => codex_messages_from_event(line_index, timestamp, payload),
        "response_item" => codex_messages_from_response_item(line_index, timestamp, payload),
        _ => Vec::new(),
    };
    agent_chat_session_sync_messages_value(messages)
}

fn agent_chat_session_sync_claude_messages_for_line(
    line_index: usize,
    timestamp: &str,
    value: &Value,
) -> Vec<Value> {
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
        let result_text =
            first_value_string(&[value.get("result"), value.get("message"), value.get("error")]);
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
            let assistant_text =
                clean_codex_transcript_text(&result_text, CODEX_TRANSCRIPT_MAX_TEXT);
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
                    artifacts: Vec::new(),
                });
            }
            messages.push(transcript_task_complete_message(
                format!("claude-{line_index}-task-complete"),
                "claude",
                timestamp,
                result_text,
            ));
        }
        return agent_chat_session_sync_messages_value(messages);
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
    let text = clean_codex_transcript_text(claude_content_text(content), CODEX_TRANSCRIPT_MAX_TEXT);
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
            artifacts: Vec::new(),
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
    agent_chat_session_sync_messages_value(messages)
}

fn agent_chat_session_sync_jsonl_source(
    provider: &str,
    source_kind: &str,
    path: &Path,
    initial_meta: CodexRolloutMeta,
    acked: &HashMap<String, String>,
) -> Result<AgentChatSessionSyncSource, String> {
    let file = fs::File::open(path)
        .map_err(|error| format!("Unable to open agent chat source {}: {error}", path.display()))?;
    let mut reader = std::io::BufReader::new(file);
    let mut offset: u64 = 0;
    let mut line_index: usize = 0;
    let mut buffer = Vec::new();
    let mut session_id = initial_meta.session_id;
    let mut cwd = initial_meta.cwd;
    let mut title = initial_meta.title;
    let mut latest_timestamp = initial_meta.latest_timestamp;
    let mut records = Vec::new();
    let mut total_record_count = 0usize;
    let mut model_config = json!({});

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
        agent_chat_session_sync_merge_model_config(
            &mut model_config,
            agent_chat_session_sync_model_config_from_raw(&value),
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
            match value.get("type").and_then(Value::as_str).unwrap_or_default() {
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

        let normalized_messages = if provider == "claude" {
            agent_chat_session_sync_claude_messages_for_line(line_index, &timestamp, &value)
        } else {
            agent_chat_session_sync_codex_messages_for_line(line_index, &timestamp, &value)
        };
        let record_kind = value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("jsonl")
            .to_string();
        let line_hash = agent_chat_session_sync_text_hash(&raw_line);
        let record_key =
            format!("{provider}:{session_id}:jsonl:{line_index}:{start_offset}:{line_hash}");
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
            timestamp,
            value,
            normalized_messages,
        ) {
            records.push(record);
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
                    model_config["modelId"] = json!(model.clone());
                    model_config["model_id"] = json!(model);
                }
            }
        }
    }

    let mut records = Vec::new();
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
        .map_err(|error| format!("Unable to read OpenCode messages: {error}"))?;
    for row in message_rows.flatten() {
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
        let normalized_messages = if message_text.trim().is_empty() {
            Vec::new()
        } else {
            agent_chat_session_sync_messages_value(vec![CodexThreadTranscriptMessage {
                id: format!("opencode-{}-message", row.0),
                role,
                kind: "message".to_string(),
                text: clean_codex_transcript_text(message_text, CODEX_TRANSCRIPT_MAX_TEXT),
                title: String::new(),
                call_id: String::new(),
                created_at: timestamp.clone(),
                source: "opencode".to_string(),
                artifacts: Vec::new(),
            }])
        };
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
        .map_err(|error| format!("Unable to read OpenCode parts: {error}"))?;
    for row in part_rows.flatten() {
        let part_data = serde_json::from_str::<Value>(&row.3).unwrap_or(Value::Null);
        agent_chat_session_sync_merge_model_config(
            &mut model_config,
            agent_chat_session_sync_model_config_from_raw(&part_data),
        );
        let timestamp = opencode_timestamp(row.2);
        if !timestamp.is_empty() {
            latest_timestamp = timestamp.clone();
        }
        let role = role_by_message
            .get(&row.1)
            .cloned()
            .unwrap_or_else(|| "assistant".to_string());
        let normalized_messages = agent_chat_session_sync_messages_value(opencode_part_message(
            &row.1,
            &role,
            &row.0,
            &timestamp,
            &part_data,
        ));
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
        context.terminal_instance_id = terminal_instance_id.and_then(|value| u64::try_from(value).ok());
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
    }));
    if source.records.is_empty()
        && agent_chat_session_sync_acked_session_content_hash(
            &scope_key,
            &device_id,
            &workspace_id,
            &source.provider,
            &source.session_id,
        )
        .as_deref()
            == Some(metadata_hash.as_str())
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
        let payload = json!({
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
            "records": packet_records,
        });
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
    tauri::async_runtime::spawn(async move {
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
                if recorded {
                    agent_chat_session_sync_spawn(
                        app_for_task,
                        agent_id,
                        provider_session_id,
                        result.cwd,
                        context,
                        reason,
                    );
                }
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

#[cfg(test)]
mod agent_chat_session_sync_tests {
    use super::*;

    #[test]
    fn agent_chat_session_sync_chunks_records_by_session_packet_limit() {
        let records = (0..=AGENT_CHAT_SESSION_SYNC_MAX_RECORDS_PER_PACKET)
            .map(|index| json!({ "record_key": format!("record-{index}") }))
            .collect::<Vec<_>>();

        let chunks = agent_chat_session_sync_record_chunks(records);

        assert_eq!(chunks.len(), 2);
        assert_eq!(chunks[0].len(), AGENT_CHAT_SESSION_SYNC_MAX_RECORDS_PER_PACKET);
        assert_eq!(chunks[1].len(), 1);
    }
}
